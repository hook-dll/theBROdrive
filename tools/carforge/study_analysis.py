"""Construction study of one body mesh. Pure Python: no Blender imports.

Input is plain arrays extracted by study.py, world frame, metres:
  V  list of (x, y, z)       vertices (+X = car left, front = -Y, Z up)
  F  list of [v, ...]        polygon vertex indices
  N  list of (nx, ny, nz)    unit face normals
  A  list of float           face areas (m^2)
  C  list of (col, row)      atlas cell per face (9x2 swatch atlas, from UV centroid)

Region labels come from geometry (normal, position, wheel positions), cells and connectivity.
Every number produced here is a measurement; labels are heuristic and are checked by the
region renders.
"""

import math
from collections import Counter, defaultdict, deque

ANGLE_DEG = 30.0          # patch flood-fill: adjacent faces must bend less than this
GLASS_WINDOW_DEG = 45.0   # glass windows: adjacent glass faces may bend this much
CLUSTER_M = 0.002         # coordinate clustering tolerance (2 mm)
CENTRE_M = 0.0005         # |x| below this counts as on the centre line
GLASS_CELL = (3, 1)       # src/vehicle/carmodels.ts glassUvCell
COS_PATCH = math.cos(math.radians(ANGLE_DEG))
COS_WINDOW = math.cos(math.radians(GLASS_WINDOW_DEG))
AXES = ("x", "y", "z")


# ---------- vector helpers -------------------------------------------------

def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def scale(a, s):
    return (a[0] * s, a[1] * s, a[2] * s)


def length(a):
    return math.sqrt(dot(a, a))


def norm(a):
    l = length(a) or 1.0
    return (a[0] / l, a[1] / l, a[2] / l)


def angle_deg(a, b):
    c = max(-1.0, min(1.0, dot(norm(a), norm(b))))
    return math.degrees(math.acos(c))


def pct(vals, p):
    if not vals:
        return None
    s = sorted(vals)
    k = (len(s) - 1) * p
    lo, hi = math.floor(k), math.ceil(k)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def mm(v):
    return None if v is None else round(v * 1000.0, 2)


def clusters(vals, tol=CLUSTER_M):
    s = sorted(vals)
    if not s:
        return []
    out = [[s[0]]]
    for v in s[1:]:
        if v - out[-1][-1] <= tol:
            out[-1].append(v)
        else:
            out.append([v])
    return out


def n_clusters(vals, tol=CLUSTER_M):
    return len(clusters(vals, tol))


# ---------- mesh -----------------------------------------------------------

class Mesh:
    def __init__(self, V, F, N, A, C):
        self.V, self.F, self.N, self.A, self.C = V, F, N, A, C
        self.nF = len(F)
        self.emap = defaultdict(list)
        for fi, f in enumerate(F):
            k = len(f)
            for i in range(k):
                a, b = f[i], f[(i + 1) % k]
                self.emap[(a, b) if a < b else (b, a)].append(fi)
        self.adj = [[] for _ in range(self.nF)]
        for fs in self.emap.values():
            if len(fs) == 2:
                self.adj[fs[0]].append(fs[1])
                self.adj[fs[1]].append(fs[0])
        self.FC = []
        for f in F:
            n = len(f)
            sx = sum(V[v][0] for v in f) / n
            sy = sum(V[v][1] for v in f) / n
            sz = sum(V[v][2] for v in f) / n
            self.FC.append((sx, sy, sz))
        self.vert_faces = defaultdict(list)
        for fi, f in enumerate(F):
            for v in f:
                self.vert_faces[v].append(fi)

    def edge_len(self, key):
        return length(sub(self.V[key[1]], self.V[key[0]]))


def edge_key(a, b):
    return (a, b) if a < b else (b, a)


def topology(m):
    used = set(v for f in m.F for v in f)
    parent = list(range(m.nF))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for fs in m.vert_faces.values():
        for g in fs[1:]:
            ra, rb = find(fs[0]), find(g)
            if ra != rb:
                parent[ra] = rb
    shell_sizes = Counter(find(i) for i in range(m.nF))
    boundary = [k for k, fs in m.emap.items() if len(fs) == 1]
    nonman = [k for k, fs in m.emap.items() if len(fs) > 2]
    quads = sum(1 for f in m.F if len(f) == 4)
    tris = sum(1 for f in m.F if len(f) == 3)
    tri_count = sum(len(f) - 2 for f in m.F)
    return {
        "verts": len(used),
        "faces": m.nF,
        "edges": len(m.emap),
        "tris": tri_count,
        "quads": quads,
        "tri_faces": tris,
        "ngons": m.nF - quads - tris,
        "boundary_edges": len(boundary),
        "nonmanifold_edges": len(nonman),
        "shells": len(shell_sizes),
        "shell_face_counts": sorted(shell_sizes.values(), reverse=True)[:12],
        "euler": len(used) - len(m.emap) + m.nF,
        "_boundary": boundary,
    }


