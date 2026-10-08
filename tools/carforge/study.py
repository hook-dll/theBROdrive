"""Construction study of the Soviet car pack (run inside Blender, background).

  nice -n 15 /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
      --python tools/carforge/study.py -- --cars vz01,vz08 [--no-render]

Per car: imports the FBX, extracts world-space arrays, runs study_analysis.analyse (pure
Python), writes build/carforge/study/<car>.json, and renders:
  <car>_{side,front,rear,top,bottom,q_front,q_rear}.png   Workbench, atlas texture, wire overlay
  <car>_regions_{side,q,bottom}.png                       region false colour, wire overlay
Pure geometry lives in study_analysis.py. This file only touches Blender.
"""

import argparse
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import study_analysis as SA  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
SOVIET = os.path.join(REPO, "public", "models", "soviet")
OUT = os.path.join(REPO, "build", "carforge", "study")
RES = (1600, 1000)
WIRE_MM = 3.5  # wire overlay thickness, world mm

PALETTE = {
    "roof": (0.90, 0.15, 0.15),
    "bonnet": (1.00, 0.85, 0.10),
    "boot_lid": (0.55, 0.90, 0.20),
    "front_face": (1.00, 0.45, 0.75),
    "rear_face": (0.60, 0.40, 0.20),
    "underbody": (0.20, 0.25, 0.60),
    "bumper_front": (0.05, 0.05, 0.05),
    "bumper_rear": (0.30, 0.30, 0.30),
    "side_upper": (0.20, 0.85, 0.40),
    "side_lower": (0.05, 0.55, 0.20),
    "sill": (0.55, 0.45, 0.30),
    "greenhouse": (0.95, 0.55, 0.10),
    "wheel_arch": (0.00, 0.90, 0.90),
    "glass_windscreen": (0.45, 0.85, 1.00),
    "glass_side": (0.15, 0.45, 1.00),
    "glass_rear": (0.00, 0.20, 0.60),
    "glass_roof": (0.75, 0.92, 1.00),
    "glass_other": (0.50, 0.50, 0.50),
    "chamfer_bonnet_front": (0.95, 0.95, 0.60),
    "chamfer_rear_top": (0.80, 0.60, 1.00),
    "chamfer_roof_side": (0.90, 0.40, 0.60),
    "chamfer_sill_underbody": (0.45, 0.35, 0.85),
    "other": (1.00, 0.00, 1.00),
}
VIEWS = {
    "side": (Vector((1, 0, 0)), False),
    "front": (Vector((0, -1, 0)), False),
    "rear": (Vector((0, 1, 0)), False),
    "top": (Vector((0, 0, 1)), True),
    "bottom": (Vector((0, 0, -1)), True),
    "q_front": (Vector((0.7, -0.7, 0.4)), None),
    "q_rear": (Vector((0.7, 0.7, 0.4)), None),
}


def parse():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--cars", required=True)
    ap.add_argument("--no-render", action="store_true")
    return ap.parse_args(argv)


def extract(obj):
    """World-space arrays for one mesh object. Areas scale with the object's uniform scale."""
    me = obj.data
    mw = obj.matrix_world
    mw3 = mw.to_3x3()
    s = abs(mw3.determinant()) ** (1.0 / 3.0)
    V = [tuple(mw @ v.co) for v in me.vertices]
    F = [list(p.vertices) for p in me.polygons]
    N = [tuple((mw3 @ p.normal).normalized()) for p in me.polygons]
    A = [p.area * s * s for p in me.polygons]
    uvl = me.uv_layers.active.data if me.uv_layers.active else None
    C = []
    umin = vmin = 1e9
    umax = vmax = -1e9
    for p in me.polygons:
        if uvl is None:
            C.append((0, 0))
            continue
        idx = range(p.loop_start, p.loop_start + p.loop_total)
        u = sum(uvl[i].uv[0] for i in idx) / p.loop_total
        v = sum(uvl[i].uv[1] for i in idx) / p.loop_total
        for i in idx:
            uu, vv = uvl[i].uv[0], uvl[i].uv[1]
            umin, umax = min(umin, uu), max(umax, uu)
            vmin, vmax = min(vmin, vv), max(vmax, vv)
        C.append((min(8, max(0, int(math.floor(u * 9)))), min(1, max(0, int(math.floor(v * 2))))))
    return {"V": V, "F": F, "N": N, "A": A, "C": C, "scale": s,
            "uv": [umin, umax, vmin, vmax] if uvl is not None else None}


