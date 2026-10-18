# carkit: Soviet cars generated at load time, interior included

`src/carkit` builds a car from a numeric spec as a `THREE.Group`, the same scene a GLB/FBX
loader would return. From there the car goes through the usual pipeline in
`render/carmodel.ts` (`buildTemplate`), so it gets paint, dust, scratches, stickers, glass
dirt, lamps and fitting to the factory dimensions on the same terms as every other model.

Since 2026-10-13 the kit cars are the game's only cars (`CAR_MODELS`): traffic, rivals, the
start car, contract cars, couriers, wrecks and the dev spawn menu draw from them, and a save
naming a pack body loads on its kit twin. The car lab (`/?car-lab`) shows the kit cars
only.

**Reading order for a new agent:**
1. this file: how the kit works, the spec language, how to add a car, the working rules;
2. [`STATUS.md`](STATUS.md): the owner's goal, the agreed roadmap, what is done per car,
   what is left, known gaps;
3. [`HISTORY.md`](HISTORY.md): every notable fix (complaint → cause → solution → code) and
   the approaches that failed and must not be retried;
4. the `measurements-*.md` file of the family you touch: every number with its source.

## Working rules

These are the owner's. Break none of them.

**Principle: a schematic parody, not a precise copy.** Simpler is better. Straight lines
are fine as long as they are cut in the right places. Prefer the simplest geometry that
reads correctly (a flat piece bent once round a corner, a straight chop, a straight lean)
over new generator features or curves; if something half-built is more complex than
needed, drop it for the simple version.

**Workflow: screenshots first, docs at acceptance.** As soon as a shape is visible in the
lab, send the owner (through the main agent) draft screenshots from his angles, before
hash proofs and docs. Iterate on his feedback. Only when he accepts the model: run the
full checks (tsc, hashes, z-fighting `tools/kit-zfight.ts`, lamps at night, shader
programs, fit rows), write the docs (this file, STATUS, HISTORY, CHANGELOG, measurements)
and commit.

**Machine and processes** (full text: `.omp/rules/process-hygiene.md`, untracked):
- Run your own Vite: `npx vite --port 5199 --strictPort`. Port 5173 is the owner's own
  `npm run dev`: never stop it, never measure while it runs without asking.
- One game/browser tab across the whole session, subagents included. Never launch a
  second browser (no puppeteer, no Chrome for Testing); use the managed `browser`.
- Heavy commands (`tools/*.ts` benches, `tools/fit-models.ts`) one at a time under
  `nice -n 15`. Check `sysctl -n vm.loadavg` against the 12 cores first.
- Before finishing: close the tab, stop your Vite, and check
  `ps -Ao pid,pcpu,command | grep -E 'tsx|vite|Chrome for Testing'` shows nothing of yours.
  Remove any temporary `git worktree`.

**Code:**
- Edit source with the edit tool, never `sed`/`python`. Throwaway scripts (in `/tmp`)
  may compute numbers or write data files.
- Typecheck: `nice -n 10 npx tsc --noEmit -p .` (a clean run prints only npm notices).
  `bun` is at `~/.bun/bin/bun`.
- Shaders (`.omp/rules/shader-variants.md`): no material variant may first appear at run
  time. A kit car is one opaque material and its glass (`materials.ts`), merged into one
  skinned mesh per material (render/kitdraw.ts); LOD changes only visibility, bones and
  uniforms (`KitRig.setDetail`); never toggle a light's `visible` or `castShadow`; a new
  `onBeforeCompile` patch needs a stable shared `customProgramCacheKey`.
- Visual rules: flat faces, the game's lighting and palette, no outlines. Real factory
  proportions measured from drawings or photos, **never from memory**; simplified shape,
  no caricature, never stacked boxes. Doors at their full real size.
