"""Close a reference car's surface into a solid (plain Python + numpy/scipy).

    python3 tools/carforge/solid.py <surface.npz> <solid.npz> [--voxel MM] [--close MM]

A reference built for a game is a set of panels: doors, bonnet, wings, bumpers and the seals round
the glass are separate sheets with slits between them, and nothing closes it underneath. A pack
car is one closed skin. This turns the panels into the solid they bound:

1. Every surface point (`points`, mm, from reduce.py: the reference's triangles sampled finer than
   a voxel) marks its voxel.
2. Closing: the marks are grown by `close` mm, so slits narrower than about twice that are filled.
3. Outside: the empty voxels reachable from the grid's border. Openings wider than the closing
   (an open underbody, a wheel well) would let the outside reach the cabin, so the flood also
   stops at every voxel that has surface on both sides of it across the car and along it: the
   cabin is between the doors and between the screens, while a well, the space under the car,
   a grille recess or the shelf of a bumper each open to one side. Blocking voxels that the
   flood would otherwise have reached through a slit stay solid: they are inside the car.
4. Solid: everything not outside, shrunk back by `close` mm (the closing's growth undone).

Writes {solid (bool grid), origin (mm of voxel 0,0,0's centre), voxel (mm)}. reduce.py meshes it.
"""

import argparse

import numpy as np
from scipy import ndimage as ndi


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("surface")
    ap.add_argument("out")
    ap.add_argument("--voxel", type=float, default=10.0)
    ap.add_argument("--close", type=float, default=20.0)
    a = ap.parse_args()
    pts = np.load(a.surface)["points"]
    v = a.voxel
    pad = 4 + int(np.ceil(a.close / v))
    lo = pts.min(axis=0) - pad * v
    shape = tuple(int(n) for n in np.ceil((pts.max(axis=0) + pad * v - lo) / v) + 1)
    idx = np.floor((pts - lo) / v).astype(int)
    surf = np.zeros(shape, bool)
    surf[idx[:, 0], idx[:, 1], idx[:, 2]] = True

    r = int(round(a.close / v))
    ball = ndi.generate_binary_structure(3, 1)
    grown = ndi.binary_dilation(surf, ball, iterations=r) if r else surf

    def between(axis):
        """Voxels with surface on both sides along `axis`."""
        before = np.maximum.accumulate(surf, axis=axis)
        after = np.flip(np.maximum.accumulate(np.flip(surf, axis), axis=axis), axis)
        return before & after

    walls = between(0) & between(1)  # between the two sides and between nose and tail
    blocked = grown | walls
    outside = ndi.binary_propagation(np.zeros(shape, bool) | _border(shape), mask=~blocked)
    solid = ~outside
    if r:
        solid = ndi.binary_erosion(solid, ball, iterations=r, border_value=0)
    solid = ndi.binary_fill_holes(solid)
    lab, n = ndi.label(solid)
    if n > 1:  # keep the car, not specks
        sizes = ndi.sum(solid, lab, range(1, n + 1))
        solid = lab == (1 + int(np.argmax(sizes)))
    np.savez_compressed(a.out, solid=solid, origin=lo + v / 2, voxel=v)
    print(f"SOLID grid {shape}, {int(solid.sum())} voxels of {v:.0f} mm, closing {a.close:.0f} mm")


def _border(shape):
    b = np.zeros(shape, bool)
    b[0, :, :] = b[-1, :, :] = True
    b[:, 0, :] = b[:, -1, :] = True
    b[:, :, 0] = b[:, :, -1] = True
    return b


if __name__ == "__main__":
    main()
