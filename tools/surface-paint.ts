/**
 * tools/surface-paint.ts
 *
 * THE FOUR THINGS THE DIRECTOR IS ALLOWED TO DO TO THE ASPHALT, measured on built
 * geometry rather than argued about: bitumen patches, laid rubber, a change of paint
 * and sand tongues (world/director.ts kinds 'patches', 'skid', 'markings',
 * 'sandTongue', all painted by RoadMeshProvider in world/roadmesh.ts).
 *
 * Real chunks, real provider, headless. What it asks:
 *
 *  - LAYOUT. The ribbon still has exactly the rows and columns it had before, because
 *    those vertices are the trimesh the car drives on and the collider slabs are
 *    indexed straight off the counts. This is the regression that would not look like
 *    a colour bug at all: it would look like the car falling through the road.
 *  - ADDITIVITY. Off-feature, the vertex colours are the ones the road produced
 *    BEFORE any of this existed. The golden sums below were captured from the
 *    pre-feature provider over 50 km; re-capture them with `--capture` if something
 *    upstream of the colour pipeline legitimately changes.
 *  - PATCHES darken the lane measurably where they fire.
 *  - RUBBER lands in the wheel paths, off the crown and off the shoulder.
 *  - PAINT changes over the marking event's span and nowhere else, at one hard edge.
 *  - SAND reaches further in on the tongue's own side and nowhere else.
 *
 * Residuals are measured against a per-column reference built from the rows the
 * feature does not reach, rescaled per row by the MEDIAN of its column ratios. The
 * median is the point: it tracks the district's own drift in brightness (decay, dust,
 * palette) while ignoring the few columns a feature actually touches, so what is left
 * over is the feature and not the road.
 *
 *   npx tsx tools/surface-paint.ts [seed]
 *   npx tsx tools/surface-paint.ts [seed] --capture
 *
 * Nothing here is part of the game bundle.
 */

import * as THREE from 'three';
import { CHUNK_LENGTH, type ChunkContext } from '../src/world/chunks';
import {
  varietyEventOfKindAt,
  varietyEventsBetween,
  varietyWeightAt,
  type VarietyEvent,
  type VarietyKind,
} from '../src/world/director';
import { SURFACES } from '../src/core/surfaces';
import { MAX_WEAR, desertPaletteAt, roadConditionAt } from '../src/world/gradient';
import { Road } from '../src/world/road';
import { RoadMeshProvider, roadAsphaltVertexColorAtStart } from '../src/world/roadmesh';
import { laneOffsetFor } from '../src/world/roadprofile';
import { SURFACE_STEP } from '../src/world/roadsurface';
import { installDocumentShim } from './domshim';

// The provider paints its asphalt maps on a 2D canvas; the shim lets the REAL
// provider run headless rather than verifying a stand-in.
installDocumentShim();

const SEED = Number(process.argv[2] ?? 1337) >>> 0;
const CAPTURE = process.argv.includes('--capture');

const road = new Road(SEED);
const provider = new RoadMeshProvider(SEED);

/** Rows and columns the ribbon has had since long before these features existed. */
const EXPECT_ROWS = Math.round(CHUNK_LENGTH / SURFACE_STEP) + 1;
const EXPECT_COLUMNS = 15;
const EXPECT_INDICES = (EXPECT_ROWS - 1) * (EXPECT_COLUMNS - 1) * 6;

/** Chunks the additivity sweep covers: 50 km, which holds dozens of every kind. */
const SWEEP_CHUNKS = 250;

/**
 * Golden sums of the pre-feature road, per seed: one over every row the Surface
 * channel never reaches, one over the rows it does. Captured with `--capture` against
 * the provider as it stood before the four features landed. The quiet number must
 * still match exactly; the live number must NOT, or nothing was painted.
 */
interface Golden {
  readonly quietRows: number;
  readonly quiet: number;
  readonly liveRows: number;
  readonly live: number;
}
const GOLDEN: Record<number, Golden> = {
  1337: { quietRows: 31917, quiet: 17292196.522722, liveRows: 5833, live: 3141528.384698 },
  7: { quietRows: 31302, quiet: 16867240.20719, liveRows: 6448, live: 3541496.003528 },
};

/**
 * Constants the road mesh does not export, duplicated here on purpose: a tool that
 * imported them could not catch one of them changing. Same reason tools/road-lanes.ts
 * writes out the marking half-width instead of importing it.
 */
/** Grid the hard ends of a marking event snap to. See MARKING_SNAP_M in roadmesh.ts. */
const MARKING_SNAP_M = 16;
/**
 * Coverage at or above which the road actually draws a line. `MARKING_MIN` (0.03)
 * only opens the gate; `PAINT_GONE` (0.34) then drops any quad whose worn coverage
 * falls under it, so the threshold that matters is PAINT_GONE / 0.72 — the same
 * PAINT_EFFECTIVE the provider decides its marking variant on.
 */
