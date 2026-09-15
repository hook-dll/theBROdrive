/**
 * tools/verge-furniture.ts
 *
 * Does the verge actually change, and does it change without breaking anything?
 *
 * The variety director (`src/world/director.ts`) promises that something in view
 * changes every two or three kilometres. Three of the things it schedules live on the
 * verge: runs of reflector posts, graded tracks leaving the road for the desert, and
 * clusters of poles doing something other than standing there. A schedule that fires
 * and produces nothing is worse than no schedule, and anything placed beside a road is
 * one bad number away from floating, sinking, or lying across a lane.
 *
 * So this drives the REAL `Road`, `Terrain`, `DelineatorProvider`, `SidetrackProvider`
 * and `PoleProvider` in Node and measures:
 *
 *   - every delineator post: how far it stands from the LOCAL asphalt edge, how far
 *     off the drawn ground it sits, the gaps between its run's stations, and whether a
 *     'delineators' event is scheduled where it stands at all;
 *   - every sidetrack: one track per event, on the event's side, starting on the
 *     shoulder, running the distance it was asked for, and — the failure that matters
 *     — every single vertex a couple of centimetres above the terrain MESH rather than
 *     buried in a drawn dune or floating over a drawn dip;
 *   - every pole in an anomaly cluster: that the cluster REPLACED the era's poles
 *     rather than joining them (same count, same stations, to a millionth of a metre),
 *     that it stops at the event's span, and that a pole lying in the sand fell AWAY
 *     from the carriageway;
 *   - and that a chunk rebuilt from scratch reproduces all of it exactly, because
 *     chunks stream out and back in constantly.
 *
 *   npx tsx tools/verge-furniture.ts [seed]
 *
 * Nothing here is part of the game bundle.
 */

import * as THREE from 'three';

import type RAPIER from '@dimforge/rapier3d-compat';

import { FIXED_DT, PhysicsWorld } from '../src/core/physics';
import type { GameWorld } from '../src/game/state';
import { CHUNK_LENGTH, type ChunkContent, type ChunkContext } from '../src/world/chunks';
import { DebrisField } from '../src/world/debris';
import { WorldOrigin } from '../src/world/origin';
import { varietyEventOfKindAt, varietyEventsBetween } from '../src/world/director';
import { poleConditionAt, poleEraSegments } from '../src/world/gradient';
import {
  DELINEATOR_EMBED,
  DELINEATOR_GAP_MAX,
  DELINEATOR_GAP_MIN,
  DELINEATOR_HEIGHT,
  DELINEATOR_SETBACK_M,
  DERELICT_SINK_M,
  DelineatorProvider,
  PoleProvider,
  createPoleDisplay,
  poleAnomalyAt,
  poleDerelictAt,
  type PoleAnomaly,
} from '../src/world/props';
import { Road } from '../src/world/road';
import { RoadDistance } from '../src/world/roaddistance';
import {
  SIDETRACK_LIFT,
  SIDETRACK_START_SETBACK,
  SidetrackProvider,
  sidetrackPlan,
} from '../src/world/sidetrack';
import { Terrain } from '../src/world/terrain';
import { drawnGroundY } from '../src/world/terrainmesh';
import { installDocumentShim } from './domshim';

installDocumentShim();

const SEEDS = [1, 7, 42, 1337];
if (Number.isFinite(Number(process.argv[2]))) SEEDS.push(Number(process.argv[2]) >>> 0);

/** Road scanned for the census, in chunks. 60 km a seed. */
const SCAN_CHUNKS = 300;

/**
 * Authored setback of the pole line, metres from the asphalt edge. Declared here and
 * not imported, deliberately: the expected pole stations are the INDEPENDENT side of
 * the comparison, so they are rebuilt from the era schedule and the authored figure
 * rather than from the function under test. See `tools/roadside-setback.ts`.
 */
const POLE_SETBACK_M = 3.1;

/**
 * Slack on anything reconstructed by `road.project`. The projection refines an
 * arclength numerically and the half-width it is measured against moves with `s`, so
 * a lateral offset put in and read back out does not come back bit-exact — the same
 * reason `tools/bird-perch.ts` carries a verge tolerance.
 */
const LATERAL_TOLERANCE = 0.35;
/** Slack on a station spacing recovered the same way. */
const SPACING_TOLERANCE = 1.0;
/**
 * How far a post's foot or a ribbon vertex may sit off the ground height read back for
 * its own REPROJECTED frame. Eight centimetres: the reprojected arclength samples the
 * wheel-scale ripple band a few centimetres from where the builder sampled it, and out
 * where the mesh's lateral rings are tens of metres apart the reprojected lateral also
 * lands a little way along the drawn chord.
 */
const GROUND_TOLERANCE = 0.08;
/**
 * Grace either side of a run's span when asking whether a post is scheduled.
 *
 * A run's first and last stations sit exactly ON the span boundary and 'delineators'
 * has no ramp, so a station recovered through the projection lands a few centimetres
 * outside the span it belongs to about half the time. One metre distinguishes that
 * from a post standing in open road, which is what the check is for.
 */
const EVENT_EDGE_GRACE = 1;
/**
 * The collider's centre above the post's foot, rebuilt from the AUTHORED geometry
 * rather than imported from the builder: the expectation is the independent side of
 * the comparison, so a builder that moved its own collider and its own idea of where
 * it went would still fail here.
 */
