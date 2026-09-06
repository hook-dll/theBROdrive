#!/usr/bin/env node
/**
 * tools/rim-split.mjs
 *
 * Gives a normalized car's wheels a painted steel rim instead of one black disc.
 *
 * Every source pack in this catalogue draws rim and tyre as one mesh under one
 * material, so a wheel that keeps the source's material arrives as a black circle
 * where the Soviet pack shows a steel centre. Nothing in the file says which
 * triangles are the rim — only the geometry does, so the split is radial: a
 * triangle belongs to the rim when EVERY one of its corners lies inside a fraction
 * of the wheel radius, measured from the axle.
 *
 * "Every corner" rather than the centroid is the whole trick. A tread block that
 * straddles the boundary has one corner inside it; painting such a triangle grey
 * throws a spike of rim colour out across the tyre, which is the saw-blade edge an
 * earlier centroid test produced.
 *
 * The wheel's leftover triangles are forced onto `Tyres` as well, so no wheel can
 * keep a body material and get repainted with the coachwork.
 *
 * Usage: node tools/rim-split.mjs <in.glb> [out.glb]
 */

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

/**
 * Rim fraction of the wheel radius.
 *
 * Measured against the Soviet pack's own wheels: the painted disc reaches about
 * two thirds of the way out and the tyre is the black band around it. Cut it much
 * tighter and only a silver stud is left in the middle of a black circle, which is
 * a wheel you cannot see at all from across the road.
 */
const RIM_FRACTION = 0.65;

const [, , input, output = input] = process.argv;
if (!input) {
  console.error('usage: node tools/rim-split.mjs <in.glb> [out.glb]');
  process.exit(1);
}

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const document = await io.read(input);
const root = document.getRoot();

function findOrCreate(name, build) {
  const existing = root.listMaterials().find((material) => material.getName() === name);
  return existing ?? build();
}

// The name carries `wheel` deliberately: the runtime's `solid-paint` repaint skips
// any material that looks like a wheel, so a red car keeps grey rims.
const rim = findOrCreate('wheel_rim', () =>
  document
    .createMaterial('wheel_rim')
    .setBaseColorFactor([0.3, 0.31, 0.32, 1])
    .setMetallicFactor(0.2)
    .setRoughnessFactor(0.5),
);
const tyre = findOrCreate('Tyres', () =>
  document
    .createMaterial('Tyres')
    .setBaseColorFactor([0.018, 0.02, 0.022, 1])
    .setMetallicFactor(0)
    .setRoughnessFactor(0.75),
);

let split = 0;
for (const node of root.listNodes()) {
  if (!/^wheel_(fl|fr|rl|rr)$/.test(node.getName())) continue;
  const mesh = node.getMesh();
  if (!mesh) continue;

  // The axle is the wheel's shortest extent; packs disagree on which axis carries
  // it, so it is measured rather than assumed.
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const primitive of mesh.listPrimitives()) {
    const position = primitive.getAttribute('POSITION');
    const point = [0, 0, 0];
    for (let i = 0; i < position.getCount(); i++) {
      position.getElement(i, point);
      for (let c = 0; c < 3; c++) {
        bounds.min[c] = Math.min(bounds.min[c], point[c]);
        bounds.max[c] = Math.max(bounds.max[c], point[c]);
      }
    }
  }
  const size = [0, 1, 2].map((c) => bounds.max[c] - bounds.min[c]);
  const centre = [0, 1, 2].map((c) => (bounds.min[c] + bounds.max[c]) / 2);
  const axle = size.indexOf(Math.min(...size));
  const face = [0, 1, 2].filter((c) => c !== axle);
  const limit = (Math.max(...size) / 2) * RIM_FRACTION;

  for (const primitive of mesh.listPrimitives()) {
    const position = primitive.getAttribute('POSITION');
    const indices = primitive.getIndices();
    const count = indices ? indices.getCount() : position.getCount();
    const point = [0, 0, 0];
    const radii = new Float32Array(position.getCount());
    for (let i = 0; i < position.getCount(); i++) {
      position.getElement(i, point);
      radii[i] = Math.hypot(point[face[0]] - centre[face[0]], point[face[1]] - centre[face[1]]);
    }

    const rimIndices = [];
    const tyreIndices = [];
    for (let i = 0; i < count; i += 3) {
      const triangle = [0, 1, 2].map((k) => (indices ? indices.getScalar(i + k) : i + k));
      const target = triangle.every((index) => radii[index] <= limit) ? rimIndices : tyreIndices;
      target.push(...triangle);
    }
    if (rimIndices.length === 0 || tyreIndices.length === 0) {
      primitive.setMaterial(tyre);
      continue;
    }

    const buffer = position.getBuffer();
    const rimPrimitive = primitive.clone().setMaterial(rim);
    rimPrimitive.setIndices(
      document.createAccessor().setType('SCALAR').setArray(new Uint32Array(rimIndices)).setBuffer(buffer),
    );
    primitive.setMaterial(tyre);
    primitive.setIndices(
      document.createAccessor().setType('SCALAR').setArray(new Uint32Array(tyreIndices)).setBuffer(buffer),
    );
    mesh.addPrimitive(rimPrimitive);
    split++;
  }
}

if (split === 0) {
  console.error(`${input}: no wheel primitive could be split into rim and tyre`);
  process.exit(1);
}
await io.write(output, document);
console.log(`${output}: ${split} wheel primitive(s) split at ${RIM_FRACTION} of the wheel radius`);
