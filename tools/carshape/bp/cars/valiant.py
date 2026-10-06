# Plymouth Valiant (1964), four-door sedan. Factory: 4628 x 1780 x 1355, wheelbase 2705,
# tracks 1420/1410, 6.50-13, clearance 150. The side and front of the 1964 Valiant at
# getoutlines.com (3x upscaled, 248 px/m by the wheelbase; the side read off by hand, its
# front axle 0.78 behind the bumper). The compact: a long flat bonnet over a full-width
# grille with the lamps in its ends, a crisp feature line from the nose along the flank,
# a thin-pillared glasshouse, a long flat deck.
# Slab sides up to the shoulder crease, a short tumblehome to the belt, a wide glasshouse.
# Above the belt the glasshouse leans in on one straight line (0.85 at 0.96 to 0.745 at
# 1.33) to the roof's roll: the drawn section's knees at 1.02 and 1.28 ran across the
# side glass, so its straight pillars and frames read as S-curves in 3/4 views (the
# user's screenshot, 2026-10-06).
SEC = [[0.30, 0.80], [0.40, 0.87], [0.82, 0.89], [0.88, 0.88], [0.96, 0.85], [1.33, 0.745], [1.36, 0.68],
       [1.39, 0.45], [1.40, 0.2]]
CAR = {
    'id': 'valiant',
    'label': 'Plymouth Valiant',
    'factory': {'length': 4.628, 'width': 1.78, 'height': 1.355, 'clearance': 0.15, 'wheelbase': 2.705,
                'frontTrack': 1.42, 'rearTrack': 1.41, 'wheelRadius': 0.32, 'tyreWidth': 0.165, 'frontOverhang': 0.78},
    'blueprint': {
        'image': 'valiant_go.png',
        'dark': 120,
        'side': {'box': [0, 0, 1175, 372], 'nose': 'right', 'wheels': [[305, 288], [975, 288]], 'ground': 360, 'isotropic': True,
                 'outline': [[-2.301, 0.412], [-2.301, 0.517], [-2.249, 0.533], [-2.245, 0.80], [-2.10, 0.83], [-0.949, 1.034], [-0.828, 1.05], [-0.472, 1.365], [-0.424, 1.397], [1.009, 1.397], [1.05, 1.365], [1.433, 1.034], [1.797, 0.977], [2.281, 0.908], [2.362, 0.84], [2.37, 0.533], [2.402, 0.517], [2.402, 0.452], [2.221, 0.436], [2.16, 0.384], [1.474, 0.339], [0.707, 0.315], [-0.949, 0.315], [-2.039, 0.371]]},
        'front': {'box': [1180, 0, 1698, 372], 'ppm': 281, 'centre': 1430, 'zRef': [[8, 1.355], [358, 0.0]]},
    },
    'hull': {
        'bumpers': {'front': {'z': [0.38, 0.53]}, 'rear': {'z': [0.38, 0.53]}},
        'sill': [[-2.3, 0.38], [-2.0, 0.34], [-1.0, 0.30], [0.7, 0.30], [1.5, 0.33], [2.4, 0.38]],
        'planOverride': [[-2.31, 0.85], [-2.26, 0.885], [-2.0, 0.89], [2.0, 0.89], [2.3, 0.86], [2.40, 0.80]],
        # One section for the whole car: a station of its own over the deck (a crisper
        # roll for the fin edges the photos show) folded the belt and the glasshouse's
        # foot into a 3-4 cm ripple along the car, so the deck keeps the end view's.
        'sectionStations': [{'y': -2.0, 'half': SEC}, {'y': 2.15, 'half': SEC}],
        'stationBlend': 0.3,
        # Flat-panelled compact: the 6 cm blur along the car (the default edgeY) softened
        # the deck's fin edges and the shoulder crease; the ends' faces are faired with
        # their corners kept (the boot lid's rear edge, the nose's brow).
        'edgeMin': 0.015,
        # 2 cm along the car (3.5 before): with the screen wrapped round, the blur along
        # the car is what rolls the A-pillar's corner; at 3.5 cm the side glass behind it
        # lay on a 6 cm roll (GLASS-FAIL bend at the vent's front edge).
        'edgeY': 0.02,
        'edgeYMin': 0.02,
        'faceSpacing': 0.15, 'cornerDeg': 20,
        # Photos front/front34: a narrow brow directly over the lamp bezels. The side
        # drawing puts the nose at 1.0 m, inconsistent with its front view and the photos;
        # carrying that height across the bonnet left 30 cm of blank panel over the grille.
        # Keep the cowl, but bring the leading edge down to the bezel's upper edge.
        'topCross': [
            {'y': -2.30, 'z': [[0.0, 0.80], [0.50, 0.80], [0.78, 0.82], [0.86, 0.81], [0.89, 0.77]]},
            {'y': -2.10, 'z': [[0.0, 0.83], [0.50, 0.83], [0.78, 0.85], [0.86, 0.84], [0.89, 0.80]]},
            # At the screen's foot the wings come down to the belt (the photographs: the
            # wing's top runs straight into the belt chrome, the bonnet's middle stands
            # above it to the cowl at 1.0); the wings at 1.05 here made a lump either side
            # of the cowl and a hump at the A-pillar's foot.
            {'y': -0.85, 'z': [[0.0, 1.03], [0.40, 1.025], [0.60, 1.0], [0.70, 0.98], [0.78, 0.97], [0.86, 0.96], [0.89, 0.93]]},
        ],
        'cabin': [-0.83, 1.43],
        # The belt off the side photograph (198.5 px/m by its own wheelbase): the belt
        # chrome's top at z 0.915 the length of the doors, the glass from 0.93. The file
        # had 1.02-1.03 (0.99 after the drawing's height scaling at the end): the whole
        # glasshouse stood 6 cm high, the side glass a strip under the roof. Values in this
        # file are the drawing's heights (x 1.031 over the photo's), see scale_above.
        'belt': [[-0.83, 0.95], [-0.5, 0.943], [0.7, 0.943], [1.43, 0.95]],
        # The cowl (1.0 at the screen's foot) drops to the belt right at the A-pillar's
        # foot (y -0.76 in the photograph), not over the default 20 cm behind it: that
        # ramp ran under the vent window's front corner as a hump (GLASS-FAIL bend).
        'beltBlend': 0.06,
        # Full width to the cabin's start: the screen's wrap brings its sides in.
        'glassPlan': [[-0.83, 0.81], [0.8, 0.81], [1.43, 0.76]],
        # The screen wraps round to its A-pillars (the photographs: a thin chrome pillar,
        # the screen's glass seen from the side for 6 cm ahead of it). Built square, the
        # shell's corner between the screen and the side glass was a 17 cm painted band
        # along the car at z 1.05. The side photograph's pillar line runs from y -0.756
        # at z 0.92 to -0.413 at 1.24; the screen's middle is at -0.77 / -0.56 there, so
        # the sides stand 0.18 behind the middle at the foot and 0.15 at the header.
        'screenWrap': {'across': [[0.0, 0.0], [0.2, 0.06], [0.4, 0.25], [0.55, 0.47], [0.65, 0.67], [0.72, 0.85],
                                  [0.78, 1.0]],
                       'foot': [1.0, 0.18], 'head': [1.30, 0.14], 'until': 0.0},
        'crown': [[-2.4, 0.02], [2.4, 0.02]],
        'roofCrown': 0.018,
        'roofHalf': 0.62,
        'edge': 0.011,
        'arch': {'radius': 0.37, 'lift': 0.05},
    },
    'parts': {
        'glassOverlay': True,
        'glassFit': False,
        # Bright chrome frames round every pane and the B-pillar (photographs); the
        # default black rubber left the side glass's frames and pillars nearly invisible.
        'glassSeal': {'material': 'chrome', 'width': 0.012},
        # The side glass off the side photograph, the chrome frames' outer edges (heights
        # x 1.031, the drawing's scale): the foot at 0.93 (0.959 here), the header 1.305
        # (1.345). Front: a vent window from the A-pillar's curve (y -0.756 at the belt,
        # -0.574 at 1.07, -0.413 at 1.24) to its slanted divider (-0.44 at the foot, -0.395
        # where it meets the pillar), then the door glass to the B-pillar. The B-pillar is
        # 5 cm of chrome (0.146-0.196): two 1.6 cm frames and 1.3 cm between. Rear door:
        # the drop glass to a vertical bar at 0.676 and a fixed quarter pane behind it to
        # the slanted rear edge (0.958 at the foot, 0.668 at the top). The file's two
        # boxes stopped 14 cm short of the A-pillar and 30 cm short of the rear edge: the
        # thick A-pillar and the blank rear quarter.
        'glass': [
            {'view': 'side', 'outline': [[-0.452, 0.959], [-0.70, 0.959], [-0.612, 1.021], [-0.532, 1.102], [-0.452, 1.196],
                                         [-0.405, 1.263]], 'seal': 0.014},
            {'view': 'side', 'outline': [[-0.428, 0.959], [0.165, 0.959], [0.165, 1.345], [-0.29, 1.345], [-0.35, 1.330],
                                         [-0.385, 1.294], [-0.393, 1.253]], 'seal': 0.016},
            {'view': 'side', 'outline': [[0.178, 0.952], [0.668, 0.952], [0.668, 1.345], [0.178, 1.345]], 'seal': 0.016},
            {'view': 'side', 'outline': [[0.684, 0.952], [0.958, 0.952], [0.807, 1.146], [0.70, 1.31], [0.684, 1.325]],
             'seal': 0.014},
            # The screen in plan, generated off the wrapped shell (screengen.py valiant 1.04
            # 1.31 with the photo's pillar line): its foot where it rises through 1.04 over
            # the cowl, header 1.31 (4.5 cm under the roof), sides 7 mm ahead of the pillar.
            {'view': 'top', 'outline': [[-0.7886, 0.0], [-0.7879, 0.05], [-0.7864, 0.1], [-0.7837, 0.15], [-0.78, 0.2],
                                        [-0.7741, 0.25], [-0.7655, 0.3], [-0.7551, 0.35], [-0.7437, 0.4], [-0.7311, 0.45],
                                        [-0.7166, 0.5], [-0.7004, 0.55], [-0.6823, 0.6], [-0.6614, 0.65], [-0.6375, 0.7],
                                        [-0.6248, 0.7258], [-0.618, 0.7368], [-0.6093, 0.7462], [-0.5987, 0.7539],
                                        [-0.5864, 0.7612], [-0.562, 0.7632], [-0.5387, 0.759], [-0.5155, 0.7523],
                                        [-0.4922, 0.7453], [-0.469, 0.7391], [-0.4457, 0.7345], [-0.4225, 0.7296],
                                        [-0.4028, 0.7173], [-0.3963, 0.7128], [-0.3903, 0.6979], [-0.3861, 0.6829],
                                        [-0.3837, 0.6676], [-0.3831, 0.6521], [-0.3843, 0.6365], [-0.3873, 0.6206],
                                        [-0.3922, 0.6046], [-0.3938, 0.6], [-0.4093, 0.55], [-0.4231, 0.5], [-0.4355, 0.45],
                                        [-0.4463, 0.4], [-0.4558, 0.35], [-0.4649, 0.3], [-0.4724, 0.25], [-0.4776, 0.2],
                                        [-0.481, 0.15], [-0.4837, 0.1], [-0.4857, 0.05], [-0.4859, 0.0]],
             'depthRange': [0.99, 1.35]},
            {'view': 'rear', 'outline': [[0.0, 1.36], [0.55, 1.35], [0.66, 1.28], [0.72, 1.06], [0.68, 1.04], [0.0, 1.04]],
             'depthRange': [0.9, 1.6], 'facingMin': 0.15},
        ],
        'podLamps': [{'node': 'headlights', 'x': 0.78, 'z': 0.63, 'r': 0.09, 'end': 'front', 'bezel': 0.025, 'podDepth': 0.08,
                      'proud': 0.008}],
        'decals': [
            {'view': 'front', 'rect': [[0.0, 0.58], [1.66, 0.28]], 'radius': 0.03, 'mirror': False, 'material': 'chrome',
             'height': 0.003, 'depthRange': [-2.4, -2.0]},
            {'view': 'front', 'rect': [[0.0, 0.58], [1.30, 0.24]], 'radius': 0.02, 'mirror': False, 'material': 'grille',
             'height': 0.005, 'depthRange': [-2.4, -2.0]},
            {'view': 'front', 'node': 'front_blinker_left', 'rect': [[0.62, 0.48], [0.10, 0.03]], 'radius': 0.008,
             'material': 'IndicatorLights', 'height': 0.010, 'depthRange': [-2.4, -2.0]},
            {'view': 'front', 'node': 'front_blinker_right', 'rect': [[0.62, 0.48], [0.10, 0.03]], 'radius': 0.008,
             'material': 'IndicatorLights', 'height': 0.010, 'depthRange': [-2.4, -2.0]},
            {'view': 'front', 'circle': [[0.0, 0.58], 0.05], 'mirror': False, 'material': 'chrome', 'height': 0.010,
             'depthRange': [-2.4, -2.0]},
            {'view': 'front', 'rect': [[0.0, 0.29], [0.34, 0.12]], 'radius': 0.005, 'mirror': False, 'material': 'plate',
             'height': 0.006, 'depthRange': [-2.5, -2.0]},
            # A tall, narrow lamp standing on the quarter's trailing corner (photos: red
            # lens over the whole tail panel, a narrow clear reversing lens at its foot,
            # a chrome rim), not a wide one across the panel top.
            {'view': 'rear', 'rect': [[0.835, 0.665], [0.13, 0.35]], 'radius': 0.035, 'material': 'chrome', 'height': 0.006,
             'depthRange': [2.1, 2.5], 'facingMin': 0.05},
            {'view': 'rear', 'node': 'taillights', 'rect': [[0.835, 0.715], [0.085, 0.225]], 'radius': 0.03,
             'material': 'TailLights', 'height': 0.010, 'depthRange': [2.1, 2.5], 'facingMin': 0.05},
            {'view': 'rear', 'node': 'rear_blinker_left', 'rect': [[0.835, 0.575], [0.085, 0.045]], 'radius': 0.012,
             'material': 'IndicatorLights', 'height': 0.012, 'depthRange': [2.1, 2.5], 'facingMin': 0.05},
            {'view': 'rear', 'node': 'rear_blinker_right', 'rect': [[0.835, 0.575], [0.085, 0.045]], 'radius': 0.012,
             'material': 'IndicatorLights', 'height': 0.012, 'depthRange': [2.1, 2.5], 'facingMin': 0.05},
            {'view': 'rear', 'node': 'reverse_lights', 'rect': [[0.835, 0.528], [0.085, 0.038]], 'radius': 0.01, 'mirror': True,
             'material': 'ReverseLights', 'height': 0.012, 'depthRange': [2.1, 2.5], 'facingMin': 0.05},
            # The ribbed bright panel across the tail between the lamps, the V emblem in it.
            {'view': 'rear', 'rect': [[0.0, 0.655], [1.50, 0.24]], 'radius': 0.012, 'mirror': False, 'material': 'grille',
             'height': 0.004, 'depthRange': [2.1, 2.5], 'facingMin': 0.05},
            {'view': 'rear', 'circle': [[0.0, 0.655], 0.05], 'mirror': False, 'material': 'chrome', 'height': 0.010,
             'depthRange': [2.1, 2.5], 'facingMin': 0.05},
            {'view': 'rear', 'rect': [[0.0, 0.665], [0.34, 0.13]], 'radius': 0.005, 'mirror': False, 'material': 'plate',
             'height': 0.006, 'depthRange': [2.1, 2.5], 'facingMin': 0.05},
        ],
        'bars': [
            {'view': 'front', 'span': [-0.64, 0.64], 'b': [0.48, 0.68], 'count': 6, 'width': 0.008, 'material': 'chrome',
             'height': 0.008, 'depthRange': [-2.4, -2.0]},
            # The ribbed bright panel across the tail between the lamps (photos), the same
            # motif as the grille; the V emblem sits in its middle.
            {'view': 'rear', 'span': [-0.74, 0.74], 'b': [0.56, 0.755], 'count': 7, 'width': 0.008, 'material': 'chrome',
             'height': 0.006, 'depthRange': [2.1, 2.5]},
        ],
        'lines': [
            # The feature line from the nose along the flank.
            {'view': 'side', 'points': [[-2.12, 0.84], [-1.6, 0.86], [-0.9, 0.88], [0.6, 0.88], [1.6, 0.87], [2.30, 0.85]],
             'width': 0.008, 'material': 'chrome', 'height': 0.003},
            # Shut lines off the photograph: the doors' bottom at 0.30 (0.31 here), the
            # split at the B-pillar's middle 0.171 (the file had 0.10, 7 cm ahead of the
            # pillar), the rear door's edge curving up to the quarter glass's foot.
            {'view': 'side', 'points': [[-0.86, 0.943], [-0.875, 0.40], [-0.86, 0.33], [-0.83, 0.31], [0.171, 0.31],
                                        [0.171, 0.943]], 'width': 0.005},
            {'view': 'side', 'points': [[0.171, 0.31], [0.86, 0.31], [0.89, 0.33], [0.90, 0.40], [0.925, 0.70], [0.958, 0.943]],
             'width': 0.005, 'keep': True},
            # The bright moulding along the doors (z 0.47, 0.485 here), from the front door's
            # edge to the rear door's, and the spear along the rear wing to the tail.
            {'view': 'side', 'points': [[-1.10, 0.485], [0.89, 0.485]], 'width': 0.012, 'material': 'chrome', 'height': 0.003},
            {'view': 'side', 'points': [[1.75, 0.464], [2.30, 0.464]], 'width': 0.012, 'material': 'chrome', 'height': 0.003},
        ],
        'bumpers': {
            'front': {'z': [0.40, 0.51], 'depth': 0.06, 'wrap': 0.30, 'profile': 'blade'},
            'rear': {'z': [0.40, 0.51], 'depth': 0.06, 'wrap': 0.30, 'profile': 'blade'},
        },
        # A small round chrome mirror just behind the A-pillar's foot (front 3/4 photo),
        # 8.5 cm across on a short arm; the 11 cm disc stood off on a long one.
        'mirror': {'y': -0.72, 'z': 1.0, 'reach': 0.93, 'w': 0.085, 'h': 0.085, 'material': 'chrome', 'shape': 'round',
                   'sides': [1]},
        # Handles off the photograph: z 0.806 (0.83 here), y 0.02 and 0.84.
        'handles': {'at': [[0.02, 0.83], [0.84, 0.83]], 'w': 0.12},
        'wipers': {'arms': [[-0.6, -0.05, -0.86, 1.06], [0.05, 0.6, -0.86, 1.06]]},
        'wheel': {'style': 'hubcap', 'rimFactor': 0.62, 'cap': 0.70},
    },
}

# The drawing's roof stands at 1.397 (its own sheet is dimensioned to 55 in, the
# Australian AP5's height) for the car file's published 1.355: the whole drawing is
# brought down, so the game no longer squashes the body 3.4 % vertically (round arches
# went oval). The glasshouse keeps its shape (the glass stays 0.29 m, what the photos
# of the 1964 car show); the ends' overhangs, sills and lamps move with it.
import os as _os, sys as _sys  # noqa: E402
_sys.path.insert(0, _os.path.dirname(__file__))
from _frame import scale_above  # noqa: E402
scale_above(CAR, 0.0, 1.397, 1.355)