const DELINEATOR_COLLIDER_CENTRE_Y = (DELINEATOR_HEIGHT - DELINEATOR_EMBED) * 0.5;
/** What `DebrisField` writes into an instance it has blanked. */
const BLANK_MATRIX_FOR_TEST = new THREE.Matrix4().makeScale(0, 0, 0);

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(52)} ${detail}`);
}

interface World {
  readonly seed: number;
  readonly road: Road;
  readonly terrain: Terrain;
  readonly roadDistance: RoadDistance;
}

function makeWorld(seed: number): World {
  const road = new Road(seed);
  return { seed, road, terrain: new Terrain(seed, road), roadDistance: new RoadDistance(road) };
}

function contextFor(world: World, chunkIndex: number): ChunkContext {
  return {
    chunkIndex,
    sStart: chunkIndex * CHUNK_LENGTH,
    sEnd: (chunkIndex + 1) * CHUNK_LENGTH,
    road: world.road,
    terrain: world.terrain,
    physics: null,
    world: { seed: world.seed },
    hasPhysics: false,
    originX: 0,
    originZ: 0,
  } as unknown as ChunkContext;
}

/** Every instance transform of an InstancedMesh, in world space. */
function instanceTransforms(mesh: THREE.InstancedMesh): THREE.Matrix4[] {
  const out: THREE.Matrix4[] = [];
  for (let i = 0; i < mesh.count; i++) {
    const matrix = new THREE.Matrix4();
    mesh.getMatrixAt(i, matrix);
    out.push(matrix);
  }
  return out;
}

function matricesOf(mesh: THREE.InstancedMesh): number[] {
  const out: number[] = [];
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, matrix);
    out.push(...matrix.elements);
  }
  return out;
}

/** Scheduled somewhere inside `[s - grace, s + grace]`, for a kind with no ramp. */
function runCoversStation(seed: number, s: number): boolean {
  return (
    varietyEventOfKindAt(seed, 'delineators', s) !== null ||
    varietyEventOfKindAt(seed, 'delineators', s - EVENT_EDGE_GRACE) !== null ||
    varietyEventOfKindAt(seed, 'delineators', s + EVENT_EDGE_GRACE) !== null
  );
}

// ===========================================================================
// Delineators
// ===========================================================================

console.log('=== delineators ===\n');

let posts = 0;
let worstBandError = 0;
let worstFieldFloat = 0;
let worstMeshFloat = 0;
let postsOffBand = 0;
let postsOffGround = 0;
let postsWithoutEvent = 0;
let chipMismatches = 0;
let postsFacingAway = 0;
let postsCantedOut = 0;
let worstAim = 0;
let worstCant = Infinity;
let runsSeen = 0;
let runsExpected = 0;
let spacingsChecked = 0;
let worstSpacing = 0;
let bestSpacing = Infinity;
let spacingsOutOfRange = 0;
let layoutBoth = 0;
let layoutAlternating = 0;
let layoutSingle = 0;

for (const seed of SEEDS) {
  const world = makeWorld(seed);
  const provider = new DelineatorProvider(world.roadDistance);
  /** Station arclengths per event index, so gaps survive a chunk seam. */
  const stationsByEvent = new Map<number, number[]>();
  const sidesByEvent = new Map<number, Set<number>>();
  const postsByEvent = new Map<number, number>();

  for (let chunk = 0; chunk < SCAN_CHUNKS; chunk++) {
    const ctx = contextFor(world, chunk);
    const content = provider.build(ctx);
    if (!content) continue;
    const meshes = content.group.children.filter(
      (child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh,
    );
    // ONE instanced mesh per chunk that has posts at all — blade and reflector chip
    // are two material GROUPS of one geometry, so a chip cannot hang in the air beside
    // its own post, which is why this is measured rather than assumed. Two meshes here
    // would mean the merge had been undone, and the break would blank only one of them.
    if (meshes.length === 1) {
      const material = meshes[0]!.material;
      if (!Array.isArray(material) || material.length !== 2) chipMismatches++;
    } else {
      chipMismatches++;
    }

    const hint = (ctx.sStart + ctx.sEnd) * 0.5;
    for (const transform of instanceTransforms(meshes[0]!)) {
      posts++;
      const p = new THREE.Vector3().setFromMatrixPosition(transform);
      const projection = world.road.project(p.x, p.z, hint);
      const clearance = Math.abs(projection.lateral) - world.road.halfWidthAt(projection.s);
      const bandError = Math.abs(clearance - DELINEATOR_SETBACK_M);
      if (bandError > worstBandError) worstBandError = bandError;
      if (bandError > LATERAL_TOLERANCE) postsOffBand++;

      // WHERE THE REFLECTOR LOOKS. The chip sits on the post's local +Z face, so the
      // instance's own +Z is its aim: it must point back DOWN the road at traffic that
      // has not arrived (negative along the tangent) and be canted IN over the
      // carriageway (positive along the inward normal). A post reflecting into the
      // desert is a post nobody ever sees lit, which no still image would reveal.
      const sample = world.road.sampleAt(projection.s);
      const aim = new THREE.Vector3(0, 0, 1).applyQuaternion(
        new THREE.Quaternion().setFromRotationMatrix(transform),
      );
      const alongTangent = aim.x * Math.sin(sample.heading) + aim.z * Math.cos(sample.heading);
      const side = Math.sign(projection.lateral);
      const inward = aim.x * -side * Math.cos(sample.heading) + aim.z * side * Math.sin(sample.heading);
      if (alongTangent >= 0) postsFacingAway++;
      if (inward <= 0) postsCantedOut++;
      if (alongTangent < worstAim) worstAim = alongTangent;
      if (inward < worstCant) worstCant = inward;

      // Twice, against two different surfaces, because they answer different
      // questions: the height FIELD is what the builder sampled, and the MESH is what
      // the player sees the post standing on. A post has to be on both.
      const field = world.terrain.heightFromFrame(p.x, p.z, projection.lateral, projection.s);
      const mesh = drawnGroundY(
        world.road,
        world.terrain,
        world.roadDistance,
        projection.s,
        projection.lateral,
      );
      if (Math.abs(p.y - field) > worstFieldFloat) worstFieldFloat = Math.abs(p.y - field);
      if (Math.abs(p.y - mesh) > worstMeshFloat) worstMeshFloat = Math.abs(p.y - mesh);
      if (Math.abs(p.y - field) > GROUND_TOLERANCE || Math.abs(p.y - mesh) > GROUND_TOLERANCE) {
        postsOffGround++;
      }

      if (!runCoversStation(seed, projection.s)) {
        postsWithoutEvent++;
        continue;
      }
      const event =
        varietyEventOfKindAt(seed, 'delineators', projection.s) ??
        varietyEventOfKindAt(seed, 'delineators', projection.s - EVENT_EDGE_GRACE) ??
        varietyEventOfKindAt(seed, 'delineators', projection.s + EVENT_EDGE_GRACE)!;
      let stations = stationsByEvent.get(event.index);
      if (!stations) {
        stations = [];
        stationsByEvent.set(event.index, stations);
        sidesByEvent.set(event.index, new Set());
        postsByEvent.set(event.index, 0);
      }
      // One station can carry two posts (a both-sides run), so stations are deduped
      // before the gaps are measured or every second gap would read as zero.
      if (!stations.some((value) => Math.abs(value - projection.s) < 1)) stations.push(projection.s);
      sidesByEvent.get(event.index)!.add(Math.sign(projection.lateral));
      postsByEvent.set(event.index, postsByEvent.get(event.index)! + 1);
    }
    content.dispose?.();
  }

  // Spacing and layout, for every run whose whole span was inside the scanned road: a
  // run clipped by the end of the scan is missing a station, and its last gap would
  // read as double.
  const scanEnd = SCAN_CHUNKS * CHUNK_LENGTH;
  for (const event of varietyEventsBetween(seed, 0, scanEnd)) {
    if (event.kind !== 'delineators') continue;
    if (event.s - event.halfLength < 0 || event.s + event.halfLength > scanEnd) continue;
    runsExpected++;
    const stations = stationsByEvent.get(event.index);
    if (!stations || stations.length === 0) continue;
    runsSeen++;

    // Which of the three layouts the roll chose, read back off the result: one side
    // only, or two sides — and if two, whether a single station carries both posts.
    if (sidesByEvent.get(event.index)!.size === 1) layoutSingle++;
    else if (postsByEvent.get(event.index)! >= stations.length * 1.8) layoutBoth++;
    else layoutAlternating++;

    stations.sort((a, b) => a - b);
    for (let i = 1; i < stations.length; i++) {
      const gap = stations[i]! - stations[i - 1]!;
      spacingsChecked++;
      if (gap > worstSpacing) worstSpacing = gap;
      if (gap < bestSpacing) bestSpacing = gap;
      if (gap < DELINEATOR_GAP_MIN - SPACING_TOLERANCE || gap > DELINEATOR_GAP_MAX + SPACING_TOLERANCE) {
        spacingsOutOfRange++;
      }
    }
  }
}

console.log(
  `  ${posts} posts over ${SEEDS.length} seeds x ${(SCAN_CHUNKS * CHUNK_LENGTH) / 1000} km, ` +
    `${DELINEATOR_HEIGHT} m tall\n` +
    `  band error worst ${worstBandError.toFixed(3)} m against a ${DELINEATOR_SETBACK_M} m setback\n` +
    `  foot off the height field worst ${worstFieldFloat.toFixed(3)} m, ` +
    `off the drawn mesh worst ${worstMeshFloat.toFixed(3)} m\n` +
    `  station gaps ${bestSpacing.toFixed(1)}-${worstSpacing.toFixed(1)} m over ${spacingsChecked} gaps\n` +
    `  reflector aim: worst ${worstAim.toFixed(2)} along the tangent (must be negative), ` +
    `worst ${worstCant.toFixed(2)} inward (must be positive)\n` +
    `  layouts: ${layoutBoth} both-sides, ${layoutAlternating} alternating, ${layoutSingle} single-sided\n`,
);

check('posts appear at all', posts > 0, `${posts} posts`);
check(
  'every post stands in the intended band',
  postsOffBand === 0,
  `${postsOffBand} of ${posts} outside ${DELINEATOR_SETBACK_M} +/- ${LATERAL_TOLERANCE} m`,
);
check(
  'no post floats or is buried',
  postsOffGround === 0,
  `${postsOffGround} of ${posts} more than ${GROUND_TOLERANCE} m off the ground`,
);
check(
  'no post stands where no run is scheduled',
  postsWithoutEvent === 0,
  `${postsWithoutEvent} of ${posts} outside a 'delineators' event`,
);
check(
  'every scheduled run produced posts',
  runsSeen === runsExpected && runsExpected > 0,
  `${runsSeen}/${runsExpected} runs`,
);
check(
  'every station gap is in range',
  spacingsOutOfRange === 0,
  `${spacingsOutOfRange} of ${spacingsChecked} outside ${DELINEATOR_GAP_MIN}-${DELINEATOR_GAP_MAX} m`,
);
check('reflectors ride their own posts', chipMismatches === 0, `${chipMismatches} chunks with a transform mismatch`);
check(
  'every reflector faces oncoming travel',
  postsFacingAway === 0 && postsCantedOut === 0,
  `${postsFacingAway} facing downroad, ${postsCantedOut} canted at the desert`,
);
check(
  'all three layouts occur',
  layoutBoth > 0 && layoutAlternating > 0 && layoutSingle > 0,
  `${layoutBoth}/${layoutAlternating}/${layoutSingle}`,
);

// ===========================================================================
// A post is solid, and it comes apart
// ===========================================================================

/*
 * The two halves of one decision, and they only work together. A post with no
 * collider is a lie the first time a car drives through one; a post with a collider
 * and nothing else is a worse lie, because two tonnes at ninety would be stopped by
 * twelve centimetres of plastic. So this measures both: that the collider is built
 * exactly where the post is drawn and ONLY inside the physics window, and that a car
 * clipping one takes the post to pieces and keeps going.
 *
 * The break runs through the REAL `DebrisField` against a REAL Rapier world, because
 * the interesting failure is not "does the code path exist" — it is whether the
 * collider that the post registered is the one that gets switched off, and whether
 * the instance that gets blanked is the instance the post is drawn at.
 */

console.log('\n=== a post is solid, and it comes apart ===\n');

{
  const SEED = 1337;
  const world = makeWorld(SEED);
  const physics = await PhysicsWorld.create();
  const scene = new THREE.Scene();
  const origin = new WorldOrigin();
  /** The flattened list a save would hand back, filled by `apply`. */
  const flattened: number[] = [];
  const fakeWorld = {
    state: { seed: SEED, flattenedProps: flattened },
    apply: (action: { t: string; propId?: number }): void => {
      if (action.t === 'prop_flatten' && typeof action.propId === 'number') {
        flattened.push(action.propId);
      }
    },
  } as unknown as GameWorld;
  const debris = new DebrisField(physics, fakeWorld, scene, origin);
  const provider = new DelineatorProvider(world.roadDistance, debris);

  // The tool's own context helper, with a physics world behind it. `hasPhysics` is
  // true for a band of chunks around the run and false outside it, which is what the
  // streamer does (PHYSICS_RADIUS), so the two cases are measured against each other
  // rather than against a constant typed twice.
  const physicsContext = (chunkIndex: number, hasPhysics: boolean): ChunkContext =>
    ({
      chunkIndex,
      sStart: chunkIndex * CHUNK_LENGTH,
      sEnd: (chunkIndex + 1) * CHUNK_LENGTH,
      road: world.road,
      terrain: world.terrain,
      physics,
      world: { seed: SEED },
      hasPhysics,
      originX: 0,
      originZ: 0,
    }) as unknown as ChunkContext;

  // Find a run to hit by asking the director, so nothing here depends on a hand-picked
  // kilometre that a future reweighting of the schedule would move out from under it.
  let runChunk = -1;
  for (let chunk = 0; chunk < SCAN_CHUNKS && runChunk < 0; chunk++) {
    if (varietyEventOfKindAt(SEED, 'delineators', (chunk + 0.5) * CHUNK_LENGTH)) runChunk = chunk;
  }
  if (runChunk < 0) throw new Error('no delineator run in the scanned road');

  const matrix = new THREE.Matrix4();
  const instanceAt = (mesh: THREE.InstancedMesh, i: number): THREE.Vector3 => {
    mesh.getMatrixAt(i, matrix);
    return new THREE.Vector3().setFromMatrixPosition(matrix);
  };

  let solidPosts = 0;
  let collidersOutsideWindow = 0;
  let countMismatches = 0;
  let misplaced = 0;
  let worstColliderOffset = 0;
  /** One post, unmoved and unbroken, to be hit below. */
  let target: {
    id: number;
    index: number;
    mesh: THREE.InstancedMesh;
    collider: RAPIER.Collider;
    x: number;
    y: number;
    z: number;
    content: ChunkContent;
    ctx: ChunkContext;
  } | null = null;

  for (let chunk = runChunk - 3; chunk <= runChunk + 3; chunk++) {
    if (chunk < 0) continue;
    const hasPhysics = chunk >= runChunk - 2 && chunk <= runChunk + 2;
    const ctx = physicsContext(chunk, hasPhysics);
    const content = provider.build(ctx);
    if (!content) continue;
    const mesh = content.group.children.find(
      (child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh,
    )!;

    if (!hasPhysics) {
      // Scenery and nothing else: no body, no collider, no registry entry.
      collidersOutsideWindow += content.colliders.length + content.bodies.length;
      content.dispose?.();
      continue;
    }


    if (content.colliders.length !== mesh.count) countMismatches++;
    solidPosts += content.colliders.length;

    for (let i = 0; i < content.colliders.length; i++) {
      const collider = content.colliders[i]!;
      const t = collider.translation();
      const instance = instanceAt(mesh, i);
      // A collider is placed at the CENTRE of the standing blade, so it sits half a
      // blade above the instance's foot — and on the same XZ, to the millimetre. A
      // capsule at the foot would leave the top of the post passable, which is the
      // failure a count alone would not catch.
      const dx = Math.abs(t.x - instance.x);
      const dz = Math.abs(t.z - instance.z);
      const dy = Math.abs(t.y - instance.y - DELINEATOR_COLLIDER_CENTRE_Y);
      const offset = Math.max(dx, dz, dy);
      if (offset > worstColliderOffset) worstColliderOffset = offset;
      if (offset > 0.01) misplaced++;
      if (!target) {
        target = {
          id: 0,
          index: i,
          mesh,
          collider,
          x: t.x,
          y: instance.y,
          z: t.z,
          content,
          ctx,
        };
      }
    }
    // The whole window is censused, not just the chunk the target came from: a run
    // that is solid in one chunk and scenery in the next is exactly the failure a
    // single sample would miss.
    if (content !== target?.content) content.dispose?.();
  }

  check(
    'a post inside the physics window is solid',
    solidPosts > 0,
    `${solidPosts} colliders over the run's physics chunks`,
  );
  check(
    'a post outside it costs nothing',
    collidersOutsideWindow === 0,
    `${collidersOutsideWindow} bodies or colliders outside the window`,
  );
  check(
    'one collider per post, every post',
    countMismatches === 0,
    `${countMismatches} chunks where the counts disagree`,
  );
  check(
    'the collider is where the blade is drawn',
    misplaced === 0,
    `worst disagreement ${worstColliderOffset.toFixed(4)} m`,
  );

  if (!target) throw new Error('no post carrying a collider to hit');

  // The hit. A car-sized sweep centred on the post: the debris field tests the whole
  // chassis rectangle from its previous fixed-step centre, so a post inside the box
  // at either end is a contact.
  const impactor = {
    x: target.x,
    y: target.y,
    z: target.z,
    fx: 1,
    fz: 0,
    halfWidth: 0.9,
    halfLength: 1.1,
    vx: 25,
    vy: 0,
    vz: 0,
  };
  const piecesBefore = debris.liveCount;
  debris.update(impactor, 1 / 60, 0, 0);
  const piecesAfter = debris.liveCount;

  target.mesh.getMatrixAt(target.index, matrix);
  const blanked = matrix.equals(BLANK_MATRIX_FOR_TEST);

  check(
    'clipping a post takes it to pieces',
    piecesAfter - piecesBefore >= 3,
    `${piecesAfter - piecesBefore} pieces spawned`,
  );
  check(
    'and the post stops being solid',
    !target.collider.isEnabled(),
    target.collider.isEnabled() ? 'collider still enabled' : 'collider disabled',
  );
  check(
    'and stops being drawn, reflector included',
    blanked,
    blanked ? 'instance blanked' : 'instance still drawn',
  );
  check(
    'and the flattening is recorded for the save',
    flattened.length === 1,
    `${flattened.length} ids flattened`,
  );

  // A rebuild must not put it back. This is the whole reason the id exists: a post
  // knocked down on the way out has to stay down on the way back, from a save that
  // carries nothing but a number.
  const rebuilt = new DebrisField(physics, fakeWorld, scene, origin);
  const rebuiltProvider = new DelineatorProvider(world.roadDistance, rebuilt);
  const after = rebuiltProvider.build(target.ctx)!;
  const afterMesh = after.group.children.find(
    (child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh,
  )!;
  let survived = false;
  for (let i = 0; i < afterMesh.count; i++) {
    const at = instanceAt(afterMesh, i);
    if (Math.hypot(at.x - target.x, at.z - target.z) < 0.01) survived = true;
  }
  check(
    'a post already down is not rebuilt',
    !survived && afterMesh.count === target.mesh.count - 1,
    `${afterMesh.count} posts against ${target.mesh.count} before`,
  );

  target.content.dispose?.();
  after.dispose?.();
}

