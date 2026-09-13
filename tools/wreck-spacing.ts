#!/usr/bin/env npx tsx
/**
 * tools/wreck-spacing.ts
 *
 * Measures how far apart the bodies in a roadside wreck field stand — and whether any of
 * them stands inside the building — over every wreck POI of several seeds, using the REAL
 * layout (`layOutWreckField` in world/poi.ts), the REAL measured car footprints and the
 * REAL road the field is strung along.
 *
 * The first bug this exists for: each body used to draw its own arclength and lateral
 * offset independently, so nothing stopped two 4.6 m cars landing a metre apart — and a
 * static shell carries a solid box collider, so they were found standing inside one
 * another. Independent draws in a 16 x 12 m window overlap most of the time once there
 * are three of them; the numbers below are that rate against the rejection-sampled
 * layout's.
 *
 * The second: the building at a stop stands on the POI's OWN anchor, so the rejection
 * layout — which knew about other bodies and nothing else — laid the field through its
 * walls. Its own 219 container stops put a body inside the building's footprint in 62.1%
 * of them, the deepest 2.53 m in — and at a stop that rolls the roadworthy find, the body
 * inside the wall is the CAR. The layout now takes the building as `WreckKeepOut`, and
 * this bench holds both properties.
 *
 * A pair "overlaps" when the distance between their centres is less than the sum of
 * their circumscribed footprint radii — the conservative test, true at any yaw. A body is
 * "inside the building" when its centre is nearer than its radius to the building's
 * footprint, which is placed and sized here exactly as `buildVariantPoi` does it, tilt
 * ignored because it does not move a footprint in XZ.
 *
 *   npx tsx tools/wreck-spacing.ts [seed ...]
 *
 * Nothing here is part of the game bundle.
 */
import { installAssetShim } from './assetshim';
import { carModelMeasure, preloadCarModels } from '../src/render/carmodel';
import {
  POI_SPACING,
  faceRoadYaw,
  layOutWreckField,
  poiAt,
  type WreckKeepOut,
  type WreckSlot,
} from '../src/world/poi';
import { createVariantInstance, variantDef } from '../src/world/poivariantbuild';
import { Road } from '../src/world/road';
import { CAR_MODELS } from '../src/vehicle/carmodels';
import { hash01, pick } from '../src/core/rng';

// Loaders are constructed lazily inside render/carmodel.ts, so installing the shim
// here — after this module's imports have run — still precedes every asset fetch.
installAssetShim();
await preloadCarModels();

/** What shipped before the layout pass: two independent draws per body. */
const OLD_S_SPREAD = 16;
const OLD_LAT_SPREAD = 12;

interface Placed {
  readonly radius: number;
  readonly sDelta: number;
  readonly latDelta: number;
}

/** A body that has been put on the road, which is what a building can be tested against. */
interface WorldPlaced extends Placed {
  readonly x: number;
  readonly z: number;
}

function oldLayout(variantSeed: number): Placed[] {
  const count = 1 + Math.floor(hash01(variantSeed, 10) * 3);
  const placed: Placed[] = [];
  for (let w = 0; w < count; w++) {
    const def = pick(CAR_MODELS, variantSeed, w, 10);
    const half = carModelMeasure(def.id).halfExtents;
    placed.push({
      radius: Math.hypot(half[0], half[2]),
      sDelta: (hash01(variantSeed, w, 11) - 0.5) * OLD_S_SPREAD,
      latDelta: (hash01(variantSeed, w, 12) - 0.5) * OLD_LAT_SPREAD,
    });
  }
  return placed;
}

/**
 * Distance from a body's centre to the building's oriented footprint, minus the body's
 * radius: negative means the body is standing inside the building.
 *
 * The inverse of `rotateXZ` in world/poi.ts, which is the convention the whole placement
 * shares: local (x, z) maps to world (c·x + s·z, -s·x + c·z).
 */
function buildingGap(site: WreckKeepOut, x: number, z: number, radius: number): number {
  const c = Math.cos(site.yaw);
  const s = Math.sin(site.yaw);
  const dx = x - site.x;
  const dz = z - site.z;
  const lx = c * dx - s * dz;
  const lz = s * dx + c * dz;
  return (
    Math.hypot(
      Math.max(Math.abs(lx) - site.halfX, 0),
      Math.max(Math.abs(lz) - site.halfZ, 0),
    ) - radius
  );
}

