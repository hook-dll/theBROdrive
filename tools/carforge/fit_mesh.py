"""Fit a carforge spec (new three-view schema, mm) to a reference car mesh (run inside Blender).

  blender --background --factory-startup --python tools/carforge/fit_mesh.py -- \
      --in public/models/soviet/vz01.fbx --out build/carforge/specs/vz01.json --id vz01x

The reference is FBX (pack, glass = atlas cell GLASS_CELL) or glTF (glass = material named glass).
Wheel objects (name contains "wheel", exactly four) give the axles, tyre radius, width and track.
Lamp objects (name ends in a lamp role) are kept as boxes; every other mesh is body.

Trim at the ends (FBX: faces in neither the paint nor the glass cell, in the outer END_ZONE of the
length) is grouped by connectivity: a low, wide group is a bumper (a box in the spec, and left out
of the slices so the ends are not sliced through it), a group facing forward or back is a grille
plate (kept if it stands on the generated end face).

The body is sliced by STATIONS planes along y, END_INSET inside the ends; the end stations are put
at the true ends. Each slice gives, in spec mm:
  side.top / side.bottom  max / min z of the body
  side.shoulder           z of the largest inward step of the half-width (20-mm drop, between 25 % and
                          85 % of the height); the belt where the slice has no step (median-smoothed)
  plan.low / plan.high    max |x| below / above the shoulder
Glass gives: windows (each connected run of left side glass, its outline the glass's convex hull in
the side view), belt and glass_top (medians of the side glass faces' bottom and top z), windscreen
and backlight (roof-slope glass facing -y / +y, widened by the 60 mm carforge frame), and tumblehome
(half-width at glass_top and near the top relative to the belt, averaged over the slices that cross
a window). The spec's fair_tol is FIT_FAIR_TOL: slices of a faceted mesh carry facet noise.

Frame: spec y rearward from the front-axle centre, z up from the wheel ground, x to the car's left.
Prints one line `FIT {...}` with the measured length, width, height, wheelbase, tracks and the
window, bumper and plate counts.
"""

import argparse
import json
import math
import os
import re
import statistics
import sys
from collections import Counter

import bmesh
import bpy
from mathutils import Vector

MM = 1000.0
STATIONS = 41
GLASS_CELL = (3, 1)        # pack atlas cell of glass (src/vehicle/carmodels.ts glassUvCell)
ATLAS_COLS, ATLAS_ROWS = 9, 2
CELL_NAMES = {(0, 1): "steel", (1, 1): "trim", (2, 1): "black", (4, 1): "chrome"}  # carforge CELLS
LAMP_ROLES = ("headlights", "taillights", "reverselights", "leftblinkers", "rightblinkers")
GLASS_RE = re.compile(r"glass|window", re.I)
SAMPLE = 10.0              # mm between height samples of a slice
STEP = 20.0                # mm: smallest inward half-width step that is a shoulder
STEP_SPAN = 20.0           # mm above and below the step
MIN_WINDOW = 100.0         # mm: shorter glass runs are specks
OUTLINE_TOL = 8.0          # mm: hull corners closer than this to a straight edge are dropped
FRAME = 60.0               # mm: carforge's paint frame inside windscreen and backlight
END_ZONE = 0.12            # fraction of the length at each end searched for bumpers and grilles
END_INSET = 0.005          # fraction of the length the end slices stand inside the ends
FIT_FAIR_TOL = 15.0        # mm: the fitted spec's fair_tol
RAIL_DROP = 80.0           # mm below the top where carforge's rail starts (RAIL + CROWN)


def fail(msg):
    raise SystemExit("fit_mesh: " + msg)


def parse():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--id", required=True)
    ap.add_argument("--front", choices=["-y", "+y"], default="-y")
    ap.add_argument("--stations", type=int, default=STATIONS)
    return ap.parse_args(argv)


def load(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    ext = os.path.splitext(path)[1].lower()
    if ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=os.path.abspath(path))
    elif ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=os.path.abspath(path))
    else:
        fail(f"unsupported format {ext}")
    return ext == ".fbx"


def lamp_role(name):
    """Lamp role from an object name (underscores ignored). Pack names end with the role; other
    names say blinker/indicator/reverse/headlight/taillight/brake plus a side word."""
    low = name.lower().replace("_", "")
    for role in LAMP_ROLES:
        if low.endswith(role):
            return role
    if "blinker" in low or "indicator" in low:
        return "leftblinkers" if "left" in low else "rightblinkers"
    if "reverse" in low:
        return "reverselights"
    if "headlight" in low or low.startswith("head"):
        return "headlights"
    if "taillight" in low or "brake" in low:
        return "taillights"
    return None


