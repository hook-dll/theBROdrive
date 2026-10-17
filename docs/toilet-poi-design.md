# Japanese toilet POIs

## Intent

A POI is a silent client rather than an NPC. The building communicates through condition, sound, light, physical state, and an optional low-poly face (eyes and brows). The player arrives at a dirty, broken, or embarrassed facility, performs a short physical sequence, and leaves it visibly healthy. No human silhouettes or dialogue are required: the repaired state is the social response.

## Scope

The first catalogue contains 50 designer, architectural, and street Japanese toilet variants. They supplement existing POIs and remain low-poly. Each variant is one service cabin inside one of a small set of plan families (see "Families"), with data-driven dimensions, fixtures, palette, face, and scenario. A new variant MUST NOT require a new interaction implementation unless it introduces a genuinely new verb.

Thematic mix to aim the 50 at: compact Japanese pavilion (10), station/parking (8), concrete/minimal (8), park/trail (8), sculptural/designer (10), desert adaptations (6). Themes pick buildings; families draw them.

## Code layout

- `src/world/toilets/types.ts`: `ToiletVariant`, `ToiletShellSpec`, `ToiletForm` (the family and its parameters), `ToiletAnnex`, `ToiletFixtureSpec`, `ToiletScenario`, `ToiletState`, `ToiletFaceSpec`.
- `src/world/toilets/catalog.ts`: the stable 50-entry catalogue and source IDs.
- `src/world/toilets/geometry.ts`: the service cabin (walls, door, interior, optional drum wrap), its fixture layout and the authored footprint; low-poly meshes only.
- `src/world/toilets/families.ts`: the plan families around the cabin, each with a footprint twin.
- `src/world/toilets/parts.ts`: shared parts: roofs over a rectangle or a drum, the drum wrap, sealed annex booths, louvres, columns, the `Reach` footprints are summed from.
- `src/world/toilets/fixtures.ts`: reusable doors, valves, cisterns, buttons, drains, mirrors, lamps, dispensers, pumps, and cleaning props.
- `src/world/toilets/scenarios.ts`: data-driven action sequences and mistake effects.
- `src/world/toilets/face.ts`: reusable eyes/brows state machine.
- `src/world/toilets/state.ts`: runtime state and save/load projection; stores state, not geometry.
- `src/world/toilets/sounds.ts`: action/state sound cues.
- `src/poi-gallery.ts`: extend the existing gallery rather than creating a second visual catalogue; add toilet filtering, state controls, night mode, roof/interior toggles, and automation.

Existing POI geometry MUST continue through the existing merge/cache path (`world/poivariantbuild.ts`). Existing flush and placement checks remain gates.

## Families

The player enters one service cabin: a rectangle with its door at -Z, the interior, the fixtures, one central non-casting lamp, the mirror and the optional face. A family is the gesture drawn around that cabin, read off a real building's plan and volume rather than its surface. Everything a family adds is static and sealed (an annex booth is a solid volume with a closed door), so fixtures, states, the rig and the save never depend on the family.

| Family | Gesture | Parameters (`ToiletForm`) | First wave | Candidates next |
|---|---|---|---|---|
| `cabin` | The cabin alone; roof `flat`, `gable` or `pyramid`; dressing `louvres`, `privacy-walls` or `house` | none | NIGO Jingumae, Newson Urasando, Wonderwall Ebisu Park | Kashiwa Sato Ebisu Station West Exit |
| `row` | Sealed rooms either side of the cabin in one row, on one plinth under the cabin's roof | `rooms[]`: side, width, colour | Ban Yoyogi Fukamachi | Ban Haru-no-Ogawa (cool palette), Sakakura Nishihara Itchome |
| `cluster` | Separate huts at their own angles, each on its own plinth under a roof of the cabin's kind; box or drum huts | `huts[]` (`ToiletAnnex`) | Kuma Nabeshima (box huts, louvres), Ito Yoyogi-Hachiman (drums, floating roofs) | Maki Ebisu East Park (rooms round a court) |
| `vessel` | One curved wall wrapping behind the cabin, its rim rising from the back to tips either side of the door and flaring out, faucets at several heights on its inner face | radius, sweep, back and tip heights, flare, thickness, faucet heights | Fujimoto Nishisando | Tono Mirai Toiletowa, Tato Hut with the Arc Wall |
| `eave` | A round or oval eave over everything, held by a louvre ring or by columns, sealed booths beneath | eave, louvre ring or none, `booths[]`, columns | Ando Jingu-Dori Park (louvre ring), Kobayashi Sasazuka Greenway (oval eave over drums) | Komata Responsive Structure, Shiotsuka Kikuchi Pocket Park |
| `canopy` | One long slab on columns over the cabin and sealed cubes; its underside profile sags, folds or slants | canopy (centre, length, width, profile, thickness), `cubes[]`, columns | Yano Aoyama Tobe Zoo (deflected) | Pennington Hatagaya (two-station slant), Tamura Higashi Sanchome (zigzag fold) |

