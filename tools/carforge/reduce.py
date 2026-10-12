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
from mathutils import Matrix, Vector, geometry
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import carforge as cf  # noqa: E402  (Blender module: its main() is guarded)

SHARP_DEG = 32.0     # faces meeting at more than this keep a hard edge
SHELL_SKIN_MM = 25.0   # a trim vertex this close to the shell, or outside it, is on the surface
SHELL_OUTSIDE = 0.6    # share of a trim piece's vertices that must be on or outside the shell
RAY_MM = 12.0        # spacing of the visibility rays
MIN_HITS = 6         # a trim part seen by fewer rays than this is hidden (inside the body)
CAR_AXIS_Z = 650.0   # mm: the height of the car's middle line a piece's faces should face away from
PANE_EDGE_COS = 0.35  # a glass face within ~70° of square to the line from the car's centre is an edge
PANEL_OFF_SURFACE = 4.0  # mm a panel's triangle or corner may stand off the surface it came from
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


def decimate_to(bm, tris, panel=None):
    """Reduce a bmesh to about `tris` triangles, then, with `panel` (degrees), in the pack's
    construction: neighbouring faces within that angle are dissolved into one polygon (a panel)
    and re-triangulated across it, so the surface is a few large triangles per panel meeting at
    folds and flat shading shows a panel as one shade, not a crumpled fan of small triangles each
    tilted a little. Collapse first: it keeps the silhouette, then the panels. (Flattening each
    panel onto a plane as well tore the tailgate open where neighbouring panels pulled a shared
    vertex two ways.)"""
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=0.5)  # the source's triangles are loose
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
    if panel:
        before = bm.copy()  # the collapsed surface, which a panel's triangles must stay on
        tree = BVHTree.FromBMesh(before)
        bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(panel), use_dissolve_boundaries=False,
                                 verts=bm.verts[:], edges=bm.edges[:], delimit={"NORMAL"})
        restore_off_surface_panels(bm, before, tree)
        before.free()
    # BEAUTY: a concave panel ear-clipped left slivers that shade as stray dark shapes
    bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method="BEAUTY", ngon_method="BEAUTY")
    return bm


def restore_off_surface_panels(bm, before, tree):
    """Rule: a panel's triangles lie on the surface it was dissolved from. A dissolved ngon that
    is not flat (a seal bending round a window, the bonnet's lip over the grille) triangulates
    across itself: triangles spanning the opening, which flat shading shows as dark shapes over
    the glass or a spike off the bonnet. Each panel is triangulated on a copy; if any triangle's
    centre stands more than PANEL_OFF_SURFACE mm off the surface, the panel is replaced by the
    faces it was made of (dissolving removes vertices but moves none, so they are found by
    position)."""
    bad = []
    for f in bm.faces:
        if len(f.verts) <= 3:
            continue
        pts = [v.co.copy() for v in f.verts]
        f.normal_update()
        c = f.calc_center_median()
        flat = max(abs((p - c).dot(f.normal)) for p in pts) <= PANEL_OFF_SURFACE
        tris = geometry.tessellate_polygon([pts])
        if not flat or any(tree.find_nearest(sum((pts[i] for i in t), Vector()) / 3)[3] > PANEL_OFF_SURFACE
                           for t in tris):
            bad.append(f)
    if not bad:
        return
    after = BVHTree.FromBMesh(bm)
    owner = {}
    for g in before.faces:  # which dissolved panel each collapsed face became part of
        idx = after.find_nearest(g.calc_center_median())[2]
        owner.setdefault(idx, []).append(g)
    bm.faces.ensure_lookup_table()
    lookup = {tuple(round(c, 2) for c in v.co): v for v in bm.verts}
    restore = [g for f in bad for g in owner.get(f.index, [])]
    bmesh.ops.delete(bm, geom=bad, context="FACES_ONLY")
    for g in restore:
        vs = []
        for v in g.verts:
            key = tuple(round(c, 2) for c in v.co)
            if key not in lookup:  # a vertex the dissolve removed: back it comes
                lookup[key] = bm.verts.new(v.co)
            vs.append(lookup[key])
        try:
            bm.faces.new(vs)
        except ValueError:
            pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=0.01)


