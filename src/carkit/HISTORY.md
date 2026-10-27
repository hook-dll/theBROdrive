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
- **Every new drive's Oka wore the same colour and the same wheels** (owner, 2026-10-26).
  → Colour and wheel set hash from the car's id, and the start car's id was the constant
  `'car:start'` (ochre, GAZ-21 wheels in every world). → The id carries the world seed
  (`car:start:<seed>`); old saves keep theirs. *story/site.ts* (cb07657).
- **Six wheel designs for the whole roster, foreign cars coming** (owner, 2026-10-26: new
  geometry wanted). → The pack's sets were all there was; the earlier generated styles had
  been removed as crude (14-sided lathes, the "daisy" petals painted on, no holes). →
  Generated sets again, beside the pack's, built as the real wheel is: a face of revolution
  with real windows cut through it (each band's sectors joined point for point to a
  star-shaped outline, every ring on one angle list so nothing cracks), walled on the
  alloys, a dark drum and barrel seen through them; each design from a photo of the real
  wheel (`RimDesign.ref`), judged side by side with it in the game's light. Eight designs:
  Oka and 2110 stamped steel, two 90s covers (ring of vents; the GM turbine), the 2112
  alloy, the W124 8-hole, the BBS cross-spoke, the Pajero II fan. Pools per kind (Soviet,
  Oka on its own 3x98 hub, foreign, off-road). They draw in the car's own kit material, so
  no new program (`tools/look/programs.mjs`: 0 new on every tier); 900–1500 triangles a
  wheel against the pack's 500. *rims.ts, materials.ts `alloy`, render/carmodel.ts
  `poolWheelSet`, carmodels.ts `KIT_*_WHEEL_SETS`* (2026-10-26).
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
- **21099 boot heavy.** → Its shoulder was the 2115's, half 0.80 at the belt against the
  drawing's rear view 0.76–0.78 (0.825 at the crease). → Own boot stations: belt half
  0.785 / 0.77 / 0.755 / 0.75 from the back light to the tail, the lid's trailing edge on
  the drawn line (belt 0.89, deck 0.91 at 4.1). The 2115 keeps `SALOON_BOOT`. *samaras.ts*.
- **2108/2109/21099 front wing over-complicated in front of and above the front arch: too
  many breaks, facets and creases.** → The wing's crease (its widest row) ran at 0.6–0.63,
  under the arch's top (0.641) and its lip (0.686). Every side row below the lip is lifted
  onto it (`sideColumn`), so over s 0.55–1.0 the crease was on the lip in some arch columns
  and at its own height in their neighbours, and the faces between cut across its 15° kink:
  fans of thin triangles up to 22° apart. Above it the face turned from 16° of lean at s 0.5
  to the door's 3° across a dozen arch columns. → The crease is the drawing's shoulder line
  (0.70–0.71 [D 2108; the 2109 and 21099 drawings and photo `p1` agree]): 0.705 from the
  arch's front (s 0.425) to past the hub (0.878), 20 mm over the lip, which matches the
  drawn flare (0.685); half 0.77 → 0.801 straight in plan [D top view]; the face above it
  leans 0.244 / 0.2 at s 0.425 / 0.5 and turns upright to the door; behind the arch it comes
  down to the door's crease (0.63). Two stations added, both on existing arch columns, with
  the belt, deck and sill interpolated, so the bonnet and the wing's top are unchanged
  (`onRun`). On the left wing the largest angle between neighbouring faces 22.4° → 6.9°,
  the length of edges over 2° 4.1 → 1.3 m (21099 6.9 → 1.8 m). Proved: every other car's
  hash identical; on the three only the wing's skin, the front arch's liner and the engine
  bay's inner wings (two more loft sections, within 1.7 mm of the old surface) changed, s
  0.17–1.232. Left: the door's crease stays 0.63 against the drawn 0.71, so the line slopes
  down 75 mm from over the hub to the door; the 2115's own nose stations keep the old
  crease. *samaras.ts*, `measurements-samara.md` §6; `build/k/compare2/samara_*_wing_*`.

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
- **2112: the wiper stalk could not be worked from the driver's seat.** → Not the 2112's
  geometry (from the driver's eye 128 of 168 rays reach the stalk first; the 2107's 121):
  the seated pick (`aimKit`, player/interaction.ts) refused every part whose control id
  was `wipers`, meant for the arms on the glass, and the stalk carries the same id, so no
  kit car's wiper stalk was ever offered since the stalk and crank rule (9bb953e). → The
  arms are told by their node (`wiper_<i>`), not their control id. Every kit car's stalk
  works again; the arms still offer nothing. *player/interaction.ts `KIT_WIPER_ARM`*.
- **2110/2112: the dash hid the closed doors' inner handles and window winders and came
  down over the knees; "far too massive".** → One section served the whole width: the
  face down to -0.34 at ds 0.455 (between the knee panel's -0.29 and the glovebox's
  -0.41) ran to the end caps at ±0.67, 0.38-0.455 deep, and the door card's handle
  (0.13 behind its front) and crank lay alongside it, the handle inside the cap's reach:
  from the eye none of 36 rays at either handle and 135 / 36 of 204 at the cranks reached
  them. On the photo the door shows past the end vent's pod, open below it to the floor,
  and the manual's door card has the handle at the armrest grip's top, 0.3 back. →
  `dashLoft`
  (optional, absent on every other car): the section over the stack and glovebox as
  before, the driver's half down to the knee panel's -0.29 (underside 5 cm higher), the
  last 5 cm of each end running forward to a cap 0.26-0.275 deep down to -0.14; end
  vents at ±0.58 on the face; `frontDoor` puts the 2110's handle and crank where the
  manual's card has them (0.30 / -0.12, 0.22 / -0.35). Now 24 / 14 of the handles' 36
  rays and 199 of the driver's crank's 204 reach them; the passenger's crank, 0.13
  further forward as on the car, is behind the glovebox from the driver's seat. Hashes:
  every other car identical. *interior.ts `CABIN_2110`, `DASH_2110*`, `Layout.dashLoft`,
  `Layout.frontDoor`*.
- **2110/2112 wipers parked in an odd position, blocking the view.** → No arm with the
  0.51 blade parks within 20° on the tens' screen, curved in plan, so the fit fell back to
  45° and kept the longest arm there: the driver's stood up the glass, its tip 0.19 m over
  its spindle. → In the 45° fallback the arm that parks lowest wins (the longest of
  those); blades 0.50 (both 500 mm, part 2110-5205070). The driver's arm is 36 mm shorter
  and its tip 0.084 m up, as low as the passenger's; the other cars park within 20° and
  are identical. *exterior.ts `buildWipers` `fit`, tens.ts `wiperBlade`*.
