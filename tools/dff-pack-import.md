# DFF vehicle-pack import

Rules for cars from the current GTA SA DFF pack. Normalize offline; runtime code must receive a small, explicit GLB rather than learn pack-specific names. `tools/import-dff-pack.py` is that normalizer (Blender + DragonFF); `tools/dff-pack-audit.mjs` enforces the contract below on the packed result.

## Keep and remove

- Keep the intact exterior: chassis/body, bonnet, boot, bumpers, grille, lights, windscreen and all four complete `*_ok` doors.
- Preserve the authored door meshes, including their inner door cards. Do not remove material slot `0` by assumption and do not replace the cards with synthetic panels.
- Remove `Salon`, `Dvigatel`, damaged variants, VLO/LOD duplicates, collision meshes and shadow meshes. Game-owned service parts remain separate. Nothing that lives inside the cabin or under the bonnet ships: seats, dashboards, steering wheels, pedals, engines, suspension and exhausts are all removed, not decimated.
- Add a shallow, closed underbody mesh ONLY where the DFF is an open shell. It must use opaque `car_trim` and stay inboard of the sills; glass must never expose the world through the floor. A body whose own geometry already closes the underside gets no plate — burying a slab inside an authored floor is what makes a car look like it is standing on a crate.

## Materials

Collapse source materials into these six runtime roles and no more:

- `car_paint` — painted body panels;
- `car_trim` — grille, bumpers, mouldings, door cards and underbody;
- `car_glass` — windows only;
- `Headlights` — front lamp lenses;
- `BrakeLights` — rear lamp lenses;
- `Tyres` — tyre carcass; `wheel_rim` — the rim inside it, split off by `tools/rim-split.mjs` after packing (no source pack separates them, and a wheel left as one dark material reads as a black circle beside the Soviet cars). Detached hubs may keep `car_trim`.

Do not ship the TXD or texture images for this pack. Remove unused UV attributes. Export lamp meshes as explicit nodes named `headlights` and `taillights`; select those node names in `CarModelDef.lights`. Select `car_glass` through `CarModelDef.glassMaterial`.

## Catalogue paint wiring

- Every imported SAAS body must be registered with `paintStyle: 'solid-paint'` in `CarModelDef`; otherwise its authored GLB colour is permanent and roadside/player appearance variation is skipped.
- Keep the body material named `car_paint` and the window material named `car_glass`. The `solid-paint` path recolours paint slots while excluding glass, lamps, chrome, trim and wheel materials.
- Add `glassMaterial: 'car_glass'` to the catalogue entry. Do not use `soviet-atlas` for this texture-free pack: its GLB has solid runtime materials, not Soviet atlas UV cells.

## Wheels and suspension

- Use the four DFF wheel dummies as axle centres; never infer mounts from the body bounds.
- Re-centre the source wheel geometry on its own bounding-box centre before placing it on a dummy.
- Export exactly `wheel_fl`, `wheel_fr`, `wheel_rl` and `wheel_rr`.
- Preserve outward-facing orientation. A wheel borrowed from the other side is TURNED 180 degrees about the vertical axis, never mirrored: a negative-scale mirror reverses winding and normals. Some source wheels are authored inverted already (GTA draws them two-sided), so the normalizer flips any wheel whose signed volume comes out negative.
- A wheel node is the complete moving assembly: tyre, rim, hub, visible axle and attachments. Merge them into that node or list every authored child in the same `wheelNodes` slot. Nothing visually attached to the wheel may remain in the fixed body mesh.
- In this pack, the visible hub/axle pieces are separate connected islands inside `Chassis`, centred within 8 cm of the wheel dummies. Remove those islands from the fixed body and export them as `hub_fl`, `hub_fr`, `hub_rl` and `hub_rr`; pair each hub with its wheel in `wheelNodes`.
- Derive catalogue scale from the real car's wheelbase, then verify track and tyre radius after runtime scaling.

## Export contract

- One body mesh node per material role, plus four wheel nodes, four moving hub nodes, and an underbody node where the shell needed one.
- Nose down +Z, the direction the game drives. A GTA body faces +Y and the glTF Y-up conversion turns that into -Z, so the normalizer bakes half a turn about the vertical axis into the geometry. Do not express this as catalogue `yaw`: the loader detaches wheel nodes and mixes their world centres with their local offsets, and a rotation left on a parent node is dropped by that detach.
- No engine/interior/damage/collision/shadow nodes, no textures or images, no unused UVs.
- Positive scales only. Bake source hierarchy transforms before export.
- Meshopt-compress the final GLB after normalization: `node tools/rim-split.mjs <in> <rim>` then `gltf-transform optimize <rim> <out> --compress meshopt --palette false --join-named false` (a palette pass would invent a texture and joining named meshes would destroy the node contract).

## Required verification

1. Run `node tools/dff-pack-audit.mjs public/models/saas`: six materials, zero textures/images, explicit lamp nodes, four wheel nodes with four matching hubs, positive scales, headlights ahead of taillights, and every wheel wound outward.
2. Run `carModelMeasure`: four wheels, plausible radius, and wheelbase/track matching the real vehicle after scale.
3. Spawn the car in the game. Toggle headlights and confirm the `Headlights` material changes from zero emission to visible emission and produces two mounts.
4. Drive it: it must pull forward on throttle and steer from the front axle.
5. View both sides: right rims face outward; no wheel has a negative scale.
6. Drive over uneven ground: tyre, rim, hub and visible axle travel together with each suspension wrapper.
7. Inspect from below and through the windows: the floor is closed and the original door cards remain.
8. Run `npm run check` and `npm run build`.
