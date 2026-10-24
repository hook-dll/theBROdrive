/**
 * THE DESERT'S REGIONS: the ring of deserts the drive crosses, and what each one is
 * besides a colour.
 *
 * The ring used to be colour only, and everything else in the desert rolled its own
 * independent dice: mesas on a world lattice, houses uniformly from the whole
 * catalogue, cacti at one density everywhere, road characters from one deck. Every ten
 * kilometres were therefore a fair sample of everything at once, and no stretch was a
 * PLACE — an izba stood beside a trulli beside a pueblo under the same mesa count in
 * every desert of the ring. A region here is what makes a stretch belong together: its
 * sign emblem decides how the land is furnished (`RegionProfile`), and its culture
 * which houses its people build (`CULTURES`).
 *
 * ONLY WEIGHTS, NEVER CONTENT. Nothing below adds a form, a house or a road; it biases
 * the draws the existing systems already make. And the densities are NORMALISED over
 * the ring (see `normalise`): a region has more mesas only because another has fewer,
 * so the desert as a whole keeps the scarcity the owner asked for and only its
 * distribution changes.
 *
 * A pure module of plain data and arithmetic. The road character draw, the spine
 * worker, the tile and vista workers and the terrain all read it, so it imports
 * nothing from the world.
 */

/**
 * Period of the desert colour cycle, metres.
 *
 * A driver who covers this distance has seen the whole palette and begins again. The
 * cyclic sky channels (dust, haze, sky tint) share this period so they move with the
 * colour; the remoteness channels deliberately do not.
 *
 * It was 4 000 km, which is the one figure in this file that nobody could ever have
 * reached: it meant a 2 500 km drive saw five eighths of the palette and never the
 * rest. Then 2 000 km, one full turn inside a drive of that length. It is 1 000 km
 * now, with twice as many deserts on the ring: a long drive goes round it more than
 * twice, and a desert still holds pure for 16-25 km, ten to fifteen minutes at road
 * speed, so consecutive stretches look like the same country rather than a slideshow.
 */
export const PALETTE_CYCLE_M = 1_000_000;

/**
 * What a region's signposts paint as its emblem, the way a state's licence plate shows
 * something of the state (world/signplates.ts draws each). It is also the region's
 * LAND: `PROFILES` reads it.
 */
export type DesertEmblem = 'mesa' | 'dunes' | 'sun' | 'powerline' | 'cactus' | 'palm' | 'moon' | 'volcano';

/** Whose houses stand in a region: see `CULTURES`. */
export type Culture =
  | 'frontier'
  | 'mexico'
  | 'sahara'
  | 'veld'
  | 'mediterranean'
  | 'north'
  | 'soviet'
  | 'asia'
  | 'modern';

/**
 * One desert on the cycle: its sand, its second sand (see `DesertPalette.accent`), how
 * long it holds pure, and how long it takes to become the next one.
 *
 * THE CYCLE IS A RING OF DESERTS, NOT A HUE SWEEP. It used to walk the hue once round
 * the wheel at pastel saturation, and measured in OKLab that spent 400-1 000 km at a
 * chroma of 2-3 — grey — moving under 1.5 ΔE per 100 km: six hundred kilometres of one
 * grey-mint that nobody could tell apart. Real deserts are not evenly spaced round a
 * colour wheel, so these are authored, and ordered so neighbours blend through
 * something plausible: rust darkens into black glass, black glass weathers to basalt
 * grey, basalt grey pales into regolith.
 *
 * The first entry is the sand the drive opens on, `#d29459`, and it is exact. A pastel
 * or desaturated opening was tried twice and read as bleached grey-beige; the eye
 * forgives a saturated warm ground and not a saturated cool one, which is why the
 * strange hues further round are the pale ones.
 *
 * Kilometres are relative weights: they are scaled together to fill PALETTE_CYCLE_M,
 * and they sum to exactly 1 000 so they read as kilometres of the cycle.
 * A BLEND IS SIZED TO ITS DISTANCE. tools/road-condition.ts holds every channel to
 * one 8-bit step per 200 m chunk, and smootherstep's peak slope is 1.875 times the
 * mean, so a blend across `d` channel levels needs at least 0.375·d km; the accent is
 * held to the same step. The long ones below are the big jumps into and out of the
 * black and across the pale-to-saturated edges of the cool deserts.
 */
