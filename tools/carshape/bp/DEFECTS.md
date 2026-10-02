# Blueprint bodies: what the generator still gets wrong

Each item is fixed once, in hull.py / assemble.py, and checked on the canaries
(mx5, uaz469, kafer, citroen2cv, golf1) from the low chase angle. All cars are
rebuilt once, when the whole list passes.

1. [done 824adb5] Underside: a black slab hangs from the sill down to the published clearance.
   The floor should close flush with the sills; only the real low points (rear axle
   and diff on RWD/4x4, sump and subframe at the front) reach the clearance.
2. Pillow bodies: the hull loses the crisp edges the drawings have (deck to tail
   panel, shoulder, bonnet edge), so tails and noses swell (MX-5 tail).
3. Waves: zebra shows ripples on the front wings and round the arches.
4. [done] Mirrors: lollipop discs on stalks -> a sail on the door, a short arm, a housing tapering forward with its glass set in.
5. [done 824adb5] Plates: not wanted at all (user) — every part in the plate materials is dropped.
6. Soft tops / canvas: a box sitting on the cabin (MX-5), a fang over the boot (2CV).
7. Lamp decals with torn edges (UAZ reversing lamp's red teeth).
8. [done 824adb5] Arch flares: tabs at the leg ends, torn arch edge showing (fixed: band stops where
   the side ends, lip turned over the cut edge).

## Why the bodies are soft (2, 3), found on the MX-5 tail

The shell is the intersection of 1-D profiles (side outline per height, plan
half-width per station, end-view section per height) and every one of them is
smoothed to drop the drawing's line noise (median + gaussian on the sections, a 4 cm
blur on the nose/tail faces, the plan, then a 3-D blur of the distance field). The
smoothing cannot tell a crease from a shut line, so creases go with the noise.
Turning the smoothing down (tried on mx5) sharpens edges a little but adds waves and
leaves the real faults: the plan is left raw within 18 cm of each end (smooth_inner's
margin), so a kink in the top view's tail curve becomes a vertical groove down the
tail panel; and a tail or nose has one section for all its stations, so a bumper
crease and a tucked-under valance cannot exist at all.

## The traced way (loft.py `trace`), trial on niva_l and mx5_l

The body is lofted through the drawing's own lines, traced by hand in metres off the
grid-*.png sheets. Rules learnt:
- an end is described once: by its side profile (nose/tail [[z, y]]); the deck and
  sill lines stop where it takes over and run on flat, or the two fight and fold;
- the plan's width at the very nose is the width there at every height: a pointed
  plan pinches the whole section;
- glass comes from the glasshouse (`glazing`): side windows between pillars up to the
  roof edge, screen and back light inset from the section, frames in their own
  material, a soft top as `houseMaterial`;
- lamps and details are placed from the drawing and checked against a photo
  (build/carshape/_refs/photos/<car>).
