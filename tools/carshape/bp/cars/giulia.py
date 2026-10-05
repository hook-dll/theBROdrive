# Alfa Romeo Giulia Super (1965-72). Factory: 4140 x 1560 x 1430, wheelbase 2510, tracks
# 1310/1270, 155 SR 15, clearance 150. The four views of the Giulia Super 1300/1600 at
# the-blueprints.com (preview, 1:25; 171.9 px/m by the wheelbase on the side, 174.4 on
# the ends; build/carshape/_refs/bp/img/giulia_tb.jpg): every outline read off it on a
# 5 cm grid. Autocar's cutaway used before is an artist's sketch: a sloping
# nose, a rounded boot and a domed, tumblehomed glasshouse the car does not have.
# The brick shaped by the wind: an upright nose with four round lamps in chrome rings
# and the shield in a slim grille between them, flat slab sides with a shoulder crease,
# a tall glasshouse on thin pillars under a flat roof whose peak overhangs the back light,
# the short Kamm-tailed boot with oblong lamps low on its panel.
CAR = {
    'id': 'giulia',
    'label': 'Alfa Romeo Giulia',
    'factory': {'length': 4.14, 'width': 1.56, 'height': 1.43, 'clearance': 0.15, 'wheelbase': 2.51,
                'frontTrack': 1.31, 'rearTrack': 1.27, 'wheelRadius': 0.315, 'tyreWidth': 0.155, 'frontOverhang': 0.655},
    'blueprint': {
        'image': 'giulia_tb.jpg',
        'dark': 140,
        'side': {'box': [80, 60, 820, 340], 'nose': 'left', 'wheels': [[202, 276], [633, 276]], 'ground': 330, 'isotropic': True,
                 'outline': [[-2.01, 0.30], [-2.02, 0.42], [-2.02, 0.66], [-1.99, 0.72], [-1.95, 0.76], [-1.88, 0.795],
                             [-1.76, 0.83], [-1.62, 0.855], [-1.44, 0.878], [-1.25, 0.896], [-1.07, 0.908], [-0.97, 0.93],
                             [-0.93, 0.955], [-0.51, 1.35], [-0.46, 1.373], [-0.40, 1.387], [0.10, 1.39], [0.50, 1.376],
                             [0.75, 1.362], [0.90, 1.344], [0.985, 1.326], [1.00, 1.30], [1.25, 0.92], [1.50, 0.90],
                             [1.70, 0.876], [1.87, 0.855], [1.96, 0.838], [2.00, 0.81], [2.02, 0.76], [2.03, 0.45],
                             [2.00, 0.32], [1.90, 0.27], [1.50, 0.26], [0.80, 0.225], [-1.00, 0.225], [-1.75, 0.25],
                             [-1.90, 0.26], [-1.98, 0.29]]},
        # Upright slab sides with the wings' crease at the shoulder, a glasshouse leaning
        # in only 7 cm over its height, the roof's gutters at its corners.
        'front': {'box': [900, 80, 1215, 335], 'ppm': 174.4, 'centre': 1055, 'zRef': [[91, 1.39], [331, 0.0]],
                  'outline': [[0.0, 1.39], [0.45, 1.385], [0.553, 1.364], [0.62, 1.31], [0.62, 1.26], [0.69, 0.91],
                              [0.765, 0.875], [0.77, 0.80], [0.783, 0.66], [0.774, 0.56], [0.754, 0.45], [0.731, 0.35],
                              [0.722, 0.20], [0.72, 0.0], [0.0, 0.0]]},
        'rear': {'box': [900, 495, 1215, 750], 'ppm': 174.4, 'centre': 1055, 'zRef': [[507, 1.39], [747, 0.0]],
                 'outline': [[0.0, 1.39], [0.45, 1.385], [0.553, 1.364], [0.62, 1.31], [0.62, 1.26], [0.69, 0.91],
                             [0.765, 0.875], [0.77, 0.80], [0.78, 0.65], [0.771, 0.55], [0.76, 0.45], [0.731, 0.35],
                             [0.722, 0.20], [0.72, 0.0], [0.0, 0.0]]},
    },
    'hull': {
        'bumpers': {'front': {'z': [0.32, 0.45]}, 'rear': {'z': [0.31, 0.45]}},
        'sill': [[-2.02, 0.30], [-1.85, 0.25], [-1.0, 0.225], [0.8, 0.225], [1.5, 0.26], [2.02, 0.32]],
        # The top view: the nose squarish, the front wings swelling over the wheels, the
        # body tapering a little to the tail.
        'planOverride': [[-2.06, 0.60], [-2.02, 0.69], [-1.90, 0.70], [-1.75, 0.72], [-1.60, 0.765], [-1.40, 0.78],
                         [-1.15, 0.77], [0.50, 0.77], [1.00, 0.758], [1.50, 0.732], [1.80, 0.715], [1.98, 0.70],
                         [2.03, 0.62]],
        'cabin': [-0.93, 1.25],
        'belt': [[-0.93, 0.955], [-0.55, 0.95], [0.85, 0.95], [1.25, 0.925]],
        'glassPlan': [[-0.93, 0.64], [-0.55, 0.69], [0.85, 0.69], [1.25, 0.64]],
        'crown': [[-2.2, 0.012], [2.2, 0.012]],
        'roofCrown': 0.015,
        'edge': 0.010,
        # the brick: crisp edges and flat sides (the default blur rounded it into a pebble)
        'edgeMin': 0.015,
        'edgeY': 0.04,
        'edgeYMin': 0.04,
        'arch': {'radius': 0.37, 'lift': 0.04},
    },
    'parts': {
        'glass': [
            # Thin pillars: the front door's glass (its vent pane in front) from the screen
            # pillar to the B-pillar, the rear door's back to the C-pillar's slant.
            {'view': 'side', 'outline': [[-0.53, 0.95], [-0.40, 1.285], [0.095, 1.285], [0.095, 0.95]], 'facingMin': 0.3},
            {'view': 'side', 'outline': [[0.185, 0.95], [0.185, 1.28], [0.70, 1.275], [0.75, 1.24], [0.88, 0.95]], 'facingMin': 0.3},
            {'view': 'front', 'outline': [[0.0, 1.33], [0.50, 1.325], [0.56, 1.29], [0.63, 0.97], [0.60, 0.955], [0.0, 0.955]],
             'depthRange': [-1.1, -0.4], 'facingMin': 0.2},
            {'view': 'rear', 'outline': [[0.0, 1.29], [0.50, 1.285], [0.56, 1.25], [0.62, 0.95], [0.58, 0.93], [0.0, 0.93]],
             'depthRange': [0.9, 1.4], 'facingMin': 0.15},
        ],
        'decals': [
            # The nose (front view): the outer lamps the larger, each in a chrome ring; a slim
            # grille between the inner pair, the shield over it; turn lamps under the outer
            # lamps over the bumper.
            {'view': 'front', 'rect': [[0.0, 0.59], [0.62, 0.075]], 'radius': 0.01, 'mirror': False, 'material': 'grille',
             'height': 0.005, 'depthRange': [-2.2, -1.8]},
            {'view': 'front', 'circle': [[0.53, 0.59], 0.092], 'material': 'chrome', 'height': 0.007, 'depthRange': [-2.2, -1.8]},
            {'view': 'front', 'node': 'headlights', 'circle': [[0.53, 0.59], 0.076], 'material': 'Headlights', 'height': 0.011,
             'depthRange': [-2.2, -1.8]},
            {'view': 'front', 'circle': [[0.353, 0.586], 0.072], 'material': 'chrome', 'height': 0.007, 'depthRange': [-2.2, -1.8]},
            {'view': 'front', 'node': 'headlights', 'circle': [[0.353, 0.586], 0.06], 'material': 'Headlights', 'height': 0.011,
             'depthRange': [-2.2, -1.8]},
            {'view': 'front', 'outline': [[0.0, 0.70], [0.085, 0.69], [0.08, 0.58], [0.0, 0.50], [-0.08, 0.58], [-0.085, 0.69]],
             'mirror': False, 'material': 'chrome', 'height': 0.010, 'depthRange': [-2.2, -1.8]},
            {'view': 'front', 'outline': [[0.0, 0.68], [0.065, 0.672], [0.06, 0.585], [0.0, 0.525], [-0.06, 0.585], [-0.065, 0.672]],
             'mirror': False, 'material': 'grille', 'height': 0.012, 'depthRange': [-2.2, -1.8]},
            {'view': 'front', 'node': 'front_blinker_left', 'rect': [[0.53, 0.475], [0.15, 0.035]], 'radius': 0.01,
             'material': 'IndicatorLights', 'height': 0.010, 'depthRange': [-2.2, -1.8]},
            {'view': 'front', 'node': 'front_blinker_right', 'rect': [[0.53, 0.475], [0.15, 0.035]], 'radius': 0.01,
             'material': 'IndicatorLights', 'height': 0.010, 'depthRange': [-2.2, -1.8]},
            # The Kamm tail (rear view): oblong lamps in chrome rims low on the panel, just
            # over the bumper, the turn lamp at the outer end.
            {'view': 'rear', 'rect': [[0.47, 0.58], [0.30, 0.085]], 'radius': 0.012, 'material': 'chrome',
             'height': 0.006, 'depthRange': [1.7, 2.2], 'facingMin': 0.05},
            {'view': 'rear', 'node': 'taillights', 'rect': [[0.44, 0.58], [0.20, 0.06]], 'radius': 0.008, 'material': 'TailLights',
             'height': 0.010, 'depthRange': [1.7, 2.2], 'facingMin': 0.05},
            {'view': 'rear', 'node': 'rear_blinker_left', 'rect': [[0.575, 0.58], [0.065, 0.06]], 'radius': 0.008,
             'material': 'IndicatorLights', 'height': 0.010, 'depthRange': [1.7, 2.2], 'facingMin': 0.05},
            {'view': 'rear', 'node': 'rear_blinker_right', 'rect': [[0.575, 0.58], [0.065, 0.06]], 'radius': 0.008,
             'material': 'IndicatorLights', 'height': 0.010, 'depthRange': [1.7, 2.2], 'facingMin': 0.05},
            {'view': 'rear', 'node': 'reverse_lights', 'rect': [[0.0, 0.66], [0.10, 0.03]], 'radius': 0.01, 'mirror': False,
             'material': 'ReverseLights', 'height': 0.010, 'depthRange': [1.7, 2.2], 'facingMin': 0.05},
        ],
        'bars': [
            {'view': 'front', 'span': [-0.30, 0.30], 'b': [0.57, 0.61], 'count': 2, 'width': 0.008, 'material': 'chrome',
             'height': 0.007, 'depthRange': [-2.2, -1.8]},
        ],
        'lines': [
            # the shoulder crease from the lamps to the tail, the moulding along the doors
            {'view': 'side', 'points': [[-1.95, 0.80], [1.98, 0.80]], 'width': 0.008, 'material': 'paint', 'height': 0.004},
            {'view': 'side', 'points': [[-1.30, 0.51], [0.85, 0.51]], 'width': 0.008, 'material': 'chrome', 'height': 0.003},
            {'view': 'side', 'points': [[-0.80, 0.95], [-0.80, 0.30], [0.13, 0.28], [0.13, 0.95]], 'width': 0.005},
            {'view': 'side', 'points': [[0.13, 0.28], [0.80, 0.29], [0.86, 0.42], [0.90, 0.95]], 'width': 0.005},
            {'view': 'side', 'points': [[-0.33, 0.95], [-0.33, 1.285]], 'width': 0.010, 'material': 'chrome', 'height': 0.003},
            {'view': 'side', 'points': [[-0.55, 0.945], [-0.41, 1.30], [0.10, 1.30], [0.17, 1.30], [0.71, 1.29], [0.77, 1.245],
                                        [0.90, 0.945]], 'width': 0.012, 'material': 'chrome', 'height': 0.003},
            {'view': 'top', 'points': [[1.30, 0.0], [1.30, 0.58], [1.98, 0.62]], 'width': 0.005, 'facingMin': 0.5},
        ],
        'bumpers': {
            'front': {'z': [0.34, 0.42], 'depth': 0.05, 'wrap': 0.28, 'profile': 'blade', 'standOff': -0.03,
                      'overriders': [[0.36, 0.04, 0.34, 0.50]]},
            'rear': {'z': [0.33, 0.43], 'depth': 0.05, 'wrap': 0.28, 'profile': 'blade', 'standOff': -0.03,
                     'overriders': [[0.40, 0.04, 0.30, 0.48]]},
        },
        'mirror': {'y': -0.58, 'z': 0.96, 'reach': 0.81, 'w': 0.10, 'h': 0.07, 'material': 'chrome', 'shape': 'round', 'sides': [1]},
        'handles': {'at': [[-0.02, 0.84], [0.80, 0.84]], 'w': 0.11},
        'wipers': {'arms': [[-0.5, -0.05, -0.92, 0.98], [0.05, 0.5, -0.92, 0.98]]},
        'wheel': {'style': 'hubcap', 'rimFactor': 0.62, 'cap': 0.66},
    },
}

# The drawing's roof stands at 1.39 m for the car's 1.43: the glasshouse is brought up.
import os as _os, sys as _sys  # noqa: E402
_sys.path.insert(0, _os.path.dirname(__file__))
from _frame import scale_above  # noqa: E402
scale_above(CAR, 0.95, 1.39, 1.43)
