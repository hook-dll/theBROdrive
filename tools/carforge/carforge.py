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
LIP_CLEAR = 100.0        # mm the rail must stand above the belt for the belt lip to show
LIP_TAPER = 40.0         # mm along the car over which the belt lip ends
RAIL = 55.0              # mm roof-rail chamfer
CROWN = 25.0             # mm the roof/bonnet centre stands above its edges
MIN_STATION_GAP = 25.0   # mm: closer breakpoints are merged
FRAME = 60.0             # mm paint frame around windscreen and back light
WELD = 0.002             # m: vertices this close are welded
FAIR_TOL = 12.0          # mm: trace wiggles within this of a straight run are dropped (spec "fair_tol")
FOLD_SPLIT_DEG = 0.25    # quads folded more than this are split along their convex diagonal

PROUD = 8.0              # mm lamps and plates stand proud of their face
SLIVER_MM = 12.0         # mm: the narrowest face a generated box or chamfer may leave
ARCH_SEGMENTS = 12       # segments of a default (semicircle) arch outline
ARCH_LIP = 45.0          # mm the arch lip reaches out over the side from the opening
ARCH_FLARE = 25.0        # mm the arch lip stands proud of the side at the opening
ARCH_SNAP = 5.0          # mm: vertices the arch and window cuts leave this close are welded
ARCH_FAIR_TOL = 6.0      # mm: tolerance of `simplify` on a traced outline (keeps rounded corners)
BEZEL_DEPTH = 25.0       # mm a lamp bezel pocket goes into its face (spec lamps[].bezel_depth)
GLASS_INSET = 12.0       # mm side glass sits inside the greenhouse side
WINDOW_FRAME = 20.0      # mm paint a default (y-only) window leaves over the belt and under the glass top
WINDOW_ROUND = 40.0      # mm default window corner radius (spec windows[].round)
GLASS_CLEAR = 5.0        # mm: a traced window stays this far inside the belt and the glass top
ROUND_SEGMENTS = 3       # segments of a rounded corner
WINDOW_MIN_HEIGHT = 80.0  # mm: a default window ends where less glass than this is left
SEAM_WIDTH = 12.0        # mm width of a door/panel seam line
SEAM_PROUD = 4.0         # mm a seam line stands off the side
SEAM_TOL = 1.5           # mm a seam may stray from the side between its probes
SEAM_MIN = 8.0           # mm: the shortest piece a seam is split into
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


def simplify(pts, tol):
    """Douglas-Peucker: drop points within `tol` mm (perpendicular) of the chord of their
    neighbours. A traced outline carries pixel noise; every kept breakpoint becomes a station
    edge, so a 2 px zig-zag in the trace would shade as a ripple across the whole body."""
    if len(pts) < 3:
        return pts
    (ay, av), (by, bv) = pts[0], pts[-1]
    dy, dv = by - ay, bv - av
    span = math.hypot(dy, dv)
    worst, at = -1.0, 0
    for i in range(1, len(pts) - 1):
        y, v = pts[i]
        d = abs(dy * (v - av) - dv * (y - ay)) / span if span > 0 else math.hypot(y - ay, v - av)
        if d > worst:
            worst, at = d, i
    if worst <= tol:
        return [pts[0], pts[-1]]
    return simplify(pts[:at + 1], tol)[:-1] + simplify(pts[at:], tol)


