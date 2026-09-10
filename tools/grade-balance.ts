/**
 * tools/grade-balance.ts
 *
 * Answers one question with measurements: does the road climb more than it
 * descends?
 *
 * The road carries no elevation state — `Road.sampleAt` reads `Landscape.heightAt`
 * under the centreline and differences the 4 m nodes for grade (see road.ts). So the
 * only thing that can bias climbs against descents is the landscape field itself
 * plus how the drive samples it. This walks the real centreline recurrence
 * (`stepNode`, exactly what `buildSpine` runs) and the real height field, so the
 * numbers are the road the player drives, not a model of it.
 *
 * Three families of numbers, because "more climbing" can mean three different
 * things and they do NOT have the same answer:
 *
 *   1. GEOMETRY, per metre of road: metres of ascent vs descent, and the road
 *      distance spent above/below a grade threshold. This is what the generator
 *      controls.
 *
 *   2. EPISODES: sustained climbs and descents after hysteresis, i.e. what a driver
 *      would call "a hill" rather than a ripple. Counts, mean lengths, and how much
 *      of the drive sits in long (>= 500 m) runs of each sign.
 *
 *   3. TIME, which is what perception actually integrates. Speed is a plain
 *      power-balance estimate for the starting car (mass, Cd·A and peak power read
 *      from the catalogue below, rolling resistance and a top-speed cap stated as
 *      constants) — an approximation of the sim, not the sim.
 *
 *   npx tsx tools/grade-balance.ts [seeds] [km]
 */

import { Landscape } from '../src/world/landscape';
import { NODE_SPACING, RoadHeading, stepNode, type NodeState } from '../src/world/roadcurve';

/**
 * Where measurement begins, metres from the house. Default skips the homestead
 * flattening; a large value is how the near-home stretch is separated from open road,
 * which matters because the house sits exactly on the relief lattice's corner (see the
 * origin note in the aggregate output).
 */
let startM = 10_000;

/** Grade magnitude below which road counts as level, fraction. */
const FLAT_BAND = 0.005;

/**
 * Window the grade is judged over for episodes, metres. A hill is a sustained thing;
 * differencing 4 m nodes measures the ripple layer instead.
 */
const EPISODE_WINDOW_M = 100;
/** Enter a run at this grade, leave it below `EPISODE_EXIT` — plain hysteresis. */
const EPISODE_ENTER = 0.012;
const EPISODE_EXIT = 0.004;
/** A run this long or longer is a hill you would remember. */
const LONG_RUN_M = 500;
/**
 * SIGHT DISTANCE, which is why geometry and perception can disagree.
 *
 * A driver does not integrate grade, they integrate what is on the screen. An
 * upgrade tilts the road INTO view, so the whole climb is visible from its foot; a
 * downgrade falls away behind its own crest and is hidden until it is being driven.
 * So the same metre of road is on screen for very different lengths of time
 * depending on its sign, and this measures that directly: from the driver's eye,
 * how much of the centreline ahead is unoccluded by the ground between.
 *
 * Centreline only. The real view is also cut by terrain berms and blocked by
 * corners, both of which make the effect stronger, not weaker.
 */
const EYE_HEIGHT_M = 1.25;
/** Furthest the metric looks, metres. Beyond this the road is a texture anyway. */
let SIGHT_HORIZON_M = 2000;
/** Resolution the sightline is tested at, metres. */
const SIGHT_STEP_M = 20;
/** Road distance between eye points, metres. */
const SIGHT_SPACING_M = 100;

// --- the speed estimate's car: VAZ-2101 kerb mass, its 1.2 Cd·A, its 46 kW ------
const CAR_MASS_KG = 955;
const CAR_DRAG_AREA = 0.72;
const CAR_POWER_KW = 46;
/** Fraction of crank power at the wheels. */
const DRIVELINE_EFFICIENCY = 0.85;
const ROLLING_RESISTANCE = 0.014;
const AIR_DENSITY = 1.2;
const GRAVITY = 9.81;
/** Cruise the driver holds when the road does not stop them, m/s (~95 km/h). */
const CRUISE_MS = 26;
/** Slowest a loaded climb is ever crawled, m/s: below this you have stopped. */
const MIN_MS = 4;

