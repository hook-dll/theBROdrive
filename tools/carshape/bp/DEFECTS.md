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

1. **Underside on every car.** The slab hanging from the sill down to the clearance
   is gone in the generator (824adb5): the floor closes at the sills and only the real
   low points (sump and subframe, the driven rear axle and diff, a 4x4's front diff,
   a frame's rails) reach the clearance. Not yet in the game for most cars: they need
   the one rebuild.
2. **Waves.** Ripples in the reflection on wings, doors and round the arches.
3. **Compression artefacts.** In places the body is crumpled like an accordion, as if
   squeezed: steps between stations and folds where the views disagree.
4. **Glazing.** Panes and their seals out of line with pillars and door shut lines;
   the screen's and side glass's edges not one line.
5. **Pillow bodies.** Crisp edges the drawings have (deck to tail panel, shoulder,
   bonnet edge) blur away; tails and noses swell.
6. Soft tops / canvas: a box on the cabin (MX-5), a fang over the boot (2CV).
7. Lamp decals with torn edges (UAZ reversing lamp).

Done: no number plates or blank plate patches (824adb5); mirrors with a sail, a short
arm and a tapered housing with its glass; arch flares built on the skin, stopping
where the side ends, a lip over the arch's cut edge.

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
