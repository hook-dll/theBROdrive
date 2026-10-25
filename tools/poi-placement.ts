/**
 * POI placement and the story start: are the buildings where they claim to be?
 *
 *   npx tsx tools/poi-placement.ts
 *
 * Three properties, none of which anything else checks.
 *
 * NO BUILDING STANDS IN THE ROAD. The offset is now derived from the road's width at
 * that arclength AND the building's own size, so a 30 m storefront and a 5.8 m kiosk
 * both clear the asphalt by a verge — where a single fixed offset either put the
 * storefront in the lane or the kiosk in the middle of nowhere.
 *
 * NO STRUCTURE IS A RARITY. Fifty-three buildings drawn from one hash means the mix is
 * a property of the seed, not a guarantee; over a long enough stretch every one must
 * actually appear, or some of the catalogue is content nobody will ever see.
 *
 * THE START IS WHERE IT SAYS IT IS. A new game opens on post stop 0's lay-by: the car
 * on the pad clear of the houses and the machines, the player on foot beside it facing
 * the post, the finds on the pad. Those come from story/site.ts on top of a settlement
 * the ordinary streams build, and nothing but this bench holds the two together.
 */

import * as THREE from 'three';
import { GameWorld, newWorldState } from '../src/game/state';
import { type ChunkContext } from '../src/world/chunks';
import { CHUNK_LENGTH } from '../src/world/ranges';
import { Road } from '../src/world/road';
import { Terrain } from '../src/world/terrain';
import {
  DESERT_SPACING_M,
  PoiProvider,
  desertPoiClearOfRoad,
  desertPoisBetween,
  houseRect,
  poisBetween,
  rectGap,
  standingHouses,
  type GroundRect,
} from '../src/world/poi';
import { MarketField } from '../src/world/market';
import { MAST_IDS, roadsideSlotOfIndex, roadsideSlotsBetween, slotPost } from '../src/world/poislots';
import { postS, START_POST_S } from '../src/world/poststops';
import { laybyNear, laybyOuterAt } from '../src/world/layby';
import {
  roadsideStop,
  SERVICE_HALF,
  spotPose,
  structureHalfExtents,
  type SettlementSpot,
} from '../src/world/settlement';
import { postParkingSlots } from '../src/world/haulbay';
import { toyBay } from '../src/world/toybox';
import { createVariantInstance, variantCount, variantDef } from '../src/world/poivariantbuild';
import {
  POI_STRUCTURES,
  createStructureInstance,
  structureCount,
  structureDef,
  warmPoiStructures,
} from '../src/world/poistructures';
import { RoadDistance } from '../src/world/roaddistance';
import { createPoiVariant, mergePoiStatics } from '../src/world/poi-variants';
import { fitGround } from '../src/world/footprint';
import { carModelMeasure } from '../src/render/carmodel';
import { createStartingCar, spawnStartingItems, storySite } from '../src/story/site';
import { halfWidthAt } from '../src/world/roadprofile';
import { installDocumentShim } from './domshim';

// The road's asphalt paints its maps on a 2D canvas the first time it is asked for.
installDocumentShim();

const SEED = 1337;
const failures: string[] = [];
function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

const world = new GameWorld(newWorldState(SEED));
const road = new Road(SEED);
const terrain = new Terrain(SEED, road);
const roadDistance = new RoadDistance(road);

/** The verge the placement promises between the asphalt edge and the nearest wall. */
const MIN_VERGE_M = 10;
/** The widest span the placement promises on top of it. */
const MAX_VERGE_M = 22;

