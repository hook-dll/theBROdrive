import { hash01 } from '../core/rng';
import { seasonAt, type SeasonState } from './season';

/**
 * THE WEATHER ALONG THE ROAD.
 *
 * Where the season takes hundreds of kilometres to turn (world/season.ts), the weather
 * changes often: the road is cut into spells of 6 to 22 km, each spell one kind of
 * weather, and the spells run into each other over a couple of kilometres, so a front
 * is seen coming — the sky greys ahead before the first drops. Like the season, it is a
 * pure function of arclength: the same road always has the same weather, and driving
 * back is driving back into the rain you left.
 *
 * What a spell can be depends on the season it falls in: summer is mostly fair with
 * showers, autumn grey with rain and fog, winter overcast with snow and the odd frosty
 * clear day. Rain in winter falls as snow (`snowing`).
 *
 * The weather is a handful of channels, 0..1, read by the sky (cloud, light, fog), the
 * post pass and the precipitation near the camera (render/precipitation.ts), and the
 * ground and road (wet).
 */

export interface WeatherState {
  /** Cloud cover beyond fair-weather cumulus: 1 is a closed grey sky, no sun. */
  overcast: number;
  /** Rain or snow falling, 0..1 heavy. */
  precip: number;
  /** Whether what falls is snow, 0..1 (by the season's snow channel). */
  snowing: number;
  /** Ground fog, 0..1 thick. */
  fog: number;
  /** How wet the ground and road are: rain's, lingering after it for a few km. */
  wet: number;
}

export function newWeatherState(): WeatherState {
  return { overcast: 0, precip: 0, snowing: 0, fog: 0, wet: 0 };
}

type Kind = 'clear' | 'fair' | 'cloudy' | 'overcast' | 'rain' | 'fog';

/** Each kind's channels at its height. */
const KINDS: Record<Kind, { overcast: number; precip: number; fog: number }> = {
  clear: { overcast: 0, precip: 0, fog: 0 },
  fair: { overcast: 0.15, precip: 0, fog: 0 },
  cloudy: { overcast: 0.5, precip: 0, fog: 0 },
  overcast: { overcast: 0.9, precip: 0, fog: 0.15 },
  rain: { overcast: 1, precip: 0.85, fog: 0.25 },
  fog: { overcast: 0.7, precip: 0, fog: 1 },
};

const ORDER: readonly Kind[] = ['clear', 'fair', 'cloudy', 'overcast', 'rain', 'fog'];

/** How likely each kind is: summer, autumn and winter, in `ORDER`. */
const ODDS_SUMMER = [0.22, 0.3, 0.2, 0.08, 0.14, 0.06];
const ODDS_AUTUMN = [0.1, 0.15, 0.2, 0.22, 0.2, 0.13];
const ODDS_WINTER = [0.2, 0.12, 0.2, 0.25, 0.18, 0.05];

/** Spell length range, metres, and the length of road over which two spells blend. */
const SPELL_MIN_M = 6000;
const SPELL_MAX_M = 22000;
const BLEND_M = 2500;
/** The grid spells are hashed on: every spell starts on a multiple of this. */
const SPELL_GRID_M = 2000;
const TAG = 0x77656174;
/** A fog bank's thick stretch, and the metres over which it lifts. */
const FOG_BANK_M = 3500;
const FOG_LIFT_M = 3000;

function smoothstep01(x: number): number {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
}

/** How far behind the rain a road stays wet, metres. */
const WET_LINGER_M = 5000;

/**
 * The spell whose start is the last grid mark at or before `s`. A spell starts at
 * grid mark k when the hash says so; the chance is set so spells average about the
 * middle of their range. Walking back over a few marks finds the current one.
 */
