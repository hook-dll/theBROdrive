"""Normalize the SARUS GTA SA vehicle pack for the runtime.

Run through Blender, not CPython:
  blender --background --factory-startup --python tools/import-dff-pack.py

The script deliberately ignores TXD files. It keeps the authored exterior and door
cards, removes cabin/engine/damage/collision geometry, creates explicit moving wheel
and hub nodes, and exports texture-free GLBs for glTF-Transform post-processing.
"""

from __future__ import annotations

import math
import re
import sys
from pathlib import Path

import bpy
import bmesh
from mathutils import Matrix, Vector


ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist" / "models" / "saas"

# id, source DFF, body face budget, whether the source is an open shell that needs
# a synthetic floor, and whether the car takes the Soviet pack's road wheel.
#
# Bodies whose own geometry already closes the underside get no floor plate: adding
# one there only buries a slab inside the authored floor. The Oka and the IZH run
# the Soviet 2109 wheel so the Lada-shaped half of the catalogue stands on one
# wheel; the UAZ keeps its own, because a light road wheel under a working 4x4
# reads as a mistake.
#
# The pack's other five bodies (both Samaras, the 2110, the Sobol and the UAZ-469)
# were cut from the catalogue: better source models are wanted for those cars.
MODELS = (
    ("oka", ROOT / "SARUS" / "ОКА" / "manana.dff", 30_000, False, True),
    ("uaz330364", ROOT / "SARUS" / "УАЗ 330364" / "yankee.dff", 30_000, False, False),
    ("izh2715", ROOT / "SARUS" / "ИЖ 2715" / "bobcat.dff", 30_000, False, True),
)

# The Soviet pack's own road wheel, reused rather than re-modelled. `09.wheel_fr`
# sits on the FBX's -X side, which is the side a DFF calls left, so it is the copy
# that needs no turning here.
SOVIET_WHEEL_FBX = ROOT / "public" / "models" / "soviet" / "vz09.fbx"
SOVIET_WHEEL_OBJECT = "09.wheel_fr"

ROLES = ("car_paint", "car_trim", "car_glass", "Headlights", "BrakeLights")
WHEEL_KEYS = ("wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr")

DAMAGE_RE = re.compile(r"(^|[_ .])(dam|damage|vlo|lod)([_ .]|$)", re.I)
COLLISION_RE = re.compile(r"colmesh|colsphere|shadowmesh|collision|sentinel_col|_col\b", re.I)
INTERIOR_RE = re.compile(
    r"salon|interior|interier|v salone|dash|torpedo|pribork|rul|steer|seat|sid$|speed|mafon|"
    r"dvig|motor|engine|exhaust|glush|stinger|podkapot|podves|dno|dnishe|"
    r"kovrik|pedal|pion|navigator|registrator|cellphone|stetsom|advan|roadstar|"
    r"pointer|tahook|shleif|tube|plafon|rama",
    re.I,
)
EXTRA_RE = re.compile(r"^extra\d*$", re.I)
WHEEL_NAME_RE = re.compile(r"wheel|koles|колес|shina|rezina|protekt", re.I)
# Lamp LENSES, by the texture the source names them after. Deliberately material
# names only: `fars_front` is the whole lamp HOUSING, and matching the object name
# made the front end of a car twenty thousand triangles of glowing lens.
LAMP_RE = re.compile(r"vehiclelight|light|^fara|fonar|optik|povorot|turn|diod|stop", re.I)
GLASS_RE = re.compile(r"glass|stekl|okno|windscreen|windshield", re.I)
PAINT_RE = re.compile(r"primary|body(?:reflection)?|reflection|color_|^white(?:\.|$)|^chassis(?:\.0+)?$", re.I)
TRIM_RE = re.compile(
    r"chrom|black|rust|metall|dirt|scratch|carp|torped|salon|seat|dash|rul|"
    r"wheel|shina|rezina|protekt|disc|disk|molding|nomer|ramki|under|briz|podkril",
    re.I,
)
PANEL_RE = re.compile(r"chassis|bonnet|boot|door|dool|bump|bamp|wing|kuzov|cha$|chas$|bp_lf|1202", re.I)



