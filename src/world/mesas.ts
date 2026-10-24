import { hashUnit3 } from '../core/rng';
import { BASIN_OUTER_M } from './lakes';
import type { LandformFootprint } from './landforms';
import type { Road } from './road';
import { RoadDistance } from './roaddistance';
import { COARSE_SPACING } from './roadcurve';
import type { Terrain } from './terrain';
import { newRegionMix, regionAt } from './regions';

/**
 * THE DESERT'S MESAS: where each one stands, what shape it is, and the ground it stands
 * on. One module, read by everything that has to agree about a mesa — the vista that
 * draws it (`render/vista.ts`), the static colliders that stop a car at its wall
 * (`world/mesacolliders.ts`), the scatter, tile props and desert buildings that must not
 * stand inside it, and `tools/mesa-clearance.ts`, which proves none of them is on the
 * road. The outline the tool tests is therefore exactly the outline that is drawn and
 * collided: there is no second copy of the hash recipe to drift.
 *
 * WHY THEY USED TO DISSOLVE, AND WHY THEY NO LONGER DO. Mesas were render-only vista
 * geometry, placed on a world lattice that knew nothing about the road: a cell could
 * put a 900 m butte across the asphalt. The cure was a dissolve: any mesa the camera
 * came within a kilometre of faded out and never came back, so the driver watched the
 * landmarks melt as they approached them. Here the placement knows the road instead. A
 * site whose footprint comes within `MESA_ROAD_CLEARANCE_M` of ANY pass of the road, or
 * overlaps a roadside landform or a lake basin, is rejected; it is retried at a few
 * other spots in its own cell first, so a mesa beside the road is a thing the drive
 * still has. What survives is solid, and stays.
 *
 * Everything is a pure function of the seed and the road. Each cell is resolved the
 * same way by every caller in every worker, and the cache below is only a cache.
 */

/** Side of the world lattice one mesa may occupy, metres. */
export const MESA_CELL_SIZE = 2200;
/**
 * Share of cells that hold a mesa at all, at the ring's mean. Each region scales it by
 * its `mesas` (world/regions.ts), read at the arclength of the road nearest the cell:
 * table country is crowded with them, the erg has almost none.
 */
const MESA_OCCUPANCY = 0.18;
/** Even table country leaves most cells open: past this, mesas wall the road in. */
const MESA_OCCUPANCY_MAX = 0.6;
export const MESA_MAX_RADIUS = 800;
const MESA_MIN_RADIUS = 220;
const MESA_MIN_HEIGHT = 180;
const MESA_MAX_HEIGHT = 900;
const MESA_TAG = 0x4d455341;

/**
 * The silhouette, outward to inward: `radius` is a fraction of the site's own radii,
 * `height` of its own height. Ring 0 is the buried skirt and is the footprint: every
 * other ring is the same outline scaled toward the centre, so ring 0 contains them all.
 */
export const MESA_RINGS = [
  { radius: 1.14, height: 0 },
  { radius: 1.0, height: 0.12 },
  { radius: 0.82, height: 0.55 },
  { radius: 0.68, height: 0.58 },
  { radius: 0.56, height: 0.84 },
  { radius: 0.45, height: 0.88 },
  { radius: 0.39, height: 1 },
] as const;
/** The plateau's centre vertex stands this fraction of the height up. */
export const MESA_TOP_HEIGHT = 1.01;
/** Widest any per-segment irregularity pushes the outline. */
const MAX_IRREGULARITY = 1.1;
/** The farthest any footprint reaches from its centre, metres. */
export const MESA_MAX_FOOTPRINT = MESA_MAX_RADIUS * MESA_RINGS[0].radius * MAX_IRREGULARITY;

