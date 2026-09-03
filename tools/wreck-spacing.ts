#!/usr/bin/env npx tsx
/**
 * tools/wreck-spacing.ts
 *
 * Measures how far apart the bodies in a roadside wreck field stand, over every
 * wreck POI of several seeds, using the REAL layout (`layOutWreckField` in
 * world/poi.ts) and the REAL measured car footprints.
 *
 * The bug this exists for: each body used to draw its own arclength and lateral
 * offset independently, so nothing stopped two 4.6 m cars landing a metre apart —
 * and a static shell carries a solid box collider, so they were found standing
 * inside one another. Independent draws in a 16 x 12 m window overlap most of the
 * time once there are three of them; the numbers below are that rate against the
 * rejection-sampled layout's.
 *
 * A pair "overlaps" when the distance between their centres is less than the sum of
 * their circumscribed footprint radii — the conservative test, true at any yaw.
 *
 *   npx tsx tools/wreck-spacing.ts [seed ...]
 *
 * Nothing here is part of the game bundle.
 */
import { installAssetShim } from './assetshim';
import { carModelMeasure, preloadCarModels } from '../src/render/carmodel';
import { POI_SPACING, layOutWreckField, poiAt } from '../src/world/poi';
import { CAR_MODELS } from '../src/vehicle/carmodels';
import { hash01, pick } from '../src/core/rng';

// Loaders are constructed lazily inside render/carmodel.ts, so installing the shim
// here — after this module's imports have run — still precedes every asset fetch.
installAssetShim();
await preloadCarModels();

/** What shipped before the layout pass: two independent draws per body. */
const OLD_S_SPREAD = 16;
const OLD_LAT_SPREAD = 12;

interface Placed {
  readonly radius: number;
  readonly sDelta: number;
  readonly latDelta: number;
}

function oldLayout(variantSeed: number): Placed[] {
  const count = 1 + Math.floor(hash01(variantSeed, 10) * 3);
  const placed: Placed[] = [];
  for (let w = 0; w < count; w++) {
    const def = pick(CAR_MODELS, variantSeed, w, 10);
    const half = carModelMeasure(def.id).halfExtents;
    placed.push({
      radius: Math.hypot(half[0], half[2]),
      sDelta: (hash01(variantSeed, w, 11) - 0.5) * OLD_S_SPREAD,
      latDelta: (hash01(variantSeed, w, 12) - 0.5) * OLD_LAT_SPREAD,
    });
  }
  return placed;
}

interface Stats {
  fields: number;
  pairs: number;
  overlappingPairs: number;
  fieldsWithOverlap: number;
  worstOverlapM: number;
  worstGapM: number;
}

function measure(fields: readonly (readonly Placed[])[]): Stats {
  const stats: Stats = {
    fields: 0,
    pairs: 0,
    overlappingPairs: 0,
    fieldsWithOverlap: 0,
    worstOverlapM: 0,
    worstGapM: Infinity,
  };
  for (const field of fields) {
    stats.fields++;
    let fieldOverlapped = false;
    for (let i = 0; i < field.length; i++) {
      for (let j = i + 1; j < field.length; j++) {
        const a = field[i]!;
        const b = field[j]!;
        const gap =
          Math.hypot(a.sDelta - b.sDelta, a.latDelta - b.latDelta) - a.radius - b.radius;
        stats.pairs++;
        if (gap < stats.worstGapM) stats.worstGapM = gap;
        if (gap < 0) {
          stats.overlappingPairs++;
          fieldOverlapped = true;
          stats.worstOverlapM = Math.max(stats.worstOverlapM, -gap);
        }
      }
    }
    if (fieldOverlapped) stats.fieldsWithOverlap++;
  }
  if (stats.pairs === 0) stats.worstGapM = 0;
  return stats;
}

const seeds = process.argv.slice(2).map(Number);
const SEEDS = seeds.length > 0 ? seeds : [1, 7, 42, 1337, 0x5eed, 987654321];
/** POI slots probed per seed; slot 1 is the first stop out of the house. */
const SLOTS = 600;

const oldFields: Placed[][] = [];
const newFields: Placed[][] = [];

for (const seed of SEEDS) {
  for (let index = 1; index <= SLOTS; index++) {
    const poi = poiAt(seed >>> 0, index);
    if (poi === null || poi.kind !== 'roadside_wrecks') continue;
    oldFields.push(oldLayout(poi.variantSeed));
    newFields.push(layOutWreckField(poi).map((slot) => ({
      radius: slot.radius,
      sDelta: slot.sDelta,
      latDelta: slot.latDelta,
    })));
  }
}

const before = measure(oldFields);
const after = measure(newFields);

console.log(
  `${SEEDS.length} seeds x ${SLOTS} slots (${(SLOTS * POI_SPACING) / 1000} km each): ` +
    `${before.fields} wreck fields, ${before.pairs} body pairs`,
);
console.log('');
console.log('layout      fields with overlap   overlapping pairs   worst overlap   tightest gap');
for (const [label, stats] of [
  ['before', before],
  ['after', after],
] as const) {
  const fieldPct = ((100 * stats.fieldsWithOverlap) / Math.max(1, stats.fields)).toFixed(1);
  const pairPct = ((100 * stats.overlappingPairs) / Math.max(1, stats.pairs)).toFixed(1);
  console.log(
    `${label.padEnd(11)} ${`${stats.fieldsWithOverlap} (${fieldPct}%)`.padStart(19)} ` +
      `${`${stats.overlappingPairs} (${pairPct}%)`.padStart(19)} ` +
      `${`${stats.worstOverlapM.toFixed(2)} m`.padStart(15)} ` +
      `${`${stats.worstGapM.toFixed(2)} m`.padStart(14)}`,
  );
}
console.log('');

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}: ${detail}`);
}

// The bug was real and common, not a rare roll: state it, so a future change that
// reintroduces independent draws is measured against a number rather than a memory.
check(
  'the old layout overlapped in at least a fifth of its fields',
  before.fieldsWithOverlap / Math.max(1, before.fields) >= 0.2,
  `${before.fieldsWithOverlap}/${before.fields} fields, worst ${before.worstOverlapM.toFixed(2)} m deep`,
);
check(
  'no body overlaps another anywhere',
  after.overlappingPairs === 0,
  `${after.overlappingPairs} overlapping pairs in ${after.pairs}`,
);
// Footprint radii are circumscribed, so touching circles still leave real space
// between two bodies; the walking gap is what makes a field enterable on foot.
check(
  'every pair keeps a walking gap',
  after.worstGapM >= 1,
  `tightest ${after.worstGapM.toFixed(2)} m between footprints`,
);

console.log(failures === 0 ? 'all checks passed' : `${failures} CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
