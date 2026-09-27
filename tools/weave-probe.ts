/**
 * TEMPORARY probe (deleted before hand-off): lane-hold step response.
 *
 * Places a real car on a real Road, engages the real Autopilot in a named mode from a
 * known lateral offset relative to its own lane centre, and records the deviation from
 * that lane over time. Reports peak-to-peak oscillation after settle, zero crossings,
 * and time to settle within +-0.1 m.
 */
import * as THREE from 'three';
import { emptyInput, type InputFrame } from '../src/core/input';
import { FIXED_DT, PhysicsWorld } from '../src/core/physics';
import { SurfaceType } from '../src/core/surfaces';
import { GameWorld, newWorldState, type CarState } from '../src/game/state';
import { carModelMeasure, carSpawnYAboveGround, preloadCarModels } from '../src/render/carmodel';
import { benchCarState } from './benchcar';
import { Autopilot, type AutopilotMode } from '../src/vehicle/autopilot';
import { carModel } from '../src/vehicle/carmodels';
import { Vehicle } from '../src/vehicle/vehicle';
import { HazardIndex } from '../src/world/hazards';
import { WorldOrigin } from '../src/world/origin';
import { Road } from '../src/world/road';
import { roadSurfaceY, SurfaceField } from '../src/world/roadsurface';
import { installAssetShim } from './assetshim';

class BunProgressEvent extends Event implements ProgressEvent {
  readonly lengthComputable = false;
  readonly loaded = 0;
  readonly total = 0;
}
if (globalThis.ProgressEvent === undefined) globalThis.ProgressEvent = BunProgressEvent;
installAssetShim();

const RIBBON_HALF_WIDTH = 8;

function addRoadCollider(physics: PhysicsWorld, road: Road, from: number, to: number): void {
  const field = new SurfaceField(road.seed);
  const condition = { surface: SurfaceType.Asphalt, decay: 0, sandCover: 0 };
  const chunkMetres = 100;
  const point = { x: 0, y: 0, z: 0 };
  for (let chunkFrom = from; chunkFrom < to; chunkFrom += chunkMetres) {
    const chunkTo = Math.min(to, chunkFrom + chunkMetres);
    const rows = Math.ceil((chunkTo - chunkFrom) / 1) + 1;
    const vertices = new Float32Array(rows * 6);
    for (let row = 0; row < rows; row++) {
      const s = Math.min(chunkTo, chunkFrom + row);
      for (let side = 0; side < 2; side++) {
        const lateral = side === 0 ? -RIBBON_HALF_WIDTH : RIBBON_HALF_WIDTH;
        road.offsetPoint(s, lateral, point);
        const i = (row * 2 + side) * 3;
        vertices[i] = point.x;
        vertices[i + 1] = roadSurfaceY(road, field, s, lateral, point.x, point.z);
        vertices[i + 2] = point.z;
      }
    }
    const indices = new Uint32Array((rows - 1) * 6);
    for (let row = 0, i = 0; row < rows - 1; row++) {
      const a = row * 2;
      indices[i++] = a; indices[i++] = a + 2; indices[i++] = a + 1;
      indices[i++] = a + 2; indices[i++] = a + 3; indices[i++] = a + 1;
    }
    road.conditionAt((chunkFrom + chunkTo) * 0.5, condition);
    physics.addStaticTrimesh(vertices, indices, condition.surface);
  }
}

interface Rig { physics: PhysicsWorld; vehicle: Vehicle; road: Road; autopilot: Autopilot; input: InputFrame; }

async function makeRig(modelId: string, road: Road, startS: number, lateral: number): Promise<Rig> {
  const physics = await PhysicsWorld.create();
  addRoadCollider(physics, road, startS - 60, startS + 700);
  const world = new GameWorld(newWorldState(42));
  const scene = new THREE.Scene();
  const origin = new WorldOrigin();
  const p = road.offsetPoint(startS, lateral);
  const state = benchCarState(modelId, {
    id: 'probe',
    x: p.x,
    y: carSpawnYAboveGround(carModelMeasure(modelId), p.y, 0),
    z: p.z,
    heading: road.sampleAt(startS).heading,
  });
  world.state.cars[state.id] = state;
  const vehicle = new Vehicle(physics, world, state, scene, origin);
  const autopilot = new Autopilot(road, new HazardIndex(), physics);
  const input = emptyInput();
  input.brake = 1;
  for (let i = 0; i < 120; i++) {
    vehicle.fixedUpdate(FIXED_DT, input); physics.step(); vehicle.postStep();
  }
  input.brake = 0;
  input.handbrake = true;
  for (let i = 0; i < 60; i++) {
    vehicle.fixedUpdate(FIXED_DT, input); physics.step(); vehicle.postStep();
  }
  input.handbrake = false;
  return { physics, vehicle, road, autopilot, input };
}

function step(rig: Rig): void {
  rig.autopilot.drive(FIXED_DT, rig.vehicle, rig.input, 0, 0);
  rig.vehicle.fixedUpdate(FIXED_DT, rig.input);
  rig.physics.step();
  rig.vehicle.postStep();
}

interface Sample { t: number; e: number; headingErr: number; yawRate: number; steer: number; v: number; }

