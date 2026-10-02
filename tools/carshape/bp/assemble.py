"""Turns a blueprint shell (hull.py) into a game car: glass, lamps, grille, bumpers,
trim and wheels, all placed from the same drawing.

    blender --background --factory-startup --python tools/carshape/bp/assemble.py -- <car> <out.glb> [preview.png]

Everything the drawing shows on the skin is PROJECTED onto the skin from the view it is
drawn in: an outline read off the front view (a headlamp, the grille, the plate) is cut
into the shell along that outline and lifted off it as its own part, so it follows the
nose's real curvature, sits where the drawing puts it and has the drawing's shape. The
glass is the same cut, left in the shell on its own material. Bumpers run round the
shell's own outline at their height (hull.py), wheels sit on the factory axles.

Outlines are given for the car's RIGHT side seen from the view (x >= 0 on the front
and rear views) and mirrored unless `mirror: False`; `node`s ending in _left/_right
are put on that side only. Coordinates are car coordinates (carbody.py): nose -y,
+z up, +x the car's left. Node and material names are the runtime contract
(render/carmodel.ts).
"""
import json
import math
import os
import re
import runpy
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index('--') + 1:]
car = argv[0]
out_glb = argv[1]
preview = argv[2] if len(argv) > 2 else None
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
spec = runpy.run_path(os.path.join(HERE, 'cars', car + '.py'))['CAR']
info = json.load(open(os.path.join(ROOT, 'build/carshape', car, 'hull.json')))
F = spec['factory']
P = spec.get('parts', {})
# No number plates (nor blank plate patches): every part drawn in the plate's
# materials is dropped, whatever list it sits in.
P = {k: [d for d in v if not (isinstance(d, dict) and d.get('material') in ('plate', 'plate_ink'))]
     if isinstance(v, list) else v for k, v in P.items()}
# Frames a traced glasshouse puts round its panes are decals like any other.
P['decals'] = P.get('decals', []) + [{k: v for k, v in g.items() if k != 'frame'}
                                     for g in info.get('glass', []) if g.get('frame')]
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
    'glass': material('car_glass', (0.03, 0.045, 0.06), 0.1),
    'trim': material('car_trim', (0.05, 0.05, 0.055), 0.7),
    'rubber': material('trim_rubber', (0.025, 0.025, 0.028), 0.85),
    'grille': material('trim_grille', (0.015, 0.015, 0.017), 0.8),
    'chrome': material('car_chrome', (0.72, 0.73, 0.75), 0.25, 0.9),
    'alu': material('trim_alu', (0.55, 0.56, 0.57), 0.4, 0.6),
    'plate': material('trim_plate', (0.86, 0.86, 0.83), 0.6),
    'plate_ink': material('trim_plate_ink', (0.06, 0.06, 0.07), 0.6),
    'reflector': material('lamp_reflector', (0.80, 0.80, 0.78), 0.2, 0.4),
    'Headlights': material('Headlights', (0.75, 0.76, 0.74), 0.25),
    'TailLights': material('TailLights', (0.5, 0.03, 0.02), 0.35),
    'IndicatorLights': material('IndicatorLights', (0.9, 0.45, 0.05), 0.35),
    'ReverseLights': material('ReverseLights', (0.85, 0.85, 0.85), 0.35),
    'Tyres': material('Tyres', (0.035, 0.035, 0.035), 0.9),
    'wheel_rim': material('wheel_rim', (0.62, 0.63, 0.65), 0.35, 0.6),
}
for name, rgb in P.get('lensColours', {}).items():
    MAT[name] = material(name, tuple(rgb), 0.3)
# A two-tone roof or bonnet stripe: the runtime paints `car_paint`; a second paint
# keeps its own colour only if named as the model's secondary paint.
if 'paint2' in P:
    MAT['paint2'] = material(P['paint2'].get('name', 'car_paint_2'), tuple(P['paint2']['rgb']), 0.45)

# ---- the shell ------------------------------------------------------------------------
bpy.ops.wm.ply_import(filepath=os.path.join(ROOT, 'build/carshape', car, 'hull.ply'))
body = [o for o in scene.objects if o.type == 'MESH'][0]
body.name = 'paint'
body.data.name = 'paint'
bpy.context.view_layer.objects.active = body
body.select_set(True)
# The full-resolution shell lends its normals to the working one at the end.
bpy.ops.wm.ply_import(filepath=os.path.join(ROOT, 'build/carshape', car, 'work.ply'))
work = [o for o in scene.objects if o.type == 'MESH' and o is not body][0]
dense = body
dense.name = 'dense_hull'
dense.data.name = 'dense_hull'
bpy.context.scene.collection.objects.unlink(dense)
body = work
body.name = 'paint'
body.data.name = 'paint'
bpy.context.view_layer.objects.active = body
body.data.materials.clear()
for k in ('paint', 'glass', 'trim'):
    body.data.materials.append(MAT[k])
if 'paint2' in MAT:
    body.data.materials.append(MAT['paint2'])
SLOT = {'paint': 0, 'glass': 1, 'trim': 2, 'paint2': 3}

bm = bmesh.new()
bm.from_mesh(body.data)
bm.normal_update()
print('FACES work', len(bm.faces))

VIEW = {
    # axis the view looks along, which car axes the outline's (a, b) are, and the
    # direction the facing faces point
    'front': {'a': 0, 'b': 2, 'depth': 1, 'facing': Vector((0, -1, 0))},
    'rear': {'a': 0, 'b': 2, 'depth': 1, 'facing': Vector((0, 1, 0))},
    'side': {'a': 1, 'b': 2, 'depth': 0, 'facing': Vector((1, 0, 0))},
    'top': {'a': 1, 'b': 0, 'depth': 2, 'facing': Vector((0, 0, 1))},
}


def circle(c, r, n=28):
    return [[c[0] + r * math.cos(2 * math.pi * k / n), c[1] + r * math.sin(2 * math.pi * k / n)] for k in range(n)]


def rounded_rect(c, w, h, r, n=5):
    r = min(r, w / 2, h / 2)
    pts = []
    for cx, cy, a0 in ((c[0] + w / 2 - r, c[1] + h / 2 - r, 0), (c[0] - w / 2 + r, c[1] + h / 2 - r, 90),
                       (c[0] - w / 2 + r, c[1] - h / 2 + r, 180), (c[0] + w / 2 - r, c[1] - h / 2 + r, 270)):
        for k in range(n + 1):
            a = math.radians(a0 + 90 * k / n)
            pts.append([cx + r * math.cos(a), cy + r * math.sin(a)])
    return pts


def shape(d):
    """An outline from its authored form."""
    if 'outline' in d:
        return [list(p) for p in d['outline']]
    if 'circle' in d:
        return circle(d['circle'][0], d['circle'][1], d.get('segments', 28))
    if 'rect' in d:
        (a, b), (w, h) = d['rect'][0], d['rect'][1]
        return rounded_rect((a, b), w, h, d.get('radius', 0.008))
    raise ValueError(d)


