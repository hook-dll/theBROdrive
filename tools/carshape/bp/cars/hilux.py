# Toyota Hilux N40 short bed (1979-83). Factory: 4305 x 1610 x 1580, wheelbase 2585,
# tracks 1300/1275, 185R14, clearance 190. The side and plan of the 1978 Hilux EC (short
# bed) at getoutlines.com (4x upscaled, 429 px/m by the wheelbase; the side read off by
# hand), which puts the front axle 0.66 behind the bumper. The plain little pickup: a
# long flat bonnet over a full-width grille with round lamps in square bezels, a raked
# screen, a short cab, a flat-sided open bed with its rails at the belt, chrome bumpers.
BOX = [[0.28, 0.76], [0.38, 0.80], [0.98, 0.80], [1.03, 0.77], [1.38, 0.70], [1.42, 0.5], [1.45, 0.2]]
CAR = {
    'id': 'hilux',
    'label': 'Toyota Hilux',
    'factory': {'length': 4.305, 'width': 1.61, 'height': 1.58, 'clearance': 0.19, 'wheelbase': 2.585,
                'frontTrack': 1.3, 'rearTrack': 1.275, 'wheelRadius': 0.31, 'tyreWidth': 0.185, 'frontOverhang': 0.66},
    'blueprint': {
        'image': 'hilux_go.png',
        'dark': 140,
        'side': {'box': [0, 0, 1956, 650], 'nose': 'right', 'wheels': [[536, 496], [1644, 496]], 'ground': 630, 'isotropic': True,
                 'outline': [[-2.146, 0.537], [-2.146, 0.434], [-2.043, 0.406], [-1.856, 0.35], [-1.133, 0.313], [0.103, 0.294], [1.457, 0.434], [2.133, 0.434], [2.18, 0.467], [2.18, 0.98], [2.157, 1.003], [0.057, 1.003], [0.043, 1.4], [0.01, 1.433], [-0.597, 1.433], [-0.643, 1.4], [-1.017, 1.003], [-1.087, 0.98], [-1.926, 0.887], [-2.034, 0.84], [-2.08, 0.77], [-2.071, 0.583]]},
        'top': {'box': [30, 670, 1910, 1340], 'nose': 'right', 'fitWidth': True},
    },
    'hull': {
        'bumpers': {'front': {'z': [0.43, 0.545]}, 'rear': {'z': [0.42, 0.50]}},
        'sill': [[-2.15, 0.43], [-1.85, 0.36], [-1.0, 0.33], [0.1, 0.32], [1.45, 0.44], [2.18, 0.45]],
        'sectionStations': [{'y': -2.05, 'half': BOX}, {'y': 2.15, 'half': BOX}],
        # The open bed: its floor, the walls stand on it as parts.
        'topOverride': [[0.10, 0.70], [2.17, 0.70]],
        'topCross': [
            {'y': -2.15, 'z': [[0.0, 0.88], [0.70, 0.87], [0.80, 0.82]]},
            {'y': -1.03, 'z': [[0.0, 1.0], [0.70, 0.99], [0.80, 0.95]]},
        ],
        'cabin': [-1.03, 0.06],
        'belt': [[-1.03, 1.0], [0.06, 1.0]],
        'glassPlan': [[-1.03, 0.68], [0.06, 0.70]],
        'roofHalf': 0.66,
        'roofCrown': 0.03,
        'edge': 0.012,
        'arch': {'radius': 0.40, 'lift': 0.03},
    },
    'parts': {
        'underbody': {'frame': True},
        'glass': [
            {'view': 'side', 'outline': [[-0.13, 1.33], [-0.62, 1.33], [-0.88, 1.02], [-0.13, 1.02]], 'facingMin': 0.3},
            {'view': 'front', 'outline': [[0.0, 1.37], [0.58, 1.37], [0.66, 1.03], [0.0, 1.03]], 'depthRange': [-1.1, -0.5], 'facingMin': 0.2},
            {'view': 'rear', 'outline': [[0.0, 1.30], [0.55, 1.30], [0.57, 1.06], [0.0, 1.06]], 'depthRange': [-0.1, 0.2],
             'facingMin': 0.3, 'fit': False},
        ],
        'regions': [
            {'view': 'top', 'outline': [[0.14, 0.0], [0.14, 0.76], [2.14, 0.76], [2.14, 0.0]], 'material': 'trim', 'facingMin': 0.7},
        ],
        'decals': [
            {'view': 'front', 'rect': [[0.0, 0.73], [1.42, 0.22]], 'radius': 0.01, 'mirror': False, 'material': 'grille',
             'height': 0.004, 'depthRange': [-2.2, -1.8]},
            {'view': 'front', 'rect': [[0.60, 0.73], [0.21, 0.20]], 'radius': 0.015, 'material': 'chrome', 'height': 0.006,
             'depthRange': [-2.2, -1.8]},
            {'view': 'front', 'node': 'headlights', 'circle': [[0.60, 0.73], 0.08], 'material': 'Headlights', 'height': 0.010,
             'depthRange': [-2.2, -1.8]},
            {'view': 'front', 'node': 'front_blinker_left', 'rect': [[0.62, 0.48], [0.14, 0.05]], 'radius': 0.006,
             'material': 'IndicatorLights', 'height': 0.010, 'depthRange': [-2.25, -1.8]},
            {'view': 'front', 'node': 'front_blinker_right', 'rect': [[0.62, 0.48], [0.14, 0.05]], 'radius': 0.006,
             'material': 'IndicatorLights', 'height': 0.010, 'depthRange': [-2.25, -1.8]},
            {'view': 'front', 'rect': [[0.0, 0.73], [0.20, 0.05]], 'radius': 0.006, 'mirror': False, 'material': 'chrome',
             'height': 0.008, 'depthRange': [-2.2, -1.8]},
            {'view': 'rear', 'node': 'taillights', 'rect': [[0.70, 0.635], [0.12, 0.11]], 'radius': 0.006, 'material': 'TailLights',
             'height': 0.012, 'depthRange': [2.0, 2.3], 'facingMin': 0.3},
            {'view': 'rear', 'node': 'rear_blinker_left', 'rect': [[0.70, 0.535], [0.12, 0.07]], 'radius': 0.006,
             'material': 'IndicatorLights', 'height': 0.012, 'depthRange': [2.0, 2.3], 'facingMin': 0.3},
            {'view': 'rear', 'node': 'rear_blinker_right', 'rect': [[0.70, 0.535], [0.12, 0.07]], 'radius': 0.006,
             'material': 'IndicatorLights', 'height': 0.012, 'depthRange': [2.0, 2.3], 'facingMin': 0.3},
            {'view': 'rear', 'node': 'reverse_lights', 'rect': [[0.56, 0.62], [0.08, 0.05]], 'radius': 0.006,
             'material': 'ReverseLights', 'height': 0.012, 'depthRange': [2.0, 2.3], 'facingMin': 0.3},
            {'view': 'rear', 'rect': [[0.0, 0.60], [0.36, 0.12]], 'radius': 0.005, 'mirror': False, 'material': 'plate',
             'height': 0.006, 'depthRange': [2.0, 2.3], 'facingMin': 0.3},
        ],
        'bars': [
            {'view': 'front', 'span': [-0.46, 0.46], 'b': [0.65, 0.81], 'count': 4, 'width': 0.010, 'material': 'chrome',
             'height': 0.007, 'depthRange': [-2.2, -1.8]},
        ],
        'lines': [
            {'view': 'side', 'points': [[-0.993, 0.36], [-0.993, 1.0], [-0.06, 1.0], [-0.06, 0.36], [-0.993, 0.36]], 'width': 0.006},
            {'view': 'side', 'points': [[-2.05, 0.62], [2.16, 0.62]], 'width': 0.012, 'material': 'chrome', 'height': 0.003},
            {'view': 'side', 'points': [[-0.88, 1.02], [-0.62, 1.34], [-0.12, 1.34], [-0.12, 1.02]], 'width': 0.012,
             'material': 'chrome', 'height': 0.003},
            {'view': 'rear', 'points': [[0.0, 0.94], [0.76, 0.94]], 'width': 0.006, 'depthRange': [2.0, 2.3], 'facingMin': 0.3},
        ],
        'boxes': [
            # Bed walls standing on its floor, the tailgate, the cab's back.
            {'c': [0.78, 1.14, 0.85], 'size': [0.04, 2.06, 0.30], 'material': 'paint'},
            {'c': [0.0, 2.155, 0.85], 'size': [1.56, 0.05, 0.30], 'mirror': False, 'material': 'paint'},
            {'c': [0.0, 0.13, 0.85], 'size': [1.56, 0.06, 0.30], 'mirror': False, 'material': 'paint'},
        ],
        'bumpers': {
            'front': {'z': [0.44, 0.54], 'depth': 0.06, 'wrap': 0.25, 'profile': 'blade', 'standOff': -0.07},
            'rear': {'z': [0.42, 0.50], 'depth': 0.06, 'wrap': 0.10, 'profile': 'blade', 'standOff': -0.07},
        },
        'mirror': {'y': -0.85, 'z': 1.08, 'reach': 0.93, 'w': 0.12, 'h': 0.10},
        'handles': {'at': [[-0.18, 0.92]], 'w': 0.12},
        'wipers': {'arms': [[-0.55, -0.05, -1.04, 1.03], [0.05, 0.5, -1.04, 1.03]]},
        'wheel': {'style': 'hubcap', 'rimFactor': 0.64, 'cap': 0.62},
    },
}
