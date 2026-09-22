"""Author the VAZ-1111 Oka runtime body from its pre-authoring export.

Run with Blender, not CPython:

  git show d8ada0e:public/models/saas/oka.glb > build/vehicles/sa_oka/00-intake/oka-source.glb
  blender --background --factory-startup --python tools/oka-author.py -- \
      build/vehicles/sa_oka/00-intake/oka-source.glb build/vehicles/sa_oka/50-assembled/oka.glb

then compress without touching topology:

  npx gltf-transform optimize build/vehicles/sa_oka/50-assembled/oka.glb public/models/saas/oka.glb \
      --compress meshopt --simplify false --palette false --join-named false --texture-compress false

The input is the DFF normalizer's export (its source DFF is no longer vendored), so
every threshold below is measured on that file. Blender's imported frame is +X the
car's left, +Y rearward, +Z up.

Reference: VAZ-1111 factory manual (1988-1996): 3200 x 1420 x 1400 mm, 544 mm front
overhang, 2180 mm wheelbase, 1214/1204 mm track, 135/80 R12 tyres, 150 mm clearance.
Lamps: FG-type headlamps with the position lamp inside; amber indicators in the
bumper and on each front wing; OSVAR 43.3716 rear lamps whose three lens blocks are
reversing (clear, top), indicator (amber) and combined running/stop (red, one
21/5 W bulb); a red fog lamp in the left of the rear bumper, which no game control
switches and is therefore passive.

What the script does, in order, all in the source frame:
  1. bakes node transforms into the meshes;
  2. cuts the lamp functions into semantic nodes and the driver's mirror into
     `mirrors`, which the runtime leaves out of the published-width shell;
  3. closes the engine bay from below with `underbody`, a plate that runs on the
     frame rails' bottoms from the front apron back to the floor pan;
  4. remaps the body so that, at the catalogue scale, it measures the factory
     length, width, height, overhang and wheelbase, and moves the wheel nodes onto
     the factory track, axle height, tyre radius and tyre width.
"""

from __future__ import annotations

import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

# Catalogue scale for sa_oka (src/vehicle/carmodels.ts): source unit -> metre.
SCALE = 0.97465
# VAZ-1111 factory geometry, metres.
LENGTH = 3.200
WIDTH = 1.420
HEIGHT = 1.400
CLEARANCE = 0.150
FRONT_OVERHANG = 0.544
WHEELBASE = 2.180
FRONT_TRACK = 1.214
REAR_TRACK = 1.204
WHEEL_RADIUS = 0.260
TYRE_WIDTH = 0.135
# The runtime measures the published width over the lower 55% of the body
# (render/carmodel.ts `buildTemplate`); the remap targets the same measurement.
SHELL_FRACTION = 0.55

# Lamp boundaries measured on the source lenses.
FRONT_INDICATOR_TOP_Z = -0.20      # bumper indicators lie wholly below it
REAR_REVERSE_Z = 0.020             # clear block above
REAR_INDICATOR_Z = -0.029          # amber block between; red block below
MIRROR_MIN_X = 0.73                # only the left (driver's) mirror is fitted
REPEATER_Y, REPEATER_Z = -0.775, -0.085
FOG_CENTRE = Vector((0.441, 1.646, -0.300))

# Engine-bay plate, source frame: the rail inner bottom edges, the apron it tucks
# under and the floor pan it meets. Rows are (y, z) on the rail bottoms until the
# straight line from the apron to the floor rises above them.
PLATE_X = (-0.4295, 0.3205)
PLATE_LIFT = 0.001

MATERIALS = {
    "Headlights": ((0.82, 0.82, 0.76, 1.0), 0.18),
    # sRGB #f26716 from the VAZ-2104 atlas, as glTF linear RGB.
    "IndicatorLights": ((0.887923, 0.135633, 0.008023, 1.0), 0.20),
    "TailLights": ((0.42, 0.006, 0.004, 1.0), 0.28),
    "ReverseLights": ((0.78, 0.80, 0.76, 1.0), 0.20),
    "PassiveRearLights": ((0.20, 0.005, 0.003, 1.0), 0.32),
}
ROLE_MATERIALS = {
    "headlights": "Headlights",
    "front_blinker_left": "IndicatorLights",
    "front_blinker_right": "IndicatorLights",
    "taillights": "TailLights",
    "reverse_lights": "ReverseLights",
    "rear_blinker_left": "IndicatorLights",
    "rear_blinker_right": "IndicatorLights",
    "rear_passive": "PassiveRearLights",
}
WHEEL_KEYS = ("fl", "fr", "rl", "rr")


