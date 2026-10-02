"""Finds a wheel's centre near a guess: the strongest circle of about wheel size there.

    build/pyenv/bin/python tools/carshape/bp/hubs.py <image> <rmin px> <rmax px> x,y [x,y ...]
"""
import sys
import cv2

img = cv2.imread(sys.argv[1], 0)
rmin, rmax = int(sys.argv[2]), int(sys.argv[3])
for g in sys.argv[4:]:
    x, y = (int(v) for v in g.split(','))
    m = rmax + 20
    c = img[max(0, y - m):y + m, max(0, x - m):x + m]
    cc = cv2.HoughCircles(cv2.medianBlur(c, 5), cv2.HOUGH_GRADIENT, dp=1, minDist=m, param1=100, param2=20,
                          minRadius=rmin, maxRadius=rmax)
    if cc is None:
        print(g, 'none')
        continue
    cx, cy, r = cc[0][0]
    print(f'{g} -> [{cx + max(0, x - m):.1f}, {cy + max(0, y - m):.1f}] r {r:.1f}')