// ===========================================================================
// Sidetracks
// ===========================================================================

console.log('\n=== sidetracks ===\n');

let tracks = 0;
let tracksWrongSide = 0;
let tracksOnAsphalt = 0;
let tracksOverLength = 0;
let tracksTooShort = 0;
let tracksCurveCapped = 0;
let verticesChecked = 0;
let verticesOffGround = 0;
let worstVertexLift = 0;
let bestVertexLift = Infinity;
let worstStartError = 0;
let worstWalkError = 0;
let trackCountWrong = 0;
let worstNormalY = Infinity;
const lengths: number[] = [];

for (const seed of SEEDS) {
  const world = makeWorld(seed);
  const provider = new SidetrackProvider(world.roadDistance);
  const scanEnd = SCAN_CHUNKS * CHUNK_LENGTH;
  const events = varietyEventsBetween(seed, 0, scanEnd).filter((event) => event.kind === 'sidetrack');

  for (const event of events) {
    const chunk = Math.floor(event.s / CHUNK_LENGTH);
    // Build the owning chunk AND its neighbours: exactly as many ribbons as there are
    // events in the three chunks may exist, or a streamed-in neighbour is drawing a
    // second copy of this track over the top of the first.
    let meshes = 0;
    let owner: THREE.Mesh | null = null;
    for (let c = chunk - 1; c <= chunk + 1; c++) {
      if (c < 0) continue;
      const content = provider.build(contextFor(world, c));
      if (!content) continue;
      for (const child of content.group.children) {
        if (!(child instanceof THREE.Mesh)) continue;
        meshes++;
        if (c === chunk) owner = child;
      }
      // The owning chunk's geometry is read below, so only the neighbours go now.
      if (c !== chunk) content.dispose?.();
    }
    const neighbourEvents = varietyEventsBetween(
      seed,
      Math.max(0, (chunk - 1) * CHUNK_LENGTH),
      (chunk + 2) * CHUNK_LENGTH,
    ).filter((other) => other.kind === 'sidetrack').length;
    if (meshes !== neighbourEvents || !owner) {
      trackCountWrong++;
      continue;
    }
    tracks++;

    const plan = sidetrackPlan(seed, world.road, event);
    lengths.push(plan.length);
    if (plan.length > plan.requested + 1e-6) tracksOverLength++;
    if (plan.length < 30) tracksTooShort++;
    if (plan.length < plan.requested - 1) tracksCurveCapped++;

    // The plan's realised length against the polyline it says it walked: the path is
    // integrated station by station in the road frame and measured in world space, so
    // this is the check that the two descriptions of the same track agree.
    let walk = 0;
    for (let i = 1; i < plan.stations.length; i++) {
      const a = plan.stations[i - 1]!;
      const b = plan.stations[i]!;
      const pa = world.road.offsetPoint(a.s, a.lateral);
      const pb = world.road.offsetPoint(b.s, b.lateral);
      walk += Math.hypot(pb.x - pa.x, pb.z - pa.z);
    }
    worstWalkError = Math.max(worstWalkError, Math.abs(walk - plan.length));

    const start = plan.stations[0]!;
    worstStartError = Math.max(
      worstStartError,
      Math.abs(Math.abs(start.lateral) - world.road.halfWidthAt(start.s) - SIDETRACK_START_SETBACK),
    );

    const positions = owner.geometry.getAttribute('position') as THREE.BufferAttribute;
    // THE RIBBON HAS TO FACE THE SKY. The material is front-sided, so a triangle
    // wound the other way is not a dark ribbon, it is an INVISIBLE one — the feature
    // silently produces nothing, which is the one failure a geometry census would
    // otherwise sail straight past. The normals come from `computeVertexNormals`, so
    // their sign is the winding's sign.
    const normals = owner.geometry.getAttribute('normal') as THREE.BufferAttribute;
    for (let v = 0; v < normals.count; v++) {
      if (normals.getY(v) < worstNormalY) worstNormalY = normals.getY(v);
    }
    let sideWrong = 0;
    let onAsphalt = 0;
    for (let v = 0; v < positions.count; v++) {
      const x = positions.getX(v);
      const y = positions.getY(v);
      const z = positions.getZ(v);
      const projection = world.road.project(x, z, event.s);
      // Against the DRAWN mesh, which is the surface the ribbon has to lie on. The
      // height field is a different surface out here and being a few centimetres off
      // it would be fine; being a few centimetres into the drawn dune would not.
      const ground = drawnGroundY(
        world.road,
        world.terrain,
        world.roadDistance,
        projection.s,
        projection.lateral,
      );
      const lift = y - ground;
      verticesChecked++;
      worstVertexLift = Math.max(worstVertexLift, lift);
      bestVertexLift = Math.min(bestVertexLift, lift);
      if (Math.abs(lift - SIDETRACK_LIFT) > GROUND_TOLERANCE) verticesOffGround++;
      if (Math.sign(projection.lateral) !== event.side) sideWrong++;
      if (Math.abs(projection.lateral) <= world.road.halfWidthAt(projection.s)) onAsphalt++;
    }
    if (sideWrong > 0) tracksWrongSide++;
    if (onAsphalt > 0) tracksOnAsphalt++;
    owner.geometry.dispose();
  }
}

