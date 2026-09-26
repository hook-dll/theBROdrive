import * as THREE from 'three';

import { SurfaceField, roadSurfaceY } from './roadsurface';
import type { Road } from './road';
import { shoulderWidthAt } from './shoulder';

/**
 * WHERE A ROAD MEETS WATER: the parapets of a bridge, and the mouth of a culvert.
 *
 * The ground half of this lives in `world/streams.ts` and `world/terrain.ts`: a bed is
 * cut through the corridor, and where the reach is big enough the corridor grading
 * steps aside so that the bed is OPEN under the asphalt. What is left is the thing a
 * driver actually notices, which is structure:
 *
 *   A BRIDGE gets concrete parapets along both edges of the deck — the deck itself is
 *   the road ribbon, whose own skirt (`ROAD_BED_DEPTH` in roadmesh.ts) is the fascia
 *   seen from the side — plus a pier every fourteen metres on the long ones. The
 *   parapets are SOLID: they are the one piece of roadside furniture a car at speed
 *   actually reaches, and a car that leaves the road on a bridge should hit a wall
 *   rather than find the stream.
 *
 *   A CULVERT gets its headwalls and its portal at both faces of the embankment, where
 *   the stream enters and leaves. Nothing else: a culvert is a hole in a bank, and the
 *   whole point of one is that the road on top of it looks like ordinary road.
 *
 * Which one a crossing is comes from the stream's own size field, read at the same
 * point the ground was shaped from (`StreamSample.span`), so the structure and the gap
 * under it can never disagree. Measured over six seeds, `tools/landscape-census.ts`:
 * every bridge's bed is open under the deck (median clearance 1.5 m) and every culvert's
 * embankment stands above the water (median 1 m).
 *
 * Cost: one merged geometry and ONE extra draw call per chunk, and only on the few
 * hundred metres of a chunk that stands over water.
 */

/** Parapet: how far outside the shoulder its outer face stands, metres. */
const PARAPET_GAP_M = 0.12;
/** Parapet slab: thickness across the road, height above the deck. */
const PARAPET_THICK_M = 0.3;
const PARAPET_HEIGHT_M = 0.72;
/** The rail above the slab: a bar, in the branch's "thin structures" voice. */
const RAIL_HEIGHT_M = 0.42;
const RAIL_THICK_M = 0.07;
/** Metres of deck either side of the water that the parapet covers. */
const PARAPET_MARGIN_M = 3.5;
/** A pier every this many metres of span, and its section. */
const PIER_SPACING_M = 14;
const PIER_HALF_ACROSS_M = 0.7;
const PIER_HALF_ALONG_M = 0.55;
const PIER_CLEAR_M = 0.25;

/** Culvert headwall: size across the stream, height, thickness along it. */
const HEADWALL_HALF_ACROSS_M = 1.7;
const HEADWALL_HALF_HEIGHT_M = 0.75;
const HEADWALL_HALF_DEPTH_M = 0.22;
/** How far outside the asphalt the headwall stands — the toe of the embankment. */
const HEADWALL_LATERAL_M = 8.5;
/** The dark portal in the middle of it, half-size, and how far it is sunk in. */
const PORTAL_HALF_M = 0.62;
/** The portal's face stands this far PROUD of the headwall's, because a recess cannot
 *  be cut out of a box: a dark square lying on the face reads as the opening, and one
 *  sunk behind it reads as nothing at all. */
const PORTAL_PROUD_M = 0.02;

/** Concrete, and the darker grey of the rail and the portal's shadow. */
const CONCRETE: readonly [number, number, number] = [0.42, 0.41, 0.38];
const CONCRETE_TOP: readonly [number, number, number] = [0.52, 0.5, 0.47];
const RAIL: readonly [number, number, number] = [0.22, 0.23, 0.22];
const PORTAL: readonly [number, number, number] = [0.03, 0.035, 0.03];

export interface StreamCrossingParts {
  /** Every box of every crossing in this chunk, one geometry. */
  readonly geometry: THREE.BufferGeometry;
  /** Just the parapets, in chunk-local metres, for the collider. */
  readonly solidVertices: Float32Array;
  readonly solidIndices: Uint32Array;
}

/** Accumulates transformed boxes: positions, colours and indices, all chunk-local. */
interface BoxSink {
  positions: number[];
  colors: number[];
  indices: number[];
  count: number;
}

function newSink(): BoxSink {
  return { positions: [], colors: [], indices: [], count: 0 };
}

/**
 * Appends one axis-aligned-in-its-own-frame box.
 *
 * Eight corners and twelve triangles, rotated by `yaw` about Y. Written out rather than
 * built from `THREE.BoxGeometry` because a chunk's crossings are 40-80 boxes and each
 * would otherwise be its own geometry, matrix and merge.
 */
