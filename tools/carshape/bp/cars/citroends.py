# Citroën DS 21 (1965-75). Factory: 4874 x 1803 x 1470, wheelbase 3125, overhangs
# 1016/733, tracks 1516/1316, 180 HR 15, clearance 145. The dimensioned drawing
# reprinted at 3dcar.ru/blueprints/citroen/ds.
CAR = {
    'id': 'citroends',
    'label': 'Citroën DS',
    'factory': {'length': 4.874, 'width': 1.79, 'height': 1.47, 'clearance': 0.145, 'wheelbase': 3.125,
                'frontTrack': 1.516, 'rearTrack': 1.316, 'wheelRadius': 0.33, 'tyreWidth': 0.18, 'frontOverhang': 1.016},
    'blueprint': {
        'image': 'citroends.jpg',
        'side': {'box': [628, 85, 1586, 397], 'nose': 'left', 'ground': 401},
        'top': {'box': [610, 595, 1595, 985], 'nose': 'left'},
        'front': {'box': [40, 100, 452, 398]},
        'rear': {'box': [66, 640, 425, 938]},
    },
    'hull': {
        'bumpers': {'front': {'z': [0.48, 0.58]}, 'rear': {'z': [0.40, 0.51]}},
        'sill': [[-2.45, 0.42], [-2.2, 0.36], [-1.9, 0.26], [-1.6, 0.21], [1.3, 0.21], [1.8, 0.25], [2.2, 0.32], [2.45, 0.40]],
        'cabin': [-0.80, 2.0],
        'belt': [[-0.80, 1.0], [-0.4, 0.96], [1.2, 0.93], [1.6, 0.95], [2.0, 0.93]],
        'glassPlan': [[-0.80, 0.70], [-0.4, 0.74], [1.0, 0.72], [1.6, 0.66], [2.0, 0.62]],
        'crown': [[-2.5, 0.03], [2.5, 0.03]],
        'roofCrown': 0.04,
        'edge': 0.018,
        'arch': {'radius': 0.40, 'lift': 0.04, 'rear': {'skirt': True}},
    },
    'parts': {
        # The lamps stand under the covers facing straight ahead in chrome rings (podLamps).
        'glass': [
            {'view': 'side', 'outline': [[-0.387, 1.107], [-0.337, 0.972], [0.334, 0.96], [0.33, 1.316], [0.099, 1.33], [-0.182, 1.34],
                                         [-0.227, 1.312]], 'facingMin': 0.3},
            {'view': 'side', 'outline': [[0.404, 1.303], [0.359, 1.07], [0.344, 0.954], [1.141, 0.935], [1.096, 1.121], [1.065, 1.205],
                                         [0.985, 1.228], [0.685, 1.284], [0.49, 1.303]], 'facingMin': 0.3},
            {'view': 'side', 'outline': [[1.151, 1.191], [1.201, 0.996], [1.226, 0.93], [1.476, 0.916], [1.426, 1.005], [1.361, 1.14]], 'facingMin': 0.3},
            {'view': 'front', 'outline': [[0.0, 1.40], [0.53, 1.395], [0.57, 1.36], [0.64, 1.12], [0.61, 1.10], [0.0, 1.10]],
             'depthRange': [-1.0, -0.2], 'facingMin': 0.25},
            {'view': 'rear', 'outline': [[0.0, 1.28], [0.46, 1.275], [0.50, 1.25], [0.57, 1.02], [0.54, 1.0], [0.0, 1.0]],
             'depthRange': [1.2, 2.2], 'facingMin': 0.15},
        ],
        'decals': [
            # The faired headlamps (1968 on): one glazed cover flush in the wing's nose
            # over the twin lamps and their silver reflector (photos). A patch cut into
            # the wing itself, so the cover follows the nose; the two flush pod lamps
            # that stood here before were flat discs tangent to a domed wing and read as
            # chrome plates floating over it, their rims catching the sky as a blue ring.
            {'view': 'front', 'outline': [[0.89, 0.726], [0.882, 0.765], [0.857, 0.789], [0.817, 0.806], [0.76, 0.814], [0.672, 0.813],
                                          [0.584, 0.805], [0.527, 0.791], [0.487, 0.771], [0.462, 0.744], [0.454, 0.704], [0.462, 0.665],
                                          [0.487, 0.641], [0.527, 0.624], [0.584, 0.616], [0.672, 0.617], [0.76, 0.625], [0.817, 0.639],
                                          [0.857, 0.659], [0.882, 0.686]],
             'material': 'chrome', 'height': 0.004, 'depthRange': [-2.5, -1.9], 'facingMin': 0.2},
            # its chrome edge trim, a hair prouder than the cover
            {'view': 'front', 'outline': [[0.89, 0.726], [0.882, 0.765], [0.857, 0.789], [0.817, 0.806], [0.76, 0.814], [0.672, 0.813],
                                          [0.584, 0.805], [0.527, 0.791], [0.487, 0.771], [0.462, 0.744], [0.454, 0.704], [0.462, 0.665],
                                          [0.487, 0.641], [0.527, 0.624], [0.584, 0.616], [0.672, 0.617], [0.76, 0.625], [0.817, 0.639],
                                          [0.857, 0.659], [0.882, 0.686]],
             'ring': 0.012, 'material': 'chrome', 'height': 0.006, 'depthRange': [-2.5, -1.9], 'facingMin': 0.2},
            {'view': 'front', 'node': 'headlights', 'circle': [[0.79, 0.755], 0.09], 'material': 'Headlights',
             'height': 0.008, 'depthRange': [-2.5, -1.9]},
            {'view': 'front', 'node': 'headlights', 'circle': [[0.605, 0.733], 0.08], 'material': 'Headlights',
             'height': 0.008, 'depthRange': [-2.5, -1.9]},
            # Under the bumper: the two wide air intakes, round turn lamps at the corners.
            {'view': 'front', 'rect': [[0.27, 0.44], [0.34, 0.075]], 'radius': 0.03, 'material': 'grille',
             'height': 0.005, 'depthRange': [-2.5, -2.0], 'facingMin': 0.1},
            {'view': 'front', 'node': 'front_blinker_left', 'circle': [[0.66, 0.44], 0.035], 'material': 'IndicatorLights',
             'height': 0.008, 'depthRange': [-2.5, -1.8], 'facingMin': 0.1},
            {'view': 'front', 'node': 'front_blinker_right', 'circle': [[0.66, 0.44], 0.035], 'material': 'IndicatorLights',
             'height': 0.008, 'depthRange': [-2.5, -1.8], 'facingMin': 0.1},
            # Tail lamps in the bumper's recess; the indicator trumpets on the roof's corners.
            {'view': 'rear', 'rect': [[0.45, 0.545], [0.25, 0.085]], 'radius': 0.035, 'material': 'chrome',
             'height': 0.005, 'depthRange': [2.0, 2.6]},
            {'view': 'rear', 'node': 'taillights', 'rect': [[0.40, 0.545], [0.11, 0.065]], 'radius': 0.02,
             'material': 'TailLights', 'height': 0.009, 'depthRange': [2.0, 2.6]},
            {'view': 'rear', 'node': 'reverse_lights', 'rect': [[0.51, 0.545], [0.09, 0.065]], 'radius': 0.02,
             'material': 'ReverseLights', 'height': 0.009, 'depthRange': [2.0, 2.6]},
            {'view': 'rear', 'node': 'taillights', 'circle': [[0.75, 0.55], 0.03], 'material': 'TailLights',
             'height': 0.006, 'depthRange': [1.6, 2.6], 'facingMin': 0.1},
            {'view': 'rear', 'rect': [[0.0, 0.54], [0.60, 0.10]], 'radius': 0.006, 'mirror': False, 'material': 'plate',
             'height': 0.006, 'depthRange': [2.0, 2.6]},
        ],
        'podLamps': [
            {'node': 'rear_blinker_left', 'x': 0.555, 'z': 1.31, 'r': 0.035, 'end': 'rear', 'material': 'IndicatorLights',
             'bezel': 0.012, 'bezelMaterial': 'chrome', 'podDepth': 0.12},
            {'node': 'rear_blinker_right', 'x': 0.555, 'z': 1.31, 'r': 0.035, 'end': 'rear', 'material': 'IndicatorLights',
             'bezel': 0.012, 'bezelMaterial': 'chrome', 'podDepth': 0.12},
        ],
        'lines': [
            {'view': 'side', 'points': [[-0.84, 1.0], [-0.88, 0.62], [-0.82, 0.32], [1.40, 0.32], [1.4, 0.93]], 'width': 0.005},
            {'view': 'side', 'points': [[0.34, 0.32], [0.34, 0.95]], 'width': 0.005},
            {'view': 'side', 'points': [[1.15, 0.32], [1.15, 0.93]], 'width': 0.005},
            {'view': 'side', 'points': [[-0.80, 0.30], [1.35, 0.30]], 'width': 0.025, 'material': 'alu', 'height': 0.004},
            {'view': 'side', 'points': [[-0.39, 1.11], [-0.23, 1.33], [0.10, 1.345], [0.49, 1.32], [0.99, 1.24], [1.20, 1.20], [1.38, 1.15],
                                        [1.48, 0.93]], 'width': 0.012, 'material': 'alu', 'height': 0.003},
        ],
        'bumpers': {
            'front': {'z': [0.50, 0.56], 'depth': 0.06, 'wrap': 0.40, 'profile': 'blade',
                      'overriders': [[0.45, 0.04, 0.45, 0.56]]},
            'rear': {'z': [0.42, 0.49], 'depth': 0.06, 'wrap': 0.35, 'profile': 'blade'},
        },
        # A round chrome mirror on the door's front corner at the window's foot (photos).
        'mirror': {'y': -0.33, 'z': 0.99, 'reach': 0.92, 'w': 0.11, 'h': 0.08, 'material': 'chrome', 'shape': 'round', 'sides': [-1]},
        'handles': {'at': [[0.20, 0.97], [1.02, 0.97]], 'w': 0.10},
        'wipers': {'arms': [[-0.6, -0.05, -0.75, 1.1], [0.05, 0.6, -0.75, 1.1]]},
        'wheel': {'style': 'hubcap', 'rimFactor': 0.66, 'cap': 0.95},
    },
}

# The drawing's overhangs (0.926 / 0.744) fall 8 cm short of length less wheelbase; its
# dimension says 1016 in front, which stood the bumper 18 cm off the nose the photos
# show it hugging. The shortfall shared in proportion: 0.970 in front.
import os as _os, sys as _sys  # noqa: E402
_sys.path.insert(0, _os.path.dirname(__file__))
from _frame import set_overhang  # noqa: E402
set_overhang(CAR, 0.970)
