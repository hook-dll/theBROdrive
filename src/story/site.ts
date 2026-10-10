/**
 * The story start: where a new game begins.
 *
 * A random dwelling from the catalogue stands off the RIGHT of the runout, its
 * front to the asphalt; the starter car is parked on the verge between the house
 * and the road; a handful of yard finds lie around them; and a light airfield —
 * a runway, its markings, a windsock and a parked plane — lies across the road on
 * the LEFT, inside the dead-straight runout (`STRAIGHT_RUNOUT` in roadcurve.ts) and
 * the levelled ground around the origin (`HOME_FLAT_RADIUS` in landscape.ts).
 *
 * This module owns only the LAYOUT: pure in (seed, road, terrain) and cached per
 * seed, it answers every question about the site's frames, and the chunk provider
 * (`sitebuild.ts`), the car and the starting items all ask it rather than each
 * restating a constant. Nothing here builds a mesh or a body.
 *
 * Determinism is total — `hash01` and `pick` only, never `Math.random` — so the same
 * seed rebuilds the same house, car, plane and item scatter.
 */
import { hash01, pick } from '../core/rng';
import type { Road } from '../world/road';
import type { Terrain } from '../world/terrain';
import { fitGround } from '../world/footprint';
import { DWELLINGS } from '../world/dwellings/list';
import {
  createStructureInstance,
  structureCount,
  structureDef,
} from '../world/poistructures';
import { faceRoadYaw } from '../world/poi';
import { CAR_PAINTS } from '../vehicle/carpaint';
import { CAMERA_FRAME_LIMIT, makeSponge, type Item } from '../items/items';
import { CAR_MODELS, modelEngine } from '../vehicle/carmodels';
import { carModelMeasure, carSpawnYAboveGround } from '../render/carmodel';
import { bonnetWaterCapacity, createBonnetStorage } from '../vehicle/bonnet';
import { oilCapacity } from '../parts/registry';
import { COLD_SOAK_C } from '../vehicle/cooling';
import type { CarState, GameWorld } from '../game/state';
import type { LoosePartField } from '../parts/loose';

// ---------------------------------------------------------------------------
// Layout constants. Positions are expressed in the road frame: `s` is arclength
// along the runout, `lateral` is `road.offsetPoint`'s signed offset, POSITIVE to
// the LEFT of travel. The house is on the RIGHT (negative lateral), the airfield
// on the LEFT (positive). Heading is zero and the road dead straight here, but
// every point is still taken through `offsetPoint`/`sampleAt` so the site follows
// whatever the road builder does.
// ---------------------------------------------------------------------------

/** Arclength of the house: ahead of the runout's start, clear of the terminus pad. */
const SITE_S = 116;
/** Domain tag for every roll this file takes; never collides with another system's. */
const STORY_TAG = 0x53545331; // 'STS1'

/** Gap between the asphalt edge and the house's nearest wall: 9-12 m, see `storySite`. */
const HOUSE_SETBACK_MIN_M = 9;
const HOUSE_SETBACK_SPAN_M = 3;
/**
 * How far below the fitted ground plane the house is sunk, on top of the plane's own
 * residual — the same margin `poi.ts` uses for every catalogue building, so the story
 * house is seated exactly like the rest of the world's dwellings.
 */
const SEAT_BURY_MARGIN = 0.08;
/** Clears the teleported feet strictly above the sand, never exactly on it. */
const SPAWN_CLEARANCE_M = 0.05;
/** Car centre, road-side of the house's front wall, metres. */
const CAR_SETBACK_M = 1.8;
/** Player feet, road-side of the front wall, metres: in front of the car, facing the house. */
const SPAWN_SETBACK_M = 3.8;
/** Small drop the car falls onto its ground, as the old starter car had. */
const CAR_DROP_METRES = 0.08;

/** Runway centreline lateral, metres LEFT of the road; and the stretch of runout it uses. */
const RUNWAY_LAT = 26;
const RUNWAY_S0 = 30;
const RUNWAY_S1 = 255;
/** Half the runway width rolls inside 7-8 m, so the frame is 14-16 m across. */
const RUNWAY_HALF_WIDTH_MIN = 7;
const RUNWAY_HALF_WIDTH_SPAN = 1;
/** Strip surface, a few centimetres above the terrain it is draped on. */
export const RUNWAY_LIFT_M = 0.06;
/** The parked plane's origin sits this far in from the threshold, metres. */
const PLANE_INSET_M = 5;

