"""Stage 20: loft a body shell through character lines.

    Blender --background --factory-startup --python tools/blueprint-car/shell.py -- <car.json>

A car body is read the way a modeller reads it: a handful of longitudinal character
lines (sill, waist, shoulder, roof rail) running nose to tail, with simple curved
panels spanning between them. Each line is a 3D curve given by two drawings: its
height along the length from the side view and its half-width from the plan view.
They are authored in spec["body"]["lines"] (checked on the stage-15 trace sheets), or
taken from the stage-10 silhouettes:

    "side": [[y, z], ...]              authored height (Catmull-Rom through the points)
    "sideFrom": <curve>                a silhouette curve or an earlier line (+ "sideOffsetM")
    "plan": [[y, x], ...]              authored half-width
    "planFrom": <curve>                likewise (+ "planOffsetM")

Silhouette curves are "top", "bottom" and "planHalf" over spec["body"]["yRange"] (the
body without its bumpers); spec["body"]["floor"] may replace "bottom" with an authored
underside where the drawing hangs exhausts and brackets below the body.

The built-in lines "floorCentre" and "topCentre" sit on x = 0 at the bottom and top.
spec["body"]["ring"] lists line names in order around a half-section (bottom centre,
outward, up, back to top centre) and spec["body"]["panels"] gives, for each gap between
neighbours, {"n": interior points, "bulge": outward crown as a fraction of the gap}.
Every station has the same ring: grid rows are the character lines, and the result has
the edge flow of a hand-built low-poly body.

Wheel arches are cut from the outer skin only, leaving closed wells. Glass is
spec["body"]["glass"]: [{"panel": "<line>-<line>", "y": [y0, y1]}]. spec["body"]["parts"]
adds separate extruded pieces such as bumpers (see the parts block).

Writes <work>/20-shell/shell.glb and shell.json.
"""
import json
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import PX_PER_M, load_spec, read_mask, view_window  # noqa: E402

spec = load_spec(sys.argv[sys.argv.index('--') + 1])
body = spec['body']
factory = spec['factory']
refs = spec['_work'] / '10-refs'
out_dir = spec['_work'] / '20-shell'
out_dir.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
HALF_WIDTH_CAP = factory['widthM'] / 2


def axis_coords(view: str):
    """A view's mask with the metric coordinate of every column and row."""
    mask = read_mask(refs / f'{view}-mask.png')
    h0, h1, v0, v1 = view_window(spec, view)
    cols = h0 + (np.arange(mask.shape[1]) + 0.5) / PX_PER_M
    rows = v1 - (np.arange(mask.shape[0]) + 0.5) / PX_PER_M
    return mask, cols, rows


def median(values: np.ndarray, window: int) -> np.ndarray:
    """Sliding median: removes the drawing's pixel stair-steps, keeps real steps."""
    half = window // 2
    padded = np.pad(values, half, mode='edge')
    return np.median(np.lib.stride_tricks.sliding_window_view(padded, window), axis=1)


def simplify(xs: np.ndarray, curves: list[np.ndarray], tol: float, max_gap: float) -> list[int]:
    """Indices to keep so straight runs miss no curve by more than tol."""
    keep = [0]
    anchor = 0
    for i in range(2, len(xs)):
        span = slice(anchor, i + 1)
        t = (xs[span] - xs[anchor]) / (xs[i] - xs[anchor])
        worst = max(float(np.max(np.abs(c[span] - (c[anchor] + t * (c[i] - c[anchor])))))
                    for c in curves)
        if worst > tol or xs[i] - xs[anchor] > max_gap:
            anchor = i - 1
            keep.append(anchor)
    keep.append(len(xs) - 1)
    return sorted(set(keep))


# --- silhouette profiles -----------------------------------------------------------------
side, side_y, side_z = axis_coords('side')
wheels = body['wheels']
yy, zz = np.meshgrid(side_y, side_z)
for wheel in wheels:  # the drawing's tyres are not body
    side &= (yy - wheel['y']) ** 2 + (zz - wheel['z']) ** 2 > (wheel['radius'] + body.get('tyreGapM', 0.01)) ** 2
