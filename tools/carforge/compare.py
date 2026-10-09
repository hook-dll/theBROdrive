"""Overlay a carforge render on the traced drawing, in any orthographic view (plain Python + Pillow).

    python3 tools/carforge/compare.py --blueprint tools/carforge/examples/blueprint_uaz3151.json \
        --drawing build/carforge/refs/uaz_blueprint.gif --render build/carforge/renders/uaz3151 \
        --out build/carforge/renders/uaz3151_overlay.png [--view side|front|top|rear]

--render is the prefix render.py was given: it reads <prefix>_<view>.png and <prefix>_<view>.json.
The render is scaled to the blueprint's mm_per_px and placed by the blueprint's view anchors, so the
car must come from that blueprint's spec:

  side   y rearward from the front axle at column y0_px, z up from the ground row z0_px
  front  x (car left) to the right of column x0_px, z up from z0_px
  rear   x (car left) to the left of column rear_x0_px, z up from z0_px
  top    y as in the side view (y0_px; the top view is drawn under it, columns aligned), x (car left)
         downward from the centre row top_x0_px

If the blueprint's scale has `deskew` {deg, centre} (trace.py levels a scan whose tyres do not sit
on one row), the drawing is rotated the same way first, so the blueprint's pixels fit it.
Body pixels are laid over the drawing at --alpha; the background (the colour of the render's corner)
is left out. Prints `OVERLAY {...}` with the body's extent in drawing pixels.
"""

import argparse
import json

from PIL import Image

# view -> blueprint scale keys of the drawing column and row that the render's image centre is
# measured from. The render and the drawing share their orientation in every view (render.py's axes),
# so a point at signed image-right coordinate s and image-up coordinate u is at drawing column
# col0 + s / mm_per_px, row row0 - u / mm_per_px.
ANCHORS = {
    "side": ("y0_px", "z0_px"),
    "front": ("x0_px", "z0_px"),
    "rear": ("rear_x0_px", "z0_px"),
    "top": ("y0_px", "top_x0_px"),
}
# the render's (right, up) world axes per view, as render.py writes them
AXES = {"side": ["+y", "+z"], "front": ["+x", "+z"], "rear": ["-x", "+z"], "top": ["+y", "-x"]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--blueprint", required=True)
    ap.add_argument("--drawing", required=True)
    ap.add_argument("--render", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--view", choices=sorted(ANCHORS), default="side")
    ap.add_argument("--alpha", type=float, default=0.45)
    ap.add_argument("--margin", type=int, default=40, help="px of drawing kept around the car")
    a = ap.parse_args()
    sc = json.load(open(a.blueprint))["scale"]
    meta = json.load(open(f"{a.render}_{a.view}.json"))
    if meta.get("axes", AXES[a.view]) != AXES[a.view]:
        raise SystemExit(f"compare: {a.render}_{a.view}.json axes {meta['axes']} != {AXES[a.view]}")
    col_key, row_key = ANCHORS[a.view]
    for key in (col_key, row_key):
        if key not in sc:
            raise SystemExit(f"compare: blueprint scale has no {key!r} for the {a.view} view")
    view = Image.open(f"{a.render}_{a.view}.png").convert("RGB")
    drawing = Image.open(a.drawing).convert("RGB")
    if "deskew" in sc:
        d = sc["deskew"]
        drawing = drawing.rotate(d["deg"], resample=Image.BICUBIC, center=tuple(d["centre"]),
                                 fillcolor=(255, 255, 255))

    k = meta["mm_per_px"] / sc["mm_per_px"]  # render px -> drawing px
    w, h = view.size
    view = view.resize((round(w * k), round(h * k)), Image.LANCZOS)
    bg = view.getpixel((0, 0))
    mask = Image.new("L", view.size, 0)
    px, mpx = view.load(), mask.load()
    for yy in range(view.height):
        for xx in range(view.width):
            r, g, b = px[xx, yy]
            if abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2]) > 24:
                mpx[xx, yy] = round(255 * a.alpha)
    # the render's centre pixel is world (right axis, up axis) = centre_mm, signed by the axes
    ax_r, ax_u = AXES[a.view]
    cr = meta["centre_mm"][0] * (1 if ax_r[0] == "+" else -1)
    cu = meta["centre_mm"][1] * (1 if ax_u[0] == "+" else -1)
    left = round(sc[col_key] + cr / sc["mm_per_px"] - view.width / 2)
    top = round(sc[row_key] - cu / sc["mm_per_px"] - view.height / 2)
    out = drawing.copy()
    out.paste(view, (left, top), mask)
    box = mask.getbbox()
    if box:
        x0, y0, x1, y1 = box[0] + left, box[1] + top, box[2] + left, box[3] + top
        m = a.margin
        out = out.crop((max(0, x0 - m), max(0, y0 - m), min(out.width, x1 + m), min(out.height, y1 + m)))
        print("OVERLAY " + json.dumps({"view": a.view, "body_px": [x0, y0, x1, y1]}))
    out.save(a.out)
    print("WROTE " + a.out)


if __name__ == "__main__":
    main()
