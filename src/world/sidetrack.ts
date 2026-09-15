import * as THREE from 'three';

import { hash01 } from '../core/rng';
import { desertPaletteAt } from './gradient';
import { varietyEventsBetween, type VarietyEvent } from './director';
import { drawnGroundY } from './terrainmesh';
import type { Road } from './road';
import type { RoadDistance } from './roaddistance';
import type { Terrain } from './terrain';
import type { ChunkContext, ChunkContent, ChunkProvider } from './chunks';

/**
 * SIDETRACKS: the graded dirt tracks that leave the road for the desert.
 *
 * The director schedules one every few kilometres (kind 'sidetrack' in
 * `world/director.ts`). What it buys is not scenery but a QUESTION: a pair of ruts
 * peeling off the shoulder and dying in the sand a hundred metres out says somebody
 * drove out there repeatedly, for a reason the road does not explain. It is the
 * cheapest thing in this world that implies a somewhere else.
 *
 * It is a DECAL, not terrain. Three things follow from that, and all three are why
 * this file is short:
 *
 *  - no terrain height changes, so `terrain.ts` does not have to know this exists and
 *    a track can never make a dune undriveable or tear a hole in the collider;
 *  - no surface-type registration, so a wheel on a track still reads the sand it is
 *    actually on (a graded track IS sand, packed harder — and packing is not a
 *    material this world models);
 *  - no collider at all, so a track costs one draw call and nothing else.
 *
 * The ribbon rides on `drawnGroundY`, the terrain MESH's own surface, and not on
 * `Terrain.heightAt`. That distinction is the whole difficulty of this feature. The
 * mesh chords the height field between its lateral rings, and by the time a track is
 * fifty metres out those rings are far enough apart that the chord misses the field by
 * more than a decimetre — so a ribbon laid on the field sinks into the drawn dune on
 * every rise and lifts off it in every hollow. The desert scatter learned this first;
 * see the comment on `drawnGroundY` in `world/terrainmesh.ts`.
 */

/** Hash domain. Distinct from every other stream in the world. */
const TAG_SIDETRACK = 0x51de7a;

/**
 * How far out a track runs before it fades, metres, measured in WORLD distance along
 * the track. `event.draw` picks inside this range.
 *
 * Sixty is the shortest that still reads as going somewhere rather than as a passing
 * place; a hundred and fifty is where the fade has caught up with the dust haze
 * anyway, so a longer one spends vertices on something the air already hides.
 */
const SIDETRACK_MIN_LENGTH = 60;
const SIDETRACK_MAX_LENGTH = 150;

/**
 * Angle the track leaves the road at, radians. A vehicle turning off a road at speed
 * cannot leave at a right angle: 16-30 degrees is the shallow peel a graded junction
 * actually has, and it is also what keeps the first twenty metres of the track inside
 * the player's view instead of sliding straight out of frame.
 */
const SIDETRACK_DEPART_MIN = 0.28;
const SIDETRACK_DEPART_MAX = 0.52;

/**
 * THE BEND, and why it is bounded the way it is.
 *
 * A perfectly straight ribbon reads as stamped, so the track curves: the roll turns
 * it up to `TURN_OUT` radians further out, or back toward the road by at most enough
 * to leave `MIN_ANGLE` of divergence. The path is integrated IN THE ROAD FRAME
 * (arclength, lateral) rather than in world space, so the guarantee is structural
 * rather than measured: `sin(angle)` stays strictly positive, the lateral offset is
 * therefore strictly increasing, and no roll and no amount of road curvature can bend
 * a track back onto the asphalt. Where a feature meets the asphalt, the asphalt wins.
 */
const SIDETRACK_TURN_OUT = 0.5;
const SIDETRACK_MIN_ANGLE = 0.14;

/**
 * THE PRICE of integrating in the road frame, and the cap that pays it.
 *
 * The frame folds where the lateral offset reaches the local radius of curvature: on
 * the inside of a bend, ground that far out is behind the centre of the turn and one
 * point has two arclengths. The road's tightest corner is 85 m
 * (`MIN_CORNER_RADIUS`), so a track allowed to wander a hundred metres out would
 * eventually fold over itself and draw a ribbon tied in a knot.
 *
 * A track therefore stops when it reaches `MAX_OUT` metres from the asphalt, or
 * `CURVE_FRACTION` of the local radius, whichever comes first. At three tenths of the
 * radius the frame is compressed by at most a third — a track on the inside of a bend
 * is a little shorter than its roll asked for, which is exactly what a real graded
 * track cutting the inside of a curve looks like — and it can never fold. Fifty metres
 * is the outer limit because the fade has started by 58% of the length anyway, so
 * everything past it is already transparent.
 */
const SIDETRACK_MAX_OUT = 50;
const SIDETRACK_CURVE_FRACTION = 0.3;

