import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { hash01 } from '../../core/rng';
import type { PhysicsWorld } from '../../core/physics';
import { SurfaceType } from '../../core/surfaces';
import { makeFlatPaletteMaterial } from '../../render/materials';
import { ROAD_TILE_METRES } from '../../render/roadtexture';
import type { ChunkContent, ChunkContext, ChunkProvider } from '../chunks';
import { tileGroundSampler, type DrawnGroundSample } from '../deserttiledata';
import { desertPaletteAt } from '../gradient';
import { postStopsBetween } from '../poststops';
import { CHUNK_LENGTH } from '../ranges';
import { rockForms, sandForms } from '../props/forms';
import type { RoadDistance } from '../roaddistance';
import { roadAsphaltMaterial, roadLaneVertexColor, roadMarkingMaterial, roadVertexColorGain } from '../roadmesh';
import { TRACK_SURFACE, type TrackSurfaceKind } from './layout';
import { CHUNK_SPREAD_M, postHasTrack } from './site';
import type { RaceTrack } from './track';

/**
 * A RACE TRACK, DRAWN AND COLLIDED: the chunk provider that builds it.
 *
 * ONE CHUNK OWNS A TRACK: the one holding its `chunkS`, the mean road arclength of its
 * centreline, which every stretch of it and its lane lies within `CHUNK_SPREAD_M` of
 * (site.ts). So wherever the player is on the lap, its owner is inside the visual window
 * (`ROAD_VISUAL_CHUNKS`) and, from most of it, the physics window. The track reaches
 * hundreds of metres along and out from the road, which is fine: a chunk's content must
 * be a pure function of the chunk, not inside it. It is built when that chunk enters
 * the visual window without colliders, promoted in place with them when it enters the
 * physics window, and freed with the chunk — geometry here, bodies by the streamer.
 * Beyond the window there is nothing but the levelled ground, which the vista draws
 * (Terrain.horizonHeight), so a track seen from far off is a flat scar in the dunes.
 *
 * WHAT IS BUILT, every piece one merged geometry in a material the road already links:
 *
 *  - the RIBBON: asphalt, gravel or dirt by sector, in the road's own material and
 *    attribute set (position, three-component colour, uv, normal), `TRACK_LIFT_M` above
 *    the track's plane, with a `LIP_M` lip either side falling under the run-off's sand.
 *    Collided as drawn, in slabs of `COLLIDER_SLAB_ROWS` rows, one surface per slab, so
 *    a wheel on a gravel sector reads `Gravel` (the tyre model's surface tag is the
 *    collider's registered surface, core/surfaces.ts `SurfaceRegistry`);
 *  - the PADDOCK beside the start straight (concrete) and the ACCESS LANE from the
 *    lay-by (gravel), the lane draped on the DRAWN ground (`tileGroundSampler`) the way
 *    the airfield strip is: the highest ground across it, smoothed along;
 *  - the PAINT in the road's marking material (`trackPaintRects`): edge lines on
 *    asphalt, red-and-white curbs on the inside of every corner tighter than
 *    `CURB_RADIUS_M`, the chequered line and a box per grid slot, no two quads over
 *    the same asphalt (the edge line is cut where a curb or the chequers cross it);
 *  - the PROPS in the flat palette the settlements' kit merges into: the start gantry
 *    over the line, a yellow-and-black gate at every checkpoint (`checkpointGates`:
 *    posts just beyond the asphalt's edge and a beam 5.2 m over the surface, every
 *    part a solid box collider), tyre walls on the outside of the tight corners, each
 *    collided as one trimesh, and the CHICANE BLOCKERS (`chicaneBlockers`): one of the
 *    desert scatter's boulders and one long fallen log per chicane, across the line a
 *    driver would cut, the rock a `Rock` trimesh and the log a solid box.
 *
 * NO NEW PROGRAM AND NO LONG STEP when a track appears. Every piece is drawn in a
 * material the boot already links (`raceTrackProgramAnchor`); the scatter's forms give
 * their painted geometry only, never their instanced ground-faded material. The build
 * is sliced (`buildSteps`) so no step holds the main thread more than a few
 * milliseconds: the paint `PAINT_RECTS_PER_STEP` quads at a time, the props a group at
 * a time (appended into plain arrays, one geometry at the end, no per-part clone and
 * merge), the ribbon's colliders `COLLIDER_SLABS_PER_STEP` slabs at a time, every wall's
 * colliders a step each, then the blockers' and the gates' a step each.
 * tools/racetrack-gen.ts times every step.
 *
 * Triangle budget for a 1.3 km lap (tools/racetrack-gen.ts prints the real figures):
 * about 5k in the ribbon, a few thousand of paint, 5-10k of tyres, a few hundred of
 * rocks and logs; 20-40 static trimesh bodies and a box per gate part and log.
 */

/** The asphalt's height over the track's plane, so the levelled ground never shows through. */
export const TRACK_LIFT_M = 0.08;
/** The lip from the asphalt's edge down under the sand: its width, and how far below. */
const LIP_M = 1.2;
const LIP_SINK_M = 0.06;
/** Rows of the ribbon, metres apart (adjusted per sector to a whole number). */
const RIBBON_STEP_M = 2;
/** Rows per collider slab: the road's slab size, a small BVH each; slabs made per build step. */
const COLLIDER_SLAB_ROWS = 30;
const COLLIDER_SLABS_PER_STEP = 4;
/** Dirt's colour; asphalt and gravel take the road's own. */
const DIRT_COLOUR = 0x86664a;
/** The lip's colour: the surface, most of the way to the sand. */
const LIP_SAND = 0.65;
/** Paint: lines, curbs, the chequers. */
const PAINT_WHITE = 0xd9d4c6;
const PAINT_RED = 0xa8342a;
const PAINT_BLACK = 0x1c1c1c;
const PAINT_LIFT_M = 0.004;
const EDGE_LINE_HALF_M = 0.12;
const EDGE_LINE_INSET_M = 0.35;
/** Curbs: inside of corners tighter than this, the band's width, the block's length. */
const CURB_RADIUS_M = 120;
const CURB_WIDTH_M = 1.0;
const CURB_BLOCK_M = 2;
/** Edge line left unpainted either side of a curb or the chequers, and its shortest piece. */
const EDGE_LINE_GAP_M = 0.3;
const EDGE_LINE_MIN_M = 0.3;
/** Paint quads per build step. */
const PAINT_RECTS_PER_STEP = 600;
/**
 * THE START LIGHTS: `GANTRY_LAMPS` housings in a row on top of the gantry's beam, their
 * faces toward the grid. `gantryLampPoint` is where lamp `k`'s face is, so the race
 * (race/visuals.ts) puts its lenses on the housings the chunk draws.
 */
export const GANTRY_LAMPS = 3;
const GANTRY_BEAM_Y = 5.6;
const GANTRY_HOUSING_M = 0.8;
const GANTRY_LAMP_PITCH_M = 1.1;
/** The housing's middle stands this far behind the line (toward the grid), metres. */
const GANTRY_HOUSING_BACK_M = 0.1;
/** The lens's face: the housing's front, a hair proud of it. */
export const GANTRY_LENS_BACK_M = GANTRY_HOUSING_BACK_M + 0.18;
/** A lens's radius, metres. */
export const GANTRY_LENS_RADIUS_M = 0.3;

/**
 * Lamp `k`'s place on the gantry, ABSOLUTE, into `out`: `back` metres behind the line
 * along the lap, above the beam's top. The faces look back down the lap at the grid.
 */
export function gantryLampPoint(track: RaceTrack, k: number, out: { x: number; y: number; z: number }, back = GANTRY_LENS_BACK_M): { x: number; y: number; z: number } {
  const lateral = (k - (GANTRY_LAMPS - 1) / 2) * GANTRY_LAMP_PITCH_M;
  track.offsetPoint(-back, lateral, out);
  out.y = track.surfaceY(0, 0) + GANTRY_BEAM_Y + 0.25 + GANTRY_HOUSING_M / 2;
  return out;
}

/** Tyre walls: outside of corners tighter than this, past the run-off. */
const TYRE_RADIUS_M = 45;
const TYRE_STACK_RADIUS_M = 0.38;
const TYRE_STACK_HEIGHT_M = 0.78;
const TYRE_PITCH_M = 0.8;
/**
 * The lane: its lift over the highest drawn ground under its top, its stations'
 * smoothing reach (rows), the steepest cross-fall it follows the ground with, and its
 * SHOULDERS — at least `LANE_SHOULDER_M` either side and as wide as it takes (up to
 * `LANE_SHOULDER_MAX_M`) to fall at `LANE_SHOULDER_SLOPE` from the top's edge to just
 * under the drawn ground (`LANE_TUCK_M`), collided as drawn, so a wheel over the edge
 * rolls down the shoulder onto the sand instead of dropping off a step. The cross-fall
 * eases to level over `LANE_CROSS_EASE_M` at both ends, where it meets level pads.
 */