present = side.any(axis=0)
top = np.where(present, side_z[np.argmax(side, axis=0)], np.nan)
bottom = np.where(present, side_z[side.shape[0] - 1 - np.argmax(side[::-1], axis=0)], np.nan)
arch_top = bottom.copy()  # lowest body pixel over a wheel: the arch opening's edge
for wheel in wheels:
    span = np.abs(side_y - wheel['y']) <= wheel['archHalfSpanM']
    edge = np.flatnonzero(span)
    lo, hi = edge[0] - 1, edge[-1] + 1
    bottom[span] = np.interp(side_y[span], [side_y[lo], side_y[hi]], [bottom[lo], bottom[hi]])

plan, plan_y, plan_x = axis_coords('top')
assert np.allclose(plan_y, side_y), 'side and top grids must share the length axis'
plan_half = np.where(plan.any(axis=0), np.max(np.where(plan, np.abs(plan_x)[:, None], 0), axis=0), 0.0)
plan_half = np.minimum(plan_half, HALF_WIDTH_CAP)

y_front, y_rear = body['yRange']
cols = np.flatnonzero((side_y >= y_front) & (side_y <= y_rear))
window = body.get('profileMedianPx', 5)
smooth = body.get('profileSmoothPx', 9)
for curve in (top, bottom, plan_half):
    # Median first (drops pixel stairs, keeps real steps), then a short box average so
    # a 5 mm stair on a gentle slope does not shade as a ripple across the panel.
    curve[cols] = np.convolve(np.pad(median(curve[cols], window), smooth // 2, mode='edge'),
                              np.ones(smooth) / smooth, mode='valid')
Y = side_y[cols]
SILHOUETTE = {'top': top[cols], 'bottom': bottom[cols], 'planHalf': plan_half[cols]}
if 'floor' in body:  # an authored underside edge replaces a silhouette full of hangers
    floor_curve = np.array(sorted(body['floor']))
    SILHOUETTE['bottom'] = np.interp(Y, floor_curve[:, 0], floor_curve[:, 1])


def pchip(points: list[list[float]], at: np.ndarray) -> np.ndarray:
    """Monotone cubic (Fritsch-Carlson) through the points, evaluated at `at`.

    Unlike Catmull-Rom it never overshoots between points, so a roof authored as a
    few flat points stays flat instead of rippling between them.
    """
    p = np.array(sorted(points), dtype=float)
    xs, ys = p[:, 0], p[:, 1]
    if len(p) < 3:
        return np.interp(at, xs, ys)
    h = np.diff(xs)
    delta = np.diff(ys) / h
    m = np.zeros_like(ys)
    m[0], m[-1] = delta[0], delta[-1]
    for k in range(1, len(ys) - 1):
        if delta[k - 1] * delta[k] > 0:
            w1, w2 = 2 * h[k] + h[k - 1], h[k] + 2 * h[k - 1]
            m[k] = (w1 + w2) / (w1 / delta[k - 1] + w2 / delta[k])
    at = np.clip(at, xs[0], xs[-1])
    k = np.clip(np.searchsorted(xs, at, side='right') - 1, 0, len(xs) - 2)
    t = (at - xs[k]) / h[k]
    h00, h10 = 2 * t ** 3 - 3 * t ** 2 + 1, t ** 3 - 2 * t ** 2 + t
    h01, h11 = -2 * t ** 3 + 3 * t ** 2, t ** 3 - t ** 2
    return h00 * ys[k] + h10 * h[k] * m[k] + h01 * ys[k + 1] + h11 * h[k] * m[k + 1]


def resolve(line: dict, key: str) -> np.ndarray:
    """One coordinate of a line (height for 'side', half-width for 'plan') at every Y.

    `<key>From` names a silhouette curve or an earlier line, plus `<key>OffsetM`.
    """
    source = line.get(f'{key}From')
    if source:
        base = SILHOUETTE[source] if source in SILHOUETTE else LINES[source][0 if key == 'plan' else 1]
        return base + line.get(f'{key}OffsetM', 0.0)
    return pchip(line[key], Y)


# The centre lines follow the silhouette unless the spec authors them: a drawing's
# outline carries roof racks, aerials and pixel steps a body surface must not copy.
authored = body['lines']
LINES = {'floorCentre': (np.zeros_like(Y), resolve(authored['floorCentre'], 'side')
                         if 'floorCentre' in authored else SILHOUETTE['bottom']),
         'topCentre': (np.zeros_like(Y), resolve(authored['topCentre'], 'side')
                       if 'topCentre' in authored else SILHOUETTE['top'])}
SILHOUETTE['bottom'], SILHOUETTE['top'] = LINES['floorCentre'][1], LINES['topCentre'][1]
for name, line in authored.items():  # in order: a line may derive from an earlier one
    if name not in ('floorCentre', 'topCentre'):
        LINES[name] = (np.minimum(resolve(line, 'plan'), HALF_WIDTH_CAP), resolve(line, 'side'))
ring = body['ring']
panels = body['panels']
assert ring[0] == 'floorCentre' and ring[-1] == 'topCentre' and len(panels) == len(ring) - 1
# Nothing may rise above the roof or sink below the floor at any station.
for name in ring[1:-1]:
    x, z = LINES[name]
    LINES[name] = (x, np.clip(z, SILHOUETTE['bottom'], SILHOUETTE['top']))

keep = simplify(Y, [c for name in ring for c in LINES[name]],
                body.get('stationTolM', 0.006), body.get('stationMaxGapM', 0.12))
stations = [int(i) for i in keep]


def panel_points(a: np.ndarray, b: np.ndarray, n: int, bulge: float) -> list[np.ndarray]:
    """n interior points on a quadratic arc from a to b, crowned outward by bulge."""
    d = b - a
    length = float(np.hypot(*d))
    control = (a + b) / 2 + np.array([d[1], -d[0]]) / max(length, 1e-9) * bulge * length
    return [(1 - t) ** 2 * a + 2 * (1 - t) * t * control + t * t * b
            for t in (np.arange(1, n + 1) / (n + 1))]


def section(i: int) -> tuple[list[np.ndarray], list[int]]:
    """Half-section points and, per point, the index of the panel it belongs to."""
    points, owner = [], []
    corners = [np.array([LINES[name][0][i], LINES[name][1][i]]) for name in ring]
    for k, (a, b) in enumerate(zip(corners, corners[1:])):
        points.append(a)
        owner.append(k)
        for p in panel_points(a, b, panels[k]['n'], panels[k].get('bulge', 0.0)):
            points.append(p)
            owner.append(k)
    points.append(corners[-1])
    owner.append(len(panels) - 1)
    return points, owner


# --- build the half shell, mirror, weld --------------------------------------------------
bm = bmesh.new()
rings, owners = [], None
for i in stations:
    pts, owners = section(i)
    rings.append([bm.verts.new((float(p[0]), float(Y[i]), float(p[1]))) for p in pts])
panel_layer = bm.faces.layers.int.new('panel')
for a, b in zip(rings, rings[1:]):
    for k in range(len(a) - 1):
        face = bm.faces.new((a[k], a[k + 1], b[k + 1], b[k]))
        face[panel_layer] = owners[k]
for cap in (rings[0], rings[-1][::-1]):  # nose and tail faces
    face = bm.faces.new(cap)
    face[panel_layer] = -1
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-4)


