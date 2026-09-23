"""Fit the staged DFF shell to the 1991 VAZ-2109 body dimensions.

The wheelbase, wheel centres, tyres and wheel mesh are already factory-sized in
35-wheels and must not move. This stage fits the shell around those axles. The
source's front door meshes contain the mirrors. They receive the same mild
body-width correction as the doors, not a second outboard squeeze: the source
mirror proportions matter more than the 1.75 m figure in the reference drawing.
The original ribbed floor and closed front bay are retained, not replaced.

Factory references: https://vaz-sputnik.ru/2109/1.html (1-1 front view,
1.75 m with mirrors, 1.65 m body, 1.40/1.37 m tracks); 1991 AvtoVAZ
catalogue reproduced at https://www.autoopt.ru/auto/encyclopedia/car/vaz/mark/vaz-2109
(165/70 R13, 13-inch stamped steel rim, 915 kg 1.3 L five-speed VAZ-2109).
"""
from hashlib import sha256
import json
from math import hypot
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / 'build/vehicles/vaz2109_admiral'
INPUT = WORK / '35-wheels/vaz2109-wheels.glb'
OUTPUT = WORK / '36-factory-fit'
SOURCE = json.loads((INPUT.parent / 'report.json').read_text())
assert sha256(INPUT.read_bytes()).hexdigest() == SOURCE['outputSha256']
SCALE = SOURCE['scaleFromWheelbase']
FACTORY = SOURCE['factory']
WHEEL_NAMES = ('wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr')

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(INPUT))
wheels = [bpy.data.objects[name] for name in WHEEL_NAMES]
body = [o for o in bpy.data.objects if o.type == 'MESH' and o.name not in WHEEL_NAMES]


def points(objects):
    return [o.matrix_world @ vertex.co for o in objects for vertex in o.data.vertices]


raw = points(body)
wheel_points = points(wheels)
wheel_bottom = min(v.z for v in wheel_points)
lowest = min(v.z for v in raw)
roof = max(v.z for v in raw)
height_factor = ((FACTORY['height'] - FACTORY['clearance']) / SCALE) / (roof - lowest)
height_offset = wheel_bottom + FACTORY['clearance'] / SCALE - height_factor * lowest
assert 1 < height_factor < 1.15

front_axle = SOURCE['wheels']['wheel_fl']['centreSourceUnits'][1]
rear_axle = SOURCE['wheels']['wheel_rl']['centreSourceUnits'][1]
front_overhang = .785  # 1991 catalogue dimensioned side drawing.
rear_overhang = FACTORY['length'] - FACTORY['wheelbase'] - front_overhang
front_factor = front_overhang / ((front_axle - min(v.y for v in raw)) * SCALE)
rear_factor = rear_overhang / ((max(v.y for v in raw) - rear_axle) * SCALE)
chassis = points((bpy.data.objects['chassis'],))
width_factor = FACTORY['width'] / ((max(v.x for v in chassis) - min(v.x for v in chassis)) * SCALE)

for obj in body:
    inverse = obj.matrix_world.inverted()
    for vertex in obj.data.vertices:
        p = obj.matrix_world @ vertex.co
        p.x *= width_factor
        if p.y < front_axle:
            p.y = front_axle + (p.y - front_axle) * front_factor
        elif p.y > rear_axle:
            p.y = rear_axle + (p.y - rear_axle) * rear_factor
        p.z = p.z * height_factor + height_offset
        vertex.co = inverse @ p
    obj.data.update()

fitted = points(body)
measurements = {
    'bodyLengthM': (max(v.y for v in fitted) - min(v.y for v in fitted)) * SCALE,
    'frontOverhangM': (front_axle - min(v.y for v in fitted)) * SCALE,
    'rearOverhangM': (max(v.y for v in fitted) - rear_axle) * SCALE,
    'bodyWidthM': (max(v.x for v in points((bpy.data.objects['chassis'],))) -
                   min(v.x for v in points((bpy.data.objects['chassis'],)))) * SCALE,
    'includingMirrorsWidthM': (max(v.x for v in fitted) - min(v.x for v in fitted)) * SCALE,
    'heightAboveTyreBottomM': (max(v.z for v in fitted) - wheel_bottom) * SCALE,
    'lowestBodyClearanceM': (min(v.z for v in fitted) - wheel_bottom) * SCALE,
}
for actual, expected in (
    ('bodyLengthM', FACTORY['length']), ('frontOverhangM', front_overhang),
    ('rearOverhangM', rear_overhang), ('bodyWidthM', FACTORY['width']),
    ('heightAboveTyreBottomM', FACTORY['height']),
    ('lowestBodyClearanceM', FACTORY['clearance']),
):
    assert abs(measurements[actual] - expected) < .0001, (actual, measurements[actual], expected)
assert all((a-b).length < 1e-9 for a,b in zip(points(wheels),wheel_points))

# One circumferential ring at the tyre bead is nominally 13 inches in diameter;
# the visible stamped rim lip extends outboard and is not the bead-seat diameter.
wheel = wheels[0]
centre = SOURCE['wheels']['wheel_fl']['centreSourceUnits']
bead_radii = [hypot((wheel.matrix_world @ v.co).y - centre[1],
                    (wheel.matrix_world @ v.co).z - centre[2]) * SCALE
              for v in wheel.data.vertices]
bead = [r for r in bead_radii if abs(r - 13 * .0254 / 2) < .002]
assert len(bead) >= 60, len(bead)
measurements['rimBeadSeatDiameterM'] = 2 * sum(bead) / len(bead)
assert abs(measurements['rimBeadSeatDiameterM'] - 13 * .0254) < .002

OUTPUT.mkdir(parents=True, exist_ok=True)
result = OUTPUT / 'vaz2109-factory.glb'
bpy.ops.export_scene.gltf(filepath=str(result), export_format='GLB',
    export_apply=False, export_materials='EXPORT', export_cameras=False,
    export_lights=False, export_animations=False, export_normals=True)
(OUTPUT / 'factory-report.json').write_text(json.dumps({
    'sourceSha256': sha256(INPUT.read_bytes()).hexdigest(),
    'outputSha256': sha256(result.read_bytes()).hexdigest(),
    'selectedVariant': '1991 catalogue VAZ-2109, 1.3 L carburettor, five-speed manual',
    'sourceScaleMetresPerUnit': SCALE,
    'factoryGeometry': FACTORY,
    'mirrorWidthM': measurements['includingMirrorsWidthM'],
    'factoryTyre': '165/70 R13',
    'factoryRim': '4.5Jx13 steel',
    'factors': {'frontOverhang': front_factor, 'rearOverhang': rear_factor,
                'bodyWidth': width_factor,
                'bodyHeight': height_factor, 'bodyHeightOffsetSourceUnits': height_offset},
    'measured': measurements,
    'wheelsUntouched': True,
}, indent=2) + '\n')
print('FACTORY_FIT', json.dumps(measurements, sort_keys=True))
