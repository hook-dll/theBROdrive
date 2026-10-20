/**
 * The story start: where a new game begins.
 *
 * The start is post stop 0 (world/poststops.ts `START_POST_S`), a settlement like every
 * other: its houses, its lay-by, its «ПОЧТА» and «МАГАЗИН» machines, all built by the
 * ordinary POI streams. This module adds only what a new game puts there: the starter
 * car parked on the lay-by's parking line beside the machines, the player on foot
 * between the car and the post, and a handful of keepsakes on the pad.
 *
 * Pure in (seed, road, terrain) and cached per seed; `hash01` and `pick` only, never
 * `Math.random`, so the same seed starts the same way.
 */
import { hash01, pick } from '../core/rng';
import type { Road } from '../world/road';
import type { Terrain } from '../world/terrain';
import { START_POST_S } from '../world/poststops';
import { laybyNear, laybyParkLateral, type Layby } from '../world/layby';
import { roadsideStop } from '../world/settlement';
import { CAMERA_FRAME_LIMIT, type Item } from '../items/items';
import { carModel, modelEngine } from '../vehicle/carmodels';
import { carModelMeasure, carSpawnYAboveGround } from '../render/carmodel';
import { bonnetWaterCapacity, createBonnetStorage } from '../vehicle/bonnet';
import { oilCapacity } from '../parts/registry';
import { COLD_SOAK_C } from '../vehicle/cooling';
import type { CarState, GameWorld } from '../game/state';
import type { LoosePartField } from '../parts/loose';
import { emptyCabin } from '../vehicle/cabin';

/** Domain tag for every roll this file takes; never collides with another system's. */
const STORY_TAG = 0x53545331; // 'STS1'
/** The roadside slot of post stop 0 (world/poislots.ts: slot 2k + 1 is post k). */
const START_SLOT = 1;
/** Clears the teleported feet strictly above the ground, never exactly on it. */
const SPAWN_CLEARANCE_M = 0.05;
/**
 * Player feet: beside the car on the machines' side, metres out from the parking line,
 * and back along it toward the post, so the post and the car both fill the first view.
 */
const SPAWN_OUT_M = 2.2;
const SPAWN_BACK_M = 2.5;
/** Small drop the car falls onto its ground, as the old starter car had. */
const CAR_DROP_METRES = 0.08;
/** Yard clearance the scattered starting items stand above the ground at, metres. */
const ITEM_YARD_CLEARANCE_M = 0.25;

export interface StorySite {
  /** Player FEET spawn (absolute) and camera yaw. */
  readonly spawn: { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number };
  /** Car centre (absolute, y unset) and nose yaw: forward = (sin yaw, cos yaw). */
  readonly car: { readonly x: number; readonly z: number; readonly yaw: number };
  /** The start settlement's lay-by, which the car and the keepsakes stand on. */
  readonly layby: Layby;
}

function computeSite(seed: number, road: Road, terrain: Terrain): StorySite {
  const layby = laybyNear(seed, START_POST_S);
  const post = roadsideStop(seed, START_SLOT)?.layout.post;
  if (!layby || !post) throw new Error('The start settlement has no lay-by');

  // Parked where a passing car parks, at the stop itself: between the post and the shop,
  // clear of the places traffic takes near the pad's far ends (world/traffic.ts
  // `LAYBY_SLOT_END_M`). Nose the way that side's traffic runs.
  const parkLat = laybyParkLateral(layby);
  const carPoint = road.offsetPoint(layby.s, parkLat);
  const heading = road.sampleAt(layby.s).heading;
  const carYaw = layby.side < 0 ? heading : heading + Math.PI;

  const spawnPoint = road.offsetPoint(layby.s - SPAWN_BACK_M, parkLat + layby.side * SPAWN_OUT_M);
  const spawnY = terrain.heightAt(spawnPoint.x, spawnPoint.z, layby.s) + SPAWN_CLEARANCE_M;
  // Facing the post: the first thing a drive is is a contract.
  const postPoint = road.offsetPoint(post.s, post.lateral);
  const spawnYaw = Math.atan2(postPoint.x - spawnPoint.x, postPoint.z - spawnPoint.z);

  return {
    spawn: { x: spawnPoint.x, y: spawnY, z: spawnPoint.z, yaw: spawnYaw },
    car: { x: carPoint.x, z: carPoint.z, yaw: carYaw },
    layby,
  };
}

const siteCache = new Map<number, StorySite>();

/** Pure in (seed, road, terrain); cached per seed. */
export function storySite(seed: number, road: Road, terrain: Terrain): StorySite {
  let site = siteCache.get(seed);
  if (!site) {
    site = computeSite(seed, road, terrain);
    siteCache.set(seed, site);
  }
  return site;
}

// ---------------------------------------------------------------------------
// Starting car
// ---------------------------------------------------------------------------

/** The car every new drive starts in. */
const START_CAR_MODEL_ID = 'kit_vaz1111';

/** Coins in the pack at the start: a litre or two of petrol, nothing more. */
export const START_COINS = 5;