const LANE_LIFT_M = 0.04;
const LANE_SMOOTH_ROWS = 2;
const LANE_CROSS_MAX = 0.08;
const LANE_SHOULDER_M = 1.6;
const LANE_SHOULDER_MAX_M = 12;
const LANE_SHOULDER_SLOPE = 0.25;
const LANE_TUCK_M = 0.02;
const LANE_CROSS_EASE_M = 9;
/** The palette's roughness: the settlements' kit merges at this one (world/poi/kit.ts). */
const PROP_ROUGHNESS = 0.88;

/** The ribbon as plain arrays, for the provider and for the headless bench's colliders. */
export interface TrackRibbon {
  readonly positions: Float32Array;
  readonly colors: Float32Array;
  readonly uvs: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
  /** One per sector: its surface and its rows' range in the vertex buffer. */
  readonly runs: readonly { readonly surface: SurfaceType; readonly firstRow: number; readonly rows: number }[];
  /** Vertices per row. */
  readonly columns: number;
}

const COLUMNS = 5;

/**
 * The ribbon, origin-relative: one run of rows per sector, its first and last rows on
 * the sector's ends, so a change of surface is a crisp edge and no slab straddles one.
 * `colour` gives each sector's lane and lip colour (linear RGB, written in place).
 */
export function buildTrackRibbon(
  track: RaceTrack,
  originX: number,
  originZ: number,
  colour: (kind: TrackSurfaceKind, lip: boolean, out: THREE.Color) => void = () => {},
): TrackRibbon {
  const hw = track.halfWidth;
  const laterals = [-(hw + LIP_M), -hw, 0, hw, hw + LIP_M];
  let totalRows = 0;
  const runRows = track.sectors.map((sector) => {
    const rows = Math.max(2, Math.round((sector.endS - sector.startS) / RIBBON_STEP_M) + 1);
    totalRows += rows;
    return rows;
  });
  const vertexCount = totalRows * COLUMNS;
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const normals = new Float32Array(vertexCount * 3);
  let quadRows = 0;
  for (const rows of runRows) quadRows += rows - 1;
  const indices = new Uint32Array(quadRows * (COLUMNS - 1) * 6);
  const runs: { surface: SurfaceType; firstRow: number; rows: number }[] = [];
  const sample = track.sampleAt(0);
  const tone = new THREE.Color();
  const lipTone = new THREE.Color();
  let row = 0;
  let w = 0;
  track.sectors.forEach((sector, k) => {
    const rows = runRows[k]!;
    runs.push({ surface: TRACK_SURFACE[sector.kind], firstRow: row, rows });
    colour(sector.kind, false, tone);
    colour(sector.kind, true, lipTone);
    for (let r = 0; r < rows; r++) {
      const s = sector.startS + ((sector.endS - sector.startS) * r) / (rows - 1);
      track.sampleAt(s, sample);
      const lx = Math.cos(sample.heading);
      const lz = -Math.sin(sample.heading);
      // The plane's normal: rising toward -left by the bank, along by the grade.
      const nx = sample.bank * lx - sample.grade * Math.sin(sample.heading);
      const nz = sample.bank * lz - sample.grade * Math.cos(sample.heading);
      const nl = Math.hypot(nx, 1, nz);
      for (let c = 0; c < COLUMNS; c++) {
        const lateral = laterals[c]!;
        const lip = c === 0 || c === COLUMNS - 1;
        const v = (row + r) * COLUMNS + c;
        positions[v * 3] = sample.x + lx * lateral - originX;
        positions[v * 3 + 1] = sample.y - sample.bank * lateral + (lip ? -LIP_SINK_M : TRACK_LIFT_M);
        positions[v * 3 + 2] = sample.z + lz * lateral - originZ;
        normals[v * 3] = nx / nl;
        normals[v * 3 + 1] = 1 / nl;
        normals[v * 3 + 2] = nz / nl;
        uvs[v * 2] = lateral / ROAD_TILE_METRES;
        uvs[v * 2 + 1] = s / ROAD_TILE_METRES;
        const paint = lip ? lipTone : tone;
        colors[v * 3] = paint.r;
        colors[v * 3 + 1] = paint.g;
        colors[v * 3 + 2] = paint.b;
      }
    }
    // Up-facing: lateral grows to the LEFT and the rows run forward, so (a, b, a+1).
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < COLUMNS - 1; c++) {
        const a = (row + r) * COLUMNS + c;
        const b = a + COLUMNS;
        indices[w++] = a;
        indices[w++] = b;
        indices[w++] = a + 1;
        indices[w++] = a + 1;
        indices[w++] = b;
        indices[w++] = b + 1;
      }
    }
    row += rows;
  });
  return { positions, colors, uvs, normals, indices, runs, columns: COLUMNS };
}

/**
 * The ribbon's colliders: per sector, slabs of `COLLIDER_SLAB_ROWS` rows sharing their
 * boundary rows, each registered as that sector's surface. Built disabled when
 * `enabled` is false (the streamer switches them on with the chunk).
 */
export function addTrackRibbonColliders(
  physics: PhysicsWorld,
  ribbon: TrackRibbon,
  enabled: boolean,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
): void {
  const steps = ribbonColliderSteps(physics, ribbon, enabled, bodies, colliders);
  while (!steps.next().done);
}

/** `addTrackRibbonColliders` a few slabs at a time (`COLLIDER_SLABS_PER_STEP`), for the provider. */
function* ribbonColliderSteps(
  physics: PhysicsWorld,
  ribbon: TrackRibbon,
  enabled: boolean,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
): Generator<void, void> {
  const rowIndices = (ribbon.columns - 1) * 6;
  // Quad rows before each run, to find its slice of the index buffer.
  let quadBase = 0;
  let made = 0;
  for (const run of ribbon.runs) {
    for (let q0 = 0; q0 < run.rows - 1; q0 += COLLIDER_SLAB_ROWS) {
      const q1 = Math.min(q0 + COLLIDER_SLAB_ROWS, run.rows - 1);
      const firstVertex = (run.firstRow + q0) * ribbon.columns;
      const vertices = ribbon.positions.subarray(firstVertex * 3, (run.firstRow + q1 + 1) * ribbon.columns * 3);
      const slab = ribbon.indices.slice((quadBase + q0) * rowIndices, (quadBase + q1) * rowIndices);
      for (let i = 0; i < slab.length; i++) slab[i] = slab[i]! - firstVertex;
      addTrimesh(physics, vertices, slab, run.surface, enabled, bodies, colliders);
      if (++made % COLLIDER_SLABS_PER_STEP === 0) yield;
    }
    quadBase += run.rows - 1;
  }
}

function addTrimesh(
  physics: PhysicsWorld,
  vertices: Float32Array,
  indices: Uint32Array,
  surface: SurfaceType,
  enabled: boolean,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
): void {
  const collider = physics.addStaticTrimesh(vertices, indices, surface);
  if (!enabled) collider.setEnabled(false);
  colliders.push(collider);
  const body = collider.parent();
  if (body) bodies.push(body);
}

/** A grid of rows across a strip, as plain arrays with an up-facing index (rows forward, columns leftward). */
interface Sheet {
  positions: number[];
  colors: number[];
  uvs: number[];
  normals: number[];
  indices: number[];
}

function newSheet(): Sheet {
  return { positions: [], colors: [], uvs: [], normals: [], indices: [] };
}

/** One quad of paint, corners given counter-clockwise from above (forward-right first). */
function paintQuad(sheet: Sheet, corners: readonly (readonly [number, number, number])[], colour: THREE.Color): void {
  const base = sheet.positions.length / 3;
  for (const [x, y, z] of corners) {
    sheet.positions.push(x, y, z);
    sheet.colors.push(colour.r, colour.g, colour.b);
    sheet.normals.push(0, 1, 0);
  }
  sheet.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function sheetGeometry(sheet: Sheet, uv: boolean): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(sheet.positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(sheet.colors, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(sheet.normals, 3));
  if (uv) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(sheet.uvs, 2));
  geometry.setIndex(sheet.indices);
  return geometry;
}

