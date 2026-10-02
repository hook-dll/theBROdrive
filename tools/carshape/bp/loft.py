"""Builds a car's body shell from cross-sections read off its drawing.

    build/pyenv/bin/python tools/carshape/bp/loft.py <car>

The way a modeller builds a low-poly car: a handful of stations along the body, each
a cross-section given by a few numbers, the shell lofted through them. The lower body
runs nose to tail (sill, side, shoulder, the deck over the bonnet and boot); the
glasshouse is a second loft sitting on it (base, pillars, roof). Edges are where the
section has them, so a crease the car has stays a crease and nothing else is blurred.
Wheel wells are cut round the factory axles. Writes the same files as hull.py
(build/carshape/<car>/hull.ply, work.ply, hull.json), so assemble.py dresses it.

Car file, `loft`:
  body   [{y, sill, w, sh, top, crown?, tumble?, tuck?, bev?, kink?}, ...]
         w the half-width of the side, sh the shoulder (where the upright side turns
         in), top the deck's height on the centre line, crown how far the deck falls to
         its edge, tumble how far the deck edge stands in from the side, tuck how far
         the sill stands in, bev the chamfer at the deck edge.
  house  [{y, base, bw, roof, rw, crown?, bev?, kink?}, ...]
         base the glasshouse's foot (buried in the body), bw its half-width there, roof
         the roof's height on the centre line, rw the half-width of the roof's edge.
Between stations every number runs on a monotone cubic; a station with `kink` ends one
run and starts the next, so the body bends there (a windscreen's foot, a tail's edge).
"""
import json
import os
import sys

import manifold3d as mf
import numpy as np
import trimesh
from scipy.interpolate import PchipInterpolator

sys.path.insert(0, os.path.dirname(__file__))
import grid  # noqa: E402
import hull as hull_mod  # noqa: E402

STEP = 0.04


def runs(stations, keys, defaults):
    """Every key as a function of y: monotone cubic within runs split at kinks."""
    st = sorted(stations, key=lambda s: s['y'])
    cuts = [0] + [i for i, s in enumerate(st) if s.get('kink') and 0 < i < len(st) - 1] + [len(st) - 1]
    ys = [s['y'] for s in st]
    out = []
    for a, b in zip(cuts, cuts[1:]):
        seg = st[a:b + 1]
        yy = np.array([s['y'] for s in seg])
        fs = {}
        for k in keys:
            vv = np.array([s.get(k, defaults.get(k)) for s in seg], float)
            fs[k] = PchipInterpolator(yy, vv) if len(seg) > 2 else (lambda y, yy=yy, vv=vv: np.interp(y, yy, vv))
        out.append((yy[0], yy[-1], fs))
    # Stations along the loft: every given one, and even steps between.
    # (finer towards the ends, where round_ends bends the body in)
    fine = np.concatenate([np.arange(ys[0], ys[0] + 0.2, 0.01), np.arange(ys[-1] - 0.2, ys[-1], 0.01)])
    samples = sorted(set(np.round(np.concatenate([np.arange(ys[0], ys[-1], STEP), fine, ys]), 4)))
    rows = []
    for y in samples:
        for y0, y1, fs in out:
            if y0 - 1e-6 <= y <= y1 + 1e-6:
                rows.append((y, {k: float(f(y)) for k, f in fs.items()}))
                break
    # A kink is two rings at one station only if a run changes there; one is enough.
    return rows


def round_ends(rows, ends, widths, top, sill=None):
    """Rounds the loft's ends the way a body's corners turn: within `plan` of the end
    the half-widths come in on a quarter circle of that radius, the top drops on one of
    radius `top`, the sill rises on one of radius `sill`. {front: {...}, rear: {...}}"""
    if not ends:
        return rows
    y0, y1 = rows[0][0], rows[-1][0]

    def fall(d, r):
        return r - np.sqrt(max(r * r - (r - d) ** 2, 0.0)) if 0 <= d < r else 0.0
    out = []
    for y, p in rows:
        p = dict(p)
        for end, d in (('front', y - y0), ('rear', y1 - y)):
            e = ends.get(end)
            if not e:
                continue
            k = fall(d, e.get('plan', 0.0))
            for w in widths:
                p[w] -= k
            p[top] -= fall(d, e.get('top', 0.0))
            if sill:
                p[sill] += fall(d, e.get('sill', 0.0))
        out.append((y, p))
    return out


