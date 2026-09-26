"""Shared helpers for the Blender side of the look-asset pipeline.

Everything here is deliberately unlit: the game fakes the lighting (Lambert plus
the slowroads-style crown tricks in the shaders), so a bake only has to produce
albedo, cutout alpha and an analytic normal. That keeps Cycles at a handful of
samples per pixel and makes the result deterministic.

Axis and UV conventions
-----------------------
Blender is Z-up. Atlas renders use an orthographic camera looking along world +Y
with up = world +Z, so a tree standing along +Z appears upright in the image:
image right = world +X, image up = world +Z.

The material node graphs build normals in WORLD space; the atlases store them in
the viewer's tangent space, which for that camera is
    R (tangent X) = world x,  G (tangent Y) = world z,  B (tangent Z) = -world y
i.e. +X right, +Y up, +Z out of the surface toward the viewer — the OpenGL
convention three.js uses for normalMap.

All cell layout is expressed in atlas pixels with y measured from the TOP (the
way every image tool reports it); `uv_rect()` converts to the UV space Blender
and glTF want (v measured from the bottom).
"""

import math
import os
import sys

import bpy

# --------------------------------------------------------------------------- #
# scene


def reset(res_x, res_y, samples=8, threads=6):
    """Wipe the file and configure it. Wiping also drops every datablock, so use
    configure() + clear_objects() between cells of one job: the imported CC0 kit
    meshes have to survive."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return configure(res_x, res_y, samples=samples, threads=threads)


def configure(res_x, res_y, samples=8, threads=6):
    """Render settings for a cell render, without touching scene data."""
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = samples
    scene.cycles.use_denoising = False
    scene.cycles.use_adaptive_sampling = False
    scene.cycles.max_bounces = 4
    scene.cycles.diffuse_bounces = 0
    scene.cycles.glossy_bounces = 0
    scene.cycles.transmission_bounces = 0
    scene.cycles.transparent_max_bounces = 64
    scene.cycles.use_fast_gi = False
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = threads
    scene.render.resolution_x = res_x
    scene.render.resolution_y = res_y
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.color_depth = '8'
    scene.render.image_settings.compression = 15
    # No tone curve: an emission value is stored as itself, modulo the sRGB
    # transfer the PNG container applies (which encode_normal() pre-compensates).
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    return scene


def clear_objects():
    """Remove every object (cameras and lights included) but keep meshes,
    materials and images, so kit datablocks stay valid across cells."""
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)


def render_to(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path


def ortho_camera(size, width_m, height_m, centre=(0.0, 0.0, 0.0)):
    """Orthographic camera along +Y; `size` is Blender's ortho_scale (the larger
    image axis, in metres). The camera sees width_m x height_m of world space."""
    cam_data = bpy.data.cameras.new('cell_cam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = size
    cam_data.clip_start = 0.01
    cam_data.clip_end = 1000.0
    cam = bpy.data.objects.new('cell_cam', cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = (centre[0], -400.0, centre[2])
    cam.rotation_euler = (math.radians(90.0), 0.0, 0.0)
    bpy.context.scene.camera = cam
    return cam


# --------------------------------------------------------------------------- #
# materials


def _emission_material(name, colour_socket):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    tree = mat.node_tree
    for n in list(tree.nodes):
        tree.nodes.remove(n)
    out = tree.nodes.new('ShaderNodeOutputMaterial')
    emit = tree.nodes.new('ShaderNodeEmission')
    emit.inputs['Strength'].default_value = 1.0
    tree.links.new(colour_socket, emit.inputs['Color'])
    tree.links.new(emit.outputs['Emission'], out.inputs['Surface'])
    return mat


def image_node(tree, path, colorspace='sRGB', interpolation='Linear'):
    img = bpy.data.images.load(path)
    img.colorspace_settings.name = colorspace
    tex = tree.nodes.new('ShaderNodeTexImage')
    tex.image = img
    tex.interpolation = interpolation
    tex.extension = 'REPEAT'
    return tex


def _opacity_is_grey(path):
    """Is a separate opacity map read as greyscale rather than through its alpha?

    Blender reports `channels == 4` for a greyscale PNG as well — it converts the
    file on load — so the `channels == 1` test never fired for a Poly Haven
    `Alpha.png` mask, the material read the image's own alpha (1 everywhere) and
    cut out nothing. A black-background sheet survived that because the luminance
    `gate` still cut it, but a sheet whose background is foliage (fern_02,
    nettle_plant, weed_plant_02) came out as a green rectangle: the "green mass"
    the bracken cell was rejected for. The PNG header knows the real colour type,
    so ask it."""
    try:
        with open(path, 'rb') as f:
            head = f.read(26)
    except OSError:
        return True
    if head[:8] != b'\x89PNG\r\n\x1a\n':
        return True                      # a JPEG has no alpha at all
    return head[25] not in (4, 6)        # 4 = grey+alpha, 6 = RGBA


def cutout_emission(name, path, *, threshold=0.5, opacity_path=None, clip='GREATER_THAN'):
    """Emission of a photo texture, cut out by its alpha (or a separate opacity
    map). Cycles' Transparent BSDF gives a clean hard edge; the game's alphaTest
    does the same thing at runtime."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    tree = mat.node_tree
    for n in list(tree.nodes):
        tree.nodes.remove(n)
    out = tree.nodes.new('ShaderNodeOutputMaterial')
    emit = tree.nodes.new('ShaderNodeEmission')
    emit.inputs['Strength'].default_value = 1.0
    tex = image_node(tree, path, 'sRGB')
    tree.links.new(tex.outputs['Color'], emit.inputs['Color'])
    alpha_socket = tex.outputs['Alpha']
    if opacity_path:
        op = image_node(tree, opacity_path, 'Non-Color')
        # A separate opacity map is read as a single-channel mask unless the file
        # really carries an alpha channel (see _opacity_is_grey).
        single = opacity_path.lower().endswith(('.jpg', '.jpeg')) or op.image.channels == 1 \
            or _opacity_is_grey(opacity_path)
        alpha_socket = op.outputs['Color'] if single else op.outputs['Alpha']
    fac = math_node(tree, clip, alpha_socket, threshold)
    trans = tree.nodes.new('ShaderNodeBsdfTransparent')
    mix = tree.nodes.new('ShaderNodeMixShader')
    tree.links.new(fac.socket, mix.inputs['Fac'])
    tree.links.new(trans.outputs['BSDF'], mix.inputs[1])
    tree.links.new(emit.outputs['Emission'], mix.inputs[2])
    tree.links.new(mix.outputs['Shader'], out.inputs['Surface'])
    return mat


