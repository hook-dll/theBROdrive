# Volvo 240 GL (1986-93). Factory: 4790 x 1710 x 1435, wheelbase 2640, tracks
# 1420/1360, 185/70 R14. Read off straight photographs on metric grids:
#   side   '1990 Volvo 240 GL 2.3 Side.jpg' (CC BY-SA 4.0, 387 px/m)
#   rear   '1990 Volvo 240 GL 2.3 Rear.jpg' (CC BY-SA 4.0)
# The brick: a flat bonnet and boot level with the sills of the windows, an upright
# glasshouse with a thick C pillar, black safety bumpers well clear of the body, and
# wide two-row tail clusters wrapping the rear corners.
CAR = {
    'id': 'volvo240',
    'label': 'Volvo 240',
    'kind': 'saloon',
    'factory': {'length': 4.79, 'width': 1.71, 'height': 1.435, 'clearance': 0.14, 'wheelbase': 2.64,
                'frontTrack': 1.42, 'rearTrack': 1.36, 'wheelRadius': 0.305, 'tyreWidth': 0.185, 'frontOverhang': 0.84},
    'trimEnds': 0.13,
    'deck': [[-2.265, 0.87], [-2.2, 0.895], [-2.0, 0.925], [-1.5, 0.985], [-0.93, 1.02], [-0.5, 1.02],
             [0.95, 1.02], [1.26, 1.0], [1.5, 0.99], [2.0, 0.97], [2.265, 0.945]],
    'belt': 1.0,
    'cabin': [-0.92, -0.52, 0.98, 1.26],
    'roof': [1.435, 1.395],
    'screenTop': 1.37,
    'crown': 0.008,
    'widths': {'waist': 0.855, 'shoulder': 0.85, 'deckEdge': 0.835, 'glassDeck': 0.75, 'glass': 0.73,
               'railDeck': 0.62, 'railPillar': 0.70, 'rail': 0.66, 'sill': 0.81},
    'planFactor': [[-2.265, 0.985], [-2.2, 1.0], [2.2, 1.0], [2.265, 0.99]],
    'sill': [[-2.265, 0.45], [-2.0, 0.36], [-1.75, 0.32], [1.75, 0.32], [2.0, 0.37], [2.265, 0.44]],
    'floor': [[-2.265, 0.42], [-2.0, 0.27], [-1.75, 0.22], [1.75, 0.22], [2.0, 0.27], [2.265, 0.42]],
    'waistZ': 0.66,
    'shoulderDrop': 0.04,
    'edgeDrop': 0.012,
    'shoulderRound': 0.08,
    'smoothAngleDeg': 26,
    'windows': [[[-0.84, 1.0], [-0.47, 1.37], [0.0, 1.37], [0.0, 1.0]],
                [[0.07, 1.0], [0.07, 1.37], [0.86, 1.37], [1.15, 1.0]]],
    'arch': {'radiusFactor': 1.13, 'lift': 0.03, 'wellDepth': 0.3},
    'parts': {
        'headlamps': [{'shape': 'rect', 'x': 0.56, 'z': 0.73, 'w': 0.30, 'h': 0.16}], 'bezel': 0.012,
        'bezelMaterial': 'chrome',
        'grille': {'halfWidth': 0.38, 'z': [0.62, 0.84], 'slats': 0, 'bars': 13},
        'bumper': {'depth': 0.16, 'height': 0.14, 'standOff': 0.07, 'wrap': 0.32, 'halfWidth': 0.86,
                   'zFront': 0.48, 'zRear': 0.48, 'material': 'trim'},
        'doorHandles': [[-0.18, 0.88], [0.68, 0.88]],
        'windowFrame': 0.014,
        'lensColours': {'FrontLampLens': [0.85, 0.85, 0.82]},
        'lamps': [
            {'node': 'front_blinker_left', 'material': 'IndicatorLights', 'end': 'front', 'shape': 'rect', 'x': 0.79, 'z': 0.73, 'w': 0.12, 'h': 0.16},
            {'node': 'front_blinker_right', 'material': 'IndicatorLights', 'end': 'front', 'shape': 'rect', 'x': 0.79, 'z': 0.73, 'w': 0.12, 'h': 0.16},
            {'node': 'rear_blinker_left', 'material': 'IndicatorLights', 'end': 'rear', 'shape': 'rect', 'x': 0.745, 'z': 0.705, 'w': 0.17, 'h': 0.075},
            {'node': 'rear_blinker_right', 'material': 'IndicatorLights', 'end': 'rear', 'shape': 'rect', 'x': 0.745, 'z': 0.705, 'w': 0.17, 'h': 0.075},
            {'node': 'reverse_lights', 'material': 'ReverseLights', 'end': 'rear', 'shape': 'rect', 'x': 0.61, 'z': 0.705, 'w': 0.09, 'h': 0.075},
            {'node': 'taillights', 'material': 'TailLights', 'end': 'rear', 'shape': 'rect', 'x': 0.515, 'z': 0.705, 'w': 0.10, 'h': 0.075},
            {'node': 'taillights', 'material': 'TailLights', 'end': 'rear', 'shape': 'rect', 'x': 0.64, 'z': 0.62, 'w': 0.37, 'h': 0.08},
        ],
        'mirror': {'x': 0.90, 'y': -0.72, 'z': 1.08},
        'wheel': {'style': 'hubcap', 'rimFactor': 0.76},
    },
}
