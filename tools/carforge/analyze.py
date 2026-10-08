"""Census of Soviet-pack-style car FBX files (run inside Blender, headless).

    blender -b --factory-startup --python tools/carforge/analyze.py -- \
        --src public/models/soviet --out build/carforge/census
    blender ... -- --files build/carforge/generated/vz01.fbx --out build/carforge/reimport

Writes <out>/census.json (everything, including per-station loops) and
<out>/census.md (tables). Frame reported is Blender world after the FBX import:
X = car width (+X is the car's LEFT, fl wheels sit at +X), Y = length (front is
-Y, headlamps are the most negative Y), Z = up, metres. Raw FBX values are
centimetres via Lcl Scaling 100; the raw header is read too (fbxheader.py).
"""

import argparse
import glob
import json
import math
import os
import re
import statistics
import sys
from collections import Counter, defaultdict

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fbxheader  # noqa: E402

ATLAS_COLUMNS = 9  # cells across the 9x2 swatch atlas; raw FBX UV spans [0, 1)
ATLAS_ROWS = 2
UV_SPAN = 1.0  # src/render/carmodel.ts uvCellOf sums 3 corners then /3: effective floor(avg_uv * cells)
GLASS_CELL = (3, 1)  # src/vehicle/carmodels.ts glassUvCell for every Soviet body
STATIONS = 12

# Body paint swatch the game recolours (src/vehicle/carmodels.ts SOVIET_PAINT_CELLS).
GAME_PAINT_CELL = {
    "gz21": (8, 1), "gz24": (1, 0), "vz01": (0, 0), "vz02": (7, 0), "vz03": (4, 0),
    "vz04": (8, 1), "vz05": (1, 0), "vz05r": (7, 0), "vz06": (0, 0), "vz07": (2, 0),
    "vz08": (8, 1), "vz09": (4, 0), "vz099": (6, 0), "vz21": (7, 0), "vz31": (0, 0),
}

LAMP_ROLES = ("headlights", "taillights", "reverselights", "leftblinkers", "rightblinkers",
              "frontleftblinker", "frontrightblinker", "rearleftblinker", "rearrightblinker")


def cell_of(u, v):
    col = min(ATLAS_COLUMNS - 1, max(0, math.floor(u / UV_SPAN * ATLAS_COLUMNS)))
    row = min(ATLAS_ROWS - 1, max(0, math.floor(v / UV_SPAN * ATLAS_ROWS)))
    return (col, row)


def reset_scene(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=path)


def face_cells(me):
    """Per polygon: atlas cell from the UV centroid, or None when the mesh has no UVs."""
    if not me.uv_layers:
        return [None] * len(me.polygons)
    uv = me.uv_layers.active.data
    out = []
    for poly in me.polygons:
        su = sv = 0.0
        for li in poly.loop_indices:
            su += uv[li].uv.x
            sv += uv[li].uv.y
        n = len(poly.loop_indices)
        out.append(cell_of(su / n, sv / n))
    return out


def tri_count(me):
    return sum(len(p.vertices) - 2 for p in me.polygons)


def section(me, mw, y):
    """Ordered closed loops where the plane Y = y cuts the mesh, world space."""
    vw = [mw @ v.co for v in me.vertices]
    d = [p.y - y for p in vw]
    edge_index = {}
    for e in me.edges:
        edge_index[tuple(sorted(e.vertices))] = e.index
    cross = {}
    for e in me.edges:
        a, b = e.vertices
        if (d[a] >= 0) != (d[b] >= 0):
            t = d[a] / (d[a] - d[b])
            cross[e.index] = vw[a].lerp(vw[b], t)
    adj = defaultdict(list)
    for poly in me.polygons:
        hits = []
        verts = list(poly.vertices)
        for i in range(len(verts)):
            key = tuple(sorted((verts[i], verts[(i + 1) % len(verts)])))
            ei = edge_index.get(key)
            if ei is not None and ei in cross:
                hits.append(ei)
        for i in range(0, len(hits) - 1, 2):
            adj[hits[i]].append(hits[i + 1])
            adj[hits[i + 1]].append(hits[i])
    loops, open_chains = [], 0
    seen = set()
    for start in list(adj.keys()):
        if start in seen:
            continue
        # walk one connected component; closed iff every node has degree 2
        comp, stack = [], [start]
        seen.add(start)
        while stack:
            n = stack.pop()
            comp.append(n)
            for m in adj[n]:
                if m not in seen:
                    seen.add(m)
                    stack.append(m)
        if all(len(adj[n]) == 2 for n in comp):
            order, prev, cur = [], None, start
            while True:
                order.append(cross[cur])
                nxt = [m for m in adj[cur] if m != prev] or adj[cur]
                prev, cur = cur, nxt[0]
                if cur == start or len(order) > len(comp) + 2:
                    break
            loops.append(order)
        else:
            open_chains += 1
    return loops, open_chains


