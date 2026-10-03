# Jeep CJ-5 (1955-71, Hurricane four). Factory: 3290 x 1740 x 1700 (soft top), wheelbase
# 2057, tracks 1234, 6.00-16, clearance 210. The side of the CJ-5
# Standard at getoutlines.com (4x upscaled, 458 px/m by the wheelbase, outline read off
# by hand), its grille and lamps from the Willys MB front view at 3dcar.ru stretched to
# the CJ-5's width (cj5_go.png puts the three together). A narrow flat-sided tub with
# the rear arch cut in it, rounded flat-topped front wings wider than the tub, a flat
# bonnet over the slotted grille with the lamps in it, an upright screen, a canvas top
# and soft doors.
# The reference photos (a 1967 CJ-5, front and rear three-quarters) are of the 3290 car
# as the roster and the factory figures give it: no spare is carried (the drawing's
# spare, on the tail, is the 3440 length), and the wings' tops are a shoulder sloping
# from the bonnet's edge out to a rolled lip, not a flat slab under a cliff (photos).
# The front wings are fenders over open wheels (photos): full width only from 0.70 up;
# below them the radiator's housing and the frame between the wheels.
# WING, x against z: the fender's side, then its shoulder up to the bonnet's edge --
#   z 0.86-0.89 the outer lip (the car's full width), 0.93 -> 0.75, 1.01 -> 0.55,
#   1.04 -> 0.46, the bonnet's edge; the old flat 0.86-0.88 plateau put a 13 cm cliff
#   right at the bonnet's edge and left the fender top dead flat (photos: a shoulder).
WING = [[0.40, 0.50], [0.62, 0.50], [0.70, 0.86], [0.86, 0.875], [0.89, 0.87], [0.93, 0.75],
        [0.97, 0.65], [1.01, 0.55], [1.04, 0.46], [1.07, 0.42], [1.10, 0.20]]
