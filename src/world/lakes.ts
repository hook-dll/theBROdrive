import { hashUnit3 } from '../core/rng';
import type { Road } from './road';

/**
 * Where the desert HAS a lake, and the bowl it stands in.
 *
 * The water itself is drawn by `render/lakewater.ts`, which reads the ground and
 * writes nothing. This module is the other half: the ground it reads. A basin is a
 * deterministic term in the terrain — dug, collided, in the tile worker and in the
 * mesh — so a lake is water standing in a real hollow rather than a sheet laid over
 * whatever the dune field happened to do.
 *
 * IT WAS TRIED THE OTHER WAY FIRST, and the other way is what the player saw: the
 * search looked for a natural closed depression, found one every third attempt, and
 * what it found was broad and two metres deep. Filled, that reads as painted sand.
 * The dune band is built from long ridges tens of metres tall; it does not produce
 * bowls, and waiting for one to appear by accident means either no lakes or flat
 * ones.
 *
 * WHY DIGGING IS SAFE HERE, when an earlier attempt at it cascaded into six
 * interlocking constraints: the basin sits 520-940 m out, past `RELIEF_FULL`, so it
 * never touches the road's graded corridor and its shape owes the road nothing. And
 * it is authored as a CLOSED bowl inside its own rim rather than as a subtraction
 * from the surrounding ground, so nothing about the surrounding dunes can make it
 * spill, tilt out, or need a plateau to carry a slope.
 *
 * The shape, outward from the centre:
 *   - a bowl `BASIN_DEPTH_M` deep, reaching the surrounding grade at `BASIN_INNER_M`;
 *   - a rim ring `BASIN_RIM_M` above that grade, which is what closes the basin: the
 *     water can only ever rise to it, whatever the desert does outside;
 *   - a blend back into the open dune field by `BASIN_OUTER_M`, long enough that the
 *     transition is a slope a car can drive rather than a wall.
 */

/** The first lake is authored, not rolled: it belongs to the opening drive. */
const HOME_LAKE_S = 1_500;
/**
 * Which side and how far out the home lake sits. The homestead is on the LEFT of
 * travel (`house.ts` SIDE = -1 with its own sign convention); the lake is on the
 * same side, far enough out that the drive to it is a decision.
 */
const HOME_LAKE_LATERAL = 620;

/** Arclength between the rare ones after it. A genuine curiosity, not a landmark. */
const MIN_GAP_M = 200_000;
const GAP_RANGE_M = 100_000;
/**
 * Lateral band for a rolled site. The near edge clears `RELIEF_FULL` (200 m,
 * terrain.ts) by a wide margin, which keeps every basin out of the road corridor and
 * keeps the whole search window "far from the road" in the tile sampler's sense.
 */
const LATERAL_MIN_M = 520;
const LATERAL_RANGE_M = 420;

/** How wrong a caller's arclength hint may be before a basin could be missed. */
const HINT_SLACK_M = 400;

const SALT_GAP = 0x1a4e;
const SALT_SIDE = 0x2b71;
const SALT_LATERAL = 0x3c92;
const SALT_SIZE = 0x4da3;

/** Bowl depth below the surrounding grade, and the radius it reaches that grade at. */
/** Mid bowl: a rolled site varies either side of these by the fractions below. */
export const BASIN_DEPTH_M = 5;
export const BASIN_INNER_M = 200;
/** How much a rolled site may differ from that middle, as a fraction. */
const SIZE_VARIATION = 0.3;
const DEPTH_VARIATION = 0.28;
/**
 * How far the lip is cut BELOW the lowest ground around the basin, and how many
 * azimuths that lowest point is looked for on.
 *
 * Small on purpose: the water stands at the lip, so this is also how far the surface
 * sits below the lowest sand around it. Enough that the sheet is never seen edge-on
 * from outside; not so much that the bowl reads as a quarry.
 */
export const LIP_DROP_M = 0.4;
const LIP_SAMPLES = 32;
/** Ring the rim crest stands on, outside the bowl, and the blend back into desert. */
const RIM_WIDTH_M = 24;
const BLEND_WIDTH_M = 200;
/** Widest a basin ever reaches from its centre: the bound every caller filters on. */
export const BASIN_OUTER_M =
  BASIN_INNER_M * (1 + SIZE_VARIATION) + RIM_WIDTH_M + BLEND_WIDTH_M;

export interface LakeSite {
  readonly index: number;
  readonly s: number;
  /** Signed lateral of the basin's centre; negative is right of travel. */
  readonly lateral: number;
  /** Radius at which the bowl reaches the surrounding grade, metres. */
  readonly radius: number;
  /** Depth of the bowl below that grade, metres. */
  readonly depth: number;
}

