import sys, os, subprocess, json
sys.path.insert(0, 'tools/carshape/bp')
import grid, hull
car = sys.argv[1]; over = json.loads(sys.argv[2])
orig = grid.load
def patched(c):
    spec, bp = orig(c)
    spec['hull'].update(over)
    return spec, bp
grid.load = patched; hull.grid.load = patched
import io, contextlib
with contextlib.redirect_stdout(io.StringIO()):
    hull.build(car)
