/**
 * tools/road-profile.ts
 *
 * Elevation bench for the road generator. It walks the real `Road` (no
 * re-implementation) for several seeds and reports what a driver would notice:
 * the grade under the bonnet, how often the road crests, how much of the route is
 * hill country, and the total relief.
 *
 * The grade columns are the ones that matter. Total relief can be large while the
 * road still looks flat from the seat — that was exactly the first tuning mistake
 * here — because what reads as "hills" is the pitch of the road ahead, not the
 * altitude difference between two points ten kilometres apart.
 *
 *   npx tsx tools/road-profile.ts
 *
 * Nothing here is part of the game bundle.
 */

import { Road } from '../src/world/road';

export interface ProfileResult {
  seed: number;
  /** Metres of elevation between the lowest and highest point sampled. */
  reliefM: number;
  /** Mean absolute grade over the route, percent. */
  meanGradePct: number;
  /** Mean absolute grade over the hill-country stretches only, percent. */
  hillyGradePct: number;
  /** Fraction of the route steeper than 5%, which is where a gear is needed. */
  steepFraction: number;
  /** Steepest grade found, percent, and where. */
  maxGradePct: number;
  maxGradeAtKm: number;
  /** Direction changes (crest or dip) per kilometre. */
  crestsPerKm: number;
  /** Median rise or fall between consecutive direction changes, metres. */
  medianBrowM: number;
  /** Fraction of the route in flat and in hill country. */
  flatFraction: number;
  hillyFraction: number;
  /** Vertical metres climbed per kilometre driven. */
  climbPerKm: number;
}

export function profileRoad(seed: number, lengthM = 60_000, stepM = 10): ProfileResult {
  const road = new Road(seed);
  let minY = Infinity;
  let maxY = -Infinity;
  let gradeSum = 0;
  let hillyGradeSum = 0;
  let hillySamples = 0;
  let steep = 0;
  let maxGrade = 0;
  let maxGradeAt = 0;
  let crests = 0;
  let climb = 0;
  let flat = 0;
  let hilly = 0;
  let samples = 0;
  let prevGrade = 0;
  let prevY = road.sampleAt(0).y;
  let localMin = prevY;
  let localMax = prevY;
  const brows: number[] = [];

  for (let s = 0; s <= lengthM; s += stepM) {
    const c = road.sampleAt(s);
    const g = c.grade;
    const h = road.hillinessAt(s);
    minY = Math.min(minY, c.y);
    maxY = Math.max(maxY, c.y);
    gradeSum += Math.abs(g);
    if (Math.abs(g) > 0.05) steep++;
    if (h > 0.75) {
      hillyGradeSum += Math.abs(g);
      hillySamples++;
      hilly++;
    }
    if (h < 0.55) flat++;
    if (Math.abs(g) > maxGrade) {
      maxGrade = Math.abs(g);
      maxGradeAt = s;
    }
    if (s > 0 && Math.sign(g) !== Math.sign(prevGrade)) {
      crests++;
      brows.push(Math.abs(localMax - localMin));
      localMin = c.y;
      localMax = c.y;
    }
    localMin = Math.min(localMin, c.y);
    localMax = Math.max(localMax, c.y);
    if (c.y > prevY) climb += c.y - prevY;
    prevGrade = g;
    prevY = c.y;
    samples++;
  }

  brows.sort((a, b) => a - b);
  const km = lengthM / 1000;
  return {
    seed,
    reliefM: +(maxY - minY).toFixed(1),
    meanGradePct: +((gradeSum / samples) * 100).toFixed(2),
    hillyGradePct: +((hillyGradeSum / Math.max(1, hillySamples)) * 100).toFixed(2),
    steepFraction: +(steep / samples).toFixed(2),
    maxGradePct: +(maxGrade * 100).toFixed(2),
    maxGradeAtKm: +(maxGradeAt / 1000).toFixed(2),
    crestsPerKm: +(crests / km).toFixed(2),
    medianBrowM: +(brows[Math.floor(brows.length / 2)] ?? 0).toFixed(1),
    flatFraction: +(flat / samples).toFixed(2),
    hillyFraction: +(hilly / samples).toFixed(2),
    climbPerKm: +(climb / km).toFixed(1),
  };
}

/** Sampled elevation, for eyeballing a stretch: `[km, y]` pairs. */
export function elevationTrace(seed: number, fromM: number, toM: number, stepM = 50): number[][] {
  const road = new Road(seed);
  const out: number[][] = [];
  for (let s = fromM; s <= toM; s += stepM) {
    out.push([+(s / 1000).toFixed(2), +road.sampleAt(s).y.toFixed(1)]);
  }
  return out;
}

for (const seed of [1, 2, 7, 42, 1337, 90210]) {
  const r = profileRoad(seed);
  console.log(
    `seed ${String(r.seed).padStart(6)}: relief ${String(r.reliefM).padStart(6)} m  ` +
      `grade mean ${r.meanGradePct}% (hill country ${r.hillyGradePct}%, max ${r.maxGradePct}%)  ` +
      `steeper than 5% for ${(r.steepFraction * 100).toFixed(0)}% of the route  ` +
      `${r.crestsPerKm} crests/km, median brow ${r.medianBrowM} m  ` +
      `hilly ${(r.hillyFraction * 100).toFixed(0)}% / flat ${(r.flatFraction * 100).toFixed(0)}%  ` +
      `climb ${r.climbPerKm} m/km`,
  );
}
