# Japanese toilet POIs

## Intent

A POI is a silent client rather than an NPC. The building communicates through condition, sound, light, physical state, and an optional low-poly face (eyes and brows). The player arrives at a dirty, broken, or embarrassed facility, performs a short physical sequence, and leaves it visibly healthy. No human silhouettes or dialogue are required: the repaired state is the social response.

## Scope

The first catalogue contains 50 designer, architectural, and street Japanese toilet variants. They supplement existing POIs and remain low-poly. Each variant uses one of a small set of shell families and data-driven dimensions, fixtures, palette, face, and scenario. A new variant MUST NOT require a new interaction implementation unless it introduces a genuinely new verb.

Suggested families: compact Japanese pavilion (10), station/parking (8), concrete/minimal (8), park/trail (8), sculptural/designer (10), desert adaptations (6).

## Code layout

- `src/world/toilets/types.ts`: `ToiletVariant`, `ToiletShellSpec`, `ToiletFixtureSpec`, `ToiletScenario`, `ToiletState`, `ToiletFaceSpec`.
- `src/world/toilets/catalog.ts`: the stable 50-entry catalogue and source IDs.
- `src/world/toilets/geometry.ts`: six reusable shell families; low-poly meshes only.
- `src/world/toilets/fixtures.ts`: reusable doors, valves, cisterns, buttons, drains, mirrors, lamps, dispensers, pumps, and cleaning props.
- `src/world/toilets/scenarios.ts`: data-driven action sequences and mistake effects.
- `src/world/toilets/face.ts`: reusable eyes/brows state machine.
- `src/world/toilets/state.ts`: runtime state and save/load projection; stores state, not geometry.
- `src/world/toilets/sounds.ts`: action/state sound cues.
- `src/poi-gallery.ts`: extend the existing gallery rather than creating a second visual catalogue; add toilet filtering, state controls, night mode, roof/interior toggles, and automation.

Existing POI geometry MUST continue through the existing merge/cache path (`world/poivariantbuild.ts`). Existing flush and placement checks remain gates.

## Runtime model

A toilet state is one of `arrived`, `inspected`, `repairing`, `cleaning`, `testing`, `healthy`. A fixture exposes typed actions: `open`, `close`, `turn`, `press`, `pull`, `slide`, `insert`, `pour`, `pump`, and `wipe`. Scenarios validate action order and object state, not menu choices.

Example clogged drain sequence:

1. close water valve;
2. take plunger;
3. use plunger on drain;
4. pump five times;
5. open valve;
6. flush;
7. wipe floor.

Wrong order produces a physical consequence (flood, stuck button, dirty water, failed test), never only a text error. Completion changes geometry/material state, sound, lamp, face emotion, and persisted progress.

## Face, light, mirror

The face is an optional reusable component: two eyes, lids, brows, pupils. Emotions: sleepy, angry, embarrassed, worried, relieved, happy, proud. It follows tools and reacts to mistakes. A toilet MAY omit the face; not every POI should become a mascot.

Each cabin has one simple central ceiling point light, kept in the boot-compiled variant set. No complex reflections. Mirrors reuse the existing vehicle mirror-camera pattern, with one bounded camera and no recursive reflection.

## Save contract

The stable POI ID is derived from world seed/type/cell. Save only `variantId`, `scenarioId`, `state`, and completion metadata. Rebuild geometry from the catalogue and apply progress after streaming. Re-visiting a completed POI MUST show its healthy state.

## Gallery/lab contract

`?poi-gallery&type=toilet` lists all variants. The lab needs `focus(id)`, `state(id, state)`, `complete(id)`, `activate(id, action)`, `setTime(hours)`, and `capture()`. It MUST show closed/open fixtures, face states, lamps, mirror, and the interior. The first vertical slice is one Japanese toilet with a valve, plunger, flush, wipeable floor, lamp, mirror, face, wrong-order consequence, happy state, and save/load.

## Quality gates

Every variant MUST pass: TypeScript; merged-mesh/placement checks; no visible z-fighting or open shell holes; closed and open fixture checks; day/night lamp check; mirror camera check; deterministic rebuild; state save/load; no mid-play shader-program growth. Source cards record URL, title, author/licence where applicable, accessed date, and which silhouette/plan/fixture/palette facts were used. The 50 entries are a catalogue milestone; mechanics are shared.

## Status

Foundation, 2026-10-17. Built: `types.ts`, `catalog.ts` (5 of 50, all from THE TOKYO TOILET, each with a source card), `geometry.ts` (one parametric cabin, not yet six families: roof `flat`/`gable`/`pyramid`, dressing `battens`/`privacy-walls`/`house`, washlet or squat pan), `fixtures.ts` (door, lid, flush, valve, plunger, floor dirt as eased 0..1 channels; clickable nodes carry `userData.toiletFixture`), `face.ts`, `state.ts` (progress and its save record), plus `rig.ts` (fixtures, lamp, face and mirror face over the merged shell, posed from progress) and `mirror.ts` (one live mirror for the nearest cabin, far plane 10 m; projection shared with the car mirrors in `render/mirrorview.ts`).

The shells are POI kit variants (`world/poi-variants.ts`) and go through `world/poivariantbuild.ts` like the masts; the world neither places nor warms them yet. The gallery API is `window.__poiGallery`: `focus(id)`, `overview()`, `roofs(visible)`, `setTime(hours)`, `inspect(id)`, `state(id, state)`, `reset(id)`, `complete(id)`, `activate(id, fixture, verb?)`, `emotion(id, emotion)`, `snapshot()`, `restore(records)`, `stats()`, `capture()`.

Not built yet: `scenarios.ts` (action order, wrong-order consequences; state poses in `rig.ts` stand in for the clogged-drain visit), `sounds.ts`, the remaining five shell families and 45 variants, world placement and a stable POI id, game-save integration (a `WorldState` field and migration), player interaction (raycast on `toiletFixture`), boot program anchors for the toilet materials, the lamp light slots and the mirror pass in the game renderer.

Gates without a browser: `nice -n 15 bun tools/toilet-check.ts` (catalogue, merge, placement, z-fighting, fixtures, lamp, mirror camera, determinism, save/load, face). The rendered mirror, day/night look and shader-program growth are checked in the gallery (`__poiGallery.stats().programs`).
