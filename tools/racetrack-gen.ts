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
 *  - VARIED AND DENSE: laps 0.9-1.7 km, nine corner features or more each (a chicane
 *    or esses counts once), most with a hairpin, most banked into a corner by 8° or
 *    more and with 12 m or more between their highest and lowest points, none steeper
 *    than `GRADE_MAX`;
 *  - DRESSED: no two paint quads overlap (a curb or the chequers cut the edge line
 *    under them), and every chicane is CLOSED by exactly one rock and one log
 *    (`chicaneBlockers`) — each straight cut from the entry straight's asphalt to the
 *    exit straight's, at any pair of laterals, meets the solid core of one of them, and
 *    none stays on the asphalt — while both stand 1.5 m or more clear of the asphalt;
 *    every checkpoint gate (`checkpointGates`) has its posts just beyond the asphalt's
 *    edge, its beam `GATE_CLEARANCE_MIN_M` or more over the surface, and no post near a
 *    blocker; the numbers per post and per blocker are printed;
 *  - LANE: the access lane's drawn surface is its collider, and a wheel crossing its
 *    edge meets no step (tools/racelane.ts);
 *  - CHEAP TO SHOW: every placed track is built by the provider with its colliders and
 *    each build step timed: none may hold the main thread past `STEP_BUDGET_MS`, and a
 *    placement (`terrain.raceTracks.track`) averages `PLACE_BUDGET_MS` or less;
 *  - STREAMED: the owner chunk builds it visual-only with no bodies, physical with its
 *    colliders, and tearing it down leaves the physics world as it found it.
 *
 * Then the first `laps on` tracks are driven by the real `Autopilot` (frantic, the
 * racing driver) round one lap from the grid on the real collider — the ribbon in
 * slabs by surface, the chicanes' rocks and logs — with a sand apron where the game
 * has the levelled desert, and the lap time, pace and worst excursion are reported.
 * Last, one track per seed is plotted top-down to build/race/track-<seed>-<post>.svg:
 * asphalt, curbs, edge lines, numbered checkpoint gates, blockers, grid slots and the
 * centreline coloured by height; and the first seed's first track with a chicane is
 * plotted close up at a chicane and at a gate, from the collider data itself, to
 * build/race/gates-anticut-<seed>.svg.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import { mkdirSync, writeFileSync } from 'node:fs';
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
import { tileGroundSampler } from '../src/world/deserttiledata';
import { postSlot } from '../src/world/poislots';
import { postS } from '../src/world/poststops';
import type { InstanceBatches } from '../src/world/props/instancebatch';
import { CHUNK_LENGTH, ROAD_VISUAL_CHUNKS } from '../src/world/ranges';
import { WorldOrigin } from '../src/world/origin';
import { Road } from '../src/world/road';
import { RoadDistance } from '../src/world/roaddistance';
import { roadHalf, roadsideStop } from '../src/world/settlement';
import { Terrain } from '../src/world/terrain';
import { CHICANE_SHIFT_MIN_M, CURVATURE_SMOOTH_M, loopSeparation, NEIGHBOUR_S_M, TRACK_CLEAR_M, TRACK_MAX_LENGTH_M, TRACK_MIN_LENGTH_M } from '../src/world/racetrack/layout';
import { checkpointGates, chicaneBlockers, RaceTrackProvider, trackChicanes, trackPaintRects, TRACK_LIFT_M, type TrackPaintRect } from '../src/world/racetrack/mesh';
import { CHUNK_SPREAD_M, LANE_HALF_WIDTH_M, postHasTrack, RUNOFF_M, SKIRT_M } from '../src/world/racetrack/site';
import type { RaceTrack } from '../src/world/racetrack/track';
import { installAssetShim } from './assetshim';
import { installDocumentShim } from './domshim';
import { measureLane, newLaneMeasure } from './racelane';
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
/** Longest a build step may hold the main thread, and the mean placement's budget, ms. */
const STEP_BUDGET_MS = 4;
const PLACE_BUDGET_MS = 60;
/** Steepest grade a lap may have (site.ts holds 11%), and the least clearance under a gate's beam. */
const GRADE_MAX = 0.111;
const GATE_CLEARANCE_MIN_M = 5;
/** The lane: most its drawn surface may stand off its collider, or off what a wheel stands on, and the largest jump across 0.25 m. */
const LANE_DRAWN_FIT_M = 0.03;
const LANE_STEP_MAX_M = 0.12;

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}: ${detail}`);
}

function degrees(slope: number): number {
  return (Math.atan(slope) * 180) / Math.PI;
}

/** Corner features of a lap: every corner, a chicane or esses counted once (track.ts `stats`). */
function featureCount(track: RaceTrack): number {
  let features = 0;
  for (const n of Object.values(track.stats.corners)) features += n ?? 0;
  return features;
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

// ---------------------------------------------------------------------------
// Build steps: every placed track built by the provider, with its colliders, as the
// streamer builds it, every step timed (the better of two builds, so one GC pause is
// not read as a step's cost). The run's first build is reported apart: it pays for
// the scatter's forms and the JIT, which the game pays at boot.
// ---------------------------------------------------------------------------
const physics = await PhysicsWorld.create();
const providers = new Map<number, { provider: RaceTrackProvider; world: GameWorld }>();

function chunkContext(seed: number, track: RaceTrack, hasPhysics: boolean, world: GameWorld, chunkShift = 0): ChunkContext {
  const { road, terrain } = terrains.get(seed)!;
  const chunkIndex = Math.floor(track.chunkS / CHUNK_LENGTH) + chunkShift;
  const origin = new WorldOrigin();
  origin.reset(track.startGrid[0]!.x, track.startGrid[0]!.z);
  return {
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
  };
}

interface BuildTiming {
  readonly maxStepMs: number;
  readonly totalMs: number;
  readonly steps: number;
}

function timeBuild(seed: number, track: RaceTrack): BuildTiming {
  let entry = providers.get(seed);
  if (!entry) {
    entry = { provider: new RaceTrackProvider(new RoadDistance(terrains.get(seed)!.road)), world: new GameWorld(newWorldState(seed)) };
    providers.set(seed, entry);
  }
  const iterator = entry.provider.buildSteps(chunkContext(seed, track, true, entry.world));
  let maxStepMs = 0;
  let totalMs = 0;
  let steps = 0;
  for (;;) {
    const t0 = performance.now();
    const result = iterator.next();
    const ms = performance.now() - t0;
    maxStepMs = Math.max(maxStepMs, ms);
    totalMs += ms;
    steps++;
    if (result.done) {
      for (const body of result.value?.bodies ?? []) physics.removeBody(body);
      result.value?.dispose?.();
      return { maxStepMs, totalMs, steps };
    }
  }
}

const coldBuild = timeBuild(rows[0]!.seed, rows[0]!.track);
const timings = new Map<RaceTrack, BuildTiming>();
for (const { seed, track } of rows) {
  const first = timeBuild(seed, track);
  const second = timeBuild(seed, track);
  timings.set(track, first.maxStepMs <= second.maxStepMs ? first : second);
}

console.log(
  `\n${rows.length} tracks placed of ${rolled} rolled over ${settlements} posts ` +
    `(${((rows.length / settlements) * 100).toFixed(0)}% of settlements)`,
);
console.log(
  '\n seed post    km  lap m feat hp ch es  elev climb  bank°  offc° grade  asph grav dirt  corners                   place ms step ms build ms',
);
for (const { seed, track, ms } of rows) {
  const st = track.stats;
  const timing = timings.get(track)!;
  const corners = Object.entries(st.corners)
    .map(([kind, n]) => `${n}${kind[0]}${kind[1]}`)
    .join(' ');
  console.log(
    ` ${String(seed).padStart(4)} ${String(track.postIndex).padStart(4)} ${(track.postS / 1000).toFixed(1).padStart(5)} ` +
      `${track.lengthM.toFixed(0).padStart(6)} ${String(featureCount(track)).padStart(4)} ${String(st.corners.hairpin ?? 0).padStart(2)} ` +
      `${String(st.corners.chicane ?? 0).padStart(2)} ${String(st.corners.esses ?? 0).padStart(2)} ${st.elevationM.toFixed(1).padStart(5)} ` +
      `${st.climbM.toFixed(0).padStart(5)} ${degrees(st.maxBank).toFixed(1).padStart(6)} ${degrees(st.maxOffCamber).toFixed(1).padStart(6)} ${(st.maxGrade * 100).toFixed(1).padStart(5)}% ` +
      `${(st.surfaceShare.asphalt * 100).toFixed(0).padStart(4)}% ${(st.surfaceShare.gravel * 100).toFixed(0).padStart(3)}% ` +
      `${(st.surfaceShare.dirt * 100).toFixed(0).padStart(3)}%  ${corners.padEnd(25)} ${ms.toFixed(0).padStart(8)} ` +
      `${timing.maxStepMs.toFixed(2).padStart(7)} ${timing.totalMs.toFixed(1).padStart(8)}`,
  );
}

console.log('\nbuild and placement cost');
const placeMs = rows.map((r) => r.ms);
const worstStep = Math.max(...[...timings.values()].map((t) => t.maxStepMs));
const meanBuild = [...timings.values()].reduce((sum, t) => sum + t.totalMs, 0) / rows.length;
const meanSteps = [...timings.values()].reduce((sum, t) => sum + t.steps, 0) / rows.length;
check(
  `no build step holds the main thread past ${STEP_BUDGET_MS} ms`,
  worstStep <= STEP_BUDGET_MS,
  `longest step ${worstStep.toFixed(2)} ms over ${rows.length} builds of ${meanSteps.toFixed(0)} steps, ${meanBuild.toFixed(1)} ms each on average ` +
    `(the run's first, cold build: longest step ${coldBuild.maxStepMs.toFixed(1)} ms, ${coldBuild.totalMs.toFixed(0)} ms in all)`,
);
check(
  `placing a track takes ${PLACE_BUDGET_MS} ms or less on average`,
  placeMs.reduce((a, b) => a + b, 0) / rows.length <= PLACE_BUDGET_MS,
  `mean ${(placeMs.reduce((a, b) => a + b, 0) / rows.length).toFixed(0)} ms, longest ${Math.max(...placeMs).toFixed(0)} ms (a seed's first placement also builds the road's distance index)`,
);

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
let withHairpin = 0;
let mixed = 0;
let fewestFeatures = Infinity;
for (const { track } of rows) {
  for (const corner of track.corners) kinds.add(corner.kind);
  if (track.stats.elevationM >= 12) withHill++;
  if (track.stats.maxOffCamber > 0.01) withOffCamber++;
  if (track.stats.maxBank >= Math.tan((8 * Math.PI) / 180)) withBank++;
  if (track.stats.corners.hairpin) withHairpin++;
  fewestFeatures = Math.min(fewestFeatures, featureCount(track));
  const share = track.stats.surfaceShare;
  if ([share.asphalt, share.gravel, share.dirt].filter((v) => v > 0.05).length >= 2) mixed++;
}
const signatures = new Set(rows.map((r) => `${r.track.lengthM.toFixed(2)}:${r.track.corners.length}:${r.track.halfWidth.toFixed(3)}`));
check(
  `laps in the ${TRACK_MIN_LENGTH_M / 1000}-${TRACK_MAX_LENGTH_M / 1000} km window, and all different`,
  lengths.every((l) => l >= TRACK_MIN_LENGTH_M && l <= TRACK_MAX_LENGTH_M) && signatures.size === rows.length,
  `${Math.min(...lengths).toFixed(0)}-${Math.max(...lengths).toFixed(0)} m, mean ${(lengths.reduce((a, b) => a + b, 0) / rows.length).toFixed(0)}, ` +
    `${signatures.size} distinct of ${rows.length}`,
);
check(
  'every lap is dense (nine corner features or more), most have a hairpin',
  fewestFeatures >= 9 && withHairpin >= rows.length * 0.6,
  `fewest features ${fewestFeatures}, ${withHairpin} of ${rows.length} with a hairpin (${((withHairpin / rows.length) * 100).toFixed(0)}%)`,
);
/** min-median-mean-max of a list, at `digits`. */
const spread = (values: readonly number[], digits: number): string => {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  return `${sorted[0]!.toFixed(digits)}-${sorted[sorted.length - 1]!.toFixed(digits)} (median ${sorted[Math.floor(sorted.length / 2)]!.toFixed(digits)}, mean ${mean.toFixed(digits)})`;
};
console.log(`  elevation (highest - lowest) m: ${spread(rows.map((r) => r.track.stats.elevationM), 1)}`);
console.log(`  climb per lap m:                ${spread(rows.map((r) => r.track.stats.climbM), 0)}`);
console.log(`  steepest bank °:                ${spread(rows.map((r) => degrees(r.track.stats.maxBank)), 1)}`);
console.log(`  steepest grade %:               ${spread(rows.map((r) => r.track.stats.maxGrade * 100), 1)}`);
check(
  'every lap mixes surfaces, most have real banking and height, none too steep to climb',
  mixed === rows.length && withBank >= rows.length * 0.6 && withHill >= rows.length * 0.6 && rows.every((r) => r.track.stats.maxGrade <= GRADE_MAX),
  `${mixed} mixed, ${withBank} banked to 8°+, ${withOffCamber} with an off-camber corner, ` +
    `${withHill} spanning 12 m+ of height, steepest grade ${(Math.max(...rows.map((r) => r.track.stats.maxGrade)) * 100).toFixed(1)}% ` +
    `(ceiling ${(GRADE_MAX * 100).toFixed(1)}); piece kinds seen: ${[...kinds].sort().join(', ')}`,
);

