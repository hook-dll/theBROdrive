/**
 * The race tracks beside the posts: are they closed, clear of themselves and of the
 * road, varied, fitted into the ground, streamed and freed, and drivable?
 *
 *   nice -n 15 bun tools/racetrack-gen.ts [posts per seed = 40] [laps on = 3] [seeds…]
 *
 * For every post that rolls a track (world/racetrack/site.ts `postHasTrack`) on each
 * seed, the track is placed exactly as the game places it — through a real `Terrain`,
 * whose ground it levels — and checked, not just printed:
 *
 *  - CLOSED: the table's last row runs into its first at the table's own step, with
 *    the heading continuous across the seam (the loop is C1 everywhere: no row-to-row
 *    heading jump past a hairpin's own, and curvature steps no larger than a clothoid's);
 *  - NOT SELF-INTERSECTING: no two points more than `NEIGHBOUR_S_M` apart along the lap
 *    come nearer than `TRACK_CLEAR_M` (layout.ts);
 *  - CLEAR OF THE ROAD AND THE SETTLEMENT: every point of the track's levelled core,
 *    the paddock and the lane past its first 50 m is at least as far from the road as
 *    site.ts promises, and the lane misses every house of the settlement;
 *  - FITTED: the drawn ground (`Terrain.heightAt`, the desert tiles' own function) is
 *    under the asphalt everywhere on the track and level with the run-off's plane, and
 *    no slope in the skirt round it is a wall;
 *  - STREAMED: the owner chunk builds it visual-only with no bodies, physical with its
 *    colliders, and tearing it down leaves the physics world as it found it.
 *
 * Then the first `laps on` tracks are driven by the real `Autopilot` (frantic, the
 * racing driver) round one lap from the grid on the real collider — the ribbon in
 * slabs by surface — with a sand apron where the game has the levelled desert, and the
 * lap time, pace and worst excursion are reported.
 */

import * as THREE from 'three';
import { emptyInput } from '../src/core/input';
import { FIXED_DT, PhysicsWorld } from '../src/core/physics';
import { SurfaceType } from '../src/core/surfaces';
import { GameWorld, newWorldState } from '../src/game/state';
import { createServiceableCarState } from '../src/game/spawn';
import { preloadCarModels } from '../src/render/carmodel';
import { Autopilot } from '../src/vehicle/autopilot';
import { Vehicle } from '../src/vehicle/vehicle';
import type { ChunkContext } from '../src/world/chunks';
import { postSlot } from '../src/world/poislots';
import { postS } from '../src/world/poststops';
import type { InstanceBatches } from '../src/world/props/instancebatch';
import { CHUNK_LENGTH, ROAD_VISUAL_CHUNKS } from '../src/world/ranges';
import { WorldOrigin } from '../src/world/origin';
import { Road } from '../src/world/road';
import { RoadDistance } from '../src/world/roaddistance';
import { roadHalf, roadsideStop } from '../src/world/settlement';
import { Terrain } from '../src/world/terrain';
import { CURVATURE_SMOOTH_M, loopSeparation, NEIGHBOUR_S_M, TRACK_CLEAR_M } from '../src/world/racetrack/layout';
import { addTrackRibbonColliders, buildTrackRibbon, RaceTrackProvider, TRACK_LIFT_M } from '../src/world/racetrack/mesh';
import { CHUNK_SPREAD_M, LANE_HALF_WIDTH_M, postHasTrack, RUNOFF_M, SKIRT_M } from '../src/world/racetrack/site';
import type { RaceTrack } from '../src/world/racetrack/track';
import { installAssetShim } from './assetshim';
import { installDocumentShim } from './domshim';
import { buildLapGround } from './racelapworld';

