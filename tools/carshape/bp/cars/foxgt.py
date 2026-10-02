# Ford Mustang GT 5.0 hatchback (1987-93, Fox body). Factory: 4562 x 1756 x 1321, wheelbase
# 2553, tracks 1448, 225/60 R15, clearance 130. The side of the 1988 GT at getoutlines.com
# (3x upscaled, 346 px/m by the wheelbase; outline read off by hand, its overhangs drawn
# short of the factory length and stretched to it). The eighties wedge: a low sloping nose
# with flush composite lamps and no grille, a deep fascia, a sharply raked screen, a
# short roof running into a long shallow fastback with louvred quarter glass, a spoiler,
# the GT's body-colour skirts with a red stripe, full-width tail lamps.
SEC = [[0.18, 0.80], [0.30, 0.86], [0.75, 0.87], [0.88, 0.84], [1.0, 0.76], [1.15, 0.70], [1.25, 0.64], [1.30, 0.55], [1.33, 0.2]]
CAR = {
    'id': 'foxgt',
    'label': 'Ford Mustang GT 5.0',
    'factory': {'length': 4.562, 'width': 1.756, 'height': 1.321, 'clearance': 0.13, 'wheelbase': 2.553,
                'frontTrack': 1.448, 'rearTrack': 1.448, 'wheelRadius': 0.32, 'tyreWidth': 0.225, 'frontOverhang': 0.95},
    'blueprint': {
        'image': 'foxgt_go.png',
        'dark': 60,
        'side': {'box': [0, 0, 1527, 470], 'nose': 'right', 'wheels': [[328, 358], [1210, 358]], 'ground': 465, 'isotropic': True,
                 'outline': [[-2.276, 0.289], [-2.282, 0.53], [-2.198, 0.651], [-2.137, 0.781], [-2.013, 0.819], [-0.723, 0.946], [-0.68, 0.97], [-0.208, 1.288], [-0.144, 1.311], [0.869, 1.305], [0.956, 1.282], [1.581, 0.999], [2.114, 1.004], [2.141, 0.97], [2.147, 0.868], [2.174, 0.796], [2.273, 0.579], [2.28, 0.304], [2.18, 0.232], [1.647, 0.232], [0.782, 0.174], [-0.897, 0.174], [-1.702, 0.217], [-2.198, 0.232]]},
    },
    'hull': {
        'sill': [[-2.3, 0.30], [-1.9, 0.24], [-1.7, 0.20], [-0.9, 0.17], [0.8, 0.17], [1.6, 0.22], [2.3, 0.30]],
        'planOverride': [[-2.30, 0.70], [-2.22, 0.80], [-2.0, 0.86], [2.1, 0.87], [2.25, 0.84], [2.33, 0.78]],
        'sectionStations': [{'y': -2.2, 'half': SEC}, {'y': 2.3, 'half': SEC}],
        'topCross': [{'y': -2.33, 'z': [[0.0, 0.60], [0.6, 0.58], [0.85, 0.52]]}, {'y': -0.73, 'z': [[0.0, 0.95], [0.6, 0.93], [0.85, 0.88]]}],
        'cabin': [-0.72, 2.27],
        'belt': [[-0.72, 0.92], [-0.40, 0.88], [1.3, 0.89], [1.8, 0.93], [2.27, 0.95]],
        'glassPlan': [[-0.72, 0.68], [-0.3, 0.72], [1.2, 0.70], [2.27, 0.62]],
        'roofHalf': 0.62,
        'roofCrown': 0.04,
        'edge': 0.010,
        'arch': {'radius': 0.37, 'lift': 0.03},
    },
    'parts': {
        'glass': [
            {'view': 'side', 'outline': [[0.507, 0.89], [-0.376, 0.89], [-0.144, 1.23], [0.464, 1.23]], 'facingMin': 0.3},
            {'view': 'side', 'outline': [[1.40, 0.90], [0.565, 0.89], [0.565, 1.216], [0.898, 1.216]], 'facingMin': 0.3},
            {'view': 'front', 'outline': [[0.0, 1.27], [0.50, 1.26], [0.60, 1.18], [0.68, 0.96], [0.64, 0.93], [0.0, 0.93]],
             'depthRange': [-0.8, 0.1], 'facingMin': 0.1},
            {'view': 'top', 'outline': [[1.00, 0.0], [1.00, 0.55], [1.75, 0.50], [1.75, 0.0]], 'facingMin': 0.3},
        ],
        'regions': [
            # Body-colour fascias with black lower lips, the black window frames.
            {'view': 'side', 'outline': [[-2.5, 0.15], [-2.5, 0.25], [2.5, 0.25], [2.5, 0.15]]},
        ],
        'decals': [
            # Flush composite lamps across the sloping nose, the blue oval between.
            {'view': 'front', 'node': 'headlights', 'outline': [[0.20, 0.71], [0.58, 0.69], [0.66, 0.64], [0.66, 0.60], [0.20, 0.62]],
             'material': 'Headlights', 'height': 0.006, 'depthRange': [-2.45, -2.0], 'facingMin': 0.45},
            {'view': 'front', 'node': 'front_blinker_left', 'outline': [[0.66, 0.64], [0.75, 0.60], [0.76, 0.53], [0.66, 0.56]],
             'material': 'IndicatorLights', 'height': 0.006, 'depthRange': [-2.45, -2.0], 'facingMin': -0.2},
            {'view': 'front', 'node': 'front_blinker_right', 'outline': [[0.66, 0.64], [0.75, 0.60], [0.76, 0.53], [0.66, 0.56]],
             'material': 'IndicatorLights', 'height': 0.006, 'depthRange': [-2.45, -2.0], 'facingMin': -0.2},
            {'view': 'front', 'rect': [[0.0, 0.66], [0.40, 0.05]], 'radius': 0.02, 'mirror': False, 'material': 'grille',
             'height': 0.004, 'depthRange': [-2.45, -2.0]},
            {'view': 'front', 'rect': [[0.0, 0.40], [0.80, 0.10]], 'radius': 0.02, 'mirror': False, 'material': 'grille',
             'height': 0.004, 'depthRange': [-2.45, -2.0]},
            {'view': 'front', 'rect': [[0.0, 0.55], [0.52, 0.11]], 'radius': 0.005, 'mirror': False, 'material': 'plate',
             'height': 0.006, 'depthRange': [-2.45, -2.0]},
            {'view': 'rear', 'rect': [[0.0, 0.83], [1.62, 0.16]], 'radius': 0.01, 'mirror': False, 'material': 'trim',
             'height': 0.004, 'depthRange': [2.0, 2.45], 'facingMin': 0.05},
            {'view': 'rear', 'node': 'taillights', 'rect': [[0.52, 0.85], [0.56, 0.08]], 'radius': 0.008, 'material': 'TailLights',
             'height': 0.008, 'depthRange': [2.0, 2.45], 'facingMin': 0.05},
            {'view': 'rear', 'node': 'rear_blinker_left', 'rect': [[0.62, 0.785], [0.32, 0.04]], 'radius': 0.006,
             'material': 'IndicatorLights', 'height': 0.008, 'depthRange': [2.0, 2.45], 'facingMin': 0.05},
            {'view': 'rear', 'node': 'rear_blinker_right', 'rect': [[0.62, 0.785], [0.32, 0.04]], 'radius': 0.006,
             'material': 'IndicatorLights', 'height': 0.008, 'depthRange': [2.0, 2.45], 'facingMin': 0.05},
            {'view': 'rear', 'node': 'reverse_lights', 'rect': [[0.30, 0.785], [0.14, 0.04]], 'radius': 0.006,
             'material': 'ReverseLights', 'height': 0.008, 'depthRange': [2.0, 2.45], 'facingMin': 0.05},
            {'view': 'rear', 'rect': [[0.0, 0.58], [0.52, 0.11]], 'radius': 0.005, 'mirror': False, 'material': 'plate',
             'height': 0.006, 'depthRange': [2.0, 2.45], 'facingMin': 0.05},
        ],
        'bars': [
            {'view': 'side', 'span': [0.95, 1.38], 'b': [0.93, 1.13], 'count': 6, 'width': 0.012, 'dir': 'v', 'material': 'trim',
             'height': 0.006, 'mirror': True},
        ],
        'lines': [
            {'view': 'side', 'points': [[-2.32, 0.52], [2.35, 0.50]], 'width': 0.012, 'material': 'TailLights', 'height': 0.004},
            {'view': 'side', 'points': [[-0.68, 0.88], [-0.70, 0.27], [0.53, 0.25], [0.53, 1.22]], 'width': 0.005},
            {'view': 'side', 'points': [[-0.38, 0.88], [-0.144, 1.24], [0.90, 1.23], [1.42, 0.90], [-0.38, 0.88]], 'width': 0.02,
             'material': 'trim', 'height': 0.002},
        ],
        'mirror': {'y': -0.42, 'z': 0.93, 'reach': 0.92, 'w': 0.15, 'h': 0.09},
        'handles': {'at': [[0.35, 0.80]], 'w': 0.14, 'material': 'trim'},
        'wipers': {'arms': [[-0.55, -0.05, -0.72, 0.97], [0.05, 0.55, -0.72, 0.97]]},
        'wheel': {'style': 'alloy', 'spokes': 15, 'rimFactor': 0.70, 'spokeWidth': 0.5},
    },
}
