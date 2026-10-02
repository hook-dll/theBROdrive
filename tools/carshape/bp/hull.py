"""Builds a car's body shell from its four-view drawing.

    build/pyenv/bin/python tools/carshape/bp/hull.py <car>

The shell is the set of points every view agrees is car, the way a modeller reads a
blueprint, with the shape between the views taken from the views themselves:

  side      the drawing's own outline; the bumpers are cut out of it (they are parts)
            and the body stops at the sill line
  plan      the half-width at each station, from the top view
  section   the half-width at each height, from the front view at the nose and the
            rear view at the tail, blended between the axles and scaled to the plan,
            so the tumblehome and tuck-under are the car's own
  glasshouse above the belt, inside the cabin: the same sections scaled to its own
            plan (the glass base), under a roof whose cross-curve is the front view's
            top, carried down the screens
  bonnet    and boot crowned across

Wheel wells are cut round the factory axles. The occupancy grid (1 cm) is blurred by
the car's edge radius and contoured, so creases the views draw stay crisp and nothing
is approximated by a box. Writes build/carshape/<car>/hull.ply (car coordinates of
carbody.py: nose -y, +z up) and hull.json (lines the parts stage needs).
"""
import json
import os
import sys

import numpy as np
from scipy import ndimage
from skimage import measure
import trimesh

sys.path.insert(0, os.path.dirname(__file__))
import bpread  # noqa: E402
import grid  # noqa: E402

G = 0.01


def pl(points, at):
    """Piecewise-linear through [[a, b], ...], held flat past the ends."""
    p = np.array(sorted(points), float)
    return np.interp(at, p[:, 0], p[:, 1])


def fill_band(arr, axis_vals, band):
    """Replaces arr over axis_vals in [band] by a straight line between its ends."""
    a, b = band
    m = (axis_vals >= a) & (axis_vals <= b)
    if not m.any():
        return arr
    i0, i1 = np.nonzero(m)[0][[0, -1]]
    i0, i1 = max(i0 - 1, 0), min(i1 + 1, len(arr) - 1)
    arr = arr.copy()
    arr[i0:i1 + 1] = np.linspace(arr[i0], arr[i1], i1 - i0 + 1)
    return arr


def smooth1(a, size=5, sigma=1.5):
    return ndimage.gaussian_filter1d(ndimage.median_filter(a, size, mode='nearest'), sigma, mode='nearest')


def smooth_inner(a, at, sigma, margin):
    """Smooths `a` with a wide kernel where it is non-zero, blending back to the raw
    values within `margin` of its ends, so the corners keep their radius."""
    nz = np.nonzero(a > 1e-3)[0]
    if len(nz) < 3:
        return a
    lo, hi = at[nz[0]], at[nz[-1]]
    wide = ndimage.gaussian_filter1d(a, sigma / (at[1] - at[0]), mode='nearest')
    w = np.clip(np.minimum(at - lo, hi - at) / margin, 0, 1)
    return a * (1 - w) + wide * w


