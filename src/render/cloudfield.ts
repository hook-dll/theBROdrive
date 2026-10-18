import { hashUnit2, hashUnit3, mulberry32 } from '../core/rng';

/**
 * THE SKY'S CUMULUS, AS A LIST OF CLOUDS: where each one stands, how high its base is,
 * and the faceted blobs it is built from. Pure CPU, a function of the drive's seed only,
 * so the sky a player saw is the sky a second visit sees. render/clouds.ts draws the
 * list as low-poly meshes and renders their shadow map; render/cloudshadow.ts lays that
 * map on the ground; this file is also the CPU twin both of them are checked against
 * (`cloudShadeAlong`, tools/sky-variety.ts).
 *
 * WHY A LIST AND NOT A FIELD. Every noise-field sky before this one (thresholded value
 * noise, then a raymarched volume over it) was rejected by the owner the same way: "all
 * one height", "still visibly a grid / a function". A thresholded field puts every cloud
 * at one level with one kind of edge, and its lattice shows through whatever warps it.
 * Here each cloud is an object with its own kind, size and base height, built the way
 * the rest of the desert is built (the mesas, the cars, the props): faceted lobes, a
 * dome of big ones crusted with small ones, cut flat at the district's condensation
 * level, stretched along the wind (`buildDome`).
 *
 * PLACEMENT. The world is cut into `CLOUD_CELL_M` cells that repeat every
 * `CLOUD_PERIOD_M` (so the field can be panned modulo the period like every other
 * world-anchored effect, render/cloudshadow.ts). A coarse "district" noise sets how
 * cloudy each stretch of sky is: about a third of the districts are clear or nearly so,
 * a few are crowded. Each cell then draws up to `CANDIDATES` clouds, strung along the
 * wind from a per-cell group centre or anywhere in the cell, so a cloudy district holds
 * a street of long rafts and a clear one nothing: no lattice survives because nothing
 * sits on one.
 *
 * THE DECKS. The cumulus stand on the low deck, on their district's condensation level;
 * over them an altocumulus deck of flat, thin rafts 4.3-5.5 km up, with its own
 * districts, so a stretch clear low down is often patched high up and the sky between
 * the horizon and the zenith has something in it. Each deck has its own wind, stronger
 * and veered aloft (`cloudDeckWind`): the decks slide across each other, which is the
 * motion the eye reads first. The low deck's wind is the field's own pan (`cloudPan`);
 * a higher deck's clouds stand `cloudDeckShift` from where they were built.
 *
 * THE WEATHER. Every candidate has a rank; a cell shows the candidates whose rank is
 * under its cover (`cloudCover`), and a storm raises the cover, so more clouds appear,
 * growing from nothing (`cloudGrow`) rather than popping in, and the ones already there
 * swell. Fair weather never changes the cover, so a fair sky changes only with the wind.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Side of one placement cell, metres. */
export const CLOUD_CELL_M = 2048;
/** Cells before the sky repeats. Every noise below is periodic on it. */
export const CLOUD_PERIOD_CELLS = 30;
/** The sky's period, metres: the pan uniform is reduced modulo this. */
export const CLOUD_PERIOD_M = CLOUD_CELL_M * CLOUD_PERIOD_CELLS;
/**
 * Blob slots per cloud: `CLOUD_BIG_SLOTS` big lobes (slots 0..5, detail-2 icospheres in the
 * mesh) that build the body, then small lobes (slots 6..17, detail 1) sunk into its upper
 * surface. A compact cloud (at most `CLOUD_COMPACT_BIG` big lobes and `CLOUD_COMPACT_SMALL`
 * small) draws from the compact mesh, which carries slots 0..3 and 6..11 only.
 */
export const CLOUD_SLOTS = 18;
export const CLOUD_BIG_SLOTS = 6;
export const CLOUD_COMPACT_BIG = 4;
export const CLOUD_COMPACT_SMALL = 6;
/** Floats per blob in `CloudSet.blobs`: centre xyz, radii xyz, cos and sin of its yaw. */
export const BLOB_FLOATS = 8;
/** The decks (`CloudSet.deck`): the low cumulus, and the altocumulus over them. */
export const CloudDeck = { Low: 0, Mid: 1 } as const;
export const CLOUD_DECKS = 2;
/**
 * Each deck's wind, m/s, and its veer from the low deck's direction, radians. A 6 m/s
 * breeze moved a cloud three kilometres out a tenth of a degree a second, which reads
 * as painted on; aloft the wind is twice the low deck's and turned, so the decks shear.
 */
const DECK_WIND_MPS = [9, 18] as const;
const DECK_VEER_RAD = [0, 0.55] as const;
/** The low deck's drift speed, m/s: the clouds and their shadows together. */
export const CLOUD_DRIFT_MPS = DECK_WIND_MPS[0];
/** Highest point any cloud reaches above the datum, metres (a swollen altocumulus). */
export const CLOUD_CEILING_M = 6_200;
/** Lowest cloud base, metres. */
export const CLOUD_FLOOR_M = 950;

/**
 * Clouds a cell may hold at the height of a storm: the fair share at the most crowded
 * district (`fairShare(2.6)`) times the storm's 2.5, plus `STORM_EXTRA`, rounded up. A
 * rank past it is never shown, so a larger number only spends the cell's stream.
 */
const CANDIDATES = 2;
/**
 * Fair-weather clouds per cell at a district cover of one, per deck. The low deck's is
 * set so the ground under a cloud averages 10-15% (tools/sky-variety.ts measures it).
 * The owner read the sky of half-kilometre puffs in groups as confetti and its short
 * tall ones as towers: clouds are rare and big (1.4 to 6 km along the wind, over a
 * kilometre across, the biggest only under a high base: `LENGTH_PER_BASE`), and the
 * cover comes from cloud size, not count. The altocumulus deck adds about as much again,
 * thin, in its own districts.
 */
