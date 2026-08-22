#!/usr/bin/env node
/**
 * tools/fbx-bbox.mjs
 *
 * Minimal binary-FBX reader used only to measure model extents (for picking
 * catalogue scales). It parses the FBX 7.x binary container, walks the "Objects"
 * and "Connections" sections, applies Model local transforms (Lcl
 * Translation/Rotation/Scaling, default XYZ Euler) up the parent chain, and prints
 * the world-space bounding box of every Geometry's vertices.
 *
 * This is intentionally a MEASUREMENT aid, not a loader: it ignores materials,
 * normals, UVs, pivots, and geometric transforms. For the DeJunes models the
 * transforms are near-identity, so the result matches the OBJ exports.
 *
 * Usage: node tools/fbx-bbox.mjs <file.fbx> [...]
 */
import { inflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Binary FBX tokenizer
// ---------------------------------------------------------------------------

const HEADER = 27; // 21-byte magic + 0x1A00 marker + uint32 version

function isNullRecord(buf, off) {
  if (off + 13 > buf.length) return false;
  for (let i = 0; i < 13; i++) if (buf[off + i] !== 0) return false;
  return true;
}

function readProperties(buf, off, count) {
  const values = [];
  for (let i = 0; i < count; i++) {
    const type = String.fromCharCode(buf[off]);
    off += 1;
    switch (type) {
      case 'Y': values.push(buf.readInt16LE(off)); off += 2; break;
      case 'C': values.push(buf[off] !== 0); off += 1; break;
      case 'I': values.push(buf.readInt32LE(off)); off += 4; break;
      case 'F': values.push(buf.readFloatLE(off)); off += 4; break;
      case 'D': values.push(buf.readDoubleLE(off)); off += 8; break;
      case 'L': values.push(Number(buf.readBigInt64LE(off))); off += 8; break;
      case 'f': {
        const n = buf.readUInt32LE(off); off += 4;
        const enc = buf.readUInt32LE(off); off += 4;
        const data = readArrayBytes(buf, off, n, 4, enc);
        off = data.offset;
        const arr = new Array(n);
        for (let k = 0; k < n; k++) arr[k] = data.buf.readFloatLE(k * 4);
        values.push(arr);
        break;
      }
      case 'd': {
        const n = buf.readUInt32LE(off); off += 4;
        const enc = buf.readUInt32LE(off); off += 4;
        const data = readArrayBytes(buf, off, n, 8, enc);
        off = data.offset;
        const arr = new Array(n);
        for (let k = 0; k < n; k++) arr[k] = data.buf.readDoubleLE(k * 8);
        values.push(arr);
        break;
      }
      case 'l': {
        const n = buf.readUInt32LE(off); off += 4;
        const enc = buf.readUInt32LE(off); off += 4;
        off = readArrayBytes(buf, off, n, 8, enc).offset;
        values.push(null);
        break;
      }
      case 'i': {
        const n = buf.readUInt32LE(off); off += 4;
        const enc = buf.readUInt32LE(off); off += 4;
        const data = readArrayBytes(buf, off, n, 4, enc);
        off = data.offset;
        const arr = new Array(n);
        for (let k = 0; k < n; k++) arr[k] = data.buf.readInt32LE(k * 4);
        values.push(arr);
        break;
      }
      case 'b': {
        const n = buf.readUInt32LE(off); off += 4;
        const enc = buf.readUInt32LE(off); off += 4;
        off = readArrayBytes(buf, off, n, 1, enc).offset;
        values.push(null);
        break;
      }
      case 'S': {
        const n = buf.readUInt32LE(off); off += 4;
        values.push(buf.toString('utf8', off, off + n)); off += n; break;
      }
      case 'R': {
        const n = buf.readUInt32LE(off); off += 4;
        off += n; values.push(null); break;
      }
      default:
        throw new Error(`unknown FBX property type '${type}' @ ${off}`);
    }
  }
  return { values, offset: off };
}

/**
 * Return the raw bytes of a typed array property (raw or deflate-compressed) and
 * the offset just past it. `elemSize` is the byte size of one element.
 */
function readArrayBytes(buf, off, count, elemSize, encoding) {
  const byteLen = count * elemSize;
  if (encoding === 1) {
    const compressedLen = buf.readUInt32LE(off); off += 4;
    const inflated = inflateSync(buf.subarray(off, off + compressedLen));
    return { buf: inflated, offset: off + compressedLen };
  }
  const data = buf.subarray(off, off + byteLen);
  return { buf: data, offset: off + byteLen };
}

/** Read one node record; returns { node, offset } where offset is after the node. */
function readNode(buf, off) {
  const endOffset = buf.readUInt32LE(off); off += 4;
  const numProps = buf.readUInt32LE(off); off += 4;
  const propListLen = buf.readUInt32LE(off); off += 4; // eslint-disable-line no-unused-vars
  const nameLen = buf[off]; off += 1;
  const name = buf.toString('utf8', off, off + nameLen); off += nameLen;
  const { values, offset: afterProps } = readProperties(buf, off, numProps);
  off = afterProps;

  const children = [];
  while (off + 13 <= endOffset) {
    if (isNullRecord(buf, off)) break;
    const r = readNode(buf, off);
    children.push(r.node);
    off = r.offset;
  }
  return { node: { name, values, children }, offset: endOffset };
}

function parse(buf) {
  const top = [];
  let off = HEADER;
  while (off + 13 <= buf.length) {
    if (buf.readUInt32LE(off) === 0) break; // footer region
    const r = readNode(buf, off);
    top.push(r.node);
    off = r.offset;
  }
  return top;
}

// ---------------------------------------------------------------------------
// Extraction: objects + connections
// ---------------------------------------------------------------------------

function findChild(node, name) {
  return node.children.find((c) => c.name === name);
}

function objId(v) {
  return typeof v === 'bigint' ? Number(v) : v;
}

/** Extract { geometries: Map<id,Float64Array>, models: Map<id,{...}> } */
function extract(top) {
  const geometries = new Map(); // id -> flat xyz Float64Array
  const models = new Map(); // id -> { name, translation, rotation, scaling }
  const parentOf = new Map(); // childId -> parentId

  for (const section of top) {
    if (section.name === 'Objects') {
      for (const obj of section.children) {
        const id = objId(obj.values[0]);
        if (obj.name === 'Geometry') {
          const vNode = findChild(obj, 'Vertices');
          if (vNode && vNode.values[0] && Array.isArray(vNode.values[0])) {
            geometries.set(id, Float64Array.from(vNode.values[0]));
          }
        } else if (obj.name === 'Model') {
          const props70 = findChild(obj, 'Properties70');
          const out = {
            name: obj.values[1],
            translation: [0, 0, 0],
            rotation: [0, 0, 0],
            scaling: [1, 1, 1],
          };
          if (props70) {
            for (const p of props70.children) {
              const key = p.values[0];
              const val = p.values[4];
              if (!Array.isArray(val) || val.length < 3) continue;
              if (key === 'Lcl Translation') out.translation = val;
              else if (key === 'Lcl Rotation') out.rotation = val;
              else if (key === 'Lcl Scaling') out.scaling = val;
            }
          }
          models.set(id, out);
        }
      }
    } else if (section.name === 'Connections') {
      for (const c of section.children) {
        if (c.values[0] === 'OO' && c.values[1] !== 0) {
          parentOf.set(objId(c.values[1]), objId(c.values[2]));
        }
      }
    }
  }

  return { geometries, models, parentOf };
}

// ---------------------------------------------------------------------------
// Transform math
// ---------------------------------------------------------------------------

function mat4Identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; // row-major
}

