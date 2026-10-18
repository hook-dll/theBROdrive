/**
 * tools/sky-variety.ts
 *
 * The two things that are supposed to make the light and the horizon stop standing
 * still: the low-poly clouds and the shadows they drag across the ground
 * (render/cloudfield.ts, render/clouds.ts, render/cloudshadow.ts), and the weather
 * schedule (world/weather.ts). Both are driven here as the game drives them.
 *
 * WHAT A HEADLESS BENCH CAN AND CANNOT SETTLE. There is no GPU, so nothing here looks at
 * a pixel. The clouds are a LIST, built from the seed on the CPU, and the shadow map is a
 * picture of that list taken along the sun's ray; its CPU twin (`cloudShadeAlong`) is
 * what is measured:
 *
 *  - the sky is a pure function of the seed, and the shade a pure function of seed,
 *    place, time and sun, so a rebuilt frame cannot flicker;
 *  - the sky is what the owner asked for: humilis, mediocris and rare congestus; no
 *    crumbs (every cloud over a kilometre long), no columns (even a congestus stands
 *    well under its own length tall), each one continuous body (lobes that
 *    overlap, small lobes sunk in) with no lobe stretched upward into a point; bases from
 *    1 to 3.5 km on one line per district; a cover of 10-20% that is NOT even (clear
 *    stretches, crowded ones) and clouds that clump rather than sprinkle;
 *  - FROM BELOW, A CLOUD AND NOT A SLAB: the flat cut at the base is a core inside the
 *    outline, every lobe's bottom pressed into the base plane or clear of it (no faces
 *    a few metres apart to fight for depth), and no cloud so long for its base that it
 *    spans much over a hundred degrees from right under it;
 *  - EVERY CLOUD HAS ITS SHADOW, up the sun's ray from the ground it darkens, at noon and
 *    under an afternoon sun, and the shadow's edge is a penumbra, not a line;
 *  - a storm brings more and bigger clouds;
 *  - REBASING DOES NOT MOVE THE CLOUDS: the shader gets an origin-relative position and a
 *    panned origin, and those must compose back into the absolute sample, checked at
 *    386 km out, as far from the centre as this road ever gets;
 *  - the ground patch splices into the three version actually installed, exactly once,
 *    with the map read per VERTEX and nothing but a multiply per fragment;
 *  - the weather schedule is a pure function of seed and clock, stays in range,
 *    is present for most of a drive, and never cuts one episode into the next.
 *
 *   npx tsx tools/sky-variety.ts
 *
 * Nothing here is part of the game bundle.
 */

import * as THREE from 'three';
import type { WebGLProgramParametersWithUniforms } from 'three';
import { applyComicShading, applyGroundSpotlightNormals } from '../src/render/comic';
import {
  BLOB_FLOATS,
  CLOUD_BIG_SLOTS,
  CLOUD_DECKS,
  CLOUD_DRIFT_MPS,
  CLOUD_NO_SHIFT,
  CLOUD_PERIOD_M,
  CLOUD_SLOTS,
  CloudDeck,
  CloudKind,
  cloudCoverAlong,
  cloudDeckShift,
  cloudDeckWind,
  cloudGrow,
  cloudPan,
  cloudSet,
  cloudShadeAlong,
  cloudWind,
  type CloudSet,
} from '../src/render/cloudfield';
import {
  advanceCloudShadows,
  applyCloudShadow,
  CLOUD_DARKEN_MAX,
  cloudShadowFrame,
  cloudShadowShadeAt,
  cloudShadowStrength,
} from '../src/render/cloudshadow';
import { weatherAt, weatherKindOfSlot, WEATHER_SLOT_S, type WeatherChannels } from '../src/world/weather';

