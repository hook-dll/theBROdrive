# carforge

Builds a low-poly car FBX from a compact spec. Pipeline entry points:

- `carforge.py` — spec → FBX (`-- <spec.json> <out.fbx> [--wheel-fbx] [--summary <file>]`).
- `render.py` — FBX → PNG views (`-- --fbx <file> --albedo <png> --prefix <path> --size W H`; writes `_side`, `_front`, `_rear`, `_top` (orthographic, each with a `.json`: mm per px, centre, image axes), `_q`, `_qrear`, `_wire`; prints `EXTENT x y z`).
- `trace.py` — line drawing → pixel blueprint, no hand tracing (plain Python + OpenCV; `<sheet.json> <blueprint.json>`; see "Automatic trace").
- `fit_blueprint.py` — traced pixel blueprint → spec (plain Python).
- `fit_mesh.py` — existing FBX/GLB → spec (Blender script; `-- --in <fbx> --out <json> --id <id>`).
- `fairness.py` — surface check of a built body (Blender script; `-- --fbx <file> [--prefix <path>] [--json <file>]`): counts folds (non-planar quads), ripples (a gentle bend reversed within 700 mm along a section profile) and slivers; writes a defect map (`_fair_*`) and a glossy matcap render (`_shine_*`). A body is clean at 0 folds, 0 ripples.
- `compare.py` — a render over the traced drawing at the blueprint's scale, in one view (plain Python + Pillow; `--blueprint <json> --drawing <img> --render <render.py prefix> --out <png> [--view side|front|top|rear]`, default side).
- `examples/` — hand-written specs (`uaz3151.json`, `vaz2101.json`, `bmw_e46.json`), `blueprint_uaz3151.json` (pixel input for `fit_blueprint.py`) and `sheet_uaz3151.json` (input for `trace.py`).

Run Blender jobs one at a time, under `nice -n 15`:
`nice -n 15 /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python SCRIPT -- args`

## Frame and units

- All spec values are millimetres.
- y runs rearward from the front-axle centre (front of car is negative y).
- z runs up from the ground plane (wheels rest at z = 0).
- x runs to the car's left (positive x = left, mirrored features are symmetric about x = 0).

## Spec schema

