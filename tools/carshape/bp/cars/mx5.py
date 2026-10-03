# Mazda MX-5 1.6 (NA, 1989-97). Factory: 3970 x 1675 x 1230 (soft top up), wheelbase
# 2265, tracks 1410/1430, 185/60 R14, clearance 135. The Eunos Roadster drawing at
# getoutlines.com (CC, 2x upscaled), drawn open: the soft top is put up over it, its
# line from photographs of the car with the hood raised.
CAR = {
    'id': 'mx5',
    'label': 'Mazda MX-5',
    'factory': {'length': 3.97, 'width': 1.675, 'height': 1.23, 'clearance': 0.135, 'wheelbase': 2.265,
                'frontTrack': 1.41, 'rearTrack': 1.43, 'wheelRadius': 0.285, 'tyreWidth': 0.185, 'frontOverhang': 0.81},
    'blueprint': {
        'image': 'mx5_go.png',
        'side': {'box': [14, 14, 1135, 346], 'nose': 'left', 'isotropic': True, 'wheels': [[242.5, 261.5], [880.5, 261.5]], 'ground': 341.5},
        'top': {'box': [14, 354, 1139, 880], 'nose': 'left'},
        # Drawn open: the end views' top is the screen header, 1.14 m.
        'front': {'box': [1136, 6, 1657, 343], 'height': 1.14},
        'rear': {'box': [1154, 450, 1681, 791], 'height': 1.14},
    },
    'hull': {
        # The hood up: from the screen's header (1.12) it rises gently to its crown and
        # falls to the deck; a step at the header made it a slab laid on the car.
        'topOverride': [[-0.75, 0.83], [-0.55, 0.88], [-0.35, 1.0], [-0.20, 1.10], [-0.08, 1.155], [0.05, 1.195],
                        [0.20, 1.222], [0.50, 1.215], [0.70, 1.15], [0.90, 0.98], [1.05, 0.86], [1.15, 0.83]],
        'sectionExtendTop': 0.56,
        'sill': [[-2.0, 0.30], [-1.7, 0.27], [-1.3, 0.23], [0.8, 0.23], [1.2, 0.26], [1.95, 0.30]],
        'cabin': [-0.72, 1.12],
        'belt': [[-0.72, 0.82], [-0.4, 0.78], [0.6, 0.78], [1.12, 0.82]],
        # The hood stands nearly upright from a wide base, 1.05 m across at its top
        # (photos of the NA from behind); the drawing's open-car end view, held at its
        # topmost width, tapered it to 0.86, a narrow tent on the deck.
        'glassPlan': [[-0.72, 0.66], [-0.3, 0.66], [0.3, 0.65], [0.8, 0.63], [1.12, 0.60]],
        'sectionKeys': [{'y': [-0.5, 1.0], 'blend': 0.2,
                         'half': [[0.20, 0.80], [0.40, 0.835], [0.60, 0.845], [0.75, 0.835], [0.80, 0.80], [0.84, 0.75],
                                  [0.88, 0.69], [0.94, 0.645], [1.02, 0.625], [1.10, 0.605], [1.17, 0.585], [1.23, 0.55],
                                  [1.26, 0.45]]}],
        'crown': [[-2.0, 0.025], [2.0, 0.025]],
        'roofCrown': 0.03,
        'edge': 0.016,
        'arch': {'radius': 0.33, 'lift': 0.05},
    },
    'parts': {
        'glass': [
            # The door glass runs up under the hood's side rail: its top edge is the hood's
            # lower edge (they overlapped and the glass's corners poked into the canvas).
            {'view': 'side', 'outline': [[-0.40, 0.80], [-0.15, 1.075], [0.34, 1.105], [0.38, 1.08], [0.40, 0.80]], 'facingMin': 0.3},
            # The screen stops at its header (it ran back over the hood's front slope and
            # down its shoulders as a light strip of glass).
            {'view': 'front', 'outline': [[0.0, 1.11], [0.44, 1.105], [0.48, 1.08], [0.58, 0.86], [0.56, 0.84], [0.0, 0.84]],
             'depthRange': [-0.9, -0.21], 'facingMin': 0.25},
            {'view': 'rear', 'outline': [[0.0, 1.10], [0.36, 1.095], [0.38, 1.07], [0.40, 0.93], [0.37, 0.91], [0.0, 0.91]],
             'depthRange': [0.6, 1.2], 'facingMin': 0.02, 'fit': False},
        ],
        # The soft top: black canvas over the cabin.
        'regions': [
            # the hood's front rail over the screen, facing forward: from the screen's top
            {'view': 'front', 'rect': [[0.0, 1.19], [1.40, 0.14]], 'mirror': False, 'depthRange': [-0.35, 0.15], 'facingMin': 0.0},
            {'view': 'top', 'rect': [[0.44, 0.0], [1.36, 1.6]], 'radius': 0.001, 'mirror': False, 'facingMin': 0.05,
             'depthRange': [0.95, 1.5]},
            {'view': 'side', 'outline': [[-0.22, 1.075], [-0.15, 1.075], [0.34, 1.105], [0.38, 1.08], [0.40, 0.80], [1.15, 0.84],
                                         [1.15, 1.30], [-0.12, 1.30]], 'facingMin': -1.0},
        ],
        'decals': [
            # The mouth: a wide oval intake low in the nose (photos).
            {'view': 'front', 'outline': [[0.0, 0.46], [0.24, 0.455], [0.33, 0.43], [0.36, 0.395], [0.33, 0.36], [0.24, 0.34], [0.0, 0.335]],
             'material': 'grille', 'height': 0.004, 'depthRange': [-2.1, -1.6], 'facingMin': 0.0},
            {'view': 'front', 'rect': [[0.0, 0.405], [0.30, 0.10]], 'radius': 0.006, 'mirror': False, 'material': 'plate',
             'height': 0.006, 'depthRange': [-2.1, -1.6]},
            # The oblong clear-lens parking and turn lamps in the nose's corners (the main
            # lamps pop up).
            {'view': 'front', 'node': 'headlights', 'rect': [[0.42, 0.585], [0.16, 0.05]], 'radius': 0.024,
             'material': 'Headlights', 'height': 0.009, 'depthRange': [-2.1, -1.5], 'facingMin': 0.1},
            {'view': 'front', 'node': 'front_blinker_left', 'rect': [[0.535, 0.585], [0.07, 0.05]], 'radius': 0.02,
             'material': 'IndicatorLights', 'height': 0.009, 'depthRange': [-2.1, -1.5], 'facingMin': 0.0},
            {'view': 'front', 'node': 'front_blinker_right', 'rect': [[0.535, 0.585], [0.07, 0.05]], 'radius': 0.02,
             'material': 'IndicatorLights', 'height': 0.009, 'depthRange': [-2.1, -1.5], 'facingMin': 0.0},
            # The pop-up lamps lie folded flush in the bonnet: their lids' outline.
            {'view': 'top', 'rect': [[-1.42, 0.53], [0.30, 0.20]], 'radius': 0.03, 'material': 'paint', 'height': 0.004},
            {'view': 'side', 'node': 'front_blinker_left', 'rect': [[-1.62, 0.52], [0.10, 0.03]], 'radius': 0.012, 'material': 'IndicatorLights', 'height': 0.005},
            {'view': 'side', 'node': 'front_blinker_right', 'rect': [[-1.62, 0.52], [0.10, 0.03]], 'radius': 0.012, 'material': 'IndicatorLights', 'height': 0.005},
            # Oval tail lamps running round the tail's corners in one piece, plate between.
            {'view': 'rear', 'node': 'taillights', 'rect': [[0.45, 0.715], [0.32, 0.12]], 'radius': 0.055,
             'material': 'TailLights', 'height': 0.008, 'depthRange': [1.6, 2.1], 'facingMin': -0.2},
            {'view': 'rear', 'node': 'rear_blinker_left', 'rect': [[0.43, 0.68], [0.12, 0.04]], 'radius': 0.015,
             'material': 'IndicatorLights', 'height': 0.010, 'depthRange': [1.6, 2.1]},
            {'view': 'rear', 'node': 'rear_blinker_right', 'rect': [[0.43, 0.68], [0.12, 0.04]], 'radius': 0.015,
             'material': 'IndicatorLights', 'height': 0.010, 'depthRange': [1.6, 2.1]},
            {'view': 'rear', 'node': 'reverse_lights', 'rect': [[0.36, 0.745], [0.08, 0.03]], 'radius': 0.012,
             'material': 'ReverseLights', 'height': 0.010, 'depthRange': [1.6, 2.1]},
            {'view': 'rear', 'rect': [[0.0, 0.715], [0.34, 0.16]], 'radius': 0.006, 'mirror': False, 'material': 'plate',
             'height': 0.006, 'depthRange': [1.6, 2.1]},
        ],
        'lines': [
            {'view': 'side', 'points': [[-0.62, 0.76], [-0.62, 0.32], [0.53, 0.32], [0.53, 0.78]], 'width': 0.005},
            {'view': 'top', 'points': [[-1.90, 0.55], [-0.75, 0.62]], 'width': 0.005},
            {'view': 'rear', 'points': [[0.0, 0.81], [0.62, 0.81]], 'width': 0.005, 'depthRange': [1.5, 2.1]},
        ],
        'mirror': {'y': -0.42, 'z': 0.88, 'reach': 0.95, 'w': 0.14, 'h': 0.075, 'material': 'paint', 'mount': 'door'},
        'handles': {'at': [[0.35, 0.69]], 'w': 0.10, 'material': 'chrome'},
        'wipers': {'arms': [[-0.5, -0.05, -0.68, 0.84], [0.05, 0.45, -0.68, 0.84]]},
        'wheel': {'style': 'alloy', 'spokes': 8, 'rimFactor': 0.68, 'spokeWidth': 0.35},
    },
}