def plain_name(name: str) -> str:
    return re.sub(r"\.\d{3}$", "", name).strip().lower()


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in list(bpy.data.collections):
        bpy.data.collections.remove(collection)
    for datablocks in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.cameras, bpy.data.lights):
        for datablock in list(datablocks):
            datablocks.remove(datablock)


def install_safe_dragonff_loader() -> None:
    """Ignore malformed 0xffff separator triangles instead of aborting the clump."""
    bpy.ops.preferences.addon_enable(module="DragonFF")
    from DragonFF.gtaLib import dff as dff_lib

    original = dff_lib.dff.load_file
    if getattr(original, "_bro_safe", False):
        return

    def safe_load(instance, file_name):
        result = original(instance, file_name)
        skipped = 0
        for clump in instance.clumps:
            for geometry in clump.geometry_list:
                count = len(geometry.vertices)
                if not count:
                    continue

                def valid(face):
                    return 0 <= face.a < count and 0 <= face.b < count and 0 <= face.c < count

                before = len(geometry.triangles)
                geometry.triangles = [face for face in geometry.triangles if valid(face)]
                skipped += before - len(geometry.triangles)
                split = geometry.extensions.get("mat_split")
                if split is not None:
                    before = len(split)
                    geometry.extensions["mat_split"] = [face for face in split if valid(face)]
                    skipped += before - len(geometry.extensions["mat_split"])
        if skipped:
            print(f"DragonFF: skipped {skipped} malformed triangle records in {file_name}")
        return result

    safe_load._bro_safe = True
    dff_lib.dff.load_file = safe_load


def import_dff(path: Path) -> None:
    result = bpy.ops.import_scene.dff(
        filepath=str(path),
        load_images=False,
        read_mat_split=True,
        remove_doubles=True,
        create_backfaces=False,
        import_normals=True,
        hide_damage_parts=False,
        group_materials=False,
        materials_naming="TEX",
    )
    if "FINISHED" not in result:
        raise RuntimeError(f"DragonFF did not finish importing {path}: {result}")
    bpy.context.view_layer.update()


def wheel_key(name: str) -> str | None:
    value = plain_name(name)
    for source, target in (
        ("wheel_lf_dummy", "wheel_fl"),
        ("wheel_rf_dummy", "wheel_fr"),
        ("wheel_lb_dummy", "wheel_rl"),
        ("wheel_rb_dummy", "wheel_rr"),
    ):
        if source in value:
            return target
    return None


def wheel_ancestor(obj: bpy.types.Object) -> tuple[str, bpy.types.Object] | None:
    current = obj
    while current is not None:
        key = wheel_key(current.name)
        if key is not None:
            return key, current
        current = current.parent
    return None


def excluded(obj: bpy.types.Object) -> bool:
    current = obj
    while current is not None:
        name = plain_name(current.name)
        if DAMAGE_RE.search(name) or COLLISION_RE.search(name) or INTERIOR_RE.search(name) or EXTRA_RE.fullmatch(name):
            return True
        current = current.parent
    return False


def material_alpha(material: bpy.types.Material | None) -> float:
    if material is None:
        return 1.0
    return float(material.diffuse_color[3])