lengths.sort((a, b) => a - b);
const medianLength = lengths.length > 0 ? lengths[lengths.length >> 1]! : 0;
console.log(
  `  ${tracks} tracks, ${verticesChecked} vertices measured\n` +
    `  vertex lift ${bestVertexLift.toFixed(3)}-${worstVertexLift.toFixed(3)} m above the drawn mesh ` +
    `(authored ${SIDETRACK_LIFT} m)\n` +
    `  length ${lengths[0]!.toFixed(0)}-${lengths[lengths.length - 1]!.toFixed(0)} m, ` +
    `median ${medianLength.toFixed(0)} m; ${tracksCurveCapped} shortened by the lateral or curve cap\n` +
    `  junction setback error worst ${worstStartError.toFixed(6)} m, ` +
    `path/length disagreement worst ${worstWalkError.toExponential(1)} m\n` +
    `  worst vertex normal points ${worstNormalY.toFixed(2)} upward\n`,
);

check('tracks appear at all', tracks > 0, `${tracks} tracks`);
check('one event makes exactly one track', trackCountWrong === 0, `${trackCountWrong} events with the wrong count`);
check("every track is on the event's side", tracksWrongSide === 0, `${tracksWrongSide} of ${tracks} on the wrong side`);
check('no track lies on the asphalt', tracksOnAsphalt === 0, `${tracksOnAsphalt} of ${tracks} touching the paint`);
check(
  'every vertex rides the drawn terrain',
  verticesOffGround === 0,
  `${verticesOffGround} of ${verticesChecked} more than ${GROUND_TOLERANCE} m off the ${SIDETRACK_LIFT} m lift`,
);
check(
  'every ribbon triangle faces the sky',
  worstNormalY > 0.5,
  `worst normal y ${worstNormalY.toFixed(2)}`,
);
check(
  'every track starts on the shoulder',
  worstStartError < 1e-6,
  `worst junction error ${worstStartError.toFixed(6)} m`,
);
check(
  'no track runs further than it was asked to',
  tracksOverLength === 0 && worstWalkError < 1e-6,
  `${tracksOverLength} over length, worst disagreement ${worstWalkError.toExponential(1)} m`,
);
check(
  'every track runs a visible distance',
  tracksTooShort === 0 && medianLength >= 60 && medianLength <= 150,
  `median ${medianLength.toFixed(0)} m, shortest ${lengths[0]!.toFixed(0)} m`,
);