/** Metres between ribbon rows, and the most rows one track may spend. */
const SIDETRACK_ROW_M = 3;
const SIDETRACK_MAX_ROWS = 64;

/**
 * Where the track's CENTRELINE starts, as a setback from the LOCAL asphalt edge.
 *
 * 1.6 m, and the figure is the ribbon's own half-width rather than taste. The strip
 * is 1.5 m each side of its centre, so at the shallow departure angle its inner
 * corner lands about 0.3 m outside the paint: the track visually joins the road
 * without a single vertex of transparent sand lying over the asphalt or over the lane
 * paint that sits 2 mm above it. A 0.25 m setback — which is where this started — put
 * two of the ten columns on the carriageway, and a decal fighting the road surface for
 * the depth test is exactly the artefact the lift and the polygon offset exist to
 * avoid. The 3.5 m loose shoulder is wide enough to hold the junction on its own.
 */
export const SIDETRACK_START_SETBACK = 1.6;

/**
 * Lift above the sampled surface, metres. The same figure and the same reason as
 * `SURFACE_LIFT` in `render/tyretracks.ts`: enough to win the depth test against the
 * terrain triangle it lies on, small enough that nothing casts a visible gap shadow.
 */
export const SIDETRACK_LIFT = 0.03;

/**
 * The ribbon's cross-section, as offsets from the track centre in metres.
 *
 * `rut` marks the two wheel paths, which are the darker packed lines; everything else
 * is the graded strip, which is LIGHTER than the desert around it because grading
 * turns over the crust and the crust is what the sun has darkened. The outermost
 * columns carry zero alpha, so the strip ends in a soft edge rather than in a cut
 * line — a hard-edged decal on sand is the single clearest tell that a ribbon is a
 * ribbon. A 1.6 m rut gauge is a light truck, which is what would be out here.
 */
interface SidetrackColumn {
  /** Lateral offset from the track centreline, metres. */
  readonly offset: number;
  /** True for the two packed wheel paths. */
  readonly rut: boolean;
  /** Opacity before the along-track fade. */
  readonly alpha: number;
}
const SIDETRACK_COLUMNS: readonly SidetrackColumn[] = [
  { offset: -1.5, rut: false, alpha: 0 },
  { offset: -1.08, rut: false, alpha: 0.6 },
  { offset: -0.88, rut: true, alpha: 0.9 },
  { offset: -0.72, rut: true, alpha: 0.9 },
  { offset: -0.42, rut: false, alpha: 0.52 },
  { offset: 0.42, rut: false, alpha: 0.52 },
  { offset: 0.72, rut: true, alpha: 0.9 },
  { offset: 0.88, rut: true, alpha: 0.9 },
  { offset: 1.08, rut: false, alpha: 0.6 },
  { offset: 1.5, rut: false, alpha: 0 },
];

/** Fraction of the length at which the track begins to give up. */
const SIDETRACK_FADE_FROM = 0.58;

/** How far the graded strip is lifted toward the palette's thrown-sand lightness. */
const STRIP_LIGHTEN = 0.6;
/** How far a rut is pulled toward the palette's rock, which is its darkest member. */
const RUT_DARKEN = 0.42;

/** One row of the track: its road-frame centre and the angle it is running at. */
export interface SidetrackStation {
  /** Arclength of the row centre, metres. */
  readonly s: number;
  /** Signed lateral of the row centre, metres. Positive is LEFT of travel. */
  readonly lateral: number;
  /** Angle between the track and the road at this row, radians. Always positive. */
  readonly angle: number;
}

export interface SidetrackPlan {
  /** Distance the track actually runs in world space, metres. */
  readonly length: number;
  /** Distance its roll asked for. Shorter than `length` only ever by the curve cap. */
  readonly requested: number;
  readonly side: -1 | 1;
  readonly stations: readonly SidetrackStation[];
}

/**
 * Local radius of curvature over the road the track runs beside, metres.
 *
 * The maximum |curvature| across the span rather than the value at the junction: a
 * track leaving a straight that runs into a bend has to be bounded by the bend, and
 * five samples over the span is enough for a curve whose shortest feature is 85 m.
 * Unsigned on purpose — the outside of a bend cannot fold and is being bounded for
 * nothing, which costs a few metres of length and saves a sign convention that would
 * otherwise have to be right forever.
 */
function localRadius(road: Road, fromS: number, span: number): number {
  let worst = 0;
  for (let i = 0; i <= 4; i++) {
    const curvature = Math.abs(road.curvatureAt(fromS + (span * i) / 4));
    if (curvature > worst) worst = curvature;
  }
  return worst > 1e-9 ? 1 / worst : Infinity;
}

