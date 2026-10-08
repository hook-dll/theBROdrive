"""Generate a low-poly Soviet-pack-style car FBX from a three-view spec (run inside Blender).

    blender --background --factory-startup --python tools/carforge/carforge.py -- SPEC.json OUT.fbx [--summary S.json]

The SHAPE comes from the spec: the side silhouette (top and bottom edges), the plan
(half-width below and above the shoulder) and the front view's tumblehome, all traced
from a blueprint, photos or a reference mesh. The CONSTRUCTION is the pack's
(tools/carforge/DESIGN.md): every station is the same 13-point ring per side, so the
body is a quad grid of columns (stations) and rows (sill, lower side, shoulder, belt,
glass, roof rail, roof), mirrored across x = 0 and closed by the nose and tail caps.
Rows that a station does not reach (the bonnet is below the glass rows) collapse onto
its top and are welded away. Windows are faces of the glass rows, the windscreen and
back light faces of the roof rows on the slopes, both in the atlas glass cell. Wheel
arches are cut with a boolean; their wells are dark. Lamps, grille and window plates
are probed onto the body's faces, never floating.

Frame: +X car left, -Y front, Z up, metres. The spec is in mm: y rearward from the
front axle, z up from the ground, x to the car's left. Object names follow the pack:
<id>.body, <id>.body.<lamp role>, <id>.wheel_fl|fr|bl|br. Schema: README.md.
"""

import argparse
import bisect
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PACK_WHEEL = os.path.join(REPO, "public", "models", "soviet", "vz01.fbx")

MM = 0.001
ATLAS_COLS = 9
ATLAS_ROWS = 2

# Atlas cells (col, row-from-bottom) of public/models/soviet/albedo.png. Row 0 (bottom of
# the image) holds the paint colours, row 1 the fixed finishes. Glass (3,1) is the game's
# glassUvCell (src/vehicle/carmodels.ts).
CELLS = {
    "paint": (0, 0), "steel": (0, 1), "trim": (1, 1), "black": (2, 1), "glass": (3, 1),
    "chrome": (4, 1), "lamp_head": (8, 1), "lamp_tail": (5, 1), "blinker": (7, 1), "reverse": (8, 1),
}
LAMP_CELL = {
    "headlights": "lamp_head", "taillights": "lamp_tail", "reverselights": "reverse",
    "leftblinkers": "blinker", "rightblinkers": "blinker",
}
WHEEL_NAMES = ("wheel_fl", "wheel_fr", "wheel_bl", "wheel_br")

# Ring rows, right side, bottom centre to roof centre (see station_ring).
R_BOTTOM, R_SILL, R_SILL_UP, R_LOWER, R_SHOULDER_LO, R_SHOULDER, R_UPPER, R_BELT_LO, R_BELT, \
    R_GLASS_TOP, R_RAIL, R_ROOF_EDGE, R_CENTRE = range(13)
RING_ROWS = 13

SILL_CHAMFER = 45.0      # mm the underbody edge is bevelled
SHOULDER_ROLL = 35.0     # mm the shoulder edge is rolled
BELT_CREASE = 15.0       # mm the side steps in at the beltline crease
RAIL = 55.0              # mm roof-rail chamfer
CROWN = 25.0             # mm the roof/bonnet centre stands above its edges
MAX_STATION_STEP = 260.0  # mm between stations
MIN_STATION_GAP = 25.0   # mm: closer breakpoints are merged
FRAME = 60.0             # mm paint frame around windscreen and back light
WELD = 0.002             # m: vertices this close are welded

PROUD = 8.0              # mm lamps and plates stand proud of their face
LAMP_MAX_GAP = 0.030     # m: every lamp vertex must lie within this of the body surface


def fail(msg):
    raise SystemExit("carforge: " + msg)


# ---------------------------------------------------------------- spec

def validate(spec):
    for key in ("id", "wheels", "side", "plan", "belt", "glass_top"):
        if key not in spec:
            fail(f"spec missing '{key}'")
    for key in ("top", "bottom", "shoulder"):
        if len(spec["side"].get(key, [])) < 2:
            fail(f"side.{key} needs at least two [y, z] points")
    for key in ("low", "high"):
        if len(spec["plan"].get(key, [])) < 2:
            fail(f"plan.{key} needs at least two [y, half_width] points")
    w = spec["wheels"]
    for key in ("radius", "width", "track_front", "track_rear", "wheelbase"):
        if key not in w:
            fail(f"wheels missing '{key}'")
    for lamp in spec.get("lamps", []):
        if lamp["role"] not in LAMP_CELL:
            fail(f"unknown lamp role {lamp['role']}")
        if lamp.get("face") not in ("front", "rear"):
            fail(f"{lamp['role']} lamp needs face front|rear")
    return spec


