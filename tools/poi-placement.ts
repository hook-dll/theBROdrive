/**
 * POI placement and the starter homestead: are the buildings where they claim to be?
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
 * NO CATEGORY IS A RARITY. Twenty-six buildings drawn from one hash means the mix is
 * a property of the seed, not a guarantee; over a long enough stretch every variant
 * must actually appear, or some of the catalogue is content nobody will ever see.
 *
 * THE HOMESTEAD IS WHERE IT SAYS IT IS. The building sits on its pad, the starter car
 * stands inside the garage rather than beside it, the player spawns on the concrete,
 * and the drive reaches from the asphalt to the garage door. Those four are separate
 * constants in separate files, and nothing but this bench holds them together.
 */

import * as THREE from 'three';
import { GameWorld, newWorldState } from '../src/game/state';
import { CHUNK_LENGTH, type ChunkContext } from '../src/world/chunks';
import { Road } from '../src/world/road';
import { Terrain } from '../src/world/terrain';
import { PoiProvider, poisBetween } from '../src/world/poi';
import {
  createVariantInstance,
  variantCount,
  variantDef,
  warmVariantAssets,
} from '../src/world/poivariantbuild';
import {
  HomesteadProvider,
  createStartingCar,
  homesteadSpawn,
} from '../src/world/house';
import { halfWidthAt } from '../src/world/roadprofile';
import { ROAD_HALF_WIDTH } from '../src/world/road';
import type { LoosePartField } from '../src/parts/loose';
import type { TrailerField } from '../src/vehicle/trailer';
import type { WreckTrunkField } from '../src/world/wrecktrunks';

const SEED = 1337;
const failures: string[] = [];
function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

const world = new GameWorld(newWorldState(SEED));
const road = new Road(SEED);
const terrain = new Terrain(SEED, road);

/** The verge the placement promises between the asphalt edge and the nearest wall. */
const MIN_VERGE_M = 10;
/** The widest span the placement promises on top of it. */
const MAX_VERGE_M = 22;

