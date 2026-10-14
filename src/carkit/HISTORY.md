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
  2107 drawing's dimension lines disagree with its drawn hubs; the 2110 drawing has no rear
  quarter glass, a flat-topped rear arch and its flap on the wrong side (mirrored). →
  Undimensioned or coarse drawings. → Cross-check every drawing against a second source;
  prefer the photo for lines, the drawn hubs for arches and doors (they are drawn round the
  hubs). *measurements files*.
- **The z-fight census only reported**: a spec could land with visible clusters or slits
  and nothing failed. → `kit-zfight.ts` printed tables and always exited 0. → It now exits
  1 on any visible cluster in any band or any slit, listing car, band, both emitters and
  the gap; its self-test covers a covered and an open shell hole; README "Check" makes it
  a required gate with the fit and triangle rows. *tools/kit-zfight.ts* (uncommitted).

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
  exterior.ts, samaras.ts `LOOK_2115`* (8620a22).
- **2115 (and 2110) boot lid: a superfluous diagonal face on the lid's rear face**, from the
  trailing corner by the spoiler down toward the lamp bar. First fix (superseded below):
  the half row moved to the notch wall's foot on the trailing station too
  (`lidFaceWeight`); the strip from it to the cut still bridged a flat 25 mm strip on top
  to the 175 mm wall at the tail, and the lid's rear face still folded.
- **2115 and 2110 boot lid: folds and a twisted sliver at the lid's rear corners, between
  the lid and the wing beside the tail lamps.** → The real cause: the lid's rear face was
  one bridge from the trailing-edge station (the lid's top) to the notched tail station's
  outline, which steps down the notch wall from the corners' top to the lid's foot. A
  sloped face from a horizontal top edge cannot meet a stepped bottom edge in the vertical
  tail plane, so every quad touching the wall twisted (the fold), and the jamb along its
  edges twisted with it (the sliver). → Where the lid comes down the tail
  (`BodyFrame.lidFace`), the tub's deck rows on the tail station all stand at the
  corners' top, so the lid's top turns down to a straight line across at the lamps' top
  (flat faces, every edge horizontal at both ends); below that line the lid's rear panel
  is a flat face in the tail plane between the lamps, sharing its edges with the tail
  face, so the shut line runs clean from the lid's top corner down to the lamps and along
  the notch wall to the foot. On the 2115 that line runs from the trailing corner (±0.69)
  diagonally in to the lamps' top (±0.575), as on its photos. `lidFaceWeight` is gone.
  Proved: 2101–21099 identical against cfff462. *body.ts `lidFace`, `buildShell`*;
  `/tmp/vaz2110/lab4/lid_*_c.png`.
- **2115 and 2110 head lamps stuck out of the body and did not wrap round it**: a lens slab
  standing 22 mm proud of the face (`lens`, proud 0.012 + depth 0.01), its outer end
  stopping at the face's edge (2115) or a separate slab on the flank (2110). → Lenses were
  face items only. → `KitLook.cornerLamps` (`CornerLamp`): a thin lens 4 mm off the body
  from its inner end across the face, round the corner and back along the flank, every
  stretch in its role's slot or an unlit finish, stepping every 20 mm along the flank on
  the skin as built (`skinX`, the outer of a face's two diagonal splits, so it never
  sinks in). The 2115's chamfered head lamp and indicator are points on it (the indicator
  rounding off on the flank at s 0.205, photo p19); the 2110's head lamp runs to the corner
  and the indicator round it: clear (chrome reflector) at the corner, amber behind, clear
  at its end (photos f1, f3). Lens `chamfer` and `flankLamps` are gone (no users left).
  *spec.ts, exterior.ts `buildCornerLamps`, body.ts `skinX`, samaras.ts, tens.ts*.