// --- 1. every building clears the road ---------------------------------------
{
  let checked = 0;
  let worstVerge = Infinity;
  let tightest = '';
  for (const poi of poisBetween(SEED, 0, 2_000_000)) {
    const def = structureDef(poi.structure);
    const halfBuilding = Math.max(def.footprint[0], def.footprint[1]) / 2;
    const edge = halfWidthAt(SEED, poi.s);
    const clearance = Math.abs(poi.lateral) - edge - halfBuilding;
    checked++;
    if (clearance < worstVerge) {
      worstVerge = clearance;
      tightest = `${def.id} at ${poi.s} m (${clearance.toFixed(1)} m)`;
    }
  }
  check(checked > 100, `expected many slots to check, saw ${checked}`);
  check(
    worstVerge >= MIN_VERGE_M - 1e-6,
    `a building stands ${worstVerge.toFixed(1)} m from the asphalt edge, inside the ` +
      `${MIN_VERGE_M} m verge: ${tightest}`,
  );
  check(
    worstVerge <= MAX_VERGE_M + 1e-6,
    `a building stands ${worstVerge.toFixed(1)} m out, beyond the ${MAX_VERGE_M} m span: ${tightest}`,
  );
  console.log(
    `  ${checked} slots placed, tightest verge ${worstVerge.toFixed(1)} m (${tightest})`,
  );

  // THE AUTHORED FOOTPRINT IS THE MEASURED ONE. Placement never builds a house to learn
  // its size, so a footprint smaller than the house is a wall nearer the road than the
  // verge promises. The extent toward the road is the measured half depth, which is
  // symmetric about the anchor and so covers whichever side faces the road.
  let worstShortfall = 0;
  let shortest = '';
  for (let index = 0; index < structureCount(); index++) {
    const instance = createStructureInstance(index);
    const def = structureDef(index);
    const half = Math.max(def.footprint[0], def.footprint[1]) / 2;
    const shortfall = Math.max(instance.halfExtentX, instance.halfExtentZ) - half;
    if (shortfall > worstShortfall) {
      worstShortfall = shortfall;
      shortest = def.id;
    }
  }
  check(
    worstShortfall <= 0.35,
    `${shortest} measures ${worstShortfall.toFixed(2)} m larger than its authored footprint`,
  );

  // DESERT BUILDINGS STAND OUT IN THE DESERT, clear of every pass of the road and not in
  // one another: the lateral alone cannot promise that where the road doubles back.
  const spacing = DESERT_SPACING_M;
  const desert = desertPoisBetween(SEED, 0, 400 * spacing, spacing);
  const standing = desert.filter((poi) => desertPoiClearOfRoad(poi, road, roadDistance));
  let nearestRoad = Infinity;
  for (const poi of standing) {
    const point = road.offsetPoint(poi.s, poi.lateral);
    const nearest = road.project(point.x, point.z, roadDistance.ownerAt(point.x, point.z, 50));
    const def = structureDef(poi.structure);
    const gap = Math.abs(nearest.lateral) - road.halfWidthAt(nearest.s) - Math.max(...def.footprint) / 2;
    nearestRoad = Math.min(nearestRoad, gap);
  }
  check(standing.length > 100, `only ${standing.length} desert buildings over ${(400 * spacing) / 1000} km`);
  check(nearestRoad >= 48 - 1e-6, `a desert building stands ${nearestRoad.toFixed(1)} m from the asphalt`);
  console.log(
    `  ${standing.length} desert buildings (${desert.length - standing.length} dropped near another pass), ` +
      `nearest ${nearestRoad.toFixed(0)} m from any asphalt; largest footprint shortfall ` +
      `${worstShortfall.toFixed(2)} m (${shortest || 'none'})`,
  );
}

// --- 2. the whole catalogue is reachable -------------------------------------
{
  const seen = new Set<number>();
  let settlements = 0;
  let lone = 0;
  for (const poi of poisBetween(SEED, 0, 4_800_000)) {
    seen.add(poi.structure);
    if (roadsideStop(SEED, roadsideSlotOfIndex(poi.index))?.layout.settlement) settlements++;
    else lone++;
  }
  check(
    seen.size === structureCount(),
    `only ${seen.size} of ${structureCount()} structures ever appear over 4,800 km`,
  );
  console.log(`  ${seen.size}/${structureCount()} structures reachable; ${settlements} settlements, ${lone} lone stops`);

  // THE SPACING RULE: the first settlement is the start, at `START_POST_S`, the next three
  // 2.5-4 km apart, every later one 2.5-8 km; no two roadside stops under 2.5 km apart.
  for (let seed = 1; seed <= 40; seed++) {
    const first = postS(seed, 0);
    check(first === START_POST_S, `seed ${seed}: the first settlement is at ${first.toFixed(0)} m`);
    for (let k = 1; k <= 400; k++) {
      const gap = postS(seed, k) - postS(seed, k - 1);
      const [lo, hi] = k <= 3 ? [2500, 4000] : [2500, 8000];
      check(gap >= lo && gap <= hi, `seed ${seed}: settlement ${k} is ${gap.toFixed(0)} m past the last`);
    }
    const stops = poisBetween(seed, 0, postS(seed, 400));
    check(stops[0]?.s === first, `seed ${seed}: the first roadside stop is not the first settlement`);
    for (let i = 1; i < stops.length; i++) {
      const gap = stops[i]!.s - stops[i - 1]!.s;
      check(gap >= 2500 - 1e-6 && gap <= 8000 + 1e-6, `seed ${seed}: roadside stops ${gap.toFixed(0)} m apart at ${stops[i]!.s.toFixed(0)} m`);
    }
  }
}

