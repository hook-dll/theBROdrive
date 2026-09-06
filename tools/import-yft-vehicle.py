#!/usr/bin/env python3
"""
tools/import-yft-vehicle.py -- GTA V add-on vehicle (.rpf -> .yft) to runtime GLB.

Reads an RPF7 archive directly: no CodeWalker, no .NET, no Blender. The archive's
nested vehicles.rpf holds one RSC7 resource per vehicle; the .yft is a fragment
whose main drawable carries the whole body as ONE skinned mesh, and whose physics
LOD children carry the single wheel the game instances at four corners.

Two stages, because the decimator lives in `gltf-transform` (meshoptimizer):

  extract   dlc.rpf            -> build/<name>/{body,wheel}.glb   (raw, full density)
  assemble  build/<name>/*.glb -> one GLB with the runtime node/material contract

Between them, run `gltf-transform simplify` on each part with its own ratio: a
37k-triangle wheel and a 210k-triangle body do not want the same one, and the
wheel is decimated ONCE and then instanced, so all four corners stay identical.

What is dropped, and why it is dropped by BONE and not by name matching on the
mesh: the source body is a single skinned mesh, so "the dashboard" is not an
object -- it is the set of triangles weighted to the `torpedo` bone. Interior,
engine, damage-only and neon geometry never reach the runtime; see DROP_BONES.

Coordinate systems. GTA V is Z-up, nose +Y, driver's side -X. The game is Y-up
and drives toward +Z (see CarModelDef.yaw). The mapping baked here is
(x, y, z) -> (-x, z, y): determinant +1, so winding and normals survive, the
nose lands on +Z and the car's left flank on +X, exactly as the shipped packs.
"""

from __future__ import annotations

import argparse
import collections
import json
import struct
import sys
import zlib
from pathlib import Path

import numpy as np

# ---------------------------------------------------------------- RPF7 archive

RPF7_MAGIC = 0x52504637
DIR_IDENT = 0x7FFFFF00


def _rpf_entries(data: memoryview, base: int):
    ver, count, names_len, enc = struct.unpack_from("<4I", data, base)
    if ver != RPF7_MAGIC:
        raise ValueError(f"not an RPF7 archive at {base:#x}")
    if enc != 0x4E45504F:  # 'OPEN'
        raise ValueError("encrypted RPF; only OPEN archives are supported")
    ent = bytes(data[base + 16 : base + 16 + count * 16])
    names = bytes(data[base + 16 + count * 16 :][:names_len])

    def name(off: int) -> str:
        return names[off : names.index(b"\0", off)].decode("utf8", "replace")

    out: dict[str, dict] = {}

    def walk(i: int, path: str):
        b = ent[i * 16 : i * 16 + 16]
        if struct.unpack_from("<I", b, 4)[0] == DIR_IDENT:
            nm = name(struct.unpack_from("<I", b, 0)[0])
            idx, cnt = struct.unpack_from("<2I", b, 8)
            sub = f"{path}/{nm}" if nm else path
            for j in range(idx, idx + cnt):
                walk(j, sub)
            return
        nm = name(struct.unpack_from("<H", b, 0)[0])
        size = int.from_bytes(b[2:5], "little")
        raw_off = int.from_bytes(b[5:8], "little")
        # High bit of the offset field marks a resource (RSC7) entry; a binary
        # entry stores its compressed size, a resource entry stores 0 there and
        # keeps its sizes in the system/graphics flags instead.
        out[f"{path}/{nm}"] = {
            "offset": base + (raw_off & 0x7FFFFF) * 512,
            "size": size,
            "resource": bool(raw_off & 0x800000),
            "system_flags": struct.unpack_from("<I", b, 8)[0],
            "graphics_flags": struct.unpack_from("<I", b, 12)[0],
        }

    walk(0, "")
    return out


def size_from_flags(flags: int) -> int:
    """Page-count encoding shared by every RSC7 resource (dexyfex's derivation)."""
    parts = (
        ((flags >> 27) & 0x1) << 0,
        ((flags >> 26) & 0x1) << 1,
        ((flags >> 25) & 0x1) << 2,
        ((flags >> 24) & 0x1) << 3,
        ((flags >> 17) & 0x7F) << 4,
        ((flags >> 11) & 0x3F) << 5,
        ((flags >> 7) & 0xF) << 6,
        ((flags >> 5) & 0x3) << 7,
        ((flags >> 4) & 0x1) << 8,
    )
    return (0x200 << (flags & 0xF)) * sum(parts)