/** A point on the track's painted surface, origin-relative. */
function onSurface(track: RaceTrack, s: number, lateral: number, ox: number, oz: number, point: { x: number; y: number; z: number }): readonly [number, number, number] {
  track.offsetPoint(s, lateral, point);
  return [point.x - ox, track.surfaceY(s, lateral) + TRACK_LIFT_M + PAINT_LIFT_M, point.z - oz];
}

/** Paint colours by name, so a reader other than the mesh (the bench's plots) needs no hexes. */
export type TrackPaintColour = 'white' | 'red' | 'black';
const PAINT_HEX: Readonly<Record<TrackPaintColour, number>> = { white: PAINT_WHITE, red: PAINT_RED, black: PAINT_BLACK };

/**
 * One painted quad in the lap's frame: `s0 < s1` along the lap (either may lie below 0 or
 * past the lap's end; read them wrapped) and `l0 < l1` across, lateral positive LEFT.
 */
export interface TrackPaintRect {
  readonly s0: number;
  readonly s1: number;
  readonly l0: number;
  readonly l1: number;
  readonly colour: TrackPaintColour;
}

/**
 * THE PAINT as rectangles in the lap's frame, pure in the track: edge lines on the
 * asphalt sectors, curbs on the inside of the tighter corners, the chequered line at
 * s = 0 and an open-backed box round every grid slot.
 *
 * NO TWO OF THEM OVERLAP. Paint is one layer at one lift, and two quads over the same
 * patch of asphalt z-fight; a curb lies across its side's edge line and the chequers
 * across both. So the edge line is CUT wherever a curb or the chequers hold its band,
 * `EDGE_LINE_GAP_M` clear either side, and a grid box's sides stop at its front bar.
 */
export function trackPaintRects(track: RaceTrack): TrackPaintRect[] {
  const rects: TrackPaintRect[] = [];
  const hw = track.halfWidth;
  const lap = track.lengthM;
  // Spans of lap each edge line leaves unpainted: index 0 the right line, 1 the left.
  const cuts: [number, number][][] = [[], []];

  // Curbs: the middle of each tight corner's arc, on its inside, in alternating blocks.
  for (const corner of track.corners) {
    if (!Number.isFinite(corner.radius) || Math.abs(corner.radius) > CURB_RADIUS_M) continue;
    const left = corner.radius > 0;
    const start = corner.startS + corner.length * 0.15;
    const span = corner.length * 0.7;
    const blocks = Math.max(1, Math.round(span / CURB_BLOCK_M));
    const block = span / blocks;
    const l0 = left ? hw - CURB_WIDTH_M : -hw;
    const l1 = left ? hw : -(hw - CURB_WIDTH_M);
    for (let b = 0; b < blocks; b++) {
      rects.push({ s0: start + b * block, s1: start + (b + 1) * block, l0, l1, colour: b % 2 === 0 ? 'red' : 'white' });
    }
    cuts[left ? 1 : 0]!.push([start - EDGE_LINE_GAP_M, start + span + EDGE_LINE_GAP_M]);
  }

  // The line: two rows of chequers across the asphalt at s = 0.
  const squares = 10;
  const square = (2 * hw) / squares;
  for (let row = 0; row < 2; row++) {
    for (let k = 0; k < squares; k++) {
      const l0 = -hw + k * square;
      rects.push({ s0: row * square - square, s1: row * square, l0, l1: l0 + square, colour: (k + row) % 2 === 0 ? 'white' : 'black' });
    }
  }
  for (const side of cuts) side.push([-square - EDGE_LINE_GAP_M, square + EDGE_LINE_GAP_M]);

  // Edge lines on the asphalt sectors, less the cuts; each cut is also tried a lap either
  // way, so one across the line or past the lap's end reaches the sector it lands in.
  for (const sector of track.sectors) {
    if (sector.kind !== 'asphalt') continue;
    for (let side = 0; side < 2; side++) {
      const centre = (side === 0 ? -1 : 1) * (hw - EDGE_LINE_INSET_M);
      let runs: [number, number][] = [[sector.startS, sector.endS]];
      for (const [a, b] of cuts[side]!) {
        for (const shift of [-lap, 0, lap]) {
          runs = runs.flatMap(([from, to]): [number, number][] => {
            if (b + shift <= from || a + shift >= to) return [[from, to]];
            const kept: [number, number][] = [];
            if (a + shift > from) kept.push([from, a + shift]);
            if (b + shift < to) kept.push([b + shift, to]);
            return kept;
          });
        }
      }
      for (const [from, to] of runs) {
        if (to - from < EDGE_LINE_MIN_M) continue;
        const rows = Math.max(1, Math.round((to - from) / RIBBON_STEP_M));
        for (let r = 0; r < rows; r++) {
          rects.push({
            s0: from + ((to - from) * r) / rows,
            s1: from + ((to - from) * (r + 1)) / rows,
            l0: centre - EDGE_LINE_HALF_M,
            l1: centre + EDGE_LINE_HALF_M,
            colour: 'white',
          });
        }
      }
    }
  }

  // The grid boxes: nose to the line, the sides stopping at the front bar.
  for (const slot of track.startGrid) {
    const front = slot.s + 2.6;
    const bar = front - 0.25;
    const back = slot.s - 3.2;
    const half = 1.3;
    rects.push({ s0: bar, s1: front, l0: slot.lateral - half, l1: slot.lateral + half, colour: 'white' });
    rects.push({ s0: back, s1: bar, l0: slot.lateral - half, l1: slot.lateral - half + 0.2, colour: 'white' });
    rects.push({ s0: back, s1: bar, l0: slot.lateral + half - 0.2, l1: slot.lateral + half, colour: 'white' });
  }
  return rects;
}

/** The paint's geometry from its rectangles, `PAINT_RECTS_PER_STEP` per build step. */
function* paintSteps(track: RaceTrack, rects: readonly TrackPaintRect[], ox: number, oz: number): Generator<void, THREE.BufferGeometry> {
  const sheet = newSheet();
  const point = { x: 0, y: 0, z: 0 };
  const tones: Record<TrackPaintColour, THREE.Color> = {
    white: new THREE.Color(PAINT_HEX.white),
    red: new THREE.Color(PAINT_HEX.red),
    black: new THREE.Color(PAINT_HEX.black),
  };
  for (let i = 0; i < rects.length; i++) {
    const { s0, s1, l0, l1, colour } = rects[i]!;
    // Forward-right, forward-left, back-left, back-right: counter-clockwise from above.
    paintQuad(
      sheet,
      [onSurface(track, s1, l0, ox, oz, point), onSurface(track, s1, l1, ox, oz, point), onSurface(track, s0, l1, ox, oz, point), onSurface(track, s0, l0, ox, oz, point)],
      tones[colour],
    );
    if ((i + 1) % PAINT_RECTS_PER_STEP === 0) yield;
  }
  return sheetGeometry(sheet, false);
}

/** Prop colours: the gates' banner blocks, the gantry's and gates' steel, and black. */
const GATE_YELLOW = 0xe3b21c;
const PROP_GREY = 0x8c8f93;
const PROP_BLACK = 0x1c1c1c;
/** The gantry's posts stand this far beyond the asphalt's edge: outside its lip. */
const POST_OUT_M = LIP_M + 0.6;
/** Tyre stacks appended per build step. */
const TYRE_STACKS_PER_STEP = 160;

const UP = new THREE.Vector3(0, 1, 0);
const FORWARD_Z = new THREE.Vector3(0, 0, 1);
const scratchPitch = new THREE.Quaternion();
const scratchVertex = new THREE.Vector3();
const scratchScale = new THREE.Vector3();
const scratchTurn = new THREE.Quaternion();
const scratchNormal = new THREE.Matrix3();
const scratchColour = new THREE.Color();

/**
 * Palette parts appended into plain arrays one after another: the props are built a
 * group at a time across build steps and become ONE geometry at the end, with no clone
 * per part and no merge of hundreds of parts inside one step.
 */
class PaletteSoup {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly colors: number[] = [];
  readonly uvs: number[] = [];
  readonly indices: number[] = [];

  /** `part` placed by `matrix`, in `colour`, or in the part's own vertex colours when null. */
  add(part: THREE.BufferGeometry, matrix: THREE.Matrix4, colour: THREE.Color | null): void {
    const base = this.positions.length / 3;
    const position = part.getAttribute('position');
    const normal = part.getAttribute('normal');
    const own = part.getAttribute('color');
    const uv = part.getAttribute('uv') as THREE.BufferAttribute | undefined;
    scratchNormal.getNormalMatrix(matrix);
    for (let i = 0; i < position.count; i++) {
      scratchVertex.fromBufferAttribute(position, i).applyMatrix4(matrix);
      this.positions.push(scratchVertex.x, scratchVertex.y, scratchVertex.z);
      scratchVertex.fromBufferAttribute(normal, i).applyMatrix3(scratchNormal).normalize();
      this.normals.push(scratchVertex.x, scratchVertex.y, scratchVertex.z);
      if (colour) this.colors.push(colour.r, colour.g, colour.b);
      else this.colors.push(own.getX(i), own.getY(i), own.getZ(i));
      this.uvs.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
    }
    const index = part.index;
    if (index) for (let i = 0; i < index.count; i++) this.indices.push(base + index.getX(i));
    else for (let i = 0; i < position.count; i++) this.indices.push(base + i);
  }

