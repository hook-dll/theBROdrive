"""Builds a car body from authored character lines, the way the light plane is built.

    blender --background --factory-startup --python tools/carshape/carbody.py -- <car.json> <out.glb> [preview.png]

The plane (src/story/plane.ts) reads as a Cessna because its skin goes through a table
of the real aircraft's sections and nothing is approximated by boxes. A car is the same
idea in a car modeller's terms: a handful of CHARACTER LINES run nose to tail (sill,
waist, shoulder crease, deck edge, glass base, roof rail, centreline), each given as
its height along the car (`side`, [[y, z]]) and its half-width (`plan`, [[y, x]]). Every
station's half-section goes through the lines in order, with gently crowned panels
between them, so the edges a real car has — the crease under the window, the sharp
deck edge, the roof rail — are rows of the mesh rather than accidents of smoothing.

Where the lines come from: tools/carshape/measure.py and sheets.py read them off a
reference (an image-to-3D reconstruction warped to the factory dimensions, or a
blueprint), and they are authored by hand from those numbers.

Glass is not a part. Side windows are outlines in the side view cut into the panel
between `glassBase` and `rail`; the windscreen and rear window are spans of the panel
between `rail` and `topCentre`. The wells are cut from the outer skin with the factory
axles. Lamps, grille, bumpers, mirrors and wheels are real shapes from `parts`.

Coordinates in Blender: +Z up, nose toward -Y, the car's left toward +X; the glTF
exporter turns that into the game's +Y up, nose +Z, left +X. Node and material names
follow the runtime contract (render/carmodel.ts).
"""
import json
import math
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:]
spec = json.load(open(argv[0]))
out_glb = argv[1]
preview = argv[2] if len(argv) > 2 else None
F = spec['factory']
B = spec['body']
L, W, H, R = F['length'], F['width'], F['height'], F['wheelRadius']
AXLES = [(-L / 2 + F['frontOverhang'], F['frontTrack']),
         (-L / 2 + F['frontOverhang'] + F['wheelbase'], F['rearTrack'])]

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


# ---- materials ------------------------------------------------------------------------
def material(name, rgb, rough=0.5, metal=0.0):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*rgb, 1)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    m.diffuse_color = (*rgb, 1)
    return m


MAT = {
    'paint': material('car_paint', (0.62, 0.12, 0.08), 0.45),
    'trim': material('car_trim', (0.05, 0.05, 0.055), 0.7),
    'glass': material('car_glass', (0.03, 0.045, 0.06), 0.1),
    'chrome': material('car_chrome', (0.72, 0.73, 0.75), 0.25, 0.9),
    'Headlights': material('Headlights', (0.75, 0.76, 0.74), 0.25),
    'TailLights': material('TailLights', (0.5, 0.03, 0.02), 0.35),
    'IndicatorLights': material('IndicatorLights', (0.9, 0.45, 0.05), 0.35),
    'ReverseLights': material('ReverseLights', (0.85, 0.85, 0.85), 0.35),
    'Tyres': material('Tyres', (0.035, 0.035, 0.035), 0.9),
    'wheel_rim': material('wheel_rim', (0.62, 0.63, 0.65), 0.35, 0.6),
}


# ---- lines ----------------------------------------------------------------------------
def pchip(points, at):
    """Monotone cubic through the points: never overshoots, so flats stay flat."""
    p = np.array(sorted(points), dtype=float)
    xs, ys = p[:, 0], p[:, 1]
    at = np.clip(np.asarray(at, float), xs[0], xs[-1])
    if len(p) < 3:
        return np.interp(at, xs, ys)
    h = np.diff(xs)
    d = np.diff(ys) / h
    m = np.zeros_like(ys)
    m[0], m[-1] = d[0], d[-1]
    for k in range(1, len(ys) - 1):
        if d[k - 1] * d[k] > 0:
            w1, w2 = 2 * h[k] + h[k - 1], h[k] + 2 * h[k - 1]
            m[k] = (w1 + w2) / (w1 / d[k - 1] + w2 / d[k])
    k = np.clip(np.searchsorted(xs, at, side='right') - 1, 0, len(xs) - 2)
    t = (at - xs[k]) / h[k]
    return ((2 * t ** 3 - 3 * t ** 2 + 1) * ys[k] + (t ** 3 - 2 * t ** 2 + t) * h[k] * m[k]
            + (-2 * t ** 3 + 3 * t ** 2) * ys[k + 1] + (t ** 3 - t ** 2) * h[k] * m[k + 1])


