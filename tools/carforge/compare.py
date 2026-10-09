"""Overlay a carforge side render on the traced drawing (plain Python + Pillow).

    python3 tools/carforge/compare.py --blueprint tools/carforge/examples/blueprint_uaz3151.json \
        --drawing build/carforge/refs/uaz_blueprint.gif --render build/carforge/renders/uaz3151 \
        --out build/carforge/renders/uaz3151_overlay.png

--render is the prefix render.py was given: it reads <prefix>_side.png and <prefix>_side.json.
The render is scaled to the blueprint's mm_per_px and placed by its frame (y rearward from the front
axle at y0_px, z up from the ground row z0_px), so the car must come from that blueprint's spec.
Body pixels are laid over the drawing at --alpha; the background (the colour of the render's corner)
is left out. Prints `OVERLAY {...}` with the body's extent in drawing pixels.
"""

import argparse
import json

from PIL import Image


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--blueprint", required=True)
    ap.add_argument("--drawing", required=True)
    ap.add_argument("--render", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--alpha", type=float, default=0.45)
    ap.add_argument("--margin", type=int, default=40, help="px of drawing kept around the car")
    a = ap.parse_args()
    sc = json.load(open(a.blueprint))["scale"]
    meta = json.load(open(a.render + "_side.json"))
    side = Image.open(a.render + "_side.png").convert("RGB")
    drawing = Image.open(a.drawing).convert("RGB")

    k = meta["mm_per_px"] / sc["mm_per_px"]  # render px -> drawing px
    w, h = side.size
    side = side.resize((round(w * k), round(h * k)), Image.LANCZOS)
    bg = side.getpixel((0, 0))
    mask = Image.new("L", side.size, 0)
    px, mpx = side.load(), mask.load()
    for yy in range(side.height):
        for xx in range(side.width):
            r, g, b = px[xx, yy]
            if abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2]) > 24:
                mpx[xx, yy] = round(255 * a.alpha)
    # the render's centre pixel is world (y, z) = centre_mm
    cy, cz = meta["centre_mm"]
    left = round(sc["y0_px"] + cy / sc["mm_per_px"] - side.width / 2)
    top = round(sc["z0_px"] - cz / sc["mm_per_px"] - side.height / 2)
    out = drawing.copy()
    out.paste(side, (left, top), mask)
    box = mask.getbbox()
    if box:
        x0, y0, x1, y1 = box[0] + left, box[1] + top, box[2] + left, box[3] + top
        m = a.margin
        out = out.crop((max(0, x0 - m), max(0, y0 - m), min(out.width, x1 + m), min(out.height, y1 + m)))
        print("OVERLAY " + json.dumps({"body_px": [x0, y0, x1, y1]}))
    out.save(a.out)
    print("WROTE " + a.out)


if __name__ == "__main__":
    main()
