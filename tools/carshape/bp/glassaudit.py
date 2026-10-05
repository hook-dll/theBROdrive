"""Audits the glass of installed bodies: what ships, not what the car file asks for.

    build/pyenv/bin/python tools/carshape/bp/glassaudit.py [car ...]   (default: all)

Per pane (a connected piece of the `glass` node): its sharp turns along the edge
(notches; a clean pane has only its corners), folds inside it (neighbouring faces more
than 25 degrees apart: glass run onto a fillet or round a corner), slivers (pieces
under 30 cm2) and the gap to the nearest other pane on the same side (under 1 cm the
pillar between them is gone). One line per car, worst first, and a JSON next to it.
"""
import glob
import json
import os
import sys

import numpy as np
import trimesh

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))


def glass_mesh(path):
    s = trimesh.load(path)
    parts = []
    for n in s.graph.nodes_geometry:
        T, g = s.graph[n]
        if g.startswith('glass'):
            m = s.geometry[g].copy()
            m.apply_transform(T)
            parts.append(m)
    if not parts:
        return None
    m = trimesh.util.concatenate(parts)
    m.merge_vertices(digits_vertex=5)
    v = m.vertices
    m.vertices = np.stack([v[:, 0], -v[:, 2], v[:, 1]], 1)   # car frame: x across, y back, z up
    return m


def audit(car):
    m = glass_mesh(os.path.join(ROOT, 'public/models/carshape', car + '.glb'))
    if m is None:
        return {'car': car, 'error': 'no glass'}
    comps = m.split(only_watertight=False)
    # Laid-over glass ships with its backing 2 mm under it: one pane, not two.
    comps = sorted(comps, key=lambda c: -c.area)
    kept = []
    for c in comps:
        probe = c.vertices[::max(1, len(c.vertices) // 40)]
        if c.area > 0.003 and any(0.0005 < np.median(trimesh.proximity.closest_point(k, probe)[1]) < 0.006 for k in kept):
            continue
        kept.append(c)
    panes = []
    for c in kept:
        area = c.area
        # folds: neighbouring faces more than 25 degrees apart, both of real size (the
        # cuts leave needle triangles whose normals mean nothing)
        fa = c.area_faces
        big_pair = (fa[c.face_adjacency[:, 0]] > 2e-4) & (fa[c.face_adjacency[:, 1]] > 2e-4)
        folds = int(np.sum((np.degrees(c.face_adjacency_angles) > 25) & big_pair))
        # notches: sharp turns along the outline
        notches = 0
        for ent in c.outline().entities:
            pts = c.vertices[ent.points]
            if len(pts) < 5:
                continue
            seg = np.diff(pts, axis=0)
            ln = np.linalg.norm(seg, axis=1)
            keep = ln > 1e-4
            seg = seg[keep] / ln[keep][:, None]
            cosang = np.sum(seg[:-1] * seg[1:], axis=1)
            notches += int(np.sum(cosang < np.cos(np.radians(40))))
        cen = c.vertices.mean(0)
        panes.append({'area_cm2': round(area * 1e4, 1), 'centre': np.round(cen, 3).tolist(),
                      'folds': folds, 'turns': notches, 'mesh': c})
    for p in panes:
        others = [q for q in panes if q is not p and (abs(q['centre'][0]) < 0.05 or abs(p['centre'][0]) < 0.05
                                                      or np.sign(q['centre'][0]) == np.sign(p['centre'][0]))]
        if not others:
            p['gap'] = None
            continue
        a = p['mesh'].outline().vertices
        best = 9.0
        for q in others:
            b = q['mesh'].outline().vertices
            if len(a) and len(b):
                d = np.linalg.norm(a[::3, None, :] - b[None, ::3, :], axis=2).min()
                best = min(best, d)
        p['gap'] = round(float(best), 3)
    for p in panes:
        del p['mesh']
    slivers = [p for p in panes if p['area_cm2'] < 30]
    big = [p for p in panes if p['area_cm2'] >= 30]
    score = (sum(p['folds'] for p in big) + 3 * sum(max(0, p['turns'] - 6) for p in big)
             + 20 * len(slivers) + 30 * sum(1 for p in big if p['gap'] is not None and p['gap'] < 0.01))
    return {'car': car, 'score': score, 'panes': len(big), 'slivers': len(slivers),
            'folds': sum(p['folds'] for p in big), 'excess_turns': sum(max(0, p['turns'] - 6) for p in big),
            'closed_pillars': sum(1 for p in big if p['gap'] is not None and p['gap'] < 0.01), 'detail': panes}


if __name__ == '__main__':
    cars = sys.argv[1:] or sorted(os.path.basename(f)[:-3] for f in glob.glob(os.path.join(ROOT, 'tools/carshape/bp/cars/*.py'))
                                  if not os.path.basename(f).startswith('_'))
    res = [audit(c) for c in cars]
    res.sort(key=lambda r: -r.get('score', 1e9))
    for r in res:
        if 'error' in r:
            print(f"{r['car']:14s} {r['error']}")
            continue
        print(f"{r['car']:14s} score {r['score']:5d}  panes {r['panes']:2d}  slivers {r['slivers']:2d}  folds {r['folds']:4d}  "
              f"notches {r['excess_turns']:4d}  closed pillars {r['closed_pillars']}")
    out = os.path.join(ROOT, 'build/carshape/glassaudit.json')
    json.dump(res, open(out, 'w'), indent=1)
    print('->', out)
