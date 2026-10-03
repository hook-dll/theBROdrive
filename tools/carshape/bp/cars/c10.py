# Chevrolet C10 Fleetside long bed (1967-72). Factory: 5330 x 1999 x 1770, wheelbase 3226
# (127 in), tracks 1626/1600, G78-15, clearance 200. The three views of the 1968 C-10 at
# getoutlines.com (143 px/m by the 127 in wheelbase; the side read off by hand round the
# cargo drawn in the bed). The big plain pickup: a long flat bonnet over a full-width
# grille with the lamps in square bezels at its ends and the bowtie, a crisp waist
# crease along cab and bed, a tall cab with a wraparound screen, the long open bed with
# the tail lamps upright in its corners, chrome bumpers.
BOX = [[0.36, 0.95], [0.45, 0.995], [1.12, 0.995], [1.20, 0.96], [1.55, 0.90], [1.66, 0.84], [1.71, 0.6], [1.73, 0.2]]
CAR = {
    'id': 'c10',
    'label': 'Chevrolet C10',
    'factory': {'length': 5.33, 'width': 1.999, 'height': 1.77, 'clearance': 0.2, 'wheelbase': 3.226,
                'frontTrack': 1.626, 'rearTrack': 1.6, 'wheelRadius': 0.36, 'tyreWidth': 0.2, 'frontOverhang': 0.835},
    'blueprint': {
        'image': 'c10_go.png',
        'dark': 120,
        'side': {'box': [360, 0, 1135, 262], 'nose': 'left', 'wheels': [[485, 205], [945, 205]], 'ground': 256, 'isotropic': True,
                 'outline': [[-2.665, 0.449], [-2.665, 0.589], [-2.615, 0.617], [-2.615, 0.954], [-2.524, 1.122], [-2.286, 1.15], [-1.164, 1.248], [-0.848, 1.669], [-0.799, 1.711], [-0.077, 1.711], [-0.007, 1.669], [-0.007, 1.129], [2.553, 1.129], [2.581, 1.108], [2.581, 0.568], [2.665, 0.554], [2.665, 0.449], [2.483, 0.414], [1.361, 0.372], [-1.094, 0.344], [-2.216, 0.414]]},
        'front': {'box': [5, 5, 300, 262], 'ppm': 140, 'centre': 148, 'zRef': [[10, 1.75], [256, 0.0]]},
        'rear': {'box': [1135, 5, 1429, 262], 'ppm': 140, 'centre': 1280, 'zRef': [[10, 1.75], [256, 0.0]]},
    },
    'hull': {
        'bumpers': {'front': {'z': [0.42, 0.62]}, 'rear': {'z': [0.42, 0.58]}},
        'sill': [[-2.66, 0.46], [-2.2, 0.42], [-1.1, 0.36], [1.4, 0.38], [2.6, 0.43]],
        'planOverride': [[-2.62, 0.92], [-2.55, 0.99], [2.60, 0.99], [2.65, 0.96]],
        'sectionStations': [{'y': -2.55, 'half': BOX}, {'y': 2.60, 'half': BOX}],
        # The open bed: its floor; the walls stand on it as parts.
        'topOverride': [[0.03, 0.82], [2.62, 0.82]],
        'topCross': [
            {'y': -2.62, 'z': [[0.0, 1.10], [0.85, 1.09], [0.99, 1.05]]},
            {'y': -1.16, 'z': [[0.0, 1.25], [0.85, 1.23], [0.99, 1.18]]},
        ],
        'cabin': [-1.16, 0.0],
        'belt': [[-1.16, 1.24], [0.0, 1.20]],
        'glassPlan': [[-1.16, 0.84], [0.0, 0.86]],
        'roofHalf': 0.80,
        'roofCrown': 0.04,
        'edge': 0.012,
        'arch': {'radius': 0.47, 'lift': 0.04},
    },
    'parts': {
        'underbody': {'frame': True},
        'glass': [
            {'view': 'side', 'outline': [[-0.80, 1.21], [-0.13, 1.21], [-0.13, 1.62], [-0.71, 1.62]], 'facingMin': 0.3},
            {'view': 'front', 'outline': [[0.0, 1.63], [0.70, 1.62], [0.78, 1.55], [0.84, 1.26], [0.80, 1.24], [0.0, 1.24]],
             'depthRange': [-1.3, -0.5], 'facingMin': 0.1},
            {'view': 'rear', 'outline': [[0.0, 1.60], [0.62, 1.59], [0.66, 1.52], [0.66, 1.33], [0.62, 1.30], [0.0, 1.30]],
             'depthRange': [-0.2, 0.2], 'facingMin': 0.3, 'fit': False},
        ],
        'regions': [
            {'view': 'top', 'outline': [[0.08, 0.0], [0.08, 0.93], [2.57, 0.93], [2.57, 0.0]], 'material': 'trim', 'facingMin': 0.7},
        ],
        'decals': [
            {'view': 'front', 'rect': [[0.0, 0.76], [1.40, 0.27]], 'radius': 0.02, 'mirror': False, 'material': 'chrome',
             'height': 0.004, 'depthRange': [-2.8, -2.4]},
            {'view': 'front', 'rect': [[0.0, 0.76], [1.32, 0.21]], 'radius': 0.02, 'mirror': False, 'material': 'grille',
             'height': 0.006, 'depthRange': [-2.8, -2.4]},
            {'view': 'front', 'rect': [[0.77, 0.77], [0.25, 0.25]], 'radius': 0.03, 'material': 'chrome', 'height': 0.006,
             'depthRange': [-2.8, -2.4], 'facingMin': 0.0},
            {'view': 'front', 'node': 'headlights', 'circle': [[0.77, 0.77], 0.09], 'material': 'Headlights', 'height': 0.010,
             'depthRange': [-2.8, -2.4], 'facingMin': 0.0},
            {'view': 'front', 'outline': [[-0.10, 0.79], [-0.04, 0.79], [-0.04, 0.80], [0.04, 0.80], [0.04, 0.79], [0.10, 0.79],
                                          [0.10, 0.75], [0.04, 0.75], [0.04, 0.74], [-0.04, 0.74], [-0.04, 0.75], [-0.10, 0.75]],
             'mirror': False, 'material': 'chrome', 'height': 0.010, 'depthRange': [-2.8, -2.4]},
            {'view': 'front', 'node': 'front_blinker_left', 'rect': [[0.62, 0.56], [0.14, 0.04]], 'radius': 0.01,
             'material': 'IndicatorLights', 'height': 0.008, 'depthRange': [-2.8, -2.4]},
            {'view': 'front', 'node': 'front_blinker_right', 'rect': [[0.62, 0.56], [0.14, 0.04]], 'radius': 0.01,
             'material': 'IndicatorLights', 'height': 0.008, 'depthRange': [-2.8, -2.4]},
            {'view': 'side', 'rect': [[-2.40, 0.80], [0.12, 0.05]], 'radius': 0.01, 'material': 'IndicatorLights', 'height': 0.004},
            {'view': 'side', 'rect': [[2.48, 0.80], [0.12, 0.05]], 'radius': 0.01, 'material': 'TailLights', 'height': 0.004},
            {'view': 'rear', 'node': 'taillights', 'rect': [[0.91, 0.84], [0.10, 0.18]], 'radius': 0.01, 'material': 'TailLights',
             'height': 0.010, 'depthRange': [2.5, 2.8], 'facingMin': 0.05},
            {'view': 'rear', 'node': 'rear_blinker_left', 'rect': [[0.91, 0.72], [0.10, 0.06]], 'radius': 0.01,
             'material': 'IndicatorLights', 'height': 0.010, 'depthRange': [2.5, 2.8], 'facingMin': 0.05},
            {'view': 'rear', 'node': 'rear_blinker_right', 'rect': [[0.91, 0.72], [0.10, 0.06]], 'radius': 0.01,
             'material': 'IndicatorLights', 'height': 0.010, 'depthRange': [2.5, 2.8], 'facingMin': 0.05},
            {'view': 'rear', 'node': 'reverse_lights', 'rect': [[0.91, 0.65], [0.10, 0.05]], 'radius': 0.01,
             'material': 'ReverseLights', 'height': 0.010, 'depthRange': [2.5, 2.8], 'facingMin': 0.05},
            {'view': 'rear', 'rect': [[0.0, 0.66], [0.34, 0.12]], 'radius': 0.005, 'mirror': False, 'material': 'plate',
             'height': 0.006, 'depthRange': [2.5, 2.8], 'facingMin': 0.05},
        ],
        'bars': [
            {'view': 'front', 'span': [-0.62, 0.62], 'b': [0.70, 0.82], 'count': 2, 'width': 0.016, 'material': 'chrome',
             'height': 0.009, 'depthRange': [-2.8, -2.4]},
        ],
        'lines': [
            # The waist crease along cab and bed.
            {'view': 'side', 'points': [[-2.55, 0.96], [2.60, 0.96]], 'width': 0.012, 'material': 'paint', 'height': 0.008},
            {'view': 'side', 'points': [[-1.13, 1.20], [-1.13, 0.42], [-0.06, 0.42], [-0.06, 1.66]], 'width': 0.006},
            {'view': 'side', 'points': [[-2.50, 1.13], [-1.16, 1.24]], 'width': 0.005},
            {'view': 'rear', 'points': [[0.0, 1.10], [0.86, 1.10], [0.86, 0.62], [0.0, 0.62]], 'width': 0.006, 'depthRange': [2.5, 2.8],
             'facingMin': 0.05},
        ],
        'boxes': [
            {'c': [0.965, 1.33, 0.975], 'size': [0.05, 2.58, 0.31], 'material': 'paint'},
            {'c': [0.0, 2.625, 0.975], 'size': [1.98, 0.05, 0.31], 'mirror': False, 'material': 'paint'},
            {'c': [0.0, 0.055, 0.975], 'size': [1.98, 0.06, 0.31], 'mirror': False, 'material': 'paint'},
        ],
        'bumpers': {
            'front': {'z': [0.44, 0.58], 'depth': 0.07, 'wrap': 0.25, 'profile': 'blade', 'standOff': -0.03},
            'rear': {'z': [0.44, 0.56], 'depth': 0.07, 'wrap': 0.10, 'profile': 'blade', 'standOff': -0.03},
        },
        'mirror': {'y': -1.0, 'z': 1.35, 'reach': 1.12, 'w': 0.12, 'h': 0.16, 'material': 'chrome'},
        'handles': {'at': [[-0.25, 1.10]], 'w': 0.14},
        'wipers': {'arms': [[-0.7, -0.1, -1.18, 1.27], [0.05, 0.65, -1.18, 1.27]]},
        'wheel': {'style': 'hubcap', 'rimFactor': 0.62, 'cap': 0.60},
    },
}

# The drawing's cab stands 1.712 m; the C10 is 1.77 (the K10 71 in): the cab above the
# belt raised.
import os as _os, sys as _sys  # noqa: E402
_sys.path.insert(0, _os.path.dirname(__file__))
from _frame import scale_above  # noqa: E402
scale_above(CAR, 1.20, 1.712, 1.77)