y_front, y_rear = B['yRange']
stations = np.array(sorted(set(np.round(np.concatenate([
    np.linspace(y_front, y_rear, B.get('stations', 60)),
    np.array(B.get('extraStations', [])),
]), 4))))
stations = stations[(stations >= y_front - 1e-6) & (stations <= y_rear + 1e-6)]
plan_factor = pchip(B['planFactor'], stations) if 'planFactor' in B else np.ones_like(stations)

LINES = {}
for name, line in B['lines'].items():
    x = pchip(line['plan'], stations) * plan_factor if 'plan' in line else np.zeros_like(stations)
    z = pchip(line['side'], stations)
    LINES[name] = (x, z)
ring = B['ring']
panels = B['panels']
assert len(panels) == len(ring) - 1


def panel_points(a, b, n, bulge):
    d = b - a
    length = float(np.hypot(*d))
    control = (a + b) / 2 + np.array([d[1], -d[0]]) / max(length, 1e-9) * bulge * length
    return [(1 - t) ** 2 * a + 2 * (1 - t) * t * control + t * t * b for t in np.arange(1, n + 1) / (n + 1)]


def section(i):
    pts, owner = [], []
    corners = [np.array([LINES[n][0][i], LINES[n][1][i]]) for n in ring]
    last = len(corners) - 2
    for k, (a, b) in enumerate(zip(corners, corners[1:])):
        pts.append(a)
        owner.append(k)
        if k in (0, last) and panels[k]['n'] > 0:
            # The panels that meet the centreline must arrive LEVEL, or the mirror
            # leaves a valley down the middle of the bonnet, roof and boot: the curve's
            # control point sits at the centre's own height.
            centre, outer = (a, b) if k == 0 else (b, a)
            control = np.array([outer[0] * 0.5, centre[1]])
            n_ = panels[k]['n']
            for t in np.arange(1, n_ + 1) / (n_ + 1):
                pts.append((1 - t) ** 2 * a + 2 * (1 - t) * t * control + t * t * b)
                owner.append(k)
            continue
        for p in panel_points(a, b, panels[k]['n'], panels[k].get('bulge', 0.0)):
            pts.append(p)
            owner.append(k)
    pts.append(corners[-1])
    owner.append(len(panels) - 1)
    return pts, owner


bm = bmesh.new()
rings = []
owners = None
for i, y in enumerate(stations):
    pts, owners = section(i)
    rings.append([bm.verts.new((float(p[0]), float(y), float(p[1]))) for p in pts])
panel_layer = bm.faces.layers.int.new('panel')
for a, b in zip(rings, rings[1:]):
    for k in range(len(a) - 1):
        f = bm.faces.new((a[k], a[k + 1], b[k + 1], b[k]))
        f[panel_layer] = owners[k]
for cap in (rings[0], rings[-1][::-1]):
    f = bm.faces.new(cap)
    f[panel_layer] = -1
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-4)

# ---- glass ------------------------------------------------------------------------------
panel_index = {f'{a}-{b}': k for k, (a, b) in enumerate(zip(ring, ring[1:]))}


def inside(poly, y, z):
    hit = False
    for (y0, z0), (y1, z1) in zip(poly, poly[1:] + poly[:1]):
        if (z0 > z) != (z1 > z) and y < y0 + (z - z0) * (y1 - y0) / (z1 - z0):
            hit = not hit
    return hit


