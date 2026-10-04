# AMC Eagle wagon (1980-87). Factory: 4740 x 1830 x 1405, wheelbase 2776, tracks 1500/1460,
# P195/75 R15, clearance 190. The three views of the 1980 Eagle wagon at getoutlines.com
# (228 px/m by the wheelbase; the side read off by hand, the roof under its rack). The
# first crossover: a Concord wagon lifted on four-wheel drive, a long flat bonnet over a
# grid grille between pairs of square lamps, a big 5-mph bumper, a long roof to a sloping
# tailgate, a full-width band of tail lamps, black plastic flares and cladding.
ARCH_F = [[-2.03, 0.36], [-2.014, 0.484], [-1.966, 0.6], [-1.889, 0.699], [-1.79, 0.776], [-1.674, 0.824], [-1.55, 0.84], [-1.426, 0.824], [-1.31, 0.776], [-1.211, 0.699], [-1.134, 0.6], [-1.086, 0.484], [-1.07, 0.36]]
ARCH_R = [[0.746, 0.36], [0.762, 0.484], [0.81, 0.6], [0.887, 0.699], [0.986, 0.776], [1.102, 0.824], [1.226, 0.84], [1.35, 0.824], [1.466, 0.776], [1.565, 0.699], [1.642, 0.6], [1.69, 0.484], [1.706, 0.36]]
CAR = {
    'id': 'eagle',
    'label': 'AMC Eagle',
    # Wikipedia (all years): 4729 x 1836 x 1387 (wagon), wheelbase 2776; ultimatespecs: tracks
    # 1514/1463, clearance 175, 195/75 R14. The drawing's overhangs (0.922 / 1.031) add up
    # to exactly length less wheelbase.
    'factory': {'length': 4.729, 'width': 1.836, 'height': 1.387, 'clearance': 0.175, 'wheelbase': 2.776,
                'frontTrack': 1.514, 'rearTrack': 1.463, 'wheelRadius': 0.324, 'tyreWidth': 0.195, 'frontOverhang': 0.922},
    'blueprint': {
        'image': 'eagle_go.png',
        'dark': 120,
        'side': {'box': [0, 0, 1097, 365], 'nose': 'right', 'wheels': [[243, 280], [875, 280]], 'ground': 358, 'isotropic': True,
                 # The tailgate leans ~37 deg from the lamps to the roof's end, 0.5 m of
                 # run (photo side_rear_wagon: 100 px/m along, 115 px/m up); drawn
                 # upright it made a van's box.
                 # The bonnet runs from the lamps' top (0.90) to the cowl just over the belt
                 # (1.03; photos: the bonnet meets the screen a hand above the door's top,
                 # it stood 17 cm over it, a tall flat slab).
                 'outline': [[2.258, 0.52], [2.258, 0.694], [2.161, 0.716], [2.17, 1.001], [2.06, 1.18], [1.92, 1.38], [1.84, 1.44], [1.76, 1.458], [-0.167, 1.46], [-0.364, 1.45], [-0.452, 1.41], [-0.957, 1.03], [-2.24, 0.90], [-2.30, 0.89], [-2.315, 0.86], [-2.315, 0.82], [-2.319, 0.694], [-2.472, 0.672], [-2.472, 0.518], [-2.30, 0.52], [-2.25, 0.44], [-1.835, 0.40], [-1.089, 0.275], [0.8, 0.245], [1.59, 0.28], [1.85, 0.33], [2.12, 0.44], [2.17, 0.52]]},
        'front': {'box': [30, 372, 540, 751], 'ppm': 251, 'centre': 280, 'zRef': [[380, 1.405], [745, 0.0]],
                  'drop': [[0, 90, 60, 140], [450, 90, 510, 140]],
                  'outline': [[0.0, 1.46], [0.66, 1.457], [0.725, 1.447], [0.755, 1.42], [0.83, 1.06], [0.87, 1.02], [0.90, 0.98], [0.912, 0.90], [0.912, 0.60], [0.90, 0.48], [0.86, 0.40], [0.82, 0.0], [0.0, 0.0]],},
        'rear': {'box': [590, 360, 1090, 751], 'ppm': 251, 'centre': 840, 'zRef': [[372, 1.405], [745, 0.0]],
                 'outline': [[0.0, 1.46], [0.66, 1.457], [0.725, 1.447], [0.755, 1.42], [0.83, 1.06], [0.87, 1.02], [0.90, 0.98], [0.912, 0.90], [0.912, 0.60], [0.90, 0.48], [0.86, 0.40], [0.82, 0.0], [0.0, 0.0]],},
    },
    'hull': {
        'bumpers': {'front': {'z': [0.50, 0.71]}, 'rear': {'z': [0.50, 0.71]}},
        # The body's lower edge (photo side_rear_wagon and the drawing's own rocker line,
        # read again: the outline had been taken at the cladding's crease, 0.15 m too
        # high, so the body stopped halfway down the car's own cladding).
        'sill': [[-2.4, 0.44], [-1.9, 0.40], [-1.1, 0.28], [0.8, 0.25], [1.6, 0.29], [2.2, 0.44]],
        'planOverride': [[-2.33, 0.82], [-2.25, 0.88], [-2.0, 0.905], [2.0, 0.905], [2.15, 0.90], [2.18, 0.89]],
        'sectionBridge': {'front': [[1.0, 1.25]]},
        'cabin': [-0.96, 2.17],
        # The belt (photo side_rear_wagon, scaled by the wheelbase): the side glass's
        # foot sits at 0.95-0.96, a hand's width over the door handles - the drawing's
        # 1.02/1.10 was its roof band read as the belt. The windows are 0.34 m tall, not
        # 0.30, and the glasshouse no longer reads as a van's slots under a high belt.
        'belt': [[-0.96, 1.02], [-0.8, 0.96], [1.2, 0.955], [1.8, 0.96], [2.17, 0.975]],
        'glassPlan': [[-0.96, 0.82], [-0.5, 0.875], [1.6, 0.875], [2.17, 0.865]],
        'shelf': 0.012,
        'crown': [[-2.4, 0.006], [2.4, 0.006]],
        'edgeMin': 0.015,
        'edgeYMin': 0.035,
        'edgeY': 0.035,
        'roofCrown': 0.012,
        'roofHalf': 0.75,
        'edge': 0.010,
        'arch': {'radius': 0.37, 'lift': 0.04},
    },
    'parts': {
        # The black plastic arch flares (photos: a band round each opening standing a
        # hand's width proud of the body), and the openings themselves: the photo's lip
        # sits 6 cm over the tyre, not the 15 cm the drawing's deep wells gave.
        'archFlares': [{'axle': 'both', 'r': 0.375, 'w': 0.09, 't': 0.03, 'lift': 0.04}],
        # Panes in the model's own frame (the belt at 0.955, the head at 1.30), measured
        # off side_rear_wagon: a vent pane ahead of the front door's glass, the B-pillar
        # a hand's width wide and just behind the front door's handle, the C-pillar as
        # wide again, and a quarter window running back to the D-pillar at 2.05.
        'glass': [
            # The door's main pane starts at the vent divider (a vertical chrome strip)
            # and its front corner runs up along the A-pillar's rake above it.
            {'view': 'side', 'outline': [[0.13, 0.955], [-0.52, 0.955], [-0.52, 1.18], [-0.30, 1.345], [0.13, 1.345]], 'facingMin': 0.3},
            {'view': 'side', 'outline': [[-0.52, 0.955], [-0.78, 0.955], [-0.64, 1.18], [-0.52, 1.18]], 'facingMin': 0.3},
            {'view': 'side', 'outline': [[0.80, 0.955], [0.24, 0.955], [0.24, 1.345], [0.78, 1.345]], 'facingMin': 0.3},
            # The quarter window runs back to the rear corner (photos: the D-pillar is a
            # thin wrap, not the 30 cm panel the first read of the side left).
            {'view': 'side', 'outline': [[2.02, 0.96], [0.99, 0.955], [0.97, 1.345], [1.74, 1.345], [1.86, 1.22]], 'facingMin': 0.3},
            {'view': 'front', 'outline': [[0.0, 1.345], [0.60, 1.33], [0.68, 1.26], [0.74, 1.06], [0.70, 1.04], [0.0, 1.04]],
             'depthRange': [-1.2, -0.4], 'facingMin': 0.2},
            # The back light: the wagon's tailgate window, wide at its foot and nearly the
            # tailgate's width at its top (photo rear_wagon: 0.59-0.70 of the body).
            {'view': 'rear', 'outline': [[0.0, 1.31], [0.56, 1.305], [0.62, 1.27], [0.66, 1.03], [0.62, 0.98], [0.0, 0.98]],
             'depthRange': [1.6, 2.3], 'facingMin': 0.15},
        ],
        'regions': [
            # The Eagle's black plastic: the flares (parts.archFlares), a cladding band
            # from the sill up to 0.53 (photos of the wagons: a tall black rocker with a
            # chrome strip over it, not the sliver the drawing showed), and the valances
            # under both bumpers.
            {'view': 'side', 'outline': [[-2.5, 0.24], [-2.5, 0.50], [2.3, 0.50], [2.3, 0.24]]},
            {'view': 'front', 'rect': [[0.0, 0.53], [1.9, 0.20]], 'radius': 0.001, 'mirror': False, 'depthRange': [-2.6, -2.2]},
            {'view': 'rear', 'rect': [[0.0, 0.53], [1.9, 0.20]], 'radius': 0.001, 'mirror': False, 'depthRange': [2.0, 2.4]},
        ],
        'decals': [
            # The Eagle's face (photos, 1982 wagon): one chrome-framed panel across the
            # nose; two rectangular lamps each side, side by side; an egg-crate grille
            # between; an amber parking lamp strip under each pair of lamps.
            {'view': 'front', 'rect': [[0.0, 0.775], [1.64, 0.24]], 'radius': 0.012, 'mirror': False, 'material': 'chrome',
             'height': 0.002, 'depthRange': [-2.6, -2.2]},
            {'view': 'front', 'rect': [[0.0, 0.775], [1.58, 0.21]], 'radius': 0.008, 'mirror': False, 'material': 'trim',
             'height': 0.003, 'depthRange': [-2.6, -2.2]},
            {'view': 'front', 'rect': [[0.0, 0.752], [0.62, 0.15]], 'radius': 0.006, 'mirror': False, 'material': 'grille',
             'height': 0.005, 'depthRange': [-2.6, -2.2]},
            {'view': 'front', 'node': 'headlights', 'rect': [[0.425, 0.775], [0.16, 0.10]], 'radius': 0.008, 'material': 'Headlights',
             'height': 0.008, 'depthRange': [-2.6, -2.2]},
            {'view': 'front', 'node': 'headlights', 'rect': [[0.61, 0.775], [0.16, 0.10]], 'radius': 0.008, 'material': 'Headlights',
             'height': 0.008, 'depthRange': [-2.6, -2.2], 'facingMin': 0.0},
            {'view': 'front', 'node': 'front_blinker_left', 'rect': [[0.52, 0.695], [0.36, 0.035]], 'radius': 0.004,
             'material': 'IndicatorLights', 'height': 0.009, 'depthRange': [-2.6, -2.2], 'facingMin': 0.0},
            {'view': 'front', 'node': 'front_blinker_right', 'rect': [[0.52, 0.695], [0.36, 0.035]], 'radius': 0.004,
             'material': 'IndicatorLights', 'height': 0.009, 'depthRange': [-2.6, -2.2], 'facingMin': 0.0},
            {'view': 'front', 'rect': [[0.0, 0.53], [0.52, 0.11]], 'radius': 0.005, 'mirror': False, 'material': 'plate',
             'height': 0.006, 'depthRange': [-2.7, -2.2]},
            {'view': 'side', 'rect': [[-2.20, 0.85], [0.14, 0.04]], 'radius': 0.01, 'material': 'IndicatorLights', 'height': 0.004},
            # The full-width band of tail lamps (photos of the 1983 wagon): a chrome
            # framed unit high on the tailgate's lower panel, red lamps outboard, the
            # amber turn lamp between them and the clear reversing lamp inboard, the
            # plate in the middle of it.
            {'view': 'rear', 'rect': [[0.0, 0.84], [1.76, 0.17]], 'radius': 0.012, 'mirror': False, 'material': 'chrome',
             'height': 0.004, 'depthRange': [2.0, 2.4], 'facingMin': 0.05},
            {'view': 'rear', 'node': 'taillights', 'rect': [[0.795, 0.84], [0.21, 0.13]], 'radius': 0.008, 'material': 'TailLights',
             'height': 0.008, 'depthRange': [2.0, 2.4], 'facingMin': 0.05},
            {'view': 'rear', 'node': 'rear_blinker_left', 'rect': [[0.6085, 0.84], [0.163, 0.13]], 'radius': 0.006,
             'material': 'IndicatorLights', 'height': 0.008, 'depthRange': [2.0, 2.4], 'facingMin': 0.05},
            {'view': 'rear', 'node': 'rear_blinker_right', 'rect': [[0.6085, 0.84], [0.163, 0.13]], 'radius': 0.006,
             'material': 'IndicatorLights', 'height': 0.008, 'depthRange': [2.0, 2.4], 'facingMin': 0.05},
            {'view': 'rear', 'node': 'taillights', 'rect': [[0.4365, 0.84], [0.181, 0.13]], 'radius': 0.008, 'material': 'TailLights',
             'height': 0.008, 'depthRange': [2.0, 2.4], 'facingMin': 0.05},
            {'view': 'rear', 'node': 'reverse_lights', 'rect': [[0.276, 0.84], [0.14, 0.13]], 'radius': 0.006,
             'material': 'ReverseLights', 'height': 0.008, 'depthRange': [2.0, 2.4], 'facingMin': 0.05},
            {'view': 'rear', 'rect': [[0.0, 0.84], [0.32, 0.145]], 'radius': 0.005, 'mirror': False, 'material': 'plate',
             'height': 0.010, 'depthRange': [2.0, 2.4], 'facingMin': 0.05},
        ],
        'bars': [
            # the egg crate: bars across and up
            {'view': 'front', 'span': [-0.31, 0.31], 'b': [0.68, 0.83], 'count': 3, 'width': 0.010, 'material': 'chrome',
             'height': 0.008, 'depthRange': [-2.6, -2.2]},
            {'view': 'front', 'span': [-0.31, 0.31], 'b': [0.68, 0.83], 'count': 7, 'dir': 'v', 'width': 0.010,
             'material': 'chrome', 'height': 0.008, 'depthRange': [-2.6, -2.2]},
        ],
        'lines': [
            {'view': 'side', 'points': [[-0.96, 0.955], [-1.0, 0.26], [0.13, 0.25], [0.13, 0.955]], 'width': 0.005},
            {'view': 'side', 'points': [[0.13, 0.25], [0.82, 0.24], [0.85, 0.955]], 'width': 0.005},
            {'view': 'side', 'points': [[-2.30, 0.94], [2.15, 0.94]], 'width': 0.006, 'material': 'chrome', 'height': 0.003},
            # the moulding along the cladding's top (the photo's bright line at 0.50)
            {'view': 'side', 'points': [[-2.30, 0.50], [2.15, 0.495]], 'width': 0.006, 'material': 'chrome', 'height': 0.003},
            {'view': 'side', 'points': [[-0.93, 0.955], [-0.60, 1.345], [0.97, 1.345], [2.18, 0.955]], 'width': 0.012, 'material': 'chrome',
             'height': 0.003},
        ],
        'boxes': [{'c': [0.58, 0.55, 1.43], 'size': [0.04, 1.8, 0.03], 'material': 'chrome'}],
        'bumpers': {
            'front': {'z': [0.46, 0.66], 'depth': 0.09, 'wrap': 0.30, 'profile': 'blade', 'rubber': 0.06,
                      'overriders': [[0.40, 0.07, 0.44, 0.68]]},
            'rear': {'z': [0.46, 0.66], 'depth': 0.09, 'wrap': 0.30, 'profile': 'blade', 'rubber': 0.06, 'standOff': -0.01},
        },
        # On the door at the front corner of its window, just over the belt (photos); it
        # had been left at 0.90 when the belt came down, half-way down the door.
        'mirror': {'y': -0.66, 'z': 1.02, 'reach': 0.99, 'w': 0.13, 'h': 0.09, 'material': 'chrome'},
        'handles': {'at': [[-0.03, 0.80], [0.72, 0.80]], 'w': 0.13},
        'wipers': {'arms': [[-0.6, -0.05, -0.98, 1.15], [0.05, 0.6, -0.98, 1.15]]},
        'wheel': {'style': 'alloy', 'spokes': 10, 'rimFactor': 0.66, 'spokeWidth': 0.35},
    },
}


# The blueprint outlines were drawn to a 1.46 m roof. The wagon stands 1.387 m overall
# and its roof rack (parts.boxes) is built 3 cm over the roof skin by assemble.py, so
# the drawn roof is brought to 1.355: body + rack = the factory height (dims.py reads
# the complete body box, and render/carmodel.ts fits that box to factory.height).
def _lower(z, top=1.46, to=1.355, belt=1.10):
    return z if z <= belt else belt + (z - belt) * (to - belt) / (top - belt)


def _pts(pts, k=1):
    return [[p[0], _lower(p[1])] if k == 1 else p for p in pts]


_bp = CAR['blueprint']
_bp['side']['outline'] = _pts(_bp['side']['outline'])
for _e in ('front', 'rear'):
    _bp[_e]['outline'] = _pts(_bp[_e]['outline'])
for _b in CAR['parts']['boxes']:
    _b['c'][2] = _lower(_b['c'][2])

# The front overhang was 0.82 (the axle 10.75 cm further back than the drawing's):
# the drawing moved with the axle.
import os as _os, sys as _sys  # noqa: E402
_sys.path.insert(0, _os.path.dirname(__file__))
from _frame import shift_along  # noqa: E402
shift_along(CAR, 0.1075)
