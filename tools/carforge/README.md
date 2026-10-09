# carforge

Builds a low-poly car FBX from a compact spec. Pipeline entry points:

- `carforge.py` — spec → FBX (`-- <spec.json> <out.fbx> [--wheel-fbx] [--summary <file>]`).
- `render.py` — FBX → PNG views (`-- --fbx <file> --albedo <png> --prefix <path> --size W H`; writes `_side`, `_front`, `_q`, `_qrear`, `_wire`; prints `EXTENT x y z`).
- `fit_blueprint.py` — traced pixel blueprint → spec (plain Python).
- `fit_mesh.py` — existing FBX/GLB → spec (Blender script; `-- --in <fbx> --out <json> --id <id>`).
- `fairness.py` — surface check of a built body (Blender script; `-- --fbx <file> [--prefix <path>] [--json <file>]`): counts folds (non-planar quads), ripples (a gentle bend reversed within 700 mm along a section profile) and slivers; writes a defect map (`_fair_*`) and a glossy matcap render (`_shine_*`). A body is clean at 0 folds, 0 ripples.
- `compare.py` — side render over the traced drawing at the blueprint's scale (plain Python + Pillow; `--blueprint <json> --drawing <img> --render <render.py prefix> --out <png>`).
- `examples/` — hand-written specs (`uaz3151.json`, `vaz2101.json`, `bmw_e46.json`) and `blueprint_uaz3151.json` (pixel input for `fit_blueprint.py`).

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

## Blueprint input (`fit_blueprint.py`)

Input is a traced side (and optionally front) blueprint in pixels. Keys:

- `id`, `source` (text note).
- `scale`: `mm_per_px`, `y0_px` (px column of front axle), `z0_px` (px row of ground), `x0_px` (px column of car centre-line for front view).
- `side.top`, `side.bottom`, `side.shoulder`: `[[px,py], …]`.
- `plan.low`, `plan.high`: `[[px, half_width_px], …]`.
- `tumblehome`: `[[py, factor], …]`.
- `belt`, `glass_top`: py.
- `windscreen`, `backlight`: `[px0, px1]`; `windows`: `[[px0, px1], …]`.
- `lamps`: front lamps in px (`circle [cx,cy,r]` or `rect [x0,y0,x1,y1]`), rear lamps in mm (`x`, `z`).
- `wheels`, `bumpers`, `mirrors`, `plates`, `spare`: already in mm, copied through.

Mapping: y = (px − y0)·mm_per_px; z = (z0 − py)·mm_per_px; x = (px − x0)·mm_per_px.
`examples/blueprint_uaz3151.json` round-trips exactly to `examples/uaz3151.json`.

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
2. An automatic tracer for side/top/front outlines (`trace_blueprint.py` is UAZ-specific); the
   overlay check is `compare.py` (`build/carforge/renders/uaz3151_overlay.png`).
3. Rear face detail (tail lamp bezels, door seam), grille relief.
4. Game integration: a `carmodels.ts` def for the generated UAZ (drivetrain can reuse
   `engine_umz_4213` / `gearbox_uaz_4`).