Two cabin options cross every family: `drum` wraps the side and back walls in a drum whose circle runs through the front corners (a round booth with a flat door front; its roof is `disc`, or `floating` on three posts), and the `louvres` dressing stands cedar boards off every wall at varied angles (a cluster's huts wear them too). The candidates column is the reference pass's reading, not yet checked against each building's own page.

Rules that keep a family cheap and safe:

- Annexes, covers, louvres and the vessel are static kit geometry in kit materials and merge with the shell; the covers (eave, canopy) are `poiRoof` for the gallery's roof toggle. No family adds a light, a reflection or a material variant.
- The footprint is summed, never measured: each builder in `families.ts` has a `familyReach` twin over the same numbers, and toilet-check holds the measured building within 5 cm of it.
- Nothing a family adds stands in the door's swing or straight approach; only a `poiDoorObstacle` screen (`privacy-walls`) may stand across the approach.

### First-wave sources

Facts only: no image, drawing or text is reproduced. Every entry's cards are in `catalog.ts`, accessed 2026-10-17.

| Id | Building | Architect | Family | Sources | Facts used |
|---|---|---|---|---|---|
| `toilet-ban-fukamachi` | Yoyogi Fukamachi Mini Park, 2020 | Shigeru Ban | `row` | [Dezeen round-up](https://www.dezeen.com/2024/03/08/tokyo-toilets-wim-wenders-perfect-days/), [official](https://tokyotoilet.jp/en/yoyogifukamachi_mini_park/) | Three cubicles in a row (multipurpose, women, men); tinted glass that turns opaque when locked, drawn opaque; orange, pink and purple |
| `toilet-kuma-nabeshima` | Nabeshima Shoto Park, 2021 | Kengo Kuma | `cluster` | [Dezeen round-up](https://www.dezeen.com/2024/03/08/tokyo-toilets-wim-wenders-perfect-days/), [official](https://tokyotoilet.jp/en/nabesima_park/) | A village of five huts joined by a walk in the woods; cedar board louvres at random angles |
| `toilet-nigo-jingumae` | Jingumae, 2021 | NIGO® | `cabin` | [Dezeen round-up](https://www.dezeen.com/2024/03/08/tokyo-toilets-wim-wenders-perfect-days/) | Small house, red pitched roof, three chimney-like elements, picket fence, blue-framed windows |
| `toilet-newson-urasando` | Urasando, 2023 | Marc Newson | `cabin` | [Dezeen round-up](https://www.dezeen.com/2024/03/08/tokyo-toilets-wim-wenders-perfect-days/) | Concrete block under a traditionally shaped copper roof; the central accessible toilet of three, drawn alone |
| `toilet-wonderwall-ebisu` | Ebisu Park, 2020 | Masamichi Katayama / Wonderwall | `cabin` | [Dezeen round-up](https://www.dezeen.com/2024/03/08/tokyo-toilets-wim-wenders-perfect-days/) | Board-marked concrete after the kawaya huts; a maze of fifteen walls, drawn as two screens |
| `toilet-fujimoto-nishisando` | Nishisando, 2023 | Sou Fujimoto | `vessel` | [official](https://tokyotoilet.jp/en/nishisando/) | One large vessel with a concave centre; toilets beyond an archway; five faucets at different heights; pure white walls |
| `toilet-kobayashi-sasazuka` | Sasazuka Greenway, 2023 | Junko Kobayashi (GONDOLA) | `eave` + `drum` | [official](https://tokyotoilet.jp/en/sasazuka_greenway/) | A large yellow oval awning over cylindrical toilets of various heights under the railway; weathering steel panels rusted once |
| `toilet-ando-jingu-dori` | Jingu-Dori Park, 2020 | Tadao Ando | `eave` | [official](https://tokyotoilet.jp/en/jingu-dori_park/) | Circular plan under a spanning roof, eaves protruding on the station side; a cylindrical wall of vertical louvres with entrances on opposite sides; the accessible toilet at the centre of that entrance |
| `toilet-ito-yoyogi-hachiman` | Yoyogi-Hachiman, 2021 | Toyo Ito | `cluster` + `drum` | [official](https://tokyotoilet.jp/en/yoyogi_hachiman/) | Three cylinders like mushrooms in a row, circulation between them, round roofs that look as if they float; a tile gradation, drawn as three shades |
| `toilet-yanoaoyama-tobe-zoo` | Tobe Zoological Park, Ehime, 2026 | Yano Aoyama Architecture Design | `canopy` | [Dezeen](https://www.dezeen.com/2026/07/25/yano-aoyama-architecture-design-tobe-zoo-toilet/) | Two 2 x 2 m cubes of chiselled precast concrete blocks under a 12 m cross-laminated cedar canopy deflected into a bowed curve, on slender steel columns along its edges |

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

Foundation, 2026-10-17. Built: `types.ts`, `catalog.ts`, `geometry.ts` (the service cabin: roof `flat`/`gable`/`pyramid`/`disc`/`floating`, optional `drum` wrap, dressing `louvres`/`privacy-walls`/`house`, washlet or squat pan), `fixtures.ts` (door, lid, flush, valve, plunger, floor dirt as eased 0..1 channels; clickable nodes carry `userData.toiletFixture`), `face.ts`, `state.ts` (progress and its save record), plus `rig.ts` (fixtures, lamp, face and mirror face over the merged shell, posed from progress) and `mirror.ts` (one live mirror for the nearest cabin, far plane 10 m; projection shared with the car mirrors in `render/mirrorview.ts`).

First architectural wave, 2026-10-17: `families.ts` and `parts.ts` (the six families above) and the catalogue at 10 of 50 (see "First-wave sources"). Ban Fukamachi became a `row` of three rooms and Kuma Nabeshima a `cluster` of five huts in cedar louvres (the `battens` dressing is gone); Fujimoto Nishisando, Kobayashi Sasazuka Greenway, Ando Jingu-Dori Park, Ito Yoyogi-Hachiman and Yano Aoyama Tobe Zoo are new. Ids of the first five are unchanged. Merged shells are 14-22 draws and 0.6-3k triangles each.

The shells are POI kit variants (`world/poi-variants.ts`) and go through `world/poivariantbuild.ts` like the masts; the world neither places nor warms them yet. The gallery API is `window.__poiGallery`: `focus(id)`, `overview()`, `roofs(visible)`, `setTime(hours)`, `inspect(id)`, `state(id, state)`, `reset(id)`, `complete(id)`, `activate(id, fixture, verb?)`, `emotion(id, emotion)`, `snapshot()`, `restore(records)`, `stats()`, `capture()`.

Not built yet: `scenarios.ts` (action order, wrong-order consequences; state poses in `rig.ts` stand in for the clogged-drain visit), `sounds.ts`, the remaining 40 variants (no family yet for a sphere, as at Nanago Dori Park, or for a lit panel ring, as at Ebisu Park), world placement and a stable POI id, game-save integration (a `WorldState` field and migration), player interaction (raycast on `toiletFixture`), boot program anchors for the toilet materials, the lamp light slots and the mirror pass in the game renderer. The first-wave shells have not been looked at in the gallery yet.

Gates without a browser: `nice -n 15 bun tools/toilet-check.ts` (catalogue, merge, placement, z-fighting, fixtures, lamp, mirror camera, determinism, save/load, face, families). The rendered mirror, day/night look and shader-program growth are checked in the gallery (`__poiGallery.stats().programs`).