// ---------------------------------------------------------------------------
// Dressing: the paint never overlaps itself, and the chicanes cannot be cut.
// ---------------------------------------------------------------------------
console.log('\ndressing');
let paintRects = 0;
let overlaps = 0;
let overlapExample = '';
for (const { track } of rows) {
  const lap = track.lengthM;
  const rects = trackPaintRects(track);
  paintRects += rects.length;
  // Each rect wrapped into the lap, and once more a lap back when it runs past the end.
  const spans = rects
    .flatMap((rect) => {
      const shift = Math.floor(rect.s0 / lap) * lap;
      const wrapped = { ...rect, s0: rect.s0 - shift, s1: rect.s1 - shift };
      return wrapped.s1 > lap ? [wrapped, { ...wrapped, s0: wrapped.s0 - lap, s1: wrapped.s1 - lap }] : [wrapped];
    })
    .sort((p, q) => p.s0 - q.s0);
  for (let i = 0; i < spans.length; i++) {
    const a = spans[i]!;
    for (let j = i + 1; j < spans.length && spans[j]!.s0 < a.s1 - 1e-6; j++) {
      const b = spans[j]!;
      if (Math.min(a.l1, b.l1) - Math.max(a.l0, b.l0) <= 1e-6) continue;
      overlaps++;
      const span = (r: TrackPaintRect): string => `[${r.s0.toFixed(2)}-${r.s1.toFixed(2)} x ${r.l0.toFixed(2)}..${r.l1.toFixed(2)}]`;
      overlapExample ||= `; e.g. ${track.id}: ${a.colour} ${span(a)} over ${b.colour} ${span(b)}`;
    }
  }
}
check('no two paint quads overlap (curbs and chequers cut the edge lines)', overlaps === 0, `${paintRects} quads over ${rows.length} laps, ${overlaps} overlapping pairs${overlapExample}`);

