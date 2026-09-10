# Конвейер импорта и доводки автомобилей

Этот документ — главный маршрут от исходного архива до полноценной игровой машины. Форматные детали вынесены в `tools/yft-vehicle-import.md`, `tools/dff-pack-import.md` и `tools/vehicle-lamp-authoring.md`.

Конвейер не должен обещать «идеальную машину из любого архива без участия человека». Архив не содержит достоверных заводских характеристик, назначения секций фонарей и критерия допустимой потери силуэта. Автоматизируются распаковка, классификация, повторяемая обработка, сборка и измерения. Три решения остаются явными контрольными воротами: выбор точной заводской модификации, утверждение внешности после облегчения и утверждение поведения по измеримым реальным ориентирам.

## 1. Что считается готовой игровой сущностью

Машина готова только когда выполнены все условия:

- исходник, выбранный файл внутри архива, лицензия и контрольная сумма зафиксированы;
- финальный GLB воспроизводимо собирается из исходника, а не существует только как вручную сохранённый `.blend`;
- в GLB нет салона, двигателя, подкапотного заполнения, подвески, выхлопа, повреждённых вариантов, исходных collision/shadow/LOD-дубликатов и неиспользуемых текстур;
- внешние панели, силуэт, арки, стойки, стыки, решётки, зеркала, видимые кромки и заводские световые секции выдержали визуальное сравнение;
- оси, ориентация, winding, normals и transforms нормализованы: вверх `+Y`, нос `+Z`, левая сторона машины `+X`, масштабы положительные;
- четыре колеса имеют корректные центры; заводские база, передняя/задняя колея, радиус и ширина шины совпадают с выбранной модификацией;
- каждый независимо управляемый световой канал является отдельным семантическим mesh node;
- кузов, стекло, окраска, загрязнение, повреждения и тени работают в реальном рендере;
- модель зарегистрирована в `src/vehicle/carmodels.ts`, а статический fit записан в `src/vehicle/model-fits.json`;
- двигатель, коробка, масса, развесовка, аэродинамика, привод, рулевое и подвеска описывают одну и ту же заводскую модификацию;
- подходящий радиатор устанавливается в заводское состояние и выдерживает тепловой режим;
- реальный `Vehicle` проходит стенды динамики, а не только компиляцию;
- машина вручную управляема и отдельно проверена под штатным `Autopilot` на асфальте, рыхлом покрытии, в поворотах, при объезде и возврате на дорогу;
- она появляется через dev spawn, в трафике и среди статических машин, переживает save/load и не ломает размещение POI;
- `npm run check` и `npm run build` проходят после всех изменений.

Компиляция или успешная загрузка GLB сами по себе не являются приёмкой.

## 2. Карточка задания: обязательный вход кроме архива

Для каждой машины нужна одна карточка задания. До появления общего wrapper её можно хранить как `build/vehicles/<id>/job.json`; `build/` уже исключён из Git. Данные, необходимые для воспроизводимости, должны затем попасть в комментарии профильного импортёра или другой отслеживаемый source manifest.

Минимальная форма:

```json
{
  "schema": 1,
  "id": "gt_vaz2110",
  "label": "VAZ-2110",
  "source": {
    "archive": "dlc.rpf",
    "kind": "rpf7-yft",
    "member": "x64/vehicles.rpf/<exact-name>.yft",
    "sha256": "<sha256>",
    "license": "<origin, author, redistribution terms>"
  },
  "variant": {
    "year": 1999,
    "market": "RU",
    "body": "sedan",
    "lampVersion": "<supplier/version>"
  },
  "factory": {
    "lengthM": 4.265,
    "widthM": 1.68,
    "heightM": 1.42,
    "clearanceM": 0.17,
    "wheelbaseM": 2.492,
    "frontTrackM": 1.41,
    "rearTrackM": 1.38,
    "wheelRadiusM": 0.288,
    "tyreWidthM": 0.175
  },
  "vehicle": {
    "bodyClass": "car",
    "kerbMassKg": 1030,
    "frontWeightShare": 0.62,
    "tankLitres": 43,
    "drive": "FWD",
    "dragAreaM2": 0.63
  },
  "engine": { "reuse": "engine_samara_1500" },
  "gearbox": { "reuse": "gearbox_samara_5" },
  "wheels": {
    "reuseFrom": ["sv_vaz2101", "sv_gaz24"],
    "factoryTyre": "175/70 R13"
  },
  "budgets": {
    "bodyTriangles": 30000,
    "wheelTrianglesEach": 2200
  }
}
```

Числа выше — пример структуры, а не универсальный шаблон для всех ВАЗ-2110. Год, двигатель, коробка, масса, шины и оптика обязаны относиться к одной версии автомобиля.

К карточке добавляется таблица источников: URL/название документа, год издания или дата страницы, конкретная страница/таблица и какое поле она подтверждает. GTA `handling.meta`, имя архива и подпись модели не считаются заводским источником. У имеющегося VAZ-2110 метаданные остались от Camry-шаблона; геометрия, bone names и независимые документы надёжнее.

## 3. Артефакты и неизменяемость исходника

Рекомендуемая рабочая раскладка:

```text
build/vehicles/<id>/
  00-intake/       исходный архив, hash, безопасный список членов
  10-inspect/      полный inspection GLB, hierarchy/parts report, screenshots
  20-normalized/   кузов и колёса после классификации, до облегчения
  30-geometry/     облегчённая геометрия и отчёт до/после
  40-lamps/        кузов с семантически нарезанными фонарями
  50-assembled/    единый несжатый runtime GLB
  60-release/      meshopt GLB-кандидат
  70-reports/      audit, validate, measurements, dynamics, visual checklist
```

Правила:

1. `00-intake` никогда не изменяется на месте.
2. Каждый этап читает предыдущий каталог и пишет следующий.
3. Повторный запуск с тем же hash и теми же версиями инструментов даёт тот же результат.
4. Финальный файл копируется в `public/models/<pack>/<slug>.glb` только после прохождения ворот.
5. В Git попадают финальный GLB, изменения каталога/агрегатов/fit и модель-специфичный Blender/Python script. Сырые архивы, `.blend` и промежуточные файлы остаются в `build/`.
6. Ошибка не оставляет частично перезаписанный production-файл: запись идёт во временное имя, затем выполняется атомарная замена после аудита.
7. Отчёт хранит hash финального GLB, количество треугольников по ролям, размер, команды и версии Python/Blender/Node/Bun/glTF-Transform.

