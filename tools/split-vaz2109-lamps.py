"""Split approved VAZ-2109 DFF lenses into independently controlled factory lights.

Input: 36-factory-fit/vaz2109-factory.glb. Output: 40-lamps/vaz2109-lamps.glb.
The source's osfar_zad TXD draws five rear bulb regions per side: inner red
stop, red fog above clear reverse, red running, and outer amber indicator.
Their mesh seams, measured after factory fit, are X=.45/.60/.705 and Z=.098.
The five-bulb holder is labelled in https://vaz-sputnik.ru/2109/9-4-3.html;
its fog bulb is passive because the game has no rear-fog control. Front source
vehiclelights128 provides the headlamp surface and fara_sleklo the outer amber
indicators. The source models each front-wing side repeater as a bare car_trim
bezel ring with painted wing showing through it; the repeater lens is the cap
over that ring's raised inner lip. The small osfar_zad patches inside the front
doors are hidden jamb pieces, not indicators, and become trim. Transparent glass
skins over the headlamps are removed so emission is actually visible.
"""
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path

import bmesh
import bpy

ROOT = Path(__file__).resolve().parents[1]
STAGE = ROOT / 'build/vehicles/vaz2109_admiral'
INPUT = STAGE / '36-factory-fit/vaz2109-factory.glb'
OUTPUT = STAGE / '40-lamps'
EXPECTED = json.loads((INPUT.parent / 'factory-report.json').read_text())['outputSha256']
assert sha256(INPUT.read_bytes()).hexdigest() == EXPECTED

COLORS = {
    'Headlights': (.72, .76, .74, 1),
    'IndicatorLights': (.887923, .135633, .008023, 1),
    'TailLights': (.24, .006, .003, 1),
    'BrakeLights': (.32, .008, .004, 1),
    'ReverseLights': (.78, .80, .76, 1),
    'PassiveRearLights': (.20, .005, .003, 1),
}
ROLE_MATERIALS = {
    'headlights': 'Headlights',
    'front_blinker_left': 'IndicatorLights',
    'front_blinker_right': 'IndicatorLights',
    'side_blinker_left': 'IndicatorLights',
    'side_blinker_right': 'IndicatorLights',
    'taillights': 'TailLights',
    'brake_lights': 'BrakeLights',
    'reverse_lights': 'ReverseLights',
    'rear_blinker_left': 'IndicatorLights',
    'rear_blinker_right': 'IndicatorLights',
    'rear_passive': 'PassiveRearLights',
}


def material(name):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.diffuse_color = COLORS[name]
    mat.use_nodes = True
    shader = mat.node_tree.nodes['Principled BSDF']
    shader.inputs['Base Color'].default_value = COLORS[name]
    shader.inputs['Roughness'].default_value = .23
    return mat


def face_material(obj, face):
    return obj.data.materials[face.material_index].name


def world_centre(obj, face):
    return obj.matrix_world @ face.calc_center_median()


def role(obj, face):
    name = face_material(obj, face)
    p = world_centre(obj, face)
    if obj.name == 'lights':
        if name == 'lens_candidate_front':
            return 'headlights'
        assert name == 'lens_candidate_rear', name
        return 'brake_lights'
    if obj.name == 'fara_sleklo':
        if name != 'lens_candidate_front':
            return None  # Front glass layer over the brighter lights mesh.
        return 'front_blinker_left' if p.x > 0 else 'front_blinker_right'
    if obj.name == 'chassis':
        if name != 'lens_candidate_rear':
            return None
        x = abs(p.x)
        side = 'left' if p.x > 0 else 'right'
        if x < .45:
            return 'rear_passive'  # Diffuser behind the brake's front lens.
        if x < .60:
            return 'rear_passive' if p.z >= .098 else 'reverse_lights'
        if x < .705:
            return 'taillights'
        return f'rear_blinker_{side}'
    raise AssertionError(obj.name)