def mirror_stats(m):
    used = sorted(set(v for f in m.F for v in f))
    pts = [m.V[v] for v in used]
    centre_v = sum(1 for p in pts if abs(p[0]) < CENTRE_M)
    centre_f = sum(1 for f, fc in zip(m.F, m.FC) if abs(fc[0]) < CENTRE_M and all(abs(m.V[v][0]) < CENTRE_M for v in f))
    right = [p for p in pts if p[0] > CENTRE_M]
    left = [p for p in pts if p[0] < -CENTRE_M]
    dists = []
    for p in right:
        mp = (-p[0], p[1], p[2])
        best = min((length(sub(mp, q)) for q in left), default=None)
        if best is not None:
            dists.append(best)
    faces_right = sum(1 for fc in m.FC if fc[0] > CENTRE_M)
    faces_left = sum(1 for fc in m.FC if fc[0] < -CENTRE_M)
    return {
        "centreline_verts": centre_v,
        "centreline_faces": centre_f,
        "faces_right": faces_right,
        "faces_left": faces_left,
        "verts_right": len(right),
        "verts_left": len(left),
        "mirror_err_p50_mm": mm(pct(dists, 0.5)),
        "mirror_err_p95_mm": mm(pct(dists, 0.95)),
        "mirror_err_max_mm": mm(max(dists) if dists else None),
        "mirror_unmatched_gt2mm": sum(1 for d in dists if d > 0.002),
    }


# ---------- patches and windows -------------------------------------------

def patches(m):
    """Flood fill: same atlas cell and adjacent normals within ANGLE_DEG."""
    pid = [-1] * m.nF
    out = []
    for f0 in range(m.nF):
        if pid[f0] >= 0:
            continue
        k = len(out)
        pid[f0] = k
        faces = [f0]
        q = deque([f0])
        while q:
            f = q.popleft()
            for g in m.adj[f]:
                if pid[g] < 0 and m.C[g] == m.C[f] and dot(m.N[f], m.N[g]) >= COS_PATCH:
                    pid[g] = k
                    faces.append(g)
                    q.append(g)
        out.append(faces)
    return pid, out


def glass_windows(m):
    """Connected glass faces, split where the bend exceeds GLASS_WINDOW_DEG."""
    win = [-1] * m.nF
    out = []
    for f0 in range(m.nF):
        if m.C[f0] != GLASS_CELL or win[f0] >= 0:
            continue
        k = len(out)
        win[f0] = k
        faces = [f0]
        q = deque([f0])
        while q:
            f = q.popleft()
            for g in m.adj[f]:
                if m.C[g] == GLASS_CELL and win[g] < 0 and dot(m.N[f], m.N[g]) >= COS_WINDOW:
                    win[g] = k
                    faces.append(g)
                    q.append(g)
        out.append(faces)
    return win, out


def area_mean_normal(m, faces):
    s = (0.0, 0.0, 0.0)
    for f in faces:
        s = add(s, scale(m.N[f], m.A[f]))
    return norm(s)


def area_mean_point(m, faces):
    a = sum(m.A[f] for f in faces) or 1.0
    s = (0.0, 0.0, 0.0)
    for f in faces:
        s = add(s, scale(m.FC[f], m.A[f]))
    return scale(s, 1.0 / a)


def window_kind(n, c, ymin, L):
    fy = (c[1] - ymin) / L
    if abs(n[0]) > 0.5:
        return "side"
    if n[2] > 0.5:
        return "roof"
    if n[1] < -0.3 and fy < 0.5:
        return "windscreen"
    if n[1] > 0.3 and fy > 0.5:
        return "rear"
    return "other"


# ---------- classification -------------------------------------------------

