import { hash01, Noise1D } from '../core/rng';
import { SurfaceType } from '../core/surfaces';
import { ROAD_LENGTH } from './road';

/**
 * Distance is the only axis of progression in this game, so every property that
 * should change over a long drive is a function of arclength and lives here.
 *
 * Nothing else may hardcode a distance threshold. Road decay, pole design eras,
 * sky drift and monument placement all read from this module, which means the whole
 * feel of "km 900 is not km 9" can be retuned in one file.
 */

/** Fraction of the full road travelled, 0..1. The natural input to every gradient. */
export function progress(s: number): number {
  return Math.min(1, Math.max(0, s / ROAD_LENGTH));
}

// ---------------------------------------------------------------------------
// Road decay
// ---------------------------------------------------------------------------

export interface RoadCondition {
  /** Dominant surface of the driving lanes at this distance. */
  readonly surface: SurfaceType;
  /** 0 = pristine, 1 = the desert has almost taken it. Drives cracks and patches. */
  readonly decay: number;
  /** Fraction of the lane width buried under drifted sand, 0..1. */
  readonly sandCover: number;
  /** Whether painted lane markings are still visible. */
  readonly markings: number;
}

/** Distance over which local decay varies, so decay is patchy rather than uniform. */
const DECAY_PATCH_WAVELENGTH = 900;

const decayNoise = new Noise1D(0x51ed270b);

/**
 * Road condition at a distance.
 *
 * Decay rises monotonically with progress but is modulated by patch noise, so a
 * good stretch can appear late and a ruined one early. Without that modulation the
 * gradient reads as a difficulty setting rather than as a place.
 */
export function roadConditionAt(s: number): RoadCondition {
  const p = progress(s);
  // Squared so the first few kilometres stay convincingly maintained.
  const base = p * p * 1.35;
  const patch = decayNoise.fbm(s / DECAY_PATCH_WAVELENGTH, 3, 2.1, 0.45) * 0.28;
  const decay = Math.min(1, Math.max(0, base + patch));

  let surface: SurfaceType;
  if (decay < 0.22) surface = SurfaceType.Asphalt;
  else if (decay < 0.62) surface = SurfaceType.CrackedAsphalt;
  else surface = SurfaceType.Gravel;

  return {
    surface,
    decay,
    // Sand only starts drifting across the lanes once the surface is breaking up.
    sandCover: Math.min(0.85, Math.max(0, (decay - 0.45) * 1.6)),
    markings: Math.max(0, 1 - decay * 1.9),
  };
}

// ---------------------------------------------------------------------------
// Roadside pole eras
// ---------------------------------------------------------------------------

/**
 * Poles come in design generations. Crossing between eras is the clearest possible
 * signal that you have travelled somewhere genuinely different, because the
 * silhouette on the horizon changes.
 */
export type PoleEra = 'timber' | 'lattice' | 'concrete' | 'none';

export interface PoleCondition {
  readonly era: PoleEra;
  /** Metres between poles. Later eras space them further apart. */
  readonly spacing: number;
  /** 0 = upright and intact, 1 = collapsed. */
  readonly dilapidation: number;
  /** Probability a given pole still carries its wire span. */
  readonly wireChance: number;
  /** Probability a given lamp still works after dark. */
  readonly lampChance: number;
}

/**
 * Era boundaries as fractions of the road. The gap before `concrete` is deliberate:
 * a long stretch with no poles at all, so their return is startling.
 */
const ERA_BOUNDS: readonly { until: number; era: PoleEra; spacing: number }[] = [
  { until: 0.14, era: 'timber', spacing: 44 },
  { until: 0.38, era: 'lattice', spacing: 62 },
  { until: 0.52, era: 'none', spacing: 0 },
  { until: 0.86, era: 'concrete', spacing: 85 },
  { until: 1.0, era: 'none', spacing: 0 },
];

export function poleConditionAt(s: number): PoleCondition {
  const p = progress(s);
  const bound = ERA_BOUNDS.find((b) => p <= b.until) ?? ERA_BOUNDS[ERA_BOUNDS.length - 1]!;

  if (bound.era === 'none') {
    return { era: 'none', spacing: 0, dilapidation: 1, wireChance: 0, lampChance: 0 };
  }

  // Dilapidation resets at each era boundary: a new era means newer infrastructure.
  const start = ERA_BOUNDS[ERA_BOUNDS.indexOf(bound) - 1]?.until ?? 0;
  const within = (p - start) / Math.max(1e-6, bound.until - start);

  return {
    era: bound.era,
    spacing: bound.spacing,
    dilapidation: Math.min(1, within * 1.15),
    wireChance: Math.max(0, 1 - within * 1.3),
    // Lamps die well before the poles fall over.
    lampChance: Math.max(0, 1 - within * 2.2),
  };
}

