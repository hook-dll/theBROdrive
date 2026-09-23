"""Discard the GTA wheel; the game will use the existing Soviet VAZ-2109 wheel set.

Reads the approved 20-normalized GLB; does not decimate the 29k-triangle body.
The following wheel stage copies and fits four actual 500-triangle vz09.fbx
wheels at the preserved DFF mounts. Runtime can use the same sv_vaz2109 donor.
"""
from hashlib import sha256
import json
from pathlib import Path
import bpy

ROOT = Path(__file__).resolve().parents[1]
INPUT = ROOT / 'build/vehicles/vaz2109_admiral/20-normalized/vaz2109-normalized.glb'
OUTPUT = ROOT / 'build/vehicles/vaz2109_admiral/30-geometry'

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(INPUT))
source_wheel = bpy.data.objects.get('source_wheel_front_right')
assert source_wheel and source_wheel.type == 'MESH', 'Staged source wheel missing'
source_tris = sum(len(p.vertices) - 2 for p in source_wheel.data.polygons)
assert source_tris == 26766, 'Wheel changed since inspection'
bpy.data.objects.remove(source_wheel, do_unlink=True)
mounts = ('wheel_lf_dummy', 'wheel_rf_dummy', 'wheel_lb_dummy', 'wheel_rb_dummy')
assert all(bpy.data.objects.get(name) for name in mounts), 'Source wheel mounts missing'
body_tris = sum(len(p.vertices) - 2 for o in bpy.data.objects if o.type == 'MESH'
                for p in o.data.polygons)
expected = json.loads((INPUT.parent / 'report.json').read_text())['normalizedTriangles'] - source_tris
assert body_tris == expected and body_tris <= 30000, f'Unexpected body triangle count: {body_tris}'
OUTPUT.mkdir(parents=True, exist_ok=True)
result = OUTPUT / 'vaz2109-body.glb'
bpy.ops.export_scene.gltf(filepath=str(result), export_format='GLB',
    export_apply=False, export_materials='EXPORT', export_cameras=False,
    export_lights=False, export_animations=False, export_normals=True)
(OUTPUT / 'report.json').write_text(json.dumps({
    'inputSha256': sha256(INPUT.read_bytes()).hexdigest(),
    'outputSha256': sha256(result.read_bytes()).hexdigest(),
    'discardedSourceWheelTriangles': source_tris,
    'bodyTriangles': body_tris,
    'donorPlanned': 'sv_vaz2109',
    'mountsPreserved': list(mounts),
    'bodyDecimated': False,
    'note': 'Four donor wheel meshes are fitted to the preserved mounts in the next stage',
}, indent=2) + '\n')
print('BODY', body_tris, 'triangles; discarded wheel', source_tris)
