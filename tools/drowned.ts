/**
 * tools/drowned.ts
 *
 * Nothing the country builds stands in water, and no water stands on the road.
 *
 * The road and the water beside it are built by subsystems that agree about the ground
 * only through `Terrain`: the basins are dug by `world/lakes.ts`, the watercourse and its
 * ponds by `world/streams.ts`, the road is graded by `terrain.ts`, and the props come from
 * `world/props/` and `world/poi.ts`. Each of them reads the same height function and none
 * can see the others' decisions, so nothing but a measurement proves they did not put a
 * house in the village pond or run the asphalt through a dammed reach. That has happened:
 * `village.ts` placed a pond by its CENTRE at a fixed lateral, a 62 m bowl reached 7 m past
 * the centreline, and 4 of 337 houses came out with the ground under them below the pond's
 * own level.
 *
 * The water is read from the two authorities that draw it: `Terrain.waterLevelAt` for the
 * watercourses and the bog pools, and the basin's own lip for the dug bowls — the level
 * `render/lakewater.ts` floods to, taken from the schedule rather than from the flood so
 * this costs no window search.
 *
 *   npx tsx tools/drowned.ts [seed]
 *
 * Nothing here is part of the game bundle.
 */

import './domshim';
import * as THREE from 'three';

import { GameWorld, newWorldState } from '../src/game/state';
import { CHUNK_LENGTH, type ChunkContext } from '../src/world/chunks';
import { Road } from '../src/world/road';
import { Terrain } from '../src/world/terrain';
import { PoiProvider } from '../src/world/poi';
import { PoleProvider } from '../src/world/props/poles';
import { ScatterProvider } from '../src/world/props/scatter';
import { VILLAGE_SLOT_M, villageCovering, villagesAlongRoad } from '../src/world/village';
import type { BasinFootprint } from '../src/world/lakes';
import type { LoosePartField } from '../src/parts/loose';
import type { TrailerField } from '../src/vehicle/trailer';
import type { WreckTrunkField } from '../src/world/wrecktrunks';
import type { CourierField } from '../src/world/couriers';
import { PoiSwitchField } from '../src/world/poiswitches';

const SEED = Number(process.argv[2] ?? 1337) >>> 0;
/** Villages and basins examined: a village every 6-11 km, a basin every 32-54. */
const VILLAGES_WALKED = 24;
const BASINS_WALKED = 12;
/** Road walked with the real prop providers, metres. 16 km covers four POI slots or so. */
const PROP_SPAN_M = 120_000;
/** Road walked for the crossings: the targets in the census are quoted per 60 km. */
const CROSSING_SPAN_M = 120_000;
/** A prop's base may be this far under the surface and still read as on the bank. */
const WET_TOLERANCE_M = 0.05;

