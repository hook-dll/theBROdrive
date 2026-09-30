"""Builds one car body from an archetype and a car's real dimensions, in Blender.

    blender --background --factory-startup --python tools/carshape/archetype.py -- <car.json> <out.glb> [preview.png]

A body is not modelled per car. It is an ARCHETYPE — a saloon, a hatchback, an estate
— whose proportions are rules about where things sit relative to the car's own
published length, width, height, wheelbase and overhangs, so the arches always land
over the wheels and the glass is never stretched. Faceless on purpose: flat panels,
flush black glass, lamps as plain lenses, and nothing that says which maker built it.

Coordinates in Blender: +Z up, the nose toward -Y, the car's left toward +X, which the
glTF exporter turns into the game's +Y up, nose +Z, left +X. The ground is Z = 0 with
the car standing at its factory clearance.

The runtime contract (see render/carmodel.ts): materials `car_paint`, `car_trim`,
`car_glass`, `Headlights`, `TailLights`, `IndicatorLights`, `ReverseLights`, `Tyres`,
`wheel_rim`; nodes `paint`, `trim`, `glass`, `headlights`, `taillights`,
`reverse_lights`, `front_blinker_left/right`, `rear_blinker_left/right`, `mirrors`
and `wheel_fl/fr/rl/rr`, each wheel centred on its own axle.
"""
import json
import math
import sys

import bpy
import bmesh
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
spec = json.load(open(argv[0]))
out_glb = argv[1]
preview = argv[2] if len(argv) > 2 else None

F = spec['factory']
S = spec.get('style', {})
L, W, H = F['length'], F['width'], F['height']
CL = F['clearance']
WB = F['wheelbase']
FO = F['frontOverhang']
R = F['wheelRadius']
TW = F['tyreWidth']
TRF, TRR = F['frontTrack'], F['rearTrack']
ARCHETYPE = spec.get('archetype', 'saloon')

# ---- scene -----------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

MATERIALS = {}


def material(name, rgb, rough=0.6, metal=0.0):
    if name in MATERIALS:
        return MATERIALS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*rgb, 1)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    m.diffuse_color = (*rgb, 1)
    MATERIALS[name] = m
    return m


PAINT = material('car_paint', (0.55, 0.12, 0.08), 0.45)
TRIM = material('car_trim', (0.04, 0.04, 0.045), 0.7)
GLASS = material('car_glass', (0.02, 0.03, 0.04), 0.1)
HEAD = material('Headlights', (0.9, 0.9, 0.85), 0.2)
TAIL = material('TailLights', (0.6, 0.02, 0.02), 0.3)
BLINK = material('IndicatorLights', (0.95, 0.5, 0.05), 0.3)
REVERSE = material('ReverseLights', (0.85, 0.85, 0.85), 0.3)
TYRE = material('Tyres', (0.03, 0.03, 0.03), 0.9)
RIM = material('wheel_rim', (0.55, 0.56, 0.58), 0.35, 0.8)


def new_object(name, bm, mats):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for m in mats:
        mesh.materials.append(m)
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    return obj


def y_at(s):
    """Distance from the nose to Blender Y: the nose sits at -L/2."""
    return -L / 2 + s


def smooth(a, b, t):
    t = max(0.0, min(1.0, t))
    t = t * t * (3 - 2 * t)
    return a + (b - a) * t


# ---- proportions -------------------------------------------------------------------
#
# Every height is from the ground. The rules are a period saloon's: the bonnet line
# sits a little above the tops of the wheels, the beltline (the sill of the side
# windows) at about 60% of the height, the roof over the middle of the wheelbase, and
# the windscreen starting a little behind the front axle.
front_axle = FO
rear_axle = FO + WB
wheel_top = 2 * R
belt = S.get('belt', CL + 0.6 * (H - CL))
bonnet = S.get('bonnet', max(wheel_top + 0.12, belt - 0.07))
nose = S.get('nose', bonnet - 0.1)
deck = S.get('deck', belt - 0.02)
tail = S.get('tail', deck - 0.07)
sill = CL
bumper_low = CL + 0.1