const CLOUDS_PER_CELL = [0.05, 0.07] as const;
/** Ranks a storm adds to every cell, clear districts included, on top of swelling the fair share. */
const STORM_EXTRA = 0.6;
/** How far over a rank the cover must go before a cloud is full size. */
const GROW_SPAN = 0.5;

/**
 * Mean fair-weather clouds in a cell of district cover `cover` on `deck`. Square in the
 * cover: with clouds this rare a cell holds one at most unless the district is crowded,
 * and a crowded one holds a short street of two, so the sky still clumps (clear
 * stretches, then a few long rafts together) instead of sprinkling one raft per cell.
 */
function fairShare(cover: number, deck: number): number {
  return CLOUDS_PER_CELL[deck as 0 | 1] * cover * cover;
}

/**
 * The kinds (`CloudSet.kind`): on the low deck humilis (flat rafts 1.4-3 km long, about
 * a fifth as tall), mediocris (2.8-6 km, a quarter as tall) and congestus (rare, in
 * cloudy districts only: a mediocris body with one broad heap on its crown, a third as
 * tall as long, never a column); on the high deck altocumulus (1.5-4 km, a tenth or less
 * as thick).
 */
export const CloudKind = { Humilis: 0, Mediocris: 1, Congestus: 2, Altocumulus: 3 } as const;
/** How much of the sun each kind stops: thin rafts less, towers all of it, the high thin deck half. */
const CLOUD_KIND_OPACITY: readonly number[] = [0.8, 0.95, 1, 0.5];

/** Hash domains, distinct from every other system's. */
const TAG_WIND = 0x43534831; // 'CSH1' (the wind the shadows have always had)
const TAG_DISTRICT = 0x434c4431;
const TAG_DISTRICT_FINE = 0x434c4432;
const TAG_BASE = 0x434c4433;
const TAG_CELL = 0x434c4434;
const TAG_SHAPE = 0x434c4435;
const TAG_DISTRICT_MID = 0x434c4436;
const TAG_DISTRICT_MID_FINE = 0x434c4437;
const TAG_BASE_MID = 0x434c4438;
const TAG_CELL_MID = 0x434c4439;

// ---------------------------------------------------------------------------
// The set
// ---------------------------------------------------------------------------

/** Every cloud a seed's sky can show, storm candidates included, sorted by cell. */
export interface CloudSet {
  readonly seed: number;
  readonly count: number;
  /** Field position, metres in [0, CLOUD_PERIOD_M). */
  readonly x: Float64Array;
  readonly z: Float64Array;
  /** Base height above the datum (the flat bottom), metres. */
  readonly base: Float32Array;
  /** Height of the highest blob above the base, metres. */
  readonly top: Float32Array;
  /** Horizontal radius that holds every blob, metres. */
  readonly reach: Float32Array;
  /** The cell's fair-weather cover, and this candidate's rank in it (`cloudGrow`). */
  readonly cover: Float32Array;
  readonly rank: Float32Array;
  readonly kind: Uint8Array;
  /** `CloudDeck`: which wind carries it (`cloudDeckShift`). */
  readonly deck: Uint8Array;
  /** How much of the sun the cloud stops, 0..1: thin rafts less, towers all of it. */
  readonly opacity: Float32Array;
  /** Brightness, 0.9..1: no two clouds quite the same white. */
  readonly tint: Float32Array;
  /** 1 where the cloud fits the small mesh (one big lobe, at most four small). */
  readonly compact: Uint8Array;
  /** `count * CLOUD_SLOTS * BLOB_FLOATS`, centres relative to (x, base, z). */
  readonly blobs: Float32Array;
  /** Clouds of cell `c` are `cellStart[c]` up to `cellStart[c + 1]`. */
  readonly cellStart: Int32Array;
  /**
   * The farthest any cloud reaches outside its own placement cell, metres: the margin a
   * search by cell must add (a cloud may stand past its cell's edge in a group, and the
   * biggest are six kilometres long).
   */
  readonly maxReach: number;
}

function wrap(value: number, period: number): number {
  return value - period * Math.floor(value / period);
}

/** Signed distance from `from` to `to` on the period, in [-P/2, P/2). */
export function wrapDelta(to: number, from: number): number {
  return wrap(to - from + CLOUD_PERIOD_M / 2, CLOUD_PERIOD_M) - CLOUD_PERIOD_M / 2;
}

/** Value noise on a lattice of `cells` per period, so it repeats with the sky. */
function periodicNoise(x: number, z: number, cells: number, seed: number, tag: number): number {
  const size = CLOUD_PERIOD_M / cells;
  const px = x / size;
  const pz = z / size;
  const ix = Math.floor(px);
  const iz = Math.floor(pz);
  const fx = px - ix;
  const fz = pz - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const corner = (cx: number, cz: number): number =>
    hashUnit3(seed ^ tag, wrap(cx, cells), wrap(cz, cells));
  const a = corner(ix, iz);
  const b = corner(ix + 1, iz);
  const c = corner(ix, iz + 1);
  const d = corner(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a + (a - b + d - c) * ux) * uz;
}

/**
 * The district's cloudiness on `deck`, 0 (clear) to about 2.6, at a field position. Two
 * octaves of periodic noise, 7.7 and 3.8 km, pushed through a threshold: the low third
 * of districts hold nothing, the top few are crowded. The decks' districts are their own.
 */
