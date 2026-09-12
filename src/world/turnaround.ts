import type { RoadConditionBuffer } from './gradient';
import type { DriveRoad, RoadProjection, RoadSample } from './road';
import { TERMINUS_CENTRE_M, TERMINUS_HOOK_M, TERMINUS_LOOP_M } from './terminus';

/**
 * The line a car drives to turn round at the road's start, as a `DriveRoad`.
 *
 * The ordinary `Autopilot` needs nothing but a road: something it can project onto,
 * sample ahead of itself, and read a curvature from. `ReversedRoad` is already one such
 * view of the world road; this is another, and it is the only piece of geometry in the
 * game that is not a function of the road's arclength.
 *
 * THE LINE, outward from the mouth of the bulb (`world/terminus.ts` owns the paving):
 *
 *   1. the oncoming lane itself, straight, down to the bulb's mouth;
 *   2. a `TERMINUS_HOOK_M` arc AWAY from the bulb's centre - the car swings wide, as a
 *      driver does, which is what buys the room for the loop to be gentle;
 *   3. `TERMINUS_LOOP_M` around the bulb, the long way, 308 degrees of it;
 *   4. the mirror of the hook, onto the outgoing lane;
 *   5. the outgoing lane, straight, back out to the road.
 *
 * The hook is tangent to BOTH the lane and the loop, and tangent EXTERNALLY to the loop
 * so the two turn opposite ways: hook right, loop left, hook right, which nets the
 * 180 degrees a U-turn owes. Tangency everywhere means heading is continuous the whole
 * way round and the controller never meets a corner - only a step in curvature at each
 * join, which is what an unspiralled road junction gives it anyway.
 *
 * The radii are measured, not chosen: driven round analytic circles, the autopilot holds
 * 12 m to 0.93 m of lateral error and 8 m to 1.39 m. The loop is 11 m and is where the
 * car spends its time; the 6 m hooks are 64 degrees each, at the pace the loop has
 * already set.
 */

/** One straight or circular piece of the line, in the order they are driven. */
interface Leg {
  readonly kind: 'straight' | 'arc';
  /** Arclength at which this leg begins. */
  readonly s0: number;
  readonly length: number;
  /** Straight: start point and unit direction. Arc: centre. */
  readonly x: number;
  readonly z: number;
  readonly dx: number;
  readonly dz: number;
  /** Arc only: radius, start angle, and +1 for anticlockwise in the (x, z) plane. */
  readonly radius: number;
  readonly phi0: number;
  readonly sense: number;
}

/** How far back up the road the turnaround line reaches, metres from the road's start. */
export const TURNAROUND_ENTRY_S = 60;

/** Lateral room either side of the line while it is out on the paving. */
const PAD_HALF_WIDTH = 4;

function arcLeg(
  s0: number,
  centreX: number,
  centreZ: number,
  radius: number,
  phi0: number,
  sweep: number,
  sense: number,
): Leg {
  return {
    kind: 'arc',
    s0,
    length: Math.abs(sweep) * radius,
    x: centreX,
    z: centreZ,
    dx: 0,
    dz: 0,
    radius,
    phi0,
    sense,
  };
}

export class TurnaroundRoad implements DriveRoad {
  readonly length: number;
  private readonly legs: readonly Leg[];
  /** Arclength at which the car is back in the outgoing lane and can be handed over. */
  readonly exitS: number;
  /** Arclength at which the line leaves the road's own lane. */
  readonly mouthS: number;

