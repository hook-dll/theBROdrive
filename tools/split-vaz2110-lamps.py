#!/usr/bin/env python3
"""Split the VAZ-2110 lamp shells into independently controlled factory sections.

Run with Blender, not CPython:

  blender --background --python tools/split-vaz2110-lamps.py -- input.glb output.glb

Blender's imported coordinates are X left, Y rearward, Z up. The cut planes are
measured from the Kirzhach front and DAAZ rear lamp boundaries in this model.
"""

from __future__ import annotations

import sys
from pathlib import Path

import bmesh
import bpy


FRONT_INDICATOR_X = 0.65
FRONT_AUXILIARY_Z = -0.30
REAR_CENTRE_X = 0.326
REAR_BRAKE_REVERSE_X = 0.437
REAR_TRUNK_OUTER_X = 0.55
REAR_FOG_RUNNING_X = 0.66
REAR_INDICATOR_Z = 0.10

MATERIALS = {
    "Headlights": ((0.72, 0.76, 0.74, 1.0), 0.18, 0.0),
    # sRGB #f26716 from the VAZ-2104 atlas, converted to glTF/Blender linear RGB.
    "IndicatorLights": ((0.887923, 0.135633, 0.008023, 1.0), 0.20, 0.0),
    "TailLights": ((0.24, 0.006, 0.003, 1.0), 0.28, 0.0),
    "BrakeLights": ((0.32, 0.008, 0.004, 1.0), 0.28, 0.0),
    "ReverseLights": ((0.78, 0.80, 0.76, 1.0), 0.20, 0.0),
    "PassiveRearLights": ((0.20, 0.005, 0.003, 1.0), 0.32, 0.0),
    "AuxiliaryLights": ((0.30, 0.32, 0.31, 1.0), 0.35, 0.0),
}

ROLE_MATERIALS = {
    "headlights": "Headlights",
    "front_blinker_left": "IndicatorLights",
    "front_blinker_right": "IndicatorLights",
    "front_auxiliary": "AuxiliaryLights",
    "taillights": "TailLights",
    "brake_lights": "BrakeLights",
    "reverse_lights": "ReverseLights",
    "rear_blinker_left": "IndicatorLights",
    "rear_blinker_right": "IndicatorLights",
    "rear_passive": "PassiveRearLights",
}


def make_material(name: str) -> bpy.types.Material:
    colour, roughness, metallic = MATERIALS[name]
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    material.diffuse_color = colour
    material.use_nodes = True
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = colour
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    return material


def bisect_at_planes(obj: bpy.types.Object, planes: list[tuple[str, float]]) -> None:
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    for axis, offset in planes:
        normal = {
            "x": (1.0, 0.0, 0.0),
            "z": (0.0, 0.0, 1.0),
        }[axis]
        point = {
            "x": (offset, 0.0, 0.0),
            "z": (0.0, 0.0, offset),
        }[axis]
        bmesh.ops.bisect_plane(
            bm,
            geom=[*bm.verts, *bm.edges, *bm.faces],
            plane_co=point,
            plane_no=normal,
            clear_inner=False,
            clear_outer=False,
        )
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()


def split_object(
    obj: bpy.types.Object,
    roles: list[str],
    classify,
) -> dict[str, int]:
    counts: dict[str, int] = {}
    clones: dict[str, bpy.types.Object] = {}
    for role in roles:
        clone = obj.copy()
        clone.data = obj.data.copy()
        clone.name = f"__lamp_{role}"
        clone.data.name = f"__lamp_{role}"
        bpy.context.collection.objects.link(clone)
        clones[role] = clone

        bm = bmesh.new()
        bm.from_mesh(clone.data)
        remove = [face for face in bm.faces if classify(face.calc_center_median()) != role]
        bmesh.ops.delete(bm, geom=remove, context="FACES")
        loose = [vertex for vertex in bm.verts if not vertex.link_faces]
        if loose:
            bmesh.ops.delete(bm, geom=loose, context="VERTS")
        counts[role] = len(bm.faces)
        bm.to_mesh(clone.data)
        bm.free()

        clone.data.materials.clear()
        clone.data.materials.append(make_material(ROLE_MATERIALS[role]))
        for polygon in clone.data.polygons:
            polygon.material_index = 0

    source_mesh = obj.data
    bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.meshes.remove(source_mesh)
    for role, clone in clones.items():
        clone.name = role
        clone.data.name = role
    return counts


def classify_front(point) -> str:
    if point.z < FRONT_AUXILIARY_Z:
        return "front_auxiliary"
    if abs(point.x) < FRONT_INDICATOR_X:
        return "headlights"
    return "front_blinker_left" if point.x > 0 else "front_blinker_right"


def classify_rear(point) -> str:
    x = abs(point.x)
    if x < REAR_CENTRE_X:
        return "rear_passive"
    if x < REAR_BRAKE_REVERSE_X:
        return "brake_lights"
    if x < REAR_TRUNK_OUTER_X:
        return "reverse_lights"
    side = "left" if point.x > 0 else "right"
    if point.z > REAR_INDICATOR_Z:
        return f"rear_blinker_{side}"
    if x < REAR_FOG_RUNNING_X:
        return "taillights"
    return "rear_passive"


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(argv) != 2:
        raise SystemExit("usage: blender --background --python split-vaz2110-lamps.py -- input.glb output.glb")
    input_path, output_path = map(lambda value: Path(value).resolve(), argv)

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(input_path))
    objects = {obj.name.lower(): obj for obj in bpy.context.scene.objects if obj.type == "MESH"}
    if "headlights" not in objects or "taillights" not in objects:
        raise SystemExit(f"{input_path}: expected headlights and taillights mesh nodes")

    front = objects["headlights"]
    bisect_at_planes(
        front,
        [("x", -FRONT_INDICATOR_X), ("x", FRONT_INDICATOR_X), ("z", FRONT_AUXILIARY_Z)],
    )
    counts = split_object(
        front,
        ["headlights", "front_blinker_left", "front_blinker_right", "front_auxiliary"],
        classify_front,
    )

    rear = objects["taillights"]
    rear_x_planes = [
        REAR_CENTRE_X,
        REAR_BRAKE_REVERSE_X,
        REAR_TRUNK_OUTER_X,
        REAR_FOG_RUNNING_X,
    ]
    bisect_at_planes(
        rear,
        [("x", sign * value) for value in rear_x_planes for sign in (-1, 1)]
        + [("z", REAR_INDICATOR_Z)],
    )
    counts.update(
        split_object(
            rear,
            [
                "taillights",
                "brake_lights",
                "reverse_lights",
                "rear_blinker_left",
                "rear_blinker_right",
                "rear_passive",
            ],
            classify_rear,
        )
    )

    empty = [role for role, count in counts.items() if count == 0]
    if empty:
        raise SystemExit(f"empty lamp sections after cutting: {', '.join(empty)}")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(output_path), export_format="GLB")
    print(f"{output_path}: " + ", ".join(f"{role}={count}" for role, count in counts.items()))


if __name__ == "__main__":
    main()