def clone_faces(obj, target):
    copy = obj.copy()
    copy.data = obj.data.copy()
    bpy.context.collection.objects.link(copy)
    bm = bmesh.new()
    bm.from_mesh(copy.data)
    assigned = [f for f in bm.faces if role(obj, f) == target]
    assert assigned, (obj.name, target)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f not in assigned], context='FACES')
    bm.to_mesh(copy.data)
    bm.free()
    copy.data.materials.clear()
    copy.data.materials.append(material(ROLE_MATERIALS[target]))
    for f in copy.data.polygons:
        f.material_index = 0
    copy.name = target
    copy.data.name = target
    return sum(len(f.vertices)-2 for f in copy.data.polygons)


def remove_source_faces(obj, has_role):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    to_drop = [face for face in bm.faces if has_role(obj, face)]
    count = sum(len(f.verts)-2 for f in to_drop)
    bmesh.ops.delete(bm, geom=to_drop, context='FACES')
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return count


def remove_front_overglazing(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    glass = {f for f in bm.faces if face_material(obj, f) == 'car_glass'}
    # glTF duplicates vertices at its primitive/material boundaries. Reconnect
    # coincident positions before finding the authored front glass islands.
    by_position = {}
    keys = {}
    for face in glass:
        keys[face] = [tuple(round((obj.matrix_world @ v.co)[axis], 4) for axis in range(3))
                      for v in face.verts]
        for key in keys[face]:
            by_position.setdefault(key, set()).add(face)
    visited = set()
    removed = []
    for seed in glass:
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
        points = [obj.matrix_world @ v.co for face in island for v in face.verts]
        if max(p.y for p in points) < -1.93 and min(p.z for p in points) > 0:
            removed.extend(island)
    count = sum(len(f.verts)-2 for f in removed)
    assert count == 120, f'Unexpected front overglazing: {count} triangles'
    bmesh.ops.delete(bm, geom=removed, context='FACES')
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return count


bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(INPUT))
source_tris = sum(len(f.vertices)-2 for obj in bpy.data.objects if obj.type == 'MESH'
                  for f in obj.data.polygons)
count = Counter()
for name in ('chassis', 'lights', 'fara_sleklo'):
    obj = bpy.data.objects[name]
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    expected = Counter(role(obj, f) for f in bm.faces if role(obj, f))
    bm.free()
    for target in expected:
        count[target] += clone_faces(obj, target)
    if name in ('lights', 'fara_sleklo'):
        bpy.data.objects.remove(obj, do_unlink=True)
    else:
        assert remove_source_faces(obj, lambda o, f: role(o, f) is not None) == sum(expected.values())
# The detailed source lamp reflector assembly is not a lens surface: leave it
# stationary and non-emissive, but preserve its geometry behind the lens.
fara = bpy.data.objects['fara']
trim = bpy.data.materials['car_trim']
reflectors = 0
for polygon in fara.data.polygons:
    if fara.data.materials[polygon.material_index].name == 'lens_candidate_front':
        polygon.material_index = list(fara.data.materials).index(trim)
        reflectors += len(polygon.vertices)-2
assert reflectors == 1292

# The osfar_zad patches inside the front doors sit behind the closed door skin:
# they are jamb pieces, so they stay put as trim instead of becoming lamps.
jamb_patches = 0
for name in ('dool_lf_ok', 'dool_rf_ok'):
    door = bpy.data.objects[name]
    for polygon in door.data.polygons:
        if door.data.materials[polygon.material_index].name == 'lens_candidate_rear':
            polygon.material_index = list(door.data.materials).index(trim)
            jamb_patches += len(polygon.vertices)-2
assert jamb_patches == 20, jamb_patches