for region in B.get('glass', []):
    pid = panel_index[region['panel']]
    if 'outline' in region:
        poly = region['outline']
        for (y0, z0), (y1, z1) in zip(poly, poly[1:] + poly[:1]):
            faces = [f for f in bm.faces if f[panel_layer] == pid]
            geom = list({v for f in faces for v in f.verts}) + list({e for f in faces for e in f.edges}) + faces
            n = Vector((0.0, -(z1 - z0), y1 - y0)).normalized()
            bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0.0, y0, z0), plane_no=n, dist=1e-5)
    else:
        for y_cut in region['y']:
            faces = [f for f in bm.faces if f[panel_layer] == pid]
            geom = list({v for f in faces for v in f.verts}) + list({e for f in faces for e in f.edges}) + faces
            bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0.0, y_cut, 0.0), plane_no=(0, 1, 0), dist=1e-5)
        if 'x' in region:
            faces = [f for f in bm.faces if f[panel_layer] == pid]
            geom = list({v for f in faces for v in f.verts}) + list({e for f in faces for e in f.edges}) + faces
            bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(region['x'], 0, 0), plane_no=(1, 0, 0), dist=1e-5)
        if 'zMax' in region:
            # A screen's top edge is the same height as the side windows' on most cars:
            # the roof's leading and trailing strip is paint.
            faces = [f for f in bm.faces if f[panel_layer] == pid]
            geom = list({v for f in faces for v in f.verts}) + list({e for f in faces for e in f.edges}) + faces
            bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, region['zMax']), plane_no=(0, 0, 1), dist=1e-5)

GLASS_FACES = set()
for f in bm.faces:
    c = f.calc_center_median()
    for region in B.get('glass', []):
        if f[panel_layer] != panel_index[region['panel']]:
            continue
        if 'outline' in region and inside(region['outline'], c.y, c.z):
            GLASS_FACES.add(f)
        if 'y' in region and region['y'][0] <= c.y <= region['y'][1] and c.x <= region.get('x', 9) \
                and c.z <= region.get('zMax', 9):
            GLASS_FACES.add(f)
for f in bm.faces:
    f.material_index = 1 if f in GLASS_FACES else 0

mirror = bmesh.ops.duplicate(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:])
for e in mirror['geom']:
    if isinstance(e, bmesh.types.BMVert):
        e.co.x = -e.co.x
bmesh.ops.reverse_faces(bm, faces=[g for g in mirror['geom'] if isinstance(g, bmesh.types.BMFace)])
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
mesh = bpy.data.meshes.new('paint')
bm.to_mesh(mesh)
bm.free()
mesh.materials.append(MAT['paint'])
mesh.materials.append(MAT['glass'])
mesh.materials.append(MAT['trim'])
body = bpy.data.objects.new('paint', mesh)
scene.collection.objects.link(body)

# ---- wheel arches: the outer skin only, leaving a well ----------------------------------
arch = B.get('arch', {})
# A car with skirts over its rear wheels (the DS) has no rear arch to cut.
for axle_y, track in (AXLES[:1] if arch.get('rearSkirt') else AXLES):
    radius = R * arch.get('radiusFactor', 1.13)
    centre_z = R + arch.get('lift', 0.02)
    outline = [(axle_y + radius * math.cos(a), centre_z + radius * math.sin(a))
               for a in np.linspace(math.pi * 1.0, 0.0, 28)]
    outline = [(axle_y + radius, -0.3)] + outline[::-1] + [(axle_y - radius, -0.3)]
    for sign in (1, -1):
        inner = W / 2 - arch.get('wellDepth', 0.3)
        cbm = bmesh.new()
        near = [cbm.verts.new((sign * inner, y, z)) for y, z in outline]
        far = [cbm.verts.new((sign * (W / 2 + 0.3), y, z)) for y, z in outline]
        cbm.faces.new(near)
        cbm.faces.new(far[::-1])
        for k in range(len(outline)):
            j = (k + 1) % len(outline)
            cbm.faces.new((near[j], near[k], far[k], far[j]))
        bmesh.ops.recalc_face_normals(cbm, faces=cbm.faces)
        cm = bpy.data.meshes.new('cutter')
        cbm.to_mesh(cm)
        cbm.free()
        cm.materials.append(MAT['trim'])
        cutter = bpy.data.objects.new('cutter', cm)
        scene.collection.objects.link(cutter)
        mod = body.modifiers.new('arch', 'BOOLEAN')
        mod.operation = 'DIFFERENCE'
        mod.solver = 'EXACT'
        mod.object = cutter
        mod.material_mode = 'TRANSFER'
        bpy.context.view_layer.objects.active = body
        bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.data.objects.remove(cutter)


