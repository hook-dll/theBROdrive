"""Normalizes one body of Rgsdev's Free Low Poly Vehicles Pack into the runtime contract.

    blender --background --factory-startup --python tools/carshape/normalize_rgs.py -- <Name.fbx> <out.glb>

The pack (CC0, Raphael Gonçalves, https://opengameart.org/content/free-low-poly-vehicles-pack)
draws each vehicle as one body mesh plus four wheel objects, nose toward -Y and the
car's left toward +X, which is already the orientation the glTF exporter turns into the
game's nose +Z, left +X. Its materials are named by role, so the mapping is by name:

    body <colour>  -> car_paint         the painted panels
    body black     -> car_trim          bumpers, sills, grille
    body white     -> car_trim_light    plates and small bright trim, kept white
    windows        -> car_glass         split out as the `glass` node
    headlights     -> Headlights        split out as the `headlights` node
    rear lights    -> TailLights        split out as the `taillights` node
    wheels / tires -> wheel_rim / Tyres on `wheel_fl` .. `wheel_rr`

Nothing is reshaped: the loader stretches the body to each car's published length,
width and height and places the axles itself (render/carmodel.ts).
"""
import sys

import bpy

argv = sys.argv[sys.argv.index('--') + 1:]
src, out = argv[0], argv[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src)
scene = bpy.context.scene

MATERIAL_ROLES = {
    'body black': 'car_trim',
    'body white': 'car_trim_light',
    'windows': 'car_glass',
    'headlights': 'Headlights',
    'rear lights': 'TailLights',
    'wheels': 'wheel_rim',
    'tires': 'Tyres',
}
WHEELS = {
    'front left': 'wheel_fl',
    'front right': 'wheel_fr',
    'rear left': 'wheel_rl',
    'rear right': 'wheel_rr',
}

for material in bpy.data.materials:
    name = material.name.split('.')[0]
    if name in MATERIAL_ROLES:
        material.name = MATERIAL_ROLES[name]
    elif name.startswith('body '):
        material.name = 'car_paint'

# The pack's rims and lenses are near-white and metallic, which under the game's sky
# reads as a lavender glow next to every other car's grey steel. Brought to the same
# finish as the other packs' rims and unlit lenses.
FINISH = {
    'wheel_rim': ((0.34, 0.35, 0.36), 0.2, 0.55),
    'Headlights': ((0.62, 0.62, 0.6), 0.0, 0.3),
    'TailLights': ((0.45, 0.04, 0.03), 0.0, 0.35),
}
for material in bpy.data.materials:
    if material.name in FINISH and material.use_nodes:
        rgb, metal, rough = FINISH[material.name]
        bsdf = next((n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if bsdf:
            bsdf.inputs['Base Color'].default_value = (*rgb, 1)
            bsdf.inputs['Metallic'].default_value = metal
            bsdf.inputs['Roughness'].default_value = rough

body = None
for obj in list(scene.objects):
    if obj.type != 'MESH':
        continue
    lowered = obj.name.lower()
    wheel = next((WHEELS[k] for k in WHEELS if k in lowered), None)
    if wheel:
        obj.name = wheel
        obj.data.name = wheel
    elif 'wheel' not in lowered:
        body = obj
        obj.name = 'paint'
        obj.data.name = 'paint'
if body is None:
    sys.exit('no body mesh')

# The lenses and the glass become their own nodes: the vehicle drives each lamp channel
# by node name, and the glass is the one material every car shares.
bpy.context.view_layer.objects.active = body
for material_name, node in (('Headlights', 'headlights'), ('TailLights', 'taillights'), ('car_glass', 'glass')):
    index = body.data.materials.find(material_name)
    if index < 0:
        continue
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='DESELECT')
    body.active_material_index = index
    bpy.ops.object.material_slot_select()
    bpy.ops.mesh.separate(type='SELECTED')
    bpy.ops.object.mode_set(mode='OBJECT')
    for obj in scene.objects:
        if obj.name.startswith('paint.'):
            obj.name = node
            obj.data.name = node

# Life-size-ish: the pack is about 1.6 times real. The loader fits the exact figures;
# this only keeps the source in the same range as every other pack.
for obj in scene.objects:
    if obj.parent is None:
        obj.scale = [s / 1.6 for s in obj.scale]
        obj.location = [c / 1.6 for c in obj.location]

faces = sum(len(o.data.polygons) for o in scene.objects if o.type == 'MESH')
print(f'RGS {src}: {[o.name for o in scene.objects if o.type == "MESH"]}, {faces} faces')
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True, export_yup=True)
print(f'RGS wrote {out}')
