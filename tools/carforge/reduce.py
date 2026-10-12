"""Reduce a detailed reference car (glTF) to the Soviet pack's form (run inside Blender).

    blender --background --factory-startup --python tools/carforge/reduce.py -- <reduce.json> <out.fbx>

For a car whose detailed model exists (an AKROM GTA conversion on the carimport branch) the
shape is taken from it instead of being traced: every panel, pillar, glass edge and fold is
the real car's. What this script does is the pack's construction:

1. Frame. The model is put in carforge's frame (mm, nose at -y, +x the car's left, z up), the
   front hub at y = 0, levelled so both hubs are on one row, scaled to the factory wheelbase,
   the ground at z = 0 under a tyre of the spec's radius.
2. Visible parts only. The trim mesh is split into its loose parts and each part is kept if
   rays cast at the car from outside (`VIEW_DIRS`, an orthographic grid every `RAY_MM`) hit it
   at least `MIN_HITS` times: bumpers, grille, mirrors, seals and handles stay, the cabin, the
   frame and the engine go. Paint faces no ray reaches (door jambs, inner skins) are dropped.
3. Density. Each kept group is decimated (collapse) to its `tris` budget, welded, and
   triangulated; faces are shaded flat, as the pack is.
4. Atlas. Every face gets the UV of one cell of the pack's palette (carforge `CELLS`): paint,
   glass, black trim, chrome. Lamps become `<id>.body.<role>` objects in the lamp cells, wheels
   are the pack wheel scaled to the spec (carforge `build_wheels`), so the game loads the result
   exactly as a carforge body.

The config (JSON):
  id, src                 object name prefix; the glTF
  parts                   {mesh name: {cell, tris}}: groups kept whole (paint, glass); {} with `shell`
  shell                   optional carforge FBX: its `<id>.body` is the body (watertight, floored), and
                          of the reference only the trim on or outside it is kept
  trim                    {mesh, cell, tris, chrome?: [[x0,y0,z0,x1,y1,z1] mm boxes painted chrome]}
  cells                   [{box, cell}]: faces of the body (paint, glass, trim) inside a box take that
                          cell (the first box wins): the engine bay seen through the grille, black
  lamps                   [{mesh, role, box?: [x0,y0,z0,x1,y1,z1] mm in the output frame}]: the
                          lamp mesh's parts inside the box (or all) become a lamp object
  wheels                  carforge spec `wheels` (radius, width, track_front, track_rear, wheelbase)
  hubs                    {front: mesh, rear: mesh}: the wheel meshes whose centres are the hubs
"""

import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import carforge as cf  # noqa: E402  (Blender module: its main() is guarded)

SHARP_DEG = 32.0     # faces meeting at more than this keep a hard edge
SHELL_SKIN_MM = 25.0   # a trim vertex this close to the shell, or outside it, is on the surface
SHELL_OUTSIDE = 0.6    # share of a trim piece's vertices that must be on or outside the shell
RAY_MM = 12.0        # spacing of the visibility rays
MIN_HITS = 6         # a trim part seen by fewer rays than this is hidden (inside the body)
# directions the car is looked at from (towards the car): all round at three elevations, and
# from straight above; never from below (the pack has no underside detail)
VIEW_DIRS = [(math.cos(a) * math.cos(e), math.sin(a) * math.cos(e), -math.sin(e))
             for e in (math.radians(-8), math.radians(15), math.radians(40))
             for a in [k * math.pi / 8 for k in range(16)]] + [(0.0, 0.0, -1.0)]


def fail(msg):
    raise SystemExit("reduce: " + msg)


def centre_of(obj):
    pts = [obj.matrix_world @ v.co for v in obj.data.vertices]
    return sum(pts, Vector()) / len(pts)


def frame_matrix(cfg, objs):
    """World -> carforge frame (mm): level the hubs, front hub at y 0, scale to the wheelbase."""
    f = centre_of(objs[cfg["hubs"]["front"]])
    r = centre_of(objs[cfg["hubs"]["rear"]])
    f.x = r.x = 0.0
    run, rise = r.y - f.y, r.z - f.z
    level = Matrix.Rotation(-math.atan2(rise, run), 4, "X")
    scale = cfg["wheels"]["wheelbase"] / math.hypot(run, rise)  # metres -> mm
    hub_z = cfg["wheels"]["radius"]
    return Matrix.Translation((0.0, 0.0, hub_z)) @ Matrix.Scale(scale, 4) @ level @ Matrix.Translation(-f)


def to_bm(obj, m):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.transform(bm, matrix=m @ obj.matrix_world, verts=bm.verts)
    return bm


def loose_parts(bm):
    """Lists of faces, one per connected piece."""
    seen, parts = set(), []
    for f in bm.faces:
        if f.index in seen:
            continue
        stack, part = [f], []
        seen.add(f.index)
        while stack:
            g = stack.pop()
            part.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen:
                        seen.add(h.index)
                        stack.append(h)
        parts.append(part)
    return parts


