"""Calibrates a roster car's drag area and steering lock on the reality bench.

    python3 tools/carshape/calibrate.py <rosterId> [rosterId ...]

Runs tools/reality.ts for the car, reads its measured top speed and turning radius,
and rewrites `dragArea` and `steerLock` in that car's record in src/vehicle/roster.ts:
drag area by the cube of the top-speed ratio (power at the top is drag-dominated),
steering lock through the tangent of the lock against the radius ratio. Repeats until
both are within 1% or four rounds have run, and prints the final bench row.
"""
import math
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ROSTER = os.path.join(ROOT, 'src/vehicle/roster.ts')
BUN = os.path.expanduser('~/.bun/bin/bun')


def bench(car):
    out = subprocess.run([BUN, 'tools/reality.ts', car], cwd=ROOT, capture_output=True, text=True).stdout
    for line in out.splitlines():
        cols = line.split()
        if cols and cols[0] == car and len(cols) > 12 and '%' in line:
            # model top real dev 0-100 real dev turn real dev ...
            return float(cols[1]), float(cols[2]), float(cols[7]), float(cols[8]), line
    raise SystemExit(f'{car}: no bench row\n{out[-2000:]}')


def record_span(text, car):
    start = text.index(f"id: '{car}'")
    end = text.index('\n  },', start)
    return start, end


def get(text, car, key):
    s, e = record_span(text, car)
    return float(re.search(rf'{key}: ([\d.]+)', text[s:e]).group(1))


def put(text, car, key, value):
    s, e = record_span(text, car)
    block = re.sub(rf'{key}: [\d.]+', f'{key}: {value}', text[s:e], count=1)
    return text[:s] + block + text[e:]


for car in sys.argv[1:]:
    for round_ in range(4):
        top, top_real, turn, turn_real, row = bench(car)
        text = open(ROSTER).read()
        ok_top = abs(top / top_real - 1) < 0.01
        ok_turn = abs(turn / turn_real - 1) < 0.01
        if ok_top and ok_turn:
            break
        if not ok_top:
            cda = get(text, car, 'dragArea') * (top / top_real) ** 3
            text = put(text, car, 'dragArea', f'{cda:.3f}')
        if not ok_turn:
            lock = get(text, car, 'steerLock')
            lock = math.atan(math.tan(lock) * (turn / turn_real) ** 1.3)
            text = put(text, car, 'steerLock', f'{lock:.3f}')
        open(ROSTER, 'w').write(text)
    print('CAL', row.strip())