/** Yard clearance the scattered starting items stand above the ground at, metres. */
const ITEM_YARD_CLEARANCE_M = 0.25;

// ---------------------------------------------------------------------------
// Keep-clear rectangles, used by the scatter and ground-cover streams so desert
// props never grow through the house yard or the airfield. They are SEED-FREE and
// deliberately generous: the house depth and the runway width both roll with the
// seed, and a keep-clear box may only ever be too big.
//
// Desert TILES also scatter props, but need no entry here: a tile prop within 65 m
// of the road is already dropped (`deserttiledata.ts`, the corridor gate), and the
// whole site — house yard included — stands inside that 65 m.
// ---------------------------------------------------------------------------
const HOUSE_CLEAR = { s0: SITE_S - 34, s1: SITE_S + 34, l0: -70, l1: -5 } as const;
const AIRFIELD_CLEAR = { s0: 18, s1: 268, l0: 12, l1: 44 } as const;

/**
 * The runway's own frame: where the takeoff roll starts, which way it runs, how far
 * and how wide, and an arclength hint for the terrain queries along it.
 */
export interface RunwayFrame {
  /** Absolute world XZ of the runway centreline where the takeoff roll starts (the parked plane's spot). */
  readonly x0: number;
  readonly z0: number;
  /** Unit world-XZ direction of the takeoff roll. */
  readonly dx: number;
  readonly dz: number;
  /** Metres from (x0,z0) along (dx,dz) to the far end; and full width. */
  readonly length: number;
  readonly width: number;
  /** Arclength hint for terrain queries along it. */
  readonly hintS: number;
  /**
   * Surface height at stations `RUNWAY_PROFILE_STEP_M` apart from (x0,z0), lift included.
   * Level across the width and smoothed along it: see `runwayProfile`.
   */
  readonly profile: Float32Array;
}

export interface StorySite {
  readonly house: {
    readonly structure: number;
    readonly x: number;
    readonly z: number;
    readonly yaw: number;
    readonly seatY: number;
    readonly pitch: number;
    readonly roll: number;
  };
  readonly runway: RunwayFrame;
  /** Parked plane pose: absolute; y = ground under the main gear; yaw so forward = (sin yaw, cos yaw) = runway direction. */
  readonly plane: { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number };
  /** Player FEET spawn (absolute) and camera yaw. */
  readonly spawn: { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number };
}

/** The site plus the derived frames its builders need but the public interface does not. */
interface SiteGeometry {
  readonly site: StorySite;
  /** Measured half extents of the placed dwelling, metres. */
  readonly halfX: number;
  readonly halfZ: number;
  /** Absolute car centre and nose yaw. */
  readonly car: { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number };
  /** The house's front-wall lateral, the anchor the car, spawn and yard are measured from. */
  readonly frontLat: number;
}

/**
 * Every catalogue dwelling that is not an abandoned ruin, as `POI_STRUCTURES` indices.
 *
 * A ruin is a dwelling by kind but a wreck by intent — a story that opens on the
 * player's own house cannot open on a collapsed one — so the pool is the living half
 * of the catalogue. The mapping goes through `structureDef().id` rather than an
 * assumed mast offset, so re-ordering either catalogue cannot silently pick a mast.
 */
function houseChoices(): number[] {
  const byId = new Map(DWELLINGS.map((dwelling) => [dwelling.id, dwelling]));
  const choices: number[] = [];
  for (let index = 0; index < structureCount(); index++) {
    const def = structureDef(index);
    if (def.kind !== 'dwelling') continue;
    if (byId.get(def.id)?.abandoned) continue;
    choices.push(index);
  }
  return choices;
}

