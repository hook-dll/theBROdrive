# carkit: VAZ cars generated at load time, interior included

`src/carkit` builds a car from a numeric spec as a `THREE.Group`, the same scene a GLB/FBX
loader would return. From there the car goes through the usual pipeline in
`render/carmodel.ts` (`buildTemplate`), so it gets paint, dust, scratches, stickers, glass
dirt, lamps and fitting to the factory dimensions on the same terms as every other model.

Status: stage 3 under way. Eleven cars — `kit_vaz2101` … `kit_vaz2108`, `kit_vaz2109`,
`kit_vaz21099` and `kit_vaz2115` —
are shown in the car lab only:
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
3. The remaining cars from specs. ✅ Looks as descriptions, five wheel styles, the 2101,
   2102, 2103, 2104, 2105, 2107, 2109, 21099 and 2115. Left: 2110/2112, 2121/2131, 1111.
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
| `spec.ts` | Spec types: `KitCarSpec`, `TubStation`, `CabinSpec`, `CabinColumn`, `WheelSpec`, `KitLook` and the face/bumper descriptions (`FaceItem`, `BumperLook`). |
| `specs.ts` | Car numbers (`KIT_SPECS`): body families (`BODY_124`, `BODY_05`, the Samara shells) placed per car with `onBody`, one `LOOK_*` per car, each with a comment saying where it was measured. |
| `measurements-classics.md`, `measurements-estates.md`, `measurements-samara.md` | Measurement reports: every figure with its drawing or photo and scale. |
| `estates.ts` | The 2102/2104 bodies and backs (`BODY_2102`, `BODY_2104`, `REAR_*`); their fronts and sides are their saloons'. |
| `samaras.ts` | The Samara family: `BODY_2108` and its looks, and the 2109, 21099 and 2115 bodies and looks built on it. |
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
- `vehicle/model-fits.json`: a row for every kit car (`bun tools/fit-models.ts <id>`).

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
(`vaz2101.jpg`, `vaz2108.jpg`, `vaz_21099.jpg`, `vaz_2109.jpg`; there are also `niva.jpg`,
`fiat124.jpg`, …), photos from
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
dashboard. The 2105 and 2107 share their own, squarer body. So a car is a **body family**
plus a **look** plus a **cabin override**:

- `BODY_124` (2101, 2103, 2106) and `BODY_05` (2105, 2107) are written once;
  `onBody(body, ds, length)` moves a family's shell to one car's own bumper tip.
- `LOOK_*` describes the ends as part lists placed against the end face's own lines —
  `bumperTop`, `bumperBottom`, `belt`, `deck`, `mid` — plus side trim. Kinds:
  - `panel`: a flat surround across the face;
  - `round`: a round lamp in a chrome ring;
  - `lens`: a rectangular lens in a lamp role;
  - `grille`: frame, dark back and bars (vertical/horizontal, finish, count), optionally
    standing out of the face (`standOut`, the 2107's);
  - `cluster`: a tail lamp in a black housing, columns of cells by role;
  - `frame`: a rectangular outline (chrome surrounds).

  Bumpers are a `blade` (finish, two-tone `lower`, `strip`, plastic `ends`, `overriders`
  from rubber blocks to chrome fangs) or a `moulded` plastic one. Side trim: `sill`,
  `waist` (broken at the shut lines, each piece riding on its door), `repeater`,
  `brightwork`. Finishes: chrome, black, alloy (bare aluminium), rubber.
- `cabinLayout` overrides the platform's interior layout: `CABIN_2101` (ribbon
  speedometer), `CABIN_2103` (five dials on wood), `CABIN_2105` (own cluster pod),
  `CABIN_2107` (one-piece "euro" dash) in `interior.ts`.

What each one carries (numbers and sources in `measurements-classics.md`):

| | 2101 | 2103 | 2106 | 2105 | 2107 |
|---|---|---|---|---|---|
| Body | 124 | 124 | 124 | "05" | "05" |
| Front | 2 round lamps by a wide chrome grille | 4 round lamps inside one chrome grille | 4 round in black surrounds in a chrome frame, chrome-framed grille | rectangular units with amber outer cells, flush black grille | taller units in a black band, tall chrome grille standing out |
| Bumpers | thin chrome, chrome fangs | chrome, chrome fangs | chrome, rubber strip and blocks, black end caps | aluminium, black lip and end caps | chrome over black, black ends |
| Tail | small chrome-rimmed lamps, reversing lamps apart | chrome surround round lamps and plate | black panel in a chrome outline, 3×3 cells | wide lamps, 2×3 cells (no wrap: checked on a side photo) | as the 2105, two rows |
| Side | chrome sill, round repeater | chrome waist and sill | waist with black insert, chrome sill | black ribbed sill strip | painted |
| Quarter lights / rear-door fixed pane | yes / – | yes / – | yes / – | no / yes | no / yes |
| Head restraints | no | no | yes | yes | yes |
| Dashboard | ribbon speedometer | five dials in a row on wood | wood, round dials | own pod, padded | "euro" panel |

A door can carry a fixed pane (`glass: 'fixed'` in a door strip becomes `quarter_*`,
riding with the door): the 2105/2107 rear door's quarter.

The estates (2102 on the 124 shell, 2104 on the 05) reuse their saloons' face, side and
dash. Their tail stations are `flat: 1`, so the deck lies level out to the pillar row and
the tailgate (no `bootEnd`, hinged at the roof, folded at `rearKnee`) gets a flat sill with
upright sides between the corner lamps. The filler is on the left (`flap.side`). The rear
bench is pulled forward with `cabinLayout.bench`, and the load floor starts at the bench
(`loadSpaceStart`) and never sinks below the floor pan.

