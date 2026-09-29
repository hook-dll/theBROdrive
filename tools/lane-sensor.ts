/**
 * tools/lane-sensor.ts — does a driver see what is in its lane, and only that?
 *
 * The two ways the old chord rays got traffic wrong, set up on the REAL road where it
 * is hardest for them and read through the public `Autopilot.obstacleGap` after one
 * ordinary `drive` step:
 *
 *   - a tight bend, and a car standing in the OPPOSING lane 30/60/90 m ahead. It is
 *     not in this driver's lane; a chord cut across the bend and found it there;
 *   - a blind crest, and a car standing in this driver's OWN lane 40/70/100 m beyond
 *     it. It is there; the first static hit ended the ray, so it was not.
 *
 * The ego is given 40 m/s along the road so its probe reaches every placement. The
 * ribbon under each site is the real road surface, so a crest occludes exactly as the
 * road does.
 *
 * Usage: bun tools/lane-sensor.ts [seed ...]   (default 1337 545124 7)
 */

import * as THREE from 'three';
import { emptyInput } from '../src/core/input';
import { FIXED_DT, PhysicsWorld } from '../src/core/physics';
import { SurfaceType } from '../src/core/surfaces';
import { GameWorld, newWorldState } from '../src/game/state';
import { carModelMeasure, carSpawnYAboveGround, preloadCarModels } from '../src/render/carmodel';
import { benchCarState } from './benchcar';
import { Autopilot } from '../src/vehicle/autopilot';
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

