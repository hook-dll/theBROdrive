# Лицензии ассетов /look

Все исходные материалы — **CC0 1.0 Universal** (public domain dedication). Правило
из `docs/renderer-v2.md`: только CC0. Ничего из slowroads не копировалось: у него
закрытый исходник, у нас — свои источники, свои рендеры и свои скрипты.

Сборка повторяется командой `node tools/look/build.mjs` (см. `tools/look/README.md`);
скачанные исходники лежат в `tools/look/.cache` (не коммитится), готовые текстуры —
в `public/look`.

## Как читать таблицы

- **id** — идентификатор ассета у поставщика;
- **что стало** — файлы в `public/look`, в которые он вошёл;
- **URL** — точная ссылка, по которой скрипт скачивает исходник.

## ambientCG (ambientcg.com)

Лицензия: CC0 1.0 Universal. Подтверждение: страница ассета, поле «License».

| id | что стало | исходник |
|---|---|---|
| `Asphalt026C` | `road_asphalt.webp` | https://ambientcg.com/get?file=Asphalt026C_1K-JPG.zip |
| `Bark004` | `trees_deciduous_*.webp` | https://ambientcg.com/a/Bark004 |
| `Bark006` | `trees_conifer_*_m.webp` | https://ambientcg.com/a/Bark006 |
| `Bark009` | `trees_deciduous_*.webp` | https://ambientcg.com/a/Bark009 |
| `Bark011` | `trees_deciduous_*.webp` | https://ambientcg.com/a/Bark011 |
| `Bark012` | `trees_conifer_*_m.webp` | https://ambientcg.com/a/Bark012 |
| `Bark014` | `trees_deciduous_*.webp` | https://ambientcg.com/a/Bark014 |
| `Grass004` | `grass.webp`, `grass_snow.webp` | https://ambientcg.com/get?file=Grass004_1K-JPG.zip |
| `Grass004` | `road_overlay_spring.webp` | https://ambientcg.com/get?file=Grass004_1K-JPG.zip |
| `Gravel001` | `sand.webp` | https://ambientcg.com/get?file=Gravel001_1K-JPG.zip |
| `Gravel003` | `gravel.webp` | https://ambientcg.com/get?file=Gravel003_1K-JPG.zip |
| `Ground023` | `forest_summer.webp`, `forest_spring.webp`, `forest_winter.webp` | https://ambientcg.com/get?file=Ground023_1K-JPG.zip |
| `Ground031` | `peat.webp` | https://ambientcg.com/get?file=Ground031_1K-JPG.zip |
| `Ground048` | `soil.webp` | https://ambientcg.com/get?file=Ground048_1K-JPG.zip |
| `Ground072` | `forest_summer.webp`, `stubble.webp` | https://ambientcg.com/get?file=Ground072_1K-JPG.zip |
| `Ground082S` | `forest_summer.webp`, `forest_spring.webp`, `forest_winter.webp` | https://ambientcg.com/get?file=Ground082S_1K-JPG.zip |
| `Ground089` | `sand.webp` | https://ambientcg.com/get?file=Ground089_1K-JPG.zip |
| `Leaf001` | `forest_autumn.webp` | https://ambientcg.com/get?file=Leaf001_1K-JPG.zip |
| `Leaf001` | `trees_deciduous_*.webp`, `imposters_deciduous_*.webp` | https://ambientcg.com/a/Leaf001 |
| `Moss001` | `forest_summer.webp`, `forest_spring.webp` | https://ambientcg.com/get?file=Moss001_1K-JPG.zip |
| `Moss003` | `forest_spring.webp`, `rock.webp` | https://ambientcg.com/get?file=Moss003_1K-JPG.zip |
| `Moss003` | `road_overlay_spring.webp` | https://ambientcg.com/get?file=Moss003_1K-JPG.zip |
| `Rock051` | `rock.webp`, `rock_height.webp` | https://ambientcg.com/get?file=Rock051_1K-JPG.zip |
| `ScatteredLeaves005` | `road_overlay_autumn.webp` | https://ambientcg.com/get?file=ScatteredLeaves005_1K-JPG.zip |
| `ScatteredLeaves006` | `forest_autumn.webp` | https://ambientcg.com/get?file=ScatteredLeaves006_1K-JPG.zip |
| `ScatteredLeaves006` | `road_overlay_autumn.webp` | https://ambientcg.com/get?file=ScatteredLeaves006_1K-JPG.zip |
| `ScatteredLeaves007` | `road_overlay_autumn.webp` | https://ambientcg.com/get?file=ScatteredLeaves007_1K-JPG.zip |
| `ScatteredLeaves008` | `forest_autumn.webp` | https://ambientcg.com/get?file=ScatteredLeaves008_1K-JPG.zip |
| `ScatteredLeaves009` | `forest_autumn.webp` | https://ambientcg.com/get?file=ScatteredLeaves009_1K-JPG.zip |
| `ScatteredLeaves009` | `road_overlay_autumn.webp` | https://ambientcg.com/get?file=ScatteredLeaves009_1K-JPG.zip |
| `Snow005` | `grass_snow.webp` | https://ambientcg.com/get?file=Snow005_1K-JPG.zip |
| `Snow010A` | `road_snow.webp` | https://ambientcg.com/get?file=Snow010A_1K-JPG.zip |
| `Snow011` | `forest_winter.webp` | https://ambientcg.com/get?file=Snow011_1K-JPG.zip |

## Собственные рендеры (Blender 5.2)

Лицензия: CC0 1.0 (наши собственные работы).

