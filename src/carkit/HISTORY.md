# carkit: fix history

Every notable fix to the kit cars: the owner's complaint (or the problem found), its cause,
the solution, and where it lives in the code. Newest last within each section. Read
[Failed approaches](#failed-approaches-do-not-retry) before attempting anything similar.

Format of an entry: **Problem** → **Cause** → **Fix** → *Code* (commit).

## Method

- **The first 2106 was proportioned by eye**: front overhang 0.8 m instead of 0.6, doors
  too small. → Comparison with the reference by eye. → Every number is now measured on a
  gridded crop of a dimensioned drawing (or a scaled near-orthographic photo) and written
  with its source in `measurements-*.md` and a comment in the spec. *README "Adding a car"*
  (cb50867).
- **Figures from a brief can be wrong**: the 2115's width was given as 1680. → No source.
  → Every factory source says 1650; it is used. *`FACTORY_GEOMETRY.kit_vaz2115`*
  (0131dc7, `measurements-samara.md` §0).
- **A drawing can disagree with photos**: the 2109 drawing's door lines stand 0.1 m behind
  both the photo and the 21099 drawing; the 2102 drawing's C pillar is 37 mm forward; the
  2107 drawing's dimension lines disagree with its drawn hubs. → Undimensioned or coarse
  drawings. → Cross-check every drawing against a second source; prefer the photo for lines,
  the drawn hubs for arches and doors (they are drawn round the hubs). *measurements files*.

## Generator

- **Looks were enums** (one face per car hard-coded) and could not tell the 2101 / 2103 /
  2106 apart, which share one shell. → Styling was code. → `KitLook` became data: end faces
  are lists of items (`panel`, `round`, `lens`, `grille`, `cluster`, `frame`) placed on the
  face's own lines; bumpers `blade`/`moulded`; side trim. Body families placed per car with
  `onBody`; per-car dashes via `cabinLayout`. Proved on geometry: 2108 identical, 2106 off
  by 0.29 mm in its grille bars (spacing now a rounded margin) before its trim was
  deliberately corrected. *spec.ts, exterior.ts, specs.ts* (b917537).
- **Five generated wheel styles** (stamped cap, chrome dome, dome with ring, plastic cover,
  cast "daisy"). → The owner wanted the pack's wheels. → Removed; kit cars take the Soviet
  pack's sets rescaled to the kit tyre; the kit's own wheel is a plain placeholder.
  `Template.wheelStyles` and `buildKitWheelSet` are gone. *kit.ts, wheels.ts,
  render/carmodel.ts `cloneWheels`, carmodels.ts* (df7ec40).
- **The same wheel design kept recurring.** → `SOVIET_WHEEL_SET_POOL` has 12 entries but
  only 6 designs (repeats). → Kit cars draw from `DISTINCT_SOVIET_WHEEL_SETS` (each design
  once). *carmodels.ts* (0131dc7).
- **A spare-wheel well hung under the classic saloons as a painted box.** → bay.ts built
  the well below the boot floor. → The spare lies flat in the boot's corner; the well box
  is gone. Silencers tucked up `SILENCER_TUCK` (25 mm) above the lowest point; the lowest
  point at `CLEARANCE` (0.17) is the classic's diff and the Samara's fuel tank. *bay.ts*
  (90013fb).

## Estates (2102, 2104)

- **Opening the tailgate: something poked through the closed opening.** → The tail end
  cap was a triangle fan; on an estate the end face is concave where the deck dips to the
  tailgate sill, so the fan spanned the opening. → End faces are earcut
  (`THREE.ShapeUtils.triangulateShape`). Also: the last side column (D pillar) folds at
  `rearKnee` so it lies flush with the tailgate glass; the estates' lower panels stand
  upright over the sill; the hatch boot's load space ends at `rearBase − 0.03`, inside the
  closed tailgate. *body.ts `buildShell` (end faces, last column), bay.ts
  `buildHatchBoot`, estates.ts* (07c3400).
- **The lamp corners stood upright while the tailgate leaned.** → Each was built at its
  own station plane. → `KitCarSpec.rearLean`: after everything is built, every point
  above `base` behind the rear base moves forward by `lean` per metre of height (smooth
  blend ahead of it), so tailgate, corners and lamps are one raked plane; parts are warped
  in their closed pose and still close flush; wheels are added after. *kit.ts `leanRear`,
  estates.ts* (52e7105).
- **Side pillar trim poked out through the tailgate opening after the lean.** → Interior
  side trim ran to the rear base. → It stops `HATCH_TRIM_CLEAR` (0.06) ahead of a
  tailgate's opening. *interior.ts* (eb6fe47).
- **Filler on the wrong side; rear bench too far back; load floor below the floor pan.**
  → Generator assumed the right side and saloon bench position. → `flap.side: 'left'`,
  `cabinLayout.bench` pulled forward, load floor from the bench (`loadSpaceStart`) never
  below the pan. *spec.ts, estates.ts, specs.ts, bay.ts* (0b4b56b).

## Classics

- **BODY_05 (2104/2105/2107) bonnet nose bent too hard.** → The drawing's 90 mm roll-off
  over the first 0.3 m reads as a bent nose at this resolution. → The lip is lifted (stations
  0.05 and 0.35: belt 0.84/0.87, deck 0.875/0.925) to keep the bonnet near flat, as on the
  124. A **deliberate deviation from the drawing**, commented in the code. *specs.ts
  `BODY_05`, estates.ts `BODY_2104`* (0522f35).
- **2104/2105 headlamps looked narrow.** → An earlier wrong measurement. → They use the
  2107's lamp units (head ±0.372..0.603, blinker to ±0.695) on the same black surround; only
  the grille between them is the 2105's own (flush, 7 horizontal bars). *specs.ts
  `LOOK_2105`* (36e46e3).
- **05 shell (2104/2105/2107): the A pillar looked much wider than on the 2101/2103/2106.**
  → The front door's first column started at the drawn lower door front (s 1.17) while the
  A pillar's foot stood at 1.0, leaving a 0.17 m body triangle at the belt. → Above the belt
  the door frame and drop glass now start at 1.035 / 1.06 (columns with `upper: 'door1',
  lower: 'body'`), while below the belt the wing still reaches 1.17. *specs.ts `BODY_05`,
  estates.ts `BODY_2104`* (c86627d). **Pattern for future cars**: a door whose upper
  front edge is ahead of its lower shut line takes columns with `upper: 'door1', lower:
  'body'`; a drop glass may span several columns (adjacent strips with the same owner and
  glass make one pane). See README "CabinColumn".

## Samaras (2108, 2109, 21099, 2115)

- **2108 headlamps too wide and rectangular.** → Not measured off the front view. →
  Measured: grille panel to ±0.34, lamp to ±0.62, indicator to ±0.69, outer edges leaning in;
  lenses take `slant` (top edge inboard: trapezoids). *spec.ts `slant`, exterior.ts,
  samaras.ts `LOOK_2108`* (52e7105).
- **2108 had a grille.** → The real car has none. → A body-colour panel with two rows of three
  slots between the lamps; `Finish 'paint'` draws trim in the paint slot so it takes the
  car's colour and wear; the nose narrows from the bumper's top to the bonnet lip as the
  lamps' outer edges lean. *spec.ts `Finish`, exterior.ts `finishSlot`, `LOOK_2108`*
  (b6b027d).
- **2108 front wing's top stepped from the door to the lamps.** → Stations jumped. → The
  wing's top tapers gradually from the door to the lamps (front stations' belt/width).
  *`BODY_2108` stations* (435b309).
