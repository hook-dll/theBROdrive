"""Grass sprite atlas, bush atlases and the bush model, rendered in Blender.

    Blender --background --factory-startup --python plants.py -- <job> <outdir>

Jobs:
    preview   outdir/preview.png — contact sheet of the candidate CC0 plant models
    grass     outdir/grass_cell<i>.png (8 x 256^2) + outdir/grass_flora_cell3.png
    bush      outdir/bush_<season>_slot<i>.png (4 seasons x 4 x 512^2) + bush.glb

The source models are Poly Haven CC0 *real 3D plants* — thousands of vertices of
actual blades, leaflets and stems, no alpha cards — which is why a tuft holds up
when a car passes a metre away. A cell is a small scene of a few clumps at
jittered positions and random yaw, so a sprite reads as one tuft instead of one
clump photographed once.

Grass is rendered as luminance only: the game tints every tuft with the same
colour function it tints the ground with, so baking colour into the sprite would
fight it (docs/slowroads-steam/notes/SrGrass.md §1). Bushes keep their photo
colour and get a per-season grade, because a bush is always seen against
something else.

Each cell is rendered in its own square orthographic frame (frame_m, repeated in
public/look/manifest.json): the plants' base sits at v=0 of the cell and the
tallest plant reaches ~0.93 v, so a cell's world size equals its frame. The JS
driver then tiles the cells into one atlas image. A single uniform frame for all
cells would either waste atlas space or blur the short tufts, and the short ones
are the ones seen closest.
"""

import json
import math
import os
import random
import sys
import zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import lib as L  # noqa: E402

LOOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PH = os.path.join(LOOK, '.cache', 'ph-files')


def ph_model(model_id):
    return os.path.join(PH, model_id, f'{model_id}_1k.gltf')


def ph_dry(model_id):
    return os.path.join(PH, model_id, 'dry_diff.png')


def ph_diffuse(model_id):
    """Green-season colour. Poly Haven publishes a PNG diffuse whose alpha is the
    plant cutout, and a separate single-channel Alpha map; the JPEGs that the
    gltf bundle references carry no alpha at all, which is why a card rendered
    without them shows the atlas' black background as a solid rectangle."""
    return os.path.join(PH, model_id, 'Diffuse.png')


def ph_alpha(model_id):
    return os.path.join(PH, model_id, 'Alpha.png')


# --------------------------------------------------------------------------- #
# importing CC0 plant models


_KITS = {}


