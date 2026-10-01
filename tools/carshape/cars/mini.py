# Mini Cooper S (1964-71). Factory: 3054 x 1410 x 1346, wheelbase 2036, tracks
# 1214/1176, 145-10. Read off the drawing reprinted at
# 3dcar.ru/blueprints/other/austin_mini_1968 (side, front, rear, plan), calibrated by
# the wheelbase (335 px/m). A box on ten-inch wheels pushed to the corners: the bonnet
# falls to a vertical grille with the moustache surround, round lamps in the wing
# tops, a tall glasshouse with a white roof, upright vertical tail lamps.
CAR = {
    'id': 'mini',
    'label': 'Mini Cooper S',
    'kind': 'saloon',
    'factory': {'length': 3.054, 'width': 1.41, 'height': 1.346, 'clearance': 0.15, 'wheelbase': 2.036,
                'frontTrack': 1.214, 'rearTrack': 1.176, 'wheelRadius': 0.255, 'tyreWidth': 0.145, 'frontOverhang': 0.45},
    'trimEnds': 0.03,
    'deck': [[-1.497, 0.76], [-1.42, 0.80], [-1.3, 0.85], [-1.0, 0.89], [-0.81, 0.91], [-0.4, 0.85],
             [0.9, 0.85], [1.35, 0.85], [1.42, 0.82], [1.497, 0.76]],
    'belt': 0.84,
    'cabin': [-0.81, -0.48, 0.95, 1.35],
    'roof': [1.33, 1.30],
    'screenTop': 1.19,
    'crown': 0.012,
    'roofCrown': 0.12,
    'widths': {'waist': 0.705, 'shoulder': 0.695, 'deckEdge': 0.67, 'glassDeck': 0.62, 'glass': 0.60,
               'railDeck': 0.50, 'railPillar': 0.55, 'rail': 0.52, 'sill': 0.66},
    'planFactor': [[-1.497, 0.94], [-1.42, 0.985], [-1.3, 1.0], [1.35, 1.0], [1.497, 0.97]],
    'sill': [[-1.497, 0.40], [-1.3, 0.32], [-1.1, 0.30], [1.0, 0.30], [1.3, 0.32], [1.497, 0.40]],
    'floor': [[-1.497, 0.38], [-1.3, 0.23], [-1.1, 0.20], [1.0, 0.20], [1.3, 0.23], [1.497, 0.38]],
    'waistZ': 0.60,
    'shoulderDrop': 0.05,
    'shoulderRound': 0.2,
    'windows': [[[-0.62, 0.84], [-0.44, 1.19], [0.21, 1.19], [0.21, 0.84]],
                [[0.25, 0.84], [0.25, 1.19], [0.90, 1.19], [0.97, 1.08], [0.97, 0.84]]],
    'arch': {'radiusFactor': 1.2, 'lift': 0.01, 'wellDepth': 0.26},
    'parts': {
        'headlamps': [[0.53, 0.80, 0.085]], 'bezel': 0.015,
        'grille': {'halfWidth': 0.42, 'z': [0.56, 0.74], 'slats': 7},
        'bumper': {'depth': 0.04, 'height': 0.05, 'standOff': 0.025, 'wrap': 0.25, 'halfWidth': 0.70,
                   'zFront': 0.44, 'zRear': 0.42},
        'overriders': {'x': 0.32, 'height': 0.11, 'width': 0.03},
        'doorHandles': [[0.03, 0.80]],
        'windowFrame': 0.012,
        'lamps': [
            {'node': 'front_blinker_left', 'material': 'IndicatorLights', 'end': 'front', 'shape': 'disc', 'x': 0.58, 'z': 0.58, 'r': 0.035},
            {'node': 'front_blinker_right', 'material': 'IndicatorLights', 'end': 'front', 'shape': 'disc', 'x': 0.58, 'z': 0.58, 'r': 0.035},
            {'node': 'taillights', 'material': 'TailLights', 'end': 'rear', 'shape': 'rect', 'x': 0.62, 'z': 0.66, 'w': 0.07, 'h': 0.08},
            {'node': 'rear_blinker_left', 'material': 'IndicatorLights', 'end': 'rear', 'shape': 'rect', 'x': 0.62, 'z': 0.75, 'w': 0.07, 'h': 0.06},
            {'node': 'rear_blinker_right', 'material': 'IndicatorLights', 'end': 'rear', 'shape': 'rect', 'x': 0.62, 'z': 0.75, 'w': 0.07, 'h': 0.06},
            {'node': 'reverse_lights', 'material': 'ReverseLights', 'end': 'rear', 'shape': 'rect', 'x': 0.62, 'z': 0.585, 'w': 0.07, 'h': 0.05},
        ],
        'mirror': {'x': 0.72, 'y': -0.58, 'z': 0.90},
        'wheel': {'style': 'steel', 'windows': 8, 'rimFactor': 0.66},
    },
}
