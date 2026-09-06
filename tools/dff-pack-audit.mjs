#!/usr/bin/env node
/**
 * Verify the normalized texture-free vehicle contract.
 *
 * Usage: node tools/dff-pack-audit.mjs [pack-dir] [--wheels-complete]
 *
 * `--wheels-complete` is for a pack whose wheel node already IS the complete
 * assembly (tyre, rim, hub, axle), so there are no separate `hub_*` nodes to
 * pair with it. The GTA SA pack needs them because its hub islands had to be
 * cut out of `Chassis`; a GTA V fragment authors the wheel as one object.
 */

globalThis.document = {
  createElementNS: () => ({
    set src(value) { this._src = value; },
    get src() { return this._src; },
    addEventListener() {},
    removeEventListener() {},
  }),
};
globalThis.self = globalThis;
globalThis.window = { innerWidth: 1, innerHeight: 1 };
globalThis.URL.createObjectURL ??= () => 'blob:stub';
globalThis.URL.revokeObjectURL ??= () => {};

import { readFileSync, readdirSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const args = process.argv.slice(2);
const wheelsComplete = args.includes('--wheels-complete');
const dir = args.find((arg) => !arg.startsWith('--')) ?? 'public/models/saas';
const expectedMaterials = new Set([
  'car_paint',
  'car_trim',
  'car_glass',
  'Headlights',
  'BrakeLights',
  'Tyres',
  // The rim, split off the tyre geometrically. Older exports (azlk2141) draw the
  // whole wheel as one dark material, so this one is allowed rather than demanded.
  'wheel_rim',
]);
const requiredNodes = [
  'headlights', 'taillights',
  'wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr',
  ...(wheelsComplete ? [] : ['hub_fl', 'hub_fr', 'hub_rl', 'hub_rr']),
];
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
let failures = 0;

function fail(file, message) {
  failures++;
  console.error(`${file}: ${message}`);
}

function materialNames(node) {
  const names = new Set();
  node.traverse((child) => {
    if (!child.isMesh) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) names.add(material.name);
  });
  return names;
}

function centreAndRadius(nodes) {
  const box = new THREE.Box3();
  for (const node of nodes) box.union(new THREE.Box3().setFromObject(node, true));
  const centre = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  return { centre, radius: Math.max(size.x, size.y, size.z) / 2 };
}
/**
 * Six times the signed volume of a node's triangles, in world space. Positive for
 * outward-facing winding, negative for a mirrored copy whose faces were left in
 * their source order.
 */
function signedVolume(node) {
  let total = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const cross = new THREE.Vector3();
  node.updateMatrixWorld(true);
  node.traverse((child) => {
    if (!child.isMesh) return;
    const geometry = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry;
    const position = geometry.attributes.position;
    for (let i = 0; i < position.count; i += 3) {
      a.fromBufferAttribute(position, i).applyMatrix4(child.matrixWorld);
      b.fromBufferAttribute(position, i + 1).applyMatrix4(child.matrixWorld);
      c.fromBufferAttribute(position, i + 2).applyMatrix4(child.matrixWorld);
      total += a.dot(cross.copy(b).cross(c));
    }
  });
  return total;
}


