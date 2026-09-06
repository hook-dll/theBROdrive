# DFF vehicle-pack import

Rules for cars from the current GTA SA DFF pack. Normalize offline; runtime code must receive a small, explicit GLB rather than learn pack-specific names.

## Keep and remove

- Keep the intact exterior: chassis/body, bonnet, boot, bumpers, grille, lights, windscreen and all four complete `*_ok` doors.
- Preserve the authored door meshes, including their inner door cards. Do not remove material slot `0` by assumption and do not replace the cards with synthetic panels.
- Remove `Salon`, `Dvigatel`, damaged variants, VLO/LOD duplicates, collision meshes and shadow meshes. Game-owned service parts remain separate.
- Add a shallow, closed underbody mesh when the DFF is only an open shell. It must use opaque `car_trim`; glass must never expose the world through the floor.

## Materials

Collapse source materials into these six runtime roles and no more:

- `car_paint` — painted body panels;
- `car_trim` — grille, bumpers, mouldings, door cards and underbody;
- `car_glass` — windows only;
- `Headlights` — front lamp lenses;
- `BrakeLights` — rear lamp lenses;
- `Tyres` — tyre/rim wheel mesh; detached hubs may keep `car_trim`.

Do not ship the TXD or texture images for this pack. Remove unused UV attributes. Export lamp meshes as explicit nodes named `headlights` and `taillights`; select those node names in `CarModelDef.lights`. Select `car_glass` through `CarModelDef.glassMaterial`.

## Catalogue paint wiring

- Every imported SAAS body must be registered with `paintStyle: 'solid-paint'` in `CarModelDef`; otherwise its authored GLB colour is permanent and roadside/player appearance variation is skipped.
- Keep the body material named `car_paint` and the window material named `car_glass`. The `solid-paint` path recolours paint slots while excluding glass, lamps, chrome, trim and wheel materials.
- Add `glassMaterial: 'car_glass'` to the catalogue entry. Do not use `soviet-atlas` for this texture-free pack: its GLB has solid runtime materials, not Soviet atlas UV cells.

## Wheels and suspension

- Use the four DFF wheel dummies as axle centres; never infer mounts from the body bounds.
- Re-centre the source wheel geometry on its own bounding-box centre before placing it on a dummy.
- Export exactly `wheel_fl`, `wheel_fr`, `wheel_rl` and `wheel_rr`.
- Preserve outward-facing orientation. Keep left assemblies as authored; rotate right assemblies 180 degrees around the vertical axis. Never use a negative-scale mirror because it reverses winding and normals.
- A wheel node is the complete moving assembly: tyre, rim, hub, visible axle and attachments. Merge them into that node or list every authored child in the same `wheelNodes` slot. Nothing visually attached to the wheel may remain in the fixed body mesh.
- In this pack, the visible hub/axle pieces are separate connected islands inside `Chassis`, centred within 8 cm of the wheel dummies. Remove those islands from the fixed body and export them as `hub_fl`, `hub_fr`, `hub_rl` and `hub_rr`; pair each hub with its wheel in `wheelNodes`.
- Derive catalogue scale from the real car's wheelbase, then verify track and tyre radius after runtime scaling.

## Export contract

- One body mesh node per material role, plus four wheel nodes, four moving hub nodes and one underbody node.
- No engine/interior/damage/collision/shadow nodes, no textures or images, no unused UVs.
- Positive scales only. Bake source hierarchy transforms before export except for the deliberate right-wheel rotations.
- Meshopt-compress the final GLB after normalization.

## Required verification

1. Inspect the GLB: six materials, zero textures/images, explicit lamp nodes, opaque underbody, four wheel nodes and four matching hub nodes.
2. Run `carModelMeasure`: four wheels, plausible radius, and wheelbase/track matching the real vehicle after scale.
3. Spawn the car in the game. Toggle headlights and confirm the `Headlights` material changes from zero emission to visible emission and produces two mounts.
4. View both sides: right rims face outward; no wheel has a negative scale.
5. Drive over uneven ground: tyre, rim, hub and visible axle travel together with each suspension wrapper.
6. Inspect from below and through the windows: the floor is closed and the original door cards remain.
7. Run `npm run check` and `npm run build`.
