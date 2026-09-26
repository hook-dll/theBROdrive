/**
 * Every word the interface says, in the two languages it says them in.
 *
 * English is the table: `RU` is typed as a total map of it, so a string that exists in one
 * language and not the other is a compile error rather than a blank button discovered by a
 * player. That is the whole reason the two tables are not one object with a language key.
 *
 * The strings here are the INTERFACE's own — menus, settings, the logbook. The world does
 * not speak through this table: a fuel can is a fuel can, the LCD's segment font has no
 * Cyrillic at all, and the simulation's warnings are Latin by geometry rather than by
 * choice. What the player reads to CHOOSE something is translated; what a car says about
 * itself is not, and that line is deliberate rather than unfinished.
 */

import type { Language } from '../game/settings';

/** Placeholders are `{name}` and are filled by `format`. */
const EN = {
  // ---------------------------------------------------------------- language names
  'lang.ru': 'Русский',
  'lang.en': 'English',

  // ---------------------------------------------------------------- boot and loading
  'boot.loading': 'loading the road',
  'boot.building': 'building the world — {percent}%',
  'boot.ready': 'the road is ready',
  'boot.settling': 'settling the picture',
  'boot.poem.line1': 'the roads we remember are the slow ones',
  'boot.poem.line2': 'where the journey mattered more',
  'boot.poem.line3': 'than the place it led to',

  'doc.form': 'FORM 12-A',
  'doc.sections': 'sections',
  'doc.waybill': 'WAYBILL',
  'doc.date': 'date',
  'doc.mileage': 'mileage',
  'doc.serial': 'serial',
  'doc.sheet': 'sheet {n}',
  'doc.issued': 'issued',
  'doc.signature': 'signature',
  'doc.stamp': 'approved',
  'drive.begin': 'HEAD OUT',
  // ---------------------------------------------------------------- first run
  'first.title': 'First time on the road',
  'first.lead':
    'Three questions, and then the road. Everything here can be changed later in the settings.',
  'first.language': 'Language',
  'first.language.hint': 'What the menus, the settings and this card are written in.',
  'first.units': 'Units',
  'first.units.hint': 'How far and how fast. The road itself is measured in metres.',
  'first.units.km': 'Kilometres',
  'first.units.mi': 'Miles',
  'first.howto': 'The wheel is on the keys',
  'first.howto.body':
    'W and S are the pedals, A and D the wheel, Space the handbrake, X and Z the gearbox, '
    + 'C the camera, F to get out and walk. The whole list is in the settings, and any key '
    + 'in it can be moved.',
  'first.begin': 'go to the road',

  // ---------------------------------------------------------------- title screen
  'title.tagline': 'средняя полоса · неспешная езда',
  'title.continue': 'continue',
  'title.newDrive': 'new drive',
  'title.load': 'load',
  'title.profile': 'logbook',
  'title.seed': 'seed',
  'title.seed.placeholder': 'empty — the road picks',
  'title.seed.hint':
    'A seed is the whole road, the villages and the weather along it. Any word will do; the '
    + 'same word always builds the same road.',
  'title.seed.dice': 'another seed',
  'title.quickStart': 'drive',
  'title.quickStart.hint': 'Start now, on today\'s date, with whatever weather the road brings.',
  'title.resume': 'last drive',

  // ---------------------------------------------------------------- new drive
  'drive.title': 'Новая дорога',
  'drive.masthead': 'СРЕДНЯЯ ПОЛОСА',
  'drive.subtitle': 'Тверская область',
  'drive.region.hint':
    'One region, drawn honestly: birch and spruce, rye fields gone to seed, villages with '
    + 'one shop, and a road that has been patched by every decade since the war.',
  'drive.season': 'Season',
  'drive.season.hint': 'The day the drive opens on. The season turns as you drive, as it does.',
  'drive.season.spring': 'spring',
  'drive.season.summer': 'summer',
  'drive.season.autumn': 'autumn',
  'drive.season.winter': 'winter',
  'drive.date': 'Start date',
  'drive.weather': 'Weather',
  'drive.weather.hint':
    'The road has its own weather, spells of six to twenty kilometres long. Hold it at one '
    + 'if you would rather see a particular sky.',

  'drive.back': 'back',
  'drive.start': 'start',
  'drive.dice': 'roll again',
  'drive.reset': 'reset',

  // ---------------------------------------------------------------- load and logbook
  'load.title': 'Saves',
  'load.heading': 'Your drives',
  'load.empty': 'No drives saved yet.',
  'load.unavailable': 'Saves are unavailable right now.',
  'load.load': 'load',
  'load.delete': 'delete',
  'load.delete.confirm': 'delete?',
  'load.code': 'Save code',
  'load.code.placeholder': 'paste a code',
  'load.code.hint':
    'A whole drive — the car, its parts, the fuel, the time of day — as one line of text. '
    + 'Paste one from a friend to drive his road.',
  'load.code.load': 'read it',
  'load.code.bad': 'That is not a save code.',
  'load.code.empty': 'Paste a code first.',
  'load.code.failed': 'That drive could not be loaded.',
  'load.unnamed': 'unnamed drive',
  'load.meta': '{km} km · {time} · seed {seed}',

  'profile.title': 'Logbook',
  'profile.lead': 'What the saved drives add up to.',
  'profile.drives': 'drives',
  'profile.distance': 'distance',
  'profile.time': 'on the road',
  'profile.furthest': 'furthest',
  'profile.none': 'Nothing to write in the logbook yet.',

  // ---------------------------------------------------------------- pause
  'pause.title': 'paused',
  'pause.travelled': 'travelled {km}',
  'pause.resume': 'resume',
  'pause.settings': 'settings',
  'pause.save': 'save',
  'pause.save.hint': 'Writes this drive to the browser, by seed.',
  'pause.code': 'save code',
  'pause.code.hint': 'Puts the whole drive on the clipboard as text.',
  'pause.seed': 'seed',
  'pause.copy': 'copy',
  'pause.copied': 'copied',
  'pause.copyFailed': 'copy failed',
  'pause.copySeed.hint': 'The seed is the road. Send it to somebody and he drives the same one.',
  'pause.quit': 'main menu',
  'pause.quit.hint': 'Leaves the drive. Anything unsaved stays unsaved.',
  'pause.saved': 'saved',
  'pause.dev': 'developer tools',
  'pause.dev.spawnVehicle': 'spawn vehicle (dev)',
  'pause.dev.spawnTrailer': 'spawn trailer (dev)',
  'pause.dev.spawnItem': 'spawn item (dev)',
  'pause.dev.spawnPart': 'spawn part (dev)',
  'pause.dev.flip': 'flip car (dev)',
  'pause.dev.seat': 'drive nearest car (dev)',
  'pause.dev.lake': 'jump to lake (dev)',
  'pause.dev.perf': 'frame report (dev)',
  'pause.dev.perf.copy': 'copy report',
  'pause.dev.perf.title': 'Frame report',
  'pause.dev.perf.none': 'no report available',
  'pause.dev.spawn.title': 'Spawn vehicle',
  'pause.dev.spawn.model': 'Model',
  'pause.dev.spawn.confirm': 'spawn',
  'pause.dev.item.title': 'Spawn item',
  'pause.dev.item.note': 'the chosen item drops at your feet',
  'pause.dev.part.title': 'Spawn part',
  'pause.dev.part.note': 'the chosen part drops at your feet, clean and unused',
  'pause.back': 'back',

  // ---------------------------------------------------------------- settings: chrome
  'set.title': 'Settings',
  'set.close': 'close',
  'set.reset': 'reset section',
  'set.reset.done': 'This section is back to its defaults.',
  'set.unsaved': 'The car is parked; nothing here is visible until you resume.',
  'set.guard.notice':
    'The last launch never reached the road, so the picture level and the view distance went '
    + 'back to their defaults. If it happens again, pick a shorter view distance.',
  'set.on': 'on',
  'set.off': 'off',
  'set.keys.press': 'press a key',
  'set.keys.held': '"{key}" is bound to {action}',
  'set.keys.hint': 'Click a row and press the key you want. Click it again to cancel.',
  'set.keys.reset': 'all keys back to their defaults',
  'set.keys.capture': 'listening…',

  // ---------------------------------------------------------------- settings: tabs
  'set.tab.gameplay': 'Gameplay',
  'set.tab.graphics': 'Picture',
  'set.tab.display': 'Display',
  'set.tab.audio': 'Sound',
  'set.tab.controls': 'Controls',
  'set.tab.system': 'System',
  'set.tab.gameplay.hint': 'How the drive behaves and how time passes.',
  'set.tab.graphics.hint': 'What is drawn, how far it reaches and how many pixels it costs.',
  'set.tab.display.hint': 'The camera and the mouse.',
  'set.tab.audio.hint': 'Three buses: the car, the radio and the interface.',
  'set.tab.controls.hint': 'Every key, in one list.',
  'set.tab.system.hint': 'The language and the units.',

  // ---------------------------------------------------------------- settings: rows
  'set.gearbox': 'Gearbox',
  'set.gearbox.hint': 'Automatic by default: the box is driver assist, not the game. X and Z always override.',
  'set.gearbox.manual': 'Manual',
  'set.gearbox.auto': 'Automatic',
  'set.dayLength': 'Day length',
  'set.dayLength.hint': 'Real minutes for one whole day and night.',
  'set.poiSpacing': 'Stops between places',
  'set.poiSpacing.hint': 'Metres between roadside slots. The road rebuilds after you resume.',
  'set.weather': 'Weather',
  'set.weather.hint': 'Hold the sky at one answer, or let the road bring its own.',
  'set.weather.auto': 'As it comes',
  'set.weather.clear': 'Clear',
  'set.weather.overcast': 'Overcast',
  'set.weather.rain': 'Rain',
  'set.bouncy': 'Bouncing cars',
  'set.bouncy.hint':
    'Every car hops in place like the viral clip. Purely visual: physics, suspension and '
    + 'collisions are untouched.',
  'set.quality': 'Picture',
  'set.quality.level': 'Level',
  'set.quality.hint': 'The one ladder: pixels, the shadow pass, the lamps, the sky and the horizon together.',
  'set.quality.low': 'Light',
  'set.quality.mid': 'Standard',
  'set.quality.high': 'Generous',
  'set.quality.measure': 'measure this machine',
  'set.quality.measure.hint':
    'Times the graphics chip during the next launch and picks a rung to fit. It restarts: the '
    + 'measurement happens behind the loading cover, where nobody is driving.',
  'set.quality.source.default': 'not picked yet',
  'set.quality.source.device': 'phone default',
  'set.quality.source.measured': 'measured',
  'set.quality.source.chosen': 'picked by you',
  'set.quality.source.default.note': 'Nobody has picked yet. The next launch times this machine and picks.',
  'set.quality.source.device.note': 'A phone starts on the lightest rung so it stays cool.',
  'set.quality.source.measured.note': 'The launch timed this machine and picked. It will not change unless you ask.',
  'set.quality.source.chosen.note': 'You picked this. Nothing will change it unless you do.',
  'set.viewDistance': 'View distance',
  'set.viewDistance.hint':
    'How far the world is drawn before the fog dissolves it. The far step rebuilds bigger '
    + 'pieces of the distance, so it is the first thing to shorten if the drive stutters.',
  'set.viewDistance.near': 'Near',
  'set.viewDistance.auto': 'Rung',
  'set.viewDistance.far': 'Far',
  'set.detail': 'Detail',
  'set.detail.hint':
    'The grass band along the road and how far the tree models are drawn before they become '
    + 'flat pictures.',
  'set.detail.low': 'Sparse',
  'set.detail.auto': 'Rung',
  'set.detail.high': 'Full',
  'set.renderScale': 'Sharpness',
  'set.renderScale.hint':
    'Pixels drawn for this window. Auto watches the graphics chip and lowers it if the machine '
    + 'cannot keep up; a fixed number is fixed.',
  'set.renderScale.px': '{width}x{height}, {mpx} Mpx',
  'set.renderScale.auto': 'Auto',
  'set.renderScale.fixed': 'Fixed: the game will not lower it for you.',
  'set.renderScale.upscale': 'Drawn bigger than the screen and shrunk down, which smooths every edge.',
  'set.msaa': 'Smooth edges',
  'set.msaa.hint': 'Softens the jagged steps along every edge. The most expensive thing here per pixel.',
  'set.fps': 'Frame rate',
  'set.fps.hint':
    'The simulation is unaffected: the car handles the same at every rate. Half the frames is '
    + 'half the work and half the heat.',
  'set.fps.max': 'Max',
  'set.fov': 'Field of view',
  'set.fov.hint':
    'How wide the camera sees — the up-and-down angle. A wider window then shows more to the '
    + 'sides rather than squeezing the middle. The binoculars and the speed widening follow it.',
  'set.mouse': 'Mouse look',
  'set.mouse.hint': 'Radians per pixel while looking around. The default is the authored feel.',
  'set.precise': 'Precise steering',
  'set.precise.hint':
    'Mouse and A/D wind one wheel that stays where you leave it. Off is the familiar '
    + 'self-centring steering.',
  'set.master': 'Car and world',
  'set.master.hint': 'Engine, wind, tyres, rain and everything you walk past.',
  'set.radio': 'Radio',
  'set.radio.hint': 'Broadcast material, at whatever level the station mastered it.',
  'set.ui': 'Interface',
  'set.ui.hint': 'The clicks and ticks of the menus themselves.',
  'set.language': 'Language',
  'set.language.hint': 'The words this interface uses. Nothing else changes with it.',
  'set.units': 'Units',
  'set.units.hint': 'Distance and speed everywhere they are written down.',
  'set.keys': 'Key bindings',
  'set.keysSummary': 'Every action and the keys that fire it.',

  // ---------------------------------------------------------------- HUD
  'hud.speed': 'speed',
  'hud.odometer': 'odometer',
  'hud.unit.kmh': 'km/h',
  'hud.unit.mph': 'mph',
  'hud.unit.km': 'km',
  'hud.unit.mi': 'mi',

  // ---------------------------------------------------------------- durations
  'time.hm': '{h} h {m} min',
  'time.m': '{m} min',

  // ---------------------------------------------------------------- generated hints
  'set.minutes': '{n} min',
  'set.quality.numbers':
    '{mpx} Mpx · {shadows} · horizon {km} km · lamps {spots}+{points} · stars to {stars}',
  'set.quality.shadowsOn': 'sun shadows',
  'set.quality.shadowsOff': 'no sun shadows',
  'set.viewDistance.at': 'The fog closes the world at about {km} km.',
  'set.detail.numbers': 'Grass {grass} m either side · tree models to {trees} m',
  'set.renderScale.autoHint':
    'The game watches the graphics chip and picks, lowering it if the machine cannot keep up. '
    + 'Full sharpness here is {px}.',
  'set.fps.option': '{rate} FPS',
  'set.fps.maxHint': 'No cap. The right choice when the GPU is already the constraint.',
  'set.time': 'Time of day',
  'set.time.hint': 'Moves the sun now. The clock keeps running from wherever you put it.',
  'set.time.morning': 'morning',
  'set.time.noon': 'noon',
  'set.time.evening': 'evening',
  'set.time.night': 'night',

  // ---------------------------------------------------------------- key bindings
  // One per action in `core/input.ts`. The names are the action's own, translated: the
  // controls page is the one place a player reads them as a list rather than meets them
  // in a prompt, and a Russian menu with twenty-six English rows in it is not translated.
  'act.throttle': 'Throttle',
  'act.brake': 'Brake',
  'act.left': 'Steer left',
  'act.right': 'Steer right',
  'act.handbrake': 'Handbrake',
  'act.shiftUp': 'Shift up',
  'act.shiftDown': 'Shift down',
  'act.lights': 'Cycle headlights',
  'act.indicatorLeft': 'Left blinker',
  'act.indicatorRight': 'Right blinker',
  'act.tyres': 'Cycle tyre compound',
  'act.mouseSteer': 'Precise steering',
  'act.camera': 'Hood / chase camera',
  'act.recenterCamera': 'Recentre camera',
  'act.radio': 'Radio on/off',
  'act.radioStation': 'Radio station',
  'act.autopilot': 'Autopilot: long / brisk / driven / off',
  'act.useHeld': 'Use held item',
  'act.interact': 'Enter / leave a vehicle',
  'act.mount': 'Pick up / mount',
  'act.drop': 'Drop item',
  'act.removeWearable': 'Take off what you wear',
  'act.jump': 'Jump',
  'act.sprint': 'Sprint',
  'act.itemNext': 'Next carried item',
  'act.itemPrev': 'Previous carried item',
} as const;