// --- 3. the start holds together ---------------------------------------------
//
// A new game opens on post stop 0's lay-by. The settlement is the ordinary one; what
// story/site.ts adds must stand in it without meeting it: the car on the pad between
// the machines and clear of every house and service, the player beside it on the
// ground and facing the post, and the finds on the pad, out of the car.
{
  const inRect = (r: GroundRect, x: number, z: number, margin: number): boolean => {
    const c = Math.cos(r.yaw);
    const s = Math.sin(r.yaw);
    const lx = c * (x - r.x) - s * (z - r.z);
    const lz = s * (x - r.x) + c * (z - r.z);
    return Math.abs(lx) < r.halfX + margin && Math.abs(lz) < r.halfZ + margin;
  };
  for (let seed = 1; seed <= 12; seed++) {
    const seedRoad = seed === SEED ? road : new Road(seed);
    const seedTerrain = seed === SEED ? terrain : new Terrain(seed, seedRoad);
    const seedWorld = seed === SEED ? world : new GameWorld(newWorldState(seed));
    const site = storySite(seed, seedRoad, seedTerrain);
    const { spawn, layby } = site;
    const stop = roadsideStop(seed, 1);
    check(stop !== null && stop.layout.settlement, `seed ${seed}: the start is not a settlement`);
    if (!stop) continue;
    const where = `seed ${seed} start`;
    check(Math.abs(layby.s - START_POST_S) < 1e-6, `${where}: the lay-by is at ${layby.s.toFixed(0)} m`);

    // Everything a body could stand inside: the houses and the services.
    const blocks: { name: string; rect: GroundRect }[] = stop.layout.houses.map((house) => ({
      name: structureDef(house.structure).id,
      rect: houseRect(seedRoad, house),
    }));
    for (const name of ['post', 'shop', 'toybox', 'pumps', 'shelter'] as const) {
      const at = stop.layout[name];
      if (!at) continue;
      const pose = spotPose(seedRoad, at);
      const alongRoad = Math.abs(Math.sin(at.yaw)) < 0.5;
      const [along, across] = SERVICE_HALF[name];
      blocks.push({ name, rect: { ...pose, halfX: alongRoad ? across : along, halfZ: alongRoad ? along : across } });
    }
    // The parking row's slots: a waiting load or a car for sale stands in them.
    postParkingSlots(seed, seedRoad, 0).forEach((slot, k) => {
      blocks.push({ name: `parking slot ${k + 1}`, rect: { x: slot.x, z: slot.z, yaw: slot.yaw, halfX: slot.halfWidth, halfZ: slot.halfDepth } });
    });
    const clearOf = (what: string, x: number, z: number, margin: number): void => {
      for (const block of blocks) {
        check(!inRect(block.rect, x, z, margin), `${where}: the ${what} stands in the ${block.name}`);
      }
    };
    const onPad = (what: string, x: number, z: number, reachAlong: number, reachAcross: number): void => {
      const at = seedRoad.project(x, z, layby.s);
      const u = at.lateral * layby.side;
      check(
        at.s - reachAlong >= layby.sPadStart && at.s + reachAlong <= layby.sPadEnd &&
          u - reachAcross >= layby.padInner - 0.05 && u + reachAcross <= layby.padOuter + 0.05,
        `${where}: the ${what} is off the pad (s ${at.s.toFixed(1)}, u ${u.toFixed(2)})`,
      );
    };

    // The car: on the pad as a whole, on the ground, clear of houses and machines.
    const car = createStartingCar(seedWorld, seedRoad, seedTerrain);
    const [halfW, halfH, halfL] = carModelMeasure(car.modelId).halfExtents;
    onPad('starter car', car.x, car.z, halfL, halfW);
    for (const corner of [-1, 1]) {
      const p = seedRoad.offsetPoint(layby.s + corner * halfL, layby.side * Math.abs(seedRoad.project(car.x, car.z, layby.s).lateral));
      clearOf('starter car', p.x, p.z, halfW);
    }
    clearOf('starter car', car.x, car.z, halfW);
    const groundAtCar = seedTerrain.heightAt(car.x, car.z, layby.s);
    check(car.y > groundAtCar && car.y - groundAtCar < 1, `${where}: the car is ${(car.y - groundAtCar).toFixed(2)} m off the ground`);
    check(halfH > 0, `${where}: the car has no height`);

    // The player: on the ground beside the car, out of it, facing the post.
    onPad('player', spawn.x, spawn.z, 0, 0);
    clearOf('player', spawn.x, spawn.z, 0.3);
    const carLocal = seedRoad.project(car.x, car.z, layby.s);
    const spawnLocal = seedRoad.project(spawn.x, spawn.z, layby.s);
    check(
      Math.abs(spawnLocal.lateral - carLocal.lateral) > halfW + 0.4 || Math.abs(spawnLocal.s - carLocal.s) > halfL + 0.4,
      `${where}: the player spawns inside the car`,
    );
    const groundAtSpawn = seedTerrain.heightAt(spawn.x, spawn.z, layby.s);
    check(spawn.y > groundAtSpawn && spawn.y - groundAtSpawn < 0.5, `${where}: the player spawns ${(spawn.y - groundAtSpawn).toFixed(2)} m off the ground`);
    const post = spotPose(seedRoad, stop.layout.post!);
    const toPost = Math.hypot(post.x - spawn.x, post.z - spawn.z);
    check(
      (Math.sin(spawn.yaw) * (post.x - spawn.x) + Math.cos(spawn.yaw) * (post.z - spawn.z)) / toPost > 0.99,
      `${where}: the player does not start facing the post`,
    );

    // The finds: 2-4, on the pad, out of the car, on the ground.
    const spawned: { type: string; x: number; y: number; z: number }[] = [];
    spawnStartingItems(
      seedWorld,
      {
        spawnItem: (item: { type: string }, x: number, y: number, z: number) => {
          spawned.push({ type: item.type, x, y, z });
        },
        spawnPart: () => {},
        forget: () => {},
      } as never,
      seedRoad,
      seedTerrain,
    );
    check(spawned.length >= 2 && spawned.length <= 4, `${where}: ${spawned.length} starting items, outside the authored 2-4`);
    for (const item of spawned) {
      onPad(`starting ${item.type}`, item.x, item.z, 0, 0);
      clearOf(`starting ${item.type}`, item.x, item.z, 0.2);
      const at = seedRoad.project(item.x, item.z, layby.s);
      check(
        Math.abs(at.lateral - carLocal.lateral) > halfW + 0.2 || Math.abs(at.s - carLocal.s) > halfL + 0.2,
        `${where}: the starting ${item.type} lies inside the car`,
      );
      const ground = seedTerrain.heightAt(item.x, item.z, layby.s);
      check(item.y > ground - 0.05 && item.y - ground < 1.5, `${where}: the starting ${item.type} is ${(item.y - ground).toFixed(2)} m off the ground`);
    }
  }
  console.log(`  the start: car, player and finds on stop 0's pad, clear of its houses and machines, seeds 1-12`);
}

