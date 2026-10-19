/**
 * tools/mesa-clearance.ts
 *
 * Does any mesa stand on the road? The acceptance test for road-aware mesa placement
 * (`src/world/mesas.ts`).
 *
 * For each seed it walks the REAL road over the first `--km` kilometres, enumerates
 * every mesa cell within reach of it through the shared `MesaField` (the same sites the
 * vista draws and the colliders build), and measures each footprint polygon against the
 * WHOLE road independently of the placement code: its own grid over the spine's coarse
 * table, then every stretch that could be nearest walked at `WALK_STEP_M`. Asserts:
 *
 *   - no footprint comes within `MESA_ROAD_CLEARANCE_M` of the centreline of any pass;
 *   - no footprint overlaps a roadside landform (`Terrain.landforms.covers` along its
 *     outline) or a lake basin (`BASIN_OUTER_M` of a lake's centre);
 *   - the footprint test, the collider and the tile-prop rejection work on a real site:
 *     its centre is inside and blocks, a point beyond it is outside, a horizontal ray
 *     at the player's height hits the collider at the drawn wall, every skirt edge lies
 *     under the ground the tiles draw, and a desert tile inside it places no props.
 *
 * Reports, per seed and in total: mesas per 100 km within 300 m / 1 km / 3 km of the
 * road, the nearest clearances (min / p10 / median), and the same intrusion count for
 * the OLD placement (every cell's first roll, no road test) so the fix is measured
 * against what it replaced. Exit code 1 on any failure.
 *
 *   npx tsx tools/mesa-clearance.ts [--seeds=1,7,42] [--km=250] [--random=2]
 *
 * Heavy (it builds each seed's whole spine): run it under the bench lock, niced.
 * Nothing here is part of the game bundle.
 */

import { PhysicsWorld } from '../src/core/physics';
import { generateDesertTileData, tileGroundSampler, DESERT_TILE_SIZE } from '../src/world/deserttiledata';
import { BASIN_OUTER_M } from '../src/world/lakes';
import { MESA_COLLIDER_ATTACH_M, MesaColliders } from '../src/world/mesacolliders';
import {
  MESA_CELL_SIZE,
  MESA_MAX_FOOTPRINT,
  MESA_RINGS,
  MESA_ROAD_CLEARANCE_M,
  footprintDistance,
  insideFootprint,
  mesaCandidate,
  mesaFieldOf,
  type MesaSite,
} from '../src/world/mesas';
import { WorldOrigin } from '../src/world/origin';
import { Road } from '../src/world/road';
import { RoadDistance } from '../src/world/roaddistance';
import { COARSE_SPACING } from '../src/world/roadcurve';
import { Terrain } from '../src/world/terrain';

const DEFAULT_SEEDS = [1, 7, 42, 1337, 90210, 2225416641, 3094605770];
/** Dense walk of the centreline near a footprint, metres. */
const WALK_STEP_M = 4;
/** Sites whose footprint is within this of the walked road are enumerated and reported. */
const REACH_M = 3000;
const BANDS = [300, 1000, 3000] as const;
/** Outline sampling for the landform test, metres. */
const OUTLINE_STEP_M = 10;
const GRID_M = 1000;

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

const extraRandom = Number(arg('random') ?? 2);
const seeds = (arg('seeds')?.split(',').map((s) => Number(s) >>> 0) ?? DEFAULT_SEEDS).concat(
  Array.from({ length: extraRandom }, () => (Math.random() * 2 ** 32) >>> 0),
);
const walkKm = Number(arg('km') ?? 250);

const failures: string[] = [];
function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

