"""Draws the car's drawing views with a metric grid in car coordinates and the
silhouettes bpread.py found, so lines can be read off in metres.

    build/pyenv/bin/python tools/carshape/bp/grid.py <car>

Writes build/carshape/<car>/grid-{side,top,front,rear}.png: 10 cm lines, labelled every
50 cm; the found silhouette in green; anything the car's file has authored (`overlay`
polylines from hull.py's spec) in red.
"""
import os
import runpy
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import bpread  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), '..', '..', '..')


def load(car):
    spec = runpy.run_path(os.path.join(os.path.dirname(__file__), 'cars', car + '.py'))['CAR']
    image = os.path.join(ROOT, 'build/carshape/_refs/bp/img', spec['blueprint']['image'])
    return spec, bpread.read(spec, image)


def draw(view, sil, to_px, ranges, labels, scale, polylines=()):
    img = cv2.cvtColor(view.grey, cv2.COLOR_GRAY2BGR)
    img = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    hh, ww = img.shape[:2]

    def clamp(p):
        return int(min(max(p[0], 2), ww - 40)), int(min(max(p[1], 14), hh - 4))
    (a0, a1), (b0, b1) = ranges
    for a in np.arange(np.floor(a0 * 10) / 10, a1, 0.1):
        major = abs(a * 2 - round(a * 2)) < 1e-6
        p0 = to_px(a, b0)
        p1 = to_px(a, b1)
        cv2.line(img, (int(p0[0] * scale), int(p0[1] * scale)), (int(p1[0] * scale), int(p1[1] * scale)),
                 (255, 160, 60) if major else (255, 220, 190), 1)
        if major:
            cv2.putText(img, f'{a:+.1f}', clamp((p0[0] * scale + 2, p0[1] * scale - 4)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.4, (200, 90, 0), 1)
    for b in np.arange(np.floor(b0 * 10) / 10, b1, 0.1):
        major = abs(b * 2 - round(b * 2)) < 1e-6
        p0 = to_px(a0, b)
        p1 = to_px(a1, b)
        cv2.line(img, (int(p0[0] * scale), int(p0[1] * scale)), (int(p1[0] * scale), int(p1[1] * scale)),
                 (255, 160, 60) if major else (255, 220, 190), 1)
        if major:
            cv2.putText(img, f'{b:+.1f}', clamp((p0[0] * scale + 2, p0[1] * scale - 2)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.4, (200, 90, 0), 1)
    cnts, _ = cv2.findContours(sil, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    cv2.drawContours(img, [(c * scale).astype(np.int32) for c in cnts], -1, (0, 180, 0), 1)
    for pl, colour in polylines:
        pts = np.array([to_px(a, b) for a, b in pl]) * scale
        cv2.polylines(img, [pts.astype(np.int32)], False, colour, 1)
    return img


def main(car, extra=None):
    spec, bp = load(car)
    F = spec['factory']
    L, H, W = F['length'], F['height'], F['width']
    out = os.path.join(ROOT, 'build/carshape', car)
    os.makedirs(out, exist_ok=True)
    extra = extra or {}
    sc = 1600 / bp['side_view'].grey.shape[1]
    img = draw(bp['side_view'], bp['side_sil'], bp['side_px'], ((-L / 2 - 0.1, L / 2 + 0.1), (0, H + 0.1)),
               None, sc, extra.get('side', ()))
    cv2.imwrite(os.path.join(out, 'grid-side.png'), img)
    if 'top_view' in bp:
        img = draw(bp['top_view'], bp['top_sil'], bp['top_px'], ((-L / 2 - 0.1, L / 2 + 0.1), (-W / 2 - 0.1, W / 2 + 0.1)),
                   None, sc, extra.get('top', ()))
        cv2.imwrite(os.path.join(out, 'grid-top.png'), img)
    for end in ('front', 'rear'):
        if end + '_view' in bp:
            img = draw(bp[end + '_view'], bp[end + '_sil'], bp[end + '_px'],
                       ((-W / 2 - 0.1, W / 2 + 0.1), (0, H + 0.1)), None, 1300 / bp[end + '_view'].grey.shape[1], extra.get(end, ()))
            cv2.imwrite(os.path.join(out, f'grid-{end}.png'), img)
    print('ppm', round(bp['ppm'], 1), 'wheels', bp['wheels'])


if __name__ == '__main__':
    main(sys.argv[1])
