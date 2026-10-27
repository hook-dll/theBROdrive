import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PhysicsWorld } from '../../core/physics';
import { SurfaceType } from '../../core/surfaces';
import { makeFlatPaletteMaterial } from '../../render/materials';
import { ROAD_TILE_METRES } from '../../render/roadtexture';
import type { ChunkContent, ChunkContext, ChunkProvider } from '../chunks';
import { tileGroundSampler, type DrawnGroundSample } from '../deserttiledata';
import { desertPaletteAt } from '../gradient';
import { postStopsBetween } from '../poststops';
import { CHUNK_LENGTH } from '../ranges';
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
 *  - the PAINT in the road's marking material: edge lines on asphalt, red-and-white
 *    curbs on the inside of every corner tighter than `CURB_RADIUS_M`, the chequered line
 *    and the two grid boxes;
 *  - the PROPS in the flat palette the settlements' kit merges into: the start gantry
 *    over the line and tyre walls on the outside of the tight corners, the walls
 *    collided as one trimesh each.
 *
 * Triangle budget for a 2.6 km lap (tools/racetrack-gen.ts prints the real figures):
 * about 10k in the ribbon, a few thousand of paint, 6-10k of tyres; 40-50 static
 * trimesh bodies.
 */

/** The asphalt's height over the track's plane, so the levelled ground never shows through. */
export const TRACK_LIFT_M = 0.08;
/** The lip from the asphalt's edge down under the sand: its width, and how far below. */
const LIP_M = 1.2;
const LIP_SINK_M = 0.06;
/** Rows of the ribbon, metres apart (adjusted per sector to a whole number). */
const RIBBON_STEP_M = 2;
/** Rows per collider slab: the road's slab size, a small BVH each. */
const COLLIDER_SLAB_ROWS = 30;
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
/** Tyre walls: outside of corners tighter than this, past the run-off. */
const TYRE_RADIUS_M = 45;
const TYRE_STACK_RADIUS_M = 0.38;
const TYRE_STACK_HEIGHT_M = 0.78;
const TYRE_PITCH_M = 0.8;
/** The lane's lift over the drawn ground, and its stations' smoothing reach (rows). */
const LANE_LIFT_M = 0.06;
const LANE_SMOOTH_ROWS = 2;
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
  const rowIndices = (ribbon.columns - 1) * 6;
  // Quad rows before each run, to find its slice of the index buffer.
  let quadBase = 0;
  for (const run of ribbon.runs) {
    for (let q0 = 0; q0 < run.rows - 1; q0 += COLLIDER_SLAB_ROWS) {
      const q1 = Math.min(q0 + COLLIDER_SLAB_ROWS, run.rows - 1);
      const firstVertex = (run.firstRow + q0) * ribbon.columns;
      const vertices = ribbon.positions.subarray(firstVertex * 3, (run.firstRow + q1 + 1) * ribbon.columns * 3);
      const slab = ribbon.indices.slice((quadBase + q0) * rowIndices, (quadBase + q1) * rowIndices);
      for (let i = 0; i < slab.length; i++) slab[i] = slab[i]! - firstVertex;
      addTrimesh(physics, vertices, slab, run.surface, enabled, bodies, colliders);
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

/**
 * The paint: edge lines on the asphalt sectors, curbs on the inside of the tighter
 * corners, the chequered line at s = 0 and the two grid boxes behind it.
 */
function buildPaint(track: RaceTrack, ox: number, oz: number): THREE.BufferGeometry {
  const sheet = newSheet();
  const point = { x: 0, y: 0, z: 0 };
  const white = new THREE.Color(PAINT_WHITE);
  const red = new THREE.Color(PAINT_RED);
  const black = new THREE.Color(PAINT_BLACK);
  const hw = track.halfWidth;
  const quad = (s0: number, s1: number, l0: number, l1: number, colour: THREE.Color): void => {
    // Forward-right, forward-left, back-left, back-right: counter-clockwise from above.
    paintQuad(
      sheet,
      [
        onSurface(track, s1, l0, ox, oz, point),
        onSurface(track, s1, l1, ox, oz, point),
        onSurface(track, s0, l1, ox, oz, point),
        onSurface(track, s0, l0, ox, oz, point),
      ],
      colour,
    );
  };

  for (const sector of track.sectors) {
    if (sector.kind !== 'asphalt') continue;
    const rows = Math.max(1, Math.round((sector.endS - sector.startS) / RIBBON_STEP_M));
    for (let r = 0; r < rows; r++) {
      const s0 = sector.startS + ((sector.endS - sector.startS) * r) / rows;
      const s1 = sector.startS + ((sector.endS - sector.startS) * (r + 1)) / rows;
      for (const sign of [-1, 1]) {
        const centre = sign * (hw - EDGE_LINE_INSET_M);
        quad(s0, s1, centre - EDGE_LINE_HALF_M, centre + EDGE_LINE_HALF_M, white);
      }
    }
  }

  // Curbs: the middle of each tight corner's arc, on its inside, in alternating blocks.
  for (const corner of track.corners) {
    if (!Number.isFinite(corner.radius) || Math.abs(corner.radius) > CURB_RADIUS_M) continue;
    const inside = Math.sign(corner.radius);
    const start = corner.startS + corner.length * 0.15;
    const blocks = Math.max(1, Math.round((corner.length * 0.7) / CURB_BLOCK_M));
    const blockLength = (corner.length * 0.7) / blocks;
    for (let b = 0; b < blocks; b++) {
      const s0 = start + b * blockLength;
      const l0 = inside * (hw - CURB_WIDTH_M);
      const l1 = inside * hw;
      quad(s0, s0 + blockLength, Math.min(l0, l1), Math.max(l0, l1), b % 2 === 0 ? red : white);
    }
  }

  // The line: two rows of chequers across the asphalt at s = 0.
  const squares = 10;
  const square = (2 * hw) / squares;
  for (let row = 0; row < 2; row++) {
    for (let k = 0; k < squares; k++) {
      const l0 = -hw + k * square;
      quad(row * square - square, row * square, l0, l0 + square, (k + row) % 2 === 0 ? white : black);
    }
  }
  // The grid boxes: an open-backed box round each slot, nose to the line.
  for (const slot of track.startGrid) {
    const front = slot.s + 2.6;
    const back = slot.s - 3.2;
    const half = 1.3;
    quad(front - 0.25, front, slot.lateral - half, slot.lateral + half, white);
    quad(back, front, slot.lateral - half, slot.lateral - half + 0.2, white);
    quad(back, front, slot.lateral + half - 0.2, slot.lateral + half, white);
  }
  return sheetGeometry(sheet, false);
}

/** A box, centred on `centre` and turned to `yaw`, painted one colour. */
function propBox(parts: THREE.BufferGeometry[], size: readonly [number, number, number], centre: THREE.Vector3, yaw: number, hex: number): void {
  const geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
  geometry.applyMatrix4(new THREE.Matrix4().compose(centre, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1)));
  paint(geometry, hex);
  parts.push(geometry);
}

/** Vertex colour for a flat-palette part, decoded from sRGB as a material colour would be. */
function paint(geometry: THREE.BufferGeometry, hex: number): void {
  const colour = new THREE.Color(hex);
  const count = geometry.getAttribute('position').count;
  const colours = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colour.toArray(colours, i * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
}

interface Props {
  readonly geometry: THREE.BufferGeometry | null;
  /** Tyre walls as collision triangle soups, origin-relative. */
  readonly walls: readonly { readonly vertices: Float32Array; readonly indices: Uint32Array }[];
}

/**
 * The gantry over the line and the tyre walls round the tight corners' outsides, one
 * palette geometry; each wall also a box-section collision strip.
 */
function buildProps(track: RaceTrack, ox: number, oz: number): Props {
  const parts: THREE.BufferGeometry[] = [];
  const point = { x: 0, y: 0, z: 0 };
  const hw = track.halfWidth;

  // The gantry: two posts outside the asphalt's lip and a beam with the chequered board.
  const line = track.sampleAt(0);
  const yaw = line.heading;
  const postLateral = hw + LIP_M + 0.6;
  const beamY = 5.6;
  for (const sign of [-1, 1]) {
    track.offsetPoint(0, sign * postLateral, point);
    const ground = track.surfaceY(0, sign * postLateral);
    propBox(parts, [0.4, beamY + 0.4, 0.4], new THREE.Vector3(point.x - ox, ground + (beamY + 0.4) / 2 - 0.2, point.z - oz), yaw, 0x8c8f93);
  }
  const centreY = track.surfaceY(0, 0) + beamY;
  propBox(parts, [2 * postLateral + 0.4, 0.5, 0.4], new THREE.Vector3(line.x - ox, centreY, line.z - oz), yaw, 0x8c8f93);
  const checks = 12;
  const board = (2 * postLateral - 1) / checks;
  for (let k = 0; k < checks; k++) {
    for (let row = 0; row < 2; row++) {
      const lateral = -postLateral + 0.5 + board * (k + 0.5);
      track.offsetPoint(0, lateral, point);
      propBox(
        parts,
        [board, 0.45, 0.06],
        new THREE.Vector3(point.x - ox - Math.sin(yaw) * 0.24, centreY - 0.5 - row * 0.45, point.z - oz - Math.cos(yaw) * 0.24),
        yaw,
        (k + row) % 2 === 0 ? 0xe8e4da : 0x1c1c1c,
      );
    }
  }

  // Tyre walls: stacks along the outside of each tight corner, past the run-off.
  const walls: { vertices: Float32Array; indices: Uint32Array }[] = [];
  const tyre = new THREE.CylinderGeometry(TYRE_STACK_RADIUS_M, TYRE_STACK_RADIUS_M, TYRE_STACK_HEIGHT_M, 8);
  const placeAt = new THREE.Matrix4();
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
      const stack = tyre.clone();
      placeAt.makeTranslation(point.x - ox, ground + TYRE_STACK_HEIGHT_M / 2 - 0.05, point.z - oz);
      stack.applyMatrix4(placeAt);
      paint(stack, k % 6 === 0 ? 0xc9c2b4 : 0x202020);
      parts.push(stack);
      wall.push(point.x - ox, ground - 0.1, point.z - oz, ground + TYRE_STACK_HEIGHT_M);
    }
    walls.push(wallStrip(wall));
  }
  tyre.dispose();

  const geometry = parts.length > 0 ? mergeGeometries(parts, false) : null;
  for (const part of parts) part.dispose();
  return { geometry, walls };
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
 * The access lane: a gravel strip draped on the DRAWN ground, the highest ground across
 * it per station, held over a few stations and averaged back down (so it never dips
 * under the sand), its shoulders tucked into the sand. Its first row is the lay-by's
 * own edge height and its last the paddock's, so both joins are flush.
 */
function buildLane(ctx: ChunkContext, track: RaceTrack, roadDistance: RoadDistance, colour: THREE.Color, shoulder: THREE.Color): Sheet {
  const sheet = newSheet();
  const lane = track.accessLane;
  const ground = tileGroundSampler({ seed: ctx.world.seed, road: ctx.road, terrain: ctx.terrain, roadDistance });
  const g: DrawnGroundSample = { height: 0, detail: 0, nx: 0, ny: 1, nz: 0 };
  const hw = track.laneHalfWidth;
  const across = [-(hw + 1), -hw, hw, hw + 1];
  const n = lane.length;
  const dirX = new Float64Array(n);
  const dirZ = new Float64Array(n);
  const raw = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = lane[Math.max(0, i - 1)]!;
    const b = lane[Math.min(n - 1, i + 1)]!;
    const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    dirX[i] = (b.x - a.x) / length;
    dirZ[i] = (b.z - a.z) / length;
    let high = -Infinity;
    for (let k = -2; k <= 2; k++) {
      const u = (k / 2) * (hw + 0.5);
      // Left of the lane's direction (dx, dz) is (dz, -dx).
      ground(lane[i]!.x + dirZ[i]! * u, lane[i]!.z - dirX[i]! * u, g);
      high = Math.max(high, g.height);
    }
    raw[i] = high;
  }
  const held = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let high = -Infinity;
    for (let k = Math.max(0, i - LANE_SMOOTH_ROWS); k <= Math.min(n - 1, i + LANE_SMOOTH_ROWS); k++) high = Math.max(high, raw[k]!);
    held[i] = high;
  }
  // The lay-by's edge (the pad is level across, `Terrain.laybySurfaceY`) and the paddock's.
  const padProjection = ctx.road.project(lane[0]!.x, lane[0]!.z, track.postS);
  const padY = ctx.terrain.laybySurfaceY(padProjection.s, padProjection.lateral, track.side);
  const gate = track.paddock;
  const paddockY = track.centreY((gate.s0 + gate.s1) / 2) + TRACK_LIFT_M;
  let along = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) along += Math.hypot(lane[i]!.x - lane[i - 1]!.x, lane[i]!.z - lane[i - 1]!.z);
    let sum = 0;
    let count = 0;
    for (let k = Math.max(0, i - LANE_SMOOTH_ROWS); k <= Math.min(n - 1, i + LANE_SMOOTH_ROWS); k++) {
      sum += held[k]!;
      count++;
    }
    let y = sum / count + LANE_LIFT_M;
    // Off the pad: never under the road's shoulder strip, which falls from the pad's edge.
    if (along < 6) y = Math.max(y, padY - 0.04 * along);
    if (i === 0) y = padY;
    if (i === n - 1) y = paddockY;
    for (let c = 0; c < across.length; c++) {
      const u = across[c]!;
      const shoulderColumn = c === 0 || c === across.length - 1;
      const x = lane[i]!.x + dirZ[i]! * u;
      const z = lane[i]!.z - dirX[i]! * u;
      let vy = y;
      if (shoulderColumn && i > 0 && i < n - 1) {
        ground(x, z, g);
        vy = Math.min(y, g.height) - 0.05;
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
      group ??= new THREE.Group();
      group.name = 'racetrack';
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
      geometries.push(ribbonGeometry);
      const ribbonMesh = new THREE.Mesh(ribbonGeometry, roadAsphaltMaterial());
      ribbonMesh.receiveShadow = true;
      group.add(ribbonMesh);
      yield;

      const paddock = buildPaddock(track, ox, oz, roadLaneVertexColor(new THREE.Color(), SurfaceType.Concrete));
      const lane = buildLane(ctx, track, this.roadDistance, tones.gravel, tones.gravel.clone().lerp(sandTone, LIP_SAND));
      for (const sheet of [paddock, lane]) {
        const geometry = sheetGeometry(sheet, true);
        geometries.push(geometry);
        const mesh = new THREE.Mesh(geometry, roadAsphaltMaterial());
        mesh.receiveShadow = true;
        group.add(mesh);
      }
      yield;

      const paintGeometry = buildPaint(track, ox, oz);
      geometries.push(paintGeometry);
      const paintMesh = new THREE.Mesh(paintGeometry, roadMarkingMaterial());
      paintMesh.receiveShadow = true;
      group.add(paintMesh);
      yield;

      const props = buildProps(track, ox, oz);
      if (props.geometry) {
        geometries.push(props.geometry);
        const mesh = new THREE.Mesh(props.geometry, makeFlatPaletteMaterial(PROP_ROUGHNESS));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
      yield;

      if (ctx.hasPhysics) {
        addTrackRibbonColliders(ctx.physics, ribbon, false, bodies, colliders);
        yield;
        addSheetColliders(ctx.physics, paddock, 3, SurfaceType.Concrete, 0, 2, bodies, colliders);
        // The lane's top only: its shoulders are under the sand, which carries the wheel there.
        addSheetColliders(ctx.physics, lane, 4, SurfaceType.Gravel, 1, 2, bodies, colliders);
        for (const wall of props.walls) addTrimesh(ctx.physics, wall.vertices, wall.indices, SurfaceType.Rock, false, bodies, colliders);
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
