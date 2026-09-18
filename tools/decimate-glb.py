#!/usr/bin/env python3
"""
tools/decimate-glb.py -- per-node decimation for tools/vehicle-pipeline.md
stage D (`D1`: weld before decimate, hard-edge split so panel seams survive,
decimate each role separately so a small important part never loses to a
large smooth panel).

Usage:
    blender --background --factory-startup --python tools/decimate-glb.py -- \
        <in.glb> <out.glb> --target car_paint=9000 --target car_trim=9000 \
        [--weld 0.0008] [--angle 32]

`--target <node>=<tris>` caps that node's triangle count (skipped if already
under budget: this never subdivides). A node with no `--target` is left
completely alone -- no Weld, no Edge Split, no Decimate. Weld and Edge Split
used to run unconditionally on every node "for consistency"; Edge Split
hardens normals wherever adjacent faces exceed the split angle, which is
invisible on this tool's flat preview material but reads as shattered facets
on curved glass and paint under the game's own specular/reflective shading.
There is no exterior-visible reason to touch a node nobody asked to shrink:
call this only for the genuinely oversized roles (a lamp lens authored at
absurd density is the recurring case), and leave everything else at its
source triangle count.
"""
from __future__ import annotations

import sys
from pathlib import Path

import bpy


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for datablock in list(datablocks):
            if datablock.users == 0:
                datablocks.remove(datablock)


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1 :]
    if len(argv) < 2:
        raise SystemExit(
            "usage: blender --background --python tools/decimate-glb.py -- "
            "<in.glb> <out.glb> [--target node=tris ...] [--weld d] [--angle deg]"
        )
    src, dst = Path(argv[0]).resolve(), Path(argv[1]).resolve()
    targets: dict[str, int] = {}
    weld = 0.0008
    angle = 32.0
    i = 2
    while i < len(argv):
        if argv[i] == "--target":
            name, tris = argv[i + 1].split("=")
            targets[name] = int(tris)
            i += 2
        elif argv[i] == "--weld":
            weld = float(argv[i + 1])
            i += 2
        elif argv[i] == "--angle":
            angle = float(argv[i + 1])
            i += 2
        else:
            raise SystemExit(f"unknown argument {argv[i]!r}")

    clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(src))

    for obj in list(bpy.context.scene.objects):
        if obj.type != "MESH":
            continue
        target_tris = targets.get(obj.name)
        before = len(obj.data.polygons)
        if target_tris is None:
            # No explicit decision for this node: leave it completely alone.
            # Weld and Edge Split were previously applied unconditionally here,
            # which hardened normals (Edge Split at ~32 degrees) on every glass
            # pane and untouched panel in the file. A flat-lit preview render
            # never showed it, but the game's specular/reflective shading turned
            # every hardened edge on curved glass and paint into visible facets
            # -- "shattered glass" on rear windows, a crumpled look on fenders.
            print(f"  {obj.name:22s} {before:6d} -> untouched (no --target)")
            continue

        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)

        weld_mod = obj.modifiers.new("weld", "WELD")
        weld_mod.merge_threshold = weld
        split_mod = obj.modifiers.new("edge_split", "EDGE_SPLIT")
        split_mod.split_angle = __import__("math").radians(angle)
        split_mod.use_edge_angle = True
        split_mod.use_edge_sharp = False
        bpy.ops.object.modifier_apply(modifier=weld_mod.name)
        bpy.ops.object.modifier_apply(modifier=split_mod.name)

        welded = len(obj.data.polygons)
        ratio = min(1.0, target_tris / max(1, welded))
        if ratio < 0.999:
            dec = obj.modifiers.new("decimate", "DECIMATE")
            dec.decimate_type = "COLLAPSE"
            dec.ratio = ratio
            dec.use_collapse_triangulate = True
            bpy.ops.object.modifier_apply(modifier=dec.name)

        after = len(obj.data.polygons)
        print(f"  {obj.name:22s} {before:6d} -> {welded:6d} (welded) -> {after:6d} tris")
        obj.select_set(False)

    dst.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(dst),
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_materials="EXPORT",
        export_image_format="NONE",
        export_normals=True,
        export_tangents=False,
        export_skins=False,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
    )
    print(f"wrote {dst}")


main()