let chicaneCount = 0;
let chicanesClosed = 0;
let linesOnAsphalt = 0;
let blockerTotal = 0;
let nearestBlocker = Infinity;
let smallestShift = Infinity;
let openExample = '';
const point = { x: 0, y: 0, z: 0 };
for (const { track } of rows) {
  const hw = track.halfWidth;
  const blockers = chicaneBlockers(track);
  blockerTotal += blockers.length;
  // Every blocker's outline, a log's along its whole length, against the whole lap.
  for (const b of blockers) {
    for (const end of b.halfLength > 0 ? [-1, 0, 1] : [0]) {
      const p = track.project(b.x + Math.cos(b.yaw) * b.halfLength * end, b.z - Math.sin(b.yaw) * b.halfLength * end);
      nearestBlocker = Math.min(nearestBlocker, Math.abs(p.lateral) - b.radius - hw);
    }
  }
  trackChicanes(track).forEach((chicane, index) => {
    chicaneCount++;
    const mine = blockers.filter((b) => b.chicane === index);
    const end = chicane.startS + chicane.length;
    const entry = track.sampleAt(chicane.startS - 12);
    const exit = track.sampleAt(end + 12);
    const mid = track.sampleAt(chicane.startS + chicane.length / 2);
    const chord = Math.hypot(exit.x - entry.x, exit.z - entry.z);
    smallestShift = Math.min(smallestShift, Math.abs(((mid.x - entry.x) * (exit.z - entry.z) - (mid.z - entry.z) * (exit.x - entry.x)) / chord));
    let closed = true;
    // Straight cuts from the entry straight's asphalt to the exit straight's, at every
    // pair of laterals across both, from two distances out.
    for (const reach of [12, 20]) {
      for (let i = 0; i <= 8; i++) {
        for (let j = 0; j <= 8; j++) {
          const l0 = -hw + (2 * hw * i) / 8;
          const l1 = -hw + (2 * hw * j) / 8;
          track.offsetPoint(chicane.startS - reach, l0, point);
          const ax = point.x;
          const az = point.z;
          track.offsetPoint(end + reach, l1, point);
          const span = Math.hypot(point.x - ax, point.z - az);
          const samples = Math.ceil(span / 0.2);
          let hit = false;
          let leaves = false;
          for (let k = 0; k <= samples && !hit; k++) {
            const t = k / samples;
            const x = ax + (point.x - ax) * t;
            const z = az + (point.z - az) * t;
            if (!leaves && Math.abs(track.project(x, z, chicane.startS - reach + (chicane.length + 2 * reach) * t).lateral) > hw) leaves = true;
            for (const b of mine) {
              const ux = Math.cos(b.yaw);
              const uz = -Math.sin(b.yaw);
              const along = Math.max(-b.halfLength, Math.min(b.halfLength, (x - b.x) * ux + (z - b.z) * uz));
              if (Math.hypot(x - b.x - ux * along, z - b.z - uz * along) <= b.solid) hit = true;
            }
          }
          if (!leaves) linesOnAsphalt++;
          if (!hit && closed) {
            closed = false;
            openExample ||= `; e.g. ${track.id} chicane ${index}: ${l0.toFixed(1)} -> ${l1.toFixed(1)} from ${reach} m out`;
          }
        }
      }
    }
    if (closed) chicanesClosed++;
  });
}
check(
  'every chicane is blocked: each straight cut from entry to exit asphalt meets a rock or log',
  chicanesClosed === chicaneCount && linesOnAsphalt === 0,
  `${chicanesClosed} of ${chicaneCount} chicanes closed by ${blockerTotal} blockers; the middle stands ${smallestShift.toFixed(1)} m+ off ` +
    `the straight's line (rolled ${CHICANE_SHIFT_MIN_M}+, eased a little by the clothoids), cuts that stay on the asphalt: ${linesOnAsphalt}${openExample}`,
);
check('the blockers stand clear of the asphalt', nearestBlocker >= 1.5, `nearest outline ${nearestBlocker.toFixed(2)} m beyond the asphalt's edge (floor 1.5)`);

