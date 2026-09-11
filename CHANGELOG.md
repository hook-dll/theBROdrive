# Changelog

## Unreleased

### Fixed

- The drive no longer starts at a resolution the launch transient chose. Dynamic
  resolution is measured from GPU time, and the frames straddling the reveal — the
  last shader variants, the first uploads, the boot GC — are the most expensive of
  the session, so the controller read them as a machine that could not cope and
  walked the drawing buffer down step by step. Measured on a cold profile at
  1384x805: the first entry into the world ran at 761x442, the second at 1176x684,
  identical world and settings. At 55% the film grain is filtered away by the
  upscale, the ink outlines smear into a general darkening and the asphalt loses its
  aggregate, which is why the first launch looked unfinished and a second one looked
  right. The launch now renders the real frame path under the loading cover,
  discards the transient, and lifts the cover only once the controller has actually
  measured the resolution it is holding — verified as an unchanged drawing buffer
  over the 30 s after the reveal, on the same machine that used to drift through
  four resolutions in that time.
- A resolution drop is no longer permanent. Coming back up needed 240 CONSECUTIVE
  samples under the fast threshold, and any single sample in the band between the
  two thresholds reset the count — and that band is where a healthy frame on an
  integrated GPU actually lives, so nothing ever climbed out. Both directions now
  read a running average of GPU cost, which a brief stall cannot fake: one second of
  40 ms frames costs at most one step and is repaid, and thirty seconds of real
  headroom restores full resolution.
- Driving down into a deep basin no longer pins the car and then the player to the
  middle of the road. The fall-out-of-world rescue treated a fixed altitude
  (-400 m) as "below the world", but the landscape carries ±1430 m of relief, so
  whole basins sit under that line — 56% of seed 1337's road and 76% of seed 2024's,
  in continuous stretches over 100 km. The boundary is now measured against the
  ground at the body's own position, so solid asphalt at any altitude is never a fall.
- A rescue that does fire places the car along the road's grade instead of level on
  it: at 14% that is 2.8 cm of bumper inside the asphalt rather than 30 cm, which is
  the sunk-rear, raised-nose pose the repeating rescue left behind.
- Overtaking no longer stalls on the centre line: the car being passed is located by a
  probe cast down a fixed lane centre rather than down the driver's own moving line,
  so it can no longer appear to jump into the lane being used to pass it. Measured
  before the fix, with the opposing lane empty: 22 seconds of 30 straddling the
  centre, 1204 indicator changes, and the leader nudged along in front.
- A car being overtaken keeps its measured speed while the driver's line is out in the
  opposing lane, so it is no longer treated as a stationary obstacle to be squeezed
  past at walking pace — which held every pass at the leader's own speed, alongside it,
  indefinitely.
- The planner's switching hysteresis is measured against the line it last chose rather
  than the rate-limited line the car is still slewing along, so a decision cannot flip
  free of its own switch cost mid-manoeuvre.
- Autonomous indicators follow the car's remaining lateral travel, so they stay on for
  the whole lane change instead of going dark as soon as the commanded line arrives.
- The traffic setting now puts its cars where they can be seen. At thirty, a cruising
  player had 6.7 cars ahead of him and 12.9 piled up behind, because the stream was
  spawned only ahead and collected 850 m behind, and he overtakes nearly all of it.
  The rear tail is now bounded by the collision window, and a driver whose speed cap
  beats the player's actual pace is spawned behind him so it closes and arrives in
  view. Measured at 90 km/h: 10.6-11.1 cars ahead of 22.4-23.1 live, against 6.7 of
  19.7 before.
- Traffic spawn sites are no longer drawn past the streamed collision window. A site
  with no ground under it still passed selection, held the one pending spawn through
  a model load, and was discarded on arrival — 207 of 300 attempts, a refill rate of
  0.38 cars/s against the 2/s the cooldown allows, which is why the stream sagged to
  half its setting after every density change.