## 4. Схема конвейера

```text
архив + карточка + источники
  -> безопасный intake и выбор ровно одного исходного автомобиля
  -> полный inspection без удаления геометрии
  -> явная keep/drop/classification карта
  -> нормализация осей, transforms и материалов
  -> удаление скрытого целыми компонентами
  -> облегчение внешности по ролям с визуальным A/B
  -> колёса и заводская геометрия
  -> нарезка заводских световых функций
  -> сборка runtime contract
  -> meshopt-сжатие без скрытой повторной simplification
  -> каталог + агрегаты + fit
  -> геометрические, физические, тепловые и интеграционные стенды
  -> дневная/ночная проверка в игре
  -> публикация или полный откат кандидата
```

Каждая стрелка — контрольные ворота. Нельзя «починить позже» неверную модификацию, перепутанные оси или исчезнувший после decimate дверной кант настройками физики.

## 5. Этап A: безопасный intake и распаковка

### A1. Preflight

Проверить наличие и зафиксировать версии:

```sh
node --version
bun --version
python --version
blender --version
npx gltf-transform --version
```

Для DFF Blender должен видеть DragonFF. Если `blender` не находится в `PATH`, wrapper должен принимать явный путь к executable и останавливаться до обработки, а не пропускать Blender-этап.

### A2. Архив

- Определять формат по magic bytes, не только по расширению.
- Сначала строить список членов, затем извлекать.
- Запрещать абсолютные пути, `..`, symlink/reparse-point выходы из staging, device names и повторяющиеся пути с разным регистром.
- Ограничивать число файлов, суммарный распакованный размер и коэффициент распаковки. Большой архив допустим; zip bomb — нет.
- Не запускать скрипты и executable из пакета.
- Выбирать конкретный model member из карточки. «Первый подходящий файл» недопустим для многомодельного архива.
- Хешировать сам архив и выбранный model member.
- Проверить право на преобразование и распространение результата до трудоёмкого authoring.

Текущего универсального безопасного unpacker в `tools/` нет. Это обязательная часть будущего wrapper, а не функция `import-yft-vehicle.py` или Blender.

### A3. Маршрутизация формата

| Вход | Текущий маршрут | Ограничение |
| --- | --- | --- |
| RPF7 / YFT | `tools/import-yft-vehicle.py` | RPF reader переиспользуем, но `DROP_BONES`, shader roles, lamp bones и выбор первого non-`_hi` YFT сейчас заточены под VAZ-2110. Для новой машины нужен новый профиль классификации и явный member selector. |
| GTA SA DFF | Blender + DragonFF + `tools/import-dff-pack.py` | `MODELS` и флаги зашиты в script; новый автомобиль сначала добавляется как явный `Model`, затем проверяется inspection. |
| FBX | `tools/fbx-inspect.mjs`, Blender, затем GLB | Inspector показывает именно то дерево, которое увидит Three. Сам по себе он ничего не нормализует. |
| OBJ/MTL | `tools/obj-to-glb.mjs` | Подходит только когда source naming соответствует его правилам `frontleft`/`frontright`/rear/body. Это не общий автомобильный импортёр. |
| GLB/glTF | `gltf-transform inspect/validate`, Blender при необходимости | Уже готовый GLB всё равно проходит классификацию, оси, свет, колёса и бюджеты. |
| Прочий формат | Blender import + новый детерминированный adapter | Ручной экспорт допустим для inspection, но production-путь фиксируется script'ом. |

## 6. Этап B: полная инспекция до удаления

Главное правило: сначала увидеть всё, потом решать по именам. Regex и bone name — ускорители, не доказательство назначения детали.

### B1. Форматные команды

YFT/RPF:

```sh
python tools/import-yft-vehicle.py inspect <archive.rpf> build/vehicles/<id>/10-inspect
```

Результат должен содержать полный `*-source.glb` и `parts.md`: объект/bone, shader, bounds, triangles и текущую классификацию. Для нового профиля имя выходного файла не должно оставаться `vaz2110-source.glb`.

DFF:

```sh
blender --background --factory-startup --python tools/import-dff-pack.py -- <model-id>
```

Перед production-нормализацией открыть исходный DFF через DragonFF и составить ту же карту объектов. Текущий script сразу нормализует перечисленные `MODELS`; будущий wrapper должен иметь отдельный inspection mode.

FBX:

```sh
node tools/fbx-inspect.mjs <file.fbx>
node tools/model-audit.mjs <model-directory>
```

GLB:

```sh
npx gltf-transform inspect <file.glb>
npx gltf-transform validate <file.glb>
```

`model-audit.mjs` надёжен для FBX и texture-free GLB. Для GLB со встроенными изображениями использовать `gltf-transform inspect`: headless image path `model-audit` для этого не предназначен.

### B2. Карта содержимого

Каждый объект/geometry group получает одно решение:

- `KEEP_EXTERIOR` — наружная панель, бампер, решётка, зеркало, молдинг, эмблема, видимая часть арки/дна;
- `KEEP_GLASS` — только окна;
- `KEEP_LAMP:<role>` — только видимая линза конкретной функции;
- `KEEP_WHEEL_MOUNT` — геометрия/узел, центр которого задаёт ось;
- `KEEP_MOVING_WHEEL` — шина, диск, ступица и видимая деталь, которая обязана двигаться с колесом;
- `DROP_INTERIOR` — сиденья, dashboard, steering wheel, cards, ковры, педали и салонная мелочь;
- `DROP_ENGINE_BAY` — двигатель, радиатор исходной модели, выхлоп и подкапотная декорация;
- `DROP_RUNNING_GEAR` — исходная подвеска, мост/рычаги, если они не являются видимой частью wheel assembly;
- `DROP_GAME_HELPER` — collision, shadow, damage, LOD duplicate, dummy, camera, light, neon, animation helper;
- `REVIEW` — всё неоднозначное.

На выходе `REVIEW` должен быть пуст. Сумма треугольников keep/drop обязана совпасть с исходной суммой.

### B3. Визуальный inspection

В Blender проверить:

- наружность с четырёх сторон, сверху и снизу;
- что находится за окнами после удаления салона;
- что видно через решётку, воздухозаборники и арки;
- не является ли «door card» второй совпадающей оболочкой;
- какие прозрачные поверхности лежат перед линзами;
- где реальные центры осей и правильно ли подписаны стороны;
- есть ли отрицательные parent scales, armature transforms или неприменённые rotations;
- какая геометрия повторяется в high/low/damaged variants.