function smoothstep01(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

/**
 * Every lake on a road, in arclength order: the authored one at the house, then a
 * rolled site every 200-300 km. Pure in the seed, like every other schedule.
 */
export function lakeSites(seed: number, roadLength: number): readonly LakeSite[] {
  const sites: LakeSite[] = [
    {
      index: 0,
      s: HOME_LAKE_S,
      lateral: HOME_LAKE_LATERAL,
      radius: BASIN_INNER_M,
      depth: BASIN_DEPTH_M,
    },
  ];
  let s = HOME_LAKE_S + MIN_GAP_M + hashUnit3(seed, -1, SALT_GAP) * GAP_RANGE_M;
  let index = 1;
  while (s < roadLength) {
    const side = hashUnit3(seed, index, SALT_SIDE) < 0.5 ? -1 : 1;
    sites.push({
      index,
      s,
      lateral: side * (LATERAL_MIN_M + hashUnit3(seed, index, SALT_LATERAL) * LATERAL_RANGE_M),
      // No two lakes the same size: a fixed bowl reads as a stamp the third time it
      // is met, and the shoreline noise alone does not hide a repeated diameter.
      radius: BASIN_INNER_M * (1 + (hashUnit3(seed, index, SALT_SIZE) - 0.5) * 2 * SIZE_VARIATION),
      depth: BASIN_DEPTH_M * (1 + (hashUnit3(seed, index, SALT_SIZE + 1) - 0.5) * 2 * DEPTH_VARIATION),
    });
    s += MIN_GAP_M + hashUnit3(seed, index, SALT_GAP) * GAP_RANGE_M;
    index++;
  }
  return sites;
}

/** A site with its centre resolved into world XZ. Resolving costs one road sample. */
interface PlacedSite extends LakeSite {
  readonly x: number;
  readonly z: number;
}

/**
 * The basins of one road, as a term the terrain can add.
 *
 * Sites are looked up by ARCLENGTH, not by position: every caller already knows an
 * arclength near the sample it is asking about (its projection, its tile's nearest
 * road branch, or — for the water's own search — the site it is searching). Lakes are
 * 200 km apart, so the lookup is a binary search that almost always returns nothing,
 * and the road sample that resolves a centre into world XZ is paid once per site.
 */
export class LakeBasins {
  private readonly sites: readonly LakeSite[];
  private readonly placed = new Map<number, PlacedSite>();

  constructor(
    private readonly road: Road,
    seed: number,
  ) {
    this.sites = lakeSites(seed, road.length);
  }

  get schedule(): readonly LakeSite[] {
    return this.sites;
  }

  /** The scheduled site nearest an arclength, or null on an empty road. */
  nearest(s: number): LakeSite | null {
    const sites = this.sites;
    if (sites.length === 0) return null;
    let lo = 0;
    let hi = sites.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (sites[mid]!.s <= s) lo = mid + 1;
      else hi = mid;
    }
    const before = sites[lo - 1] ?? null;
    const after = sites[lo] ?? null;
    if (before === null) return after;
    if (after === null) return before;
    return s - before.s <= after.s - s ? before : after;
  }

  /**
   * The dug height at a point, given the open-desert height there and an arclength
   * near it. Returns `open` untouched — the overwhelmingly common case — when no
   * basin reaches the point.
   */
  shape(x: number, z: number, open: number, hintS: number): number {
    const site = this.nearest(hintS);
    if (site === null) return open;
    // A basin reaches `BASIN_OUTER_M` from its centre, and the caller's arclength is
    // only APPROXIMATE — a tile passes the nearest road branch to its middle. The
    // margin is the slack that makes a crude hint safe.
    if (Math.abs(site.s - hintS) > BASIN_OUTER_M + HINT_SLACK_M) return open;
    const placed = this.place(site);
    const r = Math.hypot(x - placed.x, z - placed.z);

    const inner = site.radius;
    const rimAt = inner + RIM_WIDTH_M;
    const outer = rimAt + BLEND_WIDTH_M;
    if (r >= outer) return open;

    // THE LIP IS SET BY THE LOWEST GROUND AROUND THE BASIN, NOT BY THE CENTRE.
    //
    // Cutting a bowl relative to the height at the middle of the site was the first
    // attempt, and on a dune slope it built a water tower: the desert 300 m away is
    // metres lower than the middle, so the water stood above the ground the player
    // walked in on. Taking the MINIMUM of the surrounding ring and dropping a little
    // below it makes the lip lower than every point around it, which does two things
    // at once — the surface can never be seen from below, and the basin is CLOSED, so
    // the flood in `render/lakewater.ts` fills it to that lip and no further.
    const lip = this.lipAt(placed);
    const floor = lip - site.depth;
    const bowl = 1 - smoothstep01(r / inner);
    const target = r <= inner ? floor + (lip - floor) * (1 - bowl) : lip;
    const blend = 1 - smoothstep01((r - rimAt) / BLEND_WIDTH_M);
    return open + (target - open) * blend;
  }

  /** The basin's lip: the lowest surrounding ground, less `LIP_DROP_M`. */
  private lipAt(placed: PlacedSite): number {
    return this.lips.get(placed.index) ?? 0;
  }

  private readonly lips = new Map<number, number>();

  /**
   * Resolves a site's centre once. `gradeReader` is supplied by `Terrain`, which owns
   * the open-desert height function this basin is cut into; asking the terrain for it
   * from inside the terrain's own height call would recurse.
   */
  private place(site: LakeSite): PlacedSite {
    const hit = this.placed.get(site.index);
    if (hit) return hit;
    const point = this.road.offsetPoint(site.s, site.lateral);
    const placed: PlacedSite = { ...site, x: point.x, z: point.z };
    this.placed.set(site.index, placed);
    const reader = this.gradeReader;
    let lowest = Number.POSITIVE_INFINITY;
    if (reader) {
      const ring = site.radius + RIM_WIDTH_M;
      for (let i = 0; i < LIP_SAMPLES; i++) {
        const angle = (i / LIP_SAMPLES) * Math.PI * 2;
        const height = reader(point.x + Math.cos(angle) * ring, point.z + Math.sin(angle) * ring);
        if (height < lowest) lowest = height;
      }
    }
    this.lips.set(site.index, (Number.isFinite(lowest) ? lowest : 0) - LIP_DROP_M);
    return placed;
  }

  private gradeReader: ((x: number, z: number) => number) | null = null;

  /**
   * Hands over the open-desert height function. Called once by `Terrain` after its
   * own fields exist; the basins cannot be shaped before it is set, and nothing asks
   * them to be.
   */
  setGradeReader(reader: (x: number, z: number) => number): void {
    this.gradeReader = reader;
  }
}
