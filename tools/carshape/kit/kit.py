"""Kit bodies: low-poly cars built the way the soviet pack's are (public/models/soviet).

    blender --background --factory-startup --python tools/carshape/kit/kit.py -- <car> <out.glb> [preview.png]

What the pack does, and so what this does:
  - the body is ONE mesh of flat faces, a grid: cross-sections at stations along the car,
    every section with the same points in the same roles, so every line the car has
    (sill, moulding, shoulder, belt, window top, roof edge) is a line of the grid and
    lines that should be parallel are;
  - glass is flush: cells of that grid, in the plane of the pillars round them, with a
    thin black seal round each pane cut into the surface;
  - shut lines (doors, bonnet, boot) are V-grooves in the surface, along grid lines;
  - mouldings are steps of the surface; edges are chamfered by the section's own points;
  - flat shading; bolt-on parts (bumpers, lamps, grille, mirrors, handles, wheels).

The car file (tools/carshape/kit/cars/<car>.py) gives KIT:
  stations [{y, yTop?, sill, w, mz?, mh?, mt?, ws?, sh, bx, bz,   (all stations)
             wx, wz, gx, gz, rx, rz,                              (house stations)
             dz?}]                                                (deck stations: deck centre)
  A station is a house station when it has `wz`; otherwise its upper points lie across its
  deck from the belt (bx, bz) to the centre (0, dz). Between a deck station and a house
  station lies a screen (or back light).
  windows [[y0, y1], ...]       side glass between stations (rows belt..window top)
  screens [[y0, y1], ...]       screen / back light cells between stations
  grooves [{y} | {y0, y1, row}] shut lines: across the side at a station from the sill to
                                the window top (doors) or along a row between stations
Factory figures from tools/carshape/bp/cars/<factoryFrom or car>.py.
"""
import math
import os
import runpy
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index('--') + 1:]
car, out_glb = argv[0], argv[1]
preview = argv[2] if len(argv) > 2 else None
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
K = runpy.run_path(os.path.join(HERE, 'cars', car + '.py'))['KIT']
F = runpy.run_path(os.path.join(ROOT, 'tools/carshape/bp/cars', K.get('factoryFrom', car) + '.py'))['CAR']['factory']
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
    'glass': material('car_glass', (0.13, 0.2, 0.2), 0.1),
    'rubber': material('trim_rubber', (0.02, 0.02, 0.02), 0.9),
    'trim': material('car_trim', (0.05, 0.05, 0.055), 0.7),
    'grille': material('trim_grille', (0.03, 0.03, 0.03), 0.8),
    'chrome': material('car_chrome', (0.65, 0.65, 0.66), 0.3, 0.6),
    'grey': material('trim_grey', (0.2, 0.2, 0.2), 0.7),
    'canvas': material('trim_canvas', (0.07, 0.07, 0.075), 0.9),
    'Headlights': material('Headlights', (0.85, 0.86, 0.82), 0.25),
    'TailLights': material('TailLights', (0.55, 0.0, 0.0), 0.35),
    'IndicatorLights': material('IndicatorLights', (0.95, 0.4, 0.09), 0.35),
    'ReverseLights': material('ReverseLights', (0.95, 0.95, 0.95), 0.35),
    'Tyres': material('Tyres', (0.04, 0.04, 0.04), 0.9),
    'wheel_rim': material('wheel_rim', (0.65, 0.65, 0.66), 0.35, 0.3),
}
LAMP_NODES = {'headlights', 'taillights', 'reverse_lights', 'front_blinker_left', 'front_blinker_right',
              'rear_blinker_left', 'rear_blinker_right'}
BODY_SLOTS = ['paint', 'glass', 'rubber', 'grille', 'chrome', 'grey']
SI = {k: i for i, k in enumerate(BODY_SLOTS)}

# ---- the grid -----------------------------------------------------------------------
ST = sorted(K['stations'], key=lambda s: s['y'])
D = K.get('defaults', {})
for s in ST:
    for k, v in D.items():
        s.setdefault(k, v)
    s.setdefault('yTop', s['y'])
    s.setdefault('lch', 0.04)
    s.setdefault('mt', 0.0)
    s.setdefault('mh', 0.05)
    s.setdefault('ws', s['w'])