# --------------------------------------------------------------------------- #
# node maths
#
# Blender's Mix node hides duplicated sockets per data type, which makes it a
# version hazard; the tiny expression layer below only uses Math and Vector Math
# nodes, whose socket names have been stable for years.


class Num:
    def __init__(self, tree, socket):
        self.tree = tree
        self.socket = socket

    def _bin(self, op, other):
        n = self.tree.nodes.new('ShaderNodeMath')
        n.operation = op
        self.tree.links.new(self.socket, n.inputs[0])
        if isinstance(other, Num):
            self.tree.links.new(other.socket, n.inputs[1])
        else:
            n.inputs[1].default_value = float(other)
        return Num(self.tree, n.outputs[0])

    def __add__(self, o):
        return self._bin('ADD', o)

    def __radd__(self, o):
        return self._bin('ADD', o)

    def __sub__(self, o):
        return self._bin('SUBTRACT', o)

    def __rsub__(self, o):
        n = self.tree.nodes.new('ShaderNodeMath')
        n.operation = 'SUBTRACT'
        n.inputs[0].default_value = float(o)
        self.tree.links.new(self.socket, n.inputs[1])
        return Num(self.tree, n.outputs[0])

    def __mul__(self, o):
        return self._bin('MULTIPLY', o)

    def __rmul__(self, o):
        return self._bin('MULTIPLY', o)

    def __truediv__(self, o):
        return self._bin('DIVIDE', o)

    def __neg__(self):
        return self._bin('MULTIPLY', -1.0)

    def power(self, p):
        return self._bin('POWER', p)

    def sqrt(self):
        return self._bin('POWER', 0.5)

    def min(self, o):
        return self._bin('MINIMUM', o)

    def max(self, o):
        return self._bin('MAXIMUM', o)

    def less(self, o):
        return self._bin('LESS_THAN', o)

    def greater(self, o):
        return self._bin('GREATER_THAN', o)

    def __mod__(self, o):
        return self._bin('MODULO', o)

    def abs(self):
        return self._bin('ABSOLUTE', 0.0)

    def __rmod__(self, o):
        n = self.tree.nodes.new('ShaderNodeMath')
        n.operation = 'MODULO'
        n.inputs[0].default_value = float(o)
        self.tree.links.new(self.socket, n.inputs[1])
        return Num(self.tree, n.outputs[0])


