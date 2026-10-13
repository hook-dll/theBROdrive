# carkit: VAZ cars generated at load time, interior included

`src/carkit` builds a car from a numeric spec as a `THREE.Group`, the same scene a GLB/FBX
loader would return. From there the car goes through the usual pipeline in
`render/carmodel.ts` (`buildTemplate`), so it gets paint, dust, scratches, stickers, glass
dirt, lamps and fitting to the factory dimensions on the same terms as every other model.

The cars are shown in the car lab only (`/?car-lab&pack=Kit`); they are absent from traffic,
the garage, spawns and POIs.

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
full checks (tsc, hashes, lamps at night, shader programs, fit rows), write the docs
(this file, STATUS, HISTORY, CHANGELOG, measurements) and commit.

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
  time. The kit has one shared material per slot (`materials.ts`); LOD changes only
  visibility and uniforms (`KitRig.setDetail`); never toggle a light's `visible` or
  `castShadow`; a new `onBeforeCompile` patch needs a stable shared `customProgramCacheKey`.
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
| `tens.ts` | The "tens": `BODY_2110` / `LOOK_2110` (the 2112 and 2111 are to derive from it). |
| `measurements-classics.md`, `measurements-estates.md`, `measurements-samara.md`, `measurements-2110.md` | Measurement reports: every figure with its drawing or photo, scale and tag. |
| `builder.ts` | `PartBuilder`: flat triangles per material slot, transform stack, primitives (`box`, `bevelBox`, `extrude`, `cylinderX/Y/Z`, `torusY`, `bridge`, `poly`), vertex colours. |
| `body.ts` | `BodyFrame` (cross-section, deck and lid lookups) and `buildShell`: tub, greenhouse and roof as one face list, then cut into parts. Shell constants (`SHUT_GAP`, `JAMB_DEPTH`, `DOOR_THICKNESS`, `NOTCH_WALL`, …). |
| `exterior.ts` | End faces (`FaceLook.items` / `.lid`), bumpers swept round the corners, sill strip, flank strips (waist moulding, feature line: `buildFlankStrip`), repeaters, flank lamps, mirrors, handles, wipers, filler neck. |
| `interior.ts` | Trim, dashboard, gauges, wheel, pedals, levers, seats, door cards. Per-platform layout table `LAYOUTS`, per-car overrides `CABIN_2101/2103/2105/2107/2110`. |
| `bay.ts` | Engine bay (`kit_bay`), boot (`kit_boot`), underbody (`kit_under`). |
| `wheels.ts` | The kit's own placeholder wheel (tyre on a plain steel disc): sets where the wheels stand and their size. |
| `materials.ts` | One shared material per slot. |
| `names.ts` | Node names the catalogue selects by (wheels, lamps, glass). No imports, so the catalogue can include it. |
| `context.ts` | `KitContext`, `addBuilt`, `pivotGroup`, `attach`: how modules put geometry into the scene. |
| `kit.ts` | `buildKitCar(id)`: assembles everything; hinge motions of the shell's parts (`shellMotion`); `leanEnd` (`rearLean`, `frontLean`). |
| `rig.ts` | `KitRig`: runtime channels, controls, lamps, LOD. |

Integration outside the folder:

- `vehicle/carmodels.ts`: `CarModelDef.kit` (build from a spec instead of reading `file`),
  `CarModelDef.clearGlass`, `FACTORY_GEOMETRY` rows `kit_*`, the `KIT_CARS` list (each kit
  car on the running gear of an `sv_*` sibling), `DISTINCT_SOVIET_WHEEL_SETS`, and
  `LAB_CAR_MODELS` (resolvable through `carModel(id)` but absent from `CAR_MODELS`, which
  feeds traffic and spawns).
- `render/carmodel.ts`: `loadModel` calls `buildKitCar`. Clear glass comes from
  `carClearGlassMaterial`. A cabin mesh with `userData.kitShadowed` receives shadows.
  `cloneWheels` rescales the pack's wheel sets to the kit tyre.
- `render/materials.ts`: dust on glass raises opacity, so dirty clear glass is not
  see-through. On opaque glass this changes nothing.
- `car-lab.ts`: the Kit row, the `?pack=` filter, hover and click, the "КАБИНА" panel, LOD at
  25 m, `window.__carLab`.
