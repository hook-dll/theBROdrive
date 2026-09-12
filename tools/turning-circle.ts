/**
 * The turning circle at the road's start: the ground, the line, and a car driving it.
 *
 * The road ends at s = 0. There is a paved bulb behind that end (`world/terminus.ts`
 * levels the ground and `world/terminuspad.ts` paves it) and a line round it
 * (`world/turnaround.ts`) that `world/traffic.ts` hands oncoming cars, so ambient
 * traffic turns and drives back out instead of being recycled out of sight.
 *
 * Three things have to hold, and the third is the only one that proves anything:
 *   1. the ground under the paving is level, and eases back into the dunes;
 *   2. the line is continuous, turns no tighter than it claims, and stays on the paving;
 *   3. a real car, on the real collided ground, with the ordinary autopilot, completes
 *      the turn and arrives back in the outgoing lane.
 *
 * The stream-level half of it - that cars actually get handed the line and taken back
 * off it - is measured in `tools/traffic-bench.ts`, which owns `RoadTraffic`.
 *
 * Run with `bun tools/turning-circle.ts [seed]`.
 */
import * as THREE from 'three';
import { emptyInput } from '../src/core/input';
import { FIXED_DT, PhysicsWorld } from '../src/core/physics';
import { SurfaceType } from '../src/core/surfaces';
import { GameWorld, newWorldState, type CarState } from '../src/game/state';
import type { Item } from '../src/items/items';
import { variant } from '../src/parts/registry';
import { carModelMeasure, carSpawnYAboveGround, preloadCarModels } from '../src/render/carmodel';
import { createBonnetStorage } from '../src/vehicle/bonnet';
import { COLD_SOAK_C } from '../src/vehicle/cooling';
import { Autopilot } from '../src/vehicle/autopilot';
import { carModel } from '../src/vehicle/carmodels';
import { Vehicle } from '../src/vehicle/vehicle';
import { HazardIndex } from '../src/world/hazards';
import { WorldOrigin } from '../src/world/origin';
import { Road } from '../src/world/road';
import { Terrain } from '../src/world/terrain';
import {
  TERMINUS_CENTRE_M,
  TERMINUS_HOOK_M,
  TERMINUS_PAD_M,
  TERMINUS_RIM_M,
} from '../src/world/terminus';
import { TurnaroundRoad, TURNAROUND_ENTRY_S } from '../src/world/turnaround';
import { installAssetShim } from './assetshim';

installAssetShim();

