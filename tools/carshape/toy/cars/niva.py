# VAZ-2121 Niva as a toy: a tall short box on big wheels, a glasshouse leaning in over a
# shoulder ledge, round lamps in a black grille panel, chrome blade bumpers. Shapes from
# the factory drawing's traced lines (bp/cars/niva_l.py), simplified.
TOY = {
    'bodyDefaults': {'crown': 0.015, 'tumble': 0.03, 'ch': 0.035},
    'body': [
        {'y': -1.70, 'yTop': -1.66, 'w': 0.79, 'sill': 0.38, 'sh': 0.88, 'top': 0.97},
        {'y': -1.60, 'w': 0.84, 'sill': 0.36, 'sh': 0.89, 'top': 1.00},
        {'y': -0.70, 'w': 0.84, 'sill': 0.33, 'sh': 0.89, 'top': 1.05},
        {'y': 1.62, 'w': 0.84, 'sill': 0.35, 'sh': 0.89, 'top': 1.04},
        {'y': 1.77, 'yTop': 1.74, 'w': 0.80, 'sill': 0.40, 'sh': 0.88, 'top': 1.02},
    ],
    # screen foot, screen head, door glass, B pillar, quarter glass, C pillar, back light
    'house': [
        {'y': -0.70, 'belt': 1.03, 'bw': 0.78, 'gutter': 1.045, 'rw': 0.77, 'roof': 1.05},
        {'y': -0.25, 'belt': 1.03, 'bw': 0.78, 'gutter': 1.53, 'rw': 0.64, 'roof': 1.60},
        {'y': 0.42, 'belt': 1.03, 'bw': 0.78, 'gutter': 1.53, 'rw': 0.64, 'roof': 1.60},
        {'y': 0.51, 'belt': 1.03, 'bw': 0.78, 'gutter': 1.53, 'rw': 0.64, 'roof': 1.60},
        {'y': 1.34, 'belt': 1.03, 'bw': 0.78, 'gutter': 1.51, 'rw': 0.64, 'roof': 1.56},
        {'y': 1.45, 'belt': 1.03, 'bw': 0.775, 'gutter': 1.47, 'rw': 0.63, 'roof': 1.52},
        {'y': 1.72, 'belt': 1.03, 'bw': 0.76, 'gutter': 1.04, 'rw': 0.75, 'roof': 1.045},
    ],
    'windows': [[-0.25, 0.42], [0.51, 1.34]],
    'frame': 0.03,
    'screenFrame': 0.045,
    'backLightFrame': 0.07,
    'arch': {'radius': 0.40, 'lift': 0.05},
    'ends': [
        # the black panel across the nose, the grille in it, round lamps, the corner lamps
        {'end': 'front', 'z': 0.632, 'w': 1.46, 'h': 0.27, 'material': 'grille', 'proud': 0.006},
        {'end': 'front', 'z': 0.632, 'w': 0.84, 'h': 0.03, 'material': 'chrome', 'proud': 0.012, 'depth': 0.02},
        {'end': 'front', 'z': 0.55, 'w': 0.84, 'h': 0.03, 'material': 'chrome', 'proud': 0.012, 'depth': 0.02},
        {'end': 'front', 'z': 0.71, 'w': 0.84, 'h': 0.03, 'material': 'chrome', 'proud': 0.012, 'depth': 0.02},
        {'end': 'front', 'node': 'headlights', 'x': 0.575, 'z': 0.632, 'r': 0.09, 'shape': 'round', 'seg': 14,
         'material': 'Headlights', 'proud': 0.02},
        {'end': 'front', 'x': 0.575, 'z': 0.632, 'r': 0.105, 'shape': 'round', 'seg': 14, 'material': 'chrome',
         'proud': 0.012},
        {'end': 'front', 'node': 'front_blinker_left', 'x': 0.64, 'z': 0.84, 'w': 0.11, 'h': 0.07,
         'material': 'IndicatorLights', 'proud': 0.012},
        {'end': 'front', 'node': 'front_blinker_right', 'x': -0.64, 'z': 0.84, 'w': 0.11, 'h': 0.07,
         'material': 'IndicatorLights', 'proud': 0.012},
        {'end': 'front', 'x': 0.52, 'z': 0.84, 'w': 0.11, 'h': 0.07, 'material': 'Headlights', 'proud': 0.012},
        # the tail: a black band with the clusters at its ends
        {'end': 'rear', 'z': 0.66, 'w': 1.34, 'h': 0.16, 'material': 'grille', 'proud': 0.006},
        {'end': 'rear', 'node': 'taillights', 'x': 0.58, 'z': 0.66, 'w': 0.12, 'h': 0.12, 'material': 'TailLights',
         'proud': 0.014},
        {'end': 'rear', 'node': 'rear_blinker_left', 'x': 0.46, 'z': 0.66, 'w': 0.11, 'h': 0.12,
         'material': 'IndicatorLights', 'proud': 0.014},
        {'end': 'rear', 'node': 'rear_blinker_right', 'x': -0.46, 'z': 0.66, 'w': 0.11, 'h': 0.12,
         'material': 'IndicatorLights', 'proud': 0.014},
        {'end': 'rear', 'node': 'reverse_lights', 'x': 0.36, 'z': 0.66, 'w': 0.07, 'h': 0.12,
         'material': 'ReverseLights', 'proud': 0.014},
    ],
    'bumpers': [
        {'end': 'front', 'z0': 0.38, 'z1': 0.49, 'depth': 0.07, 'proud': 0.05, 'wrap': 0.16},
        {'end': 'rear', 'z0': 0.425, 'z1': 0.55, 'depth': 0.07, 'proud': 0.05, 'wrap': 0.16},
    ],
    'flank': [
        {'y': 0.30, 'z': 0.99, 'w': 0.14, 'h': 0.025},                                   # door handle
        {'y': 0.03, 'z': 0.915, 'w': 3.1, 'h': 0.02, 'material': 'trim', 'proud': 0.004},  # moulding
    ],
    'doors': [{'y0': -0.52, 'y1': 0.47, 'z0': 0.42}],
    'mirror': {'y': -0.18, 'z': 1.07, 'w': 0.15, 'h': 0.10, 'arm': 0.05},
    'underbody': {'rearDrive': True},
    'wheel': {'rim': 0.62, 'cap': 0.4},
}