# Glasshouse, along the car. Rakes are from the horizontal. A saloon of the period
# (measured off a VAZ-2101 side elevation): windscreen base 30% of the wheelbase behind
# the front axle, windscreen at 44 degrees, rear window at 58, its base a fifth of the
# rear overhang behind the rear axle, leaving a boot.
rise = H - belt
ws_base = S.get('windscreenBase', front_axle + 0.3 * WB)
roof_front = ws_base + rise / math.tan(math.radians(S.get('windscreenRake', 44)))
if ARCHETYPE == 'hatchback':
    rear_end_glass = S.get('rearWindowBase', L - 0.1)
    roof_rear = rear_end_glass - (H - deck) / math.tan(math.radians(S.get('rearRake', 40)))
elif ARCHETYPE == 'estate':
    rear_end_glass = S.get('rearWindowBase', L - 0.06)
    roof_rear = rear_end_glass - (H - deck) / math.tan(math.radians(S.get('rearRake', 75)))
else:
    rear_end_glass = S.get('rearWindowBase', rear_axle + 0.22 * (L - rear_axle))
    roof_rear = rear_end_glass - (H - deck) / math.tan(math.radians(S.get('rearRake', 58)))
half_w = W / 2
tumble = S.get('tumblehome', 0.1)


def deck_height(s):
    """Top of the lower body at distance s from the nose."""
    if s <= 0.12:
        return smooth(nose - 0.03, nose, s / 0.12)
    if s <= ws_base:
        return smooth(nose, bonnet, (s - 0.12) / max(0.01, ws_base - 0.12))
    if ARCHETYPE in ('hatchback', 'estate'):
        return smooth(belt, tail, (s - (L - 0.25)) / 0.25) if s > L - 0.25 else belt
    if s <= rear_end_glass:
        return belt
    return smooth(deck, tail, (s - (L - 0.25)) / 0.25)


def bottom_height(s):
    """Underside: raised at the bumpers for approach and departure."""
    if s < 0.3:
        return smooth(bumper_low, sill, s / 0.3)
    if s > L - 0.3:
        return smooth(sill, bumper_low, (s - (L - 0.3)) / 0.3)
    return sill


def half_width(s):
    """Plan view: the corners come in at the nose and tail."""
    if s < 0.35:
        return half_w * smooth(0.9, 1.0, s / 0.35)
    if s > L - 0.3:
        return half_w * smooth(1.0, 0.93, (s - (L - 0.3)) / 0.3)
    return half_w


# ---- lower body: lofted cross-sections ---------------------------------------------
def section(s):
    w = half_width(s)
    top = deck_height(s)
    bot = bottom_height(s)
    y = y_at(s)
    shoulder = min(0.06, (top - bot) * 0.25)
    # Half section, centre bottom round to centre top, then mirrored.
    half = [
        (0.0, bot),
        (w * 0.9, bot),
        (w, bot + 0.07),
        (w, top - shoulder),
        (w - 0.04, top),
        (0.0, top + 0.01),
    ]
    right = [(-x, z) for (x, z) in reversed(half[1:-1])]
    return [Vector((x, y, z)) for (x, z) in half + right]


stations = sorted(set(
    [0.0, 0.03, 0.12, 0.3, 0.6, ws_base - 0.2, ws_base, rear_end_glass]
    + [front_axle - R * 1.2, front_axle, front_axle + R * 1.2]
    + [rear_axle - R * 1.2, rear_axle, rear_axle + R * 1.2]
    + [L - 0.6, L - 0.3, L - 0.12, L - 0.03, L]
))
stations = [s for s in stations if 0.0 <= s <= L]

bm = bmesh.new()
loops = [[bm.verts.new(p) for p in section(s)] for s in stations]
n = len(loops[0])
for a, b in zip(loops, loops[1:]):
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], a[j], b[j], b[i]))
bm.faces.new(list(reversed(loops[0])))
bm.faces.new(loops[-1])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
body = new_object('paint', bm, [PAINT, TRIM])

# Wheel arches: a cylinder a little larger than the tyre, through the whole width, cut
# out of the body. Its faces carry trim, so the arch lining comes out black.
for axle in (front_axle, rear_axle):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=20, radius=R * 1.2, depth=W * 1.4,
        location=(0, y_at(axle), R + 0.03), rotation=(0, math.pi / 2, 0))
    cutter = bpy.context.active_object
    cutter.data.materials.append(TRIM)
    mod = body.modifiers.new('arch', 'BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.object = cutter
    mod.solver = 'EXACT'
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter)

