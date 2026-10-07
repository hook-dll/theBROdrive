import { hash01, hashUnit3 } from '../core/rng';
import { SurfaceType } from '../core/surfaces';

/**
 * WEATHER: the state of the air around the player, as a function of the game clock.
 *
 * WHAT IT REPLACES. The desert used to have "weather" as objects: a few alpha sheets
 * standing a kilometre off the road once every 26 km, seen for a kilometre and gone.
 * The air, the light, the road and the car never changed, so it read as a sticker on
 * the horizon. Weather here is the other thing entirely — a handful of numbers that
 * every system already owning a piece of the picture reads: the sky, the fog, the key
 * and fill lights, the cloud shade on the ground, the post pass, the ground materials,
 * the tyres, the radiator. No new geometry of any size, two particle draws, and a few
 * uniform branches that cost nothing while their weather is absent.
 *
 * HOW IT IS SCHEDULED. The clock is cut into fixed SLOTS of `SLOT_S` seconds. Each
 * slot owns at most one EPISODE — a small authored timeline of one kind of weather,
 * with its own harbinger, peak and clearance — jittered inside the slot. That makes
 * the state a pure function of `(seed, clock)`: nothing to save, a loaded game shows
 * the weather it would have had, and any moment can be asked about in O(1). The same
 * lattice-and-jitter shape as the road's variety director (world/director.ts), for
 * the same reasons.
 *
 * PACE. A slot is ten minutes of play (ten game hours at the default clock). An episode
 * fills 50-80% of it, and a quarter of the slots hold none at all, so about half of a
 * drive is plain clear desert sky: weather is an event on the way, not the climate.
 * Among the episodes a heat wave is the commonest and the storm fronts (rain, haboob)
 * the rarer ones — this is a hot desert first, and a stretch of clear, shimmering
 * afternoon is what most of it should look like.
 *
 * NEVER HOSTILE. Every channel's effect on play is bounded where it is applied: wet
 * asphalt keeps 84% of its grip, a haboob leaves a hundred-odd metres of sight. The
 * crosswind is the one that asks for a hand on the wheel: a steady correction of a
 * fraction of a degree and an answer to the gusts (see `Vehicle.applyAero`). The point
 * is to ask for a small adaptation — lights on, a little slower, a hand on the wheel —
 * never to punish.
 */

export type WeatherKind = 'clear' | 'haze' | 'wind' | 'haboob' | 'storm' | 'heat';

/**
 * Every channel is 0..1. What each one means is defined here, once; what each one
 * does is defined by whoever reads it.
 */
export interface WeatherChannels {
  /** Mgla: fine suspended dust. A beige, flat, low-contrast sky; the sun a pale disc. */
  haze: number;
  /** Inside a dust storm: brown dusk at noon, a hundred metres of sight. */
  dust: number;
  /** A haboob's wall on its way in: 0 not yet raised, 1 at the player. */
  front: number;
  /** Convective cloud overhead: 0 open sky, 1 a closed storm deck. */
  cloud: number;
  /** Rainfall at the player. */
  rain: number;
  /** How wet the ground is. Lags rain on the way down: the desert dries in minutes. */
  wet: number;
  /** Surface wind, 0 calm to 1 a haboob's gust front. */
  wind: number;
  /** Sand streaming across the ground in the wind (pozyomka). */
  drift: number;
  /** A heat wave: more boil, more mirage, hotter air. */
  heat: number;
  /** Cirrostratus: the 22-degree halo and sun dogs, a milky sky. A harbinger. */
  halo: number;
  /** Air scrubbed clean by rain or wind: far horizons, deep colour. */
  clarity: number;
}

const CHANNELS: readonly (keyof WeatherChannels)[] = [
  'haze', 'dust', 'front', 'cloud', 'rain', 'wet',
  'wind', 'drift', 'heat', 'halo', 'clarity',
];

function zeroChannels(): WeatherChannels {
  return {
    haze: 0, dust: 0, front: 0, cloud: 0, rain: 0, wet: 0,
    wind: 0, drift: 0, heat: 0, halo: 0, clarity: 0,
  };
}