class Curve:
    """Piecewise-linear y -> value, clamped at the ends."""

    def __init__(self, pts):
        pts = sorted((float(a), float(b)) for a, b in pts)
        self.ys = [p[0] for p in pts]
        self.vs = [p[1] for p in pts]

    def __call__(self, y):
        ys, vs = self.ys, self.vs
        if y <= ys[0]:
            return vs[0]
        if y >= ys[-1]:
            return vs[-1]
        i = bisect.bisect_right(ys, y)
        t = (y - ys[i - 1]) / (ys[i] - ys[i - 1])
        return vs[i - 1] + t * (vs[i] - vs[i - 1])


def uv_of_cell(cell):
    c, r = cell
    return ((c + 0.5) / ATLAS_COLS, (r + 0.5) / ATLAS_ROWS)


def add_face(bm, uvl, verts, cell, hint=None):
    """Face in `cell`; with `hint`, the normal is flipped to agree with it."""
    try:
        f = bm.faces.new(verts)
    except ValueError:
        return None
    if hint is not None and f.normal.dot(hint) < 0:
        f.normal_flip()
    uv = uv_of_cell(cell)
    for loop in f.loops:
        loop[uvl].uv = uv
    return f


def add_box(bm, uvl, lo, hi, cell, chamfer=0.0):
    """Axis box in mm, its x-faces octagonal when `chamfer` > 0 (bumpers wrap their ends)."""
    x0, y0, z0 = lo
    x1, y1, z1 = hi
    c = max(0.0, min(chamfer, (y1 - y0) / 2 - 1, (z1 - z0) / 2 - 1))
    if c > 0:
        outline = [(y0, z0 + c), (y0, z1 - c), (y0 + c, z1), (y1 - c, z1),
                   (y1, z1 - c), (y1, z0 + c), (y1 - c, z0), (y0 + c, z0)]
    else:
        outline = [(y0, z0), (y0, z1), (y1, z1), (y1, z0)]
    centre = Vector(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)) * MM
    ends = {x: [bm.verts.new(Vector((x, y, z)) * MM) for y, z in outline] for x in (x0, x1)}
    add_face(bm, uvl, ends[x0], CELLS[cell], Vector((-1.0, 0, 0)))
    add_face(bm, uvl, ends[x1], CELLS[cell], Vector((1.0, 0, 0)))
    n = len(outline)
    for i in range(n):
        j = (i + 1) % n
        vs = [ends[x0][i], ends[x0][j], ends[x1][j], ends[x1][i]]
        mid = sum((v.co for v in vs), Vector()) / 4
        add_face(bm, uvl, vs, CELLS[cell], mid - centre)


def new_bm():
    bm = bmesh.new()
    return bm, bm.loops.layers.uv.new("UVMap")


def finish(bm, name):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    me.update()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


# ---------------------------------------------------------------- body grammar

class Shape:
    """The spec's three views as functions of y (and z for the tumblehome)."""

    def __init__(self, spec):
        side, plan = spec["side"], spec["plan"]
        self.top = Curve(side["top"])
        self.bottom = Curve(side["bottom"])
        self.shoulder = Curve(side["shoulder"])
        self.low = Curve(plan["low"])
        self.high = Curve(plan["high"])
        # Front view: half-width factor of the greenhouse against its width at the belt.
        self.tumble = Curve(spec.get("tumblehome", [[0, 1.0], [1, 1.0]]))
        self.belt = float(spec["belt"])
        self.glass_top = float(spec["glass_top"])
        self.front = max(self.top.ys[0], self.bottom.ys[0])
        self.rear = min(self.top.ys[-1], self.bottom.ys[-1])


