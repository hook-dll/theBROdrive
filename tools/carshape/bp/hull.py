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

G = float(os.environ.get('CARSHAPE_G', 0.01))


def pl(points, at):
    """Piecewise-linear through [[a, b], ...], held flat past the ends."""
    p = np.array(sorted(points), float)
    return np.interp(at, p[:, 0], p[:, 1])


def sm(points, at):
    """A smooth curve through [[a, b], ...] (monotone cubic: no overshoot, no kink at
    the points), held flat past the ends. For lines along the car: joined by straight
    pieces, every point given would be a fold across the body."""
    p = np.array(sorted(points), float)
    _, keep = np.unique(p[:, 0], return_index=True)
    p = p[np.sort(keep)]
    if len(p) < 3:
        return np.interp(at, p[:, 0], p[:, 1])
    from scipy.interpolate import PchipInterpolator
    a = np.clip(at, p[0, 0], p[-1, 0])
    return PchipInterpolator(p[:, 0], p[:, 1])(a)


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


FAIR_CORNER = [28.0]


def fair(at, val, spacing=0.15, corner_deg=None, mask=None):
    """A drawn profile made fair: a least-squares cubic spline with knots every
    `spacing`, so it cannot ripple at any shorter wavelength than that, with a corner
    (triple knot) wherever the drawing really turns sharply (more than `corner_deg`
    within 5 cm), so creases stay creases. `mask` limits the fit to where the profile
    exists; outside it the values are returned as they were."""
    from scipy.interpolate import make_lsq_spline
    if corner_deg is None:
        corner_deg = FAIR_CORNER[0]
    at = np.asarray(at, float)
    val = np.asarray(val, float)
    out = val.copy()
    if spacing <= 0:
        return out
    m = np.ones(len(at), bool) if mask is None else np.asarray(mask, bool)
    idx = np.nonzero(m)[0]
    if len(idx) < 12:
        return out
    # each run of the mask on its own
    runs = np.split(idx, np.nonzero(np.diff(idx) > 1)[0] + 1)
    step = at[1] - at[0]
    for r in runs:
        if len(r) < 12:
            continue
        x, y = at[r], val[r]
        span = x[-1] - x[0]
        if span < 2 * spacing:
            continue
        # corners: the direction of the lightly smoothed profile turns sharply
        ys_ = ndimage.gaussian_filter1d(y, max(1.0, 0.01 / step), mode='nearest')
        w = max(2, int(round(0.025 / step)))
        ang = np.full(len(x), 0.0)
        for i in range(w, len(x) - w):
            a1 = np.arctan2(ys_[i] - ys_[i - w], x[i] - x[i - w])
            a2 = np.arctan2(ys_[i + w] - ys_[i], x[i + w] - x[i])
            ang[i] = abs(np.degrees(a2 - a1))
        corners = []
        for i in np.argsort(-ang):
            if ang[i] < corner_deg:
                break
            if all(abs(x[i] - c) > 0.05 for c in corners) and x[0] + 0.03 < x[i] < x[-1] - 0.03:
                corners.append(x[i])
        n_in = max(1, int(span / spacing))
        inner = list(np.linspace(x[0], x[-1], n_in + 1)[1:-1])
        inner = [k for k in inner if all(abs(k - c) > 0.04 for c in corners)]
        knots_in = sorted(inner + corners * 3)
        t = np.r_[[x[0]] * 4, knots_in, [x[-1]] * 4]
        try:
            spl = make_lsq_spline(x, y, t, k=3)
            out[r] = spl(x)
        except Exception:
            pass
    return out


def smooth1(a, size=5, sigma=1.5):
    return ndimage.gaussian_filter1d(ndimage.median_filter(a, size, mode='nearest'), sigma, mode='nearest')


def smooth_inner(a, at, sigma, margin):
    """Smooths `a` with a wide kernel where it is non-zero, blending back to the raw
    values within `margin` of its ends, so the corners keep their radius."""
    nz = np.nonzero(a > 1e-3)[0]
    if len(nz) < 3:
        return a
    # the ends where the shape turns in (half its width), not where an earlier blur's
    # tail fades out above them
    nh = np.nonzero(a > 0.5 * a.max())[0]
    lo, hi = at[nh[0]], at[nh[-1]]
    wide = ndimage.gaussian_filter1d(a, sigma / (at[1] - at[0]), mode='nearest')
    w = np.clip(np.minimum(at - lo, hi - at) / margin, 0, 1)
    return a * (1 - w) + wide * w