/** One authored moment of an episode, at `t` in 0..1 of the episode's length. */
type Key = readonly [t: number, values: Partial<WeatherChannels>];

/**
 * The episodes. Each starts and ends at zero on every channel, so an episode's edges
 * are clear sky whatever its neighbours are, and keys are interpolated per channel
 * with a smoothstep so nothing ever moves at a constant rate.
 *
 * The orders are the real ones, which is most of what makes them read as weather
 * rather than as effects: a halo and a milky sky BEFORE a storm (cirrostratus runs
 * ahead of a front), the deck closing, the wind before the rain; a haboob's wind and
 * blowing sand before its wall, the wall visible for minutes before it arrives, the
 * dust thinning slowly afterwards; and after both, the clearest air of the day.
 */
const EPISODES: Record<Exclude<WeatherKind, 'clear'>, readonly Key[]> = {
  storm: [
    [0, {}],
    [0.1, { halo: 0.85, cloud: 0.08 }],
    [0.2, { halo: 0.45, cloud: 0.2, wind: 0.15 }],
    [0.3, { halo: 0.1, cloud: 0.45, wind: 0.35 }],
    [0.38, { cloud: 0.8, wind: 0.55, rain: 0.1 }],
    [0.44, { cloud: 1, wind: 0.5, rain: 0.85, wet: 0.7 }],
    [0.5, { cloud: 1, wind: 0.45, rain: 1, wet: 1 }],
    [0.62, { cloud: 1, wind: 0.4, rain: 0.9, wet: 1 }],
    [0.69, { cloud: 0.6, wind: 0.25, rain: 0.15, wet: 1, clarity: 0.4 }],
    [0.76, { cloud: 0.3, wind: 0.12, wet: 0.85, clarity: 1 }],
    [0.88, { cloud: 0.12, wet: 0.35, clarity: 0.8 }],
    [1, {}],
  ],
  haboob: [
    [0, {}],
    [0.08, { wind: 0.2, drift: 0.15, front: 0.02 }],
    [0.2, { wind: 0.45, drift: 0.6, front: 0.4, haze: 0.1 }],
    [0.36, { wind: 0.7, drift: 1, front: 0.985, haze: 0.2 }],
    [0.38, { wind: 1, drift: 1, front: 1, dust: 0.9, haze: 0.2 }],
    [0.4, { wind: 1, drift: 1, dust: 1, haze: 0.2 }],
    [0.58, { wind: 0.85, drift: 0.9, dust: 0.85, haze: 0.3 }],
    [0.7, { wind: 0.55, drift: 0.6, dust: 0.3, haze: 0.45 }],
    [0.8, { wind: 0.3, drift: 0.2, haze: 0.2, clarity: 0.5 }],
    [0.9, { wind: 0.1, clarity: 0.6 }],
    [1, {}],
  ],
  haze: [
    [0, {}],
    [0.25, { haze: 1, wind: 0.1 }],
    [0.75, { haze: 1, wind: 0.1 }],
    [1, {}],
  ],
  wind: [
    [0, {}],
    [0.15, { halo: 0.5, wind: 0.2 }],
    [0.3, { halo: 0.2, wind: 0.65, drift: 1, haze: 0.12 }],
    [0.7, { wind: 0.7, drift: 1, haze: 0.15 }],
    [0.85, { wind: 0.3, drift: 0.3, clarity: 0.5 }],
    [1, {}],
  ],
  heat: [
    [0, {}],
    [0.25, { heat: 1, haze: 0.2 }],
    [0.75, { heat: 1, haze: 0.25 }],
    [1, {}],
  ],
};

/** Where the haboob timeline has its wall reach the player. */
const HABOOB_ARRIVAL = 0.38;
/** How far out a haboob wall is first raised, metres. */
export const FRONT_FAR_M = 9000;

/** Seconds of play per slot. */
export const WEATHER_SLOT_S = 600;
/** An episode fills this share of its slot. */
const EPISODE_MIN = 0.5;
const EPISODE_MAX = 0.8;