- **2115 boot lid must come down between the lamp corners, carrying a lamp bar.** → The deck
  could only crown or lie flat; face items only stood on the body. → `TubStation.notch`
  (deck level between corners, 25 mm wall `NOTCH_WALL`, lid cut along the notch
  `BodyFrame.lidX`); `FaceLook.lid` (items hung on the lid node, lamp names kept); moulded
  bumper `finish` (body colour); saloon boot bulkhead stays inside a tail-face lid. Proved:
  2101–2108 hashes identical. *spec.ts, body.ts, exterior.ts `buildLidFace`, bay.ts
  `buildSaloonBoot`* (0131dc7).
- **21099/2115 rear side glazing wrong**, fixed in three steps on owner review:
  1. the quarter light's rear edge made parallel to the back light (8dd994c);
  2. a C pillar of even width (0.195) parallel to the back light, with the fixed glass
     **in the rear door** (d85752e) — rejected, see Failed approaches;
  3. final: the rear door's frame ends at its drop glass channel; its shut line runs
     unbroken from the sill to the rail (3.12 / 2.85); behind it the **body** carries a small
     fixed quarter glass (`upper: 'body', glass: 'fixed'`) and then the C pillar of even
     width parallel to the back light. Proved: 2101–2109 identical. *samaras.ts
     `BODY_21099` columns, `measurements-samara.md` §1.1* (ace2f0b).
