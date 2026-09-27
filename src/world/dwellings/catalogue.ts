import type * as THREE from 'three';
import { DwellingBuilder, type Weathering } from './builder';
import {
  barrack,
  bauhaus,
  blackhouse,
  chalet,
  cycladic,
  dacha,
  dutchGable,
  faluCottage,
  finnishHouse,
  izba,
  izbaRuin,
  mansard,
  mazanka,
  tbilisi,
  trullo,
  tudor,
  turfHouse,
} from './europe';
import {
  adobeRuin,
  aFrame,
  airstream,
  butterfly,
  casita,
  chattel,
  dustbowl,
  hacienda,
  logCabin,
  maya,
  pueblo,
  quonset,
  saltbox,
  shotgun,
  streamline,
  tipi,
  trailerWreck,
  victorian,
  victorianGhost,
} from './americas';
import { djenne, lebanese, ndebele, nubian, rondavel, windcatcher, yemen } from './africa';
import { chinese, futuro, haveli, minka, thaiStilt, tongkonan, yurt } from './asia';

/**
 * Exterior-only dwellings: fifty houses from different peoples and periods, none
 * taller than two storeys, none with a way in. See ./builder.ts for what that buys.
 */
export interface DwellingDefinition {
  readonly id: string;
  readonly name: string;
  /** People, place and period the form comes from. */
  readonly origin: string;
  /**
   * Authored `[x, z]` extent in metres, everything above ground included. The world's
   * placement is pure and never builds a house to learn its size (world/poi.ts), so the
   * size it keeps the road clear by is this number; tools/poi-placement.ts holds it to
   * the measured one.
   */
  readonly footprint: readonly [number, number];
  readonly abandoned?: boolean;
  /** Overrides the weathering; abandoned houses default to `ABANDONED`. */
  readonly weather?: Weathering;
  readonly build: (b: DwellingBuilder) => void;
}

const ABANDONED: Weathering = { fade: 0.4, grime: 0.6, patchy: 0.9 };