def material(name: str, color) -> bpy.types.Material:
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.diffuse_color = color
    mat.use_nodes = True
    mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = color
    return mat


def inside(polygon: list[list[float]], y: float, z: float) -> bool:
    hit = False
    for (y0, z0), (y1, z1) in zip(polygon, polygon[1:] + polygon[:1]):
        if (z0 > z) != (z1 > z) and y < y0 + (z - z0) * (y1 - y0) / (z1 - z0):
            hit = not hit
    return hit


MATERIALS = [material('car_paint', (0.24, 0.32, 0.13, 1)),
             material('car_trim', (0.07, 0.075, 0.08, 1)),
             material('car_glass', (0.055, 0.10, 0.15, 1))]
PAINT, TRIM, GLASS = range(3)
panel_index = {f'{a}-{b}': k for k, (a, b) in enumerate(zip(ring, ring[1:]))}
# Glass. A region is a panel over a y span, or -- for side windows -- a panel and the
# window's drawn outline in the side view, [[y, z], ...]. Outline edges are cut into
# the panel first (planes along x through each edge), so the glass has the drawn
# shape and the paint around it forms real pillars and frames.
for region in body.get('glass', []):
    if 'outline' not in region:
        continue
    outline = region['outline']
    for (y0, z0), (y1, z1) in zip(outline, outline[1:] + outline[:1]):
        faces = [f for f in bm.faces if f[panel_layer] == panel_index[region['panel']]]
        geom = list({v for f in faces for v in f.verts}) + list({e for f in faces for e in f.edges}) + faces
        normal = Vector((0.0, -(z1 - z0), y1 - y0)).normalized()
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0.0, y0, z0), plane_no=normal, dist=1e-5)
for face in bm.faces:
    c = face.calc_center_median()
    face.material_index = PAINT
    for region in body.get('glass', []):
        if face[panel_layer] != panel_index[region['panel']]:
            continue
        if ('outline' in region and inside(region['outline'], c.y, c.z)) or \
                ('y' in region and region['y'][0] <= c.y <= region['y'][1]):
            face.material_index = GLASS
