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
    "chrome": (4, 1), "lamp_head": (4, 1), "lamp_tail": (5, 1), "blinker": (7, 1), "reverse": (8, 1),
    "white": (8, 1),
}
# A headlamp lens is the pack's: the chrome cell (vz07, gz24, vz21), grey until the game lights
# it. The white cell read as a lamp already burning.
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
ARCH_LIP_TAPER = 80.0    # mm over which an arch lip's flare runs out at its ends
ARCH_FAIR_TOL = 6.0      # mm: tolerance of `simplify` on a traced outline (keeps rounded corners)
ARCH_LIP_OFFSET = 2.0    # mm the arch lip's turn into the well stands in front of the well wall
BEZEL_DEPTH = 25.0       # mm a lamp bezel pocket goes into its face (spec lamps[].bezel_depth)
GLASS_INSET = 12.0       # mm side glass sits inside the greenhouse side
WINDOW_FRAME = 20.0      # mm paint a default (y-only) window leaves over the belt and under the glass top
WINDOW_ROUND = 40.0      # mm default window corner radius (spec windows[].round)
GLASS_CLEAR = 5.0        # mm: a traced window stays this far inside the belt and the glass top
ROUND_SEGMENTS = 3       # segments of a rounded corner
WINDOW_MIN_HEIGHT = 80.0  # mm: a default window ends where less glass than this is left
RECESS_DEPTH = 15.0       # mm a recess (glass, grille) goes into its face (spec recesses[].depth)
GROOVE_WIDTH = 10.0       # mm width of a panel gap at the surface (grooves[].width); 18 and 14 read coarse (owner)
GROOVE_DEPTH = 8.0        # mm depth of a panel gap's V (grooves[].depth)
GROOVE_SILL_CLEAR = 10.0  # mm a side gap stops above the sill chamfer
GROOVE_RAIL_CLEAR = 8.0   # mm a side gap stops below the rail chamfer (Shape.rail_z), on the side surface
LINE_WIDTH = 12.0         # mm width of a drawn line (lines[].width)
LINE_PROUD = 3.0          # mm a drawn line stands off its face
BUMPER_LIP = 40.0         # mm height of a channel bumper's lips (bumpers[].lip)
LAYOUT_CLEAR = 8.0        # mm a detail keeps from a panel gap or another detail (check_layout)
SEAM_TOL = 1.5            # mm a line or groove may stray from its face between probes
SEAM_MIN = 8.0            # mm between a line's probes of its face
LAMP_MAX_GAP = 0.060     # m: every lamp vertex must lie within this of the body surface (domes included)


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
        if lamp.get("face") not in ("front", "rear", "side"):
            fail(f"{lamp['role']} lamp needs face front|rear|side")
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
    """Piecewise-linear y -> value, clamped at the ends; with `tol`, faired by `simplify`.
    Points at a y in `keep` (drawn by hand: `redraw`) are never faired away: the stretches
    between them are faired on their own."""

    def __init__(self, pts, tol=0.0, keep=()):
        pts = sorted((float(a), float(b)) for a, b in pts)
        if tol > 0:
            cuts = [0] + [i for i, p in enumerate(pts) if p[0] in keep and 0 < i < len(pts) - 1] + [len(pts) - 1]
            out = [pts[0]]
            for a, b in zip(cuts, cuts[1:]):
                out += simplify(pts[a:b + 1], tol)[1:]
            pts = out
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

def apply_redraw(spec):
    """`redraw: {top|bottom|shoulder: [[[y, z|null], …], …]}`: each polyline replaces the side
    view's line over its own span, the traced points there dropped; a null z is the traced
    line's own height at that y (two nulls: a straight chord). For what a drawing shows and the
    car does not: the UAZ sheet's bonnet rises 80 mm to the cowl with a step across it, where
    the factory bonnet is flat; its sill has 30-40 mm bumps by the arches."""
    for key, polys in spec.get("redraw", {}).items():
        pts = sorted((float(y), float(z)) for y, z in spec["side"][key])
        for poly in polys:
            line = Curve(pts)
            new = [(float(y), line(float(y)) if z is None else float(z)) for y, z in poly]
            y0, y1 = min(y for y, _ in new), max(y for y, _ in new)
            pts = sorted([p for p in pts if not y0 <= p[0] <= y1] + new)
        spec["side"][key] = [list(p) for p in pts]
        spec.setdefault("_redrawn", {})[key] = sorted({float(y) for poly in polys for y, _ in poly})
    return spec


