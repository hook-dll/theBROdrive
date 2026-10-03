# Mini Cooper S (Mk I-II). Factory: 3054 x 1410 x 1346, wheelbase 2036, tracks 1214/1176,
# 145-10, clearance 150. The drawing reprinted at 3dcar.ru/blueprints/mini (a late car:
# its alloy wheels and arch extensions are not the Cooper S's).
CAR = {
    'id': 'mini',
    'label': 'Mini Cooper S',
    'factory': {'length': 3.054, 'width': 1.41, 'height': 1.346, 'clearance': 0.15, 'wheelbase': 2.036,
                'frontTrack': 1.214, 'rearTrack': 1.176, 'wheelRadius': 0.255, 'tyreWidth': 0.145, 'frontOverhang': 0.45},
    'blueprint': {
        'image': 'mini.jpg',
        'side': {'box': [700, 57, 1741, 524], 'nose': 'left', 'wheels': [[875.5, 425.5], [1554.5, 425.5]], 'ground': 516},
        'top': {'box': [695, 532, 1738, 1056], 'nose': 'left'},
        'front': {'box': [67, 70, 557, 523]},
        'rear': {'box': [70, 588, 557, 1047]},
    },
    'hull': {
        'bumpers': {'front': {'z': [0.42, 0.52]}, 'rear': {'z': [0.40, 0.52]}},
        'sill': [[-1.6, 0.36], [-1.4, 0.28], [-1.2, 0.22], [0.8, 0.22], [1.2, 0.25], [1.45, 0.36]],
        'cabin': [-0.80, 1.22],
        'belt': [[-0.80, 0.90], [-0.5, 0.87], [0.9, 0.865], [1.22, 0.87]],
        'glassPlan': [[-0.80, 0.56], [-0.5, 0.60], [0.9, 0.60], [1.22, 0.54]],
        'crown': [[-1.7, 0.03], [1.7, 0.03]],
        'roofCrown': 0.035,
        'edge': 0.016,
        # The wing's skin is nearly parallel to the arch's cylinder round the front of
        # the opening: a 12 mm lip left a row of teeth on the rim there (the Golf's
        # steeper wing is clean at the default). 30 mm smooths the intersection.
        'archLip': 0.03,
        'arch': {'radius': 0.29, 'lift': 0.05},
    },
    'parts': {
        # The Cooper S's contrasting roof (photos of 1965 cars: black over red, white over blue).
        'paint2': {'name': 'trim_roof', 'rgb': [0.03, 0.03, 0.035]},
        'regions': [
            # The roof panel with its rolled edge, the seam hidden by the gutter line
            # below. Every edge of this outline is a cut plane, so the black/body
            # boundary is the drawn outline: an outline out past the roof's edge let
            # the facing limit decide instead and left a staircase of whole triangles.
            {'view': 'top', 'outline': [[-0.53, 0.0], [-0.53, 0.34], [-0.50, 0.46], [-0.44, 0.49], [0.55, 0.49],
                                        [0.88, 0.485], [0.97, 0.46], [1.02, 0.38], [1.04, 0.18], [1.045, 0.0]],
             'material': 'paint2', 'depthRange': [1.14, 1.5], 'facingMin': 0.2},
        ],
        'glass': [
            {'view': 'side', 'outline': [[-0.509, 0.98], [-0.434, 0.95], [-0.434, 0.90], [-0.512, 0.873], [0.184, 0.864], [0.184, 1.135],
                                         [0.139, 1.179], [-0.341, 1.176], [-0.383, 1.144]], 'facingMin': 0.3},
            {'view': 'side', 'outline': [[0.253, 1.111], [0.253, 0.929], [0.289, 0.867], [0.91, 0.861], [0.958, 0.887], [0.952, 0.932],
                                         [0.862, 1.09], [0.784, 1.17], [0.337, 1.185], [0.271, 1.161]], 'facingMin': 0.3},
            {'view': 'front', 'outline': [[0.0, 1.235], [0.41, 1.23], [0.44, 1.20], [0.48, 0.94], [0.46, 0.915], [0.0, 0.915]],
             'depthRange': [-0.95, -0.4], 'facingMin': 0.1},
            {'view': 'rear', 'outline': [[0.0, 1.20], [0.45, 1.195], [0.49, 1.16], [0.50, 0.92], [0.47, 0.89], [0.0, 0.89]],
             'depthRange': [0.9, 1.5], 'facingMin': 0.25},
        ],
        'decals': [
            # The moustache grille: a chrome frame round horizontal slats.
            {'view': 'front', 'outline': [[0.0, 0.73], [0.36, 0.72], [0.40, 0.70], [0.455, 0.53], [0.44, 0.51], [0.0, 0.51]],
             'material': 'chrome', 'height': 0.006, 'depthRange': [-1.7, -1.3]},
            {'view': 'front', 'outline': [[0.0, 0.71], [0.35, 0.70], [0.385, 0.685], [0.43, 0.54], [0.42, 0.525], [0.0, 0.525]],
             'material': 'grille', 'height': 0.007, 'depthRange': [-1.7, -1.3]},
            {'view': 'front', 'node': 'front_blinker_left', 'circle': [[0.52, 0.555], 0.033], 'material': 'IndicatorLights',
             'height': 0.010, 'depthRange': [-1.7, -1.2]},
            {'view': 'front', 'node': 'front_blinker_right', 'circle': [[0.52, 0.555], 0.033], 'material': 'IndicatorLights',
             'height': 0.010, 'depthRange': [-1.7, -1.2]},
            {'view': 'front', 'circle': [[0.52, 0.555], 0.042], 'ring': 0.009, 'material': 'chrome',
             'height': 0.011, 'depthRange': [-1.7, -1.2]},
            {'view': 'front', 'rect': [[0.0, 0.37], [0.52, 0.09]], 'radius': 0.006, 'mirror': False, 'material': 'plate',
             'height': 0.005, 'depthRange': [-1.7, -1.3]},
            # Upright tail lamps on the rear wings: amber, red, red.
            {'view': 'rear', 'rect': [[0.57, 0.61], [0.11, 0.23]], 'radius': 0.008, 'material': 'chrome',
             'height': 0.006, 'facingMin': -0.1, 'depthRange': [1.2, 1.7]},
            {'view': 'rear', 'node': 'rear_blinker_left', 'rect': [[0.57, 0.69], [0.09, 0.055]], 'radius': 0.005,
             'material': 'IndicatorLights', 'height': 0.010, 'facingMin': -0.1, 'depthRange': [1.2, 1.7]},
            {'view': 'rear', 'node': 'rear_blinker_right', 'rect': [[0.57, 0.69], [0.09, 0.055]], 'radius': 0.005,
             'material': 'IndicatorLights', 'height': 0.010, 'facingMin': -0.1, 'depthRange': [1.2, 1.7]},
            {'view': 'rear', 'node': 'taillights', 'rect': [[0.57, 0.585], [0.09, 0.14]], 'radius': 0.005,
             'material': 'TailLights', 'height': 0.010, 'facingMin': -0.1, 'depthRange': [1.2, 1.7]},
            {'view': 'rear', 'node': 'reverse_lights', 'rect': [[0.0, 0.70], [0.24, 0.025]], 'radius': 0.006, 'mirror': False,
             'material': 'ReverseLights', 'height': 0.008, 'depthRange': [1.2, 1.7]},
            {'view': 'rear', 'rect': [[0.0, 0.615], [0.52, 0.11]], 'radius': 0.006, 'mirror': False, 'material': 'plate',
             'height': 0.006, 'depthRange': [1.2, 1.7]},
        ],
        # The headlamps sit in the wings' front faces behind a chrome rim: no housing
        # stands proud of the skin (a pod there read as a boss round each lamp).
        'podLamps': [{'node': 'headlights', 'x': 0.51, 'z': 0.745, 'r': 0.085, 'bezel': 0.016, 'pod': False,
                      'proud': 0.0, 'seat': 'flush'}],
        'bars': [
            {'view': 'front', 'span': [-0.40, 0.40], 'b': [0.54, 0.70], 'count': 7, 'width': 0.008,
             'material': 'chrome', 'height': 0.009, 'depthRange': [-1.7, -1.3]},
        ],
        'lines': [
            # The Mini's welded seams stand outside: down the A-pillar and round the roof.
            # The wing's rear edge leaves the door's front edge at the belt (the drawing:
            # -0.665 at 0.95, -0.71 at 0.90, -0.78 at 0.80) and runs forward-down to the
            # arch's rim, not 12 cm behind it (it crossed the door's line and read as an X).
            {'view': 'side', 'points': [[-0.68, 0.945], [-0.89, 0.60]], 'width': 0.008, 'material': 'paint', 'height': 0.006},
            {'view': 'side', 'points': [[-0.47, 1.27], [-0.33, 1.29], [0.75, 1.27], [0.99, 1.23]], 'width': 0.01, 'material': 'chrome', 'height': 0.006},
            {'view': 'side', 'points': [[-0.68, 0.75], [-0.68, 0.38], [-0.65, 0.36], [0.20, 0.36], [0.235, 0.40], [0.235, 0.86]], 'width': 0.005},
            {'view': 'side', 'points': [[-1.52, 0.33], [1.44, 0.35]], 'width': 0.008, 'material': 'paint', 'height': 0.008},
            {'view': 'rear', 'points': [[0.0, 0.82], [0.40, 0.81], [0.47, 0.75], [0.47, 0.52], [0.40, 0.50], [0.0, 0.50]],
             'width': 0.005, 'depthRange': [1.2, 1.7]},
            {'view': 'side', 'points': [[-0.51, 0.87], [0.96, 0.86]], 'width': 0.01, 'material': 'chrome', 'height': 0.003},
        ],
        'bumpers': {
            'front': {'z': [0.465, 0.505], 'depth': 0.045, 'wrap': 0.20, 'profile': 'blade',
                      'overriders': [[0.30, 0.04, 0.36, 0.62]]},
            'rear': {'z': [0.46, 0.50], 'depth': 0.045, 'wrap': 0.20, 'profile': 'blade',
                     'overriders': [[0.30, 0.04, 0.36, 0.60]]},
        },
        # The drawn mirror stands on the door at the A-pillar's foot, its head just off
        # the skin: reach is the head's outer edge (the body's side there is at 0.60,
        # the widest point 0.697), not out in the air.
        'mirror': {'y': -0.51, 'z': 0.92, 'reach': 0.72, 'w': 0.10, 'shape': 'round', 'material': 'chrome'},
        'handles': {'at': [[0.08, 0.80]], 'w': 0.10},
        'wipers': {'arms': [[-0.45, -0.05, -0.82, 0.90], [0.05, 0.42, -0.82, 0.90]]},
        'wheel': {'style': 'steel', 'windows': 8, 'rimFactor': 0.62, 'cap': True},
    },
}