# ---- parts ------------------------------------------------------------------------------
def new_object(name, bm_, mats):
    me = bpy.data.meshes.new(name)
    bm_.to_mesh(me)
    bm_.free()
    for m in mats:
        me.materials.append(m)
    obj = bpy.data.objects.new(name, me)
    scene.collection.objects.link(obj)
    return obj


def disc(bm_, centre, normal, radius, depth, segments=20, mat=0):
    """A short cylinder standing out of a surface along `normal`."""
    r = bmesh.ops.create_cone(bm_, cap_ends=True, segments=segments, radius1=radius, radius2=radius, depth=depth)
    rot = Vector((0, 0, 1)).rotation_difference(Vector(normal)).to_matrix().to_4x4()
    bmesh.ops.transform(bm_, matrix=Matrix.Translation(Vector(centre)) @ rot, verts=r['verts'])
    for f in {f for v in r['verts'] for f in v.link_faces}:
        f.material_index = mat
    return r


def box(bm_, centre, size, mat=0):
    r = bmesh.ops.create_cube(bm_, size=1.0)
    bmesh.ops.transform(bm_, matrix=Matrix.Translation(Vector(centre)) @ Matrix.Diagonal((*size, 1)), verts=r['verts'])
    for f in {f for v in r['verts'] for f in v.link_faces}:
        f.material_index = mat
    return r


def sweep(bm_, path, profile, mat=0):
    """A tube: a closed 2D `profile` [(u, v)] carried along a 3D `path`, oriented by the
    path's direction with +Z kept up, so a bumper's section stays level round a corner."""
    rings_ = []
    for k, p in enumerate(path):
        p = Vector(p)
        a = Vector(path[max(k - 1, 0)])
        b = Vector(path[min(k + 1, len(path) - 1)])
        t = (b - a).normalized()
        side = t.cross(Vector((0, 0, 1))).normalized()
        rings_.append([bm_.verts.new(p + side * u + Vector((0, 0, v))) for u, v in profile])
    faces = []
    for r0, r1 in zip(rings_, rings_[1:]):
        for k in range(len(profile)):
            j = (k + 1) % len(profile)
            faces.append(bm_.faces.new((r0[k], r0[j], r1[j], r1[k])))
    faces.append(bm_.faces.new(rings_[0][::-1]))
    faces.append(bm_.faces.new(rings_[-1]))
    for f in faces:
        f.material_index = mat
    return faces


P = spec['parts']
nose_y, tail_y = y_front, y_rear
front_n, rear_n = (0, -1, 0), (0, 1, 0)

# Where the skin actually is at a given (x, z) seen from the nose or the tail, so a
# lamp sits ON a sloping nose or a curved tail rather than at the body's end plane.
from mathutils.bvhtree import BVHTree  # noqa: E402
_dg = bpy.context.evaluated_depsgraph_get()
_skin = BVHTree.FromObject(body, _dg)


def surface_y(x, z, end):
    toward = 1 if end == 'front' else -1
    start = Vector((x, -toward * (L / 2 + 1.0), z))
    hit = _skin.ray_cast(start, Vector((0, toward, 0)), L + 2)
    if hit[0] is None:
        return nose_y if end == 'front' else tail_y
    return hit[0].y

