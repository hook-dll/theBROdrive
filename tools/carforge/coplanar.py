"""Find faces that lie on top of each other: the cause of z-fighting (run inside Blender).

    Blender --background --factory-startup --python tools/carforge/coplanar.py -- \
        --fbx <file> [--box x0,y0,z0 x1,y1,z1] [--only <name part>] [--gap <mm>]

Two faces z-fight when they are parallel, closer than the depth buffer can tell apart
(`--gap`, default 1.5 mm) and overlap. Each pair is printed with its gap, normal and
centre (FBX metres, the file's own axes); `same` faces point the same way and both show,
`opposite` faces are back to back and never fight. `--box` keeps faces whose centre lies
in it, `--only` objects whose name contains the text. Prints `HITS n`.

The GAZ-31029's grille frame ran its inner wall on into the opening, onto the pocket's own
wall: 15 `same` pairs at 0.00 mm, which this found where the eye saw only a shimmer.
"""
import argparse
import itertools
import sys

import bpy
from mathutils import Vector


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--fbx", required=True)
    ap.add_argument("--box", nargs=2, default=None)
    ap.add_argument("--only", default="")
    ap.add_argument("--gap", type=float, default=1.5)
    return ap.parse_args(argv)


def faces_of(a):
    box = [Vector(float(v) for v in c.split(",")) for c in a.box] if a.box else None
    out = []
    for o in bpy.context.scene.objects:
        if o.type != "MESH" or a.only.lower() not in o.name.lower():
            continue
        mw = o.matrix_world
        nm = mw.to_3x3().inverted().transposed()
        for p in o.data.polygons:
            c = mw @ p.center
            if box and not all(box[0][i] <= c[i] <= box[1][i] for i in range(3)):
                continue
            out.append((o.name, p.index, c, (nm @ p.normal).normalized(),
                        [mw @ o.data.vertices[i].co for i in p.vertices]))
    return out


def contains(f, p):
    """Is p (projected onto f's plane) inside face f's outline?"""
    _, _, c, n, vs = f
    u = (vs[1] - vs[0]).normalized()
    w = n.cross(u)
    poly = [((v - c).dot(u), (v - c).dot(w)) for v in vs]
    x, y = (p - c).dot(u), (p - c).dot(w)
    hit = False
    for (ax, ay), (bx, by) in zip(poly, poly[1:] + poly[:1]):
        if (ay > y) != (by > y) and x < ax + (y - ay) * (bx - ax) / (by - ay):
            hit = not hit
    return hit


def main():
    a = args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=a.fbx)
    faces = faces_of(a)
    print("FACES", len(faces))
    hits = 0
    for f, g in itertools.combinations(faces, 2):
        gap = abs((g[2] - f[2]).dot(f[3]))
        if abs(f[3].dot(g[3])) < 0.999 or gap > a.gap / 1000.0:
            continue
        # overlap: g's centre, or a point 30% in from one of its corners, lies inside f
        if not (contains(f, g[2]) or any(contains(f, g[2] + (v - g[2]) * 0.7) for v in g[4])):
            continue
        hits += 1
        print("OVERLAP", f[0], f[1], "|", g[0], g[1], f"gap_mm={gap * 1000:.2f}",
              "n=", tuple(round(x, 2) for x in f[3]), "c=", tuple(round(x, 3) for x in g[2]),
              "same" if f[3].dot(g[3]) > 0 else "opposite")
    print("HITS", hits)


main()