/** The tool's own whole-road index: a uniform grid over the spine's coarse samples. */
class CoarseGrid {
  private readonly cells = new Map<number, number[]>();
  constructor(
    readonly xs: Float64Array<ArrayBufferLike>,
    readonly zs: Float64Array<ArrayBufferLike>,
  ) {
    for (let k = 0; k < xs.length; k++) {
      const key = this.key(Math.floor(xs[k]! / GRID_M), Math.floor(zs[k]! / GRID_M));
      let list = this.cells.get(key);
      if (!list) {
        list = [];
        this.cells.set(key, list);
      }
      list.push(k);
    }
  }
  private key(ix: number, iz: number): number {
    return (ix + 1_000_000) * 2_000_000 + (iz + 1_000_000);
  }
  /** Every coarse index within `radius` of a point. */
  within(x: number, z: number, radius: number): number[] {
    const out: number[] = [];
    for (let ix = Math.floor((x - radius) / GRID_M); ix <= Math.floor((x + radius) / GRID_M); ix++) {
      for (let iz = Math.floor((z - radius) / GRID_M); iz <= Math.floor((z + radius) / GRID_M); iz++) {
        for (const k of this.cells.get(this.key(ix, iz)) ?? []) {
          if (Math.hypot(this.xs[k]! - x, this.zs[k]! - z) <= radius) out.push(k);
        }
      }
    }
    return out;
  }
}

/**
 * True minimum distance from the road centreline (any pass) to a footprint, with the
 * arclength it is reached at. Any road point lies within half a coarse step of a coarse
 * sample, so every stretch whose coarse sample is within (best coarse + one step) is
 * walked densely; nothing nearer can be missed.
 */
function trueClearance(road: Road, grid: CoarseGrid, site: MesaSite): { dist: number; s: number } {
  const near = grid.within(site.x, site.z, site.footprintRadius + REACH_M + MESA_MAX_FOOTPRINT);
  if (near.length === 0) return { dist: Infinity, s: 0 };
  let coarseBest = Infinity;
  const coarse = near.map((k) => {
    const d = footprintDistance(site, grid.xs[k]!, grid.zs[k]!);
    coarseBest = Math.min(coarseBest, d);
    return d;
  });
  let best = Infinity;
  let bestS = 0;
  const p = { x: 0, y: 0, z: 0 };
  const last = grid.xs.length - 1;
  for (let i = 0; i < near.length; i++) {
    if (coarse[i]! > coarseBest + COARSE_SPACING) continue;
    const s0 = near[i]! * COARSE_SPACING;
    const from = Math.max(0, s0 - COARSE_SPACING / 2);
    const to = near[i] === last ? road.length : Math.min(road.length, s0 + COARSE_SPACING / 2);
    for (let s = from; s <= to; s += WALK_STEP_M) {
      road.offsetPoint(s, 0, p);
      const d = footprintDistance(site, p.x, p.z);
      if (d < best) {
        best = d;
        bestS = s;
      }
    }
  }
  return { dist: best, s: bestS };
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!;
}

interface SeedReport {
  seed: number;
  km: number;
  sites: number;
  bands: number[];
  clearances: number[];
  intrusions: number;
  landformOverlaps: number;
  lakeOverlaps: number;
  oldIntrusions: number;
  oldOnRoad: number;
  oldSites: number;
  resolveMs: number;
}

const reports: SeedReport[] = [];
let exercised = false;