def find_yft(path: Path) -> tuple[bytes, str]:
    """Inflate the first non-`_hi` .yft in the archive's nested vehicles.rpf."""
    blob = memoryview(path.read_bytes())
    top = _rpf_entries(blob, 0)
    nested = [k for k in top if k.lower().endswith("vehicles.rpf")]
    if not nested:
        raise SystemExit("no vehicles.rpf inside the archive")
    inner_base = top[nested[0]]["offset"]
    inner = _rpf_entries(blob, inner_base)
    yfts = [k for k in inner if k.lower().endswith(".yft") and "_hi" not in k.lower()]
    if not yfts:
        raise SystemExit("no .yft inside vehicles.rpf")
    e = inner[yfts[0]]
    raw = bytes(blob[e["offset"] : e["offset"] + e["size"]])
    if raw[:4] != b"RSC7":
        raise SystemExit("resource is not RSC7")
    system_size = size_from_flags(e["system_flags"])
    data = zlib.decompressobj(-15).decompress(raw[16:])
    expect = system_size + size_from_flags(e["graphics_flags"])
    if len(data) != expect:
        raise SystemExit(f"inflated {len(data)} bytes, flags claim {expect}")
    return data, yfts[0].strip("/")


# ------------------------------------------------------- RSC7 resource reader


class Resource:
    """Pointer-resolving view over the inflated [system][graphics] segments."""

    def __init__(self, data: bytes, system_size: int):
        self.b = data
        self.system_size = system_size

    def off(self, ptr: int):
        if ptr == 0:
            return None
        seg = ptr >> 28
        if seg == 6:
            return self.system_size + (ptr & 0x0FFFFFFF)
        return ptr & 0x0FFFFFFF

    def u16(self, o):
        return struct.unpack_from("<H", self.b, o)[0]

    def u32(self, o):
        return struct.unpack_from("<I", self.b, o)[0]

    def u64(self, o):
        return struct.unpack_from("<Q", self.b, o)[0]

    def vec3(self, o):
        return np.array(struct.unpack_from("<3f", self.b, o), dtype=np.float64)

    def string(self, ptr):
        o = self.off(ptr)
        if o is None:
            return None
        return self.b[o : self.b.index(b"\0", o)].decode("utf8", "replace")


# Component type -> size in bytes, indexed by the 4-bit code in VertexDeclaration.
COMPONENT_SIZE = {0: 0, 1: 4, 2: 4, 3: 8, 4: 0, 5: 8, 6: 12, 7: 16, 8: 4, 9: 4, 10: 4}
SEMANTICS = [
    "POSITION", "BLENDWEIGHTS", "BLENDINDICES", "NORMAL", "COLOR0", "COLOR1",
    "TEXCOORD0", "TEXCOORD1", "TEXCOORD2", "TEXCOORD3", "TEXCOORD4", "TEXCOORD5",
    "TEXCOORD6", "TEXCOORD7", "TANGENT", "BINORMAL",
]


def jenkins(text: str) -> int:
    h = 0
    for ch in text.encode("utf8"):
        h = (h + ch) & 0xFFFFFFFF
        h = (h + (h << 10)) & 0xFFFFFFFF
        h ^= h >> 6
    h = (h + (h << 3)) & 0xFFFFFFFF
    h ^= h >> 11
    return (h + (h << 15)) & 0xFFFFFFFF


SHADER_NAMES = [
    "vehicle_paint1", "vehicle_paint2", "vehicle_paint3", "vehicle_paint4",
    "vehicle_paint6", "vehicle_paint7", "vehicle_paint8", "vehicle_paint9",
    "vehicle_mesh", "vehicle_mesh_enveff", "vehicle_generic", "vehicle_detail",
    "vehicle_detail2", "vehicle_badges", "vehicle_decal", "vehicle_decal2",
    "vehicle_shuts", "vehicle_interior", "vehicle_interior2", "vehicle_vehglass",
    "vehicle_vehglass_inner", "vehicle_lightsemissive", "vehicle_lights",
    "vehicle_tire", "vehicle_dash_emissive", "vehicle_dash_emissive_opaque",
    "vehicle_cloth", "vehicle_cloth2", "vehicle_licenseplate", "vehicle_basic",
    "vehicle_blurredrotor", "vehicle_track", "vehicle_emissive_alpha",
    "vehicle_emissive_opaque",
]
SHADER_BY_HASH = {jenkins(n): n for n in SHADER_NAMES}


def read_skeleton(res: Resource, ptr: int):
    o = res.off(ptr)
    if o is None:
        return []
    bones_off = res.off(res.u64(o + 0x20))
    count = res.u16(o + 0x5E)
    bones = []
    for i in range(count):
        b = bones_off + i * 80
        bones.append(
            {
                "index": i,
                "name": res.string(res.u64(b + 0x38)) or f"bone{i}",
                "tag": res.u16(b + 0x44),
                "parent": struct.unpack_from("<h", res.b, b + 0x32)[0],
                "translation": res.vec3(b + 0x10),
            }
        )
    return bones


