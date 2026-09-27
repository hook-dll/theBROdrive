"""Shared helpers for the blueprint-to-shell car toolkit. Runs inside Blender's Python.

Everything here works in one metric convention, the same one the imported cars use
(`tools/vehicle-pipeline.md`): Blender +X is the car's left, -Y its nose, +Z up. The
ground is z = 0 and the car is centred on x = 0 and on the middle of its length.

A *view* is an orthographic silhouette on a fixed metric grid of PX_PER_M pixels per
metre, seen as a camera outside the car sees it (never mirrored):

    side   camera on +X (left) looking at -X   image right = +Y (tail), up = +Z
    top    camera above, looking down          image right = +Y (tail), up = -X (right side)
    front  camera ahead, looking at +Y         image right = +X (left),  up = +Z
    rear   camera behind, looking at -Y        image right = -X (right), up = +Z

so a blueprint only has to be flipped into that orientation once, in the car spec.
"""
from __future__ import annotations

import json
from pathlib import Path

import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
PX_PER_M = 200  # 5 mm per pixel
MARGIN_M = 0.25

VIEWS = {
    # name: (image-right axis, sign, image-up axis, sign) in Blender coordinates
    'side': ('y', 1, 'z', 1),
    'top': ('y', 1, 'x', -1),
    'front': ('x', 1, 'z', 1),
    'rear': ('x', -1, 'z', 1),
}

def load_spec(path: str | Path) -> dict:
    spec = json.loads(Path(path).read_text())
    spec['_path'] = str(Path(path).resolve())
    spec['_work'] = ROOT / spec['work']
    return spec


def view_window(spec: dict, view: str) -> tuple[float, float, float, float]:
    """Metric bounds (h0, h1, v0, v1) of a view's grid along its image axes."""
    f = spec['factory']
    half = {'x': f['widthM'] / 2 + 0.15, 'y': f['lengthM'] / 2, 'z': None}
    h_axis, _, v_axis, _ = VIEWS[view]

    def span(axis: str) -> tuple[float, float]:
        if axis == 'z':
            return -MARGIN_M, f['heightM'] + MARGIN_M
        return -half[axis] - MARGIN_M, half[axis] + MARGIN_M

    return (*span(h_axis), *span(v_axis))


def grid_shape(spec: dict, view: str) -> tuple[int, int]:
    h0, h1, v0, v1 = view_window(spec, view)
    return round((v1 - v0) * PX_PER_M), round((h1 - h0) * PX_PER_M)


# --- image IO (bpy has no PIL; numpy + bpy.data.images is enough) ------------------

def read_rgb(path: str | Path) -> np.ndarray:
    """HxWx3 linear RGB in [0, 1], row 0 = TOP; transparent pixels read as white."""
    image = bpy.data.images.load(str(path), check_existing=False)
    width, height = image.size
    rgba = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(rgba)
    bpy.data.images.remove(image)
    rgba = rgba.reshape(height, width, 4)[::-1]
    return np.where(rgba[..., 3:] < 0.5, 1.0, rgba[..., :3])


def luminance(rgb: np.ndarray) -> np.ndarray:
    return rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


def read_gray(path: str | Path) -> np.ndarray:
    return luminance(read_rgb(path))


def write_rgb(path: str | Path, rgb: np.ndarray) -> None:
    """Write an HxWx3 float image (row 0 = top) as PNG."""
    height, width = rgb.shape[:2]
    rgba = np.ones((height, width, 4), dtype=np.float32)
    rgba[..., :3] = np.clip(rgb, 0, 1)
    image = bpy.data.images.new(Path(path).stem, width, height, alpha=False)
    image.pixels.foreach_set(rgba[::-1].ravel())
    image.filepath_raw = str(path)
    image.file_format = 'PNG'
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    image.save()
    bpy.data.images.remove(image)


def write_mask(path: str | Path, mask: np.ndarray) -> None:
    write_rgb(path, np.repeat(mask[..., None].astype(np.float32), 3, axis=2))


def read_mask(path: str | Path) -> np.ndarray:
    return read_gray(path) > 0.5


# --- binary morphology without scipy ----------------------------------------------

def dilate(mask: np.ndarray, radius: int) -> np.ndarray:
    out = mask.copy()
    for _ in range(radius):
        grown = out.copy()
        grown[1:] |= out[:-1]
        grown[:-1] |= out[1:]
        grown[:, 1:] |= out[:, :-1]
        grown[:, :-1] |= out[:, 1:]
        out = grown
    return out