def loop_perimeter(pts):
    return sum((pts[i] - pts[(i + 1) % len(pts)]).length for i in range(len(pts)))


def mirror_error(pts):
    """Largest distance from a point with x > 0 to the nearest point of the mirrored loop (metres)."""
    worst = 0.0
    for p in pts:
        if p.x <= 1e-4:
            continue
        mirror = Vector((-p.x, p.y, p.z))
        worst = max(worst, min((q - mirror).length for q in pts))
    return worst


def analyse_body(obj):
    me = obj.data
    mw = obj.matrix_world
    ymin = min((mw @ v.co).y for v in me.vertices)
    ymax = max((mw @ v.co).y for v in me.vertices)
    stations = []
    for i in range(STATIONS):
        y = ymin + (ymax - ymin) * (i + 0.5) / STATIONS
        loops, opened = section(me, mw, y)
        loops.sort(key=loop_perimeter, reverse=True)
        outer = loops[0] if loops else []
        rec = {
            "index": i,
            "y_mm": round(y * 1000, 1),
            "loops": len(loops),
            "open_chains": opened,
            "loop_points": [len(l) for l in loops],
        }
        if outer:
            xs = [p.x for p in outer]
            zs = [p.z for p in outer]
            zmax = max(zs)
            zmin = min(zs)
            top_band = [abs(p.x) for p in outer if p.z >= zmax - 0.25 * (zmax - zmin)]
            widest = max(outer, key=lambda p: abs(p.x))
            rec.update({
                "half_width_mm": round(max(abs(x) for x in xs) * 1000, 1),
                "z_min_mm": round(zmin * 1000, 1),
                "z_max_mm": round(zmax * 1000, 1),
                "z_at_widest_mm": round(widest.z * 1000, 1),
                "top_half_width_mm": round(max(top_band) * 1000, 1),
                "perimeter_mm": round(loop_perimeter(outer) * 1000, 1),
                "mirror_error_mm": round(mirror_error(outer) * 1000, 2),
                "profile_mm": [[round(p.x * 1000, 1), round(p.z * 1000, 1)] for p in outer],
            })
        stations.append(rec)
    return stations


def edge_stats(me):
    faces_per_edge = Counter()
    for poly in me.polygons:
        for k in poly.edge_keys:
            faces_per_edge[tuple(sorted(k))] += 1
    boundary = sum(1 for c in faces_per_edge.values() if c == 1)
    nonmanifold = sum(1 for c in faces_per_edge.values() if c > 2)
    return {"edges": len(faces_per_edge), "boundary_edges": boundary, "nonmanifold_edges": nonmanifold}