def offset_poly(poly, dist):
    """Miter offset of a closed outline (outward for positive `dist` when the outline
    runs counter-clockwise)."""
    p = np.array(poly, float)
    area = 0.5 * np.sum(p[:, 0] * np.roll(p[:, 1], -1) - np.roll(p[:, 0], -1) * p[:, 1])
    if area < 0:
        dist = -dist
    out = []
    n = len(p)
    for i in range(n):
        a, b, c = p[i - 1], p[i], p[(i + 1) % n]
        e1, e2 = b - a, c - b
        n1 = np.array([e1[1], -e1[0]]) / max(np.linalg.norm(e1), 1e-9)
        n2 = np.array([e2[1], -e2[0]]) / max(np.linalg.norm(e2), 1e-9)
        m = n1 + n2
        m /= max(np.linalg.norm(m), 1e-9)
        k = dist / max(np.dot(m, n1), 0.3)
        out.append((b + m * k).tolist())
    return out


def inside(poly, a, b):
    hit = False
    for (a0, b0), (a1, b1) in zip(poly, poly[1:] + poly[:1]):
        if (b0 > b) != (b1 > b) and a < a0 + (b - b0) * (a1 - a0) / (b1 - b0):
            hit = not hit
    return hit


def mirrored(poly, view):
    if view in ('front', 'rear', 'top'):
        return [[-p[0], p[1]] for p in poly][::-1] if view != 'top' else [[p[0], -p[1]] for p in poly][::-1]
    return poly


def sides_of(d):
    """The outline once per side it is on, as (sign, outline)."""
    view = d['view']
    poly = shape(d)
    node = d.get('node', '')
    if view == 'side':
        signs = (1, -1) if d.get('mirror', True) else (1,)
        if node.endswith('_left'):
            signs = (1,)
        elif node.endswith('_right'):
            signs = (-1,)
        return [(s, poly) for s in signs]
    if not d.get('mirror', True):
        return [(1, poly)]
    # Front/rear/top outlines are authored on +x; the car's left is +x.
    out = []
    if not node.endswith('_right'):
        out.append((1, poly))
    if not node.endswith('_left'):
        out.append((-1, mirrored(poly, view) if view != 'top' else [[p[0], -p[1]] for p in poly][::-1]))
    return out


def candidates(view, sign, poly, d):
    """Faces of the shell that could carry this outline: facing the view, inside the
    outline's box and within its depth range."""
    V = VIEW[view]
    facing = V['facing'].copy()
    if view == 'side':
        facing = Vector((sign, 0, 0))
    lim = d.get('facingMin', 0.2)
    a_, b_ = V['a'], V['b']
    arr = np.array(poly)
    lo, hi = arr.min(axis=0) - 0.03, arr.max(axis=0) + 0.03
    dr = d.get('depthRange')
    out = []
    for f in bm.faces:
        if f.normal.dot(facing) < lim:
            continue
        c = f.calc_center_median()
        # Overlap of the face's own box, not its centre: a long sliver whose centre
        # lies outside the outline still has to be cut by it.
        fa = [v.co[a_] for v in f.verts]
        fb = [v.co[b_] for v in f.verts]
        if max(fa) < lo[0] or min(fa) > hi[0] or max(fb) < lo[1] or min(fb) > hi[1]:
            continue
        if view == 'side' and c.x * sign <= 0:
            continue
        if dr and not (dr[0] <= c[V['depth']] <= dr[1]):
            continue
        out.append(f)
    return out


def plane_for(view, p, q):
    V = VIEW[view]
    a_, b_, dp = V['a'], V['b'], V['depth']
    co = [0.0, 0.0, 0.0]
    co[a_], co[b_] = p[0], p[1]
    e = [0.0, 0.0, 0.0]
    e[a_], e[b_] = q[0] - p[0], q[1] - p[1]
    axis = [0.0, 0.0, 0.0]
    axis[dp] = 1.0
    no = Vector(e).cross(Vector(axis))
    if no.length < 1e-9:
        return None
    return Vector(co), no.normalized()


def cut(view, sign, poly, d):
    # A depth range bounds the region as sharply as its outline does.
    dr = d.get('depthRange')
    if dr:
        dp = VIEW[view]['depth']
        for v_cut in dr:
            faces = candidates(view, sign, poly, dict(d, depthRange=[v_cut - 0.1, v_cut + 0.1]))
            if faces:
                geom = list({v for f in faces for v in f.verts}) + list({e for f in faces for e in f.edges}) + faces
                co = [0.0, 0.0, 0.0]
                co[dp] = v_cut
                no = [0.0, 0.0, 0.0]
                no[dp] = 1.0
                bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=no, dist=1e-5)
    for p, q in zip(poly, poly[1:] + poly[:1]):
        pq = plane_for(view, p, q)
        if pq is None:
            continue
        # Only the faces along this edge: an infinite plane through the whole outline's
        # box would chop everything inside it into strips.
        faces = candidates(view, sign, [p, q], d)
        if not faces:
            continue
        geom = list({v for f in faces for v in f.verts}) + list({e for f in faces for e in f.edges}) + faces
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=pq[0], plane_no=pq[1], dist=1e-5)


def select(view, sign, poly, d, hole=None):
    V = VIEW[view]
    a_, b_ = V['a'], V['b']
    out = []
    for f in candidates(view, sign, poly, d):
        c = f.calc_center_median()
        if inside(poly, c[a_], c[b_]) and not (hole and inside(hole, c[a_], c[b_])):
            out.append(f)
    return out


# ---- glass: cut into the shell ------------------------------------------------------
# A traced body's panes come from its own glasshouse (loft.glazing); a car file can
# add to them.
GL = ([g for g in info['glass'] if not (g.get('frame') or g.get('region'))] + P.get('glassExtra', [])) \
    if info.get('glass') else P.get('glass', [])
P['regions'] = P.get('regions', []) + [{k: v for k, v in g.items() if k != 'region'}
                                       for g in info.get('glass', []) if g.get('region')]
glass_faces = set()


def ragged(view, sign, poly, d):
    """Faces inside the outline that the view does not see, next to ones it does: where
    a pane's edge would follow the surface's turn instead of the drawn line."""
    inside_all = set(select(view, sign, poly, dict(d, facingMin=-1.0)))
    seen = set(select(view, sign, poly, d))
    return sum(1 for f in inside_all - seen if any(o in seen for e in f.edges for o in e.link_faces))


def fit_pane(view, sign, poly, d, ks=None):
    """A screen drawn a little wider than the shell's glasshouse would end raggedly on
    the pillars: its outline is brought in, a centimetre at a time, until it lies on
    the surface the view sees."""
    if view == 'side' or d.get('fit') is False:
        return poly
    lo = min(p[1] for p in poly)
    hi = max(p[1] for p in poly)

    def moved(k, kb, kt):
        out = []
        for a_, b_ in poly:
            a2 = a_ - math.copysign(0.01 * k, a_) * (abs(a_) > 0.15)
            b2 = b_ + 0.01 * kb * (b_ < lo + 0.03) - 0.01 * kt * (b_ > hi - 0.03)
            out.append([a2, b2])
        return out

    # Greedy: whichever centimetre (in at the pillars, up at the base, down at the
    # header) clears the most turned-away faces, until the pane lies on what it sees.
    if ks is not None:
        return moved(*ks)
    V = VIEW[view]

    def loose(p_):
        inside_all = set(select(view, sign, p_, dict(d, facingMin=-1.0)))
        seen = set(select(view, sign, p_, d))
        return [f for f in inside_all - seen if any(o in seen for e in f.edges for o in e.link_faces)]

    # Each turned-away face says which edge to move: one near the base raises the
    # base, near the header lowers it, anything else brings the sides in.
    ks = [0, 0, 0]
    limits = (10, 12, 8)
    lf = loose(poly)
    r = len(lf)
    while r > 2:
        votes = [0, 0, 0]
        cur = moved(*ks)
        lo_ = min(p[1] for p in cur)
        hi_ = max(p[1] for p in cur)
        for f in lf:
            b_ = f.calc_center_median()[V['b']]
            votes[1 if b_ < lo_ + 0.08 else 2 if b_ > hi_ - 0.08 else 0] += 1
        order = sorted(range(3), key=lambda i: -votes[i])
        i = next((i for i in order if ks[i] < limits[i] and votes[i]), None)
        if i is None:
            break
        ks[i] += 1
        lf = loose(moved(*ks))
        r = len(lf)
    if any(ks):
        print(f'PANE {car} ({view}) in {ks[0]} cm, base up {ks[1]} cm, top down {ks[2]} cm, ragged {r}')
    FIT_KS[(view, id(d))] = ks
    return moved(*ks)