function pushBox(
  sink: BoxSink,
  cx: number,
  cy: number,
  cz: number,
  yaw: number,
  halfX: number,
  halfY: number,
  halfZ: number,
  colour: readonly [number, number, number],
): void {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const base = sink.count;
  // Corners of a box whose X runs across the road and Z along it.
  for (let corner = 0; corner < 8; corner++) {
    const lx = (corner & 1) === 0 ? -halfX : halfX;
    const ly = (corner & 2) === 0 ? -halfY : halfY;
    const lz = (corner & 4) === 0 ? -halfZ : halfZ;
    sink.positions.push(cx + lx * cos + lz * sin, cy + ly, cz - lx * sin + lz * cos);
    sink.colors.push(colour[0], colour[1], colour[2]);
  }
  sink.count += 8;
  // Winding: outward faces, so the ink pass and the light agree with every other
  // solid in the world.
  const faces: readonly (readonly [number, number, number, number])[] = [
    [0, 2, 3, 1],
    [4, 5, 7, 6],
    [0, 1, 5, 4],
    [2, 6, 7, 3],
    [0, 4, 6, 2],
    [1, 3, 7, 5],
  ];
  for (const [a, b, c, d] of faces) {
    sink.indices.push(base + a, base + b, base + c, base + a, base + c, base + d);
  }
}

/**
 * Everything the road puts over a stream in one chunk, or null where it crosses none.
 *
 * `sStart`/`sEnd` are the chunk's arclength range; `ox`/`oz` the floating origin the
 * chunk's geometry is written against.
 */
