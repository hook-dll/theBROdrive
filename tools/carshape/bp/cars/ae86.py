# Toyota Corolla Levin GT (AE86, 1983-87), three-door. Factory: 4180 x 1625 x 1335,
# wheelbase 2400, tracks 1355/1345, 185/70 R13, clearance 135. The drawing reprinted at
# 3dcar.ru/blueprints/toyota/corolla_ae86_levin (3x upscaled); its stickers and the
# Initial D bonnet paint are not the car's.
CAR = {
    'id': 'ae86',
    'label': 'Toyota Corolla AE86',
    'factory': {'length': 4.18, 'width': 1.625, 'height': 1.335, 'clearance': 0.135, 'wheelbase': 2.4,
                'frontTrack': 1.355, 'rearTrack': 1.345, 'wheelRadius': 0.285, 'tyreWidth': 0.185, 'frontOverhang': 0.88},
    'blueprint': {
        'image': 'ae86x3.png',
        'dark': 175,
        'side': {'box': [1050, 125, 2850, 690], 'nose': 'left', 'wheels': [[1404.5, 557.5], [2423.5, 557.5]], 'ground': 678},
        'top': {'box': [1062, 819, 2865, 1530], 'nose': 'left'},
        'front': {'box': [156, 123, 900, 690]},
        'rear': {'box': [144, 843, 894, 1410]},
    },
    'hull': {
        'bumpers': {'front': {'z': [0.26, 0.55]}, 'rear': {'z': [0.30, 0.55]}},
        'sill': [[-2.1, 0.32], [-1.8, 0.27], [-1.3, 0.24], [1.0, 0.24], [1.4, 0.27], [2.1, 0.34]],
        'cabin': [-0.80, 2.0],
        'belt': [[-0.80, 0.93], [-0.5, 0.94], [0.8, 0.94], [1.5, 0.95], [2.0, 0.94]],
        'glassPlan': [[-0.80, 0.66], [-0.4, 0.70], [0.9, 0.70], [1.6, 0.64], [2.0, 0.60]],
        'crown': [[-2.2, 0.02], [2.2, 0.02]],
        'roofCrown': 0.03,
        'edge': 0.012,
        'arch': {'radius': 0.34, 'lift': 0.05},
    },
    'parts': {
        'glass': [
            {'view': 'side', 'outline': [[-0.36, 0.95], [-0.08, 1.26], [0.40, 1.27], [0.42, 0.95]], 'facingMin': 0.3},
            {'view': 'side', 'outline': [[0.56, 0.95], [0.57, 1.26], [0.78, 1.27], [1.40, 0.99], [1.38, 0.95]], 'facingMin': 0.3},
            {'view': 'front', 'outline': [[0.0, 1.30], [0.48, 1.295], [0.52, 1.27], [0.64, 0.97], [0.61, 0.95], [0.0, 0.95]],
             'depthRange': [-1.0, -0.2], 'facingMin': 0.25},
            {'view': 'rear', 'outline': [[0.0, 1.27], [0.46, 1.265], [0.50, 1.24], [0.58, 1.03], [0.55, 1.01], [0.0, 1.01]],
             'depthRange': [0.9, 2.0], 'facingMin': 0.1},
        ],
        'regions': [
            {'view': 'front', 'rect': [[0.0, 0.40], [1.8, 0.30]], 'radius': 0.001, 'mirror': False, 'depthRange': [-2.2, -1.75]},
            {'view': 'side', 'outline': [[-2.1, 0.25], [-2.1, 0.56], [-1.55, 0.56], [-1.65, 0.40], [-1.67, 0.25]]},
            {'view': 'rear', 'rect': [[0.0, 0.42], [1.8, 0.26]], 'radius': 0.001, 'mirror': False, 'depthRange': [1.8, 2.2]},
            {'view': 'side', 'outline': [[1.55, 0.30], [1.55, 0.55], [2.1, 0.55], [2.1, 0.30]]},
            {'view': 'side', 'outline': [[-1.55, 0.24], [1.45, 0.24], [1.45, 0.34], [-1.55, 0.34]]},
        ],
        'decals': [
            # The Levin front (drawing, front photo): a tall lamp unit each side with the
            # amber corner in its outer end, and a shallower slatted grille between them.
            # The lamps run |x| 0.25-0.62 and z 0.52-0.695 with body colour outboard to
            # the corner; the old thin 0.09-high lens was cut into wedges at the corner.
            {'view': 'front', 'rect': [[0.0, 0.6225], [1.26, 0.145]], 'radius': 0.008, 'mirror': False, 'material': 'grille',
             'height': 0.004, 'depthRange': [-2.2, -1.75]},
            {'view': 'front', 'node': 'headlights', 'rect': [[0.435, 0.6225], [0.37, 0.145]], 'radius': 0.008,
             'material': 'Headlights', 'height': 0.008, 'depthRange': [-2.2, -1.75]},
            {'view': 'front', 'node': 'front_blinker_left', 'rect': [[0.575, 0.6225], [0.09, 0.145]], 'radius': 0.008,
             'material': 'IndicatorLights', 'height': 0.009, 'facingMin': 0.12, 'depthRange': [-2.2, -1.7]},
            {'view': 'front', 'node': 'front_blinker_right', 'rect': [[0.575, 0.6225], [0.09, 0.145]], 'radius': 0.008,
             'material': 'IndicatorLights', 'height': 0.009, 'facingMin': 0.12, 'depthRange': [-2.2, -1.7]},
            # turn lamps in the bumper's corners (amber, as on the Levin's zenki bumper)
            {'view': 'front', 'node': 'front_blinker_left', 'rect': [[0.52, 0.465], [0.16, 0.045]], 'radius': 0.012,
             'material': 'IndicatorLights', 'height': 0.008, 'depthRange': [-2.2, -1.7]},
            {'view': 'front', 'node': 'front_blinker_right', 'rect': [[0.52, 0.465], [0.16, 0.045]], 'radius': 0.012,
             'material': 'IndicatorLights', 'height': 0.008, 'depthRange': [-2.2, -1.7]},
            {'view': 'front', 'rect': [[0.0, 0.36], [0.62, 0.07]], 'radius': 0.006, 'mirror': False, 'material': 'grille',
             'height': 0.004, 'depthRange': [-2.2, -1.7]},
            {'view': 'front', 'rect': [[0.0, 0.35], [0.30, 0.11]], 'radius': 0.006, 'mirror': False, 'material': 'plate',
             'height': 0.006, 'depthRange': [-2.2, -1.7]},
            {'view': 'side', 'node': 'front_blinker_left', 'rect': [[-1.96, 0.6225], [0.09, 0.11]], 'radius': 0.006, 'material': 'IndicatorLights', 'height': 0.005},
            {'view': 'side', 'node': 'front_blinker_right', 'rect': [[-1.96, 0.6225], [0.09, 0.11]], 'radius': 0.006, 'material': 'IndicatorLights', 'height': 0.005},
            # The B-pillar's black trim, between the door glass (rear edge y 0.42) and
            # the quarter light (front edge y 0.565), up to the roof's edge. A 2-point
            # 'line' 5 cm wide was projected as a slab that stood off the glasshouse and
            # poked above the roof.
            {'view': 'side', 'rect': [[0.49, 1.10], [0.14, 0.30]], 'radius': 0.004, 'material': 'trim', 'height': 0.003},
            # Tail: lamp bands across, the plate in a black recess between them.
            # wide lamp units from the corners to the plate recess: amber outboard, red, a
            # white reversing lamp inboard (photo)
            {'view': 'rear', 'rect': [[0.0, 0.70], [1.46, 0.16]], 'radius': 0.006, 'mirror': False, 'material': 'trim',
             'height': 0.003, 'depthRange': [1.8, 2.2]},
            {'view': 'rear', 'node': 'taillights', 'rect': [[0.46, 0.70], [0.26, 0.13]], 'radius': 0.006,
             'material': 'TailLights', 'height': 0.007, 'depthRange': [1.8, 2.2]},
            {'view': 'rear', 'node': 'rear_blinker_left', 'rect': [[0.66, 0.70], [0.14, 0.13]], 'radius': 0.006,
             'material': 'IndicatorLights', 'height': 0.008, 'facingMin': 0.1, 'depthRange': [1.8, 2.2]},
            {'view': 'rear', 'node': 'rear_blinker_right', 'rect': [[0.66, 0.70], [0.14, 0.13]], 'radius': 0.006,
             'material': 'IndicatorLights', 'height': 0.008, 'facingMin': 0.1, 'depthRange': [1.8, 2.2]},
            {'view': 'rear', 'node': 'reverse_lights', 'rect': [[0.30, 0.70], [0.06, 0.13]], 'radius': 0.006,
             'material': 'ReverseLights', 'height': 0.008, 'depthRange': [1.8, 2.2]},
            {'view': 'rear', 'rect': [[0.0, 0.66], [0.58, 0.22]], 'radius': 0.01, 'mirror': False, 'material': 'trim',
             'height': 0.004, 'depthRange': [1.8, 2.2]},
            {'view': 'rear', 'rect': [[0.0, 0.645], [0.30, 0.13]], 'radius': 0.006, 'mirror': False, 'material': 'plate',
             'height': 0.006, 'depthRange': [1.8, 2.2]},
        ],
        'bars': [
            # The grille's slats run across the car (photo), not up it; four of them
            # between the lamps, in the drawing's z 0.52-0.60 band.
            {'view': 'front', 'span': [-0.25, 0.25], 'b': [0.56, 0.605], 'count': 4, 'dir': 'h', 'width': 0.010,
             'material': 'trim', 'height': 0.006, 'depthRange': [-2.2, -1.75]},
        ],
        'lines': [
            {'view': 'side', 'points': [[-0.70, 0.94], [-0.72, 0.30], [0.48, 0.30], [0.50, 0.94]], 'width': 0.005},
            {'view': 'side', 'points': [[-1.55, 0.585], [1.95, 0.60]], 'width': 0.012, 'material': 'trim', 'height': 0.004},
            {'view': 'side', 'points': [[-0.38, 0.94], [-0.08, 1.28], [0.40, 1.29], [0.80, 1.28], [1.45, 0.97], [1.40, 0.94], [-0.38, 0.94]],
             'width': 0.014, 'material': 'trim', 'height': 0.003},
            {'view': 'top', 'points': [[-2.0, 0.62], [-0.85, 0.64]], 'width': 0.005},
        ],
        # The hatch's spoiler (both photos, and the rear view's pointed wing sitting
        # just under the roof): a blade on the tailgate's top edge at the roof's rear,
        # overhanging the back light, its ends coming down to the quarters. It used to
        # sit at y 1.88 - 2-6 cm over the sloping deck at the glass's foot, 8 cm past
        # its end, i.e. a detached plank low on the tail.
        'boxes': [
            {'c': [0.0, 1.575, 1.082], 'size': [1.30, 0.17, 0.045], 'material': 'trim', 'mirror': False},
            {'c': [0.60, 1.55, 1.040], 'size': [0.10, 0.14, 0.075], 'material': 'trim'},
        ],
        'mirror': {'y': -0.45, 'z': 0.99, 'reach': 0.90, 'w': 0.14, 'h': 0.08, 'material': 'trim'},
        'handles': {'at': [[0.30, 0.86]], 'w': 0.11, 'material': 'trim'},
        'wipers': {'arms': [[-0.55, -0.05, -0.78, 0.95], [0.05, 0.5, -0.78, 0.95]]},
        'wheel': {'style': 'alloy', 'spokes': 12, 'rimFactor': 0.68, 'spokeWidth': 0.25},
    },
}

# No front overhang is published; the drawing's (0.813 + 0.982 = 1.795, the Trueno's
# 4205 less the wheelbase) scaled to the Levin's 1.780.
import os as _os, sys as _sys  # noqa: E402
_sys.path.insert(0, _os.path.dirname(__file__))
from _frame import set_overhang  # noqa: E402
set_overhang(CAR, 0.806)
