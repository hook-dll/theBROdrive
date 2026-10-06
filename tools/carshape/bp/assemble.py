"""Turns a blueprint shell (hull.py) into a game car: glass, lamps, grille, bumpers,
trim and wheels, all placed from the same drawing.

    blender --background --factory-startup --python tools/carshape/bp/assemble.py -- <car> <out.glb> [preview.png]

Everything the drawing shows on the skin is PROJECTED onto the skin from the view it is
drawn in: an outline read off the front view (a headlamp, the grille, the plate) is cut
into the shell along that outline and lifted off it as its own part, so it follows the
nose's real curvature, sits where the drawing puts it and has the drawing's shape. The
glass is the same cut, left in the shell on its own material (or, with `glassOverlay`,
laid over the shell as its exact outline: see the glass stage). Bumpers run round the
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
# A key nothing reads does nothing, silently: the Fulvia's `glassSeal` and
# `pillarReach` sat beside `parts` instead of in it for a dozen passes (rubber seals
# where it asked for chrome, the door glass pushed forward into the screen it was told
# to leave alone), its `paneEdgeRelax` in `hull`. Every key must be one this stage or
# hull.py reads (`KEYS` in hull.py for the hull's own).
CAR_KEYS = {'id', 'label', 'factory', 'blueprint', 'hull', 'parts'}
PARTS_KEYS = {'archFlares', 'bars', 'boxes', 'bumpers', 'decals', 'flatDeg', 'glass', 'glassCheck', 'glassFit', 'glassOverlay',
              'glassSeal', 'handles', 'lensColours', 'lines', 'mirror', 'paint2', 'paneEdgeRelax', 'pillar',
              'pillarReach', 'podLamps', 'regions', 'smoothAngleDeg', 'spares', 'underbody', 'wheel', 'widenMax',
              'wipers'}
_bad = sorted(set(spec) - CAR_KEYS) + sorted(f'parts.{k}' for k in set(P) - PARTS_KEYS)
if _bad:
    sys.exit(f'KEYS {car}: nothing reads {_bad} (misplaced or misspelt)')
# No number plates (nor blank plate patches): every part drawn in the plate's
# materials is dropped, whatever list it sits in.
P = {k: [d for d in v if not (isinstance(d, dict) and d.get('material') in ('plate', 'plate_ink'))]
     if isinstance(v, list) else v for k, v in P.items()}
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
    iso = d.get('iso')
    for f in bm.faces:
        if iso:
            # after iso_cut: a face is in when its corners are, so the edge is the cut line
            if sum(v.normal.dot(facing) for v in f.verts) / len(f.verts) < lim - 1e-3:
                continue
        elif f.normal.dot(facing) < lim:
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
    _VIS_TREE.clear()
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


_VIS_TREE = {}


def select(view, sign, poly, d, hole=None):
    V = VIEW[view]
    a_, b_ = V['a'], V['b']
    out = []
    tree = None
    if d.get('visible'):
        # Only what the view itself sees there: the first surface a ray along the view
        # meets (a sloping nose's lamps, not the bonnet top behind them).
        tree = _VIS_TREE.get('t') or BVHTree.FromBMesh(bm)
        _VIS_TREE['t'] = tree
        look = -(Vector((sign, 0, 0)) if view == 'side' else V['facing'])
        idx = {f: i for i, f in enumerate(bm.faces)}
    for f in candidates(view, sign, poly, d):
        c = f.calc_center_median()
        if inside(poly, c[a_], c[b_]) and not (hole and inside(hole, c[a_], c[b_])):
            if tree is not None:
                hit = tree.ray_cast(c - look * 3.0, look, 6.0)
                if hit[0] is None or (hit[0] - c).length > 0.01:
                    continue
            out.append(f)
    return out


# ---- glass: cut into the shell ------------------------------------------------------
GL = P.get('glass', [])
glass_faces = set()


def ragged(view, sign, poly, d):
    """Faces inside the outline that the view does not see, next to ones it does: where
    a pane's edge would follow the surface's turn instead of the drawn line."""
    inside_all = set(select(view, sign, poly, dict(d, facingMin=-1.0)))
    seen = set(select(view, sign, poly, d))
    return sum(1 for f in inside_all - seen if any(o in seen for e in f.edges for o in e.link_faces))


def clip_below(poly, cap):
    """The part of an outline below the height `cap` (its slanted edges kept)."""
    out = []
    for p, q in zip(poly, poly[1:] + poly[:1]):
        pin, qin = p[1] <= cap, q[1] <= cap
        if pin:
            out.append(list(p))
        if pin != qin:
            t = (cap - p[1]) / (q[1] - p[1])
            out.append([p[0] + (q[0] - p[0]) * t, cap])
    return out


def fit_pane(view, sign, poly, d, ks=None):
    """A screen drawn a little wider than the shell's glasshouse would end raggedly on
    the pillars: its outline is brought in, a centimetre at a time, until it lies on
    the surface the view sees."""
    if d.get('fit') is False:
        return poly
    key = (view, id(d))
    if view == 'side':
        # A side window lies on the glasshouse's near-upright side: its header comes
        # down to just under where the side turns over into the roof (past
        # `sideFit`), measured by ray at stations along it; its drawn straight
        # edges are kept.
        if ks is not None:
            return clip_below(poly, ks)
        tree = _VIS_TREE.get('t') or BVHTree.FromBMesh(bm)
        _VIS_TREE['t'] = tree
        lim = d.get('sideFit', 0.6)
        arr = np.array(poly, float)
        a0, a1 = arr[:, 0].min(), arr[:, 0].max()
        hi = arr[:, 1].max()
        cap = hi
        for a_ in np.linspace(a0 + 0.05, a1 - 0.05, 9):
            # the outline's own top at this station
            tops = []
            for p, q in zip(poly, poly[1:] + poly[:1]):
                if (p[0] - a_) * (q[0] - a_) <= 0 and p[0] != q[0]:
                    tops.append(p[1] + (q[1] - p[1]) * (a_ - p[0]) / (q[0] - p[0]))
            # (only along the header: the slanted ends follow the pillars)
            if not tops or max(tops) < hi - 0.02:
                continue
            for z_ in np.arange(max(tops), max(tops) - 0.20, -0.005):
                hit = tree.ray_cast(Vector((sign * 2.0, a_, z_)), Vector((-sign, 0, 0)), 4.0)
                # the turn over into the roof only (across the car), not a pillar's
                # turn towards the screen
                if hit[0] is not None and hit[1].x * sign >= lim * math.hypot(hit[1].x, hit[1].z):
                    if z_ < max(tops) - 0.004:
                        cap = min(cap, z_ - 0.01)
                    break
        if cap < hi - 0.005:
            print(f'PANE {car} (side) header {hi:.3f} -> {cap:.3f}')
        FIT_KS[key] = cap
        return clip_below(poly, cap)
    elif d.get('facingMin', 0.2) >= 0:
        # a screen lies on the end it looks out of, not round its corners into the
        # sides or over into the roof: fitted to 60 % of its own mean facing (an
        # upright back light 0.55, a fastback's hatch glass lying at 20 deg ~0.2;
        # a fixed 0.55 took the hatch's glass away)
        fs = select(view, sign, poly, d)
        V_ = VIEW[view]
        a_ = sum(f.calc_area() for f in fs)
        mf = sum(f.normal.dot(V_['facing']) * f.calc_area() for f in fs) / a_ if a_ > 0 else 1.0
        d = dict(d, facingMin=max(d.get('facingMin', 0.2), min(d.get('endFit', 0.55), 0.6 * mf)))
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
    limits = (0, 6, 10) if view == 'side' else (10, 12, 8)
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
    FIT_KS[key] = ks
    return moved(*ks)


def iso_cut(view, sign, poly, d):
    """Cuts the shell inside an outline along the line where it turns past the view's
    facing limit, so a pane that runs onto a surface turning away (a tumblehome, a
    fastback's shoulders) ends in a smooth edge, not in the teeth of whole triangles."""
    V = VIEW[view]
    facing = Vector((sign, 0, 0)) if view == 'side' else V['facing'].copy()
    lim = d.get('facingMin', 0.2)
    bm.normal_update()
    region = select(view, sign, poly, dict(d, facingMin=-1.0))
    val = {}
    for f in region:
        for v in f.verts:
            if v not in val:
                val[v] = v.normal.dot(facing) - lim
    edges = {e for f in region for e in f.edges
             if all(v in val for v in e.verts) and val[e.verts[0]] * val[e.verts[1]] < 0
             and min(abs(val[e.verts[0]]), abs(val[e.verts[1]])) > 1e-4}
    new = set()
    for e in edges:
        v0, v1 = e.verts
        t = val[v0] / (val[v0] - val[v1])
        n0, n1 = v0.normal.copy(), v1.normal.copy()
        _e, nv = bmesh.utils.edge_split(e, v0, t)
        nv.normal = n0.lerp(n1, t).normalized()
        new.add(nv)
    faces = {f for v in new for f in v.link_faces}
    for f in faces:
        vs = [v for v in f.verts if v in new]
        if len(vs) == 2 and not any(e for e in vs[0].link_edges if e.other_vert(vs[0]) is vs[1]):
            try:
                bmesh.ops.connect_verts(bm, verts=vs)
            except Exception:
                pass
    # the new corners' normals: their own, kept for the selection
    for v in new:
        v.normal = v.normal.normalized()


def along_pane(ln):
    """A line drawn along a pane's edge in the same view (a window's frame or rubber):
    most of its length within 5 cm of the edge of a pane's outline."""
    pts = np.array(ln['points'], float)
    if len(pts) < 2 or ln.get('width', 0.005) > 0.03:
        return False
    edges = []
    for g in GL:
        if g['view'] != ln['view'] or 'outline' not in g:
            continue
        o = np.array(g['outline'], float)
        edges += list(zip(o, np.roll(o, -1, axis=0)))
        if ln['view'] in ('front', 'rear'):
            om = o * np.array([-1, 1])
            edges += list(zip(om, np.roll(om, -1, axis=0)))
    if not edges:
        return False
    samples = []
    for p, q in zip(pts, pts[1:]):
        n_ = max(2, int(np.linalg.norm(q - p) / 0.02))
        samples += [p + (q - p) * t for t in np.linspace(0, 1, n_)]
    near = 0
    for s_ in samples:
        dmin = min(np.linalg.norm(s_ - (a + np.clip(np.dot(s_ - a, b - a) / max(np.dot(b - a, b - a), 1e-12), 0, 1) * (b - a)))
                   for a, b in edges)
        near += dmin < 0.05
    return near / len(samples) > 0.7


FRAME_LINES = [ln for ln in P.get('lines', []) if along_pane(ln)]
_mats = [ln.get('material', 'rubber') for ln in FRAME_LINES]
SEAL = P.get('glassSeal', {'material': max(set(_mats), key=_mats.count) if _mats else 'rubber'})
SEAL.setdefault('width', 0.012 if SEAL['material'] == 'chrome' else 0.014)
print('SEAL', car, SEAL, 'frame lines dropped', len(FRAME_LINES))

_glass_tree = BVHTree.FromBMesh(bm)


def skin_point_g(origin, direction, dist=3.0):
    """skin_point for the glass stage, on the shell as it stands before the parts."""
    hit = _glass_tree.ray_cast(Vector(origin), Vector(direction).normalized(), dist)
    return hit[0], hit[1]


def widen_screen(g):
    """A screen or back light reaches out to its pillars: the whole outline is stretched
    across by one factor, found where the pane is widest above its foot, so the pillars
    there are `pillar` wide (the drawn panes stopped short and left pillars twice as wide
    as the car's); one factor keeps the outline's own smooth shape."""
    if g['view'] not in ('front', 'rear') or 'outline' not in g or g.get('widen') is False:
        return g
    if g.get('facingMin', 0.2) < 0:
        return g            # a pane already wrapping round onto the sides
    pil = g.get('pillar', P.get('pillar', 0.05))
    sgn = -1 if g['view'] == 'front' else 1
    pts_ = g['outline']
    lo_b = min(q[1] for q in pts_)
    hi_b = max(q[1] for q in pts_)
    ratios = []
    for a_, b_ in pts_:
        if abs(a_) < 0.2 or b_ < lo_b + 0.3 * (hi_b - lo_b) or b_ > hi_b - 0.05:
            continue
        hit, _n = skin_point_g((0.0, sgn * (L / 2 + 1.0), b_), (0, -sgn, 0), L + 2)
        if hit is None:
            continue
        side_, _n2 = skin_point_g((1.5, hit.y - sgn * 0.06, b_), (-1, 0, 0), 3.0)
        if side_ is None:
            continue
        ratios.append((side_.x - pil) / abs(a_))
    if not ratios:
        return g
    k = min(max(min(ratios), 1.0), g.get('widenMax', P.get('widenMax', 1.07)))
    return dict(g, outline=[[a_ * k, b_] for a_, b_ in pts_])


def reach_pillar(g):
    """The front side window runs forward to the screen pillar: at each of its front
    points' heights, forward to where the side turns in towards the screen, less a
    pillar `pillar` wide."""
    if g['view'] != 'side' or 'outline' not in g:
        return g
    pts_ = g['outline']
    ymin = min(p_[0] for p_ in pts_)
    if ymin > info['cabin'][0] + 0.7:
        return g            # not the front window
    pil = g.get('pillar', P.get('pillar', 0.05))
    # how far forward each front point could go, then one shift for all of them (the
    # smallest): the edge moves parallel to itself and never runs onto the wing below
    shifts = []
    for y_, z_ in pts_:
        if y_ > ymin + 0.12:
            continue
        h0, _ = skin_point_g((1.5, y_ + 0.05, z_), (-1, 0, 0), 3.0)
        if h0 is None:
            continue
        yy, lim = y_, y_
        while yy > y_ - 0.3:
            yy -= 0.01
            h1, _ = skin_point_g((1.5, yy, z_), (-1, 0, 0), 3.0)
            if h1 is None or h1.x < h0.x - 0.04:
                break
            lim = yy
        shifts.append(max(0.0, y_ - (lim + pil)))
    sh = min(min(shifts) if shifts else 0.0, P.get('pillarReach', 0.06))
    out = [[y_ - sh if y_ <= ymin + 0.12 else y_, z_] for y_, z_ in pts_]
    return dict(g, outline=out)


# ---- glass laid over the shell (`glassOverlay`) ------------------------------------------
# A pane cut out of the shell's own faces ends where the shell's triangles and a facing
# limit let it: notched edges, a foot following a fillet round onto the shoulder, a
# screen running on round its corner into the side window's place (the Fulvia, again
# and again). Laid over the shell instead, a pane IS its drawn outline: the outline, the
# seal's inner edge and a grid inside are triangulated in the view's plane and dropped
# onto the shell along the view; the glass stands `GO_LIFT` off the skin, the seal is an
# even band inside the edge `GO_SEAL_LIFT` off it, walled down into the skin. The shell
# under a pane keeps a glass backing `GO_BACK` inside the outline (the wipers find the
# screen by it). A pane may carry its own `seal` width. Every pane is checked, GLASS
# and PILLAR lines in the log and GLASS-FAIL on a fault: rays that miss the skin, the
# skin under a pane turning from the view below `facing`, the skin bending under the
# glass faster than `bendDegCm` (a pane run onto a fillet or a crease), the shell
# coming through the glass, and two panes closer than `gapMin` (a pillar gone);
# `parts.glassCheck` overrides the limits.
# (GLASS_OVERLAY=1 in the environment tries it on a car whose file does not ask for it)
GO = bool(P.get('glassOverlay')) or os.environ.get('GLASS_OVERLAY') == '1'
GO_LIFT, GO_SEAL_LIFT, GO_STEP, GO_GRID, GO_BACK = 0.002, 0.004, 0.01, 0.02, 0.012
GO_CHECK = dict({'facing': 0.3, 'bendDegCm': 8.0, 'gapMin': 0.012}, **P.get('glassCheck', {}))


def go_ccw(poly):
    p = np.array(poly, float)
    area = 0.5 * np.sum(p[:, 0] * np.roll(p[:, 1], -1) - np.roll(p[:, 0], -1) * p[:, 1])
    return [list(map(float, q)) for q in (p if area > 0 else p[::-1])]


def go_densify(poly, step):
    out = []
    n = len(poly)
    for i in range(n):
        a_, b_ = np.array(poly[i], float), np.array(poly[(i + 1) % n], float)
        k = max(1, int(math.ceil(np.linalg.norm(b_ - a_) / step)))
        out += [(a_ + (b_ - a_) * (j / k)).tolist() for j in range(k)]
    return out


def go_inside(poly, pts):
    """Even-odd test of many points against one closed outline."""
    p = np.array(poly, float)
    q = np.array(pts, float).reshape(-1, 2)
    a0, b0 = p[:, 0][None, :], p[:, 1][None, :]
    a1, b1 = np.roll(p[:, 0], -1)[None, :], np.roll(p[:, 1], -1)[None, :]
    qa, qb = q[:, :1], q[:, 1:]
    with np.errstate(divide='ignore', invalid='ignore'):
        cross = ((b0 > qb) != (b1 > qb)) & (qa < a0 + (qb - b0) * (a1 - a0) / (b1 - b0))
    return np.logical_xor.reduce(cross, axis=1)


def go_seg_dist(poly, pts):
    """Distance of many points to a closed outline's edges."""
    p = np.array(poly, float)
    q = np.array(pts, float).reshape(-1, 2)
    a, b = p[None, :, :], np.roll(p, -1, axis=0)[None, :, :]
    ab = b - a
    t = np.clip(np.sum((q[:, None, :] - a) * ab, axis=2) / np.maximum(np.sum(ab * ab, axis=2), 1e-12), 0, 1)
    return np.min(np.linalg.norm(q[:, None, :] - (a + ab * t[:, :, None]), axis=2), axis=1)


def go_crossing(poly):
    """The first two edges of a closed outline that do not share a corner and cross:
    (i, j, the crossing point), or None."""
    p = np.array(poly, float)
    n = len(p)

    def cr(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    for i in range(n):
        a0, a1 = p[i], p[(i + 1) % n]
        for j in range(i + 2, n):
            if i == 0 and j == n - 1:
                continue
            b0, b1 = p[j], p[(j + 1) % n]
            c0, c1 = cr(b0, b1, a0), cr(b0, b1, a1)
            if c0 * c1 < 0 and cr(a0, a1, b0) * cr(a0, a1, b1) < 0:
                return i, j, (a0 + (a1 - a0) * (c0 / (c0 - c1))).tolist()
    return None


def go_unloop(poly):
    """An outline moved in by a seal's width folds over itself where a corner is
    sharper, or a rounding tighter, than that width: each fold is cut off at its
    crossing, the shorter way round dropped."""
    p = [list(q) for q in poly]
    while len(p) > 3:
        c_ = go_crossing(p)
        if c_ is None:
            break
        i, j, x_ = c_
        p = p[:i + 1] + [x_] + p[j + 1:] if j - i <= len(p) - (j - i) else p[i + 1:j + 1] + [x_]
    return p


def go_panes():
    """(pane index, view, sign, outline counter-clockwise) for every pane; a front, rear
    or top outline drawn as a half that starts and ends on the centreline is one pane
    across the car (sign 0), not two halves sealed down the middle."""
    out = []
    for gi, g in enumerate(GL):
        view, poly = g['view'], shape(g)
        if view != 'side' and g.get('mirror', True):
            ai = 1 if view == 'top' else 0
            if abs(poly[0][ai]) < 1e-6 and abs(poly[-1][ai]) < 1e-6:
                mir = [[p[0], -p[1]] if view == 'top' else [-p[0], p[1]] for p in reversed(poly)]
                out.append((gi, view, 0, go_ccw(poly + mir[1:-1])))
                continue
        for sign, poly_ in sides_of(g):
            out.append((gi, view, sign, go_ccw(poly_)))
    return out


def go_clip(poly, lo, hi):
    """The part of an outline between the heights lo and hi (its slanted edges kept)."""
    p = clip_below(poly, hi)
    return [[a_, -b_] for a_, b_ in clip_below([[a_, -b_] for a_, b_ in p], -lo)]


def go_fit(gi, view, sign, poly):
    """A pane drawn a little past the clean surface brought onto it: its foot raised,
    its header lowered and (seen from an end) its sides brought in, half a centimetre
    at a time, until no point just inside its edge misses the skin, faces away from the
    view or sits on a bend (a fillet, the roof's roll, the shoulder). The working shell
    is faceted, so a normal is the mean of five rays 1 cm apart. A car's own panes
    that already lie clean are left as drawn; `fit: False` never moves one."""
    g = GL[gi]
    if view == 'top' or g.get('fit') is False or P.get('glassFit') is False:
        return poly, (0, 0, 0)
    V = VIEW[view]
    dr = g.get('depthRange')

    def ray_at(a, b):
        o = [0.0, 0.0, 0.0]
        o[V['a']], o[V['b']] = a, b
        if view == 'side':
            o[0], r_ = sign * 2.0, Vector((-sign, 0, 0))
        else:
            s_ = -1 if view == 'front' else 1
            o[1], r_ = s_ * (L / 2 + 1.0), Vector((0, -s_, 0))
        o = Vector(o)
        for _ in range(6):
            co, n_, _i, _d = _glass_tree.ray_cast(o, r_, 10.0)
            if co is None:
                return None
            if not dr or dr[0] <= co[V['depth']] <= dr[1]:
                return co, (n_ if n_.dot(r_) < 0 else -n_), r_
            o = co + r_ * 1e-4
        return None

    def normal(a, b):
        ns = [ray_at(a + da, b + db) for da, db in ((0, 0), (0.01, 0), (-0.01, 0), (0, 0.01), (0, -0.01))]
        if ns[0] is None:
            return None
        n_ = sum((h[1] for h in ns if h is not None), Vector()).normalized()
        return ns[0][0], n_, ns[0][2]

    def bad(p_):
        p_ = go_ccw(p_)
        sub = go_densify(p_, 0.02)
        out = []
        for i in range(len(sub)):
            a_, b_ = np.array(sub[i]), np.array(sub[(i + 1) % len(sub)])
            t_ = (b_ - a_) / max(np.linalg.norm(b_ - a_), 1e-9)
            u_ = np.array([-t_[1], t_[0]])
            m_ = (a_ + b_) / 2
            h_e = ray_at(*(m_ + u_ * 0.003))
            h0, h1 = normal(*(m_ + u_ * 0.008)), normal(*(m_ + u_ * 0.025))
            if h_e is None or h0 is None or h1 is None or h_e[1].dot(-h_e[2]) < 0.3:
                out.append(m_)
                continue
            if h0[1].dot(-h0[2]) < 0.35 or math.degrees(h0[1].angle(h1[1], 0.0)) > 11.0:
                out.append(m_)
        return out
    ks = [0, 0, 0]                      # in at the sides, foot up, header down (half cm)
    limits = (0 if view == 'side' else 12, 12, 16)
    lo0, hi0 = min(p[1] for p in poly), max(p[1] for p in poly)

    def moved(k):
        p_ = go_clip(poly, lo0 + 0.005 * k[1], hi0 - 0.005 * k[2])
        if k[0]:
            p_ = [[a_ - math.copysign(0.005 * k[0], a_) * (abs(a_) > 0.15), b_] for a_, b_ in p_]
        return p_
    cur = bad(poly)
    while cur:
        lo_, hi_ = lo0 + 0.005 * ks[1], hi0 - 0.005 * ks[2]
        band = min(0.06, 0.3 * (hi_ - lo_))
        a_max = max(abs(p[0]) for p in moved(ks))
        votes = [0, 0, 0]
        for a_, b_ in cur:
            # a point may speak for more than one edge: a top corner for the header and
            # for the side it is on
            if b_ < lo_ + band:
                votes[1] += 1
            if b_ > hi_ - band:
                votes[2] += 1
            if abs(a_) > a_max - 0.08 or not (b_ < lo_ + band or b_ > hi_ - band):
                votes[0] += 1
        i = next((i for i in sorted(range(3), key=lambda i: -votes[i]) if votes[i] and ks[i] < limits[i]), None)
        if i is None:
            break
        ks[i] += 1
        cur = bad(moved(ks))
    return (moved(ks) if any(ks) else poly), tuple(ks)


if GO:
    GO_PANES = []
    for gi, view, sign, poly in go_panes():
        fitted, ks = go_fit(gi, view, sign, poly)
        if any(ks):
            print(f'GLASS-FIT {car} pane {gi} ({view}, side {sign}): in {ks[0] * 5} mm, foot up {ks[1] * 5} mm, '
                  f'header down {ks[2] * 5} mm')
        GO_PANES.append((gi, view, sign, go_ccw(fitted)))
    # every cut first: a later cut splits faces an earlier selection held
    GO_BACKS = [(gi, view, sign, offset_poly(poly, -GO_BACK)) for gi, view, sign, poly in GO_PANES]
    for gi, view, sign, back in GO_BACKS:
        cut(view, sign, back, dict(GL[gi], facingMin=-1.0, visible=True))
    for gi, view, sign, back in GO_BACKS:
        glass_faces |= set(select(view, sign, back, dict(GL[gi], facingMin=-1.0, visible=True)))
else:
    _wrap_screen = any(g['view'] == 'front' and g.get('facingMin', 0.2) < 0 for g in GL)
    GL = [widen_screen(g) if _wrap_screen else reach_pillar(widen_screen(g)) for g in GL]
    FIT_KS = {}
    FITTED = {}
    # A side window is its drawn outline on what the side view sees: its edges are the
    # drawing's straight lines, never the curve where the side turns away.
    GL = [dict(g, visible=True, facingMin=min(g.get('facingMin', 0.3), 0.15), sideWin=True) if g['view'] == 'side' else g
          for g in GL]
    for gi, g in enumerate(GL):
        for sign, poly in sides_of(g):
            # Both halves of a screen take the first half's fit: a pane is symmetric.
            FITTED[(gi, sign)] = fit_pane(g['view'], sign, poly, g, FIT_KS.get((g['view'], id(g))))
    for gi, g in enumerate(GL):
        for sign, poly in sides_of(g):
            cut(g['view'], sign, FITTED[(gi, sign)], g)
            if not g.get('sideWin'):
                iso_cut(g['view'], sign, FITTED[(gi, sign)], g)
    for gi, g in enumerate(GL):
        for sign, poly in sides_of(g):
            poly = FITTED[(gi, sign)]
            sel = set(select(g['view'], sign, poly, dict(g, iso=not g.get('sideWin'))))
            glass_faces |= sel
            # A pane whose outline runs off the surface the view sees ends in a ragged
            # edge (faces inside the outline but turned away): reported, so the outline
            # can be brought in.
            loose = set(select(g['view'], sign, poly, dict(g, facingMin=-1.0))) - sel
            rf = [f for f in loose if any(o in sel for e in f.edges for o in e.link_faces)
                  and min(v.normal.dot(Vector((sign, 0, 0)) if g['view'] == 'side' else VIEW[g['view']]['facing'])
                          for v in f.verts) < g.get('facingMin', 0.2) - 0.05]
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
        # only the well's own walls: a face of the side that happens to sit inside the
        # arch's radius stays paint (picked by centre it drew the lip as a staircase)
        if inside_arch and abs(f.normal.x) < 0.6 and f.material_index == SLOT['paint']:
            f.material_index = SLOT['trim']
        elif inside_arch and abs(c.x) < W / 2 - 0.10 and f.material_index == SLOT['paint']:
            f.material_index = SLOT['trim']

# Painted regions in the shell itself: a second colour (roof, bonnet), or black.
for r in P.get('regions', []):
    for sign, poly in sides_of(r):
        cut(r['view'], sign, poly, r)
        if r.get('facingMin', 0.2) > -0.5:
            iso_cut(r['view'], sign, poly, r)
    for sign, poly in sides_of(r):
        for f in select(r['view'], sign, poly, dict(r, iso=True)):
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
    sel = select(view, sign, poly, d, hole)
    # Stray slivers on a surface turning away (an indicator's corner over the wing's
    # curve) are dropped: only pieces with a real share of the patch's area stay.
    if len(sel) > 1:
        sset = set(sel)
        comps, seen = [], set()
        for f0 in sel:
            if f0 in seen:
                continue
            stack, comp = [f0], []
            seen.add(f0)
            while stack:
                f1 = stack.pop()
                comp.append(f1)
                for e in f1.edges:
                    for f2 in e.link_faces:
                        if f2 in sset and f2 not in seen:
                            seen.add(f2)
                            stack.append(f2)
            comps.append(comp)
        areas = [sum(f.calc_area() for f in c_) for c_ in comps]
        big = max(areas)
        sel = [f for c_, a_ in zip(comps, areas) if a_ >= 0.2 * big for f in c_]
    for f in sel:
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
        if d['view'] in ('front', 'rear'):
            # A lamp drawn on an end lies on what that end shows: the surface seen from
            # in front (or behind), however steeply it slopes, and cut cleanly where it
            # stops (iso_cut). The car file's own facingMin is that stopping point -- a
            # lamp kept off the bonnet's brow says so here; when it says nothing, the
            # limit reaches down to grazing so a steep nose keeps its lamps.
            d = dict(d, facingMin=d.get('facingMin', 0.15), visible=True)
        for sign, poly in sides_of(d):
            hole = offset_poly(poly, -d['ring']) if d.get('ring') else None
            node = d.get('node', 'decal_trim')
            out.append((d['view'], sign, poly, d, node, d.get('material', 'trim'), d.get('height', 0.004), hole))
    # Bars across a grille or a lamp: thin strips, each its own patch (on the ends they
    # are straight solid bars instead, built with the parts: BARS_SOLID).
    for d in P.get('bars', []):
        if d['view'] in ('front', 'rear'):
            continue
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
    # [[a, b], ...] in a view, `width` wide. A window's frame is not drawn: the panes
    # carry their own seal (SEAL), so a line running along a pane's edge is left out.
    for ln in P.get('lines', []):
        if ln in FRAME_LINES:
            continue
        pts = np.array(ln['points'], float)
        if len(pts) > 2 and ln.get('width', 0.005) <= 0.008 and not ln.get('keep'):
            # A shut line drawn point by point wobbles with the reading: each straight
            # run between corners (turns over 25 degrees) is laid straight from its
            # first point to its last.
            keep_i = [0]
            for i in range(1, len(pts) - 1):
                e0, e1 = pts[i] - pts[i - 1], pts[i + 1] - pts[i]
                c_ = np.dot(e0, e1) / max(np.linalg.norm(e0) * np.linalg.norm(e1), 1e-9)
                if c_ < math.cos(math.radians(25)):
                    keep_i.append(i)
            keep_i.append(len(pts) - 1)
            pts = pts[keep_i]
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
            if ln['view'] == 'side' and not ln.get('drawn'):
                # Thin lines along the side are cut cleanly where the side turns away
                # and by what the side view sees, never torn across a fold.
                seg = dict(seg, visible=True)
            for sign, poly in sides_of(seg):
                out.append((ln['view'], sign, poly, seg, 'decal_trim', ln.get('material', 'rubber'), ln.get('height', 0.0015), None))
    return out


# The seal round every pane: a band of even width inside the pane's own edge, so it
# follows the glass exactly (a drawn frame never quite did), lifted like a decal.
# (Panes laid over the shell carry their own; the backing under them has none.)
_gl = [] if GO else [f for f in bm.faces if f.material_index == SLOT['glass']]
# First the panes' edges are evened out: where the cut met the triangles unluckily the
# edge has notches; each edge vertex is drawn towards the middle of its neighbours
# along the edge and laid back on the surface.
_tree0 = BVHTree.FromBMesh(bm)
_gs = set(_gl)
_bedges = [e for e in bm.edges if sum(1 for f in e.link_faces if f in _gs) == 1]
_nb = {}
for e in _bedges:
    a_, b_ = e.verts
    _nb.setdefault(a_, []).append(b_)
    _nb.setdefault(b_, []).append(a_)
_start = {v: v.co.copy() for v in _nb}
for _ in range(P.get('paneEdgeRelax', 4)):
    moves = {}
    for v, ns in _nb.items():
        if len(ns) != 2:
            continue
        d0, d1 = (ns[0].co - v.co), (ns[1].co - v.co)
        if d0.length < 1e-6 or d1.length < 1e-6 or d0.normalized().dot(d1.normalized()) > -0.5:
            continue            # a corner (sharper than 120 degrees) stays where it is
        moves[v] = v.co * 0.5 + (ns[0].co + ns[1].co) * 0.25
    for v, co in moves.items():
        hit = _tree0.find_nearest(co)
        # only a small slide over the surface: never off it, never far along it
        if hit[0] is None or (hit[0] - co).length > 0.01 or (hit[0] - _start[v]).length > 0.015:
            continue
        v.co = hit[0]
bm.normal_update()
if _gl and SEAL.get('width', 0) > 0:
    # The pane's outline before insetting: every vertex of the band is held to it.
    _bsegs = [(e.verts[0].co.copy(), e.verts[1].co.copy()) for e in _bedges]
    res = bmesh.ops.inset_region(bm, faces=_gl, thickness=SEAL['width'], depth=0.0, use_even_offset=False)
    # At a corner the band's inner edge can run out along the corner's bisector
    # (an outline doubling back; the old clamp only looked at vertices that had moved,
    # never at the new ones the inset makes). No vertex of the band is left further
    # than 1.5 band widths from the pane's own edge: an even band (one width) and a
    # right-angle corner (1.41 w) are kept whole, a sharper corner is trimmed.
    _lim = 1.5 * SEAL['width']
    for v in {v for f in res['faces'] for v in f.verts}:
        best, bp = 1e9, None
        for a_, b_ in _bsegs:
            ab = b_ - a_
            t = max(0.0, min(1.0, (v.co - a_).dot(ab) / ab.length_squared)) if ab.length_squared > 1e-12 else 0.0
            p = a_ + ab * t
            d_ = (v.co - p).length
            if d_ < best:
                best, bp = d_, p
        if bp is not None and best > _lim:
            v.co = bp + (v.co - bp) * (_lim / best)
    t_seal = len(TAGS)
    TAGS.append(('decal_trim', SEAL['material'], SEAL.get('height', 0.002)))
    for f in res['faces']:
        f.material_index = TAG0 + 4 * t_seal + SLOT['trim']
print('FACES before decals', len(bm.faces))
SHAPES = decal_shapes()
for view, sign, poly, d, node, mat, height, hole in SHAPES:
    cut(view, sign, poly, d)
    if hole:
        cut(view, sign, hole, d)
    if view in ('front', 'rear') and d.get('facingMin', 0.2) > -0.5:
        iso_cut(view, sign, poly, d)
for view, sign, poly, d, node, mat, height, hole in SHAPES:
    tag(view, sign, poly, dict(d, iso=view in ('front', 'rear')), node, mat, height, hole)

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
# Each corner of the working shell takes the full-resolution shell's normal where a
# ray along its own face's normal meets it: a corner on the side never picks up the
# normal of an arch's wall next to it (Blender's projected transfer did, and spread it
# into wedges up the wings).
body.data.shade_smooth()
scene.collection.objects.link(dense)
_dg = bpy.context.evaluated_depsgraph_get()
_dt = BVHTree.FromObject(dense, _dg)
_dm = dense.data
# the field's gradient, stored in the ply as the vertices' normals
_dvn = [None] * len(_dm.vertices)
for _l in _dm.loops:
    if _dvn[_l.vertex_index] is None:
        _dvn[_l.vertex_index] = _dm.corner_normals[_l.index].vector.copy()
_dvn = [n_ if n_ is not None else v.normal.copy() for n_, v in zip(_dvn, _dm.vertices)]
_dvc = [v.co.copy() for v in _dm.vertices]
_dpv = [tuple(p.vertices) for p in _dm.polygons]


def dense_normal(loc, idx):
    """The smooth normal at a point of the dense shell: its triangle's vertex normals,
    blended by where the point lies in it (a lone triangle's own normal carries the
    voxel steps)."""
    vs = _dpv[idx]
    if len(vs) != 3:
        return None
    a_, b_, c_ = (_dvc[i] for i in vs)
    v0, v1, v2 = b_ - a_, c_ - a_, loc - a_
    d00, d01, d11 = v0.dot(v0), v0.dot(v1), v1.dot(v1)
    d20, d21 = v2.dot(v0), v2.dot(v1)
    den = d00 * d11 - d01 * d01
    if abs(den) < 1e-14:
        return None
    w1 = (d11 * d20 - d01 * d21) / den
    w2 = (d00 * d21 - d01 * d20) / den
    w0 = 1 - w1 - w2
    n_ = _dvn[vs[0]] * w0 + _dvn[vs[1]] * w1 + _dvn[vs[2]] * w2
    return n_.normalized() if n_.length > 1e-9 else None


_me = body.data
_vco = [v.co.copy() for v in _me.vertices]
_custom = []
_miss = 0
def sample(co, fn):
    """The dense shell's smooth normal under a point, looked for along fn."""
    hit = _dt.ray_cast(co + fn * 0.015, -fn, 0.04)
    if hit[0] is not None and hit[1].dot(fn) > 0.5:
        return dense_normal(hit[0], hit[2]) or hit[1]
    loc, nrm, _i, _d = _dt.find_nearest(co, 0.02)
    if loc is not None and nrm.dot(fn) > 0.5:
        return dense_normal(loc, _i) or nrm
    return None


# one normal per vertex (so faces meet smoothly), looked for along its faces' mean
_vn = {}
for v in _me.vertices:
    _vn[v.index] = sample(v.co.copy(), v.normal.copy())
for poly in _me.polygons:
    fn = poly.normal.copy()
    cen = poly.center.copy()
    for li in poly.loop_indices:
        vi = _me.loops[li].vertex_index
        n_ = _vn[vi]
        if n_ is None or n_.dot(fn) < math.cos(math.radians(30)):
            # a corner on a crease (an arch's lip): its own face's side of it, sampled a
            # little way into the face, so a long triangle reaching from the crease into a
            # panel shades as the panel
            co = _vco[vi]
            to_c = cen - co
            n_ = sample(co + to_c * min(1.0, 0.025 / max(to_c.length, 1e-6)), fn)
        _custom.append(tuple((n_ if n_ is not None else fn).normalized()))
        _miss += n_ is None
_me.normals_split_custom_set(_custom)
print(f'NORMALS {car}: {_miss} of {len(_custom)} corners fell back to their face')
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


def sweep(bm_, path, profile, mat=0, closed_ends=True, scales=None):
    """A closed 2D `profile` [(u, v)] carried along a 3D `path`: u across (horizontal,
    outward), v up; `scales` shrinks the section ring by ring (a rounded end)."""
    rings_ = []
    for k, p in enumerate(path):
        p = Vector(p)
        a = Vector(path[max(k - 1, 0)])
        b = Vector(path[min(k + 1, len(path) - 1)])
        t = (b - a).normalized()
        side = t.cross(Vector((0, 0, 1))).normalized()
        sc_ = scales[k] if scales else 1.0
        rings_.append([bm_.verts.new(p + side * u * sc_ + Vector((0, 0, v * sc_))) for u, v in profile])
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

# ---- the panes laid over the shell (`glassOverlay`, see the glass stage) ----------------
GO_GLASS = None
if GO:
    from mathutils.geometry import delaunay_2d_cdt
    _go_tree = BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get())
    _go_w = SEAL.get('width', 0.008)
    _go_gbm, _go_sbms = bmesh.new(), {}
    _go_nrm = {}                # glass vertex -> the dense shell's smooth normal under it
    _go_loops = []              # (pane, sign, its edge on the skin [n, 3])
    _go_fails = []
    _go_rough = [0]             # rays whose dense-shell normal was not found

    def go_hit(view, sign, a, b, dr):
        """Where the view's ray through (a, b) meets the skin within the pane's depth
        range: the point, the dense shell's smooth normal there, the ray."""
        V = VIEW[view]
        o = [0.0, 0.0, 0.0]
        o[V['a']], o[V['b']] = a, b
        if view == 'side':
            o[0], ray = sign * 2.0, Vector((-sign, 0, 0))
        elif view == 'top':
            o[2], ray = H + 1.0, Vector((0, 0, -1))
        else:
            s_ = -1 if view == 'front' else 1
            o[1], ray = s_ * (L / 2 + 1.0), Vector((0, -s_, 0))
        o = Vector(o)
        for _ in range(6):
            co, n_, _i, _d = _go_tree.ray_cast(o, ray, 10.0)
            if co is None:
                return None
            if not dr or dr[0] <= co[V['depth']] <= dr[1]:
                n_ = n_ if n_.dot(ray) < 0 else -n_
                ns = sample(co, n_)
                if ns is None or ns.dot(n_) < 0.5:
                    _go_rough[0] += 1
                    ns = n_
                return co, ns, ray
            o = co + ray * 1e-4
        return None

    def go_orient(f, n_):
        f.normal_update()
        if f.normal.dot(n_) < 0:
            f.normal_flip()

    for gi, view, sign, poly in GO_PANES:
        dr = GL[gi].get('depthRange')
        tag_ = f'pane {gi} ({view}, side {sign})'

        def hit(a, b):
            return go_hit(view, sign, a, b, dr)
        # The seal's inner edge: every 3 cm of the outline moved in by the seal's width
        # as it lies on the skin (a screen seen from above is foreshortened), its corners
        # mitred.
        sub = go_densify(poly, 0.03)
        ns_ = len(sub)
        offs = []
        for i in range(ns_):
            a_, b_ = np.array(sub[i]), np.array(sub[(i + 1) % ns_])
            t_ = (b_ - a_) / max(np.linalg.norm(b_ - a_), 1e-9)
            u_ = np.array([-t_[1], t_[0]])              # inwards: the outline runs anticlockwise
            m_ = (a_ + b_) / 2
            h0, h1 = hit(*(m_ + u_ * 0.002)), hit(*(m_ + u_ * 0.006))
            st = (h1[0] - h0[0]).length / 0.004 if h0 and h1 else 1.0
            # (a pane's own `seal` width over the car's)
            offs.append((u_, GL[gi].get('seal', _go_w) / max(st, 1.0)))
        inner = []
        for i in range(ns_):
            (u0, d0), (u1, d1) = offs[i - 1], offs[i]
            if abs(u0[0] * u1[1] - u0[1] * u1[0]) < 0.09:
                m_ = u0 + u1
                r_ = m_ / max(np.linalg.norm(m_), 1e-9) * (d0 + d1) / 2
            else:
                r_ = np.linalg.solve(np.array([u0, u1]), np.array([d0, d1]))
                lim = 3 * max(d0, d1)
                if np.linalg.norm(r_) > lim:
                    r_ = r_ * (lim / np.linalg.norm(r_))
            inner.append((np.array(sub[i]) + r_).tolist())
        inner = go_unloop(inner)
        if go_crossing(inner) is not None or not go_inside(poly, inner).all():
            _go_fails.append(f"{tag_}: the seal's inner edge cannot be laid inside the outline")
            continue
        # The outline, the seal's inner edge and a grid inside, triangulated in the view.
        outer_d, inner_d = go_densify(poly, GO_STEP), go_densify(inner, GO_STEP)
        arr = np.array(inner)
        lo_, hi_ = arr.min(0), arr.max(0)
        ga, gb = np.meshgrid(np.arange(lo_[0] + GO_GRID / 2, hi_[0], GO_GRID),
                             np.arange(lo_[1] + GO_GRID / 2, hi_[1], GO_GRID))
        gp = np.stack([ga.ravel(), gb.ravel()], 1)
        gp = gp[go_inside(inner, gp)] if len(gp) else gp
        gp = gp[go_seg_dist(inner, gp) > GO_GRID * 0.4] if len(gp) else gp
        no, ni = len(outer_d), len(inner_d)
        vin = [Vector(p) for p in outer_d + inner_d + gp.tolist()]
        ein = [(i, (i + 1) % no) for i in range(no)] + [(no + i, no + (i + 1) % ni) for i in range(ni)]
        vout, _eo, fout, origv, _oe, _of = delaunay_2d_cdt(vin, ein, [], 0, 1e-7)
        cen = np.array([[sum(vout[k][0] for k in f) / len(f), sum(vout[k][1] for k in f) / len(f)] for f in fout])
        keep, in_glass = go_inside(outer_d, cen), go_inside(inner_d, cen)
        on_outer = [any(k < no for k in ov) for ov in origv]
        to_out = {k: i for i, ov in enumerate(origv) for k in ov}
        used = sorted({k for f, k_ in zip(fout, keep) if k_ for k in f})
        hits = {k: hit(vout[k][0], vout[k][1]) for k in used}
        missed = [k for k in used if hits[k] is None]
        if missed:
            _go_fails.append(f'{tag_}: {len(missed)} of its points miss the skin, first at '
                             f'{tuple(round(c, 3) for c in vout[missed[0]])}')
            continue
        facing = {k: hits[k][1].dot(-hits[k][2]) for k in used}
        kf = min(used, key=lambda k: facing[k])
        # the glass
        vg = {}
        gfaces = []
        # the bend: how fast the skin's normal turns under the glass, degrees per cm
        # along its edges (a body panel 1-6, a fillet the glass has run onto 20 or more)
        fold, fold_at = 0.0, None
        for f, k_, g_ in zip(fout, keep, in_glass):
            if not (k_ and g_):
                continue
            for k in f:
                if k not in vg:
                    co, n_, _r = hits[k]
                    vg[k] = _go_gbm.verts.new(co + n_ * GO_LIFT)
                    _go_nrm[vg[k]] = n_
            ff = _go_gbm.faces.new([vg[k] for k in f])
            go_orient(ff, sum((hits[k][1] for k in f), Vector()))
            gfaces.append(f)
            for a_, b_ in zip(f, f[1:] + f[:1]):
                rate = math.degrees(hits[a_][1].angle(hits[b_][1], 0.0)) / max((hits[a_][0] - hits[b_][0]).length * 100, 0.5)
                if rate > fold:
                    fold, fold_at = rate, (hits[a_][0] + hits[b_][0]) / 2
        # nothing of the shell may stand above the glass between its corners
        clear, clear_at = 1.0, None
        for f in gfaces:
            c_ = sum((hits[k][0] + hits[k][1] * GO_LIFT for k in f), Vector()) / len(f)
            n_ = sum((hits[k][1] for k in f), Vector()).normalized()
            hh = _go_tree.ray_cast(c_ + n_ * 0.01, -n_, 0.05)
            if hh[0] is not None and hh[3] - 0.01 < clear:
                clear, clear_at = hh[3] - 0.01, c_
        # the seal: a band from the outline to its inner edge, walled down into the skin
        # outside and down to the glass inside
        top_, bot_ = {}, {}
        # a pane's own `sealMaterial` (chrome door frames, rubber screens) over the car's
        sbm = _go_sbms.setdefault(GL[gi].get('sealMaterial', SEAL['material']), bmesh.new())
        sfaces = [f for f, k_, g_ in zip(fout, keep, in_glass) if k_ and not g_]
        n_edge = {}
        for f in sfaces:
            for a_, b_ in zip(f, f[1:] + f[:1]):
                n_edge[(min(a_, b_), max(a_, b_))] = n_edge.get((min(a_, b_), max(a_, b_)), 0) + 1

        def vtop(k):
            if k not in top_:
                top_[k] = sbm.verts.new(hits[k][0] + hits[k][1] * GO_SEAL_LIFT)
            return top_[k]

        def vbot(k):
            if k not in bot_:
                bot_[k] = sbm.verts.new(hits[k][0] + hits[k][1] * (-0.001 if on_outer[k] else GO_LIFT))
            return bot_[k]
        for f in sfaces:
            ff = sbm.faces.new([vtop(k) for k in f])
            go_orient(ff, sum((hits[k][1] for k in f), Vector()))
            fc = sum((hits[k][0] for k in f), Vector()) / len(f)
            for a_, b_ in zip(f, f[1:] + f[:1]):
                if n_edge[(min(a_, b_), max(a_, b_))] == 1:
                    try:
                        wf = sbm.faces.new((vbot(a_), vbot(b_), vtop(b_), vtop(a_)))
                    except ValueError:
                        continue
                    go_orient(wf, (hits[a_][0] + hits[b_][0]) / 2 - fc)
        _go_loops.append((gi, sign, np.array([tuple(hits[to_out[k]][0]) for k in range(no)])))
        print(f'GLASS {car} {tag_}: {len(gfaces)} glass tris, facing min {facing[kf]:.2f} at '
              f'{tuple(round(c, 3) for c in hits[kf][0])}, bend max {fold:.1f} deg/cm at '
              f'{tuple(round(c, 3) for c in fold_at) if fold_at else None}, skin under it by {clear * 1000:.1f} mm '
              f'or more (least at {tuple(round(c, 3) for c in clear_at) if clear_at else None})')
        if facing[kf] < GO_CHECK['facing']:
            _go_fails.append(f'{tag_}: the skin under it turns away from the view to {facing[kf]:.2f} at '
                             f'{tuple(round(c, 3) for c in hits[kf][0])} (limit {GO_CHECK["facing"]})')
        if fold > GO_CHECK['bendDegCm']:
            _go_fails.append(f'{tag_}: bends {fold:.1f} deg/cm at {tuple(round(c, 3) for c in fold_at)} - a fillet or '
                             f'crease under the glass (limit {GO_CHECK["bendDegCm"]})')
        if clear < 0.0005:
            _go_fails.append(f'{tag_}: the shell comes through the glass ({clear * 1000:.1f} mm) at '
                             f'{tuple(round(c, 3) for c in clear_at)}')
    # The pillars: the paint left between neighbouring panes' edges.
    for i in range(len(_go_loops)):
        for j in range(i + 1, len(_go_loops)):
            (gi, si, A), (gj, sj, B) = _go_loops[i], _go_loops[j]
            if si and sj and si != sj:
                continue
            s_ = si or sj
            if s_:
                A, B = A[A[:, 0] * s_ > 0], B[B[:, 0] * s_ > 0]
            if not len(A) or not len(B):
                continue
            dd = np.linalg.norm(A[:, None, :] - B[None, :, :], axis=2)
            if dd.min() > 0.10:
                continue
            ia, ib = np.unravel_index(np.argmin(dd), dd.shape)
            near = dd.min(axis=1)
            zone = near[near < 0.06]
            where = tuple(np.round((A[ia] + B[ib]) / 2, 3).tolist())
            print(f'PILLAR {car} pane {gi}|{gj} side {s_}: gap min {dd.min():.3f} at {where}, median '
                  f'{float(np.median(zone)) if len(zone) else 0:.3f} over {len(zone)} edge points within 6 cm')
            if dd.min() < GO_CHECK['gapMin']:
                _go_fails.append(f'panes {gi} and {gj} (side {s_}) come within {dd.min():.3f} at {where} '
                                 f'(limit {GO_CHECK["gapMin"]})')
    print(f'GLASS {car}: {_go_rough[0]} points shaded by the working shell (no dense normal)')
    for msg in _go_fails:
        print(f'GLASS-FAIL {car} {msg}')
    _go_gbm.verts.index_update()
    _go_vn = [None] * len(_go_gbm.verts)
    for v in _go_gbm.verts:
        _go_vn[v.index] = _go_nrm[v]
    _me_go = bpy.data.meshes.new('glass_overlay')
    _go_gbm.to_mesh(_me_go)
    _go_gbm.free()
    _me_go.materials.append(MAT['glass'])
    _me_go.shade_smooth()
    _me_go.normals_split_custom_set([tuple(_go_vn[lp.vertex_index]) for lp in _me_go.loops])
    GO_GLASS = bpy.data.objects.new('glass_overlay', _me_go)
    scene.collection.objects.link(GO_GLASS)
    for mat_, sbm_ in _go_sbms.items():
        trim_parts.append(new_object('glass_seal', sbm_, [mat_]))
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
    pts = [Vector(p) for p in path]
    # The path already runs from one wrap end round the end of the car to the other; the
    # profile's +u must face out of the car, so the path must start at the end whose
    # x*sgn is smaller. (Sorting by x regrouped a long straight run along the side, which
    # all share one x: the bar then jumped between them and its end came out in steps.)
    if pts[0].x * sgn > pts[-1].x * sgn:
        pts = pts[::-1]
    # The bar's ends are rounded off: extra rings at each end shrinking to a cap, not a
    # sawn-off square section.
    def tip(p0, p1, k):
        d_ = (p0 - p1).normalized()
        return p0 + d_ * (dpt * 0.35) * k
    tips0 = [tip(pts[0], pts[1], k) for k in (0.6, 1.0)]
    tips1 = [tip(pts[-1], pts[-2], k) for k in (0.6, 1.0)]
    path_all = tips0[::-1] + pts + tips1
    scale = [0.45, 0.8] + [1.0] * len(pts) + [0.8, 0.45]
    bm_ = bmesh.new()
    sweep(bm_, [tuple(p) for p in path_all], prof, 0, scales=scale)
    # brackets back to the shell for a bar standing clear of it
    sh = info.get('bumperShell', {}).get(end)
    if sh:
        y_face_ = min(p_.y for p_ in pts) if end == 'front' else max(p_.y for p_ in pts)
        gap = abs(y_face_ - sh[0]) - dpt
        if gap > 0.08:
            zc_ = pts[0].z
            for xb in (-0.3, 0.3):
                yb = (y_face_ + sh[0]) / 2
                box(bm_, (xb, yb, (zc_ + sh[1]) / 2 if sh[1] > zc_ + 0.05 else zc_),
                    (0.035, abs(y_face_ - sh[0]), 0.035 + max(0.0, sh[1] - zc_ - 0.05)), 0)
    o = new_object('bumper_' + end, bm_, [b.get('material', 'chrome')])
    trim_parts.append(o)
    if b.get('rubber'):
        # A rubber strip along the bar's face: down its middle, or (rubberTop) along its
        # top edge, where the chromium bevel would otherwise mirror the sky.
        rh = b['rubber']
        v0 = h / 2 - rh if b.get('rubberTop') else -rh / 2
        uo = 0.004 if b.get('rubberTop') else 0.008
        bm_ = bmesh.new()
        sweep(bm_, [tuple(p) for p in pts], [(dpt / 2 - 0.004, v0), (dpt / 2 + uo, v0),
                                             (dpt / 2 + uo, v0 + rh), (dpt / 2 - 0.004, v0 + rh)], 0)
        trim_parts.append(new_object('bumper_rubber_' + end, bm_, ['rubber']))
    for ov in b.get('overriders', []):
        bm_ = bmesh.new()
        x, w_, z0, z1 = ov
        for s_ in (1, -1):
            # A rounded fang through the bar at x, standing on the bar's own face there
            # (the bar curves away at the corners), tapered top and bottom.
            near = min(pts, key=lambda p: abs(p.x - s_ * x))
            yc = near.y - sgn * 0.012
            hz = (z1 - z0) / 2
            prof_ov = [(0.0, -hz), (0.6, -hz * 0.92), (0.95, -hz * 0.5), (1.0, 0.0), (0.95, hz * 0.55), (0.6, hz * 0.95), (0.0, hz)]
            rings = []
            for k in range(12):
                a_ = 2 * math.pi * k / 12
                rx, ry = math.cos(a_) * w_ / 2, math.sin(a_) * (dpt + 0.03) / 2
                rings.append(a_)
            vs = []
            for t_, zz in prof_ov:
                ring = []
                for a_ in rings:
                    rx = math.cos(a_) * w_ / 2 * max(t_, 0.35)
                    ry = math.sin(a_) * (dpt + 0.03) / 2 * max(t_, 0.35)
                    ring.append(bm_.verts.new((s_ * x + rx, yc + ry, (z0 + z1) / 2 + zz)))
                vs.append(ring)
            for r0, r1 in zip(vs, vs[1:]):
                for k in range(12):
                    bm_.faces.new((r0[k], r0[(k + 1) % 12], r1[(k + 1) % 12], r1[k]))
            bm_.faces.new(vs[0][::-1])
            bm_.faces.new(vs[-1])
        bmesh.ops.recalc_face_normals(bm_, faces=bm_.faces)
        # Rubber overriders on a chrome bar (Trabant, early Wartburg): their own material.
        trim_parts.append(new_object('overriders_' + end, bm_, [b.get('overriderMaterial', b.get('material', 'chrome'))]))


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
        bz = lp.get('bezel', 0.014)
        if lp.get('seat') == 'flush' and hitc is not None:
            # Under a cover on a sloping wing: the lens and its ring lie on the skin,
            # facing the way the skin does there.
            _h, nrm = skin_point((x, sgn_end * (L / 2 + 1.0), z), (0, -sgn_end, 0), L + 2)
            nv = Vector(nrm).normalized()
            c_ = Vector(hitc)
            disc(b_, c_ + nv * 0.007, nv, r, 0.008, 24, 0)
            tb = bmesh.new()
            disc(tb, c_ + nv * 0.003, nv, r + bz, 0.008, 24, 0)
            trim_parts.append(new_object('pod_rim', tb, [lp.get('bezelMaterial', 'chrome')]))
            continue
        disc(b_, (x, y_face + sgn_end * 0.004, z), n_, r, 0.012, 24, 0)
        tb = bmesh.new()
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
_side_front = min((min(p_[0] for p_ in g_['outline']) for g_ in GL if g_['view'] == 'side'), default=-9.0)
if m:
    bm_ = bmesh.new()
    w_, h_ = m.get('w', 0.13), m.get('h', 0.08)
    shape = m.get('shape', 'rect')
    for s_ in m.get('sides', (1, -1)):
        hit, nrm = skin_point((s_ * 1.5, m['y'], m['z']), (-s_, 0, 0))
        x1 = s_ * m.get('reach', (abs(hit.x) if hit else W / 2) + 0.13)
        xc = x1 - s_ * w_ / 2
        # Where it stands: on the door (the side is right there at its height) or on
        # the wing's top (the side ray reaches the glasshouse, well inboard).
        # A mirror at the front side window's corner is on the door; one well ahead of
        # it stands on the wing.
        on_wing = m.get('mount') == 'wing' or (m.get('mount') != 'door' and m['y'] < _side_front - 0.12)
        z_mir = m['z']
        if on_wing:
            # The stalk stands on the wing's top, the head over it (at most a few cm
            # out): a head out at `reach` above a foot well inboard hangs in the air.
            # The first downward hit inboard is the flank when the head is past the
            # wing's edge (a pole down the body's side, Mini/Saab 96), so only a
            # gently up-facing panel counts (a wing's rounded crown is ~0.6-0.7, a
            # flank ~0). The head may sit level with or a little under that crown
            # (the Mini's fender top is above the height the car file gives), so the
            # ray starts just above the head and the head is set above the foot.
            def wing_hit(nz_lo, z_lo, z_hi):
                for k_ in range(40):
                    xf_ = xc - s_ * 0.01 * k_
                    h_, n_ = skin_point((xf_, m['y'] + 0.01, m['z'] + 0.12), (0, 0, -1))
                    if h_ is not None and n_[2] > nz_lo and z_lo < h_.z <= z_hi:
                        return xf_, h_
                return None, None
            xf, down = wing_hit(0.55, m['z'] - 0.18, m['z'] + 0.12)
            if down is None:
                # a rounded crown or a mirrored flank: anything up-facing near the head
                xf, down = wing_hit(0.3, m['z'] - 0.28, m['z'] + 0.14)
            if down is None:
                xf, down = xc, None
            else:
                xc = xf + s_ * min(abs(xc - xf), 0.04)
                x1 = xc + s_ * w_ / 2
                z_mir = max(m['z'], down.z + h_ * 0.6)
            z_foot = down.z if down else m['z'] - 0.15
            z_head = z_mir - h_ * 0.45
            # a thin stalk from a small foot on the wing up into the head
            disc(bm_, (xf, m['y'] + 0.01, z_foot + 0.004), (0, 0, 1), 0.018, 0.012, 10, 0)
            if z_head - z_foot > 0.01:
                disc(bm_, (xf, m['y'] + 0.01, (z_foot + z_head) / 2), (0, 0, 1), 0.007, z_head - z_foot, 8, 0)
        else:
            # The sail on the door's own skin: at the mirror's height, or lower down to
            # the door's top when the glass is what is there (or at `sailZ`, the door's
            # top under the belt chrome, where the glasshouse is as wide as that test's
            # door: Fulvia).
            z_s, x0 = m['z'], hit.x if hit else s_ * W / 2
            if 'sailZ' in m:
                h2, _n = skin_point((s_ * 1.5, m['y'], m['sailZ']), (-s_, 0, 0))
                z_s, x0 = m['sailZ'], h2.x if h2 else x0
            for k in range(0 if 'sailZ' in m else 26):
                h2, _n = skin_point((s_ * 1.5, m['y'], m['z'] - 0.01 * k), (-s_, 0, 0))
                if h2 and abs(h2.x) >= W / 2 - 0.12:
                    z_s, x0 = m['z'] - 0.01 * k, h2.x
                    break
            box(bm_, (x0 + s_ * 0.003, m['y'] + 0.01, z_s + 0.01), (0.01, 0.07, 0.05), 0)
            # the arm, from the sail out and up into the housing's inner side
            a0 = Vector((x0 + s_ * 0.006, m['y'] + 0.012, z_s + 0.01))
            a1 = Vector((xc - s_ * w_ * 0.3, m['y'] + 0.012, m['z'] - h_ * 0.1))
            dv = a1 - a0
            if dv.length > 0.005:
                rot = Vector((1, 0, 0)).rotation_difference(dv.normalized()).to_matrix().to_4x4()
                box(bm_, (a0 + a1) / 2, (dv.length, 0.022, 0.018), 0, rot)
        mirror_head(bm_, (xc, m['y'] + 0.02, z_mir), w_, h_, 0.05 if shape == 'round' else 0.06, shape, s_)
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

# Wipers: parked blades lying on the windscreen just above its foot, each a slim strip
# following the glass, a thin arm under it.
wp = P.get('wipers')
if wp:
    bm_ = bmesh.new()
    _mi = [p_.material_index for p_ in body.data.polygons]

    def on_glass(x_, y_):
        h_ = _skin.ray_cast(Vector((x_, y_, H + 0.5)), Vector((0, 0, -1)), 3.0)
        return h_[0] is not None and _mi[h_[2]] == SLOT['glass']
    def glass_point(x_, y0_):
        """The windscreen's surface a few cm up from its foot at x: walking back from
        the nose along the centre of the car until the surface below is glass (the
        foot then found to a fraction of a millimetre: on 1 cm steps a blade following
        the glass waved)."""
        for y_ in np.arange(y0_ - 0.5, y0_ + 0.8, 0.01):
            if on_glass(x_, y_):
                lo_, hi_ = y_ - 0.01, y_
                for _ in range(7):
                    mid_ = (lo_ + hi_) / 2
                    lo_, hi_ = (lo_, mid_) if on_glass(x_, mid_) else (mid_, hi_)
                h2 = _skin.ray_cast(Vector((x_, hi_ + 0.05, H + 0.5)), Vector((0, 0, -1)), 3.0)
                if h2[0] is not None and _mi[h2[2]] == SLOT['glass']:
                    return h2[0], h2[1]
                return None
        return None
    for x0, x1, y, z in wp['arms']:
        # each blade lies on the glass along its whole length, just above the foot
        pts = []
        for t in np.linspace(0, 1, 9):
            g_ = glass_point(x0 + (x1 - x0) * t, y)
            if g_ is not None:
                pts.append(g_)
        if len(pts) < 2:
            continue
        # one straight blade: from the first point to the last, standing on the higher
        # of the glass beneath it (a blade is straight; following the glass's ragged
        # foot it waved). Under laid-over glass the foot is the drawn outline, smooth,
        # and the blade bends with the glass: kept straight across the Fulvia's
        # wrap-round screen, its outer end stood a centimetre off the glass, past it.
        if not GO:
            pa, pb = pts[0][0], pts[-1][0]
            if (pb - pa).length > abs(x1 - x0) * 1.3:
                # a stray point off the glass: keep the blade its drawn length
                mid = (pa + pb) / 2
                dvec = (pb - pa).normalized() * abs(x1 - x0) / 2
                pa, pb = mid - dvec, mid + dvec
            nrm_ = sum((n for _, n in pts), Vector()).normalized()
            lift_ = max(0.0, max((p.dot(nrm_) - (pa + (pb - pa) * ((p - pa).dot(pb - pa) / max((pb - pa).length_squared, 1e-9))).dot(nrm_)) for p, _ in pts))
            pts = [(pa + nrm_ * lift_, nrm_), (pb + nrm_ * lift_, nrm_)]
        for (pa, na), (pb, nb) in zip(pts, pts[1:]):
            n_ = (na + nb).normalized()
            along = pb - pa
            if along.length < 1e-4:
                continue
            xv = along.normalized()
            zv = (n_ - xv * n_.dot(xv)).normalized()
            yv = zv.cross(xv)
            rot = Matrix((xv, yv, zv)).transposed().to_4x4()
            box(bm_, (pa + pb) / 2 + zv * 0.007, (along.length + 0.004, 0.012, 0.007), 0, rot)
    trim_parts.append(new_object('wipers', bm_, ['trim']))

# The underside. The body's own bottom closes it flush along the sills; below it hang
# only round, real parts: a live rear axle's tube and the diff's pumpkin (whose bottom
# is such a car's clearance), a 4x4's front diff, the exhaust with its silencer (the
# lowest point of a car without a live axle), a frame's rails tucked under the floor.
# The lowest of them sits at the published clearance, which is what the runtime fits
# the body's bottom to. {engine: 'front'|'rear', frame, independentRear, exhaustX}.
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


def pod(bm_, c, rx, ry, rz, segs=12):
    """A rounded housing (a diff's pumpkin, a silencer's can): a squashed sphere."""
    r = bmesh.ops.create_uvsphere(bm_, u_segments=segs, v_segments=max(6, segs // 2), radius=1.0)
    bmesh.ops.transform(bm_, matrix=Matrix.Translation(Vector(c)) @ Matrix.Diagonal((rx, ry, rz, 1)), verts=r['verts'])


def tube(bm_, a, b, r, segs=10):
    """A pipe from a to b."""
    a, b = Vector(a), Vector(b)
    d = b - a
    if d.length < 1e-4:
        return
    disc(bm_, (a + b) / 2, d.normalized(), r, d.length, segments=segs)


bm_ = bmesh.new()
rear_engine = ub.get('engine', 'front') == 'rear'
x_ex = ub.get('exhaustX', 0.25)
live_rear = rear_bias > 0 and not rear_engine and not ub.get('independentRear')
if live_rear:
    # A live rear axle: the tube between the hubs and the diff's pumpkin on it, its
    # bottom the car's lowest point.
    disc(bm_, (0, yB, R), (1, 0, 0), 0.04, 2 * inner, segments=12)
    rr = max(R - C, 0.06)
    pod(bm_, (0.04, yB, R), 0.13, min(rr, 0.15), rr, 14)
    # the propshaft up to the gearbox, just under the floor
    z_ps = floor_at((yA + yB) / 2) - 0.04
    tube(bm_, (0, yA + 0.35, z_ps), (0, yB - 0.12, R), 0.032)
if 0 < rear_bias < 1:
    # four-wheel drive: the front axle's diff, a little higher than the rear's
    rf = max(R - C - 0.02, 0.06)
    pod(bm_, (-0.08, yA, R), 0.12, min(rf, 0.14), rf, 14)
    if ub.get('frame'):
        disc(bm_, (0, yA, R), (1, 0, 0), 0.04, 2 * inner, segments=12)
# The exhaust: a slim pipe along under the floor to a flat silencer tucked under the
# middle of the floor ahead of the rear axle (under the engine on a rear-engined car),
# out of sight from the side. When nothing else reaches the clearance (no live axle),
# the silencer's bottom does, a flat pan rather than a hanging can.
z_low = C if not (live_rear or 0 < rear_bias < 1) else None
y_sil = (yB + 0.30) if rear_engine else (yB - R - 0.30)
z_floor = floor_at(y_sil)
rz_ = 0.035
zs_ = (z_low + rz_) if z_low is not None else max(z_floor - rz_ - 0.01, C + 0.05)
if z_low is not None:
    # a flat rounded pan reaching up into the floor, never a box hanging below it
    hz = (z_floor + 0.03 - z_low) / 2
    pod(bm_, (0, y_sil, z_low + hz), 0.22, 0.24, hz, 14)
else:
    pod(bm_, (x_ex * 0.5, y_sil, zs_), 0.14, 0.22, rz_, 12)
if not rear_engine:
    zp = min(floor_at((yA + y_sil) / 2) - 0.03, zs_ + 0.02)
    tube(bm_, (x_ex * 0.3, yA + 0.15, zp + 0.02), (x_ex * 0.5, y_sil - 0.2, zs_), 0.022)
    y_t = L / 2 - 0.45
    # the tail pipe runs straight back, level, to just under the tail
    tube(bm_, (x_ex * 0.5, y_sil + 0.2, zs_), (x_ex + 0.1, y_t, zs_ + 0.01), 0.02)
if ub.get('frame'):
    # The chassis rails, tucked under the body from end to end, following its floor.
    xr = inner - 0.22
    # out to the bars where there are bars: a bumper on a frame stands on its horns
    bp_ = info.get('bumperPaths', {})
    y_lo = min(p_[1] for p_ in bp_['front']) + 0.03 if bp_.get('front') else -L / 2 + 0.35
    y_hi = max(p_[1] for p_ in bp_['rear']) - 0.03 if bp_.get('rear') else L / 2 - 0.3
    ys_ = np.linspace(y_lo, y_hi, 14)
    for y0_, y1_ in zip(ys_, ys_[1:]):
        ym = (y0_ + y1_) / 2
        zf = floor_at(min(max(ym, -L / 2 + 0.35), L / 2 - 0.3))
        for sx in (1, -1):
            # Past the floor the rail tucks up under the apron over it (it hung below the
            # nose and tail as two black beams: Hilux).
            hit, _n = skin_point((sx * xr, ym, -0.5), (0, 0, 1), 4.0)
            z_ = max(zf, hit.z) if hit is not None else zf
            box(bm_, (sx * xr, ym, z_ - 0.03), (0.06, y1_ - y0_ + 0.01, 0.10), 0)
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
                    # (the innermost ring lies on the arch's rounded edge, under the lip)
                    if None in xs_ or max(xs_[1:]) - min(xs_[1:]) > 0.03 or (prev is not None and abs(xs_[1] - prev) > 0.02):
                        break
                    keep.add(i)
                    prev = xs_[1]
            if len(keep) < len(rows) // 4:
                # a scrap at the arch's top is no flare
                continue
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

# Grille bars on the ends: straight solid bars standing just proud of the grille behind
# them, each set at the surface's depth under its middle (as decals they followed
# every dent of the shell and waved).
for d in P.get('bars', []):
    if d['view'] not in ('front', 'rear'):
        continue
    bm_ = bmesh.new()
    sgn = -1 if d['view'] == 'front' else 1
    a0, a1 = d['span']
    w_ = d['width']
    for k in range(d['count']):
        t = (k + 0.5) / d['count']
        if d.get('dir', 'h') == 'h':
            zc = d['b'][0] + (d['b'][1] - d['b'][0]) * t
            xa, xb, za, zb = a0, a1, zc, zc
        else:
            xc = a0 + (a1 - a0) * t
            xa, xb, za, zb = xc, xc, d['b'][0], d['b'][1]
        ys_ = []
        for tt in np.linspace(0, 1, 5):
            x_, z_ = xa + (xb - xa) * tt, za + (zb - za) * tt
            hit, _n = skin_point((x_, sgn * (L / 2 + 1.0), z_), (0, -sgn, 0), L + 2)
            if hit is not None:
                ys_.append(hit.y)
        if not ys_:
            continue
        yb = (min(ys_) if sgn < 0 else max(ys_)) + sgn * d.get('height', 0.008)
        ln = max(abs(xb - xa), abs(zb - za))
        size = (ln, 0.012, w_) if d.get('dir', 'h') == 'h' else (w_, 0.012, ln)
        box(bm_, ((xa + xb) / 2, yb - sgn * 0.006, (za + zb) / 2), size, 0)
    trim_parts.append(new_object('bars', bm_, [d.get('material', 'chrome')]))

# Extra hand-placed solid boxes (aerials, spare wheel carriers, roof racks...).
for bx in P.get('boxes', []):
    bm_ = bmesh.new()
    sx_, sy_, sz_ = bx['size']
    rail = sy_ >= 0.6 and sx_ <= 0.08 and sz_ <= 0.06
    for s_ in ((1, -1) if bx.get('mirror', True) else (1,)):
        c = list(bx['c'])
        c[0] *= s_
        if rail:
            # A roof rail: a bar along the roof standing 3 cm off it on feet at its
            # ends and middle, following the roof (a box set at one height floated).
            ys_ = np.linspace(c[1] - sy_ / 2, c[1] + sy_ / 2, 13)
            pts = []
            for y_ in ys_:
                hit, _n = skin_point((c[0], y_, H + 1.0), (0, 0, -1), 3.0)
                if hit is not None:
                    pts.append(Vector((c[0], y_, hit.z)))
            for pa, pb in zip(pts, pts[1:]):
                d_ = pb - pa
                rot = Vector((0, 1, 0)).rotation_difference(d_.normalized()).to_matrix().to_4x4()
                box(bm_, (pa + pb) / 2 + Vector((0, 0, 0.03 + sz_ / 2)), (sx_, d_.length + 0.002, sz_), 0, rot)
            for pf in (pts[0], pts[len(pts) // 2], pts[-1]) if pts else ():
                box(bm_, pf + Vector((0, 0, 0.018)), (sx_ * 1.2, 0.05, 0.04), 0)
            continue
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
    # (the laid-over glass carries the dense shell's normals already)
    if obj.type == 'MESH' and obj is not body and obj is not GO_GLASS:
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
if GO_GLASS is not None:
    # the laid-over panes join their backing in the one `glass` node
    _gl_obj = bpy.data.objects.get('glass')
    if _gl_obj is None:
        GO_GLASS.name = GO_GLASS.data.name = 'glass'
    else:
        bpy.ops.object.select_all(action='DESELECT')
        GO_GLASS.select_set(True)
        _gl_obj.select_set(True)
        bpy.context.view_layer.objects.active = _gl_obj
        bpy.ops.object.join()
LAMP_NODES = {'headlights', 'taillights', 'reverse_lights', 'brake_lights', 'front_blinker_left',
              'front_blinker_right', 'rear_blinker_left', 'rear_blinker_right'}
# The mirrors stay a node of their own, `mirrors`: the game measures the body's width
# without that node (a mirror joined into the trim was taken for the body's side, and the
# whole car squeezed narrower to fit it into the factory width).
join = [o for o in trim_parts if not o.name.startswith('mirrors')] + [o for n, o in part_objects.items() if n not in LAMP_NODES]
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
