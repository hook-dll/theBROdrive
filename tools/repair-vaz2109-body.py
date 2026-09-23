"""Remove source rear protrusions, close the tailgate shut line, keep factory-width body and mirrors."""
from hashlib import sha256
import json
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / 'build/vehicles/vaz2109_admiral'
INPUT = WORK / '40-lamps/vaz2109-lamps.glb'
OUTPUT = WORK / '50-assembled'
EXPECTED = json.loads((WORK / '40-lamps/report.json').read_text())['outputSha256']
assert sha256(INPUT.read_bytes()).hexdigest() == EXPECTED

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(INPUT))



def existing_material(name):
    mat = bpy.data.materials.get(name)
    assert mat, name
    return mat


def add_integrated_surface(obj, name, world_vertices, faces, material):
    """Append faces to an existing body mesh; no extra floating object/node."""
    assert obj.type == 'MESH'
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    inv = obj.matrix_world.inverted()
    unique = {}
    verts = []
    for vertex in world_vertices:
        key = tuple(round(value, 6) for value in vertex)
        if key not in unique:
            unique[key] = bm.verts.new(inv @ Vector(vertex))
        verts.append(unique[key])
    bm.verts.ensure_lookup_table()
    for indices in faces:
        face = bm.faces.new([verts[vertex] for vertex in indices])
        face.material_index = obj.data.materials[:].index(material)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    obj.name = name


trim = existing_material('car_trim')


# Keep the approved opaque backing behind the grille in the existing grille mesh.
grille = bpy.data.objects['reshotka']
add_integrated_surface(
    grille, 'reshotka',
    [(-.36, -2.019, -.018), (.36, -2.019, -.018),
     (.36, -2.019, .162), (-.36, -2.019, .162),
     (-.36, -1.993, -.018), (.36, -1.993, -.018),
     (.36, -1.993, .162), (-.36, -1.993, .162)],
    [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
     (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)],
    trim,
)

# Remove the measured rear underbody spare-wheel island. It is the only dnishe
# car_trim island with this rear span and low underside bounds.
obj = bpy.data.objects['dnishe']
bm = bmesh.new()
bm.from_mesh(obj.data)
trim_index = obj.data.materials[:].index(trim)
trim_faces = {face for face in bm.faces if face.material_index == trim_index}
by_position = {}
keys = {}
for face in trim_faces:
    keys[face] = [tuple(round((obj.matrix_world @ vertex.co)[axis], 4) for axis in range(3))
                  for vertex in face.verts]
    for key in keys[face]:
        by_position.setdefault(key, set()).add(face)
visited = set()
spare_island = None
for seed in trim_faces:
    if seed in visited:
        continue
    queue = [seed]
    visited.add(seed)
    island = []
    while queue:
        face = queue.pop()
        island.append(face)
        for key in keys[face]:
            for other in by_position[key] - visited:
                visited.add(other)
                queue.append(other)
    points = [obj.matrix_world @ vertex.co for face in island for vertex in face.verts]
    low = Vector(tuple(min(point[axis] for point in points) for axis in range(3)))
    high = Vector(tuple(max(point[axis] for point in points) for axis in range(3)))
    if low.y > 1.1 and high.y < 1.95 and low.z < -.30:
        assert spare_island is None, 'multiple spare-wheel islands matched'
        spare_island = island
assert spare_island and sum(len(face.verts) - 2 for face in spare_island) == 84
bmesh.ops.delete(bm, geom=spare_island, context='FACES')
bm.to_mesh(obj.data)
bm.free()
obj.data.update()

# Remove the actual 38-face rear plate island. Adjacent chassis paint already
# supplies the rear panel; do not cover either surface with a new rectangle.
rear = bpy.data.objects['chassis']
rear_bm = bmesh.new()
rear_bm.from_mesh(rear.data)
plate = []
for face in rear_bm.faces:
    if rear.data.materials[face.material_index] != trim:
        continue
    points = [rear.matrix_world @ vertex.co for vertex in face.verts]
    low = Vector(tuple(min(point[axis] for point in points) for axis in range(3)))
    high = Vector(tuple(max(point[axis] for point in points) for axis in range(3)))
    if low.x > -.3 and high.x < .3 and low.y > 2 and high.z < .16:
        plate.append(face)
assert len(plate) == 38, len(plate)
bmesh.ops.delete(rear_bm, geom=plate, context='FACES')
rear_bm.to_mesh(rear.data)
rear_bm.free()
rear.data.update()

