# Moskvich-412 (1967-76). Factory: 4250 x 1550 x 1480, wheelbase 2400, front overhang 675
# (the drawing's own dimension line), tracks 1270/1237, 6.45-13, clearance 175.
# The drawing reprinted at 3dcar.ru/blueprints/moskvitch/moskvitch_412_rally (on squared
# paper; the rally car's extra lamps and mud flaps are left out).
CAR = {
    'id': 'moskvich412',
    'label': 'Moskvich-412',
    'factory': {'length': 4.25, 'width': 1.55, 'height': 1.48, 'clearance': 0.175, 'wheelbase': 2.4,
                'frontTrack': 1.27, 'rearTrack': 1.27, 'wheelRadius': 0.315, 'tyreWidth': 0.165, 'frontOverhang': 0.675},
    'blueprint': {
        'image': 'moskvich412.jpg',
        'degrid': 'thin',
        'side': {'box': [276, 16, 767, 190], 'nose': 'left', 'ground': 191, 'ppmz': 108.9,
                 # the axles placed for the outline (in metres) to sit inside the box: without
                 # them the wheel finder picked a pair off the grid and clipped the nose
                 'wheels': [[370, 156.7], [631.4, 156.7]],
                 'outline': [[-2.09, 0.30], [-2.10, 0.70], [-2.08, 0.90], [-2.0, 0.925], [-1.5, 0.966], [-1.0, 0.99],
                             [-0.69, 1.424], [-0.615, 1.47], [0.84, 1.47], [0.908, 1.424], [1.164, 0.986],
                             # The boot lid and tail panel: the drawing's own tail panel stands at
                             # y 2.095-2.105 (its rear bumper's face 2.13, the factory's 2.125), not at
                             # 1.95 as the old hand-traced outline had it: the body was 15 cm short and
                             # the rear bar, whose face the generator sets at +L/2, hung 11 cm clear of it.
                             [1.55, 0.975], [1.90, 0.950], [2.03, 0.938], [2.085, 0.925], [2.10, 0.83],
                             [2.105, 0.60], [2.09, 0.38], [2.03, 0.0], [-2.05, 0.0]]},
        'top': {'box': [272, 239, 789, 477], 'nose': 'left',
                'outline': [[-2.10, 0.0], [-2.10, 0.70], [-2.05, 0.76], [-1.9, 0.775], [1.85, 0.775], [1.95, 0.768],
                            [2.05, 0.752], [2.105, 0.72], [2.105, 0.0]]},
        'front': {'box': [9, 15, 246, 190], 'centre': 141.5, 'zRef': [[24.1, 1.47], [138.1, 0.448]],
                  'outline': [[0.0, 1.478], [0.30, 1.47], [0.48, 1.445], [0.537, 1.414], [0.57, 1.30], [0.618, 1.012],
                              [0.66, 0.99], [0.73, 0.93], [0.77, 0.80], [0.775, 0.70], [0.771, 0.505], [0.75, 0.40],
                              [0.714, 0.31], [0.70, 0.0], [0.0, 0.0]]},
        'rear': {'box': [36, 244, 244, 425], 'centre': 139.5, 'zRef': [[250.4, 1.47], [368.0, 0.442]],
                 'outline': [[0.0, 1.465], [0.35, 1.45], [0.52, 1.42], [0.577, 1.39], [0.60, 1.25], [0.647, 0.96],
                             [0.703, 0.916], [0.767, 0.734], [0.774, 0.538], [0.76, 0.37], [0.70, 0.30], [0.69, 0.0],
                             [0.0, 0.0]]},
    },
    'hull': {
        'sill': [[-2.1, 0.42], [-1.95, 0.32], [-1.75, 0.27], [-1.5, 0.24], [1.25, 0.24], [1.55, 0.30],
                 [1.8, 0.335], [1.96, 0.36]],
        'cabin': [-1.0, 1.165],
        'belt': [[-1.0, 0.985], [-0.7, 0.99], [0.85, 0.99], [1.165, 0.975]],
        'glassPlan': [[-1.0, 0.62], [-0.6, 0.67], [0.8, 0.67], [1.165, 0.61]],
        'sectionBridge': {'front': [[0.95, 1.15]], 'rear': [[0.95, 1.15]]},
        # The 412's boot lid is a flat panel with crisp edges and its tail panel is
        # vertical: a 2 cm across-crown over the boot domed it into a pillow, and the
        # 6 cm along-car blur rounded the lid's rear edge and the fins' step (the rear
        # view draws the fin as a step: x 0.703 at z 0.916 -> 0.647 at 0.96).
        # Stations at the boot on the monotone-cubic path (>2 stations): the plan and the
        # mean end view cannot say the fin - the rear view's own step (x 0.703 at z 0.916
        # -> 0.647 at 0.96) is averaged with the front view and blurred to a shoulder, so
        # the quarter bulged over the arch and the fins rounded into the lid. Each
        # station's top stands 4-6 cm above the outline's top there (a section topping out
        # at the cap dropped the field on the centreline and the blur read it as a ridge
        # down the lid - escort.py's comment), and the widths hold past the fin's step.
        'sectionStations': [
            {'y': 1.20, 'half': [[0.0, 0.70], [0.35, 0.72], [0.45, 0.775], [0.65, 0.775], [0.85, 0.766], [0.950, 0.720],
                                 [0.965, 0.706], [0.975, 0.675], [0.99, 0.665], [1.03, 0.655]]},
            {'y': 1.50, 'half': [[0.0, 0.70], [0.30, 0.71], [0.42, 0.775], [0.62, 0.775], [0.82, 0.768], [0.925, 0.715],
                                 [0.940, 0.702], [0.955, 0.665], [0.97, 0.655], [1.02, 0.645]]},
            {'y': 1.80, 'half': [[0.0, 0.70], [0.30, 0.71], [0.40, 0.775], [0.60, 0.775], [0.80, 0.768], [0.910, 0.712],
                                 [0.925, 0.700], [0.945, 0.660], [0.96, 0.650], [1.01, 0.640]]},
            {'y': 2.03, 'half': [[0.0, 0.69], [0.30, 0.70], [0.37, 0.755], [0.538, 0.774], [0.734, 0.767], [0.900, 0.710],
                                 [0.916, 0.703], [0.935, 0.660], [0.95, 0.647], [1.00, 0.635]]},
        ],
        'stationBlend': 0.15,
        'crown': [[-2.2, 0.02], [0.4, 0.02], [1.0, 0.006], [2.2, 0.004]],
        'edgeY': 0.025,
        'edgeYMin': 0.02,
        # The tail panel given outright (nearly vertical, tucking under below the bar)
        # so the blur cannot round it forward; faces faired at 0.15 m with 20 deg corners.
        'face': {'rear': [[0.30, 2.05], [0.42, 2.095], [0.92, 2.095]]},
        'faceSpacing': 0.15,
        'cornerDeg': 20,
        'roofCrown': 0.035,
        'edge': 0.012,
        'arch': {'radius': 0.355, 'lift': 0.01},
    },
    'parts': {
        'glass': [
            {'view': 'side', 'outline': [[-0.709, 0.99], [-0.561, 1.367], [-0.035, 1.38], [-0.03, 0.99]], 'facingMin': 0.3},
            {'view': 'side', 'outline': [[0.075, 0.99], [0.075, 1.375], [0.60, 1.365], [0.70, 1.33], [0.85, 0.99]], 'facingMin': 0.3},
            {'view': 'front', 'outline': [[0.0, 1.388], [0.50, 1.384], [0.555, 1.36], [0.62, 1.02], [0.60, 0.995], [0.0, 0.995]],
             'depthRange': [-1.1, -0.4]},
            # Photos rear-straight/rear34-left: the rear glass reaches almost to the
            # roof, at the side panes' header height, with rounded upper corners.
            # The old 1.29 m header left an 18 cm painted band and made a squat slit.
            {'view': 'rear', 'outline': [[0.0, 1.405], [0.40, 1.39], [0.50, 1.37], [0.55, 1.33],
                                         [0.575, 1.26], [0.62, 1.015], [0.60, 0.995], [0.0, 1.015]],
             'depthRange': [0.7, 1.4]},
        ],
        'decals': [
            # The 1967-76 front (photos): a wide chrome-framed panel across the front with
            # the lamps in its ends, its grille of fine VERTICAL slats (with a chrome
            # divider at the badge), not the horizontal bars the drawing's shading read as.
            {'view': 'front', 'rect': [[0.0, 0.69], [1.30, 0.22]], 'radius': 0.03, 'mirror': False,
             'material': 'chrome', 'height': 0.004, 'depthRange': [-2.2, -1.8]},
            {'view': 'front', 'rect': [[0.0, 0.69], [1.22, 0.17]], 'radius': 0.015, 'mirror': False,
             'material': 'grille', 'height': 0.006, 'depthRange': [-2.2, -1.8]},
            {'view': 'front', 'circle': [[0.60, 0.69], 0.095], 'material': 'chrome', 'height': 0.007, 'depthRange': [-2.2, -1.8]},
            {'view': 'front', 'node': 'headlights', 'circle': [[0.60, 0.69], 0.08], 'material': 'Headlights',
             'height': 0.012, 'depthRange': [-2.2, -1.8]},
            {'view': 'front', 'node': 'front_blinker_left', 'rect': [[0.60, 0.55], [0.12, 0.04]], 'radius': 0.01,
             'material': 'IndicatorLights', 'height': 0.008, 'depthRange': [-2.2, -1.8]},
            {'view': 'front', 'node': 'front_blinker_right', 'rect': [[0.60, 0.55], [0.12, 0.04]], 'radius': 0.01,
             'material': 'IndicatorLights', 'height': 0.008, 'depthRange': [-2.2, -1.8]},
            {'view': 'side', 'node': 'front_blinker_left', 'circle': [[-0.965, 0.873], 0.02], 'material': 'IndicatorLights', 'height': 0.006},
            {'view': 'side', 'node': 'front_blinker_right', 'circle': [[-0.965, 0.873], 0.02], 'material': 'IndicatorLights', 'height': 0.006},
            # Four square lenses each side under a chrome rim: reversing lamp inboard, two
            # red, the indicator outboard.
            {'view': 'rear', 'rect': [[0.545, 0.6185], [0.33, 0.115]], 'radius': 0.01, 'material': 'chrome',
             'height': 0.005, 'depthRange': [1.6, 2.1]},
            {'view': 'rear', 'node': 'reverse_lights', 'rect': [[0.428, 0.6185], [0.07, 0.09]], 'radius': 0.008,
             'material': 'ReverseLights', 'height': 0.009, 'depthRange': [1.6, 2.1]},
            {'view': 'rear', 'node': 'taillights', 'rect': [[0.585, 0.6185], [0.23, 0.09]], 'radius': 0.008,
             'material': 'TailLights', 'height': 0.009, 'depthRange': [1.6, 2.1]},
            # The amber indicator is not in the unit: it is the triangular lamp on the fin
            # at the corner (photos: taillamp.jpg, rear34-left.jpg), so the unit is red
            # lenses + the reversing lamp inboard and the corner lamp carries the blinker.
            {'view': 'rear', 'node': 'rear_blinker_left', 'rect': [[0.655, 0.745], [0.10, 0.085]], 'radius': 0.022,
             'material': 'IndicatorLights', 'height': 0.010, 'depthRange': [1.6, 2.2]},
            {'view': 'rear', 'node': 'rear_blinker_right', 'rect': [[0.655, 0.745], [0.10, 0.085]], 'radius': 0.022,
             'material': 'IndicatorLights', 'height': 0.010, 'depthRange': [1.6, 2.2]},
            {'view': 'rear', 'rect': [[0.0, 0.565], [0.39, 0.165]], 'radius': 0.006, 'mirror': False, 'material': 'plate',
             'height': 0.005, 'depthRange': [1.6, 2.1]},
        ],
        'bars': [
            {'view': 'front', 'span': [-0.58, 0.58], 'b': [0.615, 0.765], 'count': 32, 'dir': 'v', 'width': 0.006,
             'material': 'chrome', 'height': 0.008, 'depthRange': [-2.2, -1.8]},
        ],
        'lines': [
            {'view': 'side', 'points': [[-0.83, 0.96], [-0.83, 0.322], [0.027, 0.322], [0.027, 0.99]], 'width': 0.005},
            {'view': 'side', 'points': [[0.027, 0.322], [0.625, 0.322], [0.70, 0.36], [0.80, 0.47], [0.855, 0.6], [0.855, 0.97]], 'width': 0.005},
            {'view': 'rear', 'points': [[0.0, 0.69], [0.70, 0.69]], 'width': 0.005, 'depthRange': [1.5, 2.1]},
            {'view': 'side', 'points': [[-0.709, 0.985], [0.86, 0.985]], 'width': 0.01, 'material': 'chrome', 'height': 0.003},
            {'view': 'side', 'points': [[-1.95, 0.83], [1.92, 0.80]], 'width': 0.008, 'material': 'chrome', 'height': 0.003},
            {'view': 'side', 'points': [[-0.72, 1.0], [-0.565, 1.39], [0.60, 1.385], [0.715, 1.34], [0.87, 0.99]],
             'width': 0.012, 'material': 'chrome', 'height': 0.003},
            {'view': 'side', 'points': [[0.60, 0.99], [0.60, 1.37]], 'width': 0.014, 'material': 'chrome', 'height': 0.003},
        ],
        'bumpers': {
            'front': {'z': [0.405, 0.48], 'depth': 0.05, 'wrap': 0.25, 'profile': 'blade',
                      'overriders': [[0.40, 0.05, 0.36, 0.53]]},
            'rear': {'z': [0.39, 0.475], 'depth': 0.05, 'wrap': 0.25, 'profile': 'blade',
                     'overriders': [[0.40, 0.05, 0.35, 0.52]]},
        },
        # The mirror stands on the door at the A-pillar's foot: its head just off the
        # skin (0.63-0.65 there, the body's widest 0.775), not out at 0.80 in the air.
        'mirror': {'y': -0.66, 'z': 1.00, 'reach': 0.75, 'w': 0.08, 'h': 0.12, 'material': 'chrome'},
        'handles': {'at': [[-0.12, 0.90], [0.76, 0.90]], 'w': 0.13},
        'wipers': {'arms': [[-0.55, -0.05, -0.93, 1.0], [0.05, 0.55, -0.93, 1.0]]},
        'wheel': {'style': 'hubcap', 'rimFactor': 0.66, 'cap': 0.6},
    },
}