def read_shaders(res: Resource, ptr: int):
    o = res.off(ptr)
    if o is None:
        return []
    arr = res.off(res.u64(o + 0x10))
    count = res.u16(o + 0x18)
    out = []
    for i in range(count):
        so = res.off(res.u64(arr + i * 8))
        name_hash = res.u32(so + 8)
        out.append(SHADER_BY_HASH.get(name_hash, f"{name_hash:#x}"))
    return out


def read_geometry(res: Resource, ptr: int):
    o = res.off(ptr)
    vb = res.off(res.u64(o + 0x18))
    ib = res.off(res.u64(o + 0x38))
    if vb is None or ib is None:
        return None
    stride = res.u16(vb + 0x08)
    count = res.u32(vb + 0x18)
    data = res.off(res.u64(vb + 0x10))
    decl = res.off(res.u64(vb + 0x30))
    flags = res.u32(decl)
    types = res.u64(decl + 8)
    comps, coff = {}, 0
    for k in range(16):
        if (flags >> k) & 1:
            size = COMPONENT_SIZE[(types >> (k * 4)) & 0xF]
            comps[SEMANTICS[k]] = coff
            coff += size
    if coff != stride:
        raise ValueError(f"declaration stride {coff} != buffer stride {stride}")

    raw = np.frombuffer(res.b, np.uint8, count * stride, data).reshape(count, stride)

    def floats(sem, n):
        o_ = comps[sem]
        return np.ascontiguousarray(raw[:, o_ : o_ + 4 * n]).view("<f4").reshape(count, n)

    geom = {
        "position": floats("POSITION", 3).astype(np.float64),
        "normal": floats("NORMAL", 3).astype(np.float64) if "NORMAL" in comps else None,
        "indices": np.frombuffer(res.b, "<u2", res.u32(ib + 8), res.off(res.u64(ib + 0x10))).reshape(-1, 3),
    }
    if "BLENDINDICES" in comps and "BLENDWEIGHTS" in comps:
        bi = np.ascontiguousarray(raw[:, comps["BLENDINDICES"] : comps["BLENDINDICES"] + 4])
        bw = np.ascontiguousarray(raw[:, comps["BLENDWEIGHTS"] : comps["BLENDWEIGHTS"] + 4])
        geom["bone"] = bi[np.arange(count), bw.argmax(1)].astype(np.int32)
    else:
        geom["bone"] = None
    return geom


def read_models(res: Resource, drawable_ptr: int):
    """Every geometry of a drawable's HIGH LOD, with its shader name and bone."""
    o = res.off(drawable_ptr)
    if o is None:
        return [], []
    shaders = read_shaders(res, res.u64(o + 0x10))
    skeleton = read_skeleton(res, res.u64(o + 0x18))
    header = res.off(res.u64(o + 0x50))
    out = []
    if header is None:
        return out, skeleton
    ptrs = res.off(res.u64(header))
    for i in range(res.u16(header + 8)):
        mo = res.off(res.u64(ptrs + i * 8))
        geo_ptrs = res.off(res.u64(mo + 8))
        gcount = res.u16(mo + 0x10)
        mapping = res.off(res.u64(mo + 0x20))
        bone_index = (res.u32(mo + 0x28) >> 24) & 0xFF
        for gi in range(gcount):
            geom = read_geometry(res, res.u64(geo_ptrs + gi * 8))
            if geom is None:
                continue
            shader_id = res.u16(mapping + gi * 2) if mapping else 0
            geom["shader"] = shaders[shader_id] if shader_id < len(shaders) else "?"
            geom["model_bone"] = bone_index
            out.append(geom)
    return out, skeleton


def read_children(res: Resource):
    """Fragment physics children: name -> drawable pointer (the wheels live here)."""
    group = res.off(res.u64(0xF0))
    if group is None:
        return {}
    out = {}
    for lod_ptr in (res.u64(group + 0x10), res.u64(group + 0x18), res.u64(group + 0x20)):
        lod = res.off(lod_ptr)
        if lod is None:
            continue
        children = res.off(res.u64(lod + 0xD0))
        for i in range(res.b[lod + 0x11D]):
            co = res.off(res.u64(children + i * 8))
            out.setdefault(res.u16(co + 0x12), res.u64(co + 0xA0))
    return out


# ------------------------------------------------------------- classification