- `vehicle/model-fits.json`: a measured fit row for every kit car (`tools/fit-models.ts`).

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
   roof rail. A hatchback's tailgate folds at `rearKnee`, and the last side column folds
   there with it so the D pillar lies flush.
4. **End faces** are earcut (`THREE.ShapeUtils.triangulateShape`), never fanned: an
   estate's or notched tail is concave.
5. **Cutting.** Faces are grouped by owner:
   - owners: `body`, `door_fl/fr/rl/rr`, `bonnet`, `boot`, `tailgate`, `flap`, `window_*`,
     `vent_*`, `quarter_*`;
   - gaps: each opening part's edge pulls in by half a gap (`SHUT_GAP`) and the body's edge
     pushes out by the other half;
   - jamb flanges go on the body (`JAMB_DEPTH`), end faces and an inner skin go on the
     parts (`DOOR_THICKNESS`, `LID_THICKNESS`);
   - the door card below the belt is in the upholstery colour;
   - glass is recessed (`GLASS_INSET`) and edged with dark rubber.
6. **Hinges.** Pivots come from each part's geometry: door at its front edge, bonnet at
   its rear edge, boot lid at its front edge, tailgate at its top edge, flap at its front
   edge, quarter light at its rear post, drop glass at its own bottom edge. Panes
   (`window_*`, `vent_*`, `quarter_*`) ride inside their door. Opening angles are in
   `shellMotion` (kit.ts).
7. **Exterior, interior, bay** are added (`buildExterior`, `buildInterior`, `buildBay`).
8. **`rearLean`** and **`frontLean`**, if set, warp the finished back or nose (kit.ts `leanEnd`).
9. **Wheels** (`kit_wheel_*`) are added last and never warped.

## Spec reference

A car is `KIT_SPECS[id]: KitCarSpec` = a **body** (`KitBody`, the shape) + a **look**
(`KitLook`, the styling) + an optional **cabin override** (`cabinLayout`). All lengths in
metres in the frame above. Exact types: `spec.ts`; this is what each field means to an
author.

### Body (`KitBody` = `KitCarSpec` without `id`, `look`, `cabinLayout`)

| Field | Meaning |
|---|---|
| `length` | Bumper tip to bumper tip, as built (the loader then fits it to `FACTORY_GEOMETRY`). |
| `platform` | `'classic'` or `'samara'`: picks the interior layout (`LAYOUTS` in interior.ts) and the engine bay / underbody in bay.ts. |
| `stations` | `TubStation[]`, nose to tail; the first is the front face, the last the tail face. |
| `cabin` | `CabinSpec`: the greenhouse. |
| `wheels` | `WheelSpec`: axles, tyre, tracks, arches. |
| `shoulder` | `{ inset, rise }`: the belt turns in by `inset` and up by `rise` to the deck's edge. |
| `doorBottom` | Height of the doors' bottom edge (top of the sill under them). |
| `bonnetFront` | `s` where the bonnet starts; it runs to the cowl. |
| `bonnet?` | `{ inset, nose? }`: the bonnet's side cut `inset` in from the deck's edge instead of at the pillar row (the 2110's covers the whole top, its shut lines along the wings' top edge); it ends 12 mm (`SCUTTLE`) short of the cowl and the bay's inner wings stand under the cut. `nose: { y, half: [bottom, top] }`: the bonnet comes down the front face between the head lamps to height `y` (set `bonnetFront` to the first station); `front.lid` items ride on it. Absent: the pillar-row bonnet. |
| `bootEnd` | `s` where a boot lid ends (it runs from the back light's foot). **Absent = a tailgate** hinged at the roof. Equal to the last station's `s` with a `notch` there, the lid comes down the tail face (2115, 2110): its top turns down to a line across at the corners' top and its rear panel lies in the tail face between the corner lamps (`BodyFrame.lidFace`). |
| `rearLean` | `{ base, lean, blend }`: above height `base`, every point behind the rear base moves forward `lean` m per m of height, faded in over `blend` m ahead of it. Makes an estate's tailgate, lamp corners and lamps one raked plane. Built (closed) pose is warped, so parts still close flush. |
| `frontLean` | The same at the nose (kit.ts `leanEnd`): above `base`, every point ahead of the bonnet's front edge moves back `lean` m per m of height, faded out over `blend` m behind it. The Samaras' face and lamps rake back from the bumper's top to the bonnet's lip (`BODY_2108`: base 0.625, lean 0.36, blend 0.15). |
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
| `railInset`, `railRise` | The rail's chamfer onto the roof. |
| `glassBottom`, `glassTop` | Side glass: bottom above the belt, top below the rail. |
| `screenBottom`, `screenHeader` | Windscreen base strip above the cowl, header below the rail. |
| `rearBottom`, `rearHeader` | Same for the back light. |
| `rearKnee?` | `{ s, y }` on the centre line where a hatch's tailgate folds: glass above, painted panel below. Absent: the back light runs straight to its base. |
| `pillar` | Pillar strip width at the windscreen and back-light edges. |

**`CabinColumn`** — `{ s, top, upper?, lower?, glass? }`: `s` where the column stands at the
belt, `top` where it meets the rail (`top ≠ s` = raked pillar). The rest describe the strip
**from this column to the next**: `upper` / `lower` own it above / below the belt
(`'body'`, `'door1'` = front door, `'door2'` = rear door; `lower` defaults to `upper`, and
below the belt a door may overlap a pillar), `glass` is `'none'`, `'drop'` (wind-down, `window_*`), `'vent'` (quarter light,
`vent_*`) or `'fixed'` (a fixed pane: in the body if `upper: 'body'`, else it rides with the
door as `quarter_*`). `foot?: { y, s, round? }` rakes the shut line on this column below
the belt: upright down to `y`, then straight to `s` at the doors' bottom (the 2110's rear
door, whose edge runs forward to the sill in front of the arch); `round: [upper, lower]` are
the radii of its two turns (`BodyFrame.shutLine`). The side faces it crosses are clipped
along it, and the body's piece behind it gets cabin trim. A door's frame strips are short
strips with `glass` absent. Example —
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
| `BODY_2110` | 2110 drawing (`tens.ts`) | 2110 |