Blender MCP, когда подключён, удобен для этих выборок, разрезов, измерений и снимков. Он не является build authority: итоговые операции переносятся в детерминированный Blender Python script, как `tools/split-vaz2110-lamps.py`.

## 7. Этап C: нормализация геометрии

### C1. Оси и transforms

Runtime contract:

- `+Y` вверх;
- `+Z` вперёд, туда автомобиль едет под газом;
- `+X` влево по ходу;
- transforms применены к geometry;
- нет отрицательных scales;
- правое колесо получается поворотом на `π` вокруг вертикали, а не mirror/negative scale;
- normals и winding направлены наружу.

Для GTA V текущая правильная замена координат: `(x, y, z) -> (-x, z, y)`, determinant `+1`. Для GTA SA нормализатор запекает поворот на пол-оборота после Blender glTF Y-up conversion. Не переносить эти формулы на новый формат без проверки.

`CarModelDef.yaw` существует, но офлайн-запекание предпочтительнее. Loader отсоединяет wheel nodes; неверный parent rotation способен оставить колесо в wheelbase от подвески.

### C2. Что удалять целиком

Первый и самый выгодный уровень оптимизации — удалить целые скрытые компоненты:

- салон, приборы, steering wheel и сиденья;
- двигатель и подкапотное заполнение;
- исходную подвеску и выхлоп;
- damage variants;
- collision/shadow meshes;
- VLO/LOD duplicates, которые runtime не выбирает;
- камеры, источники света и анимационные helper'ы;
- внутренние крепежи и невидимую мелочь.

Не decimate интерьер, который всё равно не показывается: удалить его дешевле и визуально безопаснее.

Исключения определяются видимостью:

- В DFF-паке сохраняются авторские inner door cards полных `*_ok` дверей: они закрывают вид через окно.
- В YFT VAZ-2110 door cards являются почти совпадающей второй оболочкой и после удаления салона вызывают crater artifacts при decimate; их нужно удалить.
- Если через решётку после удаления двигателя видна пустота, добавить маленький тёмный `bulkhead` внутри носа.
- Если shell открыт снизу, добавить неглубокий закрытый `underbody` внутри порогов. Если настоящее дно уже закрыто, не прятать внутри него лишнюю плиту.

### C3. Материальные роли

Нормализованный texture-free путь использует небольшое число ролей:

- `car_paint` — окрашенные наружные панели;
- `car_trim` — решётки, бамперы, молдинги, закрывающие пластины;
- `car_glass` — только окна;
- материалы ламп — только видимые lens faces;
- `Tyres` — резина;
- `wheel_rim` — диск/металл колеса и, по существующему соглашению, не перекрашиваемая грузовая платформа.

`paintStyle: 'solid-paint'` и `glassMaterial: 'car_glass'` обязательны для такого GLB. Слова `Lamp`/`Light`, `glass`, `trim`, `tyre`/`tire`, `wheel` в именах защищают материалы от перекраски кузова.

Удаление PBR-карт, которые текущий renderer не использует:

```sh
node tools/strip-glb-maps.mjs <input.glb> --dry-run
node tools/strip-glb-maps.mjs <input.glb> <output.glb>
```

Сохраняется base color; normal, occlusion, emissive и metallic-roughness slots удаляются. Это уменьшает bytes, а не triangle count. Если renderer начнёт использовать эти карты, правило нужно пересмотреть до запуска инструмента.

## 8. Этап D: облегчение без потери внешности

### D1. Правильный порядок

1. Удалить целые невидимые объекты.
2. Удалить дубликаты LOD/damage/collision.
3. Объединить геометрию только внутри одной семантической/material роли.
4. Weld совпадающие вершины до decimate. В DFF используется `remove doubles` с `0.0008` source units; для нового масштаба допуск измеряется заново.
5. Сохранить hard edges по дверным стыкам, аркам, граням капота, бамперам и штамповкам. DFF script использует Edge Split около `32°` как исходную точку, не как закон для всех моделей.
6. Упростить плоские и скрытые области вручную/planar dissolve.
7. Decimate отдельно для `paint`, `trim`, glass и каждой лампы. Никогда не прогонять весь кузов одним modifier: маленькая важная деталь проиграет большой гладкой панели.
8. Линзы и уже утверждённые разрезы не упрощать автоматически.
9. После topology change пересчитать normals, проверить non-manifold/open edges там, где нужна закрытая оболочка.
10. Выполнить визуальный A/B. Только после его одобрения переходить к свету и финальной сборке.

### D2. Бюджет

Существующий DFF-путь задаёт хороший старт для плотного исходника:

- около `30 000` треугольников на весь body;
- до `2 200` на каждое полное колесо до переиспользования;
- отдельные лампы получают только нужные lens faces;
- один mesh node на роль, если семантика не требует разделения.

Это стартовый бюджет, не повод испортить силуэт. Нынешний VAZ-2110 сохранён без decimate — `330 268` треугольников; он является доказательством работоспособности YFT path, но не целевым образцом минимальной геометрии.

Бюджет утверждается по наблюдаемому результату:

- close-up: `2–3 m`, все стороны, блики по панелям;
- gameplay: `8–15 m`, обычная камера;
- traffic/POI: `30–80 m`;
- силуэт на контрастном фоне;
- арки и колёса в движении;
- день, сумерки и ночь;
- чистый кузов и dent/dirt shader.

Последовательность кандидатов: например `100% -> 50% -> 35% -> 25%`. Выбирается самый лёгкий кандидат, который не отличается от предыдущего одобренного на gameplay-дистанции и не имеет явно ломаного силуэта close-up. Автоматическая image metric может отсеивать грубые ошибки, но финальное решение принимает visual gate.

### D3. Что нельзя жертвовать первым

Сохранять приоритетно:

1. внешний силуэт, roofline, стойки, арки;
2. sharp panel seams и характерные штамповки;
3. контур решётки, бамперов и оптики;
4. зеркала, ручки и эмблемы, заметные с игровой камеры;
5. геометрию, на которой виден specular highlight;
6. правильные lens boundaries.

Сначала сокращать невидимые поверхности, плоские внутренние стороны, слишком плотные ровные панели и круги с избыточным числом segments.

Runtime сейчас не выбирает несколько кузовных LOD этой машины. Не экспортировать неиспользуемые LOD «на будущее»: это только bytes и память. Добавление реального runtime LOD — отдельная функция renderer, не часть импорта одной машины.