BODY_DEF = {'crown': 0.02, 'tumble': 0.03, 'tuck': 0.02, 'bev': 0.03}
HOUSE_DEF = {'crown': 0.03, 'bev': 0.025}


def body_profile(p):
    """Half section, from the centre of the floor out, up the side and back over the deck."""
    sill, w, sh, top = p['sill'], p['w'], p['sh'], p['top']
    edge_z = top - p['crown']
    xe = w - p['tumble']
    bev = p['bev']
    return [
        (0.0, sill),
        (w - p['tuck'] - 0.02, sill),
        (w - p['tuck'], sill + 0.025),
        (w, sill + 0.35 * (sh - sill)),
        (w, sh),
        (xe + bev * 0.15, edge_z - bev),
        (xe - bev, edge_z),
        (xe * 0.55, top - p['crown'] * 0.3),
        (0.0, top),
    ]


def house_profile(p):
    base, bw, roof, rw = p['base'], p['bw'], p['roof'], p['rw']
    edge_z = roof - p['crown']
    bev = p['bev']
    return [
        (0.0, base),
        (bw, base),
        (rw + bev * 0.5, edge_z - bev),
        (rw - bev * 0.6, edge_z),
        (rw * 0.55, roof - p['crown'] * 0.3),
        (0.0, roof),
    ]


def loft(rows, profile):
    """A closed shell through the rings, capped flat at both ends."""
    rings = []
    for y, p in rows:
        half = profile(p)
        # Round the car: the half outward and up, then its mirror back down the other side.
        ring = [(x, y, z) for x, z in half] + [(-x, y, z) for x, z in half[-2:0:-1]]
        rings.append(ring)
    n = len(rings[0])
    verts = [v for r in rings for v in r]
    faces = []
    for i in range(len(rings) - 1):
        a, b = i * n, (i + 1) * n
        for k in range(n):
            k2 = (k + 1) % n
            faces.append((a + k, a + k2, b + k2))
            faces.append((a + k, b + k2, b + k))
    for i, flip in ((0, True), (len(rings) - 1, False)):
        c = len(verts)
        verts.append(tuple(np.mean(rings[i], axis=0)))
        base = i * n
        for k in range(n):
            f = (c, base + (k + 1) % n, base + k)
            faces.append(f[::-1] if flip else f)
    m = trimesh.Trimesh(np.array(verts), np.array(faces), process=True)
    m.merge_vertices()
    m.update_faces(m.nondegenerate_faces())
    m.fix_normals()
    return m


def to_manifold(m):
    return mf.Manifold(mf.Mesh(vert_properties=np.asarray(m.vertices, np.float32),
                               tri_verts=np.asarray(m.faces, np.uint32)))


def from_manifold(M):
    mm = M.to_mesh()
    return trimesh.Trimesh(np.asarray(mm.vert_properties)[:, :3], np.asarray(mm.tri_verts), process=True)


def lin(points, at):
    """Linear through traced [[a, b], ...] (sorted by a), held flat past the ends."""
    p = np.array(sorted(points), float)
    return np.interp(at, p[:, 0], p[:, 1])


def traced_rings(n, master, bottom, top, width, nose, tail):
    """Rings through a traced section: the master half-section (front view, metres)
    stretched between the bottom and top lines and scaled to the plan. Ring k of n
    runs at the same fraction of the body's length at every height, from the nose's
    side profile to the tail's, so the first ring lies on the nose and the last on the
    tail, and the ends lean as drawn."""
    m = np.array(master, float)[:, :2]
    zb, zt, xm = m[:, 1].min(), m[:, 1].max(), m[:, 0].max()
    u, v = m[:, 0] / xm, (m[:, 1] - zb) / (zt - zb)
    y0, y1 = min(p[1] for p in nose), max(p[1] for p in tail)
    rings = []
    for t in np.linspace(0, 1, n):
        yy = np.full(len(u), y0 + t * (y1 - y0))
        for _ in range(6):
            z = lin(bottom, yy) + v * (lin(top, yy) - lin(bottom, yy))
            a, b = lin(nose, z), lin(tail, z)
            yy = a + t * (b - a)
        x = u * lin(width, yy)
        half = list(zip(x, yy, z))
        rings.append(half + [(-a_, b_, c_) for a_, b_, c_ in half[-2:0:-1]])
    return rings