ROWS = ['c0', 'sill_in', 'sill', 'm_lo', 'm_lo_out', 'm_hi_out', 'm_hi', 'shoulder', 'belt', 'seal',
        'win_top', 'gutter', 'roof_edge', 'roof_mid', 'c1']
RI = {k: i for i, k in enumerate(ROWS)}
DECK_T = [0.01, 0.04, 0.08, 0.13, 0.55, 1.0]      # rows seal..c1 across a deck (the pillar's rows
                                                  # stay by the side, the screen's spread across)


def half(s):
    w, sill = s['w'], s['sill']
    mz = s.get('mz', (sill + s['sh']) / 2)
    mh, mt = s['mh'], s['mt']
    # the side below and above the moulding: straight from the sill's chamfer to the
    # shoulder, leaning from w at the bottom to ws at the shoulder
    def side_x(z):
        f = (z - (sill + s['lch'])) / max(s['sh'] - (sill + s['lch']), 1e-6)
        return w + (s['ws'] - w) * min(max(f, 0.0), 1.0)
    z0, z1 = mz - mh / 2, mz + mh / 2
    pts = [(0.0, sill), (w - s['lch'], sill), (w, sill + s['lch']),
           (side_x(z0), z0), (side_x(z0) + mt, z0 + min(mt, mh / 4)), (side_x(z1) + mt, z1 - min(mt, mh / 4)),
           (side_x(z1), z1), (s['ws'], s['sh']), (s['bx'], s['bz'])]
    if 'wz' in s:
        # a house station: the belt's seal, the window band, the roof's edge, the roof
        rz, gz = s['rz'], s['gz']
        pts += [(s['bx'] - 0.004, s['bz'] + 0.014), (s['wx'], s['wz']), (s['gx'], gz),
                (s.get('rex', s['gx'] - 0.09), s.get('rez', gz + (rz - gz) * 0.7)),
                (s.get('rmx', s['gx'] * 0.45), s.get('rmz', rz - (rz - gz) * 0.08)), (0.0, rz)]
    else:
        dz = s.get('dz', s['bz'] + 0.02)
        # Across the deck. Where it meets a glasshouse (a screen's foot, a back light's)
        # its points stand at the same x as the next section's, so the pillars between
        # them are flat panels, not twisted ones.
        xs = s.get('deckX') or [s['bx'] * (1 - t) for t in s.get('deckT', DECK_T)]
        for x in xs:
            t = 1 - x / max(s['bx'], 1e-6)
            pts.append((x, s['bz'] + (dz - s['bz']) * math.sin(t * math.pi / 2)))
    return pts


def ring(s):
    hp = half(s)
    out = []
    for x, z in hp:
        f = (z - s['sill']) / max(max(p[1] for p in hp) - s['sill'], 1e-6)
        out.append((x, s['y'] + (s['yTop'] - s['y']) * f, z))
    return out


bm = bmesh.new()
NH = len(ROWS)
NR = 2 * NH - 2                       # round the car: right half, then the left back down


def ring_index(row, side):
    j = RI[row] if isinstance(row, str) else row
    return j if side > 0 or j in (0, NH - 1) else NR - j


V = []
for s in ST:
    hp = ring(s)
    full = hp + [(-x, y, z) for x, y, z in hp[-2:0:-1]]
    V.append([bm.verts.new(p) for p in full])
CELL = {}                             # (i, j) -> face; j the ring index of its first vertex
for i in range(len(ST) - 1):
    for j in range(NR):
        j2 = (j + 1) % NR
        q = (V[i][j], V[i][j2], V[i + 1][j2], V[i + 1][j])
        if len({v.co.to_tuple(5) for v in q}) < 3:
            continue
        try:
            f = bm.faces.new(q)
        except ValueError:
            continue
        f.material_index = SI['paint']
        CELL[(i, j)] = f
