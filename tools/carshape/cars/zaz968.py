# ZAZ-968M Zaporozhets (1979-94). Factory: 3765 x 1490 x 1370, wheelbase 2160, overhangs
# 720/890, tracks 1228/1212, 155-13, clearance 175. Read off the factory drawing
# reprinted at 3dcar.ru/blueprints/other/zaz_968m_1979 (all four views with dimension
# lines), calibrated by the wheelbase (342 px/m). A small two-door with the engine in
# the tail: a short flat bonnet over the luggage, round lamps set wide, a long engine
# lid, and the air intakes let into the rear flanks.
CAR = {
    'id': 'zaz968',
    'label': 'ZAZ-968M',
    'kind': 'saloon',
    'factory': {'length': 3.765, 'width': 1.49, 'height': 1.37, 'clearance': 0.175, 'wheelbase': 2.16,
                'frontTrack': 1.228, 'rearTrack': 1.212, 'wheelRadius': 0.29, 'tyreWidth': 0.155, 'frontOverhang': 0.72},
    'trimEnds': 0.06,
    'deck': [[-1.8225, 0.85], [-1.7, 0.875], [-1.2, 0.895], [-0.78, 0.915], [-0.4, 0.905],
             [0.8, 0.905], [1.09, 0.90], [1.3, 0.87], [1.7, 0.845], [1.8225, 0.82]],
    'belt': 0.905,
    'cabin': [-0.78, -0.35, 0.83, 1.09],
    'roof': [1.37, 1.335],
    'screenTop': 1.27,
    'crown': 0.015,
    'widths': {'waist': 0.745, 'shoulder': 0.735, 'deckEdge': 0.715, 'glassDeck': 0.65, 'glass': 0.63,
               'railDeck': 0.53, 'railPillar': 0.60, 'rail': 0.56, 'sill': 0.70},
    'planFactor': [[-1.8225, 0.95], [-1.72, 0.99], [-1.6, 1.0], [1.65, 1.0], [1.8225, 0.97]],
    'sill': [[-1.8225, 0.47], [-1.55, 0.36], [-1.3, 0.30], [1.15, 0.30], [1.5, 0.36], [1.8225, 0.40]],
    'floor': [[-1.8225, 0.45], [-1.55, 0.26], [-1.3, 0.21], [1.15, 0.21], [1.5, 0.27], [1.8225, 0.36]],
    'waistZ': 0.6,
    'shoulderDrop': 0.05,
    'shoulderRound': 0.15,
    'windows': [[[-0.54, 0.905], [-0.32, 1.27], [0.17, 1.27], [0.17, 0.905]],
                [[0.23, 0.905], [0.23, 1.27], [0.80, 1.27], [0.90, 0.92]]],
    'arch': {'radiusFactor': 1.14, 'lift': 0.02, 'wellDepth': 0.28},
    'parts': {
        'headlamps': [[0.60, 0.67, 0.088]], 'bezel': 0.014,
        'grille': {'halfWidth': 0.33, 'z': [0.64, 0.69], 'slats': 2},
        'bumper': {'depth': 0.05, 'height': 0.06, 'standOff': 0.03, 'wrap': 0.2, 'halfWidth': 0.73,
                   'zFront': 0.48, 'zRear': 0.50},
        'sideVents': [[1.12, 1.58, 0.60, 0.69]],
        'doorHandles': [[0.08, 0.84]],
        'windowFrame': 0.012,
        'lamps': [
            {'node': 'front_blinker_left', 'material': 'IndicatorLights', 'end': 'front', 'shape': 'rect', 'x': 0.36, 'z': 0.665, 'w': 0.08, 'h': 0.035},
            {'node': 'front_blinker_right', 'material': 'IndicatorLights', 'end': 'front', 'shape': 'rect', 'x': 0.36, 'z': 0.665, 'w': 0.08, 'h': 0.035},
            {'node': 'front_blinker_left', 'material': 'IndicatorLights', 'end': 'side', 'shape': 'disc', 'y': -1.45, 'z': 0.73, 'r': 0.02, 'depth': 0.012},
            {'node': 'front_blinker_right', 'material': 'IndicatorLights', 'end': 'side', 'shape': 'disc', 'y': -1.45, 'z': 0.73, 'r': 0.02, 'depth': 0.012},
            {'node': 'taillights', 'material': 'TailLights', 'end': 'rear', 'shape': 'rect', 'x': 0.56, 'z': 0.67, 'w': 0.12, 'h': 0.08},
            {'node': 'rear_blinker_left', 'material': 'IndicatorLights', 'end': 'rear', 'shape': 'rect', 'x': 0.665, 'z': 0.67, 'w': 0.09, 'h': 0.08},
            {'node': 'rear_blinker_right', 'material': 'IndicatorLights', 'end': 'rear', 'shape': 'rect', 'x': 0.665, 'z': 0.67, 'w': 0.09, 'h': 0.08},
            {'node': 'reverse_lights', 'material': 'ReverseLights', 'end': 'rear', 'shape': 'rect', 'x': 0.46, 'z': 0.67, 'w': 0.08, 'h': 0.08},
        ],
        'mirror': {'x': 0.77, 'y': -0.52, 'z': 0.97},
        'wheel': {'style': 'hubcap', 'rimFactor': 0.62},
    },
}