class Curve:
    """Piecewise-linear y -> value, clamped at the ends; with `tol`, faired by `simplify`."""

    def __init__(self, pts, tol=0.0):
        pts = sorted((float(a), float(b)) for a, b in pts)
        if tol > 0:
            pts = simplify(pts, tol)
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
    f.normal_update()  # a new face's normal is not computed until asked
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
    # keep every face of the octagon at least SLIVER_MM wide: a thinner one shades as a streak
    c = max(0.0, min(chamfer, (y1 - y0 - SLIVER_MM) / 2, (z1 - z0 - SLIVER_MM) / 2))
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
        tol = float(spec.get("fair_tol", FAIR_TOL))
        self.top = Curve(side["top"], tol)
        self.bottom = Curve(side["bottom"], tol)
        self.shoulder = Curve(side["shoulder"], tol)
        self.low = Curve(plan["low"], tol)
        self.high = Curve(plan["high"], tol)
        # Front view: half-width factor of the greenhouse against its width at the belt.
        self.tumble = Curve(spec.get("tumblehome", [[0, 1.0], [1, 1.0]]))
        self.belt = float(spec["belt"])
        self.glass_top = float(spec["glass_top"])
        self.front = max(self.top.ys[0], self.bottom.ys[0])
        self.rear = min(self.top.ys[-1], self.bottom.ys[-1])
        # The belt lip runs where a greenhouse stands: the rail LIP_CLEAR or more above the belt.
        cuts = self.crossings(lambda y: self.rail_z(y) - self.belt - LIP_CLEAR)
        edges = [self.front] + cuts + [self.rear]
        self.lip_spans = [(a, b) for a, b in zip(edges, edges[1:])
                          if self.rail_z((a + b) / 2) - self.belt > LIP_CLEAR]

    def rail_z(self, y):
        """Height where the side ends and the roof (or bonnet) rail begins."""
        return max(self.bottom(y) + SILL_CHAMFER, self.top(y) - RAIL - CROWN)

    def crossings(self, fn, step=5.0):
        """ys where fn changes sign, scanned every `step` mm and interpolated."""
        out = []
        y, a = self.front, fn(self.front)
        while y < self.rear:
            y1 = min(y + step, self.rear)
            b = fn(y1)
            if (a < 0) != (b < 0):
                out.append(y + (y1 - y) * a / (a - b))
            y, a = y1, b
        return out

    def lip(self, y):
        """Belt lip depth at y: full inside a greenhouse span, tapered over LIP_TAPER mm at a
        span end inside the body (a short taper reads as the lip's end, a long one as a wave)."""
        for a, b in self.lip_spans:
            if a <= y <= b:
                da = math.inf if a <= self.front else y - a
                db = math.inf if b >= self.rear else b - y
                return BELT_CREASE * min(1.0, min(da, db) / LIP_TAPER)
        return 0.0

    def lip_stations(self):
        out = []
        for a, b in self.lip_spans:
            if a > self.front:
                out += [a, a + LIP_TAPER]
            if b < self.rear:
                out += [b - LIP_TAPER, b]
        return out


def station_ring(s, y):
    """The 13 right-side ring points (x, z) of the station at y, bottom centre to roof centre.

    Every station has all 13 and the ring never doubles back: going up from the sill, z
    never falls and x never grows (the belt lip excepted), so neighbouring stations' quads
    cannot fold into each other. The side ends at the rail (RAIL + CROWN below the top). A side
    row the station does not reach (the bonnet is below the belt and glass) is pressed down to
    the rail height, keeping its x: pressed rows lie on one flat line, and a row emerging from
    under the rail moves continuously, so the faces around it neither jump nor fold."""
    zt, zb = s.top(y), s.bottom(y)
    lo, hi = s.low(y), min(s.high(y), s.low(y))
    z_rail = s.rail_z(y)
    zs = min(s.shoulder(y), z_rail)

    def gh(z):  # greenhouse half-width at height z
        return hi * s.tumble(z)

    # The belt lip runs only under a greenhouse (Shape.lip) and fades where the belt meets
    # the shoulder. Under a bonnet or boot that stays near the belt it would be a strip fading
    # in and out along the side.
    crease = max(0.0, min(s.lip(y), s.belt - zs))
    # (x, z); x None: a greenhouse row, x = gh(z) + the offset, taken at z AFTER pressing, so
    # a pressed row stays on the tumblehome. The panel between the belt and a rising pressed
    # row (the A and C pillars) then lies in the tumblehome surface instead of twisting.
    side = [
        (lo, zb + SILL_CHAMFER),
        (lo, (zb + zs) / 2),
        (lo, zs - SHOULDER_ROLL),
        (max(hi, lo - SHOULDER_ROLL), zs),
        (hi, zs),
        (None, s.belt - crease, crease),  # the belt lip: the one row allowed to stand out
        (None, s.belt, 0.0),
        (None, s.glass_top, 0.0),
        (None, z_rail, 0.0),
        (None, zt - CROWN, -RAIL),
        (0.0, zt),
    ]
    out = [(0.0, zb), (lo - SILL_CHAMFER, zb)]
    px, pz = lo, zb
    rail_x = gh(z_rail)
    for row, (x, z, *off) in enumerate(side, start=R_SILL_UP):
        z = min(max(z, pz), z_rail if row <= R_RAIL else zt)
        if x is None:
            x = (gh(z) if row <= R_RAIL else rail_x) + off[0]
        if row == R_BELT_LO:
            out.append((max(0.0, min(x, lo)), z))
            pz = z
            continue
        px, pz = max(0.0, min(x, px)), z
        out.append((px, pz))
    return out


