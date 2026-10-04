# Lancia Fulvia Coupé Rallye 1.3 S (1967-76). Factory (automobile-catalog/carfolio/
# conceptcarz for the 1967-70 Coupé, all agreeing): 3975 x 1555 x 1300, wheelbase 2330,
# tracks 1300/1280, clearance 130, 145 SR 14 (155 SR 14 on later cars). The file's
# 3935 was 805+800+2330 - a rear overhang 40 mm short of the factory length; the wheel
# radius was 0.29 where a 145 SR 14 is 0.1778+0.145*0.82 = 0.297 (the side photograph's
# tyre measures 0.591 m across, ground 2908 px, front axle x 1199, 1159 px/m).
# Front overhang 0.805 is the dimensioned drawing's own (side view content -1.969 to
# +1.947 at z 0.70 over a 2330 mm wheelbase = 279.4 px/m), rear = 3.975-2.330-0.805.
# The dimensioned drawing reprinted at 3dcar.ru/blueprints/lancia/fulvia_coupe_hf_1967.
CAR = {
    'id': 'fulvia',
    'label': 'Lancia Fulvia Coupé',
    'factory': {'length': 3.975, 'width': 1.555, 'height': 1.3, 'clearance': 0.13, 'wheelbase': 2.33,
                'frontTrack': 1.3, 'rearTrack': 1.28, 'wheelRadius': 0.297, 'tyreWidth': 0.145, 'frontOverhang': 0.825},
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
        # bump it). The line is the side photograph's own silhouette (full-res 5184 px:
        # 1159 px/m from the 2.33 m wheelbase, ground row 2908, front axle column 1199),
        # read column by column as the first long run of car pixels: the bonnet falls
        # from 0.885 at the cowl to 0.780 at y -1.59 and rounds down onto the nose's
        # brow at ~0.66-0.68, which the dimensioned drawing's own silhouette agrees with
        # (0.711 at -1.958). The old line started at y -1.30, so the whole nose was
        # clamped level at 0.870: the flat, high front that lost the light overhang.
        # The screen's rake is the photograph's (its silhouette passes -0.51 at z 1.00
        # and -0.29 at 1.15), the header the drawn -0.218, the roof 1.30 (the drawing's
        # 1.375-1.40 there is its gutter/rack) flat to the rear edge.
        'topOverride': [[-1.97, 0.660], [-1.90, 0.680], [-1.82, 0.712], [-1.75, 0.735], [-1.67, 0.755],
                        [-1.59, 0.780], [-1.50, 0.797], [-1.42, 0.811], [-1.33, 0.819], [-1.25, 0.831],
                        [-1.16, 0.842], [-1.07, 0.850], [-0.98, 0.855], [-0.90, 0.861], [-0.82, 0.867],
                        [-0.74, 0.873], [-0.68, 0.880], [-0.66, 0.885], [-0.55, 0.978], [-0.45, 1.065],
                        [-0.35, 1.152], [-0.27, 1.228], [-0.218, 1.290], [-0.18, 1.293], [0.0, 1.299],
                        [0.20, 1.3035], [0.40, 1.3055], [0.56, 1.307],
                        # The rear, from the same photograph's trace: the back light's
                        # rake (1.49 m of y per m of z, which the drawing agrees with to
                        # 1%) down to its foot at (+1.15, 0.91), then the deck falling
                        # steadily to a low rounded tail at (+1.95, 0.79). The drawn rear
                        # view put the deck 5 cm lower (0.826 at +1.263); the photograph
                        # wins, and its trace is the line shifted up 2 cm for the 1.30 m
                        # factory roof (the photograph's car reads 1.28).
                        [0.90, 1.150], [1.05, 1.020], [1.15, 0.910], [1.30, 0.895], [1.50, 0.872],
                        [1.70, 0.845], [1.85, 0.820], [1.94, 0.795], [1.98, 0.770]],
        # The cabin starts at the screen's foot (-0.64), not 18 cm ahead of it: the
        # glasshouse's section was carried forward over the bonnet's rear.
        'cabin': [-0.64, 1.03],
        'belt': [[-0.60, 0.868], [-0.45, 0.85], [0.6, 0.835], [1.03, 0.82]],
        'glassPlan': [[-0.60, 0.655], [-0.3, 0.70], [0.6, 0.70], [1.03, 0.62]],
        # The car is a slim coupé: flat sides with a shoulder crease along the belt, a
        # flat bonnet and a flat roof, so no crown along the car and next to none across
        # it (2-3 cm of crown domed the roof and swelled the wings). The photographs'
        # bonnet is a flat panel with its edge crease at the wings: 4 mm across keeps
        # the panel flat, and the deck's edges then fall where the drawn section turns.
        'crown': [[-2.0, 0.004], [2.0, 0.004]],
        'roofCrown': 0.004,
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
        # cornerDeg 32: the ends' outlines faired with rounder corners - the photographs'
        # tail is a low rounded shape, not the boxed square the 20 degree corner gave.
        'faceSpacing': 0.15, 'cornerDeg': 32,
        # The arch's opening over the tyre: the side photograph's lip measures 0.330 m
        # above the front axle's centre (0.628 from the ground) over a 0.297 m tyre -
        # a 3.5 cm gap, not the 6.5 the drawn 0.645-lip gave (the drawing's arch line is
        # the flare's crest, not the opening). With the wheel at 0.29 and the opening at
        # 0.355 the wheels read small in the arches.
        'arch': {'radius': 0.33, 'lift': 0.0},
        # The roof's side edge above the windows also waved (the drawn section's top
        # left it a wide roll that a 3 mm dip read as a crumple): the section is held
        # at its width 3 cm below the top line, so the roof is a flat panel with one
        # crisp crease down each side as the photos show (a tight drip rail). At the
        # 8 cm it was, the hold ran *below* the belt at the cowl's corner - the station
        # where the screen's foot is - and the section jumped between "held from below
        # the belt" and "held above it": a 2 cm bulge-and-dip on the scuttle's shoulder
        # at -0.68..-0.52 (the crumpled skin the user photographed).
        'roofEdge': 0.03,
        # The sheet metal ends 0.745 m ahead of the front axle and 0.735 m behind the
        # rear one (side photograph, its wheelbase as the scale; body 3.81 m). The
        # factory 3975 is over the bumpers: stretched to it, the body's ends grew 8 cm
        # each, the heavy nose and boxy tail.
        'bodyEnds': {'front': -1.9075, 'rear': 1.9025},
    },
    # Thin chrome frames (the photos: about 8 mm, not the 12 the drawn frame lines
    # carried); every pane's own seal carries them.
    'glassSeal': {'material': 'chrome', 'width': 0.008},
    # The side panes are drawn to the drawn pillar lines already; assemble.py's
    # `reach_pillar` (it pushes a front window forward to the pillar, for cars whose
    # panes stopped short) must leave them where they are.
    'pillarReach': 0.0,
    'parts': {
        'glass': [
            # The screen is authored in plan (view 'top'), not in the front view: fitted
            # there it stopped where the shell turns away sideways - 20 cm short of the
            # pillar - and the paint left between read as a 30 cm A-pillar (the user's
            # screenshot). The outline is the drawn glasshouse in plan: the cowl line at
            # -0.64 in the middle sweeping back to the pillar's foot at -0.44, the
            # A-pillar's front edge (the drawn band runs -0.451 at 0.852 to -0.193 at
            # 1.207) up to the roof's front edge at -0.225, which closes it. It wraps
            # onto the pillar's front face at `facingMin` 0.15 - that face is 0.26-0.47
            # up-facing - and its own `iso_cut` rounds the corner; `depthRange` holds it
            # between the screen's foot and the roof.
            {'view': 'top', 'outline': [[-0.64, 0.0], [-0.625, 0.30], [-0.575, 0.50], [-0.52, 0.60],
                                        [-0.465, 0.655], [-0.35, 0.634], [-0.30, 0.614], [-0.26, 0.60],
                                        [-0.235, 0.585], [-0.225, 0.40], [-0.225, 0.0]],
             'depthRange': [0.86, 1.295], 'facingMin': 0.15, 'fit': False},
            # The door window runs forward to the screen pillar's rear edge: the drawn
            # pane stopped at -0.29 and left 30 cm of paint in front of it. Its front
            # edge is the drawn pillar band's rear line (0.852 at -0.397 to 1.207 at
            # -0.132); the chrome line below marks its vent window's division.
            {'view': 'side', 'outline': [[-0.40, 0.852], [-0.135, 1.208], [0.181, 1.219], [0.536, 1.193],
                                         [0.582, 1.181], [0.568, 0.837]], 'facingMin': 0.3},
            # The quarter light's foot corner: its two edges meet at 48 degrees and the
            # seal's inset (assemble.py, capped at 3 band widths) ran a 2.4 cm spur out
            # of it, over the C-pillar. A 3 cm radius arc in the outline takes the
            # corner out of the inset.
            {'view': 'side', 'outline': [[0.625, 1.174], [0.611, 0.833], [0.980, 0.8235], [1.010, 0.826], [1.023, 0.833],
                                         [1.017, 0.845], [0.958, 0.900], [0.905, 0.950], [0.852, 1.000],
                                         [0.773, 1.075], [0.735, 1.111], [0.680, 1.163], [0.645, 1.175]], 'facingMin': 0.3},
            # The back light reaches the roof: its drawn header (1.195 m) left a 10 cm
            # painted band above the glass where the photographs show 3-4 cm, the same
            # fault the Moskvich-412's rear pane had. Its foot stays on the deck.
            {'view': 'rear', 'outline': [[0.0, 1.26], [0.40, 1.245], [0.48, 1.195], [0.53, 0.90], [0.51, 0.88],
                                         [0.0, 0.885]],
             'depthRange': [0.7, 1.6], 'facingMin': 0.15},
        ],
        'decals': [
            # The nose: four round lamps in a BLACK panel that spans the front between
            # the wings (the 1.3 S photographs), not four chrome rings on the paint. The
            # drawn chrome trapezoid is that panel's chrome surround, so the panel keeps
            # its outline and a `ring` band frames it; the drawn four HF slots are the
            # slat grille between the inner pair.
            {'view': 'front', 'outline': [[0.0, 0.645], [0.58, 0.645], [0.665, 0.625], [0.695, 0.575],
                                          [0.695, 0.505], [0.665, 0.455], [0.58, 0.44], [0.0, 0.44]],
             'material': 'grille', 'height': 0.004, 'depthRange': [-2.1, -1.6], 'facingMin': 0.1},
            {'view': 'front', 'outline': [[0.0, 0.645], [0.58, 0.645], [0.665, 0.625], [0.695, 0.575],
                                          [0.695, 0.505], [0.665, 0.455], [0.58, 0.44], [0.0, 0.44]],
             'material': 'chrome', 'height': 0.006, 'ring': 0.013, 'depthRange': [-2.1, -1.6], 'facingMin': 0.1},
            # The 1.3 S lamps fill the panel: the outer 18 cm, the inner 15 (the
            # photographs), so their outer edges reach the wings at x ~0.69 - the drawn
            # 7.4 cm pair sat small and inboard with a wide body-colour margin round it.
            {'view': 'front', 'circle': [[0.415, 0.540], 0.078], 'material': 'chrome', 'height': 0.008, 'depthRange': [-2.1, -1.6]},
            {'view': 'front', 'circle': [[0.600, 0.538], 0.092], 'material': 'chrome', 'height': 0.008, 'depthRange': [-2.1, -1.6]},
            {'view': 'front', 'node': 'headlights', 'circle': [[0.415, 0.540], 0.070], 'material': 'Headlights', 'height': 0.012,
             'depthRange': [-2.1, -1.6]},
            {'view': 'front', 'node': 'headlights', 'circle': [[0.600, 0.538], 0.084], 'material': 'Headlights', 'height': 0.012,
             'depthRange': [-2.1, -1.6]},
            {'view': 'front', 'outline': [[0.0, 0.67], [0.03, 0.64], [0.03, 0.56], [0.0, 0.53], [-0.03, 0.56], [-0.03, 0.64]],
             'mirror': False, 'material': 'chrome', 'height': 0.010, 'depthRange': [-2.1, -1.6]},
            # The front indicators sit on the front wings' sides beside the lamp panel
            # (the photographs: an amber oval at y -1.50, z 0.55, measured off side.jpg
            # at 1159 px/m), not on the wing's rear and not in the lamp panel.
            {'view': 'side', 'node': 'front_blinker_left', 'outline': [[-1.56, 0.578], [-1.44, 0.578], [-1.43, 0.551],
                                                                        [-1.44, 0.524], [-1.56, 0.524], [-1.57, 0.551]],
             'material': 'IndicatorLights', 'height': 0.006, 'facingMin': 0.3},
            {'view': 'side', 'node': 'front_blinker_right', 'outline': [[-1.56, 0.578], [-1.44, 0.578], [-1.43, 0.551],
                                                                         [-1.44, 0.524], [-1.56, 0.524], [-1.57, 0.551]],
             'material': 'IndicatorLights', 'height': 0.006, 'facingMin': 0.3},
            {'view': 'front', 'rect': [[0.0, 0.33], [0.40, 0.09]], 'radius': 0.005, 'mirror': False, 'material': 'plate',
             'height': 0.004, 'depthRange': [-2.1, -1.6]},
            # The scuttle's air intake: a slotted panel with a chrome frame across the
            # base of the screen (the photographs) - the crisp line the screen's foot
            # stands on. Without it the bonnet simply ran up into the screen in one
            # rounded sweep, which is what read as a pillow.
            {'view': 'top', 'rect': [[-0.662, 0.0], [0.052, 0.60]], 'radius': 0.010, 'mirror': False,
             'material': 'chrome', 'height': 0.004},
            {'view': 'top', 'rect': [[-0.660, 0.0], [0.040, 0.575]], 'radius': 0.008, 'mirror': False,
             'material': 'grille', 'height': 0.006},
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
            # The slat grille between the inner lamps (the drawn HF slots), chrome like
            # the photographs' grille surround; it spans the gap the lamps leave.
            {'view': 'front', 'span': [-0.34, 0.34], 'b': [0.46, 0.62], 'count': 8, 'width': 0.005,
             'material': 'chrome', 'height': 0.008, 'depthRange': [-2.1, -1.6]},
        ],
        'lines': [
            # The door's shut lines (front at the A-pillar's foot, rear at its trailing
            # edge) and the waist moulding. The two chrome outlines the file used to draw
            # around the side panes are gone: every pane's own seal carries the frame now.
            {'view': 'side', 'points': [[-0.50, 0.85], [-0.516, 0.29], [0.62, 0.28], [0.62, 0.83]], 'width': 0.005},
            # The vent window's division: drawn 5 cm behind the pillar at the belt,
            # tapering to the header (the drawn line, -0.13 at 0.87 to -0.09 at 1.21).
            {'view': 'side', 'points': [[-0.132, 1.20], [-0.09, 0.858]], 'width': 0.012, 'material': 'chrome', 'height': 0.003},
            # The flank's feature line (the drawing's own, and the photograph's dark
            # shading line at z 0.692-0.706): drawn thin, 3 mm, not the 4 mm ridge it was.
            {'view': 'side', 'points': [[-1.94, 0.70], [1.95, 0.70]], 'width': 0.003, 'material': 'rubber'},
        ],
        'bumpers': {
            # The side photograph (scaled by its own 2.33 m wheelbase): blades ~10 and
            # ~8 cm tall at z 0.33-0.44 / 0.41-0.49, standing ahead of the sheet metal,
            # whose ends are bodyEnds; the factory 3975 is to the bars' faces.
            'front': {'z': [0.34, 0.44], 'depth': 0.05, 'wrap': 0.30, 'profile': 'round'},
            'rear': {'z': [0.41, 0.49], 'depth': 0.05, 'wrap': 0.30, 'profile': 'round'},
        },
        # On the door's front corner at the belt, as the side photograph shows it: a
        # small oval head (about 7.5 x 9.5 cm, its stem no longer than the head) just
        # over the belt, not a round 8.5 cm dish out at the cowl on a stalk: the file
        # had y -0.52, 20 cm ahead of the side window, so assemble.py stood it on the
        # wing on a pole.
        'mirror': {'y': -0.06, 'z': 0.90, 'reach': 0.750, 'w': 0.075, 'h': 0.095, 'material': 'chrome', 'shape': 'rect'},
        'handles': {'at': [[0.45, 0.76]], 'w': 0.11},
        'wipers': {'arms': [[-0.5, -0.05, -0.70, 0.90], [0.05, 0.5, -0.70, 0.90]]},
        # Plain steel wheels with a small chrome centre cap (the photos of the Rallye
        # 1.3 S: no cast alloy, the hubcap type came with the 1.6 HF's Cromodoras). The
        # rim is 14 in: 0.178 of the 0.297 tyre = 0.60, not the 0.68 the file carried
        # (a rim 2 cm too big made the tyre look thin, so the wheels looked small).
        'wheel': {'style': 'steel', 'windows': 0, 'rimFactor': 0.60, 'cap': True},
    },
}