for (const seed of seeds) {
  const started = performance.now();
  const road = new Road(seed);
  const terrain = new Terrain(seed, road);
  const spine = road.spine;
  const spineMs = performance.now() - started;
  const grid = new CoarseGrid(spine.coarseX, spine.coarseZ);
  const field = mesaFieldOf(road, terrain);

  // Every cell whose mesa could come within REACH_M of the walked road.
  const cells = new Map<number, { cellX: number; cellZ: number }>();
  const reach = REACH_M + MESA_MAX_FOOTPRINT;
  const lastK = Math.min(spine.coarseX.length - 1, Math.floor((walkKm * 1000) / COARSE_SPACING));
  for (let k = 0; k <= lastK; k++) {
    const x = spine.coarseX[k]!;
    const z = spine.coarseZ[k]!;
    for (let cx = Math.floor((x - reach) / MESA_CELL_SIZE); cx <= Math.floor((x + reach) / MESA_CELL_SIZE); cx++) {
      for (let cz = Math.floor((z - reach) / MESA_CELL_SIZE); cz <= Math.floor((z + reach) / MESA_CELL_SIZE); cz++) {
        cells.set(cx * 1_000_003 + cz, { cellX: cx, cellZ: cz });
      }
    }
  }

  const report: SeedReport = {
    seed,
    km: walkKm,
    sites: 0,
    bands: BANDS.map(() => 0),
    clearances: [],
    intrusions: 0,
    landformOverlaps: 0,
    lakeOverlaps: 0,
    oldIntrusions: 0,
    oldOnRoad: 0,
    oldSites: 0,
    resolveMs: 0,
  };

  // Lake centres, the whole schedule: a basin from another pass can lie anywhere.
  const lakes = terrain.basins.schedule.map((lake) => road.offsetPoint(lake.s, lake.lateral));

  let nearest: { site: MesaSite; dist: number; s: number } | null = null;
  for (const { cellX, cellZ } of cells.values()) {
    const old = mesaCandidate(seed, cellX, cellZ, 0);
    if (old !== null) {
      const c = trueClearance(road, grid, old);
      if (c.dist <= REACH_M) {
        report.oldSites++;
        if (c.dist < MESA_ROAD_CLEARANCE_M) report.oldIntrusions++;
        if (c.dist <= 0) report.oldOnRoad++;
      }
    }

    const t0 = performance.now();
    const site = field.site(cellX, cellZ);
    report.resolveMs += performance.now() - t0;
    if (site === null) continue;
    const c = trueClearance(road, grid, site);
    if (c.dist > REACH_M) continue;
    report.sites++;
    report.clearances.push(c.dist);
    BANDS.forEach((band, i) => {
      if (c.dist <= band) report.bands[i]!++;
    });
    if (c.dist < MESA_ROAD_CLEARANCE_M) {
      report.intrusions++;
      failures.push(
        `seed ${seed}: mesa ${cellX},${cellZ} footprint ${c.dist.toFixed(1)} m from the road at s=${c.s.toFixed(0)}`,
      );
    }
    if (nearest === null || c.dist < nearest.dist) nearest = { site, dist: c.dist, s: c.s };

    // Landforms: walk the outline, hinting from every pass that could reach it.
    const hints = grid.within(site.x, site.z, site.footprintRadius + 1200).map((k) => k * COARSE_SPACING);
    let overlapsLandform = false;
    for (let i = 0; i < site.segments && !overlapsLandform; i++) {
      const j = (i + 1) % site.segments;
      const ax = site.footprintX[i]!;
      const az = site.footprintZ[i]!;
      const dx = site.footprintX[j]! - ax;
      const dz = site.footprintZ[j]! - az;
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / OUTLINE_STEP_M));
      for (let n = 0; n < steps && !overlapsLandform; n++) {
        const px = ax + (dx * n) / steps;
        const pz = az + (dz * n) / steps;
        for (const hint of hints) {
          if (terrain.landforms.covers(px, pz, hint, OUTLINE_STEP_M / 2)) {
            overlapsLandform = true;
            break;
          }
        }
      }
    }
    if (overlapsLandform) {
      report.landformOverlaps++;
      failures.push(`seed ${seed}: mesa ${cellX},${cellZ} overlaps a roadside landform`);
    }
    for (const lake of lakes) {
      if (footprintDistance(site, lake.x, lake.z) < BASIN_OUTER_M) {
        report.lakeOverlaps++;
        failures.push(`seed ${seed}: mesa ${cellX},${cellZ} overlaps a lake basin`);
      }
    }
  }
  reports.push(report);
  const sitesPer100 = (n: number): string => ((n * 100) / walkKm).toFixed(1);
  const sorted = [...report.clearances].sort((a, b) => a - b);
  console.log(
    `seed ${seed}: ${walkKm} km, spine ${(spineMs / 1000).toFixed(1)} s; ${report.sites} mesas within 3 km ` +
      `(${BANDS.map((b, i) => `${sitesPer100(report.bands[i]!)}/100km <=${b} m`).join(', ')}); ` +
      `clearance min ${percentile(sorted, 0).toFixed(0)} p10 ${percentile(sorted, 0.1).toFixed(0)} ` +
      `median ${percentile(sorted, 0.5).toFixed(0)} m; intrusions ${report.intrusions}, ` +
      `landform ${report.landformOverlaps}, lake ${report.lakeOverlaps}; ` +
      `OLD placement: ${report.oldIntrusions}/${report.oldSites} within ${MESA_ROAD_CLEARANCE_M} m, ` +
      `${report.oldOnRoad} across the road; resolve ${(report.resolveMs / Math.max(1, cells.size)).toFixed(3)} ms/cell`,
  );

  // The footprint test, the footing, the tile-prop rejection and the collider, on the
  // site nearest the road of the first seed.
  if (!exercised && nearest !== null) {
    exercised = true;
    await exercise(road, terrain, nearest.site, nearest.s);
  }
}

