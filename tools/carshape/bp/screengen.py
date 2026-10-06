"""A windscreen outline in plan, generated off the built shell (as the Fulvia's was).

    build/pyenv/bin/python tools/carshape/bp/screengen.py <car> <foot z> <header z> <pillar z:y,...> [inset]

The pillar line is the side photograph's A-pillar in the car's metres (z:y pairs read
off the calibrated photo: photosheet.py), heights as built (real metres). The outline:
its foot where the screen rises through <foot z> across the car, its header where it
reaches <header z>, its sides `inset` (default 7 mm) ahead of the pillar line, found on
the skin by side rays; rounded 6 cm into the header and 2 cm at the foot. Printed as a
car-file `glass` entry in the top view ([y, x], the right half from the centreline
round to it), which the overlay mirrors into one pane.
"""
import os
import sys

import numpy as np
import trimesh

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
car, ZF, ZH = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
PL = sorted((float(a), float(b)) for a, b in (p.split(':') for p in sys.argv[4].split(',')))
SV = float(sys.argv[5]) if len(sys.argv) > 5 else 0.007
m = trimesh.load(os.path.join(ROOT, 'build/carshape', car, 'work.ply'), force='mesh')
ri = trimesh.ray.ray_triangle.RayMeshIntersector(m)


def ray(o, d):
    loc, _, _ = ri.intersects_location([o], [d], multiple_hits=False)
    return loc[0] if len(loc) else None


def zt(x, y):
    p = ray([x, y, 3.0], [0, 0, -1])
    return p[2] if p is not None else None


def xs(y, z):
    p = ray([3.0, y, z], [-1, 0, 0])
    return p[0] if p is not None else None


def yp(z):
    return float(np.interp(z, [a for a, _ in PL], [b for _, b in PL]))


def cross_y(x, z, y0, y1):
    """Where the surface at x rises through z, walking back along the car."""
    prev = None
    for y in np.arange(y0, y1, 0.001):
        h = zt(x, y)
        if h is not None and h >= z:
            return y if prev is None else prev[0] + (y - prev[0]) * (z - prev[1]) / (h - prev[1])
        if h is not None:
            prev = (y, h)
    return None


def fillet(poly, i, r, n=6):
    p = [np.array(q, float) for q in poly]
    k = len(p)
    j, left = i, r
    while True:
        jp = (j - 1) % k
        seg = np.linalg.norm(p[j] - p[jp])
        if seg >= left:
            s, ja = p[j] + (p[jp] - p[j]) * (left / seg), jp
            break
        left -= seg
        j = jp
    j, left = i, r
    while True:
        jn = (j + 1) % k
        seg = np.linalg.norm(p[jn] - p[j])
        if seg >= left:
            e, jc = p[j] + (p[jn] - p[j]) * (left / seg), jn
            break
        left -= seg
        j = jn
    arc = [((1 - t) ** 2) * s + 2 * (1 - t) * t * p[i] + t * t * e for t in np.linspace(0, 1, n)]
    out, j = [], jc
    while True:
        out.append(p[j])
        if j == ja:
            break
        j = (j + 1) % k
    out += arc
    z0 = next(t for t, q in enumerate(out) if np.allclose(q, p[0]))
    return [list(q) for q in out[z0:] + out[:z0]]


ymid = cross_y(0.0, (ZF + ZH) / 2, -3.0, 1.0)
edge = []
for z in np.linspace(ZF, ZH, int(round((ZH - ZF) / 0.025)) + 1):
    x = xs(yp(z) - SV, z)
    if x is not None:
        edge.append((yp(z) - SV, x))
xf, xh = edge[0][1], edge[-1][1]
foot = [(cross_y(x, ZF, ymid - 0.6, ymid + 0.3), x) for x in np.arange(0.0, xf - 0.025, 0.05)]
head = [(cross_y(x, ZH, ymid - 0.3, ymid + 0.6), x) for x in np.arange(0.0, xh - 0.02, 0.05)][::-1]
if any(p[0] is None for p in foot + head):
    sys.exit('the foot or header line runs off the screen: choose other heights')
scr = foot + edge + head
scr = fillet(scr, len(foot) + len(edge) - 1, 0.06, 8)
scr = fillet(scr, len(foot), 0.02, 4)
pts = [[round(float(a), 4), round(float(b), 4)] for a, b in scr]
print(f"{{'view': 'top', 'outline': {pts},\n 'depthRange': [{ZF - 0.05:.2f}, {ZH + 0.04:.2f}]}},")
