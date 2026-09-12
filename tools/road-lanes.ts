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
 *   bun tools/road-lanes.ts [seed]
 *
 * Nothing here is part of the game bundle.
 */

import * as THREE from 'three';

import { CHUNK_LENGTH, type ChunkContext } from '../src/world/chunks';
import { Road } from '../src/world/road';
import { RoadMeshProvider } from '../src/world/roadmesh';
import { installDocumentShim } from './domshim';
import { LANE_WIDTH, halfWidthAt, lanesPerSideAt } from '../src/world/roadprofile';
import { roadConditionAt } from '../src/world/gradient';

// The provider paints its asphalt maps on a 2D canvas; the shim lets the REAL
// provider run headless rather than verifying a stand-in.
installDocumentShim();

const SEED = Number(process.argv[2] ?? 1337) >>> 0;
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
      if (lanesPerSideAt(SEED, s) !== lanes || roadConditionAt(s).markings < 0.3) {
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
  'a narrow chunk is still 5.8 m of asphalt',
  Math.abs(narrow.maxLateral - LANE_WIDTH) < 0.02 && Math.abs(narrow.minLateral + LANE_WIDTH) < 0.02,
  `${narrow.minLateral.toFixed(2)}..${narrow.maxLateral.toFixed(2)} m`,
);
check(
  'a wide chunk is 11.6 m of asphalt',
  Math.abs(wide.maxLateral - LANE_WIDTH * 2) < 0.02 && Math.abs(wide.minLateral + LANE_WIDTH * 2) < 0.02,
  `${wide.minLateral.toFixed(2)}..${wide.maxLateral.toFixed(2)} m`,
);
check(
  'both carry the same number of surface vertices',
  narrow.surfaceVerts === wide.surfaceVerts,
  `${narrow.surfaceVerts} narrow, ${wide.surfaceVerts} wide`,
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
    taper.surfaceVerts === narrow.surfaceVerts,
  `chunk ${taperChunk}: reaches ${taper.maxLateral.toFixed(2)} m against a claimed ${taperSpan.toFixed(2)} m`,
);

console.log(failures === 0 ? '\nthe ribbon is the road the profile describes' : `\n${failures} checks failed`);
process.exit(failures === 0 ? 0 : 1);
