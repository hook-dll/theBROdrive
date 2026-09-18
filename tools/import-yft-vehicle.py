#!/usr/bin/env python3
"""
tools/import-yft-vehicle.py -- GTA V add-on vehicle (.rpf -> .yft) to runtime GLB.

Reads an RPF7 archive directly: no CodeWalker, no .NET, no Blender. The archive's
nested vehicles.rpf holds one RSC7 resource per vehicle; the .yft is a fragment
whose main drawable carries the whole body as ONE skinned mesh, and whose physics
LOD children carry the single wheel the game instances at four corners.

The production path has three steps:

  extract   dlc.rpf            -> build/<name>/{body,wheel}.glb
  Blender lamp cut             -> build/<name>/body-lamps.glb
  assemble  build/<name>/*.glb -> one GLB with the runtime node/material contract

`tools/split-vaz2110-lamps.py` is the authored boundary between normalization and
assembly. It physically divides the source's two combined lamp meshes into the
independently controlled factory sections.

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
import re
import struct
import sys
import zlib
from pathlib import Path
from typing import NamedTuple

import numpy as np

ROOT = Path(__file__).resolve().parents[1]

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
    """Load the source vehicle fragment.

    Three input shapes:

    - a directory holding a loose `Model/*.yft` (an AKROM-style mod pack,
      extracted from its archive but never repacked into an RPF);
    - a bare `.yft` file;
    - an RPF7 `dlc.rpf` with a nested `vehicles.rpf` (the original production
      path this tool was written for).

    A loose mod file needs no RPF at all: it is already RSC7-wrapped and
    zlib-deflated exactly as an RPF entry's bytes would be, and its own
    16-byte header carries the same system/graphics flags an RPF directory
    entry otherwise duplicates for fast access.
    """
    if path.is_dir():
        candidates = sorted(p for p in path.rglob("*.yft") if "_hi" not in p.stem.lower())
        if not candidates:
            raise SystemExit(f"no non-_hi .yft under {path}")
        if len(candidates) > 1:
            names = ", ".join(str(c) for c in candidates)
            raise SystemExit(f"{len(candidates)} candidate .yft files under {path}, pass the exact file: {names}")
        path = candidates[0]

    if path.suffix.lower() == ".yft":
        raw = path.read_bytes()
        if raw[:4] != b"RSC7":
            raise SystemExit(f"{path}: not an RSC7 resource")
        _, sys_flags, gfx_flags = struct.unpack_from("<3I", raw, 4)
        system_size = size_from_flags(sys_flags)
        data = zlib.decompressobj(-15).decompress(raw[16:])
        expect = system_size + size_from_flags(gfx_flags)
        if len(data) != expect:
            raise SystemExit(f"inflated {len(data)} bytes, flags claim {expect}")
        return data, path.name

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
    if len(yfts) > 1:
        names = ", ".join(yfts)
        raise SystemExit(f"{len(yfts)} candidate .yft entries, pass the exact archive: {names}")
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


class Profile(NamedTuple):
    """Everything about classification that is specific to one donor YFT.

    Bone names come straight from the modder's own DCC scene, so they carry
    no meaning across packs -- two AKROM cars sharing a Russian word like
    "torpeda" is a coincidence of authoring habit, not a contract. Every new
    donor gets its own entry, built from a `stage_inspect` pass.
    """

    model_id: str
    #: Bones whose triangles never ship: cabin, engine bay, damage-only and
    #: neon geometry. The body is one skinned mesh, so this is the only
    #: handle on them.
    drop_bones: frozenset[str]
    #: Lamp lenses authored as glass. Leaving them in `car_glass` would put a
    #: translucent sheet in front of the emissive lens, which then lights
    #: invisibly.
    front_lens_bones: frozenset[str] = frozenset()
    rear_lens_bones: frozenset[str] = frozenset()
    #: Explicit bone -> `NODE_CONTRACT` role for packs that already separate
    #: lamp functions into named bones (`indicator_lf`, `brakelight_r`, ...).
    #: Checked before `front_lens_bones`/`rear_lens_bones`/the shader-based
    #: front/rear split, and applies to every shader a matching bone carries
    #: -- a lamp bone's own glass-shader triangles (a lens modelled as
    #: "glass") get the same semantic role as its emissive triangles, so
    #: nothing translucent is left sitting in front of the lit lens.
    lamp_roles: dict[str, str] = {}
    #: A lamp mesh this far from the car's centre plane is a headlamp or a
    #: tail lamp; anything between is a side repeater or a courtesy light.
    lamp_split_y: float = 0.5
    #: Opt-in per-donor size cutoff for `lamp_bone_role`: a (bone, shader)
    #: triangle group past this bounding-box diagonal, in metres, is treated
    #: as a foreign object weighted to the lamp bone by mistake rather than
    #: part of the lamp, and routed through ordinary shader-based
    #: classification instead. Left unset by default -- this pack has no
    #: single scale a lamp part stays under (a genuine truck indicator lens
    #: measures bigger than a confirmed foreign object on a compact car) --
    #: and set only for a donor where a specific oversized island has
    #: already been confirmed foreign by inspection.
    foreign_lamp_diagonal_m: float | None = None


# Each donor's classification lives in its own `tools/vehicle_profiles/<id>.json`
# (schema: model_id, drop_bones, front_lens_bones, rear_lens_bones, lamp_roles,
# lamp_split_y) rather than one shared table, so adding a car never touches this
# file or collides with another car's edit to it.
PROFILES_DIR = ROOT / "tools" / "vehicle_profiles"


def _load_profiles() -> dict[str, Profile]:
    profiles: dict[str, Profile] = {}
    if not PROFILES_DIR.is_dir():
        return profiles
    for path in sorted(PROFILES_DIR.glob("*.json")):
        raw = json.loads(path.read_text(encoding="utf8"))
        model_id = raw["model_id"]
        if model_id != path.stem:
            raise SystemExit(f"{path}: model_id {model_id!r} does not match filename")
        profiles[model_id] = Profile(
            model_id=model_id,
            drop_bones=frozenset(raw.get("drop_bones", ())),
            front_lens_bones=frozenset(raw.get("front_lens_bones", ())),
            rear_lens_bones=frozenset(raw.get("rear_lens_bones", ())),
            lamp_roles=dict(raw.get("lamp_roles", {})),
            lamp_split_y=float(raw.get("lamp_split_y", 0.5)),
            foreign_lamp_diagonal_m=(
                float(raw["foreign_lamp_diagonal_m"]) if "foreign_lamp_diagonal_m" in raw else None
            ),
        )
    return profiles


PROFILES: dict[str, Profile] = _load_profiles()

def profile_for(model_id: str) -> Profile:
    """A curated profile if one exists, otherwise an empty one for a first
    `stage_inspect` pass: bone-name drops are opt-in, so an unknown model
    starts by keeping everything the shader table alone would keep."""
    return PROFILES.get(model_id, Profile(model_id=model_id, drop_bones=frozenset()))


# Cabin surface materials: seat cloth, dash plastic, gauge-cluster backlight.
# All of it sits behind glass with no interior camera in this runtime, so it
# was previously dropped outright to save triangles. Kept now, routed to its
# own `interior` role rather than folded into `car_trim`: `buildTemplate` in
# carmodel.ts needs to find and exclude it by node name from the sweeps that
# assume every mesh in the scene is exterior bodywork.
SHADER_ROLE = {
    "vehicle_paint1": "car_paint", "vehicle_paint2": "car_paint",
    "vehicle_paint3": "car_paint", "vehicle_paint4": "car_paint",
    "vehicle_mesh": "car_trim", "vehicle_mesh_enveff": "car_trim",
    "vehicle_detail": "car_trim", "vehicle_detail2": "car_trim",
    "vehicle_badges": "car_trim", "vehicle_shuts": "car_trim",
    "vehicle_generic": "car_trim", "vehicle_tire": "car_trim",
    "vehicle_vehglass": "car_glass", "vehicle_vehglass_inner": "car_glass",
    "vehicle_lightsemissive": "lamp", "vehicle_lights": "lamp",
    "vehicle_interior": "interior", "vehicle_interior2": "interior",
    "vehicle_dash_emissive": "interior", "vehicle_dash_emissive_opaque": "interior",
    "vehicle_cloth": "interior", "vehicle_cloth2": "interior",
}

# Cabin bones named individually per donor in `drop_bones` (steering wheel,
# gauge cluster, seats, the cabin shell itself): same reasoning as
# `SHADER_ROLE` above, checked before `profile.drop_bones` so a donor's
# per-car drop list does not have to be hand-edited to stop cutting them.
# Everything else still named in `drop_bones` -- duplicate/low-LOD chassis,
# alternate-drivetrain transmission tunnels, GTA "extras" attachment slots,
# damage-state decals -- keeps being cut: those really do overlap or
# contradict the geometry that ships, not just add invisible triangles.
SAFE_INTERIOR_RE = re.compile(
    r"^(z_salon|steeringwheel|dials|z_pribory(_night)?|z_panel_plastik|"
    r"seat_(d|p)side_(f|r))$",
    re.I,
)


def _shader_role(profile: Profile, bone_name: str, shader: str, centroid_y: float) -> str | None:
    """Role a shader alone implies, ignoring any bone-name override. Shared by
    `classify` (for bones with no override) and by the lamp-contamination
    fallback below (for the part of a lamp bone that turns out not to be a
    lamp at all)."""
    role = SHADER_ROLE.get(shader, "car_trim")
    if role is None:
        return None
    if role == "car_glass":
        if bone_name in profile.front_lens_bones:
            return "headlights"
        if bone_name in profile.rear_lens_bones:
            return "taillights"
        return "car_glass"
    if role == "lamp":
        if centroid_y > profile.lamp_split_y:
            return "headlights"
        if centroid_y < -profile.lamp_split_y:
            return "taillights"
        return "car_trim"
    return role


# A few donors also reuse `lamp_roles` as a general per-bone override for
# something that plainly is not a lamp at all (mapped straight to
# "car_trim") -- that use predates this filter and is unrelated to it, so it
# is excluded here by name rather than swept up by an unqualified "any
# lamp_roles bone" check.
LAMP_ROLE_NAMES = frozenset({
    "headlights", "front_blinker_left", "front_blinker_right", "front_auxiliary",
    "taillights", "brake_lights", "reverse_lights", "rear_blinker_left",
    "rear_blinker_right", "rear_passive",
})

# A donor's own bone hierarchy sometimes puts a whole unrelated part on a
# bone the profile maps to a lamp role -- a spare tire, a roof rack -- simply
# because that is where the rigger's skeleton happened to have a slot.
# `vehicle_tire` shader is never legitimate anywhere near a lamp (every
# appearance found on this pack's lamp bones turned out to be a duplicate
# spare wheel) and is checked unconditionally. A size cutoff catches
# everything else, but this pack's lamp parts do not share one scale -- a
# genuine ZIL-130 truck indicator lens measured bigger than the largest
# confirmed foreign object on a compact car -- so it is opt-in per donor via
# `Profile.foreign_lamp_diagonal_m` rather than one pack-wide constant.
# Either tell routes that specific (bone, shader) triangle group through the
# ordinary shader-based role instead of the bone's assigned lamp role.
def lamp_bone_role(
    profile: Profile, bone_name: str, shader: str, centroid_y: float, positions: np.ndarray
) -> str | None:
    if shader == "vehicle_tire":
        return _shader_role(profile, bone_name, shader, centroid_y)
    if profile.foreign_lamp_diagonal_m is not None:
        diagonal = float(np.linalg.norm(positions.max(0) - positions.min(0)))
        if diagonal > profile.foreign_lamp_diagonal_m:
            return _shader_role(profile, bone_name, shader, centroid_y)
    return profile.lamp_roles[bone_name]


def classify(profile: Profile, bone_name: str, shader: str, centroid_y: float) -> str | None:
    safe_interior = SAFE_INTERIOR_RE.match(bone_name)
    if bone_name in profile.drop_bones and not safe_interior:
        return None
    if bone_name in profile.lamp_roles:
        return profile.lamp_roles[bone_name]
    # Every triangle on a safe-interior bone goes to `interior`, not just the
    # ones whose own shader happens to be one of the cabin materials -- a
    # steering wheel's metal column is `vehicle_mesh` (the same shader as
    # exterior trim), and left to shader-only routing it lands in `car_trim`,
    # which is exactly the node the exterior-shell sweeps in carmodel.ts do
    # not exclude.
    if safe_interior:
        return "interior"
    return _shader_role(profile, bone_name, shader, centroid_y)


def _connected_components(positions: np.ndarray, tris: np.ndarray) -> list[np.ndarray]:
    """Split one bone's triangles (indexing `positions`) into island triangle arrays."""
    used = np.unique(tris)
    remap = np.zeros(len(positions), dtype=np.int64)
    remap[used] = np.arange(len(used))
    n = len(used)
    parent = np.arange(n)

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for t in tris:
        a, b, c = remap[t[0]], remap[t[1]], remap[t[2]]
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
        rb, rc = find(b), find(c)
        if rb != rc:
            parent[rb] = rc

    roots = np.array([find(i) for i in range(n)])
    vroot = np.full(len(positions), -1, dtype=np.int64)
    vroot[used] = roots
    tri_root = vroot[tris[:, 0]]
    return [tris[tri_root == r] for r in np.unique(roots)]


