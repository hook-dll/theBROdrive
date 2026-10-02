# Mazda MX-5 1.6 (NA, 1989-97). Factory: 3970 x 1675 x 1230 (soft top up), wheelbase
# 2265, tracks 1410/1430, 185/60 R14, clearance 135. The Eunos Roadster drawing at
# getoutlines.com (CC, 2x upscaled), drawn open: the soft top is put up over it, its
# line from photographs of the car with the hood raised.
CAR = {
    'id': 'mx5_l',
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
        'topOverride': [[-0.75, 0.83], [-0.55, 0.88], [-0.35, 1.0], [-0.12, 1.13], [-0.02, 1.20], [0.15, 1.23], [0.50, 1.22],
                        [0.70, 1.15], [0.90, 0.98], [1.05, 0.86], [1.15, 0.83]],
        'sectionExtendTop': 0.56,
        'sill': [[-2.0, 0.30], [-1.7, 0.27], [-1.3, 0.23], [0.8, 0.23], [1.2, 0.26], [1.95, 0.30]],
        'cabin': [-0.72, 1.12],
        'belt': [[-0.72, 0.82], [-0.4, 0.78], [0.6, 0.78], [1.12, 0.82]],
        'glassPlan': [[-0.72, 0.66], [-0.3, 0.66], [0.3, 0.62], [0.8, 0.56], [1.12, 0.52]],
        'crown': [[-2.0, 0.025], [2.0, 0.025]],
        'roofCrown': 0.03,
        'edge': 0.016,
        'arch': {'radius': 0.33, 'lift': 0.05},
    },
    # The body traced off the drawing line for line (grid-*.png sheets: side
    # y=(px-810)/400, z=(460-py)/400; front x=(px-650)/700, z=(805-py)/704; rear
    # x=(px-650)/694, z=(797-py)/694; top y=(px-810)/400, x=(370-py)/400). The soft top's
    # line from photographs of the car with the hood raised, its section the rear view's.
    'trace': {
        'section': [[0, 0.15], [0.70, 0.15], [0.78, 0.16], [0.81, 0.20], [0.825, 0.30], [0.835, 0.45], [0.838, 0.55],
                    [0.83, 0.62], [0.81, 0.68], [0.78, 0.725], [0.72, 0.755], [0.60, 0.775], [0.40, 0.79], [0.20, 0.795],
                    [0, 0.80]],
        'houseSection': [[0, 0.70], [0.74, 0.70], [0.74, 0.76], [0.72, 0.82], [0.66, 0.95], [0.60, 1.03], [0.56, 1.06],
                         [0.46, 1.08], [0.36, 1.09], [0.18, 1.11], [0, 1.12]],
        'sill': [[-1.775, 0.19], [-1.45, 0.17], [-1.20, 0.15], [1.20, 0.15], [1.60, 0.17], [1.70, 0.20]],
        'deck': [[-1.99, 0.48], [-1.925, 0.54], [-1.775, 0.64], [-1.525, 0.74], [-1.275, 0.79],
                 [-1.025, 0.805], [-0.675, 0.80], [-0.55, 0.775], [-0.275, 0.755], [0.475, 0.76], [0.55, 0.775],
                 [0.975, 0.81], [1.225, 0.84], [1.60, 0.81], [1.79, 0.775]],
        'plan': [[-2.0, 0.30], [-1.97, 0.42], [-1.93, 0.52], [-1.875, 0.60], [-1.775, 0.69], [-1.65, 0.76], [-1.475, 0.80],
                 [-1.025, 0.825], [-0.525, 0.83], [0.475, 0.83], [1.225, 0.81], [1.60, 0.775], [1.80, 0.675],
                 [1.89, 0.50], [1.925, 0.30]],
        'nose': [[0.19, -1.875], [0.25, -1.94], [0.325, -1.975], [0.41, -2.0], [2.0, -2.0]],
        'tail': [[0.20, 1.70], [0.25, 1.80], [0.325, 1.875], [0.425, 1.90], [0.49, 1.86], [0.65, 1.85], [0.72, 1.84],
                 [0.775, 1.79], [2.0, 1.79]],
        'house': [-0.72, 1.15],
        'houseTail': [[0, 1.15], [9, 1.15]],
        'belt': [[-0.80, 0.70], [1.15, 0.70]],
        # The top's height over its length; the screen (and the hood's front edge rising
        # off its header) is the glasshouse's leaning front end.
        'roof': [[-0.80, 1.23], [0.15, 1.23], [0.50, 1.22], [0.70, 1.15], [0.90, 0.98],
                 [1.05, 0.86], [1.12, 0.80], [1.15, 0.72]],
        'houseNose': [[0.66, -0.72], [0.80, -0.675], [1.13, -0.03], [1.18, 0.05], [1.23, 0.15], [2.0, 0.15]],
        'glass': [[-0.80, 0.70], [0.0, 0.72], [0.6, 0.74], [1.0, 0.70], [1.15, 0.66]],
        # The door's window up under the hood's edge; the screen in its black frame; the
        # hood's small plastic back light.
        'glazing': {'gutter': 5, 'frame': 0.03, 'houseMaterial': 'trim', 'belt': [[-0.9, 0.755], [1.2, 0.755]],
                    'side': [[-0.66, 0.42]],
                    'screen': {'frame': 0.045, 'lift': 0.0, 'foot': 0.015, 'frameMaterial': 'trim'},
                    'back': {'y': [0.70, 1.05], 'outline': [[0.0, 1.10], [0.36, 1.095], [0.38, 1.07], [0.40, 0.93], [0.37, 0.91], [0.0, 0.91]],
                             'facingMin': 0.02}},
    },
    'parts': {
        'underbody': {'rearBias': 1},
        'bodySmoothDeg': 40,
        'decals': [
            {'view': 'front', 'outline': [[0.0, 0.40], [0.20, 0.40], [0.28, 0.37], [0.30, 0.33], [0.27, 0.30], [0.20, 0.29], [0.0, 0.29]],
             'material': 'grille', 'height': 0.004, 'depthRange': [-2.1, -1.6]},
            {'view': 'front', 'rect': [[0.0, 0.405], [0.30, 0.10]], 'radius': 0.006, 'mirror': False, 'material': 'plate',
             'height': 0.006, 'depthRange': [-2.1, -1.6]},
            # The oval lamps in the bumper either side of the mouth (front view z .48-.53):
            # clear, with the turn signal at their outer end; the headlamps themselves
            # are the pop-ups, folded flush.
            {'view': 'front', 'node': 'headlights', 'rect': [[0.45, 0.505], [0.24, 0.05]], 'radius': 0.025,
             'material': 'Headlights', 'height': 0.008, 'depthRange': [-2.1, -1.6]},
            {'view': 'front', 'node': 'front_blinker_left', 'rect': [[0.59, 0.505], [0.05, 0.045]], 'radius': 0.02,
             'material': 'IndicatorLights', 'height': 0.009, 'depthRange': [-2.1, -1.6]},
            {'view': 'front', 'node': 'front_blinker_right', 'rect': [[0.59, 0.505], [0.05, 0.045]], 'radius': 0.02,
             'material': 'IndicatorLights', 'height': 0.009, 'depthRange': [-2.1, -1.6]},
            # The pop-up lamps lie folded flush in the bonnet: their lids' outline.
            {'view': 'top', 'rect': [[-1.42, 0.53], [0.30, 0.20]], 'radius': 0.03, 'material': 'paint', 'height': 0.004},
            {'view': 'side', 'node': 'front_blinker_left', 'rect': [[-1.62, 0.52], [0.10, 0.03]], 'radius': 0.012, 'material': 'IndicatorLights', 'height': 0.005},
            {'view': 'side', 'node': 'front_blinker_right', 'rect': [[-1.62, 0.52], [0.10, 0.03]], 'radius': 0.012, 'material': 'IndicatorLights', 'height': 0.005},
            # Oval tail lamps, plate between.
            # The big oval tail lamps, as the rear view draws them (x .35-.71, z .52-.67),
            # the turn signal low and inside, the reversing lamp above it.
            {'view': 'rear', 'node': 'taillights', 'rect': [[0.525, 0.60], [0.35, 0.145]], 'radius': 0.068,
             'material': 'TailLights', 'height': 0.008, 'depthRange': [1.6, 2.1]},
            {'view': 'rear', 'node': 'rear_blinker_left', 'rect': [[0.46, 0.565], [0.13, 0.035]], 'radius': 0.015,
             'material': 'IndicatorLights', 'height': 0.010, 'depthRange': [1.6, 2.1]},
            {'view': 'rear', 'node': 'rear_blinker_right', 'rect': [[0.46, 0.565], [0.13, 0.035]], 'radius': 0.015,
             'material': 'IndicatorLights', 'height': 0.010, 'depthRange': [1.6, 2.1]},
            {'view': 'rear', 'node': 'reverse_lights', 'rect': [[0.43, 0.625], [0.07, 0.03]], 'radius': 0.012,
             'material': 'ReverseLights', 'height': 0.010, 'depthRange': [1.6, 2.1]},
            {'view': 'rear', 'rect': [[0.0, 0.715], [0.34, 0.16]], 'radius': 0.006, 'mirror': False, 'material': 'plate',
             'height': 0.006, 'depthRange': [1.6, 2.1]},
        ],
        'lines': [
            {'view': 'side', 'points': [[-0.62, 0.76], [-0.62, 0.32], [0.53, 0.32], [0.53, 0.78]], 'width': 0.005},
            {'view': 'side', 'points': [[-1.95, 0.48], [1.95, 0.48]], 'width': 0.008, 'material': 'trim', 'height': 0.004},
            {'view': 'top', 'points': [[-1.90, 0.55], [-0.75, 0.62]], 'width': 0.005},
            {'view': 'rear', 'points': [[0.0, 0.81], [0.62, 0.81]], 'width': 0.005, 'depthRange': [1.5, 2.1]},
        ],
        'mirror': {'y': -0.45, 'z': 0.82, 'reach': 0.95, 'w': 0.14, 'h': 0.085, 'material': 'paint'},
        'handles': {'at': [[0.35, 0.69]], 'w': 0.10, 'material': 'chrome'},
        'wipers': {'arms': [[-0.5, -0.05, -0.68, 0.84], [0.05, 0.45, -0.68, 0.84]]},
        'wheel': {'style': 'alloy', 'spokes': 8, 'rimFactor': 0.68, 'spokeWidth': 0.35},
    },
}