# Bones whose triangles never ship: cabin, engine bay, damage-only and neon
# geometry. The body is one skinned mesh, so this is the only handle on them.
#
# The door cards (`door_lf_ok`, `door_rf_ok` and the two `ssss` bones) go with
# the cabin. This pack authors them as a second shell a few centimetres inside
# the painted door skin; with the seats and dashboard gone there is nothing for
# them to trim, and at the runtime's triangle budget the two coincident sheets
# decimate into each other and punch craters through the doors.
DROP_BONES = {
    "torpedo.008_torpedo.009", "torpeda", "steeringwheel", "Pioneer", "dials",
    "Retopo_SPEED.003_mesh", "steklo", "kovrik", "DVIG", "engine", "exhaust",
    "chassis_lowlod", "Cylinder_Cylinder", "extra_1", "extra_2", "llhprod", "SED",
    "suspension_lf", "suspension_rf", "suspension_lr", "suspension_rr",
    "seat_dside_f", "seat_dside_r", "seat_pside_f", "seat_pside_r",
    "neon_l", "neon_r", "neon_f", "neon_b", "overheat", "overheat_2",
    "door_lf_ok.004_door_lf_ok.004_door_lf_ok.004_door_lf_ok.004"
    "_door_lf_ok.004_door_lf_ok.004_door_lf_ok.004_door_lf_ok.004",
    "door_rf_ok.004_door_rf_ok.004_door_rf_ok.004_door_rf_ok.004"
    "_door_rf_ok.004_door_rf_ok.004_door_rf_ok.004_door_rf_ok.004",
    "ssssss", "sssssssssssssssssss",
}
# Lamp lenses authored as glass. Leaving them in `car_glass` would put a
# translucent sheet in front of the emissive lens, which then lights invisibly.
FRONT_LENS_BONES = {"fars_2110_006_fars_2110_012.002_fars_2110_006_fars_2110_012.002"}
REAR_LENS_BONES = {"stfar", "reflector"}

SHADER_ROLE = {
    "vehicle_paint1": "car_paint", "vehicle_paint2": "car_paint",
    "vehicle_paint3": "car_paint", "vehicle_paint4": "car_paint",
    "vehicle_mesh": "car_trim", "vehicle_mesh_enveff": "car_trim",
    "vehicle_detail": "car_trim", "vehicle_detail2": "car_trim",
    "vehicle_badges": "car_trim", "vehicle_shuts": "car_trim",
    "vehicle_generic": "car_trim", "vehicle_tire": "car_trim",
    "vehicle_vehglass": "car_glass", "vehicle_vehglass_inner": "car_glass",
    "vehicle_lightsemissive": "lamp", "vehicle_lights": "lamp",
    "vehicle_interior": None, "vehicle_interior2": None,
    "vehicle_dash_emissive": None, "vehicle_dash_emissive_opaque": None,
    "vehicle_cloth": None, "vehicle_cloth2": None,
}
# A lamp mesh this far from the car's centre plane is a headlamp or a tail lamp;
# anything between is a side repeater or a door courtesy light, which is trim.
LAMP_SPLIT_Y = 0.5


def classify(bone_name: str, shader: str, centroid_y: float) -> str | None:
    if bone_name in DROP_BONES:
        return None
    role = SHADER_ROLE.get(shader, "car_trim")
    if role is None:
        return None
    if role == "car_glass":
        if bone_name in FRONT_LENS_BONES:
            return "headlights"
        if bone_name in REAR_LENS_BONES:
            return "taillights"
        return "car_glass"
    if role == "lamp":
        if centroid_y > LAMP_SPLIT_Y:
            return "headlights"
        if centroid_y < -LAMP_SPLIT_Y:
            return "taillights"
        return "car_trim"
    return role


# --------------------------------------------------------------- glTF writing

MATERIALS = {
    "car_paint": ([0.055, 0.15, 0.11, 1], 0.68, 0.08),
    "car_trim": ([0.035, 0.04, 0.045, 1], 0.82, 0.0),
    "car_glass": ([0.025, 0.045, 0.055, 1], 0.08, 0.10),
    "Headlights": ([0.72, 0.76, 0.66, 1], 0.18, 0.0),
    "BrakeLights": ([0.32, 0.008, 0.004, 1], 0.28, 0.0),
    "Tyres": ([0.018, 0.02, 0.022, 1], 0.94, 0.0),
}
# Runtime role -> (node name, mesh name, material).
NODE_CONTRACT = {
    "car_paint": ("chassisbody", "paint", "car_paint"),
    "car_trim": ("chassis_trim", "trim", "car_trim"),
    "car_glass": ("glass", "glass", "car_glass"),
    "headlights": ("headlights", "headlights", "Headlights"),
    "taillights": ("taillights", "taillights", "BrakeLights"),
    "wheel": ("wheel", "wheel", "Tyres"),
}