def shell_from_rings(rings):
    """A closed tube through the rings, capped at both ends. Kept exactly as built (no
    welding): where an end's profile squeezes rings together their points coincide, and
    welding them would tear the topology the boolean needs."""
    n = len(rings[0])
    verts = [v for r in rings for v in r]
    faces = []
    for i in range(len(rings) - 1):
        a, b = i * n, (i + 1) * n
        for k in range(n):
            k2 = (k + 1) % n
            faces.append((a + k, a + k2, b + k2))
            faces.append((a + k, b + k2, b + k))
    # The ends: strips straight across, each point to its mirror, so an end stands at
    # its own profile's depth at every height (a fan from the middle would cone it).
    h = (n + 2) // 2

    def mirror(k):
        return k if k in (0, h - 1) else n - k
    for i in (0, len(rings) - 1):
        o = i * n
        for k in range(h - 1):
            a_, b_, c_, d_ = o + k, o + k + 1, o + mirror(k + 1), o + mirror(k)
            faces.append((a_, b_, c_))
            if d_ != a_:
                faces.append((a_, c_, d_))
    m = trimesh.Trimesh(np.array(verts), np.array(faces), process=False)
    m.update_faces(np.array([len(set(f)) == 3 for f in m.faces]))
    m.fix_normals()
    return m


def traced_shell(spec):
    """`trace`: the body as traced off the drawing, line for line.
      section / houseSection   half-sections from the front view, [[x, z], ...] in metres,
                               from the floor's (base's) centre out and over to the top's
      sill, deck               the body's bottom and top on the centre line, [[y, z], ...]
      plan                     the body's half-width, [[y, x], ...] (top view)
      belt, roof, glass        the glasshouse's foot, its top on the centre line, its
                               half-width at the foot
      nose, tail               the ends' side profiles, [[z, y], ...]
      house                    [y0, y1], where the glasshouse runs"""
    t = spec['trace']
    y0 = min(p[1] for p in t['nose'])
    y1 = max(p[1] for p in t['tail'])
    ys = np.arange(y0, y1 + 1e-9, 0.02)
    body = traced_rings(len(ys), t['section'], t['sill'], t['deck'], t['plan'], t['nose'], t['tail'])
    h0, h1 = t['house']
    hy = np.arange(h0, h1 + 1e-9, 0.02)
    house = traced_rings(len(hy), t['houseSection'], t['belt'], t['roof'], t['glass'],
                         t.get('houseNose', [[0, h0], [9, h0]]), t.get('houseTail', t['tail']))
    return to_manifold(shell_from_rings(body)) + to_manifold(shell_from_rings(house)), \
        [(y, {'sill': float(lin(t['sill'], y))}) for y in ys], [(y, {'roof': float(lin(t['roof'], y))}) for y in hy], \
        glazing(t, house, body)


