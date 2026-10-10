import type { Weathering } from './builder';

/**
 * The dwelling catalogue's DATA: identity, provenance and authored size, without the
 * builders. Split from ./catalogue.ts so the world's pure placement (world/poislots.ts,
 * which the terrain workers reach through world/layby.ts) can count the catalogue and
 * read a house's footprint without importing three.js and fifty geometry builders.
 * ./catalogue.ts pairs each entry with its builder by `id`.
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
  /** Overrides the weathering; abandoned houses default to `ABANDONED` (./catalogue.ts). */
  readonly weather?: Weathering;
}

export const DWELLINGS: readonly DwellingDefinition[] = [
  { id: 'izba', name: 'Изба с наличниками', origin: 'Русский Север, XIX век', footprint: [11.5, 8.5] },
  { id: 'izba-ruin', name: 'Покосившаяся изба', origin: 'Русская деревня, заброшена', footprint: [8.5, 9], abandoned: true },
  { id: 'dacha', name: 'Дача с верандой', origin: 'СССР, 1960-е', footprint: [8, 11] },
  { id: 'finnish-house', name: 'Финский домик', origin: 'СССР, 1950-е', footprint: [10.5, 7.5] },
  { id: 'barrack', name: 'Брошенный барак', origin: 'СССР, 1950-е, заброшен', footprint: [17, 11], abandoned: true },
  { id: 'mazanka', name: 'Мазанка', origin: 'Украина, XIX век', footprint: [9, 6.5] },
  { id: 'tudor', name: 'Фахверковый коттедж', origin: 'Англия, эпоха Тюдоров', footprint: [10.5, 7.5] },
  { id: 'chalet', name: 'Альпийское шале', origin: 'Швейцария, XIX век', footprint: [12.5, 11] },
  { id: 'dutch-gable', name: 'Дом со ступенчатым щипцом', origin: 'Нидерланды, XVII век', footprint: [7, 12] },
  { id: 'falu-cottage', name: 'Красный коттедж', origin: 'Швеция, XIX век', footprint: [9, 10] },
  { id: 'turf-house', name: 'Дерновый дом', origin: 'Исландия, XVIII век', footprint: [15.5, 8.5] },
  { id: 'mansard', name: 'Особняк с мансардой', origin: 'Франция, Вторая империя', footprint: [12.5, 10] },
  { id: 'cycladic', name: 'Кикладский дом', origin: 'Греция, Киклады', footprint: [9, 6] },
  { id: 'trullo', name: 'Трулли', origin: 'Италия, Апулия', footprint: [12, 8.5], weather: { patchy: 0.25 } },
  { id: 'blackhouse', name: 'Дом под соломой', origin: 'Шотландия, Гебриды', footprint: [15.5, 6.5], weather: { patchy: 0.7, grime: 0.3 } },
  { id: 'bauhaus', name: 'Дом Баухауса', origin: 'Германия, 1920-е', footprint: [10.5, 7.5], weather: { grime: 0.08 } },
  { id: 'tbilisi', name: 'Дом с резным балконом', origin: 'Грузия, Тифлис, XIX век', footprint: [10, 10.5] },
  { id: 'pueblo', name: 'Пуэбло', origin: 'Нью-Мексико, народ тива', footprint: [17.5, 10.5] },
  { id: 'tipi', name: 'Типи', origin: 'Великие равнины, лакота', footprint: [6.5, 6.5] },
  { id: 'log-cabin', name: 'Бревенчатая хижина', origin: 'Фронтир США, XIX век', footprint: [9.5, 10] },
  { id: 'saltbox', name: 'Дом-«солонка»', origin: 'Новая Англия, XVIII век', footprint: [12, 9.5] },
  { id: 'victorian', name: 'Дом с башенкой', origin: 'США, викторианская эпоха', footprint: [13, 12.5] },
  { id: 'victorian-ghost', name: 'Дом с привидениями', origin: 'США, викторианский, заброшен', footprint: [10, 15], abandoned: true },
  { id: 'shotgun', name: 'Дом-«дробовик»', origin: 'Новый Орлеан, XIX век', footprint: [6, 17.5] },
  { id: 'dustbowl', name: 'Брошенная ферма', origin: 'Великие равнины, 1930-е, заброшена', footprint: [17.5, 12], abandoned: true },
  { id: 'quonset', name: 'Ангар-квонсет', origin: 'США, 1940-е, заброшен', footprint: [7, 13], abandoned: true },
  { id: 'airstream', name: 'Трейлер-«пуля»', origin: 'США, 1950-е', footprint: [10.5, 5], weather: { grime: 0.1 } },
  { id: 'trailer-wreck', name: 'Брошенный дом-трейлер', origin: 'США, 1970-е, заброшен', footprint: [14.5, 8], abandoned: true },
  { id: 'a-frame', name: 'Дом-шалаш', origin: 'США, 1960-е', footprint: [9, 12.5] },
  { id: 'butterfly', name: 'Крыша-бабочка', origin: 'Палм-Спрингс, 1950-е', footprint: [25, 9.5], weather: { grime: 0.08 } },
  { id: 'streamline', name: 'Стримлайн-модерн', origin: 'Майами, 1930-е', footprint: [10.5, 9], weather: { grime: 0.08 } },
  { id: 'hacienda', name: 'Асьенда', origin: 'Мексика, колониальная эпоха', footprint: [17, 12] },
  { id: 'casita', name: 'Пёстрые каситы', origin: 'Мексика, Гуанахуато', footprint: [12.5, 7] },
  { id: 'adobe-ruin', name: 'Руины саманного дома', origin: 'Юго-запад США, заброшен', footprint: [13, 12], abandoned: true },
  { id: 'maya', name: 'Хижина майя', origin: 'Юкатан, народ майя', footprint: [14, 12.5] },
  { id: 'chattel', name: 'Карибский домик', origin: 'Барбадос, XIX век', footprint: [9.5, 9.5] },
  { id: 'djenne', name: 'Глиняный дом', origin: 'Мали, Дженне', footprint: [10.5, 8.5] },
  { id: 'nubian', name: 'Нубийский дом', origin: 'Египет, Нубия', footprint: [13, 8] },
  { id: 'yemen', name: 'Дом с камарией', origin: 'Йемен, Сана', footprint: [8.5, 7.5] },
  { id: 'windcatcher', name: 'Дом с бадгиром', origin: 'Иран, Йезд', footprint: [14, 6.5] },
  { id: 'rondavel', name: 'Рондавели', origin: 'Южная Африка, басуто', footprint: [15, 11.5] },
  { id: 'ndebele', name: 'Расписной дом', origin: 'ЮАР, народ ндебеле', footprint: [11.5, 11.5], weather: { grime: 0.1 } },
  { id: 'lebanese', name: 'Дом с тройной аркой', origin: 'Ливан, XIX век', footprint: [13.5, 10] },
  { id: 'minka', name: 'Минка', origin: 'Япония, эпоха Эдо', footprint: [14, 11.5] },
  { id: 'chinese', name: 'Павильон с изогнутой крышей', origin: 'Китай, эпоха Цин', footprint: [15.5, 12] },
  { id: 'yurt', name: 'Юрта', origin: 'Монголия', footprint: [7, 7], weather: { grime: 0.1 } },
  { id: 'thai-stilt', name: 'Дом на сваях', origin: 'Таиланд, Центральная равнина', footprint: [12.5, 12] },
  { id: 'tongkonan', name: 'Тонгконан', origin: 'Сулавеси, народ тораджа', footprint: [15.5, 8] },
  { id: 'haveli', name: 'Хавели', origin: 'Индия, Раджастхан', footprint: [12.5, 10.5] },
  { id: 'futuro', name: 'Дом «Футуро»', origin: 'Финляндия, 1968', footprint: [8.5, 9], weather: { grime: 0.06 } },
];
