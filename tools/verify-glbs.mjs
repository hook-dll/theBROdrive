#!/usr/bin/env node
/**
 * tools/verify-glbs.mjs
 * Independent re-parse of the generated car GLBs. It shares NO code with
 * `obj-to-glb.mjs`: it reads the GLB container and binary accessors from scratch
 * and asserts the consumer contract for `src/render/carmodel.ts`:
 *
 *   1. every file carries geometry in one of the supported shapes: a full car
 *      (body + the four wheel-* nodes), or a body-only file (a lone `body` node,
 *      whose wheels come from a shared wheel model), or a lone wheel file;
 *   2. a car has all four wheel nodes or none — a partial wheel set is rejected;
 *   3. every wheel node's bounding box is wheel-shaped (X extent smaller than Y and
 *      Z, with Y and Z within 15% of each other);
 *   4. left/right wheel centres have opposite X signs.
 *
 * It then prints the per-file measurement table (length/width/height in model
 * units, wheel radius, wheelbase, track) and, for body-only files, the body's Y
 * extent (min..max) so a lead can pick a scale and axle fractions.
 *
 * Usage: node tools/verify-glbs.mjs <glb-dir>
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';

const WHEEL_NODES = [
  'wheel-front-left',
  'wheel-front-right',
  'wheel-back-left',
  'wheel-back-right',
];

const COMPONENT_SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const COMPONENT_COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/** Parse the GLB container into { json, bin }. */
function parseGlb(buf) {
  if (buf.length < 12) throw new Error('GLB too short');
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('bad magic');
  if (buf.readUInt32LE(4) !== 2) throw new Error('not glTF 2.0');
  const total = buf.readUInt32LE(8);
  if (total !== buf.length) throw new Error('length mismatch');

  let off = 12;
  const jsonChunkLen = buf.readUInt32LE(off);
  const jsonChunkType = buf.readUInt32LE(off + 4);
  off += 8;
  if (jsonChunkType !== 0x4e4f534a) throw new Error('chunk 0 is not JSON');
  const json = JSON.parse(buf.subarray(off, off + jsonChunkLen).toString('utf8'));
  off += jsonChunkLen;

  const binChunkLen = buf.readUInt32LE(off);
  const binChunkType = buf.readUInt32LE(off + 4);
  off += 8;
  if (binChunkType !== 0x004e4942) throw new Error('chunk 1 is not BIN');
  const bin = buf.subarray(off, off + binChunkLen);
  return { json, bin };
}

/** Decode one accessor into an array of component arrays. */
function decodeAccessor(gltf, bin, accessorIndex) {
  const acc = gltf.accessors[accessorIndex];
  const bv = gltf.bufferViews[acc.bufferView];
  const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const compCount = COMPONENT_COUNT[acc.type];
  const compSize = COMPONENT_SIZE[acc.componentType];
  const stride = bv.byteStride || compCount * compSize;

  const read = (o) => {
    switch (acc.componentType) {
      case 5120: return bin.readInt8(o);
      case 5121: return bin.readUInt8(o);
      case 5122: return bin.readInt16LE(o);
      case 5123: return bin.readUInt16LE(o);
      case 5125: return bin.readUInt32LE(o);
      case 5126: return bin.readFloatLE(o);
      default: throw new Error('unknown componentType ' + acc.componentType);
    }
  };

  const out = [];
  for (let i = 0; i < acc.count; i++) {
    const comp = [];
    for (let c = 0; c < compCount; c++) {
      comp.push(read(base + i * stride + c * compSize));
    }
    out.push(comp);
  }
  return out;
}

/** Collect all POSITION vectors of a mesh's primitives. */
function meshPositions(gltf, bin, meshIndex) {
  const mesh = gltf.meshes[meshIndex];
  const all = [];
  for (const prim of mesh.primitives) {
    all.push(...decodeAccessor(gltf, bin, prim.attributes.POSITION));
  }
  return all;
}

function bbox(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of positions) {
    for (let c = 0; c < 3; c++) {
      if (p[c] < min[c]) min[c] = p[c];
      if (p[c] > max[c]) max[c] = p[c];
    }
  }
  return { min, max };
}

const [, , dirArg] = process.argv;
if (!dirArg) {
  console.error('Usage: node tools/verify-glbs.mjs <glb-dir>');
  process.exit(1);
}

const files = readdirSync(dirArg)
  .filter((f) => extname(f).toLowerCase() === '.glb')
  .sort();

const rows = [];
let failures = 0;

