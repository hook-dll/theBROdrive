"""Prints the side outline's top and bottom heights every 5 cm, and the plan half-width.

    build/pyenv/bin/python tools/carshape/bp/profile.py <car> [step]
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import grid  # noqa: E402

spec, bp = grid.load(sys.argv[1])
step = float(sys.argv[2]) if len(sys.argv) > 2 else 0.05
ys, zs, side = bp['ys'], bp['zs'], bp['side']
for y in np.arange(ys[0], ys[-1], step):
    j = int(np.argmin(np.abs(ys - y)))
    col = np.nonzero(side[:, j])[0]
    if not len(col):
        continue
    plan = bp['plan'][j] if 'plan' in bp else float('nan')
    print(f'{y:+.2f}  top {zs[col[-1]]:.3f}  bottom {zs[col[0]]:.3f}  half {plan:.3f}')
