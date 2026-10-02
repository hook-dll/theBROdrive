"""Toy bodies: low-poly cars after real ones, recognisable rather than exact.

    blender --background --factory-startup --python tools/carshape/toy/toy.py -- <car> <out.glb> [preview.png]

A body is a handful of cross-sections lofted with straight faces (flat-shaded, chamfered
where a real car is round); the glasshouse is a second loft whose window faces are set
in, framed by the faces round them, so glass is geometry and lines up by construction;
lamps, grilles, bumpers, mirrors and handles are blocks standing on the surface, placed
from the section (the body's side is where the section says it is). Factory figures come
from the blueprint car file (tools/carshape/bp/cars/<car>.py); the shape from
tools/carshape/toy/cars/<car>.py, TOY:

  body    [{y, yTop?, w, sill, sh, top, crown?, tumble?, ch?}, ...]  sections, nose to tail:
          w the side's half-width, sill its foot, sh where the upright side ends, top the
          deck on the centre line; tumble how far the deck's edge stands in, ch the
          chamfer there; yTop leans the station (the nose's and tail's slope)
  house   [{y, belt, bw, gutter, rw, roof}, ...]  the glasshouse's sections: its foot at
          the belt, bw wide; the roof's edge at gutter, rw wide; the roof on the centre
          line. The first two stations are the screen's foot and head, the last two the
          back light's head and foot
  windows [[y0, y1], ...]  side windows between house stations; frame (inset)
  parts   lamps, grilles, panels, bumpers, mirror, handles, seams, fenders, boards
Writes a glb with the runtime's nodes (paint, glass, trim, the lamp nodes, wheels).
"""
import math
import os
import runpy
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:]
car, out_glb = argv[0], argv[1]
preview = argv[2] if len(argv) > 2 else None
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
T = runpy.run_path(os.path.join(HERE, 'cars', car + '.py'))['TOY']
F = runpy.run_path(os.path.join(ROOT, 'tools/carshape/bp/cars', T.get('factoryFrom', car) + '.py'))['CAR']['factory']
L, W, H, R = F['length'], F['width'], F['height'], F['wheelRadius']
C = F['clearance']
YA = -L / 2 + F['frontOverhang']
YB = YA + F['wheelbase']
AXLES = [(YA, F['frontTrack']), (YB, F['rearTrack'])]

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def material(name, rgb, rough=0.6, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    m.diffuse_color = (*rgb, 1)
    return m


MAT = {
    'paint': material('car_paint', (0.62, 0.12, 0.08), 0.45),
    'glass': material('car_glass', (0.05, 0.07, 0.09), 0.1),
    'trim': material('car_trim', (0.05, 0.05, 0.055), 0.7),
    'grille': material('trim_grille', (0.02, 0.02, 0.022), 0.8),
    'chrome': material('car_chrome', (0.72, 0.73, 0.75), 0.25, 0.9),
    'canvas': material('trim_canvas', (0.07, 0.07, 0.075), 0.9),
    'Headlights': material('Headlights', (0.85, 0.86, 0.82), 0.25),
    'TailLights': material('TailLights', (0.55, 0.04, 0.03), 0.35),
    'IndicatorLights': material('IndicatorLights', (0.95, 0.5, 0.05), 0.35),
    'ReverseLights': material('ReverseLights', (0.9, 0.9, 0.9), 0.35),
    'Tyres': material('Tyres', (0.04, 0.04, 0.04), 0.9),
    'wheel_rim': material('wheel_rim', (0.75, 0.76, 0.78), 0.35, 0.3),
}
for k, rgb in T.get('colours', {}).items():
    MAT[k] = material(k, tuple(rgb))
LAMP_NODES = {'headlights', 'taillights', 'reverse_lights', 'front_blinker_left', 'front_blinker_right',
              'rear_blinker_left', 'rear_blinker_right'}


def lerp_station(st, y, keys):
    """Linear between the given stations (straight faces between them)."""
    st = sorted(st, key=lambda s: s['y'])
    if y <= st[0]['y']:
        return {k: st[0][k] for k in keys}
    for a, b in zip(st, st[1:]):
        if a['y'] <= y <= b['y']:
            f = (y - a['y']) / max(b['y'] - a['y'], 1e-9)
            return {k: a[k] + (b[k] - a[k]) * f for k in keys}
    return {k: st[-1][k] for k in keys}


BODY_DEF = {'crown': 0.02, 'tumble': 0.04, 'ch': 0.04, 'lch': 0.035}
for s in T['body']:
    for k, v in BODY_DEF.items():
        s.setdefault(k, T.get('bodyDefaults', {}).get(k, v))
    s.setdefault('yTop', s['y'])
BKEYS = ['w', 'sill', 'sh', 'top', 'crown', 'tumble', 'ch', 'lch', 'yTop']


def body_half(p):
    """Half section from the floor's centre out, up the side, over the deck."""
    w, sill, sh, top = p['w'], p['sill'], p['sh'], p['top']
    e = top - p['crown']
    xe = w - p['tumble']
    return [(0.0, sill), (w - p['lch'], sill), (w, sill + p['lch']), (w, sh),
            (xe + p['ch'] * 0.3, e - p['ch']), (xe - p['ch'], e), (xe * 0.5, top - p['crown'] * 0.25), (0.0, top)]


def body_x_at(y, z):
    """The body's half-width at (y, z): where to stand a part on its side."""
    p = lerp_station(T['body'], y, BKEYS)
    hp = body_half(p)
    for (x0, z0), (x1, z1) in zip(hp, hp[1:]):
        if min(z0, z1) <= z <= max(z0, z1) and abs(z1 - z0) > 1e-6:
            return x0 + (x1 - x0) * (z - z0) / (z1 - z0)
    return p['w']


def ring_from_half(half, y, y_top=None, z0=None, z1=None):
    pts = []
    for x, z in half:
        yy = y
        if y_top is not None and z1 is not None and z1 > z0:
            yy = y + (y_top - y) * (z - z0) / (z1 - z0)
        pts.append((x, yy, z))
    return pts + [(-x, yy, z) for x, yy, z in pts[-2:0:-1]]


def loft(bm, rings, mat):
    """Faces between consecutive rings; the ends capped. Returns the face grid."""
    n = len(rings[0])
    vs = [[bm.verts.new(p) for p in r] for r in rings]
    grid = []
    for a, b in zip(vs, vs[1:]):
        row = []
        for k in range(n):
            k2 = (k + 1) % n
            q = (a[k], a[k2], b[k2], b[k])
            if len({v.co.to_tuple(5) for v in q}) < 3:
                row.append(None)
                continue
            try:
                f = bm.faces.new(q)
                f.material_index = mat
            except ValueError:
                f = None
            row.append(f)
        grid.append(row)
    for r in (vs[0], vs[-1]):
        try:
            f = bm.faces.new(r)
            f.material_index = mat
        except ValueError:
            pass
    return grid


SLOTS = ['paint', 'glass', 'trim', T.get('houseMaterial', 'paint')]
bm = bmesh.new()

# ---- body ---------------------------------------------------------------------------
body_rings = []
for s in sorted(T['body'], key=lambda s: s['y']):
    half = body_half(s)
    body_rings.append(ring_from_half(half, s['y'], s['yTop'], s['sill'], s['top']))
loft(bm, body_rings, 0)
body_bm = bm

# Fenders standing off a narrow body (the Beetle's): closed D-sections lofted along the
# wheel, [(y from the axle, height 0..1)], from the foot to the top, xIn (buried in the
# body) to xOut; part of the body, so the wells cut through them.
for d in T.get('fenders', []):
    ya = AXLES[0][0] if d['axle'] == 'front' else AXLES[1][0]
    for s_ in (1, -1):
        rings = []
        for y_, k in d['profile']:
            zt = d['foot'] + (d['top'] - d['foot']) * k
            zt = max(zt, d['foot'] + 0.02)
            xo, xi = d['xOut'], d['xIn']
            rnd = min(0.08, (zt - d['foot']) * 0.4)
            half = [(xi, d['foot']), (xo - 0.03, d['foot']), (xo, d['foot'] + min(0.04, rnd)),
                    (xo, zt - rnd), (xo - rnd * 0.9, zt), (xi, zt)]
            rings.append([(s_ * x, ya + y_, z) for x, z in half])
        vs = [[bm.verts.new(p) for p in r] for r in rings]
        m_ = len(rings[0])
        for r0, r1 in zip(vs, vs[1:]):
            for j in range(m_):
                q = (r0[j], r0[(j + 1) % m_], r1[(j + 1) % m_], r1[j])
                bm.faces.new(q if s_ > 0 else q[::-1])
        bm.faces.new(vs[0][::-1] if s_ > 0 else vs[0])
        bm.faces.new(vs[-1] if s_ > 0 else vs[-1][::-1])

# Wheel wells: cut with low-poly drums.
arch = T.get('arch', {})


def drum_obj(name, ya, track):
    ra = arch.get('radius', R * 1.12)
    za = R + arch.get('lift', 0.03)
    x_in = track / 2 - F['tyreWidth'] / 2 - arch.get('inset', 0.04)
    b = bmesh.new()
    for s_ in (1, -1):
        r = bmesh.ops.create_cone(b, cap_ends=True, segments=arch.get('segments', 14), radius1=ra, radius2=ra, depth=1.0)
        rot = Matrix.Rotation(math.radians(90), 4, 'Y')
        bmesh.ops.transform(b, matrix=Matrix.Translation((s_ * (x_in + 0.5), ya, za)) @ rot, verts=r['verts'])
        r = bmesh.ops.create_cube(b, size=1.0)
        bmesh.ops.transform(b, matrix=Matrix.Translation((s_ * (x_in + 0.5), ya, za / 2 - 0.05)) @ Matrix.Diagonal((1.0, 2 * ra, za + 0.1, 1)),
                            verts=r['verts'])
    me = bpy.data.meshes.new(name)
    b.to_mesh(me)
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    return o


def new_object(name, b, mats):
    me = bpy.data.meshes.new(name)
    b.normal_update()
    b.to_mesh(me)
    b.free()
    for m in mats:
        me.materials.append(MAT[m])
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    return o


bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
body = new_object('paint', bm, SLOTS)
if not arch.get('none'):
    for i, (ya, tr) in enumerate(AXLES):
        if arch.get('skip', {}).get(('front', 'rear')[i]):
            continue
        d = drum_obj(f'drum{i}', ya, tr)
        mod = body.modifiers.new('arch', 'BOOLEAN')
        mod.operation = 'DIFFERENCE'
        mod.object = d
        mod.solver = 'EXACT'
        mod.use_self = True
        mod.use_hole_tolerant = True
        bpy.context.view_layer.objects.active = body
        bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.data.objects.remove(d)

# ---- glasshouse ---------------------------------------------------------------------
HKEYS = ['belt', 'bw', 'gutter', 'rw', 'roof']
hs = sorted(T['house'], key=lambda s: s['y'])


def house_half(p):
    base = p['belt'] - 0.08
    return [(0.0, base), (p['bw'], base), (p['bw'], p['belt']), (p['rw'], p['gutter']),
            (p['rw'] * 0.55, p['roof'] - (p['roof'] - p['gutter']) * 0.2), (0.0, p['roof'])]


hb = bmesh.new()
house_rings = [ring_from_half(house_half(s), s['y']) for s in hs]
grid = loft(hb, house_rings, 3)
n = len(house_rings[0])
# Index of each face round the ring: 0 floor, 1 lower wall (buried), 2 window band, 3, 4 roof
# right; mirrored after.
half_n = len(house_half(hs[0]))
side_k = [2, n - 3]                   # the window band, right and left
top_k = [3, 4, n - 5, n - 4]          # roof (or screen / back light) across
frame = T.get('frame', 0.035)


def inset(faces, f, depth=-0.012):
    faces = [x for x in faces if x is not None and x.is_valid]
    if not faces:
        return []
    r = bmesh.ops.inset_region(hb, faces=faces, thickness=f, depth=depth, use_even_offset=True)
    for x in faces:
        x.material_index = 1
    return faces


# The screen: the roof faces between its foot and head; the back light: between the last two.
inset([grid[0][k] for k in top_k], T.get('screenFrame', 0.05))
if T.get('backLight', True):
    bl = T.get('backLightFrame', 0.06)
    inset([grid[-1][k] for k in top_k], bl)
# Side windows: the window band between the stations they span.
ys = [s['y'] for s in hs]
for y0, y1 in T.get('windows', []):
    i0, i1 = ys.index(y0), ys.index(y1)
    for k in side_k:
        inset([grid[i][k] for i in range(i0, i1)], frame)
bmesh.ops.recalc_face_normals(hb, faces=hb.faces)
house = new_object('house', hb, SLOTS)

# ---- parts --------------------------------------------------------------------------
PARTS = {}            # node -> bmesh


def part(node):
    if node not in PARTS:
        PARTS[node] = (bmesh.new(), [])
    return PARTS[node]


def slot(node, mat):
    b, mats = part(node)
    if mat not in mats:
        mats.append(mat)
    return b, mats.index(mat)


def box(b, c, size, mi, rot=None):
    r = bmesh.ops.create_cube(b, size=1.0)
    m = Matrix.Translation(Vector(c))
    if rot is not None:
        m = m @ rot
    bmesh.ops.transform(b, matrix=m @ Matrix.Diagonal((*size, 1)), verts=r['verts'])
    for f in {f for v in r['verts'] for f in v.link_faces}:
        f.material_index = mi


def cyl(b, c, axis, r_, depth, seg, mi, r2=None):
    res = bmesh.ops.create_cone(b, cap_ends=True, segments=seg, radius1=r_, radius2=r_ if r2 is None else r2, depth=depth)
    rot = Vector((0, 0, 1)).rotation_difference(Vector(axis)).to_matrix().to_4x4()
    bmesh.ops.transform(b, matrix=Matrix.Translation(Vector(c)) @ rot, verts=res['verts'])
    for f in {f for v in res['verts'] for f in v.link_faces}:
        f.material_index = mi


def end_y(end, x, z):
    """Where the body's end face is at (x, z): the outermost station that reaches z."""
    st = sorted(T['body'], key=lambda s: s['y'])
    s = st[0] if end == 'front' else st[-1]
    f = (z - s['sill']) / max(s['top'] - s['sill'], 1e-6)
    return s['y'] + (s['yTop'] - s['y']) * min(max(f, 0), 1)


def sides(d, node):
    """Mirrored about the centre line unless the node names a side or mirror is off."""
    if node.endswith('_left'):
        return (1,)
    if node.endswith('_right'):
        return (-1,)
    return (1, -1) if d.get('mirror', True) and abs(d.get('x', 0)) > 1e-6 else (1,)


# End pieces: lamps, grilles, panels on the nose or tail. {end, x, z, w, h | r, node,
# material, shape: rect|round, proud}
for d in T.get('ends', []):
    node = d.get('node', 'trim')
    b, mi = slot(node, d.get('material', 'trim'))
    sgn = -1 if d['end'] == 'front' else 1
    for s_ in sides(d, node):
        x = s_ * d.get('x', 0.0)
        y = end_y(d['end'], abs(x), d['z']) + sgn * d.get('proud', 0.012)
        dep = d.get('depth', 0.04)
        if d.get('shape') == 'round':
            cyl(b, (x, y - sgn * dep / 2, d['z']), (0, 1, 0), d['r'], dep, d.get('seg', 12), mi)
        else:
            box(b, (x, y - sgn * dep / 2, d['z']), (d['w'], dep, d['h']), mi)

# Bumpers: {end, z0, z1, depth, proud, wrap, material, half (half-width)}
for d in T.get('bumpers', []):
    b, mi = slot('trim', d.get('material', 'chrome'))
    sgn = -1 if d['end'] == 'front' else 1
    zc, h = (d['z0'] + d['z1']) / 2, d['z1'] - d['z0']
    y = end_y(d['end'], 0, zc) + sgn * d.get('proud', 0.03)
    hw = d.get('half', W / 2 - 0.02)
    dep = d.get('depth', 0.07)
    box(b, (0, y - sgn * dep / 2, zc), (2 * hw, dep, h), mi)
    wr = d.get('wrap', 0.12)
    for s_ in (1, -1):
        box(b, (s_ * (hw - dep / 2), y - sgn * (wr / 2), zc), (dep, wr, h), mi)

# Side pieces on the flanks: {y, z, w (along), h, proud, material, node}: handles,
# side lamps, mouldings.
Y_NOSE = min(s['y'] for s in T['body'])
Y_TAIL = max(s['y'] for s in T['body'])
for d in T.get('flank', []):
    node = d.get('node', 'trim')
    b, mi = slot(node, d.get('material', 'chrome'))
    # A long one (a moulding) is laid in pieces, each on the side where it is, and
    # stops short of the ends and the arches' cut.
    y0, y1 = d['y'] - d['w'] / 2, d['y'] + d['w'] / 2
    y0, y1 = max(y0, Y_NOSE + 0.08), min(y1, Y_TAIL - 0.08)
    n_ = max(1, int((y1 - y0) / 0.15))
    for s_ in sides(dict(d, x=1), node):
        for i in range(n_):
            ya_, yb_ = y0 + (y1 - y0) * i / n_, y0 + (y1 - y0) * (i + 1) / n_
            yc = (ya_ + yb_) / 2
            if any(abs(yc - ax) < R * 1.12 + 0.03 and d['z'] < R + 0.03 + R * 1.12 for ax, _ in AXLES):
                continue
            x = body_x_at(yc, d['z'])
            pr = d.get('proud', 0.006)
            box(b, (s_ * (x + pr / 2), yc, d['z']), (pr + 0.01, yb_ - ya_ + 0.002, d['h']), mi)

# Seams: a door's outline as thin dark strips on the flank. {y0, y1, z0, z1}
for d in T.get('seams', []):
    b, mi = slot('trim', 'trim')
    t_ = 0.006
    for s_ in (1, -1):
        for yy, zz, ly, lz in ((d['y0'], (d['z0'] + d['z1']) / 2, t_, d['z1'] - d['z0']),
                               (d['y1'], (d['z0'] + d['z1']) / 2, t_, d['z1'] - d['z0']),
                               ((d['y0'] + d['y1']) / 2, d['z0'], d['y1'] - d['y0'], t_)):
            x = body_x_at(yy, zz)
            box(b, (s_ * (x + 0.001), yy, zz), (0.006, ly, lz), mi)

# Mirror: {y, z, w, h, d, arm, material}: a block on a short arm off the door.
mr = T.get('mirror')
if mr:
    b, mi = slot('trim', mr.get('material', 'trim'))
    _, gi = slot('trim', 'chrome')
    for s_ in (1, -1):
        x0 = body_x_at(mr['y'], mr['z'] - 0.02)
        arm = mr.get('arm', 0.06)
        w_, h_, d_ = mr.get('w', 0.14), mr.get('h', 0.09), mr.get('d', 0.06)
        box(b, (s_ * (x0 + arm / 2), mr['y'] + 0.01, mr['z'] - 0.01), (arm + 0.02, 0.04, 0.03), mi)
        xc = s_ * (x0 + arm + w_ / 2)
        box(b, (xc, mr['y'], mr['z'] + h_ / 2 - 0.02), (w_, d_, h_), mi)
        box(b, (xc, mr['y'] + d_ / 2 + 0.002, mr['z'] + h_ / 2 - 0.02), (w_ * 0.82, 0.006, h_ * 0.75), gi)

for d in T.get('boards', []):
    b, mi = slot('trim', d.get('material', 'trim'))
    for s_ in (1, -1):
        box(b, (s_ * d['x'], (d['y0'] + d['y1']) / 2, d['z']), (d['w'], d['y1'] - d['y0'], 0.03), mi)

# Free blocks given outright: {c, size, material, node, mirror}
for d in T.get('blocks', []):
    node = d.get('node', 'trim')
    b, mi = slot(node, d.get('material', 'trim'))
    xs = (1, -1) if d.get('mirror') else (1,)
    for s_ in xs:
        c = d['c']
        if d.get('round'):
            cyl(b, (s_ * c[0], c[1], c[2]), d.get('axis', (0, 1, 0)), d['r'], d['depth'], d.get('seg', 12), mi)
        else:
            box(b, (s_ * c[0], c[1], c[2]), d['size'], mi)

# Underside: the sump (the engine's end) and a rear axle and diff on a driven rear axle,
# at the published clearance; the body's floor is its sill.
ub = T.get('underbody', {})
b, mi = slot('trim', 'trim')
s0 = min(s['sill'] for s in T['body'])
ye = YB if ub.get('engine') == 'rear' else YA
box(b, (0, ye + 0.05, (C + s0 + 0.03) / 2), (0.34, 0.4, s0 + 0.03 - C), mi)
if ub.get('rearDrive', True) and ub.get('engine') != 'rear':
    cyl(b, (0, YB, R), (1, 0, 0), 0.045, AXLES[1][1] - F['tyreWidth'] - 0.08, 10, mi)
    box(b, (0, YB, (C + 0.005 + R + 0.1) / 2), (0.28, 0.24, R + 0.1 - C - 0.005), mi)

part_objs = {node: new_object(node, b, mats) for node, (b, mats) in PARTS.items()}

# ---- wheels -------------------------------------------------------------------------
wh = T.get('wheel', {})
tw = F['tyreWidth']
seg = wh.get('segments', 16)
for name, (ya, track), side in (('wheel_fl', AXLES[0], 1), ('wheel_fr', AXLES[0], -1),
                                ('wheel_rl', AXLES[1], 1), ('wheel_rr', AXLES[1], -1)):
    b = bmesh.new()
    rim = R * wh.get('rim', 0.6)
    prof = [(rim, -side * tw / 2), (R * 0.9, -side * tw / 2), (R, -side * tw * 0.35), (R, side * tw * 0.35),
            (R * 0.9, side * tw / 2), (rim, side * tw / 2)]
    rings = []
    for k in range(seg):
        a = 2 * math.pi * k / seg
        rings.append([b.verts.new((x, r * math.cos(a), r * math.sin(a))) for r, x in prof])
    for k in range(seg):
        r0, r1 = rings[k], rings[(k + 1) % seg]
        for j in range(len(prof) - 1):
            f = b.faces.new((r0[j], r0[j + 1], r1[j + 1], r1[j]))
            f.material_index = 0
    # the face: a dished disc and a cap
    for sgn_x, rr, dx, mi_ in ((1, rim, -0.012, 1), (1, rim * wh.get('cap', 0.45), 0.004, 1)):
        cyl(b, (side * (tw / 2 + dx), 0, 0), (1, 0, 0), rr, 0.02, seg, mi_)
    o = new_object(name, b, ['Tyres', 'wheel_rim'])
    o.location = (side * track / 2, ya, R)

# ---- join, shade, export ------------------------------------------------------------
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
house.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
# Glass into its own node.
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='DESELECT')
body.active_material_index = 1
bpy.ops.object.material_slot_select()
bpy.ops.mesh.separate(type='SELECTED')
bpy.ops.object.mode_set(mode='OBJECT')
for o in list(scene.objects):
    if o.name.startswith('paint.'):
        o.name = 'glass'
        o.data.name = 'glass'
