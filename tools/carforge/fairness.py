"""Surface-fairness check of a generated car body (run inside Blender).

    blender --background --factory-startup --python tools/carforge/fairness.py -- \
        --fbx car.fbx [--prefix build/carforge/renders/name] [--json out.json]

Waves and accordion folds on a low-poly body come from three things, each measured on the
`*.body` mesh as it is exported:

- fold: a quad whose two triangles meet at an angle (either diagonal). The game
  triangulates it along whichever diagonal comes first and the face shades as a crease.
- ripple: read along section profiles of the left half (side rows along the car and up its
  side, top rows along and across the roof and bonnet, sampled by rays every STEP_MM): a
  gentle bend followed within RIPPLE_SPAN_MM by a gentle bend the other way. A designed
  crease (belt, windscreen base) is one sharp bend; a ripple is a small zig-zag. Sampling is
  independent of how the faces are split, so a dent hidden in a triangle fan still counts.
- sliver: a face thinner than SLIVER_MM that turns gently from its surface (the product of
  rows pressed onto each other, or a cut left a hair from a grid line); it shades as a streak.
  A thin face flush with its surface shades exactly like it and is not counted.

Prints `FAIR {...}` with counts and the worst offenders (positions in mm, spec frame:
y rearward from the front axle, z up, x left). With --prefix, writes <prefix>_fair_q.png,
_fair_side.png, _fair_top.png, _fair_front.png, _fair_qrear.png: body in grey, folds blue,
ripples red, slivers yellow; and <prefix>_shine_q.png / _shine_side.png / _shine_qrear.png, a
glossy matcap render where any wave shows as a kinked reflection.
"""

import argparse
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

FOLD_DEG = 1.5        # a quad folded more than this is a defect
RIPPLE_MAX_DEG = 12.0  # bends gentler than this can be part of a ripple
RIPPLE_MIN_DEG = 1.0   # bends below this are flat: under ~1.5% flat-shaded brightness step
RIPPLE_SPAN_MM = 700.0  # a bend and its counter-bend closer than this are a ripple
STEP_MM = 10.0        # sample spacing along a profile
ROW_MM = 25.0         # spacing of profiles along the car (side_z, top_x)
COL_MM = 50.0         # spacing of cross profiles (side_y, top_y)
JUMP = 3.0            # a sample step steeper than JUMP x STEP_MM ends a run (edge-on or a step)
SLIVER_MM = 6.0       # faces whose smallest height is under this are slivers
GLASS_CELL = (3, 1)
SAME_SURFACE_DEG = 30.0  # neighbours turning less than this belong to the same surface
ATLAS = (9, 2)


def parse():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--fbx", required=True)
    ap.add_argument("--prefix")
    ap.add_argument("--json")
    ap.add_argument("--size", type=int, nargs=2, default=[1100, 640])
    return ap.parse_args(argv)


def mm(v):
    """Blender world (m, +X left, -Y front) -> spec frame mm [x, y, z]."""
    return [round(v.x * 1000), round(v.y * 1000), round(v.z * 1000)]


def fold_deg(f):
    if len(f.verts) != 4:
        return 0.0
    a, b, c, d = (v.co for v in f.verts)
    best = 180.0
    for p, q, r, s in ((a, b, c, d), (b, c, d, a)):  # diagonal p-r, triangles pqr and prs
        n1 = (q - p).cross(r - p)
        n2 = (r - p).cross(s - p)
        if n1.length < 1e-12 or n2.length < 1e-12:
            continue
        best = min(best, math.degrees(n1.angle(n2)))
    return 0.0 if best == 180.0 else best



def min_height_mm(f):
    """Smallest distance from a vertex to the opposite edges' lines: a sliver's thickness."""
    vs = [v.co for v in f.verts]
    n = len(vs)
    best = 1e9
    for i in range(n):
        a, b = vs[i], vs[(i + 1) % n]
        ab = b - a
        if ab.length < 1e-9:
            continue
        far = max((p - a).cross(ab).length / ab.length for p in vs)
        best = min(best, far)
    return best * 1000


def is_glass(f, uvl):
    u = sum(l[uvl].uv.x for l in f.loops) / len(f.loops)
    v = sum(l[uvl].uv.y for l in f.loops) / len(f.loops)
    return (int(u * ATLAS[0]), int(v * ATLAS[1])) == GLASS_CELL


