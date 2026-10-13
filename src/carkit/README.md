# carkit: VAZ cars generated at load time, interior included

`src/carkit` builds a car from a numeric spec as a `THREE.Group`, the same scene a GLB/FBX
loader would return. From there the car goes through the usual pipeline in
`render/carmodel.ts` (`buildTemplate`), so it gets paint, dust, scratches, stickers, glass
dirt, lamps and fitting to the factory dimensions on the same terms as every other model.

Status: stage 1. Two cars (`kit_vaz2106`, `kit_vaz2108`) are shown in the car lab only:
`/?car-lab&pack=Kit`. They are absent from traffic, the garage, spawns and POIs.

## Vision (agreed with the owner)

- Low poly with flat faces, the game's current lighting and palette, no outlines.
- Real factory proportions, simplified shape. No caricature.
- The body is **not stacked boxes**: a tub lofted along cross-sections plus a greenhouse
  with raked pillars. Shut lines are real panel gaps.
- Interior is mandatory and works:
  - visible through clear glass;
  - doors, bonnet, boot/tailgate and fuel flap open;
  - live controls: wheel, pedals, gear lever, handbrake, needles, stalks, wipers;
  - clickable fittings: lights, indicators, hazards, horn, window cranks, quarter lights,
    glovebox, sun visors, ashtray, radio, seats (slide, backrest recline, head restraints).
- The bonnet and boot open. The boot shows **empty**: items stay on the existing grid.
  Later the bonnet grid gets rearranged: engine large and central, other parts at the sides.
- Budget: about 8–10k triangles per car with LOD. Past 25 m the cabin, engine bay, boot and
  underbody are not drawn, and the glass turns back into an opaque mirror.
- Dust, scratches and stickers on the body must keep working, as on the current cars.
- Headlamps, tail lamps, brake lamps, indicators and reversing lamps must work.
- Doors are not short-changed: the rear door is the size it is on the real car, not shrunk
  the way the reference video does it.
- The model list to cover: 2101, 2102, 2103, 2104, 2105, 2106, 2107, 2108, 2109, 21099,
  2110, 2112, 2115, 2121, 2131, 1111.

## Stages

1. ✅ Generator core, 2106 and 2108 in car-lab, hover and click.
2. A "Get in" button in car-lab: camera at the driver's seat, keys turn the wheel and press
   the pedals, clicks on fittings from inside.
3. The remaining 14 cars from specs (see "Telling the classics apart" below).
4. Driving for real on the playground with the running gear of the existing VAZ models;
   catalogue entries for 2112 and 2115.
5. Owner's call: replace the old models in the world, rearrange the bonnet grid, transfer
   stickers to doors.

## Frame of reference

- A spec is in metres. `s` is the distance **rearward from the tip of the front bumper**,
  `y` is height above the ground under the tyres, `x` is the car's left (the driver sits at +x).
- The scene is in the game frame: +Z forward, +X left, +Y up. Conversion:
  `BodyFrame.z(s) = length/2 − s`.
- The loader then scales the body to the passport width, length and height
  (`FACTORY_GEOMETRY` in `vehicle/carmodels.ts`). Drawings sit a little lower than the
  passport figures (2101 is 1382 against 1440), so the car grows by those few percent as a
  whole and its proportions stay those of the drawing.

## Modules

| File | What it does |
|---|---|
| `spec.ts` | Spec types: `KitCarSpec`, `TubStation`, `CabinSpec`, `CabinColumn`, `WheelSpec`, `KitLook`. |
| `specs.ts` | Car numbers (`KIT_SPECS`), each with a comment saying where it was measured. |
| `builder.ts` | `PartBuilder`: flat triangles per material slot, transform stack, primitives (`box`, `bevelBox`, `extrude`, `cylinderX/Y/Z`, `torusY`, `bridge`), vertex colours. |
| `body.ts` | `BodyFrame` (cross-section and height lookups) and `buildShell`: tub, greenhouse and roof as one face list, then cut into parts. |
| `exterior.ts` | Bumpers (swept round the corners), grille, lamps, mirrors, handles, wipers, filler neck. |
| `interior.ts` | Interior: trim, dashboard, gauges, wheel, pedals, levers, seats, door cards. Per-platform layout table `LAYOUTS`. |
| `bay.ts` | Engine bay (`kit_bay`), boot (`kit_boot`), underbody (`kit_under`). |
| `wheels.ts` | Wheel: lathed tyre, steel rim, hubcap. |
| `materials.ts` | One shared material per slot. |
| `names.ts` | Node names the catalogue selects by (wheels, lamps, glass). No imports, so the catalogue can include it. |
| `context.ts` | `KitContext`, `addBuilt`, `pivotGroup`, `attach`: how modules put geometry into the scene. |
| `kit.ts` | `buildKitCar(id)`: assembles everything; motion parameters of the shell's parts. |
| `rig.ts` | `KitRig`: runtime channels, controls, lamps, LOD. |

