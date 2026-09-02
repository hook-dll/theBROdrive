/**
 * tools/desert-washboard.ts
 *
 * What a wheel feels in the SHIPPED desert, and the counterpart to
 * tools/desert-ride.ts.
 *
 * desert-ride.ts measures `TerrainMeshProvider`, the road-relative fan. That mesh is
 * no longer registered in main.ts: the ground the car actually drives on is the
 * player-centred tile lattice in world/deserttiles.ts — a heightfield with 3 m cells
 * built from `generateDesertTileData` — so this builds real tiles and drags a wheel
 * across them instead of re-implementing anything.
 *
 * It reports two things, because the ground arrives in two pieces:
 *
 *   MESH KICK. The same headline number as the road and fan benches. A wheel
 *   ray-casts against a surface that is flat inside every triangle, so its vertical
 *   velocity is `slope * speed` and it steps at every edge crossed:
 *   `kick = |slope_after - slope_before| * speed`, in m/s.
 *
 *   TYRE PROFILE. Everything below the heightfield's own 3 m cells, which is not
 *   geometry at all but the per-wheel field in core/surfaces.ts (`microRelief`,
 *   `hummock`, `texture`). Sampled at the simulation's own 60 Hz, enveloped over the
 *   contact patch exactly as vehicle.ts does it, and reported as the vertical rate it
 *   hands the tyre spring and the step in that rate between one frame and the next —
 *   the same units as the kick, so the two can be compared.
 *
 *   npx tsx tools/desert-washboard.ts [speedKmh]
 *   bun tools/desert-washboard.ts [speedKmh]
 *
 * Reference points, both at 60 km/h: the road is kick rms 0.18-0.31 m/s and p99
 * 0.50-0.89 (tools/ride-bench.ts); the desert before the corrugation band went in was
 * rms 0.06 and p99 0.22, i.e. a THIRD of the asphalt, which is the defect this exists
 * to keep measured.
 *
 * Nothing here is part of the game bundle.
 */

import { MicroRelief, RoadTexture, SURFACES, SurfaceType } from '../src/core/surfaces';
import {
  DESERT_TILE_CELLS,
  DESERT_TILE_SIZE,
  DESERT_TILE_STEP,
  DESERT_TILE_VERTS,
  generateDesertTileData,
} from '../src/world/deserttiledata';
import { Road } from '../src/world/road';
import { RoadDistance } from '../src/world/roaddistance';
import { CORRIDOR_INNER, Terrain } from '../src/world/terrain';

/** Road arclength the sampled band starts at. Well clear of the homestead. */
const START_S = 24_000;
/** Metres of road covered. */
const SPAN_S = 700;
/** Path sampling step for the mesh walk, metres. Well under one heightfield cell. */
const PATH_STEP = 0.25;
/** A slope change below this is floating point inside one triangle, not an edge. */
const EDGE_EPSILON = 1e-4;
/** Lateral offsets a wheel is dragged along, metres. Both sides of the road. */
const ALONG_LATERALS = [6, 10, 16, 24, 40, 80];
/** How far out the radial paths run. */
const ACROSS_REACH = 110;
/** Seeds averaged; roughness must not be a seed lottery. */
const SEEDS = [1, 7, 42, 1337];

/** vehicle.ts: the profile is low-passed over this DISTANCE, not over time. */
const CONTACT_PATCH_M = 0.16;
/** vehicle.ts steps the simulation at this rate; the profile is sampled with it. */
const SIM_HZ = 60;

// Standstill escape, duplicated from vehicle.ts the same way desert-ride.ts does it.
const LONGITUDINAL_GRIP_FRACTION = 0.38;
const WHEELBASE = 2.5;
const TRACK = 1.5;
const REAR_LOAD_SHARE = 0.48;
const COM_HEIGHT_OVER_WHEELBASE = 0.25;
const ESCAPE_HEADINGS = 16;
/** Widest lateral offset the escape census samples, metres. */
const ESCAPE_LATERAL = 300;
/** Escape footprint spacing: every 6 m of road, every 9 m of lateral offset. */
const ESCAPE_S_STEP = 6;
const ESCAPE_LATERAL_STEP = 9;

