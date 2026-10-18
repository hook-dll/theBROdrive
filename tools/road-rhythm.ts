/**
 * tools/road-rhythm.ts
 *
 * WHAT THE ROAD ASKS OF A WEAK CAR, AND WHAT IT SHOWS THE DRIVER. One walk of the real
 * `Road` per seed, reporting the numbers the rolling-relief work is judged on:
 *
 *   curves     corners per km (a run of road tighter than 1 km radius, at least 20 m
 *              long, counted once) and the distribution of their tightest radius
 *   grade      |grade| over a 20 m chord: p50 / p90 / p99 / max
 *   climbs     a climb is a rise of at least 2 m between a low and the next high on
 *              the 20 m-smoothed profile (2 m hysteresis); mean climb and descent
 *              length, the longest and the tallest climb
 *   loss       THE WEAKEST CAR over the whole drive (lowest power to weight in the
 *              catalogue, a 75 kg driver aboard): full throttle in its best gear on its
 *              own torque curve and gearing whenever it is under the 90 km/h limit,
 *              held there otherwise, rolling resistance of the district's surface,
 *              Cd·A from the catalogue. It never brakes for a corner, so the loss is
 *              the road's vertical profile alone. Reported: the worst speed loss
 *              anywhere (90 minus the lowest speed), where it happened, and the
 *              climb it happened on
 *   crests     a crest is BLIND when, from 60 m short of the high point, the road's own
 *              profile hides a 0.6 m object less than 150 m ahead
 *              (`Road.sightDistanceAt`, the sight line the traffic uses); per km.
 *              Corners ON RELIEF: apex on a 3% grade or within 150 m of a crest
 *   banking    share of the road banked, and the largest cross-slope
 *
 * Asserts the climb budget: a seed whose worst loss exceeds `LOSS_LIMIT_KMH` fails
 * (exit 1). Heavy: run under `nice -n 15`, one at a time.
 *
 *   npx tsx tools/road-rhythm.ts [seeds=1,7,42,1337] [km=300] [startKm=0]
 *
 * Nothing here is part of the game bundle.
 */

import { SURFACES, type SurfaceType } from '../src/core/surfaces';
import { engineTorqueNm } from '../src/vehicle/drivetrain';
import { CAR_MODELS, modelEngine, modelGearbox, type CarModelDef } from '../src/vehicle/carmodels';
import fits from '../src/vehicle/model-fits.json';
import { Road } from '../src/world/road';
import { NODE_SPACING } from '../src/world/roadcurve';

import { WEAK_CAR } from '../src/world/roadswells';

const seeds = (process.argv[2] ?? '1,7,42,1337').split(',').map(Number);
const KM = Number(process.argv[3] ?? 300);
const START_KM = Number(process.argv[4] ?? 0);

/** The speed limit, and the cruise the weak car is asked to hold, km/h. */
const CRUISE_KMH = 90;
/** The owner's budget: a weak car loses at most about 10-15 km/h over any climb. */
const LOSS_LIMIT_KMH = 15;
const DRIVER_KG = 75;
const GRAVITY = 9.81;
const AIR_DENSITY = 1.2;
/** Rotating inertia (wheels, driveline) as a share of the mass, for the acceleration. */
const ROTATING_SHARE = 0.05;
const FALLBACK_WHEEL_RADIUS = 0.3;
const CHORD_M = 20;
const CLIMB_HYSTERESIS_M = 2;
const CORNER_CURVATURE = 1 / 1000;
const CORNER_MIN_M = 20;
const BLIND_SIGHT_M = 150;
const BLIND_LOOKBACK_M = 60;

function wheelRadiusOf(def: CarModelDef): number {
  const fit = (fits as Record<string, { wheels?: { radius: number }[] } | undefined>)[def.id];
  const wheels = fit?.wheels;
  if (!wheels || wheels.length === 0) return FALLBACK_WHEEL_RADIUS;
  return wheels.reduce((sum, w) => sum + w.radius, 0) / wheels.length;
}