class BunProgressEvent extends Event implements ProgressEvent {
  readonly lengthComputable: boolean;
  readonly loaded: number;
  readonly total: number;
  constructor(type: string, init: ProgressEventInit = {}) {
    super(type, init);
    this.lengthComputable = init.lengthComputable ?? false;
    this.loaded = init.loaded ?? 0;
    this.total = init.total ?? 0;
  }
}
if (globalThis.ProgressEvent === undefined) globalThis.ProgressEvent = BunProgressEvent;
installAssetShim();
installDocumentShim();

const POSTS = Math.max(3, Number(process.argv[2] ?? 40));
const LAP_TRACKS = Math.max(0, Number(process.argv[3] ?? 3));
const SEEDS = process.argv.length > 4 ? process.argv.slice(4).map(Number) : [1337, 7, 2024];
const MODEL_ID = 'sv_vaz2105r';
/** Most the skirt may add to the desert's own slope across 2 m: a bank, not a wall. */
const SKIRT_ADDED_SLOPE_MAX = 0.4;
/** How far the drawn ground may stand off the run-off's plane before it reads as a ditch. */
const RUNOFF_FIT_M = 0.25;

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}: ${detail}`);
}

interface Row {
  readonly seed: number;
  readonly track: RaceTrack;
  readonly ms: number;
}

const rows: Row[] = [];
const terrains = new Map<number, { road: Road; terrain: Terrain }>();
let rolled = 0;
let settlements = 0;

for (const seed of SEEDS) {
  const started = performance.now();
  const road = new Road(seed);
  void road.spine;
  const terrain = new Terrain(seed, road);
  terrains.set(seed, { road, terrain });
  console.log(`\nseed ${seed}: spine ${((performance.now() - started) / 1000).toFixed(1)} s`);
  for (let post = 0; post < POSTS; post++) {
    settlements++;
    if (!postHasTrack(seed, post)) continue;
    rolled++;
    const t0 = performance.now();
    const track = terrain.raceTracks.track(post);
    const ms = performance.now() - t0;
    if (!track) {
      console.log(`  post ${post} (${(postS(seed, post) / 1000).toFixed(1)} km): rolled, no room (${ms.toFixed(0)} ms)`);
      continue;
    }
    rows.push({ seed, track, ms });
  }
}

console.log(
  `\n${rows.length} tracks placed of ${rolled} rolled over ${settlements} posts ` +
    `(${((rows.length / settlements) * 100).toFixed(0)}% of settlements)`,
);
console.log(
  '\n seed post    km  lap m  minR  bank  offc  grade climb  asph grav dirt  corners                         gen ms',
);
for (const { seed, track, ms } of rows) {
  const st = track.stats;
  const corners = Object.entries(st.corners)
    .map(([kind, n]) => `${n}${kind[0]}${kind[1]}`)
    .join(' ');
  console.log(
    ` ${String(seed).padStart(4)} ${String(track.postIndex).padStart(4)} ${(track.postS / 1000).toFixed(1).padStart(5)} ` +
      `${track.lengthM.toFixed(0).padStart(6)} ${st.minRadiusM.toFixed(1).padStart(5)} ${(st.maxBank * 100).toFixed(1).padStart(4)}% ` +
      `${(st.maxOffCamber * 100).toFixed(1).padStart(4)}% ${(st.maxGrade * 100).toFixed(1).padStart(5)}% ${st.climbM.toFixed(0).padStart(4)} ` +
      `${(st.surfaceShare.asphalt * 100).toFixed(0).padStart(4)}% ${(st.surfaceShare.gravel * 100).toFixed(0).padStart(3)}% ` +
      `${(st.surfaceShare.dirt * 100).toFixed(0).padStart(3)}%  ${corners.padEnd(30)} ${ms.toFixed(0).padStart(6)}`,
  );
}

// ---------------------------------------------------------------------------
// Geometry: closed, C1, not self-intersecting.
// ---------------------------------------------------------------------------
console.log('\ngeometry');
let worstClosure = 0;
let worstHeadingJump = 0;
let worstCurvatureStep = 0;
let worstSeparation = Infinity;
for (const { track } of rows) {
  const rowCount = Math.round(track.lengthM);
  const step = track.lengthM / rowCount;
  const first = track.sampleAt(0);
  const last = track.sampleAt(track.lengthM - step);
  worstClosure = Math.max(worstClosure, Math.abs(Math.hypot(first.x - last.x, first.z - last.z) - step));
  const xs: number[] = [];
  const zs: number[] = [];
  // Mid-row, row by row (the table's own rows), round the seam and back to the start.
  let previous = track.sampleAt(0.5 * step);
  for (let row = 1; row <= rowCount; row++) {
    const at = track.sampleAt((row + 0.5) * step);
    let dh = at.heading - previous.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    worstHeadingJump = Math.max(worstHeadingJump, Math.abs(dh) / step);
    worstCurvatureStep = Math.max(worstCurvatureStep, Math.abs(at.curvature - previous.curvature) / step);
    xs.push(at.x);
    zs.push(at.z);
    previous = at;
  }
  worstSeparation = Math.min(worstSeparation, loopSeparation(xs, zs, track.lengthM, 200, 2));
}
check('every lap closes on itself', worstClosure < 0.02, `seam off its own step by ${(worstClosure * 1000).toFixed(1)} mm at worst`);
check(
  'heading is continuous (C1), curvature eased',
  worstHeadingJump < 1 / 18 && worstCurvatureStep < (2 / (19 * CURVATURE_SMOOTH_M)) * 1.1,
  `steepest turn ${(1 / worstHeadingJump).toFixed(1)} m radius, curvature step ${worstCurvatureStep.toExponential(2)} /m² ` +
    `(a 19 m corner's reversal eased over ${CURVATURE_SMOOTH_M} m is ${(2 / (19 * CURVATURE_SMOOTH_M)).toExponential(2)}; un-eased it would be ${(1 / 19).toExponential(2)} in one metre)`,
);
check(
  'no lap comes near itself',
  worstSeparation >= TRACK_CLEAR_M,
  `nearest approach of two stretches more than ${NEIGHBOUR_S_M} m apart along the lap: ${worstSeparation.toFixed(1)} m (floor ${TRACK_CLEAR_M})`,
);