const speedKmh = Number(process.argv[2] ?? 60);
const speed = speedKmh / 3.6;

/**
 * The tile lattice as a lookup: absolute world XZ to the height the collider has
 * there.
 *
 * The interpolation reproduces the tile's own triangulation (deserttiledata.ts builds
 * cell `(ix, iz)` as `a, c, b` and `b, c, d`, so the diagonal runs from `(ix, iz+1)`
 * to `(ix+1, iz)`), because a wheel feels the triangle it stands on and not the
 * bilinear patch it approximates.
 */
class TileField {
  private readonly tiles = new Map<string, Float32Array>();

  constructor(
    private readonly seed: number,
    private readonly road: Road,
    private readonly terrain: Terrain,
    private readonly roadDistance: RoadDistance,
  ) {}

  /** Builds the tile containing (x, z) unless it is already resident. */
  ensure(x: number, z: number): void {
    const tx = Math.floor(x / DESERT_TILE_SIZE);
    const tz = Math.floor(z / DESERT_TILE_SIZE);
    const key = `${tx}:${tz}`;
    if (this.tiles.has(key)) return;
    const data = generateDesertTileData(
      {
        seed: this.seed,
        road: this.road,
        terrain: this.terrain,
        roadDistance: this.roadDistance,
      },
      tx,
      tz,
      false,
    );
    this.tiles.set(key, data.heights);
  }

  get count(): number {
    return this.tiles.size;
  }

  /** Collider height under (x, z), or NaN when that tile was never built. */
  at(x: number, z: number): number {
    const tx = Math.floor(x / DESERT_TILE_SIZE);
    const tz = Math.floor(z / DESERT_TILE_SIZE);
    const heights = this.tiles.get(`${tx}:${tz}`);
    if (!heights) return Number.NaN;
    const localX = x - tx * DESERT_TILE_SIZE;
    const localZ = z - tz * DESERT_TILE_SIZE;
    const gx = Math.min(DESERT_TILE_CELLS - 1, Math.floor(localX / DESERT_TILE_STEP));
    const gz = Math.min(DESERT_TILE_CELLS - 1, Math.floor(localZ / DESERT_TILE_STEP));
    const fx = localX / DESERT_TILE_STEP - gx;
    const fz = localZ / DESERT_TILE_STEP - gz;
    const a = heights[gx * DESERT_TILE_VERTS + gz]!;
    const b = heights[(gx + 1) * DESERT_TILE_VERTS + gz]!;
    const c = heights[gx * DESERT_TILE_VERTS + gz + 1]!;
    const d = heights[(gx + 1) * DESERT_TILE_VERTS + gz + 1]!;
    if (fx + fz <= 1) return a + (b - a) * fx + (c - a) * fz;
    return d + (b - d) * (1 - fz) + (c - d) * (1 - fx);
  }
}

interface Stats {
  rms: number;
  p99: number;
  max: number;
  count: number;
}

function stats(values: number[]): Stats {
  if (values.length === 0) return { rms: 0, p99: 0, max: 0, count: 0 };
  values.sort((l, r) => l - r);
  const sumSq = values.reduce((acc, v) => acc + v * v, 0);
  return {
    rms: Math.sqrt(sumSq / values.length),
    p99: values[Math.floor(values.length * 0.99)]!,
    max: values[values.length - 1]!,
    count: values.length,
  };
}

interface Ride {
  readonly kick: Stats;
  readonly slopeMax: number;
  /** RMS of the profile with landform-scale height removed: the felt band's own size. */
  readonly bandRms: number;
  readonly metres: number;
}

/**
 * Samples either side, in path steps, that the band amplitude is measured against.
 * Subtracting their mean removes any straight ramp, which is what a dune is over this
 * distance, and leaves what rides on top of it. Raw height rms would report the dune
 * field — metres — and say nothing about the band this bench exists for.
 */
const BAND_HALF_WINDOW = Math.round(15 / PATH_STEP);