def add_side_repeater_lenses():
    """Cap each front-wing repeater bezel's raised inner lip with a lens."""
    chassis = bpy.data.objects['chassis']
    trim_index = list(chassis.data.materials).index(trim)
    rings = {'left': [], 'right': []}
    for polygon in chassis.data.polygons:
        c = chassis.matrix_world @ polygon.center
        if polygon.material_index == trim_index and abs(c.x) > .85 \
                and -1.0 < c.y < -.86 and .04 < c.z < .10:
            rings['left' if c.x > 0 else 'right'].append(polygon)
    tris = {}
    for side, polygons in rings.items():
        assert sum(len(p.vertices)-2 for p in polygons) == 28, (side, len(polygons))
        # glTF splits vertices at normal seams: weld by position to find loops.
        index_of = {}
        points = []
        edges = Counter()
        for polygon in polygons:
            keys = []
            for i in polygon.vertices:
                point = chassis.matrix_world @ chassis.data.vertices[i].co
                key = tuple(round(v, 5) for v in point)
                if key not in index_of:
                    index_of[key] = len(points)
                    points.append(point)
                keys.append(index_of[key])
            for a, b in zip(keys, keys[1:] + keys[:1]):
                edges[frozenset((a, b))] += 1
        neighbours = {}
        for edge, uses in edges.items():
            if uses == 1:
                a, b = tuple(edge)
                neighbours.setdefault(a, []).append(b)
                neighbours.setdefault(b, []).append(a)
        assert all(len(n) == 2 for n in neighbours.values()), side
        loops = []
        unvisited = set(neighbours)
        while unvisited:
            loop = [unvisited.pop()]
            while True:
                following = [n for n in neighbours[loop[-1]] if n in unvisited]
                if not following:
                    break
                unvisited.remove(following[0])
                loop.append(following[0])
            loops.append(loop)
        assert len(loops) == 2, (side, [len(loop) for loop in loops])
        # The lip stands proud of the wing; the other loop lies on the paint.
        lip = max(loops, key=lambda loop: sum(abs(points[i].x) for i in loop) / len(loop))
        mesh = bpy.data.meshes.new(f'side_blinker_{side}')
        mesh.from_pydata([points[i] for i in lip], [], [list(range(len(lip)))])
        outward = 1 if side == 'left' else -1
        if mesh.polygons[0].normal.x * outward < 0:
            mesh.flip_normals()
        mesh.materials.append(material('IndicatorLights'))
        lens = bpy.data.objects.new(f'side_blinker_{side}', mesh)
        bpy.context.collection.objects.link(lens)
        tris[f'side_blinker_{side}'] = len(lip) - 2
    return tris


count.update(add_side_repeater_lenses())
removed_glass = remove_front_overglazing(bpy.data.objects['liniya'])
assert count['headlights'] == 30 and count['brake_lights'] == 94
assert count['front_blinker_left'] == count['front_blinker_right'] == 8
assert count['side_blinker_left'] == count['side_blinker_right'] == 12
assert sum(count.values()) > 300
result_tris = sum(len(f.vertices)-2 for obj in bpy.data.objects if obj.type == 'MESH'
                  for f in obj.data.polygons)
side_lens_tris = count['side_blinker_left'] + count['side_blinker_right']
assert result_tris == source_tris - 30 - removed_glass + side_lens_tris, (source_tris,result_tris)
OUTPUT.mkdir(parents=True, exist_ok=True)
result = OUTPUT / 'vaz2109-lamps.glb'
bpy.ops.export_scene.gltf(filepath=str(result), export_format='GLB',
    export_apply=False, export_materials='EXPORT', export_cameras=False,
    export_lights=False, export_animations=False, export_normals=True)
(OUTPUT/'report.json').write_text(json.dumps({
    'inputSha256':EXPECTED,'outputSha256':sha256(result.read_bytes()).hexdigest(),
    'sourceTriangles':source_tris,'resultTriangles':result_tris,
    'removedOverlappingHeadlightGlassTriangles':30+removed_glass,
    'nonEmissiveInnerHeadlightReflectorTriangles':reflectors,
    'doorJambPatchesToTrimTriangles':jamb_patches,
    'sideRepeaterLensTriangles':side_lens_tris,
    'roleTriangles':dict(count),
    'source': 'https://vaz-sputnik.ru/2109/9-4-3.html',
    'fiveRearBulbs': ['brake','reverse','rear_fog_passive','position','indicator'],
    'wheelsUntouched':True,
},indent=2)+'\n')
print('LAMPS',dict(count),'TRIANGLES',source_tris,'->',result_tris)
