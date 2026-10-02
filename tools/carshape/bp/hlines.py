"""Rows (and columns) of a drawing region crossed by long straight dark lines: ground
lines and dimension lines, which a view's box should stop short of.

    build/pyenv/bin/python tools/carshape/bp/hlines.py <image> x0 y0 x1 y1
"""
import sys
import cv2
import numpy as np

img = cv2.imread(sys.argv[1], 0)
x0, y0, x1, y1 = map(int, sys.argv[2:6])
d = (img[y0:y1, x0:x1] < 128)
w, h = x1 - x0, y1 - y0
rows = [y0 + r for r in range(h) if d[r].sum() > 0.6 * w]
cols = [x0 + c for c in range(w) if d[:, c].sum() > 0.6 * h]
print('rows', rows)
print('cols', cols)