const PAINT_EFFECTIVE = 0.34 / 0.72;
/** Lane-0 wheel path centres: laneOffsetFor(hw, 0) + 0.2, +/- 0.8. */
const WHEEL_BIAS = 0.2;
const WHEEL_TRACK_HALF = 0.8;
/** How far off a wheel path's centre still counts as in it. */
const WHEEL_TOLERANCE = 0.5;
/** Band at the mat edge that counts as shoulder rather than lane. */
const SHOULDER_BAND = 0.2;
/** Band either side of the crown that counts as the crown. */
const CROWN_BAND = 0.25;
/** Residual either way that is just the mat's own mottling, not a feature. */
const MOTTLE_FLOOR = 0.08;

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(54)} ${detail}`);
}

interface Mark {
  readonly s: number;
  readonly lateral: number;
}

interface BuiltChunk {
  readonly sStart: number;
  readonly rows: number;
  readonly columns: number;
  readonly indexCount: number;
  /** Row-major per-vertex luminance. */
  readonly lum: Float64Array;
  /**
   * Row-major per-vertex WARMTH, red minus blue.
   *
   * The measure that tells sand from asphalt. Luminance does not: on an early-cycle
   * palette the drifted sand and the dusty mat are within a few per cent of the same
   * lightness, and the first version of the sand check read almost nothing because of
   * it. Warmth separates them by a factor of fifty — bare mat sits at 0.018, sand at
   * 0.9 — and it cancels out of a left-versus-right comparison of the same row,
   * because every other thing the mat does laterally is a function of |lateral|.
   */
  readonly warm: Float64Array;
  /** Row-major per-vertex lateral, recovered from the built position, or null. */
  readonly lateral: Float64Array | null;
  /** Per-row extreme channel value, so quiet and live rows can be told apart. */
  readonly rowMin: Float64Array;
  readonly rowMax: Float64Array;
  readonly nonFinite: number;
  /** One entry per emitted marking quad, at its centre in the road frame. */
  readonly marks: readonly Mark[];
  /** Checksum per row, the additivity measure: every channel, position-weighted. */
  readonly rowSum: Float64Array;
}

const world = new THREE.Vector3();

function buildChunk(chunkIndex: number, withLateral: boolean): BuiltChunk {
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
  content.group.updateMatrixWorld(true);
  // Order is the provider's: the mat, then the bed skirt, then the markings.
  const meshes: THREE.Mesh[] = [];
  content.group.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes.push(object);
  });
  const surface = meshes[0];
  if (!surface) throw new Error(`chunk ${chunkIndex} built no mat`);

  const colorAttr = surface.geometry.getAttribute('color');
  const positionAttr = surface.geometry.getAttribute('position');
  const columns = EXPECT_COLUMNS;
  const rows = colorAttr.count / columns;
  const lum = new Float64Array(colorAttr.count);
  const warm = new Float64Array(colorAttr.count);
  const lateral = withLateral ? new Float64Array(colorAttr.count) : null;
  const rowSum = new Float64Array(rows);
  const rowMin = new Float64Array(rows);
  const rowMax = new Float64Array(rows);
  let nonFinite = 0;
  const colors = colorAttr.array as Float32Array;
  for (let si = 0; si < rows; si++) {
    let sum = 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = 0; j < columns * 3; j++) {
      const v = colors[si * columns * 3 + j]!;
      if (!Number.isFinite(v)) {
        nonFinite++;
        continue;
      }
      if (v < lo) lo = v;
      if (v > hi) hi = v;
      sum += v * (j + 1);
    }
    rowSum[si] = sum;
    rowMin[si] = lo;
    rowMax[si] = hi;
    for (let li = 0; li < columns; li++) {
      const vi = si * columns + li;
      // Rec. 709 luminance of the linear vertex colour.
      lum[vi] =
        0.2126 * colors[vi * 3]! + 0.7152 * colors[vi * 3 + 1]! + 0.0722 * colors[vi * 3 + 2]!;
      warm[vi] = colors[vi * 3]! - colors[vi * 3 + 2]!;
      if (lateral) {
        world.fromBufferAttribute(positionAttr, vi).applyMatrix4(surface.matrixWorld);
        lateral[vi] = road.project(world.x, world.z, sStart + (si * CHUNK_LENGTH) / (rows - 1)).lateral;
      }
    }
  }

  // Marking quads are six vertices each, in emission order; their centre is what
  // identifies which line they belong to.
  const marks: Mark[] = [];
  const markMesh = meshes[2];
  if (markMesh) {
    const markPositions = markMesh.geometry.getAttribute('position');
    for (let q = 0; q + 6 <= markPositions.count; q += 6) {
      let x = 0;
      let z = 0;
      for (let k = 0; k < 6; k++) {
        world.fromBufferAttribute(markPositions, q + k).applyMatrix4(markMesh.matrixWorld);
        x += world.x / 6;
        z += world.z / 6;
      }
      const projection = road.project(x, z, sStart + CHUNK_LENGTH * 0.5);
      marks.push({ s: projection.s, lateral: projection.lateral });
    }
  }

  content.dispose?.();
  return {
    sStart,
    rows,
    columns,
    indexCount: surface.geometry.getIndex()?.count ?? 0,
    lum,
    warm,
    lateral,
    rowMin,
    rowMax,
    nonFinite,
    marks,
    rowSum,
  };
}

// ---------------------------------------------------------------------------
// Layout, additivity and range: one sweep over 50 km
// ---------------------------------------------------------------------------

/** True if ANY Surface-channel feature reaches this arclength at all. */
function touched(s: number): boolean {
  return (
    varietyEventOfKindAt(SEED, 'patches', s) !== null ||
    varietyEventOfKindAt(SEED, 'skid', s) !== null ||
    varietyEventOfKindAt(SEED, 'markings', s) !== null ||
    varietyEventOfKindAt(SEED, 'sandTongue', s) !== null
  );
}

console.log(`surface paint: seed ${SEED}, ${SWEEP_CHUNKS} chunks of ribbon`);

let quietSum = 0;
let quietRows = 0;
let liveSum = 0;
let liveRows = 0;
let quietMin = Infinity;
let quietMax = -Infinity;
let liveMin = Infinity;
let liveMax = -Infinity;
let sweepNonFinite = 0;
let layoutWrong = 0;
for (let chunk = 0; chunk < SWEEP_CHUNKS; chunk++) {
  const built = buildChunk(chunk, false);
  if (
    built.rows !== EXPECT_ROWS ||
    built.columns !== EXPECT_COLUMNS ||
    built.indexCount !== EXPECT_INDICES
  ) layoutWrong++;
  sweepNonFinite += built.nonFinite;
  for (let si = 0; si < built.rows; si++) {
    const s = built.sStart + (si * CHUNK_LENGTH) / (built.rows - 1);
    if (touched(s)) {
      liveSum += built.rowSum[si]!;
      liveRows++;
      if (built.rowMin[si]! < liveMin) liveMin = built.rowMin[si]!;
      if (built.rowMax[si]! > liveMax) liveMax = built.rowMax[si]!;
    } else {
      quietSum += built.rowSum[si]!;
      quietRows++;
      if (built.rowMin[si]! < quietMin) quietMin = built.rowMin[si]!;
      if (built.rowMax[si]! > quietMax) quietMax = built.rowMax[si]!;
    }
  }
}

if (CAPTURE) {
  console.log('');
  console.log('golden capture (paste into GOLDEN above):');
  console.log(
    `  ${SEED}: { quietRows: ${quietRows}, quiet: ${quietSum.toFixed(6)}, ` +
      `liveRows: ${liveRows}, live: ${liveSum.toFixed(6)} },`,
  );
  process.exit(0);
}

console.log('');
console.log('the ribbon itself');
check(
  'every chunk has the rows and columns it always had',
  layoutWrong === 0,
  `${EXPECT_ROWS} x ${EXPECT_COLUMNS} verts, ${EXPECT_INDICES} indices, ${layoutWrong} chunks wrong`,
);
check(
  'no vertex colour is NaN',
  sweepNonFinite === 0,
  `${sweepNonFinite} non-finite channels`,
);
check(
  'no channel goes negative',
  quietMin >= 0 && liveMin >= 0,
  `floor ${Math.min(quietMin, liveMin).toFixed(4)}`,
);
// THE CEILING. The mat's colours are not confined to [0, 1] and never were:
// `textureGain` divides the vertex colour by the asphalt albedo's mean, so the
// textured surface keeps the brightness it had before it was textured, and a fully
// sand-covered vertex already lands near 1.2. So the bound that can honestly be
// asserted is the pipeline's own: the palette's brightest sand channel, times that
// gain, times the most the dust and mottling terms in `weather` can lighten one
// vertex. Anything above that is a colour nothing in the road can explain.
//
// `roadAsphaltVertexColorAtStart` is the provider's own gain-corrected colour for the
// opening district, so dividing it by that district's raw albedo recovers the gain
// without the road mesh having to export it.
const startAlbedo = new THREE.Color(SURFACES[roadConditionAt(0).surface].color);
const textureGain = roadAsphaltVertexColorAtStart(new THREE.Color()).r / startAlbedo.r;
/** DUST_LIGHTEN and MOTTLE_AMOUNT in roadmesh.ts, at the deepest wear the world shows. */
const WEATHER_LIFT = (1 + 0.11 * (0.5 + MAX_WEAR)) * (1 + 0.07 * (0.7 + MAX_WEAR));
const sandProbe = new THREE.Color();
let brightestSand = 0;
for (let s = 0; s < SWEEP_CHUNKS * CHUNK_LENGTH; s += CHUNK_LENGTH) {
  sandProbe.setHex(desertPaletteAt(s).sand);
  brightestSand = Math.max(brightestSand, sandProbe.r, sandProbe.g, sandProbe.b);
}
const ceiling = brightestSand * textureGain * WEATHER_LIFT;
check(
  'no channel passes the palette-and-gain ceiling',
  Math.max(quietMax, liveMax) <= ceiling,
  `brightest ${Math.max(quietMax, liveMax).toFixed(4)} against a ceiling of ${ceiling.toFixed(4)} ` +
    `(untouched road ${quietMax.toFixed(4)}, feature rows ${liveMax.toFixed(4)})`,
);

const golden = GOLDEN[SEED];
console.log('');
console.log('additivity against the pre-feature road');
if (!golden) {
  console.log(`  ..    no golden capture for seed ${SEED}; run with --capture to make one`);
} else {
  // A single vertex moving by a thousandth in one channel moves its row sum by about
  // the same, and there are tens of thousands of rows in here, so 1e-5 over the whole
  // sweep is "not one vertex changed" rather than "close enough".
  check(
    'off-feature the road is unchanged, to the bit',
    quietRows === golden.quietRows && Math.abs(quietSum - golden.quiet) < 1e-5,
    `${quietRows} rows, sum ${quietSum.toFixed(6)} vs golden ${golden.quiet.toFixed(6)}`,
  );
  check(
    'on-feature the road is NOT unchanged',
    liveRows === golden.liveRows && Math.abs(liveSum - golden.live) > 1,
    `${liveRows} rows, sum ${liveSum.toFixed(6)} vs golden ${golden.live.toFixed(6)} ` +
      `(${(((liveSum - golden.live) / golden.live) * 100).toFixed(2)}%)`,
  );
}

// ---------------------------------------------------------------------------
// Per-feature stretches
// ---------------------------------------------------------------------------

/** The first `count` events of one kind past `fromS`, over up to 20 000 km of road. */
function eventsOfKind(kind: VarietyKind, count: number, fromS: number): VarietyEvent[] {
  const out: VarietyEvent[] = [];
  for (let block = 0; block < 200 && out.length < count; block++) {
    const from = fromS + block * 100_000;
    for (const event of varietyEventsBetween(SEED, from, from + 100_000)) {
      if (event.kind !== kind) continue;
      // `varietyEventsBetween` reaches one window either side of its range, so the
      // event on a block boundary comes back twice — and always adjacently, because
      // both the blocks and the events inside them are in ascending arclength.
      if (out.length > 0 && out[out.length - 1]!.index === event.index) continue;
      out.push(event);
      if (out.length === count) break;
    }
  }
  if (out.length === 0) throw new Error(`no ${kind} events past ${fromS}`);
  return out;
}

interface VariantSample {
  /** The events to build and measure, in arclength order. */
  readonly events: readonly VarietyEvent[];
  /** How often each variant occurs over the whole scan, not just the sample. */
  readonly census: Record<string, number>;
}

/**
 * Up to `per` events of EACH variant of a kind, plus a census of the whole scan.
 *
 * Taking the first few events in arclength order is not a sample. On this seed the
 * first four patching events are all blob repairs, and eleven of the first twelve
 * marking events are ghosts, so the crack-sealing, cut-and-fill, double-line and
 * no-paint paths would all have gone unbuilt and unmeasured.
 */
function sampleByVariant(
  kind: VarietyKind,
  variantOf: (event: VarietyEvent) => string,
  per: number,
  /** Optional: skip events whose effect this tool cannot observe. See markingsShow. */
  accept?: (event: VarietyEvent) => boolean,
): VariantSample {
  const events: VarietyEvent[] = [];
  const census: Record<string, number> = {};
  const taken: Record<string, number> = {};
  for (const event of eventsOfKind(kind, 2000, 2000)) {
    const variant = variantOf(event);
    census[variant] = (census[variant] ?? 0) + 1;
    if (accept && !accept(event)) continue;
    if ((taken[variant] ?? 0) >= per) continue;
    taken[variant] = (taken[variant] ?? 0) + 1;
    events.push(event);
  }
  events.sort((a, b) => a.s - b.s);
  return { events, census };
}

/** "blobs 12, crack 9" for a printed line. */
function censusLine(census: Record<string, number>): string {
  return Object.entries(census)
    .map(([variant, n]) => `${variant} ${n}`)
    .join(', ');
}

interface Stretch {
  readonly rows: number;
  readonly columns: number;
  readonly rowS: Float64Array;
  readonly halfWidth: Float64Array;
  readonly lum: Float64Array;
  readonly warm: Float64Array;
  readonly lateral: Float64Array;
  readonly marks: readonly Mark[];
}

/** Every row of the chunks covering `[fromS, toS]`, as one flat table. */
function stretchOver(fromS: number, toS: number): Stretch {
  const first = Math.floor(fromS / CHUNK_LENGTH);
  const last = Math.floor(toS / CHUNK_LENGTH);
  const built: BuiltChunk[] = [];
  for (let chunk = first; chunk <= last; chunk++) built.push(buildChunk(chunk, true));
  const columns = EXPECT_COLUMNS;
  const rows = built.reduce((n, b) => n + b.rows, 0);
  const rowS = new Float64Array(rows);
  const halfWidth = new Float64Array(rows);
  const lum = new Float64Array(rows * columns);
  const warm = new Float64Array(rows * columns);
  const lateral = new Float64Array(rows * columns);
  const marks: Mark[] = [];
  let row = 0;
  for (const b of built) {
    for (let si = 0; si < b.rows; si++) {
      const s = b.sStart + (si * CHUNK_LENGTH) / (b.rows - 1);
      rowS[row] = s;
      halfWidth[row] = road.halfWidthAt(s);
      for (let li = 0; li < columns; li++) {
        lum[row * columns + li] = b.lum[si * columns + li]!;
        warm[row * columns + li] = b.warm[si * columns + li]!;
        lateral[row * columns + li] = b.lateral![si * columns + li]!;
      }
      row++;
    }
    for (const mark of b.marks) marks.push(mark);
  }
  return { rows, columns, rowS, halfWidth, lum, warm, lateral, marks };
}

/**
 * Per-column reference luminance, from the rows this kind never reaches. Undefined
 * columns cannot happen: the fixed section means every row has all fifteen.
 */
function referenceFor(st: Stretch, kind: VarietyKind): Float64Array {
  const ref = new Float64Array(st.columns);
  const n = new Float64Array(st.columns);
  for (let row = 0; row < st.rows; row++) {
    if (varietyEventOfKindAt(SEED, kind, st.rowS[row]!) !== null) continue;
    for (let li = 0; li < st.columns; li++) {
      ref[li]! += st.lum[row * st.columns + li]!;
      n[li]! += 1;
    }
  }
  for (let li = 0; li < st.columns; li++) ref[li]! /= Math.max(1, n[li]!);
  return ref;
}

const ratioScratch = new Float64Array(EXPECT_COLUMNS);

/**
 * Signed residual of one row against the reference, positive = darker than this row's
 * own overall level. The row's level is the median of its column ratios, so a feature
 * touching a few columns cannot move it.
 */
function rowResidual(st: Stretch, row: number, ref: Float64Array, out: Float64Array): void {
  for (let li = 0; li < st.columns; li++) {
    ratioScratch[li] = st.lum[row * st.columns + li]! / Math.max(1e-6, ref[li]!);
  }
  const sorted = Array.from(ratioScratch).sort((a, b) => a - b);
  const scale = sorted[sorted.length >> 1]!;
  for (let li = 0; li < st.columns; li++) {
    out[li] = 1 - ratioScratch[li]! / Math.max(1e-6, scale);
  }
}

const residual = new Float64Array(EXPECT_COLUMNS);

// ---------------------------------------------------------------------------
// 'patches': a repair is darker than the road it is on
// ---------------------------------------------------------------------------
console.log('');
console.log("'patches': mean lane luminance inside the repair against the same road outside");
/** Which repair an event draws, decided the way roadmesh.ts decides it. */
const patchVariant = (event: VarietyEvent): string =>
  event.draw < 0.44 ? 'blobs' : event.draw < 0.76 ? 'crack' : 'cut/fill';

let patchesChecked = 0;
let patchesDarker = 0;
let worstPatchDelta = Infinity;
const patches = sampleByVariant('patches', patchVariant, 2);
console.log(`  census over ${Object.values(patches.census).reduce((a, b) => a + b, 0)} events: ${censusLine(patches.census)}`);
for (const event of patches.events) {
  const reach = event.halfLength + event.ramp;
  const st = stretchOver(event.s - reach - 300, event.s + reach + 300);
  let inside = 0;
  let insideN = 0;
  let outside = 0;
  let outsideN = 0;
  // A crack line and a cut-and-fill are laid on ONE side of the crown, so the far
  // half of the mat is unrepaired road and averaging it in only dilutes the number
  // being measured. A blob field covers both halves and is measured across both.
  const oneSided = patchVariant(event) !== 'blobs';
  for (let row = 0; row < st.rows; row++) {
    const s = st.rowS[row]!;
    const live = varietyWeightAt(SEED, 'patches', s) > 0.9;
    const quiet = varietyEventOfKindAt(SEED, 'patches', s) === null;
    if (!live && !quiet) continue;
    for (let li = 0; li < st.columns; li++) {
      const lat = st.lateral[row * st.columns + li]!;
      // Lane only: the repair tapers out over the ravelled edge band, so including
      // the two outer columns would measure the taper, not the patch.
      if (Math.abs(lat) > st.halfWidth[row]! - 0.7) continue;
      if (oneSided && lat * event.side <= 0) continue;
      const v = st.lum[row * st.columns + li]!;
      if (live) {
        inside += v;
        insideN++;
      } else {
        outside += v;
        outsideN++;
      }
    }
  }
  const meanIn = inside / Math.max(1, insideN);
  const meanOut = outside / Math.max(1, outsideN);
  const delta = (meanOut - meanIn) / meanOut;
  const variant = patchVariant(event);
  console.log(
    `  s=${(event.s / 1000).toFixed(2)} km ${variant.padEnd(8)} ` +
      `inside ${meanIn.toFixed(4)}  outside ${meanOut.toFixed(4)}  darker by ${(delta * 100).toFixed(2)}%`,
  );
  patchesChecked++;
  if (delta > 0.02) patchesDarker++;
  if (delta < worstPatchDelta) worstPatchDelta = delta;
}
check(
  'every patching event darkens its lane',
  patchesChecked > 0 && patchesDarker === patchesChecked,
  `${patchesDarker}/${patchesChecked} events, weakest ${(worstPatchDelta * 100).toFixed(2)}% (must be > 2%)`,
);
check(
  'and all three repairs were measured',
  Object.keys(patches.census).length === 3 && patches.events.length === 6,
  `${patches.events.length} events over ${Object.keys(patches.census).length} variants`,
);

// ---------------------------------------------------------------------------
// 'skid': rubber goes where wheels go
// ---------------------------------------------------------------------------
console.log('');
console.log("'skid': where the ink lands, as a share of total rubber laid");
/** Which mark an event lays, decided the way roadmesh.ts decides it. */
const skidVariant = (event: VarietyEvent): string =>
  event.draw < 0.45 ? 'lock-up' : event.draw < 0.75 ? 'turn-around' : 'burnout';

let straightWheelWorst = 1;
let straightCrownWorst = 0;
let arcWheelWorst = 1;
let shoulderWorst = 0;
let straightSeen = 0;
let arcSeen = 0;
let inkSeen = 0;
const skids = sampleByVariant('skid', skidVariant, 2);
console.log(`  census over ${Object.values(skids.census).reduce((a, b) => a + b, 0)} events: ${censusLine(skids.census)}`);
for (const event of skids.events) {
  const reach = event.halfLength + event.ramp;
  const st = stretchOver(event.s - reach - 60, event.s + reach + 60);
  const ref = referenceFor(st, 'skid');
  let total = 0;
  let wheel = 0;
  let crown = 0;
  let shoulder = 0;
  for (let row = 0; row < st.rows; row++) {
    const s = st.rowS[row]!;
    if (varietyWeightAt(SEED, 'skid', s) <= 0) continue;
    rowResidual(st, row, ref, residual);
    const hw = st.halfWidth[row]!;
    const lane = laneOffsetFor(hw, 0) + WHEEL_BIAS;
    for (let li = 0; li < st.columns; li++) {
      const ink = residual[li]! - MOTTLE_FLOOR;
      if (ink <= 0) continue;
      const lat = st.lateral[row * st.columns + li]!;
      const a = Math.abs(lat);
      total += ink;
      const toWheel = Math.min(
        Math.abs(a - (lane - WHEEL_TRACK_HALF)),
        Math.abs(a - (lane + WHEEL_TRACK_HALF)),
      );
      if (toWheel <= WHEEL_TOLERANCE) wheel += ink;
      if (a <= CROWN_BAND) crown += ink;
      if (a >= hw - SHOULDER_BAND) shoulder += ink;
    }
  }
  const variant = skidVariant(event);
  const arc = variant === 'turn-around';
  const share = (v: number): string => `${((v / Math.max(1e-9, total)) * 100).toFixed(1)}%`;
  console.log(
    `  s=${(event.s / 1000).toFixed(2)} km ${variant.padEnd(11)} ` +
      `ink ${total.toFixed(1)}  wheel paths ${share(wheel).padStart(6)}  ` +
      `crown ${share(crown).padStart(6)}  shoulder ${share(shoulder).padStart(6)}`,
  );
  inkSeen += total;
  const wheelShare = wheel / Math.max(1e-9, total);
  shoulderWorst = Math.max(shoulderWorst, shoulder / Math.max(1e-9, total));
  if (arc) {
    arcSeen++;
    arcWheelWorst = Math.min(arcWheelWorst, wheelShare);
  } else {
    straightSeen++;
    straightWheelWorst = Math.min(straightWheelWorst, wheelShare);
    straightCrownWorst = Math.max(straightCrownWorst, crown / Math.max(1e-9, total));
  }
}
check(
  'rubber is actually laid',
  inkSeen > 0,
  `${inkSeen.toFixed(1)} total ink over the sampled events`,
);
check(
  'no rubber on the shoulder',
  shoulderWorst < 0.01,
  `worst ${(shoulderWorst * 100).toFixed(2)}% of an event's ink in the outer ${SHOULDER_BAND} m`,
);
check(
  'straight marks sit in a wheel path, not on the crown',
  straightSeen > 0 && straightWheelWorst > 0.85 && straightCrownWorst < 0.02,
  `${straightSeen} events, worst wheel share ${(straightWheelWorst * 100).toFixed(1)}%, ` +
    `worst crown share ${(straightCrownWorst * 100).toFixed(2)}%`,
);
// A turn-around HAS to cross the crown — that is what makes it an arc rather than a
// second lock-up — so it is held to the weaker claim that most of its rubber is still
// in a wheel path, which is what the smoothstep sweep buys.
check(
  'a turn-around still spends its rubber in wheel paths',
  arcSeen === 0 || arcWheelWorst > 0.5,
  arcSeen === 0
    ? 'no arc in the sample'
    : `${arcSeen} events, worst wheel share ${(arcWheelWorst * 100).toFixed(1)}%`,
);