/**
 * Builds the starter car: the VAZ-1111 Oka, the cheapest car on the road, every
 * drive alike (economy plan: the first car is earned up from here). Its fuel, fluids
 * and bonnet wear stay seed-random, it is parked on the start settlement's lay-by, and
 * its papers are the player's.
 *
 * It takes the game's own `road`/`terrain` rather than constructing a second pair
 * (which meant a synchronous spine build while the loading cover was up).
 */
export function createStartingCar(world: GameWorld, road: Road, terrain: Terrain): CarState {
  const site = storySite(world.seed, road, terrain);

  const def = carModel(START_CAR_MODEL_ID);
  const engine = modelEngine(def);

  // Enough for the first courier and a little over; the next litre is bought.
  const fuelLitres = Math.min(8 + hash01(world.seed, 0x3f1) * 4, def.tankLitres);
  const bonnet = createBonnetStorage('car:start', def.engineId, 0.15 + hash01(world.seed, 0x3f4) * 0.2);
  const waterLitres = bonnetWaterCapacity(bonnet) * (0.45 + hash01(world.seed, 0x3f2) * 0.3);
  const oilLitres = oilCapacity(engine) * (0.4 + hash01(world.seed, 0x3f3) * 0.35);

  const measure = carModelMeasure(def.id);
  const carY = carSpawnYAboveGround(
    measure,
    terrain.heightAt(site.car.x, site.car.z, site.layby.s),
    CAR_DROP_METRES,
  );
  const yaw = site.car.yaw;
  const half = yaw / 2;

  return {
    id: 'car:start',
    modelId: def.id,
    papers: true,
    stickers: [],
    headlightMode: 'off',
    taillightsOn: false,
    reverseLightsOn: false,
    dirt: 0.4,
    scratches: 0,
    paint: null,
    fuelLitres,
    waterLitres,
    oilLitres,
    engineTempC: COLD_SOAK_C,
    storage: new Array<Item | null>(def.storageCells).fill(null),
    bonnet,
    cabin: emptyCabin(),
    odometer: 0,
    x: site.car.x,
    y: carY,
    z: site.car.z,
    qx: 0,
    qy: Math.sin(half),
    qz: 0,
    qw: Math.cos(half),
  };
}

// ---------------------------------------------------------------------------
// Starting items
// ---------------------------------------------------------------------------

/**
 * The pool the yard draws from, by index. Kept as an index rather than a maker
 * array so the roll is a plain integer and every id stays derived from `seed`.
 *
 * Keepsakes only: what is used up on the road (cans, gum, medicine, spray, the
 * sponge) is bought at a vending machine, never found (economy plan).
 */
const HOME_ITEM_POOL = 6;

/** One starting item from the pool, with its deterministic `home_item` id. */
function homeItem(world: GameWorld, slot: number, choice: number): Item {
  const id = world.generatedPartId('home_item', 0, slot);
  switch (choice) {
    case 0:
      return { type: 'camera', id, framesRemaining: CAMERA_FRAME_LIMIT };
    case 1:
      return { type: 'pocket_watch', id };
    case 2:
      return { type: 'football', id };
    case 3:
      return { type: 'binoculars', id };
    case 4:
      return { type: 'torchlight', id };
    default:
      return { type: 'sun_shades', id, tint: pick(['green', 'yellow', 'red'] as const, world.seed, 0x9b1, slot) };
  }
}

/**
 * Scatters a seeded handful of keepsakes on the pad beside the starter car: 2-4
 * distinct items from the pool, ground height plus a small clearance. This runs only
 * for a new world, so the stable `home_item` ids can never restock something the
 * player has already taken.
 */
export function spawnStartingItems(
  world: GameWorld,
  loose: LoosePartField,
  road: Road,
  terrain: Terrain,
): void {
  const { layby } = storySite(world.seed, road, terrain);
  const parkU = Math.abs(laybyParkLateral(layby));

  const count = 2 + Math.floor(hash01(world.seed, STORY_TAG, 2) * 3);
  const chosen: number[] = [];
  for (let probe = 0; chosen.length < count && probe < 64; probe++) {
    const choice = Math.floor(hash01(world.seed, STORY_TAG, 0x100 + probe) * HOME_ITEM_POOL) % HOME_ITEM_POOL;
    if (!chosen.includes(choice)) chosen.push(choice);
  }

  for (let slot = 0; slot < chosen.length; slot++) {
    // Clear of the car along the pad (an item inside its hull is an item nobody can
    // see) and short of the places traffic parks in (world/traffic.ts).
    const side = hash01(world.seed, STORY_TAG, 0x200 + slot) < 0.5 ? -1 : 1;
    const along = side * (3.4 + hash01(world.seed, STORY_TAG, 0x210 + slot) * 5);
    const u = parkU + 1.4 + hash01(world.seed, STORY_TAG, 0x220 + slot) * Math.max(0, layby.padOuter - parkU - 1.9);
    const point = road.offsetPoint(layby.s + along, layby.side * u);
    loose.spawnItem(
      homeItem(world, slot, chosen[slot]!),
      point.x,
      terrain.heightAt(point.x, point.z, layby.s) + ITEM_YARD_CLEARANCE_M,
      point.z,
    );
  }
}