// Exactly one rock and one log per chicane, and where each stands off the centreline.
let wrongMix = 0;
let blockerCentreMin = Infinity;
const blockerLines: string[] = [];
for (const { seed, track } of rows) {
  const blockers = chicaneBlockers(track);
  trackChicanes(track).forEach((_, index) => {
    const mine = blockers.filter((b) => b.chicane === index);
    const rocks = mine.filter((b) => b.kind === 'rock');
    const logs = mine.filter((b) => b.kind === 'log');
    if (rocks.length !== 1 || logs.length !== 1 || mine.length !== 2) wrongMix++;
    const parts = mine.map((b) => {
      // Nearest the outline comes to the centreline, along a log's whole length.
      let near = Infinity;
      let far = 0;
      const steps = Math.max(1, Math.ceil(b.halfLength * 2));
      for (let k = 0; k <= steps; k++) {
        const t = b.halfLength > 0 ? -1 + (2 * k) / steps : 0;
        const p = track.project(b.x + Math.cos(b.yaw) * b.halfLength * t, b.z - Math.sin(b.yaw) * b.halfLength * t);
        near = Math.min(near, Math.abs(p.lateral) - b.radius);
        far = Math.max(far, Math.abs(p.lateral) + b.radius);
      }
      blockerCentreMin = Math.min(blockerCentreMin, near);
      return b.kind === 'rock'
        ? `rock r${b.radius.toFixed(1)} ${near.toFixed(1)} m off the centreline`
        : `log ${(2 * b.halfLength).toFixed(1)} m x ${(2 * b.radius).toFixed(1)} ${near.toFixed(1)}-${far.toFixed(1)} m off`;
    });
    blockerLines.push(`  seed ${seed} ${track.id} chicane ${index} (half width ${track.halfWidth.toFixed(1)}): ${parts.join('; ')}`);
  });
}
console.log(`\nanti-cut blockers, every one (distances from the centreline to the outline):\n${blockerLines.join('\n')}`);
check(
  'every chicane has exactly one rock and one log',
  wrongMix === 0,
  `${chicaneCount} chicanes, ${blockerTotal} blockers (${(blockerTotal / Math.max(1, chicaneCount)).toFixed(1)} per chicane), ${wrongMix} not one rock and one log; ` +
    `nearest outline ${blockerCentreMin.toFixed(2)} m from the centreline`,
);

