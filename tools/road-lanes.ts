/**
 * The widened carriageway, as the player actually meets it: built geometry, not the
 * profile function `tools/road-width.ts` already proves.
 *
 * Real `RoadMeshProvider` chunks are built across a narrow stretch, a taper and a
 * fully open one, and the emitted ribbon is measured: how wide the asphalt is, that
 * the drawn surface and its collider are the same vertices, that a wide row carries
 * a lane divider each side and a narrow row carries none, and that a narrow chunk is
 * unchanged by any of this.
 *
 * LAY-BYS. A lay-by's pad (world/laybymesh.ts) hangs off the ribbon's edge at
 * `halfWidthAt(s)`. On every seed, lay-bys of every district surface, on narrow and
 * widened road, are built with the ribbon, its shoulder strip and both colliders, and
 * the joint is crossed with rays: what is drawn there must be asphalt (ribbon or pad,
 * no shoulder strip, no sand showing), with no step, and the collider must be the
 * drawn surface.
 *
 *   bun tools/road-lanes.ts [seed ...]
 *
 * Seeds as the game draws them: the ones given, or three fresh full-range uint32s,
 * printed so a run can be repeated. The ribbon checks use the first.
 *
 * Nothing here is part of the game bundle.
 */

import * as THREE from 'three';

import { PhysicsWorld } from '../src/core/physics';
import { SurfaceType } from '../src/core/surfaces';
import { type ChunkContent, type ChunkContext } from '../src/world/chunks';
import { tileGroundSampler, type DrawnGroundSample } from '../src/world/deserttiledata';
import { laybyOuterAt, laybysBetween, type Layby } from '../src/world/layby';
import { LaybyMeshProvider } from '../src/world/laybymesh';
import { CHUNK_LENGTH } from '../src/world/ranges';
import { Road } from '../src/world/road';
import { RoadDistance } from '../src/world/roaddistance';
import { RoadMeshProvider, roadAsphaltMaterial, roadMarkingMaterial } from '../src/world/roadmesh';
import { Terrain } from '../src/world/terrain';
import { installDocumentShim } from './domshim';
import { LANE_WIDTH, NARROW_HALF_WIDTH, halfWidthAt, lanesPerSideAt } from '../src/world/roadprofile';
import { roadConditionAt } from '../src/world/gradient';

// The provider paints its asphalt maps on a 2D canvas; the shim lets the REAL
// provider run headless rather than verifying a stand-in.
installDocumentShim();

const argSeeds = process.argv
  .slice(2)
  .map(Number)
  .filter(Number.isFinite)
  .map((n) => n >>> 0);
const SEEDS =
  argSeeds.length > 0
    ? argSeeds
    : Array.from({ length: 3 }, () => Math.floor(Math.random() * 0x100000000) >>> 0);
const SEED = SEEDS[0]!;
console.log(`seeds ${SEEDS.join(' ')}`);
/** Half-width of a painted line: a quad's corners sit this far either side of it. */
const MARKING_HALF_WIDTH_M = 0.12;

