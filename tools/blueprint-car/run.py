#!/usr/bin/env python3
"""Run the blueprint-to-shell stages for one car.

    python3 tools/blueprint-car/run.py tools/blueprint-car/cars/<car>.json [stage ...]

Stages, in order: refs trace shell evaluate preview compare (default: all). Each is
a Blender background run of the script of the same name; see its docstring. Needs only
the standard library -- the stages themselves run inside Blender's Python.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOOLS = Path(__file__).resolve().parent
BLENDER = os.environ.get('BLENDER', '/Applications/Blender.app/Contents/MacOS/Blender')
STAGES = ['refs', 'trace', 'shell', 'evaluate', 'preview', 'compare']

spec_path = Path(sys.argv[1]).resolve()
wanted = sys.argv[2:] or STAGES
assert set(wanted) <= set(STAGES), f'unknown stage in {wanted}; known: {STAGES}'
shell = ROOT / json.loads(spec_path.read_text())['work'] / '20-shell' / 'shell.glb'
for stage in STAGES:
    if stage not in wanted:
        continue
    extra = [str(shell)] if stage in ('evaluate', 'preview', 'compare') else []
    done = subprocess.run([BLENDER, '--background', '--factory-startup', '--python',
                           str(TOOLS / f'{stage}.py'), '--', str(spec_path), *extra],
                          cwd=ROOT, capture_output=True, text=True)
    report = [line for line in done.stdout.splitlines()
              if line.split(' ', 1)[0] in ('VIEW', 'TRACE', 'SHELL', 'SCORE', 'PREVIEW', 'CAMERA', 'COMPARE')]
    print(f'== {stage}', *report, sep='\n')
    if done.returncode or 'Traceback' in done.stdout + done.stderr:
        print(done.stdout[-3000:], done.stderr[-3000:], sep='\n')
        sys.exit(f'{stage} failed')
