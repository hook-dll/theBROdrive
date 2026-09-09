/**
 * The playground circuit, and what the autopilot does on it.
 *
 * `tools/autopilot-bench.ts` defends the CONTRACT between Autopilot, Road, Vehicle
 * and hazards on a stretch of the real road: it answers "is this still wired up".
 * This answers a different question — "how well does it drive" — and it does that on
 * a closed lap, so the same hairpin, crest and chicane come round again every ninety
 * seconds and a change can be compared against the lap before it.
 *
 * Two things are checked rather than merely printed, because a lap that lies is
 * worse than no lap: the circuit closes to a millimetre, and its features are the
 * ones authored (a hairpin near 26 m, a sweeper near 120 m, real grade from the
 * landscape). Everything else here is measurement, printed per sector.
 *
 * Run: `bun tools/playground-lap.ts [laps]`
 */

import * as THREE from 'three';
import { emptyInput, type InputFrame } from '../src/core/input';
import { FIXED_DT, PhysicsWorld } from '../src/core/physics';
import { SurfaceType } from '../src/core/surfaces';
import { GameWorld, newWorldState } from '../src/game/state';
import { preloadCarModels } from '../src/render/carmodel';
import { Autopilot, AUTOPILOT_MODES, type AutopilotMode } from '../src/vehicle/autopilot';
import { Vehicle } from '../src/vehicle/vehicle';
import { HazardIndex } from '../src/world/hazards';
import { WorldOrigin } from '../src/world/origin';
import {
  CIRCUIT_HALF_WIDTH,
  PLAYGROUND_ORIGIN_X,
  PLAYGROUND_ORIGIN_Z,
} from '../src/playground/circuit';
import { playgroundCarState } from '../src/playground/car';
import { PlaygroundRoad } from '../src/playground/playgroundroad';
import { addCircuitCollider } from '../src/playground/ribbon';
import { PlaygroundTraffic, type TrafficState } from '../src/playground/traffic';
import { installAssetShim } from './assetshim';

class BunProgressEvent extends Event implements ProgressEvent {
  readonly lengthComputable: boolean;
  readonly loaded: number;
  readonly total: number;
  constructor(type: string, init: ProgressEventInit = {}) {
    super(type, init);
    this.lengthComputable = init.lengthComputable ?? false;
    this.loaded = init.loaded ?? 0;
    this.total = init.total ?? 0;
  }
}
if (globalThis.ProgressEvent === undefined) globalThis.ProgressEvent = BunProgressEvent;
installAssetShim();

const SEED = 1337;
const MODEL_ID = 'sv_vaz2105r';
/**
 * One body for all the traffic, and it is the ego's: the lap's 28% gradients are
 * beyond the ordinary saloons, which strand themselves on the hillsides rather than
 * making traffic. Same car, different mode, is also the cleanest comparison —
 * everything separating the ego from the traffic is the autopilot.
 */
const TRAFFIC_MODEL_ID = 'sv_vaz2105r';
const LAPS = Math.max(1, Number(process.argv[2] ?? 2));
/**
 * Lane-keeping bounds, metres of cross-track error, per mode.
 *
 * These are the numbers the modes are FOR. Sleeper is asked to hold its lane to a
 * quarter of a metre because that is what "careful" means when the lane is 2.9 m
 * wide and the car is 2.1; frantic is allowed half a metre and a bigger worst case,
 * because at 130 km/h a firm correction is a swerve and clipping a line is the
 * character. Both were measured at 0.26 and 0.43 RMS with the tuning in
 * `AUTOPILOT_MODES`, so a regression of a third of a metre trips them.
 */