/**
 * The track's centreline, in the ROAD FRAME.
 *
 * Exported because the measuring tool has to check the plan (side, where it starts,
 * how far it runs) against the same numbers the geometry is built from, and the only
 * honest way to do that is to read the same function rather than a copy of it.
 *
 * Integrated at row midpoints rather than at row starts: a first-order integration
 * from the row start accumulates the bend one row late, which over fifty rows walked
 * the far end of a curved track about a metre off where its angle says it should be.
 */
export function sidetrackPlan(seed: number, road: Road, event: VarietyEvent): SidetrackPlan {
  const requested =
    SIDETRACK_MIN_LENGTH + event.draw * (SIDETRACK_MAX_LENGTH - SIDETRACK_MIN_LENGTH);
  const depart =
    SIDETRACK_DEPART_MIN +
    hash01(seed, TAG_SIDETRACK, event.index, 1) * (SIDETRACK_DEPART_MAX - SIDETRACK_DEPART_MIN);
  const bend = hash01(seed, TAG_SIDETRACK, event.index, 2) * 2 - 1;
  const turn = bend >= 0 ? bend * SIDETRACK_TURN_OUT : bend * Math.max(0, depart - SIDETRACK_MIN_ANGLE);
  const curvature = turn / requested;
  const maxOut = Math.min(
    SIDETRACK_MAX_OUT,
    SIDETRACK_CURVE_FRACTION * localRadius(road, event.s, requested),
  );

  let s = event.s;
  let lateral = event.side * (road.halfWidthAt(event.s) + SIDETRACK_START_SETBACK);
  const stations: SidetrackStation[] = [{ s, lateral, angle: depart }];
  let walked = 0;
  let point = road.offsetPoint(s, lateral);
  let x = point.x;
  let z = point.z;

  for (let row = 1; row <= SIDETRACK_MAX_ROWS; row++) {
    const mid = depart + curvature * ((row - 0.5) * SIDETRACK_ROW_M);
    const nextS = s + Math.cos(mid) * SIDETRACK_ROW_M;
    const nextLateral = lateral + event.side * Math.sin(mid) * SIDETRACK_ROW_M;
    // Both stopping conditions are tested BEFORE the row is committed, so a track
    // never has one row past the cap it is supposed to respect.
    if (Math.abs(nextLateral) - road.halfWidthAt(nextS) > maxOut) break;
    point = road.offsetPoint(nextS, nextLateral);
    const segment = Math.hypot(point.x - x, point.z - z);
    if (walked + segment > requested) break;
    walked += segment;
    x = point.x;
    z = point.z;
    s = nextS;
    lateral = nextLateral;
    stations.push({ s, lateral, angle: depart + curvature * (row * SIDETRACK_ROW_M) });
  }

  return { length: walked, requested, side: event.side, stations };
}

