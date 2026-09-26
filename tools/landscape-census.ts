/**
 * tools/landscape-census.ts
 *
 * What is actually beside the road, over tens of kilometres of it.
 *
 * The owner drove and reported forest on every side. This drives the shipped world
 * functions — `LandCover`, `Terrain`, `RoadDistance`, `director`, `lakes` — along the
 * real road and classifies the land in a lateral transect, so the argument is a
 * measurement and not an impression.
 *
 * It is the yardstick every item of the landscape plan in
 * `docs/research-2026-09-26-landscape.md` is verified with, which is why it is a tool
 * and not a scratch script: the same metrics have to be re-runnable after the next
 * change. The metrics, and what each one means:
 *
 *   STRIP            composition of the band the driver reads, 14-400 m out, both sides
 *   open ground      how far before a wood (forest > 0.1) stands across the view
 *   VIEW CLOSURE     12 azimuths from the centreline: is a wood walling this direction
 *                    inside 600 m, or is the direction open past 2.5 km
 *   WOOD ON BOTH     a wood inside 300 m on both sides at once — the tunnel
 *   FIELD IN VIEW    a crop field (CoverKind.Field) between 60 and 300 m either side,
 *                    and the longest stretch of the drive with none — "где поля?"
 *   LAND 12x12 km    wood / field / meadow shares of the country as it lies, no road
 *                    clearing, split by farmland district
 *   TREES            the REAL planting (`generateDesertTileData`) over 23 km2: records
 *                    per km2 and ms per 240 m tile, which is the frame-budget number
 *   relief, water    grade, lateral slope, curvature, wetness, ravines, lake sites,
 *                    and what the director schedules
 *
 *   npx tsx tools/landscape-census.ts 1 7 42 1337 777 2024
 *
 * Nothing here is part of the game bundle.
 */

import { generateDesertTileData } from '../src/world/deserttiledata';
import { lakeSites } from '../src/world/lakes';
import { CoverKind, newCoverSample } from '../src/world/landcover';
import { Road } from '../src/world/road';
import { RoadDistance } from '../src/world/roaddistance';
import { Terrain } from '../src/world/terrain';
import { varietyEventsBetween, varietyKinds } from '../src/world/director';
import { SHOP_VARIANTS, villagesBetween } from '../src/world/village';

const SEEDS = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n));
const RUN_SEEDS = SEEDS.length ? SEEDS : [1337, 777];
const LENGTH_M = 60_000;
const STEP_M = 10;
/** Lateral offsets the transect samples, metres from the centreline. */
const LATERALS = [14, 20, 30, 45, 70, 100, 160, 240, 400];
/** Outward scan for the wood edge: from the verge to this far, in these steps. */
const EDGE_FROM = 12;
const EDGE_TO = 900;
const EDGE_STEP = 4;

interface Tally {
  meadow: number;
  field: number;
  forest: number;
  wet: number;
  ravine: number;
  total: number;
}

function roadOffset(road: Road, s: number, lateral: number): [number, number] {
  const p = road.offsetPoint(s, lateral);
  return [p.x, p.z];
}

function pct(n: number, total: number): string {
  return `${((100 * n) / total).toFixed(1)}%`;
}

function quant(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i]!;
}

