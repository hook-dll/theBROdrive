# Peugeot 504 (1968-83). Factory: 4490 x 1690 x 1460, wheelbase 2740, tracks 1420/1340,
# 175 SR 14, clearance 160. The side and front of the 504 at getoutlines.com
# (the-blueprints, 3x upscaled, 335 px/m by the wheelbase). Pininfarina's saloon: a
# long bonnet falling to a nose with the trapezoid lamps either side of a fine grille,
# a glasshouse with the rear quarter louvre, a short tail kicked up over the boot, thin
# bumpers with rubber-tipped overriders.
CAR = {
    'id': 'p504',
    'label': 'Peugeot 504',
    'factory': {'length': 4.49, 'width': 1.69, 'height': 1.46, 'clearance': 0.16, 'wheelbase': 2.74,
                'frontTrack': 1.42, 'rearTrack': 1.34, 'wheelRadius': 0.31, 'tyreWidth': 0.175, 'frontOverhang': 0.68},
    'blueprint': {
        'image': 'p504_go.png',
        'dark': 140,
        'side': {'box': [646, 0, 2154, 495], 'nose': 'right', 'wheels': [[989, 380], [1906, 380]], 'ground': 490, 'isotropic': True,
                 # Its line work leaks at the C-pillar and the rear wing: the outline is read off by hand.
                 'outline': [[-2.226, 0.347], [-2.226, 0.456], [-2.157, 0.476], [-2.157, 0.669], [-2.085, 0.726], [-1.802, 0.798],
                             [-1.399, 0.871], [-0.996, 0.944], [-0.835, 1.052], [-0.552, 1.347], [-0.472, 1.379], [0.133, 1.403],
                             [0.698, 1.387], [1.02, 1.335], [1.262, 1.153], [1.423, 1.032], [1.504, 0.968], [1.988, 0.879],
                             [2.109, 0.798], [2.149, 0.71], [2.149, 0.476], [2.21, 0.452], [2.21, 0.355], [2.109, 0.298],
                             [1.504, 0.266], [0.819, 0.226], [-1.117, 0.226], [-1.802, 0.246], [-2.125, 0.286]]},
        'front': {'box': [10, 0, 620, 495], 'ppm': 330, 'centre': 323, 'zRef': [[13, 1.46], [490, 0.0]]},
    },
    'hull': {
        'bumpers': {'front': {'z': [0.34, 0.47]}, 'rear': {'z': [0.34, 0.46]}},
        'sill': [[-2.2, 0.30], [-1.9, 0.27], [-1.3, 0.24], [0.9, 0.24], [1.6, 0.28], [2.2, 0.33]],
        # the nose nearly flat across, turning the corner tight (photos)
        'planOverride': [[-2.23, 0.76], [-2.20, 0.815], [-2.12, 0.84], [1.9, 0.84], [2.12, 0.80], [2.21, 0.72]],
        'cabin': [-0.84, 1.50],
        'belt': [[-0.84, 0.95], [-0.6, 0.92], [0.8, 0.92], [1.1, 0.95], [1.5, 0.97]],
        'glassPlan': [[-0.84, 0.66], [-0.4, 0.72], [0.8, 0.72], [1.5, 0.62]],
        'crown': [[-2.3, 0.025], [2.3, 0.025]],
        'roofCrown': 0.035,
        'edge': 0.012,
        'arch': {'radius': 0.36, 'lift': 0.04},
    },
    'parts': {
        'glass': [
            # The side panes' heads were 4 cm low: the drawing's own window line stands at
            # 1.325 and the photos give a roof band of ~11 cm (0.11 of 1.46), not the
            # 15 cm the panes left.
            {'view': 'side', 'outline': [[0.12, 0.93], [-0.70, 0.93], [-0.47, 1.295], [0.12, 1.30]], 'facingMin': 0.3},
            {'view': 'side', 'outline': [[0.19, 0.93], [0.78, 0.93], [0.76, 1.295], [0.19, 1.30]], 'facingMin': 0.3},
            {'view': 'front', 'outline': [[0.0, 1.38], [0.55, 1.37], [0.64, 1.30], [0.68, 0.98], [0.64, 0.95], [0.0, 0.95]],
             'depthRange': [-1.1, -0.3], 'facingMin': 0.2},
            {'view': 'rear', 'outline': [[0.0, 1.37], [0.52, 1.36], [0.60, 1.28], [0.64, 1.04], [0.60, 1.01], [0.0, 1.01]],
             'depthRange': [0.9, 1.6], 'facingMin': 0.15},
        ],
        'decals': [
            {'view': 'front', 'rect': [[0.0, 0.645], [0.80, 0.11]], 'radius': 0.01, 'mirror': False, 'material': 'grille',
             'height': 0.004, 'depthRange': [-2.3, -1.9], 'facingMin': 0.4},
            # Trapezoid lamps in chrome rims, their tops sloping with the bonnet's edge; the
            # clear side lamps with the turn lamp below them over the bumper (photos).
            {'view': 'front', 'outline': [[0.41, 0.715], [0.67, 0.705], [0.70, 0.685], [0.70, 0.585], [0.41, 0.585]],
             'material': 'chrome', 'height': 0.006, 'depthRange': [-2.3, -1.9], 'facingMin': 0.4},
            {'view': 'front', 'node': 'headlights', 'outline': [[0.425, 0.70], [0.665, 0.692], [0.685, 0.675], [0.685, 0.60], [0.425, 0.60]],
             'material': 'Headlights', 'height': 0.010, 'depthRange': [-2.3, -1.9], 'facingMin': 0.4},
            {'view': 'front', 'rect': [[0.56, 0.545], [0.24, 0.05]], 'radius': 0.006, 'material': 'chrome',
             'height': 0.006, 'depthRange': [-2.3, -1.9]},
            {'view': 'front', 'rect': [[0.50, 0.545], [0.11, 0.035]], 'radius': 0.005, 'material': 'Headlights',
             'height': 0.009, 'depthRange': [-2.3, -1.9]},
            {'view': 'front', 'node': 'front_blinker_left', 'rect': [[0.625, 0.545], [0.10, 0.035]], 'radius': 0.005,
             'material': 'IndicatorLights', 'height': 0.009, 'depthRange': [-2.3, -1.9]},
            {'view': 'front', 'node': 'front_blinker_right', 'rect': [[0.625, 0.545], [0.10, 0.035]], 'radius': 0.005,
             'material': 'IndicatorLights', 'height': 0.009, 'depthRange': [-2.3, -1.9]},
            {'view': 'front', 'rect': [[0.0, 0.355], [0.47, 0.11]], 'radius': 0.005, 'mirror': False, 'material': 'plate',
             'height': 0.005, 'depthRange': [-2.4, -1.9]},
            {'view': 'front', 'rect': [[0.0, 0.79], [0.14, 0.025]], 'radius': 0.005, 'mirror': False, 'material': 'chrome',
             'height': 0.005, 'depthRange': [-2.3, -1.8]},
            # The lamp runs the tail panel's height, foot a hand's width above the bumper
            # (the drawing's own side view puts it 0.48-0.69, the photos' lamps touch the
            # bumper's top). Lens: clear reversing section inboard at the top, the amber
            # turn lens filling outboard of it, red across the bottom (photos).
            {'view': 'rear', 'outline': [[0.50, 0.765], [0.755, 0.765], [0.80, 0.71], [0.80, 0.50], [0.50, 0.50]],
             'material': 'chrome', 'height': 0.005, 'depthRange': [1.9, 2.3], 'facingMin': -0.1},
            {'view': 'rear', 'node': 'reverse_lights', 'outline': [[0.508, 0.752], [0.60, 0.752], [0.60, 0.635], [0.508, 0.635]],
             'material': 'ReverseLights', 'height': 0.008, 'depthRange': [1.9, 2.3], 'facingMin': -0.1},
            {'view': 'rear', 'node': 'rear_blinker_left', 'outline': [[0.61, 0.75], [0.72, 0.75], [0.785, 0.705], [0.785, 0.635], [0.61, 0.635]],
             'material': 'IndicatorLights', 'height': 0.008, 'depthRange': [1.9, 2.3], 'facingMin': -0.1},
            {'view': 'rear', 'node': 'rear_blinker_right', 'outline': [[0.61, 0.75], [0.72, 0.75], [0.785, 0.705], [0.785, 0.635], [0.61, 0.635]],
             'material': 'IndicatorLights', 'height': 0.008, 'depthRange': [1.9, 2.3], 'facingMin': -0.1},
            {'view': 'rear', 'node': 'taillights', 'outline': [[0.508, 0.635], [0.785, 0.635], [0.785, 0.508], [0.508, 0.508]],
             'material': 'TailLights', 'height': 0.008, 'depthRange': [1.9, 2.3], 'facingMin': -0.1},
            {'view': 'rear', 'rect': [[0.0, 0.66], [0.50, 0.11]], 'radius': 0.005, 'mirror': False, 'material': 'plate',
             'height': 0.006, 'depthRange': [1.9, 2.3], 'facingMin': 0.1},
            # The louvre in the C-pillar.
            {'view': 'side', 'outline': [[0.86, 1.06], [1.12, 1.06], [1.20, 1.20], [0.93, 1.22]], 'material': 'grille', 'height': 0.003},
        ],
        'bars': [
            {'view': 'front', 'span': [-0.40, 0.40], 'b': [0.60, 0.69], 'count': 5, 'width': 0.008, 'dir': 'h', 'material': 'chrome',
             'height': 0.007, 'depthRange': [-2.3, -1.9]},
            {'view': 'side', 'span': [0.88, 1.16], 'b': [1.08, 1.19], 'count': 4, 'width': 0.012, 'material': 'paint', 'height': 0.005},
        ],
        'lines': [
            {'view': 'side', 'points': [[-0.87, 0.92], [-0.87, 0.30], [0.13, 0.30], [0.13, 0.93]], 'width': 0.005},
            {'view': 'side', 'points': [[0.13, 0.30], [1.0, 0.30], [1.10, 0.45], [1.10, 0.93]], 'width': 0.005},
            {'view': 'side', 'points': [[-1.5, 0.33], [1.6, 0.33]], 'width': 0.012, 'material': 'chrome', 'height': 0.003},
            {'view': 'side', 'points': [[-0.72, 0.92], [-0.47, 1.30], [0.78, 1.305], [0.78, 0.92]], 'width': 0.012, 'material': 'chrome',
             'height': 0.003},
            {'view': 'side', 'points': [[-0.72, 0.915], [0.80, 0.915]], 'width': 0.010, 'material': 'chrome', 'height': 0.003},
            {'view': 'rear', 'points': [[0.0, 0.93], [0.62, 0.92], [0.70, 0.78], [0.0, 0.775]], 'width': 0.005, 'depthRange': [1.5, 2.3],
             'facingMin': 0.1},
        ],
        'bumpers': {
            'front': {'z': [0.36, 0.45], 'depth': 0.05, 'wrap': 0.30, 'profile': 'blade', 'overriders': [[0.37, 0.05, 0.33, 0.50]]},
            'rear': {'z': [0.36, 0.45], 'depth': 0.05, 'wrap': 0.30, 'profile': 'blade', 'overriders': [[0.37, 0.05, 0.33, 0.50]]},
        },
        'mirror': {'y': -0.62, 'z': 0.98, 'reach': 0.93, 'w': 0.12, 'h': 0.08, 'material': 'chrome', 'sides': [1]},
        'handles': {'at': [[0.0, 0.84], [0.95, 0.84]], 'w': 0.12},
        'wipers': {'arms': [[-0.55, -0.05, -0.87, 0.97], [0.05, 0.55, -0.87, 0.97]]},
        'wheel': {'style': 'hubcap', 'rimFactor': 0.64, 'cap': 0.62},
    },
}

# The drawing's roof stands at 1.403 for the car's 1.46: the glasshouse is brought up (the
# game had stretched the whole body 4.5 % taller).
import os as _os, sys as _sys  # noqa: E402
_sys.path.insert(0, _os.path.dirname(__file__))
from _frame import scale_above  # noqa: E402
scale_above(CAR, 0.92, 1.403, 1.46)
