"""Calibrates a car's straight side photograph by its two wheel centres.

    build/pyenv/bin/python tools/carshape/bp/sidecal.py grid  <car>                  # gridded photo to read
    build/pyenv/bin/python tools/carshape/bp/sidecal.py set   <car> uF vF uR vR rpx  # write calib.json + check
    build/pyenv/bin/python tools/carshape/bp/sidecal.py check [car ...]              # list the calibrations

`grid` writes build/carshape/_refs/photos/<car>/side-grid.jpg: the photo with a pixel
grid every 20 px (labelled every 100), to read the front (F) and rear (R) wheel centres
and the tyre's radius in pixels off. `set` stores them in calib.json and draws
calib-check.jpg: both tyres' circles, the ground one factory radius below the centres
and a 0.1 m height grid. The calibration is right only when the circles hug both tyres
and the ground line touches both contact patches; the measured tyre radius (rpx over
px per metre) is printed against the factory one. Automatic circle finding was tried
and dropped: windows, hubcaps and background wheels won too often.

Car frame from a calibration: y = frontOverhang - L/2 + (u - uF) / ppm * (sign of the
nose), z = (ground row - v) / ppm. tools/carshape/overlay.py takes uF vF uR vR.
"""
import glob
import json
import os
import runpy
import sys

from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
PH = os.path.join(ROOT, 'build/carshape/_refs/photos')


def factory(car):
    return runpy.run_path(os.path.join(ROOT, 'tools/carshape/bp/cars', car + '.py'))['CAR']['factory']


def grid(car):
    img = Image.open(os.path.join(PH, car, 'side.jpg')).convert('RGB')
    d = ImageDraw.Draw(img, 'RGBA')
    for x in range(0, img.width, 20):
        d.line([(x, 0), (x, img.height)], fill=(255, 0, 255, 120 if x % 100 == 0 else 40))
        if x % 100 == 0:
            d.text((x + 2, 2), str(x), fill=(255, 0, 255, 255))
    for y in range(0, img.height, 20):
        d.line([(0, y), (img.width, y)], fill=(0, 200, 255, 120 if y % 100 == 0 else 40))
        if y % 100 == 0:
            d.text((2, y + 2), str(y), fill=(0, 200, 255, 255))
    out = os.path.join(PH, car, 'side-grid.jpg')
    img.save(out, quality=90)
    print(out, img.size)


def setcal(car, uF, vF, uR, vR, rpx):
    F = factory(car)
    ppm = ((uR - uF) ** 2 + (vR - vF) ** 2) ** 0.5 / F['wheelbase']
    cal = {'photo': 'side.jpg', 'uF': uF, 'vF': vF, 'uR': uR, 'vR': vR, 'ppm': round(ppm, 2),
           'noseLeft': uF < uR, 'ground': round((vF + vR) / 2 + F['wheelRadius'] * ppm, 1),
           'tyreRadiusMeasured': round(rpx / ppm, 3), 'tyreRadiusFactory': F['wheelRadius']}
    json.dump(cal, open(os.path.join(PH, car, 'calib.json'), 'w'), indent=1)
    img = Image.open(os.path.join(PH, car, 'side.jpg')).convert('RGB')
    d = ImageDraw.Draw(img, 'RGBA')
    for u, v in ((uF, vF), (uR, vR)):
        d.ellipse([u - rpx, v - rpx, u + rpx, v + rpx], outline=(255, 0, 0, 255), width=2)
        d.line([(u - 6, v), (u + 6, v)], fill=(255, 0, 0, 255))
        d.line([(u, v - 6), (u, v + 6)], fill=(255, 0, 0, 255))
    g = cal['ground']
    d.line([(0, g), (img.width, g)], fill=(0, 255, 0, 255), width=2)
    z = 0.1
    while z < F['height'] + 0.15:
        d.line([(0, g - z * ppm), (img.width, g - z * ppm)], fill=(0, 255, 255, 50))
        z += 0.1
    d.text((uF + 4, vF + 4), 'F', fill=(255, 0, 0, 255))
    img.save(os.path.join(PH, car, 'calib-check.jpg'), quality=88)
    report(car)


def report(car):
    c = json.load(open(os.path.join(PH, car, 'calib.json')))
    off = c['tyreRadiusMeasured'] / c['tyreRadiusFactory'] - 1
    print(f"{car:12s} {c['ppm']:7.1f} px/m  nose {'left ' if c['noseLeft'] else 'right'}  tyre r {c['tyreRadiusMeasured']} "
          f"vs {c['tyreRadiusFactory']}{'  CHECK' if abs(off) > 0.08 else ''}")


if __name__ == '__main__':
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd == 'grid':
        grid(args[0])
    elif cmd == 'set':
        setcal(args[0], *(float(a) for a in args[1:6]))
    else:
        for p in sorted(glob.glob(os.path.join(PH, '*', 'calib.json'))):
            if not args or os.path.basename(os.path.dirname(p)) in args:
                report(os.path.basename(os.path.dirname(p)))