## 9. Этап E: колёса, база, колея и пропорции

### E1. Авторитетные данные

Для выбранной модификации фиксируются:

- полная длина/ширина без зеркал/высота;
- минимальный дорожный просвет;
- wheelbase;
- передняя и задняя track;
- заводской размер шины и вычисленный loaded/rolling radius;
- tyre width;
- положение осей относительно силуэта.

Одного общего масштаба недостаточно, если исходник имеет неверные пропорции. Сначала в Blender наложить side/front/top reference и поправить кузов, затем использовать wheelbase для uniform source scale. Runtime дополнительно вписывает кузов по `FactoryGeometry`, но большой разнобой осевых scale factors означает, что исходник неверен: нельзя скрывать деформированный roofline автоматическим X/Y/Z fit.

Рекомендуемые ворота до каталога:

- wheelbase, track, wheel radius: ошибка не более `0.5%`;
- length/width/height: не более `1%`;
- левый/правый mounts симметричны, если реальный автомобиль симметричен;
- остаточная runtime non-uniform correction по каждой оси желательно не больше `2–3%`.

### E2. Центры колёс

- Для DFF брать wheel dummies, не body bounds.
- Для YFT брать skeleton translations `wheel_lf/rf/lr/rr`.
- Для обычной модели использовать центр bounding box полного wheel assembly.
- Перед размещением source wheel geometry центрировать на собственной оси.
- Экспортировать ровно `wheel_fl`, `wheel_fr`, `wheel_rl`, `wheel_rr`.
- Если ступица/видимая полуось отдельна, включить её в соответствующий `wheelNodes` slot (`['wheel_fl', 'hub_fl']`), иначе она останется неподвижной в кузове.
- Проверять обе стороны: right-hand copies не должны быть inside-out.

### E3. Переиспользование колёс ВАЗ/ГАЗ

`CarModelDef.wheelSetPool` уже переиспользует визуальный wheel set. `cloneWheels` берёт стиль donor'а, но масштабирует rolling radius и tyre width по `factory` целевой машины. Положение остаётся от mounts целевой машины.

Выбор:

- полный `SOVIET_WHEEL_SET_POOL` — только если допустима детерминированная вариативность дорожных колёс ВАЗ/ГАЗ;
- массив из одного donor id — когда нужен один точный заводской стиль;
- собственные колёса — для Нивы, грузовика, внедорожной шины или уникального диска.

Не использовать дорожное колесо только потому, что оно уже есть: bolt pattern в игре не моделируется, но диаметр, ширина, пропорция диска/шины и назначение автомобиля видны.

Для нормализованной геометрии с одним чёрным wheel material:

```sh
node tools/rim-split.mjs <input.glb> <output.glb>
```

Инструмент делит rim радиально по `0.65` wheel radius. Это heuristic. На ажурном/глубоком/нестандартном диске визуально проверить границу; при ошибке сделать детерминированный Blender split вместо изменения общего коэффициента под одну модель.

## 10. Этап F: свет

Полный процесс задан в `tools/vehicle-lamp-authoring.md`.

### F1. Сначала заводская схема

Утвердить точные год, рынок и поставщика/версию фонарей. Нужны фотографии с выключенным светом плюс wiring diagram, bulb chart или маркированная фотография. Не считать всю красную область стоп-сигналом и не использовать тюнингованную оптику как заводскую.

### F2. Семантический node contract

| Node | Назначение |
| --- | --- |
| `headlights` | ближний/дальний свет |
| `taillights` | задние габариты |
| `brake_lights` | отдельные стоп-секции |
| `reverse_lights` | задний ход |
| `front_blinker_left`, `front_blinker_right` | передние поворотники |
| `rear_blinker_left`, `rear_blinker_right` | задние поворотники |
| `rear_passive` | отражатели/декор/неуправляемая секция |
| `front_auxiliary` | видимая, но неуправляемая передняя линза |

Не создавать пустые nodes. Совмещённая заводская габарит/стоп-секция может не иметь `brake_lights`; раздельная обязана иметь обе.

### F3. Нарезка

1. Сначала separate loose connected components.
2. Если mesh пересекает настоящую границу секций — Knife/Bisect строго по заводскому seam.
3. Separate faces по функциям.
4. Housing, bezel и reflector оставить trim/passive; controlled node содержит только видимую lens surface.
5. Удалить или переназначить прозрачную оболочку перед emissive lens: иначе фонарь светится невидимо.
6. Сохранить transforms/normals/winding.
7. Записать измеренные planes/conditions в отдельный script. Координаты `split-vaz2110-lamps.py` запрещено копировать на другую модель.

Blender MCP может выполнить интерактивную нарезку и показать результат. После утверждения операции повторяются headless script'ом на чистом входе.

### F4. Материалы и каталог

Рекомендованные имена: `Headlights`, `IndicatorLights`, `TailLights`, `BrakeLights`, `ReverseLights`, `PassiveRearLights`, `AuxiliaryLights`. Base color — цвет выключенной линзы в linear RGB; runtime добавляет emission.

В `CarModelDef.lights` перечисляются только реальные controlled nodes:

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

`rear_passive` и `front_auxiliary` никогда не попадают в selectors.

### F5. Обязательная матрица

В реальном renderer проверить:

1. всё выключено;
2. headlights: светятся передние фары и только задние running sections;
3. brake;
4. reverse;
5. left indicator;
6. right indicator;
7. repaint body;
8. те же состояния ночью с projected beams;
9. обе стороны close-up.

Материальные имена и наличие nodes не доказывают, что внутрь попали правильные faces.

## 11. Этап G: сборка и финальная компрессия

### G1. YFT-путь

Текущая последовательность VAZ-2110:

```sh
mkdir -p build/vehicles/<id>/20-normalized \
  build/vehicles/<id>/50-assembled build/vehicles/<id>/60-release
python tools/import-yft-vehicle.py extract <archive.rpf> build/vehicles/<id>/20-normalized
cp build/vehicles/<id>/20-normalized/body.glb \
  build/vehicles/<id>/20-normalized/body-lod.glb
cp build/vehicles/<id>/20-normalized/wheel.glb \
  build/vehicles/<id>/20-normalized/wheel-lod.glb
blender --background --python <per-model-lamp-script.py> -- \
  build/vehicles/<id>/20-normalized/body-lod.glb \
  build/vehicles/<id>/20-normalized/body-lamps.glb
python tools/import-yft-vehicle.py assemble build/vehicles/<id>/20-normalized \
  build/vehicles/<id>/50-assembled/car.glb
node tools/rim-split.mjs build/vehicles/<id>/50-assembled/car.glb \
  build/vehicles/<id>/50-assembled/car-rim.glb
npx gltf-transform optimize build/vehicles/<id>/50-assembled/car-rim.glb \
  build/vehicles/<id>/60-release/car.glb \
  --compress meshopt --simplify false --palette false \
  --join-named false --texture-compress false
```

