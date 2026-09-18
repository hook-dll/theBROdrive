#!/usr/bin/env python3
"""
tools/decimate-glb.py -- per-node decimation for tools/vehicle-pipeline.md
stage D, for the rare node that is genuinely oversized for what it shows.

Usage:
    blender --background --factory-startup --python tools/decimate-glb.py -- \
        <in.glb> <out.glb> --target car_paint=9000 --target car_trim=9000 \
        [--weld 0.0008]

`--target <node>=<tris>` caps that node's triangle count (skipped if already
under budget: this never subdivides). A node with no `--target` is left
completely alone -- no Weld, no Decimate.

There used to be an Edge Split step here (hardening normals wherever adjacent
faces exceeded ~32 degrees), meant to keep panel creases sharp through
Decimate. It did the opposite: on these donor meshes it read as shattered
facets on curved glass and a crumpled look on painted panels under the game's
own specular/reflective shading, invisible on this tool's flat preview
material but very visible in actual play. Decimate Collapse alone, on a
source mesh that already carries smooth authored normals, preserves curvature
far better than a forced hard-edge pass does -- there is no reason to harden
anything here. This runtime has no LOD system and nothing here has an
interior to hide behind a window, so the right default is not to touch a
node at all; call this only for the rare role whose source density is
absurd for what it visibly is (this pack's recurring case is a lamp lens
authored at tens of thousands of triangles for a flat rectangle).
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
            "<in.glb> <out.glb> [--target node=tris ...] [--weld d]"
        )
    src, dst = Path(argv[0]).resolve(), Path(argv[1]).resolve()
    targets: dict[str, int] = {}
    weld = 0.0008
    i = 2
    while i < len(argv):
        if argv[i] == "--target":
            name, tris = argv[i + 1].split("=")
            targets[name] = int(tris)
            i += 2
        elif argv[i] == "--weld":
            weld = float(argv[i + 1])
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
            print(f"  {obj.name:22s} {before:6d} -> untouched (no --target)")
            continue

        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)

        weld_mod = obj.modifiers.new("weld", "WELD")
        weld_mod.merge_threshold = weld
        bpy.ops.object.modifier_apply(modifier=weld_mod.name)

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