def route_hub_corners(corner_tris: dict[str, list[tuple[np.ndarray, np.ndarray, np.ndarray]]]):
    """Tell apart a hub cap from a rear coil spring/strut weighted to the same bone.

    Some AKROM donors weight the rear coil spring/strut to the same `hub_lr`/
    `hub_rr` bone as the visible hub cap, so a naive per-bone role assignment
    puts the spring in the same node as the cap -- which `CarModelDef.wheelNodes`
    then spins with the wheel. Shape heuristics (bounding-box aspect ratio, tri
    count) do not separate them reliably: the cap itself is built from dozens
    of small, genuinely thin, disconnected mechanical details (bolts, flanges)
    that read just as "elongated" as a spring under any such metric.

    What does separate them: the front hub on the same car carries no spring,
    but shares every other part of the cap assembly with the rear hub on the
    same side (identical islands, down to the exact triangle count -- these
    are mirrored/reused sub-parts, not independently authored per corner). So
    each rear island is matched against the front side's island sizes; islands
    with no size match on the front are the extra parts -- spring, strut,
    mounting bracket -- unique to the rear, and get routed to `car_trim`
    instead of the hub role so they stay fixed to the chassis.

    `corner_tris`: "fl"/"fr"/"rl"/"rr" -> list of (bone-matching triangles,
    that geom's positions, that geom's normals). Returns the same shape with
    each geom's triangles broken into islands, each tagged "hub" or "car_trim".
    """
    islands = {
        corner: [
            (len(tris), tris, pos, normal)
            for tri_group, pos, normal in items
            for tris in _connected_components(pos, tri_group)
        ]
        for corner, items in corner_tris.items()
    }

    def route_rear(front_key: str, rear_key: str):
        budget = collections.Counter(size for size, _, _, _ in islands.get(front_key, []))
        routed = []
        for size, tris, pos, normal in sorted(islands.get(rear_key, []), key=lambda c: -c[0]):
            if budget[size] > 0:
                budget[size] -= 1
                routed.append(("hub", tris, pos, normal))
            else:
                routed.append(("car_trim", tris, pos, normal))
        return routed

    return {
        "fl": [("hub", tris, pos, normal) for _, tris, pos, normal in islands.get("fl", [])],
        "fr": [("hub", tris, pos, normal) for _, tris, pos, normal in islands.get("fr", [])],
        "rl": route_rear("fl", "rl"),
        "rr": route_rear("fr", "rr"),
    }


