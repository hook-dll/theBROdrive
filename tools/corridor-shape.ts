/**
 * tools/corridor-shape.ts
 *
 * Does the ground beside the road actually do what the director scheduled?
 *
 * The variety director promises a horizon event every few kilometres; two of its
 * kinds — `cut`, `embankment` — are modulations of the corridor ground in
 * `src/world/corridorshape.ts`, applied by the real `Terrain`. This drives those
 * shipped classes over real events on real seeds and measures the five things that can
 * each turn the feature into a defect:
 *
 *   reaches      a cut's crest and an embankment's trough are the height the kind
 *                promises (3 + draw * 4, -(2 + draw * 3)) at a lateral the driver can
 *                see them at
 *   continuous   no step along the road anywhere across the feature or its ramps. A
 *                slope is not a step, so this measures both: the worst 1 m difference,
 *                and the same difference resampled sixteen times finer, which shrinks
 *                by sixteen for a slope and not at all for a jump
 *   flush        the asphalt edge keeps the height it had — the road's own elevation
 *                is not allowed to move, and the terrain has to meet it
 *   walkable     the 4 m of verge outside the paint is untouched, so the 3.1 m pole
 *                line and the birds perching 0.7-2.4 m out are neither buried nor left
 *                standing in the air
 *   drawn        the height is in the DRAWN MESH, not just in the field: the built
 *                chunk's own vertices, which are what the collider is baked from
 *
 * A third kind, `outcrop`, is NOT walked: the country switched its rock shelves off in
 * two places (director weight 0, `terrain.ts` belt amplitude 0), so the check here is
 * that no belt appears at all. Two measurements also exclude the watercourse: a stream
 * is a term of the base field the road is graded across, and a bridge's ground is its
 * own bed on purpose — neither is the corridor landform's roughness.
 *
 *   npx tsx tools/corridor-shape.ts
 *
 * Nothing here is part of the game bundle.
 */

import type { BufferGeometry } from 'three';
import { SurfaceType } from '../src/core/surfaces';
import type { ChunkContext } from '../src/world/chunks';
import { CHUNK_LENGTH } from '../src/world/chunks';
import { CORRIDOR_KEEP_M, CORRIDOR_REACH_M } from '../src/world/corridorshape';
import { varietyEventsBetween, type VarietyEvent, type VarietyKind } from '../src/world/director';
import { Road } from '../src/world/road';
import { RoadDistance } from '../src/world/roaddistance';
import { roadSurfaceY, SurfaceField } from '../src/world/roadsurface';
import { DETAIL_HOLD, Terrain } from '../src/world/terrain';
import { drawnGroundY, fieldRings, TerrainMeshProvider } from '../src/world/terrainmesh';

const SEEDS = [1, 7, 42, 1337];
/** Events of each kind to walk per seed. Enough to see several rolls of `draw`. */
const EVENTS_PER_KIND = 3;

/** Lateral band a crest or trough has to land in to be part of the view. */
const CREST_MIN_LATERAL = 25;
const CREST_MAX_LATERAL = 40;
/** How close the measured crest has to be to the height the kind promises, metres. */
const HEIGHT_TOLERANCE = 0.01;

/**
 * Longitudinal sample step for the continuity walk, and the refinement it is checked
 * against. Sixteen is chosen so a genuine slope's step shrinks by a factor the noise
 * floor cannot fake and a genuine discontinuity's does not shrink at all.
 */
const WALK_STEP = 1;
const REFINE = 16;
/**
 * Metres per metre of road a BATTER is allowed to move.
 *
 * Not a smoothness fudge: it is what the director's own ramp asks for. The tallest cut
 * is 7 m and its ramp is 70 m, and a smoothstep's steepest point is 1.5 times its mean,
 * so 0.15 m/m is the ramp doing exactly its job. Anything past this is either a step or
 * a feature steeper than the schedule that carries it.
 */
