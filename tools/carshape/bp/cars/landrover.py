# Land Rover Series III 88 soft top (1971-85). Factory: 3620 x 1680 x 1970, wheelbase 2235,
# tracks 1310, 6.00-16, clearance 210. The four views of the 88 at getoutlines.com (the
# 1973 pickup with its tilt; 3x upscaled, 388 px/m by the wheelbase). The tool: a flat
# bonnet between flat-topped wings that carry the lamps, a recessed grille panel, an
# upright framed screen on the bulkhead, slab cab and tub sides under a canvas tilt, a
# plain steel bumper.
WING = [[0.45, 0.82], [0.52, 0.84], [1.08, 0.84], [1.12, 0.80], [1.16, 0.79], [1.20, 0.5], [1.22, 0.2]]
BOX = [[0.42, 0.82], [0.50, 0.84], [1.17, 0.84], [1.20, 0.82], [1.75, 0.81], [1.80, 0.78], [1.83, 0.6], [1.86, 0.2]]
CAR = {
    'id': 'landrover',
    'label': 'Land Rover 88',
    'factory': {'length': 3.62, 'width': 1.68, 'height': 1.97, 'clearance': 0.21, 'wheelbase': 2.235,
                'frontTrack': 1.31, 'rearTrack': 1.31, 'wheelRadius': 0.37, 'tyreWidth': 0.16, 'frontOverhang': 0.56},
    'blueprint': {
        'image': 'lr88_go.png',
        'dark': 150,
        'side': {'box': [0, 0, 1615, 740], 'nose': 'right', 'wheels': [[512, 589], [1378.5, 589]], 'ground': 732, 'isotropic': True,
                 'drop': [[0, 345, 248, 525]]},
        'top': {'box': [200, 740, 1610, 1390], 'nose': 'right', 'fitWidth': True},
        'front': {'box': [1635, 15, 2310, 720], 'zRef': [[44, 1.83], [690, 0.0]], 'ppm': 353},
        'rear': {'box': [1635, 720, 2310, 1400], 'zRef': [[728, 1.83], [1377, 0.0]], 'ppm': 355},
    },
    'hull': {
        'sill': [[-1.82, 0.48], [1.82, 0.45]],
        'planOverride': [[-1.82, 0.80], [-1.78, 0.84], [1.78, 0.84], [1.82, 0.82]],
        # Flat-topped wings either side of the slightly domed bonnet.
        'topCross': [
            {'y': -1.82, 'z': [[0.0, 1.12], [0.30, 1.11], [0.37, 1.08], [0.40, 1.10], [0.80, 1.10], [0.84, 1.07]]},
            {'y': -0.52, 'z': [[0.0, 1.20], [0.30, 1.18], [0.37, 1.13], [0.40, 1.16], [0.80, 1.16], [0.84, 1.12]]},
        ],
        'cabin': [-0.50, 1.80],
        'belt': [[-0.50, 1.17], [1.80, 1.17]],
        'glassPlan': [[-0.50, 0.81], [1.80, 0.81]],
        # Slab sides: the wings, the cab and the tub are one width all the way up.
        'sectionStations': [{'y': -1.80, 'half': WING}, {'y': -0.56, 'half': WING}, {'y': -0.50, 'half': BOX}, {'y': 1.75, 'half': BOX}],
        'stationBlend': 0.08,
        'roofHalf': 0.81,
        'roofCrown': 0.02,
        'edge': 0.012,
        'arch': {'radius': 0.43, 'lift': 0.0},
    },
    'parts': {
        'underbody': {'frame': True},
        'paint2': {'name': 'trim_canvas', 'rgb': [0.32, 0.30, 0.22]},
        'glass': [
            {'view': 'side', 'outline': [[0.33, 1.22], [-0.27, 1.22], [-0.27, 1.62], [0.33, 1.62]], 'facingMin': 0.3},
            {'view': 'front', 'outline': [[0.03, 1.38], [0.70, 1.38], [0.72, 1.76], [0.03, 1.76]], 'depthRange': [-0.7, -0.2],
             'facingMin': 0.2, 'fit': False},
            {'view': 'rear', 'outline': [[0.03, 1.42], [0.72, 1.42], [0.72, 1.75], [0.03, 1.75]], 'depthRange': [1.5, 1.9],
             'facingMin': 0.2, 'fit': False},
        ],
        'regions': [
            # The canvas tilt over the cab and the tub.
            {'view': 'side', 'outline': [[0.40, 1.18], [1.85, 1.18], [1.85, 1.95], [0.40, 1.95]], 'material': 'paint2'},
            {'view': 'side', 'outline': [[-0.45, 1.68], [0.40, 1.68], [0.40, 1.95], [-0.45, 1.95]], 'material': 'paint2'},
            {'view': 'top', 'outline': [[-0.45, 0.0], [-0.45, 0.9], [1.85, 0.9], [1.85, 0.0]], 'material': 'paint2', 'facingMin': 0.5},
            {'view': 'rear', 'rect': [[0.0, 1.57], [1.8, 0.80]], 'mirror': False, 'material': 'paint2', 'depthRange': [1.5, 1.95]},
            # The grille panel sits back between the wings, black.
            {'view': 'front', 'outline': [[0.0, 1.10], [0.20, 1.10], [0.20, 1.06], [0.37, 1.06], [0.37, 0.71], [0.0, 0.71]],
             'depthRange': [-1.95, -1.5]},
        ],
        'decals': [
            {'view': 'front', 'rect': [[0.0, 0.89], [0.62, 0.26]], 'radius': 0.03, 'mirror': False, 'material': 'grille',
             'height': 0.004, 'depthRange': [-1.95, -1.5]},
            {'view': 'front', 'rect': [[0.59, 0.86], [0.36, 0.30]], 'radius': 0.02, 'material': 'trim', 'height': 0.003,
             'depthRange': [-1.95, -1.5]},
            {'view': 'front', 'circle': [[0.52, 0.88], 0.10], 'material': 'chrome', 'height': 0.006, 'depthRange': [-1.95, -1.5]},
            {'view': 'front', 'node': 'headlights', 'circle': [[0.52, 0.88], 0.085], 'material': 'Headlights', 'height': 0.010,
             'depthRange': [-1.95, -1.5]},
            {'view': 'front', 'node': 'front_blinker_left', 'circle': [[0.71, 0.80], 0.03], 'material': 'IndicatorLights',
             'height': 0.010, 'depthRange': [-1.95, -1.5]},
            {'view': 'front', 'node': 'front_blinker_right', 'circle': [[0.71, 0.80], 0.03], 'material': 'IndicatorLights',
             'height': 0.010, 'depthRange': [-1.95, -1.5]},
            {'view': 'front', 'circle': [[0.71, 0.96], 0.03], 'material': 'Headlights', 'height': 0.010, 'depthRange': [-1.95, -1.5]},
            {'view': 'rear', 'node': 'taillights', 'circle': [[0.77, 1.07], 0.045], 'material': 'TailLights', 'height': 0.012,
             'depthRange': [1.5, 1.95], 'facingMin': 0.2},
            {'view': 'rear', 'node': 'rear_blinker_left', 'circle': [[0.77, 0.96], 0.045], 'material': 'IndicatorLights',
             'height': 0.012, 'depthRange': [1.5, 1.95], 'facingMin': 0.2},
            {'view': 'rear', 'node': 'rear_blinker_right', 'circle': [[0.77, 0.96], 0.045], 'material': 'IndicatorLights',
             'height': 0.012, 'depthRange': [1.5, 1.95], 'facingMin': 0.2},
            {'view': 'rear', 'node': 'reverse_lights', 'rect': [[-0.64, 0.99], [0.09, 0.04]], 'radius': 0.01, 'mirror': False,
             'material': 'ReverseLights', 'height': 0.010, 'depthRange': [1.5, 1.95], 'facingMin': 0.2},
            {'view': 'rear', 'rect': [[0.0, 0.78], [0.40, 0.13]], 'radius': 0.005, 'mirror': False, 'material': 'plate',
             'height': 0.006, 'depthRange': [1.5, 1.95], 'facingMin': 0.2},
            {'view': 'front', 'rect': [[0.0, 0.46], [0.50, 0.10]], 'radius': 0.005, 'mirror': False, 'material': 'plate',
             'height': 0.006, 'depthRange': [-2.0, -1.5]},
        ],
        'bars': [
            {'view': 'front', 'span': [-0.30, 0.30], 'b': [0.74, 1.04], 'count': 10, 'width': 0.012, 'dir': 'v',
             'material': 'trim', 'height': 0.006, 'depthRange': [-1.95, -1.5]},
        ],
        'lines': [
            {'view': 'side', 'points': [[-0.49, 1.66], [-0.49, 0.52], [0.37, 0.52], [0.37, 1.66]], 'width': 0.008},
            {'view': 'side', 'points': [[-0.49, 1.17], [0.37, 1.17]], 'width': 0.008},
            {'view': 'side', 'points': [[-1.78, 1.06], [-0.50, 1.10]], 'width': 0.005},
            {'view': 'side', 'points': [[0.40, 1.17], [1.80, 1.17]], 'width': 0.02, 'material': 'paint', 'height': 0.012},
            {'view': 'rear', 'points': [[-0.50, 0.70], [-0.50, 1.20], [0.50, 1.20], [0.50, 0.70]], 'mirror': False, 'width': 0.008,
             'depthRange': [1.5, 1.95], 'facingMin': 0.2},
            {'view': 'rear', 'points': [[0.0, 0.72], [0.0, 1.17]], 'mirror': False, 'width': 0.008, 'depthRange': [1.5, 1.95],
             'facingMin': 0.2},
        ],
        'bumpers': {
            'front': {'z': [0.51, 0.62], 'depth': 0.10, 'wrap': 0.02, 'profile': 'blade', 'material': 'trim', 'standOff': 0.0},
            'rear': {'z': [0.50, 0.56], 'depth': 0.06, 'wrap': 0.02, 'profile': 'blade', 'material': 'trim', 'standOff': 0.0},
        },
        'mirror': {'y': -0.45, 'z': 1.32, 'reach': 1.0, 'w': 0.13, 'h': 0.13, 'shape': 'round'},
        'handles': {'at': [[0.25, 1.08]], 'w': 0.10},
        'wipers': {'arms': [[-0.55, -0.1, -0.52, 1.75], [0.1, 0.55, -0.52, 1.75]]},
        'wheel': {'style': 'steel', 'windows': 0, 'rimFactor': 0.62, 'cap': True},
    },
}