def emergences(s):
    """ys where the rail height crosses a side row's height. On one side of such a y the row
    is pressed down to the rail height, on the other it is free; a station exactly there lets
    the row leave the rail at a vertex, not across a face (which shades as a ripple)."""
    out = []
    for h in (lambda y: s.shoulder(y) - SHOULDER_ROLL, s.shoulder, lambda y: s.belt, lambda y: s.glass_top):
        out += s.crossings(lambda y, h=h: s.rail_z(y) - h(y))
    return out


def stations(spec, s):
    """Station ys. Candidates by priority: the ends, then the rows' emergence points and the
    belt lip's ends, then every breakpoint of the (faired) views and the windscreen/back light
    edges, then their frame offsets and the arch outline's corners. Candidates closer than
    MIN_STATION_GAP keep the higher priority one (the first on a tie). Side windows need no
    stations (they are pockets cut afterwards). No filler stations: between breakpoints every
    row is straight, so a filler adds no shape; where a strip is twisted it only multiplies
    the alternating creases of its triangulation."""
    cand = {}

    def put(y, prio):
        if s.front <= y <= s.rear:
            cand[y] = max(cand.get(y, -1), prio)

    for key in ("windscreen", "backlight"):
        if key in spec:
            a, b = spec[key]
            put(a, 2)
            put(b, 2)
            put(a + FRAME, 1)
            put(b - FRAME, 1)
    for c in (s.top, s.bottom, s.shoulder, s.low, s.high):
        for y in c.ys:
            put(y, 2)
    for _, _, outline, _, _ in arch_specs(spec):
        for y, _ in outline:  # the cut lands on station columns where no view breaks nearby
            put(y, 1)
    for y in emergences(s) + s.lip_stations():
        put(y, 3)
    put(s.front, 4)
    put(s.rear, 4)
    merged = []
    for y, prio in sorted(cand.items()):
        if merged and y - merged[-1][0] < MIN_STATION_GAP:
            if prio > merged[-1][1]:
                merged[-1] = (y, prio)
            continue
        merged.append((y, prio))
    return [y for y, _ in merged]


def face_cell(spec, s, row_a, row_b, y0, y1):
    """Cell of the quad between ring rows row_a..row_b over stations y0..y1. Side glass is not
    a shell cell: it is the floor of a pocket cut into the side (cut_windows)."""
    ym = (y0 + y1) / 2
    lo_row = min(row_a, row_b)
    if lo_row == R_BOTTOM:
        return "black"
    if lo_row >= R_RAIL:  # roof rows: windscreen and back light on the slopes
        for key in ("windscreen", "backlight"):
            if key in spec:
                a, b = spec[key]
                if a + FRAME <= ym <= b - FRAME:
                    return "glass"
    return "paint"


def build_shell(spec, s, bm, uvl):
    ys = stations(spec, s)
    # A bulged cap: the last ring stands `bulge` inside the end, the cap's face at the end.
    nose = float(spec.get("nose", {}).get("bulge", 0.0))
    tail = float(spec.get("tail", {}).get("bulge", 0.0))
    ys = ([s.front + nose] if nose > 0 else []) + \
         [y for y in ys if s.front + nose + (MIN_STATION_GAP if nose > 0 else 0) <= y
          <= s.rear - tail - (MIN_STATION_GAP if tail > 0 else 0)] + \
         ([s.rear - tail] if tail > 0 else [])
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
    for idx, sign, key, end in ((0, -1.0, "nose", s.front), (len(ys) - 1, 1.0, "tail", s.rear)):
        ring, left = rings[idx]
        add_cap(bm, uvl, ring + list(reversed(left)), end, sign, float(spec.get(key, {}).get("inset", 0.0)))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=WELD)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=WELD)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    split_folded(bm)
    return ys