def write_glb(path: Path, parts: dict[str, dict], nodes: list[dict], materials: dict | None = None):
    """Minimal, uncompressed GLB: float positions/normals, uint32 indices.

    A part may name its own `material` and `mesh_name`; otherwise it is a runtime
    role and takes both from `NODE_CONTRACT`. The inspection export uses the
    first form to keep the source's own shader names visible in Blender.
    """
    palette = materials if materials is not None else MATERIALS
    buf = bytearray()
    accessors, views, meshes = [], [], []
    mat_index = {name: i for i, name in enumerate(palette)}

    def add_view(data: bytes, target: int) -> int:
        while len(buf) % 4:
            buf.append(0)
        views.append({"buffer": 0, "byteOffset": len(buf), "byteLength": len(data), "target": target})
        buf.extend(data)
        return len(views) - 1

    mesh_index = {}
    for role, part in parts.items():
        pos = part["position"].astype(np.float32)
        nor = part["normal"].astype(np.float32)
        idx = part["indices"].astype(np.uint32).ravel()
        pv = add_view(pos.tobytes(), 34962)
        nv = add_view(nor.tobytes(), 34962)
        iv = add_view(idx.tobytes(), 34963)
        accessors.append({"bufferView": pv, "componentType": 5126, "count": len(pos), "type": "VEC3",
                          "min": pos.min(0).tolist(), "max": pos.max(0).tolist()})
        accessors.append({"bufferView": nv, "componentType": 5126, "count": len(nor), "type": "VEC3"})
        accessors.append({"bufferView": iv, "componentType": 5125, "count": len(idx), "type": "SCALAR"})
        base = len(accessors) - 3
        if "material" in part:
            mesh_name, material = part.get("mesh_name", role), part["material"]
        else:
            _, mesh_name, material = NODE_CONTRACT[role]
        meshes.append({"name": mesh_name, "primitives": [
            {"attributes": {"POSITION": base, "NORMAL": base + 1}, "indices": base + 2,
             "material": mat_index[material]}]})
        mesh_index[role] = len(meshes) - 1

    gltf_nodes = []
    for node in nodes:
        n = {"name": node["name"], "mesh": mesh_index[node["role"]]}
        if node.get("translation") is not None:
            n["translation"] = [float(v) for v in node["translation"]]
        if node.get("rotation") is not None:
            n["rotation"] = [float(v) for v in node["rotation"]]
        gltf_nodes.append(n)

    gltf = {
        "asset": {"version": "2.0", "generator": "tools/import-yft-vehicle.py"},
        "scene": 0,
        "scenes": [{"nodes": list(range(len(gltf_nodes)))}],
        "nodes": gltf_nodes,
        "meshes": meshes,
        "accessors": accessors,
        "bufferViews": views,
        "buffers": [{"byteLength": len(buf)}],
        "materials": [
            {"name": name, "doubleSided": True,
             "pbrMetallicRoughness": {"baseColorFactor": c, "roughnessFactor": r, "metallicFactor": m}}
            for name, (c, r, m) in palette.items()
        ],
    }
    js = json.dumps(gltf, separators=(",", ":")).encode("utf8")
    js += b" " * (-len(js) % 4)
    bin_chunk = bytes(buf) + b"\0" * (-len(buf) % 4)
    out = b"glTF" + struct.pack("<II", 2, 12 + 8 + len(js) + 8 + len(bin_chunk))
    out += struct.pack("<I", len(js)) + b"JSON" + js
    out += struct.pack("<I", len(bin_chunk)) + b"BIN\0" + bin_chunk
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(out)


def to_game_axes(v: np.ndarray) -> np.ndarray:
    """GTA (x right, y forward, z up) -> game (x left, y up, z forward)."""
    return np.stack([-v[:, 0], v[:, 2], v[:, 1]], axis=1)


# Two vertices at the same point are the same vertex only if their normals agree
# to within this angle. Wider, and a panel edge is averaged into a smooth ramp,
# which reads as a dent once the body is decimated; narrower, and nothing welds.
WELD_NORMAL_COS = np.cos(np.radians(40.0))


