"""Trace sheets: the metric drawings with a grid and the spec's authored body lines.

    Blender --background --factory-startup --python tools/blueprint-car/trace.py -- <car.json> [scale]

Character lines (sill, waist, shoulder, roof rail) are read off the drawings by hand:
no line detector reliably tells a fender crease from a door seam or a watermark. This
stage makes that reading checkable. Each view's drawing is written at `scale` times
the stage-10 resolution with grid lines every 0.1 m (grey), 0.5 m (blue) and 1 m
(dark blue), the zero axes in red, and every line of spec["body"]["lines"] drawn over
it in its own colour with its authored points marked -- so a misread point shows as a
line leaving the drawn crease.

Writes <work>/15-trace/<view>-trace.png.
"""
import colorsys
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import PX_PER_M, VIEWS, load_spec, read_gray, view_window, write_rgb  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:]
spec = load_spec(args[0])
SCALE = int(args[1]) if len(args) > 1 else 2
refs = spec['_work'] / '10-refs'
out_dir = spec['_work'] / '15-trace'
out_dir.mkdir(parents=True, exist_ok=True)
lines = spec.get('body', {}).get('lines', {})
colours = {name: colorsys.hsv_to_rgb(i / max(1, len(lines)), 0.9, 0.85) for i, name in enumerate(lines)}
# Which authored curve each view shows, as (image-right value, image-up value) pairs.
CURVE = {'side': ('side', lambda h, v: (h, v)), 'top': ('plan', lambda y, x: (y, -x))}


def to_pixel(view: str, h: float, v: float) -> tuple[float, float]:
    h0, h1, v0, v1 = view_window(spec, view)
    ppm = PX_PER_M * SCALE
    return (v1 - v) * ppm, (h - h0) * ppm


def draw_polyline(rgb, points, colour, width=1):
    for (r0, c0), (r1, c1) in zip(points, points[1:]):
        steps = int(max(abs(r1 - r0), abs(c1 - c0)) * 2) + 1
        rr = np.round(np.linspace(r0, r1, steps)).astype(int)
        cc = np.round(np.linspace(c0, c1, steps)).astype(int)
        for dr in range(-width + 1, width):
            for dc in range(-width + 1, width):
                ok = (rr + dr >= 0) & (rr + dr < rgb.shape[0]) & (cc + dc >= 0) & (cc + dc < rgb.shape[1])
                rgb[rr[ok] + dr, cc[ok] + dc] = colour


for view in VIEWS:
    path = refs / f'{view}-drawing.png'
    if not path.exists():
        continue
    gray = np.kron(read_gray(path), np.ones((SCALE, SCALE)))
    rgb = np.repeat(gray[..., None] * 0.7 + 0.3, 3, axis=2)
    h0, h1, v0, v1 = view_window(spec, view)
    ppm = PX_PER_M * SCALE
    for step, colour, width in ((0.1, (0.72, 0.72, 0.72), 1), (0.5, (0.35, 0.55, 0.95), 1),
                                (1.0, (0.1, 0.2, 0.7), 2)):
        for h in np.arange(np.ceil(h0 / step) * step, h1, step):
            c = (h - h0) * ppm
            draw_polyline(rgb, [(0, c), (rgb.shape[0] - 1, c)], colour, width)
        for v in np.arange(np.ceil(v0 / step) * step, v1, step):
            r = (v1 - v) * ppm
            draw_polyline(rgb, [(r, 0), (r, rgb.shape[1] - 1)], colour, width)
    draw_polyline(rgb, [(0, -h0 * ppm), (rgb.shape[0] - 1, -h0 * ppm)], (0.85, 0.1, 0.1), 1)
    draw_polyline(rgb, [(v1 * ppm, 0), (v1 * ppm, rgb.shape[1] - 1)], (0.85, 0.1, 0.1), 1)
    if view in CURVE:
        key, orient = CURVE[view]
        for name, line in lines.items():
            if key not in line:
                continue
            mirrors = (1, -1) if view == 'top' else (1,)
            for sign in mirrors:
                pts = [to_pixel(view, *orient(a, b * sign)) for a, b in line[key]]
                draw_polyline(rgb, pts, colours[name], 2)
                for r, c in pts:
                    draw_polyline(rgb, [(r - 4, c - 4), (r + 4, c + 4)], (0, 0, 0), 1)
                    draw_polyline(rgb, [(r - 4, c + 4), (r + 4, c - 4)], (0, 0, 0), 1)
    write_rgb(out_dir / f'{view}-trace.png', rgb)
    print('TRACE', out_dir / f'{view}-trace.png')
    if view in ('side', 'top'):
        # Length-wise tiles small enough to be read at full resolution: 1.4 m each,
        # overlapping 0.2 m, named by their starting y in centimetres.
        for start in np.arange(np.floor(h0 * 5) / 5, h1, 1.2):
            c0, c1 = int(max(0, (start - h0) * ppm)), int(min(rgb.shape[1], (start + 1.4 - h0) * ppm))
            write_rgb(out_dir / f'{view}-tile{int(round(start * 100)):+05d}.png', rgb[:, c0:c1])
