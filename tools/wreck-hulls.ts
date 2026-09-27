/**
 * Wreck hulls: does the graveyard draw ships, or crossed planes?
 *
 *   npx tsx tools/wreck-hulls.ts [seed]
 *
 * The fleet is seen from the road and from nowhere else, which makes three things true
 * of it and of nothing else in the tableau set:
 *
 *   IT MUST HAVE VOLUME. A wreck is up to seventy metres of ship. Flat cards are the
 *   right instrument for a palm — a small form needs a second plane or it vanishes when
 *   you look down its edge — and completely wrong for a hull, where the second
 *   perpendicular copy is a whole second vessel at right angles. The player reported
 *   exactly that: "/" and "\" drawn as an X. So every ship form is checked for being
 *   made of genuinely closed solids: every edge shared by two triangles, more than a
 *   handful of distinct face directions, and a positive signed volume, which together
 *   are what "it has an inside" means.
 *
 *   IT MUST BE A SHIP'S SHAPE: long and narrow. A form as wide as it is long is the
 *   crossed card again, whatever else is true.
 *
 *   IT MUST NOT INTERSECT ITS NEIGHBOURS. The placement test clears each new hull from
 *   the ones already down by the sum of their footprint radii, so this re-derives the
 *   distances from the instance matrices and checks that those radii really did bound
 *   the geometry.
 */

import * as THREE from 'three';

import { installAssetShim } from './assetshim';
import { MirageTableau } from '../src/render/mirage-tableau';
import { MirageSchedule } from '../src/render/mirage-schedule';
import { SHIP_FORMS } from '../src/render/mirage-ships';
import { Road } from '../src/world/road';
import { Terrain } from '../src/world/terrain';
import { WorldOrigin } from '../src/world/origin';

installAssetShim();

const seed = Number(process.argv[2] ?? 1337);
const ANCHOR_S = 20_000;
const ENCOUNTER_LENGTH = 1_400;

/** Distinct face directions a solid with any curvature at all must exceed. */
const MIN_NORMALS = 8;
/** How wide a ship may be, rigging and all, as a fraction of its length, and still be a ship. */
const MAX_BEAM_FRACTION = 0.35;

const road = new Road(seed);
const terrain = new Terrain(seed, road);
const tableau = new MirageTableau(
  new THREE.Scene(), road, terrain, seed, new WorldOrigin(), new MirageSchedule(seed, road.length),
);
tableau.showPreview('ships', ANCHOR_S, ENCOUNTER_LENGTH, 0, 1, 1, 0, 1);

const state = tableau as unknown as {
  ships: readonly THREE.InstancedMesh[];
  shipReach: readonly number[];
  anchorX: number;
  anchorZ: number;
};

const failures: string[] = [];

// --- 1. closed, with volume, long and narrow --------------------------------
for (const [index, ships] of state.ships.entries()) {
  const name = SHIP_FORMS[index]!.name;
  const position = ships.geometry.getAttribute('position');
  const at = (i: number): THREE.Vector3 =>
    new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i));
  const edgeOwner = new Map<string, number>();
  // Rounded before keying, and -0 folded into 0: a lathe's seam is the same edge
  // whether its z came out as a hair above or a hair below zero.
  const edgeKey = (a: THREE.Vector3, b: THREE.Vector3): string => {
    const round = (v: number): string => (Math.round(v * 1e4) / 1e4 + 0).toFixed(4);
    const ka = a.toArray().map(round).join(',');
    const kb = b.toArray().map(round).join(',');
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  };
  const faces = new Set<string>();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  let volume = 0;
  for (let t = 0; t < position.count; t += 3) {
    const a = at(t);
    const b = at(t + 1);
    const c = at(t + 2);
    for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
      const key = edgeKey(p, q);
      edgeOwner.set(key, (edgeOwner.get(key) ?? 0) + 1);
    }
    const n = e1.subVectors(b, a).cross(e2.subVectors(c, a)).normalize();
    faces.add(`${n.x.toFixed(2)},${n.y.toFixed(2)},${n.z.toFixed(2)}`);
    volume += a.dot(new THREE.Vector3().crossVectors(b, c)) / 6;
  }
  let openEdges = 0;
  for (const owners of edgeOwner.values()) if (owners === 1) openEdges++;

  ships.geometry.computeBoundingBox();
  const box = ships.geometry.boundingBox!;
  const spanX = box.max.x - box.min.x;
  const spanZ = box.max.z - box.min.z;

  console.log(
    `${name}: ${position.count / 3} triangles, ${faces.size} face directions, ` +
      `${openEdges} open edges, signed volume ${volume.toFixed(1)} m3, ` +
      `extent ${spanX.toFixed(1)} x ${spanZ.toFixed(1)} m`,
  );
  if (openEdges !== 0) {
    failures.push(`${name} is not closed: ${openEdges} edges have only one triangle`);
  }
  if (volume <= 0) {
    failures.push(`${name} encloses no volume (${volume.toFixed(3)}) — its faces point in`);
  }
  if (faces.size < MIN_NORMALS) {
    failures.push(`${name} has ${faces.size} face directions — that is a flat surface, not a body`);
  }
  if (spanZ > spanX * MAX_BEAM_FRACTION) {
    failures.push(
      `${name} is ${spanX.toFixed(1)} long but ${spanZ.toFixed(1)} wide — not a ship's plan`,
    );
  }
}

// --- 2. clear of each other ------------------------------------------------
const matrix = new THREE.Matrix4();
const translation = new THREE.Vector3();
const rotation = new THREE.Quaternion();
const scale = new THREE.Vector3();
const hulls: { x: number; z: number; radius: number }[] = [];
for (const [index, ships] of state.ships.entries()) {
  for (let i = 0; i < ships.count; i++) {
    ships.getMatrixAt(i, matrix);
    matrix.decompose(translation, rotation, scale);
    hulls.push({
      x: translation.x + state.anchorX,
      z: translation.z + state.anchorZ,
      // Scaled uniformly, so the form reaches `shipReach` of the scale.
      radius: scale.x * state.shipReach[index]!,
    });
  }
}

let overlapping = 0;
let tightest = Infinity;
for (let i = 0; i < hulls.length; i++) {
  for (let j = i + 1; j < hulls.length; j++) {
    const distance = Math.hypot(hulls[j]!.x - hulls[i]!.x, hulls[j]!.z - hulls[i]!.z);
    const required = hulls[i]!.radius + hulls[j]!.radius;
    tightest = Math.min(tightest, distance - required);
    if (distance < required) overlapping++;
  }
}

console.log(
  `fleet: ${hulls.length} hulls (${state.ships.map((s, i) => `${s.count} ${SHIP_FORMS[i]!.name}`).join(', ')}), ` +
    `${overlapping} overlapping pairs, tightest clearance ` +
    `${tightest === Infinity ? 'n/a' : `${tightest.toFixed(1)} m`}`,
);
if (overlapping > 0) {
  failures.push(`${overlapping} pairs of hulls intersect`);
}

if (failures.length > 0) {
  for (const failure of failures) console.log(`  FAIL  ${failure}`);
  throw new Error(`${failures.length} wreck-hull checks failed`);
}
console.log('\nthe wrecks are closed solid bodies that never intersect each other');