def kit(model_id, dry=False):
    """{clump name: dict(parts, h, w, cx, diffuse)} for a Poly Haven plant pack.

    These packs are *kits*: the gltf lays a dozen plant variants out along +X,
    each with its own scale (grass_bermuda_01 is 21 separate blades and tufts
    from 0.02 m to 0.15 m; fir_tree_01 is three whole 14-19 m trees). So every
    mesh is re-centred on its own bounding box and stands on z=0, and a recipe
    asks for clumps by name. `dry` swaps in the asset's published dry diffuse.
    """
    key = (model_id, dry)
    if key in _KITS:
        return _KITS[key]
    path = ph_model(model_id)
    if not os.path.exists(path):
        raise RuntimeError(f'{model_id}: {path} missing — run node tools/look/build.mjs')
    objs = L.import_gltf(path)
    meshes = [o for o in objs if o.type == 'MESH']
    if not meshes:
        raise RuntimeError(f'{model_id}: no meshes in {path}')
    def slot_diffuses(o):
        """The base-colour image of every material slot of THIS object.

        It has to be per slot, not per object and not per pack. A pack like
        conifer packs ship bark, trunk and twig sheets, and one sheet for the whole
        pack painted every needle with whichever sheet happened to be scanned last
        — an orange-brown bark, which is why the first conifer impostors came out
        looking dead. One sheet for the whole *object* is not enough either: the
        conifer meshes carry bark, trunk and twig as separate material slots, so a
        whole-object choice painted the trunk with the twig sheet.
        """
        best = []
        for mat in o.data.materials:
            pick, score = None, -1
            if mat and mat.node_tree:
                for node in mat.node_tree.nodes:
                    if node.type != 'TEX_IMAGE' or not node.image:
                        continue
                    name = os.path.basename(node.image.filepath).lower()
                    if any(k in name for k in ('nor_gl', '_nor', 'rough', 'arm_', 'disp', 'alpha')):
                        continue
                    sc = ('twig' in name) * 4 + ('needle' in name) * 3 + ('leaf' in name) * 2 + ('diff' in name)
                    if sc > score:
                        pick, score = node.image.filepath, sc
            best.append(pick)
        return best

    diffuse = None
    slots = {}
    for o in meshes:
        o.data.transform(o.matrix_world)
        o.matrix_world = Matrix.Identity(4)
        own = slot_diffuses(o)
        slots[o.name] = own
        diffuse = diffuse or next((d for d in own if d), None)
    if os.path.exists(ph_diffuse(model_id)):
        diffuse = ph_diffuse(model_id)
    if dry and os.path.exists(ph_dry(model_id)):
        diffuse = ph_dry(model_id)
    alpha = ph_alpha(model_id)
    if not os.path.exists(alpha):
        # fall back to the PNG diffuse, whose alpha is the same cutout
        alt = ph_diffuse(model_id)
        alpha = alt if os.path.exists(alt) else None
    out = {}
    for o in meshes:
        lo = [min(v.co[i] for v in o.data.vertices) for i in range(3)]
        hi = [max(v.co[i] for v in o.data.vertices) for i in range(3)]
        h = hi[2] - lo[2]
        if h < 1e-4:
            continue
        shift = Matrix.Translation((-(lo[0] + hi[0]) * 0.5, -(lo[1] + hi[1]) * 0.5, -lo[2]))
        short = o.name[len(model_id):].lstrip('_')
        short = short.replace('_LOD0', '')
        out[short or o.name] = dict(
            parts=[(o.data, shift, [(d or diffuse) for d in slots.get(o.name) or [diffuse]])],
            h=h, w=hi[0] - lo[0], diffuse=diffuse, alpha=alpha)
    for o in objs:
        bpy.data.objects.remove(o, do_unlink=True)
    if not out:
        raise RuntimeError(f'{model_id}: no usable clumps')
    _KITS[key] = out
    return out


def part_diffuse(part, fallback=None):
    """The first texture a kit part has, for the single-material consumers that
    cannot carry one material per slot (grass, bush)."""
    slots = part[2]
    if isinstance(slots, str):
        return slots or fallback
    return next((d for d in slots if d), None) or fallback


def clump(model_id, name, dry=False):
    k = kit(model_id, dry=dry)
    if name not in k:
        raise RuntimeError(f'{model_id}: no clump {name!r}; have {sorted(k)}')
    return k[name]


# --------------------------------------------------------------------------- #
# materials


def _gate_alpha(tree, tex):
    """Cut out the photo sheet's black background whatever the opacity map says:
    a background texel is black, a plant texel is not."""
    mix = [n for n in tree.nodes if n.type == 'MIX_SHADER'][0]
    fac = mix.inputs['Fac'].links[0].from_socket
    lum = L.Vec(tree, tex.outputs['Color']).dot(L.vec_const(tree, 0.2126, 0.7152, 0.0722))
    gate = L.clamp01((lum - 0.010) * 60.0)
    tree.links.new(L.math_node(tree, 'MULTIPLY', fac, gate).socket, mix.inputs['Fac'])


def lum_cutout(name, diffuse, *, gain=1.0, alpha=None):
    """Luminance of the photo texture, cut out by the plant's alpha map and by the
    photo's own black background (see _not_black_gate)."""
    mat = L.cutout_emission(name, diffuse, opacity_path=alpha)
    tree = mat.node_tree
    emit = [n for n in tree.nodes if n.type == 'EMISSION'][0]
    tex = [n for n in tree.nodes if n.type == 'TEX_IMAGE'][0]
    _gate_alpha(tree, tex)
    grey = L.Vec(tree, tex.outputs['Color']).dot(L.vec_const(tree, 0.2126, 0.7152, 0.0722))
    tree.links.new(L.combine_rgb(L.clamp01(grey * gain), L.clamp01(grey * gain), L.clamp01(grey * gain)).socket, emit.inputs['Color'])
    return mat


