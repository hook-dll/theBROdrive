---
description: Every material variant that can first appear mid-drive must be compiled behind the loading cover or before its object is attached. A program linked on first draw is a 300-800 ms main-thread freeze on Windows (ANGLE/D3D11).
alwaysApply: true
---

# Shader variants: compile before the first draw

Three.js links a WebGL program the first time a material VARIANT is drawn, on the main thread. On the owner's Windows machine (ANGLE over D3D11) one lit program is hundreds of milliseconds: the player sees a freeze, and Chrome reports it as an "input delay" of 400-840 ms on whatever key was held. On the Mac the same link is 10-40 ms, so it is easy to miss here.

A variant is the program cache key, not the material object. These all make a new one: render target vs canvas (tone mapping, colour space), light counts and shadow-casting lights, `scene.environment` present, `InstancedMesh` vs `Mesh`, `instanceColor` present, maps present, `vertexColors` with 3 vs 4 components, uv/tangent attributes, `side` DoubleSide, `transparent`/`alphaTest`, and every `onBeforeCompile` patch (its `customProgramCacheKey`).

## Rules

- Compile through `Renderer.compileForScenePass(object)`, never `renderer.compileAsync` with the default target. The scene pass draws into `hazeTarget`. A canvas-target compile builds a program the frame never uses.
- Anything in the scene graph at boot is compiled by `waitForFrameShaders`. Three's `compile` uses `traverse`, not `traverseVisible`, so a `visible = false` mesh counts. Content that only exists later needs one of these:
  - a hidden anchor mesh in a group that is in the scene at boot (`DebrisField`, `TrailerField`, `NoveltyField`);
  - for car models, `loadCarModel`, which compiles the model's program anchor before it resolves (render/carmodel.ts).
- An `InstancedMesh` that will ever call `setColorAt` must create `instanceColor` in its constructor (birds.ts, lakewater.ts, mirage*.ts). The first `setColorAt` otherwise changes the program mid-drive.
- Never change a light's `visible` or `castShadow`, or the number of lights, at runtime. The renderer's light slots are fixed and lit by intensity only (render/vehiclelights.ts). One count change recompiles every lit material at once.
- A material that is disposed with its chunk or car takes its program with it, if nothing else holds that program. Keep one long-lived holder (an anchor) for variants that come and go.
- New runtime material patches need a stable, shared `customProgramCacheKey`. Do not make it per instance.

## Checking

In the dev build, wrap `__bro.renderer.renderer.render` and count `info.programs.length` growth inside the call while you exercise the new content. Anything above zero mid-drive is a freeze on Windows. `__broSpikes` also notes `new programs: …` on a hitch.

Known one-offs still compiled on first draw: POI kit materials (world/poi/kit.ts). The sidetrack decal and everything at the 20 km marks have boot anchors now (`sidetrackProgramAnchor`, `monumentProgramAnchor`).

Shadow depth programs count too. `compileForScenePass` compiles each caster's depth program with its lit ones (no fog, render target bound), and `waitForFrameShaders` compiles every plain depth shape (front/back/double side, mesh/instanced, no map/map/alpha-tested). An anchor must copy the real mesh's `receiveShadow` and `castShadow`: receiving is in the lit program key, casting decides the depth program. The `hitch.mjs` night drive (`DAY=8 HEADED=1`) reports `programs=` per 30 s; anything above zero after the first window is a freeze on Windows.
