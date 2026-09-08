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
import { GameWorld, newWorldState, type CarState } from '../src/game/state';
import type { Item } from '../src/items/items';
import { variant } from '../src/parts/registry';
import { preloadCarModels } from '../src/render/carmodel';
import { createBonnetStorage } from '../src/vehicle/bonnet';
import { COLD_SOAK_C } from '../src/vehicle/cooling';
import { Autopilot, type AutopilotMode } from '../src/vehicle/autopilot';
import { carModel } from '../src/vehicle/carmodels';
import { Vehicle } from '../src/vehicle/vehicle';
import { HazardIndex } from '../src/world/hazards';
import { WorldOrigin } from '../src/world/origin';
import {
  CIRCUIT_HALF_WIDTH,
  PLAYGROUND_ORIGIN_X,
  PLAYGROUND_ORIGIN_Z,
} from '../src/playground/circuit';
import { PlaygroundRoad } from '../src/playground/playgroundroad';
import { addCircuitCollider } from '../src/playground/ribbon';
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
const LAPS = Math.max(1, Number(process.argv[2] ?? 2));

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

function carState(): CarState {
  const def = carModel(MODEL_ID);
  const engine = variant(def.engineId).engine;
  const p = circuit.sampleAt(0);
  return {
    id: 'playground',
    modelId: MODEL_ID,
    gizmos: {},
    stickers: [],
    headlightMode: 'off',
    taillightsOn: false,
    reverseLightsOn: false,
    fuelLitres: 40,
    fuelKind: engine?.fuel ?? null,
    dirt: 0,
    scratches: 0,
    damage: [],
    waterLitres: 10,
    oilLitres: 10,
    engineTempC: COLD_SOAK_C,
    storage: new Array<Item | null>(def.storageCells).fill(null),
    bonnet: createBonnetStorage('playground', def.engineId, def.bodyClass, def.tankLitres),
    odometer: 0,
    x: p.x,
    y: p.y + 1.2,
    z: p.z,
    qx: 0,
    qy: Math.sin(p.heading / 2),
    qz: 0,
    qw: Math.cos(p.heading / 2),
  };
}

interface Rig {
  physics: PhysicsWorld;
  vehicle: Vehicle;
  autopilot: Autopilot;
  input: InputFrame;
}

async function makeRig(mode: AutopilotMode): Promise<Rig> {
  const physics = await PhysicsWorld.create();
  addCircuitCollider(physics, road, circuit);
  const world = new GameWorld(newWorldState(SEED));
  const state = carState();
  world.state.cars[state.id] = state;
  const vehicle = new Vehicle(physics, world, state, new THREE.Scene(), new WorldOrigin());
  const autopilot = new Autopilot(road, new HazardIndex(), physics);
  autopilot.setMode(mode);
  const input = emptyInput();
  for (let i = 0; i < 180; i++) {
    vehicle.fixedUpdate(FIXED_DT, input);
    physics.step();
    vehicle.postStep();
  }
  autopilot.setEngaged(true);
  return { physics, vehicle, autopilot, input };
}

interface SectorMetrics {
  name: string;
  metres: number;
  seconds: number;
  meanSpeed: number;
  minSpeed: number;
  maxSpeed: number;
  worstLateral: number;
  meanThrottle: number;
  meanBrake: number;
  rmsSteer: number;
}

interface LapMetrics {
  laps: number;
  lapSeconds: number[];
  meanSpeed: number;
  worstLateral: number;
  offAsphaltSeconds: number;
  reverseSeconds: number;
  stuckSeconds: number;
  sectors: SectorMetrics[];
}