async function runCase(
  modelId: string,
  road: Road,
  mode: AutopilotMode,
  startS: number,
  lane: number,
  offsetFromLane: number,
  seconds: number,
): Promise<Sample[]> {
  const laneCentre = road.laneCentreAt(startS, lane);
  const rig = await makeRig(modelId, road, startS, laneCentre + offsetFromLane);
  rig.autopilot.setMode(mode);
  rig.autopilot.setEngaged(true);
  const samples: Sample[] = [];
  let prevS = startS;
  for (let i = 0; i < Math.ceil(seconds / FIXED_DT); i++) {
    step(rig);
    const pos = rig.vehicle.absoluteTranslation({ x: 0, y: 0, z: 0 });
    const proj = rig.road.project(pos.x, pos.z, prevS);
    prevS = proj.s;
    const roadHeading = rig.road.sampleAt(proj.s).heading;
    const rot = rig.vehicle.chassis.rotation();
    // forward vector from quaternion
    const fx = 2 * (rot.x * rot.z + rot.w * rot.y);
    const fz = 1 - 2 * (rot.x * rot.x + rot.y * rot.y);
    const heading = Math.atan2(fx, fz);
    let headingErr = heading - roadHeading;
    while (headingErr > Math.PI) headingErr -= 2 * Math.PI;
    while (headingErr < -Math.PI) headingErr += 2 * Math.PI;
    const lin = rig.vehicle.chassis.linvel();
    samples.push({
      t: (i + 1) * FIXED_DT,
      e: proj.lateral - laneCentre,
      headingErr,
      yawRate: rig.vehicle.chassis.angvel().y,
      steer: rig.input.steer,
      v: Math.hypot(lin.x, lin.z),
    });
  }
  return samples;
}

function metrics(samples: Sample[], settleAfter: number) {
  const tail = samples.filter((s) => s.t >= settleAfter);
  let lo = Infinity, hi = -Infinity;
  for (const s of tail) { lo = Math.min(lo, s.e); hi = Math.max(hi, s.e); }
  let crossings = 0;
  let prev = 0;
  let rms = 0;
  let maxAbs = 0;
  for (const s of tail) {
    rms += s.e * s.e;
    maxAbs = Math.max(maxAbs, Math.abs(s.e));
    const sign = Math.abs(s.e) > 0.02 ? Math.sign(s.e) : 0;
    if (sign && prev && sign !== prev) crossings++;
    if (sign) prev = sign;
  }
  rms = Math.sqrt(rms / Math.max(tail.length, 1));
  // Last time the deviation was outside +-0.1 m.
  let settled = -1;
  for (let i = samples.length - 1; i >= 0; i--) {
    if (Math.abs(samples[i].e) > 0.1) { settled = samples[i].t; break; }
  }
  const peakYaw = Math.max(...tail.map((s) => Math.abs(s.yawRate)));
  return { p2p: hi - lo, crossings, rms, maxAbs, settled, peakYaw };
}

function findSegment(road: Road, from: number, to: number, minS: number, maxS: number, minLen: number): number {
  for (let s = from; s < to; s += 10) {
    let ok = true;
    for (let d = 0; d <= minLen; d += 10) {
      const k = Math.abs(road.curvatureAt(s + d));
      if (k < minS || k > maxS) { ok = false; break; }
    }
    if (ok) return s;
  }
  return -1;
}

async function main(): Promise<void> {
  const models = (process.argv[2] ?? 'sv_gaz21,sv_vaz2105r,sv_gaz24,sv_vaz2101,sv_niva').split(',');
  const mode = (process.argv[3] ?? 'sleeper') as AutopilotMode;
  const lane = Number(process.argv[4] ?? 0);
  await preloadCarModels(models);
  const road = new Road(42);
  const straight = findSegment(road, 900, 6000, 0, 0.0006, 400);
  const curve = findSegment(road, 900, 9000, 0.0035, 0.0075, 400);
  console.log(`straight at s=${straight} (k=${road.curvatureAt(straight).toFixed(5)}), curve at s=${curve} (k=${road.curvatureAt(curve).toFixed(5)}, R=${(1 / road.curvatureAt(curve)).toFixed(0)} m)`);
  console.log(`halfWidth ${road.halfWidthAt(straight).toFixed(2)} m, lanesPerSide ${road.lanesPerSideAt(straight)}`);
  for (const [label, s] of [['STRAIGHT', straight], ['CURVE', curve]] as const) {
    if (s < 0) { console.log(`${label}: none found`); continue; }
    for (const offset of [0, 0.75, -0.75]) {
      const row: string[] = [];
      for (const model of models) {
        const samples = await runCase(model, road, mode, s, lane, offset, 20);
        const m = metrics(samples, 5);
        row.push(`${model}: p2p=${m.p2p.toFixed(3)} zc=${m.crossings} rms=${m.rms.toFixed(3)} max=${m.maxAbs.toFixed(3)} settled<=0.1@${m.settled < 0 ? 'never' : m.settled.toFixed(2) + 's'} yawPk=${m.peakYaw.toFixed(3)}`);
      }
      console.log(`${label} offset ${offset >= 0 ? '+' : ''}${offset.toFixed(2)} m  [${mode}]`);
      for (const r of row) console.log('    ' + r);
    }
  }
}

void main();
