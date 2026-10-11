"""Trace a three-view line drawing into a fit_blueprint.py input (plain Python: numpy, scipy, OpenCV).

    python3 tools/carforge/trace.py tools/carforge/examples/sheet_uaz3151.json build/carforge/trace/blueprint.json

The sheet JSON is the only manual input:

  id, source            copied to the blueprint
  image                 the drawing (any format Pillow reads; dark ink on a light ground)
  wheelbase_mm          the one known dimension: sets the scale
  views                 {side, front?, top?, rear?}: [x0, y0, x1, y1] px box of each view in the image.
                          A box holds one view; keep dimension lines that would close a loop with the
                          car's outline (an arrowed dimension beside the roof) outside it.
                          The top view must be drawn under the side view, columns aligned with it.
  extras                what a drawing does not give, copied into the blueprint after the traced
                          items: wheels {width, well}, arches {front|rear: {lip, flare}}, bumpers,
                          mirrors, plates, lamps (mm), nose, tail, spare, recesses, grooves, lines,
                          seams. Bumper boxes also trim the body's ends (see below).

Every other value is measured from the image (see README.md, "Automatic trace"):

  deskew      the side view's two tyre circles must sit level; the scan is rotated about the front hub
              until they do (blueprint `scale.deskew`, which compare.py applies to the drawing too).
  wheels      cv2.HoughCircles in the side view, each candidate refined by least squares on the ink's
              distance map; the outermost ring with ink round >= 85 % of it is the tyre. Two tyres of
              the same size on one row are the wheels: scale = wheelbase / hub distance, ground row =
              hub row + tyre radius. Track: the two outermost tyres in the front view (front_wheels());
              their mid-point is the front centre column.
  silhouette  per view, the pixels not reachable from the box border through non-ink (ink closed by
              one pixel), cut at the hub row + 0.75 tyre radius so the ground line and the hatching never
              close a loop; then a 3 px morphological opening drops thin lines (extension lines, aerials).
  body ends   the run of columns where the side silhouette stands >= 50 % of the car's height (drops a
              low bumper) and the top view is >= 60 % of the widest half-width (drops a spare wheel
              carried behind), trimmed to stop where an extras bumper box begins.
  side.top    first silhouette row per column, small flat-topped spikes (< 60 mm wide) removed.
  side.bottom see bottom_line().
  plan        top view, per column, the filled run through the centre row: low = its half-width (both
              sides averaged), with a grey opening 250 mm wide that removes the mirrors; high = the
              outermost line drawn symmetrically about the centre row at least 6 px inside low and
              outside 60 % of it (the roof gutter / bonnet edge), opened the same way, <= low, and
              capped at the front view's half-width at the belt (the gutter stands out past the glass).
              Under each arch the top view's outline is the arch lip's edge, so low there is the
              outline less the lip's flare profile (lip_flare(): carforge stands the lip that far
              proud of plan.low), but never inside the body line bridged across the arch: the side
              is one wall up to the shoulder, so a deeper cut would dent the wing above the lip.
  front view  half-width per row of the run through the centre column (mirror heads cut off by the
              opening, arms and brackets by an 80 mm grey opening). tumblehome = half-width / half-width
              at the belt, from the belt up to where it falls under 0.9 (the roof's corner radius).
              shoulder = first row below the belt where the half-width is past half-way from the belt's
              to the body's widest.
  windows     see find_windows(). arches: see find_arch().
  details     side_details() (door and panel gaps -> seams; hinges, handles -> plates; fuel flap ->
              a closed groove), front_details() (grille openings -> recesses with bars; headlamps and
              blinkers -> lamps), top_ribs() (bonnet ribs -> lines). Strong evidence only; every
              candidate dropped is listed with its reason.

Prints `TRACE {...}` with the measured scale, hubs, track, extents and window spans, then two tables
(details taken with their evidence, candidates dropped with the reason), and writes them to
<blueprint>.trace_report.json next to the blueprint.
"""

import argparse
import json
import math
import os

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from scipy import optimize

INK = 160            # grey level below which a pixel is ink
TYRE_COVER = 0.85    # fraction of a ring that must be inked to count as the tyre's outline
SIMPLIFY = 1.2       # px, Douglas-Peucker tolerance of every emitted polyline
OPEN_PX = 3          # px radius of the opening that removes thin lines from a silhouette
MIRROR_MM = 250      # plan features narrower than this along the car are mirrors (top view)
SPIKE_MM = 60        # side-view top spikes narrower than this are aerials/lamps
FRONT_SPIKE_MM = 80  # front-view half-width bumps shorter than this are mirror arms and brackets
CLEAR_MM = 70        # bottom_line(): a clear panel run at least this tall is body side, not chassis
WINDOW_DT_MM = 60    # find_windows(): a glass region is at least twice this thick (a door frame strip is not)
MERGE_MM = 25        # find_windows(): regions twice this close (one drawn line apart) are one window

ANGLES = np.linspace(0, 2 * np.pi, 360, endpoint=False)
COS, SIN = np.cos(ANGLES), np.sin(ANGLES)


def fail(msg):
    raise SystemExit("trace: " + msg)


def r1(v):
    return round(float(v), 1)


# ---------------------------------------------------------------- geometry helpers

def simplify(pts, eps=SIMPLIFY):
    """Douglas-Peucker on an open polyline."""
    pts = [tuple(map(float, p)) for p in pts]
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (ax, ay), (bx, by) = pts[a], pts[b]
        dx, dy = bx - ax, by - ay
        n = math.hypot(dx, dy) or 1e-9
        best, idx = -1.0, -1
        for i in range(a + 1, b):
            d = abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / n
            if d > best:
                best, idx = d, i
        if idx > 0 and best > eps:
            keep[idx] = True
            stack += [(a, idx), (idx, b)]
    return [p for p, k in zip(pts, keep) if k]


def runs(v):
    """[(value, start, end_inclusive), ...] of a 1-D array."""
    v = np.asarray(v)
    if v.size == 0:
        return []
    cut = np.flatnonzero(v[1:] != v[:-1]) + 1
    starts = np.concatenate([[0], cut])
    ends = np.concatenate([cut, [v.size]]) - 1
    return [(v[s], int(s), int(e)) for s, e in zip(starts, ends)]


def run_through(v, c):
    """[a, b] of the True run of v that contains index c, or None."""
    if not (0 <= c < len(v)) or not v[c]:
        return None
    f = np.flatnonzero(~v[:c])
    a = int(f[-1]) + 1 if f.size else 0
    f = np.flatnonzero(~v[c:])
    b = c + int(f[0]) - 1 if f.size else len(v) - 1
    return a, b


def opened(mask, r):
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    return cv2.morphologyEx(mask.astype(np.uint8), cv2.MORPH_OPEN, k).astype(bool)


def grey_open(v, w):
    """Remove peaks of a profile narrower than w samples; monotone stretches are kept."""
    w = max(1, int(round(w)))
    return ndi.grey_opening(np.asarray(v, dtype=float), size=w)


# ---------------------------------------------------------------- image

class Sheet:
    def __init__(self, path):
        with open(path) as fh:
            self.d = json.load(fh)
        for key in ("image", "wheelbase_mm", "views"):
            if key not in self.d:
                fail(f"sheet missing {key!r}")
        if "side" not in self.d["views"]:
            fail("sheet needs a side view box")
        self.grey = Image.open(self.d["image"]).convert("L")
        self.boxes_raw = {k: [int(v) for v in b] for k, b in self.d["views"].items()}
        self.set_rotation(0.0, (0.0, 0.0))

    def set_rotation(self, deg, centre):
        self.deg, self.centre = deg, centre
        img = self.grey if abs(deg) < 1e-6 else self.grey.rotate(
            deg, resample=Image.BICUBIC, center=centre, fillcolor=255)
        self.ink = np.asarray(img) < INK
        self.dist = ndi.distance_transform_edt(~self.ink)
        h, w = self.ink.shape
        self.boxes = {}
        for k, (x0, y0, x1, y1) in self.boxes_raw.items():  # bounding box of the rotated corners
            pts = np.array([rot_point(p, -deg, centre) for p in ((x0, y0), (x1, y0), (x0, y1), (x1, y1))])
            self.boxes[k] = [max(0, int(math.floor(pts[:, 0].min()))), max(0, int(math.floor(pts[:, 1].min()))),
                             min(w, int(math.ceil(pts[:, 0].max()))), min(h, int(math.ceil(pts[:, 1].max())))]


def rot_point(p, deg, centre):
    """Image point p after PIL's rotate(-deg) about centre (PIL rotates counter-clockwise on screen)."""
    a = math.radians(deg)
    x, y = p[0] - centre[0], p[1] - centre[1]
    return centre[0] + x * math.cos(a) - y * math.sin(a), centre[1] + x * math.sin(a) + y * math.cos(a)


def silhouette(ink, box, bottom=None):
    """Mask (box-sized) of pixels not reachable from the box border through non-ink. The ink is
    grown by a pixel to close gaps in the outline; the mask is shrunk by that pixel again."""
    x0, y0, x1, y1 = box
    if bottom is not None:
        y1 = min(y1, int(bottom))
    m = ndi.binary_dilation(ink[y0:y1, x0:x1], iterations=1)
    lab, _ = ndi.label(~m)
    border = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    return ndi.binary_erosion(~np.isin(lab, border[border > 0])), (x0, y0)


# ---------------------------------------------------------------- wheels

def ring_cost(dist, cx, cy, r):
    v = ndi.map_coordinates(dist, [cy + r * SIN, cx + r * COS], order=1, mode="nearest")
    return float(np.minimum(v, 3.0).mean())


def ring_cover(dist, cx, cy, r):
    v = ndi.map_coordinates(dist, [cy + r * SIN, cx + r * COS], order=1, mode="nearest")
    return float((v <= 1.0).mean())


def fit_ring(dist, cx, cy, r):
    res = optimize.minimize(lambda p: ring_cost(dist, *p), (cx, cy, r), method="Nelder-Mead",
                            options={"xatol": 0.05, "fatol": 1e-4, "maxiter": 400})
    return tuple(float(v) for v in res.x)


def find_wheels(sheet):
    """The side view's two tyre circles: [(cx, cy, r), (cx, cy, r)] front (left) to rear."""
    x0, y0, x1, y1 = sheet.boxes["side"]
    sub = np.where(sheet.ink[y0:y1, x0:x1], 0, 255).astype(np.uint8)
    h = y1 - y0
    found = cv2.HoughCircles(cv2.GaussianBlur(sub, (3, 3), 0.8), cv2.HOUGH_GRADIENT_ALT, dp=1, minDist=3,
                             param1=150, param2=0.75, minRadius=int(h * 0.06), maxRadius=int(h * 0.35))
    if found is None:
        fail("no circles in the side view")
    centres = []
    for cx, cy, r in found[0]:
        cx, cy = cx + x0, cy + y0
        if any(math.hypot(cx - a, cy - b) < 4 for a, b, _ in centres):
            continue
        centres.append(fit_ring(sheet.dist, float(cx), float(cy), float(r)))
    rings = []
    for cx, cy, r in centres:
        # the outermost well-inked ring about this centre is the tyre (inner rings are rims and hubs)
        rs = [rr for rr in np.arange(0.5 * r, 1.6 * r, 0.5) if ring_cover(sheet.dist, cx, cy, rr) >= TYRE_COVER]
        if not rs:
            continue
        fx, fy, fr = fit_ring(sheet.dist, cx, cy, max(rs))
        if ring_cover(sheet.dist, fx, fy, fr) >= TYRE_COVER and ring_cost(sheet.dist, fx, fy, fr) <= 0.25:
            rings.append((fx, fy, fr))
    # one ring per wheel: concentric rings collapse onto the largest
    wheels = []
    for ring in sorted(rings, key=lambda t: -t[2]):
        if not any(math.hypot(ring[0] - w[0], ring[1] - w[1]) < 0.3 * w[2] for w in wheels):
            wheels.append(ring)
    best = None
    for i in range(len(wheels)):
        for j in range(i + 1, len(wheels)):
            a, b = sorted((wheels[i], wheels[j]))
            r = (a[2] + b[2]) / 2
            if abs(a[2] - b[2]) > 0.12 * r or abs(a[1] - b[1]) > 0.15 * r or b[0] - a[0] < 3 * r:
                continue
            if best is None or r > best[0]:
                best = (r, a, b)
    if best is None:
        fail(f"no pair of equal tyre circles on one row in the side view (rings: {wheels})")
    return [best[1], best[2]]


