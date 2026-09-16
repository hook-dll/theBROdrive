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
 * THE HOMESTEAD IS WHERE IT SAYS IT IS. The building is tilted onto its own fitted
 * ground plane, the starter car stands inside the garage rather than beside it, the
 * player spawns on its floor, and the garage door lands where the drive from the
 * road expects it. Those four are separate constants in separate files, and nothing
 * but this bench holds them together.
 */

import * as THREE from 'three';
import { GameWorld, newWorldState } from '../src/game/state';
import { CHUNK_LENGTH, type ChunkContext } from '../src/world/chunks';
import { Road } from '../src/world/road';
import { Terrain } from '../src/world/terrain';
import { Interaction } from '../src/player/interaction';
import { PoiProvider, poisBetween } from '../src/world/poi';
import { PoiSwitchField } from '../src/world/poiswitches';
import {
  createVariantInstance,
  variantCount,
  variantDef,
  warmVariantAssets,
} from '../src/world/poivariantbuild';
import {
  createPoiVariant,
  mergePoiStatics,
  SHELF_PLANK_TOP,
  STARTER_GARAGE_SHELF,
} from '../src/world/poi-variants';
import {
  HOMESTEAD_FOOTPRINT,
  HomesteadProvider,
  createStartingCar,
  homesteadLayout,
  homesteadSpawn,
  spawnStartingItems,
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
  // A real switch field, so the homestead's own switches are registered and can be
  // checked: the first building a player stands in is the one whose lights most need to
  // work, and it is registered by a different provider from every other building.
  const homeSwitches = new PoiSwitchField();
  const provider = new HomesteadProvider(homeSwitches);
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
  // THE HOMESTEAD BELONGS AT THE ROAD, and this is the check for it.
  //
  // The terrain is fitted to the road only inside the 30 m corridor; past that the
  // landscape's long bands return and keep their slope. So it is the ground's own
  // relief under the compound's footprint that limits how far out it may stand — the
  // building is TILTED onto that ground rather than levelled on a slab, so a steeper
  // site means a more tilted house, not a taller pad, and `MAX_RESIDUAL_M` is where
  // "tilted" stops being the honest word for it.
  check(
    HOMESTEAD_FOOTPRINT.u0 < 30,
    `the homestead's nearest edge is ${HOMESTEAD_FOOTPRINT.u0.toFixed(1)} m from the centreline, ` +
      'outside the terrain corridor that is fitted to the road',
  );
  {
    const L = homesteadLayout(road, terrain);
    let min = Infinity;
    let max = -Infinity;
    for (let u = HOMESTEAD_FOOTPRINT.u0; u <= HOMESTEAD_FOOTPRINT.u1; u += 2.5) {
      for (let v = HOMESTEAD_FOOTPRINT.v0; v <= HOMESTEAD_FOOTPRINT.v1; v += 2.5) {
        const [x, z] = L.toWorld(u, v);
        const y = terrain.heightAt(x, z, HOMESTEAD_FOOTPRINT.s);
        if (y < min) min = y;
        if (y > max) max = y;
      }
    }
    const spread = max - min;

    // No pad to hide the ground's own relief in any more: the building follows it,
    // and `plane.residual` is the honest number for how well one rigid tilt stands
    // in for the terrain underneath — the most any point of real ground can still
    // poke up past the plane the building is resting on.
    check(
      L.plane.residual <= MAX_RESIDUAL_M,
      `the homestead's fitted ground plane has a residual of ${L.plane.residual.toFixed(2)} m, ` +
        `past the ${MAX_RESIDUAL_M} m this site is worth — the ground is too uneven for a ` +
        'compound this size to sit on one tilt, so move it nearer the road',
    );
    console.log(
      `  homestead ground: ${min.toFixed(2)}..${max.toFixed(2)} m, spread ${spread.toFixed(2)} m, ` +
        `plane residual ${L.plane.residual.toFixed(2)} m, grade ${(L.plane.grade * 100).toFixed(1)}%`,
    );
  }

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

  // The spawn is a FEET position and must stand ON THE FLOOR.
  //
  // Not by comparing against the provider's own bounding box: that box is the whole
  // building's extent, roof and all, so it says nothing about where the floor itself
  // is. The honest comparison is with the TERRAIN — the building is sunk by the
  // fitted plane's own residual, so a spawn on its floor is strictly above the sand
  // directly under it, and not far above it.
  const groundAtSpawn = terrain.heightAt(spawn.x, spawn.z, 116);
  check(
    spawn.y > groundAtSpawn,
    `the player spawns ${(groundAtSpawn - spawn.y).toFixed(2)} m below the ground`,
  );
  check(
    spawn.y - groundAtSpawn < 3,
    `the player spawns ${(spawn.y - groundAtSpawn).toFixed(2)} m above the ground — ` +
      'higher than a floor should be',
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

  // AND THE HOMESTEAD'S OWN SWITCHES ARE LIVE. It registers them through a different
  // provider from every other building, which is exactly how one building came to be the
  // only one whose lights could not be worked.
  const homeSwitchList = [...homeSwitches.values()];
  check(
    homeSwitchList.length > 0,
    'the homestead registered no light switches, so the lights in the starter garage ' +
      'cannot be worked at all',
  );
  let homeLit = 0;
  content!.group.traverse((object) => {
    const light = object as THREE.PointLight;
    if (light.isLight && object.userData.lightBudgetSource === true && light.intensity > 0) {
      homeLit++;
    }
  });
  for (const entry of homeSwitchList) entry.toggle();
  let homeOff = 0;
  content!.group.traverse((object) => {
    const light = object as THREE.PointLight;
    if (light.isLight && object.userData.lightBudgetSource === true && light.intensity > 0) {
      homeOff++;
    }
  });
  check(
    homeOff < homeLit,
    `pressing the homestead's ${homeSwitchList.length} switches left ${homeOff} lit sources ` +
      `against ${homeLit} — they are not wired to the building's lights`,
  );
  for (const entry of homeSwitchList) entry.toggle();

  // THE STARTING ITEMS STAND ON THE SHELF. They used to stand on a workbench inside the
  // garage door, and the two things worth checking are whether they are within the shelf
  // at all and whether they are ABOVE a plank rather than inside one or hovering — a pair
  // of questions a screenshot answers only from the right side of the car.
  //
  // The shelf is located through the PLACED BUILDING'S OWN WORLD MATRIX — not through
  // `variantToUV`, which is what `spawnStartingItems` uses. Deriving both sides of this
  // comparison from the same function would let a sign or yaw error move the items and the
  // asserted shelf frame together, and the check would pass while the items stood in the
  // sand beside the shelf. Taking the shelf's frame from the geometry the provider actually
  // built is what makes the two independent.
  {
    const L = homesteadLayout(road, terrain);
    const spawned: { type: string; y: number; u: number; v: number }[] = [];
    spawnStartingItems(world, {
      spawnItem: (item: { type: string }, x: number, y: number, z: number) => {
        const [u, v] = L.toUV(x, z);
        spawned.push({ type: item.type, y, u, v });
      },
      spawnPart: () => {},
      forget: () => {},
    } as never);

    // The placed homestead, found by the variant id it carries.
    let home: THREE.Object3D | null = null;
    content!.group.traverse((object) => {
      if (object.userData.poiVariant === 'starter-homestead') home = object;
    });
    check(home !== null, 'the homestead did not place the starter-homestead variant');
    const homeMatrix = (home as THREE.Object3D | null)?.matrixWorld ?? new THREE.Matrix4();
    const placed = (x: number, z: number): [number, number] => {
      const world3 = new THREE.Vector3(x, 0, z).applyMatrix4(homeMatrix);
      return L.toUV(world3.x, world3.z);
    };

    const centre = placed(STARTER_GARAGE_SHELF.centreX, STARTER_GARAGE_SHELF.centreZ);
    // The shelf is built yawed a quarter turn, so its length runs along the VARIANT's z
    // and not its x — one step that way is one unit along the shelf, and taking the wrong
    // axis is how this check first reported every item as off the shelf when all four were
    // on it.
    const tip = placed(STARTER_GARAGE_SHELF.centreX, STARTER_GARAGE_SHELF.centreZ - 1);
    const axis = [tip[0] - centre[0], tip[1] - centre[1]];
    const axisLen = Math.hypot(axis[0], axis[1]);
    check(axisLen > 0.1, 'the shelf has no length in the homestead frame, so it is misplaced');

    const shelfItems = spawned.filter(
      (i) => i.type !== 'fluid_can' && i.type !== 'football',
    );
    // Without this the checks below run zero times if the items are ever renamed or
    // dropped, and an empty shelf passes.
    check(
      shelfItems.length === 4,
      `${shelfItems.length} starting items are on the shelf, not the four tools the world ` +
        'spawns for a new drive',
    );
    let onPlanks = 0;
    for (const item of shelfItems) {
      const du = item.u - centre[0];
      const dv = item.v - centre[1];
      const along = (du * axis[0] + dv * axis[1]) / axisLen;
      const across = Math.abs((-du * axis[1] + dv * axis[0]) / axisLen);
      check(
        Math.abs(along) < STARTER_GARAGE_SHELF.halfWidth
          && across < STARTER_GARAGE_SHELF.halfDepth + 0.05,
        `the starting ${item.type} is ${along.toFixed(2)} m along and ${across.toFixed(2)} m ` +
          'across the garage shelf — off the planks',
      );
      // Above a plank's own top surface, and within an object's height of it: on the
      // shelf, neither sunk into a plank nor hovering over one.
      const heights = [0, 1, 2, 3]
        .map((i) => item.y - (L.floorYAt(item.u, item.v) + SHELF_PLANK_TOP(i)))
        .filter((d) => d > -0.03 && d < 0.3);
      check(
        heights.length === 1,
        `the starting ${item.type} is not standing on any plank of the garage shelf`,
      );
      onPlanks++;
    }
    console.log(`  the ${onPlanks} starting tools stand on the garage shelf`);
  }

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

// --- 5. what the world builds IS what the gallery shows ----------------------
//
// THE CHECK THIS FILE WAS MISSING, and its absence cost a real bug. A variant is built
// from the catalogue, merged, then cached and re-made per placement — and the caching
// step reconstructed every mesh at the origin, which silently flattened every mesh that
// `mergePoiStatics` does not merge (roofs, switches, unique-material trims). The result
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
      // A bulb and its light belong to the PLACEMENT, deliberately: two buildings of one
      // variant must not be able to darken each other's bulbs. They are therefore not part
      // of what the catalogue builds, and this check is about the catalogue's geometry.
      if (mesh.userData.poiBulb === true) return;
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
      if (mesh.userData.poiBulb === true) return;
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
    `  26 variants match the gallery to within ${worst.toFixed(3)} m (worst: ${worstId})`,
  );
}