// ---------------------------------------------------------------------------
// 'sandTongue': sand reaches in on one side only
// ---------------------------------------------------------------------------
//
// Measured as a LEFT-AGAINST-RIGHT comparison of the same row, in warmth. The section
// laterals are symmetric and every other thing the mat does across its width — the
// district's own sand wedge, wheel polish, dust, edge ravel — is a function of
// |lateral|, so all of it cancels and what is left in the difference is the tongue.
// No reference rows, no drift to correct for, and it reports the one number the
// feature is actually about: how far in, in metres, the sand got.
console.log('');
console.log("'sandTongue': how far the sand reaches in, windward against lee");
/**
 * Warmth by which a vertex must beat its mirror to count as sanded, absolutely and as
 * a share of its own warmth. The relative gate is what makes this work on a district
 * that is ALREADY sanded at both edges: there both mirrors sit near 0.9 warmth, and
 * the 2D mottling is a brightness multiplier, so it alone put 0.1 of warmth between
 * them — enough to clear an absolute gate and read as a tongue on the lee side.
 */
const SANDED_WARMTH = 0.05;
const SANDED_SHARE = 0.35;
let tongueChecked = 0;
let tongueOk = 0;
let worstReach = Infinity;
let worstLeak = 0;
// Two per SIDE, not the first four: every sandTongue event on the early road happens
// to be windward-right, and a sign error in the side test would have been invisible.
const tongues = sampleByVariant('sandTongue', (event) => (event.side > 0 ? 'left' : 'right'), 2);
console.log(`  census over ${Object.values(tongues.census).reduce((a, b) => a + b, 0)} events: ${censusLine(tongues.census)}`);
for (const event of tongues.events) {
  const span = event.halfLength + event.ramp;
  const st = stretchOver(event.s - span - 200, event.s + span + 200);
  let insideReach = 0;
  let insideLee = 0;
  let outsideReach = 0;
  let fingerRows = 0;
  let liveRowCount = 0;
  for (let row = 0; row < st.rows; row++) {
    const s = st.rowS[row]!;
    const live = varietyWeightAt(SEED, 'sandTongue', s) > 0.5;
    const quiet = varietyEventOfKindAt(SEED, 'sandTongue', s) === null;
    if (!live && !quiet) continue;
    const hw = st.halfWidth[row]!;
    let reachWind = 0;
    let reachLee = 0;
    for (let li = 0; li < st.columns; li++) {
      const lat = st.lateral[row * st.columns + li]!;
      const delta =
        st.warm[row * st.columns + li]! - st.warm[row * st.columns + (st.columns - 1 - li)]!;
      if (delta <= SANDED_WARMTH) continue;
      if (delta <= SANDED_SHARE * st.warm[row * st.columns + li]!) continue;
      // Reach is measured from the asphalt edge inward, which is the direction the
      // sand travels and the number the feature is specified in.
      const reach = hw - Math.abs(lat);
      if (lat * event.side > 0) reachWind = Math.max(reachWind, reach);
      else reachLee = Math.max(reachLee, reach);
    }
    if (live) {
      liveRowCount++;
      if (reachWind > 0) fingerRows++;
      insideReach = Math.max(insideReach, reachWind);
      insideLee = Math.max(insideLee, reachLee);
    } else {
      outsideReach = Math.max(outsideReach, Math.max(reachWind, reachLee));
    }
  }
  console.log(
    `  s=${(event.s / 1000).toFixed(2)} km side ${event.side > 0 ? 'left ' : 'right'} ` +
      `reaches ${insideReach.toFixed(2)} m in on ${((fingerRows / Math.max(1, liveRowCount)) * 100).toFixed(0)}% of its rows  ` +
      `lee ${insideLee.toFixed(2)} m  off-event ${outsideReach.toFixed(2)} m`,
  );
  tongueChecked++;
  // One lane is 2.9 m and a tongue is capped just short of the crown, so "across a
  // lane" means better than a metre of reach at its strongest finger.
  if (insideReach > 1 && insideLee === 0 && outsideReach === 0) tongueOk++;
  worstReach = Math.min(worstReach, insideReach);
  worstLeak = Math.max(worstLeak, Math.max(insideLee, outsideReach));
}
check(
  'a tongue reaches across a lane on its own side',
  tongueChecked > 0 && tongueOk === tongueChecked,
  `${tongueOk}/${tongueChecked} events, weakest reach ${worstReach.toFixed(2)} m (must be > 1 m)`,
);
check(
  'and neither the lee side nor the road outside is sanded',
  worstLeak === 0,
  `worst leak ${worstLeak.toFixed(2)} m`,
);