class Shape:
    """The spec's three views as functions of y (and z for the tumblehome)."""

    def __init__(self, spec):
        side, plan = spec["side"], spec["plan"]
        tol = float(spec.get("fair_tol", FAIR_TOL))
        kept = spec.get("_redrawn", {})
        self.top = Curve(side["top"], tol, kept.get("top", ()))
        self.bottom = Curve(side["bottom"], tol, kept.get("bottom", ()))
        self.shoulder = Curve(side["shoulder"], tol, kept.get("shoulder", ()))
        self.low = Curve(plan["low"], tol)
        self.high = Curve(plan["high"], tol)
        # The rail chamfer between the side and the roof, bonnet or pillar: RAIL, or the
        # spec's `rail` [[y, mm], …] (the UAZ's A pillar has none: its door frame needs the side).
        self.rail = Curve(spec.get("rail", [[0.0, RAIL]]))
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
        return max(self.bottom(y) + SILL_CHAMFER, self.top(y) - self.rail(y) - CROWN)

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
        (None, zt - CROWN, -s.rail(y)),
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
    for c in (s.top, s.bottom, s.shoulder, s.low, s.high, s.rail):
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
    well. Probed on the uncut body (`bvh`), so it sits on the side wherever that curves. It
    stops above the sill chamfer and its flare runs out over ARCH_LIP_TAPER mm at both ends,
    so it meets the sill flush instead of ending in a jagged stub."""
    bm = bmesh.new()
    bm.from_mesh(body.data)
    uvl = bm.loops.layers.uv["UVMap"]
    for _, _, full, lip, flare in arch_specs(spec):
        outline = clip_above(full, lambda y: s.bottom(y) + SILL_CHAMFER + 2.0)
        n = len(outline)
        arc = [0.0]
        for (ya, za), (yb, zb) in zip(outline, outline[1:]):
            arc.append(arc[-1] + math.hypot(yb - ya, zb - za))
        rows = []  # per outline point: (edge, out, flare) points (y, z, x) on the left, None off the body
        for i, (y, z) in enumerate(outline):
            (ya, za), (yb, zb) = outline[max(i - 1, 0)], outline[min(i + 1, n - 1)]
            ty, tz = yb - ya, zb - za
            tl = math.hypot(ty, tz) or 1.0
            ny, nz = -tz / tl, ty / tl  # away from the opening
            qy, qz = y + ny * lip, z + nz * lip
            xe, xq = side_x(bvh, y, z), side_x(bvh, qy, qz)
            f = flare * min(1.0, min(arc[i], arc[-1] - arc[i]) / ARCH_LIP_TAPER)
            # the turn into the well stands ARCH_LIP_OFFSET in front of the well wall, which the
            # cut lays along the same outline: coplanar, the two fought in depth
            ey, ez = y - ny * ARCH_LIP_OFFSET, z - nz * ARCH_LIP_OFFSET
            rows.append(None if xe is None or xq is None else ((ey, ez, xe), (qy, qz, xq), f))
        for sign in (1.0, -1.0):
            def v(y, z, x):
                return bm.verts.new(Vector((sign * x, y, z)) * MM)
            for a, b in zip(rows, rows[1:]):
                if a is None or b is None:
                    continue
                (ea, qa, fa), (eb, qb, fb) = a, b
                tip_a, tip_b = v(ea[0], ea[1], ea[2] + fa), v(eb[0], eb[1], eb[2] + fb)
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


def pillar_slope(s, key):
    """dy/dz of the body's A pillar (`a`: where the top line first rises through the glass band)
    or C pillar (`c`: where it last falls through it), from the traced side silhouette."""
    z0, z1 = s.belt + 50.0, s.glass_top

    def y_at(z):
        ys = s.crossings(lambda y: s.top(y) - z)
        return (ys[0] if key == "a" else ys[-1]) if ys else None

    ya, yb = y_at(z0), y_at(z1)
    return None if ya is None or yb is None else (yb - ya) / (z1 - z0)


def corner_pair(poly, which):
    """(bottom, top) corners of a window outline's front or rear edge."""
    mid = (min(z for _, z in poly) + max(z for _, z in poly)) / 2
    pick = min if which == "front" else max
    bot = pick((p for p in poly if p[1] < mid), key=lambda p: p[0])
    top = pick((p for p in poly if p[1] >= mid), key=lambda p: p[0])
    return bot, top


def window_polys(spec, s):
    """Each side window's glass edge in side view, [(y, z)] mm, before its corners are rounded
    (None for a window that leaves no glass). A window with an `outline` (traced corners)
    uses it. One with only `y` runs from the belt to the glass top, WINDOW_FRAME inside both,
    its top edge dropping under the rail where the windscreen or back light slope comes down
    (a slanted A or C pillar), and ending where less than WINDOW_MIN_HEIGHT of glass is left.

    Rule: `pillar: "a"` (front edge) or `"c"` (rear edge) makes that edge parallel to the
    body's A or C pillar, pivoting on its bottom corner: glass beside a pillar follows it."""
    out = []
    for w in spec.get("windows", []):
        if "outline" in w:  # kept inside the glass band, where the side is the tumblehome surface
            poly = clip_band([(float(y), float(z)) for y, z in w["outline"]],
                             s.belt + GLASS_CLEAR, s.glass_top - GLASS_CLEAR)
            if len(poly) < 3:
                out.append(None)
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
                out.append(None)
                continue
            top = simplify(max(runs, key=len), 3.0)
            poly = [(top[0][0], z0), (top[-1][0], z0)] + top[::-1]
        for key, which in (("a", "front"), ("c", "rear")):
            if w.get("pillar") == key and (k := pillar_slope(s, key)) is not None:
                bot, top = corner_pair(poly, which)
                moved = (bot[0] + (top[1] - bot[1]) * k, top[1])
                poly = [moved if p == top else p for p in poly]
        out.append(poly)
    return out


