# Moskvich-412 (1967-76). Factory: 4250 x 1550 x 1480, wheelbase 2400, tracks 1270,
# 6.45-13, clearance 175. Read off straight photographs on metric grids:
#   side   'Moskvich-412. Chilonzor-5, Tashkent, Uzbekistan 02.jpg' (CC BY-SA 4.0, 396 px/m)
#   front  'Moskvitch-412 izh in Elektrostal. img 07.jpg' (CC BY-SA 4.0)
#   rear   'Moskvitch-412 izh in Elektrostal. img 04.jpg' (CC BY-SA 4.0)
# A tall, narrow, flat-sided box: high flat bonnet and boot at belt height, an upright
# glasshouse, a full-width grille of vertical bars between round lamps, and long
# horizontal tail clusters under small amber fins.
CAR = {
    'id': 'moskvich412',
    'label': 'Moskvich-412',
    'kind': 'saloon',
    'factory': {'length': 4.25, 'width': 1.55, 'height': 1.48, 'clearance': 0.175, 'wheelbase': 2.4,
                'frontTrack': 1.27, 'rearTrack': 1.27, 'wheelRadius': 0.29, 'tyreWidth': 0.165, 'frontOverhang': 0.68},
    'trimEnds': 0.07,
    'deck': [[-2.06, 0.82], [-1.95, 0.90], [-1.75, 0.95], [-1.4, 0.985], [-0.92, 1.0], [-0.5, 1.0],
             [0.85, 1.0], [1.24, 1.0], [1.6, 1.0], [1.9, 0.99], [2.06, 0.96]],
    'belt': 1.0,
    'cabin': [-0.92, -0.64, 0.86, 1.24],
    'roof': [1.48, 1.43],
    'screenTop': 1.40,
    'widths': {'waist': 0.775, 'shoulder': 0.77, 'deckEdge': 0.75, 'glassDeck': 0.69, 'glass': 0.67,
               'railDeck': 0.56, 'railPillar': 0.64, 'rail': 0.60, 'sill': 0.73},
    'planFactor': [[-2.06, 0.95], [-1.98, 0.99], [-1.9, 1.0], [1.9, 1.0], [1.98, 0.99], [2.06, 0.96]],
    'sill': [[-2.06, 0.44], [-1.85, 0.34], [-1.6, 0.30], [1.55, 0.30], [1.8, 0.35], [2.06, 0.45]],
    'floor': [[-2.06, 0.42], [-1.85, 0.26], [-1.6, 0.22], [1.55, 0.22], [1.8, 0.27], [2.06, 0.43]],
    'waistZ': 0.62,
    'shoulderDrop': 0.05,
    'edgeDrop': 0.015,
    'windows': [[[-0.85, 1.0], [-0.62, 1.40], [-0.05, 1.40], [-0.05, 1.0]],
                [[0.02, 1.0], [0.02, 1.40], [0.58, 1.40], [0.83, 1.0]]],
    'arch': {'radiusFactor': 1.14, 'lift': 0.02, 'wellDepth': 0.3},
    'parts': {
        'headlamps': [[0.585, 0.65, 0.088]], 'bezel': 0.016,
        'grille': {'halfWidth': 0.51, 'z': [0.55, 0.77], 'slats': 2, 'bars': 34},
        'bumper': {'depth': 0.06, 'height': 0.08, 'standOff': 0.03, 'wrap': 0.2, 'halfWidth': 0.79,
                   'zFront': 0.45, 'zRear': 0.46},
        'doorHandles': [[-0.12, 0.84], [0.72, 0.84]],
        'windowFrame': 0.012,
        'lensColours': {'FrontLampLens': [0.80, 0.80, 0.76], 'PassiveRearLights': [0.6, 0.02, 0.02]},
        'lamps': [
            {'node': 'front_blinker_left', 'material': 'FrontLampLens', 'end': 'front', 'shape': 'rect', 'x': 0.72, 'z': 0.55, 'w': 0.08, 'h': 0.05},
            {'node': 'front_blinker_right', 'material': 'FrontLampLens', 'end': 'front', 'shape': 'rect', 'x': 0.72, 'z': 0.55, 'w': 0.08, 'h': 0.05},
            {'node': 'taillights', 'material': 'TailLights', 'end': 'rear', 'shape': 'rect', 'x': 0.645, 'z': 0.68, 'w': 0.25, 'h': 0.085},
            {'node': 'rear_passive', 'material': 'PassiveRearLights', 'end': 'rear', 'shape': 'rect', 'x': 0.585, 'z': 0.68, 'w': 0.05, 'h': 0.09, 'depth': 0.022},
            {'node': 'reverse_lights', 'material': 'ReverseLights', 'end': 'rear', 'shape': 'rect', 'x': 0.46, 'z': 0.68, 'w': 0.10, 'h': 0.085},
            {'node': 'rear_blinker_left', 'material': 'IndicatorLights', 'end': 'rear', 'shape': 'rect', 'x': 0.74, 'z': 0.83, 'w': 0.05, 'h': 0.12},
            {'node': 'rear_blinker_right', 'material': 'IndicatorLights', 'end': 'rear', 'shape': 'rect', 'x': 0.74, 'z': 0.83, 'w': 0.05, 'h': 0.12},
        ],
        'mirror': {'x': 0.82, 'y': -0.75, 'z': 1.03},
        'wheel': {'style': 'hubcap', 'rimFactor': 0.62},
    },
}
