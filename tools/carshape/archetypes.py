"""Expands a short car description into the full carbody.py spec.

    python3 tools/carshape/archetypes.py <car.py> <out.json>

A car description is a Python file defining CAR = {...}: the factory dimensions, a few
heights and stations read off the car's photo sheets (tools/carshape/photosheet.py),
and its lamps and wheels. This file turns them into the character lines, panels and
glass regions the VAZ-2101 was authored with, so every saloon, hatchback and estate is
built by the same rules:

  deck      the top of the bonnet and boot (or the tail), [[y, z]], nose to tail
  belt      the window sill height inside the cabin
  cabin     ws0 windscreen base, ws1 roof front, rw0 roof rear, rw1 rear glass base
            (a hatchback's rw1 is at the tail; an estate's rear glass is near vertical)
  roof      height of the centre, and of the rail at the roof's edge
  widths    half-widths of the body (waist), shoulder, deck edge, glass base, roof rail
  windows   side window outlines [[y, z], ...] in the side view
  screens   the windscreen / rear-glass top edge height (the side windows' top)

The bonnet, roof and boot share one crown, and the panels into the centreline arrive
level, which is what keeps them free of ridges and valleys.
"""
import json
import runpy
import sys

car = runpy.run_path(sys.argv[1])['CAR']
F = car['factory']
L = F['length']
y0, y1 = -L / 2 + car.get('trimEnds', 0.016), L / 2 - car.get('trimEnds', 0.016)
if 'yRange' in car:
    # Bumpers that stand well off one end (the Renault 4's tail) make the body's own
    # extent asymmetric about the factory length.
    y0, y1 = car['yRange']

deck = car['deck']
ws0, ws1, rw0, rw1 = car['cabin']
roof_top, roof_rail = car['roof']
belt = car['belt']
wid = car['widths']
crown = car.get('crown', 0.02)
half = wid['waist']


def lift(x):
    return crown * (1 - (x / half) ** 2)


def deck_at(y):
    ys = [p[0] for p in deck]
    zs = [p[1] for p in deck]
    if y <= ys[0]:
        return zs[0]
    for (a, za), (b, zb) in zip(deck, deck[1:]):
        if a <= y <= b:
            return za + (zb - za) * (y - a) / (b - a)
    return zs[-1]


kind = car.get('kind', 'saloon')
rail_x = wid['railDeck']
outside = [p for p in deck if p[0] <= ws0 or p[0] >= rw1]
top = [[y, round(z + crown, 4)] for y, z in outside]
rail = [[y, round(z + lift(rail_x), 4)] for y, z in outside]
# The windscreen rises from the deck at ws0 to the roof at ws1; the roof runs to rw0;
# the rear glass falls to the deck (or the tail) at rw1. Interior points ease the
# corners the way a pressed panel turns.
mid_ws = (ws0 + ws1) / 2
mid_rw = (rw0 + rw1) / 2
z_ws0 = deck_at(ws0)
z_rw1 = deck_at(rw1)
top += [[mid_ws, round(z_ws0 + (roof_top - z_ws0) * 0.55, 4)], [ws1 + 0.02, roof_top - 0.025],
        [ws1 + 0.14, roof_top], [rw0 - 0.1, roof_top], [rw0 + 0.02, roof_top - 0.022],
        [mid_rw, round(z_rw1 + (roof_top - z_rw1) * 0.5, 4)]]
rail += [[mid_ws, round(z_ws0 + (roof_rail - z_ws0) * 0.5, 4)], [ws1, roof_rail], [rw0, roof_rail],
         [mid_rw, round(z_rw1 + (roof_rail - z_rw1) * 0.48, 4)]]
if kind in ('hatchback', 'estate'):
    # The tail is the rear glass's own base: nothing follows it.
    top = [p for p in top if p[0] <= rw1]
    rail = [p for p in rail if p[0] <= rw1]
    top.append([y1, round(deck[-1][1] + crown, 4)])
    rail.append([y1, round(deck[-1][1] + lift(rail_x), 4)])
top.sort()
rail.sort()
# A car whose roof is not flat (a dome, a fastback) gives its own centre and rail lines
# over the cabin; the deck outside the cabin still comes from `deck`.
if 'topLine' in car:
    top = [p for p in top if p[0] < ws0 or p[0] > rw1] + [list(p) for p in car['topLine']]
    top.sort()