def world_verts(o):
    return [o.matrix_world @ v.co for v in o.data.vertices]


def centre_and_extent(o):
    pts = world_verts(o)
    lo = Vector(tuple(min(p[i] for p in pts) for i in range(3)))
    hi = Vector(tuple(max(p[i] for p in pts) for i in range(3)))
    return (lo + hi) / 2, lo, hi


def body_triangles(objs, use_uv, to_spec):
    """(points, is_glass, outward normal, atlas cell or None) per triangle, in spec mm. Normals
    are oriented away from the body's centre, so the sign does not depend on the file's winding."""
    raw = []
    for o in objs:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bm.transform(o.matrix_world)
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        uvl = bm.loops.layers.uv.active
        for f in bm.faces:
            mat = o.material_slots[f.material_index].name if f.material_index < len(o.material_slots) else ""
            cell = None
            if use_uv and uvl is not None:
                u = sum(lp[uvl].uv.x for lp in f.loops) / 3
                v = sum(lp[uvl].uv.y for lp in f.loops) / 3
                cell = (min(int(u * ATLAS_COLS), ATLAS_COLS - 1), min(int(v * ATLAS_ROWS), ATLAS_ROWS - 1))
                glass = cell == GLASS_CELL
            else:
                glass = bool(GLASS_RE.search(mat))
            raw.append(([to_spec(v.co) for v in f.verts], glass, cell))
        bm.free()
    if not raw:
        fail("no body mesh")
    centre = sum((sum(p, Vector()) / 3 for p, _, _ in raw), Vector()) / len(raw)
    out = []
    for pts, glass, cell in raw:
        n = (pts[1] - pts[0]).cross(pts[2] - pts[0])
        if n.length < 1e-9:
            continue
        n.normalize()
        c = (pts[0] + pts[1] + pts[2]) / 3
        if n.dot(c - centre) < 0:
            n = -n
        out.append((pts, glass, n, cell))
    return out


def section(tris, c):
    """(x, z) segments where the body crosses the plane y = c."""
    segs = []
    for t in tris:
        pts = t[0]
        d = [p.y - c for p in pts]
        if max(d) <= 0 or min(d) >= 0:
            continue
        hits = []
        for i in range(3):
            j = (i + 1) % 3
            if (d[i] < 0) != (d[j] < 0):
                tt = d[i] / (d[i] - d[j])
                p = pts[i] + (pts[j] - pts[i]) * tt
                hits.append((p.x, p.z))
        if len(hits) == 2:
            segs.append((hits[0], hits[1]))
    return segs