function computeSite(seed: number, road: Road, terrain: Terrain): SiteGeometry {
  const ref = road.sampleAt(SITE_S);
  const heading = ref.heading;
  const halfWidth = road.halfWidthAt(SITE_S);

  // --- The house ------------------------------------------------------------
  const choices = houseChoices();
  const structure = choices[Math.floor(hash01(seed, STORY_TAG, 3) * choices.length) % choices.length]!;
  // Measured rather than authored: the setback is bought from the building's own
  // depth, and the catalogue's declared footprint is never trusted for that.
  const instance = createStructureInstance(structure);
  const halfX = instance.halfExtentX;
  const halfZ = instance.halfExtentZ;

  const setbackWall = HOUSE_SETBACK_MIN_M + hash01(seed, STORY_TAG, 4) * HOUSE_SETBACK_SPAN_M;
  const frontLat = -(halfWidth + setbackWall);
  const houseLat = frontLat - halfZ;
  const housePoint = road.offsetPoint(SITE_S, houseLat);
  const variantSeed = (seed ^ STORY_TAG) >>> 0;
  // Front (local -Z) faces the asphalt; the same table `poi.ts` uses for every
  // roadside dwelling, so the story house is oriented by the world's own rule.
  const yaw = faceRoadYaw(heading, houseLat, variantSeed);
  const plane = fitGround(terrain, housePoint.x, housePoint.z, yaw, halfX, halfZ, SITE_S, 5);
  const seatY = plane.centreY - plane.residual - SEAT_BURY_MARGIN;

  // --- The runway, across the road -----------------------------------------
  const halfRunway = RUNWAY_HALF_WIDTH_MIN + hash01(seed, STORY_TAG, 6) * RUNWAY_HALF_WIDTH_SPAN;
  const p0 = road.offsetPoint(RUNWAY_S0, RUNWAY_LAT);
  const p1 = road.offsetPoint(RUNWAY_S1, RUNWAY_LAT);
  const rawLength = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  const dx = (p1.x - p0.x) / rawLength;
  const dz = (p1.z - p0.z) / rawLength;
  const runway: RunwayFrame = {
    x0: p0.x,
    z0: p0.z,
    dx,
    dz,
    length: rawLength,
    width: halfRunway * 2,
    hintS: SITE_S,
    profile: runwayProfile(terrain, p0.x, p0.z, dx, dz, rawLength, halfRunway, SITE_S),
  };

  // --- The parked plane -----------------------------------------------------
  const planeX = p0.x + dx * PLANE_INSET_M;
  const planeZ = p0.z + dz * PLANE_INSET_M;
  const planeY = runwaySurfaceY(runway, planeX, planeZ);
  const planeYaw = Math.atan2(dx, dz);

  // --- Car and player -------------------------------------------------------
  // The car is parked ALONG the runout on the verge between the wall and the
  // asphalt: nose down the road, broadside to the house, which keeps its whole
  // length clear of the building's footprint by a metre of bare sand.
  const carLat = frontLat + CAR_SETBACK_M;
  const carPoint = road.offsetPoint(SITE_S, carLat);
  const carYaw = yaw + Math.PI / 2;

  const spawnLat = frontLat + SPAWN_SETBACK_M;
  const spawnPoint = road.offsetPoint(SITE_S, spawnLat);
  const spawnY = terrain.heightAt(spawnPoint.x, spawnPoint.z, SITE_S) + SPAWN_CLEARANCE_M;
  // Facing back across the yard: the car, then the house, fill the view. The plane
  // is behind the player's shoulder, which is the point — nobody is pushed at it.
  const spawnYaw = yaw;

  const site: StorySite = {
    house: { structure, x: housePoint.x, z: housePoint.z, yaw, seatY, pitch: plane.pitch, roll: plane.roll },
    runway,
    plane: { x: planeX, y: planeY, z: planeZ, yaw: planeYaw },
    spawn: { x: spawnPoint.x, y: spawnY, z: spawnPoint.z, yaw: spawnYaw },
  };

  return {
    site,
    halfX,
    halfZ,
    car: { x: carPoint.x, y: 0, z: carPoint.z, yaw: carYaw },
    frontLat,
  };
}

const siteCache = new Map<number, SiteGeometry>();

/** The site's full geometry, computed once per seed. */
function siteGeometry(seed: number, road: Road, terrain: Terrain): SiteGeometry {
  let geometry = siteCache.get(seed);
  if (!geometry) {
    geometry = computeSite(seed, road, terrain);
    siteCache.set(seed, geometry);
  }
  return geometry;
}

/** Pure in (seed, road, terrain); cached per seed. */
export function storySite(seed: number, road: Road, terrain: Terrain): StorySite {
  return siteGeometry(seed, road, terrain).site;
}

/** Metres between the runway's height stations. */
const RUNWAY_PROFILE_STEP_M = 3;
/** Stations either side each smoothing pass reaches over: ±6 m. */
const RUNWAY_PROFILE_REACH = 2;