/** Kick statistics for one height profile sampled at PATH_STEP. */
function ride(heights: readonly number[]): Ride {
  const kicks: number[] = [];
  let slopeMax = 0;
  let bandSumSq = 0;
  let bandN = 0;
  let metres = 0;
  for (let i = 1; i + 1 < heights.length; i++) {
    const h0 = heights[i - 1]!;
    const h1 = heights[i]!;
    const h2 = heights[i + 1]!;
    if (Number.isNaN(h0) || Number.isNaN(h1) || Number.isNaN(h2)) continue;
    metres += PATH_STEP;
    const back = heights[i - BAND_HALF_WINDOW];
    const forward = heights[i + BAND_HALF_WINDOW];
    if (back !== undefined && forward !== undefined && !Number.isNaN(back) && !Number.isNaN(forward)) {
      const detrended = h1 - (back + forward) / 2;
      bandSumSq += detrended * detrended;
      bandN++;
    }
    const before = (h1 - h0) / PATH_STEP;
    const after = (h2 - h1) / PATH_STEP;
    if (Math.abs(after) > slopeMax) slopeMax = Math.abs(after);
    const change = Math.abs(after - before);
    if (change > EDGE_EPSILON) kicks.push(change * speed);
  }
  return {
    kick: stats(kicks),
    slopeMax,
    bandRms: bandN > 0 ? Math.sqrt(bandSumSq / bandN) : 0,
    metres,
  };
}

function meanOf(rides: readonly Ride[], pick: (r: Ride) => number): number {
  return rides.reduce((acc, r) => acc + pick(r), 0) / rides.length;
}

function rideRow(label: string, rides: readonly Ride[]): void {
  const metres = meanOf(rides, (r) => r.metres);
  const events = meanOf(rides, (r) => r.kick.count);
  console.log(
    label.padEnd(16) +
      meanOf(rides, (r) => r.kick.rms).toFixed(3).padStart(8) +
      meanOf(rides, (r) => r.kick.p99).toFixed(3).padStart(10) +
      meanOf(rides, (r) => r.kick.max).toFixed(3).padStart(10) +
      `${(meanOf(rides, (r) => r.slopeMax) * 100).toFixed(0)}%`.padStart(11) +
      (meanOf(rides, (r) => r.bandRms) * 1000).toFixed(0).padStart(10) +
      (metres > 0 ? (events / metres) * 100 : 0).toFixed(0).padStart(11),
  );
}

interface Built {
  readonly seed: number;
  readonly road: Road;
  readonly terrain: Terrain;
  readonly field: TileField;
  readonly micro: MicroRelief;
  readonly texture: RoadTexture;
}

function build(seed: number): Built {
  const road = new Road(seed);
  const terrain = new Terrain(seed, road);
  const roadDistance = new RoadDistance(road);
  const field = new TileField(seed, road, terrain, roadDistance);
  // Every tile the paths and the escape census will touch, built once.
  for (let s = START_S - 40; s <= START_S + SPAN_S + 40; s += 40) {
    for (let lateral = -ESCAPE_LATERAL - 40; lateral <= ESCAPE_LATERAL + 40; lateral += 40) {
      const p = road.offsetPoint(s, lateral);
      field.ensure(p.x, p.z);
    }
  }
  return {
    seed,
    road,
    terrain,
    field,
    micro: new MicroRelief(seed),
    texture: new RoadTexture(seed),
  };
}

/**
 * The per-wheel profile along one path, run through vehicle.ts's own envelope at the
 * simulation rate.
 *
 * `rate` is the vertical velocity the tyre spring is driven at; `step` is how much
 * that rate changes from one frame to the next, which is the same quantity the mesh
 * kick reports.
 */
function tyreProfile(
  built: Built,
  bands: { microRelief: number; hummock: number; texture: number },
  walk: (distance: number) => { x: number; z: number },
  metres: number,
): { rate: Stats; step: Stats; heightRms: number } {
  const dt = 1 / SIM_HZ;
  const rolled = speed * dt;
  const envelope = 1 - Math.exp(-rolled / CONTACT_PATCH_M);
  const rates: number[] = [];
  const steps: number[] = [];
  let height = 0;
  let previousRate = 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let distance = 0; distance <= metres; distance += rolled) {
    const p = walk(distance);
    const target =
      bands.microRelief * built.micro.at(p.x, p.z) +
      bands.hummock * built.micro.hummockAt(p.x, p.z) +
      bands.texture * built.texture.at(p.x, p.z);
    const before = height;
    height += (target - height) * envelope;
    const rate = (height - before) / dt;
    if (n > 0) steps.push(Math.abs(rate - previousRate));
    rates.push(Math.abs(rate));
    previousRate = rate;
    sum += height;
    sumSq += height * height;
    n++;
  }
  const mean = n > 0 ? sum / n : 0;
  return {
    rate: stats(rates),
    step: stats(steps),
    heightRms: n > 0 ? Math.sqrt(Math.max(0, sumSq / n - mean * mean)) : 0,
  };
}