def front_wheels(ink, box, hub_row, r):
    """Front view: (left tyre column, right tyre column), or None.

    Under the axle a tyre seen from the front is a cluster of vertical lines (its sidewalls, often a
    centre line). Columns inked over >= 80 % of the band 35-70 % of a radius below the hub row are
    vertical lines; lines less than 0.3 r apart form a cluster; a cluster spanning 0.3-1.2 r is a tyre
    (a lone extension or centre line is not). The outermost two tyres' mid-columns are returned."""
    x0, _, x1, _ = box
    band = ink[int(hub_row + 0.35 * r):int(hub_row + 0.7 * r), x0:x1]
    if band.shape[0] < 3:
        return None
    cols = np.flatnonzero(band.mean(axis=0) >= 0.8) + x0
    if cols.size == 0:
        return None
    clusters = [[cols[0], cols[0]]]
    for c in cols[1:]:
        if c - clusters[-1][1] <= 0.3 * r:
            clusters[-1][1] = c
        else:
            clusters.append([c, c])
    tyres = [(a + b) / 2 for a, b in clusters if 0.3 * r <= b - a <= 1.2 * r]
    if len(tyres) < 2:
        return None
    return float(tyres[0]), float(tyres[-1])


# ---------------------------------------------------------------- side view

def column_tops(S, origin):
    x0, y0 = origin
    top = np.full(S.shape[1], np.nan)
    for j in range(S.shape[1]):
        r = np.flatnonzero(S[:, j])
        if r.size:
            top[j] = r[0] + y0
    return top


def bottom_line(sheet, S, origin, cols, wheels, bumpers_px):
    """Body underside per column, outside the wheel discs.

    Heuristic: a body side is a tall clear panel; chassis parts under it (frame rails, springs,
    exhaust, steps) are lines with short gaps between them. Down each silhouette column the lowest
    clear run at least CLEAR_MM tall is taken as body side and the ink band right under it (gaps of
    up to 2 px merged) as the sill; its lower edge is the underside. Columns over a wheel disc (hub
    +- 1.05 r) are left out. A median of 21 columns per stretch (front overhang, between the wheels,
    rear overhang) removes single columns where a chassis gap happened to be tall. No column hangs
    more than 1 px below the median sill between the wheels (what does is a tow bar, a step, a spring
    hanger or a bumper's own bottom). Within 200 mm of an extras bumper box, an underside still lower than the
    box's top is taken to be the bumper's and put at the box's top: the bumper hides the body there.
    """
    x0, y0 = origin
    clear = CLEAR_MM / sheet.mm
    out = {}
    for c in cols:
        if any(abs(c - w[0]) <= 1.05 * w[2] for w in wheels):
            continue
        j = c - x0
        if not (0 <= j < S.shape[1]):
            continue
        rows = np.flatnonzero(S[:, j])
        if rows.size == 0:
            continue
        top, bot = rows[0], rows[-1]
        col = sheet.ink[y0 + top:y0 + bot + 1, c]
        rr = runs(col)
        best = None
        for v, a, b in rr:
            if not v and b - a + 1 >= clear and b < len(col) - 1:
                best = b
        if best is None:
            continue
        k = best + 1
        while k < len(col):  # the sill band: ink with gaps up to 2 px
            if col[k]:
                k += 1
            elif k + 2 < len(col) and col[k + 1:k + 3].any():
                k += 1
            else:
                break
        out[c] = y0 + top + k - 1
    if not out:
        fail("side view: no body underside found")
    cs = np.array(sorted(out))
    vs = np.array([out[c] for c in cs], dtype=float)
    stretch = (cs > wheels[0][0]).astype(int) + (cs > wheels[1][0]).astype(int)
    for k in range(3):  # front overhang, between the wheels, rear overhang
        idx = np.flatnonzero(stretch == k)
        if idx.size:
            vs[idx] = ndi.median_filter(vs[idx], size=min(21, idx.size), mode="nearest")
    between = stretch == 1
    if between.any():
        vs = np.minimum(vs, float(np.median(vs[between])) + 1.0)
    near = 200.0 / sheet.mm
    for i, c in enumerate(cs):
        for bx0, bx1, by0, _ in bumpers_px:
            if bx0 - near <= c <= bx1 + near and vs[i] > by0:
                vs[i] = by0
    return cs, vs


def find_windows(sheet, S, origin, roof_row, ground):
    """Side windows: enclosed background regions in the greenhouse band.

    Candidates are the background regions inside the side silhouette (ink closed by one pixel)
    that are at least 2*WINDOW_DT_MM thick (drops the thin strip between a frame's two lines), at least
    12 % of the car's height tall, end above roof + 55 % of the height (door panels end lower) and
    have holes of at most a quarter of their area (the panel framing several windows has more).
    Regions under 2*MERGE_MM apart (a line or two) are merged: a quarter-light divider, a seat or wiper
    drawn inside the glass. A window is the convex hull of its merged regions, grown by one pixel to
    the frame line's centre. Its outline is the hull's straight edges, each refitted as a line
    through its middle 60 % and intersected with its neighbours (the sharp corners); `round` (mm) is
    the corner radius that explains the area the hull is short of that polygon."""
    x0, y0 = origin
    h, w = S.shape
    m = ndi.binary_dilation(sheet.ink[y0:y0 + h, x0:x0 + w], iterations=1)
    lab, n = ndi.label(~m & S)
    height = ground - roof_row
    dt = ndi.distance_transform_edt(lab > 0)
    sl = ndi.find_objects(lab)
    peak = ndi.maximum(dt, lab, index=np.arange(1, n + 1))
    cands = []
    for i, s in enumerate(sl):
        if s is None:
            continue
        ry0, ry1 = s[0].start + y0, s[0].stop - 1 + y0
        if peak[i] < WINDOW_DT_MM / sheet.mm:
            continue
        if ry1 - ry0 < 0.12 * height or ry1 > roof_row + 0.55 * height:
            continue
        own = lab[s] == i + 1
        if own.sum() < 0.75 * ndi.binary_fill_holes(own).sum():  # a panel round other windows
            continue
        cands.append(i + 1)
    # merge regions one line apart (union-find over dilated overlaps)
    parent = {c: c for c in cands}

    def root(c):
        while parent[c] != c:
            c = parent[c]
        return c

    merge = max(1, int(round(MERGE_MM / sheet.mm)))
    grown = {c: ndi.binary_dilation(lab == c, iterations=merge) for c in cands}
    for i, a in enumerate(cands):
        for b in cands[i + 1:]:
            if (grown[a] & grown[b]).any():
                parent[root(b)] = root(a)
    groups = {}
    for c in cands:
        groups.setdefault(root(c), []).append(c)
    windows = []
    ink = sheet.ink[y0:y0 + h, x0:x0 + w]
    for members in groups.values():
        # the frame: the drawn lines within 4 px of the glass; the window is what they enclose with
        # it, so a seat or a box drawn against the frame is inside the window
        glass = np.isin(lab, members)
        ring = ndi.binary_dilation(glass, iterations=4) & ink
        mask = ndi.binary_erosion(ndi.binary_fill_holes(ring | glass), iterations=1)
        quad = fit_quad(mask)
        if quad is None:
            continue
        dist = ndi.distance_transform_edt(~mask)
        radii = []
        for i in range(4):  # a corner rounded by r stands r (1/sin(t/2) - 1) off its sharp point
            a, b, c = np.array(quad[i - 1]), np.array(quad[i]), np.array(quad[(i + 1) % 4])
            u, v = a - b, c - b
            t = math.acos(max(-1.0, min(1.0, float(u @ v) / (np.hypot(*u) * np.hypot(*v)))))
            yy, xx = int(round(b[1])), int(round(b[0]))
            if 0 <= yy < dist.shape[0] and 0 <= xx < dist.shape[1] and 1 / math.sin(t / 2) - 1 > 1e-3:
                radii.append(float(dist[yy, xx]) / (1 / math.sin(t / 2) - 1))
        round_mm = float(np.median(radii)) * sheet.mm if radii else 0.0
        windows.append({"outline": [(p[0] + x0, p[1] + y0) for p in quad], "round": round_mm})
    windows.sort(key=lambda wd: min(p[0] for p in wd["outline"]))
    return windows


def outer_line(u, v, outward):
    """v = a u + b along the outermost points. An occluder (a seat, a box, a wiper) only pushes
    points inward, so for each slope in [-1.5, 1.5] the line is put through the outermost 2 % of
    the points; the slope whose line holds the most points within 1.5 px wins, refitted to them."""
    best = None
    for a in np.arange(-1.5, 1.5001, 0.005):
        b_i = v - a * u
        b = np.percentile(b_i, 98 if outward > 0 else 2)
        n = int(np.sum(np.abs(b_i - b) <= 1.5))
        if best is None or n > best[0]:
            best = (n, a, b)
    _, a, b = best
    near = np.abs(v - (a * u + b)) <= 1.5
    if near.sum() >= 3:
        a, b = np.polyfit(u[near], v[near], 1)
    return float(a), float(b)


def fit_quad(mask):
    """Window quadrilateral [(x, y)] x4 (bottom-front, top-front, top-rear, bottom-rear, image left =
    front) from a glass mask: each side an outer_line() through the mask's extreme pixels, clear of
    the rounded corners. Top and bottom use the middle 70 % of the columns; front and rear use the
    rows 12-55 % down the glass, since a dash, a seat or a mirror stalk sits in its lower half."""
    ys, xs = np.nonzero(mask)
    if ys.size < 20:
        return None
    y_lo, y_hi, x_lo, x_hi = ys.min(), ys.max(), xs.min(), xs.max()
    rows = np.arange(int(y_lo + 0.12 * (y_hi - y_lo)), int(y_lo + 0.55 * (y_hi - y_lo)) + 1)
    cols = np.arange(int(x_lo + 0.15 * (x_hi - x_lo)), int(x_hi - 0.15 * (x_hi - x_lo)) + 1)
    rows = rows[mask[rows].any(axis=1)]
    cols = cols[mask[:, cols].any(axis=0)]
    if rows.size < 3 or cols.size < 3:
        return None
    left = np.array([np.flatnonzero(mask[r])[0] for r in rows], dtype=float)
    right = np.array([np.flatnonzero(mask[r])[-1] for r in rows], dtype=float)
    top = np.array([np.flatnonzero(mask[:, c])[0] for c in cols], dtype=float)
    bot = np.array([np.flatnonzero(mask[:, c])[-1] for c in cols], dtype=float)
    lf = outer_line(rows.astype(float), left, -1)   # x = a y + b
    rt = outer_line(rows.astype(float), right, 1)
    tp = outer_line(cols.astype(float), top, -1)    # y = c x + d
    bt = outer_line(cols.astype(float), bot, 1)

    def meet(side, cap):
        (a, b), (c, d) = side, cap  # x = a y + b, y = c x + d
        y = (c * b + d) / (1 - c * a)
        return a * y + b, y

    return [meet(lf, bt), meet(lf, tp), meet(rt, tp), meet(rt, bt)]


