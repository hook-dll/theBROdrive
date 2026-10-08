# CarForge design: own shape, Soviet construction

A generated car takes its SHAPE from a profile spec (traced from a blueprint, photos,
or sliced from a reference mesh) and its CONSTRUCTION from the Soviet pack. The
grammar below is read off the pack's wireframes (build/carforge/study/vz01_regions_side.png,
vz08_q_front.png, vz21_side.png).

## Frame
+X = car left, front = -Y, Z up, metres; FBX export like the pack (names `<id>.body`,
`<id>.body.headlights|taillights|reverselights|leftblinkers|rightblinkers`,
`<id>.wheel_fl|fr|bl|br`, wheel origin at hub). UVs in [0,1]; colour = atlas cell of
`public/models/soviet/albedo.png` (9x2). Glass cell (3,1). Paint, steel, black trim,
rubber cells: take from build/carforge/study/palette.json and src/render/materials.ts.

## Body = mirrored panel grid, not a tube
One side is a grid of COLUMNS (lengthwise stations) x ROWS (height bands); the other
side is its mirror across X=0 (centre-line vertices welded). Top caps join the two.

Columns (front to rear), each a station line in the spec:
front face | front bumper zone | front overhang | front arch (2-3 columns) | cowl / A-pillar
base | door cut(s) (1 door: 1 cut, 2 doors: 2 cuts) | C-pillar base | rear arch (2-3) |
rear overhang | rear face. Door cuts are real column lines (visible seams in vz01).

Rows (bottom to top) of the LOWER body:
underbody edge | sill (chamfered inward, ~45°) | lower side | crease | mid side | beltline
| shoulder (tumblehome in, chamfer to the bonnet/boot cap). Rows of the GREENHOUSE (only
between A- and C-pillar columns, plus D for estates/hatch/UAZ):
glass bottom | glass top | roof rail chamfer | roof.

- Bonnet and boot lid: caps between the two shoulders, 2-4 segments across, a slight
  crown (centre higher by 1-3% of width), chamfer row to the side. Their front/rear edge
  rolls down into the front/rear face in 1-2 rows.
- Roof: cap over the greenhouse, 2-4 segments across, crown, chamfered rails.
- Glass: faces of the greenhouse rows between pillar strips, UV'd to the glass cell,
  slightly inset (10-20 mm) from the pillar plane. Pillars are thin paint strips (A,B,C,(D)).
  Windscreen and back light are the greenhouse's front/rear faces, glass cell, framed by
  a 1-row paint border.
- Wheel arches: open cut-outs in the side grid; a ring of 10-12 segments around the arch
  (half-circle plus a flat return), with a lip row (flare outward 10-40 mm) and an inner
  wall going inward ~0.25 m. Arch radius ≈ 1.15-1.25 x tyre radius.
- Front face: grid with insets for the grille (steel/black cell) and headlamp surrounds;
  rear face likewise for tail lamps. Lamps are SEPARATE meshes laid flush over the face.
- Bumpers: separate closed shells (box section, chamfered ends wrapping round the corner),
  steel or black cell, slightly proud of the face.
- Underbody: one flat closed plate at sill bottom; the body is watertight.
- Mirrors, door handles: small boxes. Optional per spec.
- Wheels: copy the pack's wheel mesh (e.g. vz01.wheel_fl), scale to the spec's radius and
  width. Identical construction for free.

## Budget
Body 1.5k-3.5k tris (triangulated or quads both fine), lamps <100 tris each,
wheels as copied.

## Spec (mm, origin at ground under the front axle centre, +Y rearward in the JSON,
converted on export)
- `stations`: list of {y, name, half_width at sill/beltline/shoulder, z of sill/crease/
  beltline/shoulder}. Plan taper and tumblehome come from these.
- `greenhouse`: per pillar station {y, z_glass_bottom, z_roof, half_width_roof}, pillar
  widths, door cut positions.
- `bonnet`/`boot`: front/rear edge heights, crown.
- `wheels`: wheelbase, front/rear track, tyre radius, width.
- `faces`: grille rect, lamp rects, bumper heights/depths, cells.
A body style is just a different station/greenhouse list: saloon (3 boxes), hatch
(C/D pillar to the tail), estate/UAZ (tall flat greenhouse, near-vertical faces).
