"""Lofts a clean car body over a reference shape, the way the light plane is built.

    blender --background --factory-startup --python tools/carshape/loft.py -- <car.json> <out.glb> [preview.png]

The plane (src/story/plane.ts) reads as a Cessna because it is ONE smooth skin through a
table of real sections, with everything that is paint or glass on the real thing drawn
on that skin rather than stuck on as plates. A car body here is built the same way:

1. The reference is a dense scan-like mesh of the real car (an image-to-3D reconstruction
   or any other) warped onto the car's published dimensions: the axles on the factory
   wheelbase and overhangs, width and height to the catalogue.
2. The skin is a loft of rings — one ring per station along the car, every ring the same
   number of points from the bottom centre round to the top centre — so its topology is
   clean whatever the reference's is. Each ring point is found by casting from outside
   the car inward along its own radial direction in the station plane and taking the
   first hit: the outer surface, never a seat or a wheel well. The ring spacing is the
   low-pass filter: a reconstruction's centimetre noise falls between the samples.
3. The tyres are not body. Ring points that land inside a wheel's cylinder are dropped
   and refilled along the car from their neighbours, and the wells are cut from the
   finished skin with the factory axle positions, so the arches are round and sit
   exactly over the wheels the game will mount.

The car spec (JSON) carries `factory` (the catalogue's FactoryGeometry, metres) and
`reference` (the dense mesh's path). Output is the body skin alone, named `paint`, in
the game's frame after export: +Y up, nose +Z, left +X.
"""
import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index('--') + 1:]
spec_path, out_glb = argv[0], argv[1]
preview = argv[2] if len(argv) > 2 else None
spec = json.load(open(spec_path))
F = spec['factory']
L, W, H = F['length'], F['width'], F['height']
WB, FO, R = F['wheelbase'], F['frontOverhang'], F['wheelRadius']
TYRE_W = F['tyreWidth']
AXLES = [(-L / 2 + FO, F['frontTrack']), (-L / 2 + FO + WB, F['rearTrack'])]
STATIONS = spec.get('stations', 64)
RING = spec.get('ringPoints', 30)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ---- the reference, on the car's real dimensions -----------------------------------
ref_path = Path(spec_path).parent / spec['reference']
bpy.ops.import_scene.gltf(filepath=str(ref_path))
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
if ya - y0 > y1 - yb:
    # Nose toward -Y: the front overhang is the shorter one on every car in the list
    # that is not rear-engined; a spec may force it with "noseAtMinY": false.
    if spec.get('noseAtMinY', True):
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

# Tyres out of the reference, so nothing below can mistake a tyre for bodywork.
bm = bmesh.new()
bm.from_mesh(ref.data)
doomed = []
for f in bm.faces:
    c = f.calc_center_median()
    for axle_y, track in AXLES:
        if math.hypot(c.y - axle_y, c.z - R) < R * 1.03 and abs(c.x) > track / 2 - TYRE_W * 0.75:
            doomed.append(f)
            break
bmesh.ops.delete(bm, geom=doomed, context='FACES')
bvh = BVHTree.FromBMesh(bm)
bm.free()
print(f'LOFT reference {len(co)} verts, {len(doomed)} tyre faces dropped')

# ---- the section table ----------------------------------------------------------------
# Like the plane's FUSELAGE_TABLE, but measured: at each station, the body's bottom and
# top and its half-width at a set of heights between them. Heights are fractions of
# the local depth, bunched toward the floor and the roof where the section turns.
# Width at a height is a high percentile of |x| over the reference's vertices in a thin
# slab there, so one stray vertex (a mirror stalk, an aerial) cannot set it.
u = np.linspace(0, 1, STATIONS)
stations = -L / 2 + L * (0.5 - 0.5 * np.cos(np.pi * u))
stations[0] += 0.006
stations[-1] -= 0.006
LEVELS = spec.get('levels', 26)
t = np.linspace(0, 1, LEVELS)
fractions = 0.5 - 0.5 * np.cos(np.pi * t)
slab_y = spec.get('slabY', 0.03)

pts = np.array([v.co[:] for v in ref.data.vertices])
keep = np.ones(len(pts), bool)
for axle_y, track in AXLES:
    keep &= ~((np.hypot(pts[:, 1] - axle_y, pts[:, 2] - R) < R * 1.06) & (np.abs(pts[:, 0]) > track / 2 - TYRE_W * 0.8))
keep &= np.abs(pts[:, 0]) <= W / 2 + 0.01  # the mirrors stand outside the published width
pts = pts[keep]


def in_arch(y, z):
    return any(abs(y - ay) < R * 1.2 and z < R + R * 1.2 for ay, _ in AXLES)


bottoms = np.zeros(STATIONS)
tops = np.zeros(STATIONS)
widths = np.full((STATIONS, LEVELS), np.nan)
for i, y in enumerate(stations):
    sl = pts[np.abs(pts[:, 1] - y) < slab_y]
    if len(sl) < 30:
        sl = pts[np.argsort(np.abs(pts[:, 1] - y))[:200]]
    centre = sl[np.abs(sl[:, 0]) < max(0.12, 0.3 * np.abs(sl[:, 0]).max())]
    tops[i] = np.percentile(centre[:, 2], 99)
    bottoms[i] = max(F['clearance'] * 0.8, np.percentile(sl[:, 2], 1))
    depth = tops[i] - bottoms[i]
    dz = max(0.012, depth / LEVELS * 0.7)
    for k, f in enumerate(fractions):
        z = bottoms[i] + f * depth
        if in_arch(y, z):
            continue
        band = sl[np.abs(sl[:, 2] - z) < dz]
        if len(band) >= 4:
            widths[i, k] = np.percentile(np.abs(band[:, 0]), 97)