function spellStartBefore(seed: number, s: number): number {
  let k = Math.floor(s / SPELL_GRID_M);
  // Never more than SPELL_MAX_M / SPELL_GRID_M marks back.
  for (let back = 0; back < SPELL_MAX_M / SPELL_GRID_M; back++, k--) {
    if (k * SPELL_GRID_M <= 0 || spellStartsAt(seed, k)) return k * SPELL_GRID_M;
  }
  return k * SPELL_GRID_M;
}

function spellStartsAt(seed: number, k: number): boolean {
  // Never two starts closer than SPELL_MIN_M: a start needs the marks before it clear.
  if (hash01(seed, TAG, k, 1) > 0.18) return false;
  for (let j = 1; j < SPELL_MIN_M / SPELL_GRID_M; j++) if (hash01(seed, TAG, k - j, 1) <= 0.18) return false;
  return true;
}

/** The kind of the spell starting at `start`, by the season there. */
function spellKind(seed: number, start: number, startDay: number, season: SeasonState): Kind {
  seasonAt(start, startDay, season);
  const autumn = Math.min(1, season.dry * (1 - season.snow));
  const winter = season.snow;
  const summer = Math.max(0, 1 - autumn - winter);
  const r = hash01(seed, TAG, Math.floor(start / SPELL_GRID_M), 2);
  let acc = 0;
  for (let i = 0; i < ORDER.length; i++) {
    acc += ODDS_SUMMER[i]! * summer + ODDS_AUTUMN[i]! * autumn + ODDS_WINTER[i]! * winter;
    if (r < acc) return ORDER[i]!;
  }
  return 'fair';
}

const scratchSeason: SeasonState = { day: 0, turn: 0, dry: 0, bare: 0, snow: 0, fresh: 0 };

/** The raw channels at `s`, blending into the next spell over its last `BLEND_M`. */
function channelsAt(seed: number, s: number, startDay: number, out: WeatherState): WeatherState {
  const start = spellStartBefore(seed, s);
  // The next spell's start: the first grid mark after this one that begins a spell.
  let next = start + SPELL_GRID_M;
  while (next - start < SPELL_MAX_M && !spellStartsAt(seed, Math.round(next / SPELL_GRID_M))) next += SPELL_GRID_M;
  const kindA = spellKind(seed, start, startDay, scratchSeason);
  const a = KINDS[kindA];
  const b = KINDS[spellKind(seed, next, startDay, scratchSeason)];
  const x = Math.min(1, Math.max(0, (s - (next - BLEND_M)) / BLEND_M));
  const t = x * x * (3 - 2 * x);
  // Fog lies in banks, not for a whole spell: thick for its first few km, then lifting
  // to the grey sky it leaves behind.
  const lift = kindA === 'fog' ? 1 - smoothstep01((s - start - FOG_BANK_M) / FOG_LIFT_M) : 1;
  out.overcast = a.overcast + (b.overcast - a.overcast) * t;
  out.precip = a.precip + (b.precip - a.precip) * t;
  out.fog = a.fog * lift + (b.fog - a.fog * lift) * t;
  return out;
}

const scratchWeather = newWeatherState();

/** The weather at arclength `s` of a drive that opened on day `startDay`. */
export function weatherAt(seed: number, s: number, startDay: number, season: SeasonState, out: WeatherState = newWeatherState()): WeatherState {
  channelsAt(seed, s, startDay, out);
  out.snowing = Math.min(1, season.snow * 1.4);
  // Wet: the heaviest rain within the last few km behind, fading with distance; snow
  // does not wet the road as rain does.
  let wet = out.precip;
  for (let k = 1; k <= 5; k++) {
    const back = (k / 5) * WET_LINGER_M;
    channelsAt(seed, s - back, startDay, scratchWeather);
    wet = Math.max(wet, scratchWeather.precip * (1 - back / WET_LINGER_M));
  }
  out.wet = wet * (1 - out.snowing);
  return out;
}

/** DEV: channels to hold the weather at instead of the road's, or null. `__bro.weather`. */
export const WEATHER_OVERRIDE: { state: Partial<WeatherState> | null } = { state: null };