// ---------------------------------------------------------------------------
// Variety.
// ---------------------------------------------------------------------------
console.log('\nvariety');
const lengths = rows.map((r) => r.track.lengthM);
const kinds = new Set<string>();
let withHill = 0;
let withOffCamber = 0;
let withBank = 0;
let mixed = 0;
for (const { track } of rows) {
  for (const corner of track.corners) kinds.add(corner.kind);
  if (track.stats.climbM >= 8) withHill++;
  if (track.stats.maxOffCamber > 0.01) withOffCamber++;
  if (track.stats.maxBank >= 0.04) withBank++;
  const share = track.stats.surfaceShare;
  if ([share.asphalt, share.gravel, share.dirt].filter((v) => v > 0.05).length >= 2) mixed++;
}
const signatures = new Set(rows.map((r) => `${Math.round(r.track.lengthM)}:${r.track.corners.length}`));
check(
  'laps in the 1.8-3.5 km window, and all different',
  lengths.every((l) => l >= 1800 && l <= 3500) && signatures.size === rows.length,
  `${Math.min(...lengths).toFixed(0)}-${Math.max(...lengths).toFixed(0)} m, ${signatures.size} distinct of ${rows.length}`,
);
check(
  'every lap mixes surfaces, most have banking and climbs',
  mixed === rows.length && withBank >= rows.length * 0.6 && withHill >= rows.length * 0.6,
  `${mixed} mixed, ${withBank} banked to 4%+, ${withOffCamber} with an off-camber corner, ${withHill} climbing 8 m+; ` +
    `piece kinds seen: ${[...kinds].sort().join(', ')}`,
);