def lamp_material(name: str) -> bpy.types.Material:
    colour, roughness = MATERIALS[name]
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    material.diffuse_color = colour
    material.use_backface_culling = False
    material.use_nodes = True
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = colour
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = 0.0
    return material


def mesh_objects() -> dict[str, bpy.types.Object]:
    return {obj.name: obj for obj in bpy.context.scene.objects if obj.type == "MESH"}


def bake_transforms() -> None:
    """Moves every node transform into its vertices; the file has no hierarchy.

    The export instances one wheel mesh on both wheels of a side and one hub mesh on
    all four hubs. Each node gets its own copy first: baking a shared mesh once per
    user would stack every user's transform onto the same vertices.
    """
    for obj in mesh_objects().values():
        if obj.data.users > 1:
            obj.data = obj.data.copy()
            obj.data.name = obj.name
    for obj in mesh_objects().values():
        if obj.parent is not None:
            raise SystemExit(f"unexpected parented node {obj.name}")
        matrix = obj.matrix_world.copy()
        mesh = obj.data
        normals = corner_normals(mesh)
        mesh.transform(matrix)
        obj.matrix_world = Matrix.Identity(4)
        if normals is not None:
            linear = matrix.to_3x3().inverted().transposed()
            mesh.normals_split_custom_set([(linear @ n).normalized() for n in normals])


def corner_normals(mesh: bpy.types.Mesh) -> list[Vector] | None:
    if not mesh.has_custom_normals:
        return None
    return [Vector(normal.vector) for normal in mesh.corner_normals]


def islands(obj: bpy.types.Object) -> list[list[int]]:
    """Face groups joined through shared POSITIONS: the export split every sharp edge."""
    mesh = obj.data
    keys: dict[tuple[int, int, int], int] = {}
    vertex_key = [
        keys.setdefault(tuple(round(c * 20000) for c in vertex.co), len(keys))
        for vertex in mesh.vertices
    ]
    parent = list(range(len(keys)))

    def find(a: int) -> int:
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for polygon in mesh.polygons:
        roots = [find(vertex_key[index]) for index in polygon.vertices]
        for root in roots[1:]:
            if root != roots[0]:
                parent[root] = roots[0]
    groups: dict[int, list[int]] = {}
    for polygon in mesh.polygons:
        groups.setdefault(find(vertex_key[polygon.vertices[0]]), []).append(polygon.index)
    return list(groups.values())


def face_bounds(obj: bpy.types.Object, faces: list[int]) -> tuple[Vector, Vector]:
    mesh = obj.data
    points = [mesh.vertices[i].co for face in faces for i in mesh.polygons[face].vertices]
    low = Vector(tuple(min(p[axis] for p in points) for axis in range(3)))
    high = Vector(tuple(max(p[axis] for p in points) for axis in range(3)))
    return low, high