const road = new Road(SEED);
const provider = new RoadMeshProvider(SEED);

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(56)} ${detail}`);
}

interface Built {
  /** Widest |lateral| the ribbon reaches, per chunk. */
  readonly maxLateral: number;
  readonly minLateral: number;
  /** Marking quad centres, as lateral offsets from the centreline. */
  readonly markingLaterals: number[];
  readonly surfaceVerts: number;
  readonly nonFinite: number;
}

/** Every drawn vertex, projected back into the road frame of its own chunk. */
function build(chunkIndex: number): Built {
  const sStart = chunkIndex * CHUNK_LENGTH;
  const ctx = {
    chunkIndex,
    sStart,
    sEnd: sStart + CHUNK_LENGTH,
    road,
    physics: null,
    world: { seed: SEED },
    hasPhysics: false,
    originX: 0,
    originZ: 0,
  } as unknown as ChunkContext;

  const content = provider.build(ctx);
  if (!content) throw new Error(`chunk ${chunkIndex} built nothing`);

  let maxLateral = -Infinity;
  let minLateral = Infinity;
  let surfaceVerts = 0;
  let nonFinite = 0;
  const markingLaterals: number[] = [];
  let meshIndex = 0;
  const world = new THREE.Vector3();
  // The ribbon's own vertices are written in the chunk's local frame and placed by
  // the mesh transform; the markings are already absolute. Reading matrixWorld keeps
  // both honest.
  content.group.updateMatrixWorld(true);
  content.group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const position = object.geometry.getAttribute('position');
    const index = meshIndex++;
    // Order is the provider's: surface, then the bed skirt, then markings.
    if (index === 1) return;
    for (let i = 0; i < position.count; i++) {
      world.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
      if (!Number.isFinite(world.x) || !Number.isFinite(world.y) || !Number.isFinite(world.z)) {
        nonFinite++;
        continue;
      }
      const projection = road.project(world.x, world.z, sStart + CHUNK_LENGTH * 0.5);
      if (index === 2) {
        markingLaterals.push(projection.lateral);
        continue;
      }
      surfaceVerts++;
      if (projection.lateral > maxLateral) maxLateral = projection.lateral;
      if (projection.lateral < minLateral) minLateral = projection.lateral;
    }
  });
  content.dispose?.();
  return { maxLateral, minLateral, markingLaterals, surfaceVerts, nonFinite };
}

/**
 * Is a line painted ON `lateral`?
 *
 * Both corners, not either: a quad's corners are 0.12 m each side of its line, so
 * "something within 0.13 m" would let the outer corner of the 2.78 m edge line pass
 * as a 2.90 m lane divider — and then a narrow road would look split into lanes.
 */
function paintedAt(laterals: readonly number[], lateral: number): boolean {
  const near = (target: number): boolean =>
    laterals.some((value) => Math.abs(value - target) <= 0.02);
  return near(lateral - MARKING_HALF_WIDTH_M) && near(lateral + MARKING_HALF_WIDTH_M);
}

/**
 * First chunk whose whole span has the wanted lane count AND still carries paint.
 *
 * Paint matters because the markings are what prove the lane layout, and this road
 * is mostly unmaintained: `roadConditionAt` leaves only a few per cent of its length
 * marked at all, so a chunk has to be chosen rather than assumed.
 */
function findChunk(lanes: number, from: number, to: number): number {
  for (let chunk = from; chunk < to; chunk++) {
    const sStart = chunk * CHUNK_LENGTH;
    let all = true;
    for (let s = sStart; s <= sStart + CHUNK_LENGTH; s += 10) {
      if (lanesPerSideAt(SEED, s) !== lanes || roadConditionAt(SEED, s).markings < 0.3) {
        all = false;
        break;
      }
    }
    if (all) return chunk;
  }
  throw new Error(`no painted ${lanes}-lane chunk in that range`);
}

const narrowChunk = findChunk(1, 5, 4_000);
const wideChunk = findChunk(2, 5, 4_000);
console.log(
  `seed ${SEED}: narrow chunk ${narrowChunk} (s ${narrowChunk * CHUNK_LENGTH}), ` +
    `wide chunk ${wideChunk} (s ${wideChunk * CHUNK_LENGTH})`,
);

const narrow = build(narrowChunk);
const wide = build(wideChunk);

check(
  'nothing in the ribbon is NaN',
  narrow.nonFinite === 0 && wide.nonFinite === 0,
  `${narrow.nonFinite} narrow, ${wide.nonFinite} wide`,
);
check(
  `a narrow chunk is still ${(LANE_WIDTH * 2).toFixed(1)} m of asphalt`,
  Math.abs(narrow.maxLateral - LANE_WIDTH) < 0.02 && Math.abs(narrow.minLateral + LANE_WIDTH) < 0.02,
  `${narrow.minLateral.toFixed(2)}..${narrow.maxLateral.toFixed(2)} m`,
);
check(
  `a wide chunk is ${(LANE_WIDTH * 4).toFixed(1)} m of asphalt`,
  Math.abs(wide.maxLateral - LANE_WIDTH * 2) < 0.02 && Math.abs(wide.minLateral + LANE_WIDTH * 2) < 0.02,
  `${wide.minLateral.toFixed(2)}..${wide.maxLateral.toFixed(2)} m`,
);
// Every chunk has the same base rows of 15 columns; a gap holding a road event
// (world/roadsurface.ts) appends whole extra rows after them, so the count differs
// by whole rows and never drops below the base.
const BASE_SURFACE_VERTS = 2265;
check(
  'both carry the base rows, and only whole extra rows',
  narrow.surfaceVerts >= BASE_SURFACE_VERTS &&
    wide.surfaceVerts >= BASE_SURFACE_VERTS &&
    narrow.surfaceVerts % 15 === 0 &&
    wide.surfaceVerts % 15 === 0,
  `${narrow.surfaceVerts} narrow, ${wide.surfaceVerts} wide (base ${BASE_SURFACE_VERTS})`,
);
check(
  'the edge line follows the edge it is on',
  paintedAt(narrow.markingLaterals, LANE_WIDTH - 0.12) &&
    paintedAt(wide.markingLaterals, LANE_WIDTH * 2 - 0.12),
  `narrow at ${(LANE_WIDTH - 0.12).toFixed(2)} m, wide at ${(LANE_WIDTH * 2 - 0.12).toFixed(2)} m`,
);
check(
  'the crown line is painted on both',
  paintedAt(narrow.markingLaterals, 0) && paintedAt(wide.markingLaterals, 0),
  'dashed centre present',
);
check(
  'only the wide chunk is split into lanes',
  !paintedAt(narrow.markingLaterals, LANE_WIDTH) &&
    !paintedAt(narrow.markingLaterals, -LANE_WIDTH) &&
    paintedAt(wide.markingLaterals, LANE_WIDTH) &&
    paintedAt(wide.markingLaterals, -LANE_WIDTH),
  `dividers at ±${LANE_WIDTH.toFixed(2)} m on the wide chunk only`,
);

// --- the taper -----------------------------------------------------------------
// A 260 m wedge is longer than a 200 m chunk, so no chunk holds both extremes. What
// matters is that the ribbon widens across it and reaches exactly what the profile
// claims at its own widest row.
let taperChunk = -1;
let taperSpan = 0;
for (let chunk = 10; chunk < 400 && taperChunk < 0; chunk++) {
  const sStart = chunk * CHUNK_LENGTH;
  let widest = 0;
  let narrowest = Infinity;
  for (let s = sStart; s <= sStart + CHUNK_LENGTH; s += 5) {
    const half = halfWidthAt(SEED, s);
    widest = Math.max(widest, half);
    narrowest = Math.min(narrowest, half);
  }
  if (widest - narrowest > 1) {
    taperChunk = chunk;
    taperSpan = widest;
  }
}
const taper = build(taperChunk);
check(
  'a taper chunk widens to exactly what the profile claims',
  Math.abs(taper.maxLateral - taperSpan) < 0.02 &&
    Math.abs(taper.minLateral + taperSpan) < 0.02 &&
    taper.nonFinite === 0 &&
    taper.surfaceVerts >= BASE_SURFACE_VERTS &&
    taper.surfaceVerts % 15 === 0,
  `chunk ${taperChunk}: reaches ${taper.maxLateral.toFixed(2)} m against a claimed ${taperSpan.toFixed(2)} m`,
);

// --- lay-bys -------------------------------------------------------------------
// Across the joint between the ribbon's edge and a lay-by's pad, every 5 cm from
// 0.4 m inside the edge to 0.6 m out onto the pad, on rows where the pad is at least
// a metre wide (the shoulder strip rightly hangs off its outer edge on the slips'
// thin ends). Lay-bys are picked per district surface and per width class, on every
// seed, until each bucket holds `LAYBYS_PER_BUCKET` or the search runs out of road.
const DISTRICT_SURFACES: readonly SurfaceType[] = [
  SurfaceType.Asphalt,
  SurfaceType.CrackedAsphalt,
  SurfaceType.Gravel,
  SurfaceType.Concrete,
];
const SURFACE_NAMES: Partial<Record<SurfaceType, string>> = {
  [SurfaceType.Asphalt]: 'asphalt',
  [SurfaceType.CrackedAsphalt]: 'cracked',
  [SurfaceType.Gravel]: 'gravel',
  [SurfaceType.Concrete]: 'concrete',
};
const LAYBYS_PER_BUCKET = 2;
const LAYBY_SEARCH_M = 1_500_000;
const LAYBY_SEARCH_WINDOW_M = 50_000;
/**
 * Offsets from the ribbon's edge sampled across the joint, metres: 5 cm apart from 0.4 m
 * inside to 0.6 m out, plus a pair 2 mm either side of the edge, never ON it. A ray down
 * the exact line two separate trimeshes share can slip between them in float, which is
 * the ray's problem, not a gap a tyre meets; 2 mm off finds any real one.
 */
const SEAM_OFFSETS_M: readonly number[] = [
  ...Array.from({ length: 8 }, (_, i) => -0.4 + i * 0.05),
  -0.002,
  0.002,
  ...Array.from({ length: 12 }, (_, i) => 0.05 + i * 0.05),
];
const SEAM_MIN_PAD_M = 1;
/** Height change allowed between neighbouring samples: a 20% grade over 5 cm, never a kerb. */
const SEAM_STEP_TOLERANCE_M = 0.01;
/** Collider against the drawn top at the same point. */
const SEAM_COLLIDER_TOLERANCE_M = 0.005;

const physics = await PhysicsWorld.create();
const DOWN = { x: 0, y: -1, z: 0 };
const rayOrigin = { x: 0, y: 0, z: 0 };
const raycaster = new THREE.Raycaster();
const rayFrom = new THREE.Vector3();
const rayDown = new THREE.Vector3(0, -1, 0);
const groundSample: DrawnGroundSample = { height: 0, detail: 0, nx: 0, ny: 1, nz: 0 };

interface SeamResult {
  rows: number;
  /** Samples whose drawn top is not asphalt (shoulder strip, bed, nothing: sand showing). */
  notAsphalt: number;
  /** Samples where the drawn desert ground stands at or over the drawn top. */
  groundShowing: number;
  /** Samples with no road-surface collider, or one off the drawn top. */
  colliderOff: number;
  worstDrawnStep: number;
  worstColliderStep: number;
  first: string;
}

function measureLayby(
  seed: number,
  seamRoad: Road,
  terrain: Terrain,
  ribbon: RoadMeshProvider,
  pads: LaybyMeshProvider,
  ground: (x: number, z: number, out: DrawnGroundSample) => void,
  layby: Layby,
): SeamResult {
  const result: SeamResult = {
    rows: 0,
    notAsphalt: 0,
    groundShowing: 0,
    colliderOff: 0,
    worstDrawnStep: 0,
    worstColliderStep: 0,
    first: '',
  };
  const note = (text: string): void => {
    if (!result.first) result.first = text;
  };
  for (let chunk = Math.floor(layby.sEntry / CHUNK_LENGTH); chunk <= Math.floor(layby.sExit / CHUNK_LENGTH); chunk++) {
    const sStart = chunk * CHUNK_LENGTH;
    const start = seamRoad.sampleAt(sStart);
    const ox = Math.round(start.x);
    const oz = Math.round(start.z);
    const ctx = {
      chunkIndex: chunk,
      sStart,
      sEnd: sStart + CHUNK_LENGTH,
      road: seamRoad,
      terrain,
      physics,
      world: { seed },
      hasPhysics: true,
      originX: ox,
      originZ: oz,
    } as unknown as ChunkContext;
    const contents = [ribbon.build(ctx), pads.build(ctx)].filter((c): c is ChunkContent => c !== null);
    const drawn: THREE.Mesh[] = [];
    for (const content of contents) {
      for (const collider of content.colliders) collider.setEnabled(true);
      content.group.updateMatrixWorld(true);
      content.group.traverse((object) => {
        if (object instanceof THREE.Mesh && object.material !== roadMarkingMaterial()) drawn.push(object);
      });
    }
    physics.step();

    const tops: number[] = [];
    const hits: number[] = [];
    for (let s = sStart + 0.5; s < sStart + CHUNK_LENGTH; s += 1) {
      const halfWidth = seamRoad.halfWidthAt(s);
      if (laybyOuterAt(layby, s, halfWidth) - halfWidth < SEAM_MIN_PAD_M) continue;
      result.rows++;
      tops.length = 0;
      hits.length = 0;
      for (const d of SEAM_OFFSETS_M) {
        const where = `s ${s.toFixed(1)} ${d >= 0 ? '+' : ''}${d.toFixed(3)} m from the edge`;
        const p = seamRoad.offsetPoint(s, layby.side * (halfWidth + d));
        ground(p.x, p.z, groundSample);
        rayFrom.set(p.x - ox, groundSample.height + 50, p.z - oz);
        raycaster.set(rayFrom, rayDown);
        const top = raycaster.intersectObjects(drawn, false)[0];
        const topY = top ? top.point.y : Number.NEGATIVE_INFINITY;
        if (!top || top.object instanceof THREE.Mesh === false || top.object.material !== roadAsphaltMaterial()) {
          result.notAsphalt++;
          note(`${where}: drawn top is ${top ? 'not asphalt' : 'nothing'}`);
        }
        if (groundSample.height >= topY) {
          result.groundShowing++;
          note(`${where}: sand ${(groundSample.height - topY).toFixed(3)} m over the drawn top`);
        }
        rayOrigin.x = p.x - ox;
        rayOrigin.y = groundSample.height + 50;
        rayOrigin.z = p.z - oz;
        const hit = physics.raycast(rayOrigin, DOWN, 100);
        const hitY = hit ? hit.point.y : Number.NEGATIVE_INFINITY;
        if (
          !hit ||
          !DISTRICT_SURFACES.includes(physics.surfaces.lookupType(hit.colliderHandle)) ||
          Math.abs(hitY - topY) > SEAM_COLLIDER_TOLERANCE_M
        ) {
          result.colliderOff++;
          note(`${where}: collider ${hit ? `${(hitY - topY).toFixed(3)} m off the drawn top` : 'missing'}`);
        }
        tops.push(topY);
        hits.push(hitY);
      }
      for (let i = 1; i < tops.length; i++) {
        const drawnStep = Math.abs(tops[i]! - tops[i - 1]!);
        const colliderStep = Math.abs(hits[i]! - hits[i - 1]!);
        if (drawnStep > SEAM_STEP_TOLERANCE_M) note(`s ${s.toFixed(1)}: drawn step ${drawnStep.toFixed(3)} m`);
        if (colliderStep > SEAM_STEP_TOLERANCE_M) note(`s ${s.toFixed(1)}: collider step ${colliderStep.toFixed(3)} m`);
        result.worstDrawnStep = Math.max(result.worstDrawnStep, drawnStep);
        result.worstColliderStep = Math.max(result.worstColliderStep, colliderStep);
      }
    }
    for (const content of contents) {
      for (const body of content.bodies) physics.removeBody(body);
      content.dispose?.();
    }
  }
  return result;
}

console.log(`\nlay-bys: the pad meets the ribbon's edge, -0.4 to +0.6 m across it`);
let seamFailures = 0;
let widenedMeasured = 0;
const surfacesMeasured = new Set<SurfaceType>();
for (const seed of SEEDS) {
  const seamRoad = new Road(seed);
  const terrain = new Terrain(seed, seamRoad);
  const roadDistance = new RoadDistance(seamRoad);
  const ribbon = new RoadMeshProvider(seed, roadDistance);
  const pads = new LaybyMeshProvider();
  const ground = tileGroundSampler({ seed, road: seamRoad, terrain, roadDistance });
  const picked = new Map<string, number>();
  const buckets = DISTRICT_SURFACES.length * 2;
  const searchTo = Math.min(seamRoad.length - 2 * CHUNK_LENGTH, LAYBY_SEARCH_M);
  for (let from = 5 * CHUNK_LENGTH; from < searchTo && picked.size < buckets; from += LAYBY_SEARCH_WINDOW_M) {
    for (const layby of laybysBetween(seed, from, Math.min(searchTo, from + LAYBY_SEARCH_WINDOW_M))) {
      if (layby.sEntry < from) continue;
      // Widened: a passing window or a corner's widening reaches the pad's road edge.
      let widest = 0;
      for (let s = layby.sPadStart; s <= layby.sPadEnd; s += 5) widest = Math.max(widest, seamRoad.halfWidthAt(s));
      const widened = widest > NARROW_HALF_WIDTH + 0.05;
      const key = `${layby.surface}:${widened}`;
      const count = picked.get(key) ?? 0;
      if (count >= LAYBYS_PER_BUCKET) continue;
      picked.set(key, count + 1);
      const r = measureLayby(seed, seamRoad, terrain, ribbon, pads, ground, layby);
      const ok =
        r.rows > 0 &&
        r.notAsphalt === 0 &&
        r.groundShowing === 0 &&
        r.colliderOff === 0 &&
        r.worstDrawnStep <= SEAM_STEP_TOLERANCE_M &&
        r.worstColliderStep <= SEAM_STEP_TOLERANCE_M;
      if (!ok) seamFailures++;
      surfacesMeasured.add(layby.surface);
      if (widened) widenedMeasured++;
      console.log(
        `  ${ok ? 'ok  ' : 'FAIL'}  seed ${seed} s ${layby.s.toFixed(0).padStart(7)} ` +
          `${(SURFACE_NAMES[layby.surface] ?? String(layby.surface)).padEnd(8)} ` +
          `${widened ? `widened to ${widest.toFixed(2)}` : 'narrow'.padEnd(16)} m | ${r.rows} rows, ` +
          `not asphalt ${r.notAsphalt}, sand showing ${r.groundShowing}, collider off ${r.colliderOff}, ` +
          `worst step ${(r.worstDrawnStep * 100).toFixed(1)} cm drawn / ${(r.worstColliderStep * 100).toFixed(1)} cm collided` +
          (r.first ? ` | first: ${r.first}` : ''),
      );
    }
  }
}
check('every lay-by joins the ribbon flush, drawn and collided', seamFailures === 0, `${seamFailures} lay-bys with a seam`);
check(
  'lay-bys of every district surface were measured',
  DISTRICT_SURFACES.every((surface) => surfacesMeasured.has(surface)),
  [...surfacesMeasured].map((surface) => SURFACE_NAMES[surface]).join(', '),
);
check('lay-bys on widened road were measured', widenedMeasured > 0, `${widenedMeasured}`);

console.log(failures === 0 ? '\nthe ribbon is the road the profile describes' : `\n${failures} checks failed`);
process.exit(failures === 0 ? 0 : 1);
