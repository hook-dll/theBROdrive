"""Author semantic lamps and repair roof shading for the late IZH-2715 GLB.

Run inside Blender. The model axes are +X left, +Y rear and +Z up in world
space. Lamp meshes already contain factory seams as loose components; this
script classifies them without moving their source geometry. The roof repair
changes only exported vertex normals, never body positions or topology.
"""

import bpy
from pathlib import Path

OUTPUT = str(Path(__file__).resolve().parents[1] / "public/models/saas/izh2715.glb")

if bpy.data.objects.get("paint") is None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=OUTPUT)


def material(name: str, rgba: tuple[float, float, float, float]):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.diffuse_color = rgba
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf is not None:
        bsdf.inputs["Base Color"].default_value = rgba
        bsdf.inputs["Roughness"].default_value = 0.32
    return mat


HEADLIGHT = material("Headlights", (0.82, 0.82, 0.76, 1.0))
INDICATOR = material("IndicatorLights", (0.887923, 0.135633, 0.008023, 1.0))
TAIL = material("TailLights", (0.42, 0.006, 0.004, 1.0))
REVERSE = material("ReverseLights", (0.72, 0.76, 0.78, 1.0))


def assign(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    for poly in obj.data.polygons:
        poly.material_index = 0


def separate_loose(name: str):
    obj = bpy.data.objects.get(name)
    if obj is None:
        return
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.separate(type="LOOSE")
    bpy.ops.object.mode_set(mode="OBJECT")


def bounds(obj):
    points = [v.co for v in obj.data.vertices]
    return (
        min(p.x for p in points), max(p.x for p in points),
        min(p.z for p in points), max(p.z for p in points),
        sum(p.x for p in points) / len(points),
        sum(p.z for p in points) / len(points),
    )


def rename_group(objects, role, mat):
    by_side = {"left": [], "right": []}
    for obj in objects:
        side = "left" if bounds(obj)[4] > 0 else "right"
        by_side[side].append(obj)
    for side, group in by_side.items():
        group.sort(key=lambda obj: (bounds(obj)[5], bounds(obj)[4], obj.name))
        # Blender suffixes a rename when another member still owns the target.
        # Vacate the semantic namespace first so repeated runs stay deterministic.
        for obj in group:
            obj.name = f"__izh_lamp_tmp_{role}_{id(obj)}"
        for index, obj in enumerate(group):
            obj.name = f"{role}_{side}_{index}"
            assign(obj, mat)


# Front PF10: upper amber section is the indicator; lower clear section is the
# five-watt position lamp. Round inboard islands are the FG122 headlamps.
separate_loose("headlights")
front = [
    obj for obj in bpy.data.objects
    if obj.type == "MESH" and (
        obj.name.startswith("headlights")
        or obj.name.startswith("front_blinker")
        or obj.name.startswith("front_position")
    )
]
headlamps, positions, indicators = [], [], []
for obj in front:
    _, _, _, _, cx, cz = bounds(obj)
    if abs(cx) < 0.88:
        headlamps.append(obj)
    elif cz < 0:
        positions.append(obj)
    else:
        indicators.append(obj)
rename_group(headlamps, "headlights", HEADLIGHT)
rename_group(positions, "front_position", HEADLIGHT)
rename_group(indicators, "front_blinker", INDICATOR)

# Rear: the triangular UP112 units are separate amber indicators. The low red
# FP112 blocks combine running and stop functions. The reference car's clear
# reversing lenses occupy the inboard end of those rectangles.
for obj in list(bpy.data.objects):
    if obj.get("izh_reverse_panel") or obj.get("izh_tail_panel"):
        bpy.data.objects.remove(obj, do_unlink=True)

separate_loose("taillights")
rear = [
    obj for obj in bpy.data.objects
    if obj.type == "MESH" and (
        obj.name.startswith("taillights")
        or obj.name.startswith("rear_blinker")
        or obj.name.startswith("reverse_lights")
    )
]
tails, rear_indicators = [], []
for obj in rear:
    _, _, _, _, cx, cz = bounds(obj)
    if abs(cx) > 0.87 and cz > 0:
        rear_indicators.append(obj)
    else:
        tails.append(obj)
rename_group(tails, "taillights", TAIL)
rename_group(rear_indicators, "rear_blinker", INDICATOR)

def lens_panel(name: str, x0: float, x1: float, y: float, z0: float, z1: float, mat, marker: str):
    mesh = bpy.data.meshes.new(f"{name}_mesh")
    mesh.from_pydata(
        [(x0, y, z0), (x0, y, z1), (x1, y, z1), (x1, y, z0)],
        [],
        [(0, 1, 2), (0, 2, 3)],
    )
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    obj[marker] = True
    bpy.context.scene.collection.objects.link(obj)


# The source's small grey decorative squares are not present on the reference car.
# A flush red lens face restores the continuous rectangular FP112 appearance.
lens_panel("taillights_left_6", 0.307, 0.698, 2.091, -0.617, -0.517, TAIL, "izh_tail_panel")
lens_panel("taillights_right_6", -0.698, -0.307, 2.091, -0.617, -0.517, TAIL, "izh_tail_panel")


def reverse_panel(side: str, x0: float, x1: float):
    # Offset the panel slightly rearward from the existing lens to avoid z-fighting
    # while keeping it visually embedded in the same rectangular housing.
    # The red lens fronts lie at Y=2.089 and span Z=-0.612..-0.523 in the
    # normalized GLB. Put the clear section 2 mm rearward, flush to the lens,
    # covering roughly the inboard quarter seen in the reference photograph.
    lens_panel(
        f"reverse_lights_{side}_0",
        x0,
        x1,
        2.093,
        -0.612,
        -0.523,
        REVERSE,
        "izh_reverse_panel",
    )


# +X is vehicle left. On both lamps the clear section faces the vehicle centre.
reverse_panel("left", 0.315, 0.430)
reverse_panel("right", -0.430, -0.315)

def repair_roof_normals():
    """Remove the false broad dent caused by smoothed triangulation."""
    obj = bpy.data.objects.get("paint")
    if obj is None:
        return
    group_name = "IZH_RoofNormals"
    old_group = obj.vertex_groups.get(group_name)
    if old_group is not None:
        obj.vertex_groups.remove(old_group)
    group = obj.vertex_groups.new(name=group_name)
    roof_vertices = []
    for vertex in obj.data.vertices:
        point = obj.matrix_world @ vertex.co
        if point.z > 0.88 and point.y > 0.12:
            roof_vertices.append(vertex.index)
    group.add(roof_vertices, 1.0, "REPLACE")
    modifier = obj.modifiers.new("IZH_RoofWeightedNormals", "WEIGHTED_NORMAL")
    modifier.keep_sharp = True
    modifier.weight = 50
    modifier.thresh = 0.01
    modifier.vertex_group = group.name
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=modifier.name)


repair_roof_normals()

# Diagnostic cameras/lights are never production model nodes.
for helper_name in ("AuditCamera", "AuditKey", "RoofAuditCamera"):
    helper = bpy.data.objects.get(helper_name)
    if helper is not None:
        bpy.data.objects.remove(helper, do_unlink=True)

bpy.ops.export_scene.gltf(
    filepath=OUTPUT,
    export_format="GLB",
    use_selection=False,
    export_apply=True,
)
print("IZH-2715 lamp authoring complete")