def graded_cutout(name, diffuse, *, alpha=None, tint=(0.1, 0.2, 0.05), amount=0.3, gain=1.0, snow=0.0,
                  gate=True):
    """Photo colour mixed toward a season colour; snow is mixed in by how much a
    texel faces up, so it settles on leaves and branches, not on stems.

    `gate` is the black-background filter for photo *sheets*. Real geometry must
    not use it: a dark needle would be keyed out and the whole conifer would
    render thin and washed out, which is exactly what the first conifer pass
    looked like."""
    mat = L.cutout_emission(name, diffuse, opacity_path=alpha)
    tree = mat.node_tree
    emit = [n for n in tree.nodes if n.type == 'EMISSION'][0]
    tex = [n for n in tree.nodes if n.type == 'TEX_IMAGE'][0]
    if gate:
        _gate_alpha(tree, tex)
    col = L.Vec(tree, tex.outputs['Color'])
    lum = col.dot(L.vec_const(tree, 0.2126, 0.7152, 0.0722))
    amt = L.clamp01(lum * 0.45 + amount)
    graded = L.mix_vec(col, L.vec_const(tree, *tint), amt)
    if gain != 1.0:
        graded = graded.scale(gain)
    if snow > 0.0:
        up = L.clamp01(L.smoothstep(0.2, 0.8, L.components(tree, L.shading_normal(tree))['Z']))
        graded = L.mix_vec(graded, L.vec_const(tree, 0.9, 0.93, 0.97), up * snow)
    tree.links.new(graded.socket, emit.inputs['Color'])
    return mat


def flora_key(name, diffuse, *, alpha=None):
    """Soft 'this texel is a flower head' mask keyed off photo colour: a yellow or
    white head has red near green and well above blue, foliage does not. Bleached
    straw also keys positive, which is why only the flowering cell is rendered
    with this material."""
    mat = L.cutout_emission(name, diffuse, opacity_path=alpha)
    tree = mat.node_tree
    emit = [n for n in tree.nodes if n.type == 'EMISSION'][0]
    tex = [n for n in tree.nodes if n.type == 'TEX_IMAGE'][0]
    c = L.components(tree, L.Vec(tree, tex.outputs['Color']))
    key = L.clamp01((c['X'] - c['Y'] * 0.82) * 6.0 - 0.25)
    key = L.clamp01(key * L.clamp01((c['X'] - c['Z']) * 2.2 - 0.1))
    tree.links.new(L.combine_rgb(key, key, key).socket, emit.inputs['Color'])
    return mat


# --------------------------------------------------------------------------- #
# umbel heads
#
# Central Russia has no CC0 umbellifer model, and "зонтичные" is a slot the
# renderer needs: cow parsley, goutweed and willowherb are what a roadside verge
# is made of in June. The head is generated here — a flat-topped cluster of tiny
# white florets — and hung on thin procedural stems over a real CC0 foliage mass
# (nettle and weed_plant_02), so the slot reads as roadside herbs instead of as a
# nettle patch.


def umbel_head_texture(path, size=256, seed=11):
    """A white umbel seen from anywhere: ~90 florets scattered over a shallow
    dome, each a soft dot, on transparent."""
    if os.path.exists(path):
        return path
    rng = random.Random(seed)
    img = bpy.data.images.new('umbel_head', size, size, alpha=True)
    px = [0.0] * (size * size * 4)
    for _ in range(150):
        # a shallow dome: uniform in the disc, lifted a little toward the middle
        r = 0.92 * (rng.random() ** 0.5)
        a = rng.random() * math.tau
        cx = 0.5 + math.cos(a) * r * 0.5
        cy = 0.5 + math.sin(a) * r * 0.5
        rad = (0.020 + 0.026 * rng.random()) * (1.0 - 0.35 * r)
        bright = 0.86 + 0.14 * rng.random()
        for y in range(max(0, int((cy - rad) * size)), min(size, int((cy + rad) * size) + 1)):
            for x in range(max(0, int((cx - rad) * size)), min(size, int((cx + rad) * size) + 1)):
                d = math.hypot((x + 0.5) / size - cx, (y + 0.5) / size - cy)
                if d > rad:
                    continue
                a_ = min(1.0, (1.0 - d / rad) * 3.0)
                o = ((size - 1 - y) * size + x) * 4
                if a_ > px[o + 3]:
                    px[o] = px[o + 1] = px[o + 2] = bright
                    px[o + 3] = a_
    img.pixels = px
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    return path