const road = new Road(SEED);
const terrain = new Terrain(SEED, road);

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(50)} ${detail}`);
}

// --- water ---------------------------------------------------------------------
/** Basins reaching the last queried point. Reused, because the query is per prop. */
const basinScratch: BasinFootprint[] = [];

/**
 * Height of the water standing at a point, or NaN where the ground there is dry.
 *
 * A basin's level is its LIP, and the lip is read on the bowl's own rim (`r = inner`,
 * where `LakeBasins.shape`'s bowl term has fallen to zero): that is the level the flood in
 * `render/lakewater.ts` fills to. At the centre the ground is the floor, not the level.
 */
function waterAt(x: number, z: number, hintS: number): number {
  let level = terrain.waterLevelAt(x, z);
  const count = terrain.basins.placementsNear(x, z, hintS, 0, basinScratch);
  for (let i = 0; i < count; i++) {
    const basin = basinScratch[i]!;
    if (Math.hypot(x - basin.x, z - basin.z) > basin.inner) continue;
    const rimX = basin.x + basin.inner * 0.99;
    const rim = road.project(rimX, basin.z, hintS);
    const lip = terrain.openBase(rimX, basin.z, Math.abs(rim.lateral), rim.s);
    if (!Number.isFinite(level) || lip > level) level = lip;
  }
  return level;
}

/** Every world-space position in a group, at whatever each object's own origin is. */
function positionsIn(group: THREE.Object3D, out: THREE.Vector3[]): void {
  const scratch = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  group.updateMatrixWorld(true);
  group.traverse((object) => {
    if (object instanceof THREE.InstancedMesh) {
      for (let i = 0; i < object.count; i++) {
        object.getMatrixAt(i, matrix);
        out.push(new THREE.Vector3().setFromMatrixPosition(matrix).applyMatrix4(object.matrixWorld));
      }
      return;
    }
    if (!(object instanceof THREE.Mesh)) return;
    out.push(scratch.setFromMatrixPosition(object.matrixWorld).clone());
  });
}

/** A chunk context for the providers: no physics, and nothing that needs a running game. */
function contextFor(chunkIndex: number, world: GameWorld): ChunkContext {
  return {
    chunkIndex,
    sStart: chunkIndex * CHUNK_LENGTH,
    sEnd: (chunkIndex + 1) * CHUNK_LENGTH,
    road,
    terrain,
    physics: null,
    world,
    hasPhysics: false,
    originX: 0,
    originZ: 0,
  } as unknown as ChunkContext;
}

// --- 1. No house stands in the village pond ------------------------------------
// The pond is the village's own hole in the ground and the street is its row of houses;
// the two are rolled from the same slot but from different numbers, so this is an
// invariant to measure rather than one to assume.
{
  const villages = villagesAlongRoad(SEED, VILLAGES_WALKED * VILLAGE_SLOT_M);
  let houses = 0;
  let insideBowl = 0;
  let underWater = 0;
  let underWhere = '';
  let deepest = 0;
  let closest = Number.POSITIVE_INFINITY;
  let closestWhere = '';
  for (const village of villages) {
    const pond = road.offsetPoint(village.pond.s, village.pond.lateral);
    for (const house of village.houses) {
      houses++;
      const point = road.offsetPoint(house.s, house.lateral);
      const clearance = Math.hypot(point.x - pond.x, point.z - pond.z) - village.pond.radius;
      if (clearance < closest) {
        closest = clearance;
        closestWhere = `village ${village.index}, house ${house.number}`;
      }
      if (clearance < 0) insideBowl++;
      const level = waterAt(point.x, point.z, house.s);
      const ground = terrain.heightAt(point.x, point.z, house.s);
      const depth = level - ground;
      if (Number.isFinite(level) && depth > WET_TOLERANCE_M) {
        underWater++;
        if (depth > deepest) {
          deepest = depth;
          underWhere =
            `village ${village.index}, house ${house.number} at s ${(house.s / 1000).toFixed(1)} km, ` +
            `lateral ${house.lateral.toFixed(0)} m, ${depth.toFixed(2)} m under`;
        }
      }
    }
  }
  check(
    'no house stands in its village pond',
    villages.length > 0 && houses > 0 && insideBowl === 0 && underWater === 0,
    `${houses} houses in ${villages.length} villages, ${insideBowl} inside a bowl, ` +
      `${underWater} with ground under water${underWhere}, closest to the pond ${closest.toFixed(1)} m (${closestWhere})`,
  );
}

// --- 2. No basin's water reaches the road --------------------------------------
// The basin is dug into the ground the road is graded across. The water stands inside the
// bowl (`r < inner`), so the property is geometric: no point of the carriageway may lie
// inside a bowl, and the ground on the asphalt must stand at or above the basin's level so
// no puddle is drawn on the paint. Measured in WORLD distance, not in arclength: a basin's
// centre sits up to 650 m off the road, and comparing the road's elevation with the level
// of a basin on a slope six hundred metres away measures the slope, not a flood.
{
  const schedule = terrain.basins.schedule;
  const basins = Math.min(schedule.length, BASINS_WALKED);
  let leastApproach = Number.POSITIVE_INFINITY;
  let leastWhere = '';
  let insideBowl = 0;
  let wetAsphalt = 0;
  let leastAbove = Number.POSITIVE_INFINITY;
  let wetWhere = '';
  for (let i = 0; i < basins; i++) {
    const site = schedule[i]!;
    const centre = road.offsetPoint(site.s, site.lateral);
    const rimX = centre.x + site.radius * 0.99;
    const rim = road.project(rimX, centre.z, site.s);
    const lip = terrain.openBase(rimX, centre.z, Math.abs(rim.lateral), rim.s);
    const reach = site.radius + 200;
    for (let s = Math.max(0, site.s - reach); s <= site.s + reach; s += 5) {
      const point = road.offsetPoint(s, 0);
      const r = Math.hypot(point.x - centre.x, point.z - centre.z);
      const approach = r - site.radius;
      if (approach < leastApproach) {
        leastApproach = approach;
        leastWhere = `site ${site.index} at s ${(s / 1000).toFixed(1)} km`;
      }
      if (r < site.radius) insideBowl++;
      // The asphalt itself, both edges — but only where the basin actually touches the
      // ground, which is inside `rimAt`. Outside that the level is a number belonging to a
      // hill six hundred metres away and comparing the road with it measures the slope.
      if (r > site.radius + 60) continue;
      const edge = road.halfWidthAt(s);
      for (const lateral of [0, edge, -edge]) {
        const paint = road.offsetPoint(s, lateral);
        const above = terrain.heightAt(paint.x, paint.z, s) - lip;
        if (above < leastAbove) {
          leastAbove = above;
          wetWhere =
            `site ${site.index} (s ${(site.s / 1000).toFixed(1)} km, lateral ${site.lateral.toFixed(0)} m, ` +
            `r ${site.radius.toFixed(0)} m) at s ${(s / 1000).toFixed(2)} km, lateral ${lateral.toFixed(1)} m, ` +
            `${r.toFixed(0)} m from the centre`;
        }
        if (above < -WET_TOLERANCE_M) wetAsphalt++;
      }
    }
  }
  check(
    'no basin floods the road or its edges',
    basins > 0 && insideBowl === 0 && wetAsphalt === 0,
    `${basins} basins walked, ${insideBowl} road points inside a bowl, ${wetAsphalt} under the level, ` +
      `closest bowl-to-centreline ${leastApproach.toFixed(1)} m (${leastWhere}), ` +
      `least ground-above-level on the paint ${leastAbove.toFixed(2)} m${wetWhere === '' ? '' : ` (${wetWhere})`}`,
  );
}

// --- 3. Nothing placed beside the road stands in water -------------------------
// Poles, scattered props and the buildings are all placed from the road frame, and the
// watercourse is a field beside that frame: the corridor is graded flat and a stream is
// carved through it, so a prop authored at a sane setback from the asphalt can still land
// in the bed. Where the road BRIDGES a reach the corridor's own ground is the open bed for
// the width of the channel (`gradedBase` steps aside), which is what puts a building in the
// water: measured at seed 1337, village 4's house 17 stood 1.11 m below the level.
//
// Only the chunks that HAVE water in the corridor are built: the network crosses the road
// once every 2.5-8 km, so a walk of every chunk would spend nearly all of its time on dry
// ground and pay the providers' build for nothing.
{
  const world = new GameWorld(newWorldState(SEED));
  const noLoose = { spawnItem: () => {}, spawnPart: () => {}, forget: () => {} } as unknown as LoosePartField;
  const noTrailers = { spawn: () => {}, forget: () => {} } as unknown as TrailerField;
  const noWreckTrunks = { register: () => {}, forget: () => {} } as unknown as WreckTrunkField;
  const noCouriers = { register: () => {}, forget: () => {} } as unknown as CourierField;
  const switches = new PoiSwitchField();
  const providers = [
    new PoiProvider(noLoose, noTrailers, noWreckTrunks, switches, noCouriers),
    new PoleProvider(),
    new ScatterProvider(),
  ];
  const positions: THREE.Vector3[] = [];
  let chunks = 0;
  for (let chunk = 0; chunk < PROP_SPAN_M / CHUNK_LENGTH; chunk++) {
    // Is any of this chunk's corridor under water? The network crosses the road once every
    // 2.5-8 km, so the gate is what makes a 120 km walk affordable.
    let wet = false;
    for (let s = chunk * CHUNK_LENGTH; s <= (chunk + 1) * CHUNK_LENGTH && !wet; s += 12) {
      const edge = road.halfWidthAt(s) + 2;
      for (const lateral of [0, edge, -edge]) {
        const point = road.offsetPoint(s, lateral);
        const level = terrain.waterLevelAt(point.x, point.z);
        if (Number.isFinite(level) && level - terrain.heightAt(point.x, point.z, s) > WET_TOLERANCE_M) {
          wet = true;
          break;
        }
      }
    }
    if (!wet) continue;
    const context = contextFor(chunk, world);
    for (const provider of providers) {
      const content = provider.build(context);
      if (content) positionsIn(content.group, positions);
    }
    chunks++;
  }
  let drowned = 0;
  let worst = 0;
  let worstWhere = '';
  for (const position of positions) {
    const projection = road.project(position.x, position.z);
    const level = waterAt(position.x, position.z, projection.s);
    if (!Number.isFinite(level)) continue;
    const depth = level - position.y;
    if (depth > WET_TOLERANCE_M) {
      drowned++;
      if (depth > worst) {
        worst = depth;
        worstWhere = `s ${(projection.s / 1000).toFixed(1)} km, lateral ${projection.lateral.toFixed(1)} m`;
      }
    }
  }
  check(
    'no pole, prop or building stands in water',
    positions.length > 0 && drowned === 0,
    `${positions.length} objects over ${chunks} wet chunks of ${PROP_SPAN_M / CHUNK_LENGTH} km ` +
      `walked, ${drowned} under water` +
      (drowned === 0 ? '' : `, worst ${worst.toFixed(2)} m (${worstWhere})`),
  );
}

// --- 4. Every watery crossing is spanned or culverted --------------------------
// At a bridge the bed stays open under the deck and the streams field says so (`span`); at
// a culvert the graded embankment fills the bed and the water goes through a pipe, so the
// ground at the centreline stands above the level. What must never happen is neither —
// water open at the centreline with nothing spanning it — or a level above the deck.
{
  let watery = 0;
  let spanned = 0;
  let culverted = 0;
  let openUnderNothing = 0;
  let aboveDeck = 0;
  let worstAboveDeck = 0;
  let inBed = false;
  let maxSpan = 0;
  let deepest = 0;
  let highest = Number.NEGATIVE_INFINITY;
  const close = (): void => {
    watery++;
    if (maxSpan > 0.5) spanned++;
    else if (deepest < -0.2) openUnderNothing++;
    else culverted++;
  };
  for (let s = 0; s < CROSSING_SPAN_M; s += 2) {
    const point = road.sampleAt(s);
    const stream = road.landscape.streams.at(point.x, point.z);
    if (stream.bed > 0.02) {
      if (!inBed) {
        maxSpan = 0;
        deepest = 0;
        highest = Number.NEGATIVE_INFINITY;
      }
      inBed = true;
      if (stream.span > maxSpan) maxSpan = stream.span;
      const level = terrain.waterLevelAt(point.x, point.z);
      if (Number.isFinite(level)) {
        deepest = Math.min(deepest, terrain.heightAt(point.x, point.z, s) - level);
        highest = Math.max(highest, level);
        if (level > point.y + WET_TOLERANCE_M) {
          aboveDeck++;
          worstAboveDeck = Math.max(worstAboveDeck, level - point.y);
        }
      }
      continue;
    }
    if (inBed) close();
    inBed = false;
  }
  if (inBed) close();
  check(
    'every watery crossing is spanned or culverted',
    watery > 0 && openUnderNothing === 0 && aboveDeck === 0,
    `${watery} watery crossings over ${(CROSSING_SPAN_M / 1000).toFixed(0)} km (one every ` +
      `${(CROSSING_SPAN_M / Math.max(1, watery) / 1000).toFixed(1)} km): ${spanned} spanned, ` +
      `${culverted} culverted, ${openUnderNothing} open under nothing, ${aboveDeck} above the deck`,
  );
}

// --- 5. No village street lies on a bridge -------------------------------------
// A street is a row of houses and a bridge is a deck with parapets: the two are placed
// from different schedules, and a house on a bridge is a house on a raft.
{
  let bridges = 0;
  let overVillage = 0;
  let where = '';
  let inBed = false;
  for (let s = 0; s < CROSSING_SPAN_M; s += 2) {
    const point = road.sampleAt(s);
    const stream = road.landscape.streams.at(point.x, point.z);
    const spanned =
      stream.bed > 0.02 && stream.span > 0.5 && Number.isFinite(terrain.waterLevelAt(point.x, point.z));
    if (spanned && !inBed) {
      bridges++;
      const village = villageCovering(SEED, s);
      if (village) {
        overVillage++;
        if (where === '') where = ` village ${village.index} at s ${(s / 1000).toFixed(1)} km`;
      }
    }
    inBed = spanned;
  }
  check(
    'no village street stands on a bridge',
    bridges > 0 && overVillage === 0,
    `${bridges} bridges over ${(CROSSING_SPAN_M / 1000).toFixed(0)} km (one every ` +
      `${(CROSSING_SPAN_M / Math.max(1, bridges) / 1000).toFixed(1)} km), ` +
      `${overVillage} with a village over the deck${where}`,
  );
}

console.log(
  failures === 0 ? '\nnothing is drowning and the road is dry' : `\n${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
