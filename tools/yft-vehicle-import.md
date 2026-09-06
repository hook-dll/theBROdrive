# GTA V add-on vehicle import (.rpf -> .yft -> GLB)

Rules for a GTA V add-on car shipped as an `.rpf` archive. `tools/import-yft-vehicle.py`
is the normalizer; it reads the archive directly, so no CodeWalker, .NET or Blender is
involved. The runtime contract is the one `tools/dff-pack-import.md` defines, minus the
hub nodes: a fragment authors its wheel as one complete object.

## What is in the archive

An add-on DLC is an RPF7 archive containing `x64/vehicles.rpf`, itself an RPF7 holding
one RSC7 resource per file. The `.yft` is a fragment:

- its **main drawable** is the whole body as ONE skinned mesh, split into geometries by
  shader, with each vertex weighted to a bone (`chassis`, `bonnet`, `door_dside_f`,
  `torpedo` for the dashboard, and so on);
- its **physics LOD children** hold the wheel, authored once and instanced by the game
  at four corners;
- `data/*.meta` describes the car for GTA, not for us. Treat it as unreliable: the
  VAZ-2110 shipped with `handling.meta` and `vehicles.meta` left over from a Camry
  template, down to the model name `cm22`. The geometry, texture and bone names are
  what identify the car.

## Keep and remove

- Keep the exterior: shell, panels, doors, bumpers, grille, glass, lamps, underbody.
- Remove the cabin, the engine bay, the damage-only and neon geometry. The body is a
  single mesh, so this is done by BONE, in `DROP_BONES` — "the dashboard" is not an
  object, it is the triangles weighted to `torpedo`.
- Remove the door cards. This pack authors them as a second shell a few centimetres
  inside the painted door skin; with the interior gone they trim nothing, and at the
  runtime's triangle budget the two coincident sheets decimate into each other and
  punch craters through the doors.
- Vehicle shaders map to runtime roles in `SHADER_ROLE`: `vehicle_paint*` -> `car_paint`,
  `vehicle_mesh`/`detail2`/`badges` -> `car_trim`, `vehicle_vehglass` -> `car_glass`,
  `vehicle_lightsemissive` -> lamps, `vehicle_interior2`/`dash_emissive` -> dropped.
- Lamp lenses authored as glass (`fars_2110`, `stfar`, `reflector`) become lamp
  material, never `car_glass`: a translucent sheet in front of an emissive lens leaves
  the lamp lighting invisibly.
- A `vehicle_lightsemissive` mesh within `LAMP_SPLIT_Y` of the centre plane is a side
  repeater or a courtesy light, not a headlamp; it ships as trim.

## Welding and production compression

The source keeps the complete exterior geometry. GTA vertices are split at every UV,
tangent and normal discontinuity, so `merge()` welds only coincident vertices whose
normals agree to within `WELD_NORMAL_COS` (40 degrees). Door edges, swage lines and
arch lips therefore keep their authored creases.

The production pipeline does not decimate the body or wheel. `gltf-transform optimize`
uses meshopt to compress vertex/index streams while preserving all 330,268 triangles.
The uncompressed intermediate is a build artefact, never a shipped runtime variant:

```
python tools/import-yft-vehicle.py extract dlc.rpf build/vaz2110
cp build/vaz2110/body.glb build/vaz2110/body-lod.glb
cp build/vaz2110/wheel.glb build/vaz2110/wheel-lod.glb
python tools/import-yft-vehicle.py assemble build/vaz2110 build/vaz2110/assembled.glb
node tools/rim-split.mjs build/vaz2110/assembled.glb build/vaz2110/rim.glb
npx gltf-transform optimize build/vaz2110/rim.glb public/models/gtav/vaz2110.glb \
  --compress meshopt --palette false --join-named false --texture-compress false
```

`assemble` bakes nothing into the wheel nodes except a half-turn about the vertical
axis on the right-hand pair — a mirror would reverse winding and normals. The wheel
assembly is then instanced at all four corners.

`extract` also writes `mounts.json` (the four axle centres in game axes) and prints the
source wheelbase, which is what the catalogue's `scale` is derived from:
`scale = real wheelbase / source wheelbase`.

## Runtime loading

The catalogue stores a small fit manifest (bounds, wheel mounts, anchors and hood
point) separately from the scene. Physics and POI layout can therefore start without
loading every visual asset. `loadCarModel(id)` owns one in-flight promise per model;
all callers share it, and the scene is cloned only after parsing and meshopt decoding
finish. Nearby active cars await this promise before constructing `Vehicle`; distant
wreck visuals attach when their chunk's asset becomes ready. A failed asset load is
reported without creating a half-initialized physics vehicle.


## Axes

GTA V is Z-up, nose +Y, driver's side -X. The game is Y-up and drives toward +Z. The
importer bakes `(x, y, z) -> (-x, z, y)`: determinant +1, so winding and normals
survive, the nose lands on +Z and the car's left flank on +X. Nothing is expressed as
catalogue `yaw`, which the wheel-detaching loader would drop.

## Required verification

1. `node tools/dff-pack-audit.mjs public/models/gtav --wheels-complete` — six material
   roles, no textures, explicit lamp nodes, four wheel nodes, positive scales,
   headlights ahead of taillights, every wheel wound outward.
2. `carModelMeasure`: four wheels, plausible radius, and wheelbase/track matching the
   real car after `scale`. The VAZ-2110 measures 2.492 m and 1.395/1.360 m against the
   factory's 2492 mm and 1400/1370 mm.
3. `runBench([id])` from `tools/handling-bench.ts` in the dev server: it must
   accelerate, brake and turn.
4. Spawn it in the game and look at both sides, the nose and the underside.