# Close the source's see-through slit between the plate-recess ceiling and the
# tailgate's lower flange. The chassis ceiling faces down and stops at one
# straight edge; the flange bottom runs 3-26 mm further back, so a low camera
# looks up through the gap into the open tailgate shell. Bridge the ceiling edge
# to the flange's own bottom vertices as chassis paint: sharing those positions
# leaves no grazing-angle crack between the two meshes.
paint = existing_material('car_paint')
ceiling_edges = []
ceiling_bm = bmesh.new()
ceiling_bm.from_mesh(rear.data)
bmesh.ops.remove_doubles(ceiling_bm, verts=ceiling_bm.verts, dist=1e-4)
for edge in ceiling_bm.edges:
    if not edge.is_boundary:
        continue
    a, b = (rear.matrix_world @ vertex.co for vertex in edge.verts)
    if abs(a.x + b.x) < 1e-3 and abs(a.x) > .3 and abs(a.y - b.y) < 1e-3 \
            and 2.03 < a.y < 2.06 and .18 < a.z < .20 and abs(a.z - b.z) < 1e-3:
        ceiling_edges.append((a, b) if a.x < b.x else (b, a))
ceiling_bm.free()
assert len(ceiling_edges) == 1, ceiling_edges
ceiling_left, ceiling_right = ceiling_edges[0]

tailgate = bpy.data.objects['boot_ok']
flange = {}
for poly in tailgate.data.polygons:
    normal = (tailgate.matrix_world.to_3x3() @ poly.normal).normalized()
    if tailgate.data.materials[poly.material_index] != paint or normal.y > -.9:
        continue
    for index in poly.vertices:
        point = tailgate.matrix_world @ tailgate.data.vertices[index].co
        if abs(point.x) < .46 and 2.03 < point.y < 2.08 and .19 < point.z < .195:
            key = round(point.x, 3)
            if key not in flange or point.y < flange[key].y:
                flange[key] = point
flange = [flange[key] for key in sorted(flange)]
assert len(flange) == 11 and flange[0].x < ceiling_left.x and flange[-1].x > ceiling_right.x, flange


def on_flange(x):
    for a, b in zip(flange, flange[1:]):
        if a.x <= x <= b.x:
            return a.lerp(b, (x - a.x) / (b.x - a.x))
    raise AssertionError(x)


backs = [on_flange(ceiling_left.x)] + [p for p in flange
                                       if ceiling_left.x < p.x < ceiling_right.x] + [on_flange(ceiling_right.x)]
shut_vertices = []
for back in backs:
    front = ceiling_left.lerp(ceiling_right, (back.x - ceiling_left.x) / (ceiling_right.x - ceiling_left.x))
    assert back.y > front.y and abs(back.z - front.z) < .005, (front, back)
    shut_vertices += [tuple(front), tuple(back)]
# Clockwise from above: the new faces point down, like the recess ceiling.
shut_faces = [(2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2) for i in range(len(backs) - 1)]
add_integrated_surface(rear, 'chassis', shut_vertices, shut_faces, paint)

OUTPUT.mkdir(parents=True, exist_ok=True)
result = OUTPUT / 'vaz2109-assembled.glb'
bpy.ops.export_scene.gltf(filepath=str(result), export_format='GLB',
    export_apply=False, export_materials='EXPORT', export_cameras=False,
    export_lights=False, export_animations=False, export_normals=True)
report = {
    'inputSha256': EXPECTED,
    'outputSha256': sha256(result.read_bytes()).hexdigest(),
    'repairs': {
        'grilleBacking': {'object': 'reshotka', 'material': 'car_trim'},
        'rearPlateRemovedFaces': 38,
        'removedSpareWheelIslandTriangles': 84,
        'tailgateShutLine': {'object': 'chassis', 'material': 'car_paint',
                             'quads': len(shut_faces),
                             'stationsX': [round(back.x, 4) for back in backs]},
        'mirrors': 'source geometry retained at its original proportions',
    },
    'wheelsUntouched': True,
    'lampNodesUntouched': True,
    'noAddedBodyObjects': True,
}
(OUTPUT / 'repair-report.json').write_text(json.dumps(report, indent=2) + '\n')
(OUTPUT / 'report.json').write_text(json.dumps({
    'inputSha256': EXPECTED,
    'outputSha256': report['outputSha256'],
    'assembly': 'stage 40 lamp GLB with source plate/bulge removed and tailgate shut line closed; mirrors unchanged',
    'wheelsUntouched': True,
}, indent=2) + '\n')
print('BODY_REPAIRS', json.dumps(report['repairs'], sort_keys=True))