def erode(mask: np.ndarray, radius: int) -> np.ndarray:
    return ~dilate(~mask, radius)


def _expand_runs(seed: np.ndarray, free: np.ndarray) -> np.ndarray:
    """Within one row: every run of `free` pixels that contains a seed."""
    starts = free & ~np.concatenate(([False], free[:-1]))
    ids = np.cumsum(starts) * free
    hit = np.unique(ids[seed & free])
    hit = hit[hit > 0]
    return np.isin(ids, hit) & free


def fill(free: np.ndarray, seed: np.ndarray) -> np.ndarray:
    """Pixels of `free` 4-connected to `seed` (scanline passes to a fixpoint)."""
    reached = seed & free
    rows = free.shape[0]
    while True:
        before = int(reached.sum())
        for order in (range(rows), range(rows - 1, -1, -1)):
            previous = None
            for r in order:
                row_seed = reached[r] if previous is None else reached[r] | (reached[previous] & free[r])
                reached[r] = _expand_runs(row_seed, free[r])
                previous = r
        # Column passes let the fill turn corners the row sweeps cannot.
        for c in range(free.shape[1]):
            reached[:, c] = _expand_runs(reached[:, c], free[:, c])
        if int(reached.sum()) == before:
            return reached


def fill_from_border(free: np.ndarray) -> np.ndarray:
    seed = np.zeros_like(free)
    seed[0] = seed[-1] = True
    seed[:, 0] = seed[:, -1] = True
    return fill(free, seed)


def largest_component(mask: np.ndarray) -> np.ndarray:
    remaining = mask.copy()
    best = np.zeros_like(mask)
    while remaining.any():
        seed = np.zeros_like(mask)
        seed.flat[np.flatnonzero(remaining)[0]] = True
        component = fill(remaining, seed)
        remaining &= ~component
        if component.sum() > best.sum():
            best = component
    return best


def silhouette_from_drawing(rgb: np.ndarray, view: dict) -> np.ndarray:
    """Solid silhouette of one drawing view.

    mode "lines": a line drawing on paper. Ink (luminance < `ink`) is dilated by
    `closePx` before the outside is flooded, so hairline gaps cannot let it leak in.
    mode "filled": a shaded drawing. Paper is anything lighter than `paper` AND less
    saturated than `paperSat` -- the second test lets a neutral grey watermark count
    as paper while a faintly tinted body fill does not. Everything the paper cannot
    reach is body; an opening of `openPx` strips leftover strokes and hairline stalks,
    and only the largest piece is kept.
    """
    gray = luminance(rgb)
    if view.get('mode', 'lines') == 'filled':
        saturation = rgb.max(axis=2) - rgb.min(axis=2)
        paper = (gray > view.get('paper', 0.97)) & (saturation < view.get('paperSat', 1.0))
        body = ~fill_from_border(paper)
        radius = view.get('openPx', 2)
        return largest_component(dilate(erode(body, radius), radius))
    close_px = view.get('closePx', 2)
    lines = dilate(gray < view.get('ink', 0.5), close_px)
    outside = fill_from_border(~lines)
    return erode(~outside, close_px)


def outline_check(drawing: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """The drawing with the extracted silhouette tinted and its edge in red."""
    rgb = np.repeat(drawing[..., None], 3, axis=2)
    rgb[mask] = rgb[mask] * np.array([0.8, 0.9, 1.0])
    rgb[mask & ~erode(mask, 1)] = (0.95, 0.1, 0.05)
    return rgb


def iou(a: np.ndarray, b: np.ndarray) -> float:
    union = np.count_nonzero(a | b)
    return np.count_nonzero(a & b) / union if union else 1.0


def overlay(reference_gray: np.ndarray | None, reference: np.ndarray, model: np.ndarray) -> np.ndarray:
    """Model-only pixels red, reference-only blue, agreement gray, over the drawing."""
    base = np.full(reference.shape, 1.0, dtype=np.float32) if reference_gray is None else reference_gray
    rgb = np.repeat(base[..., None] * 0.55 + 0.45, 3, axis=2)
    both = reference & model
    rgb[both] *= np.array([0.78, 0.78, 0.78])
    rgb[model & ~reference] = (0.9, 0.15, 0.1)
    rgb[reference & ~model] = (0.1, 0.35, 0.95)
    if reference_gray is not None:
        ink = reference_gray < 0.5
        rgb[ink] = rgb[ink] * 0.35
    return rgb