const KINDS: readonly Exclude<WeatherKind, 'clear'>[] = ['haze', 'wind', 'haboob', 'storm', 'heat'];
/**
 * Heat first. Measured over 20 000 slots after the no-repeat rule: a heat wave 21% of
 * slots, storm 13%, haboob 11%, haze and wind 15% each, clear 25%; the fronts (rain and
 * haboob) hold about 16% of the clock against 26% before the desert was made clearer.
 */
const WEIGHTS: readonly number[] = [0.18, 0.18, 0.14, 0.18, 0.32];
/** Share of slots with no episode at all: a whole clear ten minutes, one slot in four. */
const CLEAR_SHARE = 0.25;

const TAG_KIND = 0x57455231; // 'WER1'
const TAG_SPAN = 0x57455232;
const TAG_JITTER = 0x57455233;
const TAG_WIND = 0x57455234;
const TAG_GUST = 0x57455235;
const TAG_GUST_ACROSS = 0x57455237;
const TAG_BOLT = 0x57455236;

function rawKind(seed: number, slot: number): number {
  const r = hash01(seed, TAG_KIND, slot);
  if (r < CLEAR_SHARE) return -1;
  let x = ((r - CLEAR_SHARE) / (1 - CLEAR_SHARE)) * WEIGHTS.reduce((a, b) => a + b, 0);
  for (let i = 0; i < WEIGHTS.length; i++) {
    x -= WEIGHTS[i]!;
    if (x < 0) return i;
  }
  return WEIGHTS.length - 1;
}

/** Slots per chain block; see `weatherKindOfSlot`. */
const BLOCK = 16;

/**
 * Kind of one slot. Never the same episode twice running.
 *
 * "Different from the last one" is a dependency on the previous slot, and followed
 * all the way back it is a walk to slot zero. So the chain is walked from the start
 * of the PREVIOUS block of sixteen, whose first slot is taken raw: at most 32 hashes,
 * the same answer from any caller, and a repeat is impossible except in the one case
 * of a raw first slot matching its predecessor, which the second block absorbs.
 *
 * A heat wave is allowed to fall at night: every consumer of `heat` gates it by the
 * sun's own heating (render/heathaze.ts), so a night "heat wave" is a warm, still
 * night and nothing else, which is honest.
 */
export function weatherKindOfSlot(seed: number, slot: number): WeatherKind {
  const first = (Math.floor(slot / BLOCK) - 1) * BLOCK;
  let previous = rawKind(seed, first);
  for (let i = first + 1; i <= slot; i++) {
    let k = rawKind(seed, i);
    if (k >= 0 && k === previous) k = (k + 1 + (i & 1)) % KINDS.length;
    previous = k;
  }
  return previous < 0 ? 'clear' : KINDS[previous]!;
}

/** Where a slot's episode sits inside it, in seconds of clock. */
function episodeSpan(seed: number, slot: number): { start: number; length: number } {
  const share = EPISODE_MIN + (EPISODE_MAX - EPISODE_MIN) * hash01(seed, TAG_SPAN, slot);
  const length = share * WEATHER_SLOT_S;
  const start = slot * WEATHER_SLOT_S + (WEATHER_SLOT_S - length) * hash01(seed, TAG_JITTER, slot);
  return { start, length };
}

