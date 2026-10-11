# carforge

Builds a low-poly car FBX from a compact spec. Pipeline entry points:

- `carforge.py` — spec → FBX (`-- <spec.json> <out.fbx> [--wheel-fbx] [--summary <file>]`).
- `render.py` — FBX → PNG views (`-- --fbx <file> --albedo <png> --prefix <path> --size W H`; writes `_side`, `_front`, `_rear`, `_top` (orthographic, each with a `.json`: mm per px, centre, image axes), `_q`, `_qrear`, `_wire`; prints `EXTENT x y z`).
- `trace.py` — line drawing → pixel blueprint, no hand tracing (plain Python + OpenCV; `<sheet.json> <blueprint.json>`; also writes `<blueprint>.trace_report.json`, the details taken and the candidates dropped; see "Automatic trace").
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
| `grooves` | [{face, line, closed?, width?, depth?, single?}] | face coords (below) | Panel gaps: a V 14 mm wide, 10 mm deep folded into the paint, as the pack does its door gaps (one swept wedge per line, square to the surface; side gaps stop above the sill chamfer and below the roof or bonnet line, so one that must reach the A pillar's foot joins it below the cowl). |
| `lines` | [{face, line, closed?, width?, cell?, single?}] | face coords | Drawn ribbons 3 mm proud, for what is painted rather than cut: bonnet ribs, fuel flaps. |
| `recesses` | [{face, x\|y, z, radius?, round?, depth?, cell, bars?, single?}] | face coords | Pockets with a flat floor in `cell`: windscreen and back-light glass, grille openings. `radius` rounds the corners (half the height = stadium). `bars: {count, width, cell}`: grille bars standing in the pocket. |
| `arches` | {front\|rear: {outline, lip?, flare?}} | mm | Arch opening edge in side view (default: semicircle of `arch_front`/`arch_rear`), with a lip `lip` mm wide standing `flare` mm proud. |
| `nose` / `tail` | {bulge, inset} | mm | Bulged end: the last station stands `bulge` inside the end, a band rolls in by `inset` to the end face. |
| `fair_tol` | number | mm, default 12 | Trace noise below this is dropped from the side/plan curves (Douglas-Peucker). |
| `chords` | {top\|bottom\|shoulder: [[y0, y1], …]} | mm | The side line runs straight from y0 to y1, the traced points between dropped: for what the drawing shows and the car does not (the UAZ sheet's step across the bonnet). |
| `bumpers` | [{y, z, half_width, cell, chamfer, channel?, lip?}] | y, z: [lo,hi] mm; half_width mm; cell: atlas material name; chamfer mm | Bumper boxes at the nose/tail. `channel`: the outer face is a channel that deep between `lip`-tall lips. |
| `mirrors` | [{x, y, z, cell, chamfer?}] | mm boxes, mirrored to the right | Wing mirror heads and arms. |
| `chassis` | [{x, y, z, cell?, chamfer?, single?}] | mm boxes, mirrored to the right unless `single` | Running gear seen under the body: frame rails, axle beams, differential housings. The lowest one sets the body's ground clearance in the game (the loader fits the body box between `clearance` and `height`), so a body without an underbody of its own needs them. |
| `plates` | [{face, x\|y, z, cell, round, radius, proud?, single}] | face coords | Blocks standing on a face: number plate, door handles, hinges. |
| `lamps` | [{role, face, x\|y, z, round, segments, single, bezel?, dome?, rim?, proud?}] | face coords; face `front`/`rear`/`side` | Lamp boxes. `role` must be a key of `LAMP_CELL` in carforge.py (`headlights`, `leftblinkers`, `rightblinkers`, `taillights`, `reverselights`); a side blinker becomes left/right by its side. A lamp's lens is flat, `proud` (8) mm off the outermost point of the face under it, so a crease under a lamp never shows through it. `dome`: a chrome rim (`rim` mm proud) round a lens bulging `dome` mm, like the pack's headlamps; the rim is built into the body, the lens alone is the lamp object, because the game lights a lamp object whole. `bezel`: the lamp sits in a pocket that much wider. |
| `spare` | {y, z} | mm | Spare-wheel hub (optional): its own object `<id>.spare` (the pack wheel), which the game replaces with a wheel of the car's own set (`spareNode` in `src/vehicle/carmodels.ts`). |

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
    --drawing tools/carforge/examples/uaz3151_drawing.gif --render build/carforge/trace/render --view $v \
    --out build/carforge/trace/overlay_$v.png; done
```

The same build is the game's UAZ-31512 (`cf_uaz31512` in `src/vehicle/carmodels.ts`). To ship a
change to it, copy the FBX over the game's and re-measure its fit:

```
cp build/carforge/trace/car.fbx public/models/carforge/uaz31512.fbx
bun tools/fit-models.ts cf_uaz31512
bun tools/reality.ts cf_uaz31512
```

The game loads it the way it loads the Soviet pack (FBX, the pack's `albedo.png` atlas, glass in
cell (3, 1), paint in (0, 0)); the node names come from the sheet's `id` (`uaz31512body`,
`uaz31512bodyheadlights`, `uaz31512wheel_fl`, …), so renaming the sheet renames them in the
catalogue entry too.

The sheet is the only manual input:

| Key | Meaning |
|---|---|
| `id`, `source` | Copied to the blueprint. |
| `image` | The drawing: dark lines on a light ground, one scale for every view. |
| `wheelbase_mm` | The one known dimension; sets the scale. |
| `views` | `{side, front?, top?, rear?}`: `[x0, y0, x1, y1]` px box of each view in the image. One view per box; keep dimension lines that would close a loop with the car (an arrowed height dimension beside the roof) outside it. The top view must sit under the side view with its columns aligned. A top view is required (plan widths); without a front view the track must come from `extras.wheels`. |
| `extras` | Values the drawing does not give, copied into the blueprint after the traced items: `wheels` (`width`, `well`; anything here overrides the traced wheel values), `arches.front/rear` (`lip`, `flare`), `bumpers`, `mirrors`, `chassis`, `plates`, `lamps` (mm form), `nose`, `tail`, `spare`, `recesses` (windscreen and back-light glass), `grooves`, `lines`, `seams`, `chords`. The UAZ sheet keeps only what the trace cannot find: bumpers, mirrors, the chassis under the body (with the brackets that carry the front bumper), spare, nose, the chord over the bonnet, the rear face (rear door outline and hinges, handle, lamps, back light), the doors' tops and bottoms and the front door's edge up the A pillar (door tops along the roof are level lines the trace drops), the windscreen and the side blinker; door gaps, hinges, handles, the fuel flap, the grille, the front lamps and the bonnet ribs come from the drawing (see "Details"). |

What is measured, in order (the module docstring and each function's docstring hold the exact rules):

1. **Wheels and scale.** `cv2.HoughCircles` (gradient-alt) in the side box; every candidate is refitted by least squares on the ink's distance map, and the outermost ring inked round ≥ 85 % of its length about that centre is the tyre. The pair of equal tyres on one row with the largest radius are the wheels: scale = wheelbase / hub distance, ground row = hub row + tyre radius, tyre radius → `wheels.radius`.
2. **Deskew.** If the two hubs are not on one row the scan is rotated about the front hub until they are, and the wheels are refitted (`scale.deskew`). The UAZ scan is turned 0.47° (the top view's centre line and axis lines confirm it).
3. **Silhouettes.** Per view, the pixels not reachable from the box border through non-ink (ink grown by a pixel to close gaps, the mask shrunk back), cut at the hub row + 0.75 tyre radius so the ground line and hatching never close a loop, then opened by 3 px to drop thin lines (extension lines, axis lines).
4. **Body ends.** The columns where the side silhouette stands ≥ 50 % of the car's height (drops a low bumper) and the top view is ≥ 60 % of its widest (drops a spare wheel carried behind), trimmed to stop where an extras bumper box begins.
5. **`side.top`**: the silhouette's first row per column, spikes narrower than 60 mm opened away.
6. **`side.bottom`**: down each column outside the wheel discs, the lowest clear (ink-free) run ≥ 70 mm tall is body side and the ink band under it is the sill; its lower edge is the underside. Chassis parts (frame rails, springs, exhaust) are lines with short gaps, so they are skipped. A 21-column median per stretch (front overhang, between the wheels, rear overhang); nothing hangs more than 1 px below the median sill between the wheels; within 200 mm of an extras bumper box an underside still below the box's top is put at the box's top (the bumper hides the body there).
7. **Plan (top view)**: centre row = median mid-point of the silhouette columns (`top_x0_px`). `plan.low` = half-width of the filled run through the centre row, both sides averaged, with a 250 mm grey opening that removes the mirrors. `plan.high` = the outermost line drawn symmetrically about the centre row, 6 px or more inside `low` and outside 60 % of it (bonnet edge, roof gutter), opened the same way, capped at the front view's half-width at the belt (the gutter stands out past the glass). Under each arch the top view's outline is the arch lip's edge, and carforge stands the lip `flare` mm proud of `plan.low`; so `plan.low` there is the outline less the lip's flare profile (`lip_flare()`: full flare over the opening, run out over 80 mm of the outline at its ends and across the `lip` band, as carforge builds it), but no further in than the body line bridged across the arch (see "Known limits"). `TRACE` prints the cut (`arch_lip_cut_mm`) and how far the drawn outline stands past the body line bridged across the arch (`arch_drawn_proud_mm`).
8. **Front view**: the track and the centre column from the tyres (under the axle, clusters of vertical lines spanning 0.3-1.2 tyre radii; lone extension and centre lines are not tyres). Half-width per row of the run through the centre column, mirror arms and brackets removed by an 80 mm grey opening. `tumblehome` = half-width / half-width at the belt, from the belt up to where it falls under 0.9. `shoulder` = the first row under the belt where the half-width is past half-way from the belt's to the body's widest.
9. **Windows**: background regions inside the side silhouette that are ≥ 120 mm thick, ≥ 12 % of the car's height tall, end above roof + 55 % of the height and have holes of at most a quarter of their area; regions under 50 mm apart (a divider, a seat or wiper line) merge. Each window's frame is the ink within 4 px of its glass; what that encloses is the window. Its four sides are supporting lines through the outermost pixels (a seat or box against the frame only pushes points inward), front and rear fitted on the rows 12-55 % down the glass, where no dash or seat is. `round` = median corner radius from the gap between the sharp corner and the glass; the first window gets `pillar: "a"` when its front edge leans back, the last `pillar: "c"` when its rear edge leans forward. `belt`/`glass_top` = median window bottom/top.
10. **Arches**: the non-ink gap between the tyre and the fender (the region hugging the tyre's upper half, outside the disc, above the underside line); the first ink above it per column is the arch edge. Where the gap pinches shut, the end segment's slope runs on to 3 px below the underside. `wheels.arch_front/rear` = the edge's height over the hub.
11. **Details** (below).

All polylines are Douglas-Peucker simplified at 1.2 px. `TRACE {...}` reports the measured scale, hubs, track, extents, belt/glass rows, window spans, the arch lip cut and the number of details; then two tables follow (`DETAILS taken`: view, kind, position in mm, evidence; `DETAILS dropped`: view, kind, position, reason), also written to `<blueprint>.trace_report.json` (`build/carforge/trace/blueprint.trace_report.json`).

### Details

The small body details are found on the drawing itself. A detail is taken only on strong evidence: a drawn line or closed outline of a plausible size for its kind, in the right region, with its partner where it has one. Everything that looked like a detail and failed a rule is dropped into the report with the rule it failed. Nothing inside the side windows (the window quads grown 2 px) is ever a candidate: seats, the steering wheel and the mirror stalk behind the glass are counted (`note: side: N closed shapes inside the window glass ignored`) and skipped; the front view looks only between the bumper's top and the belt (the windscreen with its wipers and steering wheel is above it); bonnet ribs only ahead of the first window.

Every rule is relative, so it is meant for any drawing, not the UAZ: sizes and distances are fractions of the wheelbase (`*_WB` constants in `trace.py`; the wheelbase is the one dimension every sheet gives) or multiples of the drawing's own line width (`*_LW`; `stroke_width()` = the median length of the ink runs across rows and columns, 2 px on the UAZ scan). Positions are taken against traced features: the belt, shoulder and sill rows, the window outlines, the wheel discs, the arch outlines, the front and top centre lines, the bumper's top. The sizes below are quoted in mm and px **at the UAZ's scale** (wheelbase 2380 mm, line width 2 px) for reading; the code holds the fractions.

Shapes: thin drawn lines are found as Hough seeds refitted to their ink (one sample per row, so a box edge touching the line does not tilt it), followed while ink continues (breaks ≤ 3 px: the scan dithers thin lines) and merged when collinear (ends within 2 px of the longer line's line); a steep line may bridge an 80 mm break (a hinge box interrupts it), a level one may not. Closed shapes are background regions enclosed by ink ("holes") and ink pieces touching nothing else ("blobs"), ink first closed by one pixel.

| Kind (blueprint key) | Taken when | Emitted |
|---|---|---|
| Door / panel gap (`seams`, px) | A chain of straight drawn lines inside the body side, outside the glass, whose lower end is within 25 mm of the sill line and whose upper end is at the belt or higher (no lower than 15 % of the belt-to-sill height under the belt): it crosses the side. A chain bends only where a line ENDS (within 50 mm of the bend) near the other's end (within 100 mm) and rises ≥ 100 mm above the bend: a corner, not a crossing. All of it ≥ 100 mm inside the body's ends. Of chains reaching as high, the one with fewer bends. | The drawn polyline (top to sill); carforge's default 18 mm V, stopped above the sill chamfer and under the rail. Evidence lists a parallel gap 2-12 px away (the two door edges either side of a pillar) and the hinges on it. |
| Hinge (`plates`, paint, `straddle`) | A hole 30-110 mm a side, ≤ 2:1, filling ≥ 75 % of its bounds (a box), ≥ 60 % of its rim its own (not on a long line other than the gap), a taken gap passing through it, between the belt and the sill, and a second such box on the same gap (a door hangs on two). | The box (outline centre) in mm, `proud` 12. |
| Handle (`plates`, steel) | A blob 100-300 x 20-80 mm, ≥ 2.5:1, enclosing something (a closed outline), centred between the belt and half-way past the shoulder, between two taken gaps (inside a door). When there are several candidates, each needs one on another door on the same row (one line width) and of the same length (15 %); a lone candidate stands on its own evidence. | Its ink bounds, `proud` 20, `radius` 15. |
| Flap (`grooves`, closed; a fuel or service flap) | A hole 100-350 mm a side, filling ≥ 75 % of its bounds, rounded (corner radius ≥ 10 % of its short side), ≥ 70 % of its rim its own (a panel bounded by gaps and creases is not a flap), inside the body side under the belt, clear of the windows and wheel discs, and no gap line running through the shape itself. | Its outline (1.2 px simplified) as a closed groove 12 mm wide, 8 mm deep. carforge keeps 8 mm of paint between a flap's groove and a gap's; a flap drawn closer is moved along the car (up to 40 mm), then if needed shrunk about its centre (to 85 % at most), the least that clears; the evidence says by how much. |
| Grille opening (`recesses` with `bars`) | A region of dense ink full of tiny enclosed cells (≥ 12 % of the pixels around are cells of ≤ 12 px: the hatching), ≥ 10000 mm², its extents run out through the hatching to its outline; between the bumper's top and the belt, its centre within 2 px of the centre line, inside the body and not reaching past the headlamps. | Symmetric `x` (half its width), `z`, `radius` from the corner deficit, `depth` 20, cell black, `bars` every ~70 mm (count = width / 70 − 1), 22 mm wide, trim. |
| Headlamp / blinker (`lamps`, circle px) | Rings from `cv2.HoughCircles` and from round holes, refitted on the ink's distance map, inked round ≥ 95 % (cost ≤ 0.25), radius 25-200 mm; per centre the outermost such ring. A pair mirrored about the centre column (2 px), on one row (2 px), radii within 10 %, between the bumper's top and the belt, inside the body. The largest pair is `headlights`; one smaller pair (r < 0.75 of it) is `leftblinkers` (mirrored, so left and right). | The left ring as `circle`; headlamps `segments` 12, `dome` 30; blinkers `segments` 8. |
| Bonnet rib (`lines`, face top) | Thin level holes (raw ink: the one-pixel closing would fill a rib's 2 px inside), merged along a row across crossing lines (≤ 4 px), ≥ 300 mm long, ≤ 30 mm wide, ahead of the first window; a pair mirrored about the centre row (2 px) with the same ends (3 px). The centre rib (drawn solid on the centre line) is taken when the closed ink on the centre row is ≥ 4 px thick over ≥ 90 % of the pairs' span and ≤ 3 px behind it. | One line per pair (mirrored) and a `single` centre line, `width` = the rib's inside + 2 px (between its two drawn edges). |

Dropped, with the reason: lines that do not reach the sill (A-pillar and window-frame lines: "window k's frame" within 30 mm of a window edge, "ends at z=…"), lines that stop under the belt ("follows the front/rear arch" when an end is within 100 mm of the arch outline: the fender's lip lines), lines within 100 mm of the body's ends (corner lines), level lines running ≥ 40 % of the body (creases, mouldings, the roof line: gaps cross the side), boxes that are not boxes or sit on no gap or alone on their gap, panel strips bounded by long lines, handles without their partner, rings with no mirrored partner, below the bumper (chassis), above the belt or inside the grille's hatching, and closed shapes of no kind (with a note when the sheet's extras already give an item there, and "part of the … taken around it" for the inside of a taken handle or flap).

Style the drawing cannot give (proud, cells, radii, dome, groove width, bar pitch) is the hand-tuned look of `examples/uaz3151.json`, in the `*_STYLE` constants of `trace.py`.

Checks on the UAZ (render vs drawing, measured on the orthographic renders): door gaps' groove centres 2-5 mm (median, p90 ≤ 9 mm) from the drawn lines; handles, hinges (z, from where the plate hides the groove), blinkers, headlamps and grilles within 7 mm of the drawn outlines; flap within 5 mm (shrunk to 97 %, moved 1 mm); ribs within 6 mm along, 2 mm across. Arch width (render half-width minus drawn, car's left side): top view front arch median 29 → 0 mm (max 38 → 24), rear arch 24 → 0 mm (max 34 → 10); front view, arch rows z 560-900, median 34 → 10 mm (max 43 → 29; what is left is the hinges, 12 mm proud, and the top view drawing the body 5-15 mm wider than the front view does).

Generic assumptions (hold for any side/front/top line drawing): door and panel gaps are straight drawn lines (or chains of them) that cross the side from the belt or above down to the sill; hinges are boxes on a gap, at least two per gap; handles are small elongated closed outlines at belt height inside a door; flaps are rounded closed shapes of their own under the belt; lamps are well-inked circles in mirrored pairs; grilles are hatched closed shapes centred on the front centre line between the bumper and the belt; bonnet ribs are long thin closed outlines in mirrored pairs ahead of the windscreen. The size ranges are fractions of the wheelbase that fit cars (a door handle is 4-13 % of the wheelbase long); a microcar or a lorry may fall outside them, and is then dropped with "fits no detail kind", not invented.

What a drawing must give for the details: one line weight for body lines (the line width sets every tolerance; a sheet with thick outlines and hair-thin detail lines makes the detail tolerances too loose); a front view for lamps and grilles, a top view for ribs; a grille drawn as hatching or mesh (an open grille drawn as bars alone, without cells, is not found); lamps drawn as closed circles (≥ 95 % inked).

Known limits of the trace:

- Body side is a vertical wall below the shoulder in the schema, so the body under an arch can only be cut for the whole height. `plan.low` under an arch is therefore the drawn outline less the lip's flare, but never inside the body line bridged across the arch from either side: a deeper cut (the sheet's `flare` 30 against a drawn lip only `arch_drawn_proud_mm` proud, UAZ front 14, rear 19 mm) took the whole wing above the lip in and left a dent over each arch. The lip then stands its full `flare` proud of the door line, 11-16 mm prouder than drawn on the UAZ; set `extras.arches.*.flare` to the drawn proudness to match it exactly.
- Door gaps are taken from the belt down; a gap that runs on up a window frame (the UAZ front door's front edge up the A pillar) stops where its line crosses another one instead of ending in a corner. Door tops along the roof are level lines and are not taken.
- Only the side blinker, rear face and windscreen are still hand items on the UAZ sheet; a rear view is not traced.
- A hinge is a box drawn on its gap; one drawn beside a gap, or a door with one hinge, is dropped. Of several handle candidates only those with a partner on another door on the same row are taken.
- Tested on one drawing only (the UAZ factory sheet); `build/carforge/refs` holds no second line drawing (the other images are photos), so the wheelbase fractions are set from one car and a second sheet is the next check.
- Grille bars are a fixed pitch over the opening, not the drawn mesh (the UAZ mesh is ~29 mm, too fine to model as bars).
- Front lamps are rings only; a rectangular lamp is not found.
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
- Wheels named `wheel_fl`, `wheel_fr`, `wheel_bl`, `wheel_br` (use `--wheel-fbx` to export separately); the spare `<id>.spare`.
- Lamp objects named `<id>.body.<role>`; glass is atlas cell (3,1); lamp atlas cells: head (4,1) (the pack's grey lens: the white cell read as lit), tail (5,1), blinker (7,1), reverse (8,1).
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

## Status (2026-10-11) and what is next

Done: fair shell (above); traced UAZ arches (flat-topped trapezoids) with a flared lip; side
windows as recessed pockets with traced slanted pillars and rounded corners; door seams; nose
bulge and recessed headlamp bezels. `fit_mesh.py` now finds bumpers (boxes, left out of the
slices), grille plates, window outlines (glass hull per pane) and keeps the true end length.
The traced UAZ is in the game as the UAZ-31512 (`cf_uaz31512`, ~5400 tris): rear door outline,
its hinges and the number plate on the rear face, frame rails, axles and differentials under the
body (`chassis`).

Next:
1. `fit_mesh.py` bodies still ripple (vz01 59, gz24 53, vz21 146 by `fairness.py`): facet noise in
   the slices; the shoulder detector flips between the belt and a step on vz21.
2. The traced UAZ keeps 18 ripples by `fairness.py` (the hand spec has none): the roof rail at the
   A pillar and at the rear corner, and the sill corner ahead of the front door.
3. `trace.py` is tested on one drawing; a second line drawing is the check that its relative rules
   hold. Still hand-only on the UAZ: the side blinker and the rear face (no rear view is traced).
4. The drawing's scan is about 4% short vertically (roof 1956 mm against the manual's 2020): the
   game stretches the body 3.7% in height to the factory figure.
5. Grille relief.