def keep_faces(obj: bpy.types.Object, faces: set[int], keep: bool) -> None:
    """Deletes the faces outside (keep) or inside (not keep) `faces`, with orphans."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    doomed = [f for f in bm.faces if (f.index in faces) != keep]
    bmesh.ops.delete(bm, geom=doomed, context="FACES")
    bm.to_mesh(obj.data)
    bm.free()


def extract(parts: list[tuple[bpy.types.Object, set[int]]], name: str) -> bpy.types.Object:
    """A new node holding the listed faces of each source. Sources are not touched:
    face indices stay valid for every later extraction, and the caller strips all
    claimed faces from each source once, at the end."""
    pieces = []
    for source, faces in parts:
        piece = source.copy()
        piece.data = source.data.copy()
        bpy.context.scene.collection.objects.link(piece)
        keep_faces(piece, faces, keep=True)
        pieces.append(piece)
    target = pieces[0]
    if len(pieces) > 1:
        with bpy.context.temp_override(
            active_object=target,
            selected_objects=pieces,
            selected_editable_objects=pieces,
        ):
            bpy.ops.object.join()
    target.name = name
    target.data.name = name
    return target


def assign(obj: bpy.types.Object, material: bpy.types.Material) -> None:
    obj.data.materials.clear()
    obj.data.materials.append(material)
    for polygon in obj.data.polygons:
        polygon.material_index = 0


def side(x: float, centre_x: float) -> str:
    return "left" if x > centre_x else "right"


def author_lamps(centre_x: float) -> dict[str, int]:
    objects = mesh_objects()
    head, tail, trim = objects["headlights"], objects["taillights"], objects["trim"]
    for obj in (head, tail):
        obj.name = f"__source_{obj.name}"

    roles: dict[str, list[tuple[bpy.types.Object, set[int]]]] = {}

    def claim(role: str, obj: bpy.types.Object, faces) -> None:
        faces = set(faces)
        if faces:
            roles.setdefault(role, []).append((obj, faces))

    # Front: the bumper indicators share the headlamp mesh; the position lamps sit
    # inside the headlamp and stay with it.
    for polygon in head.data.polygons:
        c = polygon.center
        if c.z < FRONT_INDICATOR_TOP_Z:
            claim(f"front_blinker_{side(c.x, centre_x)}", head, [polygon.index])
    claim("headlights", head, [
        p.index for p in head.data.polygons if p.center.z >= FRONT_INDICATOR_TOP_Z
    ])

    # Rear: three stacked lens blocks per lamp.
    for polygon in tail.data.polygons:
        c = polygon.center
        if c.z > REAR_REVERSE_Z:
            role = "reverse_lights"
        elif c.z > REAR_INDICATOR_Z:
            role = f"rear_blinker_{side(c.x, centre_x)}"
        else:
            role = "taillights"
        claim(role, tail, [polygon.index])

    # Trim islands: the wing repeaters' outward lens faces, the rear fog lamp's
    # rearward lens faces and the whole mirror.
    mirror_faces: set[int] = set()
    repeaters = fog = 0
    for group in islands(trim):
        low, high = face_bounds(trim, group)
        centre = (low + high) * 0.5
        if high.x > MIRROR_MIN_X:
            mirror_faces.update(group)
            continue
        if (
            abs(centre.y - REPEATER_Y) < 0.05
            and abs(centre.z - REPEATER_Z) < 0.03
            and abs(centre.x - centre_x) > 0.7
        ):
            outward = 1.0 if centre.x > centre_x else -1.0
            claim(
                f"front_blinker_{side(centre.x, centre_x)}",
                trim,
                [f for f in group if trim.data.polygons[f].normal.x * outward > 0.8],
            )
            repeaters += 1
        elif (centre - FOG_CENTRE).length < 0.03 and high.y - low.y < 0.03:
            claim("rear_passive", trim, [f for f in group if trim.data.polygons[f].normal.y > 0.8])
            fog += 1
    if repeaters != 2 or fog != 1 or not mirror_faces:
        raise SystemExit(f"trim lamps not found: repeaters={repeaters} fog={fog} mirror={len(mirror_faces)}")

    counts = {}
    claimed: dict[bpy.types.Object, set[int]] = {}
    for role, parts in roles.items():
        obj = extract(parts, role)
        assign(obj, lamp_material(ROLE_MATERIALS[role]))
        counts[role] = len(obj.data.polygons)
        for source, faces in parts:
            claimed.setdefault(source, set()).update(faces)
    mirrors = extract([(trim, mirror_faces)], "mirrors")
    counts["mirrors"] = len(mirrors.data.polygons)
    claimed.setdefault(trim, set()).update(mirror_faces)
    for source, faces in claimed.items():
        keep_faces(source, faces, keep=False)
    for obj in (head, tail):
        if len(obj.data.polygons):
            raise SystemExit(f"{obj.name} kept {len(obj.data.polygons)} unclassified faces")
        mesh = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.meshes.remove(mesh)
    missing = [role for role in ROLE_MATERIALS if counts.get(role, 0) == 0]
    if missing:
        raise SystemExit(f"empty lamp sections: {', '.join(missing)}")
    return counts


def rail_bottom(y: float) -> float:
    """The frame rails' bottom line, measured every 5 cm along the bay."""
    if y <= -1.20:
        return -0.439
    if y <= -0.95:
        return -0.439 - 0.068 * (y + 1.20)
    return -0.456 - 0.21 * (y + 0.95)


