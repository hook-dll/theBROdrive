/**
 * tools/verge-profile.ts — the road's shoulder as the wheels meet it.
 *
 * The road stands on a low embankment (`roadprofile.embankmentDropAt`): a graded
 * shoulder `SHOULDER_WIDTH_M` wide that the autopilot sizes verge passes on, a ragged
 * fringe past it, a batter down to the desert. Three things have to agree on it — the
 * terrain under it, the strip the road mesh draws and collides, and the planner — and
 * this measures the agreement on the REAL road mesh (`RoadMeshProvider`, the tiles'
 * drawn ground via `tileGroundSampler`), with rays against its colliders:
 *
 *   drivable   how far past the asphalt edge the ground under a wheel is still the
 *              strip (LooseShoulder) or the road's own surface, walking out from the
 *              edge until the first sand or rock: min, p1, p50, on every row, on long
 *              straights, and on lay-by rows (measured from the lay-by's own edge);
 *   fall       the collider's cross-fall at 0.5, 1.5 and 2.3 m past the edge;
 *   poke       the drawn desert ground standing ABOVE the collided strip anywhere
 *              inside the guaranteed width: ground showing through the shoulder;
 *   edge drop  the drawn ground under the asphalt edge (rows past `SHOULDER_MAX_DROP`
 *              get no strip at all), and the desert 5 m out, below the asphalt edge.
 *
 *   bun tools/verge-profile.ts [seed] [--samples N]
 */

import { PhysicsWorld } from '../src/core/physics';
import { SurfaceType } from '../src/core/surfaces';
import { GameWorld, newWorldState } from '../src/game/state';
import { type ChunkContent, type ChunkContext } from '../src/world/chunks';
import { tileGroundSampler, type DrawnGroundSample } from '../src/world/deserttiledata';
import { varietyEventsBetween } from '../src/world/director';
import { DELINEATOR_SETBACK_M } from '../src/world/props/delineators';
import { POLE_SETBACK_M } from '../src/world/props/poles';
import { laybyNear, laybyOuterAt, laybysBetween } from '../src/world/layby';
import { LaybyMeshProvider } from '../src/world/laybymesh';
import { InstanceBatches } from '../src/world/props/instancebatch';
import { CHUNK_LENGTH } from '../src/world/ranges';
import { Road } from '../src/world/road';
import { RoadDistance } from '../src/world/roaddistance';
import { RoadMeshProvider } from '../src/world/roadmesh';
import { SHOULDER_WIDTH_M } from '../src/world/roadprofile';
import { SIDETRACK_LIFT, sidetrackPlan } from '../src/world/sidetrack';
import { Terrain } from '../src/world/terrain';
import { installAssetShim } from './assetshim';
import { drawnGroundY } from '../src/world/terrainmesh';
import { installDocumentShim } from './domshim';

installAssetShim();
installDocumentShim();

const args = process.argv.slice(2);
const SEED = Number(args.find((a) => !a.startsWith('--') && Number.isFinite(Number(a))) ?? 1337) >>> 0;
const SAMPLES = args.includes('--samples') ? Number(args[args.indexOf('--samples') + 1]) : 60;
const STRAIGHT_CURVATURE = 1 / 600;
const STEP_ACROSS = 0.05;
const REACH = 4;

const road = new Road(SEED);
const terrain = new Terrain(SEED, road);
const physics = await PhysicsWorld.create();
const world = new GameWorld(newWorldState(SEED));
const roadDistance = new RoadDistance(road);
const provider = new RoadMeshProvider(SEED, roadDistance);
const laybyProvider = new LaybyMeshProvider();
const ground = tileGroundSampler({ seed: SEED, road, terrain, roadDistance });
const g: DrawnGroundSample = { height: 0, detail: 0, nx: 0, ny: 1, nz: 0 };

/**
 * The chunk being measured is built round its own floating origin, as the game builds
 * it: forty thousand kilometres out, an f32 vertex is metres off. Rays are cast in
 * that frame (`ox`, `oz`); every height function is absolute.
 */
let ox = 0;
let oz = 0;
function buildChunk(index: number): ChunkContent | null {
  const sStart = index * CHUNK_LENGTH;
  const start = road.sampleAt(sStart);
  ox = Math.round(start.x);
  oz = Math.round(start.z);
  const context: ChunkContext = {
    chunkIndex: index,
    sStart: Math.max(0, sStart),
    sEnd: Math.min(road.length, sStart + CHUNK_LENGTH),
    road,
    terrain,
    physics,
    world,
    hasPhysics: true,
    originX: ox,
    originZ: oz,
    batches: new InstanceBatches({ x: ox, z: oz }),
  };
  const content = provider.build(context);
  // The lay-by's own asphalt, which its shoulder hangs off.
  const pad = laybyProvider.build(context);
  for (const collider of [...(content?.colliders ?? []), ...(pad?.colliders ?? [])]) collider.setEnabled(true);
  physics.step();
  return content && pad ? { ...content, bodies: [...content.bodies, ...pad.bodies] } : content;
}

