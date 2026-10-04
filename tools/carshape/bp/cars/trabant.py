# Trabant 601 (1964-90). Factory: 3555 x 1504 x 1437, wheelbase 2020, tracks 1206/1255,
# 145 SR 13, clearance 150. The three views of the 1985 601 at getoutlines.com (4x
# upscaled, 275 px/m by the wheelbase). The little Duroplast saloon: a short flat bonnet
# with the round lamps in its corners over a wide shallow grille, a thin-pillared
# glasshouse, a squared boot with its small fins, thin bumpers with black overriders.
CAR = {
    'id': 'trabant',
    'label': 'Trabant 601',
    'factory': {'length': 3.555, 'width': 1.504, 'height': 1.437, 'clearance': 0.15, 'wheelbase': 2.02,
                'frontTrack': 1.206, 'rearTrack': 1.255, 'wheelRadius': 0.28, 'tyreWidth': 0.145, 'frontOverhang': 0.6},
    'blueprint': {
        'image': 'trabant_go.png',
        'dark': 140,
        'side': {'box': [455, 0, 1450, 410], 'nose': 'left', 'wheels': [[632, 323], [1187, 323]], 'ground': 400, 'isotropic': True},
        'front': {'box': [0, 0, 440, 410], 'ppm': 268, 'centre': 220, 'zRef': [[12, 1.437], [400, 0.0]]},
        'rear': {'box': [1465, 0, 1912, 410], 'ppm': 266, 'centre': 1687, 'zRef': [[14, 1.437], [400, 0.0]]},
    },
    'hull': {
        'bumpers': {'front': {'z': [0.27, 0.40]}, 'rear': {'z': [0.27, 0.39]}},
        'sill': [[-1.78, 0.30], [-1.4, 0.26], [-1.0, 0.22], [0.6, 0.22], [1.0, 0.25], [1.78, 0.28]],
        'sectionBridge': {'both': [[0.95, 1.32]]},
        'planOverride': [[-1.80, 0.69], [-1.74, 0.735], [-1.62, 0.75], [1.58, 0.745], [1.72, 0.70], [1.80, 0.62]],
        # The roof strip above the drip rail leaks out of the drawn outline: its top given.
        'topOverride': [[-0.73, 1.05], [-0.6, 1.25], [-0.45, 1.355], [-0.3, 1.39], [0.3, 1.40], [0.6, 1.39], [0.85, 1.36], [1.0, 1.16]],
        'cabin': [-0.72, 1.00],
        'belt': [[-0.72, 0.93], [-0.5, 0.89], [0.85, 0.89], [1.0, 0.93]],
        'glassPlan': [[-0.72, 0.58], [-0.4, 0.63], [0.7, 0.63], [1.0, 0.57]],
        'crown': [[-1.9, 0.03], [1.9, 0.03]],
        'roofCrown': 0.05,
        'edge': 0.016,
        'arch': {'radius': 0.33, 'lift': 0.03},
    },
    'parts': {
        'glass': [
            {'view': 'side', 'outline': [[-0.62, 0.90], [0.14, 0.90], [0.14, 1.22], [-0.42, 1.23]], 'facingMin': 0.3},
            {'view': 'side', 'outline': [[0.22, 0.90], [0.90, 0.90], [0.80, 1.22], [0.22, 1.22]], 'facingMin': 0.3},
            {'view': 'front', 'outline': [[0.0, 1.31], [0.45, 1.30], [0.52, 1.24], [0.54, 1.02], [0.50, 0.99], [0.0, 0.99]],
             'depthRange': [-1.0, -0.3], 'facingMin': 0.2},
            {'view': 'rear', 'outline': [[0.0, 1.26], [0.45, 1.25], [0.52, 1.20], [0.53, 0.95], [0.50, 0.92], [0.0, 0.92]],
             'depthRange': [0.7, 1.4], 'facingMin': 0.15},
        ],
        'podLamps': [{'node': 'headlights', 'x': 0.585, 'z': 0.725, 'r': 0.085, 'end': 'front', 'bezel': 0.018, 'podDepth': 0.06,
                      'proud': 0.01}],
        'decals': [
            {'view': 'front', 'rect': [[0.0, 0.565], [0.95, 0.25]], 'radius': 0.05, 'mirror': False, 'material': 'chrome',
             'height': 0.003, 'depthRange': [-1.9, -1.5]},
            {'view': 'front', 'rect': [[0.0, 0.555], [0.86, 0.17]], 'radius': 0.04, 'mirror': False, 'material': 'grille',
             'height': 0.005, 'depthRange': [-1.9, -1.5]},
            {'view': 'front', 'node': 'front_blinker_left', 'rect': [[0.585, 0.505], [0.10, 0.035]], 'radius': 0.01,
             'material': 'IndicatorLights', 'height': 0.010, 'depthRange': [-1.9, -1.4]},
            {'view': 'front', 'node': 'front_blinker_right', 'rect': [[0.585, 0.505], [0.10, 0.035]], 'radius': 0.01,
             'material': 'IndicatorLights', 'height': 0.010, 'depthRange': [-1.9, -1.4]},
            {'view': 'front', 'circle': [[0.0, 0.76], 0.04], 'mirror': False, 'material': 'chrome', 'height': 0.008,
             'depthRange': [-1.9, -1.4]},
            # Tall lamp clusters on the rear fins: indicator over red over reversing lamp.
            {'view': 'rear', 'node': 'taillights', 'rect': [[0.675, 0.62], [0.08, 0.20]], 'radius': 0.03, 'material': 'TailLights',
             'height': 0.010, 'depthRange': [1.4, 1.9], 'facingMin': 0.05},
            {'view': 'rear', 'node': 'rear_blinker_left', 'rect': [[0.675, 0.77], [0.08, 0.10]], 'radius': 0.03,
             'material': 'IndicatorLights', 'height': 0.010, 'depthRange': [1.4, 1.9], 'facingMin': 0.05},
            {'view': 'rear', 'node': 'rear_blinker_right', 'rect': [[0.675, 0.77], [0.08, 0.10]], 'radius': 0.03,
             'material': 'IndicatorLights', 'height': 0.010, 'depthRange': [1.4, 1.9], 'facingMin': 0.05},
            {'view': 'rear', 'node': 'reverse_lights', 'rect': [[0.675, 0.465], [0.08, 0.07]], 'radius': 0.02,
             'material': 'ReverseLights', 'height': 0.010, 'depthRange': [1.4, 1.9], 'facingMin': 0.05},
            {'view': 'rear', 'rect': [[0.0, 0.53], [0.52, 0.11]], 'radius': 0.005, 'mirror': False, 'material': 'plate',
             'height': 0.006, 'depthRange': [1.4, 1.9], 'facingMin': 0.1},
            {'view': 'front', 'rect': [[0.0, 0.25], [0.44, 0.10]], 'radius': 0.005, 'mirror': False, 'material': 'plate',
             'height': 0.006, 'depthRange': [-1.9, -1.4]},
        ],
        'bars': [
            {'view': 'front', 'span': [-0.40, 0.40], 'b': [0.49, 0.62], 'count': 3, 'width': 0.008, 'material': 'chrome',
             'height': 0.007, 'depthRange': [-1.9, -1.5]},
        ],
        'lines': [
            {'view': 'side', 'points': [[-0.70, 0.88], [-0.70, 0.25], [0.18, 0.25], [0.18, 0.89]], 'width': 0.005},
            {'view': 'rear', 'points': [[0.0, 0.86], [0.55, 0.85], [0.58, 0.66], [0.0, 0.65]], 'width': 0.005, 'depthRange': [1.2, 1.9],
             'facingMin': 0.1},
            {'view': 'side', 'points': [[-0.62, 0.90], [0.14, 0.90], [0.14, 1.23], [-0.42, 1.235], [-0.62, 0.90]], 'width': 0.012,
             'material': 'chrome', 'height': 0.003},
            {'view': 'side', 'points': [[0.22, 0.90], [0.90, 0.90], [0.80, 1.225], [0.22, 1.225], [0.22, 0.90]], 'width': 0.012,
             'material': 'chrome', 'height': 0.003},
        ],
        'bumpers': {
            'front': {'z': [0.30, 0.37], 'depth': 0.05, 'wrap': 0.25, 'profile': 'blade', 'overriders': [[0.36, 0.05, 0.28, 0.40]]},
            'rear': {'z': [0.30, 0.37], 'depth': 0.05, 'wrap': 0.25, 'profile': 'blade', 'overriders': [[0.36, 0.05, 0.28, 0.40]]},
        },
        'mirror': {'y': -0.55, 'z': 0.95, 'reach': 0.84, 'w': 0.10, 'h': 0.07, 'sides': [1]},
        'handles': {'at': [[0.05, 0.82]], 'w': 0.10},
        'wipers': {'arms': [[-0.45, 0.0, -0.74, 0.97], [0.05, 0.5, -0.74, 0.97]]},
        'wheel': {'style': 'steel', 'windows': 4, 'rimFactor': 0.66, 'cap': True},
    },
}

import os as _os, sys as _sys  # noqa: E402
_sys.path.insert(0, _os.path.dirname(__file__))
from _frame import scale_above  # noqa: E402
# The getoutlines side stands 1397 mm at the roof for the 601's 1437 (the factory figure
# of the saloon); the whole drawing raised, belt and sill with it.
scale_above(CAR, 0.0, 1.397, 1.437)