# Headlamps: a lens in a bezel. Each entry is [x, z, r] for a round lamp, or a dict
# {"shape": "rect", "x", "z", "w", "h"} for a rectangular one; mirrored to both sides.
def lamp_shape(bm_, lamp, y, grow, depth):
    # Each lamp sits on the skin in front of it (see `surface_y`); `y` here is only
    # the offset from the nose the caller asks for (lens proud of the bezel).
    offset = y - nose_y
    if isinstance(lamp, dict) and lamp.get('shape') == 'rect':
        face = lamp.get('y', surface_y(lamp['x'], lamp['z'], 'front'))
        for s_ in (1, -1):
            box(bm_, (s_ * lamp['x'], face + offset, lamp['z']), (lamp['w'] + 2 * grow, depth, lamp['h'] + 2 * grow), 0)
    else:
        x, z, r = lamp[:3]
        face = lamp[3] if len(lamp) > 3 else surface_y(x, z, 'front')
        for s_ in (1, -1):
            disc(bm_, (s_ * x, face + offset, z), front_n, r + grow, depth, 24, 0)


bezel_mat = MAT['chrome'] if P.get('bezelMaterial', 'chrome') == 'chrome' else MAT['trim']
bm_ = bmesh.new()
for lamp in P['headlamps']:
    lamp_shape(bm_, lamp, nose_y - 0.012, 0.0, 0.024)
head_lens = new_object('headlights', bm_, [MAT['Headlights']])
bm_ = bmesh.new()
for lamp in P['headlamps']:
    lamp_shape(bm_, lamp, nose_y - 0.006, P.get('bezel', 0.016), 0.012)
bezels = new_object('bezels', bm_, [bezel_mat])

# Grille: a dark field, optionally with slats and a surround (chrome or black).
bm_ = bmesh.new()
g = P.get('grille')
if g:
    gx, gz0, gz1 = g['halfWidth'], g['z'][0], g['z'][1]
    if g.get('surround', True):
        box(bm_, (0, nose_y - 0.004, (gz0 + gz1) / 2), (2 * gx + 0.03, 0.01, gz1 - gz0 + 0.03), 0)
    for k in range(g.get('slats', 6)):
        z = gz0 + (k + 0.5) * (gz1 - gz0) / max(1, g.get('slats', 6))
        box(bm_, (0, nose_y - 0.018, z), (2 * gx, 0.012, 0.012), 0)
    # Vertical bars, for the grilles that have them.
    n_bars = g.get('bars', 0)
    for k in range(n_bars):
        x = -gx + (k + 0.5) * 2 * gx / n_bars
        box(bm_, (x, nose_y - 0.016, (gz0 + gz1) / 2), (0.008, 0.012, gz1 - gz0), 0)
# Twin kidneys (BMW) or any other centre grille standing proud of the main one:
# a chrome frame with a dark field, mirrored either side of the centreline.
k = (g or {}).get('kidneys')
kidney_bm = bmesh.new()
if k:
    for s_ in (1, -1):
        cx = s_ * (k['gap'] / 2 + k['w'] / 2)
        box(kidney_bm, (cx, nose_y - 0.03, k['z']), (k['w'] + 0.03, 0.02, k['h'] + 0.03), 0)
kidney_frames = new_object('kidneys', kidney_bm, [MAT['chrome']])
slat_mat = MAT['chrome'] if (g or {}).get('slatMaterial', 'chrome') == 'chrome' else MAT['trim']
chrome_front = new_object('chrome_front', bm_, [slat_mat])
bm_ = bmesh.new()
if g:
    box(bm_, (0, nose_y - 0.01, (gz0 + gz1) / 2), (2 * gx, 0.012, gz1 - gz0), 0)
    if g.get('kidneys'):
        k = g['kidneys']
        for s_ in (1, -1):
            box(bm_, (s_ * (k['gap'] / 2 + k['w'] / 2), nose_y - 0.042, k['z']), (k['w'], 0.012, k['h']), 0)
grille_field = new_object('grille', bm_, [MAT['trim']])


