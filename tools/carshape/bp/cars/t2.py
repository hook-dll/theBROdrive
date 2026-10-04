# Volkswagen T2 Kombi (1967-79, Bay window). Factory: 4505 x 1720 x 1950, wheelbase 2400,
# tracks 1384/1425, 185 R14 C, clearance 185. The four views of the 1969 Type 2 at
# getoutlines.com (small, filled; upscaled 6x, 272 px/m by the wheelbase); the
# 3dcar.ru sheet is a T3. The bus: a cab-over flat nose with round lamps low under the
# one-piece panoramic screen and the air intake, a slab-sided box with a belt of square
# windows and a swage line, a domed roof, the engine behind the rear axle under a short
# tail with the lamps low on the corners, thin blade bumpers.
CAR = {
    'id': 't2',
    'label': 'Volkswagen T2',
    'factory': {'length': 4.505, 'width': 1.72, 'height': 1.95, 'clearance': 0.185, 'wheelbase': 2.4,
                'frontTrack': 1.384, 'rearTrack': 1.425, 'wheelRadius': 0.33, 'tyreWidth': 0.185, 'frontOverhang': 1.13},
    'blueprint': {
        'image': 't2_go.png',
        'dark': 235,
        'side': {'box': [40, 20, 1310, 575], 'nose': 'left', 'wheels': [[368, 468], [1022, 468]], 'ground': 556,
                 'isotropic': True},
        'top': {'box': [40, 580, 1310, 1135], 'nose': 'left', 'fitWidth': True},
        'front': {'box': [40, 1140, 680, 1725], 'ppm': 296, 'zRef': [[1150, 1.93], [1630, 0.40]]},
        'rear': {'box': [740, 1150, 1310, 1725], 'ppm': 308, 'zRef': [[1164, 1.93], [1644, 0.40]]},
    },
    'hull': {
        'bumpers': {'front': {'z': [0.37, 0.50]}, 'rear': {'z': [0.36, 0.50]}},
        'sill': [[-2.3, 0.34], [2.3, 0.33]],
        'planOverride': [[-2.27, 0.60], [-2.22, 0.76], [-2.14, 0.83], [-2.0, 0.855], [2.0, 0.855], [2.14, 0.83], [2.22, 0.76],
                         [2.27, 0.60]],
        'cabin': [-2.25, 2.25],
        'belt': [[-2.25, 1.27], [2.25, 1.27]],
        'glassPlan': [[-2.25, 0.70], [-2.05, 0.80], [2.05, 0.80], [2.25, 0.70]],
        'roofHalf': 0.75,
        'roofCrown': 0.12,
        'edge': 0.025,
        'arch': {'radius': 0.39, 'lift': 0.03},
    },
    'parts': {
        'underbody': {'engine': 'rear'},
        'glass': [
            {'view': 'side', 'outline': [[-1.78, 1.30], [-0.97, 1.30], [-0.97, 1.64], [-1.70, 1.64], [-1.78, 1.55]], 'facingMin': 0.3},
            {'view': 'side', 'outline': [[-0.78, 1.30], [0.27, 1.30], [0.27, 1.64], [-0.78, 1.64]], 'facingMin': 0.3},
            {'view': 'side', 'outline': [[0.44, 1.30], [1.48, 1.30], [1.48, 1.64], [0.44, 1.64]], 'facingMin': 0.3},
            {'view': 'front', 'outline': [[0.0, 1.77], [0.55, 1.76], [0.70, 1.70], [0.76, 1.55], [0.76, 1.36], [0.73, 1.31], [0.0, 1.31]],
             'depthRange': [-2.4, -1.7], 'facingMin': -0.2},
            {'view': 'rear', 'outline': [[0.0, 1.65], [0.50, 1.65], [0.54, 1.61], [0.54, 1.35], [0.50, 1.31], [0.0, 1.31]],
             'depthRange': [1.7, 2.4], 'facingMin': 0.1},
        ],
        'decals': [
            {'view': 'front', 'circle': [[0.565, 0.87], 0.12], 'material': 'chrome', 'height': 0.006, 'depthRange': [-2.4, -2.0]},
            {'view': 'front', 'node': 'headlights', 'circle': [[0.565, 0.87], 0.09], 'material': 'Headlights', 'height': 0.012,
             'depthRange': [-2.4, -2.0]},
            {'view': 'front', 'circle': [[0.0, 0.93], 0.11], 'mirror': False, 'material': 'chrome', 'height': 0.006,
             'depthRange': [-2.4, -2.0]},
            {'view': 'front', 'circle': [[0.0, 0.93], 0.085], 'mirror': False, 'material': 'paint', 'height': 0.008,
             'depthRange': [-2.4, -2.0]},
            {'view': 'front', 'rect': [[0.245, 1.09], [0.41, 0.09]], 'radius': 0.02, 'material': 'grille', 'height': 0.004,
             'depthRange': [-2.4, -2.0]},
            {'view': 'front', 'node': 'front_blinker_left', 'rect': [[0.69, 0.58], [0.20, 0.07]], 'radius': 0.02,
             'material': 'IndicatorLights', 'height': 0.010, 'depthRange': [-2.4, -2.0]},
            {'view': 'front', 'node': 'front_blinker_right', 'rect': [[0.69, 0.58], [0.20, 0.07]], 'radius': 0.02,
             'material': 'IndicatorLights', 'height': 0.010, 'depthRange': [-2.4, -2.0]},
            {'view': 'front', 'rect': [[0.0, 0.31], [0.52, 0.11]], 'radius': 0.005, 'mirror': False, 'material': 'plate',
             'height': 0.005, 'depthRange': [-2.4, -2.0]},
            {'view': 'rear', 'node': 'taillights', 'rect': [[0.56, 0.66], [0.11, 0.17]], 'radius': 0.035, 'material': 'TailLights',
             'height': 0.010, 'depthRange': [1.9, 2.4], 'facingMin': 0.1},
            {'view': 'rear', 'node': 'rear_blinker_left', 'rect': [[0.56, 0.715], [0.11, 0.06]], 'radius': 0.03,
             'material': 'IndicatorLights', 'height': 0.012, 'depthRange': [1.9, 2.4], 'facingMin': 0.1},
            {'view': 'rear', 'node': 'rear_blinker_right', 'rect': [[0.56, 0.715], [0.11, 0.06]], 'radius': 0.03,
             'material': 'IndicatorLights', 'height': 0.012, 'depthRange': [1.9, 2.4], 'facingMin': 0.1},
            {'view': 'rear', 'node': 'reverse_lights', 'rect': [[0.56, 0.83], [0.10, 0.045]], 'radius': 0.015,
             'material': 'ReverseLights', 'height': 0.010, 'depthRange': [1.9, 2.4], 'facingMin': 0.1},
            {'view': 'rear', 'rect': [[0.0, 0.79], [0.38, 0.13]], 'radius': 0.02, 'mirror': False, 'material': 'plate',
             'height': 0.006, 'depthRange': [1.9, 2.4], 'facingMin': 0.1},
            {'view': 'rear', 'rect': [[0.0, 0.875], [0.28, 0.035]], 'radius': 0.015, 'mirror': False, 'material': 'chrome',
             'height': 0.015, 'depthRange': [1.9, 2.4], 'facingMin': 0.1},
            # Engine-bay louvres behind the last side window.
            {'view': 'side', 'outline': [[1.56, 1.32], [1.68, 1.32], [1.68, 1.62], [1.56, 1.62]], 'material': 'grille', 'height': 0.003},
        ],
        'lines': [
            # Engine-bay louvres behind the last side window, as slats on the dark panel
            # (side-view bars are skipped by assemble.py and left a bare black rectangle).
            {'view': 'side', 'points': [[1.565, z], [1.675, z]], 'width': 0.022, 'material': 'paint', 'height': 0.005}
            for z in (1.365, 1.410, 1.455, 1.500, 1.545, 1.590)
        ] + [
            # The swage line round the waist, under the windows.
            {'view': 'side', 'points': [[-2.2, 1.205], [2.2, 1.205]], 'width': 0.012, 'material': 'paint', 'height': 0.008},
            {'view': 'front', 'points': [[-0.85, 1.25], [0.85, 1.25]], 'width': 0.014, 'mirror': False, 'material': 'paint',
             'height': 0.008, 'depthRange': [-2.4, -2.0]},
            {'view': 'rear', 'points': [[-0.85, 1.25], [0.85, 1.25]], 'width': 0.014, 'mirror': False, 'material': 'paint',
             'height': 0.008, 'depthRange': [1.9, 2.4], 'facingMin': 0.1},
            {'view': 'side', 'points': [[-2.05, 1.27], [-2.05, 0.36], [-0.85, 0.36], [-0.85, 1.27]], 'width': 0.006},
            {'view': 'side', 'points': [[-0.83, 1.27], [-0.83, 0.36], [0.36, 0.36], [0.36, 1.27]], 'width': 0.006},
            {'view': 'rear', 'points': [[0.0, 0.95], [0.45, 0.95], [0.46, 0.60], [0.0, 0.60]], 'width': 0.006, 'depthRange': [1.9, 2.4],
             'facingMin': 0.1},
            {'view': 'side', 'points': [[-1.80, 1.29], [-0.96, 1.29], [-0.96, 1.655], [-1.71, 1.655], [-1.80, 1.55], [-1.80, 1.29]],
             'width': 0.015, 'material': 'rubber', 'height': 0.002},
            {'view': 'side', 'points': [[-0.79, 1.29], [0.28, 1.29], [0.28, 1.655], [-0.79, 1.655], [-0.79, 1.29]],
             'width': 0.015, 'material': 'rubber', 'height': 0.002},
            {'view': 'side', 'points': [[0.43, 1.29], [1.49, 1.29], [1.49, 1.655], [0.43, 1.655], [0.43, 1.29]],
             'width': 0.015, 'material': 'rubber', 'height': 0.002},
        ],
        'bumpers': {
            'front': {'z': [0.39, 0.48], 'depth': 0.05, 'wrap': 0.25, 'profile': 'blade'},
            'rear': {'z': [0.38, 0.47], 'depth': 0.05, 'wrap': 0.25, 'profile': 'blade'},
        },
        'mirror': {'y': -2.0, 'z': 1.36, 'reach': 1.0, 'w': 0.11, 'h': 0.15, 'shape': 'round'},
        'handles': {'at': [[-1.05, 1.08], [0.20, 1.08]], 'w': 0.12},
        'wipers': {'arms': [[-0.65, -0.15, -2.18, 1.32], [0.05, 0.55, -2.18, 1.32]]},
        'wheel': {'style': 'steel', 'windows': 10, 'rimFactor': 0.66, 'cap': True},
    },
}