/**
 * Steady speed on a constant grade: the largest v with
 * `P_wheel >= v * (m g (grade + Crr) + 0.5 rho Cd A v^2)`, bisected because the
 * cubic's closed form buys nothing here. Descents are capped at the cruise speed
 * rather than allowed to run away, which is the conservative choice: letting them
 * accelerate downhill would only widen the time asymmetry this reports.
 */
function speedOnGrade(grade: number): number {
  const power = CAR_POWER_KW * 1000 * DRIVELINE_EFFICIENCY;
  const resist = (v: number) =>
    v * (CAR_MASS_KG * GRAVITY * (grade + ROLLING_RESISTANCE) + 0.5 * AIR_DENSITY * CAR_DRAG_AREA * v * v);
  if (resist(CRUISE_MS) <= power) return CRUISE_MS;
  let lo = 0;
  let hi = CRUISE_MS;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (resist(mid) <= power) lo = mid;
    else hi = mid;
  }
  return Math.max(MIN_MS, lo);
}

interface Run {
  readonly sign: 1 | -1;
  readonly lengthM: number;
  readonly riseM: number;
}

interface SeedStats {
  readonly seed: number;
  readonly ascentM: number;
  readonly descentM: number;
  readonly netM: number;
  readonly upM: number;
  readonly downM: number;
  readonly flatM: number;
  readonly upTimeS: number;
  readonly downTimeS: number;
  readonly flatTimeS: number;
  readonly runs: readonly Run[];
  readonly meanUpGrade: number;
  readonly meanDownGrade: number;
  /** Sight distance summed over eye points on upgrades, downgrades and level road. */
  readonly sightUpM: number;
  readonly sightUpPoints: number;
  readonly sightDownM: number;
  readonly sightDownPoints: number;
  readonly sightFlatM: number;
  readonly sightFlatPoints: number;
  /** Visible road metres ahead whose own grade climbs / falls, over all eye points. */
  readonly seenUpM: number;
  readonly seenDownM: number;
  /** Vertical angle (radians, summed) those visible metres subtend from the eye. */
  readonly screenUp: number;
  readonly screenDown: number;
}

/** Elevations at every node over the measured stretch, from the real recurrence. */
function walk(seed: number, lengthM: number): Float64Array {
  const landscape = new Landscape(seed);
  const heading = new RoadHeading(seed);
  const node: NodeState = { x: 0, z: 0 };
  const nodes = Math.floor((startM + lengthM) / NODE_SPACING);
  const skip = Math.floor(startM / NODE_SPACING);
  const ys = new Float64Array(nodes - skip + 1);
  for (let i = 1; i <= nodes; i++) {
    stepNode(node, heading, i - 1);
    if (i >= skip) ys[i - skip] = landscape.heightAt(node.x, node.z);
  }
  return ys;
}

