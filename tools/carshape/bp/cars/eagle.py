# AMC Eagle wagon (1980-87). Factory: 4740 x 1830 x 1405, wheelbase 2776, tracks 1500/1460,
# P195/75 R15, clearance 190. The three views of the 1980 Eagle wagon at getoutlines.com
# (228 px/m by the wheelbase; the side read off by hand, the roof under its rack). The
# first crossover: a Concord wagon lifted on four-wheel drive, a long flat bonnet over a
# grid grille between pairs of square lamps, a big 5-mph bumper, a long roof to a sloping
# tailgate, a full-width band of tail lamps, black plastic flares and cladding.
ARCH_F = [[-2.03, 0.36], [-2.014, 0.484], [-1.966, 0.6], [-1.889, 0.699], [-1.79, 0.776], [-1.674, 0.824], [-1.55, 0.84], [-1.426, 0.824], [-1.31, 0.776], [-1.211, 0.699], [-1.134, 0.6], [-1.086, 0.484], [-1.07, 0.36]]
ARCH_R = [[0.746, 0.36], [0.762, 0.484], [0.81, 0.6], [0.887, 0.699], [0.986, 0.776], [1.102, 0.824], [1.226, 0.84], [1.35, 0.824], [1.466, 0.776], [1.565, 0.699], [1.642, 0.6], [1.69, 0.484], [1.706, 0.36]]
CAR = {
    'id': 'eagle',
    'label': 'AMC Eagle',
    'factory': {'length': 4.74, 'width': 1.83, 'height': 1.405, 'clearance': 0.19, 'wheelbase': 2.776,
                'frontTrack': 1.5, 'rearTrack': 1.46, 'wheelRadius': 0.34, 'tyreWidth': 0.195, 'frontOverhang': 0.82},
    'blueprint': {
        'image': 'eagle_go.png',
        'dark': 120,
        'side': {'box': [0, 0, 1097, 365], 'nose': 'right', 'wheels': [[243, 280], [875, 280]], 'ground': 358, 'isotropic': True,
                 'outline': [[2.258, 0.52], [2.258, 0.694], [2.161, 0.716], [2.17, 1.001], [2.117, 1.067], [1.81, 1.3], [1.502, 1.42], [-0.167, 1.46], [-0.364, 1.45], [-0.452, 1.41], [-0.957, 1.133], [-2.099, 1.054], [-2.253, 0.979], [-2.31, 0.848], [-2.319, 0.694], [-2.472, 0.672], [-2.472, 0.518], [-2.30, 0.52], [-2.25, 0.45], [-1.835, 0.452], [-1.089, 0.422], [0.8, 0.395], [1.59, 0.452], [1.941, 0.487], [2.12, 0.48], [2.17, 0.52]]},
        'front': {'box': [30, 372, 540, 751], 'ppm': 251, 'centre': 280, 'zRef': [[380, 1.405], [745, 0.0]],
                  'drop': [[0, 90, 60, 140], [450, 90, 510, 140]]},
        'rear': {'box': [590, 360, 1090, 751], 'ppm': 251, 'centre': 840, 'zRef': [[372, 1.405], [745, 0.0]]},
    },
    'hull': {
        'bumpers': {'front': {'z': [0.50, 0.71]}, 'rear': {'z': [0.50, 0.71]}},
        'sill': [[-2.4, 0.46], [-1.8, 0.45], [-1.1, 0.42], [0.8, 0.40], [1.6, 0.45], [2.2, 0.50]],
        'planOverride': [[-2.33, 0.82], [-2.25, 0.88], [-2.0, 0.905], [2.0, 0.905], [2.12, 0.88], [2.18, 0.84]],
        'sectionBridge': {'front': [[1.0, 1.25]]},
        'cabin': [-0.96, 2.12],
        'belt': [[-0.96, 1.13], [-0.8, 1.09], [1.2, 1.09], [1.8, 1.10], [2.12, 1.06]],
        'glassPlan': [[-0.96, 0.72], [-0.5, 0.78], [1.5, 0.78], [2.12, 0.70]],
        'crown': [[-2.4, 0.02], [2.4, 0.02]],
        'roofCrown': 0.03,
        'edge': 0.010,
        'arch': {'radius': 0.44, 'lift': 0.04},
    },
    'parts': {
        'glass': [
            {'view': 'side', 'outline': [[0.778, 1.10], [0.141, 1.10], [0.141, 1.40], [0.646, 1.40]], 'facingMin': 0.3},
            {'view': 'side', 'outline': [[0.075, 1.10], [-0.78, 1.10], [-0.42, 1.40], [0.075, 1.40]], 'facingMin': 0.3},
            {'view': 'side', 'outline': [[1.744, 1.11], [0.844, 1.11], [0.80, 1.38], [1.40, 1.37]], 'facingMin': 0.3},
            {'view': 'front', 'outline': [[0.0, 1.38], [0.60, 1.36], [0.68, 1.28], [0.74, 1.12], [0.70, 1.10], [0.0, 1.10]],
             'depthRange': [-1.2, -0.4], 'facingMin': 0.2},
            {'view': 'rear', 'outline': [[0.0, 1.32], [0.55, 1.31], [0.62, 1.24], [0.64, 1.02], [0.58, 0.99], [0.0, 0.99]],
             'depthRange': [1.6, 2.3], 'facingMin': 0.15},
        ],
        'regions': [
            # Black flares, cladding and bumper faces.
            {'view': 'side', 'outline': [[-2.5, 0.38], [-2.5, 0.50], [2.3, 0.50], [2.3, 0.38]]},
            {'view': 'front', 'rect': [[0.0, 0.53], [1.9, 0.18]], 'radius': 0.001, 'mirror': False, 'depthRange': [-2.6, -2.2]},
            {'view': 'rear', 'rect': [[0.0, 0.53], [1.9, 0.18]], 'radius': 0.001, 'mirror': False, 'depthRange': [2.0, 2.4]},
        ],
        'decals': [
            {'view': 'front', 'rect': [[0.0, 0.73], [0.78, 0.17]], 'radius': 0.01, 'mirror': False, 'material': 'grille',
             'height': 0.005, 'depthRange': [-2.6, -2.2]},
            {'view': 'front', 'node': 'headlights', 'rect': [[0.48, 0.74], [0.15, 0.13]], 'radius': 0.01, 'material': 'Headlights',
             'height': 0.008, 'depthRange': [-2.6, -2.2]},
            {'view': 'front', 'node': 'headlights', 'rect': [[0.68, 0.74], [0.15, 0.13]], 'radius': 0.01, 'material': 'Headlights',
             'height': 0.008, 'depthRange': [-2.6, -2.2], 'facingMin': 0.0},
            {'view': 'front', 'node': 'front_blinker_left', 'rect': [[0.27, 0.66], [0.17, 0.05]], 'radius': 0.006,
             'material': 'IndicatorLights', 'height': 0.009, 'depthRange': [-2.6, -2.2]},
            {'view': 'front', 'node': 'front_blinker_right', 'rect': [[0.27, 0.66], [0.17, 0.05]], 'radius': 0.006,
             'material': 'IndicatorLights', 'height': 0.009, 'depthRange': [-2.6, -2.2]},
            {'view': 'front', 'rect': [[0.0, 0.53], [0.52, 0.11]], 'radius': 0.005, 'mirror': False, 'material': 'plate',
             'height': 0.006, 'depthRange': [-2.7, -2.2]},
            {'view': 'side', 'rect': [[-2.20, 0.85], [0.14, 0.04]], 'radius': 0.01, 'material': 'IndicatorLights', 'height': 0.004},
            # The full-width band of tail lamps, the plate in its middle.
            {'view': 'rear', 'rect': [[0.0, 0.73], [1.70, 0.20]], 'radius': 0.01, 'mirror': False, 'material': 'trim',
             'height': 0.004, 'depthRange': [2.0, 2.4], 'facingMin': 0.05},
            {'view': 'rear', 'node': 'taillights', 'rect': [[0.62, 0.75], [0.44, 0.10]], 'radius': 0.008, 'material': 'TailLights',
             'height': 0.008, 'depthRange': [2.0, 2.4], 'facingMin': 0.05},
            {'view': 'rear', 'node': 'rear_blinker_left', 'rect': [[0.72, 0.67], [0.24, 0.045]], 'radius': 0.006,
             'material': 'IndicatorLights', 'height': 0.008, 'depthRange': [2.0, 2.4], 'facingMin': 0.05},
            {'view': 'rear', 'node': 'rear_blinker_right', 'rect': [[0.72, 0.67], [0.24, 0.045]], 'radius': 0.006,
             'material': 'IndicatorLights', 'height': 0.008, 'depthRange': [2.0, 2.4], 'facingMin': 0.05},
            {'view': 'rear', 'node': 'reverse_lights', 'rect': [[0.46, 0.67], [0.16, 0.045]], 'radius': 0.006,
             'material': 'ReverseLights', 'height': 0.008, 'depthRange': [2.0, 2.4], 'facingMin': 0.05},
            {'view': 'rear', 'rect': [[0.0, 0.73], [0.36, 0.13]], 'radius': 0.005, 'mirror': False, 'material': 'plate',
             'height': 0.008, 'depthRange': [2.0, 2.4], 'facingMin': 0.05},
        ],
        'bars': [
            {'view': 'front', 'span': [-0.37, 0.37], 'b': [0.67, 0.80], 'count': 5, 'width': 0.008, 'material': 'chrome',
             'height': 0.008, 'depthRange': [-2.6, -2.2]},
        ],
        'lines': [
            {'view': 'side', 'points': ARCH_F, 'width': 0.07, 'material': 'trim', 'height': 0.025},
            {'view': 'side', 'points': ARCH_R, 'width': 0.07, 'material': 'trim', 'height': 0.025},
            {'view': 'side', 'points': [[-0.96, 1.08], [-1.0, 0.47], [0.11, 0.45], [0.11, 1.09]], 'width': 0.005},
            {'view': 'side', 'points': [[0.11, 0.45], [0.82, 0.44], [0.85, 1.09]], 'width': 0.005},
            {'view': 'side', 'points': [[-2.30, 0.95], [2.15, 0.95]], 'width': 0.006, 'material': 'chrome', 'height': 0.003},
            {'view': 'side', 'points': [[-0.80, 1.09], [-0.42, 1.41], [0.66, 1.41], [0.80, 1.09]], 'width': 0.012, 'material': 'chrome',
             'height': 0.003},
        ],
        'boxes': [{'c': [0.58, 0.55, 1.43], 'size': [0.04, 1.8, 0.03], 'material': 'chrome'}],
        'bumpers': {
            'front': {'z': [0.46, 0.66], 'depth': 0.12, 'wrap': 0.35, 'profile': 'blade', 'rubber': 0.06, 'standOff': -0.01},
            'rear': {'z': [0.46, 0.66], 'depth': 0.12, 'wrap': 0.35, 'profile': 'blade', 'rubber': 0.06, 'standOff': -0.07},
        },
        'mirror': {'y': -0.80, 'z': 1.15, 'reach': 1.0, 'w': 0.13, 'h': 0.09, 'material': 'chrome'},
        'handles': {'at': [[-0.05, 1.0], [0.75, 1.0]], 'w': 0.13},
        'wipers': {'arms': [[-0.6, -0.05, -0.98, 1.15], [0.05, 0.6, -0.98, 1.15]]},
        'wheel': {'style': 'alloy', 'spokes': 10, 'rimFactor': 0.66, 'spokeWidth': 0.35},
    },
}
