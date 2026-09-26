/**
 * tools/road-variety.ts — WHAT A DRIVE ACTUALLY MEETS, and by which kilometre.
 *
 * The requirement this bench exists for is a coverage one: a player should have seen
 * every kind of road, every surface and every roadside era inside two to three
 * thousand kilometres — not each of them once per 2500 km, but all of them within it,
 * with repeats. That is a statement about distances-to-first-sighting, and no amount
 * of reading the generator's constants answers it, because the answer depends on
 * district lengths, jitter and the no-repeat chain interacting.
 *
 * So this walks the real `Road`, the real `roadConditionAt` and the real character
 * districts, and reports:
 *
 *   - the character sequence of the first 2500 km, with each district's length;
 *   - distance at which each character, surface and pole era was FIRST met;
 *   - the corner census per character: radii actually achieved, not the ones drawn;
 *   - the sight-distance and grade distribution per character;
 *   - what the geometry allows a careful driver, per character, which is the number
 *     the traffic's pace is judged against.
 *
 *   bun tools/road-variety.ts [seed] [km]
 */

import { SurfaceType } from '../src/core/surfaces';
import { roadConditionAt, poleEraSegments } from '../src/world/gradient';
import type { RoadConditionBuffer } from '../src/world/gradient';
import { Road } from '../src/world/road';
import { CHARACTERS, characterAt, newCharacterBuffer } from '../src/world/roadcharacter';
import { villagesBetween } from '../src/world/village';
import { roadPaceCeiling, surfacePaceFactor } from '../src/vehicle/autopilot';

const SEED = Number(process.argv[2] ?? 1337);
const DRIVE_KM = Number(process.argv[3] ?? 2_500);
const STEP_M = 25;

const road = new Road(SEED);
const character = newCharacterBuffer();
const condition: RoadConditionBuffer = {
  surface: SurfaceType.Asphalt,
  decay: 0,
  sandCover: 0,
  markings: 0,
};

interface Bucket {
  metres: number;
  curvature: number[];
  grades: number[];
  sight: number[];
  ceiling: number[];
}
const perCharacter = new Map<string, Bucket>();
const firstSeenCharacter = new Map<string, number>();
const firstSeenSurface = new Map<string, number>();
/** District runs: name and length, in order. */
const districts: { name: string; metres: number }[] = [];

for (let s = 0; s < DRIVE_KM * 1000; s += STEP_M) {
  characterAt(SEED, s, character);
  const name = character.name;
  road.conditionAt(s, condition);
  const curvature = Math.abs(road.curvatureAt(s));
  const grade = Math.abs(road.sampleAt(s).grade);

  let bucket = perCharacter.get(name);
  if (!bucket) {
    bucket = { metres: 0, curvature: [], grades: [], sight: [], ceiling: [] };
    perCharacter.set(name, bucket);
  }
  bucket.metres += STEP_M;
  bucket.curvature.push(curvature);
  bucket.grades.push(grade);
  // Sight and pace are the expensive samples, so they are taken every 200 m.
  if (s % 200 === 0) {
    bucket.sight.push(road.sightDistanceAt(s, 300));
    bucket.ceiling.push(roadPaceCeiling('sleeper', condition, curvature) * 3.6);
  }

  if (!firstSeenCharacter.has(name)) firstSeenCharacter.set(name, s);
  const surfaceName = SurfaceType[condition.surface]!;
  if (!firstSeenSurface.has(surfaceName)) firstSeenSurface.set(surfaceName, s);

  const last = districts[districts.length - 1];
  if (last && last.name === name) last.metres += STEP_M;
  else districts.push({ name, metres: STEP_M });
}

function percentile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}