# The ends: closed in strips straight across, each point to its mirror.
for i in (0, len(ST) - 1):
    for j in range(NH - 1):
        a_, b_ = V[i][j], V[i][j + 1]
        c_, d_ = V[i][ring_index(j + 1, -1)], V[i][ring_index(j, -1)]
        for q in ((a_, b_, c_), (a_, c_, d_)):
            if len(set(q)) == 3:
                try:
                    bm.faces.new(q).material_index = SI['paint']
                except ValueError:
                    pass
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
YS = [s['y'] for s in ST]


def sidx(y):
    return min(range(len(YS)), key=lambda i: abs(YS[i] - y))


def cells(i0, i1, r0, r1):
    """The faces between stations i0..i1 and rows r0..r1, both sides."""
    out = []
    for i in range(i0, i1):
        for side in (1, -1):
            for r in range(RI[r0] if isinstance(r0, str) else r0, RI[r1] if isinstance(r1, str) else r1):
                j = ring_index(r, side) if side > 0 else ring_index(r + 1, -1)
                f = CELL.get((i, j))
                if f is not None:
                    out.append(f)
    return out


# Paint the grid: side glass, the belt's black seal under it, screens.
for y0, y1 in K.get('windows', []):
    for f in cells(sidx(y0), sidx(y1), 'seal', 'win_top'):
        f.material_index = SI['glass']
    for f in cells(sidx(y0), sidx(y1), 'belt', 'seal'):
        f.material_index = SI['rubber']
for sc in K.get('screens', []):
    y0, y1 = sc[0], sc[1]
    row = sc[2] if len(sc) > 2 else K.get('screenRow', 'roof_edge')     # how far out the pane reaches
    for f in cells(sidx(y0), sidx(y1), row, 'c1'):
        f.material_index = SI['glass']
for d in K.get('paint', []):          # cells in another colour: {y0, y1, r0, r1, material}
    for f in cells(sidx(d['y0']), sidx(d['y1']), d['r0'], d['r1']):
        f.material_index = SI[d['material']]

# Shut lines: V-grooves along grid lines. A door's edge runs across the side at its
# station from the sill to the window's top; a lid's along a row between stations.
groove_edges = set()
for g in K.get('grooves', []):
    if 'y' in g:
        i = sidx(g['y'])
        r0, r1 = RI[g.get('from', 'sill')], RI[g.get('to', 'win_top')]
        for side in (1, -1):
            for r in range(r0, r1):
                a_ = V[i][ring_index(r, side)]
                b_ = V[i][ring_index(r + 1, side)]
                e = bm.edges.get((a_, b_))
                if e:
                    groove_edges.add(e)
    else:
        i0, i1, r = sidx(g['y0']), sidx(g['y1']), g['row']
        sides_ = (1, -1) if r not in ('c0', 'c1') else (1,)
        for side in sides_:
            for i in range(i0, i1):
                e = bm.edges.get((V[i][ring_index(r, side)], V[i + 1][ring_index(r, side)]))
                if e:
                    groove_edges.add(e)
if groove_edges:
    gw, gd = K.get('grooveWidth', 0.004), K.get('grooveDepth', 0.004)
    res = bmesh.ops.bevel(bm, geom=list(groove_edges), offset=gw, offset_type='OFFSET', segments=2, profile=0.5,
                          affect='EDGES', clamp_overlap=True)
    strip = set(res['faces'])
    for v in {v for f in strip for v in f.verts}:
        if all(f in strip for f in v.link_faces):
            n = Vector()
            for f in v.link_faces:
                n += f.normal
            if n.length > 1e-6:
                v.co -= n.normalized() * gd
    for f in strip:
        f.material_index = SI['paint']

# Seals round the panes: a thin black strip cut into the surface along each pane's edge.
bm.normal_update()
glass_faces = {f for f in bm.faces if f.material_index == SI['glass']}
seal_edges = [e for e in bm.edges if sum(1 for f in e.link_faces if f in glass_faces) == 1]
if seal_edges:
    res = bmesh.ops.bevel(bm, geom=seal_edges, offset=K.get('seal', 0.008), offset_type='OFFSET', segments=1,
                          affect='EDGES', clamp_overlap=True)
    for f in res['faces']:
        f.material_index = SI[K.get('sealMaterial', 'rubber')]
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)


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


