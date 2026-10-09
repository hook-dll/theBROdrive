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
  extras                what a drawing does not give, copied into the blueprint: wheels {width, well},
                          arches {front|rear: {lip, flare}}, bumpers, mirrors, plates, lamps (mm), nose,
                          tail, spare, recesses, grooves, lines, seams. Bumper boxes also trim the body's
                          ends (see below).

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
  front view  half-width per row of the run through the centre column (mirror heads cut off by the
              opening, arms and brackets by an 80 mm grey opening). tumblehome = half-width / half-width
              at the belt, from the belt up to where it falls under 0.9 (the roof's corner radius).
              shoulder = first row below the belt where the half-width is past half-way from the belt's
              to the body's widest.
  windows     see find_windows(). arches: see find_arch().

Prints `TRACE {...}` with the measured scale, hubs, track, extents and window spans.
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

    # 7. blueprint
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
    for key, val in extras.items():
        if key not in ("wheels", "arches"):
            bp[key] = val

    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w") as fh:
        json.dump(bp, fh, indent=1)
        fh.write("\n")
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
    }
    print("TRACE " + json.dumps(report))
    print("WROTE " + a.out)


def bp_low_vals(bp):
    return [p[1] for p in bp["plan"]["low"]]


if __name__ == "__main__":
    main()