export function districtCover(seed: number, x: number, z: number, deck: number = CloudDeck.Low): number {
  const [coarse, fine] = deck === CloudDeck.Low ? [TAG_DISTRICT, TAG_DISTRICT_FINE] : [TAG_DISTRICT_MID, TAG_DISTRICT_MID_FINE];
  const v = 0.65 * periodicNoise(x, z, 8, seed, coarse) + 0.35 * periodicNoise(x, z, 16, seed, fine);
  const t = Math.max(0, (v - 0.33) / 0.34);
  return 2.6 * t ** 1.4;
}

/**
 * A cloud's size against the weather: 0 not there, 1 as built, above 1 swollen by a storm.
 * In fair weather a cloud is whole or absent, never a shrunken crumb; only the clouds a
 * storm adds grow in from nothing, while it builds.
 */
export function cloudGrow(set: CloudSet, i: number, storm: number): number {
  const fair = fairShare(set.cover[i]!, set.deck[i]!);
  const rank = set.rank[i]!;
  const cover = fair * (1 + 1.5 * storm) + STORM_EXTRA * storm;
  const grow = rank < fair ? 1 : Math.min(1, Math.max(0, (cover - rank) / GROW_SPAN));
  return grow * (1 + 0.35 * storm);
}

/** Wind on `deck`: direction from the seed, veered aloft; speed fixed. Metres per second. */
export function cloudDeckWind(seed: number, deck: number, out: { x: number; z: number }): void {
  const d = deck as 0 | 1;
  const angle = hashUnit2(seed, TAG_WIND) * Math.PI * 2 + DECK_VEER_RAD[d];
  out.x = Math.cos(angle) * DECK_WIND_MPS[d];
  out.z = Math.sin(angle) * DECK_WIND_MPS[d];
}

/** Wind on the low deck, which carries the field (`cloudPan`). Metres per second. */
export function cloudWind(seed: number, out: { x: number; z: number }): void {
  cloudDeckWind(seed, CloudDeck.Low, out);
}

const windScratch = { x: 0, z: 0 };
const deckScratch = { x: 0, z: 0 };

/**
 * How far each deck's clouds have drifted against the low deck's after `elapsed` seconds,
 * metres in [0, CLOUD_PERIOD_M): a deck-`d` cloud built at field `(x, z)` stands at field
 * `(x + out[2d], z + out[2d + 1])`. The low deck's is zero by definition.
 */
export function cloudDeckShift(seed: number, elapsed: number, out: Float64Array): Float64Array {
  cloudDeckWind(seed, CloudDeck.Low, windScratch);
  for (let d = 0; d < CLOUD_DECKS; d++) {
    cloudDeckWind(seed, d, deckScratch);
    out[2 * d] = wrap((deckScratch.x - windScratch.x) * elapsed, CLOUD_PERIOD_M);
    out[2 * d + 1] = wrap((deckScratch.z - windScratch.z) * elapsed, CLOUD_PERIOD_M);
  }
  return out;
}

/** No drift: the field as built. */
export const CLOUD_NO_SHIFT: Float64Array = new Float64Array(2 * CLOUD_DECKS);

/**
 * The origin, drifted and reduced into one period: the field position of the scene's own
 * origin. A scene point `p` stands under field position `p + pan`. Computed in f64 and
 * uploaded as f32, which rounds it by at most 4 mm at the far end of a period; the same
 * rounding of an unreduced 386 km origin would be 30 mm and a jitter every rebase.
 */
export function cloudPan(
  seed: number,
  elapsed: number,
  originX: number,
  originZ: number,
  out: { x: number; z: number },
): void {
  cloudWind(seed, windScratch);
  out.x = wrap(originX - windScratch.x * elapsed, CLOUD_PERIOD_M);
  out.z = wrap(originZ - windScratch.z * elapsed, CLOUD_PERIOD_M);
}

/** Field position of an absolute world point at `elapsed` seconds of drift. */
export function cloudFieldOf(seed: number, x: number, z: number, elapsed: number, out: { x: number; z: number }): void {
  cloudWind(seed, windScratch);
  out.x = wrap(x - windScratch.x * elapsed, CLOUD_PERIOD_M);
  out.z = wrap(z - windScratch.z * elapsed, CLOUD_PERIOD_M);
}

// ---------------------------------------------------------------------------
// Building one cloud
// ---------------------------------------------------------------------------

/**
 * How high a body lobe's centre stands over the base, as a share of its vertical radius:
 * `BASE_LIFT_MIN` up to `BASE_LIFT_MIN + BASE_LIFT_SPAN`. The flat cut is then 0.63-0.84
 * of the lobe's width instead of all of it. The top end is held at 0.78 so that every
 * corner of a lobe's detail-2 icosphere from 0.85 of its radius down (its lowest rings),
 * even pulled in by render/clouds.ts's `LUMP` (8%), is below the base and clamped onto
 * it: a lobe's bottom lies IN the base plane, where every lobe's cut shades alike
 * (overlaps are invisible), and no face of it hovers flat a few metres over a
 * neighbour's cut, where the two would fight for the depth buffer.
 */
const BASE_LIFT_MIN = 0.55;
const BASE_LIFT_SPAN = 0.23;
/**
 * The longest cloud a base this high carries, as a multiple of the base's height: a
 * cumulus is about as wide as the layer under it is deep. A 6 km raft on a 1 km base
 * spans 140 degrees of the sky from under it, and in the owner's screenshot such clouds
 * near the road read as a low ceiling: at this length none seen from right under it
 * spans much over a hundred. Applied softly (`fitUnder`) so the sizes do not pile up at
 * the limit.
 */