| id | что стало | как получено |
|---|---|---|
| `plants.py bush render` | `bush_spring.webp`, `bush_summer.webp`, `bush_autumn.webp`, `bush_winter.webp` | tools/look/blender/plants.py — 4 slots x 4 seasons, 512 px, unlit photo colour with a season grade |
| `plants.py cell renders` | `grass_atlas.webp`, `grass_flora.webp` | tools/look/blender/plants.py — 8 orthographic cells, unlit luminance, no alpha cards |
| `plants.py crossed-card bush mesh` | `bush.glb` | tools/look/blender/plants.py — four crossed cards, UVs over the first atlas column |
| `trees.py renders and models` | `trees_deciduous_*.webp`, `trees_deciduous_*_n.webp`, `trees_conifer_*_m.webp`, `trees_conifer_*_a.webp`, `imposters_deciduous_*.webp`, `imposters_conifer_*.webp`, `tree_*.glb` | tools/look/trees/trees.py — branch modules, whole-tree sprite, impostor bakes, bark cylinder, GLB export |

## Сгенерировано кодом (our code)

Лицензия: CC0 1.0 (наши собственные работы).

| id | что стало | как получено |
|---|---|---|
| `procedural` | `road_asphalt.webp`, `road_overlay_spring.webp`, `road_overlay_autumn.webp`, `road_snow.webp` | noise and structure written in tools/look/road.mjs (wrapped-lattice value noise, wheel paths, patch seams, plough edge, ragged alpha) |
| `procedural-noise` | `noise_fine.webp`, `noise_variation.webp`, `detail_near.webp`, `detail_far.webp`, `detail_far_winter.webp` | tools/look/noise.mjs (value noise on a wrapping lattice, fbm + ridged octaves) |

## Poly Haven (polyhaven.com)

Лицензия: CC0 1.0 Universal. Подтверждение: страница ассета, поле «License».

| id | что стало | исходник |
|---|---|---|
| `asphalt_02` | `road_asphalt.webp` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/asphalt_02/asphalt_02_diff_1k.jpg |
| `brown_mud_03` | `peat.webp` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/brown_mud_03/brown_mud_03_diff_1k.jpg |
| `celandine_01` | `grass_atlas.webp`, `grass_flora.webp` | https://polyhaven.com/a/celandine_01 |
| `celandine_01` | `bush_spring.webp` | https://polyhaven.com/a/celandine_01 |
| `coast_sand_02` | `sand.webp` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/coast_sand_02/coast_sand_02_diff_1k.jpg |
| `dandelion_01` | `grass_atlas.webp`, `grass_flora.webp` | https://polyhaven.com/a/dandelion_01 |
| `dandelion_01` | `bush_summer.webp` | https://polyhaven.com/a/dandelion_01 |
| `dry_branches_medium_01` | `bush_winter.webp` | https://polyhaven.com/a/dry_branches_medium_01 |
| `fern_02` | `bush_spring.webp`, `bush_summer.webp`, `bush_autumn.webp` | https://polyhaven.com/a/fern_02 |
| `fir_tree_01` | `trees_conifer_*_m.webp`, `imposters_conifer_*_d.webp` | https://polyhaven.com/a/fir_tree_01 |
| `grass_bermuda_01` | `grass_atlas.webp` | https://polyhaven.com/a/grass_bermuda_01 |
| `grass_medium_01` | `grass_atlas.webp` | https://polyhaven.com/a/grass_medium_01 |
| `grass_medium_01 dry diffuse` | `grass_atlas.webp` | https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/grass_medium_01/grass_medium_01_dry_diff_1k.jpg |
| `grass_medium_02` | `grass_atlas.webp` | https://polyhaven.com/a/grass_medium_02 |
| `gravel` | `gravel.webp` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/gravel/gravel_diff_1k.jpg |
| `leaves_forest_ground` | `road_overlay_autumn.webp` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/leaves_forest_ground/leaves_forest_ground_diff_1k.jpg |
| `nettle_plant` | `bush_spring.webp`, `bush_summer.webp`, `bush_autumn.webp` | https://polyhaven.com/a/nettle_plant |
| `pine_sapling_small` | `trees_conifer_*_m.webp`, `imposters_conifer_*_d.webp` | https://polyhaven.com/a/pine_sapling_small |
| `road_damaged` | `road_asphalt.webp` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/road_damaged/road_damaged_diff_1k.jpg |
| `road_damaged_clean` | `road_asphalt.webp`, `road_snow.webp` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/road_damaged_clean/road_damaged_clean_diff_1k.jpg |
| `shrub_02` | `bush_spring.webp`, `bush_summer.webp`, `bush_autumn.webp`, `bush_winter.webp` | https://polyhaven.com/a/shrub_02 |
| `shrub_04` | `bush_spring.webp`, `bush_summer.webp` | https://polyhaven.com/a/shrub_04 |
| `snow_02` | `road_snow.webp` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/snow_02/snow_02_diff_1k.jpg |
| `snow_03` | `road_snow.webp` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/snow_03/snow_03_diff_1k.jpg |
| `snow_floor` | `road_snow.webp` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/snow_floor/snow_floor_diff_1k.jpg |
| `worn_asphalt` | `road_asphalt.webp`, `road_snow.webp` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/worn_asphalt/worn_asphalt_diff_1k.jpg |

## Обработка

Исходные фотографии не публикуются как есть. Скрипты `tools/look/*.mjs` приводят их
к 1024² (или к размеру атласа), убирают крупные низкочастотные пятна (которые при
повторе давали бы узор), выравнивают яркость, переводят в серое там, где цвет даёт
шейдер, и складывают карту высот в альфу. Приёмы — свои; числа приёмов slowroads
(setgound: полоса 7 м, четыре краски, «сияние») взяты из `docs/slowroads-steam/notes/`
как ориентир, код не копировался.
