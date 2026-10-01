# VAZ-2101 (1970): the Fiat 124 shell (tools/carshape/cars/fiat124.py, measured on a
# straight profile) with the Zhiguli's own height, clearance, bumpers and lamps.
# Factory: 4073 x 1611 x 1382, wheelbase 2424, tracks 1349/1305, 155 R13, clearance 170.
# Overhangs measured on 'Moscow car show 2025-08-03 VAZ-2101 white 03.jpg' (CC0,
# 415 px/m): 0.52 m nose to front axle without the bumper, 0.62 m with it.
# Lamps and wheels from the straight front and rear photographs of an unrestored car:
# 'VAZ-2101 beige colored (front view).jpg', '(rear view).jpg' (CC BY-SA 4.0,
# Kirill Borisenko) and 'Moscow car meet 2025-07-12 VAZ-2101 02.jpg' (CC0).
import runpy
from pathlib import Path

base = runpy.run_path(str(Path(__file__).with_name('fiat124.py')))['CAR']
CAR = dict(base)
CAR['id'] = 'vaz2101'
CAR['label'] = 'VAZ-2101'
CAR['factory'] = {'length': 4.073, 'width': 1.611, 'height': 1.382, 'clearance': 0.17, 'wheelbase': 2.424,
                  'frontTrack': 1.349, 'rearTrack': 1.305, 'wheelRadius': 0.297, 'tyreWidth': 0.155, 'frontOverhang': 0.63}
CAR['trimEnds'] = 0.10
# The Zhiguli sits on stiffer, longer springs: the same shell lifted 4 cm, under a roof
# that ends at the catalogue's 1382 mm.
lift = 0.03
CAR['deck'] = [[y, round(z + lift, 4)] for y, z in base['deck']]
CAR['belt'] = base['belt'] + lift
CAR['roof'] = [1.375, 1.315]
CAR['screenTop'] = 1.29
CAR['sill'] = [[y, round(z + 0.04, 4)] for y, z in base['sill']]
CAR['floor'] = [[y, round(z + 0.04, 4)] for y, z in base['floor']]
CAR['waistZ'] = base['waistZ'] + lift
CAR['windows'] = [[[y, round(min(z + lift, 1.29), 4)] for y, z in w] for w in base['windows']]
CAR['widths'] = dict(base['widths'], waist=0.80, shoulder=0.79, deckEdge=0.77)
P = dict(base['parts'])
P['headlamps'] = [[0.6, 0.665, 0.088]]
P['grille'] = {'halfWidth': 0.49, 'z': [0.58, 0.75], 'slats': 8}
P['bumper'] = {'depth': 0.06, 'height': 0.07, 'standOff': 0.03, 'wrap': 0.22, 'halfWidth': 0.80, 'zFront': 0.465, 'zRear': 0.50}
P['overriders'] = {'x': 0.33, 'height': 0.17, 'width': 0.04}
P['frontSlots'] = [[0.06, 0.20, 0.515, 0.54], [0.24, 0.38, 0.515, 0.54]]
P['lamps'] = [
    {'node': 'front_blinker_left', 'material': 'FrontLampLens', 'end': 'front', 'shape': 'rect', 'x': 0.6, 'z': 0.55, 'w': 0.12, 'h': 0.045},
    {'node': 'front_blinker_right', 'material': 'FrontLampLens', 'end': 'front', 'shape': 'rect', 'x': 0.6, 'z': 0.55, 'w': 0.12, 'h': 0.045},
    {'node': 'front_blinker_left', 'material': 'IndicatorLights', 'end': 'side', 'shape': 'disc', 'y': -1.72, 'z': 0.70, 'r': 0.022, 'depth': 0.012},
    {'node': 'front_blinker_right', 'material': 'IndicatorLights', 'end': 'side', 'shape': 'disc', 'y': -1.72, 'z': 0.70, 'r': 0.022, 'depth': 0.012},
    {'node': 'taillights', 'material': 'TailLights', 'end': 'rear', 'shape': 'rect', 'x': 0.53, 'z': 0.68, 'w': 0.15, 'h': 0.095},
    {'node': 'rear_blinker_left', 'material': 'IndicatorLights', 'end': 'rear', 'shape': 'rect', 'x': 0.67, 'z': 0.68, 'w': 0.13, 'h': 0.095},
    {'node': 'rear_blinker_right', 'material': 'IndicatorLights', 'end': 'rear', 'shape': 'rect', 'x': 0.67, 'z': 0.68, 'w': 0.13, 'h': 0.095},
    {'node': 'reverse_lights', 'material': 'ReverseLights', 'end': 'rear', 'shape': 'rect', 'x': 0.62, 'z': 0.585, 'w': 0.085, 'h': 0.055},
]
P['mirror'] = {'x': 0.84, 'y': -0.72, 'z': 1.0}
P['wheel'] = {'style': 'steel', 'windows': 6, 'rimFactor': 0.7}
CAR['parts'] = P