  /** Another soup's parts after this one's. */
  append(other: PaletteSoup): void {
    const base = this.positions.length / 3;
    for (const value of other.positions) this.positions.push(value);
    for (const value of other.normals) this.normals.push(value);
    for (const value of other.colors) this.colors.push(value);
    for (const value of other.uvs) this.uvs.push(value);
    for (const index of other.indices) this.indices.push(base + index);
  }

  /** The palette geometry (position, normal, colour, uv: the anchor's set), or null when empty. */
  geometry(): THREE.BufferGeometry | null {
    if (this.indices.length === 0) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(this.indices), 1));
    return geometry;
  }
}

interface PropTemplates {
  readonly box: THREE.BufferGeometry;
  readonly tyre: THREE.BufferGeometry;
  readonly boulder: THREE.BufferGeometry;
  readonly log: THREE.BufferGeometry;
}
let templates: PropTemplates | null = null;

/**
 * The parts the props are placed from: a unit box, one tyre stack, the desert scatter's
 * own painted boulder (world/props/forms.ts), whose geometry only is taken — it is drawn
 * here in the palette, not in the scatter's instanced, ground-faded material — and the
 * chicane's log: a tapered trunk along +X, half length 1 and butt radius 1 (scaled to
 * the log), painted the scatter's fallen trunk's own dead wood.
 */
function propTemplates(): PropTemplates {
  if (!templates) {
    const form = (forms: readonly { readonly id: string; readonly geometry: THREE.BufferGeometry }[], id: string): THREE.BufferGeometry => {
      const found = forms.find((candidate) => candidate.id === id);
      if (!found) throw new Error(`racetrack: no '${id}' form`);
      return found.geometry;
    };
    const wood = form(sandForms(), 'trunk').getAttribute('color');
    // Tip toward -X once turned: the cylinder's top (+Y) goes to -X under a quarter turn about Z.
    const log = new THREE.CylinderGeometry(LOG_TIP_SHARE, 1, 2, 9, 1).rotateZ(Math.PI / 2);
    const count = log.getAttribute('position').count;
    const colours = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) colours.set([wood.getX(0), wood.getY(0), wood.getZ(0)], i * 3);
    log.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    templates = {
      box: new THREE.BoxGeometry(1, 1, 1),
      tyre: new THREE.CylinderGeometry(TYRE_STACK_RADIUS_M, TYRE_STACK_RADIUS_M, TYRE_STACK_HEIGHT_M, 8),
      boulder: form(rockForms(), 'boulder'),
      log,
    };
  }
  return templates;
}

interface Props {
  readonly geometry: THREE.BufferGeometry | null;
  /** Tyre walls as collision triangle soups, origin-relative. */
  readonly walls: readonly { readonly vertices: Float32Array; readonly indices: Uint32Array }[];
}

/**
 * The props, one palette geometry, a group per build step: the gantry over the line,
 * a gate at every checkpoint, the tyre walls round the tight corners' outsides (each
 * also a box-section collision strip) and the chicanes' blockers.
 */
function* propSteps(track: RaceTrack, ox: number, oz: number): Generator<void, Props> {
  const soup = new PaletteSoup();
  const parts = propTemplates();
  const point = { x: 0, y: 0, z: 0 };
  const matrix = new THREE.Matrix4();
  const hw = track.halfWidth;
  const postLateral = hw + POST_OUT_M;
  const box = (size: readonly [number, number, number], x: number, y: number, z: number, yaw: number, hex: number): void => {
    matrix.compose(scratchVertex.set(x, y, z), scratchTurn.setFromAxisAngle(UP, yaw), scratchScale.set(size[0], size[1], size[2]));
    soup.add(parts.box, matrix, scratchColour.set(hex));
  };

  // The gantry: two posts outside the asphalt's lip and a beam with the chequered board.
  const line = track.sampleAt(0);
  const yaw = line.heading;
  const beamY = GANTRY_BEAM_Y;
  for (const sign of [-1, 1]) {
    track.offsetPoint(0, sign * postLateral, point);
    const ground = track.surfaceY(0, sign * postLateral);
    box([0.4, beamY + 0.4, 0.4], point.x - ox, ground + (beamY + 0.4) / 2 - 0.2, point.z - oz, yaw, PROP_GREY);
  }
  const centreY = track.surfaceY(0, 0) + beamY;
  box([2 * postLateral + 0.4, 0.5, 0.4], line.x - ox, centreY, line.z - oz, yaw, PROP_GREY);
  // The start lights' housings on the beam, facing the grid; their lenses are the race's
  // (race/visuals.ts), lit by the countdown.
  for (let k = 0; k < GANTRY_LAMPS; k++) {
    gantryLampPoint(track, k, point, GANTRY_HOUSING_BACK_M);
    box([GANTRY_HOUSING_M, GANTRY_HOUSING_M, 0.35], point.x - ox, point.y, point.z - oz, yaw, PROP_BLACK);
  }
  const checks = 12;
  const board = (2 * postLateral - 1) / checks;
  for (let k = 0; k < checks; k++) {
    for (let row = 0; row < 2; row++) {
      const lateral = -postLateral + 0.5 + board * (k + 0.5);
      track.offsetPoint(0, lateral, point);
      box(
        [board, 0.45, 0.06],
        point.x - ox - Math.sin(yaw) * 0.24,
        centreY - 0.5 - row * 0.45,
        point.z - oz - Math.cos(yaw) * 0.24,
        yaw,
        (k + row) % 2 === 0 ? 0xe8e4da : PROP_BLACK,
      );
    }
  }
  yield;

  // A gate at every checkpoint (`checkpointGates`): two posts just beyond the asphalt's
  // edge and a banner of yellow and black blocks across, collided as drawn.
  for (const part of checkpointGates(track)) {
    if (part.part === 'post') {
      box([2 * part.halfX, 2 * part.halfY, 2 * part.halfZ], part.x - ox, part.y, part.z - oz, part.yaw, PROP_GREY);
      continue;
    }
    const width = (2 * part.halfX) / GATE_BLOCKS;
    for (let k = 0; k < GATE_BLOCKS; k++) {
      const lateral = -part.halfX + width * (k + 0.5);
      box(
        [width, 2 * part.halfY, 2 * part.halfZ],
        part.x + Math.cos(part.yaw) * lateral - ox,
        part.y,
        part.z - Math.sin(part.yaw) * lateral - oz,
        part.yaw,
        k % 2 === 0 ? GATE_YELLOW : PROP_BLACK,
      );
    }
  }
  yield;

  // Tyre walls: stacks along the outside of each tight corner, past the run-off.
  const walls: { vertices: Float32Array; indices: Uint32Array }[] = [];
  let stacked = 0;
  for (const corner of track.corners) {
    if (!Number.isFinite(corner.radius) || Math.abs(corner.radius) > TYRE_RADIUS_M || corner.kind === 'chicane') continue;
    const outside = -Math.sign(corner.radius);
    const lateral = outside * (hw + track.runoffM + 1.2);
    const from = corner.startS - 10;
    const to = corner.startS + corner.length + 10;
    const stacks = Math.max(2, Math.round((to - from) / TYRE_PITCH_M));
    const wall: number[] = [];
    for (let k = 0; k <= stacks; k++) {
      const s = from + ((to - from) * k) / stacks;
      track.offsetPoint(s, lateral, point);
      const ground = track.surfaceY(s, outside * (hw + track.runoffM));
      matrix.makeTranslation(point.x - ox, ground + TYRE_STACK_HEIGHT_M / 2 - 0.05, point.z - oz);
      soup.add(parts.tyre, matrix, scratchColour.set(k % 6 === 0 ? 0xc9c2b4 : 0x202020));
      wall.push(point.x - ox, ground - 0.1, point.z - oz, ground + TYRE_STACK_HEIGHT_M);
      if (++stacked % TYRE_STACKS_PER_STEP === 0) yield;
    }
    walls.push(wallStrip(wall));
  }
  yield;

  addBlockers(soup, track, ox, oz);
  yield;
  return { geometry: soup.geometry(), walls };
}