Текущий `extract` не создаёт output directory, а `assemble` ожидает `body-lamps.glb`, `wheel-lod.glb` и `mounts.json` в одном build directory. Поэтому команды выше явно создают и сохраняют его layout. Общий wrapper должен передавать пути явно или делать проверяемые копии с hashes; молчаливые копии между каталогами недопустимы.

### G2. DFF-путь

1. Добавить профиль в `MODELS` с осознанными `body_target`, `needs_underbody`, `soviet_wheels`, `needs_bulkhead`, `has_cargo_bed`.
2. Запустить Blender normalizer.
3. Выполнить модель-специфичную lamp authoring стадию, если source lenses не разделены.
4. Применить `rim-split`.
5. Применить тот же `gltf-transform optimize` с `--simplify false`, `--palette false`, `--join-named false`.

`--join-named false` сохраняет семантические nodes. `--simplify false` запрещает второй, неконтролируемый topology pass после визуально утверждённого Blender decimate. `--palette false` не создаёт texture palette в texture-free contract.

### G3. Контракт финального GLB

- один body mesh на material role, если свет не требует большего;
- четыре wheel nodes и все относящиеся к ним moving parts;
- только необходимые `underbody`, `bulkhead`, `bed`;
- semantic lamp nodes;
- ноль source cameras/lights/animations;
- ноль engine/interior/damage/collision/shadow/LOD nodes;
- положительные scales;
- отсутствие неиспользуемых UVs у texture-free модели;
- meshopt compression, которую runtime декодирует через `MeshoptDecoder`.

## 12. Этап H: регистрация в runtime

### H1. Файлы

- GLB: `public/models/<pack>/<slug>.glb`;
- factory geometry и entry: `src/vehicle/carmodels.ts`;
- статический fit: `src/vehicle/model-fits.json`;
- новый engine/gearbox/radiator variant при необходимости: `src/parts/registry.ts`;
- повторяемые source-specific операции: `tools/<model>-*.py` или профиль общего importer.

Stable `id` попадает в saves. После публикации его нельзя переименовывать как косметическую метку; clean rename требует миграции сохранений.

### H2. `FactoryGeometry`

В `FACTORY_GEOMETRY` добавить все девять полей:

```ts
{ length, width, height, clearance, wheelbase,
  frontTrack, rearTrack, wheelRadius, tyreWidth }
```

Именно они авторитетны для body fit, axle positions и rolling radius. Published width не включает зеркала: loader измеряет нижние `55%` shell для корпуса и задаёт collider width из factory width.

### H3. `CarModelDef` entry

Обязательные решения:

- `bodyClass`;
- `scale` из factory wheelbase / source wheelbase;
- kerb `mass`;
- `engineId`, `gearboxId`, `tankLitres`;
- `wheelGrip`, при исключении `longitudinalGripScale`;
- `suspension`;
- `steerLock`;
- `rearDriveBias`: `0` FWD, `1` RWD, `0.5` 4WD;
- `handlingProfile`: `classic`, `road`, `sport` или `utility`;
- `frontWeightShare`, когда нужна измеренная развесовка;
- `dragArea = Cd * frontal area`;
- `wheelSetPool`/`wheelNodes`;
- paint/glass/lights.

Добавление в `CAR_MODELS` автоматически делает модель видимой dev spawn, traffic и POI-коду; отдельного «реестра автопилота» нет.

### H4. Fit manifest

`model-fits.json` нужен до загрузки visuals: physics и POI используют bounds/mounts/anchors/hood point до streaming GLB. После `preloadCarModels([id])` вычисленный `carModelMeasure(id)` становится авторитетным результатом `buildTemplate`.

Сейчас отдельного генератора fit нет, а `carmodels.ts` требует fit уже при создании entry. Ручной bootstrap:

1. добавить временный fit из factory bounds и wheel mounts;
2. загрузить модель через dev server;
3. в dev console выполнить:

```js
const cars = await import('/src/render/carmodel.ts');
await cars.preloadCarModels(['<id>']);
console.log(JSON.stringify(cars.carModelMeasure('<id>'), null, 2));
```

4. заменить временную запись точным результатом;
5. перезагрузить и сравнить manifest measure с loaded measure.

Это известный разрыв автоматизации. Будущий `generate-car-fit` должен вызывать один и тот же measurement code, а не заново реализовывать bounds math.

## 13. Этап I: двигатель, коробка и охлаждение

### I1. Переиспользовать или создавать

Переиспользовать variant можно только если совпадают реальный агрегат и calibration convention. Одинаковый объём не означает одинаковую кривую, redline или final drive.

Новый `EngineSpec` задаёт:

- fuel;
- factory peak crank power, kW;
- indicated `peakTorqueNm`;
- `torquePeakRpm`, `redlineRpm`, `idleRpm`;
- `bsfc`;
- `brakingCoeff`;
- cylinder count;
- только необходимые heat overrides.

Важная convention: drivetrain вычитает mechanical/pumping loss на каждом шаге. Поэтому `peakTorqueNm` — не опубликованный net torque. В точке torque peak:

```text
net_factory = indicated - brakingCoeff * omega_peak - 0.03 * indicated
indicated = (net_factory + brakingCoeff * omega_peak) / 0.97
omega_peak = torquePeakRpm * 2π / 60
```

Сначала выбрать физически правдоподобный `brakingCoeff`, затем вычислить indicated torque и подтвердить разгон стендом. `peakPowerKw` влияет на тепловую модель, но форму тяги в `Drivetrain` задают torque peak/redline/torque curve; копирование одной мощности не калибрует разгон.

Новый `GearboxSpec` задаёт:

- все forward ratios;
- reverse ratio;
- final drive;
- реальное время разрыва тяги `shiftTime`;
- `automatic`.

Transfer/high-range reduction, если отдельного поля нет, включается в final drive только с явным комментарием, как у Niva.

### I2. Масса и аэродинамика

