"""Fold score of a car's dense hull: at sampled points a quadratic surface is fitted to
the shell within 12 cm; the residual (mm) is what a smooth panel cannot explain --
waves, folds, crumples. Rounded edges fit a quadratic; ripples do not.
    build/pyenv/bin/python build/carshape/folds.py <car> [png]"""
import sys, numpy as np, trimesh
from scipy.spatial import cKDTree
car = sys.argv[1]
m = trimesh.load(f'build/carshape/{car}/hull.ply', process=False)
V = np.asarray(m.vertices)
rng = np.random.default_rng(1)
idx = rng.choice(len(V), size=min(4000, len(V)), replace=False)
tree = cKDTree(V)
R = 0.12
res = np.zeros(len(idx))
for k, i in enumerate(idx):
    nb = V[tree.query_ball_point(V[i], R)]
    if len(nb) < 30:
        continue
    c = nb.mean(0); X = nb - c
    _, _, vt = np.linalg.svd(X, full_matrices=False)
    u, v, n = X @ vt[0], X @ vt[1], X @ vt[2]
    A = np.stack([u * u, u * v, v * v, u, v, np.ones_like(u)], 1)
    coef, *_ = np.linalg.lstsq(A, n, rcond=None)
    res[k] = np.sqrt(np.mean((A @ coef - n) ** 2)) * 1000
P = V[idx]
Nrm = m.vertex_normals[idx]
topm = Nrm[:, 2] > 0.6
sidem = (Nrm[:, 0] > 0.6)
print(f'{car:12s} top {np.median(res[topm]):.2f} mm (bad {np.mean(res[topm] > 2) * 100:4.1f}%)  side {np.median(res[sidem]):.2f} mm (bad {np.mean(res[sidem] > 2) * 100:4.1f}%)')
if len(sys.argv) > 2:
    from PIL import Image, ImageDraw
    W, H = 650, 900
    im = Image.new('RGB', (W, H), (30, 30, 30)); d = ImageDraw.Draw(im)
    for (vx, vy, vz), r, tp, sd in zip(P, res, topm, sidem):
        col = (int(min(255, r * 80)), int(max(0, 200 - r * 60)), 60)
        if tp:
            px, py = 300 + vy * 120, 250 - vx * 160
            d.ellipse([px - 2, py - 2, px + 2, py + 2], fill=col)
        if sd:
            px, py = 300 + vy * 120, 800 - vz * 160
            d.ellipse([px - 2, py - 2, px + 2, py + 2], fill=col)
    im.save(sys.argv[2])
