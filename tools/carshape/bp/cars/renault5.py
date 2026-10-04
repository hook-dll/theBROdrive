# Renault 5 Alpine (1976-79, French phase 1, naturally aspirated) on the R5's shell.
# Factory figures from the FIA homologation form no. 5650 (Group 1, Renault 5 Alpine):
# overall length 3543 with bumpers (3506 without), height 1395 empty, wheelbase right
# 2412 / left 2442 (mean 2427), tracks 1294/1270, ground clearance 120, tyres 155/70 R13
# (wheel 550 mm overall, so radius 0.275). The form gives only the body width at the axles
# (1463/1490), so the body's own 1525 stays. The drawing reprinted at
# 3dcar.ru/blueprints/renault/5.
CAR = {
    'id': 'renault5',
    'label': 'Renault 5 Alpine',
    'factory': {'length': 3.543, 'width': 1.525, 'height': 1.395, 'clearance': 0.12, 'wheelbase': 2.427,
                'frontTrack': 1.294, 'rearTrack': 1.27, 'wheelRadius': 0.275, 'tyreWidth': 0.155, 'frontOverhang': 0.50},
    'blueprint': {
        'image': 'renault5.jpg',
        'side': {'box': [786, 87, 1976, 523], 'nose': 'left', 'wheels': [[974, 441], [1777, 441]], 'ground': 522},
        'top': {'box': [784, 680, 1981, 1207], 'nose': 'left'},
        'front': {'box': [73, 84, 646, 520], 'drop': [[10, 0, 40, 440]],
                  'outline': [[0.0, 1.33], [0.42, 1.325], [0.55, 1.30], [0.61, 1.15], [0.70, 0.90], [0.745, 0.70],
                              [0.762, 0.50], [0.755, 0.33], [0.74, 0.0], [0.0, 0.0]]},
        'rear': {'box': [100, 696, 629, 1144]},
    },
    'hull': {
        'bumpers': {'front': {'z': [0.27, 0.50]}, 'rear': {'z': [0.28, 0.45]}},
        'sill': [[-1.8, 0.30], [-1.5, 0.27], [-1.0, 0.24], [0.9, 0.24], [1.4, 0.27], [1.8, 0.30]],
        'cabin': [-0.68, 1.75],
        'belt': [[-0.68, 0.89], [-0.4, 0.85], [1.1, 0.85], [1.75, 0.86]],
        'glassPlan': [[-0.68, 0.63], [-0.3, 0.69], [1.1, 0.69], [1.75, 0.62]],
        # Flat flanks with a crisp shoulder crease and a flat tailgate (photos): no
        # crown along the car, a nearly flat roof, and the folds at 1.1 cm / 1.8 cm
        # instead of the 2.2 / 6 cm default, which pillowed the flanks and rolled the
        # tailgate's edge and the roof's corners.
        'crown': [[-2.0, 0.008], [2.0, 0.008]],
        'roofCrown': 0.012,
        'edge': 0.011,
        'edgeMin': 0.013,
        'edgeY': 0.018,
        'edgeYMin': 0.018,
        'faceSpacing': 0.15, 'cornerDeg': 20,
        'arch': {'radius': 0.32, 'lift': 0.03},
    },
    'parts': {
        'glass': [
            {'view': 'side', 'outline': [[-0.31, 0.93], [-0.253, 0.847], [0.441, 0.841], [0.447, 1.18], [0.429, 1.199], [-0.065, 1.199],
                                         [-0.138, 1.171], [-0.171, 1.143]], 'facingMin': 0.3},
            {'view': 'side', 'outline': [[0.523, 1.177], [0.52, 0.875], [0.538, 0.857], [1.117, 0.847], [1.145, 0.86], [1.139, 0.885],
                                         [0.981, 1.109], [0.911, 1.162], [0.86, 1.174], [0.59, 1.193]], 'facingMin': 0.3},
            # Plan bounds on the measured screen slope (y -0.68..-0.30): its
            # foot is ~1.0 m and header ~1.30 m. End-view fitting raised the foot
            # onto the middle of the pane; top projection follows the actual skin.
            {'view': 'top', 'outline': [[-0.68, 0.0], [-0.68, 0.59], [-0.64, 0.61],
                                       [-0.32, 0.54], [-0.30, 0.50], [-0.30, 0.0]],
             'facingMin': 0.25, 'fit': False},
            {'view': 'rear', 'outline': [[0.0, 1.18], [0.43, 1.175], [0.47, 1.14], [0.47, 0.88], [0.43, 0.84], [0.0, 0.84]],
             'depthRange': [1.2, 1.8], 'facingMin': 0.25},
        ],
        # The grey-black plastic bumpers wrap the ends: regions of the shell. Every band
        # the drawing gives, plus the black valance the photos show below it (the shield
        # reaches down to the front's lower edge); the bumper-mounted indicator, reverse
        # and plate patches sit inside these bands, so the bands stay on the shell (a
        # separate bar part would bridge the band out and leave them no surface).
        'regions': [
            {'view': 'front', 'rect': [[0.0, 0.365], [1.6, 0.30]], 'radius': 0.001, 'mirror': False, 'depthRange': [-1.9, -1.42]},
            {'view': 'side', 'outline': [[-1.8, 0.22], [-1.8, 0.49], [-1.47, 0.49], [-1.47, 0.25]]},
            {'view': 'rear', 'rect': [[0.0, 0.345], [1.6, 0.24]], 'radius': 0.001, 'mirror': False, 'depthRange': [1.42, 1.9]},
            {'view': 'side', 'outline': [[1.47, 0.24], [1.47, 0.45], [1.85, 0.45], [1.85, 0.26]]},
        ],
        'decals': [
            # The fresh-air vent on the bonnet, just ahead of the screen (the drawing's top
            # view draws it as a slotted rectangle 0.33 m across at y -0.90..-0.73; photos
            # of the Alpine/Gordini show the same black slotted panel).
            {'view': 'top', 'rect': [[-0.815, 0.0], [0.17, 0.33]], 'radius': 0.02, 'mirror': False,
             'material': 'grille', 'height': 0.004},
            {'view': 'front', 'rect': [[0.0, 0.575], [1.26, 0.11]], 'radius': 0.01, 'mirror': False,
             'material': 'grille', 'height': 0.004, 'depthRange': [-1.9, -1.5]},
            {'view': 'front', 'rect': [[0.0, 0.59], [0.81, 0.14]], 'radius': 0.01, 'mirror': False,
             'material': 'grille', 'height': 0.005, 'depthRange': [-1.9, -1.5]},
            # The grille's lower moulding: photos and the drawing's front view both show a
            # thin bright chrome strip running the full width between the lamps, at the
            # bottom of the slatted grille and just above the bumper (not above the grille).
            {'view': 'front', 'rect': [[0.0, 0.53], [1.48, 0.020]], 'radius': 0.002, 'mirror': False,
             'material': 'chrome', 'height': 0.008, 'depthRange': [-1.9, -1.5]},
            # Headlamp surround: the photos show the rectangular lamp sitting in a thin
            # chrome rim (the old dark `trim` band read as a black frame).
            {'view': 'front', 'rect': [[0.53, 0.652], [0.25, 0.145]], 'radius': 0.025, 'material': 'chrome',
             'height': 0.006, 'depthRange': [-1.9, -1.5]},
            {'view': 'front', 'node': 'headlights', 'rect': [[0.53, 0.652], [0.22, 0.12]], 'radius': 0.02, 'material': 'Headlights',
             'height': 0.010, 'depthRange': [-1.9, -1.5]},
            # The Renault diamond sits on the grille just under the bonnet's edge (photos
            # and drawing); it was 3 cm too high, reading as a bonnet badge. Its `height`
            # clears the grille bars it lies over.
            {'view': 'front', 'outline': [[0.0, 0.655], [0.026, 0.632], [0.0, 0.609], [-0.026, 0.632]], 'mirror': False,
             'material': 'chrome', 'height': 0.012, 'depthRange': [-1.9, -1.5]},
            {'view': 'front', 'node': 'front_blinker_left', 'rect': [[0.54, 0.415], [0.14, 0.06]], 'radius': 0.008,
             'material': 'IndicatorLights', 'height': 0.008, 'depthRange': [-1.9, -1.5]},
            {'view': 'front', 'node': 'front_blinker_right', 'rect': [[0.54, 0.415], [0.14, 0.06]], 'radius': 0.008,
             'material': 'IndicatorLights', 'height': 0.008, 'depthRange': [-1.9, -1.5]},
            {'view': 'front', 'rect': [[0.0, 0.33], [0.50, 0.10]], 'radius': 0.006, 'mirror': False, 'material': 'plate',
             'height': 0.005, 'depthRange': [-1.9, -1.5]},
            {'view': 'side', 'node': 'front_blinker_left', 'rect': [[-0.909, 0.718], [0.16, 0.025]], 'radius': 0.006, 'material': 'IndicatorLights', 'height': 0.005},
            {'view': 'side', 'node': 'front_blinker_right', 'rect': [[-0.909, 0.718], [0.16, 0.025]], 'radius': 0.006, 'material': 'IndicatorLights', 'height': 0.005},
            # Upright tail lamps at the rear panel's corners: the indicator above the tail
            # lamp (photos of the 1976-79 Alpine; the model had the two the other way up).
            {'view': 'rear', 'node': 'rear_blinker_left', 'rect': [[0.635, 0.745], [0.095, 0.115]], 'radius': 0.01,
             'material': 'IndicatorLights', 'height': 0.008, 'facingMin': -0.1, 'depthRange': [1.5, 1.9]},
            {'view': 'rear', 'node': 'rear_blinker_right', 'rect': [[0.635, 0.745], [0.095, 0.115]], 'radius': 0.01,
             'material': 'IndicatorLights', 'height': 0.008, 'facingMin': -0.1, 'depthRange': [1.5, 1.9]},
            {'view': 'rear', 'node': 'taillights', 'rect': [[0.635, 0.6225], [0.095, 0.13]], 'radius': 0.01,
             'material': 'TailLights', 'height': 0.008, 'facingMin': -0.1, 'depthRange': [1.5, 1.9]},
            # The reversing lamps: the drawing's rear view puts a small clear lamp either
            # side of the number plate on the tail panel, and the photo shows the left one
            # there (the old pair sat down on the bumper at z 0.345, where the car has none).
            {'view': 'rear', 'node': 'reverse_lights', 'rect': [[0.325, 0.70], [0.085, 0.06]], 'radius': 0.006,
             'material': 'ReverseLights', 'height': 0.008, 'depthRange': [1.5, 1.9]},
            # Narrow C-pillar vent, dark perforated centre and thin bright rim.
            # Side-facing projection excludes the roof/header: allowing horizontal
            # faces painted a silver band across the rear glass's top.
            {'view': 'side', 'outline': [[1.125, 1.199], [1.185, 1.225], [1.395, 0.920], [1.335, 0.894]],
             'material': 'trim', 'height': 0.004, 'facingMin': 0.35},
            {'view': 'side', 'outline': [[1.125, 1.199], [1.185, 1.225], [1.395, 0.920], [1.335, 0.894]], 'ring': 0.006,
             'material': 'alu', 'height': 0.007, 'facingMin': 0.35},
            {'view': 'rear', 'outline': [[0.595, 1.19], [0.675, 1.19], [0.675, 0.90], [0.595, 0.90]],
             'material': 'trim', 'height': 0.004, 'facingMin': 0.55, 'depthRange': [1.35, 1.9]},
            {'view': 'rear', 'rect': [[0.0, 0.655], [0.56, 0.13]], 'radius': 0.01, 'mirror': False, 'material': 'plate',
             'height': 0.005, 'depthRange': [1.5, 1.9]},
        ],
        'bars': [
            # The grille between the lamps: a black recess with THIN aluminium bars (photos
            # and the FIA form's front photo; the drawing draws a square grid, and the old
            # nine vertical bars were the wrong grille type). Five 5 mm bars over the black
            # panel read as fine bright lines, not a silver patch.
            {'view': 'front', 'span': [-0.40, 0.40], 'b': [0.545, 0.635], 'count': 5, 'dir': 'h', 'width': 0.005,
             'material': 'alu', 'height': 0.008, 'depthRange': [-1.9, -1.5]},
            {'view': 'rear', 'span': [-0.40, 0.40], 'b': [0.33, 0.40], 'count': 4, 'width': 0.008,
             'material': 'grille', 'height': 0.004, 'depthRange': [1.5, 1.9]},
        ],
        'lines': [
            {'view': 'side', 'points': [[-0.64, 0.84], [-0.645, 0.33], [0.535, 0.33], [0.535, 0.84]], 'width': 0.005},
            {'view': 'top', 'points': [[-1.62, 0.63], [-0.72, 0.64]], 'width': 0.005},
            {'view': 'rear', 'points': [[0.0, 0.47], [0.55, 0.47], [0.56, 1.23], [0.0, 1.23]], 'width': 0.005, 'depthRange': [1.0, 1.9]},
            {'view': 'side', 'points': [[-0.315, 0.93], [-0.26, 0.835], [0.535, 0.83], [1.15, 0.84]], 'width': 0.012, 'material': 'rubber', 'height': 0.003},
            # The Alpine's belt pinstripe: the photos show a PAIR of thin red lines
            # running the flank just under the window line, meeting at a point on the front
            # wing (they open towards the rear quarter, where they form the banner round
            # the "45"). Red must not follow the car's paint, so it is the fixed second
            # paint (`paint2`), as on the Fox GT's stripes.
            {'view': 'side', 'points': [[-1.08, 0.764], [1.32, 0.782]], 'width': 0.010, 'material': 'paint2', 'height': 0.004},
            {'view': 'side', 'points': [[-1.08, 0.764], [1.32, 0.748]], 'width': 0.010, 'material': 'paint2', 'height': 0.004},
        ],
        # The window rubbers are thin on the car (photos: about 1 cm at the quarter light
        # and the door glass); the 1.4 cm default read heavy on the small panes.
        'glassSeal': {'material': 'rubber', 'width': 0.010},
        'mirror': {'y': -0.30, 'z': 0.90, 'reach': 0.84, 'w': 0.13, 'h': 0.09},
        'handles': {'at': [[0.42, 0.79]], 'w': 0.10, 'material': 'trim'},
        'wipers': {'arms': [[-0.55, -0.05, -0.65, 0.89], [0.05, 0.5, -0.65, 0.89]]},
        # The Alpine's flat alloy disc: a plain face with four small openings and a small
        # central hub (photos: the 1978 car's four-opening wheel). The mill's `steel`
        # face gives a flat disc with four slots; the alloy's four spokes left four large
        # wedge gaps that read as a cross, not the flat disc.
        'wheel': {'style': 'steel', 'windows': 4, 'rimFactor': 0.72, 'cap': True},
        # The fixed red of the belt pinstripe: the roster paints `car_paint` only, and a
        # material named car_paint_2 keeps its own colour whatever the car is painted.
        'paint2': {'rgb': [0.55, 0.06, 0.04], 'name': 'car_paint_2'},
    },
}


# The drawing's roof (and the front view's outline) had been normalised to the 1.33 m
# guess; the FIA form has the car 1395 mm empty. The belt sits right (0.85-0.89, and the
# photos put it there), so everything above it - outlines, panes, decals, lines, regions,
# the bumper bands and the factory height - is brought up to 1.395.
import os as _os, sys as _sys  # noqa: E402
_sys.path.insert(0, _os.path.dirname(__file__))
from _frame import scale_above  # noqa: E402
scale_above(CAR, 0.89, 1.33, 1.395)