if 'railLine' in car:
    rail = [p for p in rail if p[0] < ws0 or p[0] > rw1] + [list(p) for p in car['railLine']]
    rail.sort()

glass_base_plan = [[y0, wid['glassDeck']], [ws0, wid['glassDeck']], [ws1, wid['glass']], [rw0, wid['glass']],
                   [rw1, wid['glassDeck']], [y1, wid['glassDeck']]]
rail_plan = [[y0, rail_x], [ws0 - 0.2, rail_x], [ws0 + 0.02, wid['railPillar']], [ws1, wid['rail']],
             [rw0, wid['rail']], [rw1, wid['railPillar']], [rw1 + 0.2, rail_x], [y1, rail_x]]
if kind in ('hatchback', 'estate'):
    rail_plan = [p for p in rail_plan if p[0] <= rw1] + [[y1, wid['railPillar']]]
    glass_base_plan = [p for p in glass_base_plan if p[0] <= rw1] + [[y1, wid['glass']]]

sill = car['sill']          # [[y, z]]
floor = car['floor']        # [[y, z]]
lines = {
    'floorCentre': {'side': floor},
    'sill': {'plan': [[y0, wid['sill']], [y1, wid['sill']]], 'side': sill},
    'waist': {'plan': [[y0, half], [y1, half]], 'side': [[y0, car['waistZ']], [y1, car['waistZ']]]},
    'shoulder': {'plan': [[y0, wid['shoulder']], [y1, wid['shoulder']]],
                 'side': [[y, round(z - car.get('shoulderDrop', 0.08), 4)] for y, z in deck]},
    'deckEdge': {'plan': [[y0, wid['deckEdge']], [y1, wid['deckEdge']]],
                 'side': [[y, round(z - car.get('edgeDrop', 0.02), 4)] for y, z in deck]},
    'glassBase': {'plan': glass_base_plan, 'side': [[y, round(z + lift(wid['glass']), 4)] for y, z in deck]},
    'rail': {'plan': rail_plan, 'side': rail},
    'topCentre': {'side': top},
}
screen_top = car['screenTop']
glass = [{'panel': 'glassBase-rail', 'outline': w} for w in car['windows']]
glass.append({'panel': 'rail-topCentre', 'y': [ws0 + 0.01, ws1 - 0.01], 'x': car.get('screenHalf', wid['rail'] - 0.05), 'zMax': screen_top})
rear_y = [rw0 + 0.02, rw1 - 0.01] if kind == 'saloon' else [rw0 + 0.02, y1 - car.get('hatchLip', 0.08)]
if car.get('rearScreen', True):
    glass.append({'panel': 'rail-topCentre', 'y': rear_y, 'x': car.get('rearScreenHalf', wid['rail'] - 0.08), 'zMax': screen_top})

extra = [ws0, ws1, rw0, rw1] + [p[0] for w in car['windows'] for p in w]
R = F['wheelRadius']
for axle in (-L / 2 + F['frontOverhang'], -L / 2 + F['frontOverhang'] + F['wheelbase']):
    extra += [round(axle - R * 1.13, 4), round(axle + R * 1.13, 4)]
spec = {
    'id': car['id'],
    'label': car['label'],
    'factory': F,
    'photos': car.get('photos', {}),
    'body': {
        'yRange': [y0, y1],
        'stations': car.get('stations', 56),
        'extraStations': sorted(set(round(v, 4) for v in extra)),
        'planFactor': car['planFactor'],
        'ring': ['floorCentre', 'sill', 'waist', 'shoulder', 'deckEdge', 'glassBase', 'rail', 'topCentre'],
        'panels': [{'n': 1, 'bulge': 0}, {'n': 2, 'bulge': car.get('tumbleunder', 0.06)}, {'n': 1, 'bulge': 0.02},
                   {'n': 1, 'bulge': car.get('shoulderRound', 0.25)}, {'n': 0}, {'n': 2, 'bulge': 0.02}, {'n': 3, 'bulge': car.get('roofCrown', 0.05)}],
        'lines': lines,
        'glass': glass,
        'arch': car.get('arch', {'radiusFactor': 1.13, 'lift': 0.02, 'wellDepth': 0.3}),
        'smoothAngleDeg': car.get('smoothAngleDeg', 32),
    },
    'parts': car['parts'],
}
json.dump(spec, open(sys.argv[2], 'w'), indent=1, ensure_ascii=False)
print('ARCH', car['id'], kind)