def build(car):
    spec, bp = grid.load(car)
    F = spec['factory']
    L, W, H, R = F['length'], F['width'], F['height'], F['wheelRadius']
    hs = spec['hull']
    ys, zs = bp['ys'], bp['zs']
    # The side outline is worked on a 2.5 mm grid and turned into a signed distance, so
    # the shell's sides land between voxels instead of stepping from one to the next.
    FINE = 4
    yf = np.arange(ys[0], ys[-1] + 1e-9, G / FINE)
    zf = np.arange(zs[0], zs[-1] + 1e-9, G / FINE)
    side = bpread.sample_side(bp, yf, zf)                 # [z, y]
    side = ndimage.gaussian_filter(side.astype(np.float32), FINE * 0.6) > 0.5

    # ---- side: bumpers out, floor up ------------------------------------------------
    # Row extents of the outline (nose and tail), with each bumper's band bridged.
    nose = np.full(len(zf), np.nan)
    tail = np.full(len(zf), np.nan)
    for i in range(len(zf)):
        c = np.nonzero(side[i])[0]
        if len(c):
            nose[i], tail[i] = yf[c[0]], yf[c[-1]]
    raw_ends = {}
    for end, ext in (('front', nose), ('rear', tail)):
        b = hs.get('bumpers', {}).get(end)
        ok = ~np.isnan(ext)
        if b:
            # Where the drawing's bumper stands: its outer face, for the bumper part.
            band = (zf >= b['z'][0]) & (zf <= b['z'][1]) & ok
            if band.any():
                raw_ends[end] = float(ext[band].min() if end == 'front' else ext[band].max())
        ext[:] = np.interp(np.arange(len(zf)), np.nonzero(ok)[0], ext[ok])
        if b:
            ext[:] = fill_band(ext, zf, b['z'])
        # Lines drawn across the face (a valance, a grille's edge) nick the outline row by
        # row: the face is smoothed up and down (4 cm), its top and bottom kept.
        ext[:] = ndimage.gaussian_filter1d(ext, hs.get('faceSmooth', 0.04) / (G / FINE), mode='nearest')
        if 'face' in hs and end in hs['face']:
            # A face given outright: [[z, y], ...] for the band it spans.
            pts = np.array(hs['face'][end])
            m = (zf >= pts[:, 0].min()) & (zf <= pts[:, 0].max())
            ext[m] = np.interp(zf[m], pts[:, 0], pts[:, 1])
    side &= (yf[None, :] >= nose[:, None] - 1e-6) & (yf[None, :] <= tail[:, None] + 1e-6)
    side &= zf[:, None] >= pl(hs['sill'], yf)[None, :]
    if 'topOverride' in hs:
        # The top over a span given outright (an open tailgate drawn over the roof, a
        # roof rack): clipped above, and filled below down to the sill.
        to = hs['topOverride']
        span = (yf[None, :] >= to[0][0]) & (yf[None, :] <= to[-1][0])
        zt = pl(to, yf)[None, :]
        side &= ~span | (zf[:, None] <= zt)
        side |= span & (zf[:, None] <= zt) & (zf[:, None] >= pl(hs['sill'], yf)[None, :])
    d_side_f = (ndimage.distance_transform_edt(side) - ndimage.distance_transform_edt(~side)) * (G / FINE)
    d_side = d_side_f[::FINE, ::FINE][:len(zs), :len(ys)]                   # [z, y], metres
    sill = pl(hs['sill'], ys)
    # The top of the outline at every station.
    top_f = np.array([zf[np.nonzero(side[:, j])[0][-1]] if side[:, j].any() else 0 for j in range(len(yf))])
    top = smooth1(top_f, 9, 2.0)[::FINE][:len(ys)]
    # Drip rails, aerials and the like stand above the roof in the drawing.
    if 'roofTop' in hs:
        top = np.minimum(top, hs['roofTop'])

    # ---- plan --------------------------------------------------------------------------
    # No top view: the plan is the factory width, or what planOverride gives.
    plan = smooth1(bp['plan'], 9, 3.0) if 'plan' in bp else np.full(len(ys), W / 2)
    # Away from the ends the plan is a long, slow curve: lines the top view draws
    # along the sides (mouldings, shut lines) only nick it.
    plan = smooth_inner(plan, ys, hs.get('planSmooth', 0.08), 0.18)
    for band in hs.get('planBridge', []):
        plan = fill_band(plan, ys, band)
    # Lamps and mouldings on the flanks stand a few mm proud: the shell stays inside
    # the factory width by that much.
    plan = np.minimum(plan, W / 2 - hs.get('skinInset', 0.008))
    if 'planOverride' in hs:
        m = (ys >= hs['planOverride'][0][0]) & (ys <= hs['planOverride'][-1][0])
        plan[m] = pl(hs['planOverride'], ys[m])

    # ---- sections ------------------------------------------------------------------
    secs = {}
    for end in ('front', 'rear'):
        # No end views at all: a plain box section (the stations give the shape).
        s = bp.get(end, bp.get('front', np.full(len(zs), W / 2))).copy()
        # Mirrors and lamp pods stick out of an end view for a few centimetres of height:
        # a running median as tall as a mirror head takes them out of the section.
        med = hs.get('sectionMedian', 15)
        if med:
            s = ndimage.median_filter(s, size=med, mode='nearest')
        s = smooth1(s, 7, 2.0)
        s = smooth_inner(s, zs, hs.get('sectionSmooth', 0.03), 0.06)
        b = hs.get('bumpers', {}).get(end)
        if b:
            s = fill_band(s, zs, [b['z'][0] - 0.02, b['z'][1] + 0.02])
        for band in hs.get('sectionBridge', {}).get(end, hs.get('sectionBridge', {}).get('both', [])):
            s = fill_band(s, zs, band)
        # Below the sill the drawing shows tyres, not body: hold the sill's width.
        z_lo = min(hs['sill'], key=lambda p: p[1])[1]
        s[zs < z_lo + 0.05] = s[np.searchsorted(zs, z_lo + 0.05)]
        if hs.get('sectionExtendTop'):
            # An end view drawn lower than the hull's top (an open car given a hood):
            # the glasshouse keeps its topmost drawn width up to the roof.
            nz = np.nonzero(s > 0.05)[0]
            if len(nz):
                k = nz[-1]
                ext = hs['sectionExtendTop']
                s[k + 1:] = ext if not isinstance(ext, bool) else s[max(k - 3, 0)]
                # and the last drawn rows blend into it
                s[max(k - 8, 0):k + 1] = np.maximum(s[max(k - 8, 0):k + 1], np.linspace(s[max(k - 8, 0)], s[k + 1], k + 1 - max(k - 8, 0)))
        secs[end] = np.minimum(s, W / 2)
    ya_f = -L / 2 + F['frontOverhang']
    ya_r = ya_f + F['wheelbase']
    t = np.clip((ys - ya_f) / (ya_r - ya_f), 0, 1)
    t = t * t * (3 - 2 * t)
    sec = secs['front'][:, None] * (1 - t[None, :]) + secs['rear'][:, None] * t[None, :]   # [z, y]
    # Sections given outright over a span of stations, {y: [y0, y1], half: [[z, x], ...],
    # blend}: a body whose middle is not a blend of its ends (the Beetle's doors are
    # narrower than the wings either side of them).
    for k in hs.get('sectionKeys', []):
        y0, y1 = k['y']
        bl = k.get('blend', 0.15)
        w = np.clip(np.minimum((ys - (y0 - bl)) / bl, ((y1 + bl) - ys) / bl), 0, 1)
        w = w * w * (3 - 2 * w)
        sk = np.minimum(pl(k['half'], zs), W / 2)
        sk[zs > max(p[0] for p in k['half'])] = 0
        sec = sec * (1 - w[None, :]) + sk[:, None] * w[None, :]

    # Sections at stations, in metres as they are ({y, half: [[z, x], ...]}, interpolated
    # between stations and blended into the views' section over `stationBlend` beyond
    # the first and last): where the plan and one end view cannot say it (wings that
    # end before the lid between them does).
    st = sorted(hs.get('sectionStations', []), key=lambda c: c['y'])
    w_abs = np.zeros(len(ys))
    sec_abs = np.zeros_like(sec)
    if st:
        bl = hs.get('stationBlend', 0.08)
        prof = [np.minimum(pl(c['half'], zs), W / 2) * (zs <= max(p[0] for p in c['half'])) for c in st]
        sy = np.array([c['y'] for c in st])
        for j, y in enumerate(ys):
            if y < sy[0] - bl or y > sy[-1] + bl:
                continue
            if y <= sy[0]:
                sec_abs[:, j], w = prof[0], 1 - (sy[0] - y) / bl
            elif y >= sy[-1]:
                sec_abs[:, j], w = prof[-1], 1 - (y - sy[-1]) / bl
            else:
                i = int(np.searchsorted(sy, y)) - 1
                f = (y - sy[i]) / (sy[i + 1] - sy[i])
                sec_abs[:, j], w = prof[i] * (1 - f) + prof[i + 1] * f, 1.0
            w_abs[j] = w * w * (3 - 2 * w)

    # ---- the glasshouse -----------------------------------------------------------
    c0, c1 = hs['cabin']
    belt = pl(hs['belt'], ys)
    in_cabin = (ys >= c0) & (ys <= c1)
    gplan = pl(hs['glassPlan'], ys)
    z_ref = hs.get('beltRef', float(np.median(belt[in_cabin])))
    i_ref = np.searchsorted(zs, z_ref)
    # Below the belt the section is scaled to the plan by its widest point there.
    lower_ref = np.array([sec[: i_ref + 1, j].max() for j in range(len(ys))])
    roof_top = hs.get('roofTop', float(top[in_cabin].max()))
    # The roof's cross-curve, carried down the screens: a crown over the roof's width.
    sec_mid = sec[:, np.argmin(np.abs(ys - (c0 + c1) / 2))]
    xq = np.arange(0, W / 2 + G, G)
    roof_half = hs.get('roofHalf', 0.55)
    roof_drop = hs.get('roofCrown', 0.03) * (xq / roof_half) ** 2
    # The glasshouse's own width just above the shoulder, not the shoulder's.
    g_ref = sec_mid[np.searchsorted(zs, z_ref + hs.get('glassRefLift', 0.05))]

    xs = np.arange(0, W / 2 + 0.03, G)
    big = 1.0
    dist = np.full((len(xs), len(zs), len(ys)), -big, np.float32)
    crown = pl(hs.get('crown', [[-9, 0.02], [9, 0.02]]), ys)
    # The top across the car given at stations, {y, z: [[x, z], ...]}, interpolated
    # between them: a bonnet lower than the wings either side of it, a valley between.
    tc = sorted(hs.get('topCross', []), key=lambda c: c['y'])

    def top_cross(y):
        if not tc or y < tc[0]['y'] or y > tc[-1]['y']:
            return None
        i = max(k for k in range(len(tc)) if tc[k]['y'] <= y)
        if i == len(tc) - 1:
            return pl(tc[i]['z'], xs)
        f = (y - tc[i]['y']) / (tc[i + 1]['y'] - tc[i]['y'])
        return pl(tc[i]['z'], xs) * (1 - f) + pl(tc[i + 1]['z'], xs) * f
    for j, y in enumerate(ys):
        if d_side[:, j].max() <= -0.05:
            continue
        lower_top = belt[j] if in_cabin[j] else top[j]
        xl = plan[j] * sec[:, j] / max(lower_ref[j], 1e-3)          # [z]
        if w_abs[j] > 0:
            xl = xl * (1 - w_abs[j]) + sec_abs[:, j] * w_abs[j]
        u = np.clip(xs / max(plan[j], 1e-3), 0, 1)
        zl = lower_top - crown[j] * u ** 2                            # [x]
        if not in_cabin[j]:
            zc = top_cross(y)
            if zc is not None:
                zl = zc
        d = np.minimum(xl[None, :] - xs[:, None], zl[:, None] - zs[None, :])
        if in_cabin[j]:
            k = gplan[j] / max(g_ref, 1e-3)
            xg = sec[:, j] * k
            if w_abs[j] > 0:
                xg = xg * (1 - w_abs[j]) + sec_abs[:, j] * w_abs[j]
            drop = np.interp(xs / max(k, 1e-3), xq, roof_drop)
            zg = top[j] - drop
            up = np.minimum(np.minimum(xg[None, :] - xs[:, None], zg[:, None] - zs[None, :]),
                            zs[None, :] - (belt[j] - 0.03))
            d = np.maximum(d, up)
        dist[:, :, j] = np.minimum(d, d_side[None, :, j])

    # ---- wheel wells ---------------------------------------------------------------
    for ya, track, which in ((ya_f, F['frontTrack'], 'front'), (ya_r, F['rearTrack'], 'rear')):
        # One arch for both axles, or a `front` / `rear` entry overriding it (the rear
        # arch of a pontoon body sits lower, a skirted one is not cut at all).
        arch = dict(hs.get('arch', {}), **hs.get('arch', {}).get(which, {}))
        if arch.get('skirt'):
            continue
        ra = arch.get('radius', R * 1.14)
        za = R + arch.get('lift', 0.02)
        x_in = track / 2 - F['tyreWidth'] / 2 - arch.get('inset', 0.04)
        r = np.sqrt((ys[None, :] - ya) ** 2 + (zs[:, None] - za) ** 2)
        inside_well = np.where(zs[:, None] >= za, ra - r, ra - np.abs(ys[None, :] - ya))   # [z, y]
        cut = np.minimum(inside_well[None, :, :], (xs - x_in)[:, None, None])
        dist = np.minimum(dist, -cut)

    # ---- mirror, smooth, contour ----------------------------------------------------
    full = np.concatenate([dist[:0:-1], dist], axis=0)
    xs_full = np.concatenate([-xs[:0:-1], xs])
    pad = 4
    full = np.pad(np.clip(full, -4 * G, 4 * G), pad, constant_values=-4 * G)
    sigma = hs.get('edge', 0.015) / G
    smooth = ndimage.gaussian_filter(full, sigma)
    verts, faces, normals, _ = measure.marching_cubes(smooth, 0.0)
    verts = (verts - pad) * G
    verts[:, 0] += xs_full[0]
    verts[:, 1] += zs[0]
    verts[:, 2] += ys[0]
    # grid axes are (x, z, y) -> car (x, y, z)
    v = np.stack([verts[:, 0], verts[:, 2], verts[:, 1]], axis=1)
    mesh = trimesh.Trimesh(v, faces[:, [0, 2, 1]], process=True)
    if mesh.volume < 0:
        mesh.invert()
    out = os.path.join(grid.ROOT, 'build/carshape', car)
    mesh.export(os.path.join(out, 'hull.ply'))
    # The working shell: the full one reduced by quadric error, which keeps creases
    # (the arch lips, the bonnet edge) where they are.
    import pymeshlab
    ms = pymeshlab.MeshSet()
    ms.load_new_mesh(os.path.join(out, 'hull.ply'))
    ms.meshing_decimation_quadric_edge_collapse(targetfacenum=hs.get('workFaces', 14000), qualitythr=0.9,
                                                preservenormal=True, optimalplacement=True)
    ms.save_current_mesh(os.path.join(out, 'work.ply'))
    info = {
        'ys': [round(float(a), 3) for a in ys], 'top': [round(float(a), 3) for a in top],
        'plan': [round(float(a), 3) for a in plan], 'belt': [round(float(a), 3) for a in belt],
        'sill': [round(float(a), 3) for a in sill], 'cabin': [c0, c1],
    }
    info['bumperPaths'] = bumper_paths(mesh, spec, info, raw_ends)
    json.dump(info, open(os.path.join(out, 'hull.json'), 'w'))
    print(f'HULL {car}: {len(mesh.faces)} faces, volume {mesh.volume:.3f} m3, '
          f'extent {np.round(mesh.extents, 3).tolist()}')
    return spec, bp, info


