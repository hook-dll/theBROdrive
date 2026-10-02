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
    samples = sorted(set(np.round(np.concatenate([np.arange(ys[0], ys[-1], STEP), ys]), 4)))
    rows = []
    for y in samples:
        for y0, y1, fs in out:
            if y0 - 1e-6 <= y <= y1 + 1e-6:
                rows.append((y, {k: float(f(y)) for k, f in fs.items()}))
                break
    # A kink is two rings at one station only if a run changes there; one is enough.
    return rows


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


def build(car):
    spec, _bp = grid.load(car)
    F = spec['factory']
    L, W, R = F['length'], F['width'], F['wheelRadius']
    lo = spec['loft']
    hs = spec.get('hull', {})
    body_rows = runs(lo['body'], ['sill', 'w', 'sh', 'top', 'crown', 'tumble', 'tuck', 'bev'], BODY_DEF)
    house_rows = runs(lo['house'], ['base', 'bw', 'roof', 'rw', 'crown', 'bev'], HOUSE_DEF)
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
    info['bumperPaths'] = hull_mod.bumper_paths(mesh, spec, info, {})
    json.dump(info, open(os.path.join(out, 'hull.json'), 'w'))
    print(f'LOFT {car}: {len(mesh.faces)} faces, volume {mesh.volume:.3f} m3, '
          f'extent {np.round(mesh.extents, 3).tolist()}, watertight {mesh.is_watertight}')


if __name__ == '__main__':
    build(sys.argv[1])