function smoothstep01(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** Palette scratch colours, so a track build does not allocate one per vertex. */
const _sand = new THREE.Color();
const _rock = new THREE.Color();
const _spray = new THREE.Color();
const _strip = new THREE.Color();
const _rutColour = new THREE.Color();

/**
 * Builds one track's ribbon, in the chunk's origin frame.
 *
 * Yields a row at a time. `drawnGroundY` costs about 10 us a sample and a long track
 * is five hundred vertices, so building one in a single call is a 5 ms spike in a
 * streaming budget of a few milliseconds a frame — the reason `ChunkProvider` has
 * `buildSteps` at all.
 */
function* buildSidetrackGeometry(
  road: Road,
  terrain: Terrain,
  roadDistance: RoadDistance,
  plan: SidetrackPlan,
  event: VarietyEvent,
  originX: number,
  originZ: number,
): Generator<void, THREE.BufferGeometry> {
  const palette = desertPaletteAt(event.s);
  _sand.setHex(palette.sand);
  _rock.setHex(palette.rock);
  _spray.setHex(palette.spray);
  // The graded strip and the ruts are both the REGION's own sand, moved along the
  // palette rather than picked: a track tinted with a fixed brown stopped matching
  // the ground the moment the colour cycle moved off its opening desert.
  _strip.copy(_sand).lerp(_spray, STRIP_LIGHTEN);
  _rutColour.copy(_sand).lerp(_rock, RUT_DARKEN);

  const cols = SIDETRACK_COLUMNS.length;
  const rows = plan.stations.length;
  const positions = new Float32Array(rows * cols * 3);
  // Four components, not three: `vertexColors` with an itemSize-4 colour attribute is
  // what gives the ribbon per-vertex ALPHA, which is what lets one mesh fade out at
  // its far end and at both its edges without a custom shader.
  const colours = new Float32Array(rows * cols * 4);
  const indices = new Uint16Array((rows - 1) * (cols - 1) * 6);

  const point = { x: 0, y: 0, z: 0 };
  let v = 0;
  for (let r = 0; r < rows; r++) {
    const station = plan.stations[r]!;
    const along = r / (rows - 1);
    const taper = 1 - smoothstep01((along - SIDETRACK_FADE_FROM) / (1 - SIDETRACK_FADE_FROM));
    // The row runs across the TRACK, so its direction is the track tangent turned a
    // quarter turn in the (arclength, lateral) frame. Taking it perpendicular to the
    // ROAD instead sheared every row of a curving track and the ruts came out as
    // zig-zags: a row is 3 m wide and the rows are 3 m apart, so the shear was visible.
    const crossS = -plan.side * Math.sin(station.angle);
    const crossL = Math.cos(station.angle);
    for (let c = 0; c < cols; c++) {
      const column = SIDETRACK_COLUMNS[c]!;
      const vs = station.s + column.offset * crossS;
      const vl = station.lateral + column.offset * crossL;
      road.offsetPoint(vs, vl, point);
      const y = drawnGroundY(road, terrain, roadDistance, vs, vl) + SIDETRACK_LIFT;
      const p = v * 3;
      // Origin-relative, because this is about to live in an f32 array and an
      // absolute coordinate forty thousand kilometres out quantises to centimetres.
      positions[p] = point.x - originX;
      positions[p + 1] = y;
      positions[p + 2] = point.z - originZ;
      const k = v * 4;
      const colour = column.rut ? _rutColour : _strip;
      colours[k] = colour.r;
      colours[k + 1] = colour.g;
      colours[k + 2] = colour.b;
      colours[k + 3] = column.alpha * taper;
      v++;
    }
    yield;
  }

  // Wound so the face normal is +Y. In the road frame the arclength axis crossed into
  // the lateral axis is up (see `Road.offsetPoint` on why that sign is load-bearing),
  // and the row and column axes are that pair rotated together, so (this row, next
  // row, next column) is the triangle that faces the sky. Backwards renders nothing.
  let t = 0;
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      const b = a + cols;
      indices[t] = a;
      indices[t + 1] = b;
      indices[t + 2] = b + 1;
      indices[t + 3] = a;
      indices[t + 4] = b + 1;
      indices[t + 5] = a + 1;
      t += 6;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 4));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * The shared track material.
 *
 * `depthWrite: false` plus the polygon offset is the ground-decal recipe this repo
 * already uses for tyre marks and lane paint: the ribbon has to lose the depth
 * argument with the terrain it lies on rather than win it, or every dune edge it
 * crosses turns into a z-fighting seam. It is a standard material and not an unlit
 * one on purpose — a graded track is ground, so it has to take the same sun, the same
 * night and the same fog as the sand it is lying on, or it glows at dusk.
 */
const matSidetrack = new THREE.MeshStandardMaterial({
  vertexColors: true,
  transparent: true,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -1,
  roughness: 1,
  metalness: 0,
});

export class SidetrackProvider implements ChunkProvider {
  readonly id = 'sidetrack';

  /**
   * The SHARED road-distance index, for the same reason `TerrainMeshProvider` takes
   * it: `drawnGroundY` reproduces the drawn mesh, and it can only do that if it asks
   * the same lattice the mesh asked. A second instance would answer identically and
   * pay for its own lattice to do it.
   */
  constructor(private readonly roadDistance: RoadDistance) {}

  build(ctx: ChunkContext): ChunkContent | null {
    const iterator = this.buildSteps(ctx);
    let result = iterator.next();
    while (!result.done) result = iterator.next();
    return result.value;
  }

  *buildSteps(ctx: ChunkContext): Generator<void, ChunkContent | null> {
    const seed = ctx.world.seed;
    const geometries: THREE.BufferGeometry[] = [];
    let group: THREE.Group | null = null;

    for (const event of varietyEventsBetween(seed, ctx.sStart, ctx.sEnd)) {
      if (event.kind !== 'sidetrack') continue;
      // ONE chunk owns a track: the one holding its junction. The ribbon reaches tens
      // of metres out and therefore past this chunk's own end, which is fine — a
      // chunk's content is not required to stay inside its arclength, only to be a
      // pure function of it. Building it in every chunk the ribbon touched would draw
      // the same track two or three times over.
      if (event.s < ctx.sStart || event.s >= ctx.sEnd) continue;
      const plan = sidetrackPlan(seed, ctx.road, event);
      const geometry = yield* buildSidetrackGeometry(
        ctx.road,
        ctx.terrain,
        this.roadDistance,
        plan,
        event,
        ctx.originX,
        ctx.originZ,
      );
      geometries.push(geometry);
      group ??= new THREE.Group();
      group.add(new THREE.Mesh(geometry, matSidetrack));
    }

    if (!group) return null;
    return {
      group,
      bodies: [],
      colliders: [],
      dispose: () => {
        for (const geometry of geometries) geometry.dispose();
      },
    };
  }
}