mirror = bmesh.ops.duplicate(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:])
for element in mirror['geom']:
    if isinstance(element, bmesh.types.BMVert):
        element.co.x = -element.co.x
bmesh.ops.reverse_faces(bm, faces=[g for g in mirror['geom'] if isinstance(g, bmesh.types.BMFace)])
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

mesh = bpy.data.meshes.new('body')
bm.to_mesh(mesh)
bm.free()
for mat in MATERIALS:
    mesh.materials.append(mat)
shell = bpy.data.objects.new('body', mesh)
bpy.context.scene.collection.objects.link(shell)

# --- wheel arches: cut the outer skin only, leaving a closed well -----------------------
for index, wheel in enumerate(wheels):
    span = np.abs(side_y - wheel['y']) <= wheel['archHalfSpanM']
    ys = side_y[span]
    opening = np.minimum(arch_top[span], wheel['z'] + wheel['radius'] + 0.15)
    # Where the drawn opening barely clears the body's underside (the arch's feet, pixel
    # noise), cut nothing: otherwise the cutter leaves a thin vertical notch there.
    floor_here = np.interp(ys, Y, SILHOUETTE['bottom'])
    opening = np.where(opening > floor_here + 0.03, opening, floor_here - 0.01)
    kept = simplify(ys, [opening], 0.003, 0.05)
    outline = ([(float(ys[0]), -0.2)] + [(float(ys[i]), float(opening[i])) for i in kept]
               + [(float(ys[-1]), -0.2)])
    for side_sign in (1, -1):
        inner = HALF_WIDTH_CAP - wheel['wellDepthM']
        cutter_bm = bmesh.new()
        near = [cutter_bm.verts.new((side_sign * inner, y, z)) for y, z in outline]
        far = [cutter_bm.verts.new((side_sign * (HALF_WIDTH_CAP + 0.2), y, z)) for y, z in outline]
        cutter_bm.faces.new(near)
        cutter_bm.faces.new(far[::-1])
        for i in range(len(outline)):
            j = (i + 1) % len(outline)
            cutter_bm.faces.new((near[j], near[i], far[i], far[j]))
        bmesh.ops.recalc_face_normals(cutter_bm, faces=cutter_bm.faces)
        cutter_mesh = bpy.data.meshes.new(f'arch{index}{side_sign}')
        cutter_bm.to_mesh(cutter_mesh)
        cutter_bm.free()
        cutter_mesh.materials.append(MATERIALS[TRIM])
        cutter = bpy.data.objects.new(cutter_mesh.name, cutter_mesh)
        bpy.context.scene.collection.objects.link(cutter)
        modifier = shell.modifiers.new('arch', 'BOOLEAN')
        modifier.operation = 'DIFFERENCE'
        modifier.solver = 'EXACT'
        modifier.object = cutter
        modifier.material_mode = 'TRANSFER'
        bpy.context.view_layer.objects.active = shell
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        bpy.data.objects.remove(cutter, do_unlink=True)

