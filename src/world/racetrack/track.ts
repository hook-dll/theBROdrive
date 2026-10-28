import { SurfaceType } from '../../core/surfaces';
import type { RoadConditionBuffer } from '../gradient';
import type { DriveRoad, RoadProjection, RoadSample } from '../road';
import { laneOffsetFor } from '../roadprofile';
import type { TrackPieceKind, TrackSector, TrackSurfaceKind } from './layout';

/**
 * A RACE TRACK beside a post: the data contract the races are run on.
 *
 * Built by `site.ts` (where the loop stands, and its heights) from a loop out of
 * `layout.ts` (its shape), and owned per `Terrain` (`terrain.raceTracks.track(post)`),
 * because the ground under it is fitted to it and the two must come from one object.
 * Everything is in ABSOLUTE world coordinates; subtract the floating origin before
 * anything is written to f32 or handed to Rapier, as every chunk provider does.
 *
 * THE LAP'S ARCLENGTH starts at the finish line: `finishS` is 0, `s` runs in the
 * driving direction to `lengthM` and wraps. Every per-`s` reader wraps, so `s + 30` past
 * the line is simply the start of the next lap.
 *
 *   id            'track:<postIndex>'
 *   postIndex     the post stop (world/poststops.ts) whose settlement it stands beside
 *   lengthM       one lap, metres (0.9-1.7 km)
 *   sampleAt(s)   { s, x, y, z, heading, curvature, bank, grade, surface, halfWidth }
 *                 `bank` is the cross-slope (road convention: y = centre - bank * lateral,
 *                 lateral positive LEFT), `surface` the tyre SurfaceType of that sector
 *   surfaceY(s,l) the drawn and collided surface height at a lateral offset
 *   startGrid     `GRID_SLOTS` staggered poses in rows of two, the front row
 *                 `GRID_BEHIND_M` behind the line, facing the lap
 *   finishS       0
 *   checkpoints   arclengths a lap must pass in order before the line counts (part B)
 *   road          a `DriveRoad` (world/road.ts) the existing `Autopilot` drives as is
 *   accessLane    world XZ polyline from the lay-by's outer edge to the paddock gate
 *   paddock       the paved apron beside the start straight, in the lap's frame
 *   sectors       surface runs in lap order; `corners` the pieces the lap was built of
 *
 * The table is one row per metre (`lengthM / count`), linear between rows; heading is
 * interpolated the short way round, curvature and surface are the row's own.
 */

/** One point of the lap. Written into caller storage by `sampleAt` when given. */
export interface TrackSample {
  s: number;
  x: number;
  y: number;
  z: number;
  /** Tangent in XZ, radians; forward is (sin h, cos h), as the road's. */
  heading: number;
  /** Signed, 1/m; positive turns LEFT (toward positive lateral). */
  curvature: number;
  /** Cross-slope, fraction; same sign as curvature when banked into the bend. */
  bank: number;
  /** Rise over run along the lap. */
  grade: number;
  surface: SurfaceType;
  halfWidth: number;
}

/** A standing car: absolute world position of the contact plane's middle, and heading. */
export interface TrackPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly heading: number;
  /** Lap arclength and lateral of the pose (lateral positive LEFT). */
  readonly s: number;
  readonly lateral: number;
}

/** A projection's answer in caller storage: `RaceTrack.project`'s `out`. */
export interface TrackProjection {
  s: number;
  lateral: number;
  height: number;
}

/**
 * The paved apron beside the start straight, in the lap's own frame: from `s0` to `s1`
 * along the lap, and from `inner` to `outer` metres out on side `side` (signed lateral
 * sign; it is always the OUTSIDE of the loop, toward the road). Level across, at the
 * start straight's centreline height along.
 */
export interface TrackPaddock {
  readonly s0: number;
  readonly s1: number;
  readonly inner: number;
  readonly outer: number;
  readonly side: 1 | -1;
}

/** One of the pieces the lap was built from, re-based to the finish line. */
export interface TrackCorner {
  readonly kind: TrackPieceKind;
  readonly startS: number;
  readonly length: number;
  /** Design radius, metres (signed: positive left); Infinity on a straight. */
  readonly radius: number;
  /** Design cross-slope, signed as `TrackSample.bank`. */
  readonly bank: number;
}

