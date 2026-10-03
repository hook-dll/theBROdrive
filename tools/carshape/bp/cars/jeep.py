# Jeep CJ-5 (1955-71, Hurricane four). Factory: 3290 x 1740 x 1700, wheelbase
# 2057, tracks 1234, 6.00-16, clearance 210. The side of the CJ-5
# Standard at getoutlines.com (4x upscaled, 458 px/m by the wheelbase, outline read off
# by hand), its grille and lamps from the Willys MB front view at 3dcar.ru stretched to
# the CJ-5's width (cj5_go.png puts the three together). A narrow flat-sided tub with
# the rear arch cut in it, flat-topped front wings wider than the tub, a flat
# bonnet over the slotted grille with the lamps in it, and the folding screen standing
# on the cowl.
# The reference photos (a 1967 CJ-5, front and rear three-quarters) show the car open:
# no canvas top and no doors, the tub's sides bare from the cowl to the tail with the
# door openings cut in them, and the folding screen standing alone. The drawing's top
# and soft doors are not on this car, so the body's top behind the screen is the belt
# (topOverride) and the screen is the only glasshouse (cabin = its 6 cm footprint).
# The wings are fenders over open wheels (photos): flat-topped shelves standing out
# from the narrow bonnet, full width only from 0.70 up; below them the radiator's
# housing and the frame between the wheels.
# WING, x against z: the fender's side, its flat top (0.86-0.89), then the step up to
#   the bonnet's edge -- 0.93 -> 0.80, 1.00 -> 0.68, 1.06 -> 0.47 (photos: the fender's
#   top is a shelf, the bonnet a narrow box on it; a 19 deg shoulder merged the two).
WING = [[0.40, 0.50], [0.56, 0.50], [0.62, 0.58], [0.68, 0.72], [0.73, 0.85], [0.86, 0.875], [0.89, 0.87], [0.94, 0.80],
        [1.00, 0.68], [1.03, 0.55], [1.06, 0.47], [1.09, 0.20]]
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
        # Stations also at the two ends, not just at 1.55/-1.50: outside the last station
        # the section fell back to the end view's (the MB front view's fenders, 0.87 wide),
        # which blew the tail panel out to 0.82 into a cushion and put a 0.87-wide flange
        # under the nose below the grille.
        'sectionStations': [{'y': -1.62, 'half': WING}, {'y': -1.50, 'half': WING}, {'y': -0.60, 'half': WING},
                            {'y': -0.48, 'half': TUB}, {'y': 1.55, 'half': TUB}, {'y': 1.60, 'half': TUB}],
        'stationBlend': 0.08,
        # Bonnet between the wings up to the cowl, then the tub's flat full-width cowl
        # (the bonnet's dips carried onto the cowl crumpled it). Across the wings: the
        # bonnet's edge (a short step, x 0.43-0.52) and then the fender's shelf out to
        # the rolled lip at 0.87 (photos: flat-topped fenders, a narrow bonnet).
        'topCross': [
            {'y': -1.72, 'z': [[0.0, 1.03], [0.38, 1.025], [0.43, 0.99], [0.48, 0.945], [0.56, 0.925], [0.66, 0.905],
                               [0.78, 0.888], [0.87, 0.865], [0.89, 0.83]]},
            {'y': -0.56, 'z': [[0.0, 1.075], [0.40, 1.07], [0.45, 1.03], [0.50, 0.965], [0.58, 0.945], [0.68, 0.925],
                               [0.80, 0.905], [0.87, 0.885], [0.89, 0.86]]},
            {'y': -0.47, 'z': [[0.0, 1.08], [0.66, 1.075], [0.70, 1.05]]},
            {'y': -0.30, 'z': [[0.0, 1.08], [0.66, 1.075], [0.70, 1.05]]},
            # The open car: from the screen back the body's top is the tub's belt.
        ],
        'topOverride': [[-0.095, 1.075], [1.60, 1.07]],
        # The screen alone: cabin is the drawing's screen wedge, which in the built frame
        # (the drawing moves +0.075 with the 3290 length) stands at y -0.19 to -0.10, so
        # the glasshouse is that one standing panel and the tub behind it stops at the
        # belt. The pane's y -0.095 onward is the canvas top's, cut away with it.
        'cabin': [-0.19, -0.095],
        'belt': [[-0.27, 1.07], [1.55, 1.07]],
        'glassPlan': [[-0.19, 0.66], [-0.095, 0.66]],
        'roofHalf': 0.66,
        'roofCrown': 0.02,
        'shelf': 0.012,
        # a pressed-steel tub, flat wings and a thin folding screen: crisp edges (the
        # default 4 cm along-car blur rounded the tub's panels and dragged the screen's
        # head down; 1.5 cm keeps the 6 cm frame and the tub's corner posts)
        'edgeMin': 0.013,
        'edgeY': 0.015,
        'edgeYMin': 0.015,
        'edge': 0.013,
        'faceSpacing': 0.15,
        'cornerDeg': 20,
        'arch': {'radius': 0.40, 'lift': 0.0},
    },
    'parts': {
        'underbody': {'frame': True},
        'glass': [
            # Only the folding screen: the reference car is open (photos), so the door
            # and quarter windows and the canvas top's rear light are gone with the top.
            {'view': 'front', 'outline': [[-0.62, 1.12], [0.62, 1.12], [0.62, 1.60], [-0.62, 1.60]], 'mirror': False,
             'depthRange': [-0.4, 0.0], 'facingMin': 0.2, 'fit': False},
        ],
        'regions': [
            # The door openings cut in the tub's sides, dark to the sill, as the photos
            # show them (a real hole through the side is not something the shell can be
            # given; this is the opening read off the photo's silhouette).
            {'view': 'side', 'outline': [[-0.30, 1.045], [0.62, 1.045], [0.62, 0.52], [-0.30, 0.52]],
             'material': 'trim', 'height': 0.0},
            # The tub's floor, seen through the openings.
            {'view': 'top', 'outline': [[-0.30, 0.0], [-0.30, 0.70], [1.55, 0.70], [1.55, 0.0]],
             'material': 'trim', 'facingMin': 0.5},
        ],
        'decals': [
            # Headlights and the parking lamps under them, in the grille panel: the
            # photo's bezels sit at x +-0.42 (their outer edges just inside the panel's
            # edge), the 7 in lens in a 21 cm bezel; the old 0.375 put them too far in.
            {'view': 'front', 'circle': [[0.42, 0.845], 0.105], 'material': 'chrome', 'height': 0.006, 'depthRange': [-1.8, -1.35]},
            {'view': 'front', 'node': 'headlights', 'circle': [[0.42, 0.845], 0.088], 'material': 'Headlights', 'height': 0.010,
             'depthRange': [-1.8, -1.35]},
            # (the lamps sit on the panel's flat part: at x 0.42 the 4.6 cm bezel's outer
            # edge crossed onto the wing's curving underside and its decal shredded)
            {'view': 'front', 'circle': [[0.40, 0.66], 0.043], 'material': 'chrome', 'height': 0.006, 'depthRange': [-1.8, -1.35]},
            {'view': 'front', 'node': 'front_blinker_left', 'circle': [[0.40, 0.66], 0.033], 'material': 'IndicatorLights',
             'height': 0.010, 'depthRange': [-1.8, -1.35]},
            {'view': 'front', 'node': 'front_blinker_right', 'circle': [[0.40, 0.66], 0.033], 'material': 'IndicatorLights',
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
            # (no front plate: the photo's car carries none, and the rect at z 0.32-0.42
            # was projected over the frame's curved face and torn into a sawtooth)
        ],
        'bars': [
            # Nine slots in the grille, not seven: the photo's slotted panel between the
            # headlamps has nine, each slot as wide as a bar (the drawing's too).
            {'view': 'front', 'span': [-0.30, 0.30], 'b': [0.60, 0.98], 'count': 9, 'width': 0.033, 'dir': 'v',
             'material': 'grille', 'height': 0.004, 'depthRange': [-1.8, -1.35]},
        ],
        'lines': [
            {'view': 'side', 'points': [[-1.50, 0.86], [-0.55, 0.86]], 'width': 0.006},
            # The wing's rear edge, kept on the part of the skin that faces sideways: the
            # drawing's points (sill 0.40 at y -0.95) lie inside the wheel opening and on
            # the wing's underside, where a side decal grazes and tears into a black fan.
            {'view': 'side', 'points': [[-0.72, 0.73], [-0.68, 0.78], [-0.63, 0.83], [-0.60, 0.86]], 'width': 0.006},
        ],
        'bumpers': {
            'front': {'z': [0.41, 0.52], 'depth': 0.10, 'wrap': 0.02, 'profile': 'blade', 'material': 'trim', 'standOff': 0.0},
            # The rear bar hangs on the crossmember at the tail panel's bottom edge: at
            # 0.40-0.48 it was below the body's sill (0.48 at the tail) and stood 0.205
            # clear of the shell, in the air behind it.
            'rear': {'z': [0.43, 0.52], 'depth': 0.06, 'wrap': 0.02, 'profile': 'blade', 'material': 'trim',
                     'standOff': 0.0, 'standMax': 0.15, 'span': 1.0},
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