def material_role(
    obj: bpy.types.Object,
    material: bpy.types.Material | None,
    slot_index: int,
    face_y: float,
    lamp_zone: tuple[float, float],
) -> str:
    object_name = plain_name(obj.name)
    material_name = plain_name(material.name) if material is not None else ""

    # Lens before glass: a lamp lens is translucent too, and a headlight that ends
    # up in the window mesh is both invisible and unlightable.
    #
    # The lens has to be AT AN END of the car as well as wear a lamp texture. This
    # pack textures a whole lamp assembly — reflector bowls, bulb holders, side
    # repeaters halfway down the flank — with the lamp image, and binding all of it
    # as the headlight both lit up the wing and dragged the beam mount sideways off
    # the lamp it is supposed to come out of.
    rear_limit, front_limit = lamp_zone
    if LAMP_RE.search(material_name):
        if face_y >= front_limit:
            return "Headlights"
        if face_y <= rear_limit:
            return "BrakeLights"
        return "car_trim"

    # Windows are the pack's only translucent body material, so the alpha channel
    # is what finds their exact outline inside a door — the door's own name says
    # nothing about where its glass stops and its frame starts.
    if GLASS_RE.search(material_name) or material_alpha(material) < 0.95:
        return "car_glass"
    if GLASS_RE.search(object_name) and len(obj.material_slots) <= 1:
        return "car_glass"

    if PAINT_RE.search(material_name):
        return "car_paint"
    if TRIM_RE.search(material_name):
        return "car_trim"
    if slot_index == 0 and PANEL_RE.search(object_name):
        return "car_paint"
    return "car_trim"


def new_runtime_material(name: str) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.use_backface_culling = False
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    colors = {
        "car_paint": (0.34, 0.025, 0.018, 1.0),
        "car_trim": (0.035, 0.04, 0.045, 1.0),
        "car_glass": (0.035, 0.075, 0.11, 1.0),
        "Headlights": (0.72, 0.78, 0.72, 1.0),
        "BrakeLights": (0.45, 0.012, 0.008, 1.0),
        "Tyres": (0.018, 0.02, 0.022, 1.0),
    }
    bsdf.inputs["Base Color"].default_value = colors[name]
    # Matte painted steel, like the Soviet pack: a metallic paint slot tints its own
    # highlight with the body colour, which under a warm sun turned every car a
    # different shade of wrong beside its neighbours.
    bsdf.inputs["Roughness"].default_value = 0.5 if name == "car_paint" else 0.55
    bsdf.inputs["Metallic"].default_value = 0.0
    return material


def mesh_object(
    name: str,
    vertices: list[tuple[float, float, float]],
    faces: list[tuple[int, ...]],
    material: bpy.types.Material,
    parent: bpy.types.Object,
) -> bpy.types.Object:
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(material)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = parent
    return obj


def is_mirrored(obj: bpy.types.Object) -> bool:
    """A GTA frame mirrors the left-hand parts with a negative-scale matrix.

    Baking such a matrix into vertex positions keeps the source face order, which
    leaves the exported triangles wound backwards: the part renders inside out.
    Reversing each face of a mirrored object restores an outward-facing surface.
    """
    return obj.matrix_world.determinant() < 0


def collect_body(
    objects: list[bpy.types.Object],
    lamp_zone: tuple[float, float],
) -> dict[str, tuple[list[tuple[float, float, float]], list[tuple[int, ...]]]]:
    buckets = {role: ([], []) for role in ROLES}
    for obj in objects:
        mesh = obj.data
        mirrored = is_mirrored(obj)
        world_vertices = [obj.matrix_world @ vertex.co for vertex in mesh.vertices]
        per_role_maps: dict[str, dict[int, int]] = {role: {} for role in ROLES}
        for polygon in mesh.polygons:
            face_y = sum(world_vertices[index].y for index in polygon.vertices) / len(polygon.vertices)
            material = obj.material_slots[polygon.material_index].material if polygon.material_index < len(obj.material_slots) else None
            role = material_role(obj, material, polygon.material_index, face_y, lamp_zone)
            vertices, faces = buckets[role]
            index_map = per_role_maps[role]
            face = []
            source_indices = list(polygon.vertices)
            if mirrored:
                source_indices.reverse()
            for source_index in source_indices:
                target_index = index_map.get(source_index)
                if target_index is None:
                    point = world_vertices[source_index]
                    target_index = len(vertices)
                    vertices.append((point.x, point.y, point.z))
                    index_map[source_index] = target_index
                face.append(target_index)
            faces.append(tuple(face))
    return buckets


