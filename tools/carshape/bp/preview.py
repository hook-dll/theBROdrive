"""Renders a mesh or a glb from the four judging angles (Blender, workbench).

    blender --background --factory-startup --python tools/carshape/bp/preview.py -- <in.ply|in.glb> <out.png> [L H]
"""
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
src, out = argv[0], argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
if src.endswith('.ply'):
    bpy.ops.wm.ply_import(filepath=src)
else:
    bpy.ops.import_scene.gltf(filepath=src)
objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
lo = Vector((1e9, 1e9, 1e9))
hi = -lo
for o in objs:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        lo = Vector(map(min, lo, w))
        hi = Vector(map(max, hi, w))
size = hi - lo
centre = (hi + lo) / 2
for o in objs:
    if src.endswith('.ply'):
        mat = bpy.data.materials.new('m')
        mat.diffuse_color = (0.62, 0.15, 0.1, 1)
        o.data.materials.append(mat)
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
        bpy.ops.object.shade_smooth()
sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'STUDIO'
sc.display.shading.color_type = 'MATERIAL'
sc.display.shading.show_object_outline = True
sc.display.shading.show_specular_highlight = True
sc.render.resolution_x = 1100
sc.render.resolution_y = 680
sc.world = bpy.data.worlds.new('w')
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('c'))
cam.data.lens = 55
sc.collection.objects.link(cam)
sc.camera = cam
# Car frames are y-up glTF (nose +z) or the builder's z-up (nose -y).
gl = src.endswith('.glb')
L = max(size.x, size.y, size.z)
Hh = size.z if not gl else size.z
target = centre
views = {
    'front34': Vector((L * 0.95, -L * 1.2, L * 0.33)),
    'side': Vector((L * 1.75, 0, L * 0.1)),
    'rear34': Vector((-L * 0.95, L * 1.2, L * 0.36)),
    'front': Vector((0, -L * 1.9, L * 0.12)),
    'top': Vector((0, 0.001, L * 2.2)),
}
for name, pos in views.items():
    cam.location = target + pos
    cam.rotation_euler = (-pos).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = out.replace('.png', f'-{name}.png')
    bpy.ops.render.render(write_still=True)