def bumper_paths(mesh, spec, info, raw_ends):
    """Each bumper's centreline in plan: the shell's own outline at the bumper's height,
    stood off it, from one wrap end round the nose (or tail) to the other."""
    out = {}
    for end, b in spec.get('parts', {}).get('bumpers', {}).items():
        zc = (b['z'][0] + b['z'][1]) / 2
        sec = mesh.section(plane_origin=[0, 0, zc], plane_normal=[0, 0, 1])
        if sec is None:
            continue
        pts = np.vstack([d[:, :2] for d in sec.discrete])
        sgn = -1 if end == 'front' else 1
        y_end = pts[:, 1].min() if end == 'front' else pts[:, 1].max()
        wrap = b.get('wrap', 0.25)
        # The outline's points within `wrap` of the end, as half-width by station.
        keep = pts[np.abs(pts[:, 1] - y_end) <= wrap]
        # Sample round the end at even angles about a centre behind the nose.
        c = np.array([0.0, y_end - sgn * 0.6])
        rel = keep - c
        ang = np.arctan2(rel[:, 0], sgn * rel[:, 1])
        order = np.argsort(ang)
        rel, ang = rel[order], ang[order]
        rad = np.hypot(rel[:, 0], rel[:, 1])
        a_s = np.linspace(ang.min(), ang.max(), 41)
        # Stood off the shell so its face is where the drawing has it (the factory
        # length includes the bumpers), but never closer than 5 mm.
        dpt = b.get('depth', 0.06)
        stand = b.get('standOff')
        if stand is None and end in raw_ends:
            stand = abs(y_end - raw_ends[end]) - dpt
            if b.get('overriders'):
                stand -= 0.015
            print('BUMPER', end, 'shell', round(float(y_end), 3), 'drawn', round(raw_ends[end], 3), 'stand', round(stand, 3))
        # (negative: the bar sits partly inside the shell, as a wrapped bumper does)
        if b.get('standOff') is None:
            stand = max(-dpt / 2 + 0.01, 0.02 if stand is None else stand)
        # The outer envelope: the furthest point in each angular bin (the section can
        # hold inner loops, an arch or a recess, that must not pull the bar in).
        bins = np.clip(np.searchsorted(a_s, ang), 0, 40)
        r_env = np.full(41, np.nan)
        for k in range(41):
            m = bins == k
            if m.any():
                r_env[k] = rad[m].max()
        ok = ~np.isnan(r_env)
        r_env = np.interp(np.arange(41), np.nonzero(ok)[0], r_env[ok])
        r_env = ndimage.gaussian_filter1d(ndimage.maximum_filter1d(r_env, 3), 1.0, mode='nearest')
        r_s = r_env + stand + dpt / 2
        path = np.stack([c[0] + r_s * np.sin(a_s), c[1] + sgn * r_s * np.cos(a_s)], axis=1)
        # Ends no further back than `wrap` from the face.
        path = path[np.abs(path[:, 1] - y_end) <= wrap + 1e-3]
        # The wrap ends no wider than the body.
        W = spec['factory']['width']
        path[:, 0] = np.clip(path[:, 0], -(W / 2 - dpt / 2), W / 2 - dpt / 2)
        out[end] = [[round(float(x), 4), round(float(y), 4), round(zc, 4)] for x, y in path]
    return out


if __name__ == '__main__':
    build(sys.argv[1])
