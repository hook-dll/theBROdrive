"""Orthographic trace sheets of a reference mesh on the car's real dimensions.

    blender --background --factory-startup --python tools/carshape/sheets.py -- <car.json> <outdir>

Warps the reference exactly as loft.py does (axles on the factory wheelbase, width and
height to the catalogue) and renders it side, top, front and rear with an orthographic
camera over a 0.1 m grid, labelled every 0.5 m, so lines can be authored in metres off
the picture: these are the car's blueprints, at true scale, without perspective.
Coordinates on the sheets: y along the car (nose at -L/2), z up from the ground, x to
the car's left.
"""
import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
spec_path, outdir = argv[0], Path(argv[1])
outdir.mkdir(parents=True, exist_ok=True)
spec = json.load(open(spec_path))
F = spec['factory']
L, W, H = F['length'], F['width'], F['height']
WB, FO = F['wheelbase'], F['frontOverhang']

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=str(Path(spec_path).parent / spec['reference']))
meshes = [o for o in scene.objects if o.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
ref = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
co = np.array([v.co[:] for v in ref.data.vertices])
size = co.max(0) - co.min(0)
if size[0] > size[1]:
    co = co[:, [1, 0, 2]]
co -= np.array([(co[:, 0].max() + co[:, 0].min()) / 2, 0, co[:, 2].min()])
low = co[co[:, 2] < co[:, 2].max() * 0.12]
ys = np.sort(low[:, 1])
split = int(np.argmax(np.diff(ys)))
ya, yb = float(np.median(ys[: split + 1])), float(np.median(ys[split + 1:]))
y0, y1 = float(co[:, 1].min()), float(co[:, 1].max())
if ya - y0 > y1 - yb and spec.get('noseAtMinY', True):
    co[:, 1] = -co[:, 1]
    co[:, 0] = -co[:, 0]
    ya, yb, y0, y1 = -yb, -ya, -y1, -y0
co[:, 1] = np.interp(co[:, 1], [y0, ya, yb, y1], [-L / 2, -L / 2 + FO, -L / 2 + FO + WB, L / 2])
# Width over the lower body only: the mirrors are wider than the published figure.
shell = co[co[:, 2] < 0.55 * co[:, 2].max()]
co[:, 0] *= W / (shell[:, 0].max() - shell[:, 0].min())
co[:, 2] *= H / co[:, 2].max()
for v, c in zip(ref.data.vertices, co):
    v.co = c
ref.data.update()
mat = bpy.data.materials.new('ref')
mat.diffuse_color = (0.82, 0.8, 0.74, 1)
ref.data.materials.clear()
ref.data.materials.append(mat)


def line_object(name, segments, colour, width=0.004):
    """Thin flat ribbons for the grid, lying in the plane the sheet looks at."""
    bm = bmesh.new()
    for a, b, normal in segments:
        a, b, n = Vector(a), Vector(b), Vector(normal)
        d = (b - a).normalized()
        side = d.cross(n).normalized() * width
        vs = [bm.verts.new(p) for p in (a - side, b - side, b + side, a + side)]
        bm.faces.new(vs)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    m = bpy.data.materials.new(name)
    m.diffuse_color = colour
    me.materials.append(m)
    obj = bpy.data.objects.new(name, me)
    scene.collection.objects.link(obj)
    return obj


def label(text, location, rotation, size=0.06):
    bpy.ops.object.text_add(location=location, rotation=rotation)
    t = bpy.context.active_object
    t.data.body = text
    t.data.size = size
    m = bpy.data.materials.new('lbl')
    m.diffuse_color = (0.75, 0.1, 0.05, 1)
    t.data.materials.append(m)


sc = scene
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'STUDIO'
sc.display.shading.show_cavity = True
sc.display.shading.color_type = 'MATERIAL'
sc.display.shading.show_object_outline = True
sc.world = bpy.data.worlds.new('w')
sc.world.color = (1, 1, 1)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('c'))
cam.data.type = 'ORTHO'
sc.collection.objects.link(cam)
sc.camera = cam
PX_PER_M = 400