// ===========================================================================
// Pole anomalies
// ===========================================================================

console.log('\n=== pole anomalies ===\n');

interface ExpectedPole {
  readonly s: number;
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * The era schedule's own pole stations in a range, rebuilt from `poleEraSegments`.
 *
 * This is the independent side of the comparison: if an anomaly ever moved a pole,
 * added one or dropped one, these positions and the provider's would disagree.
 */
function expectedPoles(world: World, fromS: number, toS: number): ExpectedPole[] {
  const out: ExpectedPole[] = [];
  let indexBase = 0;
  for (const segment of poleEraSegments()) {
    const count = segment.spacing > 0 ? Math.floor((segment.end - segment.start) / segment.spacing) : 0;
    if (segment.start < toS && segment.end > fromS && count > 0) {
      for (let k = 0; k < count; k++) {
        const s = segment.start + (k + 0.5) * segment.spacing;
        if (s < fromS || s >= toS) continue;
        const p = world.road.offsetPoint(s, -(world.road.halfWidthAt(s) + POLE_SETBACK_M));
        out.push({ s, index: indexBase + k, x: p.x, y: world.terrain.heightAt(p.x, p.z, s), z: p.z });
      }
    }
    indexBase += count;
  }
  return out;
}

/** Pole stations in a range: the same walk, without the road queries. */
function poleStationsBetween(fromS: number, toS: number): { s: number; index: number }[] {
  const out: { s: number; index: number }[] = [];
  let indexBase = 0;
  for (const segment of poleEraSegments()) {
    const count = segment.spacing > 0 ? Math.floor((segment.end - segment.start) / segment.spacing) : 0;
    if (segment.start < toS && segment.end > fromS && count > 0) {
      const first = Math.max(0, Math.ceil((fromS - segment.start) / segment.spacing - 0.5));
      for (let k = first; k < count; k++) {
        const s = segment.start + (k + 0.5) * segment.spacing;
        if (s >= toS) break;
        if (s >= fromS) out.push({ s, index: indexBase + k });
      }
    }
    indexBase += count;
  }
  return out;
}

// -- EVERY scheduled event produces something -------------------------------
//
// The 60 km census below cannot see this case at all: pole eras are 300 km bands
// drawn from a SEED-INDEPENDENT hash stream, so every seed spends its first 300 km
// in the same era and that one is not the empty one. Roughly a band in four has no
// poles (`poleEraForBand` in gradient.ts) and an override has nothing to override
// there, so those events used to schedule a change and show nothing — 151 of 602
// over this same road. A band with no line now gets a standalone derelict instead.
//
// This is the check that matters most in this file, because it is the director's
// whole claim: over 6000 km, EVERY poleAnomaly event alters a pole line or leaves a
// derelict, and the two are mutually exclusive by construction.

const CENSUS_M = 6_000_000;
const CENSUS_SEED = 1337;
let censusEvents = 0;
let censusWithCluster = 0;
let censusWithDerelict = 0;
let censusStarved = 0;
let censusDoubled = 0;

for (const event of varietyEventsBetween(CENSUS_SEED, 0, CENSUS_M)) {
  if (event.kind !== 'poleAnomaly') continue;
  censusEvents++;
  const stations = poleStationsBetween(event.s - event.halfLength, event.s + event.halfLength);
  const cluster = stations.some(({ s, index }) => poleAnomalyAt(CENSUS_SEED, s, index) !== 'none');
  const derelict = poleDerelictAt(CENSUS_SEED, event.s) !== null;
  if (cluster && derelict) censusDoubled++;
  if (cluster) censusWithCluster++;
  else if (derelict) censusWithDerelict++;
  else censusStarved++;
}

console.log(
  `  seed ${CENSUS_SEED}, first ${CENSUS_M / 1000} km: ${censusEvents} events — ` +
    `${censusWithCluster} altered a pole line, ${censusWithDerelict} left a derelict ` +
    `where there was no line, ${censusStarved} produced nothing\n`,
);
check(
  'every scheduled event produces something',
  censusStarved === 0 && censusWithCluster + censusWithDerelict === censusEvents,
  `${censusWithCluster + censusWithDerelict}/${censusEvents} events`,
);
check(
  'a derelict never stands beside a line it could alter',
  censusDoubled === 0 && censusWithDerelict > 0,
  `${censusDoubled} events with both, ${censusWithDerelict} derelicts`,
);

/** Radians the pole's own axis is off vertical, read back off its rendered group. */
function leanOf(group: THREE.Object3D): number {
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(group.quaternion);
  return Math.acos(Math.min(1, Math.max(-1, up.y)));
}

/** Authored era heights, for the fallen-pole tip test. See POLE_HEIGHT in props.ts. */
const POLE_HEIGHT: Record<string, number> = { timber: 6.5, lattice: 8.5, concrete: 9, none: 0 };

let anomalyEvents = 0;
let anomalyEventsWithoutLine = 0;
let clustersMeasured = 0;
let clustersNotConsecutive = 0;
let clustersTooLong = 0;
let clusterOutsideSpan = 0;
let poleCountMismatches = 0;
let polePositionMismatches = 0;
let worstPoleDrift = 0;
let formsUnchanged = 0;
let downPolesMeasured = 0;
let downPolesTowardRoad = 0;
let worstDownOutwardGain = Infinity;
const variantCounts: Record<PoleAnomaly, number> = { none: 0, down: 0, wrapped: 0, nest: 0, gear: 0 };

for (const seed of SEEDS) {
  const world = makeWorld(seed);
  const provider = new PoleProvider();
  const events = varietyEventsBetween(seed, 0, SCAN_CHUNKS * CHUNK_LENGTH).filter(
    (event) => event.kind === 'poleAnomaly',
  );

  for (const event of events) {
    anomalyEvents++;
    const spanStart = event.s - event.halfLength;
    const spanEnd = event.s + event.halfLength;
    if (poleStationsBetween(spanStart, spanEnd).length === 0) {
      // No line inside this span, so the event leaves a DERELICT rather than altering
      // poles. That path has its own section below; here it would only confuse the
      // count-and-position comparison, which is about the line.
      anomalyEventsWithoutLine++;
      continue;
    }

    // A window either side of the span, so "only over its span" is measured against
    // poles that are outside it but close enough to be caught by an over-wide run.
    const firstChunk = Math.floor(Math.max(0, spanStart - 400) / CHUNK_LENGTH);
    const lastChunk = Math.floor((spanEnd + 400) / CHUNK_LENGTH);

    const built: THREE.Object3D[] = [];
    const contents = [];
    for (let chunk = firstChunk; chunk <= lastChunk; chunk++) {
      const content = provider.build(contextFor(world, chunk));
      contents.push(content);
      // A pole is a Group; wires are Meshes and the light-budget markers are lights.
      for (const child of content.group.children) if (child instanceof THREE.Group) built.push(child);
    }

    const expected = expectedPoles(world, firstChunk * CHUNK_LENGTH, (lastChunk + 1) * CHUNK_LENGTH);
    if (built.length !== expected.length) poleCountMismatches++;

    const actualSorted = [...built].sort((a, b) => a.position.x - b.position.x || a.position.z - b.position.z);
    const expectedSorted = [...expected].sort((a, b) => a.x - b.x || a.z - b.z);
    for (let i = 0; i < Math.min(actualSorted.length, expectedSorted.length); i++) {
      const actual = actualSorted[i]!;
      const want = expectedSorted[i]!;
      const drift = Math.hypot(actual.position.x - want.x, actual.position.y - want.y, actual.position.z - want.z);
      if (drift > worstPoleDrift) worstPoleDrift = drift;
      if (drift > 1e-6) polePositionMismatches++;
    }

    const claimed = expected.filter((pole) => poleAnomalyAt(seed, pole.s, pole.index) !== 'none');
    if (claimed.length === 0) {
      for (const content of contents) content.dispose?.();
      continue;
    }
    clustersMeasured++;
    const span = claimed[claimed.length - 1]!.index - claimed[0]!.index + 1;
    if (span !== claimed.length) clustersNotConsecutive++;
    if (claimed.length > 4) clustersTooLong++;

    for (const pole of claimed) {
      if (pole.s < spanStart || pole.s > spanEnd) clusterOutsideSpan++;
      const anomaly = poleAnomalyAt(seed, pole.s, pole.index);
      variantCounts[anomaly]++;

      // Form: the same pole built normally and built with its anomaly. A hung fitting
      // adds meshes; a downed pole has the same meshes and a lean no weathered pole
      // ever reaches, so both readings are needed to prove the form actually changed.
      const cond = poleConditionAt(pole.s);
      const plain = createPoleDisplay(cond, seed, pole.index, 'none');
      const altered = createPoleDisplay(cond, seed, pole.index, anomaly);
      if (!(altered.children.length > plain.children.length || leanOf(altered) > leanOf(plain) + 0.5)) {
        formsUnchanged++;
      }

      if (anomaly !== 'down') continue;
      downPolesMeasured++;
      // The one way this feature could ruin the drive: eight metres of mast lying
      // across a lane. A fallen pole's TOP must end up further from the road than its
      // base, measured through the real projection rather than trusted from the roll.
      const group = built.find(
        (candidate) =>
          Math.abs(candidate.position.x - pole.x) < 1e-6 && Math.abs(candidate.position.z - pole.z) < 1e-6,
      );
      if (!group) {
        downPolesTowardRoad++;
        continue;
      }
      const tip = new THREE.Vector3(0, POLE_HEIGHT[cond.era]!, 0)
        .applyQuaternion(group.quaternion)
        .add(group.position);
      const baseOut = Math.abs(world.road.project(pole.x, pole.z, pole.s).lateral);
      const tipOut = Math.abs(world.road.project(tip.x, tip.z, pole.s).lateral);
      if (tipOut - baseOut < worstDownOutwardGain) worstDownOutwardGain = tipOut - baseOut;
      if (tipOut <= baseOut) downPolesTowardRoad++;
    }

    for (const content of contents) content.dispose?.();
  }
}

const variantSummary = (['down', 'wrapped', 'nest', 'gear'] as const)
  .map((variant) => `${variant} ${variantCounts[variant]}`)
  .join(', ');
console.log(
  `  ${anomalyEvents} scheduled events, ${clustersMeasured} clusters measured\n` +
    `  ${anomalyEventsWithoutLine} of them had no line inside their span and left a derelict instead\n` +
    `  poles altered: ${variantSummary}\n` +
    `  fallen poles gained at least ${worstDownOutwardGain.toFixed(2)} m of clearance from the road\n` +
    `  worst pole position drift against the era schedule ${worstPoleDrift.toExponential(1)} m\n`,
);

check('clusters are found at all', clustersMeasured > 0, `${clustersMeasured} clusters`);
check('the pole count is unchanged', poleCountMismatches === 0, `${poleCountMismatches} spans with a different count`);
check(
  'every pole stands exactly where the era put it',
  polePositionMismatches === 0,
  `${polePositionMismatches} poles moved, worst ${worstPoleDrift.toExponential(1)} m`,
);
check('a cluster is consecutive poles', clustersNotConsecutive === 0, `${clustersNotConsecutive} broken runs`);
check('a cluster is at most four poles', clustersTooLong === 0, `${clustersTooLong} over-long runs`);
check('no altered pole outside its span', clusterOutsideSpan === 0, `${clusterOutsideSpan} strays`);
check('every claimed pole changed form', formsUnchanged === 0, `${formsUnchanged} unchanged`);
check(
  'every fallen pole fell away from the road',
  downPolesTowardRoad === 0 && downPolesMeasured > 0,
  `${downPolesTowardRoad} of ${downPolesMeasured} toward the carriageway`,
);
check(
  'all four variants occur',
  (['down', 'wrapped', 'nest', 'gear'] as const).every((variant) => variantCounts[variant] > 0),
  variantSummary,
);

// ===========================================================================
// Derelicts: the fallback where there is no pole line
// ===========================================================================

console.log('\n=== derelicts ===\n');

/** Start of the first era band with no poles at all. Seed-independent by design. */
function firstEmptyBandStart(): number {
  for (const segment of poleEraSegments()) if (segment.era === 'none') return segment.start;
  throw new Error('the era schedule has no empty band');
}

/** How far into an empty band to look for events to build. */
const DERELICT_PROBE_M = 60_000;

let derelictsBuilt = 0;
let derelictPartsWrong = 0;
let derelictsWrongSide = 0;
let derelictsOffSetback = 0;
let derelictsOffGround = 0;
let derelictsTowardRoad = 0;
let derelictsWithStump = 0;
let worstDerelictSetbackError = 0;
let worstDerelictGroundError = 0;
let worstDerelictOutwardGain = Infinity;

const emptyBandStart = firstEmptyBandStart();
for (const seed of SEEDS) {
  const world = makeWorld(seed);
  const provider = new PoleProvider();
  for (const event of varietyEventsBetween(seed, emptyBandStart, emptyBandStart + DERELICT_PROBE_M)) {
    if (event.kind !== 'poleAnomaly') continue;
    const derelict = poleDerelictAt(seed, event.s);
    if (!derelict) continue;
    const content = provider.build(contextFor(world, Math.floor(event.s / CHUNK_LENGTH)));
    const groups = content.group.children.filter((child): child is THREE.Group => child instanceof THREE.Group);
    derelictsBuilt++;
    if (derelict.stumpS !== null) derelictsWithStump++;
    // In an empty band the line contributes nothing, so every Group here belongs to
    // the derelict: the mast, and the stump when the roll gave it one.
    if (groups.length !== (derelict.stumpS !== null ? 2 : 1)) {
      derelictPartsWrong++;
      content.dispose?.();
      continue;
    }

    // The mast is the part at the event's own arclength; the stump is 40 m on.
    const mast = groups.reduce((closest, candidate) =>
      Math.abs(world.road.project(candidate.position.x, candidate.position.z, event.s).s - event.s) <
      Math.abs(world.road.project(closest.position.x, closest.position.z, event.s).s - event.s)
        ? candidate
        : closest,
    );
    const projection = world.road.project(mast.position.x, mast.position.z, event.s);
    if (Math.sign(projection.lateral) !== derelict.side) derelictsWrongSide++;
    const setbackError = Math.abs(
      Math.abs(projection.lateral) - world.road.halfWidthAt(projection.s) - POLE_SETBACK_M,
    );
    worstDerelictSetbackError = Math.max(worstDerelictSetbackError, setbackError);
    if (setbackError > LATERAL_TOLERANCE) derelictsOffSetback++;

    // Half-buried is an authored figure, so this is exact rather than tolerant: the
    // butt sits `DERELICT_SINK_M` BELOW the ground, and if it ever sat above it the
    // mast would be a nine-metre mast hovering over a dune.
    const ground = world.terrain.heightAt(mast.position.x, mast.position.z, projection.s);
    const groundError = Math.abs(mast.position.y - (ground - DERELICT_SINK_M));
    worstDerelictGroundError = Math.max(worstDerelictGroundError, groundError);
    if (groundError > GROUND_TOLERANCE) derelictsOffGround++;

    // And the same test the fallen poles of a live line get: the tip ends further
    // from the carriageway than the butt, so nothing lies across a lane.
    const tip = new THREE.Vector3(0, POLE_HEIGHT[derelict.era]!, 0)
      .applyQuaternion(mast.quaternion)
      .add(mast.position);
    const gain =
      Math.abs(world.road.project(tip.x, tip.z, event.s).lateral) - Math.abs(projection.lateral);
    worstDerelictOutwardGain = Math.min(worstDerelictOutwardGain, gain);
    if (gain <= 0) derelictsTowardRoad++;
    content.dispose?.();
  }
}

console.log(
  `  ${derelictsBuilt} derelicts built in the first empty era band ` +
    `(s = ${(emptyBandStart / 1000).toFixed(0)} km), ${derelictsWithStump} with a surviving stump\n` +
    `  setback error worst ${worstDerelictSetbackError.toFixed(3)} m against the ${POLE_SETBACK_M} m pole line\n` +
    `  half-buried depth error worst ${worstDerelictGroundError.toFixed(4)} m ` +
    `against ${DERELICT_SINK_M} m\n` +
    `  masts gained at least ${worstDerelictOutwardGain.toFixed(2)} m of clearance from the road\n`,
);

check('derelicts are built at all', derelictsBuilt > 0, `${derelictsBuilt} derelicts`);
check(
  'a derelict is exactly its described parts',
  derelictPartsWrong === 0,
  `${derelictPartsWrong} of ${derelictsBuilt} with the wrong part count`,
);
check('some derelicts keep a stump', derelictsWithStump > 0, `${derelictsWithStump} of ${derelictsBuilt}`);
check(
  "every derelict lies on the event's side",
  derelictsWrongSide === 0,
  `${derelictsWrongSide} of ${derelictsBuilt} on the wrong side`,
);
check(
  'every derelict stands on the old pole line',
  derelictsOffSetback === 0,
  `${derelictsOffSetback} off ${POLE_SETBACK_M} m, worst ${worstDerelictSetbackError.toFixed(3)} m`,
);
check(
  'every derelict is half-buried, not floating',
  derelictsOffGround === 0,
  `${derelictsOffGround} of ${derelictsBuilt} off ${DERELICT_SINK_M} m depth`,
);
check(
  'every derelict fell away from the road',
  derelictsTowardRoad === 0,
  `${derelictsTowardRoad} of ${derelictsBuilt} toward the carriageway`,
);

// ===========================================================================
// Rebuild determinism
// ===========================================================================

console.log('\n=== rebuild determinism ===\n');

/** Every number a chunk's verge content puts on screen, flattened for comparison. */
function fingerprint(world: World, chunk: number): number[] {
  const out: number[] = [];
  const delineators = new DelineatorProvider(world.roadDistance).build(contextFor(world, chunk));
  if (delineators) {
    for (const child of delineators.group.children) {
      if (child instanceof THREE.InstancedMesh) out.push(child.count, ...matricesOf(child));
    }
    delineators.dispose?.();
  }
  const sidetracks = new SidetrackProvider(world.roadDistance).build(contextFor(world, chunk));
  if (sidetracks) {
    for (const child of sidetracks.group.children) {
      if (!(child instanceof THREE.Mesh)) continue;
      const position = child.geometry.getAttribute('position') as THREE.BufferAttribute;
      const colour = child.geometry.getAttribute('color') as THREE.BufferAttribute;
      out.push(position.count, ...(position.array as Float32Array), ...(colour.array as Float32Array));
    }
    sidetracks.dispose?.();
  }
  const poles = new PoleProvider().build(contextFor(world, chunk));
  for (const child of poles.group.children) {
    if (!(child instanceof THREE.Group)) continue;
    out.push(
      child.position.x,
      child.position.y,
      child.position.z,
      child.quaternion.x,
      child.quaternion.y,
      child.quaternion.z,
      child.quaternion.w,
      child.children.length,
    );
  }
  poles.dispose?.();
  return out;
}

let fingerprinted = 0;
let fingerprintMismatches = 0;
let fingerprintNumbers = 0;

for (const seed of SEEDS) {
  const world = makeWorld(seed);
  // Chunks that actually hold content rather than empty road: the verge events of the
  // seed's first few kilometres, which is a run, a track and a cluster each — plus one
  // out in the empty era band, so a derelict's rebuild is compared too.
  const chunks = new Set<number>();
  for (const event of varietyEventsBetween(seed, 0, SCAN_CHUNKS * CHUNK_LENGTH)) {
    if (event.channel !== 1) continue;
    chunks.add(Math.floor(event.s / CHUNK_LENGTH));
    if (chunks.size >= 12) break;
  }
  for (const event of varietyEventsBetween(seed, emptyBandStart, emptyBandStart + DERELICT_PROBE_M)) {
    if (event.kind !== 'poleAnomaly' || !poleDerelictAt(seed, event.s)) continue;
    chunks.add(Math.floor(event.s / CHUNK_LENGTH));
    break;
  }
  for (const chunk of chunks) {
    const first = fingerprint(world, chunk);
    const second = fingerprint(world, chunk);
    fingerprinted++;
    fingerprintNumbers += first.length;
    if (first.length !== second.length || first.some((value, i) => value !== second[i])) {
      fingerprintMismatches++;
    }
  }
}

console.log(`  ${fingerprinted} chunks rebuilt, ${fingerprintNumbers} numbers compared\n`);
check(
  'a rebuilt chunk is identical',
  fingerprintMismatches === 0 && fingerprinted > 0,
  `${fingerprintMismatches} of ${fingerprinted} chunks differed`,
);

console.log(failures === 0 ? '\nthe verge holds' : `\n${failures} checks failed`);
process.exit(failures === 0 ? 0 : 1);