const DRIVABLE = new Set<SurfaceType>([
  SurfaceType.LooseShoulder,
  SurfaceType.Asphalt,
  SurfaceType.CrackedAsphalt,
  SurfaceType.Concrete,
  SurfaceType.Gravel,
]);
const DOWN = { x: 0, y: -1, z: 0 };
const origin = { x: 0, y: 0, z: 0 };
const hitY: number[] = [];
const hitDrivable: boolean[] = [];

/** One row and side: rays out from the edge; false if the road had no collider there. */
function castRow(s: number, sign: number, inner: number, edgeY: number): boolean {
  hitY.length = 0;
  hitDrivable.length = 0;
  for (let d = 0; d <= REACH + 1e-6; d += STEP_ACROSS) {
    const p = road.offsetPoint(s, sign * (inner + d));
    origin.x = p.x - ox;
    origin.y = edgeY + 3;
    origin.z = p.z - oz;
    const hit = physics.raycast(origin, DOWN, 8);
    if (!hit) return false;
    hitY.push(hit.point.y);
    hitDrivable.push(DRIVABLE.has(physics.surfaces.lookupType(hit.colliderHandle)));
  }
  return true;
}

interface Tally {
  drivable: number[];
  fall05: number[];
  fall15: number[];
  fall23: number[];
  poke: number[];
  edgeDrop: number[];
  desert5: number[];
}
const tally = (): Tally => ({ drivable: [], fall05: [], fall15: [], fall23: [], poke: [], edgeDrop: [], desert5: [] });
const all = tally();
const straight = tally();
const laybyRows = tally();

function fallAt(d: number): number {
  const a = Math.round((d - 0.25) / STEP_ACROSS);
  const b = Math.round((d + 0.25) / STEP_ACROSS);
  return (hitY[a]! - hitY[b]!) / 0.5;
}

function measureRow(s: number, sign: number, into: Tally[]): void {
  const halfWidth = road.halfWidthAt(s);
  const layby = laybyNear(SEED, s);
  const inner = layby?.side === sign ? laybyOuterAt(layby, s, halfWidth) : halfWidth;
  const edge = road.offsetPoint(s, sign * (inner - 0.05));
  origin.x = edge.x - ox;
  origin.y = 1e4;
  origin.z = edge.z - oz;
  const edgeHit = physics.raycast(origin, DOWN, 2e4);
  if (!edgeHit) return;
  const edgeY = edgeHit.point.y;
  if (!castRow(s, sign, inner, edgeY)) return;
  // Walk out from just past the lip until the first wheel-width that is not drivable.
  let drivable = 0;
  for (let i = 1; i < hitDrivable.length; i++) {
    if (!hitDrivable[i]) break;
    drivable = i * STEP_ACROSS;
  }
  let poke = Number.NEGATIVE_INFINITY;
  let pokeAt = 0;
  for (let i = 1; i * STEP_ACROSS <= SHOULDER_WIDTH_M + 1e-6; i++) {
    const p = road.offsetPoint(s, sign * (inner + i * STEP_ACROSS));
    ground(p.x, p.z, g);
    if (g.height - hitY[i]! > poke) {
      poke = g.height - hitY[i]!;
      pokeAt = i * STEP_ACROSS;
    }
  }
  const atEdge = road.offsetPoint(s, sign * inner);
  ground(atEdge.x, atEdge.z, g);
  const edgeDrop = edgeY - g.height;
  const out5 = road.offsetPoint(s, sign * (inner + 5));
  ground(out5.x, out5.z, g);
  if (drivable < SHOULDER_WIDTH_M - STEP_ACROSS || poke > 0.05) {
    narrow.push({ s, sign, drivable, edgeDrop, poke, pokeAt, desert5: edgeY - g.height });
  }
  for (const t of into) {
    t.drivable.push(drivable);
    t.fall05.push(fallAt(0.5));
    t.fall15.push(fallAt(1.5));
    t.fall23.push(fallAt(2.3));
    t.poke.push(poke);
    t.edgeDrop.push(edgeDrop);
    t.desert5.push(edgeY - g.height);
  }
}