const LANE_RMS_BOUND: Record<AutopilotMode, number> = { sleeper: 0.4, frantic: 0.6 };
const LANE_WORST_BOUND: Record<AutopilotMode, number> = { sleeper: 1.2, frantic: 1.6 };

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(46)} ${detail}`);
}

const road = new PlaygroundRoad(SEED, PLAYGROUND_ORIGIN_X, PLAYGROUND_ORIGIN_Z);
const circuit = road.circuit;

console.log(`playground: ${(circuit.length / 1000).toFixed(2)} km lap, seed ${SEED}`);
check(
  'the lap closes on itself',
  circuit.closureResidualM < 1e-3,
  `${(circuit.closureResidualM * 1000).toFixed(3)} mm residual`,
);
const radii = circuit.sectors
  .filter((sector) => Number.isFinite(sector.radius))
  .map((sector) => Math.abs(sector.radius));
check(
  'it has a hairpin and a fast sweeper',
  Math.min(...radii) <= 32 && Math.max(...radii) > 100,
  `tightest ${Math.min(...radii).toFixed(0)} m, fastest ${Math.max(...radii).toFixed(0)} m`,
);
const worstGrade = circuit.worstGrade();
let sumGrade = 0;
let gradeSamples = 0;
for (let s = 0; s < circuit.length; s += 2) {
  sumGrade += Math.abs(circuit.sampleAt(s).grade);
  gradeSamples++;
}
const meanGrade = sumGrade / gradeSamples;
// The lap must be as steep as the WORST the game asks for, not as steep as the spot
// it happens to stand on. The real road runs mean 5.0%, p95 12.5% and 18.8% at its
// very worst over 200 km; the authored profile peaks past that, deliberately.
check(
  'it climbs and descends at the worst gradient the game has',
  Math.abs(worstGrade - circuit.maxGrade) < 1e-6 &&
    worstGrade >= 0.25 &&
    meanGrade >= 0.08 &&
    circuit.elevationResidualM < 1e-3,
  `mean ${(meanGrade * 100).toFixed(1)}%, steepest ${(worstGrade * 100).toFixed(1)}%, ` +
    `closes in Y to ${(circuit.elevationResidualM * 1000).toFixed(3)} mm ` +
    '(road: mean 5.0%, p95 12.5%, worst 18.8%)',
);
// A gradient on a straight is a power test; a gradient THROUGH a bend is where
// braking and cornering compete for the same tyres, and that is the case the
// profile exists to create.
const gradeIn = (name: string): number => {
  const sector = circuit.sectors.find((candidate) => candidate.name === name)!;
  let worst = 0;
  for (let s = sector.startS; s < sector.endS; s += 2) {
    worst = Math.max(worst, Math.abs(circuit.sampleAt(s).grade));
  }
  return worst;
};
const sweeperGrade = gradeIn('turn 1 sweeper');
const hairpinGrade = Math.max(gradeIn('hairpin approach'), gradeIn('hairpin'));
check(
  'it holds a gradient through its corners',
  sweeperGrade >= 0.15 && hairpinGrade >= 0.15,
  `${(sweeperGrade * 100).toFixed(1)}% in the 320 m sweeper, ${(hairpinGrade * 100).toFixed(1)}% into the 30 m hairpin`,
);
console.log(
  `  sectors: ${circuit.sectors
    .map(
      (sector) =>
        `${sector.name} ${(sector.endS - sector.startS).toFixed(0)} m${
          Number.isFinite(sector.radius) ? ` r${sector.radius.toFixed(0)}` : ''
        }`,
    )
    .join(' · ')}`,
);

interface Rig {
  physics: PhysicsWorld;
  vehicle: Vehicle;
  autopilot: Autopilot;
  input: InputFrame;
  traffic: PlaygroundTraffic | null;
}

interface RigOptions {
  readonly mode: AutopilotMode;
  /** State the other cars are in, or null for an empty lap. */
  readonly traffic: TrafficState | null;
  /** Arclength the ego car starts at, on its own lane. */
  readonly startS?: number;
  /** Layout for the other cars; the shipped playground grid by default. */
  readonly slots?: readonly TrafficSlot[];
  /**
   * A STATIC obstacle nobody told the autopilot about, on the lane at this
   * arclength. This is what a crash leaves a car pressed against: the corridor rays
   * only report dynamic bodies, and there is no `HazardIndex` on this circuit, so the
   * car has no sensing of it whatsoever and must get out on the stall detector alone.
   */
  readonly boulderS?: number;
}

/** Radius and lane of that boulder. Small enough that the escape bias clears it. */
const BOULDER_RADIUS_M = 0.9;

/** The car on its own lane, engine warm enough to pull, with the scene it needs. */
async function makeRig(options: RigOptions): Promise<Rig> {
  const { mode, traffic, startS = 0, slots, boulderS } = options;
  const physics = await PhysicsWorld.create();
  addCircuitCollider(physics, road, circuit);
  const world = new GameWorld(newWorldState(SEED));
  if (boulderS !== undefined) {
    const rock = circuit.sampleAt(boulderS);
    const rockLateral = AUTOPILOT_MODES[mode].laneOffset;
    physics.addStaticBall(
      BOULDER_RADIUS_M,
      {
        x: rock.x + Math.cos(rock.heading) * rockLateral,
        y: circuit.surfaceY(boulderS, rockLateral) + BOULDER_RADIUS_M * 0.7,
        z: rock.z - Math.sin(rock.heading) * rockLateral,
      },
      SurfaceType.Rock,
    );
  }
  const at = circuit.sampleAt(startS);
  const lane = AUTOPILOT_MODES[mode].laneOffset;
  const state = playgroundCarState(
    'playground',
    MODEL_ID,
    at.x + Math.cos(at.heading) * lane,
    circuit.surfaceY(startS, lane) + 1.2,
    at.z - Math.sin(at.heading) * lane,
    at.heading,
  );
  world.state.cars[state.id] = state;
  const scene = new THREE.Scene();
  const origin = new WorldOrigin();
  const vehicle = new Vehicle(physics, world, state, scene, origin);
  const autopilot = new Autopilot(road, new HazardIndex(), physics);
  autopilot.setMode(mode);
  const input = emptyInput();
  const others =
    traffic === null
      ? null
      : new PlaygroundTraffic(
          physics,
          world,
          scene,
          origin,
          road,
          circuit,
          [TRAFFIC_MODEL_ID],
          slots,
        );
  others?.setState(traffic ?? 'stowed');
  // Settle ON THE BRAKES. Three seconds of suspension settling with no pedal rolls
  // the car backwards down anything steep — this lap holds 28% — so a run that does
  // not start on the line used to hand the autopilot a car already sliding.
  input.handbrake = true;
  for (let i = 0; i < 180; i++) {
    vehicle.fixedUpdate(FIXED_DT, input);
    others?.fixedUpdate(FIXED_DT, 0, 0);
    physics.step();
    vehicle.postStep();
    others?.postStep();
  }
  input.handbrake = false;
  autopilot.setEngaged(true);
  return { physics, vehicle, autopilot, input, traffic: others };
}

interface SectorMetrics {
  name: string;
  metres: number;
  seconds: number;
  meanSpeed: number;
  minSpeed: number;
  maxSpeed: number;
  worstLateral: number;
  meanLaneError: number;
  meanThrottle: number;
  meanBrake: number;
  rmsSteer: number;
}

interface LapMetrics {
  laps: number;
  lapSeconds: number[];
  meanSpeed: number;
  peakSpeed: number;
  worstLateral: number;
  /** Signed lateral extremes: the second is how far it strayed toward the oncoming side. */
  minSignedLateral: number;
  maxSignedLateral: number;
  laneErrorRms: number;
  laneErrorWorst: number;
  offAsphaltSeconds: number;
  reverseSeconds: number;
  stuckSeconds: number;
  /** Closest another car's chassis came, metres between centres, or Infinity. */
  nearestCar: number;
  impacts: number;
  passes: number;
  progress: number;
  sectors: SectorMetrics[];
}

/**
 * One run: `laps` laps, or `seconds` of trying, whichever ends first.
 *
 * The same instrument for an empty lap and for a lap with traffic on it, because
 * the interesting numbers are the same ones — where the car sat in its lane, how
 * near it came to another body, and whether it ever stopped moving.
 */
async function measure(
  options: RigOptions,
  laps: number,
  seconds: number,
): Promise<LapMetrics> {
  const rig = await makeRig(options);
  const lane = AUTOPILOT_MODES[options.mode].laneOffset;
  const position = { x: 0, y: 0, z: 0 };
  const other = { x: 0, y: 0, z: 0 };
  const sectors = new Map<string, SectorMetrics & { samples: number }>();
  for (const sector of circuit.sectors) {
    sectors.set(sector.name, {
      name: sector.name,
      metres: sector.endS - sector.startS,
      seconds: 0,
      meanSpeed: 0,
      minSpeed: Infinity,
      maxSpeed: 0,
      worstLateral: 0,
      meanLaneError: 0,
      meanThrottle: 0,
      meanBrake: 0,
      rmsSteer: 0,
      samples: 0,
    });
  }

  const lapSeconds: number[] = [];
  // Seeded from a HINTLESS projection of where the car actually is: the hinted search
  // only moves one window per call, so a run that starts anywhere but the line
  // counted its first two seconds of progress as hundreds of metres of nonsense.
  rig.vehicle.absoluteTranslation(position);
  const startProjection = circuit.project(position.x, position.z);
  let hint = startProjection.s;
  let travelled = 0;
  let previousS = startProjection.s;
  let elapsed = 0;
  let lapStart = 0;
  let sumSpeed = 0;
  let peakSpeed = 0;
  let samples = 0;
  let worstLateral = 0;
  let minSigned = Infinity;
  let maxSigned = -Infinity;
  let sumLaneErrorSq = 0;
  let laneErrorWorst = 0;
  let offAsphalt = 0;
  let reverse = 0;
  let stuck = 0;
  let nearestCar = Infinity;
  let impacts = 0;
  let passes = 0;
  let passing = false;

  while (elapsed < seconds && lapSeconds.length < laps) {
    rig.autopilot.drive(FIXED_DT, rig.vehicle, rig.input, 0, 0);
    rig.vehicle.fixedUpdate(FIXED_DT, rig.input);
    rig.traffic?.fixedUpdate(FIXED_DT, 0, 0);
    rig.physics.step();
    rig.vehicle.postStep();
    rig.traffic?.postStep();
    elapsed += FIXED_DT;

    rig.vehicle.absoluteTranslation(position);
    const projection = circuit.project(position.x, position.z, hint);
    hint = projection.s;
    // Wrapped arclength: a step across the finish line reads as a small negative
    // delta, which is exactly one lap of progress.
    let delta = projection.s - previousS;
    if (delta < -circuit.length / 2) delta += circuit.length;
    if (delta > circuit.length / 2) delta -= circuit.length;
    travelled += delta;
    previousS = projection.s;

    const velocity = rig.vehicle.chassis.linvel();
    const speed = Math.hypot(velocity.x, velocity.z);
    sumSpeed += speed;
    peakSpeed = Math.max(peakSpeed, speed);
    samples++;
    const lateral = Math.abs(projection.lateral);
    worstLateral = Math.max(worstLateral, lateral);
    minSigned = Math.min(minSigned, projection.lateral);
    maxSigned = Math.max(maxSigned, projection.lateral);
    const laneError = projection.lateral - lane;
    sumLaneErrorSq += laneError * laneError;
    laneErrorWorst = Math.max(laneErrorWorst, Math.abs(laneError));
    if (lateral > CIRCUIT_HALF_WIDTH) offAsphalt += FIXED_DT;
    if (rig.input.reverse) reverse += FIXED_DT;
    if (speed < 0.5) stuck += FIXED_DT;
    // A pass is counted when it STARTS, so a run that commits to one and then has to
    // abandon it still shows up rather than being silently absent.
    const nowPassing = rig.autopilot.activity === 'pass';
    if (nowPassing && !passing) passes++;
    passing = nowPassing;
    // Impacts are the honest collision test: the vehicle reports a velocity change
    // its own tyres cannot explain, at the threshold that scratches paint.
    const impact = rig.vehicle.lastImpact;
    if (impact && impact.severityMps > 1.8) impacts++;
    for (const car of rig.traffic?.cars ?? []) {
      car.vehicle.absoluteTranslation(other);
      nearestCar = Math.min(nearestCar, Math.hypot(other.x - position.x, other.z - position.z));
    }

    const sector = sectors.get(circuit.sectorAt(projection.s).name)!;
    sector.seconds += FIXED_DT;
    sector.meanSpeed += speed;
    sector.minSpeed = Math.min(sector.minSpeed, speed);
    sector.maxSpeed = Math.max(sector.maxSpeed, speed);
    sector.worstLateral = Math.max(sector.worstLateral, lateral);
    sector.meanLaneError += laneError;
    sector.meanThrottle += rig.input.throttle;
    sector.meanBrake += rig.input.brake;
    sector.rmsSteer += rig.input.steer * rig.input.steer;
    sector.samples++;

    if (travelled >= circuit.length * (lapSeconds.length + 1)) {
      lapSeconds.push(elapsed - lapStart);
      lapStart = elapsed;
    }
  }

  const finished: SectorMetrics[] = [];
  for (const sector of circuit.sectors) {
    const metrics = sectors.get(sector.name)!;
    const n = Math.max(1, metrics.samples);
    finished.push({
      ...metrics,
      meanSpeed: metrics.meanSpeed / n,
      minSpeed: Number.isFinite(metrics.minSpeed) ? metrics.minSpeed : 0,
      meanLaneError: metrics.meanLaneError / n,
      meanThrottle: metrics.meanThrottle / n,
      meanBrake: metrics.meanBrake / n,
      rmsSteer: Math.sqrt(metrics.rmsSteer / n),
    });
  }

  return {
    laps: lapSeconds.length,
    lapSeconds,
    meanSpeed: sumSpeed / Math.max(1, samples),
    peakSpeed,
    worstLateral,
    minSignedLateral: Number.isFinite(minSigned) ? minSigned : 0,
    maxSignedLateral: Number.isFinite(maxSigned) ? maxSigned : 0,
    laneErrorRms: Math.sqrt(sumLaneErrorSq / Math.max(1, samples)),
    laneErrorWorst,
    offAsphaltSeconds: offAsphalt,
    reverseSeconds: reverse,
    stuckSeconds: stuck,
    nearestCar,
    impacts,
    passes,
    progress: travelled,
    sectors: finished,
  };
}

await preloadCarModels([MODEL_ID, TRAFFIC_MODEL_ID]);

// ---------------------------------------------------------------------------
// The empty lap: speed envelope and lane discipline.
// ---------------------------------------------------------------------------
for (const mode of ['sleeper', 'frantic'] as const) {
  const config = AUTOPILOT_MODES[mode];
  console.log(`\nplayground: ${mode} on ${MODEL_ID}, alone`);
  const metrics = await measure({ mode, traffic: null }, LAPS, LAPS * 240);
  check(
    `${mode}: completes ${LAPS} lap(s)`,
    metrics.laps === LAPS,
    metrics.lapSeconds.length > 0
      ? `laps ${metrics.lapSeconds.map((s) => s.toFixed(1)).join(', ')} s`
      : 'never crossed the line',
  );
  // The body CENTRE against the asphalt edge: with a lane held there is no longer a
  // verge allowance to spend, and the old bound passed a car with a wheel on the sand.
  check(
    `${mode}: keeps the car on the asphalt`,
    metrics.worstLateral <= CIRCUIT_HALF_WIDTH,
    `worst |lateral| ${metrics.worstLateral.toFixed(2)} m against a ${CIRCUIT_HALF_WIDTH.toFixed(1)} m edge, ${metrics.offAsphaltSeconds.toFixed(1)} s beyond it`,
  );
  // Alone on the circuit there is never a reason to put a wheel over the centreline,
  // so `maxSignedLateral` is the real test of the lane-keeping change: measured at
  // +1.6 m before it, which is the oncoming lane.
  check(
    `${mode}: holds its own lane`,
    metrics.laneErrorRms <= LANE_RMS_BOUND[mode] &&
      metrics.laneErrorWorst <= LANE_WORST_BOUND[mode] &&
      metrics.maxSignedLateral <= 0.4,
    `lane error RMS ${metrics.laneErrorRms.toFixed(2)} m (bound ${LANE_RMS_BOUND[mode].toFixed(2)}), ` +
      `worst ${metrics.laneErrorWorst.toFixed(2)} m (bound ${LANE_WORST_BOUND[mode].toFixed(2)}), ` +
      `lateral ${metrics.minSignedLateral.toFixed(2)}..${metrics.maxSignedLateral.toFixed(2)} m about a ${config.laneOffset.toFixed(2)} m lane`,
  );
  // A cap nobody reaches is a comment, not a character: the lower bound is what says
  // the lap can actually deliver the mode's speed.
  check(
    `${mode}: drives to its speed envelope`,
    metrics.peakSpeed <= config.cruiseMps * 1.1 &&
      metrics.peakSpeed >= config.cruiseMps * 0.9,
    `peak ${(metrics.peakSpeed * 3.6).toFixed(0)} km/h against a ${(config.cruiseMps * 3.6).toFixed(0)} km/h cruise, mean ${(metrics.meanSpeed * 3.6).toFixed(1)} km/h`,
  );
  check(
    `${mode}: never gets stuck or reverses`,
    metrics.stuckSeconds < 1 && metrics.reverseSeconds < 0.5,
    `${metrics.stuckSeconds.toFixed(1)} s stopped, ${metrics.reverseSeconds.toFixed(1)} s in reverse`,
  );
  console.log(`  mean ${(metrics.meanSpeed * 3.6).toFixed(1)} km/h over ${metrics.laps} lap(s)`);
  for (const sector of metrics.sectors) {
    console.log(
      `    ${sector.name.padEnd(22)} ${sector.metres.toFixed(0).padStart(4)} m  ` +
        `${(sector.meanSpeed * 3.6).toFixed(0).padStart(3)} km/h mean, ` +
        `${(sector.minSpeed * 3.6).toFixed(0).padStart(3)} min, ` +
        `${(sector.maxSpeed * 3.6).toFixed(0).padStart(3)} max  ` +
        `thr ${sector.meanThrottle.toFixed(2)} brk ${sector.meanBrake.toFixed(2)} ` +
        `steer ${sector.rmsSteer.toFixed(3)}  ` +
        `lane ${sector.meanLaneError >= 0 ? '+' : ''}${sector.meanLaneError.toFixed(2)} m  ` +
        `worst lat ${sector.worstLateral.toFixed(2)} m`,
    );
  }
}

// ---------------------------------------------------------------------------
// The same lap with traffic: four cars to catch, two coming the other way.
// ---------------------------------------------------------------------------
console.log('\nplayground: frantic in traffic');
const busy = await measure({ mode: 'frantic', traffic: 'rolling' }, 1, 240);
check(
  'frantic: gets round a lap of traffic',
  busy.progress >= circuit.length - 5 && busy.stuckSeconds < 3,
  `${busy.progress.toFixed(0)} m of ${circuit.length.toFixed(0)}, ${busy.stuckSeconds.toFixed(1)} s stopped, mean ${(busy.meanSpeed * 3.6).toFixed(1)} km/h`,
);
check(
  'frantic: overtakes rather than queues',
  busy.passes >= 3,
  `${busy.passes} pass(es) started against four cars to catch, mean ${(busy.meanSpeed * 3.6).toFixed(1)} km/h`,
);
// Bodies are about 1.7 m wide, so centres closer than that are touching. This is the
// check that says a pass was a pass and not a shunt.
check(
  'frantic: passes without touching anything',
  busy.nearestCar >= 1.9 && busy.impacts === 0,
  `nearest car ${busy.nearestCar.toFixed(2)} m between centres, ${busy.impacts} impact(s)`,
);
console.log(
  `  mean ${(busy.meanSpeed * 3.6).toFixed(1)} km/h, peak ${(busy.peakSpeed * 3.6).toFixed(0)}, ` +
    `lateral ${busy.minSignedLateral.toFixed(2)}..${busy.maxSignedLateral.toFixed(2)} m`,
);

console.log('\nplayground: sleeper in traffic');
const calm = await measure({ mode: 'sleeper', traffic: 'rolling' }, 1, 300);
// The careful mode's contract in traffic is the OPPOSITE of frantic's: it does not
// take the other side of the road to get past something that is already moving.
check(
  'sleeper: follows traffic instead of overtaking it',
  calm.maxSignedLateral <= 0.4 && calm.impacts === 0,
  `${calm.passes} pass(es), lateral ${calm.minSignedLateral.toFixed(2)}..${calm.maxSignedLateral.toFixed(2)} m, ` +
    `nearest car ${calm.nearestCar.toFixed(2)} m, mean ${(calm.meanSpeed * 3.6).toFixed(1)} km/h`,
);

// ---------------------------------------------------------------------------
// Nosed into a parked car where no pass fits: the manoeuvre, not the loop.
// ---------------------------------------------------------------------------
//
// One car parked in the lane, in the middle of the 110 m esses. That location is the
// point: the chord a corridor probe can see round a bend that tight is far shorter
// than an overtake needs, so `updatePass` correctly refuses, and the only way past
// is the recovery manoeuvre — back out with the wheels turned, pull forward with
// them turned the other way, and hold the escaping side for the next stretch.
//
// Before that manoeuvre existed the car reversed for two seconds, resumed the line
// it had been on, and drove back into the obstacle for as long as you cared to
// watch. `passedObstacle` is the whole test; `reverseSeconds` proves it was done the
// intended way rather than by squeezing past on momentum.
const OBSTACLE_S = 2_300;
console.log('\nplayground: sleeper nosed into a parked car in the esses');
const wedged = await measure(
  {
    mode: 'sleeper',
    traffic: 'parked',
    startS: OBSTACLE_S - 130,
    slots: [{ s: OBSTACLE_S, oncoming: false, mode: 'sleeper' }],
  },
  1,
  90,
);
const passedObstacle = wedged.progress >= 130 + 40;
check(
  'sleeper: backs out of a blocked lane and gets past',
  passedObstacle && wedged.reverseSeconds > 0.2 && wedged.impacts === 0,
  `${wedged.progress.toFixed(0)} m travelled of the 170 m needed to clear it, ` +
    `${wedged.reverseSeconds.toFixed(1)} s in reverse, ${wedged.stuckSeconds.toFixed(1)} s stopped, ` +
    `mean ${(wedged.meanSpeed * 3.6).toFixed(1)} km/h, nearest ${wedged.nearestCar.toFixed(2)} m, ` +
    `${wedged.impacts} impact(s)`,
);

// ---------------------------------------------------------------------------
// Crashed into scenery: nothing sensed it, and it still has to get out.
// ---------------------------------------------------------------------------
//
// A boulder on the lane that no index knows about and no ray reports, because rays
// only count dynamic bodies. The car drives into it at cruise, and from then on the
// only evidence anything is wrong is that the car is not going anywhere: this is the
// case a player reported as an autopilot revving its engine against an obstacle
// forever, and it went undetected because a car with its foot down against something
// solid rocks and slips past 1 km/h constantly, so a standstill test never fired.
const BOULDER_S = 300;
console.log('\nplayground: sleeper crashed into an unindexed boulder');
const crashed = await measure({ mode: 'sleeper', traffic: null, boulderS: BOULDER_S }, 1, 70);
check(
  'sleeper: gets itself out of a crash into scenery',
  crashed.progress >= BOULDER_S + 60 && crashed.reverseSeconds > 0.2,
  `${crashed.progress.toFixed(0)} m travelled past a boulder at ${BOULDER_S} m, ` +
    `${crashed.reverseSeconds.toFixed(1)} s in reverse, ${crashed.stuckSeconds.toFixed(1)} s stopped, ` +
    `mean ${(crashed.meanSpeed * 3.6).toFixed(1)} km/h`,
);

console.log(failures === 0 ? '\nall playground checks passed' : `\n${failures} playground check(s) FAILED`);
if (failures > 0) process.exitCode = 1;