def add_cap(bm, uvl, loop, y_end, sign, inset):
    """Close the end ring `loop`. When it stands inside the end (a bulged nose or tail), the
    cap is a band out to a face at y_end: the ring scaled about its centre to stand `inset` mm
    inside it. Scaled edges stay parallel, so every band quad is flat."""
    y_ring = loop[0].co.y / MM
    if abs(y_ring - y_end) < 0.5:
        add_face(bm, uvl, loop, CELLS["paint"], Vector((0, sign, 0)))
        return
    zs = [v.co.z for v in loop]
    cz = (min(zs) + max(zs)) / 2
    radius = sum(math.hypot(v.co.x, v.co.z - cz) for v in loop) / len(loop)
    f = max(0.3, 1.0 - inset * MM / radius)
    inner = [bm.verts.new(Vector((v.co.x * f, y_end * MM, cz + (v.co.z - cz) * f))) for v in loop]
    n = len(loop)
    for i in range(n):
        j = (i + 1) % n
        add_face(bm, uvl, [loop[i], loop[j], inner[j], inner[i]], CELLS["paint"], Vector((0, sign, 0)))
    add_face(bm, uvl, inner, CELLS["paint"], Vector((0, sign, 0)))


def split_folded(bm):
    """Split every non-planar quad along the diagonal that makes its fold convex. Left whole,
    the game splits it along whichever diagonal comes first, and a concave split shades as a
    dent: the accordion look. Normals must point outward."""
    for f in list(bm.faces):
        if len(f.verts) != 4:
            continue
        a, b, c, d = f.verts
        n1 = (b.co - a.co).cross(c.co - a.co)
        n2 = (c.co - a.co).cross(d.co - a.co)
        if n1.length < 1e-12 or n2.length < 1e-12 or n1.angle(n2) < math.radians(FOLD_SPLIT_DEG):
            continue
        if (d.co - a.co).dot(n1) < 0:  # d lies inside the plane of abc: a-c is a convex crease
            bmesh.utils.face_split(f, a, c)
        else:
            bmesh.utils.face_split(f, b, d)


# ---------------------------------------------------------------- arches

def arch_specs(spec):
    """[(tag, hub_y, outline, lip, flare)] for the front and rear arch. The outline is the
    opening's edge in side view, [(y, z)] mm front to rear, from the spec's `arches.<tag>.outline`
    (traced: the UAZ's are trapezoids with a flat top) or, without one, a semicircle of
    `wheels.arch_front|arch_rear` radius about the hub. Its ends reach below the body's bottom."""
    w = spec["wheels"]
    hub_z = float(w["radius"])
    out = []
    for tag, hub_y, key in (("front", 0.0, "arch_front"), ("rear", float(w["wheelbase"]), "arch_rear")):
        a = spec.get("arches", {}).get(tag, {})
        if "outline" in a:  # faired like the views: a pixel zig-zag would kink the lip
            pts = simplify([(float(y), float(z)) for y, z in a["outline"]], ARCH_FAIR_TOL)
        else:
            r = float(w.get(key, hub_z * 1.2))
            ts = [math.pi * i / ARCH_SEGMENTS for i in range(-1, ARCH_SEGMENTS + 2)]
            pts = [(hub_y - r * math.cos(t), hub_z + r * math.sin(t)) for t in ts]
        out.append((tag, hub_y, pts, float(a.get("lip", ARCH_LIP)), float(a.get("flare", ARCH_FLARE))))
    return out