The Samaras share the 2108's shell from the nose to the B pillar and all its heights
(numbers in `measurements-samara.md`). The 2109 changes only the greenhouse columns: a
shorter front door, a full-size rear door (`door2`) raked along the C pillar and a smaller
fixed quarter light behind it. The 21099 adds a saloon tail: a raked back light, a boot
lid (`bootEnd`) and its own lamps. The 2115 is the 21099 moved back 45 mm by its longer
front bumper, with body-colour bumpers (`finish: 'paint'` on a moulded bumper) and a boot
lid that comes down between the corner lamps: its last station carries `notch`, so the
deck there lies level at the lid's foot between two lamp corners and the lid is cut along
the notch, and the lamp bar is in `rear.lid`, face items that ride on the lid.

## Refactoring without breaking a car

When the generator changes shape but should not change a car, prove it on geometry:
build each car from the committed code (a `git worktree` with `node_modules` linked) and
from the working tree, collect every mesh's triangles in the car frame, sort them so
emission order does not matter, and compare vertex by vertex. The descriptions refactor
was checked this way: the 2108 came out identical; the 2106 differed only in its grille
bars, 0.29 mm (their spacing is now a rounded margin), before its looks were then
deliberately corrected to the measurements.

## Wheels: the Soviet pack's sets

A kit car is shod as the Soviet pack's cars are, but from `DISTINCT_SOVIET_WHEEL_SETS`
(the pack's six wheel designs once each; the shared pool repeats them), each instance
wearing one set on all four, picked by its appearance key, rescaled by `cloneWheels` to
the kit's own tyre size and width. The kit's
own wheel (`buildWheel` in `wheels.ts`, a tyre on a plain steel disc) only sets where the
wheels stand and how big they are. In the lab, `Экземпляр` (and `?variant=`) steps the
appearance key: paint and wheels change together.

## Budget and current figures

| | Total | Body + trim | Interior | Engine bay | Boot | Underbody | Wheels | Beyond 25 m |
|---|---|---|---|---|---|---|---|---|
| 2101 | 12.0k | 5.1k | 3.0k | 1.05k | 0.3k | 0.75k | 1.8k | 6.9k |
| 2103 | 12.7k | 5.6k | 3.2k | 1.05k | 0.3k | 0.75k | 1.8k | 7.4k |
| 2105 | 12.5k | 5.3k | 3.2k | 1.07k | 0.3k | 0.75k | 1.8k | 7.2k |
| 2106 | 13.1k | 6.0k | 3.1k | 1.05k | 0.3k | 0.75k | 1.8k | 7.9k |
| 2107 | 12.7k | 5.2k | 3.6k | 1.07k | 0.3k | 0.75k | 1.8k | 7.1k |
| 2108 | 10.8k | 3.8k | 3.2k | 1.25k | 0.04k | 0.6k | 1.8k | 5.7k |
| 2109 | 11.4k | 4.7k | 3.4k | 1.25k | 0.04k | 0.6k | 1.3k | 6.0k |
| 21099 | 11.8k | 5.0k | 3.5k | 1.25k | 0.07k | 0.6k | 1.3k | 6.4k |
| 2115 | 11.9k | 5.1k | 3.5k | 1.25k | 0.07k | 0.6k | 1.3k | 6.4k |

Wheels are counted in the steel-cap style (the heaviest, about 450 per wheel); the 2109,
21099 and 2115 rows count the kit's own plain wheel (336 per wheel) that the pack's sets
replace. Lowest point of the body: 0.170 m, the factory ground clearance.

## Known gaps

- Stickers: `stampCarBodyPositions` stamps vertices in the closed pose and the decal is
  attached to the body, so a sticker on a door stays where the closed door was when the door
  opens. To fix before going into the world.
- Shaders: a kit car's anchor for program warm-up comes from the general loader. The clear
  glass (`car-glass-clear`) is a new variant: when the car goes into the world, check
  `info.programs` during play (see the shader-variant rules).
- The 2108's plastic bumper looks heavy. The 2103's arch chrome, the C-pillar vents of the
  classics and the 2105/2107 mirror sail are not modelled; the 2107's bonnet is not notched
  round its grille.
- The Samaras' greenhouse is the 2108 drawing's, about 60 mm shallower relative to the body
  than on the 21099 drawing. The 2115's boot spoiler with its high brake lamp, rear plate
  recess, fog lamps and door mouldings are not modelled, and its head lamps keep the 2108's
  trapezoids.
- The 2105/2107 hubs are as drawn (0.635 / 3.048), 20–30 mm off the drawing's dimension
  line; the arches and doors are drawn round the drawn hubs.
- No ink outline. That was the agreement; the reference has one.

## Adding a car

1. Pick the drawing and photos, and measure as described above.
2. Add a spec to `specs.ts` with a comment on its source: reuse a body family with
   `onBody` where the car shares one, and write its `LOOK_*` (and `CABIN_*` if its dash
   differs from the platform's).
3. Add a row to `KIT_CARS` (`vehicle/carmodels.ts`): id, sibling `sv_*`, spec key.
4. Add the factory dimensions to `FACTORY_GEOMETRY` and a fit row:
   `bun tools/fit-models.ts kit_<id>`.
5. Run `nice -n 15 npx tsc --noEmit -p .`, then check the car in the lab:
   - from four sides;
   - with everything open;
   - at night with the lamps on;
   - with dust 0.8.