class Vec:
    def __init__(self, tree, socket):
        self.tree = tree
        self.socket = socket

    def _bin(self, op, other):
        n = self.tree.nodes.new('ShaderNodeVectorMath')
        n.operation = op
        self.tree.links.new(self.socket, n.inputs[0])
        if isinstance(other, Vec):
            self.tree.links.new(other.socket, n.inputs[1])
        elif isinstance(other, (int, float)):
            n.inputs[1].default_value = (float(other),) * 3
        elif isinstance(other, (tuple, list)):
            n.inputs[1].default_value = tuple(float(v) for v in other)
        else:
            raise TypeError(other)
        return Vec(self.tree, n.outputs['Vector'])

    def __add__(self, o):
        return self._bin('ADD', o)

    def __sub__(self, o):
        return self._bin('SUBTRACT', o)

    def __mul__(self, o):
        if isinstance(o, Num):
            return self.scale(o)
        return self._bin('MULTIPLY', o)

    def __rmul__(self, o):
        if isinstance(o, Num):
            return self.scale(o)
        return self._bin('MULTIPLY', o)

    def dot(self, o):
        n = self.tree.nodes.new('ShaderNodeVectorMath')
        n.operation = 'DOT_PRODUCT'
        self.tree.links.new(self.socket, n.inputs[0])
        self.tree.links.new(o.socket, n.inputs[1])
        return Num(self.tree, n.outputs['Value'])

    def length(self):
        n = self.tree.nodes.new('ShaderNodeVectorMath')
        n.operation = 'LENGTH'
        self.tree.links.new(self.socket, n.inputs[0])
        return Num(self.tree, n.outputs['Value'])

    def normalize(self):
        n = self.tree.nodes.new('ShaderNodeVectorMath')
        n.operation = 'NORMALIZE'
        self.tree.links.new(self.socket, n.inputs[0])
        return Vec(self.tree, n.outputs['Vector'])

    def swizzle(self, x, y, z):
        """Reorder components; 'x', 'y', 'z' or their negatives like '-y'."""
        sep = self.tree.nodes.new('ShaderNodeSeparateXYZ')
        self.tree.links.new(self.socket, sep.inputs[0])
        comb = self.tree.nodes.new('ShaderNodeCombineXYZ')
        for i, comp in enumerate((x, y, z)):
            neg = comp.startswith('-')
            name = comp.lstrip('-').upper()
            src = Num(self.tree, sep.outputs[name])
            if neg:
                src = -src
            self.tree.links.new(src.socket, comb.inputs[i])
        return Vec(self.tree, comb.outputs['Vector'])

    def scale(self, k):
        n = self.tree.nodes.new('ShaderNodeVectorMath')
        n.operation = 'SCALE'
        self.tree.links.new(self.socket, n.inputs[0])
        if isinstance(k, Num):
            self.tree.links.new(k.socket, n.inputs['Scale'])
        else:
            n.inputs['Scale'].default_value = float(k)
        return Vec(self.tree, n.outputs['Vector'])

    def abs(self):
        n = self.tree.nodes.new('ShaderNodeVectorMath')
        n.operation = 'ABSOLUTE'
        self.tree.links.new(self.socket, n.inputs[0])
        return Vec(self.tree, n.outputs['Vector'])


def _feed(tree, node, index, value):
    """Wire a Num, a raw bpy output socket, or a literal into a node input."""
    if isinstance(value, Num):
        tree.links.new(value.socket, node.inputs[index])
    elif hasattr(value, 'is_output'):
        tree.links.new(value, node.inputs[index])
    else:
        node.inputs[index].default_value = float(value)


def math_node(tree, op, a, b=None):
    n = tree.nodes.new('ShaderNodeMath')
    n.operation = op
    _feed(tree, n, 0, a)
    if b is not None:
        _feed(tree, n, 1, b)
    return Num(tree, n.outputs[0])