def body_context(m, wheels):
    xs = [v[0] for v in m.V]
    ys = [v[1] for v in m.V]
    zs = [v[2] for v in m.V]
    ctx = {
        "xmin": min(xs), "xmax": max(xs), "ymin": min(ys), "ymax": max(ys),
        "zmin": min(zs), "zmax": max(zs), "wheels": wheels,
    }
    ctx["hw"] = max(abs(ctx["xmin"]), abs(ctx["xmax"]))
    ctx["L"] = ctx["ymax"] - ctx["ymin"]
    ctx["H"] = ctx["zmax"] - ctx["zmin"]
    return ctx


def nearest_wheel(ctx, side, y):
    cands = [w for w in ctx["wheels"] if w["side"] == side] or ctx["wheels"]
    return min(cands, key=lambda w: abs(w["yc"] - y))


def in_arch_band(ctx, c):
    x, y, z = c
    if abs(x) <= 0.5 * ctx["hw"]:
        return False
    w = nearest_wheel(ctx, 1 if x > 0 else -1, y)
    r = math.hypot(y - w["yc"], z - w["zc"])
    return 0.9 * w["R"] < r < 1.6 * w["R"] and z > w["zc"] - 0.2 * w["R"]


def classify_patch(c, n, ctx, beltline):
    x, y, z = c
    nx, ny, nz = n
    fy = (y - ctx["ymin"]) / ctx["L"]
    fz = (z - ctx["zmin"]) / ctx["H"]
    if (fy < 0.10 or fy > 0.90) and fz < 0.50 and nz < 0.5:
        return "bumper_front" if fy < 0.5 else "bumper_rear"
    if ny < -0.5 and fy < 0.5:
        return "front_face"
    if ny > 0.5 and fy > 0.5:
        return "rear_face"
    if nz < -0.5:
        return "underbody"
    if nz > 0.45 and fy < 0.42:
        return "bonnet"
    if nz > 0.45 and fy > 0.68:
        return "boot_lid"
    if nz > 0.45:
        return "roof"
    if ny < -0.25 and nz > 0.0 and fy < 0.5:
        return "chamfer_bonnet_front"
    if ny > 0.25 and nz > 0.0 and fy > 0.5:
        return "chamfer_rear_top"
    if abs(nx) > 0.55:
        if z > beltline:
            return "side_upper"
        if fz < 0.25:
            return "sill"
        return "side_lower"
    if nz > 0.1 and abs(nx) > 0.25 and z > beltline:
        return "chamfer_roof_side"
    if z > beltline:
        return "greenhouse"
    if nz < -0.1 and abs(nx) > 0.25:
        return "chamfer_sill_underbody"
    return "other"


def label_faces(m, ctx, pid, pat, win, wins):
    """Face labels: glass by window kind, arches by face centroid, others by patch."""
    # beltline: median of lowest vertex of side windows; fallback 45% of height
    lows = []
    for faces in wins:
        if window_kind(area_mean_normal(m, faces), area_mean_point(m, faces), ctx["ymin"], ctx["L"]) == "side":
            lows.append(min(m.V[v][2] for f in faces for v in m.F[f]))
    beltline = pct(lows, 0.5) if lows else ctx["zmin"] + 0.45 * ctx["H"]

    patch_label = {}
    for k, faces in enumerate(pat):
        if m.C[faces[0]] == GLASS_CELL:
            continue
        n = area_mean_normal(m, faces)
        c = area_mean_point(m, faces)
        patch_label[k] = classify_patch(c, n, ctx, beltline)

    labels = [None] * m.nF
    for f in range(m.nF):
        if m.C[f] == GLASS_CELL:
            wk = win[f]
            kind = window_kind(area_mean_normal(m, wins[wk]), area_mean_point(m, wins[wk]), ctx["ymin"], ctx["L"])
            labels[f] = "glass_" + kind
        elif in_arch_band(ctx, m.FC[f]):
            labels[f] = "wheel_arch"
        else:
            labels[f] = patch_label[pid[f]]
    return labels, beltline


def components(m, labels):
    rid = [-1] * m.nF
    regions = []
    for f0 in range(m.nF):
        if rid[f0] >= 0:
            continue
        k = len(regions)
        rid[f0] = k
        faces = [f0]
        q = deque([f0])
        while q:
            f = q.popleft()
            for g in m.adj[f]:
                if rid[g] < 0 and labels[g] == labels[f]:
                    rid[g] = k
                    faces.append(g)
                    q.append(g)
        regions.append({"label": labels[f0], "faces": faces})
    return rid, regions


