# Honda CRX 1.6i-16 (1985-87). Factory: 3675 x 1625 x 1290, wheelbase 2200, tracks
# 1400/1415, 185/60 R14, clearance 140. The drawing reprinted at 3dcar.ru/blueprints/honda/crx
# (2x upscaled).
CAR = {
    'id': 'crx',
    'label': 'Honda CRX',
    'factory': {'length': 3.675, 'width': 1.625, 'height': 1.29, 'clearance': 0.14, 'wheelbase': 2.2,
                'frontTrack': 1.4, 'rearTrack': 1.415, 'wheelRadius': 0.29, 'tyreWidth': 0.185, 'frontOverhang': 0.755},
    'blueprint': {
        'image': 'crx2.png',
        'side': {'box': [812, 66, 2146, 556], 'nose': 'left', 'wheels': [[1097.5, 444], [1881.5, 444]], 'ground': 555},
        'top': {'box': [808, 634, 2160, 1230], 'nose': 'left', 'fitWidth': True},
        'front': {'box': [76, 92, 676, 556]},
        'rear': {'box': [80, 696, 682, 1158]},
    },
    'hull': {
        'sill': [[-1.85, 0.30], [-1.6, 0.27], [-1.2, 0.25], [0.8, 0.25], [1.2, 0.28], [1.85, 0.36]],
        'cabin': [-0.62, 1.84],
        'belt': [[-0.62, 0.86], [-0.4, 0.87], [0.7, 0.90], [1.4, 0.91], [1.84, 0.88]],
        'glassPlan': [[-0.62, 0.68], [-0.3, 0.70], [0.7, 0.70], [1.4, 0.64], [1.84, 0.60]],
        'crown': [[-1.9, 0.02], [1.9, 0.02]],
        'roofCrown': 0.03,
        'edge': 0.012,
        # The nose/tail rows were blurred over 4 cm, which rounded the bonnet's leading
        # edge and the flat fascia away (the top line came out 3 cm low at the tip:
        # drawing 560/673 at -1.825/-1.75, hull 529/651). Faired with the corners kept.
        'faceSpacing': 0.15, 'cornerDeg': 20,
        'arch': {'radius': 0.335, 'lift': 0.04},
    },
    'parts': {
        'glass': [
            {'view': 'side', 'outline': [[0.58, 1.193], [0.493, 1.207], [0.229, 1.209], [0.072, 1.201], [-0.046, 1.174], [-0.107, 1.142],
                                         [-0.374, 0.954], [-0.399, 0.868], [0.238, 0.892], [0.614, 0.903], [0.605, 1.037]], 'facingMin': 0.3},
            {'view': 'side', 'outline': [[0.743, 1.196], [0.774, 1.07], [0.802, 0.898], [1.318, 0.914], [1.385, 0.935], [1.397, 0.989],
                                         [1.293, 1.048], [1.074, 1.121], [0.889, 1.169]], 'facingMin': 0.3},
            {'view': 'front', 'outline': [[0.0, 1.24], [0.48, 1.235], [0.52, 1.20], [0.66, 0.92], [0.63, 0.90], [0.0, 0.90]],
             'depthRange': [-1.0, -0.2], 'facingMin': 0.25},
            {'view': 'rear', 'outline': [[0.0, 1.235], [0.45, 1.23], [0.48, 1.20], [0.54, 1.04], [0.51, 1.02], [0.0, 1.02]],
             'depthRange': [0.8, 1.8], 'facingMin': 0.1},
            # The CRX's second, upright pane in the Kamm tail.
            {'view': 'rear', 'outline': [[0.0, 0.93], [0.52, 0.93], [0.52, 0.84], [0.0, 0.84]], 'depthRange': [1.6, 2.0], 'facingMin': 0.05, 'fit': False},
        ],
        'regions': [
            # Black first (the two-tone pass below only picks up faces still in paint):
            # the lower grille and the valance under the bumper
            {'view': 'front', 'rect': [[0.0, 0.35], [1.8, 0.26]], 'radius': 0.001, 'mirror': False, 'depthRange': [-2.0, -1.55]},
            {'view': 'side', 'outline': [[-1.85, 0.22], [-1.85, 0.46], [-1.34, 0.46], [-1.39, 0.36], [-1.40, 0.22]]},
            {'view': 'rear', 'rect': [[0.0, 0.36], [1.8, 0.28]], 'radius': 0.001, 'mirror': False, 'depthRange': [1.5, 2.0]},
            {'view': 'side', 'outline': [[1.42, 0.22], [1.42, 0.46], [1.85, 0.46], [1.85, 0.22]]},
            # The 1.6i-16's two-tone: everything below the beltline stripe is the lower
            # body's grey - sills, quarter panels, the bumper's faces (photos, the
            # European car in this folder)
            {'view': 'side', 'outline': [[-1.83, 0.18], [1.83, 0.18], [1.83, 0.60], [-1.83, 0.60]], 'material': 'paint2'},
            {'view': 'front', 'rect': [[0.0, 0.42], [1.8, 0.40]], 'radius': 0.001, 'mirror': False, 'material': 'paint2',
             'depthRange': [-2.0, -1.55]},
            {'view': 'rear', 'rect': [[0.0, 0.42], [1.8, 0.40]], 'radius': 0.001, 'mirror': False, 'material': 'paint2',
             'depthRange': [1.5, 2.0]},
        ],
        'decals': [
            # Wide flush lamps from the grille slot to the corners, each in a black
            # recess (photos, 1986). The photos' lens is slim (about 10 cm) and sits on
            # the flat front face, not wrapped round the wings; the front view gives
            # lamps 0.42-0.78, 0.595-0.695; the black slot +-0.42 the same height with the
            # H badge; the lower grille below the bumper's face (0.49)
            {'view': 'front', 'rect': [[0.60, 0.645], [0.40, 0.12]], 'radius': 0.01, 'material': 'trim',
             'height': 0.004, 'depthRange': [-2.0, -1.5], 'facingMin': 0.25},
            {'view': 'front', 'node': 'headlights', 'rect': [[0.60, 0.645], [0.36, 0.10]], 'radius': 0.01, 'material': 'Headlights',
             'height': 0.008, 'depthRange': [-2.0, -1.5], 'facingMin': 0.25},
            {'view': 'front', 'rect': [[0.0, 0.645], [0.84, 0.10]], 'radius': 0.006, 'mirror': False, 'material': 'grille',
             'height': 0.006, 'depthRange': [-2.0, -1.5], 'facingMin': 0.25},
            {'view': 'front', 'node': 'front_blinker_left', 'rect': [[0.69, 0.53], [0.17, 0.065]], 'radius': 0.006,
             'material': 'IndicatorLights', 'height': 0.008, 'depthRange': [-2.0, -1.5], 'facingMin': 0.05},
            {'view': 'front', 'node': 'front_blinker_right', 'rect': [[0.69, 0.53], [0.17, 0.065]], 'radius': 0.006,
             'material': 'IndicatorLights', 'height': 0.008, 'depthRange': [-2.0, -1.5], 'facingMin': 0.05},
            {'view': 'front', 'rect': [[0.0, 0.34], [0.88, 0.16]], 'radius': 0.01, 'mirror': False, 'material': 'grille',
             'height': 0.004, 'depthRange': [-2.0, -1.5]},
            {'view': 'side', 'node': 'front_blinker_left', 'rect': [[-1.68, 0.62], [0.08, 0.04]], 'radius': 0.006, 'material': 'IndicatorLights', 'height': 0.005},
            {'view': 'side', 'node': 'front_blinker_right', 'rect': [[-1.68, 0.62], [0.08, 0.04]], 'radius': 0.006, 'material': 'IndicatorLights', 'height': 0.005},
            # Tail: the black lamp band across the Kamm tail; the drawing's rear view has
            # the outer lens to the corner (0.62-0.83) and the reverse lamp and its
            # reflector in two stacked squares inboard of it (0.50-0.60)
            {'view': 'rear', 'rect': [[0.0, 0.71], [1.66, 0.17]], 'radius': 0.008, 'mirror': False, 'material': 'trim',
             'height': 0.003, 'depthRange': [1.6, 2.0]},
            {'view': 'rear', 'node': 'taillights', 'rect': [[0.68, 0.7125], [0.16, 0.155]], 'radius': 0.006,
             'material': 'TailLights', 'height': 0.007, 'depthRange': [1.6, 2.0]},
            {'view': 'rear', 'node': 'rear_blinker_left', 'rect': [[0.79, 0.7125], [0.08, 0.155]], 'radius': 0.006,
             'material': 'IndicatorLights', 'height': 0.007, 'depthRange': [1.6, 2.0], 'facingMin': 0.1},
            {'view': 'rear', 'node': 'rear_blinker_right', 'rect': [[0.79, 0.7125], [0.08, 0.155]], 'radius': 0.006,
             'material': 'IndicatorLights', 'height': 0.007, 'depthRange': [1.6, 2.0], 'facingMin': 0.1},
            {'view': 'rear', 'node': 'reverse_lights', 'rect': [[0.55, 0.755], [0.10, 0.065]], 'radius': 0.006,
             'material': 'ReverseLights', 'height': 0.007, 'depthRange': [1.6, 2.0]},
            # the red reflector square under the reverse lamp (drawing's rear view, photos)
            {'view': 'rear', 'rect': [[0.55, 0.6675], [0.10, 0.065]], 'radius': 0.006,
             'material': 'TailLights', 'height': 0.006, 'depthRange': [1.6, 2.0]},
            {'view': 'rear', 'rect': [[0.0, 0.53], [0.40, 0.11]], 'radius': 0.006, 'mirror': False, 'material': 'plate',
             'height': 0.006, 'depthRange': [1.6, 2.0]},
        ],
        'bars': [
            {'view': 'front', 'span': [-0.42, 0.42], 'b': [0.285, 0.395], 'count': 4, 'width': 0.008,
             'material': 'trim', 'height': 0.006, 'depthRange': [-2.0, -1.5]},
        ],
        'lines': [
            {'view': 'side', 'points': [[-0.48, 0.86], [-0.50, 0.33], [0.66, 0.33], [0.72, 0.60], [0.72, 0.90]], 'width': 0.005},
            # the beltline pinstripe: red, on the grey lower body below it (photos); the
            # line is the body's own paint
            {'view': 'side', 'points': [[-1.80, 0.605], [1.85, 0.615]], 'width': 0.015, 'material': 'paint', 'height': 0.004},
            {'view': 'side', 'points': [[-0.40, 0.87], [-0.10, 1.15], [0.20, 1.22], [0.62, 1.21], [1.10, 1.13], [1.40, 1.00], [1.39, 0.92],
                                        [-0.40, 0.87]], 'width': 0.014, 'material': 'trim', 'height': 0.003},
            {'view': 'side', 'points': [[0.66, 0.90], [0.62, 1.20]], 'width': 0.10, 'material': 'trim', 'height': 0.003},
        ],
        'boxes': [{'c': [0.0, 1.66, 1.035], 'size': [1.10, 0.12, 0.02], 'material': 'trim', 'mirror': False}],
        'mirror': {'y': -0.30, 'z': 0.93, 'reach': 0.90, 'w': 0.14, 'h': 0.08, 'material': 'trim'},
        'handles': {'at': [[0.55, 0.80]], 'w': 0.10, 'material': 'trim'},
        'wipers': {'arms': [[-0.55, -0.05, -0.60, 0.89], [0.05, 0.5, -0.60, 0.89]]},
        'wheel': {'style': 'alloy', 'spokes': 4, 'rimFactor': 0.70, 'spokeWidth': 0.6},
        # The 1.6i-16's lower body keeps its own grey whatever the car is painted (the
        # roster paints car_paint only): the European photos' mid-grey.
        'paint2': {'rgb': [0.46, 0.47, 0.49], 'name': 'car_paint_2'},
    },
}