/** A point of the access lane, absolute world XZ. */
export interface LanePoint {
  readonly x: number;
  readonly z: number;
}

/** Figures for the bench and for whoever wants to describe a track. */
export interface TrackStats {
  readonly minRadiusM: number;
  /** Steepest banking into a bend, and the worst off-camber (both positive fractions). */
  readonly maxBank: number;
  readonly maxOffCamber: number;
  readonly maxGrade: number;
  /** Total climb over one lap, and the lap's highest point over its lowest, metres. */
  readonly climbM: number;
  readonly elevationM: number;
  /** Share of the lap on each surface kind, 0..1. */
  readonly surfaceShare: Readonly<Record<TrackSurfaceKind, number>>;
  readonly corners: Readonly<Partial<Record<TrackPieceKind, number>>>;
}

export interface RaceTrackInit {
  readonly postIndex: number;
  readonly postS: number;
  readonly chunkS: number;
  readonly side: 1 | -1;
  readonly halfWidth: number;
  readonly runoffM: number;
  readonly xs: Float64Array;
  readonly zs: Float64Array;
  readonly ys: Float64Array;
  readonly headings: Float64Array;
  readonly curvatures: Float64Array;
  readonly banks: Float64Array;
  readonly surfaces: Uint8Array;
  readonly sectors: readonly TrackSector[];
  readonly corners: readonly TrackCorner[];
  readonly paddock: TrackPaddock;
  readonly accessLane: readonly LanePoint[];
  readonly laneHalfWidth: number;
  readonly turn: 1 | -1;
}

/** How far behind the finish line the grid's front row stands, metres. */
export const GRID_BEHIND_M = 14;
/**
 * THE GRID: `GRID_SLOTS` boxes in rows of two, `GRID_ROW_M` apart, the left box of each
 * row `GRID_STAGGER_M` behind the right one, as a staggered start is laid. Slot 0 is pole
 * (front row, right of the crown), slot 1 beside and behind it, and so on back.
 */
export const GRID_SLOTS = 6;
const GRID_ROW_M = 9;
const GRID_STAGGER_M = 4.5;
/** The slots' laterals, as a share of the half width either side of the crown. */
const GRID_LATERAL_SHARE = 0.48;
/** Checkpoints a lap must pass in order, evenly round it (the line itself is not one). */
const CHECKPOINT_COUNT = 6;
/** Window either side of a hint a hinted projection searches, metres. */
const PROJECT_WINDOW_M = 60;

export class RaceTrack {
  readonly id: string;
  readonly postIndex: number;
  /** Arclength of the post on the world road, and the lay-by's side (signed lateral sign). */
  readonly postS: number;
  readonly side: 1 | -1;
  /**
   * Road arclength whose chunk builds and frees the track (world/racetrack/mesh.ts): the
   * mean of its centreline's, every stretch of it within `CHUNK_SPREAD_M` (site.ts).
   */
  readonly chunkS: number;
  readonly lengthM: number;
  /** Asphalt half width, metres: two cars side by side with room to spare. */
  readonly halfWidth: number;
  /** Graded sand beyond each edge before the ground leaves the track's plane, metres. */
  readonly runoffM: number;
  readonly finishS = 0;
  /** `GRID_SLOTS` poses, pole first; see `GRID_SLOTS`. */
  readonly startGrid: readonly TrackPose[];
  readonly checkpoints: readonly number[];
  readonly sectors: readonly TrackSector[];
  readonly corners: readonly TrackCorner[];
  readonly paddock: TrackPaddock;
  readonly accessLane: readonly LanePoint[];
  readonly laneHalfWidth: number;
  /** +1 when the lap turns left overall: the infield is on the positive-lateral side. */
  readonly turn: 1 | -1;
  readonly road: RaceTrackRoad;
  readonly stats: TrackStats;

  private readonly xs: Float64Array;
  private readonly zs: Float64Array;
  private readonly ys: Float64Array;
  private readonly headings: Float64Array;
  private readonly curvatures: Float64Array;
  private readonly banks: Float64Array;
  private readonly surfaces: Uint8Array;
  private readonly count: number;
  private readonly step: number;