def load_car(car):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=os.path.join(SOVIET, f"{car}.fbx"))
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    body = [o for o in meshes if o.name.endswith(".body")]
    if len(body) != 1:
        raise SystemExit(f"{car}: expected one .body object, got {[o.name for o in meshes]}")
    wheels = sorted([o for o in meshes if ".wheel_" in o.name], key=lambda o: o.name)
    lamps = sorted([o for o in meshes if o not in body and o not in wheels], key=lambda o: o.name)
    return body[0], wheels, lamps


def textured_material(image):
    mat = bpy.data.materials.new("atlas")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = image
    tex.interpolation = "Closest"
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    nt.nodes.active = tex
    return mat


def flat_material(name, rgb):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (rgb[0], rgb[1], rgb[2], 1.0)
    return mat


def add_wire_overlay(obj):
    """Wire-only copy: Wireframe modifier with replace, one black material."""
    s = abs(obj.matrix_world.to_3x3().determinant()) ** (1.0 / 3.0)
    ow = obj.copy()
    ow.data = obj.data.copy()
    ow.name = obj.name + "_wire"
    ow.data.materials.clear()
    ow.data.materials.append(flat_material("wire", (0.02, 0.02, 0.02)))
    for p in ow.data.polygons:
        p.material_index = 0
    mod = ow.modifiers.new("wire", "WIREFRAME")
    mod.use_replace = True
    mod.thickness = (WIRE_MM / 1000.0) / s
    bpy.context.scene.collection.objects.link(ow)
    return ow


def world_points(objs):
    return [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]


def place_camera(name, view, centre, pts):
    d, is_vertical = VIEWS[view][0].normalized(), VIEWS[view][1]
    forward = -d
    up = Vector((0, 1, 0)) if is_vertical else Vector((0, 0, 1))
    right = forward.cross(up).normalized()
    cam_up = right.cross(forward).normalized()
    rot = Matrix((right, cam_up, -forward)).transposed().to_4x4()
    aspect = RES[0] / RES[1]
    diag = max(1e-6, max((p - centre).length for p in pts))
    cam_data = bpy.data.cameras.new(name)
    cam = bpy.data.objects.new(name, cam_data)
    bpy.context.scene.collection.objects.link(cam)
    cam.rotation_mode = "QUATERNION"
    cam.rotation_quaternion = rot.to_quaternion()
    hx = max(abs((p - centre).dot(right)) for p in pts)
    hu = max(abs((p - centre).dot(cam_up)) for p in pts)
    if is_vertical is None:
        cam_data.type = "PERSP"
        cam_data.lens = 50
        tan_h = 18.0 / 50.0
        tan_v = tan_h / aspect
        dist = max(hx / tan_h, hu / tan_v) * 1.15
        cam.location = centre - forward * dist
        cam_data.clip_end = dist * 6
    else:
        cam_data.type = "ORTHO"
        cam_data.ortho_scale = max(2 * hx, 2 * hu * aspect) * 1.08
        cam.location = centre - forward * diag * 3
        cam_data.clip_end = diag * 8
    cam_data.clip_start = 0.01
    bpy.context.scene.camera = cam
    return cam


def render_to(path):
    scene = bpy.context.scene
    scene.render.resolution_x, scene.render.resolution_y = RES
    scene.render.resolution_percentage = 100
    scene.render.filepath = path
    scene.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(write_still=True)