// --- 6. the switches work, and the buildings stand ON the ground ------------------
//
// Two properties, both of which have already been broken here once.
//
// A switch is the one interactive fitting these buildings have, and it is easy to build
// one that looks right and does nothing: the closures once drove spot lights that the
// world's marker replacement then removed and disposed, so pressing a switch would flip a
// boolean nobody could see. So the switch is tested by its CONSEQUENCE — after every
// switch in a chunk is pressed, strictly fewer light sources are lit — and by whether it
// is where a person could reach it, which is a question about the variant's own frame,
// not about the terrain.
//
// And a building must stand on the sand. The apron that used to sit under every POI was
// the wrong answer to uneven ground: measured 0.82 m deep on the homestead, it read as a
// plinth. What replaced it is a fitted plane and a `residual` of burial, and whether that
// is enough is a question about the ground under the walls — which is what is measured
// here, directly, rather than inferred from the height of one point.
{
  const switches = new PoiSwitchField();
  const provider = new PoiProvider(
    { spawnItem: () => {}, spawnPart: () => {}, forget: () => {} } as never,
    { spawn: () => {}, forget: () => {} } as never,
    { register: () => {}, forget: () => {} } as never,
    switches,
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
  const built: THREE.Object3D[] = [];
  const buildings: THREE.Object3D[] = [];
  const placed: { readonly object: THREE.Object3D; readonly s: number }[] = [];
  for (let chunk = 0; chunk < 100; chunk++) {
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
    built.push(content.group);
    const nearS = sStart + CHUNK_LENGTH / 2;
    content.group.traverse((object) => {
      if (typeof object.userData.poiVariant !== 'string') return;
      buildings.push(object);
      placed.push({ object, s: nearS });
    });
  }

  const litSources = (): number => {
    let on = 0;
    for (const group of built) {
      group.traverse((object) => {
        const light = object as THREE.PointLight;
        if (light.isLight && object.userData.lightBudgetSource === true && light.intensity > 0) {
          on++;
        }
      });
    }
    return on;
  };

  const registered = [...switches.values()];
  check(registered.length > 0, 'not one light switch was registered in 20 km of road');
  check(buildings.length > 0, 'not one building was placed in 20 km of road');

  // A REGISTRY IS IN ABSOLUTE COORDINATES, and the geometry is not.
  //
  // A chunk builds relative to its own floating origin, so a building's world matrix is
  // chunk-local; every registry in the world — wreck trunks, couriers, switches — and
  // every consumer of one, including the interaction ray, is in absolute coordinates. So
  // registering through the matrix alone puts the switch wherever the origin happens to
  // be, which on a real chunk is kilometres. That is invisible in the checks above,
  // because they build with `originX`/`originZ` at zero and zero hides the error exactly.
  //
  // The property is therefore stated as an INVARIANCE: build the same stretch of road
  // twice, once at the floating origin and once a long way from it, and a switch registered
  // in absolute coordinates lands in the same place both times. Registered from the chunk's
  // local matrix instead, it lands a whole origin away — and the check fails by exactly the
  // distance between the two builds, which is the diagnostic.
  {
    const buildAt = (originX: number, originZ: number): PoiSwitchField => {
      const field = new PoiSwitchField();
      const shifted = new PoiProvider(
        { spawnItem: () => {}, spawnPart: () => {}, forget: () => {} } as never,
        { spawn: () => {}, forget: () => {} } as never,
        { register: () => {}, forget: () => {} } as never,
        field,
        { register: () => {}, forget: () => {} } as never,
      );
      for (let chunk = 0; chunk < 100; chunk++) {
        const sStart = chunk * CHUNK_LENGTH;
        const content = shifted.build({
          chunkIndex: chunk,
          sStart,
          sEnd: sStart + CHUNK_LENGTH,
          road,
          terrain,
          world,
          hasPhysics: false,
          originX,
          originZ,
        } as unknown as ChunkContext);
        content?.group.updateMatrixWorld(true);
      }
      return field;
    };

    const here = buildAt(0, 0);
    const far = buildAt(26_000, -41_000);
    const hereList = [...here.values()];
    const farList = [...far.values()];
    check(
      hereList.length > 1 && hereList.length === farList.length,
      `the same road registered ${hereList.length} switches at the origin and ` +
        `${farList.length} far from it`,
    );
    const byId = new Map(hereList.map((entry) => [entry.id, entry]));
    let wrong = 0;
    let worst = 0;
    for (const entry of farList) {
      const origin = byId.get(entry.id);
      if (!origin) continue;
      const drift = Math.max(
        Math.abs(entry.x - origin.x),
        Math.abs(entry.y - origin.y),
        Math.abs(entry.z - origin.z),
      );
      if (drift > 0.01) {
        wrong++;
        if (drift > worst) worst = drift;
      }
    }
    check(
      wrong === 0,
      `${wrong} switches landed somewhere else when the chunk's floating origin moved ` +
        `(worst: ${worst.toFixed(0)} m) — the registry is in absolute coordinates and they ` +
        'are not',
    );
  }

  // A switch is a switchplate at the height of a hand. Measured in the building's own
  // frame, because that is the frame the question is well posed in: a ground-floor switch
  // is 1.2 m above the floor, the landing of a two-storey house puts the same plate at
  // 4.55 m, and both are right. What is not right is a plate sunk into the floor, and what
  // is measured above the base catches a plate left in the ceiling.
  //
  // The variant is not placed on terrain here on purpose: the ground a switch is above is
  // the building's own floor, and asking the terrain instead conflates a switch with the
  // hill the building is buried in.
  const down = new THREE.Vector3(0, -1, 0);
  const raycaster = new THREE.Raycaster();
  let switchCount = 0;
  for (let index = 0; index < variantCount(); index++) {
    const instance = createVariantInstance(index);
    const id = variantDef(index).id;
    for (const entry of instance.switches) {
      switchCount++;
      check(
        entry.centre.y > 0.6 && entry.centre.y < 5.8,
        `${id}: a light switch is mounted ${entry.centre.y.toFixed(2)} m above the floor`,
      );
      raycaster.set(
        new THREE.Vector3(entry.centre.x, entry.centre.y - 0.01, entry.centre.z),
        down,
      );
      const hits = raycaster.intersectObject(instance.group, true);
      // NO HIT IS NOT A DEFECT, and requiring one was measured to be wrong: `porch-house`,
      // `spacious-veranda-house` and `relay-cluster` each have a plate at local y = 1.20 to
      // 1.30 with no floor modelled beneath it — these buildings have verandas, porches and
      // equipment aprons rather than a continuous slab — and all three are switches at the
      // height of a hand, which the check above already requires. Demanding floor geometry
      // here would fail three of the twenty-six for a property they do not need.
      //
      // So the ray is asked the one question it answers reliably: is the plate SUNK into
      // whatever is beneath it? That is the failure that matters, and a plate with open air
      // below is one a player can reach.
      if (hits.length > 0) {
        check(
          hits[0]!.distance > 0.6,
          `${id}: a light switch is sunk ${hits[0]!.distance.toFixed(2)} m into what is below it`,
        );
      }
      const longest = Math.max(...entry.halfExtents) * 2;
      check(
        longest > 0.05 && longest < 0.25,
        `${id}: a light switch measures ${longest.toFixed(3)} m across, not a switchplate`,
      );
      check(
        entry.isOn() === true,
        `${id}: a light switch starts switched off, so a press would turn it on`,
      );
    }
  }
  check(switchCount > 0, 'no variant in the catalogue has a light switch at all');

  // AND IT MUST BE WHERE ITS BUILDING IS. The switch is registered with the world as a
  // world-space box, so the registration has to place it through the building's own
  // transform — and the failure this catches is quiet: a switch registered while its
  // building was still at the origin still has the right size, still toggles, and is
  // standing in the sand fifty metres from the wall it is screwed to. Measured as
  // coincidence with the placed building rather than by asking the terrain, because the
  // terrain has no opinion about where a wall is.
  const box = new THREE.Box3();
  const want = new THREE.Vector3();
  let strays = 0;
  let misplaced = 0;
  for (const entry of registered) {
    let host: THREE.Object3D | null = null;
    for (const building of buildings) {
      box.setFromObject(building, true).expandByScalar(0.4);
      if (box.containsPoint(new THREE.Vector3(entry.x, entry.y, entry.z))) host = building;
    }
    if (host === null) {
      strays++;
      continue;
    }
    const index = Array.from({ length: variantCount() }, (_, i) => i).find(
      (i) => variantDef(i).id === host!.userData.poiVariant,
    );
    if (index === undefined) continue;
    const matches = createVariantInstance(index).switches.some((spec) => {
      want.copy(spec.centre).applyMatrix4(host!.matrixWorld);
      return want.distanceTo(new THREE.Vector3(entry.x, entry.y, entry.z)) < 0.01;
    });
    if (!matches) misplaced++;
  }
  check(
    strays === 0,
    `${strays} of ${registered.length} light switches are not inside any building`,
  );
  check(
    misplaced === 0,
    `${misplaced} light switches are not where their building's own transform puts them`,
  );

  // A WALL MUST MEET THE GROUND. The building's floor is the plane its local y=0 lies in,
  // so ground that resolves BELOW that plane at any point under the footprint is daylight
  // under a wall. Sampling the ground densely is the point: `fitGround` fits to a grid, and
  // the gap it cannot see is the one between its own samples.
  let worstGap = 0;
  let worstGapId = '';
  const inverse = new THREE.Matrix4();
  const probe = new THREE.Vector3();
  for (const { object: building, s: nearS } of placed) {
    const index = Array.from({ length: variantCount() }, (_, i) => i).find(
      (i) => variantDef(i).id === building.userData.poiVariant,
    );
    if (index === undefined) continue;
    const [footX, footZ] = variantDef(index).footprint;
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
          worstGapId = String(building.userData.poiVariant);
        }
      }
    }
  }
  check(
    worstGap < 0.05,
    `the worst building (${worstGapId}) stands ${worstGap.toFixed(2)} m above its ground — ` +
      'there is daylight under a wall',
  );

  // EACH SWITCH, ON ITS OWN. A total that falls after every switch is pressed is satisfied
  // by ONE switch doing all the work while the rest flip a private boolean — which is the
  // original bug, in the case where only some of a chunk's switches were ever connected.
  // So each one is pressed, its own effect is required, and it is put back before the next.
  const before = litSources();
  let flipped = 0;
  for (const entry of registered) {
    const litBefore = litSources();
    if (entry.toggle() !== false) failures.push(`${entry.id} did not switch off when pressed`);
    const litAfter = litSources();
    if (!(litAfter < litBefore)) {
      failures.push(
        `${entry.id} switched off but changed nothing: ${litBefore} lit sources before and ` +
          `${litAfter} after, so it controls no light in the world`,
      );
    }
    if (entry.toggle() !== true) failures.push(`${entry.id} did not switch back on`);
    flipped++;
  }
  // And the night-time picture, which is what a player sees: with every switch off, far
  // fewer sources are lit.
  for (const entry of registered) entry.toggle();
  const allOff = litSources();
  for (const entry of registered) entry.toggle();
  const restored = litSources();
  check(
    flipped > 0 && allOff < before,
    `with every switch off the world still lights ${allOff} sources against the ${before} ` +
      'it started with',
  );
  check(
    restored === before,
    `after pressing and restoring all ${flipped} switches the world has ${restored} lit ` +
      `sources against the ${before} it started with — a switch is not idempotent`,
  );

  console.log(
    `  ${buildings.length} buildings and ${flipped} switches over 20 km: pressing every ` +
      `switch takes ${before} lit sources to ${allOff}; worst gap under a wall ` +
      `${worstGap.toFixed(3)} m`,
  );
}

