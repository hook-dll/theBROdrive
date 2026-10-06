# ZAZ-968M Zaporozhets (1979-94). Factory: 3765 x 1490 x 1370, wheelbase 2160, overhangs
# 720/890, tracks 1228/1212, 155 R13, clearance 175. The factory drawing reprinted at
# 3dcar.ru/blueprints/zaz/zaz_968m (with its dimension lines).
import os as _os, sys as _sys  # noqa: E402
_sys.path.insert(0, _os.path.dirname(__file__))
from _frame import rounded  # noqa: E402
CAR = {
    'id': 'zaz968',
    'label': 'ZAZ-968M',
    'factory': {'length': 3.765, 'width': 1.49, 'height': 1.37, 'clearance': 0.175, 'wheelbase': 2.16,
                'frontTrack': 1.228, 'rearTrack': 1.212, 'wheelRadius': 0.29, 'tyreWidth': 0.155, 'frontOverhang': 0.72},
    'blueprint': {
        'image': 'zaz968.jpg',
        'side': {'box': [795, 92, 2217, 578], 'nose': 'left',
                 'drop': [[0, 365, 140, 490], [1148, 362, 1340, 490], [1380, 0, 1422, 490], [1150, 0, 1422, 12]]},
        'top': {'box': [812, 809, 2152, 1405], 'nose': 'left', 'fitWidth': True},
        'front': {'box': [51, 94, 641, 574]},
        'rear': {'box': [50, 842, 646, 1332]},
    },
    'hull': {
        'bumpers': {'front': {'z': [0.30, 0.48]}, 'rear': {'z': [0.30, 0.48]}},
        # The 968M's engine bay is a deep slab: the deck runs level to a square tail
        # corner and the body hangs down to the bar's foot (side photo: 0.33-0.80 m
        # behind the rear wheel against the nose's 0.42-0.78). The drawn outline let
        # the deck sag and the lower edge rise to 0.46, so the tail read thinner than
        # the nose.
        # The roof rolls over into the back light in one curve (rear photograph: a thin
        # rounded roof edge over the glass). With the 2 cm blur the old knee at (0.85,
        # 1.33) stood as a ridge across the roof over the back light.
        'topOverride': [[0.72, 1.37], [0.79, 1.362], [0.84, 1.335], [0.88, 1.27], [1.06, 0.90], [1.3, 0.875],
                        [1.6, 0.872], [1.80, 0.868], [1.87, 0.84]],
        'sill': [[-1.9, 0.42], [-1.65, 0.38], [-1.4, 0.30], [0.75, 0.30], [1.0, 0.31], [1.30, 0.34], [1.5, 0.33], [1.9, 0.33]],
        'cabin': [-0.83, 1.06],
        # The belt off the side photograph (265.8 px/m by its wheelbase): the door glass's
        # chrome frame and the quarter light's rubber both start at 0.86; the drawing's
        # 0.89 stood above the glass's own foot.
        'belt': [[-0.83, 0.84], [-0.5, 0.835], [0.85, 0.835], [1.06, 0.84]],
        # Full width to the cabin's start: narrowing from 0.64 to 0.58 ahead of y -0.5
        # twisted the glasshouse's side under the vent window, so the door frame's
        # straight front edge bent into an S in 3/4 views.
        'glassPlan': [[-0.83, 0.64], [0.75, 0.64], [1.06, 0.58]],
        'crown': [[-2.0, 0.015], [2.0, 0.015]],
        'roofCrown': 0.022,
        # Crisp folds (the R4/R5 pattern): the 2.2 cm across / 6 cm along default blur
        # domed the flanks, rolled the shoulder into the glasshouse and rounded the
        # deck-to-tail corner over ~0.3 m; the photos show a tight waist crease, a
        # defined shoulder and a crisp tail corner. 1.1 cm across, 5 cm along keeps
        # them and still leaves the drawn nose/tail their reach.
        'edge': 0.011,
        'edgeMin': 0.013,
        # 2 cm along the car (5 before): the 5 cm blur rolled the glasshouse's rear
        # corners into bulbous C-pillars round a back light that could not reach out to
        # the photograph's width (the user's screenshot, 2026-10-06).
        'edgeY': 0.020,
        'edgeYMin': 0.020,
        'faceSpacing': 0.15, 'cornerDeg': 20,
        # 155 R13 wheels of 0.29 m radius in an arch of the drawing's 0.32 (the photo
        # shows a hand's width of gap round the tyre); centred on the axle, not lifted,
        # or the arch hangs over the tyre.
        'arch': {'radius': 0.32, 'lift': 0.005},
        # Behind its bar the tail panel is the near-vertical face the drawing and the
        # side photo show (the bar band is bridged out, and what was left tucked
        # 13 cm forward: the tail curled under, the bar stood 13.6 cm off it and the
        # exhaust pan hung out behind as a loose black fragment). Given past the drawn
        # face by the blur's own pull-back, so the shell meets the bar at the factory
        # end (stand 0.086 -> ~0.01).
        'face': {'rear': [[0.26, 1.67], [0.34, 1.81], [0.42, 1.88], [0.52, 1.90]]},
        # The cabin's section: the body below the belt as the end views give it, but the
        # glasshouse's side one straight lean from the belt (0.66 at 0.88) to the roof's
        # roll (0.47 at 1.30). The end views' own section bent at 1.0 (45 degrees below,
        # 15 above) right across the side glass, so the door's straight vent divider and
        # frames read as S-curves in 3/4 views (the user's screenshot, 2026-10-06).
        'sectionKeys': [{'y': [-0.83, 1.06], 'blend': 0.12,
                         'half': [[0.30, 0.713], [0.36, 0.734], [0.72, 0.734], [0.78, 0.728], [0.81, 0.712], [0.835, 0.685],
                                  [0.85, 0.662], [1.30, 0.47], [1.33, 0.43], [1.355, 0.30], [1.37, 0.10]]}],
        # The glasshouse's fillet into the body 1.5 cm (3 by default): the glass's foot
        # (0.863) sat on the 3 cm fillet's bend (GLASS-FAIL).
        'glassFillet': 0.015,
    },
    'parts': {
        # The engine sits in its bay, nothing hangs below the tail: with the underbody
        # read as rear-engined its flat pan was placed BEHIND the rear axle, where the
        # tail curls up, and hung out past the bumper as a loose black fragment. Read
        # as a plain (independent-rear) floor the pan tucks under the middle of the
        # floor like every other car's silencer, and the exhaust ends in a tail pipe.
        'underbody': {'engine': 'front', 'independentRear': True},
        'glassOverlay': True,
        'glassFit': False,
        # The side glass off the side photograph, outer edges of the frames: the door's
        # vent (its front edge the A-pillar's slant, -0.631 at 0.94 to -0.412 at 1.227,
        # a small round corner at the foot) and drop glass to 0.14, in a thin chrome
        # frame, the head at 1.237 and the foot 0.863; the fixed quarter light in black
        # rubber from 0.179 to its slanted rear edge (0.915 at 0.92, 0.784 at 1.237),
        # the head at 1.262, round corners. The old outlines stopped 9 cm short of the
        # pillar with the vent's foot chamfered off, and the quarter light 6 cm short
        # at both ends.
        'glass': [
            {'view': 'side', 'outline': rounded([[-0.371, 0.863], [-0.628, 0.863], [-0.631, 0.936], [-0.412, 1.227],
                                                 [-0.371, 1.237]], 0.02, corners=[1, 3]),
             'seal': 0.009, 'sealMaterial': 'chrome'},
            {'view': 'side', 'outline': rounded([[-0.358, 0.863], [0.14, 0.863], [0.14, 1.237], [-0.358, 1.237]], 0.02,
                                                corners=[1, 2]), 'seal': 0.009, 'sealMaterial': 'chrome'},
            # (the rear edge the photograph's slant: 0.915 at 0.92, 0.784 at 1.237;
            # corners of 3.5 cm radius as photographed, not typed-in chamfers)
            {'view': 'side', 'outline': rounded([[0.179, 0.86], [0.93, 0.86], [0.775, 1.262], [0.179, 1.262]], 0.035),
             'seal': 0.010},
            # Screen and back light on their clean faces (front/rear rays on the shell after
            # the 2 cm blur: the back light's face clean out to x 0.52 at 1.0, 0.50 at
            # 1.1-1.2, 0.47 at 1.26; the rear photograph's back light is 1.05 m wide at its
            # foot with 7 cm round corners). The old outlines were typed-in octagons.
            {'view': 'front', 'outline': rounded([[0.0, 1.27], [0.47, 1.27], [0.53, 0.93], [0.0, 0.93]], 0.06,
                                                 corners=[1, 2]), 'depthRange': [-0.9, -0.3]},
            {'view': 'rear', 'outline': rounded([[0.0, 1.285], [0.45, 1.285], [0.52, 0.955], [0.0, 0.955]], 0.07,
                                                corners=[1, 2]), 'depthRange': [0.7, 1.2]},
        ],
        'decals': [
            {'view': 'front', 'node': 'headlights', 'circle': [[0.59, 0.62], 0.09], 'material': 'Headlights',
             'height': 0.012, 'depthRange': [-2.0, -1.5]},
            {'view': 'front', 'circle': [[0.59, 0.62], 0.108], 'ring': 0.018, 'material': 'chrome',
             'height': 0.013, 'depthRange': [-2.0, -1.5]},
            # The chrome moustache between the lamps, with the sidelights at its ends.
            {'view': 'front', 'outline': [[0.0, 0.66], [0.41, 0.66], [0.49, 0.70], [0.50, 0.66], [0.43, 0.575], [0.0, 0.575]],
             'material': 'chrome', 'height': 0.006, 'depthRange': [-2.0, -1.5]},
            {'view': 'front', 'rect': [[0.0, 0.617], [0.62, 0.04]], 'radius': 0.01, 'mirror': False, 'material': 'grille',
             'height': 0.008, 'depthRange': [-2.0, -1.5]},
            {'view': 'front', 'node': 'front_blinker_left', 'rect': [[0.32, 0.617], [0.10, 0.05]], 'radius': 0.006,
             'material': 'IndicatorLights', 'height': 0.010, 'depthRange': [-2.0, -1.5]},
            {'view': 'front', 'node': 'front_blinker_right', 'rect': [[0.32, 0.617], [0.10, 0.05]], 'radius': 0.006,
             'material': 'IndicatorLights', 'height': 0.010, 'depthRange': [-2.0, -1.5]},
            {'view': 'side', 'node': 'front_blinker_left', 'circle': [[-1.523, 0.625], 0.02], 'material': 'IndicatorLights', 'height': 0.006},
            {'view': 'side', 'node': 'front_blinker_right', 'circle': [[-1.523, 0.625], 0.02], 'material': 'IndicatorLights', 'height': 0.006},
            {'view': 'front', 'rect': [[0.0, 0.33], [0.44, 0.10]], 'radius': 0.006, 'mirror': False, 'material': 'plate',
             'height': 0.006, 'depthRange': [-2.0, -1.5]},
            # The side air intakes of the 968M, black with louvres: the drawing's side
            # view puts the recessed panel at z 0.585..0.695, and the side photo just
            # under the belt (0.60..0.76); at 0.55..0.66 the panel's lower slats hung
            # under the arch's lip, so it read as sitting at the wheel's top.
            {'view': 'side', 'rect': [[1.425, 0.640], [0.47, 0.105]], 'radius': 0.02, 'material': 'grille', 'height': 0.004},
            {'view': 'rear', 'rect': [[0.0, 0.587], [0.52, 0.11]], 'radius': 0.006, 'mirror': False, 'material': 'plate',
             'height': 0.005, 'depthRange': [1.6, 2.1]},
            # Rear cluster: four cells in a row - amber (outermost), red, the reversing
            # white, red (innermost), in one housing ~40 cm wide. The former split (red
            # outside with thin amber/white strips inboard, stacked) is not the car's
            # (rear photo and the drawing's rear view).
            {'view': 'rear', 'node': 'taillights', 'rect': [[0.372, 0.585], [0.100, 0.12]], 'radius': 0.010,
             'material': 'TailLights', 'height': 0.008, 'depthRange': [1.6, 2.1]},
            {'view': 'rear', 'node': 'reverse_lights', 'rect': [[0.466, 0.585], [0.078, 0.12]], 'radius': 0.010,
             'material': 'ReverseLights', 'height': 0.008, 'depthRange': [1.6, 2.1]},
            {'view': 'rear', 'node': 'taillights', 'rect': [[0.566, 0.585], [0.110, 0.12]], 'radius': 0.010,
             'material': 'TailLights', 'height': 0.008, 'depthRange': [1.6, 2.1]},
            {'view': 'rear', 'node': 'rear_blinker_left', 'rect': [[0.672, 0.585], [0.090, 0.12]], 'radius': 0.010,
             'material': 'IndicatorLights', 'height': 0.008, 'depthRange': [1.6, 2.1]},
            {'view': 'rear', 'node': 'rear_blinker_right', 'rect': [[0.672, 0.585], [0.090, 0.12]], 'radius': 0.010,
             'material': 'IndicatorLights', 'height': 0.008, 'depthRange': [1.6, 2.1]},
            # The 968M nameplate in the middle of the front panel's dark strip.
            {'view': 'front', 'rect': [[0.0, 0.617], [0.20, 0.032]], 'radius': 0.006, 'mirror': False,
             'material': 'chrome', 'height': 0.009, 'depthRange': [-2.0, -1.5]},
        ] + (
            # Louvres as decals: bars with view 'side' are skipped by assemble.py, so the
            # 14 side-intake slats never appeared; the engine lid's slots are ONE group
            # of seven a side (centred 0.45 m off the centre line, under the back
            # light's foot) as the rear photo shows, where two groups a side read as
            # four separate patches of vents.
            [{'view': 'side', 'rect': [[1.22 + k * 0.0315, 0.640], [0.011, 0.088]], 'radius': 0.004,
              'material': 'paint', 'height': 0.005, 'facingMin': 0.35} for k in range(14)]
            + [{'view': 'top', 'rect': [[1.52, 0.342 + k * 0.036], [0.20, 0.016]], 'radius': 0.007, 'material': 'grille',
                'height': 0.004, 'depthRange': [0.55, 1.05]}
               for k in range(7)]
        ),
        'bars': [],
        'lines': [
            # The 968M is a two-door (factory sheet, the side photo: one handle, one
            # door, a fixed quarter light behind it): the second door's shut line and
            # handle came from the drawing, which is a four-door.
            # One long door from just behind the front arch (side photo: its front edge
            # 0.31 m behind the front axle) to the B-pillar.
            {'view': 'side', 'points': [[-0.84, 0.845], [-0.84, 0.32], [0.18, 0.30], [0.18, 0.845]], 'width': 0.005},
            {'view': 'top', 'points': [[-1.84, 0.56], [-0.88, 0.58]], 'width': 0.005},
            {'view': 'side', 'points': [[-1.83, 0.82], [1.88, 0.80]], 'width': 0.008, 'material': 'chrome', 'height': 0.003},
            # (The chrome strip drawn over the windows and down behind the quarter light,
            # 3.2 cm wide, and the one along the sills are gone: the photographs have a
            # thin chrome frame round the door glass only, now the glass's own seal.)
        ],
        # The 968M's bars are chromium-plated blades (rear and side photos), not black:
        # as flat black slabs they read as a floating bracket under the tail.
        'bumpers': {
            'front': {'z': [0.41, 0.47], 'depth': 0.05, 'wrap': 0.25, 'profile': 'blade', 'material': 'chrome'},
            'rear': {'z': [0.40, 0.46], 'depth': 0.05, 'wrap': 0.25, 'profile': 'blade', 'material': 'chrome'},
        },
        # The windscreen, back light and quarter light sit in black rubber; the door's
        # glass in a thin chrome frame (its panes' `sealMaterial`).
        'glassSeal': {'material': 'rubber', 'width': 0.012},
        # A black mirror on the door below the vent glass's foot (side photograph: its
        # base at y -0.665, z 0.82-0.88), not a bright one.
        'mirror': {'y': -0.665, 'z': 0.92, 'reach': 0.80, 'w': 0.10, 'h': 0.065, 'material': 'trim', 'sides': [1]},
        'handles': {'at': [[0.0, 0.84]], 'w': 0.12},
        'wipers': {'arms': [[-0.5, -0.05, -0.85, 0.89], [0.05, 0.5, -0.85, 0.89]]},
        # Plain painted steel wheels with a small chrome cap (side photo).
        'wheel': {'style': 'steel', 'windows': 0, 'rimFactor': 0.66, 'cap': True},
    },
}