const SEED = Number(process.argv[2] ?? 1337);
const MODEL_ID = 'sv_vaz2105r';
/** Grid step of the collider this bench bakes out of the terrain. */
const GROUND_STEP = 1.5;

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(52)} ${detail}`);
}

console.log(`turning circle: seed ${SEED}, pad ${TERMINUS_PAD_M} m at ${TERMINUS_CENTRE_M} m behind the start`);

const road = new Road(SEED);
const terrain = new Terrain(SEED, road);
const turn = new TurnaroundRoad(road, (x, z) => terrain.heightAt(x, z, 0));

// --- 1. The ground ----------------------------------------------------------------
// Level over the paving, because a pad drawn flat onto a dune face is a pad with a gap
// under one side of it, and easing - not stepping - back into the desert, because the
// player can drive off the bulb in any direction.
{
  let lowest = Infinity;
  let highest = -Infinity;
  for (let i = 0; i < 2000; i++) {
    const angle = (i / 2000) * Math.PI * 2;
    const r = ((i * 37) % 100) / 100 * TERMINUS_PAD_M;
    const x = Math.cos(angle) * r;
    const z = -TERMINUS_CENTRE_M + Math.sin(angle) * r;
    const h = terrain.heightAt(x, z, 0);
    lowest = Math.min(lowest, h);
    highest = Math.max(highest, h);
  }
  check(
    'the ground under the paving is level',
    highest - lowest <= 0.12,
    `${((highest - lowest) * 100).toFixed(1)} cm from the lowest point of the pad to the highest`,
  );

  let steepest = 0;
  for (let i = 0; i < 720; i++) {
    const angle = (i / 720) * Math.PI * 2;
    let previous = terrain.heightAt(
      Math.cos(angle) * TERMINUS_PAD_M,
      -TERMINUS_CENTRE_M + Math.sin(angle) * TERMINUS_PAD_M,
      0,
    );
    for (let out = TERMINUS_PAD_M + 1; out <= TERMINUS_PAD_M + TERMINUS_RIM_M + 6; out += 1) {
      const h = terrain.heightAt(
        Math.cos(angle) * out,
        -TERMINUS_CENTRE_M + Math.sin(angle) * out,
        0,
      );
      steepest = Math.max(steepest, Math.abs(h - previous));
      previous = h;
    }
  }
  check(
    'and it eases back into the desert rather than stepping',
    steepest <= 0.9,
    `worst rise ${(steepest * 100).toFixed(0)} cm over a metre, walking out off the rim`,
  );
}

// --- 2. The line ------------------------------------------------------------------
{
  let worstGap = 0;
  let worstHeadingStep = 0;
  let tightest = Infinity;
  let worstOverhang = -Infinity;
  let previous = turn.sampleAt(0);
  for (let s = 0.25; s <= turn.length; s += 0.25) {
    const sample = turn.sampleAt(s);
    worstGap = Math.max(worstGap, Math.hypot(sample.x - previous.x, sample.z - previous.z) - 0.25);
    let dh = sample.heading - previous.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    worstHeadingStep = Math.max(worstHeadingStep, Math.abs(dh));
    const curvature = Math.abs(turn.curvatureAt(s));
    if (curvature > 1e-6) tightest = Math.min(tightest, 1 / curvature);
    // Only where the line has actually left the road. Its first and last few metres
    // run up the asphalt itself, which is nearer the pad's rim than the loop ever is
    // and is not paving this bulb has to provide.
    if (Math.abs(sample.x) > road.halfWidthAt(0)) {
      const r = Math.hypot(sample.x, sample.z + TERMINUS_CENTRE_M);
      worstOverhang = Math.max(worstOverhang, r - TERMINUS_PAD_M);
    }
    previous = sample;
  }
  // Continuity is the point of building the line out of mutually tangent pieces: a
  // quarter-metre of it may turn by exactly as much as its tightest arc turns in a
  // quarter-metre, and no more. Anything above that is a corner, and a corner is what a
  // pure-pursuit controller cuts.
  const turnPerStep = 0.25 / TERMINUS_HOOK_M;
  check(
    'the line is continuous in position and heading',
    worstGap < 1e-6 && worstHeadingStep <= turnPerStep + 1e-6,
    `worst gap ${(worstGap * 1000).toFixed(3)} mm, worst heading step ${((worstHeadingStep * 180) / Math.PI).toFixed(2)} deg per 25 cm ` +
      `against the ${((turnPerStep * 180) / Math.PI).toFixed(2)} deg a ${TERMINUS_HOOK_M} m arc owes`,
  );
  check(
    'and turns no tighter than the hooks it is built from',
    tightest >= TERMINUS_HOOK_M - 1e-6,
    `tightest radius ${tightest.toFixed(2)} m against the authored ${TERMINUS_HOOK_M} m`,
  );
  check(
    'and the manoeuvre stays well inside the paving',
    worstOverhang <= -4,
    `${(-worstOverhang).toFixed(2)} m of paving outside the line at its widest point off the road`,
  );

  // The line starts in the oncoming lane and ends in the outgoing one, because that is
  // what makes it a handover rather than a stunt: `traffic.ts` gives a car the line
  // where it is already driving and takes it back where it should already be.
  const lane = Math.abs(road.laneCentreAt(0, 0));
  const entry = turn.sampleAt(2);
  const exit = turn.sampleAt(turn.length - 2);
  check(
    'it begins in the oncoming lane and ends in the outgoing one',
    Math.abs(entry.x - lane) < 0.01 &&
      Math.abs(exit.x + lane) < 0.01 &&
      Math.abs(Math.abs(entry.heading) - Math.PI) < 0.01 &&
      Math.abs(exit.heading) < 0.01,
    `in at x ${entry.x.toFixed(2)} heading ${entry.heading.toFixed(2)}, out at x ${exit.x.toFixed(2)} heading ${exit.heading.toFixed(2)}`,
  );

  // A projection hint is what keeps the two lanes apart: they are 2.9 m from each other
  // and the loop passes within a body's width of both.
  const onExit = turn.sampleAt(turn.exitS + 20);
  const fooled = turn.project(onExit.x, onExit.z, 10);
  const hinted = turn.project(onExit.x, onExit.z, turn.exitS + 18);
  check(
    'a hint keeps the two lanes of the line apart',
    Math.abs(hinted.s - (turn.exitS + 20)) < 1.5 && fooled.s < turn.mouthS,
    `hinted to ${hinted.s.toFixed(1)} m, unhinted-at-the-entry to ${fooled.s.toFixed(1)} m`,
  );
}

// --- 3. A car actually drives it --------------------------------------------------
// On the collider baked out of the real terrain, which is the pad, the asphalt and the
// seam between them, with nothing smoothed for the bench's convenience.
{
  await preloadCarModels([MODEL_ID]);
  const physics = await PhysicsWorld.create();
  const x0 = -40;
  const z0 = -40;
  const nx = Math.round(80 / GROUND_STEP) + 1;
  const nz = Math.round((TURNAROUND_ENTRY_S + 80) / GROUND_STEP) + 1;
  const vertices = new Float32Array(nx * nz * 3);
  for (let ix = 0; ix < nx; ix++) {
    for (let iz = 0; iz < nz; iz++) {
      const x = x0 + ix * GROUND_STEP;
      const z = z0 + iz * GROUND_STEP;
      const i = (ix * nz + iz) * 3;
      vertices[i] = x;
      vertices[i + 1] = terrain.heightAt(x, z, Math.max(0, z));
      vertices[i + 2] = z;
    }
  }
  const indices = new Uint32Array((nx - 1) * (nz - 1) * 6);
  for (let ix = 0, o = 0; ix < nx - 1; ix++) {
    for (let iz = 0; iz < nz - 1; iz++) {
      const a = ix * nz + iz;
      const b = (ix + 1) * nz + iz;
      indices[o++] = a; indices[o++] = a + 1; indices[o++] = b;
      indices[o++] = b; indices[o++] = a + 1; indices[o++] = b + 1;
    }
  }
  physics.addStaticTrimesh(vertices, indices, SurfaceType.Asphalt);

  const world = new GameWorld(newWorldState(SEED));
  const start = turn.sampleAt(4);
  const def = carModel(MODEL_ID);
  const engine = variant(def.engineId).engine;
  const state: CarState = {
    id: 'turner', modelId: MODEL_ID, gizmos: {}, stickers: [],
    headlightMode: 'off', taillightsOn: false, reverseLightsOn: false,
    fuelLitres: 40, fuelKind: engine?.fuel ?? null, dirt: 0, scratches: 0, damage: [],
    waterLitres: 10, oilLitres: 10, engineTempC: COLD_SOAK_C,
    storage: new Array<Item | null>(def.storageCells).fill(null),
    bonnet: createBonnetStorage('turner', def.engineId, def.bodyClass, def.tankLitres),
    odometer: 0,
    x: start.x,
    y: carSpawnYAboveGround(carModelMeasure(MODEL_ID), start.y, 0),
    z: start.z,
    qx: 0, qy: Math.sin(start.heading / 2), qz: 0, qw: Math.cos(start.heading / 2),
  };
  world.state.cars['turner'] = state;
  const vehicle = new Vehicle(physics, world, state, new THREE.Scene(), new WorldOrigin());
  const autopilot = new Autopilot(turn, new HazardIndex(), physics);
  autopilot.setMode('sleeper');
  autopilot.setTrafficRecoveryPolicy(true);
  autopilot.setEngaged(true);
  const input = emptyInput();
  input.brake = 1;
  for (let i = 0; i < 120; i++) { vehicle.fixedUpdate(FIXED_DT, input); physics.step(); vehicle.postStep(); }
  input.brake = 0;

  const target = turn.exitS + 25;
  let hint = 4;
  let worstLateral = 0;
  let leastRoom = Infinity;
  let seconds = 0;
  let impacts = 0;
  const position = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < Math.ceil(150 / FIXED_DT) && hint < target; i++) {
    autopilot.drive(FIXED_DT, vehicle, input, 0, 0);
    vehicle.fixedUpdate(FIXED_DT, input);
    physics.step();
    vehicle.postStep();
    if (vehicle.lastImpact && vehicle.lastImpact.severityMps > 1.2) impacts++;
    vehicle.absoluteTranslation(position);
    const projection = turn.project(position.x, position.z, hint);
    hint = projection.s;
    seconds += FIXED_DT;
    worstLateral = Math.max(worstLateral, Math.abs(projection.lateral));
    if (position.z <= 0) {
      leastRoom = Math.min(
        leastRoom,
        TERMINUS_PAD_M - Math.hypot(position.x, position.z + TERMINUS_CENTRE_M),
      );
    }
  }
  const finish = turn.project(position.x, position.z, hint);
  const lane = Math.abs(road.laneCentreAt(0, 0));
  check(
    'a car drives the whole line under the ordinary autopilot',
    hint >= target,
    `reached ${hint.toFixed(1)} m of ${target.toFixed(1)} in ${seconds.toFixed(1)} s`,
  );
  check(
    'it holds the line it is given',
    worstLateral < 2.5,
    `worst ${worstLateral.toFixed(2)} m off the line, over a manoeuvre on ${TERMINUS_HOOK_M} m hooks`,
  );
  check(
    'and never runs out of paving',
    leastRoom > 0.5,
    `${leastRoom.toFixed(2)} m of paving left under the car at its closest to the edge`,
  );
  check(
    'it comes out facing back up the road, in the outgoing lane',
    Math.abs(finish.lateral) < 1.2 && Math.abs(position.x + lane) < 1.5 && position.z > 20,
    `finished at x ${position.x.toFixed(2)} (lane ${(-lane).toFixed(2)}), ${position.z.toFixed(0)} m up the road`,
  );
  check(
    'and hits nothing on the way round',
    impacts === 0,
    `${impacts} impact(s)`,
  );
  vehicle.dispose();
  physics.world.free();
}

console.log(failures === 0 ? '\nall turning-circle checks passed' : `\n${failures} check(s) FAILED`);
if (failures > 0) process.exitCode = 1;
