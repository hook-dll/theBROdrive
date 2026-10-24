/**
 * tools/region-census.ts
 *
 * Do the desert's regions (src/world/regions.ts) read as places, and does the desert
 * as a whole keep its totals?
 *
 * Pure: it reads only the seeded rolls (no road walk, no terrain), so it is light and
 * safe to run beside anything. Reports:
 *
 *   1. RING TOTALS: every density multiplier averaged over one full turn of the ring,
 *      sampled every 250 m. Each must be 1 within `TOTAL_TOLERANCE` — the regions
 *      redistribute the owner's scarcity, they must not add to it. Exit 1 otherwise.
 *   2. THE REGIONS: each desert's land (mesas, flora, rocks, houses, masts) and culture.
 *   3. THE ROAD over `--km` for each seed: every road kind's share of the road, against
 *      its share before regions (its weight alone), and where each kind falls by emblem.
 *   4. THE PEOPLE over `--km`: buildings per 100 km by emblem (lone gap houses and desert
 *      buildings), and the share of them that are the region's own culture.
 *
 *   bun tools/region-census.ts [--seeds=1337,7,42,99,2024,5,11,123] [--km=3000]
 */

import { districtAt, newDistrictBuffer, characterOf } from '../src/world/roadcharacter';
import {
  CULTURES,
  DESERTS,
  PALETTE_CYCLE_M,
  REGION_ROAD_KINDS,
  desertAt,
  newRegionMix,
  regionAt,
  type DesertEmblem,
} from '../src/world/regions';
import { MAST_IDS, roadsideSlot, roadsideSlotsBetween, structureIsMast } from '../src/world/poislots';
import { desertPoisBetween } from '../src/world/poi';
import { DWELLINGS } from '../src/world/dwellings/list';

const arg = (name: string, fallback: string): string =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const SEEDS = arg('seeds', '1337,7,42,99,2024,5,11,123').split(',').map(Number);
const KM = Number(arg('km', '3000'));
/** How far a ring total may stray from 1 before the census fails. */
const TOTAL_TOLERANCE = 0.03;

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
const f2 = (x: number): string => x.toFixed(2);
let failed = false;

// 1. Ring totals -------------------------------------------------------------
{
  const mix = newRegionMix();
  const keys = ['mesas', 'flora', 'rocks', 'houses', 'masts'] as const;
  const sum = { mesas: 0, flora: 0, rocks: 0, houses: 0, masts: 0 };
  const lo = { mesas: Infinity, flora: Infinity, rocks: Infinity, houses: Infinity, masts: Infinity };
  const hi = { mesas: 0, flora: 0, rocks: 0, houses: 0, masts: 0 };
  let n = 0;
  for (let s = 0; s < PALETTE_CYCLE_M; s += 250, n++) {
    regionAt(s, mix);
    for (const k of keys) {
      sum[k] += mix[k];
      lo[k] = Math.min(lo[k], mix[k]);
      hi[k] = Math.max(hi[k], mix[k]);
    }
  }
  console.log('RING TOTALS (mean over one turn; must be 1)');
  for (const k of keys) {
    const mean = sum[k] / n;
    const ok = Math.abs(mean - 1) <= TOTAL_TOLERANCE;
    if (!ok) failed = true;
    console.log(`  ${k.padEnd(7)} mean ${f2(mean)}  range ${f2(lo[k])}-${f2(hi[k])}  ${ok ? 'ok' : 'FAIL'}`);
  }
}

// 2. The regions -------------------------------------------------------------
{
  console.log('\nTHE REGIONS (held pure)');
  const mix = newRegionMix();
  let at = 0;
  const total = DESERTS.reduce((a, d) => a + d.holdKm + d.blendKm, 0);
  for (const d of DESERTS) {
    regionAt((at + d.holdKm / 2) * (PALETTE_CYCLE_M / total), mix);
    at += d.holdKm + d.blendKm;
    console.log(
      `  ${d.name.padEnd(16)} ${d.emblem.padEnd(9)} ${d.culture.padEnd(13)} mesas ${f2(mix.mesas)} flora ${f2(mix.flora)} rocks ${f2(mix.rocks)} houses ${f2(mix.houses)} masts ${f2(mix.masts)}`,
    );
  }
}

