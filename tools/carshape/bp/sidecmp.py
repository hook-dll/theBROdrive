"""The built body beside its calibrated side photograph, at the same scale and axle.

    build/pyenv/bin/python tools/carshape/bp/sidecmp.py <car> [glb]

Needs build/carshape/_refs/photos/<car>/calib.json (sidecal.py). Renders the body
orthographically at the photo's own px per metre (tools/carshape/overlay.py) and writes
build/carshape/_audit/cmp/<car>.jpg: three rows over the same span, front axles on
one vertical line - the photograph, the model shaded (paint grey, glass dark, trim as
built), and the model's outline and glass drawn over the photograph. Pillars, window
heads and feet, shut lines, lamps and the silhouette are compared row against row.
"""
import json
import os
import runpy
import subprocess
import sys

from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
car = sys.argv[1]
glb = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'public/models/carshape', car + '.glb')
ph = os.path.join(ROOT, 'build/carshape/_refs/photos', car)
c = json.load(open(os.path.join(ph, 'calib.json')))
F = runpy.run_path(os.path.join(ROOT, 'tools/carshape/bp/cars', car + '.py'))['CAR']['factory']
out_dir = os.path.join(ROOT, 'build/carshape/_audit/cmp')
os.makedirs(out_dir, exist_ok=True)
ov = os.path.join(out_dir, car + '-ov.png')
subprocess.run(['/Applications/Blender.app/Contents/MacOS/Blender', '--background', '--factory-startup', '--python',
                os.path.join(ROOT, 'tools/carshape/overlay.py'), '--', glb,
                os.path.join(ROOT, 'build/carshape', car, 'spec.json'), os.path.join(ph, c['photo']), ov,
                str(c['uF']), str(c['vF']), str(c['uR']), str(c['vR'])], check=True, capture_output=True)
ppm = c['ppm']
L, R = F['length'], F['wheelRadius']
nose_right = c['uF'] > c['uR']
shaded = Image.open(ov.replace('.png', '-shaded.png')).convert('RGBA')
mw, mh = shaded.size
span_z = F['height'] + 0.4
cz = span_z / 2 - 0.2
y_front = -L / 2 + F['frontOverhang']
mx = mw / 2 + (1 if nose_right else -1) * (-y_front) * ppm
my = mh / 2 - (R - cz) * ppm
ox, oy = int(round(c['uF'] - mx)), int(round(c['vF'] - my))
photo = Image.open(os.path.join(ph, c['photo'])).convert('RGB')
crop = photo.crop((ox, oy, ox + mw, oy + mh))
over = Image.open(ov).convert('RGB').crop((ox, oy, ox + mw, oy + mh))
bg = Image.new('RGB', (mw, mh), (215, 205, 185))
bg.paste(shaded, (0, 0), shaded)
o = Image.new('RGB', (mw, 3 * mh))
for i, im in enumerate((crop, bg, over)):
    o.paste(im, (0, i * mh))
d = ImageDraw.Draw(o)
for k in range(3):
    # front axle and ground on every row, and a vertical every 0.5 m from the front axle
    x0 = c['uF'] - ox
    for j in range(-12, 13):
        x = x0 + j * 0.5 * ppm
        if 0 <= x < mw:
            d.line([(x, k * mh), (x, k * mh + 8)], fill=(255, 0, 0))
    g = c['ground'] - oy + k * mh
    d.line([(0, g), (mw, g)], fill=(0, 160, 0))
d.text((4, 4), f'{car} photo / model / outline over photo  ({ppm:.0f} px/m, ticks every 0.5 m from the front axle)',
       fill=(255, 0, 0))
dst = os.path.join(out_dir, car + '.jpg')
o.save(dst, quality=90)
print(dst, o.size)
