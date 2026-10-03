# Toyota Land Cruiser BJ40 hardtop (1974-84). Factory: 3870 x 1665 x 1950, wheelbase 2285,
# overhangs 705/880 (to the spare), tracks 1404/1400, 7.00-15, clearance 210. The
# dimensioned drawing reprinted at 3dcar.ru/blueprints/toyota/land_cruiser_fj40_1963 (105
# px/m; its side outline read off by hand at 4x). Flat-topped front wings sloping down to
# the step, round lamps either side of a small mesh grille, an upright screen, the white
# hardtop with wide quarter windows, flared rear arches, the spare on the back door.
WING = [[0.42, 0.78], [0.50, 0.81], [0.84, 0.81], [0.88, 0.75], [0.90, 0.50], [1.12, 0.48], [1.17, 0.3], [1.19, 0.1]]
BOX = [[0.38, 0.80], [0.46, 0.83], [1.70, 0.825], [1.76, 0.78], [1.79, 0.5], [1.81, 0.2]]
CAR = {
    'id': 'bj40',
    'label': 'Toyota Land Cruiser BJ40',
    'factory': {'length': 3.87, 'width': 1.665, 'height': 1.93, 'clearance': 0.21, 'wheelbase': 2.285,
                'frontTrack': 1.404, 'rearTrack': 1.4, 'wheelRadius': 0.37, 'tyreWidth': 0.19, 'frontOverhang': 0.705},
    'blueprint': {
        'image': 'bj40.jpg',
        'dark': 120,
        'side': {'box': [400, 25, 850, 260], 'nose': 'left', 'wheels': [[476.25, 207.5], [715.5, 207.5]], 'ground': 241.25,
                 'isotropic': True,
                 'outline': [[-1.887, 0.43], [-1.887, 0.549], [-1.576, 0.556], [-1.564, 0.824], [-1.54, 1.051], [-1.457, 1.11], [-0.621, 1.163], [-0.43, 1.163], [-0.311, 1.648], [-0.287, 1.707], [0.43, 1.791], [1.695, 1.798], [1.738, 1.743], [1.743, 0.585], [1.886, 0.573], [1.886, 0.442], [1.385, 0.418], [-0.526, 0.382], [-1.481, 0.442]]},
    },
    'hull': {
        # the drawn bumpers are the bars' (parts.bumpers), not the shell's
        'bumpers': {'front': {'z': [0.41, 0.57]}, 'rear': {'z': [0.41, 0.59]}},
        # behind the bars the body's own faces (below the band there is only the frame)
        'face': {'front': [[0.38, -1.57], [0.62, -1.57]], 'rear': [[0.38, 1.74], [0.62, 1.74]]},
        'sill': [[-1.89, 0.43], [-1.48, 0.44], [-0.53, 0.39], [1.38, 0.42], [1.89, 0.44]],
        'planOverride': [[-1.9, 0.80], [-1.6, 0.83], [1.89, 0.83]],
        'sectionStations': [{'y': -1.70, 'half': WING}, {'y': -0.48, 'half': WING}, {'y': -0.40, 'half': BOX}, {'y': 1.75, 'half': BOX}],
        'stationBlend': 0.06,
        'topCross': [
            {'y': -1.89, 'z': [[0.0, 1.10], [0.40, 1.09], [0.48, 1.04], [0.52, 0.87], [0.80, 0.86], [0.83, 0.83]]},
            {'y': -0.42, 'z': [[0.0, 1.17], [0.40, 1.16], [0.48, 1.10], [0.52, 0.88], [0.80, 0.87], [0.83, 0.84]]},
        ],
        'cabin': [-0.40, 1.75],
        'belt': [[-0.40, 1.19], [1.75, 1.19]],
        'glassPlan': [[-0.40, 0.81], [1.75, 0.81]],
        'roofHalf': 0.81,
        'roofCrown': 0.03,
        'edge': 0.014,
        'arch': {'radius': 0.44, 'lift': 0.0},
    },
    'parts': {
        'underbody': {'frame': True},
        'paint2': {'name': 'trim_hardtop', 'rgb': [0.86, 0.86, 0.83]},
        'glass': [
            {'view': 'side', 'outline': [[-0.25, 1.21], [0.25, 1.21], [0.25, 1.61], [-0.25, 1.61]], 'facingMin': 0.3},
            {'view': 'side', 'outline': [[0.78, 1.34], [1.42, 1.34], [1.42, 1.62], [0.78, 1.62]], 'facingMin': 0.3},
            {'view': 'front', 'outline': [[0.03, 1.27], [0.62, 1.27], [0.62, 1.66], [0.03, 1.66]], 'depthRange': [-0.6, -0.1],
             'facingMin': 0.2, 'fit': False},
            {'view': 'rear', 'outline': [[-0.32, 1.45], [0.33, 1.45], [0.33, 1.72], [-0.32, 1.72]], 'mirror': False,
             'depthRange': [1.5, 1.9], 'facingMin': 0.2, 'fit': False},
        ],
        'regions': [
            # The white hardtop behind the doors and over the cab.
            {'view': 'side', 'outline': [[0.47, 1.20], [1.80, 1.20], [1.80, 1.90], [0.47, 1.90]], 'material': 'paint2'},
            {'view': 'side', 'outline': [[-0.40, 1.66], [0.47, 1.66], [0.47, 1.90], [-0.40, 1.90]], 'material': 'paint2'},
            {'view': 'top', 'outline': [[-0.25, 0.0], [-0.25, 0.9], [1.80, 0.9], [1.80, 0.0]], 'material': 'paint2', 'facingMin': 0.5},
            {'view': 'rear', 'rect': [[0.0, 1.55], [1.8, 0.70]], 'mirror': False, 'material': 'paint2', 'depthRange': [1.5, 1.9]},
        ],
        'decals': [
            # the grille panel: dark, from lamp to lamp (photo)
            {'view': 'front', 'rect': [[0.0, 0.80], [0.58, 0.30]], 'radius': 0.02, 'mirror': False, 'material': 'grille',
             'height': 0.004, 'depthRange': [-2.0, -1.4]},
            {'view': 'front', 'circle': [[0.39, 0.84], 0.105], 'material': 'chrome', 'height': 0.006, 'depthRange': [-2.0, -1.4]},
            {'view': 'front', 'node': 'headlights', 'circle': [[0.39, 0.84], 0.085], 'material': 'Headlights', 'height': 0.010,
             'depthRange': [-2.0, -1.4]},

            {'view': 'front', 'rect': [[0.0, 0.615], [0.48, 0.07]], 'radius': 0.01, 'mirror': False, 'material': 'grille',
             'height': 0.004, 'depthRange': [-2.0, -1.4]},
            {'view': 'front', 'rect': [[0.0, 1.02], [0.46, 0.04]], 'radius': 0.01, 'mirror': False, 'material': 'grille',
             'height': 0.004, 'depthRange': [-2.0, -1.4]},
            # amber turn lamps on the wings' front corners, level with the lamps' tops (photo)
            {'view': 'front', 'node': 'front_blinker_left', 'rect': [[0.68, 0.80], [0.11, 0.07]], 'radius': 0.008,
             'material': 'IndicatorLights', 'height': 0.010, 'depthRange': [-2.0, -1.4]},
            {'view': 'front', 'node': 'front_blinker_right', 'rect': [[0.68, 0.80], [0.11, 0.07]], 'radius': 0.008,
             'material': 'IndicatorLights', 'height': 0.010, 'depthRange': [-2.0, -1.4]},
            {'view': 'rear', 'node': 'taillights', 'circle': [[0.71, 0.60], 0.05], 'material': 'TailLights', 'height': 0.012,
             'depthRange': [1.5, 1.9], 'facingMin': 0.2},
            {'view': 'rear', 'node': 'rear_blinker_left', 'circle': [[0.71, 0.73], 0.04], 'material': 'IndicatorLights',
             'height': 0.012, 'depthRange': [1.5, 1.9], 'facingMin': 0.2},
            {'view': 'rear', 'node': 'rear_blinker_right', 'circle': [[0.71, 0.73], 0.04], 'material': 'IndicatorLights',
             'height': 0.012, 'depthRange': [1.5, 1.9], 'facingMin': 0.2},
            {'view': 'rear', 'node': 'reverse_lights', 'rect': [[0.0, 0.95], [0.08, 0.04]], 'radius': 0.01, 'mirror': False,
             'material': 'ReverseLights', 'height': 0.010, 'depthRange': [1.5, 1.9], 'facingMin': 0.2},
            {'view': 'rear', 'rect': [[0.30, 0.82], [0.32, 0.14]], 'radius': 0.005, 'mirror': False, 'material': 'plate',
             'height': 0.006, 'depthRange': [1.5, 1.9], 'facingMin': 0.2},
        ],
        'bars': [
            {'view': 'front', 'span': [-0.26, 0.26], 'b': [0.68, 0.80], 'count': 3, 'width': 0.012, 'material': 'chrome',
             'height': 0.007, 'depthRange': [-2.0, -1.4]},
        ],
        'lines': [
            {'view': 'side', 'points': [[-0.38, 1.18], [-0.38, 0.64], [-0.30, 0.55], [0.40, 0.55], [0.45, 0.62], [0.45, 1.66]], 'width': 0.008},
            {'view': 'side', 'points': [[-1.57, 0.87], [-0.45, 0.88]], 'width': 0.006},
            {'view': 'side', 'points': [[1.0, 0.58], [1.06, 0.70], [1.5, 0.70], [1.6, 0.58]], 'width': 0.03, 'material': 'paint', 'height': 0.02},
            {'view': 'rear', 'points': [[-0.62, 0.50], [-0.62, 1.40], [0.62, 1.40], [0.62, 0.50]], 'mirror': False, 'width': 0.008,
             'depthRange': [1.5, 1.9], 'facingMin': 0.2},
        ],
        'bumpers': {
            'front': {'z': [0.42, 0.55], 'depth': 0.10, 'wrap': 0.02, 'profile': 'blade', 'material': 'trim', 'span': 1.66},
            'rear': {'z': [0.44, 0.56], 'depth': 0.08, 'wrap': 0.02, 'profile': 'blade', 'material': 'trim', 'span': 1.60},
        },
        'spares': [{'c': [-0.47, 1.85, 1.02], 'n': [0, 1, 0], 'r': 0.36, 'w': 0.19}],
        'mirror': {'y': -0.33, 'z': 1.18, 'reach': 0.98, 'w': 0.10, 'h': 0.10, 'shape': 'round', 'mount': 'door'},
        'handles': {'at': [[0.30, 1.10]], 'w': 0.10},
        'wipers': {'arms': [[-0.5, -0.1, -0.42, 1.68], [0.1, 0.5, -0.42, 1.68]]},
        'wheel': {'style': 'steel', 'windows': 0, 'rimFactor': 0.6, 'cap': True},
    },
}


# The drawing (an FJ40 of 1963) stands 1.80 m at the hardtop; the BJ40 hardtop is 1.93
# (carsart.net, auto-data.net: 3870 x 1665 x 1930): everything above the belt raised.
import os as _os, sys as _sys  # noqa: E402
_sys.path.insert(0, _os.path.dirname(__file__))
from _frame import scale_above  # noqa: E402
scale_above(CAR, 1.19, 1.798, 1.93)