def object_record(obj):
    rec = {
        "name": obj.name,
        "type": obj.type,
        "parent": obj.parent.name if obj.parent else None,
        "location_m": [round(c, 5) for c in obj.location],
        "rotation_euler_rad": [round(c, 5) for c in obj.rotation_euler],
        "scale": [round(c, 5) for c in obj.scale],
    }
    if obj.type != "MESH":
        return rec
    me = obj.data
    mw = obj.matrix_world
    world = [mw @ v.co for v in me.vertices]
    lo = Vector((min(p.x for p in world), min(p.y for p in world), min(p.z for p in world)))
    hi = Vector((max(p.x for p in world), max(p.y for p in world), max(p.z for p in world)))
    quads = sum(1 for p in me.polygons if len(p.vertices) == 4)
    ngons = sum(1 for p in me.polygons if len(p.vertices) > 4)
    cells = face_cells(me)
    hist = Counter(f"{c[0]},{c[1]}" for c in cells if c is not None)
    uvs = [d.uv for d in me.uv_layers.active.data] if me.uv_layers else []
    rec.update({
        "vertices": len(me.vertices),
        "faces": len(me.polygons),
        "tris": tri_count(me),
        "quads": quads,
        "ngons": ngons,
        "bbox_min_m": [round(c, 4) for c in lo],
        "bbox_max_m": [round(c, 4) for c in hi],
        "size_m": [round(hi[i] - lo[i], 4) for i in range(3)],
        "centre_m": [round((hi[i] + lo[i]) / 2, 4) for i in range(3)],
        "cell_hist": dict(sorted(hist.items())),
        "uv_range": [round(min(u.x for u in uvs), 4), round(max(u.x for u in uvs), 4),
                     round(min(u.y for u in uvs), 4), round(max(u.y for u in uvs), 4)] if uvs else None,
        "edges": edge_stats(me),
        "uv_maps": [u.name for u in me.uv_layers],
        "materials": [m.name if m else None for m in me.materials],
    })
    return rec