/** A chicane of the lap: its four arcs' span, and the side its middle stands out to. */
export interface TrackChicane {
  readonly startS: number;
  readonly length: number;
  /** Signed lateral sign (+1 = left) the middle is displaced to: the first arc's turn. */
  readonly side: 1 | -1;
}

/** The lap's chicanes in lap order (four consecutive `chicane` arcs each, layout.ts). */
export function trackChicanes(track: RaceTrack): TrackChicane[] {
  const chicanes: TrackChicane[] = [];
  const corners = track.corners;
  for (let i = 0; i + 3 < corners.length; i++) {
    if (corners[i]!.kind !== 'chicane') continue;
    let length = 0;
    for (let k = i; k < i + 4; k++) length += corners[k]!.length;
    chicanes.push({ startS: corners[i]!.startS, length, side: corners[i]!.radius > 0 ? 1 : -1 });
    i += 3;
  }
  return chicanes;
}

/** One rock or log that stops a chicane being cut; see `chicaneBlockers`. */
export interface ChicaneBlocker {
  readonly kind: 'rock' | 'log';
  /** Which of `trackChicanes(track)` it closes. */
  readonly chicane: number;
  /** Its middle in the lap's frame (lateral positive LEFT), and the same point in world XZ. */
  readonly s: number;
  readonly lateral: number;
  readonly x: number;
  readonly z: number;
  /** The ground under its middle (the track's plane carried across the run-off), absolute. */
  readonly y: number;
  /** The boulder form's scale (a rock); 1 for a log. */
  readonly scale: number;
  /** Turn about +Y; a log's length then lies along (cos yaw, -sin yaw), its +X end up by `pitch`. */
  readonly yaw: number;
  readonly pitch: number;
  /**
   * The footprint as a capsule round a segment `halfLength` either way along the yaw's
   * axis: `radius` bounds everything drawn, `solid` the core no car passes through.
   */
  readonly halfLength: number;
  readonly radius: number;
  readonly solid: number;
}

const BLOCKER_DOMAIN = 0x43484b42; // 'CHKB'
/** Nearest a blocker's outline comes to the asphalt's edge, metres: past the curb and the lip. */
const BLOCKER_CLEAR_M = 1.8;
/**
 * The boulder form at scale 1 (world/props/forms.ts): radius 0.78-1.18, sunk 0.28 of it,
 * so its footprint at the ground is at least 0.74. The chicane's rock is it at
 * `ROCK_SCALE`: 2.1 m round at most, a solid 1.3 m core, 1.3 m high.
 */
const ROCK_SOLID = 0.74;
const ROCK_REACH = 1.18;
const ROCK_SINK = 0.28;
const ROCK_SCALE = 1.8;
/**
 * The log: a tapered trunk `LOG_RADIUS_M` round at its butt and `LOG_TIP_SHARE` of that
 * at its tip, sunk `LOG_SINK_M` into the sand — 0.65 m standing, which no car drives
 * over — and reaching `LOG_OVERHANG_M` past the far edge of the straight's line.
 */
const LOG_RADIUS_M = 0.4;
const LOG_TIP_SHARE = 0.8;
const LOG_SINK_M = 0.15;
const LOG_OVERHANG_M = 1.2;
/** How far before and after the chicane the original straight's line is taken from. */
const CHORD_REACH_M = 12;

/**
 * THE CHICANE BLOCKERS: exactly ONE ROCK AND ONE LOG per chicane, pure in the track.
 * A chicane's middle stands `CHICANE_SHIFT_MIN_M` or more off its straight's line
 * (layout.ts), so a straight cut — from the entry straight's asphalt to the exit
 * straight's, at any laterals — crosses the perpendicular through the middle apex
 * within a half width of that line, on the sand inside the middle. That is where
 * cutting pays most, and both stand on that perpendicular:
 *
 *  - the LOG lies ALONG it, across the cut line, from against the rock out to
 *    `LOG_OVERHANG_M` past the line's far edge: every straight cut meets it;
 *  - the ROCK stands at the other key point, between the log's inner end and the
 *    middle's asphalt, `BLOCKER_CLEAR_M` beyond the edge: it closes the shallower cut
 *    that clips the middle apex's inside, so the gap left beside it is the kerb.
 *
 * Both stand at least `BLOCKER_CLEAR_M` beyond every stretch's asphalt (the log is
 * shortened from its outer end when another stretch comes near), so a car on the
 * asphalt and its curbs touches neither. Each is collided as what is drawn: the rock
 * a `Rock` trimesh of its boulder, the log a solid box round its trunk.
 */
export function chicaneBlockers(track: RaceTrack): ChicaneBlocker[] {
  const blockers: ChicaneBlocker[] = [];
  const hw = track.halfWidth;
  const reach = hw + track.runoffM;
  // The ground under a point: the plane of the stretch nearest it, carried across the run-off.
  const ground = (x: number, z: number): number => {
    const at = track.project(x, z);
    return track.surfaceY(at.s, Math.max(-reach, Math.min(reach, at.lateral)));
  };
  // Nearest a capsule's outline comes to any stretch's asphalt edge, metres.
  const margin = (x0: number, z0: number, x1: number, z1: number, radius: number): number => {
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0)));
    let worst = Infinity;
    for (let k = 0; k <= steps; k++) {
      const at = track.project(x0 + ((x1 - x0) * k) / steps, z0 + ((z1 - z0) * k) / steps);
      worst = Math.min(worst, Math.abs(at.lateral) - radius - hw);
    }
    return worst;
  };
  trackChicanes(track).forEach((chicane, index) => {
    // The straight's line, and its normal toward the displaced middle.
    const entry = track.sampleAt(chicane.startS - CHORD_REACH_M);
    const exit = track.sampleAt(chicane.startS + chicane.length + CHORD_REACH_M);
    const chord = Math.hypot(exit.x - entry.x, exit.z - entry.z);
    const nx = (chicane.side * (exit.z - entry.z)) / chord;
    const nz = (-chicane.side * (exit.x - entry.x)) / chord;
    const midS = chicane.startS + chicane.length / 2;
    const mid = track.sampleAt(midS);
    const shift = (mid.x - entry.x) * nx + (mid.z - entry.z) * nz;
    // `u`: metres from the middle's centreline back toward the straight's line.
    const ux = (u: number): number => mid.x - nx * u;
    const uz = (u: number): number => mid.z - nz * u;

    const rockU = hw + BLOCKER_CLEAR_M + ROCK_REACH * ROCK_SCALE;
    const rockAt = track.project(ux(rockU), uz(rockU), midS);
    blockers.push({
      kind: 'rock',
      chicane: index,
      s: rockAt.s,
      lateral: rockAt.lateral,
      x: ux(rockU),
      z: uz(rockU),
      y: ground(ux(rockU), uz(rockU)),
      scale: ROCK_SCALE,
      yaw: hash01(track.postIndex, BLOCKER_DOMAIN, index) * Math.PI * 2,
      pitch: 0,
      halfLength: 0,
      radius: ROCK_REACH * ROCK_SCALE,
      solid: ROCK_SOLID * ROCK_SCALE,
    });

    // The log, its inner end against the rock's core, pulled in from its outer end
    // while it comes nearer another stretch's asphalt than the clearance.
    const inner = rockU + ROCK_SOLID * ROCK_SCALE * 0.8;
    let outer = shift + hw + LOG_OVERHANG_M;
    while (outer - inner > 2 && margin(ux(inner), uz(inner), ux(outer), uz(outer), LOG_RADIUS_M) < BLOCKER_CLEAR_M) outer -= 0.25;
    const centre = (inner + outer) / 2;
    const half = (outer - inner) / 2;
    const yInner = ground(ux(inner), uz(inner));
    const yOuter = ground(ux(outer), uz(outer));
    const logAt = track.project(ux(centre), uz(centre), midS);
    blockers.push({
      kind: 'log',
      chicane: index,
      s: logAt.s,
      lateral: logAt.lateral,
      x: ux(centre),
      z: uz(centre),
      y: (yInner + yOuter) / 2,
      scale: 1,
      // Its +X end is the inner one: along +n from the middle, i.e. (nx, nz).
      yaw: Math.atan2(-nz, nx),
      pitch: Math.atan2(yInner - yOuter, 2 * half),
      halfLength: half,
      radius: LOG_RADIUS_M,
      solid: LOG_RADIUS_M * LOG_TIP_SHARE,
    });
  });
  return blockers;
}