// --- 4. placing a building fits in the streaming budget ----------------------
//
// The risk this guards is not correctness but a HITCH. Buildings are streamed one job
// per frame against a 3 ms budget, so a placement that costs more than that stutters
// every time a new one comes into view — and this world has one every 1.2 km. Building a
// variant from scratch costs 3.7 ms on a 5950X, which is why the assets are cached; this
// asserts the cache is still doing its job, because a future edit that quietly rebuilds
// per placement would otherwise be invisible until somebody drove the road.
{
  const STREAM_BUDGET_MS = 3;
  // Warm first, exactly as the game does at boot.
  warmPoiStructures();
  const samples: number[] = [];
  const rounds = 6;
  for (let r = 0; r < rounds; r++) {
    for (let index = 0; index < structureCount(); index++) {
      const t0 = process.hrtime.bigint();
      createStructureInstance(index);
      samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
  }
  samples.sort((a, b) => a - b);
  const worst = samples[samples.length - 1]!;
  const mean = samples.reduce((sum, v) => sum + v, 0) / samples.length;
  check(
    worst < STREAM_BUDGET_MS,
    `placing a building costs ${worst.toFixed(2)} ms at worst, over the ` +
      `${STREAM_BUDGET_MS} ms streaming budget — the assets are being rebuilt per placement`,
  );
  console.log(
    `  placement ${mean.toFixed(3)} ms mean, ${worst.toFixed(3)} ms worst ` +
      `(${samples.length} placements, budget ${STREAM_BUDGET_MS} ms)`,
  );
}

// --- 5. what the world builds IS what the gallery shows ----------------------
//
// THE CHECK THIS FILE WAS MISSING, and its absence cost a real bug. A variant is built
// from the catalogue, merged, then cached and re-made per placement — and the caching
// step reconstructed every mesh at the origin, which silently flattened every mesh that
// `mergePoiStatics` does not merge (roofs, door markers, unique-material trims). The result
// was buildings with no roofs and one variant 2.7 m short, and it looked plausible in a
// screenshot, because most of a building IS merged.
//
// So the property is stated directly: an instance must have the same meshes, the same
// roofs and the same extent as the merged catalogue form the gallery displays.
{
  let worst = 0;
  let worstId = '';
  for (let index = 0; index < variantCount(); index++) {
    const gallery = createPoiVariant(index);
    mergePoiStatics(gallery);
    gallery.updateMatrixWorld(true);

    let galleryMeshes = 0;
    let galleryRoofs = 0;
    gallery.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      galleryMeshes++;
      if (mesh.userData.poiRoof === true) galleryRoofs++;
    });

    const instance = createVariantInstance(index);
    instance.group.updateMatrixWorld(true);
    let instanceMeshes = 0;
    let instanceRoofs = 0;
    instance.group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      instanceMeshes++;
      if (mesh.userData.poiRoof === true) instanceRoofs++;
    });

    const id = variantDef(index).id;
    check(
      instanceMeshes === galleryMeshes,
      `${id}: the world builds ${instanceMeshes} meshes where the gallery shows ${galleryMeshes}`,
    );
    check(
      instanceRoofs === galleryRoofs,
      `${id}: the world builds ${instanceRoofs} roof panels where the gallery shows ${galleryRoofs}`,
    );

    const want = new THREE.Box3().setFromObject(gallery, true);
    const got = new THREE.Box3();
    instance.group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      got.expandByObject(mesh, true);
    });
    const delta = Math.max(
      Math.abs(want.min.y - got.min.y),
      Math.abs(want.max.y - got.max.y),
      Math.abs(want.min.x - got.min.x),
      Math.abs(want.max.x - got.max.x),
      Math.abs(want.min.z - got.min.z),
      Math.abs(want.max.z - got.max.z),
    );
    if (delta > worst) {
      worst = delta;
      worstId = id;
    }
    check(
      delta < 0.01,
      `${id}: the world builds a building ${delta.toFixed(2)} m different from the ` +
        'gallery\'s, so something is being dropped or misplaced',
    );
  }
  console.log(
    `  ${variantCount()} kit variants match the gallery to within ${worst.toFixed(3)} m (worst: ${worstId})`,
  );
}