const narrow: {
  s: number;
  sign: number;
  drivable: number;
  edgeDrop: number;
  poke: number;
  pokeAt: number;
  desert5: number;
}[] = [];
function pct(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? Number.NaN;
}
function report(label: string, t: Tally): void {
  const n = t.drivable.length;
  if (n === 0) {
    console.log(`  ${label.padEnd(9)} no rows`);
    return;
  }
  const f = (v: number): string => v.toFixed(2);
  const pokes = t.poke.filter((v) => v > 0).length;
  console.log(
    `  ${label.padEnd(9)} ${String(n).padStart(6)} rows | drivable past the edge min ${f(Math.min(...t.drivable))} ` +
      `p1 ${f(pct(t.drivable, 0.01))} p50 ${f(pct(t.drivable, 0.5))} m, under ${SHOULDER_WIDTH_M} m on ` +
      `${t.drivable.filter((v) => v < SHOULDER_WIDTH_M - STEP_ACROSS).length} | fall p50 ` +
      `${(pct(t.fall05, 0.5) * 100).toFixed(1)}/${(pct(t.fall15, 0.5) * 100).toFixed(1)}/${(pct(t.fall23, 0.5) * 100).toFixed(1)}% ` +
      `at 0.5/1.5/2.3 m | ground over strip on ${pokes} rows, max ${(Math.max(...t.poke) * 100).toFixed(1)} cm | ` +
      `ground under edge p50 ${f(pct(t.edgeDrop, 0.5))} max ${f(Math.max(...t.edgeDrop))} m | desert 5 m out p50 ` +
      `${f(pct(t.desert5, 0.5))} p5 ${f(pct(t.desert5, 0.05))} p95 ${f(pct(t.desert5, 0.95))} m below the asphalt`,
  );
}

// Evenly spaced chunks along the road, then every lay-by among the first of them.
const built = new Set<number>();
const lastChunk = Math.floor(road.length / CHUNK_LENGTH) - 2;
for (let k = 0; k < SAMPLES; k++) {
  const index = 5 + Math.floor(((lastChunk - 5) * k) / SAMPLES);
  built.add(index);
}
const laybys = laybysBetween(SEED, 5 * CHUNK_LENGTH, road.length - 2 * CHUNK_LENGTH).slice(0, 12);
for (const l of laybys) {
  for (let s = l.sEntry; s <= l.sExit; s += CHUNK_LENGTH) built.add(Math.floor(s / CHUNK_LENGTH));
  built.add(Math.floor(l.sExit / CHUNK_LENGTH));
}
// The verge furniture the director schedules: tracks leaving the road, reflector runs.
const events = varietyEventsBetween(SEED, 5 * CHUNK_LENGTH, Math.min(road.length - 2 * CHUNK_LENGTH, 400_000));
const sidetracks = events.filter((e) => e.kind === 'sidetrack').slice(0, 12);
const delineatorRuns = events.filter((e) => e.kind === 'delineators').slice(0, 6);
for (const e of [...sidetracks, ...delineatorRuns]) {
  for (let s = e.s - e.halfLength; s <= e.s + e.halfLength + CHUNK_LENGTH; s += CHUNK_LENGTH) {
    built.add(Math.floor(s / CHUNK_LENGTH));
  }
}

// Furniture: sidetrack ruts (their own `drawnGroundY + SIDETRACK_LIFT`, the first 30 m
// of every track), reflector posts and pole feet (`drawnGroundY`), each measured in its
// own chunk against what is drawn where it stands.
interface Placed {
  s: number;
  lateral: number;
  y: number;
}
const ruts: Placed[] = [];
for (const e of sidetracks) {
  const plan = sidetrackPlan(SEED, road, e);
  for (const station of plan.stations.slice(0, 10)) {
    for (const across of [-1, 0, 1]) {
      const lateral = station.lateral + across * Math.cos(station.angle);
      const s = station.s - across * plan.side * Math.sin(station.angle);
      ruts.push({ s, lateral, y: drawnGroundY(road, terrain, roadDistance, s, lateral) + SIDETRACK_LIFT });
    }
  }
}
const posts: Placed[] = [];
for (const e of delineatorRuns) {
  for (let s = e.s - e.halfLength; s <= e.s + e.halfLength; s += 25) {
    for (const sign of [-1, 1]) {
      const lateral = sign * (road.halfWidthAt(s) + DELINEATOR_SETBACK_M);
      // As `DelineatorProvider` places them: on the tiles' drawn ground.
      const p = road.offsetPoint(s, lateral);
      ground(p.x, p.z, g);
      posts.push({ s, lateral, y: g.height });
    }
  }
}
const poles: Placed[] = [];
for (const index of built) {
  for (let s = index * CHUNK_LENGTH; s < (index + 1) * CHUNK_LENGTH; s += 40) {
    const lateral = -(road.halfWidthAt(s) + POLE_SETBACK_M);
    poles.push({ s, lateral, y: drawnGroundY(road, terrain, roadDistance, s, lateral) });
  }
}
const placedOff = new Map<Placed[], number[]>([
  [ruts, []],
  [posts, []],
  [poles, []],
]);