/** The catalogue's weakest car by peak power per kilogram, driver aboard. */
const weakest = CAR_MODELS.filter((d) => d.bodyClass === 'car').reduce((worst, d) =>
  modelEngine(d).peakPowerKw / (d.mass + DRIVER_KG) <
  modelEngine(worst).peakPowerKw / (worst.mass + DRIVER_KG)
    ? d
    : worst,
);
const ENGINE = modelEngine(weakest);
const GEARBOX = modelGearbox(weakest);
const WHEEL_R = wheelRadiusOf(weakest);
const MASS = weakest.mass + DRIVER_KG;
const DRAG_AREA = weakest.dragArea ?? 0.8;
const RPM_PER_MS = (60 / (2 * Math.PI)) / WHEEL_R;

/** Full-throttle tractive force at `v` m/s in the best gear, newtons. */
function driveForce(v: number): number {
  let best = 0;
  for (const ratio of GEARBOX.ratios) {
    const total = ratio * GEARBOX.finalDrive;
    const rpm = Math.max(ENGINE.idleRpm, v * total * RPM_PER_MS);
    if (rpm >= ENGINE.redlineRpm) continue;
    const force = (engineTorqueNm(ENGINE, rpm) * total * GEARBOX.efficiency) / WHEEL_R;
    if (force > best) best = force;
  }
  return best;
}

function percentile(sorted: Float64Array | number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
}

interface Climb {
  readonly startS: number;
  readonly endS: number;
  readonly rise: number;
}

let failed = false;
console.log(
  `weakest car: ${weakest.label} (${weakest.id}), ${ENGINE.peakPowerKw} kW, ${MASS} kg with driver, ` +
    `${((ENGINE.peakPowerKw * 1000) / MASS).toFixed(1)} W/kg, Cd·A ${DRAG_AREA}, wheel ${WHEEL_R.toFixed(3)} m; ` +
    `cruise ${CRUISE_KMH} km/h, budget ${LOSS_LIMIT_KMH} km/h`,
);
// The swells are budgeted on `WEAK_CAR` (roadswells.ts), a point mass with a flat
// wheel power. It has to be no stronger than the catalogue's weakest car really is
// between 60 and 90 km/h, or the budget is spent on a car nobody drives.
for (let kmh = 60; kmh <= 90; kmh += 5) {
  const v = kmh / 3.6;
  const real = driveForce(v) * v;
  if (real < WEAK_CAR.wheelPowerW || MASS > WEAK_CAR.massKg || DRAG_AREA > WEAK_CAR.dragArea) {
    failed = true;
    console.log(
      `FAIL  WEAK_CAR (${WEAK_CAR.wheelPowerW} W, ${WEAK_CAR.massKg} kg, Cd·A ${WEAK_CAR.dragArea}) is stronger than ` +
        `${weakest.id} at ${kmh} km/h (${real.toFixed(0)} W at the wheels, ${MASS} kg, Cd·A ${DRAG_AREA})`,
    );
  }
}