// ---------------------------------------------------------------------------
// Placement and ground.
// ---------------------------------------------------------------------------
console.log('\nplacement and ground');
let nearestRoad = Infinity;
let widestSpread = 0;
let laneThroughHouse = 0;
let groundOver = -Infinity;
let runoffGap = 0;
let skirtSlope = 0;
let skirtAdded = 0;
for (const { seed, track } of rows) {
  const { road, terrain } = terrains.get(seed)!;
  const core = track.halfWidth + RUNOFF_M;
  const point = { x: 0, y: 0, z: 0 };
  for (let s = 0; s < track.lengthM; s += 4) {
    for (const lateral of [-core, core]) {
      track.offsetPoint(s, lateral, point);
      // Hintless: a hinted projection only descends locally, and 100 m out it settles on a
      // foot that is not the nearest and reports a shorter lateral than the true distance.
      const p = road.project(point.x, point.z);
      nearestRoad = Math.min(nearestRoad, Math.abs(p.lateral));
      widestSpread = Math.max(widestSpread, Math.abs(p.s - track.chunkS));
    }
    // Under the asphalt: the drawn ground is the plane, the ribbon TRACK_LIFT_M above it.
    for (const lateral of [-track.halfWidth, 0, track.halfWidth]) {
      track.offsetPoint(s, lateral, point);
      const ground = terrain.heightAt(point.x, point.z, track.postS);
      groundOver = Math.max(groundOver, ground - (track.surfaceY(s, lateral) + TRACK_LIFT_M));
    }
    // The run-off is the plane carried on.
    const runoff = (track.halfWidth + RUNOFF_M * 0.8) * (s % 8 === 0 ? 1 : -1);
    track.offsetPoint(s, runoff, point);
    runoffGap = Math.max(runoffGap, Math.abs(terrain.heightAt(point.x, point.z, track.postS) - track.surfaceY(s, runoff)));
    // The skirt: the steepest the ground gets across it.
    if (s % 16 === 0) {
      for (const sign of [-1, 1]) {
        let previous = Number.NaN;
        let previousOpen = Number.NaN;
        for (let d = core; d <= core + SKIRT_M + 4; d += 2) {
          track.offsetPoint(s, sign * d, point);
          const h = terrain.heightAt(point.x, point.z, track.postS);
          const p = road.project(point.x, point.z, track.postS);
          const open = terrain.raceTracks.naturalAt(point.x, point.z, Math.abs(p.lateral), p.s);
          if (!Number.isNaN(previous)) {
            const slope = Math.abs(h - previous) / 2;
            skirtSlope = Math.max(skirtSlope, slope);
            skirtAdded = Math.max(skirtAdded, slope - Math.abs(open - previousOpen) / 2);
          }
          previous = h;
          previousOpen = open;
        }
      }
    }
  }
  const stop = roadsideStop(seed, postSlot(track.postIndex))!;
  for (const lanePoint of track.accessLane.slice(Math.ceil(50 / 3))) {
    const p = road.project(lanePoint.x, lanePoint.z);
    for (const house of stop.layout.houses) {
      const { along, across } = roadHalf(house.halfX, house.halfZ);
      if (Math.abs(p.s - house.s) <= along + LANE_HALF_WIDTH_M && Math.abs(p.lateral - house.lateral) <= across + LANE_HALF_WIDTH_M) laneThroughHouse++;
    }
  }
}
check('the levelled ground never reaches the settlement', nearestRoad >= 75 + SKIRT_M - 1, `run-off edge ${nearestRoad.toFixed(1)} m from the road's centreline at nearest`);
check(
  'the owner chunk is streamed wherever the player is on a lap',
  widestSpread <= CHUNK_SPREAD_M + RUNOFF_M + 20,
  `farthest stretch ${widestSpread.toFixed(0)} m of road from the owner's arclength (visual window ${ROAD_VISUAL_CHUNKS * CHUNK_LENGTH} m)`,
);
check('the lane misses every house', laneThroughHouse === 0, `${laneThroughHouse} lane point(s) inside a house`);
check('the ground never shows through the asphalt', groundOver < 0, `drawn ground at most ${(groundOver * 100).toFixed(1)} cm relative to the asphalt`);
check('the run-off is the track plane carried on', runoffGap < RUNOFF_FIT_M, `worst ${(runoffGap * 100).toFixed(1)} cm off`);
check(
  'the skirt is a bank, not a wall',
  skirtAdded < SKIRT_ADDED_SLOPE_MAX,
  `adds at most ${(skirtAdded * 100).toFixed(0)}% to the desert's own slope; steepest ground in a skirt ${(skirtSlope * 100).toFixed(0)}% across 2 m`,
);

