"""Prints a reference mesh's section table, for authoring a car's character lines.

    blender --background --factory-startup --python tools/carshape/measure.py -- <car.json> [step]

Warps the reference onto the factory dimensions (as loft.py and sheets.py do) and, every
`step` metres along the car (default 0.1), prints the centreline top and the body's
bottom and its half-width at fixed heights. Mirrors and tyres are left out. These are
the numbers a modeller reads off a blueprint; they go into the car's `lines`.
"""
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:]
spec_path = argv[0]
step = float(argv[1]) if len(argv) > 1 else 0.1
spec = json.load(open(spec_path))
F = spec['factory']
L, W, H = F['length'], F['width'], F['height']
WB, FO, R, TW = F['wheelbase'], F['frontOverhang'], F['wheelRadius'], F['tyreWidth']
AXLES = [(-L / 2 + FO, F['frontTrack']), (-L / 2 + FO + WB, F['rearTrack'])]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(Path(spec_path).parent / spec['reference']))
co = np.concatenate([np.array([(o.matrix_world @ v.co)[:] for v in o.data.vertices])
                     for o in bpy.context.scene.objects if o.type == 'MESH'])
size = co.max(0) - co.min(0)
if size[0] > size[1]:
    co = co[:, [1, 0, 2]]
co -= np.array([(co[:, 0].max() + co[:, 0].min()) / 2, 0, co[:, 2].min()])
low = co[co[:, 2] < co[:, 2].max() * 0.12]
ys = np.sort(low[:, 1])
split = int(np.argmax(np.diff(ys)))
ya, yb = float(np.median(ys[: split + 1])), float(np.median(ys[split + 1:]))
y0, y1 = float(co[:, 1].min()), float(co[:, 1].max())
if ya - y0 > y1 - yb and spec.get('noseAtMinY', True):
    co[:, 1] = -co[:, 1]
    co[:, 0] = -co[:, 0]
    ya, yb, y0, y1 = -yb, -ya, -y1, -y0
co[:, 1] = np.interp(co[:, 1], [y0, ya, yb, y1], [-L / 2, -L / 2 + FO, -L / 2 + FO + WB, L / 2])
shell = co[co[:, 2] < 0.55 * co[:, 2].max()]
co[:, 0] *= W / (shell[:, 0].max() - shell[:, 0].min())
co[:, 2] *= H / co[:, 2].max()

keep = np.abs(co[:, 0]) <= W / 2 + 0.01
for ay, tr in AXLES:
    keep &= ~((np.hypot(co[:, 1] - ay, co[:, 2] - R) < R * 1.06) & (np.abs(co[:, 0]) > tr / 2 - TW * 0.8))
co = co[keep]

heights = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95, 1.0, 1.1, 1.2, 1.3, 1.35]
print('MEASURE      y   bottom   top  | half-width at z = ' + ' '.join(f'{z:5.2f}' for z in heights))
for y in np.arange(-L / 2 + 0.02, L / 2, step):
    sl = co[np.abs(co[:, 1] - y) < 0.025]
    if len(sl) < 20:
        continue
    centre = sl[np.abs(sl[:, 0]) < 0.15]
    top = np.percentile(centre[:, 2], 99) if len(centre) > 5 else float('nan')
    bottom = np.percentile(sl[:, 2], 1)
    cells = []
    for z in heights:
        band = sl[np.abs(sl[:, 2] - z) < 0.015]
        cells.append(f'{np.percentile(np.abs(band[:, 0]), 97):5.3f}' if len(band) >= 4 else '  -  ')
    print(f'MEASURE {y:+6.2f}  {bottom:5.3f}  {top:5.3f} | ' + ' '.join(cells))