/**
 * Nearest a footprint's edge may come to the centreline of any pass of the road, metres.
 *
 * Everything the road owns ends well inside this: the asphalt (`ROAD_MAX_HALF_WIDTH`),
 * the verge and embankment (`CORRIDOR_OUTER`, 30), the director's cuts and batters
 * (`CORRIDOR_REACH_M`, 62), the roadside landforms' near edge (`EDGE_M`, 64), the
 * sidetracks (58), the pole line and delineators. The number itself is set by the
 * GROUND, though, not by the furniture: the terrain's road-relative fades — dune relief
 * full by `RELIEF_FULL` (200) and the dry washes by `WASH_FULL` (220) — are the last
 * terms that depend on the distance to the road. Past 220 m the desert is a pure
 * function of position (apart from the landforms and basins, which are kept off below),
 * so the ground a mesa stands on is the same number in the tile worker, the vista, the
 * colliders and the footing below, whichever road branch each of them happens to
 * measure from. And 220 m is still "beside the road": a 600 m wall that close fills the
 * side window, which is the sight the owner asked to have back.
 */
export const MESA_ROAD_CLEARANCE_M = 220;
/**
 * Clear ground between a footprint and a landform's or a basin's reach, metres. Their
 * reaches are where the shape returns to exactly zero; this keeps the skirt off the
 * last gentle metres of the slope too, so a mesa never stands on a basin's blend.
 */
const LANDFORM_CLEARANCE_M = 40;
const LAKE_CLEARANCE_M = 40;
/** Widest a lake's centre stands from its own road point (`lakes.ts` LATERAL_*). */
const LAKE_LATERAL_MAX_M = 940;
/**
 * Placement attempts per occupied cell. Attempt 0 is the original roll, so every mesa
 * that was already clear of the road stands exactly where it always did; the others
 * move the centre elsewhere in the cell and keep its shape.
 */
const ATTEMPTS = 4;
/** Arclength step of the exact refinement near the road, metres. */
const REFINE_STEP_M = 8;
const HALF_COARSE = COARSE_SPACING / 2;
/** Half the landform polyline spacing (`landforms.ts` POLY_STEP_M). */
const LANDFORM_HALF_STEP_M = 4;
/** Resolved cells kept before the cache is dropped; values are pure, so that is free. */
const SITE_CACHE_LIMIT = 4096;

/**
 * Footing. The skirt ring is the mesa's lowest edge, and a straight edge between two
 * vertices 400 m apart crosses dunes and washes; set at each vertex's own ground it
 * floats over every hollow between them and shows a lit gap under the rock. So each
 * skirt vertex is set under the LOWEST drawn ground along both edges it ends, sampled
 * every `FOOTING_STEP_M`, less `FOOTING_BURY_M`. The bury covers what a 10 m sample
 * misses (chop and scoops are decimetres) and what the tile lattice chords off the
 * function (centimetres), and the far tile mode's 200 m wash fade (0.12 m at most).
 */
const FOOTING_STEP_M = 10;
const FOOTING_BURY_M = 1.5;
/**
 * The road distance the footing reads the open desert at: every term that depends on
 * it is saturated here (see `MESA_ROAD_CLEARANCE_M`), so this IS the ground at any
 * point of a footprint.
 */
const OPEN_GROUND_DIST_M = MESA_ROAD_CLEARANCE_M;

export interface MesaSite {
  /** Packed cell index: see `cellKey`. */
  readonly key: number;
  readonly cellX: number;
  readonly cellZ: number;
  /** Absolute world centre. */
  readonly x: number;
  readonly z: number;
  readonly height: number;
  readonly segments: number;
  /**
   * The outline at radius fraction 1, relative to the centre, one point per segment.
   * Ring `r`'s vertex is the centre plus this times `MESA_RINGS[r].radius`.
   */
  readonly outlineX: Float64Array;
  readonly outlineZ: Float64Array;
  /** Ring 0 in absolute XZ: the footprint polygon everything is tested against. */
  readonly footprintX: Float64Array;
  readonly footprintZ: Float64Array;
  /** Farthest footprint vertex from the centre. */
  readonly footprintRadius: number;
}

/** The exact ground under a site, resolved once: see `MesaField.footing`. */
export interface MesaFooting {
  /** Per segment: the skirt vertex's height, under the drawn ground of both its edges. */
  readonly skirtY: Float32Array;
  /** Per segment: the drawn ground at the wall's foot (ring 1). */
  readonly wallGroundY: Float32Array;
  /** The drawn ground at the centre, which every upper ring stands on. */
  readonly centreGroundY: number;
}

