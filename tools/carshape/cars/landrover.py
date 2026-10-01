# Land Rover Series III 88 soft top (1971-85). Factory: 3620 x 1680 x 1970, wheelbase
# 2235, tracks 1310, 6.00-16, clearance 210. Front end, bulkhead and cab read off the
# Series IIA 109 drawing reprinted at 3dcar.ru/blueprints/other/land_rover_iia_109_1970
# (182 px/m by its 2769 wheelbase) measured from the front axle; the tub from the rear
# axle, set on the 88's shorter wheelbase (the panels are the same).
# The tool: a flat bonnet between flat-topped wings that carry the lamps, a recessed
# grille panel, an upright framed screen on the bulkhead, a slab-sided cab and tub
# under a canvas tilt, the spare on the bonnet, a plain steel bumper.
CAR = {
    'id': 'landrover',
    'label': 'Land Rover 88',
    'kind': 'estate',
    'factory': {'length': 3.62, 'width': 1.68, 'height': 1.97, 'clearance': 0.21, 'wheelbase': 2.235,
                'frontTrack': 1.31, 'rearTrack': 1.31, 'wheelRadius': 0.37, 'tyreWidth': 0.16, 'frontOverhang': 0.56},
    'yRange': [-1.72, 1.81],
    'trimEnds': 0.03,
    'deck': [[-1.72, 1.05], [-1.70, 1.10], [-1.55, 1.16], [-1.0, 1.19], [-0.48, 1.22], [0.0, 1.20], [1.81, 1.19]],
    'belt': 1.20,
    'cabin': [-0.48, -0.26, 1.79, 1.81],
    'roof': [1.92, 1.90],
    'screenTop': 1.72,
    'crown': 0.01,
    'roofCrown': 0.05,
    'trimRegions': [{'panel': 'rail-topCentre', 'y': [0.62, 1.81]}, {'panel': 'glassBase-rail', 'y': [0.62, 1.81]}, {'panel': 'tail', 'zMin': 1.21}],
    'rearScreen': False,
    'widths': {'waist': 0.83, 'shoulder': 0.83, 'deckEdge': 0.80, 'glassDeck': 0.78, 'glass': 0.76,
               'railDeck': 0.72, 'railPillar': 0.74, 'rail': 0.72, 'sill': 0.82},
    'planFactor': [[-1.72, 0.70], [-0.52, 0.70], [-0.46, 1.0], [1.81, 1.0]],
    'sill': [[-1.72, 0.64], [-0.52, 0.60], [-0.46, 0.52], [1.81, 0.52]],
    'floor': [[-1.72, 0.60], [-0.52, 0.52], [-0.46, 0.47], [1.81, 0.47]],
    'waistZ': 0.90,
    'shoulderDrop': 0.01,
    'edgeDrop': 0.01,
    'shoulderRound': 0.02,
    'hatchLip': 0.02,
    'smoothAngleDeg': 20,
    'windows': [[[-0.40, 1.28], [-0.20, 1.68], [0.33, 1.68], [0.33, 1.28]],
                [[0.45, 1.30], [0.45, 1.62], [0.58, 1.62], [0.58, 1.30]]],
    'arch': {'radiusFactor': 1.10, 'lift': 0.0, 'wellDepth': 0.3},
    'parts': {
        'wings': [
            {'axle': 'front', 'inner': 0.40, 'outer': 0.84, 'radius': 0.50, 'lift': 0.0,
             'path': [[-1.73, 0.62], [-1.74, 0.99], [-1.69, 1.035], [-0.52, 1.05], [-0.50, 1.0], [-0.50, 0.56]],
             'crown': 0.01, 'thickness': 0.04},
        ],
        'headlamps': [[0.57, 0.86, 0.09]], 'bezel': 0.014,
        'grille': {'halfWidth': 0.30, 'z': [0.62, 1.02], 'slats': 5, 'bars': 7},
        'bumper': {'depth': 0.10, 'height': 0.09, 'standOff': 0.06, 'wrap': 0.02, 'halfWidth': 0.85,
                   'zFront': 0.55, 'zRear': 0.50, 'material': 'trim'},
        'doorHandles': [[0.22, 1.10]],
        'windowFrame': 0.02,
        'lensColours': {'FrontLampLens': [0.9, 0.62, 0.25]},
        'lamps': [
            {'node': 'front_blinker_left', 'material': 'FrontLampLens', 'end': 'front', 'shape': 'disc', 'x': 0.73, 'z': 0.74, 'r': 0.03},
            {'node': 'front_blinker_right', 'material': 'FrontLampLens', 'end': 'front', 'shape': 'disc', 'x': 0.73, 'z': 0.74, 'r': 0.03},
            {'node': 'rear_blinker_left', 'material': 'IndicatorLights', 'end': 'rear', 'shape': 'disc', 'x': 0.78, 'z': 1.02, 'r': 0.035},
            {'node': 'rear_blinker_right', 'material': 'IndicatorLights', 'end': 'rear', 'shape': 'disc', 'x': 0.78, 'z': 1.02, 'r': 0.035},
            {'node': 'taillights', 'material': 'TailLights', 'end': 'rear', 'shape': 'disc', 'x': 0.78, 'z': 0.93, 'r': 0.035},
            {'node': 'reverse_lights', 'material': 'ReverseLights', 'end': 'rear', 'shape': 'disc', 'x': 0.78, 'z': 0.85, 'r': 0.03},
        ],
        'mirror': {'x': 0.84, 'y': -0.51, 'z': 1.30},
        'spareWheel': {'end': 'bonnet', 'y': -1.15, 'r': 0.37},
        'wheel': {'style': 'steel', 'windows': 0, 'rimFactor': 0.62},
    },
}