def find_arch(sheet, wheel, bottom_of):
    """Fender edge over a tyre: the upper edge of the background gap between the tyre and the
    fender. The gap is the non-ink region (not closed: the gap under a lip can be 2 px) outside the
    tyre disc and above the body's underside line (so it cannot run out under the car) that holds
    the most pixels in the band 1-4 px outside the tyre's upper half; the first ink above it in
    each column is the arch edge. Where the gap ends (it pinches shut against the tyre, or a mud
    flap or spring crosses it) the end segment's slope is carried on to 3 px under the body's
    underside, so the cut reaches through the sill."""
    cx, cy, r = wheel
    span = int(2.2 * r)
    xa, xb = int(cx - span), int(cx + span)
    ya = int(cy - 2.5 * r)
    yb = int(max(bottom_of(c) for c in range(xa, xb + 1))) + 1
    sub = ~sheet.ink[ya:yb, xa:xb + 1]
    yy, xx = np.mgrid[ya:yb, xa:xb + 1]
    d = np.hypot(xx - cx, yy - cy)
    sub &= d > r + 1.0
    sub &= yy < np.array([bottom_of(c) for c in range(xa, xb + 1)])[None, :]
    lab, _ = ndi.label(sub)
    hug = lab[(d <= r + 4.0) & (yy < cy - 0.5 * r) & (lab > 0)]
    if hug.size == 0:
        return None
    gap = lab == np.bincount(hug).argmax()
    pts = []
    for j in range(gap.shape[1]):
        rows = np.flatnonzero(gap[:, j])
        if rows.size:
            pts.append((xa + j, ya + rows[0] - 1.0))
    if len(pts) < 3:
        return None
    pts = simplify(pts)

    def run_out(end, prev):
        """Where the gap pinches shut against the tyre, the fender line still runs on down to the
        sill: carry the end segment's slope on until it is 3 px under the underside."""
        (ex, ey), (px_, py_) = end, prev
        dx, dy = ex - px_, ey - py_
        n = math.hypot(dx, dy)
        if n < 1e-6 or dy <= 0.2 * n:  # not descending: drop straight down
            return (ex, bottom_of(ex) + 3)
        x, y = ex, ey
        for _ in range(int(6 * r)):
            if y >= bottom_of(x) + 3:
                break
            x, y = x + dx / n * 0.5, y + dy / n * 0.5
        return (x, y)

    if len(pts) >= 2:
        pts = [run_out(pts[0], pts[1])] + pts + [run_out(pts[-1], pts[-2])]
    return pts

# ---------------------------------------------------------------- body details drawn on the views
#
# Every detail is accepted on strong evidence only (see README.md, "Details"); everything else that
# looked like one is dropped into the trace report with the reason.

# Every rule is relative, so it holds for any drawing: sizes and distances are fractions of the
# wheelbase (*_WB; the one dimension every sheet gives) or multiples of the drawing's own line
# width (*_LW, measured by stroke_width(): what a scan's dithering and line weight blur). Positions
# are taken against traced features: belt, shoulder, sill, windows, wheels, arches, centre lines.
LINE_SEED_WB = 0.025   # line_pieces(): shortest Hough seed of a straight drawn line
BRIDGE_WB = 0.034      # collinear steep pieces this far apart are one line (a hinge box interrupts a gap)
JOIN_WB = 0.042        # side gaps: a gap bends onto a line that ends within half this of the bend
SILL_WB = 0.0105       # side gaps: a gap's lower end lies this close to the sill line
END_WB = 0.042         # side gaps: gaps keep this far inside the body's ends (end lines are its corners)
ARCH_NEAR_WB = 0.042   # a line ending this close to an arch outline is the fender's lip line
FRAME_NEAR_WB = 0.0126  # a line with both ends this close to a window outline is its frame
LONG_LINE_WB = 0.063   # a "long line" (gap, crease) that a panel strip is bounded by
HINGE_WB = (0.0126, 0.046)   # side of a hinge box
HANDLE_WB = ((0.042, 0.126), (0.0084, 0.034))  # handle length, height
FLAP_WB = (0.042, 0.147)     # side of a flap
SHAPE_WB = (0.0084, 0.147)   # closed shapes considered at all: largest side within this
LAMP_WB = (0.0105, 0.084)    # lamp radius
HATCH_CELL_WB = 0.007  # grille hatching: an enclosed cell of at most this squared is "tiny"
HATCH_WINDOW_WB = 0.018  # the window the hatching's cell share and ink density are taken over
HATCH_AREA_WB2 = 0.0017  # a grille's hatched area, in wheelbase squared
RIB_WB = (0.126, 0.0126)  # bonnet rib: shortest length, widest
SHIFT_WB = 0.017       # a flap may be moved this far along the car to clear the gaps' grooves
INK_GAP_LW = 1.5       # a drawn line may break this much
NEAR_LW = 1.0          # a mirrored partner, a collinear end, a row match: this close
RIM_LW = 1.25          # a shape's rim point this close to a long line lies on it
LAMP_COVER = 0.95      # a lamp ring is inked round at least this much of it
HATCH_CELLS = 0.12     # grille hatching: share of tiny enclosed cells around a pixel
FLAP_SHRINK = 0.85     # a flap may be shrunk to this to clear the gaps' grooves (see side_details())
# carforge's own sizes (mm), so the trace emits what carforge will build round
GAP_HALF_MM = 9.0      # GROOVE_WIDTH / 2: half the width of a traced gap's groove
LAYOUT_CLEAR_MM = 8    # LAYOUT_CLEAR: paint kept between a flap's groove and a gap's
ARCH_LIP_MM = 45.0     # ARCH_LIP / ARCH_FLARE: the arch lip a sheet's extras do not size
ARCH_FLARE_MM = 25.0


class U:
    """The drawing's units for the relative rules: wb = px per wheelbase, lw = line width px."""
    wb = 1.0
    lw = 1.0


def stroke_width(ink, box):
    """The drawing's line width (px): the median length of the ink runs across rows and columns.
    A dithered thin line gives runs of 1 and 2 px about equally often, so the commonest length
    flips between them; the median does not (the few long runs of filled areas do not move it)."""
    x0, y0, x1, y1 = box
    sub = ink[y0:y1, x0:x1]
    lens = []
    for a in (sub, sub.T):
        d = np.diff(np.pad(a.astype(np.int8), ((0, 0), (1, 1))), axis=1)
        lens.append(np.flatnonzero(d.ravel() == -1) - np.flatnonzero(d.ravel() == 1))
    lens = np.concatenate(lens)
    return float(max(1.0, np.median(lens))) if lens.size else 1.0

# What a line drawing cannot say: the look of each kind (copied from examples/uaz3151.json).
HANDLE_STYLE = {"cell": "steel", "proud": 20, "radius": 15}
HINGE_STYLE = {"cell": "paint", "proud": 12, "straddle": True}
FLAP_STYLE = {"width": 12, "depth": 8}
GRILLE_STYLE = {"depth": 20, "cell": "black", "single": True}
GRILLE_BARS = {"pitch": 70, "width": 22, "cell": "trim"}  # bar count = opening width / pitch - 1
HEADLAMP_STYLE = {"round": True, "segments": 12, "dome": 30}
BLINKER_STYLE = {"round": True, "segments": 8}

CROSS = ndi.generate_binary_structure(2, 1)


class Report:
    """Detected details and rejected candidates, in mm, for the trace report."""

    def __init__(self):
        self.detected, self.rejected = [], []
        self.notes = []

    def take(self, view, kind, at, evidence):
        self.detected.append({"view": view, "kind": kind, "at_mm": at, "evidence": evidence})

    def drop(self, view, kind, at, reason):
        self.rejected.append({"view": view, "kind": kind, "at_mm": at, "reason": reason})


class Piece:
    """A straight drawn line from a (top end; left end of a level line) to b."""

    def __init__(self, a, b):
        a, b = np.asarray(a, float), np.asarray(b, float)
        self.steep = abs(b[1] - a[1]) >= abs(b[0] - a[0])
        if (self.steep and a[1] > b[1]) or (not self.steep and a[0] > b[0]):
            a, b = b, a
        self.a, self.b = a, b
        self.len = float(np.hypot(*(b - a)))
        self.d = (b - a) / (self.len or 1.0)

    def tilt(self):
        """Degrees from level, 0-90."""
        return math.degrees(math.atan2(abs(self.d[1]), abs(self.d[0])))

    def off(self, p):
        return abs((p[0] - self.a[0]) * self.d[1] - (p[1] - self.a[1]) * self.d[0])

    def along(self, p):
        return float((np.asarray(p, float) - self.a) @ self.d)


def refit(ink, a, b):
    """(point, unit direction) of the line through the ink within 1.5 px of segment a-b, so a Hough
    seed's rounding does not tilt it. A steep line is fitted as column = f(row) through each row's
    mean inked column (a level one the other way round): a box edge or a crossing line touching
    the seed adds one sample, not a cluster that would turn the fit."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    n_ = float(np.hypot(*(b - a))) or 1.0
    d = (b - a) / n_
    h, w = ink.shape
    xa, xb = max(0, int(min(a[0], b[0])) - 2), min(w, int(max(a[0], b[0])) + 3)
    ya, yb = max(0, int(min(a[1], b[1])) - 2), min(h, int(max(a[1], b[1])) + 3)
    ys, xs = np.nonzero(ink[ya:yb, xa:xb])
    P = np.stack([xs + xa, ys + ya], 1).astype(float)
    rel = P - a
    k = (np.abs(rel @ np.array([-d[1], d[0]])) <= 1.5) & (rel @ d >= -1) & (rel @ d <= n_ + 1)
    steep = abs(d[1]) >= abs(d[0])
    u, v = (P[k, 1], P[k, 0]) if steep else (P[k, 0], P[k, 1])
    keys = np.unique(u)
    if keys.size < 3:
        return (a + b) / 2, d
    means = np.array([v[u == q].mean() for q in keys])
    s, c0 = np.polyfit(keys, means, 1)
    mid = float(keys.mean())
    e = np.array([s, 1.0]) if steep else np.array([1.0, s])
    e /= np.hypot(*e)
    m = np.array([s * mid + c0, mid]) if steep else np.array([mid, s * mid + c0])
    return m, (e if e @ d >= 0 else -e)


def walk(inkd, region, p, d):
    """How far the drawn line through p runs along d: the last inked sample before a break longer
    than INK_GAP_LW line widths or the edge of `region`."""
    h, w = inkd.shape
    if not np.all(np.isfinite(d)) or float(np.hypot(*d)) < 1e-6:
        return 0.0  # a degenerate fit: no direction to follow
    t = last = miss = 0.0
    while t < h + w:  # a ray crosses the image in at most h + w px
        t += 0.5
        x, y = int(round(p[0] + d[0] * t)), int(round(p[1] + d[1] * t))
        if not (0 <= y < h and 0 <= x < w) or not region[y, x]:
            return last
        if inkd[y, x]:
            last, miss = t, 0.0
        else:
            miss += 0.5
            if miss > INK_GAP_LW * U.lw:
                return last
    return last


def merge_pieces(pieces, bridge):
    """Collinear pieces that overlap or lie at most `bridge` px apart become one (on the longer one's
    line); level pieces bridge only INK_GAP_LW line widths (a handle's and a hinge's top edges on one
    row are not one line). Collinear: both ends of the shorter within NEAR_LW line widths of the
    longer's line, and at most 10 degrees apart (a short piece tilts by a dithered pixel)."""
    pieces = sorted(pieces, key=lambda p: -p.len)
    cos10 = math.cos(math.radians(10))
    changed = True
    while changed:
        changed = False
        out = []
        for p in pieces:
            for i, q in enumerate(out):
                near = NEAR_LW * U.lw
                if abs(float(p.d @ q.d)) < cos10 or q.off(p.a) > near or q.off(p.b) > near:
                    continue
                ts = sorted((q.along(p.a), q.along(p.b)))
                reach = bridge if q.steep else INK_GAP_LW * U.lw
                if ts[0] - q.len > reach or -ts[1] > reach:
                    continue
                lo, hi = min(0.0, ts[0]), max(q.len, ts[1])
                out[i] = Piece(q.a + q.d * lo, q.a + q.d * hi)
                changed = True
                break
            else:
                out.append(p)
        pieces = sorted(out, key=lambda p: -p.len)
    return pieces