- `mass` — kerb mass всей комплектной машины, не масса голого GLB.
- `model.mass` уже является массой всей комплектной машины. Текущий `Vehicle.computeStats()` добавляет к ней только массы установленных cosmetic gizmos; массы service engine/radiator/gearbox отдельно не суммируются, поэтому повторно добавлять их к kerb mass нельзя.
- `frontWeightShare` брать из axle scale measurement. Если данных нет, runtime fallback выводит долю из body class/drive layout, но это временное приближение, а не заводская точность.
- `dragArea` — `Cd*A`, не один `Cd`. Без него используется общий fallback по bounding box, подходящий лишь для средней старой легковой формы.

Порядок calibration: реальные масса/колёса/ratios -> engine curve -> drag area/top speed -> grip/brakes -> suspension/steering. Иначе один tuning knob маскирует ошибку другого.

### I3. Радиатор

`engineHeat()` выводит сбалансированный heat profile из fuel, power и cylinders; override нужен только при доказанном отличии. `preferredRadiatorClass()` выбирает минимальный класс, способный удержать двигатель. Заводское состояние через `createBonnetStorage()` уже ставит:

- `radiator_small` для small;
- `radiator_standard` для standard;
- `radiator_copper` для large.

Создавать новый radiator variant стоит только если нужны отдельные capacity/cooling/mass/visual identity. Не создавать копию существующего класса ради имени модели. Если нужен новый variant, добавить mesh blueprint части, fit body classes и проверить service/inventory UI.

## 14. Этап J: подвеска и ощущение управления

«Как в реальности» переводится в измеримые targets. Минимальный паспорт:

- static front/rear weight split;
- ride frequency front/rear;
- compression/rebound damping ratio;
- bump travel и settled clearance;
- 0–100 или 0–80, top speed;
- 100–0/80–0 distance на period-correct tyre/road;
- outer-front-wheel turning radius или turning-circle diameter с явно указанным определением;
- steady lateral acceleration и характер breakaway;
- body roll/dive и settle time;
- поведение на рыхлом покрытии и уклоне.

`SuspensionTuning` хранит инженерные величины, а не Rapier constants:

- `frontHz`, `rearHz`;
- `compressionRatio`, `reboundRatio`;
- `bumpTravel`.

Runtime переводит частоты в per-kilogram spring rate с учётом фактической нагрузки каждого колеса. Не копировать stiffness от машины другой массы.

`handlingProfile` выбирает механизм эпохи: люфт/скорость руля, driveline lag, bias-ply/radial response, relaxation и axle balance. Сначала выбрать ближайший существующий профиль. Новый профиль допустим только если у класса есть другой физический механизм, а не потому, что одна машина не попала в top speed.

`wheelGrip` калибруется по period road-test lateral/braking data, не по ощущению «слишком скользко». `steerLock` калибруется turning radius. Не путать radius траектории центра кузова из `handling-bench` с factory outer-wheel radius: `tools/soviet-reality.ts` явно приводит их к одному определению.

Рекомендуемые стартовые допуски при достоверном reference:

| Метрика | Ворота |
| --- | ---: |
| top speed | `±5%` |
| acceleration time | `±8%` |
| turning radius | `±3%` |
| braking distance | `±10%` |
| steady lateral g | `±0.03 g` |
| ride frequency | `±0.05 Hz` |
| front weight share | `±1 percentage point` |
| settled clearance | `±10 mm` |

Если reference диапазон шире, ворота должны отражать диапазон, а не выдуманную точность.

## 15. Этап K: автопилот

Архитектурно `Autopilot` не имеет списка разрешённых моделей. Он читает реальную wheelbase/axles через `vehicle.modelMeasure`, а `Vehicle.steeringInputForWheelAngle` инвертирует `steerLock`, high-speed reduction, exponent и люфт конкретной машины. Поэтому правильная регистрация делает машину доступной, но не доказывает, что она пройдёт маршрут.

Для каждой новой модели нужны отдельные сценарии:

1. sleeper и frantic на реальной дороге: progress, asphalt bounds, lane RMS/worst, oscillation count;
2. самый тесный поворот: скорость ниже lateral budget и достаточно steer authority;
3. гравий/песок: progress без бессмысленного wheelspin;
4. passable hazard: объезд с clearance;
5. непроходимая преграда: остановка, не удар;
6. потеря дороги: медленный возврат в полосу до разгона;
7. застревание: reverse/pull-out recovery;
8. ночной свет, встречный автомобиль и indicators;
9. disengage: человеческий input не изменён;
10. трафик: обе стороны едут, no impacts, lifecycle/despawn корректны.

Текущие `tools/autopilot-bench.ts` и `tools/playground-lap.ts` используют hard-coded `sv_vaz2105r`. Их успешный прогон защищает общий controller, но не новую машину. До настоящего one-button pipeline они должны принимать `modelId` CLI-параметром и использовать тот же id для ego/traffic там, где это допустимо. Временно обязательна ручная проверка нового id через dev spawn на обычной дороге; нельзя засчитывать hard-coded bench как per-model proof.

## 16. Ворота проверки и команды

### Gate 1: asset contract

Для texture-free нормализованных DFF/YFT:

```sh
node tools/dff-pack-audit.mjs public/models/<pack> [--wheels-complete]
npx gltf-transform inspect public/models/<pack>/<car>.glb
npx gltf-transform validate public/models/<pack>/<car>.glb
```

`--wheels-complete` означает, что wheel node уже содержит tyre/rim/hub/axle и отдельные `hub_*` не нужны. Аудит проверяет материалы, отсутствие images/textures, semantic lamps, четыре колеса, positive scales, nose direction и outward winding.

У meshopt-файла validator может вывести informational `UNSUPPORTED_EXTENSION` для `EXT_meshopt_compression`. Допустим только результат без errors/warnings при одновременной успешной загрузке тем же `MeshoptDecoder`, который использует runtime.

`tools/verify-glbs.mjs` — независимый validator для legacy `body` + `wheel-front-left/right/back-*` или standalone `wheel` layout, главным образом после `obj-to-glb`. Не применять его как замену DFF audit к `wheel_fl` contract.

### Gate 2: geometry/fit

- сравнить source/normalized/final triangle counts по ролям;
- подтвердить четыре wheel nodes и moving hub membership;
- загрузить final GLB и снять `carModelMeasure`;
- сравнить length/width/height/clearance/wheelbase/tracks/radius с карточкой;
- проверить hood camera и все gizmo anchors;
- осмотреть underside, grille и окна.

### Gate 3: dynamics

