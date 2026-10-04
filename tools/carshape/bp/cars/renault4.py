# Renault 4 TL, 1978. Factory: 3668 x 1485 x 1550, wheelbase 2401 (left side;
# right 2449), tracks 1280/1244, 135 SR 13, clearance 175. The 1961 drawing
# supplies the shell only; trim follows the documented 1978 TL, not early cars/GTL.
CAR = {
    'id': 'renault4',
    'label': 'Renault 4',
    'factory': {'length': 3.668, 'width': 1.485, 'height': 1.55, 'clearance': 0.175, 'wheelbase': 2.401,
                'frontTrack': 1.28, 'rearTrack': 1.244, 'wheelRadius': 0.275, 'tyreWidth': 0.135, 'frontOverhang': 0.528},
    'blueprint': {
        'image': 'renault4.jpg',
        'side': {'box': [410, 120, 1150, 432], 'nose': 'left', 'ground': 434, 'drop': [[640, 0, 740, 40]]},
        'top': {'box': [416, 592, 1170, 898], 'nose': 'left'},
        'front': {'box': [25, 135, 375, 430]},
        'rear': {'box': [28, 580, 360, 880]},
    },
    'hull': {
        # The drawing's bumper bands: the front's face is -1.854 at z 0.30-0.45, the
        # rear's +1.877 at z 0.40-0.55 (the model had the rear band at 0.30-0.47, 8 cm
        # low, where the shell's tail has already turned up to the valance).
        'bumpers': {'front': {'z': [0.28, 0.46]}, 'rear': {'z': [0.38, 0.55]}},
        'topOverride': [[1.0, 1.53], [1.2, 1.515], [1.30, 1.49], [1.36, 1.45], [1.40, 1.39], [1.50, 1.15], [1.60, 0.95], [1.68, 0.78], [1.80, 0.60]],
        'sill': [[-1.8, 0.40], [-1.6, 0.36], [-1.2, 0.32], [0.8, 0.32], [1.2, 0.34], [1.5, 0.38], [1.8, 0.42]],
        'cabin': [-0.62, 1.68],
        'belt': [[-0.62, 1.0], [-0.4, 0.99], [1.4, 0.99], [1.68, 0.98]],
        'glassPlan': [[-0.62, 0.66], [-0.3, 0.70], [1.2, 0.71], [1.68, 0.70]],
        # A flat-panelled box (photos): no crown along the car, a nearly flat roof, and
        # crisp folds. The 2.2 cm across / 6 cm along default blur domed the bonnet,
        # rolled the roof's edges off and rounded the tailgate into a bustle; 1.1 cm /
        # 1.8 cm keeps the shoulder, the roof's drip rails and the tail's corners.
        'crown': [[-2.0, 0.008], [2.0, 0.008]],
        'roofCrown': 0.012,
        # Flat-panelled box: the same section the whole length of the car. The front
        # and rear end views' mean, smoothed over 5 cm, rolled the shoulder into the
        # glasshouse and left the flanks a barrel; these four stations give the
        # drawing's own section (front view: full width to the waist at 0.83, the
        # shoulder tucking in to 0.66 at the belt, then the glasshouse), unsmoothed,
        # so the waist crease and the roof's drip rails stay.
        'sectionStations': [
            {'y': -1.80, 'half': [[0.30, 0.700], [0.45, 0.722], [0.80, 0.726], [0.90, 0.712], [0.98, 0.680],
                                  [1.10, 0.650], [1.22, 0.618], [1.34, 0.600], [1.46, 0.560], [1.55, 0.470],
                                  [1.58, 0.30], [1.61, 0.05]]},
            {'y': -1.55, 'half': [[0.30, 0.700], [0.45, 0.722], [0.80, 0.726], [0.90, 0.712], [0.98, 0.680],
                                  [1.10, 0.650], [1.22, 0.618], [1.34, 0.600], [1.46, 0.560], [1.55, 0.470],
                                  [1.58, 0.30], [1.61, 0.05]]},
            {'y': 1.55, 'half': [[0.30, 0.700], [0.45, 0.722], [0.80, 0.726], [0.90, 0.712], [0.98, 0.680],
                                 [1.10, 0.650], [1.22, 0.618], [1.34, 0.600], [1.46, 0.560], [1.55, 0.470],
                                 [1.58, 0.30], [1.61, 0.05]]},
            {'y': 1.80, 'half': [[0.30, 0.700], [0.45, 0.722], [0.80, 0.726], [0.90, 0.712], [0.98, 0.680],
                                 [1.10, 0.650], [1.22, 0.618], [1.34, 0.600], [1.46, 0.560], [1.55, 0.470],
                                 [1.58, 0.30], [1.61, 0.05]]},
        ],
        # The 1978 plastic fresh-air grille is a flush decal at the screen's foot.
        # ...but along the car the R4's ends are rounded (the bonnet falls to the grille
        # over 10 cm and the nose's face curves): 1.8 cm of along-car blur kept the drawn
        # nose's pixels and pulled the front panel 8 cm back (the bumper then floated),
        # 5.5 cm keeps the drawn reach and is still crisper than the 6 cm default.
        'edge': 0.011,
        'edgeMin': 0.013,
        'edgeY': 0.055,
        'edgeYMin': 0.055,
        'faceSpacing': 0.15, 'cornerDeg': 20,
        'arch': {'radius': 0.32, 'lift': 0.04},
    },
    'parts': {
        'glass': [
            {'view': 'side', 'outline': [[-0.47, 1.02], [-0.27, 1.33], [-0.2, 1.37], [0.18, 1.37], [0.19, 1.02]], 'facingMin': 0.3},
            {'view': 'side', 'outline': [[0.30, 1.02], [0.30, 1.33], [0.33, 1.36], [0.87, 1.36], [0.895, 1.33], [0.895, 1.02]], 'facingMin': 0.3},
            {'view': 'side', 'outline': [[0.96, 1.02], [0.97, 1.30], [1.02, 1.34], [1.32, 1.34], [1.37, 1.30], [1.39, 1.05], [1.36, 1.02]], 'facingMin': 0.3},
            {'view': 'front', 'outline': [[0.0, 1.37], [0.46, 1.365], [0.49, 1.34], [0.52, 1.07], [0.50, 1.04], [0.0, 1.04]],
             'depthRange': [-1.0, -0.4], 'facingMin': 0.25},
            {'view': 'rear', 'outline': [[0.0, 1.30], [0.38, 1.295], [0.42, 1.26], [0.42, 1.03], [0.38, 1.0], [0.0, 1.0]],
             'depthRange': [1.3, 1.9], 'facingMin': 0.15},
        ],
        'decals': [
            # The grille panel and lamps sit high on the front panel, just under the
            # bonnet's edge (drawing: panel 0.62-0.835, headlamps centred 0.73; the
            # model had them at 0.54-0.75 / 0.64, 8 cm low with a plain apron above).
            # 1978 TL: black plastic grille with a thin bright perimeter, not the
            # early car's broad aluminium panel (Collecting Cars lot 002678).
            {'view': 'front', 'rect': [[0.0, 0.727], [1.06, 0.215]], 'radius': 0.03, 'mirror': False,
             'material': 'trim', 'height': 0.004, 'depthRange': [-2.0, -1.6]},
            {'view': 'front', 'rect': [[0.0, 0.727], [1.06, 0.215]], 'radius': 0.03, 'ring': 0.006, 'mirror': False,
             'material': 'chrome', 'height': 0.009, 'depthRange': [-2.0, -1.6]},
            {'view': 'front', 'rect': [[0.0, 0.727], [0.60, 0.185]], 'radius': 0.006, 'mirror': False,
             'material': 'grille', 'height': 0.006, 'depthRange': [-2.0, -1.6]},
            {'view': 'front', 'node': 'headlights', 'circle': [[0.43, 0.727], 0.082], 'material': 'Headlights',
             'height': 0.012, 'depthRange': [-2.0, -1.6]},
            {'view': 'front', 'circle': [[0.43, 0.727], 0.094], 'ring': 0.012, 'material': 'chrome',
             'height': 0.013, 'depthRange': [-2.0, -1.6]},
            {'view': 'front', 'rect': [[0.58, 0.485], [0.13, 0.065]], 'radius': 0.009,
             'material': 'rubber', 'height': 0.005, 'depthRange': [-2.0, -1.5]},
            {'view': 'front', 'node': 'front_blinker_left', 'rect': [[0.612, 0.485], [0.055, 0.05]], 'radius': 0.005, 'material': 'IndicatorLights',
             'height': 0.010, 'depthRange': [-2.0, -1.5]},
            {'view': 'front', 'node': 'front_blinker_right', 'rect': [[0.612, 0.485], [0.055, 0.05]], 'radius': 0.005, 'material': 'IndicatorLights',
             'height': 0.010, 'depthRange': [-2.0, -1.5]},
            {'view': 'front', 'node': 'running_lights', 'rect': [[0.549, 0.485], [0.055, 0.05]], 'radius': 0.005, 'material': 'ReverseLights',
             'height': 0.010, 'depthRange': [-2.0, -1.5]},
            {'view': 'front', 'outline': [[0.0, 0.745], [0.02, 0.72], [0.0, 0.695], [-0.02, 0.72]], 'mirror': False,
             'material': 'chrome', 'height': 0.010, 'depthRange': [-2.0, -1.6]},
            # Plastic intake introduced in 1978; no raised body-colour metal scoop.
            {'view': 'top', 'rect': [[-0.78, 0.0], [0.16, 0.64]], 'radius': 0.012, 'mirror': False,
             'material': 'grille', 'height': 0.004},
            # TL rear cluster: black surround, red / amber / red. The lower lens
            # is not a reversing lamp; the GTL's separate clear lamp is not fitted.
            {'view': 'rear', 'rect': [[0.55, 0.70], [0.10, 0.24]], 'radius': 0.04, 'material': 'rubber',
             'height': 0.006, 'facingMin': 0.1, 'depthRange': [1.5, 2.0]},
            {'view': 'rear', 'node': 'taillights', 'circle': [[0.55, 0.765], 0.028], 'material': 'TailLights',
             'height': 0.010, 'facingMin': 0.1, 'depthRange': [1.5, 2.0]},
            {'view': 'rear', 'node': 'rear_blinker_left', 'circle': [[0.55, 0.695], 0.028], 'material': 'IndicatorLights',
             'height': 0.010, 'facingMin': 0.1, 'depthRange': [1.5, 2.0]},
            {'view': 'rear', 'node': 'rear_blinker_right', 'circle': [[0.55, 0.695], 0.028], 'material': 'IndicatorLights',
             'height': 0.010, 'facingMin': 0.1, 'depthRange': [1.5, 2.0]},
            {'view': 'rear', 'circle': [[0.55, 0.615], 0.034], 'material': 'TailLights',
             'height': 0.010, 'facingMin': 0.1, 'depthRange': [1.5, 2.0]},
            {'view': 'rear', 'rect': [[0.0, 0.645], [0.40, 0.20]], 'radius': 0.02, 'mirror': False, 'material': 'plate',
             'height': 0.005, 'depthRange': [1.5, 2.0]},
        ],
        'bars': [
            {'view': 'front', 'span': [-0.29, 0.29], 'b': [0.63, 0.82], 'count': 5, 'width': 0.006,
             'material': 'trim', 'height': 0.008, 'depthRange': [-2.0, -1.6]},
            {'view': 'front', 'span': [-0.29, 0.29], 'b': [0.63, 0.82], 'count': 8, 'width': 0.006, 'dir': 'v',
             'material': 'trim', 'height': 0.008, 'depthRange': [-2.0, -1.6]},
        ],
        'lines': [
            {'view': 'side', 'points': [[-0.66, 0.98], [-0.68, 0.36], [0.24, 0.36], [0.24, 1.0]], 'width': 0.005},
            {'view': 'side', 'points': [[0.24, 0.36], [0.85, 0.37], [0.93, 0.55], [0.93, 1.0]], 'width': 0.005},
            # Thin bright TL waist moulding; no GTL lower-door protection boards.
            {'view': 'side', 'points': [[-1.7, 0.90], [1.68, 0.90]], 'width': 0.009, 'material': 'chrome', 'height': 0.004},
            {'view': 'rear', 'points': [[0.0, 0.52], [0.49, 0.52], [0.50, 1.36], [0.0, 1.36]], 'width': 0.005, 'depthRange': [1.3, 2.0]},
        ],
        'bumpers': {
            # Photos: thin pressed chrome blades (the round profile read as a tube); the
            # front stands 5 cm off the panel, the rear only ~3 (the drawn tail panel
            # already reaches y 1.80 at the bumper's height, so a deep bar overlapped it).
            'front': {'z': [0.33, 0.41], 'depth': 0.05, 'wrap': 0.14, 'material': 'alu',
                      'overriders': [[0.30, 0.04, 0.30, 0.45]]},
            'rear': {'z': [0.39, 0.47], 'depth': 0.05, 'wrap': 0.14, 'material': 'alu',
                     'overriders': [[0.30, 0.04, 0.36, 0.50]]},
        },
        'mirror': {'y': -0.58, 'z': 1.04, 'reach': 0.78, 'w': 0.10, 'h': 0.07, 'sides': [1], 'material': 'chrome'},
        'handles': {'at': [[0.10, 0.93], [0.78, 0.93]], 'w': 0.10},
        'wipers': {'arms': [[-0.45, -0.1, -0.65, 1.04], [0.0, 0.40, -0.65, 1.04]]},
        # Documented 1978 TL steel wheel: eight round holes and a centre cap.
        'wheel': {'style': 'steel', 'windows': 8, 'rimFactor': 0.66, 'cap': True},
    },
}
