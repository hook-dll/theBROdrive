/**
 * The gate sequences of kinds 12 (sand route) and 13 (desert slalom).
 *
 * A GATE IS A SEGMENT ACROSS THE PATH: a pair of posts the car is meant to pass
 * between. Its layout is a pure function of the offer seed, the source courier's
 * arclength and the road and terrain fields, so a sequence rebuilds identically after
 * a chunk streams out or a save is reloaded. Nothing about a gate is saved — only how
 * many have been passed (`ContractProgress.gatesPassed`), and the count, which comes
 * back from the same seed.
 *
 * CROSSING IS GEOMETRIC, not a Rapier sensor. The carrying car's absolute position is
 * projected onto the gate's own frame each tick, and the gate counts as passed when
 * the segment walked since the previous tick crosses the gate plane in the direction
 * of travel, within the post spacing. Only the NEXT expected gate is armed, which is
 * what makes the order a requirement rather than a coincidence: a gate crossed out of
 * turn is simply not the one being asked for, and the sequence can be recovered by
 * driving back to the one that is.
 *
 * The road's sign convention (see `DriveRoad.offsetPoint`) is the one used here:
 * forward is (sin h, cos h), positive lateral is LEFT of travel.
 */

import { hash01 } from '../core/rng';
import { SurfaceType } from '../core/surfaces';
import type { Road } from '../world/road';
import type { Terrain } from '../world/terrain';

/** One gate: a segment across the path, on the road frame at an arclength. */
export interface ContractGate {
  /** Arclength of the gate centre, metres. */
  readonly s: number;
  /** Signed lateral of the centre, metres; positive is LEFT of travel. */
  readonly lateral: number;
  /** Absolute centre XZ, at ground level. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Road heading at `s`: forward is (sin h, cos h), lateral (cos h, -sin h). */
  readonly heading: number;
  /** Half the post spacing, metres: the car crosses within +/- this of the centre. */
  readonly halfWidth: number;
}

// ---------------------------------------------------------------------------
// Sand route (kind 12): 4–6 wide gates on the sand, off the road.

/** 'SGC1' count, 'SGS1' arclength, 'SGL1' lateral, 'SHD1' side. */
const SAND_COUNT_DOMAIN = 0x53474331;
const SAND_S_DOMAIN = 0x53475331;
const SAND_LAT_DOMAIN = 0x53474c31;
const SAND_SIDE_DOMAIN = 0x53484431;
const SAND_GATE_MIN = 4;
const SAND_GATE_MAX = 6;
/** First gate ahead of the source courier and the spacing that follows, metres. */
const SAND_FIRST_GATE_M = 320;
const SAND_GATE_SPACING_M = 260;
/** The lateral band the gates stand in, metres from the centreline. */
const SAND_LATERAL_MIN_M = 25;
const SAND_LATERAL_RANGE_M = 35;
/** Half the post spacing: a wide gate on open sand, driven through rather than aimed at. */
const SAND_GATE_HALF_M = 3.5;
/** Where the sand side is probed: one lateral, sampled along the span. */
const SAND_PROBE_LATERAL_M = 40;
const SAND_PROBE_COUNT = 3;
/** Smallest arclength step between the drawn s and its neighbours, metres. */
const SAND_S_JITTER_M = 40;

/** How many gates a sand route has. Exported because the reward test needs the same draw. */
export function sandRouteGateCount(seed: number): number {
  return SAND_GATE_MIN + Math.floor(hash01(seed, SAND_COUNT_DOMAIN) * (SAND_GATE_MAX - SAND_GATE_MIN + 1));
}

/**
 * The gates of a sand route. Every gate stands on sand (checked with
 * `Terrain.surfaceAt`), on whichever side of the road carries it.
 */
