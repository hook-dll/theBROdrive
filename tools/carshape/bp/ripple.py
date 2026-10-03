"""Ripple of a car's dense hull: along lines down the car (on the side at every height,
on the top at every distance from the centre) the surface is sampled by ray and only
the 4-40 cm wavelengths are kept -- a fair body has none there (its creases run along
those lines, its arches and ends are cut out). RMS in mm, and where it is worst.
    build/pyenv/bin/python tools/carshape/bp/ripple.py <car> [-v]"""
import os, runpy, sys
import numpy as np, trimesh
from scipy import ndimage
car = sys.argv[1]
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
m = trimesh.load(os.path.join(ROOT, 'build/carshape', car, 'hull.ply'), process=False)
F = runpy.run_path(os.path.join(ROOT, 'tools/carshape/bp/cars', car + '.py'))['CAR']
f, hs = F['factory'], F['hull']
L, R = f['length'], f['wheelRadius']
ya = -L / 2 + f['frontOverhang']; yb = ya + f['wheelbase']
arch = hs.get('arch', {}); ra = arch.get('radius', R * 1.14) + 0.05; za = R + arch.get('lift', 0.02)
step = 0.01
ys = np.arange(m.bounds[0][1] + 0.12, m.bounds[1][1] - 0.12, step)


def band(v):
    """4-40 cm content of each continuous run (at least 50 cm, no jumps over 1 cm),
    its 6 cm ends dropped."""
    out = np.full(len(v), np.nan)
    ok = ~np.isnan(v)
    jump = np.r_[False, np.abs(np.diff(np.where(ok, v, 0))) > 0.01]
    seg = np.cumsum(~ok | jump)
    for k in np.unique(seg[ok]):
        idx = np.nonzero(ok & (seg == k))[0]
        if len(idx) * step < 0.5:
            continue
        vi = v[idx]
        hp = vi - ndimage.gaussian_filter1d(vi, 0.40 / step / 2.355 * 2, mode='nearest')
        bp = ndimage.gaussian_filter1d(hp, 0.04 / step / 2.355 * 2, mode='nearest')
        e = int(0.06 / step)
        out[idx[e:len(idx) - e]] = bp[e:len(idx) - e]
    return out if (~np.isnan(out)).sum() > 20 else None


def cast(o, d):
    loc, ri, _ = m.ray.intersects_location(o, np.tile(np.array(d, float), (len(o), 1)), multiple_hits=False)
    loc = np.asarray(loc, float).reshape(-1, 3)
    out = np.full(len(o), np.nan); return loc, ri, out


rows = []
for z in np.arange(0.25, m.bounds[1][2] - 0.05, 0.03):          # the side, x(y)
    o = np.stack([np.full_like(ys, 3.0), ys, np.full_like(ys, z)], 1)
    loc, ri, x = cast(o, [-1.0, 0, 0]); x[ri] = loc[:, 0]
    # out: the wells, and where the side is far inboard (screen, ends)
    for yw in (ya, yb):
        x[(np.abs(ys - yw) < ra) & (z < za + ra)] = np.nan
    x[x < np.nanmax(x) - 0.25] = np.nan
    b = band(x)
    if b is not None:
        rows.append(('side', z, b))
W = f['width'] / 2
for xx in np.arange(-W + 0.12, W - 0.12, 0.05):                  # the top, z(y)
    o = np.stack([np.full_like(ys, xx), ys, np.full_like(ys, 3.0)], 1)
    loc, ri, zz = cast(o, [0, 0, -1.0]); zz[ri] = loc[:, 2]
    # keep only gently sloping deck and roof, not the screens and ends
    dz = np.gradient(zz, step)
    zz[np.abs(dz) > 0.35] = np.nan
    b = band(zz)
    if b is not None:
        rows.append(('top', xx, b))
side = np.concatenate([np.abs(r[2][~np.isnan(r[2])]) for r in rows if r[0] == 'side']) * 1000
top = np.concatenate([np.abs(r[2][~np.isnan(r[2])]) for r in rows if r[0] == 'top']) * 1000
rms = lambda a: float(np.sqrt(np.mean(a ** 2)))
print(f'{car:12s} ripple side {rms(side):.2f} mm (p95 {np.percentile(side, 95):.1f})  top {rms(top):.2f} mm (p95 {np.percentile(top, 95):.1f})')
if '-v' in sys.argv:
    for kind in ('side', 'top'):
        worst = sorted(((np.nanmax(np.abs(r[2])) * 1000, r[1], ys[np.nanargmax(np.abs(r[2]))]) for r in rows if r[0] == kind), reverse=True)[:6]
        print('  worst', kind, ' '.join(f'[{"z" if kind == "side" else "x"} {a:.2f} y {y:+.2f}: {w:.1f}mm]' for w, a, y in worst))
