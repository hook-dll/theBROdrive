"""Minimal binary FBX reader: GlobalSettings and per-Model transform properties.

Blender's importer bakes axis conversion and unit scale into the objects, so the
census also reads the raw file to record what the pack actually stores. Only the
node tree and property values are decoded; geometry arrays are skipped unless
they are needed (they are read lazily by name for Model transforms only).
"""

import struct
import zlib

_HEADER_MAGIC = b"Kaydara FBX Binary  \x00"


def _read_array(buf, pos, kind):
    length, encoding, comp_len = struct.unpack_from("<III", buf, pos)
    pos += 12
    raw = buf[pos:pos + comp_len]
    if encoding == 1:
        raw = zlib.decompress(raw)
    fmt = {"f": "f", "d": "d", "l": "q", "i": "i", "b": "b"}[kind]
    size = struct.calcsize(fmt)
    count = length
    return list(struct.unpack_from("<%d%s" % (count, fmt), raw, 0)) if count * size <= len(raw) else [], pos + comp_len


def _read_props(buf, pos, count):
    values = []
    for _ in range(count):
        kind = chr(buf[pos])
        pos += 1
        if kind == "Y":
            values.append(struct.unpack_from("<h", buf, pos)[0]); pos += 2
        elif kind == "C":
            values.append(buf[pos]); pos += 1
        elif kind == "I":
            values.append(struct.unpack_from("<i", buf, pos)[0]); pos += 4
        elif kind == "F":
            values.append(struct.unpack_from("<f", buf, pos)[0]); pos += 4
        elif kind == "D":
            values.append(struct.unpack_from("<d", buf, pos)[0]); pos += 8
        elif kind == "L":
            values.append(struct.unpack_from("<q", buf, pos)[0]); pos += 8
        elif kind in "fdlib":
            arr, pos = _read_array(buf, pos, kind)
            values.append(arr)
        elif kind in "SR":
            length = struct.unpack_from("<I", buf, pos)[0]
            if kind == "S":
                values.append(buf[pos + 4:pos + 4 + length].decode("latin1"))
            else:
                values.append(None)
            pos += 4 + length
        else:
            raise ValueError("unknown FBX property type %r" % kind)
    return values, pos


def _records(buf, pos, version, top=False):
    header = 25 if version >= 7500 else 13
    out = []
    while pos + header <= len(buf):
        if version >= 7500:
            end, n_props, prop_len = struct.unpack_from("<QQQ", buf, pos)
            p = pos + 24
        else:
            end, n_props, prop_len = struct.unpack_from("<III", buf, pos)
            p = pos + 12
        name_len = buf[p]
        if end == 0 and n_props == 0 and prop_len == 0 and name_len == 0:
            return out, pos + header
        if top and (end > len(buf) or name_len > 100):
            return out, pos
        name = buf[p + 1:p + 1 + name_len].decode("latin1")
        p += 1 + name_len
        props, _ = _read_props(buf, p, n_props)
        children = []
        if end > p + prop_len:
            children, _ = _records(buf, p + prop_len, version)
        out.append({"name": name, "props": props, "children": children})
        pos = end
        if top and pos >= len(buf):
            break
    return out, pos


def read_tree(path):
    with open(path, "rb") as fh:
        buf = fh.read()
    if not buf.startswith(_HEADER_MAGIC):
        raise ValueError("%s is not a binary FBX file" % path)
    version = struct.unpack_from("<I", buf, 23)[0]
    nodes, _ = _records(buf, 27, version, top=True)
    return version, nodes


def _find(nodes, name):
    return [n for n in nodes if n["name"] == name]


def read_header(path):
    """Returns the pack-relevant header: axes, unit scale, creator and per-Model Lcl values."""
    version, top = read_tree(path)
    info = {"fbx_version": version, "creator": None}
    for header in _find(top, "FBXHeaderExtension"):
        for node in _find(header["children"], "Creator"):
            info["creator"] = node["props"][0] if node["props"] else None
    for settings in _find(top, "GlobalSettings"):
        for prop in _find(settings["children"], "Properties70"):
            for p in _find(prop["children"], "P"):
                key = p["props"][0]
                if key in ("UpAxis", "UpAxisSign", "FrontAxis", "FrontAxisSign", "CoordAxis", "CoordAxisSign", "UnitScaleFactor"):
                    info[key] = p["props"][4]
    models = []
    for objects in _find(top, "Objects"):
        for model in _find(objects["children"], "Model"):
            name = model["props"][1].split("\x00")[0] if len(model["props"]) > 1 else "?"
            kind = model["props"][2] if len(model["props"]) > 2 else "?"
            lcl = {}
            for prop in _find(model["children"], "Properties70"):
                for p in _find(prop["children"], "P"):
                    key = p["props"][0]
                    if key in ("Lcl Translation", "Lcl Rotation", "Lcl Scaling", "PreRotation", "PostRotation", "RotationOrder"):
                        lcl[key] = p["props"][4:]
            models.append({"name": name, "type": kind, "lcl": lcl})
    info["models"] = models
    return info