export function sandRouteGates(
  seed: number,
  sourceS: number,
  road: Road,
  terrain: Terrain,
): ContractGate[] {
  const count = sandRouteGateCount(seed);
  const side = sandRouteSide(seed, sourceS, count, road, terrain);
  const gates: ContractGate[] = [];
  for (let i = 0; i < count; i++) {
    const s = sourceS
      + SAND_FIRST_GATE_M
      + i * SAND_GATE_SPACING_M
      + (hash01(seed, SAND_S_DOMAIN, i) - 0.5) * SAND_S_JITTER_M;
    const drawn = side * (SAND_LATERAL_MIN_M + hash01(seed, SAND_LAT_DOMAIN, i) * SAND_LATERAL_RANGE_M);
    gates.push(makeGate(s, nudgeToSand(s, drawn, side, road, terrain), SAND_GATE_HALF_M, road, terrain));
  }
  return gates;
}

/** Which side of the road the sand lies on, sampled over the whole span. */
function sandRouteSide(
  seed: number,
  sourceS: number,
  count: number,
  road: Road,
  terrain: Terrain,
): 1 | -1 {
  let score = 0;
  const span = SAND_FIRST_GATE_M + (count - 1) * SAND_GATE_SPACING_M;
  for (let i = 0; i < SAND_PROBE_COUNT; i++) {
    const s = sourceS + (span * i) / (SAND_PROBE_COUNT - 1);
    const left = road.offsetPoint(s, SAND_PROBE_LATERAL_M);
    const right = road.offsetPoint(s, -SAND_PROBE_LATERAL_M);
    if (terrain.surfaceAt(left.x, left.z, s) === SurfaceType.Sand) score++;
    if (terrain.surfaceAt(right.x, right.z, s) === SurfaceType.Sand) score--;
  }
  if (score > 0) return 1;
  if (score < 0) return -1;
  return hash01(seed, SAND_SIDE_DOMAIN) < 0.5 ? -1 : 1;
}

/**
 * The drawn lateral, or the nearest sand to it. The desert is sand almost everywhere
 * off the road, so the mirrored and stepped candidates exist only for an outcrop the
 * draw happened to land on; every candidate is a fixed test, so the result is as
 * deterministic as the draw.
 */
function nudgeToSand(
  s: number,
  drawn: number,
  side: 1 | -1,
  road: Road,
  terrain: Terrain,
): number {
  const candidates = [
    drawn,
    -drawn,
    side * (SAND_LATERAL_MIN_M + 6),
    side * (SAND_LATERAL_MIN_M + 16),
    side * (SAND_LATERAL_MIN_M + 26),
    side * (SAND_LATERAL_MIN_M + 34),
  ];
  for (const lateral of candidates) {
    const p = road.offsetPoint(s, lateral);
    if (terrain.surfaceAt(p.x, p.z, s) === SurfaceType.Sand) return lateral;
  }
  return drawn;
}

// ---------------------------------------------------------------------------
// Desert slalom (kind 13): 6–8 gates close to the road, alternating sides.

/** 'SLC1' count, 'SLS1' arclength, 'SLT1' time limit. */
const SLALOM_COUNT_DOMAIN = 0x534c4331;
const SLALOM_TIME_DOMAIN = 0x534c5431;
const SLALOM_GATE_MIN = 6;
const SLALOM_GATE_MAX = 8;
/** First gate ahead of the source courier, and the spacing between gates, metres. */
const SLALOM_FIRST_GATE_M = 140;
const SLALOM_GATE_SPACING_M = 9;
/** The gate centre sits half the asphalt width out; a narrow road keeps a floor. */
const SLALOM_EDGE_MIN_M = 3;
/** The seeded section limit, seconds: generous enough to back up and retake a gate. */
const SLALOM_TIME_MIN_S = 18;
const SLALOM_TIME_RANGE_S = 14;

/** How many gates a slalom has. Exported because the reward test needs the same draw. */
export function slalomGateCount(seed: number): number {
  return SLALOM_GATE_MIN + Math.floor(hash01(seed, SLALOM_COUNT_DOMAIN) * (SLALOM_GATE_MAX - SLALOM_GATE_MIN + 1));
}

/** The slalom's own time limit, seconds. */
export function slalomTimeLimitS(seed: number): number {
  return SLALOM_TIME_MIN_S + hash01(seed, SLALOM_TIME_DOMAIN) * SLALOM_TIME_RANGE_S;
}