def arch_cutter(spec, s, hub_y, outline, name):
    """Prism along x through both sides' outer bands: the outline closed below the ground.
    Its faces inside the body become the dark well; the inner wall stands `well` mm inside."""
    well = float(spec["wheels"].get("well", 260.0))
    lo = max(s.low(y) for y, _ in outline)
    poly = [(outline[0][0], -100.0)] + outline + [(outline[-1][0], -100.0)]
    bm, uvl = new_bm()
    for sign in (1.0, -1.0):
        x_in, x_out = sign * (s.low(hub_y) - well), sign * (lo + 300.0)
        ring_in = [bm.verts.new(Vector((x_in, y, z)) * MM) for y, z in poly]
        ring_out = [bm.verts.new(Vector((x_out, y, z)) * MM) for y, z in poly]
        add_face(bm, uvl, ring_in, CELLS["black"])
        add_face(bm, uvl, ring_out, CELLS["black"])
        n = len(poly)
        for i in range(n):
            j = (i + 1) % n
            add_face(bm, uvl, [ring_in[i], ring_in[j], ring_out[j], ring_out[i]], CELLS["black"])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return finish(bm, name)


def cut_arches(spec, s, body):
    for tag, hub_y, outline, _, _ in arch_specs(spec):
        apply_cut(body, arch_cutter(spec, s, hub_y, outline, f"cutter_{tag}"))


def weld_cuts(body):
    """The cuts leave vertices a hair from the grid's (slivers that shade as streaks): weld."""
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=ARCH_SNAP * MM)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=ARCH_SNAP * MM)
    bm.to_mesh(body.data)
    bm.free()
    body.data.update()


def side_x(bvh, y, z):
    """Half-width of the (uncut) body surface at (y, z), hit from the left; None off the body."""
    loc, _, _, _ = bvh.ray_cast(Vector((9.0, y * MM, z * MM)), Vector((-1.0, 0, 0)))
    return None if loc is None or loc.x <= 0 else loc.x / MM


def clip_above(pts, floor):
    """The run of polyline `pts` that lies above floor(y), with the crossings inserted."""
    out = []
    for (ya, za), (yb, zb) in zip(pts, pts[1:]):
        da, db = za - floor(ya), zb - floor(yb)
        if da >= 0:
            out.append((ya, za))
        if (da < 0) != (db < 0):
            t = da / (da - db)
            out.append((ya + t * (yb - ya), za + t * (zb - za)))
    if pts and pts[-1][1] >= floor(pts[-1][0]):
        out.append(pts[-1])
    return out


def add_arch_lips(spec, s, body, bvh):
    """A lip around each arch opening: a band from the body side, `lip` mm out from the
    opening's edge, rising to stand `flare` mm proud at the edge, and turning back into the
    well. Probed on the uncut body (`bvh`), so it sits on the side wherever that curves."""
    bm = bmesh.new()
    bm.from_mesh(body.data)
    uvl = bm.loops.layers.uv["UVMap"]
    for _, _, full, lip, flare in arch_specs(spec):
        outline = clip_above(full, lambda y: s.bottom(y) + 1.0)
        n = len(outline)
        rows = []  # per outline point: (edge, out) points (y, z, x) on the left, None off the body
        for i, (y, z) in enumerate(outline):
            (ya, za), (yb, zb) = outline[max(i - 1, 0)], outline[min(i + 1, n - 1)]
            ty, tz = yb - ya, zb - za
            tl = math.hypot(ty, tz) or 1.0
            ny, nz = -tz / tl, ty / tl  # away from the opening
            qy, qz = y + ny * lip, z + nz * lip
            xe, xq = side_x(bvh, y, z), side_x(bvh, qy, qz)
            rows.append(None if xe is None or xq is None else ((y, z, xe), (qy, qz, xq)))
        for sign in (1.0, -1.0):
            def v(y, z, x):
                return bm.verts.new(Vector((sign * x, y, z)) * MM)
            for a, b in zip(rows, rows[1:]):
                if a is None or b is None:
                    continue
                (ea, qa), (eb, qb) = a, b
                tip_a, tip_b = v(ea[0], ea[1], ea[2] + flare), v(eb[0], eb[1], eb[2] + flare)
                base_a, base_b = v(*qa[:2], qa[2] + 1.0), v(*qb[:2], qb[2] + 1.0)
                back_a, back_b = v(ea[0], ea[1], ea[2] - 10.0), v(eb[0], eb[1], eb[2] - 10.0)
                out = Vector((sign, 0, 0))
                add_face(bm, uvl, [base_a, base_b, tip_b, tip_a], CELLS["paint"], out)
                # the turn into the well faces the wheel: away from the outline's outward side
                mid = Vector((0, (ea[0] + eb[0]) / 2 - (qa[0] + qb[0]) / 2, (ea[1] + eb[1]) / 2 - (qa[1] + qb[1]) / 2))
                add_face(bm, uvl, [tip_a, tip_b, back_b, back_a], CELLS["paint"], mid)
    bm.to_mesh(body.data)
    bm.free()
    body.data.update()