def visibility(groups):
    """groups: [bm, …] in the output frame. Returns per group a list of hit counts per face."""
    verts, polys, owner = [], [], []
    for gi, bm in enumerate(groups):
        bm.faces.ensure_lookup_table()
        base = len(verts)
        verts += [v.co.copy() for v in bm.verts]
        index = {v: i for i, v in enumerate(bm.verts)}
        for f in bm.faces:
            polys.append([base + index[v] for v in f.verts])
            owner.append((gi, f.index))
    tree = BVHTree.FromPolygons(verts, polys)
    lo = Vector([min(v[i] for v in verts) for i in range(3)])
    hi = Vector([max(v[i] for v in verts) for i in range(3)])
    centre, radius = (lo + hi) / 2, (hi - lo).length / 2 + 100.0
    hits = [[0] * len(bm.faces) for bm in groups]
    for d in VIEW_DIRS:
        d = Vector(d).normalized()
        u = d.cross(Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))).normalized()
        w = d.cross(u)
        n = int(2 * radius / RAY_MM)
        for i in range(n):
            for j in range(n):
                o = centre - d * radius * 2 + u * (-radius + i * RAY_MM) + w * (-radius + j * RAY_MM)
                _, _, idx, _ = tree.ray_cast(o, d, radius * 4)
                if idx is not None:
                    gi, fi = owner[idx]
                    hits[gi][fi] += 1
    return hits


def decimate_to(bm, tris):
    """Collapse-decimate a bmesh to about `tris` triangles (through a temporary object)."""
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    now = len(bm.faces)
    if now > tris > 0:
        me = bpy.data.meshes.new("tmp")
        bm.to_mesh(me)
        ob = bpy.data.objects.new("tmp", me)
        bpy.context.scene.collection.objects.link(ob)
        mod = ob.modifiers.new("d", "DECIMATE")
        mod.ratio = tris / now
        mod.use_collapse_triangulate = True
        dg = bpy.context.evaluated_depsgraph_get()
        bm.clear()
        bm.from_mesh(ob.evaluated_get(dg).to_mesh())
        bpy.data.objects.remove(ob)
        bpy.data.meshes.remove(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=0.5)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges[:], dist=0.5)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    return bm


def append(dst, uvl, src, cell_of):
    """Copy src's faces into dst; each face's UV is its cell's centre (cell_of(face centre))."""
    vmap = {}
    for v in src.verts:
        vmap[v] = dst.verts.new(v.co * cf.MM)  # the frame is mm, carforge's meshes are metres
    for f in src.faces:
        try:
            g = dst.faces.new([vmap[v] for v in f.verts])
        except ValueError:
            continue
        g.smooth = True
        uv = cf.uv_of_cell(cf.CELLS[cell_of(f.calc_center_median())])
        for loop in g.loops:
            loop[uvl].uv = uv


