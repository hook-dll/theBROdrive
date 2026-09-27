"""Measure a model against the blueprint silhouettes.

    Blender --background --factory-startup --python tools/blueprint-car/evaluate.py -- \
        <car.json> <model.glb> [out-dir]

Renders an orthographic silhouette of the model for every view that stage 10 masked,
on exactly the same metric grid, and scores it with intersection-over-union. The
overlay marks model-only pixels red and blueprint-only pixels blue over the drawing,
which is where to look next. This is the acceptance measurement for body shape:
nothing else in the toolkit decides "close enough".
"""
import json
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (PX_PER_M, VIEWS, grid_shape, iou, load_spec, overlay, read_gray,  # noqa: E402
                    read_mask, view_window, write_rgb)

args = sys.argv[sys.argv.index('--') + 1:]
spec = load_spec(args[0])
model = Path(args[1]).resolve()
out_dir = Path(args[2]).resolve() if len(args) > 2 else model.parent / 'eval'
refs = spec['_work'] / '10-refs'

bpy.ops.wm.read_factory_settings(use_empty=True)
if model.suffix == '.blend':
    bpy.ops.wm.open_mainfile(filepath=str(model))
else:
    bpy.ops.import_scene.gltf(filepath=str(model))
scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'FLAT'
scene.display.shading.color_type = 'SINGLE'
scene.display.render_aa = 'OFF'
scene.render.film_transparent = True
scene.render.image_settings.color_mode = 'RGBA'

AXIS = {'x': Vector((1, 0, 0)), 'y': Vector((0, 1, 0)), 'z': Vector((0, 0, 1))}


def render_silhouette(view: str) -> np.ndarray:
    h_axis, h_sign, v_axis, v_sign = VIEWS[view]
    right, up = AXIS[h_axis] * h_sign, AXIS[v_axis] * v_sign
    toward_viewer = right.cross(up)  # camera local +Z; it looks along -Z
    h0, h1, v0, v1 = view_window(spec, view)
    centre = right * ((h0 + h1) / 2) + up * ((v0 + v1) / 2)
    data = bpy.data.cameras.new(view)
    data.type = 'ORTHO'
    data.ortho_scale = max(h1 - h0, v1 - v0)
    data.sensor_fit = 'AUTO'
    data.clip_start, data.clip_end = 0.01, 50
    cam = bpy.data.objects.new(view, data)
    scene.collection.objects.link(cam)
    rotation = Matrix((right, up, toward_viewer)).transposed().to_4x4()
    cam.matrix_world = Matrix.Translation(centre + toward_viewer * 20) @ rotation
    height, width = grid_shape(spec, view)
    scene.render.resolution_x, scene.render.resolution_y = width, height
    scene.render.resolution_percentage = 100
    scene.camera = cam
    path = out_dir / f'{view}-model.png'
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    image = bpy.data.images.load(str(path))
    rgba = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(rgba)
    bpy.data.images.remove(image)
    return rgba.reshape(height, width, 4)[::-1, :, 3] > 0.5


out_dir.mkdir(parents=True, exist_ok=True)
scores = {}
for view in VIEWS:
    mask_path = refs / f'{view}-mask.png'
    if not mask_path.exists():
        continue
    reference = read_mask(mask_path)
    drawing = read_gray(refs / f'{view}-drawing.png')
    model_mask = render_silhouette(view)
    assert model_mask.shape == reference.shape, (view, model_mask.shape, reference.shape)
    scored = np.ones_like(reference)
    h0, h1, v0, v1 = view_window(spec, view)
    hs = h0 + (np.arange(reference.shape[1]) + 0.5) / PX_PER_M
    vs = v1 - (np.arange(reference.shape[0]) + 0.5) / PX_PER_M
    hh, vv = np.meshgrid(hs, vs)
    body_spec = spec.get('body', {})
    # Tyres are not body: the game fits real wheels. Score the body around them.
    if view == 'side':
        gap = body_spec.get('tyreGapM', 0.01)
        for wheel in body_spec.get('wheels', []):
            scored &= (hh - wheel['y']) ** 2 + (vv - wheel['z']) ** 2 > (wheel['radius'] + gap) ** 2
    elif view in ('front', 'rear') and 'floor' in body_spec:
        scored &= vv >= min(z for _, z in body_spec['floor'])
    scores[view] = {
        'iou': round(iou(reference & scored, model_mask & scored), 4),
        'modelOnlyPx': int(np.count_nonzero(model_mask & ~reference & scored)),
        'blueprintOnlyPx': int(np.count_nonzero(reference & ~model_mask & scored)),
        'pxPerM': PX_PER_M,
    }
    write_rgb(out_dir / f'{view}-overlay.png', overlay(drawing, reference, model_mask))
    print('SCORE', view, json.dumps(scores[view]))

(out_dir / 'scores.json').write_text(json.dumps(scores, indent=2) + '\n')
