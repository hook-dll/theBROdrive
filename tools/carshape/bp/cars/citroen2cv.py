# Citroën 2CV6 (1970-90). Factory: 3830 x 1480 x 1600, wheelbase 2400, overhangs 680/750,
# tracks 1260, 125 R 15, clearance 160. The dimensioned drawing reprinted at
# 3dcar.ru/blueprints/citroen/2cv (234 px/m by the wheelbase); its side view is full of
# dimension and interior lines, so the outline is read off by hand. A tall narrow body
# between separate wings, a high corrugated bonnet with the lamps on stalks over the
# wings, skirted rear wheels, a canvas roof running down to the tail.
# Sections (half widths) read off the top and end views: the cabin is narrow (its sides
# 0.60 out, the top view's 1120 between them inside), only the separate wings stand out
# to the full 1480.
DOOR = [[0.33, 0.58], [0.45, 0.60], [0.75, 0.61], [0.95, 0.61], [1.05, 0.60], [1.2, 0.58], [1.35, 0.54], [1.45, 0.48],
        [1.53, 0.40], [1.58, 0.2]]
FWING = [[0.30, 0.62], [0.40, 0.70], [0.62, 0.73], [0.72, 0.68], [0.78, 0.50], [0.90, 0.46], [1.0, 0.40], [1.04, 0.1]]
RWING = [[0.40, 0.70], [0.46, 0.74], [0.70, 0.74], [0.80, 0.70], [0.85, 0.60], [1.0, 0.59], [1.2, 0.57], [1.35, 0.52],
         [1.45, 0.45], [1.52, 0.2]]