def line_pieces(sh, region):
    """Maximal straight drawn lines inside `region` (image-sized mask): Hough seeds, each refitted
    to its ink and followed both ways while ink continues, then collinear pieces merged."""
    seeds = cv2.HoughLinesP((sh.ink & region).astype(np.uint8) * 255, 1, np.pi / 360, 15,
                            minLineLength=int(LINE_SEED_WB * U.wb), maxLineGap=int(round(INK_GAP_LW * U.lw)))
    if seeds is None:
        return []
    inkd = ndi.binary_dilation(sh.ink, iterations=1)
    out = []
    for xa, ya, xb, yb in seeds.reshape(-1, 4):
        m, d = refit(sh.ink, (xa, ya), (xb, yb))
        out.append(Piece(m - d * walk(inkd, region, m, -d), m + d * walk(inkd, region, m, d)))
    return merge_pieces([p for p in out if p.len > U.lw], BRIDGE_WB * U.wb)


def meet(p, q):
    """Where the lines through pieces p and q cross; None if they are within 8 degrees of parallel."""
    den = p.d[0] * q.d[1] - p.d[1] * q.d[0]
    if abs(den) < math.sin(math.radians(8)):
        return None
    t = ((q.a[0] - p.a[0]) * q.d[1] - (q.a[1] - p.a[1]) * q.d[0]) / den
    return p.a + p.d * t


def climb(s, steep, join, depth=0, seen=()):
    """(vertices, pieces) of the highest chain of lines that ends in piece s: vertices top first,
    down to where s begins. A chain bends from s onto a line t where t ENDS (within join/2 of the
    bend) near s's top (within join) and rises at least `join` above the bend: a corner, not a
    crossing. Of chains reaching as high (3 px), the one with fewer bends wins."""
    best = ([s.a], [s])
    if depth >= 3:
        return best
    for t in steep:
        if t is s or t in seen:
            continue
        x = meet(s, t)
        if x is None or np.hypot(*(x - s.a)) > join or np.hypot(*(x - t.b)) > join / 2:
            continue
        if x[1] - t.a[1] < join or x[1] > s.b[1] - join:
            continue
        verts, used = climb(t, steep, join, depth + 1, seen + (s,))
        up = (verts + [x], used + [s])
        tie = INK_GAP_LW * U.lw
        if up[0][0][1] < best[0][0][1] - tie or (abs(up[0][0][1] - best[0][0][1]) <= tie and len(up[0]) < len(best[0])):
            best = up
    return best


def poly_dist(p, line):
    """Distance from point p to polyline `line`."""
    best = math.inf
    for (ax, ay), (bx, by) in zip(line, line[1:]):
        dx, dy = bx - ax, by - ay
        t = max(0.0, min(1.0, ((p[0] - ax) * dx + (p[1] - ay) * dy) / ((dx * dx + dy * dy) or 1.0)))
        best = min(best, math.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy))
    return best


def clearance(P, lines):
    """Least distance from any point of P (n x 2 array) to any of the polylines `lines`."""
    best = math.inf
    for line in lines:
        for a, b in zip(line, line[1:]):
            a, b = np.asarray(a, float), np.asarray(b, float)
            d = b - a
            t = np.clip(((P - a) @ d) / ((d @ d) or 1.0), 0.0, 1.0)
            best = min(best, float(np.min(np.hypot(*(P - a - t[:, None] * d).T))))
    return best


def poly_x_at(line, row):
    """Column where polyline `line` crosses `row` (first crossing), or None."""
    for (ax, ay), (bx, by) in zip(line, line[1:]):
        if min(ay, by) <= row <= max(ay, by) and ay != by:
            return ax + (row - ay) * (bx - ax) / (by - ay)
    return None


def fill_poly(shape, poly):
    m = np.zeros(shape, np.uint8)
    cv2.fillPoly(m, [np.round(np.asarray(poly) * 8).astype(np.int32)], 1, shift=3)
    return m.astype(bool)


def closed_shapes(ink, box, close=True):
    """Small closed shapes in `box` of the image: background regions enclosed by ink ('hole': a box,
    a flap, a rib) and ink pieces that touch nothing else ('blob': a handle, a lamp ring). With
    `close`, thin lines are first closed by one pixel (the scan dithers them); that also fills a
    2 px gap between two lines, so a rib's narrow inside needs the raw ink. Each is (kind, x0, y0,
    x1, y1, mask of the bounding box, filled mask of the bounding box) in image px."""
    x0, y0, x1, y1 = box
    sub = ink[y0:y1, x0:x1]
    closed = sub | ndi.binary_closing(sub, structure=CROSS) if close else sub
    out = []
    for kind, lab in (("hole", ndi.label(~closed)[0]), ("blob", ndi.label(closed, structure=np.ones((3, 3)))[0])):
        for i, s in enumerate(ndi.find_objects(lab)):
            if s is None:
                continue
            ya, yb, xa, xb = s[0].start, s[0].stop, s[1].start, s[1].stop
            if ya == 0 or xa == 0 or yb == sub.shape[0] or xb == sub.shape[1]:
                continue
            m = lab[s] == i + 1
            if m.sum() < 6:
                continue
            out.append((kind, xa + x0, ya + y0, xb - 1 + x0, yb - 1 + y0, m, ndi.binary_fill_holes(m)))
    return out


def corner_radius(filled):
    """Corner radius (px) that explains the area a filled shape is short of its bounding box."""
    deficit = filled.size - filled.sum()
    return math.sqrt(max(0.0, deficit) / (4 - math.pi))


