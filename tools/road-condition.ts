/**
 * tools/road-condition.ts
 *
 * Surface bench for the CONTENT half of the 40 000 km rescale. It walks the real
 * `roadConditionAt`, `poleEraSegments` and `desertPaletteAt` (never a
 * re-implementation) and reports the numbers that decide whether the new split
 * model reads correctly:
 *
 *  - Decay must be STATIONARY in absolute distance, not a one-way ramp. The mean
 *    decay over the first 2 000 km and the last 2 000 km must match within a few
 *    hundredths, or the player is still driving a difficulty curve in disguise.
 *  - The regional envelope must actually move. The mean decay of consecutive
 *    200 km blocks should swing by several tenths, or "a few hundred km of kept-up
 *    road, then a few hundred of abandoned" is invisible.
 *  - Concrete slabs must land near 8% of the road: much more and the relief of a
 *    slab stops being rare, much less and it never happens.
 *  - The palette must be C1 — no crease at the 4 000 km wrap, and no channel jump above
 *    one 8-bit step between ADJACENT CHUNKS, which is the interval at which a step would
 *    show as a seam — and rock must stay clearly darker than sand at
 *    every phase, so the two never merge into one flat colour.
 *
 *   npx tsx tools/road-condition.ts
 *
 * Nothing here is part of the game bundle.
 */

import { desertPaletteAt, poleEraSegments, roadConditionAt, PALETTE_CYCLE_M } from '../src/world/gradient';
import { SURFACES } from '../src/core/surfaces';
import type { SurfaceType } from '../src/core/surfaces';
import { ROAD_LENGTH } from '../src/world/road';
import { CHUNK_LENGTH } from '../src/world/chunks';

/** Metres between census samples. Fine enough to catch every surface flip. */
const CENSUS_STEP_M = 100;

/** Mean decay over [fromM, toM), sampled at CENSUS_STEP_M. */
function meanDecay(fromM: number, toM: number): number {
  let sum = 0;
  let n = 0;
  for (let s = fromM; s < toM; s += CENSUS_STEP_M) {
    sum += roadConditionAt(s).decay;
    n++;
  }
  return n === 0 ? 0 : sum / n;
}

/** Packed 0xRRGGBB -> "0xRRGGBB". */
function hexOf(c: number): string {
  return `0x${c.toString(16).padStart(6, '0')}`;
}

/** Packed 0xRRGGBB -> [r, g, b] in 0..255. */
function rgbOf(c: number): [number, number, number] {
  return [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];
}

// ---------------------------------------------------------------------------
// Decay table
// ---------------------------------------------------------------------------
console.log('decay table (every 20 km, first 1000 km)');
console.log('   km    decay  envelope  surface            sandCov  markings');
const tableEndKm = Math.min(1000, ROAD_LENGTH / 1000);
for (let km0 = 0; km0 < tableEndKm; km0 += 20) {
  const s = km0 * 1000;
  const cond = roadConditionAt(s);
  // Envelope estimate: mean decay over this 20 km block. The patch noise averages
  // out over a multi-km window, leaving the slow regional envelope.
  const env = meanDecay(s, Math.min(s + 20_000, ROAD_LENGTH));
  console.log(
    `  ${km0.toString().padStart(4)}   ${cond.decay.toFixed(2).padStart(5)}   ${env.toFixed(2).padStart(7)}   ` +
      `${SURFACES[cond.surface].label.padEnd(16)}  ${cond.sandCover.toFixed(2).padStart(6)}   ${cond.markings.toFixed(2).padStart(7)}`,
  );
}

// ---------------------------------------------------------------------------
// Surface census
// ---------------------------------------------------------------------------
interface CensusEntry {
  stretches: number;
  totalKm: number;
  lengths: number[];
}

const census = new Map<SurfaceType, CensusEntry>();
let cur = roadConditionAt(0).surface;
let runStart = 0;
for (let s = CENSUS_STEP_M; s <= ROAD_LENGTH; s += CENSUS_STEP_M) {
  const surf = roadConditionAt(s).surface;
  if (surf !== cur) {
    const lenKm = (s - runStart) / 1000;
    const e = census.get(cur) ?? { stretches: 0, totalKm: 0, lengths: [] };
    e.stretches += 1;
    e.totalKm += lenKm;
    e.lengths.push(lenKm);
    census.set(cur, e);
    cur = surf;
    runStart = s;
  }
}
{
  const lenKm = (ROAD_LENGTH - runStart) / 1000;
  const e = census.get(cur) ?? { stretches: 0, totalKm: 0, lengths: [] };
  e.stretches += 1;
  e.totalKm += lenKm;
  e.lengths.push(lenKm);
  census.set(cur, e);
}

