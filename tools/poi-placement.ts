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
 * THE STORY SITE IS WHERE IT SAYS IT IS. The house is tilted onto its own fitted ground
 * plane at the authored setback, the player spawns on the yard OUTSIDE it, the car is
 * clear of its footprint, and the runway across the road is clear of both and carries
 * the parked plane at its threshold. Those are separate constants in separate files, and
 * nothing but this bench holds them together.
 */

import * as THREE from 'three';
import { GameWorld, newWorldState } from '../src/game/state';
import { type ChunkContext } from '../src/world/chunks';
import { CHUNK_LENGTH } from '../src/world/ranges';
import { Road } from '../src/world/road';
import { Terrain } from '../src/world/terrain';
import { PoiProvider, desertPoiClearOfRoad, desertPoisBetween, poisBetween } from '../src/world/poi';
import { POI_SPACING, type PoiStock } from '../src/world/poislots';
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
import { BoardableField, StartSiteProvider } from '../src/story/sitebuild';
import {
  createStartingCar,
  runwaySurfaceY,
  spawnStartingItems,
  storyKeepsClear,
  storySite,
} from '../src/story/site';
import { halfWidthAt } from '../src/world/roadprofile';
import type { TrailerField } from '../src/vehicle/trailer';
import type { WreckTrunkField } from '../src/world/wrecktrunks';
import { installDocumentShim } from './domshim';

// The story runway is laid in the road's own asphalt, which paints its maps on a 2D
// canvas the first time it is asked for.
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
/**
 * Worst residual the fitted ground plane may have before the compound's tilt is
 * hiding real terrain the plane failed to fit, not just the ordinary slope this
 * site is meant to absorb. `poi.ts`'s own catalogue measures 0.22-0.44 m across
 * every other building; this compound is larger (39 m along the road) than any of
 * them, so it is given headroom above that range rather than the same ceiling.
 */
const MAX_RESIDUAL_M = 0.6;

