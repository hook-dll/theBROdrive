# Lancia Delta HF Integrale (1987-92). Factory: 3900 x 1700 x 1365, wheelbase 2480, tracks
# 1400/1380, 205/60 R15, clearance 140. The Integrale Evo drawing at getoutlines.com (CC):
# its arches are the Evo's, a little wider than the 8v/16v's 1700 the plan is fitted to.
CAR = {
    'id': 'delta',
    'label': 'Lancia Delta Integrale',
    'factory': {'length': 3.9, 'width': 1.7, 'height': 1.365, 'clearance': 0.14, 'wheelbase': 2.48,
                'frontTrack': 1.4, 'rearTrack': 1.38, 'wheelRadius': 0.295, 'tyreWidth': 0.205, 'frontOverhang': 0.75},
    'blueprint': {
        'image': 'delta_go.png',
        # The drawing's own side silhouette, traced in metres (nose left, z up). With the
        # pixels left to speak, two of the drawing's lines, not the car's, were built: the
        # top line's +15 mm bump over the roof at y 0.45-0.52 (a drip rail / aerial drawn
        # above the skin, which stood a ridge along the roof's middle) and the spoiler lip
        # at y 1.65-1.80 (the rear wiper and the drawn hatch lip, 20-40 mm above the
        # panel's own line). The hatch is one flat raked panel from the roof's end
        # (1.160, 1.336) to the corner at (1.888, 0.905) -- the photo's crisp edge -- over
        # a vertical tail panel, with the bumper standing proud below it, and the front is
        # the drawing's: the bumper's face at y -1.96, a near-vertical grille above it and
        # a long, flat bonnet (0.78 -> 0.92 over 0.9 m) to the screen.
        'side': {'box': [578, 12, 1735, 410], 'nose': 'left', 'ground': 411,
                 'outline': [[-1.962, 0.545], [-1.930, 0.565], [-1.914, 0.635], [-1.904, 0.700],
                             [-1.886, 0.760], [-1.858, 0.782],
                             [-1.620, 0.836], [-1.400, 0.868], [-1.150, 0.900], [-0.960, 0.916],
                             [-0.220, 1.330],
                             [0.000, 1.352], [0.250, 1.364], [0.500, 1.365], [0.750, 1.362], [0.950, 1.355],
                             [1.060, 1.348], [1.160, 1.336],
                             [1.888, 0.905], [1.888, 0.562], [1.915, 0.552], [1.945, 0.535], [1.950, 0.520],
                             [1.950, 0.465], [1.945, 0.455], [1.930, 0.430], [1.920, 0.410], [1.900, 0.390],
                             [1.888, 0.300],
                             [1.700, 0.262], [1.400, 0.245], [1.000, 0.220], [0.000, 0.210], [-1.000, 0.210],
                             [-1.300, 0.218], [-1.550, 0.235], [-1.650, 0.215], [-1.720, 0.205], [-1.780, 0.235],
                             [-1.840, 0.240], [-1.880, 0.320], [-1.920, 0.380], [-1.960, 0.400]]},
        'top': {'box': [580, 440, 1735, 995], 'nose': 'left', 'fitWidth': True},
        'front': {'box': [5, 10, 565, 410]},
        'rear': {'box': [5, 518, 568, 916]},
    },
    'hull': {
        'sill': [[-1.95, 0.32], [-1.7, 0.27], [-1.3, 0.22], [1.0, 0.22], [1.4, 0.25], [1.95, 0.30]],
        'cabin': [-0.80, 1.90],
        # The belt rises to the tail (0.905) so the cabin ends where the hatch's panel
        # does. At 0.88 the outline's top at the last cabin station (1.88, 0.90) was
        # still above it, so the station past the cabin -- the bumper's top, 0.70 -- was
        # read as the "deck" and beltBlend dragged the last 20 cm of the quarter's top
        # down on to it: a 12 cm dent in the tail's face below the hatch's corner
        # (the quarter "rolling" into the tail panel).
        'belt': [[-0.80, 0.96], [-0.5, 0.89], [1.0, 0.895], [1.45, 0.898], [1.72, 0.904], [1.90, 0.905]],
        'glassPlan': [[-0.80, 0.68], [-0.4, 0.72], [1.0, 0.72], [1.5, 0.68], [1.90, 0.63]],
        'crown': [[-2.0, 0.008], [2.0, 0.008]],
        'roofCrown': 0.015,
        # A boxy hatchback: the roof's edge is a tight drip rail, not the default 6 cm
        # roll (which left the gutter line wandering over a soft shoulder and pinched a
        # fold where the screen meets the roof at the A-pillar).
        'roofEdge': 0.035,
        'edge': 0.012,
        # a boxy car: crisp edges (the default 2.2 / 6 cm blur made it a pebble)
        'edgeMin': 0.013,
        # The tail's corner and the bonnet's leading edge are features along the car: a
        # 2.5 cm blur along y rounded both by 8 cm (the bonnet's top, at y -1.90, came out
        # at 0.637 where the drawing has 0.723, and the tail's crisp edge rolled into the
        # hatch). Down to the in-plane radius, so the corners keep theirs.
        'edgeY': 0.014,
        'edgeYMin': 0.014,
        # a crisp box hatchback (photos): the end faces and the shoulder lines are the
        # car's, not the drawing's pixels. With the side outline above traced by hand
        # they carry no drawing noise of their own, and fairing them hurt: its 15 cm
        # knots, over the 27 cm the nose's profile runs back between z 0.78 and 0.86
        # (the bonnet's leading edge), pulled the profile 13 cm further back, and the
        # mask's clip then cut the bonnet's surface down with it -- an 8 mm sag along
        # its middle that no drawn line accounts for.
        'faceSpacing': 0,
        'faceSmooth': 0.004,
        # The plan as the 16v's, not the Evo drawing's: the drawing's top view carries
        # the Evo's arch flares (0.83-0.85 over the wheels against 0.81 at the doors),
        # and the section scales the plan at every height, so each arch came out as a
        # 15-35 mm swelling with a ramp up to the door -- the blisters the zebra shows
        # over both wheels. The 16v's body is flat-sided under the plastic extensions
        # (parts.archFlares) and its corners turn in 15 cm (photos), where the fitted
        # plan spread the taper over 30.
        # ...and its tail: the drawing's top view, and its rear view (half 0.83 at the
        # shoulder), keeps the full width back to y 1.90 and turns in over the last 5 cm.
        # The old hand taper (0.55 at 1.90, 0 at 1.95) pinched the tail's corners into
        # the dome the rear render showed, with the tail lamps' outer halves cut off.
        'planOverride': [[-1.950, 0.00], [-1.945, 0.26], [-1.920, 0.44], [-1.890, 0.56], [-1.860, 0.65],
                         [-1.820, 0.73], [-1.780, 0.775], [-1.720, 0.800], [-1.650, 0.812], [-1.550, 0.816],
                         [-1.200, 0.817], [-0.600, 0.818], [0.000, 0.818], [0.600, 0.818], [1.100, 0.818],
                         [1.400, 0.816], [1.600, 0.812], [1.720, 0.804], [1.800, 0.798], [1.860, 0.790],
                         [1.900, 0.772], [1.922, 0.730], [1.938, 0.640], [1.948, 0.420], [1.950, 0.00]],
        # The wheel openings are the body's, under the extensions: the tyre (0.59) with
        # 5 cm of gap above it, where 0.35/0.05 left 10.5 cm of air in the arch.
        'arch': {'radius': 0.33, 'lift': 0.015},
    },
    'parts': {
        # A thin black seal: the default 14 mm read as a thick band next to the drip rail.
        'glassSeal': {'material': 'rubber', 'width': 0.010},
        # The 16v's black plastic arch extensions (photos): a band round each opening,
        # standing 12 mm off the flat side. The Evo drawing's flares are in the plan
        # above, not here.
        'archFlares': [{'axle': 'both', 'r': 0.345, 'w': 0.05, 't': 0.012, 'lift': 0.015}],
        'glass': [
            {'view': 'side', 'outline': [[0.295, 1.261], [0.066, 1.251], [-0.195, 1.237], [-0.42, 1.06], [-0.45, 0.90], [0.30, 0.89]],
             'facingMin': 0.3},
            {'view': 'side', 'outline': [[0.408, 1.258], [0.385, 0.895], [0.922, 0.905], [0.922, 1.248], [0.566, 1.261]], 'facingMin': 0.3},
            {'view': 'side', 'outline': [[0.956, 1.241], [0.956, 0.905], [1.107, 0.902], [1.165, 0.968], [1.083, 1.092], [0.997, 1.206]],
             'facingMin': 0.3},
            {'view': 'front', 'outline': [[0.0, 1.30], [0.48, 1.295], [0.52, 1.27], [0.62, 0.97], [0.60, 0.95], [0.0, 0.95]],
             'depthRange': [-1.0, -0.2], 'facingMin': 0.25},
            # The big back light (photo): the screen runs from the roof's end down to
            # 8 cm above the hatch's corner (0.985) as the drawn outline has it -- with
            # `fit` off, so the foot stays where the drawing puts it instead of being
            # raised on to the shell's turned-away faces. At 1.12 it was a letterbox.
            {'view': 'rear', 'outline': [[0.0, 1.275], [0.44, 1.268], [0.505, 1.230], [0.548, 1.105], [0.548, 0.985],
                                         [0.0, 0.985]],
             'depthRange': [1.2, 2.0], 'facingMin': 0.15, 'fit': False},
        ],
        # Grey moulded bumpers wrapping the ends.
        'regions': [
            {'view': 'front', 'rect': [[0.0, 0.40], [1.8, 0.27]], 'radius': 0.001, 'mirror': False, 'depthRange': [-2.0, -1.55]},
            {'view': 'side', 'outline': [[-1.98, 0.27], [-1.98, 0.53], [-1.42, 0.53], [-1.50, 0.40], [-1.52, 0.27]]},
            {'view': 'rear', 'rect': [[0.0, 0.35], [1.8, 0.24]], 'radius': 0.001, 'mirror': False, 'depthRange': [1.55, 2.0]},
            {'view': 'side', 'outline': [[1.50, 0.30], [1.50, 0.50], [1.98, 0.50], [1.98, 0.30]]},
        ],
        'decals': [
            {'view': 'front', 'rect': [[0.0, 0.63], [1.30, 0.17]], 'radius': 0.01, 'mirror': False, 'material': 'trim',
             'height': 0.004, 'depthRange': [-2.0, -1.6]},
            {'view': 'front', 'node': 'headlights', 'circle': [[0.62, 0.635], 0.07], 'material': 'Headlights',
             'height': 0.010, 'depthRange': [-2.0, -1.6]},
            {'view': 'front', 'node': 'headlights', 'circle': [[0.46, 0.635], 0.07], 'material': 'Headlights',
             'height': 0.010, 'depthRange': [-2.0, -1.6]},
            {'view': 'front', 'outline': [[0.03, 0.70], [0.36, 0.70], [0.38, 0.66], [0.36, 0.57], [0.05, 0.57], [0.03, 0.60]],
             'material': 'grille', 'height': 0.008, 'depthRange': [-2.0, -1.6]},
            {'view': 'front', 'rect': [[0.0, 0.55], [1.40, 0.02]], 'radius': 0.005, 'mirror': False, 'material': 'chrome',
             'height': 0.006, 'depthRange': [-2.0, -1.6]},
            {'view': 'front', 'rect': [[0.0, 0.33], [1.20, 0.08]], 'radius': 0.02, 'mirror': False, 'material': 'grille',
             'height': 0.004, 'depthRange': [-2.0, -1.55]},
            {'view': 'front', 'node': 'front_blinker_left', 'rect': [[0.80, 0.63], [0.05, 0.10]], 'radius': 0.006,
             'material': 'IndicatorLights', 'height': 0.008, 'facingMin': 0.4, 'depthRange': [-2.0, -1.5]},
            {'view': 'front', 'node': 'front_blinker_right', 'rect': [[0.80, 0.63], [0.05, 0.10]], 'radius': 0.006,
             'material': 'IndicatorLights', 'height': 0.008, 'facingMin': 0.4, 'depthRange': [-2.0, -1.5]},
            # The 16v's bonnet: one recessed louvred panel, centred on the bonnet (photos:
            # symmetric about the centre line), a 44 x 28 cm rounded panel with six
            # louvres across it. The old pair of 7 and 9 cm strips read as painted bars.
            {'view': 'top', 'rect': [[-1.30, 0.0], [0.44, 0.28]], 'radius': 0.035, 'mirror': False,
             'material': 'grille', 'height': 0.004},
            {'view': 'top', 'rect': [[-1.30, -0.1125], [0.42, 0.016]], 'radius': 0.006, 'mirror': False, 'material': 'chrome', 'height': 0.006},
            {'view': 'top', 'rect': [[-1.30, -0.0675], [0.42, 0.016]], 'radius': 0.006, 'mirror': False, 'material': 'chrome', 'height': 0.006},
            {'view': 'top', 'rect': [[-1.30, -0.0225], [0.42, 0.016]], 'radius': 0.006, 'mirror': False, 'material': 'chrome', 'height': 0.006},
            {'view': 'top', 'rect': [[-1.30, 0.0225], [0.42, 0.016]], 'radius': 0.006, 'mirror': False, 'material': 'chrome', 'height': 0.006},
            {'view': 'top', 'rect': [[-1.30, 0.0675], [0.42, 0.016]], 'radius': 0.006, 'mirror': False, 'material': 'chrome', 'height': 0.006},
            {'view': 'top', 'rect': [[-1.30, 0.1125], [0.42, 0.016]], 'radius': 0.006, 'mirror': False, 'material': 'chrome', 'height': 0.006},
            # The scuttle vents along the screen's foot, and the wing's repeater.
            {'view': 'top', 'rect': [[-0.75, 0.0], [0.10, 1.25]], 'radius': 0.01, 'mirror': False,
             'material': 'grille', 'height': 0.004},
            {'view': 'side', 'node': 'front_blinker_left', 'rect': [[-1.30, 0.76], [0.05, 0.03]],
             'material': 'IndicatorLights', 'height': 0.005},
            {'view': 'side', 'node': 'front_blinker_right', 'rect': [[-1.30, 0.76], [0.05, 0.03]],
             'material': 'IndicatorLights', 'height': 0.005},
            # Tail: the 16v's tall corner units (photos) -- red at the top, an amber
            # band, red below, the outer edge following the quarter's corner out as it
            # comes down, from the hatch's lower edge to the bumper. The old wedges were
            # half that height and sat up at the belt.
            {'view': 'rear', 'node': 'taillights', 'outline': [[0.49, 0.85], [0.665, 0.85], [0.715, 0.50], [0.49, 0.50]],
             'material': 'TailLights', 'height': 0.008, 'depthRange': [1.6, 2.0], 'facingMin': 0.1},
            {'view': 'rear', 'node': 'rear_blinker_left', 'outline': [[0.49, 0.73], [0.678, 0.73], [0.688, 0.64], [0.49, 0.64]],
             'material': 'IndicatorLights', 'height': 0.011, 'depthRange': [1.6, 2.0], 'facingMin': 0.1},
            {'view': 'rear', 'node': 'rear_blinker_right', 'outline': [[0.49, 0.73], [0.678, 0.73], [0.688, 0.64], [0.49, 0.64]],
             'material': 'IndicatorLights', 'height': 0.011, 'depthRange': [1.6, 2.0], 'facingMin': 0.1},
            {'view': 'rear', 'node': 'reverse_lights', 'rect': [[0.545, 0.532], [0.07, 0.06]], 'radius': 0.006,
             'material': 'ReverseLights', 'height': 0.011, 'depthRange': [1.6, 2.0]},
            {'view': 'rear', 'rect': [[0.0, 0.76], [0.66, 0.15]], 'radius': 0.01, 'mirror': False, 'material': 'plate',
             'height': 0.005, 'depthRange': [1.6, 2.0]},
        ],
        'bars': [
            # The bumper's lower intake has cross slats (photos), not a row of teeth.
            {'view': 'front', 'span': [-0.30, 0.30], 'b': [0.44, 0.53], 'count': 3, 'dir': 'h', 'width': 0.015,
             'material': 'grille', 'height': 0.006, 'depthRange': [-2.0, -1.55]},
        ],
        'lines': [
            {'view': 'side', 'points': [[-0.47, 0.88], [-0.48, 0.30], [0.35, 0.30], [0.36, 0.89]], 'width': 0.005},
            {'view': 'side', 'points': [[0.36, 0.30], [0.97, 0.30], [1.0, 0.45], [0.99, 0.90]], 'width': 0.005},
            {'view': 'side', 'points': [[-1.45, 0.78], [-0.3, 0.80], [1.75, 0.83]], 'width': 0.006, 'material': 'trim', 'height': 0.003},
            {'view': 'side', 'points': [[-0.42, 0.24], [1.05, 0.24]], 'width': 0.06, 'material': 'trim', 'height': 0.004},
            # The drip rail along the roof's edge: a thin black line in the photographs (the
            # 14 mm one lay as a second thick band beside the panes' seals). It starts at
            # the roof's front edge: carried down the A-pillar it crossed the screen's own
            # seal at the pillar's head, where the two cut a soft fold into the shoulder.
            {'view': 'side', 'points': [[-0.26, 1.245], [0.30, 1.275], [0.93, 1.26], [1.10, 1.28], [1.86, 0.92]],
             'width': 0.007, 'material': 'trim', 'height': 0.003},
            {'view': 'side', 'points': [[0.34, 0.89], [0.37, 1.27]], 'width': 0.04, 'material': 'trim', 'height': 0.003},
            {'view': 'side', 'points': [[0.92, 0.90], [0.93, 1.25]], 'width': 0.04, 'material': 'trim', 'height': 0.003},
        ],
        'mirror': {'y': -0.42, 'z': 0.95, 'reach': 0.93, 'w': 0.14, 'h': 0.08, 'material': 'trim'},
        'handles': {'at': [[0.15, 0.85], [0.84, 0.85]], 'w': 0.10, 'material': 'trim'},
        'wipers': {'arms': [[-0.55, -0.05, -0.80, 0.97], [0.05, 0.5, -0.80, 0.97]]},
        'wheel': {'style': 'alloy', 'spokes': 8, 'rimFactor': 0.74, 'spokeWidth': 0.3},
    },
}