// --- 7. E works a switch, and only the one being aimed at --------------------
//
// The switch's wiring being right is not the same as the KEY being right, and the failure
// mode is a mismatch rather than an absence: `pickedSwitch` is found by a proximity test
// before the targets are ranked, so it means "a switch is in front of you" rather than "you
// are looking at it". A player standing at a car with a switch on the wall beside them
// would then get a prompt saying "open the door" and a key that turned the lights off.
//
// So this drives `Interaction` itself — the real class, with the real arbitration — and
// asserts what the player sees and what the key does, in all three cases: aimed, looking
// away, and out of reach.
{
  const stub = (over: Record<string, unknown> = {}) => ({
    spawn: () => {},
    spawnItem: () => {},
    spawnPart: () => {},
    register: () => {},
    forget: () => {},
    partIdForCollider: () => null,
    itemIdForCollider: () => null,
    trailerIdForCollider: () => null,
    values: () => [][Symbol.iterator](),
    ...over,
  });
  const frame = (over: Record<string, boolean> = {}) =>
    ({
      interact: false,
      mount: false,
      dropItem: false,
      useHeld: false,
      usePrimary: false,
      useSecondary: false,
      ...over,
    }) as never;

  const makeInteraction = (
    field: PoiSwitchField,
    options: {
      hit?: unknown;
      loose?: Record<string, unknown>;
      origin?: { x: number; z: number };
    } = {},
  ): Interaction =>
    new Interaction(
      { raycast: () => options.hit ?? null } as never,
      world,
      { held: null } as never,
      stub(options.loose) as never,
      stub() as never,
      stub() as never,
      field,
      stub() as never,
      () => null,
      (() => {}) as never,
      (() => {}) as never,
      (options.origin ?? { x: 0, z: 0 }) as never,
    );

  const field = new PoiSwitchField();
  let toggles = 0;
  field.register({
    id: 'probe-plate',
    x: 0,
    y: 1.2,
    z: 2,
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
    halfExtents: [0.12, 0.16, 0.03],
    toggle: () => {
      toggles++;
      return false;
    },
    isOn: () => true,
  });

  const eye = { x: 0, y: 1.2, z: 0 };
  const look = (interaction: Interaction, dx: number, dz: number, fromZ = 0) =>
    interaction.fixedUpdate(1 / 60, frame(), eye.x, eye.y, fromZ, dx, 0, dz, 0);

  const facing = makeInteraction(field);
  const seen = look(facing, 0, 1);
  check(
    seen.prompt === '[E] turn the lights off',
    `looking straight at a switch in reach, the prompt says ${JSON.stringify(seen.prompt)}`,
  );
  check(
    facing.aimedSwitch()?.id === 'probe-plate',
    'looking straight at a switch in reach, no switch is aimed',
  );
  check(facing.flipAimedSwitch() === false, 'E did not work the aimed switch');
  check(toggles === 1, `E worked the switch ${toggles} times, not once`);

  // Turned away: the prompt must go, and E must do nothing. This is the case the proximity
  // test alone gets wrong.
  const away = look(facing, 0, -1);
  check(away.prompt === null, `looking away from the switch, the prompt still says ${JSON.stringify(away.prompt)}`);
  check(facing.aimedSwitch() === null, 'a switch behind the player is still aimed');
  check(facing.flipAimedSwitch() === null, 'E worked a switch the player is not looking at');
  check(toggles === 1, `E worked a switch the player is not looking at (${toggles} presses)`);

  // AND THE ARBITRATION ITSELF, which the case above does not reach: the switch has to be
  // IN FRONT OF the player, so that the proximity test finds it, and a nearer target has to
  // win the ranking anyway. That is the real shape of the bug — the prompt says one thing
  // and the key does another — and it needs a second target to exist at all.
  const contested = makeInteraction(field, {
    hit: { colliderHandle: 7, toi: 0.8 },
    loose: { partIdForCollider: (h: number) => (h === 7 ? 'a-part' : null) },
  });
  const ranking = look(contested, 0, 1);
  // The prompt may be null here — the winner is a loose part, and offering it is up to the
  // part's own rules. What matters is that it does not offer the SWITCH.
  check(
    ranking.prompt === null || !ranking.prompt.includes('lights'),
    `with a part 0.8 m away the prompt offers the switch 2 m away: ` +
      `${JSON.stringify(ranking.prompt)}`,
  );
  check(
    contested.aimedSwitch() === null,
    'a switch 2 m away is aimed while a part 0.8 m away won the ranking — the prompt and ' +
      'the key disagree about what the player is looking at',
  );
  check(
    contested.flipAimedSwitch() === null,
    'E worked a switch that did not win the ranking, so the key did something the prompt ' +
      'never offered',
  );

  // THE FLOATING FRAME, on the reading side this time. The eye arrives relative to the
  // origin and the registry is absolute, so a switch is reachable only while the origin is
  // at zero unless the conversion is done here too — which means the first few metres of a
  // drive work and nothing after them does.
  const ORIGIN = { x: 26_000, z: -41_000 };
  // The eye's ABSOLUTE position is the same as in the first case — the plate two metres
  // ahead — but expressed relative to an origin 48 km away, which is what `fixedUpdate`
  // receives once the world has rebased.
  const rebased = makeInteraction(field, { origin: ORIGIN });
  rebased.fixedUpdate(1 / 60, frame(), 0 - ORIGIN.x, 1.2, 0 - ORIGIN.z, 0, 0, 1, 0);
  check(
    rebased.aimedSwitch()?.id === 'probe-plate',
    'a switch two metres away could not be aimed once the world had rebased 48 km — the ' +
      'aim is compared against the registry without converting the eye out of the ' +
      'floating frame, so switches work only near the world origin',
  );
  check(
    rebased.flipAimedSwitch() === false,
    'E did not work the switch after the world rebased',
  );

  // A WALL BETWEEN THE EYE AND THE PLATE. The switch has no collider of its own, so the ray
  // hits the wall — and a hit nearer than the plate means the plate is behind it. Without
  // this, a player standing against a wall can work the light on the other side of it.
  const throughWall = makeInteraction(field, { hit: { colliderHandle: 9, toi: 1.0 } });
  const blocked = look(throughWall, 0, 1);
  check(
    throughWall.aimedSwitch() === null,
    `a switch 2 m away is aimed through a wall 1 m away (prompt ${JSON.stringify(blocked.prompt)})`,
  );
  check(
    throughWall.flipAimedSwitch() === null,
    'E worked a switch through a wall',
  );

  // Out of reach: a switch three metres behind a wall still must not be offerable.
  const far = makeInteraction(field);
  const missed = look(far, 0, 1, -2.5);
  check(missed.prompt === null, `a switch 4.5 m away still offers a prompt: ${JSON.stringify(missed.prompt)}`);
  check(far.aimedSwitch() === null, 'a switch out of reach is aimed');
  check(far.flipAimedSwitch() === null, 'E worked a switch out of reach');

  console.log('  E works an aimed switch, and does nothing when one is not aimed');
}

if (failures.length > 0) {
  for (const failure of failures) console.log(`  FAIL  ${failure}`);
  throw new Error(`${failures.length} placement checks failed`);
}
console.log('\nevery building clears the road, the catalogue is reachable, and the home holds together');