def window_outlines(spec, s):
    """The side windows' outlines (window_polys) with their corners rounded by `round`."""
    return [rounded(poly, float(w.get("round", WINDOW_ROUND)))
            for w, poly in zip(spec.get("windows", []), window_polys(spec, s)) if poly]


def expand_line(spec, s, line):
    """A line's points, with each `{edge: [window, "front"|"rear"], offset, z: [lo, hi]}` entry
    replaced by the two ends of a line parallel to that window edge, `offset` mm along y from
    it, spanning z (in the order given). Rule: a door's edge follows the glass it frames."""
    polys = window_polys(spec, s) if any(isinstance(p, dict) for p in line) else []
    out = []
    for p in line:
        if not isinstance(p, dict):
            out.append(tuple(p))
            continue
        i, which = p["edge"]
        if polys[i] is None:
            fail(f"line follows window {i}, which has no glass")
        (yb, zb), (yt, zt) = corner_pair(polys[i], which)
        k = (yt - yb) / (zt - zb)
        for z in p["z"]:
            out.append((yb + (z - zb) * k + float(p.get("offset", 0.0)), float(z)))
    return out


def greenhouse_x(s, y, z):
    """Half-width of the greenhouse side (the tumblehome surface) at (y, z)."""
    return min(s.high(y), s.low(y)) * s.tumble(z)