const MODEL_ID = 'sv_vaz2105r';
const EGO_MPS = 40;
/** Tighter than this is a bend a 2 m chord cannot follow at the distances tested. */
const BEND_CURVATURE = 1 / 150;
/** Less sight than this over the profile is a blind crest. */
const CREST_SIGHT_M = 70;
const SITES_PER_KIND = 20;
const SITE_SPACING_M = 600;
const BEND_OFFSETS_M = [30, 60, 90];
const CREST_OFFSETS_M = [40, 70, 100];
/** How far off the true near face a located car may be reported. */
const LOCATE_TOLERANCE_M = 1;

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(56)} ${detail}`);
}

function addRibbon(physics: PhysicsWorld, road: Road, field: SurfaceField, from: number, to: number): void {
  const point = { x: 0, y: 0, z: 0 };
  const rows = Math.ceil(to - from) + 1;
  const vertices = new Float32Array(rows * 6);
  for (let row = 0; row < rows; row++) {
    const s = from + row;
    const half = road.halfWidthAt(s) + 5;
    for (let side = 0; side < 2; side++) {
      const lateral = side === 0 ? -half : half;
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
  physics.addStaticTrimesh(vertices, indices, SurfaceType.Asphalt);
}

async function runSeed(seed: number): Promise<void> {
  const road = new Road(seed);
  const field = new SurfaceField(seed);
  const physics = await PhysicsWorld.create();
  const bends: number[] = [];
  const crests: number[] = [];
  for (let s = 2_000; s < 150_000 && (bends.length < SITES_PER_KIND || crests.length < SITES_PER_KIND); s += 10) {
    if (road.lanesPerSideAt(s) !== 1 || road.lanesPerSideAt(s + 150) !== 1) continue;
    if (
      bends.length < SITES_PER_KIND &&
      Math.abs(road.curvatureAt(s)) > BEND_CURVATURE &&
      (bends.length === 0 || s - bends.at(-1)! > SITE_SPACING_M)
    ) {
      bends.push(s);
    }
    if (
      crests.length < SITES_PER_KIND &&
      road.sightDistanceAt(s, 250) < CREST_SIGHT_M &&
      (crests.length === 0 || s - crests.at(-1)! > SITE_SPACING_M)
    ) {
      crests.push(s);
    }
  }
  for (const s of bends) addRibbon(physics, road, field, s - 80, s + 120);
  for (const s of crests) addRibbon(physics, road, field, s - 40, s + 140);

  const world = new GameWorld(newWorldState(seed));
  const scene = new THREE.Scene();
  const origin = new WorldOrigin();
  const makeCar = (id: string): Vehicle => {
    const state = benchCarState(MODEL_ID, { id, x: 0, y: -500, z: 0, heading: 0 });
    world.state.cars[id] = state;
    return new Vehicle(physics, world, state, scene, origin);
  };
  const ego = makeCar('lane-sensor-ego');
  const other = makeCar('lane-sensor-other');
  const measure = carModelMeasure(MODEL_ID);
  const halfLength = measure.halfExtents[2];
  /** On the road surface, along it: yawed to the road and pitched to its grade. */
  const place = (vehicle: Vehicle, s: number, lateral: number, reversed: boolean): void => {
    const p = road.offsetPoint(s, lateral);
    const sample = road.sampleAt(s);
    const yaw = sample.heading + (reversed ? Math.PI : 0);
    const pitch = -Math.atan(reversed ? -sample.grade : sample.grade);
    const sy = Math.sin(yaw / 2);
    const cy = Math.cos(yaw / 2);
    const sx = Math.sin(pitch / 2);
    const cx = Math.cos(pitch / 2);
    const y = carSpawnYAboveGround(measure, roadSurfaceY(road, field, s, lateral, p.x, p.z), 0);
    vehicle.chassis.setTranslation({ x: p.x, y, z: p.z }, true);
    vehicle.chassis.setRotation({ x: cy * sx, y: cx * sy, z: -sy * sx, w: cy * cx }, true);
    vehicle.chassis.setLinvel({ x: 0, y: 0, z: 0 }, true);
    vehicle.chassis.setAngvel({ x: 0, y: 0, z: 0 }, true);
  };
  const input = emptyInput();
  /** One ordinary drive step from a fresh engagement at `egoS`: what is seen ahead? */
  const seen = (egoS: number): number => {
    // Scene queries read the broad phase as of the last step; the ego's speed is set
    // after it, so the step cannot take any of it away.
    physics.step();
    const heading = road.sampleAt(egoS).heading;
    ego.chassis.setLinvel({ x: Math.sin(heading) * EGO_MPS, y: 0, z: Math.cos(heading) * EGO_MPS }, true);
    const autopilot = new Autopilot(road, new HazardIndex(), physics);
    autopilot.setMode('frantic');
    autopilot.setEngaged(true);
    autopilot.drive(FIXED_DT, ego, input, 0, 0);
    return autopilot.obstacleGap;
  };

  let phantom = 0;
  let bendCases = 0;
  for (const s of bends) {
    for (const d of BEND_OFFSETS_M) {
      const egoS = s - 40;
      place(ego, egoS, road.laneCentreAt(egoS, 0), false);
      place(other, egoS + d, -road.laneCentreAt(egoS + d, 0), true);
      bendCases++;
      if (seen(egoS) < Infinity) phantom++;
    }
  }
  let lost = 0;
  let crestCases = 0;
  let worstError = 0;
  for (const s of crests) {
    for (const d of CREST_OFFSETS_M) {
      place(ego, s, road.laneCentreAt(s, 0), false);
      place(other, s + d, road.laneCentreAt(s + d, 0), false);
      crestCases++;
      const error = Math.abs(seen(s) - (d - halfLength));
      if (!(error <= LOCATE_TOLERANCE_M)) lost++;
      else worstError = Math.max(worstError, error);
    }
  }
  console.log(`seed ${seed}: ${bends.length} tight bends, ${crests.length} blind crests`);
  check(
    'a car in the opposing lane of a bend is not in my lane',
    bendCases > 0 && phantom === 0,
    `${phantom}/${bendCases} reported as a leader`,
  );
  check(
    'a car in my lane behind a blind crest is seen where it is',
    crestCases > 0 && lost === 0,
    `${lost}/${crestCases} missed or misplaced, worst located error ${worstError.toFixed(2)} m`,
  );
}

await preloadCarModels([MODEL_ID]);
const seeds = process.argv.slice(2).map(Number);
for (const seed of seeds.length ? seeds : [1337, 545124, 7]) await runSeed(seed);
if (failures) {
  console.log(`\n${failures} lane-sensor check(s) FAILED`);
  process.exit(1);
}
