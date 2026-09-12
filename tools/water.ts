/**
 * The lakes: how often the desert actually offers one, whether what comes out is a lake
 * rather than a puddle or a flood, and whether it keeps its bargain about vanishing.
 *
 * There is nothing here about terrain damage, rim gradients or the road corridor, and
 * that absence is the point. An earlier version dug the basin into `Terrain.relief`,
 * which is collided ground shared with the tile worker, and needed six interlocking
 * checks to prove it had not broken the world. This one reads the terrain and writes
 * nothing, so the only thing that can be wrong is a picture.
 *
 * Run with `bun tools/water.ts [seed]`.
 */

import * as THREE from 'three';

import { WorldOrigin } from '../src/world/origin';
import { Road } from '../src/world/road';
import { RoadDistance } from '../src/world/roaddistance';
import { Terrain } from '../src/world/terrain';
import type { DesertTileGenerationContext } from '../src/world/deserttiledata';
import { LakeWater, waterPaletteAt } from '../src/render/lakewater';
import { desertPaletteAt } from '../src/world/gradient';

const SEED = Number(process.argv[2] ?? 1337) >>> 0;
const L = LakeWater.lattice;
/** Sites searched. Each is a full window of terrain samples, so this is the slow part. */
const SITES_SEARCHED = 14;

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(52)} ${detail}`);
}

const road = new Road(SEED);
const terrain = new Terrain(SEED, road);
const context: DesertTileGenerationContext = {
  seed: SEED,
  road,
  terrain,
  roadDistance: new RoadDistance(road),
};
const scene = new THREE.Scene();
const origin = new WorldOrigin();
const water = new LakeWater(scene, context, origin);
const root = scene.children[0] as THREE.Group;

console.log(
  `lakes: seed ${SEED}, ${water.sites.length} sites attempted over ${(road.length / 1000).toFixed(0)} km, ` +
    `window ${L.reach * 2} m at ${L.step} m`,
);

// --- 1. The world is untouched ----------------------------------------------
// A second Terrain from the same seed, which no LakeWater has ever been constructed
// against. If a lake had a terrain term, these would diverge.
const virginTerrain = new Terrain(SEED, new Road(SEED));
let worstDrift = 0;
const firstCentre = road.offsetPoint(water.sites[0]!.s, water.sites[0]!.lateral);
for (let i = 0; i < 4000; i++) {
  const angle = (i / 4000) * Math.PI * 2;
  const r = (((i * 37) % 100) / 100) * L.reach * 1.5;
  const x = firstCentre.x + Math.cos(angle) * r;
  const z = firstCentre.z + Math.sin(angle) * r;
  const drift = Math.abs(virginTerrain.heightAt(x, z) - terrain.heightAt(x, z));
  if (drift > worstDrift) worstDrift = drift;
}
check(
  'the terrain is identical with and without the lakes',
  worstDrift === 0,
  `worst drift ${worstDrift} m over 4000 points across a site`,
);

// --- 2. Rarity ---------------------------------------------------------------
const schedule = water.sites.slice(0, 24);
let minGap = Number.POSITIVE_INFINITY;
let maxGap = 0;
for (let i = 1; i < schedule.length; i++) {
  const gap = schedule[i]!.s - schedule[i - 1]!.s;
  if (gap < minGap) minGap = gap;
  if (gap > maxGap) maxGap = gap;
}
check(
  'a lake is attempted every 200-300 km and no oftener',
  minGap >= 200_000 && maxGap <= 300_000,
  `gaps ${(minGap / 1000).toFixed(0)}-${(maxGap / 1000).toFixed(0)} km over ${schedule.length} sites`,
);
const leftSides = schedule.filter((site) => site.lateral < 0).length;
check(
  'both sides of the road are used',
  leftSides > 2 && leftSides < schedule.length - 2,
  `${leftSides} left of travel, ${schedule.length - leftSides} right`,
);

// --- 3. What the desert offers ----------------------------------------------
interface Found {
  readonly index: number;
  readonly area: number;
  readonly span: number;
  readonly depth: number;
  readonly shore: number;
  readonly fringe: number;
  readonly triangles: number;
  readonly touchedEdge: number;
}
const found: Found[] = [];
let dry = 0;
let worstSliceMs = 0;
let worstSliceStage = 'none';
let worstSlices = 0;
for (let i = 0; i < SITES_SEARCHED; i++) {
  water.beginSiteForTest(water.sites[i]!);
  let slices = 0;
  for (;;) {
    const stage = water.phaseName;
    const started = performance.now();
    const done = water.advanceForTest();
    const elapsed = performance.now() - started;
    slices++;
    if (elapsed > worstSliceMs) {
      worstSliceMs = elapsed;
      worstSliceStage = stage;
    }
    if (done) break;
  }
  if (slices > worstSlices) worstSlices = slices;
  if (!water.ready) {
    dry++;
    continue;
  }

  const mask = water.wetMask;
  let wet = 0;
  let minIx = L.verts;
  let maxIx = -1;
  let minIz = L.verts;
  let maxIz = -1;
  let touchedEdge = 0;
  for (let ix = 0; ix < L.verts; ix++) {
    for (let iz = 0; iz < L.verts; iz++) {
      if (mask[ix * L.verts + iz] === 0) continue;
      wet++;
      if (ix === 0 || iz === 0 || ix === L.cells || iz === L.cells) touchedEdge++;
      if (ix < minIx) minIx = ix;
      if (ix > maxIx) maxIx = ix;
      if (iz < minIz) minIz = iz;
      if (iz > maxIz) maxIz = iz;
    }
  }
  found.push({
    index: i,
    area: wet * L.step * L.step,
    span: Math.max(maxIx - minIx, maxIz - minIz) * L.step,
    depth: water.waterLevel - water.floorLevel,
    shore: water.shorelineCells,
    fringe: water.fringeCount,
    triangles: water.triangleCount,
    touchedEdge,
  });
}

const hitRate = found.length / SITES_SEARCHED;
console.log(
  `  ${found.length} of ${SITES_SEARCHED} sites held a lake; the rest were open ground.`,
);
check(
  'the desert offers a lake often enough to be worth the schedule',
  found.length >= 3,
  `${(hitRate * 100).toFixed(0)}% of sites, about one lake per ${(250 / Math.max(hitRate, 0.01)).toFixed(0)} km`,
);
const worst = <K extends keyof Found>(key: K): number =>
  found.reduce((lowest, f) => Math.min(lowest, f[key] as number), Number.POSITIVE_INFINITY);
check(
  'what it offers is a lake, not a puddle',
  worst('area') >= L.minArea && worst('depth') >= L.minDepth,
  `smallest ${Math.round(worst('area'))} m2 and ${worst('depth').toFixed(1)} m deep, floor of ${L.minArea} m2 and ${L.minDepth} m`,
);
check(
  'the far shore is inside the window, so no lake ends in a straight line',
  found.every((f) => f.touchedEdge === 0),
  `${found.reduce((n, f) => n + f.touchedEdge, 0)} wet cells on a window edge across ${found.length} lakes`,
);
check(
  'the sheet reads as a lake at the distance it is seen from',
  worst('span') > 100,
  `narrowest ${worst('span').toFixed(0)} m across`,
);
check(
  'no single slice breaks the streaming budget',
  worstSliceMs < 3,
  `${worstSliceMs.toFixed(2)} ms worst slice (stage: ${worstSliceStage}), ${worstSlices} slices a site, budget 3 ms a frame`,
);
check(
  'the water is one small draw',
  found.every((f) => f.triangles > 200 && f.triangles < L.cells * L.cells * 2),
  `${worst('triangles')}-${found.reduce((n, f) => Math.max(n, f.triangles), 0)} triangles of ${L.cells * L.cells * 2} in the full window`,
);

// The survey above ends on whatever site came last, which is usually a dry one — and a
// dry window leaves the instanced meshes holding the previous lake's fringe while the
// water level has moved on. Re-establish a site that actually held water, so the two
// describe the same lake.
const wetSite = water.sites[found[found.length - 1]!.index]!;
water.beginSiteForTest(wetSite);
while (!water.advanceForTest());

// --- 4. The fringe follows the waterline --------------------------------------
check(
  'the shoreline the fringe is planted on exists',
  worst('shore') > 40,
  `fewest ${worst('shore')} shoreline cells`,
);
const instanced = root.children.filter(
  (child): child is THREE.InstancedMesh => (child as THREE.InstancedMesh).isInstancedMesh,
);
const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();
const mask = water.wetMask;
let drowned = 0;
let planted = 0;
let farFromWater = 0;
for (const mesh of instanced) {
  for (let i = 0; i < mesh.count; i++) {
    planted++;
    mesh.getMatrixAt(i, matrix);
    position.setFromMatrixPosition(matrix);
    if (position.y < water.waterLevel - 0.001) drowned++;
    // Exactly, against the wet cells themselves rather than through the chamfer field
    // the runtime fade uses: this check is about where the fringe stands, and an
    // approximate distance transform would blur the answer by its own error.
    let nearest = Number.POSITIVE_INFINITY;
    for (let vi = 0; vi < mask.length; vi++) {
      if (mask[vi] === 0) continue;
      const cx = -L.reach + ((vi / L.verts) | 0) * L.step;
      const cz = -L.reach + (vi % L.verts) * L.step;
      const d = Math.hypot(cx - position.x, cz - position.z);
      if (d < nearest) nearest = d;
    }
    // An instance sits on a shoreline cell, whose nearest wet cell is one lattice step
    // away at most, plus up to 4 m of wander. That is the whole budget.
    if (nearest > L.step + 4.5) farFromWater++;
  }
}
check(
  'the lake is ringed with grass and a few trees',
  instanced.length === 3 && worst('fringe') > 150,
  `${planted} instances over ${instanced.length} draws at the last lake, fewest ${worst('fringe')}`,
);
check(
  'nothing in the fringe grows out of the water',
  drowned === 0,
  `${drowned} of ${planted} below the water line`,
);
check(
  'the fringe hugs the waterline rather than the window',
  farFromWater === 0,
  `${farFromWater} of ${planted} further than ${(L.step + 4.5).toFixed(1)} m from water`,
);

// --- 5. The approach bargain ---------------------------------------------------
const scheduler = {
  tryRun: (_frame: number, _tag: string, work: () => void) => {
    work();
    return true;
  },
};
const centre = road.offsetPoint(wetSite.s, wetSite.lateral);
const roadPoint = road.sampleAt(wetSite.s);
// Aim the walk at the WATER, not at the window's centre. A lake sits wherever the hollow
// was, so a line from the road through the window centre can miss it entirely — which is
// how this check first reported the water never coming within four metres of a driver who
// was heading straight for it.
const wetMask = water.wetMask;
let wetSum = 0;
let wetX = 0;
let wetZ = 0;
for (let vi = 0; vi < wetMask.length; vi++) {
  if (wetMask[vi] === 0) continue;
  wetSum++;
  wetX += centre.x - L.reach + ((vi / L.verts) | 0) * L.step;
  wetZ += centre.z - L.reach + (vi % L.verts) * L.step;
}
const targetX = wetX / wetSum;
const targetZ = wetZ / wetSum;
const toRoadX = roadPoint.x - targetX;
const toRoadZ = roadPoint.z - targetZ;
const span = Math.hypot(toRoadX, toRoadZ);
/** A point `out` metres from the water's centre along the line to the road. */
const approach = (out: number): { x: number; z: number } => ({
  x: targetX + (toRoadX / span) * out,
  z: targetZ + (toRoadZ / span) * out,
});
/** Opacity with the eye where a driver's actually is: on the ground, 1.6 m up. */
const opacityAt = (out: number): number => {
  const p = approach(out);
  const eyeY = terrain.heightAt(p.x, p.z) + 1.6;
  for (let f = 0; f < 600; f++) {
    water.update(p.x, eyeY, p.z, wetSite.s, f + 1, scheduler as never, 0.016);
    if (water.ready) break;
  }
  water.update(p.x, eyeY, p.z, wetSite.s, 9000, scheduler as never, 0.016);
  return water.currentOpacity;
};
const far = opacityAt(L.reach + 120);
// Walk in along the bearing a driver arrives on until the baked waterline distance says
// the shore is under a wheel. A radial test would be wrong here by as much as the lake
// is irregular, which is the whole reason the fade uses a distance field.
let atShoreOut = 0;
let waterline = Number.POSITIVE_INFINITY;
for (let out = L.reach + 120; out >= -L.reach; out -= 1) {
  const p = approach(out);
  const edge = water.waterlineDistance(p.x, p.z);
  if (edge <= L.vanishGone * 0.4) {
    atShoreOut = out;
    waterline = edge;
    break;
  }
}
const atShore = opacityAt(atShoreOut);
const backAway = opacityAt(L.reach + 120);
check(
  'the water is fully there on the approach',
  far > 0.99,
  `opacity ${far.toFixed(3)} at ${L.reach + 120} m from the window centre`,
);
check(
  'it is gone by the time you could put a wheel in it',
  atShore === 0,
  `opacity ${atShore.toFixed(3)} at ${atShoreOut} m out, ${waterline.toFixed(1)} m from water`,
);
check(
  'and it comes back when you pull away',
  backAway > 0.99,
  `opacity ${backAway.toFixed(3)} after retreating; the fade is a function of position, not a latch`,
);
check(
  'the fade is abrupt, not a long dissolve',
  L.vanishFull - L.vanishGone <= 20,
  `full water at ${L.vanishFull} m from the waterline, none at ${L.vanishGone} m`,
);

// --- 6. The water reads against whatever colour the sand has got to ------------
// `desertPaletteAt` walks the sand's hue right around the wheel over the length of the
// road, so a fixed water colour sinks into the ground at one mileage and fights it at
// another. Sampled across a full cycle, the water must stay both distinct in hue and
// darker in value than the sand beside it.
let worstHueGap = 1;
let worstValueGap = 1;
const sandHsl = { h: 0, s: 0, l: 0 };
const waterHsl = { h: 0, s: 0, l: 0 };
for (let km = 0; km <= 40_000; km += 500) {
  const sand = new THREE.Color(desertPaletteAt(km * 1000).sand).getHSL(sandHsl);
  const deep = waterPaletteAt(km * 1000).deep.getHSL(waterHsl);
  const raw = Math.abs(sand.h - deep.h);
  const hueGap = Math.min(raw, 1 - raw);
  if (hueGap < worstHueGap) worstHueGap = hueGap;
  if (sand.l - deep.l < worstValueGap) worstValueGap = sand.l - deep.l;
}
check(
  // Not opposition — separation. Water is pinned blue and only slides off the sand when
  // the sand itself goes blue, so the guarantee is a minimum gap, not a half turn.
  'the water never takes the colour of the sand it sits in',
  worstHueGap >= 0.135 && worstValueGap > 0.2,
  `closest hue ${worstHueGap.toFixed(2)} turns apart, least value gap ${worstValueGap.toFixed(2)}, over a full palette cycle`,
);
// The hollow does not stop at the shoreline: ground outside the pool can lie below the
// water's level, and an eye there sits UNDER a transparent sheet that then fills the
// screen with turquoise. Seen in the real game before this rule existed.
const farPoint = approach(L.reach + 120);
for (let f = 0; f < 600 && !water.ready; f++) {
  water.update(farPoint.x, water.waterLevel + 20, farPoint.z, wetSite.s, f + 1, scheduler as never, 0.016);
}
water.update(farPoint.x, water.waterLevel - 1, farPoint.z, wetSite.s, 9001, scheduler as never, 0.016);
const submerged = water.currentOpacity;
water.update(farPoint.x, water.waterLevel + 20, farPoint.z, wetSite.s, 9002, scheduler as never, 0.016);
const above = water.currentOpacity;
check(
  'the surface is only drawn to someone standing above it',
  submerged === 0 && above > 0.99,
  `opacity ${submerged.toFixed(3)} with the eye under the water, ${above.toFixed(3)} above it`,
);

water.dispose();
console.log(failures === 0 ? '\nall checks pass' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
