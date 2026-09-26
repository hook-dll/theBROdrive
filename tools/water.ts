/**
 * The lakes and ponds: how often the country offers one, whether what comes out is a lake
 * rather than a puddle or a flood, and whether it keeps its bargain about vanishing.
 *
 * There is nothing here about terrain damage, rim gradients or the road corridor, and
 * that absence is the point. An earlier version dug the basin into `Terrain.relief`,
 * which is collided ground shared with the tile worker, and needed six interlocking
 * checks to prove it had not broken the world. The basin is dug into the ground now
 * (`world/lakes.ts`) and the schedule is the only thing that decides where one is: an
 * authored lake by the homestead, a rolled lake every thirty to fifty kilometres, and a
 * pond in every village, which is what a driver actually passes.
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
import { newCoverSample } from '../src/world/landcover';
import { villagesAlongRoad } from '../src/world/village';

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

// --- 1. The hollow is real ---------------------------------------------------
// THE BASIN IS DUG (world/lakes.ts): it is in the collided ground, in the mesh and in
// the tile worker, which is the whole difference between water in a bowl and a sheet
// of paint over dunes. An earlier design read the terrain and wrote nothing, and what
// the player got was a broad two-metre dip filled to the brim — "покрашенный песок".
//
// Measured against a second Terrain built from the same seed, so the shape is also
// proved deterministic: the worker builds its own instance and must agree exactly.
const virginTerrain = new Terrain(SEED, new Road(SEED));
const firstSite = water.sites[0]!;
const firstCentre = road.offsetPoint(firstSite.s, firstSite.lateral);
let worstDrift = 0;
let deepest = 0;
for (let i = 0; i < 4000; i++) {
  const angle = (i / 4000) * Math.PI * 2;
  const r = (((i * 37) % 100) / 100) * L.reach * 1.5;
  const x = firstCentre.x + Math.cos(angle) * r;
  const z = firstCentre.z + Math.sin(angle) * r;
  const drift = Math.abs(virginTerrain.heightAt(x, z) - terrain.heightAt(x, z));
  if (drift > worstDrift) worstDrift = drift;
}
// The rim is what closes the basin, so the floor is measured against the crest of it
// rather than against the open desert, which is tens of metres of dune away.
const centreY = terrain.heightAt(firstCentre.x, firstCentre.z, firstSite.s);
for (let i = 0; i < 360; i++) {
  const angle = (i / 360) * Math.PI * 2;
  const x = firstCentre.x + Math.cos(angle) * (firstSite.radius + 24);
  const z = firstCentre.z + Math.sin(angle) * (firstSite.radius + 24);
  deepest = Math.max(deepest, terrain.heightAt(x, z, firstSite.s) - centreY);
}
check(
  'the ground under a lake is a bowl, and the same bowl every time',
  worstDrift === 0 && deepest >= 4,
  `${deepest.toFixed(1)} m from the floor up to the rim, ${worstDrift} m of drift between two builds`,
);
check(
  'the first lake belongs to the opening drive',
  firstSite.s < 3_000 && Math.abs(firstSite.lateral) < 900,
  `site 0 at ${(firstSite.s / 1000).toFixed(1)} km, ${Math.abs(firstSite.lateral).toFixed(0)} m off the road`,
);

// --- 2. Rarity ---------------------------------------------------------------
// The schedule is TWO things now, and only one of them is rare. This is the country's
// requirement, not the desert's: a LAKE is rare here — 8-21 of over a hectare per
// 1000 km2, two per 100 km2 even in lake-rich Тверская — so `world/lakes.ts` rolls one
// every 32-54 km (its `MIN_GAP_M` 32 km plus a 22 km range), and no oftener. A POND is
// not rare at all: it belongs to a village and arrives on the village's schedule, which
// is why it can sit a kilometre from a lake. Measuring both together is what turned the
// old "every 200-300 km" assertion into noise the moment the ponds joined the list.
const villagePonds = new Set(
  villagesAlongRoad(SEED, road.length).map((village) => `${village.pond.s}|${village.pond.lateral}`),
);
const lakes = water.sites.filter((site) => !villagePonds.has(`${site.s}|${site.lateral}`));
const schedule = lakes.slice(1, 25);
let minGap = Number.POSITIVE_INFINITY;
let maxGap = 0;
for (let i = 1; i < schedule.length; i++) {
  const gap = schedule[i]!.s - schedule[i - 1]!.s;
  if (gap < minGap) minGap = gap;
  if (gap > maxGap) maxGap = gap;
}
check(
  'a lake is attempted every 30-55 km and no oftener',
  minGap >= 30_000 && maxGap <= 55_000,
  `gaps ${(minGap / 1000).toFixed(0)}-${(maxGap / 1000).toFixed(0)} km over ${schedule.length} lakes`,
);
const leftSides = schedule.filter((site) => site.lateral < 0).length;
check(
  'both sides of the road are used',
  leftSides > 2 && leftSides < schedule.length - 2,
  `${leftSides} left of travel, ${schedule.length - leftSides} right`,
);
// What a driver actually passes are the PONDS: a lake every thirty to fifty kilometres
// plus a pond in every village, which is 6-12 dug basins per 60 km (research:
// docs/research-2026-09-26-landscape.md, 5). A village without its pond is a hole in the
// country, and a basin every couple of kilometres is a lake district.
const villages = villagesAlongRoad(SEED, road.length);
const basinsPerSixty = (water.sites.length * 60_000) / road.length;
check(
  'every village has its pond, and the country is not a lake district',
  villagePonds.size === villages.length && basinsPerSixty >= 6 && basinsPerSixty <= 12,
  `${villagePonds.size} ponds for ${villages.length} villages, ${basinsPerSixty.toFixed(1)} basins per 60 km`,
);

// --- 3. What the ground offers -----------------------------------------------
// The basin is DUG (world/lakes.ts): a site is not a candidate the terrain may refuse,
// it is a hole in the ground with a lip level of its own, so every site the schedule
// names has to hold water. The desert could only ask the dune field for a hollow, and
// answered its schedule with dry windows; the country digs, and the schedule is the only
// thing that decides where a lake is. A site that comes up dry means the terrain and the
// water have stopped agreeing — the one failure this file exists to catch.
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
  if (!water.ready) continue;

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
check(
  'every site the schedule names is a dug basin that holds water',
  found.length === SITES_SEARCHED,
  `${found.length} of ${SITES_SEARCHED} sites held water (${(hitRate * 100).toFixed(0)}%); ` +
    `a dry one would mean the ground and the water disagree about the basin`,
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
// the shore is under a wheel: the water must still be there. It was a mirage in the
// desert and vanished on the approach; a pond on the plain does not.
let atShoreOut = 0;
let waterline = Number.POSITIVE_INFINITY;
for (let out = L.reach + 120; out >= -L.reach; out -= 1) {
  const p = approach(out);
  const edge = water.waterlineDistance(p.x, p.z);
  if (edge <= 1) {
    atShoreOut = out;
    waterline = edge;
    break;
  }
}
const atShore = opacityAt(atShoreOut);
check(
  'the water is fully there on the approach',
  far > 0.99,
  `opacity ${far.toFixed(3)} at ${L.reach + 120} m from the window centre`,
);
check(
  'and still there at the shore',
  atShore > 0.99,
  `opacity ${atShore.toFixed(3)} at ${atShoreOut} m out, ${waterline.toFixed(1)} m from water`,
);

// --- 6. The water reads against the ground it lies in --------------------------
// The desert walked the sand's hue right around the wheel, so a fixed water colour sank
// into the ground at one mileage and fought it at another, and the guarantee was a minimum
// gap measured over a full palette cycle. The country's ground is not a cycle: the loose
// materials are one constant earth (`COUNTRY_PALETTE`), and the colours the tiles paint
// come out of the cover sampler — a summer meadow, ripe wheat, a wood's floor, wet clay.
//
// So the ground is MEASURED, where the basins are: the real cover colour on each basin's
// shore, against the water palette that basin's own arclength produces. The old form of
// this check also compared a LINEAR-space lightness against an sRGB one, which is not a
// measurement of anything — the two numbers were not in the same space.
//
// WHAT THE COUNTRY'S GUARANTEE IS. The desert needed both hue and value to separate the
// water from sand that could come close on both. The country's ground is green, straw and
// brown and its water is pinned blue (world/render/lakewater.ts `WATER_HUE`), so the
// separation the eye actually gets is the hue, and the value is the backup for a bank that
// ever goes blue. Either one clearing its gap is the water reading as water, which is why
// the requirement is a disjunction and not two hurdles.
const shoreColour = new THREE.Color();
const shoreSrgb = new THREE.Vector3();
const groundScratch = newCoverSample();
const shoreHsl = { h: 0, s: 0, l: 0 };
const deepHsl = { h: 0, s: 0, l: 0 };
let minHue = 1;
let minValue = 1;
let brightestGround = 0;
let tightest = 1;
let closestBank = '';
/** Shores sampled per basin, and the rings the cover is read on. */
const SHORE_AZIMUTHS = 12;
for (let i = 0; i < Math.min(water.sites.length, 12); i++) {
  const site = water.sites[i]!;
  const centre = road.offsetPoint(site.s, site.lateral);
  const deep = new THREE.Color(waterPaletteAt(site.s).deep.getHex());
  deep.getHSL(deepHsl, THREE.SRGBColorSpace);
  deep.getRGB(shoreSrgb, THREE.SRGBColorSpace);
  const waterLuma = 0.2126 * shoreSrgb.x + 0.7152 * shoreSrgb.y + 0.0722 * shoreSrgb.z;
  for (let a = 0; a < SHORE_AZIMUTHS; a++) {
    const angle = (a / SHORE_AZIMUTHS) * Math.PI * 2;
    for (const ring of [site.radius + 30, site.radius * 1.7]) {
      const x = centre.x + Math.cos(angle) * ring;
      const z = centre.z + Math.sin(angle) * ring;
      const cover = terrain.cover.sample(x, z, 1e6, groundScratch);
      // The cover sample is linear rgb — its own space — and both sides are read in the
      // one the screen uses, so the numbers compared are the same quantity.
      shoreColour.setRGB(cover.r, cover.g, cover.b, THREE.LinearSRGBColorSpace);
      shoreColour.getHSL(shoreHsl, THREE.SRGBColorSpace);
      shoreColour.getRGB(shoreSrgb, THREE.SRGBColorSpace);
      const groundLuma = 0.2126 * shoreSrgb.x + 0.7152 * shoreSrgb.y + 0.0722 * shoreSrgb.z;
      if (groundLuma > brightestGround) brightestGround = groundLuma;
      const raw = Math.abs(shoreHsl.h - deepHsl.h);
      const hueGap = Math.min(raw, 1 - raw);
      const valueGap = groundLuma - waterLuma;
      if (hueGap < minHue) minHue = hueGap;
      if (valueGap < minValue) minValue = valueGap;
      // Whichever of the two is doing the work at the bank where the water comes closest
      // to reading as ground; the report names it.
      if (Math.min(hueGap, valueGap) < tightest) {
        tightest = Math.min(hueGap, valueGap);
        closestBank =
          `tightest at s ${(site.s / 1000).toFixed(1)} km, ${ring.toFixed(0)} m out: ` +
          `bank luminance ${groundLuma.toFixed(2)} against water ${waterLuma.toFixed(2)}`;
      }
    }
  }
}
check(
  'the water never takes the colour of the ground it lies in',
  minHue >= 0.135 || minValue > 0.2,
  `closest hue ${minHue.toFixed(2)} turns apart, least value gap ${minValue.toFixed(2)}, ` +
    `bank up to ${brightestGround.toFixed(2)} in relative luminance; ${closestBank}`,
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