def stem_material(name, tint=(0.16, 0.22, 0.07)):
    """A plain unlit stem: a tube is too thin to carry a photo convincingly, and
    the game shades a bush card with its own light anyway."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    tree = mat.node_tree
    for n in list(tree.nodes):
        tree.nodes.remove(n)
    out = tree.nodes.new('ShaderNodeOutputMaterial')
    emit = tree.nodes.new('ShaderNodeEmission')
    emit.inputs['Color'].default_value = (tint[0], tint[1], tint[2], 1.0)
    tree.links.new(emit.outputs['Emission'], out.inputs['Surface'])
    return mat


def umbel_objects(spec, frame, *, seed, mat_for, head_path, head_tint=None):
    """Thin stems, each carrying a white umbel: the heads overlap into a flat
    white-top cluster the way cow parsley reads from a car window."""
    rng = random.Random(seed)
    made = []
    height = spec['height']
    count = spec.get('count', 6)
    radius = spec.get('radius', 0.4) * frame
    size = spec.get('head', 0.20) * frame
    head_mat = mat_for('umbel_head', head_path, None)
    stem_mat = stem_material('umbel_stem', spec.get('stem_tint', (0.16, 0.22, 0.07)))
    for k in range(count):
        a = rng.random() * math.tau
        r = radius * math.sqrt(rng.random())
        ox, oy = r * math.cos(a), r * math.sin(a) * 0.55
        h = height * rng.uniform(0.80, 1.0)
        lean = (rng.random() - 0.5) * 0.22 * h
        pts = []
        for i in range(5):
            t = i / 4.0
            pts.append((ox + lean * t * t, oy + lean * 0.35 * t * t,
                        h * t + 0.025 * math.sin(t * 3.0 + a)))
        rad = [0.0095 * (1.0 - 0.60 * (i / 4.0)) for i in range(5)]
        v, f, u = L.taper_tube(pts, rad, sides=3, uv_u_scale=1.0, v_span=(0.0, 1.0))
        obj = L.mesh_object(f'umbel_stem_{k}', v, f, u)
        obj.data.materials.append(stem_mat)
        made.append(obj)
        top = Vector(pts[-1])
        for j in range(1):
            roll = rng.random() * math.tau
            off = Vector((rng.gauss(0, size * 0.28), rng.gauss(0, size * 0.16), rng.gauss(0, size * 0.14)))
            right = Vector((math.cos(roll), 0.0, math.sin(roll))) * (size * 0.5)
            up = Vector((-math.sin(roll), 0.0, math.cos(roll))) * (size * 0.5)
            cv, cf, cu = L.quad(tuple(top + off), tuple(right), tuple(up), (0.0, 0.0, 1.0, 1.0))
            o2 = L.mesh_object(f'umbel_head_{k}_{j}', cv, cf, cu)
            o2.data.materials.append(head_mat)
            made.append(o2)
    return made


# --------------------------------------------------------------------------- #
# cell rendering


def scatter(rng, count, radius, vary):
    """Jittered spots in a disc, squashed in depth so a clump keeps a
    front-facing silhouette instead of becoming a flat wall."""
    spots = []
    for _ in range(count):
        r = radius * math.sqrt(rng.random())
        a = rng.random() * math.tau
        spots.append((r * math.cos(a), r * math.sin(a) * 0.45, 1.0 + rng.uniform(-vary, vary), rng.random() * math.tau))
    return spots


def build_parts(spec, frame, *, seed, mat_for):
    """Instantiate one recipe part inside a cell frame of `frame` metres.

    `height` is the target height in metres. Scaling a 0.15 m scanned clump up to
    a 0.6 m meadow tuft also widens its blades, so the horizontal scale is
    compressed by `spread` (sxy = sz**spread): the plant gets taller without
    turning into a succulent. 1.0 = uniform scaling.
    """
    names = spec.get('clumps')
    if names is None:
        names = sorted(kit(spec['model'], dry=spec.get('dry', False)))
    elif isinstance(names, str):
        names = [names]
    rng = random.Random(seed)
    made = []
    count = spec.get('count', 3)
    if spec.get('radial'):
        spots = []
        for k in range(count):
            a = (k / max(1, count)) * math.tau + rng.uniform(-0.22, 0.22)
            r = spec.get('radius', 0.3) * frame * rng.uniform(0.55, 1.0)
            spots.append((r * math.cos(a), r * math.sin(a) * 0.45, 1.0, a + math.pi * 0.5))
    else:
        spots = scatter(rng, count, spec.get('radius', 0.3) * frame, spec.get('vary', 0.2))
    for k, (dx, dy, sk, yaw) in enumerate(spots):
        name = names[k % len(names)]
        cl = clump(spec['model'], name, dry=spec.get('dry', False))
        if not cl['diffuse']:
            raise RuntimeError(f'{spec["model"]}: no diffuse texture found')
        if not cl.get('alpha'):
            raise RuntimeError(f'{spec["model"]}: no opacity map — the sprite would render the texture background as solid')
        sz = spec['height'] / cl['h']
        sxy = sz ** spec.get('spread', 0.62)
        world = (
            Matrix.Translation((dx, dy, 0.0))
            @ Matrix.Rotation(yaw, 4, 'Z')
            @ Matrix.Diagonal((sxy, sxy, sz, 1.0))
        )
        label = f'{spec["model"][:10]}_{name}'
        for j, part in enumerate(cl['parts']):
            mesh, pre, _ = part
            copy = mesh.copy()
            obj = L.object_from_mesh(f'{label}_{k}_{j}', copy)
            obj.matrix_world = world @ pre
            copy.materials.clear()
            copy.materials.append(mat_for(f'{label}_m{j}', part_diffuse(part, cl['diffuse']), cl['alpha']))
            made.append(obj)
    return made


def render_cell(recipe, out_png, *, cell_px, samples, mat_for):
    """One cell: its own square ortho frame sized to the tallest plant plus a
    little headroom, plants standing on the frame's bottom edge."""
    frame = recipe['frame']
    L.configure(cell_px, cell_px, samples=samples)
    L.clear_objects()
    L.ortho_camera(frame, frame, frame, centre=(0.0, 0.0, frame * 0.5))
    head_path = umbel_head_texture(os.path.join(LOOK, '.cache', 'umbel_head.png'))
    for i, spec in enumerate(recipe['parts']):
        seed = zlib.crc32(f'{recipe["name"]}:{i}'.encode())
        if spec.get('umbel'):
            umbel_objects(spec, frame, seed=seed, mat_for=mat_for, head_path=head_path)
        else:
            build_parts(spec, frame, seed=seed, mat_for=mat_for)
    L.render_to(out_png)