for (const file of readdirSync(dir).filter((name) => extname(name).toLowerCase() === '.glb').sort()) {
  const bytes = readFileSync(join(dir, file));
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
  if ((json.images?.length ?? 0) !== 0) fail(file, `contains ${json.images.length} images`);
  if ((json.textures?.length ?? 0) !== 0) fail(file, `contains ${json.textures.length} textures`);
  const declaredMaterials = new Set((json.materials ?? []).map((material) => material.name));
  const missingMaterials = [...expectedMaterials].filter(
    (name) => name !== 'wheel_rim' && !declaredMaterials.has(name),
  );
  const extraMaterials = [...declaredMaterials].filter((name) => !expectedMaterials.has(name));
  if (missingMaterials.length || extraMaterials.length) {
    fail(file, `materials missing=[${missingMaterials}] extra=[${extraMaterials}]`);
  }

  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const gltf = await new Promise((resolve, reject) => loader.parse(buffer, `${dir}/`, resolve, reject));
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);

  const nodes = new Map();
  for (const name of requiredNodes) {
    const node = scene.getObjectByName(name);
    if (!node) fail(file, `missing node ${name}`);
    else nodes.set(name, node);
  }
  scene.traverse((node) => {
    if (node.scale.x <= 0 || node.scale.y <= 0 || node.scale.z <= 0) {
      fail(file, `node ${node.name || '<unnamed>'} has non-positive scale`);
    }
  });
  if (nodes.size !== requiredNodes.length) continue;

  // `underbody` is only authored where the source DFF is an open shell, so it is
  // checked when present rather than demanded of every body.
  for (const [nodeName, materialName] of [
    ['headlights', 'Headlights'],
    ['taillights', 'BrakeLights'],
    ['underbody', 'car_trim'],
  ]) {
    const node = nodes.get(nodeName) ?? scene.getObjectByName(nodeName);
    if (!node) continue;
    const actual = materialNames(node);
    if (actual.size !== 1 || !actual.has(materialName)) {
      fail(file, `${nodeName} uses [${[...actual]}], expected ${materialName}`);
    }
  }

  const wheels = {};
  for (const key of ['fl', 'fr', 'rl', 'rr']) {
    const wheel = nodes.get(`wheel_${key}`);
    const hub = nodes.get(`hub_${key}`);
    const wheelMaterials = materialNames(wheel);
    const strays = [...wheelMaterials].filter((name) => name !== 'Tyres' && name !== 'wheel_rim');
    if (!wheelMaterials.has('Tyres') || strays.length) {
      fail(file, `wheel_${key} uses [${[...wheelMaterials]}], expected Tyres (+ wheel_rim)`);
    }
    wheels[key] = centreAndRadius(hub ? [wheel, hub] : [wheel]);
  }

  // Nose down +Z, the direction the game drives. A GTA body is authored facing the
  // other way, so an export that skipped the normalizer's half-turn reverses under
  // throttle and steers from the boot; the lamps are what say which end is which.
  const lampZ = (name) =>
    new THREE.Box3().setFromObject(nodes.get(name), true).getCenter(new THREE.Vector3()).z;
  if (lampZ('headlights') <= lampZ('taillights')) {
    fail(file, 'headlights sit behind the taillights: the body is back to front');
  }
  // Left wheels are turned, never mirrored. A mirrored copy keeps its source face
  // order, which inverts the winding and renders the assembly inside out; a closed
  // wheel's signed volume goes negative exactly when that has happened.
  for (const key of ['fl', 'fr', 'rl', 'rr']) {
    const volume = signedVolume(nodes.get(`wheel_${key}`));
    if (volume <= 0) {
      fail(file, `wheel_${key} is wound inside out (signed volume ${volume.toFixed(4)})`);
    }
  }

  // A blanking plate behind the grille, where the shell needed one: a GTA bonnet
  // hides a modelled engine this pack drops, so the gaps between the grille bars
  // can look straight through an empty body. Where a plate exists it has to be
  // INSIDE the shell — sticking out of the nose would read as a slab bolted to the
  // bumper, and sitting too far back leaves the empty bay visible again.
  const bulkhead = scene.getObjectByName('bulkhead');
  if (bulkhead) {
    const plate = new THREE.Box3().setFromObject(bulkhead, true);
    const shell = new THREE.Box3()
      .setFromObject(nodes.get('headlights'), true)
      .union(new THREE.Box3().setFromObject(scene.getObjectByName('paint'), true))
      .union(new THREE.Box3().setFromObject(scene.getObjectByName('trim'), true));
    if (!shell.containsBox(plate)) fail(file, 'bulkhead pokes out of the bodyshell');
    const noseThird = shell.min.z + (shell.max.z - shell.min.z) * (2 / 3);
    if (plate.getCenter(new THREE.Vector3()).z < noseThird) {
      fail(file, 'bulkhead sits too far back to close off the grille');
    }
  }

  const wheelbase = (
    Math.abs(wheels.fl.centre.z - wheels.rl.centre.z) +
    Math.abs(wheels.fr.centre.z - wheels.rr.centre.z)
  ) / 2;
  const frontTrack = Math.abs(wheels.fl.centre.x - wheels.fr.centre.x);
  const rearTrack = Math.abs(wheels.rl.centre.x - wheels.rr.centre.x);
  const radius = Object.values(wheels).reduce((sum, wheel) => sum + wheel.radius, 0) / 4;
  console.log(
    `${basename(file, '.glb').padEnd(18)} wheelbase=${wheelbase.toFixed(4)} ` +
    `track=${frontTrack.toFixed(4)}/${rearTrack.toFixed(4)} radius=${radius.toFixed(4)}`,
  );
}

if (failures) {
  console.error(`\n${failures} DFF contract failure(s)`);
  process.exit(1);
}
console.log('\nDFF pack contract OK');