export function cellKey(cellX: number, cellZ: number): number {
  return (cellX + 1_048_576) * 2_097_152 + (cellZ + 1_048_576);
}

/**
 * Attempt `attempt` of a cell, unchecked: the raw recipe, or null for an empty cell.
 * `occupancy` is the cell's region's share (see `MESA_OCCUPANCY`); the default is the
 * ring's mean, which `tools/mesa-clearance.ts` reads to measure the old placement
 * (attempt 0, no clearance) against the new.
 */
export function mesaCandidate(
  seed: number,
  cellX: number,
  cellZ: number,
  attempt: number,
  occupancy = MESA_OCCUPANCY,
): MesaSite | null {
  if (hashUnit3(seed ^ MESA_TAG, cellX, cellZ) >= occupancy) return null;
  const tagX = attempt === 0 ? MESA_TAG + 1 : MESA_TAG + 400 + attempt * 2;
  const tagZ = attempt === 0 ? MESA_TAG + 2 : MESA_TAG + 401 + attempt * 2;
  const x = (cellX + 0.18 + hashUnit3(seed ^ tagX, cellX, cellZ) * 0.64) * MESA_CELL_SIZE;
  const z = (cellZ + 0.18 + hashUnit3(seed ^ tagZ, cellX, cellZ) * 0.64) * MESA_CELL_SIZE;

  const widthT = hashUnit3(seed ^ (MESA_TAG + 3), cellX, cellZ);
  const depthT = hashUnit3(seed ^ (MESA_TAG + 4), cellX, cellZ);
  const heightT = hashUnit3(seed ^ (MESA_TAG + 5), cellX, cellZ);
  const silhouetteT = hashUnit3(seed ^ (MESA_TAG + 8), cellX, cellZ);
  let radiusX: number;
  let radiusZ: number;
  let height: number;
  if (silhouetteT < 0.15) {
    // Retain a few dramatic spires, but make them the exception.
    radiusX = MESA_MIN_RADIUS + widthT * 110;
    radiusZ = radiusX * (0.65 + depthT * 0.25);
    height = 650 + heightT * (MESA_MAX_HEIGHT - 650);
  } else if (silhouetteT < 0.8) {
    // Most landmarks are the broader, medium-height formations seen in deserts.
    radiusX = 450 + widthT * (MESA_MAX_RADIUS - 450);
    radiusZ = radiusX * (0.8 + depthT * 0.3);
    height = MESA_MIN_HEIGHT + heightT * (600 - MESA_MIN_HEIGHT);
  } else {
    // The remainder bridge both families instead of repeating one silhouette.
    radiusX = 320 + widthT * 330;
    radiusZ = radiusX * (0.7 + depthT * 0.35);
    height = 300 + heightT * 450;
  }
  const rotation = hashUnit3(seed ^ (MESA_TAG + 6), cellX, cellZ) * Math.PI;
  const segments = 9 + Math.floor(hashUnit3(seed ^ (MESA_TAG + 7), cellX, cellZ) * 5);
  const outlineX = new Float64Array(segments);
  const outlineZ = new Float64Array(segments);
  const footprintX = new Float64Array(segments);
  const footprintZ = new Float64Array(segments);
  const skirt = MESA_RINGS[0].radius;
  let footprintRadius = 0;
  for (let segment = 0; segment < segments; segment++) {
    const theta = rotation + (segment / segments) * Math.PI * 2;
    // One outline per angular segment, shared by every height ring. Independent ring
    // noise twists one nominal wall quad into two visibly different triangles.
    const irregularity = 0.86 + hashUnit3(seed ^ (MESA_TAG + 20 + segment), cellX, cellZ) * 0.24;
    const ox = Math.cos(theta) * radiusX * irregularity;
    const oz = Math.sin(theta) * radiusZ * irregularity;
    outlineX[segment] = ox;
    outlineZ[segment] = oz;
    footprintX[segment] = x + ox * skirt;
    footprintZ[segment] = z + oz * skirt;
    footprintRadius = Math.max(footprintRadius, Math.hypot(ox * skirt, oz * skirt));
  }
  return {
    key: cellKey(cellX, cellZ),
    cellX,
    cellZ,
    x,
    z,
    height,
    segments,
    outlineX,
    outlineZ,
    footprintX,
    footprintZ,
    footprintRadius,
  };
}