const LENGTH_PER_BASE = 2;

/** `length` eased under `room`: unchanged when well short of it, never past it. */
function fitUnder(length: number, room: number): number {
  return length / (1 + (length / room) ** 4) ** 0.25;
}

/**
 * One cloud under construction, in its own frame: x along the wind (its length), z
 * across, y up from its flat base.
 */
interface Builder {
  big: number[];
  small: number[];
  rand: () => number;
}

/** A lobe turned `yaw` about the vertical (its rx then lies `yaw` off the cloud's length). */
function blob(list: number[], cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, yaw: number): void {
  list.push(cx, cy, cz, rx, ry, rz, Math.cos(yaw), Math.sin(yaw));
}

/**
 * THE SHAPE, from photographs of fair-weather cumulus. The owner read the first version
 * as "flying cakes" and the second as a sky of separate rocks and crumbs with pointed
 * tents; a real cumulus is ONE continuous body:
 *  - BIG, BROAD AND RARE. Humilis 1.4-3 km long and a sixth to a fifth as tall;
 *    mediocris 2.8-6 km, a fifth to under a third as tall. Nothing smaller: the owner
 *    read half-kilometre puffs in groups as confetti, and the short tall ones (a narrow
 *    dome seen end-on) as towers.
 *  - A FLAT BASE NARROWER THAN THE BODY, AND A LUMPY DOME OFF-CENTRE. A row of 3-5 body
 *    lobes runs the whole length, their tops following an envelope whose peak stands off
 *    the middle (`peak`); 1-2 crown lobes sit over the peak with their bottoms inside the
 *    body. Each body lobe is centred ABOVE the base (`BASE_LIFT_MIN`), so the cloud bulges
 *    out over a base cut smaller than itself and its lower flanks turn under toward it.
 *    The owner read the first, sunk lobes (centres at or under the base, so the cut was
 *    each lobe's widest section) as giant flat slabs from below: the whole underside was
 *    one flat face of one colour. Neighbouring lobes overlap by well over half a radius,
 *    so the outline is one bumpy body with no sky between its parts.
 *  - ROUNDED, NEVER STRETCHED UP. No lobe is taller than it is wide (ry at most 0.85 of
 *    its narrower horizontal radius): an icosphere stretched upward is a tent.
 *  - SMALL LOBES SUNK IN. 6-12 lobes a quarter to two fifths of their parent, centred
 *    inside it, protruding 30-50% of their own radius from its upper surface and upper
 *    sides, and only where that surface shows (not inside another lobe): cauliflower.
 *  - ALONG THE WIND: length 1.3-1.6 times the width, turned to the drift: a raft seen
 *    end-on down the wind is still a kilometre or more across and much wider than tall.
 * Returns the peak's offset along the length; the caller sinks the small lobes in
 * (`addLobes`) once every big one is placed.
 */
function buildBody(b: Builder, length: number, width: number, height: number, bodies: number, crowns: number): number {
  const r = b.rand;
  const peak = (r() < 0.5 ? -1 : 1) * (0.08 + 0.14 * r()) * length;
  const bodyTop = height * (0.55 + 0.1 * r());
  const envelope = (u: number): number => {
    const t = (u - peak) / (0.62 * length);
    return Math.max(0.12, 1 - t * t) ** 0.8;
  };
  const spacing = (0.64 * length) / (bodies - 1);
  for (let i = 0; i < bodies; i++) {
    const u = (i / (bodies - 1) - 0.5) * 0.64 * length + (r() - 0.5) * 0.1 * spacing;
    const taper = Math.max(0.35, 1 - ((2 * u) / length) ** 2);
    const rx = Math.max(0.92 * spacing, 0.2 * length) * (0.95 + 0.12 * r());
    const rz = 0.46 * width * (0.88 + 0.12 * r()) * Math.sqrt(taper);
    const h = bodyTop * envelope(u) * (0.92 + 0.08 * r());
    // Centred above the base by a share of its height that varies lobe to lobe and grows
    // toward the tapered ends, so the flat cut is a narrower, uneven core with rounded
    // flanks round it rather than the lobe's whole footprint.
    const lift = BASE_LIFT_MIN + BASE_LIFT_SPAN * (0.7 * r() + (0.3 * (1 - taper)) / 0.65);
    const ry = Math.min(0.85 * Math.min(rx, rz), h / (1 + lift));
    const cy = lift * ry;
    blob(b.big, u, cy, (r() - 0.5) * 0.15 * width, rx, ry, rz, (r() - 0.5) * 0.4);
  }
  for (let k = 0; k < crowns; k++) {
    const u = peak + (k === 0 ? (r() - 0.5) * 0.08 : (r() < 0.5 ? -1 : 1) * (0.12 + 0.08 * r())) * length;
    const rx = 0.24 * length * (0.9 + 0.2 * r());
    const rz = 0.345 * width * (0.9 + 0.15 * r());
    const top = height * (k === 0 ? 1 : 0.8 + 0.1 * r());
    // Centred over the base like the body lobes, never a ball sunk through it whose cut
    // would be the crown's whole width.
    const ry = Math.min(0.85 * Math.min(rx, rz), top / (1 + BASE_LIFT_MIN));
    let cy = top - ry;
    // Its bottom inside the body under it, never a separate lump perched on top.
    const floor = 0.7 * bodyTop * envelope(u);
    if (cy - ry > floor) cy = floor + ry;
    blob(b.big, u, cy, (r() - 0.5) * 0.2 * width, rx, ry, rz, (r() - 0.5) * 0.4);
  }
  return peak;
}