  constructor(
    private readonly road: DriveRoad,
    /**
     * Height of the paving. The pad is level to within a couple of centimetres
     * (`world/terrain.ts` makes it so), so the road's own start height is the honest
     * default and nothing but a mesh builder needs better.
     */
    private readonly groundY: (x: number, z: number) => number = () => road.sampleAt(0).y,
  ) {
    const lane = Math.abs(road.laneCentreAt(0, 0));
    const centreZ = -TERMINUS_CENTRE_M;
    const loop = TERMINUS_LOOP_M;
    const hook = TERMINUS_HOOK_M;

    // The hook's centre sits on the car's right, `hook` metres off its lane, and is
    // placed along the lane by the external-tangency condition with the loop.
    const hookX = lane + hook;
    const reach = Math.sqrt((loop + hook) * (loop + hook) - hookX * hookX);
    const hookZ = centreZ + reach;
    // Where hook meets loop: along the line of centres, `loop` out from the bulb.
    const scale = loop / (loop + hook);
    const joinX = hookX * scale;
    const joinZ = centreZ + reach * scale;

    const legs: Leg[] = [];
    // 1. The oncoming lane, driven toward the road's start (-Z).
    const entryLength = TURNAROUND_ENTRY_S - hookZ;
    legs.push({
      kind: 'straight',
      s0: 0,
      length: entryLength,
      x: lane,
      z: TURNAROUND_ENTRY_S,
      dx: 0,
      dz: -1,
      radius: 0,
      phi0: 0,
      sense: 0,
    });
    // 2. The hook: anticlockwise (a right turn for a car heading -Z) from the lane to
    //    the loop.
    const hookStart = Math.atan2(0, lane - hookX); // = PI, the lane side of the centre
    const hookJoin = Math.atan2(joinZ - hookZ, joinX - hookX);
    const hookSweep = wrapCcw(hookStart, hookJoin);
    legs.push(arcLeg(entryLength, hookX, hookZ, hook, hookStart, hookSweep, 1));
    // 3. The loop: clockwise, all the way round the far side of the bulb.
    const loopStart = Math.atan2(joinZ - centreZ, joinX);
    const loopEnd = Math.atan2(joinZ - centreZ, -joinX);
    const loopSweep = wrapCw(loopStart, loopEnd);
    legs.push(arcLeg(legs[1]!.s0 + legs[1]!.length, 0, centreZ, loop, loopStart, loopSweep, -1));
    // 4. The hook out, mirrored in X: anticlockwise again, onto the outgoing lane.
    const outCentreX = -hookX;
    const outStart = Math.atan2(joinZ - hookZ, -joinX - outCentreX);
    const outEnd = Math.atan2(0, -lane - outCentreX); // = 0, the lane side of the centre
    const outSweep = wrapCcw(outStart, outEnd);
    legs.push(arcLeg(legs[2]!.s0 + legs[2]!.length, outCentreX, hookZ, hook, outStart, outSweep, 1));
    // 5. The outgoing lane, back out along +Z.
    const exit = legs[3]!.s0 + legs[3]!.length;
    legs.push({
      kind: 'straight',
      s0: exit,
      length: TURNAROUND_ENTRY_S - hookZ,
      x: -lane,
      z: hookZ,
      dx: 0,
      dz: 1,
      radius: 0,
      phi0: 0,
      sense: 0,
    });

    this.legs = legs;
    this.mouthS = entryLength;
    this.exitS = exit;
    this.length = exit + legs[4]!.length;
  }

  /** World arclength on the real road that this line's exit runs out to. */
  get exitRoadS(): number {
    return TURNAROUND_ENTRY_S;
  }

  conditionAt(_s: number, out: RoadConditionBuffer): void {
    this.road.conditionAt(0, out);
  }

  sampleAt(s: number): RoadSample {
    const leg = this.legAt(s);
    const t = s - leg.s0;
    if (leg.kind === 'straight') {
      const x = leg.x + leg.dx * t;
      const z = leg.z + leg.dz * t;
      return {
        s,
        x,
        y: this.groundY(x, z),
        z,
        heading: Math.atan2(leg.dx, leg.dz),
        grade: 0,
        curvature: 0,
      };
    }
    const phi = leg.phi0 + (leg.sense * t) / leg.radius;
    const x = leg.x + Math.cos(phi) * leg.radius;
    const z = leg.z + Math.sin(phi) * leg.radius;
    const tangentX = -leg.sense * Math.sin(phi);
    const tangentZ = leg.sense * Math.cos(phi);
    return {
      s,
      x,
      y: this.groundY(x, z),
      z,
      heading: Math.atan2(tangentX, tangentZ),
      grade: 0,
      curvature: -leg.sense / leg.radius,
    };
  }

  curvatureAt(s: number): number {
    const leg = this.legAt(s);
    return leg.kind === 'straight' ? 0 : -leg.sense / leg.radius;
  }

