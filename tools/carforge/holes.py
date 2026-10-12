"""Watertightness check of a car FBX: does the sky show through the body? (plain Python)

    python3 tools/carforge/holes.py <car.fbx> [--prefix build/carforge/<id>/holes] [--max PX]

Renders the body without its wheels (render.py, `--hide wheel`) on magenta with backface culling,
as the game draws it (three.js FrontSide), in all six views, and counts the background pixels
enclosed by the car's silhouette: the sky seen through a slit between panels, a dropped face, a
panel facing inward. Wheels are hidden because the arches are open to the road by design. Each view
with holes is written as <prefix>_<view>_holes.png, holes in yellow. Exit status 1 if any view has
more than `--max` (default 0) hole pixels.
"""

import argparse
import json
import os
import subprocess
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
BLENDER = os.environ.get("BLENDER", "/Applications/Blender.app/Contents/MacOS/Blender")
VIEWS = ("side", "front", "rear", "top", "q", "qrear")
BG_TOLERANCE = 18  # summed RGB distance from the corner pixel that still counts as background


def holes(path):
    """Background pixels not connected to the image border, as a bool mask."""
    im = np.asarray(Image.open(path).convert("RGB")).astype(int)
    bg = np.abs(im - im[1, 1]).sum(axis=2) < BG_TOLERANCE
    lab, _ = ndi.label(bg)
    border = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    return bg & ~np.isin(lab, border), im


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("fbx")
    ap.add_argument("--prefix")
    ap.add_argument("--max", type=int, default=0)
    ap.add_argument("--size", type=int, nargs=2, default=[2400, 1400])
    a = ap.parse_args()
    prefix = a.prefix or os.path.join(os.path.dirname(os.path.abspath(a.fbx)), "holes")
    run = subprocess.run([BLENDER, "--background", "--factory-startup", "--python",
                          os.path.join(HERE, "render.py"), "--", "--fbx", a.fbx, "--prefix", prefix,
                          "--size", *map(str, a.size), "--bg", "1", "0", "1", "--hide", "wheel"],
                         capture_output=True, text=True)
    if run.returncode:
        sys.exit("render.py failed:\n" + run.stderr[-2000:])
    counts = {}
    for view in VIEWS:
        mask, im = holes(f"{prefix}_{view}.png")
        counts[view] = int(mask.sum())
        if counts[view]:
            im[mask] = (255, 255, 0)
            Image.fromarray(im.astype(np.uint8)).save(f"{prefix}_{view}_holes.png")
    print("HOLES " + json.dumps(counts))
    sys.exit(1 if max(counts.values()) > a.max else 0)


if __name__ == "__main__":
    main()