const SLOPE_LIMIT = 0.16;
/**
 * The same for a BELT, which has a second gradient the batters do not: the rock field's
 * own edge. A shelf is supposed to have one. The bound is what `tools/terrain-overlap.ts`
 * calls the most a single continuous surface may climb, so what this rejects is a belt
 * that has stopped being ground; whether it is CONTINUOUS is the refinement below.
 */
const BELT_SLOPE_LIMIT = 0.7;
/** Metres of rock a belt has to stand up SOMEWHERE in it to count as having happened. */
const BELT_MIN_RISE = 1.2;
/** Height the asphalt edge may move by. A centimetre is below the surface field's own texture. */
const EDGE_TOLERANCE = 0.01;
/** Height a built mesh vertex may differ from `drawnGroundY` by: the position interpolation
 *  inside a refined quad plus the projection used to recover its frame. */
const MESH_TOLERANCE = 0.15;

const CHANNEL_KINDS: readonly VarietyKind[] = ['cut', 'embankment', 'outcrop'];
/** Paint-edge samples left out because the road is over its own bed there (a bridge). */
let bridgedEdgeSamples = 0;

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(44)} ${detail}`);
}

/** The height the kind promises at full weight, metres. Straight from the ticket, not
 *  from corridorshape.ts: a check that reads its own constants proves nothing. */
function promisedHeight(event: VarietyEvent): number {
  if (event.kind === 'cut') return 3 + event.draw * 4;
  if (event.kind === 'embankment') return -(2 + event.draw * 3);
  return 0;
}

function fakeContext(chunkIndex: number, road: Road, terrain: Terrain): ChunkContext {
  return {
    chunkIndex,
    sStart: Math.max(0, chunkIndex * CHUNK_LENGTH),
    sEnd: Math.min(road.length, (chunkIndex + 1) * CHUNK_LENGTH),
    road,
    terrain,
    hasPhysics: false,
    // Providers subtract these from every f32 they write. Zero keeps the buffer in
    // world coordinates, which is what every comparison below is in.
    originX: 0,
    originZ: 0,
  } as unknown as ChunkContext;
}

// -- what the lattice under this feature looks like ---------------------------

{
  const { magnitudes } = fieldRings();
  const near = magnitudes.filter((m) => m <= CORRIDOR_REACH_M + 20);
  const spacings = near.slice(1).map((m, i) => m - near[i]!);
  console.log('the field lattice across the feature band, metres from the centreline');
  console.log(`  rings    ${near.map((m) => m.toFixed(1)).join(' ')}`);
  console.log(`  spacing  ${spacings.map((m) => m.toFixed(1)).join(' ')}`);
  console.log(
    '  a crest chorded on the widest of those misses its own surface by decimetres,\n' +
      '  which is why the landform rides in the detail layer (resampled at 2.67 m by the\n' +
      '  refined grid, 3 m by the desert tiles) and not in the base field.\n',
  );
  check(
    'the landform ends where the detail layer holds',
    CORRIDOR_REACH_M === DETAIL_HOLD,
    `CORRIDOR_REACH_M ${CORRIDOR_REACH_M} against DETAIL_HOLD ${DETAIL_HOLD}`,
  );
  console.log('');
}

// -- the walk -----------------------------------------------------------------

interface Worst {
  value: number;
  seed: number;
  s: number;
  lateral: number;
}

const worstHeightError: Worst = { value: 0, seed: 0, s: 0, lateral: 0 };
const worstBatterStep: Worst = { value: 0, seed: 0, s: 0, lateral: 0 };
const worstBeltStep: Worst = { value: 0, seed: 0, s: 0, lateral: 0 };
const worstRefined: Worst = { value: 0, seed: 0, s: 0, lateral: 0 };
const worstOpenGroundStep: Worst = { value: 0, seed: 0, s: 0, lateral: 0 };
const worstFeatureGroundStep: Worst = { value: 0, seed: 0, s: 0, lateral: 0 };
const worstVerge: Worst = { value: 0, seed: 0, s: 0, lateral: 0 };
const worstEdge: Worst = { value: 0, seed: 0, s: 0, lateral: 0 };
const worstMesh: Worst = { value: 0, seed: 0, s: 0, lateral: 0 };

function record(into: Worst, value: number, seed: number, s: number, lateral: number): void {
  if (value <= into.value) return;
  into.value = value;
  into.seed = seed;
  into.s = s;
  into.lateral = lateral;
}

let crestsInBand = 0;
let crestsChecked = 0;
let beltsScanned = 0;
let beltsTooThin = 0;
let worstBeltRise = 0;
let weakestBelt = Number.POSITIVE_INFINITY;
let weakestBeltAt = 0;
let meshVerticesChecked = 0;
let worstMeshCrest = 0;

for (const seed of SEEDS) {
  const road = new Road(seed);
  const terrain = new Terrain(seed, road);
  const roadDistance = new RoadDistance(road);
  const provider = new TerrainMeshProvider(roadDistance);
  const field = new SurfaceField(seed);

  const events = varietyEventsBetween(seed, 0, 400_000).filter((e) =>
    CHANNEL_KINDS.includes(e.kind),
  );
  const picked: VarietyEvent[] = [];
  for (const kind of CHANNEL_KINDS) {
    for (const event of events.filter((e) => e.kind === kind).slice(0, EVENTS_PER_KIND)) {
      picked.push(event);
    }
  }

  for (const event of picked) {
    const halfWidth = road.halfWidthAt(event.s);
    const promised = promisedHeight(event);

    // -- crest / trough -----------------------------------------------------
    // At the event's centre the director's weight is exactly 1, so whatever the lateral
    // profile peaks at IS the kind's promised height. Walked at a quarter metre so the
    // lateral the peak lands at is a measurement and not a guess.
    let peak = 0;
    let peakLateral = 0;
    for (let dist = halfWidth; dist <= CORRIDOR_REACH_M; dist += 0.25) {
      const p = road.offsetPoint(event.s, dist);
      const shape = terrain.corridorShapeAt(p.x, p.z, dist, event.s);
      if (Math.abs(shape) > Math.abs(peak)) {
        peak = shape;
        peakLateral = dist;
      }
    }

    if (event.kind === 'outcrop') {
      // A belt is rock standing up, so its height is whatever the rock field had to
      // work with here rather than a number the kind promises. What has to be true is
      // that something stood up at all, and that the ground it stood up is classified
      // as rock rather than left as a sand-coloured ramp. Every belt in 400 km is
      // checked for that further down; this prints the ones being walked.
      let rockSamples = 0;
      let beltPeak = 0;
      for (let ds = -event.halfLength; ds <= event.halfLength; ds += 9) {
        const s = event.s + ds;
        const inner = road.halfWidthAt(s);
        for (const side of [-1, 1]) {
          for (let over = CORRIDOR_KEEP_M; over + inner <= CORRIDOR_REACH_M; over += 3) {
            const dist = inner + over;
            const p = road.offsetPoint(s, side * dist);
            const rise = terrain.corridorShapeAt(p.x, p.z, dist, s);
            if (rise > beltPeak) beltPeak = rise;
            if (terrain.surfaceFromFrame(p.x, p.z, side * dist, s) === SurfaceType.Rock) {
              rockSamples++;
            }
          }
        }
      }
      console.log(
        `seed ${seed} ${event.kind.padEnd(10)} at ${(event.s / 1000).toFixed(1)} km  ` +
          `span ${(event.halfLength * 2).toFixed(0)} m  tallest shelf ${beltPeak.toFixed(2)} m  ` +
          `rock samples ${rockSamples}`,
      );
    } else {
      crestsChecked++;
      if (peakLateral >= CREST_MIN_LATERAL && peakLateral <= CREST_MAX_LATERAL) crestsInBand++;
      record(worstHeightError, Math.abs(peak - promised), seed, event.s, peakLateral);
      console.log(
        `seed ${seed} ${event.kind.padEnd(10)} at ${(event.s / 1000).toFixed(1)} km  ` +
          `span ${(event.halfLength * 2).toFixed(0)} m  promised ${promised.toFixed(2)} m  ` +
          `measured ${peak.toFixed(2)} m at ${peakLateral.toFixed(1)} m lateral`,
      );
    }

    // -- continuity along the road, and the verge -----------------------------
    // Walked well past both ramps so the joins at either end are inside the window,
    // and at laterals that straddle the whole profile: the pole line, the batter, the
    // crest, the outer flank and open desert past the feature's reach.
    const from = event.s - event.halfLength - event.ramp - 80;
    const to = event.s + event.halfLength + event.ramp + 80;
    const overs = [3.1, 8, 14, 22, 30, 45, 58, 70];
    for (const side of [-1, 1]) {
      for (const over of overs) {
        let previous = Number.NaN;
        for (let s = from; s <= to; s += WALK_STEP) {
          const inner = road.halfWidthAt(s);
          const dist = inner + over;
          const p = road.offsetPoint(s, side * dist);
          const shape = terrain.corridorShapeAt(p.x, p.z, dist, s);
          if (over <= CORRIDOR_KEEP_M) {
            // The verge is not "small enough", it is untouched: the profile is exactly
            // zero inside the keep-out, so the pole line and the birds stand on the
            // same ground they stood on before the director scheduled anything.
            record(worstVerge, Math.abs(shape), seed, s, side * dist);
          }
          if (Number.isFinite(previous)) {
            // Split, because the two have different budgets and the same check would
            // hide both: a batter's gradient is the director's ramp and nothing else,
            // while a belt's is the rock field's own edge, which is allowed to be a
            // shelf. Continuity for both is the refinement below, not this number.
            record(
              event.kind === 'outcrop' ? worstBeltStep : worstBatterStep,
              Math.abs(shape - previous),
              seed,
              s,
              side * dist,
            );
          }
          previous = shape;
        }
      }
    }

    // -- and the whole ground, not just the term added to it -------------------
    // The landform's own step is what this feature is responsible for, but what the
    // player drives past is the sum. Walked at the crest lateral over the same range,
    // splitting the samples by whether the landform is running there, so the two
    // numbers say directly what the feature costs the desert in smoothness.
    //
    // THE WATERCOURSE IS NOT THE FEATURE'S ROUGHNESS. A stream cuts through the corridor
    // wherever it likes (`relief` carves its bed and its valley right through the graded
    // ground, because the road goes over it), and its bank is a term of the SAME base the
    // open walk measures — measured at seed 1337, s 18.55 km, the ground 30 m outside the
    // paint falls 1.9 m, 2.2 m and 1.1 m over three consecutive metres where the reach's
    // edge crosses, with the landform's own contribution flat at 4.06 m across it. Counting
    // that against the landform measures the stream, so a sample standing in a watercourse
    // ends the run: no step across one is recorded at all.
    for (const side of [-1, 1]) {
      let previous = Number.NaN;
      let previousBase = Number.NaN;
      let previousShape = 0;
      for (let s = from; s <= to; s += WALK_STEP) {
        const dist = road.halfWidthAt(s) + 30;
        const p = road.offsetPoint(s, side * dist);
        const shape = terrain.corridorShapeAt(p.x, p.z, dist, s);
        const base = terrain.baseFromFrame(p.x, p.z, side * dist, s);
        const ground = terrain.explorationHeightFromFrame(p.x, p.z, side * dist, s);
        const stream = road.landscape.streams.at(p.x, p.z);
        const inWater = stream.bed > 0 || stream.bowl > 0 || stream.span > 0;
        if (Number.isFinite(previous) && !inWater) {
          // THE FEATURE LIVES IN THE DETAIL LAYER, so what it costs is the step that layer
          // adds on top of the ground it was added to: `explorationHeightFromFrame` minus
          // `baseFromFrame` IS the detail layer, so the difference of the two steps is its
          // own. Measuring the whole ground instead charges the landform for the base's own
          // roughness — a moraine edge or a ravine wall that happens to fall inside the
          // feature's span — which is why this measured 0.70 m against the open ground's
          // own 0.40 m before it was split.
          const extra = Math.abs((ground - previous) - (base - previousBase));
          if (shape === 0 && previousShape === 0) {
            record(worstOpenGroundStep, Math.abs(base - previousBase), seed, s, side * dist);
          } else {
            record(worstFeatureGroundStep, extra, seed, s, side * dist);
          }
        }
        previous = inWater ? Number.NaN : ground;
        previousBase = inWater ? Number.NaN : base;
        previousShape = shape;
      }
    }

    // -- the same steps, sixteen times finer ---------------------------------
    // A slope's difference shrinks with the step; a discontinuity's does not. Measured
    // across the whole walk rather than at the worst point alone, because a jump can
    // sit anywhere in a ramp.
    for (const over of [22, 30, 45]) {
      for (let s = from; s <= to; s += WALK_STEP) {
        const inner = road.halfWidthAt(s);
        const dist = inner + over;
        const a = road.offsetPoint(s, dist);
        const b = road.offsetPoint(s + WALK_STEP / REFINE, dist);
        const step = Math.abs(
          terrain.corridorShapeAt(b.x, b.z, dist, s + WALK_STEP / REFINE) -
            terrain.corridorShapeAt(a.x, a.z, dist, s),
        );
        record(worstRefined, step, seed, s, dist);
      }
    }

    // -- the asphalt edge -----------------------------------------------------
    // The road's own elevation is the thing this design refuses to move. Compared
    // against `roadSurfaceY` — the function the ribbon itself is built from — just
    // outside the paint, inside the feature and 400 m clear of it.
    //
    // EXCEPT WHERE THE ROAD DELIBERATELY STEPS ASIDE. Where the road spans its own bed
    // (`span > 0`, `gradedBase`) the ground under and beside the deck IS the bed, however
    // deep it has been cut — that is what a bridge is, and `streamcrossings.ts` builds the
    // structure there. Measured at seed 7, s 6.4 km: span 1.0 at the paint edge and the
    // ground 2.9 m below the ribbon, on an embankment event, with no defect anywhere — the
    // grading is not carrying that reach, the structure is. Those samples are skipped and
    // counted, so a reach that stopped being bridged would show up as a step here again.
    for (const s of [event.s, event.s + event.halfLength * 0.5, to + 200]) {
      const inner = road.halfWidthAt(s);
      for (const side of [-1, 1]) {
        const edge = road.offsetPoint(s, side * inner);
        const ribbon = roadSurfaceY(road, field, s, side * inner, edge.x, edge.z);
        const just = inner + 0.02;
        const p = road.offsetPoint(s, side * just);
        const span = road.landscape.streams.at(p.x, p.z).span;
        if (span > 0) {
          bridgedEdgeSamples++;
          continue;
        }
        const ground = terrain.explorationHeightFromFrame(p.x, p.z, side * just, s);
        record(worstEdge, Math.abs(ground - ribbon), seed, s, side * just);
      }
    }

    // -- the drawn mesh -------------------------------------------------------
    // The field is not what the player stands on: the chunk's own vertices are, and
    // the collider is baked from those same vertices. Build the real chunk over the
    // event's centre and compare every drawn vertex in the corridor with
    // `drawnGroundY`, the function props and scatter place against.
    {
      const chunkIndex = Math.floor(event.s / CHUNK_LENGTH);
      const content = provider.build(fakeContext(chunkIndex, road, terrain));
      if (content) {
        const mesh = content.group.children[0] as unknown as { geometry: BufferGeometry };
        const geometry = mesh.geometry;
        const position = geometry.getAttribute('position');
        const index = geometry.getIndex();
        if (index) {
          const drawnVertices = new Set<number>();
          for (let i = 0; i < index.count; i++) drawnVertices.add(index.getX(i));
          let hint = chunkIndex * CHUNK_LENGTH + CHUNK_LENGTH * 0.5;
          for (const vi of drawnVertices) {
            const x = position.getX(vi);
            const z = position.getZ(vi);
            const projection = road.project(x, z, hint);
            const dist = Math.abs(projection.lateral);
            if (dist <= CORRIDOR_KEEP_M + 4 || dist >= CORRIDOR_REACH_M) continue;
            hint = projection.s;
            const expected = drawnGroundY(road, terrain, roadDistance, projection.s, projection.lateral);
            record(worstMesh, Math.abs(position.getY(vi) - expected), seed, projection.s, projection.lateral);
            meshVerticesChecked++;
            const carried = Math.abs(
              terrain.corridorShapeAt(x, z, dist, projection.s),
            );
            if (carried > worstMeshCrest) worstMeshCrest = carried;
          }
        }
        content.dispose?.();
      }
    }
  }

  // -- every belt in 400 km, not just the ones walked ------------------------
  // THE COUNTRY HAS NO ROCK BELTS, and that is what this counts. The desert scheduled
  // `outcrop` events and expected each one to stand real rock up beside the road; the
  // country switched the whole path off in two places and both are deliberate — the
  // director's weight for the kind is 0 (`world/director.ts`), so no event is ever rolled,
  // and `terrain.ts`'s `OUTCROP_BELT_AMPLITUDE` is 0, so an event would add nothing to the
  // height if one were. The walk below therefore finds nothing to walk, and the check is
  // that it keeps finding nothing: turning either switch back on has to come here and say
  // what a belt is supposed to measure, rather than silently re-enabling a feature whose
  // rock was left in the desert.
  for (const event of events.filter((e) => e.kind === 'outcrop')) {
    beltsScanned++;
    let tallest = 0;
    for (let ds = -event.halfLength; ds <= event.halfLength; ds += 8) {
      const s = event.s + ds;
      const inner = road.halfWidthAt(s);
      for (const side of [-1, 1]) {
        for (let over = CORRIDOR_KEEP_M; over + inner <= CORRIDOR_REACH_M; over += 4) {
          const dist = inner + over;
          const p = road.offsetPoint(s, side * dist);
          const rise = terrain.corridorShapeAt(p.x, p.z, dist, s);
          if (rise > tallest) tallest = rise;
        }
      }
    }
    if (tallest > worstBeltRise) worstBeltRise = tallest;
    if (tallest < weakestBelt) {
      weakestBelt = tallest;
      weakestBeltAt = event.s;
    }
    if (tallest < BELT_MIN_RISE) beltsTooThin++;
  }
}
console.log('');
console.log('worst measurement over every event walked');
console.log(
  `  crest height error   ${worstHeightError.value.toFixed(4)} m  ` +
    `(seed ${worstHeightError.seed} at ${(worstHeightError.s / 1000).toFixed(1)} km)`,
);
console.log(
  `  step per ${WALK_STEP} m, batter  ${worstBatterStep.value.toFixed(4)} m  ` +
    `(seed ${worstBatterStep.seed} at ${(worstBatterStep.s / 1000).toFixed(1)} km, ` +
    `lateral ${worstBatterStep.lateral.toFixed(1)} m)`,
);
console.log(
  `  step per ${WALK_STEP} m, belt    ${worstBeltStep.value.toFixed(4)} m  ` +
    `(seed ${worstBeltStep.seed} at ${(worstBeltStep.s / 1000).toFixed(1)} km, ` +
    `lateral ${worstBeltStep.lateral.toFixed(1)} m)`,
);
console.log(
  `  step per ${(WALK_STEP / REFINE).toFixed(4)} m   ${worstRefined.value.toFixed(4)} m  ` +
    `(${(worstRefined.value / Math.max(worstBatterStep.value, worstBeltStep.value, 1e-9)).toFixed(3)} ` +
    `of the 1 m step; a slope gives ${(1 / REFINE).toFixed(3)})`,
);
console.log(
  `  whole ground at the crest lateral, worst step per ${WALK_STEP} m:\n` +
    `    landform's own cost       ${worstFeatureGroundStep.value.toFixed(4)} m` +
    `   (seed ${worstFeatureGroundStep.seed} at ${(worstFeatureGroundStep.s / 1000).toFixed(1)} km)\n` +
    `    the ground it sits on    ${worstOpenGroundStep.value.toFixed(4)} m` +
    `   (seed ${worstOpenGroundStep.seed} at ${(worstOpenGroundStep.s / 1000).toFixed(1)} km)`,
);
console.log(`  verge band movement  ${worstVerge.value.toFixed(6)} m`);
console.log(
  `  asphalt edge         ${worstEdge.value.toFixed(4)} m  ` +
    `(seed ${worstEdge.seed} at ${(worstEdge.s / 1000).toFixed(1)} km; ` +
    `${bridgedEdgeSamples} samples skipped as bridged reaches)`,
);
console.log(
  `  mesh against field   ${worstMesh.value.toFixed(4)} m over ${meshVerticesChecked} drawn vertices  ` +
    `(tallest landform on a drawn vertex ${worstMeshCrest.toFixed(2)} m)`,
);
console.log(
  `  belts in 400 km      ${beltsScanned} over ${SEEDS.length} seeds` +
    (beltsScanned === 0
      ? ' (none scheduled)'
      : `, tallest shelf ${worstBeltRise.toFixed(2)} m, thinnest belt ` +
        `${weakestBelt.toFixed(2)} m (at ${(weakestBeltAt / 1000).toFixed(1)} km)`),
);
console.log('');