/** Whether a point is inside any big lobe but `except`, by `margin` of its radius. */
function insideBig(b: Builder, px: number, py: number, pz: number, except: number, margin: number): boolean {
  for (let m = 0; m * BLOB_FLOATS < b.big.length; m++) {
    if (m === except) continue;
    const [cx, cy, cz, rx, ry, rz, c, s] = b.big.slice(m * BLOB_FLOATS, (m + 1) * BLOB_FLOATS) as [number, number, number, number, number, number, number, number];
    const dx = px - cx;
    const dz = pz - cz;
    const lx = (c * dx + s * dz) / rx;
    const lz = (-s * dx + c * dz) / rz;
    const ly = (py - cy) / ry;
    if (lx * lx + ly * ly + lz * lz < margin) return true;
  }
  return false;
}

/**
 * Small lobes sunk into the big ones: a point on a big lobe's upper surface (the taller
 * lobes chosen more often) that is not hidden inside another lobe and stands above the
 * lowest sixth of the cloud; a lobe a quarter to two fifths of its parent, wider than
 * tall, centred inside the parent along the surface normal so that 30-50% of its radius
 * stands out.
 */
function addLobes(b: Builder, height: number, count: number): void {
  const r = b.rand;
  const bigs = b.big.length / BLOB_FLOATS;
  const weights: number[] = [];
  let total = 0;
  for (let j = 0; j < bigs; j++) {
    const w = Math.max(0, b.big[j * BLOB_FLOATS + 1]! + b.big[j * BLOB_FLOATS + 4]!) ** 2;
    weights.push(w);
    total += w;
  }
  for (let k = 0, tries = 0; k < count && tries < count * 10; tries++) {
    let pick = r() * total;
    let j = 0;
    while (j < bigs - 1 && (pick -= weights[j]!) > 0) j++;
    const [cx, cy, cz, rx, ry, rz, c, s] = b.big.slice(j * BLOB_FLOATS, (j + 1) * BLOB_FLOATS) as [number, number, number, number, number, number, number, number];
    const a = r() * Math.PI * 2;
    const up = 0.3 + 0.65 * r();
    const flat = Math.sqrt(1 - up * up);
    const ux = Math.cos(a) * flat;
    const uz = Math.sin(a) * flat;
    // The surface point and its normal, in the parent's frame, then turned with it.
    let nx = ux / rx;
    let ny = up / ry;
    let nz = uz / rz;
    const nl = Math.hypot(nx, ny, nz);
    nx /= nl;
    ny /= nl;
    nz /= nl;
    const px = cx + c * ux * rx - s * uz * rz;
    const pz = cz + s * ux * rx + c * uz * rz;
    const py = cy + up * ry;
    const wx = c * nx - s * nz;
    const wz = s * nx + c * nz;
    if (py < height * 0.15 || insideBig(b, px, py, pz, j, 0.95)) continue;
    const size = Math.min(rx, rz) * (0.25 + 0.15 * r());
    const sy = size * (0.7 + 0.15 * r());
    const along = sy * Math.abs(ny) + size * (1 - Math.abs(ny));
    // No deeper than the middle of the parent's chord along the normal (its deepest
    // point that way), so the centre stays inside even a flat parent.
    const deepest = nl ** 3 / ((ux / (rx * rx)) ** 2 + (up / (ry * ry)) ** 2 + (uz / (rz * rz)) ** 2);
    const sunk = Math.min((0.5 + 0.2 * r()) * along, deepest);
    blob(b.small, px - wx * sunk, py - ny * sunk, pz - wz * sunk, size * (1 + 0.25 * r()), sy, size, r() * Math.PI * 2);
    k++;
  }
}

/**
 * The congestus: a long mediocris body with one broad heap sunk into its crown, wider
 * than the crown and less than half as tall as the cloud is wide. The stack of ever
 * narrower lobes it used to be read, seen end-on, as a tower; this reads as a cumulus
 * that has swollen, a third as tall as long. Sunk small lobes over all of it.
 */