- **2110/2112: the front door glass's top front corner (raked edge into the rail) too
  sharp; rounded on the car; then a dent at the A pillar's top.** → The glass column ran
  straight to the rail at 1.89; `drop` lowers only a column's top point, so the rail's
  strip above it tips inwards (a dent); lowering the rail's edge with it still left the
  screen's top corner high, and the facet from it down to the pillar folded (a dent from
  the front 3/4). → `CabinColumn.cornerDrop` (tens' A pillar 0.037) lowers, together, the
  column's top point, the rail's edge over it (`u`), the roof's rows from the screen's
  outer corner outwards and the screen's outer top corner itself: one convex chamfer of
  the corner. `drop` (the Samaras' 0.03) is unchanged; 2108–2115 identical in hash against
  HEAD 649d0e9. The glass's top edge drops 0.05 at its front column
  (`CabinColumn.glassDrop`, the frame widening above it) and one more glass column (s
  1.45, top 1.95) brings it back: one chamfer inside the frame. The 2112 takes the
  2110's first 12 columns. *spec.ts, body.ts, tens.ts*.

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

## Traffic seen from behind (2026-10-15)

Renders: `/tmp/trafficrear/` (`sheet-before.png`, `sheet-after.png`: rows 2107 full, 2107
mid, 2109 full, 2109 mid; columns 70, 55, 45, 35 m; eye 1.3 m high behind the car, lens
narrowed to frame it; dirt 0.6, scratches 0.5). Car lab `__carLab.mid/only/look(…, fov)`.
Every LOD switch was already on its line; the three were content differences.

- **The silencer and tail pipe appear at about 50 m on a car caught up with slowly.** →
  The exhaust was in `kit_under`, drawn within `KIT_DETAIL_M` and left out of the mid and
  far bakes. → `exhaust()` builds into its own builder, added on the root as
  `exhaust_trim` (`kitShadowed`, the underbody's program); the bakes take it like any
  trim. A near car draws one more mesh. *bay.ts `buildBay`, `buildUnderbody`*
- **The cabin appears through the rear window at 50 m.** → The pane was 0.9 opaque at
  50 m, so a tenth of the seats switched on there, and at 45 m a quarter showed where the
  mid car at 55 m had none. → Glass tuning rather than a coarse cabin in the mid mesh: the
  mid mesh is opaque far material, a cabin in it would show only through a pane that is
  opaque there anyway, and it would not exist in a full car between 50 and 55 m. The glass
  is now an opaque mirror (1.0, as the mid and far glass) from `GLASS_MIRROR_M` 45 m and
  fades to 0.28 at 30 m; the cabin comes and goes behind an opaque pane. Rear glass, mid
  55 m vs full 45 m (box-blurred mean |Δ| of 255 over glass and tail panel): 2107 5.2 →
  1.0, 2109 14.4 → 1.6. *rig.ts `kitGlassOpacity`*
- **Dirt at the rear appears at 50 m.** → Not the paint: the mid paint has every
  attribute the near paint has (`position, normal, color, carBodyPos` on every piece,
  checked on both cars) and draws in the car's own paint material, so its dust and
  scratches matched already (2107 70 m full vs mid: 0.13). It was the rear window: the mid
  car drew its panes in the far material's flat tint, the near car in its own glass with
  the paint's crust on it (the 2109's lower back light). → The panes are baked like the
  paint (`bakeCarPaintGeometry`) into `CarMidInstance.glass`, drawn in the car's own glass;
  `Vehicle.showMid` poses the rig far, since it is not driven while mid. Cost: one draw
  and one per shadow pass per mid car (lab, one car at 70 m: 12 → 15 calls; full car 96 →
  97 with the exhaust). *render/carmodel.ts `buildMidModel`, `midInstance`;
  vehicle/vehicle.ts `showMid`, `midOwnDraws`*
- Left: the rest of the underbody (classic axle and diff, Samara twist beam and tank) is a
  dark band under the bumper from 50 m in; the mid bumper and wheels are a shade lighter
  than near (far material, unchanged).

## Cabin fine detail (2026-10-15)

Renders: `/tmp/cabinlod/` (car lab, one tab, 1440×900 at DPR 1.25; `before_*` = HEAD,
`after_*`, `compare_*` side by side; views: open driver's door 1.5 m out, side window 3 m
out, and side, front and rear three-quarter at 8 m from the centre, each also through a
12–20° lens from the same eye; day 11:00 and night 22:00 with the lights on). Meshes
counted on the loaded model (`createCarModel`, a headless script, all visible ancestors).

- **Several parked kit cars at a POI cut the frame rate; you never see the small cabin
  parts unless you are in the car or right at it.** → A near kit car drew ~120 meshes, 74
  (2101) or 85 (2109) of them cabin, every one for any car within 50 m. → A second tier
  inside `kit_cabin`: nodes tagged `userData.kitFine` (context.ts `fineDetail`) draw only
  within `KIT_FINE_M` 6 m of the car's centre, with the eye inside, or for the car the
  player sits in (`Vehicle.viewFrom(eye, dt, occupied)`; the chase camera stands about 6 m
  behind). Visibility only, no program change; the rig still poses hidden parts every
  `update`, so a needle comes back where it reads. Fine: dome lamp, visors, warning lamps,
  dial faces and glows, needles, glovebox lid, radio needle and knob, ashtray, light
  switch, hazard button, stalks, horn pad, pedals, gear lever, handbrake lever, window
  cranks, and each door's handle lever and lock knob (now their own `fittings_*` mesh, out
  of the door card's chrome). Coarse: the fixed cabin, seats, backs, headrests, bench,
  wheel, inside mirror, door cards. Holes: a stand-in 24 mm behind every window the fine
  faces fill (`WINDOW_FILL`: warning lamps, the 2101's ribbon, bare dial ticks), in their
  dark colour, and an octagon of dial face laid in the cluster face under each round dial
  (the bezel otherwise rings the cluster's or the wood's colour). Meshes (scene pass; sun
  depth pass 33 throughout, detail parts cast none): 2101 121 at 3 m and 10 m → 121 at
  3 m, 61 at 10 m; 2109 130 → 130 and 63. Renders: door and window views identical to HEAD
  below the sky (no pixel over 25 of 255 differs, day or night); at 8 m 9–28 pixels of 2
  million differ by day, 0–1 at night. Triangles +84–430 per car (the octagon cuts; a
  12-gon cost up to 611). *rig.ts `KIT_FINE_M`, `setDetail`; interior.ts `WINDOW_FILL`,
  `fineDetail` call sites, `doors`; context.ts `fineDetail`; vehicle.ts `viewFrom`,
  `driveKit`; main.ts, playground.ts*
- **The inside mirror vanished at the line.** → From 8 m ahead its pad stood black
  against the screen and the sky: the one fine part plainly seen going (2101 front view,
  normal lens: 152 pixels differed from HEAD with it fine, 19 with it coarse). → The
  mirror is coarse (2 meshes). *interior.ts `headliner`*
- Left: at night a lit cluster's faint glow (ticks, needles) goes at 6 m: from the rear
  three-quarter at 8 m, 1–8 pixels darker by at most 29 of 255. The courtesy lamp's lit
  lens goes at 6 m too, on a car left with it on.

## Simpler faces (2026-10-15)

Renders: `/tmp/tail2112/` (round 1: `cmp_*`), `/tmp/tail2112/r2/` (round 2: `cmp_*`, left
HEAD c3ebe42, right after; the owner's rear 3/4 of the 2112 at 17 h and 8 h, the flap, the
bumper corner, the 2110, the 2115's rear, front and side), `/tmp/tail2112/final/` (lamps at
night, parts open).

- **2112: "the rear corner has too many faces, could it be simpler?"** (owner's screenshot:
  a mosaic on the wrap-round tail lamp, streaks on the panel above it). → The corner lamp
  stepped along the flank every 20 mm (`CORNER_LAMP_STEP`), three rows high, and every
  cell, under the `rearLean` warp, bent its own way; each cell also cut its own hole, so
  the quarter above was a fan of thin triangles from the D pillar's foot to each notch.
  `kit_tail` was 152 triangles (2109: 8). → The lens bends only where the skin under it
  does: at the tub's columns along the flank (`tubColumns`, now exported) and across its
  height only at a crease or belt running through it (the tens' front indicator); every
  other stretch is one flat piece. `kit_tail` 28, each rear indicator 88 → 22 (the
  last 0.45 m of the car); holes cut under the 2112's items 145 → 41. *exterior.ts
  `buildCornerLamps`, body.ts `tubColumns`*.
- **"Shouldn't the generator itself work that way: if it can be simpler, why
  complicate?"** → Generators sample strips and cut holes, and nothing merged what came
  out flat; the 2112's body paint was 3035 triangles, 272 of them slivers and 116 of zero
  area (2109: 1742). → `simplifyFlats` runs on every car after the leans: in each builder
  mesh a vertex whose triangles lie in one plane (0.1 mm, 1.5°) in one colour is taken
  out and the hole refilled by the fattest ear each time (no fans); zero-area triangles
  go; a vertex on an open edge goes only where the edge runs straight on and no other
  mesh has a corner there. Every car moved (8–18% fewer triangles: 2101 12 393 → 11 229,
  2109 12 593 → 11 394, 2112 16 553 → 13 634), all 13 bounds identical; the 2112's body
  paint 2105 triangles, 212 slivers, 15 zero-area. *simplify.ts, kit.ts*.
- **A 2 mm strip down the whole tens' flank.** → A point of the rear door's rounded shut
  line fell 2.4 mm under the fuel flap's top (0.8324 against 0.83), and every point of
  that line is a side row on every tub column. → A point within 5 mm of the flap's top or
  bottom takes that height (`ROW_SNAP`). *body.ts `BodyFrame.shutLine`*.
- **2112: "an artifact on the fuel flap".** → The filler cup behind it was a box squared
  to the skin at the flap's middle; the flank tapers and leans in over the flap, so the
  cup's rear top corner stood out through the closed flap (a black wedge, 2110 too). → Its
  rim follows the skin as built at each corner, 5 mm inside (`skinX`). A thin dark line in
  the flap's top gap seen from above remains (the gap itself). *exterior.ts `buildFiller`*.
- **"The rear bumper corner facets can be simplified."** → A flank-following bumper
  turned its corner in two facets (a 45° mid point) and stepped along the flank in five
  even steps that missed the stations where the side bends, so the body showed through
  in a notch above it. → A corner up to 0.15 (`BUMPER_CHAMFER`) is one chamfer from the
  flank, level with the end face, to the face (a chamfer from further along let the
  body's corner through); along the flank a point at each station; the hole in the end
  face stops 15 mm short of the corner (`BUMPER_HOLE_END`). The 2110's front (0.28) keeps
  its two-step turn. *exterior.ts `flankBumperPath`, `bumperHoles`*.
- **2115: "the rear bumper is now too massive compared to the front one".** → It was the
  only kit bumper still a box standing out of the tail with square sides and a shelf on
  top; the front one is flush and runs along the wings to the arch. Photos p19 (right
  side) and p13 (rear 3/4) show the rear one doing the same. → The measured height
  (0.306) kept; `flush` and `wrapTo` 3.675 (the arch's back at 3.65). The front fog lamps
  moved 15 mm inboard (±0.505–0.675, lenses ±0.535–0.645) to stay on the bumper's flat
  face, which now turns into its chamfer at 0.676 (the census found a slit there).
  *samaras.ts `LOOK_2115`*.
- Checks: `kit-zfight.ts` PASS on all 13 (0 visible clusters, 0 slits); `fit-models.ts` on
  all 13: rows identical but the 2110's and 2112's `hoodPoint` height, 17 mm lower (the
  bonnet window is sampled by vertex and a flat run's inner vertex went; the bonnet did not
  move; the kit cars' cabin view uses `cabinEye`); the car lab links 15 programs after
  boot and the same later ones (night sky, first framing) on HEAD and after, none from
  lamps or opened parts.

## Three draws a car (2026-10-15)

Renders and numbers: `/tmp/onedraw/` (`before-*` HEAD 5a9136e, `after-*`; `diff-*`
amplified differences; `bench-*.json`, `pick-*.json`).

- **A near kit car was 60–150 draws in the scene pass, ~40 in the sun's and 34 in the inside
  mirror's, each 3–4 µs of main thread** (the owner approved making it ~3). → One mesh
  per material slot per part (14 slots, ~107 moving parts: 140 part × material pairs on
  the 2112). Merging needs one material, and the parts move. → (1) Every slot but the glass
  is one material, the slot in the vertices (`color`, `CAR_SURFACE_ATTRIBUTE`: paint
  share, roughness, metalness, lamp role; `KIT_SHADOW_ATTRIBUTE`: casts, receives), each
  car's copy its paint, lenses lit per role from uniforms; (2) the car merged into one
  rigid-skinned mesh per material on its own nodes as bones, the four wheels one more; the
  parts kept as pick proxies on `KIT_PICK_LAYER`. Own car cabin 87 → 6, chase 142 → 4,
  parked car 72–150 → 4, sun 37–44 → 3, mirror 34 → 4; `renderer.render()` with five kit
  cars 2.9 → 1.5 ms. Car-lab A/B on four cars, day, night, parts open, dust: at most a few
  hundred pixels differ (blink phase aside); the same picks for every control, seat, door
  and sticker aim on HEAD and after. *carkit/materials.ts, render/kitdraw.ts,
  render/materials.ts, render/carmodel.ts, carkit/rig.ts, vehicle/vehiclelamps.ts*.
- **A drop pane cut on the CPU each time it moved** (`SinkingPane` wrote a cut copy of the
  pane per car) could not be cut out of a merged buffer. → The pane slides as its own bone
  and its glass discards what is below the door's top (`KIT_PANE_ATTRIBUTE`, its height
  over the pane's bottom edge; `setCarGlassPaneDrop`); a ray meets only what shows. Lab
  renders of the 2112 with panes at 0.3, 0.5 and 0.8: 56–64 pixels differ from HEAD's cut.
  *carkit/rig.ts `SinkingPane`, `paneFrame`*.
- Not merged: the mirror faces (shown and hidden by render/carmirrors.ts) and a sticker
  layer, one draw where a car has stickers.

## Nivas and Oka (2026-10-16)

- **2121: the tail corners stood behind the tailgate, a pale wedge between them (lab).**
  → With `flat` tail stations at belt 1.0 the corners rose upright 0.1 behind the
  tailgate's raked lower panel, and the greenhouse's last strip left the lining showing.
  → The belt runs at 1.0 to s 3.58, where the raked line crosses it, and the tail
  stations stand at 0.775, so the D pillar comes down the raked line flush with the
  tailgate (the Samara's arrangement). *nivas.ts*.
- **2131: a pale sliver on both tailgate pillars (owner).** → The belt's turn down at the
  station 3.58 (+0.5) lay inside the D pillar's last greenhouse strip; the strip's foot
  bent there while its top did not, the skin twisted and the lining showed through. → A
  cabin column at that station, so no strip folds across a bend of the tub (2121 too).
  *nivas.ts*.
- **Niva bench and Oka bench fought the wheel-house covers at a distance.** → A bench
  standing between the covers kept the usual 2 mm. → `bench.clear` 0.04 on those layouts.
  *interior.ts*.
- **Oka bonnet in long slivers (owner: "переусложнили").** → The drawn crown grew from 45
  to 99 mm and shrank again along the bonnet, a twisted surface the flat-run merge cannot
  flatten. → One crown, 70 mm over the wings' top all along. *oka.ts*.
- **Oka: stacked tail lamp bands, and the door's rear shut line, fought (gate).** → The
  bands' rims inside the body shared their planes where the bands shared an edge (seen
  from the cabin through the load space); a door ending on one column above and below
  the belt crossed its seal and its painted edge. → 6 mm between the bands; the frame
  above the belt ends 2 cm before the door's lower shut line (the 2121's B pillar).
  *oka.ts*.
- **Oka: only the left mirror, the tailgate down between the lamps (owner).** →
  `KitLook.mirrors: 'left'`; a tailgate comes down the tail face like a boot lid when the
  last station has a `notch` (`BodyFrame.lidFace`, `lidOwner`). *spec.ts, exterior.ts,
  body.ts, oka.ts*.

## Volgas and AZLK-2141 (2026-10-16)

- **2141, GAZ-24, GAZ-31029: the A pillar too heavy, the front door's glass squeezed by
  it (owner).** → The door's frame and glass columns stood at the drawn frame and glass
  lines, far behind the pillar's line at the belt (a drawn sail, a rounded quarter-light
  corner, glass edges more upright than the pillar): 0.38 / 0.24 / 0.20 of painted s at the
  belt between the screen and the glass. → The pillar's line (the screen's) kept; the
  door's frame 0.04–0.05 behind it and the glass 0.03–0.035 behind that, parallel to it
  down to the belt (0.075–0.08 of s, 5–6 cm across, as the drawn and photographed pillar
  and frame); below the belt the wing still reaches the door's shut line (`lower: 'body'`).
  *azlk.ts, volgas.ts; measurements-2141.md §1, measurements-volga.md §3.5*.
- **2141: the front bumper covered the lamps' lower edge (owner).** → A moulded bumper's
  band starts `drop` under the face's sill bevel (sill + 0.035), not under the sill: the
  draft's 0.04 / 0.36 put its top at 0.605 over lamps from 0.584 (the rear 0.585 over
  0.556). → `drop` 0.085 / `height` 0.365 (0.20–0.565) at the front, 0.075 / 0.265
  (0.28–0.545) at the back, both tops under the lamps as drawn. *azlk.ts*.

## UAZ-469 (2026-10-17)

- **UAZ-469: the door mirrors too low on the body, hard to see from the cabin (owner).** →
  The generic short arm puts the head's centre 0.08 over the belt: 1.19 on the 469, under
  its glass's foot (1.23), 15° under the eye; from the seat the door trim hid 34 % of the
  left glass and the cabin trim 72 % of the right. On the car the head stands on an
  upright stalk from a bracket at the door's front edge, beside the glass's front lower
  corner, centre 1.345 drawn (`uaz2.jpg` side), 1.34-1.39 on photos. → `KitLook.mirrorStalk`
  0.17: the bracket under the belt at s 1.385, a rod 2 cm off the skin up to 1.36, an arm
  out and back into the head at s 1.45 (was 1.415); both glasses seen whole through the
  door glass, the left one 4° under the eye in the straight-ahead view. *spec.ts,
  exterior.ts `buildDoorHardware`, uaz.ts; measurements-uaz.md §1.2*.
- **UAZ-469: the sun visors too high to shield the sun; is the roof flat? (owner).** → The
  roof's crown was a parabola from the edge (1.82 at ±0.75) to the centre (1.93): 1.84 at
  the pillar row (±0.69), and the windscreen's top arched with it, 1.79 in the middle and
  1.70 at the pillar row. The 3151 front view (`uaz2.jpg`) is level at 1.93 to ±0.64 and
  rolls down only in its last 0.13 (1.91 at ±0.69); the owner's four front photos show the
  canvas straight across over the bows with small rolled corners and the frame's top bar
  straight. No sag across or between the bows on the photos: the canvas is stretched.
  `crownPower` 20: the roof 1.93 to ±0.64, 1.91 at the pillar row; the screen's top 1.79
  across, 1.77 at the pillar row; height and bounds unchanged, 11 309 → 11 260 triangles
  (the flat runs merge). The visors lay under the canvas, which rises 0.14 over the
  windscreen frame: their pivot 1.84, 12 cm over the glass's top there (1.72); lowered,
  their bottom edge stood 26° over the eye and the glass's top 25° (now 27°): they covered
  no glass. Under a soft top they now hang from the frame's header bar: pivot 1.756, 5 cm
  behind the glass, stowed 1.74-1.756 (30° over the eye, clear of the glass); lowered to
  1.60, its edge 18.5° over the eye, shading the glass's top 14 cm (the sun from 18.5° to
  27°). *uaz.ts, interior.ts `headliner`, spec.ts; measurements-uaz.md §1.3, §1.7, §1.8*.
- **UAZ-469, UAZ-2206: the dash should be the body's colour (owner, 2026-10-18).** → It was
  trim in a fixed olive (`KitLook.dash`). → `KitLook.dashPainted`: the dash's body, the
  instrument plate and the glovebox lid go in the paint slot in white (`Cabin.dashSurface`),
  so they take the car's paint and wear; knobs and ashtray keep the olive shade. *spec.ts,
  interior.ts `dash`, `glovebox`, uaz.ts*.
- **UAZ-469: the wipers park half way up and cover the view (owner, 2026-10-18).** → The
  screen is 0.41 tall over the spindle: with a 0.33 blade the longest arm that fits upright
  is 0.23, its blade's inner end 6.5 cm from the spindle, and it cannot lie flatter than 18°
  and stay on the glass. The old 469 has its wipers in the frame's header (motor СЛ236Е,
  "верхнее расположение"; blades 280 mm, СЛ236Е-5205900). → `CabinSpec.wiperMount: 'top'`:
  the bottom pair turned half round in the screen's plane (spindles mirrored across, arms
  hanging from the header, parked to the right, sweeping down), blade 0.28: 0.255 arms
  parked 12° under the header, sweeping 100°. The other cars' wipers are unchanged.
  *spec.ts, exterior.ts `buildWipers`, uaz.ts*.
