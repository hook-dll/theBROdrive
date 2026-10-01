#!/bin/sh
# tools/carshape/publish.sh <car> [rosterId]
# Expands tools/carshape/cars/<car>.py, builds the body with previews into
# build/carshape/<car>/, installs it as public/models/carshape/<car>.glb and, given the
# roster id, measures its fit for src/vehicle/model-fits.json.
set -e
car=$1
B=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
mkdir -p build/carshape/$car
python3 tools/carshape/archetypes.py tools/carshape/cars/$car.py build/carshape/$car/spec.json
$B --background --factory-startup --python tools/carshape/carbody.py -- build/carshape/$car/spec.json \
  build/carshape/$car/body.glb build/carshape/$car/cb.png 2>&1 | grep -E "^CARBODY|Error|Traceback" || true
cp build/carshape/$car/body.glb public/models/carshape/$car.glb
if [ -n "$2" ]; then ~/.bun/bin/bun tools/fit-models.ts $2 | tail -1; fi