def append(dst, uvl, src, cell_of, axis):
    """Copy src's faces into dst; each face's UV is its cell's centre (cell_of(face centre)).
    Each connected piece is first made consistent and turned outward: a piece whose faces mostly
    face the car's axis is flipped. A face that ends up glass is judged on its own against the
    axis (`axis`: the segment [(y0), (y1)] at CAR_AXIS_Z it faces away from): facing in, it is
    turned out (the GTA Oka's back light is a trim plate drawn inside out); standing across that
    direction it is a pane's edge, which flat shading shows as a dark triangle over the glass,
    and it is dropped. Faces are flat shaded, as the pack's are."""
    def away(c):
        y = min(max(c.y, axis[0]), axis[1])
        return c - Vector((0.0, y, CAR_AXIS_Z))

    bmesh.ops.recalc_face_normals(src, faces=src.faces[:])
    src.faces.index_update()
    for faces in loose_parts(src):
        total = sum(f.calc_area() for f in faces)
        if sum(f.calc_area() for f in faces if f.normal.dot(away(f.calc_center_median())) < 0) > 0.5 * total:
            bmesh.ops.reverse_faces(src, faces=faces)
    src.normal_update()
    cells, flip, edges = {}, [], []
    for f in src.faces:
        c = f.calc_center_median()
        cells[f] = cell_of(c)
        if cells[f] == "glass":
            d = f.normal.dot(away(c).normalized())
            (edges if abs(d) < PANE_EDGE_COS else flip if d < 0 else []).append(f)
    bmesh.ops.reverse_faces(src, faces=flip)
    gone = set(edges)
    vmap = {}
    for v in src.verts:
        vmap[v] = dst.verts.new(v.co * cf.MM)  # the frame is mm, carforge's meshes are metres
    for f in src.faces:
        if f in gone:
            continue
        try:
            g = dst.faces.new([vmap[v] for v in f.verts])
        except ValueError:
            continue
        g.smooth = False
        uv = cf.uv_of_cell(cf.CELLS[cells[f]])
        for loop in g.loops:
            loop[uvl].uv = uv


def sample_points(bm, step):
    """Points on every face of `bm` (frame mm), no two further apart than about `step`: each
    triangle's barycentric grid."""
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    out = []
    for f in bm.faces:
        a, b, c = (v.co for v in f.verts)
        n = max(1, int(math.ceil(max((a - b).length, (b - c).length, (c - a).length) / step)))
        for i in range(n + 1):
            for j in range(n + 1 - i):
                p = a + (b - a) * (i / n) + (c - a) * (j / n)
                out.append((p.x, p.y, p.z))
    return out


def voxel_surface(solid, origin, voxel):
    """The boundary of a voxel solid as quads (frame mm): one per face between a solid voxel and
    an empty one, corners on the voxel lattice. The skin is closed, so the caller makes the
    winding consistent (recalc_face_normals)."""
    import numpy as np
    pad = np.pad(solid, 1)
    corner0 = np.asarray(origin, float) - voxel * 1.5  # lattice corner 0 of the padded grid
    verts, index, faces = [], {}, []

    def vid(k):
        if k not in index:
            index[k] = len(verts)
            verts.append(tuple(corner0 + voxel * np.asarray(k, float)))
        return index[k]

    for axis in range(3):
        lo = np.take(pad, range(0, pad.shape[axis] - 1), axis=axis)
        hi = np.take(pad, range(1, pad.shape[axis]), axis=axis)
        u, w = [d for d in range(3) if d != axis]
        for p in np.argwhere(lo != hi):
            quad = []
            for du, dw in ((0, 0), (1, 0), (1, 1), (0, 1)):
                c = [int(p[0]), int(p[1]), int(p[2])]
                c[axis] += 1
                c[u] += du
                c[w] += dw
                quad.append(vid(tuple(c)))
            faces.append(quad)
    return verts, faces