// --- 6. the buildings stand ON the ground -------------------------------------
//
// A building must stand on the sand. The apron that used to sit under every POI was
// the wrong answer to uneven ground: measured 0.82 m deep on one building, it read as a
// plinth. What replaced it is a fitted plane and a `residual` of burial, and whether that
// is enough is a question about the ground under the walls — which is what is measured
// here, directly, rather than inferred from the height of one point.
{
  const WALK_CHUNKS = 1500;
  const walkKm = (WALK_CHUNKS * CHUNK_LENGTH) / 1000;
  const provider = new PoiProvider(
    roadDistance,
    new MarketField(),
    { register: () => {}, forget: () => {} } as never,
  );

  /**
   * Ground height, with the road frame resolved the way the placer resolves it.
   *
   * `terrain.heightAt` is a SEARCH along the road for the nearest point, and the hint it
   * is given decides which branch of a road that doubles back on itself it finds.
   * Measured: dropping the hint moved the answer by up to 34 m at these stops, so asking
   * without one is not a slightly different measurement, it is a measurement of somewhere
   * else. The chunk a building came from brackets its arclength; projecting from there
   * converges on the branch the placer itself used.
   */
  const groundAt = (x: number, z: number, nearS: number): number => {
    let s = nearS;
    for (let k = 0; k < 4; k++) s = road.project(x, z, s).s;
    return terrain.heightAt(x, z, s);
  };

  /** Buildings spanning a stretch of road, built the way the streamer builds them. */
  const buildings: THREE.Object3D[] = [];
  const placed: { readonly object: THREE.Object3D; readonly s: number }[] = [];
  for (let chunk = 0; chunk < WALK_CHUNKS; chunk++) {
    const sStart = chunk * CHUNK_LENGTH;
    const ctx = {
      chunkIndex: chunk,
      sStart,
      sEnd: sStart + CHUNK_LENGTH,
      road,
      terrain,
      world,
      hasPhysics: false,
      originX: 0,
      originZ: 0,
    } as unknown as ChunkContext;
    const content = provider.build(ctx);
    if (!content) continue;
    // Chunk-local and world coincide here (`originX`/`originZ` are zero), so the matrix
    // this bakes is a real world matrix and the terrain can be asked about it.
    content.group.updateMatrixWorld(true);
    const nearS = sStart + CHUNK_LENGTH / 2;
    content.group.traverse((object) => {
      if (typeof object.userData.poiStructure !== 'string') return;
      buildings.push(object);
      placed.push({ object, s: nearS });
    });
  }

  check(buildings.length > 0, `not one building was placed in ${walkKm} km of road`);

  // A WALL MUST MEET THE GROUND. The building's floor is the plane its local y=0 lies in,
  // so ground that resolves BELOW that plane at any point under the footprint is daylight
  // under a wall. Sampling the ground densely is the point: `fitGround` fits to a grid, and
  // the gap it cannot see is the one between its own samples.
  let worstGap = 0;
  let worstGapId = '';
  const inverse = new THREE.Matrix4();
  const probe = new THREE.Vector3();
  for (const { object: building, s: nearS } of placed) {
    const structure = POI_STRUCTURES.find((s) => s.id === building.userData.poiStructure);
    if (structure === undefined) continue;
    const [footX, footZ] = structure.footprint;
    inverse.copy(building.matrixWorld).invert();
    const steps = 8;
    for (let i = 0; i <= steps; i++) {
      for (let j = 0; j <= steps; j++) {
        const lx = (i / steps - 0.5) * footX;
        const lz = (j / steps - 0.5) * footZ;
        probe.set(lx, 0, lz).applyMatrix4(building.matrixWorld);
        const ground = groundAt(probe.x, probe.z, nearS);
        probe.y = ground;
        probe.applyMatrix4(inverse);
        // Positive means the sand is above the floor — buried, which is fine. Negative
        // means the sand has fallen away below the building.
        const gap = -probe.y;
        if (gap > worstGap) {
          worstGap = gap;
          worstGapId = String(building.userData.poiStructure);
        }
      }
    }
  }
  check(
    worstGap < 0.05,
    `the worst building (${worstGapId}) stands ${worstGap.toFixed(2)} m above its ground — ` +
      'there is daylight under a wall',
  );

  console.log(
    `  ${buildings.length} buildings over ${walkKm} km: worst gap under a wall ` +
      `${worstGap.toFixed(3)} m`,
  );
}