# --------------------------------------------------------------- glTF writing

MATERIALS = {
    "car_paint": ([0.055, 0.15, 0.11, 1], 0.68, 0.08),
    "car_trim": ([0.035, 0.04, 0.045, 1], 0.82, 0.0),
    "car_glass": ([0.025, 0.045, 0.055, 1], 0.08, 0.10),
    "Headlights": ([0.72, 0.76, 0.74, 1], 0.18, 0.0),
    # sRGB #f26716 from the VAZ-2104 atlas, converted to glTF linear RGB.
    "IndicatorLights": ([0.887923, 0.135633, 0.008023, 1], 0.20, 0.0),
    "TailLights": ([0.24, 0.006, 0.003, 1], 0.28, 0.0),
    "BrakeLights": ([0.32, 0.008, 0.004, 1], 0.28, 0.0),
    "ReverseLights": ([0.78, 0.80, 0.76, 1], 0.20, 0.0),
    "PassiveRearLights": ([0.20, 0.005, 0.003, 1], 0.32, 0.0),
    "AuxiliaryLights": ([0.30, 0.32, 0.31, 1], 0.35, 0.0),
    "Tyres": ([0.018, 0.02, 0.022, 1], 0.94, 0.0),
}
# Runtime role -> (node name, mesh name, material).
NODE_CONTRACT = {
    "car_paint": ("chassisbody", "paint", "car_paint"),
    "car_trim": ("chassis_trim", "trim", "car_trim"),
    # Same material as car_trim (there is no dedicated cabin-plastic shader in
    # the runtime palette) but its own node: `buildTemplate` in carmodel.ts
    # pulls this node out before the shell-width/hood-skin sweeps that assume
    # "every mesh is exterior bodywork" and would otherwise measure a
    # steering wheel or gauge cluster as if it were part of the panel line.
    "interior": ("interior", "interior", "car_trim"),
    "car_glass": ("glass", "glass", "car_glass"),
    "headlights": ("headlights", "headlights", "Headlights"),
    "front_blinker_left": ("front_blinker_left", "front_blinker_left", "IndicatorLights"),
    "front_blinker_right": ("front_blinker_right", "front_blinker_right", "IndicatorLights"),
    "front_auxiliary": ("front_auxiliary", "front_auxiliary", "AuxiliaryLights"),
    "taillights": ("taillights", "taillights", "TailLights"),
    "brake_lights": ("brake_lights", "brake_lights", "BrakeLights"),
    "reverse_lights": ("reverse_lights", "reverse_lights", "ReverseLights"),
    "rear_blinker_left": ("rear_blinker_left", "rear_blinker_left", "IndicatorLights"),
    "rear_blinker_right": ("rear_blinker_right", "rear_blinker_right", "IndicatorLights"),
    "rear_passive": ("rear_passive", "rear_passive", "PassiveRearLights"),
    "wheel": ("wheel", "wheel", "Tyres"),
    "hub_fl": ("hub_fl", "hub_fl", "car_trim"),
    "hub_fr": ("hub_fr", "hub_fr", "car_trim"),
    "hub_rl": ("hub_rl", "hub_rl", "car_trim"),
    "hub_rr": ("hub_rr", "hub_rr", "car_trim"),
}