  constructor(init: RaceTrackInit) {
    this.id = `track:${init.postIndex}`;
    this.postIndex = init.postIndex;
    this.postS = init.postS;
    this.chunkS = init.chunkS;
    this.side = init.side;
    this.halfWidth = init.halfWidth;
    this.runoffM = init.runoffM;
    this.xs = init.xs;
    this.zs = init.zs;
    this.ys = init.ys;
    this.headings = init.headings;
    this.curvatures = init.curvatures;
    this.banks = init.banks;
    this.surfaces = init.surfaces;
    this.count = init.xs.length;
    this.sectors = init.sectors;
    this.corners = init.corners;
    this.paddock = init.paddock;
    this.accessLane = init.accessLane;
    this.laneHalfWidth = init.laneHalfWidth;
    this.turn = init.turn;
    this.lengthM = init.sectors[init.sectors.length - 1]!.endS;
    this.step = this.lengthM / this.count;

    const pose = (behind: number, lateral: number): TrackPose => {
      const gridS = this.wrap(-behind);
      const at = this.sampleAt(gridS);
      return {
        x: at.x + Math.cos(at.heading) * lateral,
        y: this.surfaceY(gridS, lateral),
        z: at.z - Math.sin(at.heading) * lateral,
        heading: at.heading,
        s: gridS,
        lateral,
      };
    };
    // Even slots on the right of the crown, as a driver on this road keeps right.
    const gridLateral = this.halfWidth * GRID_LATERAL_SHARE;
    this.startGrid = Array.from({ length: GRID_SLOTS }, (_, k) => {
      const row = Math.floor(k / 2);
      const left = k % 2 === 1;
      return pose(GRID_BEHIND_M + row * GRID_ROW_M + (left ? GRID_STAGGER_M : 0), left ? gridLateral : -gridLateral);
    });
    this.checkpoints = Array.from({ length: CHECKPOINT_COUNT }, (_, i) => ((i + 1) * this.lengthM) / (CHECKPOINT_COUNT + 1));
    this.road = new RaceTrackRoad(this);
    this.stats = this.measure();
  }

  /** Arclength wrapped into one lap. */
  wrap(s: number): number {
    const lap = this.lengthM;
    return ((s % lap) + lap) % lap;
  }

  /** The lap at arclength `s` (wrapped), into `out` when given. */
  sampleAt(s: number, out?: TrackSample): TrackSample {
    const wrapped = this.wrap(s);
    const fi = wrapped / this.step;
    const i = Math.floor(fi) % this.count;
    const j = (i + 1) % this.count;
    const t = fi - Math.floor(fi);
    let dh = this.headings[j]! - this.headings[i]!;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    const target = out ?? ({} as TrackSample);
    target.s = wrapped;
    target.x = this.xs[i]! + (this.xs[j]! - this.xs[i]!) * t;
    target.y = this.ys[i]! + (this.ys[j]! - this.ys[i]!) * t;
    target.z = this.zs[i]! + (this.zs[j]! - this.zs[i]!) * t;
    target.heading = this.headings[i]! + dh * t;
    target.curvature = this.curvatures[i]!;
    target.bank = this.banks[i]! + (this.banks[j]! - this.banks[i]!) * t;
    target.grade = (this.ys[j]! - this.ys[i]!) / this.step;
    target.surface = this.surfaces[i]! as SurfaceType;
    target.halfWidth = this.halfWidth;
    return target;
  }

  /** Centreline height at `s`, metres. */
  centreY(s: number): number {
    const fi = this.wrap(s) / this.step;
    const i = Math.floor(fi) % this.count;
    const t = fi - Math.floor(fi);
    return this.ys[i]! + (this.ys[(i + 1) % this.count]! - this.ys[i]!) * t;
  }

  /** Cross-slope at `s`. */
  bankAt(s: number): number {
    const fi = this.wrap(s) / this.step;
    const i = Math.floor(fi) % this.count;
    const t = fi - Math.floor(fi);
    return this.banks[i]! + (this.banks[(i + 1) % this.count]! - this.banks[i]!) * t;
  }