console.log(`road variety, seed ${SEED}, first ${DRIVE_KM} km, ${STEP_M} m resolution`);
console.log('');
console.log('coverage — kilometre at which each kind was first met');
for (const c of CHARACTERS) {
  const at = firstSeenCharacter.get(c.name);
  console.log(
    `  ${c.name.padEnd(11)} ${at === undefined ? 'NEVER' : `${(at / 1000).toFixed(0)} km`}`,
  );
}
for (const [name, at] of [...firstSeenSurface].sort((a, b) => a[1] - b[1])) {
  console.log(`  ${name.padEnd(11)} ${(at / 1000).toFixed(0)} km  (surface)`);
}
{
  const eras = poleEraSegments().filter((b) => b.start < DRIVE_KM * 1000);
  const kinds = new Set(eras.map((b) => b.era));
  console.log(
    `  pole eras    ${[...kinds].sort().join('/')} — ${eras.length} band(s) inside the drive`,
  );
}
console.log('');
console.log('what the drive is made of');
const driveM = DRIVE_KM * 1000;
for (const c of CHARACTERS) {
  const bucket = perCharacter.get(c.name);
  if (!bucket) continue;
  const radius = (q: number): string => {
    const k = percentile(bucket.curvature, q);
    return k > 1e-5 ? `${(1 / k).toFixed(0)}` : 'inf';
  };
  console.log(
    `  ${c.name.padEnd(11)} ${((bucket.metres / driveM) * 100).toFixed(0).padStart(3)}% of the drive  ` +
      `radius p10 ${radius(0.9).padStart(5)} m  median ${radius(0.5).padStart(5)} m  ` +
      `|grade| p90 ${(percentile(bucket.grades, 0.9) * 100).toFixed(1)}%  ` +
      `sight p10 ${percentile(bucket.sight, 0.1).toFixed(0)} m  ` +
      `allows ${percentile(bucket.ceiling, 0.5).toFixed(0)} km/h`,
  );
}
console.log('');
console.log(`districts: ${districts.length} runs in ${DRIVE_KM} km`);
console.log(
  '  first twelve: ' +
    districts
      .slice(0, 12)
      .map((d) => `${d.name} ${(d.metres / 1000).toFixed(0)}km`)
      .join(', '),
);
{
  const lengths = districts.map((d) => d.metres / 1000);
  console.log(
    `  length: median ${percentile(lengths, 0.5).toFixed(0)} km  ` +
      `shortest ${percentile(lengths, 0).toFixed(0)} km  longest ${percentile(lengths, 1).toFixed(0)} km`,
  );
  let repeats = 0;
  for (let i = 1; i < districts.length; i++) {
    if (districts[i]!.name === districts[i - 1]!.name) repeats++;
  }
  console.log(`  adjacent repeats: ${repeats} of ${districts.length - 1} boundaries`);
}
console.log('');
// The whole-road numbers the traffic bench reads, so the two can be compared.
{
  const curvature: number[] = [];
  const pace: number[] = [];
  for (let s = 0; s < driveM; s += STEP_M) {
    road.conditionAt(s, condition);
    curvature.push(Math.abs(road.curvatureAt(s)));
    pace.push(surfacePaceFactor('sleeper', condition));
  }
  const radius = (q: number): string => {
    const k = percentile(curvature, q);
    return k > 1e-5 ? `${(1 / k).toFixed(0)} m` : 'inf';
  };
  // THE CURVE CENSUS, and it is the number the owner's complaint is about. A radius
  // percentile over every sample is dominated by the STRAIGHTS — which is why the road
  // read as straight while its corners were fine — so the geometry is measured the way a
  // road survey measures it: runs of curvature, their peak radius, their length, and the
  // turning they accumulate per kilometre.
  //
  // The reference is real secondary roads, measured from a national GIS (Czech ROCA,
  // 9 980 km, 42 752 curves) and from laser scanning (Norway, 63 969 curves): a curve
  // every 200-250 m, peak radii mostly 50-250 m, curve length about 100 m, 36-43% of the
  // length inside a curve, and 94 degrees of turning per kilometre (median). Sources in
  // docs/research-2026-09-26-landscape.md.
  {
    const CURVE_K = 1 / 1200;
    const runs: number[][] = [];
    const peaks: number[] = [];
    let run: number[] = [];
    let inCurve = false;
    const sampled: number[] = [];
    for (let s = 0; s < driveM; s += STEP_M) {
      const k = Math.abs(road.curvatureAt(s));
      sampled.push(k);
      if (k > CURVE_K) {
        run.push(k);
        inCurve = true;
      } else if (inCurve) {
        runs.push(run);
        peaks.push(Math.max(...run));
        run = [];
        inCurve = false;
      }
    }
    if (inCurve) {
      runs.push(run);
      peaks.push(Math.max(...run));
    }
    const km = driveM / 1000;
    const curveLength = runs.reduce((sum, r) => sum + r.length * STEP_M, 0);
    // Peak RADII, tightest first: a higher curvature percentile is a SMALLER radius, so
    // the list is inverted before it is read.
    const peakRadii = peaks.map((k) => 1 / k).sort((a, b) => a - b);
    const peakRadius = (q: number): string =>
      peakRadii.length ? `${peakRadii[Math.min(peakRadii.length - 1, Math.round(q * (peakRadii.length - 1)))]!.toFixed(0)} m` : '-';
    // Turning per kilometre, integrated at the node spacing: at 25 m the sampler skips
    // whole transitions and reports a tenth of the real turning.
    let turning = 0;
    let previousHeading = road.sampleAt(0).heading;
    for (let s = 4; s < driveM; s += 4) {
      const nextHeading = road.sampleAt(s).heading;
      turning += Math.abs(nextHeading - previousHeading);
      previousHeading = nextHeading;
    }
    turning = (turning * 180) / Math.PI;
    const meanCurve = runs.length ? curveLength / runs.length : 0;
    const straightBetween = runs.length > 1 ? (driveM - curveLength) / runs.length : 0;
    console.log(
      `curve census: ${(runs.length / km).toFixed(2)} curves per km  |  ${((100 * curveLength) / driveM).toFixed(0)}% of the length in a curve` +
        `  |  curve length mean ${meanCurve.toFixed(0)} m, straight between ${straightBetween.toFixed(0)} m`,
    );
    // A HEADING STEP IS NOT A CORNER, and it is the failure this sequence can make
    // silently: the largest change of bearing between two nodes four metres apart. A real
    // 100 m corner turns 2.3 degrees in four metres; anything past ten is a kink.
    let worstStep = 0;
    let worstStepS = 0;
    let previous = road.sampleAt(0).heading;
    for (let s = 4; s < driveM; s += 4) {
      const here = road.sampleAt(s).heading;
      const step = Math.abs(here - previous);
      if (step > worstStep) {
        worstStep = step;
        worstStepS = s;
      }
      previous = here;
    }
    console.log(
      `  worst heading step ${((worstStep * 180) / Math.PI).toFixed(1)} deg in 4 m at s=${Math.round(worstStepS)}` +
        `  |  ${worstStep > 0.09 ? 'FAIL: the heading jumps' : 'ok'}`,
    );
    let tightest = 0;
    let tightestS = 0;
    for (let s = 0; s < driveM; s += 4) {
      const k = Math.abs(road.curvatureAt(s));
      if (k > tightest) {
        tightest = k;
        tightestS = s;
      }
    }
    characterAt(SEED, tightestS, character);
    console.log(
      `  tightest corner ${(1 / tightest).toFixed(0)} m at s=${Math.round(tightestS)} (${character.name})`,
    );
    console.log(
      `  peak radius: p10 ${peakRadius(0.1)}, median ${peakRadius(0.5)}, p90 ${peakRadius(0.9)}` +
        `  |  turning ${(turning / km).toFixed(0)} deg/km` +
        `  |  [real secondary roads: 4-5 curves/km, 36-43% in curves, curves ~100 m, 94 deg/km, peak radii mostly 50-250 m]`,
    );
  }
  // THE VILLAGE BEND, measured where it acts: the heading change across a village's own
  // span against the same-length change at every other arclength of the drive. A road that
  // bends at its villages shows a distribution with a shoulder where the villages are.
  {
    const span = (from: number, to: number): number =>
      Math.abs(road.sampleAt(to).heading - road.sampleAt(Math.max(0, from)).heading);
    const villageChanges: number[] = [];
    for (const village of villagesBetween(SEED, 0, driveM)) {
      villageChanges.push(span(village.from - 40, village.to + 40));
    }
    const anywhere: number[] = [];
    for (let s = 0; s + 600 < driveM; s += 50) anywhere.push(span(s, s + 600));
    anywhere.sort((a, b) => a - b);
    const median = anywhere[Math.floor(anywhere.length / 2)] ?? 0;
    const mean = villageChanges.length ? villageChanges.reduce((a, b) => a + b, 0) / villageChanges.length : 0;
    const bent = villageChanges.filter((v) => v > 0.3).length;
    console.log(
      `village bends: ${villageChanges.length} villages, mean heading change ${((mean * 180) / Math.PI).toFixed(0)} deg` +
        `  |  ${bent} of them turn more than 17 deg  |  a random 600 m of the road turns ${((median * 180) / Math.PI).toFixed(0)} deg (median)`,
    );
  }
  console.log('whole drive');
  console.log(
    `  radius: p1 ${radius(0.99)}  p10 ${radius(0.9)}  median ${radius(0.5)}`,
  );
  console.log(
    `  surface pace: p05 ${percentile(pace, 0.05).toFixed(2)}  median ${percentile(pace, 0.5).toFixed(2)}`,
  );
}
