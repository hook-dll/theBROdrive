"""Aggregate per-car study JSON into ranges across cars (plain Python, no Blender).

  python3 tools/carforge/study_summary.py [cars...]

Reads build/carforge/study/<car>.json, writes build/carforge/study/summary.json and prints a
table. Per-car numbers are kept; only min/median/max ranges are derived here.
"""

import json
import os
import statistics
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
STUDY = os.path.abspath(os.path.join(HERE, "..", "..", "build", "carforge", "study"))
DEFAULT = ["vz01", "vz08", "vz21", "gz24", "vz05r", "vz03"]


def load(car):
    with open(os.path.join(STUDY, f"{car}.json")) as f:
        return json.load(f)


def rng(vals):
    vals = [v for v in vals if v is not None]
    if not vals:
        return None
    return {"min": round(min(vals), 3), "median": round(statistics.median(vals), 3), "max": round(max(vals), 3)}


def car_row(d):
    ctx = d["body_ctx"]
    regs = d["regions"]
    by_label = {}
    for r in regs:
        by_label.setdefault(r["label"], []).append(r)
    area = {lab: round(sum(x["area_m2"] for x in rs), 3) for lab, rs in by_label.items()}
    count = {lab: len(rs) for lab, rs in by_label.items()}
    wheels = d["wheels"]
    arches = d["arches"]
    glass = d["glass_windows"]
    return {
        "car": d["file"].replace(".fbx", ""),
        "length_m": round(ctx["L"], 3),
        "width_m": round(2 * ctx["hw"], 3),
        "height_m": round(ctx["H"], 3),
        "beltline_frac": d["beltline_frac"],
        "beltline_m": d["beltline_m"],
        "topology": {k: d["topology"][k] for k in ("faces", "tris", "quads", "ngons", "boundary_edges", "nonmanifold_edges", "shells")},
        "mirror_err_p95_mm": d["mirror"].get("mirror_err_p95_mm"),
        "patch_count": d["patch_count"],
        "uv_range": d["uv_range"],
        "region_count": count,
        "region_area_m2": area,
        "glass": {
            "windows": len(glass),
            "by_label": {lab: sum(1 for g in glass if g["label"] == lab) for lab in sorted({g["label"] for g in glass})},
            "frame_cells": sorted({c for g in glass for c in g.get("frame_cells", {})}),
        },
        "wheels": [{"name": w["name"], "radius_mm": w["radius_mm"], "width_mm": w["width_mm"],
                    "centre_m": w["centre_m"], "cells": w["cells"]} for w in wheels],
        "arches": {"n": len(arches),
                   "open": sum(1 for a in arches if a.get("open_arch")),
                   "flare_mm": rng([a.get("flare_mm") for a in arches]),
                   "radius_over_tyre": rng([a.get("arch_radius_over_tyre") for a in arches])},
        "underbody": d["underbody"],
        "lamps": [{"name": l["name"], "size_mm": l["size_mm"], "tris": l["topology"]["tris"]} for l in d["lamps"]],
    }


def main():
    cars = sys.argv[1:] or DEFAULT
    rows = [car_row(load(c)) for c in cars]
    ranges = {
        "length_m": rng([r["length_m"] for r in rows]),
        "width_m": rng([r["width_m"] for r in rows]),
        "height_m": rng([r["height_m"] for r in rows]),
        "beltline_frac": rng([r["beltline_frac"] for r in rows]),
        "wheel_radius_mm": rng([w["radius_mm"] for r in rows for w in r["wheels"]]),
        "wheel_width_mm": rng([w["width_mm"] for r in rows for w in r["wheels"]]),
        "arch_flare_mm": rng([r["arches"]["flare_mm"]["median"] for r in rows if r["arches"]["flare_mm"]]),
        "arch_radius_over_tyre": rng([r["arches"]["radius_over_tyre"]["median"] for r in rows if r["arches"]["radius_over_tyre"]]),
    }
    out = {"cars": cars, "ranges": ranges, "rows": rows}
    os.makedirs(STUDY, exist_ok=True)
    with open(os.path.join(STUDY, "summary.json"), "w") as f:
        json.dump(out, f, indent=1)
    for r in rows:
        print(f"{r['car']:6s} L={r['length_m']} W={r['width_m']} H={r['height_m']} belt={r['beltline_frac']} "
              f"faces={r['topology']['faces']} tris={r['topology']['tris']} quads={r['topology']['quads']} "
              f"regions={sum(r['region_count'].values())} glass={r['glass']['windows']} "
              f"arches={r['arches']['n']} open={r['arches']['open']} flare={r['arches']['flare_mm']} "
              f"uv={r['uv_range']}")
        print("        counts", r["region_count"])
        print("        areas ", r["region_area_m2"])
        print("        wheels", [(w["radius_mm"], w["width_mm"]) for w in r["wheels"]])
    print("RANGES", json.dumps(ranges))


if __name__ == "__main__":
    main()