check(
  'crests and troughs reach their height',
  worstHeightError.value <= HEIGHT_TOLERANCE,
  `worst ${worstHeightError.value.toFixed(4)} m against ${HEIGHT_TOLERANCE} m`,
);
check(
  'they reach it where the driver sees it',
  crestsInBand === crestsChecked && crestsChecked > 0,
  `${crestsInBand}/${crestsChecked} peaked between ${CREST_MIN_LATERAL} and ${CREST_MAX_LATERAL} m`,
);
check(
  'a batter is the ramp and nothing steeper',
  worstBatterStep.value <= SLOPE_LIMIT,
  `worst ${worstBatterStep.value.toFixed(4)} m per ${WALK_STEP} m against ${SLOPE_LIMIT} m`,
);
check(
  'a belt is a surface, not a wall',
  worstBeltStep.value <= BELT_SLOPE_LIMIT,
  `worst ${worstBeltStep.value.toFixed(4)} m per ${WALK_STEP} m against ${BELT_SLOPE_LIMIT} m`,
);
check(
  'and what there is, is slope not step',
  worstRefined.value <=
    (Math.max(worstBatterStep.value, worstBeltStep.value) / REFINE) * 1.5 + 0.002,
  `${worstRefined.value.toFixed(5)} m at 1/${REFINE} of the step, slope would give ` +
    `${(Math.max(worstBatterStep.value, worstBeltStep.value) / REFINE).toFixed(5)} m`,
);
check(
  'the desert is no rougher for carrying it',
  worstFeatureGroundStep.value <= worstOpenGroundStep.value + SLOPE_LIMIT,
  `${worstFeatureGroundStep.value.toFixed(4)} m against the open desert's own ` +
    `${worstOpenGroundStep.value.toFixed(4)} m plus one ramp`,
);
check(
  'the verge is untouched',
  worstVerge.value === 0,
  `worst ${worstVerge.value.toFixed(6)} m across the first ${CORRIDOR_KEEP_M} m outside the paint`,
);
check(
  'the asphalt edge does not move',
  worstEdge.value <= EDGE_TOLERANCE,
  `worst ${worstEdge.value.toFixed(4)} m from the ribbon's own surface`,
);
check(
  'the drawn mesh carries the landform',
  worstMesh.value <= MESH_TOLERANCE && meshVerticesChecked > 0,
  `worst ${worstMesh.value.toFixed(4)} m over ${meshVerticesChecked} vertices`,
);
check(
  'a crest is on the drawn vertices, not only in the field',
  worstMeshCrest >= 3,
  `tallest landform standing on a drawn vertex ${worstMeshCrest.toFixed(2)} m`,
);
check(
  'the country schedules no rock belt',
  beltsScanned === 0,
  `${beltsScanned} belts in 400 km over ${SEEDS.length} seeds` +
    (beltsScanned === 0
      ? ' — the kind is off in the director and its amplitude is 0 in terrain.ts'
      : `, ${beltsTooThin} of them standing less than ${BELT_MIN_RISE} m of rock`),
);

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