# ---------------------------------------------------------------- side glass and seams

def rounded(poly, r):
    """Closed polygon [(y, z)] with each corner replaced by a ROUND_SEGMENTS curve (a quadratic
    Bezier through the corner's tangent points, r mm from it, at most 45% of either edge)."""
    if r <= 0:
        return list(poly)
    out, n = [], len(poly)
    for i in range(n):
        (ay, az), (cy, cz), (by, bz) = poly[i - 1], poly[i], poly[(i + 1) % n]
        la, lb = math.hypot(ay - cy, az - cz), math.hypot(by - cy, bz - cz)
        t = min(r, 0.45 * la, 0.45 * lb)
        if t <= 0:
            out.append((cy, cz))
            continue
        pa = (cy + (ay - cy) * t / la, cz + (az - cz) * t / la)
        pb = (cy + (by - cy) * t / lb, cz + (bz - cz) * t / lb)
        for k in range(ROUND_SEGMENTS + 1):
            u = k / ROUND_SEGMENTS
            out.append(tuple((1 - u) ** 2 * pa[j] + 2 * u * (1 - u) * (cy, cz)[j] + u ** 2 * pb[j] for j in (0, 1)))
    return out


def clip_band(poly, z0, z1):
    """Closed polygon [(y, z)] clipped to z0 <= z <= z1 (Sutherland-Hodgman, two edges)."""
    def clip(pts, inside, cross):
        out = []
        for i in range(len(pts)):
            a, b = pts[i - 1], pts[i]
            if inside(b):
                if not inside(a):
                    out.append(cross(a, b))
                out.append(b)
            elif inside(a):
                out.append(cross(a, b))
        return out

    def at(zc):
        return lambda a, b: (a[0] + (b[0] - a[0]) * (zc - a[1]) / (b[1] - a[1]), zc)

    poly = clip(poly, lambda p: p[1] >= z0, at(z0))
    return clip(poly, lambda p: p[1] <= z1, at(z1)) if poly else poly


