# VAZ-2121 Niva, built the soviet pack's way. Sections from the factory drawing's traced
# lines (bp/cars/niva_l.py: front view x=(px-650)/655, z=(995-py)/604; side
# y=(px-800)/430, z=(649-py)/396).
SIDE = {'sill': 0.34, 'w': 0.835, 'ws': 0.815, 'sh': 0.95, 'bx': 0.79, 'bz': 1.01,
        'mz': 0.915, 'mh': 0.035, 'mt': 0.005}
ROOF = {'wx': 0.66, 'wz': 1.46, 'gx': 0.63, 'gz': 1.53, 'rex': 0.53, 'rez': 1.598, 'rmx': 0.30, 'rmz': 1.615, 'rz': 1.622}
HEADER = dict(ROOF, rex=0.58, rez=1.555, rmx=0.30, rmz=1.565, rz=1.567)


def st(y, **k):
    return dict(SIDE, y=y, **k)


KIT = {
    'stations': [
        st(-1.70, yTop=-1.67, sill=0.40, w=0.80, ws=0.79, sh=0.88, bx=0.74, bz=0.945, dz=0.96, mt=0.0),
        st(-1.62, sill=0.37, w=0.835, ws=0.82, sh=0.92, bx=0.785, bz=0.975, dz=0.995),
        st(-1.10, sill=0.34, bz=1.0, dz=1.025),
        st(-0.70, bz=1.035, dz=1.06, deckX=[0.786, 0.745, 0.74, 0.70, 0.30, 0.0]),  # the screen's foot
        st(-0.52, **dict(ROOF, wx=0.745, wz=1.16, gx=0.74, gz=1.19, rex=0.70, rez=1.215, rmx=0.30, rmz=1.24, rz=1.245)),
        st(-0.25, **HEADER),                                             # the screen's head
        st(-0.15, **ROOF),
        st(0.42, **ROOF),
        st(0.47, **ROOF),                                                # the door's back edge
        st(0.51, **ROOF),
        st(1.40, **dict(ROOF, rz=1.575, rmz=1.57, rez=1.555)),
        st(1.45, **dict(ROOF, wz=1.43, gz=1.47, gx=0.62, rex=0.57, rez=1.50, rmz=1.51, rz=1.512)),  # the tailgate's top
        st(1.72, sill=0.36, bz=1.025, dz=1.05, deckX=[0.786, 0.74, 0.72, 0.62, 0.30, 0.0]),  # the tail's top
        st(1.77, yTop=1.75, sill=0.40, w=0.80, ws=0.79, sh=0.90, bx=0.75, bz=0.975, dz=0.99, mt=0.0),
    ],
    'windows': [[-0.52, 0.42], [0.51, 1.72]],
    'screens': [[-0.70, -0.25], [1.45, 1.72, 'gutter']],
    'grooves': [
        {'y': -0.52, 'from': 'sill', 'to': 'belt'},                     # the door's front edge
        {'y': 0.47, 'from': 'sill', 'to': 'gutter'},                    # its back edge, up the pillar
        {'y0': -0.52, 'y1': 0.47, 'row': 'sill'},                       # its foot
        {'y': -0.70, 'from': 'win_top', 'to': 'c1'},                    # the bonnet's back edge
        {'y0': -1.62, 'y1': -0.70, 'row': 'win_top'},                   # its sides
    ],
    'arch': {'radius': 0.40, 'lift': 0.05},
    'archLips': [{'w': 0.05, 't': 0.022}],
    'ends': [
        {'end': 'front', 'z': 0.632, 'w': 1.52, 'h': 0.29, 'material': 'grille', 'proud': 0.004, 'depth': 0.02},
        {'end': 'front', 'z': 0.69, 'w': 0.84, 'h': 0.012, 'material': 'grey', 'proud': 0.008, 'depth': 0.02},
        {'end': 'front', 'z': 0.65, 'w': 0.84, 'h': 0.012, 'material': 'grey', 'proud': 0.008, 'depth': 0.02},
        {'end': 'front', 'z': 0.61, 'w': 0.84, 'h': 0.012, 'material': 'grey', 'proud': 0.008, 'depth': 0.02},
        {'end': 'front', 'z': 0.57, 'w': 0.84, 'h': 0.012, 'material': 'grey', 'proud': 0.008, 'depth': 0.02},
        {'end': 'front', 'x': 0.585, 'z': 0.632, 'r': 0.112, 'shape': 'round', 'seg': 14, 'material': 'chrome',
         'proud': 0.008},
        {'end': 'front', 'node': 'headlights', 'x': 0.585, 'z': 0.632, 'r': 0.098, 'shape': 'round', 'seg': 14,
         'material': 'Headlights', 'proud': 0.014},
        {'end': 'front', 'node': 'front_blinker_left', 'x': 0.64, 'z': 0.84, 'w': 0.10, 'h': 0.06,
         'material': 'IndicatorLights', 'proud': 0.008},
        {'end': 'front', 'node': 'front_blinker_right', 'x': -0.64, 'z': 0.84, 'w': 0.10, 'h': 0.06,
         'material': 'IndicatorLights', 'proud': 0.008},
        {'end': 'front', 'x': 0.53, 'z': 0.84, 'w': 0.08, 'h': 0.06, 'material': 'Headlights', 'proud': 0.008},
        # the tail lamps in the corners, as the pack's Niva has them
        {'end': 'rear', 'node': 'taillights', 'x': 0.56, 'z': 0.68, 'w': 0.20, 'h': 0.09, 'material': 'TailLights',
         'proud': 0.012},
        {'end': 'rear', 'x': 0.56, 'z': 0.68, 'w': 0.22, 'h': 0.11, 'material': 'grey', 'proud': 0.006},
        {'end': 'rear', 'node': 'rear_blinker_left', 'x': 0.505, 'z': 0.68, 'w': 0.06, 'h': 0.085,
         'material': 'IndicatorLights', 'proud': 0.014},
        {'end': 'rear', 'node': 'rear_blinker_right', 'x': -0.505, 'z': 0.68, 'w': 0.06, 'h': 0.085,
         'material': 'IndicatorLights', 'proud': 0.014},
        {'end': 'rear', 'node': 'reverse_lights', 'x': 0.62, 'z': 0.68, 'w': 0.05, 'h': 0.085,
         'material': 'ReverseLights', 'proud': 0.014},
    ],
    'bumpers': [
        {'end': 'front', 'z0': 0.38, 'z1': 0.49, 'depth': 0.07, 'proud': 0.04, 'wrap': 0.16, 'material': 'grey'},
        {'end': 'rear', 'z0': 0.425, 'z1': 0.55, 'depth': 0.07, 'proud': 0.04, 'wrap': 0.16, 'material': 'grey'},
    ],
    'flank': [{'y': 0.30, 'z': 0.99, 'w': 0.13, 'h': 0.025, 'material': 'grey'}],
    'mirror': {'y': -0.47, 'z': 1.07, 'w': 0.12, 'h': 0.08, 'arm': 0.03},
    'underbody': {'rearDrive': True},
    'wheel': {'rim': 0.62, 'cap': 0.4},
}
