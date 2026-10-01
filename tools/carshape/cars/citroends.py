# Citroën DS 21 (1965-75). Factory: 4874 x 1803 x 1470, wheelbase 3125, overhangs
# 1016/733, tracks 1516/1316, 180 HR 15 front. Read off the drawing reprinted at
# 3dcar.ru/blueprints/citroen/ds (dimensioned; heights scaled 5% to the 1470 the
# drawing states). The goddess: a long falling shark nose with twin lamps in pods, a
# pillarless glasshouse under a roof that overhangs the rear window and carries the
# indicator trumpets, a tapering tail, skirts over the narrow-track rear wheels.
CAR = {
    'id': 'citroends',
    'label': 'Citroën DS',
    'kind': 'saloon',
    'factory': {'length': 4.874, 'width': 1.79, 'height': 1.47, 'clearance': 0.145, 'wheelbase': 3.125,
                'frontTrack': 1.516, 'rearTrack': 1.316, 'wheelRadius': 0.33, 'tyreWidth': 0.18, 'frontOverhang': 1.016},
    'trimEnds': 0.08,
    'deck': [[-2.357, 0.46], [-2.25, 0.62], [-2.08, 0.76], [-1.8, 0.84], [-1.51, 0.90], [-1.1, 0.98],
             [-0.78, 1.035], [0.4, 1.0], [1.45, 0.96], [1.8, 0.92], [2.1, 0.83], [2.357, 0.68]],
    'belt': 1.0,
    'cabin': [-0.78, -0.40, 1.15, 1.45],
    'roof': [1.465, 1.43],
    'screenTop': 1.36,
    'topLine': [[-0.78, 1.05], [-0.6, 1.27], [-0.40, 1.44], [0.2, 1.47], [0.9, 1.45], [1.15, 1.42],
                [1.3, 1.22], [1.45, 0.98]],
    'railLine': [[-0.78, 1.045], [-0.6, 1.25], [-0.40, 1.41], [0.2, 1.44], [0.9, 1.42], [1.15, 1.39],
                 [1.3, 1.20], [1.45, 0.975]],
    'crown': 0.035,
    'widths': {'waist': 0.895, 'shoulder': 0.87, 'deckEdge': 0.80, 'glassDeck': 0.74, 'glass': 0.71,
               'railDeck': 0.60, 'railPillar': 0.66, 'rail': 0.62, 'sill': 0.84},
    'planFactor': [[-2.357, 0.52], [-2.1, 0.80], [-1.6, 0.96], [-1.0, 1.0], [1.3, 1.0], [2.0, 0.88], [2.357, 0.74]],
    'sill': [[-2.357, 0.40], [-2.0, 0.30], [-1.6, 0.27], [1.7, 0.27], [2.1, 0.34], [2.357, 0.42]],
    'floor': [[-2.357, 0.36], [-2.0, 0.19], [-1.6, 0.15], [1.7, 0.15], [2.1, 0.22], [2.357, 0.38]],
    'waistZ': 0.62,
    'shoulderDrop': 0.12,
    'edgeDrop': 0.04,
    'shoulderRound': 0.35,
    'tumbleunder': 0.14,
    'smoothAngleDeg': 45,
    'windows': [[[-0.66, 1.0], [-0.38, 1.36], [0.33, 1.36], [0.33, 1.0]],
                [[0.39, 1.0], [0.39, 1.36], [1.10, 1.36], [1.25, 1.12], [1.25, 1.0]]],
    'arch': {'radiusFactor': 1.18, 'lift': 0.04, 'wellDepth': 0.3, 'rearSkirt': True},
    'parts': {
        'headlamps': [[0.50, 0.64, 0.075], [0.65, 0.64, 0.075]], 'bezel': 0.012,
        
        'bumper': {'depth': 0.05, 'height': 0.06, 'standOff': 0.02, 'wrap': 0.35, 'halfWidth': 0.85,
                   'zFront': 0.42, 'zRear': 0.45},
        'doorHandles': [[0.05, 0.98], [0.95, 0.98]],
        'windowFrame': 0.012,
        'lamps': [
            {'node': 'front_blinker_left', 'material': 'IndicatorLights', 'end': 'front', 'shape': 'rect', 'x': 0.80, 'z': 0.44, 'w': 0.08, 'h': 0.03},
            {'node': 'front_blinker_right', 'material': 'IndicatorLights', 'end': 'front', 'shape': 'rect', 'x': 0.80, 'z': 0.44, 'w': 0.08, 'h': 0.03},
            {'node': 'rear_blinker_left', 'material': 'IndicatorLights', 'end': 'rear', 'shape': 'disc', 'x': 0.56, 'z': 1.22, 'r': 0.035, 'y': 1.30},
            {'node': 'rear_blinker_right', 'material': 'IndicatorLights', 'end': 'rear', 'shape': 'disc', 'x': 0.56, 'z': 1.22, 'r': 0.035, 'y': 1.30},
            {'node': 'taillights', 'material': 'TailLights', 'end': 'rear', 'shape': 'rect', 'x': 0.50, 'z': 0.56, 'w': 0.16, 'h': 0.06},
            {'node': 'reverse_lights', 'material': 'ReverseLights', 'end': 'rear', 'shape': 'rect', 'x': 0.30, 'z': 0.56, 'w': 0.07, 'h': 0.06},
        ],
        'mirror': {'x': 0.92, 'y': -0.60, 'z': 1.08},
        'wheel': {'style': 'hubcap', 'rimFactor': 0.65},
    },
}
