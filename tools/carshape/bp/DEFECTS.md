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