/** A blocker's placement, origin-relative: the boulder on its foot, the log's axis on the sand. */
function blockerMatrix(blocker: ChicaneBlocker, ox: number, oz: number, matrix: THREE.Matrix4): THREE.Matrix4 {
  const rock = blocker.kind === 'rock';
  scratchTurn.setFromAxisAngle(UP, blocker.yaw);
  if (!rock) scratchTurn.multiply(scratchPitch.setFromAxisAngle(FORWARD_Z, blocker.pitch));
  return matrix.compose(
    scratchVertex.set(blocker.x - ox, rock ? blocker.y - ROCK_SINK * blocker.scale : blocker.y + LOG_RADIUS_M - LOG_SINK_M, blocker.z - oz),
    scratchTurn,
    rock ? scratchScale.setScalar(blocker.scale) : scratchScale.set(blocker.halfLength, LOG_RADIUS_M, LOG_RADIUS_M),
  );
}

/** Every chicane's rock and log drawn into `soup`, origin-relative. */
function addBlockers(soup: PaletteSoup, track: RaceTrack, ox: number, oz: number): void {
  const parts = propTemplates();
  const matrix = new THREE.Matrix4();
  for (const blocker of chicaneBlockers(track)) {
    soup.add(blocker.kind === 'rock' ? parts.boulder : parts.log, blockerMatrix(blocker, ox, oz, matrix), null);
  }
}

/**
 * The chicane blockers' colliders, origin-relative: each rock a static `Rock` trimesh
 * of its boulder as drawn, each log a solid `Rock` box round its trunk (its core,
 * `LOG_TIP_SHARE` of its radius, either side of the axis). The provider and a caller
 * that builds the track's ground itself (tools/racelapworld.ts) both add these.
 */
export function addChicaneBlockerColliders(
  physics: PhysicsWorld,
  track: RaceTrack,
  originX: number,
  originZ: number,
  enabled: boolean,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
): void {
  const parts = propTemplates();
  const matrix = new THREE.Matrix4();
  for (const blocker of chicaneBlockers(track)) {
    blockerMatrix(blocker, originX, originZ, matrix);
    if (blocker.kind === 'rock') {
      const soup = new PaletteSoup();
      soup.add(parts.boulder, matrix, null);
      addTrimesh(physics, Float32Array.from(soup.positions), Uint32Array.from(soup.indices), SurfaceType.Rock, enabled, bodies, colliders);
      continue;
    }
    const core = LOG_RADIUS_M * LOG_TIP_SHARE;
    const collider = physics.addStaticBox(
      { x: blocker.halfLength, y: core, z: core },
      { x: blocker.x - originX, y: blocker.y + LOG_RADIUS_M - LOG_SINK_M, z: blocker.z - originZ },
      scratchTurn,
      SurfaceType.Rock,
    );
    if (!enabled) collider.setEnabled(false);
    colliders.push(collider);
    const body = collider.parent();
    if (body) bodies.push(body);
  }
}

/**
 * THE CHECKPOINT GATES: two posts and a banner beam at every checkpoint, collided as
 * drawn (solid boxes, `Concrete`). The posts stand `GATE_POST_OUT_M` beyond the
 * asphalt's edge — their inner faces just past it, on the lip — so a car on the
 * asphalt never meets one and one that runs wide does. The beam's underside is
 * `GATE_CLEARANCE_M` over the HIGHEST point of the surface between the posts (a banked
 * gate's high side), above the tallest load on the road (the tented trucks, about
 * 3.5 m), and collided at that height too. Checkpoints never fall in a chicane
 * (track.ts), so no post stands by a blocker.
 */
const GATE_POST_OUT_M = 1.0;
const GATE_POST_HALF_M = 0.17;
const GATE_POST_SINK_M = 0.3;
const GATE_CLEARANCE_M = 5.2;
const GATE_BANNER_M = 0.8;
const GATE_BANNER_DEPTH_M = 0.12;
const GATE_BLOCKS = 9;

/** One box of a gate, absolute: its middle, half extents along its own axes, turn about +Y. */
export interface GateBox {
  readonly gate: number;
  readonly part: 'post' | 'beam';
  readonly s: number;
  /** The box's middle off the centreline (lateral positive LEFT). */
  readonly lateral: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Half extents: x across the lap, y up, z along it. */
  readonly halfX: number;
  readonly halfY: number;
  readonly halfZ: number;
  readonly yaw: number;
}

/** Every checkpoint gate's posts and beam, pure in the track (see `GATE_POST_OUT_M`). */
export function checkpointGates(track: RaceTrack): GateBox[] {
  const boxes: GateBox[] = [];
  const point = { x: 0, y: 0, z: 0 };
  const postLateral = track.halfWidth + GATE_POST_OUT_M;
  track.checkpoints.forEach((s, gate) => {
    const yaw = track.sampleAt(s).heading;
    // The plane is linear across, so its highest point between the posts is at one of them.
    const high = Math.max(track.surfaceY(s, -postLateral), track.surfaceY(s, postLateral));
    const bannerY = high + GATE_CLEARANCE_M + GATE_BANNER_M / 2;
    for (const sign of [-1, 1]) {
      const foot = track.surfaceY(s, sign * postLateral) - GATE_POST_SINK_M;
      const height = bannerY + GATE_BANNER_M / 2 - foot;
      track.offsetPoint(s, sign * postLateral, point);
      boxes.push({
        gate,
        part: 'post',
        s,
        lateral: sign * postLateral,
        x: point.x,
        y: foot + height / 2,
        z: point.z,
        halfX: GATE_POST_HALF_M,
        halfY: height / 2,
        halfZ: GATE_POST_HALF_M,
        yaw,
      });
    }
    track.offsetPoint(s, 0, point);
    boxes.push({
      gate,
      part: 'beam',
      s,
      lateral: 0,
      x: point.x,
      y: bannerY,
      z: point.z,
      halfX: postLateral + GATE_POST_HALF_M,
      halfY: GATE_BANNER_M / 2,
      halfZ: GATE_BANNER_DEPTH_M / 2,
      yaw,
    });
  });
  return boxes;
}

/** The gates' colliders, origin-relative: one static box per post and beam. */
export function addGateColliders(
  physics: PhysicsWorld,
  track: RaceTrack,
  originX: number,
  originZ: number,
  enabled: boolean,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
): void {
  for (const box of checkpointGates(track)) {
    const collider = physics.addStaticBox(
      { x: box.halfX, y: box.halfY, z: box.halfZ },
      { x: box.x - originX, y: box.y, z: box.z - originZ },
      scratchTurn.setFromAxisAngle(UP, box.yaw),
      SurfaceType.Concrete,
    );
    if (!enabled) collider.setEnabled(false);
    colliders.push(collider);
    const body = collider.parent();
    if (body) bodies.push(body);
  }
}

/**
 * A wall's collision: a box section of `TYRE_STACK_RADIUS_M` either side of the line of
 * stacks, from its foot to its top. `line` is x, foot y, z, top y per station.
 */
function wallStrip(line: readonly number[]): { vertices: Float32Array; indices: Uint32Array } {
  const stations = line.length / 4;
  const vertices = new Float32Array(stations * 4 * 3);
  for (let k = 0; k < stations; k++) {
    const x = line[k * 4]!;
    const foot = line[k * 4 + 1]!;
    const z = line[k * 4 + 2]!;
    const top = line[k * 4 + 3]!;
    const next = Math.min(stations - 1, k + 1);
    const prev = Math.max(0, k - 1);
    const dx = line[next * 4]! - line[prev * 4]!;
    const dz = line[next * 4 + 2]! - line[prev * 4 + 2]!;
    const length = Math.hypot(dx, dz) || 1;
    const ax = (-dz / length) * TYRE_STACK_RADIUS_M;
    const az = (dx / length) * TYRE_STACK_RADIUS_M;
    const corners = [
      [x + ax, foot, z + az],
      [x + ax, top, z + az],
      [x - ax, top, z - az],
      [x - ax, foot, z - az],
    ];
    corners.forEach((corner, c) => vertices.set(corner, (k * 4 + c) * 3));
  }
  const indices: number[] = [];
  for (let k = 0; k + 1 < stations; k++) {
    for (let c = 0; c < 3; c++) {
      const a = k * 4 + c;
      const b = a + 1;
      indices.push(a, b, a + 4, b, b + 4, a + 4);
    }
  }
  // End caps.
  for (const k of [0, stations - 1]) indices.push(k * 4, k * 4 + 1, k * 4 + 2, k * 4, k * 4 + 2, k * 4 + 3);
  return { vertices, indices: Uint32Array.from(indices) };
}

