/**
 * A light airfield beside the road: a runway strip, and a plane parked at its start that
 * the player boards for the takeoff and the ending (story/takeoff.ts, story/ending.ts).
 *
 * NONE IS PLACED IN THE WORLD. It stood across the road from the start house until
 * 2026-10-21, when the start became an ordinary settlement; the layout, the strip and
 * the plane are kept for a site of their own. Setting `AIRFIELD` places it again: main
 * then streams `AirfieldProvider` (sitebuild.ts) and wires boarding to the takeoff.
 * Scatter does not keep clear of it yet (the old `storyKeepsClear` went with the house),
 * so a placement needs that keep-clear back.
 *
 * Pure in (seed, road, terrain, placement), never `Math.random`.
 */
import { hash01 } from '../core/rng';
import type { Road } from '../world/road';
import type { Terrain } from '../world/terrain';

/** Where an airfield lies in the road frame: its stretch of road, and its centreline's lateral (+ left). */
export interface AirfieldPlacement {
  readonly s0: number;
  readonly s1: number;
  readonly lateral: number;
}

/** The airfield the world has, or null: see the header. */
export const AIRFIELD: AirfieldPlacement | null = null;

/** Domain tag for the airfield's rolls. */
const AIRFIELD_TAG = 0x53545331; // 'STS1', the start site's, so a re-placed strip rolls the same width
/** Half the runway width rolls inside 7-8 m, so the frame is 14-16 m across. */
const RUNWAY_HALF_WIDTH_MIN = 7;
const RUNWAY_HALF_WIDTH_SPAN = 1;
/** Strip surface, a few centimetres above the terrain it is draped on. */
const RUNWAY_LIFT_M = 0.06;
/** The parked plane's origin sits this far in from the threshold, metres. */
const PLANE_INSET_M = 5;

/**
 * The runway's own frame: where the takeoff roll starts, which way it runs, how far
 * and how wide, and an arclength hint for the terrain queries along it.
 */
export interface RunwayFrame {
  /** Absolute world XZ of the runway centreline where the takeoff roll starts (the parked plane's spot). */
  readonly x0: number;
  readonly z0: number;
  /** Unit world-XZ direction of the takeoff roll. */
  readonly dx: number;
  readonly dz: number;
  /** Metres from (x0,z0) along (dx,dz) to the far end; and full width. */
  readonly length: number;
  readonly width: number;
  /** Arclength hint for terrain queries along it. */
  readonly hintS: number;
  /**
   * Surface height at stations `RUNWAY_PROFILE_STEP_M` apart from (x0,z0), lift included.
   * Level across the width and smoothed along it: see `runwayProfile`.
   */
  readonly profile: Float32Array;
}

export interface Airfield {
  readonly runway: RunwayFrame;
  /** Parked plane pose: absolute; y = ground under the main gear; yaw so forward = (sin yaw, cos yaw) = runway direction. */
  readonly plane: { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number };
}

const airfieldCache = new Map<string, Airfield>();

/** The airfield at `placement`, computed once per seed and placement. */
export function airfieldAt(seed: number, road: Road, terrain: Terrain, placement: AirfieldPlacement): Airfield {
  const key = `${seed}:${placement.s0}:${placement.s1}:${placement.lateral}`;
  const cached = airfieldCache.get(key);
  if (cached) return cached;

  const hintS = (placement.s0 + placement.s1) / 2;
  const halfRunway = RUNWAY_HALF_WIDTH_MIN + hash01(seed, AIRFIELD_TAG, 6) * RUNWAY_HALF_WIDTH_SPAN;
  const p0 = road.offsetPoint(placement.s0, placement.lateral);
  const p1 = road.offsetPoint(placement.s1, placement.lateral);
  const length = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  const dx = (p1.x - p0.x) / length;
  const dz = (p1.z - p0.z) / length;
  const runway: RunwayFrame = {
    x0: p0.x,
    z0: p0.z,
    dx,
    dz,
    length,
    width: halfRunway * 2,
    hintS,
    profile: runwayProfile(terrain, p0.x, p0.z, dx, dz, length, halfRunway, hintS),
  };

  const planeX = p0.x + dx * PLANE_INSET_M;
  const planeZ = p0.z + dz * PLANE_INSET_M;
  const airfield: Airfield = {
    runway,
    plane: { x: planeX, y: runwaySurfaceY(runway, planeX, planeZ), z: planeZ, yaw: Math.atan2(dx, dz) },
  };
  airfieldCache.set(key, airfield);
  return airfield;
}

/** Metres between the runway's height stations. */
const RUNWAY_PROFILE_STEP_M = 3;
/** Stations either side each smoothing pass reaches over: ±6 m. */
const RUNWAY_PROFILE_REACH = 2;

/**
 * The runway's surface heights: LEVEL ACROSS, SMOOTH ALONG, AND NEVER UNDER THE SAND.
 *
 * Draping the strip vertex by vertex on `heightAt` let the ground's decimetre chop show
 * through its edges and rocked the rolling plane. Each station instead takes the highest
 * ground across the whole width (and half a station either way), a running maximum over
 * ±6 m removes the dips between bumps, and a running mean over the same reach rounds the
 * result. Every mean covers the station's own maximum, so the surface stays at or above
 * the sand everywhere on the strip; the low side stands proud by a few centimetres and
 * the drawn shoulder (`sitebuild.ts`) takes it back down to the ground.
 */
function runwayProfile(
  terrain: Terrain,
  x0: number,
  z0: number,
  dx: number,
  dz: number,
  length: number,
  halfWidth: number,
  hintS: number,
): Float32Array {
  const count = Math.ceil(length / RUNWAY_PROFILE_STEP_M) + 1;
  const raw = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    let high = -Infinity;
    for (let along = -1.5; along <= 1.5; along += 1.5) {
      const t = Math.min(length, Math.max(0, i * RUNWAY_PROFILE_STEP_M + along));
      const cx = x0 + dx * t;
      const cz = z0 + dz * t;
      for (let across = -halfWidth; across <= halfWidth + 1e-6; across += halfWidth / 5) {
        high = Math.max(high, terrain.heightAt(cx - dz * across, cz + dx * across, hintS));
      }
    }
    raw[i] = high;
  }
  const peak = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    let high = -Infinity;
    for (let k = Math.max(0, i - RUNWAY_PROFILE_REACH); k <= Math.min(count - 1, i + RUNWAY_PROFILE_REACH); k++) {
      high = Math.max(high, raw[k]!);
    }
    peak[i] = high;
  }
  const profile = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    let sum = 0;
    let n = 0;
    for (let k = Math.max(0, i - RUNWAY_PROFILE_REACH); k <= Math.min(count - 1, i + RUNWAY_PROFILE_REACH); k++) {
      sum += peak[k]!;
      n++;
    }
    profile[i] = sum / n + RUNWAY_LIFT_M;
  }
  return profile;
}

/** Height of the runway surface (drawn and collided strip) at an absolute XZ. */
export function runwaySurfaceY(runway: RunwayFrame, x: number, z: number): number {
  const along = (x - runway.x0) * runway.dx + (z - runway.z0) * runway.dz;
  const last = runway.profile.length - 1;
  const f = Math.min(last, Math.max(0, along / RUNWAY_PROFILE_STEP_M));
  const i = Math.min(last - 1, Math.floor(f));
  const u = f - i;
  return runway.profile[i]! * (1 - u) + runway.profile[i + 1]! * u;
}
