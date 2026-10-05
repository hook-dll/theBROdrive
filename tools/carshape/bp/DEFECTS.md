# Blueprint bodies: direction and what the generator still gets wrong

## Direction (2026-10-02)

The cars stay realistic: shells from the factory drawings (hull.py), dressed from the
drawings and photographs (assemble.py). Three other ways were tried and dropped:

- a loft traced through the drawing's lines (loft.py, niva_l, mx5_l): cleaner tails,
  but every joint (screen pillar, door glass, mirror) needed fixing by hand;
- stylised low-poly "toy" cars after real ones (tools/carshape/toy);
- flat-faced cars built the way the vendored soviet pack's are (tools/carshape/kit:
  Niva, 2101, 2108, compared side by side with vz21/vz01/vz08).

The last two came out simpler, duller and less fun than the realistic bodies, which
have character. All three are out of the tree; git history keeps them (876dbc6 to
10655ed). Work now goes into polishing the realistic generator.

## How the work is done

Each item is fixed once, in hull.py / assemble.py, never car by car, and checked on
the canaries (mx5, uaz469, kafer, citroen2cv, golf1, niva) in the preview's views,
including the low ones (lowfront, lowrear) and the zebra. All cars are rebuilt once,
when the list passes; then the automatic checks (shelf.py, roofleak.py), one
in-game contact sheet, install.sh, commit.

## The list

1. **Underside on every car.** [done 824adb5, reworked dafb636] No boxes: the floor
   closes at the sills and below it hang only round, real parts: a live rear axle's
   tube and the diff's pumpkin (its bottom the clearance), a 4x4's front diff, the
   propshaft, the exhaust and its silencer (the lowest point of a car without a live
   axle), a frame's slim rails.
2. **Waves.** [done dafb636] What the user saw as dents and bulges round the arches
   and diagonal wedges up the wings was two things. (a) The wells were cut into the
   distance field before it was smoothed, so the blur spread the sharp cut into a
   ring; they are now cut after, rounded only by `archEdge` (2 cm). (b) Blender's
   projected normal transfer from the dense shell to the working one gave corners on
   the side the normal of the arch's wall; the side's long fan triangles spread it
   into wedges. Now each vertex takes the dense shell's smooth normal (the distance
   field's gradient, written into hull.ply by hull.py) found along its own normal, and
   a corner on a crease takes its own face's side, sampled a little way into the face.
   Checked by rendering the dense shell, the working shell and the final body alone
   from the same view: final now matches dense.
3. **Compression artefacts (accordion).** [done 362a66c] Folds across the body at the
   points of the car files' lines: sill, belt, glass plan, crown, plan and top
   overrides and the sections between stations were joined by straight pieces; they
   now run on monotone cubics through the same points. Found with a curvature map of
   the side (d2x/dy2 by ray, vertical bands = folds).
4. **Glazing.** [done 342cd68] Every pane carries its own seal, an even band inside
   its edge, in the car's frame material (chrome or rubber, learnt from the frame
   lines the car file drew, which are no longer drawn); pane edges evened out and laid
   back on the surface; panes running onto surfaces turning away cut along the facing
   limit. Mirrors (3f01c20): on the wing on a thin stalk, or on the door's skin on a
   slim sail and a slanted arm.
5. **Pillow bodies.** Crisp edges the drawings have (deck to tail panel, shoulder,
   bonnet edge) blur away; tails and noses swell (2CV tail, MX-5 tail). Open.
6. Soft tops / canvas. [done 3f01c20] MX-5's hood rail black, 2CV's canvas stops at
   the back light's foot.
7. Lamps on rounded ends. [done] End lamps may turn the corner a little (facing
   limit 0.1) and are cut cleanly along the limit, not torn into pieces.