export interface Desert {
  readonly sand: number;
  readonly accent: number;
  readonly holdKm: number;
  readonly blendKm: number;
  /** The region's name, as its signposts' header strip spells it. */
  readonly name: string;
  /** The region's sign emblem and its land. Never the same as a neighbour's on the ring. */
  readonly emblem: DesertEmblem;
  /**
   * Whose houses stand here. Neighbours may share one: two deserts of the same people
   * are one country of 70-90 km with a change of sand inside it.
   */
  readonly culture: Culture;
}

export const DESERTS: readonly Desert[] = [
  // The opening ochre. Accent: sunlit crests.
  { sand: 0xd29459, accent: 0xdfaa70, holdKm: 25, blendKm: 19, name: 'Ochre Country', emblem: 'mesa', culture: 'frontier' },
  // Golden erg — the Sahara of postcards. Accent: the shadowed troughs between dunes.
  { sand: 0xd9ad6b, accent: 0xc9975a, holdKm: 18, blendKm: 21, name: 'Golden Erg', emblem: 'dunes', culture: 'sahara' },
  // Saffron dunes, a paler butter-gold. Accent: cream wind-sorted crests.
  { sand: 0xdcbb7e, accent: 0xe2cc98, holdKm: 18, blendKm: 15, name: 'Saffron Dunes', emblem: 'sun', culture: 'sahara' },
  // Gypsum flats. Accent: fresh white crust.
  { sand: 0xd4c9ad, accent: 0xe6dfcb, holdKm: 20, blendKm: 11, name: 'Gypsum Flats', emblem: 'powerline', culture: 'modern' },
  // Peach-blush sand. Accent: pale shell-pink crust.
  { sand: 0xdcae96, accent: 0xe8c6b2, holdKm: 18, blendKm: 11, name: 'Peach Sands', emblem: 'cactus', culture: 'mexico' },
  // Coral-pink dunes. Accent: paler wind-sorted crests.
  { sand: 0xd6937a, accent: 0xe3ae98, holdKm: 18, blendKm: 17, name: 'Coral Dunes', emblem: 'dunes', culture: 'mediterranean' },
  // Apricot erg. Accent: lighter sunlit ripples.
  { sand: 0xcc7a52, accent: 0xdc9670, holdKm: 18, blendKm: 26, name: 'Apricot Erg', emblem: 'palm', culture: 'veld' },
  // Namib / Wadi Rum red. Accent: darker iron-rich streaks.
  { sand: 0xc0673f, accent: 0xa85534, holdKm: 20, blendKm: 21, name: 'Red Wadi', emblem: 'mesa', culture: 'sahara' },
  // Madder-rose canyon floor. Accent: a softer pink dust.
  { sand: 0xb06450, accent: 0xc47c66, holdKm: 18, blendKm: 14, name: 'Madder Canyon', emblem: 'cactus', culture: 'frontier' },
  // Mars: rust plains under a butterscotch dust. Accent: that dust, drifted.
  { sand: 0x9e4d2e, accent: 0xbf7a52, holdKm: 25, blendKm: 24, name: 'Rust Plains', emblem: 'moon', culture: 'modern' },
  // Plum cinder, the oxidised rim of the lava field. Accent: rosier scoria.
  { sand: 0x683c3e, accent: 0x86524c, holdKm: 18, blendKm: 22, name: 'Plum Cinders', emblem: 'dunes', culture: 'asia' },
  // Black lava — cooled magma, glassy and faintly violet. Accent: grey ash drifts.
  { sand: 0x34313a, accent: 0x57514f, holdKm: 25, blendKm: 19, name: 'Black Lava', emblem: 'volcano', culture: 'north' },
  // Indigo slate tuff. Accent: paler blue-grey ash.
  { sand: 0x4a4a5e, accent: 0x63637a, holdKm: 18, blendKm: 17, name: 'Indigo Tuff', emblem: 'mesa', culture: 'north' },
  // Weathered basalt. Accent: darker gravel pans.
  { sand: 0x6c6762, accent: 0x5a5551, holdKm: 16, blendKm: 17, name: 'Basalt Reach', emblem: 'powerline', culture: 'soviet' },
  // Lilac pumice. Accent: darker vesicled grit.
  { sand: 0x857d88, accent: 0x746c78, holdKm: 18, blendKm: 9, name: 'Lilac Pumice', emblem: 'sun', culture: 'asia' },
  // The Moon: regolith, a faintly warm grey — a neutral one read as snow under the
  // blue sky fill. Accent: dark mare dust.
  { sand: 0x969088, accent: 0x77726b, holdKm: 25, blendKm: 13, name: 'Moon Country', emblem: 'moon', culture: 'modern' },
  // Lichen sage. Accent: darker crusted soil.
  { sand: 0x9fa286, accent: 0x8a8d70, holdKm: 18, blendKm: 16, name: 'Sage Flats', emblem: 'cactus', culture: 'soviet' },
  // Olivine sand. Accent: darker, greener grains.
  { sand: 0x9b9760, accent: 0x868550, holdKm: 18, blendKm: 16, name: 'Olivine Sands', emblem: 'dunes', culture: 'asia' },
  // Pistachio flats. Accent: deeper green grit.
  { sand: 0xa9b77e, accent: 0x96a468, holdKm: 18, blendKm: 28, name: 'Pistachio Flats', emblem: 'powerline', culture: 'soviet' },
  // The strange ones out on the cycle: mint...
  { sand: 0x9dba9f, accent: 0xb5ccb3, holdKm: 18, blendKm: 11, name: 'Mint Desert', emblem: 'cactus', culture: 'mediterranean' },
  // ...seafoam...
  { sand: 0x8fb8b4, accent: 0xa9cbc6, holdKm: 18, blendKm: 13, name: 'Seafoam Sands', emblem: 'palm', culture: 'mediterranean' },
  // ...pale sky...
  { sand: 0xa0b5c9, accent: 0xbccad8, holdKm: 18, blendKm: 9, name: 'Pale Sky Pan', emblem: 'sun', culture: 'modern' },
  // ...periwinkle...
  { sand: 0xa5a8d0, accent: 0xbcbedd, holdKm: 18, blendKm: 11, name: 'Periwinkle', emblem: 'moon', culture: 'asia' },
  // ...lavender...
  { sand: 0xb3a0c8, accent: 0xc8b9d8, holdKm: 18, blendKm: 9, name: 'Lavender Wastes', emblem: 'mesa', culture: 'mexico' },
  // ...orchid...
  { sand: 0xc49cbd, accent: 0xd5b4cf, holdKm: 18, blendKm: 23, name: 'Orchid Basin', emblem: 'palm', culture: 'veld' },
  // ...dusty rose...
  { sand: 0xcf9a9c, accent: 0xcf9e98, holdKm: 18, blendKm: 24, name: 'Dusty Rose', emblem: 'dunes', culture: 'mediterranean' },
  // ...rose brick...
  { sand: 0xc98170, accent: 0xb66a5a, holdKm: 18, blendKm: 23, name: 'Rose Brick', emblem: 'cactus', culture: 'mexico' },
  // ...and salmon apricot, which closes the ring back onto the ochre.
  { sand: 0xd08a62, accent: 0xdea27c, holdKm: 18, blendKm: 7, name: 'Salmon Reach', emblem: 'sun', culture: 'frontier' },
];