def window_outlines(spec, s):
    """Each side window's glass edge in side view, [(y, z)] mm, corners rounded. A window
    with an `outline` (traced corners) uses it. One with only `y` runs from the belt to the
    glass top, WINDOW_FRAME inside both, its top edge dropping under the rail where the
    windscreen or back light slope comes down (a slanted A or C pillar), and ending where
    less than WINDOW_MIN_HEIGHT of glass is left."""
    out = []
    for w in spec.get("windows", []):
        if "outline" in w:  # kept inside the glass band, where the side is the tumblehome surface
            poly = clip_band([(float(y), float(z)) for y, z in w["outline"]],
                             s.belt + GLASS_CLEAR, s.glass_top - GLASS_CLEAR)
            if len(poly) < 3:
                continue
        else:
            a, b = w["y"]
            z0 = s.belt + WINDOW_FRAME
            n = max(1, int((b - a) // 10.0))
            tops = [(a + (b - a) * k / n, min(s.glass_top, s.rail_z(a + (b - a) * k / n)) - WINDOW_FRAME)
                    for k in range(n + 1)]
            runs, run = [], []
            for y, zt in tops:
                if zt - z0 >= WINDOW_MIN_HEIGHT:
                    run.append((y, zt))
                elif run:
                    runs.append(run)
                    run = []
            if run:
                runs.append(run)
            if not runs:
                continue
            top = simplify(max(runs, key=len), 3.0)
            poly = [(top[0][0], z0), (top[-1][0], z0)] + top[::-1]
        out.append(rounded(poly, float(w.get("round", WINDOW_ROUND))))
    return out


def greenhouse_x(s, y, z):
    """Half-width of the greenhouse side (the tumblehome surface) at (y, z)."""
    return min(s.high(y), s.low(y)) * s.tumble(z)


def apply_cut(body, cutter):
    mod = body.modifiers.new("cut", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.solver = "EXACT"
    mod.object = cutter
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)


def side_plane(pts):
    """Least-squares plane x = a + b*y + c*z through [(y, z, x)]."""
    n = len(pts)
    sy = sum(p[0] for p in pts); sz = sum(p[1] for p in pts); sx = sum(p[2] for p in pts)
    syy = sum(p[0] * p[0] for p in pts); szz = sum(p[1] * p[1] for p in pts); syz = sum(p[0] * p[1] for p in pts)
    sxy = sum(p[2] * p[0] for p in pts); sxz = sum(p[2] * p[1] for p in pts)
    m = Matrix(((n, sy, sz), (sy, syy, syz), (sz, syz, szz)))
    if abs(m.determinant()) < 1e-6:
        return lambda y, z: sx / n
    a, b, c = m.inverted() @ Vector((sx, sxy, sxz))
    return lambda y, z: a + b * y + c * z


def cut_windows(spec, s, body):
    """Every side window is a pocket in the greenhouse side, its floor the glass, its walls the
    dark rubber seal. The floor is one plane (the side's best fit over the outline, set back so
    it stands at least GLASS_INSET inside the side everywhere): a floor that followed a twisted
    side would be a fan of creased triangles. Pillars and frames are what is left of the paint
    around the pockets, so slanted pillars and rounded corners come from the outline."""
    polys = window_outlines(spec, s)
    if not polys:
        return
    bm, uvl = new_bm()
    for poly in polys:
        pts = [(y, z, greenhouse_x(s, y, z)) for y, z in poly]
        plane = side_plane(pts)
        back = max(plane(y, z) - x for y, z, x in pts) + GLASS_INSET
        for sign in (1.0, -1.0):
            inner = [bm.verts.new(Vector((sign * (plane(y, z) - back), y, z)) * MM) for y, z in poly]
            outer = [bm.verts.new(Vector((sign * (plane(y, z) + 200.0), y, z)) * MM) for y, z in poly]
            add_face(bm, uvl, inner, CELLS["glass"], Vector((-sign, 0, 0)))
            add_face(bm, uvl, outer, CELLS["black"], Vector((sign, 0, 0)))
            n = len(poly)
            for i in range(n):
                j = (i + 1) % n
                add_face(bm, uvl, [inner[i], inner[j], outer[j], outer[i]], CELLS["black"])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    apply_cut(body, finish(bm, "cutter_windows"))


def add_seams(spec, body, bvh):
    """Door and panel seams: dark ribbons SEAM_WIDTH wide, SEAM_PROUD off the (uncut) side,
    along each `seams` polyline [(y, z)] (both sides). A run is split wherever the side bends
    away from the straight ribbon by more than SEAM_TOL (over the belt lip, along the
    tumblehome), so the ribbon neither sinks into the body nor floats off a flat panel."""
    bm = bmesh.new()
    bm.from_mesh(body.data)
    uvl = bm.loops.layers.uv["UVMap"]
    half = SEAM_WIDTH / 2

    def bends(a, b):
        """The points after a along a-b where the side bends away from a straight ribbon by
        more than SEAM_TOL: the side sampled every SEAM_MIN mm, faired with `simplify`."""
        length = math.hypot(b[0] - a[0], b[1] - a[1])
        n = max(1, int(length // SEAM_MIN))
        prof = []
        for k in range(n + 1):
            x = side_x(bvh, a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n)
            if x is not None:
                prof.append((length * k / n, x))
        keep = [sv for sv, _ in simplify(prof, SEAM_TOL)] if len(prof) > 1 else [length]
        return [(a[0] + (b[0] - a[0]) * sv / length, a[1] + (b[1] - a[1]) * sv / length)
                for sv in keep if sv > 0] if length > 0 else []

    def onto_body(a, b):
        """b, or the point nearest it on a-b that still hits the side (a seam drawn to the
        body's bottom edge would otherwise lose its last run)."""
        if side_x(bvh, *b) is not None or side_x(bvh, *a) is None:
            return b
        lo, hi = 0.0, 1.0  # fraction from a: lo hits, hi misses
        for _ in range(12):
            t = (lo + hi) / 2
            lo, hi = (t, hi) if side_x(bvh, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t) is not None else (lo, t)
        return (a[0] + (b[0] - a[0]) * lo, a[1] + (b[1] - a[1]) * lo)

    for line in spec.get("seams", []):
        line = [tuple(p) for p in line]
        line[0], line[-1] = onto_body(line[1], line[0]), onto_body(line[-2], line[-1])
        pts = [line[0]]
        for a, b in zip(line, line[1:]):
            pts += bends(a, b)
        rows = []
        for i, (y, z) in enumerate(pts):
            (ya, za), (yb, zb) = pts[max(i - 1, 0)], pts[min(i + 1, len(pts) - 1)]
            tl = math.hypot(yb - ya, zb - za) or 1.0
            ny, nz = -(zb - za) / tl * half, (yb - ya) / tl * half
            ends = [(y + ny, z + nz), (y - ny, z - nz)]
            xs = [side_x(bvh, ey, ez) for ey, ez in ends]
            rows.append(None if None in xs else [(ey, ez, ex + SEAM_PROUD) for (ey, ez), ex in zip(ends, xs)])
        for sign in (1.0, -1.0):
            def v(p):
                return bm.verts.new(Vector((sign * p[2], p[0], p[1])) * MM)
            for a, b in zip(rows, rows[1:]):
                if a is None or b is None:
                    continue
                add_face(bm, uvl, [v(a[0]), v(a[1]), v(b[1]), v(b[0])], CELLS["black"], Vector((sign, 0, 0)))
    bm.to_mesh(body.data)
    bm.free()
    body.data.update()



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


def cut_bezels(spec, body):
    """A lamp with `bezel` (mm) sits in a pocket that much wider than the lamp all round and
    `bezel_depth` (BEZEL_DEPTH) deep in its face, floor parallel to the face: the recessed
    headlamp surround. The lamp itself is probed onto the floor later (build_lamps)."""
    items = [it for lamp in spec.get("lamps", []) if lamp.get("bezel") for it in mirrored(lamp)]
    if not items:
        return
    bvh = body_bvh(body)
    bm, uvl = new_bm()
    for it in items:
        m, depth = float(it["bezel"]), float(it.get("bezel_depth", BEZEL_DEPTH))
        grown = dict(it, x=[min(it["x"]) - m, max(it["x"]) + m], z=[min(it["z"]) - m, max(it["z"]) + m])
        s = -1.0 if it["face"] == "front" else 1.0
        floor, outer = [], []
        for x, z in outline_pts(grown):
            y = probe(bvh, x, z, it["face"])
            if y is None:
                fail(f"{it['role']} bezel at x={x:.0f} z={z:.0f} has no {it['face']} face behind it")
            floor.append(bm.verts.new(Vector((x, y - s * depth, z)) * MM))
            outer.append(bm.verts.new(Vector((x, y + s * 200.0, z)) * MM))
        cell = CELLS[it.get("bezel_cell", "paint")]
        add_face(bm, uvl, floor, cell, Vector((0, -s, 0)))
        add_face(bm, uvl, outer, cell, Vector((0, s, 0)))
        n = len(floor)
        for i in range(n):
            j = (i + 1) % n
            add_face(bm, uvl, [floor[i], floor[j], outer[j], outer[i]], cell)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    apply_cut(body, finish(bm, "cutter_bezels"))


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
    uncut = body_bvh(body)
    cut_arches(spec, s, body)
    cut_windows(spec, s, body)
    cut_bezels(spec, body)
    weld_cuts(body)
    add_arch_lips(spec, s, body, uncut)
    add_seams(spec, body, uncut)
    add_details(spec, body)
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.normal_update()
    split_folded(bm)
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
