# VAZ-2108 Sputnik (1984). Factory: 4006 x 1620 x 1335, wheelbase 2460, overhangs
# 785/761, tracks 1390/1360, 165/70 R13. The factory drawing reprinted at
# 3dcar.ru/blueprints/vaz/vaz_2108.
CAR = {
    'id': 'vaz2108',
    'label': 'VAZ-2108',
    'factory': {'length': 4.006, 'width': 1.62, 'height': 1.335, 'clearance': 0.16, 'wheelbase': 2.46,
                'frontTrack': 1.39, 'rearTrack': 1.36, 'wheelRadius': 0.281, 'tyreWidth': 0.165, 'frontOverhang': 0.785},
    'blueprint': {
        'image': 'vaz2108.jpg',
        'side': {'box': [612, 70, 1700, 429], 'nose': 'left', 'drop': [[868, 4, 1088, 14]]},
        'top': {'box': [612, 593, 1722, 1046], 'nose': 'left'},
        'front': {'box': [46, 68, 527, 429]},
        'rear': {'box': [27, 596, 498, 952]},
    },
    'hull': {
        'sill': [[-2.05, 0.30], [-1.9, 0.29], [-1.6, 0.25], [-1.4, 0.20], [1.2, 0.20], [1.45, 0.25],
                 [1.8, 0.28], [2.05, 0.29]],
        'cabin': [-0.77, 2.05],
        'belt': [[-0.77, 0.87], [-0.5, 0.90], [0.6, 0.905], [1.5, 0.93], [1.85, 0.88], [2.05, 0.87]],
        'glassPlan': [[-0.77, 0.73], [-0.4, 0.74], [0.8, 0.73], [1.5, 0.68], [2.0, 0.62]],
        'sectionBridge': {'front': [[0.82, 1.05]], 'rear': [[0.82, 1.05]]},
        'crown': [[-2.1, 0.012], [2.1, 0.012]],
        'roofCrown': 0.02,
        # A pressed, flat-panelled hatch: the default 2.2 cm edge and 6 cm along-car blur
        # rounded the belt, the hatch's frame and the tail's corners off. Tightened as on
        # the Renault 4 (the top view's plan is already flat; checked with probe.py plan).
        'edge': 0.013,
        'edgeMin': 0.013,
        'edgeY': 0.05,
        'edgeYMin': 0.05,
        'arch': {'radius': 0.315, 'lift': 0.0},
    },
    'parts': {
        'glass': [
            {'view': 'side', 'outline': [[0.425, 1.224], [-0.196, 1.213], [-0.268, 1.167], [-0.519, 0.975], [-0.512, 0.903], [0.429, 0.903]], 'facingMin': 0.3},
            {'view': 'side', 'outline': [[0.608, 1.232], [0.627, 1.09], [0.654, 0.907], [1.0, 0.91], [1.49, 0.935], [1.50, 0.96],
                                         [1.084, 1.22], [0.825, 1.232]], 'facingMin': 0.3},
            {'view': 'front', 'outline': [[0.0, 1.235], [0.50, 1.233], [0.535, 1.21], [0.68, 0.90], [0.66, 0.887], [0.0, 0.887]],
             'depthRange': [-0.9, -0.2], 'facingMin': -0.3},
            # The tailgate glass is a rounded rectangle, its sides nearly parallel (the
            # drawing and the photographs): at 0.46/0.58 it tapered hard and its foot
            # ran to within 4 cm of the flank, leaving no C-pillar where the real car
            # has 10-12 cm.
            {'view': 'rear', 'outline': [[0.0, 1.243], [0.40, 1.240], [0.46, 1.225], [0.51, 1.16], [0.545, 0.99],
                                         [0.535, 0.930], [0.49, 0.914], [0.0, 0.912]],
             'depthRange': [1.0, 2.1], 'facingMin': -0.3},
        ],
        # The bumpers are moulded plastic in the body's own shape: black regions of it.
        'regions': [
            {'view': 'front', 'rect': [[0.0, 0.4275], [1.8, 0.275]], 'radius': 0.001, 'mirror': False, 'depthRange': [-2.1, -1.55]},
            {'view': 'side', 'outline': [[-2.05, 0.29], [-2.05, 0.565], [-1.43, 0.565], [-1.49, 0.50], [-1.53, 0.40], [-1.56, 0.29]]},
            {'view': 'rear', 'rect': [[0.0, 0.41], [1.8, 0.26]], 'radius': 0.001, 'mirror': False, 'depthRange': [1.55, 2.1]},
            {'view': 'side', 'outline': [[1.457, 0.536], [2.05, 0.536], [2.05, 0.28], [1.58, 0.29], [1.556, 0.38], [1.50, 0.50]]},
        ],
        'decals': [
            {'view': 'front', 'outline': [[0.0, 0.712], [0.31, 0.712], [0.27, 0.576], [0.0, 0.576]], 'mirror': True,
             'material': 'grille', 'height': 0.004, 'depthRange': [-2.1, -1.7]},
            {'view': 'front', 'node': 'headlights', 'outline': [[0.286, 0.71], [0.603, 0.71], [0.603, 0.578], [0.265, 0.578]],
             'material': 'Headlights', 'height': 0.008, 'depthRange': [-2.1, -1.7]},
            {'view': 'front', 'node': 'front_blinker_left', 'rect': [[0.63, 0.643], [0.05, 0.13]], 'radius': 0.004,
             'material': 'IndicatorLights', 'height': 0.008, 'facingMin': -0.1, 'depthRange': [-2.1, -1.6]},
            {'view': 'front', 'node': 'front_blinker_right', 'rect': [[0.63, 0.643], [0.05, 0.13]], 'radius': 0.004,
             'material': 'IndicatorLights', 'height': 0.008, 'facingMin': -0.1, 'depthRange': [-2.1, -1.6]},
            {'view': 'side', 'node': 'front_blinker_left', 'rect': [[-0.97, 0.638], [0.06, 0.022]], 'radius': 0.004, 'material': 'IndicatorLights', 'height': 0.005},
            {'view': 'side', 'node': 'front_blinker_right', 'rect': [[-0.97, 0.638], [0.06, 0.022]], 'radius': 0.004, 'material': 'IndicatorLights', 'height': 0.005},
            {'view': 'front', 'rect': [[0.0, 0.645], [0.035, 0.07]], 'radius': 0.004, 'mirror': False, 'material': 'chrome',
             'height': 0.008, 'depthRange': [-2.1, -1.7]},
            {'view': 'front', 'rect': [[0.0, 0.467], [0.52, 0.112]], 'radius': 0.006, 'mirror': False, 'material': 'plate',
             'height': 0.005, 'depthRange': [-2.1, -1.6]},
            {'view': 'front', 'rect': [[0.18, 0.365], [0.32, 0.05]], 'radius': 0.01, 'material': 'grille',
             'height': 0.003, 'depthRange': [-2.1, -1.6]},
            # Tail lamps: indicator outboard, red, reversing lamp inboard. The amber
            # lens wraps the corner onto the quarter as ONE piece (the photographs): drawn
            # as a rear patch reaching past the corner with the end view's facing limit
            # (-0.1, like the front blinkers) it is cut cleanly where the quarter turns
            # away. The former separate side patch stood off the body as a flap beside
            # the lens, and the red side patch under it was never visible.
            {'view': 'rear', 'node': 'rear_blinker_left', 'rect': [[0.71, 0.617], [0.16, 0.13]], 'radius': 0.004,
             'material': 'IndicatorLights', 'height': 0.006, 'facingMin': 0.42, 'depthRange': [1.6, 2.1]},
            {'view': 'rear', 'node': 'rear_blinker_right', 'rect': [[0.71, 0.617], [0.16, 0.13]], 'radius': 0.004,
             'material': 'IndicatorLights', 'height': 0.006, 'facingMin': 0.42, 'depthRange': [1.6, 2.1]},
            {'view': 'rear', 'node': 'taillights', 'rect': [[0.55, 0.617], [0.2, 0.13]], 'radius': 0.004,
             'material': 'TailLights', 'height': 0.008, 'depthRange': [1.6, 2.1]},
            {'view': 'rear', 'node': 'reverse_lights', 'rect': [[0.415, 0.617], [0.07, 0.13]], 'radius': 0.004,
             'material': 'ReverseLights', 'height': 0.008, 'depthRange': [1.6, 2.1]},
            {'view': 'rear', 'rect': [[0.0, 0.43], [0.52, 0.112]], 'radius': 0.006, 'mirror': False, 'material': 'plate',
             'height': 0.005, 'depthRange': [1.6, 2.1]},
            # The tailgate's black spoiler lip above the glass (the drawing's line over
            # the window and the photographs): without it the roof's rear edge ran
            # straight onto the glass.
            {'view': 'rear', 'rect': [[0.0, 1.266], [0.96, 0.048]], 'radius': 0.006, 'mirror': False,
             'material': 'trim', 'height': 0.009, 'facingMin': 0.1, 'depthRange': [1.0, 2.1]},
            {'view': 'rear', 'rect': [[0.39, 0.765], [0.28, 0.04]], 'radius': 0.01, 'material': 'chrome', 'mirror': False,
             'height': 0.004, 'depthRange': [1.6, 2.1]},
        ],
        'bars': [
            {'view': 'front', 'span': [-0.29, 0.29], 'b': [0.59, 0.70], 'count': 3, 'width': 0.008,
             'material': 'trim', 'height': 0.007, 'depthRange': [-2.1, -1.7]},
        ],
        'lines': [
            {'view': 'side', 'points': [[-0.75, 0.86], [-0.75, 0.265], [0.505, 0.265], [0.505, 0.89]], 'width': 0.005},
            # The hatch's lower edge, just above the bumper band and under the lamps
            # (the drawing), and its side edge at the corner, up to the screen's foot.
            # The former single line ran across the panel at 0.70 and up at x 0.62, so
            # its end touched the indicator lens.
            {'view': 'rear', 'points': [[0.0, 0.545], [0.62, 0.545]], 'width': 0.005, 'depthRange': [1.5, 2.1]},
            {'view': 'rear', 'points': [[0.735, 0.545], [0.78, 0.90]], 'width': 0.005, 'depthRange': [1.5, 2.1]},
            {'view': 'side', 'points': [[0.425, 1.224], [-0.196, 1.213], [-0.268, 1.167], [-0.519, 0.975], [-0.512, 0.903],
                                        [0.429, 0.903], [0.425, 1.224]], 'width': 0.018, 'height': 0.003},
            {'view': 'side', 'points': [[0.608, 1.232], [0.627, 1.09], [0.654, 0.907], [1.0, 0.91], [1.49, 0.935], [1.50, 0.96],
                                        [1.084, 1.22], [0.825, 1.232], [0.608, 1.232]], 'width': 0.018, 'height': 0.003},
            {'view': 'side', 'points': [[0.43, 0.905], [0.43, 1.226]], 'width': 0.03, 'height': 0.003},
        ],
        'mirror': {'y': -0.58, 'z': 0.90, 'reach': 0.856, 'w': 0.15, 'h': 0.10},
        'handles': {'at': [[0.35, 0.742]], 'w': 0.2, 'material': 'trim'},
        'wipers': {'arms': [[-0.55, -0.05, -0.74, 0.9], [0.05, 0.5, -0.74, 0.9]]},
        'wheel': {'style': 'steel', 'windows': 4, 'rimFactor': 0.66, 'cap': True},
    },
}