function analyse(seed: number, lengthM: number): SeedStats {
  const ys = walk(seed, lengthM);

  let ascentM = 0;
  let descentM = 0;
  let upM = 0;
  let downM = 0;
  let flatM = 0;
  let upTimeS = 0;
  let downTimeS = 0;
  let flatTimeS = 0;
  let upGradeSum = 0;
  let downGradeSum = 0;

  for (let i = 1; i < ys.length; i++) {
    const rise = ys[i]! - ys[i - 1]!;
    const grade = rise / NODE_SPACING;
    if (rise > 0) ascentM += rise;
    else descentM -= rise;
    const t = NODE_SPACING / speedOnGrade(grade);
    if (grade > FLAT_BAND) {
      upM += NODE_SPACING;
      upTimeS += t;
      upGradeSum += grade * NODE_SPACING;
    } else if (grade < -FLAT_BAND) {
      downM += NODE_SPACING;
      downTimeS += t;
      downGradeSum += grade * NODE_SPACING;
    } else {
      flatM += NODE_SPACING;
      flatTimeS += t;
    }
  }

  // Episodes, on the windowed grade.
  const stride = Math.max(1, Math.round(EPISODE_WINDOW_M / NODE_SPACING));
  const runs: Run[] = [];
  let sign: 1 | -1 | 0 = 0;
  let runStart = 0;
  const close = (endIdx: number) => {
    if (sign === 0) return;
    const lengthOfRun = (endIdx - runStart) * NODE_SPACING;
    if (lengthOfRun > 0) {
      runs.push({ sign, lengthM: lengthOfRun, riseM: ys[endIdx]! - ys[runStart]! });
    }
    sign = 0;
  };
  for (let i = stride; i < ys.length; i += stride) {
    const grade = (ys[i]! - ys[i - stride]!) / (stride * NODE_SPACING);
    const mid = i - stride;
    if (sign === 0) {
      if (grade >= EPISODE_ENTER) {
        sign = 1;
        runStart = mid;
      } else if (grade <= -EPISODE_ENTER) {
        sign = -1;
        runStart = mid;
      }
    } else if (sign === 1 ? grade < EPISODE_EXIT : grade > -EPISODE_EXIT) {
      close(mid);
    }
  }
  close(ys.length - 1);

  // Sight distance. Point `j` ahead is visible when its elevation angle from the eye
  // is at least as high as every angle between — the running-maximum horizon test.
  // The grade the eye point is classified by is the same EPISODE_WINDOW_M grade the
  // episodes use, so "on a climb" means a hill rather than a single bump.
  const sightStep = Math.max(1, Math.round(SIGHT_STEP_M / NODE_SPACING));
  const sightSpacing = Math.max(1, Math.round(SIGHT_SPACING_M / NODE_SPACING));
  const sightHorizon = Math.round(SIGHT_HORIZON_M / NODE_SPACING);
  let sightUpM = 0;
  let sightUpPoints = 0;
  let sightDownM = 0;
  let sightDownPoints = 0;
  let sightFlatM = 0;
  let sightFlatPoints = 0;
  // What the windscreen actually holds, over all eye points: visible metres of road
  // whose own grade climbs vs falls, and the VERTICAL ANGLE each of those metres
  // subtends from the eye. The angle is the honest screen measure, because a metre
  // of road tilted toward you is many pixels tall and a metre tilted away is none.
  let seenUpM = 0;
  let seenDownM = 0;
  let screenUp = 0;
  let screenDown = 0;
  for (let i = stride; i + sightHorizon < ys.length; i += sightSpacing) {
    const eye = ys[i]! + EYE_HEIGHT_M;
    let horizonAngle = -Infinity;
    let visibleM = 0;
    let prevAngle = (ys[i]! - eye) / (sightStep * NODE_SPACING);
    for (let j = i + sightStep; j <= i + sightHorizon; j += sightStep) {
      const angle = (ys[j]! - eye) / ((j - i) * NODE_SPACING);
      if (angle >= horizonAngle) {
        visibleM += sightStep * NODE_SPACING;
        horizonAngle = angle;
        const localGrade = (ys[j]! - ys[j - sightStep]!) / (sightStep * NODE_SPACING);
        const subtended = Math.abs(angle - prevAngle);
        if (localGrade > 0) {
          seenUpM += sightStep * NODE_SPACING;
          screenUp += subtended;
        } else {
          seenDownM += sightStep * NODE_SPACING;
          screenDown += subtended;
        }
      }
      prevAngle = angle;
    }
    const grade = (ys[i]! - ys[i - stride]!) / (stride * NODE_SPACING);
    if (grade > FLAT_BAND) {
      sightUpM += visibleM;
      sightUpPoints++;
    } else if (grade < -FLAT_BAND) {
      sightDownM += visibleM;
      sightDownPoints++;
    } else {
      sightFlatM += visibleM;
      sightFlatPoints++;
    }
  }

  return {
    seed,
    ascentM,
    descentM,
    netM: ys[ys.length - 1]! - ys[0]!,
    upM,
    downM,
    flatM,
    upTimeS,
    downTimeS,
    flatTimeS,
    runs,
    meanUpGrade: upM > 0 ? upGradeSum / upM : 0,
    meanDownGrade: downM > 0 ? downGradeSum / downM : 0,
    sightUpM,
    sightUpPoints,
    sightDownM,
    sightDownPoints,
    sightFlatM,
    sightFlatPoints,
    seenUpM,
    seenDownM,
    screenUp,
    screenDown,
  };
}

function pct(part: number, whole: number): string {
  return whole > 0 ? `${((100 * part) / whole).toFixed(1)}%` : '-';
}