TAIL = [[0.40, 0.55], [0.50, 0.58], [0.75, 0.58], [0.85, 0.55], [0.95, 0.50], [1.05, 0.2]]
CAR = {
    'id': 'citroen2cv',
    'label': 'Citroën 2CV',
    'factory': {'length': 3.83, 'width': 1.48, 'height': 1.6, 'clearance': 0.16, 'wheelbase': 2.4,
                'frontTrack': 1.26, 'rearTrack': 1.26, 'wheelRadius': 0.30, 'tyreWidth': 0.125, 'frontOverhang': 0.68},
    'blueprint': {
        'image': 'citroen2cv.jpg',
        'dark': 120,
        'side': {'box': [479, 35, 1500, 420], 'nose': 'left', 'wheels': [[643.5, 343], [1205.5, 343]], 'ground': 415,
                 'isotropic': True,
                 'outline': [[-1.912, 0.308], [-1.912, 0.372], [-1.818, 0.397], [-1.797, 0.491], [-1.784, 0.714], [-1.72, 0.85],
                             [-1.592, 0.94], [-1.378, 1.004], [-1.079, 1.047], [-0.823, 1.064], [-0.63, 1.077], [-0.31, 1.466],
                             [-0.224, 1.538], [0.289, 1.594], [0.716, 1.568], [0.972, 1.5], [1.229, 1.346], [1.528, 1.056],
                             [1.763, 0.782], [1.861, 0.628], [1.904, 0.5], [1.87, 0.457], [1.528, 0.423], [0.887, 0.385],
                             [-0.652, 0.355], [-0.737, 0.115], [-1.848, 0.115]]},
        'top': {'box': [476, 546, 1387, 910], 'nose': 'left', 'fitWidth': True},
        'front': {'box': [19, 58, 414, 449], 'ppm': 240, 'zRef': [[63, 1.59], [415, 0.0]], 'drop': [[340, 100, 395, 150]]},
        'rear': {'box': [37, 510, 407, 964], 'ppm': 240, 'zRef': [[518, 1.59], [898, 0.0]]},
    },
    'hull': {
        'sill': [[-1.95, 0.33], [-1.75, 0.34], [-1.6, 0.36], [-0.95, 0.18], [-0.75, 0.18], [-0.66, 0.36], [0.70, 0.36],
                 [0.85, 0.44], [1.55, 0.44], [1.95, 0.45]],
        # The cabin runs to the tail: the boot lid is the roof's slope carried on down
        # between the rear wings, which fall away below the belt to the tail.
        'cabin': [-0.63, 1.86],
        'belt': [[-0.63, 1.07], [-0.4, 1.05], [0.75, 1.05], [1.0, 0.97], [1.3, 0.84], [1.6, 0.70], [1.86, 0.58]],
        'glassPlan': [[-0.63, 0.55], [-0.3, 0.58], [0.9, 0.58], [1.3, 0.57], [1.6, 0.56], [1.86, 0.54]],
        # the boot lid is the cabin's own side carried down: no shelf at the belt
        'shelf': 0.0,
        'sectionStations': [
            {'y': -1.70, 'half': [[0.30, 0.60], [0.40, 0.68], [0.60, 0.70], [0.66, 0.66], [0.72, 0.42], [0.88, 0.40], [0.95, 0.3], [1.0, 0.1]]},
            {'y': -1.35, 'half': FWING},
            {'y': -0.95, 'half': FWING},
            {'y': -0.72, 'half': DOOR},
            {'y': 0.80, 'half': DOOR},
            {'y': 1.05, 'half': RWING},
            {'y': 1.55, 'half': RWING},
            {'y': 1.85, 'half': TAIL},
        ],
        'stationBlend': 0.22,
        # The corrugated bonnet stands high between low wings.
        'topCross': [
            {'y': -1.92, 'z': [[0.0, 0.50], [0.7, 0.45]]},
            {'y': -1.70, 'z': [[0.0, 0.84], [0.20, 0.82], [0.36, 0.72], [0.45, 0.64], [0.58, 0.67], [0.68, 0.62], [0.74, 0.50]]},
            {'y': -1.40, 'z': [[0.0, 1.0], [0.22, 0.97], [0.38, 0.87], [0.45, 0.77], [0.55, 0.79], [0.68, 0.76], [0.74, 0.66]]},
            {'y': -1.05, 'z': [[0.0, 1.05], [0.25, 1.03], [0.40, 0.95], [0.47, 0.80], [0.58, 0.79], [0.68, 0.75], [0.74, 0.64]]},
            {'y': -0.80, 'z': [[0.0, 1.06], [0.30, 1.05], [0.48, 1.0], [0.56, 0.80], [0.66, 0.70], [0.72, 0.58]]},
            {'y': -0.63, 'z': [[0.0, 1.08], [0.5, 1.06], [0.62, 1.03], [0.70, 0.98]]},
        ],
        'roofCrown': 0.05,
        'edge': 0.016,
        'arch': {'radius': 0.37, 'lift': 0.05, 'rear': {'skirt': True}},
    },
    'parts': {
        'paint2': {'name': 'trim_canvas', 'rgb': [0.10, 0.10, 0.11]},
        'glass': [
            {'view': 'side', 'outline': [[-0.438, 1.068], [0.182, 1.068], [0.182, 1.40], [-0.224, 1.40], [-0.374, 1.239]], 'facingMin': 0.3},
            {'view': 'side', 'outline': [[0.246, 1.068], [0.823, 1.068], [0.823, 1.37], [0.673, 1.41], [0.246, 1.41]], 'facingMin': 0.3},
            {'view': 'side', 'outline': [[0.865, 1.056], [1.186, 1.056], [1.27, 1.17], [1.143, 1.34], [0.93, 1.43], [0.865, 1.43]],
             'facingMin': 0.3},
            {'view': 'front', 'outline': [[0.0, 1.43], [0.50, 1.43], [0.53, 1.40], [0.55, 1.13], [0.52, 1.10], [0.0, 1.10]],
             'depthRange': [-0.7, -0.2], 'facingMin': 0.2},
            {'view': 'rear', 'outline': [[0.0, 1.39], [0.40, 1.39], [0.43, 1.36], [0.43, 1.13], [0.40, 1.10], [0.0, 1.10]],
             'depthRange': [1.0, 1.7], 'facingMin': 0.1},
        ],
        'regions': [
            # The canvas roof, from the screen header down the back to the boot lid.
            {'view': 'top', 'outline': [[-0.28, 0.0], [-0.28, 0.56], [1.30, 0.56], [1.55, 0.50], [1.55, 0.0]], 'material': 'paint2', 'depthRange': [1.08, 2.0],
             'facingMin': 0.15},
        ],
        'podLamps': [
            {'node': 'headlights', 'x': 0.42, 'z': 0.80, 'r': 0.075, 'end': 'front', 'bezel': 0.014, 'podDepth': 0.14, 'pod': True},
        ],
        'decals': [
            {'view': 'front', 'rect': [[0.0, 0.57], [0.40, 0.14]], 'radius': 0.03, 'mirror': False, 'material': 'grille',
             'height': 0.004, 'depthRange': [-2.0, -1.6]},
            {'view': 'front', 'outline': [[0.0, 0.73], [0.06, 0.69], [0.06, 0.675], [0.0, 0.715], [-0.06, 0.675], [-0.06, 0.69]],
             'mirror': False, 'material': 'chrome', 'height': 0.008, 'depthRange': [-2.0, -1.5]},
            {'view': 'front', 'outline': [[0.0, 0.70], [0.06, 0.66], [0.06, 0.645], [0.0, 0.685], [-0.06, 0.645], [-0.06, 0.66]],
             'mirror': False, 'material': 'chrome', 'height': 0.008, 'depthRange': [-2.0, -1.5]},
            {'view': 'front', 'node': 'front_blinker_left', 'circle': [[0.59, 0.51], 0.025], 'material': 'IndicatorLights',
             'height': 0.010, 'depthRange': [-2.0, -1.4]},
            {'view': 'front', 'node': 'front_blinker_right', 'circle': [[0.59, 0.51], 0.025], 'material': 'IndicatorLights',
             'height': 0.010, 'depthRange': [-2.0, -1.4]},
            {'view': 'rear', 'node': 'taillights', 'rect': [[0.375, 0.55], [0.12, 0.10]], 'radius': 0.02, 'material': 'TailLights',
             'height': 0.010, 'depthRange': [1.6, 2.0], 'facingMin': 0.1},
            {'view': 'rear', 'node': 'rear_blinker_left', 'rect': [[0.375, 0.48], [0.12, 0.035]], 'radius': 0.01,
             'material': 'IndicatorLights', 'height': 0.010, 'depthRange': [1.6, 2.0], 'facingMin': 0.1},
            {'view': 'rear', 'node': 'rear_blinker_right', 'rect': [[0.375, 0.48], [0.12, 0.035]], 'radius': 0.01,
             'material': 'IndicatorLights', 'height': 0.010, 'depthRange': [1.6, 2.0], 'facingMin': 0.1},
            {'view': 'rear', 'node': 'reverse_lights', 'rect': [[-0.375, 0.45], [0.06, 0.03]], 'radius': 0.01, 'mirror': False,
             'material': 'ReverseLights', 'height': 0.010, 'depthRange': [1.6, 2.0], 'facingMin': 0.1},
            {'view': 'rear', 'rect': [[0.0, 0.54], [0.44, 0.11]], 'radius': 0.005, 'mirror': False, 'material': 'plate',
             'height': 0.006, 'depthRange': [1.6, 2.0], 'facingMin': 0.1},
            {'view': 'front', 'rect': [[0.0, 0.42], [0.44, 0.10]], 'radius': 0.005, 'mirror': False, 'material': 'plate',
             'height': 0.006, 'depthRange': [-2.0, -1.5]},
        ],
        'lines': [
            # Bonnet ribs.
            {'view': 'top', 'points': [[-1.75, 0.10], [-0.70, 0.13]], 'width': 0.010, 'material': 'paint', 'height': 0.006, 'facingMin': 0.3},
            {'view': 'top', 'points': [[-1.75, 0.20], [-0.70, 0.26]], 'width': 0.010, 'material': 'paint', 'height': 0.006, 'facingMin': 0.3},
            {'view': 'top', 'points': [[-1.72, 0.30], [-0.70, 0.38]], 'width': 0.010, 'material': 'paint', 'height': 0.006, 'facingMin': 0.3},
            {'view': 'side', 'points': [[-0.62, 1.05], [-0.65, 0.37], [0.21, 0.37], [0.21, 1.05]], 'width': 0.005},
            {'view': 'side', 'points': [[0.21, 0.37], [0.84, 0.40], [0.85, 1.05]], 'width': 0.005},
            {'view': 'side', 'points': [[-0.66, 1.06], [1.25, 1.06]], 'width': 0.010, 'material': 'trim', 'height': 0.003},
            # the separate rear wing's edge over the skirted wheel
            {'view': 'side', 'points': [[0.88, 0.45], [0.92, 0.66], [1.02, 0.78], [1.20, 0.84], [1.42, 0.83], [1.62, 0.76],
                                        [1.78, 0.62], [1.86, 0.48]], 'width': 0.007, 'keep': True},
        ],
        # thin tubes on brackets well clear of the wings (photo)
        'bumpers': {
            'front': {'z': [0.30, 0.36], 'depth': 0.04, 'wrap': 0.10, 'profile': 'round', 'material': 'alu', 'standMax': 0.5,
                      'span': 1.30},
            'rear': {'z': [0.38, 0.44], 'depth': 0.04, 'wrap': 0.10, 'profile': 'round', 'material': 'alu', 'standMax': 0.5,
                     'span': 1.30},
        },
        'bars': [
            # the grille's chrome ribs
            {'view': 'front', 'span': [-0.19, 0.19], 'b': [0.52, 0.63], 'count': 5, 'width': 0.012, 'material': 'chrome',
             'height': 0.008, 'depthRange': [-2.0, -1.6]},
        ],
        'mirror': {'y': -0.45, 'z': 1.07, 'reach': 0.84, 'w': 0.10, 'h': 0.07, 'shape': 'round', 'sides': [1]},
        'handles': {'at': [[0.10, 0.98], [0.75, 0.98]], 'w': 0.10},
        'wipers': {'arms': [[-0.45, 0.0, -0.66, 1.09], [0.05, 0.45, -0.66, 1.09]]},
        'wheel': {'style': 'hubcap', 'rimFactor': 0.66, 'cap': 0.45},
    },
}