for (const seed of RUN_SEEDS) {
  const road = new Road(seed);
  const distance = new RoadDistance(road);
  const terrain = new Terrain(seed, road);
  const cover = terrain.cover;
  const sample = newCoverSample();

  const byLateral = new Map<number, Tally>();
  for (const l of LATERALS) byLateral.set(l, { meadow: 0, field: 0, forest: 0, wet: 0, ravine: 0, total: 0 });
  const all: Tally = { meadow: 0, field: 0, forest: 0, wet: 0, ravine: 0, total: 0 };

  /** Nearest closed wood (forest > 0.5) in the outward scan, Infinity if none. */
  const edgeDist: number[] = [];
  /** Nearest wood of any density (forest > 0.05): the first scrub/copse. */
  const firstWood: number[] = [];
  /** Depth of open ground: first point whose wood reads as a wood (forest > 0.1). */
  const openDepth: number[] = [];
  /** Same, for a closed canopy. */
  const wallDepth: number[] = [];
  /** Wood density seen at each offset, for the band histogram. */
  const forestByOffset: number[][] = LATERALS.map(() => []);
  const scrubHits: { hit: number; total: number } = { hit: 0, total: 0 };
  const farmValues: number[] = [];
  const plotShares: number[] = [];
  const grades: number[] = [];
  const lateralSlopes: number[] = [];
  const curvatures: number[] = [];

  const push = (t: Tally, f: number, kind: CoverKind, wet: boolean, ravine: boolean): void => {
    t.total++;
    if (f > 0.5 || kind === CoverKind.Forest) t.forest++;
    else if (kind === CoverKind.Field) t.field++;
    else t.meadow++;
    if (wet) t.wet++;
    if (ravine) t.ravine++;
  };

  const pt = { x: 0, y: 0, z: 0 };
  for (let s = 0; s < LENGTH_M; s += STEP_M) {
    const c = road.sampleAt(s);
    grades.push(Math.abs(c.grade));
    curvatures.push(Math.abs(c.curvature));
    for (const side of [1, -1]) {
      for (const l of LATERALS) {
        road.offsetPoint(s, side * l, pt);
        const roadDist = distance.distAt(pt.x, pt.z, 20);
        cover.sample(pt.x, pt.z, roadDist, sample);
        const wet = terrain.wetnessAt(pt.x, pt.z) > 0.55;
        const ravine = terrain.ravineAt(pt.x, pt.z) > 0.4;
        push(byLateral.get(l)!, sample.forest, sample.kind, wet, ravine);
        push(all, sample.forest, sample.kind, wet, ravine);
        if (l === 100) {
          farmValues.push(cover.farmlandAt(pt.x, pt.z));
          plotShares.push(sample.plot);
        }
        forestByOffset[LATERALS.indexOf(l)]!.push(sample.forest);
      }
      // Wood edge scan on this side.
      let first = Infinity;
      let closed = Infinity;
      let readsAsWood = Infinity;
      let wall = Infinity;
      for (let l = EDGE_FROM; l <= EDGE_TO; l += EDGE_STEP) {
        road.offsetPoint(s, side * l, pt);
        const roadDist = distance.distAt(pt.x, pt.z, 20);
        const f = cover.forestAt(pt.x, pt.z, roadDist);
        if (f > 0.05 && first === Infinity) first = l;
        if (f > 0.1 && readsAsWood === Infinity) readsAsWood = l;
        if (f > 0.35 && wall === Infinity) wall = l;
        if (f > 0.5) {
          closed = l;
          break;
        }
      }
      if (closed === Infinity) edgeDist.push(EDGE_TO + 1);
      else edgeDist.push(closed);
      firstWood.push(first);
      openDepth.push(readsAsWood === Infinity ? EDGE_TO + 1 : readsAsWood);
      wallDepth.push(wall === Infinity ? EDGE_TO + 1 : wall);
      // The roadside scrub the planting puts in the ditch on both sides.
      for (let l = EDGE_FROM; l <= 24; l += 4) {
        road.offsetPoint(s, side * l, pt);
        const clump = cover.copseAt(pt.x * 3.1 + 500, pt.z * 3.1 - 700);
        scrubHits.total++;
        if (clump > 0.3) scrubHits.hit++;
      }
      // Lateral slope 200 m out, along the lateral axis, metres per metre.
      road.offsetPoint(s, side * 200, pt);
      const h0 = terrain.heightAt(pt.x, pt.z, s);
      const h1 = terrain.heightAt(pt.x + 8, pt.z, s);
      const h2 = terrain.heightAt(pt.x, pt.z + 8, s);
      lateralSlopes.push(Math.hypot(h1 - h0, h2 - h0) / 8);
    }
  }

  const km = LENGTH_M / 1000;
  console.log(`\n===== seed ${seed}, ${km} km of road =====`);
  console.log(`transect samples: ${all.total} (${LATERALS.length} offsets x 2 sides x ${LENGTH_M / STEP_M} stations)`);
  console.log(
    `STRIP 14-400 m:  forest ${pct(all.forest, all.total)}  field ${pct(all.field, all.total)}  meadow ${pct(all.meadow, all.total)}` +
      `  |  wet>0.55 ${pct(all.wet, all.total)}  ravine>0.4 ${pct(all.ravine, all.total)}`,
  );
  for (const l of LATERALS) {
    const t = byLateral.get(l)!;
    console.log(
      `  ${String(l).padStart(3)} m:  forest ${pct(t.forest, t.total).padStart(6)}  field ${pct(t.field, t.total).padStart(6)}  meadow ${pct(t.meadow, t.total).padStart(6)}  wet ${pct(t.wet, t.total).padStart(5)}  ravine ${pct(t.ravine, t.total).padStart(5)}`,
    );
  }

  const far = edgeDist.filter((d) => d <= EDGE_TO).length / edgeDist.length;
  const none = edgeDist.filter((d) => d > EDGE_TO).length / edgeDist.length;
  const sortedEdge = [...edgeDist].filter((d) => d <= EDGE_TO).sort((a, b) => a - b);
  console.log(
    `closed wood on this side within 60 m ${pct(edgeDist.filter((d) => d <= 60).length, edgeDist.length)}` +
      `  within 150 m ${pct(edgeDist.filter((d) => d <= 150).length, edgeDist.length)}` +
      `  within 900 m ${pct(far * edgeDist.length, edgeDist.length)}` +
      `  NONE within 900 m ${pct(none * edgeDist.length, edgeDist.length)}`,
  );
  console.log(
    `nearest closed wood, median ${quant(sortedEdge, 0.5)} m  p10 ${quant(sortedEdge, 0.1)}  p90 ${quant(sortedEdge, 0.9)}`,
  );
  const depth = (arr: number[], label: string): void => {
    const sorted = [...arr].sort((a, b) => a - b);
    console.log(
      `${label}: p10 ${quant(sorted, 0.1)} m  p50 ${quant(sorted, 0.5)} m  p90 ${quant(sorted, 0.9)} m` +
        `  |  within 100 m ${pct(arr.filter((d) => d <= 100).length, arr.length)}` +
        `  within 200 m ${pct(arr.filter((d) => d <= 200).length, arr.length)}` +
        `  open past 900 m ${pct(arr.filter((d) => d > 900).length, arr.length)}`,
    );
  };
  depth(openDepth, 'open ground before a wood (forest>0.1)');
  depth(wallDepth, 'open ground before a closed wall (forest>0.35)');
  console.log(
    `verge scrub in the 12-24 m ditch strip (copseAt>0.3, where trees/bushes are planted): ${pct(scrubHits.hit, scrubHits.total)}`,
  );
  console.log('wood density seen at each offset (share of samples above a level):');
  console.log(
    `  ${['offset'].concat(['>0', '>0.05', '>0.1', '>0.2', '>0.35', '>0.5', 'mean']).map((h) => h.padStart(9)).join('')}`,
  );
  for (let i = 0; i < LATERALS.length; i++) {
    const a = forestByOffset[i]!;
    const cells = [
      pct(a.filter((v) => v > 0).length, a.length),
      pct(a.filter((v) => v > 0.05).length, a.length),
      pct(a.filter((v) => v > 0.1).length, a.length),
      pct(a.filter((v) => v > 0.2).length, a.length),
      pct(a.filter((v) => v > 0.35).length, a.length),
      pct(a.filter((v) => v > 0.5).length, a.length),
      (a.reduce((x, y) => x + y, 0) / a.length).toFixed(3),
    ];
    console.log(`  ${String(LATERALS[i]).padStart(6)} m${cells.map((c) => c.padStart(9)).join('')}`);
  }
  const sortedFirst = [...firstWood].filter((d) => Number.isFinite(d)).sort((a, b) => a - b);
  console.log(
    `first wood of ANY density, median ${quant(sortedFirst, 0.5)} m  p10 ${quant(sortedFirst, 0.1)}  p90 ${quant(sortedFirst, 0.9)}` +
      `  none at all: ${pct(firstWood.filter((d) => !Number.isFinite(d)).length, firstWood.length)}`,
  );

  const sortedFarm = [...farmValues].sort((a, b) => a - b);
  console.log(
    `farmland field at 100 m: mean ${(farmValues.reduce((a, b) => a + b, 0) / farmValues.length).toFixed(3)}` +
      `  median ${quant(sortedFarm, 0.5).toFixed(3)}` +
      `  farm>0.5 ${pct(farmValues.filter((v) => v > 0.5).length, farmValues.length)}` +
      `  farm>0.9 ${pct(farmValues.filter((v) => v > 0.9).length, farmValues.length)}` +
      `  crop plot>0.5 ${pct(plotShares.filter((v) => v > 0.5).length, plotShares.length)}`,
  );

  const sortedGrade = [...grades].sort((a, b) => a - b);
  console.log(
    `road grade |%|: p50 ${(quant(sortedGrade, 0.5) * 100).toFixed(2)}%  p90 ${(quant(sortedGrade, 0.9) * 100).toFixed(2)}%  p99 ${(quant(sortedGrade, 0.99) * 100).toFixed(2)}%`,
  );
  let turns = 0;
  for (let i = 1; i < grades.length; i++) if (Math.sign(road.sampleAt(i * STEP_M).grade) !== Math.sign(road.sampleAt((i - 1) * STEP_M).grade)) turns++;
  console.log(`grade sign changes: ${turns} over ${km} km = one every ${(LENGTH_M / Math.max(1, turns) / 1000).toFixed(2)} km`);
  const sortedSlope = [...lateralSlopes].sort((a, b) => a - b);
  console.log(
    `lateral slope at 200 m |%|: p50 ${(quant(sortedSlope, 0.5) * 100).toFixed(1)}%  p90 ${(quant(sortedSlope, 0.9) * 100).toFixed(1)}%  p99 ${(quant(sortedSlope, 0.99) * 100).toFixed(1)}%`,
  );
  const sortedCurv = [...curvatures].sort((a, b) => a - b);
  console.log(
    `curvature 1/m: p50 ${quant(sortedCurv, 0.5).toExponential(2)}  p90 ${quant(sortedCurv, 0.9).toExponential(2)}  (radius p10 ${(1 / Math.max(1e-9, quant(sortedCurv, 0.9))).toFixed(0)} m)`,
  );

  // Director: what the schedule puts on the road.
  const events = varietyEventsBetween(seed, 0, LENGTH_M);
  const byKind: Record<string, number> = {};
  for (const k of varietyKinds()) byKind[k] = 0;
  for (const e of events) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
  console.log(
    `director events: ${events.length} over ${km} km = one every ${(LENGTH_M / Math.max(1, events.length) / 1000).toFixed(2)} km`,
  );
  console.log(
    `  ${Object.entries(byKind).map(([k, n]) => `${k}:${n} (1/${n ? (LENGTH_M / n / 1000).toFixed(1) : '-'}km)`).join('  ')}`,
  );

  // VIEW CLOSURE: for a driver at the centreline, which azimuths run into a wood and
  // how far away. This is the "лес кругом / где поля" measurement: land-cover shares
  // do not say it, because a wood 400 m off in every direction already reads as wood
  // everywhere while the strip shares look balanced.
  const AZIMUTHS = 12;
  let closedNear = 0;
  let openFar = 0;
  const azSamples: number[] = [];
  let stations = 0;
  for (let s = 0; s < LENGTH_M; s += 20) {
    road.offsetPoint(s, 0, pt);
    let open = 0;
    let closed = 0;
    for (let a = 0; a < AZIMUTHS; a++) {
      const ang = (a / AZIMUTHS) * Math.PI * 2;
      const dx = Math.cos(ang);
      const dz = Math.sin(ang);
      let woodAt = Infinity;
      for (let r = 20; r <= 4000; r += r < 600 ? 20 : 80) {
        const f = cover.forestAt(pt.x + dx * r, pt.z + dz * r, distance.distAt(pt.x + dx * r, pt.z + dz * r, 20));
        if (f > 0.1) {
          woodAt = r;
          break;
        }
      }
      azSamples.push(woodAt);
      if (woodAt < 600) closed++;
      if (woodAt > 2500) open++;
    }
    closedNear += closed;
    openFar += open;
    stations++;
  }
  const sortedAz = [...azSamples].sort((a, b) => a - b);
  console.log(
    `VIEW CLOSURE (${AZIMUTHS} azimuths x ${stations} stations at 20 m): median distance to the nearest wood>0.1 ` +
      `${Number.isFinite(quant(sortedAz, 0.5)) ? quant(sortedAz, 0.5) : '>4000'} m  p25 ${Number.isFinite(quant(sortedAz, 0.25)) ? quant(sortedAz, 0.25) : '>4000'}  p75 ${Number.isFinite(quant(sortedAz, 0.75)) ? quant(sortedAz, 0.75) : '>4000'}`,
  );
  const azTotal = stations * AZIMUTHS;
  console.log(
    `  azimuths walled by a wood inside 600 m: ${pct(closedNear, azTotal)}` +
      `  |  azimuths open past 2500 m: ${pct(openFar, azTotal)}` +
      `  |  no wood in 4 km: ${pct(azSamples.filter((d) => !Number.isFinite(d)).length, azTotal)}`,
  );

  // WATERCOURSES: what the road crosses, and what crossing costs it in grade. The
  // targets are from the research (one watercourse every 2.5-8 km, a bridge every
  // 15-18.5 km, a descent of 15-30 m into the valley), so this is the number the
  // watercourse schedule is set by.
  {
    let crossings = 0;
    let wetCrossings = 0;
    let bridgeCrossings = 0;
    let inBed = false;
    // Deepest and wettest point of the crossing, not its rim: the entry sample is the
    // valley's edge, where every one of these numbers is still zero.
    let deepest = 0;
    let wettest = 0;
    let spannest = 0;
    const depths: number[] = [];
    let worstGradeNearCrossing = 0;
    let crossingS = -1e9;
    for (let s = 0; s < LENGTH_M; s += 4) {
      const c = road.sampleAt(s);
      const st = road.landscape.streams.at(c.x, c.z);
      const over = st.bed > 0.02;
      if (over) {
        deepest = Math.max(deepest, st.valley);
        wettest = Math.max(wettest, st.water);
        spannest = Math.max(spannest, st.span);
      } else if (inBed) {
        crossings++;
        if (wettest > 0.5) wetCrossings++;
        if (spannest > 0.5) bridgeCrossings++;
        depths.push(deepest);
        deepest = 0;
        wettest = 0;
        spannest = 0;
      }
      inBed = over;
      if (Math.abs(s - crossingS) < 220) worstGradeNearCrossing = Math.max(worstGradeNearCrossing, Math.abs(c.grade));
      if (over) crossingS = s;
    }
    depths.sort((a, b) => a - b);
    console.log(
      `WATERCOURSES over ${LENGTH_M / 1000} km: ${crossings} crossings = one every ${(LENGTH_M / Math.max(1, crossings) / 1000).toFixed(2)} km` +
        `  |  with water ${wetCrossings} (one every ${(LENGTH_M / Math.max(1, wetCrossings) / 1000).toFixed(2)} km)` +
        `  |  bridges ${bridgeCrossings} (one every ${(LENGTH_M / Math.max(1, bridgeCrossings) / 1000).toFixed(2)} km)`,
    );
    console.log(
      `  valley cut at a crossing: median ${quant(depths, 0.5).toFixed(1)} m  p10 ${quant(depths, 0.1).toFixed(1)}  p90 ${quant(depths, 0.9).toFixed(1)}` +
        `  |  worst grade within 220 m of a crossing ${(worstGradeNearCrossing * 100).toFixed(2)}%`,
    );
  }

  // THE WORST GRADE AND THE WORST STEP ON THE ROAD, and this check exists because a
  // percentile hid a metre-and-a-half cliff: a per-cell hashed choice in the relief
  // (a ridge direction, in that case) jumped at every 9 km cell border, which is thirty
  // samples in sixty kilometres — under the p99 of fifteen thousand. A percentile cannot
  // see a fault, only a distribution.
  //
  // A STEP IS NOT A SLOPE, so the same difference is measured at two spacings: a slope's
  // rise shrinks with the spacing and a discontinuity's does not.
  {
    let worstGrade = 0;
    let worstGradeAt = 0;
    let worstNodeRise = 0;
    let worstNodeRiseAt = 0;
    for (let s = 0; s < LENGTH_M; s += 1) {
      const grade = Math.abs(road.sampleAt(s).grade);
      if (grade > worstGrade) {
        worstGrade = grade;
        worstGradeAt = s;
      }
      const rise = Math.abs(road.sampleAt(s + 4).y - road.sampleAt(s).y) / 4;
      if (rise > worstNodeRise) {
        worstNodeRise = rise;
        worstNodeRiseAt = s;
      }
    }
    const atWorst = road.sampleAt(worstNodeRiseAt);
    console.log(
      `ROAD WORST: grade ${(worstGrade * 100).toFixed(1)}% at s=${Math.round(worstGradeAt)}` +
        `  |  largest 4 m rise ${(worstNodeRise * 100).toFixed(1)}% at s=${Math.round(worstNodeRiseAt)} (y=${atWorst.y.toFixed(1)})` +
        `  |  ${worstGrade > 0.35 ? 'FAIL: a wall in the road' : 'ok'}`,
    );
  }

  // THE GROUND'S OWN STEPS, anywhere near the road. The road check above sees a wall when
  // the road is on it; this one sees a wall in the terrain, which is what a per-cell
  // choice in the RELIEF does — a hashed district angle, a lattice of anything that feeds
  // a height. The tile lattice is 3 m, so a rise of 3 m in 3 m is a vertical face and no
  // slope in this world reaches halfway to it.
  {
    let worstRise = 0;
    let worstRiseAt = 0;
    let worstRiseLat = 0;
    for (let s = 0; s < LENGTH_M; s += 25) {
      for (let lat = 0; lat <= 600; lat += 3) {
        const a = road.offsetPoint(s, lat);
        const b = road.offsetPoint(s, lat + 3);
        const rise = Math.abs(terrain.heightAt(b.x, b.z, s) - terrain.heightAt(a.x, a.z, s)) / 3;
        if (rise > worstRise) {
          worstRise = rise;
          worstRiseAt = s;
          worstRiseLat = lat;
        }
      }
    }
    // A STEP IS NOT A SLOPE, and the difference is the whole value of this check: a
    // ravine flank 60 degrees steep is a landform, while a hashed per-cell choice that
    // steps the ground by metres is a fault. So the worst place is measured again over a
    // quarter of a metre — a slope's rise shrinks by the ratio of the spacings (a
    // twelfth), a face keeps it — and the verdict is that ratio, not the steepness.
    const fine = 0.25;
    let fineRise = 0;
    for (let d = -2; d <= 2; d += fine) {
      const a = road.offsetPoint(worstRiseAt, worstRiseLat + d);
      const b = road.offsetPoint(worstRiseAt, worstRiseLat + d + fine);
      const rise = Math.abs(terrain.heightAt(b.x, b.z, worstRiseAt) - terrain.heightAt(a.x, a.z, worstRiseAt));
      if (rise > fineRise) fineRise = rise;
    }
    const ratio = fineRise / (worstRise * 3);
    console.log(
      `TERRAIN STEP: worst 3 m rise ${(worstRise * 100).toFixed(0)}% at s=${Math.round(worstRiseAt)} lat ${worstRiseLat}` +
        `  |  over 0.25 m ${(fineRise * 4 * 100).toFixed(0)}%, ratio ${ratio.toFixed(2)}` +
        `  |  ${ratio > 0.34 ? 'FAIL: a face in the ground' : 'ok (a steep slope, not a step)'}`,
    );
  }

  // RAVINES AND KOSOGORS. How many ravines the road passes and how deep they are, and how
  // often the road is riding a side-slope — the verge half a metre higher on one side
  // than the other, which is what a косогор looks like from the cab.
  {
    let ravines = 0;
    let ravineStations = 0;
    let stations = 0;
    let inRavine = false;
    let deepest = 0;
    const crossSlopes: number[] = [];
    for (let s = 0; s < LENGTH_M; s += 10) {
      const near = terrain.ravineAt(...roadOffset(road, s, 0));
      let hit = 0;
      let hitLat = 0;
      for (let lat = -120; lat <= 120; lat += 12) {
        const p = road.offsetPoint(s, lat);
        const r = terrain.ravineAt(p.x, p.z);
        if (r > hit) {
          hit = r;
          hitLat = lat;
        }
      }
      stations++;
      if (hit > 0.3) {
        ravineStations++;
        if (!inRavine) ravines++;
        inRavine = true;
        // How deep the cut is, measured across it: the ground on its centreline against
        // the ground forty metres further out on the same side.
        const centre = road.offsetPoint(s, hitLat);
        const shoulder = road.offsetPoint(s, hitLat + (hitLat < 0 ? -40 : 40));
        deepest = Math.max(
          deepest,
          terrain.heightAt(shoulder.x, shoulder.z, s) - terrain.heightAt(centre.x, centre.z, s),
        );
      } else inRavine = false;
      void near;
      const left = road.offsetPoint(s, 14);
      const right = road.offsetPoint(s, -14);
      const hl = terrain.heightAt(left.x, left.z, s);
      const hr = terrain.heightAt(right.x, right.z, s);
      crossSlopes.push(Math.abs(hl - hr));
    }
    crossSlopes.sort((a, b) => a - b);
    // How much relief stands inside the driver's own window: the height range within
    // 600 m of the road. A ridge field is worth nothing if the ground beside the road
    // still reads as flat.
    const reliefWindow: number[] = [];
    for (let s = 0; s < LENGTH_M; s += 200) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let lat = -600; lat <= 600; lat += 50) {
        const p = road.offsetPoint(s, lat);
        const y = terrain.heightAt(p.x, p.z, s);
        if (y < lo) lo = y;
        if (y > hi) hi = y;
      }
      reliefWindow.push(hi - lo);
    }
    reliefWindow.sort((a, b) => a - b);
    console.log(
      `RELIEF IN VIEW: height range within 600 m of the road: p50 ${quant(reliefWindow, 0.5).toFixed(1)} m, p90 ${quant(reliefWindow, 0.9).toFixed(1)} m, max ${reliefWindow[reliefWindow.length - 1]?.toFixed(1)} m`,
    );
    const tilted = crossSlopes.filter((v) => v > 0.6).length;
    console.log(
      `RAVINES: a ravine within 120 m on ${pct(ravineStations, stations)} of the drive (${ravines} separate runs)` +
        `  |  deepest cut seen ${deepest.toFixed(1)} m`,
    );
    console.log(
      `KOSOGOR: ground 14 m either side of the road differs by p50 ${quant(crossSlopes, 0.5).toFixed(2)} m, p90 ${quant(crossSlopes, 0.9).toFixed(2)} m` +
        `  |  more than 0.6 m on ${pct(tilted, crossSlopes.length)} of the drive`,
    );
  }

  // VILLAGES: how often a place is inhabited, how many houses it has and how long its
  // street is. The research puts a village every 6-11 km of road.
  {
    let villages = 0;
    let houses = 0;
    let shops = 0;
    const lengths: number[] = [];
    const sizes: number[] = [];
    let withPond = 0;
    for (const village of villagesBetween(seed, 0, LENGTH_M)) {
      villages++;
      houses += village.houses.length;
      sizes.push(village.houses.length);
      lengths.push(village.to - village.from);
      for (const house of village.houses) if (SHOP_VARIANTS.includes(house.variant)) shops++;
      // The pond is a DUG BASIN (world/lakes.ts), so its water comes from the basin
      // renderer and not from `waterLevelAt` — what is checked here is that the basin
      // schedule has a site at the village's own arclength.
      const site = terrain.basins.nearest(village.pond.s);
      if (site !== null && Math.abs(site.s - village.pond.s) < 1) withPond++;
    }
    console.log(
      `VILLAGES: ${villages} over ${LENGTH_M / 1000} km = one every ${(LENGTH_M / Math.max(1, villages) / 1000).toFixed(2)} km` +
        `  |  ${houses} houses (median ${quant(sizes, 0.5)}, ${quant(sizes, 0.1)}-${quant(sizes, 0.9)}), street ${quant(lengths, 0.5)} m long` +
        `  |  ${shops} shops, ${withPond} dug ponds`,
    );
  }

  // PONDS: the water a driver actually sees, and how wide it is where it is seen. A pond
  // is a dammed reach of the stream network, so it is found the same way a crossing is —
  // by the bowl — but it is looked for to the SIDE, where the eye is.
  {
    let ponds = 0;
    let inPond = false;
    let widest = 0;
    let pondS = -1;
    for (let s = 0; s < LENGTH_M; s += 10) {
      let wet = false;
      let width = 0;
      for (let lat = 0; lat <= 400; lat += 12) {
        for (const side of lat === 0 ? [1] : [1, -1]) {
          const p = road.offsetPoint(s, side * lat);
          const v = road.landscape.streams.at(p.x, p.z);
          if (v.bowl <= 0.2) continue;
          const level = terrain.waterLevelAt(p.x, p.z);
          if (!Number.isFinite(level)) continue;
          if (terrain.heightAt(p.x, p.z, s) < level - 0.02) {
            wet = true;
            width = lat;
          }
        }
        if (!wet && lat > 60) break;
      }
      if (wet) {
        if (!inPond) {
          ponds++;
          pondS = s;
        }
        if (width > widest) widest = width;
      }
      inPond = wet;
      void pondS;
    }
    // The pond's own size, measured across the road: the run of dug bowl. (Water in a
    // lateral scan is a longer number and not the pond's: where the road runs ALONGSIDE
    // a stream the scan crosses two hundred metres of it.)
    let widestBowl = 0;
    for (let s = 0; s < LENGTH_M; s += 20) {
      let run = 0;
      for (let lat = -300; lat <= 300; lat += 4) {
        const p = road.offsetPoint(s, lat);
        if (road.landscape.streams.at(p.x, p.z).bowl > 0.15) {
          run += 4;
          if (run > widestBowl) widestBowl = run;
        } else run = 0;
      }
    }
    console.log(
      `PONDS: ${ponds} with open water visible from the road inside 400 m over ${LENGTH_M / 1000} km = one every ${(LENGTH_M / Math.max(1, ponds) / 1000).toFixed(2)} km` +
        `  |  furthest of it ${widest} m out  |  widest pond hollow ${widestBowl} m across`,
    );
  }

  // WHAT THE ROAD DOES AT EACH CROSSING, in the ground itself: at a bridge the bed is
  // open under the asphalt — the deck hangs over water — and at a culvert the graded
  // embankment fills it. This is the check that the two are actually different in the
  // terrain and not only in the naming, and it is measured at the road's own centreline,
  // which is where the deck is.
  {
    let inBed = false;
    let maxSpan = 0;
    let minGap = Infinity;
    let hasWater = false;
    const spanned: number[] = [];
    const culverted: number[] = [];
    const closeCrossing = (): void => {
      if (maxSpan > 0.9 && hasWater) spanned.push(minGap);
      if (maxSpan < 0.5) culverted.push(minGap);
    };
    for (let s = 0; s < LENGTH_M; s += 2) {
      const c = road.sampleAt(s);
      const st = road.landscape.streams.at(c.x, c.z);
      if (st.bed > 0.02) {
        if (!inBed) {
          maxSpan = 0;
          minGap = Infinity;
          hasWater = false;
        }
        inBed = true;
        if (st.span > maxSpan) maxSpan = st.span;
        if (st.water > 0.5) hasWater = true;
        // Gate on the reach carrying water, NOT on the level being positive: a world
        // height is negative wherever the country is.
        if (st.water > 0) {
          const level = terrain.waterLevelAt(c.x, c.z);
          if (Number.isFinite(level)) {
            minGap = Math.min(minGap, terrain.heightAt(c.x, c.z, s) - level);
          }
        }
        continue;
      }
      if (inBed) closeCrossing();
      inBed = false;
    }
    if (inBed) closeCrossing();
    spanned.sort((a, b) => a - b);
    culverted.sort((a, b) => a - b);
    const opened = spanned.filter((g) => g < -0.2).length;
    const blocked = culverted.filter((g) => g > 0.2).length;
    console.log(
      `CROSSING GROUND: ${spanned.length} spanned crossings, bed open (ground > 20 cm below the water) under ${opened}` +
        `  |  deck clearance at the centreline: median ${quant(spanned, 0.5).toFixed(2)} m (negative is open), worst ${quant(spanned, 0.99).toFixed(2)}`,
    );
    console.log(
      `  ${culverted.length} culverted crossings, embankment above the water in ${blocked}` +
        `  |  depth of the ditch left at the centreline: median ${quant(culverted, 0.5).toFixed(2)} m (positive is blocked)`,
    );
  }

  // IN THE WOOD: how much of the drive has a wood inside 300 m on BOTH sides, and the
  // longest such stretch. A wood on one side is a picture; a wood on both is a tunnel,
  // and the tunnel is what "кругом только лес" means.
  {
    let both = 0;
    let run = 0;
    let longest = 0;
    let stations = 0;
    for (let s = 0; s < LENGTH_M; s += 20) {
      let sides = 0;
      for (const side of [1, -1]) {
        for (let l = 16; l <= 300; l += 12) {
          road.offsetPoint(s, side * l, pt);
          if (cover.forestAt(pt.x, pt.z, distance.distAt(pt.x, pt.z, 20)) > 0.1) {
            sides++;
            break;
          }
        }
      }
      stations++;
      if (sides === 2) {
        both++;
        run++;
        longest = Math.max(longest, run);
      } else run = 0;
    }
    console.log(
      `WOOD ON BOTH SIDES inside 300 m: ${pct(both, stations)} of the drive` +
        `  |  longest unbroken stretch in the wood: ${((longest * 20) / 1000).toFixed(1)} km`,
    );
  }

  // FIELDS FROM THE ROAD: how often a crop field is actually in view, and the longest
  // stretch of the drive with none. This is the owner's question ("где поля?") in one
  // number, and it is not the same as the land share: a field 700 m out is a field you
  // cannot see from a car at the bottom of a wood-lined corridor.
  {
    const hasField: boolean[] = [];
    for (let s = 0; s < LENGTH_M; s += 20) {
      let found = false;
      for (const side of [1, -1]) {
        for (const l of [60, 120, 200, 300]) {
          road.offsetPoint(s, side * l, pt);
          const roadDist = distance.distAt(pt.x, pt.z, 20);
          cover.sample(pt.x, pt.z, roadDist, sample);
          if (sample.kind === CoverKind.Field) {
            found = true;
            break;
          }
        }
        if (found) break;
      }
      hasField.push(found);
    }
    let run = 0;
    let longest = 0;
    for (const h of hasField) {
      run = h ? 0 : run + 1;
      longest = Math.max(longest, run);
    }
    console.log(
      `FIELD IN VIEW (60-300 m, either side): ${pct(hasField.filter(Boolean).length, hasField.length)} of the drive` +
        `  |  longest stretch with no field in view: ${((longest * 20) / 1000).toFixed(1)} km`,
    );
  }

  // LAND SHARES, independent of the road: a 12 x 12 km square sampled every 25 m.
  // This is the "how much of the world is wood / field / meadow" number, before any
  // road clearing, and it is what the vista and the horizon are made of.
  {
    const origin = road.sampleAt(5_000);
    const SIDE = 12_000;
    const CELL = 25;
    let wood = 0;
    let partial = 0;
    let field = 0;
    let meadow = 0;
    let n = 0;
    let farmSum = 0;
    let farmBig = 0;
    const buck = [
      { name: 'farm<0.3', wood: 0, field: 0, meadow: 0, n: 0 },
      { name: '0.3-0.7', wood: 0, field: 0, meadow: 0, n: 0 },
      { name: 'farm>0.7', wood: 0, field: 0, meadow: 0, n: 0 },
    ];
    const line: number[] = [];
    for (let dx = -SIDE / 2; dx < SIDE / 2; dx += CELL) {
      for (let dz = -SIDE / 2; dz < SIDE / 2; dz += CELL) {
        const x = origin.x + dx;
        const z = origin.z + dz;
        cover.sample(x, z, 1e6, sample);
        n++;
        farmSum += cover.farmlandAt(x, z);
        if (cover.farmlandAt(x, z) > 0.5) farmBig++;
        const f = cover.farmlandAt(x, z);
        const b = buck[f < 0.3 ? 0 : f < 0.7 ? 1 : 2]!;
        b.n++;
        if (sample.forest > 0.5) { wood++; b.wood++; }
        else if (sample.forest > 0.05) partial++;
        else if (sample.kind === CoverKind.Field) { field++; b.field++; }
        else { meadow++; b.meadow++; }
        if (dx === 0) line.push(sample.forest);
      }
    }
    console.log(
      `LAND 12x12 km (${n} samples, no road clearing): wood>0.5 ${pct(wood, n)}  sparse wood 0.05-0.5 ${pct(partial, n)}` +
        `  field ${pct(field, n)}  meadow ${pct(meadow, n)}  |  mean farmland ${(farmSum / n).toFixed(3)}  farm>0.5 ${pct(farmBig, n)}`,
    );
    for (const b of buck) {
      if (!b.n) continue;
      console.log(
        `  district ${b.name} (${pct(b.n, n)} of the square): wood ${pct(b.wood, b.n)}  field ${pct(b.field, b.n)}  meadow ${pct(b.meadow, b.n)}`,
      );
    }
    // How long a stretch of open land a driver would get: runs of wood along a line.
    let runStart = 0;
    const runs: number[] = [];
    for (let i = 0; i <= line.length; i++) {
      const isWood = (line[i] ?? 1) > 0.1;
      if (isWood || i === line.length) {
        if (i > runStart) runs.push((i - runStart) * CELL);
        runStart = i + 1;
      }
    }
    const sortedRuns = [...runs].sort((a, b) => a - b);
    console.log(
      `  open runs along a 12 km line crossing the country: median ${quant(sortedRuns, 0.5)} m  p90 ${quant(sortedRuns, 0.9)} m  longest ${sortedRuns[sortedRuns.length - 1]} m`,
    );
  }

  // WHAT IS ACTUALLY PLANTED, and what it costs: the real tile generator over a
  // 4.8 x 4.8 km block beside the road. This is the number that matters for the frame
  // budget (tree records per km2) and for the eye (are the belts and copses there at
  // all), and neither is visible in the cover field alone.
  {
    const origin = road.sampleAt(5_000);
    const TILES = 20;
    const tx0 = Math.floor((origin.x - (TILES / 2) * 240) / 240);
    const tz0 = Math.floor((origin.z - (TILES / 2) * 240) / 240);
    const context = { seed, road, terrain, roadDistance: distance };
    const byKind = new Array<number>(16).fill(0);
    let trees = 0;
    let area = 0;
    let waterTiles = 0;
    let waterVerts = 0;
    const waterPerTile: number[] = [];
    const started = performance.now();
    for (let tx = tx0; tx < tx0 + TILES; tx++) {
      for (let tz = tz0; tz < tz0 + TILES; tz++) {
        const data = generateDesertTileData(context, tx, tz, false);
        area += (240 * 240) / 1e6;
        trees += data.treeCount;
        if (data.waterVertexCount > 0) {
          waterTiles++;
          waterVerts += data.waterVertexCount;
          waterPerTile.push(data.waterVertexCount);
        }
        for (let i = 0; i < data.treeCount; i++) byKind[data.trees[i * 7 + 5]!]!++;
      }
    }
    const elapsed = performance.now() - started;
    const NAME = ['birch', 'spruce', 'bush', 'lime', 'pine', 'aspen', 'oak', 'maple', 'alder', 'willow', 'rowan', 'fern', 'juniper', 'stump', 'log', 'fieldPine'];
    console.log(
      `TREES (real planting over ${area.toFixed(0)} km2): ${trees} records = ${(trees / area).toFixed(0)}/km2` +
        `  |  ${(elapsed / (TILES * TILES)).toFixed(2)} ms per 240 m tile (${(elapsed / 1000).toFixed(1)} s for ${TILES * TILES} tiles)`,
    );
    console.log(
      `  ${byKind.map((n, i) => `${NAME[i]}:${(100 * n / trees).toFixed(1)}%`).filter((_, i) => byKind[i]! > 0).join('  ')}`,
    );
    const sortedWater = [...waterPerTile].sort((a, b) => a - b);
    console.log(
      `  stream surfaces: ${waterTiles} of ${TILES * TILES} tiles carry water` +
        `  (${(100 * waterTiles) / (TILES * TILES)}% of tiles, median ${quant(sortedWater, 0.5)} vertices, p90 ${quant(sortedWater, 0.9)}, worst ${sortedWater[sortedWater.length - 1] ?? 0})` +
        `  |  across the visible 13x13 window: ${((waterVerts / (TILES * TILES)) * 169).toFixed(0)} vertices, ${((waterTiles / (TILES * TILES)) * 169).toFixed(0)} draw calls`,
    );
  }

  const lakes = lakeSites(seed, LENGTH_M);
  console.log(`lake basins whose site falls in this span: ${lakes.length} (${lakes.map((l) => (l.s / 1000).toFixed(0) + 'km@' + l.lateral.toFixed(0) + 'm').join(', ') || 'none'})`);
  console.log(`river/stream crossings in code: none (no generator exists)`);
}