# Bumpers: a chrome bar that follows the nose and wraps round the corners.
def bumper_path(y_face, toward, wrap, half, z):
    """y_face: the bar's front face; toward: -1 at the nose, +1 at the tail."""
    pts = []
    corner = 0.12
    for k in range(9):
        x = -half + corner + (2 * half - 2 * corner) * k / 8
        pts.append((x, y_face, z))
    for side in (1, -1):
        arc = [(side * (half - corner + corner * math.sin(a)), y_face - toward * corner * (1 - math.cos(a)), z)
               for a in np.linspace(0, math.pi / 2, 5)[1:]]
        tail = [(side * half, y_face - toward * (corner + wrap * t), z) for t in (0.5, 1.0)]
        if side == 1:
            pts = pts + arc + tail
        else:
            pts = (arc + tail)[::-1] + pts
    return pts


bp = P['bumper']
profile = [(-bp['depth'] / 2, -bp['height'] / 2), (bp['depth'] / 2, -bp['height'] / 2),
           (bp['depth'] / 2 + 0.008, 0), (bp['depth'] / 2, bp['height'] / 2), (-bp['depth'] / 2, bp['height'] / 2)]
bm_ = bmesh.new()
sweep(bm_, bumper_path(nose_y - bp['standOff'], -1, bp['wrap'], bp['halfWidth'], bp['zFront']), profile, 0)
sweep(bm_, bumper_path(tail_y + bp['standOff'], 1, bp['wrap'], bp['halfWidth'], bp['zRear']), profile, 0)
ov = P.get('overriders')
if ov:
    # The vertical guards bolted through the bar, a period bumper's signature.
    for y, z in ((nose_y - bp['standOff'] - bp['depth'] / 2 - 0.01, bp['zFront']),
                 (tail_y + bp['standOff'] + bp['depth'] / 2 + 0.01, bp['zRear'])):
        for s_ in (1, -1):
            box(bm_, (s_ * ov['x'], y, z - 0.01), (ov['width'], 0.04, ov['height']), 0)
bumpers = new_object('bumpers', bm_, [MAT['chrome'] if bp.get('material', 'chrome') == 'chrome' else MAT['trim']])

# Lamps, from the car's own photographs: one entry per lens, each a real lamp function
# (tools/vehicle-lamp-authoring.md) with its off-state lens colour. `end` puts it on the
# nose or the tail face, `side` on a front wing; `x` is the lens centre's distance from
# the centreline and `mirror` repeats it on the other side. Shapes are `rect` (w, h) or
# `disc` (r). Lenses that share a node are gathered into it.
LENS = {}
for lamp in P.get('lamps', []):
    sides = (1, -1) if lamp.get('mirror', True) else (1,)
    if lamp['node'].endswith('_left'):
        sides = (1,)
    elif lamp['node'].endswith('_right'):
        sides = (-1,)
    for sgn in sides:
        bm_l, node_mats = LENS.setdefault(lamp['node'], (bmesh.new(), []))
        if lamp['material'] not in node_mats:
            node_mats.append(lamp['material'])
        slot = node_mats.index(lamp['material'])
        depth = lamp.get('depth', 0.018)
        if lamp['end'] == 'side':
            x = float(np.interp(lamp['y'], stations, LINES['waist'][0])) + depth / 2 - 0.004
            centre, normal = (sgn * x, lamp['y'], lamp['z']), (sgn, 0, 0)
        else:
            # A lamp that sits up a sloping tailgate or nose gives its own `y`.
            face = lamp.get('y', surface_y(lamp['x'], lamp['z'], lamp['end']))
            n = -1 if lamp['end'] == 'front' else 1
            centre, normal = (sgn * lamp['x'], face + n * (depth / 2 - 0.004), lamp['z']), (0, n, 0)
        if lamp['shape'] == 'disc':
            disc(bm_l, centre, normal, lamp['r'], depth, 18, slot)
        else:
            size = (depth, lamp['w'], lamp['h']) if lamp['end'] == 'side' else (lamp['w'], depth, lamp['h'])
            box(bm_l, centre, size, slot)
for node, (bm_l, mat_names) in LENS.items():
    for mat_name in mat_names:
        if mat_name not in MAT:
            MAT[mat_name] = material(mat_name, tuple(P['lensColours'][mat_name]), 0.3)
    new_object(node, bm_l, [MAT[n] for n in mat_names])

