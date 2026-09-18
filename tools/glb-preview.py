#!/usr/bin/env python3
"""
tools/glb-preview.py -- headless multi-angle screenshot of a GLB, for the
visual review gates in tools/vehicle-pipeline.md (inspection keep/drop calls,
decimate A/B, lamp cuts) when nobody is at a live Blender session.

Usage:
    blender --background --factory-startup --python tools/glb-preview.py -- \
        <input.glb> <out_dir> [--views front3q,side,rear3q,top] [--dist 6]

Renders flat-lit Eevee stills, one PNG per view, named `<out_dir>/<view>.png`.
Materials come straight from the GLB (inspection exports carry the source
shader's approximate colour; normalized exports carry the runtime materials),
so this is for silhouette/grouping/placement review, not colour-accurate art
review.
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

VIEWS = {
    # name: (yaw_degrees_from_front, pitch_degrees_above_horizon)
    "front": (0, 12),
    "front3q": (35, 15),
    "side": (90, 8),
    "rear3q": (145, 15),
    "rear": (180, 12),
    "top": (45, 80),
}


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.cameras, bpy.data.lights):
        for datablock in list(datablocks):
            if datablock.users == 0:
                datablocks.remove(datablock)


def bounds_of(objects: list[bpy.types.Object]) -> tuple[list[float], float]:
    lo = [math.inf, math.inf, math.inf]
    hi = [-math.inf, -math.inf, -math.inf]
    for obj in objects:
        if obj.type != "MESH":
            continue
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            for axis in range(3):
                lo[axis] = min(lo[axis], world[axis])
                hi[axis] = max(hi[axis], world[axis])
    centre = [(lo[i] + hi[i]) / 2 for i in range(3)]
    radius = max(0.5, max(hi[i] - lo[i] for i in range(3)) / 2)
    return centre, radius


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1 :]
    if len(argv) < 2:
        raise SystemExit("usage: blender --background --python tools/glb-preview.py -- <input.glb> <out_dir> [--views a,b] [--dist 6]")
    src = Path(argv[0]).resolve()
    out_dir = Path(argv[1]).resolve()
    views = list(VIEWS)
    dist_scale = 2.2
    solo: list[str] = []
    i = 2
    while i < len(argv):
        if argv[i] == "--views":
            views = argv[i + 1].split(",")
            i += 2
        elif argv[i] == "--dist":
            dist_scale = float(argv[i + 1])
            i += 2
        elif argv[i] == "--solo":
            solo = argv[i + 1].split(",")
            i += 2
        else:
            i += 1

    out_dir.mkdir(parents=True, exist_ok=True)
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(src))
    imported = list(bpy.context.scene.objects)
    if solo:
        red = bpy.data.materials.new("solo_highlight")
        red.use_nodes = True
        bsdf = red.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            bsdf.inputs["Base Color"].default_value = (1.0, 0.05, 0.55, 1.0)
            if "Emission Color" in bsdf.inputs:
                bsdf.inputs["Emission Color"].default_value = (1.0, 0.05, 0.55, 1.0)
                bsdf.inputs["Emission Strength"].default_value = 1.2
        dim = bpy.data.materials.new("solo_dim")
        dim.use_nodes = True
        dim_bsdf = dim.node_tree.nodes.get("Principled BSDF")
        if dim_bsdf:
            dim_bsdf.inputs["Base Color"].default_value = (0.55, 0.55, 0.57, 1.0)
        for obj in imported:
            if obj.type != "MESH":
                continue
            hit = any(s in obj.name for s in solo)
            obj.data.materials.clear()
            obj.data.materials.append(red if hit else dim)
    centre, radius = bounds_of(imported)

    scene = bpy.context.scene
    engine_ids = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in engine_ids else "BLENDER_EEVEE"
    scene.render.resolution_x = 960
    scene.render.resolution_y = 720
    scene.render.film_transparent = False
    scene.world = bpy.data.worlds.new("PreviewWorld")
    scene.world.use_nodes = True
    bg = scene.world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.62, 0.66, 0.70, 1)
        bg.inputs[1].default_value = 1.1

    sun = bpy.data.lights.new("sun", type="SUN")
    sun.energy = 3.2
    sun_obj = bpy.data.objects.new("sun", sun)
    scene.collection.objects.link(sun_obj)
    sun_obj.rotation_euler = (math.radians(55), 0, math.radians(35))

    cam_data = bpy.data.cameras.new("cam")
    cam_data.lens = 50
    cam_obj = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam_obj)
    scene.camera = cam_obj

    dist = radius * dist_scale
    for name in views:
        if name not in VIEWS:
            print(f"skip unknown view {name!r}", file=sys.stderr)
            continue
        yaw_deg, pitch_deg = VIEWS[name]
        yaw = math.radians(yaw_deg)
        pitch = math.radians(pitch_deg)
        x = centre[0] + dist * math.sin(yaw) * math.cos(pitch)
        y = centre[1] - dist * math.cos(yaw) * math.cos(pitch)
        z = centre[2] + dist * math.sin(pitch)
        cam_obj.location = (x, y, z)
        direction = Vector(centre) - cam_obj.location
        cam_obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = str(out_dir / f"{name}.png")
        bpy.ops.render.render(write_still=True)
        print(f"  {name}: {scene.render.filepath}")


main()