join = [o for n_, o in part_objs.items() if n_ not in LAMP_NODES]
if join:
    bpy.ops.object.select_all(action='DESELECT')
    for o in join:
        o.select_set(True)
    bpy.context.view_layer.objects.active = join[0]
    bpy.ops.object.join()
    join[0].name = 'trim'
    join[0].data.name = 'trim'
for o in scene.objects:
    if o.type != 'MESH':
        continue
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    if o.name.startswith('wheel_'):
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(50))
    else:
        bpy.ops.object.shade_flat()
    for p_ in o.data.polygons:
        pass

lo = Vector((1e9,) * 3)
hi = -lo
for o in scene.objects:
    if o.type != 'MESH' or o.name.startswith('wheel_'):
        continue
    for v in o.data.vertices:
        w_ = o.matrix_world @ v.co
        lo = Vector(map(min, lo, w_))
        hi = Vector(map(max, hi, w_))
faces = sum(len(o.data.polygons) for o in scene.objects if o.type == 'MESH')
print(f'TOY {car}: {faces} faces; height {(H - C) / (hi.z - lo.z):.3f} length {L / (hi.y - lo.y):.3f} '
      f'(bottom {lo.z:.3f} top {hi.z:.3f} nose {lo.y:.3f} tail {hi.y:.3f} half-width {max(abs(lo.x), hi.x):.3f})')