- **UAZ-2206: under the lifted engine cover a dark box, and the bonnet grid strongly
  offset (owner, 2026-10-18).** → The cover hid a schematic block (`Cabin.engineCover`),
  and the four cells (`buildVanServiceCells`) were hand-placed at s 1.12–2.35, ±0.8, on
  the shell's floor: 0.36 m ahead of the cover, out under the seats and 0.28 m under the
  cabin floor. The cover also overlapped the seats' backs and the handbrake's base, and,
  hinged at its front top edge, swept its front wall through the room and its back
  through the roof. → `BayRoom`: `buildEngineBay` lays out the classic's bay in a room, a
  car's under its bonnet (`bonnetRoom`, the shell's walls round it) or the van's under the
  cover (`coverRoom`, interior.ts `engineCoverRoom`: no walls, battery and bottles
  standing on the floor with no bottom faces), with the same four cells on its contents.
  The cover is a hollow pad with no bottom, from s 1.60, hinged along the car at the foot
  of its left wall and lifting its right edge 43° towards the side door. A compartment
  under it (`cabinLidOpen`) is reached through an open side door, `BOOT_RANGE` counted
  from the opening (`kitOpenDoorDistance`): from the door the air filter's cell was
  1.62–1.74 m from the eye. The 21 other cars identical. *bay.ts, interior.ts
  `engineCover`, builder.ts `bevelBox`, player/interaction.ts; measurements-uaz.md*.

## Daewoo Nexia (2026-10-18)

- **Nexia: its signature is the slight, gentle curves of the head lamps' and tail lamps'
  lines; the head lamps were flat rectangles blending into the body, the tail lamps one
  straight orange/red block (owner).** → Every `cornerLamps` point had the same height
  span, so each unit was a straight band: square inner ends, a level top and foot, and a
  head-lamp end on the wing as tall as on the face. → The outlines from the drawing's
  zoomed front and rear views and the photos, with points of their own height spans (no
  generator change): the head lamp's top one gentle arch (0.705 at the inner end, 0.713
  mid, the face's shoulder at the corner), its foot sweeping up to the corner (0.615 →
  0.63, the face's plan rounding drawn in the foot), the indicator round the corner and
  on along the wing as a dome closing to a point at s 0.40 (the drawn side view); the tail
  lamps' inner side one convex line from the foot's inner corner leaning out to the level
  split (0.811) and rounding over into the top (three points, ±0.468 → ±0.497 → ±0.53 →
  ±0.562), the upper band light over the red. Lamp materials and colours untouched (the
  owner: the way lamps are drawn stays). A trapezoid grille along the lamps' inner ends
  (`grille` `slant`) was first dropped: unused by any car so far, its bars were sunk 4 mm
  into its dark back, and their top and bottom walls ran parallel to the back's own walls
  4 mm off them (a far-band fight, `exterior.ts` `slantedGrille`). 13 258 → 13 366
  triangles; the 22 other cars identical. *daewoo.ts `LOOK_NEXIA`; measurements-nexia.md
  §2, §3*.
- **Nexia, the owner's follow-up: the grille a trapezoid narrowing to its foot, the head
  lamps the narrow "squinting" trapezoid with the inner edge along the grille's side.** →
  The slanted grille's bars stood sunk 4 mm into its back, so a bar near the opening's top
  or bottom edge had a wall 4 mm from the back's wall and parallel to it. → The bars stand
  on the back's face instead (from `floor`, not `floor − 0.004`), the back cut under them
  2 mm deeper so its face lies inside the cut; no car used `slant`, so every other car is
  identical by geometry hash. The Nexia's grille: opening ±0.245 at the foot to ±0.30 at
  the top (`slant` −0.055) in a 0.01 black frame, as drawn; the head lamp's inner end
  leaning along it 13–15 mm off the frame (±0.27 → ±0.325), its top falling to 0.70 at the
  inner end, so the lamp narrows to an acute inner top corner. Checked headless (throwaway
  runs): a frameless horizontal and a framed diamond slanted grille also pass
  `kit-zfight`; a frameless diamond leaves a slit at the opening's side (its bar ends need
  the frame over them). 13 472 triangles. *exterior.ts `slantedGrille`; daewoo.ts
  `LOOK_NEXIA`; measurements-nexia.md §8*.