def setup_scene(color_type):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    shading = scene.display.shading
    shading.light = "STUDIO"
    shading.color_type = color_type
    shading.background_type = "WORLD"
    shading.show_cavity = False
    shading.show_object_outline = False
    scene.world = bpy.data.worlds.new("bg")
    scene.world.color = (0.80, 0.82, 0.85)
    scene.render.film_transparent = False


def save_palette():
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "palette.json"), "w") as f:
        json.dump({k: list(v) for k, v in PALETTE.items()}, f, indent=2)


def run_car(car, render):
    body, wheels, lamps = load_car(car)
    body_arr = extract(body)
    wheel_arrs = [(w.name, extract(w)) for w in wheels]
    lamp_arrs = [(l.name, extract(l)) for l in lamps]
    print(f"CAR {car}: body={body.name} wheels={[w.name for w in wheels]} lamps={[l.name for l in lamps]}")
    print(f"  scale={body_arr['scale']:.4f} uv={body_arr['uv']}")
    res = SA.analyse(body_arr, wheel_arrs, lamp_arrs)
    labels = res.pop("_labels")
    res.pop("_rid")
    res["file"] = f"{car}.fbx"
    res["body_object"] = body.name
    res["uv_range"] = body_arr["uv"]
    res["scale"] = body_arr["scale"]
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, f"{car}.json"), "w") as f:
        json.dump(res, f, indent=1, default=str)
    print(f"  faces={res['topology']['faces']} regions={len(res['regions'])} "
          f"windows={len(res['glass_windows'])} arches={len(res['arches'])}")
    if not render:
        return
    # wire overlays (one per mesh), created once per car
    overlays = [add_wire_overlay(body)]
    overlays += [add_wire_overlay(w) for w in wheels]
    overlays += [add_wire_overlay(l) for l in lamps]
    pts = world_points([body] + wheels + lamps)
    # textured wire renders
    atlas = bpy.data.images.load(os.path.join(SOVIET, "albedo.png"))
    mat = textured_material(atlas)
    body.data.materials.clear()
    body.data.materials.append(mat)
    for o in wheels + lamps:
        o.data.materials.clear()
        o.data.materials.append(mat)
    names = [(v, f"{car}_{v}.png") for v in VIEWS]
    for view, out_name in names:
        setup_scene("TEXTURE")
        cam = place_camera(f"cam_{view}", view, sum(pts, Vector()) / len(pts), pts)
        render_to(os.path.join(OUT, out_name))
        bpy.data.objects.remove(cam, do_unlink=True)
        print("RENDER", out_name)
    # region false colour
    present = sorted(set(labels))
    idx = {lab: i for i, lab in enumerate(present)}
    body.data.materials.clear()
    for lab in present:
        body.data.materials.append(flat_material(lab, PALETTE.get(lab, PALETTE["other"])))
    for p, lab in zip(body.data.polygons, labels):
        p.material_index = idx[lab]
    grey = flat_material("grey", (0.72, 0.72, 0.72))
    for o in wheels + lamps:
        o.data.materials.clear()
        o.data.materials.append(grey)
    for view, out_name in [("side", f"{car}_regions_side.png"), ("q_front", f"{car}_regions_q.png"),
                           ("bottom", f"{car}_regions_bottom.png")]:
        setup_scene("MATERIAL")
        cam = place_camera(f"cam_{view}", view, sum(pts, Vector()) / len(pts), pts)
        render_to(os.path.join(OUT, out_name))
        bpy.data.objects.remove(cam, do_unlink=True)
        print("RENDER", out_name)


def main():
    a = parse()
    os.makedirs(OUT, exist_ok=True)
    save_palette()
    for car in [c.strip() for c in a.cars.split(",") if c.strip()]:
        run_car(car, not a.no_render)


if __name__ == "__main__":
    main()