async function exercise(road: Road, terrain: Terrain, site: MesaSite, nearS: number): Promise<void> {
  const field = mesaFieldOf(road, terrain);
  check(insideFootprint(site, site.x, site.z), 'mesa centre is not inside its own footprint');
  check(field.blocks(site.x, site.z, 0), 'MesaField.blocks misses a mesa centre');
  const outsideX = site.x + (site.footprintRadius + 30);
  check(!insideFootprint(site, outsideX, site.z), 'a point past the footprint reports inside');
  check(footprintDistance(site, outsideX, site.z) > 0, 'a point past the footprint has zero distance');

  // Footing: every skirt edge under the ground the desert tiles draw, sampled every 2 m.
  const roadDistance = new RoadDistance(road);
  const drawn = tileGroundSampler({ seed: road.seed, road, terrain, roadDistance });
  const ground = { height: 0, detail: 0, nx: 0, ny: 0, nz: 0 };
  const footing = field.footing(site);
  let worstFloat = -Infinity;
  for (let i = 0; i < site.segments; i++) {
    const j = (i + 1) % site.segments;
    const steps = Math.ceil(
      Math.hypot(site.footprintX[j]! - site.footprintX[i]!, site.footprintZ[j]! - site.footprintZ[i]!) / 2,
    );
    for (let n = 0; n <= steps; n++) {
      const t = n / steps;
      const x = site.footprintX[i]! + (site.footprintX[j]! - site.footprintX[i]!) * t;
      const z = site.footprintZ[i]! + (site.footprintZ[j]! - site.footprintZ[i]!) * t;
      const y = footing.skirtY[i]! + (footing.skirtY[j]! - footing.skirtY[i]!) * t;
      drawn(x, z, ground);
      worstFloat = Math.max(worstFloat, y - ground.height);
    }
  }
  check(worstFloat < 0, `mesa skirt stands ${worstFloat.toFixed(2)} m above the drawn tile ground`);

  // A desert tile under the centre places no props.
  const tx = Math.floor(site.x / DESERT_TILE_SIZE);
  const tz = Math.floor(site.z / DESERT_TILE_SIZE);
  const tile = generateDesertTileData({ seed: road.seed, road, terrain, roadDistance }, tx, tz, false);
  check(tile.propSurfaces.every((surface) => surface === 0), 'a desert tile inside a mesa still places props');

  // Collider: attach from the nearest road point, then a horizontal ray at 1.5 m above
  // the wall's foot, aimed from the road at the centre, must stop at the drawn wall.
  const physics = await PhysicsWorld.create();
  const origin = new WorldOrigin();
  const from = road.offsetPoint(nearS, 0);
  origin.reset(from.x, from.z);
  const colliders = new MesaColliders(physics, road, terrain, origin);
  colliders.update(from.x, from.z);
  const expected = field.sitesNear(from.x, from.z, MESA_COLLIDER_ATTACH_M, []).length;
  check(
    colliders.count >= 1 && colliders.count === expected,
    `${colliders.count} mesa colliders from the road beside a mesa, ${expected} mesas within reach`,
  );
  physics.step();
  let worstMiss = 0;
  let rays = 0;
  for (let i = 0; i < site.segments; i++) {
    // Aim at the middle of wall face i, from 60 m outside it.
    const j = (i + 1) % site.segments;
    const wall = MESA_RINGS[1].radius;
    const wx = site.x + ((site.outlineX[i]! + site.outlineX[j]!) / 2) * wall;
    const wz = site.z + ((site.outlineZ[i]! + site.outlineZ[j]!) / 2) * wall;
    const dx = wx - site.x;
    const dz = wz - site.z;
    const len = Math.hypot(dx, dz);
    const ux = dx / len;
    const uz = dz / len;
    const startX = wx + ux * 200;
    const startZ = wz + uz * 200;
    const y = (footing.wallGroundY[i]! + footing.wallGroundY[j]!) / 2 + site.height * 0.2;
    const hit = physics.raycast(
      { x: startX - origin.x, y, z: startZ - origin.z },
      { x: -ux, y: 0, z: -uz },
      2000,
    );
    rays++;
    if (!hit) {
      worstMiss = Infinity;
      continue;
    }
    // The wall face lies between ring 1 and ring 2 at this height; the hit must be
    // between the skirt outline and the plateau's edge.
    const r = Math.hypot(hit.point.x + origin.x - site.x, hit.point.z + origin.z - site.z) / len;
    if (r > MESA_RINGS[0].radius / wall + 0.01 || r < MESA_RINGS[2].radius / wall - 0.01) {
      worstMiss = Math.max(worstMiss, Math.abs(r - 1));
    }
  }
  check(worstMiss === 0, `collider rays missed the wall (worst ${worstMiss.toFixed(3)} of the radius)`);
  // Fifty kilometres away the near mesa's collider is gone, and exactly the mesas in
  // reach there are solid instead.
  colliders.update(from.x + 50_000, from.z);
  const expectedFar = field.sitesNear(from.x + 50_000, from.z, MESA_COLLIDER_ATTACH_M, []).length;
  check(colliders.count === expectedFar, `${colliders.count} colliders 50 km away, ${expectedFar} mesas in reach`);
  console.log(
    `exercise: mesa ${site.cellX},${site.cellZ} ${site.footprintRadius.toFixed(0)} m footprint; centre inside, ` +
      `skirt ${(-worstFloat).toFixed(2)} m under the drawn ground at worst, tile props rejected, ` +
      `${rays} collider rays stopped at the wall, collider released when far`,
  );
}

