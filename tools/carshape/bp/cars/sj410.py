# Suzuki SJ410 soft top (1981-84). Factory: 3430 x 1460 x 1680, wheelbase 2030, tracks
# 1210/1220, 6.00-16, clearance 210. The dimensioned drawing reprinted at
# 3dcar.ru/blueprints/suzuki/sj410_1982_softtop (219 px/m; the side outline read off by
# hand, the door drawn open in it). The small box: a full-width square nose with round
# lamps at its corners and a slotted grille between, a short sloping bonnet, a raked
# screen, metal doors, a canvas top, flared arches all round, the spare on the tail.
BOX = [[0.47, 0.67], [0.52, 0.69], [1.02, 0.69], [1.08, 0.67], [1.55, 0.63], [1.62, 0.58], [1.66, 0.2]]
ARCH_F = [[-1.618, 0.33], [-1.602, 0.449], [-1.556, 0.56], [-1.483, 0.655], [-1.388, 0.728], [-1.277, 0.774], [-1.158, 0.79], [-1.039, 0.774], [-0.928, 0.728], [-0.833, 0.655], [-0.76, 0.56], [-0.714, 0.449], [-0.698, 0.33]]
ARCH_R = [[0.412, 0.33], [0.428, 0.449], [0.474, 0.56], [0.547, 0.655], [0.642, 0.728], [0.753, 0.774], [0.872, 0.79], [0.991, 0.774], [1.102, 0.728], [1.197, 0.655], [1.27, 0.56], [1.316, 0.449], [1.332, 0.33]]
CAR = {
    'id': 'sj410',
    'label': 'Suzuki SJ410',
    'factory': {'length': 3.43, 'width': 1.46, 'height': 1.68, 'clearance': 0.21, 'wheelbase': 2.03,
                'frontTrack': 1.21, 'rearTrack': 1.22, 'wheelRadius': 0.35, 'tyreWidth': 0.16, 'frontOverhang': 0.557},
    'blueprint': {
        'image': 'sj410.jpg',
        'dark': 120,
        'side': {'box': [587, 39, 1428, 501], 'nose': 'left', 'wheels': [[752, 330], [1196, 330]], 'ground': 408, 'isotropic': True,
                 'outline': [[-1.716, 0.494], [-1.716, 0.631], [-1.602, 0.64], [-1.588, 0.86], [-1.556, 0.997], [-1.396, 1.033], [-0.756, 1.079], [-0.618, 1.088], [-0.321, 1.591], [-0.276, 1.637], [1.393, 1.646], [1.448, 1.591], [1.462, 0.631], [1.508, 0.608], [1.508, 0.494], [1.348, 0.485], [-0.71, 0.471], [-1.579, 0.485]]},
        'front': {'box': [33, 38, 528, 464], 'ppm': 218.7, 'centre': 270, 'zRef': [[48, 1.646], [408, 0.0]]},
        'rear': {'box': [57, 524, 498, 960], 'ppm': 219, 'centre': 278, 'zRef': [[535, 1.69], [905, 0.0]]},
    },
    'hull': {
        'sill': [[-1.73, 0.49], [-1.45, 0.50], [-0.8, 0.48], [0.8, 0.49], [1.65, 0.50]],
        'planOverride': [[-1.73, 0.70], [1.65, 0.70]],
        'sectionStations': [{'y': -1.70, 'half': BOX}, {'y': 1.47, 'half': BOX}],
        'topCross': [
            {'y': -1.73, 'z': [[0.0, 0.94], [0.60, 0.93], [0.69, 0.90]]},
            {'y': -0.62, 'z': [[0.0, 1.07], [0.60, 1.06], [0.69, 1.03]]},
        ],
        'cabin': [-0.62, 1.47],
        'belt': [[-0.62, 1.05], [1.47, 1.05]],
        'glassPlan': [[-0.62, 0.65], [1.47, 0.65]],
        'roofHalf': 0.65,
        'roofCrown': 0.02,
        'edge': 0.012,
        'arch': {'radius': 0.42, 'lift': 0.0},
    },
    'parts': {
        'underbody': {'frame': True},
        'archFlares': [{'axle': 'both', 'r': 0.425, 'w': 0.06, 't': 0.03}],
        'paint2': {'name': 'trim_canvas', 'rgb': [0.07, 0.07, 0.075]},
        'glass': [
            {'view': 'side', 'outline': [[-0.30, 1.06], [0.36, 1.06], [0.36, 1.50], [-0.20, 1.50]], 'facingMin': 0.3},
            {'view': 'side', 'outline': [[0.64, 1.12], [1.30, 1.12], [1.30, 1.50], [0.64, 1.50]], 'facingMin': 0.3},
            {'view': 'front', 'outline': [[0.0, 1.57], [0.58, 1.57], [0.60, 1.20], [0.0, 1.20]], 'depthRange': [-0.7, -0.1],
             'facingMin': 0.2},
            {'view': 'rear', 'outline': [[0.0, 1.55], [0.50, 1.55], [0.50, 1.20], [0.0, 1.20]], 'depthRange': [1.25, 1.6],
             'facingMin': 0.2, 'fit': False},
        ],
        'regions': [
            {'view': 'side', 'outline': [[0.42, 1.06], [1.75, 1.06], [1.75, 1.80], [0.42, 1.80]], 'material': 'paint2'},
            {'view': 'side', 'outline': [[-0.45, 1.53], [0.42, 1.53], [0.42, 1.80], [-0.45, 1.80]], 'material': 'paint2'},
            {'view': 'top', 'outline': [[-0.45, 0.0], [-0.45, 0.8], [1.75, 0.8], [1.75, 0.0]], 'material': 'paint2', 'facingMin': 0.5},
            {'view': 'rear', 'rect': [[0.0, 1.38], [1.6, 0.66]], 'mirror': False, 'material': 'paint2', 'depthRange': [1.25, 1.6]},
            {'view': 'front', 'rect': [[0.0, 0.56], [1.5, 0.12]], 'radius': 0.001, 'mirror': False, 'depthRange': [-1.85, -1.5]},
        ],
        'decals': [
            {'view': 'front', 'rect': [[0.0, 0.805], [1.30, 0.22]], 'radius': 0.02, 'mirror': False, 'material': 'trim',
             'height': 0.003, 'depthRange': [-1.85, -1.5]},
            {'view': 'front', 'circle': [[0.49, 0.80], 0.095], 'material': 'chrome', 'height': 0.006, 'depthRange': [-1.85, -1.5]},
            {'view': 'front', 'node': 'headlights', 'circle': [[0.49, 0.80], 0.08], 'material': 'Headlights', 'height': 0.010,
             'depthRange': [-1.85, -1.5]},
            {'view': 'front', 'node': 'front_blinker_left', 'rect': [[0.48, 0.66], [0.18, 0.05]], 'radius': 0.006,
             'material': 'IndicatorLights', 'height': 0.010, 'depthRange': [-1.85, -1.5]},
            {'view': 'front', 'node': 'front_blinker_right', 'rect': [[0.48, 0.66], [0.18, 0.05]], 'radius': 0.006,
             'material': 'IndicatorLights', 'height': 0.010, 'depthRange': [-1.85, -1.5]},
            {'view': 'front', 'rect': [[0.0, 0.91], [0.30, 0.03]], 'radius': 0.005, 'mirror': False, 'material': 'chrome',
             'height': 0.005, 'depthRange': [-1.85, -1.4]},
            {'view': 'rear', 'node': 'taillights', 'rect': [[0.52, 0.60], [0.24, 0.07]], 'radius': 0.006, 'material': 'TailLights',
             'height': 0.010, 'depthRange': [1.25, 1.6], 'facingMin': 0.2},
            {'view': 'rear', 'node': 'rear_blinker_left', 'rect': [[0.62, 0.54], [0.10, 0.04]], 'radius': 0.006,
             'material': 'IndicatorLights', 'height': 0.010, 'depthRange': [1.25, 1.6], 'facingMin': 0.2},
            {'view': 'rear', 'node': 'rear_blinker_right', 'rect': [[0.62, 0.54], [0.10, 0.04]], 'radius': 0.006,
             'material': 'IndicatorLights', 'height': 0.010, 'depthRange': [1.25, 1.6], 'facingMin': 0.2},
            {'view': 'rear', 'node': 'reverse_lights', 'rect': [[0.40, 0.54], [0.10, 0.04]], 'radius': 0.006,
             'material': 'ReverseLights', 'height': 0.010, 'depthRange': [1.25, 1.6], 'facingMin': 0.2},
            {'view': 'rear', 'rect': [[0.38, 0.83], [0.30, 0.13]], 'radius': 0.005, 'mirror': False, 'material': 'plate',
             'height': 0.006, 'depthRange': [1.25, 1.6], 'facingMin': 0.2},
        ],
        'bars': [
            {'view': 'front', 'span': [-0.31, 0.31], 'b': [0.73, 0.88], 'count': 12, 'width': 0.016, 'dir': 'v',
             'material': 'paint', 'height': 0.006, 'depthRange': [-1.85, -1.5]},
        ],
        'lines': [
            {'view': 'side', 'points': [[-0.62, 1.05], [-0.60, 0.52], [0.42, 0.52], [0.42, 1.05]], 'width': 0.006},
            {'view': 'side', 'points': [[-1.62, 0.93], [-0.62, 1.05]], 'width': 0.005},
        ],
        'bumpers': {
            'front': {'z': [0.50, 0.62], 'depth': 0.07, 'wrap': 0.05, 'profile': 'blade', 'material': 'trim'},
            # The factory length runs to the spare; the bar itself sits on the tail
            # (photos), so it may not stand out to +L/2.
            'rear': {'z': [0.48, 0.58], 'depth': 0.07, 'wrap': 0.05, 'profile': 'blade', 'material': 'trim', 'standMax': 0.03},
        },
        # Photos: the spare hangs on the tail door, its tyre's foot just over the
        # bumper (centre 0.92), on a ~10 cm carrier; its face is the factory 3430 end.
        'spares': [{'c': [-0.15, 1.64, 0.92], 'n': [0, 1, 0], 'r': 0.34, 'w': 0.16}],
        'boxes': [{'c': [-0.15, 1.525, 0.92], 'size': [0.14, 0.11, 0.14], 'mirror': False, 'material': 'trim'}],
        'mirror': {'y': -0.50, 'z': 1.25, 'reach': 0.84, 'w': 0.09, 'h': 0.12},
        'wipers': {'arms': [[-0.5, -0.05, -0.62, 1.22], [0.05, 0.5, -0.62, 1.22]]},
        'wheel': {'style': 'steel', 'windows': 0, 'rimFactor': 0.6, 'cap': True},
    },
}

import os as _os, sys as _sys  # noqa: E402
_sys.path.insert(0, _os.path.dirname(__file__))
from _frame import scale_above  # noqa: E402
# The hand-read outline stands 1646 mm at the roof where the drawing dimensions 1680.
scale_above(CAR, 0.0, 1.646, 1.68)