bpy.ops.export_scene.gltf(filepath=out_glb, export_format='GLB', export_yup=True, export_apply=True)

if preview:
    sc = scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'
    sc.display.shading.color_type = 'MATERIAL'
    sc.display.shading.show_object_outline = True
    sc.render.resolution_x, sc.render.resolution_y = 1100, 680
    sc.world = bpy.data.worlds.new('w')
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('c'))
    cam.data.lens = 55
    sc.collection.objects.link(cam)
    sc.camera = cam
    target = Vector((0, 0, H * 0.45))
    views = {'front34': (Vector((L * 0.95, -L * 1.2, H * 1.1)), target), 'rear34': (Vector((-L * 0.95, L * 1.2, H * 1.2)), target),
             'side': (Vector((L * 1.75, 0, H * 0.5)), target), 'front': (Vector((0, -L * 1.9, H * 0.55)), target),
             'lowrear': (Vector((-W * 0.9, L * 1.05, 0.42)), Vector((0, L * 0.3, H * 0.32))),
             'close': (Vector((1.5, -2.3, H + 0.5)), Vector((0.45, -0.3, H * 0.7)))}
    for name, (pos, aim) in views.items():
        cam.location = pos
        cam.rotation_euler = (aim - pos).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = preview.replace('.png', f'-{name}.png')
        bpy.ops.render.render(write_still=True)
