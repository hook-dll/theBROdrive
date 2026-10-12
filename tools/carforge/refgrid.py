"""Normalise a reference car (glTF) to the carforge frame and measure it with rays (run inside Blender).

  blender --background --factory-startup --python tools/carforge/refgrid.py -- \
      --in build/vehicles/sa_oka/60-release/oka.glb --wheelbase 2180 \
      --fbx build/carforge/vaz1111/ref_norm.fbx --grid build/carforge/vaz1111/ref_grid.json

Normalise: the reference is scaled so the hubs of its `wheel_fl` and `wheel_rl` objects stand the
factory `--wheelbase` apart, the front hub moved to y = 0 and the tyres' bottom to z = 0 (spec
frame: +x left, nose to -y, mm). `hub_*`, `bulkhead` and `underbody` objects are dropped. `--fbx`
writes it the way carforge exports, for render.py and compare.py.

Grid (mm, spec frame), over the meshes whose names start with `--body` (default paint, trim,
glass) and separately the glass alone:
  hw[y][z], ghw[y][z]  half-width hit from +x at (y, z): plan.low/high, tumblehome, the side glass
  top[y][x], bot[y][x] z hit from above / below at (y, x): side.top on x = 0, sills, floor
  front[x][z], rear[x][z]  y hit from the nose / the tail at (x, z): the end faces
ys every 25 from -600 to 2700 + wheelbase - 2180, zs every 10 to 1420, xs every 20 to 720. A miss is null.
"""

import argparse
import json
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree


def parse():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--wheelbase", type=float, required=True, help="factory wheelbase, mm")
    ap.add_argument("--fbx")
    ap.add_argument("--grid")
    ap.add_argument("--body", default="paint,trim,glass")
    return ap.parse_args(argv)


def box(name):
    o = bpy.data.objects[name]
    p = [o.matrix_world @ Vector(c) for c in o.bound_box]
    return Vector([min(q[i] for q in p) for i in range(3)]), Vector([max(q[i] for q in p) for i in range(3)])


def normalise(wheelbase_mm):
    f0, f1 = box("wheel_fl")
    r0, r1 = box("wheel_rl")
    fy, ry = (f0.y + f1.y) / 2, (r0.y + r1.y) / 2
    ground = min(f0.z, r0.z)
    s = wheelbase_mm / 1000.0 / (ry - fy)
    m = Matrix.Scale(s, 4) @ Matrix.Translation(Vector((0, -fy, -ground)))
    for o in list(bpy.data.objects):
        if o.type != "MESH":
            continue
        if o.name.startswith("hub_") or o.name in ("bulkhead", "underbody"):
            bpy.data.objects.remove(o)
            continue
        o.data.transform(m @ o.matrix_world)
        o.matrix_world = Matrix.Identity(4)
    print(f"REFGRID scale {s:.5f}, tyre radius {(f1.z - f0.z) / 2 * s * 1000:.0f} mm")


def tree(prefixes):
    bm = bmesh.new()
    for o in bpy.context.scene.objects:
        if o.type == "MESH" and any(o.name.startswith(p) for p in prefixes):
            m = o.data.copy()
            m.transform(o.matrix_world)
            bm.from_mesh(m)
    return BVHTree.FromBMesh(bm)


def hit(t, origin, direction, axis):
    loc = t.ray_cast(Vector(origin), Vector(direction), 6.0)[0]
    return None if loc is None else round(loc[axis] * 1000, 1)


def grid(prefixes, wheelbase_mm):
    body, glass = tree(prefixes), tree(["glass"])
    ys = list(range(-600, int(2701 + wheelbase_mm - 2180), 25))
    zs = list(range(0, 1421, 10))
    xs = list(range(0, 721, 20))
    mm = 0.001
    return {
        "ys": ys, "zs": zs, "xs": xs,
        "hw": [[hit(body, (1.5, y * mm, z * mm), (-1, 0, 0), 0) for z in zs] for y in ys],
        "ghw": [[hit(glass, (1.5, y * mm, z * mm), (-1, 0, 0), 0) for z in zs] for y in ys],
        "top": [[hit(body, (x * mm, y * mm, 2.0), (0, 0, -1), 2) for x in xs] for y in ys],
        "bot": [[hit(body, (x * mm, y * mm, -0.1), (0, 0, 1), 2) for x in xs] for y in ys],
        "front": [[hit(body, (x * mm, -1.5, z * mm), (0, 1, 0), 1) for z in zs] for x in xs],
        "rear": [[hit(body, (x * mm, 4.0 + wheelbase_mm * mm, z * mm), (0, -1, 0), 1) for z in zs] for x in xs],
    }


def main():
    a = parse()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=a.src)
    normalise(a.wheelbase)
    if a.fbx:
        bpy.ops.export_scene.fbx(filepath=a.fbx, global_scale=1.0, apply_unit_scale=True,
                                 apply_scale_options="FBX_SCALE_NONE", axis_forward="-Z", axis_up="Y",
                                 bake_space_transform=True, object_types={"MESH"})
        print(f"WROTE {a.fbx}")
    if a.grid:
        with open(a.grid, "w") as fh:
            json.dump(grid(a.body.split(","), a.wheelbase), fh)
        print(f"WROTE {a.grid}")


if __name__ == "__main__":
    main()
