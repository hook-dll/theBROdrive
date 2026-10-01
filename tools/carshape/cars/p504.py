# Peugeot 504 GL (1968-83). Factory: 4490 x 1690 x 1460, wheelbase 2740, tracks
# 1420/1340, 175 SR 14, clearance 160. Read off a straight side photograph on Commons
# ('Peugeot 504 sedan', CC BY 2.0, 377 px/m by the wheelbase; the overhangs, which the
# close camera foreshortens, stretched to the factory length), with front and rear
# photographs of the same series for the lamps.
# Pininfarina's saloon: a long bonnet falling gently to a fine-barred grille between
# trapezoid lamps, a tall glasshouse, the boot drooping to the tail between trapezoid
# lamp clusters, a side crease low on the doors, chrome bumpers with black overriders.
CAR = {
    'id': 'p504',
    'label': 'Peugeot 504',
    'kind': 'saloon',
    'factory': {'length': 4.49, 'width': 1.69, 'height': 1.46, 'clearance': 0.16, 'wheelbase': 2.74,
                'frontTrack': 1.42, 'rearTrack': 1.34, 'wheelRadius': 0.31, 'tyreWidth': 0.175, 'frontOverhang': 0.68},
    'trimEnds': 0.02,
    'deck': [[-2.225, 0.84], [-2.18, 0.89], [-1.5, 0.94], [-0.88, 0.99], [1.40, 1.06], [1.6, 1.04], [2.0, 0.97], [2.225, 0.88]],
    'belt': 1.035,
    'cabin': [-0.88, -0.48, 0.79, 1.40],
    'roof': [1.46, 1.43],
    'screenTop': 1.40,
    'crown': 0.02,
    'roofCrown': 0.05,
    'rearScreenHalf': 0.56,
    'widths': {'waist': 0.845, 'shoulder': 0.84, 'deckEdge': 0.82, 'glassDeck': 0.77, 'glass': 0.73,
               'railDeck': 0.62, 'railPillar': 0.70, 'rail': 0.67, 'sill': 0.81},
    'planFactor': [[-2.225, 0.97], [-2.1, 1.0], [2.1, 1.0], [2.225, 0.97]],
    'sill': [[-2.225, 0.46], [-2.0, 0.38], [-1.0, 0.32], [1.0, 0.32], [2.0, 0.40], [2.225, 0.48]],
    'floor': [[-2.225, 0.42], [-2.0, 0.30], [-1.0, 0.25], [1.0, 0.25], [2.0, 0.32], [2.225, 0.44]],
    'waistZ': 0.72,
    'shoulderDrop': 0.03,
    'edgeDrop': 0.012,
    'shoulderRound': 0.10,
    'tumbleunder': 0.06,
    'smoothAngleDeg': 30,
    'windows': [[[-0.76, 1.035], [-0.46, 1.40], [0.115, 1.40], [0.115, 1.035]],
                [[0.155, 1.035], [0.155, 1.37], [0.73, 1.37], [1.07, 1.035]]],
    'arch': {'radiusFactor': 1.3, 'lift': 0.03, 'wellDepth': 0.3},
    'parts': {
        'headlamps': [{'shape': 'rect', 'x': 0.58, 'z': 0.74, 'w': 0.30, 'h': 0.15}], 'bezel': 0.012,
        'grille': {'halfWidth': 0.40, 'z': [0.63, 0.85], 'slats': 12},
        'bumper': {'depth': 0.06, 'height': 0.09, 'standOff': 0.04, 'wrap': 0.25, 'halfWidth': 0.86,
                   'zFront': 0.50, 'zRear': 0.52},
        'overriders': {'x': 0.36, 'height': 0.15, 'width': 0.07},
        'doorHandles': [[-0.20, 0.93], [0.55, 0.93]],
        'windowFrame': 0.014,
        'lensColours': {'FrontLampLens': [0.9, 0.62, 0.25]},
        'lamps': [
            {'node': 'front_blinker_left', 'material': 'FrontLampLens', 'end': 'front', 'shape': 'rect', 'x': 0.58, 'z': 0.615, 'w': 0.28, 'h': 0.05},
            {'node': 'front_blinker_right', 'material': 'FrontLampLens', 'end': 'front', 'shape': 'rect', 'x': 0.58, 'z': 0.615, 'w': 0.28, 'h': 0.05},
            {'node': 'rear_blinker_left', 'material': 'IndicatorLights', 'end': 'rear', 'shape': 'rect', 'x': 0.69, 'z': 0.80, 'w': 0.15, 'h': 0.09},
            {'node': 'rear_blinker_right', 'material': 'IndicatorLights', 'end': 'rear', 'shape': 'rect', 'x': 0.69, 'z': 0.80, 'w': 0.15, 'h': 0.09},
            {'node': 'reverse_lights', 'material': 'ReverseLights', 'end': 'rear', 'shape': 'rect', 'x': 0.58, 'z': 0.80, 'w': 0.05, 'h': 0.09},
            {'node': 'taillights', 'material': 'TailLights', 'end': 'rear', 'shape': 'rect', 'x': 0.65, 'z': 0.70, 'w': 0.22, 'h': 0.08},
        ],
        'mirror': {'x': 0.88, 'y': -0.70, 'z': 1.08},
        'wheel': {'style': 'hubcap', 'rimFactor': 0.66},
    },
}