const built = SEEDS.map(build);

console.log(
  `desert washboard bench @ ${speedKmh} km/h, s ${START_S}-${START_S + SPAN_S}, ` +
    `${built[0]!.field.count} tiles/seed, ${DESERT_TILE_STEP.toFixed(1)} m heightfield cells, ` +
    `corridor ${CORRIDOR_INNER.toFixed(1)} m`,
);
console.log('--- collider mesh: what the 3 m heightfield carries');
console.log('path            kick rms  kick p99  kick max  max slope    band mm  edges/100m');

for (const lateral of ALONG_LATERALS) {
  const rides: Ride[] = [];
  for (const { road, field } of built) {
    for (const side of [1, -1]) {
      const heights: number[] = [];
      for (let s = START_S; s <= START_S + SPAN_S; s += PATH_STEP) {
        const p = road.offsetPoint(s, side * lateral);
        heights.push(field.at(p.x, p.z));
      }
      rides.push(ride(heights));
    }
  }
  rideRow(`along ${lateral} m`, rides);
}

{
  const rides = built.map(({ road, field }) => {
    const heights: number[] = [];
    for (let k = 0; k < 30; k++) {
      const s = START_S + k * 23;
      const frame = road.sampleAt(s);
      const dirX = Math.cos(frame.heading);
      const dirZ = -Math.sin(frame.heading);
      const side = k % 2 === 0 ? 1 : -1;
      for (let d = CORRIDOR_INNER; d <= ACROSS_REACH; d += PATH_STEP) {
        heights.push(field.at(frame.x + side * dirX * d, frame.z + side * dirZ * d));
      }
      heights.push(Number.NaN); // break the profile between runs
    }
    return ride(heights);
  });
  rideRow(`across ${Math.round(CORRIDOR_INNER)}-${ACROSS_REACH} m`, rides);
}

// The same wheel, on the band the heightfield cannot carry. Two headings, because the
// whole point of a grain is that crossing it and running with it are different, and
// asphalt for scale: that row is the road's own `texture` and nothing else.
console.log('--- tyre profile: the sub-cell band, per wheel at 60 Hz');
console.log('surface/heading   rate rms  rate p99  step rms  step p99  height mm');
const sand = SURFACES[SurfaceType.Sand];
const PROFILE_CASES: readonly {
  label: string;
  bands: { microRelief: number; hummock: number; texture: number };
}[] = [
  { label: 'sand', bands: sand },
  // What the same wheel felt before the hummock band existed: the ripple and the
  // road texture on their own. The difference between this row and the one above is
  // exactly what `SurfaceProps.hummock` buys.
  { label: 'sand, no hummock', bands: { ...sand, hummock: 0 } },
  { label: 'gravel', bands: SURFACES[SurfaceType.Gravel] },
  { label: 'asphalt', bands: SURFACES[SurfaceType.Asphalt] },
];

for (const { label, bands } of PROFILE_CASES) {
  for (const heading of [0, Math.PI / 2] as const) {
    const results = built.map((b) => {
      const frame = b.road.sampleAt(START_S);
      const base = b.road.offsetPoint(START_S, 40);
      const theta = frame.heading + heading;
      const dirX = Math.sin(theta);
      const dirZ = Math.cos(theta);
      return tyreProfile(
        b,
        bands,
        (distance) => ({ x: base.x + dirX * distance, z: base.z + dirZ * distance }),
        SPAN_S,
      );
    });
    const pick = (f: (r: (typeof results)[number]) => number): number =>
      results.reduce((acc, r) => acc + f(r), 0) / results.length;
    console.log(
      `${label} ${heading === 0 ? 'along' : 'across'}`.padEnd(22) +
        pick((r) => r.rate.rms).toFixed(3).padStart(8) +
        pick((r) => r.rate.p99).toFixed(3).padStart(10) +
        pick((r) => r.step.rms).toFixed(3).padStart(10) +
        pick((r) => r.step.p99).toFixed(3).padStart(10) +
        (pick((r) => r.heightRms) * 1000).toFixed(0).padStart(11),
    );
  }
}