# Fill what the wheels and the slab's sparseness left empty, along the car.
for k in range(LEVELS):
    col = widths[:, k]
    ok = ~np.isnan(col)
    col[~ok] = np.interp(stations[~ok], stations[ok], col[ok])


def smooth_along(a, passes):
    for _ in range(passes):
        a[1:-1] = 0.25 * a[:-2] + 0.5 * a[1:-1] + 0.25 * a[2:]
    return a


passes = spec.get('smoothPasses', 2)
tops = smooth_along(tops, passes)
bottoms = smooth_along(bottoms, passes)
for k in range(LEVELS):
    widths[:, k] = smooth_along(widths[:, k], passes)

grid = np.zeros((STATIONS, LEVELS + 2, 3))
for i, y in enumerate(stations):
    depth = tops[i] - bottoms[i]
    grid[i, 0] = (0, y, bottoms[i])
    for k, f in enumerate(fractions):
        grid[i, k + 1] = (widths[i, k], y, bottoms[i] + f * depth)
    grid[i, -1] = (0, y, tops[i])
RING = LEVELS + 2
nose_tip = grid[0].mean(0)
tail_tip = grid[-1].mean(0)
print(f'LOFT table {STATIONS} stations x {LEVELS} levels')

bm = bmesh.new()
rows = []
for i in range(STATIONS):
    half = [bm.verts.new(grid[i, j]) for j in range(RING)]
    mirror = [bm.verts.new((-grid[i, j, 0], grid[i, j, 1], grid[i, j, 2])) for j in range(RING - 2, 0, -1)]
    rows.append(half + mirror)
n = len(rows[0])
for a, b in zip(rows, rows[1:]):
    for k in range(n):
        m = (k + 1) % n
        bm.faces.new((a[k], a[m], b[m], b[k]))
tip_a = bm.verts.new(nose_tip)
tip_b = bm.verts.new(tail_tip)
for k in range(n):
    m = (k + 1) % n
    bm.faces.new((tip_a, rows[0][m], rows[0][k]))
    bm.faces.new((tip_b, rows[-1][k], rows[-1][m]))
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
mesh = bpy.data.meshes.new('paint')
bm.to_mesh(mesh)
bm.free()
body = bpy.data.objects.new('paint', mesh)
scene.collection.objects.link(body)
bpy.data.objects.remove(ref)

# A light pass to settle what is left of the reference's ripple between rings.
bpy.context.view_layer.objects.active = body
body.select_set(True)
smooth = body.modifiers.new('settle', 'CORRECTIVE_SMOOTH')
smooth.iterations = spec.get('settle', 3)
smooth.use_only_smooth = True
bpy.ops.object.modifier_apply(modifier=smooth.name)

# Wells, cut from the outside to just past the tyre's inner face.
for axle_y, track in AXLES:
    for side in (1, -1):
        depth = W / 2 - track / 2 + TYRE_W / 2 + 0.05
        bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=R * 1.13, depth=depth + 0.1,
                                            location=(side * (W / 2 - depth / 2 + 0.05), axle_y, R),
                                            rotation=(0, math.pi / 2, 0))
        cutter = bpy.context.active_object
        mod = body.modifiers.new('well', 'BOOLEAN')
        mod.operation = 'DIFFERENCE'
        mod.object = cutter
        mod.solver = 'EXACT'
        bpy.context.view_layer.objects.active = body
        bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.data.objects.remove(cutter)

bpy.context.view_layer.objects.active = body
bpy.ops.object.shade_smooth()
paint = bpy.data.materials.new('car_paint')
paint.diffuse_color = (0.86, 0.83, 0.74, 1)
body.data.materials.append(paint)
print(f'LOFT skin {len(body.data.polygons)} faces')

bpy.ops.export_scene.gltf(filepath=out_glb, export_format='GLB', export_yup=True)

if preview:
    for axle_y, track in AXLES:
        for side in (1, -1):
            bpy.ops.mesh.primitive_cylinder_add(vertices=28, radius=R, depth=TYRE_W,
                                                location=(side * track / 2, axle_y, R), rotation=(0, math.pi / 2, 0))
            tm = bpy.data.materials.new('tyre')
            tm.diffuse_color = (0.04, 0.04, 0.04, 1)
            bpy.context.active_object.data.materials.append(tm)
    sc = scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'
    sc.display.shading.color_type = 'MATERIAL'
    sc.display.shading.show_object_outline = True
    sc.render.resolution_x = 1000
    sc.render.resolution_y = 620
    sc.world = bpy.data.worlds.new('w')
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('c'))
    cam.data.lens = 55
    sc.collection.objects.link(cam)
    sc.camera = cam
    target = Vector((0, 0, H * 0.45))
    views = {'front34': Vector((L * 0.95, -L * 1.2, H * 1.15)), 'side': Vector((L * 1.75, 0, H * 0.55)),
             'rear34': Vector((-L * 0.95, L * 1.2, H * 1.25)), 'top': Vector((0.01, 0, L * 1.9))}
    for name, pos in views.items():
        cam.location = pos
        cam.rotation_euler = (target - pos).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = preview.replace('.png', f'-{name}.png')
        bpy.ops.render.render(write_still=True)