- **Nexia review 2 (owner, with a photo of the real lamp): "only the SHAPE of the front
  lamps"; the indicator is the tallest part, the lamp rising gradually to it from its
  inner corner.** → The amber indicator ran as a long pointed dome along the wing to s
  0.40 and the head lamp's top peaked in its middle. → The indicator is a short end of the
  same lens from ±0.56, round the corner to s 0.215, rounding down there; the top rises
  evenly from 0.688 at the inner corner to 0.72 over the indicator, the foot unchanged.
  Lab shots front, 3/4, side and close; `kit-zfight` kit_nexia passes; fit and proportions
  unchanged. *daewoo.ts `LOOK_NEXIA.cornerLamps`*.

## Daewoo Espero (2026-10-18)

- **Espero review 1 (owner): its own dash instead of the Nexia's; the pillars and mirror
  sail black as on the car; the lamps checked against the photos and drawing much more
  precisely, shape only.** → The draft reused `CABIN_NEXIA` (no Espero interior on
  Commons). The kit had no black finish for a greenhouse strip, so every frame was paint.
  The lamps had been set from two 3/4 photos by eye: the head lamp a wedge whose top fell
  0.05 to a short upright inner end; the tail lamps 0.785–0.925, 0.1 too high, with a thin
  lid strip; the wrap's top further forward than its foot. → The dash is read off
  SelfBase.de's instrument-panel photos and an owner's cluster photo (drive2.ru):
  `CABIN_ESPERO`, three equal dials, switch pods, the black stack, a high glovebox, four
  spokes. Its first binnacle face stood 2 mm ahead of the cluster's plane and fought it
  (`kit-zfight`); it now stands in the plane (0.472). `CabinColumn.finish: 'black'`
  (body.ts: the strip's faces above the belt as dark trim, the rail's chamfer painted) is
  set on the Espero's door frames, B pillar, rear post, quarter-glass frame and sail. The
  lamps were measured on eight photos, one of them near square (1.38 mm/px across the lid
  band), with ratios of vertical spans for the heights. Front: a slanted inner edge from a
  pointed tip, a nearly level top, and the split leaning out. Rear: one band 0.67–0.82 with
  a red/amber split at 0.725. The lid band is a red top across the lid plus, under each end,
  a lens set 4 mm back and running behind it: two lenses meeting edge to edge left notches,
  because a lens's corners are chamfered. The lid cut is ±0.49, and the foot wraps further
  forward than the top. The fog and reversing lamps' faces were brought back inside the
  bumpers: at 0.075 proud they stood 25 / 18 mm out and lengthened the native body, so the
  loader moved the hubs 12 mm in their arches (`kit-proportions` gate). *daewoo.ts
  `BODY_ESPERO`, `LOOK_ESPERO`; interior.ts `CABIN_ESPERO`; spec.ts / body.ts
  `CabinColumn.finish`; measurements-espero.md §5*.

- **Espero lamp review 2 (captain on the maroon photos): the head lamps too thin, the
  indicator a separate block; the lid band a "staple" with tabs; amber only part of the
  corner units; the wrap too long.** → The head lamp's height had been held to the drawn
  side view's 0.088, though every photo shows the lens filling the band from the bumper's
  black top to the bonnet's edge. The lid band's lower end lenses had upright inner ends,
  set apart from the corner units. → The head lamp is now 0.582–0.70: its foot one level
  line on the bumper, its inner end slanted from ±0.20 to ±0.27, and the indicator the
  outer 22 % at the same height, square at the corner. At the tail, the lid band's ends
  have a slanted inner edge (`lens` `slant.inner` 0.06) and reach ±0.483; the corner units
  are amber over their whole width and wrap to s 4.47 / 4.44. Lab shots from the maroon
  photos' angles; `kit-zfight`, `kit-proportions`, `reality` pass. *daewoo.ts
  `LOOK_ESPERO`; measurements-espero.md §5*.

- **Espero sun visors (owner): far too big, lowered they cover everything.** → Every kit
  car's visor was one size, 0.32 × 0.15. Under the Espero's low, raked roof (the screen's
  visible height 0.29 from its foot strip to its header) a lowered visor hung down to the
  horizon from the driver's eye. → A layout field `visor: { half, depth }` (absent: the
  stock 0.16 / 0.15, so every other car is unchanged); the Espero's 0.10 deep, a third of
  its screen's visible height. Checked raised and lowered from the driver's eye in the lab;
  `kit-zfight` passes. The Nexia keeps the stock size (screen 0.315 visible, so a third
  would be 0.105); reported, not changed. *interior.ts `Layout.visor`, `CABIN_ESPERO`*.
- **Nexia sun visors (owner, after the Espero's): the same.** → The stock 0.15 visor,
  lowered, came down past the horizon from the driver's eye. → `CABIN_NEXIA` `visor` 0.105
  deep, a third of its screen's visible 0.315. Checked raised and lowered from the driver's
  eye node (`kit_driver_eye`, 1.195 high); `kit-zfight` passes. *interior.ts
  `CABIN_NEXIA`*.

## Driver's eye (2026-10-18)

- **From the driver's eye the low cars showed no sky: the windscreen's header stood at eye
  level (owner, with the visors).** → The eye was set by the seat (cushion + 0.74) and
  held 0.13 under the headliner; it never looked at the screen. On the classics the header
  stood 5.5° over level, the 2104/05/07 6.25°, the Samaras 7.25°, the GAZs 7.25–7.5°, the
  2110s 8°, the Espero 8.25°. → `driverEyeAt` lowers the eye until the header's lower
  edge (`screenHeaderEdge`: the glass's visible top under `screenHeader`, the lining's
  depth under that) stands 10° over level, by at most 3.5 cm (`EYE_LOWER_MAX`). Each cm
  lowered hides more road over the binnacle: the classics needed 8 cm for 10°, which hid
  the road to 41 m ahead (7 m before). The rear eye, seats, floor and roof are unchanged.
  The ray check (eye node, rays straight ahead) gives old/new up-angle and nearest road
  visible:
  - 2101/02/03: 5.5→8°, 7.1→10.7 m
  - 2106: 5.5→8°, 7.3→11.2 m
  - 2104/05/07: 6.25→9°, 6.5→6.8 m
  - Samaras: 7.25→10.5°, 6.8→8.9 m
  - 2110s: 8→10.5°, 6.1→7.7 m
  - GAZ-24: 7.5→10.5°, 9.6→10.8 m
  - 31029: 7.25→10°, 8→8.5 m
  - Espero: 8.25→10.75°, 6.1→6.4 m
  - The rest already over 10°, unchanged.
  No eye inside a mesh; the nearest headrest is 0.126 m (2106). `kit-zfight` passes on all
  cars (the mirrors are turned to the eye). *interior.ts `driverEyeAt`, `HEADER_OVER_EYE`,
  `EYE_LOWER_MAX`*.

- **The lowered visors still hung below the driver's eye height** on the classics, Samaras,
  2110s, Oka, Espero and Astra (0.8–3.6 cm under it, from the new eye). → Each gets a
  `visor.depth` so its lowered bottom edge ends 5–6 mm over the eye's height, the width
  kept: 2101/02/03/06 0.13, 2104/05/07 0.128, Samaras 0.134, 2110s 0.137, Oka 0.119,
  Espero 0.078 (was 0.10), Astra 0.108. The rest already ended over it (Nexia +1.4 cm,
  GAZs +1.1/+1.6, 2141 +1.1, Nivas +8, UAZes +11/+13) and are unchanged. `kit-zfight`
  passes. *interior.ts `CABIN_*` `visor`; specs.ts `VISOR_CLASSIC`, `VISOR_SAMARA`*.

## Opel Astra F (2026-10-18)

- **The rubbing strip fought the front wing and the indicators.** → The waist runs nose to
  tail in straight 0.3 m pieces. The drawing's plan (the bumper's outline) rounded the
  wing so hard that the wing bulged 2–3 cm through the strip's chord. The strip also
  crossed the indicators where they wrap onto the wing. The real strip is on the doors
  only. → `KitLook.waist.span` (absent: nose to tail, every other car identical), the
  Astra's strip 1.25–3.2, and the wings above the bumper drawn straighter behind the
  corner. *spec.ts, exterior.ts `buildWaist`; opel.ts*.
- **The hatch's tail bands fought from the load space** (as the Oka's): 6 mm of body
  between them. *opel.ts `LOOK_ASTRA_F.cornerLamps`*.

## Opel Vectra A (2026-10-18)

- **A slanted grille under a leaning face fought at a distance** (its slats 5 mm over its
  back; with a frame, the frame's inner walls against the slats' ends). → `frontLean`
  tilts the grille's planes; the Nexia's, on an upright face, passes. → The Vectra's face
  stands upright and its grille is frameless. *opel.ts `BODY_VECTRA_A`, `LOOK_VECTRA_A`*.
- **The lid's black panel ended 8 mm over the lid's foot and its bottom fought the lid's
  edge.** → It ends 16 mm over it, inside the notch. *opel.ts*.

## Espero, Vectra, Astra review 2 (2026-10-18)

Renders: `/tmp/{espero,vectra,astra}/r2-*.png` (`r2-doors` doors open, `r2-cabin` the
in-game cabin view via `__bro.driveModel` + `camera.showCabin`, `r2-vs-photos`). Tables in
each measurements file's "Review 2".

- **Espero, Vectra: the mouldings looked stuck on and cut unevenly; a door that opened
  took a piece of the wing's moulding and skin with it (owner).** → `buildFlankStrip` split
  each strip at the door nodes' bounding boxes. The front door's box reaches over the wing
  to the A pillar's foot and the rear door's box goes past its raked shut line, so the
  doors took lengths of the wing's and the C pillar's strip. → The strip is cut at every
  cabin column's shut line (a raked `foot` line at its slant), and each piece takes the
  owner of the skin under it (`BodyFrame.flankOwner`, the owners `buildShell` gives the
  side faces), 5 mm short of the seam. The same goes for every car's waist and feature line.
  *exterior.ts `buildFlankStrip`, body.ts `flankOwner`, `shutS`*.