def merge(chunks: list[tuple[np.ndarray, np.ndarray, np.ndarray]], weld: bool = True):
    """Concatenate geometry chunks, welding coincident vertices.

    Welding is not a size optimization here, it is what makes the mesh
    simplifiable at all. A GTA vertex is split at every UV, tangent and normal
    discontinuity, so a panel arrives as a cloud of one-triangle islands whose
    every edge is an open border; meshoptimizer will not collapse across those,
    and the decimator stops at a third of the requested ratio.

    Coincident vertices whose normals disagree are NOT merged: a door edge, a
    swage line and a wheel arch lip are authored as split normals, and averaging
    them turns every crease into a smooth ramp that decimates into a dent.
    """
    positions, normals, indices, base = [], [], [], 0
    for pos, nor, idx in chunks:
        positions.append(pos)
        normals.append(nor)
        indices.append(idx + base)
        base += len(pos)
    position = np.concatenate(positions)
    normal = np.concatenate(normals)
    index = np.concatenate(indices)
    if not weld:
        return {"position": position, "normal": normal, "indices": index}

    order = np.lexsort(np.round(position, 5).T)
    unit = normal / np.maximum(np.linalg.norm(normal, axis=1, keepdims=True), 1e-12)
    remap = np.empty(len(position), np.int64)
    keep: list[int] = []
    run_start = 0
    rounded = np.round(position, 5)
    for i in range(1, len(order) + 1):
        if i < len(order) and (rounded[order[i]] == rounded[order[run_start]]).all():
            continue
        # One run = one point in space; split it into normal clusters.
        clusters: list[int] = []
        for vertex in order[run_start:i]:
            for representative in clusters:
                if float(unit[vertex] @ unit[representative]) >= WELD_NORMAL_COS:
                    remap[vertex] = remap[representative]
                    break
            else:
                clusters.append(int(vertex))
                remap[vertex] = len(keep)
                keep.append(int(vertex))
        run_start = i

    kept = np.array(keep, np.int64)
    summed = np.zeros((len(kept), 3))
    np.add.at(summed, remap, unit)
    lengths = np.linalg.norm(summed, axis=1, keepdims=True)
    normal = np.divide(summed, lengths, out=unit[kept].copy(), where=lengths > 1e-9)
    position = position[kept]
    index = remap[index]
    # A collapsed edge leaves a zero-area triangle, which no renderer wants.
    index = index[(index[:, 0] != index[:, 1]) & (index[:, 1] != index[:, 2]) & (index[:, 0] != index[:, 2])]
    return {"position": position, "normal": normal, "indices": index}


# ------------------------------------------------------------------- stages


# Rough colours for the inspection export, so the source's own shaders are
# readable at a glance in Blender. Nothing here reaches the game.
INSPECT_COLOURS = {
    "vehicle_paint1": ([0.09, 0.28, 0.20, 1], 0.55, 0.10),
    "vehicle_mesh": ([0.30, 0.30, 0.32, 1], 0.70, 0.0),
    "vehicle_detail2": ([0.45, 0.40, 0.30, 1], 0.70, 0.0),
    "vehicle_badges": ([0.70, 0.65, 0.20, 1], 0.50, 0.30),
    "vehicle_vehglass": ([0.10, 0.20, 0.30, 1], 0.10, 0.10),
    "vehicle_lightsemissive": ([0.90, 0.88, 0.70, 1], 0.20, 0.0),
    "vehicle_tire": ([0.05, 0.05, 0.05, 1], 0.90, 0.0),
    "vehicle_interior2": ([0.45, 0.20, 0.20, 1], 0.80, 0.0),
    "vehicle_dash_emissive": ([0.80, 0.30, 0.15, 1], 0.40, 0.0),
}
DEFAULT_INSPECT_COLOUR = ([0.55, 0.55, 0.58, 1], 0.7, 0.0)