// The checkpoint gates: posts just beyond the edge, never on the asphalt nor by a
// blocker, the beam clear of the tallest load.
let postEdgeMin = Infinity;
let postEdgeMax = -Infinity;
let postCentreMin = Infinity;
let beamClearanceMin = Infinity;
let postBlockerMin = Infinity;
let gateCount = 0;
let gateBoxes = 0;
let gatesInChicane = 0;
const gateLines: string[] = [];
for (const { seed, track } of rows) {
  const hw = track.halfWidth;
  const boxes = checkpointGates(track);
  const blockers = chicaneBlockers(track);
  gateCount += track.checkpoints.length;
  gateBoxes += boxes.length;
  for (const s of track.checkpoints) {
    for (const chicane of trackChicanes(track)) if (s > chicane.startS && s < chicane.startS + chicane.length) gatesInChicane++;
  }
  let edgeMin = Infinity;
  let centreMin = Infinity;
  let clearMin = Infinity;
  for (const box of boxes) {
    const ux = Math.cos(box.yaw);
    const uz = -Math.sin(box.yaw);
    const fx = Math.sin(box.yaw);
    const fz = Math.cos(box.yaw);
    if (box.part === 'beam') {
      // The beam's underside over the highest point of the surface under it, post to post.
      for (let l = -box.halfX; l <= box.halfX; l += 0.25) clearMin = Math.min(clearMin, box.y - box.halfY - track.surfaceY(box.s, l));
      continue;
    }
    // The post's footprint, its edges sampled: nearest it comes to the centreline.
    for (let a = -1; a <= 1; a += 0.25) {
      for (const b of [-1, 1]) {
        for (const [p, q] of [
          [a, b],
          [b, a],
        ] as const) {
          const x = box.x + ux * box.halfX * p + fx * box.halfZ * q;
          const z = box.z + uz * box.halfX * p + fz * box.halfZ * q;
          const at = track.project(x, z, box.s);
          centreMin = Math.min(centreMin, Math.abs(at.lateral));
          edgeMin = Math.min(edgeMin, Math.abs(at.lateral) - hw);
          for (const blocker of blockers) {
            const along = Math.max(-blocker.halfLength, Math.min(blocker.halfLength, (x - blocker.x) * Math.cos(blocker.yaw) - (z - blocker.z) * Math.sin(blocker.yaw)));
            const d = Math.hypot(x - blocker.x - Math.cos(blocker.yaw) * along, z - blocker.z + Math.sin(blocker.yaw) * along) - blocker.radius;
            postBlockerMin = Math.min(postBlockerMin, d);
          }
        }
      }
    }
  }
  postEdgeMin = Math.min(postEdgeMin, edgeMin);
  postEdgeMax = Math.max(postEdgeMax, edgeMin);
  postCentreMin = Math.min(postCentreMin, centreMin);
  beamClearanceMin = Math.min(beamClearanceMin, clearMin);
  gateLines.push(
    `  seed ${seed} ${track.id}: ${track.checkpoints.length} gates at ${track.checkpoints.map((s) => s.toFixed(0)).join('/')} m; ` +
      `post colliders ${edgeMin.toFixed(2)} m+ beyond the asphalt edge, ${centreMin.toFixed(2)} m+ from the centreline (half width ${hw.toFixed(2)}); ` +
      `beam ${clearMin.toFixed(2)} m+ over the surface`,
  );
}
console.log(`\ncheckpoint gates, every track (each post's collider footprint against the lap):\n${gateLines.join('\n')}`);
check(
  'every gate collides, its posts just beyond the asphalt edge, clear of the blockers, its beam over the tallest load',
  gateBoxes === gateCount * 3 && postEdgeMin > 0.5 && postEdgeMax < 1.2 && gatesInChicane === 0 && postBlockerMin > 5 && beamClearanceMin >= GATE_CLEARANCE_MIN_M,
  `${gateCount} gates, ${gateBoxes} collider boxes (2 posts and a beam each); post footprints ${postEdgeMin.toFixed(2)}-${postEdgeMax.toFixed(2)} m beyond the asphalt edge ` +
    `at nearest, ${postCentreMin.toFixed(2)} m+ from the centreline; ${gatesInChicane} gates inside a chicane; nearest blocker outline ${postBlockerMin.toFixed(1)} m from a post; ` +
    `beam underside ${beamClearanceMin.toFixed(2)} m+ over the surface (floor ${GATE_CLEARANCE_MIN_M})`,
);

// ---------------------------------------------------------------------------
// Placement and ground.
// ---------------------------------------------------------------------------
console.log('\nplacement and ground');
let nearestRoad = Infinity;
let widestSpread = 0;
let widestTrack = '';
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
      if (Math.abs(p.s - track.chunkS) > widestSpread) widestTrack = `${track.id} of seed ${seed}`;
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
  `farthest stretch ${widestSpread.toFixed(0)} m of road from the owner's arclength (${widestTrack}; visual window ${ROAD_VISUAL_CHUNKS * CHUNK_LENGTH} m)`,
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
    `${visualBodies} bodies visual-only, ${bodies} static bodies physical (all disabled until attached), ` +
      `${after - before} left after teardown`,
  );
}

// ---------------------------------------------------------------------------
// The access lane: what is drawn is what a wheel stands on, and its edge is no step.
// ---------------------------------------------------------------------------
console.log('\naccess lane');
{
  const lane = newLaneMeasure();
  const laneDistances = new Map<number, RoadDistance>();
  for (const { seed, track } of rows) {
    // A world of its own per track: only this build's colliders under the rays.
    const lanePhysics = await PhysicsWorld.create();
    const entry = providers.get(seed)!;
    const context = { ...chunkContext(seed, track, true, entry.world), physics: lanePhysics };
    const built = entry.provider.build(context);
    if (!built) continue;
    for (const collider of built.colliders) collider.setEnabled(true);
    lanePhysics.step();
    // The shared road-distance index the provider's lane drape asks, as the tiles do.
    const { road, terrain } = terrains.get(seed)!;
    let roadDistance = laneDistances.get(seed);
    if (!roadDistance) laneDistances.set(seed, (roadDistance = new RoadDistance(road)));
    const ground = tileGroundSampler({ seed, road, terrain, roadDistance });
    measureLane(track, built.group, lanePhysics, ground, context.originX, context.originZ, lane);
    built.dispose?.();
    lanePhysics.world.free();
  }
  check(
    'the lane is collided as drawn and its edges are no step',
    lane.drawnVsCollider <= LANE_DRAWN_FIT_M && lane.sink <= LANE_DRAWN_FIT_M && lane.step <= LANE_STEP_MAX_M,
    `${lane.samples} samples across ${rows.length} lanes, every 0.25 m from the middle to past the widest shoulder: drawn vs collider ${(lane.drawnVsCollider * 100).toFixed(1)} cm at worst, ` +
      `drawn surface over what a wheel stands on ${(lane.sink * 100).toFixed(1)} cm at worst (${lane.sinkAt}), largest jump in what a wheel stands on across 0.25 m beyond the desert's own ` +
      `${(lane.step * 100).toFixed(1)} cm (${lane.stepAt})`,
  );
}

// ---------------------------------------------------------------------------
// Drivability: the autopilot round a lap from the grid.
// ---------------------------------------------------------------------------
if (LAP_TRACKS > 0) {
  await preloadCarModels([MODEL_ID]);
  console.log('\ndrivability (frantic, one lap from the grid)');
}
/** Each driven lap's path, world x, z pairs: the racing line the proof plot draws. */
const drivenPaths = new Map<RaceTrack, number[]>();
for (const { seed, track } of rows.slice(0, LAP_TRACKS)) {
  const path: number[] = [];
  drivenPaths.set(track, path);
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
    path.push(position.x, position.z);
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
    `${track.id} (seed ${seed}, ${track.lengthM.toFixed(0)} m): the autopilot completes a lap within the run-off`,
    Number.isFinite(lapSeconds) && stuck < 5 && worstLateral < track.halfWidth + RUNOFF_M,
    Number.isFinite(lapSeconds)
      ? `${lapSeconds.toFixed(1)} s, mean ${((track.lengthM / lapSeconds) * 3.6).toFixed(0)} km/h, peak ${(peak * 3.6).toFixed(0)}, ` +
          `${offTrack.toFixed(1)} s off the asphalt, worst ${worstLateral.toFixed(1)} m from the centre; ${pace}`
      : `${travelled.toFixed(0)} m of ${track.lengthM.toFixed(0)} in ${limit} s, ${stuck.toFixed(0)} s stopped, worst ${worstLateral.toFixed(1)} m`,
  );
}