def in_box(p, box):
    return box[0] <= p.x <= box[3] and box[1] <= p.y <= box[4] and box[2] <= p.z <= box[5]


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    cfg_path, out = argv[0], argv[1]
    with open(cfg_path) as fh:
        cfg = json.load(fh)
    cid = cfg["id"]

    def override(p, cell):
        for o in cfg.get("cells", []):  # [{box, cell}]: the first box holding the face wins
            if in_box(p, o["box"]):
                return o["cell"]
        return cell
    cf.clear_scene()
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(cfg["src"]))
    objs = {o.name: o for o in bpy.context.scene.objects if o.type == "MESH"}
    m = frame_matrix(cfg, objs)

    # `shell`: the body is a carforge build (watertight, with a floor); the reference gives only
    # its trim pieces that stand on or outside that shell (bumpers, grille, mirrors, handles, seals)
    shell = None
    if "shell" in cfg:
        before = set(bpy.data.objects)
        bpy.ops.import_scene.fbx(filepath=os.path.abspath(cfg["shell"]))
        new = [o for o in bpy.data.objects if o not in before]
        shell = next(o for o in new if o.name == f"{cid}.body")
        sbm = bmesh.new()
        sbm.from_mesh(shell.data)
        sbm.transform(shell.matrix_world)
        sbm.transform(Matrix.Scale(1 / cf.MM, 4))  # metres -> the frame's mm
        shell_tree = BVHTree.FromBMesh(sbm)
        for o in new:
            if o is not shell:
                bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.objects.remove(shell, do_unlink=True)
        shell = (sbm, shell_tree)

    def outside(bm):
        """Share of a piece's vertices lying outside the shell or within SHELL_SKIN_MM of it."""
        sbm, t = shell
        n = 0
        for v in bm.verts:
            loc, nrm, _, d = t.find_nearest(v.co)
            if loc is not None and ((v.co - loc).dot(nrm) > -SHELL_SKIN_MM or d < SHELL_SKIN_MM):
                n += 1
        return n / max(1, len(bm.verts))

    # groups: whole parts (paint, glass) and the trim split into loose pieces
    names, groups = [], []
    for name in cfg["parts"]:
        names.append(("part", name))
        groups.append(to_bm(objs[name], m))
    trim = to_bm(objs[cfg["trim"]["mesh"]], m)
    lamp_boxes = [lp["box"] for lp in cfg.get("lamps", []) if lp["mesh"] == cfg["trim"]["mesh"] and "box" in lp]
    if lamp_boxes:
        bmesh.ops.delete(trim, geom=[f for f in trim.faces
                                     if any(in_box(f.calc_center_median(), b) for b in lamp_boxes)], context="FACES")
    pieces = loose_parts(trim)
    trim_bms = []
    for faces in pieces:
        bm = bmesh.new()
        vmap = {}
        for f in faces:
            for v in f.verts:
                if v not in vmap:
                    vmap[v] = bm.verts.new(v.co)
            try:
                bm.faces.new([vmap[v] for v in f.verts])
            except ValueError:
                pass
        trim_bms.append(bm)
    names += [("trim", i) for i in range(len(trim_bms))]
    groups += trim_bms
    hits = visibility(groups)

    body_bm, uvl = cf.new_bm()
    if shell is not None:  # the carforge shell keeps its own atlas UVs
        sbm = shell[0].copy()
        sbm.transform(Matrix.Scale(cf.MM, 4))
        me = bpy.data.meshes.new("shell")
        sbm.to_mesh(me)
        body_bm.from_mesh(me)
        bpy.data.meshes.remove(me)
        uvl = body_bm.loops.layers.uv.active
        for f in body_bm.faces:
            f.smooth = False
    kept_trim = bmesh.new()
    stats = {}
    for (kind, key), bm, h in zip(names, groups, hits):
        if kind == "trim":
            if sum(h) >= MIN_HITS and (shell is None or outside(bm) >= SHELL_OUTSIDE):
                tmp = bm.copy()
                tmp.to_mesh(me := bpy.data.meshes.new("t"))
                kept_trim.from_mesh(me)
                bpy.data.meshes.remove(me)
            continue
        # a whole part: drop the faces no ray reached
        bm.faces.ensure_lookup_table()
        hidden = [f for f, n in zip(bm.faces, h) if n == 0]
        bmesh.ops.delete(bm, geom=hidden, context="FACES")
        spec = cfg["parts"][key]
        decimate_to(bm, spec["tris"])
        stats[key] = len(bm.faces)
        append(body_bm, uvl, bm, lambda p, c=spec["cell"]: override(p, c))
    tc = cfg["trim"]
    decimate_to(kept_trim, tc["tris"])
    stats["trim"] = len(kept_trim.faces)
    chrome = tc.get("chrome", [])
    append(body_bm, uvl, kept_trim,
           lambda p: override(p, "chrome" if any(in_box(p, b) for b in chrome) else tc["cell"]))

    body = cf.finish(body_bm, f"{cid}.body")
    # panels shade smooth, creases (angle over SHARP_DEG) and cell borders stay sharp: the decimated
    # surface is many small triangles, which flat shading turns into crumpled noise
    split = body.modifiers.new("split", "EDGE_SPLIT")  # flat shell faces stay flat (all edges split)
    split.split_angle = math.radians(SHARP_DEG)
    out_objs = [body]
    for lp in cfg.get("lamps", []):
        bm = to_bm(objs[lp["mesh"]], m)
        if "box" in lp:
            gone = [f for f in bm.faces if not in_box(f.calc_center_median(), lp["box"])]
            bmesh.ops.delete(bm, geom=gone, context="FACES")
        if not bm.faces:
            fail(f"lamp {lp['role']}: no faces of {lp['mesh']} in its box")
        decimate_to(bm, lp.get("tris", 40))
        lbm, luvl = cf.new_bm()
        append(lbm, luvl, bm, lambda p, c=cf.LAMP_CELL[lp["role"]]: c)
        out_objs.append(cf.finish(lbm, f"{cid}.body.{lp['role']}"))
    # several sources for one role join into one object (the game lights a role's object whole)
    by_role = {}
    for o in out_objs[1:]:
        by_role.setdefault(o.name.split(".")[2], []).append(o)
    joined = [body]
    for role, os_ in by_role.items():
        if len(os_) > 1:
            with bpy.context.temp_override(active_object=os_[0], selected_editable_objects=os_):
                bpy.ops.object.join()
        os_[0].name = f"{cid}.body.{role}"
        joined.append(os_[0])
    tmpl, pts, pack_w, pack_r = cf.load_pack_wheel(cf.PACK_WHEEL)
    cf.build_wheels({"wheels": cfg["wheels"]}, cid, joined, tmpl, pts, pack_w, pack_r)
    bpy.data.meshes.remove(tmpl)
    cf.export(joined, out)
    summary = cf.summarise(joined)
    print("REDUCE " + json.dumps({"tris": {k: v["tris"] for k, v in summary.items()}, "kept": stats,
                                  "trim_pieces": len(trim_bms)}))


if __name__ == "__main__":
    main()
