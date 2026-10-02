# VAZ-2108 Sputnik, built the soviet pack's way. Sections from the factory drawing
# (build/carshape/vaz2108/grid-*.png: side y=(px-800)/383, z=(519-py)/386; front
# x=(px-655)/730, z=(956-py)/708): a wedge nose, a glasshouse leaning hard in, a crease
# along the flank, black bumpers wrapped round the ends, rectangular lamps.
SIDE = {'sill': 0.24, 'w': 0.80, 'ws': 0.76, 'sh': 0.78, 'bx': 0.71, 'bz': 0.865, 'lch': 0.04,
        'mz': 0.67, 'mh': 0.02, 'mt': 0.004}
ROOF = {'wx': 0.585, 'wz': 1.215, 'gx': 0.535, 'gz': 1.255, 'rex': 0.45, 'rez': 1.29, 'rmx': 0.24, 'rmz': 1.31, 'rz': 1.315}
HEADER = dict(ROOF, rex=0.49, rez=1.27, rmx=0.24, rmz=1.278, rz=1.28)
BACK_HEADER = dict(ROOF, wz=1.20, gz=1.24, rex=0.48, rez=1.258, rmx=0.24, rmz=1.266, rz=1.268)


def st(y, **k):
    return dict(SIDE, y=y, **k)


KIT = {
    'stations': [
        st(-1.97, yTop=-1.86, sill=0.33, w=0.76, ws=0.74, sh=0.62, bx=0.69, bz=0.70, dz=0.72, mt=0.0),
        st(-1.86, sill=0.30, ws=0.77, sh=0.70, bx=0.72, bz=0.75, dz=0.77),
        st(-1.30, sill=0.26, ws=0.77, sh=0.76, bx=0.72, bz=0.84, dz=0.87),
        st(-0.81, bx=0.71, bz=0.895, dz=0.92, deckX=[0.706, 0.665, 0.66, 0.63, 0.24, 0.0]),   # the screen's foot
        st(-0.77, **dict(ROOF, wx=0.665, wz=0.935, gx=0.66, gz=0.945, rex=0.63, rez=0.952, rmx=0.24, rmz=0.958, rz=0.96)),
        st(-0.29, **HEADER),                                                     # the screen's head
        st(-0.19, **ROOF),
        st(0.39, **ROOF),
        st(0.50, **ROOF),                                                         # the door's back edge
        st(0.57, **ROOF),
        st(1.10, **dict(ROOF, rz=1.30, rmz=1.295, rez=1.275)),
        st(1.15, **BACK_HEADER),                                                  # the hatch glass's head
        st(1.80, sill=0.27, bx=0.71, bz=0.83, dz=0.85, deckX=[0.706, 0.62, 0.60, 0.48, 0.24, 0.0]),  # its foot
        st(1.92, yTop=1.89, sill=0.30, w=0.78, ws=0.76, sh=0.68, bx=0.71, bz=0.72, dz=0.74, mt=0.0),
    ],
    'windows': [[-0.77, 0.39], [0.57, 1.80]],
    'screens': [[-0.81, -0.29], [1.15, 1.80, 'gutter']],
    'grooves': [
        {'y': -0.77, 'from': 'sill', 'to': 'belt'},
        {'y': 0.50, 'from': 'sill', 'to': 'gutter'},
        {'y0': -0.77, 'y1': 0.50, 'row': 'sill'},
        {'y': -0.81, 'from': 'win_top', 'to': 'c1'},
        {'y0': -1.86, 'y1': -0.81, 'row': 'win_top'},
    ],
    'arch': {'radius': 0.34, 'lift': 0.03},
    'ends': [
        {'end': 'front', 'z': 0.645, 'w': 0.56, 'h': 0.09, 'material': 'grille', 'proud': 0.005, 'depth': 0.02},
        {'end': 'front', 'node': 'headlights', 'x': 0.50, 'z': 0.645, 'w': 0.34, 'h': 0.13, 'material': 'Headlights',
         'proud': 0.008},
        {'end': 'front', 'node': 'front_blinker_left', 'x': 0.72, 'z': 0.645, 'w': 0.07, 'h': 0.12,
         'material': 'IndicatorLights', 'proud': 0.006},
        {'end': 'front', 'node': 'front_blinker_right', 'x': -0.72, 'z': 0.645, 'w': 0.07, 'h': 0.12,
         'material': 'IndicatorLights', 'proud': 0.006},
        {'end': 'rear', 'node': 'taillights', 'x': 0.50, 'z': 0.615, 'w': 0.40, 'h': 0.13, 'material': 'TailLights',
         'proud': 0.008},
        {'end': 'rear', 'node': 'rear_blinker_left', 'x': 0.66, 'z': 0.615, 'w': 0.08, 'h': 0.13,
         'material': 'IndicatorLights', 'proud': 0.01},
        {'end': 'rear', 'node': 'rear_blinker_right', 'x': -0.66, 'z': 0.615, 'w': 0.08, 'h': 0.13,
         'material': 'IndicatorLights', 'proud': 0.01},
        {'end': 'rear', 'node': 'reverse_lights', 'x': 0.36, 'z': 0.615, 'w': 0.10, 'h': 0.13,
         'material': 'ReverseLights', 'proud': 0.01},
    ],
    'bumpers': [
        {'end': 'front', 'z0': 0.30, 'z1': 0.53, 'depth': 0.09, 'proud': 0.0, 'wrap': 0.32, 'material': 'trim', 'bevel': 0.2},
        {'end': 'rear', 'z0': 0.30, 'z1': 0.52, 'depth': 0.09, 'proud': 0.0, 'wrap': 0.30, 'material': 'trim', 'bevel': 0.2},
    ],
    'flank': [{'y': 0.34, 'z': 0.75, 'w': 0.12, 'h': 0.025, 'material': 'trim'}],
    'mirror': {'y': -0.73, 'z': 0.93, 'w': 0.14, 'h': 0.09, 'arm': 0.03, 'material': 'trim'},
    'underbody': {'rearDrive': False},
    'wheel': {'rim': 0.62, 'cap': 0.45},
}