  /**
   * Nearest point on the line.
   *
   * The two lanes are 2.9 m apart and the loop passes within a body's width of both, so
   * a global nearest point is ambiguous exactly where a turning car is. With a hint -
   * which the autopilot always has after its first tick - only the legs within
   * `HINT_WINDOW_M` of it are considered, and the line the car is actually on wins.
   */
  project(x: number, z: number, hintS?: number): RoadProjection {
    let bestS = 0;
    let bestLateral = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const leg of this.legs) {
      if (hintS !== undefined) {
        const before = leg.s0 - hintS;
        const after = hintS - (leg.s0 + leg.length);
        if (before > HINT_WINDOW_M || after > HINT_WINDOW_M) continue;
      }
      const hit = this.projectLeg(leg, x, z);
      if (hit.distance < bestDistance) {
        bestDistance = hit.distance;
        bestS = hit.s;
        bestLateral = hit.lateral;
      }
    }
    return { s: bestS, lateral: bestLateral, height: this.groundY(x, z) };
  }

  offsetPoint(
    s: number,
    lateral: number,
    out?: { x: number; y: number; z: number },
  ): { x: number; y: number; z: number } {
    const sample = this.sampleAt(s);
    const p = out ?? { x: 0, y: 0, z: 0 };
    p.x = sample.x + Math.cos(sample.heading) * lateral;
    p.z = sample.z - Math.sin(sample.heading) * lateral;
    p.y = this.groundY(p.x, p.z);
    return p;
  }

  /**
   * Room either side. On the two tails this is the road's own asphalt; on the paving it
   * is the room the bulb gives the line, which is what stops the planner from treating
   * open tarmac as a verge to be avoided.
   */
  halfWidthAt(s: number): number {
    if (s <= this.mouthS || s >= this.exitS) return this.road.halfWidthAt(0);
    return PAD_HALF_WIDTH;
  }

  lanesPerSideAt(_s: number): number {
    return 1;
  }

  /** Single file: the line IS the lane. */
  laneCentreAt(_s: number, _lane: number): number {
    return 0;
  }

  private legAt(s: number): Leg {
    const clamped = Math.min(this.length, Math.max(0, s));
    for (let i = this.legs.length - 1; i >= 0; i--) {
      const leg = this.legs[i]!;
      if (clamped >= leg.s0) return leg;
    }
    return this.legs[0]!;
  }

  private projectLeg(
    leg: Leg,
    x: number,
    z: number,
  ): { s: number; lateral: number; distance: number } {
    if (leg.kind === 'straight') {
      const along = Math.min(leg.length, Math.max(0, (x - leg.x) * leg.dx + (z - leg.z) * leg.dz));
      const px = leg.x + leg.dx * along;
      const pz = leg.z + leg.dz * along;
      const heading = Math.atan2(leg.dx, leg.dz);
      return {
        s: leg.s0 + along,
        lateral: lateralOf(x - px, z - pz, heading),
        distance: Math.hypot(x - px, z - pz),
      };
    }
    const phi = Math.atan2(z - leg.z, x - leg.x);
    const swept = leg.sense > 0 ? wrapCcw(leg.phi0, phi) : wrapCw(leg.phi0, phi);
    const along = Math.min(leg.length, Math.max(0, swept * leg.radius));
    const sample = this.sampleAt(leg.s0 + along);
    return {
      s: leg.s0 + along,
      lateral: lateralOf(x - sample.x, z - sample.z, sample.heading),
      distance: Math.hypot(x - sample.x, z - sample.z),
    };
  }
}

/** Metres of arclength either side of the hint that a projection may consider. */
const HINT_WINDOW_M = 20;

/** Signed lateral of an offset in a frame's own terms; positive is LEFT of travel. */
function lateralOf(dx: number, dz: number, heading: number): number {
  return dx * Math.cos(heading) - dz * Math.sin(heading);
}

/** Anticlockwise sweep from one angle to another, in radians, always positive. */
function wrapCcw(from: number, to: number): number {
  let d = to - from;
  while (d < 0) d += Math.PI * 2;
  while (d >= Math.PI * 2) d -= Math.PI * 2;
  return d;
}

/** Clockwise sweep from one angle to another, in radians, always positive. */
function wrapCw(from: number, to: number): number {
  return wrapCcw(to, from);
}
