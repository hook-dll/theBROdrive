"""A blueprint out of a photograph: a metric grid over a straight side, front or rear photo.

    python tools/carshape/photosheet.py side  <photo> <out.png> <car.json> uF vF uR vR
    python tools/carshape/photosheet.py end   <photo> <out.png> <car.json> uL vL uR vR [front|rear]

Needs Pillow and numpy (any Python; the scratch venv has them).

SIDE: u,v are the pixel centres of the front and rear wheels. The wheelbase between them
sets the scale, the front axle sits at the car's own y (nose at -L/2, as carbody.py
uses), and the ground is one wheel radius below the centres. A straight side photo
from a few car-lengths away is within a few centimetres of an orthographic view over
the length of the car, which is what a modeller's blueprint is.

END: u,v are the centres of the two tyres' contact patches on the ground in a straight
front or rear photo; the factory track sets the scale and the centreline is midway.
x is the car's left; on a front view that is the picture's right.

Grid every 0.1 m, labelled every 0.5 m; axes in green. Lines are read off it in
metres, in the car's frame, directly into the car's spec.
"""
import json
import sys

from PIL import Image, ImageDraw, ImageFont

mode, photo, out, spec_path = sys.argv[1:5]
coords = [float(v) for v in sys.argv[5:9]]
which = sys.argv[9] if len(sys.argv) > 9 else 'front'
F = json.load(open(spec_path))['factory']
L, R, WB = F['length'], F['wheelRadius'], F['wheelbase']
img = Image.open(photo).convert('RGB')
draw = ImageDraw.Draw(img, 'RGBA')
W_px, H_px = img.size
try:
    font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', max(12, W_px // 90))
except OSError:
    font = ImageFont.load_default()

if mode == 'side':
    uF, vF, uR, vR = coords
    px_per_m = abs(uR - uF) / WB
    direction = 1 if uR > uF else -1           # +1: nose on the left of the picture
    y_front = -L / 2 + F['frontOverhang']
    v_axle = (vF + vR) / 2

    def to_px(y, z):
        return uF + direction * (y - y_front) * px_per_m, v_axle - (z - R) * px_per_m

    y0, y1 = -L / 2 - 0.4, L / 2 + 0.4
    for k in range(int(round(y0 * 10)), int(round(y1 * 10)) + 1):
        y = k / 10
        u, _ = to_px(y, 0)
        major = k % 5 == 0
        draw.line([(u, 0), (u, H_px)], fill=(220, 30, 30, 170) if major else (60, 120, 255, 90),
                  width=2 if major else 1)
        if major:
            draw.text((u + 3, 4), f'{y:+.1f}', fill=(220, 30, 30, 255), font=font)
    for k in range(-2, 25):
        z = k / 10
        _, v = to_px(0, z)
        major = k % 5 == 0
        colour = (0, 170, 60, 220) if k == 0 else ((220, 30, 30, 170) if major else (60, 120, 255, 90))
        draw.line([(0, v), (W_px, v)], fill=colour, width=2 if major or k == 0 else 1)
        if major:
            draw.text((4, v - 16), f'z{z:.1f}', fill=(220, 30, 30, 255), font=font)
    for u, v in ((uF, vF), (uR, vR)):
        r = R * px_per_m
        draw.ellipse([u - r, v - r, u + r, v + r], outline=(0, 200, 80, 220), width=2)
    print(f'SHEET side: {px_per_m:.1f} px/m, nose {"left" if direction > 0 else "right"}')
else:
    uL, vL, uR, vR = coords
    track = F['frontTrack'] if which == 'front' else F['rearTrack']
    px_per_m = abs(uR - uL) / track
    u_mid = (uL + uR) / 2
    v_ground = (vL + vR) / 2
    sign = 1 if which == 'front' else -1       # the car's left is the picture's right from the front

    def to_px(x, z):
        return u_mid + sign * x * px_per_m, v_ground - z * px_per_m

    for k in range(-12, 13):
        x = k / 10
        u, _ = to_px(x, 0)
        major = k % 5 == 0
        draw.line([(u, 0), (u, H_px)], fill=(0, 170, 60, 220) if k == 0 else
                  ((220, 30, 30, 170) if major else (60, 120, 255, 90)), width=2 if major else 1)
        if major:
            draw.text((u + 3, 4), f'x{x:+.1f}', fill=(220, 30, 30, 255), font=font)
    for k in range(0, 25):
        z = k / 10
        _, v = to_px(0, z)
        major = k % 5 == 0
        draw.line([(0, v), (W_px, v)], fill=(0, 170, 60, 220) if k == 0 else
                  ((220, 30, 30, 170) if major else (60, 120, 255, 90)), width=2 if major else 1)
        if major:
            draw.text((4, v - 16), f'z{z:.1f}', fill=(220, 30, 30, 255), font=font)
    print(f'SHEET {which}: {px_per_m:.1f} px/m')
img.save(out)
