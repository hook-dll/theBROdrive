"""Reads a car's four-view drawing into metric silhouettes.

A blueprint sheet (3dcar.ru and the like) draws the car from the side, the top, the
front and the rear at one scale. This module turns the views the car's file names into
the numbers tools/carshape/bp/hull.py builds a body from:

  side   the outer silhouette as a mask on a 1 cm (y, z) grid, the wheel centres and
         the ground, the scale (pixels per metre, from the wheelbase)
  top    the plan half-width at every station y
  front  the half-width at every height z, seen from the nose
  rear   the same from the tail

Car coordinates are carbody.py's: nose toward -y, +z up, the body centred on y = 0
over its factory length, the front axle at -L/2 + frontOverhang.

A silhouette is what a flood fill from the view's border cannot reach once the line
work is closed a little: every inside line drops out and only the outline counts.
"""
import cv2
import numpy as np

GRID = 0.01  # m


class View:
    def __init__(self, img, box, dark):
        x0, y0, x1, y1 = box
        self.x0, self.y0 = x0, y0
        self.grey = img[y0:y1, x0:x1]
        self.lines = (self.grey < dark).astype(np.uint8)

    def silhouette(self, close=7, drop=()):
        """Pixels a flood from the border cannot reach. `drop` boxes (in view pixels)
        are blanked first: dimension arrows, text, a door drawn open."""
        lines = self.lines.copy()
        for x0, y0, x1, y1 in drop:
            lines[y0:y1, x0:x1] = 0
        closed = cv2.dilate(lines, np.ones((close, close), np.uint8))
        h, w = closed.shape
        pad = np.zeros((h + 2, w + 2), np.uint8)
        pad[1:-1, 1:-1] = closed
        flood = pad.copy()
        mask = np.zeros((h + 4, w + 4), np.uint8)
        cv2.floodFill(flood, mask, (0, 0), 2)
        inside = (flood[1:-1, 1:-1] != 2).astype(np.uint8)
        # Give back the dilation so the outline sits on the line's centre.
        k = max(1, close // 2)
        return cv2.erode(inside, np.ones((k, k), np.uint8))


def wheel_centres(view, r_px):
    g = cv2.medianBlur(view.grey, 5)
    c = cv2.HoughCircles(g, cv2.HOUGH_GRADIENT, dp=1, minDist=r_px * 4, param1=100, param2=30,
                         minRadius=int(r_px * 0.55), maxRadius=int(r_px * 1.25))
    if c is None or len(c[0]) < 2:
        raise RuntimeError('no wheels found in the side view')
    c = sorted(c[0][:2], key=lambda p: p[0])
    return [(float(p[0]), float(p[1])) for p in c]


def read(spec, image_path):
    F = spec['factory']
    L, WB, R = F['length'], F['wheelbase'], F['wheelRadius']
    bp = spec['blueprint']
    img = cv2.imread(image_path, 0)
    dark = bp.get('dark', 128)
    out = {}

    # ---- side: scale and datum from the wheels ----------------------------------------
    sv = bp['side']
    side = View(img, sv['box'], dark)
    ppm0 = side.grey.shape[1] / L
    if 'wheels' in sv:
        wl, wr = [(u - side.x0, v - side.y0) for u, v in sv['wheels']]
    else:
        wl, wr = wheel_centres(side, R * ppm0)
    ppm = abs(wr[0] - wl[0]) / WB
    nose_left = sv.get('nose', 'left') == 'left'
    uF = wl[0] if nose_left else wr[0]
    sil = side.silhouette(sv.get('close', 7), sv.get('drop', ()))
    # The ground: the lowest silhouette row under the wheels.
    vg = sv.get('ground')
    if vg is None:
        cols = [int(wl[0]), int(wr[0])]
        vg = float(np.mean([np.nonzero(sil[:, c])[0].max() for c in cols]))
    else:
        vg -= side.y0
    y_axle_f = -L / 2 + F['frontOverhang']
    dirn = 1.0 if nose_left else -1.0

    def side_px(y, z):
        return uF + (y - y_axle_f) * ppm * dirn, vg - z * ppm

    ys = np.arange(-L / 2 - 0.15, L / 2 + 0.15, GRID)
    zs = np.arange(0.0, F['height'] + 0.15, GRID)
    U, V = np.broadcast_arrays(*side_px(ys[None, :], zs[:, None]))
    Ui, Vi = np.round(U).astype(int), np.round(V).astype(int)
    ok = (Ui >= 0) & (Ui < sil.shape[1]) & (Vi >= 0) & (Vi < sil.shape[0])
    side_mask = np.zeros(U.shape, bool)
    side_mask[ok] = sil[Vi[ok], Ui[ok]] > 0
    out.update(ppm=ppm, ys=ys, zs=zs, side=side_mask, side_px=side_px, side_view=side,
               side_sil=sil, wheels=(wl, wr), ground=vg, nose_left=nose_left)

    # ---- top: plan half-width per station --------------------------------------------
    if 'top' in bp:
        tv = bp['top']
        top = View(img, tv['box'], dark)
        tsil = top.silhouette(tv.get('close', 7), tv.get('drop', ()))
        cols = np.nonzero(tsil.any(axis=0))[0]
        rows = np.nonzero(tsil.any(axis=1))[0]
        centre = tv.get('centre', (rows.min() + rows.max()) / 2)
        if 'centre' in tv:
            centre -= top.y0
        t_nose_left = tv.get('nose', 'left') == 'left'
        # Lengthwise: the plan's extent is the side view's extent.
        s_cols = np.nonzero(sil.any(axis=0))[0]
        side_y = sorted(((s_cols.min() - uF) / ppm * dirn + y_axle_f, (s_cols.max() - uF) / ppm * dirn + y_axle_f))
        # Drawn at the side view's scale unless its length says otherwise.
        tp = tv.get('ppm', (cols.max() - cols.min()) / (s_cols.max() - s_cols.min()) * ppm)
        t0 = cols.min() if t_nose_left else cols.max()
        tdir = 1.0 if t_nose_left else -1.0
        if 'yShift' in tv:
            side_y[0] += tv['yShift']

        def top_px(y, x):
            return t0 + (y - side_y[0]) * tp * tdir, centre - x * tp

        half = np.zeros_like(ys)
        for i, y in enumerate(ys):
            u = int(round(top_px(y, 0)[0]))
            if 0 <= u < tsil.shape[1]:
                r = np.nonzero(tsil[:, u])[0]
                if len(r):
                    half[i] = max(centre - r.min(), r.max() - centre) / tp
        out.update(plan=half, top_px=top_px, top_view=top, top_sil=tsil)

    # ---- ends: half-width per height -------------------------------------------------
    for end in ('front', 'rear'):
        if end not in bp:
            continue
        ev = bp[end]
        v_ = View(img, ev['box'], dark)
        esil = v_.silhouette(ev.get('close', 7), ev.get('drop', ()))
        cols = np.nonzero(esil.any(axis=0))[0]
        rows = np.nonzero(esil.any(axis=1))[0]
        centre = ev['centre'] - v_.x0 if 'centre' in ev else (cols.min() + cols.max()) / 2
        # The end views share the side view's scale; their datum is the roof, which is
        # the factory height (the tyres at the bottom are often cut short or drawn
        # lower than the side view has them).
        ep = ev.get('ppm', ppm)
        top_row = rows.min()
        ground = ev['ground'] - v_.y0 if 'ground' in ev else top_row + ev.get('height', F['height']) * ep
        out[end + '_ppm'] = ep

        def end_px(x, z, centre=centre, ground=ground, ep=ep):
            return centre + x * ep, ground - z * ep

        half = np.zeros_like(zs)
        for i, z in enumerate(zs):
            v = int(round(end_px(0, z)[1]))
            if 0 <= v < esil.shape[0]:
                c = np.nonzero(esil[v])[0]
                if len(c):
                    half[i] = max(centre - c.min(), c.max() - centre) / ep
        out[end] = half
        out[end + '_px'] = end_px
        out[end + '_view'] = v_
        out[end + '_sil'] = esil
    return out


def sample_side(bp, ys, zs):
    """The side silhouette sampled at car coordinates (nearest drawing pixel)."""
    U, V = np.broadcast_arrays(*bp['side_px'](ys[None, :], zs[:, None]))
    Ui, Vi = np.round(U).astype(int), np.round(V).astype(int)
    sil = bp['side_sil']
    ok = (Ui >= 0) & (Ui < sil.shape[1]) & (Vi >= 0) & (Vi < sil.shape[0])
    m = np.zeros(U.shape, bool)
    m[ok] = sil[Vi[ok], Ui[ok]] > 0
    return m