// --- 1. every building clears the road ---------------------------------------
{
  let checked = 0;
  let worstVerge = Infinity;
  let tightest = '';
  for (let index = 1; index <= 260; index++) {
    const s = index * POI_SPACING;
    const pois = poisBetween(SEED, s - 1, s + 1, POI_SPACING);
    const poi = pois[0];
    if (!poi) continue;
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
  const spacing = POI_SPACING;
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
  const perStock = new Map<PoiStock, number>();
  for (let index = 1; index <= 4000; index++) {
    const spacing = POI_SPACING;
    const pois = poisBetween(SEED, index * spacing - 1, index * spacing + 1, spacing);
    const poi = pois[0];
    if (!poi) continue;
    seen.add(poi.structure);
    perStock.set(poi.stock, (perStock.get(poi.stock) ?? 0) + 1);
  }
  check(
    seen.size === structureCount(),
    `only ${seen.size} of ${structureCount()} structures ever appear over 4,800 km`,
  );
  const mix = [...perStock.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${name} ${count}`)
    .join(', ');
  console.log(`  ${seen.size}/${structureCount()} structures reachable; ${mix}`);
}

// --- 3. the story site holds together ----------------------------------------
//
// A new game opens on a random dwelling with the car and a scatter of finds beside
// it, and an airfield across the road. Every one of those is a separate constant in
// `src/story/site.ts`, and nothing but this bench holds them together: the house on
// its fitted plane and the authored setback, the spawn OUTSIDE the building, the car
// clear of it, the runway clear of the road and of the house, the plane sitting on the
// strip, and the items on the yard rather than inside a wall.
{
  const boardable = new BoardableField();
  const provider = new StartSiteProvider(boardable);
  const ctx = {
    chunkIndex: 0,
    sStart: 0,
    sEnd: CHUNK_LENGTH,
    road,
    terrain,
    world,
    hasPhysics: false,
    originX: 0,
    originZ: 0,
  } as unknown as ChunkContext;
  const content = provider.build(ctx);
  check(content !== null, 'the story site built nothing for chunk 0');

  // World matrices first: the provider returns a detached group, so every mesh's
  // `matrixWorld` is still identity and a bounds query would measure the site at the
  // origin. That is exactly the kind of silently-plausible number this bench refuses.
  content!.group.updateMatrixWorld(true);

  const SITE_S = 116;
  const site = storySite(SEED, road, terrain);
  const spawn = site.spawn;
  const car = createStartingCar(world, road, terrain);
  const instance = createStructureInstance(site.house.structure);
  const halfX = instance.halfExtentX;
  const halfZ = instance.halfExtentZ;
  const houseLateral = road.project(site.house.x, site.house.z, SITE_S).lateral;
  const frontLat = houseLateral + halfZ;
  const roadEdge = halfWidthAt(SEED, SITE_S);

  // THE HOUSE BELONGS AT THE ROAD, inside the graded corridor and at the authored
  // setback: the terrain is fitted to the road only within 30 m of it, and past that
  // the landscape's long bands return and keep their slope.
  check(
    Math.abs(frontLat) < 30,
    `the house front stands ${Math.abs(frontLat).toFixed(1)} m from the centreline, outside ` +
      'the terrain corridor that is fitted to the road',
  );
  check(
    Math.abs(frontLat) - roadEdge >= 9 - 0.05 && Math.abs(frontLat) - roadEdge <= 12 + 0.05,
    `the house stands ${(Math.abs(frontLat) - roadEdge).toFixed(1)} m off the asphalt edge, ` +
      'outside the authored 9-12 m setback',
  );

  // SEATED, not floating. The provider fits one plane under the footprint, tilts the
  // building onto it and sinks it by the plane's own residual; re-fitting the same
  // rectangle here reproduces the numbers the site itself used, so this checks the
  // arithmetic rather than trusting it.
  {
    const plane = fitGround(terrain, site.house.x, site.house.z, site.house.yaw, halfX, halfZ, SITE_S, 5);
    check(
      plane.residual <= MAX_RESIDUAL_M,
      `the house's fitted ground plane has a residual of ${plane.residual.toFixed(2)} m, past ` +
        `the ${MAX_RESIDUAL_M} m this site is worth — the ground is too uneven for a building ` +
        'this size to sit on one tilt',
    );
    const seatY = plane.centreY - plane.residual - 0.08;
    check(
      Math.abs(site.house.seatY - seatY) < 1e-6,
      `the house is seated at y=${site.house.seatY.toFixed(3)} where the fitted plane puts it at ` +
        `${seatY.toFixed(3)}`,
    );
    console.log(
      `  story house ${structureDef(site.house.structure).id}: ${halfX.toFixed(1)}x${halfZ.toFixed(1)} m ` +
        `half extents, residual ${plane.residual.toFixed(2)} m, grade ${(plane.grade * 100).toFixed(1)}%`,
    );
  }

  // The building's own bounds as the provider built it, found by the structure marker
  // the catalogue stamps on a dwelling's group — not the whole chunk group, which now
  // also carries the airfield.
  const houseObject = ((): THREE.Object3D | null => {
    let found: THREE.Object3D | null = null;
    content!.group.traverse((object) => {
      if (object.userData.poiStructure === structureDef(site.house.structure).id) found = object;
    });
    return found;
  })();
  check(houseObject !== null, 'the story site did not place the chosen dwelling');
  const houseBox = new THREE.Box3().setFromObject(houseObject as THREE.Object3D);
  check(houseBox.containsPoint(new THREE.Vector3(site.house.x, site.house.seatY + 0.5, site.house.z)),
    'the placed dwelling is not where the site says it is');

  // Clearances are measured in the HOUSE'S OWN frame, not in a world-axis bounding
  // box: the building is yawed with a small hash wobble, so its AABB's nearest face is
  // a corner a metre nearer the road than the front wall, and a car correctly parked
  // beside the wall would read as overlapping it.
  const houseLocal = (x: number, z: number): [number, number] => {
    const cos = Math.cos(site.house.yaw);
    const sin = Math.sin(site.house.yaw);
    const dx = x - site.house.x;
    const dz = z - site.house.z;
    return [dx * cos - dz * sin, dx * sin + dz * cos];
  };

  // The spawn is a FEET position OUTSIDE the building (the old homestead spawned
  // inside its garage; this house has no interior), above the sand and not metres
  // above it.
  const [, spawnLocalZ] = houseLocal(spawn.x, spawn.z);
  check(
    spawnLocalZ < -halfZ - 0.3,
    `the player spawns ${spawnLocalZ.toFixed(2)} m along the house's depth, inside its footprint`,
  );
  const groundAtSpawn = terrain.heightAt(spawn.x, spawn.z, SITE_S);
  check(spawn.y > groundAtSpawn, `the player spawns ${(groundAtSpawn - spawn.y).toFixed(2)} m below the ground`);
  check(
    spawn.y - groundAtSpawn < 0.5,
    `the player spawns ${(spawn.y - groundAtSpawn).toFixed(2)} m above the ground`,
  );
  check(Number.isFinite(spawn.x) && Number.isFinite(spawn.z), 'the spawn position is not a number');

  // The car stands clear of the building's footprint, on the ground. It is parked
  // along the runout, so its extent across the house's own depth is its half WIDTH.
  const measure = carModelMeasure(car.modelId);
  const carBox = new THREE.Box3().setFromCenterAndSize(
    new THREE.Vector3(car.x, car.y + measure.halfExtents[1], car.z),
    new THREE.Vector3(measure.halfExtents[0] * 2, measure.halfExtents[1] * 2, measure.halfExtents[2] * 2),
  );
  const [, carLocalZ] = houseLocal(car.x, car.z);
  check(
    carLocalZ + measure.halfExtents[0] < -halfZ - 0.2,
    `the starter car's near flank is ${(carLocalZ + measure.halfExtents[0] + halfZ).toFixed(2)} m ` +
      'past the house wall, overlapping the building footprint',
  );
  check(carBox.min.y > 0, `the car spawns below ground at y=${car.y}`);

  // AND THE PLAYER FACES THE HOUSE, NOT THE PLANE. The plane is behind the shoulder
  // deliberately; a spawn pointed at it would be the one thing the feature forbids.
  const forwardX = Math.sin(spawn.yaw);
  const forwardZ = Math.cos(spawn.yaw);
  const toHouse = Math.hypot(site.house.x - spawn.x, site.house.z - spawn.z);
  const toPlane = Math.hypot(site.plane.x - spawn.x, site.plane.z - spawn.z);
  check(
    (forwardX * (site.house.x - spawn.x) + forwardZ * (site.house.z - spawn.z)) / toHouse > 0.9,
    'the player does not start facing the house',
  );
  check(
    (forwardX * (site.plane.x - spawn.x) + forwardZ * (site.plane.z - spawn.z)) / toPlane < 0,
    'the player starts pointed at the plane',
  );

  // The runway: inside the straight runout and past the terminus pad, clear of the
  // asphalt by a verge, and on the opposite side of the road from the house.
  const runway = site.runway;
  const runwayStart = road.project(runway.x0, runway.z0, SITE_S);
  const runwayEnd = road.project(
    runway.x0 + runway.dx * runway.length,
    runway.z0 + runway.dz * runway.length,
    SITE_S,
  );
  check(runwayStart.s >= 25, `the runway starts at s=${runwayStart.s.toFixed(0)}, inside the terminus pad`);
  check(runwayEnd.s <= 260, `the runway ends at s=${runwayEnd.s.toFixed(0)}, past the straight runout`);
  check(
    Math.abs(runwayStart.lateral) - runway.width / 2 >= roadEdge + 5,
    `the runway's near edge is ${(Math.abs(runwayStart.lateral) - runway.width / 2 - roadEdge).toFixed(1)} m ` +
      'off the asphalt edge, inside the verge',
  );
  check(
    runwayStart.lateral > 0 && frontLat < 0,
    'the runway and the house are on the same side of the road',
  );
  check(
    runwayStart.lateral - runway.width / 2 - frontLat > 20,
    `the runway's near edge and the house front are only ` +
      `${(runwayStart.lateral - runway.width / 2 - frontLat).toFixed(1)} m apart`,
  );

  // The plane sits ON the runway: within the strip, at its start end, nose along it,
  // wheels on the drawn surface.
  const toPlaneX = site.plane.x - runway.x0;
  const toPlaneZ = site.plane.z - runway.z0;
  const planeAlong = toPlaneX * runway.dx + toPlaneZ * runway.dz;
  const planeAcross = toPlaneX * -runway.dz + toPlaneZ * runway.dx;
  check(planeAlong >= 0 && planeAlong <= runway.length, 'the plane is off the runway lengthwise');
  check(Math.abs(planeAcross) <= runway.width / 2, 'the plane is off the runway sideways');
  check(
    planeAlong < 20,
    `the plane parks ${planeAlong.toFixed(1)} m along the runway, not at the start end`,
  );
  // THE STRIP NEVER DIPS UNDER THE SAND: the sand's own chop would show through the
  // tarmac and the rolling plane would sink into it.
  {
    let worst = Infinity;
    for (let along = 0; along <= runway.length; along += 2) {
      for (let across = -runway.width / 2; across <= runway.width / 2 + 1e-6; across += 1) {
        const x = runway.x0 + runway.dx * along - runway.dz * across;
        const z = runway.z0 + runway.dz * along + runway.dx * across;
        worst = Math.min(worst, runwaySurfaceY(runway, x, z) - terrain.heightAt(x, z, runway.hintS));
      }
    }
    check(worst >= -0.02, `the runway surface dips ${(-worst).toFixed(2)} m under the sand`);
  }
  check(
    Math.hypot(Math.sin(site.plane.yaw) - runway.dx, Math.cos(site.plane.yaw) - runway.dz) < 1e-6,
    'the plane is not pointed along the runway',
  );

  // The starting items: 4-6 of them, on the yard and on the ground, out of the walls.
  const spawned: { type: string; x: number; y: number; z: number }[] = [];
  spawnStartingItems(
    world,
    {
      spawnItem: (item: { type: string }, x: number, y: number, z: number) => {
        spawned.push({ type: item.type, x, y, z });
      },
      spawnPart: () => {},
      forget: () => {},
    } as never,
    road,
    terrain,
  );
  check(
    spawned.length >= 4 && spawned.length <= 6,
    `the world scatters ${spawned.length} starting items, outside the authored 4-6`,
  );
  for (const item of spawned) {
    const [itemLocalX, itemLocalZ] = houseLocal(item.x, item.z);
    check(
      Math.abs(itemLocalZ) > halfZ + 0.35 || Math.abs(itemLocalX) > halfX + 0.35,
      `the starting ${item.type} stands inside the house footprint`,
    );
    const ground = terrain.heightAt(item.x, item.z, SITE_S);
    check(
      item.y > ground - 0.05 && item.y - ground < 1.5,
      `the starting ${item.type} is ${(item.y - ground).toFixed(2)} m off the ground`,
    );
  }
  console.log(`  the ${spawned.length} starting finds stand on the yard, clear of the house`);

  // The keep-clear the scatter and ground cover consult.
  check(storyKeepsClear(SITE_S, -20), 'the house yard is not kept clear of scatter');
  check(storyKeepsClear(SITE_S, 26), 'the airfield is not kept clear of scatter');
  check(!storyKeepsClear(SITE_S, 300), 'the keep-clear reaches 300 m out to one side');
  check(!storyKeepsClear(900, 26), 'the keep-clear reaches the far end of the road');

  // The plane can be hidden for the cutscene, and disposal leaves nothing behind.
  provider.setParkedPlaneVisible(false);
  provider.setParkedPlaneVisible(true);
  content!.dispose?.();

  console.log(
    `  story site: house ${Math.abs(frontLat).toFixed(1)} m from the centreline ` +
      `(edge ${roadEdge.toFixed(1)} m + ${(Math.abs(frontLat) - roadEdge).toFixed(1)} m), ` +
      `runway ${runway.width.toFixed(1)}x${runway.length.toFixed(0)} m at ${runwayStart.lateral.toFixed(0)} m ` +
      `lat, plane ${planeAlong.toFixed(1)} m in`,
  );
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
    { spawnItem: () => {}, spawnPart: () => {}, forget: () => {} } as never,
    { spawn: () => {}, forget: () => {} } as never,
    { register: () => {}, forget: () => {} } as never,
    { register: () => {}, forget: () => {} } as never,
    roadDistance,
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

if (failures.length > 0) {
  for (const failure of failures) console.log(`  FAIL  ${failure}`);
  throw new Error(`${failures.length} placement checks failed`);
}
console.log('\nevery building clears the road, the catalogue is reachable, and the home holds together');