# ---------- region measurements -------------------------------------------

def axis_of(d):
    ax = [abs(d[i]) for i in range(3)]
    return ax.index(max(ax))


def region_measures(m, reg, rid, labels, ctx):
    faces = reg["faces"]
    fset = set(faces)
    ids = reg["id"]
    quads = sum(1 for f in faces if len(m.F[f]) == 4)
    tris = sum(1 for f in faces if len(m.F[f]) == 3)
    area = sum(m.A[f] for f in faces)
    verts = sorted({v for f in faces for v in m.F[f]})
    nm = reg["nm"]

    dev = [angle_deg(m.N[f], nm) for f in faces]
    p90 = pct(dev, 0.9)
    shape = "flat" if p90 < 4 else ("gently_curved" if p90 < 15 else "bulged")

    # edges inside region: direction histogram and boundary
    redges = set()
    for f in faces:
        fv = m.F[f]
        k = len(fv)
        for i in range(k):
            redges.add(edge_key(fv[i], fv[(i + 1) % k]))
    axis_hist = [0, 0, 0]
    for a, b in redges:
        axis_hist[axis_of(sub(m.V[b], m.V[a]))] += 1
    perim = 0.0
    open_edges = 0
    nb = Counter()
    nb_len = Counter()
    for key in redges:
        fs = m.emap[key]
        outside = [g for g in fs if g not in fset]
        if not outside:
            continue
        el = m.edge_len(key)
        perim += el
        if len(fs) == 1:
            open_edges += 1
        for g in outside:
            nb[rid[g]] += 1
            nb_len[rid[g]] += el

    rverts = set(verts)
    shared_with_outside = any(any(g not in fset for g in m.vert_faces[v]) for v in verts)

    ext = [[min(m.V[v][i] for v in verts), max(m.V[v][i] for v in verts)] for i in range(3)]
    extent_mm = [round((e[1] - e[0]) * 1000, 1) for e in ext]
    cl = {AXES[i]: n_clusters([m.V[v][i] for v in verts]) for i in range(3)}
    dom = AXES[axis_hist.index(max(axis_hist))]

    # cross-section through the middle 20% of the region's length (y)
    ylo = ext[1][0] + 0.4 * (ext[1][1] - ext[1][0])
    yhi = ext[1][0] + 0.6 * (ext[1][1] - ext[1][0])
    band = [v for v in verts if ylo <= m.V[v][1] <= yhi]
    cross = {}
    if band:
        ax_abs = [abs(m.V[v][0]) for v in band]
        mx = max(ax_abs)
        zs = [m.V[v][2] for v in band]
        cross["across_segments"] = n_clusters(ax_abs, 0.002)
        cross["x_spread_mm"] = mm(mx - min(ax_abs))
        inner = [m.V[v][2] for v in band if abs(m.V[v][0]) < 0.1 * mx]
        outer = [m.V[v][2] for v in band if abs(m.V[v][0]) > 0.9 * mx]
        cross["crown_mm"] = mm(sum(inner) / len(inner) - sum(outer) / len(outer)) if inner and outer else None
        if max(zs) - min(zs) > 0.02:
            zlo = min(zs) + 0.2 * (max(zs) - min(zs))
            zhi = max(zs) - 0.2 * (max(zs) - min(zs))
            bot = [abs(m.V[v][0]) for v in band if m.V[v][2] <= zlo]
            top = [abs(m.V[v][0]) for v in band if m.V[v][2] >= zhi]
            cross["tumblehome_mm"] = mm(sum(bot) / len(bot) - sum(top) / len(top)) if bot and top else None
        else:
            cross["tumblehome_mm"] = None
    # longitudinal profile on the centre-ish strip (|x| small relative to region)
    if verts:
        mxa = max(abs(m.V[v][0]) for v in verts) or 1.0
        strip = [v for v in verts if abs(m.V[v][0]) < 0.15 * mxa]
        ys = sorted({round(m.V[v][1], 3) for v in strip})
        long = {"stations_along": n_clusters([m.V[v][1] for v in strip]) if strip else 0}
        if len(strip) >= 4:
            zfront = [m.V[v][2] for v in strip if m.V[v][1] <= ext[1][0] + 0.15 * (ext[1][1] - ext[1][0])]
            zrear = [m.V[v][2] for v in strip if m.V[v][1] >= ext[1][1] - 0.15 * (ext[1][1] - ext[1][0])]
            zmid = [m.V[v][2] for v in strip if ylo <= m.V[v][1] <= yhi]
            if zfront and zrear and zmid:
                long["camber_mm"] = mm(sum(zmid) / len(zmid) - 0.5 * (sum(zfront) / len(zfront) + sum(zrear) / len(zrear)))
        cross["long"] = long

    chamfer = None
    if reg["label"].startswith("chamfer") or reg["label"] in ("sill", "other"):
        chamfer = round(2.0 * area / perim * 1000, 2) if perim > 0 else None

    neigh = []
    for r2, cnt in nb.most_common():
        other = ctx["regions"][r2]
        bend = angle_deg(nm, other["nm"])
        neigh.append({"id": other["id"], "label": other["label"], "shared_edges": cnt,
                      "bend_deg": round(bend, 1)})

    return {
        "id": ids,
        "label": reg["label"],
        "faces": len(faces),
        "quads": quads,
        "tris": tris,
        "ngons": len(faces) - quads - tris,
        "area_m2": round(area, 4),
        "verts": len(verts),
        "extent_mm": {"x": extent_mm[0], "y": extent_mm[1], "z": extent_mm[2]},
        "normal": [round(c, 3) for c in nm],
        "normal_dev_p90_deg": round(p90, 2) if p90 is not None else None,
        "shape": shape,
        "edge_axis_share": {AXES[i]: round(axis_hist[i] / max(1, sum(axis_hist)), 3) for i in range(3)},
        "dominant_edge_axis": dom,
        "clusters": cl,
        "perimeter_mm": mm(perim),
        "open_boundary_edges": open_edges,
        "separate_shell": not shared_with_outside,
        "neighbours": neigh,
        "chamfer_width_mm": chamfer,
        "cross_section_mid": cross,
    }


