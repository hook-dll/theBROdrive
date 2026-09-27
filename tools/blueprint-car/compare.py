"""Stage 30: the model beside real photographs, from matching viewpoints.

    Blender --background --factory-startup --python tools/blueprint-car/compare.py -- \
        <car.json> <model.glb> [out-dir]

Silhouette IoU says the three drawn projections agree; it cannot say the car looks
right, because orthographic outlines miss every surface that curves toward the viewer
(crowns, tumblehome, pillar rake). Photos can. Each spec["photos"] entry is
{"name", "file", "location", "target", "lens"}: a hand-matched camera in the model's
metric frame (+X left, -Y nose, +Z up, ground at 0). The render uses the photo's aspect
and is written beside it, photo on the left.

Writes <out>/<name>.png.
"""
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import load_spec, read_rgb, write_rgb  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:]
spec = load_spec(args[0])
model = Path(args[1]).resolve()
out_dir = Path(args[2]).resolve() if len(args) > 2 else model.parent / 'compare'
out_dir.mkdir(parents=True, exist_ok=True)
HEIGHT = 720

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(model))
scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'MATERIAL'
scene.display.shading.show_backface_culling = True
scene.display.shading.show_cavity = True
scene.world = scene.world or bpy.data.worlds.new('world')
scene.world.color = (0.62, 0.64, 0.66)


def resize(rgb: np.ndarray, height: int) -> np.ndarray:
    width = round(rgb.shape[1] * height / rgb.shape[0])
    rows = (np.arange(height) * rgb.shape[0] / height).astype(int)
    cols = (np.arange(width) * rgb.shape[1] / width).astype(int)
    return rgb[rows][:, cols]


def basis(location: np.ndarray, target: np.ndarray, roll: float) -> np.ndarray:
    """Camera-to-world rotation (columns: right, up, back) for a look-at plus roll."""
    forward = target - location
    forward /= np.linalg.norm(forward)
    right = np.cross(forward, [0.0, 0.0, 1.0])
    right /= np.linalg.norm(right)
    up = np.cross(right, forward)
    c, s = np.cos(roll), np.sin(roll)
    right, up = c * right + s * up, -s * right + c * up
    return np.column_stack([right, up, -forward])


def project(params: np.ndarray, xyz: np.ndarray, width: int, height: int) -> np.ndarray:
    location, target, roll, lens = params[:3], params[3:6], params[6], params[7]
    local = (xyz - location) @ basis(location, target, roll)
    focal = lens / 36.0 * width  # sensor_fit HORIZONTAL, 36 mm sensor
    depth = np.maximum(-local[:, 2], 1e-6)
    return np.column_stack([width / 2 + focal * local[:, 0] / depth,
                            height / 2 - focal * local[:, 1] / depth])


def nelder_mead(cost, start: np.ndarray, step: np.ndarray, iterations: int = 4000) -> np.ndarray:
    simplex = [start] + [start + np.eye(len(start))[i] * step[i] for i in range(len(start))]
    values = [cost(p) for p in simplex]
    for _ in range(iterations):
        order = np.argsort(values)
        simplex = [simplex[i] for i in order]
        values = [values[i] for i in order]
        centroid = np.mean(simplex[:-1], axis=0)
        reflected = centroid + (centroid - simplex[-1])
        r = cost(reflected)
        if r < values[0]:
            expanded = centroid + 2 * (centroid - simplex[-1])
            e = cost(expanded)
            simplex[-1], values[-1] = (expanded, e) if e < r else (reflected, r)
        elif r < values[-2]:
            simplex[-1], values[-1] = reflected, r
        else:
            contracted = centroid + 0.5 * (simplex[-1] - centroid)
            c = cost(contracted)
            if c < values[-1]:
                simplex[-1], values[-1] = contracted, c
            else:
                simplex = [simplex[0] + 0.5 * (p - simplex[0]) for p in simplex]
                values = [cost(p) for p in simplex]
    return simplex[int(np.argmin(values))]


def solve_camera(photo: dict, width: int, height: int) -> tuple[np.ndarray, float]:
    """Refine the hand-placed camera so marked photo pixels land on their 3D points.

    spec photo "points": [{"px": [u, v] (full-resolution photo pixels), "xyz": [...]}];
    at least four, spread over the car. Returns parameters and the RMS pixel error.
    """
    start = np.array([*photo['location'], *photo['target'], 0.0, photo.get('lens', 30)], float)
    if len(photo.get('points', [])) < 4:
        return start, float('nan')
    xyz = np.array([p['xyz'] for p in photo['points']], float)
    px = np.array([p['px'] for p in photo['points']], float)

    def cost(params):
        if params[7] < 8 or params[7] > 120:
            return 1e12
        return float(np.sum((project(params, xyz, width, height) - px) ** 2))

    best = start
    for _ in range(3):  # restarts shake the simplex out of flat valleys
        best = nelder_mead(cost, best, np.array([0.5, 0.5, 0.3, 0.5, 0.5, 0.3, 0.05, 4.0]))
    return best, float(np.sqrt(cost(best) / len(px)))


for photo in spec.get('photos', []):
    image = read_rgb(spec['_work'] / photo['file'])
    height, width = image.shape[:2]
    params, rms = solve_camera(photo, width, height)
    data = bpy.data.cameras.new(photo['name'])
    data.lens = float(params[7])
    data.sensor_fit = 'HORIZONTAL'
    data.sensor_width = 36.0
    cam = bpy.data.objects.new(photo['name'], data)
    scene.collection.objects.link(cam)
    rotation = basis(params[:3], params[3:6], params[6])
    cam.matrix_world = Matrix.Translation(Vector(params[:3])) @ Matrix(rotation.tolist()).to_4x4()
    scene.camera = cam
    scene.render.resolution_x, scene.render.resolution_y = width, height
    render_path = out_dir / f"{photo['name']}-render.png"
    scene.render.filepath = str(render_path)
    bpy.ops.render.render(write_still=True)
    render = read_rgb(render_path)
    if photo.get('points'):  # marked points: green on the photo, red where the solve puts them
        for (u, v), (pu, pv) in zip([p['px'] for p in photo['points']],
                                    project(params, np.array([p['xyz'] for p in photo['points']]),
                                            width, height)):
            for img, (a, b), colour in ((image, (u, v), (0.1, 0.9, 0.1)), (render, (pu, pv), (0.9, 0.1, 0.1))):
                r0, c0 = int(b), int(a)
                img[max(0, r0 - 6):r0 + 7, max(0, c0 - 6):c0 + 7] = colour
    print('CAMERA', photo['name'], 'rms px', round(rms, 1), 'location', np.round(params[:3], 3).tolist(),
          'target', np.round(params[3:6], 3).tolist(), 'roll', round(float(params[6]), 3),
          'lens', round(float(params[7]), 1))
    side_by_side = np.concatenate([resize(image, HEIGHT), np.ones((HEIGHT, 8, 3)),
                                   resize(render, HEIGHT)], axis=1)
    write_rgb(out_dir / f"{photo['name']}.png", side_by_side)
    print('COMPARE', out_dir / f"{photo['name']}.png")