def weld(obj: bpy.types.Object, distance: float = 0.0008) -> None:
    """Merges the duplicate vertices left where source objects met.

    A role mesh is welded from a dozen separate DFF objects, each of which brought
    its own copies of the vertices along every shared seam. Collapse decimation
    cannot move a vertex across a seam it does not know exists, so it eats the
    detail around it instead — which is how a front bumper came out looking bitten.
    """
    mesh = bmesh.new()
    mesh.from_mesh(obj.data)
    bmesh.ops.remove_doubles(mesh, verts=mesh.verts, dist=distance)
    mesh.to_mesh(obj.data)
    mesh.free()
    obj.data.update()


def decimate(obj: bpy.types.Object, target_faces: int) -> None:
    face_count = len(obj.data.polygons)
    if face_count <= target_faces:
        return
    modifier = obj.modifiers.new("offline-decimate", "DECIMATE")
    modifier.decimate_type = "COLLAPSE"
    modifier.ratio = max(0.01, target_faces / face_count)
    modifier.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.select_set(False)


def harden_edges(obj: bpy.types.Object, angle_degrees: float = 32.0) -> None:
    """Splits normals across panel edges, so a merged body is not smoothed flat.

    Every role mesh here is a WELD of a dozen source objects, and shading them all
    smooth runs one normal across the seam between a wing and a door — the panels
    read as a soft gradient instead of pressed steel, which is what makes these
    bodies stand out beside the Soviet pack. Splitting above a panel-crease angle
    keeps curvature smooth and creases sharp.
    """
    modifier = obj.modifiers.new("offline-edge-split", "EDGE_SPLIT")
    modifier.split_angle = math.radians(angle_degrees)
    modifier.use_edge_angle = True
    modifier.use_edge_sharp = False
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.select_set(False)


def add_nose_bulkhead(
    root: bpy.types.Object,
    body_vertices: list[Vector],
    material: bpy.types.Material,
) -> None:
    """Blanks off the empty engine bay seen through the grille.

    A GTA bonnet hides a modelled engine that this pack deliberately drops, so the
    gaps between the grille bars look straight into an empty shell. A plate set
    just behind the nose, cut to the body's own front cross-section, gives those
    gaps something dark to end on without touching the grille itself.
    """
    max_y = max(point.y for point in body_vertices)
    min_y = min(point.y for point in body_vertices)
    slice_depth = max(0.12, (max_y - min_y) * 0.10)
    nose = [point for point in body_vertices if point.y >= max_y - slice_depth]
    if len(nose) < 8:
        raise RuntimeError("No nose cross-section to blank off")
    min_x = min(point.x for point in nose)
    max_x = max(point.x for point in nose)
    min_z = min(point.z for point in nose)
    max_z = max(point.z for point in nose)
    centre_x = (min_x + max_x) * 0.5
    centre_z = (min_z + max_z) * 0.5
    half_x = (max_x - min_x) * 0.44
    half_z = (max_z - min_z) * 0.45
    y = max_y - slice_depth
    vertices = [
        (centre_x - half_x, y, centre_z - half_z),
        (centre_x + half_x, y, centre_z - half_z),
        (centre_x + half_x, y, centre_z + half_z),
        (centre_x - half_x, y, centre_z + half_z),
    ]
    # Two faces, wound both ways: the plate is seen from in front through the grille
    # and from behind through the wheel arches, and it is one quad thick.
    mesh_object("bulkhead", vertices, [(0, 1, 2, 3), (3, 2, 1, 0)], material, root)


def signed_volume(vertices: list[Vector], faces: list[tuple[int, ...]]) -> float:
    """Six times the signed volume of a closed mesh; negative means inverted faces."""
    total = 0.0
    for face in faces:
        first = vertices[face[0]]
        for i in range(1, len(face) - 1):
            total += first.dot(vertices[face[i]].cross(vertices[face[i + 1]]))
    return total