// ---------------------------------------------------------------------------
// Plots: one track per seed, top-down, for the eye.
// ---------------------------------------------------------------------------
const SURFACE_FILL = { asphalt: '#5b5b5e', gravel: '#9c8a6e', dirt: '#86664a' } as const;
const PAINT_FILL = { white: '#f2efe6', red: '#c0392b', black: '#1c1c1c' } as const;

/** The track drawn in world metres (x right, z down: seen from above), with `caption` on top. */
function trackSvg(track: RaceTrack, caption: readonly string[]): string {
  const hw = track.halfWidth;
  const at = { x: 0, y: 0, z: 0 };
  const ring = (s: number, lateral: number): string => {
    track.offsetPoint(s, lateral, at);
    return `${at.x.toFixed(2)},${at.z.toFixed(2)}`;
  };
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  let low = Infinity;
  let high = -Infinity;
  for (let s = 0; s < track.lengthM; s += 2) {
    track.offsetPoint(s, 0, at);
    minX = Math.min(minX, at.x);
    maxX = Math.max(maxX, at.x);
    minZ = Math.min(minZ, at.z);
    maxZ = Math.max(maxZ, at.z);
    low = Math.min(low, track.centreY(s));
    high = Math.max(high, track.centreY(s));
  }
  const pad = hw + RUNOFF_M + 12;
  const head = 11 * caption.length + 8;
  const x0 = minX - pad;
  const z0 = minZ - pad - head;
  const width = maxX - minX + 2 * pad;
  const height = maxZ - minZ + 2 * pad + head;
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0.toFixed(1)} ${z0.toFixed(1)} ${width.toFixed(1)} ${height.toFixed(1)}" width="${(width * 2).toFixed(0)}" height="${(height * 2).toFixed(0)}">`,
    `<rect x="${x0}" y="${z0}" width="${width}" height="${height}" fill="#dcc79f"/>`,
  ];
  // The levelled run-off, then each sector's surface, as strips of quads along the lap.
  const strip = (from: number, to: number, l0: number, l1: number, fill: string): void => {
    const rows = Math.max(1, Math.ceil((to - from) / 2));
    const left: string[] = [];
    const right: string[] = [];
    for (let r = 0; r <= rows; r++) {
      const s = from + ((to - from) * r) / rows;
      left.push(ring(s, l1));
      right.push(ring(s, l0));
    }
    out.push(`<polygon points="${[...left, ...right.reverse()].join(' ')}" fill="${fill}"/>`);
  };
  strip(0, track.lengthM, -(hw + RUNOFF_M), hw + RUNOFF_M, '#cfb88c');
  for (const sector of track.sectors) strip(sector.startS, sector.endS, -hw, hw, SURFACE_FILL[sector.kind]);
  for (const rect of trackPaintRects(track)) {
    out.push(`<polygon points="${ring(rect.s0, rect.l0)} ${ring(rect.s1, rect.l0)} ${ring(rect.s1, rect.l1)} ${ring(rect.s0, rect.l1)}" fill="${PAINT_FILL[rect.colour]}"/>`);
  }
  // The centreline, blue at the lap's lowest to red at its highest.
  for (let s = 0; s < track.lengthM; s += 4) {
    const t = high > low ? (track.centreY(s + 2) - low) / (high - low) : 0.5;
    out.push(`<polyline points="${ring(s, 0)} ${ring(Math.min(s + 4, track.lengthM), 0)}" stroke="hsl(${(240 * (1 - t)).toFixed(0)},85%,50%)" stroke-width="0.7" fill="none"/>`);
  }
  for (const slot of track.startGrid) {
    out.push(`<polygon points="${ring(slot.s - 2.1, slot.lateral - 0.9)} ${ring(slot.s + 2.1, slot.lateral - 0.9)} ${ring(slot.s + 2.1, slot.lateral + 0.9)} ${ring(slot.s - 2.1, slot.lateral + 0.9)}" fill="#2e6fd8"/>`);
  }
  const post = hw + 1.8;
  out.push(`<polyline points="${ring(0, -post)} ${ring(0, post)}" stroke="#444" stroke-width="0.8"/>`);
  for (const box of checkpointGates(track)) {
    out.push(boxFootprint(box.x, box.z, box.halfX, box.halfZ, box.yaw, box.part === 'beam' ? 'fill="#e3b21c" fill-opacity="0.6"' : 'fill="#333"'));
    if (box.part === 'beam') {
      track.offsetPoint(box.s, post + 5, at);
      out.push(`<text x="${at.x.toFixed(1)}" y="${at.z.toFixed(1)}" font-size="7" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle" fill="#7a5c00">${box.gate + 1}</text>`);
    }
  }
  for (const b of chicaneBlockers(track)) {
    if (b.kind === 'rock') {
      out.push(`<circle cx="${b.x.toFixed(2)}" cy="${b.z.toFixed(2)}" r="${b.radius.toFixed(2)}" fill="#815f42" stroke="#4a3624" stroke-width="0.15"/>`);
    } else {
      const ux = Math.cos(b.yaw) * b.halfLength;
      const uz = -Math.sin(b.yaw) * b.halfLength;
      out.push(`<line x1="${(b.x - ux).toFixed(2)}" y1="${(b.z - uz).toFixed(2)}" x2="${(b.x + ux).toFixed(2)}" y2="${(b.z + uz).toFixed(2)}" stroke="#6e5a3c" stroke-width="${(2 * b.radius).toFixed(2)}" stroke-linecap="round"/>`);
    }
  }
  caption.forEach((line, i) => {
    out.push(`<text x="${(x0 + 6).toFixed(1)}" y="${(z0 + 11 * (i + 1)).toFixed(1)}" font-size="8.5" font-family="sans-serif" fill="#222">${line}</text>`);
  });
  out.push('</svg>');
  return out.join('\n');
}