def sections(bm):
    """Profiles of the left half as a viewer reads them: (label, fixed coordinate, travel
    direction, [(t mm, value mm, face index) | None]) sampled every STEP_MM by ray casts. Side
    rows (rays along -X at fixed z, and at fixed y going up), top rows (rays down at fixed x,
    and at fixed y going across)."""
    bvh = BVHTree.FromBMesh(bm)
    xs = [v.co.x for v in bm.verts]
    ys = [v.co.y for v in bm.verts]
    zs = [v.co.z for v in bm.verts]
    lo = Vector((min(xs), min(ys), min(zs)))
    hi = Vector((max(xs), max(ys), max(zs)))
    st = STEP_MM / 1000
    far = 5.0

    def rng(a, b, step):
        n = int((b - a) / step)
        return [a + step * (i + 0.5) for i in range(n)]

    def profile(ts, origin_of, d, axis):
        out = []
        for t in ts:
            loc, _, idx, _ = bvh.ray_cast(origin_of(t), d)
            out.append(None if loc is None else (t * 1000, loc[axis] * 1000, idx))
        return out

    left, down = Vector((-1, 0, 0)), Vector((0, 0, -1))
    along_y, up, across = Vector((0, 1, 0)), Vector((0, 0, 1)), Vector((1, 0, 0))
    out = []
    for z in rng(lo.z, hi.z, ROW_MM / 1000):
        out.append(("side_z", z, along_y, profile(rng(lo.y, hi.y, st), lambda y: Vector((far, y, z)), left, 0)))
    for y in rng(lo.y, hi.y, COL_MM / 1000):
        out.append(("side_y", y, up, profile(rng(lo.z, hi.z, st), lambda z: Vector((far, y, z)), left, 0)))
    for x in rng(0.0, hi.x, ROW_MM / 1000):
        out.append(("top_x", x, along_y, profile(rng(lo.y, hi.y, st), lambda y: Vector((x, y, far)), down, 2)))
    for y in rng(lo.y, hi.y, COL_MM / 1000):
        out.append(("top_y", y, across, profile(rng(0.0, hi.x, st), lambda x: Vector((x, y, far)), down, 2)))
    return out


def kinks(samples, travel, normals, island):
    """Bends along one profile: [t, signed degrees, face indices]. A bend is the angle between
    the normals of consecutive hit faces (what shading shows, whatever the slope against the
    ray); + where the surface turns over a hill, - into a valley. Samples one bend spreads over
    are merged. None ends a run, as does a jump (edge on, a step, a hole) or a change of
    surface island (from the shell onto a bumper, lip or plate: a ripple lives on one surface)."""
    out, run = [], []

    def flush():
        cur = None
        for a, b in zip(run, run[1:]):
            if a[2] == b[2]:
                continue
            na, nb = normals[a[2]], normals[b[2]]
            d = math.degrees(na.angle(nb, 0.0))
            if d < RIPPLE_MIN_DEG / 4:
                continue
            if (nb - na).dot(travel) < 0:
                d = -d
            if cur and (cur[1] > 0) == (d > 0) and b[0] - cur[0] <= 2 * STEP_MM:
                cur[1] += d
                cur[2].update((a[2], b[2]))
                cur[0] = b[0]
            else:
                cur = [b[0], d, {a[2], b[2]}]
                out.append(cur)

    for s in samples:
        if s is None or (run and (abs(s[1] - run[-1][1]) > JUMP * STEP_MM or island[s[2]] != island[run[-1][2]])):
            flush()
            run = [] if s is None else [s]
            continue
        run.append(s)
    flush()
    return [k for k in out if abs(k[1]) >= RIPPLE_MIN_DEG]


def islands(bm):
    """Connected-surface id per face index (faces joined through shared edges)."""
    island = [-1] * len(bm.faces)
    for seed in bm.faces:
        if island[seed.index] >= 0:
            continue
        island[seed.index] = seed.index
        stack = [seed]
        while stack:
            f = stack.pop()
            for e in f.edges:
                for g in e.link_faces:
                    if island[g.index] < 0:
                        island[g.index] = seed.index
                        stack.append(g)
    return island


def ripples(bm):
    """A ripple is a gentle bend reversed by the next bend along the same profile within
    RIPPLE_SPAN_MM. A designed crease (sharper than RIPPLE_MAX_DEG) separates runs."""
    found = []
    normals = [f.normal.copy() for f in bm.faces]
    island = islands(bm)
    for label, c, travel, samples in sections(bm):
        ks = kinks(samples, travel, normals, island)
        for a, b in zip(ks, ks[1:]):
            if max(abs(a[1]), abs(b[1])) > RIPPLE_MAX_DEG:
                continue
            if (a[1] > 0) != (b[1] > 0) and b[0] - a[0] <= RIPPLE_SPAN_MM:
                found.append({"profile": label, "at_mm": round(c * 1000), "from": round(a[0]), "to": round(b[0]),
                              "deg": [round(a[1], 2), round(b[1], 2)], "faces": a[2] | b[2]})
    return found


def bent(f):
    """True when face f turns gently (RIPPLE_MIN_DEG..SAME_SURFACE_DEG) from a neighbour across
    an edge: it belongs to that surface but shades unlike it. A thin face flush with its
    surface (a cut's wedge on a flat panel) shades exactly like it; a sharp turn is an edge."""
    for e in f.edges:
        for g in e.link_faces:
            if g is not f and RIPPLE_MIN_DEG < math.degrees(f.normal.angle(g.normal, 0.0)) < SAME_SURFACE_DEG:
                return True
    return False