const totalKm = reports.reduce((sum, r) => sum + r.km, 0);
const totals = BANDS.map((_, i) => reports.reduce((sum, r) => sum + r.bands[i]!, 0));
const all = reports.flatMap((r) => r.clearances).sort((a, b) => a - b);
const oldIntrusions = reports.reduce((sum, r) => sum + r.oldIntrusions, 0);
const oldOnRoad = reports.reduce((sum, r) => sum + r.oldOnRoad, 0);
const intrusions = reports.reduce((sum, r) => sum + r.intrusions, 0);
const overlaps = reports.reduce((sum, r) => sum + r.landformOverlaps + r.lakeOverlaps, 0);
console.log(
  `TOTAL ${reports.length} seeds, ${totalKm} km: mesas per 100 km ` +
    BANDS.map((b, i) => `<=${b} m ${((totals[i]! * 100) / totalKm).toFixed(1)}`).join(', ') +
    `; clearance min ${percentile(all, 0).toFixed(0)} p10 ${percentile(all, 0.1).toFixed(0)} median ${percentile(all, 0.5).toFixed(0)} m; ` +
    `intrusions ${intrusions} (old placement ${oldIntrusions}, ${oldOnRoad} across the road), ` +
    `landform/lake overlaps ${overlaps}`,
);
check(exercised, 'no mesa near the road to exercise the footprint and collider on');
check(totalKm >= 2000 || arg('km') !== undefined, `walked only ${totalKm} km`);
if (failures.length > 0) {
  for (const f of failures.slice(0, 40)) console.error(`FAIL ${f}`);
  console.error(`${failures.length} failure(s)`);
  process.exit(1);
}
console.log('mesa-clearance: PASS');