/** The paddock: level concrete beside the start straight, rows along it, three columns. */
function buildPaddock(track: RaceTrack, ox: number, oz: number, colour: THREE.Color): Sheet {
  const sheet = newSheet();
  const { s0, s1, inner, outer, side } = track.paddock;
  const rows = Math.max(2, Math.round((s1 - s0) / RIBBON_STEP_M) + 1);
  const across = [inner - 0.3, (inner + outer) / 2, outer];
  const point = { x: 0, y: 0, z: 0 };
  for (let r = 0; r < rows; r++) {
    const s = s0 + ((s1 - s0) * r) / (rows - 1);
    const y = track.centreY(s) + TRACK_LIFT_M;
    for (const u of across) {
      track.offsetPoint(s, side * u, point);
      sheet.positions.push(point.x - ox, y, point.z - oz);
      sheet.colors.push(colour.r, colour.g, colour.b);
      sheet.normals.push(0, 1, 0);
      sheet.uvs.push((side * u) / ROAD_TILE_METRES, s / ROAD_TILE_METRES);
    }
  }
  pushStripIndices(sheet, rows, across.length, side);
  return sheet;
}

/**
 * Up-facing indices for `rows` x `columns` vertices laid row by row, rows running forward
 * and columns running out to `side` (signed lateral sign, +1 = left).
 */
function pushStripIndices(sheet: Sheet, rows: number, columns: number, side: number): void {
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < columns - 1; c++) {
      const a = r * columns + c;
      const b = a + columns;
      if (side > 0) sheet.indices.push(a, b, a + 1, a + 1, b, b + 1);
      else sheet.indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
}

/**
 * The access lane: a gravel strip draped on the DRAWN ground. Per station the ground
 * across the top is fitted with a line — the lane's cross-fall, up to `LANE_CROSS_MAX`
 * — and the top raised until no ground sample at the station or halfway to either
 * neighbour stands above it (the strip is straight between stations, so it never dips
 * under the sand), then smoothed along without coming down: both edges lie on the
 * ground rather than one of them standing proud of it, and on a slope the top follows
 * it instead of being held up by the higher stations. The SHOULDERS fall from the top's
 * edges to `LANE_TUCK_M` under the drawn ground `LANE_SHOULDER_M` out; the whole sheet,
 * shoulders included, is the collider (`addSheetColliders` over every column), so what
 * a wheel stands on is what is drawn and leaving the edge is a slope, not a step. Its
 * first row is the lay-by's own edge height and its last the paddock's, both level
 * across, so both joins are flush; the cross-fall eases in from them over
 * `LANE_CROSS_EASE_M`.
 */
function buildLane(ctx: ChunkContext, track: RaceTrack, roadDistance: RoadDistance, colour: THREE.Color, shoulder: THREE.Color): Sheet {
  const sheet = newSheet();
  const lane = track.accessLane;
  const ground = tileGroundSampler({ seed: ctx.world.seed, road: ctx.road, terrain: ctx.terrain, roadDistance });
  const g: DrawnGroundSample = { height: 0, detail: 0, nx: 0, ny: 1, nz: 0 };
  const hw = track.laneHalfWidth;
  const across = [-(hw + LANE_SHOULDER_M), -hw, hw, hw + LANE_SHOULDER_M];
  const n = lane.length;
  const dirX = new Float64Array(n);
  const dirZ = new Float64Array(n);
  const samples = new Float64Array(n * 5);
  // The same five across halfway from each station to the next.
  const halfway = new Float64Array(Math.max(0, n - 1) * 5);
  const rawFall = new Float64Array(n);
  const reach = hw + 0.5;
  for (let i = 0; i < n; i++) {
    const a = lane[Math.max(0, i - 1)]!;
    const b = lane[Math.min(n - 1, i + 1)]!;
    const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    dirX[i] = (b.x - a.x) / length;
    dirZ[i] = (b.z - a.z) / length;
    // Five samples across, u = -reach..reach, and their least-squares slope, clamped.
    let moment = 0;
    for (let k = -2; k <= 2; k++) {
      const u = (k / 2) * reach;
      // Left of the lane's direction (dx, dz) is (dz, -dx).
      ground(lane[i]!.x + dirZ[i]! * u, lane[i]!.z - dirX[i]! * u, g);
      samples[i * 5 + k + 2] = g.height;
      moment += g.height * u;
    }
    // Sum of u² over the five samples: reach² (1/4 + 1 + 1/4 + 1) = 2.5 reach².
    rawFall[i] = Math.max(-LANE_CROSS_MAX, Math.min(LANE_CROSS_MAX, moment / (2.5 * reach * reach)));
  }
  for (let i = 0; i + 1 < n; i++) {
    const mx = (lane[i]!.x + lane[i + 1]!.x) / 2;
    const mz = (lane[i]!.z + lane[i + 1]!.z) / 2;
    const sx = (dirX[i]! + dirX[i + 1]!) / 2;
    const sz = (dirZ[i]! + dirZ[i + 1]!) / 2;
    for (let k = -2; k <= 2; k++) {
      const u = (k / 2) * reach;
      ground(mx + sz * u, mz - sx * u, g);
      halfway[i * 5 + k + 2] = g.height;
    }
  }
  // The lay-by's edge (the pad is level across, `Terrain.laybySurfaceY`) and the paddock's.
  const padProjection = ctx.road.project(lane[0]!.x, lane[0]!.z, track.postS);
  const padY = ctx.terrain.laybySurfaceY(padProjection.s, padProjection.lateral, track.side);
  const gate = track.paddock;
  const paddockY = track.centreY((gate.s0 + gate.s1) / 2) + TRACK_LIFT_M;
  // The cross-fall: averaged along, eased to level at both ends.
  const alongs = new Float64Array(n);
  for (let i = 1; i < n; i++) alongs[i] = alongs[i - 1]! + Math.hypot(lane[i]!.x - lane[i - 1]!.x, lane[i]!.z - lane[i - 1]!.z);
  const total = alongs[n - 1]!;
  const falls = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let count = 0;
    for (let k = Math.max(0, i - LANE_SMOOTH_ROWS); k <= Math.min(n - 1, i + LANE_SMOOTH_ROWS); k++) {
      sum += rawFall[k]!;
      count++;
    }
    falls[i] = (sum / count) * Math.min(1, alongs[i]! / LANE_CROSS_EASE_M, (total - alongs[i]!) / LANE_CROSS_EASE_M);
  }
  // The top's centre height with that fall: over every sample at the station and
  // halfway to its neighbours, then smoothed along but never brought under that.
  const over = (i: number, from: Float64Array, k: number): number => {
    let high = -Infinity;
    for (let j = -2; j <= 2; j++) high = Math.max(high, from[k * 5 + j + 2]! - falls[i]! * (j / 2) * reach);
    return high;
  };
  const held = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let high = over(i, samples, i);
    if (i > 0) high = Math.max(high, over(i, halfway, i - 1));
    if (i + 1 < n) high = Math.max(high, over(i, halfway, i));
    held[i] = high;
  }
  for (let i = 0; i < n; i++) {
    const along = alongs[i]!;
    const fall = falls[i]!;
    let sum = 0;
    let count = 0;
    for (let k = Math.max(0, i - LANE_SMOOTH_ROWS); k <= Math.min(n - 1, i + LANE_SMOOTH_ROWS); k++) {
      sum += held[k]!;
      count++;
    }
    let y = Math.max(sum / count, held[i]!) + LANE_LIFT_M;
    // Off the pad: never under the road's shoulder strip, which falls from the pad's edge.
    if (along < 6) y = Math.max(y, padY - 0.04 * along);
    if (i === 0) y = padY;
    if (i === n - 1) y = paddockY;
    const ends = i === 0 || i === n - 1;
    for (let c = 0; c < across.length; c++) {
      const shoulderColumn = c === 0 || c === across.length - 1;
      let u = across[c]!;
      if (shoulderColumn && !ends) {
        // As wide as it takes to come down to the sand at `LANE_SHOULDER_SLOPE`.
        const side = Math.sign(u);
        ground(lane[i]!.x + dirZ[i]! * side * hw, lane[i]!.z - dirX[i]! * side * hw, g);
        const drop = y + fall * side * hw - g.height;
        u = side * (hw + Math.min(LANE_SHOULDER_MAX_M, Math.max(LANE_SHOULDER_M, drop / LANE_SHOULDER_SLOPE)));
      }
      const x = lane[i]!.x + dirZ[i]! * u;
      const z = lane[i]!.z - dirX[i]! * u;
      let vy = y + fall * (shoulderColumn ? Math.sign(u) * hw : u);
      if (shoulderColumn && !ends) {
        // Its outer edge is a chord from station to station: lowered by however far the
        // ground halfway to either neighbour lies under that chord, so the shoulder
        // meets the sand there too instead of standing proud of it.
        const at = (k: number): number => {
          ground(lane[k]!.x + dirZ[k]! * u, lane[k]!.z - dirX[k]! * u, g);
          return g.height;
        };
        const here = at(i);
        let sag = 0;
        for (const k of [i - 1, i + 1]) {
          const there = at(k);
          ground((x + lane[k]!.x + dirZ[k]! * u) / 2, (z + lane[k]!.z - dirX[k]! * u) / 2, g);
          sag = Math.max(sag, (here + there) / 2 - g.height);
        }
        vy = here - LANE_TUCK_M - sag;
      }
      sheet.positions.push(x - ctx.originX, vy, z - ctx.originZ);
      const tint = shoulderColumn ? shoulder : colour;
      sheet.colors.push(tint.r, tint.g, tint.b);
      sheet.normals.push(0, 1, 0);
      sheet.uvs.push(u / ROAD_TILE_METRES, along / ROAD_TILE_METRES);
    }
  }
  pushStripIndices(sheet, n, across.length, 1);
  return sheet;
}

