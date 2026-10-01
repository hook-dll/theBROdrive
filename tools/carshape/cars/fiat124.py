# Fiat 124 Berlina (1966-74). Factory: 4042 x 1625 x 1420, wheelbase 2420, tracks
# 1330/1300, 150 SR 13. Everything else read off straight photographs on metric grids
# (tools/carshape/photosheet.py, 365 px/m on the side profile):
#   side   'Fiat 124 1970 von Retrowerk at.jpg' (CC BY-SA 4.0, Wikimedia Commons)
#   front  'Fiat 124-Sedan Front-view.JPG' (public domain)
#   rear   'MHV Fiat 124 1967 02.JPG' (CC BY 3.0)
# The body on the photo is 3.84 m without bumpers; the factory length counts them.
CAR = {
    'id': 'fiat124',
    'label': 'Fiat 124',
    'kind': 'saloon',
    'factory': {'length': 4.042, 'width': 1.625, 'height': 1.42, 'clearance': 0.13, 'wheelbase': 2.42,
                'frontTrack': 1.33, 'rearTrack': 1.30, 'wheelRadius': 0.29, 'tyreWidth': 0.15, 'frontOverhang': 0.56},
    'trimEnds': 0.09,
    'deck': [[-1.93, 0.775], [-1.7, 0.80], [-1.46, 0.84], [-1.2, 0.885], [-0.93, 0.92], [-0.5, 0.955],
             [0.82, 0.958], [1.22, 0.958], [1.5, 0.95], [1.75, 0.935], [1.93, 0.92]],
    'belt': 0.956,
    'cabin': [-0.93, -0.62, 0.82, 1.22],
    'roof': [1.40, 1.335],
    'screenTop': 1.31,
    'widths': {'waist': 0.81, 'shoulder': 0.80, 'deckEdge': 0.78, 'glassDeck': 0.72, 'glass': 0.70,
               'railDeck': 0.58, 'railPillar': 0.66, 'rail': 0.62, 'sill': 0.75},
    'planFactor': [[-1.93, 0.94], [-1.85, 0.985], [-1.75, 1.0], [1.75, 1.0], [1.85, 0.985], [1.93, 0.95]],
    'sill': [[-1.93, 0.40], [-1.75, 0.33], [-1.55, 0.30], [1.55, 0.30], [1.75, 0.34], [1.93, 0.40]],
    'floor': [[-1.93, 0.38], [-1.75, 0.24], [-1.5, 0.19], [1.5, 0.19], [1.75, 0.25], [1.93, 0.38]],
    'waistZ': 0.55,
    'shoulderDrop': 0.06,
    'windows': [[[-0.822, 0.956], [-0.603, 1.31], [-0.06, 1.31], [-0.06, 0.956]],
                [[0.0, 0.956], [0.0, 1.31], [0.595, 1.31], [0.808, 0.956]]],
    'arch': {'radiusFactor': 1.12, 'lift': 0.02, 'wellDepth': 0.3},
    'parts': {
        'headlamps': [[0.62, 0.64, 0.088]], 'bezel': 0.018,
        'grille': {'halfWidth': 0.50, 'z': [0.55, 0.73], 'slats': 9},
        'bumper': {'depth': 0.06, 'height': 0.07, 'standOff': 0.03, 'wrap': 0.22, 'halfWidth': 0.80,
                   'zFront': 0.43, 'zRear': 0.48},
        'overriders': {'x': 0.30, 'height': 0.12, 'width': 0.035},
        'doorHandles': [[-0.13, 0.86], [0.75, 0.86]],
        'windowFrame': 0.012,
        'lensColours': {'FrontLampLens': [0.80, 0.80, 0.76], 'PassiveRearLights': [0.35, 0.03, 0.02]},
        'lamps': [
            {'node': 'front_blinker_left', 'material': 'FrontLampLens', 'end': 'front', 'shape': 'rect', 'x': 0.58, 'z': 0.515, 'w': 0.10, 'h': 0.04},
            {'node': 'front_blinker_right', 'material': 'FrontLampLens', 'end': 'front', 'shape': 'rect', 'x': 0.58, 'z': 0.515, 'w': 0.10, 'h': 0.04},
            {'node': 'front_blinker_left', 'material': 'IndicatorLights', 'end': 'side', 'shape': 'disc', 'y': -1.70, 'z': 0.66, 'r': 0.02, 'depth': 0.012},
            {'node': 'front_blinker_right', 'material': 'IndicatorLights', 'end': 'side', 'shape': 'disc', 'y': -1.70, 'z': 0.66, 'r': 0.02, 'depth': 0.012},
            {'node': 'taillights', 'material': 'TailLights', 'end': 'rear', 'shape': 'rect', 'x': 0.50, 'z': 0.64, 'w': 0.16, 'h': 0.10},
            {'node': 'rear_blinker_left', 'material': 'IndicatorLights', 'end': 'rear', 'shape': 'rect', 'x': 0.66, 'z': 0.64, 'w': 0.16, 'h': 0.10},
            {'node': 'rear_blinker_right', 'material': 'IndicatorLights', 'end': 'rear', 'shape': 'rect', 'x': 0.66, 'z': 0.64, 'w': 0.16, 'h': 0.10},
            {'node': 'rear_passive', 'material': 'PassiveRearLights', 'end': 'rear', 'shape': 'rect', 'x': 0.62, 'z': 0.565, 'w': 0.13, 'h': 0.035},
            {'node': 'reverse_lights', 'material': 'ReverseLights', 'end': 'rear', 'shape': 'rect', 'x': 0.62, 'z': 0.53, 'w': 0.13, 'h': 0.035},
        ],
        'wheel': {'style': 'hubcap', 'rimFactor': 0.66},
    },
}