// ---------------------------------------------------------------------------
// Streaming: visual-only, physical, torn down.
// ---------------------------------------------------------------------------
console.log('\nstreaming');
const physics = await PhysicsWorld.create();
{
  const { seed, track } = rows[0]!;
  const { road, terrain } = terrains.get(seed)!;
  const world = new GameWorld(newWorldState(seed));
  const provider = new RaceTrackProvider(new RoadDistance(road));
  const chunkIndex = Math.floor(track.chunkS / CHUNK_LENGTH);
  const origin = new WorldOrigin();
  origin.reset(track.startGrid[0].x, track.startGrid[0].z);
  const context = (hasPhysics: boolean): ChunkContext => ({
    chunkIndex,
    sStart: chunkIndex * CHUNK_LENGTH,
    sEnd: (chunkIndex + 1) * CHUNK_LENGTH,
    road,
    terrain,
    physics,
    world,
    hasPhysics,
    originX: origin.x,
    originZ: origin.z,
    batches: {} as InstanceBatches,
  });
  const before = physics.world.bodies.len();
  const visual = provider.build(context(false));
  const visualBodies = physics.world.bodies.len() - before;
  const t0 = performance.now();
  const physical = provider.build(context(true));
  const buildMs = performance.now() - t0;
  let triangles = 0;
  const meshes: string[] = [];
  physical?.group.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const index = mesh.geometry.index;
    const count = (index ? index.count : mesh.geometry.getAttribute('position').count) / 3;
    triangles += count;
    meshes.push(`${(mesh.material as THREE.Material).name || (mesh.material as THREE.Material).type}:${count}`);
  });
  const neighbour = provider.build({ ...context(true), chunkIndex: chunkIndex + 3, sStart: (chunkIndex + 3) * CHUNK_LENGTH, sEnd: (chunkIndex + 4) * CHUNK_LENGTH });
  const bodies = physical?.bodies.length ?? 0;
  const disabled = physical?.colliders.filter((c) => !c.isEnabled()).length ?? 0;
  for (const body of physical?.bodies ?? []) physics.removeBody(body);
  physical?.dispose?.();
  visual?.dispose?.();
  const after = physics.world.bodies.len();
  check(
    'the owner chunk builds the track, its neighbours nothing',
    visual !== null && physical !== null && neighbour === null,
    `${meshes.length} meshes, ${triangles.toFixed(0)} triangles (${meshes.join(', ')}), built in ${buildMs.toFixed(0)} ms`,
  );
  check(
    'colliders only in the physics band, built disabled, freed with the chunk',
    visualBodies === 0 && bodies > 0 && disabled === bodies && after === before,
    `${visualBodies} bodies visual-only, ${bodies} static trimesh bodies physical (all disabled until attached), ` +
      `${after - before} left after teardown`,
  );
}