def regions_for(m, labels, ctx):
    rid, regs = components(m, labels)
    for k, reg in enumerate(regs):
        reg["id"] = f"{reg['label']}#{k}"
        reg["nm"] = area_mean_normal(m, reg["faces"])
    ctx["regions"] = regs
    return rid, regs


def region_records(m, labels, rid, regs, ctx):
    out = []
    for reg in regs:
        rec = region_measures(m, reg, rid, labels, ctx)
        cells = Counter(m.C[f] for f in reg["faces"])
        rec["cells"] = {f"{c},{r}": n for (c, r), n in sorted(cells.items())}
        out.append(rec)
    return out


# ---------- glass ----------------------------------------------------------

def glass_records(m, labels, rid, regs, ctx):
    """Per glass window: glass normal, cells of the non-glass faces that touch it (the frame), and
    the shared-edge count. Glass depth against a parallel body plane is NOT measured: the frame
    faces around a window are not parallel to the glass, so no reliable recess can be read."""
    out = []
    for reg in regs:
        if not reg["label"].startswith("glass_"):
            continue
        glass_set = set(reg["faces"])
        shared = sum(1 for f in reg["faces"] for g in m.adj[f] if m.C[g] != GLASS_CELL)
        frame_faces = {h for f in reg["faces"] for v in m.F[f] for h in m.vert_faces[v]
                       if h not in glass_set and m.C[h] != GLASS_CELL}
        frame_cells = Counter("%d,%d" % m.C[h] for h in frame_faces)
        gsum = [sum(m.N[f][i] for f in reg["faces"]) for i in range(3)]
        gl = math.sqrt(sum(x * x for x in gsum)) or 1.0
        out.append({
            "id": reg["id"],
            "label": reg["label"],
            "faces": len(reg["faces"]),
            "quads": sum(1 for f in reg["faces"] if len(m.F[f]) == 4),
            "shared_edges_with_body": shared,
            "glass_normal": [round(x / gl, 3) for x in gsum],
            "frame_faces": len(frame_faces),
            "frame_cells": dict(frame_cells),
            "separate_shell": not any(any(g not in glass_set for g in m.vert_faces[v])
                                      for f in reg["faces"] for v in m.F[f]),
        })
    return out


# ---------- wheel arches ---------------------------------------------------

