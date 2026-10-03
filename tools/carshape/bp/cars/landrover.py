# Land Rover Series III 88 soft top (1971-85). Factory: 3530 x 1680 x 1950, wheelbase 2235,
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
    'factory': {'length': 3.53, 'width': 1.68, 'height': 1.97, 'clearance': 0.21, 'wheelbase': 2.235,
                'frontTrack': 1.31, 'rearTrack': 1.31, 'wheelRadius': 0.355, 'tyreWidth': 0.16, 'frontOverhang': 0.56},
    'blueprint': {
        'image': 'lr88_go.png',
        'dark': 150,
        # The side read off the drawing in metres (its tilt stands at 1.83; the frame is
        # moved 100 px down so the outline brought up to 1.95 below is not clipped).
        'side': {'box': [0, 0, 1615, 840], 'nose': 'right', 'wheels': [[512, 689], [1378.5, 689]], 'ground': 832, 'isotropic': True,
                 'outline': [[-1.74, 0.50], [-1.74, 0.98], [-1.70, 1.02], [-1.63, 1.052], [-1.56, 1.086], [-1.50, 1.127],
                             [-1.24, 1.145], [-0.98, 1.161], [-0.66, 1.176], [-0.60, 1.18], [-0.58, 1.19], [-0.32, 1.67],
                             [-0.27, 1.679], [-0.02, 1.736], [0.24, 1.795], [0.44, 1.831], [1.00, 1.834], [1.47, 1.826],
                             [1.66, 1.818], [1.67, 1.78], [1.67, 0.50], [1.60, 0.47], [-1.60, 0.48]]},
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
        # Flat panels: no crown along the car and next to none across it (the bonnet
        # domed into a bulge and the canvas's top edges rounded).
        'crown': [[-2.0, 0.008], [2.0, 0.008]],
        'roofCrown': 0.008,
        'edge': 0.011,
        # flat aluminium panels folded at crisp edges
        'edgeMin': 0.013,
        'edgeY': 0.02,
        'edgeYMin': 0.02,
        # The 4 cm blur ate the ends' vertical faces: the bonnet's leading edge at -1.40
        # came out 3 cm low (the drawn line steps 4 cm there) and the tilt's rear edge at
        # +1.70 was cut back to the tub's capping (1.87 -> 1.24: a wedge missing off the
        # back).  Faired with the corners kept instead.
        'faceSpacing': 0.15, 'cornerDeg': 20,
        'arch': {'radius': 0.43, 'lift': 0.0},
    },
    'parts': {
        'underbody': {'frame': True},
        'paint2': {'name': 'trim_canvas', 'rgb': [0.32, 0.30, 0.22]},
        'glass': [
            {'view': 'side', 'outline': [[0.33, 1.22], [-0.27, 1.22], [-0.27, 1.62], [0.33, 1.62]], 'facingMin': 0.3},
            # The screen's pane down to the frame's lower rail (the drawings' front view
            # put the glass 20 cm up, so a body-coloured band stood under it and the
            # wipers landed mid-screen); its top stops at the screen's own top rather
            # than running over onto the roof.
            {'view': 'front', 'outline': [[0.03, 1.26], [0.70, 1.26], [0.72, 1.68], [0.03, 1.68]], 'depthRange': [-0.62, -0.30],
             'facingMin': 0.2, 'fit': False},
            {'view': 'rear', 'outline': [[0.03, 1.42], [0.72, 1.42], [0.72, 1.75], [0.03, 1.75]], 'depthRange': [1.5, 1.9],
             'facingMin': 0.2, 'fit': False},
        ],
        'regions': [
            # The canvas tilt over the tub only: the drawing (a pickup with its tilt) and
            # the photos both have the cab's own roof panel over the seats and the canvas
            # starting at the cab's back, not a full tilt over the cab too.
            {'view': 'side', 'outline': [[0.40, 1.18], [1.85, 1.18], [1.85, 1.95], [0.40, 1.95]], 'material': 'paint2'},
            {'view': 'top', 'outline': [[0.40, 0.0], [0.40, 0.9], [1.85, 0.9], [1.85, 0.0]], 'material': 'paint2', 'facingMin': 0.5},
            {'view': 'rear', 'rect': [[0.0, 1.57], [1.8, 0.80]], 'mirror': False, 'material': 'paint2', 'depthRange': [1.5, 1.95]},
            # The grille panel sits back between the wings (the grille on it grey plastic).
            {'view': 'front', 'outline': [[0.0, 1.10], [0.20, 1.10], [0.20, 1.06], [0.37, 1.06], [0.37, 0.71], [0.0, 0.71]],
             'depthRange': [-1.95, -1.5]},
        ],
        'decals': [
            {'view': 'front', 'rect': [[0.0, 0.89], [0.62, 0.26]], 'radius': 0.03, 'mirror': False, 'material': 'alu',
             'height': 0.004, 'depthRange': [-1.95, -1.5]},
            {'view': 'front', 'circle': [[0.52, 0.88], 0.10], 'material': 'chrome', 'height': 0.006, 'depthRange': [-1.95, -1.5]},
            {'view': 'front', 'node': 'headlights', 'circle': [[0.52, 0.88], 0.085], 'material': 'Headlights', 'height': 0.010,
             'depthRange': [-1.95, -1.5]},
            # The wing's front face: the amber indicator is the UPPER of the two small
            # lamps outboard of the headlamp and the clear side lamp the lower (the
            # photos), an elongated amber lens and a small round side lamp.
            {'view': 'front', 'node': 'front_blinker_left', 'rect': [[0.71, 0.955], [0.075, 0.04]], 'radius': 0.016,
             'material': 'IndicatorLights', 'height': 0.010, 'depthRange': [-1.95, -1.5]},
            {'view': 'front', 'node': 'front_blinker_right', 'rect': [[0.71, 0.955], [0.075, 0.04]], 'radius': 0.016,
             'material': 'IndicatorLights', 'height': 0.010, 'depthRange': [-1.95, -1.5]},
            {'view': 'front', 'circle': [[0.71, 0.80], 0.023], 'material': 'Headlights', 'height': 0.010, 'depthRange': [-1.95, -1.5]},
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
            # Bright galvanised grille slats on the dark recess (the photos' grille is
            # bare metal, not black plastic).
            {'view': 'front', 'span': [-0.30, 0.30], 'b': [0.74, 1.04], 'count': 10, 'width': 0.012, 'dir': 'v',
             'material': 'alu', 'height': 0.006, 'depthRange': [-1.95, -1.5]},
        ],
        'lines': [
            {'view': 'side', 'points': [[-0.49, 1.66], [-0.49, 0.52], [0.37, 0.52], [0.37, 1.66]], 'width': 0.008},
            {'view': 'side', 'points': [[-0.49, 1.17], [0.37, 1.17]], 'width': 0.008},
            {'view': 'side', 'points': [[-1.78, 1.06], [-0.50, 1.10]], 'width': 0.005},
            {'view': 'side', 'points': [[0.40, 1.17], [1.80, 1.17]], 'width': 0.02, 'material': 'alu', 'height': 0.012},
            {'view': 'rear', 'points': [[-0.50, 0.70], [-0.50, 1.20], [0.50, 1.20], [0.50, 0.70]], 'mirror': False, 'width': 0.008,
             'depthRange': [1.5, 1.95], 'facingMin': 0.2},
            {'view': 'rear', 'points': [[0.0, 0.72], [0.0, 1.17]], 'mirror': False, 'width': 0.008, 'depthRange': [1.5, 1.95],
             'facingMin': 0.2},
        ],
        'bumpers': {
            # Galvanised steel blades, bare (the photos), not black plastic.
            'front': {'z': [0.51, 0.62], 'depth': 0.10, 'wrap': 0.02, 'profile': 'blade', 'material': 'alu', 'standOff': 0.0},
            'rear': {'z': [0.50, 0.56], 'depth': 0.06, 'wrap': 0.02, 'profile': 'blade', 'material': 'alu', 'standOff': 0.0},
        },
        'mirror': {'y': -0.45, 'z': 1.32, 'reach': 0.92, 'w': 0.13, 'h': 0.13, 'shape': 'round'},
        'handles': {'at': [[0.25, 1.08]], 'w': 0.10},
        'wipers': {'arms': [[-0.55, -0.1, -0.52, 1.75], [0.1, 0.55, -0.52, 1.75]]},
        'wheel': {'style': 'steel', 'windows': 0, 'rimFactor': 0.62, 'cap': True},
    },
}

# The tilt is drawn at 1.83 m for the car's 1.95 unladen (Land Rover: 76.875 in): the cab
# and tilt are brought up above the waist. The length is the body's, front bumper to the
# rear crossmember: the 3620 published counts the towing jaw behind it.
import os as _os, sys as _sys  # noqa: E402
_sys.path.insert(0, _os.path.dirname(__file__))
from _frame import scale_above, shift_along  # noqa: E402
shift_along(CAR, 0.045)  # the front axle 4.5 cm further from the middle at 3530
scale_above(CAR, 1.17, 1.834, 1.95)