// ---------------------------------------------------------------------------
// Drivability: the autopilot round a lap from the grid.
// ---------------------------------------------------------------------------
if (LAP_TRACKS > 0) {
  await preloadCarModels([MODEL_ID]);
  console.log('\ndrivability (frantic, one lap from the grid)');
}
for (const { seed, track } of rows.slice(0, LAP_TRACKS)) {
  const lapPhysics = await PhysicsWorld.create();
  const origin = new WorldOrigin();
  const grid = track.startGrid[0];
  origin.reset(grid.x, grid.z);
  buildLapGround(lapPhysics, origin, track);
  const world = new GameWorld(newWorldState(seed));
  const state = createServiceableCarState('racer', MODEL_ID, grid.x, grid.y + 1.2, grid.z, grid.heading);
  world.state.cars[state.id] = state;
  const vehicle = new Vehicle(lapPhysics, world, state, new THREE.Scene(), origin);
  const autopilot = new Autopilot(track.road, lapPhysics);
  autopilot.setMode('frantic');
  const input = emptyInput();
  input.handbrake = true;
  for (let i = 0; i < 180; i++) {
    vehicle.fixedUpdate(FIXED_DT, input);
    lapPhysics.step();
    vehicle.postStep();
  }
  input.handbrake = false;
  autopilot.setEngaged(true);

  const position = { x: 0, y: 0, z: 0 };
  vehicle.absoluteTranslation(position);
  let hint = track.project(position.x, position.z).s;
  let previousS = hint;
  let travelled = 0;
  let elapsed = 0;
  let peak = 0;
  let worstLateral = 0;
  let offTrack = 0;
  let stuck = 0;
  let lapSeconds = Number.NaN;
  const limit = 420;
  const bySurface = new Map<SurfaceType, { seconds: number; metres: number }>();
  while (elapsed < limit) {
    autopilot.drive(FIXED_DT, vehicle, input, 0, 0);
    vehicle.fixedUpdate(FIXED_DT, input);
    lapPhysics.step();
    vehicle.postStep();
    elapsed += FIXED_DT;
    vehicle.absoluteTranslation(position);
    const projection = track.project(position.x, position.z, hint);
    hint = projection.s;
    let delta = projection.s - previousS;
    if (delta < -track.lengthM / 2) delta += track.lengthM;
    if (delta > track.lengthM / 2) delta -= track.lengthM;
    travelled += delta;
    previousS = projection.s;
    const v = vehicle.chassis.linvel();
    const speed = Math.hypot(v.x, v.z);
    peak = Math.max(peak, speed);
    worstLateral = Math.max(worstLateral, Math.abs(projection.lateral));
    if (Math.abs(projection.lateral) > track.halfWidth) offTrack += FIXED_DT;
    if (speed < 0.5) stuck += FIXED_DT;
    const surface = track.surfaceAt(projection.s);
    const entry = bySurface.get(surface) ?? { seconds: 0, metres: 0 };
    entry.seconds += FIXED_DT;
    entry.metres += Math.max(0, delta);
    bySurface.set(surface, entry);
    if (travelled >= track.lengthM) {
      lapSeconds = elapsed;
      break;
    }
  }
  const pace = [...bySurface.entries()]
    .map(([surface, e]) => `${['asphalt', 'cracked', 'gravel', 'sand', 'rock', 'concrete', 'dirt'][surface]} ${((e.metres / e.seconds) * 3.6).toFixed(0)} km/h`)
    .join(', ');
  check(
    `${track.id} (seed ${seed}, ${track.lengthM.toFixed(0)} m): the autopilot completes a lap`,
    Number.isFinite(lapSeconds) && stuck < 5,
    Number.isFinite(lapSeconds)
      ? `${lapSeconds.toFixed(1)} s, mean ${((track.lengthM / lapSeconds) * 3.6).toFixed(0)} km/h, peak ${(peak * 3.6).toFixed(0)}, ` +
          `${offTrack.toFixed(1)} s off the asphalt, worst ${worstLateral.toFixed(1)} m from the centre; ${pace}`
      : `${travelled.toFixed(0)} m of ${track.lengthM.toFixed(0)} in ${limit} s, ${stuck.toFixed(0)} s stopped, worst ${worstLateral.toFixed(1)} m`,
  );
}

console.log(failures === 0 ? '\nall race track checks passed' : `\n${failures} race track check(s) FAILED`);
if (failures > 0) process.exitCode = 1;