# ---- glasshouse ----------------------------------------------------------------------
gw_base = half_w - tumble * 0.35
gw_roof = half_w - tumble - 0.08
bm = bmesh.new()
b1l = bm.verts.new((gw_base, y_at(ws_base), belt))
b1r = bm.verts.new((-gw_base, y_at(ws_base), belt))
b4l = bm.verts.new((gw_base, y_at(rear_end_glass), deck_height(rear_end_glass)))
b4r = bm.verts.new((-gw_base, y_at(rear_end_glass), deck_height(rear_end_glass)))
t2l = bm.verts.new((gw_roof, y_at(roof_front), H))
t2r = bm.verts.new((-gw_roof, y_at(roof_front), H))
t3l = bm.verts.new((gw_roof, y_at(roof_rear), H))
t3r = bm.verts.new((-gw_roof, y_at(roof_rear), H))
windscreen = bm.faces.new((b1l, b1r, t2r, t2l))
roof = bm.faces.new((t2l, t2r, t3r, t3l))
rear_glass = bm.faces.new((t3l, t3r, b4r, b4l))
side_l = bm.faces.new((b1l, t2l, t3l, b4l))
side_r = bm.faces.new((b1r, b4r, t3r, t2r))
bm.faces.new((b1l, b4l, b4r, b1r))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
for f in bm.faces:
    f.material_index = 0
# Windows: each glazed face is inset, and the inset face is the glass. The ring left
# behind is the pillars and the roof rail, in paint.
glazed = []
for face, thickness in ((windscreen, 0.05), (rear_glass, 0.05), (side_l, 0.07), (side_r, 0.07)):
    result = bmesh.ops.inset_individual(bm, faces=[face], thickness=thickness, depth=-0.008)
    glazed.append(face)
for face in glazed:
    face.material_index = 1
# The B pillar: a strip of paint down the middle of each side window.
for face in (side_l, side_r):
    xs = sorted(v.co.y for v in face.verts)
    mid = (xs[0] + xs[-1]) / 2 + 0.05
    cut = bmesh.ops.bisect_plane(bm, geom=[face] + list(face.edges) + list(face.verts),
                                 plane_co=(0, mid, 0), plane_no=(0, 1, 0))
    cut2 = bmesh.ops.bisect_plane(bm, geom=bm.faces[:] + bm.edges[:] + bm.verts[:],
                                  plane_co=(0, mid + 0.07, 0), plane_no=(0, 1, 0))
for f in bm.faces:
    if f.material_index == 1 and abs(f.normal.x) > 0.5:
        c = f.calc_center_median()
        mid_l = (y_at(ws_base) + y_at(rear_end_glass)) / 2 + 0.05
        if mid_l < c.y < mid_l + 0.07:
            f.material_index = 0
cabin = new_object('cabin', bm, [PAINT, GLASS])

# ---- bumpers, lamps, mirrors -----------------------------------------------------------
def box(bm, cx, cy, cz, sx, sy, sz, mat_index=0):
    r = bmesh.ops.create_cube(bm, size=1.0)
    for v in r['verts']:
        v.co.x = cx + v.co.x * sx
        v.co.y = cy + v.co.y * sy
        v.co.z = cz + v.co.z * sz
    for f in bm.faces:
        if f.material_index == 0 and any(v in r['verts'] for v in f.verts):
            f.material_index = mat_index
    return r


bm = bmesh.new()
bumper_h = 0.1
box(bm, 0, y_at(0.02), bumper_low + 0.08, half_w * 0.96, 0.08, bumper_h)
box(bm, 0, y_at(L - 0.02), bumper_low + 0.1, half_w * 0.96, 0.08, bumper_h)
box(bm, 0, y_at(0.005), (nose + bumper_low) / 2 + 0.06, half_w * 0.5, 0.02, (nose - bumper_low) * 0.3)
trim = new_object('trim', bm, [TRIM])

lamp_z_front = nose - 0.12
lamp_z_rear = tail - 0.12


def lamp(name, mat, x, s, z, sx, sz):
    bm = bmesh.new()
    box(bm, x, y_at(s), z, sx, 0.03, sz)
    if abs(x) < 1e-6:
        pass
    return new_object(name, bm, [mat])


def lamp_pair(name, mat, s, z, x, sx, sz):
    bm = bmesh.new()
    box(bm, x, y_at(s), z, sx, 0.03, sz)
    box(bm, -x, y_at(s), z, sx, 0.03, sz)
    return new_object(name, bm, [mat])