def apply_cut(body, cutter, self_intersect=False):
    """Subtract `cutter` from the body (EXACT boolean); `self_intersect` when the cutter is
    built of overlapping pieces. The cutter's faces become the cut's walls, cells included."""
    mod = body.modifiers.new("cut", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.solver = "EXACT"
    mod.use_self = self_intersect
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


# ---------------------------------------------------------------- face details
#
# Every detail is placed on one of four faces, in that face's own 2D coordinates (mm):
#   front / rear: (x, z), seen along +y / -y      side: (y, z), the left side, seen along -x
#   top: (y, x), seen from above
# and probed onto the body along the face's axis, so it sits wherever the face curves.

FACE_AXIS = {"front": Vector((0, -1, 0)), "rear": Vector((0, 1, 0)), "side": Vector((1, 0, 0)),
             "top": Vector((0, 0, 1))}  # outward
AXIS_INDEX = {"front": 1, "rear": 1, "side": 0, "top": 2}


def face_point(face, u, v):
    """The 3D point (mm, on the axis' zero plane) of face coordinates (u, v)."""
    if face in ("front", "rear"):
        return Vector((u, 0.0, v))
    if face == "side":
        return Vector((0.0, u, v))
    return Vector((v, u, 0.0))


def face_hit(bvh, face, u, v):
    """Body surface point (mm) at face coordinates (u, v), hit from outside along the face axis."""
    out = FACE_AXIS[face]
    origin = (face_point(face, u, v) * MM) + out * 9.0
    loc, _, _, _ = bvh.ray_cast(origin, -out)
    return None if loc is None else loc / MM


def mirror_uv(face, pts):
    """The same 2D points on the car's other half: x flipped (front, rear, top); the side's
    points are the same (the right side is reached by flipping the 3D result)."""
    if face in ("front", "rear"):
        return [(-u, v) for u, v in pts]
    if face == "top":
        return [(u, -v) for u, v in pts]
    return list(pts)


def halves(item, pts):
    """[(pts, sign)] of an item: sign -1 flips the 3D result to the right side (side face).
    Unless `single`, the mirror half is added."""
    out = [(pts, 1.0)]
    if not item.get("single"):
        out.append((mirror_uv(item["face"], pts), -1.0 if item["face"] == "side" else 1.0))
    return out


def flip(p, sign):
    return Vector((p.x * sign, p.y, p.z))


def item_outline(item):
    """Closed outline of an item in its face's coordinates. Rect from `x`/`z` (front, rear),
    `y`/`z` (side) or `y`/`x` (top); `round` makes it an ellipse, `radius` rounds its
    corners (a radius of half the height is a stadium)."""
    face = item["face"]
    ku, kv = {"front": ("x", "z"), "rear": ("x", "z"), "side": ("y", "z"), "top": ("y", "x")}[face]
    u0, u1 = min(item[ku]), max(item[ku])
    v0, v1 = min(item[kv]), max(item[kv])
    if item.get("round"):
        cu, cv, ru, rv = (u0 + u1) / 2, (v0 + v1) / 2, (u1 - u0) / 2, (v1 - v0) / 2
        n = int(item.get("segments", 10))
        return [(cu + ru * math.cos(2 * math.pi * i / n), cv + rv * math.sin(2 * math.pi * i / n)) for i in range(n)]
    rect = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
    return rounded(rect, float(item.get("radius", 0.0)))


def add_plate(bm, uvl, bvh, item, cell, pts=None, sign=1.0, flat=False):
    """A flat block on a face: its outer face `proud` (PROUD) off the body at every corner
    (along the face axis), its back 5 mm inside, so it is attached wherever the face curves.
    `flat` (lamps): the outer face is one plane, `proud` off the outermost corner, so a lens
    laid over a crease stands clear of it instead of folding over it and letting the crease's
    edge show through between its corners."""
    face = item["face"]
    out = flip(FACE_AXIS[face], sign)
    hits = []
    for u, v in (pts or item_outline(item)):
        p = face_hit(bvh, face, u, v)
        if p is None:
            fail(f"{item.get('role', 'plate')} at {face} ({u:.0f}, {v:.0f}) has no face behind it")
        hits.append(flip(p, sign))
    top = max(p.dot(out) for p in hits)
    proud = float(item.get("proud", PROUD))
    outer = [(p + out * ((top - p.dot(out) if flat else 0.0) + proud)) * MM for p in hits]
    inner = [(p - out * 5.0) * MM for p in hits]
    n = len(outer)
    c = [bm.verts.new(p) for p in outer] + [bm.verts.new(p) for p in inner]
    centre = sum((v.co for v in c), Vector()) / (2 * n)
    faces = [list(range(n)), list(range(n, 2 * n))[::-1]]
    faces += [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    for q in faces:
        vs = [c[i] for i in q]
        mid = sum((v.co for v in vs), Vector()) / len(vs)
        add_face(bm, uvl, vs, CELLS[cell], mid - centre)


def body_bvh(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bvh = BVHTree.FromBMesh(bm)
    bm.free()
    return bvh


def recess_items(spec):
    """Recesses: spec `recesses`, plus a bezel pocket for every lamp with `bezel`."""
    out = list(spec.get("recesses", []))
    for lamp in spec.get("lamps", []):
        if lamp.get("bezel"):
            m = float(lamp["bezel"])
            ku = "y" if lamp["face"] == "side" else "x"
            out.append(dict(lamp, **{ku: [min(lamp[ku]) - m, max(lamp[ku]) + m],
                                     "z": [min(lamp["z"]) - m, max(lamp["z"]) + m]},
                            depth=lamp.get("bezel_depth", BEZEL_DEPTH), cell=lamp.get("bezel_cell", "paint")))
    return out


def cut_recesses(spec, body):
    """Pockets `depth` (RECESS_DEPTH) mm into a face: windscreen and back light glass, grille
    openings, lamp bezels. The floor (cell `cell`) is one plane, the face's best fit over the
    outline set back so it stands at least `depth` inside it everywhere: a floor that followed
    the face would crease. The walls are the same cell."""
    items = recess_items(spec)
    if not items:
        return
    bvh = body_bvh(body)
    bm, uvl = new_bm()
    for it in items:
        face, depth = it["face"], float(it.get("depth", RECESS_DEPTH))
        cell = CELLS[it.get("cell", "black")]
        ax = AXIS_INDEX[face]
        outward = FACE_AXIS[face][ax]  # +1 or -1: which way along the axis is outside
        for pts, sign in halves(it, item_outline(it)):
            hits = []
            for u, v in pts:
                p = face_hit(bvh, face, u, v)
                if p is None:
                    fail(f"recess at {face} ({u:.0f}, {v:.0f}) has no face behind it")
                hits.append(((u, v), p))
            plane = side_plane([(u, v, p[ax]) for (u, v), p in hits])
            proud = max((p[ax] - plane(u, v)) * outward for (u, v), p in hits)
            floor, outer = [], []
            for (u, v), p in hits:
                a, b = p.copy(), p.copy()
                a[ax] = plane(u, v) + outward * (proud - depth)
                b[ax] = plane(u, v) + outward * (proud + 200.0)
                floor.append(bm.verts.new(flip(a, sign) * MM))
                outer.append(bm.verts.new(flip(b, sign) * MM))
            o = flip(FACE_AXIS[face], sign)
            add_face(bm, uvl, floor, cell, -o)
            add_face(bm, uvl, outer, cell, o)
            n = len(floor)
            for i in range(n):
                j = (i + 1) % n
                add_face(bm, uvl, [floor[i], floor[j], outer[j], outer[i]], cell)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    apply_cut(body, finish(bm, "cutter_recesses"))


def probe_line(bvh, face, line, tol, step, keep_if=None):
    """Runs of points (u, v, 3D mm, surface normal) along a polyline on a face, each run split
    where the face bends away from a straight piece by more than `tol` (sampled every `step`
    mm, faired with `simplify`; the polyline's own corners are kept). A point's normal
    averages the samples on both sides of it, so at a crease it is the crease's bisector.
    Samples off the body, or failing `keep_if(point, normal)`, end a run: a line drawn past
    the body's edge stops at it and starts again where it comes back, never bridging the gap."""
    ax = AXIS_INDEX[face]
    out_axis = FACE_AXIS[face]
    samples = []  # (segment, arc length, depth, u, v, point, normal) or None
    arc0 = 0.0
    for si, (a, b) in enumerate(zip(line, line[1:])):
        length = math.hypot(b[0] - a[0], b[1] - a[1])
        n = max(1, int(length // step))
        for k in range(0 if si == 0 else 1, n + 1):
            u, v = a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n
            loc, nrm, _, _ = bvh.ray_cast(face_point(face, u, v) * MM + out_axis * 9.0, -out_axis)
            if loc is None or (keep_if and not keep_if(loc / MM, nrm)):
                samples.append(None)
                continue
            samples.append((si, arc0 + length * k / n, loc[ax] / MM, u, v, loc / MM, nrm))
        arc0 += length
    runs, run = [], []
    for q in samples + [None]:
        if q is not None:
            run.append(q)
            continue
        if len(run) >= 2:
            runs.append(run)
        run = []
    out = []
    for run in runs:
        keep = set()
        start = 0
        for i in range(1, len(run) + 1):  # pieces of one polyline segment each
            if i == len(run) or run[i][0] != run[start][0]:
                piece = run[start:i] if start == 0 else run[start - 1:i]
                ids = list(range(start if start == 0 else start - 1, i))
                kept = {round(sv, 6) for sv, _ in simplify([(q[1], q[2]) for q in piece], tol)}
                keep.update(j for j, q in zip(ids, piece) if round(q[1], 6) in kept)
                keep.update((ids[0], ids[-1]))
                start = i
        pts = []
        for i in sorted(keep):
            nb = run[max(i - 1, 0)][6] + run[min(i + 1, len(run) - 1)][6]
            pts.append((run[i][3], run[i][4], run[i][5], nb.normalized()))
        out.append(pts)
    return out


def line_items(spec, s):
    """(kind, item) of `lines` and `grooves`, their lines expanded (expand_line); side `seams`
    [(y, z)] polylines are grooves."""
    for key in ("lines", "grooves"):
        for it in spec.get(key, []):
            yield key, dict(it, line=expand_line(spec, s, it["line"]))
    for line in spec.get("seams", []):
        yield "grooves", {"face": "side", "line": expand_line(spec, s, line)}


def closed(it):
    line = [tuple(p) for p in it["line"]]
    return line + [line[0]] if it.get("closed") else line


def add_lines(spec, s, body, bvh):
    """Drawn lines (`lines`): dark ribbons `width` (LINE_WIDTH) wide, LINE_PROUD off the face,
    for what is painted on rather than cut: bonnet ribs."""
    bm = bmesh.new()
    bm.from_mesh(body.data)
    uvl = bm.loops.layers.uv["UVMap"]
    for kind, it in line_items(spec, s):
        if kind != "lines":
            continue
        face = it["face"]
        half = float(it.get("width", LINE_WIDTH)) / 2
        cell = CELLS[it.get("cell", "black")]
        for line, sign in halves(it, closed(it)):
            for pts in probe_line(bvh, face, line, SEAM_TOL, SEAM_MIN):
                out = flip(FACE_AXIS[face], sign)
                rows = []
                for i, (u, v, _, _) in enumerate(pts):
                    (ua, va, _, _), (ub, vb, _, _) = pts[max(i - 1, 0)], pts[min(i + 1, len(pts) - 1)]
                    tl = math.hypot(ub - ua, vb - va) or 1.0
                    du, dv = -(vb - va) / tl * half, (ub - ua) / tl * half
                    pair = [face_hit(bvh, face, u + k * du, v + k * dv) for k in (1, -1)]
                    rows.append(None if None in pair else
                                [bm.verts.new((flip(p, sign) + out * LINE_PROUD) * MM) for p in pair])
                for a, b in zip(rows, rows[1:]):
                    if a is not None and b is not None:
                        add_face(bm, uvl, [a[0], a[1], b[1], b[0]], cell, out)
    bm.to_mesh(body.data)
    bm.free()
    body.data.update()


def add_wedge(bm, uvl, pts, sign, face, loop, half, depth, cell):
    """One swept V wedge (the cutter of a panel gap) along probed points; 1 if built, else 0.
    Cross-sections stand square to the surface (the probe's normal) and across the line's
    direction; the wedge's top stands `rise` off the surface, so the V is `2 half` wide there."""
    if len(pts) < 2:
        return 0
    rise = 30.0
    top_half = half * (depth + rise) / depth
    axis = flip(FACE_AXIS[face], sign)
    m = len(pts)
    P = [flip(q[2], sign) for q in pts]
    rings = []
    for i, (_, _, _, nrm) in enumerate(pts):
        p, out = P[i], flip(nrm, sign)
        if out.dot(axis) < 0:
            out = -out
        prev = P[(i - 1) % m] if loop or i > 0 else p
        nxt = P[(i + 1) % m] if loop or i < m - 1 else p
        t = nxt - prev
        if t.length < 1e-6:
            continue
        across = t.normalized().cross(out).normalized()
        rings.append([bm.verts.new((p + across * top_half + out * rise) * MM),
                      bm.verts.new((p - across * top_half + out * rise) * MM),
                      bm.verts.new((p - out * depth) * MM)])
    if len(rings) < 2:
        return 0
    pairs = list(zip(rings, rings[1:])) + ([(rings[-1], rings[0])] if loop else [])
    for a, b in pairs:
        for i in range(3):
            j = (i + 1) % 3
            add_face(bm, uvl, [a[i], a[j], b[j], b[i]], cell)
    if not loop:
        add_face(bm, uvl, rings[0], cell)
        add_face(bm, uvl, rings[-1][::-1], cell)
    return 1


def cut_grooves(spec, s, body, bvh):
    """Panel gaps (`grooves`, side `seams`): V channels `width` (GROOVE_WIDTH) wide at the
    surface and `depth` (GROOVE_DEPTH) deep, in the paint, as the pack folds its door
    gaps into the shell. One swept wedge per line (probed on the uncut `bvh`), its cross-section
    square to the surface at every probe, so neighbouring pieces share their ends and leave
    no slivers. Side lines stay on the side surface: they stop short of the sill chamfer below
    and of the rail (where the side turns into the roof, bonnet or pillar) above, so a gap
    never cuts the body's edge or runs over a chamfer."""
    bm, uvl = new_bm()
    cell = CELLS["paint"]
    lines = 0

    def on_side(p, _n):
        return s.bottom(p.y) + SILL_CHAMFER + GROOVE_SILL_CLEAR < p.z < s.rail_z(p.y) - GROOVE_RAIL_CLEAR

    for kind, it in line_items(spec, s):
        if kind != "grooves":
            continue
        face = it["face"]
        half = float(it.get("width", GROOVE_WIDTH)) / 2
        depth = float(it.get("depth", GROOVE_DEPTH))
        loop = bool(it.get("closed"))
        for line, sign in halves(it, closed(it)):
            runs = probe_line(bvh, face, line, SEAM_TOL, SEAM_MIN, on_side if face == "side" else None)
            # a closed line that stayed whole is a loop; one broken by a dropped stretch is not
            whole = loop and len(runs) == 1
            for pts in runs:
                if whole and len(pts) > 2:
                    pts = pts[:-1]
                lines += add_wedge(bm, uvl, pts, sign, face, whole, half, depth, cell)
    if not lines:
        bm.free()
        return
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    apply_cut(body, finish(bm, "cutter_grooves"), self_intersect=True)


def add_bumper(bm, uvl, b):
    """A bumper box; with `channel` (mm) its outer face is a channel that deep between a top and
    a bottom lip `lip` (BUMPER_LIP) mm tall: the UAZ's pressed-steel section. With `ends`
    ({width, y, z}) each end is a heavier block `width` mm wide spanning its own y and z (the
    side view's bumper profile), so a beam that is slim in the middle reads fat from the side."""
    hw, (y0, y1), (z0, z1) = b["half_width"], b["y"], b["z"]
    cell, ch = b.get("cell", "steel"), b.get("chamfer", 30.0)
    e = b.get("ends")
    if e:
        w = float(e["width"])
        (ey0, ey1), (ez0, ez1) = e.get("y", b["y"]), e.get("z", b["z"])
        for sx in (1.0, -1.0):
            xa, xb = sorted((sx * hw, sx * (hw - w)))
            add_box(bm, uvl, (xa, ey0, ez0), (xb, ey1, ez1), cell, float(e.get("chamfer", ch)))
        hw -= w - 1.0  # the beam runs between the blocks, overlapping them by 1 mm
    c = float(b.get("channel", 0.0))
    if c <= 0:
        add_box(bm, uvl, (-hw, y0, z0), (hw, y1, z1), cell, ch)
        return
    lip = float(b.get("lip", BUMPER_LIP))
    front = y1 < 0
    core = (y0 + c, y1) if front else (y0, y1 - c)
    lips = (y0, y0 + c) if front else (y1 - c, y1)
    add_box(bm, uvl, (-hw, core[0], z0), (hw, core[1], z1), cell, ch)
    for za, zb in ((z0, z0 + lip), (z1 - lip, z1)):
        add_box(bm, uvl, (-hw, lips[0], za), (hw, lips[1], zb), cell, min(ch, lip / 2 - 1))


def add_details(spec, body):
    """Bumpers, mirrors, chassis and plates (any face: grille panels, handles, hinges), joined in."""
    bvh = body_bvh(body)
    bm = bmesh.new()
    bm.from_mesh(body.data)
    uvl = bm.loops.layers.uv["UVMap"]
    for b in spec.get("bumpers", []):
        add_bumper(bm, uvl, b)
    for m in spec.get("mirrors", []) + spec.get("chassis", []):
        for sign in ((1.0,) if m.get("single") else (1.0, -1.0)):
            x0, x1 = sorted(v * sign for v in m["x"])
            add_box(bm, uvl, (x0, m["y"][0], m["z"][0]), (x1, m["y"][1], m["z"][1]),
                    m.get("cell", "black"), m.get("chamfer", 0.0))
    for p in spec.get("plates", []):
        for pts, sign in halves(p, item_outline(p)):
            add_plate(bm, uvl, bvh, p, p.get("cell", "black"), pts, sign)
    for r in spec.get("recesses", []):
        if r.get("bars"):
            add_bars(bm, uvl, bvh, r)
    bm.to_mesh(body.data)
    bm.free()
    body.data.update()


def add_bars(bm, uvl, bvh, r):
    """Grille bars across a stadium or rectangular recess on the front or rear face:
    `bars.count` vertical bars `bars.width` (25) mm wide in `bars.cell` (trim), standing on the
    recess floor and reaching to `bars.inset` (3) mm under the face, trimmed to the rounded ends."""
    b = r["bars"]
    n, w = int(b["count"]), float(b.get("width", 25.0))
    x0, x1 = min(r["x"]), max(r["x"])
    z0, z1 = min(r["z"]), max(r["z"])
    rad = min(float(r.get("radius", 0.0)), (z1 - z0) / 2, (x1 - x0) / 2)
    depth = float(r.get("depth", RECESS_DEPTH))
    for k in range(n):
        cx = x0 + (x1 - x0) * (k + 1) / (n + 1)
        edge = min(cx - x0, x1 - cx)
        trim = rad - math.sqrt(max(0.0, rad * rad - (rad - edge) ** 2)) if edge < rad else 0.0
        bar = {"face": r["face"], "x": [cx - w / 2, cx + w / 2], "z": [z0 + trim + 4, z1 - trim - 4],
               "proud": depth - float(b.get("inset", 3.0)), "single": True}
        if bar["z"][1] - bar["z"][0] > 10:
            add_plate(bm, uvl, bvh, bar, b.get("cell", "trim"))


def add_dome(bm, uvl, rim_bm, rim_uvl, bvh, item, cell, pts, sign):
    """A round lamp as the pack builds its headlamps: a rim `rim` (8) mm proud in `rim_cell`
    (chrome) around a lens bulging `dome` mm further in the lamp's cell, on the face it is
    probed onto. Rings: base (inside the face), rim, rim inner edge, lens shoulder, lens centre.
    The rim goes into `rim_bm` (the body): the game lights a lamp's whole mesh, and a rim in
    the lamp's mesh glowed with the lens."""
    face = item["face"]
    out = flip(FACE_AXIS[face], sign)
    rim, dome = float(item.get("rim", 8.0)), float(item["dome"])
    base = []
    for u, v in pts:
        p = face_hit(bvh, face, u, v)
        if p is None:
            fail(f"{item['role']} at {face} ({u:.0f}, {v:.0f}) has no face behind it")
        base.append(flip(p, sign))
    c = sum(base, Vector()) / len(base)
    rings = [[p - out * 5.0 for p in base],
             [p + out * rim for p in base],
             [c + (p - c) * 0.82 + out * rim for p in base],
             [c + (p - c) * 0.5 + out * (rim + dome * 0.8) for p in base]]
    n = len(base)
    centre = (c + out * rim) * MM
    rim_cell = CELLS[item.get("rim_cell", "chrome")]
    rim_vs = [[rim_bm.verts.new(p * MM) for p in ring] for ring in rings[:3]]
    for ring_a, ring_b in zip(rim_vs, rim_vs[1:]):
        for i in range(n):
            j = (i + 1) % n
            q = [ring_a[i], ring_a[j], ring_b[j], ring_b[i]]
            mid = sum((v.co for v in q), Vector()) / 4
            add_face(rim_bm, rim_uvl, q, rim_cell, mid - centre + out * 1e-3)
    vs = [[bm.verts.new(p * MM) for p in ring] for ring in rings[2:]]
    tip = bm.verts.new((c + out * (rim + dome)) * MM)
    for i in range(n):
        j = (i + 1) % n
        q = [vs[0][i], vs[0][j], vs[1][j], vs[1][i]]
        mid = sum((v.co for v in q), Vector()) / 4
        add_face(bm, uvl, q, CELLS[cell], mid - centre + out * 1e-3)
    for i in range(n):
        j = (i + 1) % n
        add_face(bm, uvl, [vs[-1][i], vs[-1][j], tip], CELLS[cell], out)
    add_face(bm, uvl, vs[0][::-1], CELLS[cell], -out)


def build_spare(spec, cid, objs, tmpl, pts, pack_w, pack_r):
    """A spare wheel on the tail, axis along the car: its own object `<id>.spare`, origin at
    the hub. The game puts the wheel set the car is shod with in its place (`spareNode` in
    src/vehicle/carmodels.ts); this pack wheel is what any other viewer shows."""
    sp = spec.get("spare")
    if not sp:
        return
    w = spec["wheels"]
    sx = w["width"] * MM / pack_w
    sr = w["radius"] * MM / pack_r
    rot = Matrix.Rotation(math.pi / 2, 3, "Z")
    me = tmpl.copy()
    for v, p in zip(me.vertices, pts):
        v.co = rot @ Vector((p.x * sx, p.y * sr, p.z * sr))
    me.update()
    obj = bpy.data.objects.new(f"{cid}.spare", me)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = Vector((0.0, sp["y"], sp["z"])) * MM
    objs.append(obj)


def build_lamps(spec, cid, body, objs):
    bvh = body_bvh(body)
    body_bm = bmesh.new()
    body_bm.from_mesh(body.data)
    body_uvl = body_bm.loops.layers.uv["UVMap"]
    per_role = {}
    for lamp in spec.get("lamps", []):
        for pts, sign in halves(lamp, item_outline(lamp)):
            role = lamp["role"]
            if role in ("leftblinkers", "rightblinkers") and not lamp.get("single"):
                left = sign > 0 if lamp["face"] == "side" else min(u for u, _ in pts) > 0
                role = "leftblinkers" if left else "rightblinkers"
            if role not in per_role:
                per_role[role] = new_bm()
            bm, uvl = per_role[role]
            if lamp.get("dome"):
                add_dome(bm, uvl, body_bm, body_uvl, bvh, lamp, lamp.get("cell", LAMP_CELL[role]), pts, sign)
            else:
                add_plate(bm, uvl, bvh, lamp, lamp.get("cell", LAMP_CELL[role]), pts, sign, flat=True)
    body_bm.to_mesh(body.data)
    body_bm.free()
    body.data.update()
    for role, (bm, _) in per_role.items():
        for v in bm.verts:
            hit = bvh.find_nearest(v.co)
            if hit[0] is None or hit[3] > LAMP_MAX_GAP:
                fail(f"{cid} {role} lamp vertex {tuple(round(c, 3) for c in v.co)} floats off the body")
        objs.append(finish(bm, f"{cid}.body.{role}"))


def _sample(poly, closed_loop, step=5.0):
    pts = list(poly) + ([poly[0]] if closed_loop else [])
    out = []
    for a, b in zip(pts, pts[1:]):
        n = max(1, int(math.hypot(b[0] - a[0], b[1] - a[1]) // step))
        out += [(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n) for k in range(n)]
    return out + [pts[-1]]


def _inside(p, poly):
    x, y = p
    hit = False
    for (ax, ay), (bx, by) in zip(poly, poly[1:] + poly[:1]):
        if (ay > y) != (by > y) and x < ax + (y - ay) * (bx - ax) / (by - ay):
            hit = not hit
    return hit


def _seg_dist(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / ((dx * dx + dy * dy) or 1.0)))
    return math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)


def check_layout(spec, s):
    """Rule: details do not sit on each other. On every face, a lamp, plate, recess or side
    window keeps LAYOUT_CLEAR mm (plus the gap's half width) from every panel gap, and does not
    overlap another such detail; a closed gap (a flap) keeps that clearance from every other
    gap. Being inside a closed gap (a handle on a door) is fine. A plate with `straddle` (a
    hinge) may cross gaps. Fails with every clash listed, so a spec is fixed once."""
    shapes, gaps = [], []
    for key in ("lamps", "plates", "recesses"):
        for it in spec.get(key, []):
            ku = "y" if it["face"] in ("side", "top") else "x"
            shapes.append((f"{key[:-1]} {it.get('role', '')} {ku}={it[ku]}".replace("  ", " "),
                           it["face"], item_outline(it), bool(it.get("straddle"))))
    for i, poly in enumerate(window_polys(spec, s)):
        if poly:
            shapes.append((f"window {i}", "side", poly, False))
    for kind, it in line_items(spec, s):
        if kind == "grooves":
            line = [tuple(p) for p in it["line"]]
            loop = bool(it.get("closed"))
            pts = line + ([line[0]] if loop else [])
            gaps.append((it["face"], line, loop, float(it.get("width", GROOVE_WIDTH)) / 2, list(zip(pts, pts[1:]))))

    def where(line):
        return [tuple(round(v) for v in q) for q in line[:2]]

    clashes = []
    for name, face, poly, straddle in shapes:
        edge = _sample(poly, True)
        if not straddle:
            for gface, line, loop, half, segs in gaps:
                if gface == face and (any(_seg_dist(p, a, b) < half + LAYOUT_CLEAR for p in edge for a, b in segs)
                                      or any(_inside(q, poly) for q in _sample(line, loop))):
                    clashes.append(f"{name} on {face} meets the panel gap {where(line)}…")
        for other, oface, opoly, _ in shapes:
            if oface == face and other > name and (any(_inside(p, opoly) for p in edge)
                                                   or any(_inside(q, poly) for q in _sample(opoly, True))):
                clashes.append(f"{name} and {other} overlap on {face}")
    for gi, (face, line, loop, half, _) in enumerate(gaps):
        if not loop:
            continue
        edge = _sample(line, True)
        for gj, (oface, oline, _, ohalf, osegs) in enumerate(gaps):
            if gj != gi and oface == face and any(_seg_dist(p, a, b) < half + ohalf + LAYOUT_CLEAR
                                                  for p in edge for a, b in osegs):
                clashes.append(f"flap {where(line)} on {face} meets the panel gap {where(oline)}…")
    if clashes:
        fail("layout clashes:\n  " + "\n  ".join(clashes))


def build_body(spec, cid):
    s = Shape(spec)
    check_layout(spec, s)
    bm, uvl = new_bm()
    build_shell(spec, s, bm, uvl)
    body = finish(bm, f"{cid}.body")
    uncut = body_bvh(body)
    cut_arches(spec, s, body)
    cut_windows(spec, s, body)
    cut_recesses(spec, body)
    weld_cuts(body)  # before the gaps: welding would drag a gap's edges onto the station grid
    cut_grooves(spec, s, body, uncut)
    add_arch_lips(spec, s, body, uncut)
    add_lines(spec, s, body, uncut)
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
    """The pack's left wheel scaled to the spec; at -x (the right side) mirrored, so every
    wheel shows its rim outward."""
    me = tmpl.copy()
    sx = w["width"] * MM / pack_w * (1.0 if hub[0] >= 0 else -1.0)
    sr = w["radius"] * MM / pack_r
    for v, p in zip(me.vertices, pts):
        v.co = Vector((p.x * sx, p.y * sr, p.z * sr))
    if sx < 0:  # a mirror turns the faces inside out: turn them back
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:], flip_multires=False)
        bm.to_mesh(me)
        bm.free()
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
    objs = [body]
    build_lamps(spec, cid, body, objs)
    build_spare(spec, cid, objs, tmpl, pts, pack_w, pack_r)
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
        spec = apply_redraw(validate(json.load(fh)))
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