- **Espero: the A pillar so thick that the door mirrors could not be seen from the seat
  (owner).** → The pillar matches the drawing (1.267 → 2.03). The mirrors stood at the
  generic 8 cm behind the pillar's column (1.38) while the drawing has them at 1.78–1.90 on
  the sail. The driver's line to them crossed the black sail. → `KitLook.mirrorS` (Espero
  1.74, Vectra 1.60, Astra 1.53), the glass's front edge moved forward to the sail's foot
  (Espero 1.62, Vectra 1.55, Astra 1.47). Checked in the in-game cabin view: both mirrors
  through the side glass on all three. *spec.ts `mirrorS`, exterior.ts `buildDoorHardware`*.
- **Vectra: the rear door monstrously narrow (owner).** → The 1989 preview was read with
  the small quarter glass as body. The door ended at 3.03 against the drawing's 3.30, so it
  was 0.63 long at the belt against 0.96. → The door carries the quarter glass to 3.29, the
  shut line raked from 0.80 to 2.98, the B pillar's shut line at 2.345 (was 2.385/2.40).
  *opel.ts `BODY_VECTRA_A`*.
- **Astra: dents on the front wings (owner).** → The plan's slope broke at s 0.3 and the
  flank's lean over the belt changed station to station (0.10–0.16). → One curve through the
  drawn plan and a constant 0.14 lean. *opel.ts `BODY_ASTRA_F` stations*.
- **Astra: the fog lamps hidden in the bumper, something sticking out of it (owner).** →
  The intake slab and fog panels were flat face items on a bumper whose face curves back
  from ±0.45: the slab's ends stood out and the lamps' inner ends sank in. → `inlays`, laid
  on the bumper's own face along its path, at the photo's heights; a rubber rib where the
  groove was. *spec.ts `inlays`, exterior.ts `facePath`*.
- **Astra: the rear door's shut line ran 7 cm into the rear arch.** → `foot.knee`: the
  line bends in front of the arch's lip (3.02, 0.54) as drawn. *body.ts `shutLine`*.

## Owner review 2, direct fixes (2026-10-19)

- **2104/2105/2107: the returned black wedge ahead of the door glass (owner).** → The
  shared `BODY_05` cabin columns had `finish: 'black'` on the 1.06–1.17 m strips, making
  a 13 cm black sail that the owner rejected. → Keep the measured columns and glass, but
  remove the black finish so the A-pillar/frame is body colour. *specs.ts `BODY_05`*.
- **Door mirror feet could float above tapered panels (owner).** → The generic short arm used
  the belt edge for its base even where the shoulder turned inward; stalk brackets used the
  same extrapolated point. → Probe `skinX` at the mounting height, sink the short base and
  upright bracket into the skin, and add a `kit-mirrors` shell-overlap gate. *exterior.ts
  `buildDoorHardware`, tools/kit-mirrors.ts*.
- **2102/2104: a thin slit down the tail corner's outer edge, and a beige sliver over the
  2104's lamps (owner).** → `rearLean` bends every point above its base, but a triangle
  reaching across the base stayed a straight chord through the bend while its neighbour,
  cut finer round a lamp's hole, followed it: a slit along the corner. Under an estate's
  knee the D pillar's foot strip and its end band down to the tailgate's foot were fanned
  on the inward diagonal, and the lining offset from them (28 mm along mean normals) and the
  load space's side wall, carried on to the rear base, came out through the skin. → Tail
  triangles are cut at the lean's base before the warp (`leanEnd`, `splitAtBase`); the
  knee bands of a `flat`-tail hatch are cut on the outward diagonal and carry no lining
  (`Face.knee`); the hatch's side wall ends at the knee. The 2104's tailgate is cut between
  the lamps (`notch` 0.50) and the painted stopgap panel behind them is gone. Hash-proved:
  only 2102, 2104 and the two tens hatches 2111/2112 (same code paths) change. *kit.ts,
  body.ts, bay.ts, estates.ts*.
- **2105/2107: the rear overhang "too slanted" (owner).** → The boot's rounding ran over
  0.175 m from s 3.9, one long 45° chamfer over a short tail face. → A station at 4.035:
  the drawn boot rolls down only in its last 5–8 cm, so the corner turns in over 4 cm and
  the face stands upright to 0.80. *specs.ts `BODY_05`*.
- **2102/2104/2105/2107: black inserts at the A pillar (owner).** → The door's frame from
  the pillar's line showed its 3 cm rubber edge up the pillar and a shut slot at its foot.
  → Those strips are the body's; the door starts at its drawn front. *specs.ts, estates.ts*.
- **UAZ-469 and UAZ-2206 front overhangs hung below the bumper (owner).** → Their front
  sill stations were below the bumper's lower edge before the wheel arch. → Raise only the
  front sill stations to 0.60 m, leaving the post-arch body and wheels unchanged.
  *uaz.ts `BODY_UAZ469`, `BODY_UAZ2206`*.
- **Dashboard references for future cars (owner).** → Finished cars must not be reworked just
  to fill missing or imperfect dashboard photo references. → Explicitly accept the current
  car list in the dashboard gate; every future car needs a real interior photo and `dash`
  block or `DASH UNVERIFIED` fails `kit-check`. *tools/kit-drawing.ts, tools/kit-check.ts,
  src/carkit/README.md*.

## Police UAZ-469 (2026-10-18)

- **The police car: the UAZ-469 black with white doors, «МИЛИЦИЯ» on them and a light bar
  (owner).** → A car's paint is one colour from its material; a white door "in trim"
  would lose the paint's dust, scratches and stickers; a light bar's lamps must flash with
  no new program and no material swap. → `KitLook.livery` (police.ts): the doors' skin in
  a new slot `livery` (paint share 1, its own vertex colour: render/materials.ts
  `CAR_LAMP_LIVERY`, the kit program key `-kit-v3`, still one program for every kit car;
  the far mesh draws it at share 0 in its colour); the lettering split into the front
  doors' skin along its strokes, not laid on it; the bar's two lenses each a dark lens and
  a lit twin in `lamp_glow` on `beacon_l` / `beacon_r` (`kitMotion` `visible`, the lit one
  hidden as built, merged into the near mesh all the same, left out of the mid and far
  bakes: farcars.ts `collectPieces`). `kit_uaz469_police` is resolvable by id and in no
  catalogue list; its factory height is the 469's plus the bar at the 469's fitted scale.
  *police.ts, materials.ts, builder.ts, rig.ts, kit.ts, specs.ts; render/materials.ts,
  render/farcars.ts, render/carmodel.ts; vehicle/carmodels.ts*.
