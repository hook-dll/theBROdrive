"""Workbench renders of a car FBX with the Soviet albedo atlas (run inside Blender).

  blender --background --factory-startup --python tools/carforge/render.py -- \
      --fbx car.fbx --albedo public/models/soviet/albedo.png --prefix build/carforge/renders/name

Writes <prefix>_side.png (from +X, left side), <prefix>_front.png (from -Y), <prefix>_q.png (front-left
3/4, perspective), <prefix>_qrear.png (rear-left 3/4), <prefix>_wire.png (wireframe over shaded body),
and <prefix>_side.json (the side view's mm per pixel and centre, for compare.py).
Textures use the same atlas the game ships; no lights are needed for Workbench studio shading.
"""

import argparse
import json
import math
import os
import sys

import bpy
from mathutils import Vector


def parse():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--fbx", required=True)
    ap.add_argument("--albedo", default="public/models/soviet/albedo.png")
    ap.add_argument("--prefix", required=True)
    ap.add_argument("--size", type=int, nargs=2, default=[1100, 640])
    return ap.parse_args(argv)


def textured_material(image):
    mat = bpy.data.materials.new("atlas")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = image
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    nt.nodes.active = tex
    return mat


def bbox_centre_and_size(objs):
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return (lo + hi) / 2, hi - lo


def place_camera(name, direction, centre, size, ortho_extent, aspect):
    cam_data = bpy.data.cameras.new(name)
    cam = bpy.data.objects.new(name, cam_data)
    bpy.context.scene.collection.objects.link(cam)
    d = direction.normalized()
    radius = max(size) * 3.0
    cam.location = centre + d * radius
    cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
    if ortho_extent is not None:
        cam_data.type = "ORTHO"
        hx, hz = ortho_extent
        cam_data.ortho_scale = max(hx, hz * aspect) * 1.12
    else:
        cam_data.lens = 50
    cam_data.clip_start = 0.01
    cam_data.clip_end = radius * 4
    bpy.context.scene.camera = cam
    return cam


def render_to(path, size):
    scene = bpy.context.scene
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.filepath = path
    scene.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(write_still=True)


def main():
    a = parse()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=os.path.abspath(a.fbx))
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    image = bpy.data.images.load(os.path.abspath(a.albedo))
    mat = textured_material(image)
    for o in meshes:
        o.data.materials.clear()
        o.data.materials.append(mat)
    centre, size = bbox_centre_and_size(meshes)

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    shading = scene.display.shading
    shading.light = "STUDIO"
    shading.color_type = "TEXTURE"
    shading.background_type = "WORLD"
    scene.world = bpy.data.worlds.new("bg")
    scene.world.color = (0.55, 0.57, 0.6)
    scene.render.film_transparent = False

    print("EXTENT " + " ".join(f"{v:.4f}" for v in size) + f" centre={tuple(round(c, 4) for c in centre)}")
    os.makedirs(os.path.dirname(os.path.abspath(a.prefix)), exist_ok=True)
    aspect = a.size[0] / a.size[1]
    views = [
        ("side", Vector((1, 0, 0.0)), (size.y, size.z), False),
        ("front", Vector((0, -1, 0.0)), (size.x, size.z), False),
        ("q", Vector((0.85, -0.85, 0.42)), None, False),
        ("qrear", Vector((-0.85, 0.85, 0.42)), None, False),
        ("wire", Vector((0.85, -0.85, 0.42)), None, True),
    ]
    for label, d, extent, wire in views:
        cam = place_camera("cam_" + label, d, centre, size, extent, aspect)
        for o in meshes:
            o.show_wire = wire
            o.display_type = "WIRE" if wire else "TEXTURED"
        render_to(f"{a.prefix}_{label}.png", a.size)
        print("RENDER " + f"{a.prefix}_{label}.png")
        if label == "side":  # image right = +Y (rearward), up = +Z; centre pixel = world (y, z) below
            with open(f"{a.prefix}_side.json", "w") as fh:
                json.dump({"mm_per_px": cam.data.ortho_scale * 1000 / a.size[0],
                           "centre_mm": [centre.y * 1000, centre.z * 1000], "size": a.size}, fh)


if __name__ == "__main__":
    main()