8. **Sides bending along the car.** [done e9e9638] One section for the whole car (the
   two end views' mean) instead of a blend from front view to rear view; mirrors, pods
   and handles opened out of the end views and the plan. Bend score (spread of the
   side's lean between the arches) Niva 4.0 -> 0.1 deg, Golf 2.8 -> 0.1.
9. **Rear quarters crumpled.** [done e7586da] The glasshouse stands an even 3 cm shelf
   in from the side at the belt; a shelf widening as the glass plan narrowed was a
   diagonal fold (Fulvia, Fiat 124, Renault 4).
10. **Toothed arch lips.** [done e7586da] Smooth minimum of side and well.
11. **End lamps lost or smeared on sloping noses.** [done e7586da] End decals lie on
   what the end view sees (by ray), down to grazing.
12. **Wipers floating.** [done e7586da] Slim blades on the glass just above its foot.
13. **Bumpers.** [done 690a57d, c0eb1a9] Run round the convex hull of the end; each car's
   own height, profile, material and overriders checked against photos
   (build/carshape/_refs/photos/<car>).

Open, car by car: Mustang GT's nose (fascia, fog lamps, cladding); 2CV's tail.

Done before: no number plates or blank plate patches (824adb5); arch flares built on
the skin.

## Tried and dropped

- Waves: normals from the distance field's gradient instead of the triangles' (no
  visible change: the triangles were not the noise).
- Waves: MeshLab's two-step smoothing on the dense hull (normals averaged under 35°,
  vertices fitted) breaks the surface into facets; worse than none. Taubin smoothing
  was dropped earlier (spikes on the Valiant's screen).

## Why the bodies are soft and wavy (2, 3, 5), found on the MX-5 tail

The shell is the intersection of 1-D profiles (side outline per height, plan
half-width per station, end-view section per height) and every one of them is
smoothed to drop the drawing's line noise (median + gaussian on the sections, a 4 cm
blur on the nose/tail faces, the plan, then a 3-D blur of the distance field). The
smoothing cannot tell a crease from a shut line, so creases go with the noise.
Turning the smoothing down sharpens edges a little but adds waves. The plan is left
raw within 18 cm of each end (smooth_inner's margin), so a kink in the top view's
tail curve becomes a vertical groove down the tail panel; and a tail or nose has one
section for all its stations, so a bumper crease and a tucked-under valance cannot
exist.

## 2026-10-03: checked against the real car, not the previous build

Passing a build because it was "not worse than before" let the old faults through
(Eagle's screen into a domed roof, mirrors hanging on stalks, GAZ-21's screen corner).
Every car is now judged against its photos and its factory figures:

During the clay-style evaluation, compare the SAME body with ordinary paint and
the selected Clay preset before removing small smooth waves: they may suit the
hand-modelled style. This does not excuse sharp accidental folds, holes, detached
parts, malformed glass, wrong lamps or incorrect factory dimensions/proportions.
Material relief changes the highlight, not the geometry. Preserve character only
where it does not break the car's recognisable shape and correctly fitted details.

- `build/carshape/refsheet.sh <tag> <car>...` – the photos in `_refs/photos/<car>` beside
  game-renderer shots from the same angles (front/rear three-quarters both sides, side,
  screen close-up): `$S/ref-<tag>-<car>.jpg`.
- `build/carshape/dims.py <car>...` – the built body against the car file's factory
  figures (length, width, height, wheelbase, tracks, wheel radius). The game stretches
  the body per axis to the factory size and sets the wheels by the factory wheelbase and
  overhang, so a body built short is stretched lengthways: arches drift off the wheels,
  round lamps go oval. Off by more than 2 % is a defect to fix in the build.
- `build/carshape/symm.py <car>...` – each part against its mirror image (shells and
  glass are symmetric to 1 cm; one-sided parts are one mirror, blinkers).

### The per-car checklist (the user's, 2026-10-03)

A car is shipped only when every line holds against the real car of the roster's
model **and year** (Giulia Super 1965, Golf I 1978-83 with plastic bumpers, Mustang GT
1987-93...):

1. **References are the right car.** Photos found by model plus year or generation
   ("1982 Volkswagen Golf", "Golf I", never just "Golf"): four times a folder held the
   wrong generation or a modern namesake (Giulia 2016, Golf VI/VIII, Civic, CR-X II).
   The drawing is a true orthographic one: an artist's cutaway (Giulia's Autocar sketch)
   or a racing variant gives the wrong body. the-blueprints.com previews
   (`/vectordrawings/show/<id>/<slug>/`, image `modules/vectordrawings/preview-wm/...`)
   and getoutlines.com (`_refs/web/go.sh`) have four-view drawings; 3dcar.ru is
   unreachable from here.
2. **Specs.** Factory length, width, height, wheelbase, tracks, tyre size and wheel
   radius, clearance, mass, engine and gearbox in `roster.ts` for that model and year
   (`dims.py`, `syncroster.py`).
3. **Body.** The side silhouette, the plan and the end sections (tumblehome, shoulder,
   roof width) from the drawing; every swelling, crease, slope and rounding where the
   photos have it: bonnet, boot, roof (its peak, its gutters), the noses' and tails'
   faces.
4. **Glazing.** Pillars where and as thick as the car's, window heads and feet at the
   drawing's heights, vent panes, screens without ragged edges (`GLASS-RAGGED` in the
   log is a defect).