/**
 * The gates of a slalom: each is centred half the asphalt width to one side, so its
 * near post stands at the crown and its far post on the verge, and the sides
 * alternate. The car enters from the asphalt and weaves across it to pass them.
 */
export function slalomGates(
  seed: number,
  sourceS: number,
  road: Road,
  terrain: Terrain,
): ContractGate[] {
  const count = slalomGateCount(seed);
  const gates: ContractGate[] = [];
  for (let i = 0; i < count; i++) {
    const s = sourceS + SLALOM_FIRST_GATE_M + i * SLALOM_GATE_SPACING_M;
    const edge = Math.max(SLALOM_EDGE_MIN_M, road.halfWidthAt(s));
    const lateral = (i % 2 === 0 ? 1 : -1) * edge;
    gates.push(makeGate(s, lateral, edge, road, terrain));
  }
  return gates;
}

function makeGate(
  s: number,
  lateral: number,
  halfWidth: number,
  road: Road,
  terrain: Terrain,
): ContractGate {
  const centre = road.sampleAt(s);
  const p = road.offsetPoint(s, lateral);
  return {
    s,
    lateral,
    x: p.x,
    y: terrain.heightAt(p.x, p.z, s),
    z: p.z,
    heading: centre.heading,
    halfWidth,
  };
}

// ---------------------------------------------------------------------------
// Crossing.

/**
 * Largest distance between two ticks that is a drive rather than a rescue, a teleport
 * or a reload, metres. At 40 m/s and a 60 Hz physics step a real step is under 0.7 m;
 * 15 m cannot be reached by a car and so only ever rejects a discontinuity.
 */
const MAX_STEP_M = 15;

/**
 * Whether the straight path from `prev` to `cur` crosses this gate's plane in the
 * direction of travel, between its posts. Position is absolute XZ (the road frame is
 * absolute; only Rapier and the scene are relative to the floating origin).
 */
export function gateCrossed(
  gate: ContractGate,
  prevX: number,
  prevZ: number,
  x: number,
  z: number,
): boolean {
  const sin = Math.sin(gate.heading);
  const cos = Math.cos(gate.heading);
  const px = prevX - gate.x;
  const pz = prevZ - gate.z;
  const cx = x - gate.x;
  const cz = z - gate.z;
  const alongPrev = px * sin + pz * cos;
  const alongCur = cx * sin + cz * cos;
  // Forward along the road: before the plane last tick, at or past it now.
  if (alongPrev >= 0 || alongCur < 0) return false;
  const acrossPrev = px * cos - pz * sin;
  const acrossCur = cx * cos - cz * sin;
  const denom = alongPrev - alongCur;
  const t = denom === 0 ? 0 : alongPrev / denom;
  const acrossAt = acrossPrev + (acrossCur - acrossPrev) * t;
  return Math.abs(acrossAt) <= gate.halfWidth;
}

/**
 * The previous position per contract, so a gate can be tested against the segment the
 * car actually walked rather than a single sample. Runtime-only: after a reload the
 * first tick merely seeds it, which is why a teleport cannot bank a gate.
 */
const lastPosition = new Map<string, { x: number; z: number }>();

/**
 * Advances a sequence by at most one gate and returns the new passed count. Only the
 * next expected gate is tested, so gates must be crossed in order and a skipped one
 * waits where it is until the car comes back.
 */
export function gateSequenceStep(
  itemId: string,
  gates: readonly ContractGate[],
  passed: number,
  x: number,
  z: number,
): number {
  const previous = lastPosition.get(itemId);
  lastPosition.set(itemId, { x, z });
  if (passed >= gates.length) {
    lastPosition.delete(itemId);
    return passed;
  }
  if (previous === undefined) return passed;
  const dx = x - previous.x;
  const dz = z - previous.z;
  if (dx * dx + dz * dz > MAX_STEP_M * MAX_STEP_M) return passed;
  return gateCrossed(gates[passed]!, previous.x, previous.z, x, z) ? passed + 1 : passed;
}