- **2115 lacked its own details** (it wore the 2108's trapezoid head lamps; no spoiler, fog
  lamps or mouldings). → The look language could not draw them: no corner cuts on lenses, no
  per-side panels, no unpainted grey plastic, no bumper band, nothing on top of the lid; and
  3dcar.ru has no 2113/2114/2115 drawing. → Measured on Commons photos with a per-photo
  perspective correction fitted to matching left/right edges (`measurements-samara.md`
  §3.3–3.6). New optional spec fields, absent on every other car: lens `chamfer`
  (`LensChamfer`, drawn by `lensOutline`) and negative `slant` for the late face's head
  lamps (top sloping 45 mm down to its inner end) and indicators; `panel.x` as a span (one
  block each side) for the fog lamps' black housings and chrome lenses; finish `'grey'`
  (trim slot plus vertex colour, so no new material) for the door mouldings (`waist`) and
  the moulded bumper's new `moulding` band; `KitLook.spoiler` (`SpoilerLook`), built by
  `buildSpoiler` into the boot-lid node so it lifts with the lid, its high brake lamp a
  `lamp_brake` lens (another `kit_brake` mesh, lit by the rig and `VehicleLamps` with no new
  slot). `buildWaist` now stops a strip `MOULDING_ARCH_GAP` (30 mm) short of a wheel arch
  it would run into; the classics' higher strips are not cut. The fog lamps were pulled 2 mm
  back so the car's length is unchanged. Proved: 2101–21099 hashes identical against
  c86627d; 2115 11 738 → 12 092 triangles. Left: the high brake lamp also glows with the
  tail lamps and the fog lamps never light (no roles for them; STATUS.md). *spec.ts,
  exterior.ts, samaras.ts `LOOK_2115`* (uncommitted at the time of writing).

## Failed approaches (do not retry)

- **Tessellating the body before the `rearLean` warp** (to bend it more smoothly): it bent
  the pillars. Reverted. The warp works on the built geometry as is.
- **The 21099/2115 fixed quarter glass in the rear door** (`glass: 'fixed'` in a `door2`
  strip, riding with the door): wrong for these cars; on the real car the quarter glass is
  in the body and the door's shut line is one line from sill to rail. (On the 2105/2107 the
  rear door *does* carry its fixed pane; check photos per car.)
- **Proportioning by eye** (first 2106): see Method.
- **Generated wheel styles**: removed at the owner's request; use the pack's sets.
- **Following a drawing's bonnet roll-off literally on BODY_05**: read as a bent nose.

## Template for new entries

```md
- **<Owner's complaint, in his terms>.** → <cause>. → <fix, with the numbers that matter>.
  *<files / symbols>* (<commit>).
```