/** Collision slabs of a sheet's rows (all of it in one trimesh when it is small). */
function addSheetColliders(
  physics: PhysicsWorld,
  sheet: Sheet,
  columns: number,
  surface: SurfaceType,
  firstColumn: number,
  lastColumn: number,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
): void {
  const rows = sheet.positions.length / 3 / columns;
  for (let r0 = 0; r0 < rows - 1; r0 += COLLIDER_SLAB_ROWS) {
    const r1 = Math.min(rows - 1, r0 + COLLIDER_SLAB_ROWS);
    const width = lastColumn - firstColumn + 1;
    const vertices = new Float32Array((r1 - r0 + 1) * width * 3);
    for (let r = r0; r <= r1; r++) {
      for (let c = firstColumn; c <= lastColumn; c++) {
        const from = (r * columns + c) * 3;
        vertices.set(sheet.positions.slice(from, from + 3), ((r - r0) * width + (c - firstColumn)) * 3);
      }
    }
    const indices: number[] = [];
    for (let r = 0; r < r1 - r0; r++) {
      for (let c = 0; c < width - 1; c++) {
        const a = r * width + c;
        const b = a + width;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    addTrimesh(physics, vertices, Uint32Array.from(indices), surface, false, bodies, colliders);
  }
}

/**
 * A hidden mesh per material shape the tracks draw, for the scene at boot, so
 * `waitForFrameShaders` links their programs behind the loading cover (see the
 * shader-variant rules): the ribbon, the paddock and the lane in the road's material,
 * the paint in its marking material, and the props in the 0.88 flat palette, cast and
 * received as the settlements' merged kit is.
 */
export function raceTrackProgramAnchor(): THREE.Object3D {
  const group = new THREE.Group();
  group.name = 'racetrack-anchor';
  const triangle = (uv: boolean): THREE.BufferGeometry => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0.01, 0.01, 0, 0], 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Array(9).fill(0), 3));
    if (uv) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(6).fill(0), 2));
    return geometry;
  };
  const ribbon = new THREE.Mesh(triangle(true), roadAsphaltMaterial());
  ribbon.receiveShadow = true;
  const paintMesh = new THREE.Mesh(triangle(false), roadMarkingMaterial());
  paintMesh.receiveShadow = true;
  const props = new THREE.Mesh(triangle(true), makeFlatPaletteMaterial(PROP_ROUGHNESS));
  props.castShadow = true;
  props.receiveShadow = true;
  for (const mesh of [ribbon, paintMesh, props]) {
    mesh.visible = false;
    group.add(mesh);
  }
  return group;
}

/** See the header. */
export class RaceTrackProvider implements ChunkProvider {
  readonly id = 'racetrack';

  /**
   * The SHARED road-distance index, for the lane's drape: `tileGroundSampler` reproduces
   * the drawn tiles only by asking the lattice they asked (as the road shoulder does).
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
    const bodies: RAPIER.RigidBody[] = [];
    const colliders: RAPIER.Collider[] = [];
    let group: THREE.Group | null = null;
    // Posts whose track's owner could be this chunk: its post lies within the spread.
    for (const post of postStopsBetween(seed, ctx.sStart - CHUNK_SPREAD_M, ctx.sEnd + CHUNK_SPREAD_M)) {
      if (!postHasTrack(seed, post.index)) continue;
      // Placing a track the first time is the terrain's work too (it levels the ground);
      // usually already done by the tiles that drew the ground here.
      const track = ctx.terrain.raceTracks.track(post.index);
      yield;
      if (!track || Math.floor(track.chunkS / CHUNK_LENGTH) !== ctx.chunkIndex) continue;
      const trackGroup = (group ??= new THREE.Group());
      trackGroup.name = 'racetrack';
      const ox = ctx.originX;
      const oz = ctx.originZ;
      const gain = roadVertexColorGain();
      const sand = new THREE.Color(desertPaletteAt(track.postS).sand);
      const tones: Record<TrackSurfaceKind, THREE.Color> = {
        asphalt: roadLaneVertexColor(new THREE.Color(), TRACK_SURFACE.asphalt),
        gravel: roadLaneVertexColor(new THREE.Color(), TRACK_SURFACE.gravel),
        dirt: new THREE.Color(DIRT_COLOUR).multiplyScalar(gain),
      };
      const sandTone = sand.clone().multiplyScalar(gain);
      const addMesh = (geometry: THREE.BufferGeometry, material: THREE.Material, casts: boolean, name = ''): void => {
        geometries.push(geometry);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = name;
        mesh.castShadow = casts;
        mesh.receiveShadow = true;
        trackGroup.add(mesh);
      };

      const ribbon = buildTrackRibbon(track, ox, oz, (kind, lip, out) => {
        out.copy(tones[kind]);
        if (lip) out.lerp(sandTone, LIP_SAND);
      });
      const ribbonGeometry = new THREE.BufferGeometry();
      ribbonGeometry.setAttribute('position', new THREE.BufferAttribute(ribbon.positions, 3));
      ribbonGeometry.setAttribute('color', new THREE.BufferAttribute(ribbon.colors, 3));
      ribbonGeometry.setAttribute('uv', new THREE.BufferAttribute(ribbon.uvs, 2));
      ribbonGeometry.setAttribute('normal', new THREE.BufferAttribute(ribbon.normals, 3));
      ribbonGeometry.setIndex(new THREE.BufferAttribute(ribbon.indices, 1));
      addMesh(ribbonGeometry, roadAsphaltMaterial(), false);
      yield;

      const paddock = buildPaddock(track, ox, oz, roadLaneVertexColor(new THREE.Color(), SurfaceType.Concrete));
      addMesh(sheetGeometry(paddock, true), roadAsphaltMaterial(), false);
      yield;
      const lane = buildLane(ctx, track, this.roadDistance, tones.gravel, tones.gravel.clone().lerp(sandTone, LIP_SAND));
      addMesh(sheetGeometry(lane, true), roadAsphaltMaterial(), false, 'racetrack-lane');
      yield;

      addMesh(yield* paintSteps(track, trackPaintRects(track), ox, oz), roadMarkingMaterial(), false);
      yield;

      const props = yield* propSteps(track, ox, oz);
      if (props.geometry) addMesh(props.geometry, makeFlatPaletteMaterial(PROP_ROUGHNESS), true);
      yield;

      if (ctx.hasPhysics) {
        yield* ribbonColliderSteps(ctx.physics, ribbon, false, bodies, colliders);
        yield;
        addSheetColliders(ctx.physics, paddock, 3, SurfaceType.Concrete, 0, 2, bodies, colliders);
        // The lane as drawn, shoulders and all (see `buildLane`): its shoulders are what
        // carries a wheel off its edge down onto the sand.
        addSheetColliders(ctx.physics, lane, 4, SurfaceType.Gravel, 0, 3, bodies, colliders);
        yield;
        for (const wall of props.walls) {
          addTrimesh(ctx.physics, wall.vertices, wall.indices, SurfaceType.Rock, false, bodies, colliders);
          yield;
        }
        addChicaneBlockerColliders(ctx.physics, track, ox, oz, false, bodies, colliders);
        yield;
        addGateColliders(ctx.physics, track, ox, oz, false, bodies, colliders);
        yield;
      }
    }
    if (!group) return null;
    return {
      group,
      bodies,
      colliders,
      dispose: () => {
        for (const geometry of geometries) geometry.dispose();
      },
    };
  }
}