interface Stats {
  fields: number;
  pairs: number;
  overlappingPairs: number;
  fieldsWithOverlap: number;
  worstOverlapM: number;
  worstGapM: number;
}

function measure(fields: readonly (readonly Placed[])[]): Stats {
  const stats: Stats = {
    fields: 0,
    pairs: 0,
    overlappingPairs: 0,
    fieldsWithOverlap: 0,
    worstOverlapM: 0,
    worstGapM: Infinity,
  };
  for (const field of fields) {
    stats.fields++;
    let fieldOverlapped = false;
    for (let i = 0; i < field.length; i++) {
      for (let j = i + 1; j < field.length; j++) {
        const a = field[i]!;
        const b = field[j]!;
        const gap =
          Math.hypot(a.sDelta - b.sDelta, a.latDelta - b.latDelta) - a.radius - b.radius;
        stats.pairs++;
        if (gap < stats.worstGapM) stats.worstGapM = gap;
        if (gap < 0) {
          stats.overlappingPairs++;
          fieldOverlapped = true;
          stats.worstOverlapM = Math.max(stats.worstOverlapM, -gap);
        }
      }
    }
    if (fieldOverlapped) stats.fieldsWithOverlap++;
  }
  if (stats.pairs === 0) stats.worstGapM = 0;
  return stats;
}

interface BuildingStats {
  fields: number;
  fieldsWithBodyInside: number;
  worstPenetrationM: number;
}

function measureBuilding(
  fields: readonly (readonly WorldPlaced[])[],
  sites: readonly WreckKeepOut[],
): BuildingStats {
  const stats: BuildingStats = { fields: 0, fieldsWithBodyInside: 0, worstPenetrationM: 0 };
  for (let f = 0; f < fields.length; f++) {
    const site = sites[f]!;
    stats.fields++;
    let inside = false;
    for (const body of fields[f]!) {
      const gap = buildingGap(site, body.x, body.z, body.radius);
      if (gap < 0) {
        inside = true;
        stats.worstPenetrationM = Math.max(stats.worstPenetrationM, -gap);
      }
    }
    if (inside) stats.fieldsWithBodyInside++;
  }
  return stats;
}

const seeds = process.argv.slice(2).map(Number);
const SEEDS = seeds.length > 0 ? seeds : [1, 7, 42, 1337, 0x5eed, 987654321];
/** POI slots probed per seed; slot 1 is the first stop out of the house. */
const SLOTS = 600;

const oldFields: Placed[][] = [];
/** Rejection sampling with no building term: what shipped before this change. */
const blindFields: WorldPlaced[][] = [];
/** The shipped layout: rejection sampling plus the building's keep-out. */
const afterFields: WorldPlaced[][] = [];
const sites: WreckKeepOut[] = [];

for (const seed of SEEDS) {
  const road = new Road(seed);
  for (let index = 1; index <= SLOTS; index++) {
    const poi = poiAt(seed >>> 0, index);
    // The car field is granted to the container category now, so that is where a
    // wreck layout is actually built.
    if (poi === null || variantDef(poi.variant).category !== 'container') continue;

    const instance = createVariantInstance(poi.variant);
    const centre = road.offsetPoint(poi.s, poi.lateral);
    const building: WreckKeepOut = {
      x: centre.x,
      z: centre.z,
      yaw: faceRoadYaw(road.sampleAt(poi.s).heading, poi.lateral, poi.variantSeed),
      // The measured bounds of everything above ground, which CONTAIN the merged solid
      // the collider is cut from — roofs widen the bounds and are excluded from the
      // trimesh — so a body that clears these clears the wall the player hits.
      halfX: instance.halfExtentX,
      halfZ: instance.halfExtentZ,
    };
    sites.push(building);

    const inWorld = (slots: readonly WreckSlot[]): WorldPlaced[] =>
      slots.map((slot) => {
        const point = road.offsetPoint(poi.s + slot.sDelta, poi.lateral + slot.latDelta);
        return {
          radius: slot.radius,
          sDelta: slot.sDelta,
          latDelta: slot.latDelta,
          x: point.x,
          z: point.z,
        };
      });

    oldFields.push(oldLayout(poi.variantSeed));
    blindFields.push(inWorld(layOutWreckField(poi, road)));
    afterFields.push(inWorld(layOutWreckField(poi, road, building)));
  }
}