function runSummary(runs: readonly Run[], sign: 1 | -1) {
  const of = runs.filter((r) => r.sign === sign);
  const total = of.reduce((sum, r) => sum + r.lengthM, 0);
  const long = of.filter((r) => r.lengthM >= LONG_RUN_M);
  return {
    count: of.length,
    totalM: total,
    meanM: of.length > 0 ? total / of.length : 0,
    maxM: of.reduce((worst, r) => Math.max(worst, r.lengthM), 0),
    longCount: long.length,
    longM: long.reduce((sum, r) => sum + r.lengthM, 0),
    meanRiseM: of.length > 0 ? of.reduce((sum, r) => sum + Math.abs(r.riseM), 0) / of.length : 0,
  };
}

// `seeds` is either a count of arbitrary worlds or an explicit comma-separated list,
// so a player's own world can be measured against the sample.
const seedArg = process.argv[2] ?? '8';
const km = Number(process.argv[3] ?? 200);
startM = Number(process.argv[4] ?? 10) * 1000;
SIGHT_HORIZON_M = Number(process.argv[5] ?? 2000);
const lengthM = km * 1000;

// Fixed, arbitrary seeds: reproducible, and not chosen after seeing an answer. Mixed
// through an avalanche step rather than taken as a linear sequence, so neighbouring
// indices cannot share hash structure with each other or with the landscape's tags.
const seeds = seedArg.includes(',')
  ? seedArg.split(',').map((s) => Number(s.trim()) >>> 0)
  : Array.from({ length: Number(seedArg) }, (_, i) => {
      let h = Math.imul(i + 1, 0x9e3779b1) >>> 0;
      h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
      h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
      return (h ^ (h >>> 16)) >>> 0;
    });

console.log(
  `grade balance: ${seeds.length} seeds x ${km} km, measured from ${(startM / 1000).toFixed(0)} km out`,
);
console.log(
  `level band |grade| < ${(FLAT_BAND * 100).toFixed(1)}%, episodes on a ${EPISODE_WINDOW_M} m window, ` +
    `sight horizon ${SIGHT_HORIZON_M} m\n`,
);

const all: SeedStats[] = [];
for (const seed of seeds) {
  const stats = analyse(seed, lengthM);
  all.push(stats);
  const up = runSummary(stats.runs, 1);
  const down = runSummary(stats.runs, -1);
  console.log(
    `seed ${String(seed).padStart(8)}  ` +
      `climb ${pct(stats.upM, stats.upM + stats.downM + stats.flatM)} / ` +
      `descend ${pct(stats.downM, stats.upM + stats.downM + stats.flatM)}  |  ` +
      `ascent ${(stats.ascentM / 1000).toFixed(1)} km vs descent ${(stats.descentM / 1000).toFixed(1)} km ` +
      `(net ${stats.netM >= 0 ? '+' : ''}${stats.netM.toFixed(0)} m)  |  ` +
      `runs ${up.count}up/${down.count}down, mean ${up.meanM.toFixed(0)}/${down.meanM.toFixed(0)} m  |  ` +
      `time ${pct(stats.upTimeS, stats.upTimeS + stats.downTimeS + stats.flatTimeS)} climbing`,
  );
}

const sum = <K extends keyof SeedStats>(key: K) =>
  all.reduce((acc, s) => acc + (s[key] as number), 0);

const totalM = sum('upM') + sum('downM') + sum('flatM');
const totalT = sum('upTimeS') + sum('downTimeS') + sum('flatTimeS');
const runs = all.flatMap((s) => s.runs);
const up = runSummary(runs, 1);
const down = runSummary(runs, -1);