- An oncoming car is only treated as out in the opposing lane — and so as a 300 m
  spawn blackout — once it is half a body past the crown. The old test left 0.35 m
  of slack over the lane centre, so ordinary lane-keeping error on a bend read as an
  overtake in progress: 419 of 1540 candidate sites rejected on one seed, none on
  another.

## 0.14.3 — 2026-09-11

### Fixed

- The launch cover now waits for the shader variants the live frame actually uses:
  the scene pass is compiled with the offscreen haze target bound, so its
  tone-mapping/colour-space program is the one that was warmed.
- Launch also waits on a GPU fence after the final covered draw, so first-run texture
  uploads, shadow maps, the environment bake and the fullscreen pass are finished
  before the player sees anything.
- The lunar texture is awaited during loading instead of popping in after the drive
  has started.

## 0.14.2 — 2026-09-11

### Changed

- Phone-sized touch devices now start on Acceptable/near/MSAA-off unless that browser
  already has an explicit graphics preference.
- Mobile rendering uses absolute 540p/720p/900p pixel ceilings for
  Acceptable/Standard/Blessing and never renders duplicate frames above 60 FPS.

### Fixed

- High-DPR 90/120 Hz phones no longer multiply the scene, post-process, and MSAA fill
  cost from desktop-oriented pixel ratios and uncapped presentation.

## 0.14.1 — 2026-09-11

### Fixed

- Courier cars now park at the road-facing edge of their POI instead of receiving
  an unrelated lateral offset that could hide later couriers behind the site.

## 0.14.0 — 2026-09-11

### Added

- Physical courier cars placed deterministically at roadside POIs every 6–12 km, with a distinct shader finish and persistent eight-cell trunks.
- Four permanent physical parcel contracts per courier, transferable through hands, loose-item storage, and vehicle trunks.
- Signed sticker envelopes that replace delivered parcels atomically and can be stored, dropped, transferred, and applied to any normal car.
- Modal sticker placement preview with wheel rotation, confirm/cancel controls, painted-panel filtering, and full-footprint validation.
- Persistent courier storage, completed-contract IDs, physical reward migration, and save-code round trips for contracts and stickers.
- Recurring roadside mirage tableaus, expanded sandstone cities, shipwreck silhouettes, moon/grade/climb lab tooling, and boot warm-up diagnostics.
- Source vehicle-import archives and visual proof/reference files used by the current vehicle and sticker work.

### Removed

- The abstract freight job, destination-sign, pallet, `WorldState.job`, `stickersUnplaced`, and delivered-POI progression path.
- Immediate counter-driven sticker placement without a physical envelope or preview.
- Fixed full-cap traffic density and the old dense-traffic overtaking gate.

### Changed

- Traffic count is now a natural varying population below the configured cap, with per-driver following distances and overtaking at every supported density.
- Ambient traffic headlights fade with distance while the driven car keeps its authored beam strength.
- Headlights use warmer period-correct colour, softer edges, and less clipping; midnight receives readable moonlit terrain fill.
- Autopilot yields headlight ownership after a manual switch until it is re-engaged.
- Mirage cities now use varied wall colours, windows, balconies, roof caps, and street strips while retaining instanced rendering.
- World boot waits for the requested road-chunk and desert-tile windows instead of treating an empty scheduler as complete.
- Traffic engine voices use a broader, quieter combustion spectrum with stronger distance falloff.

### Fixed

- Resumed drives no longer begin before support colliders and nearby terrain are ready.
- Traffic density reductions remove safe behind-player cars instead of visibly popping arbitrary vehicles.
- Ambient headlight pools no longer appear at full brightness when distant traffic spawns or enters the light budget.
- Manual headlight changes are no longer overwritten on the next autopilot step.
- Autopilot obstacle passing, recovery, lane holding, and following remain stable across curves, grades, hazards, parked vehicles, and opposing traffic.
- Mirage placement, wreck spacing, sandstone-city readability, sky fill, and distant transition behaviour were corrected.
- Delivered cargo cannot mint a second reward, and cancelled or invalid sticker placement cannot consume its envelope.