```sh
npx tsx tools/handling-cli.ts <modelId>
npx tsx tools/suspension-probe.ts <modelId>
```

`handling-cli` выводит 0–100, speed after 20 s, top speed, braking, axle lock, yaw, ride height, bounce, settle, skidpad, slip, roll, turning radius и lateral limit. Даже при переданном одном id он дополнительно запускает глобальные incline/parking/automatic regressions на текущих fixed model ids.

`suspension-probe` выводит measured/intended weight split, static sag, reserve, requested/measured frequency/damping, texture heave/jolt и brake dive/load transfer. Текущая строка `target NaN` для clearance обращается к удалённому `susp.rideHeight`; использовать measured clearance против `FactoryGeometry.clearance`, пока probe не исправлен.

Для measured-vs-real таблицы существует:

```sh
npx tsx tools/soviet-reality.ts [modelId ...]
```

Но `REAL` сейчас содержит только Soviet pack ids. Новый pipeline должен иметь общий per-model reality manifest или расширенный bench; голые числа `handling-cli` без реальных targets не доказывают соответствие.

### Gate 4: cooling/service при новом агрегате

```sh
bun tools/cooling.ts
bun tools/cooling-drive.ts
bun tools/service.ts
```

- `cooling.ts` проверяет математическую thermal model и radiator class fit;
- `cooling-drive.ts` проверяет wiring через реальные `Vehicle`, замену радиатора, overheat/power loss/stall/cool-down, но сейчас hard-coded на UAZ;
- `service.ts` проверяет containers, длительное разрушение двигателя и замену, также на representative UAZ.

При новом engine обязательны global `cooling.ts` и отдельный прогон нового агрегата под полной нагрузкой/на холостом ходу. Нельзя считать UAZ integration run проверкой уникального нового engine.

### Gate 5: каталог и мир

```sh
bun tools/traffic-bench.ts
npx tsx tools/wreck-spacing.ts
npx tsx tools/trunk-grid.ts
npx tsx tools/anchor-parts.ts
bun tools/runtime-lifecycle.ts
bun tools/autosave.ts
```

Назначение:

- traffic: catalogue-only ids, движение обеих сторон, свет, обгоны, no impacts, despawn;
- wreck spacing: реальные footprint всех моделей не пересекаются в POI;
- trunk grid: catalog contract и save migration общей сетки;
- anchor parts: service parts не предлагаются на cosmetic anchors;
- runtime lifecycle: load/unload/floating-origin/loose parts/trailer representative path;
- autosave: состояние света/машины и save code.

`traffic-bench` выбирает детерминированную случайную подвыборку и может не заспавнить новый id в конкретном прогоне. Нужен отдельный forced-id traffic scenario до полной автоматизации.

### Gate 6: vehicle-wide regressions при изменении общей физики

Если импорт потребовал изменения `Vehicle`, `Drivetrain`, `Autopilot`, surface/tyre model или общего handling profile, дополнительно:

```sh
npx tsx tools/surface-feel.ts [speedKmh]
npx tsx tools/ride-bench.ts [speedKmh]
npx tsx tools/desert-washboard.ts [speedKmh]
npx tsx tools/desert-ride.ts [speedKmh]
bun tools/autopilot-bench.ts
bun tools/playground-lap.ts [laps]
```

- `surface-feel` ведёт реальный representative Vehicle по настоящим road/desert colliders;
- `ride-bench`, `desert-washboard`, `desert-ride` измеряют сами поверхности и нужны, чтобы не лечить car tuning изменением мира;
- autopilot bench защищает Road/Vehicle/hazard contract;
- playground lap измеряет качество езды на повторяемом кольце.

Эти стенды hard-coded на representative car там, где `MODEL_ID` находится в source. Их результаты защищают общую систему, не заменяют per-model run.

### Gate 7: light/dirt/damage и визуальная поверхность

```sh
bun tools/car-dirt.ts
bun tools/vehicle-lights.ts
npm run dev
```

- `car-dirt.ts` сейчас hard-coded на `gt_vaz2110`; проверяет накопление dirt, crashes, per-instance state и save round-trip.
- `vehicle-lights.ts` сейчас hard-coded на `gt_vaz2110` и проверяет projected-light pool/lifecycle, а не правильность faces каждой лампы.
- На текущем headless Bun path `vehicle-lights.ts` загружает Soviet donor wheels через FBX и требует `window` shim; пока он использует только `installBlankTextures()`, команда может завершиться `window is not defined`. Исправить harness или использовать полный `installAssetShim()` до объявления этого gate зелёным.

В dev server:

- dev spawn конкретного id;
- daylight/night lamp matrix;
- repaint;
- чистый/грязный/повреждённый кузов;
- обе стороны колёс и движение подвески;
- bonnet camera;
- interaction with trunk/bonnet/gizmo anchors;
- save, reload, exit/enter car;
- статическая копия в POI и активная копия в traffic.

Для быстрого визуального damage review:

```text
/tools/dentlab/?model=<modelId>&damage=0,0.12,0.3,1&z=15
```

`/tools/coollab/` нужен только при добавлении нового radiator mesh или изменении dashboard temperature zones.

### Gate 8: compile/build

```sh
npm run check
npm run build
```

`tsconfig.json` включает только `src`, поэтому успешный `npm run check` не type-checks `tools/*.ts`. Все реально используемые tool commands всё равно должны быть запущены отдельно.

## 17. Визуальный протокол приёмки

Для каждого пункта сохранить одинаковые camera poses до/после:

- front 3/4 left/right;
- rear 3/4 left/right;
- exact side для wheelbase/overhang/roofline;
- exact front/rear для track/width/lamp symmetry;
- top;
- underside;
- view через windscreen и боковые окна;
- close-up всех lamp clusters off/on;
- wheel/rim close-up слева и справа;
- gameplay distance;
- traffic distance;
- night beams on ground;
- repaint swatches;
- dent/dirt levels.

Reject при любом из признаков:

- waviness/dents на гладкой панели после decimate;
- сломанный silhouette или арка;
- исчезнувший seam;
- world виден через пол/решётку/окно;
- opaque sheet закрывает линзу;
- body paint попадает на фонарь/стекло/шину/диск;
- hub остаётся на кузове при ходе подвески;
- правое колесо inside-out;
- track визуально не попадает в арки;
- машина едет носом назад или рулится задней осью;
- projected light идёт из неверной секции;
- кузов заметно растянут runtime fit'ом.

## 18. Порядок настройки: не маскировать ошибки