/**
 * Can a stopped car drive out again?
 *
 * Identical statics to desert-ride.ts — footprint plane through four contact points,
 * measured on the surface the collider actually has — but on the tile lattice, which
 * is the surface the car is actually stopped on. A pair is BLOCKED when the grade
 * beats the tyres in the direction the car happens to be facing (a stopped car cannot
 * steer) and STRANDED when reverse fails too.
 */
{
  const sand = SURFACES[SurfaceType.Sand];
  const climbs = (mu: number, rearDriven: boolean): number => {
    const share = rearDriven ? REAR_LOAD_SHARE : 1 - REAR_LOAD_SHARE;
    const sign = rearDriven ? 1 : -1;
    return (mu * share - sand.rollingResistance) / (1 - sign * mu * COM_HEIGHT_OVER_WHEELBASE);
  };

  const grades: number[] = [];
  let worstGrade = 0;
  for (const { road, field } of built) {
    for (let s = START_S; s < START_S + SPAN_S; s += ESCAPE_S_STEP) {
      for (
        let lateral = -ESCAPE_LATERAL;
        lateral <= ESCAPE_LATERAL;
        lateral += ESCAPE_LATERAL_STEP
      ) {
        if (Math.abs(lateral) <= CORRIDOR_INNER) continue;
        const centre = road.offsetPoint(s, lateral);
        for (let h = 0; h < ESCAPE_HEADINGS; h++) {
          const theta = (h / ESCAPE_HEADINGS) * Math.PI * 2;
          const fx = Math.sin(theta);
          const fz = Math.cos(theta);
          let momentAlong = 0;
          let ok = true;
          for (const along of [WHEELBASE / 2, -WHEELBASE / 2]) {
            for (const side of [TRACK / 2, -TRACK / 2]) {
              const y = field.at(
                centre.x + fx * along - fz * side,
                centre.z + fz * along + fx * side,
              );
              if (Number.isNaN(y)) ok = false;
              else momentAlong += y * along;
            }
          }
          if (!ok) continue;
          const grade = momentAlong / (WHEELBASE * WHEELBASE);
          grades.push(grade);
          if (Math.abs(grade) > worstGrade) worstGrade = Math.abs(grade);
        }
      }
    }
  }

  console.log(
    `standstill escape over ${grades.length} (spot, heading) pairs inside ${ESCAPE_LATERAL} m, ` +
      `worst footprint grade ${(worstGrade * 100).toFixed(0)}%:`,
  );
  for (const frictionSlip of new Set([sand.frictionSlip, 1.15, 1.35])) {
    const mu = frictionSlip * LONGITUDINAL_GRIP_FRACTION;
    const line: string[] = [];
    for (const rearDriven of [true, false]) {
      let blocked = 0;
      let stranded = 0;
      for (const grade of grades) {
        const forward = grade <= climbs(mu, rearDriven);
        const back = -grade <= climbs(mu, rearDriven);
        if (!forward) blocked++;
        if (!forward && !back) stranded++;
      }
      line.push(
        `${rearDriven ? 'RWD' : 'FWD'} climbs ${(climbs(mu, rearDriven) * 100).toFixed(0)}%, ` +
          `${((blocked / grades.length) * 100).toFixed(1)}% blocked / ` +
          `${((stranded / grades.length) * 100).toFixed(2)}% stranded`,
      );
    }
    const mark = frictionSlip === sand.frictionSlip ? ' <- shipped' : '';
    console.log(`  frictionSlip ${frictionSlip.toFixed(2)}: ${line.join('   ')}${mark}`);
  }
}