| Key | Type | Units / frame | Meaning |
|---|---|---|---|
| `id` | string | — | Object name prefix (`<id>.body`, `<id>.body.<role>`, `wheel_fl` etc.). |
| `wheels.radius` | number | mm, tyre outer radius | Wheel radius. |
| `wheels.width` | number | mm | Tyre width. |
| `wheels.track_front` / `track_rear` | number | mm, wheel-centre to wheel-centre | Track width per axle. |
| `wheels.wheelbase` | number | mm, front axle to rear axle | Axle spacing. |
| `wheels.arch_front` / `arch_rear` | number | mm | Wheel-arch cut radius. |
| `wheels.well` | number | mm, optional | Extra arch-well depth. |
| `side.top` | [[y,z], …] | mm, ≥ 2 points | Roof/silhouette top profile. |
| `side.bottom` | [[y,z], …] | mm, ≥ 2 points | Sill/underbody bottom profile. |
| `side.shoulder` | [[y,z], …] | mm, ≥ 2 points | Shoulder line where plan width changes. |
| `plan.low` | [[y,half_width], …] | mm, ≥ 2 points | Body half-width below the shoulder. |
| `plan.high` | [[y,half_width], …] | mm, ≥ 2 points | Body half-width above the shoulder (greenhouse). |
| `tumblehome` | [[z,factor], …] | mm / unitless | Inward taper of the upper body; factor 1.0 = no taper. |
| `belt` | number | mm, z of beltline | Belt height. Required. |
| `glass_top` | number | mm, z of top of side glass | Required. |
| `windscreen` | [y0, y1] | mm | Windscreen span along y. |
| `backlight` | [y0, y1] | mm | Rear window span along y. |
| `windows` | [{y:[a,b], outline?, round?}, …] | mm | Side windows, each a pocket cut 12 mm into the greenhouse side (glass floor, dark seal walls). `outline`: traced [[y,z], …] corners (slanted pillars); without it the window runs belt→glass top and drops under the rail. `round`: corner radius (default 40). |
| `seams` | [[[y,z], …], …] | mm | Side panel gaps: same as `grooves` with face `side`. |
| `grooves` | [{face, line, closed?, width?, depth?, single?}] | face coords (below) | Panel gaps: a V 18 mm wide, 12 mm deep folded into the paint, as the pack does its door gaps (one swept wedge per line, square to the surface; side gaps stop above the sill chamfer). |
| `lines` | [{face, line, closed?, width?, cell?, single?}] | face coords | Drawn ribbons 3 mm proud, for what is painted rather than cut: bonnet ribs, fuel flaps. |
| `recesses` | [{face, x\|y, z, radius?, round?, depth?, cell, bars?, single?}] | face coords | Pockets with a flat floor in `cell`: windscreen and back-light glass, grille openings. `radius` rounds the corners (half the height = stadium). `bars: {count, width, cell}`: grille bars standing in the pocket. |
| `arches` | {front\|rear: {outline, lip?, flare?}} | mm | Arch opening edge in side view (default: semicircle of `arch_front`/`arch_rear`), with a lip `lip` mm wide standing `flare` mm proud. |
| `nose` / `tail` | {bulge, inset} | mm | Bulged end: the last station stands `bulge` inside the end, a band rolls in by `inset` to the end face. |
| `fair_tol` | number | mm, default 12 | Trace noise below this is dropped from the side/plan curves (Douglas-Peucker). |
| `bumpers` | [{y, z, half_width, cell, chamfer, channel?, lip?}] | y, z: [lo,hi] mm; half_width mm; cell: atlas material name; chamfer mm | Bumper boxes at the nose/tail. `channel`: the outer face is a channel that deep between `lip`-tall lips. |
| `mirrors` | [{x, y, z, cell, chamfer?}] | mm boxes, mirrored to the right | Wing mirror heads and arms. |
| `plates` | [{face, x\|y, z, cell, round, radius, proud?, single}] | face coords | Blocks standing on a face: number plate, door handles, hinges. |
| `lamps` | [{role, face, x\|y, z, round, segments, single, bezel?, dome?, rim?}] | face coords; face `front`/`rear`/`side` | Lamp boxes. `role` must be a key of `LAMP_CELL` in carforge.py (`headlights`, `leftblinkers`, `rightblinkers`, `taillights`, `reverselights`); a side blinker becomes left/right by its side. `dome`: a chrome rim (`rim` mm proud) round a lens bulging `dome` mm, like the pack's headlamps. `bezel`: the lamp sits in a pocket that much wider. |
| `spare` | {y, z} | mm | Spare-wheel position (optional). |

Face coordinates (mm): `front`/`rear` (x, z); `side` (y, z) on the left side, mirrored to the right; `top` (y, x). Items are mirrored across the car unless `single`; every item is probed onto the body along its face's axis.

`validate()` in carforge.py rejects specs missing `id`, `wheels` (radius, width, track_front, track_rear, wheelbase), `side.top/bottom/shoulder` (≥ 2 points), `plan.low/high` (≥ 2 points), `belt`, `glass_top`, unknown lamp roles, and lamp faces other than `front`/`rear`/`side`.

## Rules the generator enforces

Taken from the owner's reviews, so the next car does not need the same corrections by hand:

1. **Glass follows its pillar.** `windows[].pillar: "a"|"c"` turns the window's front (rear) edge parallel to the body's A (C) pillar from the traced silhouette, pivoting on its bottom corner.
2. **A door edge follows the glass it frames.** A line point `{edge: [window, "front"|"rear"], offset, z}` expands to a segment parallel to that window edge, `offset` mm along y (the frame's width).
3. **Details do not sit on each other** (`check_layout`, run before the build): lamps, plates, recesses and side windows keep 8 mm plus the gap's half width from every panel gap and do not overlap each other; a closed gap (a fuel flap) keeps clear of every other gap; being inside a door outline is fine; a `straddle` plate (a hinge) may cross gaps. The build fails with every clash listed.
4. **Panel gaps never cut the body's edge:** side gaps stop above the sill chamfer; arch lips end above it with their flare run out.

## Blueprint input (`fit_blueprint.py`)

Input is a traced side (and optionally front) blueprint in pixels. Keys:

- `id`, `source` (text note).
- `scale`: `mm_per_px`, `y0_px` (px column of front axle), `z0_px` (px row of ground), `x0_px` (px column of car centre-line for front view). Optional view anchors used only by `compare.py`: `top_x0_px` (top view centre row; the top view's columns are the side view's), `rear_x0_px` (rear view centre column), `deskew` `{deg, centre}` (the rotation `trace.py` applied to the scan; `compare.py` rotates the drawing the same way).
- `side.top`, `side.bottom`, `side.shoulder`: `[[px,py], …]`.
- `plan.low`, `plan.high`: `[[px, half_width_px], …]`.
- `tumblehome`: `[[py, factor], …]`.
- `belt`, `glass_top`: py.
- `windscreen`, `backlight`: `[px0, px1]`; `windows`: `[[px0, px1], …]` or `{outline, round?, pillar?}` (flags copied).
- `lamps`: front lamps in px (`circle [cx,cy,r]` or `rect [x0,y0,x1,y1]`), rear lamps in mm (`x`, `z`).
- `wheels`, `bumpers`, `mirrors`, `plates`, `spare`: already in mm, copied through.

Mapping: y = (px − y0)·mm_per_px; z = (z0 − py)·mm_per_px; x = (px − x0)·mm_per_px.
`examples/blueprint_uaz3151.json` round-trips exactly to `examples/uaz3151.json`.

## Automatic trace (`trace.py`)

```
python3 tools/carforge/trace.py tools/carforge/examples/sheet_uaz3151.json build/carforge/trace/blueprint.json
python3 tools/carforge/fit_blueprint.py --in build/carforge/trace/blueprint.json --out build/carforge/trace/spec.json
nice -n 15 $BLENDER --background --factory-startup --python tools/carforge/carforge.py -- build/carforge/trace/spec.json build/carforge/trace/car.fbx
nice -n 15 $BLENDER --background --factory-startup --python tools/carforge/render.py -- --fbx build/carforge/trace/car.fbx --prefix build/carforge/trace/render
for v in side front top; do python3 tools/carforge/compare.py --blueprint build/carforge/trace/blueprint.json \
    --drawing build/carforge/refs/uaz_blueprint.gif --render build/carforge/trace/render --view $v \
    --out build/carforge/trace/overlay_$v.png; done
```

The sheet is the only manual input:

| Key | Meaning |
|---|---|
| `id`, `source` | Copied to the blueprint. |
| `image` | The drawing: dark lines on a light ground, one scale for every view. |
| `wheelbase_mm` | The one known dimension; sets the scale. |
| `views` | `{side, front?, top?, rear?}`: `[x0, y0, x1, y1]` px box of each view in the image. One view per box; keep dimension lines that would close a loop with the car (an arrowed height dimension beside the roof) outside it. The top view must sit under the side view with its columns aligned. A top view is required (plan widths); without a front view the track must come from `extras.wheels`. |
| `extras` | Values the drawing does not give, copied into the blueprint: `wheels` (`width`, `well`; anything here overrides the traced wheel values), `arches.front/rear` (`lip`, `flare`), `bumpers`, `mirrors`, `plates`, `lamps` (mm form), `nose`, `tail`, `spare`, `recesses` (windscreen and back-light glass, grilles), `grooves`, `lines`, `seams`. The UAZ sheet copies these from `examples/uaz3151.json`, leaving out its door seams/grooves, grille recesses and bonnet ribs. |

What is measured, in order (the module docstring and each function's docstring hold the exact rules):

1. **Wheels and scale.** `cv2.HoughCircles` (gradient-alt) in the side box; every candidate is refitted by least squares on the ink's distance map, and the outermost ring inked round ≥ 85 % of its length about that centre is the tyre. The pair of equal tyres on one row with the largest radius are the wheels: scale = wheelbase / hub distance, ground row = hub row + tyre radius, tyre radius → `wheels.radius`.
2. **Deskew.** If the two hubs are not on one row the scan is rotated about the front hub until they are, and the wheels are refitted (`scale.deskew`). The UAZ scan is turned 0.47° (the top view's centre line and axis lines confirm it).
3. **Silhouettes.** Per view, the pixels not reachable from the box border through non-ink (ink grown by a pixel to close gaps, the mask shrunk back), cut at the hub row + 0.75 tyre radius so the ground line and hatching never close a loop, then opened by 3 px to drop thin lines (extension lines, axis lines).
4. **Body ends.** The columns where the side silhouette stands ≥ 50 % of the car's height (drops a low bumper) and the top view is ≥ 60 % of its widest (drops a spare wheel carried behind), trimmed to stop where an extras bumper box begins.
5. **`side.top`**: the silhouette's first row per column, spikes narrower than 60 mm opened away.
6. **`side.bottom`**: down each column outside the wheel discs, the lowest clear (ink-free) run ≥ 70 mm tall is body side and the ink band under it is the sill; its lower edge is the underside. Chassis parts (frame rails, springs, exhaust) are lines with short gaps, so they are skipped. A 21-column median per stretch (front overhang, between the wheels, rear overhang); nothing hangs more than 1 px below the median sill between the wheels; within 200 mm of an extras bumper box an underside still below the box's top is put at the box's top (the bumper hides the body there).
7. **Plan (top view)**: centre row = median mid-point of the silhouette columns (`top_x0_px`). `plan.low` = half-width of the filled run through the centre row, both sides averaged, with a 250 mm grey opening that removes the mirrors. `plan.high` = the outermost line drawn symmetrically about the centre row, 6 px or more inside `low` and outside 60 % of it (bonnet edge, roof gutter), opened the same way, capped at the front view's half-width at the belt (the gutter stands out past the glass).
8. **Front view**: the track and the centre column from the tyres (under the axle, clusters of vertical lines spanning 0.3-1.2 tyre radii; lone extension and centre lines are not tyres). Half-width per row of the run through the centre column, mirror arms and brackets removed by an 80 mm grey opening. `tumblehome` = half-width / half-width at the belt, from the belt up to where it falls under 0.9. `shoulder` = the first row under the belt where the half-width is past half-way from the belt's to the body's widest.
9. **Windows**: background regions inside the side silhouette that are ≥ 120 mm thick, ≥ 12 % of the car's height tall, end above roof + 55 % of the height and have holes of at most a quarter of their area; regions under 50 mm apart (a divider, a seat or wiper line) merge. Each window's frame is the ink within 4 px of its glass; what that encloses is the window. Its four sides are supporting lines through the outermost pixels (a seat or box against the frame only pushes points inward), front and rear fitted on the rows 12-55 % down the glass, where no dash or seat is. `round` = median corner radius from the gap between the sharp corner and the glass; the first window gets `pillar: "a"` when its front edge leans back, the last `pillar: "c"` when its rear edge leans forward. `belt`/`glass_top` = median window bottom/top.
10. **Arches**: the non-ink gap between the tyre and the fender (the region hugging the tyre's upper half, outside the disc, above the underside line); the first ink above it per column is the arch edge. Where the gap pinches shut, the end segment's slope runs on to 3 px below the underside. `wheels.arch_front/rear` = the edge's height over the hub.

All polylines are Douglas-Peucker simplified at 1.2 px. `TRACE {...}` reports the measured scale, hubs, track, extents, belt/glass rows and window spans.

Checks: `render.py` writes orthographic `_side`, `_front`, `_rear` and `_top` with their `.json`, and `compare.py --view` places each by the blueprint's anchors (side `y0_px`/`z0_px`, front `x0_px`/`z0_px`, rear `rear_x0_px`/`z0_px`, top `y0_px`/`top_x0_px`). The render and the drawing share orientation in every view: the top view has the nose left and the car's left side at the bottom (first-angle, under the side view). The rear check has no drawing to run on yet.

Known limits of the trace:

- Body side is a vertical wall below the shoulder in the schema, so a flared lower body (the UAZ wings) cannot follow the front view; the arch lip `flare` from `extras` stands on top of `plan.low`, which the top view already measures across the flares (UAZ render 25-40 mm wide at the wheel arches in the front and top views).
- The body ends come from the extras bumper boxes when the drawing's bumper or spare would otherwise be taken as body; with no bumper in `extras` a full-width bumper in the top view counts as body.
- `side.bottom` in an overhang is mostly the bumper rule; between the wheels it needs a drawn sill line with a clear panel above it.
- An arch gap crossed by a mud flap or spring ends there; the run-out then follows the last slope, not the drawn fender (UAZ rear arch: opening 20 px short at the sill behind the wheel).
- Windows are quadrilaterals; a window with a cut corner or a curved edge loses it. A seat drawn against the upper half of a frame edge would still tilt that edge.
- The front view's own ground line sits 3-4 px above the side view's tyre bottoms on the UAZ scan (after deskew); `z0_px` comes from the side view and is used for both.
- Shoulder, belt and tumblehome are single values or one profile for the whole car (schema).

## FBX conventions

- Output is in metres: the spec's mm × 0.001 (Blender units ×1000 = mm).
- Axis: `axis_forward` −Z, up Y in the exported file; node rotation 0.
- Nose at −Y (spec frame), so the car faces −Y in the scene.
- Wheels named `wheel_fl`, `wheel_fr`, `wheel_bl`, `wheel_br` (use `--wheel-fbx` to export separately).
- Lamp objects named `<id>.body.<role>`; glass is atlas cell (3,1); lamp atlas cells: head (8,1), tail (5,1), blinker (7,1), reverse (8,1).
- Atlas: 9 × 2 cells.

## Mesh fitting (`fit_mesh.py`)

1. Wheels: exactly four objects whose name contains "wheel". Lamps: objects tagged by `lamp_role`. Body: the rest.
2. Glass: atlas cell (3,1) in the packed texture, or material name matching `glass|window` for glTF.
3. Spec frame: y rearward from front-axle centre, z above wheel ground; x sign chosen so the front is at −y.
4. End trim (neither paint nor glass, outer 12% of length) grouped by connectivity: low wide groups reaching the end → `bumpers` (excluded from slicing), end-facing groups → `plates`.
5. 41 stations along y, 0.5% inside the ends, the end stations moved to the true ends. Shoulder is the largest 20 mm inward half-width step between 25% and 85% of height (else the belt), median-smoothed; on bonnet/boot slices `plan.high` is measured at the rail height; widths median-of-3.
6. Windows: each connected pane of left side glass (overlapping panes merged), outline = its hull in side view. `belt`/`glass_top`: medians of side glass z-min/z-max.
7. Windscreen/backlight: roof-slope glass (normal z > 0.2), envelope ± 60 mm.
8. Lamps → `single: true` boxes at their measured position. `fair_tol` 15.

Prints `FIT {...}` with length, width, height, wheelbase, track, belt, glass_top, window/bumper/plate counts.

## Known limits

- VAZ-2101 and BMW E46 ports are approximations: the old schema had no per-y body half-width, belt or glass top. Those values are estimates (noted in each file's `source`).
- Rear-face lamps in the UAZ blueprint are given in mm (rear view not traced).
- Generated mesh-fit paint is flat; a window outline is the convex hull of its glass.
- Fitted widths: vz01 about 3% and vz21 about 3% under the original (mirrors and trim are not in the body).
- No per-y belt in the schema: belt is a single value.
- Grille depth is lost (plates are flat).

## Surface fairness (why the old bodies rippled)

Waves and accordion folds came from the station grid, not the trace:
- rows the station did not reach were pressed onto the roof line at a jump, so a row popped out
  between two stations and the quad between them folded (A/C pillars, bonnet edge);
- filler stations every 260 mm plus pixel noise in the trace gave many slightly twisted strips,
  and the game triangulates a twisted quad along an arbitrary diagonal → alternating creases;
- the belt lip faded in and out under the bonnet; face hint normals were tested before being computed.

Fixes: the ring is monotone (pressed rows move continuously, greenhouse rows stay on the
tumblehome), stations go exactly where a row emerges or the lip ends, no filler stations,
curves faired by `fair_tol`, every non-planar quad split along its convex diagonal.
`fairness.py` on the three examples: UAZ 18 folds / 59 ripples → 0 / 0; VAZ-2101 10 / 6 → 0 / 1
(one 2-6° bend pair at the C-pillar base); BMW 34 / 16 → 0 / 0.

## Status (2026-10-09) and what is next

Done: fair shell (above); traced UAZ arches (flat-topped trapezoids) with a flared lip; side
windows as recessed pockets with traced slanted pillars and rounded corners; door seams; nose
bulge and recessed headlamp bezels. `fit_mesh.py` now finds bumpers (boxes, left out of the
slices), grille plates, window outlines (glass hull per pane) and keeps the true end length.
UAZ body ~3100 tris.

Next:
1. `fit_mesh.py` bodies still ripple (vz01 59, gz24 53, vz21 146 by `fairness.py`): facet noise in
   the slices; the shoulder detector flips between the belt and a step on vz21.
2. `trace.py` traces outlines, windows and arches without hand work (see "Automatic trace");
   still hand-only: door seams, grille recesses, lamps. Overlays: `build/carforge/trace/overlay_{side,front,top}.png`.
3. Rear face detail (tail lamp bezels, door seam), grille relief.
4. Game integration: a `carmodels.ts` def for the generated UAZ (drivetrain can reuse
   `engine_umz_4213` / `gearbox_uaz_4`).