# Dark slots in the panel under the grille, and anything else flush and black.
bm_ = bmesh.new()
for x0, x1, z0, z1 in P.get('frontSlots', []):
    for sgn in (1, -1):
        box(bm_, (sgn * (x0 + x1) / 2, nose_y - 0.004, (z0 + z1) / 2), (x1 - x0, 0.01, z1 - z0), 0)
# Air intakes on the flanks (the rear-engined cars): a dark field with vertical
# louvres, set on the side of the body at [y0, y1, z0, z1].
for y0, y1, z0, z1 in P.get('sideVents', []):
    for sgn in (1, -1):
        x = float(np.interp((y0 + y1) / 2, stations, LINES['waist'][0])) - 0.004
        box(bm_, (sgn * x, (y0 + y1) / 2, (z0 + z1) / 2), (0.012, y1 - y0, z1 - z0), 0)
        n_l = max(3, int((y1 - y0) / 0.025))
        for k in range(n_l):
            yy = y0 + (k + 0.5) * (y1 - y0) / n_l
            box(bm_, (sgn * (x + 0.006), yy, (z0 + z1) / 2), (0.008, 0.006, (z1 - z0) * 0.8), 0)
front_slots = new_object('front_slots', bm_, [MAT['trim']])

# Mirrors: a stalk and a head on each door.
m = P.get('mirror')
bm_ = bmesh.new()
for s in ((1, -1) if m else ()):
    # A round head on a short arm that leaves the door at the window's front corner.
    box(bm_, (s * (m['x'] - 0.045), m['y'], m['z'] - 0.04), (0.09, 0.025, 0.02), 0)
    disc(bm_, (s * m['x'], m['y'], m['z']), (0, -1, 0), 0.055, 0.035, 16, 0)
new_object('mirrors', bm_, [MAT['chrome']])

# Door handles and the window surrounds: thin chrome on the paint, the details a
# period car is recognised by from the side.
bm_ = bmesh.new()
for hy, hz in P.get('doorHandles', []):
    for s in (1, -1):
        x = float(np.interp(hy, stations, LINES['shoulder'][0])) + 0.012
        box(bm_, (s * x, hy, hz), (0.02, 0.13, 0.025), 0)
frame = P.get('windowFrame')
if frame:
    for region in B.get('glass', []):
        if 'outline' not in region:
            continue
        poly = region['outline'] + region['outline'][:1]
        for s in (1, -1):
            path = []
            for (y0, z0), (y1, z1) in zip(poly, poly[1:]):
                for t in np.linspace(0, 1, 6)[:-1]:
                    y, z = y0 + (y1 - y0) * t, z0 + (z1 - z0) * t
                    # Half-width of the glasshouse at this height and station.
                    xs = np.interp(y, stations, LINES['glassBase'][0])
                    xr = np.interp(y, stations, LINES['rail'][0])
                    zb = np.interp(y, stations, LINES['glassBase'][1])
                    zr = np.interp(y, stations, LINES['rail'][1])
                    f = min(1.0, max(0.0, (z - zb) / max(zr - zb, 1e-3)))
                    path.append((s * (xs + (xr - xs) * f + 0.006), y, z))
            path.append(path[0])
            for a, b in zip(path, path[1:]):
                mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2)
                d = Vector(b) - Vector(a)
                r = bmesh.ops.create_cube(bm_, size=1.0)
                rot = Vector((0, 1, 0)).rotation_difference(d.normalized()).to_matrix().to_4x4()
                bmesh.ops.transform(bm_, matrix=Matrix.Translation(Vector(mid)) @ rot @ Matrix.Diagonal((frame, d.length + frame, frame, 1)), verts=r['verts'])
detail_chrome = new_object('chrome_side', bm_, [MAT['chrome']])

