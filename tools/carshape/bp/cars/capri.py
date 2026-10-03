# Ford Capri 2.0 S (Mk III, 1978-86). Factory: 4439 x 1698 x 1320, wheelbase 2563,
# tracks 1353/1384, 185/70 R13. The drawing reprinted at 3dcar.ru/blueprints/ford/capri.
CAR = {
    'id': 'capri',
    'label': 'Ford Capri',
    'factory': {'length': 4.439, 'width': 1.698, 'height': 1.32, 'clearance': 0.12, 'wheelbase': 2.563,
                'frontTrack': 1.353, 'rearTrack': 1.384, 'wheelRadius': 0.295, 'tyreWidth': 0.185, 'frontOverhang': 0.86},
    'blueprint': {
        'image': 'capri.jpg',
        'side': {'box': [464, 45, 1253, 290], 'nose': 'left'},
        # The drawn centreline (the outline's own middle sits 2 px, 11 mm, off the box's).
        'top': {'box': [462, 304, 1257, 656], 'nose': 'left', 'centre': 479},
        'front': {'box': [52, 47, 404, 289]},
        'rear': {'box': [51, 355, 404, 595]},
    },
    'hull': {
        'bumpers': {'front': {'z': [0.41, 0.52]}, 'rear': {'z': [0.45, 0.56]}},
        # The body's lower edge. At the nose it stood at 0.40 - the bar's underside, so
        # the car had no valance under the bumper at all and the photos' deep black chin
        # (the bar's bottom to ~0.26) could not be painted: the decal had 2 cm of body to
        # land on. Down to 0.26-0.28 over the front's last 30 cm, which is what the
        # photos show under the bar.
        'sill': [[-2.2, 0.28], [-2.05, 0.26], [-1.9, 0.25], [-1.7, 0.24], [-1.3, 0.22], [1.0, 0.22], [1.5, 0.27], [1.8, 0.31], [2.1, 0.43]],
        'cabin': [-0.70, 1.95],
        'belt': [[-0.70, 0.94], [-0.4, 0.91], [0.85, 0.91], [1.40, 0.93], [1.95, 0.90]],
        'glassPlan': [[-0.70, 0.70], [-0.4, 0.73], [0.6, 0.73], [1.40, 0.68], [1.95, 0.64]],
        # The bonnet's own bulge: the front view draws two creases from the screen's foot
        # to the nose with the panel raised between them, and the photos' car has the
        # crowned bonnet falling to the low nose. Flat at 0.02 (the whole car's crown),
        # the bonnet came out a plane with no bulge at all.
        'crown': [[-2.3, 0.012], [-2.05, 0.016], [-1.6, 0.030], [-1.15, 0.034], [-0.75, 0.026], [2.3, 0.02]],
        'roofCrown': 0.03,
        'edge': 0.012,
        # The plan as the car's: the drawn widths (the arches' 862, the doors' 829)
        # tapering straight into the ends' corners. Taken raw, the top view's arch
        # steps (16 mm over 4 cm) twisted the front wings and rippled the quarters,
        # and `planOpen`'s 0.30 m opening cut both flares away, leaving the nose and
        # the tail 60 mm narrow per side: the ends came out domed and the lamps of
        # both the grille panel and the tail sat on the dome, standing off the body.
        'planOverride': [[-2.17, 0.30], [-2.15, 0.62], [-2.13, 0.72], [-2.10, 0.788], [-2.00, 0.800], [-1.90, 0.812],
                         [-1.80, 0.822], [-1.70, 0.830], [-1.60, 0.845], [-1.50, 0.858], [-1.40, 0.862], [-1.28, 0.862],
                         [-1.20, 0.858], [-1.10, 0.850], [-1.00, 0.838], [-0.90, 0.831], [-0.65, 0.829], [0.90, 0.829],
                         [1.00, 0.856], [1.10, 0.862], [1.30, 0.862], [1.38, 0.855], [1.46, 0.838], [1.55, 0.815],
                         [1.75, 0.812], [1.90, 0.801], [2.00, 0.784], [2.06, 0.762], [2.09, 0.72], [2.11, 0.60],
                         [2.12, 0.30]],
        # No drip rails or cab-to-bed: the top line is one curve. The drawing's pixel
        # steps (5-7 mm plateaus along the bonnet, the lid and the scuttle) rung along
        # the whole car once the blur had softened them.
        'topSpacing': 0.15,
        'cornerDeg': 20,
        # The drawing's own car is 4.308 m over the bumpers, the roster's figure 4.439 (Ford
        # with them), so the drawn tail panel stops 13 cm short of +L/2 where the bar's face
        # goes: it stood 6 cm behind the bar (BUMPER rear stand 0.06). The face given at the
        # bar's inner face over the tail panel's band stretches the drawn shape (hull.py's
        # ENDS, pivoted on the arch) out to it: stand 0.06 -> 0.00, and the arches, the
        # wheelbase and the front (already at the bar, stand 0.001) are untouched.
        'face': {'rear': [[0.45, 2.1395], [0.88, 2.1395]]},
        # The drawing's tail carries a little boot lip: its top line rises 0.88 -> 0.90
        # over +1.85..+2.05 and only then drops, which read as a long flat deck behind the
        # back light (the Mk III is a fastback: the photo's glass runs on down to the tail).
        # The line continued to the tail's top edge instead.
        'topOverride': [[1.70, 0.950], [1.85, 0.910], [2.00, 0.880], [2.14, 0.850]],
        'arch': {'radius': 0.34, 'lift': 0.04},
    },
    'parts': {
        'glass': [
            {'view': 'side', 'outline': [[-0.34, 0.985], [-0.335, 0.924], [-0.224, 0.907], [0.461, 0.907], [0.499, 1.155], [0.499, 1.199],
                                         [0.074, 1.21], [-0.086, 1.205], [-0.153, 1.166]], 'facingMin': 0.3},
            {'view': 'side', 'outline': [[0.527, 0.907], [0.853, 0.913], [1.041, 0.929], [1.173, 0.963], [1.212, 1.012], [1.195, 1.04],
                                         [1.151, 1.073], [1.018, 1.127], [0.82, 1.171], [0.626, 1.194], [0.56, 1.194]], 'facingMin': 0.3},
            {'view': 'front', 'outline': [[0.0, 1.27], [0.46, 1.265], [0.50, 1.24], [0.58, 0.96], [0.56, 0.94], [0.0, 0.94]],
             'depthRange': [-1.0, -0.2], 'facingMin': 0.25},
            # The back light runs on down the hatch to within 15 cm of the tail lamps, as
            # the photo of the white 2.0 has it: its lower edge is the hatch's lip, on the
            # tail panel's top edge. Stopped at 0.91 (0.29 above the lamps) the glass
            # left a 25 cm painted deck sloping to the tail - the notchback the drawing's
            # lipped boot suggested, where the car is a fastback.
            {'view': 'rear', 'outline': [[0.0, 1.23], [0.48, 1.22], [0.52, 1.19], [0.60, 1.02], [0.62, 0.93], [0.60, 0.86], [0.0, 0.85]],
             'depthRange': [0.5, 2.16], 'facingMin': 0.15},
        ],
        'decals': [
            {'view': 'front', 'rect': [[0.0, 0.615], [1.43, 0.155]], 'radius': 0.01, 'mirror': False,
             'material': 'grille', 'height': 0.004, 'depthRange': [-2.4, -1.9]},
            # The valance under the bar is black on the car (both photos): the deep chin
            # below the bumper, from the bar's underside down to the body's lower edge.
            {'view': 'front', 'rect': [[0.0, 0.335], [1.42, 0.185]], 'radius': 0.012, 'mirror': False,
             'material': 'trim', 'height': 0.005, 'depthRange': [-2.4, -1.9]},
            {'view': 'front', 'node': 'headlights', 'circle': [[0.627, 0.626], 0.067], 'material': 'Headlights',
             'height': 0.010, 'depthRange': [-2.4, -1.9]},
            {'view': 'front', 'node': 'headlights', 'circle': [[0.458, 0.626], 0.067], 'material': 'Headlights',
             'height': 0.010, 'depthRange': [-2.4, -1.9]},
            {'view': 'front', 'circle': [[0.627, 0.626], 0.075], 'ring': 0.008, 'material': 'chrome', 'height': 0.011, 'depthRange': [-2.4, -1.9]},
            {'view': 'front', 'circle': [[0.458, 0.626], 0.075], 'ring': 0.008, 'material': 'chrome', 'height': 0.011, 'depthRange': [-2.4, -1.9]},
            {'view': 'front', 'outline': [[0.0, 0.645], [0.03, 0.643], [0.045, 0.63], [0.03, 0.617], [0.0, 0.615]],
             'material': 'chrome', 'height': 0.008, 'depthRange': [-2.4, -1.9]},
            {'view': 'front', 'node': 'front_blinker_left', 'rect': [[0.40, 0.44], [0.065, 0.085]], 'radius': 0.005,
             'material': 'IndicatorLights', 'height': 0.012, 'depthRange': [-2.4, -1.9]},
            {'view': 'front', 'node': 'front_blinker_right', 'rect': [[0.40, 0.44], [0.065, 0.085]], 'radius': 0.005,
             'material': 'IndicatorLights', 'height': 0.012, 'depthRange': [-2.4, -1.9]},
            {'view': 'side', 'node': 'front_blinker_left', 'rect': [[-1.98, 0.62], [0.06, 0.03]], 'radius': 0.005, 'material': 'IndicatorLights', 'height': 0.005},
            {'view': 'side', 'node': 'front_blinker_right', 'rect': [[-1.98, 0.62], [0.06, 0.03]], 'radius': 0.005, 'material': 'IndicatorLights', 'height': 0.005},
            # The chin wraps the nose's corners (the green photo, from the front's left):
            # the black band carries on down the flanks under the bar's end.
            {'view': 'side', 'outline': [[-2.20, 0.24], [-1.98, 0.24], [-1.94, 0.30], [-1.94, 0.43], [-2.20, 0.43]],
             'radius': 0.008, 'material': 'trim', 'height': 0.004},
            # The plate is drawn on the bumper's face, where a decal on the body cannot
            # reach (the bar covers it): given below the bar, on the valance, like the
            # rest of the cars.
            {'view': 'front', 'rect': [[0.0, 0.365], [0.46, 0.10]], 'radius': 0.006, 'mirror': False, 'material': 'plate',
             'height': 0.012, 'depthRange': [-2.4, -1.9]},
            # The lamp units (the drawing's ribbed band either side of the plate; the
            # bars below rib the lenses). Sections as the 2.0 photo has them: amber
            # inboard beside the plate, red either side of it, the clear reversing lamp
            # outboard.
            {'view': 'rear', 'rect': [[0.50, 0.625], [0.40, 0.15]], 'radius': 0.006, 'material': 'trim',
             'height': 0.003, 'depthRange': [1.8, 2.3]},
            {'view': 'rear', 'node': 'taillights', 'rect': [[0.325, 0.625], [0.075, 0.14]], 'radius': 0.004,
             'material': 'TailLights', 'height': 0.007, 'depthRange': [1.8, 2.3]},
            {'view': 'rear', 'node': 'rear_blinker_left', 'rect': [[0.415, 0.625], [0.085, 0.14]], 'radius': 0.004,
             'material': 'IndicatorLights', 'height': 0.007, 'depthRange': [1.8, 2.3]},
            {'view': 'rear', 'node': 'rear_blinker_right', 'rect': [[0.415, 0.625], [0.085, 0.14]], 'radius': 0.004,
             'material': 'IndicatorLights', 'height': 0.007, 'depthRange': [1.8, 2.3]},
            {'view': 'rear', 'node': 'taillights', 'rect': [[0.525, 0.625], [0.09, 0.14]], 'radius': 0.004,
             'material': 'TailLights', 'height': 0.007, 'depthRange': [1.8, 2.3]},
            {'view': 'rear', 'node': 'reverse_lights', 'rect': [[0.635, 0.625], [0.08, 0.14]], 'radius': 0.004,
             'material': 'ReverseLights', 'height': 0.007, 'depthRange': [1.8, 2.3]},
            {'view': 'rear', 'rect': [[0.0, 0.632], [0.46, 0.095]], 'radius': 0.006, 'mirror': False, 'material': 'plate',
             'height': 0.006, 'depthRange': [1.8, 2.3]},
            {'view': 'side', 'node': 'taillights', 'rect': [[2.05, 0.625], [0.06, 0.12]], 'material': 'TailLights', 'height': 0.004},
        ],
        'bars': [
            {'view': 'front', 'span': [-0.35, 0.35], 'b': [0.56, 0.68], 'count': 5, 'width': 0.008,
             'material': 'trim', 'height': 0.007, 'depthRange': [-2.4, -1.9]},
            {'view': 'rear', 'span': [0.29, 0.69], 'b': [0.56, 0.69], 'count': 6, 'dir': 'v', 'width': 0.006, 'mirror': True,
             'material': 'trim', 'height': 0.009, 'depthRange': [1.8, 2.3]},
        ],
        'lines': [
            {'view': 'side', 'points': [[-0.66, 0.97], [-0.67, 0.27], [0.53, 0.27], [0.53, 0.91]], 'width': 0.005},
            {'view': 'top', 'points': [[-2.1, 0.68], [-0.75, 0.70]], 'width': 0.005},
            # The waist line: the drawing's thin line at 0.67-0.70 over the wings and the
            # quarter, the 2.0 photo's chrome/red pinstripe with the model script on it.
            {'view': 'side', 'points': [[-2.05, 0.685], [-0.50, 0.688], [1.20, 0.700], [1.95, 0.706]], 'width': 0.008,
             'material': 'chrome', 'height': 0.003},
            # The side moulding: the drawing's two lines at 0.41 and 0.455 along the
            # doors and wings, rising to 0.49-0.555 over the rear quarter (the photo's
            # black strip at the same heights). It sat at 0.30, at the sill, where the
            # drawing has only the door's own bottom edge (0.27).
            {'view': 'side', 'points': [[-1.29, 0.432], [1.30, 0.432], [1.55, 0.50], [2.05, 0.525]], 'width': 0.045,
             'material': 'rubber', 'height': 0.004},
            {'view': 'rear', 'points': [[0.0, 0.70], [0.66, 0.70], [0.68, 0.72], [0.64, 0.92]], 'width': 0.005, 'depthRange': [1.6, 2.3]},
            {'view': 'side', 'points': [[-0.345, 0.99], [-0.15, 1.18], [0.07, 1.225], [0.50, 1.215], [0.82, 1.185], [1.03, 1.14],
                                        [1.20, 1.06], [1.23, 1.0], [1.18, 0.95], [1.0, 0.92], [-0.34, 0.905]], 'width': 0.012,
             'material': 'trim', 'height': 0.003},
        ],
        'bumpers': {
            'front': {'z': [0.42, 0.50], 'depth': 0.08, 'wrap': 0.45, 'profile': 'blade', 'material': 'trim'},
            'rear': {'z': [0.46, 0.54], 'depth': 0.08, 'wrap': 0.50, 'profile': 'blade', 'material': 'trim'},
        },
        'mirror': {'y': -0.30, 'z': 0.98, 'reach': 0.93, 'w': 0.15, 'h': 0.08},
        'handles': {'at': [[0.35, 0.86]], 'w': 0.12, 'material': 'trim'},
        'wipers': {'arms': [[-0.55, -0.05, -0.68, 0.94], [0.05, 0.5, -0.68, 0.94]]},
        # (The chin was tried as a box hanging under the bar: its square corners stood
        # out of the nose's curve and it read as a plank. The valance itself is the car's
        # chin - the decal above paints it black - so no box.)
        'wheel': {'style': 'steel', 'windows': 9, 'rimFactor': 0.70, 'cap': True},
    },
}