def build(car):
    spec, bp = grid.load(car)
    FAIR_CORNER[0] = spec['hull'].get('cornerDeg', 999.0)
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
    side = ndimage.gaussian_filter(side.astype(np.float32), hs.get('sideBlur', 0.006) / (G / FINE)) > 0.5
    # Over the cabin a column of the outline is solid from the sill to the roof: a roof
    # strip the flood fill could not reach (a drip rail drawn as two lines, a gap at a
    # pillar) is closed, or the roof would hang on its drawn line alone.
    c0_, c1_ = hs['cabin']
    gap_max = hs.get('roofGap', 0.15) / (G / FINE)
    for j in np.nonzero((yf >= c0_) & (yf <= c1_))[0]:
        col = np.nonzero(side[:, j])[0]
        if len(col) < 2:
            continue
        gaps = np.nonzero(np.diff(col) > 1)[0]
        for g in gaps:
            if col[g + 1] - col[g] <= gap_max and zf[col[g]] > 0.6:
                side[col[g]:col[g + 1], j] = True

    # ---- side: bumpers out, floor up ------------------------------------------------
    # Row extents of the outline (nose and tail), with each bumper's band bridged.
    nose = np.full(len(zf), np.nan)
    tail = np.full(len(zf), np.nan)
    for i in range(len(zf)):
        c = np.nonzero(side[i])[0]
        if len(c):
            nose[i], tail[i] = yf[c[0]], yf[c[-1]]
    raw_ends = {}
    # The drawing's overhangs against the factory's: a drawing at odds with them puts
    # the arches off the wheels once the game sets the wheels by the factory figures.
    _ya_f = -F['length'] / 2 + F['frontOverhang']
    _fo, _ro = _ya_f - np.nanmin(nose), np.nanmax(tail) - (_ya_f + F['wheelbase'])
    _ro_f = F['length'] - F['wheelbase'] - F['frontOverhang']
    print(f"OVERHANG {car}: drawn front {_fo:.3f} rear {_ro:.3f}, factory {F['frontOverhang']:.3f} / {_ro_f:.3f}"
          + (' OFF' if max(abs(_fo - F['frontOverhang']), abs(_ro - _ro_f)) > 0.04 else ''))
    if os.environ.get('OVERHANG_ONLY'):
        return
    for end, ext in (('front', nose), ('rear', tail)):
        # A bumper's band is bridged out of the shell only where a bar part replaces it:
        # without one the drawn bumper is the shell's (it had cut AE86's ends short).
        b = hs.get('bumpers', {}).get(end) if end in spec.get('parts', {}).get('bumpers', {}) else None
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
        if hs.get('faceSpacing', 0):
            ext[:] = fair(zf, ext, hs.get('faceSpacing', 0), mask=(zf > 0.05))
        else:
            ext[:] = ndimage.gaussian_filter1d(ext, hs.get('faceSmooth', 0.04) / (G / FINE), mode='nearest')
        if 'face' in hs and end in hs['face']:
            # A face given outright: [[z, y], ...] for the band it spans.
            pts = np.array(hs['face'][end])
            m = (zf >= pts[:, 0].min()) & (zf <= pts[:, 0].max())
            ext[m] = np.interp(zf[m], pts[:, 0], pts[:, 1])
    side &= (yf[None, :] >= nose[:, None] - 1e-6) & (yf[None, :] <= tail[:, None] + 1e-6)
    side &= zf[:, None] >= sm(hs['sill'], yf)[None, :]
    if 'topOverride' in hs:
        # The top over a span given outright (an open tailgate drawn over the roof, a
        # roof rack): clipped above, and filled below down to the sill.
        to = hs['topOverride']
        span = (yf[None, :] >= to[0][0]) & (yf[None, :] <= to[-1][0])
        zt = sm(to, yf)[None, :]
        side &= ~span | (zf[:, None] <= zt)
        side |= span & (zf[:, None] <= zt) & (zf[:, None] >= sm(hs['sill'], yf)[None, :])
    # The top of the outline at every station, made fair, and the outline rebuilt from
    # its fair lines (sill, top, nose, tail): the drawing's own pixels rippled the side.
    top_f = np.array([zf[np.nonzero(side[:, j])[0][-1]] if side[:, j].any() else 0 for j in range(len(yf))])
    if hs.get('topSpacing', 0):
        top_f = fair(yf, top_f, hs.get('topSpacing', 0), mask=top_f > 0.05)
    else:
        top_f = smooth1(top_f, 9, 2.0)
    if hs.get('fairSide', False):
        side = ((zf[:, None] <= top_f[None, :]) & (zf[:, None] >= sm(hs['sill'], yf)[None, :])
                & (yf[None, :] >= nose[:, None] - 1e-6) & (yf[None, :] <= tail[:, None] + 1e-6))
    d_side_f = (ndimage.distance_transform_edt(side) - ndimage.distance_transform_edt(~side)) * (G / FINE)
    d_side = d_side_f[::FINE, ::FINE][:len(zs), :len(ys)]                   # [z, y], metres
    sill = sm(hs['sill'], ys)
    top = top_f[::FINE][:len(ys)]
    # Drip rails, aerials and the like stand above the roof in the drawing.
    if 'roofTop' in hs:
        top = np.minimum(top, hs['roofTop'])

    # ---- plan --------------------------------------------------------------------------
    # No top view: the plan is the factory width, or what planOverride gives.
    plan = smooth1(bp['plan'], 9, 3.0) if 'plan' in bp else np.full(len(ys), W / 2)
    # The top view's outline carries the mirrors, handles and lamp pods too: whatever
    # stands out of it for less than `planOpen` along the car is taken out, or it widens
    # the whole section there and bends the side (a bulge at the screen pillar).
    op = int(round(hs.get('planOpen', 0.30) / G))
    if op > 1 and 'plan' in bp:
        plan = ndimage.grey_opening(plan, size=op, mode='nearest')
    # Away from the ends the plan is a long, slow curve: lines the top view draws
    # along the sides (mouldings, shut lines) only nick it.
    if hs.get('planSpacing', 0):
        plan = fair(ys, plan, hs.get('planSpacing', 0), mask=plan > 0.02)
    else:
        plan = smooth_inner(plan, ys, hs.get('planSmooth', 0.08), 0.18)
    for band in hs.get('planBridge', []):
        plan = fill_band(plan, ys, band)
    # Lamps and mouldings on the flanks stand a few mm proud: the shell stays inside
    # the factory width by that much.
    plan = np.minimum(plan, W / 2 - hs.get('skinInset', 0.008))
    if 'planOverride' in hs:
        m = (ys >= hs['planOverride'][0][0]) & (ys <= hs['planOverride'][-1][0])
        plan[m] = sm(hs['planOverride'], ys[m])

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
        # Whatever stands out of the outline for less than `sectionOpen` of height is
        # not the body's section (mirrors on their arms, lamp pods, handles, drip
        # rails): taken out by an opening, which leaves wider shapes as they are. Left
        # in, a mirror made the glasshouse's reference width and pinched it at the belt.
        op = int(round(hs.get('sectionOpen', 0.25) / G))
        if op > 1:
            s = ndimage.grey_opening(s, size=op, mode='nearest')
        s = smooth1(s, 7, 2.0)
        if hs.get('sectionMono', True):
            # A body's section widens from the sill to its widest point and narrows above
            # it; the drawing's lines across the end views add ripples to that, which
            # ran along the whole car as waves. Held to that shape: non-decreasing up
            # to the widest point, non-increasing above it.
            nz = np.nonzero(s > 0.05)[0]
            if len(nz) > 4:
                k0, k1 = nz[0], nz[-1]
                kmax = k0 + int(np.argmax(s[k0:k1 + 1]))
                s[k0:kmax + 1] = np.maximum.accumulate(s[k0:kmax + 1])
                s[kmax:k1 + 1] = np.minimum.accumulate(s[kmax:k1 + 1])
        if hs.get('sectionSpacing', 0):
            s = fair(zs, s, hs.get('sectionSpacing', 0), mask=s > 0.03)
        else:
            s = smooth_inner(s, zs, hs.get('sectionSmooth', 0.05), hs.get('sectionMargin', 0.12))
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
    # Both end views are the outline of one body seen from either end: they differ only
    # in what is drawn on them. One section for the whole car, their mean, unless the
    # car asks for the old blend from one to the other along the wheelbase (which bent
    # the sides slowly from one shape into the other).
    if hs.get('sectionBlend'):
        sec = secs['front'][:, None] * (1 - t[None, :]) + secs['rear'][:, None] * t[None, :]   # [z, y]
    else:
        sec = np.repeat(((secs['front'] + secs['rear']) / 2)[:, None], len(ys), axis=1)
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
        if len(st) > 2:
            from scipy.interpolate import PchipInterpolator
            interp_st = PchipInterpolator(sy, np.array(prof), axis=0)
        else:
            def interp_st(y, sy=sy, prof=prof):
                f = (y - sy[0]) / max(sy[1] - sy[0], 1e-9)
                return prof[0] * (1 - f) + prof[1] * f
        for j, y in enumerate(ys):
            if y < sy[0] - bl or y > sy[-1] + bl:
                continue
            if y <= sy[0]:
                sec_abs[:, j], w = prof[0], 1 - (sy[0] - y) / bl
            elif y >= sy[-1]:
                sec_abs[:, j], w = prof[-1], 1 - (y - sy[-1]) / bl
            else:
                # between stations on a smooth curve through them, so a station is no
                # fold across the body
                sec_abs[:, j], w = interp_st(y), 1.0
            w_abs[j] = w * w * (3 - 2 * w)

    # ---- the glasshouse -----------------------------------------------------------
    c0, c1 = hs['cabin']
    belt = sm(hs['belt'], ys)
    in_cabin = (ys >= c0) & (ys <= c1)
    # The glasshouse goes on wherever the outline still stands above the belt near the
    # cabin's ends (the screen's foot, the pillars running down to the deck): there the
    # body stops at the belt and the glasshouse's narrower section carries on, so it
    # thins away to nothing as the outline meets the belt. Ended at the cabin's given
    # ends instead, the body went up full width beside the pillar's foot: a step the
    # smoothing crumpled.
    ext = hs.get('cabinRun', 0.35)
    near = (ys >= c0 - ext) & (ys <= c1 + ext)
    in_cabin = in_cabin | (near & (top > belt + 0.005))
    gplan = sm(hs['glassPlan'], ys)
    z_ref = hs.get('beltRef', float(np.median(belt[(ys >= c0) & (ys <= c1)])))
    i_ref = np.searchsorted(zs, z_ref)
    # Below the belt the section is scaled to the plan by its widest point there.
    lower_ref = np.array([sec[: i_ref + 1, j].max() for j in range(len(ys))])
    roof_top = hs.get('roofTop', float(top[(ys >= c0) & (ys <= c1)].max()))
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
    crown = sm(hs.get('crown', [[-9, 0.02], [9, 0.02]]), ys)
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
    # Where the cabin starts and ends the body's top runs on from the deck outside it to
    # the belt over `beltBlend`, not as a step: a belt above the bonnet's last height
    # stood a ridge across the car at the screen's foot (and a dent where it was below).
    cab_idx = np.nonzero(in_cabin)[0]
    lower_tops = np.where(in_cabin, belt, top)
    if len(cab_idx):
        bb = hs.get('beltBlend', 0.20)
        for edge, out in ((cab_idx[0], max(cab_idx[0] - 1, 0)), (cab_idx[-1], min(cab_idx[-1] + 1, len(ys) - 1))):
            zt_out = top[out]
            for j in cab_idx:
                dist_ = abs(ys[j] - ys[edge])
                if dist_ < bb:
                    t_ = dist_ / bb
                    t_ = t_ * t_ * (3 - 2 * t_)
                    # (no deck there, the car's end: a wagon's or a hatch's cabin
                    # running to the tail kept the belt, not a slope down to nothing)
                    deck = belt[j] - 0.3 < zt_out < belt[j] + 0.1
                    lower_tops[j] = zt_out + (belt[j] - zt_out) * t_ if deck else belt[j]
    for j, y in enumerate(ys):
        if d_side[:, j].max() <= -0.05:
            continue
        lower_top = lower_tops[j]
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
                # a station's section speaks only up to its own top: above it the
                # glasshouse keeps its own (it zeroed the roof's slope behind the cabin)
                xg = np.where(sec_abs[:, j] > 0, xg * (1 - w_abs[j]) + sec_abs[:, j] * w_abs[j], xg)
            if hs.get('shelf') is not False:
                # The glasshouse stands an even `shelf` in from the body's side at the
                # belt all along the car, its drawn shape taking over above: a shelf
                # widening as the glass plan narrows was a diagonal fold down the
                # rear quarter.
                ib_ = min(np.searchsorted(zs, belt[j]), len(zs) - 1)
                foot = xl[ib_] - hs.get('shelf', 0.03)
                fade = np.clip(1 - (zs - belt[j]) / hs.get('shelfRise', 0.18), 0, 1)
                fade = fade * fade * (3 - 2 * fade)
                xg = xg + (foot - xg[ib_]) * fade
            drop = np.interp(xs / max(k, 1e-3), xq, roof_drop)
            zg = top[j] - drop
            up = np.minimum(np.minimum(xg[None, :] - xs[:, None], zg[:, None] - zs[None, :]),
                            zs[None, :] - (belt[j] - 0.03))
            # a soft union (a fillet `glassFillet` wide) where the glasshouse meets the
            # body: a hard one pinched into a fold at the pillars' feet and the cowl
            kf = hs.get('glassFillet', 0.03)
            if kf > 0:
                h_ = np.clip(0.5 + 0.5 * (up - d) / kf, 0, 1)
                d = d * (1 - h_) + up * h_ + kf * h_ * (1 - h_)
            else:
                d = np.maximum(d, up)
        dist[:, :, j] = np.minimum(d, d_side[None, :, j])

    # ---- wheel wells ---------------------------------------------------------------
    # Cut after the body is smoothed, not before: blurred together with the body, the
    # well's sharp edge spread into a ring of dent and bulge round every arch.
    wells = np.full_like(dist, -big)
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
        wells = np.maximum(wells, cut)

    # ---- mirror, smooth, contour ----------------------------------------------------
    full = np.concatenate([dist[:0:-1], dist], axis=0)
    xs_full = np.concatenate([-xs[:0:-1], xs])
    pad = 4
    CL = hs.get('fieldClip', 0.15)
    pad = max(pad, int(CL / G) // 3)
    full = np.pad(np.clip(full, -CL, CL), pad, constant_values=-CL)
    # The finest an edge may be: rounder than this the field kept every unevenness of
    # the drawing (streaks on the screens, folds at the pillars' feet) in the reflection.
    sigma = max(hs.get('edge', 0.015), hs.get('edgeMin', 0.022)) / G
    # Along the car the shell is built station by station: a longer blur there evens out
    # the steps between them (a dent where the cabin ends, a ripple from a drawn line).
    sigma_y = max(sigma, max(hs.get('edgeY', 0.06), hs.get('edgeYMin', 0.06)) / G)
    smooth = ndimage.gaussian_filter(full, (sigma, sigma, sigma_y))
    # the wells, mirrored and padded the same way, rounded only by the edge radius
    wf = np.concatenate([wells[:0:-1], wells], axis=0)
    wf = np.pad(np.clip(wf, -CL, CL), pad, constant_values=-CL)
    wf = ndimage.gaussian_filter(wf, hs.get('archEdge', 0.02) / G)
    # The lip where the side meets the well: a rounded intersection (a smooth minimum
    # over `archLip`), not a sharp one, which the 1 cm grid drew as a row of teeth.
    k_ = hs.get('archLip', 0.012)
    a_, b_ = smooth, -wf
    h_ = np.clip(0.5 + 0.5 * (b_ - a_) / k_, 0, 1)
    smooth = b_ * (1 - h_) + a_ * h_ - k_ * h_ * (1 - h_)
    verts, faces, normals, _ = measure.marching_cubes(smooth, 0.0)
    verts = (verts - pad) * G
    verts[:, 0] += xs_full[0]
    verts[:, 1] += zs[0]
    verts[:, 2] += ys[0]
    # grid axes are (x, z, y) -> car (x, y, z)
    v = np.stack([verts[:, 0], verts[:, 2], verts[:, 1]], axis=1)
    # The blur eats into a convex end (a wedge nose, a rounded tail) by several cm: the
    # car came out short of its drawing and the game stretched it, arches and all, to
    # the factory length. Each overhang beyond its arch is brought out to the drawn end;
    # the wheelbase and the arches stay where they are.
    ny = normals[:, 2].copy()          # (grid order x, z, y)
    # Without a bar of its own an end is the car's end: the factory length from the axle
    # (the game sets the wheels by the factory overhang and centres the body on its box),
    # so the arches meet the wheels even where the drawing's overhangs differ.
    bars = spec.get('parts', {}).get('bumpers', {})
    for end, want, ya, ra in (('front', float(np.nanmin(nose)), ya_f, None), ('rear', float(np.nanmax(tail)), ya_r, None)):
        if end not in bars:
            want = -L / 2 if end == 'front' else L / 2
        arch = dict(hs.get('arch', {}), **hs.get('arch', {}).get(end, {}))
        ra = arch.get('radius', R * 1.14)
        sg = -1 if end == 'front' else 1
        pivot = ya + sg * (ra + 0.03)
        have = v[:, 1].min() if end == 'front' else v[:, 1].max()
        if abs(want - have) > 0.005 and (have - pivot) * sg > 0.1:
            k = (want - pivot) / (have - pivot)
            m = (v[:, 1] - pivot) * sg > 0
            v[m, 1] = pivot + (v[m, 1] - pivot) * k
            ny[m] /= k
            print(f'ENDS {car} {end}: {have:.3f} -> {want:.3f} (overhang past the arch x{k:.3f})')
    # The roof likewise: the glasshouse above the belt brought up to the drawn top.
    nz_ = normals[:, 1].copy()
    want_top = float(np.max(top))
    have_top = float(v[:, 2].max())
    zb = float(np.median(belt[(ys >= c0) & (ys <= c1)]))
    if want_top - have_top > 0.005 and have_top - zb > 0.2:
        k = (want_top - zb) / (have_top - zb)
        m = v[:, 2] > zb
        v[m, 2] = zb + (v[m, 2] - zb) * k
        nz_[m] /= k
        print(f'ENDS {car} top: {have_top:.3f} -> {want_top:.3f} (above the belt x{k:.3f})')
    # And the width: the blur and the sections leave the shell a few cm narrower than
    # the factory's; the game fits the body's width by its widest low part (often a
    # bumper's end), so a narrow shell stayed narrow.
    nx_ = normals[:, 0].copy()
    want_w = W / 2 - hs.get('skinInset', 0.008)
    have_w = float(np.abs(v[:, 0]).max())
    if want_w - have_w > 0.003:
        k = want_w / have_w
        v[:, 0] *= k
        nx_ /= k
        print(f'ENDS {car} width: {2 * have_w:.3f} -> {2 * want_w:.3f} (x{k:.3f})')
    normals = np.stack([nx_, nz_, ny], axis=1)
    mesh = trimesh.Trimesh(v, faces[:, [0, 2, 1]], process=False)
    if mesh.volume < 0:
        mesh.invert()
    # The field's own gradient as the normals: smooth (the triangles' normals carry the
    # voxel steps); assemble.py shades the working shell from them.
    n = normals[:, [0, 2, 1]]
    n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)
    if np.mean(np.sum(n * mesh.vertex_normals, axis=1)) < 0:
        n = -n
    out = os.path.join(grid.ROOT, 'build/carshape', car)
    with open(os.path.join(out, 'hull.ply'), 'wb') as fh:
        fh.write(trimesh.exchange.ply.export_ply(trimesh.Trimesh(mesh.vertices, mesh.faces, vertex_normals=n, process=False),
                                                 vertex_normal=True))
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
        # A bar below the body (on brackets under a high sill) takes the end where the
        # body begins above it: at its own height there is no end, or a stray one
        # mid-car (2CV's rear bar stood under the car).
        y_far = mesh.bounds[0][1] if end == 'front' else mesh.bounds[1][1]
        sec = None
        for dz in np.arange(0.0, 0.4, 0.02):
            s_ = mesh.section(plane_origin=[0, 0, zc + dz], plane_normal=[0, 0, 1])
            if s_ is None:
                continue
            ye = s_.vertices[:, 1].min() if end == 'front' else s_.vertices[:, 1].max()
            if abs(ye - y_far) < 0.3:
                sec = s_
                break
        if sec is None:
            continue
        # Every 1 cm along the outline: a flat end gives its section only a few
        # vertices, and the envelope below would sag between them.
        pts = []
        for d in sec.discrete:
            seg = np.linalg.norm(np.diff(d[:, :2], axis=0), axis=1)
            at = np.concatenate([[0], np.cumsum(seg)])
            u = np.arange(0, at[-1] + 1e-9, 0.01)
            pts.append(np.stack([np.interp(u, at, d[:, 0]), np.interp(u, at, d[:, 1])], axis=1))
        pts = np.vstack(pts)
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
        # symmetric about the centre line: a bar is (the sections' samples are not quite)
        a_m = max(-ang.min(), ang.max())
        a_s = np.linspace(-a_m, a_m, 41)
        # Stood off the shell so its face is where the drawing has it (the factory
        # length includes the bumpers), but never closer than 5 mm.
        dpt = b.get('depth', 0.06)
        # The bar's face is the car's end: the factory length includes the bumpers, and
        # the game stretches a body to it (and sets the wheels by the factory overhang),
        # so a bar short of it moved the arches off the wheels. Front face at -L/2 (the
        # front overhang from the front axle), rear face at +L/2.
        L_ = spec['factory']['length']
        target = -L_ / 2 if end == 'front' else L_ / 2
        stand = abs(target - y_end) - dpt
        if b.get('overriders'):
            stand -= 0.015
        lo_ = -dpt / 2 + 0.01
        # (a bar on a frame's horns stands well clear of the body)
        hi_ = b.get('standMax', 0.7 if spec.get('parts', {}).get('underbody', {}).get('frame') else 0.25)
        if stand < lo_ or stand > hi_:
            print('BUMPER-OFF', end, 'shell', round(float(y_end), 3), 'target', round(target, 3), 'stand', round(stand, 3))
        stand = min(max(stand, lo_), hi_)
        print('BUMPER', end, 'shell', round(float(y_end), 3), 'target', round(target, 3), 'stand', round(stand, 3))
        # The bar runs round the convex hull of the end's outline at its height: a bumper
        # is convex in plan, and the outline's recesses (a grille, the lamps' nests)
        # must not dent it.
        from scipy.spatial import ConvexHull
        hp = rel[ConvexHull(rel).vertices] if len(rel) >= 3 else rel
        hp = np.vstack([hp, hp[:1]])
        r_env = np.zeros(41)
        for k, a_ in enumerate(a_s):
            d_ = np.array([np.sin(a_), sgn * np.cos(a_)])
            best = 0.0
            for p0, p1 in zip(hp, hp[1:]):
                e_ = p1 - p0
                den = d_[0] * e_[1] - d_[1] * e_[0]
                if abs(den) < 1e-12:
                    continue
                t_ = (p0[0] * e_[1] - p0[1] * e_[0]) / den
                u_ = (p0[0] * d_[1] - p0[1] * d_[0]) / den
                if t_ > 0 and -1e-9 <= u_ <= 1 + 1e-9:
                    best = max(best, t_)
            r_env[k] = best if best > 0 else np.max(rad)
        # the envelope, then stood off along its own normal in plan (stood off along the
        # rays from the centre, a bar well clear of the shell bowed out in the middle)
        env = np.stack([c[0] + r_env * np.sin(a_s), c[1] + sgn * r_env * np.cos(a_s)], axis=1)
        tng = np.gradient(env, axis=0)
        nrm = np.stack([tng[:, 1], -tng[:, 0]], axis=1)
        nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-9)
        if np.dot(nrm[len(nrm) // 2], [0, sgn]) < 0:
            nrm = -nrm
        path = env + nrm * (stand + dpt / 2)
        # Ends no further back than `wrap` from the bar's own face (a bar standing well
        # clear of the shell kept nothing when measured from the shell's end).
        y_face = path[:, 1].min() if end == 'front' else path[:, 1].max()
        path = path[np.abs(path[:, 1] - y_face) <= wrap + 1e-3]
        if b.get('span'):
            # a straight bar across the frame's horns, `span` wide
            xs_ = np.linspace(-b['span'] / 2 + dpt / 2, b['span'] / 2 - dpt / 2, 25)
            path = np.stack([xs_, np.full(len(xs_), y_face)], axis=1)
        # mirrored onto itself: exactly symmetric
        path = (path + (path[::-1] * [-1, 1])) / 2
        # The wrap ends no wider than the body.
        W = spec['factory']['width']
        path[:, 0] = np.clip(path[:, 0], -(W / 2 - dpt / 2), W / 2 - dpt / 2)
        out[end] = [[round(float(x), 4), round(float(y), 4), round(zc, 4)] for x, y in path]
        # where the bar stands clear of the shell, its brackets reach back to it
        info.setdefault('bumperShell', {})[end] = [round(float(y_end), 4), round(float(sec.vertices[:, 2].mean()), 4)]
    return out


if __name__ == '__main__':
    build(sys.argv[1])