function buildCongestus(b: Builder, length: number): void {
  const r = b.rand;
  const width = length / (1.35 + 0.2 * r());
  const height = length * (0.22 + 0.04 * r());
  const peak = buildBody(b, length, width, height, CLOUD_BIG_SLOTS - 2, 1);
  const radius = 0.22 * length * (0.95 + 0.1 * r());
  const ry = 0.6 * radius;
  const cy = height - 0.35 * ry;
  const u = peak + (r() - 0.5) * 0.06 * length;
  blob(b.big, u, cy, (r() - 0.5) * 0.1 * width, radius * (1 + 0.15 * r()), ry, 0.9 * radius, (r() - 0.5) * 0.4);
  addLobes(b, cy + ry, 12);
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

let cached: CloudSet | null = null;

/** The seed's whole sky. Built once per seed (a few milliseconds) and kept. */
export function cloudSet(seed: number): CloudSet {
  if (cached !== null && cached.seed === seed) return cached;
  cached = buildCloudSet(seed);
  return cached;
}

function buildCloudSet(seed: number): CloudSet {
  const xs: number[] = [];
  const zs: number[] = [];
  const bases: number[] = [];
  const tops: number[] = [];
  const reaches: number[] = [];
  const covers: number[] = [];
  const ranks: number[] = [];
  const kinds: number[] = [];
  const decks: number[] = [];
  const opacities: number[] = [];
  const tints: number[] = [];
  const compacts: number[] = [];
  const blobs: number[] = [];
  const cells = CLOUD_PERIOD_CELLS;
  const cellStart = new Int32Array(cells * cells + 1);
  let maxReach = 0;
  const builder: Builder = { big: [], small: [], rand: Math.random };
  // Every cloud's long axis lies along its deck's drift (`cloudDeckWind`), give or take.
  const windAngle = hashUnit2(seed, TAG_WIND) * Math.PI * 2;
  const midWindAngle = windAngle + DECK_VEER_RAD[CloudDeck.Mid];

  /** Turns the built cloud to `yaw` and appends it, at unwrapped (x, z) in cell (ox, oz). */
  const emit = (
    x: number, z: number, ox: number, oz: number, base: number, yaw: number,
    kind: number, deck: number, cover: number, rank: number, tint: number,
  ): void => {
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    let top = 0;
    let reach = 0;
    const slots: number[] = [];
    const place = (list: number[], first: number, limit: number): void => {
      const n = Math.min(limit, list.length / BLOB_FLOATS);
      for (let j = 0; j < n; j++) {
        const o = j * BLOB_FLOATS;
        const bx = list[o]!;
        const bz = list[o + 2]!;
        const bc = list[o + 6]!;
        const bs = list[o + 7]!;
        const turned = [cy * bx - sy * bz, list[o + 1]!, sy * bx + cy * bz, list[o + 3]!, list[o + 4]!, list[o + 5]!, bc * cy - bs * sy, bs * cy + bc * sy];
        for (let f = 0; f < BLOB_FLOATS; f++) slots[(first + j) * BLOB_FLOATS + f] = turned[f]!;
        top = Math.max(top, turned[1]! + turned[4]!);
        reach = Math.max(reach, Math.hypot(turned[0]!, turned[2]!) + Math.max(turned[3]!, turned[5]!));
      }
    };
    place(builder.big, 0, CLOUD_BIG_SLOTS);
    place(builder.small, CLOUD_BIG_SLOTS, CLOUD_SLOTS - CLOUD_BIG_SLOTS);
    for (let j = 0; j < CLOUD_SLOTS * BLOB_FLOATS; j++) blobs.push(slots[j] ?? 0);
    // How far past its own cell the cloud reaches, for every search by cell.
    const outside = Math.max(0, ox - x, x - ox - CLOUD_CELL_M, oz - z, z - oz - CLOUD_CELL_M);
    maxReach = Math.max(maxReach, outside + reach * 1.35);
    xs.push(wrap(x, CLOUD_PERIOD_M));
    zs.push(wrap(z, CLOUD_PERIOD_M));
    bases.push(base);
    tops.push(top);
    reaches.push(reach);
    covers.push(cover);
    ranks.push(rank);
    kinds.push(kind);
    decks.push(deck);
    opacities.push(CLOUD_KIND_OPACITY[kind]!);
    tints.push(tint);
    compacts.push(
      builder.big.length <= CLOUD_COMPACT_BIG * BLOB_FLOATS && builder.small.length <= CLOUD_COMPACT_SMALL * BLOB_FLOATS ? 1 : 0,
    );
  };

  for (let cz = 0; cz < cells; cz++) {
    for (let cx = 0; cx < cells; cx++) {
      const cell = cz * cells + cx;
      cellStart[cell] = xs.length;
      const ox = cx * CLOUD_CELL_M;
      const oz = cz * CLOUD_CELL_M;
      const cover = districtCover(seed, ox + CLOUD_CELL_M / 2, oz + CLOUD_CELL_M / 2);
      // The storm's ceiling for this cell (`cloudGrow` at storm 1).
      const most = fairShare(cover, CloudDeck.Low) * 2.5 + STORM_EXTRA;
      const cellRand = mulberry32((hashUnit3(seed ^ TAG_CELL, cx, cz) * 4294967296) >>> 0);
      const groupX = ox + cellRand() * CLOUD_CELL_M;
      const groupZ = oz + cellRand() * CLOUD_CELL_M;
      for (let k = 0; k < CANDIDATES; k++) {
        const rank = k + cellRand();
        const grouped = cellRand() < 0.5;
        const a = cellRand() * Math.PI * 2;
        const d = Math.sqrt(cellRand()) * 1800;
        const ux = cellRand();
        const uz = cellRand();
        const shapeSeed = (hashUnit3(seed ^ TAG_SHAPE, cell, k) * 4294967296) >>> 0;
        if (rank >= most) continue;
        // A group is drawn out along the wind into a loose street, its clouds far enough
        // apart along it to read as a line of long rafts, not a clump of puffs.
        const along = Math.cos(a) * d * 2;
        const across = Math.sin(a) * d * 0.5;
        const x = grouped ? groupX + along * Math.cos(windAngle) - across * Math.sin(windAngle) : ox + ux * CLOUD_CELL_M;
        const z = grouped ? groupZ + along * Math.sin(windAngle) + across * Math.cos(windAngle) : oz + uz * CLOUD_CELL_M;

        const r = mulberry32(shapeSeed);
        builder.rand = r;
        builder.big.length = 0;
        builder.small.length = 0;
        // One straight base for the district (its condensation level), within a few tens
        // of metres from cloud to cloud.
        const level = periodicNoise(x, z, 6, seed, TAG_BASE);
        const condensation = 1000 + 2500 * level ** 1.3;
        const room = LENGTH_PER_BASE * condensation;
        // Rare, big clouds: the cover comes from their size. Humilis 1.4-3 km long and a
        // sixth to a fifth as tall; mediocris 2.8-6 km, a fifth to under a third as tall;
        // both only 1.3-1.6 times as long as wide, so one seen end-on down the wind is
        // still a kilometre or more across; in a cloudy district now and then a
        // congestus, broad as a mediocris. Under a low base all of them are fitted to
        // the shallower layer (`LENGTH_PER_BASE`), so the biggest rafts stand high.
        let kind: number;
        if (r() < 0.012 * Math.min(1, cover / 1.6)) {
          kind = CloudKind.Congestus;
          buildCongestus(builder, fitUnder(3000 + 1500 * r(), room));
        } else if (r() < 0.6) {
          kind = CloudKind.Humilis;
          const length = fitUnder(1400 + 1600 * r() ** 1.3, room);
          const height = length * (0.16 + 0.05 * r());
          buildBody(builder, length, length / (1.3 + 0.3 * r()), height, 3, 1);
          addLobes(builder, height, CLOUD_COMPACT_SMALL);
        } else {
          kind = CloudKind.Mediocris;
          const length = fitUnder(2800 + 3200 * r() ** 1.5, room);
          const bodies = 4 + Math.floor(r() * 2);
          const height = length * (0.2 + 0.08 * r());
          buildBody(builder, length, length / (1.3 + 0.3 * r()), height, bodies, CLOUD_BIG_SLOTS - bodies);
          addLobes(builder, height, 10 + Math.floor(r() * 3));
        }
        const base = condensation + (r() - 0.5) * 60;
        const yaw = windAngle + (r() - 0.5) * 0.5;
        emit(x, z, ox, oz, base, yaw, kind, CloudDeck.Low, cover, rank, 0.92 + 0.08 * r());
      }

      // THE ALTOCUMULUS DECK, in its own districts and on its own wind: flat rafts 1.5-4 km
      // along that wind, a tenth or less as thick, crusted with small lobes; strung in
      // streets like the cumulus. One level for the district, 4.3-5.5 km up.
      const midCover = districtCover(seed, ox + CLOUD_CELL_M / 2, oz + CLOUD_CELL_M / 2, CloudDeck.Mid);
      const midMost = fairShare(midCover, CloudDeck.Mid) * 2.5 + STORM_EXTRA;
      const midRand = mulberry32((hashUnit3(seed ^ TAG_CELL_MID, cx, cz) * 4294967296) >>> 0);
      const midGroupX = ox + midRand() * CLOUD_CELL_M;
      const midGroupZ = oz + midRand() * CLOUD_CELL_M;
      for (let k = 0; k < CANDIDATES; k++) {
        const rank = k + midRand();
        const grouped = midRand() < 0.5;
        const a = midRand() * Math.PI * 2;
        const d = Math.sqrt(midRand()) * 1800;
        const ux = midRand();
        const uz = midRand();
        const shapeSeed = (hashUnit3(seed ^ TAG_CELL_MID, cell, CANDIDATES + k) * 4294967296) >>> 0;
        if (rank >= midMost) continue;
        const along = Math.cos(a) * d * 2;
        const across = Math.sin(a) * d * 0.5;
        const x = grouped ? midGroupX + along * Math.cos(midWindAngle) - across * Math.sin(midWindAngle) : ox + ux * CLOUD_CELL_M;
        const z = grouped ? midGroupZ + along * Math.sin(midWindAngle) + across * Math.cos(midWindAngle) : oz + uz * CLOUD_CELL_M;
        const r = mulberry32(shapeSeed);
        builder.rand = r;
        builder.big.length = 0;
        builder.small.length = 0;
        const length = 1500 + 2500 * r() ** 1.3;
        const height = length * (0.07 + 0.03 * r());
        buildBody(builder, length, length / (1.4 + 0.4 * r()), height, 3, 1);
        addLobes(builder, height, CLOUD_COMPACT_SMALL);
        const base = 4300 + 1200 * periodicNoise(x, z, 6, seed, TAG_BASE_MID) + (r() - 0.5) * 80;
        const yaw = midWindAngle + (r() - 0.5) * 0.5;
        emit(x, z, ox, oz, base, yaw, CloudKind.Altocumulus, CloudDeck.Mid, midCover, rank, 0.95 + 0.05 * r());
      }
    }
  }
  cellStart[cells * cells] = xs.length;

  return {
    seed,
    count: xs.length,
    x: Float64Array.from(xs),
    z: Float64Array.from(zs),
    base: Float32Array.from(bases),
    top: Float32Array.from(tops),
    reach: Float32Array.from(reaches),
    cover: Float32Array.from(covers),
    rank: Float32Array.from(ranks),
    kind: Uint8Array.from(kinds),
    deck: Uint8Array.from(decks),
    opacity: Float32Array.from(opacities),
    tint: Float32Array.from(tints),
    compact: Uint8Array.from(compacts),
    blobs: Float32Array.from(blobs),
    cellStart,
    maxReach,
  };
}

// ---------------------------------------------------------------------------
// The CPU twin of the shadow
// ---------------------------------------------------------------------------

/**
 * Whether the ray from `(px, py, pz)` up the sun (`sx`, `sz`: horizontal metres per metre
 * of height) passes through cloud `i`, drawn `grow` times its size with its centre at
 * `(ax, az)`. Each blob is an ellipsoid cut flat at the cloud's base, as the mesh is.
 */
function rayHitsCloud(
  set: CloudSet,
  i: number,
  grow: number,
  ax: number,
  az: number,
  px: number,
  py: number,
  pz: number,
  sx: number,
  sz: number,
): boolean {
  const base = set.base[i]!;
  const o0 = i * CLOUD_SLOTS * BLOB_FLOATS;
  for (let j = 0; j < CLOUD_SLOTS; j++) {
    const o = o0 + j * BLOB_FLOATS;
    // An empty slot has no radius.
    if (set.blobs[o + 3]! <= 0) continue;
    const cy = base + set.blobs[o + 1]! * grow;
    const cx = ax + set.blobs[o]! * grow;
    const cz = az + set.blobs[o + 2]! * grow;
    const rx = set.blobs[o + 3]! * grow;
    const ry = set.blobs[o + 4]! * grow;
    const rz = set.blobs[o + 5]! * grow;
    const c = set.blobs[o + 6]!;
    const s = set.blobs[o + 7]!;
    // The ray as A + D t, t the height above the blob's centre.
    const wx = px + sx * (cy - py) - cx;
    const wz = pz + sz * (cy - py) - cz;
    // Into the blob's own frame (the inverse of the mesh's yaw), then the unit sphere.
    const ax0 = (c * wx + s * wz) / rx;
    const az0 = (-s * wx + c * wz) / rz;
    const dx = (c * sx + s * sz) / rx;
    const dy = 1 / ry;
    const dz = (-s * sx + c * sz) / rz;
    const qa = dx * dx + dy * dy + dz * dz;
    const qb = 2 * (ax0 * dx + az0 * dz);
    const qc = ax0 * ax0 + az0 * az0 - 1;
    const disc = qb * qb - 4 * qa * qc;
    if (disc < 0) continue;
    const t1 = (-qb + Math.sqrt(disc)) / (2 * qa);
    // Some of the chord must stand above the flat base and above the ground point.
    if (cy + t1 >= Math.max(base, py)) return true;
  }
  return false;
}

/**
 * How much of the sun the clouds stop along the ray from field point `(fx, fy, fz)`
 * toward it: the most opaque cloud the ray passes through, 0 if none. Exactly what the
 * shadow map's coverage pass rasterises (render/clouds.ts), before its blur. `shift` is
 * where the decks have drifted (`cloudDeckShift`; `CLOUD_NO_SHIFT` for the field as built).
 */
export function cloudCoverAlong(
  set: CloudSet,
  storm: number,
  shift: Float64Array,
  fx: number,
  fy: number,
  fz: number,
  sx: number,
  sz: number,
): number {
  const margin = set.maxReach * (1 + 0.35 * storm);
  const cells = CLOUD_PERIOD_CELLS;
  let best = 0;
  for (let deck = 0; deck < CLOUD_DECKS; deck++) {
    // The ground point in the frame this deck's clouds were built in.
    const px = fx - shift[2 * deck]!;
    const pz = fz - shift[2 * deck + 1]!;
    const lowX = px + sx * (CLOUD_FLOOR_M - fy);
    const lowZ = pz + sz * (CLOUD_FLOOR_M - fy);
    const highX = px + sx * (CLOUD_CEILING_M - fy);
    const highZ = pz + sz * (CLOUD_CEILING_M - fy);
    const midX = (lowX + highX) / 2;
    const midZ = (lowZ + highZ) / 2;
    const x0 = Math.floor((Math.min(lowX, highX) - margin) / CLOUD_CELL_M);
    const x1 = Math.floor((Math.max(lowX, highX) + margin) / CLOUD_CELL_M);
    const z0 = Math.floor((Math.min(lowZ, highZ) - margin) / CLOUD_CELL_M);
    const z1 = Math.floor((Math.max(lowZ, highZ) + margin) / CLOUD_CELL_M);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const cell = wrap(cz, cells) * cells + wrap(cx, cells);
        for (let i = set.cellStart[cell]!; i < set.cellStart[cell + 1]!; i++) {
          if (set.deck[i] !== deck || set.opacity[i]! <= best) continue;
          const grow = cloudGrow(set, i, storm);
          if (grow <= 0) continue;
          // The copy of the cloud nearest the ray's middle.
          const ax = midX + wrapDelta(set.x[i]!, midX);
          const az = midZ + wrapDelta(set.z[i]!, midZ);
          if (rayHitsCloud(set, i, grow, ax, az, px, fy, pz, sx, sz)) best = set.opacity[i]!;
        }
      }
    }
  }
  return best;
}