### Look (`KitLook`)

| Field | Meaning |
|---|---|
| `label` | Display label (`'VAZ-2108'`). |
| `upholstery`, `dash` | Interior vinyl and dash colours (hex). |
| `headrests` | Head restraints on the front seats. |
| `front`, `rear` | `FaceLook`: one end of the car. |
| `brightwork` | `Finish` of door handles and mirrors. |
| `sill` | `Finish` of a strip along the sill between the arches, or `null`. |
| `waist` | `{ y, height, finish }`: a moulding along the flank, broken at the shut lines (each piece riding on its door) and stopping `MOULDING_ARCH_GAP` (30 mm) short of a wheel arch it would run into (the 2115's low door mouldings; the classics' strips sit above their arches and are not cut); or `null`. |
| `repeater` | `{ s0, s1, y0, y1 }`: the amber side repeater on each front wing, or `null`. |
| `spoiler?` | `SpoilerLook`: a body-colour boot-lid wing with the high brake lamp, hung on the boot node so it lifts with the lid (exterior.ts `buildSpoiler`). Fields: `half` (half span), `plate` (end-plate width), `s0`/`s1` (wing leading/trailing edge, car frame like `repeater`), `top0`/`top1` (its top at each), `thickness`, `foot` (`s` where the end plates meet the lid), `pedestal: { half, s0, s1 }` (under the wing's middle), `lamp: { half, y0, y1 }` (the brake lens on the pedestal's back). The lens is a `lamp_brake` mesh, so it lights with every other brake lamp. The 2115's. |
| `cornerLamps?` | `CornerLamp[]`: a lamp unit lying flush on the body (4 mm off it) from its inner end on an end face round the corner and along the flank (exterior.ts `buildCornerLamps`, laid on the skin as built, body.ts `skinX`). `end`: `'front'` (default) or `'rear'`. `points`: `{ x }` on the face (half width, or `[bottom, top]` for a leaning edge), `{ s }` on the flank (car frame), or neither for the corner itself; `y: [bottom, top]` there; the stretch after a point is a lens in its `role`'s slot. Stacked lamps (an indicator over a tail lamp) are separate units. Keep a unit below the end station's belt so it stays on the flat face and side (the shoulder above it is the corner's straight cut). The 2115's and 2110's head lamps and indicators (solid amber) and their tail lamps. |
| `featureLine?` | `{ points: [s, y][], height }`: a pressed line along each flank, a 5 mm painted ridge through the points, broken at the shut lines and riding on the doors like the waist. The 2110's line under the windows. |

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
| `grille` | `x: FaceX` (half width), `y`, `standOut?`, `frame?: { finish, margin }`, `back`, `bars: { dir, count, finish, margin, width, depth, proud }` | Grille or slot; `standOut` lifts the whole grille out of the face (the 2107's; the 2115's lower intake). |
| `cluster` | `x: Span<FaceX>`, `y: Span<FaceY>`, `columns: LampRole[][]` | Tail-lamp cluster in a black housing: columns from the outer edge in, each column's roles top to bottom. |
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
  `null`).
