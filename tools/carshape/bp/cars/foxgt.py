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
        'topCross': [{'y': -2.10, 'z': [[0.0, 0.80], [0.6, 0.785], [0.85, 0.74]]}, {'y': -0.73, 'z': [[0.0, 0.95], [0.6, 0.93], [0.85, 0.88]]}],
        'cabin': [-0.72, 2.27],
        'belt': [[-0.72, 0.92], [-0.40, 0.88], [1.3, 0.89], [1.8, 0.93], [2.27, 0.95]],
        'glassPlan': [[-0.72, 0.68], [-0.3, 0.72], [1.2, 0.70], [2.27, 0.62]],
        'roofHalf': 0.62,
        'roofCrown': 0.04,
        'edge': 0.010, 'edgeY': 0.014, 'faceSmooth': 0.012,
        'arch': {'radius': 0.37, 'lift': 0.03},
    },
    'parts': {
        'glass': [
            {'view': 'side', 'outline': [[0.507, 0.89], [-0.376, 0.89], [-0.144, 1.23], [0.464, 1.23]], 'facingMin': 0.3},
            {'view': 'side', 'outline': [[1.40, 0.90], [0.565, 0.89], [0.565, 1.216], [0.898, 1.216]], 'facingMin': 0.3},
            {'view': 'front', 'outline': [[0.0, 1.27], [0.50, 1.26], [0.60, 1.18], [0.68, 0.96], [0.64, 0.93], [0.0, 0.93]],
             'depthRange': [-0.8, 0.1], 'facingMin': 0.1},
            {'view': 'top', 'outline': [[1.00, 0.0], [1.00, 0.55], [1.62, 0.51], [1.62, 0.0]], 'facingMin': 0.3},
        ],
        'regions': [
            # Body-colour fascias with black lower lips, the black window frames.
            {'view': 'side', 'outline': [[-2.5, 0.15], [-2.5, 0.25], [2.5, 0.25], [2.5, 0.15]]},
        ],
        'decals': [
            # The GT's nose, from the photos of the 1988 GT (photo 1 and w1-w3): the
            # composite lamps lie under the bonnet's leading edge (the drawing's side
            # outline puts that edge at z 0.78 and the lamps' foot on the bumper at
            # 0.66) and reach out to the wing's corner, where the amber corner lens
            # wraps round; between them the black panel with the running horse, as wide
            # as the gap the lamps leave (the old drawing had the lamps running in to
            # x 0.08 and a 15 cm slot: the panel was mistaken for a slot and the lamps
            # sat 5 cm low, under a body-colour brow). The air dam carries a wide slot
            # low down between the round fog lamps in its ends.
            {'view': 'front', 'rect': [[0.0, 0.705], [0.58, 0.098]], 'radius': 0.012, 'mirror': False, 'material': 'grille',
             'height': 0.004, 'depthRange': [-2.45, -1.9]},
            {'view': 'front', 'node': 'headlights', 'outline': [[0.30, 0.758], [0.60, 0.752], [0.69, 0.734], [0.72, 0.700], [0.72, 0.664], [0.30, 0.656]],
             'material': 'Headlights', 'height': 0.006, 'depthRange': [-2.45, -1.9]},
            {'view': 'front', 'node': 'front_blinker_left', 'outline': [[0.72, 0.758], [0.79, 0.748], [0.845, 0.716], [0.855, 0.672], [0.838, 0.652], [0.72, 0.660]],
             'material': 'IndicatorLights', 'height': 0.006, 'depthRange': [-2.45, -1.9]},
            {'view': 'front', 'node': 'front_blinker_right', 'outline': [[0.72, 0.758], [0.79, 0.748], [0.845, 0.716], [0.855, 0.672], [0.838, 0.652], [0.72, 0.660]],
             'material': 'IndicatorLights', 'height': 0.006, 'depthRange': [-2.45, -1.9]},
            {'view': 'front', 'rect': [[0.0, 0.305], [0.50, 0.05]], 'radius': 0.02, 'mirror': False, 'material': 'grille',
             'height': 0.004, 'depthRange': [-2.45, -1.9]},
            {'view': 'front', 'node': 'headlights', 'circle': [[0.60, 0.325], 0.040], 'material': 'Headlights',
             'height': 0.007, 'depthRange': [-2.45, -1.9]},
            {'view': 'front', 'rect': [[0.0, 0.50], [1.72, 0.035]], 'radius': 0.004, 'mirror': False, 'material': 'trim',
             'height': 0.003, 'depthRange': [-2.45, -1.9]},
            # Under the spoiler: the louvred tail lamps either side of a dark plate panel
            # (photo 2: the lens is red slats with black between, its outboard end tapering
            # on the corner, the reversing lamp a full-height clear section at its inboard
            # end; the old drawing had a coarse three-rib lens and an amber turn lamp where
            # the US car has a red one).
            {'view': 'rear', 'rect': [[0.0, 0.87], [1.60, 0.17]], 'radius': 0.01, 'mirror': False, 'material': 'trim',
             'height': 0.004, 'depthRange': [2.0, 2.45], 'facingMin': 0.05},
            {'view': 'rear', 'node': 'taillights', 'rect': [[0.59, 0.875], [0.42, 0.14]], 'radius': 0.008, 'material': 'TailLights',
             'height': 0.008, 'depthRange': [2.0, 2.45], 'facingMin': 0.05},
            {'view': 'rear', 'node': 'rear_blinker_left', 'rect': [[0.68, 0.815], [0.12, 0.028]], 'radius': 0.006,
             'material': 'TailLights', 'height': 0.010, 'depthRange': [2.0, 2.45], 'facingMin': 0.05},
            {'view': 'rear', 'node': 'rear_blinker_right', 'rect': [[0.68, 0.815], [0.12, 0.028]], 'radius': 0.006,
             'material': 'TailLights', 'height': 0.010, 'depthRange': [2.0, 2.45], 'facingMin': 0.05},
            {'view': 'rear', 'node': 'reverse_lights', 'rect': [[0.31, 0.875], [0.11, 0.13]], 'radius': 0.006,
             'material': 'ReverseLights', 'height': 0.008, 'depthRange': [2.0, 2.45], 'facingMin': 0.05},
            {'view': 'rear', 'rect': [[0.59, 0.822], [0.42, 0.009]], 'material': 'trim', 'height': 0.011,
             'depthRange': [2.0, 2.45], 'facingMin': 0.05},
            {'view': 'rear', 'rect': [[0.59, 0.848], [0.42, 0.009]], 'material': 'trim', 'height': 0.011,
             'depthRange': [2.0, 2.45], 'facingMin': 0.05},
            {'view': 'rear', 'rect': [[0.59, 0.874], [0.42, 0.009]], 'material': 'trim', 'height': 0.011,
             'depthRange': [2.0, 2.45], 'facingMin': 0.05},
            {'view': 'rear', 'rect': [[0.59, 0.900], [0.42, 0.009]], 'material': 'trim', 'height': 0.011,
             'depthRange': [2.0, 2.45], 'facingMin': 0.05},
            {'view': 'rear', 'rect': [[0.59, 0.926], [0.42, 0.009]], 'material': 'trim', 'height': 0.011,
             'depthRange': [2.0, 2.45], 'facingMin': 0.05},
            # The bumper's rubbing strip, the same height as the sides'.
            {'view': 'rear', 'rect': [[0.0, 0.50], [1.72, 0.035]], 'radius': 0.004, 'mirror': False, 'material': 'trim',
             'height': 0.003, 'depthRange': [2.0, 2.45], 'facingMin': 0.05},
        ],
        'lines': [
            # The bodyside rubbing strip (photo 1: it runs round the bumpers at the same
            # height, ~4 cm tall; the drawn one was a hairline 2 cm).
            {'view': 'side', 'points': [[-2.32, 0.50], [2.36, 0.50]], 'width': 0.035, 'material': 'trim', 'height': 0.004},
            # The GT's lower-body accent: a red pinstripe pair along the skirts
            # (photo 1: the red line runs the length of the lower moulding on a
            # body-colour skirt).
            {'view': 'side', 'points': [[-1.55, 0.36], [0.95, 0.35]], 'width': 0.012, 'material': 'paint2', 'height': 0.006},
            {'view': 'side', 'points': [[-1.55, 0.31], [0.95, 0.30]], 'width': 0.012, 'material': 'paint2', 'height': 0.006},
            {'view': 'side', 'points': [[-0.68, 0.88], [-0.70, 0.27], [0.53, 0.25], [0.53, 1.22]], 'width': 0.005},
            {'view': 'side', 'points': [[-0.38, 0.88], [-0.144, 1.24], [0.90, 1.23], [1.42, 0.90], [-0.38, 0.88]], 'width': 0.02,
             'material': 'trim', 'height': 0.002},
        ],
        'mirror': {'y': -0.42, 'z': 0.93, 'reach': 0.92, 'w': 0.15, 'h': 0.09},
        'handles': {'at': [[0.35, 0.80]], 'w': 0.14, 'material': 'trim'},
        'wipers': {'arms': [[-0.55, -0.05, -0.72, 0.97], [0.05, 0.55, -0.72, 0.97]]},
        # The hatch's spoiler: a body-colour blade across the deck's end on two short
        # pedestals (photo 2: the blade's ends come down to the deck at the quarters;
        # the old one's ends hung 8 cm in the air past its posts).
        'boxes': [
            {'c': [0.0, 1.97, 1.020], 'size': [1.32, 0.17, 0.035], 'mirror': False, 'material': 'paint'},
            {'c': [0.61, 1.97, 0.985], 'size': [0.10, 0.15, 0.10], 'material': 'paint'},
        ],
        'wheel': {'style': 'alloy', 'spokes': 15, 'rimFactor': 0.70, 'spokeWidth': 0.5},
        # The GT's red accent stripe keeps its colour whatever the car is painted.
        'paint2': {'rgb': [0.52, 0.05, 0.04], 'name': 'car_paint_2'},
    },
}
