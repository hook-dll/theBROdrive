# Ford Escort Mk II two-door (1975-80). Factory: 3978 x 1595 x 1390, wheelbase 2405,
# tracks 1270/1300, 175/70 R13. The Mk II rally car's drawing reprinted at
# 3dcar.ru/blueprints/ford/escort_rally: the body is the road car's; its lamp pods,
# aerial and arch flares are left out.
CAR = {
    'id': 'escort',
    'label': 'Ford Escort',
    'factory': {'length': 3.978, 'width': 1.595, 'height': 1.39, 'clearance': 0.14, 'wheelbase': 2.405,
                'frontTrack': 1.27, 'rearTrack': 1.30, 'wheelRadius': 0.29, 'tyreWidth': 0.175, 'frontOverhang': 0.68},
    'blueprint': {
        'image': 'escort_mk2_rally.jpg',
        'side': {'box': [478, 86, 1257, 345], 'nose': 'left', 'drop': [[0, 100, 30, 215]]},
        # The rally car's flares and lamp pods are not the road car's: plan and sections
        # are read off by hand under them.
        'top': {'box': [476, 404, 1255, 744], 'nose': 'left',
                'outline': [[-1.94, 0.0], [-1.94, 0.70], [-1.86, 0.765], [-1.6, 0.785], [1.7, 0.79], [1.93, 0.77],
                            [1.98, 0.72], [1.98, 0.0]]},
        'front': {'box': [71, 84, 413, 354],
                  'outline': [[0.0, 1.39], [0.45, 1.385], [0.53, 1.35], [0.70, 0.96], [0.755, 0.90], [0.785, 0.78],
                              [0.795, 0.60], [0.79, 0.35], [0.76, 0.0], [0.0, 0.0]]},
        'rear': {'box': [72, 462, 411, 731],
                 'outline': [[0.0, 1.39], [0.45, 1.385], [0.53, 1.35], [0.66, 0.96], [0.74, 0.88], [0.785, 0.78],
                             [0.795, 0.60], [0.79, 0.35], [0.76, 0.0], [0.0, 0.0]]},
    },
    'hull': {
        'topOverride': [[1.45, 0.97], [1.75, 0.94], [1.98, 0.86]],
        'sill': [[-2.0, 0.34], [-1.8, 0.30], [-1.6, 0.27], [-1.3, 0.25], [1.3, 0.25], [1.6, 0.27], [1.8, 0.29], [2.0, 0.33]],
        'cabin': [-0.75, 1.45],
        'belt': [[-0.75, 0.90], [-0.5, 0.915], [1.0, 0.925], [1.45, 0.93]],
        'glassPlan': [[-0.75, 0.62], [-0.4, 0.70], [0.9, 0.70], [1.45, 0.62]],
        'crown': [[-2.1, 0.012], [2.1, 0.012]],
        'roofCrown': 0.022,
        'edge': 0.012,
        # The plan as the road car's, not the drawing's. Its top view carries the rally
        # flares: 0.786-0.791 out over the arches against 0.762 at the doors, and read
        # off by hand the flare stayed in the plan - a 25 mm swelling over each arch with
        # a 10 cm ramp behind it. The section scales the plan at every height, so the
        # swelling came out as the blister over the front arch the photos do not have
        # (they are flat-sided, the arch lip is all of it), with a crease where the ramp
        # met the door. The plan is flat from the nose taper to the rear arch now, and its
        # tail taper is where the car's is: 0.78 to 0 over the last 5 cm (the old one ran
        # out at 1.88, so the shell's own blunt end took over and rounded the tail corner
        # to ~10 cm radius where the photos are 4-5).
        'planOverride': [[-1.99, 0.30], [-1.96, 0.55], [-1.90, 0.60], [-1.85, 0.690], [-1.80, 0.718],
                         [-1.72, 0.746], [-1.62, 0.758], [-1.50, 0.764], [-1.30, 0.766], [-1.10, 0.768],
                         [-1.00, 0.768], [-0.90, 0.768], [-0.60, 0.770], [-0.30, 0.772],
                         [0.30, 0.776], [0.55, 0.780], [0.70, 0.786], [0.95, 0.788], [1.15, 0.788],
                         [1.30, 0.786], [1.50, 0.784], [1.70, 0.784], [1.90, 0.782], [1.965, 0.780],
                         [1.985, 0.780], [2.000, 0.770], [2.010, 0.720], [2.018, 0.620],
                         [2.026, 0.460], [2.032, 0.250], [2.038, 0.0]],
        # The photo's boot section at three stations: the side near vertical up to the
        # shoulder at the belt, a 6 cm crisp shoulder, then the lid flat at 0.70 out to
        # its edge (the rally drawing's own rear view carries the flares and its lid
        # curves away: that section is what melted the boot's corners and the wings'
        # shoulders - a rounded loaf).
        'sectionStations': [
            {'y': 1.45, 'half': [[0.14, 0.790], [0.88, 0.795], [0.925, 0.792], [0.950, 0.760], [0.965, 0.712], [0.972, 0.700],
                                 [0.978, 0.0]]},
            {'y': 1.75, 'half': [[0.14, 0.790], [0.88, 0.795], [0.925, 0.792], [0.950, 0.760], [0.965, 0.712], [0.972, 0.700],
                                 [0.978, 0.0]]},
            {'y': 1.95, 'half': [[0.14, 0.786], [0.88, 0.790], [0.925, 0.786], [0.948, 0.752], [0.962, 0.706], [0.968, 0.694],
                                 [0.974, 0.0]]},
        ],
        'stationBlend': 0.06,
        # The drawn tail face is round (yaw 0 -> 25 -> 87 deg over the last 20 cm): its
        # panel given as a vertical line, so the lid's end and the wing's end meet it.
        'face': {'rear': [[0.45, 1.930], [0.92, 1.930]]},
        # a crisp three-box body (photos)
        'edgeMin': 0.015,
        'edgeY': 0.028,
        'edgeYMin': 0.028,
        'arch': {'radius': 0.33, 'lift': 0.02},
    },
    'parts': {
        'glass': [
            {'view': 'side', 'outline': [[-0.498, 0.925], [-0.24, 1.24], [-0.18, 1.271], [0.44, 1.28], [0.42, 0.905]], 'facingMin': 0.3},
            {'view': 'side', 'outline': [[0.517, 1.255], [0.491, 0.92], [1.225, 0.916], [1.273, 0.945], [1.046, 1.11], [0.829, 1.239],
                                         [0.591, 1.266]], 'facingMin': 0.3},
            {'view': 'front', 'outline': [[0.0, 1.335], [0.50, 1.33], [0.545, 1.30], [0.66, 0.98], [0.64, 0.955], [0.0, 0.955]],
             'depthRange': [-1.0, -0.3], 'facingMin': -0.3},
            {'view': 'rear', 'outline': [[0.0, 1.33], [0.48, 1.325], [0.52, 1.30], [0.60, 0.99], [0.58, 0.965], [0.0, 0.965]],
             'depthRange': [0.9, 1.6], 'facingMin': -0.3},
        ],
        'decals': [
            {'view': 'front', 'rect': [[0.0, 0.632], [1.40, 0.20]], 'radius': 0.02, 'mirror': False,
             'material': 'grille', 'height': 0.004, 'depthRange': [-2.1, -1.7]},
            {'view': 'front', 'node': 'headlights', 'circle': [[0.56, 0.632], 0.085], 'material': 'Headlights',
             'height': 0.012, 'depthRange': [-2.1, -1.7]},
            {'view': 'front', 'circle': [[0.56, 0.632], 0.097], 'ring': 0.012, 'material': 'chrome',
             'height': 0.013, 'depthRange': [-2.1, -1.7]},
            {'view': 'front', 'outline': [[0.0, 0.62], [0.035, 0.632], [0.0, 0.644], [-0.035, 0.632]], 'mirror': False,
             'material': 'chrome', 'height': 0.012, 'depthRange': [-2.1, -1.7]},
            {'view': 'front', 'node': 'front_blinker_left', 'rect': [[0.62, 0.395], [0.11, 0.035]], 'radius': 0.006,
             'material': 'IndicatorLights', 'height': 0.008, 'depthRange': [-2.1, -1.6]},
            {'view': 'front', 'node': 'front_blinker_right', 'rect': [[0.62, 0.395], [0.11, 0.035]], 'radius': 0.006,
             'material': 'IndicatorLights', 'height': 0.008, 'depthRange': [-2.1, -1.6]},
            {'view': 'side', 'node': 'front_blinker_left', 'rect': [[-1.53, 0.695], [0.07, 0.025]], 'radius': 0.004, 'material': 'IndicatorLights', 'height': 0.005},
            {'view': 'side', 'node': 'front_blinker_right', 'rect': [[-1.53, 0.695], [0.07, 0.025]], 'radius': 0.004, 'material': 'IndicatorLights', 'height': 0.005},
            {'view': 'front', 'rect': [[0.0, 0.40], [0.50, 0.10]], 'radius': 0.006, 'mirror': False, 'material': 'plate',
             'height': 0.006, 'depthRange': [-2.1, -1.6]},
            # Tail clusters: the photos' wide rectangular units across the corners -
            # clear (reversing) inboard, red, amber outboard, 42 cm of lens a side.
            {'view': 'rear', 'rect': [[0.51, 0.58], [0.44, 0.135]], 'radius': 0.008, 'material': 'trim',
             'height': 0.004, 'depthRange': [1.7, 2.1]},
            {'view': 'rear', 'node': 'reverse_lights', 'rect': [[0.36, 0.58], [0.10, 0.115]], 'radius': 0.006,
             'material': 'ReverseLights', 'height': 0.008, 'depthRange': [1.7, 2.1]},
            {'view': 'rear', 'node': 'taillights', 'rect': [[0.505, 0.58], [0.145, 0.115]], 'radius': 0.006,
             'material': 'TailLights', 'height': 0.008, 'depthRange': [1.7, 2.1]},
            {'view': 'rear', 'node': 'rear_blinker_left', 'rect': [[0.655, 0.58], [0.11, 0.115]], 'radius': 0.006,
             'material': 'IndicatorLights', 'height': 0.008, 'depthRange': [1.7, 2.1]},
            {'view': 'rear', 'node': 'rear_blinker_right', 'rect': [[0.655, 0.58], [0.11, 0.115]], 'radius': 0.006,
             'material': 'IndicatorLights', 'height': 0.008, 'depthRange': [1.7, 2.1]},
            {'view': 'side', 'node': 'taillights', 'rect': [[1.90, 0.58], [0.10, 0.115]], 'material': 'TailLights', 'height': 0.005},
            {'view': 'rear', 'rect': [[0.0, 0.585], [0.52, 0.11]], 'radius': 0.006, 'mirror': False, 'material': 'plate',
             'height': 0.005, 'depthRange': [1.7, 2.1]},
        ],
        'bars': [
            {'view': 'front', 'span': [-0.44, 0.44], 'b': [0.555, 0.71], 'count': 7, 'width': 0.008,
             'material': 'trim', 'height': 0.007, 'depthRange': [-2.1, -1.7]},
        ],
        'lines': [
            {'view': 'side', 'points': [[-0.73, 0.90], [-0.73, 0.28], [0.47, 0.28], [0.47, 0.91]], 'width': 0.005},
            {'view': 'top', 'points': [[-1.88, 0.63], [-0.80, 0.64]], 'width': 0.005},
            # The boot lid's shut line: across the tail panel, then turned up along the
            # lid's side. Drawn as a square elbow at the corner, the ray onto the rounded
            # tail corner bent the line into a kink there; the turn is on a curve now.
            # `keep`: the file's own points are the line (assemble.py otherwise lays each
            # run straight between turns over 25 deg, which flattened the curve into a V).
            {'view': 'rear', 'points': [[0.0, 0.672], [0.40, 0.672], [0.58, 0.676], [0.68, 0.688],
                                        [0.730, 0.716], [0.742, 0.762], [0.740, 0.850], [0.728, 0.920]],
             'width': 0.005, 'depthRange': [1.6, 2.1], 'keep': True},
            # The waist moulding and the window surrounds.
            {'view': 'side', 'points': [[-1.9, 0.72], [-0.75, 0.735], [2.0, 0.75]], 'width': 0.012, 'material': 'rubber', 'height': 0.004},
            {'view': 'side', 'points': [[-0.51, 0.92], [-0.25, 1.25], [-0.18, 1.285], [0.60, 1.28], [0.84, 1.25], [1.06, 1.12],
                                        [1.29, 0.95], [1.25, 0.91]], 'width': 0.012, 'material': 'chrome', 'height': 0.003},
            {'view': 'side', 'points': [[-0.51, 0.912], [1.25, 0.908]], 'width': 0.012, 'material': 'chrome', 'height': 0.003},
            {'view': 'side', 'points': [[0.465, 0.91], [0.49, 1.27]], 'width': 0.03, 'material': 'trim', 'height': 0.003},
        ],
        'bumpers': {
            # The photo's blade: a slim chrome bar (5 cm deep, 9 cm tall) round the nose
            # with its black end caps, the ends stopping on the wings (the 0.24 m wrap
            # carried the ends out to the body's widest point, proud of the nose). The
            # overriders that were here are not on the car: both photos' bumpers are a
            # plain bar, and the only black on them is the end caps (see `boxes`).
            'front': {'z': [0.42, 0.51], 'depth': 0.05, 'wrap': 0.20, 'profile': 'blade', 'material': 'chrome'},
            'rear': {'z': [0.40, 0.49], 'depth': 0.05, 'wrap': 0.20, 'profile': 'blade', 'material': 'chrome'},
        },
        'mirror': {'y': -0.66, 'z': 0.96, 'reach': 0.90, 'w': 0.13, 'h': 0.075},
        # The bumpers' black plastic end caps (photos: the yellow car's front, the maroon
        # car's rear), at the ends of hull.py's bumper paths (front path ends 0.772,
        # -1.805 post-shift; rear 0.772, 1.786 - written here 11 cm forward of that, as
        # set_overhang moves everything the file places).
        'boxes': [
            {'c': [0.762, -1.705, 0.465], 'size': [0.070, 0.125, 0.105], 'material': 'trim'},
            {'c': [0.762, 1.910, 0.445], 'size': [0.070, 0.110, 0.105], 'material': 'trim'},
        ],
        'handles': {'at': [[0.33, 0.855]], 'w': 0.13},
        'wipers': {'arms': [[-0.55, -0.05, -0.80, 0.94], [0.05, 0.5, -0.80, 0.94]]},
        'wheel': {'style': 'steel', 'windows': 8, 'rimFactor': 0.68, 'cap': True},
    },
}

# No front overhang is published; the drawing's (0.553 / 0.972) scaled to length less
# wheelbase. The file's 0.680 stretched the nose 12 cm past the drawing.
import os as _os, sys as _sys  # noqa: E402
_sys.path.insert(0, _os.path.dirname(__file__))
from _frame import set_overhang  # noqa: E402
set_overhang(CAR, 0.570)
