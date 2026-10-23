# Embankment handoff (2026-10-15)

## UPDATE (second session; supersedes the lists below where they conflict)
- Verge pass speed is back to the car beside + 6 m/s, capped by `vergeCeiling`. The "open up to 130 km/h once settled" rule (`vergeSettled`) is removed; `sizeQueuePass` takes `overPassed`.
  - A/B, stream bench, 3 runs each, frantic contacts per car-min: HEAD 0.34 [0.30-0.42]; geometry only 0.38; full with ceiling speed 0.49 [0.42-0.59]; ceiling speed removed (varA) 0.33 [0.17-0.42].
  - Raw data: `/tmp/embankment/abc2/`, summarised by `/tmp/embankment/sum2.py`.
- Poles: 4.5 m. Delineators: 3.2 m, placed on `tileGroundSampler`.
- `tools/autopilot-bench.ts` reverted to HEAD.
- `tools/traffic-road.ts` adds `left the road` (`CONTROL_SHOULDER_M`).
- Scenario benches on the fix: frantic-pass 48/48, 0 desert, 0 contacts, 0 slides; autopilot-bench 8 FAILs as HEAD; traffic-bench 2 stream impacts, as HEAD (own-side window vs HEAD's far-side). Outputs in `/tmp/embankment/final/`.
- The owner stopped all benches. Still open (Main's list): validate the contact counter with known-answer scenarios; dedupe pairs and merge incidents; establish an A/A noise floor; read --trace incidents; list the top incident locations. A two-car impact is counted by both cars (`vehicle.lastImpact` per car per step).


Nothing committed. `nice -n 10 npx tsc --noEmit -p .` is clean. No benches, Vite, browser tab or worktree of mine is left running (`/private/tmp/lighting-head` is Lighting's).

## Done and verified

### Geometry (the owner says it is right; keep it fixed)
Files: `src/world/roadprofile.ts`, `src/world/terrain.ts` (`gradedBase`), `src/world/roadmesh.ts` (shoulder build, `SKIRT_ACROSS_M`).

- `roadprofile.ts` replaces `shoulderWidthM` with the following:
  - `SHOULDER_WIDTH_M = 2.5`, `SHOULDER_FALL_INNER/OUTER = 0.06/0.15`.
  - `shoulderFallAt(d)` and `embankmentDropAt(d)`: the shoulder's fall, then a 1 m cubic batter down to `EMBANKMENT_HEIGHT_M = 0.45`.
  - `shoulderFringeM(surface)`: the ragged fringe beyond the guaranteed width.
- The terrain's corridor grading is lowered by `embankmentDropAt`.
- The road mesh shoulder:
  - 6 fixed columns follow the formation (the asphalt edge height minus the profile).
  - 2 fringe columns wander and are ragged; the last one tucks under the sand.
  - The strip lies on the ground wherever the ground stands higher (lay-bys).
  - The collider is the same triangles, as `LooseShoulder`.
- New tool `tools/verge-profile.ts [seed]`: rays against the real road chunk and lay-by pads, plus checks on furniture feet.
- Results over 135 chunks, seeds 1337 and 42:
  - Drivable past the edge: min 0.95 → 2.55 m, p50 1.75 → 2.85 m, on straights and lay-bys alike.
  - Fall 7.9 / 11.7 / 14.4 % at 0.5 / 1.5 / 2.3 m.
  - Desert 5 m out: 0.48 m below the asphalt (was 0.09).
  - Ground showing above the strip: 0.3 % of rows, at most 4 cm (was 98 %, up to 11.7 cm).
- `tools/water.ts` passes, and `tools/corridor-shape.ts` gives the same result as HEAD.

### Autopilot
Files: `src/vehicle/autopilot.ts`, `corridor.ts`, `lateral.ts` (the shelved `/tmp/frantic/wip-queue-verge-pass.patch` without its `VergeProbe`).

- The queue pass is sized to the first real gap; it commits once more than half past and gives up only when it cannot finish.
- Out on its line it runs at `vergeCeiling`.
- The tyre stays 0.4 m inside the 2.5 m shoulder (`VERGE_EDGE_MARGIN_M`).
- `VERGE_CROSS_FALL = shoulderFallAt(2.1)` (13.6 %), replacing `SHOULDER_CROSS_FALL = 0.1`.
- `tools/autopilot-bench.ts`: the verge-pass pace check now allows ≤ 130 km/h. The 8 FAILs are the same as HEAD.
- `tools/frantic-pass.ts` (seeds 1337/42/7, M30 and stock):
  - Passed 26/48 → 48/48.
  - Wheels in the desert 128 → 0.
  - Slides 0 → 0.
  - Contacts 0 → 2.

### Poles and posts (edited after the last benches; NOT yet benched)
- `src/world/props/poles.ts`: `POLE_SETBACK_M` 3.1 → 4.5, now exported.
- `src/world/props/delineators.ts`: `DELINEATOR_SETBACK_M` 1.2 → 3.2.
- Comments updated in `agents/birds.ts`, `world/corridorshape.ts`, `world/props/poledesigns.ts` and the autopilot.
- `tools/verge-profile.ts` now reads `POLE_SETBACK_M`.

### Other files
- `tools/traffic-road.ts`: comment saying that `departure` means centre 0.3 m past the PAINT, and that `desert` (a wheel on sand or rock) is "left the road" in the owner's sense.
- `CHANGELOG.md`: two entries under Unreleased / Added (embankment; queue verge pass). **Update them** with the pole/post move and the final contact numbers.

## Open problem: contacts rose
Stream bench, frantic share 0.5, cap 48, seeds 1337 2024 42 7 99, per car-minute. Raw outputs with `--events` are in `/tmp/embankment/abc/<variant>-<rep>/`.
- `head` = HEAD.
- `geom` = geometry plus width/fall constants with the OLD verge-pass logic.
- `full` = whole change, before the pole/post move.

| run | frantic contact | frantic departure (paint) | frantic desert | normal contact |
|---|---|---|---|---|
| head 1/2/3 | 0.13 / 0.37 / 0.31 | 0.24 / 0.27 / 0.21 | 5.3 / 5.9 / 6.2 | 0.02 / 0.13 / 0.06 |
| geom 1(4 seeds)/2 | 0.40 / 0.19 | 0.31 / 0.30 | 0.57 / 0.66 | 0.17 / 0.10 |
| full 1/2 | 0.68 / 0.45 | 0.38 / 0.36 | 0.34 / 0.22 | 0.24 / 0.16 |

An earlier 3-rep set (`/tmp/embankment/{before,after}{,-r2,-r3}`) gave frantic contacts 0.25 (HEAD) vs 0.56 (full), and normal contacts 0.06 vs 0.12.

Reading so far:
- **Geometry alone:** within HEAD's spread for contacts, but desert time is 0.6/min, not 0 — the old pass logic still steps past the shoulder.
- **Full change:** pushes contacts above HEAD's spread. So the new verge-pass behaviour is the likely main cause. Not proven: geom-3 and full-3 never ran.
- **Seed 42, full:** most contacts are a pile-up of frantic cars at s≈3040 in `make-room` / `recover` / `follow` (`/tmp/embankment/events-42-after.txt`, contacts start at line 62).
- **Prop touches:** HEAD also has them (head-1: 2, head-2: 2). The 2 seen in "after" are not proven new.

## Left to do, in order
1. Finish the A/B/C: geom-3 and full-3, then a full run with the pole/post move.
   - Recreate the worktrees as in `/tmp/embankment/abc.sh`: `git worktree add --detach /tmp/embankment/{head,geom,full} HEAD`, symlink `node_modules`, and copy the dirty files (`public/models/carforge/vaz1111.fbx`, `src/vehicle/model-fits.json`, `tools/traffic-road.ts`, `tools/frantic-pass.ts`).
   - `geom` = HEAD autopilot plus copies of `roadprofile.ts`, `roadmesh.ts`, `terrain.ts`, with three sed edits to `autopilot.ts`: import `SHOULDER_WIDTH_M, shoulderFallAt`; `overhangLimit = SHOULDER_WIDTH_M`; `SHOULDER_CROSS_FALL = shoulderFallAt(SHOULDER_WIDTH_M - 0.4)`.
   - The runner skips finished dirs.
2. Group contacts by manoeuvre (the "by manoeuvre:" lines) across head/geom/full. Find which new behaviour makes the extra `make-room` / `follow` / `bypass` contacts. Suspects:
   - Verge speed up to 130 km/h past a queue, then cutting in at a gap (`VERGE_CUT_IN_DECEL_MPS2 = 3`, the slot). The cars behind and the passed car brake.
   - `shoulderPassSooner`, which now prefers the verge over an open crossing.
   - Fix within the fixed geometry, e.g.:
     - a lower `vergeCeiling` relative to the passed car;
     - a larger cut-in slot;
     - not preferring the verge when the crossing is open.
3. Add an "off the drivable shoulder" departure count to `tools/traffic-road.ts` (body centre past paint + 2.5 m, or `desert`) and report it next to the old one.
4. Recheck `tools/verge-profile.ts` (pole feet at 4.5 m, posts at 3.2 m), the frantic-pass scenarios and the stream bench for prop touches.
5. Run `tools/traffic-bench.ts` twice. HEAD fails "far-side: hand-ins", and one "after" run failed "own-side: hand-ins" (3 impacts). Before-r2 shows HEAD repeating far-side; after-r2/r3 traffic-bench never ran.
6. Update the CHANGELOG entries with the final numbers and the pole/post move.

## Artifacts
- `/tmp/embankment/`:
  - `before/`, `after/`: full bench sets.
  - `*-r2`, `*-r3`: repeats.
  - `abc/`: A/B/C.
  - `summarize.py`, `benches.sh`, `checks.sh`, `reps.sh`, `abc.sh`.
  - Screenshots: `straight.png`, `straight-on-verge.png`, `bend.png`, `layby.png`, `junction.png`, `verge-pass-0..8.png`.
- `/tmp/frantic/`: the original shelved patch and the `before` set.
