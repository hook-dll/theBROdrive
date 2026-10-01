# Plymouth Valiant sedan (1963-64). Factory: 4628 x 1780 x 1355, wheelbase 2705, tracks
# 1420/1410, 6.50-13, clearance 150. No orthographic drawing found; dimensions from the
# factory data, the lines read off Commons photographs of one 1963 sedan from the front
# and rear three-quarters (CC BY-SA 4.0).
# Exner's square compact: a long flat bonnet and boot, a full-width grille between
# round lamps set into rounded wing ends, a crisp shoulder crease, thin pillars with a
# wrapped rear screen, the rear wings kicking up at the tail over small horizontal
# lamps, thin chrome bumpers.
CAR = {
    'id': 'valiant',
    'label': 'Plymouth Valiant',
    'kind': 'saloon',
    'factory': {'length': 4.628, 'width': 1.78, 'height': 1.355, 'clearance': 0.15, 'wheelbase': 2.705,
                'frontTrack': 1.42, 'rearTrack': 1.41, 'wheelRadius': 0.30, 'tyreWidth': 0.165, 'frontOverhang': 0.86},
    'trimEnds': 0.04,
    'deck': [[-2.27, 0.78], [-2.22, 0.83], [-1.6, 0.87], [-0.62, 0.92], [1.15, 0.95], [1.6, 0.94], [2.1, 0.92], [2.27, 0.86]],
    'belt': 0.95,
    'cabin': [-0.62, -0.22, 0.72, 1.15],
    'roof': [1.355, 1.33],
    'screenTop': 1.30,
    'crown': 0.015,
    'roofCrown': 0.03,
    'rearScreenHalf': 0.62,
    'widths': {'waist': 0.89, 'shoulder': 0.885, 'deckEdge': 0.87, 'glassDeck': 0.80, 'glass': 0.75,
               'railDeck': 0.64, 'railPillar': 0.72, 'rail': 0.68, 'sill': 0.85},
    'planFactor': [[-2.27, 0.95], [-2.15, 1.0], [2.15, 1.0], [2.27, 0.96]],
    'sill': [[-2.27, 0.44], [-2.0, 0.36], [-1.2, 0.30], [1.2, 0.30], [2.0, 0.38], [2.27, 0.46]],
    'floor': [[-2.27, 0.40], [-2.0, 0.28], [-1.2, 0.23], [1.2, 0.23], [2.0, 0.30], [2.27, 0.42]],
    'waistZ': 0.78,
    'shoulderDrop': 0.02,
    'edgeDrop': 0.01,
    'shoulderRound': 0.06,
    'tumbleunder': 0.08,
    'smoothAngleDeg': 28,
    'windows': [[[-0.55, 0.95], [-0.25, 1.29], [0.30, 1.30], [0.30, 0.95]],
                [[0.36, 0.95], [0.36, 1.30], [0.70, 1.29], [0.96, 0.95]]],
    'arch': {'radiusFactor': 1.25, 'lift': 0.04, 'wellDepth': 0.3},
    'parts': {
        'headlamps': [[0.72, 0.68, 0.08]], 'bezel': 0.02,
        'grille': {'halfWidth': 0.58, 'z': [0.56, 0.76], 'slats': 5, 'bars': 10},
        'bumper': {'depth': 0.07, 'height': 0.08, 'standOff': 0.04, 'wrap': 0.30, 'halfWidth': 0.89,
                   'zFront': 0.48, 'zRear': 0.50},
        'doorHandles': [[-0.40, 0.88], [0.40, 0.88]],
        'windowFrame': 0.014,
        'lensColours': {'FrontLampLens': [0.9, 0.62, 0.25]},
        'lamps': [
            {'node': 'front_blinker_left', 'material': 'FrontLampLens', 'end': 'front', 'shape': 'disc', 'x': 0.60, 'z': 0.40, 'r': 0.035},
            {'node': 'front_blinker_right', 'material': 'FrontLampLens', 'end': 'front', 'shape': 'disc', 'x': 0.60, 'z': 0.40, 'r': 0.035},
            {'node': 'taillights', 'material': 'TailLights', 'end': 'rear', 'shape': 'rect', 'x': 0.74, 'z': 0.66, 'w': 0.16, 'h': 0.05},
            {'node': 'rear_blinker_left', 'material': 'TailLights', 'end': 'rear', 'shape': 'rect', 'x': 0.56, 'z': 0.66, 'w': 0.06, 'h': 0.05},
            {'node': 'rear_blinker_right', 'material': 'TailLights', 'end': 'rear', 'shape': 'rect', 'x': 0.56, 'z': 0.66, 'w': 0.06, 'h': 0.05},
            {'node': 'reverse_lights', 'material': 'ReverseLights', 'end': 'rear', 'shape': 'rect', 'x': 0.40, 'z': 0.60, 'w': 0.06, 'h': 0.03},
        ],
        'mirror': {'x': 0.92, 'y': -0.50, 'z': 1.0},
        'wheel': {'style': 'hubcap', 'rimFactor': 0.66},
    },
}
