# VAZ-2101, built the soviet pack's way. Sections from the factory drawing
# (build/carshape/vaz2101/grid-*.png: side y=(px-800)/386, z=(504-py)/372; front
# x=(px-650)/786, z=(1032-py)/750): slab sides with a crisp shoulder, a glasshouse set in
# from it on a ledge, chrome round the glass, a chrome grille between round lamps,
# bumpers with fangs.
SIDE = {'sill': 0.25, 'w': 0.785, 'ws': 0.765, 'sh': 0.845, 'bx': 0.655, 'bz': 0.875, 'lch': 0.04}
ROOF = {'wx': 0.60, 'wz': 1.25, 'gx': 0.58, 'gz': 1.29, 'rex': 0.50, 'rez': 1.335, 'rmx': 0.26, 'rmz': 1.355, 'rz': 1.36}
HEADER = dict(ROOF, rex=0.54, rez=1.305, rmx=0.26, rmz=1.312, rz=1.315)
REAR_HEADER = dict(ROOF, wz=1.22, gz=1.255, rex=0.53, rez=1.27, rmz=1.278, rz=1.28)


def st(y, **k):
    return dict(SIDE, y=y, **k)


DECK_AT_HOUSE = [0.651, 0.60, 0.58, 0.53, 0.26, 0.0]
KIT = {
    'stations': [
        st(-1.90, yTop=-1.87, sill=0.32, w=0.74, ws=0.74, sh=0.74, bx=0.69, bz=0.785, dz=0.795),
        st(-1.83, sill=0.28, w=0.78, ws=0.76, sh=0.80, bx=0.70, bz=0.83, dz=0.845),
        st(-1.30, bx=0.70, bz=0.855, dz=0.875),
        st(-0.98, bx=0.70, bz=0.87, dz=0.90, deckX=[0.651, 0.64, 0.635, 0.60, 0.26, 0.0]),   # the screen's foot
        st(-0.89, **dict(ROOF, wx=0.64, wz=1.0, gx=0.635, gz=1.015, rex=0.60, rez=1.03, rmx=0.26, rmz=1.04, rz=1.045)),
        st(-0.66, **HEADER),                                                     # the screen's head
        st(-0.56, **ROOF),
        st(0.0, **ROOF),
        st(0.026, **ROOF),                                                        # the doors' shared edge
        st(0.05, **ROOF),
        st(0.60, **ROOF),
        st(0.80, **dict(ROOF, rz=1.33, rmz=1.325, rez=1.31)),
        st(0.88, **dict(ROOF, rz=1.31, rmz=1.305, rez=1.29)),                    # the rear door's back edge
        st(0.91, **REAR_HEADER),                                                  # the back light's head
        st(1.27, bx=0.70, bz=0.86, dz=0.885, deckX=DECK_AT_HOUSE),                # its foot, the boot's front
        st(1.60, bx=0.70, bz=0.84, dz=0.855),
        st(1.80, sill=0.29, bx=0.70, bz=0.80, dz=0.81),
        st(1.86, yTop=1.85, sill=0.32, w=0.76, ws=0.75, sh=0.74, bx=0.69, bz=0.765, dz=0.775),
    ],
    'windows': [[-0.89, 0.0], [0.05, 0.60]],
    'screens': [[-0.98, -0.66], [0.91, 1.27, 'gutter']],
    'seal': 0.008,
    'sealMaterial': 'chrome',
    'grooves': [
        {'y': -0.89, 'from': 'sill', 'to': 'belt'},
        {'y': 0.026, 'from': 'sill', 'to': 'gutter'},
        {'y': 0.88, 'from': 'm_hi', 'to': 'gutter'},
        {'y0': -0.89, 'y1': 0.60, 'row': 'sill'},
        {'y': -0.98, 'from': 'win_top', 'to': 'c1'},
        {'y0': -1.83, 'y1': -0.98, 'row': 'win_top'},
        {'y': 1.27, 'from': 'win_top', 'to': 'c1'},
        {'y0': 1.27, 'y1': 1.80, 'row': 'win_top'},
        {'y': 1.80, 'from': 'win_top', 'to': 'c1'},
    ],
    'arch': {'radius': 0.36, 'lift': 0.03},
    'ends': [
        # the chrome grille between the round lamps, the lamps in chrome rings, the
        # blinkers under them; the tail lamps across the corners
        {'end': 'front', 'z': 0.60, 'w': 0.92, 'h': 0.21, 'material': 'chrome', 'proud': 0.006, 'depth': 0.02},
        {'end': 'front', 'z': 0.60, 'w': 0.86, 'h': 0.16, 'material': 'grille', 'proud': 0.009, 'depth': 0.02},
        {'end': 'front', 'z': 0.635, 'w': 0.86, 'h': 0.01, 'material': 'chrome', 'proud': 0.012, 'depth': 0.02},
        {'end': 'front', 'z': 0.60, 'w': 0.86, 'h': 0.01, 'material': 'chrome', 'proud': 0.012, 'depth': 0.02},
        {'end': 'front', 'z': 0.565, 'w': 0.86, 'h': 0.01, 'material': 'chrome', 'proud': 0.012, 'depth': 0.02},
        {'end': 'front', 'x': 0.61, 'z': 0.60, 'r': 0.10, 'shape': 'round', 'seg': 14, 'material': 'chrome', 'proud': 0.006},
        {'end': 'front', 'node': 'headlights', 'x': 0.61, 'z': 0.60, 'r': 0.086, 'shape': 'round', 'seg': 14,
         'material': 'Headlights', 'proud': 0.012},
        {'end': 'front', 'node': 'front_blinker_left', 'x': 0.61, 'z': 0.455, 'w': 0.12, 'h': 0.05,
         'material': 'IndicatorLights', 'proud': 0.008},
        {'end': 'front', 'node': 'front_blinker_right', 'x': -0.61, 'z': 0.455, 'w': 0.12, 'h': 0.05,
         'material': 'IndicatorLights', 'proud': 0.008},
        {'end': 'rear', 'x': 0.54, 'z': 0.60, 'w': 0.30, 'h': 0.11, 'material': 'chrome', 'proud': 0.005},
        {'end': 'rear', 'node': 'taillights', 'x': 0.585, 'z': 0.60, 'w': 0.19, 'h': 0.09, 'material': 'TailLights',
         'proud': 0.01},
        {'end': 'rear', 'node': 'rear_blinker_left', 'x': 0.45, 'z': 0.60, 'w': 0.08, 'h': 0.09,
         'material': 'IndicatorLights', 'proud': 0.01},
        {'end': 'rear', 'node': 'rear_blinker_right', 'x': -0.45, 'z': 0.60, 'w': 0.08, 'h': 0.09,
         'material': 'IndicatorLights', 'proud': 0.01},
        {'end': 'rear', 'node': 'reverse_lights', 'x': 0.67, 'z': 0.60, 'w': 0.04, 'h': 0.09,
         'material': 'ReverseLights', 'proud': 0.012},
    ],
    'bumpers': [
        {'end': 'front', 'z0': 0.355, 'z1': 0.42, 'depth': 0.05, 'proud': 0.035, 'wrap': 0.20, 'overriders': [0.38]},
        {'end': 'rear', 'z0': 0.36, 'z1': 0.425, 'depth': 0.05, 'proud': 0.035, 'wrap': 0.22, 'overriders': [0.42]},
    ],
    'flank': [
        {'y': -0.10, 'z': 0.72, 'w': 0.11, 'h': 0.025},
        {'y': 0.72, 'z': 0.71, 'w': 0.11, 'h': 0.025},
    ],
    'mirror': {'y': -0.84, 'z': 0.90, 'w': 0.10, 'h': 0.08, 'arm': 0.05, 'material': 'chrome'},
    'underbody': {'rearDrive': True},
    'wheel': {'rim': 0.62, 'cap': 0.62},
}