def components(tris):
    """Groups of triangles (indices into tris) that share a vertex (positions rounded to 1 mm)."""
    parent = list(range(len(tris)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    owner = {}
    for i, t in enumerate(tris):
        for p in t[0]:
            key = (round(p.x), round(p.y), round(p.z))
            if key in owner:
                parent[find(i)] = find(owner[key])
            else:
                owner[key] = i
    groups = {}
    for i in range(len(tris)):
        groups.setdefault(find(i), []).append(i)
    return list(groups.values())


def hull(pts):
    """Convex hull of 2D points, counter-clockwise (monotone chain)."""
    pts = sorted(set(pts))
    if len(pts) < 3:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def drop_short_edges(poly, tol):
    """Remove hull vertices whose removal moves the outline by less than tol mm."""
    out = list(poly)
    changed = True
    while changed and len(out) > 4:
        changed = False
        for i in range(len(out)):
            a, b, c = out[i - 1], out[i], out[(i + 1) % len(out)]
            ab = math.hypot(c[0] - a[0], c[1] - a[1]) or 1.0
            d = abs((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / ab
            if d < tol:
                del out[i]
                changed = True
                break
    return out


def halfwidth(segs, z):
    """Largest |x| of the slice outline at height z, or None if no segment spans z."""
    best = None
    for (xa, za), (xb, zb) in segs:
        lo, hi = (za, zb) if za <= zb else (zb, za)
        if lo <= z <= hi:
            if hi - lo < 1e-9:
                x = max(abs(xa), abs(xb))
            else:
                x = abs(xa + (z - za) / (zb - za) * (xb - xa))
            if best is None or x > best:
                best = x
    return best


def profile(segs):
    zb = min(min(a[1], b[1]) for a, b in segs)
    zt = max(max(a[1], b[1]) for a, b in segs)
    zs, z = [], zb
    while z <= zt:
        zs.append(z)
        z += SAMPLE
    return {"segs": segs, "zb": zb, "zt": zt, "zs": zs, "hw": [halfwidth(segs, z) for z in zs]}


def step_shoulder(p):
    """z of the largest inward step of the half-width in the middle of the slice, or None."""
    zb, zt, zs, hw = p["zb"], p["zt"], p["zs"], p["hw"]
    h = zt - zb
    k = round(STEP_SPAN / SAMPLE)
    best_drop, best_z = 0.0, None
    for i in range(k, len(zs) - k):
        if not (zb + 0.25 * h <= zs[i] <= zt - 0.15 * h):
            continue
        a, b = hw[i - k], hw[i + k]
        if a is None or b is None:
            continue
        if a - b > best_drop:
            best_drop, best_z = a - b, zs[i]
    return best_z if best_drop >= STEP else None


def median_smooth(vals, half=2):
    out = []
    for i in range(len(vals)):
        out.append(statistics.median(vals[max(0, i - half):i + half + 1]))
    return out


def main():
    a = parse()
    use_uv = load(a.src)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    wheels = [o for o in meshes if "wheel" in o.name.lower()]
    if len(wheels) != 4:
        fail(f"need exactly four wheel objects, found {len(wheels)}")
    lamps = [(lamp_role(o.name), o) for o in meshes if o not in wheels and lamp_role(o.name)]
    lamp_objs = {o for _, o in lamps}
    body_objs = [o for o in meshes if o not in wheels and o not in lamp_objs]

    sign_y = 1.0 if a.front == "-y" else -1.0     # spec y runs rearward
    sign_x = sign_y                                 # car's left is +x only for a -y nose
    ground = min(centre_and_extent(o)[1].z for o in wheels)

    # wheels: the two with the smaller spec y are the front axle
    ordered = sorted(wheels, key=lambda o: sign_y * centre_and_extent(o)[0].y)
    front, rear = ordered[:2], ordered[2:]
    axle_y = sum(centre_and_extent(o)[0].y for o in front) / 2

    def to_spec(v):
        return Vector((sign_x * v.x * MM, sign_y * (v.y - axle_y) * MM, (v.z - ground) * MM))

    tris = body_triangles(body_objs, use_uv, to_spec)
    ymin = min(p.y for t in tris for p in t[0])
    ymax = max(p.y for t in tris for p in t[0])
    bottom = min(p.z for t in tris for p in t[0])
    top = max(p.z for t in tris for p in t[0])
    h, span = top - bottom, ymax - ymin
    width = 2 * max(abs(p.x) for t in tris for p in t[0])

    # Trim at the ends (neither paint nor glass): bumpers come out as boxes and leave the body's
    # slices (else the ends are sliced through a bumper and taper to a wedge); grille panels on
    # the end faces become plates.
    paint = Counter(t[3] for t in tris if t[3] and t[3][1] == 0).most_common(1)
    paint = paint[0][0] if paint else None
    zone = END_ZONE * span
    trim = [i for i, t in enumerate(tris) if t[3] and not t[1] and t[3] != paint
            and (max(p.y for p in t[0]) < ymin + zone or min(p.y for p in t[0]) > ymax - zone)]
    bumpers, plates, bumper_tris = [], [], set()
    for group in components([tris[i] for i in trim]):
        idx = [trim[g] for g in group]
        pts = [p for i in idx for p in tris[i][0]]
        xs, ys_, zs = [p.x for p in pts], [p.y for p in pts], [p.z for p in pts]
        cell = Counter(tris[i][3] for i in idx).most_common(1)[0][0]
        name = CELL_NAMES.get(cell, "steel")
        face = "front" if sum(ys_) / len(ys_) < (ymin + ymax) / 2 else "rear"
        ny = sum(tris[i][2].y for i in idx) / len(idx)
        reaches_end = min(ys_) < ymin + 0.03 * span if face == "front" else max(ys_) > ymax - 0.03 * span
        if (reaches_end and sum(zs) / len(zs) < bottom + 0.45 * h and max(xs) - min(xs) > 0.5 * width
                and max(zs) - min(zs) > 40 and max(ys_) - min(ys_) < END_ZONE * span):
            bumpers.append({"y": [round(min(ys_)), round(max(ys_))], "z": [round(min(zs)), round(max(zs))],
                            "half_width": round(max(abs(v) for v in xs)), "cell": name})
            bumper_tris.update(idx)
        elif abs(ny) > 0.6 and max(xs) - min(xs) > 80 and max(zs) - min(zs) > 30:
            plates.append({"face": face, "x": [round(min(xs)), round(max(xs))],
                           "z": [round(min(zs)), round(max(zs))], "cell": name, "single": True})
    tris = [t for i, t in enumerate(tris) if i not in bumper_tris]
    ymin = min(p.y for t in tris for p in t[0])
    ymax = max(p.y for t in tris for p in t[0])
    span = ymax - ymin

    # glass faces: side glass gives windows, belt and glass_top; roof-slope glass gives the screens
    side_z, screen_fw, screen_bk, side_left = [], [], [], []
    for t in tris:
        pts, glass, n = t[0], t[1], t[2]
        if not glass:
            continue
        ys = [p.y for p in pts]
        zs = [p.z for p in pts]
        if abs(n.x) > 0.5:
            side_z.append((min(zs), max(zs)))
            if n.x > 0:
                side_left.append(t)
        elif n.z > 0.2 and n.y < -0.2:
            screen_fw.append((min(ys), max(ys)))
        elif n.z > 0.2 and n.y > 0.2:
            screen_bk.append((min(ys), max(ys)))
    # each connected run of left side glass is one window: its outline is the glass's hull in
    # the side view, so slanted pillars and the quarter light's shape carry over. Runs that
    # overlap along the car (a vent pane beside the door glass) are one pocket.
    sets = sorted(([(p.y, p.z) for i in group for p in side_left[i][0]] for group in components(side_left)),
                  key=lambda ps: min(y for y, _ in ps))
    merged = []
    for ps in sets:
        y0, y1 = min(y for y, _ in ps), max(y for y, _ in ps)
        if merged:
            m0, m1 = min(y for y, _ in merged[-1]), max(y for y, _ in merged[-1])
            if min(m1, y1) - max(m0, y0) > 0.3 * min(m1 - m0, y1 - y0):
                merged[-1] += ps
                continue
        merged.append(list(ps))
    windows = []
    for ps in merged:
        outline = drop_short_edges(hull(ps), OUTLINE_TOL)
        y0, y1 = min(y for y, _ in outline), max(y for y, _ in outline)
        if y1 - y0 >= MIN_WINDOW:
            windows.append({"y": [round(y0), round(y1)], "outline": [[round(y), round(z)] for y, z in outline],
                            "round": 0})
    if side_z:
        belt = statistics.median(z0 for z0, _ in side_z)
        glass_top = statistics.median(z1 for _, z1 in side_z)
    else:
        belt, glass_top = bottom + 0.6 * h, bottom + 0.85 * h
        windows = []
    belt, glass_top = round(belt), round(glass_top)

    def envelope(iv):
        return [min(a for a, _ in iv) - FRAME, max(b for _, b in iv) + FRAME] if iv else None

    # slices, a hair inside the ends (a slice at the very end is empty); the end stations are
    # then put at the true ends, so the body keeps its length instead of tapering to a wedge
    ys = [ymin + END_INSET * span + (1 - 2 * END_INSET) * span * k / (a.stations - 1) for k in range(a.stations)]
    profs = []
    for y in ys:
        segs = section(tris, y)
        if not segs:
            fail(f"empty slice at y={y:.0f}")
        profs.append((y, profile(segs)))
    profs[0] = (ymin, profs[0][1])
    profs[-1] = (ymax, profs[-1][1])

    raw_sh = [step_shoulder(p) for _, p in profs]
    shoulders = median_smooth([z if z is not None else belt for z in raw_sh])

    side_top, side_bot, sh_pts, los, his = [], [], [], [], []
    for (y, p), sh in zip(profs, shoulders):
        sh = min(max(sh, p["zb"]), p["zt"])
        below = [v for z, v in zip(p["zs"], p["hw"]) if v is not None and z <= sh]
        above = [v for z, v in zip(p["zs"], p["hw"]) if v is not None and z >= sh]
        lo = max(below) if below else max(v for v in p["hw"] if v is not None)
        rail = p["zt"] - RAIL_DROP
        if rail > sh:  # a greenhouse slice: the widest point above the shoulder
            hi = max(above) if above else lo
        else:  # bonnet or boot: carforge puts their edge at the rail height, so measure it there
            hi = halfwidth(p["segs"], rail) or lo
        side_top.append([round(y), round(p["zt"])])
        side_bot.append([round(y), round(p["zb"])])
        sh_pts.append([round(y), round(sh)])
        los.append(lo)
        his.append(min(hi, lo))
    # one slice through a facet edge or a badge reads wide or narrow alone: a median of three
    # drops it and keeps real steps
    low_pts = [[yv, round(v)] for (yv, _), v in zip(side_top, median_smooth(los, 1))]
    high_pts = [[yv, round(min(v, lo))] for (yv, _), v, lo in zip(side_top, median_smooth(his, 1), median_smooth(los, 1))]

    # tumblehome: greenhouse half-width vs belt half-width, over the slices that cross a window
    tumble = [[belt, 1.0]]
    if windows and glass_top > belt:
        fg, ft = [], []
        for y, p in profs:
            if not any(w["y"][0] <= y <= w["y"][1] for w in windows):
                continue
            hb = halfwidth(p["segs"], belt)
            if not hb:
                continue
            g = halfwidth(p["segs"], glass_top)
            t = halfwidth(p["segs"], p["zt"] - SAMPLE)
            if g:
                fg.append(min(1.0, g / hb))
            if t:
                ft.append(min(1.0, t / hb))
        if fg:
            tumble.append([glass_top, round(min(1.0, max(0.5, statistics.mean(fg))), 3)])
        if ft and round(top) > glass_top:
            tumble.append([round(top), round(min(1.0, max(0.5, statistics.mean(ft))), 3)])

    # wheels
    def wc(o):
        return centre_and_extent(o)
    fc = [wc(o) for o in front]
    rc = [wc(o) for o in rear]
    wheel_r = statistics.mean((hi.z - lo.z) / 2 for _, lo, hi in fc + rc) * MM
    wheel_w = statistics.mean(hi.x - lo.x for _, lo, hi in fc + rc) * MM
    track_f = statistics.mean(abs(c.x) for c, _, _ in fc) * 2 * MM
    track_r = statistics.mean(abs(c.x) for c, _, _ in rc) * 2 * MM
    wheelbase = statistics.mean(sign_y * (c.y - axle_y) for c, _, _ in rc) * MM

    spec = {
        "id": a.id,
        "source": os.path.basename(a.src),
        "fair_tol": FIT_FAIR_TOL,
        "wheels": {"radius": round(wheel_r), "width": round(wheel_w), "track_front": round(track_f),
                   "track_rear": round(track_r), "wheelbase": round(wheelbase)},
        "side": {"top": side_top, "bottom": side_bot, "shoulder": sh_pts},
        "plan": {"low": low_pts, "high": high_pts},
        "tumblehome": tumble,
        "belt": belt,
        "glass_top": glass_top,
        "windows": windows,
    }
    ws, bk = envelope(screen_fw), envelope(screen_bk)
    if ws:
        spec["windscreen"] = [round(ws[0]), round(ws[1])]
    if bk:
        spec["backlight"] = [round(bk[0]), round(bk[1])]
    if bumpers:
        spec["bumpers"] = bumpers
    # a plate must stand on the generated end face: keep those inside its outline
    end_hw = {"front": low_pts[0][1], "rear": low_pts[-1][1]}
    end_z = {"front": (side_bot[0][1], side_top[0][1]), "rear": (side_bot[-1][1], side_top[-1][1])}
    plates = [pl for pl in plates if max(abs(v) for v in pl["x"]) < 0.9 * end_hw[pl["face"]]
              and end_z[pl["face"]][0] < pl["z"][0] and pl["z"][1] < end_z[pl["face"]][1]]
    if plates:
        spec["plates"] = plates

    lamp_out = []
    mid = (ymin + ymax) / 2
    for role, o in lamps:
        pts = [to_spec(v) for v in world_verts(o)]
        xs = [p.x for p in pts]
        zs = [p.z for p in pts]
        ys_ = [p.y for p in pts]
        face = "front" if sum(ys_) / len(ys_) < mid else "rear"
        lamp_out.append({"role": role, "face": face, "single": True,
                         "x": [round(min(xs)), round(max(xs))], "z": [round(min(zs)), round(max(zs))]})
    if lamp_out:
        spec["lamps"] = lamp_out

    fit = {"length": round(ymax - ymin), "width": round(2 * max(v for _, v in high_pts + low_pts)),
           "height": round(top - bottom), "wheelbase": round(wheelbase),
           "track_front": round(track_f), "track_rear": round(track_r), "belt": belt, "glass_top": glass_top,
           "windows": len(windows), "bumpers": len(bumpers), "plates": len(plates)}
    print("FIT " + json.dumps(fit))
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w") as fh:
        json.dump(spec, fh, indent=1)
    print("WROTE " + a.out)


if __name__ == "__main__":
    main()
