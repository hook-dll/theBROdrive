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
                 'outline': [[2.258, 0.52], [2.258, 0.694], [2.161, 0.716], [2.17, 1.001], [2.165, 1.37], [2.14, 1.425], [2.08, 1.45], [-0.167, 1.46], [-0.364, 1.45], [-0.452, 1.41], [-0.957, 1.133], [-2.24, 0.99], [-2.30, 0.98], [-2.315, 0.95], [-2.315, 0.848], [-2.319, 0.694], [-2.472, 0.672], [-2.472, 0.518], [-2.30, 0.52], [-2.25, 0.45], [-1.835, 0.452], [-1.089, 0.422], [0.8, 0.395], [1.59, 0.452], [1.941, 0.487], [2.12, 0.48], [2.17, 0.52]]},
        'front': {'box': [30, 372, 540, 751], 'ppm': 251, 'centre': 280, 'zRef': [[380, 1.405], [745, 0.0]],
                  'drop': [[0, 90, 60, 140], [450, 90, 510, 140]],
                  'outline': [[0.0, 1.46], [0.66, 1.457], [0.725, 1.447], [0.755, 1.42], [0.83, 1.06], [0.87, 1.02], [0.90, 0.98], [0.912, 0.90], [0.912, 0.60], [0.90, 0.48], [0.86, 0.40], [0.82, 0.0], [0.0, 0.0]],},
        'rear': {'box': [590, 360, 1090, 751], 'ppm': 251, 'centre': 840, 'zRef': [[372, 1.405], [745, 0.0]],
                 'outline': [[0.0, 1.46], [0.66, 1.457], [0.725, 1.447], [0.755, 1.42], [0.83, 1.06], [0.87, 1.02], [0.90, 0.98], [0.912, 0.90], [0.912, 0.60], [0.90, 0.48], [0.86, 0.40], [0.82, 0.0], [0.0, 0.0]],},
    },
    'hull': {
        'bumpers': {'front': {'z': [0.50, 0.71]}, 'rear': {'z': [0.50, 0.71]}},
        'sill': [[-2.4, 0.46], [-1.8, 0.45], [-1.1, 0.42], [0.8, 0.40], [1.6, 0.45], [2.2, 0.50]],
        'planOverride': [[-2.33, 0.82], [-2.25, 0.88], [-2.0, 0.905], [2.0, 0.905], [2.15, 0.90], [2.18, 0.89]],
        'sectionBridge': {'front': [[1.0, 1.25]]},
        'cabin': [-0.96, 2.17],
        'belt': [[-0.96, 1.10], [-0.8, 1.02], [1.2, 1.01], [1.8, 1.02], [2.17, 1.02]],
        'glassPlan': [[-0.96, 0.82], [-0.5, 0.875], [1.6, 0.875], [2.17, 0.865]],
        'shelf': 0.012,
        'crown': [[-2.4, 0.006], [2.4, 0.006]],
        'edgeMin': 0.015,
        'edgeYMin': 0.035,
        'edgeY': 0.035,
        'roofCrown': 0.012,
        'roofHalf': 0.75,
        'edge': 0.010,
        'arch': {'radius': 0.44, 'lift': 0.04},
    },
    'parts': {
        'archFlares': [{'axle': 'both', 'r': 0.445, 'w': 0.07, 't': 0.025, 'lift': 0.04}],
        'glass': [
            {'view': 'side', 'outline': [[0.80, 1.02], [0.141, 1.02], [0.141, 1.40], [0.646, 1.40]], 'facingMin': 0.3},
            {'view': 'side', 'outline': [[0.075, 1.02], [-0.76, 1.03], [-0.42, 1.40], [0.075, 1.40]], 'facingMin': 0.3},
            {'view': 'side', 'outline': [[1.86, 1.03], [0.844, 1.02], [0.80, 1.38], [1.80, 1.38], [1.86, 1.33]], 'facingMin': 0.3},
            {'view': 'front', 'outline': [[0.0, 1.38], [0.60, 1.36], [0.68, 1.28], [0.74, 1.12], [0.70, 1.10], [0.0, 1.10]],
             'depthRange': [-1.2, -0.4], 'facingMin': 0.2},
            {'view': 'rear', 'outline': [[0.0, 1.38], [0.56, 1.375], [0.60, 1.35], [0.62, 1.03], [0.58, 0.99], [0.0, 0.99]],
             'depthRange': [1.6, 2.3], 'facingMin': 0.15},
        ],
        'regions': [
            # Black flares, cladding and bumper faces.
            {'view': 'side', 'outline': [[-2.5, 0.38], [-2.5, 0.50], [2.3, 0.50], [2.3, 0.38]]},
            {'view': 'front', 'rect': [[0.0, 0.53], [1.9, 0.18]], 'radius': 0.001, 'mirror': False, 'depthRange': [-2.6, -2.2]},
            {'view': 'rear', 'rect': [[0.0, 0.53], [1.9, 0.18]], 'radius': 0.001, 'mirror': False, 'depthRange': [2.0, 2.4]},
        ],
        'decals': [
            # The Eagle's face (photos, 1982 wagon): one chrome-framed panel across the
            # nose; two rectangular lamps each side, side by side; an egg-crate grille
            # between; an amber parking lamp strip under each pair of lamps.
            {'view': 'front', 'rect': [[0.0, 0.79], [1.64, 0.27]], 'radius': 0.012, 'mirror': False, 'material': 'chrome',
             'height': 0.002, 'depthRange': [-2.6, -2.2]},
            {'view': 'front', 'rect': [[0.0, 0.785], [1.58, 0.23]], 'radius': 0.008, 'mirror': False, 'material': 'trim',
             'height': 0.003, 'depthRange': [-2.6, -2.2]},
            {'view': 'front', 'rect': [[0.0, 0.765], [0.62, 0.16]], 'radius': 0.006, 'mirror': False, 'material': 'grille',
             'height': 0.005, 'depthRange': [-2.6, -2.2]},
            {'view': 'front', 'node': 'headlights', 'rect': [[0.425, 0.79], [0.16, 0.10]], 'radius': 0.008, 'material': 'Headlights',
             'height': 0.008, 'depthRange': [-2.6, -2.2]},
            {'view': 'front', 'node': 'headlights', 'rect': [[0.61, 0.79], [0.16, 0.10]], 'radius': 0.008, 'material': 'Headlights',
             'height': 0.008, 'depthRange': [-2.6, -2.2], 'facingMin': 0.0},
            {'view': 'front', 'node': 'front_blinker_left', 'rect': [[0.52, 0.708], [0.36, 0.035]], 'radius': 0.004,
             'material': 'IndicatorLights', 'height': 0.009, 'depthRange': [-2.6, -2.2], 'facingMin': 0.0},
            {'view': 'front', 'node': 'front_blinker_right', 'rect': [[0.52, 0.708], [0.36, 0.035]], 'radius': 0.004,
             'material': 'IndicatorLights', 'height': 0.009, 'depthRange': [-2.6, -2.2], 'facingMin': 0.0},
            {'view': 'front', 'rect': [[0.0, 0.53], [0.52, 0.11]], 'radius': 0.005, 'mirror': False, 'material': 'plate',
             'height': 0.006, 'depthRange': [-2.7, -2.2]},
            {'view': 'side', 'rect': [[-2.20, 0.85], [0.14, 0.04]], 'radius': 0.01, 'material': 'IndicatorLights', 'height': 0.004},
            # The full-width band of tail lamps, the plate in its middle.
            {'view': 'rear', 'rect': [[0.0, 0.73], [1.70, 0.20]], 'radius': 0.01, 'mirror': False, 'material': 'trim',
             'height': 0.004, 'depthRange': [2.0, 2.4], 'facingMin': 0.05},
            {'view': 'rear', 'node': 'taillights', 'rect': [[0.62, 0.75], [0.44, 0.10]], 'radius': 0.008, 'material': 'TailLights',
             'height': 0.008, 'depthRange': [2.0, 2.4], 'facingMin': 0.05},
            {'view': 'rear', 'node': 'rear_blinker_left', 'rect': [[0.72, 0.67], [0.24, 0.045]], 'radius': 0.006,
             'material': 'IndicatorLights', 'height': 0.008, 'depthRange': [2.0, 2.4], 'facingMin': 0.05},
            {'view': 'rear', 'node': 'rear_blinker_right', 'rect': [[0.72, 0.67], [0.24, 0.045]], 'radius': 0.006,
             'material': 'IndicatorLights', 'height': 0.008, 'depthRange': [2.0, 2.4], 'facingMin': 0.05},
            {'view': 'rear', 'node': 'reverse_lights', 'rect': [[0.46, 0.67], [0.16, 0.045]], 'radius': 0.006,
             'material': 'ReverseLights', 'height': 0.008, 'depthRange': [2.0, 2.4], 'facingMin': 0.05},
            {'view': 'rear', 'rect': [[0.0, 0.73], [0.36, 0.13]], 'radius': 0.005, 'mirror': False, 'material': 'plate',
             'height': 0.008, 'depthRange': [2.0, 2.4], 'facingMin': 0.05},
        ],
        'bars': [
            # the egg crate: bars across and up
            {'view': 'front', 'span': [-0.31, 0.31], 'b': [0.69, 0.84], 'count': 3, 'width': 0.010, 'material': 'chrome',
             'height': 0.008, 'depthRange': [-2.6, -2.2]},
            {'view': 'front', 'span': [-0.31, 0.31], 'b': [0.69, 0.84], 'count': 7, 'dir': 'v', 'width': 0.010,
             'material': 'chrome', 'height': 0.008, 'depthRange': [-2.6, -2.2]},
        ],
        'lines': [
            {'view': 'side', 'points': [[-0.96, 1.01], [-1.0, 0.47], [0.11, 0.45], [0.11, 1.01]], 'width': 0.005},
            {'view': 'side', 'points': [[0.11, 0.45], [0.82, 0.44], [0.85, 1.01]], 'width': 0.005},
            {'view': 'side', 'points': [[-2.30, 0.90], [2.15, 0.90]], 'width': 0.006, 'material': 'chrome', 'height': 0.003},
            {'view': 'side', 'points': [[-0.80, 1.02], [-0.42, 1.41], [0.66, 1.41], [0.80, 1.02]], 'width': 0.012, 'material': 'chrome',
             'height': 0.003},
        ],
        'boxes': [{'c': [0.58, 0.55, 1.43], 'size': [0.04, 1.8, 0.03], 'material': 'chrome'}],
        'bumpers': {
            'front': {'z': [0.46, 0.66], 'depth': 0.09, 'wrap': 0.30, 'profile': 'blade', 'rubber': 0.06,
                      'overriders': [[0.40, 0.07, 0.44, 0.68]]},
            'rear': {'z': [0.46, 0.66], 'depth': 0.09, 'wrap': 0.30, 'profile': 'blade', 'rubber': 0.06, 'standOff': -0.01},
        },
        'mirror': {'y': -0.74, 'z': 1.07, 'reach': 0.99, 'w': 0.13, 'h': 0.09, 'material': 'chrome'},
        'handles': {'at': [[-0.05, 0.93], [0.75, 0.93]], 'w': 0.13},
        'wipers': {'arms': [[-0.6, -0.05, -0.98, 1.15], [0.05, 0.6, -0.98, 1.15]]},
        'wheel': {'style': 'alloy', 'spokes': 10, 'rimFactor': 0.66, 'spokeWidth': 0.35},
    },
}


# The outlines above were drawn to a 1.46 m roof; the wagon stands 1.387 m: everything
# above the belt (1.10) is brought down in proportion.
def _lower(z, top=1.46, to=1.387, belt=1.10):
    return z if z <= belt else belt + (z - belt) * (to - belt) / (top - belt)


def _pts(pts, k=1):
    return [[p[0], _lower(p[1])] if k == 1 else p for p in pts]


_bp = CAR['blueprint']
_bp['side']['outline'] = _pts(_bp['side']['outline'])
for _e in ('front', 'rear'):
    _bp[_e]['outline'] = _pts(_bp[_e]['outline'])
for _g in CAR['parts']['glass']:
    _g['outline'] = _pts(_g['outline'])
for _l in CAR['parts']['lines']:
    _l['points'] = _pts(_l['points'])
for _b in CAR['parts']['boxes']:
    _b['c'][2] = _lower(_b['c'][2])

# The front overhang was 0.82 (the axle 10.75 cm further back than the drawing's):
# the drawing moved with the axle.
import os as _os, sys as _sys  # noqa: E402
_sys.path.insert(0, _os.path.dirname(__file__))
from _frame import shift_along  # noqa: E402
shift_along(CAR, 0.1075)