def frange(a, b, step):
    n = int(math.floor((b - a) / step + 1e-6))
    return [round(a + i * step, 4) for i in range(n + 1)]


def sheet(name, cam_loc, cam_rot, span_u, span_v, grid):
    """grid: list of (a, b, normal) segments plus labels already placed."""
    g = line_object(f'grid_{name}', grid, (0.55, 0.62, 0.75, 1), 0.0035)
    cam.location = cam_loc
    cam.rotation_euler = cam_rot
    cam.data.ortho_scale = max(span_u, span_v)
    sc.render.resolution_x = int(span_u * PX_PER_M)
    sc.render.resolution_y = int(span_v * PX_PER_M)
    sc.render.filepath = str(outdir / f'{name}.png')
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(g)


pad = 0.15
# SIDE: looking from +X at the car's left side; y to the right... the camera looks along -X,
# so +Y runs to the LEFT of the picture. Labels carry the coordinate so it cannot be misread.
ymin, ymax, zmax = -L / 2 - pad, L / 2 + pad, H + pad
seg = []
for y in frange(round(ymin, 1), ymax, 0.1):
    seg.append(((-W, y, -0.05), (-W, y, zmax), (1, 0, 0)))
for z in frange(0, zmax, 0.1):
    seg.append(((-W, ymin, z), (-W, ymax, z), (1, 0, 0)))
labels = []
for y in frange(round(ymin, 1), ymax, 0.5):
    label(f'{y:+.1f}', (W + 0.01, y + 0.02, 0.02), (math.pi / 2, 0, math.pi / 2))
for z in frange(0.5, zmax, 0.5):
    label(f'z{z:.1f}', (W + 0.01, ymax - 0.02, z + 0.01), (math.pi / 2, 0, math.pi / 2))
sheet('side', (5, 0, zmax / 2 - 0.05), (math.pi / 2, 0, math.pi / 2), ymax - ymin, zmax + 0.1, seg)
for o in [o for o in scene.objects if o.type == 'FONT']:
    bpy.data.objects.remove(o)

# TOP: looking down; x to the left of the car is UP in the picture... labelled.
xmax = W / 2 + pad
seg = []
for y in frange(round(ymin, 1), ymax, 0.1):
    seg.append(((-xmax, y, -0.05), (xmax, y, -0.05), (0, 0, 1)))
for x in frange(-round(xmax, 1), xmax, 0.1):
    seg.append(((x, ymin, -0.05), (x, ymax, -0.05), (0, 0, 1)))
for y in frange(round(ymin, 1), ymax, 0.5):
    label(f'{y:+.1f}', (xmax - 0.1, y + 0.02, H + 0.31), (0, 0, math.pi / 2))
for x in frange(-0.5, xmax, 0.5):
    label(f'x{x:+.1f}', (x + 0.01, ymin + 0.05, H + 0.31), (0, 0, math.pi / 2))
sheet('top', (0, 0, 6), (0, 0, math.pi / 2), ymax - ymin, 2 * xmax, seg)
for o in [o for o in scene.objects if o.type == 'FONT']:
    bpy.data.objects.remove(o)

# FRONT and REAR.
for name, ycam, rot in (('front', -6, (math.pi / 2, 0, 0)), ('rear', 6, (math.pi / 2, 0, math.pi))):
    seg = []
    yplane = L / 2 + 0.3 if name == 'front' else -L / 2 - 0.3
    for x in frange(-round(xmax, 1), xmax, 0.1):
        seg.append(((x, yplane, -0.05), (x, yplane, zmax), (0, 1, 0)))
    for z in frange(0, zmax, 0.1):
        seg.append(((-xmax, yplane, z), (xmax, yplane, z), (0, 1, 0)))
    sheet(name, (0, ycam, zmax / 2 - 0.05), rot, 2 * xmax, zmax + 0.1, seg)
print('SHEETS', outdir)
