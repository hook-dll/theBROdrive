# Vehicle lamp authoring checklist

Use this for every imported vehicle. The invariant is simple: one independently
controlled real-world lamp function must be one independently selectable mesh node.
Do not make runtime code guess functions from position, colour or triangles.

## 1. Fix the factory reference first

1. Identify the exact model year, market and factory lamp supplier/version.
2. Collect clear front and rear photographs with the lamps off.
3. Find a wiring diagram, bulb chart or labelled photograph showing each function.
4. Record the approved off-state lens colour: clear, amber, red or smoked.

Do not author from a tuned car or infer that every red rear panel is a stop lamp.
If references disagree, choose and approve one configuration before editing geometry.

## 2. Inspect the source model

Open an uncompressed GLB/FBX in Blender. For every visible lamp region, determine:

- whether it is already a separate object or loose connected component;
- whether another transparent shell sits in front of it;
- which faces are lens, reflector, bezel or decorative panel;
- whether left and right sides use the model's expected coordinate convention.

Keep housings and bezels as trim. Only visible lens faces belong to controlled lamp
nodes. A window/glass mesh in front of an emissive lens must be removed from that
region or reassigned; otherwise the lamp can glow invisibly.

## 3. Cut semantic lamp nodes in Blender

Separate existing loose components first. Where one mesh crosses a real lens seam,
physically cut it with Knife/Bisect, then separate faces by function. Use the factory
seam, not an arbitrary whole-object material assignment.

Use these node names where the function exists:

| Node | Function |
| --- | --- |
| `headlights` | dipped/main headlamp lenses |
| `taillights` | rear position/running lenses |
| `brake_lights` | dedicated stop-lamp lenses |
| `reverse_lights` | reversing lenses |
| `front_blinker_left`, `front_blinker_right` | front indicators |
| `rear_blinker_left`, `rear_blinker_right` | rear indicators |
| `rear_passive` | reflectors, decorative red panels, unused fog sections |
| `front_auxiliary` | visible but uncontrolled auxiliary lenses |

Do not emit empty nodes. Preserve transforms, normals and winding. A model with a
combined running/stop lens may omit `brake_lights`; a model with separate factory
sections must author both `taillights` and `brake_lights`.

Per-model cuts belong in a deterministic Blender script, like
`tools/split-vaz2110-lamps.py`. Never reuse another car's cut coordinates without
measuring the new mesh.

## 4. Author the off-state materials

Use opaque lens materials unless the asset has a deliberately modelled reflector and
an alpha-tested result has been visually approved. Name every controlled material
with `Light` or `Lamp`, so `solid-paint` cannot mistake it for coachwork.

Recommended material names:

- `Headlights`
- `IndicatorLights`
- `TailLights`
- `BrakeLights`
- `ReverseLights`
- `PassiveRearLights`
- `AuxiliaryLights`

The base colour is the lens with power off; runtime adds emission. Sample it from the
approved reference or an existing canonical model. glTF base-colour factors are
linear RGB. Convert an sRGB channel $c$ in $[0,1]$ before writing it:

```
linear = c / 12.92                         when c <= 0.04045
linear = ((c + 0.055) / 1.055) ** 2.4     otherwise
```

Example: the VAZ-2104 amber atlas colour `#f26716` becomes
`[0.887923, 0.135633, 0.008023]` in glTF.

## 5. Map runtime controls

Declare the authored nodes in `CarModelDef.lights`:

```ts
lights: {
  headlights: ['headlights'],
  taillights: ['taillights'],
  brakeLights: ['brake_lights'],
  reverseLights: ['reverse_lights'],
  leftBlinkers: ['front_blinker_left', 'rear_blinker_left'],
  rightBlinkers: ['front_blinker_right', 'rear_blinker_right'],
}
```

Omit only functions the real model and asset genuinely do not contain. Passive nodes
must never appear in a controlled selector.

## 6. Export and verify

Keep semantic node names during optimization and do not simplify approved geometry:

```sh
npx gltf-transform optimize input.glb output.glb \
  --compress meshopt --simplify false --palette false \
  --join-named false --texture-compress false
```

Run the pack audit, `npm run build`, and `gltf-transform validate`. Then inspect the
actual car in daylight and at night through this matrix:

1. Everything off: every lens is visible and no lens inherits body paint.
2. Headlights: only headlamps and rear running sections illuminate.
3. Brake: only stop-lamp sections brighten; passive red areas stay unchanged.
4. Reverse: only reverse lenses turn white.
5. Left indicator: only left front/rear sections flash amber.
6. Right indicator: only right front/rear sections flash amber.
7. Repaint the body: no lamp colour changes.

Check both sides close-up. A correct material list is not proof if the wrong faces are
inside a node; the final visual matrix is mandatory.