// ---------------------------------------------------------------------------
// 'markings': the paint changes over the span, and only there
// ---------------------------------------------------------------------------
console.log('');
console.log("'markings': the changed pattern, row by row, against its snapped span");

/** The variant a marking event runs, decided the way roadmesh.ts decides it. */
function markingVariant(event: VarietyEvent): 'double' | 'none' | 'rumble' | 'ghost' {
  if (roadConditionAt(event.s).markings < PAINT_EFFECTIVE) return 'ghost';
  return event.draw < 0.34 ? 'double' : event.draw < 0.67 ? 'none' : 'rumble';
}

/**
 * Is this event's effect observable at all?
 *
 * A change of paint can only be SEEN where the road's own paint state is the same on
 * both sides of the boundary. A 'none' span sitting inside a stretch the road already
 * paints nothing on silences paint that was not there — real, correct, and invisible;
 * a tool that scored it would be scoring how worn the district is. Measured on seed 7:
 * 91% of the rows outside one such span were bare anyway, so the boundary did not
 * exist to find.
 */
function markingsShow(event: VarietyEvent): boolean {
  const from = Math.round((event.s - event.halfLength) / MARKING_SNAP_M) * MARKING_SNAP_M;
  const to = Math.round((event.s + event.halfLength) / MARKING_SNAP_M) * MARKING_SNAP_M;
  // A ghost needs a bare neighbourhood to appear against; every other variant needs a
  // painted one to change.
  const wantPaint = markingVariant(event) !== 'ghost';
  for (let s = from - 260; s <= to + 260; s += 20) {
    if ((roadConditionAt(s).markings >= PAINT_EFFECTIVE) !== wantPaint) return false;
  }
  return true;
}

