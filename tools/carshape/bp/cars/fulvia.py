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
        # The end views' outlines given in metres (traced off the drawing, both sides
        # averaged), but taken as the car's CROSS-SECTION, not the ends' own: read raw,
        # the half-width was the wider side's, and the door mirror drawn on one side
        # (front view right, rear view left, z 0.85-0.90) stood the shoulder out to
        # 0.73-0.75 where the body is 0.66.
        #
        # The drawing's own end profiles taper 13 cm a side between z 0.50 (1.555 m over
        # the wings) and z 0.90 (1.30 m at the belt): that is the FRONT END's shape -
        # the wings bulge, the cowl and lid are narrower - and applied along the whole
        # car (one section for all stations) it made the doors barrel-sided, widest at
        # mid-height, with the shoulder rolled away instead of a crease. The section
        # below is the door's own, which is what the top view's plan says (plan is
        # widest at the doors, 0.777, and 0.75 over the wings): the flank runs full
        # width from the sill up past the waist moulding, steps in 11 cm at 0.885-0.915
        # to the glasshouse (the Fulvia's own shoulder - 1.555 over the flanks, about
        # 1.29 at the glass base; the step sits just over the belt, which rises 0.868
        # -> 0.880), tumbles home 8 cm a side over the glasshouse to a flat roof whose
        # crown is the outline's last 3 cm, so `roofEdge` (0.045) only has to fair the
        # drip rail, not invent the roof's width.
        'front': {'box': [98, 44, 580, 570], 'ppm': 282, 'zRef': [[51, 1.3], [405, 0.0]],
                  'outline': [[0.0, 1.30], [0.500, 1.298], [0.560, 1.288], [0.572, 1.265], [0.578, 1.235],
                              [0.585, 1.20], [0.612, 1.12], [0.640, 1.02], [0.660, 0.95], [0.672, 0.915],
                              [0.778, 0.885], [0.778, 0.70], [0.775, 0.58], [0.762, 0.48], [0.740, 0.40],
                              [0.705, 0.33], [0.665, 0.27], [0.620, 0.22], [0.0, 0.20]]},
        'rear': {'box': [100, 670, 569, 1121], 'ppm': 280, 'zRef': [[677, 1.3], [1030, 0.0]],
                 'outline': [[0.0, 1.30], [0.500, 1.298], [0.560, 1.288], [0.572, 1.265], [0.578, 1.235],
                             [0.585, 1.20], [0.612, 1.12], [0.640, 1.02], [0.660, 0.95], [0.672, 0.915],
                             [0.778, 0.885], [0.778, 0.70], [0.775, 0.58], [0.762, 0.48], [0.740, 0.40],
                             [0.705, 0.33], [0.665, 0.27], [0.620, 0.22], [0.0, 0.20]]},
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
        # and -0.29 at 1.15), the header the drawn -0.218, the roof 1.30 flat to the
        # rear edge (the drawing's 1.375-1.40 there is its gutter/rack; the line used to
        # rise 1.290 -> 1.307 along the roof, a 2 cm dish over the cabin).
        'topOverride': [[-1.97, 0.660], [-1.90, 0.680], [-1.82, 0.712], [-1.75, 0.735], [-1.67, 0.755],
                        [-1.59, 0.780], [-1.50, 0.797], [-1.42, 0.811], [-1.33, 0.819], [-1.25, 0.831],
                        [-1.16, 0.842], [-1.07, 0.850], [-0.98, 0.855], [-0.90, 0.861], [-0.82, 0.867],
                        [-0.74, 0.873], [-0.68, 0.880], [-0.66, 0.885], [-0.55, 0.978], [-0.45, 1.065],
                        [-0.35, 1.152], [-0.27, 1.228], [-0.218, 1.293], [-0.10, 1.297], [0.10, 1.299],
                        [0.30, 1.300], [0.56, 1.300],
                        # The rear, from the same photograph's trace: the back light's
                        # rake down to its foot at (+1.17, 0.90), then the deck falling
                        # steadily to a low rounded tail. Re-traced against the photo
                        # (red-mask top line, wheelbase scale, front axle aligned): the
                        # file's rake was curved - shallow at the roof (1.150 at 0.90
                        # where the photo has 1.084, +6.6 cm) and steep at the foot - and
                        # its deck sat 1.7-4.5 cm low all the way to the tail. The photo's
                        # rake is one straight line, 0.84 m of z per m of y, from the
                        # roof's rear edge at +0.70 to the deck's crease at +1.17.
                        [0.70, 1.248], [0.80, 1.166], [0.90, 1.084], [1.00, 1.002],
                        [1.10, 0.920], [1.17, 0.900], [1.30, 0.896], [1.50, 0.882],
                        [1.70, 0.864], [1.85, 0.845], [1.94, 0.818]],
        # The cabin starts at the screen's foot (-0.64), not 18 cm ahead of it: the
        # glasshouse's section was carried forward over the bonnet's rear.
        'cabin': [-0.64, 1.03],
        # The belt (where the body below hands over to the glasshouse) along the foot of
        # the side photograph's belt chrome: 0.870 over the front door (y -0.55), 0.888
        # over the rear quarter (+0.85) - a gentle wedge rising to the tail (the glass
        # itself starts over the chrome, at 0.905-0.91). The file had it falling 0.868 ->
        # 0.82, which tilted the whole glasshouse down at the back and made the boot
        # read long and flat.
        'belt': [[-0.60, 0.868], [-0.45, 0.864], [0.0, 0.872], [0.6, 0.882], [1.03, 0.888]],
        # The glasshouse at the cabin section's own width just over the shoulder (0.662
        # at z 0.925, so the glasshouse and the body below the belt share one shoulder,
        # not two a centimetre apart), full width to the cabin's start: the screen's wrap
        # (below) brings its sides down to the belt at the A-pillar's foot, so no
        # narrowing of the plan is needed there.
        'glassPlan': [[-0.64, 0.662], [0.6, 0.662], [1.03, 0.586]],
        # The cabin's section, from the A-pillar's foot to the back light's: the end
        # views' (smoothed) section, but with the shoulder a crisp ledge. Smoothed, the
        # drawn 11 cm step became a 45-degree bevel from z 0.83 to 0.96, so the side
        # glass stood 5 cm over the crease on a sloping band and its foot followed the
        # bevel's fillet out. The photographs' belt chrome lies at 0.876-0.904 right on
        # the crease and the glass starts at 0.905-0.91: flank to 0.845, the crease rolled
        # over at 0.86, a ledge rising 16 degrees in to the glasshouse's wall at 0.89.
        'sectionKeys': [{'y': [-0.70, 1.10], 'blend': 0.12,
                         'half': [[0.20, 0.6915], [0.31, 0.6915], [0.34, 0.7095], [0.37, 0.7249], [0.40, 0.7381],
                                  [0.43, 0.7484], [0.46, 0.7565], [0.50, 0.7649], [0.54, 0.7712], [0.58, 0.7755],
                                  [0.62, 0.7766], [0.82, 0.7766], [0.845, 0.7760], [0.856, 0.7725], [0.863, 0.7650],
                                  [0.869, 0.7500], [0.876, 0.7250], [0.882, 0.7000], [0.887, 0.6800], [0.893, 0.6700],
                                  [0.905, 0.6640], [0.93, 0.6610], [0.96, 0.6580], [1.00, 0.6454], [1.04, 0.6348],
                                  [1.08, 0.6236], [1.12, 0.6120], [1.16, 0.5988], [1.20, 0.5860], [1.24, 0.5739],
                                  [1.26, 0.5532], [1.28, 0.4699], [1.30, 0.2754], [1.32, 0.0882]]}],
        # The windscreen curves round in plan to its pillars (the top view draws the
        # foot as an arc, the sides 0.285 behind the middle). The shell's turn from the
        # screen's wrap into the side wall is 6-8 cm wide (a 27-degree crease under the
        # field's blur); its middle is put on the side photograph's pillar (red at y
        # -0.405, z 0.905 and -0.168 at 1.238; the screen's middle at -0.636 and
        # -0.262 there), so the pillar stands on the corner, the screen ahead of it and
        # the vent glass behind it on the side. `across` is the drawn arc's shape, an
        # ellipse of 0.70 half-width, as a share of the setback at the pillar (x 0.66).
        'screenWrap': {'across': [[0.0, 0.0], [0.1, 0.0155], [0.2, 0.0625], [0.3, 0.145], [0.4, 0.269],
                                  [0.5, 0.450], [0.55, 0.572], [0.6, 0.727], [0.63, 0.846], [0.66, 1.0]],
                       'foot': [0.905, 0.206], 'head': [1.24, 0.118], 'until': 0.0},
        # The car is a slim coupé: flat sides with a shoulder crease along the belt, a
        # flat bonnet and a flat roof, so no crown along the car and next to none across
        # it (2-3 cm of crown domed the roof and swelled the wings). The photographs'
        # bonnet is a flat panel with its edge crease at the wings, but a panel with
        # none at all reads as a slab under a highlight: 8 mm across keeps the panel
        # flat and still lets the wings' crease fall where the drawn section turns.
        'crown': [[-2.0, 0.008], [2.0, 0.008]],
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
        # The roof edge is the drip rail. The section now carries the roof's width
        # itself (the flat top of the outline, 0.53-0.58 half-width), so the hold only
        # fairs the rail: at 0.012 it held the section 1 cm below the top, where the
        # drawn outline is only the crown left (0.49 half-width, and 0.25 at the very
        # top) - a 0.98 m ridge with a 17 cm roll a side, which read as a soft dome and,
        # under the sun, as a dent down one flank of it. 0.045 (a 2 cm roll) is the
        # photograph's own drip rail; the 0.03 first pass still showed a 3 cm roll.
        'roofEdge': 0.045,
        # No separate shelf at the belt: the cabin's section has the car's own
        # shoulder ledge (`sectionKeys`); `shelf` (3 cm) added its inset on top of it
        # and flared the glasshouse's foot back out to the flank over `shelfRise`.
        'shelf': False,
        # The ends' section (outside the cabin's `sectionKeys`): a 1.5 cm gaussian, not
        # the 5 cm default that rounded the wings' shoulders into a roll.
        'sectionSmooth': 0.015,
        # The sheet metal ends 0.745 m ahead of the front axle and 0.735 m behind the
        # rear one (side photograph, its wheelbase as the scale; body 3.81 m). The
        # factory 3975 is over the bumpers: stretched to it, the body's ends grew 8 cm
        # each, the heavy nose and boxy tail.
        'bodyEnds': {'front': -1.9075, 'rear': 1.9025},
    },
    'parts': {
        # The glass laid over the shell (assemble.py's `glassOverlay`): every pane is its
        # outline exactly, wherever the shell's triangles fall. Cut out of the shell's
        # own faces, as before, the panes' edges came out notched, the quarter light's
        # foot ran out along the shoulder's fillet and the screen wrapped on round its
        # corner into the door glass's place. (This key and `glassSeal` sat beside
        # `parts` until now, where nothing read them: the seals were the default rubber
        # and `pillarReach` 0 never applied, so the door glass was pushed forward.)
        'glassOverlay': True,
        # Panes measured off the photograph and checked by hand: never auto-fitted.
        'glassFit': False,
        # Chrome frames: 1 cm round the screen and the back light (the photographs'
        # bright trim), 1.4 cm round the side glass (each pane's `seal`: the door frame,
        # belt and B-pillar chrome are 1.7-3 cm wide there).
        'glassSeal': {'material': 'chrome', 'width': 0.010},
        'glass': [
            # The screen in plan, generated off the built shell: its foot the line where
            # the screen rises through z 0.90 (just over the scuttle's intake), its header
            # where it reaches 1.262 (3 cm under the roof's front edge: at 1.275 its top
            # corners lay on the roof edge's roll), and its sides 7 mm ahead of the side
            # photograph's pillar line (red at y -0.405, z 0.905; -0.168 at 1.238), found
            # on the skin by side rays. Rounded 6 cm into the header, 2 cm at the foot.
            {'view': 'top', 'outline': [[-0.6332, 0.0], [-0.6325, 0.05], [-0.6314, 0.1], [-0.6276, 0.15], [-0.6216, 0.2],
                                        [-0.614, 0.25], [-0.6041, 0.3], [-0.592, 0.35], [-0.5773, 0.4], [-0.5595, 0.45],
                                        [-0.5385, 0.5], [-0.5123, 0.55], [-0.4792, 0.6], [-0.4295, 0.6501], [-0.4198, 0.6568],
                                        [-0.4094, 0.6581], [-0.3983, 0.6539], [-0.3795, 0.6484], [-0.3631, 0.6427],
                                        [-0.3455, 0.6363], [-0.327, 0.6294], [-0.3099, 0.6213], [-0.2928, 0.6123],
                                        [-0.2742, 0.6033], [-0.2545, 0.5946], [-0.2349, 0.5864], [-0.2152, 0.5775],
                                        [-0.2118, 0.5763], [-0.1977, 0.5693], [-0.187, 0.5611], [-0.1799, 0.5516],
                                        [-0.1762, 0.541], [-0.176, 0.5291], [-0.1793, 0.5161], [-0.1861, 0.5018], [-0.1871, 0.5],
                                        [-0.1997, 0.45], [-0.2102, 0.4], [-0.2183, 0.35], [-0.2254, 0.3], [-0.2312, 0.25],
                                        [-0.2352, 0.2], [-0.238, 0.15], [-0.2398, 0.1], [-0.2407, 0.05], [-0.2411, 0.0]],
             'depthRange': [0.86, 1.30]},
            # The side glass off the side photograph (288.4 px/m), its frames' outer edges:
            # the frame's top at 1.25 (the roof's edge 5 cm over it), the foot at 0.905,
            # where the shoulder ledge has turned up into the glasshouse's wall (the glass
            # inside the 1.4 cm frame starts at 0.919, the photograph's at 0.905-0.91; any
            # lower and it lies on the ledge's fillet). The vent window from the pillar
            # (7 mm behind its red) to the drawing's vertical divider at y -0.087; the
            # divider and the B-pillar are the two panes' frames side by side, 2.6 and 2.4
            # cm of chrome (the photograph's -0.108..-0.066 and 0.566..0.594).
            {'view': 'side', 'outline': [[-0.1, 0.905], [-0.398, 0.905], [-0.3807, 0.9296], [-0.3639, 0.9543],
                                         [-0.3483, 0.9789], [-0.3314, 1.0036], [-0.3138, 1.0282], [-0.2974, 1.0529],
                                         [-0.2812, 1.0775], [-0.2638, 1.1021], [-0.2451, 1.1268], [-0.2263, 1.1514],
                                         [-0.2076, 1.1761], [-0.1888, 1.2007], [-0.1701, 1.2254], [-0.1665, 1.2301],
                                         [-0.1583, 1.2388], [-0.1489, 1.245], [-0.1383, 1.2488], [-0.1264, 1.25], [-0.1, 1.25]],
             'seal': 0.014},
            {'view': 'side', 'outline': [[-0.074, 0.905], [0.566, 0.905], [0.566, 1.25], [-0.074, 1.25]], 'seal': 0.014},
            # The quarter light: the photograph's glass edge down the C-pillar moved out
            # by its frame and 1.5 cm forward (the shell's rake runs 2-3 cm short of the
            # photograph's near the roof, so its C-pillar is that much narrower; and the
            # pane's rear tip at the belt lay on the turn into the C-pillar's corner), its
            # last straight run carried down to the belt at 1.0075 (the photograph's edge
            # flattens into the belt there; drawn out to it, the pane's corner ran on
            # along the belt as a 7 cm sliver).
            {'view': 'side', 'outline': [[0.59, 0.905], [0.59, 1.238], [0.593, 1.2469], [0.602, 1.2495], [0.615, 1.2475],
                                         [0.6276, 1.2398], [0.6987, 1.192], [0.7686, 1.1282], [0.8386, 1.0592],
                                         [0.9074, 0.9964], [1.0075, 0.905]], 'seal': 0.014},
            # The back light in the rear view: 6 cm of C-pillar either side of it (the
            # glasshouse's rear corner is at x 0.575-0.58), its header 2 cm under the
            # roof's rear edge, its foot 2.5 cm over the deck's crease; round corners.
            {'view': 'rear', 'outline': [[0.0, 1.228], [0.425, 1.228], [0.4489, 1.2262], [0.4691, 1.2207], [0.4856, 1.2115],
                                         [0.4985, 1.1986], [0.5077, 1.1821], [0.5132, 1.1619], [0.515, 1.138], [0.515, 0.97],
                                         [0.5122, 0.9503], [0.5038, 0.9363], [0.4897, 0.9278], [0.47, 0.925], [0.0, 0.925]],
             'depthRange': [0.65, 1.2]},
        ],
        'decals': [
            # The nose: four round lamps in a BLACK panel that spans the front between
            # the wings (the 1.3 S photographs), not four chrome rings on the paint. The
            # drawn chrome trapezoid is that panel's chrome surround, so the panel keeps
            # its outline and a `ring` band frames it; the drawn four HF slots are the
            # slat grille between the inner pair.
            {'view': 'front', 'outline': [[0.0, 0.655], [0.60, 0.655], [0.675, 0.635], [0.705, 0.585],
                                          [0.705, 0.500], [0.675, 0.448], [0.60, 0.425], [0.0, 0.425]],
             'material': 'grille', 'height': 0.004, 'depthRange': [-2.1, -1.6], 'facingMin': 0.1},
            {'view': 'front', 'outline': [[0.0, 0.655], [0.60, 0.655], [0.675, 0.635], [0.705, 0.585],
                                          [0.705, 0.500], [0.675, 0.448], [0.60, 0.425], [0.0, 0.425]],
             'material': 'chrome', 'height': 0.006, 'ring': 0.013, 'depthRange': [-2.1, -1.6], 'facingMin': 0.1},
            # Lamp sizes and places off the drawing's front view at its own scale (282
            # px/m): outer pair centred 0.585 with its rim at 0.683, inner 0.395 reaching
            # in to the grille's chrome edge at 0.30, all at z 0.546. 48 segments: at the
            # default 28 the chrome rims of the 20 cm lamps showed as polygons in the
            # close front view.
            {'view': 'front', 'circle': [[0.395, 0.546], 0.088], 'segments': 48, 'material': 'chrome', 'height': 0.008, 'depthRange': [-2.1, -1.6]},
            {'view': 'front', 'circle': [[0.585, 0.546], 0.098], 'segments': 48, 'material': 'chrome', 'height': 0.008, 'depthRange': [-2.1, -1.6]},
            {'view': 'front', 'node': 'headlights', 'circle': [[0.395, 0.546], 0.078], 'segments': 48, 'material': 'Headlights', 'height': 0.012,
             'depthRange': [-2.1, -1.6]},
            {'view': 'front', 'node': 'headlights', 'circle': [[0.585, 0.546], 0.088], 'segments': 48, 'material': 'Headlights', 'height': 0.012,
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
            # The tail, measured off a straight rear photograph (Commons "Lancia Fulvia -
            # rear", Rome; 1063 px/m from the body's width at the lamps, the bar's top at
            # 0.49): one chrome-rimmed unit a side right in the corner, x 0.45-0.74, z
            # 0.59-0.685 - the round red stop/tail lens inboard (r 0.053 at x 0.50) and
            # the oblong lens outboard, amber over clear; a small red reflector under
            # the unit's middle; the plate between them at 0.52-0.70 with the LANCIA and
            # FULVIA scripts either side. The model had the unit 4 cm low and half size.
            {'view': 'rear', 'outline': [[0.455, 0.685], [0.70, 0.685], [0.74, 0.665], [0.745, 0.61], [0.725, 0.59],
                                         [0.455, 0.59], [0.445, 0.637]],
             'material': 'chrome', 'height': 0.004, 'depthRange': [1.6, 2.1], 'facingMin': 0.05},
            {'view': 'rear', 'node': 'taillights', 'circle': [[0.505, 0.637], 0.050], 'material': 'TailLights',
             'height': 0.010, 'depthRange': [1.6, 2.1], 'facingMin': 0.05},
            {'view': 'rear', 'node': 'rear_blinker_left', 'outline': [[0.56, 0.677], [0.70, 0.677], [0.733, 0.66], [0.738, 0.638],
                                                                      [0.56, 0.638]],
             'material': 'IndicatorLights', 'height': 0.008, 'depthRange': [1.6, 2.1], 'facingMin': 0.05},
            {'view': 'rear', 'node': 'rear_blinker_right', 'outline': [[0.56, 0.677], [0.70, 0.677], [0.733, 0.66], [0.738, 0.638],
                                                                       [0.56, 0.638]],
             'material': 'IndicatorLights', 'height': 0.008, 'depthRange': [1.6, 2.1], 'facingMin': 0.05},
            {'view': 'rear', 'node': 'reverse_lights', 'outline': [[0.56, 0.633], [0.738, 0.633], [0.735, 0.612], [0.72, 0.598],
                                                                   [0.56, 0.598]],
             'material': 'ReverseLights', 'height': 0.008, 'depthRange': [1.6, 2.1], 'facingMin': 0.05},
            {'view': 'rear', 'rect': [[0.58, 0.535], [0.075, 0.045]], 'radius': 0.006, 'material': 'chrome',
             'height': 0.004, 'depthRange': [1.6, 2.1], 'facingMin': 0.05},
            {'view': 'rear', 'node': 'taillights', 'rect': [[0.58, 0.535], [0.062, 0.033]], 'radius': 0.004,
             'material': 'TailLights', 'height': 0.008, 'depthRange': [1.6, 2.1], 'facingMin': 0.05},
            {'view': 'rear', 'rect': [[0.0, 0.60], [0.30, 0.15]], 'radius': 0.006, 'mirror': False, 'material': 'plate',
             'height': 0.008, 'depthRange': [1.6, 2.1], 'facingMin': 0.1},
            {'view': 'rear', 'rect': [[0.28, 0.668], [0.14, 0.012]], 'radius': 0.004, 'material': 'chrome',
             'height': 0.004, 'depthRange': [1.6, 2.1], 'facingMin': 0.1},
        ],
        'bars': [
            # The slat grille between the inner lamps (the drawn HF slots), chrome like
            # the photographs' grille surround; it spans the gap the lamps leave.
            {'view': 'front', 'span': [-0.29, 0.29], 'b': [0.46, 0.63], 'count': 9, 'width': 0.005,
             'material': 'chrome', 'height': 0.008, 'depthRange': [-2.1, -1.6]},
        ],
        'lines': [
            # The door's shut line traced off the side photograph (288.4 px/m): the front
            # edge leaves the A-pillar's foot at -0.403 and curves forward to -0.475 by
            # z 0.70, straight down to the bottom edge at 0.325; the rear edge leaves the
            # B-pillar's foot at 0.606, bows back to 0.646 at 0.74 and sweeps forward
            # into the bottom. The old box (front at -0.50, rear at 0.62, bottom 0.28)
            # started 10 cm ahead of the pillar and 3 cm behind the B-pillar. Topped at
            # the shoulder's crease (0.862), not run up onto the ledge.
            {'view': 'side', 'points': [[-0.412, 0.862], [-0.424, 0.845], [-0.438, 0.82], [-0.452, 0.79], [-0.463, 0.76],
                                        [-0.470, 0.73], [-0.474, 0.70], [-0.476, 0.66], [-0.476, 0.36], [-0.472, 0.337],
                                        [-0.458, 0.326], [0.43, 0.326], [0.47, 0.34], [0.515, 0.375], [0.554, 0.418],
                                        [0.58, 0.46], [0.600, 0.511], [0.618, 0.57], [0.635, 0.638], [0.643, 0.69],
                                        [0.646, 0.742], [0.643, 0.79], [0.634, 0.83], [0.622, 0.862]], 'width': 0.005,
             # traced curves: assemble.py's straightening of hand-read runs (turns under
             # 25 degrees dropped) laid the rear edge's sweep as one diagonal
             'keep': True},
            # The flank's feature line (the drawing's own, and the photograph's dark
            # shading line at z 0.692-0.706): drawn thin, 3 mm, not the 4 mm ridge it was.
            {'view': 'side', 'points': [[-1.94, 0.70], [1.95, 0.70]], 'width': 0.003, 'material': 'rubber'},
        ],
        'bumpers': {
            # The side photograph (scaled by its own 2.33 m wheelbase): blades ~10 and
            # ~8 cm tall at z 0.33-0.44 / 0.41-0.49, standing ahead of the sheet metal,
            # whose ends are bodyEnds; the factory 3975 is to the bars' faces.
            # Slim pressed blades (photos), not round tubes: a tube's 5 cm half-round
            # read as a fat chrome sausage over the corners. Depth 3 cm and wrap 0.26:
            # at 4/0.30 the bar stood 4 cm off the nose's face and its wrapped end cut
            # as a flat step (the user's front screenshot).
            'front': {'z': [0.35, 0.44], 'depth': 0.03, 'wrap': 0.26, 'profile': 'blade'},
            'rear': {'z': [0.41, 0.49], 'depth': 0.03, 'wrap': 0.26, 'profile': 'blade'},
        },
        # On the door at the vent window's divider, as the side and 3/4 photographs show
        # it: a small round chrome head (8.5 cm) centred at y -0.11, z 0.935 (the side
        # photograph: head 0.884-0.982), its sail on the door's top under the belt chrome
        # (`sailZ` 0.875: the glasshouse here is as wide as assemble.py's door test, so
        # it would have stood the sail on the glass). The last pass had it at y -0.50,
        # the A-pillar's foot: with the screen wrapped round to its pillars that is the
        # wing's top ahead of the door. Round, not the rectangular 7.5 x 9.5 an earlier
        # pass used.
        'mirror': {'y': -0.10, 'z': 0.935, 'sailZ': 0.875, 'reach': 0.75, 'w': 0.085, 'h': 0.085, 'mount': 'door',
                   'material': 'chrome', 'shape': 'round'},
        'handles': {'at': [[0.45, 0.76]], 'w': 0.11},
        'wipers': {'arms': [[-0.5, -0.05, -0.70, 0.90], [0.05, 0.5, -0.70, 0.90]]},
        # Plain steel wheels with a small chrome centre cap (the photos of the Rallye
        # 1.3 S: no cast alloy, the hubcap type came with the 1.6 HF's Cromodoras). The
        # rim is 14 in: 0.178 of the 0.297 tyre = 0.60, not the 0.68 the file carried
        # (a rim 2 cm too big made the tyre look thin, so the wheels looked small).
        'wheel': {'style': 'steel', 'windows': 0, 'rimFactor': 0.60, 'cap': True},
    },
}