body = new_object('paint', bm, BODY_SLOTS)

# ---- wheel wells and arch lips --------------------------------------------------------
arch = K.get('arch', {})


def drum(name, ya, track, which):
    a_ = dict(arch, **arch.get(which, {}))
    ra = a_.get('radius', R * 1.12)
    za = R + a_.get('lift', 0.03)
    x_in = track / 2 - F['tyreWidth'] / 2 - a_.get('inset', 0.04)
    b = bmesh.new()
    for s_ in (1, -1):
        r = bmesh.ops.create_cone(b, cap_ends=True, segments=a_.get('segments', 16), radius1=ra, radius2=ra, depth=1.0)
        bmesh.ops.transform(b, matrix=Matrix.Translation((s_ * (x_in + 0.5), ya, za)) @ Matrix.Rotation(math.radians(90), 4, 'Y'),
                            verts=r['verts'])
        r = bmesh.ops.create_cube(b, size=1.0)
        bmesh.ops.transform(b, matrix=Matrix.Translation((s_ * (x_in + 0.5), ya, za / 2 - 0.05)) @ Matrix.Diagonal((1.0, 2 * ra, za + 0.1, 1)),
                            verts=r['verts'])
    me = bpy.data.meshes.new(name)
    b.to_mesh(me)
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    return o, ra, za