/** The top of what is drawn at a road-frame point: the shoulder strip where it is, else the tiles' ground. */
function drawnTop(s: number, lateral: number): number {
  const p = road.offsetPoint(s, lateral);
  ground(p.x, p.z, g);
  origin.x = p.x - ox;
  origin.y = g.height + 3;
  origin.z = p.z - oz;
  const hit = physics.raycast(origin, DOWN, 6);
  const strip =
    hit && physics.surfaces.lookupType(hit.colliderHandle) === SurfaceType.LooseShoulder ? hit.point.y : -Infinity;
  return Math.max(strip, g.height);
}

for (const index of [...built].sort((a, b) => a - b)) {
  const content = buildChunk(index);
  if (!content) continue;
  for (let s = index * CHUNK_LENGTH + 2; s < (index + 1) * CHUNK_LENGTH - 2; s += 1) {
    const isStraight =
      Math.abs(road.curvatureAt(s - 100)) < STRAIGHT_CURVATURE &&
      Math.abs(road.curvatureAt(s)) < STRAIGHT_CURVATURE &&
      Math.abs(road.curvatureAt(s + 100)) < STRAIGHT_CURVATURE;
    for (const sign of [-1, 1]) {
      const layby = laybyNear(SEED, s);
      const onLayby = layby !== null && layby.side === sign && s >= layby.sEntry && s <= layby.sExit;
      const into = [all];
      if (isStraight && !onLayby) into.push(straight);
      if (onLayby) into.push(laybyRows);
      measureRow(s, sign, into);
    }
  }
  for (const [points, offs] of placedOff) {
    for (const p of points) {
      if (Math.floor(p.s / CHUNK_LENGTH) === index) offs.push(p.y - drawnTop(p.s, p.lateral));
    }
  }
  for (const body of content.bodies) physics.removeBody(body);
  content.dispose();
}

console.log(
  `verge profile, seed ${SEED}: ${built.size} chunks (${laybys.length} lay-bys), rays every ${STEP_ACROSS} m out to ${REACH} m`,
);
report('all', all);
report('straight', straight);
report('lay-by', laybyRows);
const describe = (n: (typeof narrow)[number]): string =>
  `s ${n.s.toFixed(0)} side ${n.sign}: drivable ${n.drivable.toFixed(2)} m, ground over strip ` +
  `${(n.poke * 100).toFixed(0)} cm at ${n.pokeAt.toFixed(2)} m, ground under edge ${n.edgeDrop.toFixed(2)} m, desert 5 m out ` +
  `${n.desert5.toFixed(2)} m down, curvature 1/${(1 / Math.max(1e-6, Math.abs(road.curvatureAt(n.s)))).toFixed(0)} m`;
console.log(
  `  ${narrow.filter((n) => n.drivable < SHOULDER_WIDTH_M - STEP_ACROSS).length} narrow rows, ` +
    `${narrow.filter((n) => n.poke > 0.05).length} rows with ground over the strip by 5 cm+`,
);
for (const n of [...narrow].sort((a, b) => a.drivable - b.drivable).slice(0, 4)) console.log(`    narrowest ${describe(n)}`);
for (const n of [...narrow].sort((a, b) => b.poke - a.poke).slice(0, 4)) console.log(`    poking    ${describe(n)}`);
const fmt = (v: number): string => `${(v * 100).toFixed(1)} cm`;
for (const [label, points] of [
  [`sidetrack ruts (${sidetracks.length} tracks)`, ruts],
  [`reflector post feet (${delineatorRuns.length} runs)`, posts],
  [`pole feet (${POLE_SETBACK_M} m out)`, poles],
] as const) {
  const offs = placedOff.get(points)!;
  console.log(
    `  ${label.padEnd(30)} ${String(offs.length).padStart(5)} points against the drawn top: highest ${fmt(Math.max(...offs))}, ` +
      `p50 ${fmt(pct(offs, 0.5))}, lowest ${fmt(Math.min(...offs))}`,
  );
}