def render_material_pass(recipe, out_png, *, cell_px, samples, material):
    """A cell re-rendered with a different material, to bake a mask channel."""
    frame = recipe['frame']
    L.configure(cell_px, cell_px, samples=samples)
    L.clear_objects()
    L.ortho_camera(frame, frame, frame, centre=(0.0, 0.0, frame * 0.5))
    head_path = umbel_head_texture(os.path.join(LOOK, '.cache', 'umbel_head.png'))
    for i, spec in enumerate(recipe['parts']):
        seed = zlib.crc32(f'{recipe["name"]}:{i}'.encode())
        if spec.get('umbel'):
            umbel_objects(spec, frame, seed=seed, mat_for=material, head_path=head_path)
        else:
            build_parts(spec, frame, seed=seed, mat_for=material)
    L.render_to(out_png)


# --------------------------------------------------------------------------- #
# recipes


def grass_recipes():
    """Eight cells: name, world frame size, and the CC0 clumps each cell is made
    of. Cell 3 carries the flowers (it gets its own flora mask), cell 5 is the
    winter cover rendered on the dry diffuse.

    Every cell is a *scene* of many plants sized and scattered to fill its frame
    edge to edge. The first set put four or five clumps inside a 1.25 m frame and
    left the rest of the cell empty, which reads as a few lone stalks on the verge
    rather than as grass."""
    return [
        dict(name='short verge tuft', frame=0.34, parts=[
            dict(model='grass_bermuda_01', height=0.30, spread=0.42, count=54, radius=0.32, vary=0.32,
                 clumps=['seedling_a', 'seedling_b', 'medium_c', 'medium_e', 'medium_f',
                         'small_c', 'small_e', 'small_f', 'dead_a', 'flattened_a'])]),
        dict(name='medium tuft', frame=0.90, parts=[
            dict(model='grass_medium_01', height=0.80, spread=0.40, count=9, radius=0.32, vary=0.20,
                 clumps=['large_a', 'large_c', 'mid_a', 'tall_b']),
            dict(model='grass_bermuda_01', height=0.36, spread=0.48, count=16, radius=0.32, vary=0.32,
                 clumps=['seedling_a', 'seedling_d', 'medium_f', 'small_c', 'small_f'])]),
        dict(name='tall ditch grass', frame=1.30, parts=[
            dict(model='grass_medium_01', height=1.18, spread=0.40, count=8, radius=0.32, vary=0.16,
                 clumps=['tall_a', 'tall_b', 'tall_c', 'large_a', 'large_c']),
            dict(model='grass_medium_01', height=0.62, spread=0.46, count=7, radius=0.32, vary=0.22,
                 clumps=['mid_a', 'large_c'])]),
        dict(name='flowering meadow', frame=1.15, parts=[
            dict(model='grass_medium_01', height=1.00, spread=0.40, count=7, radius=0.32, vary=0.18,
                 clumps=['tall_a', 'tall_c', 'large_a', 'large_c']),
            dict(model='celandine_01', height=0.62, spread=0.62, count=4, radius=0.32, vary=0.24,
                 clumps=['c', 'a']),
            dict(model='dandelion_01', height=0.46, spread=0.62, count=4, radius=0.32, vary=0.24,
                 clumps=['a', 'b']),
            dict(model='grass_bermuda_01', height=0.34, spread=0.48, count=14, radius=0.32, vary=0.32,
                 clumps=['seedling_a', 'medium_f', 'small_c'])]),
        dict(name='wheat/rye ears', frame=1.20, parts=[
            dict(model='grass_medium_02', height=1.10, spread=0.42, count=9, radius=0.32, vary=0.16,
                 clumps=['e', 'd', 'c', 'b']),
            dict(model='grass_medium_02', height=0.66, spread=0.50, count=6, radius=0.32, vary=0.22,
                 clumps=['c', 'b'])]),
        dict(name='dry winter stalks', frame=1.20, parts=[
            dict(model='grass_medium_01', height=1.05, spread=0.40, count=8, radius=0.32, vary=0.18,
                 dry=True, clumps=['tall_a', 'tall_b', 'tall_c']),
            dict(model='grass_medium_02', height=0.78, spread=0.46, count=7, radius=0.32, vary=0.22,
                 dry=True, clumps=['c', 'b', 'd'])]),
        dict(name='low verge turf', frame=0.28, parts=[
            dict(model='grass_bermuda_01', height=0.24, spread=0.44, count=48, radius=0.32, vary=0.34,
                 clumps=['small_a', 'small_d', 'flattened_a', 'dead_a', 'dead_b', 'medium_b',
                         'seedling_c', 'small_b'])]),
        dict(name='deep shade grass', frame=1.30, parts=[
            dict(model='grass_medium_01', height=1.20, spread=0.40, count=8, radius=0.32, vary=0.16,
                 clumps=['large_a', 'large_c', 'tall_a']),
            dict(model='grass_bermuda_01', height=0.58, spread=0.50, count=18, radius=0.32, vary=0.30,
                 clumps=['seedling_a', 'seedling_d', 'medium_c', 'small_c'])]),
    ]