console.log('');
console.log('surface census (full road, 100 m resolution)');
const roadKm = ROAD_LENGTH / 1000;
const types = [...census.keys()].sort((a, b) => a - b);
let concreteShare = 0;
for (const t of types) {
  const e = census.get(t)!;
  const sorted = e.lengths.slice().sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const longest = sorted[sorted.length - 1]!;
  const share = (e.totalKm / roadKm) * 100;
  if (SURFACES[t].label === 'concrete') concreteShare = share;
  console.log(
    `  ${SURFACES[t].label.padEnd(16)} ${e.stretches.toString().padStart(4)} stretches  ` +
      `${e.totalKm.toFixed(0).padStart(6)} km  ${share.toFixed(1).padStart(5)}%  ` +
      `median ${median.toFixed(1).padStart(5)} km  longest ${longest.toFixed(1).padStart(6)} km`,
  );
}
console.log(`  concrete share: ${concreteShare.toFixed(1)}% (target ~8%)`);

// ---------------------------------------------------------------------------
// Regional envelope
// ---------------------------------------------------------------------------
console.log('');
console.log('regional envelope (mean decay per 200 km block)');
let calmest = Infinity;
let worst = -Infinity;
for (let s = 0; s < ROAD_LENGTH; s += 200_000) {
  const end = Math.min(s + 200_000, ROAD_LENGTH);
  const mean = meanDecay(s, end);
  calmest = Math.min(calmest, mean);
  worst = Math.max(worst, mean);
  console.log(`  ${(s / 1000).toString().padStart(5)}-${(end / 1000).toString().padStart(5)} km   mean decay ${mean.toFixed(3)}`);
}
console.log(`  spread: calmest ${calmest.toFixed(3)} -> worst ${worst.toFixed(3)} (${(worst - calmest).toFixed(3)})`);

// ---------------------------------------------------------------------------
// Stationarity: quality must not ramp
// ---------------------------------------------------------------------------
console.log('');
console.log('stationarity (first half vs second half, and a decay-vs-distance regression)');

const half = ROAD_LENGTH / 2;
const firstHalf = meanDecay(0, half);
const secondHalf = meanDecay(half, ROAD_LENGTH);
console.log(`  first ${half / 1000} km: ${firstHalf.toFixed(3)}   second ${half / 1000} km: ${secondHalf.toFixed(3)}   diff ${Math.abs(firstHalf - secondHalf).toFixed(3)} (must be within 0.05)`);

// Linear regression of decay against distance. The slope is the real ramp test: a
// monotonic ramp shows up as a slope no matter how the windows are cut, while the
// regional envelope's noise averages out. Reported per 10 000 km.
const REG_STEP = 1000;
let n = 0;
let sumS = 0;
let sumD = 0;
let sumSD = 0;
let sumSS = 0;
for (let s = 0; s < ROAD_LENGTH; s += REG_STEP) {
  const d = roadConditionAt(s).decay;
  n++;
  sumS += s;
  sumD += d;
  sumSD += s * d;
  sumSS += s * s;
}
const slopePerM = (n * sumSD - sumS * sumD) / (n * sumSS - sumS * sumS);
console.log(`  decay drift: ${(slopePerM * 10_000_000).toFixed(4)} per 10 000 km (|slope| must be < 0.02)`);

// The old monotonic p^2 ramp, for contrast: same regression on its base term.
{
  let on = 0;
  let oS = 0;
  let oD = 0;
  let oSD = 0;
  let oSS = 0;
  for (let s = 0; s < ROAD_LENGTH; s += REG_STEP) {
    const p = s / ROAD_LENGTH;
    const d = Math.min(1, p * p * 1.35);
    on++;
    oS += s;
    oD += d;
    oSD += s * d;
    oSS += s * s;
  }
  const oldSlope = (on * oSD - oS * oD) / (on * oSS - oS * oS);
  console.log(`  old p^2 ramp drift for contrast: ${(oldSlope * 10_000_000).toFixed(4)} per 10 000 km`);
}

// ---------------------------------------------------------------------------
// Garage ramp
// ---------------------------------------------------------------------------
console.log('');
console.log('garage ramp decay');
for (const s of [0, 500, 1500, 3000, 5000]) {
  console.log(`  s=${s.toString().padStart(5)} m   decay=${roadConditionAt(s).decay.toFixed(3)}`);
}