function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[r * 4 + k] * b[k * 4 + c];
      o[r * 4 + c] = s;
    }
  }
  return o;
}

function eulerXYZDeg(deg) {
  const x = (deg[0] * Math.PI) / 180;
  const y = (deg[1] * Math.PI) / 180;
  const z = (deg[2] * Math.PI) / 180;
  const cx = Math.cos(x), sx = Math.sin(x);
  const cy = Math.cos(y), sy = Math.sin(y);
  const cz = Math.cos(z), sz = Math.sin(z);
  const rx = [1, 0, 0, 0, 0, cx, -sx, 0, 0, sx, cx, 0, 0, 0, 0, 1];
  const ry = [cy, 0, sy, 0, 0, 1, 0, 0, -sy, 0, cy, 0, 0, 0, 0, 1];
  const rz = [cz, -sz, 0, 0, sz, cz, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  // R = Rz * Ry * Rx (column-vector, x applied first)
  return mul(rz, mul(ry, rx));
}

function localTransform(model) {
  const t = mat4Identity();
  t[12] = model.translation[0];
  t[13] = model.translation[1];
  t[14] = model.translation[2];
  const r = eulerXYZDeg(model.rotation);
  const s = mat4Identity();
  s[0] = model.scaling[0];
  s[5] = model.scaling[1];
  s[10] = model.scaling[2];
  return mul(t, mul(r, s)); // world = T * R * S
}

function apply(m, v) {
  const x = v[0], y = v[1], z = v[2];
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

// ---------------------------------------------------------------------------
// World-space bbox
// ---------------------------------------------------------------------------

function worldTransform(id, models, parentOf, cache) {
  if (cache.has(id)) return cache.get(id);
  const model = models.get(id);
  if (!model) {
    cache.set(id, mat4Identity());
    return cache.get(id);
  }
  const local = localTransform(model);
  const parentId = parentOf.get(id) || 0;
  const parent = parentId && parentId !== id
    ? worldTransform(parentId, models, parentOf, cache)
    : mat4Identity();
  const world = mul(parent, local);
  cache.set(id, world);
  return world;
}

function measure(file) {
  const buf = readFileSync(file);
  const top = parse(buf);
  const { geometries, models, parentOf } = extract(top);

  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  const cache = new Map();
  let measured = 0;

  if (process.env.FBX_DEBUG) {
    for (const [k, v] of geometries) {
      console.error('GEO', k, 'len', v.length, 'first3', v.slice(0, 3));
    }
    for (const [k, v] of models) {
      console.error('MOD', k, JSON.stringify(v));
    }
    for (const [k, v] of parentOf) console.error('PARENT', k, '->', v);
  }

  for (const [modelId, model] of models) {
    const geometryId = [...geometries.keys()].find(
      (gid) => parentOf.get(gid) === modelId,
    );
    if (geometryId === undefined) continue;
    const verts = geometries.get(geometryId);
    const world = worldTransform(modelId, models, parentOf, cache);
    for (let i = 0; i < verts.length; i += 3) {
      const p = apply(world, [verts[i], verts[i + 1], verts[i + 2]]);
      for (let c = 0; c < 3; c++) {
        if (p[c] < min[c]) min[c] = p[c];
        if (p[c] > max[c]) max[c] = p[c];
      }
    }
    measured++;
  }

  return { min, max, models: models.size, geometries: geometries.size, measured };
}

for (const file of process.argv.slice(2)) {
  try {
    const { min, max, models, geometries, measured } = measure(file);
    const size = [0, 1, 2].map((c) => max[c] - min[c]);
    console.log(
      `${file}  X ${size[0].toFixed(3)}  Y ${size[1].toFixed(3)}  Z ${size[2].toFixed(3)}` +
        `  (min ${min.map((v) => v.toFixed(2)).join(',')})` +
        `  (max ${max.map((v) => v.toFixed(2)).join(',')})` +
        `  [${models} models, ${geometries} geoms]`,
    );
  } catch (e) {
    console.error(`${file}: ERROR: ${e.message}`);
  }
}
