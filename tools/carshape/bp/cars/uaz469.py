# UAZ-469B (1972-85). Factory: 4025 x 1785 x 2015, wheelbase 2380, overhangs 680/965 (to
# the spare), tracks 1445, 8.40-15, clearance 220. The dimensioned factory drawing of its
# descendant, the UAZ-31514 (the same body; 231 px/m by the wheelbase), with the 469's own
# face: round lamps either side of a slotted grille, sidelights under them, no guard. Slab
# doors narrower than the flat-topped front wings, flared arches, an upright framed
# screen, a canvas top, the spare on the tail door.
DOOR = [[0.40, 0.80], [1.32, 0.80], [1.40, 0.79], [1.82, 0.78], [1.90, 0.74], [1.94, 0.6], [1.96, 0.2]]
WING = [[0.50, 0.84], [0.56, 0.89], [1.10, 0.89], [1.14, 0.86], [1.16, 0.78], [1.22, 0.77], [1.26, 0.5], [1.28, 0.2]]
FLARE = [[0.42, 0.80], [0.50, 0.86], [0.82, 0.86], [0.90, 0.80], [1.32, 0.80], [1.40, 0.79], [1.82, 0.78], [1.90, 0.74], [1.94, 0.6],
         [1.96, 0.2]]
ARCH_F = [[-1.833, 0.4], [-1.815, 0.529], [-1.766, 0.65], [-1.686, 0.754], [-1.583, 0.833], [-1.462, 0.883], [-1.333, 0.9], [-1.203, 0.883], [-1.083, 0.833], [-0.979, 0.754], [-0.899, 0.65], [-0.85, 0.529], [-0.833, 0.4]]
ARCH_R = [[0.548, 0.4], [0.565, 0.529], [0.614, 0.65], [0.694, 0.754], [0.798, 0.833], [0.918, 0.883], [1.048, 0.9], [1.177, 0.883], [1.298, 0.833], [1.401, 0.754], [1.481, 0.65], [1.53, 0.529], [1.548, 0.4]]
CAR = {
    'id': 'uaz469',
    'label': 'UAZ-469',
    'factory': {'length': 4.025, 'width': 1.785, 'height': 2.015, 'clearance': 0.22, 'wheelbase': 2.38,
                'frontTrack': 1.445, 'rearTrack': 1.445, 'wheelRadius': 0.37, 'tyreWidth': 0.215, 'frontOverhang': 0.68},
    'blueprint': {
        'image': 'uaz2.jpg',
        'dark': 120,
        'side': {'box': [780, 60, 1920, 580], 'nose': 'left', 'wheels': [[970, 450], [1520, 450]], 'ground': 535, 'isotropic': True,
                 # Interior, dimension and bull-bar lines all over it: the outline is read off by hand.
                 'outline': [[-1.982, 0.563], [-1.982, 0.662], [-1.861, 0.68], [-1.852, 1.052], [-1.817, 1.19], [-1.722, 1.208],
                             [-0.726, 1.26], [-0.662, 1.264], [-0.445, 1.797], [-0.40, 1.92], [-0.30, 1.95], [1.60, 1.95],
                             [1.685, 1.90], [1.698, 0.606], [1.784, 0.593], [1.784, 0.532], [1.655, 0.515], [-0.77, 0.42],
                             [-1.83, 0.541]]},
        'top': {'box': [783, 783, 1867, 1250], 'nose': 'left', 'fitWidth': True},
        'front': {'box': [158, 83, 600, 558], 'ppm': 231},
        'rear': {'box': [158, 690, 600, 1192], 'ppm': 231},
    },
    'hull': {
        'sill': [[-1.98, 0.54], [-1.4, 0.50], [-0.8, 0.45], [1.0, 0.45], [1.7, 0.52], [1.8, 0.52]],
        'planOverride': [[-2.0, 0.86], [-1.95, 0.89], [1.7, 0.89], [1.8, 0.86]],
        'sectionStations': [
            {'y': -1.90, 'half': WING}, {'y': -0.78, 'half': WING},
            {'y': -0.68, 'half': DOOR}, {'y': 0.72, 'half': DOOR},
            {'y': 0.82, 'half': FLARE}, {'y': 1.50, 'half': FLARE},
            {'y': 1.60, 'half': DOOR},
        ],
        'stationBlend': 0.1,
        # Flat-topped wings either side of the bonnet.
        'topCross': [
            {'y': -1.98, 'z': [[0.0, 1.18], [0.70, 1.17], [0.78, 1.15], [0.80, 1.12], [0.89, 1.12]]},
            {'y': -0.68, 'z': [[0.0, 1.26], [0.70, 1.24], [0.78, 1.21], [0.80, 1.14], [0.89, 1.14]]},
        ],
        'cabin': [-0.66, 1.70],
        'belt': [[-0.66, 1.30], [1.70, 1.32]],
        'glassPlan': [[-0.66, 0.78], [1.70, 0.78]],
        'roofHalf': 0.78,
        'roofCrown': 0.03,
        'edge': 0.016,
        'arch': {'radius': 0.45, 'lift': 0.06},
    },
    'parts': {
        'underbody': {'frame': True},
        'archFlares': [{'axle': 'both', 'r': 0.455, 'w': 0.05, 't': 0.02, 'lift': 0.06, 'material': 'paint'}],
        'paint2': {'name': 'trim_canvas', 'rgb': [0.20, 0.22, 0.16]},
        'glass': [
            {'view': 'side', 'outline': [[-0.40, 1.35], [0.074, 1.35], [0.074, 1.70], [-0.272, 1.70], [-0.337, 1.623]], 'facingMin': 0.3},
            {'view': 'side', 'outline': [[0.152, 1.35], [0.70, 1.35], [0.62, 1.70], [0.152, 1.70]], 'facingMin': 0.3},
            {'view': 'side', 'outline': [[0.80, 1.38], [1.50, 1.38], [1.50, 1.74], [0.80, 1.74]], 'facingMin': 0.3},
            {'view': 'front', 'outline': [[0.0, 1.76], [0.70, 1.76], [0.71, 1.36], [0.0, 1.36]], 'depthRange': [-0.8, -0.3],
             'facingMin': 0.2, 'fit': False},
            {'view': 'rear', 'outline': [[-0.50, 1.75], [0.50, 1.75], [0.50, 1.30], [-0.50, 1.30]], 'mirror': False,
             'depthRange': [1.5, 1.9], 'facingMin': 0.2},
        ],
        'regions': [
            {'view': 'side', 'outline': [[-0.42, 1.33], [-0.42, 2.0], [1.75, 2.0], [1.75, 1.33]], 'material': 'paint2'},
            {'view': 'top', 'outline': [[-0.42, 0.0], [-0.42, 0.79], [1.75, 0.79], [1.75, 0.0]], 'material': 'paint2', 'facingMin': 0.5},
            {'view': 'rear', 'rect': [[0.0, 1.66], [1.8, 0.66]], 'mirror': False, 'material': 'paint2', 'depthRange': [1.5, 1.9]},
            # The black bumper bar at each end.
            {'view': 'front', 'rect': [[0.0, 0.59], [1.80, 0.10]], 'radius': 0.001, 'mirror': False, 'depthRange': [-2.1, -1.8]},
        ],
        'decals': [
            {'view': 'front', 'circle': [[0.55, 0.975], 0.11], 'material': 'chrome', 'height': 0.006, 'depthRange': [-2.1, -1.7]},
            {'view': 'front', 'node': 'headlights', 'circle': [[0.55, 0.975], 0.085], 'material': 'Headlights', 'height': 0.012,
             'depthRange': [-2.1, -1.7]},
            {'view': 'front', 'rect': [[0.0, 0.96], [0.62, 0.30]], 'radius': 0.03, 'mirror': False, 'material': 'grille', 'height': 0.004,
             'depthRange': [-2.1, -1.7]},
            {'view': 'front', 'node': 'front_blinker_left', 'circle': [[0.60, 0.79], 0.035], 'material': 'IndicatorLights',
             'height': 0.010, 'depthRange': [-2.1, -1.7]},
            {'view': 'front', 'node': 'front_blinker_right', 'circle': [[0.60, 0.79], 0.035], 'material': 'IndicatorLights',
             'height': 0.010, 'depthRange': [-2.1, -1.7]},
            {'view': 'front', 'rect': [[0.0, 0.72], [0.52, 0.11]], 'radius': 0.005, 'mirror': False, 'material': 'plate',
             'height': 0.006, 'depthRange': [-2.1, -1.7]},
            {'view': 'rear', 'node': 'taillights', 'rect': [[0.78, 0.92], [0.11, 0.12]], 'radius': 0.01, 'material': 'TailLights',
             'height': 0.010, 'depthRange': [1.5, 1.9], 'facingMin': 0.2},
            {'view': 'rear', 'node': 'rear_blinker_left', 'rect': [[0.78, 1.03], [0.11, 0.08]], 'radius': 0.01,
             'material': 'IndicatorLights', 'height': 0.010, 'depthRange': [1.5, 1.9], 'facingMin': 0.2},
            {'view': 'rear', 'node': 'rear_blinker_right', 'rect': [[0.78, 1.03], [0.11, 0.08]], 'radius': 0.01,
             'material': 'IndicatorLights', 'height': 0.010, 'depthRange': [1.5, 1.9], 'facingMin': 0.2},
            {'view': 'rear', 'node': 'reverse_lights', 'rect': [[0.78, 0.82], [0.11, 0.06]], 'radius': 0.01,
             'material': 'ReverseLights', 'height': 0.010, 'depthRange': [1.5, 1.9], 'facingMin': 0.2},
            {'view': 'rear', 'rect': [[-0.40, 0.88], [0.30, 0.15]], 'radius': 0.005, 'mirror': False, 'material': 'plate',
             'height': 0.006, 'depthRange': [1.5, 1.9], 'facingMin': 0.2},
        ],
        'bars': [
            {'view': 'front', 'span': [-0.28, 0.28], 'b': [0.84, 1.08], 'count': 9, 'width': 0.03, 'dir': 'v',
             'material': 'paint', 'height': 0.006, 'depthRange': [-2.1, -1.7]},
        ],
        'lines': [
            {'view': 'side', 'points': [[-0.66, 1.30], [-0.66, 0.48], [0.11, 0.48], [0.11, 1.30]], 'width': 0.006},
            {'view': 'side', 'points': [[0.13, 1.30], [0.13, 0.48], [0.75, 0.48], [0.76, 1.30]], 'width': 0.006},
            {'view': 'side', 'points': [[-1.80, 1.10], [-0.75, 1.13]], 'width': 0.005},
            {'view': 'rear', 'points': [[-0.70, 0.62], [-0.70, 1.30], [0.70, 1.30], [0.70, 0.62]], 'mirror': False, 'width': 0.006,
             'depthRange': [1.5, 1.9], 'facingMin': 0.2},
        ],
        'bumpers': {
            'front': {'z': [0.55, 0.65], 'depth': 0.10, 'wrap': 0.05, 'profile': 'blade', 'material': 'trim', 'standOff': 0.0},
            'rear': {'z': [0.52, 0.60], 'depth': 0.06, 'wrap': 0.05, 'profile': 'blade', 'material': 'trim', 'standOff': 0.0},
        },
        'spares': [{'c': [0.19, 1.82, 1.0], 'n': [0, 1, 0], 'r': 0.37, 'w': 0.21}],
        'mirror': {'y': -0.55, 'z': 1.42, 'reach': 1.02, 'w': 0.12, 'h': 0.17},
        'handles': {'at': [[-0.05, 1.20], [0.65, 1.20]], 'w': 0.10},
        'wipers': {'arms': [[-0.55, -0.1, -0.68, 1.36], [0.05, 0.5, -0.68, 1.36]]},
        'wheel': {'style': 'steel', 'windows': 0, 'rimFactor': 0.62, 'cap': True},
    },
}