# --- attached parts ---------------------------------------------------------------------
# spec["body"]["parts"] entries are one of:
#   {"name", "material", "side": [[y, z], ...], "plan": [[y, x], ...] | "planOffsetM"}
#       a side-view section (closed) extruded across the car; each vertex runs out to the
#       plan half-width at its own y, so a bumper's ends follow the drawn wrap-around.
#   {"name", "material", "box": {"x": [x0, x1], "y": [y0, y1], "z": [z0, z1]}, "mirror"}
#       an axis-aligned block -- a lamp lens, a grille -- copied to -x when "mirror".
# The nose and tail features are placed from the end-view trace sheets. Lamp materials
# use the names the lamp stage binds (Headlights, IndicatorLights, TailLights, ...).
LAMP_COLOURS = {'Headlights': (0.72, 0.76, 0.74, 1), 'IndicatorLights': (0.887, 0.136, 0.008, 1),
                'TailLights': (0.24, 0.006, 0.003, 1), 'ReverseLights': (0.78, 0.80, 0.76, 1)}


def part_material(name: str) -> bpy.types.Material:
    known = {'car_paint': PAINT, 'car_trim': TRIM, 'car_glass': GLASS}
    return MATERIALS[known[name]] if name in known else material(name, LAMP_COLOURS[name])


full_plan_y, full_plan_half = side_y, plan_half
for part in body.get('parts', []):
    pbm = bmesh.new()
    if 'box' in part:
        box = part['box']
        for sign in ((1, -1) if part.get('mirror') else (1,)):
            xs = sorted(sign * x for x in box['x'])
            centre = ((xs[0] + xs[1]) / 2, sum(box['y']) / 2, sum(box['z']) / 2)
            size = (xs[1] - xs[0], box['y'][1] - box['y'][0], box['z'][1] - box['z'][0], 1.0)
            bmesh.ops.create_cube(pbm, size=1.0,
                                  matrix=Matrix.Translation(centre) @ Matrix.Diagonal(size))
    else:
        outline = part['side']
        if 'plan' in part:
            plan_curve = np.array(sorted(part['plan']))
            halves = [float(np.interp(y, plan_curve[:, 0], plan_curve[:, 1])) for y, _ in outline]
        else:
            halves = [float(np.interp(y, full_plan_y, full_plan_half)) + part.get('planOffsetM', 0.0)
                      for y, _ in outline]
        left = [pbm.verts.new((h, y, z)) for (y, z), h in zip(outline, halves)]
        right = [pbm.verts.new((-h, y, z)) for (y, z), h in zip(outline, halves)]
        pbm.faces.new(left)
        pbm.faces.new(right[::-1])
        for i in range(len(outline)):
            j = (i + 1) % len(outline)
            pbm.faces.new((left[j], left[i], right[i], right[j]))
    bmesh.ops.recalc_face_normals(pbm, faces=pbm.faces)
    part_mesh = bpy.data.meshes.new(part['name'])
    pbm.to_mesh(part_mesh)
    pbm.free()
    part_mesh.materials.append(part_material(part.get('material', 'car_trim')))
    part_object = bpy.data.objects.new(part['name'], part_mesh)
    bpy.context.scene.collection.objects.link(part_object)

bpy.context.view_layer.objects.active = shell
shell.select_set(True)
bpy.ops.object.shade_smooth_by_angle(angle=np.radians(body.get('smoothAngleDeg', 35)))

result = out_dir / 'shell.glb'
bpy.ops.export_scene.gltf(filepath=str(result), export_format='GLB', export_apply=True,
    export_materials='EXPORT', export_cameras=False, export_lights=False,
    export_animations=False, export_normals=True)
tris = sum(len(p.vertices) - 2 for p in mesh.polygons)
(out_dir / 'shell.json').write_text(json.dumps({
    'stations': len(stations), 'ringPoints': len(owners), 'triangles': tris,
    'yRange': [round(float(Y[stations[0]]), 4), round(float(Y[stations[-1]]), 4)],
}, indent=2) + '\n')
print('SHELL', len(stations), 'stations', len(owners), 'ring points', tris, 'triangles')