// --- 7. settlements: nothing stands in anything -------------------------------
//
// Every courier/post stop is a settlement (world/settlement.ts): houses of one type on
// both sides of the road and a service band along one long lay-by. The layout is pure
// and spaced in the road frame; what is checked here is the world it builds, with the
// houses that actually stand (`standingHouses`): over seeds 1-20 and the first 300 km,
// no house in another house, on any pass of the road, on the lay-by's asphalt or on a
// service spot; every service and parking slot ON the lay-by's asphalt, none in another
// (the slots touch each other); the signpost on the sand past it.
//
// The houses' measured sizes are written down (world/dwellings/bounds.ts) so the layout
// can stay pure; that table must contain what the built house measures.
{
  let worstTable = 0;
  let worstTableId = '';
  for (let index = MAST_IDS.length; index < structureCount(); index++) {
    const instance = createStructureInstance(index);
    const [halfX, halfZ] = structureHalfExtents(index);
    const id = structureDef(index).id;
    check(
      halfX >= instance.halfExtentX - 1e-6 && halfZ >= instance.halfExtentZ - 1e-6,
      `${id}: dwellings/bounds.ts says ${halfX} x ${halfZ}, the house measures ` +
        `${instance.halfExtentX.toFixed(3)} x ${instance.halfExtentZ.toFixed(3)}`,
    );
    const slack = Math.max(halfX - instance.halfExtentX, halfZ - instance.halfExtentZ);
    check(slack <= 0.05, `${id}: dwellings/bounds.ts is ${slack.toFixed(2)} m larger than the house`);
    if (slack > worstTable) {
      worstTable = slack;
      worstTableId = id;
    }
  }
  console.log(`  measured bounds table within ${worstTable.toFixed(3)} m of the built houses (${worstTableId || 'exact'})`);

  const SEEDS = 20;
  const REACH_M = 300_000;
  /** Least clear ground, metres, the checks hold each pair to. */
  const HOUSE_HOUSE_M = 1.5;
  const HOUSE_ROAD_M = 6;
  const HOUSE_LAYBY_M = 1.5;
  const HOUSE_SPOT_M = 1.5;
  const SPOT_SPOT_M = 1;
  /** A service's outline keeps this far inside the lay-by's asphalt edge; the signpost this far outside it. */
  const SPOT_ASPHALT_M = 0.3;

  /** Points round a rectangle's outline, a half metre apart, corners included. */
  const outline = (r: GroundRect): { x: number; z: number }[] => {
    const points: { x: number; z: number }[] = [];
    const c = Math.cos(r.yaw);
    const s = Math.sin(r.yaw);
    const push = (lx: number, lz: number): void => {
      points.push({ x: r.x + c * lx + s * lz, z: r.z - s * lx + c * lz });
    };
    const nx = Math.max(2, Math.ceil((2 * r.halfX) / 0.5));
    const nz = Math.max(2, Math.ceil((2 * r.halfZ) / 0.5));
    for (let i = 0; i <= nx; i++) {
      const lx = -r.halfX + (2 * r.halfX * i) / nx;
      push(lx, -r.halfZ);
      push(lx, r.halfZ);
    }
    for (let j = 1; j < nz; j++) {
      const lz = -r.halfZ + (2 * r.halfZ * j) / nz;
      push(-r.halfX, lz);
      push(r.halfX, lz);
    }
    return points;
  };
  /** Depth of a point inside a rectangle grown by `margin`; positive is inside. */
  const inside = (r: GroundRect, x: number, z: number, margin: number): boolean => {
    const c = Math.cos(r.yaw);
    const s = Math.sin(r.yaw);
    const dx = x - r.x;
    const dz = z - r.z;
    // The inverse of the outline's rotation.
    const lx = c * dx - s * dz;
    const lz = s * dx + c * dz;
    return Math.abs(lx) < r.halfX + margin && Math.abs(lz) < r.halfZ + margin;
  };

  let settlements = 0;
  let lone = 0;
  let housesLaid = 0;
  let housesStanding = 0;
  let oneSided = 0;
  const perSettlement = new Map<number, number>();
  let nearestRoad = Infinity;
  let nearestLayby = Infinity;
  let nearestHouse = Infinity;
  let nearestSpot = Infinity;
  /** The least asphalt between any service or slot and the lay-by's outer edge. */
  let nearestEdge = Infinity;
  const firstFailures = failures.length;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const seedRoad = new Road(seed);
    const seedTerrain = new Terrain(seed, seedRoad);
    const seedDistance = new RoadDistance(seedRoad);
    for (const slot of roadsideSlotsBetween(seed, 0, REACH_M)) {
      const stop = roadsideStop(seed, slot);
      if (!stop) continue;
      const { layout, roll } = stop;
      if (layout.settlement) settlements++;
      else lone++;
      const where = `seed ${seed} km ${(roll.s / 1000).toFixed(1)}`;
      const layby = laybyNear(seed, roll.s);
      const own = layby?.poiIndex === roll.index ? layby : null;
      check(!layout.settlement || own !== null, `${where}: a settlement has no lay-by`);

      const standing = standingHouses(layout, seedRoad, seedTerrain, seedDistance);
      housesLaid += layout.houses.length;
      housesStanding += standing.length;
      if (layout.settlement) {
        perSettlement.set(standing.length, (perSettlement.get(standing.length) ?? 0) + 1);
        const sides = new Set(standing.map((house) => Math.sign(house.lateral)));
        if (sides.size < 2) oneSided++;
      }

      // The services as rectangles: facing the road their X runs along it. All but the
      // signpost stand on the pad (`onPad`); the parking row's slots touch one another.
      const spots: { name: string; rect: GroundRect; s: number; onPad: boolean; slot: boolean }[] = [];
      const addSpot = (name: string, at: SettlementSpot | null, along: number, across: number, onPad = true): void => {
        if (!at) return;
        const pose = spotPose(seedRoad, at);
        const alongRoad = Math.abs(Math.sin(at.yaw)) < 0.5;
        spots.push({
          name,
          s: at.s,
          rect: { ...pose, halfX: alongRoad ? across : along, halfZ: alongRoad ? along : across },
          onPad,
          slot: false,
        });
      };
      for (const name of ['post', 'shop', 'toybox', 'pumps', 'shelter'] as const) {
        addSpot(name, layout[name], SERVICE_HALF[name][0], SERVICE_HALF[name][1]);
      }
      if (layout.parking) {
        postParkingSlots(seed, seedRoad, slotPost(slot)).forEach((bay, k) => {
          spots.push({
            name: `parking slot ${k + 1}`,
            s: bay.s,
            rect: { x: bay.x, z: bay.z, yaw: bay.yaw, halfX: bay.halfWidth, halfZ: bay.halfDepth },
            onPad: true,
            slot: true,
          });
        });
      }
      if (layout.toybox) {
        // The toy box's marked bay (world/toybox.ts): a car comes out in it.
        const bay = toyBay(seed, seedRoad, slotPost(slot));
        spots.push({
          name: 'toy box bay',
          s: bay.s,
          rect: { x: bay.x, z: bay.z, yaw: bay.yaw, halfX: bay.halfWidth, halfZ: bay.halfDepth },
          onPad: true,
          slot: false,
        });
      }
      if (own) {
        // The signpost (world/signposts.ts): two posts and a 2.6 m board at the pad's start.
        addSpot('signpost', { s: own.sPadStart + 4, lateral: own.side * (own.padOuter + 1), yaw: 0.5 * Math.PI * own.side }, 1.4, 0.2, false);
      }

      const rects = standing.map((house) => houseRect(seedRoad, house));
      for (let a = 0; a < standing.length; a++) {
        const house = standing[a]!;
        const rect = rects[a]!;
        const points = outline(rect);
        for (const p of points) {
          // Every pass of the road: the nearest one, wherever along the road it is.
          const owner = seedDistance.ownerAt(p.x, p.z, 50);
          const near = seedRoad.project(p.x, p.z, owner);
          const roadGap = Math.abs(near.lateral) - seedRoad.halfWidthAt(near.s);
          nearestRoad = Math.min(nearestRoad, roadGap);
          check(roadGap >= HOUSE_ROAD_M, `${where}: a ${structureDef(house.structure).id} stands ${roadGap.toFixed(2)} m from asphalt`);
          // The stop's own lay-by, in its road frame.
          if (own) {
            const at = seedRoad.project(p.x, p.z, house.s);
            const u = at.lateral * own.side;
            if (u > 0 && at.s > own.sEntry - HOUSE_LAYBY_M && at.s < own.sExit + HOUSE_LAYBY_M) {
              const sc = Math.min(own.sExit, Math.max(own.sEntry, at.s));
              const gap = Math.hypot(Math.max(0, u - laybyOuterAt(own, sc, seedRoad.halfWidthAt(sc))), at.s - sc);
              nearestLayby = Math.min(nearestLayby, gap);
              check(gap >= HOUSE_LAYBY_M, `${where}: a house stands ${gap.toFixed(2)} m from the lay-by's asphalt`);
            }
          }
          for (let b = 0; b < rects.length; b++) {
            if (b === a) continue;
            check(!inside(rects[b]!, p.x, p.z, HOUSE_HOUSE_M), `${where}: two houses stand within ${HOUSE_HOUSE_M} m of each other`);
          }
          for (const spot of spots) {
            check(!inside(spot.rect, p.x, p.z, HOUSE_SPOT_M), `${where}: a house stands on the ${spot.name}`);
          }
        }
        for (let b = a + 1; b < rects.length; b++) nearestHouse = Math.min(nearestHouse, rectGap(rect, rects[b]!));
      }

      for (let i = 0; i < spots.length; i++) {
        const spot = spots[i]!;
        for (let j = i + 1; j < spots.length; j++) {
          if (spot.slot && spots[j]!.slot) continue;
          const gap = rectGap(spot.rect, spots[j]!.rect);
          nearestSpot = Math.min(nearestSpot, gap);
          check(gap >= SPOT_SPOT_M, `${where}: the ${spot.name} and the ${spots[j]!.name} are ${gap.toFixed(2)} m apart`);
        }
        if (!own) continue;
        for (const p of outline(spot.rect)) {
          const at = seedRoad.project(p.x, p.z, spot.s);
          const u = at.lateral * own.side;
          const outer = laybyOuterAt(own, at.s, seedRoad.halfWidthAt(at.s));
          if (spot.onPad) {
            const margin = outer - u;
            nearestEdge = Math.min(nearestEdge, margin);
            check(
              u >= own.padInner && margin >= SPOT_ASPHALT_M,
              `${where}: the ${spot.name} is off the lay-by's asphalt (${margin.toFixed(2)} m inside its edge)`,
            );
          } else {
            check(u >= outer + SPOT_ASPHALT_M, `${where}: the ${spot.name} stands on the lay-by's asphalt`);
          }
        }
      }
    }
  }
  check(settlements > SEEDS * 20, `only ${settlements} settlements over ${SEEDS} x ${REACH_M / 1000} km`);
  const counts = [...perSettlement.entries()].sort((a, b) => a[0] - b[0]).map(([n, k]) => `${n}:${k}`).join(' ');
  console.log(
    `  ${settlements} settlements and ${lone} lone stops over seeds 1-${SEEDS} x ${REACH_M / 1000} km; ` +
      `${housesStanding}/${housesLaid} houses stand (houses per settlement ${counts}; ${oneSided} one-sided)`,
  );
  console.log(
    `  nearest: house-asphalt ${nearestRoad.toFixed(2)} m, house-lay-by ${nearestLayby.toFixed(2)} m, ` +
      `house-house ${nearestHouse.toFixed(2)} m, spot-spot ${nearestSpot.toFixed(2)} m, ` +
      `spot-asphalt edge ${nearestEdge.toFixed(2)} m inside; ` +
      `${failures.length - firstFailures} overlaps`,
  );
}

if (failures.length > 0) {
  for (const failure of failures) console.log(`  FAIL  ${failure}`);
  throw new Error(`${failures.length} placement checks failed`);
}
console.log('\nevery building clears the road, the catalogue is reachable, and the home holds together');
