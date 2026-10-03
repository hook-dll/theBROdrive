"""Moving a car file's drawing along the car: when the factory front overhang is
corrected, the front axle moves (it stands at -length/2 + frontOverhang) and the wheel
arches with it, but outlines given in metres stay put. shift_along(CAR, dy) moves
everything a car file places along the car by dy, so the body moves with its axles."""


def _side(pts, dy):
    return [[p[0] + dy] + list(p[1:]) for p in pts]


def _patch(d, dy, view):
    if view == 'side':
        if 'outline' in d:
            d['outline'] = _side(d['outline'], dy)
        if 'points' in d:
            d['points'] = _side(d['points'], dy)
        if 'rect' in d:
            d['rect'] = [[d['rect'][0][0] + dy, d['rect'][0][1]], d['rect'][1]]
        if 'circle' in d:
            d['circle'] = [[d['circle'][0][0] + dy, d['circle'][0][1]], d['circle'][1]]
        if 'span' in d:
            d['span'] = [d['span'][0] + dy, d['span'][1] + dy]
    elif view in ('front', 'rear') and d.get('depthRange'):
        d['depthRange'] = [d['depthRange'][0] + dy, d['depthRange'][1] + dy]
    elif view == 'top':
        if 'outline' in d:
            d['outline'] = _side(d['outline'], dy)
        if 'rect' in d:
            d['rect'] = [[d['rect'][0][0] + dy, d['rect'][0][1]], d['rect'][1]]


def shift_along(CAR, dy):
    bp = CAR['blueprint']
    if 'outline' in bp.get('side', {}):
        bp['side']['outline'] = _side(bp['side']['outline'], dy)
    if 'outline' in bp.get('top', {}):
        bp['top']['outline'] = _side(bp['top']['outline'], dy)
    h = CAR['hull']
    for k in ('sill', 'belt', 'glassPlan', 'crown', 'planOverride', 'topOverride'):
        if k in h:
            h[k] = _side(h[k], dy)
    if 'cabin' in h:
        h['cabin'] = [h['cabin'][0] + dy, h['cabin'][1] + dy]
    for k in h.get('sectionKeys', []):
        k['y'] = [k['y'][0] + dy, k['y'][1] + dy]
    for tc in h.get('topCross', []):
        tc['y'] += dy
    P = CAR['parts']
    for key in ('glass', 'decals', 'lines', 'regions', 'bars'):
        for d in P.get(key, []):
            _patch(d, dy, d['view'])
    if 'mirror' in P:
        P['mirror']['y'] += dy
    if 'handles' in P:
        P['handles']['at'] = [[y + dy, z] for y, z in P['handles']['at']]
    if 'wipers' in P:
        P['wipers']['arms'] = [[a[0], a[1], a[2] + dy] + list(a[3:]) for a in P['wipers']['arms']]
    for b in P.get('boxes', []):
        b['c'][1] += dy
    for pl in P.get('podLamps', []):
        if 'y' in pl:
            pl['y'] += dy


def set_overhang(CAR, fo):
    """The factory front overhang changed to `fo`: the front axle moves by the change and
    everything the file places along the car moves with it (a drawing's own outline
    moves by itself: it is placed by its wheels)."""
    shift_along(CAR, fo - CAR['factory']['frontOverhang'])
    CAR['factory']['frontOverhang'] = fo


def scale_above(CAR, belt, top_from, top_to):
    """A drawing whose top stands at `top_from` for a car `top_to` tall: every height
    above `belt` is brought to it in proportion (outlines, panes, regions, decals,
    lines, roof boxes, wipers, mirror, handles, lamp pods, bumpers; the hull's belt,
    sill, top overrides and cross-sections, bumper bands). `belt` 0 scales the whole
    drawing (one drawn too low throughout: Hilux)."""
    k = (top_to - belt) / (top_from - belt)

    def z(v):
        return v if v <= belt else belt + (v - belt) * k

    def pts(p):
        return [[a, z(b)] + list(rest) for a, b, *rest in p]

    def patch(d):
        if d.get('view') == 'top':
            return
        if 'outline' in d:
            d['outline'] = pts(d['outline'])
        if 'points' in d:
            d['points'] = pts(d['points'])
        if 'rect' in d:
            (a, b), (w, h) = d['rect']
            lo, hi = z(b - h / 2), z(b + h / 2)
            d['rect'] = [[a, (lo + hi) / 2], [w, hi - lo]]
        if 'circle' in d:
            d['circle'] = [[d['circle'][0][0], z(d['circle'][0][1])], d['circle'][1]]

    bp = CAR['blueprint']
    for v in ('side', 'front', 'rear'):
        if 'outline' in bp.get(v, {}):
            bp[v]['outline'] = pts(bp[v]['outline'])
    P = CAR['parts']
    for key in ('glass', 'decals', 'lines', 'regions', 'bars'):
        for d in P.get(key, []):
            patch(d)
            if key == 'bars' and d.get('view') != 'top':
                d['b'] = [z(d['b'][0]), z(d['b'][1])]
    for b in P.get('boxes', []):
        b['c'][2] = z(b['c'][2])
    h = CAR['hull']
    for key in ('sectionStations', 'sectionKeys'):
        for st in h.get(key, []):
            st['half'] = [[z(a), x] + list(r) for a, x, *r in st['half']]
    for key in ('belt', 'sill', 'topOverride'):
        if key in h:
            h[key] = pts(h[key])
    for tc in h.get('topCross', []):
        tc['z'] = pts(tc['z'])
    if 'roofTop' in h:
        h['roofTop'] = z(h['roofTop'])
    for bands in (h.get('bumpers', {}), P.get('bumpers', {})):
        for b in bands.values():
            b['z'] = [z(b['z'][0]), z(b['z'][1])]
            if 'overriders' in b:
                b['overriders'] = [[o[0], o[1], z(o[2]), z(o[3])] + list(o[4:]) for o in b['overriders']]
    for pl in P.get('podLamps', []):
        pl['z'] = z(pl['z'])
    if 'handles' in P:
        P['handles']['at'] = pts(P['handles']['at'])
    if 'wipers' in P:
        P['wipers']['arms'] = [list(a[:3]) + [z(a[3])] + list(a[4:]) for a in P['wipers']['arms']]
    if 'mirror' in P:
        P['mirror']['z'] = z(P['mirror']['z'])
    CAR['factory']['height'] = top_to