const SEEDS = [1, 7, 42, 1337];
/** Where the road gets to at 40 000 km: the f32 precision case, in metres. */
const FAR_FROM_CENTRE = 386_000;
/** Shade above which ground counts as "in shadow". */
const IN_SHADOW = 0.5;
/** Sun slopes (horizontal metres per metre up the ray): near noon, and mid-afternoon. */
const SUNS = [
  { label: 'noon', x: 0.18, z: -0.12 },
  { label: 'afternoon', x: 0.95, z: 0.55 },
];
let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(48)} ${detail}`);
}

function wrap(v: number): number {
  return v - CLOUD_PERIOD_M * Math.floor(v / CLOUD_PERIOD_M);
}

/** Fraction of `n` sample points over the period with a cloud straight overhead. */
function verticalCover(set: CloudSet, storm: number, n: number, offset: number): number {
  let hit = 0;
  for (let k = 0; k < n; k++) {
    const x = wrap(k * 7919.7 + offset);
    const z = wrap(k * 104_729.3 - offset);
    if (cloudCoverAlong(set, storm, CLOUD_NO_SHIFT, x, 0, z, 0, 0) > 0) hit++;
  }
  return hit / n;
}

/** Built twice from cold, by way of another seed, so the cache cannot answer for it. */
function sameSet(a: CloudSet, b: CloudSet): boolean {
  if (a.count !== b.count) return false;
  for (let i = 0; i < a.count; i++) {
    if (a.x[i] !== b.x[i] || a.z[i] !== b.z[i] || a.base[i] !== b.base[i] || a.rank[i] !== b.rank[i]) return false;
  }
  for (let i = 0; i < a.blobs.length; i++) if (a.blobs[i] !== b.blobs[i]) return false;
  return true;
}

// ---------------------------------------------------------------------------
// 1. the clouds
// ---------------------------------------------------------------------------

console.log('clouds');

{
  const first = cloudSet(42);
  cloudSet(7);
  const again = cloudSet(42);
  check('the same seed builds the same sky', first !== again && sameSet(first, again), `${first.count} candidates, rebuilt from cold`);
  let repeatable = true;
  for (let i = 0; i < 2000; i++) {
    const x = (i * 7919) % 900_000 - 450_000;
    const z = (i * 104_729) % 900_000 - 450_000;
    const t = (i % 600) * 1.37;
    const a = cloudShadowShadeAt(42, x, 30, z, t, 0.3, -0.2, 0);
    if (cloudShadowShadeAt(42, x, 30, z, t, 0.3, -0.2, 0) !== a) repeatable = false;
  }
  check('the same place, time and sun shade the same', repeatable, '2000 samples');
}

// -- variety ----------------------------------------------------------------------

{
  const kinds = [0, 0, 0];
  let lowBase = Infinity;
  let highBase = 0;
  let fair = 0;
  let stretched = 0;
  let spikes = 0;
  let lobes = 0;
  let loose = 0;
  let floating = 0;
  let smalls = 0;
  const lengths: number[] = [];
  const ratios: number[][] = [[], [], []];
  const spreads: number[] = [];
  const wind = { x: 0, z: 0 };
  /** Normalised distance of a point from lobe `o`'s centre: under 1 inside it. */
  const lobeDistance = (blobs: Float32Array, o: number, px: number, py: number, pz: number): number => {
    const dx = px - blobs[o]!;
    const dz = pz - blobs[o + 2]!;
    const c = blobs[o + 6]!;
    const s = blobs[o + 7]!;
    const lx = (c * dx + s * dz) / blobs[o + 3]!;
    const lz = (-s * dx + c * dz) / blobs[o + 5]!;
    const ly = (py - blobs[o + 1]!) / blobs[o + 4]!;
    return Math.sqrt(lx * lx + ly * ly + lz * lz);
  };
  for (const seed of SEEDS) {
    const set = cloudSet(seed);
    cloudWind(seed, wind);
    const wx = wind.x / Math.hypot(wind.x, wind.z);
    const wz = wind.z / Math.hypot(wind.x, wind.z);
    for (let cell = 0; cell + 1 < set.cellStart.length; cell++) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = set.cellStart[cell]!; i < set.cellStart[cell + 1]!; i++) {
        if (set.deck[i] !== CloudDeck.Low || cloudGrow(set, i, 0) < 1) continue;
        lo = Math.min(lo, set.base[i]!);
        hi = Math.max(hi, set.base[i]!);
      }
      if (hi > lo) spreads.push(hi - lo);
    }
    for (let i = 0; i < set.count; i++) {
      if (set.deck[i] !== CloudDeck.Low || cloudGrow(set, i, 0) < 1) continue;
      fair++;
      const kind = set.kind[i]!;
      kinds[kind]!++;
      lowBase = Math.min(lowBase, set.base[i]!);
      highBase = Math.max(highBase, set.base[i]!);
      let along = 0;
      let across = 0;
      const big: number[] = [];
      for (let j = 0; j < CLOUD_SLOTS; j++) {
        const o = (i * CLOUD_SLOTS + j) * BLOB_FLOATS;
        const rx = set.blobs[o + 3]!;
        if (rx <= 0) continue;
        const r = Math.max(rx, set.blobs[o + 5]!);
        along = Math.max(along, Math.abs(set.blobs[o]! * wx + set.blobs[o + 2]! * wz) + r);
        across = Math.max(across, Math.abs(-set.blobs[o]! * wz + set.blobs[o + 2]! * wx) + r);
        if (set.blobs[o + 4]! > Math.min(rx, set.blobs[o + 5]!) + 1e-3) spikes++;
        if (j < CLOUD_BIG_SLOTS) big.push(o);
        else {
          // A small lobe is sunk: its centre inside one of the big ones.
          smalls++;
          if (!big.some((p) => lobeDistance(set.blobs, p, set.blobs[o]!, set.blobs[o + 1]!, set.blobs[o + 2]!) < 1)) floating++;
        }
      }
      // Every big lobe overlaps a neighbour by over half a radius: its centre within 1.5
      // radii of the other's, either way round.
      for (const o of big) {
        lobes++;
        if (big.length > 1 && !big.some((p) => p !== o && Math.min(
          lobeDistance(set.blobs, p, set.blobs[o]!, set.blobs[o + 1]!, set.blobs[o + 2]!),
          lobeDistance(set.blobs, o, set.blobs[p]!, set.blobs[p + 1]!, set.blobs[p + 2]!),
        ) < 1.5)) loose++;
      }
      lengths.push(2 * along);
      ratios[kind]!.push(set.top[i]! / (2 * along));
      if (along > across * 1.1) stretched++;
    }
  }
  const median = (values: number[]): number => [...values].sort((a, b) => a - b)[values.length >> 1] ?? 0;
  lengths.sort((a, b) => a - b);
  spreads.sort((a, b) => a - b);
  console.log(
    `    ${fair} full-grown fair-weather cumulus over ${SEEDS.length} skies: ` +
      `${kinds[CloudKind.Humilis]} humilis, ${kinds[CloudKind.Mediocris]} mediocris, ` +
      `${kinds[CloudKind.Congestus]} congestus`,
  );
  check(
    'every kind is in the sky, towers rare',
    kinds.every((k) => k > 0) && kinds[CloudKind.Congestus]! / fair < 0.05,
    `${((kinds[CloudKind.Congestus]! / fair) * 100).toFixed(1)}% congestus`,
  );
  check(
    'no crumbs: rare clouds, every one long',
    (lengths[0] ?? 0) >= 1000 && median(lengths) > 1800 && median(lengths) < 4000,
    `smallest ${(lengths[0] ?? 0).toFixed(0)} m, median ${median(lengths).toFixed(0)} m, largest ${(lengths[lengths.length - 1] ?? 0).toFixed(0)} m long`,
  );
  const hum = median(ratios[CloudKind.Humilis]!);
  const med = median(ratios[CloudKind.Mediocris]!);
  const tower = median(ratios[CloudKind.Congestus]!);
  // The owner read short tall clouds as towers: every kind is a raft longer than it is
  // tall, and the congestus heaps higher than a mediocris without becoming a column.
  check(
    'humilis flat, mediocris a quarter as tall, congestus heaped but no column',
    hum > 0.12 && hum < 0.22 && med > 0.18 && med < 0.3 && tower > med && tower < 0.6,
    `height/length medians: humilis ${hum.toFixed(2)}, mediocris ${med.toFixed(2)}, congestus ${tower.toFixed(2)}`,
  );
  check('stretched along the wind', stretched / fair > 0.85, `${((stretched / fair) * 100).toFixed(0)}% longer along the drift than across`);
  check('no lobe is stretched upward', spikes === 0, `${spikes} lobes taller than wide`);
  check(
    'one continuous body',
    loose === 0 && floating === 0,
    `${loose}/${lobes} big lobes without a neighbour overlapping by half a radius, ${floating}/${smalls} small lobes not sunk in`,
  );
  check(
    'bases span 1 to 3.5 km, one line per district',
    lowBase < 1100 && highBase > 3300 && (spreads[spreads.length >> 1] ?? 1e9) < 200,
    `${lowBase.toFixed(0)}..${highBase.toFixed(0)} m, median spread in a 2 km cell ${(spreads[spreads.length >> 1] ?? 0).toFixed(0)} m`,
  );
}

// -- the underside, and the sky right overhead ----------------------------------------

{
  // How far render/clouds.ts's `LUMP` moves a corner along its radius, either way.
  const LUMP = 0.08;
  // The highest of a detail-2 icosphere's lowest rings of corners, as the mesh builds it.
  const ico = new THREE.IcosahedronGeometry(1, 2).getAttribute('position');
  let lowRing = -1;
  for (let v = 0; v < ico.count; v++) if (ico.getY(v) < -0.84) lowRing = Math.max(lowRing, ico.getY(v));
  const N = 48;
  const shares: number[] = [];
  let hovering = 0;
  let lobes = 0;
  let widest = 0;
  let widestAt = '';
  for (const seed of SEEDS) {
    const set = cloudSet(seed);
    for (let i = 0; i < set.count; i++) {
      if (set.deck[i] !== CloudDeck.Low || cloudGrow(set, i, 0) < 1) continue;
      const o0 = i * CLOUD_SLOTS * BLOB_FLOATS;
      let along = 0;
      for (let j = 0; j < CLOUD_SLOTS; j++) {
        const o = o0 + j * BLOB_FLOATS;
        if (set.blobs[o + 3]! <= 0) continue;
        along = Math.max(along, Math.hypot(set.blobs[o]!, set.blobs[o + 2]!) + Math.max(set.blobs[o + 3]!, set.blobs[o + 5]!));
        if (j >= CLOUD_BIG_SLOTS) continue;
        // A big lobe's lowest rings are pressed into the base whatever the lump, or its
        // bottom stands well clear of it: never a face a few metres over another's cut.
        lobes++;
        const cy = set.blobs[o + 1]!;
        const ry = set.blobs[o + 4]!;
        const clamped = cy + lowRing * (1 - LUMP) * ry <= 0;
        const clear = cy - (1 + LUMP) * ry > Math.max(25, 0.15 * ry);
        if (!clamped && !clear) hovering++;
      }
      // From right under it: the flat cut against the whole outline the cloud shows.
      const reach = set.reach[i]!;
      let cut = 0;
      let outline = 0;
      for (let a = 0; a < N; a++) {
        for (let b = 0; b < N; b++) {
          const px = ((a + 0.5) / N * 2 - 1) * reach;
          const pz = ((b + 0.5) / N * 2 - 1) * reach;
          let inCut = false;
          let inOutline = false;
          for (let j = 0; j < CLOUD_SLOTS && !(inCut && inOutline); j++) {
            const o = o0 + j * BLOB_FLOATS;
            if (set.blobs[o + 3]! <= 0) continue;
            const dx = px - set.blobs[o]!;
            const dz = pz - set.blobs[o + 2]!;
            const c = set.blobs[o + 6]!;
            const s = set.blobs[o + 7]!;
            const lx = (c * dx + s * dz) / set.blobs[o + 3]!;
            const lz = (-s * dx + c * dz) / set.blobs[o + 5]!;
            const cy = set.blobs[o + 1]!;
            const ry = set.blobs[o + 4]!;
            // Widest at its centre's height, or at the base if the centre is below it.
            const ly = (Math.max(cy, 0) - cy) / ry;
            if (lx * lx + lz * lz + ly * ly < 1 && cy + ry > 0) inOutline = true;
            if (cy < ry && lx * lx + lz * lz + (cy / ry) ** 2 < 1) inCut = true;
          }
          if (inCut) cut++;
          if (inOutline) outline++;
        }
      }
      shares.push(cut / Math.max(1, outline));
      const span = (2 * Math.atan(along / set.base[i]!) * 180) / Math.PI;
      if (span > widest) {
        widest = span;
        widestAt = `${(2 * along / 1000).toFixed(1)} km on a ${(set.base[i]! / 1000).toFixed(1)} km base`;
      }
    }
  }
  shares.sort((a, b) => a - b);
  const median = shares[shares.length >> 1] ?? 1;
  const most = shares[shares.length - 1] ?? 1;
  check(
    'the base is a flat core inside the outline, not the whole underside',
    median < 0.8 && most < 0.85,
    `flat cut ${(median * 100).toFixed(0)}% of the outline seen from under the median cloud, ${(most * 100).toFixed(0)}% at most`,
  );
  check(
    'no lobe hovers just over the base (a depth fight with its neighbour\'s cut)',
    hovering === 0,
    `${hovering}/${lobes} big lobes with a bottom neither pressed into the base nor clear of it`,
  );
  check(
    'no cloud is a ceiling: from right under it, none spans much over 100 degrees',
    widest < 110,
    `widest ${widest.toFixed(0)} degrees, ${widestAt}`,
  );
}

// -- the decks: a second level, on its own wind ----------------------------------------

{
  let mids = 0;
  let lowTop = 0;
  let midBase = Infinity;
  let midBaseHigh = 0;
  let thickest = 0;
  let shortest = Infinity;
  for (const seed of SEEDS) {
    const set = cloudSet(seed);
    for (let i = 0; i < set.count; i++) {
      if (cloudGrow(set, i, 0) < 1) continue;
      if (set.deck[i] === CloudDeck.Low) {
        lowTop = Math.max(lowTop, set.base[i]! + set.top[i]!);
        continue;
      }
      mids++;
      midBase = Math.min(midBase, set.base[i]!);
      midBaseHigh = Math.max(midBaseHigh, set.base[i]!);
      thickest = Math.max(thickest, set.top[i]! / (2 * set.reach[i]!));
      shortest = Math.min(shortest, 2 * set.reach[i]!);
    }
  }
  check(
    'an altocumulus deck stands over the cumulus',
    mids > 0 && midBase > 4000 && midBaseHigh < 5700,
    `${mids} altocumulus over ${SEEDS.length} skies, bases ${midBase.toFixed(0)}..${midBaseHigh.toFixed(0)} m; cumulus tops to ${lowTop.toFixed(0)} m`,
  );
  check(
    'the altocumulus are thin rafts, not crumbs',
    thickest < 0.12 && shortest > 1000,
    `thickest ${thickest.toFixed(2)} of its span, shortest ${shortest.toFixed(0)} m across`,
  );

  // Seen from one place, the two decks slide across each other.
  const low = { x: 0, z: 0 };
  const mid = { x: 0, z: 0 };
  cloudDeckWind(42, CloudDeck.Low, low);
  cloudDeckWind(42, CloudDeck.Mid, mid);
  const shear = Math.hypot(mid.x - low.x, mid.z - low.z);
  const veer = (Math.acos((low.x * mid.x + low.z * mid.z) / (Math.hypot(low.x, low.z) * Math.hypot(mid.x, mid.z))) * 180) / Math.PI;
  check(
    'the decks shear: the high one faster and veered',
    Math.hypot(mid.x, mid.z) > Math.hypot(low.x, low.z) * 1.5 && veer > 20 && shear > 8,
    `low ${Math.hypot(low.x, low.z).toFixed(0)} m/s, high ${Math.hypot(mid.x, mid.z).toFixed(0)} m/s veered ${veer.toFixed(0)} deg, ${shear.toFixed(1)} m/s between them`,
  );

  // The sky straight overhead, by deck: a driver looking up sees something there.
  let lowOver = 0;
  let anyOver = 0;
  const N = 20_000;
  for (const seed of SEEDS) {
    const set = cloudSet(seed);
    for (let k = 0; k < N; k++) {
      const x = wrap(k * 7919.7 + seed * 131);
      const z = wrap(k * 104_729.3 - seed * 131);
      const cover = cloudCoverAlong(set, 0, CLOUD_NO_SHIFT, x, 0, z, 0, 0);
      if (cover > 0) anyOver++;
      if (cover >= 0.8) lowOver++;
    }
  }
  console.log(
    `    overhead: a cumulus ${((lowOver / (N * SEEDS.length)) * 100).toFixed(1)}%, any cloud ${((anyOver / (N * SEEDS.length)) * 100).toFixed(1)}% of the time`,
  );
}

// -- cover, and how uneven it is ------------------------------------------------------

{
  let sum = 0;
  for (const seed of SEEDS) {
    const cover = verticalCover(cloudSet(seed), 0, 20_000, seed * 131);
    sum += cover;
    console.log(`    seed ${String(seed).padStart(4)}   sky over a cloud ${(cover * 100).toFixed(1)}%`);
  }
  const cover = sum / SEEDS.length;
  // Two decks: the cumulus alone keep to 10-15% (the overhead line above), the high deck
  // about doubles what is over a driver's head without closing the sky.
  check('a sparse fair-weather sky', cover > 0.18 && cover < 0.32, `${(cover * 100).toFixed(1)}% of the ground has a cloud overhead, both decks`);

  // Over 3 km stretches of sky (about what one look up takes in) the cover has to range.
  const WINDOW_M = 3000;
  const STEP_M = 100;
  const PER_SIDE = WINDOW_M / STEP_M;
  const covers: number[] = [];
  for (const seed of SEEDS) {
    const set = cloudSet(seed);
    for (let wz = 0; wz < 8; wz++) {
      for (let wx = 0; wx < 8; wx++) {
        let inside = 0;
        for (let j = 0; j < PER_SIDE; j++) {
          for (let i = 0; i < PER_SIDE; i++) {
            const x = wrap(wx * WINDOW_M * 2.3 + i * STEP_M + seed * 1111);
            const z = wrap(wz * WINDOW_M * 2.3 + j * STEP_M - seed * 777);
            if (cloudCoverAlong(set, 0, CLOUD_NO_SHIFT, x, 0, z, 0, 0) > 0) inside++;
          }
        }
        covers.push(inside / (PER_SIDE * PER_SIDE));
      }
    }
  }
  covers.sort((a, b) => a - b);
  const clear = covers.filter((c) => c < 0.03).length / covers.length;
  const cloudy = covers.filter((c) => c > 0.25).length / covers.length;
  console.log(
    `    ${covers.length} stretches of 3 km: ${(clear * 100).toFixed(0)}% near-clear (<3%), ` +
      `median ${((covers[covers.length >> 1] ?? 0) * 100).toFixed(0)}%, ${(cloudy * 100).toFixed(0)}% over a quarter`,
  );
  check('some stretches of sky are near-clear', clear > 0.1, `${(clear * 100).toFixed(0)}% of 3 km stretches under 3% cover`);
  check('and some are properly cloudy', cloudy > 0.06, `${(cloudy * 100).toFixed(0)}% of 3 km stretches over 25% cover`);

  // Clumped, not sprinkled: cloud counts in 4 km squares vary more than a Poisson
  // scatter's would (whose variance equals its mean). With few wide clouds a square holds
  // one or two, so the ratio is smaller than it was with many small ones; the districts'
  // clear and crowded stretches above carry most of the unevenness now.
  const counts: number[] = [];
  for (const seed of SEEDS) {
    const set = cloudSet(seed);
    const side = 4096;
    const n = CLOUD_PERIOD_M / side;
    const grid = new Array<number>(n * n).fill(0);
    for (let i = 0; i < set.count; i++) {
      if (cloudGrow(set, i, 0) <= 0) continue;
      grid[Math.floor(set.z[i]! / side) * n + Math.floor(set.x[i]! / side)]!++;
    }
    counts.push(...grid);
  }
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  const variance = counts.reduce((a, b) => a + (b - mean) ** 2, 0) / counts.length;
  check('clouds come in groups', variance / mean > 1.5, `variance/mean ${(variance / mean).toFixed(1)} over 4 km squares (1 is an even scatter)`);
}

// -- every cloud has its shadow ----------------------------------------------------------

{
  for (const sun of SUNS) {
    let tested = 0;
    let shaded = 0;
    let soft = 0;
    let deep = 0;
    for (const seed of SEEDS) {
      const set = cloudSet(seed);
      for (let i = 0; i < set.count && tested < 400 * (SEEDS.indexOf(seed) + 1); i += 7) {
        if (cloudGrow(set, i, 0) < 1) continue;
        // The middle of the cloud's first blob, and the ground point whose ray to the
        // sun passes through it.
        const o = i * CLOUD_SLOTS * BLOB_FLOATS;
        const height = set.base[i]! + Math.max(set.blobs[o + 1]!, 0) + 1;
        const cx = set.x[i]! + set.blobs[o]!;
        const cz = set.z[i]! + set.blobs[o + 2]!;
        const gx = wrap(cx - height * sun.x);
        const gz = wrap(cz - height * sun.z);
        tested++;
        if (cloudCoverAlong(set, 0, CLOUD_NO_SHIFT, gx, 0, gz, sun.x, sun.z) >= set.opacity[i]!) shaded++;
        if (set.reach[i]! > 250) {
          deep++;
          if (cloudShadeAlong(set, 0, CLOUD_NO_SHIFT, gx, 0, gz, sun.x, sun.z) > IN_SHADOW * set.opacity[i]!) soft++;
        }
      }
    }
    check(
      `every cloud has its shadow up the ray (${sun.label})`,
      shaded === tested,
      `${shaded}/${tested} cloud centres shade the ground they stand over along the sun`,
    );
    check(
      `and the blurred shade agrees (${sun.label})`,
      soft / deep > 0.97,
      `${soft}/${deep} clouds over 500 m deep in their own shade`,
    );
  }

  // The penumbra: along diagonals, every rise from open sun to a shadow's full depth,
  // measured from 10% to 90% of that shadow's own depth (a raft's is shallower than a
  // tower's).
  const widths: number[] = [];
  let groundShaded = 0;
  let samples = 0;
  for (const seed of SEEDS) {
    const set = cloudSet(seed);
    for (let line = 0; line < 12; line++) {
      let run: { d: number; s: number }[] | null = null;
      let previous = 0;
      for (let d = 0; d < 20_000; d += 5) {
        const x = wrap(d * 0.8 + line * 3011 + seed * 97);
        const z = wrap(d * 0.6 - line * 1999);
        const shade = cloudShadeAlong(set, 0, CLOUD_NO_SHIFT, x, 0, z, SUNS[0]!.x, SUNS[0]!.z);
        samples++;
        if (shade > IN_SHADOW * 0.6) groundShaded++;
        if (shade < 0.02) run = [];
        else if (run !== null && shade < previous - 1e-9) {
          // The top of a rise out of open sun.
          if (previous > 0.4) {
            const low = run.find((p) => p.s >= previous * 0.1);
            const high = run.find((p) => p.s >= previous * 0.9);
            if (low && high) widths.push(high.d - low.d);
          }
          run = null;
        }
        run?.push({ d, s: shade });
        previous = shade;
      }
    }
  }
  widths.sort((a, b) => a - b);
  const median = widths[widths.length >> 1] ?? 0;
  check(
    'the edge of a shadow is a penumbra, not a line',
    widths.length > 50 && median > 90 && median < 260,
    `10-90% over ${median} m (median of ${widths.length} edges)`,
  );
  const shadedShare = groundShaded / samples;
  check(
    'shade comes in patches, under a sparse sky',
    shadedShare > 0.06 && shadedShare < 0.25,
    `${(shadedShare * 100).toFixed(1)}% of the ground in shade at noon`,
  );
}

// -- a storm --------------------------------------------------------------------------

{
  let fairCount = 0;
  let stormCount = 0;
  let fairCover = 0;
  let stormCover = 0;
  for (const seed of SEEDS) {
    const set = cloudSet(seed);
    for (let i = 0; i < set.count; i++) {
      if (cloudGrow(set, i, 0) > 0) fairCount++;
      if (cloudGrow(set, i, 1) > 0) stormCount++;
    }
    fairCover += verticalCover(set, 0, 4000, 17);
    stormCover += verticalCover(set, 1, 4000, 17);
  }
  check(
    'a storm brings more clouds, and bigger',
    stormCount > fairCount * 1.6 && stormCover > fairCover * 2.2,
    `${stormCount} clouds against ${fairCount}, cover ${((stormCover / SEEDS.length) * 100).toFixed(0)}% against ${((fairCover / SEEDS.length) * 100).toFixed(0)}%`,
  );
}

// -- standing still, the light still changes --------------------------------------------

{
  // A parked car at eight spots under each sky, for an hour: most of them see shade
  // arrive and leave. (One spot can sit under a clear district all hour, and with clouds
  // this rare a spot under a cloudy one sees a raft or two pass, not a procession.)
  const STEP_S = 2;
  const SPAN_S = 3600;
  const SPOTS = 8;
  let changes = 0;
  let visited = 0;
  for (const seed of SEEDS) {
    for (let spot = 0; spot < SPOTS; spot++) {
      let previous = -1;
      let here = 0;
      for (let t = 0; t < SPAN_S; t += STEP_S) {
        const shaded = cloudShadowShadeAt(seed, 12_345 + spot * 7_777, 0, -67_890 + spot * 5_311, t, 0.2, 0.1, 0) > IN_SHADOW ? 1 : 0;
        if (previous >= 0 && shaded !== previous) here++;
        previous = shaded;
      }
      changes += here;
      if (here >= 2) visited++;
    }
  }
  const spots = SEEDS.length * SPOTS;
  check(
    'standing still, shade comes and goes',
    visited > spots / 2 && changes > spots * 2,
    `${visited}/${spots} parked spots see shade come and go in an hour, ${(changes / spots).toFixed(1)} changes each, ${CLOUD_DRIFT_MPS} m/s wind`,
  );
}

// -- the night gate -----------------------------------------------------------

{
  check(
    'the shade is off at night',
    cloudShadowStrength(0) === 0 && cloudShadowStrength(0.11) === 0,
    'strength 0 below the mirage twilight band',
  );
  check(
    'and full in daylight',
    Math.abs(cloudShadowStrength(1) - CLOUD_DARKEN_MAX) < 1e-9,
    `strength ${cloudShadowStrength(1).toFixed(2)} at noon`,
  );
}

// -- the rebase, which is the whole reason the pan uniform exists --------------

{
  const pan = { x: 0, z: 0 };
  const shift = new Float64Array(2 * CLOUD_DECKS);
  let disagree = 0;
  let worst = 0;
  const set = cloudSet(42);
  for (let i = 0; i < 4000; i++) {
    // A plausible frame: the origin on its 1 km lattice out at the far end of the
    // road, the ground point somewhere in the 2.4 km of world alive around it.
    const originX = FAR_FROM_CENTRE + Math.floor(i / 7) * 1000;
    const originZ = -FAR_FROM_CENTRE + Math.floor(i / 11) * 1000;
    const relX = ((i * 37) % 2400) - 1200;
    const relZ = ((i * 53) % 2400) - 1200;
    const t = (i % 900) * 3.1;
    const absolute = cloudShadowShadeAt(42, originX + relX, 20, originZ + relZ, t, 0.3, -0.2, 0);
    // The shader's path: the scene-relative point plus the reduced pan.
    cloudPan(42, t, originX, originZ, pan);
    const shaderSide = cloudShadeAlong(set, 0, cloudDeckShift(42, t, shift), wrap(relX + pan.x), 20, wrap(relZ + pan.z), 0.3, -0.2);
    const diff = Math.abs(absolute - shaderSide);
    if (diff > 1e-6) disagree++;
    worst = Math.max(worst, diff);
  }
  // A silhouette edge sits on one exact metre; f64 rounding of the two paths can put a
  // sample a nanometre either side of it, once in a great while.
  check(
    'a rebase does not move the clouds',
    disagree <= 2,
    `${disagree} of 4000 frames at 386 km disagree (worst ${worst.toExponential(1)})`,
  );

  cloudPan(42, 1_000_000, FAR_FROM_CENTRE, FAR_FROM_CENTRE, pan);
  check(
    'the shader never sees a road-sized coordinate',
    pan.x >= 0 && pan.x < CLOUD_PERIOD_M && pan.z >= 0 && pan.z < CLOUD_PERIOD_M,
    `pan ${pan.x.toFixed(0)}, ${pan.z.toFixed(0)} m inside a ${(CLOUD_PERIOD_M / 1000).toFixed(1)} km period`,
  );
}

// -- the shipped per-frame path -----------------------------------------------

{
  const pan = { x: 0, z: 0 };
  const before = cloudShadowFrame().elapsed;
  const FRAMES = 120;
  const DT = 1 / 60;
  for (let i = 0; i < FRAMES; i++) advanceCloudShadows(42, DT, 1, FAR_FROM_CENTRE, 12_000);
  const frame = cloudShadowFrame();
  cloudPan(42, frame.elapsed, FAR_FROM_CENTRE, 12_000, pan);
  check(
    'the frame uniforms are the pan',
    Math.abs(frame.panX - Math.fround(pan.x)) < 1e-2 && Math.abs(frame.panZ - Math.fround(pan.z)) < 1e-2,
    `elapsed ${frame.elapsed.toFixed(2)} s, pan ${frame.panX.toFixed(1)}, ${frame.panZ.toFixed(1)} m`,
  );
  check(
    'dt drives the drift, not the wall clock',
    Math.abs(frame.elapsed - before - FRAMES * DT) < 1e-9,
    `${FRAMES} frames of ${(DT * 1000).toFixed(1)} ms gave ${(frame.elapsed - before).toFixed(3)} s`,
  );
  advanceCloudShadows(42, 0, 0, 0, 0);
  check('a dark frame does no work at all', cloudShadowFrame().strength === 0, 'strength 0 disables the whole block');
}

// -- the injection, against the installed three -------------------------------

{
  // The real ground-material stack: the comic patch (terrain, vista) or the ground
  // spotlight patch (road ribbon) first, then this one on top of it. Applied TWICE
  // on purpose — the terrain material factory runs twice and the road hands its
  // asphalt finish out by name, so a second call has to be a no-op.
  const material = applyCloudShadow(
    applyCloudShadow(
      applyComicShading(new THREE.MeshStandardMaterial({ vertexColors: true })),
    ),
  );
  const shader = {
    uniforms: {} as Record<string, THREE.IUniform>,
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
    defines: {},
  } as unknown as WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, null as unknown as THREE.WebGLRenderer);

  const count = (haystack: string, needle: string): number =>
    haystack.split(needle).length - 1;
  check(
    'the varying is declared exactly once',
    count(shader.vertexShader, 'varying float vCloudShade;') === 1 &&
      count(shader.fragmentShader, 'varying float vCloudShade;') === 1,
    'applied twice, injected once',
  );
  // THE COST CHECK. The shade ran in the fragment shader once and cost 34 ms a frame on
  // the machine that reported it: the ground shader is near the register limit and
  // spilled. The map is read per vertex; nothing in the fragment stage may sample it.
  check(
    'the map is read per VERTEX, never per fragment',
    count(shader.vertexShader, 'float cloudShade(') === 1 &&
      count(shader.vertexShader, '? cloudShade( cloudWorld )') === 1 &&
      count(shader.fragmentShader, 'cloudShade(') === 0 &&
      count(shader.fragmentShader, 'uCloudMap') === 0 &&
      count(shader.fragmentShader, 'wetHash(') === 0 &&
      count(shader.fragmentShader, 'vCloudShade * uCloudStrength') === 1 &&
      count(shader.vertexShader, 'uCloudStrength > 0.0') === 1,
    'one vertex tap (skipped at night), fragment multiply',
  );
  check(
    'the splice points still exist in three ' + THREE.REVISION,
    shader.vertexShader.includes('? cloudShade( cloudWorld )') &&
      count(shader.fragmentShader, '#include <opaque_fragment>') === 1,
    'worldpos_vertex and opaque_fragment both found',
  );
  check(
    'it chained instead of replacing',
    shader.fragmentShader.includes('uComicBands') &&
      shader.uniforms.uComicBands !== undefined &&
      shader.uniforms.uCloudMap !== undefined,
    'comic uniforms and cloud uniforms both bound',
  );
  check(
    'the program key names both patches',
    material.customProgramCacheKey().includes('comic') &&
      material.customProgramCacheKey().includes('cloud-shadow'),
    material.customProgramCacheKey(),
  );

  // AND THE OTHER GROUND STACK. The road ribbon, its bed and its markings carry
  // `applyGroundSpotlightNormals`, which rewrites the stock lighting chunk instead
  // of the output — a different splice. Checked here rather than trusted, because a
  // patch that quietly replaced the spotlight one would leave headlamps flat on every
  // uphill road in the game.
  const road = applyCloudShadow(
    applyGroundSpotlightNormals(new THREE.MeshStandardMaterial({ vertexColors: true })),
  );
  const roadShader = {
    uniforms: {} as Record<string, THREE.IUniform>,
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
    defines: {},
  } as unknown as WebGLProgramParametersWithUniforms;
  road.onBeforeCompile(roadShader, null as unknown as THREE.WebGLRenderer);
  check(
    'the road ribbon keeps its spotlight patch',
    count(roadShader.fragmentShader, 'groundSlopeNormal( geometryPosition') === 1 &&
      count(roadShader.fragmentShader, 'vCloudShade * uCloudStrength') === 1 &&
      roadShader.uniforms.uCloudMap !== undefined,
    'slope-corrected spotlights and cloud shade in one program',
  );
}

// ---------------------------------------------------------------------------
// 2. the weather schedule
// ---------------------------------------------------------------------------

console.log('\nweather schedule');
{
  const channels = (): WeatherChannels => ({
    haze: 0, dust: 0, front: 0, cloud: 0, rain: 0, wet: 0,
    wind: 0, drift: 0, heat: 0, halo: 0, clarity: 0,
  });
  const a = channels();
  const b = channels();
  let impure = 0;
  let outOfRange = 0;
  let active = 0;
  let samples = 0;
  let repeats = 0;
  const kinds: Record<string, number> = {};
  for (const seed of SEEDS) {
    for (let t = 0; t < 6 * 3600; t += 7.3) {
      weatherAt(seed, t, a);
      weatherAt(seed, t, b);
      samples++;
      let any = 0;
      for (const k of Object.keys(a) as (keyof WeatherChannels)[]) {
        if (a[k] !== b[k]) impure++;
        if (!(a[k] >= 0 && a[k] <= 1)) outOfRange++;
        any = Math.max(any, a[k]);
      }
      if (any > 0.05) active++;
    }
    for (let slot = 0; slot < 400; slot++) {
      const kind = weatherKindOfSlot(seed, slot);
      kinds[kind] = (kinds[kind] ?? 0) + 1;
      if (kind !== 'clear' && kind === weatherKindOfSlot(seed, slot - 1)) repeats++;
    }
  }
  check('pure function of seed and clock', impure === 0, `${impure} disagreements`);
  check('every channel inside 0..1', outOfRange === 0, `${outOfRange} out of range`);
  const share = active / samples;
  check('weather present about half the time', share > 0.35 && share < 0.65, `${(share * 100).toFixed(0)}% of play`);
  check('never the same episode twice running', repeats === 0, `${repeats} repeats`);
  console.log(`        kinds over ${SEEDS.length * 400} slots: ${JSON.stringify(kinds)}`);
  // Slot edges are clear sky, so neighbouring episodes never cut into each other.
  let edge = 0;
  for (const seed of SEEDS) {
    for (let slot = 0; slot < 200; slot++) {
      weatherAt(seed, slot * WEATHER_SLOT_S + 1e-3, a);
      for (const k of Object.keys(a) as (keyof WeatherChannels)[]) edge = Math.max(edge, a[k]);
    }
  }
  check('slot boundaries are clear sky', edge < 1e-6, `max channel ${edge.toExponential(1)}`);
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
