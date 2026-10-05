# Bringing every car to the Fulvia standard: where we are

Read this first when resuming. Update it after every car and every decision.

## Goal (the owner's, 2026-10-06)

The Lancia Fulvia (commit c371071) is the quality bar: its body and every detail were
measured off a calibrated side photograph in metres, its glass is laid over the body
as exact outlines with chrome frames, its A-pillars stand where the photo has them. The
other 49 cars get the same treatment, body included, not only an automatic glass fit.
Defects the owner has seen in game must not survive a pass.

## How (the method)

- Per car: `tools/carshape/bp/RECIPE.md` (measure off the calibrated side photo, fix
  body, screen, glass, trim in the car file, build, look in the game renderer at every
  junction, iterate, document). One worker agent per car; the captain reviews its
  shots and commits per car.
- Machine limits (`.omp/rules/process-hygiene.md`): at most two workers at once; one
  game tab in the whole session, guarded by the lock directory `/tmp/carlab.lock`; one
  shared dev server on port 5199 (started by the captain, never by workers).
- Tools: `glassaudit.py` (shipped glass: slivers, folds, notches, closed pillars, all
  cars in 3 s), `sidecal.py` (side photo calibration), `tools/carshape/photosheet.py`
  (metric grid over a calibrated photo), `tools/carshape/overlay.py` (model silhouette
  over the photo), `build/carshape/av.sh`, `install.sh`, `dims.py`. assemble.py prints
  GLASS / PILLAR / GLASS-FAIL lines for laid-over glass; `GLASS_OVERLAY=1` trials it on
  any car without editing its file.

## Done

| Commit | What |
|---|---|
| c371071 | Fulvia to the standard; build stops on unread car-file keys (`KEYS`); glass checks |
| 8859c2b | glassaudit.py, sidecal.py |
| 4479bcb | Laid-over glass with automatic fit on 11 cars (glass only, bodies untouched): bj40 bmw2002 jeep mini moskvich412 niva uaz469 valiant vaz2101 w123 wartburg |

Survey data (in `build/`, NOT in git: kept on this machine only):
- `build/carshape/glassaudit.json`: glass audit of the installed bodies (before 4479bcb).
- `build/carshape/_audit/<car>.jpg` + `shots/`: 6 game-renderer close-ups per car (before 4479bcb).
- `build/carshape/_audit/triage.md`: hand triage of 19 cars (ae86..dacia, trabant..zaz968);
  the other 30 were not triaged (rate limit), the sheets and the audit cover them.
- Straight side photos: 37 cars; calibrated (`calib.json`): ae86 capri citroen2cv
  citroends civic datsun510 delta eagle falcon fiat124 fulvia mini mustang65 niva p504
  peugeot205 porsche911 renault4 renault5 saab96 sj410 skoda110r t2 trabant uaz469
  valiant vaz2101 vaz2108 volvo240 w123 wartburg zaz968. Volvo 240 (photo tyre 9 %
  big) and Eagle (shot from slightly above) are approximate.
- No acceptable straight side photo: bj40 bmw2002 c10 crx dacia escort foxgt hilux jeep
  leone moskvich412 panda4x4 (use the drawing and 3/4 photos). Photo folders also hold
  uncalibrated side photos for gaz21 giulia golf1 kafer landrover mx5.

## Status per car

Stage: `-` not started, `glass` automatic laid-over glass only, `wip` worker on it,
`review` worker done, captain to check, `done` committed to the standard.

| car | stage | notes |
|---|---|---|
| fulvia | done | the reference |
| valiant | wip | roof runs back like a limousine, shut lines off the pillars, thick A-pillar |
| zaz968 | wip | chrome strip over the windows, fat A-pillar, chamfered door glass |
| bj40 bmw2002 jeep mini moskvich412 niva uaz469 vaz2101 w123 wartburg | glass | body and trim still to do |
| ae86 c10 capri citroen2cv citroends civic crx dacia | - | triage: all have A defects (capri hatch glass, c10 bed/pillar, crx lamps, 2cv wing) |
| trabant volvo240 vaz2108 | - | triaged (trabant: boot groove, octagon screen, lamps) |
| datsun510 delta eagle escort falcon fiat124 foxgt gaz21 giulia golf1 hilux kafer landrover leone mustang65 mx5 p504 panda4x4 peugeot205 porsche911 renault4 renault5 saab96 sj410 skoda110r t2 | - | audit + sheets only |

Order: the worst first (triage A defects, then glassaudit score), two at a time.

## Resuming

1. `git log --oneline -5` and this table: which cars are `wip`/`review`. A `wip` car
   with uncommitted edits in `tools/carshape/bp/cars/<car>.py`: rebuild it
   (`build/carshape/av.sh <car>`, `install.sh`), look at it, then commit or redo.
2. Start the shared dev server (`npx vite --port 5199 --strictPort`), remove a stale
   `/tmp/carlab.lock`, give the next car to a worker with RECIPE.md.
3. After each car: review the worker's shots against the photos, commit car file +
   glb + model-fits.json, set the row to `done` here, commit this file.