FIT_KS = {}
FITTED = {}
for gi, g in enumerate(GL):
    for sign, poly in sides_of(g):
        # Both halves of a screen take the first half's fit: a pane is symmetric.
        FITTED[(gi, sign)] = fit_pane(g['view'], sign, poly, g, FIT_KS.get((g['view'], id(g))))
        cut(g['view'], sign, FITTED[(gi, sign)], g)
for gi, g in enumerate(GL):
    for sign, poly in sides_of(g):
        poly = FITTED[(gi, sign)]
        sel = set(select(g['view'], sign, poly, g))
        glass_faces |= sel
        # A pane whose outline runs off the surface the view sees ends in a ragged
        # edge (faces inside the outline but turned away): reported, so the outline
        # can be brought in.
        loose = set(select(g['view'], sign, poly, dict(g, facingMin=-1.0))) - sel
        rf = [f for f in loose if any(o in sel for e in f.edges for o in e.link_faces)]
        ragged = len(rf)
        if os.environ.get('RAGDEBUG') and g['view'] != 'side':
            p0 = sides_of(g)[0][1] if sign == 1 else sides_of(g)[-1][1]
            rf = [f for f in set(select(g['view'], sign, p0, dict(g, facingMin=-1.0))) -
                  set(select(g['view'], sign, p0, g))]
            print('  pane', gi, 'turned-away faces inside the drawn outline:', len(rf))
            for f in rf[:40]:
                c_ = f.calc_center_median()
                print('  loose', tuple(round(v, 3) for v in c_), 'n', tuple(round(v, 2) for v in f.normal))
        if ragged > 3:
            print(f'GLASS-RAGGED {car} pane {gi} ({g["view"]}, side {sign}): {ragged} faces')
for f in glass_faces:
    f.material_index = SLOT['glass']

# Wheel wells: everything the arch cut exposed (inside the arch's radius and inboard
# of the body side) is the black of the inner wing, not paint.
HA0 = spec.get('hull', {}).get('arch', {})
ARCHES = []
for (ya, track), which in zip(AXLES, ('front', 'rear')):
    HA = dict(HA0, **HA0.get(which, {}))
    if not HA.get('skirt'):
        ARCHES.append((ya, HA.get('radius', R * 1.14), R + HA.get('lift', 0.02)))
for f in bm.faces:
    c = f.calc_center_median()
    for ya, ra, za in ARCHES:
        dy, dz = c.y - ya, c.z - za
        inside_arch = (dz >= 0 and dy * dy + dz * dz < (ra - 0.006) ** 2) or (dz < 0 and abs(dy) < ra - 0.006)
        if inside_arch and abs(f.normal.x) < 0.9 and f.material_index == SLOT['paint']:
            f.material_index = SLOT['trim']
        elif inside_arch and abs(c.x) < W / 2 - 0.03 and f.material_index == SLOT['paint']:
            f.material_index = SLOT['trim']

# Painted regions in the shell itself: a second colour (roof, bonnet), or black.
for r in P.get('regions', []):
    for sign, poly in sides_of(r):
        cut(r['view'], sign, poly, r)
    for sign, poly in sides_of(r):
        for f in select(r['view'], sign, poly, r):
            if f.material_index == SLOT['paint']:
                f.material_index = SLOT[r.get('material', 'trim')]


# Every patch is first only an outline cut into the working shell and a TAG on the
# faces inside it (a material slot of its own); the shell is then reduced with every
# tagged outline held, and the patches are lifted off the reduced shell. So a lamp's
# edge is exactly its drawn outline and its faces are few.
TAGS = []           # (node, material, height)
TAG0 = 10