// 3. The road ----------------------------------------------------------------
{
  console.log(`\nTHE ROAD (${KM} km x ${SEEDS.length} seeds; share of road by kind)`);
  const share = new Map<string, number>();
  const byEmblem = new Map<DesertEmblem, Map<string, number>>();
  let length = 0;
  const span = newDistrictBuffer();
  for (const seed of SEEDS) {
    for (let s = 0; s < KM * 1000; ) {
      districtAt(seed, s, span);
      const kind = characterOf(seed, span.index).name;
      const len = Math.min(span.end, KM * 1000) - s;
      share.set(kind, (share.get(kind) ?? 0) + len);
      const emblem = desertAt(span.start).emblem;
      const row = byEmblem.get(emblem) ?? new Map<string, number>();
      row.set(kind, (row.get(kind) ?? 0) + len);
      byEmblem.set(emblem, row);
      length += len;
      s = span.end;
    }
  }
  // Before regions, measured over 8 seeds x 3000 km: pan 14.8%, highway 23.0%, rolling
  // 24.3%, switchback 13.2%, esses 16.0%, derelict 8.6%. Each should stay within a point.
  for (const kind of REGION_ROAD_KINDS) console.log(`  ${kind.padEnd(10)} ${pct((share.get(kind) ?? 0) / length).padStart(6)}`);
  console.log('  by emblem:');
  for (const [emblem, row] of [...byEmblem].sort()) {
    const all = [...row.values()].reduce((a, b) => a + b, 0);
    const parts = REGION_ROAD_KINDS.map((k) => `${k} ${pct((row.get(k) ?? 0) / all)}`).join('  ');
    console.log(`    ${emblem.padEnd(9)} ${parts}`);
  }
}

// 4. The people --------------------------------------------------------------
{
  console.log(`\nTHE PEOPLE (${KM} km x ${SEEDS.length} seeds; buildings per 100 km of each emblem)`);
  const idOf = (structure: number): string => (structureIsMast(structure) ? MAST_IDS[structure]! : DWELLINGS[structure - MAST_IDS.length]!.id);
  interface Row { km: number; lone: number; desert: number; masts: number; own: number; houses: number; settlementsOwn: number; settlements: number }
  const rows = new Map<DesertEmblem, Row>();
  const row = (e: DesertEmblem): Row => {
    let r = rows.get(e);
    if (!r) rows.set(e, (r = { km: 0, lone: 0, desert: 0, masts: 0, own: 0, houses: 0, settlementsOwn: 0, settlements: 0 }));
    return r;
  };
  for (const seed of SEEDS) {
    for (let s = 0; s < KM * 1000; s += 1000) row(desertAt(s + 500).emblem).km += 1;
    const count = (s: number, structure: number, kind: 'lone' | 'desert' | 'settlement'): void => {
      const d = desertAt(s);
      const r = row(d.emblem);
      if (kind === 'settlement') {
        r.settlements++;
        if (CULTURES[d.culture].includes(idOf(structure))) r.settlementsOwn++;
        return;
      }
      r[kind]++;
      if (structureIsMast(structure)) { r.masts++; return; }
      r.houses++;
      if (CULTURES[d.culture].includes(idOf(structure))) r.own++;
    };
    for (const slot of roadsideSlotsBetween(seed, 0, KM * 1000)) {
      const stop = roadsideSlot(seed, slot);
      if (stop) count(stop.s, stop.structure, stop.settlement ? 'settlement' : 'lone');
    }
    for (const poi of desertPoisBetween(seed, 0, KM * 1000)) count(poi.s, poi.structure, 'desert');
  }
  for (const [emblem, r] of [...rows].sort()) {
    const per = (x: number): string => ((x / r.km) * 100).toFixed(1).padStart(5);
    console.log(
      `  ${emblem.padEnd(9)} lone ${per(r.lone)}  desert ${per(r.desert)}  masts ${per(r.masts)}  own culture ${pct(r.own / Math.max(1, r.houses)).padStart(6)}  settlements own ${pct(r.settlementsOwn / Math.max(1, r.settlements)).padStart(6)}`,
    );
  }
}

if (failed) {
  console.error('\nregion-census: FAILED');
  process.exit(1);
}