- **Samara front (2108, 2115 and the rest): at the bonnet and indicator corner the top
  overhangs the bottom; on the cars the lower part is forward and the face leans back.**
  → The face was one upright plane at the first station, and the lip of the bonnet stood
  right over it. The 2108 drawing has the bumper's top at s 0.10 (0.625 m) and the bonnet's
  lip at s 0.164 (0.803 m). → `KitCarSpec.frontLean` on `BODY_2108` { base 0.625, lean
  0.36, blend 0.15 }: the estates' tail lean (kit.ts `leanRear`, now `leanEnd` for either
  end) applied at the nose. Everything above the bumper ahead of the bonnet's front edge
  shears back in one straight plane, lamps and grille with it. No new geometry. Proved:
  2101–2107 identical against cfff462 (the estates' `rearLean` included). *spec.ts, kit.ts
  `leanEnd`, samaras.ts*.
- **2110 and 2115 rear indicators: the body shows through the wrap cells at the corner.**
  → The lamps ran up past the tail's belt onto the corner's sloping shoulder, where the
  skin turns in. The lens followed it and pinched into a V, and the body poked through.
  → The rear units end at the tail station's belt (2110 0.815, 2115 0.75), so the lens
  lies on the flat face and side and the shoulder above is a straight cut. Spec only.
  *tens.ts, samaras.ts*.
- **2110 front indicators: solid amber, no clear or chrome parts** (the owner's reference
  photo). → The corner unit is amber from the head lamp round the corner; the clear
  `finish` stretches are gone from the language (`CornerLampPoint` has only `role`).
  *spec.ts, exterior.ts, tens.ts*.
- **2110 and 2115 tail lamps should wrap onto the wings like the head lamps.** → They
  were face clusters. → `CornerLamp.end: 'rear'` builds a unit on the tail face. 2110:
  the indicator over the stop and tail lamps, round the corner to s 4.06–4.075; 2115: the
  amber outer cell round the corner to s 4.085, tail over stop inside it. *spec.ts,
  exterior.ts `buildCornerLamps`, tens.ts, samaras.ts*.
- **Samaras and tens: the A pillar meets the roof at a sharp angle in profile; it should
  be more raked and round into the roof.** → The pillar ran straight to the rail at its
  top column, and the screen's foot stood at the cowl straight across, so the profile
  had one knee. → The screen's foot comes forward on the centre line
  (`CabinSpec.screenFoot`, the drawings: 2108 0.15, 2110 0.156; the bonnet ends there),
  and the A pillar's top point drops below the rail (`CabinColumn.drop`, 0.03 / 0.037),
  one straight chamfer up to the door frame's top, which moved back to meet it (2110 tops
  1.77 / 1.85 / 1.89 on the drawn pillar line and its rounding). The roof is untouched.
  The first attempt, a cut into the roof's front, is under failed approaches. *spec.ts,
  body.ts, interior.ts, exterior.ts `buildWipers`, samaras.ts, tens.ts*.
- **2115 front: the face too narrow, the lamps close together, the bumper a bloated shelf,
  the side moulding torn where it meets the bumper, fog lamps too high; then: lamps taller,
  the lower front lighter.** → It wore the 2108's nose, whose wing top leans in to ±0.69
  at the lamps, behind a bumper filling the 0.155 from the tip to the face. → Its own
  nose stations (the face at s 0, 0.77 wide at the lamps; photo: lamps 0.41–0.97 of the
  half width), the lamp unit out to the wing's edge with the indicator the outer quarter,
  0.645–0.772 tall; a `flush` bumper 0.27 deep from just under the lamps, its sides on the
  wings to the arch, its grey band at plate height and the door mouldings moved to the
  same 0.505 / 0.09 so the strip runs straight on; a dark intake strip under the band; fog
  lamps low at the corners. The 2108/2109/21099 keep their nose (it matches the 2108
  drawing). *samaras.ts*.
- **Hatchbacks and estates: dark slits along the rear quarter, between the greenhouse
  side and the wing below it.** → The greenhouse's foot ran straight between its columns
  while the tub's top edge bends at the stations between them (the 2112's at s 3.95 by
  72 mm, the 2108/2109's at 3.6 by 14 mm, the estates' by up to 11 mm): an open seam. →
  The side ring gets a point at every such station, its foot on the tub's edge (only where
  the edge bends by over 1 mm, so the classic saloons stay identical). *body.ts*.

## Tens (2110, 2112)