Integration outside the folder:

- `vehicle/carmodels.ts`: `CarModelDef.kit` (build from a spec instead of reading `file`),
  `CarModelDef.clearGlass`, the `KIT_CARS` list on the running gear of their `sv_*` siblings,
  and `LAB_CAR_MODELS` (resolvable through `carModel(id)` but absent from `CAR_MODELS`,
  which feeds traffic and spawns).
- `render/carmodel.ts`: `loadModel` calls `buildKitCar`. Clear glass comes from
  `carClearGlassMaterial`. A cabin mesh with `userData.kitShadowed` receives shadows.
- `render/materials.ts`: dust on glass raises opacity, so dirty clear glass is not
  see-through. On opaque glass this changes nothing.
- `car-lab.ts`: the Kit row, the `?pack=` filter, hover and click, the "КАБИНА" panel, LOD at
  25 m, `__carLab.look(...)` / `__carLab.kit(id)`.
- `vehicle/model-fits.json`: rows for `kit_vaz2106` / `kit_vaz2108` (`bun tools/fit-models.ts <id>`).

## How the body is built

1. **Tub.** `stations` are half cross-sections along `s`:
   - `sill`: underside of the sill;
   - `crease`: the widest line along the side;
   - `belt`: where the side turns in towards the shoulder;
   - `deck`: bonnet or boot height on the centre line;
   - `wSill / wCrease / wBelt`: half-widths.

   The shoulder (`shoulder.inset/rise`) leads to the edge of the deck. The deck has a
   parabolic crown. Every column has the same set of rows (sill, the cut lines for the door
   and flap, crease, belt), so neighbouring columns pair up row by row and the shut lines
   come out straight.
2. **Arches.** The radius is `wheels.radius × wheels.arch`. The bottom row of the side sits
   on the arch. Rows below the **arch lip** (`ARCH_LIP` above the arch) are raised onto it,
   so a door that reaches over the wheel gets its cut-out automatically. The wheel arch
   liners are dark.
3. **Greenhouse.** `cabin.columns` are side columns from the windscreen corner to the back
   light corner. `s` is where the column stands on the belt; `top` is where it meets the
   roof (`top ≠ s` gives a raked pillar). Each column describes the strip after it:
   - `upper` / `lower`: who owns the area above and below the belt (`body`, `door1`, `door2`);
   - `glass`: `none`, `drop` (wind-down), `vent` (quarter light) or `fixed`.

   The windscreen and back light sit between the deck's edge and the roof rail. A hatchback
   has a crease in the tailgate (`rearKnee`).
4. **Cutting.** Faces are grouped by owner:
   - owners: `body`, `door_fl/fr/rl/rr`, `bonnet`, `boot`, `tailgate`, `flap`, `window_*`,
     `vent_*`;
   - gaps: each opening part's edge pulls in by half a gap (`SHUT_GAP`) and the body's edge
     pushes out by the other half;
   - jamb flanges go on the body (`JAMB_DEPTH`), end faces and an inner skin go on the
     parts (`DOOR_THICKNESS`, `LID_THICKNESS`);
   - the door card below the belt is in the upholstery colour;
   - glass is recessed (`GLASS_INSET`) and edged with dark rubber.
5. **Hinges.** Pivots come from each part's geometry:
   - door: its front edge;
   - bonnet: rear edge;
   - boot lid: front edge;
   - tailgate: top edge;
   - flap: front edge;
   - quarter light: rear post;
   - drop glass: its own bottom edge.

   The glass rides inside its door.

## Scene contract

- Wheels: nodes `kit_wheel_fl/fr/rl/rr` (`KIT_WHEEL_NODES`).
- Lamps: one mesh per role, named by slot. The def's `lights` selects them:

  | Role | Mesh name |
  |---|---|
  | head | `kit_head` |
  | tail | `kit_tail` |
  | brake | `kit_brake` |
  | reverse | `kit_reverse` |
  | indicator left | `kit_blink_l` |
  | indicator right | `kit_blink_r` |
  | never switched | `rear_passive` |