function smooth(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** Writes the channels of `kind`'s timeline at `t` (0..1) into `out`. */
function sampleEpisode(kind: WeatherKind, t: number, out: WeatherChannels): void {
  for (const c of CHANNELS) out[c] = 0;
  if (kind === 'clear' || t <= 0 || t >= 1) return;
  const keys = EPISODES[kind];
  let i = 1;
  while (i < keys.length - 1 && keys[i]![0] < t) i++;
  const [t0, a] = keys[i - 1]!;
  const [t1, b] = keys[i]!;
  const u = smooth((t - t0) / Math.max(1e-6, t1 - t0));
  for (const c of CHANNELS) {
    const va = a[c] ?? 0;
    const vb = b[c] ?? 0;
    out[c] = va + (vb - va) * u;
  }
}

// ---------------------------------------------------------------------------
// Live state
// ---------------------------------------------------------------------------

/** Peak sustained wind at `wind` = 1, m/s. A haboob's gust front; gusts go above it. */
export const WIND_MAX_MPS = 17;

/**
 * GUSTS. The wind is a mean plus a turbulent field `windAt` samples at any point: a
 * car feels the gusts it drives into, the camera hears the ones blowing past it, and
 * two cars a kilometre apart are not shoved in step.
 *
 * The field is frozen turbulence (Taylor's hypothesis, the standard surface-layer
 * model): a fixed pattern carried downwind. Standing still, the gusts come at the
 * wind's own pace; driving through them, at the car's. Eddies near the ground are
 * elongated along the wind, so the pattern is stretched that way.
 *
 *   intensity  σu/U = 1/ln(z/z0) for a car-height z ≈ 1 m over flat desert, z0 a few
 *              millimetres: 0.15-0.18. 0.14 open, up to 0.20 under a storm's outflow
 *              or a haboob's gust front. Peak 3 s gusts then run 1.3-1.5 × the mean,
 *              the gust factor anemometers record at that height.
 *   lateral    σv = 0.75 σu: the direction swings as well, which is what a car on a
 *              road along the wind still feels.
 *   scales     three octaves, 60, 24 and 10 m along the wind and 0.4 of that across,
 *              their amplitudes ∝ λ^(1/3): the inertial-subrange −5/3 slope. Nothing
 *              under 10 m either way: an eddy shorter than about two car lengths
 *              pushes the nose and the tail opposite ways and averages out over the
 *              body (the aerodynamic admittance), so the field is the wind a body
 *              feels, not what an anemometer at a point would record.
 *
 * It travels at the episode's PEAK wind, not the moment's: a pure function of
 * (seed, slot, clock) that way, where carrying it at the live speed would need the
 * integral of that speed over the whole game. Only at an episode's edges does the
 * difference show, and there the wind is light anyway.
 */
const GUST_INTENSITY_OPEN = 0.14;
const GUST_INTENSITY_STORM = 0.06;
const GUST_LATERAL = 0.75;
const GUST_OCTAVES_M: readonly number[] = [60, 24, 10];
const GUST_ACROSS_STRETCH = 0.4;
const GUST_MIN_SCALE_M = 10;
const GUST_AMPLITUDE: readonly number[] = GUST_OCTAVES_M.map((l) => Math.cbrt(l / GUST_OCTAVES_M[0]!));

/**
 * 1/σ of the octave sum, so `gustNoise` has unit standard deviation. One octave of
 * value noise on uniform [-1, 1] lattice values has variance 1/3 times the square of
 * the mean of (1-s)²+s² over a cell (s the interpolation weight), per axis.
 */
const GUST_NORM = ((): number => {
  let shrink = 0;
  const n = 1000;
  for (let i = 0; i < n; i++) {
    const s = smooth((i + 0.5) / n);
    shrink += (1 - s) * (1 - s) + s * s;
  }
  shrink /= n;
  let variance = 0;
  for (const a of GUST_AMPLITUDE) variance += a * a * (1 / 3) * shrink * shrink;
  return 1 / Math.sqrt(variance);
})();

/** Value noise on an integer lattice, in [-1, 1]. */
function latticeNoise(seed: number, x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const tx = smooth(x - ix);
  const ty = smooth(y - iy);
  const a = hashUnit3(seed, ix, iy);
  const b = hashUnit3(seed, ix + 1, iy);
  const c = hashUnit3(seed, ix, iy + 1);
  const d = hashUnit3(seed, ix + 1, iy + 1);
  const lower = a + (b - a) * tx;
  const upper = c + (d - c) * tx;
  return 2 * (lower + (upper - lower) * ty) - 1;
}

/** The gust pattern at (along, across) metres in its own frame: zero mean, unit σ. */
function gustNoise(seed: number, along: number, across: number): number {
  let sum = 0;
  for (let o = 0; o < GUST_OCTAVES_M.length; o++) {
    const l = GUST_OCTAVES_M[o]!;
    const lAcross = Math.max(l * GUST_ACROSS_STRETCH, GUST_MIN_SCALE_M);
    sum += GUST_AMPLITUDE[o]! * latticeNoise(seed + o * 0x9e37, along / l, across / lAcross);
  }
  return sum * GUST_NORM;
}

/** The live gust pattern's frame; set by `updateWeather`, read by `windAt`. */
const gust = { seed: 0, axisX: 1, axisZ: 0, advectM: 0 };

/** Highest `wind` each episode reaches: the speed its gust pattern is carried at. */
const EPISODE_PEAK_WIND: Record<WeatherKind, number> = {
  clear: 0,
  haze: 0,
  wind: 0,
  haboob: 0,
  storm: 0,
  heat: 0,
};
for (const kind of KINDS) {
  for (const [, key] of EPISODES[kind]) {
    EPISODE_PEAK_WIND[kind] = Math.max(EPISODE_PEAK_WIND[kind], key.wind ?? 0);
  }
}

/**
 * The frame's weather. One shared object, like the cloud-shadow uniforms: everything
 * that reads weather reads this, and `updateWeather` is the only writer.
 */
export interface WeatherFrame extends WeatherChannels {
  kind: WeatherKind;
  /** Episode progress 0..1, or 0 in clear sky. */
  progress: number;
  /** Unit horizontal direction the wind blows TOWARD. */
  windX: number;
  windZ: number;
  /**
   * Wind speed at the listener (the position `updateWeather` was given), gusts
   * included, m/s. Anything that needs the wind somewhere else asks `windAt`.
   */
  windMps: number;
  /** Mean wind, gusts excluded, m/s: `WIND_MAX_MPS` times the `wind` channel. */
  windMeanMps: number;
  /** Gust strength σu / mean wind (see GUST_INTENSITY_OPEN); 0 is a steady wind. */
  gustIntensity: number;
  /**
   * Distance of an approaching haboob wall, metres upwind, or -1 when there is none
   * to draw. Only while it APPROACHES: once it has arrived the player is inside the
   * dust and the wall is the fog.
   */
  frontM: number;
  /** Air temperature offset from the clear-sky daily curve, degrees C. */
  airOffsetC: number;
  /** Lightning: 0 dark, up to ~1 at the peak of a stroke. */
  flash: number;
  /** Bearing of the current or last stroke, radians, and its distance in metres. */
  boltAzimuth: number;
  boltDistance: number;
  /** Seed of the current stroke's shape, 0..1; changes per stroke. */
  boltSeed: number;
  /** Seconds since the current stroke began (thunder delay is read against it). */
  boltAge: number;
}

export const weather: WeatherFrame = {
  ...zeroChannels(),
  kind: 'clear',
  progress: 0,
  windX: 1,
  windZ: 0,
  windMps: 0,
  windMeanMps: 0,
  gustIntensity: 0,
  frontM: -1,
  airOffsetC: 0,
  flash: 0,
  boltAzimuth: 0,
  boltDistance: 5000,
  boltSeed: 0,
  boltAge: 99,
};

/** A forced episode for development: its kind and the clock it was started at. */
interface Override {
  kind: WeatherKind;
  start: number;
  length: number;
  /** When set, the episode is frozen at this progress. */
  hold: number | null;
}
let override: Override | null = null;

const target = zeroChannels();
let initialised = false;
let lastClock = Number.NaN;

/**
 * Starts `kind` now for development, optionally frozen at `hold` (0..1 of the
 * episode). `null` hands the sky back to the schedule.
 */
export function forceWeather(kind: WeatherKind | null, hold: number | null = null, lengthS = 420): void {
  override = kind === null ? null : { kind, start: Number.isFinite(lastClock) ? lastClock : 0, length: lengthS, hold };
  initialised = false;
}

/** What the schedule says at an instant, without smoothing. Pure. */
export function weatherAt(
  seed: number,
  clockS: number,
  out: WeatherChannels,
): { kind: WeatherKind; progress: number; slot: number } {
  const slot = Math.floor(clockS / WEATHER_SLOT_S);
  const kind = weatherKindOfSlot(seed, slot);
  const span = episodeSpan(seed, slot);
  const progress = (clockS - span.start) / span.length;
  sampleEpisode(kind, progress, out);
  return { kind, progress: Math.min(1, Math.max(0, progress)), slot };
}

/** Wind bearing of a slot: haboobs and storms come from their own quarter. */
function slotWindAngle(seed: number, slot: number): number {
  return hash01(seed, TAG_WIND, slot) * Math.PI * 2;
}

/** Smooth 1D value noise on the clock, 0..1, for gusts. */
function clockNoise(seed: number, tag: number, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = hash01(seed, tag, i);
  const b = hash01(seed, tag, i + 1);
  return a + (b - a) * smooth(f);
}

/**
 * Advances the frame's weather. `clockS` is PLAYED time in seconds — real seconds of
 * play, saved with the game — not the day clock: the day length is a player setting,
 * and weather that ran two and a half times slower on a one-hour day would be a
 * different game. `dt` is the render frame's own delta. (`atX`, `atZ`) is the
 * listener, absolute world metres: where `windMps` is sampled.
 *
 * The schedule is already smooth; the only smoothing applied here is a short lag that
 * turns a clock JUMP (a dev time change, a load) into a quick fade instead of a cut.
 */
export function updateWeather(
  seed: number,
  clockS: number,
  dt: number,
  atX: number,
  atZ: number,
): WeatherFrame {
  const jumped = Number.isFinite(lastClock) && Math.abs(clockS - lastClock) > 30;
  lastClock = clockS;

  let kind: WeatherKind;
  let progress: number;
  let slot: number;
  if (override !== null) {
    const p = override.hold ?? (clockS - override.start) / override.length;
    kind = override.kind;
    progress = Math.min(1, Math.max(0, p));
    sampleEpisode(kind, p, target);
    slot = Math.floor(override.start / WEATHER_SLOT_S);
    if (override.hold === null && p >= 1) override = null;
  } else {
    const at = weatherAt(seed, clockS, target);
    kind = at.kind;
    progress = at.progress;
    slot = at.slot;
  }

  const k = !initialised ? 1 : jumped ? Math.min(1, dt / 3) : Math.min(1, dt / 0.6);
  initialised = true;
  for (const c of CHANNELS) weather[c] += (target[c] - weather[c]) * k;
  weather.kind = kind;
  weather.progress = progress;
  weather.frontM =
    kind === 'haboob' && progress < HABOOB_ARRIVAL && weather.front > 0.005
      ? FRONT_FAR_M * (1 - weather.front)
      : -1;

  // Wind: the slot's bearing, wandering a little, and the gust pattern carried along it.
  const bearing = slotWindAngle(seed, slot);
  const angle = bearing + (clockNoise(seed, TAG_WIND, clockS / 40) - 0.5) * 0.5;
  weather.windX = Math.cos(angle);
  weather.windZ = Math.sin(angle);
  weather.windMeanMps = WIND_MAX_MPS * weather.wind;
  weather.gustIntensity =
    GUST_INTENSITY_OPEN + GUST_INTENSITY_STORM * Math.max(weather.front, weather.dust, weather.cloud);
  gust.seed = Math.floor(hash01(seed, TAG_GUST, slot) * 4294967296) | 0;
  gust.axisX = Math.cos(bearing);
  gust.axisZ = Math.sin(bearing);
  gust.advectM = WIND_MAX_MPS * EPISODE_PEAK_WIND[kind] * clockS;
  weather.windMps = windAt(atX, atZ, listenerWind);

  weather.airOffsetC =
    7 * weather.heat + 2 * weather.haze - 4 * weather.dust
    - 9 * Math.max(weather.rain, weather.wet * 0.6) - 2 * weather.cloud;

  updateLightning(seed, clockS);
  return weather;
}

const listenerWind = { x: 0, z: 0 };

/**
 * The wind at an absolute world point (x, z) this frame, gusts included: written to
 * `out` as a velocity, m/s, the direction it blows TOWARD; returns its speed. The mean
 * is the frame's (`windMeanMps` along `windX`/`windZ`); the gusts are the pattern
 * described at GUST_INTENSITY_OPEN, as it stands at the clock `updateWeather` was last
 * given. Pure in the frame, and allocates nothing: every vehicle asks once a step.
 */
export function windAt(x: number, z: number, out: { x: number; z: number }): number {
  const mean = weather.windMeanMps;
  let along = mean;
  let across = 0;
  const sigma = weather.gustIntensity * mean;
  if (sigma > 0) {
    const a = x * gust.axisX + z * gust.axisZ - gust.advectM;
    const c = z * gust.axisX - x * gust.axisZ;
    along += sigma * gustNoise(gust.seed, a, c);
    across = sigma * GUST_LATERAL * gustNoise(gust.seed ^ TAG_GUST_ACROSS, a, c);
    // A lull, never a reversal: the gusts ride on the mean wind.
    if (along < 0) along = 0;
  }
  out.x = weather.windX * along - weather.windZ * across;
  out.z = weather.windZ * along + weather.windX * across;
  return Math.hypot(out.x, out.z);
}

/**
 * Lightning. The clock is cut into one-second cells and each cell may hold one stroke,
 * with a chance that follows the rain; a stroke is two or three return strokes inside
 * a third of a second, the way a real flash flickers. Deterministic like everything
 * else here, so the sky, the light and the thunder agree.
 */
function updateLightning(seed: number, clockS: number): void {
  const storm = Math.max(0, weather.rain - 0.2) / 0.8 * Math.min(1, weather.cloud * 1.2);
  let flash = 0;
  let newest = Infinity;
  const cell = Math.floor(clockS);
  // Eight cells back: long enough for the thunder of the last stroke to have arrived.
  for (let c = cell - 8; c <= cell; c++) {
    if (hash01(seed, TAG_BOLT, c) > storm * 0.16) continue;
    const age = clockS - (c + hash01(seed, TAG_BOLT ^ 1, c) * 0.7);
    if (age < 0) continue;
    if (age < newest) {
      newest = age;
      weather.boltAzimuth = hash01(seed, TAG_BOLT ^ 2, c) * Math.PI * 2;
      weather.boltDistance = 900 + 5000 * hash01(seed, TAG_BOLT ^ 3, c) ** 1.5;
      weather.boltSeed = hash01(seed, TAG_BOLT ^ 4, c);
    }
    // Return strokes: a main flash and one or two re-strikes down the same channel.
    const strokes = 2 + (hash01(seed, TAG_BOLT ^ 5, c) < 0.5 ? 1 : 0);
    for (let s = 0; s < strokes; s++) {
      const t = age - s * 0.09;
      if (t >= 0) flash = Math.max(flash, Math.exp(-t * 16) * (s === 0 ? 1 : 0.7));
    }
  }
  weather.flash = flash;
  weather.boltAge = newest === Infinity ? 99 : newest;
}

// ---------------------------------------------------------------------------
// What the weather asks of a tyre
// ---------------------------------------------------------------------------

/**
 * Grip multiplier for a surface under the current weather.
 *
 * Wet asphalt keeps 84% of its dry grip: the first rain on a desert road lifts a film
 * of dust and oil and is slicker than a road rained on all week, and that is the
 * number worth respecting — enough to notice under braking, never enough to spin a car
 * that is driven sensibly. Blown sand on the asphalt takes a few percent more. Wet
 * sand goes the other way: water binds the grains, and a damp dune is the best
 * footing the desert ever offers.
 */
export function weatherGrip(surface: SurfaceType): number {
  const wet = weather.wet;
  switch (surface) {
    case SurfaceType.Asphalt:
    case SurfaceType.CrackedAsphalt:
    case SurfaceType.Concrete:
      return (1 - 0.16 * wet) * (1 - 0.05 * weather.drift);
    case SurfaceType.Rock:
      return 1 - 0.12 * wet;
    case SurfaceType.Sand:
      return 1 + 0.06 * wet;
    default:
      return 1 - 0.04 * wet;
  }
}

/** Multiplier on a soft surface's sinkage drag: damp sand carries a wheel. */
export function weatherSoftness(surface: SurfaceType): number {
  return surface === SurfaceType.Sand ? 1 - 0.35 * weather.wet : 1;
}