def station_ring(s, y):
    """The 13 right-side ring points (x, z) of the station at y, bottom centre to roof centre.
    Every station has all 13; a row above the station's top is pressed onto it."""
    zt, zb = s.top(y), s.bottom(y)
    zs = min(s.shoulder(y), zt)
    lo, hi = s.low(y), min(s.high(y), s.low(y))

    def gh(z):  # greenhouse half-width at height z
        return hi * s.tumble(z)

    belt = min(max(s.belt, zs), zt)
    gtop = min(s.glass_top, zt)
    roof_x = gh(zt)
    pts = [
        (0.0, zb),
        (lo - SILL_CHAMFER, zb),
        (lo, zb + SILL_CHAMFER),
        (lo, (zb + zs) / 2),
        (lo, zs - SHOULDER_ROLL),
        (max(hi, lo - SHOULDER_ROLL), zs),
        (hi, zs),
        (gh(belt) + BELT_CREASE * (belt > zs), belt - BELT_CREASE * (belt > zs)),
        (gh(belt), belt),
        (gh(gtop), gtop),
        (roof_x, zt - RAIL - CROWN),
        (roof_x - RAIL, zt - CROWN),
        (0.0, zt),
    ]
    out = []
    for x, z in pts:  # press everything the station does not reach onto its top
        out.append((max(0.0, min(x, lo)), min(max(z, zb), zt)))
    return out


def stations(spec, s):
    """Station ys: every breakpoint of every view, window edges, frame offsets, then
    gaps filled to MAX_STATION_STEP and near-duplicates merged."""
    ys = set()
    for c in (s.top, s.bottom, s.shoulder, s.low, s.high):
        ys.update(c.ys)
    for w in spec.get("windows", []):
        ys.update(w["y"])
    for key in ("windscreen", "backlight"):
        if key in spec:
            a, b = spec[key]
            ys.update((a, b, a + FRAME, b - FRAME))
    ys = sorted(y for y in ys if s.front <= y <= s.rear)
    if ys[0] > s.front:
        ys.insert(0, s.front)
    if ys[-1] < s.rear:
        ys.append(s.rear)
    filled = [ys[0]]
    for y in ys[1:]:
        gap = y - filled[-1]
        n = int(gap // MAX_STATION_STEP)
        for k in range(1, n + 1):
            filled.append(filled[-1] + gap / (n + 1) if k == 1 else filled[-1] + gap / (n + 1))
        filled.append(y)
    merged = [filled[0]]
    for y in filled[1:]:
        if y - merged[-1] >= MIN_STATION_GAP:
            merged.append(y)
        elif y == filled[-1]:
            merged[-1] = y
    return merged


def face_cell(spec, s, row_a, row_b, y0, y1):
    """Cell of the quad between ring rows row_a..row_b over stations y0..y1."""
    ym = (y0 + y1) / 2
    lo_row = min(row_a, row_b)
    if lo_row == R_BOTTOM:
        return "black"
    if lo_row == R_BELT:  # the glass row, belt to glass top
        for w in spec.get("windows", []):
            if w["y"][0] <= ym <= w["y"][1]:
                return "glass"
    if lo_row >= R_RAIL:  # roof rows: windscreen and back light on the slopes
        for key in ("windscreen", "backlight"):
            if key in spec:
                a, b = spec[key]
                if a + FRAME <= ym <= b - FRAME:
                    return "glass"
    return "paint"


def build_shell(spec, s, bm, uvl):
    ys = stations(spec, s)
    rings = []
    for y in ys:
        right = station_ring(s, y)
        ring = [bm.verts.new(Vector((x, y, z)) * MM) for x, z in right]
        # left side: mirror of rows 1..11 (the centre points are shared)
        left = [bm.verts.new(Vector((-x, y, z)) * MM) for x, z in right[1:-1]]
        rings.append((ring, left))
    centre = Vector((0.0, (s.front + s.rear) / 2, 900.0)) * MM
    for i in range(len(ys) - 1):
        (ra, la), (rb, lb) = rings[i], rings[i + 1]
        for k in range(RING_ROWS - 1):
            cell = CELLS[face_cell(spec, s, k, k + 1, ys[i], ys[i + 1])]
            mid_r = (ra[k].co + ra[k + 1].co + rb[k].co + rb[k + 1].co) / 4
            add_face(bm, uvl, [ra[k], ra[k + 1], rb[k + 1], rb[k]], cell,
                     Vector((mid_r.x, 0, mid_r.z - centre.z)) if mid_r.x > 1e-4 else Vector((0, 0, mid_r.z - centre.z)))
            # mirrored quad: row k on the left is la[k-1] (row 0 and 12 are shared centre points)
            def lv(ring_r, ring_l, kk):
                return ring_r[kk] if kk in (0, RING_ROWS - 1) else ring_l[kk - 1]
            vs = [lv(ra, la, k), lv(rb, lb, k), lv(rb, lb, k + 1), lv(ra, la, k + 1)]
            mid_l = sum((v.co for v in vs), Vector()) / 4
            add_face(bm, uvl, vs, cell,
                     Vector((mid_l.x, 0, mid_l.z - centre.z)) if mid_l.x < -1e-4 else Vector((0, 0, mid_l.z - centre.z)))
    # nose and tail caps
    for idx, sign in ((0, -1.0), (len(ys) - 1, 1.0)):
        ring, left = rings[idx]
        loop = ring + list(reversed(left))
        add_face(bm, uvl, loop, CELLS["paint"], Vector((0, sign, 0)))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=WELD)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=WELD)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return ys