- Paint: material `paint`. Only it takes colour, dust, scratches and stickers. Every other
  name (`trim`, `chrome`, `tyre`, `wheel_rim`, `glass`, `lamp_*`) is filtered out by the
  paint-slot rule.
- Glass: material `glass` (= `glassMaterial`). With `clearGlass` it becomes the shared
  `car-glass-clear`.
- Steering wheel: node `steering_wheel`, its origin on the column axis, local +Y along the
  column towards the driver. The game turns it by `rotation.y`.
- Mirrors: meshes named `mirrors`, which keeps them out of the measured body width.
- Detail groups for LOD: `kit_cabin` (on the root and inside every door), `kit_bay`,
  `kit_boot`, `kit_under`.

## Controls and channels (`rig.ts`)

A node that moves carries `userData.kitMotion = { channel, kind: 'rot'|'pos', axis, amount }`.
The motion is applied from the built pose: angle or offset = `amount × channel value`, along
an axis in the parent's frame.

A node that can be clicked carries
`userData.kitControl = { id, label, action? }`, where `action` is one of:
- `toggle` (the default, flips the channel `id`);
- `cycle` (steps through values);
- `press` (held down, as the horn is).

A click on any mesh below the node counts.

Channels (shared names; the driving inputs are what a vehicle will feed in stage 4):

| Group | Channels |
|---|---|
| Driving | `steer` −1..1, `throttle`, `brake`, `clutch`, `handbrake` 0..1, `gear` −1..5 |
| Derived from `gear` | `gear_fb`, `gear_lr` (H-pattern, `GEAR_GATE`) |
| Instruments | `speed` km/h, `rpm`, `fuel`, `temp` 0..1 |
| Light and signals | `lights` 0/1/2, `blinker` −1/0/1, `hazard`, `horn` |
| Wipers and radio | `wipers` 0/1/2 → `wiper_sweep`; `radio` → `radio_tune` |
| Body | `door_*`, `bonnet`, `boot`, `tailgate`, `flap`, `window_*`, `vent_*` |
| Cabin | `glovebox`, `ashtray`, `visor_l/r`, `seat_*`, `seatback_*`, `headrest_*` |

Lamps in the lab are lit by the rig from the channels:
- low/high beam from `lights`;
- tail lamps from `lights`;
- brake lamps from `brake`;
- reversing lamps from `gear < 0`;
- indicators from `blinker` and `hazard`, at 90 flashes a minute.

In the game this is done by `VehicleLamps` through the def's `lights`. The rig is then
created with `ownLenses = false`.

`setDetail(near)` switches only the visibility of the groups and the glass opacity, so
crossing the LOD distance triggers no shader compile.

## Lab

- `/?car-lab&pack=Kit&time=12`: only the kit row.
- Hovering shows a part's name; a click works it. A drag is the camera, not a click.
- Choosing a car in the list opens the "КАБИНА" panel on the right: sliders for the driving
  inputs and a button per clickable part.
- Automation:
  - `__carLab.focus(id, azimuth, elevation, distance)`;
  - `__carLab.look(id, [camera], [target])`, coordinates relative to the car;
  - `__carLab.kit(id).set(channel, v)`, `.activate(controlId)`, `.controls()`;
  - `__carLab.capture()`.
- Run your own Vite on a different port (`npx vite --port 5199 --strictPort`); 5173 is the
  owner's. Close the tab and stop the server when you finish.

## Where the numbers come from

Proportions come from the factory four-view drawings in `build/carshape/_refs/bp/img`
(`vaz2101.jpg`, `vaz2108.jpg`; there are also `niva.jpg`, `fiat124.jpg`, …), photos from
`build/carshape/_refs/photos`.

Method:
- crop the side view with a 20 px grid;
- the scale is the drawing's own overall-length dimension;
- `s` from the tip of the bumper, heights from the ground line.

What gets measured:
- overhangs and wheelbase;
- the bonnet lip and the cowl;
- windscreen and back light;
- the roof: front edge, rear edge, height;
- sill, door bottom edge, belt, glass, rain gutter;
- the borders of every door;
- the boot and its tail.

