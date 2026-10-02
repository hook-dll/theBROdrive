# Blueprint bodies: what the generator still gets wrong

Each item is fixed once, in hull.py / assemble.py, and checked on the canaries
(mx5, uaz469, kafer, citroen2cv, golf1) from the low chase angle. All cars are
rebuilt once, when the whole list passes.

1. Underside: a black slab hangs from the sill down to the published clearance.
   The floor should close flush with the sills; only the real low points (rear axle
   and diff on RWD/4x4, sump and subframe at the front) reach the clearance.
2. Pillow bodies: the hull loses the crisp edges the drawings have (deck to tail
   panel, shoulder, bonnet edge), so tails and noses swell (MX-5 tail).
3. Waves: zebra shows ripples on the front wings and round the arches.
4. Mirrors: lollipop discs on stalks.
5. Plates: not wanted at all (user) — every part in the plate materials is dropped.
6. Soft tops / canvas: a box sitting on the cabin (MX-5), a fang over the boot (2CV).
7. Lamp decals with torn edges (UAZ reversing lamp's red teeth).
8. Arch flares: tabs at the leg ends, torn arch edge showing (fixed: band stops where
   the side ends, lip turned over the cut edge).