/** Per-facet shade of a ring vertex, 0.96-1.04: a render detail, kept with the recipe. */
export function mesaFacetShade(seed: number, site: MesaSite, ring: number, segment: number): number {
  return 0.96 + hashUnit3(seed ^ (MESA_TAG + 200 + ring * 31 + segment), site.cellX, site.cellZ) * 0.08;
}

/**
 * Height of ring `ring`'s vertex `segment` on the exact ground: the skirt from the
 * footing, the wall's foot above the ground under it, every higher ring above the
 * ground at the centre (as the vista stands them on its own ground). What the collider
 * is built from, and the ceiling the vista holds its lowest two rings under up close.
 */
export function mesaFootingY(site: MesaSite, footing: MesaFooting, ring: number, segment: number): number {
  if (ring === 0) return footing.skirtY[segment]!;
  const lift = site.height * MESA_RINGS[ring]!.height;
  return (ring === 1 ? footing.wallGroundY[segment]! : footing.centreGroundY) + lift;
}

/** Whether a point is inside a site's footprint polygon. */
export function insideFootprint(site: MesaSite, px: number, pz: number): boolean {
  const xs = site.footprintX;
  const zs = site.footprintZ;
  const n = site.segments;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const zi = zs[i]!;
    const zj = zs[j]!;
    if (zi > pz !== zj > pz && px < ((xs[j]! - xs[i]!) * (pz - zi)) / (zj - zi) + xs[i]!) {
      inside = !inside;
    }
  }
  return inside;
}