def wheel_geometry(obj):
    """Hub = bbox centre of the tyre geometry in world space. The object origin is recorded but
    NOT trusted: 05r and 09 have right-side wheel origins mirrored to +X while geometry sits at -X."""
    me = obj.data
    mw = obj.matrix_world
    origin = mw.translation
    world = [mw @ v.co for v in me.vertices]
    lo = [min(p[i] for p in world) for i in range(3)]
    hi = [max(p[i] for p in world) for i in range(3)]
    hub = Vector(((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2))
    radii = [math.hypot(p.y - hub.y, p.z - hub.z) for p in world]
    return {
        "centre_m": [round(hub.x, 4), round(hub.y, 4), round(hub.z, 4)],
        "origin_m": [round(origin.x, 4), round(origin.y, 4), round(origin.z, 4)],
        "origin_offset_m": round((origin - hub).length, 4),
        "radius_max_m": round(max(radii), 4),
        "radius_min_m": round(min(radii), 4),
        "width_m": round(hi[0] - lo[0], 4),
        "tris": tri_count(me),
    }


def analyse_car(path):
    reset_scene(path)
    header = fbxheader.read_header(path)
    base = os.path.splitext(os.path.basename(path))[0]
    objects = [o for o in bpy.data.objects]
    meshes = [o for o in objects if o.type == "MESH"]
    body = next((o for o in meshes if o.name.endswith(".body")), None)
    if body is None:
        raise SystemExit("no <id>.body mesh in " + path)
    car_id = body.name[: -len(".body")]
    wheels = {}
    for o in meshes:
        m = re.match(r".*\.wheel_(fl|fr|bl|br)$", o.name)
        if m:
            wheels[m.group(1)] = o
    lamps = {}
    for o in meshes:
        if o.name.startswith(car_id + ".body.") and "wheel_" not in o.name:
            lamps[o.name[len(car_id) + len(".body."):]] = o
    body_rec = object_record(body)
    stations = analyse_body(body)
    cells = face_cells(body.data)
    paint_hist = Counter(c for c in cells if c is not None)
    paint_cell = max((c for c in paint_hist if c != GLASS_CELL), key=lambda c: paint_hist[c], default=None)
    glass_faces = paint_hist.get(GLASS_CELL, 0)
    paint_cell = list(paint_cell) if paint_cell else None
    wheel_info = {k: wheel_geometry(v) for k, v in sorted(wheels.items())}
    wheel_names = {k: v.name for k, v in sorted(wheels.items())}
    front_y = [wheel_info[k]["centre_m"][1] for k in ("fl", "fr") if k in wheel_info]
    rear_y = [wheel_info[k]["centre_m"][1] for k in ("bl", "br") if k in wheel_info]
    metrics = {
        "length_m": body_rec["size_m"][1],
        "width_m": body_rec["size_m"][0],
        "height_body_m": body_rec["size_m"][2],
        "ground_z_m": round(min(w["centre_m"][2] - w["radius_max_m"] for w in wheel_info.values()), 4),
        "bbox_all_size_m": [round(c, 4) for c in
                            [max(o.dimensions[i] for o in meshes) for i in range(3)]],
        "wheelbase_m": round(abs(statistics.mean(front_y) - statistics.mean(rear_y)), 4) if front_y and rear_y else None,
        "front_track_m": round(abs(wheel_info["fl"]["centre_m"][0] - wheel_info["fr"]["centre_m"][0]), 4) if {"fl", "fr"} <= wheel_info.keys() else None,
        "rear_track_m": round(abs(wheel_info["bl"]["centre_m"][0] - wheel_info["br"]["centre_m"][0]), 4) if {"bl", "br"} <= wheel_info.keys() else None,
        "tyre_radius_m": round(statistics.mean(w["radius_max_m"] for w in wheel_info.values()), 4),
        "tyre_width_m": round(statistics.mean(w["width_m"] for w in wheel_info.values()), 4),
        "wheel_centre_z_m": round(statistics.mean(w["centre_m"][2] for w in wheel_info.values()), 4),
        "front_overhang_m": None,
        "rear_overhang_m": None,
        "paint_cell_measured": paint_cell,
        "paint_cell_game": list(GAME_PAINT_CELL.get(base, ())) or None,
        "glass_faces": glass_faces,
        "body_faces": len(body.data.polygons),
    }
    if front_y and rear_y:
        ymin = body_rec["bbox_min_m"][1]
        ymax = body_rec["bbox_max_m"][1]
        metrics["front_overhang_m"] = round(ymin - min(front_y), 4)
        metrics["rear_overhang_m"] = round(max(rear_y) - ymax, 4)
    raw = {
        "fbx_version": header["fbx_version"],
        "creator": header.get("creator"),
        "UpAxis": header.get("UpAxis"),
        "UpAxisSign": header.get("UpAxisSign"),
        "FrontAxis": header.get("FrontAxis"),
        "FrontAxisSign": header.get("FrontAxisSign"),
        "CoordAxis": header.get("CoordAxis"),
        "CoordAxisSign": header.get("CoordAxisSign"),
        "UnitScaleFactor": header.get("UnitScaleFactor"),
        "models": [
            {"name": m["name"], "type": m["type"],
             "Lcl Scaling": m["lcl"].get("Lcl Scaling"),
             "Lcl Translation": m["lcl"].get("Lcl Translation")}
            for m in header["models"] if m["type"] == "Mesh"
        ],
    }
    lamp_info = {k: object_record(v) for k, v in sorted(lamps.items())}
    all_objects = [object_record(o) for o in objects]
    return {
        "file": os.path.basename(path),
        "id": car_id,
        "objects": all_objects,
        "body": body_rec,
        "body_stations": stations,
        "wheels": wheel_info,
        "wheel_object_names": wheel_names,
        "lamps": lamp_info,
        "metrics": metrics,
        "raw_fbx": raw,
    }


def median(vals):
    vals = [v for v in vals if v is not None]
    return round(statistics.median(vals), 4) if vals else None


def shared_rules(cars):
    st_counts = [s["loop_points"][0] for c in cars for s in c["body_stations"] if s.get("loop_points")]
    outer_points = [s.get("perimeter_mm") for c in cars for s in c["body_stations"]]
    return {
        "cars": len(cars),
        "body_tris_median": median([c["body"]["tris"] for c in cars]),
        "body_tris_min": min(c["body"]["tris"] for c in cars),
        "body_tris_max": max(c["body"]["tris"] for c in cars),
        "body_quad_share_median": median([c["body"]["quads"] / max(1, c["body"]["faces"]) for c in cars]),
        "body_boundary_edges_median": median([c["body"]["edges"]["boundary_edges"] for c in cars]),
        "body_nonmanifold_edges_total": sum(c["body"]["edges"]["nonmanifold_edges"] for c in cars),
        "station_outer_points_median": median(st_counts),
        "station_outer_points_min": min(st_counts) if st_counts else None,
        "station_outer_points_max": max(st_counts) if st_counts else None,
        "station_perimeter_mm_median": median(outer_points),
        "station_mirror_error_mm_max": max((s.get("mirror_error_mm", 0) for c in cars for s in c["body_stations"]), default=None),
        "station_loops_histogram": dict(Counter(s["loops"] for c in cars for s in c["body_stations"])),
        "wheel_tris_median": median([w["tris"] for c in cars for w in c["wheels"].values()]),
        "wheel_radius_m_median": median([w["radius_max_m"] for c in cars for w in c["wheels"].values()]),
        "wheel_width_m_median": median([w["width_m"] for c in cars for w in c["wheels"].values()]),
        "lamp_tris_median": median([l["tris"] for c in cars for l in c["lamps"].values()]),
        "lamp_faces_median": median([l["faces"] for c in cars for l in c["lamps"].values()]),
        "lamp_quad_share_median": median([l["quads"] / max(1, l["faces"]) for c in cars for l in c["lamps"].values()]),
        "uv_range_seen": sorted({tuple(c["body"]["uv_range"]) for c in cars if c["body"]["uv_range"]})[:3],
        "fbx_unit_scale_factor": sorted({c["raw_fbx"]["UnitScaleFactor"] for c in cars}),
        "fbx_up_axis": sorted({(c["raw_fbx"]["UpAxis"], c["raw_fbx"]["UpAxisSign"]) for c in cars}),
        "fbx_front_axis": sorted({(c["raw_fbx"]["FrontAxis"], c["raw_fbx"]["FrontAxisSign"]) for c in cars}),
        "fbx_lcl_scaling_seen": sorted({tuple(m["Lcl Scaling"]) for c in cars for m in c["raw_fbx"]["models"] if m["Lcl Scaling"]}),
        "glass_cell_bodies_with_glass": sum(1 for c in cars if c["metrics"]["glass_faces"] > 0),
        "paint_cell_mismatch_vs_game": [c["id"] for c in cars if c["metrics"]["paint_cell_measured"] != c["metrics"]["paint_cell_game"]],
    }


def fmt_pct(x):
    return "-" if x is None else f"{x:.3f}"


def write_markdown(path, cars, rules):
    lines = ["# Car census", ""]
    lines.append("Frame: Blender world after FBX import, metres. X = width (+X = car left), Y = length (front = -Y), Z = up.")
    lines.append("Raw FBX: centimetres via Lcl Scaling 100, UnitScaleFactor 1.0, Y-up, front = +Z (FrontAxis 2, sign +1).")
    lines.append("")
    lines.append("## Per car")
    lines.append("")
    lines.append("| id | file | length | width | body h | wb | f.track | r.track | tyre r | tyre w | body tris | body quads | boundary edges | st. loops | st. pts med | glass faces | paint cell (meas/game) | lamps |")
    lines.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for c in cars:
        m = c["metrics"]
        st = [s["loop_points"][0] for s in c["body_stations"] if s.get("loop_points")]
        lines.append(
            f"| {c['id']} | {c['file']} | {m['length_m']:.3f} | {m['width_m']:.3f} | {m['height_body_m']:.3f} | "
            f"{fmt_pct(m['wheelbase_m'])} | {fmt_pct(m['front_track_m'])} | {fmt_pct(m['rear_track_m'])} | "
            f"{fmt_pct(m['tyre_radius_m'])} | {fmt_pct(m['tyre_width_m'])} | {c['body']['tris']} | {c['body']['quads']} | "
            f"{c['body']['edges']['boundary_edges']} | {min(s['loops'] for s in c['body_stations'])}-{max(s['loops'] for s in c['body_stations'])} | "
            f"{statistics.median(st) if st else '-'} | {m['glass_faces']} | {m['paint_cell_measured']} / {m['paint_cell_game']} | "
            f"{', '.join(sorted(c['lamps']))} |"
        )
    lines.append("")
    lines.append("## Objects per car (Blender import, metres)")
    lines.append("")
    lines.append("| car | object | role | tris | quads | size X,Y,Z | centre | cells (col,row:faces) |")
    lines.append("|---|---|---|---|---|---|---|---|")
    for c in cars:
        for o in c["objects"]:
            if o["type"] != "MESH":
                continue
            cells = " ".join(f"{k}:{v}" for k, v in o["cell_hist"].items()) if o.get("cell_hist") else "-"
            role = "body" if o["name"].endswith(".body") else "wheel" if ".wheel_" in o["name"] else "lamp"
            lines.append(
                f"| {c['id']} | {o['name']} | {role} | {o['tris']} | {o['quads']} | "
                f"{o['size_m'][0]:.3f},{o['size_m'][1]:.3f},{o['size_m'][2]:.3f} | "
                f"{o['centre_m'][0]:.3f},{o['centre_m'][1]:.3f},{o['centre_m'][2]:.3f} | {cells} |"
            )
    lines.append("")
    lines.append("## Import transforms and raw FBX")
    lines.append("")
    lines.append("| car | object | Blender loc | Blender rot (rad) | scale | raw Lcl Scaling | raw Lcl Translation (cm) |")
    lines.append("|---|---|---|---|---|---|---|")
    for c in cars:
        raw = {m["name"]: m for m in c["raw_fbx"]["models"]}
        for o in c["objects"]:
            if o["type"] != "MESH":
                continue
            r = raw.get(o["name"], {})
            lines.append(
                f"| {c['id']} | {o['name']} | {o['location_m']} | {o['rotation_euler_rad']} | {o['scale']} | "
                f"{r.get('Lcl Scaling', '-')} | {[round(x, 2) for x in r['Lcl Translation']] if r.get('Lcl Translation') else '-'} |"
            )
    lines.append("")
    lines.append("## Body stations (outer loop, mm; y is the station plane)")
    lines.append("")
    for c in cars:
        lines.append(f"### {c['id']}")
        lines.append("")
        lines.append("| # | y mm | loops | pts | half-width | z min | z max | z@widest | top half-w | perim | mirror err |")
        lines.append("|---|---|---|---|---|---|---|---|---|---|---|")
        for s in c["body_stations"]:
            if "half_width_mm" not in s:
                lines.append(f"| {s['index']} | {s['y_mm']} | {s['loops']} | - | - | - | - | - | - | - | - |")
                continue
            lines.append(
                f"| {s['index']} | {s['y_mm']} | {s['loops']} | {s['loop_points']} | {s['half_width_mm']} | {s['z_min_mm']} | "
                f"{s['z_max_mm']} | {s['z_at_widest_mm']} | {s['top_half_width_mm']} | {s['perimeter_mm']} | {s['mirror_error_mm']} |"
            )
        lines.append("")
    lines.append("## Shared aggregates")
    lines.append("")
    lines.append("```json")
    lines.append(json.dumps(rules, indent=2, sort_keys=True))
    lines.append("```")
    lines.append("")
    with open(path, "w") as fh:
        fh.write("\n".join(lines))


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=None)
    ap.add_argument("--files", nargs="*", default=None)
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)
    files = args.files or sorted(glob.glob(os.path.join(args.src, "*.fbx")))
    os.makedirs(args.out, exist_ok=True)
    cars = []
    for f in files:
        cars.append(analyse_car(os.path.abspath(f)))
        print("CENSUS", os.path.basename(f), flush=True)
    rules = shared_rules(cars)
    with open(os.path.join(args.out, "census.json"), "w") as fh:
        json.dump({"cars": cars, "rules": rules}, fh, indent=1)
    write_markdown(os.path.join(args.out, "census.md"), cars, rules)
    print("WROTE", args.out, len(cars), "cars")


if __name__ == "__main__":
    main()
