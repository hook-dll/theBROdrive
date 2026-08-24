#!/usr/bin/env node
/**
 * tools/lowpoly-fit.mjs
 * Derives the `scale` numbers the low-poly pack's catalogue entries carry
 * (src/vehicle/carmodels.ts), and prints what each body then measures.
 *
 * The pack is drawn chunky — 2.81 m wide car bodies on 5.0-6.1 m of length — so a
 * uniform scale cannot match a real car in both directions. Each body is therefore
 * fitted by FOOTPRINT AREA to the vehicle it is meant to be:
 *
 *     scale = sqrt((targetL * targetW) / (rawL * rawW))
 *
 * which splits the mismatch between the two axes instead of paying all of it in
 * width (what fitting length alone did: a 2.53 m wide saloon).
 *
 * Raw sizes are measured exactly the way the game measures them: the pack node's
 * own bounds unioned with its NON-DRIVEN wheel siblings, which ride as body
 * geometry (see the "extra axles" note in render/carmodel.ts).
 *
 * Usage: node tools/lowpoly-fit.mjs
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** Target footprint per body, metres: [length, width]. */
const TARGETS = {
  'Monster Truck': [4.6, 2.3],
  SUV: [4.4, 2.05],
  Pickup: [5.0, 2.0],
  Hatchback: [3.6, 1.7],
  Sedan: [4.3, 1.85],
  Muscle: [4.7, 1.9],
  'Muscle 2': [4.7, 1.9],
  Van: [4.9, 1.95],
  Ambulance: [5.4, 2.1],
  Truck: [6.5, 2.45],
  'Truck with trailer': [14.0, 2.5],
  Bus: [10.8, 2.5],
  Firetruck: [7.8, 2.5],
  Limousine: [6.5, 1.9],
  'Police Sedan': [4.3, 1.85],
  'Police SUV': [4.4, 2.05],
  'Police Muscle': [4.7, 1.9],
  'Police Sports': [4.2, 1.8],
  Roadster: [3.9, 1.72],
  Sports: [4.2, 1.8],
  Taxi: [4.3, 1.85],
};

const PACK = 'public/models/lowpoly-pack/vehicles.glb';
const buf = readFileSync(PACK);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const pack = (await new Promise((res, rej) => new GLTFLoader().parse(ab, '', res, rej))).scene;
pack.updateMatrixWorld(true);

/** The name three.js gives a glTF node (see packName in render/carmodel.ts). */
const packName = (n) => n.replace(/\s/g, '_').replace(/[[\].:/]/g, '');
const box = (o) => new THREE.Box3().setFromObject(o, true);

for (const [node, [targetL, targetW]] of Object.entries(TARGETS)) {
  const body = pack.getObjectByName(packName(node));
  if (!body) throw new Error(`${PACK} has no node "${node}"`);

  const bounds = box(body);
  const prefix = packName(`${node} wheel `);
  const driven = new Set(
    ['front left', 'front right', 'rear left', 'rear right'].map((s) =>
      packName(`${node} wheel ${s}`),
    ),
  );
  for (const sibling of body.parent?.children ?? []) {
    if (sibling.name.startsWith(prefix) && !driven.has(sibling.name)) {
      bounds.union(box(sibling));
    }
  }

  const raw = bounds.getSize(new THREE.Vector3());
  const scale = Math.sqrt((targetL * targetW) / (raw.z * raw.x));
  console.log(
    `${node.padEnd(20)} scale ${scale.toFixed(3)}   ` +
      `L${(raw.z * scale).toFixed(2).padStart(6)} ` +
      `W${(raw.x * scale).toFixed(2).padStart(5)} ` +
      `H${(raw.y * scale).toFixed(2).padStart(5)}   ` +
      `(raw L${raw.z.toFixed(2)} W${raw.x.toFixed(2)} H${raw.y.toFixed(2)})`,
  );
}
