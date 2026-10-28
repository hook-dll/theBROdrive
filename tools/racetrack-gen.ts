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
 *    or esses counts once), most with a hairpin, most banked into a corner by 7% or
 *    more and rising 3 m or more;
 *  - DRESSED: no two paint quads overlap (a curb or the chequers cut the edge line
 *    under them), and every chicane is CLOSED — each straight cut from the entry
 *    straight's asphalt to the exit straight's, at any pair of laterals, meets the solid
 *    core of a rock or log (`chicaneBlockers`), and none stays on the asphalt — while
 *    every blocker stands 1.5 m or more clear of the asphalt;
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
 * centreline coloured by height.
 */

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
import { chicaneBlockers, RaceTrackProvider, trackChicanes, trackPaintRects, TRACK_LIFT_M, type TrackPaintRect } from '../src/world/racetrack/mesh';
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
/** Longest a build step may hold the main thread, and the mean placement's budget, ms. */
const STEP_BUDGET_MS = 4;
const PLACE_BUDGET_MS = 60;

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
  '\n seed post    km  lap m feat hp ch es  elev  bank°  offc° grade  asph grav dirt  corners                   place ms step ms build ms',
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
      `${degrees(st.maxBank).toFixed(1).padStart(6)} ${degrees(st.maxOffCamber).toFixed(1).padStart(6)} ${(st.maxGrade * 100).toFixed(1).padStart(5)}% ` +
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
  if (track.stats.elevationM >= 3) withHill++;
  if (track.stats.maxOffCamber > 0.01) withOffCamber++;
  if (track.stats.maxBank >= 0.07) withBank++;
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
check(
  'every lap mixes surfaces, most have real banking and height',
  mixed === rows.length && withBank >= rows.length * 0.6 && withHill >= rows.length * 0.6,
  `${mixed} mixed, ${withBank} banked to 7% (${degrees(0.07).toFixed(1)}°)+, ${withOffCamber} with an off-camber corner, ` +
    `${withHill} rising 3 m+; piece kinds seen: ${[...kinds].sort().join(', ')}`,
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
  track.checkpoints.forEach((s, i) => {
    out.push(`<polyline points="${ring(s, -post)} ${ring(s, post)}" stroke="#e3b21c" stroke-width="1"/>`);
    track.offsetPoint(s, post + 5, at);
    out.push(`<text x="${at.x.toFixed(1)}" y="${at.z.toFixed(1)}" font-size="7" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle" fill="#7a5c00">${i + 1}</text>`);
  });
  for (const b of chicaneBlockers(track)) {
    if (b.kind === 'rock') {
      out.push(`<circle cx="${b.x.toFixed(2)}" cy="${b.z.toFixed(2)}" r="${b.radius.toFixed(2)}" fill="#815f42" stroke="#4a3624" stroke-width="0.15"/>`);
    } else {
      const ux = Math.cos(b.yaw) * b.halfLength;
      const uz = -Math.sin(b.yaw) * b.halfLength;
      out.push(`<line x1="${(b.x - ux).toFixed(2)}" y1="${(b.z - uz).toFixed(2)}" x2="${(b.x + ux).toFixed(2)}" y2="${(b.z + uz).toFixed(2)}" stroke="#6e5a3c" stroke-width="${(2 * b.solid + 0.2).toFixed(2)}" stroke-linecap="round"/>`);
    }
  }
  caption.forEach((line, i) => {
    out.push(`<text x="${(x0 + 6).toFixed(1)}" y="${(z0 + 11 * (i + 1)).toFixed(1)}" font-size="8.5" font-family="sans-serif" fill="#222">${line}</text>`);
  });
  out.push('</svg>');
  return out.join('\n');
}

mkdirSync('build/race', { recursive: true });
const plotted = SEEDS.map((seed) => rows.find((row) => row.seed === seed)).filter((row): row is Row => row !== undefined);
for (const row of rows) if (plotted.length < 3 && !plotted.includes(row)) plotted.push(row);
const plots: string[] = [];
for (const { seed, track } of plotted.slice(0, 3)) {
  const st = track.stats;
  const corners = Object.entries(st.corners).map(([kind, n]) => `${n} ${kind}`).join(', ');
  const path = `build/race/track-${seed}-${track.postIndex}.svg`;
  writeFileSync(
    path,
    trackSvg(track, [
      `seed ${seed}, post ${track.postIndex}: ${track.lengthM.toFixed(0)} m, ${featureCount(track)} corner features`,
      corners,
      `elevation ${st.elevationM.toFixed(1)} m, grade ${(st.maxGrade * 100).toFixed(1)}%, bank ${degrees(st.maxBank).toFixed(1)}°, ` +
        `off-camber ${degrees(st.maxOffCamber).toFixed(1)}°, tightest ${st.minRadiusM.toFixed(0)} m`,
    ]),
  );
  plots.push(path);
}
console.log(`\nplots: ${plots.join(', ')}`);

console.log(failures === 0 ? '\nall race track checks passed' : `\n${failures} race track check(s) FAILED`);
if (failures > 0) process.exitCode = 1;