def floor_line(y: float) -> float:
    """Straight from the apron's rear lip (y -1.42, z -0.441) to the floor pan's front edge."""
    return -0.441 + (-0.466 + 0.441) * (y + 1.42) / (-0.80 + 1.42)


def add_underbody(material: bpy.types.Material) -> bpy.types.Object:
    """Close the bay between the rails; never below them, so no edge shows."""
    rows = [-1.42, -1.20, -0.95, -0.9267, -0.795]
    vertices = []
    for y in rows:
        z = max(rail_bottom(y), floor_line(y)) + PLATE_LIFT
        vertices += [(PLATE_X[0], y, z), (PLATE_X[1], y, z)]
    # Wound so the face normal points down (-Z): the side anyone sees.
    faces = [(2 * i, 2 * i + 2, 2 * i + 3, 2 * i + 1) for i in range(len(rows) - 1)]
    mesh = bpy.data.meshes.new("underbody")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(material)
    mesh.update()
    # The steepest span follows the rails' 0.21 rise, 12 degrees off level.
    for polygon in mesh.polygons:
        if polygon.normal.z > -0.97:
            raise SystemExit("underbody plate must face down")
    obj = bpy.data.objects.new("underbody", mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def piecewise(anchors: list[tuple[float, float]]):
    """Monotonic piecewise-linear map through (source, target) anchors; slope per span."""

    def span(value: float) -> int:
        for index in range(len(anchors) - 2):
            if value <= anchors[index + 1][0]:
                return index
        return len(anchors) - 2

    def slope(value: float) -> float:
        (s0, t0), (s1, t1) = anchors[span(value)], anchors[span(value) + 1]
        return (t1 - t0) / (s1 - s0)

    def apply(value: float) -> float:
        s0, t0 = anchors[span(value)]
        return t0 + (value - s0) * slope(value)

    return apply, slope


def remap_body(bodies: list[bpy.types.Object], wheel_centres: dict[str, Vector]) -> dict:
    points = [v.co for obj in bodies for v in obj.data.vertices]
    low_z = min(p.z for p in points)
    high_z = max(p.z for p in points)
    shell_top = low_z + (high_z - low_z) * SHELL_FRACTION
    # Same rule as the runtime shell: everything but the mirrors, below 55% height.
    shell = [
        v.co
        for obj in bodies
        if obj.name != "mirrors"
        for v in obj.data.vertices
        if v.co.z <= shell_top
    ]
    min_x, max_x = min(p.x for p in shell), max(p.x for p in shell)
    centre_x = (min_x + max_x) * 0.5
    scale_x = (WIDTH / SCALE) / (max_x - min_x)

    nose, tail = min(p.y for p in points), max(p.y for p in points)
    front_y = (wheel_centres["fl"].y + wheel_centres["fr"].y) * 0.5
    rear_y = (wheel_centres["rl"].y + wheel_centres["rr"].y) * 0.5
    target_nose = -LENGTH / SCALE / 2
    target_front = target_nose + FRONT_OVERHANG / SCALE
    target_rear = target_front + WHEELBASE / SCALE
    map_y, slope_y = piecewise([
        (nose, target_nose),
        (front_y, target_front),
        (rear_y, target_rear),
        (tail, LENGTH / SCALE / 2),
    ])

    # One axle anchor at the mean source axle height, as the DFF normalizer does:
    # the source sits its rear wheels 13 mm higher in their arches than its front
    # ones, and the runtime hangs both axles at the same height, so the arch error
    # is split evenly between them.
    axle_z = sum(centre.z for centre in wheel_centres.values()) / 4
    target_axle_z = low_z + (WHEEL_RADIUS - CLEARANCE) / SCALE
    map_z, slope_z = piecewise([
        (low_z, low_z),
        (axle_z, target_axle_z),
        (high_z, low_z + (HEIGHT - CLEARANCE) / SCALE),
    ])

    for obj in bodies:
        mesh = obj.data
        normals = corner_normals(mesh)
        source = [v.co.copy() for v in mesh.vertices]
        for vertex, p in zip(mesh.vertices, source):
            vertex.co = Vector(((p.x - centre_x) * scale_x, map_y(p.y), map_z(p.z)))
        if normals is not None:
            # Normals transform by the inverse transpose of the map's local Jacobian.
            remapped = []
            for loop, normal in zip(mesh.loops, normals):
                p = source[loop.vertex_index]
                remapped.append(Vector((
                    normal.x / scale_x,
                    normal.y / slope_y(p.y),
                    normal.z / slope_z(p.z),
                )).normalized())
            mesh.normals_split_custom_set(remapped)
        mesh.update()

    return {
        "centre_x": centre_x,
        "scale_x": scale_x,
        "front_axle_y": target_front,
        "rear_axle_y": target_rear,
        "axle_z": target_axle_z,
        "source": (nose, front_y, rear_y, tail, low_z, axle_z, high_z),
    }


def place_wheels(wheels: dict[str, list[bpy.types.Object]], layout: dict) -> None:
    """Wheel and hub move together onto the factory centre; the wheel takes factory size."""
    for key, (wheel, hub) in wheels.items():
        front = key[0] == "f"
        track = FRONT_TRACK if front else REAR_TRACK
        target = Vector((
            (track / 2 / SCALE) * (1 if key[1] == "l" else -1),
            layout["front_axle_y"] if front else layout["rear_axle_y"],
            layout["axle_z"],
        ))
        low, high = face_bounds(wheel, [p.index for p in wheel.data.polygons])
        centre = (low + high) * 0.5
        size = high - low
        radius = max(size.y, size.z) * 0.5
        resize = Matrix.Diagonal((
            (TYRE_WIDTH / SCALE) / size.x,
            (WHEEL_RADIUS / SCALE) / radius,
            (WHEEL_RADIUS / SCALE) / radius,
            1.0,
        ))
        wheel_matrix = Matrix.Translation(target) @ resize @ Matrix.Translation(-centre)
        for obj, matrix in ((wheel, wheel_matrix), (hub, Matrix.Translation(target - centre))):
            normals = corner_normals(obj.data)
            obj.data.transform(matrix)
            if normals is not None:
                linear = matrix.to_3x3().inverted().transposed()
                obj.data.normals_split_custom_set([(linear @ n).normalized() for n in normals])
            obj.data.update()


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(argv) != 2:
        raise SystemExit("usage: blender --background --python tools/oka-author.py -- input.glb output.glb")
    input_path, output_path = (Path(value).resolve() for value in argv)

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(input_path))
    bake_transforms()

    objects = mesh_objects()
    if "underbody" in objects or "mirrors" in objects:
        raise SystemExit(f"{input_path} is already authored")
    wheels = {key: (objects[f"wheel_{key}"], objects[f"hub_{key}"]) for key in WHEEL_KEYS}
    wheel_centres = {}
    for key, (wheel, _hub) in wheels.items():
        low, high = face_bounds(wheel, [p.index for p in wheel.data.polygons])
        wheel_centres[key] = (low + high) * 0.5
    paint = objects["paint"]
    paint_x = [v.co.x for v in paint.data.vertices]
    source_centre_x = (min(paint_x) + max(paint_x)) * 0.5

    counts = author_lamps(source_centre_x)
    add_underbody(bpy.data.materials["car_trim"])

    wheel_nodes = {obj for pair in wheels.values() for obj in pair}
    bodies = [obj for obj in mesh_objects().values() if obj not in wheel_nodes]
    layout = remap_body(bodies, wheel_centres)
    place_wheels(wheels, layout)

    # The combined source lens material has no node left to carry it.
    for name in ("BrakeLights",):
        material = bpy.data.materials.get(name)
        if material is not None and material.users == 0:
            bpy.data.materials.remove(material)

    # glTF mesh names follow the node names; two passes so no rename collides, and
    # the meshes that joins and copies left behind go first.
    for mesh in list(bpy.data.meshes):
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)
    for obj in mesh_objects().values():
        obj.data.name = f"__mesh_{obj.name}"
    for obj in mesh_objects().values():
        obj.data.name = obj.name

    output_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(output_path), export_format="GLB", export_apply=True)
    print(f"{output_path}: " + ", ".join(f"{role}={count}" for role, count in sorted(counts.items())))
    print(
        "layout: centre_x={centre_x:.4f} scale_x={scale_x:.4f} front_axle_y={front_axle_y:.4f} "
        "rear_axle_y={rear_axle_y:.4f} axle_z={axle_z:.4f}".format(**layout)
    )
    print("source anchors (nose, front, rear, tail, low_z, axle_z, high_z): "
          + ", ".join(f"{value:.4f}" for value in layout["source"]))


if __name__ == "__main__":
    main()