def arch_records(m, labels, ctx):
    out = []
    for w in ctx["wheels"]:
        band_f = [f for f in range(m.nF) if labels[f] == "wheel_arch"
                  and (1 if m.FC[f][0] > 0 else -1) == w["side"]
                  and nearest_wheel(ctx, w["side"], m.FC[f][1]) is w]
        if not band_f:
            out.append({"wheel": w["name"], "faces": 0})
            continue
        inner = lip = 0
        for f in band_f:
            fc = m.FC[f]
            dy, dz = fc[1] - w["yc"], fc[2] - w["zc"]
            r = math.hypot(dy, dz) or 1e-9
            nrad = (m.N[f][1] * dy + m.N[f][2] * dz) / r
            if nrad < -0.5:
                inner += 1
            elif nrad > 0.5:
                lip += 1
        bverts = sorted({v for f in band_f for v in m.F[f]})
        angles = [math.degrees(math.atan2(m.V[v][2] - w["zc"], m.V[v][1] - w["yc"])) for v in bverts]
        radii = [math.hypot(m.V[v][1] - w["yc"], m.V[v][2] - w["zc"]) for v in bverts]
        # flare: outermost |x| of the arch vs body |x| 1.2-2.5 R fore/aft of the wheel, same height band
        arch_x = max(abs(m.V[v][0]) for v in bverts)
        ref = [abs(m.V[v][0]) for v in range(len(m.V))
               if 1.2 * w["R"] < abs(m.V[v][1] - w["yc"]) < 2.5 * w["R"]
               and w["zc"] < m.V[v][2] < w["zc"] + w["R"]
               and (1 if m.V[v][0] > 0 else -1) == w["side"]]
        flare = (arch_x - pct(ref, 0.5)) if ref else None
        out.append({
            "wheel": w["name"],
            "faces": len(band_f),
            "quads": sum(1 for f in band_f if len(m.F[f]) == 4),
            "inner_wall_faces": inner,
            "lip_faces": lip,
            "open_arch": inner > 0,
            "verts": len(bverts),
            "segments_around_arch": n_clusters(angles, 1.0),
            "radial_layers": n_clusters(radii, 0.002),
            "arch_radius_over_tyre": round(max(radii) / w["R"], 3) if radii else None,
            "arch_inner_radius_over_tyre": round(min(radii) / w["R"], 3) if radii else None,
            "flare_mm": mm(flare),
            "arch_max_abs_x_m": round(arch_x, 4),
        })
    return out


# ---------- body-level ------------------------------------------------------

def underbody_record(m, labels, topo, ctx):
    ub = [f for f in range(m.nF) if labels[f] == "underbody"]
    ub_set = set(ub)
    open_e = sum(1 for k, fs in m.emap.items() if len(fs) == 1 and any(f in ub_set for f in fs))
    bz = [m.V[a][2] for a, b in topo["_boundary"]]
    zbot = ctx["zmin"]
    H = ctx["H"]
    return {
        "faces": len(ub),
        "quads": sum(1 for f in ub if len(m.F[f]) == 4),
        "open_edges": open_e,
        "body_boundary_edges": len(topo["_boundary"]),
        "boundary_below_20pct_height": sum(1 for z in bz if z - zbot < 0.2 * H),
        "boundary_median_height_frac": round(pct([(z - zbot) / H for z in bz], 0.5), 3) if bz else None,
        "floor_faces_up_low": sum(1 for f in range(m.nF) if m.N[f][2] > 0.5 and m.FC[f][2] - zbot < 0.25 * H),
    }


# ---------- lamps and wheels -----------------------------------------------

def simple_mesh_record(m, name):
    topo = topology(m)
    topo.pop("_boundary", None)
    xs = [v[0] for v in m.V]
    ys = [v[1] for v in m.V]
    zs = [v[2] for v in m.V]
    cells = Counter(m.C)
    ny = sum(m.A[f] * abs(m.N[f][1]) for f in range(m.nF))
    atot = sum(m.A) or 1.0
    return {
        "name": name,
        "topology": topo,
        "size_mm": [round((max(a) - min(a)) * 1000, 1) for a in (xs, ys, zs)],
        "normal_axis_share": {
            "x": round(sum(m.A[f] * abs(m.N[f][0]) for f in range(m.nF)) / atot, 3),
            "y": round(ny / atot, 3),
            "z": round(sum(m.A[f] * abs(m.N[f][2]) for f in range(m.nF)) / atot, 3),
        },
        "cells": {f"{c},{r}": n for (c, r), n in sorted(cells.items())},
    }


