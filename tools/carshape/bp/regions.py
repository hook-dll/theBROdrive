"""Finds the closed regions a view's line work draws (a window inside its frame, a lens
inside its rim, the plate, the grille) and prints their outlines in car metres.

    build/pyenv/bin/python tools/carshape/bp/regions.py <car> <side|top|front|rear> [min cm2] [close px]

Writes build/carshape/<car>/regions-<view>.png with each region filled and numbered,
and prints `id: area, centre, box, outline [[a, b], ...]` so a region's outline can be
copied into the car's file as drawn, rather than read off by eye.
"""
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import grid  # noqa: E402


def affine_inverse(f):
    """The inverse of an axis-aligned affine map (a, b) -> (u, v)."""
    u0, v0 = f(0.0, 0.0)
    u1, _ = f(1.0, 0.0)
    _, v1 = f(0.0, 1.0)
    return lambda u, v: (float((u - u0) / (u1 - u0)), float((v - v0) / (v1 - v0)))


def main(car, view, min_cm2=4.0, close=3):
    spec, bp = grid.load(car)
    v_ = bp[view + '_view']
    sil = bp[view + '_sil']
    to_px = bp[view + '_px']
    inv = affine_inverse(to_px)
    ppm = abs(to_px(1.0, 0.0)[0] - to_px(0.0, 0.0)[0])
    lines = cv2.dilate(v_.lines, np.ones((close, close), np.uint8))
    free = ((lines == 0) & (sil > 0)).astype(np.uint8)
    n, lab, stats, cent = cv2.connectedComponentsWithStats(free, connectivity=4)
    img = cv2.cvtColor(v_.grey, cv2.COLOR_GRAY2BGR)
    scale = 1500 / img.shape[1]
    img = cv2.resize(img, None, fx=scale, fy=scale)
    rng = np.random.default_rng(1)
    out = []
    for i in range(1, n):
        area = stats[i, 4] / ppm ** 2 * 1e4
        if area < min_cm2:
            continue
        m = (lab == i).astype(np.uint8)
        # Give back the closing so the outline sits on the drawn line's centre.
        m = cv2.dilate(m, np.ones((close // 2 * 2 + 1, close // 2 * 2 + 1), np.uint8))
        cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        c = max(cnts, key=cv2.contourArea)
        c = cv2.approxPolyDP(c, max(1.0, 0.004 * ppm), True)[:, 0, :]
        pts = [inv(float(u), float(v)) for u, v in c]
        out.append((i, area, pts))
        col = tuple(int(x) for x in rng.integers(60, 230, 3))
        overlay = img.copy()
        cv2.fillPoly(overlay, [(c * scale).astype(np.int32)], col)
        img = cv2.addWeighted(overlay, 0.45, img, 0.55, 0)
        cx, cy = cent[i] * scale
        cv2.putText(img, str(i), (int(cx) - 8, int(cy) + 6), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 2)
        cv2.putText(img, str(i), (int(cx) - 8, int(cy) + 6), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
    cv2.imwrite(os.path.join(grid.ROOT, 'build/carshape', car, f'regions-{view}.png'), img)
    for i, area, pts in out:
        a = np.array(pts)
        print(f'{i}: {area:.0f} cm2  centre [{a[:, 0].mean():.3f}, {a[:, 1].mean():.3f}]  '
              f'box [{a[:, 0].min():.3f}..{a[:, 0].max():.3f}] x [{a[:, 1].min():.3f}..{a[:, 1].max():.3f}]  '
              f'outline {[[round(p[0], 3), round(p[1], 3)] for p in pts]}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], *(float(a) for a in sys.argv[3:4]), *(int(a) for a in sys.argv[4:5]))