Настраивать строго в таком порядке:

1. точная модификация и реальные references;
2. axes, mounts, wheelbase, tracks, tyre radius/width;
3. кузовные proportions и clearance;
4. kerb mass и front weight share;
5. engine/gearbox ratios и drive layout;
6. drag area и top speed;
7. acceleration через indicated torque/braking losses;
8. suspension frequencies/damping/travel;
9. steering lock/turning circle;
10. grip/braking/lateral breakaway;
11. loose-surface launch/feel;
12. cooling;
13. autopilot.

Пример неверной компенсации: поднять engine torque, чтобы машина достигла top speed при завышенном drag; затем уменьшить grip, чтобы скрыть слишком быстрый разгон. Все три числа становятся неправдой. Стенд должен показывать, какой уровень не совпал.

## 19. Ошибка, остановка и откат

- Любой failed hard gate блокирует publish.
- Не исправлять audit удалением проверки или переименованием плохого объекта под ожидаемое имя.
- Не держать deprecated alias старого model id; либо не публиковать новый id, либо выполнить полную save migration.
- При провале visual gate откатывать только кандидат geometry, а не approved classification/reference.
- При провале dynamics возвращаться к первому несовпавшему слою из раздела 18.
- При провале autopilot сначала доказать manual drivability и достаточный turning/traction envelope. Controller не должен компенсировать машину, физически неспособную пройти маршрут.
- Production GLB не заменяется, пока новый hash не прошёл все ворота.
- Все temporary/provisional fit records удаляются перед публикацией.

## 20. Что уже есть и чего не хватает для одной команды

### Уже есть

- прямой RPF7/YFT reader и staged inspect/extract/assemble;
- Blender/DragonFF DFF normalizer;
- FBX/GLB/OBJ inspectors/converters;
- material-map stripper;
- wheel rim splitter;
- structural GLB audits;
- runtime measurement и static fit contract;
- engine/gearbox/radiator registries;
- instrumented handling и suspension benches;
- cooling/service benches;
- traffic, world lifecycle, save, dirt/damage/light benches;
- настоящий Autopilot bench и повторяемый playground circuit;
- dev spawn и визуальные labs.

### Разрывы автоматизации

1. Нет безопасного универсального unpack/intake wrapper.
2. YFT/DFF classification пока находится в model/pack-specific code, а не в job profile.
3. Нет автоматического `model-fits.json` generator без provisional entry.
4. Нет общей таблицы real-world targets; `soviet-reality.ts` покрывает только Soviet ids.
5. `autopilot-bench.ts`, `playground-lap.ts`, `surface-feel.ts`, `vehicle-lights.ts`, `car-dirt.ts`, `cooling-drive.ts` и часть lifecycle checks имеют hard-coded model ids.
6. Traffic bench не умеет forced model id.
7. Нет автоматического screenshot A/B и per-distance visual report.
8. Нет hard budget на triangles/upload bytes/draw calls по модели.
9. `vehicle-lights.ts` требует исправления headless `window` shim для donor FBX path.
10. `suspension-probe.ts` печатает устаревший `susp.rideHeight` как `NaN`.

Пока эти пункты не закрыты, честный интерфейс конвейера — набор детерминированных стадий с тремя ручными approvals, а не фиктивная одна команда.

## 21. Целевой интерфейс будущего wrapper

Предлагаемый интерфейс, которого сейчас в репозитории нет:

```sh
npx tsx tools/vehicle-pipeline.ts intake   --job build/vehicles/<id>/job.json
npx tsx tools/vehicle-pipeline.ts inspect  --job build/vehicles/<id>/job.json
npx tsx tools/vehicle-pipeline.ts build    --job build/vehicles/<id>/job.json
npx tsx tools/vehicle-pipeline.ts measure  --job build/vehicles/<id>/job.json
npx tsx tools/vehicle-pipeline.ts verify   --job build/vehicles/<id>/job.json
npx tsx tools/vehicle-pipeline.ts publish  --job build/vehicles/<id>/job.json
```

Стадии `approve-reference`, `approve-geometry`, `approve-visual` должны требовать сохранённый review record и hashes входа/выхода. `publish` отказывается работать, если:

- approval относится к другому hash;
- audit/validate/measure/bench report отсутствует или failed;
- final GLB старше source-specific script;
- catalogue id/fit/factory record расходятся;
- per-model autopilot proof отсутствует;
- production path уже содержит другой незаархивированный кандидат.

Wrapper должен вызывать существующие инструменты, а не переписывать их алгоритмы. Форматный adapter выдаёт один общий normalized contract; всё после него не знает, был вход DFF, YFT, FBX или OBJ.

## 22. Краткий чек-лист выпуска одной машины

### Reference

- [ ] Точная модификация, год, рынок, двигатель, коробка, шины и lamp supplier выбраны.
- [ ] Геометрия, масса, развесовка, aero и road-test targets имеют источники.
- [ ] Лицензия и source hashes записаны.

### Asset

- [ ] Полный inspection выполнен до удаления.
- [ ] Keep/drop map полна.
- [ ] Интерьер/engine bay/damage/collision/shadow/duplicate LOD удалены.
- [ ] Видимые пустоты закрыты только там, где нужно.
- [ ] Exterior decimate прошёл visual A/B.
- [ ] `+Y/+Z/+X`, positive scale, normals и winding верны.
- [ ] Wheels/mounts/hubs и reuse policy верны.
- [ ] Semantic lamp nodes и off-state materials верны.
- [ ] Final GLB compressed без повторной simplification/join/palette.

### Runtime

- [ ] `FactoryGeometry`, `CarModelDef`, parts variants и fit записаны.
- [ ] Loaded `carModelMeasure` совпадает с fit и factory targets.
- [ ] Engine/gearbox/cooling относятся к той же модификации.
- [ ] Handling metrics сопоставлены с real targets, а не только распечатаны.
- [ ] Per-model Autopilot scenarios пройдены.
- [ ] Dev spawn, traffic, POI, save/load и lifecycle проверены.

### Visual/release

- [ ] Day/night lamp matrix пройдена.
- [ ] Repaint/dirt/damage не затрагивают glass/lamps/wheels.
- [ ] Wheels и hubs движутся вместе с suspension.
- [ ] Underbody/windows/grille проверены.
- [ ] Triangle/bytes/draw-call report сохранён.
- [ ] `npm run check` и `npm run build` пройдены.
- [ ] Финальный hash опубликован только после всех ворот.