# ---------------------------------------------------------------- arches (boolean)

def arch_cutter(spec, s, hub_y, radius, name):
    """Cylinder along x through both sides' outer bands: the arch opening and its well.
    The well's inner wall stands `well` mm inside the body side."""
    w = spec["wheels"]
    well = float(w.get("well", 260.0))
    hub_z = float(w["radius"])
    lo = s.low(hub_y)
    bm, uvl = new_bm()
    seg = 16
    for sign in (1.0, -1.0):
        x_in, x_out = sign * (lo - well), sign * (lo + 300.0)
        ring_in, ring_out = [], []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            y = hub_y + radius * math.cos(a)
            z = hub_z + radius * math.sin(a)
            ring_in.append(bm.verts.new(Vector((x_in, y, z)) * MM))
            ring_out.append(bm.verts.new(Vector((x_out, y, z)) * MM))
        add_face(bm, uvl, ring_in, CELLS["black"])
        add_face(bm, uvl, ring_out, CELLS["black"])
        for i in range(seg):
            j = (i + 1) % seg
            add_face(bm, uvl, [ring_in[i], ring_in[j], ring_out[j], ring_out[i]], CELLS["black"])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return finish(bm, name)


def cut_arches(spec, s, body):
    w = spec["wheels"]
    r_front = float(w.get("arch_front", w["radius"] * 1.2))
    r_rear = float(w.get("arch_rear", w["radius"] * 1.2))
    for hub_y, r, tag in ((0.0, r_front, "f"), (float(w["wheelbase"]), r_rear, "r")):
        cutter = arch_cutter(spec, s, hub_y, r, f"cutter_{tag}")
        mod = body.modifiers.new(f"arch_{tag}", "BOOLEAN")
        mod.operation = "DIFFERENCE"
        mod.solver = "EXACT"
        mod.object = cutter
        bpy.context.view_layer.objects.active = body
        bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.data.objects.remove(cutter, do_unlink=True)


# ---------------------------------------------------------------- probed details

def probe(bvh, x, z, face):
    """Body surface y at (x, z), hit from the front (face 'front') or the rear."""
    s = -1.0 if face == "front" else 1.0
    loc, _, _, _ = bvh.ray_cast(Vector((x * MM, s * 9.0, z * MM)), Vector((0, -s, 0)))
    return None if loc is None else loc.y / MM