- **The white doors fought the black body round their shut lines from 25 m** (kit-zfight:
  the doors' end faces 1–6 mm off the body's jamb flanges, once the two differed in
  colour). → The whole door mesh was livery, edges included. → Only the faces turned out
  of the side within 45° (skin, shoulder, the frame's outer face) are livery
  (`${door}_livery`); the edges keep the car's paint (`${door}_paint`), like the jambs
  they face. *police.ts `paintDoors`, `SKIN_FACING`*.
- **Removed with the police (owner, 2026-10-21).** → The game has no police any more, so
  nothing spawns the car. → `police.ts`, `KIT_SPECS.uaz469_police`, its catalogue row,
  factory row, fit row and reference file are gone, and so is the machinery only it used:
  slot `livery` and `CAR_LAMP_LIVERY` (the kit shader's role is a `vec2` again), the
  beacon channels, the negative-`amount` `visible` motion and `collectPieces` taking a node
  hidden as built. A save naming `kit_uaz469_police` loads on `kit_uaz469`. The plain
  UAZ-469 is unchanged.

## Mercedes W124, the owner's first review (2026-10-27)

- **«форма колёсных арок»; «передний свес у 190e довольно короткий» (on a W201 photo).** →
  The draft's arches were circles (front 1.18 R, 0.374) whose tops were right (side photo
  0.371, drawing 0.366), but the photo's front arch hugs the tyre's sides: 3 cm of black at
  the hub's height, not 5.7; the ring of black ahead of the tyre read as a long nose. The
  overhang itself was 0.82 against the published 0.815 (angurten.de; W201 traits only, its
  photo is no W124). → The front arch a half ellipse 0.343 wide and 0.371 high (new
  `WheelSpec.frontArchRise`, the front counterpart of `rearArchRise`); the rear kept (it
  measures as the circle, higher than the front, not lower); the hubs 0.815 / 3.615; the
  front bumper wrapped back to the arch. kit-drawing measures each arch's opening now
  (`archFront`, `archRear`), so later cars can be held to their photos. *spec.ts, body.ts
  `archY`, mercedes.ts, tools/kit-drawing.ts, refs/w124.json*.
- **«вздутый багажник».** → The deck rose from the back light's foot to a peak at s 4.35
  and fell to the tail: a hump. The drawing's centre line peaks at the lid's front edge
  (1.056 at 4.10) and falls straight to the tail (1.004 at 4.68); the side photo is level.
  → The deck station moved to the lid's front edge (4.08, 1.055), straight to a crisp
  corner at 4.68 (1.02); the wing's top edge rises with the lid so the crown across stays
  1.5 cm (a crown changing from 1 to 4 cm over 12 cm was a dent, kit-surface). *mercedes.ts
  stations*.
- **«а разве спереди не ребристые фонари?»** → Only the tail units had `ribs`. → `ribs: 3`
  on the front unit (dark lines, the owner's choice). *mercedes.ts `cornerLamps`*.
- **«треугольники - ну явно же есть, где сэкономить»** (13 621). → The provenance census:
  every point of a raked shut line and of `roofDrop` is a side row or a roof bend along the
  whole car, and each arch adds 15 tub columns. → The rear door's edge bent at the flap's
  existing rows and sharp at its foot (`foot.knee`, 549 triangles), `roofDrop` thinned
  (371), 8 arch segments (new `WheelSpec.archSegments`) and one station fewer (with the
  boot, 461); the ribs, the boot's crown and the lowered sill added 204: 13 621 → 12 444.
  *mercedes.ts, body.ts `tubColumns`; measurements-w124.md §8*.
- **The sill «по чертежу»** (0.255 / doors 0.275 over the drawn 0.19 / 0.21). → The
  classic exhaust stood through a floor at 0.19. → The exhaust made flatter for every car
  (the Exhaust change, bay.ts), then the W124's sill 0.19 and doors' bottom 0.21; the
  `accepted` deviation in refs/w124.json removed. *mercedes.ts stations, `doorBottom`*.

## Mercedes W124, the owner's second review (2026-10-27)

- **«сравни расположение колеса с фото»** (his lab shot of the near front: the bumper's
  corner well ahead of the tyre, a dark gap over and ahead of it, the tyre small and set
  back in the arch; compared with a square side shot of a 190E). → Not the loader and not
  the overhang: the kit body measures 4.752 long natively, so the loader shrinks it 0.3 %
  along and 0.7 % in height and moves the front hub 4 mm in its arch (kit-proportions); a
  narrow-lens side capture of the lab reads the bumper's tip 0.795 ahead of the hub, the
  arch's top 0.368 over it, the tyre 0.317, as built and as the drawing's 0.81 / 0.366. The
  side photo's shorter look (bumper tip 0.355 ahead of the tyre against the drawing's
  0.49) is that car standing about 10° off square, its front away (its front tyre 6 %
  smaller than its rear; 0.815 cos 10° − 0.75 sin 10° = 0.67 against the photo's 0.672
  from the tip to the hub). The arch itself was the photo's: a half ellipse 0.343 × 0.371
  read to the lip's lit edge, 2.6 cm clear of the tyre's sides and 5.4 cm over it. On the
  white car that gap is a thin shadow, the grey tyre (luminance ~33) standing out of the
  black well (~8); in the lab the tyre is as black as the well, so the whole dark ring
  reads as the hole the wheel sits in. → The front arch closed round the tyre: 0.33 wide at
  the hub's height and 0.349 high (`arch` 1.04, `frontArchRise` 1.10), 1.3 cm off its
  sides and 3.2 cm over it, within the refs' 0.03 of the photo. The overhang stays 0.815.
  *mercedes.ts `wheels`*.
- **«багажник выравнял откровенно плохо. что это за конструкция?»** → The first review's
  deck was two planes: up 4 cm from the back light's foot (1.015) to a station at the
  lid's front edge (4.08, 1.055), the wings' top edge raised 3.5 cm with it, then down to
  the tail: a ridge across the whole width 12 cm behind the glass and a hump in the wings'
  line, so the boot read as a box laid on the car. → One plane from the back light's foot
  (3.96, 1.035) to the crisp edge over the tail (4.68, 1.015), no station between; the
  wings' top edge straight under it (0.985 → 0.98), the crown across easing from 3 cm at
  the glass to 1.5 at the tail (3 cm there folded the tail's top at the lid's cut,
  kit-surface). The drawing's 4 cm rise at the lid's front edge is not drawn (D2's side
  view draws the deck level from the glass). *mercedes.ts stations*.

## Exhaust under the floor (2026-10-27)

- **«выхлоп у всех машин разный, это мы выхлоп везде одинаковый добавляем, а ведь его можно
  сделать и более плоским, более аккуратным, менее торчащим снизу. порог нужно делать по
  чертежу» (owner, on the W124 draft).** → The exhaust hung from the clearance, not from
  the car: the run at 35 mm (classic) or 22 mm (Samara) over it, the resonator from 6 mm
  over it up to the run plus 4 cm, the silencer 25 mm over it and 85 mm tall
  (`SILENCER_TUCK`), whatever the floor above. Where a sill is drawn low the cans stood
  up through the shell's floor, so the Vectra A (drawn 0.205 → 0.22 / 0.25), the W124
  (0.19 → 0.255), the GAZ-24 and 31029 (a level 0.262 over the drawn 0.24–0.26) had their
  sills raised over the drawing for kit-zfight; on a high body (the UAZs) the silencer
  hung a hand under the tail, which a per-car `exhaustTuck` patched. → One rule on every
  car, from the floor: the pipe (Ø36, its section on a corner, so no face lies along a
  floor) runs 10 mm under the shell's floor wherever it is (`EXHAUST_GAP`); the resonator
  (0.11 × 0.06) and the silencer (0.30 × 0.07, at the back of its room where the floor has
  risen) are flat ovals tucked the same way; the pipe dips under the rear axle and the
  Panhard rod (classic) or the beam (Samara) and climbs behind it; the tail pipe exits
  under the rear bumper's foot (exterior.ts `bumperFoot`). Nothing goes below 2 mm over
  the clearance (`exhaustLow`), so the diff, the axle or the tank stays the lowest point;
  where the floor is too low for the pipe or a can (the Nivas, the Oka, a sill at its
  drawing) they rise into it, as into a real tunnel, a can's top 12 mm over the floor
  under the carpet. The classic's run moved inboard (x −0.09) inside the floor's
  crossmembers. `exhaustTuck` is gone (the rule subsumes it, 10 mm instead of 30 mm under
  the UAZs' floors). 152 triangles per car as before (the UAZs 164 → 152). Every car's
  exhaust moved (owner's request); the owner accepted it, and every car's fingerprint was
  re-recorded with it before the W124's second review. kit-zfight: no exhaust
  cluster on any car; the Vectra at its drawn 0.205 sill (0.30 at the back light's foot)
  and the W124 at 0.19 pass too. *bay.ts `exhaust`, `pipeUnder`, `canUnder`, `tube`
  `ridge`; exterior.ts `bumperFoot`; spec.ts, uaz.ts*.

## Arches to the drawings (2026-10-27)

- **«насчёт арок - исправляем все машины подряд»** (and, on the way: «нужно именно форму
  выпила под колёсную арку в кузове менять, а не подкладывать палочки и дощечки») → Only
  14 of 50 arches stood within 0.03 of their drawings (STATUS.md "Arches against the
  drawings"). → Every arch was set as one circle, `arch` (and at most `rearArch` /
  `rearArchRise`) times the tyre radius, read off one point (the lip's or the liner's top)
  and never checked against the drawn opening's width, its height and where it sits on
  the hub. → Each car's cut in the skin set to its drawing with the existing fields: half
  ellipses (`frontArchRise`, `rearArchRise`), widths (`arch`, `rearArch`), arches off the
  hub (`archShift`: the Volgas' sweeping back, the eights', tens' and Opels' forward, the
  Oka's, 2141's and Niva's back), the 2206's flat-topped steep-sided arches (`archSquare`
  4); per-car wheels where a family's drawings differ (2112, 2115). The opening is the
  cut itself: no plate, liner or strip stands in it to fake a shape. Found on the way:
  where an arch is a half ellipse higher than its circle (the Niva's front, the W124's,
  the eights') the inner wings' and boot's shelves stood at the circle's top and showed
  as a painted chord across the top of the opening (the owner's 2121 screenshot) → they
  now clear the skin's opening (`BodyFrame.archTop`). Refs re-read: the Oka's on its
  drawn hub crosshair (the registration's stood 0.06 high), the 2110's rear from photo s1
  (the drawing's flat top is stylised), the 2206's rear from photo P1, the UAZ-469's front
  on the inner line's lower end; the 2101 and 2131 got arch refs (the 2101's drawing; the
  2121's arches). kit-drawing reads the reach at the edge's lower end where the skin
  stops over the hub. *specs.ts, estates.ts, samaras.ts, tens.ts, nivas.ts, oka.ts,
  volgas.ts, azlk.ts, uaz.ts, opel.ts `wheels`; body.ts `archTop`; bay.ts shelves;
  tools/kit-drawing.ts; refs*.

## Mercedes W124, the owner's third review (2026-10-27)

His words, with carsized.com's W124 photos (and a 190 he later said he mixed up): «я не
верю в твоё объяснение про передний свес ... передний свес на самом деле короткий, а у нас
нет. ... сравни, как сделаны ручки дверей. посмотри, какие из фар ребристые. посмотри на
линии остекления заднего окна. посмотри на формы кормы и передка»; then «у w124 сейчас
ручка передней двери посреди двери», «решетка у мерседеса не должна выступать за капот»,
«линия остекления заднего стекла явно не должна быть такой ... вокруг стекла металл
зажевало, переход в крышу с щелями». Measured by tracing the built car orthographically
onto `w124_side.png` registered on its hubs (measurements-w124.md §10).

- **The nose read long.** → The bumper and the overhangs are the factory's, but the face
  above the bumper stood 6 cm behind its front, near upright (the drawing's line), where
  the photo's nose rakes back from 0.09 behind the bumper's front at 0.60 to 0.18 at the
  lip: from the side the lamps and the bonnet's front reached 7–10 cm too far forward. →
  The face's foot at 0.12, `frontLean` 0.35, `bonnetFront` 0.12: now 0.096 / 0.129 / 0.21
  behind the bumper's front at 0.61 / 0.70 / 0.79 (photo 0.10 / 0.14 / 0.19). The whole
  photo reads 4.50 m long on its hubs, both overhangs 12 % short in the same ratio as the
  factory 815 / 1125: the image's wheels or its scale, not the car; the overhangs stay.
  *mercedes.ts stations, `frontLean`; refs `bonnet` from the photo*.
- **Door handles.** → A short 13 cm bar at s 2.12 (the door's middle) and 3.35. On the car:
  a 22 cm chrome bar at each door's rear edge under the belt, the pull lever's bright lip
  under it over a black recess. → `handles.grip` (new): bar, recess and lip; front 2.40,
  rear 3.345. *spec.ts, exterior.ts `buildDoorHardware`*.
- **Fluted lamps.** → The head lamps are smooth glass; only the tail lamps are fluted.
  The head lamp's `ribs` removed; the tail lamps' bands re-split to the photo (44 / 56 %).
- **Back light.** → A first try curved the back light's top in plan to show glass behind
  the C pillar from the side: it jutted at the corners and chewed the roof's end (his
  screenshot); removed. The roof ends square over the glass again, its corners cut in one
  chamfer (`cornerDrop` 0.035) for the photo's rounded corners, the frame round the glass
  thinner (`rearHeader` 0.025, `rearBottom` 0.02); the quarter glass's rear edge 3.50 (the
  photo's 3.45, the drawing's 3.53) and the bar before it bright (column `finish:
  'chrome'`, new). *body.ts; mercedes.ts columns*.
- **Front and tail.** → The grille shell 0.68 wide (photo ±0.365 with its frame), its top
  1 cm under the bonnet's lip (a top bar standing over the lip was tried and removed:
  «не должна выступать за капот»); the bumpers' aprons drawn back under their black band
  (moulded `foot`, new); the boot lid's sides on the tail follow the lamps' leaning inner
  edges, ±0.572 at their top to ±0.46 at the foot (`notchWall`, new), the lamps inside
  them. *spec.ts, body.ts `notchWall`, exterior.ts `buildBumpers`; mercedes.ts*.

Every other car `identical` (kit-fingerprint); w124 re-recorded, 12 363 → 12 194 triangles.

## Mercedes W124, the tail in plan (2026-10-27)

- **«вряд ли корма мерседеса должна иметь такие углы - смотри вид сверху»** (his lab shot
  from above: the tail a box, square corners, the wings standing as strips beside the
  lid). → The stations held the full ±0.85–0.87 to the back light's foot (s 3.96) and
  still ±0.80–0.82 at the tail (4.68), turning in only over the last 2 cm: the drawing's
  plan narrows all the way, ±0.868 at 3.93 to ±0.752 at 4.68 and ±0.717 at the face. → The
  tail station ±0.74 / 0.755 / 0.72 (sill / crease / belt), the face ±0.70 / 0.715 / 0.68:
  one straight taper from the back light's foot, within 1.5 cm of the plan at every
  station, no station between; the amber indicator's split moved in to ±0.64 to stay on
  the narrower face. New check `planHalfWidth` (kit-drawing.ts, any car: [s, half width]
  pairs read off a plan view, judged only where refs give it); refs/w124.json has six.
  Every other car `identical`; w124 re-recorded, 12 209 triangles.
  *mercedes.ts stations 4.68 / 4.7, `cornerLamps`; tools/kit-drawing.ts*.

## Mercedes W124, the whole tail (2026-10-28)

His words, on a straight rear lab view beside a real car: «какой-то слишком угловатый
очень тяжелый зад. давай всю корму внимательно сверим по чертежам или фото»; then «очень
много места для задних пассажиров... не настолько же». Measured on the drawings' side and
rear views, carsized's near-orthographic rear and his photo (measurements-w124.md §12).

- **Heavy: a tall slab of body colour under the lamps, a deep bumper.** → The lamps and
  the bumper's top were the drawing's, but the chrome line sat on the black band at 0.47,
  9 cm under the bumper's top, so the tone above it read as body: 0.185 of body colour
  under the lamps (as tall as they are) where the car has 0.09; and 8.5 cm of tone showed
  under the band. → Chrome 0.54–0.55 (2–3 cm under the top, as the photos), the black band
  0.35–0.54 (as tall as the lamps, his photo), the foot raised to 0.29 under a face to 0.34.
- **Angular: square ears over the lamps, the lid a box.** → The wing's top stood level at
  0.98 to 2 cm from the tail, its edge on a flat 7 × 2 cm shelf, then dropped 12 cm upright;
  the deck ended level over an upright face. → The wing's top rounds over into the lid from
  the back light's foot: a new optional station field `shoulder` (the turn from the belt up
  to the deck's edge per station; absent, the car's, so no other car moves) with the belt
  0.93 → 0.90 and the turn 6–8 cm high behind the back light, the deck's edge kept where
  the C pillar stands; the lid's rear edge chamfered (0.99 at s 4.68) to an upright face
  from 0.92 (drawn 0.922); a dark lip line across the lid at the lamps' top (`rear.lid`).
  The side's lean held near 6° at every station (9.5° at 3.96 between 5.8° and 3.2° was a
  kit-surface `lean` dent).
- **The rear bench too far back.** → The classic's place (rearBase − 0.45) put its hip at
  s 3.51, over the rear axle; the drawing's interior dimensions put it at 3.18. →
  `CABIN_W124.bench` rearBase − 0.78 (cabin-places passes). The E34's cabin spreads it;
  its own bench is set by its review.
  *mercedes.ts stations 3.96–4.7, `rear`; spec.ts / body.ts `TubStation.shoulder`;
  interior.ts `CABIN_W124`*.

## Tens: the firewall lining in the front doors' edges (2026-10-27)

- **kit-zfight failed on the 2110 and 2112**: `kit_cabin/cabin_trim` (interior.ts
  `floor()`, the firewall lining under the dash) against `door_fl/door_fl_paint` (body.ts,
  the front door's painted front edge), s 1.33, y 0.74, 73 cm², 1.2–2.0 mm apart, seen
  beyond 25 m. → The lining stands at the firewall (cowl + 0.02, s 1.33) with upright
  outer edges at the toe board's width, 85 mm inside the side there (x 0.7245 at y 0.49).
  The tens' front door's front edge stands 1.5 mm ahead of it (its column at 1.325) and
  the side falls in to 0.788 at y 0.74 and 0.73 at the scuttle, so the door's inner skin
  came to x 0.710 at 0.74: the lining's last 15 mm lay in the door's front edge face. (On
  the 2111 the door's front reaches 1.273, across the firewall: the edge stood 11 mm through
  its card, hidden.) On the other cars kit-zfight finds no such pair (the 2109's door
  front stands 10 mm ahead of the lining, which is 15 mm inside its card). →
  `Layout.firewallLean` (new, `CABIN_2110`): the lining's
  outer edges lean in from the toe board's top to the scuttle, 85 mm inside the side at
  both ends (x 0.645 at 0.94); at 0.74 it now stands 30 mm inside the door's inner skin.
  Absent, the edges stay upright, so no other car changes. *interior.ts `floor()`,
  `CABIN_2110`*.

Every other car `identical` (kit-fingerprint); vaz2110, vaz2111, vaz2112 re-recorded (cabin),
triangle counts unchanged.

## AZLK-2141, the nose in plan (2026-10-27)

- **«что-то подсказывает мне, что перед москвича не должен так сужаться»** (his lab shot
  from above: the nose tapering from the screen to a narrow front). → The stations
  followed the drawing's plan view, which tapers all the way (±0.66 at the face, ±0.71 at
  0.22, ±0.74 at 0.336, ±0.79 at 0.55, full ±0.845 only at the hub). That plan contradicts
  the drawing's own front view, where the wraparound indicator's outer edge stands ±0.744
  face-on with only a sliver of wing outboard of it, and the photos: the real car's wings
  run nearly straight to the face, the corners lightly rounded. → Face ±0.745 (crease),
  ±0.80 at 0.22, ±0.825 at 0.336, ±0.84 at 0.55, then the flank; refs/azlk2141.json gets
  five `planHalfWidth` stations (0.15–0.91), built 0.775 / 0.815 / 0.834 / 0.84 / 0.842.
  Every other car `identical`; azlk2141 re-recorded, 12 580 triangles. *azlk.ts stations
  0.107–0.55*.

## GAZ-24, nose and tail in profile (2026-10-27)

- **"The nose's and tail's ends are triangular, two bends at once" (owner, with the drom.ru
  side photo).** → Both ends were one upright face (the stations 0.067 and 4.637), while on
  the car the wings' tips at the crease are the foremost and rearmost points, the face
  below running in to the bumper and the lip above rounding in. → `EndLean.peak` (spec.ts):
  above `peak.y` the lean's offset goes on from the value reached there at `peak.lean`; a
  negative `lean` leans out. `BODY_GAZ24` `frontLean` { base 0.56, lean −0.19, peak 0.78 /
  0.45 } and `rearLean` { base 0.55, lean −0.14, full 4.637 (new on the tail: where it is
  in full; default the rear base), peak 0.77 / 0.65 } (measurements-volga.md §5). Every
  mesh is cut at the peak (kit.ts `splitAtBase`) and the end faces in body.ts too, so no
  chord or slit opens at the bend; the rear ribbed band's ribs 15 mm proud (the lean
  brought their backs to 5 mm off the face, kit-zfight). Every other car identical
  (kit-fingerprint). *spec.ts `EndLean`, kit.ts `leanEnd`, body.ts end faces, volgas.ts*.

## VAZ-1111 Oka, bumpers to the arches and the arches' shape (2026-10-27)

- **«пластиковые бамперы там доходят прямо до арок, а у нас нет. и в реале арки
  поаккуратнее и задняя арка не такая круглая, как у нас»** (with his side photo). → The
  bumpers' sides stopped upright at `wrapTo` 0.2 / 3.07, the arches' edges at the
  bumpers' heights 0.25–0.36 / 2.94–3.02: a 0.05–0.16 m strip of wing between them, while on
  the car the bumper's end is the arch's edge, slanting with it. The front arch stood to
  the drawing's liner (top 0.36), the rear as a circle of 0.293. → `wrapTo: 'arch'`
  (spec.ts, exterior.ts `flankBumperPath`, `archEdgeS`): the sides' ends on the arch's edge
  at every height (`BodyFrame.archY`), flank points beyond the edge's nearest stopping on
  it low down (a sweep point's `at`), the shell's hole under the side kept off them. The
  arches measured on the owner's photo with its 3.5 cm higher ride taken off
  (measurements-oka.md §1.3): front a half ellipse 0.311 wide, top 0.335 (`arch` 1.245,
  `frontArchRise` 1.34); rear 0.31 ahead, 0.29 behind, top 0.305 and flat, a superellipse of
  power 2.7 (`rearArch` 1.2, `rearArchRise` 1.22, `archShift` rear −0.01, new
  `rearArchSquare`: the rear's power where it differs from `archSquare`). Built front 0.336 /
  0.298 / 0.324, rear 0.306 / 0.31 / 0.29; refs/vaz1111.json from the photo. Every other car
  identical (kit-fingerprint); vaz1111 re-recorded, 10 765 triangles. *spec.ts, body.ts
  `archY`, exterior.ts, oka.ts*.

## VAZ classics, nose and tail in profile (2026-10-27)

- **"The classics' noses and tails stand upright; on the real cars they lean" (owner, on
  the 2106 drawing: the face forward ~6 cm over the 0.3 m above the bumper, the tail out
  ~3 cm at the top).** → Every 124 and 05 end was one upright face at its station. Measured
  on every classic's drawing and a side photo (measurements-classics.md "Nose and tail in
  profile"): the 124 faces lean forward from the bumper's top, each its own (2101 −0.16,
  2103 −0.26 to the lip, 2106 −0.25 to −0.30), the 124 tail leans out −0.14 to −0.17; the
  05 ends (2105, 2107, the 2104's nose) stand upright above a short chin and are kept. →
  `BODY_124.rearLean` { base 0.52, lean −0.16, blend 0.1 } (2101, 2103, 2106); `frontLean`
  per car in `KIT_SPECS`: `NOSE_2101` (2101 and 2102) { base 0.48, lean −0.16 },
  `NOSE_2103` { base 0.516, lean −0.26 }, `NOSE_2106` { base 0.49, lean −0.25 }, each with
  `full` 0.067 behind its face (the lamps, grille, indicators and the lamps' rings rooted
  in the face lean whole; with the default `full`, the bonnet's front edge 2.2 cm behind the
  face, the items' roots reached into the blend and the 2103 opened a shell slit at its
  lamps, kit-zfight) and blend 0.12. Bases
  over the fangs' tops, so the bumpers stay upright. The 2101's grille bars proud 0.028 →
  0.031: their 4 mm step to the dark back, tilted with the face, fought far off. Built at
  the deck row: 2106 nose 0.148 → 0.081, tail 4.075 → 4.113; 2103 nose 0.128 → 0.066; 2101
  0.103 → 0.060. Every other kit car identical (kit-fingerprint; the W124 moved by the
  uncommitted mercedes.ts work, not this). *specs.ts `BODY_124`, `NOSE_*`, `KIT_SPECS`*.

## BMW E34, first review: glazing line, rear bench, lid lamps (2026-10-27)

His lab shots of the side and the tail (`build/carshape/_refs/photos/e34/owner_kit_*.png`);
re-measured on the vector drawing and on the Commons side photo registered on its hubs
(measurements-e34.md §8; `build/kitcheck/e34/side-compare.png`: our side ortho at the
photo's scale, hubs on its hubs).

- **«ох уж эта линия остекления. явно не так должно быть».** → The side glass's foot had
  been read at the drawing's y 165 (0.98), over the real line; the belt climbed from the
  wing (0.90 at the cowl) to 0.975 at s 1.5 behind the A pillar's foot, a kink up, and the
  pillar's foot stood at the screen's centre-line foot (1.33). The real DLO is low and
  straight: the glass's foot 0.90 at the pillar to 0.96 at the quarter's hook [D, S]. → The
  belt one straight line 0.868 at the A pillar's foot (1.53) to 0.927 at the rear door's
  edge and 0.955 at the back light's foot; the wing's top rising straight into it; the A
  pillar from 1.53 to the rail at 2.0, thin, the black frame and the glass (from 1.575)
  right behind it, the screen curved in plan so its centre-line foot and top stay at the
  drawn 1.33 / 1.95 (`screenFoot` 0.2, `screenTop` 0.05); the B pillar leaning as on the
  photo (tops 2.585–2.675); the Hofmeister kink as the quarter glass's top chamfered inside
  the door's frame in two straight runs (`glassDrop` 0.105 at 3.44, 0.17 at 3.506) with its
  foot hooked forward (`glassRise` 0.045), the door's frame 1.3 cm behind it (the glass on
  the shut line itself put the jamb seal in the lining's plane, kit-zfight); the mirror's
  head held at its measured height (`mirrorHeightOffset` 0.04, the belt under it 10 cm
  lower); the shoulder line rising to the tail lamps' top at the tail. The side's lean
  kept rising evenly nose to tail (a dip at the rear door was a kit-surface `lean` dent).
  refs/e34.json re-read: `beltY` 0.98 → 0.916, `doorFront`, `doorRear`, `sideGlassBelt`
  (no `accepted` any more). *bmw.ts `BODY_E34` stations, `cabin.columns`, `LOOK_E34`
  mirror; refs/e34.json*.
- **«сзади места как в лимузине, задние сиденья невероятно глубоко расположены».** →
  `CABIN_E34` spread `CABIN_W124`, whose bench was the classic's rearBase − 0.45: the
  E34's rearBase 4.05 put the rear hip at 3.60, over the rear axle. → The raster drawing
  with its doors off (`e34_tbp_76.gif`) puts the driver's hip at 2.40 and the rear hip at
  3.25, just ahead of the rear arch: `CABIN_E34` `hip` 0.87 from the new cowl (2.40) and
  its own `bench` rearBase − 0.81 (3.24), no longer the W124's; the dash, wheel, pedals,
  lever and console moved with the cowl (1.33 → 1.53) to stay where they stood, the dash
  0.17 deep. cabin-places passes. *interior.ts `CABIN_E34`*.
- **«выпуклые фары на крышке багажника мы уже чинили у espero - должны быть такие же, как
  и остальные задние фонари, не выпуклой панелью».** → The lid's lamps were bevelled
  `lens` boxes 1.5 cm out of the lid beside flush wing units; the wing's amber band lay on
  the shoulder's turn (crease 0.78 under it), so it bent up at the corner; the lid's
  lamps stopped at ±0.36 where the photo's band runs to the plate. → As the Espero's lid
  band: flat cells 4 mm out (`slant` 0, no bevel) on a black housing 2 mm out showing as
  the seams, the row seam where the wing units' rib is (`ribs: 1`); from the plate out: a
  tall red reflector ±0.17–0.264, a two-row panel to ±0.354, the lamp to ±0.589 with the
  reversing cell ±0.411–0.529 in its upper row [P R]; the wing units 6 mm outside the lid's
  cut so one band runs across; the tail stations' crease at the lamps' top (0.845), the
  amber on the upright face. *bmw.ts `LOOK_E34.rear.lid`, `cornerLamps`, stations
  4.05–4.665*.

Checks: `npm run kit-check -- e34` passes (zfight, proportions, reality, mirrors L90 % R88 %,
0 dents, 13 979 triangles, drawing 21/21, dash 9/9); every other car identical in
kit-fingerprint (the W124 moved by its own tail work, not this).

## BMW E34, the roof's rear corners (2026-10-28)

- **«сзади над задним стеклом артефакты крыши»** (`owner_kit_roofrear.png`, from behind
  and above: yellow-grey slivers and torn triangles at both corners of the roof over the
  back light). → The rear door's frame met the rail at 3.443 (glass column 3.506) and
  3.447 (the door's rear edge 3.519), but the back light's column (top 3.45) puts the
  roof's edge over the glass `railInset` ahead of its top, at 3.41. The roof's rows and
  the rail's chamfer ran 3.40 → 3.443 → 3.447 → back to 3.41: the last strip folded over
  the one before (faces facing forward, up to 75° off the roof), the step `cornerDrop`
  0.03 on the same 4 mm made it worse, and the headliner 2.8 cm under it showed through
  the fold. → The door's frame meets the rail at 3.405 / 3.41 (the glass column at the
  belt 3.506 → 3.51 so the quarter's rear edge at the belt stays at 3.484 for
  `sideGlassBelt`), so every row runs rearward; `cornerDrop` dropped (README: no step
  corner on a `roofDrop` roof). *bmw.ts `BODY_E34.cabin.columns`*.

Checks: `npm run kit-check -- e34` passes (zfight, proportions, reality, mirrors L90 % R88 %,
0 dents, 13 952 triangles, drawing 21/21, dash 9/9). A spec change in bmw.ts alone.

## Every car its own interior trim (2026-10-28)

- **«почему у нас mercedes синий салон, а 2101 — красный? почему бы не сделать несколько
  вариантов цветов (не ярких, приглушённых) и снабжать автомобили рандомными салонами».**
  → A model's cabin was one colour pair (`KitLook.upholstery`, `dash`) baked into its
  shared template: every W124 blue, every 2101 red. → Each car picks a trim from its
  appearance key, as its paint: the model's own or one of a muted palette (grey, sand,
  blue, brown, black, burgundy, olive) its model allows; the upholstery family (seats,
  bench, inserts, door cards, armrests, side trim) and the dash family (dash, console,
  shelf, cappings, knobs) are marked per vertex (lamp byte 9 / 10) and tinted in the
  car's own material by a uniform. VAZ, GAZ, AZLK, UAZ, Opel and Daewoo keep their own
  dash; the W124 and E34 take the trim's. No geometry, vertex colour, draw or program
  added: every fingerprint unchanged. *trims.ts, builder.ts `TrimFamily`/`InkLog`,
  materials.ts `finishKitSurfaces`, render/materials.ts `setCarKitTrim`, render/carmodel.ts
  `applyKitTrim`*.

Checks: tsc (this change; other agents' vehicle.ts edits in progress fail on their own);
kit-fingerprint every car identical but the W124, which moves at HEAD already (its own
tail work); a script building every car checked the roles (only trim, only the family's
colours) and two vaz2101 material copies in different trims (same program key and
source, only `uKitTrim` differs).

## Mercedes W124, the back light's top and the tail's corners (2026-10-28)

His lab shot from behind and above (`build/carshape/_refs/photos/w124/owner_kit_backlight.png`).

- **«заднее стекло по всем фото выглядит довольно ровной трапецией, значит, надо поправить
  этот выгиб/арку крыши стекла сверху».** → The glass's top ran `rearHeader` under the
  roof's edge all across, so it followed the crown (power 4) and the corner chamfer
  (`cornerDrop` 0.035): level to ±0.31, then down 7 cm to its corner. → `CabinSpec.rearTopLevel`
  (new; absent on every other car): every top corner of the glass at the outer one's
  height, the header deepening to 6.9 cm on the centre line, where the drawing has the
  glass's top under the roof's lip (1.255; now 1.263, was 1.297); `cornerDrop` dropped.
  The roof and its profile unchanged. *spec.ts `CabinSpec.rearTopLevel`, body.ts `end`;
  mercedes.ts columns, cabin*.
- **«задние углы кормы, чуть выше задних поворотников — левый и правый выполнены
  по-разному. правая часть нравится, а левая какая-то другая и странная, как будто
  укушенная».** → Not the fuel flap (right, ahead of the arch). The tail stations' own
  steeper shoulders twist the shoulder's faces (belt to the deck's edge) at 4.0–4.70; each
  was one face fanned by the builder, whose winding is mirrored between the sides, so the
  left was cut on the diagonal that folds it in (a lit wedge over the lamp), the right on
  the one that folds it out. → `shoulder.convex` (new; absent on every other car): a
  twisted shoulder quad is cut on its outward diagonal on both sides, as the deck's are
  (`DECK_TWIST`). *spec.ts `KitCarSpec.shoulder`, body.ts shoulder; mercedes.ts*.

Checks: `npm run kit-check -- w124`: zfight, proportions, reality, mirrors L100 % R100 %,
0 dents, 12 530 triangles, drawing 21/21, dash 9/9; frozen ✗ as at HEAD before it (the
record predates the tail work; not re-recorded, awaiting the owner). Every other car
identical in kit-fingerprint; tsc clean.

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
- **Generated wheel styles as painted lathes** (the first five): removed at the owner's
  request. Generated sets came back on 2026-10-26 at the owner's request as cut-window
  rims drawn from photos (Generator); a design that only paints its holes on is still out.
- **Following a drawing's bonnet roll-off literally on BODY_05**: read as a bent nose.
- **Sampling a lamp lens every 20 mm along a flank** to keep it on a curving side: under a
  lean each cell bends its own way and the lens reads as a mosaic; bend only at the skin's
  own columns and rows.
- **A flank bumper's corner chamfer starting `r · 0.4` back along the flank**: the body's
  corner, 1 cm behind the end face, pokes through it; start it level with the end face.
- **The back light's top curved back in plan** (the W124, to show glass behind the C
  pillar from the side, as `screenTop` does at the front): its top corners jutted and
  the roof's end was chewed round the glass with slits at the join. Chamfer the corners
  instead (`cornerDrop`).
- **A grille frame's top bar standing over the bonnet's lip** (the W124's shell, to match
  the photo's tall chrome top): a box with a sloped lid on the nose. The shell stays under
  the lip.

## Template for new entries

```md
- **<Owner's complaint, in his terms>.** → <cause>. → <fix, with the numbers that matter>.
  *<files / symbols>* (<commit>).
```