def add_skin(cfg, source, body_bm, uvl):
    """A closed skin under the panels (`skin: {voxel_mm, close_mm, inset_mm, tris}`). A game
    reference is a set of panels (doors, bonnet, wings, bumpers, the seals round the glass) with
    slits between them and nothing underneath, so the sky shows through the car. The kept
    surface (`source`: [(bm in frame mm, cell_of)], before decimation) is closed into a solid by
    `solid.py` (slits filled, cabin and underbody shut), its voxel boundary smoothed, moved
    `inset_mm` in along its normals and reduced to `tris`: the car's inner panels. Each face
    takes the cell of the reference face nearest it, so through a slit the eye meets the colour
    of the panels round it. The skin is closed whatever the panels do, so the body is
    watertight. (Making the skin the body itself, reduced to panels, lost the window frames'
    crisp edges to the voxels and dented where it was laid back on the reference.)"""
    import subprocess
    import tempfile
    import numpy as np
    voxel = float(cfg.get("voxel_mm", 10.0))
    close = float(cfg.get("close_mm", 20.0))
    src = bmesh.new()
    cell_layer = src.faces.layers.int.new("cell")
    names = []
    for bm, cell_of in source:
        me = bpy.data.meshes.new("src")
        bm.to_mesh(me)
        part = bmesh.new()
        part.from_mesh(me)
        bpy.data.meshes.remove(me)
        for f in part.faces:
            name = cell_of(f.calc_center_median())
            if name not in names:
                names.append(name)
            vs = [src.verts.new(v.co) for v in f.verts]
            try:
                g = src.faces.new(vs)
            except ValueError:
                continue
            g[cell_layer] = names.index(name)
        part.free()
    bmesh.ops.remove_doubles(src, verts=src.verts[:], dist=0.5)
    tree = BVHTree.FromBMesh(src)
    src.faces.ensure_lookup_table()
    cells = [names[f[cell_layer]] for f in src.faces]

    with tempfile.TemporaryDirectory() as tmp:
        surf, out = os.path.join(tmp, "surface.npz"), os.path.join(tmp, "solid.npz")
        np.savez_compressed(surf, points=np.asarray(sample_points(src.copy(), voxel / 3), float))
        run = subprocess.run(["python3", os.path.join(os.path.dirname(os.path.abspath(__file__)), "solid.py"),
                              surf, out, "--voxel", str(voxel), "--close", str(close)],
                             capture_output=True, text=True)
        if run.returncode:
            fail("solid.py: " + run.stderr.strip().splitlines()[-1])
        print(run.stdout.strip())
        data = np.load(out)
        verts, faces = voxel_surface(data["solid"], data["origin"], float(data["voxel"]))

    me = bpy.data.meshes.new("solid")
    me.from_pydata(verts, [], faces)
    bm = bmesh.new()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    for _ in range(int(cfg.get("smooth", 8))):  # Taubin: the staircase rounded off, not shrunk
        for k in (0.5, -0.53):
            avg = {v: sum((e.other_vert(v).co for e in v.link_edges), Vector()) / len(v.link_edges)
                   for v in bm.verts}
            for v, c in avg.items():
                v.co += (c - v.co) * k
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.normal_update()

    # each face's cell from the reference face nearest it, then a majority over its neighbours
    # (a seal's sliver or a slit's floor is not a panel), carried through decimation as its UV
    tag = {f: cells[tree.find_nearest(f.calc_center_median())[2]] for f in bm.faces}
    for _ in range(int(cfg.get("cell_smooth", 3))):
        new = {}
        for f, c in tag.items():
            votes = {}
            for e in f.edges:
                for g in e.link_faces:
                    votes[tag[g]] = votes.get(tag[g], 0) + 1
            new[f] = max(votes, key=votes.get)
        tag = new
    order = sorted(set(tag.values()))
    cl = bm.loops.layers.uv.new("cell")
    for f, c in tag.items():
        for loop in f.loops:
            loop[cl].uv = (order.index(c) + 0.5, 0.5)
    decimate_to(bm, int(cfg.get("tris", 2000)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.normal_update()
    # in by `inset_mm`, under the reference everywhere: the closing laid the skin over recesses
    # (a pane set in its frame) and decimation cut chords out of hollows, so a vertex goes to
    # `inset` under the reference face it looks at, or along its own normal where none faces it.
    # A thin part (a bumper's wing, a sill) is not crossed: at most 0.4 of its thickness.
    inset = float(cfg.get("inset_mm", 8.0))
    own = BVHTree.FromBMesh(bm)
    moves = {}
    for v in bm.verts:
        _, _, _, t = own.ray_cast(v.co - v.normal * 0.1, -v.normal)
        want = inset if t is None else min(inset, 0.4 * t)
        loc, normal, _, _ = tree.find_nearest(v.co)
        if loc is None or abs(normal.dot(v.normal)) < 0.7:
            moves[v] = -v.normal * want
            continue
        n = normal if normal.dot(v.normal) > 0 else -normal
        moves[v] = n * ((loc - v.co).dot(n) - want)
    for v, d in moves.items():
        v.co += d

    cl = bm.loops.layers.uv["cell"]
    vmap = {v: body_bm.verts.new(v.co * cf.MM) for v in bm.verts}  # mm to carforge's metres
    n = 0
    for f in bm.faces:
        try:
            g = body_bm.faces.new([vmap[v] for v in f.verts])
        except ValueError:
            continue
        g.smooth = False
        idx = sorted(int(loop[cl].uv.x) for loop in f.loops)[1]  # the corners' majority
        uv = cf.uv_of_cell(cf.CELLS[order[min(max(idx, 0), len(order) - 1)]])
        for loop in g.loops:
            loop[uvl].uv = uv
        n += 1
    bm.free()
    src.free()
    return n


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
    def dropped(bm, drop):
        """A detail the pack does not have: a piece smaller than `drop.min_mm` every way (bolts,
        badges) or centred in a `drop.boxes` box (wipers, the number plates, a tow hook, the
        headliner seen through the glass); a box given as {box, max_mm} takes only pieces no
        larger than that (a wiper over the glass, not the seal round it). `drop` is the trim's
        (`trim.drop`) or a whole part's own (`parts.<name>.drop`)."""
        if not bm.verts:
            return True
        lo = Vector([min(v.co[i] for v in bm.verts) for i in range(3)])
        hi = Vector([max(v.co[i] for v in bm.verts) for i in range(3)])
        size = max(hi - lo)
        if size < float(drop.get("min_mm", 0.0)):
            return True
        for b in drop.get("boxes", []):
            box, cap = (b["box"], float(b["max_mm"])) if isinstance(b, dict) else (b, math.inf)
            if size <= cap and in_box((lo + hi) / 2, box):
                return True
        return False

    # the line the body's faces face away from: the car's centre line between the axles
    axis = (0.0, float(cfg["wheels"]["wheelbase"]))
    source = []  # `skin`: the kept surface with its cells, before decimation
    for (kind, key), bm, h in zip(names, groups, hits):
        if kind == "trim":
            if (sum(h) >= MIN_HITS and not dropped(bm, cfg["trim"].get("drop", {}))
                    and (shell is None or outside(bm) >= SHELL_OUTSIDE)):
                tmp = bm.copy()
                tmp.to_mesh(me := bpy.data.meshes.new("t"))
                kept_trim.from_mesh(me)
                bpy.data.meshes.remove(me)
            continue
        # a whole part: drop the faces no ray reached, and the loose pieces its `drop` names
        spec = cfg["parts"][key]
        bm.faces.ensure_lookup_table()
        hidden = [f for f, n in zip(bm.faces, h) if n == 0]
        bmesh.ops.delete(bm, geom=hidden, context="FACES")
        if spec.get("drop"):  # welded first: the source's triangles are loose
            bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=0.5)
            bm.faces.index_update()
            for faces in loose_parts(bm):
                piece = bmesh.new()
                for v in {v for f in faces for v in f.verts}:
                    piece.verts.new(v.co)
                if dropped(piece, spec["drop"]):
                    bmesh.ops.delete(bm, geom=faces, context="FACES")
                piece.free()
        if "skin" in cfg:  # the closed skin under the panels is made of the full surface
            source.append((bm.copy(), lambda p, c=spec["cell"]: override(p, c)))
        decimate_to(bm, spec["tris"], spec.get("panel"))
        stats[key] = len(bm.faces)
        append(body_bm, uvl, bm, lambda p, c=spec["cell"]: override(p, c), axis)
    tc = cfg["trim"]
    chrome = tc.get("chrome", [])

    def trim_cell(p):
        return override(p, "chrome" if any(in_box(p, b) for b in chrome) else tc["cell"])

    if "skin" in cfg:
        source.append((kept_trim.copy(), trim_cell))
    decimate_to(kept_trim, tc["tris"], tc.get("panel"))
    stats["trim"] = len(kept_trim.faces)
    append(body_bm, uvl, kept_trim, trim_cell, axis)
    if "skin" in cfg:
        stats["skin"] = add_skin(cfg["skin"], source, body_bm, uvl)
        for bm, _ in source:
            bm.free()

    body = cf.finish(body_bm, f"{cid}.body")
    if not cfg.get("flat"):  # smooth panels, sharp creases; `flat`: the pack's flat panels
        split = body.modifiers.new("split", "EDGE_SPLIT")
        split.split_angle = math.radians(SHARP_DEG)
    out_objs = [body]
    for lp in cfg.get("lamps", []):
        bm = to_bm(objs[lp["mesh"]], m)
        if "box" in lp:
            gone = [f for f in bm.faces if not in_box(f.calc_center_median(), lp["box"])]
            bmesh.ops.delete(bm, geom=gone, context="FACES")
        if not bm.faces:
            fail(f"lamp {lp['role']}: no faces of {lp['mesh']} in its box")
        decimate_to(bm, lp.get("tris", 40), lp.get("panel"))
        lbm, luvl = cf.new_bm()
        append(lbm, luvl, bm, lambda p, c=cf.LAMP_CELL[lp["role"]]: c, axis)
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