- `moulded`: `drop` (foot under the sill's bevel), `height`, `finish?` (absent = dark
  plastic; `'paint'` = body colour, its groove a painted ridge), `moulding?: { y, height,
  finish }` (a band round the bumper instead of the groove: centre height above the
  ground; the 2115's grey band, in line with its door mouldings), `corner?` (plan radius
  where it turns round to the flanks, 0.09 by default; the 2110's front 0.28), `wrapTo?`
  (`s` its sides follow the flanks back to, lying on them with its foot in line with the
  sill; the 2110's front runs to its wheel arch).

### Cabin override (`cabinLayout`)

`Partial<Layout>` (interior.ts) over the platform's layout. Fields a car may change: seat
`hip`, rear `bench` (`{ from: 'rearBase' | 'hip', offset }`; the estates pull it forward),
`cushion`/`benchCushion`, `recline`, `bolsters`, `seatX`, toe board, `tunnel`, `console`,
the `dash` and `fascia` sections, `wood` band, `binnacle` and `cluster`, `gauges` (round or
ribbon), steering `wheel` (position, rake, radius, spokes, hub), `pedals`, `gear`,
`handbrake`, `glovebox`, `radio`, `ashtray`, `hazard`, `lights` switch, `vents` (each with
an optional opening size `half`), `eyeballs`, `clusterFace`, `lamps` (telltales), `rockers`,
`stack`, `heater?` (a heater panel with knobs: `{ dy, half, knobs, radius }`), `carpet`,
`headliner`. In `Layout`, `ds` is metres behind the cowl and `dy` an offset from the belt
at the cowl. Existing dashes: `CABIN_2101` (ribbon speedometer), `CABIN_2103` (five dials on
wood), `CABIN_2105` (own pod), `CABIN_2107` (one-piece "euro" panel), `CABIN_2110` (tall
face, hood over swapped big dials, two big centre vents, heater panel, radio low in the
stack); the Samaras use the `samara` platform's layout as is.

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

A node that can be clicked carries `userData.kitControl = { id, label, action? }`, where
`action` is `toggle` (default, flips the channel `id`), `cycle` (steps through values) or
`press` (held down, as the horn). A click on any mesh below the node counts. A part that
does not move (a door's fixed `quarter_*` pane) is not a control.

| Group | Channels |
|---|---|
| Driving | `steer` −1..1, `throttle`, `brake`, `clutch`, `handbrake` 0..1, `gear` −1..5 |
| Derived from `gear` | `gear_fb`, `gear_lr` (H-pattern, `GEAR_GATE`) |
| Instruments | `speed` km/h, `rpm`, `fuel`, `temp` 0..1 |
| Light and signals | `lights` 0/1/2, `blinker` −1/0/1, `hazard`, `horn` |
| Wipers and radio | `wipers` 0/1/2 → `wiper_sweep`; `radio` → `radio_tune` |
| Body | `door_*`, `bonnet`, `boot`, `tailgate`, `flap`, `window_*`, `vent_*` |
| Cabin | `glovebox`, `ashtray`, `visor_l/r`, `seat_*`, `seatback_*`, `headrest_*` |

In the lab the rig lights the lamps from the channels: low/high beam and tail lamps from
`lights`, brake lamps from `brake`, reversing lamps from `gear < 0`, indicators from
`blinker` and `hazard` at 90 flashes a minute. In the game `VehicleLamps` does it through
the def's `lights`, and the rig is created with `ownLenses = false`.

`setDetail(near)` switches only the visibility of the detail groups and the glass opacity,
so crossing the LOD distance (25 m) triggers no shader compile.

## Wheels: the Soviet pack's sets

A kit car is shod from `DISTINCT_SOVIET_WHEEL_SETS` (carmodels.ts: the pack's six wheel
designs, `sv_gaz21`, `sv_gaz24`, `sv_vaz2101`, `sv_vaz2103`, `sv_vaz2106`, `sv_vaz2108`, once
each), one set on all four wheels per instance, picked by its appearance key and rescaled
by `cloneWheels` to the kit's own tyre. A sibling on the Niva pool
(`OFFROAD_WHEEL_SET_POOL`) keeps it. The kit's own wheel (`buildWheel`) only sets where the
wheels stand and how big they are. In the lab, `Экземпляр` (and `?variant=`) steps the
appearance key: paint and wheels change together.

## Lab

- URL: `http://localhost:5199/?car-lab&pack=Kit&time=12` (only the kit row; `time` hours,
  `variant`, `dirt`, `scratches`, `focus` seed state).
- Hovering shows a part's name; a click works it. A drag is the camera, not a click.
- Choosing a car opens the "КАБИНА" panel on the right: sliders for the driving inputs and
  a button per clickable part.
- Automation, `window.__carLab` (`CarLabApi` in car-lab.ts):
  - `focus(id, azimuth, elevation, distance)` — orbit framing;
  - `look(id, [camera], [target])` — coordinates relative to the car (front is +z);
  - `kit(id).set(channel, v)`, `.activate(controlId)` (`'door_fl'`, `'door_rl'`, `'bonnet'`,
    `'boot'`, `'tailgate'`, `'flap'`, `'window_fl'`, …), `.controls()`;
  - `set({ dirt, scratches, timeHours, variant })`;
  - `capture()` — PNG data URL of the frame;
  - `models` — ids in the lab.

## Adding a car end to end

Worked example: the VAZ-2110, done this way (`tens.ts`, `measurements-2110.md`); the 2112
is next. Follow the steps in order.

### 1. Sources

- **Drawing.** Try `https://3dcar.ru/media/blueprints/full/vaz/<name>.jpg` (names seen:
  `vaz_2101` … `vaz_2107_1982`, `vaz_2109`, `vaz_21099`, `vaz_2110`, `vaz_2111`,
  `vaz_2112`, all three saved). Save under `build/carshape/_refs/bp/img/` (gitignored, local
  only) and run `file` on it: a missing drawing comes back as an HTML 404 page with a
  `.jpg` name (`vaz_2115.jpg` there is one). Factory four-views already there:
  `vaz2101.jpg`, `vaz2108.jpg`, `niva.jpg`, `uaz469.jpg`, `uaz2.jpg`, `gaz21.jpg`,
  `moskvich412.jpg`, `zaz968.jpg`, …
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
- Choose `platform`. Only `'classic'` and `'samara'` exist; a front-drive car takes
  `'samara'`, and a different dash goes in a `CABIN_*` override in interior.ts. A truly new
  layout (Niva, Oka, trucks) means a new platform entry in interior.ts `LAYOUTS` and bay.ts.
- Write the `LOOK_*` from the front/rear photos with the item kinds above. Reuse a
  family's look by spreading it (`{ ...LOOK_2108, label, rear }`).
- If the car needs something the language cannot say, add an optional field to `spec.ts`
  whose absence keeps every existing car identical, document it here, and prove it
  ([Proving a refactor](#proving-a-refactor)). Prior examples: `notch`, `FaceLook.lid`,
  moulded `finish` and `moulding`, `rearLean`, `slant`, `flat`, `spoiler`,
  `panel` spans, finish `grey`, `rearArch`, `rearArchRise`, `CabinColumn.foot` (and its
  `round`), `bonnet` (and its `nose`, with front `lid` items), `cornerLamps`,
  `featureLine`, moulded `corner` and `wrapTo`, the centre-line lens, the dash's `heater`
  and vent `half`, rear `cornerLamps` (`end`), `frontLean`.
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

### 5. Fit row

The catalogue will not load a model without a fit row. Copy a sibling `kit_*` row to the
new id with a bun script (no hand edits of the JSON), then measure it:

```sh
~/.bun/bin/bun -e '
  const p = "src/vehicle/model-fits.json"; const f = JSON.parse(await Bun.file(p).text());
  f.kit_vaz2110 = f.kit_vaz21099; await Bun.write(p, JSON.stringify(f, null, 2) + "\n");'
nice -n 15 ~/.bun/bin/bun tools/fit-models.ts kit_vaz2110
```

Re-run `fit-models.ts` for every car whose shape changed. Stage the file as in
[Working rules](#working-rules).

### 6. Check

1. `nice -n 10 npx tsc --noEmit -p .`
2. Lab (your Vite on 5199, one tab), the car checked against its photos:
   - four sides and the three-quarters the owner uses; overlay on the drawing;
   - every door, bonnet, boot/tailgate and flap open (`kit(id).activate(...)`): nothing
     pokes through an opening, panels close flush, panes stay inside their doors when
     lowered, a fixed quarter stays where the real one is (door or body);
   - the doors at full real size, the rear door reaching over its arch;
   - at night with lamps on: head, tail, brake, indicators (both, hazard), reversing;
   - dust 0.8 and scratches; a sticker on the body;
   - LOD: from beyond 25 m the cabin, bay, boot and underbody vanish and the glass goes
     opaque;
   - the cabin through the glass: dash, gauges, wheel, pedals, seats, every clickable
     fitting.
3. Triangles: within ≈ 8–13k total ([Budget](#budget-and-current-figures)); add the row.
4. The proof that other cars did not move, if the generator changed.
5. Docs: README (new spec fields, families table, budget row), `STATUS.md` (car row),
   `HISTORY.md` (fixes), `CHANGELOG.md` (an `### Added` entry).

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
triangle counts and bounds).

## Budget and current figures

Budget ≈ 8–13k triangles per car with LOD at 25 m. Counted by building each car with
`buildKitCar` and summing triangles per group; the wheels are the kit's placeholder wheels
(336 each) that the pack's sets replace. "Beyond 25 m" = everything except the four detail
groups.

| | Total | Body + trim | Cabin | Engine bay | Boot | Underbody | Wheels | Beyond 25 m |
|---|---|---|---|---|---|---|---|---|
| 2101 | 11 497 | 5 071 | 2 985 | 1 053 | 298 | 746 | 1 344 | 6 415 |
| 2102 | 11 416 | 5 278 | 2 945 | 1 053 | 50 | 746 | 1 344 | 6 622 |
| 2103 | 12 205 | 5 591 | 3 173 | 1 053 | 298 | 746 | 1 344 | 6 935 |
| 2104 | 11 740 | 5 350 | 3 189 | 1 073 | 38 | 746 | 1 344 | 6 694 |
| 2105 | 12 139 | 5 439 | 3 239 | 1 073 | 298 | 746 | 1 344 | 6 783 |
| 2106 | 12 607 | 6 023 | 3 143 | 1 053 | 298 | 746 | 1 344 | 7 367 |
| 2107 | 12 347 | 5 299 | 3 587 | 1 073 | 298 | 746 | 1 344 | 6 643 |
| 2108 | 10 226 | 3 782 | 3 195 | 1 247 | 38 | 620 | 1 344 | 5 126 |
| 2109 | 11 350 | 4 666 | 3 435 | 1 247 | 38 | 620 | 1 344 | 6 010 |
| 21099 | 11 707 | 4 909 | 3 519 | 1 247 | 68 | 620 | 1 344 | 6 253 |
| 2115 | 12 112 | 5 314 | 3 519 | 1 247 | 68 | 620 | 1 344 | 6 658 |
| 2110 | 14 823 | 7 557 | 3 927 | 1 307 | 56 | 632 | 1 344 | 8 901 |

The owner set the budget aside for the 2110 (its rounded rear shut line adds side rows to
every tub column).

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
| Tail | small chrome-rimmed lamps, reversing lamps apart | chrome surround round lamps and plate | black panel in a chrome outline, 3×3 cells | wide lamps, 2×3 cells (no wrap: checked on a side photo) | as the 2105, two rows |
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
front bumper, with body-colour bumpers (moulded, `finish: 'paint'`) wearing a grey
`moulding` band in line with grey door mouldings (`waist`, `finish: 'grey'`), the late
face (a `cornerLamps` unit: head lamps whose top slopes down at the inner end, the indicator wrapping round the corner; a slot under the bonnet lip; fog lamps in
black housings), a boot lid that comes down between the corner lamps (`notch` on its last
station) carrying the lamp bar (`rear.lid`), corner tail lamps wrapping onto the wings
(`cornerLamps`, the amber outer cell round the corner), and a boot-lid `spoiler` with the
high brake lamp.

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
wrapping round the corners, and the tail lamps (indicator over the tail and stop lamps)
wrapping onto the wings (`cornerLamps`).