SEASON_GRADES = {
    'spring': dict(tint=(0.10, 0.20, 0.045), amount=0.30, gain=1.06),
    'summer': dict(tint=(0.045, 0.085, 0.028), amount=0.22, gain=1.0),
    'autumn': dict(tint=(0.30, 0.17, 0.035), amount=0.42, gain=0.96),
    'winter': dict(tint=(0.20, 0.17, 0.13), amount=0.56, gain=1.02, snow=0.45),
}

AUTUMN_SLOT_TINT = {
    0: (0.26, 0.16, 0.05),
    1: (0.42, 0.30, 0.05),
    2: (0.40, 0.20, 0.04),
    3: (0.20, 0.13, 0.05),
}


def bush_recipes(season):
    """Four slots with the same meaning in every season, so placement never has
    to change: hazel/rose scrub, tall roadside herbs (umbellifers and willowherb),
    bracken, juniper/willow scrub. Each slot fills its 1.6 m frame — a bush that
    covers half the cell reads as a twig, not as a bush."""
    if season == 'winter':
        return [
            dict(name='bare scrub', frame=1.6, parts=[
                dict(model='shrub_01', height=1.05, count=2, radius=0.26, vary=0.16, clumps=['a']),
                dict(model='shrub_02', height=0.95, count=3, radius=0.32, vary=0.22, clumps=['a', 'c']),
                dict(model='dry_branches_medium_01', height=0.98, count=4, radius=0.32, vary=0.24, clumps=['a'])]),
            dict(name='dead stalks', frame=1.6, parts=[
                dict(model='dry_branches_medium_01', height=1.05, count=6, radius=0.32, vary=0.24,
                     clumps=['a', 'b', 'c'])]),
            dict(name='dead bracken', frame=1.6, parts=[
                dict(model='dry_branches_medium_01', height=0.62, count=9, radius=0.30, vary=0.28,
                     clumps=['a', 'b', 'c'])]),
            dict(name='snowed scrub', frame=1.6, parts=[
                dict(model='shrub_02', height=1.05, count=3, radius=0.28, vary=0.20, clumps=['b', 'd']),
                dict(model='dry_branches_medium_01', height=0.72, count=4, radius=0.32, vary=0.22, clumps=['b'])]),
        ]
    spring = season == 'spring'
    return [
        dict(name='hazel/rose scrub', frame=1.6, parts=[
            dict(model='shrub_01', height=1.10, count=2, radius=0.26, vary=0.16, clumps=['a']),
            dict(model='shrub_02', height=1.00, count=3, radius=0.32, vary=0.22, clumps=['a', 'c']),
            dict(model='shrub_03', height=0.82, count=2, radius=0.32, vary=0.24, clumps=sorted(kit('shrub_03'))[:1])]),
        dict(name='roadside umbellifers', frame=1.6, parts=[
            dict(model='nettle_plant', height=1.15, count=7, radius=0.26, vary=0.22,
                 clumps=['tall_a', 'tall_b', 'medium_a']),
            dict(model='weed_plant_02', height=0.92, count=3, radius=0.32, vary=0.24,
                 clumps=sorted(kit('weed_plant_02'))[:2]),
            dict(umbel=True, height=1.10, count=16, radius=0.34, head=0.085, vary=0.22),
            dict(model='celandine_01' if spring else 'dandelion_01',
                 height=0.50 if spring else 0.44, count=4, radius=0.32, vary=0.26, spread=0.66,
                 clumps=['c', 'd'] if spring else ['a', 'e'])]),
        dict(name='bracken', frame=1.6, parts=[
            # a bracken stand is a rosette of separate fronds, not a green mass:
            # the fronds stand on their own angles with air between them, which is
            # what `radial` places and what the first pass (a scatter of overlapping
            # ferns) turned into a solid bush
            dict(model='fern_02', height=1.02, count=7, radius=0.50, vary=0.30, radial=True,
                 clumps=['c', 'a', 'b']),
            dict(model='fern_02', height=0.68, count=5, radius=0.32, vary=0.34, radial=True,
                 clumps=['b', 'd', 'a'])]),
        dict(name='juniper/willow scrub', frame=1.6, parts=[
            dict(model='shrub_02', height=1.05, count=3, radius=0.28, vary=0.20, clumps=['b', 'd']),
            dict(model='shrub_04', height=0.90, count=3, radius=0.30, vary=0.22, clumps=['shrub_04']),
            dict(model='shrub_03', height=0.74, count=2, radius=0.32, vary=0.24, clumps=sorted(kit('shrub_03'))[1:2])]),
    ]


