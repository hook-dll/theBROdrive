"""Normalize the personal-use GTA SA VAZ-2109 DFF to a staged, texture-free GLB.

Run with Blender 5.2 + DragonFF:
  /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
    --python tools/normalize-vaz2109-dff.py

Source: vehicle_import/vaz_2109/admiral.dff, SHA-256
  e5fcd335de617c5527c3275b98e0cc6a410a2c6e8bb7a4b360f12d88d5cfa88f
Personal-use source; redistribution terms unknown. This stage deliberately does not
simplify, fit factory dimensions, copy wheels or assign final lamp functions.
"""
from __future__ import annotations

from collections import Counter
from hashlib import sha256
import json
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / 'build/vehicles/vaz2109_admiral'
SOURCE = WORK / '00-intake/admiral.dff'
OUTPUT = WORK / '20-normalized'
EXPECTED_HASH = 'e5fcd335de617c5527c3275b98e0cc6a410a2c6e8bb7a4b360f12d88d5cfa88f'

# Whole components have unambiguous source roles. The four complete healthy doors
# (including their authored door cards) stay; damaged copies never do.
KEEP = {
    'bonnet_ok', 'boot_ok', 'bump_front_ok', 'bump_rear_ok', 'chassis',
    'dnishe', 'dool_lf_ok', 'dool_lr_ok', 'dool_rf_ok', 'door_rr_ok',
    'dvorniki', 'fara', 'fara_sleklo', 'lights', 'liniya', 'reshotka',
    'windscreen_ok', 'wing_left_ok01', 'wheel',
}
# Materials within mixed meshes that belong to cabin, engine bay, exhaust,
# source running gear or boot lining. Never discard an entire body mesh by regex.
REMOVE_MATERIALS = {
    'boot_ok': {'tkan_1'},
    'chassis': {'mafon.001'},
    'dnishe': {'dnishe.1', 'dnishe.3', 'dnishe.4', 'dnishe.5',
               'dnishe.6', 'dnishe.7'},
}
# `cloth` is used as opaque source window tint on this car, not as interior cloth.
# `tkan_3` on the doors is the authored door card and stays as trim.
GLASS_MATERIALS = {
    'cloth', 'cloth.001', 'cloth.002', 'cloth.005', 'cloth.004',
    'windscreen_ok.0', 'dool_lf_ok.0', 'dool_rf_ok.0', 'glass.005',
}
LAMP_MATERIALS = {'vehiclelights128', 'vehiclelights128.001',
                  'vehiclelights128.002', 'fara.0', 'fara_sleklo.0',
                  'osfar_zad.004', 'osfar_zad.002', 'osfar_zad'}
# Four wheel centres are trusted dummies. Positioning/copying the source wheel is
# deferred to the separate, user-approved wheel/geometry stage.
DUMMIES = ('wheel_lf_dummy', 'wheel_rf_dummy', 'wheel_lb_dummy', 'wheel_rb_dummy')
COLORS = {
    'car_paint': (0.24, 0.32, 0.13, 1),
    'car_trim': (0.07, 0.075, 0.08, 1),
    'car_glass': (0.055, 0.10, 0.15, 1),
    'lens_candidate_front': (0.73, 0.72, 0.58, 1),
    'lens_candidate_rear': (0.45, 0.10, 0.06, 1),
    'Tyres': (0.018, 0.02, 0.022, 1),
    'wheel_rim': (0.46, 0.47, 0.47, 1),
}


def role(obj_name: str, material_name: str, face_y: float) -> str:
    if obj_name == 'wheel':
        return 'Tyres' if material_name in {'wheel.2', 'wheel.4'} else 'wheel_rim'
    if material_name in GLASS_MATERIALS:
        return 'car_glass'
    if material_name in LAMP_MATERIALS:
        return 'lens_candidate_front' if face_y > 0 else 'lens_candidate_rear'
    if material_name.startswith('primary'):
        return 'car_paint'
    return 'car_trim'


def new_material(name: str) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.diffuse_color = COLORS[name]
    material.use_nodes = True
    shader = material.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = COLORS[name]
    shader.inputs['Metallic'].default_value = 0
    shader.inputs['Roughness'].default_value = 0.52
    return material