def outline_pts(item):
    x0, x1 = min(item["x"]), max(item["x"])
    z0, z1 = min(item["z"]), max(item["z"])
    if item.get("round"):
        cx, cz, rx, rz = (x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2
        n = int(item.get("segments", 10))
        return [(cx + rx * math.cos(2 * math.pi * i / n), cz + rz * math.sin(2 * math.pi * i / n)) for i in range(n)]
    return [(x0, z0), (x1, z0), (x1, z1), (x0, z1)]


def add_plate(bm, uvl, bvh, item, cell):
    """A flat block on the nose or tail face: its outer face PROUD of the body at every
    corner, its back 5 mm inside, so it is attached wherever the face curves."""
    face = item["face"]
    s = -1.0 if face == "front" else 1.0
    outer, inner = [], []
    for x, z in outline_pts(item):
        y = probe(bvh, x, z, face)
        if y is None:
            fail(f"{item.get('role', 'plate')} at x={x:.0f} z={z:.0f} has no {face} face behind it")
        outer.append(Vector((x, y + s * PROUD, z)) * MM)
        inner.append(Vector((x, y - s * 5.0, z)) * MM)
    n = len(outer)
    c = [bm.verts.new(p) for p in outer] + [bm.verts.new(p) for p in inner]
    centre = sum((v.co for v in c), Vector()) / (2 * n)
    faces = [list(range(n)), list(range(n, 2 * n))[::-1]]
    faces += [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    for q in faces:
        vs = [c[i] for i in q]
        mid = sum((v.co for v in vs), Vector()) / len(vs)
        add_face(bm, uvl, vs, CELLS[cell], mid - centre)


def mirrored(item):
    """The item and, unless `single`, its mirror across x = 0."""
    yield item
    if not item.get("single"):
        m = dict(item)
        m["x"] = [-v for v in item["x"]]
        yield m


def body_bvh(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bvh = BVHTree.FromBMesh(bm)
    bm.free()
    return bvh


def add_details(spec, body):
    """Bumpers, mirrors, grille and window plates, joined into the body mesh."""
    bvh = body_bvh(body)
    bm = bmesh.new()
    bm.from_mesh(body.data)
    uvl = bm.loops.layers.uv["UVMap"]
    for b in spec.get("bumpers", []):
        add_box(bm, uvl, (-b["half_width"], b["y"][0], b["z"][0]), (b["half_width"], b["y"][1], b["z"][1]),
                b.get("cell", "steel"), b.get("chamfer", 30.0))
    for m in spec.get("mirrors", []):
        for it in mirrored(m):
            x0, x1 = sorted(it["x"])
            add_box(bm, uvl, (x0, it["y"][0], it["z"][0]), (x1, it["y"][1], it["z"][1]), it.get("cell", "black"))
    for p in spec.get("plates", []):
        for it in mirrored(p):
            add_plate(bm, uvl, bvh, it, it.get("cell", "black"))
    bm.to_mesh(body.data)
    bm.free()
    body.data.update()


def add_spare(spec, body, tmpl, pts, pack_w, pack_r):
    """A spare wheel on the tail, axis along the car, joined into the body mesh."""
    sp = spec.get("spare")
    if not sp:
        return
    w = spec["wheels"]
    sx = w["width"] * MM / pack_w
    sr = w["radius"] * MM / pack_r
    rot = Matrix.Rotation(math.pi / 2, 3, "Z")
    hub = Vector((0.0, sp["y"], sp["z"])) * MM
    bm = bmesh.new()
    bm.from_mesh(body.data)
    uvl = bm.loops.layers.uv["UVMap"]
    tm = bmesh.new()
    tm.from_mesh(tmpl)
    tuvl = tm.loops.layers.uv.active
    vmap = {}
    for v, p in zip(tm.verts, pts):
        q = rot @ Vector((p.x * sx, p.y * sr, p.z * sr))
        vmap[v.index] = bm.verts.new(hub + q)
    for f in tm.faces:
        nf = bm.faces.new([vmap[v.index] for v in f.verts])
        for l_new, l_old in zip(nf.loops, f.loops):
            l_new[uvl].uv = l_old[tuvl].uv
    tm.free()
    bm.to_mesh(body.data)
    bm.free()
    body.data.update()


def build_lamps(spec, cid, body, objs):
    bvh = body_bvh(body)
    per_role = {}
    for lamp in spec.get("lamps", []):
        for it in mirrored(lamp):
            role = it["role"]
            if role in ("leftblinkers", "rightblinkers") and not lamp.get("single"):
                role = "leftblinkers" if min(it["x"]) > 0 else "rightblinkers"
            if role not in per_role:
                per_role[role] = new_bm()
            bm, uvl = per_role[role]
            add_plate(bm, uvl, bvh, it, it.get("cell", LAMP_CELL[role]))
    for role, (bm, _) in per_role.items():
        for v in bm.verts:
            hit = bvh.find_nearest(v.co)
            if hit[0] is None or hit[3] > LAMP_MAX_GAP:
                fail(f"{cid} {role} lamp vertex {tuple(round(c, 3) for c in v.co)} floats off the body")
        objs.append(finish(bm, f"{cid}.body.{role}"))


def build_body(spec, cid):
    s = Shape(spec)
    bm, uvl = new_bm()
    build_shell(spec, s, bm, uvl)
    body = finish(bm, f"{cid}.body")
    cut_arches(spec, s, body)
    add_details(spec, body)
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    bm.to_mesh(body.data)
    bm.free()
    return body


# ---------------------------------------------------------------- wheels (copied from the pack)

def load_pack_wheel(path):
    """Mesh data of the pack wheel `*.wheel_fl`, rotated into object space (origin at hub),
    centred, plus its width and radius. The imported objects are removed again."""
    before = {o.name for o in bpy.data.objects}
    bpy.ops.import_scene.fbx(filepath=path)
    new = [o for o in bpy.data.objects if o.name not in before]
    src = next((o for o in new if o.name.endswith("wheel_fl")), None)
    if src is None:
        fail(f"no wheel_fl in {path}")
    rot = src.matrix_world.to_3x3()
    pts = [rot @ v.co for v in src.data.vertices]
    lo = Vector((min(p[i] for p in pts) for i in range(3)))
    hi = Vector((max(p[i] for p in pts) for i in range(3)))
    centre = (lo + hi) / 2
    pts = [p - centre for p in pts]
    width = hi.x - lo.x
    radius = max(math.hypot(p.y, p.z) for p in pts)
    src_mesh = src.data
    tmpl = src_mesh.copy()
    tmpl.materials.clear()
    for o in new:
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.meshes.remove(src_mesh)
    return tmpl, pts, width, radius


def build_wheel(name, hub, tmpl, pts, pack_w, pack_r, w):
    me = tmpl.copy()
    sx = w["width"] * MM / pack_w
    sr = w["radius"] * MM / pack_r
    for v, p in zip(me.vertices, pts):
        v.co = Vector((p.x * sx, p.y * sr, p.z * sr))
    me.update()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = Vector(hub)
    return obj


def build_wheels(spec, cid, objs, tmpl, pts, pack_w, pack_r):
    w = spec["wheels"]
    tf, tr = w["track_front"] * MM / 2, w["track_rear"] * MM / 2
    hub_z = w["radius"] * MM
    wb = w["wheelbase"] * MM
    layout = {"wheel_fl": (tf, 0.0), "wheel_fr": (-tf, 0.0), "wheel_bl": (tr, wb), "wheel_br": (-tr, wb)}
    for wn in WHEEL_NAMES:
        x, y = layout[wn]
        objs.append(build_wheel(f"{cid}.{wn}", (x, y, hub_z), tmpl, pts, pack_w, pack_r, w))


# ---------------------------------------------------------------- scene

def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)


def build_car(spec, wheel_fbx):
    cid = spec["id"]
    tmpl, pts, pack_w, pack_r = load_pack_wheel(wheel_fbx)
    body = build_body(spec, cid)
    add_spare(spec, body, tmpl, pts, pack_w, pack_r)
    objs = [body]
    build_lamps(spec, cid, body, objs)
    build_wheels(spec, cid, objs, tmpl, pts, pack_w, pack_r)
    bpy.data.meshes.remove(tmpl)
    return objs


def export(objs, path):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    bpy.ops.export_scene.fbx(
        filepath=path, use_selection=True, object_types={"MESH"},
        global_scale=1.0, apply_unit_scale=True, apply_scale_options="FBX_SCALE_NONE",
        axis_forward="-Z", axis_up="Y", bake_space_transform=True,  # node rotation 0, as the pack
        add_leaf_bones=False, bake_anim=False, path_mode="AUTO", use_mesh_modifiers=True,
    )


def summarise(objs):
    return {o.name: {"tris": tri_count(o), "dims_m": [round(d, 4) for d in o.dimensions],
                     "origin_m": [round(c, 4) for c in o.location]} for o in objs}


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("spec")
    ap.add_argument("out")
    ap.add_argument("--wheel-fbx", default=PACK_WHEEL)
    ap.add_argument("--summary")
    args = ap.parse_args(argv)
    with open(args.spec) as fh:
        spec = validate(json.load(fh))
    clear_scene()
    objs = build_car(spec, args.wheel_fbx)
    export(objs, args.out)
    summary = summarise(objs)
    if args.summary:
        with open(args.summary, "w") as fh:
            json.dump(summary, fh, indent=2)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