for (const seed of seeds) {
  const road = new Road(seed);
  const startS = START_KM * 1000;
  const n = Math.floor((KM * 1000) / NODE_SPACING);
  const ys = new Float64Array(n + 1);
  const kappa = new Float64Array(n + 1);
  const bank = new Float64Array(n + 1);
  const rolling = new Float64Array(n + 1);
  const condition = { surface: 0 as SurfaceType, decay: 0, sandCover: 0, markings: 0 };
  for (let i = 0; i <= n; i++) {
    const s = startS + i * NODE_SPACING;
    const sample = road.sampleAt(s);
    ys[i] = sample.y;
    kappa[i] = sample.curvature;
    bank[i] = road.bankingAt(s);
    if (i % 25 === 0) road.conditionAt(s, condition);
    rolling[i] = SURFACES[condition.surface].rollingResistance;
  }
  const chord = CHORD_M / NODE_SPACING;

  // --- grade ---
  const grades: number[] = [];
  for (let i = 0; i + chord <= n; i += 2) grades.push(Math.abs(ys[i + chord]! - ys[i]!) / CHORD_M);
  grades.sort((a, b) => a - b);

  // --- corners ---
  const radii: number[] = [];
  const apexes: number[] = [];
  let runApex = 0;
  let runStart = -1;
  let runPeak = 0;
  for (let i = 0; i <= n; i++) {
    const k = Math.abs(kappa[i]!);
    if (k >= CORNER_CURVATURE) {
      if (runStart < 0) {
        runStart = i;
        runPeak = 0;
      }
      if (k > runPeak) runApex = i;
      runPeak = Math.max(runPeak, k);
    } else if (runStart >= 0) {
      if ((i - runStart) * NODE_SPACING >= CORNER_MIN_M) {
        radii.push(1 / runPeak);
        apexes.push(runApex);
      }
      runStart = -1;
    }
  }
  radii.sort((a, b) => a - b);
  const bins = [150, 300, 600, 1000];
  const binCounts = bins.map(
    (edge, j) => radii.filter((r) => r < edge && r >= (j === 0 ? 0 : bins[j - 1]!)).length,
  );

  // --- climbs, on the chord-smoothed profile with hysteresis ---
  const half = chord >> 1;
  const smooth = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n, i + half);
    let sum = 0;
    for (let j = a; j <= b; j++) sum += ys[j]!;
    smooth[i] = sum / (b - a + 1);
  }
  const climbs: Climb[] = [];
  const descents: Climb[] = [];
  let lowI = 0;
  let highI = 0;
  let rising = smooth[Math.min(n, chord)]! >= smooth[0]!;
  for (let i = 1; i <= n; i++) {
    const y = smooth[i]!;
    if (rising) {
      if (y > smooth[highI]!) highI = i;
      else if (smooth[highI]! - y >= CLIMB_HYSTERESIS_M) {
        if (smooth[highI]! - smooth[lowI]! >= CLIMB_HYSTERESIS_M) {
          climbs.push({ startS: lowI * NODE_SPACING, endS: highI * NODE_SPACING, rise: smooth[highI]! - smooth[lowI]! });
        }
        rising = false;
        lowI = i;
      }
    } else {
      if (y < smooth[lowI]!) lowI = i;
      else if (y - smooth[lowI]! >= CLIMB_HYSTERESIS_M) {
        descents.push({ startS: highI * NODE_SPACING, endS: lowI * NODE_SPACING, rise: smooth[lowI]! - smooth[highI]! });
        rising = true;
        highI = i;
      }
    }
  }
  const meanLength = (list: Climb[]) =>
    list.length === 0 ? 0 : list.reduce((sum, c) => sum + (c.endS - c.startS), 0) / list.length;
  const longest = climbs.reduce<Climb | null>((best, c) => (!best || c.endS - c.startS > best.endS - best.startS ? c : best), null);
  const tallest = climbs.reduce<Climb | null>((best, c) => (!best || c.rise > best.rise ? c : best), null);

  // --- the weak car ---
  const cruise = CRUISE_KMH / 3.6;
  let v = cruise;
  let worstLoss = 0;
  let worstI = 0;
  const lossOnClimb = new Float64Array(climbs.length);
  let climbIndex = 0;
  for (let i = 0; i < n; i++) {
    const slope = (ys[i + 1]! - ys[i]!) / NODE_SPACING;
    const sinA = slope / Math.sqrt(1 + slope * slope);
    const resist = MASS * GRAVITY * (sinA + rolling[i]!) + 0.5 * AIR_DENSITY * DRAG_AREA * v * v;
    const drive = v < cruise ? driveForce(v) : Math.min(driveForce(v), Math.max(0, resist));
    const accel = (drive - resist) / (MASS * (1 + ROTATING_SHARE));
    v = Math.sqrt(Math.max(0.25, v * v + 2 * accel * NODE_SPACING));
    if (v > cruise) v = cruise;
    const loss = (cruise - v) * 3.6;
    if (loss > worstLoss) {
      worstLoss = loss;
      worstI = i;
    }
    const s = i * NODE_SPACING;
    while (climbIndex < climbs.length && climbs[climbIndex]!.endS + 200 < s) climbIndex++;
    if (climbIndex < climbs.length && s >= climbs[climbIndex]!.startS) {
      lossOnClimb[climbIndex] = Math.max(lossOnClimb[climbIndex]!, loss);
    }
  }
  const worstS = worstI * NODE_SPACING;
  const worstClimb = climbs.find((c) => c.startS <= worstS && worstS <= c.endS + 200);
  const lossOf = (c: Climb | null | undefined) => (c ? lossOnClimb[climbs.indexOf(c)]! : 0);
  const over10 = Array.from(lossOnClimb).filter((l) => l > 10).length;

  // --- crests ---
  let blind = 0;
  for (let j = 1; j < climbs.length; j++) {
    const crestS = startS + climbs[j]!.endS;
    if (road.sightDistanceAt(crestS - BLIND_LOOKBACK_M, 400) < BLIND_SIGHT_M) blind++;
  }
  // A corner ON relief: its apex on a 3% grade or steeper, or within 150 m of a crest.
  // And the other way round: the share of crests with a corner's apex within 150 m.
  let onRelief = 0;
  let crestIndex = 0;
  let crestCorners = 0;
  let apexIndex = 0;
  for (const apex of apexes) {
    const a = Math.max(0, apex - chord);
    const b = Math.min(n, apex + chord);
    const grade = Math.abs(ys[b]! - ys[a]!) / ((b - a) * NODE_SPACING);
    const s = apex * NODE_SPACING;
    while (crestIndex < climbs.length && climbs[crestIndex]!.endS < s - 150) crestIndex++;
    const nearCrest = crestIndex < climbs.length && Math.abs(climbs[crestIndex]!.endS - s) <= 150;
    if (grade >= 0.03 || nearCrest) onRelief++;
  }
  for (const climb of climbs) {
    while (apexIndex < apexes.length && apexes[apexIndex]! * NODE_SPACING < climb.endS - 150) apexIndex++;
    if (apexIndex < apexes.length && Math.abs(apexes[apexIndex]! * NODE_SPACING - climb.endS) <= 150) crestCorners++;
  }

  // --- banking ---
  let banked = 0;
  let maxBank = 0;
  for (let i = 0; i <= n; i++) {
    const b = Math.abs(bank[i]!);
    if (b > 0.005) banked++;
    maxBank = Math.max(maxBank, b);
  }

  const km = KM;
  const f = (x: number, d = 1) => x.toFixed(d);
  console.log(`\nseed ${seed}, km ${START_KM}-${START_KM + KM}`);
  console.log(
    `  curves    ${f(radii.length / km, 2)}/km  radius p10 ${f(percentile(radii, 0.1), 0)} p50 ${f(percentile(radii, 0.5), 0)} p90 ${f(percentile(radii, 0.9), 0)} m  ` +
      `<150 ${binCounts[0]} | 150-300 ${binCounts[1]} | 300-600 ${binCounts[2]} | 600-1000 ${binCounts[3]}`,
  );
  console.log(
    `  grade     p50 ${f(percentile(grades, 0.5) * 100)}%  p90 ${f(percentile(grades, 0.9) * 100)}%  p99 ${f(percentile(grades, 0.99) * 100)}%  max ${f(grades[grades.length - 1]! * 100)}%  ` +
      `net ${f(ys[n]! - ys[0]!, 0)} m, range ${f(Math.min(...ys), 0)}..${f(Math.max(...ys), 0)} m`,
  );
  console.log(
    `  climbs    ${f(climbs.length / km, 2)}/km  mean climb ${f(meanLength(climbs), 0)} m, mean descent ${f(meanLength(descents), 0)} m  ` +
      `longest ${longest ? `${f(longest.endS - longest.startS, 0)} m/${f(longest.rise)} m at km ${f((startS + longest.startS) / 1000)} (loss ${f(lossOf(longest))} km/h)` : '-'}  ` +
      `tallest ${tallest ? `${f(tallest.rise)} m over ${f(tallest.endS - tallest.startS, 0)} m (loss ${f(lossOf(tallest))} km/h)` : '-'}`,
  );
  console.log(
    `  weak car  worst loss ${f(worstLoss)} km/h at km ${f((startS + worstS) / 1000, 2)}` +
      (worstClimb ? ` on a ${f(worstClimb.endS - worstClimb.startS, 0)} m climb of ${f(worstClimb.rise)} m` : '') +
      `; climbs costing over 10 km/h: ${over10}`,
  );
  console.log(
    `  crests    ${f(climbs.length / km, 2)}/km, blind ${f(blind / km, 2)}/km, with a corner ${f((crestCorners / Math.max(1, climbs.length)) * 100, 0)}%  corners on relief ${f((onRelief / Math.max(1, apexes.length)) * 100, 0)}%  banking on ${f((banked / (n + 1)) * 100, 0)}% of the road, max ${f(maxBank * 100)}%`,
  );
  if (worstLoss > LOSS_LIMIT_KMH) {
    failed = true;
    console.log(`  FAIL      worst loss ${f(worstLoss)} km/h > ${LOSS_LIMIT_KMH}`);
  }
}
process.exit(failed ? 1 : 0);