  /** Tyre surface of the sector at `s`. */
  surfaceAt(s: number): SurfaceType {
    return this.surfaces[Math.floor(this.wrap(s) / this.step) % this.count]! as SurfaceType;
  }

  /**
   * Height of the track's plane at `s` and `lateral`: the centreline less the banking's
   * fall across. The ribbon, its collider and the levelled ground under it all read this.
   */
  surfaceY(s: number, lateral: number): number {
    return this.centreY(s) - this.bankAt(s) * lateral;
  }

  /** A point `lateral` metres LEFT of the centreline at `s`, at the centreline's height. */
  offsetPoint(s: number, lateral: number, out?: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    const fi = this.wrap(s) / this.step;
    const i = Math.floor(fi) % this.count;
    const j = (i + 1) % this.count;
    const t = fi - Math.floor(fi);
    let dh = this.headings[j]! - this.headings[i]!;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    const heading = this.headings[i]! + dh * t;
    const target = out ?? { x: 0, y: 0, z: 0 };
    target.x = this.xs[i]! + (this.xs[j]! - this.xs[i]!) * t + Math.cos(heading) * lateral;
    target.y = this.ys[i]! + (this.ys[j]! - this.ys[i]!) * t;
    target.z = this.zs[i]! + (this.zs[j]! - this.zs[i]!) * t - Math.sin(heading) * lateral;
    return target;
  }

  /**
   * Closest centreline point to a world XZ, lateral positive LEFT, as the road's. With a
   * hint it searches `PROJECT_WINDOW_M` either side of it, which keeps the answer on the
   * right leg of a hairpin; without one it scans the whole table (a few thousand rows).
   * Written into `out` when given, so a per-step caller (race/laps.ts) allocates nothing.
   */
  project(x: number, z: number, hintS?: number, out?: TrackProjection): RoadProjection {
    let best = 0;
    let bestDist = Infinity;
    let from = 0;
    let rows = this.count;
    if (hintS !== undefined) {
      const window = Math.ceil(PROJECT_WINDOW_M / this.step);
      from = Math.round(this.wrap(hintS) / this.step) - window;
      rows = 2 * window + 1;
    }
    for (let k = 0; k < rows; k++) {
      const i = (((from + k) % this.count) + this.count) % this.count;
      const d = (this.xs[i]! - x) ** 2 + (this.zs[i]! - z) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    let bestS = best * this.step;
    let bestLateral = 0;
    let refined = Infinity;
    for (let offset = -1; offset <= 0; offset++) {
      const i = (((best + offset) % this.count) + this.count) % this.count;
      const j = (i + 1) % this.count;
      const ax = this.xs[i]!;
      const az = this.zs[i]!;
      const dx = this.xs[j]! - ax;
      const dz = this.zs[j]! - az;
      const lengthSq = dx * dx + dz * dz;
      if (lengthSq <= 0) continue;
      const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / lengthSq));
      const px = ax + dx * t;
      const pz = az + dz * t;
      const d = (px - x) ** 2 + (pz - z) ** 2;
      if (d >= refined) continue;
      refined = d;
      bestS = this.wrap((i + t) * this.step);
      const heading = this.headings[i]!;
      bestLateral = (x - px) * Math.cos(heading) - (z - pz) * Math.sin(heading);
    }
    if (!out) return { s: bestS, lateral: bestLateral, height: this.centreY(bestS) };
    out.s = bestS;
    out.lateral = bestLateral;
    out.height = this.centreY(bestS);
    return out;
  }

  private measure(): TrackStats {
    let minRadius = Infinity;
    let maxBank = 0;
    let maxOffCamber = 0;
    let maxGrade = 0;
    let climb = 0;
    for (let i = 0; i < this.count; i++) {
      const k = this.curvatures[i]!;
      if (Math.abs(k) > 1e-9) minRadius = Math.min(minRadius, 1 / Math.abs(k));
      const bank = this.banks[i]!;
      // Into the bend when the bank has the curvature's sign; a straight's bank is a ramp.
      if (Math.abs(k) > 1 / 400 && Math.sign(bank) !== Math.sign(k)) maxOffCamber = Math.max(maxOffCamber, Math.abs(bank));
      else maxBank = Math.max(maxBank, Math.abs(bank));
      const rise = this.ys[(i + 1) % this.count]! - this.ys[i]!;
      maxGrade = Math.max(maxGrade, Math.abs(rise) / this.step);
      if (rise > 0) climb += rise;
    }
    const share: Record<TrackSurfaceKind, number> = { asphalt: 0, gravel: 0, dirt: 0 };
    for (const sector of this.sectors) share[sector.kind] += (sector.endS - sector.startS) / this.lengthM;
    const corners: Partial<Record<TrackPieceKind, number>> = {};
    for (const corner of this.corners) {
      if (corner.kind === 'straight') continue;
      corners[corner.kind] = (corners[corner.kind] ?? 0) + 1;
    }
    // A chicane or esses is four arcs: count the feature, not its arcs.
    if (corners.chicane) corners.chicane /= 4;
    if (corners.esses) corners.esses /= 4;
    let low = Infinity;
    let high = -Infinity;
    for (let i = 0; i < this.count; i++) {
      low = Math.min(low, this.ys[i]!);
      high = Math.max(high, this.ys[i]!);
    }
    return { minRadiusM: minRadius, maxBank, maxOffCamber, maxGrade, climbM: climb, elevationM: high - low, surfaceShare: share, corners };
  }
}

