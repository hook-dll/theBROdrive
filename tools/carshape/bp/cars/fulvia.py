# Lancia Fulvia Coupé Rallye 1.3 S (1967-76). Factory: 3935 x 1555 x 1300, wheelbase 2330,
# overhangs 805/800, tracks 1300/1280, 155-14, clearance 130. The dimensioned drawing
# reprinted at 3dcar.ru/blueprints/lancia/fulvia_coupe_hf_1967.
CAR = {
    'id': 'fulvia',
    'label': 'Lancia Fulvia Coupé',
    'factory': {'length': 3.935, 'width': 1.555, 'height': 1.3, 'clearance': 0.13, 'wheelbase': 2.33,
                'frontTrack': 1.3, 'rearTrack': 1.28, 'wheelRadius': 0.29, 'tyreWidth': 0.155, 'frontOverhang': 0.805},
    'blueprint': {
        'image': 'fulvia.jpg',
        'dark': 110,
        'side': {'box': [652, 46, 1925, 570], 'nose': 'left', 'wheels': [[921.5, 327], [1572.5, 327]], 'ground': 406, 'ppmz': 270,
                 'drop': [[1180, 0, 1273, 400], [850, 0, 1273, 16], [1136, 150, 1152, 520]]},
        'top': {'box': [691, 668, 1805, 1123], 'nose': 'left', 'fitWidth': True},
        'front': {'box': [98, 44, 580, 570], 'ppm': 282, 'zRef': [[51, 1.3], [405, 0.0]]},
        'rear': {'box': [100, 670, 569, 1121], 'ppm': 280, 'zRef': [[677, 1.3], [1030, 0.0]]},
    },
    'hull': {
        'sill': [[-1.97, 0.40], [-1.8, 0.32], [-1.55, 0.27], [-1.2, 0.26], [1.1, 0.26], [1.45, 0.28], [1.75, 0.32], [1.97, 0.36]],
        # The wing mirrors and washer jets stand on the scuttle in the drawing.
        # One top line for the whole bonnet, screen and roof (a second `topOverride`
        # key would shadow this one - the roof's did, so the bonnet ran on the drawing's
        # raw line and waved +-3 cm: the mirrors and jets drawn standing on the scuttle
        # bump it). The line is the drawing's own: bonnet 0.87 at -1.30 to 0.95 at the
        # screen's foot, the screen's straight rake to 1.29 at -0.42, the roof's true
        # height (the drawing's 1.375-1.40 there is its gutter/rack, the car is 1.30)
        # flat to the rear edge.
        'topOverride': [[-1.30, 0.870], [-1.10, 0.888], [-0.95, 0.915], [-0.82, 0.95], [-0.70, 1.055],
                        [-0.60, 1.1425], [-0.50, 1.23], [-0.42, 1.29], [-0.34, 1.292], [-0.18, 1.2925],
                        [0.0, 1.299], [0.20, 1.3035], [0.40, 1.3055], [0.56, 1.307]],
        'cabin': [-0.68, 1.03],
        'belt': [[-0.68, 0.89], [-0.45, 0.85], [0.6, 0.835], [1.03, 0.82]],
        'glassPlan': [[-0.68, 0.64], [-0.3, 0.70], [0.6, 0.70], [1.03, 0.62]],
        # The car is a slim coupé: flat sides with a shoulder crease along the belt, a
        # flat bonnet and a flat roof, so no crown along the car and next to none across
        # it (2-3 cm of crown domed the roof and swelled the wings).
        'crown': [[-2.0, 0.008], [2.0, 0.008]],
        'roofCrown': 0.012,
        # Crisp folds (0.011 over a 1.4 cm floor, 2 cm along the car instead of the
        # 6 cm default): the blur was what made the nose a rounded block, the shoulders
        # soft and the tail panel roll.
        'edge': 0.011,
        'edgeMin': 0.014,
        'edgeY': 0.02,
        'edgeYMin': 0.02,
        # The 4 cm blur rounded the nose and the deck's rear edge away (the tail came off
        # its drawn line 6 cm low at +1.90): the ends' outlines faired with their corners
        # kept (the drawing's bonnet brow over the lamps, the boot lid's rear edge).
        'faceSpacing': 0.15, 'cornerDeg': 20,
        # The drawing's arch lip tops out at z 0.645 over the axle (the swage line at
        # 0.689 is above it); with R 0.29 + lift 0.03 + r 0.36 the opening sat 4 cm high
        # and read as a gap above the tyre (the photos leave 6 cm, not 10).
        'arch': {'radius': 0.355, 'lift': 0.0},
        # The roof's side edge above the windows also waved (the drawn section's top
        # left it a wide roll that a 3 mm dip read as a crumple): the section is held
        # at its width 8 cm below the top line, so the roof is a flat panel with one
        # crisp crease down each side as the photos show.
        'roofEdge': 0.08,
    },
    # Thin chrome frames (the photos: about 8 mm, not the 12 the drawn frame lines
    # carried); every pane's own seal carries them.
    'glassSeal': {'material': 'chrome', 'width': 0.008},
    'parts': {
        'glass': [
            {'view': 'side', 'outline': [[-0.29, 1.0], [-0.24, 0.848], [0.568, 0.837], [0.582, 1.181], [0.536, 1.193], [0.181, 1.219],
                                         [-0.10, 1.215], [-0.14, 1.20], [-0.25, 1.07]], 'facingMin': 0.3},
            # The quarter light's foot corner: its two edges meet at 48 degrees and the
            # seal's inset (assemble.py, capped at 3 band widths) ran a 2.4 cm spur out
            # of it, over the C-pillar. A 3 cm radius arc in the outline takes the
            # corner out of the inset.
            {'view': 'side', 'outline': [[0.625, 1.174], [0.611, 0.833], [0.980, 0.8235], [1.010, 0.826], [1.023, 0.833],
                                         [1.019, 0.845], [0.811, 1.07], [0.747, 1.126], [0.704, 1.152],
                                         [0.657, 1.17]], 'facingMin': 0.3},
            {'view': 'front', 'outline': [[0.0, 1.235], [0.42, 1.215], [0.52, 1.165], [0.575, 0.90], [0.555, 0.875], [0.0, 0.875]],
             'depthRange': [-0.75, -0.15], 'facingMin': 0.2},
            {'view': 'rear', 'outline': [[0.0, 1.195], [0.40, 1.18], [0.48, 1.13], [0.53, 0.87], [0.51, 0.852], [0.0, 0.86]],
             'depthRange': [0.7, 1.6], 'facingMin': 0.15},
        ],
        'decals': [
            # The nose: four round lamps in chrome rings on the body, the fine grille in a
            # chrome trapezoid between the inner pair, its shield.
            {'view': 'front', 'outline': [[0.0, 0.64], [0.31, 0.64], [0.29, 0.44], [0.0, 0.44]], 'material': 'chrome',
             'height': 0.003, 'depthRange': [-2.1, -1.6]},
            {'view': 'front', 'outline': [[0.0, 0.625], [0.295, 0.625], [0.275, 0.455], [0.0, 0.455]], 'material': 'grille',
             'height': 0.005, 'depthRange': [-2.1, -1.6]},
            {'view': 'front', 'circle': [[0.387, 0.54], 0.074], 'material': 'chrome', 'height': 0.008, 'depthRange': [-2.1, -1.6]},
            {'view': 'front', 'circle': [[0.585, 0.538], 0.074], 'material': 'chrome', 'height': 0.008, 'depthRange': [-2.1, -1.6]},
            {'view': 'front', 'node': 'headlights', 'circle': [[0.387, 0.54], 0.06], 'material': 'Headlights', 'height': 0.012,
             'depthRange': [-2.1, -1.6]},
            {'view': 'front', 'node': 'headlights', 'circle': [[0.585, 0.538], 0.06], 'material': 'Headlights', 'height': 0.012,
             'depthRange': [-2.1, -1.6]},
            {'view': 'front', 'outline': [[0.0, 0.67], [0.03, 0.64], [0.03, 0.56], [0.0, 0.53], [-0.03, 0.56], [-0.03, 0.64]],
             'mirror': False, 'material': 'chrome', 'height': 0.010, 'depthRange': [-2.1, -1.6]},
            # The amber indicators sit in the lamp panel's outer ends at the lamps' own
            # height (the photos of the 1.3 S), not low and inboard where the drawing's
            # four HF slots are: outboard of the outer lamp, at the wing's corner.
            {'view': 'front', 'node': 'front_blinker_left', 'rect': [[0.652, 0.527], [0.062, 0.028]], 'radius': 0.013,
             'material': 'IndicatorLights', 'height': 0.008, 'depthRange': [-2.1, -1.6]},
            {'view': 'front', 'node': 'front_blinker_right', 'rect': [[0.652, 0.527], [0.062, 0.028]], 'radius': 0.013,
             'material': 'IndicatorLights', 'height': 0.008, 'depthRange': [-2.1, -1.6]},
            {'view': 'front', 'rect': [[0.0, 0.33], [0.40, 0.09]], 'radius': 0.005, 'mirror': False, 'material': 'plate',
             'height': 0.004, 'depthRange': [-2.1, -1.6]},
            # The tail: one chrome-framed cluster a side under the deck: the stop/tail a
            # round red lens inboard with the amber indicator lens beside it outboard (the
            # photos of the 1.3 S); the reversing lamp sits on the panel below the
            # cluster's outer end, in its own chrome bezel.
            {'view': 'rear', 'rect': [[0.545, 0.60], [0.30, 0.10]], 'radius': 0.025, 'material': 'chrome',
             'height': 0.004, 'depthRange': [1.6, 2.1], 'facingMin': 0.1},
            {'view': 'rear', 'node': 'taillights', 'circle': [[0.475, 0.60], 0.042], 'material': 'TailLights',
             'height': 0.008, 'depthRange': [1.6, 2.1], 'facingMin': 0.1},
            {'view': 'rear', 'node': 'rear_blinker_left', 'rect': [[0.625, 0.60], [0.105, 0.05]], 'radius': 0.02,
             'material': 'IndicatorLights', 'height': 0.008, 'depthRange': [1.6, 2.1], 'facingMin': 0.1},
            {'view': 'rear', 'node': 'rear_blinker_right', 'rect': [[0.625, 0.60], [0.105, 0.05]], 'radius': 0.02,
             'material': 'IndicatorLights', 'height': 0.008, 'depthRange': [1.6, 2.1], 'facingMin': 0.1},
            {'view': 'rear', 'rect': [[0.625, 0.495], [0.075, 0.045]], 'radius': 0.012, 'material': 'chrome',
             'height': 0.004, 'depthRange': [1.6, 2.1], 'facingMin': 0.1},
            {'view': 'rear', 'node': 'reverse_lights', 'rect': [[0.625, 0.495], [0.055, 0.03]], 'radius': 0.006,
             'material': 'ReverseLights', 'height': 0.008, 'depthRange': [1.6, 2.1], 'facingMin': 0.1},
            {'view': 'rear', 'rect': [[0.0, 0.51], [0.30, 0.13]], 'radius': 0.006, 'mirror': False, 'material': 'plate',
             'height': 0.008, 'depthRange': [1.6, 2.1], 'facingMin': 0.1},
        ],
        'bars': [
            {'view': 'front', 'span': [-0.27, 0.27], 'b': [0.46, 0.62], 'count': 8, 'width': 0.005,
             'material': 'chrome', 'height': 0.008, 'depthRange': [-2.1, -1.6]},
        ],
        'lines': [
            {'view': 'side', 'points': [[-0.50, 0.85], [-0.516, 0.29], [0.62, 0.28], [0.62, 0.83]], 'width': 0.005},
            {'view': 'side', 'points': [[-0.29, 1.0], [-0.24, 0.848], [0.568, 0.837], [0.582, 1.181], [0.536, 1.193], [0.181, 1.219],
                                        [-0.10, 1.215], [-0.25, 1.07], [-0.29, 1.0]], 'width': 0.012, 'material': 'chrome', 'height': 0.003},
            {'view': 'side', 'points': [[0.625, 1.174], [0.611, 0.833], [1.026, 0.822], [0.811, 1.07], [0.704, 1.152], [0.625, 1.174]],
             'width': 0.012, 'material': 'chrome', 'height': 0.003},
            {'view': 'side', 'points': [[-0.10, 1.215], [-0.09, 0.85]], 'width': 0.012, 'material': 'chrome', 'height': 0.003},
            {'view': 'side', 'points': [[-1.94, 0.70], [1.95, 0.70]], 'width': 0.004, 'material': 'rubber'},
        ],
        'bumpers': {
            'front': {'z': [0.40, 0.44], 'depth': 0.035, 'wrap': 0.30, 'profile': 'round', 'standOff': 0.0},
            'rear': {'z': [0.43, 0.47], 'depth': 0.035, 'wrap': 0.30, 'profile': 'round', 'standOff': 0.0},
        },
        'mirror': {'y': -0.52, 'z': 0.90, 'reach': 0.84, 'w': 0.08, 'h': 0.06, 'material': 'chrome', 'shape': 'round'},
        'handles': {'at': [[0.45, 0.76]], 'w': 0.11},
        'wipers': {'arms': [[-0.5, -0.05, -0.70, 0.90], [0.05, 0.5, -0.70, 0.90]]},
        # Plain steel wheels with a small chrome centre cap (the photos of the Rallye
        # 1.3 S: no cast alloy, the hubcap type came with the 1.6 HF's Cromodoras).
        'wheel': {'style': 'steel', 'windows': 0, 'rimFactor': 0.68, 'cap': True},
    },
}