ARCHES = []
for i, (ya, tr) in enumerate(AXLES):
    which = ('front', 'rear')[i]
    d_, ra, za = drum(f'drum{i}', ya, tr, which)
    ARCHES.append((ya, ra, za))
    mod = body.modifiers.new('arch', 'BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.object = d_
    mod.solver = 'EXACT'
    mod.use_self = True
    mod.use_hole_tolerant = True
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(d_)

_dg = bpy.context.evaluated_depsgraph_get()
_tree = BVHTree.FromObject(body, _dg)


def skin_hit(origin, direction, dist=5.0):
    hit = _tree.ray_cast(Vector(origin), Vector(direction).normalized(), dist)
    return hit if hit[0] is not None else None


def skin_x(y, z):
    hit = skin_hit((2.0, y, z), (-1, 0, 0))
    return hit[0].x if hit else W / 2


def side_x_at(y, z):
    """The body side's half-width at (y, z) from the sections themselves (rays would
    find the wells' walls near an arch)."""
    i = max(0, min(len(ST) - 2, max(k for k in range(len(ST)) if ST[k]['y'] <= y) if y >= ST[0]['y'] else 0))
    f = (y - ST[i]['y']) / max(ST[i + 1]['y'] - ST[i]['y'], 1e-9)
    f = min(max(f, 0.0), 1.0)

    def at(s_):
        hp = half(s_)[:9]
        for (x0, z0), (x1, z1) in zip(hp, hp[1:]):
            if min(z0, z1) <= z <= max(z0, z1) and abs(z1 - z0) > 1e-6:
                return x0 + (x1 - x0) * (z - z0) / (z1 - z0)
        return s_['w']
    return at(ST[i]) * (1 - f) + at(ST[i + 1]) * f


def end_y(end, x, z):
    sgn = -1 if end == 'front' else 1
    hit = skin_hit((x, sgn * 4.0, z), (0, -sgn, 0))
    if hit:
        return hit[0].y
    s = ST[0] if end == 'front' else ST[-1]
    return s['y']


# ---- parts ----------------------------------------------------------------------------
PARTS = {}


def slot(node, mat):
    if node not in PARTS:
        PARTS[node] = (bmesh.new(), [])
    b, mats = PARTS[node]
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


def sides(d, node):
    if node.endswith('_left'):
        return (1,)
    if node.endswith('_right'):
        return (-1,)
    return (1, -1) if d.get('mirror', True) and abs(d.get('x', 0)) > 1e-6 else (1,)


# Arch lips: a band round each arch standing off the side (the Niva's flares).
for fl in K.get('archLips', []):
    b, mi = slot('lips', fl.get('material', 'paint'))
    for ya, ra, za in ARCHES:
        for s_ in (1, -1):
            rows = []
            for a_ in [math.radians(x) for x in range(fl.get('from', -8), 181 - fl.get('from', -8), 12)]:
                row = []
                for rr in (ra - 0.005, ra + fl.get('w', 0.05)):
                    y_, z_ = ya - rr * math.cos(a_), za + rr * math.sin(a_)
                    x_ = s_ * side_x_at(y_, z_)
                    row.append((x_ - s_ * 0.004, y_, z_))
                    row.append((x_ + s_ * fl.get('t', 0.02), y_, z_))
                rows.append([b.verts.new(p) for p in row])
            for r0, r1 in zip(rows, rows[1:]):
                for i0_, i1_ in ((0, 1), (1, 3), (3, 2)):
                    q = (r0[i0_], r0[i1_], r1[i1_], r1[i0_])
                    b.faces.new(q if s_ > 0 else q[::-1]).material_index = mi

# End pieces: lamps, grilles, panels on the nose or tail {end, x, z, w, h | r, node,
# material, shape, proud, depth}.
for d in K.get('ends', []):
    node = d.get('node', 'trim')
    b, mi = slot(node, d.get('material', 'trim'))
    sgn = -1 if d['end'] == 'front' else 1
    for s_ in sides(d, node):
        x = s_ * abs(d.get('x', 0.0))
        y = end_y(d['end'], x, d['z']) + sgn * d.get('proud', 0.008)
        dep = d.get('depth', 0.03)
        if d.get('shape') == 'round':
            cyl(b, (x, y - sgn * dep / 2, d['z']), (0, 1, 0), d['r'], dep, d.get('seg', 12), mi)
        else:
            box(b, (x, y - sgn * dep / 2, d['z']), (d['w'], dep, d['h']), mi)


# Bumpers: a bar swept round the body's end at its height, a faceted section, wrapping
# the corners and tapering off; or a bowed bar on brackets. {end, z0, z1, depth, proud,
# wrap, material, bow, overriders, bevel, half}
def sweep(b, path, prof, mi, taper=None):
    rings = []
    for i, p in enumerate(path):
        a_ = Vector(path[max(i - 1, 0)])
        c_ = Vector(path[min(i + 1, len(path) - 1)])
        t_ = (c_ - a_).normalized()
        up = Vector((0, 0, 1))
        out = t_.cross(up).normalized()
        if out.dot(Vector((p[0], p[1], 0))) < 0:
            out = -out
        k = taper[i] if taper else 1.0
        rings.append([b.verts.new(Vector(p) + out * (u * k) + up * (v * (0.5 + 0.5 * k))) for u, v in prof])
    n_ = len(prof)
    for r0, r1 in zip(rings, rings[1:]):
        for j in range(n_):
            b.faces.new((r0[j], r0[(j + 1) % n_], r1[(j + 1) % n_], r1[j])).material_index = mi
    for r in (rings[0], rings[-1][::-1]):
        b.faces.new(r[::-1]).material_index = mi


for d in K.get('bumpers', []):
    b, mi = slot('bumpers', d.get('material', 'chrome'))
    sgn = -1 if d['end'] == 'front' else 1
    zc, h = (d['z0'] + d['z1']) / 2, d['z1'] - d['z0']
    dep, pr = d.get('depth', 0.07), d.get('proud', 0.03)
    hw = d.get('half', W / 2 - 0.02)
    xs_ = [hw * math.sin(math.radians(a_)) for a_ in range(-90, 91, 6)]
    path = []
    if d.get('bow') is not None:
        hits = [skin_hit((x, sgn * 4.0, zc), (0, -sgn, 0)) for x in xs_]
        y_far = max((sgn * h_[0].y for h_ in hits if h_), default=sgn * ST[0 if sgn < 0 else -1]['y']) * sgn
        for x in xs_:
            u_ = x / hw
            path.append((x, y_far + sgn * (pr + dep / 2 + d['bow'] * (1 - u_ * u_)), zc))
    else:
        for x in xs_:
            path.append((x, end_y(d['end'], x, zc) + sgn * (pr + dep / 2), zc))
    wr = d.get('wrap', 0.14)
    for s_ in ((1, -1) if wr > 0 else ()):
        yc_ = path[-1 if s_ > 0 else 0][1]
        ext = []
        for i in range(1, 6):
            y_ = yc_ - sgn * wr * i / 5
            x_ = skin_x(y_, zc) + pr * 0.6 + dep / 2
            ext.append((s_ * min(x_, W / 2 + 0.01), y_, zc))
        path = path + ext if s_ > 0 else ext[::-1] + path
    bv = d.get('bevel', 0.35)
    prof = [(-dep / 2, -h / 2), (dep / 2 * 0.7, -h / 2), (dep / 2, -h / 2 * 0.5), (dep / 2, h / 2 * (1 - bv)),
            (dep / 2 * (1 - bv), h / 2), (-dep / 2, h / 2)]
    nn = len(path)
    taper = [min(1.0, 0.45 + 0.55 * min(i, nn - 1 - i) / 4) for i in range(nn)]
    sweep(b, path, prof, mi, taper)
    for ox in d.get('overriders', []):
        for s_ in (1, -1):
            y_ = end_y(d['end'], s_ * ox, zc) + sgn * (pr + dep + 0.01)
            cyl(b, (s_ * ox, y_, zc + h * 0.6), (0, 0, 1), 0.035, h * 2.4, 8, mi, 0.025)

# Side pieces on the flanks {y, z, w, h, proud, material, node}: handles, side lamps.
for d in K.get('flank', []):
    node = d.get('node', 'trim')
    b, mi = slot(node, d.get('material', 'chrome'))
    for s_ in sides(dict(d, x=1), node):
        x = skin_x(d['y'], d['z'])
        pr = d.get('proud', 0.008)
        box(b, (s_ * (x + pr / 2), d['y'], d['z']), (pr + 0.006, d['w'], d['h']), mi)

# Mirrors {y, z, w, h, d, arm, material}.
mr = K.get('mirror')
if mr:
    b, mi = slot('trim', mr.get('material', 'rubber'))
    _, gi = slot('trim', 'chrome')
    for s_ in (1, -1):
        x0 = skin_x(mr['y'], mr['z'] - 0.02)
        arm = mr.get('arm', 0.05)
        w_, h_, d_ = mr.get('w', 0.14), mr.get('h', 0.09), mr.get('d', 0.05)
        box(b, (s_ * (x0 + arm / 2), mr['y'] + 0.01, mr['z'] - 0.01), (arm + 0.02, 0.035, 0.025), mi)
        xc = s_ * (x0 + arm + w_ / 2)
        box(b, (xc, mr['y'], mr['z'] + h_ / 2 - 0.02), (w_, d_, h_), mi)
        box(b, (xc, mr['y'] + d_ / 2 + 0.002, mr['z'] + h_ / 2 - 0.02), (w_ * 0.84, 0.005, h_ * 0.78), gi)

# Blocks given outright {c, size | r+depth+axis, material, node, mirror, onTop}.
for d in K.get('blocks', []):
    node = d.get('node', 'trim')
    b, mi = slot(node, d.get('material', 'trim'))
    for s_ in ((1, -1) if d.get('mirror') else (1,)):
        c = list(d['c'])
        if d.get('onTop'):
            hit = skin_hit((s_ * c[0], c[1], 3.0), (0, 0, -1))
            if hit:
                c[2] = hit[0].z + d.get('proud', 0.004) - d['size'][2] / 2
        if d.get('round'):
            cyl(b, (s_ * c[0], c[1], c[2]), d.get('axis', (0, 1, 0)), d['r'], d['depth'], d.get('seg', 12), mi)
        else:
            box(b, (s_ * c[0], c[1], c[2]), d['size'], mi)

# Underside: the sump and, on a driven rear axle, the axle and its diff, at the clearance.
ub = K.get('underbody', {})
b, mi = slot('trim', 'trim')
s0 = min(s['sill'] for s in ST)
ye = YB if ub.get('engine') == 'rear' else YA
box(b, (0, ye + 0.05, (C + s0 + 0.03) / 2), (0.34, 0.4, s0 + 0.03 - C), mi)
if ub.get('rearDrive', True) and ub.get('engine') != 'rear':
    cyl(b, (0, YB, R), (1, 0, 0), 0.045, AXLES[1][1] - F['tyreWidth'] - 0.08, 10, mi)
    box(b, (0, YB, (C + 0.005 + R + 0.1) / 2), (0.28, 0.24, R + 0.1 - C - 0.005), mi)

part_objs = {node: new_object(node, b, mats) for node, (b, mats) in PARTS.items()}

# ---- wheels ---------------------------------------------------------------------------
wh = K.get('wheel', {})
tw = F['tyreWidth']
seg = wh.get('segments', 16)
for name, (ya, track), side in (('wheel_fl', AXLES[0], 1), ('wheel_fr', AXLES[0], -1),
                                ('wheel_rl', AXLES[1], 1), ('wheel_rr', AXLES[1], -1)):
    b = bmesh.new()
    rim = R * wh.get('rim', 0.6)
    hw = tw / 2
    prof = [(rim, -side * hw * 0.88), (R * 0.86, -side * hw), (R * 0.96, -side * hw * 0.85), (R, -side * hw * 0.5),
            (R, side * hw * 0.5), (R * 0.96, side * hw * 0.85), (R * 0.86, side * hw), (rim, side * hw * 0.88)]
    rings = []
    for k in range(seg):
        a = 2 * math.pi * k / seg
        rings.append([b.verts.new((x, r * math.cos(a), r * math.sin(a))) for r, x in prof])
    for k in range(seg):
        r0, r1 = rings[k], rings[(k + 1) % seg]
        for j in range(len(prof) - 1):
            b.faces.new((r0[j], r0[j + 1], r1[j + 1], r1[j])).material_index = 0
    fx = side * hw * 0.88
    cyl(b, (fx - side * 0.004, 0, 0), (1, 0, 0), rim, 0.012, seg, 1)
    cyl(b, (fx - side * 0.014, 0, 0), (1, 0, 0), rim * 0.86, 0.012, seg, 2)
    cap = rim * wh.get('cap', 0.45)
    cyl(b, (fx + side * 0.006, 0, 0), (side, 0, 0), cap, 0.03, seg, 1, cap * 0.55)
    o = new_object(name, b, ['Tyres', 'wheel_rim', 'grey'])
    o.location = (side * track / 2, ya, R)

# ---- join, shade, export --------------------------------------------------------------
bpy.ops.object.select_all(action='DESELECT')
lips = part_objs.pop('lips', None)
if lips:
    body.select_set(True)
    lips.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='DESELECT')
body.active_material_index = SI['glass']
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

lo = Vector((1e9,) * 3)
hi = -lo
for o in scene.objects:
    if o.type != 'MESH' or o.name.startswith('wheel_'):
        continue
    for v in o.data.vertices:
        w_ = o.matrix_world @ v.co
        lo = Vector(map(min, lo, w_))
        hi = Vector(map(max, hi, w_))
nf = {o.name: len(o.data.polygons) for o in scene.objects if o.type == 'MESH'}
print(f'KIT {car}: paint {nf.get("paint")} glass {nf.get("glass")} trim {nf.get("trim")}; height {(H - C) / (hi.z - lo.z):.3f} '
      f'length {L / (hi.y - lo.y):.3f} (bottom {lo.z:.3f} top {hi.z:.3f} nose {lo.y:.3f} tail {hi.y:.3f} half-width {max(abs(lo.x), hi.x):.3f})')
bpy.ops.export_scene.gltf(filepath=out_glb, export_format='GLB', export_yup=True, export_apply=True)