/**
 * The runway's surface heights: LEVEL ACROSS, SMOOTH ALONG, AND NEVER UNDER THE SAND.
 *
 * Draping the strip vertex by vertex on `heightAt` let the ground's decimetre chop show
 * through its edges and rocked the rolling plane. Each station instead takes the highest
 * ground across the whole width (and half a station either way), a running maximum over
 * ±6 m removes the dips between bumps, and a running mean over the same reach rounds the
 * result. Every mean covers the station's own maximum, so the surface stays at or above
 * the sand everywhere on the strip; the low side stands proud by a few centimetres and
 * the drawn shoulder (`sitebuild.ts`) takes it back down to the ground.
 */
function runwayProfile(
  terrain: Terrain,
  x0: number,
  z0: number,
  dx: number,
  dz: number,
  length: number,
  halfWidth: number,
  hintS: number,
): Float32Array {
  const count = Math.ceil(length / RUNWAY_PROFILE_STEP_M) + 1;
  const raw = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    let high = -Infinity;
    for (let along = -1.5; along <= 1.5; along += 1.5) {
      const t = Math.min(length, Math.max(0, i * RUNWAY_PROFILE_STEP_M + along));
      const cx = x0 + dx * t;
      const cz = z0 + dz * t;
      for (let across = -halfWidth; across <= halfWidth + 1e-6; across += halfWidth / 5) {
        high = Math.max(high, terrain.heightAt(cx - dz * across, cz + dx * across, hintS));
      }
    }
    raw[i] = high;
  }
  const peak = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    let high = -Infinity;
    for (let k = Math.max(0, i - RUNWAY_PROFILE_REACH); k <= Math.min(count - 1, i + RUNWAY_PROFILE_REACH); k++) {
      high = Math.max(high, raw[k]!);
    }
    peak[i] = high;
  }
  const profile = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    let sum = 0;
    let n = 0;
    for (let k = Math.max(0, i - RUNWAY_PROFILE_REACH); k <= Math.min(count - 1, i + RUNWAY_PROFILE_REACH); k++) {
      sum += peak[k]!;
      n++;
    }
    profile[i] = sum / n + RUNWAY_LIFT_M;
  }
  return profile;
}

/** Height of the runway surface (drawn and collided strip) at an absolute XZ. */
export function runwaySurfaceY(runway: RunwayFrame, x: number, z: number): number {
  const along = (x - runway.x0) * runway.dx + (z - runway.z0) * runway.dz;
  const last = runway.profile.length - 1;
  const f = Math.min(last, Math.max(0, along / RUNWAY_PROFILE_STEP_M));
  const i = Math.min(last - 1, Math.floor(f));
  const u = f - i;
  return runway.profile[i]! * (1 - u) + runway.profile[i + 1]! * u;
}

/** Scatter/ground-cover must skip (s, lateral) inside the house yard or the airfield. Pure, seed-free. */
export function storyKeepsClear(s: number, lateral: number): boolean {
  if (s >= HOUSE_CLEAR.s0 && s <= HOUSE_CLEAR.s1 && lateral >= HOUSE_CLEAR.l0 && lateral <= HOUSE_CLEAR.l1) {
    return true;
  }
  return s >= AIRFIELD_CLEAR.s0 && s <= AIRFIELD_CLEAR.s1 && lateral >= AIRFIELD_CLEAR.l0 && lateral <= AIRFIELD_CLEAR.l1;
}

// ---------------------------------------------------------------------------
// Starting car
// ---------------------------------------------------------------------------

/**
 * Builds the starter car: the same deterministic seed-based catalogue pick, fuel,
 * fluids and bonnet the old homestead had, now parked on the verge in front of the
 * story house instead of in a garage the world no longer builds.
 *
 * It takes the game's own `road`/`terrain` rather than constructing a second pair
 * (which meant a synchronous spine build while the loading cover was up).
 */