const DESERT_KM = DESERTS.reduce((sum, d) => sum + d.holdKm + d.blendKm, 0);
/** Each desert's hold end and blend end, in metres of the cycle. */
const DESERT_SPANS = (() => {
  const scale = PALETTE_CYCLE_M / DESERT_KM;
  const spans: { holdEnd: number; end: number }[] = [];
  let at = 0;
  for (const d of DESERTS) {
    const holdEnd = at + d.holdKm * scale;
    at = holdEnd + d.blendKm * scale;
    spans.push({ holdEnd, end: at });
  }
  return spans;
})();

/** Quintic smoothstep of an already-normalised 0..1: zero slope AND curvature at both ends. */
function smootherstep01(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Where on the ring a distance is: see `desertSpanAt`. */
export interface DesertSpan {
  /** Index into `DESERTS` of the desert held here, or the one a blend leaves. */
  from: number;
  /** The next desert on the ring. */
  to: number;
  /** How far the blend has gone, 0 (all `from`) to 1 (all `to`), smootherstepped. */
  w: number;
}

/**
 * The ring at a distance: which desert, which next, and how far between. Pure, C2 in
 * `s` (the blend weight is a quintic with zero slope at both knots), exact period
 * `PALETTE_CYCLE_M`. The colour and the land read the same weight, so a region's
 * mesas and cacti thin exactly as its sand changes.
 */
export function desertSpanAt(s: number, out: DesertSpan): DesertSpan {
  const cycle = s - Math.floor(s / PALETTE_CYCLE_M) * PALETTE_CYCLE_M;
  let i = 0;
  while (i < DESERT_SPANS.length - 1 && cycle >= DESERT_SPANS[i]!.end) i++;
  const span = DESERT_SPANS[i]!;
  out.from = i;
  out.to = (i + 1) % DESERTS.length;
  out.w = cycle <= span.holdEnd
    ? 0
    : smootherstep01(Math.min(1, (cycle - span.holdEnd) / (span.end - span.holdEnd)));
  return out;
}

const spanScratch: DesertSpan = { from: 0, to: 0, w: 0 };

/**
 * The desert a stretch of road belongs to: the one held there, or across a blend the
 * nearer of its two (the first half is still the old one's, the second already the
 * next one's). A whole region therefore answers the same, which is what its signposts
 * and its houses want; the ground itself reads the continuous blend.
 */
export function desertAt(s: number): Desert {
  desertSpanAt(s, spanScratch);
  return DESERTS[spanScratch.w > 0.5 ? spanScratch.to : spanScratch.from]!;
}

// ---------------------------------------------------------------------------
// The land of a region
// ---------------------------------------------------------------------------

/** The scatter's sand and rock forms (world/props/forms.ts), by id. */
export const REGION_FORM_IDS = [
  'saguaro',
  'barrel',
  'deadstick',
  'trunk',
  'scrub',
  'dragontree',
  'baobab',
  'boulder',
  'boulderlow',
  'bouldertall',
  'slab',
] as const;
export type RegionFormId = (typeof REGION_FORM_IDS)[number];

/** The road characters (world/roadcharacter.ts), by name. */
export const REGION_ROAD_KINDS = ['pan', 'highway', 'rolling', 'switchback', 'esses', 'derelict'] as const;
export type RegionRoadKind = (typeof REGION_ROAD_KINDS)[number];

/**
 * How a region furnishes its land. Every number is a MULTIPLIER on what the system
 * already does; 1 is the desert as it was. The four densities and the road kinds are
 * normalised over the ring afterwards, so these are proportions between regions, not
 * absolute amounts.
 */
export interface RegionProfile {
  /** Mesa occupancy of the world lattice (world/mesas.ts). */
  readonly mesas: number;
  /** Sand forms — cacti, scrub, dead wood — per cell (scatter, tile props). */
  readonly flora: number;
  /** Rock forms per cell on rock ground. */
  readonly rocks: number;
  /**
   * Lone houses in the gaps between settlements and buildings out in the desert: the
   * rhythm of a region, empty or lived in. Settlements are the post network and keep
   * their spacing.
   */
  readonly houses: number;
  /** Relay masts among the desert's buildings. */
  readonly masts: number;
  /** Per-form weight; a form not named keeps its own. */
  readonly forms: Readonly<Partial<Record<RegionFormId, number>>>;
  /** Per road character weight; a kind not named keeps its own. */
  readonly roads: Readonly<Partial<Record<RegionRoadKind, number>>>;
}

/**
 * The eight lands. Each is meant to be told apart from a car window inside a minute,
 * by three things at once — what rises on the horizon, what grows by the road, how
 * often anyone lives here — rather than by one.
 */
const PROFILES: Readonly<Record<DesertEmblem, RegionProfile>> = {
  // Table country: the mesas crowd in, saguaro stands among them, the road rolls.
  mesa: {
    mesas: 2.6, flora: 1.0, rocks: 1.3, houses: 1.0, masts: 0.6,
    forms: { saguaro: 1.8, barrel: 1.2, deadstick: 0.6, scrub: 0.8, bouldertall: 1.6 },
    roads: { rolling: 1.6, esses: 1.3, highway: 0.7, pan: 0.5 },
  },
  // The erg: open sand to the horizon, hardly a rock, scrub and dead wood, few people.
  dunes: {
    mesas: 0.15, flora: 0.5, rocks: 0.35, houses: 0.6, masts: 0.5,
    forms: { saguaro: 0.15, barrel: 0.4, deadstick: 1.8, trunk: 1.3, scrub: 1.7 },
    roads: { rolling: 1.4, derelict: 1.8, switchback: 0.3, highway: 0.7 },
  },
  // The pan: flat light, scrub, long straight road.
  sun: {
    mesas: 0.5, flora: 0.65, rocks: 0.7, houses: 0.8, masts: 0.8,
    forms: { saguaro: 0.4, scrub: 2.0, deadstick: 1.4, boulderlow: 1.6, slab: 1.4 },
    roads: { pan: 1.7, highway: 1.4, switchback: 0.3, esses: 0.6 },
  },
  // Infrastructure country: the highway, the masts, people along the line.
  powerline: {
    mesas: 0.5, flora: 0.8, rocks: 0.8, houses: 1.7, masts: 4.0,
    forms: { barrel: 1.3, scrub: 1.2 },
    roads: { highway: 2.2, pan: 1.2, derelict: 0.3, switchback: 0.4 },
  },
  // Cactus forest.
  cactus: {
    mesas: 0.8, flora: 2.2, rocks: 0.9, houses: 1.1, masts: 0.8,
    forms: { saguaro: 2.4, barrel: 2.0, deadstick: 0.5, scrub: 0.7, trunk: 0.6 },
    roads: { rolling: 1.4, esses: 1.2 },
  },
  // The strange trees: dragon trees and baobabs come out of hiding.
  palm: {
    mesas: 0.5, flora: 1.3, rocks: 0.7, houses: 1.2, masts: 0.6,
    forms: { dragontree: 6.0, baobab: 7.0, saguaro: 0.25, trunk: 1.2 },
    roads: { esses: 1.6, rolling: 1.2, highway: 0.7 },
  },
  // Emptiness: scattered rock, nothing alive, almost nobody, a ruined road.
  moon: {
    mesas: 1.0, flora: 0.12, rocks: 1.7, houses: 0.35, masts: 0.4,
    forms: { saguaro: 0.0, barrel: 0.2, scrub: 0.5, deadstick: 2.0, boulder: 1.4, boulderlow: 1.4 },
    roads: { derelict: 1.8, pan: 1.0, highway: 0.5, switchback: 0.6 },
  },
  // Lava country: tall broken rock and slabs, dead wood, a mountain road.
  volcano: {
    mesas: 1.4, flora: 0.25, rocks: 2.3, houses: 0.5, masts: 0.5,
    forms: { saguaro: 0.0, barrel: 0.3, deadstick: 2.5, trunk: 1.6, bouldertall: 2.2, slab: 1.8 },
    roads: { switchback: 3.0, esses: 1.4, pan: 0.3, highway: 0.6 },
  },
};

type Density = 'mesas' | 'flora' | 'rocks' | 'houses' | 'masts';
const DENSITIES: readonly Density[] = ['mesas', 'flora', 'rocks', 'houses', 'masts'];

/** Ring share of each desert: its hold plus its blend, as the palette spends it. */
const RING_SHARE = DESERTS.map((d) => (d.holdKm + d.blendKm) / DESERT_KM);

/**
 * THE RING KEEPS ITS TOTALS. Each density is divided by its distance-weighted mean
 * over the ring, so a full turn of the ring meets exactly as many mesas, cacti, rocks
 * and houses as the desert had before regions: the owner asked for the desert to be
 * scarce (desert_expansion.md), and regions only redistribute that scarcity.
 */
function ringMean(value: (p: RegionProfile) => number): number {
  let sum = 0;
  for (let i = 0; i < DESERTS.length; i++) sum += RING_SHARE[i]! * value(PROFILES[DESERTS[i]!.emblem]);
  return sum;
}
const DENSITY_MEAN: Readonly<Record<Density, number>> = Object.fromEntries(
  DENSITIES.map((k) => [k, ringMean((p) => p[k])]),
) as Record<Density, number>;

/**
 * Each desert's road kind weights, calibrated so the whole ring keeps `base`'s shares.
 *
 * Dividing each kind's bias by its ring mean does NOT do that, because a draw is
 * normalised per region: where the volcano triples the switchbacks, every other kind's
 * share in it falls, and the measured pan share of the road rose from 13% to 16% — the
 * pan the owner cut to a tenth of the road (CHANGELOG, road characters). So the table
 * is matrix-scaled (Sinkhorn): alternately each kind's column is rescaled until the
 * distance-weighted mean of every region's draw probability is the kind's share of
 * `base`. The result is each desert's probability per kind; a draw blends two of them
 * across a boundary (`roadWeightsAt`).
 */
export function calibrateRoadWeights(base: Readonly<Record<RegionRoadKind, number>>): Float64Array[] {
  const kinds = REGION_ROAD_KINDS;
  const baseTotal = kinds.reduce((sum, k) => sum + base[k], 0);
  const target = kinds.map((k) => base[k] / baseTotal);
  const column = kinds.map(() => 1);
  const table = DESERTS.map(() => new Float64Array(kinds.length));
  const fill = (): void => {
    for (let d = 0; d < DESERTS.length; d++) {
      const roads = PROFILES[DESERTS[d]!.emblem].roads;
      let total = 0;
      for (let j = 0; j < kinds.length; j++) {
        const w = base[kinds[j]!] * (roads[kinds[j]!] ?? 1) * column[j]!;
        table[d]![j] = w;
        total += w;
      }
      for (let j = 0; j < kinds.length; j++) table[d]![j]! /= total;
    }
  };
  for (let iteration = 0; iteration < 200; iteration++) {
    fill();
    for (let j = 0; j < kinds.length; j++) {
      let mean = 0;
      for (let d = 0; d < DESERTS.length; d++) mean += RING_SHARE[d]! * table[d]![j]!;
      column[j]! *= target[j]! / mean;
    }
  }
  fill();
  return table;
}

/**
 * The calibrated kind weights at arclength `s` (`calibrateRoadWeights`'s table),
 * blended across a boundary like the land, written into `out` in `REGION_ROAD_KINDS`
 * order.
 */
export function roadWeightsAt(s: number, table: readonly Float64Array[], out: Float64Array): Float64Array {
  desertSpanAt(s, spanScratch);
  const a = table[spanScratch.from]!;
  const b = table[spanScratch.to]!;
  const w = spanScratch.w;
  for (let j = 0; j < out.length; j++) out[j] = a[j]! + (b[j]! - a[j]!) * w;
  return out;
}

/** A region's land at a point of the ring, blended across a boundary. Mutable: callers reuse one. */
export interface RegionMix {
  mesas: number;
  flora: number;
  rocks: number;
  houses: number;
  masts: number;
  readonly forms: Record<RegionFormId, number>;
}

export function newRegionMix(): RegionMix {
  return {
    mesas: 1,
    flora: 1,
    rocks: 1,
    houses: 1,
    masts: 1,
    forms: Object.fromEntries(REGION_FORM_IDS.map((id) => [id, 1])) as Record<RegionFormId, number>,
  };
}

/**
 * The land at arclength `s`, written into `out` and returned. Across a boundary every
 * multiplier is the same smootherstep blend of the two regions' as the sand is, so a
 * mesa field thins out over the very kilometres its sand turns to the next.
 * Allocation-free.
 */
export function regionAt(s: number, out: RegionMix): RegionMix {
  desertSpanAt(s, spanScratch);
  const a = PROFILES[DESERTS[spanScratch.from]!.emblem];
  const b = PROFILES[DESERTS[spanScratch.to]!.emblem];
  const w = spanScratch.w;
  for (const k of DENSITIES) out[k] = (a[k] + (b[k] - a[k]) * w) / DENSITY_MEAN[k];
  for (const id of REGION_FORM_IDS) {
    const fa = a.forms[id] ?? 1;
    out.forms[id] = fa + ((b.forms[id] ?? 1) - fa) * w;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The people of a region
// ---------------------------------------------------------------------------

/**
 * Each culture's houses, by dwelling id (world/dwellings/list.ts). Ruins belong to a
 * culture too: a broken izba is Russian country, a dust-bowl farm the plains. Every
 * list holds at least two lived-in houses, because a settlement is built of those.
 */
export const CULTURES: Readonly<Record<Culture, readonly string[]>> = {
  frontier: ['log-cabin', 'saltbox', 'victorian', 'victorian-ghost', 'tipi', 'dustbowl', 'quonset', 'airstream', 'trailer-wreck', 'a-frame', 'shotgun'],
  mexico: ['hacienda', 'casita', 'pueblo', 'adobe-ruin', 'maya', 'chattel'],
  sahara: ['djenne', 'nubian', 'yemen', 'windcatcher', 'lebanese'],
  veld: ['rondavel', 'ndebele', 'djenne', 'nubian', 'chattel'],
  mediterranean: ['cycladic', 'trullo', 'tbilisi', 'lebanese', 'mansard'],
  north: ['turf-house', 'blackhouse', 'falu-cottage', 'chalet', 'tudor', 'dutch-gable', 'bauhaus'],
  soviet: ['izba', 'izba-ruin', 'dacha', 'finnish-house', 'barrack', 'mazanka', 'yurt'],
  asia: ['minka', 'chinese', 'yurt', 'thai-stilt', 'tongkonan', 'haveli'],
  modern: ['futuro', 'butterfly', 'streamline', 'airstream', 'bauhaus', 'a-frame', 'quonset'],
};

/**
 * Share of a region's buildings drawn from its own culture; the rest come from the
 * whole catalogue. Not all of them: a region where every house is its own reads as a
 * theme park, and the stranger from elsewhere is what makes the rule visible.
 */
export const CULTURE_SHARE = 0.72;

/** The culture of the region a stretch of road belongs to. */
export function cultureAt(s: number): Culture {
  return desertAt(s).culture;
}