def const(tree, v):
    n = tree.nodes.new('ShaderNodeValue')
    n.outputs[0].default_value = float(v)
    return Num(tree, n.outputs[0])


def vec_const(tree, x, y, z):
    n = tree.nodes.new('ShaderNodeCombineXYZ')
    n.inputs[0].default_value = x
    n.inputs[1].default_value = y
    n.inputs[2].default_value = z
    return Vec(tree, n.outputs['Vector'])


def position(tree):
    n = tree.nodes.new('ShaderNodeNewGeometry')
    return Vec(tree, n.outputs['Position'])


def shading_normal(tree):
    n = tree.nodes.new('ShaderNodeNewGeometry')
    return Vec(tree, n.outputs['Normal'])


def attribute(tree, name, channel='Color'):
    n = tree.nodes.new('ShaderNodeAttribute')
    n.attribute_name = name
    return n.outputs[channel]


def components(tree, vec):
    sep = tree.nodes.new('ShaderNodeSeparateXYZ')
    tree.links.new(vec.socket, sep.inputs[0])
    return {k: Num(tree, sep.outputs[k]) for k in ('X', 'Y', 'Z')}


def combine_rgb(r, g, b, tree=None):
    if tree is None:
        for v in (r, g, b):
            if isinstance(v, Num):
                tree = v.tree
                break
    n = tree.nodes.new('ShaderNodeCombineXYZ')
    for i, v in enumerate((r, g, b)):
        if isinstance(v, Num):
            tree.links.new(v.socket, n.inputs[i])
        else:
            n.inputs[i].default_value = float(v)
    return Vec(tree, n.outputs['Vector'])


def smoothstep(e0, e1, x):
    t = clamp01((x - e0) / (e1 - e0))
    return t * t * (3.0 - t * 2.0)


def mix_num(a, b, t):
    return a * (1.0 - t) + b * t


def mix_vec(a, b, t):
    """mix of two Vec by a Num factor, built from VectorScale + ADD."""
    return b.scale(t) + a.scale(1.0 - t)


def clamp01(x):
    return x.min(1.0).max(0.0)


def srgb_to_linear(v):
    """Inverse sRGB transfer, so that the value Blender stores in the 8-bit PNG
    is exactly `v`. Without it a normal map's neutral channel lands on 187
    instead of 128 (a ~12% tilt on every normal)."""
    lin = (v + 0.055) / 1.055
    lin = lin.power(2.4)
    low = v / 12.92
    fac = v.less(0.04045)
    return low * fac + lin * (1.0 - fac)


def encode_normal(vec, exact=True):
    """[-1,1] vector -> [0,1] RGB in the canonical RGB8 normal-map encoding.
    With exact=True the emitted (linear) value is pre-distorted by the inverse
    sRGB curve, so the bytes written to the PNG are the encoded normal itself."""
    half = const(vec.tree, 0.5)
    c = components(vec.tree, vec)
    vals = []
    for k in ('X', 'Y', 'Z'):
        u = clamp01(c[k] * 0.5 + half)
        vals.append(srgb_to_linear(u) if exact else u)
    return combine_rgb(vals[0], vals[1], vals[2])


# --------------------------------------------------------------------------- #
# meshes


