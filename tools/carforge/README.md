# carforge

Builds a low-poly car FBX from a compact spec. Pipeline entry points:

- `carforge.py` — spec → FBX (`-- <spec.json> <out.fbx> [--wheel-fbx] [--summary <file>]`).
- `render.py` — FBX → PNG views (`-- --fbx <file> --albedo <png> --prefix <path> --size W H`; writes `_side`, `_front`, `_q`, `_qrear`, `_wire`; prints `EXTENT x y z`).
- `fit_blueprint.py` — traced pixel blueprint → spec (plain Python).
- `fit_mesh.py` — existing FBX/GLB → spec (Blender script; `-- --in <fbx> --out <json> --id <id>`).
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
| `windows` | [{y:[a,b]}, …] | mm | Side window spans. |
| `bumpers` | [{y, z, half_width, cell, chamfer}] | y, z: [lo,hi] mm; half_width mm; cell: atlas material name; chamfer mm | Bumper boxes at the nose/tail. |
| `mirrors` | [{x, y, z, cell}] | mm, mirror centre | Wing mirrors. |
| `plates` | [{face, x, z, cell, round, single}] | face: `front`/`rear`; x, z: [lo,hi] mm | Number plate or grille panels. |
| `lamps` | [{role, face, x, z, round, segments, single}] | face: `front`/`rear`; x, z: [lo,hi] mm | Lamp boxes. `role` must be a key of `LAMP_CELL` in carforge.py (`headlights`, `leftblinkers`, `rightblinkers`, `taillights`, `reverselights`). |
| `spare` | {y, z} | mm | Spare-wheel position (optional). |

`validate()` in carforge.py rejects specs missing `id`, `wheels` (radius, width, track_front, track_rear, wheelbase), `side.top/bottom/shoulder` (≥ 2 points), `plan.low/high` (≥ 2 points), `belt`, `glass_top`, unknown lamp roles, and faces other than `front`/`rear`.

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
4. 41 stations along y, inset 1% of length at each end. Shoulder is the largest 20 mm inward half-width step between 25% and 85% of height (else the belt); profiles median-smoothed.
5. Windows: runs of side glass faces (40 mm gap merge, 100 mm minimum). `belt`/`glass_top`: medians of side glass z-min/z-max.
6. Windscreen/backlight: roof-slope glass (normal z > 0.2), envelope ± 60 mm.
7. Lamps → `single: true` boxes at their measured position.

Prints `FIT {...}` with length, width, height, wheelbase, track, belt, glass_top, window count.

## Known limits

- VAZ-2101 and BMW E46 ports are approximations: the old schema had no per-y body half-width, belt or glass top. Those values are estimates (noted in each file's `source`).
- Rear-face lamps in the UAZ blueprint are given in mm (rear view not traced).
- Generated mesh-fit paint is flat; glass is coarse (one window per run).
- Fitted widths: vz01 about 3% and vz21 about 3% under the original (mirrors and trim are not in the body).
- Fitted ends taper: the 1% inset leaves small wedge ends on vz01 and gz24 (length ~2% short).
- No per-y belt in the schema: belt is a single value.
- Grille depth is lost (plates are flat).

## Status (2026-10-09) and what is next

Where it stands: the three-view core (`carforge.py`) builds a body with the pack's
construction (13-point station ring, quad grid, glass rows, boolean arches, probed lamps
and plates). `examples/uaz3151.json`, traced by hand from the factory drawing
`build/carforge/refs/uaz_blueprint.gif` (4.779 mm/px, isotropic), overlays the drawing's
side view within a few pixels (`build/carforge/renders/uaz3151_overlay.png`); body 2288
tris. FBX nodes carry rotation 0 like the pack. The owner's verdict: about half way —
the outline is right, the detail is coarse.

Next, in order:
1. Arches following the traced fender line (the UAZ's are trapezoid with a flat top), with a
   flared lip; per-arch shape in the spec instead of a circle.
2. Door seams and window frames/pillars from the traced openings (slanted A/B pillars, rounded
   window corners), glass recessed 10-15 mm.
3. Front-view shape: the grille panel's bulge, wings rounded into the bonnet, headlamps in
   recessed bezels; the same for the tail.
4. `fit_mesh.py`: windows come out as stripes, no lamps/bumpers, wedge ends (see Known limits).
5. A tracer that takes the side/top/front outlines from a drawing automatically
   (`trace_blueprint.py` is UAZ-specific and its plan/front traces are unreliable), and a
   compare tool that overlays render and drawing (done by hand in a Python cell so far).
6. Game integration: a `carmodels.ts` def for a generated car (scale, wheel nodes, lights).