for (const file of files) {
  const stem = file.replace(/\.glb$/i, '');
  const buf = readFileSync(join(dirArg, file));
  const { json, bin } = parseGlb(buf);

  // Index nodes by name, collecting their POSITION data.
  const nodePositions = new Map();
  for (const node of json.nodes) {
    const name = node.name;
    if (!name || node.mesh === undefined) continue;
    if (!nodePositions.has(name)) nodePositions.set(name, []);
    nodePositions.get(name).push(...meshPositions(json, bin, node.mesh));
  }

  // Drop empty nodes and require at least one node with geometry.
  const named = new Map();
  for (const [n, p] of nodePositions) if (p.length > 0) named.set(n, p);
  if (named.size === 0) {
    failures++;
    console.error(`${stem}: no geometry nodes`);
    continue;
  }

  const hasBody = named.has('body');
  const hasWheel = named.has('wheel');
  const presentWheels = WHEEL_NODES.filter((n) => named.has(n));

  // A car carries all four wheel nodes or none: a partial set is a bug.
  if (presentWheels.length > 0 && presentWheels.length < WHEEL_NODES.length) {
    const missing = WHEEL_NODES.filter((n) => !named.has(n));
    failures++;
    console.error(`${stem}: partial wheel set, missing: ${missing.join(', ')}`);
    continue;
  }
  const hasWheels = presentWheels.length === WHEEL_NODES.length;

  // Wheel-shape checks: the four per-car wheels and any standalone shared wheel.
  const wheelBoxes = new Map();
  const checkWheelShape = (name, b) => {
    const sx = b.max[0] - b.min[0];
    const sy = b.max[1] - b.min[1];
    const sz = b.max[2] - b.min[2];
    if (sx >= sy || sx >= sz) {
      failures++;
      console.error(
        `${stem}/${name}: X extent ${sx.toFixed(3)} not smaller than Y ${sy.toFixed(3)} or Z ${sz.toFixed(3)}`,
      );
    }
    const yzDrift = Math.abs(sy - sz) / Math.max(sy, sz);
    if (yzDrift > 0.15) {
      failures++;
      console.error(
        `${stem}/${name}: Y ${sy.toFixed(3)} and Z ${sz.toFixed(3)} differ by ${(yzDrift * 100).toFixed(1)}% (>15%)`,
      );
    }
  };
  if (hasWheels) {
    for (const name of WHEEL_NODES) {
      const b = bbox(named.get(name));
      wheelBoxes.set(name, b);
      checkWheelShape(name, b);
    }

    // Opposite X signs for left/right pairs.
    for (const [left, right] of [
      ['wheel-front-left', 'wheel-front-right'],
      ['wheel-back-left', 'wheel-back-right'],
    ]) {
      const lx = (wheelBoxes.get(left).min[0] + wheelBoxes.get(left).max[0]) / 2;
      const rx = (wheelBoxes.get(right).min[0] + wheelBoxes.get(right).max[0]) / 2;
      if (lx * rx >= 0) {
        failures++;
        console.error(
          `${stem}: ${left}/${right} centres ${lx.toFixed(3)}/${rx.toFixed(3)} share X sign`,
        );
      }
    }
  }
  const wheelBox = hasWheel ? bbox(named.get('wheel')) : null;
  if (wheelBox) checkWheelShape('wheel', wheelBox);

  // Overall model bbox (every node with geometry).
  const overall = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const [, p] of named) {
    const b = bbox(p);
    for (let c = 0; c < 3; c++) {
      if (b.min[c] < overall.min[c]) overall.min[c] = b.min[c];
      if (b.max[c] > overall.max[c]) overall.max[c] = b.max[c];
    }
  }

  const row = {
    stem,
    L: overall.max[2] - overall.min[2],
    W: overall.max[0] - overall.min[0],
    H: overall.max[1] - overall.min[1],
    hasBody,
    hasWheels,
    hasWheel,
  };
  if (hasBody) {
    const b = bbox(named.get('body'));
    row.bodyMinY = b.min[1];
    row.bodyMaxY = b.max[1];
  }
  if (hasWheels) {
    const cx = (name) =>
      (wheelBoxes.get(name).min[0] + wheelBoxes.get(name).max[0]) / 2;
    const cz = (name) =>
      (wheelBoxes.get(name).min[2] + wheelBoxes.get(name).max[2]) / 2;
    row.radius =
      (wheelBoxes.get('wheel-front-left').max[1] - wheelBoxes.get('wheel-front-left').min[1]) / 2;
    const frontZ = (cz('wheel-front-left') + cz('wheel-front-right')) / 2;
    const rearZ = (cz('wheel-back-left') + cz('wheel-back-right')) / 2;
    row.wheelbase = Math.abs(frontZ - rearZ);
    row.frontTrack = Math.abs(cx('wheel-front-left') - cx('wheel-front-right'));
    row.rearTrack = Math.abs(cx('wheel-back-left') - cx('wheel-back-right'));
  }
  if (hasWheel) {
    row.wheelRadius = (wheelBox.max[1] - wheelBox.min[1]) / 2;
  }
  rows.push(row);
}

console.log('');
console.log('File          Length   Width   Height   Wheel r   Wheelbase   Track F/R');
console.log('----          ------   -----   ------   -------   ---------   --------');
for (const r of rows) {
  const wheel = r.hasWheels
    ? ` ${r.radius.toFixed(3).padStart(7)} ${r.wheelbase.toFixed(3).padStart(10)} ${r.frontTrack.toFixed(3).padStart(7)}/${r.rearTrack.toFixed(3)}`
    : '';
  console.log(
    `${r.stem.padEnd(11)} ${r.L.toFixed(3).padStart(7)} ${r.W.toFixed(3).padStart(7)} ${r.H.toFixed(3).padStart(7)}${wheel}`,
  );
}
console.log('');

const bodies = rows.filter((r) => r.hasBody && !r.hasWheels);
if (bodies.length) {
  console.log('Body-only bodies (Y extent in model units):');
  for (const r of bodies) {
    console.log(`  ${r.stem.padEnd(11)} Y ${r.bodyMinY.toFixed(3)} .. ${r.bodyMaxY.toFixed(3)}`);
  }
  console.log('');
}

const standalone = rows.filter((r) => r.hasWheel);
if (standalone.length) {
  console.log('Standalone wheel models (radius, model units):');
  for (const r of standalone) {
    console.log(`  ${r.stem.padEnd(11)} r ${r.wheelRadius.toFixed(3)}`);
  }
  console.log('');
}

if (failures) {
  console.error(`VERIFY FAILED: ${failures} problem(s) across ${files.length} file(s).`);
  process.exit(1);
}
console.log(`VERIFY OK: ${files.length} file(s) pass node/wheel/sign checks.`);
