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
        # The belt (the window sill and the top of the flank) measured off the side
        # photograph's glass foot: 0.870 over the front door (y -0.55), 0.888 over the
        # rear quarter (+0.85) - a gentle wedge rising to the tail. The file had it
        # falling 0.868 -> 0.82, which tilted the whole glasshouse down at the back and
        # made the boot read long and flat.
        'belt': [[-0.60, 0.868], [-0.45, 0.864], [0.0, 0.872], [0.6, 0.882], [1.03, 0.888]],
        # The glasshouse at the end views' own width (0.649 just over the belt). Ahead of
        # the A-pillar's foot it narrows (0.46 at the cowl): held full width to the
        # cabin's start, its side wall ran on as a painted fin beside the screen down to
        # the cowl, and the screen had no corner to wrap - the screen and the door glass
        # met edge to edge and the pillar vanished (the user's screenshot, 2026-10-05).
        'glassPlan': [[-0.64, 0.46], [-0.56, 0.585], [-0.46, 0.640], [-0.3, 0.649], [0.6, 0.649], [1.03, 0.575]],
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
        # Cleaner pane edges: the windscreen is authored in plan, so its foot lands on
        # the scuttle's curve as the working mesh's triangles cut it, and the drawn
        # edge came out a 2 cm staircase. Two and a half times the default relaxation
        # (the 15 mm travel cap is what limits it, not the count) evens it out.
        'paneEdgeRelax': 10,
        # No separate shelf at the belt: the section itself steps in 11 cm there (the
        # waist moulding), which is the car's own shoulder. `shelf` (3 cm) added its
        # inset on top of that step and flared the glasshouse's foot out to the flank
        # again over `shelfRise`.
        'shelf': False,
        # A 5 cm gaussian on the section rounded the shoulder back into a roll (and its
        # up-facing band spread 3 cm either side of the waist crease, which the side
        # glass's feet then caught); 1.5 cm keeps the crease crisp, still fairing the
        # ends' corners.
        'sectionSmooth': 0.015,
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
            # The screen in plan, kept on the front-facing shell (`facingMin` 0.42; its
            # own faces are 0.72-0.76 up, the glasshouse's side 0.22-0.26): it stops at
            # the corner where the shell turns to the side, and the paint between that
            # corner and the door glass is the A-pillar. At 0.22 with the plan out at
            # 0.615-0.68 it wrapped down the side over the door glass's place and onto
            # the shoulder beside the pillar's foot, so no pillar was left. The plan stays
            # inside the shoulder (0.615; the shoulder starts at 0.635) and rounds into
            # the header, where a square corner tore on the roof's edge.
            {'view': 'top', 'outline': [[-0.66, 0.0], [-0.65, 0.30], [-0.61, 0.50], [-0.56, 0.585], [-0.48, 0.615],
                                        [-0.30, 0.615], [-0.255, 0.595], [-0.232, 0.555], [-0.218, 0.47], [-0.215, 0.0]],
             'depthRange': [0.86, 1.295], 'facingMin': 0.42, 'fit': False},
            # The side glass off the side photograph (288.4 px/m): the door glass and its
            # vent from just behind the pillar to the B-pillar's chrome at +0.58, top at
            # 1.238 (the photograph's frame is 6 cm under the roof), and one foot line
            # for door and quarter light - the photograph's sill chrome is level within
            # 1 cm. The foot sits at 0.945, on the glasshouse just over the shoulder
            # (0.90-0.95): at the old 0.856 the panes lay on the shoulder's ledge, their
            # foot a step below the screen's. `fit` off: fitted, the door glass's foot
            # followed the shoulder down beside the pillar. The front corner is an arc,
            # or the seal's inset knots at its 49 degrees.
            {'view': 'side', 'outline': [[-0.415, 0.945], [-0.432, 0.951], [-0.425, 0.964], [-0.17, 1.235],
                                         [0.580, 1.238], [0.580, 0.945]],
             'facingMin': 0.3, 'fit': False},
            # The quarter light: front edge 2 cm behind the door glass (the B-pillar's
            # chrome), top level with it, the rear edge the photograph's curve down the
            # C-pillar to its foot at +0.99.
            {'view': 'side', 'outline': [[0.600, 1.234], [0.600, 0.945], [0.965, 0.945], [0.985, 0.952],
                                         [0.93, 1.010], [0.85, 1.095], [0.75, 1.185], [0.66, 1.230]], 'facingMin': 0.15,
             'fit': False},
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
            # The door's shut lines (front at the A-pillar's foot, rear at its trailing
            # edge) and the waist moulding. The two chrome outlines the file used to draw
            # around the side panes are gone: every pane's own seal carries the frame now.
            {'view': 'side', 'points': [[-0.50, 0.85], [-0.516, 0.29], [0.62, 0.28], [0.62, 0.83]], 'width': 0.005},
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
        # On the door's front corner at the belt, as the side and 3/4 photographs show
        # it: a small round chrome head (8.5 cm) just over the waist moulding, its sail
        # on the door's own skin and an arm no longer than the head. The file had
        # y -0.06 - the middle of the door, 44 cm behind the corner - so the pair sat
        # mid-car. The door's front edge is the drawn shut line at y -0.50 (the A-pillar
        # foot is the screen's foot at -0.64), well ahead of the side window's first
        # glass at -0.41, so assemble.py keeps it a door mount (`_side_front` - 0.12).
        # z 0.89 is the belt there (0.862) plus the moulding; `reach` 0.745 puts the
        # head's outer edge 7.5 cm off the shoulder (the body is 0.67 there). Round,
        # not the rectangular 7.5 x 9.5 the earlier pass used: the photographs' mirror
        # is the small round chrome disc on a stalk.
        'mirror': {'y': -0.50, 'z': 0.89, 'reach': 0.745, 'w': 0.085, 'h': 0.085, 'material': 'chrome', 'shape': 'round'},
        'handles': {'at': [[0.45, 0.76]], 'w': 0.11},
        'wipers': {'arms': [[-0.5, -0.05, -0.70, 0.90], [0.05, 0.5, -0.70, 0.90]]},
        # Plain steel wheels with a small chrome centre cap (the photos of the Rallye
        # 1.3 S: no cast alloy, the hubcap type came with the 1.6 HF's Cromodoras). The
        # rim is 14 in: 0.178 of the 0.297 tyre = 0.60, not the 0.68 the file carried
        # (a rim 2 cm too big made the tyre look thin, so the wheels looked small).
        'wheel': {'style': 'steel', 'windows': 0, 'rimFactor': 0.60, 'cap': True},
    },
}
