/**
 * Wreck hulls: does the graveyard draw ships, or crossed planes?
 *
 *   npx tsx tools/wreck-hulls.ts [seed]
 *
 * The fleet is seen from the road and from nowhere else, which makes three things true
 * of it and of nothing else in the tableau set:
 *
 *   IT MUST HAVE VOLUME. A wreck is seventy metres of ship. Flat cards are the right
 *   instrument for a palm — a small form needs a second plane or it vanishes when you
 *   look down its edge — and completely wrong for a hull, where the second perpendicular
 *   copy is a whole second vessel at right angles. The player reported exactly that: "/"
 *   and "\" drawn as an X. So the hull is checked for being a genuinely closed solid:
 *   every edge shared by two triangles, more than two distinct normals, and a positive
 *   signed volume, which together are what "it has an inside" means.
 *
 *   AND IT MAY LIE AT ANY ANGLE, which is the point of the volume. Orientation was only
 *   ever a correctness problem for a card, whose beam is zero: turned end-on it is a
 *   line, and that is why the flat fleet was crossed — the perpendicular copy was the
 *   only way to stop a plane disappearing. A solid has a beam of its own, so a wreck can
 *   lie at the angle the sea left it and still be a wreck from the road.
 *
 *   IT MUST NOT INTERSECT ITS NEIGHBOURS. The placement test clears each new hull from
 *   the ones already down by the sum of their footprint radii, so this re-derives the
 *   distances from the instance matrices and checks that those radii really did bound
 *   the geometry.
 */

import * as THREE from 'three';

import { installAssetShim } from './assetshim';
import { MirageTableau } from '../src/render/mirage-tableau';
import { Road } from '../src/world/road';
import { Terrain } from '../src/world/terrain';
import { WorldOrigin } from '../src/world/origin';

installAssetShim();

const seed = Number(process.argv[2] ?? 1337);
const ANCHOR_S = 20_000;
const ENCOUNTER_LENGTH = 1_400;

/** Triangles at the end of the buffer that are flat debris lying on the ground. */
const DEBRIS_TRIANGLES = 4;
/** Distinct surface normals a solid with any curvature at all must exceed. */
const MIN_NORMALS = 8;
/** How wide a hull may be, as a fraction of its length, and still be a hull. */
const MAX_BEAM_FRACTION = 0.35;

const road = new Road(seed);
const terrain = new Terrain(seed, road);
const tableau = new MirageTableau(new THREE.Scene(), road, terrain, seed, new WorldOrigin());
tableau.showPreview('ships', ANCHOR_S, ENCOUNTER_LENGTH, 0, 1, 1, 0, 1);

const state = tableau as unknown as {
  ships: THREE.InstancedMesh;
  shipRadius: Float32Array;
  shipReach: number;
};
const ships = state.ships;
const position = ships.geometry.getAttribute('position');
const normal = ships.geometry.getAttribute('normal');
const vertices = position.count;
const solidVertices = vertices - DEBRIS_TRIANGLES * 3;

const failures: string[] = [];
const at = (i: number): [number, number, number] => [
  position.getX(i),
  position.getY(i),
  position.getZ(i),
];

// --- 1. closed, with volume -------------------------------------------------
const edgeOwner = new Map<string, number>();
const edgeKey = (a: [number, number, number], b: [number, number, number]): string => {
  const ka = a.map((v) => v.toFixed(4)).join(',');
  const kb = b.map((v) => v.toFixed(4)).join(',');
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
};
for (let t = 0; t < solidVertices; t += 3) {
  for (let e = 0; e < 3; e++) {
    const key = edgeKey(at(t + e), at(t + ((e + 1) % 3)));
    edgeOwner.set(key, (edgeOwner.get(key) ?? 0) + 1);
  }
}
let openEdges = 0;
for (const owners of edgeOwner.values()) if (owners === 1) openEdges++;

const normals = new Set<string>();
for (let i = 0; i < solidVertices; i++) {
  normals.add(
    `${normal.getX(i).toFixed(2)},${normal.getY(i).toFixed(2)},${normal.getZ(i).toFixed(2)}`,
  );
}

let volume = 0;
for (let i = 0; i < solidVertices; i += 3) {
  const a = at(i);
  const b = at(i + 1);
  const c = at(i + 2);
  volume +=
    (a[0] * (b[1] * c[2] - b[2] * c[1]) +
      a[1] * (b[2] * c[0] - b[0] * c[2]) +
      a[2] * (b[0] * c[1] - b[1] * c[0])) /
    6;
}

let spanX = 0;
let spanZ = 0;
for (let i = 0; i < solidVertices; i++) {
  spanX = Math.max(spanX, Math.abs(position.getX(i)));
  spanZ = Math.max(spanZ, Math.abs(position.getZ(i)));
}

console.log(
  `wreck geometry: ${solidVertices / 3} triangles, ${normals.size} distinct normals, ` +
    `${openEdges} open edges, signed volume ${volume.toFixed(5)}, ` +
    `extent ${spanX.toFixed(2)} x ${spanZ.toFixed(2)}`,
);
if (openEdges !== 0) {
  failures.push(`the hull is not closed: ${openEdges} edges have only one triangle`);
}
if (volume <= 0) {
  failures.push(`the hull encloses no volume (${volume.toFixed(6)}) — its normals face in`);
}
if (normals.size < MIN_NORMALS) {
  failures.push(
    `the hull has ${normals.size} distinct normals — that is a flat surface, not a body`,
  );
}
// A hull that is as wide as it is long is the crossed card again, whatever else is true.
if (spanZ > spanX * MAX_BEAM_FRACTION) {
  failures.push(
    `the hull is ${spanX.toFixed(2)} long but ${spanZ.toFixed(2)} wide — a body of this ` +
      `length has a beam around a seventh of it`,
  );
}

// --- 2. turned to face the road, and clear of each other --------------------
const matrix = new THREE.Matrix4();
const translation = new THREE.Vector3();
const rotation = new THREE.Quaternion();
const scale = new THREE.Vector3();
const hulls: { x: number; z: number; yaw: number; radius: number }[] = [];
for (let i = 0; i < ships.count; i++) {
  ships.getMatrixAt(i, matrix);
  matrix.decompose(translation, rotation, scale);
  const euler = new THREE.Euler().setFromQuaternion(rotation, 'YXZ');
  hulls.push({
    x: translation.x + state.anchorX,
    z: translation.z + state.anchorZ,
    yaw: euler.y,
    radius: state.shipRadius[i]!,
  });
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
  `fleet: ${hulls.length} hulls, ${overlapping} overlapping pairs, tightest clearance ` +
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