def stage_inspect(archive: Path, out_dir: Path):
    """Export the source at full density, nothing dropped, one object per part.

    This is the file to open in Blender before deciding anything: every bone
    group of the skinned body is its own object, named `<bone>__<shader>`, and
    the wheel sits on its front-left mount. `parts.md` beside it lists what each
    object weighs and what the importer currently does with it, so the keep /
    merge / drop decisions are made by looking rather than by guessing bone names.
    """
    data, member = find_yft(archive)
    res = Resource(data, len(data))
    print(f"{member}: {len(data) / 1e6:.1f} MB inflated")
    geoms, skeleton = read_models(res, res.u64(0x30))
    names = [b["name"] for b in skeleton]

    chunks: dict[str, list] = collections.defaultdict(list)
    meta: dict[str, dict] = {}
    for g in geoms:
        bones = g["bone"] if g["bone"] is not None else np.full(len(g["position"]), g["model_bone"])
        tri_bone = bones[g["indices"][:, 0]]
        for bone in np.unique(tri_bone):
            tris = g["indices"][tri_bone == bone]
            bone_name = names[bone] if bone < len(names) else f"bone{bone}"
            # Some bones in this pack are a name repeated eight times over.
            short = bone_name.split(".")[0][:28]
            key = f"{bone:02d}_{short}__{g['shader'].replace('vehicle_', '')}"
            used = np.unique(tris)
            remap = np.zeros(len(g["position"]), np.int64)
            remap[used] = np.arange(len(used))
            chunks[key].append(
                (to_game_axes(g["position"][used]), to_game_axes(g["normal"][used]), remap[tris])
            )
            centroid_y = float(g["position"][used][:, 1].mean())
            meta.setdefault(key, {"bone": bone_name, "shader": g["shader"],
                                  "role": classify(bone_name, g["shader"], centroid_y)})

    parts = {}
    for key, group in chunks.items():
        part = merge(group)
        part["material"] = meta[key]["shader"]
        part["mesh_name"] = key
        parts[key] = part

    children = read_children(res)
    wheel_bone = next(b for b in skeleton if b["name"] == "wheel_lf")
    wgeoms, _ = read_models(res, children.get(wheel_bone["tag"], 0))
    if wgeoms:
        wheel = merge([(to_game_axes(g["position"]), to_game_axes(g["normal"]), g["indices"]) for g in wgeoms])
        wheel["material"] = "vehicle_tire"
        wheel["mesh_name"] = "wheel_lf__tire"
        parts["wheel_lf__tire"] = wheel
        meta["wheel_lf__tire"] = {"bone": "wheel_lf", "shader": "vehicle_tire", "role": "wheel"}

    palette = dict(INSPECT_COLOURS)
    for key in parts:
        palette.setdefault(parts[key]["material"], DEFAULT_INSPECT_COLOUR)

    mount = to_game_axes(wheel_bone["translation"][None])[0].tolist()
    nodes = [
        {"name": key, "role": key,
         "translation": mount if key == "wheel_lf__tire" else None}
        for key in parts
    ]
    out_dir.mkdir(parents=True, exist_ok=True)
    write_glb(out_dir / "vaz2110-source.glb", parts, nodes, materials=palette)

    rows = []
    for key, part in parts.items():
        lo = part["position"].min(0)
        hi = part["position"].max(0)
        role = meta[key]["role"]
        rows.append((len(part["indices"]), key, meta[key]["shader"], role or "DROPPED",
                     f"x[{lo[0]:+.2f},{hi[0]:+.2f}] y[{lo[1]:+.2f},{hi[1]:+.2f}] z[{lo[2]:+.2f},{hi[2]:+.2f}]"))
    rows.sort(reverse=True)
    lines = [
        "# Source parts, full density",
        "",
        f"`{member}` -> `vaz2110-source.glb`. Axes are the game's: nose +Z, up +Y, left +X.",
        "",
        "`now` is what `tools/import-yft-vehicle.py extract` currently does with the part.",
        "",
        "| tris | object | shader | now | bounds (m, model units) |",
        "| ---: | --- | --- | --- | --- |",
    ]
    lines += [f"| {n} | `{k}` | {s} | {r} | {b} |" for n, k, s, r, b in rows]
    total = sum(r[0] for r in rows)
    lines += ["", f"{len(rows)} objects, {total} triangles."]
    (out_dir / "parts.md").write_text("\n".join(lines) + "\n", encoding="utf8")
    print(f"  {len(parts)} objects, {total} triangles -> {out_dir / 'vaz2110-source.glb'}")


def stage_extract(archive: Path, out_dir: Path):
    data, member = find_yft(archive)
    system_size = len(data)  # graphics flags are zero for this resource class
    res = Resource(data, system_size)
    if res.b[:4] != b"FRAG":
        print(f"warning: root block magic {res.b[:4]!r}, expected FRAG", file=sys.stderr)
    print(f"{member}: {len(data) / 1e6:.1f} MB inflated, fragment {res.string(res.u64(0x58))}")

    geoms, skeleton = read_models(res, res.u64(0x30))
    names = [b["name"] for b in skeleton]
    roles: dict[str, list] = collections.defaultdict(list)
    stats = collections.Counter()
    for g in geoms:
        bones = g["bone"] if g["bone"] is not None else np.full(len(g["position"]), g["model_bone"])
        tri_bone = bones[g["indices"][:, 0]]
        for bone in np.unique(tri_bone):
            tris = g["indices"][tri_bone == bone]
            name = names[bone] if bone < len(names) else f"bone{bone}"
            centroid_y = float(g["position"][np.unique(tris)][:, 1].mean())
            role = classify(name, g["shader"], centroid_y)
            stats[(name, g["shader"], role)] += len(tris)
            if role is None:
                continue
            used = np.unique(tris)
            remap = np.zeros(len(g["position"]), np.int64)
            remap[used] = np.arange(len(used))
            roles[role].append((to_game_axes(g["position"][used]), to_game_axes(g["normal"][used]), remap[tris]))

    parts = {role: merge(chunks) for role, chunks in roles.items()}
    for role, part in sorted(parts.items()):
        print(f"  {role:12s} {len(part['position']):7d} verts {len(part['indices']):7d} tris")
    dropped = sum(n for (_, _, role), n in stats.items() if role is None)
    print(f"  dropped {dropped} triangles (interior, engine, damage-only, neon)")

    write_glb(out_dir / "body.glb", parts, [
        {"name": NODE_CONTRACT[r][0], "role": r} for r in parts
    ])

    children = read_children(res)
    wheel_bone = next(b for b in skeleton if b["name"] == "wheel_lf")
    wheel_ptr = children.get(wheel_bone["tag"])
    wgeoms, _ = read_models(res, wheel_ptr) if wheel_ptr else ([], [])
    if not wgeoms:
        raise SystemExit("no wheel drawable in the fragment's physics children")
    wheel = merge([(to_game_axes(g["position"]), to_game_axes(g["normal"]), g["indices"]) for g in wgeoms])
    print(f"  wheel        {len(wheel['position']):7d} verts {len(wheel['indices']):7d} tris")
    write_glb(out_dir / "wheel.glb", {"wheel": wheel}, [{"name": "wheel", "role": "wheel"}])

    corners = {n: next(b["translation"] for b in skeleton if b["name"] == n)
               for n in ("wheel_lf", "wheel_rf", "wheel_lr", "wheel_rr")}
    mounts = {k: to_game_axes(v[None])[0].tolist() for k, v in corners.items()}
    (out_dir / "mounts.json").write_text(json.dumps(mounts, indent=2))
    wheelbase = float(corners["wheel_lf"][1] - corners["wheel_lr"][1])
    track = float(corners["wheel_rf"][0] - corners["wheel_lf"][0])
    print(f"  wheelbase {wheelbase:.3f}, front track {track:.3f} (model units)")