const before = measure(oldFields);
const blind = measure(blindFields);
const after = measure(afterFields);
const blindBuilding = measureBuilding(blindFields, sites);
const afterBuilding = measureBuilding(afterFields, sites);

console.log(
  `${SEEDS.length} seeds x ${SLOTS} slots (${(SLOTS * POI_SPACING) / 1000} km each): ` +
    `${before.fields} wreck fields, ${before.pairs} body pairs`,
);
console.log('');
console.log('layout      fields with overlap   overlapping pairs   worst overlap   tightest gap');
for (const [label, stats] of [
  ['before', before],
  ['blind', blind],
  ['after', after],
] as const) {
  const fieldPct = ((100 * stats.fieldsWithOverlap) / Math.max(1, stats.fields)).toFixed(1);
  const pairPct = ((100 * stats.overlappingPairs) / Math.max(1, stats.pairs)).toFixed(1);
  console.log(
    `${label.padEnd(11)} ${`${stats.fieldsWithOverlap} (${fieldPct}%)`.padStart(19)} ` +
      `${`${stats.overlappingPairs} (${pairPct}%)`.padStart(19)} ` +
      `${`${stats.worstOverlapM.toFixed(2)} m`.padStart(15)} ` +
      `${`${stats.worstGapM.toFixed(2)} m`.padStart(14)}`,
  );
}
console.log('');
console.log('layout      fields with a body inside the building   worst penetration');
for (const [label, stats] of [
  ['blind', blindBuilding],
  ['after', afterBuilding],
] as const) {
  const pct = ((100 * stats.fieldsWithBodyInside) / Math.max(1, stats.fields)).toFixed(1);
  console.log(
    `${label.padEnd(11)} ${`${stats.fieldsWithBodyInside} (${pct}%)`.padStart(35)} ` +
      `${`${stats.worstPenetrationM.toFixed(2)} m`.padStart(19)}`,
  );
}
console.log('');

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}: ${detail}`);
}

// The bug was real and common, not a rare roll: state it, so a future change that
// reintroduces independent draws is measured against a number rather than a memory.
check(
  'the old layout overlapped in at least a fifth of its fields',
  before.fieldsWithOverlap / Math.max(1, before.fields) >= 0.2,
  `${before.fieldsWithOverlap}/${before.fields} fields, worst ${before.worstOverlapM.toFixed(2)} m deep`,
);
check(
  'no body overlaps another anywhere',
  after.overlappingPairs === 0,
  `${after.overlappingPairs} overlapping pairs in ${after.pairs}`,
);
// Footprint radii are circumscribed, so touching circles still leave real space
// between two bodies; the walking gap is what makes a field enterable on foot.
check(
  'every pair keeps a walking gap',
  after.worstGapM >= 1,
  `tightest ${after.worstGapM.toFixed(2)} m between footprints`,
);
// And the same two ways of stating the building, because the layout's keep-out is a
// rectangle in road coordinates while the building is a rectangle in the world: the bug
// once, and the property the keep-out has to hold everywhere now.
check(
  'the blind layout ran bodies through the building in at least a fifth of its fields',
  blindBuilding.fieldsWithBodyInside / Math.max(1, blindBuilding.fields) >= 0.2,
  `${blindBuilding.fieldsWithBodyInside}/${blindBuilding.fields} fields, worst ` +
    `${blindBuilding.worstPenetrationM.toFixed(2)} m deep`,
);
check(
  'no body stands inside the building anywhere',
  afterBuilding.fieldsWithBodyInside === 0,
  `${afterBuilding.fieldsWithBodyInside} bodies inside in ${afterBuilding.fields} fields`,
);

console.log(failures === 0 ? 'all checks passed' : `${failures} CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