async function measure(mode: AutopilotMode): Promise<LapMetrics> {
  const rig = await makeRig(mode);
  const position = { x: 0, y: 0, z: 0 };
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
      meanThrottle: 0,
      meanBrake: 0,
      rmsSteer: 0,
      samples: 0,
    });
  }

  const lapSeconds: number[] = [];
  let hint = 0;
  let travelled = 0;
  let previousS = 0;
  let elapsed = 0;
  let lapStart = 0;
  let sumSpeed = 0;
  let samples = 0;
  let worstLateral = 0;
  let offAsphalt = 0;
  let reverse = 0;
  let stuck = 0;
  // A generous ceiling: a car that never finishes must end the run rather than the
  // bench, and the printed lap count is what says it did not.
  const maxSeconds = LAPS * 240;

  while (elapsed < maxSeconds && lapSeconds.length < LAPS) {
    rig.autopilot.drive(FIXED_DT, rig.vehicle, rig.input, 0, 0);
    rig.vehicle.fixedUpdate(FIXED_DT, rig.input);
    rig.physics.step();
    rig.vehicle.postStep();
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
    samples++;
    const lateral = Math.abs(projection.lateral);
    worstLateral = Math.max(worstLateral, lateral);
    if (lateral > CIRCUIT_HALF_WIDTH) offAsphalt += FIXED_DT;
    if (rig.input.reverse) reverse += FIXED_DT;
    if (speed < 0.5) stuck += FIXED_DT;

    const sector = sectors.get(circuit.sectorAt(projection.s).name)!;
    sector.seconds += FIXED_DT;
    sector.meanSpeed += speed;
    sector.minSpeed = Math.min(sector.minSpeed, speed);
    sector.maxSpeed = Math.max(sector.maxSpeed, speed);
    sector.worstLateral = Math.max(sector.worstLateral, lateral);
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
      meanThrottle: metrics.meanThrottle / n,
      meanBrake: metrics.meanBrake / n,
      rmsSteer: Math.sqrt(metrics.rmsSteer / n),
    });
  }

  return {
    laps: lapSeconds.length,
    lapSeconds,
    meanSpeed: sumSpeed / Math.max(1, samples),
    worstLateral,
    offAsphaltSeconds: offAsphalt,
    reverseSeconds: reverse,
    stuckSeconds: stuck,
    sectors: finished,
  };
}

await preloadCarModels([MODEL_ID]);

for (const mode of ['sleeper', 'frantic'] as const) {
  console.log(`\nplayground: ${mode} on ${MODEL_ID}`);
  const metrics = await measure(mode);
  check(
    `${mode}: completes ${LAPS} lap(s)`,
    metrics.laps === LAPS,
    metrics.lapSeconds.length > 0
      ? `laps ${metrics.lapSeconds.map((s) => s.toFixed(1)).join(', ')} s`
      : 'never crossed the line',
  );
  check(
    `${mode}: keeps the car on the asphalt`,
    metrics.worstLateral <= CIRCUIT_HALF_WIDTH + 1.2,
    `worst |lateral| ${metrics.worstLateral.toFixed(2)} m against a ${CIRCUIT_HALF_WIDTH.toFixed(1)} m edge, ${metrics.offAsphaltSeconds.toFixed(1)} s beyond it`,
  );
  check(
    `${mode}: never gets stuck or reverses`,
    metrics.stuckSeconds < 1 && metrics.reverseSeconds < 0.5,
    `${metrics.stuckSeconds.toFixed(1)} s stopped, ${metrics.reverseSeconds.toFixed(1)} s in reverse`,
  );
  console.log(
    `  mean ${(metrics.meanSpeed * 3.6).toFixed(1)} km/h over ${metrics.laps} lap(s)`,
  );
  for (const sector of metrics.sectors) {
    console.log(
      `    ${sector.name.padEnd(22)} ${sector.metres.toFixed(0).padStart(4)} m  ` +
        `${(sector.meanSpeed * 3.6).toFixed(0).padStart(3)} km/h mean, ` +
        `${(sector.minSpeed * 3.6).toFixed(0).padStart(3)} min, ` +
        `${(sector.maxSpeed * 3.6).toFixed(0).padStart(3)} max  ` +
        `thr ${sector.meanThrottle.toFixed(2)} brk ${sector.meanBrake.toFixed(2)} ` +
        `steer ${sector.rmsSteer.toFixed(3)}  worst lat ${sector.worstLateral.toFixed(2)} m`,
    );
  }
}

console.log(failures === 0 ? '\nall playground checks passed' : `\n${failures} playground check(s) FAILED`);
if (failures > 0) process.exitCode = 1;