# Some packs (the GAZ-31029 donor among them) weight a visible hub/axle island
# to its own body-skin bone instead of folding it into the wheel drawable. Left
# in `car_trim` it stays fixed to the chassis while the wheel travels with
# suspension, so it is routed to its own runtime node and paired with its
# wheel via `CarModelDef.wheelNodes` instead of going through `classify`.
HUB_BONE_RE = re.compile(r"^hub_(lf|rf|lr|rr)$", re.I)
HUB_CORNER = {"lf": "fl", "rf": "fr", "lr": "rl", "rr": "rr"}


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


def stage_inspect(archive: Path, out_dir: Path, profile: Profile):
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
            hub_match = HUB_BONE_RE.match(bone_name)
            role = f"hub_{HUB_CORNER[hub_match.group(1).lower()]}" if hub_match else classify(profile, bone_name, g["shader"], centroid_y)
            meta.setdefault(key, {"bone": bone_name, "shader": g["shader"], "role": role})

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
    write_glb(out_dir / f"{profile.model_id}-source.glb", parts, nodes, materials=palette)

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
        f"`{member}` -> `{profile.model_id}-source.glb`. Axes are the game's: nose +Z, up +Y, left +X.",
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
    print(f"  {len(parts)} objects, {total} triangles -> {out_dir / f'{profile.model_id}-source.glb'}")