def wheel_geometry(objects: list[bpy.types.Object]) -> tuple[list[Vector], list[tuple[int, ...]], Vector, float]:
    vertices: list[Vector] = []
    faces: list[tuple[int, ...]] = []
    points: list[Vector] = []
    for obj in objects:
        transformed = [obj.matrix_world @ vertex.co for vertex in obj.data.vertices]
        offset = len(vertices)
        vertices.extend(transformed)
        points.extend(transformed)
        for polygon in obj.data.polygons:
            faces.append(tuple(offset + index for index in polygon.vertices))
    if not points:
        raise RuntimeError("Empty wheel geometry")
    # A wheel is a closed solid, so its own signed volume is the reliable oracle for
    # which way its faces are wound — more reliable than the frame matrix, because
    # this pack ships wheels that are already inverted before any mirror is applied
    # (GTA renders them two-sided and never notices). Negative volume, flip.
    if signed_volume(vertices, faces) < 0:
        faces = [tuple(reversed(face)) for face in faces]
    low = Vector(tuple(min(point[i] for point in points) for i in range(3)))
    high = Vector(tuple(max(point[i] for point in points) for i in range(3)))
    centre = (low + high) * 0.5
    extents = high - low
    radius = max(extents.x, extents.y, extents.z) * 0.5
    return [point - centre for point in vertices], faces, centre, radius


def load_soviet_wheel() -> tuple[list[Vector], list[tuple[int, ...]], float]:
    """The Soviet pack's road wheel, centred on its own bounds and unit-scaled."""
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.fbx(filepath=str(SOVIET_WHEEL_FBX))
    imported = [obj for obj in bpy.context.scene.objects if obj not in before]
    source = next((obj for obj in imported if obj.name.startswith(SOVIET_WHEEL_OBJECT)), None)
    if source is None:
        raise RuntimeError(f"{SOVIET_WHEEL_FBX} has no object {SOVIET_WHEEL_OBJECT}")
    points = [source.matrix_world @ vertex.co for vertex in source.data.vertices]
    faces = [tuple(polygon.vertices) for polygon in source.data.polygons]
    low = Vector(tuple(min(point[i] for point in points) for i in range(3)))
    high = Vector(tuple(max(point[i] for point in points) for i in range(3)))
    centre = (low + high) * 0.5
    extents = high - low
    radius = max(extents.x, extents.y, extents.z) * 0.5
    vertices = [(point - centre) / radius for point in points]
    for obj in imported:
        bpy.data.objects.remove(obj, do_unlink=True)
    return vertices, faces, radius


def create_wheels(
    root: bpy.types.Object,
    source_geometry: dict[str, tuple[list[Vector], list[tuple[int, ...]], Vector, float]],
    dummy_positions: dict[str, Vector],
    materials: dict[str, bpy.types.Material],
    soviet_wheel: tuple[list[Vector], list[tuple[int, ...]], float] | None,
) -> float:
    available = [key for key in WHEEL_KEYS if key in source_geometry]
    if not available:
        raise RuntimeError("No wheel mesh parented to a DFF wheel dummy")
    radii = []
    for key in WHEEL_KEYS:
        source_key = key if key in source_geometry else available[0]
        radius = source_geometry[source_key][3]
        if soviet_wheel is not None:
            # The Soviet wheel arrives unit-scaled, so the DFF's own wheel radius is
            # still what sizes it: the car keeps the stance its dummies describe.
            unit_vertices, faces, _unit_radius = soviet_wheel
            vertices = [vertex * radius for vertex in unit_vertices]
            # The imported copy sits on the FBX's -X side, which is a DFF's left.
            source_side_left = True
        else:
            source_vertices, faces, _source_centre, _radius = source_geometry[source_key]
            vertices = [vertex.copy() for vertex in source_vertices]
            source_side_left = source_key.endswith("l")
        # A wheel taken from the other side is TURNED about the vertical axis, never
        # mirrored: a mirror reverses winding and renders the assembly inside out.
        if key.endswith("l") != source_side_left:
            turn = Matrix.Rotation(math.pi, 4, "Z")
            vertices = [turn @ vertex for vertex in vertices]
        # Rim and tyre are split later, off the packed GLB (tools/rim-split.mjs):
        # the geometry is the only thing that says where a rim ends, and doing it
        # once there covers bodies this normalizer did not produce.
        wheel = mesh_object(
            key,
            [(point.x, point.y, point.z) for point in vertices],
            faces,
            materials["Tyres"],
            root,
        )
        wheel.location = dummy_positions[key]
        decimate(wheel, 2_200)
        radii.append(radius)

        bpy.ops.mesh.primitive_cylinder_add(
            vertices=16,
            radius=max(0.07, radius * 0.30),
            depth=max(0.08, radius * 0.22),
            location=dummy_positions[key],
            rotation=(0.0, math.pi / 2, 0.0),
        )
        hub = bpy.context.object
        hub.name = key.replace("wheel", "hub")
        hub.data.name = f"{hub.name}_mount"
        hub.data.materials.append(materials["car_trim"])
        hub.parent = root
        radii.append(radius)
    return sum(radii) / len(radii)