/**
 * Gaussian of the map's blur, as offsets and weights: the centre, then rings of six at one
 * and two standard deviations (render/clouds.ts `MAP_BLUR_SIGMA_M`).
 */
const SHADE_TAPS: { x: number; z: number; w: number }[] = [];
export const CLOUD_SHADE_SIGMA_M = 52;
{
  SHADE_TAPS.push({ x: 0, z: 0, w: 1 });
  for (const [ring, turn] of [[1, 0], [2, Math.PI / 6]] as const) {
    for (let k = 0; k < 6; k++) {
      const a = turn + (k / 6) * Math.PI * 2;
      const d = ring * CLOUD_SHADE_SIGMA_M;
      SHADE_TAPS.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, w: Math.exp(-0.5 * ring * ring) });
    }
  }
  const total = SHADE_TAPS.reduce((sum, tap) => sum + tap.w, 0);
  for (const tap of SHADE_TAPS) tap.w /= total;
}

/**
 * The ground's shade at a field point, 0 (full sun) to 1: the coverage along the sun's
 * ray, softened by the same blur the map gets. The CPU twin of what a ground vertex
 * reads from the map (render/cloudshadow.ts).
 */
export function cloudShadeAlong(
  set: CloudSet,
  storm: number,
  shift: Float64Array,
  fx: number,
  fy: number,
  fz: number,
  sx: number,
  sz: number,
): number {
  let shade = 0;
  for (const tap of SHADE_TAPS) shade += tap.w * cloudCoverAlong(set, storm, shift, fx + tap.x, fy, fz + tap.z, sx, sz);
  return shade;
}