/**
 * THE LAP AS A ROAD, for the `Autopilot` (vehicle/autopilot.ts), which drives anything
 * that answers `DriveRoad`. Structural, not a `Road` subclass: the driver is typed
 * against the interface, so nothing of the world road's spine is touched or built.
 *
 * One lane each way at the track's own half width, the driver's lane right of the
 * crown (`laneCentreAt`), passing on the left as on the road. The lap has no wear, no
 * drifted sand and painted edges, so `conditionAt` is the sector's surface and nothing
 * else. `length` is the lap: every reader wraps, so a lookahead past the line reads the
 * next lap rather than the end of a road.
 */
export class RaceTrackRoad implements DriveRoad {
  readonly length: number;
  private readonly scratch = {} as TrackSample;

  constructor(private readonly track: RaceTrack) {
    this.length = track.lengthM;
  }

  conditionAt(s: number, out: RoadConditionBuffer): void {
    out.surface = this.track.surfaceAt(s);
    out.decay = 0;
    out.sandCover = 0;
    out.markings = 1;
  }

  sampleAt(s: number): RoadSample {
    const at = this.track.sampleAt(s, this.scratch);
    return { s: at.s, x: at.x, y: at.y, z: at.z, heading: at.heading, grade: at.grade, curvature: at.curvature };
  }

  headingAt(s: number): number {
    return this.track.sampleAt(s, this.scratch).heading;
  }

  curvatureAt(s: number): number {
    return this.track.sampleAt(s, this.scratch).curvature;
  }

  bankingAt(s: number): number {
    return this.track.bankAt(s);
  }

  /** As `Road.sightDistanceAt`, on the lap's own profile, which wraps instead of ending. */
  sightDistanceAt(s: number, limit: number, direction: 1 | -1 = 1): number {
    const eyeY = this.track.centreY(s) + 1.08;
    const step = Math.max(10, limit / 15);
    let worstSlope = -Infinity;
    for (let d = step; d <= limit; d += step) {
      const groundY = this.track.centreY(s + direction * d);
      if ((groundY + 0.6 - eyeY) / d < worstSlope) return d - step;
      const ridgeSlope = (groundY - eyeY) / d;
      if (ridgeSlope > worstSlope) worstSlope = ridgeSlope;
    }
    return limit;
  }

  project(x: number, z: number, hintS?: number): RoadProjection {
    return this.track.project(x, z, hintS);
  }

  offsetPoint(s: number, lateral: number, out?: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    return this.track.offsetPoint(s, lateral, out);
  }

  halfWidthAt(): number {
    return this.track.halfWidth;
  }

  lanesPerSideAt(): number {
    return 1;
  }

  laneCentreAt(_s: number, lane: number): number {
    return -laneOffsetFor(this.track.halfWidth, lane);
  }
}