/** The language names, for the two places that offer a choice of them. */
export const LANGUAGE_LABEL: Record<Language, StringKey> = {
  ru: 'lang.ru',
  en: 'lang.en',
};

/**
 * The key-binding rows' names, by action id.
 *
 * The ids come from `BINDABLE_ACTIONS` in `core/input.ts`, which also carries an English
 * label; that label is the game's own and stays as the fallback here. An action with no
 * entry shows its own English name rather than nothing — a missing translation should look
 * like a missing translation, not like a broken control.
 */
export const ACTION_LABEL: Record<string, StringKey> = {
  throttle: 'act.throttle',
  brake: 'act.brake',
  left: 'act.left',
  right: 'act.right',
  handbrake: 'act.handbrake',
  shiftUp: 'act.shiftUp',
  shiftDown: 'act.shiftDown',
  lights: 'act.lights',
  indicatorLeft: 'act.indicatorLeft',
  indicatorRight: 'act.indicatorRight',
  tyres: 'act.tyres',
  mouseSteer: 'act.mouseSteer',
  camera: 'act.camera',
  recenterCamera: 'act.recenterCamera',
  radio: 'act.radio',
  radioStation: 'act.radioStation',
  autopilot: 'act.autopilot',
  useHeld: 'act.useHeld',
  interact: 'act.interact',
  mount: 'act.mount',
  drop: 'act.drop',
  removeWearable: 'act.removeWearable',
  jump: 'act.jump',
  sprint: 'act.sprint',
  itemNext: 'act.itemNext',
  itemPrev: 'act.itemPrev',
};