5. **Wheels.** Size against the factory tyre, sitting centred in arches of the right
   size and shape (skirts where the car has them).
6. **Ends.** Bumpers of the car's own height, depth, profile, overriders and fit to the
   body (`BUMPER ... stand` in the log); lamps at the drawing's positions and sizes in
   their own bezels (no invented black panels); grille shape and size; turn and reverse
   lamps where the car has them.
7. **Small parts.** Mirrors where the car has them and close to the skin (no stalks in
   the air), handles, wipers, trim lines.

Seen in the game renderer, all of it: `refsheet.sh` (whole car beside the photos) and
`labshots.sh <tag> <car>` (close-ups: A-pillar, door, rear quarter, nose, tail, roof).
Faults the whole-car sheet hid and the close-ups or the user showed: Giulia's ragged
front pane and mirror on an arm, the DS's black lamp patch on the wing's top and its
mirror on a stalk.

What was found, and what fixed it (generator, all cars):

14. **Glass curling over into the roof.** Side windows took every face whose normal was
    within ~81 deg of the side (facing 0.15), well round the roof's edge: the "capsule"
    glasshouse. Now a side window keeps its drawn straight edges but its header comes
    down, measured by ray at stations along the header only (not the slanted ends,
    not a pillar's turn towards the screen), to 1 cm under where the side turns past
    `sideFit` 0.6 across the car (`fit_pane`, `clip_below`). Screens and back lights are
    fitted against `endFit` 0.55 (they had 0.15-0.3) so they lie on the end, not round
    its corners. Tried and dropped: a limit relative to the pane's own mean normal
    (cut the side windows into strips: the glasshouse side is curved top and bottom).
15. **Domed roofs, rounded glasshouse shoulders.** The end-view section is smoothed
    as width against height with a 5 cm gaussian, kept raw only 1 cm from its ends,
    and that end was taken where an earlier blur's tail faded out, above the drawn roof:
    the roof's corner was spread over +-10 cm. `smooth_inner` now takes the ends where
    the width falls to half, and `sectionMargin` defaults to 12 cm. (Eagle: side upright
    to 1.39 m instead of 1.27, window headers 1.33 -> 1.36.) `roofCrown` was not it.
16. **Wagon and hatch tails cut back under the belt.** Where the cabin ends, the body's
    top blends to the next station's top over `beltBlend`; with the cabin running to the
    tail, the next station is beyond the car, so the tail was cut in a wedge (Eagle
    10 cm short at the belt, the glasshouse overhanging it like a spoiler). Only blends
    to a deck within 0.3 m below the belt now.
17. **Mirrors.** On the door unless set ahead of the front side window by over 12 cm
    (was: on the wing whenever the side ray at the mirror's height hit glass inboard);
    a wing mirror's head stands over its stalk, at most 4 cm out (it hung at `reach`).
18. **Arch flare scraps.** The band's innermost ring lies on the arch's rounded edge
    (under the lip) and is left out of the "skin jumps" test; a band shorter than a
    quarter of its arc is not built (Eagle's black teeth over the arches).

Car-file fixes that came from the photos (not the drawing):

- Eagle: the drawing is a four-door with a sloping hatch, the car a wagon: tail,
  cabin to the tail, quarter windows and back light from the photo; end sections given
  as outlines (the drawing's glasshouse has a tumblehome the car does not); a dark panel
  behind the lamps and grille; bumpers 9 cm deep, wrap 30 cm.

Open: Moskvich-412's body is built 3.56 m long for 4.25 (its drawing's scale), so its
nose decals find no faces; GAZ-21 and Eagle 4 % short.

More, found car by car (AE86, BJ40):

19. **Ends and roofs short of the drawing, then stretched by the game.** The blur eats
    4-8 cm off a convex end and ~5 cm off a roof. After marching cubes each overhang
    past its arch is stretched out to its end (hull.py, `ENDS` in the log): to the
    factory end (+-L/2) where no bar part stands there, so the front axle sits at the
    factory overhang from the nose; to the drawn body end where a bar does (the bar is
    then placed with its face at +-L/2: `BUMPER ... target`). The glasshouse above the
    belt is stretched up to the drawn top likewise.
20. **Factory overhangs.** `OVERHANG` in the log compares the drawing's with the car
    file's (`OVERHANG_ONLY=1 python hull.py <car>` prints it alone). Where none is
    published and the drawing's add up to length less wheelbase, the drawing's is
    taken: `_frame.set_overhang(CAR, fo)` moves everything the file places along the
    car with the axle; `build/carshape/syncroster.py` (run by ship.sh) copies the
    factory figures into the roster. Spare wheels on the tail count in the factory
    length (Jeep, UAZ, SJ410, BJ40): the bar goes to the drawn end there.
21. **A drawn bumper bridged out with no bar to replace it** cut the ends short (AE86):
    the band is bridged only where `parts.bumpers` has that end. Where the band is
    bridged and nothing of the body is below it (a frame car), the face behind the bar
    is given with `hull.face` (BJ40).
22. **Bars standing well clear** (on a frame's horns): stood off along the envelope's
    normal, not along rays from a centre (the middle bowed out and the wrap filter kept
    two stubs); the wrap measured from the bar's own face; a bar exactly symmetric;
    `span` for a straight bar across the frame; stand-off up to 0.7 m on a frame; the
    frame rails run out to the bars.
23. **Mirrors joined into the trim** were measured as the body's side by the game (it
    leaves out only the `mirrors` node, and a two-material node comes in as meshes
    `mirrors`, `mirrors_1`): mirrors stay their own node; carmodel.ts leaves out any
    mesh named `mirrors*` or under such a node.
24. **Heights.** `_frame.scale_above(CAR, belt, top_from, top_to)` for a drawing lower
    than the car (BJ40's FJ40 drawing 1.80 m, the hardtop 1.93): outlines, panes,
    decals, lines, regions, station sections above the belt. The side view's crop
    must leave room above the roof (`side.box`): an outline in metres is drawn into the
    cropped drawing and was clipped at its top edge.

Waves, found on the Panda 4x4 and the 911 SC (zebra of hull.ply against the photos):

25. **Steps in the top view blurred into the body.** The plan is the top view's widest
    line at every station, and that line steps out where a bumper's wrap or an arch
    flare ends (Panda: 13 mm at -1.38, 17 mm at +0.86). Smoothed, a step is a twist up
    the whole wing (the section scales the plan at every height) and a ripple along the
    rear quarter. Where the photos show flat sides, `planOverride` gives the plan as
    the car's: straight tapers into the ends' corners.
26. **A top view read off centre.** Half-width is the wider side of each station from
    `centre` (default: the middle of the silhouette's rows). A box cutting one side's
    outline, or a mirror or an open door drawn on one side, moves that middle, and the
    wider side wins everywhere (911: the front wings and door came out as wide as the
    rear wings, the door's rear half a 3 cm dent). Give the drawn centreline as
    `top.centre` and a box that takes in the whole outline.
27. **Top line rung by the drawing.** `smooth1` on the top line keeps the drawing's
    pixel steps and small drawn lips (911: the scuttle's 1 cm hump before the screen);
    the 3-D blur only softens them into waves along the bonnet and the lid. On a body
    with no steps in its top line (no drip rails, no cab-to-bed) `topSpacing` 0.15 with
    `cornerDeg` 20 fairs it and keeps the screen foot and the lid's end; a drawn lip is
    replaced by `topOverride`.
28. **topCross folds.** Stations were joined by straight pieces along the car and their
    points by straight pieces across it: every station a fold, every point a crease.
    Both are monotone cubics now (as sections at stations are). Bodies with topCross
    built before this change (Käfer, 2CV, jeeps, Land Rover, UAZ, Valiant...) pick it
    up on their next rebuild; the Käfer's hull checked: the same shape, no new folds.

Car-file fixes from the photos: the Panda's bonnet one straight line to the screen (the
hand-read outline bent at -1.17 and the blur made an S of it); the 911's front wings
above the bonnet with the headlamps in their noses and a valley between (`topCross`;
the side outline is the wings' crest, so the bonnet had been as high as the lamps).
The 911's reference photos were of the Safari rally car; now stock 1980-83 coupés.

## 2026-10-04: Moskvich-412 rear glass missed in review

The rear pane was authored with its centre header at 1.29 m under a 1.47 m roof.
It passed assembly but looked like a squat slit with a broad painted band above it.
The rear-straight and rear34-left photographs show the header close to the roof,
at the side windows' height. The car file now puts it at 1.405 m, with rounded upper
corners and the lower edge just above the deck. Assembly keeps that header
(`top down 0 cm`, `ragged 0`); checked in the game head-on and rear three-quarter.
Dimension checks alone did not catch this. Glazing review must compare the visible
header, sill, corners and roof band against the photographs, not just accept the
absence of a fitting warning.

The AMC Eagle's mirror was another missed placement error: its head stayed at
0.90 m after the belt was moved to 0.955 m, below the window. It now sits at
1.02 m at the front corner of the door glass, as in the wagon photographs;
checked in game from both front quarters.

Peugeot 504: the headlamp lens was only 8.5 cm high and read as a white strip.
The lens and bezel now fill the grille band, with the inner edge sloped as in the
1971 saloon photographs; the parking/turn lamps remain below, above the bumper.
Plymouth Valiant: a 1.0 m nose taken from the side drawing left a broad blank brow
over the grille, unlike the front view and photographs. Its leading edge now
meets the lamp bezels, keeping the cowl height. Its clear rear lens also needed
the `reverse_lights` node name, not just the `ReverseLights` material. Both cars
were rebuilt, installed, viewed close-up in game, and passed `dims.py` within 2%.

## 2026-10-04: Renault review with the selected clay finish

Renault 4 TL: the drawing is a 1961 car; the former front photo was an early car,
and the side/rear photos were a GTL. Replaced the photo set with the documented
[1978 TL, Collecting Cars lot 002678](https://collectingcars.com/for-sale/1978-renault-4-tl)
(Spanish-built R1125, 845 cc; being sold in Germany does not make it a German-market car).
The shell still uses the drawing, at the later 1485 mm width. Details now follow
the TL: black grille with a thin bright rim, rectangular amber/clear front units,
flush black plastic cowl intake, narrow bright waist moulding, eight-hole wheels,
chrome mirror and rear bumper overriders. The rear cluster is red/amber/red in
black rubber, not a clear reversing lens in chrome. Rear glass widened to 840 mm,
with the tailgate shut line outside it. The roster's 620 kg remains unverified;
no French 782 cc or GTL 1108 cc specification was substituted for its 845 cc engine.

Renault 5 Alpine: read the original scan of
[FIA form 5650](https://historicdb.fia.com/sites/default/files/car_attachment/1613145601/homologation_form_number_5650_group_1.pdf),
not just OCR. Length 3543 mm includes bumpers (3506 excludes them), empty height
1395, front/rear tracks 1294/1270, wheelbases 2412/2442 (model mean 2427).
Fourth gear is 1.035, final drive 31/8 = 3.875. Roof/glazing height adapted in the
car file, not by a whole-body game stretch. Thin bright grille bars, four-opening
flat wheel faces and narrow dark C-pillar vents with bright rims replace the
cross-shaped wheels and silver sail panels. Side vent projection excludes the
roof; the rear-window header is body colour, not a silver band.

The Alpine's front-view pane fitter still raised the foot 9 cm after two contour
adjustments. Measured the actual skin by vertical rays: the screen slope runs
from y -0.68 to -0.30, approximately 1.0 to 1.30 m high. Its pane is now authored
in plan on that slope, with no end-view fitting. Final assembly has no PANE or
GLASS-RAGGED warning. Both rebuilt GLBs were installed/refitted, checked front
and rear in the lab with ordinary paint and the same selected clay preset;
small smooth surface waves were retained. `build/carshape/dims.py` reports
`OFF []` for both (largest envelope error about 1.1%); TypeScript check passes.
Four live metal/clay switches created zero shader programs inside render, and
the browser reported no errors.

## 2026-10-04: Saab 96 to Škoda 110 R, the rest of the alphabet

Every car after the Renaults was checked against photos of its roster version,
rebuilt, checked in the lab (metal and clay) and committed (d51c19e, 9586af2,
00856bc, 2e6109a). The reference folders were wrong again for: Niva (2010s Lada 4x4),
VAZ-2101 (21011 front mixed in), VAZ-2108 (a chopped convertible), Saab 96 (rally
car), Trabant (Kübelwagen), UAZ-469 (hardtops for the canvas 469B), T2 (late-bay
T2b for a 1971 T2a), Volvo 240 (245 wagon for the 244 saloon), Wartburg (none).

Generic findings:
- **Side-view `bars` are never built** (assemble.py skips views other than front
  and rear). The slats on ZAZ-968M, Škoda 110 R, T2 and Leone sides are decals now.
- **Vertical bars on a raked face stand off as a tab** (box set at the rearmost
  sample): Käfer's lid louvres are decals.
- **A pane's end-view fit can pull a header or foot under the roof's edge**
  (Alpine screen, Volvo and Wartburg back lights): measure the slope by rays and
  author the pane in plan (`view: 'top'`, outline `[y, half-width]`, `fit: False`).
- **Bumper at +-L/2 when the factory length runs to a spare**: SJ410 and UAZ rear
  bars stood 26-31 cm off; `standMax` keeps them on the body, the spare's face
  carries the length (SJ410's spare on a carrier box at the photos' height).
- **`overriderMaterial`**: new bumper key, rubber overriders on chrome bars
  (Trabant, Wartburg, VAZ-2101, Škoda). `standOff` was a dead key and is gone.

Open: Leone's roster tracks (1300/1280) look 30-60 mm wide against period sheets;
Golf roster comment says 1974 while the body is the 1978-83 car; the ZAZ-968M and
Škoda bars stand 8-13 cm off their drawn ends (short drawn overhangs), reading as
bracketed bars; Niva's wheel has slots where the 1983 car has round holes.

## 2026-10-04: the user's in-game screenshots (2108, 240, 2002, Escort, Niva, ZAZ, R5, 110 R)

- **Bumper ends as stepped blocks** (Volvo 240's rear corner): assemble.py sorted the
  bar's path by x, regrouping points that share the clipped side x; the path now only
  reverses. Every body rebuilt with it and checked from the rear quarter.
- **New key `rubberTop`**: the rubber strip along the bar's top edge (BMW 2002: the
  chrome top bevel mirrored the sky as a blue band).
- Decals that wrap a corner as two patches (2108's amber) stand off as a flap: one
  end-view patch with a facing limit instead.
- A rear pane with a negative `facingMin` rides the tail's crest and its edge catches
  the sky as a box's face (Niva): keep it positive, outline from the drawing.
- A concave glasshouse side came from `shelfRise` spreading the inset down the door
  (Volvo 240); `roofEdge` 0.035 for a tight drip rail.
- Rear-engined underbody pan hangs out behind a tucked tail (ZAZ-968M).
- Mirrors whose sail lands on a quarterlight hang in the air (110 R): door corner at
  the belt.
- ZAZ-968M is a two-door (the drawing is a four-door); 2108 has a black lip above its
  back light; Niva 1983 bumpers black.

## 2026-10-05: Fulvia roof "dent", mirrors, and end views read as the car's section

- **An end view is the end's shape, not the car's section.** The Fulvia's drawn front
  and rear profiles both taper 13 cm a side between z 0.50 (1.555 m over the wings) and
  z 0.90 (1.30 m at the belt) because the wings bulge past the cowl and the lid. Taken
  as the one section for all stations (as hull.py uses them) that made the doors
  barrel-sided - widest at mid-height, the waist rolling away instead of a crease. The
  file's `front`/`rear` outlines are now the door's own cross-section (full width up to
  the waist moulding at 0.86, a 11 cm step in at the belt, then the glasshouse's
  tumblehome), traced off the drawings but not as the ends' own profiles.
- **A narrow `roofEdge` makes a roof tent, not a drip rail.** With the roof's width
  left to the hold (0.012), it took the section at 1.29 where the outline has only the
  crown left: a 0.98 m ridge and a 17 cm roll a side, which reads as a soft dome and,
  under the sun, as a dent down one flank. The section now carries the roof's width
  (0.53-0.58 half) and `roofEdge` only fairs the rail (0.03 first, 0.045 after the
  second pass below).
- **`shelf` double-counts a stepped section.** With a real 11 cm shoulder step in the
  section, `shelf`'s 3 cm inset and `shelfRise` flare the glasshouse's foot back out to
  the flank; `shelf: False` leaves the car's own step as the crease.
- The Fulvia's roof was checked for left/right asymmetry and has none: the dense hull
  mirrors to 0.0 mm, the working shell to 1.1 mm (surface-to-mirror), the roof's faces
  to 0.6 mm and 5 deg (p90) in normal, and two mirrored zebra cameras agree to
  antialiasing. The defect was the symmetric ridge-and-roll read under a directional
  sun, fixed by the roof width above. `symm.py`'s large figures are its known
  one-sided parts (blinkers, the exhaust and prop shaft on `car_trim`) and the
  paint/trim material split through the floor, not the skin.
- Mirrors: the Fulvia file's `y -0.06` was the middle of the door (the comment already
  said the corner); the door's front shut line is y -0.50, and `_side_front - 0.12`
  keeps it a door mount there. Small round chrome head per the photographs.

## 2026-10-05 (later): Fulvia second pass - re-traced against the photographs

Measured the built body's silhouette against `_refs/photos/fulvia/side.jpg` instead of
against the previous build: the drawing's wheelbase gives 288.4 px/m, the front axle
is at x 298 and the ground at row 731, so the photograph's own top line can be taken
column by column (red mask) and compared with an orthographic render of the body at
the same scale and axle (tools/carshape/overlay.py's model render). What it showed:

- **A body line traced from the drawing is not the photograph's.** The bonnet, roof
  and tail matched within 1 cm, but the back light's rake was 2-6.6 cm high through its
  middle (the file's line was curved: shallow at the roof, steep at the foot) and the
  whole deck sat 1.7-4.5 cm low to the tail. Both are now the photograph's own points;
  the deck and rake agree to 1.7 cm.
- **The belt rises nose to tail.** The photograph's glass foot is 0.870 over the front
  door and 0.888 over the rear quarter; the file had the belt falling 0.868 -> 0.82,
  which tilted the whole glasshouse down at the back. With the belt raised, the
  side panes' feet (0.837-0.852) fall below the glasshouse's floor (belt - 0.03) and
  must be lifted with it.
- **A widened section meets the glass feet.** Raising the section's shoulder step to
  0.885-0.915 (so the belt's rise does not push `lower_ref` above the step and scale
  the whole car wide) put an up-facing band of shoulder either side of the pane feet:
  `GLASS-RAGGED` on the quarter light and the screen. `sectionSmooth` 0.03 -> 0.015
  (a 1.5 cm gaussian) tightened the shoulder back to a crease and cleared it
  (0 faces ragged). The screen also needed its plan outline pulled in to x 0.615 at
  the A-pillar's foot and its `facingMin` to 0.22 - at 0.30 the outline included
  side-facing faces of the pillar's foot, 6 of them ragged.
- `crown` 0.004 -> 0.008 and the bumper's `depth` 0.04 -> 0.03, `wrap` 0.30 -> 0.26.
- Still open: the nose's leading edge is a rounded roll where the photograph has a
  crisp brow over the lamps (the photo's mask reads 2-4.5 cm above the built line
  between y -1.85 and -1.65, but the mask catches the bonnet's highlight there, so the
  line was left on the file's full-resolution trace); the lamp decals' circles are 28
  sided and their chrome rims show facets; a wrapped bumper end still cuts as a step.

## 2026-10-05 (third): Fulvia glazing - why ten passes kept shipping defects

The user's screenshot after the second pass still showed the screen running into the
door glass with no pillar, a notched screen edge at the pillar's foot and the quarter
light's foot smeared along the shoulder as a black sliver. The causes, none of which a
pass-by-pass outline tweak could reach:

- **Keys nothing read.** `glassSeal` and `pillarReach` sat in the Fulvia file beside
  `parts`, `paneEdgeRelax` in `hull`; assemble.py reads all three from `parts`. So the
  seals were the default 14 mm black rubber, not the 8 mm chrome the file asked for,
  and `reach_pillar` pushed the door glass up to 6 cm forward into the screen the file
  said to leave alone. Now both stages stop on any key they do not read (`KEYS`;
  hull.py's `KEYS`, assemble.py's `CAR_KEYS`/`PARTS_KEYS`). The four cars carrying a
  dead `crownScale: 1` (Delta, Giulia, Golf, Panda) lost it; their bodies are
  unchanged (Golf rebuilt: the same shell, the same parts but its wiper blades, which
  moved up to 1 cm with the glass foot now found exactly).
- **No place for the A-pillar.** The screen was the side profile run straight across,
  so it met the glasshouse side in a square fold where the photograph's pillar is
  25 cm further back at its foot (the screen wraps round; the top view draws its foot
  as an arc). Any screen outline either stopped at the fold, leaving a paint slab, or
  ran round it onto the side. New hull key `screenWrap` curves the screen in plan;
  the shell's turn from screen to side wall now sits on the photograph's pillar line.
- **A shoulder that was a bevel.** The end views' smoothing turned the drawn 11 cm
  shoulder step into a 45-degree bevel from z 0.83 to 0.96, so a pane's foot always
  lay on a fillet. The cabin's section is now given outright (`sectionKeys`) with a
  crisp ledge; the side wall is clean (normal > 0.93) from 0.91.
- **Glass made of the shell's own triangles.** The pane edge was wherever the working
  mesh's triangles and a facing limit put it. New `glassOverlay` (Fulvia only so far;
  every other car still cuts its glass from the shell): each pane is triangulated
  from its outline in the view's plane, dropped onto the skin 2 mm off it, with its
  own seal band 4 mm off and walled into the skin, so the edge IS the outline. Each
  pane is checked in the log (GLASS/PILLAR lines, GLASS-FAIL): rays that miss, facing
  under 0.3, the skin bending under the glass faster than 8 deg/cm, the shell coming
  through the glass, two panes closer than 1.2 cm. The checks caught, before any
  render, the side glass's foot on the ledge's fillet (10.5 deg/cm at z 0.916), the
  quarter light's rear tip on the C-pillar's turn and the screen's top corners on the
  roof's edge roll.
- **Judged on whole-car sheets.** The defects were visible only in close-ups at the
  user's angles. The review is now a fixed set of game-renderer close-ups of every
  glazing junction, both sides, high and low (A-pillar foot and top, vent divider and
  mirror, B-pillar, quarter light's rear foot and top, back light's corner, wipers),
  cropped and looked at full size, plus the user's own angle; a pass ships only with
  zero GLASS-FAIL and nothing wrong in those crops.

Measured off the side photograph (288.4 px/m, front axle x 298, ground row 731): the
pillar's red from y -0.405 at z 0.905 to -0.168 at 1.238; the belt chrome 0.876-0.904,
glass from 0.905-0.91; the frames' top 1.25; the vent divider at -0.087 (the drawing's
vertical line), the B-pillar chrome 0.566-0.594; the door's shut line from the pillar's
foot curving to -0.475 and its rear edge bowing to 0.646 (the file's box started 10 cm
ahead of the pillar). The mirror stands on the vent divider (y -0.11), not at the
pillar's foot, which the wrapped screen turns into the wing's top.

Still open: near the roof the C-pillar is 1-1.5 cm narrower than the photograph's (the
shell's rake runs 2-3 cm forward of the photograph's there; the quarter light's rear
edge was moved 1.5 cm forward to keep most of it); the round mirror head is a short
cylinder where the car's is a shallow dome (shared by 19 cars' `shape: 'round'`).