def normalize() -> None:
    assert sha256(SOURCE.read_bytes()).hexdigest() == EXPECTED_HASH, 'DFF changed since inspection'
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    bpy.ops.preferences.addon_enable(module='DragonFF')
    result = bpy.ops.import_scene.dff(filepath=str(SOURCE), load_images=False,
        read_mat_split=True, remove_doubles=True, create_backfaces=False,
        import_normals=True, hide_damage_parts=False, group_materials=False,
        materials_naming='TEX')
    assert 'FINISHED' in result, result
    bpy.context.view_layer.update()
    source_meshes = {o.name: o for o in bpy.data.objects if o.type == 'MESH'}
    assert len(source_meshes) == 45 and KEEP <= source_meshes.keys(), 'Source hierarchy changed'
    before = sum(len(o.data.polygons) for o in source_meshes.values())
    # Rotation around the Blender vertical: GTA +Y (nose) -> Blender -Y ->
    # glTF +Z. GTA -X (driver side) -> glTF +X, with positive determinant.
    turn = Matrix.Rotation(3.141592653589793, 4, 'Z')
    mount_positions = {name: turn @ bpy.data.objects[name].matrix_world.translation
                       for name in DUMMIES}
    materials = {name: new_material(name) for name in COLORS}
    removed = Counter()
    kept = Counter()
    for obj in list(source_meshes.values()):
        if obj.name not in KEEP:
            removed[obj.name] += len(obj.data.polygons)
            bpy.data.objects.remove(obj, do_unlink=True)
            continue
        original_names = [s.material.name if s.material else '' for s in obj.material_slots]
        assert all(name for name in original_names), obj.name
        # Remove only source material groups that are known non-exterior. This
        # preserves original panel seams, window outlines and complete door cards.
        mesh = obj.data
        bm = bmesh.new()
        bm.from_mesh(mesh)
        unwanted = REMOVE_MATERIALS.get(obj.name, set())
        faces = [f for f in bm.faces if original_names[f.material_index] in unwanted]
        for f in faces:
            removed[f'{obj.name}:{original_names[f.material_index]}'] += 1
        if faces:
            bmesh.ops.delete(bm, geom=faces, context='FACES')
            bm.to_mesh(mesh)
            mesh.update()
        bm.free()
        if obj.name == 'wheel':
            obj.name = 'source_wheel_front_right'
        source_name = 'wheel' if obj.name == 'source_wheel_front_right' else obj.name
        roles = []
        for polygon in mesh.polygons:
            source_mat = original_names[polygon.material_index]
            y = sum((obj.matrix_world @ mesh.vertices[i].co).y
                    for i in polygon.vertices) / len(polygon.vertices)
            current_role = role(source_name, source_mat, y)
            roles.append(current_role)
            kept[f'{source_name}:{current_role}'] += 1
        role_indices = {name: index for index, name in enumerate(COLORS)}
        mesh.materials.clear()
        for name in COLORS:
            mesh.materials.append(materials[name])
        for polygon, current_role in zip(mesh.polygons, roles):
            polygon.material_index = role_indices[current_role]
        # Source TXD is not used by the game. Remove UVs only after semantic
        # material roles have been assigned from the original material slots.
        while mesh.uv_layers:
            mesh.uv_layers.remove(mesh.uv_layers[0])
        world = (turn @ obj.matrix_world).copy()
        obj.parent = None
        obj.matrix_world = world
        mesh.transform(obj.matrix_world)
        obj.matrix_world = Matrix.Identity(4)
        assert obj.matrix_world.determinant() > 0
    for obj in list(bpy.data.objects):
        if obj.type != 'MESH':
            bpy.data.objects.remove(obj, do_unlink=True)
    # Preserve the authored ribbed cabin floor and wheel wells. Only the open
    # engine bay gets a thin inboard floor and a short bulkhead below the bonnet.
    closures = (
        ('front_bay_floor', (0, -1.42, -0.433), (1.16, 1.23, 0.026)),
        ('front_bay_bulkhead', (0, -1.92, -0.32), (1.10, 0.026, 0.30)),
    )
    for name, centre, dimensions in closures:
        bpy.ops.mesh.primitive_cube_add(size=1, location=centre)
        plate = bpy.context.object
        plate.name = name
        plate.data.name = name
        plate.dimensions = dimensions
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        plate.data.materials.append(materials['car_trim'])
        while plate.data.uv_layers:
            plate.data.uv_layers.remove(plate.data.uv_layers[0])
    added = sum(sum(len(p.vertices) - 2 for p in bpy.data.objects[name].data.polygons)
                for name, _, _ in closures)
    for name, position in mount_positions.items():
        mount = bpy.data.objects.new(name, None)
        bpy.context.scene.collection.objects.link(mount)
        mount.location = position
    after = sum(len(p.vertices) - 2 for o in bpy.data.objects if o.type == 'MESH'
                for p in o.data.polygons)
    assert before + added == sum(removed.values()) + after, (before, removed, added, after)
    assert not any(o.name.startswith('nomer') for o in bpy.data.objects)
    assert len([o for o in bpy.data.objects if o.type == 'MESH']) == len(KEEP) + len(closures)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / 'report.json').write_text(json.dumps({
        'sourceSha256': EXPECTED_HASH, 'sourceTriangles': before,
        'removedTriangles': sum(removed.values()), 'addedTriangles': added,
        'normalizedTriangles': after,
        'removed': dict(removed), 'keptByRole': dict(kept),
        'mountsBlender': {k: [round(v, 5) for v in p] for k, p in mount_positions.items()},
        'notes': ['No decimation or factory fit yet', 'One original wheel remains unpaired',
                  'Lamp candidates are not final light functions', 'Source plates removed',
                  'Authored cabin floor remains; only front engine bay is closed'],
    }, indent=2) + '\n')
    bpy.ops.export_scene.gltf(filepath=str(OUTPUT / 'vaz2109-normalized.glb'),
        export_format='GLB', export_apply=False, export_materials='EXPORT',
        export_cameras=False, export_lights=False, export_animations=False,
        export_normals=True)
    print('NORMALIZED', before, '->', after, 'triangles', OUTPUT)


if __name__ == '__main__':
    normalize()