def add_underbody(
    root: bpy.types.Object,
    body_vertices: list[Vector],
    dummy_positions: dict[str, Vector],
    wheel_radius: float,
    material: bpy.types.Material,
) -> None:
    """Close an open shell with a plate tucked inside the body's own sills.

    Sized off the SILL REGION between the axles rather than the body's silhouette:
    a plate cut to the outer bounds includes the mirrors, the bumpers and the wheel
    arches, and hangs out under the car as a visible slab.
    """
    front_y = (dummy_positions["wheel_fl"].y + dummy_positions["wheel_fr"].y) / 2
    rear_y = (dummy_positions["wheel_rl"].y + dummy_positions["wheel_rr"].y) / 2
    axle_z = sum(position.z for position in dummy_positions.values()) / 4
    inset_y = wheel_radius * 0.9
    low_y = min(front_y, rear_y) + inset_y
    high_y = max(front_y, rear_y) - inset_y
    sill = [
        point
        for point in body_vertices
        if low_y <= point.y <= high_y and point.z <= axle_z + wheel_radius * 0.6
    ]
    if len(sill) < 8:
        raise RuntimeError("No sill region to close the floor against")
    min_x = min(point.x for point in sill)
    max_x = max(point.x for point in sill)
    min_z = min(point.z for point in sill)
    centre_x = (min_x + max_x) * 0.5
    half_x = (max_x - min_x) * 0.40
    thickness = max(0.03, wheel_radius * 0.08)
    # Floor height: below the door cards, above whatever hangs lowest along the sills.
    top = min(axle_z + wheel_radius * 0.30, min_z + wheel_radius * 0.55)
    low = (centre_x - half_x, low_y, top - thickness)
    high = (centre_x + half_x, high_y, top)
    vertices = [
        (x, y, z)
        for z in (low[2], high[2])
        for y in (low[1], high[1])
        for x in (low[0], high[0])
    ]
    faces = [
        (0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1),
        (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3),
    ]
    mesh_object("underbody", vertices, faces, material, root)


def orient_to_game(root: bpy.types.Object) -> None:
    """Turns the pack's forward axis onto the one the game drives along.

    A GTA body points its nose down +Y, and the glTF exporter's Y-up conversion
    sends Blender +Y to glTF -Z — so an untouched export arrives back to front:
    it reverses under throttle and steers from the boot. Half a turn about the
    vertical axis is baked into the geometry rather than declared as catalogue
    `yaw`, because `render/carmodel.ts` detaches the wheel nodes and mixes their
    world centres with their local offsets; a rotation left on a parent node is
    dropped by that detach and the wheels would be drawn a wheelbase away.

    A rotation is proper, so winding, normals and node scales are untouched, and
    the left-hand wheels stay on the game's left.
    """
    turn = Matrix.Rotation(math.pi, 4, "Z")
    for child in root.children:
        child.data.transform(turn)
        child.location = turn @ child.location


