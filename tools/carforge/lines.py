"""Turn a filled, watermarked colour blueprint into a line drawing for trace.py (plain Python + OpenCV).

    python3 tools/carforge/lines.py <drawing> <out.png>

trace.py reads dark ink on a light ground: outlines only. Vector-shop previews
(the-blueprints.com) paint the body grey, the tyres black and the lamps in colour, and lay a
diagonal text watermark over everything.

1. Watermark: its strokes are thin and lighter than the 9 px median around them by more than
   WM_DELTA. Those pixels, grown by a pixel, are inpainted from their surroundings.
2. Edges: every colour boundary (Canny on each Lab channel after an edge-keeping blur): panel
   gaps, glass, tyre, rim and lamp outlines. A drawn line comes out as its two edges.
3. Outline: what is not the white ground (grey < GROUND, opened by OPEN px so watermark text on
   the ground falls away, holes filled, pieces under MIN_AREA px dropped) is a view; its border
   is drawn too, so every view's silhouette is closed even where a pale roof line or a smear
   leaves the edges open (trace.py fills the silhouette from the outline).

Lines are 2 px, as on a scanned line drawing: trace.py's fits and tolerances are set on those.
"""

import sys

import cv2
import numpy as np
from scipy import ndimage as ndi

WM_DELTA = 14        # grey levels lighter than the local median that make a watermark stroke
CANNY = [(40, 100), (40, 90), (40, 90)]   # (low, high) per Lab channel
GROUND = 246         # grey level at or above which a pixel is the white ground
OPEN = 2             # px, opening of the non-ground mask (watermark strokes on the ground)
MIN_AREA = 3000      # px, smallest view (drops the title, logos and dimension text)


def main():
    src, out = sys.argv[1:3]
    img = cv2.imread(src)
    if img is None:
        raise SystemExit(f"lines: cannot read {src}")
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(int)
    med = cv2.medianBlur(g.astype(np.uint8), 9).astype(int)
    wm = ndi.binary_dilation(g - med > WM_DELTA, iterations=1)
    clean = cv2.inpaint(img, wm.astype(np.uint8), 3, cv2.INPAINT_TELEA)

    lab = cv2.bilateralFilter(cv2.cvtColor(clean, cv2.COLOR_BGR2LAB), 7, 25, 7)
    edges = np.zeros(g.shape, bool)
    for c, (lo, hi) in enumerate(CANNY):
        edges |= cv2.Canny(lab[:, :, c], lo, hi) > 0

    fg = ndi.binary_fill_holes(ndi.binary_opening(cv2.cvtColor(clean, cv2.COLOR_BGR2GRAY) < GROUND, iterations=OPEN))
    parts, n = ndi.label(fg)
    sizes = ndi.sum(fg, parts, range(1, n + 1))
    fg = np.isin(parts, 1 + np.flatnonzero(sizes >= MIN_AREA))
    outline = fg & ~ndi.binary_erosion(fg)
    ink = ndi.binary_dilation(edges | outline, np.ones((2, 2), bool))
    cv2.imwrite(out, np.where(ink, 0, 255).astype(np.uint8))
    print(f"LINES watermark px {int(wm.sum())}, views {int((sizes >= MIN_AREA).sum())}, ink px {int(ink.sum())}")


if __name__ == "__main__":
    main()
