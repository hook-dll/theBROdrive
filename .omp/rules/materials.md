---
description: Reuse the game's shared materials before making a new one; every new material shape is a shader program, counted against config/program-budget.json.
condition: 'new THREE\.\w*Material\(|Material\(\{|flatShading|LineBasicMaterial|MeshLambertMaterial|MeshPhongMaterial|MeshPhysicalMaterial|ShaderMaterial|onBeforeCompile'
scope: 'tool:edit(**/src/**/*.ts), tool:write(**/src/**/*.ts)'
interruptMode: never
---

# Materials: reuse first, and the program budget

A material object is nearly free. A **program** is not: every new combination of material
type and flags (`vertexColors`, a map, `flatShading`, `transparent`, `side`, an
`onBeforeCompile` patch, instancing) links a shader of its own. Behind the loading cover
it lengthens the boot. Mid-drive it is a freeze on ANGLE (shader-variants.md). And a
material that only differs by colour keeps meshes from merging, so every colour costs
its own draw.

## Before writing `new THREE.…Material`

Take the first of these that fits:

| You are making | Use |
|---|---|
| A kit box, cylinder or furniture piece in one flat colour (POI, fixture, machine) | `poi/kit.ts` `box`/`cylinder`/`material(color)`, then `mergeKitStatics(root)` on the finished piece: all flat colours become one palette mesh (`makeFlatPaletteMaterial`). Tag parts that move, hide or repaint on their own `userData.kitKeep`; free with `disposeKitMerged` when the chunk goes. |
| Any other flat-coloured scenery | `render/materials.ts` `makeFlatMaterial(color, roughness)` (cached, shares one program), or colours in the vertices on a material already in use. |
| A roadside prop, rock, plant (scatter) | `matProp` in `props/forms.ts`, colour painted with `paintAsMaterial`. |
| A board with fixed text known at load | `market.ts` `registerAtlasSign` at module load + `signMesh`. Text decided during the drive: `signMaterial` (cached per text) or `paintSign` (one-off, owned). |
| A world item / car part | the `MeshBuilder` shapes in `render/partmesh.ts` (`flat`, `cond`); add to `itemProgramAnchor` only if the shape is new. |
| An unlit mirage solid or card | `mirage-tableau.ts` `cardMaterial` (geometry carries both faces), blocks with vertex colours. |
| A soft dark mark on the ground | `render/groundmark.ts` `groundMarkMaterial(shoulder)`. |
| A faceted look | bake it: non-indexed geometry + `computeVertexNormals()`, not `flatShading` (a program of its own). Only shader-deformed geometry (birds' wings) needs `flatShading`. |
| Lines | thin geometry or paint it into a texture; `LineBasicMaterial` is its own program and a pixel wide at any distance. |

Never: `MeshLambertMaterial`, `MeshPhongMaterial`, `MeshPhysicalMaterial` (the game is
Standard throughout; with none of their extras they look the same and cost a program).

## The budget

- Every dev boot checks the programs linked behind the cover against
  `config/program-budget.json` for its tier and prints `[program budget] … not in
  config/program-budget.json` with the materials that use each new program
  (`render/programbudget.ts`). Any program linked after the boot prints
  `[program budget] … linked mid-drive`. Look tools print every `console.error`.
- After a change that adds or touches materials, run
  `node tools/look/programs.mjs` (dev server on 5199): it boots every tier and lists new
  (`+`) and no longer linked (`-`) programs. `+` lines mean: move the new thing onto a
  shared material from the table, or, if it truly needs its own, say why and
  `node tools/look/programs.mjs --write` in the same commit. `-` lines: the budget can
  shrink; write it.
- `tools/look/draws.mjs` shows draws per owner and every program's materials;
  `tools/look/closeup.mjs` with `RADIUS` compares a piece before and after at one pose.
