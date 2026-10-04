# Wartburg 353 (roster 1966; shell 1966-88). Factory: 4220 x 1640 x 1400, wheelbase 2450,
# tracks 1260/1290, 165 SR 13, clearance 155. The side and front of the Wartburg at
# getoutlines.com (the 1.3's drawing, the same body; 4x upscaled, 281 px/m by the
# wheelbase; outline read off by hand). The three-box: a flat bonnet over a black grille
# between rectangular lamps, slab sides with a crisp belt, a broad C pillar with its
# louvre, a long flat boot. The roster year is the pre-facelift car: chrome bumpers with
# the black rubber insert and black end caps, and the one-piece horizontal rear cluster
# (clear inboard, red, amber outboard) of the 1967 photographs; the 1975 353 W's black
# plastic bumpers are not this car.
SEC = [[0.25, 0.77], [0.35, 0.81], [0.80, 0.82], [0.88, 0.81], [0.93, 0.78], [1.05, 0.74], [1.25, 0.69], [1.33, 0.62], [1.37, 0.3]]
CAR = {
    'id': 'wartburg',
    'label': 'Wartburg 353',
    'factory': {'length': 4.22, 'width': 1.64, 'height': 1.4, 'clearance': 0.155, 'wheelbase': 2.45,
                'frontTrack': 1.26, 'rearTrack': 1.29, 'wheelRadius': 0.29, 'tyreWidth': 0.165, 'frontOverhang': 0.79},
    'blueprint': {
        'image': 'wartburg_go.png',
        'dark': 120,
        'side': {'box': [0, 0, 1280, 430], 'nose': 'right', 'wheels': [[297, 338], [985, 338]], 'ground': 420, 'isotropic': True,
                 'outline': [[-2.068, 0.303], [-2.075, 0.491], [-2.014, 0.513], [-2.0, 0.766], [-1.943, 0.833], [-1.373, 0.89], [-0.839, 0.933], [-0.447, 1.335], [-0.394, 1.371], [0.977, 1.36], [1.03, 1.325], [1.315, 0.908], [1.654, 0.862], [2.028, 0.819], [2.081, 0.766], [2.081, 0.47], [2.134, 0.456], [2.134, 0.303], [1.974, 0.256], [1.369, 0.267], [0.763, 0.228], [-0.91, 0.228], [-1.694, 0.267]]},
    },
    'hull': {
        'bumpers': {'front': {'z': [0.29, 0.50]}, 'rear': {'z': [0.29, 0.48]}},
        'sill': [[-2.0, 0.31], [-1.7, 0.27], [-0.9, 0.23], [0.76, 0.23], [1.4, 0.27], [2.1, 0.31]],
        'planOverride': [[-2.04, 0.74], [-1.97, 0.80], [-1.8, 0.81], [1.9, 0.81], [2.06, 0.77]],
        'sectionStations': [{'y': -2.0, 'half': SEC}, {'y': 2.05, 'half': SEC}],
        'topCross': [{'y': -2.0, 'z': [[0.0, 0.84], [0.70, 0.835], [0.81, 0.80]]}, {'y': -0.84, 'z': [[0.0, 0.94], [0.70, 0.93], [0.81, 0.90]]}],
        'cabin': [-0.84, 1.33],
        'belt': [[-0.84, 0.93], [-0.55, 0.91], [0.95, 0.91], [1.33, 0.92]],
        'glassPlan': [[-0.84, 0.70], [-0.4, 0.74], [0.9, 0.74], [1.33, 0.68]],
        'roofCrown': 0.03,
        'edge': 0.010,
        'arch': {'radius': 0.35, 'lift': 0.04},
    },
    'parts': {
        'glass': [
            {'view': 'side', 'outline': [[0.122, 0.915], [-0.554, 0.915], [-0.323, 1.282], [0.122, 1.282]], 'facingMin': 0.3},
            {'view': 'side', 'outline': [[0.941, 0.915], [0.176, 0.915], [0.176, 1.282], [0.71, 1.282]], 'facingMin': 0.3},
            {'view': 'front', 'outline': [[0.0, 1.33], [0.52, 1.32], [0.60, 1.26], [0.65, 0.97], [0.62, 0.94], [0.0, 0.94]],
             'depthRange': [-0.85, -0.35], 'facingMin': 0.2},
            # The back light in plan on the measured slope (y 1.00-1.31, z 1.31-0.93):
            # the rear-view fit pulled its header 4 cm under the roof's edge.
            {'view': 'top', 'outline': [[1.00, 0.0], [1.00, 0.50], [1.04, 0.55], [1.28, 0.63], [1.31, 0.58], [1.31, 0.0]],
             'facingMin': 0.25, 'fit': False},
        ],
        'regions': [
            {'view': 'front', 'rect': [[0.0, 0.40], [1.8, 0.21]], 'radius': 0.001, 'mirror': False, 'depthRange': [-2.2, -1.85]},
            {'view': 'rear', 'rect': [[0.0, 0.38], [1.8, 0.19]], 'radius': 0.001, 'mirror': False, 'depthRange': [1.9, 2.2]},
            {'view': 'side', 'outline': [[-2.2, 0.28], [-2.2, 0.51], [-1.80, 0.51], [-1.70, 0.28]]},
            {'view': 'side', 'outline': [[2.2, 0.28], [2.2, 0.49], [1.85, 0.49], [1.75, 0.28]]},
        ],
        'decals': [
            # Chrome-framed grille with horizontal slats; rectangular lamps in chrome
            # bezels; the indicators on the wing sides just behind the lamps, not in the
            # front face (1966 and 1972 photographs).
            {'view': 'front', 'rect': [[0.0, 0.695], [0.74, 0.155]], 'radius': 0.01, 'mirror': False, 'material': 'chrome',
             'height': 0.004, 'depthRange': [-2.2, -1.85]},
            {'view': 'front', 'rect': [[0.0, 0.695], [0.70, 0.12]], 'radius': 0.01, 'mirror': False, 'material': 'grille',
             'height': 0.006, 'depthRange': [-2.2, -1.85]},
            {'view': 'front', 'rect': [[0.52, 0.695], [0.25, 0.15]], 'radius': 0.012, 'material': 'chrome', 'height': 0.004,
             'depthRange': [-2.2, -1.85]},
            {'view': 'front', 'node': 'headlights', 'rect': [[0.52, 0.695], [0.20, 0.11]], 'radius': 0.01, 'material': 'Headlights',
             'height': 0.008, 'depthRange': [-2.2, -1.85]},
            {'view': 'side', 'node': 'front_blinker_left', 'rect': [[-1.93, 0.675], [0.12, 0.055]], 'radius': 0.008,
             'material': 'IndicatorLights', 'height': 0.008},
            {'view': 'side', 'node': 'front_blinker_right', 'rect': [[-1.93, 0.675], [0.12, 0.055]], 'radius': 0.008,
             'material': 'IndicatorLights', 'height': 0.008},
            {'view': 'front', 'rect': [[0.0, 0.40], [0.52, 0.11]], 'radius': 0.005, 'mirror': False, 'material': 'plate',
             'height': 0.006, 'depthRange': [-2.3, -1.85]},
            # One horizontal cluster on each corner, not a stack: clear reversing lamp
            # inboard, red tail/brake, amber indicator outboard (1967 photographs).
            {'view': 'rear', 'node': 'taillights', 'rect': [[0.555, 0.71], [0.13, 0.10]], 'radius': 0.01, 'material': 'TailLights',
             'height': 0.008, 'depthRange': [1.9, 2.2]},
            {'view': 'rear', 'node': 'rear_blinker_left', 'rect': [[0.665, 0.71], [0.09, 0.10]], 'radius': 0.01,
             'material': 'IndicatorLights', 'height': 0.008, 'depthRange': [1.9, 2.2]},
            {'view': 'rear', 'node': 'rear_blinker_right', 'rect': [[0.665, 0.71], [0.09, 0.10]], 'radius': 0.01,
             'material': 'IndicatorLights', 'height': 0.008, 'depthRange': [1.9, 2.2]},
            {'view': 'rear', 'node': 'reverse_lights', 'rect': [[0.44, 0.71], [0.10, 0.10]], 'radius': 0.01,
             'material': 'ReverseLights', 'height': 0.008, 'depthRange': [1.9, 2.2]},
            {'view': 'rear', 'rect': [[0.0, 0.60], [0.52, 0.11]], 'radius': 0.005, 'mirror': False, 'material': 'plate',
             'height': 0.006, 'depthRange': [1.9, 2.2]},
            # The cabin extractor louvre on the C pillar: its head sits at the side
            # windows' header, not down the door skin (1967 side photograph).
            {'view': 'side', 'outline': [[1.02, 1.13], [1.22, 1.13], [1.12, 1.29], [1.02, 1.30]], 'material': 'grille', 'height': 0.003},
        ],
        'bars': [
            {'view': 'front', 'span': [-0.33, 0.33], 'b': [0.645, 0.745], 'count': 6, 'width': 0.006, 'material': 'chrome',
             'height': 0.008, 'depthRange': [-2.2, -1.85]},
        ],
        'lines': [
            {'view': 'side', 'points': [[-0.84, 0.91], [-0.86, 0.29], [0.15, 0.27], [0.15, 0.91]], 'width': 0.005},
            {'view': 'side', 'points': [[0.15, 0.27], [0.95, 0.28], [0.98, 0.91]], 'width': 0.005},
            {'view': 'side', 'points': [[-1.95, 0.76], [2.05, 0.76]], 'width': 0.008, 'material': 'chrome', 'height': 0.003},
            {'view': 'side', 'points': [[-0.56, 0.91], [-0.33, 1.29], [0.72, 1.29], [0.95, 0.91]], 'width': 0.012, 'material': 'chrome',
             'height': 0.003},
            {'view': 'rear', 'points': [[0.0, 0.84], [0.66, 0.83], [0.68, 0.56], [0.0, 0.55]], 'width': 0.005, 'depthRange': [1.6, 2.2]},
        ],
        'bumpers': {
            # 1966-75: chrome bars with a rubber insert and black upright overriders.
            'front': {'z': [0.30, 0.49], 'depth': 0.08, 'wrap': 0.30, 'profile': 'blade', 'material': 'chrome',
                      'rubber': 0.030, 'overriders': [[0.38, 0.05, 0.27, 0.52]], 'overriderMaterial': 'rubber'},
            'rear': {'z': [0.30, 0.47], 'depth': 0.08, 'wrap': 0.30, 'profile': 'blade', 'material': 'chrome',
                     'rubber': 0.030, 'overriders': [[0.38, 0.05, 0.27, 0.50]], 'overriderMaterial': 'rubber'},
        },
        'mirror': {'y': -0.58, 'z': 0.96, 'reach': 0.90, 'w': 0.12, 'h': 0.08},
        'handles': {'at': [[0.03, 0.85], [0.85, 0.85]], 'w': 0.12},
        'wipers': {'arms': [[-0.55, -0.05, -0.86, 0.96], [0.05, 0.55, -0.86, 0.96]]},
        'wheel': {'style': 'hubcap', 'rimFactor': 0.64, 'cap': 0.6},
    },
}

import os as _os, sys as _sys  # noqa: E402
_sys.path.insert(0, _os.path.dirname(__file__))
from _frame import scale_above  # noqa: E402
# The drawing (the 1.3's, the same shell) tops out at 1.371 m; the roster's 353 is 1.400.
scale_above(CAR, 0.93, 1.371, 1.400)