/** A box's footprint seen from above: half extents across (`hx`) and along (`hz`), turned `yaw`. */
function boxFootprint(x: number, z: number, hx: number, hz: number, yaw: number, style: string): string {
  const ux = Math.cos(yaw);
  const uz = -Math.sin(yaw);
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([a, b]) => `${(x + ux * hx * a! + fx * hz * b!).toFixed(3)},${(z + uz * hx * a! + fz * hz * b!).toFixed(3)}`);
  return `<polygon points="${corners.join(' ')}" ${style}/>`;
}

mkdirSync('build/race', { recursive: true });
const plotted = SEEDS.map((seed) => rows.find((row) => row.seed === seed)).filter((row): row is Row => row !== undefined);
for (const row of rows) if (plotted.length < 3 && !plotted.includes(row)) plotted.push(row);
const plots: string[] = [];
for (const { seed, track } of plotted.slice(0, 3)) {
  const st = track.stats;
  const corners = Object.entries(st.corners).map(([kind, n]) => `${n} ${kind}`).join(', ');
  const path = `build/race/track-${seed}-${track.postIndex}.svg`;
  const blockers = chicaneBlockers(track);
  writeFileSync(
    path,
    trackSvg(track, [
      `seed ${seed}, post ${track.postIndex}: ${track.lengthM.toFixed(0)} m, ${featureCount(track)} corner features`,
      corners,
      `elevation ${st.elevationM.toFixed(1)} m (highest - lowest), climb ${st.climbM.toFixed(0)} m per lap, grade ${(st.maxGrade * 100).toFixed(1)}%, ` +
        `bank ${degrees(st.maxBank).toFixed(1)}°, off-camber ${degrees(st.maxOffCamber).toFixed(1)}°, tightest ${st.minRadiusM.toFixed(0)} m`,
      `${trackChicanes(track).length} chicanes: ${blockers.filter((b) => b.kind === 'rock').length} rocks, ${blockers.filter((b) => b.kind === 'log').length} logs; ` +
        `${track.checkpoints.length} gates, posts and beam collided`,
    ]),
  );
  plots.push(path);
}
console.log(`\nplots: ${plots.join(', ')}`);