def side_details(sh, c, report):
    """Door and panel gaps, hinges, handles and flaps in the side view (see README.md, "Details").
    `c` holds the trace so far (scale, silhouette, windows, sill, wheels, arches). Every size is a
    fraction of the wheelbase or a multiple of the line width (U). Returns (seams [[px, py], ...]
    list, plates in mm, grooves in mm)."""
    mm, ground, y0p = c["mm"], c["ground"], c["y0_px"]
    H, W = sh.ink.shape
    yy, xx = np.mgrid[0:H, 0:W]

    def at(x0_, y0_, x1_, y1_):
        return {"y": [round((min(x0_, x1_) - y0p) * mm), round((max(x0_, x1_) - y0p) * mm)],
                "z": [round((ground - max(y0_, y1_)) * mm), round((ground - min(y0_, y1_)) * mm)]}

    sil = np.zeros((H, W), bool)
    so = c["s_org"]
    sil[so[1]:so[1] + c["S_raw"].shape[0], so[0]:so[0] + c["S_raw"].shape[1]] = c["S_raw"]
    glass = np.zeros((H, W), bool)
    for wd in c["windows"]:
        glass |= fill_poly((H, W), wd["outline"])
    glass = ndi.binary_dilation(glass, iterations=2)
    sill = np.full(W, -1.0)
    cols = np.arange(c["body_f"], c["body_r"] + 1)
    sill[cols] = [c["bottom_of"](x) for x in cols]
    discs = np.zeros((H, W), bool)
    for cx, cy, r in c["wheels"]:
        discs |= (xx - cx) ** 2 + (yy - cy) ** 2 <= (1.05 * r) ** 2
    body = sil & (yy <= sill[None, :] + INK_GAP_LW * U.lw) & ~discs & (xx >= c["body_f"]) & (xx <= c["body_r"])
    region = body & ~glass
    belt, shoulder = c["belt"], c["shoulder_row"]

    # ---- gaps: chains of straight lines from the belt (or higher) down to the sill
    pieces = line_pieces(sh, region)
    steep = [p for p in pieces if p.tilt() >= 45]
    join, sill_tol, end = JOIN_WB * U.wb, SILL_WB * U.wb, END_WB * U.wb
    near_lw = NEAR_LW * U.lw
    lower = float(np.median(sill[cols])) - belt   # sill to belt, px
    gaps, used = [], set()
    for s in sorted(steep, key=lambda p: p.b[0]):
        if abs(s.b[1] - c["bottom_of"](s.b[0])) > sill_tol:
            continue
        verts, chain = climb(s, steep, join)
        verts = verts + [s.b]
        top, bot = verts[0], verts[-1]
        where = at(min(v[0] for v in verts), top[1], max(v[0] for v in verts), bot[1])
        if top[1] > belt + 0.15 * lower:
            near = [t for t, o in c["arches"].items() if min(poly_dist(s.a, o), poly_dist(s.b, o)) < ARCH_NEAR_WB * U.wb]
            why = (f"follows the {near[0]} arch (the fender lip)" if near else
                   f"rises only to z={where['z'][1]}, under the belt: does not cross the side")
            report.drop("side", "gap", where, why)
            continue
        if min(v[0] for v in verts) < c["body_f"] + end or max(v[0] for v in verts) > c["body_r"] - end:
            report.drop("side", "gap", where, f"within {END_WB:.3f} wheelbase of the body's end: its corner line")
            continue
        gaps.append(verts)
        used |= {id(t) for t in chain}
    gap_lines = [simplify([tuple(v) for v in g]) for g in gaps]
    evid = [[f"{round(sum(np.hypot(*(np.asarray(b) - np.asarray(a))) for a, b in zip(g, g[1:])) * mm)} mm "
             f"of drawn line from z={round((ground - g[0][1]) * mm)} (belt or higher) to the sill, "
             f"{len(g) - 2} bend(s), outside the glass"] for g in gap_lines]
    for i, g in enumerate(gap_lines):  # the other edge of a pillar: a parallel gap a few line widths away
        pts = [(a[0] + (b[0] - a[0]) * k / 20, a[1] + (b[1] - a[1]) * k / 20) for a, b in zip(g, g[1:]) for k in range(20)]
        for j, h in enumerate(gap_lines):
            if i != j:
                d = [v for v in (poly_dist(p, h) for p in pts) if near_lw < v < 6 * near_lw]
                if len(d) >= 0.25 * len(pts):
                    evid[i].append(f"paired with gap {j} over {len(d) / len(pts):.0%} of it "
                                   f"({min(d) * mm:.0f}-{max(d) * mm:.0f} mm away)")
                    break
    for p in pieces:  # every other long line inside the body side
        if id(p) in used:
            continue
        where = at(p.a[0], p.a[1], p.b[0], p.b[1])
        if p.tilt() >= 45 and p.len >= 0.35 * lower:
            if any(poly_dist(p.a, g) < near_lw and poly_dist(p.b, g) < near_lw for g in gap_lines):
                continue
            if abs(p.b[1] - c["bottom_of"](p.b[0])) > sill_tol:
                fr = FRAME_NEAR_WB * U.wb
                frame = [i for i, wd in enumerate(c["windows"]) if poly_dist(p.a, wd["outline"] + wd["outline"][:1]) < fr
                         and poly_dist(p.b, wd["outline"] + wd["outline"][:1]) < fr]
                why = (f"window {frame[0]}'s frame" if frame else
                       f"ends at z={where['z'][0]}, {round((c['bottom_of'](p.b[0]) - p.b[1]) * mm)} mm above the sill")
                report.drop("side", "gap", where, why)
        elif p.tilt() <= 20 and p.len >= 0.4 * (c["body_r"] - c["body_f"]):
            row = (p.a[1] + p.b[1]) / 2
            if abs(row - c["bottom_of"]((p.a[0] + p.b[0]) / 2)) < 2 * near_lw:
                continue  # the sill line itself
            report.drop("side", "gap", where, f"level line along the body at z={round((ground - row) * mm)} (belt "
                        f"{round((ground - belt) * mm)}, shoulder {round((ground - shoulder) * mm)}): a crease, "
                        "moulding or roof line; door and panel gaps cross the side")

    # ---- closed shapes: hinges, handles, the flap
    bx0, by0, bx1, by1 = sh.boxes["side"]
    shapes = []
    in_glass = 0
    lo, hi = SHAPE_WB[0] * U.wb, SHAPE_WB[1] * U.wb
    for kind, xa, ya, xb, yb, m, f in closed_shapes(sh.ink, (bx0, by0, bx1, by1)):
        w, h = xb - xa + 1, yb - ya + 1
        if max(w, h) < lo or max(w, h) > hi:
            continue
        inside = body[ya:yb + 1, xa:xb + 1][m].mean()
        if inside < 0.9:
            continue
        if glass[ya:yb + 1, xa:xb + 1][m].mean() > 0.5:
            in_glass += 1   # a seat, a steering wheel or a wiper seen through the glass: never a detail
            continue
        shapes.append({"kind": kind, "box": (xa, ya, xb, yb), "w": w, "h": h, "m": m, "f": f,
                       "cx": (xa + xb) / 2, "cy": (ya + yb) / 2})
    report.notes.append(f"side: {in_glass} closed shapes inside the window glass ignored")

    def door_of(sp):
        """(front gap, rear gap) indices bracketing a shape at its centre row, or None."""
        xs = [(poly_x_at(g, sp["cy"]), i) for i, g in enumerate(gap_lines)]
        front = [(x, i) for x, i in xs if x is not None and x < sp["box"][0]]
        rear = [(x, i) for x, i in xs if x is not None and x > sp["box"][2]]
        if not front or not rear:
            return None
        return max(front)[1], min(rear)[1]

    long_lines = [[tuple(p.a), tuple(p.b)] for p in pieces if p.len >= LONG_LINE_WB * U.wb]
    off_gaps = [g for g in long_lines
                if not any(poly_dist(g[0], h) < near_lw and poly_dist(g[1], h) < near_lw for h in gap_lines)]

    def own_outline(sp, hinge=False):
        """Share of the shape's rim that lies off every long drawn line running on past the shape
        (a hinge or a flap has its own outline; a panel strip bounded by gaps and creases does not).
        A hinge sits on its gap, so for one the gap lines do not count."""
        xa, ya, xb, yb = sp["box"]
        pad = 2 * near_lw
        past = [g for g in (off_gaps if hinge else long_lines + gap_lines)
                if any(not (xa - pad <= x <= xb + pad and ya - pad <= y <= yb + pad) for x, y in g)]
        rim = np.argwhere(sp["f"] & ~ndi.binary_erosion(sp["f"]))
        if rim.size == 0:
            return 0.0
        return float(np.mean([min((poly_dist((x + xa, y + ya), g) for g in past), default=math.inf) > RIM_LW * U.lw
                              for y, x in rim[::2]]))

    def crossed(sp):
        """A gap line runs through the shape itself (its filled outline, not its bounding box: a
        slanted gap may pass a rounded corner of the box)."""
        xa, ya, xb, yb = sp["box"]
        f = sp["f"]
        for g in gap_lines:
            for r in range(ya, yb + 1):
                x = poly_x_at(g, r)
                if x is not None and xa <= x <= xb and f[r - ya, int(round(x)) - xa]:
                    return True
        return False

    hinge_lo, hinge_hi = HINGE_WB[0] * U.wb, HINGE_WB[1] * U.wb
    (hl_lo, hl_hi), (hh_lo, hh_hi) = [(a * U.wb, b * U.wb) for a, b in HANDLE_WB]
    hinges, handles, flaps = {}, [], []
    plates, grooves = [], []
    leftover, taken = [], []   # shapes that fit no kind; (kind, box) of every detail taken
    for sp in shapes:
        xa, ya, xb, yb = sp["box"]
        where = at(xa, ya, xb, yb)
        fill = sp["f"].sum() / sp["f"].size
        size = f"{round(sp['w'] * mm)} x {round(sp['h'] * mm)} mm"
        if sp["kind"] == "hole" and hinge_lo <= min(sp["w"], sp["h"]) and max(sp["w"], sp["h"]) <= hinge_hi:
            # the gap line passes through the box (a hinge straddles its door's edge)
            on = sorted((poly_dist((sp["cx"], sp["cy"]), g), i) for i, g in enumerate(gap_lines)
                        if (lambda x: x is not None and xa - near_lw <= x <= xb + near_lw)(poly_x_at(g, sp["cy"])))
            own = own_outline(sp, hinge=True)
            if fill < 0.75 or max(sp["w"], sp["h"]) > 2 * min(sp["w"], sp["h"]):
                report.drop("side", "hinge", where, f"{size}, not a box (fills {fill:.0%} of its bounds)")
            elif own < 0.6:
                report.drop("side", "hinge", where, f"{size} panel strip between long lines ({own:.0%} own outline)")
            elif not on:
                report.drop("side", "hinge", where, f"{size} box on no door gap")
            elif sp["cy"] > sill[int(sp["cx"])] or sp["cy"] < belt:
                report.drop("side", "hinge", where, f"{size} box outside the belt-to-sill band")
            else:
                hinges.setdefault(on[0][1], []).append((sp, on[0][0]))
            continue
        if sp["kind"] == "blob" and sp["w"] >= sp["h"] and hl_lo <= sp["w"] <= hl_hi and hh_lo <= sp["h"] <= hh_hi:
            door = door_of(sp)
            if sp["w"] < 2.5 * sp["h"]:
                report.drop("side", "handle", where, f"{size}, not elongated")
            elif (sp["f"].sum() - sp["m"].sum()) < 3 * U.lw:
                report.drop("side", "handle", where, f"{size}, not a closed outline")
            elif not (belt < sp["cy"] < shoulder + 0.5 * (shoulder - belt)):
                report.drop("side", "handle", where, f"{size}, not at belt height")
            elif door is None:
                report.drop("side", "handle", where, f"{size}, not between two door gaps")
            else:
                handles.append((sp, door))
            continue
        if sp["kind"] == "hole" and FLAP_WB[0] * U.wb <= min(sp["w"], sp["h"]) and max(sp["w"], sp["h"]) <= FLAP_WB[1] * U.wb:
            # a flap: a closed rounded shape of its own inside the side, under the belt, clear of the
            # windows (only body pixels count), the wheels and every gap
            own = own_outline(sp)
            rad = corner_radius(sp["f"]) * mm
            if own < 0.7:
                report.drop("side", "flap", where, f"{size} panel bounded by long lines ({own:.0%} own outline)")
            elif fill < 0.75 or rad < 0.1 * min(sp["w"], sp["h"]) * mm:
                report.drop("side", "flap", where, f"{size}, not a rounded closed shape (fill {fill:.0%}, corner {rad:.0f} mm)")
            elif sp["cy"] < belt:
                report.drop("side", "flap", where, f"{size} rounded shape above the belt")
            elif crossed(sp):
                report.drop("side", "flap", where, f"{size} rounded shape crossed by a gap")
            else:
                flaps.append((sp, own, rad))
            continue
        what = "round" if sp["kind"] == "blob" and 0.8 < sp["w"] / sp["h"] < 1.25 else sp["kind"]
        sheet = [it.get("role", key[:-1]) for key in ("lamps", "plates") for it in c["extras"].get(key, [])
                 if it.get("face") == "side" and min(it["y"]) < where["y"][1] and max(it["y"]) > where["y"][0]
                 and min(it["z"]) < where["z"][1] and max(it["z"]) > where["z"][0]]
        leftover.append((sp, where, f"{size} closed {what} fits no detail kind (door: {'yes' if door_of(sp) else 'no'})"
                         + (f"; the sheet's extras give a {sheet[0]} here" if sheet else "")))

    for gi, hs in sorted(hinges.items()):
        for sp, dist in hs:
            xa, ya, xb, yb = sp["box"]
            where = at(xa - 1, ya - 1, xb + 1, yb + 1)
            if len(hs) < 2:
                report.drop("side", "hinge", where, f"lone box on gap {gi}: a door hangs on two hinges")
                continue
            plates.append({"face": "side", **where, **HINGE_STYLE})
            taken.append(("hinge", sp["box"]))
            report.take("side", "hinge", where, f"{round(sp['w'] * mm)} x {round(sp['h'] * mm)} mm box on gap {gi} "
                        f"({dist * mm:.0f} mm from it), {len(hs)} on that gap")
            evid[gi].append("hinge")
    for sp, door in handles:
        xa, ya, xb, yb = sp["box"]
        where = at(xa, ya, xb, yb)
        mates = [o for o, d in handles if o is not sp and d != door and abs(o["cy"] - sp["cy"]) <= near_lw
                 and abs(o["w"] - sp["w"]) <= 0.15 * sp["w"]]
        if len(handles) > 1 and not mates:
            report.drop("side", "handle", where, "other handle candidates, none on its row on another door")
            continue
        plates.append({"face": "side", **where, **HANDLE_STYLE})
        taken.append(("handle", sp["box"]))
        report.take("side", "handle", where, f"isolated closed outline {round(sp['w'] * mm)} x {round(sp['h'] * mm)} mm "
                    f"between gaps {door[0]} and {door[1]}; "
                    + (f"{len(mates)} handle(s) on other doors on the same row" if mates else "the only handle candidate"))
    gaps_mm = [[((x - y0p) * mm, (ground - y) * mm) for x, y in g] for g in gap_lines]
    need = FLAP_STYLE["width"] / 2 + GAP_HALF_MM + LAYOUT_CLEAR_MM + 1.0
    reach = int(round(SHIFT_WB * U.wb * mm))
    for sp, own, rad in flaps:
        xa, ya = sp["box"][:2]
        cs, _ = cv2.findContours(ndi.binary_dilation(np.pad(sp["f"], 1), iterations=1).astype(np.uint8),
                                 cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        poly = cv2.approxPolyDP(max(cs, key=len), SIMPLIFY, True).reshape(-1, 2) + [xa - 1, ya - 1]
        line = [((x - y0p) * mm, (ground - y) * mm) for x, y in poly]
        where = at(sp["box"][0], sp["box"][1], sp["box"][2], sp["box"][3])
        # carforge keeps a flap's groove LAYOUT_CLEAR clear of every gap's groove. A flap drawn closer
        # than that (its grooves are wider than drawn lines) gets the least change that clears: moved
        # along the car, and only if that is not enough also shrunk about its centre (both reported)
        P = np.array([(a[0] + (b[0] - a[0]) * k / 8, a[1] + (b[1] - a[1]) * k / 8)
                      for a, b in zip(line, line[1:] + line[:1]) for k in range(8)])
        ctr = (P.min(axis=0) + P.max(axis=0)) / 2
        drawn = clearance(P, gaps_mm)
        fit = None
        for scale in np.arange(1.0, FLAP_SHRINK - 1e-9, -0.01):
            Q = ctr + (P - ctr) * scale
            shift = next((s for s in sorted(range(-reach, reach + 1), key=abs)
                          if clearance(Q + [s, 0], gaps_mm) >= need), None)
            if shift is not None:
                fit = (float(scale), shift)
                break
        if fit is None:
            report.drop("side", "flap", where, f"drawn {drawn:.0f} mm from a gap's centre line; no shift within "
                        f"{reach} mm or shrink to {FLAP_SHRINK:.0%} keeps {need - 1:.0f} mm from every gap")
            continue
        scale, shift = fit
        grooves.append({"face": "side", "line": [[round(ctr[0] + (y - ctr[0]) * scale + shift),
                                                  round(ctr[1] + (z - ctr[1]) * scale)] for y, z in line],
                        "closed": True, **FLAP_STYLE})
        taken.append(("flap", sp["box"]))
        moved = "" if (scale, shift) == (1.0, 0) else (
            f"; drawn {drawn:.0f} mm from a gap's centre line, so moved {shift:+d} mm along y"
            + (f" and shrunk to {scale:.0%}" if scale < 1.0 else "")
            + f" to keep carforge's {LAYOUT_CLEAR_MM} mm paint between its groove and the gaps'")
        report.take("side", "flap", where, f"closed rounded outline {round(sp['w'] * mm)} x {round(sp['h'] * mm)} mm "
                    f"(corner {rad:.0f} mm, {own:.0%} its own line) under the belt, clear of windows, wheels and gaps"
                    + moved)
    for sp, where, why in leftover:
        xa, ya, xb, yb = sp["box"]
        part = [k for k, (ta, tb, tc, td) in taken if ta <= xa and xb <= tc and tb <= ya and yb <= td]
        report.drop("side", "shape", where, f"part of the {part[0]} taken around it" if part else why)
    for i, g in enumerate(gap_lines):
        n_h = evid[i].count("hinge")
        ev = [e for e in evid[i] if e != "hinge"] + ([f"{n_h} hinges on it"] if n_h else [])
        report.take("side", "gap", {"line": [[round((x - y0p) * mm), round((ground - y) * mm)] for x, y in g]},
                    f"gap {i}: " + "; ".join(ev))
    return [[[r1(x), r1(y)] for x, y in g] for g in gap_lines], plates, grooves


def lamp_rings(sh, box):
    """Well-inked circles in `box`: candidates from cv2.HoughCircles and from round closed shapes
    (a ring's inside: square bounds, filling about pi/4 of them), each refitted on the ink's distance
    map; kept when inked round LAMP_COVER of it; per centre the outermost ring. [(cx, cy, r)] px."""
    x0, y0, x1, y1 = box
    sub = np.where(sh.ink[y0:y1, x0:x1], 0, 255).astype(np.uint8)
    r_lo, r_hi = LAMP_WB[0] * U.wb, LAMP_WB[1] * U.wb
    found = cv2.HoughCircles(cv2.GaussianBlur(sub, (3, 3), 0.8), cv2.HOUGH_GRADIENT_ALT, dp=1, minDist=2,
                             param1=150, param2=0.6, minRadius=max(2, int(r_lo / 2)), maxRadius=int(r_hi))
    seeds = [(cx + x0, cy + y0, r) for cx, cy, r in ([] if found is None else found[0])]
    for kind, xa, ya, xb, yb, m, f in closed_shapes(sh.ink, box):
        w, h = xb - xa + 1, yb - ya + 1
        if kind == "hole" and 0.8 <= w / h <= 1.25 and 0.65 <= f.sum() / f.size <= 0.9:
            seeds.append(((xa + xb) / 2, (ya + yb) / 2, (w + h) / 4 + 0.5))
    rings = []
    for cx, cy, r in seeds:
        f = fit_ring(sh.dist, float(cx), float(cy), float(r))
        # the outermost well-inked ring about this centre (a lens ring inside a rim ring)
        rs = [rr for rr in np.arange(f[2], 1.6 * f[2], 0.5) if ring_cover(sh.dist, f[0], f[1], rr) >= LAMP_COVER]
        if rs:
            f = fit_ring(sh.dist, f[0], f[1], max(rs))
        if r_lo <= f[2] <= r_hi and ring_cover(sh.dist, *f) >= LAMP_COVER \
                and ring_cost(sh.dist, *f) <= 0.25:
            rings.append(f)
    out = []
    for ring in sorted(rings, key=lambda t: -t[2]):  # concentric rings (rim, lens) collapse on the outermost
        if not any(math.hypot(ring[0] - o[0], ring[1] - o[1]) < 0.3 * o[2] for o in out):
            out.append(ring)
    return out


def hatched(sh, box):
    """Hatched closed shapes in `box` (grille openings): regions where the ink is dense and full of
    tiny enclosed cells (at most HATCH_CELL_WB of the wheelbase squared, over a window HATCH_WINDOW_WB
    wide). [(x_left, x_right, row_top, row_bottom, corner radius px, cell share)]: the extents run out
    to the shape's outline through the hatching."""
    x0, y0, x1, y1 = box
    sub = sh.ink[y0:y1, x0:x1]
    lab, n = ndi.label(~sub)
    size = ndi.sum(np.ones_like(lab), lab, index=np.arange(n + 1))
    tiny = (size[lab] <= (HATCH_CELL_WB * U.wb) ** 2) & (lab > 0)
    win = max(3, int(round(HATCH_WINDOW_WB * U.wb)))
    cells = ndi.uniform_filter(tiny.astype(float), size=win)
    dense = ndi.uniform_filter(sub.astype(float), size=win)
    hl, hn = ndi.label((cells >= HATCH_CELLS) & (dense >= 0.35))
    M = sub | tiny

    def reach(v, k, step):
        last, miss = k, 0
        while 0 <= k + step < len(v):
            k += step
            if v[k]:
                last, miss = k, 0
            else:
                miss += 1
                if miss > INK_GAP_LW * U.lw / 2:
                    break
        return last

    out = []
    for i in range(1, hn + 1):
        comp = hl == i
        if comp.sum() < HATCH_AREA_WB2 * U.wb ** 2:
            continue
        rows = np.flatnonzero(comp.any(axis=1))
        cols = np.flatnonzero(comp.any(axis=0))
        mid_r = rows[len(rows) // 4: 3 * len(rows) // 4 + 1]
        mid_c = cols[len(cols) // 6: 5 * len(cols) // 6 + 1]
        left = np.median([reach(M[r], np.flatnonzero(comp[r])[0], -1) for r in mid_r])
        right = np.median([reach(M[r], np.flatnonzero(comp[r])[-1], 1) for r in mid_r])
        top = np.median([reach(M[:, k], np.flatnonzero(comp[:, k])[0], -1) for k in mid_c])
        bot = np.median([reach(M[:, k], np.flatnonzero(comp[:, k])[-1], 1) for k in mid_c])
        shape = np.zeros((int(bot - top) + 1, int(right - left) + 1), bool)
        for r in range(int(top), int(bot) + 1):  # the opening's row extents, for its corner radius
            cs = np.flatnonzero(comp[r, int(left):int(right) + 1])
            if cs.size:
                a = reach(M[r], int(left) + cs[0], -1) - int(left)
                b = reach(M[r], int(left) + cs[-1], 1) - int(left)
                shape[r - int(top), max(0, a):b + 1] = True
        out.append((left + x0, right + x0, top + y0, bot + y0, corner_radius(shape),
                    float(cells[comp].mean())))
    return out


def front_details(sh, c, report):
    """Grille openings and round lamps in the front view (see README.md). Returns (recesses in mm,
    lamps in px circle form)."""
    mm, ground, x0p = c["mm"], c["ground"], c["x0_px"]
    MIRROR_PX = NEAR_LW * U.lw  # noqa: N806 (a mirrored pair's centre may sit this far off the axis)
    box = sh.boxes["front"]
    belt = c["belt"]
    bumper_row = ground - max((max(b["z"]) for b in c["bumpers"] if max(b["y"]) <= 0), default=0) / mm
    H, W = sh.ink.shape
    sil = np.zeros((H, W), bool)
    fo = c["f_org"]
    sil[fo[1]:fo[1] + c["F_raw"].shape[0], fo[0]:fo[0] + c["F_raw"].shape[1]] = c["F_raw"]

    def at_box(xa, xb, ya, yb):
        return {"x": [round((xa - x0p) * mm), round((xb - x0p) * mm)],
                "z": [round((ground - yb) * mm), round((ground - ya) * mm)]}

    def band(row):
        """Why a row is not on the body's face between the bumper and the belt, or None."""
        if row < belt:
            return "above the belt (seen through the windscreen)"
        if row > bumper_row:
            return "below the bumper's top (chassis)"
        return None

    rings = lamp_rings(sh, box)
    grilles = []
    for left, right, top, bot, rad, share in hatched(sh, box):
        where = at_box(left, right, top, bot)
        cx = (left + right) / 2
        why = band(top) or band(bot)
        if why:
            report.drop("front", "grille", where, f"hatched shape {why}")
        elif abs(cx - x0p) > MIRROR_PX:
            report.drop("front", "grille", where, f"hatched shape off the centre line by {(cx - x0p) * mm:.0f} mm")
        elif not sil[int((top + bot) / 2), int(cx)]:
            report.drop("front", "grille", where, "hatched shape outside the body")
        else:
            grilles.append((left, right, top, bot, rad, share))
    pairs = []
    taken = set()
    for i, a in enumerate(rings):
        for j, b in enumerate(rings):
            if j <= i or i in taken or j in taken:
                continue
            if abs((a[0] + b[0]) / 2 - x0p) <= MIRROR_PX and abs(a[1] - b[1]) <= MIRROR_PX \
                    and abs(a[2] - b[2]) <= 0.1 * max(a[2], b[2]) and abs(a[0] - x0p) > a[2]:
                pairs.append((a, b) if a[0] > b[0] else (b, a))
                taken |= {i, j}
    for i, a in enumerate(rings):
        if i not in taken:
            why = band(a[1]) or ("inside a grille's hatching" if any(
                g[0] <= a[0] <= g[1] and g[2] <= a[1] <= g[3] for g in grilles) else "no mirrored partner")
            report.drop("front", "lamp", at_box(a[0] - a[2], a[0] + a[2], a[1] - a[2], a[1] + a[2]),
                        f"ring r={a[2] * mm:.0f} mm: {why}")
    ok = []
    for left, right in pairs:
        where = at_box(left[0] - left[2], left[0] + left[2], left[1] - left[2], left[1] + left[2])
        why = band(left[1] - left[2]) or band(left[1] + left[2])
        if why:
            report.drop("front", "lamp", where, f"mirrored rings r={left[2] * mm:.0f} mm {why}")
        elif not sil[int(left[1]), int(left[0])]:
            report.drop("front", "lamp", where, "mirrored rings outside the body")
        else:
            ok.append((left, right))
    ok.sort(key=lambda p: -p[0][2])
    lamps = []
    for k, (left, right) in enumerate(ok):
        where = at_box(left[0] - left[2], left[0] + left[2], left[1] - left[2], left[1] + left[2])
        ev = (f"ring r={left[2] * mm:.0f} mm inked {ring_cover(sh.dist, *left):.0%} round, mirrored "
              f"{abs(left[0] + right[0] - 2 * x0p) / 2 * mm:.0f} mm off, rows {abs(left[1] - right[1]) * mm:.0f} mm apart")
        if k == 0:
            role, style = "headlights", HEADLAMP_STYLE
        elif left[2] < 0.75 * ok[0][0][2]:
            role, style = "leftblinkers", BLINKER_STYLE
        else:
            report.drop("front", "lamp", where, "a second pair of headlamp size: not a known lamp")
            continue
        if role == "leftblinkers" and any(lp["role"] == "leftblinkers" for lp in lamps):
            report.drop("front", "lamp", where, "a second pair of small rings: one blinker pair only")
            continue
        lamps.append({"role": role, "face": "front", **style, "circle": [r1(left[0]), r1(left[1]), r1(left[2])]})
        report.take("front", role, where, ev)
    recesses = []
    heads = [lp for lp in lamps if lp["role"] == "headlights"]
    for left, right, top, bot, rad, share in grilles:
        where = at_box(left, right, top, bot)
        if heads and right - x0p >= heads[0]["circle"][0] - x0p - heads[0]["circle"][2] + MIRROR_PX:
            report.drop("front", "grille", where, "reaches past the headlamps")
            continue
        half = (right - left) / 2 * mm
        hgt = (bot - top) * mm
        bars = max(0, round(2 * half / GRILLE_BARS["pitch"]) - 1)
        recesses.append({"face": "front", "x": [-round(half), round(half)], "z": where["z"],
                         "radius": round(min(rad * mm, hgt / 2)), **GRILLE_STYLE,
                         "bars": {"count": bars, "width": GRILLE_BARS["width"], "cell": GRILLE_BARS["cell"]}})
        report.take("front", "grille", where, f"hatched closed shape ({share:.0%} tiny cells), centred "
                    f"{((left + right) / 2 - x0p) * mm:.0f} mm off the centre line, between the headlamps; "
                    f"corner {min(rad * mm, hgt / 2):.0f} mm")
    return recesses, lamps


def top_ribs(sh, c, report):
    """Bonnet ribs in the top view (see README.md). Returns `lines` in mm (face top)."""
    mm, top_x0, y0p = c["mm"], c["top_x0"], c["y0_px"]
    box = sh.boxes["top"]
    rib_len, rib_wide = RIB_WB[0] * U.wb, RIB_WB[1] * U.wb   # px: shortest length, widest
    near = NEAR_LW * U.lw                                   # a mirrored partner, a matching end
    cowl = min(min(p[0] for p in c["windows"][0]["outline"]), c["body_r"])
    # thin level holes; a rib's inside is cut by every axis or dimension line crossing it, so holes
    # on one row (half a line width) with at most two line widths (a crossing line) between them are one
    thin = sorted((xa, xb, ya, yb, int(m.sum())) for kind, xa, ya, xb, yb, m, f in closed_shapes(sh.ink, box, close=False)
                  if kind == "hole" and (yb - ya + 1) <= rib_wide * 2 and xb >= c["body_f"] and xa <= cowl
                  and xb - xa + 1 >= 3 * (yb - ya + 1))
    runs_ = []  # [x0, x1, row0, row1, inside area, inside length]
    for xa, xb, ya, yb, area in thin:
        for r in runs_:
            if abs((r[2] + r[3]) / 2 - (ya + yb) / 2) <= near / 2 and 0 <= xa - r[1] <= 2.5 * near:
                r[1], r[2], r[3] = xb, min(r[2], ya), max(r[3], yb)
                r[4] += area
                r[5] += xb - xa + 1
                break
        else:
            runs_.append([xa, xb, ya, yb, area, xb - xa + 1])
    cands = []
    for xa, xb, ya, yb, area, length in runs_:
        w, h = xb - xa + 1, yb - ya + 1
        if w < SHAPE_WB[0] * U.wb:
            continue
        where = {"y": [round((xa - y0p) * mm), round((xb - y0p) * mm)],
                 "x": [round((ya - top_x0) * mm), round((yb - top_x0) * mm)]}
        if w < rib_len or h > rib_wide:
            report.drop("top", "rib", where, f"{round(w * mm)} x {round(h * mm)} mm: not a long thin rib")
            continue
        if xb > cowl:
            report.drop("top", "rib", where, "runs past the bonnet (under the windscreen)")
            continue
        cands.append((xa, xb, (ya + yb) / 2, area / length, where))
    lines, taken = [], set()
    for i, a in enumerate(cands):
        for j, b in enumerate(cands):
            if j <= i or i in taken or j in taken:
                continue
            if abs((a[2] + b[2]) / 2 - top_x0) <= near and abs(a[0] - b[0]) <= 1.5 * near and abs(a[1] - b[1]) <= 1.5 * near:
                taken |= {i, j}
                low = a if a[2] > b[2] else b
                width = round((low[3] + U.lw) * mm)  # between the two drawn edges' centres
                x = round((low[2] - top_x0) * mm)
                lines.append({"face": "top", "line": [[round((low[0] - y0p) * mm), x], [round((low[1] - y0p) * mm), x]],
                              "width": width})
                report.take("top", "rib", low[4], f"thin closed outline {round((low[1] - low[0]) * mm)} mm long, "
                            f"mirrored {abs(a[2] + b[2] - 2 * top_x0) / 2 * mm:.0f} mm off the centre row")
    for i, a in enumerate(cands):
        if i not in taken:
            report.drop("top", "rib", a[4], "no mirrored partner")
    if lines:  # the centre rib is drawn solid on the centre line: a thick band over the pairs' span
        xa = int(np.median([p[0] for k, p in enumerate(cands) if k in taken]))
        xb = int(np.median([p[1] for k, p in enumerate(cands) if k in taken]))
        r = int(round(top_x0))
        closed = sh.ink | ndi.binary_closing(sh.ink, structure=CROSS)

        def thick(cols_):
            out = []
            for x in cols_:
                rr = run_through(closed[:, x], r)
                out.append(0 if rr is None else rr[1] - rr[0] + 1)
            return np.array(out)

        on = thick(range(xa, xb + 1))
        beyond = thick(range(xb + int(2.5 * near), xb + int(12.5 * near)))   # behind the ribs: the bare centre line
        span = np.flatnonzero(on >= 2 * near)
        where = {"y": [round((xa - y0p) * mm), round((xb - y0p) * mm)], "x": [0, 0]}
        if span.size >= 0.9 * on.size and np.median(on) <= rib_wide and np.median(beyond) <= 1.5 * near:
            lines.append({"face": "top", "line": [[where["y"][0], 0], [where["y"][1], 0]],
                          "width": int(np.median([ln["width"] for ln in lines])), "single": True})
            report.take("top", "rib", where, f"band {np.median(on) * mm:.0f} mm thick on the centre row over "
                        f"{span.size / on.size:.0%} of the paired ribs' span, {np.median(beyond) * mm:.0f} mm behind it")
        else:
            report.drop("top", "rib", where, f"centre row {np.median(on) * mm:.0f} mm thick over "
                        f"{span.size / max(1, on.size):.0%} of the paired ribs' span, {np.median(beyond) * mm:.0f} mm "
                        "behind it: not a rib of its own")
    return lines


def lip_flare(outline_px, bottom_of, mm, lip, flare, taper=80.0, chamfer=45.0):
    """How far (mm) carforge's arch lip stands out past plan.low, per side-view column: the lip
    rises from 1 mm at `lip` mm out from the opening's edge to `flare` mm at the edge, its flare run
    out over `taper` mm of the outline at both ends, the outline cut above the sill chamfer
    (carforge's ARCH_LIP_TAPER and SILL_CHAMFER). {column: mm}."""
    pts = [((x, y), (x, bottom_of(x))) for x, y in outline_px]
    keep = [(x, y) for (x, y), (_, b) in pts if (b - y) * mm >= chamfer + 2.0]
    if len(keep) < 2:
        return {}
    dense = []
    for (xa, ya), (xb, yb) in zip(keep, keep[1:]):
        n = max(1, int(math.hypot(xb - xa, yb - ya) * mm / 2.0))
        dense += [(xa + (xb - xa) * k / n, ya + (yb - ya) * k / n) for k in range(n)]
    dense.append(keep[-1])
    arc = [0.0]
    for (xa, ya), (xb, yb) in zip(dense, dense[1:]):
        arc.append(arc[-1] + math.hypot(xb - xa, yb - ya) * mm)
    out = {}
    for i, (x, y) in enumerate(dense):
        (xa, ya), (xb, yb) = dense[max(i - 1, 0)], dense[min(i + 1, len(dense) - 1)]
        tl = math.hypot(xb - xa, yb - ya) or 1.0
        nx = (yb - ya) / tl  # away from the opening, in columns (rows grow down; carforge's -tz)
        f = flare * min(1.0, min(arc[i], arc[-1] - arc[i]) / taper)
        for k in range(0, int(lip) + 1, 2):
            col = int(round(x + nx * k / mm))
            out[col] = max(out.get(col, 0.0), f + (1.0 - f) * k / lip)
    return out



# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sheet")
    ap.add_argument("out")
    a = ap.parse_args()
    sh = Sheet(a.sheet)
    sd = sh.d
    extras = sd.get("extras", {})

    # 1. wheels on the raw scan, level them, refit them on the levelled scan
    wheels = find_wheels(sh)
    (fx, fy, _), (bx, by, _) = wheels
    deg = math.degrees(math.atan2(by - fy, bx - fx))
    if abs(deg) > 0.02:
        sh.set_rotation(deg, (fx, fy))
        wheels = [fit_ring(sh.dist, *rot_point((cx, cy), -deg, (fx, fy)), r) for cx, cy, r in wheels]
    (fx, fy, fr), (bx, by, br) = wheels
    hub_row = (fy + by) / 2
    tyre_r = (fr + br) / 2
    mm = sd["wheelbase_mm"] / (bx - fx)
    sh.mm = mm
    ground = hub_row + tyre_r
    y0_px = fx
    clip = hub_row + 0.75 * tyre_r

    bumpers_px = []  # side-view boxes of the extras bumpers: (x0, x1, row_top, row_bottom)
    for bp in extras.get("bumpers", []):
        bumpers_px.append((y0_px + min(bp["y"]) / mm, y0_px + max(bp["y"]) / mm,
                           ground - max(bp["z"]) / mm, ground - min(bp["z"]) / mm))

    # 2. side silhouette
    S_raw, s_org = silhouette(sh.ink, sh.boxes["side"], clip)
    S = opened(S_raw, OPEN_PX)
    tops = column_tops(S, s_org)
    height = ground - tops
    roof_row = float(np.nanmin(tops))
    car_h = ground - roof_row

    # 3. top view: centre row, plan
    plan_low = plan_high = None
    top_x0 = None
    if "top" in sh.boxes:
        T_raw, t_org = silhouette(sh.ink, sh.boxes["top"])
        T = opened(T_raw, OPEN_PX)
        mids = [(np.flatnonzero(T[:, j])[[0, -1]].mean()) for j in range(T.shape[1]) if T[:, j].any()]
        cr = int(round(float(np.median(mids))))
        top_x0 = cr + t_org[1]
        hw = np.zeros(T.shape[1])
        for j in range(T.shape[1]):
            rr = run_through(T[:, j], cr)
            if rr:
                hw[j] = ((cr - rr[0]) + (rr[1] - cr)) / 2
        low = grey_open(hw, MIRROR_MM / mm)
        tink = ndi.binary_dilation(sh.ink[t_org[1]:t_org[1] + T.shape[0], t_org[0]:t_org[0] + T.shape[1]], iterations=1)
        D = int(low.max()) + 2
        sym = np.stack([tink[cr - d] & tink[cr + d] for d in range(D)])
        high = np.zeros_like(low)
        for j in range(len(low)):
            if low[j] <= 0:
                continue
            ds = [d for d in range(int(0.6 * low[j]), int(low[j] - 6) + 1) if sym[d, j]]
            high[j] = max(ds) if ds else low[j]
        high = np.minimum(grey_open(high, MIRROR_MM / mm), low)
        plan_cols = np.arange(T.shape[1]) + t_org[0]
        plan_low, plan_high = (plan_cols, low), (plan_cols, high)

    # 4. body ends
    s_cols = np.arange(S.shape[1]) + s_org[0]
    ok = np.nan_to_num(height) >= 0.5 * car_h
    if plan_low is not None:
        wide = np.interp(s_cols, plan_low[0], plan_low[1], left=0, right=0) >= 0.6 * plan_low[1].max()
        ok &= wide
    mid = int(round((fx + bx) / 2)) - s_org[0]
    rr = run_through(ok, mid)
    if rr is None:
        fail("side view: no body run between the wheels")
    body_f, body_r = rr[0] + s_org[0], rr[1] + s_org[0]
    for bx0, bx1, _, _ in bumpers_px:
        if bx1 <= fx:
            body_f = max(body_f, int(math.ceil(bx1)))
        elif bx0 >= bx:
            body_r = min(body_r, int(math.floor(bx0)))
    cols = np.arange(body_f, body_r + 1)

    # side.top: thin spikes off
    h_body = ground - tops[cols - s_org[0]]
    h_body = grey_open(h_body, SPIKE_MM / mm)
    top_line = simplify([(c, ground - hh) for c, hh in zip(cols, h_body)])

    # side.bottom
    bcols, bvals = bottom_line(sh, S, s_org, cols, wheels, bumpers_px)

    def bottom_of(c):
        return float(np.interp(c, bcols, bvals))

    bottom = simplify([(c, v) for c, v in zip(bcols, bvals)])
    if bottom[0][0] > body_f:
        bottom.insert(0, (float(body_f), bottom_of(body_f)))
    if bottom[-1][0] < body_r:
        bottom.append((float(body_r), bottom_of(body_r)))

    # windows -> belt, glass_top
    windows = find_windows(sh, S_raw, s_org, roof_row, ground)
    if not windows:
        fail("side view: no windows found")
    belt = float(np.median([max(p[1] for p in wd["outline"]) for wd in windows]))
    glass_top = float(np.median([min(p[1] for p in wd["outline"]) for wd in windows]))
    for i, wd in enumerate(windows):  # an edge slanted like a pillar follows that pillar
        o = wd["outline"]
        topy, boty = min(p[1] for p in o), max(p[1] for p in o)
        ft = min(p[0] for p in o if p[1] < (topy + boty) / 2)
        fb = min(p[0] for p in o if p[1] >= (topy + boty) / 2)
        rt = max(p[0] for p in o if p[1] < (topy + boty) / 2)
        rb = max(p[0] for p in o if p[1] >= (topy + boty) / 2)
        if i == 0 and ft - fb > 3:
            wd["pillar"] = "a"
        elif i == len(windows) - 1 and rb - rt > 3:
            wd["pillar"] = "c"

    # 5. front view: centre, track, tumblehome, shoulder
    x0_px = None
    track = None
    tumble = [[belt, 1.0], [glass_top, 1.0]]
    shoulder_row = belt + 0.15 * (ground - belt)  # no front view: a little under the belt
    front_check = {}
    if "front" in sh.boxes:
        F_raw, f_org = silhouette(sh.ink, sh.boxes["front"], clip)
        F = opened(F_raw, OPEN_PX)
        tyres = front_wheels(sh.ink, sh.boxes["front"], hub_row, tyre_r)
        if tyres:
            x0_px = (tyres[0] + tyres[1]) / 2
            track = (tyres[1] - tyres[0]) * mm
        else:
            cols_f = np.flatnonzero(F.any(axis=0))
            x0_px = (cols_f[0] + cols_f[-1]) / 2 + f_org[0]
        cc = int(round(x0_px)) - f_org[0]
        fhw = np.zeros(F.shape[0])
        for i in range(F.shape[0]):
            rr = run_through(F[i], cc)
            if rr:
                fhw[i] = ((cc - rr[0]) + (rr[1] - cc)) / 2
        fhw = grey_open(fhw, FRONT_SPIKE_MM / mm)

        def fhw_at(row):
            return float(np.interp(row - f_org[1], np.arange(len(fhw)), fhw))

        hb = fhw_at(belt)
        prof = []
        row = belt
        while row > roof_row:
            f = fhw_at(row) / hb
            if f < 0.9:
                break
            prof.append((row, fhw_at(row)))
            row -= 2
        prof = simplify(prof, 0.8)
        tumble = [[r1(p[0]), round(p[1] / hb, 3)] for p in prof]
        below = [(r, fhw_at(r)) for r in np.arange(belt, clip, 1.0)]
        widest = max(v for _, v in below)
        shoulder_row = next(r for r, v in below if v >= hb + 0.5 * (widest - hb))
        if plan_high is not None:  # the top view sees the roof gutter, which stands out past the glass
            plan_high = (plan_high[0], np.minimum(plan_high[1], hb))
        front_check = {"belt_hw_mm": round(hb * mm), "widest_hw_mm": round(widest * mm),
                       "roof_row": r1(f_org[1] + np.flatnonzero(fhw > 0)[0])}

    # rear view (optional): only its centre column, the anchor compare.py --view rear needs
    rear_x0 = None
    if "rear" in sh.boxes:
        tyres = front_wheels(sh.ink, sh.boxes["rear"], hub_row, tyre_r)
        if tyres:
            rear_x0 = (tyres[0] + tyres[1]) / 2
        else:
            R_raw, r_org = silhouette(sh.ink, sh.boxes["rear"], clip)
            cols_r = np.flatnonzero(opened(R_raw, OPEN_PX).any(axis=0))
            rear_x0 = (cols_r[0] + cols_r[-1]) / 2 + r_org[0]

    # 6. arches
    arches = {}
    for tag, wheel in (("front", wheels[0]), ("rear", wheels[1])):
        pts = find_arch(sh, wheel, bottom_of)
        if pts:
            arches[tag] = {**extras.get("arches", {}).get(tag, {}), "outline": [[r1(x), r1(y)] for x, y in pts]}

    # 7. details drawn on the views (side gaps, hinges, handles, flap; front grilles and lamps;
    # top bonnet ribs), on strong evidence only; the rest goes to the trace report
    # the drawing's own units for the relative detail rules: px per wheelbase, line width px
    U.wb = float(np.hypot(wheels[1][0] - wheels[0][0], wheels[1][1] - wheels[0][1]))
    U.lw = stroke_width(sh.ink, sh.boxes["side"])
    found = Report()
    ctx = {"mm": mm, "ground": ground, "y0_px": y0_px, "x0_px": x0_px, "top_x0": top_x0,
           "s_org": s_org, "S_raw": S_raw, "windows": windows, "wheels": wheels, "bottom_of": bottom_of,
           "body_f": body_f, "body_r": body_r, "belt": belt, "shoulder_row": shoulder_row,
           "arches": {t: a_["outline"] for t, a_ in arches.items()}, "bumpers": extras.get("bumpers", []),
           "extras": extras}
    seams, plates, grooves = side_details(sh, ctx, found)
    recesses, lamps, lines = [], [], []
    if "front" in sh.boxes and x0_px is not None:
        ctx.update(F_raw=F_raw, f_org=f_org)
        recesses, lamps = front_details(sh, ctx, found)
    if "top" in sh.boxes:
        lines = top_ribs(sh, ctx, found)

    # plan.low under the arches: the top view's outline there is the arch lip's edge, and carforge
    # stands the lip `flare` proud of plan.low, so the body side under it is the outline less the
    # lip's flare (else the build is a flare too wide at the arches)
    lip_cut, lip_max = {}, {}
    for tag, arch in arches.items():
        fl = lip_flare(arch["outline"], bottom_of, mm, float(arch.get("lip", ARCH_LIP_MM)),
                       float(arch.get("flare", ARCH_FLARE_MM)))
        lip_max[tag] = round(max(fl.values(), default=0.0))
        for col, v in fl.items():
            lip_cut[col] = max(lip_cut.get(col, 0.0), v)
    proud = {}  # how far the drawn outline stands past the body line bridged across each arch
    bridges = []  # (columns under the arch, that body line there)
    if plan_low is not None:
        for tag, arch in arches.items():
            xs = [p[0] for p in arch["outline"]]
            reach = float(arch.get("lip", ARCH_LIP_MM)) / mm + 5
            a_, b_ = min(xs) - reach, max(xs) + reach
            la, lb = np.interp([a_, b_], plan_low[0], plan_low[1])
            sel = (plan_low[0] >= min(xs)) & (plan_low[0] <= max(xs))
            bridge = la + (plan_low[0][sel] - a_) * (lb - la) / (b_ - a_)
            proud[tag] = round(float(np.max(plan_low[1][sel] - bridge)) * mm) if sel.any() else 0
            bridges.append((sel, bridge))
    if plan_low is not None and lip_cut:
        cut = np.array([lip_cut.get(int(col), 0.0) for col in plan_low[0]]) / mm
        low = plan_low[1] - cut
        # The cut stops at the body line bridged across the arch. The schema's side is one wall
        # from sill to shoulder, so cutting past that line (a lip flare prouder than the drawn
        # one) takes the whole wing above the lip in: a dent over every arch.
        for sel, bridge in bridges:
            low[sel] = np.maximum(low[sel], np.minimum(plan_low[1][sel], bridge))
        plan_low = (plan_low[0], low)
        plan_high = (plan_high[0], np.minimum(plan_high[1], plan_low[1]))

    # 8. blueprint
    wheels_out = {"radius": round(tyre_r * mm), "wheelbase": sd["wheelbase_mm"]}
    if track:
        wheels_out["track_front"] = wheels_out["track_rear"] = round(track)
    for tag, wheel in (("front", wheels[0]), ("rear", wheels[1])):
        if tag in arches:
            # the opening's height over the hub (only used where an outline is missing)
            wheels_out["arch_" + tag] = round((wheel[1] - min(y for _, y in arches[tag]["outline"])) * mm)
    wheels_out.update(extras.get("wheels", {}))
    if "track_front" not in wheels_out:
        fail("no track: the front view's tyres were not found and extras.wheels gives none")

    def pl(pts):
        return [[r1(x), r1(y)] for x, y in pts]

    bp = {"id": sd.get("id", "traced"), "source": sd.get("source", sd["image"]) + " (trace.py)",
          "scale": {"mm_per_px": round(mm, 5), "y0_px": r1(y0_px), "z0_px": r1(ground),
                    "x0_px": r1(x0_px if x0_px is not None else 0.0)}}
    if top_x0 is not None:
        bp["scale"]["top_x0_px"] = r1(top_x0)
    if rear_x0 is not None:
        bp["scale"]["rear_x0_px"] = r1(rear_x0)
    if abs(sh.deg) > 1e-6:
        bp["scale"]["deskew"] = {"deg": round(sh.deg, 4), "centre": [r1(sh.centre[0]), r1(sh.centre[1])]}
    bp["side"] = {"top": pl(top_line), "bottom": pl(bottom),
                  "shoulder": [[float(body_f), r1(shoulder_row)], [float(body_r), r1(shoulder_row)]]}
    if plan_low is not None:
        sel = (plan_low[0] >= body_f) & (plan_low[0] <= body_r)
        bp["plan"] = {"low": pl(simplify(list(zip(plan_low[0][sel], plan_low[1][sel])))),
                      "high": pl(simplify(list(zip(plan_high[0][sel], plan_high[1][sel]))))}
    else:
        fail("no top view: plan half-widths need one")
    bp["tumblehome"] = tumble
    bp["belt"] = r1(belt)
    bp["glass_top"] = r1(glass_top)
    bp["windows"] = []
    for wd in windows:
        out = {"outline": pl(wd["outline"]), "round": round(wd["round"])}
        if "pillar" in wd:
            out["pillar"] = wd["pillar"]
        bp["windows"].append(out)
    bp["wheels"] = wheels_out
    if arches:
        bp["arches"] = arches
    detected = {"seams": seams, "plates": plates, "grooves": grooves, "recesses": recesses, "lamps": lamps,
                "lines": lines}
    for key, val in detected.items():
        if val:
            bp[key] = val
    for key, val in extras.items():  # a sheet's own items come after the traced ones
        if key not in ("wheels", "arches"):
            bp[key] = bp.get(key, []) + val if isinstance(val, list) else val

    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w") as fh:
        json.dump(bp, fh, indent=1)
        fh.write("\n")
    rep_path = os.path.splitext(a.out)[0] + ".trace_report.json"
    with open(rep_path, "w") as fh:
        json.dump({"detected": found.detected, "rejected": found.rejected, "notes": found.notes}, fh, indent=1)
        fh.write("\n")
    print_details(found)
    report = {
        "deskew_deg": round(sh.deg, 3), "mm_per_px": round(mm, 4),
        "hubs_px": [[r1(fx), r1(fy)], [r1(bx), r1(by)]], "tyre_r_px": r1(tyre_r), "ground_row": r1(ground),
        "track_mm": round(track) if track else None, "front_x0_px": r1(x0_px) if x0_px else None,
        "top_x0_px": r1(top_x0) if top_x0 is not None else None,
        "body_px": [body_f, body_r], "length_mm": round((body_r - body_f) * mm),
        "height_mm": round((ground - min(p[1] for p in top_line)) * mm),
        "max_half_width_mm": round(float(np.max(bp_low_vals(bp))) * mm),
        "belt_row": r1(belt), "glass_top_row": r1(glass_top), "shoulder_row": r1(shoulder_row),
        "windows_px": [[r1(min(p[0] for p in w["outline"])), r1(max(p[0] for p in w["outline"]))] for w in windows],
        "arch_top_rows": {t: r1(min(p[1] for p in a_["outline"])) for t, a_ in arches.items()},
        "front": front_check,
        "arch_lip_cut_mm": lip_max, "arch_drawn_proud_mm": proud,
        "details": {k: len(v) for k, v in detected.items()}, "rejected": len(found.rejected),
    }
    print("TRACE " + json.dumps(report))
    print("WROTE " + a.out)
    print("WROTE " + rep_path)


def print_details(found):
    """The trace report as two tables on stdout: every detail taken, every candidate dropped."""
    def where(at):
        if "line" in at:
            return " ".join(f"{y},{z}" for y, z in at["line"])
        return " ".join(f"{k}={v[0]}..{v[1]}" for k, v in at.items())
    print("DETAILS taken (view kind | at mm | evidence)")
    for d in found.detected:
        print(f"  {d['view']:5} {d['kind']:12} | {where(d['at_mm'])} | {d['evidence']}")
    print("DETAILS dropped (view kind | at mm | reason)")
    for d in found.rejected:
        print(f"  {d['view']:5} {d['kind']:12} | {where(d['at_mm'])} | {d['reason']}")
    for n in found.notes:
        print("  note: " + n)


def bp_low_vals(bp):
    return [p[1] for p in bp["plan"]["low"]]


if __name__ == "__main__":
    main()