def normalize(
    model_id: str,
    source: Path,
    body_target: int,
    needs_underbody: bool,
    soviet_wheels: bool,
) -> None:
    print(f"\n=== {model_id}: {source} ===")
    clear_scene()
    import_dff(source)

    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    dummy_positions: dict[str, Vector] = {}
    for obj in bpy.context.scene.objects:
        key = wheel_key(obj.name)
        if key is not None:
            dummy_positions[key] = obj.matrix_world.translation.copy()
    missing_dummies = [key for key in WHEEL_KEYS if key not in dummy_positions]
    if missing_dummies:
        raise RuntimeError(f"Missing wheel dummies in {source}: {missing_dummies}")

    wheel_sources: dict[str, list[bpy.types.Object]] = {key: [] for key in WHEEL_KEYS}
    body_objects: list[bpy.types.Object] = []
    for obj in meshes:
        wheel_parent = wheel_ancestor(obj)
        if wheel_parent is not None:
            wheel_sources[wheel_parent[0]].append(obj)
        elif WHEEL_NAME_RE.search(plain_name(obj.name)):
            continue
        elif not excluded(obj):
            body_objects.append(obj)
    if not body_objects:
        raise RuntimeError(f"No exterior meshes retained for {source}")

    materials = {name: new_runtime_material(name) for name in (*ROLES, "Tyres")}
    body_vertices = [
        obj.matrix_world @ vertex.co
        for obj in body_objects
        for vertex in obj.data.vertices
    ]
    # The nose and tail bands a lamp lens may live in: a tenth of the car's length
    # at each end, which reaches the whole lamp glass and nothing behind the wheel
    # arch.
    body_min_y = min(point.y for point in body_vertices)
    body_max_y = max(point.y for point in body_vertices)
    lamp_band = (body_max_y - body_min_y) * 0.10
    lamp_zone = (body_min_y + lamp_band, body_max_y - lamp_band)
    buckets = collect_body(body_objects, lamp_zone)
    wheel_geometry_by_key = {
        key: wheel_geometry(objects)
        for key, objects in wheel_sources.items()
        if objects
    }
    source_body_meshes = len(body_objects)
    source_body_faces = sum(len(obj.data.polygons) for obj in body_objects)

    source_objects = list(bpy.context.scene.objects)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for obj in source_objects:
        if obj.name in bpy.data.objects:
            bpy.data.objects.remove(obj, do_unlink=True)

    root = bpy.data.objects.new(model_id, None)
    bpy.context.scene.collection.objects.link(root)

    total_faces = sum(len(faces) for _vertices, faces in buckets.values())
    for role in ROLES:
        vertices, faces = buckets[role]
        if not faces:
            raise RuntimeError(f"{model_id} has no geometry for required role {role}")
        obj = mesh_object(
            {
                "car_paint": "paint",
                "car_trim": "trim",
                "car_glass": "glass",
                "Headlights": "headlights",
                "BrakeLights": "taillights",
            }[role],
            vertices,
            faces,
            materials[role],
            root,
        )
        weld(obj)
        share = max(64, round(body_target * len(faces) / max(1, total_faces)))
        decimate(obj, share)
        harden_edges(obj)

    wheel = load_soviet_wheel() if soviet_wheels else None
    wheel_radius = create_wheels(root, wheel_geometry_by_key, dummy_positions, materials, wheel)
    add_nose_bulkhead(root, body_vertices, materials["car_trim"])
    if needs_underbody:
        add_underbody(root, body_vertices, dummy_positions, wheel_radius, materials["car_trim"])
    orient_to_game(root)

    DIST.mkdir(parents=True, exist_ok=True)
    blend_path = DIST / f"{model_id}.blend"
    glb_path = DIST / f"{model_id}.glb"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path), compress=True)

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=str(glb_path),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_texcoords=False,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
        export_animations=False,
    )
    print(
        f"Exported {glb_path}: body source meshes={source_body_meshes}, "
        f"source faces={source_body_faces}, wheel radius={wheel_radius:.3f}"
    )


def main() -> None:
    install_safe_dragonff_loader()
    requested = set(sys.argv[sys.argv.index("--") + 1:]) if "--" in sys.argv else set()
    selected = [spec for spec in MODELS if not requested or spec[0] in requested]
    missing = requested.difference(spec[0] for spec in selected)
    if missing:
        raise RuntimeError(f"Unknown model ids: {sorted(missing)}")
    for spec in selected:
        normalize(*spec)


main()