def mesh_object(name, verts, faces, uvs=None, colors=None, uv_layer='UVMap'):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in verts], [], [list(f) for f in faces])
    mesh.validate()
    if uvs is not None:
        layer = mesh.uv_layers.new(name=uv_layer)
        for poly in mesh.polygons:
            for li in poly.loop_indices:
                vi = mesh.loops[li].vertex_index
                layer.data[li].uv = uvs[vi]
    if colors is not None:
        attr = mesh.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='POINT')
        for i, c in enumerate(colors):
            attr.data[i].color = (c, c, c, 1.0)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def object_from_mesh(name, mesh):
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def assign(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    return obj


def duplicate(obj, name, matrix):
    """Linked duplicate (shares the mesh) with its own transform."""
    copy = bpy.data.objects.new(name, obj.data)
    bpy.context.collection.objects.link(copy)
    copy.matrix_world = matrix


def import_gltf(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def mesh_stats(obj):
    return len(obj.data.vertices), len(obj.data.polygons)


# --------------------------------------------------------------------------- #
# atlas geometry helpers


def uv_rect(x, y, w, h, atlas_w, atlas_h, *, margin=0.0):
    """Pixel rect (y from top) inside an atlas -> (u0, v0, u1, v1) with v from the
    bottom, ready for Blender UV coordinates."""
    u0 = (x + margin) / atlas_w
    u1 = (x + w - margin) / atlas_w
    v1 = 1.0 - (y + margin) / atlas_h
    v0 = 1.0 - (y + h - margin) / atlas_h
    return (u0, v0, u1, v1)


def quad(centre, right, up, uv_rect_px):
    """A four-corner card. Returns (verts, face, uvs) with UVs in Blender's
    bottom-left convention: uv_rect_px = (u0,v0,u1,v1)."""
    u0, v0, u1, v1 = uv_rect_px
    cx, cy, cz = centre
    (rx, ry, rz) = right
    (ux, uy, uz) = up
    v = [
        (cx - rx - ux, cy - ry - uy, cz - rz - uz),
        (cx + rx - ux, cy + ry - uy, cz + rz - uz),
        (cx + rx + ux, cy + ry + uy, cz + rz + uz),
        (cx - rx + ux, cy - ry + uy, cz - rz + uz),
    ]
    uv = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
    return v, [[0, 1, 2, 3]], uv


def taper_tube(path_points, radii, sides=5, twist=0.0, uv_u_scale=1.0, v_span=(0.0, 1.0)):
    """A tube through a list of 3D points with per-point radii. Returns
    (verts, faces, uvs) with u running along the tube and v around it."""
    verts = []
    faces = []
    uvs = []
    rings = []
    n = len(path_points)
    # cumulative length for u
    lengths = [0.0]
    for i in range(1, n):
        a = path_points[i - 1]
        b = path_points[i]
        lengths.append(lengths[-1] + math.dist(a, b))
    total = lengths[-1] or 1.0
    for i, (p, r) in enumerate(zip(path_points, radii)):
        if i < n - 1:
            d = _sub(path_points[i + 1], p)
        else:
            d = _sub(p, path_points[i - 1])
        d = _norm(d)
        # any vector not parallel to d
        ref = (0.0, 0.0, 1.0) if abs(d[2]) < 0.9 else (1.0, 0.0, 0.0)
        t1 = _norm(_cross(d, ref))
        t2 = _cross(d, t1)
        ring = []
        for s in range(sides):
            a = 2.0 * math.pi * (s / sides) + twist
            off = (t1[0] * math.cos(a) + t2[0] * math.sin(a), t1[1] * math.cos(a) + t2[1] * math.sin(a), t1[2] * math.cos(a) + t2[2] * math.sin(a))
            ring.append(len(verts))
            verts.append((p[0] + off[0] * r, p[1] + off[1] * r, p[2] + off[2] * r))
            u = (lengths[i] / total) * uv_u_scale
            v = v_span[0] + (v_span[1] - v_span[0]) * (s / sides)
            uvs.append((u, v))
        rings.append(ring)
    for i in range(n - 1):
        for s in range(sides):
            s2 = (s + 1) % sides
            a = rings[i][s]
            b = rings[i][s2]
            c = rings[i + 1][s2]
            d = rings[i + 1][s]
            faces.append([a, b, c, d])
    return verts, faces, uvs


def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _norm(a):
    l = math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) or 1.0
    return (a[0] / l, a[1] / l, a[2] / l)


def merge(parts):
    """Concatenate (verts, faces, uvs) tuples, offsetting face indices."""
    verts = []
    faces = []
    uvs = []
    for v, f, u in parts:
        off = len(verts)
        verts.extend(v)
        uvs.extend(u)
        faces.extend([[i + off for i in face] for face in f])
    return verts, faces, uvs


def export_glb(objects, path, *, vertex_color='MATERIAL'):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        # Blender 4+ spells vertex colours as a mode + a layer name; MATERIAL sends
        # COLOR_0 for the attribute the material reads, ACTIVE whatever attribute
        # is active. The tree models export with no material at all, so they ask
        # for ACTIVE and get their per-card 'Col' either way.
        export_vertex_color=vertex_color,
        export_all_vertex_colors=False,
        export_materials='NONE',
        export_animations=False,
    )
    return path


def log(*a):
    print('[look]', *a, flush=True)
