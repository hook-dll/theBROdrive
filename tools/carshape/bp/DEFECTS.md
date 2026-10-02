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