- A generator change that should not move existing cars must be proved on geometry
  ([Proving a refactor](#proving-a-refactor)).

**Git** (branch `funny`):
- Commit and push only kit work, and only when your assignment says so. Messages follow
  the existing style: `Kit <car or family>: <what the car now looks like>`, with a body
  explaining the cause when it is not obvious.
- The owner keeps uncommitted work in the tree that must stay uncommitted:
  `public/models/carforge/*`, `tools/carforge/*`, and the non-`kit_*` rows (e.g.
  `cf_vaz1111`) of `src/vehicle/model-fits.json`. Never `git add` these files whole.
  To stage `model-fits.json`, stage HEAD's JSON plus only the `kit_*` rows:

  ```sh
  ~/.bun/bin/bun -e '
    const head = JSON.parse(await Bun.$`git show HEAD:src/vehicle/model-fits.json`.text());
    const work = JSON.parse(await Bun.file("src/vehicle/model-fits.json").text());
    for (const k of Object.keys(work)) if (k.startsWith("kit_")) head[k] = work[k];
    await Bun.write("/tmp/fits-stage.json", JSON.stringify(head, null, 2) + "\n");'
  blob=$(git hash-object -w /tmp/fits-stage.json)
  git update-index --cacheinfo 100644,$blob,src/vehicle/model-fits.json
  ```

  `git diff --cached src/vehicle/model-fits.json` must then show only `kit_*` rows.
- Update `CHANGELOG.md` (`## Unreleased`, the kit entries) and `STATUS.md` with the change;
  add a `HISTORY.md` entry for every fix of an owner's complaint.

**The owner** writes in Russian and reviews by screenshots from the lab. Show him the car
from the angle he complained about; changes are judged there, not in code.

## Frame of reference

- A spec is in metres. `s` is the distance **rearward from the tip of the front bumper**,
  `y` is height above the ground under the tyres, `x` is the car's left (the driver sits at +x).
- The scene is in the game frame: +Z forward (the car's front), +X left, +Y up.
  Conversion: `BodyFrame.z(s) = length/2 − s`.
- The loader then scales the body to the passport width, length and height
  (`FACTORY_GEOMETRY` in `vehicle/carmodels.ts`). Drawings sit a little lower than the
  passport figures (2101 is 1382 against 1440), so the car grows by those few percent as a
  whole and its proportions stay those of the drawing.

## Modules

| File | What it does |
|---|---|
| `spec.ts` | Spec types: `KitCarSpec`, `TubStation`, `CabinSpec`, `CabinColumn`, `WheelSpec`, `KitLook`, `FaceLook`, `FaceItem`, `BumperLook`. The language a car is written in ([Spec reference](#spec-reference)). |
| `specs.ts` | `KIT_SPECS` (the registry), `KitBody`, `onBody`, the classic shells `BODY_124` / `BODY_05` and the classics' `LOOK_*`. |
| `estates.ts` | The 2102/2104 bodies and backs (`BODY_2102`, `BODY_2104`, `REAR_*`); their fronts and sides are their saloons'. |
| `samaras.ts` | The Samara family: `BODY_2108` / `LOOK_2108` and the 2109, 21099 and 2115 bodies and looks built on it. |
| `tens.ts` | The "tens": `BODY_2110` / `LOOK_2110`, the 2112 hatch and the 2111 estate derived from it. |
| `nivas.ts` | The Nivas: `BODY_2121` / `LOOK_2121` (platform `niva`) and the 2131 on its shell. |
| `oka.ts` | The VAZ-1111: `BODY_1111` / `LOOK_1111` (platform `samara`). |
| `volgas.ts` | The Volgas: `BODY_GAZ24` / `LOOK_GAZ24` (platform `classic`) and the GAZ-31029 on the 24's doors and greenhouse with its own nose and tail. |
| `azlk.ts` | The AZLK-2141 Moskvich: `BODY_2141` / `LOOK_2141` (platform `samara`). |
| `daewoo.ts` | The Daewoo Nexia (N100 saloon) and Espero (KLEJ saloon): `BODY_NEXIA` / `LOOK_NEXIA`, `BODY_ESPERO` / `LOOK_ESPERO` (platform `samara`). |
| `opel.ts` | The Opel Astra F (five-door hatch) and Vectra A (saloon): `BODY_ASTRA_F` / `LOOK_ASTRA_F`, `BODY_VECTRA_A` / `LOOK_VECTRA_A` (platform `samara`). |
| `police.ts` | Service liveries (`KitLook.livery`, `LiveryLook`): `LOOK_UAZ469_POLICE` (the 469 in the militia's colours, `KIT_SPECS.uaz469_police`) and `buildLivery`: the doors' skin in livery paint, the lettering split into the front doors' skin (`GLYPHS`, block capitals), the roof light bar with its beacons. |
| `measurements-classics.md`, `measurements-estates.md`, `measurements-samara.md`, `measurements-2110.md`, `measurements-niva.md`, `measurements-oka.md`, `measurements-volga.md`, `measurements-2141.md`, `measurements-nexia.md` | Measurement reports: every figure with its drawing or photo, scale and tag. |
| `builder.ts` | `PartBuilder`: flat triangles per material slot, transform stack, primitives (`box`, `bevelBox`, `extrude`, `cylinderX/Y/Z`, `torusY`, `bridge`, `poly`), vertex colours. |
| `body.ts` | `BodyFrame` (cross-section, deck and lid lookups) and `buildShell`: tub, greenhouse and roof as one face list, then cut into parts. Shell constants (`SHUT_GAP`, `JAMB_DEPTH`, `DOOR_THICKNESS`, `NOTCH_WALL`, …). |
| `exterior.ts` | End faces (`FaceLook.items` / `.lid`), bumpers swept round the corners, sill strip, flank strips (waist moulding, feature line: `buildFlankStrip`), repeaters, flank lamps, mirrors, handles, wipers, filler neck. |
| `interior.ts` | Trim, dashboard, gauges, wheel, pedals, levers, seats, door cards. Per-platform layout table `LAYOUTS`, per-car overrides `CABIN_2101/2103/2105/2107/2110`. |
| `bay.ts` | Engine bay (`kit_bay`), boot (`kit_boot`), underbody (`kit_under`); the exhaust (`exhaust_trim` on the root, outside the detail groups: drawn at every distance, baked into the mid and far meshes). The bay is laid out in a `BayRoom`: under the bonnet (`bonnetRoom`, the shell's walls round it), or on a van in the cabin under the engine cover (`coverRoom`, interior.ts `engineCoverRoom`), with the same four bonnet cells. |
| `wheels.ts` | The kit's own placeholder wheel (tyre on a plain steel disc): sets where the wheels stand and their size. |
| `simplify.ts` | `simplifyFlats`: the finished car's flat runs merged into the fewest, fattest triangles and zero-area ones dropped (step 9 of [How the body is built](#how-the-body-is-built)). |
| `materials.ts` | The one kit material (`kitBodyMaterial`) and the glass; `KIT_SLOT_FINISH`, each slot's colour, finish and lamp role; `finishKitSurfaces`, which writes a built mesh's slot into its vertices ([Draw calls](#draw-calls-one-car-three-draws)). |
| `names.ts` | Node names the catalogue selects by (wheels, lamps, glass). No imports, so the catalogue can include it. |
| `context.ts` | `KitContext`, `addBuilt`, `pivotGroup`, `attach`: how modules put geometry into the scene; `mirrorFrame`, `addMirrorFace`: a mirror head's aim and its live face. |
| `kit.ts` | `buildKitCar(id)`: assembles everything; hinge motions of the shell's parts (`shellMotion`); `leanEnd` (`rearLean`, `frontLean`). |
| `rig.ts` | `KitRig`: runtime channels, controls, lamps, LOD. |

Integration outside the folder:

- `vehicle/carmodels.ts`: `CarModelDef.kit` (build from a spec instead of reading `file`),
  `CarModelDef.clearGlass`, `FACTORY_GEOMETRY` rows `kit_*`, the `KIT_CARS` list (each kit
  car on the running gear of a catalogue sibling, or on its own, `KitOwnGear`), `DISTINCT_SOVIET_WHEEL_SETS`, `CAR_MODELS`
  (= `KIT_CARS`: the world's cars and the car lab's); every other pack is only resolvable
  through `carModel(id)` for the running gear and the wheel sets, in no list anything draws.
  `SERVICE_KIT_CARS` (the police UAZ-469, `kit_uaz469_police`) are kit cars in no list
  either: resolvable by id for the game that spawns them; a save naming one keeps it.
- `save/save.ts` `worldModelId`: a saved `sv_*`/`sa_*`/`gt_*` id loads as `kit_<same car>`
  (`sv_vaz2105r` as `kit_vaz2105`), one with no kit twin as `DEFAULT_CAR_MODEL_ID`
  (`kit_vaz2101`); a resolvable `kit_*` id in no list (`kit_uaz469_police`) as itself.
- `vehicle/vehicle.ts`: every `Vehicle` of a kit model owns a `KitRig` (`vehicle.kit`),
  built with its visuals (lenses left to `VehicleLamps`) and handed over on `rebuild`.
  Each rendered frame `driveKit` writes the driving channels (`steer`, `throttle`, `brake`,
  `clutch`, `handbrake`, `gear`, `speed`, `rpm`, `fuel`, `temp`, `lights`, `blinker`,
  `hazard`: the Vehicle owns these, so a script must not write them) and runs
  `setDetail` (the distance from `Vehicle.viewFrom`'s eye, which main.ts gives once a frame
  with the car the player sits in, whose fine detail always draws) and `update`. The rig,
  not the `STEERING_WHEEL_NODE` path, turns a kit car's wheel.
- `render/carmodel.ts`: `loadModel` calls `buildKitCar` on a frame of its own. Clear glass
  comes from `carClearGlassMaterial`. A detail mesh (cabin, bay, boot, underbody, and the
  exhaust, which is not a detail part) with `userData.kitShadowed` receives shadows and
  casts none; one with `userData.kitCastsNone` (the mirror face) casts none (written into
  each vertex, `KIT_SHADOW_ATTRIBUTE`). `buildTemplate` merges the car (`prepareKitDraw`);
  every car gets its own copy of the one material (`makeCarBodyConditionMaterial`, `kit`)
  and of the glass, over the template's merged buffers (`attachKitDraw`), and its wheel
  set as one mesh (`CarModelInstance.wheelDraw`). `cloneWheels` rescales the pack's wheel
  sets to the kit tyre. Static clones (wrecks, couriers: `cloneStaticModel`) are the mid
  shell less their lids, its panes as the tinted mirror and its wheels as one plain mesh: three draws. A
  wreck's shell is cut round its bonnet and boot lid or tailgate (`kitStaticParts`), and
  on the UAZ-2206 round its middle side door to the bay too (`STATIC_SHELL_DOORS`); a
  courier's round its boot lid or tailgate alone (`StaticLidSet` `'boot'`). These
  hang on the driven car's hinges with their controls (`hangStaticLids`, a draw each) and
  are worked by render/staticlids.ts `StaticCarLids`; while one is open the cabin, bay and
  boot draw from the merged buffer over a fixed skeleton (kitdraw.ts `kitRestSkeleton`).
  Mid traffic (`CarMidInstance`) draws the shut shell without its detail groups in the
  car's own one material (lenses lit by its own lamps) and its panes in its own glass,
  the wheels as instances (render/farcars.ts); `Vehicle.showMid` poses the rig far.
- `render/kitdraw.ts`: the merge, `KitSkeleton` (the rig's nodes as bones),
  `kitRestSkeleton`/`kitRestMesh` (chosen parts at rest, the rest folded, never written
  again), `KIT_PICK_LAYER` (the parts the car was built of, kept as pick proxies).
- `render/stickerdecals.ts`: decals on a moving part (`StickerDecalCarrier`: the nearest
  node with `kitMotion`) hang under that part in its shut frame, so a sticker on a door
  swings with it; `player/interaction.ts` `pickBody` places a sticker from the chassis
  stamp under the hit, so one aimed at an open door lands on the door.
- `render/materials.ts`: dust on glass raises opacity, so dirty clear glass is not
  see-through. On opaque glass this changes nothing. The kit material's patch
  (`patchKitBodyShader`), `carLensGlows`, `setCarLensGrime`, the drop panes' clip
  (`makeCarGrimeMaterial` `panes`, `setCarGlassPaneDrop`) and `kitCastDepthMaterial`.
  Livery paint (`CAR_LAMP_LIVERY`) is paint in its own vertex colour.
- `render/farcars.ts`: the far mesh draws livery paint at paint share 0 in its colour;
  `collectPieces` with `whole` (the near merge) also takes a node hidden as built that the
  rig shows (`kitMotion` `visible`: a beacon's lit lens), which the mid and far bakes skip.
- `player/interaction.ts`, `car-lab.ts`, `app/devtools.ts` `stickerSheet`: their raycasters
  enable `KIT_PICK_LAYER`, so they meet the parts, never the merged meshes.
- `car-lab.ts`: the kit cars in a grid, hover and click, the "КАБИНА" panel, LOD by
  distance (`KitRig.setDetail`: the cabin's fine detail within 6 m), `window.__carLab`.
- `vehicle/model-fits.json`: a measured fit row for every kit car (`tools/fit-models.ts`),
  with its `dustFlow` (`CarDustFlow`: how the body's airflow places dust on the paint and
  glass), authored from the car's aero figures by `tools/dust-flow.ts --write`.

## How the body is built

1. **Tub.** `stations` are half cross-sections along `s` (sill, crease, belt, deck and
   their half widths). The shoulder (`shoulder.inset/rise`) leads to the edge of the deck.
   The deck has a parabolic crown (`flat` makes it level; `notch` drops it between lamp
   corners). Every column has the same set of rows (sill, the cut lines for the door and
   flap, crease, belt), so neighbouring columns pair up row by row and the shut lines come
   out straight.
2. **Arches.** The radius is `wheels.radius × wheels.arch` (at the rear `wheels.rearArch`
   if set: `BodyFrame.archFactor`). The bottom row of the side sits on the arch. Rows below
   the **arch lip** (`ARCH_LIP` above the arch) are raised onto it, so a door that reaches
   over the wheel gets its cut-out automatically. The wheel arch liners are dark.
3. **Greenhouse.** `cabin.columns` are side columns from the windscreen corner to the back
   light corner, each describing the strip after it (who owns it above and below the belt,
   which glass it has). The windscreen and back light sit between the deck's edge and the
   roof rail; `screenFoot` brings the screen's foot forward on the centre line (curved in
   plan). A hatchback's tailgate folds at `rearKnee`, and the last side column folds there
   with it so the D pillar lies flush. Where a station between two columns bends the tub's
   top edge (a hatch's D pillar over the lamp corners), the strip's foot gets a point there
   too, so the greenhouse meets the tub with no slit.
4. **End faces** are earcut (`THREE.ShapeUtils.triangulateShape`), never fanned: an
   estate's or notched tail is concave. A leaning nose (`frontLean`) is cut along its base
   line, so everything above it leans as one plane with the lamps on it.
5. **Cutting.** Faces are grouped by owner:
   - owners: `body`, `door_fl/fr/rl/rr`, `bonnet`, `boot`, `tailgate`, `flap`, `window_*`,
     `vent_*`, `quarter_*`;
   - gaps: each opening part's edge pulls in by half a gap (`SHUT_GAP`) and the body's edge
     pushes out by the other half;
   - jamb flanges go on the body (`JAMB_DEPTH`), end faces and an inner skin go on the
     parts (`DOOR_THICKNESS`, `LID_THICKNESS`); round the greenhouse the flanges and the
     parts' edges are rubber (the seal);
   - a door's and a tailgate's inner skin is in the upholstery colour (the card below the
     belt, the frame's lining above it); a bonnet's and a boot lid's stay painted;
   - glass is recessed (`GLASS_INSET`) and edged with dark rubber, from the frame's edge
     back to the pane and on to the frame's inner side (the lining or the inner skin);
   - the body's own greenhouse and roof faces, offset `LINING_DEPTH` inward, are the
     cabin's lining (`ShellResult.lining`): pillar trims, headers and headliner end at
     the panes and openings exactly. interior.ts draws it in the headliner colour.
6. **Hinges.** Pivots come from each part's geometry: door at its front edge, bonnet at
   its rear edge, boot lid at its front edge, tailgate at its top edge, flap at its front
   edge, quarter light at its rear post. A drop glass winds down into its door in its
   own plane, the glass shader dropping what has gone below the door's top (rig.ts
   `SinkingPane`). Panes
   (`window_*`, `vent_*`, `quarter_*`) ride inside their door. Opening angles are in
   `shellMotion` (kit.ts).
7. **Exterior, interior, bay** are added (`buildExterior`, `buildInterior`, `buildBay`).
8. **`rearLean`** and **`frontLean`**, if set, warp the finished back or nose (kit.ts `leanEnd`).
9. **Flat runs merged** (simplify.ts `simplifyFlats`), on every car by default: in each
   builder mesh, a vertex whose triangles all lie in one plane (within 0.1 mm and 1.5°) in
   one colour is taken out and its hole filled again, always cutting the ear whose
   smallest angle is largest, so no fan; zero-area triangles are dropped. A vertex on a
   mesh's open edge goes only where the edge runs straight through it and no other mesh
   has a corner there, so no seam opens. Rows and columns that only cut a flat panel
   into strips then vanish with their slivers; where the surface bends, nothing moves.
   Generators may stay simple (sample a strip, cut a hole) and leave the merging here,
   but should not cut a curved surface finer than it bends: the pass cannot flatten
   that. About 30–40 ms per car.
10. **Wheels** (`kit_wheel_*`) are added last and never warped.

## Spec reference

A car is `KIT_SPECS[id]: KitCarSpec` = a **body** (`KitBody`, the shape) + a **look**
(`KitLook`, the styling) + an optional **cabin override** (`cabinLayout`). All lengths in
metres in the frame above. Exact types: `spec.ts`; this is what each field means to an
author.

### Body (`KitBody` = `KitCarSpec` without `id`, `look`, `cabinLayout`)

| Field | Meaning |
|---|---|
| `length` | Bumper tip to bumper tip, as built (the loader then fits it to `FACTORY_GEOMETRY`). |
| `platform` | `'classic'`, `'samara'` or `'niva'`: picks the interior layout (`LAYOUTS` in interior.ts) and the engine bay / underbody in bay.ts. `'niva'` is the classic's bay, floor and furniture with permanent four-wheel drive under it (bay.ts `nivaTransfer`: transfer box rising into the tunnel, front propshaft, front differential, driveshafts), the lowest parts at its 220 mm clearance, and its own dash (`LAYOUTS.niva`). |
| `stations` | `TubStation[]`, nose to tail; the first is the front face, the last the tail face. |
| `cabin` | `CabinSpec`: the greenhouse. |
| `wheels` | `WheelSpec`: axles, tyre, tracks, arches. |
| `shoulder` | `{ inset, rise }`: the belt turns in by `inset` and up by `rise` to the deck's edge. |
| `doorBottom` | Height of the doors' bottom edge (top of the sill under them). |
| `bonnetFront` | `s` where the bonnet starts; it runs to the cowl. |
| `bonnet?` | `{ inset, nose? }`: the bonnet's side cut `inset` in from the deck's edge instead of at the pillar row (the 2110's covers the whole top, its shut lines along the wings' top edge); it ends 12 mm (`SCUTTLE`) short of the cowl and the bay's inner wings stand under the cut. `nose: { y, half: [bottom, top] }`: the bonnet comes down the front face between the head lamps to height `y` (set `bonnetFront` to the first station); `front.lid` items ride on it. Absent: the pillar-row bonnet. |
| `bootEnd` | `s` where a boot lid ends (it runs from the back light's foot). **Absent = a tailgate** hinged at the roof. Equal to the last station's `s` with a `notch` there, the lid comes down the tail face (2115, 2110): its top turns down to a line across at the corners' top and its rear panel lies in the tail face between the corner lamps (`BodyFrame.lidFace`). A tailgate does the same when the last station carries a `notch` (the Oka's, down between its corner lamps; `BodyFrame.lidOwner`). |
| `rearLean` | `{ base, lean, blend }`: above height `base`, every point behind the rear base moves forward `lean` m per m of height, faded in over `blend` m ahead of it. Makes an estate's tailgate, lamp corners and lamps one raked plane. Built (closed) pose is warped, so parts still close flush. |
| `frontLean` | The same at the nose (kit.ts `leanEnd`): above `base`, every point ahead of `full` (default the bonnet's front edge) moves back `lean` m per m of height, faded out over `blend` m behind it. Put `base` on a face row (the crease) and `full` behind the corner lamps' end, so the lamps lean exactly with the faces they lie on; a long `blend` keeps the bonnet one smooth surface. The Samaras' face (`BODY_2108`: base 0.625, lean 0.36, blend 0.15) and the tens' (`BODY_2110`: base 0.58, lean 0.586, blend 0.6, full 0.2). |
| `flap` | Fuel flap: `s0..s1`, `y0..y1`, `side` (`'right'` default; the classic estates' is `'left'`). |

**`TubStation`** — one half-section; values interpolate linearly between stations.

| Field | Meaning |
|---|---|
| `s` | Position along the car. |
| `sill` | Underside of the sill (bottom edge of the side). |
| `crease` | Height of the widest line along the side. |
| `belt` | Top of the side, where it turns in to the shoulder. |
| `deck` | Bonnet/boot height on the centre line (unused under the cabin). |
| `wSill`, `wCrease`, `wBelt` | Half widths at those three heights. |
| `flat?` | `1`: the deck lies level out to the pillar row and rises straight to the edge (an estate's tailgate sill). Default `0`: parabolic crown. |
| `notch?` | Half width of a lid that comes down between two lamp corners: the deck lies level at `deck` out to `notch − NOTCH_WALL`, rises in a 25 mm wall to the corners' top and stays level to the side; the lid is cut along this line (`BodyFrame.lidX`). |

**`CabinSpec`** — the greenhouse.

| Field | Meaning |
|---|---|
| `columns` | `CabinColumn[]` from the windscreen's base corner (the cowl) to the back light's base corner. Each column's `s` is also a tub column. The first column's `s` is the cowl; the last's is the rear base (`frame.rearBase`). |
| `rail`, `railHalf` | Roof-rail height and half width (the top ring). |
| `crown` | Roof crown on the centre line above the rail. |
| `crownPower?` | How the crown falls across the roof: `crown · (1 − f^crownPower)` at fraction f of its half width. Default 2 (a parabola); the UAZ-2206 3 (flat middle, rolled into the gutters); the UAZ-469 20 (level across, rolled down only at its edges, the windscreen's top straight with it). |
| `railInset`, `railRise` | The rail's chamfer onto the roof. |
| `railBend?` | `[across, up]`: a row along that chamfer at those fractions of `railInset` / `railRise` from the rail, so the roof's edge turns into the side glass and the screens' headers in two facets (the Volgas and tens `[0.3, 0.6]`); its first facet never rises steeper than 95 % of the glass under it, and with it every twisted greenhouse and roof quad is cut on its convex diagonal (`buildShell` `quad`). Absent: one chamfer. Keep `roofDrop` convex (the roof rising ever less steeply from the screen) and do not combine it with a step `cornerDrop`: either folds the roof in behind the header (the tens' corner dents, 2026-10-16). |
| `roofDrop?` | The roof's line in profile, `[s, drop]` points: everything at the roof at s (rail, its chamfer, the side glass's tops, the screen's and back light's tops, the roof's rows; the headliner, mirror, visors and wipers follow through `BodyFrame.roofDrop`) stands that much lower, linear between points, held beyond; every point between two columns' tops adds a row (`buildShell` inserts a ring entry). Keep the drop at a column's `top + railInset` no more than `railRise` over the drop at its `top`, or the roof dips under the screen's header. The Volgas' arched roofs, the tens' (whose screen top may come down only 0.02 before the 500 mm blades stop sweeping 90°). Absent: level. |
| `glassBottom`, `glassTop` | Side glass: bottom above the belt, top below the rail. |
| `screenBottom`, `screenHeader` | Windscreen base strip above the cowl, header below the rail. |
| `screenFoot?` | How far ahead of the cowl the windscreen's foot stands on the centre line, fading to nothing at the corners (1 − frac²): a screen curved in plan, more raked in profile; the bonnet ends that far forward (`BodyFrame.bonnetRear`), the scuttle between. The Samaras 0.15, the tens 0.156 (drawings). |
| `wiperBlade` | Windscreen wiper blade length (parts catalogues: the classics 0.33, the Samaras 0.51, the tens 0.50). The arms, their park and sweep are fitted to the glass (`buildWipers`): the longest arm that parks within 20°, else the one parking lowest within 45° (the tens' screen, curved in plan). |
| `wiperMount?` | `'top'`: the spindles in the screen frame's header, the arms hanging down and parked to the right along it, sweeping down (the old UAZ-469). Absent: under the screen's foot. |
| `rearBottom`, `rearHeader` | Same for the back light. |
| `rearKnee?` | `{ s, y }` on the centre line where a hatch's tailgate folds: glass above, painted panel below. Absent: the back light runs straight to its base. |
| `pillar` | Pillar strip width at the windscreen and back-light edges. |

**`CabinColumn`** — `{ s, top, upper?, lower?, glass? }`: `s` where the column stands at the
belt, `top` where it meets the rail (`top ≠ s` = raked pillar). The rest describe the strip
**from this column to the next**: `upper` / `lower` own it above / below the belt
(`'body'`, `'door1'` = front door, `'door2'` = rear door; `lower` defaults to `upper`, and
below the belt a door may overlap a pillar), `glass` is `'none'`, `'drop'` (wind-down, `window_*`), `'vent'` (quarter light,
`vent_*`) or `'fixed'` (a fixed pane: in the body if `upper: 'body'`, else it rides with the
door as `quarter_*`). `finish?: 'black'` makes the strip's paint above the belt black
trim up to the rail (the frame round its glass, a blacked-out pillar, the mirror's sail; the
rail's chamfer stays painted: the Espero's frames, B pillar and sail). `foot?: { y, s, round? }` rakes the shut line on this column below
the belt: upright down to `y`, then straight to `s` at the doors' bottom (the 2110's rear
door, whose edge runs forward to the sill in front of the arch); `round: [upper, lower]` are
the radii of its two turns (`BodyFrame.shutLine`; a point of the line within 5 mm of the
fuel flap's top or bottom takes that height, `ROW_SNAP`, since every point is a side row on
every tub column). The side faces it crosses are clipped
along it, and the body's piece behind it gets cabin trim. `drop?` lowers the column's top
point below the rail: one straight chamfer from the A pillar up to the next column's top,
so the pillar rounds into the roof in profile (Samaras 0.03, tens 0.037, the door frames'
tops moved back to meet it). A door's frame strips are short strips with `glass` absent.
Example —
the five-door Samara B pillar (`B_PILLAR` in samaras.ts):

```ts
{ s: 2.19,  top: 2.19,  upper: 'door1' },                    // front door frame strip
{ s: 2.225, top: 2.225, upper: 'body', lower: 'door1' },     // pillar above, door below
{ s: 2.235, top: 2.235, upper: 'body', lower: 'door2' },
```

Neighbouring strips with the same owner and glass make **one** part and **one** pane: a
drop glass may span several columns. A door whose top runs up a raked A pillar ahead of its
lower shut line takes strips with `upper: 'door1', lower: 'body'` from the pillar's foot to
the shut line, so above the belt the door frame and glass start at the pillar while below
the belt the wing reaches back to the shut line (`BODY_05` in specs.ts):

```ts
{ s: 1.0,   top: 1.41,  upper: 'body' },                                  // A pillar
{ s: 1.035, top: 1.445, upper: 'door1', lower: 'body' },                  // door frame over the wing
{ s: 1.06,  top: 1.47,  upper: 'door1', glass: 'drop', lower: 'body' },   // glass starts here…
{ s: 1.17,  top: 1.58,  upper: 'door1', glass: 'drop' },                  // …one pane on; door below too
```

Without those strips the body fills the triangle between the pillar's foot and the door's
front edge at the belt, and the A pillar looks far too wide (HISTORY.md).

**`WheelSpec`** — `front`, `rear` (axle `s`), `radius`, `width` (tyre), `frontHalfTrack`,
`rearHalfTrack` (tyre centres), `arch` (arch radius over tyre radius, 1.13–1.28 so far),
`rearArch?` (the rear arch's own factor where it is tighter than the front's: the 2110's
1.0 is as wide as the tyre; absent, the rear takes `arch`), `rearArchRise?` (the rear
arch's top over the hub, over the tyre radius, where it is lower than a circle: its skin
and liner become a half ellipse; the 2110's 0.81 covers the tyre's top).

### Families and `onBody`

A family's shell is written once as a `KitBody` in one family frame. `onBody(body, ds,
length)` (specs.ts) moves every `s` (stations, columns, `rearKnee`, wheels, `bonnetFront`,
`bootEnd`, `flap`) by `ds` and sets the car's own length: a car whose bumper stands further
out sits `ds` further back from its tip. Shells derived by spreading (`{ ...BODY_2108,
cabin: … }`) share everything not overridden. Current families:

| Shell | Frame | Cars |
|---|---|---|
| `BODY_124` | 2106 (= 2101 drawing + 0.045) | 2101 (`ds −0.045`), 2103 (`−0.02`), 2106 |
| `BODY_2102` | `BODY_124`'s | 2102 (`−0.045`) |
| `BODY_05` | 2105 on `vaz_2107_1982.jpg` | 2105, 2107 (`+0.012`) |
| `BODY_2104` | `BODY_05`'s | 2104 |
| `BODY_2108` | 2108 drawing | 2108; 2109 (`BODY_2109`: other columns); 21099 (`BODY_21099`: columns, tail, `bootEnd`) |
| `BODY_2115` | 2108 frame | 2115 (`+0.045`, length 4.33) |
| `BODY_2110` | 2110 drawing (`tens.ts`) | 2110; 2112 (`BODY_2112`: own tail from the rear door, hatch); 2111 (`BODY_2111`: own rear door frame and estate tail) |
| `BODY_2121` | `niva.jpg` factory four-view (`nivas.ts`) | 2121; 2131 (`BODY_2131`: the 2121 to its B pillar, 0.5 longer behind it, rear doors) |
| `BODY_1111` | 3dcar.ru `vaz_1111_oka.jpg` (`oka.ts`) | 1111 |
| `BODY_GAZ24` | 3dcar.ru `gaz_24.jpg` factory four-view (`volgas.ts`) | GAZ-24; GAZ-31029 (`BODY_GAZ31029`: the 24's columns and middle stations moved back 0.14, its own nose and tail from the-blueprints.com drawing) |
| `BODY_2141` | the-blueprints.com "Moskvich 2141 (1986-2001)" drawing (`azlk.ts`) | AZLK-2141 |
| `BODY_NEXIA` | 3dcar.ru `daewoo_nexia.jpg` dimensioned four-view (`daewoo.ts`) | Daewoo Nexia |
| `BODY_ESPERO` | the-blueprints.com dimensioned vector preview `daewoo_espero_1995.jpg` (`daewoo.ts`) | Daewoo Espero |
| `BODY_ASTRA_F` | the-blueprints.com dimensioned vector preview `2001_opel_astra_f_5-door.jpg` (`opel.ts`) | Opel Astra F |
| `BODY_VECTRA_A` | the-blueprints.com dimensioned vector preview `1990_opel_vectra_a.jpg` (`opel.ts`) | Opel Vectra A |

### Look (`KitLook`)

| Field | Meaning |
|---|---|
| `label` | Display label (`'VAZ-2108'`). |
| `upholstery`, `dash` | Interior vinyl and dash colours (hex). |
| `dashPainted?` | A painted steel dash (both UAZes): its body, instrument plate and glovebox lid in the paint slot, so they take the car's colour and wear; `dash` then only shades the knobs. |
| `headrests` | Head restraints on the front seats. |
| `front`, `rear` | `FaceLook`: one end of the car. |
| `brightwork` | `Finish` of door handles and mirrors. |
| `mirrors?` | `'left'`: only the driver's door mirror (the base Oka). Absent: both. |
| `mirrorStalk?` | Door mirrors on an upright stalk (the UAZ-469): the head this much higher than on the short arm at the door's top (centre belt + 0.08) and 3.5 cm further back, on a rod 2 cm off the skin from a bracket under the belt at the door's front edge, an arm out and back into the head's ball. Absent: the short arm. |
| `sill` | `Finish` of a strip along the sill between the arches, or `null`. |
| `waist` | `{ y, height, finish, span? }`: a moulding along the flank (from `span[0]` to `span[1]` when given, the Opels' strips along the doors only; else nose to tail), broken at the shut lines (each piece riding on its door) and stopping `MOULDING_ARCH_GAP` (30 mm) short of a wheel arch it would run into (the 2115's low door mouldings; the classics' strips sit above their arches and are not cut); or `null`. |
| `repeater` | `{ s0, s1, y0, y1 }`: the amber side repeater on each front wing, or `null`. |
| `spoiler?` | `SpoilerLook`: a body-colour wing with the high brake lamp, hung on the boot lid (2115) or the tailgate (2112, standing on its glass between the knee and the roof) so it lifts with it (exterior.ts `buildSpoiler`). Fields: `half` (half span), `plate` (end-plate width), `s0`/`s1` (wing leading/trailing edge, car frame like `repeater`), `top0`/`top1` (its top at each), `thickness`, `foot` (`s` where the end plates meet the lid), `pedestal: { half, s0, s1 }` (under the wing's middle), `lamp: { half, y0, y1 }` (the brake lens on the pedestal's back). The lens is a `lamp_brake` mesh, so it lights with every other brake lamp. Given before `rearLean`, which carries it with the tailgate. |
| `cornerLamps?` | `CornerLamp[]`: a lamp unit lying flush on the body (4 mm off it) from its inner end on an end face round the corner and along the flank (exterior.ts `buildCornerLamps`, laid on the skin as built, body.ts `skinX`). `end`: `'front'` (default) or `'rear'`. `points`: `{ x }` on the face (half width, or `[bottom, top]` for a leaning edge), `{ s }` on the flank (car frame), or neither for the corner itself; `y: [bottom, top]` there; the stretch after a point is a lens in its `role`'s slot. The lens is flat wherever the skin under it is: along the flank it bends only at the tub's columns (`tubColumns`), and across its height only where the crease or belt runs through it (the tens' front indicator); elsewhere each stretch is one flat piece. Stacked lamps (an indicator over a tail lamp) are separate units. Keep a unit below the end station's belt so it stays on the flat face and side (the shoulder above it is the corner's straight cut). The 2115's and 2110's head lamps and indicators (solid amber) and their tail lamps. |
| `featureLine?` | `{ points: [s, y][], height }`: a pressed line along each flank, a 5 mm painted ridge through the points, broken at the shut lines and riding on the doors like the waist. The 2110's line under the windows. |
| `livery?` | `LiveryLook` (police.ts `buildLivery`, run on the finished skin after the shell's holes): `doors` (the colour of every door's skin: the faces turned out of the side within 45°, in slot `livery`; the edges keep the car's paint, as the jambs they face), `lettering: { text, colour, s, y, height }` (block capitals split into both front doors' skin, centred at `s`, baseline `y`, reading front to back on the left and back to front on the right), `lightBar: { s, half, dark, lit }` (a black housing rooted in the roof at `s`, ±`half` across, a lens each side `dark`, its lit twin `lit` on the beacon channels). The police UAZ-469. Absent: none. |

**`FaceLook`** — `{ bumper, items, lid? }`. `items` are drawn in order (later ones stand on
earlier ones: a lamp on its surround). `lid` items are placed on the end face like `items`
but hang on the part that comes down to it and move with it: at the tail the boot lid or
tailgate (the 2115's lamp bar), at the nose a `bonnet.nose` (the 2110's slot); their lens
meshes keep the lamp names, so lamps still work.

**Placing on an end face.** Every item not on the centre line is built on both sides.
- Heights are `FaceY = [anchor, offset]`, anchors: `bumperTop`, `bumperBottom` (the
  bumper's band), `belt` (the side's top at the end station), `deck` (the bonnet or boot
  edge there), `mid` (halfway from the bumper's top to the deck). E.g.
  `['bumperTop', 0.015]`.
- Across: `FaceX = { centre: d }` (half width from the centre line) or `{ inset: d }` (in
  from the side).
- Extents: `Span<T> = { at, half }` or `{ from, to }`.
- `proud`: how far a part stands out of the face.

**`FaceItem` kinds:**

| Kind | Fields | Use |
|---|---|---|
| `panel` | `x: FaceX \| Span<FaceX>`, `y: Span<FaceY>`, `finish`, `proud` | A flat surround: from side to side when `x` is a `FaceX` (black lamp band, the 2108's slotted body-colour panel with `finish: 'paint'`), or one block on each side when `x` is a span (the 2115's fog-lamp housings). |
| `round` | `role`, `x`, `y: FaceY`, `radius` | A round lamp in a chrome ring (classics). |
| `lens` | `role`, `x: Span<FaceX>`, `y: Span<FaceY>`, `depth`, `proud`, `slant?` | A lamp lens; one centred on the centre line (`x: { at: { centre: 0 }, half }`) is built once across it (the 2110's lid reflector). `slant: { outer, inner }` moves the top edge's outer/inner ends inboard of the bottom's: a trapezoid (2108 headlamps) or a parallelogram; negative values lean out. A lamp that wraps round the body's corner is a `cornerLamps` unit, not a face lens. |
| `grille` | `x: FaceX` (half width), `y`, `standOut?`, `slant?`, `frame?: { finish, margin }`, `back`, `bars: { dir, count, finish, margin, width, depth, proud }` | Grille or slot; `standOut` lifts the whole grille out of the face (the 2107's; the 2115's lower intake). `slant` (a number) moves the top edge's ends that far inboard of the bottom's, negative to lean out: a trapezoid grille (the Nexia's, narrowing to its foot, `slant` −0.055), its bars standing on the dark back 5 mm proud of it up to just under the frame's front, `proud`/`depth` aside; `dir: 'diamond'` (two crossed sets) is for a slanted grille only and needs a `frame` over the bar ends. |
| `cluster` | `x: Span<FaceX>`, `y: Span<FaceY>`, `columns: LampRole[][]` | Tail-lamp cluster straight on the body, its cells tiling the span (no housing; add a `frame` for a chrome surround): columns from the outer edge in, each column's roles top to bottom. |
| `frame` | `x`, `y`, `width`, `finish`, `proud` | A rectangular outline (chrome surround). |

**`LampRole`**: `head`, `tail`, `brake`, `reverse`, `blinker` (takes its side's slot),
`inert` (never lit, drawn red: reflectors, the rear fog cell). There is no fog-lamp role:
the 2115's front fog lamps are chrome-finish `panel`s that never light. **`Finish`**:
`chrome`, `black`, `alloy` (bare aluminium), `rubber`, `grey` (unpainted grey plastic: the
trim slot with a vertex colour, no new material; the 2115's mouldings), `paint` (drawn in
the paint slot, so it takes the car's colour, dust, scratches and stickers).

**`BumperLook`:**
- `blade`: `finish`, `lift` (centre height over the sill's bevel), `height`, `depth` (reach
  out of the face), `lower?: { finish, share }` (two-tone), `strip` (finish or `null`),
  `ends?` (end caps' finish), `overriders` (`{ inset, half: [w, h], drop, finish }` or
  `null`), `wrap?` (how far its ends run back along the flanks from the bar's back,
  hugging the wings 8 mm off the side at every station they pass: the Volgas' long blades;
  absent: a 0.16 return).
- `moulded`: `drop` (foot under the sill's bevel), `height`, `finish?` (absent = dark
  plastic; `'paint'` = body colour, its groove a painted ridge), `moulding?: { y, height,
  finish }` (a band round the bumper instead of the groove: centre height above the
  ground; the 2115's grey band, in line with its door mouldings), `corner?` (plan radius
  where it turns round to the flanks, 0.09 by default; the 2110's front 0.28; with
  `wrapTo` a corner up to 0.15 is one flat chamfer from the flank, level with the end
  face, to the face, a larger one turns in two), `wrapTo?` (`s` its sides follow the
  flanks back to, lying on them with its foot in line with the sill, a path point at each
  station between; the tens' and the 2115's bumpers run to their wheel arches),
  `flush?` (its top grows out of the body's surface in its top 60 mm instead of a flat
  shelf: the tens' and the 2115's bumpers, integrated in the body's lines).

### Cabin override (`cabinLayout`)

`Partial<Layout>` (interior.ts) over the platform's layout. Fields a car may change: seat
`hip`, rear `bench` (`{ from: 'rearBase' | 'hip', offset }`; the estates pull it forward),
`cushion`/`benchCushion`, `recline`, `bolsters`, `seatX`, toe board, `tunnel`, `console`,
the `dash` and `fascia` sections, `dashLoft` (sections across the width where one cannot
serve it: the 2110's driver's half up to the knee panel and shallow end caps at the
doors), `wood` band, `binnacle` and `cluster`, `gauges` (round or
ribbon), steering `wheel` (position, rake, radius, spokes, hub), `pedals`, `gear`,
`handbrake`, `glovebox`, `radio`, `ashtray`, `hazard`, `frontDoor` (the front cards' inner
handle and crank), `lights` switch, `vents` (each with
an optional opening size `half`), `eyeballs`, `clusterFace`, `lamps` (telltales: a grid
`cols` wide of the functions in `show`, each lit on its `tell_*` channel), `rockers`,
`stack`, `heater?` (a heater panel with knobs: `{ dy, half, knobs, radius }`), `carpet`,
`headliner`, `bench.clear` (the bench base's air to the rear wheel-house covers, default
0.022: a bench standing between them, the Nivas' and the Oka's, takes 0.04, since 2 mm
there fights at a distance), `lenses` (a second telltale grid) and `transfer` (static
transfer-box levers on the tunnel, `LAYOUTS.niva`). In `Layout`, `ds` is metres behind the cowl and `dy` an offset from the belt
at the cowl. Existing dashes: `CABIN_2101` (ribbon speedometer), `CABIN_2103` (five dials on
wood), `CABIN_2105` (own pod), `CABIN_2107` (one-piece "euro" panel), `CABIN_2110` (tall
face, hood over swapped big dials, two big centre vents, heater panel, radio low in the
stack), `CABIN_1111` (ribbon speedometer in a small hood), `CABIN_2131` (the 2121's with
the bench further back), `CABIN_NEXIA` (a rounded hood over a central speedometer, the
tachometer left and two small dials right, end vents, two centre vents over three heater
knobs), `CABIN_ESPERO` (an angular hood over three dials of one size, the tachometer,
speedometer and a fuel dial with the temperature scale on its face, switch pods either side
of the hood, two vents over three heater knobs on a black stack, a big glovebox high, a
four-spoke wheel; its bench 3 cm off the wheel-house covers), `CABIN_ASTRA_F` (a rounded
hood over the tachometer, a big speedometer and two small dials, end vents, a centre vent
pair with the hazard switch between, the radio over three heater knobs, a four-spoke wheel),
`CABIN_VECTRA_A` (an angular hood over the tachometer, a big speedometer and two small dials,
the driver's end vent over a rotary light switch, a centre vent pair with the hazard switch
between, a three-spoke wheel); the Samaras and the AZLK-2141 use the `samara` platform's layout as is, the 2121
the `niva` platform's.

## Scene contract

- Wheels: nodes `kit_wheel_fl/fr/rl/rr` (`KIT_WHEEL_NODES`).
- Lamps: one mesh per role, named by slot; the def's `lights` (`KIT_LIGHTS`) selects them:

  | Role | Mesh name |
  |---|---|
  | head | `kit_head` |
  | tail | `kit_tail` |
  | brake | `kit_brake` |
  | reverse | `kit_reverse` |
  | indicator left | `kit_blink_l` |
  | indicator right | `kit_blink_r` |
  | never switched | `rear_passive` |
- Paint: slot `paint` (`userData.kitSlot`, a paint share of 1 in `CAR_SURFACE_ATTRIBUTE`).
  Only it takes colour, dust, scratches, the sticker highlight and stickers; every other
  slot keeps its own colour and finish in its vertices. Slot `livery` (lamp role
  `CAR_LAMP_LIVERY`, police.ts) is paint in its own vertex colour: the paint's finish,
  dust, scratches, highlight and stickers, never the car's colour.
- Lit faces: slot `lamp_glow`, drawn unlit in its vertex colour (lamp role `CAR_LAMP_UNLIT`). A warning lamp's,
  a dial's face and ticks, a needle's and the courtesy lamp's dark face and lit face swap
  places on a pair of `pos` motions on the same channel: the dark one slides back by
  `GLOW_TRAVEL` (a needle `NEEDLE_TRAVEL`) as the lit one slides out into its place, so
  lighting one is a pose, not a material change, and the two never lie in one plane.
  A police car's beacons (police.ts) swap their dark lens and its lit twin, the same box,
  on a pair of `visible` motions instead (`amount` −1 on the dark one, +1 on the lit one,
  which is hidden as built): only one is ever drawn, so they may share the plane.
- Nothing lies on a hidden face. An item on the body skin (a lamp, grille, badge, bumper,
  repeater) is rooted 7 mm into it (`FACE_ROOT`) with no back face, and the shell is cut
  under it (`KitHole`, `cutShellHoles`; outlines on `root.userData.kitHoles`). Items on one
  end face are placed as a union (`EndFace.place`): each cuts what lies inside the other's
  volume, and where two walls lie flush facing the same way the later part's stays
  (`Outline.keepOutside`). Flat decals in the cabin (seat inserts, dials, the radio's
  band, the glovebox opening, vent backings) are laid into the surface they sit on
  (`inlay`, `cutLocal` in interior.ts), not floated a millimetre over it. A window cut for
  a face of the fine detail (a warning lamp, a ribbon dial, a bare dial's ticks) has a
  stand-in `WINDOW_FILL` (24 mm) behind it in the colour that fills it dark, and a round
  dial's face an octagon stand-in laid in the cluster's face 4 mm under it: what shows
  where the fine faces were when they stop drawing.
- Courtesy lamp: group `kit_dome_lamp` (`KIT_DOME_LAMP_NODE`), the `dome` switch; the
  Vehicle hangs the cabin's light from it.
- Glass: material `glass` (= `glassMaterial`). With `clearGlass` it becomes the shared
  `car-glass-clear`; every car draws its own copy, drop panes clipped at the door's top.
- Steering wheel: node `steering_wheel`, its origin on the column axis, local +Y along the
  column towards the driver. The game turns it by `rotation.y`.
- Mirrors: meshes named `mirrors`, which keeps them out of the measured body width. The
  interior mirror and both door mirrors are turned to the driver's eye (`driverEyeAt`,
  `mirrorFrame`): he sees straight back through the back light's middle and along each
  flank. Each carries a hidden live face over its glass (`addMirrorFace`,
  `userData.kitMirror` = `inner`/`left`/`right`, collected as `KitRig.mirrorFaces`);
  render/carmirrors.ts draws them for the car the player sits in, in the cabin view.
- Detail groups for LOD: `kit_cabin` (on the root and inside every door), `kit_bay`,
  `kit_boot`, `kit_under`. The exhaust is not one: its silencer and tail pipe are seen
  under the tail of every car met from behind.
- Fine detail (`userData.kitFine`, context.ts `fineDetail`), inside `kit_cabin`: the
  courtesy lamp (`kit_dome_lamp`, still found by name), visors, `telltale_*`, `panel_dim_*`
  and `panel_glow_*`, `needle_*` (with their dim and glow needles), glovebox, `radio_needle`,
  `radio_knob`, ashtray, `light_switch`, `hazard_button`, the two stalks, `horn`, the three
  pedals, `gear_fb` (the lever), `handbrake`, `crank_*` and each door's `fittings_*` (inner
  handle lever and lock knob). Coarse, drawn to `KIT_DETAIL_M`: the fixed cabin (lining,
  dash, binnacle, cluster face and frame, vents, heater, radio body and band, rockers,
  column, gaiter, handbrake base, seat rails), `seat_*`, `seatback_*`, `headrest_*`, the
  bench, `steering_wheel` (rim, hub, spokes), the inside mirror, and the door cards
  `trim_*` (with the handle recess and the capping).

## Controls and channels (`rig.ts`)

A node that moves carries `userData.kitMotion = { channel, kind: 'rot'|'pos'|'sink'|'visible', axis, amount, stops? }`.
A `visible` node does not move: it shows while its channel is over 0.5 with a positive
`amount`, while it is at most 0.5 with a negative one.
The motion is applied from the built pose: angle or offset = `amount × channel value`, along
an axis in the parent's frame. A needle's `stops` [min, max] are its pins: the value is
clamped to them and the built pose is at `min`.

A node that can be clicked carries `userData.kitControl = { id, label, action? }`, where
`action` is `toggle` (default, flips the channel `id`), `cycle` (steps through values) or
`press` (held down, as the horn). A click on any mesh below the node counts. A part that
does not move (a door's fixed `quarter_*` pane) is not a control.

| Group | Channels |
|---|---|
| Driving | `steer` −1..1, `throttle`, `brake`, `clutch`, `handbrake` 0..1, `gear` −1..5 |
| Derived from `gear` | `gear_fb`, `gear_lr` (H-pattern, `GEAR_GATE`) |
| Instruments | `speed` km/h, `rpm`, `fuel`, `temp` 0..1, `oil` kgf/cm², `volts` V, `vacuum` 0..1 |
| Warning lamps | `tell_turn`, `tell_beam`, `tell_side`, `tell_fuel`, `tell_oil`, `tell_charge`, `tell_brake`, `tell_check` 0/1 |
| Light and signals | `lights` 0/1/2 → `panel` (instrument lighting, on at 1 and 2), `blinker` −1/0/1, `hazard`, `horn`, `dome` (courtesy lamp) |
| Wipers and radio | `wipers` 0/1/2 → `wiper_sweep`; `radio` 0/1/2 (off, preset 1, preset 2; in the game it follows the car's radio) → `radio_tune` (a fixed needle position each) |
| Body | `door_*`, `bonnet`, `boot`, `tailgate`, `flap`, `window_*`, `vent_*` |
| Cabin | `glovebox`, `ashtray`, `visor_l/r`, `seat_*`, `seatback_*`, `headrest_*`, `mirror_yaw`/`mirror_pitch` (inside mirror, radians off its built aim, ±0.2; an `aim` control), `mirror_l_yaw`/`mirror_l_pitch` and `mirror_r_*` (door mirror heads, ±0.25; `aim` controls `mirror_l`/`mirror_r`, offered in the game to a front seat only, through the door glass) |
| Service (police.ts) | `beacon_l`, `beacon_r` 0/1: the light bar's left (+x) and right lamps lit; switched at once (`INSTANT`), flashed by the game; on any other car they drive nothing |

In the lab the rig lights the lamps from the channels: low/high beam and tail lamps from
`lights`, brake lamps from `brake`, reversing lamps from `gear < 0`, indicators from
`blinker` and `hazard` at 90 flashes a minute. In the game `VehicleLamps` does it through
the def's `lights`, and the rig is created with `ownLenses = false`.

`setDetail(distance, inside?, occupied?)` switches only the visibility of the detail
groups (drawn within `KIT_DETAIL_M`, 50 m) and of the cabin's fine detail (drawn within
`KIT_FINE_M`, 6 m, or with the eye inside this car, or for the car the player sits in),
and the glass opacity (0.28 to 30 m, fading to the opaque tinted mirror by
`GLASS_MIRROR_M`, 45 m), so crossing a LOD distance triggers no shader compile, and the
cabin appears and goes behind an opaque pane, unseen. Hidden parts are posed by every
`update` all the same, so a needle that comes back into range stands where it reads.

The fine detail is 60 of a near 2101's 74 cabin meshes (67 of a 2109's 85), counted on the
loaded model (`createCarModel`) with a headless script, 2026-10-15: a parked 2101 seen
from 10 m draws 61 meshes instead of 121, a 2109 63 instead of 130; from 3 m and inside,
all of them. The sun's depth pass is 33 either way (detail parts cast no shadow). 6 m: a
player at the open driver's door (1.5 m out) stands ~2.7 m from the car's centre, one at
the side window (3 m out) ~4 m; past 6 m a 1 cm warning lamp is under two pixels and a
3 mm needle half of one (65° over 1080 px). Car-lab renders of both cars, by day and at
night with the lights on, from the door and the window match the full cabin; from 8 m the
frames differ in 9–28 pixels of 2 million (lock knobs, needles, dial ticks, the lit
cluster's faint glow). The inside mirror is coarse because from 8 m ahead it was the one
part plainly seen going, black against the screen.

## Draw calls: one car, three draws

A near kit car used to draw every mesh it was built of: 60–150 draws in the scene pass,
about 40 in the sun's, 34 in the inside mirror's, each 3–4 µs of main thread. Now it is
drawn as three meshes (render/kitdraw.ts):

1. **One material.** Every slot but the glass draws with `kitBodyMaterial`
   (materials.ts). What made a slot what it was goes into its vertices once the car is
   built (`finishKitSurfaces`): `color` (the slot's colour, or the colour each vertex was
   built in for `trim` and `lamp_glow`) and `CAR_SURFACE_ATTRIBUTE` (render/materials.ts:
   paint share, roughness, metalness, lamp role, the far traffic mesh's convention). Each
   car's copy of it is its paint (`makeCarBodyConditionMaterial` with `kit`): its colour,
   finish, emissive, dust, scratches, highlight and lamp knee apply where the paint share
   is 1; a lens glows by its role from the car's own levels (`carLensGlows`, which
   `VehicleLamps` and the lab rig write as they wrote lens materials) under its own dust
   (`setCarLensGrime`); a lit face is drawn unlit. Shadows per vertex too
   (`KIT_SHADOW_ATTRIBUTE`): a part receives where its mesh did, and casts where it did
   (`kitCastDepthMaterial` clips the rest out of the depth pass).
2. **Bones.** `prepareKitDraw` merges the car into one buffer per material, every vertex
   weighted 1 to the node its part moves or hides with: the body, every `kitMotion` node,
   the detail groups, every `kitFine` node and every drop pane (~90–100 bones). The rig
   still writes those nodes; `KitSkeleton` reads them into the bone texture once a frame
   (only when one moved does the texture upload), and a hidden node folds its part to a
   point. Drop panes slide as bones and the glass discards what is below the door's top
   (`KIT_PANE_ATTRIBUTE`, `setCarGlassPaneDrop`). The four wheels are one mesh too, their
   bones the wheel nodes the vehicle turns (`attachKitWheels`).
3. **Pick proxies.** The meshes the car was built of stay, on `KIT_PICK_LAYER` alone:
   no camera draws them, every raycaster that picks a part enables the layer. Names,
   materials, chassis stamp, `kitControl` and lamp bindings are as before, so picking,
   doors, stickers, lamp beams and the far and mid bakes read them unchanged.

The mirror faces stay meshes of their own (render/carmirrors.ts hides and shows them).
A sticker layer is one more draw where a car has stickers.

Measured 2026-10-15 in the game (Blessing, seed `flick`, km 3, four parked kit cars ahead
of the start 2104, traffic hidden, frozen frame): own car in the cabin view 87 → 6 scene
draws (body, glass front and back, wheels, the two mirror faces in view), chase 142 → 4; a parked car
5–13 m away 72–150 → 4; the sun's pass 37–44 → 3 per car; the inside mirror's 34 → 4.
`renderer.render()` 2.9 → 1.5 ms (cabin) and 3.0 → 1.4 ms (chase), the start car alone
1.2–1.4 → 1.1 ms.

## Wheels: the Soviet pack's sets

A kit car is shod from `DISTINCT_SOVIET_WHEEL_SETS` (carmodels.ts: the pack's six wheel
designs, `sv_gaz21`, `sv_gaz24`, `sv_vaz2101`, `sv_vaz2103`, `sv_vaz2106`, `sv_vaz2108`, once
each), one set on all four wheels per instance, picked by its appearance key and rescaled
by `cloneWheels` to the kit's own tyre. A sibling on the Niva pool
(`OFFROAD_WHEEL_SET_POOL`) keeps it. The kit's own wheel (`buildWheel`) only sets where the
wheels stand and how big they are. In the lab, `Экземпляр` (and `?variant=`) steps the
appearance key: paint and wheels change together.

## Lab

- URL: `http://localhost:5199/?car-lab&time=12` (the kit cars; `time` hours,
  `variant`, `dirt`, `scratches`, `focus` seed state).
- Hovering shows a part's name; a click works it. A drag is the camera, not a click.
- Choosing a car opens the "КАБИНА" panel on the right: sliders for the driving inputs and
  a button per clickable part.
- Automation, `window.__carLab` (`CarLabApi` in car-lab.ts):
  - `focus(id, azimuth, elevation, distance)` — orbit framing;
  - `look(id, [camera], [target], fov?)` — coordinates relative to the car (front is +z);
    `fov` in degrees narrows the lens without moving the eye, so the LOD distance is real;
  - `mid(id, on)` — draw the car as mid traffic does (its mid paint, glass and the shared
    parts), posed far; `only(id | null)` — show one car alone;
  - `kit(id).set(channel, v)`, `.activate(controlId)` (`'door_fl'`, `'door_rl'`, `'bonnet'`,
    `'boot'`, `'tailgate'`, `'flap'`, `'window_fl'`, …), `.controls()`;
  - `set({ dirt, scratches, timeHours, variant })`;
  - `capture()` — PNG data URL of the frame;
  - `models` — ids in the lab.

## Adding a car end to end

Worked example: the VAZ-2110, done this way (`tens.ts`, `measurements-2110.md`), and its
hatch the 2112 derived from it. Follow the steps in order.

### 1. Sources

- **Drawing.** Try `https://3dcar.ru/media/blueprints/full/vaz/<name>.jpg` (names seen:
  `vaz_2101` … `vaz_2107_1982`, `vaz_2109`, `vaz_21099`, `vaz_2110`, `vaz_2111`,
  `vaz_2112`, all three saved). Save under `build/carshape/_refs/bp/img/` (gitignored, local
  only) and run `file` on it: a missing drawing comes back as an HTML 404 page with a
  `.jpg` name (`vaz_2115.jpg` there is one). Factory four-views already there:
  `vaz2101.jpg`, `vaz2108.jpg`, `niva.jpg`, `uaz469.jpg`, `uaz2.jpg`, `gaz21.jpg`,
  `moskvich412.jpg`, `zaz968.jpg`, … GAZ drawings sit under `.../full/gaz/` (`gaz_24`,
  `gaz_2402`, `gaz_21`, `gaz_3102`, `gaz_3110` exist; `gaz_31029` does not: the 31029 was
  measured on the-blueprints.com's watermarked preview, `measurements-volga.md`).
- **Check the drawing against photos**: the 2110 drawing leaves out the rear quarter glass,
  flattens the rear arch and is mirrored (its flap on the wrong side).
- **Photos.** Wikimedia Commons, via the API, 1280–2400 px renditions; record title and
  licence. Near-orthographic side, front and rear shots are the useful ones; scale them by
  the hubs (wheelbase) or the 520 mm number plate.
- **Factory figures**: length × width × height, wheelbase, tracks, clearance, tyre
  (vaz.ru, drom.ru, wiki.zr.ru, autoopt.ru). Never trust a figure from a brief or memory
  without a source (the "1680 mm" 2115 width was wrong; every source says 1650).

### 2. Measure

Working files (crops, grids, overlays) go in `/tmp/<family>/`; only the report is kept.
- Crop the side view, draw a 20 px grid.
- Scale = the drawing's own overall-length dimension (or wheelbase between drawn hubs if
  the hubs disagree with the dimension lines: arches and doors are drawn round the hubs).
  An undimensioned drawing is registered by least squares on features shared with an
  already-measured car (see `measurements-samara.md` §0).
- `s` from the tip of the front bumper, heights from the ground line.
- Measure: overhangs and wheelbase; the bonnet lip and the cowl; windscreen and back light;
  roof front, rear and height; sill, door bottom, belt, glass, rain gutter; every door's
  borders at the belt and at the rail; the boot and its tail; arches; the flap; then the
  front and rear views for every face item (half widths ±inner..outer, heights against the
  bumper's top and the deck).
- Write `measurements-<family>.md` (or a section in the family's file): sources with scale,
  every figure tagged **[D]** drawing / **[P]** photo / **[F]** factory / **[E]** estimate
  with reason, the spec value each became, and a **Gaps** section. Check by overlaying the
  model's lab capture on the drawing.
- Comparing by eye cost a whole iteration once (the first 2106 had a 0.8 m front overhang
  instead of 0.6 and short doors). Measure every number.

### 3. Write the spec

- Find its family. A car sharing stampings with an existing one is written **in that
  family's frame** and only what differs is new (the 2110/2112 are not Samaras: they need
  their own shell `BODY_2110`; the 2112 hatch and 2111 estate would then derive from it as
  the 2109 does from the 2108). Put a new family in its own file (`tens.ts`, like
  `samaras.ts`) with a header comment and the source of every number in comments.
- Choose `platform`: `'classic'`, `'samara'` (any front-drive car; the Oka) or `'niva'`; a
  different dash goes in a `CABIN_*` override in interior.ts. A truly new layout (trucks)
  means a new platform entry in interior.ts `LAYOUTS` and bay.ts.
- Write the `LOOK_*` from the front/rear photos with the item kinds above. Reuse a
  family's look by spreading it (`{ ...LOOK_2108, label, rear }`).
- If the car needs something the language cannot say, add an optional field to `spec.ts`
  whose absence keeps every existing car identical, document it here, and prove it
  ([Proving a refactor](#proving-a-refactor)). Prior examples: `notch`, `FaceLook.lid`,
  moulded `finish` and `moulding`, `rearLean`, `slant`, `flat`, `spoiler`,
  `panel` spans, finish `grey`, `rearArch`, `rearArchRise`, `CabinColumn.foot` (and its
  `round`), `bonnet` (and its `nose`, with front `lid` items), `cornerLamps`,
  `featureLine`, moulded `corner` and `wrapTo`, the centre-line lens, the dash's `heater`
  and vent `half`, rear `cornerLamps` (`end`), `frontLean` (and its `full`), moulded
  `flush`, `screenFoot`, column `drop`, the spoiler on a tailgate, column `finish`, waist `span`,
  `livery`.
- Register it in `KIT_SPECS` (specs.ts): `vaz2110: { id: 'vaz2110', ...BODY_2110, look:
  LOOK_2110, cabinLayout: CABIN_2110 }` (via `onBody` if the family frame differs).

### 4. Register in the catalogue (`vehicle/carmodels.ts`)

- `FACTORY_GEOMETRY`: a `kit_vaz2110` row (length, width, height, clearance, wheelbase,
  tracks, wheel radius, tyre width) with a source comment.
- `KIT_CARS`: `['kit_vaz2110', '<sv_ sibling>', 'vaz2110', 'VAZ-2110']`. The sibling gives
  the running gear (engine, gearbox, springs, masses) and must exist in `SOVIET_CARS`. The
  pack has no 2110/2112/2115 body; the precedent (2115) is the closest sibling
  (`sv_vaz21099`) plus a label. Niva-family siblings (`sv_niva`, `sv_niva_long`) keep their
  off-road wheels automatically.
- A car no catalogue carries (the foreign cars) names its whole running gear instead of a
  sibling: `['kit_nexia', GEAR_DAEWOO_NEXIA, 'nexia', 'Daewoo Nexia']`, a `KitOwnGear`
  (mass, tyre, engine, gearbox, tank, grip, brakes, springs, lock, drive bias, handling
  profile, front share, Cd·A, aero; optional valve, bars, roll centres, diffs) with every
  figure's source. Its engine and gearbox go in `parts/registry.ts`
  (`FOREIGN_ENGINE_VARIANTS`, `FOREIGN_GEARBOX_VARIANTS`), each with a case in
  `render/partmesh.ts` and the engine's maker figures in `tools/reality.ts`
  `FACTORY_ENGINES`; add the car's factory targets to `TARGETS` there. `DRIVER_ODDS`
  (world/traffic.ts) gives a model with no row the default odds.

### 5. Fit row

The catalogue will not load a model without a fit row. Copy a sibling `kit_*` row to the
new id with a bun script (no hand edits of the JSON), then measure it:

```sh
~/.bun/bin/bun -e '
  const p = "src/vehicle/model-fits.json"; const f = JSON.parse(await Bun.file(p).text());
  f.kit_vaz2110 = f.kit_vaz21099; await Bun.write(p, JSON.stringify(f, null, 2) + "\n");'
nice -n 15 ~/.bun/bin/bun tools/fit-models.ts kit_vaz2110
~/.bun/bin/bun tools/dust-flow.ts --write
```

Re-run `fit-models.ts` for every car whose shape changed (it keeps the row's `dustFlow`);
re-run `dust-flow.ts --write` whenever a kit car's `aero` or factory clearance changes, and
`bun tools/dust-flow.ts` must pass. Stage the file as in [Working rules](#working-rules).

### 6. Check

A new or changed spec is accepted only when its fit row (step 5), its triangle row
([Budget](#budget-and-current-figures)) and a passing z-fight run (item 5 below) are all in
place. The z-fight run is not optional and is not judged by eye.

1. `nice -n 10 npx tsc --noEmit -p .`
2. Lab (your Vite on 5199, one tab), the car checked against its photos:
   - four sides and the three-quarters the owner uses; overlay on the drawing;
   - every door, bonnet, boot/tailgate and flap open (`kit(id).activate(...)`): nothing
     pokes through an opening, panels close flush, panes stay inside their doors when
     lowered, a fixed quarter stays where the real one is (door or body);
   - the doors at full real size, the rear door reaching over its arch;
   - at night with lamps on: head, tail, brake, indicators (both, hazard), reversing;
   - dust 0.8 and scratches; a sticker on the body;
   - LOD: the glass fades to a tinted mirror between 30 and 50 m, and from 50 m the
     cabin, bay, boot and underbody vanish behind it; from 6 m the fine detail
     (`KIT_FINE_M`) goes with no hole or pop in the cluster, day and at night lit;
   - the cabin through the glass: dash, gauges, wheel, pedals, seats, every clickable
     fitting.
3. Triangles: within ≈ 8–13k total ([Budget](#budget-and-current-figures)); add the row.
4. The proof that other cars did not move, if the generator changed.
5. Z-fighting and holes (required gate): `nice -n 15 npx tsx tools/kit-zfight.ts kit_vaz2110`
   (all cars without ids, ~15 s). It runs its self-test first (coplanar, gap, occlusion and
   a covered vs an open shell hole), then exits 1 if any car has a visible cluster in any
   band (close, 10-25 m, >25 m/far) or any slit, printing one `FAIL` line per finding with
   the car, band, both emitters (`provA` / `provB`, `file:line`) and the gap; it ends with
   `PASS` and exit 0 otherwise. Fix a cluster by dropping the face that lies inside another
   part (`UPPER_FACES`, `0b111011` in bay.ts, an open back) or laying a decal into its
   surface (`inlay`); a millimetre or two of air only moves the fight further out. A slit
   names the hole's owner and a point in it: the item over it leaves a gap, usually two
   flush walls cut away together.
6. Docs: README (new spec fields, families table, budget row), `STATUS.md` (car row),
   `HISTORY.md` (fixes), `CHANGELOG.md` (an `### Added` entry).

### Writing a spec without z-fighting

The generator already keeps faces apart; a spec stays clean by using its mechanisms
instead of placing faces by hand.

- **Cabin lining comes from the shell.** Pillar trims and headliner are the body's own
  greenhouse and roof faces offset `LINING_DEPTH` inward (`ShellResult.lining`, body.ts).
  Never place upper trim by hand: it would sit on the lining and fight it.
- **Items on the body skin sit in holes.** Anything that stands on a shell part's skin
  declares a `KitHole` (body.ts): `ctx.holes.push({ owner: 'body', outline: { poly } })`,
  where `owner` is the shell part (`body`, `door_fl`, `boot`, `bonnet`, `tailgate`,
  `flap`, …) and `poly` the footprint in the car frame, on the skin's plane.
  `cutShellHoles` cuts that part's `paint` skin away under it, and kit-zfight checks that
  the item covers the hole from every exterior viewpoint (no slit).
- **Flush walls on one end face form a union.** Lamps, grilles, plates and blanks on a
  nose or tail go through `EndFace.place(b, part, prints)` (exterior.ts): what is already
  inside the new part's volume is cut away, the part loses what lies inside earlier
  parts, and of two walls flush in one plane facing the same way the later one stays
  (`keepOutside`). Footprints rooted in the face (`z0 < 0`) add their `KitHole` themselves.
- **Cabin decals are cut into their surface.** A badge, panel frame or label on the dash
  or cluster uses `inlay(b, slot, corners)` (interior.ts), which first cuts the surface
  under it (`cutLocal`) so the decal is the only face there; never lay a quad a fraction
  of a millimetre over another.
- **Every cluster layout drives the same rig channels.** `Vehicle.driveKit`
  (vehicle/vehicle.ts) sets these on every kit car, whatever its `LAYOUTS` / `cabinLayout`
  gauges; a new dial or lamp must read one of them, not a new name:
  - driving: `steer`, `throttle`, `brake`, `clutch`, `handbrake`, `gear` (the rig derives
    `gear_fb` / `gear_lr` for the lever and the reversing glow);
  - gauges: `speed` (km/h), `rpm`, `fuel`, `temp`, `oil` (kgf/cm²), `volts`, `vacuum`
    (economy meter, 0..1);
  - switches: `lights` (0 off, 1 low, 2 high; the rig derives `panel` from it),
    `blinker` (-1/0/1), `hazard`;
  - warning lamps: `tell_turn`, `tell_side`, `tell_beam`, `tell_fuel`, `tell_oil`,
    `tell_charge`, `tell_brake`, `tell_check` (a layout's `lamps.show` picks from the
    names after `tell_`).

## Proving a refactor

When the generator changes but should not change a car, prove it on geometry, not by eye:

1. `git worktree add /tmp/kitbase HEAD` (or the commit to compare against) and
   `ln -s "$PWD/node_modules" /tmp/kitbase/node_modules`.
2. A throwaway bun script imports `buildKitCar` and `KIT_SPECS` from both trees, builds
   every car, and for each mesh takes every triangle's three vertices in the car frame
   (`applyMatrix4(mesh.matrixWorld)` after `root.updateMatrixWorld(true)`), rounded to
   1e-5 m. Each triangle becomes a string with its vertices sorted, the strings are
   sorted (emission order must not matter), joined and hashed (e.g. `Bun.hash`). Print
   hash, triangle count and bounds per car.
3. Identical hashes for every car that should not move; report the cars that did.
4. `git worktree remove /tmp/kitbase`.

Done so far: the descriptions refactor (2108 identical; 2106 0.29 mm in its grille bars),
the Samara generator pieces (2101–2108 identical), the 21099 rear-door rework (2101–2109
identical), `rearArch` for the 2110 (2101–2115 identical against cfff462), the 2110's
review fixes (`foot` and its `round`, `rearArchRise`, `bonnet` and its `nose`, feature
line, bumper `corner`, centre-line lens, `heater`, vent `half`: 2101–21099 identical), and
the third review's lid face, corner lamps and bumper `wrapTo` (2101–21099 identical; the
2115 moved on its lid and lamps, 12 092 → 12 136 triangles, bounds unchanged), and the
fourth review's rear corner lamps and `frontLean` (2101–2107 identical, the estates'
`rearLean` through the shared `leanEnd` included; the Samaras moved by design, same
triangle counts and bounds), and the 2112 round (`flush`, `screenFoot`, column `drop`,
`frontLean.full`, the nose split, the greenhouse foot at stations, the tailgate spoiler:
the classic saloons 2101, 2103, 2105–2107 identical against cfff462; the estates moved
only by the closed rear-quarter slits, the Samaras and tens by design), and the shell
lining with its seals and the tail clusters without a backing plate (2026-10-15: every car
moved by design, inside the greenhouse and on its tail lamps; all 13 fit rows identical to
HEAD's, so the bounds, wheel mounts and bonnet point did not move), and the flat-run
merge `simplifyFlats` with the simple corner lamps, the bumper chamfer and the 2115's
wrapped rear bumper (2026-10-15, against c3ebe42: every car moved by design, 8–18% fewer
triangles, all 13 bounds identical; fit rows identical but for the 2110's and 2112's
`hoodPoint` height, 17 mm lower, because the bonnet window it samples by vertex lost an
inner vertex of a flat run: the bonnet itself did not move; 15 WebGL programs after boot
in the lab, and night, lamps and opened parts add none the head build does not), and the
one-material, one-draw car (2026-10-15, against 5a9136e: all 13 identical by every
mesh's triangles; only attributes and materials changed), and the Nivas' and the Oka's
generator additions (platform `niva` with `clearance`/`nivaTransfer`, `bench.clear`,
`lenses`, `transfer`, the tailgate `lidFace`, `mirrors`: 2026-10-16, all 13 earlier cars
identical).

## Budget and current figures

Budget ≈ 8–13k triangles per car near, with LOD at `KIT_DETAIL_M`. Counted by building each
car with `buildKitCar` and summing triangles per group (2026-10-15, after the flat-run
merge `simplifyFlats`, which took 8–18% off every car, most off the tens; the cabin's fine
detail tier's window and dial stand-ins are in);
the wheels are the kit's placeholder wheels (336 each) that the pack's sets replace.
"Cabin" includes the door trim hung in the doors, "of it fine" is the part drawn only
within `KIT_FINE_M`; "Far" = everything except the four detail groups.

| | Total | Body + trim | Cabin | of it fine | Engine bay | Boot | Underbody | Wheels | Far |
|---|---|---|---|---|---|---|---|---|---|
| 2101 | 11 229 | 5 082 | 3 554 | 1 479 | 401 | 284 | 564 | 1 344 | 6 426 |
| 2102 | 11 215 | 5 239 | 3 607 | 1 479 | 401 | 60 | 564 | 1 344 | 6 583 |
| 2103 | 11 808 | 5 137 | 4 078 | 1 889 | 401 | 284 | 564 | 1 344 | 6 481 |
| 2104 | 11 543 | 5 195 | 3 973 | 1 619 | 421 | 46 | 564 | 1 344 | 6 539 |
| 2105 | 11 771 | 5 198 | 3 960 | 1 619 | 421 | 284 | 564 | 1 344 | 6 542 |
| 2106 | 12 260 | 5 696 | 3 971 | 1 747 | 401 | 284 | 564 | 1 344 | 7 040 |
| 2107 | 12 452 | 5 201 | 4 638 | 1 969 | 421 | 284 | 564 | 1 344 | 6 545 |
| 2108 | 10 229 | 3 811 | 4 019 | 1 567 | 561 | 46 | 448 | 1 344 | 5 155 |
| 2109 | 11 394 | 4 661 | 4 334 | 1 751 | 561 | 46 | 448 | 1 344 | 6 005 |
| 21099 | 11 620 | 4 802 | 4 403 | 1 751 | 561 | 62 | 448 | 1 344 | 6 146 |
| 2115 | 12 224 | 5 407 | 4 403 | 1 751 | 561 | 61 | 448 | 1 344 | 6 751 |
| 2110 | 13 723 | 6 363 | 4 877 | 1 775 | 627 | 52 | 460 | 1 344 | 7 707 |
| 2112 | 13 634 | 6 349 | 4 794 | 1 775 | 627 | 60 | 460 | 1 344 | 7 693 |
| 2111 | 13 770 | 6 469 | 4 810 | 1 775 | 627 | 60 | 460 | 1 344 | 7 813 |
| 2121 | 11 852 | 4 762 | 4 451 | – | 421 | 60 | 814 | 1 344 | 6 106 |
| 2131 | 12 974 | 5 593 | 4 730 | – | 421 | 60 | 826 | 1 344 | 6 937 |
| 1111 | 10 595 | 4 347 | 3 813 | – | 597 | 46 | 448 | 1 344 | 5 691 |
| GAZ-24 | 13 366 | 6 558 | 4 209 | 1 747 | 401 | 294 | 560 | 1 344 | 7 902 |
| GAZ-31029 | 11 888 | 5 018 | 4 247 | 1 747 | 421 | 294 | 564 | 1 344 | 6 362 |
| AZLK-2141 | 12 131 | 5 243 | 4 411 | 1 751 | 617 | 60 | 456 | 1 344 | 6 587 |
| Nexia | 13 472 | 6 072 | 4 909 | 1 761 | 639 | 52 | 456 | 1 344 | 7 416 |
| Espero | 14 389 | – | – | – | – | – | – | 1 344 | – |
| Astra F | 13 578 | – | – | – | – | – | – | 1 344 | – |
| Vectra A | 13 509 | – | – | – | – | – | – | 1 344 | – |
| UAZ-469 | 11 152 | 4 860 | 3 810 | 1 507 | 418 | 32 | 688 | 1 344 | 6 204 |
| UAZ-469 police | 11 501 | 5 209 | 3 810 | 1 507 | 418 | 32 | 688 | 1 344 | 6 553 |

The owner set the budget aside for the 2110 and 2112 (the rounded rear shut line adds side
rows to every tub column).

Lowest point of the body: 0.170 m, the factory ground clearance (the classic's diff, the
Samara's fuel tank; silencers 25 mm above it).

## Telling the classics apart: 2101 / 2103 / 2105 / 2106 / 2107

The silhouette barely separates the 2101, 2103 and 2106: they share one body and differ by
about 50 mm in length (bumpers). They are recognised by the face, the tail, the trim and the
dashboard. The 2105 and 2107 share their own, squarer body. Numbers and sources in
`measurements-classics.md`.

| | 2101 | 2103 | 2106 | 2105 | 2107 |
|---|---|---|---|---|---|
| Body | 124 | 124 | 124 | "05" | "05" |
| Front | 2 round lamps by a wide chrome grille | 4 round lamps inside one chrome grille | 4 round in black surrounds in a chrome frame, chrome-framed grille | the 2107's lamp units on its black surround, flush black grille with horizontal bars | taller units in a black band, tall chrome grille standing out |
| Bumpers | thin chrome, chrome fangs | chrome, chrome fangs | chrome, rubber strip and blocks, black end caps | aluminium, black lip and end caps | chrome over black, black ends |
| Tail | small chrome-rimmed lamps, reversing lamps apart | chrome surround round lamps and plate | a chrome outline round the panel between the lamps (body colour: the owner's call, the real one is black), 3×3 cells | wide lamps, 2×3 cells (no wrap: checked on a side photo) | as the 2105, two rows |
| Side | chrome sill, round repeater | chrome waist and sill | waist with black insert, chrome sill | black ribbed sill strip | painted |
| Quarter lights / rear-door fixed pane | yes / – | yes / – | yes / – | no / yes | no / yes |
| Head restraints | no | no | yes | yes | yes |
| Dashboard | ribbon speedometer | five dials in a row on wood | wood, round dials | own pod, padded | "euro" panel |

The estates (2102 on the 124 shell, 2104 on the 05) reuse their saloons' face, side and
dash. Their tail stations are `flat: 1`, so the deck lies level out to the pillar row and
the tailgate (no `bootEnd`, hinged at the roof, folded at `rearKnee`) gets a flat sill with
upright sides between the corner lamps; `rearLean` rakes the whole back. The filler is on
the left (`flap.side`). The rear bench is pulled forward with `cabinLayout.bench`, and the
load floor starts at the bench (`loadSpaceStart`) and never sinks below the floor pan.

The Samaras share the 2108's shell from the nose to the B pillar and all its heights
(numbers in `measurements-samara.md`), and a face raking back from the bumper's top to the
bonnet's lip (`frontLean`). The 2108's face is a body-colour slotted panel
between trapezoid (`slant`) headlamps. The 2109 changes only the greenhouse columns: a
shorter front door, a full-size rear door (`door2`) raked along the C pillar and a smaller
fixed quarter light behind it. The 21099 adds a saloon tail: a raked back light, a boot lid
(`bootEnd`) and its own lamps; behind its rear door (whose shut line runs unbroken from the
sill to the rail) the body carries a small fixed quarter glass and a C pillar of even
width parallel to the back light. The 2115 is the 21099 moved back 45 mm by its longer
front bumper, with its own nose (the late face nearly the body's full width at the lamps,
standing over a shallow body-colour bumper: moulded, `finish: 'paint'`, `flush`, its sides
on the wings to the arch, as the rear one's to the rear arch) wearing a grey `moulding` band in line with grey door mouldings (`waist`,
`finish: 'grey'`), the late face (a `cornerLamps` unit: tall head lamps whose top slopes
down at the inner end, the indicator at the corner wrapping a little round it; a slot under
the bonnet lip; a dark intake strip under the band; fog lamps low at the bumper's corners),
a boot lid that comes down between the corner lamps (`notch` on its last station) carrying
the lamp bar (`rear.lid`), corner tail lamps wrapping onto the wings (`cornerLamps`, the
amber outer cell round the corner), and a boot-lid `spoiler` with the high brake lamp. All
four Samaras have a screen curved in plan (`screenFoot`) and an A pillar chamfered into the
roof (column `drop`).

The 2110 (`tens.ts`, `measurements-2110.md`, the base early car without spoiler or
mouldings) is its own shell on the `samara` platform with its own dash (`CABIN_2110`): a
2492 wheelbase, a waist rising 60 mm from the A to the C pillar with a pressed feature line
under the windows (`featureLine`), a narrower greenhouse (rail ±0.53), the rear door's shut
line raked back along the C pillar and, below the belt, forward to the sill in front of the
arch with rounded turns (`foot`, `round`), a fixed quarter glass in the body behind it, a
front arch clear of the tyre and a low rear arch covering its top (`rearArch` 1.0,
`rearArchRise` 0.81), a bonnet over the whole top whose nose comes down between the head
lamps carrying the slot (`bonnet`, front `lid`). Its tail is the 2115's arrangement (the 2115 took it
from the 2110): the boot lid comes down between corner lamps (`notch`) carrying the lamp bar
(`rear.lid`: reversing lamps at its ends, one red reflector across the middle); a nose
rounded in plan with a rounded body-colour bumper whose sides lie on the wings back to the
wheel arch (`corner`, `wrapTo`), carrying a dark intake and fog-lamp recesses; narrow head
lamps flush with the body with a dark slot between them, the solid amber indicators
wrapping a short way round the corners, and the tail lamps (indicator over the tail and
stop lamps) wrapping onto the wings (`cornerLamps`). The face leans back from the crease to
the bonnet's lip (`frontLean`), over a bumper whose top stays below the lamps; both
bumpers are `flush`. The screen is curved in plan (`screenFoot`) and the A pillar
chamfered into the roof (column `drop`).

The 2112 (`BODY_2112`, `LOOK_2112`) is the 2110 to the rear door with its own hatch tail
(`vaz_2112.jpg` and Commons photos): a quarter glass in the body to 3.71 and a wide D
pillar, the roof ending at 3.285, a tailgate whose glass falls to the knee over the lamps
(`rearKnee`) and whose lower panel comes down to the bumper between corner lamps topped at
0.865 (`flat` tail station, `rearLean` 0.2), a reversing lamp at each end of the tailgate
and a red bar between, a tall flush rear bumper, and a wing on the tailgate's glass with
the high brake lamp (`spoiler`).

The 2111 (`BODY_2111`, `LOOK_2111`) is the 2110 to the rear door's belt with an estate
tail (`vaz_2111.jpg` and Commons photos): the rear door's frame further back at the rail,
a long quarter glass in the body to a D pillar, the roof on to 3.97, the 2112's tail
arrangement at the estate's heights (corner lamps topped at 0.89, the tailgate between
them down to the bumper with its reversing cells and red bar, `flat` tail station,
`rearLean` 0.1), no spoiler and no roof rails.

## The Volgas: GAZ-24 / GAZ-31029

Both are `classic`-platform cars in `volgas.ts` (`measurements-volga.md`). The GAZ-24
(`gaz_24.jpg`, the factory four-view with its dimension lines) has a level belt crease
nose to tail with the handles on it, front doors with quarter lights, rear doors whose
glass ends upright ahead of a blind sail raked along the C pillar, a front arch clear of
the tyre and a rear one covering its top; its face is a full-width grille of upright
chrome bars between round lamps, with a chrome blade and fangs; at the back tall corner
lamps in chrome rims and a ribbed chrome band; the filler under an oval flap on the left
rear wing. The GAZ-31029 takes the 24's columns and middle stations 0.14 further back
(its longer nose) and adds its own ends from the-blueprints.com drawing: a square face
with rectangular head lamps whose indicators wrap round the corners (`cornerLamps`), a
black grille, black bumpers, and a lower boot whose lid comes down the tail face between
the wings (`notch`) over horizontal lamps wrapping onto them.