let markingsChecked = 0;
let markingsChanged = 0;
let markingsStepped = 0;
let worstInsideShare = 1;
let worstContrast = Infinity;
let worstStep = 1;
const markings = sampleByVariant('markings', markingVariant, 2, markingsShow);
console.log(`  census over ${Object.values(markings.census).reduce((a, b) => a + b, 0)} events: ${censusLine(markings.census)}`);
/**
 * Metres either side of a boundary the step is measured across.
 *
 * Nearly a hundred, not the fifty it started at, because the paint's own wear field
 * has an 11 m wavelength and a solid line on this road comes and goes with it: a 48 m
 * window landing on one long gap read a 74%-painted span as an 11% step.
 */
const STEP_WINDOW_M = 96;
for (const event of markings.events) {
  const variant = markingVariant(event);
  const from = Math.round((event.s - event.halfLength) / MARKING_SNAP_M) * MARKING_SNAP_M;
  const to = Math.round((event.s + event.halfLength) / MARKING_SNAP_M) * MARKING_SNAP_M;
  const st = stretchOver(from - 260, to + 260);

  // Marking quads bucketed onto the row that emitted them. A quad spans [s, s+step],
  // so its CENTRE is half a step along and `floor` recovers the row index while
  // `round` would land on the next one half the time — which is exactly what made a
  // clean boundary look like it leaked one row past the span.
  const perRow = new Map<number, Mark[]>();
  for (const mark of st.marks) {
    const key = Math.floor(mark.s / SURFACE_STEP);
    const list = perRow.get(key);
    if (list) list.push(mark);
    else perRow.set(key, [mark]);
  }

  // Per-row signature of the variant: the pattern only this variant paints.
  const changed = new Uint8Array(st.rows);
  for (let row = 0; row < st.rows; row++) {
    const s = st.rowS[row]!;
    const marks = perRow.get(Math.round(s / SURFACE_STEP)) ?? [];
    const hw = st.halfWidth[row]!;
    if (variant === 'double') {
      changed[row] = marks.some((m) => Math.abs(Math.abs(m.lateral) - 0.17) < 0.03) ? 1 : 0;
    } else if (variant === 'rumble') {
      changed[row] = marks.some((m) => Math.abs(Math.abs(m.lateral) - (hw - 0.52)) < 0.05) ? 1 : 0;
    } else if (variant === 'ghost') {
      // A ghost paints a crown line where the road's own rule paints nothing, so a
      // quad existing at all is the signature.
      changed[row] = marks.length > 0 ? 1 : 0;
    } else {
      changed[row] = marks.length === 0 ? 1 : 0;
    }
  }

  /** Share of rows in [a, b) carrying the variant's signature. */
  const shareIn = (a: number, b: number): number => {
    let n = 0;
    let hit = 0;
    for (let row = 0; row < st.rows; row++) {
      const s = st.rowS[row]!;
      if (s < a || s >= b) continue;
      n++;
      hit += changed[row]!;
    }
    return n === 0 ? 0 : hit / n;
  };

  const inside = shareIn(from, to);
  const outside = Math.max(shareIn(from - 250, from), shareIn(to, to + 250));
  // THE BOUNDARY TEST. A hard edge makes the signature jump across one row; a fade
  // would spread the same change over the 40 m ramp and leave both halves of this
  // window looking alike. Measured at both ends, as the smaller of the two jumps.
  const step = Math.min(
    shareIn(from, from + STEP_WINDOW_M) - shareIn(from - STEP_WINDOW_M, from),
    shareIn(to - STEP_WINDOW_M, to) - shareIn(to, to + STEP_WINDOW_M),
  );
  console.log(
    `  s=${(event.s / 1000).toFixed(2)} km ${variant.padEnd(6)} span ${from}..${to} m  ` +
      `signature on ${(inside * 100).toFixed(0)}% inside, ${(outside * 100).toFixed(0)}% outside  ` +
      `step ${(step * 100).toFixed(0)}%`,
  );
  markingsChecked++;
  // Forty percentage points of separation, not a ratio: the 'none' variant's own
  // signature is "nothing painted here", and on a worn district nearly half the rows
  // outside the span paint nothing either, purely by paint wear. A ratio test there
  // would be measuring how worn the district is. The step test pins the edge.
  if (inside > 0.8 && inside - outside > 0.4) markingsChanged++;
  if (step > 0.5) markingsStepped++;
  worstInsideShare = Math.min(worstInsideShare, inside);
  worstContrast = Math.min(worstContrast, inside - outside);
  worstStep = Math.min(worstStep, step);
}
check(
  'a marking event changes the pattern over its span, and only there',
  markingsChecked > 0 && markingsChanged === markingsChecked,
  `${markingsChanged}/${markingsChecked} events, weakest ${(worstInsideShare * 100).toFixed(0)}% inside, ` +
    `narrowest inside-minus-outside gap ${(worstContrast * 100).toFixed(0)} points`,
);
check(
  'and the change happens at one hard edge',
  markingsChecked > 0 && markingsStepped === markingsChecked,
  `${markingsStepped}/${markingsChecked} events step, smallest step ${(worstStep * 100).toFixed(0)}% ` +
    `across ${STEP_WINDOW_M} m either side (a 40 m fade could not)`,
);
// A variant that never fires is a variant nobody has measured, so the sample hunts
// for all four and this is what says it found them.
check(
  'all four marking variants were measured',
  Object.keys(markings.census).length === 4 && markings.events.length === 8,
  `${markings.events.length} events over ${Object.keys(markings.census).length} variants`,
);

console.log('');
console.log(
  failures === 0
    ? 'the asphalt changes where the director says it does'
    : `${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