def wheel_record(m, w):
    rec = simple_mesh_record(m, w["name"])
    R = w["R"]
    xs = [v[0] for v in m.V]
    rv = lambda v: math.hypot(m.V[v][1] - w["yc"], m.V[v][2] - w["zc"])
    used = sorted({v for f in m.F for v in f})
    tread = [v for v in used if rv(v) > 0.97 * R]
    rim = [v for v in used if 0.45 * R < rv(v) < 0.8 * R]
    hub = [v for v in used if rv(v) < 0.3 * R]
    rec.update({
        "centre_m": [round(w["xc"], 4), round(w["yc"], 4), round(w["zc"], 4)],
        "radius_mm": round(R * 1000, 1),
        "width_mm": round((max(xs) - min(xs)) * 1000, 1),
        "segments_around_tread": n_clusters([math.degrees(math.atan2(m.V[v][2] - w["zc"], m.V[v][1] - w["yc"])) for v in tread], 1.0),
        "x_rings_all": n_clusters([m.V[v][0] for v in used], 0.001),
        "x_rings_rim": n_clusters([m.V[v][0] for v in rim], 0.001),
        "x_rings_hub": n_clusters([m.V[v][0] for v in hub], 0.001),
        "tread_verts": len(tread),
    })
    return rec


def lamp_record(m, name, body_verts_set_pts):
    rec = simple_mesh_record(m, name)
    near = 0
    for p in m.V:
        best = min((length(sub(p, q)) for q in body_verts_set_pts), default=None)
        if best is not None and best < 0.002:
            near += 1
    rec["verts_within_2mm_of_body"] = near
    return rec


# ---------- entry ----------------------------------------------------------

def wheel_geom(arr, name):
    xs = [v[0] for v in arr["V"]]
    ys = [v[1] for v in arr["V"]]
    zs = [v[2] for v in arr["V"]]
    xc = (min(xs) + max(xs)) / 2
    yc = (min(ys) + max(ys)) / 2
    zc = (min(zs) + max(zs)) / 2
    R = max(math.hypot(y - yc, z - zc) for y, z in zip(ys, zs))
    return {"name": name, "side": 1 if xc > 0 else -1, "xc": xc, "yc": yc, "zc": zc, "R": R}


def analyse(body, wheels_raw, lamps_raw):
    """body: arrays for the body mesh. wheels_raw/lamps_raw: lists of (name, arrays).
    Returns one JSON-ready dict of measurements plus per-region labels for rendering."""
    m = Mesh(body["V"], body["F"], body["N"], body["A"], body["C"])
    topo = topology(m)
    mirror = mirror_stats(m)
    wheels = [wheel_geom(arr, name) for name, arr in wheels_raw]
    ctx = body_context(m, wheels)
    win, wins = glass_windows(m)
    pid, pat = patches(m)
    labels, beltline = label_faces(m, ctx, pid, pat, win, wins)
    rid, regs = regions_for(m, labels, ctx)
    regions = region_records(m, labels, rid, regs, ctx)
    glass = glass_records(m, labels, rid, regs, ctx)
    arches = arch_records(m, labels, ctx)
    under = underbody_record(m, labels, topo, ctx)
    body_pts = list(m.V)
    wheel_out = []
    for (name, arr), w in zip(wheels_raw, wheels):
        wm = Mesh(arr["V"], arr["F"], arr["N"], arr["A"], arr["C"])
        wheel_out.append(wheel_record(wm, w))
    lamp_out = []
    for name, arr in lamps_raw:
        lm = Mesh(arr["V"], arr["F"], arr["N"], arr["A"], arr["C"])
        lamp_out.append(lamp_record(lm, name, body_pts))
    topo.pop("_boundary", None)
    return {
        "body_ctx": {k: ctx[k] for k in ("xmin", "xmax", "ymin", "ymax", "zmin", "zmax", "hw", "L", "H")},
        "beltline_m": round(beltline, 4),
        "beltline_frac": round((beltline - ctx["zmin"]) / ctx["H"], 3),
        "topology": topo,
        "mirror": mirror,
        "patch_count": len(pat),
        "glass_windows": glass,
        "regions": regions,
        "arches": arches,
        "underbody": under,
        "wheels": wheel_out,
        "lamps": lamp_out,
        "_labels": labels,
        "_rid": rid,
    }