console.log('\n--- aggregate ------------------------------------------------------');
console.log(`road measured            ${(totalM / 1000).toFixed(0)} km`);
console.log(
  `distance climbing        ${(sum('upM') / 1000).toFixed(1)} km (${pct(sum('upM'), totalM)})`,
);
console.log(
  `distance descending      ${(sum('downM') / 1000).toFixed(1)} km (${pct(sum('downM'), totalM)})`,
);
console.log(`distance level            ${(sum('flatM') / 1000).toFixed(1)} km (${pct(sum('flatM'), totalM)})`);
console.log(
  `total ascent / descent   ${(sum('ascentM') / 1000).toFixed(2)} km / ${(sum('descentM') / 1000).toFixed(2)} km` +
    `  (ratio ${(sum('ascentM') / sum('descentM')).toFixed(4)})`,
);
console.log(
  `mean grade up / down     +${(sum('upM') > 0 ? (all.reduce((a, s) => a + s.meanUpGrade * s.upM, 0) / sum('upM')) * 100 : 0).toFixed(2)}% / ` +
    `${((all.reduce((a, s) => a + s.meanDownGrade * s.downM, 0) / sum('downM')) * 100).toFixed(2)}%`,
);
console.log(
  `episodes                 ${up.count} climbs, ${down.count} descents  ` +
    `(mean ${up.meanM.toFixed(0)} m / ${down.meanM.toFixed(0)} m, longest ${up.maxM.toFixed(0)} m / ${down.maxM.toFixed(0)} m)`,
);
console.log(
  `>= ${LONG_RUN_M} m episodes        ${up.longCount} climbs (${(up.longM / 1000).toFixed(1)} km) vs ` +
    `${down.longCount} descents (${(down.longM / 1000).toFixed(1)} km)`,
);
console.log(
  `mean episode height      ${up.meanRiseM.toFixed(1)} m up / ${down.meanRiseM.toFixed(1)} m down`,
);
console.log(
  `TIME climbing            ${(sum('upTimeS') / 3600).toFixed(2)} h (${pct(sum('upTimeS'), totalT)})`,
);
console.log(
  `TIME descending          ${(sum('downTimeS') / 3600).toFixed(2)} h (${pct(sum('downTimeS'), totalT)})`,
);
console.log(`TIME level                ${(sum('flatTimeS') / 3600).toFixed(2)} h (${pct(sum('flatTimeS'), totalT)})`);
console.log(
  `time ratio up:down       ${(sum('upTimeS') / sum('downTimeS')).toFixed(3)} : 1` +
    `   (distance ratio ${(sum('upM') / sum('downM')).toFixed(3)} : 1)`,
);

const sightUp = sum('sightUpM') / sum('sightUpPoints');
const sightDown = sum('sightDownM') / sum('sightDownPoints');
console.log(
  `sight distance ahead     ${sightUp.toFixed(0)} m on upgrades / ${sightDown.toFixed(0)} m on downgrades / ` +
    `${(sum('sightFlatM') / sum('sightFlatPoints')).toFixed(0)} m level  (horizon ${SIGHT_HORIZON_M} m)`,
);
console.log(`sight ratio up:down      ${(sightUp / sightDown).toFixed(3)} : 1`);

const seenTotal = sum('seenUpM') + sum('seenDownM');
const screenTotal = sum('screenUp') + sum('screenDown');
console.log(
  `visible road by sign     ${pct(sum('seenUpM'), seenTotal)} of visible metres climb, ` +
    `${pct(sum('seenDownM'), seenTotal)} fall`,
);
console.log(
  `SCREEN extent by sign    ${pct(sum('screenUp'), screenTotal)} of the subtended angle is climbing road, ` +
    `${pct(sum('screenDown'), screenTotal)} falling`,
);

// Per-seed net drift. The generator's mean is zero, but ONE seed's drive is not the
// mean: the house sits on the relief lattice's corner, where every band is at its
// own extreme, so a given world starts in a basin or on a high and the drive out of
// it trends one way for a very long time.
const nets = all.map((s) => s.netM);
const meanNet = nets.reduce((a, v) => a + v, 0) / nets.length;
const sdNet = Math.sqrt(
  nets.reduce((a, v) => a + (v - meanNet) ** 2, 0) / Math.max(1, nets.length - 1),
);
const seNet = sdNet / Math.sqrt(nets.length);
console.log(
  `net height change/seed   mean ${meanNet >= 0 ? '+' : ''}${meanNet.toFixed(0)} m, sd ${sdNet.toFixed(0)} m, ` +
    `SE ${seNet.toFixed(0)} m -> ${(meanNet / seNet).toFixed(2)} sigma from balanced`,
);
console.log(
  `seeds that end higher    ${nets.filter((v) => v > 0).length}/${nets.length}`,
);
