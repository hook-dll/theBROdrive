"""Finds the drawing's separate views: blobs of dark line work, with their pixel boxes.

    build/pyenv/bin/python tools/carshape/bp/views.py <blueprint image> [out.png]

Prints each blob's box (x0 y0 x1 y1) and writes the image with the boxes numbered, so
the side, top, front and rear views can be named in the car's file.
"""
import sys
import cv2
import numpy as np

img = cv2.imread(sys.argv[1])
g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
dark = (g < 110).astype(np.uint8)
k = max(9, img.shape[1] // 120)
blob = cv2.dilate(dark, np.ones((k, k), np.uint8))
n, lab, stats, _ = cv2.connectedComponentsWithStats(blob)
boxes = []
for i in range(1, n):
    x, y, w, h, a = stats[i]
    if w * h < img.shape[0] * img.shape[1] * 0.01:
        continue
    boxes.append((x, y, x + w, y + h))
boxes.sort(key=lambda b: (b[1] // 200, b[0]))
out = img.copy()
for i, (x0, y0, x1, y1) in enumerate(boxes):
    print(i, x0, y0, x1, y1, 'w', x1 - x0, 'h', y1 - y0)
    cv2.rectangle(out, (x0, y0), (x1, y1), (0, 0, 255), 3)
    cv2.putText(out, str(i), (x0 + 10, y0 + 60), cv2.FONT_HERSHEY_SIMPLEX, 2.2, (0, 0, 255), 5)
if len(sys.argv) > 2:
    cv2.imwrite(sys.argv[2], out)
