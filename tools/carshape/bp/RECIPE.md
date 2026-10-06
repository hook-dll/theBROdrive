# One car to the Fulvia standard

Repo /Users/y4/Documents/theBROdrive. Read first: `tools/carshape/bp/DEFECTS.md` (the last two Fulvia sections), `tools/carshape/bp/cars/fulvia.py` (the reference car file: every number in it is measured and commented), and the docstrings of `tools/carshape/bp/hull.py`, `assemble.py` (`glassOverlay`, `screenWrap`, `sectionKeys`, `glassFit`), `tools/carshape/bp/sidecal.py`, `tools/carshape/photosheet.py`, `tools/carshape/overlay.py`.

The standard: the body and every detail are measured off the real car's photographs in metres, not guessed, not tuned by eye against the previous build. Judge against the photos, never against "better than before".

## Inputs
- Photos: `build/carshape/_refs/photos/<car>/` — `side.jpg` straight side, `calib.json` its wheel calibration (if missing and side.jpg exists: calibrate with sidecal.py, see its docstring; if there is no straight side photo, use the drawing `build/carshape/_refs/bp/img/<image>` side view and the 3/4 photos, and say so).
- Known defects: `build/carshape/_audit/triage.md` (if your car is in it), the close-up sheet `build/carshape/_audit/<car>.jpg`, `build/carshape/glassaudit.json`.
- Car file `tools/carshape/bp/cars/<car>.py`, roster `src/vehicle/roster.ts` (model and YEAR: the photos must be that car).

## Measure
1. Metric grid over the side photo: `build/pyenv/bin/python tools/carshape/photosheet.py side build/carshape/_refs/photos/<car>/side.jpg /tmp/<car>-grid.png build/carshape/<car>/spec.json uF vF uR vR` (values from calib.json). Read lines off it in the car's metres (y along, nose -y; z up from ground). Zoom with PIL crops; do not guess sub-pixel things you cannot see.
2. Silhouette: `/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python tools/carshape/overlay.py -- public/models/carshape/<car>.glb build/carshape/<car>/spec.json build/carshape/_refs/photos/<car>/side.jpg /tmp/<car>-ov.png uF vF uR vR` draws the model's outline (magenta) and glass (blue tint) over the photo. Where the line leaves the car, the body is wrong there.

3a. Side by side: `build/pyenv/bin/python tools/carshape/bp/sidecmp.py <car>` writes
   `build/carshape/_audit/cmp/<car>.jpg`: photo, shaded model and outline at one scale,
   axles aligned. Compare window heads/feet, pillars, shut lines, row against row.
   Heights in a car file that ends with `scale_above(...)` are the drawing's: multiply
   the photo's z by top_from/top_to (Valiant 1.031); top-view outlines are not scaled.

## Fix (car file first; generator only for a fault that is clearly general, and then say so)
3. Body: top line (`topOverride`), belt, sill, nose/tail (`bodyEnds`, `face`), arches, roof width and drip rail, shoulder section (`sectionKeys` with a crisp ledge where the car has one: see Fulvia). Target: the overlay's outline on the photo's within ~1.5 cm along roof, screen, bonnet, deck, nose, tail, arches.
4. Screen: a wrap-round screen gets `screenWrap` (hull) so the shell's corner sits on the photo's pillar line (check: side rays, normal x crossing 0.5 within 1 cm of the line); then `tools/carshape/bp/screengen.py <car> <foot z> <head z> <pillar z:y,...>` prints the screen outline in plan. If the side glass behind the pillar bends (GLASS-FAIL), the corner is too round: lower `edgeY` (2 cm) and put the side glass's front edge where the wall is clean (normal x > 0.9). A flat screen gets its outline to the pillar.
5. Glass: `'glassOverlay': True, 'glassFit': False` in parts; every pane outline measured off the photo (pillar lines 5-7 mm inside the paint, frame tops, belt chrome, dividers, quarter lights), seal widths as the photo's chrome/rubber. Screens and back lights in plan or end view from the end photos/drawing. Must give 0 `GLASS-FAIL`; read the GLASS/PILLAR lines.
6. Trim the shots show wrong: shut lines traced off the photo (`'keep': True` on traced curves), mirror where the photo has it, handles, lamps/grille, wipers.

## Build and look
7. `build/carshape/av.sh <car>` (hull + assemble; prints GLASS/PILLAR/ENDS lines) then `build/carshape/install.sh <car>` and `build/pyenv/bin/python build/carshape/dims.py <car>` (must say `OFF []`). Run heavy steps with `nice -n 15`; never run two builds at once yourself.
8. Look in the game renderer. ONE game tab in the whole session: before opening the browser take the lock `mkdir /tmp/carlab.lock` (if it exists, another agent is rendering: wait, retry every 30 s with `sleep 30` in bash); release with `rmdir /tmp/carlab.lock` right after closing the tab. Never launch another browser (no puppeteer.launch, no tools/look/*.mjs, no labshots.sh/refsheet.sh: they launch their own Chrome). The dev server is already running at http://127.0.0.1:5199 — do not start or stop servers. In an eval cell: `tab = await browser.open({name: '<car>', url: 'http://127.0.0.1:5199/?car-lab&time=15', viewport: {width: 1200, height: 800}})`, wait until `window.__carLab` exists, then per shot `window.__carLab.closeUp('rs_<car>', [across, up, along], distance, azimuthRad, elevationRad); window.__carLab.capture(); return window.__carLab.capture()` (a PNG data URL; second capture is the settled one; `along` has the nose at +). Shoot both sides: A-pillar high and low, side, rear quarter, tail, nose, and close-ups of every glass junction; compare each with the photos at full size. `await tab.close()` when done.
9. Iterate 3-8 until nothing visible is wrong against the photos. Small smooth surface waves are acceptable (clay finish); folds, tears, wrong shapes, wrong heights, floating parts are not.

## Deliver
10. Comments in the car file say what each number was measured from (as Fulvia's do). Add a short dated section to `tools/carshape/bp/DEFECTS.md` (what was wrong, what fixed it, anything still open). Do NOT commit; the captain reviews and commits.
11. Report: what changed, overlay fit (cm) per region before/after, GLASS-FAIL count, dims, paths of your final shots (save them to `build/carshape/_audit/done/<car>-*.png`), and anything still open or uncertain. Be honest about what you did not verify.
