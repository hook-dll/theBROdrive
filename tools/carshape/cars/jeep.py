# Jeep CJ-5 (1955-71, Hurricane four). Factory: 3440 x 1740 x 1700 (soft top), wheelbase
# 2057, tracks 1234, 6.00-16, clearance 210. No orthographic drawing found; dimensions
# from the factory data, shapes read off a straight side photograph on Commons ('1979
# Jeep CJ Silver Anniversary edition at Hershey 2015 AACA show 3of7.jpg', CC BY-SA 4.0)
# and the Willys MB drawing at 3dcar.ru for the grille face.
# The utility: a narrow flat-sided tub with the rear arches cut in it, rounded front wings
# sweeping down to the step, a flat bonnet over the seven-slot grille with the lamps in
# it, an upright screen, a canvas top and soft doors.
CAR = {
    'id': 'jeep',
    'label': 'Jeep CJ-5',
    'kind': 'estate',
    'factory': {'length': 3.44, 'width': 1.74, 'height': 1.70, 'clearance': 0.21, 'wheelbase': 2.057,
                'frontTrack': 1.234, 'rearTrack': 1.234, 'wheelRadius': 0.37, 'tyreWidth': 0.16, 'frontOverhang': 0.55},
    'yRange': [-1.66, 1.60],
    'trimEnds': 0.03,
    'deck': [[-1.66, 0.95], [-1.62, 1.01], [-1.4, 1.04], [-0.30, 1.07], [-0.1, 1.03], [1.60, 1.02]],
    'belt': 1.03,
    'cabin': [-0.30, -0.22, 1.56, 1.60],
    'roof': [1.70, 1.68],
    'screenTop': 1.62,
    'crown': 0.01,
    'roofCrown': 0.04,
    'trimRegions': [{'panel': 'rail-topCentre', 'y': [-0.22, 1.60]}, {'panel': 'glassBase-rail', 'y': [-0.22, 1.60]},
                    {'panel': 'tail', 'zMin': 1.03}],
    'rearScreen': False,
    'widths': {'waist': 0.74, 'shoulder': 0.74, 'deckEdge': 0.72, 'glassDeck': 0.73, 'glass': 0.72,
               'railDeck': 0.70, 'railPillar': 0.72, 'rail': 0.70, 'sill': 0.73},
    'planFactor': [[-1.66, 0.64], [-0.9, 0.72], [-0.48, 0.76], [-0.38, 1.0], [1.60, 1.0]],
    'sill': [[-1.66, 0.62], [-0.48, 0.56], [-0.38, 0.50], [1.60, 0.52]],
    'floor': [[-1.66, 0.58], [-0.48, 0.50], [-0.38, 0.45], [1.60, 0.47]],
    'waistZ': 0.80,
    'shoulderDrop': 0.01,
    'edgeDrop': 0.01,
    'shoulderRound': 0.03,
    'hatchLip': 0.02,
    'smoothAngleDeg': 22,
    'windows': [[[-0.15, 1.12], [-0.15, 1.52], [0.40, 1.52], [0.40, 1.12]],
                [[0.58, 1.14], [0.58, 1.52], [1.45, 1.52], [1.45, 1.14]]],
    'arch': {'radiusFactor': 1.22, 'lift': 0.02, 'wellDepth': 0.3},
    'parts': {
        'wings': [
            {'axle': 'front', 'inner': 0.45, 'outer': 0.87, 'radius': 0.47, 'lift': 0.02,
             'path': [[-1.62, 0.62], [-1.645, 0.93], [-1.60, 0.995], [-1.2, 1.01], [-0.82, 1.025], [-0.66, 0.97], [-0.55, 0.85], [-0.47, 0.68], [-0.42, 0.52]],
             'crown': 0.03, 'thickness': 0.04},
        ],
        'headlamps': [[0.39, 0.86, 0.085]], 'bezel': 0.014,
        'grille': {'halfWidth': 0.27, 'z': [0.62, 0.98], 'slats': 0, 'bars': 6, 'surround': False},
        'bumper': {'depth': 0.08, 'height': 0.12, 'standOff': 0.08, 'wrap': 0.02, 'halfWidth': 0.80,
                   'zFront': 0.55, 'zRear': 0.52, 'material': 'trim'},
        'doorHandles': [],
        'windowFrame': 0.012,
        'lensColours': {'FrontLampLens': [0.9, 0.62, 0.25]},
        'lamps': [
            {'node': 'front_blinker_left', 'material': 'FrontLampLens', 'end': 'front', 'shape': 'disc', 'x': 0.39, 'z': 0.71, 'r': 0.035},
            {'node': 'front_blinker_right', 'material': 'FrontLampLens', 'end': 'front', 'shape': 'disc', 'x': 0.39, 'z': 0.71, 'r': 0.035},
            {'node': 'taillights', 'material': 'TailLights', 'end': 'rear', 'shape': 'rect', 'x': 0.66, 'z': 0.86, 'w': 0.07, 'h': 0.08},
            {'node': 'rear_blinker_left', 'material': 'TailLights', 'end': 'rear', 'shape': 'rect', 'x': 0.66, 'z': 0.78, 'w': 0.07, 'h': 0.06},
            {'node': 'rear_blinker_right', 'material': 'TailLights', 'end': 'rear', 'shape': 'rect', 'x': 0.66, 'z': 0.78, 'w': 0.07, 'h': 0.06},
            {'node': 'reverse_lights', 'material': 'ReverseLights', 'end': 'rear', 'shape': 'rect', 'x': 0.66, 'z': 0.71, 'w': 0.07, 'h': 0.04},
        ],
        'mirror': {'x': 0.80, 'y': -0.28, 'z': 1.15},
        'tailWindow': {'halfWidth': 0.45, 'z': [1.20, 1.55]},
        'spareWheel': {'x': -0.35, 'z': 0.92, 'r': 0.37},
        'wheel': {'style': 'steel', 'windows': 0, 'rimFactor': 0.62},
    },
}
