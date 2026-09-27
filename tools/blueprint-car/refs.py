"""Stage 10: turn blueprint views into metric silhouette masks.

    Blender --background --factory-startup --python tools/blueprint-car/refs.py -- <car.json>

For every view in the car spec the drawing is cropped, flipped into the toolkit's
orientation (see common.py), filled into a solid silhouette, and resampled onto the
view's metric grid.

Scale: a blueprint sheet draws every view at one scale, and the loft needs the views to
agree with each other, so ONE scale is taken from the side view and used everywhere:
its silhouette length is the factory length (px/m for x and y) and its silhouette
height is the factory height (px/m for z). The drawing thus supplies shape and the
factory supplies size. Anything else -- plan width with mirrors, the end views'
heights -- is measured in that scale and reported against the factory figure; a large
error there means a bad crop or a sheet whose views are not drawn alike.

Writes <work>/10-refs/<view>-mask.png, <view>-drawing.png, <view>-check.png and
refs.json. Nothing downstream reads the original drawings.
"""
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (PX_PER_M, VIEWS, grid_shape, load_spec, luminance, outline_check,  # noqa: E402
                    read_rgb, silhouette_from_drawing, view_window, write_mask, write_rgb)

spec = load_spec(sys.argv[sys.argv.index('--') + 1])
factory = spec['factory']
FACTORY = {'x': factory['widthM'], 'y': factory['lengthM'], 'z': factory['heightM']}
out_dir = spec['_work'] / '10-refs'
out_dir.mkdir(parents=True, exist_ok=True)


def extract(view: dict):
    rgb = read_rgb(spec['_work'] / view['image'])
    x0, y0, x1, y1 = view['crop']
    rgb = rgb[y0:y1, x0:x1]
    if view.get('flipX'):
        rgb = rgb[:, ::-1]
    if view.get('flipY'):
        rgb = rgb[::-1]
    solid = silhouette_from_drawing(rgb, view)
    rows = np.flatnonzero(solid.any(axis=1))
    cols = np.flatnonzero(solid.any(axis=0))
    assert rows.size and cols.size, 'empty silhouette'
    return luminance(rgb), solid, (rows[0], rows[-1] + 1, cols[0], cols[-1] + 1)


views = {name: extract(view) for name, view in spec['views'].items()}
assert set(views) <= set(VIEWS) and 'side' in views
_, _, (r0, r1, c0, c1) = views['side']
PX_PER_METRE = {'y': (c1 - c0) / FACTORY['y'], 'z': (r1 - r0) / FACTORY['z']}
PX_PER_METRE['x'] = PX_PER_METRE['y']  # plan is drawn at the length scale

report = {'drawingPxPerM': {k: round(v, 3) for k, v in PX_PER_METRE.items()}}
for name, (gray, solid, (r0, r1, c0, c1)) in views.items():
    view = spec['views'][name]
    h_axis, _, v_axis, _ = VIEWS[name]
    h_ppm, v_ppm = PX_PER_METRE[h_axis], PX_PER_METRE[v_axis]

    # Target grid -> source pixel. Horizontal axes are centred on the car; z stands
    # on the ground (the silhouette's lowest pixel).
    h0, h1, v0, v1 = view_window(spec, name)
    height, width = grid_shape(spec, name)
    h = h0 + (np.arange(width) + 0.5) / PX_PER_M
    v = v1 - (np.arange(height) + 0.5) / PX_PER_M
    src_c = np.floor((c0 + c1) / 2 + h * h_ppm).astype(int)
    src_r = np.floor((r1 if v_axis == 'z' else (r0 + r1) / 2) - v * v_ppm).astype(int)
    valid = (((src_r >= 0) & (src_r < solid.shape[0]))[:, None]
             & ((src_c >= 0) & (src_c < solid.shape[1]))[None, :])
    rr, cc = np.meshgrid(np.clip(src_r, 0, solid.shape[0] - 1),
                         np.clip(src_c, 0, solid.shape[1] - 1), indexing='ij')
    mask = solid[rr, cc] & valid
    drawing = np.where(valid, gray[rr, cc], 1.0).astype(np.float32)
    write_mask(out_dir / f'{name}-mask.png', mask)
    write_rgb(out_dir / f'{name}-drawing.png', np.repeat(drawing[..., None], 3, axis=2))
    write_rgb(out_dir / f'{name}-check.png', outline_check(drawing, mask))

    measured = {h_axis: (c1 - c0) / h_ppm, v_axis: (r1 - r0) / v_ppm}
    entry = {'measuredM': {a: round(m, 4) for a, m in measured.items()},
             'factoryM': {a: FACTORY[a] for a in measured},
             'errorPct': {a: round(100 * (m / FACTORY[a] - 1), 2) for a, m in measured.items()}}
    centres = view.get('wheelCentresPx')
    if centres:
        assert name == 'side', 'wheel centres are read from the side view'
        x0, y0, x1, y1 = view['crop']

        def to_metric(point):
            col, row = point[0] - x0, point[1] - y0
            if view.get('flipX'):
                col = (x1 - x0) - 1 - col
            if view.get('flipY'):
                row = (y1 - y0) - 1 - row
            return ((col - (c0 + c1) / 2) / h_ppm, (r1 - row) / v_ppm)

        (fy, fz), (ry, rz) = sorted(to_metric(p) for p in centres)
        entry['wheels'] = {'frontCentreYZ': [round(fy, 4), round(fz, 4)],
                           'rearCentreYZ': [round(ry, 4), round(rz, 4)],
                           'wheelbaseM': round(ry - fy, 4),
                           'factoryWheelbaseM': factory['wheelbaseM']}
    report[name] = entry
    print('VIEW', name, json.dumps(entry))

(out_dir / 'refs.json').write_text(json.dumps(report, indent=2) + '\n')