- **2112 rear bumper a bulging box proud of the body; the tens' bumpers are known for
  sitting in the body's lines.** → The moulded bumper's top was a flat shelf standing out
  of the face, its sides outside the wings. → Moulded bumper `flush`: its top grows out of
  the body's surface over its top 60 mm; the rear bumpers follow the wings to the arch
  (`wrapTo` 3.63) as the front one does. *spec.ts, exterior.ts, tens.ts*.
- **2110/2112 nose: the bonnet overhangs the bumper; the face should lean back from the
  bumper to the bonnet; the indicators wrap too far and are too big.** → The face was
  upright at s 0.09. → The face at the bumper's top (s 0.04) leaning back to the drawn lip
  (`frontLean` 0.586 m per m), the indicator ending at s 0.2. *tens.ts*.
- **The head lamp notched and the indicator torn after the nose lean.** → The lamps lay
  partly in the lean's fade, where the body's flat faces and the lens bend differently,
  and face triangles spanning the lean's base bent at it. → `frontLean.full` (0.2, the
  indicator's end) keeps the lean in full under the lamps, `base` on the crease row, and
  the nose face is cut along the base line (body.ts), so everything above leans as one
  plane. *spec.ts, kit.ts, body.ts, tens.ts*.
- **A raised shape on the bonnet's nose, then a crease across the bonnet; the bumper
  covering the lamps' bottom ("a Nexia").** → The lean faded out over 0.15 m behind its
  full zone and folded the bonnet; the drawn deck at s 0.6 stood 17 mm over the line to the
  cowl; the bumper's top (0.6) stood at the lamps' bottom. → Blend 0.6; the deck and wing
  top at s 0.6 on the straight line (0.873 / 0.83); the bumper's top at the drawn 0.565.
  *tens.ts*.

### 2110

- **2110 gaps after the first build, on owner review**: rear door edge upright, rear arch
  too high, full-width bonnet, lamps not wrapping, the lid reflector two lenses, no feature
  line, Samara dash, a boxy nose. → The language could not say them. → Optional fields,
  absent on every other car (proved 2101–21099 identical against cfff462): `CabinColumn.foot`
  (a shut line raked below the belt; side faces are clipped along it, `clipPolygon`),
  `WheelSpec.rearArchRise` (a half-ellipse rear arch, skin and liner only), a narrow bonnet
  (`bonnetX`, replaced below),
  `KitLook.flankLamps` (replaced by `cornerLamps`), `KitLook.featureLine` (a painted ridge on the waist's strip
  builder, `buildFlankStrip`), moulded bumper `corner`, and a lens centred on the centre
  line built once. The nose was re-measured in plan and rounded. Numbers in
  `measurements-2110.md`. *spec.ts, body.ts, exterior.ts, tens.ts*.