export function createStartingCar(world: GameWorld, road: Road, terrain: Terrain): CarState {
  const geometry = siteGeometry(world.seed, road, terrain);

  const def = pick(CAR_MODELS, world.seed, 0x3f0);
  const engine = modelEngine(def);

  const fuelLitres = Math.min(4 + hash01(world.seed, 0x3f1) * 6, def.tankLitres);
  const bonnet = createBonnetStorage(
    'car:start',
    def.engineId,
    def.bodyClass,
    def.tankLitres,
    0.15 + hash01(world.seed, 0x3f4) * 0.2,
  );
  const waterLitres = bonnetWaterCapacity(bonnet) * (0.45 + hash01(world.seed, 0x3f2) * 0.3);
  const oilLitres = oilCapacity(engine) * (0.4 + hash01(world.seed, 0x3f3) * 0.35);

  const measure = carModelMeasure(def.id);
  const carY = carSpawnYAboveGround(
    measure,
    terrain.heightAt(geometry.car.x, geometry.car.z, SITE_S),
    CAR_DROP_METRES,
  );
  const yaw = geometry.car.yaw;
  const half = yaw / 2;

  return {
    id: 'car:start',
    modelId: def.id,
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
    odometer: 0,
    x: geometry.car.x,
    y: carY,
    z: geometry.car.z,
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
 */
const HOME_ITEM_POOL = 12;

/** One starting item from the pool, with its deterministic `home_item` id. */
function homeItem(world: GameWorld, slot: number, choice: number): Item {
  const id = world.generatedPartId('home_item', 0, slot);
  const roll = (tag: number): number => hash01(world.seed, 0x9a1 + tag, slot);
  switch (choice) {
    case 0:
      return {
        type: 'fluid_can',
        id,
        fluid: 'petrol',
        capacity: 20,
        litres: Math.round((6 + roll(1) * 12) * 10) / 10,
      };
    case 1:
      return {
        type: 'fluid_can',
        id,
        fluid: 'water',
        capacity: 5,
        litres: Math.round((2 + roll(2) * 3) * 10) / 10,
      };
    case 2:
      return { type: 'camera', id, framesRemaining: CAMERA_FRAME_LIMIT };
    case 3:
      return { type: 'pocket_watch', id };
    case 4:
      return { type: 'football', id };
    case 5:
      return { type: 'medicine', id };
    case 6:
      return { type: 'binoculars', id };
    case 7:
      return { type: 'torchlight', id };
    case 8:
      return { type: 'sun_shades', id, tint: pick(['green', 'yellow', 'red'] as const, world.seed, 0x9b1, slot) };
    case 9:
      return {
        type: 'spray_can',
        id,
        paint: pick(CAR_PAINTS, world.seed, 0x9b2, slot).hex,
        charge: 0.45 + roll(3) * 0.55,
      };
    case 10:
      return { type: 'bubble_gum', id, charges: 2 + Math.floor(roll(4) * 4) };
    default:
      return makeSponge(id, roll(6));
  }
}

/**
 * Scatters a seeded handful of finds around the story house: 4-6 distinct items
 * from the pool, laid on the yard between the front wall and the asphalt, ground
 * height plus a small clearance. This runs only for a new world, so the stable
 * `home_item` ids can never restock something the player has already taken.
 */
export function spawnStartingItems(
  world: GameWorld,
  loose: LoosePartField,
  road: Road,
  terrain: Terrain,
): void {
  const geometry = siteGeometry(world.seed, road, terrain);
  const { frontLat, halfX } = geometry;

  const count = 4 + Math.floor(hash01(world.seed, STORY_TAG, 2) * 3);
  const chosen: number[] = [];
  for (let probe = 0; chosen.length < count && probe < 64; probe++) {
    const choice = Math.floor(hash01(world.seed, STORY_TAG, 0x100 + probe) * HOME_ITEM_POOL) % HOME_ITEM_POOL;
    if (!chosen.includes(choice)) chosen.push(choice);
  }

  for (let slot = 0; slot < chosen.length; slot++) {
    // Kept clear of the car along the road: the car owns the centre of the verge,
    // and an item inside its hull is an item nobody can see.
    const side = hash01(world.seed, STORY_TAG, 0x200 + slot) < 0.5 ? -1 : 1;
    const along = side * (3.4 + hash01(world.seed, STORY_TAG, 0x210 + slot) * 5);
    const lateral = frontLat + 1.6 + hash01(world.seed, STORY_TAG, 0x220 + slot) * 5;
    const point = road.offsetPoint(
      SITE_S + Math.max(-halfX - 2, Math.min(halfX + 2, along)),
      lateral,
    );
    loose.spawnItem(
      homeItem(world, slot, chosen[slot]!),
      point.x,
      terrain.heightAt(point.x, point.z, SITE_S) + ITEM_YARD_CLEARANCE_M,
      point.z,
    );
  }
}