export function buildStreamCrossings(
  road: Road,
  field: SurfaceField,
  sStart: number,
  sEnd: number,
  ox: number,
  oz: number,
): StreamCrossingParts | null {
  const streams = road.landscape.streams;
  const solid = newSink();
  const parts = newSink();
  const point = { x: 0, y: 0, z: 0 };
  const probe = { x: 0, y: 0, z: 0 };

  /** One crossing, from the arclength its bed starts to the arclength it ends. */
  const emit = (from: number, to: number, maxSpan: number): void => {
    const mid = (from + to) / 2;
    if (maxSpan > 0.5) emitBridge(from, to);
    else emitCulvert(mid);
  };

  const emitBridge = (from: number, to: number): void => {
    const deckFrom = from - PARAPET_MARGIN_M;
    const deckTo = to + PARAPET_MARGIN_M;
    const sideCount = Math.max(2, Math.ceil((deckTo - deckFrom) / 2));
    for (let i = 0; i <= sideCount; i++) {
      const s = deckFrom + ((deckTo - deckFrom) * i) / sideCount;
      const halfWidth = road.halfWidthAt(s);
      // The parapet stands at the outer edge of the bare shoulder: that shoulder is
      // part of the deck, and a wall inside it would be a wall in the wheel track.
      const overRuns: readonly number[] = [1, -1];
      for (const side of overRuns) {
        const outer = halfWidth + shoulderWidthAt(s, side) + PARAPET_GAP_M;
        const lateral = side * outer;
        road.offsetPoint(s, lateral, point);
        const y = roadSurfaceY(road, field, s, lateral, point.x, point.z);
        const yaw = road.sampleAt(s).heading;
        pushBox(
          parts,
          point.x - ox,
          y + PARAPET_HEIGHT_M / 2 - 0.06,
          point.z - oz,
          yaw,
          PARAPET_THICK_M / 2,
          PARAPET_HEIGHT_M / 2,
          0.9,
          CONCRETE,
        );
        pushBox(
          parts,
          point.x - ox,
          y + PARAPET_HEIGHT_M + 0.015,
          point.z - oz,
          yaw,
          PARAPET_THICK_M / 2 + 0.02,
          0.035,
          0.9,
          CONCRETE_TOP,
        );
        // The rail above the slab, and its posts, only where the deck is long enough
        // for a rail to read as one.
        if (deckTo - deckFrom > 9) {
          pushBox(
            parts,
            point.x - ox,
            y + PARAPET_HEIGHT_M + RAIL_HEIGHT_M,
            point.z - oz,
            yaw,
            RAIL_THICK_M / 2,
            RAIL_THICK_M / 2,
            0.9,
            RAIL,
          );
          if (i % 2 === 0) {
            pushBox(
              parts,
              point.x - ox,
              y + PARAPET_HEIGHT_M + RAIL_HEIGHT_M / 2,
              point.z - oz,
              yaw,
              RAIL_THICK_M / 2,
              RAIL_HEIGHT_M / 2,
              RAIL_THICK_M / 2,
              RAIL,
            );
          }
        }
        pushBox(
          solid,
          point.x - ox,
          y + PARAPET_HEIGHT_M / 2 - 0.06,
          point.z - oz,
          yaw,
          PARAPET_THICK_M / 2,
          PARAPET_HEIGHT_M / 2,
          0.9,
          CONCRETE,
        );
      }
    }
    // Piers: every fourteen metres of span, standing on the bed.
    const piers = Math.floor((to - from) / PIER_SPACING_M);
    for (let p = 1; p <= piers; p++) {
      const s = from + ((to - from) * p) / (piers + 1);
      road.offsetPoint(s, 0, point);
      const under = roadSurfaceY(road, field, s, 0, point.x, point.z);
      const ground = road.landscape.heightAt(point.x, point.z);
      const height = under - 0.4 - ground - PIER_CLEAR_M;
      if (height <= 0.5) continue;
      pushBox(
        parts,
        point.x - ox,
        ground + PIER_CLEAR_M + height / 2,
        point.z - oz,
        road.sampleAt(s).heading,
        PIER_HALF_ACROSS_M,
        height / 2,
        PIER_HALF_ALONG_M,
        CONCRETE,
      );
    }
  };

  /**
   * A culvert's two faces.
   *
   * The stream's own direction there comes from the field's gradient: the watercourse
   * is a contour of that field, so its tangent is the gradient turned a quarter turn.
   * Four samples, taken once per crossing, and they are what keeps the headwall square
   * to the stream instead of square to the road — which on a diagonal crossing is the
   * difference between a culvert and a wall standing across a ditch.
   */
  const emitCulvert = (s: number): void => {
    road.offsetPoint(s, 0, point);
    const step = 6;
    const streamsAt = (x: number, z: number): number => streams.at(x, z).d;
    const gx = streamsAt(point.x + step, point.z) - streamsAt(point.x - step, point.z);
    const gz = streamsAt(point.x, point.z + step) - streamsAt(point.x, point.z - step);
    const len = Math.hypot(gx, gz);
    if (len < 1e-6) return;
    // Tangent along the watercourse: the perpendicular of its gradient, normalised.
    const tx = -gz / len;
    const tz = gx / len;
    const yaw = Math.atan2(tx, tz);
    for (const direction of [1, -1]) {
      // Walk out along the stream until the road frame says we are past the embankment.
      let hit = false;
      for (let run = 2; run <= 30; run += 1) {
        const x = point.x + tx * run * direction;
        const z = point.z + tz * run * direction;
        const projection = road.project(x, z, s);
        if (Math.abs(projection.lateral) < HEADWALL_LATERAL_M) continue;
        const base = road.landscape.heightAt(x, z);
        pushBox(
          parts,
          x - ox,
          base - 0.15,
          z - oz,
          yaw,
          HEADWALL_HALF_ACROSS_M,
          HEADWALL_HALF_HEIGHT_M,
          HEADWALL_HALF_DEPTH_M,
          CONCRETE,
        );
        pushBox(
          parts,
          x - ox,
          base - 0.35,
          z - oz,
          yaw,
          PORTAL_HALF_M,
          PORTAL_HALF_M,
          HEADWALL_HALF_DEPTH_M + PORTAL_PROUD_M,
          PORTAL,
        );
        hit = true;
        break;
      }
      void hit;
    }
  };

  // The crossings themselves, found at the bed's presence on the centreline, which is the
  // same test the ground was shaped from.
  //
  // ONE CROSSING, ONE EMIT, BY THE CHUNK ITS OWN START FALLS IN. The scan used to be the
  // chunk's own range and a bed cut by a seam became two partial crossings: the first half
  // ran to `sEnd` and the second began at `sStart`, so a bridge got about seven metres of
  // coplanar duplicated parapet (z-fighting, and duplicate parapet colliders), a culvert got
  // two headwall pairs, and `maxSpan` was read per half, so one half could come out a bridge
  // and the other a culvert. The window is therefore opened either side of the chunk — a
  // crossing is 10-32 m along the road — and a crossing is emitted only by the chunk that
  // contains its START, drawn whole even where that reaches into the next chunk. A reach the
  // road runs ALONG (the docs' kilometre-long deck) extends the window until the bed closes,
  // bounded, because otherwise the deck would stop dead at the seam.
  const CROSSING_WINDOW_M = 96;
  const MAX_CROSSING_M = 1_500;
  const from = Math.max(0, sStart - CROSSING_WINDOW_M);
  const hardEnd = sEnd + MAX_CROSSING_M;
  const covered = sEnd + CROSSING_WINDOW_M;
  let inBed = false;
  let bedFrom = from;
  let maxSpan = 0;
  for (let s = from; s <= hardEnd; s += 2) {
    road.offsetPoint(s, 0, probe);
    const stream = streams.at(probe.x, probe.z);
    const over = stream.bed > 0.02;
    if (over) {
      if (!inBed) {
        inBed = true;
        bedFrom = s;
        maxSpan = 0;
      }
      if (stream.span > maxSpan) maxSpan = stream.span;
    } else if (inBed) {
      inBed = false;
      if (bedFrom >= sStart && bedFrom < sEnd) emit(bedFrom, s - 2, maxSpan);
    }
    if (s >= covered && !inBed) break;
  }
  if (inBed && bedFrom >= sStart && bedFrom < sEnd) emit(bedFrom, hardEnd, maxSpan);

  if (parts.count === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(parts.positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(parts.colors, 3));
  geometry.setIndex(parts.indices);
  geometry.computeVertexNormals();
  return {
    geometry,
    solidVertices: new Float32Array(solid.positions),
    solidIndices: new Uint32Array(solid.indices),
  };
}

/** Concrete, in the branch's flat-colour voice: no texture, no metal, light relief. */
export const STREAM_CROSSING_MATERIAL = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.92,
  metalness: 0,
});