# --------------------------------------------------------------------------- #
# bush model


def build_bush_model(path):
    """Four crossed cards in an X, base sunk 0.18 m, 1.2 m tall, UVs spanning the
    FIRST column of bush_<season>.webp (u in 0..0.25); an instance adds
    variant*0.25 to u to pick its slot."""
    L.reset(64, 64, samples=1)
    verts = []
    faces = []
    uvs = []
    half = 0.8
    lo, hi = 0.0, 1.6
    for angle in (0.0, math.pi * 0.25, math.pi * 0.5, math.pi * 0.75):
        c, s = math.cos(angle) * half, math.sin(angle) * half
        base = len(verts)
        verts += [(-c, lo, -s), (c, lo, s), (c, hi, s), (-c, hi, -s)]
        uvs += [(0.0, 0.0), (0.25, 0.0), (0.25, 1.0), (0.0, 1.0)]
        faces.append([base, base + 1, base + 2, base + 3])
    obj = L.mesh_object('bush', verts, faces, uvs)
    L.export_glb([obj], path)
    L.log('bush.glb', len(verts), 'verts,', len(faces), 'quads')


# --------------------------------------------------------------------------- #
# jobs


def job_preview(out):
    """Source-picking sheet: named clumps from the packs, each in its own 256 px
    cell, all scaled to 0.9 m so their shapes can be compared side by side."""
    picks = [
        ('grass_bermuda_01', 'seedling_a'), ('grass_bermuda_01', 'medium_e'),
        ('grass_bermuda_01', 'small_a'), ('grass_medium_01', 'large_a'),
        ('grass_medium_01', 'mid_a'), ('grass_medium_01', 'tall_a'),
        ('grass_medium_01', 'tiny_a'), ('grass_medium_02', 'e'),
        ('grass_medium_02', 'c'), ('celandine_01', 'c'),
        ('dandelion_01', 'a'), ('nettle_plant', 'tall_a'),
        ('fern_02', 'b'), ('shrub_02', 'b'),
        ('shrub_03', 'a'), ('shrub_04', 'shrub_04'),
        ('dry_branches_medium_01', 'a'), ('grass_medium_01', 'large_a', True),
    ]
    cols = 6
    rows = math.ceil(len(picks) / cols)
    cell = 256
    frame = 1.1
    L.reset(cols * cell, rows * cell, samples=16)
    L.ortho_camera(cols * frame, cols * frame, rows * frame, centre=(0.0, 0.0, rows * frame * 0.5))
    for i, pick in enumerate(picks):
        model_id, name = pick[0], pick[1]
        dry = len(pick) > 2
        try:
            cl = clump(model_id, name, dry=dry)
        except RuntimeError as err:
            L.log('skip', err)
            continue
        at = (((i % cols) - (cols - 1) * 0.5) * frame, 0.0, (rows - 1 - i // cols) * frame)
        world = Matrix.Translation(at) @ Matrix.Scale(0.9 / cl['h'], 4)
        for j, part in enumerate(cl['parts']):
            mesh, pre, _ = part
            copy = mesh.copy()
            obj = L.object_from_mesh(f'p{i}_{j}', copy)
            obj.matrix_world = world @ pre
            copy.materials.clear()
            copy.materials.append(lum_cutout(f'p{i}_m{j}', part_diffuse(part, cl['diffuse']), alpha=cl['alpha']))
        L.log(f'cell {i}: {model_id}/{name}{" dry" if dry else ""} native {cl["h"]:.2f} m')
    L.render_to(os.path.join(out, 'preview.png'))


def job_grass(out):
    recipes = grass_recipes()
    for i, r in enumerate(recipes):
        render_cell(r, os.path.join(out, f'grass_cell{i}.png'), cell_px=256, samples=32,
                    mat_for=lambda n, d, a: lum_cutout(n, d, alpha=a))
    render_material_pass(recipes[3], os.path.join(out, 'grass_flora_cell3.png'), cell_px=256, samples=16,
                         material=lambda n, d, a: flora_key(n, d, alpha=a))


def job_bush(out):
    for season in ('spring', 'summer', 'autumn', 'winter'):
        g = SEASON_GRADES[season]
        for i, r in enumerate(bush_recipes(season)):
            tint = AUTUMN_SLOT_TINT[i] if season == 'autumn' else g['tint']
            render_cell(
                r,
                os.path.join(out, f'bush_{season}_slot{i}.png'),
                cell_px=512,
                samples=24,
                mat_for=lambda n, d, a, tint=tint, g=g: graded_cutout(
                    n, d, alpha=a, tint=tint, amount=g['amount'], gain=g['gain'], snow=g.get('snow', 0.0)),
            )
    build_bush_model(os.path.join(out, 'bush.glb'))


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    job = argv[0] if argv else 'preview'
    out = argv[1] if len(argv) > 1 else '/tmp/look-out'
    os.makedirs(out, exist_ok=True)
    {'grass': job_grass, 'bush': job_bush, 'preview': job_preview}[job](out)
    L.log('done', job)


if __name__ == '__main__':
    main()