Write the source in the comment above each spec. Comparing by eye cost a whole iteration:
the first 2106 had a front overhang 0.8 m instead of 0.6 and doors that were too small.

## Telling the classics apart: 2101 / 2103 / 2105 / 2106 / 2107

The silhouette barely separates the 2101, 2103 and 2106: they share one body and differ by
about 50 mm in length (bumpers). They are recognised by the face, the tail, the trim and the
dashboard. The 2105 and 2107 share their own, squarer body. So the work splits into "shape"
and "trim".

| | 2101 | 2103 | 2106 | 2105 | 2107 |
|---|---|---|---|---|---|
| Body | 124 | 124 | 124 | squared ("05") | squared ("05") |
| Headlamps | 2 round in a wide chrome grille | 4 round in one chrome grille | 4 round in black surrounds, plastic grille | rectangular units, black grille | rectangular units, tall chrome grille standing out |
| Bumpers | thin chrome with overriders ("fangs") | chrome with a rubber strip | chrome with plastic end caps | aluminium with plastic ends | chrome with plastic ends |
| Tail lamps | small, at the corners | horizontal, with chrome surrounds | large clusters with reversing lamps | large, wrapping round the corner | as the 2105 |
| Side | chrome on the arches and sill | same + moulding | moulding with an insert, repeater on the wing | wide black moulding | as the 2105 |
| Quarter lights | yes | yes | yes | no | no |
| Head restraints | no | no | yes | yes | yes |
| Dashboard | flat, ribbon speedometer | round gauges, wood-look panel | as the 2103 | its own, rectangular cluster | large "euro" panel with tachometer |

What the generator can do today:
- the shape: different `stations`/`cabin` give the "05" body (sharper side crease, flat
  bonnet and boot, wide C-pillar);
- doors, quarter lights and head restraints are already per-model flags.

What it cannot do yet:
- `KitLook` has only enums (`headlamps: 'twin-round' | 'rect'`,
  `taillamps: 'classic' | 'samara'`, `bumpers: 'chrome' | 'plastic'`);
- the interior's `LAYOUTS` are per platform.

As things stand the 2101, 2103 and 2106 would come out identical.

Next step: replace the enums with descriptions.
- **Face**: the lamp list (shape, size, position), grille (type, width, height, how far it
  stands out, chrome/black), indicators.
- **Tail**: the cluster's cells (role, shape, grid), surround.
- **Bumper**: profile, ends, overriders, strip.
- **Side**: mouldings, repeaters, handles.
- **Interior**: `LAYOUTS` become "platform + per-model overrides" (dashboard shape, gauge
  set, wheel).

Then each of the five classics is a spec of about 60 lines with no new code, and the same
applies to 2109/21099/2115, 2110/2112 and 2121/2131.

## Budget and current figures

| | Total | Body + trim | Interior | Engine bay | Boot | Underbody | Wheels |
|---|---|---|---|---|---|---|---|
| 2106 | 12.2k | 5.3k | 3.1k | 1.05k | 0.3k | 0.75k | 1.6k |
| 2108 | 10.7k | 3.8k | 3.2k | 1.25k | 0.04k | 0.6k | 1.8k |

Beyond 25 m about 7k remain. Lowest point of the body: 0.170 m, the factory ground clearance.

## Known gaps

- Stickers: `stampCarBodyPositions` stamps vertices in the closed pose and the decal is
  attached to the body, so a sticker on a door stays where the closed door was when the door
  opens. To fix before going into the world.
- Shaders: a kit car's anchor for program warm-up comes from the general loader. The clear
  glass (`car-glass-clear`) is a new variant: when the car goes into the world, check
  `info.programs` during play (see the shader-variant rules).
- The 2108's plastic bumper looks heavy. The 2106's arches have no chrome.
- No ink outline. That was the agreement; the reference has one.

## Adding a car

1. Pick the drawing and photos, and measure as described above.
2. Add a spec to `specs.ts` with a comment on its source.
3. Add a row to `KIT_CARS` (`vehicle/carmodels.ts`): id, sibling `sv_*`, spec key.
4. Add the factory dimensions to `FACTORY_GEOMETRY` and a fit row:
   `bun tools/fit-models.ts kit_<id>`.
5. Run `nice -n 15 npx tsc --noEmit -p .`, then check the car in the lab:
   - from four sides;
   - with everything open;
   - at night with the lamps on;
   - with dust 0.8.