def analyse(body):
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.transform(body.matrix_world)
    bm.normal_update()
    bm.faces.ensure_lookup_table()
    bm.edges.ensure_lookup_table()
    uvl = bm.loops.layers.uv.active
    folds = [(fold_deg(f), f) for f in bm.faces]
    folds = [(a, f) for a, f in folds if a > FOLD_DEG]
    rip = ripples(bm)
    slivers = [(min_height_mm(f), f) for f in bm.faces if f.calc_area() > 1e-8]
    slivers = [(h, f) for h, f in slivers if h < SLIVER_MM and bent(f)]
    report = {
        "faces": len(bm.faces),
        "folds": len(folds),
        "fold_max_deg": round(max((a for a, _ in folds), default=0.0), 2),
        "ripples": len(rip),
        "slivers": len(slivers),
        "worst_folds": [{"deg": round(a, 2), "at": mm(f.calc_center_median()), "glass": is_glass(f, uvl)}
                        for a, f in sorted(folds, key=lambda t: -t[0])[:12]],
        "worst_ripples": [{k: v for k, v in r.items() if k != "faces"}
                          for r in sorted(rip, key=lambda r: -min(abs(d) for d in r["deg"]))[:24]],
        "worst_slivers": [{"mm": round(h, 2), "at": mm(f.calc_center_median())}
                          for h, f in sorted(slivers, key=lambda t: t[0])[:12]],
    }
    marks = {}
    for r in rip:
        for i in r["faces"]:
            marks[i] = (0.85, 0.1, 0.1, 1.0)
    for _, f in folds:
        marks.setdefault(f.index, (0.15, 0.35, 0.95, 1.0))
    for _, f in slivers:
        marks.setdefault(f.index, (0.95, 0.85, 0.1, 1.0))
    bm.free()
    return report, marks


def colour_faces(body, marks):
    me = body.data
    attr = me.color_attributes.new("fair", "FLOAT_COLOR", "CORNER")
    grey = (0.62, 0.63, 0.65, 1.0)
    for p in me.polygons:
        c = marks.get(p.index, grey)
        for li in p.loop_indices:
            attr.data[li].color = c
    me.color_attributes.active_color = attr


def camera(direction, centre, size, ortho, aspect):
    data = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", data)
    bpy.context.scene.collection.objects.link(cam)
    d = direction.normalized()
    r = max(size) * 3.0
    cam.location = centre + d * r
    cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
    if ortho:
        data.type = "ORTHO"
        data.ortho_scale = max(ortho[0], ortho[1] * aspect) * 1.1
    data.clip_start, data.clip_end = 0.01, r * 4
    bpy.context.scene.camera = cam


def render(path, size):
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = size
    sc.render.resolution_percentage = 100
    sc.render.filepath = path
    sc.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(write_still=True)
    print("RENDER " + path)


def render_views(body, prefix, size):
    for o in list(bpy.context.scene.objects):
        if o is not body:
            o.hide_render = True
    lo = Vector([min((body.matrix_world @ Vector(c))[i] for c in body.bound_box) for i in range(3)])
    hi = Vector([max((body.matrix_world @ Vector(c))[i] for c in body.bound_box) for i in range(3)])
    centre, ext = (lo + hi) / 2, hi - lo
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sh = sc.display.shading
    sc.world = bpy.data.worlds.new("bg")
    sc.world.color = (0.3, 0.31, 0.33)
    sh.background_type = "WORLD"
    aspect = size[0] / size[1]
    os.makedirs(os.path.dirname(os.path.abspath(prefix)), exist_ok=True)
    views = {
        "q": (Vector((0.85, -0.85, 0.42)), None),
        "side": (Vector((1, 0, 0)), (ext.y, ext.z)),
        "top": (Vector((0, 0.0001, 1)), (ext.y, ext.x)),
        "front": (Vector((0, -1, 0)), (ext.x, ext.z)),
        "qrear": (Vector((-0.85, 0.85, 0.42)), None),
    }
    sh.light, sh.color_type = "STUDIO", "VERTEX"
    sh.show_cavity = False
    sc.display.shading.show_object_outline = False
    for name, (d, ortho) in views.items():
        camera(d, centre, ext, ortho, aspect)
        render(f"{prefix}_fair_{name}.png", size)
    sh.light, sh.color_type = "MATCAP", "SINGLE"
    sh.studio_light = "metal_carpaint.exr"
    sh.single_color = (0.8, 0.8, 0.8)
    for name in ("q", "side", "qrear"):
        d, ortho = views[name]
        camera(d, centre, ext, ortho, aspect)
        render(f"{prefix}_shine_{name}.png", size)


def main():
    a = parse()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=os.path.abspath(a.fbx))
    body = next((o for o in bpy.context.scene.objects if o.type == "MESH" and o.name.endswith(".body")), None)
    if body is None:
        raise SystemExit("fairness: no *.body mesh in " + a.fbx)
    report, marks = analyse(body)
    print("FAIR " + json.dumps(report))
    if a.json:
        with open(a.json, "w") as fh:
            json.dump(report, fh, indent=1)
    if a.prefix:
        colour_faces(body, marks)
        render_views(body, a.prefix, a.size)


if __name__ == "__main__":
    main()
