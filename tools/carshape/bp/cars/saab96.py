# Saab 96 V4 (1967-80). Factory: 4165 x 1580 x 1470 (automobile-catalog 1967, the 1966
# carfolio sheet gives 4170), wheelbase 2498, tracks 1220, 155 SR 15, clearance 180.
# The 3dcar.ru/blueprints/saab/96_1960 drawing (3x upscaled) is the 1960 short nose: its
# own front overhang is 0.671 m to the bumper face (1960: 4020 - 2498 - 892 = 0.63; V4:
# 4165 - 2498 - 892 = 0.775). saab96v4x3.png is that sheet with the front of the side and
# top views - ahead of the front tyre, so no arch moves - stretched out to the V4's.
CAR = {
    'id': 'saab96',
    'label': 'Saab 96',
    'factory': {'length': 4.165, 'width': 1.58, 'height': 1.47, 'clearance': 0.18, 'wheelbase': 2.498,
                'frontTrack': 1.22, 'rearTrack': 1.22, 'wheelRadius': 0.31, 'tyreWidth': 0.155, 'frontOverhang': 0.775},
    'blueprint': {
        'image': 'saab96v4x3.png',
        'side': {'box': [950, 171, 2700, 790], 'nose': 'left', 'ground': 793, 'wheels': [[1306.5, 650], [2320.5, 650]]},
        'top': {'box': [975, 960, 2697, 1629], 'nose': 'left'},
        'front': {'box': [90, 171, 816, 780]},
        'rear': {'box': [81, 945, 816, 1560]},
    },
    'hull': {
        'bumpers': {'front': {'z': [0.28, 0.56]}, 'rear': {'z': [0.28, 0.54]}},
        'sill': [[-2.1, 0.42], [-1.9, 0.35], [-1.6, 0.30], [-1.3, 0.28], [1.0, 0.28], [1.5, 0.31], [1.8, 0.35], [2.1, 0.42]],
        'cabin': [-0.75, 1.55],
        'belt': [[-0.75, 1.02], [-0.5, 1.00], [0.95, 0.98], [1.55, 0.98]],
        'glassPlan': [[-0.75, 0.62], [-0.4, 0.68], [0.5, 0.68], [1.55, 0.58]],
        'crown': [[-2.2, 0.03], [2.2, 0.03]],
        'roofCrown': 0.05,
        'roofHalf': 0.55,
        'edge': 0.02,
        # The wing's skin runs nearly parallel to the arch's cylinder round the front of
        # the opening: the default 12 mm lip left the rim a row of teeth (the photos show
        # a plain lip). 30 mm smooths the intersection (as on the Mini).
        'archLip': 0.03,
        # The tyre (155 SR 15, R 0.31) with the drawing's own few cm of gap, not the 5 cm
        # 0.36 left: the arch looked a size too big around the wheel.
        'arch': {'radius': 0.345, 'lift': 0.02},
        # The bumpers stand against the body in the photographs, but the body's front and
        # tail faces tuck back 9-20 cm at the bars' height (a valance drawn well behind
        # the bumper's face), so the bars (their faces on the factory ends) floated clear
        # of the shell. The drawn 1960 nose curls under from z 0.6; the V4's front panel
        # is upright over the bumper, so the face is given over that band and the drawn
        # outline kept above it.
        'face': {'front': [[0.34, -2.02], [0.50, -2.02], [0.62, -2.014]],
                 'rear': [[0.36, 2.02], [0.50, 2.02], [0.62, 1.96]]},
    },
    'parts': {
        'glass': [
            {'view': 'side', 'outline': [[0.151, 1.007], [0.151, 1.125], [0.136, 1.212], [0.107, 1.318], [-0.093, 1.318], [-0.228, 1.309],
                                         [-0.312, 1.292], [-0.391, 1.26], [-0.44, 1.229], [-0.62, 1.089], [-0.573, 1.029], [-0.497, 1.024],
                                         [-0.098, 1.017]], 'facingMin': 0.3},
            {'view': 'side', 'outline': [[0.24, 1.32], [0.24, 1.0], [0.90, 0.98], [0.96, 1.03], [0.75, 1.23], [0.45, 1.31]], 'facingMin': 0.3},
            {'view': 'front', 'outline': [[0.0, 1.33], [0.47, 1.325], [0.51, 1.30], [0.53, 1.06], [0.50, 1.04], [0.0, 1.04]],
             'depthRange': [-1.0, -0.4], 'facingMin': 0.25},
            # The wrap-round rear window.
            {'view': 'rear', 'outline': [[0.0, 1.27], [0.47, 1.265], [0.52, 1.24], [0.57, 1.05], [0.55, 1.02], [0.0, 1.02]],
             'depthRange': [0.9, 1.6], 'facingMin': 0.1},
        ],
        'decals': [
            # The central chrome bar with the emblem between the lamps (the drawing's
            # shield, narrowed to the 1967 V4 photograph's bar), the grille slats either
            # side of it reaching each lamp's bezel.
            {'view': 'front', 'outline': [[0.0, 0.78], [0.048, 0.775], [0.072, 0.75], [0.081, 0.60], [0.078, 0.505], [0.06, 0.499], [0.0, 0.497]],
             'material': 'chrome', 'height': 0.006, 'depthRange': [-2.2, -1.7]},
            {'view': 'front', 'outline': [[0.0, 0.76], [0.042, 0.755], [0.063, 0.735], [0.072, 0.60], [0.069, 0.512], [0.054, 0.505], [0.0, 0.503]],
             'material': 'grille', 'height': 0.008, 'depthRange': [-2.2, -1.7]},
            {'view': 'front', 'rect': [[0.34, 0.6525], [0.62, 0.245]], 'radius': 0.005, 'material': 'grille',
             'height': 0.006, 'depthRange': [-2.2, -1.7]},
            {'view': 'front', 'node': 'headlights', 'circle': [[0.47, 0.673], 0.085], 'material': 'Headlights',
             'height': 0.012, 'depthRange': [-2.2, -1.5], 'facingMin': 0.4},
            {'view': 'front', 'circle': [[0.47, 0.673], 0.10], 'ring': 0.015, 'material': 'chrome',
             'height': 0.013, 'depthRange': [-2.2, -1.5], 'facingMin': 0.4},
            {'view': 'front', 'rect': [[0.335, 0.555], [0.30, 0.06]], 'radius': 0.02, 'material': 'chrome',
             'height': 0.005, 'depthRange': [-2.2, -1.6]},
            {'view': 'front', 'rect': [[0.335, 0.555], [0.27, 0.035]], 'radius': 0.012, 'material': 'grille',
             'height': 0.006, 'depthRange': [-2.2, -1.6]},
            {'view': 'front', 'node': 'front_blinker_left', 'rect': [[0.60, 0.53], [0.11, 0.05]], 'radius': 0.02,
             'material': 'IndicatorLights', 'height': 0.008, 'depthRange': [-2.2, -1.4], 'facingMin': 0.2},
            {'view': 'front', 'node': 'front_blinker_right', 'rect': [[0.60, 0.53], [0.11, 0.05]], 'radius': 0.02,
             'material': 'IndicatorLights', 'height': 0.008, 'depthRange': [-2.2, -1.4], 'facingMin': 0.2},
            # Round tail lamps in the rear wings.
            {'view': 'rear', 'node': 'taillights', 'outline': [[0.47, 0.73], [0.55, 0.73], [0.58, 0.68], [0.565, 0.61], [0.50, 0.60],
                                                               [0.455, 0.64], [0.455, 0.70]],
             'material': 'TailLights', 'height': 0.010, 'depthRange': [1.6, 2.2], 'facingMin': 0.2},
            {'view': 'rear', 'node': 'rear_blinker_left', 'rect': [[0.51, 0.575], [0.08, 0.03]], 'radius': 0.01,
             'material': 'IndicatorLights', 'height': 0.008, 'depthRange': [1.6, 2.2], 'facingMin': 0.2},
            {'view': 'rear', 'node': 'rear_blinker_right', 'rect': [[0.51, 0.575], [0.08, 0.03]], 'radius': 0.01,
             'material': 'IndicatorLights', 'height': 0.008, 'depthRange': [1.6, 2.2], 'facingMin': 0.2},
            {'view': 'rear', 'node': 'reverse_lights', 'circle': [[0.0, 0.51], 0.025], 'mirror': False,
             'material': 'ReverseLights', 'height': 0.008, 'depthRange': [1.6, 2.2]},
            {'view': 'rear', 'rect': [[0.0, 0.66], [0.50, 0.17]], 'radius': 0.01, 'mirror': False, 'material': 'plate',
             'height': 0.006, 'depthRange': [1.6, 2.2]},
        ],
        'bars': [
            # The grille is a mesh: horizontals across it and verticals, the 1966-68
            # photographs' grid, with the central shield proud of it.
            {'view': 'front', 'span': [-0.29, 0.29], 'b': [0.545, 0.765], 'count': 5, 'width': 0.006, 'dir': 'h',
             'material': 'chrome', 'height': 0.010, 'depthRange': [-2.2, -1.7]},
            {'view': 'front', 'span': [-0.285, 0.285], 'b': [0.535, 0.775], 'count': 8, 'width': 0.006, 'dir': 'v',
             'material': 'chrome', 'height': 0.010, 'depthRange': [-2.2, -1.7]},
        ],
        'lines': [
            {'view': 'side', 'points': [[-0.66, 1.0], [-0.66, 0.30], [0.18, 0.30], [0.20, 1.0]], 'width': 0.005},
            # The chrome waist moulding runs low on the body (the 1967 photographs: nose to
            # front arch, along the doors, rear arch to tail) and is stopped at each arch's
            # edge. The old single line ran from the nose to the door at z 0.6-0.75 and
            # straight through the front opening.
            {'view': 'side', 'points': [[-2.0725, 0.50], [-1.7225, 0.50]], 'width': 0.008, 'material': 'chrome', 'height': 0.003},
            {'view': 'side', 'points': [[-1.0325, 0.50], [0.7975, 0.51]], 'width': 0.008, 'material': 'chrome', 'height': 0.003},
            {'view': 'side', 'points': [[1.4475, 0.52], [1.8475, 0.53]], 'width': 0.008, 'material': 'chrome', 'height': 0.003},
            {'view': 'side', 'points': [[-0.63, 1.07], [-0.44, 1.24], [-0.23, 1.32], [0.10, 1.335], [0.45, 1.325], [0.80, 1.24], [0.99, 1.03]],
             'width': 0.012, 'material': 'chrome', 'height': 0.003},
        ],
        'bumpers': {
            'front': {'z': [0.37, 0.44], 'depth': 0.05, 'wrap': 0.25, 'profile': 'blade',
                      'overriders': [[0.36, 0.05, 0.30, 0.53]]},
            'rear': {'z': [0.40, 0.47], 'depth': 0.05, 'wrap': 0.25, 'profile': 'blade',
                     'overriders': [[0.42, 0.05, 0.33, 0.55]]},
        },
        # A round chrome mirror on a short stem on the wing's top at the A-pillar's foot
        # (the front photograph): the old one stood on a tall thin pole 30 cm ahead of
        # the pillar with its head well above the wing.
        'mirror': {'y': -0.7925, 'z': 1.00, 'reach': 0.77, 'w': 0.09, 'h': 0.09, 'shape': 'round',
                   'material': 'chrome', 'mount': 'wing', 'sides': [1]},
        'handles': {'at': [[-0.05, 0.91]], 'w': 0.14},
        'wipers': {'arms': [[-0.5, -0.05, -0.70, 1.04], [0.05, 0.5, -0.70, 1.04]]},
        'wheel': {'style': 'hubcap', 'rimFactor': 0.62, 'cap': 0.7},
    },
}

import os as _os, sys as _sys  # noqa: E402
_sys.path.insert(0, _os.path.dirname(__file__))
from _frame import shift_along  # noqa: E402
# The V4's 4165/775 figures (the drawing is placed by its wheels) put the front axle 7.25 cm
# further from the body's nose than the 1960 4020/630 the parts were placed for.
shift_along(CAR, 0.0725)