export const DWELLINGS: readonly DwellingDefinition[] = [
  { id: 'izba', name: 'Изба с наличниками', origin: 'Русский Север, XIX век', footprint: [11.5, 8.5], build: izba },
  { id: 'izba-ruin', name: 'Покосившаяся изба', origin: 'Русская деревня, заброшена', footprint: [8.5, 9], abandoned: true, build: izbaRuin },
  { id: 'dacha', name: 'Дача с верандой', origin: 'СССР, 1960-е', footprint: [8, 11], build: dacha },
  { id: 'finnish-house', name: 'Финский домик', origin: 'СССР, 1950-е', footprint: [10.5, 7.5], build: finnishHouse },
  { id: 'barrack', name: 'Брошенный барак', origin: 'СССР, 1950-е, заброшен', footprint: [17, 11], abandoned: true, build: barrack },
  { id: 'mazanka', name: 'Мазанка', origin: 'Украина, XIX век', footprint: [9, 6.5], build: mazanka },
  { id: 'tudor', name: 'Фахверковый коттедж', origin: 'Англия, эпоха Тюдоров', footprint: [10.5, 7.5], build: tudor },
  { id: 'chalet', name: 'Альпийское шале', origin: 'Швейцария, XIX век', footprint: [12.5, 11], build: chalet },
  { id: 'dutch-gable', name: 'Дом со ступенчатым щипцом', origin: 'Нидерланды, XVII век', footprint: [7, 12], build: dutchGable },
  { id: 'falu-cottage', name: 'Красный коттедж', origin: 'Швеция, XIX век', footprint: [9, 10], build: faluCottage },
  { id: 'turf-house', name: 'Дерновый дом', origin: 'Исландия, XVIII век', footprint: [15.5, 8.5], build: turfHouse },
  { id: 'mansard', name: 'Особняк с мансардой', origin: 'Франция, Вторая империя', footprint: [12.5, 10], build: mansard },
  { id: 'cycladic', name: 'Кикладский дом', origin: 'Греция, Киклады', footprint: [9, 6], build: cycladic },
  { id: 'trullo', name: 'Трулли', origin: 'Италия, Апулия', footprint: [12, 8.5], weather: { patchy: 0.25 }, build: trullo },
  { id: 'blackhouse', name: 'Дом под соломой', origin: 'Шотландия, Гебриды', footprint: [15.5, 6.5], weather: { patchy: 0.7, grime: 0.3 }, build: blackhouse },
  { id: 'bauhaus', name: 'Дом Баухауса', origin: 'Германия, 1920-е', footprint: [10.5, 7.5], weather: { grime: 0.08 }, build: bauhaus },
  { id: 'tbilisi', name: 'Дом с резным балконом', origin: 'Грузия, Тифлис, XIX век', footprint: [10, 10.5], build: tbilisi },
  { id: 'pueblo', name: 'Пуэбло', origin: 'Нью-Мексико, народ тива', footprint: [17.5, 10.5], build: pueblo },
  { id: 'tipi', name: 'Типи', origin: 'Великие равнины, лакота', footprint: [6.5, 6.5], build: tipi },
  { id: 'log-cabin', name: 'Бревенчатая хижина', origin: 'Фронтир США, XIX век', footprint: [9.5, 10], build: logCabin },
  { id: 'saltbox', name: 'Дом-«солонка»', origin: 'Новая Англия, XVIII век', footprint: [12, 9.5], build: saltbox },
  { id: 'victorian', name: 'Дом с башенкой', origin: 'США, викторианская эпоха', footprint: [13, 12.5], build: victorian },
  { id: 'victorian-ghost', name: 'Дом с привидениями', origin: 'США, викторианский, заброшен', footprint: [10, 15], abandoned: true, build: victorianGhost },
  { id: 'shotgun', name: 'Дом-«дробовик»', origin: 'Новый Орлеан, XIX век', footprint: [6, 17.5], build: shotgun },
  { id: 'dustbowl', name: 'Брошенная ферма', origin: 'Великие равнины, 1930-е, заброшена', footprint: [17.5, 12], abandoned: true, build: dustbowl },
  { id: 'quonset', name: 'Ангар-квонсет', origin: 'США, 1940-е, заброшен', footprint: [7, 13], abandoned: true, build: quonset },
  { id: 'airstream', name: 'Трейлер-«пуля»', origin: 'США, 1950-е', footprint: [10.5, 5], weather: { grime: 0.1 }, build: airstream },
  { id: 'trailer-wreck', name: 'Брошенный дом-трейлер', origin: 'США, 1970-е, заброшен', footprint: [14.5, 8], abandoned: true, build: trailerWreck },
  { id: 'a-frame', name: 'Дом-шалаш', origin: 'США, 1960-е', footprint: [9, 12.5], build: aFrame },
  { id: 'butterfly', name: 'Крыша-бабочка', origin: 'Палм-Спрингс, 1950-е', footprint: [25, 9.5], weather: { grime: 0.08 }, build: butterfly },
  { id: 'streamline', name: 'Стримлайн-модерн', origin: 'Майами, 1930-е', footprint: [10.5, 9], weather: { grime: 0.08 }, build: streamline },
  { id: 'hacienda', name: 'Асьенда', origin: 'Мексика, колониальная эпоха', footprint: [17, 12], build: hacienda },
  { id: 'casita', name: 'Пёстрые каситы', origin: 'Мексика, Гуанахуато', footprint: [12.5, 7], build: casita },
  { id: 'adobe-ruin', name: 'Руины саманного дома', origin: 'Юго-запад США, заброшен', footprint: [13, 12], abandoned: true, build: adobeRuin },
  { id: 'maya', name: 'Хижина майя', origin: 'Юкатан, народ майя', footprint: [14, 12.5], build: maya },
  { id: 'chattel', name: 'Карибский домик', origin: 'Барбадос, XIX век', footprint: [9.5, 9.5], build: chattel },
  { id: 'djenne', name: 'Глиняный дом', origin: 'Мали, Дженне', footprint: [10.5, 8.5], build: djenne },
  { id: 'nubian', name: 'Нубийский дом', origin: 'Египет, Нубия', footprint: [13, 8], build: nubian },
  { id: 'yemen', name: 'Дом с камарией', origin: 'Йемен, Сана', footprint: [8.5, 7.5], build: yemen },
  { id: 'windcatcher', name: 'Дом с бадгиром', origin: 'Иран, Йезд', footprint: [14, 6.5], build: windcatcher },
  { id: 'rondavel', name: 'Рондавели', origin: 'Южная Африка, басуто', footprint: [15, 11.5], build: rondavel },
  { id: 'ndebele', name: 'Расписной дом', origin: 'ЮАР, народ ндебеле', footprint: [11.5, 11.5], weather: { grime: 0.1 }, build: ndebele },
  { id: 'lebanese', name: 'Дом с тройной аркой', origin: 'Ливан, XIX век', footprint: [13.5, 10], build: lebanese },
  { id: 'minka', name: 'Минка', origin: 'Япония, эпоха Эдо', footprint: [14, 11.5], build: minka },
  { id: 'chinese', name: 'Павильон с изогнутой крышей', origin: 'Китай, эпоха Цин', footprint: [15.5, 12], build: chinese },
  { id: 'yurt', name: 'Юрта', origin: 'Монголия', footprint: [7, 7], weather: { grime: 0.1 }, build: yurt },
  { id: 'thai-stilt', name: 'Дом на сваях', origin: 'Таиланд, Центральная равнина', footprint: [12.5, 12], build: thaiStilt },
  { id: 'tongkonan', name: 'Тонгконан', origin: 'Сулавеси, народ тораджа', footprint: [15.5, 8], build: tongkonan },
  { id: 'haveli', name: 'Хавели', origin: 'Индия, Раджастхан', footprint: [12.5, 10.5], build: haveli },
  { id: 'futuro', name: 'Дом «Футуро»', origin: 'Финляндия, 1968', footprint: [8.5, 9], weather: { grime: 0.06 }, build: futuro },
];

export interface DwellingGeometry {
  /** Vertex-coloured shell: what is drawn with the comic material and what is collided with. */
  readonly body: THREE.BufferGeometry;
  readonly glass: THREE.BufferGeometry | null;
}

/** Builds one dwelling's two geometries. Pure: the same index is always the same house. */
export function buildDwellingGeometry(index: number): DwellingGeometry {
  const definition = DWELLINGS[index];
  if (!definition) throw new RangeError(`Unknown dwelling ${index}`);
  const builder = new DwellingBuilder(definition.weather ?? (definition.abandoned ? ABANDONED : undefined));
  definition.build(builder);
  return { body: builder.geometry(), glass: builder.glassGeometry() };
}