def tag(view, sign, poly, d, node, mat, height, hole=None):
    t = len(TAGS)
    TAGS.append((node, mat, height))
    # Where patches overlap the one standing proudest (a lens over its surround) owns
    # the face; the others show round it.
    # A tagged face remembers what it was under the patch (paint, black, a second
    # colour): slot TAG0 + 4 * tag + base.
    for f in select(view, sign, poly, d, hole):
        m_ = f.material_index
        if m_ == SLOT['glass']:
            continue
        if m_ < TAG0:
            f.material_index = TAG0 + 4 * t + m_
        elif TAGS[(m_ - TAG0) // 4][2] <= height:
            f.material_index = TAG0 + 4 * t + (m_ - TAG0) % 4


def decal_shapes():
    """Every patch the car's file asks for, as (view, sign, poly, d, node, mat, height, hole)."""
    out = []
    for d in P.get('decals', []):
        if d['view'] in ('front', 'rear') and 'facingMin' not in d:
            # A lamp or a plate drawn on an end stays on the end: it does not wrap round.
            d = dict(d, facingMin=0.3)
        for sign, poly in sides_of(d):
            hole = offset_poly(poly, -d['ring']) if d.get('ring') else None
            node = d.get('node', 'decal_trim')
            out.append((d['view'], sign, poly, d, node, d.get('material', 'trim'), d.get('height', 0.004), hole))
    # Bars across a grille or a lamp: thin strips, each its own patch.
    for d in P.get('bars', []):
        a0, a1 = d['span']
        for k in range(d['count']):
            t = (k + 0.5) / d['count']
            if d.get('dir', 'h') == 'h':
                b_ = d['b'][0] + (d['b'][1] - d['b'][0]) * t
                rect = [[(a0 + a1) / 2, b_], [a1 - a0, d['width']]]
            else:
                a_ = a0 + (a1 - a0) * t
                rect = [[a_, (d['b'][0] + d['b'][1]) / 2], [d['width'], d['b'][1] - d['b'][0]]]
            strip = {'view': d['view'], 'rect': rect, 'radius': 0.001, 'mirror': d.get('mirror', False),
                     'depthRange': d.get('depthRange'), 'facingMin': d.get('facingMin', 0.2)}
            for sign, poly in sides_of(strip):
                out.append((d['view'], sign, poly, strip, 'decal_trim', d.get('material', 'chrome'), d.get('height', 0.008), None))
    # Lines on the skin: shut lines, window rubbers, rubbing strips. A polyline
    # [[a, b], ...] in a view, `width` wide.
    for ln in P.get('lines', []):
        pts = np.array(ln['points'], float)
        w = ln.get('width', 0.005)
        for p, q in zip(pts, pts[1:]):
            e = q - p
            n = np.array([-e[1], e[0]]) / max(np.linalg.norm(e), 1e-9) * w / 2
            ext = e / max(np.linalg.norm(e), 1e-9) * w / 2
            quad = [(p - ext + n).tolist(), (q + ext + n).tolist(), (q + ext - n).tolist(), (p - ext - n).tolist()]
            seg = dict(ln, outline=quad)
            # A thin strip must not run onto a surface turning away from the view: there it
            # would smear (a frame line slipping over the tumblehome, a shut line round a corner).
            seg.setdefault('facingMin', 0.45)
            for sign, poly in sides_of(seg):
                out.append((ln['view'], sign, poly, seg, 'decal_trim', ln.get('material', 'rubber'), ln.get('height', 0.0015), None))
    return out


print('FACES before decals', len(bm.faces))
SHAPES = decal_shapes()
for view, sign, poly, d, node, mat, height, hole in SHAPES:
    cut(view, sign, poly, d)
    if hole:
        cut(view, sign, hole, d)
for view, sign, poly, d, node, mat, height, hole in SHAPES:
    tag(view, sign, poly, d, node, mat, height, hole)

print('FACES after decals', len(bm.faces), 'shapes', len(SHAPES))
# The edges where the shell changes material or tag are the lines the drawing
# gives: they are held while the rest is reduced.
keep = set()
for e in bm.edges:
    if len(e.link_faces) == 2 and e.link_faces[0].material_index != e.link_faces[1].material_index:
        keep.update(e.verts)
bm.verts.index_update()
keep = [v.index for v in keep]
bm.to_mesh(body.data)
bm.free()
while len(body.data.materials) < TAG0 + 4 * len(TAGS):
    body.data.materials.append(MAT['paint'])
bpy.context.view_layer.objects.active = body
# The cuts leave fans of small faces along every outline; near-flat runs are merged
# back without crossing a tag or material edge, so every outline stays where it was cut.
mod = body.modifiers.new('dec2', 'DECIMATE')
mod.decimate_type = 'DISSOLVE'
mod.angle_limit = math.radians(P.get('flatDeg', 0.8))
mod.delimit = {'MATERIAL'}
bpy.ops.object.modifier_apply(modifier=mod.name)
mod = body.modifiers.new('tri', 'TRIANGULATE')
mod.quad_method = 'BEAUTY'
mod.ngon_method = 'BEAUTY'
bpy.ops.object.modifier_apply(modifier=mod.name)
print('FACES reduced', len(body.data.polygons))

# ---- patches lifted off the reduced shell ----------------------------------------
PARTS = {}          # node name -> (bmesh, [material names])


def part(node, mat):
    b, mats = PARTS.setdefault(node, (bmesh.new(), []))
    if mat not in mats:
        mats.append(mat)
    return b, mats.index(mat)


def lift(faces, node, mat, height, inset=0.002):
    """Copies `faces` into the part `node` as a slab standing `height` off the skin,
    its walls following the outline."""
    if not faces:
        return
    b, slot = part(node, mat)
    fset = set(faces)
    vmap = {}
    for f in faces:
        for v in f.verts:
            if v not in vmap:
                # The slab's normal: the average of the patch's own faces round the vert.
                n_ = Vector()
                for lf in v.link_faces:
                    if lf in fset:
                        n_ += lf.normal
                n_ = n_.normalized() if n_.length > 1e-9 else Vector(v.normal)
                vmap[v] = (b.verts.new(v.co - n_ * inset), b.verts.new(v.co + n_ * height))
    for f in faces:
        try:
            top = b.faces.new([vmap[v][1] for v in f.verts])
            top.material_index = slot
        except ValueError:
            pass
    # Walls along the patch's boundary edges.
    for f in faces:
        for e in f.edges:
            if sum(1 for lf in e.link_faces if lf in fset) == 1:
                v0, v1 = e.verts
                # Keep the winding of the face that owns the edge.
                loop = next(l for l in e.link_loops if l.face is f)
                a_, b_ = (v0, v1) if loop.vert is v0 else (v1, v0)
                try:
                    w = b.faces.new((vmap[a_][0], vmap[b_][0], vmap[b_][1], vmap[a_][1]))
                    w.material_index = slot
                except ValueError:
                    pass


bm = bmesh.new()
bm.from_mesh(body.data)
bm.normal_update()
by_tag = {}
for f in bm.faces:
    if f.material_index >= TAG0:
        by_tag.setdefault((f.material_index - TAG0) // 4, []).append(f)
for t, (node, mat, height) in enumerate(TAGS):
    lift(by_tag.get(t, []), node, mat, height)
for f in bm.faces:
    if f.material_index >= TAG0:
        f.material_index = (f.material_index - TAG0) % 4
bm.to_mesh(body.data)
bm.free()
while len(body.data.materials) > 4:
    body.data.materials.pop()

# Shading from the full-resolution shell, projected along each corner's own normal,
# so the coarse working mesh shades with the true curvature.
if info.get('loft'):
    # A lofted shell is its own truth: smooth across its gentle bends, crisp at its
    # edges.
    bpy.context.view_layer.objects.active = body
    body.select_set(True)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(P.get('bodySmoothDeg', 32)))
    body.select_set(False)
    bpy.data.objects.remove(dense)
else:
    body.data.shade_smooth()
    dense.data.shade_smooth()
    scene.collection.objects.link(dense)
    bpy.context.view_layer.objects.active = body
    dt = body.modifiers.new('normals', 'DATA_TRANSFER')
    dt.object = dense
    dt.use_loop_data = True
    dt.data_types_loops = {'CUSTOM_NORMAL'}
    dt.loop_mapping = 'POLYINTERP_LNORPROJ'
    bpy.ops.object.modifier_apply(modifier=dt.name)
    bpy.data.objects.remove(dense)


def new_object(name, bm_, mats):
    me = bpy.data.meshes.new(name)
    bm_.normal_update()
    bm_.to_mesh(me)
    bm_.free()
    for m in mats:
        me.materials.append(MAT[m] if isinstance(m, str) else m)
    obj = bpy.data.objects.new(name, me)
    scene.collection.objects.link(obj)
    return obj


part_objects = {node: new_object(node, b, mats) for node, (b, mats) in PARTS.items()}

# ---- solid parts ----------------------------------------------------------------------
_dg = bpy.context.evaluated_depsgraph_get()
_skin = BVHTree.FromObject(body, _dg)


def disc(bm_, centre, normal, radius, depth, segments=20, mat=0, radius2=None):
    r = bmesh.ops.create_cone(bm_, cap_ends=True, segments=segments, radius1=radius,
                              radius2=radius if radius2 is None else radius2, depth=depth)
    rot = Vector((0, 0, 1)).rotation_difference(Vector(normal)).to_matrix().to_4x4()
    bmesh.ops.transform(bm_, matrix=Matrix.Translation(Vector(centre)) @ rot, verts=r['verts'])
    for f in {f for v in r['verts'] for f in v.link_faces}:
        f.material_index = mat
    return r


def box(bm_, centre, size, mat=0, rot=None):
    r = bmesh.ops.create_cube(bm_, size=1.0)
    m = Matrix.Translation(Vector(centre))
    if rot is not None:
        m = m @ rot
    bmesh.ops.transform(bm_, matrix=m @ Matrix.Diagonal((*size, 1)), verts=r['verts'])
    for f in {f for v in r['verts'] for f in v.link_faces}:
        f.material_index = mat
    return r


def sweep(bm_, path, profile, mat=0, closed_ends=True):
    """A closed 2D `profile` [(u, v)] carried along a 3D `path`: u across (horizontal,
    outward), v up."""
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
    if closed_ends:
        faces.append(bm_.faces.new(rings_[0][::-1]))
        faces.append(bm_.faces.new(rings_[-1]))
    for f in faces:
        f.material_index = mat
    return faces


trim_parts = []
# Bumpers: a section swept round the shell's outline at the bumper's height.
for end, b in P.get('bumpers', {}).items():
    path = info['bumperPaths'].get(end)
    if not path:
        continue
    h, dpt = b['z'][1] - b['z'][0], b.get('depth', 0.06)
    style = b.get('profile', 'blade')
    if style == 'round':
        prof = [(dpt / 2 * math.cos(a), h / 2 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 14)[:-1]]
    else:
        # A pressed bar: flat face, rolled top and bottom edges.
        r_ = min(h, dpt) * 0.35
        prof = [(-dpt / 2, -h / 2), (dpt / 2 - r_, -h / 2), (dpt / 2, -h / 2 + r_), (dpt / 2, h / 2 - r_),
                (dpt / 2 - r_, h / 2), (-dpt / 2, h / 2)]
    sgn = 1 if end == 'front' else -1
    # The path runs round the end; the profile's +u must face out of the car.
    pts = [Vector(p) for p in path]
    pts.sort(key=lambda p: p.x * sgn)
    bm_ = bmesh.new()
    sweep(bm_, [tuple(p) for p in pts], prof, 0)
    o = new_object('bumper_' + end, bm_, [b.get('material', 'chrome')])
    trim_parts.append(o)
    if b.get('rubber'):
        # A rubber strip along the bar's face.
        rh = b['rubber']
        bm_ = bmesh.new()
        sweep(bm_, [tuple(p) for p in pts], [(dpt / 2 - 0.004, -rh / 2), (dpt / 2 + 0.008, -rh / 2),
                                            (dpt / 2 + 0.008, rh / 2), (dpt / 2 - 0.004, rh / 2)], 0)
        trim_parts.append(new_object('bumper_rubber_' + end, bm_, ['rubber']))
    for ov in b.get('overriders', []):
        bm_ = bmesh.new()
        x, w_, z0, z1 = ov
        y_face = min(p.y for p in pts) if end == 'front' else max(p.y for p in pts)
        for s_ in (1, -1):
            # Through the bar, standing 15 mm proud of its face.
            box(bm_, (s_ * x, y_face - sgn * 0.0075, (z0 + z1) / 2), (w_, dpt + 0.015, z1 - z0), 0)
        trim_parts.append(new_object('overriders_' + end, bm_, [b.get('material', 'chrome')]))


def skin_point(origin, direction, dist=3.0):
    hit = _skin.ray_cast(Vector(origin), Vector(direction).normalized(), dist)
    return hit[0], hit[1]


# Lamps that stand out of the body in their own pods (the Mini's, the Beetle's, the
# 2CV's): {node, x, z, r, end, material, bezel, pod (paint housing), tilt}. The lens
# faces straight along the car at the drawn position; a housing reaches back from it
# until it buries itself in the skin, so the lamp never floats.
LAMP_SOLID = {}
for lp in P.get('podLamps', []):
    sgn_end = -1 if lp.get('end', 'front') == 'front' else 1
    for sx in ((1, -1) if lp.get('mirror', True) else (1,)):
        node = lp['node']
        if node.endswith('_left') and sx != 1 or node.endswith('_right') and sx != -1:
            continue
        x, z, r = sx * lp['x'], lp['z'], lp['r']
        # Where the skin is under the rim, along the car.
        far = []
        for a in np.linspace(0, 2 * math.pi, 12, endpoint=False):
            o = Vector((x + r * math.cos(a), sgn_end * (L / 2 + 1.0), z + r * math.sin(a)))
            hit, _ = skin_point(o, (0, -sgn_end, 0), L + 2)
            if hit is not None:
                far.append(hit.y)
        hitc, _ = skin_point((x, sgn_end * (L / 2 + 1.0), z), (0, -sgn_end, 0), L + 2)
        ys_ = far + ([hitc.y] if hitc is not None else [])
        if not ys_:
            continue
        y_face = (min(ys_) if sgn_end < 0 else max(ys_)) + sgn_end * lp.get('proud', 0.015)
        y_back = max(ys_) if sgn_end < 0 else min(ys_)
        y_back -= sgn_end * 0.03
        n_ = (0, sgn_end, 0)
        b_, mats = LAMP_SOLID.setdefault(node, (bmesh.new(), [lp.get('material', 'Headlights')]))
        disc(b_, (x, y_face + sgn_end * 0.004, z), n_, r, 0.012, 24, 0)
        tb = bmesh.new()
        bz = lp.get('bezel', 0.014)
        disc(tb, (x, y_face - sgn_end * 0.001, z), n_, r + bz, 0.012, 24, 0)
        trim_parts.append(new_object('pod_rim', tb, [lp.get('bezelMaterial', 'chrome')]))
        if lp.get('pod', True) and abs(y_back - y_face) > 0.01:
            pb = bmesh.new()
            # Never longer than the pod the car has; it tapers into the wing.
            depth = min(abs(y_back - y_face), lp.get('podDepth', 0.16))
            y_back = y_face - sgn_end * depth
            disc(pb, (x, (y_face + y_back) / 2, z), n_, r * 0.75, depth, 24, 0, r + bz * 0.8)
            trim_parts.append(new_object('pod', pb, ['paint']))
for node, (b_, mats) in LAMP_SOLID.items():
    if node in part_objects:
        # Join with the patches that already share the node.
        o = new_object(node + '_pod', b_, mats)
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        part_objects[node].select_set(True)
        bpy.context.view_layer.objects.active = part_objects[node]
        bpy.ops.object.join()
    else:
        part_objects[node] = new_object(node, b_, mats)

# Mirrors: {y, z (where the arm leaves the door, the window's front corner), reach (the
# head's outer edge), w, h, shape: rect|round, material (the housing)}. A sail on the
# door, a short arm, and a housing drawn out 6 cm and tapering forward, its glass set
# into the back.
def mirror_head(bm_, c, w_, h_, d_, shape, s_):
    """Housing (slot 0) round c, its back face (+y) holding the glass (slot 1)."""
    if shape == 'round':
        ring = circle((0, 0), w_ / 2, 20)
    else:
        ring = rounded_rect((0, 0), w_, h_, min(w_, h_) * 0.32, 4)
    n = len(ring)
    rows = []
    for yo, k in ((-d_ / 2, 0.82), (d_ * 0.1, 1.0), (d_ / 2, 1.0)):
        rows.append([bm_.verts.new((c[0] + a * k, c[1] + yo, c[2] + b * k)) for a, b in ring])
    glass = [bm_.verts.new((c[0] + a * 0.86, c[1] + d_ / 2 - 0.004, c[2] + b * 0.86)) for a, b in ring]
    for r0, r1 in zip(rows, rows[1:]):
        for i in range(n):
            bm_.faces.new((r0[i], r0[(i + 1) % n], r1[(i + 1) % n], r1[i]))
    for i in range(n):
        f = bm_.faces.new((rows[-1][i], rows[-1][(i + 1) % n], glass[(i + 1) % n], glass[i]))
    bm_.faces.new(rows[0][::-1])
    f = bm_.faces.new(glass)
    f.material_index = 1


m = P.get('mirror')
if m and info.get('mirrorAt') and not m.get('fixed'):
    # A traced glasshouse says where the door's window begins: the mirror stands at its
    # front lower corner.
    m = dict(m, y=info['mirrorAt'][0] + 0.05, z=info['mirrorAt'][1] + 0.05)
if m:
    bm_ = bmesh.new()
    w_, h_ = m.get('w', 0.13), m.get('h', 0.08)
    for s_ in m.get('sides', (1, -1)):
        hit, nrm = skin_point((s_ * 1.5, m['y'], m['z']), (-s_, 0, 0))
        x0 = hit.x if hit else s_ * W / 2
        x1 = s_ * m.get('reach', abs(x0) + 0.13)
        xc = x1 - s_ * w_ / 2
        # the sail, lying on the door
        box(bm_, (x0 + s_ * 0.004, m['y'] + 0.01, m['z']), (0.016, 0.09, 0.06), 0)
        # the arm, from the sail to the housing's inner edge, under its middle
        arm = abs((xc - s_ * w_ * 0.3) - x0)
        if arm > 0.005:
            box(bm_, (x0 + s_ * arm / 2, m['y'] + 0.015, m['z'] - h_ * 0.15), (arm, 0.035, min(0.03, h_ * 0.4)), 0)
        mirror_head(bm_, (xc, m['y'] + 0.02, m['z']), w_, h_, 0.06, m.get('shape', 'rect'), s_)
    bmesh.ops.recalc_face_normals(bm_, faces=bm_.faces)
    trim_parts.append(new_object('mirrors', bm_, [m.get('material', 'trim'), 'chrome']))

# Door handles: {y, z, w} on the door's skin.
hd = P.get('handles')
if hd:
    bm_ = bmesh.new()
    for y, z in hd['at']:
        for s_ in (1, -1):
            hit, nrm = skin_point((s_ * 1.5, y, z), (-s_, 0, 0))
            if hit is None:
                continue
            box(bm_, (hit.x + s_ * 0.008, y, z), (0.016, hd.get('w', 0.12), hd.get('h', 0.022)), 0)
    trim_parts.append(new_object('handles', bm_, [hd.get('material', 'chrome')]))

# Wipers: parked arms along the base of the windscreen.
wp = P.get('wipers')
if wp:
    bm_ = bmesh.new()
    for x0, x1, y, z in wp['arms']:
        if info.get('screenFoot'):
            # parked just above the screen's foot
            y = info['screenFoot'][0] + 0.05
        hit, nrm = skin_point(((x0 + x1) / 2, y, H + 0.5), (0, 0, -1))
        zc = hit.z + 0.012 if hit else z
        d = Vector((x1 - x0, 0, 0))
        box(bm_, ((x0 + x1) / 2, y, zc), (abs(x1 - x0), 0.014, 0.012), 0)
    trim_parts.append(new_object('wipers', bm_, ['trim']))

# The underside. The body's own bottom closes it flush along the sills; below that
# hangs only what really sets a car's ground clearance: the sump and the subframe
# (the engine at the back of a rear-engined car), the rear axle with its diff and the
# propshaft on a driven rear axle, a front diff on four-wheel drive, the chassis rails
# of a body on a frame. The lowest of them sits at the published clearance, which is
# what the runtime fits the body's bottom to. {engine: 'front'|'rear', frame: bool}.
ub = P.get('underbody', {})
_roster = open(os.path.join(ROOT, 'src/vehicle/roster.ts')).read()
_m = re.search(r"id: 'rs_%s'.*?rearDriveBias: ([\d.]+)" % car, _roster, re.S)
rear_bias = ub.get('rearBias', float(_m.group(1)) if _m else 0.0)
C = F['clearance']
yA, yB = AXLES[0][0], AXLES[1][0]
inner = min(F['frontTrack'], F['rearTrack']) / 2 - F['tyreWidth'] / 2 - 0.04


def floor_at(y_):
    """The body's bottom at y on the centre line."""
    hit, _n = skin_point((0, y_, -0.5), (0, 0, 1), 4.0)
    return hit.z if hit is not None else min(info['sill'])


def hang(bm_, x0, x1, y0, y1, z_bottom):
    """A block from z_bottom up into the body (its top buried 3 cm in the floor)."""
    z_top = max(floor_at(y_) for y_ in np.linspace(y0, y1, 4)) + 0.03
    if z_top > z_bottom:
        box(bm_, ((x0 + x1) / 2, (y0 + y1) / 2, (z_bottom + z_top) / 2), (x1 - x0, y1 - y0, z_top - z_bottom), 0)


bm_ = bmesh.new()
rear_engine = ub.get('engine', 'front') == 'rear'
ye = yB if rear_engine else yA
# Sump and gearbox, and a crossmember (the subframe) across the engine bay.
hang(bm_, -0.17, 0.17, ye - 0.12, ye + 0.22 if not rear_engine else ye + 0.32, C)
hang(bm_, -inner + 0.06, inner - 0.06, ye + 0.02, ye + 0.10, C + 0.07)
if rear_bias > 0 and not rear_engine:
    # A driven rear axle: the casing between the wheels at hub height, the diff, and the
    # propshaft just under the tunnel.
    disc(bm_, (0, yB, R), (1, 0, 0), 0.045, 2 * inner, segments=12)
    hang(bm_, -0.15, 0.15, yB - 0.13, yB + 0.13, C + 0.005)
    z_ps = max(floor_at((yA + yB) / 2) - 0.03, C + 0.04)
    disc(bm_, (0, (yA + 0.22 + yB - 0.13) / 2, z_ps), (0, 1, 0), 0.035, (yB - 0.13) - (yA + 0.22), segments=10)
if 0 < rear_bias < 1:
    hang(bm_, -0.05, 0.22, yA - 0.12, yA + 0.12, C + 0.02)
    if ub.get('frame'):
        disc(bm_, (0, yA, R), (1, 0, 0), 0.045, 2 * inner, segments=12)
if ub.get('frame'):
    # The chassis rails, under the body from end to end, following its floor.
    xr = inner - 0.22
    ys_ = np.linspace(-L / 2 + 0.3, L / 2 - 0.25, 12)
    for y0_, y1_ in zip(ys_, ys_[1:]):
        zf = floor_at((y0_ + y1_) / 2)
        for sx in (1, -1):
            box(bm_, (sx * xr, (y0_ + y1_) / 2, zf - 0.05), (0.07, y1_ - y0_ + 0.01, 0.16), 0)
trim_parts.append(new_object('underbody', bm_, ['trim']))

# Arch flares and lips: a band round each wheel arch standing off the body side, built
# on the skin itself so it neither floats nor tears where the side turns into the well.
# {axle: 'front'|'rear'|'both', r (inner radius), w (band width), t (stand-off), material}.
for fl in P.get('archFlares', []):
    bm_ = bmesh.new()
    axles = {'front': [AXLES[0]], 'rear': [AXLES[1]], 'both': AXLES}[fl.get('axle', 'both')]
    za = R + fl.get('lift', 0.0)
    r0, w, t = fl['r'], fl.get('w', 0.05), fl.get('t', 0.02)
    radii = np.linspace(r0, r0 + w, 4)
    for ya, _tr in axles:
        for s_ in (1, -1):
            rows = []
            for a in np.linspace(math.radians(fl.get('from', 0)), math.radians(180 - fl.get('from', 0)), 49):
                row = []
                for rr in radii:
                    y_, z_ = ya - rr * math.cos(a), za + rr * math.sin(a)
                    hit, _n = skin_point((s_ * 1.5, y_, z_), (-s_, 0, 0))
                    row.append(None if hit is None else hit.x)
                rows.append((a, row))
            # The band runs from the top of the arch down each leg for as long as the side
            # is there and carries on smoothly: where the skin is missing (past the body's
            # end) or jumps inwards (into the wheel well, under the sill) it stops, rather
            # than folding into a tab.
            mid = len(rows) // 2
            keep = set()
            for step in (1, -1):
                prev = None
                for i in range(mid, len(rows) if step > 0 else -1, step):
                    xs_ = rows[i][1]
                    if None in xs_ or max(xs_) - min(xs_) > 0.03 or (prev is not None and abs(xs_[0] - prev) > 0.02):
                        break
                    keep.add(i)
                    prev = xs_[0]
            # Each ring: the lip turned in over the arch's cut edge (the voxel hull leaves it
            # ragged, and a band starting on it shows the tears), the band's face across
            # (standing t off the most outward point of the skin beneath it, so the side
            # cannot show through), the skin under the outer edge.
            r_in = r0 - fl.get('lip', 0.03)
            rings = []
            for i in sorted(keep):
                a, xs_ = rows[i]
                out_x = max(x_ * s_ for x_ in xs_) * s_ + s_ * t
                pts = ([(out_x - s_ * (t + 0.04), r_in), (out_x, r_in)] + [(out_x, rr) for rr in radii]
                       + [(xs_[-1] - s_ * 0.01, radii[-1])])
                rings.append([bm_.verts.new((x_, ya - rr * math.cos(a), za + rr * math.sin(a))) for x_, rr in pts])
            for r_a, r_b in zip(rings, rings[1:]):
                for k in range(len(r_a) - 1):
                    q = (r_a[k], r_a[k + 1], r_b[k + 1], r_b[k])
                    bm_.faces.new(q if s_ > 0 else q[::-1])
    bmesh.ops.recalc_face_normals(bm_, faces=bm_.faces)
    trim_parts.append(new_object('flare', bm_, [fl.get('material', 'trim')]))

# Spare wheels on a tail door or a bonnet: {c, n (the way it faces), r, w}, a tyre with
# its rim and hub.
for sp in P.get('spares', []):
    bm_ = bmesh.new()
    c, n_ = Vector(sp['c']), Vector(sp.get('n', (0, 1, 0))).normalized()
    r, w = sp['r'], sp.get('w', 0.2)
    disc(bm_, c, n_, r * 0.97, w * 0.8, 28, 0, r * 0.97)
    disc(bm_, c + n_ * (w * 0.4), n_, r * 0.88, 0.01, 28, 0, r * 0.85)
    disc(bm_, c + n_ * (w * 0.42), n_, r * 0.6, 0.02, 24, 1)
    disc(bm_, c + n_ * (w * 0.44), n_, r * 0.22, 0.03, 16, 1)
    trim_parts.append(new_object('spare', bm_, ['Tyres', sp.get('rim', 'wheel_rim')]))

# Extra hand-placed solid boxes (aerials, spare wheel carriers, roof racks...).
for bx in P.get('boxes', []):
    bm_ = bmesh.new()
    for s_ in ((1, -1) if bx.get('mirror', True) else (1,)):
        c = list(bx['c'])
        c[0] *= s_
        box(bm_, c, bx['size'], 0)
    trim_parts.append(new_object('box', bm_, [bx.get('material', 'trim')]))

# ---- wheels -------------------------------------------------------------------------
def lathe(bm_, profile, segments, mat):
    """Revolves [(r, x)] about the X axis (x across the wheel)."""
    rings = []
    for k in range(segments):
        a = 2 * math.pi * k / segments
        ca, sa = math.cos(a), math.sin(a)
        rings.append([bm_.verts.new((x, r * ca, r * sa)) for r, x in profile])
    for k in range(segments):
        r0, r1 = rings[k], rings[(k + 1) % segments]
        for j in range(len(profile) - 1):
            f = bm_.faces.new((r0[j], r0[j + 1], r1[j + 1], r1[j]))
            f.material_index = mat


wheel = P.get('wheel', {'style': 'hubcap'})
tw = F['tyreWidth']
rim_r = R * wheel.get('rimFactor', 0.66)
for name, (axle_y, track), side in (('wheel_fl', AXLES[0], 1), ('wheel_fr', AXLES[0], -1),
                                    ('wheel_rl', AXLES[1], 1), ('wheel_rr', AXLES[1], -1)):
    bm_ = bmesh.new()
    s = side
    # Tyre: a rounded section, sidewalls bulging past the rim.
    hw = tw / 2
    prof = [(rim_r * 0.98, -s * hw * 0.82), (R * 0.86, -s * hw), (R * 0.97, -s * hw * 0.9), (R, -s * hw * 0.6),
            (R, s * hw * 0.6), (R * 0.97, s * hw * 0.9), (R * 0.86, s * hw), (rim_r * 0.98, s * hw * 0.82)]
    lathe(bm_, prof, 32, 0)
    face_x = s * hw * 0.78
    st = wheel.get('style', 'hubcap')
    if st == 'steel':
        # A painted steel disc dished inwards with a ring of slots, a small centre cap.
        lathe(bm_, [(rim_r, face_x), (rim_r * 0.92, face_x - s * 0.01), (rim_r * 0.6, face_x - s * 0.02),
                    (rim_r * 0.35, face_x - s * 0.005), (rim_r * 0.33, face_x + s * 0.004), (0.0, face_x + s * 0.006)], 24, 1)
        n_win = wheel.get('windows', 4)
        for k in range(n_win):
            a = 2 * math.pi * (k + 0.5) / n_win
            rm = rim_r * 0.74
            box(bm_, (face_x - s * 0.013, rm * math.cos(a), rm * math.sin(a)), (0.004, rim_r * 0.18, rim_r * 0.3), 0,
                Matrix.Rotation(a, 4, 'X'))
        if wheel.get('cap'):
            lathe(bm_, [(rim_r * 0.42, face_x), (rim_r * 0.4, face_x + s * 0.012), (0.0, face_x + s * 0.02)], 20, 2)
    elif st == 'hubcap':
        # A painted steel rim, its lip and a dished face, under a domed chrome cap.
        cap = wheel.get('cap', 0.62)
        lathe(bm_, [(rim_r, face_x), (rim_r * 0.94, face_x - s * 0.006), (rim_r * 0.86, face_x - s * 0.022),
                    (rim_r * cap, face_x - s * 0.02)], 24, 1)
        lathe(bm_, [(rim_r * cap, face_x - s * 0.02), (rim_r * cap * 0.98, face_x + s * 0.004),
                    (rim_r * cap * 0.8, face_x + s * 0.016), (rim_r * cap * 0.4, face_x + s * 0.024), (0.0, face_x + s * 0.026)], 24, 2)
    elif st in ('alloy', 'spokes'):
        # Cast spokes: a shallow dish, `spokes` arms, a centre cap.
        lathe(bm_, [(rim_r, face_x), (rim_r * 0.94, face_x - s * 0.006), (rim_r * 0.9, face_x - s * 0.03),
                    (0.0, face_x - s * 0.03)], 24, 0)
        n_sp = wheel.get('spokes', 5)
        for k in range(n_sp):
            a = 2 * math.pi * k / n_sp
            wsp = wheel.get('spokeWidth', 0.35) * rim_r * 2 * math.pi / n_sp / 2
            box(bm_, (face_x - s * 0.012, rim_r * 0.55 * math.cos(a), rim_r * 0.55 * math.sin(a)),
                (0.02, rim_r * 0.8, wsp), 1, Matrix.Rotation(a, 4, 'X'))
        lathe(bm_, [(rim_r, face_x + s * 0.002), (rim_r * 0.9, face_x + s * 0.002)], 24, 1)
        lathe(bm_, [(rim_r * 0.3, face_x - s * 0.005), (rim_r * 0.28, face_x + s * 0.004), (0.0, face_x + s * 0.006)], 16, 1)
    elif st == 'fuchs':
        # Five forged petals, black between them, polished lip.
        lathe(bm_, [(rim_r, face_x), (rim_r * 0.92, face_x - s * 0.004), (rim_r * 0.9, face_x - s * 0.025),
                    (0.0, face_x - s * 0.025)], 24, 3)
        for k in range(5):
            a = 2 * math.pi * k / 5
            box(bm_, (face_x - s * 0.01, rim_r * 0.52 * math.cos(a), rim_r * 0.52 * math.sin(a)),
                (0.02, rim_r * 0.78, rim_r * 0.42), 1, Matrix.Rotation(a, 4, 'X'))
        lathe(bm_, [(rim_r, face_x + s * 0.002), (rim_r * 0.92, face_x + s * 0.002)], 24, 2)
        lathe(bm_, [(rim_r * 0.3, face_x - s * 0.005), (0.0, face_x + s * 0.006)], 16, 1)
    mats = ['Tyres', 'wheel_rim', 'chrome', 'trim']
    obj = new_object(name, bm_, mats)
    obj.location = (side * track / 2, axle_y, R)

# ---- shading and export -------------------------------------------------------------
for obj in scene.objects:
    if obj.type == 'MESH' and obj is not body:
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(P.get('smoothAngleDeg', 40)))
        obj.select_set(False)