export type StringKey = keyof typeof EN;

const RU: Record<StringKey, string> = {
  'lang.ru': 'Русский',
  'lang.en': 'English',

  'boot.loading': 'загружаем дорогу',
  'boot.building': 'строим мир — {percent}%',
  'boot.ready': 'дорога готова',
  'boot.settling': 'настраиваем картинку',
  'boot.poem.line1': 'мы помним не спешные дороги',
  'boot.poem.line2': 'а те, где важнее был путь,',
  'boot.poem.line3': 'чем место, куда он вёл',

  'doc.form': 'ФОРМА 12-А',
  'doc.sections': 'разделы',
  'doc.waybill': 'ПУТЕВОЙ ЛИСТ',
  'doc.date': 'дата',
  'doc.mileage': 'пробег',
  'doc.serial': 'серия',
  'doc.sheet': 'лист {n}',
  'doc.issued': 'выдан',
  'doc.signature': 'подпись',
  'doc.stamp': 'допущен',
  'drive.begin': 'В ПУТЬ',
  'first.title': 'Первый раз на дороге',
  'first.lead':
    'Три вопроса — и в путь. Всё это потом можно поменять в настройках.',
  'first.language': 'Язык',
  'first.language.hint': 'На нём написаны меню, настройки и эта карточка.',
  'first.units': 'Единицы',
  'first.units.hint': 'Как считать расстояние и скорость. Сама дорога всегда в метрах.',
  'first.units.km': 'Километры',
  'first.units.mi': 'Мили',
  'first.howto': 'Руль — на клавишах',
  'first.howto.body':
    'W и S — педали, A и D — руль, пробел — ручник, X и Z — коробка, C — камера, F — выйти '
    + 'и пойти пешком. Весь список — в настройках, и любую клавишу можно переставить.',
  'first.begin': 'на дорогу',

  'title.tagline': 'средняя полоса · неспешная езда',
  'title.continue': 'продолжить',
  'title.newDrive': 'новая дорога',
  'title.load': 'загрузить',
  'title.profile': 'журнал',
  'title.seed': 'сид',
  'title.seed.placeholder': 'пусто — дорога выберет сама',
  'title.seed.hint':
    'Сид — это вся дорога: деревни, поля и погода на ней. Годится любое слово; одно и то же '
    + 'слово всегда строит одну и ту же дорогу.',
  'title.seed.dice': 'другой сид',
  'title.quickStart': 'поехали',
  'title.quickStart.hint': 'Тронуться сейчас, сегодняшним числом, с той погодой, что даст дорога.',
  'title.resume': 'последний заезд',

  'drive.title': 'Новая дорога',
  'drive.masthead': 'СРЕДНЯЯ ПОЛОСА',
  'drive.subtitle': 'Тверская область',
  'drive.region.hint':
    'Один край, без выдумок: берёза и ель, рожь, ушедшая в семена, деревни с одним магазином '
    + 'и дорога, которую латали каждое десятилетие после войны.',
  'drive.season': 'Сезон',
  'drive.season.hint': 'День, с которого начинается заезд. Дальше сезон поворачивается сам.',
  'drive.season.spring': 'весна',
  'drive.season.summer': 'лето',
  'drive.season.autumn': 'осень',
  'drive.season.winter': 'зима',
  'drive.date': 'Дата начала',
  'drive.weather': 'Погода',
  'drive.weather.hint':
    'У дороги своя погода — полосы по шесть–двадцать два километра. Выберите одно, если '
    + 'хочется увидеть определённое небо.',

  'drive.back': 'назад',
  'drive.start': 'начать',
  'drive.dice': 'ещё раз',
  'drive.reset': 'сброс',

  'load.title': 'Заезды',
  'load.heading': 'Сохранённые заезды',
  'load.empty': 'Пока ничего не сохранено.',
  'load.unavailable': 'Сохранения сейчас недоступны.',
  'load.load': 'загрузить',
  'load.delete': 'удалить',
  'load.delete.confirm': 'удалить?',
  'load.code': 'Код заезда',
  'load.code.placeholder': 'вставьте код',
  'load.code.hint':
    'Целый заезд — машина, детали, топливо, время суток — одной строкой. Вставьте чужой код, '
    + 'чтобы проехать по его дороге.',
  'load.code.load': 'прочитать',
  'load.code.bad': 'Это не код заезда.',
  'load.code.empty': 'Сначала вставьте код.',
  'load.code.failed': 'Этот заезд не загрузился.',
  'load.unnamed': 'без названия',
  'load.meta': '{km} км · {time} · сид {seed}',

  'profile.title': 'Журнал',
  'profile.lead': 'Что получается из сохранённых заездов.',
  'profile.drives': 'заездов',
  'profile.distance': 'всего',
  'profile.time': 'за рулём',
  'profile.furthest': 'дальше всех',
  'profile.none': 'Журнал пока пуст.',

  'pause.title': 'привал',
  'pause.travelled': 'пройдено {km}',
  'pause.resume': 'продолжить',
  'pause.settings': 'настройки',
  'pause.save': 'сохранить',
  'pause.save.hint': 'Записать этот заезд в браузер — по сиду.',
  'pause.code': 'код заезда',
  'pause.code.hint': 'Положить весь заезд в буфер обмена одной строкой.',
  'pause.seed': 'сид',
  'pause.copy': 'копировать',
  'pause.copied': 'скопировано',
  'pause.copyFailed': 'не скопировалось',
  'pause.copySeed.hint': 'Сид — это дорога. Отправьте его другому, и он проедет ту же самую.',
  'pause.quit': 'в меню',
  'pause.quit.hint': 'Выйти из заезда. Несохранённое не сохранится.',
  'pause.saved': 'сохранено',
  'pause.dev': 'инструменты разработчика',
  'pause.dev.spawnVehicle': 'поставить машину (dev)',
  'pause.dev.spawnTrailer': 'поставить прицеп (dev)',
  'pause.dev.spawnItem': 'положить предмет (dev)',
  'pause.dev.spawnPart': 'положить деталь (dev)',
  'pause.dev.flip': 'перевернуть машину (dev)',
  'pause.dev.seat': 'сесть в ближнюю (dev)',
  'pause.dev.lake': 'к озеру (dev)',
  'pause.dev.perf': 'отчёт о кадре (dev)',
  'pause.dev.perf.copy': 'скопировать отчёт',
  'pause.dev.perf.title': 'Отчёт о кадре',
  'pause.dev.perf.none': 'отчёта нет',
  'pause.dev.spawn.title': 'Поставить машину',
  'pause.dev.spawn.model': 'Модель',
  'pause.dev.spawn.confirm': 'поставить',
  'pause.dev.item.title': 'Положить предмет',
  'pause.dev.item.note': 'выбранное падает под ноги',
  'pause.dev.part.title': 'Положить деталь',
  'pause.dev.part.note': 'выбранная деталь падает под ноги, чистая и новая',
  'pause.back': 'назад',

  'set.title': 'Настройки',
  'set.close': 'закрыть',
  'set.reset': 'сбросить раздел',
  'set.reset.done': 'Раздел вернулся к значениям по умолчанию.',
  'set.unsaved': 'Машина стоит; изменения видно только после продолжения.',
  'set.guard.notice':
    'Прошлый запуск не доехал до дороги, поэтому ступень картинки и дальность вернулись к '
    + 'обычным. Если это повторится, поставьте дальность ближе.',
  'set.on': 'вкл',
  'set.off': 'выкл',
  'set.keys.press': 'нажмите клавишу',
  'set.keys.held': '«{key}» уже занята: {action}',
  'set.keys.hint': 'Нажмите на строку и нажмите нужную клавишу. Нажатие на строку ещё раз отменяет.',
  'set.keys.reset': 'все клавиши — по умолчанию',
  'set.keys.capture': 'слушаю…',

  'set.tab.gameplay': 'Игра',
  'set.tab.graphics': 'Картинка',
  'set.tab.display': 'Экран',
  'set.tab.audio': 'Звук',
  'set.tab.controls': 'Управление',
  'set.tab.system': 'Система',
  'set.tab.gameplay.hint': 'Как ведёт себя заезд и как идёт время.',
  'set.tab.graphics.hint': 'Что нарисовано, как далеко видно и сколько это стоит пикселей.',
  'set.tab.display.hint': 'Камера и мышь.',
  'set.tab.audio.hint': 'Три шины: машина, радио и интерфейс.',
  'set.tab.controls.hint': 'Все клавиши одним списком.',
  'set.tab.system.hint': 'Язык и единицы измерения.',

  'set.gearbox': 'Коробка',
  'set.gearbox.hint':
    'По умолчанию автомат: коробка — это помощь водителю, а не игра. X и Z работают всегда.',
  'set.gearbox.manual': 'Механика',
  'set.gearbox.auto': 'Автомат',
  'set.dayLength': 'Длина суток',
  'set.dayLength.hint': 'Сколько реальных минут идут одни сутки.',
  'set.poiSpacing': 'Редкость остановок',
  'set.poiSpacing.hint': 'Метры между придорожными местами. Дорога перестроится после продолжения.',
  'set.weather': 'Погода',
  'set.weather.hint': 'Держать небо одним, или пусть дорога приносит своё.',
  'set.weather.auto': 'Как придётся',
  'set.weather.clear': 'Ясно',
  'set.weather.overcast': 'Пасмурно',
  'set.weather.rain': 'Дождь',
  'set.bouncy': 'Прыгающие машины',
  'set.bouncy.hint':
    'Все машины подпрыгивают на месте, как в том самом видео. Только вид: физика, подвеска и '
    + 'столкновения не меняются.',
  'set.quality': 'Картинка',
  'set.quality.level': 'Уровень',
  'set.quality.hint': 'Одна лестница: пиксели, тени, фары, небо и дальность вместе.',
  'set.quality.low': 'Скромно',
  'set.quality.mid': 'Средне',
  'set.quality.high': 'Щедро',
  'set.quality.measure': 'измерить этот компьютер',
  'set.quality.measure.hint':
    'Замеряет видеокарту во время следующего запуска и подбирает ступень. Игра перезапустится: '
    + 'замер идёт за экраном загрузки, пока никто не едет.',
  'set.quality.source.default': 'ещё не выбрано',
  'set.quality.source.device': 'телефонный умолчание',
  'set.quality.source.measured': 'измерено',
  'set.quality.source.chosen': 'вы выбрали',
  'set.quality.source.default.note': 'Пока никто не выбирал. Следующий запуск замерит и выберет.',
  'set.quality.source.device.note': 'Телефон начинает с самой лёгкой ступени, чтобы не греться.',
  'set.quality.source.measured.note':
    'Ступень подобрал запуск по замеру. Она не изменится, пока вы не попросите.',
  'set.quality.source.chosen.note': 'Это ваш выбор. Ничто его не изменит, кроме вас.',
  'set.viewDistance': 'Дальность',
  'set.viewDistance.hint':
    'Как далеко нарисован мир, прежде чем его съест туман. Дальний шаг собирает большие куски '
    + 'дали, поэтому это первое, что стоит убавить при подтормаживании.',
  'set.viewDistance.near': 'Близко',
  'set.viewDistance.auto': 'Как в ступени',
  'set.viewDistance.far': 'Далеко',
  'set.detail': 'Детализация',
  'set.detail.hint':
    'Полоса травы у дороги и то, как далеко деревья остаются объёмными, прежде чем стать '
    + 'плоскими картинками.',
  'set.detail.low': 'Редко',
  'set.detail.auto': 'Как в ступени',
  'set.detail.high': 'Полно',
  'set.renderScale': 'Резкость',
  'set.renderScale.hint':
    'Сколько пикселей рисуется для этого окна. «Авто» следит за видеокартой и снижает '
    + 'разрешение, если не тянет; выбранное число — постоянное.',
  'set.renderScale.px': '{width}x{height}, {mpx} Мп',
  'set.renderScale.auto': 'Авто',
  'set.renderScale.fixed': 'Постоянно: игра сама снижать не будет.',
  'set.renderScale.upscale': 'Рисуется крупнее экрана и уменьшается — так сглаживаются все края.',
  'set.msaa': 'Сглаживание краёв',
  'set.msaa.hint': 'Убирает ступеньки на краях. Самое дорогое здесь — за каждый пиксель.',
  'set.fps': 'Частота кадров',
  'set.fps.hint':
    'Симуляция не меняется: машина едет одинаково при любой частоте. Вдвое меньше кадров — '
    + 'вдвое меньше работы и нагрева.',
  'set.fps.max': 'Без предела',
  'set.fov': 'Угол обзора',
  'set.fov.hint':
    'Как широко видит камера — угол сверху вниз. Более широкое окно покажет больше по бокам, '
    + 'а не сожмёт середину. Бинокль и расширение на скорости следуют за ним.',
  'set.mouse': 'Чувствительность мыши',
  'set.mouse.hint': 'Радианы на пиксель при осмотре. Значение по умолчанию — авторское.',
  'set.precise': 'Точный руль',
  'set.precise.hint':
    'Мышь и A/D проворачивают руль и оставляют его там, где вы бросили. Выключено — обычный '
    + 'руль, возвращающийся в центр.',
  'set.master': 'Машина и мир',
  'set.master.hint': 'Мотор, ветер, шины, дождь и всё, мимо чего вы проходите.',
  'set.radio': 'Радио',
  'set.radio.hint': 'Эфирный материал, на той громкости, на какой его свёл вещатель.',
  'set.ui': 'Интерфейс',
  'set.ui.hint': 'Щелчки и тики самого меню.',
  'set.language': 'Язык',
  'set.language.hint': 'Слова этого интерфейса. Больше ничего от него не зависит.',
  'set.units': 'Единицы',
  'set.units.hint': 'Расстояние и скорость везде, где они написаны.',
  'set.keys': 'Клавиши',
  'set.keysSummary': 'Все действия и клавиши, которые их вызывают.',

  'hud.speed': 'скорость',
  'hud.odometer': 'одометр',
  'hud.unit.kmh': 'км/ч',
  'hud.unit.mph': 'миль/ч',
  'hud.unit.km': 'км',
  'hud.unit.mi': 'ми',

  'time.hm': '{h} ч {m} мин',
  'time.m': '{m} мин',

  'set.minutes': '{n} мин',
  'set.quality.numbers':
    '{mpx} Мп · {shadows} · дальность {km} км · фары {spots}+{points} · звёзды до {stars}',
  'set.quality.shadowsOn': 'тени от солнца',
  'set.quality.shadowsOff': 'теней от солнца нет',
  'set.viewDistance.at': 'Туман закрывает мир примерно на {km} км.',
  'set.detail.numbers': 'Трава по {grass} м в стороны · модели деревьев до {trees} м',
  'set.renderScale.autoHint':
    'Игра следит за видеокартой и сама снижает разрешение, если не тянет. Полная резкость '
    + 'здесь — {px}.',
  'set.fps.option': '{rate} кадров/с',
  'set.fps.maxHint': 'Без предела. Верный выбор, когда узкое место — сама видеокарта.',
  'set.time': 'Время суток',
  'set.time.hint': 'Переставляет солнце сейчас. Часы идут дальше с этого места.',
  'set.time.morning': 'утро',
  'set.time.noon': 'полдень',
  'set.time.evening': 'вечер',
  'set.time.night': 'ночь',

  'act.throttle': 'Газ',
  'act.brake': 'Тормоз',
  'act.left': 'Влево',
  'act.right': 'Вправо',
  'act.handbrake': 'Ручник',
  'act.shiftUp': 'Передача выше',
  'act.shiftDown': 'Передача ниже',
  'act.lights': 'Фары по кругу',
  'act.indicatorLeft': 'Левый поворотник',
  'act.indicatorRight': 'Правый поворотник',
  'act.tyres': 'Состав шин',
  'act.mouseSteer': 'Точный руль',
  'act.camera': 'Капот / камера погони',
  'act.recenterCamera': 'Вернуть камеру',
  'act.radio': 'Радио вкл/выкл',
  'act.radioStation': 'Радиостанция',
  'act.autopilot': 'Автопилот: спокойный / спешащий / бешеный / выкл',
  'act.useHeld': 'Использовать предмет',
  'act.interact': 'Войти в машину / выйти',
  'act.mount': 'Поднять / поставить',
  'act.drop': 'Выбросить предмет',
  'act.removeWearable': 'Снять надетое',
  'act.jump': 'Прыжок',
  'act.sprint': 'Бег',
  'act.itemNext': 'Следующий предмет',
  'act.itemPrev': 'Предыдущий предмет',
};

const TABLES: Record<Language, Record<StringKey, string>> = { en: EN, ru: RU };

/** Fills `{name}` placeholders. Unknown names are left as they are, which is visible. */
export function format(template: string, vars?: Record<string, string | number>): string {
  if (vars === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/** The string for one key. The only reader of the tables, so the only place they are typed. */
export function t(
  language: Language,
  key: StringKey,
  vars?: Record<string, string | number>,
): string {
  return format(TABLES[language][key], vars);
}

/** The reader of the tables, as `i18n.ts` hands it out: one per language. */
export type Translate = (key: StringKey, vars?: Record<string, string | number>) => string;

/**
 * A positioned reader for one language, made once per screen.
 *
 * Every screen in `menu.ts` is built inside one function that knows its language; handing it
 * a closure keeps the calls short (`tr('set.title')`) without a module-level
 * current-language global, which would make the language a thing several modules could
 * disagree about.
 */
export function translator(language: Language): Translate {
  return (key, vars) => t(language, key, vars);
}

/** The interface language this browser is likely to read, for the first-run card. */
export function preferredLanguage(): Language {
  const tag = typeof navigator === 'undefined' ? '' : navigator.language;
  return tag.toLowerCase().startsWith('en') ? 'en' : 'ru';
}