// ---------------------------------------------------------------------------
// Sky drift
// ---------------------------------------------------------------------------

export interface SkyGradient {
  /** Atmospheric dust load, 0..1. Reddens and lengthens sunsets. */
  readonly dust: number;
  /** Multiplier on visible star count. Rises with distance from anywhere. */
  readonly starDensity: number;
  /** Visibility of the galactic band, 0..1. */
  readonly galaxy: number;
  /** Aurora intensity, 0..1. Has no business over a desert, which is the point. */
  readonly aurora: number;
  /** Daytime sky tint, shifting slowly away from familiar blue. */
  readonly skyHueShift: number;
  /** Fog density multiplier, so distance haze thickens with dust. */
  readonly haze: number;
}

/** Progress at which the aurora begins to appear at all. */
const AURORA_ONSET = 0.55;

export function skyGradientAt(s: number): SkyGradient {
  const p = progress(s);
  return {
    // Dust climbs steadily; this is the workhorse of the whole visual drift.
    dust: Math.min(1, p * 1.25),
    starDensity: 1 + p * 3.5,
    galaxy: Math.min(1, Math.max(0, (p - 0.18) * 1.8)),
    aurora: Math.min(1, Math.max(0, (p - AURORA_ONSET) / (1 - AURORA_ONSET)) ** 1.6),
    // Small in absolute terms: a hue you notice only by remembering the start.
    skyHueShift: p * 0.14,
    haze: 1 + p * 2.2,
  };
}

// ---------------------------------------------------------------------------
// Monuments
// ---------------------------------------------------------------------------

export type MonumentKind =
  | 'distance_sign'
  | 'ornament_shrine'
  | 'cairn'
  | 'wrecked_marker';

export interface Monument {
  /** Arclength of the monument. */
  readonly s: number;
  /** Lateral offset from the centreline; negative is left of travel. */
  readonly lateral: number;
  readonly kind: MonumentKind;
  /** Deterministic per-monument variation seed. */
  readonly variantSeed: number;
  /** Text for signs. Empty for other kinds. */
  readonly text: string;
}

/** Monuments appear on this cadence, in metres. */
const MONUMENT_INTERVAL = 20_000;

/**
 * Monuments at fixed round distances, so their spacing is legible: passing one
 * means a specific number of kilometres, not an arbitrary landmark.
 *
 * Pure in (seed, fromS, toS): no game state reaches this. A personal-record
 * marker used to be grafted on here from `recordS`, which put a monument to the
 * player exactly where a resumed save left off. Distance travelled is now
 * recorded on the car itself, in stickers earned by hauling.
 */
export function monumentsBetween(seed: number, fromS: number, toS: number): Monument[] {
  const result: Monument[] = [];
  const firstIndex = Math.ceil(fromS / MONUMENT_INTERVAL);
  const lastIndex = Math.floor(toS / MONUMENT_INTERVAL);

  for (let i = firstIndex; i <= lastIndex; i++) {
    const s = i * MONUMENT_INTERVAL;
    if (s <= 0 || s > ROAD_LENGTH) continue;
    // 0x4d4f4e55 is 'MONU': a domain tag keeping this hash stream distinct from others.
    const roll = hash01(seed, 0x4d4f4e55, i);
    const km = Math.round(s / 1000);

    // Signs dominate early; shrines and cairns take over as the road ages.
    let kind: MonumentKind;
    if (roll < 0.45) kind = 'distance_sign';
    else if (roll < 0.7) kind = 'cairn';
    else if (roll < 0.9) kind = 'ornament_shrine';
    else kind = 'wrecked_marker';

    result.push({
      s,
      // Alternate sides so the road does not develop a lopsided rhythm.
      lateral: (i % 2 === 0 ? 1 : -1) * (6.5 + hash01(seed, i, 7) * 2.5),
      kind,
      variantSeed: (seed ^ (i * 0x9e3779b9)) >>> 0,
      text: kind === 'distance_sign' ? `${km} km` : '',
    });
  }

  return result;
}