# Glass out of the shell into its own node.
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='DESELECT')
body.active_material_index = SLOT['glass']
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.quads_convert_to_tris()
bpy.ops.mesh.select_all(action='DESELECT')
bpy.ops.object.material_slot_select()
bpy.ops.mesh.separate(type='SELECTED')
bpy.ops.object.mode_set(mode='OBJECT')
for o in scene.objects:
    if o.name.startswith('paint.'):
        o.name = 'glass'
        o.data.name = 'glass'
LAMP_NODES = {'headlights', 'taillights', 'reverse_lights', 'brake_lights', 'front_blinker_left',
              'front_blinker_right', 'rear_blinker_left', 'rear_blinker_right'}
join = [o for o in trim_parts] + [o for n, o in part_objects.items() if n not in LAMP_NODES]
for o in part_objects.values():
    if o.name in LAMP_NODES:
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.quads_convert_to_tris()
        bpy.ops.object.mode_set(mode='OBJECT')
        o.select_set(False)
bpy.ops.object.select_all(action='DESELECT')
if join:
    for o in join:
        o.select_set(True)
    bpy.context.view_layer.objects.active = join[0]
    bpy.ops.object.join()
    join[0].name = 'trim'
    join[0].data.name = 'trim'

# What the runtime will do to this body: it scales it to the factory width (measured
# on the lower 55%), height minus clearance and length. All three should be ~1.
lo = Vector((1e9, 1e9, 1e9))
hi = -lo
for o in scene.objects:
    if o.type != 'MESH' or o.name.startswith('wheel_'):
        continue
    for v in o.data.vertices:
        w = o.matrix_world @ v.co
        lo = Vector(map(min, lo, w))
        hi = Vector(map(max, hi, w))