- **2110 bonnet: should reach out along the screen's base, its nose down between the
  lamps**; **rear door's raked edge: corners should be rounded, trim behind it.** → The
  narrow bonnet was a misreading: the drawing's ±0.29–0.34 lines on top are the bonnet's
  raised centre running down into its nose, not shut lines; photos `f2`, `f3` show the
  shut lines along the wings' top edge from the lamps' outer ends to the A pillar's foot
  (the drawing's line 0.035 inside the outline). The raked edge was two straight lines. →
  `KitCarSpec.bonnet { inset, nose }` replaces `bonnetX`: the cut 10 mm in from the deck's
  edge, the nose a bonnet face on the front face between ±0.278 at 0.60 and ±0.298 at the
  lip, the slot on it via the front `FaceLook.lid` (`buildLidFace` now serves both ends),
  the bay's inner wings under the cut. `CabinColumn.foot.round` [0.17, 0.03] (photo `s1`)
  rounds the shut line's turns (`BodyFrame.shutLine`, every point a side row); interior
  `rakeTrim` lines the body's piece behind it. Proved: 2101–21099 identical, the 2115 as
  after its lid fix. *spec.ts, body.ts, bay.ts `wingWall`, exterior.ts, interior.ts,
  tens.ts*.
- **2110 front: the bumper's corner hung lower than the wing and stood out as a separate
  box; the indicator should follow the body round the corner, mostly clear lens with an
  amber part.** → The moulded bumper wrapped only 0.2 m back along a straight line at a
  fixed half width, standing 30 mm off the flank, its foot 25–45 mm below the wing's
  bottom edge, and stopped there; on the real car (drawing side view, photos f1, f3) it
  runs back to the wheel arch flush with the wing, its foot the line the sill continues.
  → Moulded bumper `wrapTo`: its sides follow the flank (`flankBumperPath`, five points
  along each side 6 mm outside the body at the bumper's top height) back to s 0.47, just
  ahead of the arch, its foot at the band's bottom (0.255) in line with the sill (0.258);
  the indicator is part of the corner lamp (previous entry). *spec.ts, exterior.ts,
  tens.ts*.

## World (2026-10-13)

- **Stickers on doors stayed where the closed door was when it opened.** → The decals of a
  car were one merged mesh under the body node, cut from the chassis stamp (`carBodyPos`,
  the shut pose), so nothing tied a decal to the part it was printed on; placement also
  read the live hit, so a sticker aimed at an open door landed in the air. → Each sticker
  surface records the moving part it rides (nearest node with `kitMotion`) and that part's
  shut frame at clone time; the decal pieces cut from its triangles go into a decal mesh
  of their own under that part, in that frame, so a sticker across a shut line splits and
  each piece swings (or winds down, on a drop glass) with its part. `pickBody` takes the
  aimed point and normal from the stamp under the hit (`hit.barycoord`). Same sticker
  materials, so no new program. *render/stickerdecals.ts `StickerDecalCarrier`,
  `DecalLayer`; render/carmodel.ts `stickerDecalSurfaces`; player/interaction.ts
  `pickBody`*.
- **Into the world**: a kit car as a driven `Vehicle` and in traffic. Its own rig
  (`vehicle.kit`, lenses left to `VehicleLamps`) is fed the driving channels every frame;
  the rig, not the `STEERING_WHEEL_NODE` path, turns its wheel (both would have written
  the same node). Wrecks and couriers are posed far once (`poseKitStatic`). A rig skips
  parts whose channel did not move (`Driven.applied`), so a parked kit car costs a
  comparison per part. *vehicle/vehicle.ts `driveKit`, carkit/rig.ts*.
- **Lowered side windows stood in the cabin, next to the door.** → A drop pane leans in
  with the greenhouse (its top 12.7 cm in from its bottom on the classics, 10–12.5 on
  the rest) and slid straight down, so its top came 5 cm past the 7.5 cm door's card.
  → It slides in its own plane, square to its bottom edge, and nothing below that edge
  is drawn: the showing part is cut out of the shut pane (Sutherland–Hodgman, every
  attribute, so the same program) into a copy the car makes on the pane's first move;
  fully down it is not drawn, and stickers on it fold away (scale 0) until it is up.
  Stickers are cut from the shut pane (`KIT_SHUT_GEOMETRY`). The 2 cm of glass the old
  drop left showing is gone: a pane winds all the way down. *carkit/rig.ts
  `SinkingPane`, kit.ts `shellMotion`, render/stickerdecals.ts*.

## Rendering (2026-10-14)

- **Z-fighting: could it be found and fixed without the owner pointing at each spot?**
  The census (`tools/kit-zfight.ts`) builds every car closed and open. It pairs faces
  that lie in one plane and overlap, bands each pair by the distance at which the 24-bit
  depth buffer (near 0.08 m) loses it, and keeps the pairs a line of sight reaches. It
  found 22 causes that flicker at any distance and are seen. Each one is a part generated
  exactly in another part's face, against a part of another colour. The fix is a
  millimetre, a dropped face that lies inside another part, or a spec value:
  - C1, all cars: the radiator core's top lay in the header tank's top. The core has no
    top face (`NO_TOP`, *bay.ts:438*).
  - C9/C14, classics: the radiator support's posts and lower member stood on the
    underbody with their bottom faces in it. They get `UPPER_FACES` (*bay.ts:429, 431*).
  - C13/C19, all cars: the scuttle's back lay in the firewall. It stands 2 mm ahead
    (`PLANE_GAP`, *bay.ts:416*).
  - C53, classics: the intake log's sides lay in the exhaust runners' ends. It is 2 mm
    narrower each side (*bay.ts:386*).
  - C2, classics: a grille frame's back lay in the nose panel. It is sunk 4 mm, as a
    `frame` item is (*exterior.ts:276*).
  - C3/C6: the round lamps' chrome ring had its back in the face and, on the 2103, its
    front in the grille's front: a flicker round all four lamps, seen from the whole front
    half. The ring now runs from 1 mm into the face to 26 mm out, centre `out(0.0125)`,
    half `0.0135` (*exterior.ts:240*).
  - C15/C49/C51/C62/C71, all grilles: bars spanning the slot ended on the dark back box's
    faces. The back box reaches 2 mm past the slot every way (*exterior.ts:280*).
  - C30, 2110/2112: the groove ridge (6 mm proud on the centre line) crossed the lower
    intake's face. The intake's `standOut` went from 0.02 to 0.024 (*tens.ts:221*).
  - C31, 2115: the moulding band's front met the lower intake's front on the centre line.
    `standOut` went from 0.027 to 0.029 (*samaras.ts:394*).
  - C54, 2101 tail: the lamp's black plate and the chrome rim shared their bottom face.
    The cluster starts at `bumperTop` +0.129 instead of +0.127 (*specs.ts:249*).
  - C76, 2103: the blinker's front lay in the grille frame's front where it tucks under.
    `proud` went from 0.01 to 0.008 (*specs.ts:293*).
  - C29, all cars: the handbrake lever's end lay in the grip's end. The lever stops at
    98 % (*interior.ts:1493*).
  - C86, Samaras, tens, 2107: the vent louvres' backs lay on their backing. They stand
    1 mm off it, at z 0.006 (*interior.ts:1198*).
  - C48 (and C34/C37 at 10–25 m), every door: the handle recess crossed the door's
    inner skin, which is offset along its own normals. The recess stands 5 mm off the
    card line instead of 2 mm (*interior.ts:1638*).
  - C83, 2104: the headliner's rear drop crossed the tailgate's inner skin at the header.
    A hatch's drop stands 6 cm in from the glass line instead of 5, which clears the skin
    by 5 mm (*interior.ts:1038*).

  The scanner went from 133 visible close-range clusters to 0. No new close-range or
  10–25 m row appeared, and the 10–25 m rows of the door recess and the 2110 intake are
  gone too. Proved on geometry, per mesh, closed pose:
  - every changed mesh is one of the fixes above;
  - each car has 8 fewer triangles (the dropped faces);
  - the 2110, 2112 and 2115 noses reach up to 2 mm further, because the intake is now the
    proudest part. Their fit rows were refreshed (`tools/fit-models.ts`), and
    `tools/kit-proportions.ts` passes its hard gates.

  Still open: the 10–25 m layer steps in the cabin (0.5–0.6 mm: mirror glass, armrest
  cup, radio dial, gauge ticks, cluster bezels) and the rear hump tops against the arch
  liners (STATUS.md).

## Cabin lining and tail lamps (2026-10-15)

- **Inside the 2109 (and every kit car) the headliner poked past the top of the screen and
  back light; round the side windows the body's paint showed between the trim pieces, and
  pillar trims floated or crossed the glass.** → The headliner and pillar trims were
  separate guesses (`headliner`'s drops, `pillars` with `PILLAR_IN`, `HATCH_TRIM_CLEAR`),
  not the shell's openings; the panes' rubber stopped at the outer skin; a door's frame
  above the belt and a tailgate were painted inside; the shell's jambs round the
  greenhouse were paint. → The shell marks its own greenhouse and roof faces (`lined`)
  and offsets them `LINING_DEPTH` (28 mm) inward along their own normals: one closed skin
  of pillars, headers, rail and roof (`ShellResult.lining`, `KitContext.lining`), drawn in
  the headliner colour (`Cabin.lining`); the old headliner panel and pillar trims are gone.
  Every pane's rubber runs on from the pane to the frame's inner side (the lining or the
  part's inner skin); door and tailgate inner skins are trim in the upholstery colour;
  the jambs and part edges round the greenhouse are rubber (the seal). The quarter trims
  and a hatch's luggage-side trims reach up to the lining's foot; a saloon's parcel shelf
  reaches out to the quarter trims and a wall behind it closes the boot up to the back
  light's foot (the 2110's boot paint showed there). About +300–450 triangles per car.
  Not done: painting the body's inner side dark. The shell is one double-sided `paint`
  material, and a different inner colour per face would need a material variant.
  *body.ts `cutShell`, interior.ts `lining`/`sidePanels`/`shelf`, bay.ts `buildHatchBoot`*.
- **Tail lamps sat on black backing plates; the 2106's whole rear panel between the lamps
  was black and z-fought with the body at a distance.** → `cluster` drew a black housing
  6 mm proud round its cells, and the 2106's look had a black `panel` 3 mm proud. → A
  cluster's cells tile its span straight on the body (3 mm seams, each 1 mm into the
  face); the 2106's panel is gone (its chrome outline stays), and the 2101's chrome rim
  stays. Visible >25 m z-fight rows fell on every car (2106 77 → 57).
  *exterior.ts `buildFaceItem` `cluster`, specs.ts `LOOK_2106`*.
- **Crawling shadow bands on cabin parts.** → Small cabin parts shadowed their
  neighbours a few centimetres off, and the sun's normal bias did not suit a grazed
  double-sided panel. → Kit detail parts (`kitShadowed`: cabin, bay, boot, underbody) cast
  no sun shadow and receive the shell's; `addBuilt`'s and `Cabin.hinge`'s `casts`
  parameter is gone (only the mirror face keeps `kitCastsNone`); the bias is turned to the
  light's side and scaled by the angle to the sun. *render/carmodel.ts
  `prepareMaterials`, render/lightshader.ts, context.ts `addBuilt`*.
- **31 visible close-range z-fight clusters on the classics** (the census found them on
  HEAD 1b3772a as well; none on the Samaras and tens). Three causes, each a face exactly in
  another part's face:
  - classics: the front beam's top lay in the underbody floor (gap 0.05 mm). The beam is
    built without its top face (`across(..., closed = false)`, `PartBuilder.extrude`'s new
    `closed`) (*bay.ts `classicChassis`*);
  - every blade bumper: each bracket's end face lay in the end face's plane. The bracket
    box leaves that face out (*exterior.ts `buildBumpers`*);
  - 2101/2102: the front indicator lens's back lay in the face (`proud` = `depth`). Half
    depth 0.0135 at `proud` 0.0065: its front stays 20 mm out, its back 7 mm inside
    (*specs.ts `LOOK_2101`*).

  Census: 31 → 0 visible close-range clusters; 10–25 m rows 2101–2103 and 2106 down by 2
  each; >25 m/far rows 2102, 2104, 2105 down by 2, the rest unchanged. 10 triangles fewer
  on each classic; fit rows unchanged.

## Z-fighting at every distance (2026-10-16)

- **The census still showed 16–28 visible clusters per car at 10–25 m and 22–57 beyond
  25 m**, after the close range was clean. Two kinds:
  - *Tool artefacts* (`tools/kit-zfight.ts` classified them as visible when they cannot
    show): fights under a pixel at the furthest distance the part is drawn (shell to
    700 m, detail groups to `KIT_DETAIL_M`; 1440 px tall, 65° FOV); cabin pairs seen
    through glass that is a tinted mirror by then (weighted by `1 − kitGlassOpacity`);
    cabin fights counted from the seat although the cabin's near plane (0.02 m) parts
    them within the cabin's 3 m (`CABIN_TAU`); fights with the kit's placeholder wheels,
    which the pack's wheels replace. With those classes out: 13–22 at 10–25 m, 31–62
    beyond.
  - *Real ones*, every one a face lying on another part's hidden face, a few millimetres
    off. A separation would have to be 4 mm at 50 m and 3–9 cm for the shell, which
    traffic draws to ~700 m, so each hidden face was removed instead:
    - every item on the body skin (lamps, clusters, grilles, badges, bumpers, corner
      lamps, repeaters, the mirror glass): rooted 7 mm into the skin (`FACE_ROOT`) with no
      back face, the shell cut under it (`KitHole`, `cutShellHoles`, run after the bay and
      before `leanEnd`, which warps the outlines too). Items on one end face are a union
      (`EndFace.place`): each cuts the other's faces inside its volume, ridges of moulded
      bumpers included, and of two flush walls facing the same way the later part's stays
      (`Outline.keepOutside`; without it both went and the 2108's slotted panel showed a
      slit at each post). Cluster cells draw only their outer walls; grille bars run to
      the back's walls and are cut out of it; an intake in a moulded bumper stands 10 mm
      ahead of it. *exterior.ts, builder.ts `cutUnder`, body.ts, kit.ts*;
    - cabin decals 0.3–2 mm over their surfaces (seat and bench inserts, armrest cup,
      radio band and knob mark, mirror pad's glass, vent backings, heater panel and knob
      pointers, the cluster's frame and face, ribbon frames and ticks): laid into the
      surface (`inlay`, the surface cut under them); the glovebox opening sits 5 mm in
      behind its cut; the radio needle 3.5 mm off its band, vent louvres 4.5 mm off
      their backing, the door handle's recess 7.5 mm off the card;
    - lit faces slid out 0.3–0.5 mm over their dark faces: the dark face now slides back
      as the lit one slides out into its place (`GLOW_TRAVEL`; needles `NEEDLE_TRAVEL`
      20 mm, clear of the faces put away behind the cluster): telltales, dials and their
      ticks, needles, ribbons, the courtesy lamp. Still poses on the same channels;
    - the rear hump tops crossed the well roof: they follow the shell's arch at its own
      facets, `HUMP_RISE` above (*interior.ts `humps`*);
    - the scuttle's back 2 mm before the bulkhead: no back face, it stands on the
      bulkhead; the propshaft's centre bearing and the Samara's beam pivots have no top
      on the floor; the Samara's tank stands 6 mm under it (*bay.ts*); the filler cup and
      boot side trims moved clear of the flap and lining (*exterior.ts*, *bay.ts*).

  Census (visible, 10–25 m / >25 m and far), first run → now: 2101 26/22 → 0/0,
  2102 24/25, 2103 28/37, 2104 16/40, 2105 16/43, 2106 25/57, 2107 22/27, 2108 20/35,
  2109 22/39, 21099 22/44, 2115 24/52, 2110 22/41, 2112 23/44, all → 0/0; close range 0
  throughout. Holes per car 10–145 (the tens' and 2115's moulded bumpers carry most),
  0 open to a viewpoint (checked against the shell and exterior only, as the mid and far
  traffic meshes bake them). Triangles +650–1550 per car (README budget). Fit rows: only
  the bonnet point moved, 1.5–2.6 mm up on ten cars (the scuttle now reaches the
  bulkhead). The mid and far bakes (`bakeFarCarGeometry`, `bakeCarPaintGeometry`) take
  the holed `body_paint` whole (position, colour, normal; the dust stamp
  `CAR_BODY_POSITION_ATTRIBUTE` is per vertex), and stickers clip per triangle.

## Failed approaches (do not retry)

- **Tessellating the body before the `rearLean` warp** (to bend it more smoothly): it bent
  the pillars. Reverted. The warp works on the built geometry as is.
- **Bridging a sloped boot lid straight to a notched tail outline** (the lid's rear face
  as one band from its top to the stepped notch contour): it folds wherever the contour
  steps. Turn the lid down to a straight line at the corners' top first and lay its rear
  panel in the tail plane (`BodyFrame.lidFace`).
- **A soft windscreen header cut into the roof** (`screen.drop/back`: the screen's top
  lowered and the roof's front edge pulled back towards the centre line, the rows ahead of
  it clamped onto it): read as a chunk licked off the roof's front, and in profile the
  pillar was unchanged. Round the corner on the side instead: the screen's foot and the A
  pillar's top (`screenFoot`, column `drop`).
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