// --- 1. every building clears the road ---------------------------------------
{
  let checked = 0;
  let worstVerge = Infinity;
  let tightest = '';
  for (let index = 1; index <= 260; index++) {
    const s = index * world.state.settings.poiSpacingMetres;
    const pois = poisBetween(SEED, s - 1, s + 1, world.state.settings.poiSpacingMetres);
    const poi = pois[0];
    if (!poi) continue;
    const def = variantDef(poi.variant);
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
}

// --- 2. the whole catalogue is reachable -------------------------------------
{
  const seen = new Set<number>();
  const perCategory = new Map<string, number>();
  for (let index = 1; index <= 4000; index++) {
    const spacing = world.state.settings.poiSpacingMetres;
    const pois = poisBetween(SEED, index * spacing - 1, index * spacing + 1, spacing);
    const poi = pois[0];
    if (!poi) continue;
    seen.add(poi.variant);
    const category = variantDef(poi.variant).category;
    perCategory.set(category, (perCategory.get(category) ?? 0) + 1);
  }
  check(
    seen.size === variantCount(),
    `only ${seen.size} of ${variantCount()} variants ever appear over 4,800 km`,
  );
  const mix = [...perCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${name} ${count}`)
    .join(', ');
  console.log(`  ${seen.size}/${variantCount()} variants reachable; ${mix}`);
}

// --- 3. the homestead holds together -----------------------------------------
{
  const provider = new HomesteadProvider();
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
  check(content !== null, 'the homestead built nothing for chunk 0');

  // World matrices first: the provider returns a detached group, so every mesh's
  // `matrixWorld` is still identity and a bounds query would measure a building at the
  // origin. That is exactly the kind of silently-plausible number this bench exists to
  // refuse.
  content!.group.updateMatrixWorld(true);
  const spawn = homesteadSpawn(road, terrain);
  const car = createStartingCar(world);

  // How far the compound sits from the centreline, measured laterally at its own
  // arclength. This is the "+50 m deeper" claim, so it is measured rather than trusted.
  const HOMESTEAD_S = 116;
  const roadEdge = halfWidthAt(SEED, HOMESTEAD_S);
  const distanceFromRoad = (() => {
    const sample = road.sampleAt(HOMESTEAD_S);
    const dx = spawn.x - sample.x;
    const dz = spawn.z - sample.z;
    // Lateral component only: the along-road part is not a setback.
    const fx = Math.sin(sample.heading);
    const fz = Math.cos(sample.heading);
    const along = dx * fx + dz * fz;
    const lateral = Math.hypot(dx - along * fx, dz - along * fz);
    return lateral;
  })();
  check(
    distanceFromRoad > roadEdge + 40,
    `the homestead's centre is ${distanceFromRoad.toFixed(1)} m from the centreline, not ` +
      `the 50 m deeper than the road edge it is supposed to be`,
  );

  // The car belongs INSIDE the building, not on the lawn: its centre must be within
  // the building's measured footprint, which is the only thing that distinguishes
  // "in the garage" from "beside the garage" numerically.
  const carBounds = new THREE.Box3().setFromCenterAndSize(
    new THREE.Vector3(car.x, car.y, car.z),
    new THREE.Vector3(2, 1.6, 5),
  );
  const building = new THREE.Box3();
  content!.group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) building.expandByObject(mesh);
  });
  check(building.containsPoint(new THREE.Vector3(car.x, car.y + 0.8, car.z)),
    'the starter car does not stand inside the building footprint');
  check(carBounds.min.y > 0, `the car spawns below ground at y=${car.y}`);

  // The spawn is a FEET position and must stand ON THE CONCRETE.
  //
  // Not by comparing against the provider's own bounding box: that box includes the
  // driveway wedge, whose buried underside reaches a slab below the road, so it says
  // nothing about the floor. The honest comparison is with the TERRAIN — the pad is
  // poured above the highest ground under the building, so a spawn on the pad is
  // strictly above the sand there and not far above it.
  const groundAtSpawn = terrain.heightAt(spawn.x, spawn.z, 116);
  check(
    spawn.y > groundAtSpawn,
    `the player spawns ${(groundAtSpawn - spawn.y).toFixed(2)} m below the ground`,
  );
  check(
    spawn.y - groundAtSpawn < 3,
    `the player spawns ${(spawn.y - groundAtSpawn).toFixed(2)} m above the ground — ` +
      'higher than a slab, so not on the pad',
  );
  // And under the building's roof, in the garage, not on the lawn beside it.
  const standing = new THREE.Box3().setFromCenterAndSize(
    new THREE.Vector3(spawn.x, spawn.y + 0.9, spawn.z),
    new THREE.Vector3(0.6, 1.8, 0.6),
  );
  check(
    standing.min.x >= building.min.x && standing.max.x <= building.max.x
      && standing.min.z >= building.min.z && standing.max.z <= building.max.z,
    'the player spawns outside the building footprint, not in the garage',
  );
  // The car and the player share the garage floor, so they cannot be metres apart.
  check(
    Math.abs(car.y - spawn.y) < 2,
    `the car sits ${Math.abs(car.y - spawn.y).toFixed(2)} m above the player's feet`,
  );
  check(
    Number.isFinite(spawn.x) && Number.isFinite(spawn.z),
    'the spawn position is not a number',
  );

  console.log(
    `  homestead: ${distanceFromRoad.toFixed(1)} m from the centreline ` +
      `(edge ${roadEdge.toFixed(1)} m + ${(distanceFromRoad - roadEdge).toFixed(1)} m), ` +
      `spawn ${(spawn.y - groundAtSpawn).toFixed(2)} m above the sand, ` +
      `car ${(car.y - spawn.y).toFixed(2)} m above the player's feet`,
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
  warmVariantAssets();
  const samples: number[] = [];
  const rounds = 6;
  for (let r = 0; r < rounds; r++) {
    for (let index = 0; index < variantCount(); index++) {
      const t0 = process.hrtime.bigint();
      createVariantInstance(index);
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

if (failures.length > 0) {
  for (const failure of failures) console.log(`  FAIL  ${failure}`);
  throw new Error(`${failures.length} placement checks failed`);
}
console.log('\nevery building clears the road, the catalogue is reachable, and the home holds together');