head_x = half_width(0.02) - 0.22
lamp_pair('headlights', HEAD, 0.01, lamp_z_front, head_x, 0.22, 0.1)
lamp('front_blinker_left', BLINK, head_x + 0.17, 0.02, lamp_z_front - 0.1, 0.07, 0.04)
lamp('front_blinker_right', BLINK, -(head_x + 0.17), 0.02, lamp_z_front - 0.1, 0.07, 0.04)
# A period tail cluster: a wide red block with the indicator and the reversing lamp
# stacked in the same unit, inboard of it.
tail_x = half_width(L - 0.02) - 0.2
lamp_pair('taillights', TAIL, L - 0.01, lamp_z_rear + 0.02, tail_x, 0.3, 0.12)
lamp('rear_blinker_left', BLINK, tail_x, L - 0.01, lamp_z_rear - 0.09, 0.3, 0.05)
lamp('rear_blinker_right', BLINK, -tail_x, L - 0.01, lamp_z_rear - 0.09, 0.3, 0.05)
lamp_pair('reverse_lights', REVERSE, L - 0.01, lamp_z_rear + 0.02, tail_x - 0.21, 0.1, 0.12)

bm = bmesh.new()
for side in (1, -1):
    # On the door, at the foot of the A pillar.
    box(bm, side * (half_w + 0.06), y_at(ws_base + 0.22), belt + 0.07, 0.1, 0.03, 0.06)
new_object('mirrors', bm, [TRIM])

# ---- wheels ------------------------------------------------------------------------------
def wheel(name, s, x, track_side):
    bm = bmesh.new()
    tyre = bmesh.ops.create_cone(bm, cap_ends=True, segments=18, radius1=R, radius2=R, depth=TW)
    rim = bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=R * 0.6, radius2=R * 0.6,
                                depth=TW * 1.04)
    rim_verts = set(rim['verts'])
    for f in bm.faces:
        f.material_index = 1 if all(v in rim_verts for v in f.verts) else 0
    # Cone axis is Z; the axle is X.
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0),
                     matrix=__import__('mathutils').Matrix.Rotation(math.pi / 2, 3, 'Y'))
    obj = new_object(name, bm, [TYRE, RIM])
    obj.location = (x, y_at(s), R)
    return obj


wheel('wheel_fl', front_axle, TRF / 2, 1)
wheel('wheel_fr', front_axle, -TRF / 2, -1)
wheel('wheel_rl', rear_axle, TRR / 2, 1)
wheel('wheel_rr', rear_axle, -TRR / 2, -1)

# The lower body and the glasshouse are one painted shell to the game.
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
cabin.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
# Split the glass back out into its own node, as the contract wants.
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='DESELECT')
glass_index = body.data.materials.find('car_glass')
body.active_material_index = glass_index
bpy.ops.object.material_slot_select()
bpy.ops.mesh.separate(type='SELECTED')
bpy.ops.object.mode_set(mode='OBJECT')
for obj in scene.objects:
    if obj.name.startswith('paint.'):
        obj.name = 'glass'
        obj.data.name = 'glass'

tris = sum(len(o.data.polygons) for o in scene.objects if o.type == 'MESH')
print(f'SHAPE {spec["id"]}: {len(scene.objects)} objects, {tris} faces')

bpy.ops.export_scene.gltf(filepath=out_glb, export_format='GLB', export_apply=True,
                          export_yup=True, export_materials='EXPORT')
print(f'SHAPE wrote {out_glb}')

# ---- preview ----------------------------------------------------------------------------
if preview:
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'MATERIAL'
    scene.display.shading.show_cavity = True
    scene.display.shading.show_object_outline = True
    scene.render.resolution_x = 1400
    scene.render.resolution_y = 900
    world = bpy.data.worlds.new('w')
    scene.world = world
    cam_data = bpy.data.cameras.new('cam')
    cam_data.lens = 60
    cam = bpy.data.objects.new('cam', cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    views = {
        'front34': Vector((L * 0.95, -L * 1.25, H * 1.1)),
        'side': Vector((L * 1.7, 0, H * 0.6)),
        'rear34': Vector((-L * 0.95, L * 1.25, H * 1.2)),
    }
    target = Vector((0, 0, H * 0.45))
    for name, pos in views.items():
        cam.location = pos
        direction = target - pos
        cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = preview.replace('.png', f'-{name}.png')
        bpy.ops.render.render(write_still=True)
        print(f'PREVIEW {scene.render.filepath}')