def _read_glb(path: Path):
    raw = path.read_bytes()
    json_len = struct.unpack_from("<I", raw, 12)[0]
    doc = json.loads(raw[20 : 20 + json_len])
    bin_off = 20 + json_len + 8
    blob = raw[bin_off:]
    out = {}
    for node in doc["nodes"]:
        prim = doc["meshes"][node["mesh"]]["primitives"][0]

        def read(acc_index):
            acc = doc["accessors"][acc_index]
            view = doc["bufferViews"][acc["bufferView"]]
            dtype = np.dtype({5126: "<f4", 5125: "<u4", 5123: "<u2"}[acc["componentType"]])
            width = 3 if acc["type"] == "VEC3" else 1
            start = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
            # gltf-transform writes interleaved vertex buffers by default, so an
            # accessor's elements are strided through the view, not contiguous.
            stride = view.get("byteStride") or width * dtype.itemsize
            raw_bytes = np.frombuffer(blob, np.uint8, (acc["count"] - 1) * stride + width * dtype.itemsize, start)
            elements = np.lib.stride_tricks.as_strided(
                raw_bytes, shape=(acc["count"], width * dtype.itemsize), strides=(stride, 1)
            )
            arr = np.ascontiguousarray(elements).view(dtype).reshape(acc["count"], width)
            return arr if acc["type"] == "VEC3" else arr.ravel()

        out[node["name"]] = {
            "position": read(prim["attributes"]["POSITION"]).astype(np.float64),
            "normal": read(prim["attributes"]["NORMAL"]).astype(np.float64),
            "indices": read(prim["indices"]).reshape(-1, 3).astype(np.int64),
        }
    return out


def stage_assemble(build_dir: Path, out_path: Path):
    body = _read_glb(build_dir / "body-lod.glb")
    wheel = _read_glb(build_dir / "wheel-lod.glb")["wheel"]
    mounts = json.loads((build_dir / "mounts.json").read_text())

    role_of = {node: role for role, (node, _, _) in NODE_CONTRACT.items()}
    parts = {role_of[name]: part for name, part in body.items()}
    parts["wheel"] = wheel

    # A right-hand wheel is the left one turned half a turn about the vertical
    # axis, never a mirror: a negative scale reverses winding and normals.
    half_turn = [0.0, 1.0, 0.0, 0.0]
    nodes = [{"name": name, "role": role_of[name]} for name in body]
    for corner, source in (("fl", "wheel_lf"), ("fr", "wheel_rf"), ("rl", "wheel_lr"), ("rr", "wheel_rr")):
        nodes.append({
            "name": f"wheel_{corner}",
            "role": "wheel",
            "translation": mounts[source],
            "rotation": half_turn if corner in ("fr", "rr") else None,
        })
    write_glb(out_path, parts, nodes)
    total = sum(len(p["indices"]) for p in parts.values()) + 3 * len(wheel["indices"])
    print(f"{out_path}: {len(nodes)} nodes, {total} triangles including four wheels")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="stage", required=True)
    i = sub.add_parser("inspect")
    i.add_argument("archive", type=Path)
    i.add_argument("out_dir", type=Path)
    e = sub.add_parser("extract")
    e.add_argument("archive", type=Path)
    e.add_argument("out_dir", type=Path)
    a = sub.add_parser("assemble")
    a.add_argument("build_dir", type=Path)
    a.add_argument("out_path", type=Path)
    args = ap.parse_args()
    if args.stage == "inspect":
        stage_inspect(args.archive, args.out_dir)
    elif args.stage == "extract":
        stage_extract(args.archive, args.out_dir)
    else:
        stage_assemble(args.build_dir, args.out_path)


if __name__ == "__main__":
    main()
