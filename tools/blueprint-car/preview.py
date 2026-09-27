"""Render a model from the car spec's photo-matched cameras (or default angles).

    Blender --background --factory-startup --python tools/blueprint-car/preview.py -- \
        <car.json> <model.glb> [out-dir]

Each camera in spec["previews"] is {"name", "location": [x, y, z], "target": [x, y, z],
"lens": mm}; the defaults are front/rear three-quarter and a low side view. Workbench
studio light with material colours and backface culling, which is how holes and
flipped faces show up.
"""
import sys
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import load_spec  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:]
spec = load_spec(args[0])
model = Path(args[1]).resolve()
out_dir = Path(args[2]).resolve() if len(args) > 2 else model.parent / 'preview'
out_dir.mkdir(parents=True, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(model))
scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'MATERIAL'
scene.display.shading.show_backface_culling = True
scene.display.shading.show_cavity = True
scene.world = scene.world or bpy.data.worlds.new('world')
scene.world.color = (0.55, 0.57, 0.6)
scene.render.resolution_x, scene.render.resolution_y = 1400, 800

DEFAULTS = [
    {'name': 'front34', 'location': [3.6, -4.6, 1.4], 'target': [0, -0.3, 0.6], 'lens': 45},
    {'name': 'rear34', 'location': [-3.6, 4.8, 1.5], 'target': [0, 0.3, 0.6], 'lens': 45},
    {'name': 'side', 'location': [7.5, 0, 0.8], 'target': [0, 0, 0.7], 'lens': 50},
    {'name': 'front', 'location': [0, -8, 0.8], 'target': [0, 0, 0.7], 'lens': 60},
]
for view in spec.get('previews', DEFAULTS):
    data = bpy.data.cameras.new(view['name'])
    data.lens = view.get('lens', 45)
    cam = bpy.data.objects.new(view['name'], data)
    scene.collection.objects.link(cam)
    cam.location = view['location']
    cam.rotation_euler = (Vector(view['target']) - Vector(view['location'])).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    scene.render.filepath = str(out_dir / f"{view['name']}.png")
    bpy.ops.render.render(write_still=True)
    print('PREVIEW', scene.render.filepath)