TUB = [[0.34, 0.68], [0.40, 0.70], [1.05, 0.70], [1.10, 0.68], [1.62, 0.67], [1.67, 0.6], [1.70, 0.2]]
CAR = {
    'id': 'jeep',
    'label': 'Jeep CJ-5',
    'factory': {'length': 3.29, 'width': 1.74, 'height': 1.7, 'clearance': 0.21, 'wheelbase': 2.057,
                'frontTrack': 1.234, 'rearTrack': 1.234, 'wheelRadius': 0.355, 'tyreWidth': 0.16, 'frontOverhang': 0.55},
    'blueprint': {
        'image': 'cj5_go.png',
        'dark': 200,
        'side': {'box': [0, 0, 1620, 808], 'nose': 'right', 'wheels': [[410, 636], [1352, 636]], 'ground': 790, 'isotropic': True,
                 'outline': [[-1.698, 0.415], [-1.698, 0.511], [-1.58, 0.52], [-1.502, 0.537], [-1.471, 0.852], [-1.449, 1.026],
                             [-1.397, 1.061], [-0.532, 1.083], [-0.27, 1.07], [-0.236, 1.114], [-0.205, 1.681], [1.498, 1.69],
                             [1.52, 1.659], [1.529, 0.48], [1.258, 0.45], [0.472, 0.336], [-0.751, 0.336], [-1.537, 0.393]]},
        'front': {'box': [0, 848, 693, 1561], 'ppm': 356, 'centre': 336, 'zRef': [[1090, 1.03], [1325, 0.467]]},
    },
    'hull': {
        'sill': [[-1.72, 0.40], [-1.5, 0.39], [-0.75, 0.34], [0.5, 0.34], [1.25, 0.45], [1.55, 0.48]],
        'planOverride': [[-1.72, 0.84], [1.55, 0.84]],
        # A station at the tail as well as at 1.55: outside the last station the section
        # fell back to the end view's (the MB front view's fenders, 0.87 wide), which
        # blew the tail panel out to 0.82 and rounded its corners into a cushion.
        'sectionStations': [{'y': -1.50, 'half': WING}, {'y': -0.60, 'half': WING}, {'y': -0.48, 'half': TUB},
                            {'y': 1.55, 'half': TUB}, {'y': 1.60, 'half': TUB}],
        'stationBlend': 0.08,
        # Bonnet between the wings up to the cowl, then the tub's flat full-width cowl
        # (the bonnet's dips carried onto the cowl crumpled it). Across the wings: the
        # bonnet's edge (a short step, x 0.40-0.46) and then the shoulder down to the
        # rolled lip at 0.87 -- the old cliffs at x 0.48-0.52 were a 58 deg wall.
        'topCross': [
            {'y': -1.72, 'z': [[0.0, 1.03], [0.40, 1.025], [0.44, 0.995], [0.52, 0.965], [0.62, 0.935], [0.72, 0.905],
                               [0.82, 0.878], [0.87, 0.857], [0.89, 0.83]]},
            {'y': -0.56, 'z': [[0.0, 1.075], [0.42, 1.07], [0.46, 1.04], [0.52, 1.01], [0.62, 0.975], [0.72, 0.94],
                               [0.82, 0.905], [0.87, 0.885], [0.89, 0.86]]},
            {'y': -0.47, 'z': [[0.0, 1.08], [0.66, 1.075], [0.70, 1.05]]},
            {'y': -0.30, 'z': [[0.0, 1.08], [0.66, 1.075], [0.70, 1.05]]},
        ],
        'cabin': [-0.27, 1.55],
        'belt': [[-0.27, 1.07], [1.55, 1.07]],
        'glassPlan': [[-0.27, 0.66], [1.55, 0.66]],
        'roofHalf': 0.66,
        'roofCrown': 0.02,
        # a pressed-steel tub and flat wings: crisp edges (the default blur rounded the tub)
        'edgeMin': 0.015,
        'edgeY': 0.04,
        'edgeYMin': 0.04,
        'edge': 0.016,
        'arch': {'radius': 0.40, 'lift': 0.0},
    },
    'parts': {
        'underbody': {'frame': True},
        'paint2': {'name': 'trim_canvas', 'rgb': [0.08, 0.08, 0.08]},
        'glass': [
            {'view': 'side', 'outline': [[0.472, 1.528], [-0.10, 1.528], [-0.16, 1.157], [0.472, 1.157]], 'facingMin': 0.3},
            {'view': 'side', 'outline': [[1.433, 1.507], [0.647, 1.507], [0.647, 1.10], [1.433, 1.10]], 'facingMin': 0.3},
            # One screen pane, not the MB drawing's two with a centre bar: the 1967 CJ-5
            # has a one-piece screen (photos) with a slim frame all round.
            {'view': 'front', 'outline': [[-0.60, 1.15], [0.60, 1.15], [0.60, 1.55], [-0.60, 1.55]], 'mirror': False,
             'depthRange': [-0.4, 0.0], 'facingMin': 0.2, 'fit': False},
            {'view': 'rear', 'outline': [[-0.45, 1.25], [0.45, 1.25], [0.45, 1.55], [-0.45, 1.55]], 'mirror': False,
             'depthRange': [1.3, 1.7], 'facingMin': 0.2, 'fit': False},
        ],
        'regions': [
            # Soft top and soft doors over the tub.
            {'view': 'side', 'outline': [[-0.22, 1.09], [1.65, 1.09], [1.65, 1.80], [-0.22, 1.80]], 'material': 'paint2'},
            {'view': 'top', 'outline': [[-0.22, 0.0], [-0.22, 0.75], [1.65, 0.75], [1.65, 0.0]], 'material': 'paint2', 'facingMin': 0.5},
            {'view': 'rear', 'rect': [[0.0, 1.42], [1.5, 0.66]], 'mirror': False, 'material': 'paint2', 'depthRange': [1.3, 1.7]},
        ],
        'decals': [
            # Headlights and the parking lamps under them, in the grille panel: the
            # photo's bezels sit at x +-0.42 (their outer edges just inside the panel's
            # edge), the 7 in lens in a 21 cm bezel; the old 0.375 put them too far in.
            {'view': 'front', 'circle': [[0.42, 0.845], 0.105], 'material': 'chrome', 'height': 0.006, 'depthRange': [-1.8, -1.35]},
            {'view': 'front', 'node': 'headlights', 'circle': [[0.42, 0.845], 0.088], 'material': 'Headlights', 'height': 0.010,
             'depthRange': [-1.8, -1.35]},
            {'view': 'front', 'circle': [[0.42, 0.645], 0.046], 'material': 'chrome', 'height': 0.006, 'depthRange': [-1.8, -1.35]},
            {'view': 'front', 'node': 'front_blinker_left', 'circle': [[0.42, 0.645], 0.035], 'material': 'IndicatorLights',
             'height': 0.010, 'depthRange': [-1.8, -1.35]},
            {'view': 'front', 'node': 'front_blinker_right', 'circle': [[0.42, 0.645], 0.035], 'material': 'IndicatorLights',
             'height': 0.010, 'depthRange': [-1.8, -1.35]},
            # Tail: one round lamp a side in a bezel (photos), low on the tail panel; the
            # indicator is inside the same lamp (the '58-'71 CJ-5's combined stop/turn
            # lens), so the amber sits on the red rather than out in the panel.
            {'view': 'rear', 'circle': [[0.60, 0.72], 0.070], 'material': 'chrome', 'height': 0.006, 'depthRange': [1.3, 1.7]},
            {'view': 'rear', 'node': 'taillights', 'circle': [[0.60, 0.72], 0.056], 'material': 'TailLights', 'height': 0.012,
             'depthRange': [1.3, 1.7], 'facingMin': 0.2},
            {'view': 'rear', 'node': 'rear_blinker_left', 'circle': [[0.60, 0.72], 0.022], 'material': 'IndicatorLights',
             'height': 0.014, 'depthRange': [1.3, 1.7], 'facingMin': 0.2},
            {'view': 'rear', 'node': 'rear_blinker_right', 'circle': [[0.60, 0.72], 0.022], 'material': 'IndicatorLights',
             'height': 0.014, 'depthRange': [1.3, 1.7], 'facingMin': 0.2},
            {'view': 'rear', 'node': 'reverse_lights', 'circle': [[0.60, 0.585], 0.035], 'mirror': False,
             'material': 'ReverseLights', 'height': 0.010, 'depthRange': [1.3, 1.7], 'facingMin': 0.2},
            {'view': 'rear', 'rect': [[0.30, 0.66], [0.30, 0.13]], 'radius': 0.005, 'mirror': False, 'material': 'plate',
             'height': 0.006, 'depthRange': [1.3, 1.7], 'facingMin': 0.2},
            {'view': 'front', 'rect': [[0.0, 0.37], [0.40, 0.10]], 'radius': 0.005, 'mirror': False, 'material': 'plate',
             'height': 0.006, 'depthRange': [-1.8, -1.35]},
        ],
        'bars': [
            # Nine slots in the grille, not seven: the photo's slotted panel between the
            # headlamps has nine, each slot as wide as a bar (the drawing's too).
            {'view': 'front', 'span': [-0.30, 0.30], 'b': [0.60, 0.98], 'count': 9, 'width': 0.033, 'dir': 'v',
             'material': 'grille', 'height': 0.004, 'depthRange': [-1.8, -1.35]},
        ],
        'lines': [
            {'view': 'side', 'points': [[-1.50, 0.86], [-0.55, 0.86]], 'width': 0.006},
            {'view': 'side', 'points': [[-0.95, 0.40], [-0.80, 0.50], [-0.70, 0.62], [-0.60, 0.85]], 'width': 0.006},
        ],
        'bumpers': {
            'front': {'z': [0.41, 0.52], 'depth': 0.10, 'wrap': 0.02, 'profile': 'blade', 'material': 'trim', 'standOff': 0.0},
            # The rear bar hangs on the crossmember at the tail panel's bottom edge: at
            # 0.40-0.48 it was below the body's sill (0.48 at the tail) and stood 0.205
            # clear of the shell, in the air behind it.
            'rear': {'z': [0.43, 0.52], 'depth': 0.06, 'wrap': 0.02, 'profile': 'blade', 'material': 'trim',
                     'standOff': 0.0, 'standMax': 0.12, 'span': 1.0},
        },
        'mirror': {'y': -0.22, 'z': 1.22, 'reach': 0.76, 'w': 0.11, 'h': 0.11, 'shape': 'round'},
        'wipers': {'arms': [[-0.5, -0.1, -0.24, 1.55], [0.1, 0.5, -0.24, 1.55]]},
        'wheel': {'style': 'steel', 'windows': 0, 'rimFactor': 0.6, 'cap': True},
    },
}

# Placed for the 3440 length (rear spare); at 3290 the front axle stands 7.5 cm further
# back from the car's middle: the drawing moves with it.
import os as _os, sys as _sys  # noqa: E402
_sys.path.insert(0, _os.path.dirname(__file__))
from _frame import shift_along  # noqa: E402
shift_along(CAR, 0.075)
