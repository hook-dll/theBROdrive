# Peugeot 205 GTI 1.6 (1984-87). Factory: 3705 x 1572 x 1355, wheelbase 2420, overhangs
# 680/605, tracks 1393/1332, 185/60 R14. Read off the dimensioned drawing reprinted at
# 3dcar.ru/blueprints/peugeot/205_gti (226 px/m by the wheelbase; heights scaled 4% to
# the stated 1355). The small hot hatch: a sloping bonnet over a slim grille between
# rectangular lamps, a wide-windowed cabin, a near-vertical tailgate, black bumpers and
# side strips.
CAR = {
    'id': 'peugeot205',
    'label': 'Peugeot 205 GTI',
    'kind': 'hatchback',
    'factory': {'length': 3.705, 'width': 1.572, 'height': 1.355, 'clearance': 0.108, 'wheelbase': 2.42,
                'frontTrack': 1.393, 'rearTrack': 1.332, 'wheelRadius': 0.29, 'tyreWidth': 0.185, 'frontOverhang': 0.68},
    'yRange': [-1.80, 1.80],
    'deck': [[-1.80, 0.51], [-1.69, 0.69], [-1.17, 0.81], [-0.77, 0.86], [-0.3, 0.855], [1.09, 0.88],
             [1.62, 1.08], [1.80, 0.72]],
    'belt': 0.85,
    'cabin': [-0.77, -0.21, 1.09, 1.62],
    'roof': [1.355, 1.32],
    'screenTop': 1.29,
    'topLine': [[-0.77, 0.87], [-0.5, 1.12], [-0.21, 1.31], [0.16, 1.355], [1.09, 1.35], [1.35, 1.22], [1.62, 1.08], [1.80, 0.95]],
    'railLine': [[-0.77, 0.865], [-0.5, 1.10], [-0.21, 1.28], [0.16, 1.32], [1.09, 1.32], [1.35, 1.20], [1.62, 1.06], [1.80, 0.93]],
    'crown': 0.012,
    'widths': {'waist': 0.786, 'shoulder': 0.775, 'deckEdge': 0.75, 'glassDeck': 0.67, 'glass': 0.65,
               'railDeck': 0.55, 'railPillar': 0.61, 'rail': 0.59, 'sill': 0.74},
    'planFactor': [[-1.80, 0.95], [-1.7, 1.0], [1.72, 1.0], [1.80, 0.98]],
    'sill': [[-1.80, 0.34], [-1.5, 0.26], [-1.2, 0.22], [1.0, 0.22], [1.4, 0.26], [1.80, 0.34]],
    'floor': [[-1.80, 0.32], [-1.5, 0.16], [-1.2, 0.12], [1.0, 0.12], [1.4, 0.16], [1.80, 0.32]],
    'waistZ': 0.55,
    'shoulderDrop': 0.04,
    'shoulderRound': 0.1,
    'hatchLip': 0.08,
    'windows': [[[-0.48, 0.85], [-0.12, 1.29], [0.52, 1.29], [0.52, 0.85]],
                [[0.56, 0.86], [0.56, 1.29], [0.95, 1.29], [1.05, 1.18], [1.05, 0.88]]],
    'arch': {'radiusFactor': 1.17, 'lift': 0.02, 'wellDepth': 0.3},
    'parts': {
        'headlamps': [{'shape': 'rect', 'x': 0.55, 'z': 0.58, 'w': 0.22, 'h': 0.10}], 'bezel': 0.006, 'bezelMaterial': 'trim',
        'grille': {'halfWidth': 0.38, 'z': [0.55, 0.64], 'slats': 3, 'slatMaterial': 'trim', 'surround': False},
        'bumper': {'depth': 0.10, 'height': 0.15, 'standOff': 0.0, 'wrap': 0.35, 'halfWidth': 0.78,
                   'zFront': 0.42, 'zRear': 0.45, 'material': 'trim'},
        'doorHandles': [[0.40, 0.80]],
        'windowFrame': 0.01,
        'lamps': [
            {'node': 'front_blinker_left', 'material': 'IndicatorLights', 'end': 'front', 'shape': 'rect', 'x': 0.72, 'z': 0.58, 'w': 0.05, 'h': 0.10},
            {'node': 'front_blinker_right', 'material': 'IndicatorLights', 'end': 'front', 'shape': 'rect', 'x': 0.72, 'z': 0.58, 'w': 0.05, 'h': 0.10},
            {'node': 'taillights', 'material': 'TailLights', 'end': 'rear', 'shape': 'rect', 'x': 0.66, 'z': 0.66, 'w': 0.12, 'h': 0.10},
            {'node': 'rear_blinker_left', 'material': 'IndicatorLights', 'end': 'rear', 'shape': 'rect', 'x': 0.66, 'z': 0.74, 'w': 0.12, 'h': 0.04},
            {'node': 'rear_blinker_right', 'material': 'IndicatorLights', 'end': 'rear', 'shape': 'rect', 'x': 0.66, 'z': 0.74, 'w': 0.12, 'h': 0.04},
            {'node': 'reverse_lights', 'material': 'ReverseLights', 'end': 'rear', 'shape': 'rect', 'x': 0.66, 'z': 0.59, 'w': 0.12, 'h': 0.03},
        ],
        'mirror': {'x': 0.82, 'y': -0.50, 'z': 0.92},
        'wheel': {'style': 'hubcap', 'rimFactor': 0.72},
    },
}
