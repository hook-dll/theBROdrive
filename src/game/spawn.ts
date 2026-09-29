/**
 * Spawning a complete car model from the pause menu.
 *
 * Pure state work, mirroring state.ts's layering: records the model, fuel and
 * transform, then adds the car through world.apply like every other mutation.
 * No three.js or Rapier imports — the caller materialises the Vehicle from the
 * returned CarState.
 */

import { carModel } from '../vehicle/carmodels';
import { oilCapacity, variant } from '../parts/registry';
import type { Item } from '../items/items';
import type { CarState, GameWorld } from './state';
import { bonnetWaterCapacity, createBonnetStorage } from '../vehicle/bonnet';
import { COLD_SOAK_C } from '../vehicle/cooling';

/** What the pause menu chose to spawn: a complete model catalogue id. */
export interface SpawnRequest {
  modelId: string;
}

/**
 * Builds a complete, serviceable car without deciding whether it is persistent.
 *
 * World spawns add the result to `GameWorld`; temporary traffic keeps it in its own
 * runtime world so ambient simulation works without traffic leaking into saves.
 */
export function createServiceableCarState(
  id: string,
  modelId: string,
  x: number,
  y: number,
  z: number,
  heading: number,
  /**
   * A non-stock engine to leave the factory with, in bonnet cell 0, or the model's own.
   * Frantic traffic fits one (`engine_bmw_m30`); see `RoadTraffic`.
   */
  engineVariantId?: string,
): CarState {
  const def = carModel(modelId);
  const engineId = engineVariantId ?? def.engineId;
  const engine = variant(engineId).engine;
  const half = heading / 2;
  const bonnet = createBonnetStorage(id, engineId, def.bodyClass, def.tankLitres);
  return {
    id,
    modelId,
    stickers: [],
    headlightMode: 'off',
    taillightsOn: false,
    reverseLightsOn: false,
    dirt: 0,
    scratches: 0,
    paint: null,
    fuelLitres: def.tankLitres,
    waterLitres: bonnetWaterCapacity(bonnet),
    oilLitres: engine ? oilCapacity(engine) : 0,
    engineTempC: COLD_SOAK_C,
    storage: new Array<Item | null>(def.storageCells).fill(null),
    bonnet,
    odometer: 0,
    x,
    y,
    z,
    qx: 0,
    qy: Math.sin(half),
    qz: 0,
    qw: Math.cos(half),
  };
}

/** Records a complete, fully fuelled car into state and returns it. */
export function spawnCarState(
  world: GameWorld,
  request: SpawnRequest,
  x: number,
  y: number,
  z: number,
  heading: number,
): CarState {
  const car = createServiceableCarState(
    world.runtimePartId(),
    request.modelId,
    x,
    y,
    z,
    heading,
  );
  world.apply({ t: 'car_add', car });
  return car;
}

/** A car's resting pose on the ground: see `poseOnGround`. */
export interface GroundPose {
  /** The fitted ground plane's height under the chassis origin, metres. */
  readonly groundY: number;
  readonly qx: number;
  readonly qy: number;
  readonly qz: number;
  readonly qw: number;
}

/**
 * A CAR PUT DOWN ON A GRADE STANDS ON ITS WHEELS, TILTED AS THE GROUND IS.
 *
 * Put down level on a slope, it meets the ground with one axle and the end of its own
 * box collider. Anything that then holds it still — a settle, a parking hold — pins it
 * there, and the moment the car is driven the solver finds the box inside the road and
 * throws it out: measured on the real road, every body the traffic bench wrote off as
 * "thrown out of the geometry" was a car leaving the ground at 20-90 m/s within
 * seconds of its settle ending, every one on a 7-16% grade.
 *
 * So the ground is read under each wheel (`groundAt`, absolute x/z), a plane is fitted
 * through those heights in the car's own frame, and the pose is the heading pitched and
 * rolled onto it. Null when any wheel has no ground under it; the caller then has
 * nothing better than level.
 */
export function poseOnGround(
  wheels: readonly { readonly pos: readonly [number, number, number] }[],
  x: number,
  z: number,
  heading: number,
  groundAt: (x: number, z: number) => number | null,
): GroundPose | null {
  const count = wheels.length;
  if (count < 3) return null;
  const sin = Math.sin(heading);
  const cos = Math.cos(heading);
  // Chassis-local +Z is forward, (sin h, cos h); local +X is (cos h, -sin h).
  const heights: number[] = [];
  let meanX = 0;
  let meanZ = 0;
  let meanG = 0;
  for (const wheel of wheels) {
    const lx = wheel.pos[0];
    const lz = wheel.pos[2];
    const g = groundAt(x + lx * cos + lz * sin, z - lx * sin + lz * cos);
    if (g === null) return null;
    heights.push(g);
    meanX += lx;
    meanZ += lz;
    meanG += g;
  }
  meanX /= count;
  meanZ /= count;
  meanG /= count;
  // Least squares on a wheel layout that is a rectangle about its centroid: the two
  // slopes separate, one sum each.
  let sxg = 0;
  let sxx = 0;
  let szg = 0;
  let szz = 0;
  for (let i = 0; i < count; i++) {
    const dx = wheels[i]!.pos[0] - meanX;
    const dz = wheels[i]!.pos[2] - meanZ;
    const dg = heights[i]! - meanG;
    sxg += dx * dg;
    sxx += dx * dx;
    szg += dz * dg;
    szz += dz * dz;
  }
  const slopeX = sxx > 1e-6 ? sxg / sxx : 0;
  const slopeZ = szz > 1e-6 ? szg / szz : 0;
  // Yaw about +Y, then pitch about the new +X (nose up is a negative turn about +X),
  // then roll about the new +Z (local +X rising is a positive turn).
  const yaw = heading / 2;
  const pitch = -Math.atan(slopeZ) / 2;
  const roll = Math.atan(slopeX) / 2;
  const yw = Math.cos(yaw);
  const yy = Math.sin(yaw);
  const pw = Math.cos(pitch);
  const px = Math.sin(pitch);
  const rw = Math.cos(roll);
  const rz = Math.sin(roll);
  // yaw ⊗ pitch, then that ⊗ roll, expanded for single-axis factors.
  const aw = yw * pw;
  const ax = yw * px;
  const ay = yy * pw;
  const az = -yy * px;
  return {
    groundY: meanG - slopeX * meanX - slopeZ * meanZ,
    qw: aw * rw - az * rz,
    qx: ax * rw + ay * rz,
    qy: ay * rw - ax * rz,
    qz: az * rw + aw * rz,
  };
}