cut_z = lo.z + (hi.z - lo.z) * 0.55
xs_low = [abs((o.matrix_world @ v.co).x) for o in scene.objects if o.type == 'MESH' and not o.name.startswith('wheel_')
          and o.name != 'mirrors' for v in o.data.vertices if (o.matrix_world @ v.co).z <= cut_z]
sx = W / (2 * max(xs_low))
sz = (H - F['clearance']) / (hi.z - lo.z)
sy = L / (hi.y - lo.y)
print(f'SCALE {car}: width {sx:.3f} height {sz:.3f} length {sy:.3f} (bottom {lo.z:.3f}, top {hi.z:.3f}, '
      f'nose {lo.y:.3f}, tail {hi.y:.3f})')

faces = sum(len(o.data.polygons) for o in scene.objects if o.type == 'MESH')
print(f'ASSEMBLE {car}: {faces} faces, ' + ', '.join(f'{o.name} {len(o.data.polygons)}' for o in scene.objects if o.type == 'MESH'))
bpy.ops.export_scene.gltf(filepath=out_glb, export_format='GLB', export_yup=True, export_apply=True)

if preview:
    sc = scene
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
    target = Vector((0, 0, H * 0.45))
    views = {'front34': Vector((L * 0.95, -L * 1.2, H * 1.1)), 'side': Vector((L * 1.75, 0, H * 0.5)),
             'rear34': Vector((-L * 0.95, L * 1.2, H * 1.2)), 'front': Vector((0, -L * 1.9, H * 0.55)),
             'rear': Vector((0, L * 1.9, H * 0.6)),
             # Low and close, where the chase camera sits: the underside, the tail's
             # edges and the soft shapes show here and hide in the high views.
             'lowrear': Vector((-W * 0.9, L * 1.05, 0.42)), 'lowfront': Vector((W * 0.9, -L * 1.05, 0.42))}
    aims = {'lowrear': Vector((0, L * 0.3, H * 0.32)), 'lowfront': Vector((0, -L * 0.3, H * 0.32))}
    for name, pos in views.items():
        cam.location = pos
        cam.rotation_euler = (aims.get(name, target) - pos).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = preview.replace('.png', f'-{name}.png')
        bpy.ops.render.render(write_still=True)
    # Zebra: a striped reflection shows every wave and dent the way the game's sun does.
    sc.display.shading.light = 'MATCAP'
    sc.display.shading.studio_light = 'check_reflection_horizontal.exr'
    sc.display.shading.color_type = 'SINGLE'
    for name in ('front34', 'rear34', 'side'):
        pos = views[name]
        cam.location = pos
        cam.rotation_euler = (target - pos).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = preview.replace('.png', f'-z{name}.png')
        bpy.ops.render.render(write_still=True)
