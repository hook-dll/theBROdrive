"""Renders a body (glb, or a soviet-pack fbx with its palette) from fixed views placed
relative to its own bounds, so two cars of different sizes are seen the same way.

    blender -b --factory-startup --python tools/carshape/kit/compare.py -- <in.glb|fbx> <out.png>
"""
import sys

import bpy
from mathutils import Vector

a = sys.argv[sys.argv.index('--') + 1:]
src, out = a[0], a[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
if src.endswith('.fbx'):
    bpy.ops.import_scene.fbx(filepath=src)
    img = bpy.data.images.load(src.rsplit('/', 1)[0] + '/albedo.png')
    mat = bpy.data.materials.new('albedo')
    mat.use_nodes = True
    nt = mat.node_tree
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    tex.interpolation = 'Closest'
    nt.links.new(tex.outputs['Color'], nt.nodes['Principled BSDF'].inputs['Base Color'])
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            o.data.materials.clear()
            o.data.materials.append(mat)
    color = 'TEXTURE'
else:
    bpy.ops.import_scene.gltf(filepath=src)
    for m in bpy.data.materials:
        if m.name == 'car_paint':
            m.diffuse_color = (0.89, 0.84, 0.55, 1)
    color = 'MATERIAL'
sc = bpy.context.scene
objs = [o for o in sc.objects if o.type == 'MESH']
for o in objs:
    o.data.shade_flat() if not o.name.split('.')[-1].startswith('wheel') else None
lo = Vector((1e9,) * 3)
hi = -lo
for o in objs:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        lo = Vector(map(min, lo, w))
        hi = Vector(map(max, hi, w))
c = (lo + hi) / 2
s = hi - lo
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'STUDIO'
sc.display.shading.color_type = color
sc.display.shading.show_specular_highlight = True
sc.render.resolution_x, sc.render.resolution_y = 900, 600
sc.world = bpy.data.worlds.new('w')
cam = bpy.data.objects.new('c', bpy.data.cameras.new('c'))
sc.collection.objects.link(cam)
sc.camera = cam


def P(fy, fx, fz):
    """A point in the car's own frame: fractions of its half-length, half-width, height."""
    return Vector((c.x + fx * s.x / 2, c.y + fy * s.y / 2, lo.z + fz * s.z))


views = {
    'front34': (P(-2.3, 1.9, 1.2), P(0, 0, 0.45), 40),
    'rear34': (P(2.3, -1.9, 1.3), P(0, 0, 0.45), 40),
    'side': (P(0, 4.2, 0.5), P(0, 0, 0.5), 40),
    'apillar': (P(-0.75, 1.9, 1.25), P(-0.22, 0.75, 0.78), 35),
    'bpillar': (P(0.15, 2.1, 1.15), P(0.15, 0.8, 0.75), 35),
    'tail': (P(1.6, 1.5, 0.9), P(0.95, 0.4, 0.55), 35),
    'nose': (P(-1.6, 1.3, 0.55), P(-0.95, 0.3, 0.45), 35),
}
for n, (p, t, lens) in views.items():
    cam.data.lens = lens
    cam.location = p
    cam.rotation_euler = (t - p).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = out.replace('.png', f'-{n}.png')
    bpy.ops.render.render(write_still=True)