def stage_extract(archive: Path, out_dir: Path, profile: Profile):
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
    corner_tris: dict[str, list] = collections.defaultdict(list)

    for g in geoms:
        bones = g["bone"] if g["bone"] is not None else np.full(len(g["position"]), g["model_bone"])
        tri_bone = bones[g["indices"][:, 0]]

        def add_part(role: str, tri_subset: np.ndarray, position=g["position"], normal=g["normal"]) -> None:
            used = np.unique(tri_subset)
            remap = np.zeros(len(position), np.int64)
            remap[used] = np.arange(len(used))
            roles[role].append(
                (to_game_axes(position[used]), to_game_axes(normal[used]), remap[tri_subset])
            )

        for bone in np.unique(tri_bone):
            tris = g["indices"][tri_bone == bone]
            name = names[bone] if bone < len(names) else f"bone{bone}"
            hub_match = HUB_BONE_RE.match(name)
            if hub_match:
                corner = HUB_CORNER[hub_match.group(1).lower()]
                corner_tris[corner].append((tris, g["position"], g["normal"]))
                stats[(name, g["shader"], f"hub_{corner}")] += len(tris)
                continue
            centroid_y = float(g["position"][np.unique(tris)][:, 1].mean())
            if name in profile.lamp_roles and profile.lamp_roles[name] in LAMP_ROLE_NAMES:
                role = lamp_bone_role(profile, name, g["shader"], centroid_y, g["position"][np.unique(tris)])
            else:
                role = classify(profile, name, g["shader"], centroid_y)
            stats[(name, g["shader"], role)] += len(tris)
            if role is None:
                continue
            add_part(role, tris)

    for corner, islands in route_hub_corners(corner_tris).items():
        for target, tris, pos, normal in islands:
            role = f"hub_{corner}" if target == "hub" else "car_trim"
            used = np.unique(tris)
            remap = np.zeros(len(pos), np.int64)
            remap[used] = np.arange(len(used))
            roles[role].append((to_game_axes(pos[used]), to_game_axes(normal[used]), remap[tris]))
            if target != "hub":
                stats[(f"hub_{corner}", "?", "car_trim (spring/strut)")] += len(tris)

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
    body = _read_glb(build_dir / "body-lamps.glb")
    wheel = _read_glb(build_dir / "wheel-lod.glb")["wheel"]
    mounts = json.loads((build_dir / "mounts.json").read_text())

    role_of = {node: role for role, (node, _, _) in NODE_CONTRACT.items()}
    parts = {role_of[name]: part for name, part in body.items()}
    # A combined tail+brake cluster (no separate `brake_lights` node) is styled
    # with the brake-capable material so it reads as lit under braking; a split
    # cluster keeps `taillights` on its own always-on material. Mirrors the
    # same rule tools/dff-pack-audit.mjs checks for.
    if "brake_lights" not in parts and "taillights" in parts:
        parts["taillights"] = {**parts["taillights"], "material": "BrakeLights", "mesh_name": "taillights"}
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
    i.add_argument("--model", "-m", default="gt_vaz2110", help="profile id (see PROFILES); unknown ids drop nothing")
    e = sub.add_parser("extract")
    e.add_argument("archive", type=Path)
    e.add_argument("out_dir", type=Path)
    e.add_argument("--model", "-m", default="gt_vaz2110", help="profile id, must exist in PROFILES")
    a = sub.add_parser("assemble")
    a.add_argument("build_dir", type=Path)
    a.add_argument("out_path", type=Path)
    args = ap.parse_args()
    if args.stage == "inspect":
        stage_inspect(args.archive, args.out_dir, profile_for(args.model))
    elif args.stage == "extract":
        if args.model not in PROFILES:
            raise SystemExit(f"no curated profile for {args.model!r}; run `inspect` first and add one to PROFILES")
        stage_extract(args.archive, args.out_dir, PROFILES[args.model])
    else:
        stage_assemble(args.build_dir, args.out_path)


if __name__ == "__main__":
    main()