# Wheels: tyre, a steel rim, a chrome hubcap; each centred on its own axle.
wheels = []
for name, (axle_y, track), side in (('wheel_fl', AXLES[0], 1), ('wheel_fr', AXLES[0], -1),
                                    ('wheel_rl', AXLES[1], 1), ('wheel_rr', AXLES[1], -1)):
    bm_ = bmesh.new()
    tw = F['tyreWidth']
    disc(bm_, (0, 0, 0), (1, 0, 0), R, tw, 28, 0)
    wheel = P.get('wheel', {'style': 'hubcap'})
    rim_r = R * wheel.get('rimFactor', 0.68)
    disc(bm_, (side * (tw / 2 - 0.004), 0, 0), (side, 0, 0), rim_r, 0.012, 24, 1)
    if wheel['style'] == 'steel':
        # A pressed steel wheel: painted disc, a ring of oval windows, a bare hub.
        n_win = wheel.get('windows', 6)
        for k in range(n_win):
            a = 2 * math.pi * k / n_win
            r_mid = rim_r * 0.68
            c = (side * (tw / 2 + 0.003), r_mid * math.cos(a), r_mid * math.sin(a))
            w_ = bmesh.ops.create_cube(bm_, size=1.0)
            rot = Matrix.Rotation(a, 4, 'X')
            bmesh.ops.transform(bm_, matrix=Matrix.Translation(Vector(c)) @ rot @ Matrix.Diagonal((0.006, rim_r * 0.16, rim_r * 0.3, 1)), verts=w_['verts'])
            for f in {f for v in w_['verts'] for f in v.link_faces}:
                f.material_index = 0
        disc(bm_, (side * (tw / 2 + 0.008), 0, 0), (side, 0, 0), rim_r * 0.3, 0.025, 16, 0)
    else:
        disc(bm_, (side * (tw / 2 + 0.006), 0, 0), (side, 0, 0), R * 0.42, 0.02, 20, 1)
    obj = new_object(name, bm_, [MAT['Tyres'], MAT['wheel_rim']])
    obj.location = (side * track / 2, axle_y, R)
    wheels.append(obj)

# ---- shading and export -------------------------------------------------------------------
for obj in scene.objects:
    if obj.type == 'MESH':
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(B.get('smoothAngleDeg', 32)))
        obj.select_set(False)

# The contract wants glass and paint as separate nodes; the bumpers, grille and
# bezels ride in `trim`.
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='DESELECT')
body.active_material_index = 1
bpy.ops.object.material_slot_select()
bpy.ops.mesh.separate(type='SELECTED')
bpy.ops.object.mode_set(mode='OBJECT')
for o in scene.objects:
    if o.name.startswith('paint.'):
        o.name = 'glass'
        o.data.name = 'glass'
bpy.ops.object.select_all(action='DESELECT')
for o in (chrome_front, grille_field, bezels, kidney_frames, bumpers, detail_chrome, front_slots):
    o.select_set(True)
bpy.context.view_layer.objects.active = bumpers
bpy.ops.object.join()
bumpers.name = 'trim'
bumpers.data.name = 'trim'

faces = sum(len(o.data.polygons) for o in scene.objects if o.type == 'MESH')
print(f'CARBODY {spec["id"]}: {faces} faces, {len(stations)} stations')
bpy.ops.export_scene.gltf(filepath=out_glb, export_format='GLB', export_yup=True, export_apply=True)

if preview:
    sc = scene
    sc.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_WORKBENCH'
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'
    sc.display.shading.color_type = 'MATERIAL'
    sc.display.shading.show_object_outline = True
    sc.display.shading.show_specular_highlight = True
    sc.render.resolution_x = 1100
    sc.render.resolution_y = 680
    sc.world = bpy.data.worlds.new('w')
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('c'))
    cam.data.lens = 55
    sc.collection.objects.link(cam)
    sc.camera = cam
    target = Vector((0, 0, H * 0.42))
    views = {'front34': Vector((L * 0.95, -L * 1.2, H * 1.1)), 'side': Vector((L * 1.75, 0, H * 0.5)),
             'rear34': Vector((-L * 0.95, L * 1.2, H * 1.2)), 'front': Vector((0, -L * 1.9, H * 0.55))}
    for name, pos in views.items():
        cam.location = pos
        cam.rotation_euler = (target - pos).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = preview.replace('.png', f'-{name}.png')
        bpy.ops.render.render(write_still=True)