def glazing(t, house, body):
    """The panes, from the glasshouse itself. Each side window runs between its pillars
    from the belt (never below the body's own top under it) up to the roof's edge, so
    where it meets the screen pillar it follows the pillar's slope; the screen is the
    glasshouse's leaning front end and the back light its back end, each above the body
    and inside a frame of the body (or of a material of its own); every pane in a
    rubber seal. Outlines in the views' coordinates, as the car files give them. Also
    where the wipers park (the screen's foot) and where a mirror stands (the first side
    window's front lower corner).
      glazing: {gutter (index in houseSection of the roof's edge), frame, belt, seal,
                side: [[y0, y1], ...], screen: {frame, lift, frameMaterial},
                back: {frame, lift} or {outline (half, in the rear view), y: [y0, y1]},
                houseMaterial (a soft top)}"""
    from shapely.geometry import Polygon
    g = t.get('glazing')
    if not g:
        return [], {}
    rings = [np.array(r) for r in house]
    k = g['gutter']
    edge = np.array(sorted((r[k][1], r[k][2]) for r in rings))
    out, extra = [], {}
    seal = g.get('seal', 0.012)

    def inset(pts, f):
        poly = Polygon(pts).buffer(-f, join_style=2)
        if poly.is_empty:
            return None
        if poly.geom_type != 'Polygon':
            poly = max(poly.geoms, key=lambda q: q.area)
        return [[round(a, 4), round(b, 4)] for a, b in list(poly.exterior.coords)[:-1]]

    def add(pane, outer):
        out.append(pane)
        if seal and outer:
            out.append(dict(pane, frame=True, outline=outer, ring=seal, material='rubber', height=0.002))
    belt = g.get('belt', [[p[0], p[1] - 0.01] for p in t['deck']])
    # The body's own top at the glasshouse's foot, station by station.
    by, bz = [], []
    for r in body:
        r = np.array(r)
        gx = float(lin(t['glass'], np.mean(r[:, 1])))
        near = r[(r[:, 0] >= gx - 0.02)]
        if len(near):
            by.append(np.mean(r[:, 1]))
            bz.append(near[:, 2].max())
    o_ = np.argsort(by)
    by, bz = np.array(by)[o_], np.array(bz)[o_]
    for i, (y0, y1) in enumerate(g.get('side', [])):
        yy = np.linspace(y0, y1, 50)
        zb = np.maximum(lin(belt, yy), np.interp(yy, by, bz) + 0.005)
        zt = np.interp(yy, edge[:, 0], edge[:, 1])
        ok = zt > zb + 0.02
        if ok.sum() < 2:
            continue
        pts = [(a, b) for a, b in zip(yy[ok], zb[ok])] + [(a, b) for a, b in zip(yy[ok][::-1], zt[ok][::-1])]
        f = g.get('frame', 0.035)
        o = inset(pts, f)
        if o:
            add({'view': 'side', 'outline': o, 'facingMin': 0.3}, inset(pts, f - seal))
            if i == 0:
                zmin = min(p[1] for p in o)
                low = [p for p in o if p[1] < zmin + 0.03]
                c = min(low, key=lambda p: p[0])
                extra['mirrorAt'] = [c[0], c[1]]
    if g.get('houseMaterial'):
        # A soft top: the whole glasshouse behind the screen, down to where it sits on
        # the deck, in its own material (the panes keep theirs).
        # (from the glasshouse's very front: the screen and its frame are not paint, so
        # only the pillars and the hood take it; its foot just clear of the deck)
        yy = np.linspace(t['house'][0], t['house'][1] + 0.1, 80)
        pts = [(a, float(lin(t['deck'], a)) + 0.008) for a in yy] + [(yy[-1], 3.0), (yy[0], 3.0)]
        out.append({'region': True, 'view': 'side', 'outline': [[round(a, 4), round(b, 4)] for a, b in pts],
                    'material': g['houseMaterial'], 'facingMin': -1.0})
    for key, view, r in (('screen', 'front', rings[0]), ('back', 'rear', rings[-1])):
        sc = g.get(key)
        if not sc:
            continue
        if sc.get('outline'):
            # a pane given outright in the view (a soft top's window sewn into the
            # canvas), half [[x, z], ...] mirrored
            h_ = sc['outline']
            o = [[a, b] for a, b in h_] + [[-a, b] for a, b in h_[::-1] if a > 0]
            ya, yb = sc['y']
            add({'view': view, 'outline': o, 'mirror': False, 'depthRange': [min(ya, yb) - 0.04, max(ya, yb) + 0.04],
                 'facingMin': sc.get('facingMin', 0.15)}, inset(o, -seal))
            continue
        # The end ring above the body: the body's top where the end meets it.
        foot = r[r[:, 2] < r[:, 2].min() + 0.05]
        z_floor = float(np.interp(np.mean(foot[:, 1]), by, bz)) + sc.get('lift', 0.0)
        f = sc.get('frame', 0.05)
        # The pane's foot sits `foot` above the body (the screen's lower rubber on the
        # scuttle), its sides and head inside a frame `f` wide.
        z_cut = z_floor - (f - sc.get('foot', 0.015))
        half = [(x, max(z, z_cut)) for x, _, z in r[: len(r) // 2 + 1]]
        sec = half + [(-x, z) for x, z in half[::-1]]
        # How deep the pane runs: the end's own side profile from its foot to its head.
        prof = t.get('houseNose', [[0, t['house'][0]], [9, t['house'][0]]]) if key == 'screen' \
            else t.get('houseTail', t['tail'])
        zs_ = np.linspace(z_floor, r[:, 2].max(), 20)
        ys_ = lin(prof, zs_)
        dr = [float(ys_.min()) - 0.04, float(ys_.max()) + 0.04]
        o = inset(sec, f)
        if not o:
            continue
        pane = {'view': view, 'outline': o, 'mirror': False, 'depthRange': dr, 'facingMin': sc.get('facingMin', 0.15)}
        add(pane, inset(sec, f - seal))
        if sc.get('frameMaterial'):
            # A frame in its own colour (a black screen surround): a ring round the pane.
            out.append(dict(pane, frame=True, outline=inset(sec, 0.004), ring=f - seal - 0.004,
                            material=sc['frameMaterial'], height=0.003))
        if key == 'screen':
            zf = min(p[1] for p in o)
            extra['screenFoot'] = [float(lin(prof, zf)), zf]
    return out, extra


def build(car):
    spec, _bp = grid.load(car)
    F = spec['factory']
    L, W, R = F['length'], F['width'], F['wheelRadius']
    hs = spec.get('hull', {})
    if 'trace' in spec:
        shell, body_rows, house_rows, glass = traced_shell(spec)
    else:
        lo = spec['loft']
        body_rows = runs(lo['body'], ['sill', 'w', 'sh', 'top', 'crown', 'tumble', 'tuck', 'bev'], BODY_DEF)
        house_rows = runs(lo['house'], ['base', 'bw', 'roof', 'rw', 'crown', 'bev'], HOUSE_DEF)
        body_rows = round_ends(body_rows, lo.get('ends'), ['w'], 'top', 'sill')
        house_rows = round_ends(house_rows, lo.get('houseEnds'), ['bw', 'rw'], 'roof')
        shell = to_manifold(loft(body_rows, body_profile)) + to_manifold(loft(house_rows, house_profile))

    # Wheel wells: a drum round each axle from just inside the tyre outwards, carried
    # straight down below the hub.
    ya_f = -L / 2 + F['frontOverhang']
    for ya, track, which in ((ya_f, F['frontTrack'], 'front'), (ya_f + F['wheelbase'], F['rearTrack'], 'rear')):
        arch = dict(hs.get('arch', {}), **hs.get('arch', {}).get(which, {}))
        ra = arch.get('radius', R * 1.14)
        za = R + arch.get('lift', 0.02)
        x_in = track / 2 - F['tyreWidth'] / 2 - arch.get('inset', 0.04)
        span = W / 2 + 0.2 - x_in
        for s in (1, -1):
            drum = mf.Manifold.cylinder(span, ra, ra, 48).rotate([0, 90, 0])
            drum = drum.translate([x_in if s > 0 else -x_in - span, ya, za])
            below = mf.Manifold.cube([span, 2 * ra, za]).translate([x_in if s > 0 else -x_in - span, ya - ra, -0.01])
            shell = shell - drum - below
    mesh = from_manifold(shell)
    # The cuts can leave slivers of no volume where a drum grazes the shell: only the
    # body itself is kept.
    mesh = max(trimesh.graph.split(mesh, only_watertight=False), key=lambda p: len(p.faces))
    if mesh.volume < 0:
        mesh.invert()

    out = os.path.join(grid.ROOT, 'build/carshape', car)
    os.makedirs(out, exist_ok=True)
    mesh.export(os.path.join(out, 'hull.ply'))
    mesh.export(os.path.join(out, 'work.ply'))
    ys = np.round(np.arange(-L / 2, L / 2 + 1e-9, 0.01), 3)
    sill = np.interp(ys, [y for y, _ in body_rows], [p['sill'] for _, p in body_rows])
    top = np.interp(ys, [y for y, _ in house_rows], [p['roof'] for _, p in house_rows], left=0, right=0)
    info = {'ys': ys.tolist(), 'sill': np.round(sill, 3).tolist(), 'top': np.round(top, 3).tolist(),
            'cabin': [house_rows[0][0], house_rows[-1][0]], 'loft': True}
    if 'trace' in spec:
        info['glass'], extra = glass
        info.update(extra)
    info['bumperPaths'] = hull_mod.bumper_paths(mesh, spec, info, {})
    json.dump(info, open(os.path.join(out, 'hull.json'), 'w'))
    print(f'LOFT {car}: {len(mesh.faces)} faces, volume {mesh.volume:.3f} m3, '
          f'extent {np.round(mesh.extents, 3).tolist()}, watertight {mesh.is_watertight}')


if __name__ == '__main__':
    build(sys.argv[1])
