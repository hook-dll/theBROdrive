"""Checks a built body against the photograph it was read from.

    blender --background --factory-startup --python tools/carshape/overlay.py -- \\
        <body.glb> <spec.json> <photo> <out.png> uF vF uR vR

Renders the body's side orthographically at the photo's own scale (the wheelbase between
the two wheel centres uF,vF and uR,vR, as photosheet.py calibrates it), lines the
model's front axle up with the photo's front wheel, and draws the model's outline and a
light tint of its glass over the picture. Where the outline leaves the car, the lines
are wrong there.
"""
import json
import math
import sys

import bpy
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:]
glb, spec_path, photo, out = argv[:4]
uF, vF, uR, vR = (float(v) for v in argv[4:8])
F = json.load(open(spec_path))['factory']
L, R, WB = F['length'], F['wheelRadius'], F['wheelbase']
y_front = -L / 2 + F['frontOverhang']

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
sc = bpy.context.scene
px_per_m = abs(uR - uF) / WB
nose_right = uF > uR


def frame_camera():
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.render.film_transparent = True
    sc.render.resolution_x = int(span_y * px_per_m)
    sc.render.resolution_y = int(span_z * px_per_m)
    if sc.camera is None:
        cam = bpy.data.objects.new('cam', bpy.data.cameras.new('c'))
        cam.data.type = 'ORTHO'
        cam.data.ortho_scale = max(span_y, span_z)
        sc.collection.objects.link(cam)
        sc.camera = cam
    cam = sc.camera
    # glTF import puts the car back in Blender's frame: nose -Y, left +X, up +Z.
    if nose_right:
        cam.location = (-6, 0, cz)          # from the car's right: the nose is on the right
        cam.rotation_euler = (math.pi / 2, 0, -math.pi / 2)
    else:
        cam.location = (6, 0, cz)
        cam.rotation_euler = (math.pi / 2, 0, math.pi / 2)


span_y, span_z = L + 0.6, F['height'] + 0.4
cz = span_z / 2 - 0.2
# First the model as it looks (studio light, its own materials, the paint a mid grey),
# at the photo's scale and framing, for a side-by-side with the photograph:
# <out>-shaded.png (the same pixel frame as <out>-model.png).
for obj in sc.objects:
    for slot in getattr(obj, 'material_slots', []):
        if slot.material is not None and slot.material.name == 'car_paint':
            slot.material.diffuse_color = (0.62, 0.62, 0.6, 1)
frame_camera()
sc.display.shading.light = 'STUDIO'
sc.display.shading.color_type = 'MATERIAL'
sc.display.shading.show_object_outline = False
sc.render.filepath = out.replace('.png', '-shaded.png')
bpy.ops.render.render(write_still=True)
# Glass tinted blue, everything else white, on a transparent background.
for obj in sc.objects:
    if obj.type != 'MESH':
        continue
    for slot in obj.material_slots:
        if slot.material is None:
            continue
        glass = 'glass' in slot.material.name.lower()
        slot.material.diffuse_color = (0.2, 0.5, 1.0, 1) if glass else (1, 1, 1, 1)
sc.display.shading.light = 'FLAT'
sc.display.shading.color_type = 'MATERIAL'
frame_camera()
render_path = out.replace('.png', '-model.png')
sc.render.filepath = render_path
bpy.ops.render.render(write_still=True)

# Composite in Blender's own image API: no Pillow needed.
model = bpy.data.images.load(render_path)
mw, mh = model.size
m = np.array(model.pixels[:]).reshape(mh, mw, 4)[::-1]           # top row first
ph = bpy.data.images.load(photo)
pw, phh = ph.size
p = np.array(ph.pixels[:]).reshape(phh, pw, 4)[::-1].copy()
# Model pixel of the front axle centre: the camera centre is (y=0, z=cz).
sign = 1 if nose_right else -1
mx = mw / 2 + sign * (-y_front) * px_per_m
my = mh / 2 - (R - cz) * px_per_m
ox, oy = int(round(uF - mx)), int(round(vF - my))
alpha = m[:, :, 3] > 0.5
edge = alpha ^ np.roll(alpha, 1, 0) | alpha ^ np.roll(alpha, 1, 1)
edge = edge | np.roll(edge, 1, 0) | np.roll(edge, 1, 1)
glass = alpha & (m[:, :, 2] > 0.8) & (m[:, :, 0] < 0.5)
for yy in range(mh):
    py = yy + oy
    if not 0 <= py < phh:
        continue
    xs = np.arange(mw) + ox
    ok = (xs >= 0) & (xs < pw)
    row_e, row_g = edge[yy] & ok, glass[yy] & ok
    p[py, xs[row_g], :3] = p[py, xs[row_g], :3] * 0.6 + np.array([0.1, 0.35, 1.0]) * 0.4
    p[py, xs[row_e], :3] = np.array([1.0, 0.1, 0.6])
outimg = bpy.data.images.new('overlay', pw, phh, alpha=True)
outimg.pixels[:] = p[::-1].ravel()
outimg.filepath_raw = out
outimg.file_format = 'PNG'
outimg.save()
print('OVERLAY', out)