// ---------------------------------------------------------------------------
// Proof: a chicane and a gate close up, drawn from the COLLIDERS themselves — the
// bench's lap ground built into a physics world, every Rock and Concrete collider read
// back from Rapier (boxes by their half extents and pose, the rock's trimesh by its
// triangles) — against the asphalt's edges, the centreline, the straight cuts the
// chicane closes and the line the autopilot drove.
// ---------------------------------------------------------------------------
{
  const proof = rows.slice(0, LAP_TRACKS).find((row) => trackChicanes(row.track).length > 0) ?? rows.find((row) => trackChicanes(row.track).length > 0);
  if (proof) {
    const { seed, track } = proof;
    const hw = track.halfWidth;
    const proofPhysics = await PhysicsWorld.create();
    const origin = new WorldOrigin();
    origin.reset(track.startGrid[0]!.x, track.startGrid[0]!.z);
    buildLapGround(proofPhysics, origin, track);
    // Every solid the lap has besides its ground, as footprints in world XZ.
    const solids: { kind: string; svg: string; xs: number[]; zs: number[] }[] = [];
    const turn = new THREE.Quaternion();
    const corner = new THREE.Vector3();
    proofPhysics.world.forEachCollider((collider) => {
      const surface = proofPhysics.surfaces.lookupType(collider.handle);
      if (surface !== SurfaceType.Rock && surface !== SurfaceType.Concrete) return;
      const t = collider.translation();
      const r = collider.rotation();
      turn.set(r.x, r.y, r.z, r.w);
      const xs: number[] = [];
      const zs: number[] = [];
      if (collider.shape.type === RAPIER.ShapeType.Cuboid) {
        const h = (collider.shape as RAPIER.Cuboid).halfExtents;
        for (const [a, b, c] of [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1], [-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]] as const) {
          corner.set(h.x * a, h.y * b, h.z * c).applyQuaternion(turn);
          xs.push(t.x + corner.x + origin.x);
          zs.push(t.z + corner.z + origin.z);
        }
        // Top-down outline of a box: the hull of its eight corners.
        const hull = convexHull(xs, zs);
        const kind = surface === SurfaceType.Concrete ? (h.x > 2 ? 'beam' : 'post') : 'log';
        const fill = kind === 'beam' ? '#e3b21c' : kind === 'post' ? '#d0312d' : '#6e5a3c';
        solids.push({ kind, xs, zs, svg: `<polygon points="${hull}" fill="${fill}" fill-opacity="${kind === 'beam' ? 0.35 : 0.85}" stroke="#000" stroke-width="0.04"/>` });
        return;
      }
      const vertices = collider.shape.type === RAPIER.ShapeType.TriMesh ? (collider.shape as RAPIER.TriMesh).vertices : null;
      if (!vertices) return;
      for (let i = 0; i < vertices.length; i += 3) {
        corner.set(vertices[i]!, vertices[i + 1]!, vertices[i + 2]!).applyQuaternion(turn);
        xs.push(t.x + corner.x + origin.x);
        zs.push(t.z + corner.z + origin.z);
      }
      solids.push({ kind: 'rock', xs, zs, svg: `<polygon points="${convexHull(xs, zs)}" fill="#815f42" fill-opacity="0.85" stroke="#000" stroke-width="0.04"/>` });
    });
    const counts = new Map<string, number>();
    for (const solid of solids) counts.set(solid.kind, (counts.get(solid.kind) ?? 0) + 1);
    const driven = drivenPaths.get(track) ?? [];
    const at = { x: 0, y: 0, z: 0 };
    const ring = (s: number, lateral: number): string => {
      track.offsetPoint(s, lateral, at);
      return `${at.x.toFixed(2)},${at.z.toFixed(2)}`;
    };
    // One panel: the lap's surfaces round `centre`, `half` metres either way, and what stands there.
    const panel = (cx: number, cz: number, half: number, title: string, extra: string[]): string => {
      const out: string[] = [
        `<svg x="0" y="0" viewBox="${(cx - half).toFixed(1)} ${(cz - half).toFixed(1)} ${(2 * half).toFixed(1)} ${(2 * half).toFixed(1)}" width="640" height="640">`,
        `<rect x="${cx - half}" y="${cz - half}" width="${2 * half}" height="${2 * half}" fill="#dcc79f"/>`,
      ];
      const band = (l0: number, l1: number, fill: string): void => {
        const left: string[] = [];
        const right: string[] = [];
        for (let s = 0; s <= track.lengthM; s += 1) {
          left.push(ring(s, l1));
          right.push(ring(s, l0));
        }
        out.push(`<polygon points="${[...left, ...right.reverse()].join(' ')}" fill="${fill}"/>`);
      };
      band(-(hw + RUNOFF_M), hw + RUNOFF_M, '#cfb88c');
      band(-hw, hw, '#5b5b5e');
      const line = (lateral: number, style: string): void => {
        const points: string[] = [];
        for (let s = 0; s <= track.lengthM; s += 1) points.push(ring(s, lateral));
        out.push(`<polyline points="${points.join(' ')}" fill="none" ${style}/>`);
      };
      line(-hw, 'stroke="#fff" stroke-width="0.12"');
      line(hw, 'stroke="#fff" stroke-width="0.12"');
      line(0, 'stroke="#9ad" stroke-width="0.1" stroke-dasharray="1 1"');
      out.push(...extra);
      for (const solid of solids) out.push(solid.svg);
      if (driven.length > 0) {
        const points: string[] = [];
        for (let i = 0; i < driven.length; i += 2) points.push(`${driven[i]!.toFixed(2)},${driven[i + 1]!.toFixed(2)}`);
        out.push(`<polyline points="${points.join(' ')}" fill="none" stroke="#1f9e3a" stroke-width="0.25"/>`);
      }
      out.push(`<text x="${(cx - half + 1).toFixed(1)}" y="${(cz - half + 2.5).toFixed(1)}" font-size="${(half / 26).toFixed(2)}" font-family="sans-serif" fill="#111">${title}</text>`);
      out.push('</svg>');
      return out.join('\n');
    };
    // The chicane: its middle, the straight cuts it closes (entry asphalt edge to exit asphalt edge).
    const chicane = trackChicanes(track)[0]!;
    const mid = track.sampleAt(chicane.startS + chicane.length / 2);
    const cuts: string[] = [];
    for (const [l0, l1] of [
      [-hw, -hw],
      [hw, hw],
      [-hw, hw],
      [hw, -hw],
    ] as const) {
      cuts.push(`<polyline points="${ring(chicane.startS - 12, l0)} ${ring(chicane.startS + chicane.length + 12, l1)}" fill="none" stroke="#d0312d" stroke-width="0.15" stroke-dasharray="0.8 0.5"/>`);
    }
    const mine = chicaneBlockers(track).filter((b) => b.chicane === 0);
    const blockerNote = mine
      .map((b) => {
        const p = track.project(b.x, b.z, b.s);
        return `${b.kind} ${(Math.abs(p.lateral) - hw - b.radius).toFixed(1)} m past the edge at its middle`;
      })
      .join(', ');
    const chicaneHalf = chicane.length / 2 + 14;
    // The gate: the first checkpoint's.
    const gateS = track.checkpoints[0]!;
    const gateAt = track.sampleAt(gateS);
    const posts = checkpointGates(track).filter((box) => box.gate === 0 && box.part === 'post');
    const postNote = posts
      .map((box) => `${(Math.abs(box.lateral) - box.halfX - hw).toFixed(2)} m`)
      .join(' and ');
    const svgPath = `build/race/gates-anticut-${seed}.svg`;
    writeFileSync(
      svgPath,
      [
        '<svg xmlns="http://www.w3.org/2000/svg" width="1300" height="700" viewBox="0 0 1300 700">',
        '<rect width="1300" height="700" fill="#fff"/>',
        `<text x="10" y="18" font-size="13" font-family="sans-serif">seed ${seed} ${track.id}: collider footprints read back from Rapier (red posts, yellow beam, brown rock, dark log), asphalt edges white, centreline dashed blue, autopilot's driven line green, straight cuts red dashed</text>`,
        `<text x="10" y="36" font-size="13" font-family="sans-serif">colliders: ${[...counts.entries()].map(([k, n]) => `${n} ${k}`).join(', ')}; chicane 0: ${blockerNote}; gate 1 posts' inner faces ${postNote} beyond the asphalt edge</text>`,
        `<g transform="translate(10 50)">${panel(mid.x, mid.z, chicaneHalf, `chicane 0, ${chicane.length.toFixed(0)} m`, cuts)}</g>`,
        `<g transform="translate(655 50)">${panel(gateAt.x, gateAt.z, 14, `gate 1 at ${gateS.toFixed(0)} m`, [])}</g>`,
        '</svg>',
      ].join('\n'),
    );
    console.log(`proof: ${svgPath} (${[...counts.entries()].map(([k, n]) => `${n} ${k}`).join(', ')} collider(s) read back)`);
  }
}

/** The convex hull of points as an SVG points list (monotone chain). */
function convexHull(xs: readonly number[], zs: readonly number[]): string {
  const points = xs.map((x, i) => [x, zs[i]!] as const).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o: readonly [number, number], a: readonly [number, number], b: readonly [number, number]): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: (readonly [number, number])[] = [];
  for (const p of points) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: (readonly [number, number])[] = [];
  for (const p of [...points].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)].map((p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`).join(' ');
}

console.log(failures === 0 ? '\nall race track checks passed' : `\n${failures} race track check(s) FAILED`);
if (failures > 0) process.exitCode = 1;