/** Distance from a point to a site's footprint polygon: zero inside it. */
export function footprintDistance(site: MesaSite, px: number, pz: number): number {
  if (insideFootprint(site, px, pz)) return 0;
  const xs = site.footprintX;
  const zs = site.footprintZ;
  const n = site.segments;
  let best = Infinity;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = xs[j]!;
    const az = zs[j]!;
    const dx = xs[i]! - ax;
    const dz = zs[i]! - az;
    const len2 = dx * dx + dz * dz;
    let t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = ax + dx * t - px;
    const ez = az + dz * t - pz;
    const d = ex * ex + ez * ez;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/**
 * The mesas of one road. Shared per `Terrain` (see `mesaFieldOf`): every caller in one
 * thread reads the same resolved cells, and a worker resolves identical ones.
 */
export class MesaField {
  private readonly sites = new Map<number, MesaSite | null>();
  private readonly footings = new Map<number, MesaFooting>();
  /**
   * Whole-road coarse index for the clearance search. Its own instance: the shared ones
   * belong to callers this field cannot reach (a chunk context has none), and only the
   * spine grid is built here, never a lattice.
   */
  private readonly distance: RoadDistance;
  private readonly near: number[] = [];
  private readonly point = { x: 0, y: 0, z: 0 };
  private readonly region = newRegionMix();
  private readonly landformsSeen = new Set<Float64Array>();

  constructor(
    private readonly road: Road,
    private readonly terrain: Terrain,
  ) {
    this.distance = new RoadDistance(road);
  }

  /** The mesa of a cell, or null when it has none or no attempt cleared the road. */
  site(cellX: number, cellZ: number): MesaSite | null {
    const key = cellKey(cellX, cellZ);
    const hit = this.sites.get(key);
    if (hit !== undefined) return hit;
    let site: MesaSite | null = null;
    // The region of the road nearest the cell's corner node: one global search per new
    // cell, on its own lattice, the same answer in every thread.
    const s = this.distance.ownerAt(cellX * MESA_CELL_SIZE, cellZ * MESA_CELL_SIZE, MESA_CELL_SIZE);
    const occupancy = Math.min(MESA_OCCUPANCY_MAX, MESA_OCCUPANCY * regionAt(s, this.region).mesas);
    for (let attempt = 0; attempt < ATTEMPTS && site === null; attempt++) {
      const candidate = mesaCandidate(this.road.seed, cellX, cellZ, attempt, occupancy);
      if (candidate === null) break;
      if (this.clear(candidate)) site = candidate;
    }
    if (this.sites.size >= SITE_CACHE_LIMIT) this.sites.clear();
    this.sites.set(key, site);
    return site;
  }

  /**
   * Every site whose footprint comes within `radius` of a point, appended to `out`
   * (which is cleared first). Returns `out`.
   */
  sitesNear(x: number, z: number, radius: number, out: MesaSite[]): MesaSite[] {
    out.length = 0;
    const reach = radius + MESA_MAX_FOOTPRINT;
    const minX = Math.floor((x - reach) / MESA_CELL_SIZE);
    const maxX = Math.floor((x + reach) / MESA_CELL_SIZE);
    const minZ = Math.floor((z - reach) / MESA_CELL_SIZE);
    const maxZ = Math.floor((z + reach) / MESA_CELL_SIZE);
    for (let cellX = minX; cellX <= maxX; cellX++) {
      for (let cellZ = minZ; cellZ <= maxZ; cellZ++) {
        const site = this.site(cellX, cellZ);
        if (site === null) continue;
        const centre = Math.hypot(site.x - x, site.z - z);
        if (centre - site.footprintRadius > radius) continue;
        if (footprintDistance(site, x, z) <= radius) out.push(site);
      }
    }
    return out;
  }

  /**
   * Whether a point is inside any mesa's footprint, or within `pad` of one. The
   * placement test for everything that stands in the desert: scatter, tile props,
   * desert buildings.
   */
  blocks(x: number, z: number, pad: number): boolean {
    const reach = pad + MESA_MAX_FOOTPRINT;
    const minX = Math.floor((x - reach) / MESA_CELL_SIZE);
    const maxX = Math.floor((x + reach) / MESA_CELL_SIZE);
    const minZ = Math.floor((z - reach) / MESA_CELL_SIZE);
    const maxZ = Math.floor((z + reach) / MESA_CELL_SIZE);
    for (let cellX = minX; cellX <= maxX; cellX++) {
      for (let cellZ = minZ; cellZ <= maxZ; cellZ++) {
        const site = this.site(cellX, cellZ);
        if (site === null) continue;
        const dx = site.x - x;
        const dz = site.z - z;
        const outer = site.footprintRadius + pad;
        if (dx * dx + dz * dz > outer * outer) continue;
        if (footprintDistance(site, x, z) <= pad) return true;
      }
    }
    return false;
  }

  /**
   * The drawn ground under a site, resolved once and kept: the skirt heights that sit
   * every edge of it under the sand, and the ground the wall and the plateau stand on.
   * Pure in position, so the vista and the colliders read the same numbers. A few
   * hundred terrain samples: callers ask only for sites within a few kilometres.
   */
  footing(site: MesaSite): MesaFooting {
    const hit = this.footings.get(site.key);
    if (hit) return hit;
    const n = site.segments;
    const edgeLow = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = site.footprintX[i]!;
      const az = site.footprintZ[i]!;
      const dx = site.footprintX[j]! - ax;
      const dz = site.footprintZ[j]! - az;
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / FOOTING_STEP_M));
      let low = Infinity;
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        low = Math.min(low, this.groundAt(ax + dx * t, az + dz * t));
      }
      edgeLow[i] = low;
    }
    const skirtY = new Float32Array(n);
    const wallGroundY = new Float32Array(n);
    const wall = MESA_RINGS[1].radius;
    for (let i = 0; i < n; i++) {
      skirtY[i] = Math.min(edgeLow[i]!, edgeLow[(i + n - 1) % n]!) - FOOTING_BURY_M;
      wallGroundY[i] = this.groundAt(site.x + site.outlineX[i]! * wall, site.z + site.outlineZ[i]! * wall);
    }
    const footing: MesaFooting = { skirtY, wallGroundY, centreGroundY: this.groundAt(site.x, site.z) };
    if (this.footings.size >= SITE_CACHE_LIMIT) this.footings.clear();
    this.footings.set(site.key, footing);
    return footing;
  }

  /**
   * The open desert's drawn height at a point of a footprint. The road hint is 0
   * because nothing a hint finds can be here: no landform and no basin reaches a
   * footprint (see `clear`), and every road-relative fade is saturated.
   */
  private groundAt(x: number, z: number): number {
    return (
      this.terrain.openBase(x, z, OPEN_GROUND_DIST_M, 0) +
      this.terrain.explorationDetailAt(x, z, OPEN_GROUND_DIST_M, 0)
    );
  }

  /**
   * Whether a candidate's whole footprint clears the road, the landforms and the lakes.
   *
   * CONSERVATIVE BY CONSTRUCTION. Every point of the road lies within `HALF_COARSE` of
   * arclength, so of distance, of some coarse spine sample. So the samples within the
   * search radius below include one beside every stretch of road that could reach the
   * footprint, and a sample whose own distance less `HALF_COARSE` still clears needs no
   * more work: its whole half-spans either side are clear. Only spans that might come
   * close are walked, every `REFINE_STEP_M`, each sample's distance taken less half a
   * step for the same reason. Both bounds only ever reject too much, never too little.
   */
  private clear(site: MesaSite): boolean {
    const search =
      site.footprintRadius + LAKE_LATERAL_MAX_M + BASIN_OUTER_M + LAKE_CLEARANCE_M + HALF_COARSE;
    const count = this.distance.coarseNear(site.x, site.z, search, this.near);
    const spine = this.road.spine;
    const seen = this.landformsSeen;
    seen.clear();
    for (let i = 0; i < count; i++) {
      const k = this.near[i]!;
      const s = k * COARSE_SPACING;
      // The last sample also owns whatever road runs on past it, up to `road.length`.
      const last = k === spine.coarseX.length - 1;
      const coarse = footprintDistance(site, spine.coarseX[k]!, spine.coarseZ[k]!);
      if ((last || coarse - HALF_COARSE < MESA_ROAD_CLEARANCE_M) && !this.spanClear(site, s, last)) {
        return false;
      }

      const landform: LandformFootprint | null = this.terrain.landforms.footprintAt(s);
      if (landform !== null && !seen.has(landform.xs)) {
        seen.add(landform.xs);
        const needed = landform.reach + LANDFORM_CLEARANCE_M + LANDFORM_HALF_STEP_M;
        for (let v = 0; v < landform.xs.length; v++) {
          if (footprintDistance(site, landform.xs[v]!, landform.zs[v]!) < needed) return false;
        }
      }

      const lake = this.terrain.basins.nearest(s);
      if (lake !== null && Math.abs(lake.s - s) <= HALF_COARSE + 1) {
        const centre = this.road.offsetPoint(lake.s, lake.lateral, this.point);
        if (footprintDistance(site, centre.x, centre.z) < BASIN_OUTER_M + LAKE_CLEARANCE_M) return false;
      }
    }
    return true;
  }

  /**
   * The road within `HALF_COARSE` of arclength `s` (to the road's end for the last
   * sample), walked exactly against the footprint.
   */
  private spanClear(site: MesaSite, s: number, last: boolean): boolean {
    const from = Math.max(0, s - HALF_COARSE);
    const to = last ? this.road.length : Math.min(this.road.length, s + HALF_COARSE);
    for (let t = from; ; t = Math.min(to, t + REFINE_STEP_M)) {
      const p = this.road.offsetPoint(t, 0, this.point);
      if (footprintDistance(site, p.x, p.z) - REFINE_STEP_M / 2 < MESA_ROAD_CLEARANCE_M) return false;
      if (t >= to) return true;
    }
  }
}

const fields = new WeakMap<Terrain, MesaField>();

/**
 * The one `MesaField` for a terrain. Everything in a thread that owns a `Terrain` —
 * the vista, the chunk providers, the tile builder, the colliders — shares it, so a
 * cell is resolved once per thread; a worker's own terrain gets its own, identical one.
 */
export function mesaFieldOf(road: Road, terrain: Terrain): MesaField {
  let field = fields.get(terrain);
  if (!field) {
    field = new MesaField(road, terrain);
    fields.set(terrain, field);
  }
  return field;
}
