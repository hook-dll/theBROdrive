"""Fit the existing Soviet VAZ-2109 wheels to the staged DFF body.

A copy of each 500-triangle wheel from public/models/soviet/vz09.fbx supplies
actual four-corner mesh geometry and measured axle centres. Runtime will use
wheelSetPool: ['sv_vaz2109'] for precisely the same established wheel style.
No body vertex is moved or rescaled here; factory-height discrepancies are
reported for explicit review instead of hidden by a non-uniform runtime fit.
"""
from __future__ import annotations
from hashlib import sha256
import json
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
INPUT = ROOT / 'build/vehicles/vaz2109_admiral/30-geometry/vaz2109-body.glb'
DONOR = ROOT / 'public/models/soviet/vz09.fbx'
OUTPUT = ROOT / 'build/vehicles/vaz2109_admiral/35-wheels'
FACTORY = {
    'length': 4.006, 'width': 1.650, 'height': 1.402,
    'clearance': 0.160, 'wheelbase': 2.460,
    'frontTrack': 1.400, 'rearTrack': 1.370,
    'wheelRadius': 0.281, 'tyreWidth': 0.165,
}
SOURCE_WHEELBASE = 1.314 + 1.337
SCALE = FACTORY['wheelbase'] / SOURCE_WHEELBASE
WHEELS = {
    'wheel_fl': ('09.wheel_fl', 'wheel_lf_dummy', FACTORY['frontTrack']),
    'wheel_fr': ('09.wheel_fr', 'wheel_rf_dummy', FACTORY['frontTrack']),
    'wheel_rl': ('09.wheel_bl', 'wheel_lb_dummy', FACTORY['rearTrack']),
    'wheel_rr': ('09.wheel_br', 'wheel_rb_dummy', FACTORY['rearTrack']),
}


def wheel_material(name: str, color: tuple[float, float, float, float]) -> bpy.types.Material:
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    material.diffuse_color = color
    material.use_nodes = True
    material.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = color
    return material


bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(INPUT))
body_objects = set(bpy.data.objects)
assert all(bpy.data.objects.get(mount) for _, mount, _ in WHEELS.values())
body_vertices = [obj.matrix_world @ vertex.co for obj in body_objects if obj.type == 'MESH'
                 for vertex in obj.data.vertices]
body_bounds = [(min(v[i] for v in body_vertices), max(v[i] for v in body_vertices))
               for i in range(3)]
result = bpy.ops.import_scene.fbx(filepath=str(DONOR), use_custom_normals=True)
assert 'FINISHED' in result, result
source_objects = set(bpy.data.objects) - body_objects
black = wheel_material('Tyres', (0.018, 0.02, 0.022, 1))
silver = wheel_material('wheel_rim', (0.43, 0.44, 0.45, 1))
measurements = {}
for wheel_name, (donor_name, dummy_name, track) in WHEELS.items():
    donor = bpy.data.objects[donor_name]
    assert donor in source_objects and donor.type == 'MESH'
    assert sum(len(p.vertices) - 2 for p in donor.data.polygons) == 500
    points = [donor.matrix_world @ v.co for v in donor.data.vertices]
    bounds = [(min(v[i] for v in points), max(v[i] for v in points)) for i in range(3)]
    centre = Vector([(low + high) * 0.5 for low, high in bounds])
    width = bounds[0][1] - bounds[0][0]
    radius = max(bounds[1][1] - bounds[1][0], bounds[2][1] - bounds[2][0]) * 0.5
    dummy = bpy.data.objects[dummy_name].matrix_world.translation
    target = Vector(((-1 if dummy.x < 0 else 1) * track / (2 * SCALE), dummy.y, dummy.z))
    width_factor = FACTORY['tyreWidth'] / (SCALE * width)
    radius_factor = FACTORY['wheelRadius'] / (SCALE * radius)
    geometry = donor.data.copy()
    geometry.name = wheel_name
    geometry.transform(Matrix.Translation(target) @
        Matrix.Diagonal((width_factor, radius_factor, radius_factor, 1)) @
        Matrix.Translation(-centre) @ donor.matrix_world)
    if donor.matrix_world.determinant() < 0:
        geometry.flip_normals()
    geometry.materials.clear()
    geometry.materials.append(black)
    geometry.materials.append(silver)
    # The donor's two authored UV palette swatches mark metal and rubber exactly.
    # A radial threshold paints some tyre faces silver because the wheel has two sides.
    uv = geometry.uv_layers.active.data
    swatches = set()
    for polygon in geometry.polygons:
        swatch = tuple(round(axis, 4) for axis in uv[polygon.loop_start].uv)
        assert swatch in ((0.0348, 0.8083), (0.2848, 0.7383)), swatch
        swatches.add(swatch)
        polygon.material_index = 1 if swatch == (0.0348, 0.8083) else 0
    assert len(swatches) == 2
    while geometry.uv_layers:
        geometry.uv_layers.remove(geometry.uv_layers[0])
    wheel = bpy.data.objects.new(wheel_name, geometry)
    bpy.context.scene.collection.objects.link(wheel)
    actual = [wheel.matrix_world @ v.co for v in geometry.vertices]
    measured = [(min(v[i] for v in actual), max(v[i] for v in actual)) for i in range(3)]
    measured_centre = [(lo + hi) * 0.5 for lo, hi in measured]
    measurements[wheel_name] = {
        'sourceDonor': donor_name,
        'centreSourceUnits': [round(v, 6) for v in measured_centre],
        'centreMetres': [round(v * SCALE, 6) for v in measured_centre],
        'radiusMetres': round(max(measured[1][1] - measured[1][0],
                                  measured[2][1] - measured[2][0]) * SCALE * 0.5, 6),
        'widthMetres': round((measured[0][1] - measured[0][0]) * SCALE, 6),
        'triangles': 500,
        'sourceMatrixDeterminant': round(donor.matrix_world.determinant(), 6),
    }