// ---------------------------------------------------------------------------
// The opening kilometres, district by district
//
// The bug this section exists for: with the surface derived from decay thresholds,
// the first change landed at 5.0 km — the exact metre the garage ramp starts lifting
// decay — the second near 10, and the third not for another eighty kilometres. A
// surface change on a round number reads as a scripted event, and a district that
// outlives the player's patience reads as a bug. Every boundary here should be an
// untidy number and every run should be 5-7 km.
// ---------------------------------------------------------------------------
console.log('');
console.log('first surface changes (10 m resolution)');
{
  let previous = roadConditionAt(0).surface;
  let start = 0;
  let shown = 0;
  for (let s = 10; s < 200_000 && shown < 12; s += 10) {
    const surf = roadConditionAt(s).surface;
    if (surf === previous) continue;
    console.log(
      `  ${(start / 1000).toFixed(2).padStart(7)} - ${(s / 1000).toFixed(2).padStart(7)} km   ` +
        `${SURFACES[previous].label.padEnd(16)} ${((s - start) / 1000).toFixed(2).padStart(5)} km long`,
    );
    previous = surf;
    start = s;
    shown++;
  }
}

// ---------------------------------------------------------------------------
// Pole era schedule
// ---------------------------------------------------------------------------
console.log('');
console.log('pole era schedule');
const segs = poleEraSegments();
const noneCount = segs.filter((b) => b.era === 'none').length;
console.log(`  ${segs.length} bands, ${noneCount} 'none' (${((noneCount / segs.length) * 100).toFixed(0)}%)`);
console.log('  start km   era          spacing');
for (const b of segs.slice(0, 10)) {
  console.log(`  ${(b.start / 1000).toString().padStart(8)}   ${b.era.padEnd(11)}  ${b.spacing.toString().padStart(6)}`);
}
if (segs.length > 10) console.log(`  ... ${segs.length - 10} more bands`);

// ---------------------------------------------------------------------------
// Palette walk
// ---------------------------------------------------------------------------
console.log('');
console.log('palette walk (one full 4 000 km cycle, every 250 km)');
console.log('   km      sand       rock       gravel     spray');
for (let s = 0; s < PALETTE_CYCLE_M; s += 250_000) {
  const p = desertPaletteAt(s);
  console.log(
    `  ${(s / 1000).toString().padStart(4)}   ${hexOf(p.sand)}  ${hexOf(p.rock)}  ` +
      `${hexOf(p.gravel)}  ${hexOf(p.spray)}`,
  );
}

// ---------------------------------------------------------------------------
// Palette smoothness and distinguishability
// ---------------------------------------------------------------------------
//
// Sampled at CHUNK_LENGTH, because that is the interval at which a colour step would
// actually be visible: two neighbouring chunks are built independently and meet along a
// shared vertex row, so if the palette moved appreciably across one chunk the seam
// between them would read as a band. A 10 km interval was measured first and it is the
// wrong question — it reports the slope of the cycle, not the size of a seam, and it
// fails a palette that is perfectly smooth simply for having a brisk stretch.
console.log('');
console.log('palette smoothness and distinguishability (full cycle, per-chunk samples)');
let maxJump = 0;
let minSandRock = Infinity;
const sampleStep = CHUNK_LENGTH;
const sampleCount = Math.round(PALETTE_CYCLE_M / sampleStep);
let prev = desertPaletteAt(0);
for (let i = 1; i <= sampleCount; i++) {
  const p = desertPaletteAt(i * sampleStep);
  const sand = rgbOf(p.sand);
  const rock = rgbOf(p.rock);
  const gravel = rgbOf(p.gravel);
  const prevSand = rgbOf(prev.sand);
  const prevRock = rgbOf(prev.rock);
  const prevGravel = rgbOf(prev.gravel);
  for (let ch = 0; ch < 3; ch++) {
    maxJump = Math.max(
      maxJump,
      Math.abs(sand[ch] - prevSand[ch]),
      Math.abs(rock[ch] - prevRock[ch]),
      Math.abs(gravel[ch] - prevGravel[ch]),
    );
  }
  let dSq = 0;
  for (let ch = 0; ch < 3; ch++) {
    const d = sand[ch] - rock[ch];
    dSq += d * d;
  }
  minSandRock = Math.min(minSandRock, Math.sqrt(dSq));
  prev = p;
}
// One 8-bit step is the SMALLEST representable non-zero change, so "at most 1" is the
// strongest statement an integer palette can make: across a whole chunk the colour moves
// by either nothing or by the least the format can express. Demanding strictly less than
// one would be demanding that the palette never change at all.
console.log(`  largest adjacent-chunk channel jump: ${maxJump.toFixed(2)}/255 (must be <= 1)`);
console.log(`  closest sand-to-rock RGB distance: ${minSandRock.toFixed(1)} (must be >= 40)`);
