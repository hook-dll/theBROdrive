# BMW 2002 (1968-76). Factory: 4230 x 1590 x 1410, wheelbase 2500, tracks 1330,
# 165 SR 13. Read off a straight profile photograph on a metric grid (354 px/m):
#   side   'Orange 1600-2 (8201642485).jpg' (CC BY 2.0)
#   front  'BMW 2002 (16099944364).jpg' (CC BY 2.0)
#   rear   '1970 BMW 2002 Rear 2017.8.25.jpg' (CC BY-SA 4.0)
# A two-door box with a low waist and a tall, thin-pillared glasshouse: the bonnet
# falls to a shark nose, the boot sits higher than the bonnet, chrome strip along the
# shoulder, round lamps either side of a wide grille with the twin kidneys in it.
CAR = {
    'id': 'bmw2002',
    'label': 'BMW 2002',
    'kind': 'saloon',
    'factory': {'length': 4.23, 'width': 1.59, 'height': 1.41, 'clearance': 0.16, 'wheelbase': 2.5,
                'frontTrack': 1.33, 'rearTrack': 1.33, 'wheelRadius': 0.29, 'tyreWidth': 0.165, 'frontOverhang': 0.66},
    'trimEnds': 0.13,
    'deck': [[-1.985, 0.73], [-1.8, 0.78], [-1.5, 0.83], [-1.2, 0.865], [-0.89, 0.895], [-0.5, 0.925],
             [0.7, 0.97], [1.14, 1.0], [1.5, 1.0], [1.9, 0.985], [1.985, 0.95]],
    'belt': 0.93,
    'cabin': [-0.89, -0.52, 0.75, 1.14],
    'roof': [1.41, 1.37],
    'screenTop': 1.32,
    'crown': 0.015,
    'widths': {'waist': 0.795, 'shoulder': 0.785, 'deckEdge': 0.765, 'glassDeck': 0.70, 'glass': 0.68,
               'railDeck': 0.57, 'railPillar': 0.64, 'rail': 0.60, 'sill': 0.75},
    'planFactor': [[-1.985, 0.95], [-1.9, 0.99], [-1.8, 1.0], [1.85, 1.0], [1.95, 0.99], [1.985, 0.97]],
    'sill': [[-1.985, 0.40], [-1.8, 0.33], [-1.55, 0.29], [1.6, 0.29], [1.85, 0.38], [1.985, 0.46]],
    'floor': [[-1.985, 0.38], [-1.8, 0.24], [-1.55, 0.20], [1.6, 0.20], [1.85, 0.30], [1.985, 0.44]],
    'waistZ': 0.62,
    'shoulderDrop': 0.07,
    'windows': [[[-0.76, 0.93], [-0.52, 1.32], [0.12, 1.32], [0.12, 0.95]],
                [[0.16, 0.955], [0.16, 1.32], [0.62, 1.32], [0.82, 0.98]]],
    'arch': {'radiusFactor': 1.13, 'lift': 0.02, 'wellDepth': 0.3},
    'parts': {
        'headlamps': [[0.58, 0.66, 0.085]], 'bezel': 0.014,
        'grille': {'halfWidth': 0.47, 'z': [0.58, 0.72], 'slats': 0, 'bars': 26, 'slatMaterial': 'trim',
                   'kidneys': {'gap': 0.03, 'w': 0.09, 'h': 0.17, 'z': 0.66}},
        'bumper': {'depth': 0.05, 'height': 0.06, 'standOff': 0.03, 'wrap': 0.25, 'halfWidth': 0.79,
                   'zFront': 0.47, 'zRear': 0.47},
        'doorHandles': [[0.05, 0.86]],
        'windowFrame': 0.012,
        'lamps': [
            {'node': 'front_blinker_left', 'material': 'IndicatorLights', 'end': 'front', 'shape': 'rect', 'x': 0.69, 'z': 0.54, 'w': 0.10, 'h': 0.04},
            {'node': 'front_blinker_right', 'material': 'IndicatorLights', 'end': 'front', 'shape': 'rect', 'x': 0.69, 'z': 0.54, 'w': 0.10, 'h': 0.04},
            {'node': 'front_blinker_left', 'material': 'IndicatorLights', 'end': 'side', 'shape': 'rect', 'y': -1.82, 'z': 0.62, 'w': 0.08, 'h': 0.03, 'depth': 0.012},
            {'node': 'front_blinker_right', 'material': 'IndicatorLights', 'end': 'side', 'shape': 'rect', 'y': -1.82, 'z': 0.62, 'w': 0.08, 'h': 0.03, 'depth': 0.012},
            {'node': 'taillights', 'material': 'TailLights', 'end': 'rear', 'shape': 'disc', 'x': 0.60, 'z': 0.72, 'r': 0.075},
            {'node': 'rear_blinker_left', 'material': 'IndicatorLights', 'end': 'rear', 'shape': 'rect', 'x': 0.60, 'z': 0.60, 'w': 0.10, 'h': 0.04},
            {'node': 'rear_blinker_right', 'material': 'IndicatorLights', 'end': 'rear', 'shape': 'rect', 'x': 0.60, 'z': 0.60, 'w': 0.10, 'h': 0.04},
            {'node': 'reverse_lights', 'material': 'ReverseLights', 'end': 'rear', 'shape': 'rect', 'x': 0.45, 'z': 0.60, 'w': 0.07, 'h': 0.04},
        ],
        'mirror': {'x': 0.83, 'y': -0.62, 'z': 0.98},
        'wheel': {'style': 'hubcap', 'rimFactor': 0.7},
    },
}