for obj in source_objects:
    bpy.data.objects.remove(obj, do_unlink=True)
assert len([o for o in bpy.data.objects if o.type == 'MESH']) == len([o for o in body_objects if o.type == 'MESH']) + 4
front = measurements['wheel_fl']['centreMetres']
rear = measurements['wheel_rl']['centreMetres']
assert abs(rear[1] - front[1] - FACTORY['wheelbase']) < 0.00001
for wheel_id, data in measurements.items():
    assert abs(data['radiusMetres'] - FACTORY['wheelRadius']) < 0.00001, wheel_id
    assert abs(data['widthMetres'] - FACTORY['tyreWidth']) < 0.00001, wheel_id
for left, right, track in (('wheel_fl','wheel_fr',FACTORY['frontTrack']),
                           ('wheel_rl','wheel_rr',FACTORY['rearTrack'])):
    assert abs(measurements[left]['centreMetres'][0] -
               measurements[right]['centreMetres'][0] - track) < 0.00001
OUTPUT.mkdir(parents=True, exist_ok=True)
file = OUTPUT / 'vaz2109-wheels.glb'
bpy.ops.export_scene.gltf(filepath=str(file), export_format='GLB',
    export_apply=False, export_materials='EXPORT', export_cameras=False,
    export_lights=False, export_animations=False, export_normals=True)
wheel_bottom = min(data['centreSourceUnits'][2] - FACTORY['wheelRadius']/SCALE
                   for data in measurements.values())
roof = body_bounds[2][1]
lowest_body = body_bounds[2][0]
(OUTPUT / 'report.json').write_text(json.dumps({
    'inputSha256': sha256(INPUT.read_bytes()).hexdigest(),
    'donorSha256': sha256(DONOR.read_bytes()).hexdigest(),
    'outputSha256': sha256(file.read_bytes()).hexdigest(),
    'scaleFromWheelbase': SCALE,
    'factory': FACTORY,
    'wheels': measurements,
    'bodyHeightAboveTyreBottomM': round((roof-wheel_bottom)*SCALE,4),
    'bodyLowestClearanceM': round((lowest_body-wheel_bottom)*SCALE,4),
    'bodyLengthM': round((body_bounds[1][1]-body_bounds[1][0])*SCALE,4),
    'bodyWidthIncludingMirrorsM': round((body_bounds[0][1]-body_bounds[0][0])*SCALE,4),
    'notes': ['Body remains at source height; compare with factory before fit',
              'Catalogue wheelSetPool should select sv_vaz2109 only'],
}, indent=2) + '\n')
print('WHEELS', measurements)
print('SCALE', SCALE, 'height', (roof-wheel_bottom)*SCALE,
      'clearance', (lowest_body-wheel_bottom)*SCALE)
