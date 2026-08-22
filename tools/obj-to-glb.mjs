#!/usr/bin/env node
/**
 * tools/obj-to-glb.mjs
 *
 * Converts OBJ/MTL packs into the GLB layout theBROdrive's car loader
 * (`src/render/carmodel.ts`) expects, writing a binary glTF 2.0 GLB (JSON chunk +
 * BIN chunk) by hand — no npm dependencies.
 *
 * The loader reads scene nodes by name:
 *   body, wheel-front-left, wheel-front-right, wheel-back-left, wheel-back-right
 * Each wheel node must contain exactly ONE wheel; the loader measures each wheel
 * node's own bounding box and uses its CENTRE as the suspension mount.
 *
 * Source objects are matched case-insensitively on their `o`/`g` name:
 *   frontleft -> wheel-front-left
 *   frontright -> wheel-front-right
 *   backwheels / rearwheels / back / rear -> merged rear wheels (see below)
 *   wheel (no front/back/rear) -> a single `wheel` node (shared wheel meshes)
 *   everything else -> body (all non-wheel objects merged into one `body` node)
 *
 * Rear wheels: many packs export both rear wheels as ONE merged object. The two
 * wheels are a mirror pair about X=0 and share no material boundary, so the merge
 * cannot be undone by name or by material — it is split GEOMETRICALLY by
 * partitioning each triangle on the sign of its centroid X (centroid < 0 -> left,
 * >= 0 -> right), putting exactly one wheel in each node.
 *
 * Material mapping:
 *   - `Kd` -> pbrMetallicRoughness.baseColorFactor (metallicFactor 0,
 *     roughnessFactor 0.6).
 *   - `map_Kd` -> a `baseColorTexture` referencing the PNG by URI (the file is
 *     copied next to the GLB; the URI is its basename). When any face carries
 *     `vt` texture coordinates, TEXCOORD_0 is emitted as `(u, 1 - v)`.
 *
 *     OBJ `vt` puts its origin at the BOTTOM-left of the image; glTF/three.js
 *     sample TEXCOORD_0 with the origin at the TOP-left, so V must be flipped
 *     on the way out. This was proven, not assumed, with a throwaway pixel-
 *     sampling check against `Wheel/wheel.png` (decoded with `zlib.inflateSync`,
 *     no deps): every one of the wheel sidewall's octagon faces agrees, via
 *     barycentric interpolation, that the disc's rotation-axis centre sits at
 *     raw OBJ uv (0.479, 0.593); the texture's bright-rim hub (its brightest-
 *     pixel centroid) sits at (0.487, 0.419). Passing V through un-flipped
 *     samples (0.479, 0.593) -- 0.174 off from the hub, landing in the black
 *     tyre band instead. Flipping samples (0.479, 1-0.593=0.407) -- 0.012 from
 *     the hub, i.e. dead centre on the bright rim. All three vendored packs
 *     (PSX/GGBot, DeJunes, Quaternius) are Blender OBJ exports ("# Blender ...
 *     MTL File"), so the flip is applied unconditionally; there is no per-pack
 *     CLI flag because no pack's evidence disagreed with this one.
 *
 * A file with a single object and no wheel objects (e.g. a body-only car, or a
 * standalone wheel mesh) converts fine: only the nodes that exist are emitted, and
 * no error is raised when the five-node set is incomplete.
 * Usage:
 *   node tools/obj-to-glb.mjs <input-dir> <output-dir> [--variants] [name.obj ...]
 *
 *   <input-dir>  directory scanned when no explicit .obj files are given
 *   <output-dir> where <Name>.glb files are written (created if missing)
 *   [name.obj]   optional list of .obj paths (absolute or CWD-relative); each is
 *                converted using the .mtl/textures in its OWN directory
 *   --variants   also copy sibling colour-variant *.png (excluding "snow" names)
 */

import {
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  existsSync,
} from 'node:fs';
import { join, basename, dirname, extname, normalize, isAbsolute, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// OBJ parsing
// ---------------------------------------------------------------------------

/** Resolve a 1-based OBJ index (negative = relative to `count`). */
function resolveIndex(token, count) {
  let n = Number(token);
  if (!Number.isFinite(n)) return -1;
  if (n < 0) n = count + n; // relative to the most recently defined element
  else n = n - 1; // 1-based -> 0-based
  return n >= 0 ? n : -1;
}

/**
 * Parse an OBJ string.
 * Returns { positions, normals, uvs, objects } where positions/normals are flat
 * xyz triplets, uvs are flat uv pairs, and each object is
 * { name, tris: [{ mat, p:[i0,i1,i2], t:[i0,i1,i2], n:[i0,i1,i2] }] } with GLOBAL
 * indices (-1 for a missing UV/normal on that corner).
 */
function parseObj(text) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const objects = [];
  let current = null;
  let currentMat = 'default';

  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line[0] === '#') continue;
    const parts = line.split(/\s+/);
    const tag = parts[0];

    if (tag === 'o' || tag === 'g') {
      const name = parts.slice(1).join(' ').trim();
      current = { name, tris: [] };
      objects.push(current);
    } else if (tag === 'v') {
      positions.push(Number(parts[1]), Number(parts[2]), Number(parts[3]));
    } else if (tag === 'vt') {
      uvs.push(Number(parts[1]), Number(parts[2]));
    } else if (tag === 'vn') {
      normals.push(Number(parts[1]), Number(parts[2]), Number(parts[3]));
    } else if (tag === 'usemtl') {
      currentMat = parts.slice(1).join(' ').trim();
    } else if (tag === 'f') {
      if (!current) continue;
      const posCount = positions.length / 3;
      const uvCount = uvs.length / 2;
      const nrmCount = normals.length / 3;
      // Parse every corner (v, v/vt, v//vn, v/vt/vn).
      const corners = [];
      for (let k = 1; k < parts.length; k++) {
        const seg = parts[k].split('/');
        const p = resolveIndex(seg[0], posCount);
        let t = -1;
        let n = -1;
        if (seg.length >= 2 && seg[1] !== '') t = resolveIndex(seg[1], uvCount);
        if (seg.length >= 3) n = resolveIndex(seg[2], nrmCount);
        corners.push({ p, t, n });
      }
      // Fan triangulation of a convex n-gon: (c0,c1,c2),(c0,c2,c3),...
      for (let k = 1; k + 1 < corners.length; k++) {
        const a = corners[0];
        const b = corners[k];
        const c = corners[k + 1];
        current.tris.push({
          mat: currentMat,
          p: [a.p, b.p, c.p],
          t: [a.t, b.t, c.t],
          n: [a.n, b.n, c.n],
        });
      }
    }
    // vp / s / mtllib / etc. are not needed.
  }

  return { positions, normals, uvs, objects };
}

// ---------------------------------------------------------------------------
// MTL parsing
// ---------------------------------------------------------------------------

const clamp01 = (x) => Math.min(1, Math.max(0, Number(x) || 0));

/**
 * Parse an MTL string into a Map<materialName, { color:[r,g,b], mapKd:string|null }>.
 */
function parseMtl(text) {
  const materials = new Map();
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === '#') continue;
    const parts = line.split(/\s+/);
    if (parts[0] === 'newmtl') {
      current = parts.slice(1).join(' ').trim();
      materials.set(current, { color: [0.8, 0.8, 0.8], mapKd: null });
    } else if (current) {
      if (parts[0] === 'Kd') {
        materials.get(current).color = [
          clamp01(parts[1]),
          clamp01(parts[2]),
          clamp01(parts[3]),
        ];
      } else if (parts[0] === 'map_Kd') {
        // map_Kd may carry options (`-s 1 1 1 -o 0 0 tex.png`); the last token
        // that is not an option flag is the texture path.
        const filename = parts[parts.length - 1];
        if (!filename.startsWith('-')) materials.get(current).mapKd = filename;
      }
    }
  }
  return materials;
}

// ---------------------------------------------------------------------------
// Object classification
// ---------------------------------------------------------------------------

/**
 * Map a source object name to an output node role.
 * Returns 'frontleft' | 'frontright' | 'rear' | 'body'.
 */
function classifyObject(name) {
  const n = name.toLowerCase();
  if (n.includes('frontleft')) return 'frontleft';
  if (n.includes('frontright')) return 'frontright';
  if (
    n.includes('backwheels') ||
    n.includes('rearwheels') ||
    n.includes('back') ||
    n.includes('rear')
  ) {
    return 'rear';
  }
  // A standalone wheel (e.g. a shared `Wheel` object) — not front/back/rear.
  if (n.includes('wheel')) return 'wheel';
  return 'body';
}

// ---------------------------------------------------------------------------
// Geometry building
// ---------------------------------------------------------------------------

/**
 * Turn a set of triangles (with GLOBAL position/UV/normal indices) into indexed
 * POSITION + NORMAL (+ TEXCOORD_0 when any UV is present) buffers with deduplicated
 * vertices.
 */
function buildPrimitive(tris, positions, normals, uvs) {
  const hasUV = tris.some((t) => t.t[0] >= 0 || t.t[1] >= 0 || t.t[2] >= 0);
  const vertexMap = new Map(); // "p:t:n" (or "p:n") -> vertex index
  const pos = [];
  const nrm = [];
  const uv = [];
  const idx = [];
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  let uvMin = [Infinity, Infinity];
  let uvMax = [-Infinity, -Infinity];

  const P = (pi) => [
    positions[pi * 3],
    positions[pi * 3 + 1],
    positions[pi * 3 + 2],
  ];

  for (const tri of tris) {
    // Lazily-computed geometric normal for the (rare) no-normal case.
    let faceNormal = -1;
    const N = (ni) => {
      if (ni >= 0) return ni;
      if (faceNormal < 0) {
        const [ax, ay, az] = P(tri.p[0]);
        const [bx, by, bz] = P(tri.p[1]);
        const [cx, cy, cz] = P(tri.p[2]);
        const ux = bx - ax, uy = by - ay, uz = bz - az;
        const vx = cx - ax, vy = cy - ay, vz = cz - az;
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz) || 1;
        normals.push(nx / len, ny / len, nz / len);
        faceNormal = normals.length / 3 - 1;
      }
      return faceNormal;
    };

    for (let c = 0; c < 3; c++) {
      const pi = tri.p[c];
      const ti = tri.t[c];
      const ni = N(tri.n[c]);
      const key = hasUV ? `${pi}/${ti}/${ni}` : `${pi}/${ni}`;
      let vi = vertexMap.get(key);
      if (vi === undefined) {
        vi = pos.length / 3;
        vertexMap.set(key, vi);
        const [x, y, z] = P(pi);
        pos.push(x, y, z);
        nrm.push(normals[ni * 3], normals[ni * 3 + 1], normals[ni * 3 + 2]);
        if (hasUV) {
          // Flip V: OBJ `vt` origin is bottom-left, glTF/three.js sample
          // TEXCOORD_0 with the origin top-left (see the header comment for the
          // pixel-sampling evidence).
          const u = ti >= 0 ? uvs[ti * 2] : 0;
          const v = ti >= 0 ? 1 - uvs[ti * 2 + 1] : 0;
          uv.push(u, v);
          if (u < uvMin[0]) uvMin[0] = u;
          if (v < uvMin[1]) uvMin[1] = v;
          if (u > uvMax[0]) uvMax[0] = u;
          if (v > uvMax[1]) uvMax[1] = v;
        }
        if (x < min[0]) min[0] = x;
        if (y < min[1]) min[1] = y;
        if (z < min[2]) min[2] = z;
        if (x > max[0]) max[0] = x;
        if (y > max[1]) max[1] = y;
        if (z > max[2]) max[2] = z;
      }
      idx.push(vi);
    }
  }

  const vertexCount = pos.length / 3;
  const maxIndex = Math.max(0, ...idx);
  const indices =
    maxIndex < 65536 ? Uint16Array.from(idx) : Uint32Array.from(idx);
  return {
    positions: Float32Array.from(pos),
    normals: Float32Array.from(nrm),
    uvs: hasUV ? Float32Array.from(uv) : null,
    hasUV,
    uvMin: hasUV ? uvMin : null,
    uvMax: hasUV ? uvMax : null,
    indices,
    vertexCount,
    min,
    max,
  };
}

// ---------------------------------------------------------------------------
// GLB (binary glTF 2.0) writing
// ---------------------------------------------------------------------------

/** Assemble one GLB from built nodes and materials. */
function buildGlb(builtNodes, materials) {
  const gltf = {
    asset: { version: '2.0', generator: 'tools/obj-to-glb.mjs' },
    scene: 0,
    scenes: [{ nodes: [] }],
    nodes: [],
    meshes: [],
    materials: [],
    accessors: [],
    bufferViews: [],
    buffers: [{ byteLength: 0 }],
  };

  const imageIndex = new Map();
  const textureFor = (uri) => {
    if (!gltf.images) {
      gltf.images = [];
      gltf.textures = [];
    }
    if (!imageIndex.has(uri)) {
      const image = gltf.images.length;
      imageIndex.set(uri, image);
      gltf.images.push({ uri });
      gltf.textures.push({ source: image });
    }
    return imageIndex.get(uri);
  };

  gltf.materials = materials.map((m) => {
    const pbr = {
      baseColorFactor: [m.color[0], m.color[1], m.color[2], 1.0],
      metallicFactor: 0,
      roughnessFactor: 0.6,
    };
    if (m.mapKdUri) pbr.baseColorTexture = { index: textureFor(m.mapKdUri) };
    return { name: m.name, pbrMetallicRoughness: pbr };
  });

  const binParts = [];
  let offset = 0;

  const addAccessor = (componentType, type, count, data, min, max, target) => {
    const pad = (4 - (offset % 4)) % 4;
    if (pad) {
      binParts.push(Buffer.alloc(pad));
      offset += pad;
    }
    const byteOffset = offset;
    const byteLength = data.byteLength;
    binParts.push(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    offset += byteLength;

    const bufferView = gltf.bufferViews.length;
    gltf.bufferViews.push({ buffer: 0, byteOffset, byteLength, target });
    const accessor = gltf.accessors.length;
    const acc = { bufferView, componentType, count, type };
    if (min) acc.min = min;
    if (max) acc.max = max;
    gltf.accessors.push(acc);
    return accessor;
  };

  for (const node of builtNodes) {
    const primitives = [];
    for (const prim of node.primitives) {
      const posAcc = addAccessor(
        5126, 'VEC3', prim.vertexCount, prim.positions,
        prim.min, prim.max, 34962,
      );
      const nrmAcc = addAccessor(
        5126, 'VEC3', prim.vertexCount, prim.normals,
        null, null, 34962,
      );
      const attributes = { POSITION: posAcc, NORMAL: nrmAcc };
      if (prim.hasUV) {
        attributes.TEXCOORD_0 = addAccessor(
          5126, 'VEC2', prim.vertexCount, prim.uvs,
          prim.uvMin, prim.uvMax, 34962,
        );
      }
      const indexComponent = prim.indices instanceof Uint16Array ? 5123 : 5125;
      const idxAcc = addAccessor(
        indexComponent, 'SCALAR', prim.indices.length, prim.indices,
        null, null, 34963,
      );
      primitives.push({
        attributes,
        indices: idxAcc,
        material: prim.material,
      });
    }
    const meshIndex = gltf.meshes.length;
    gltf.meshes.push({ name: node.name, primitives });
    gltf.nodes.push({ name: node.name, mesh: meshIndex });
    gltf.scenes[0].nodes.push(gltf.nodes.length - 1);
  }

  gltf.buffers[0].byteLength = offset;
  const bin = Buffer.concat(binParts);

  const jsonBuf = Buffer.from(JSON.stringify(gltf), 'utf8');
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  const jsonChunk = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);

  const binPad = (4 - (bin.length % 4)) % 4;
  const binChunk = Buffer.concat([bin, Buffer.alloc(binPad, 0x00)]);

  const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const out = Buffer.alloc(total);
  let o = 0;
  out.writeUInt32LE(0x46546c67, o); o += 4; // "glTF"
  out.writeUInt32LE(2, o); o += 4; // version
  out.writeUInt32LE(total, o); o += 4; // total length
  out.writeUInt32LE(jsonChunk.length, o); o += 4;
  out.writeUInt32LE(0x4e4f534a, o); o += 4; // "JSON"
  jsonChunk.copy(out, o); o += jsonChunk.length;
  out.writeUInt32LE(binChunk.length, o); o += 4;
  out.writeUInt32LE(0x004e4942, o); o += 4; // "BIN\0"
  binChunk.copy(out, o);

  return out;
}

// ---------------------------------------------------------------------------
// Bounding boxes / measurements
// ---------------------------------------------------------------------------

function bboxOfNode(node) {
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  for (const prim of node.primitives) {
    const p = prim.positions;
    for (let i = 0; i < p.length; i += 3) {
      for (let c = 0; c < 3; c++) {
        if (p[i + c] < min[c]) min[c] = p[i + c];
        if (p[i + c] > max[c]) max[c] = p[i + c];
      }
    }
  }
  return {
    min,
    max,
    center: [0, 1, 2].map((c) => (min[c] + max[c]) / 2),
    size: [0, 1, 2].map((c) => max[c] - min[c]),
  };
}

function mergeBBox(a, b) {
  return {
    min: [0, 1, 2].map((c) => Math.min(a.min[c], b.min[c])),
    max: [0, 1, 2].map((c) => Math.max(a.max[c], b.max[c])),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// Positional args: input-dir, output-dir, then any number of .obj paths.
// Flags (may appear anywhere): --variants (copy sibling non-"snow" PNGs too).
const positional = [];
let copyVariants = false;
for (const arg of process.argv.slice(2)) {
  if (arg === '--variants') {
    copyVariants = true;
  } else {
    positional.push(arg);
  }
}
const [inputDirArg, outputDirArg, ...explicitObjs] = positional;
if (!inputDirArg || !outputDirArg) {
  console.error(
    'Usage: node tools/obj-to-glb.mjs <input-dir> <output-dir> [--variants] [name.obj ...]',
  );
  process.exit(1);
}

const inputDir = normalize(inputDirArg);
const outputDir = normalize(outputDirArg);
mkdirSync(outputDir, { recursive: true });

// Each entry is an absolute path to an .obj file. Explicit args are treated as
// paths relative to the CWD (so .obj files may live in different subdirectories,
// each with its own .mtl and textures). Omitted -> every *.obj under <input-dir>.
const objPaths = explicitObjs.length
  ? explicitObjs.map((p) => resolve(isAbsolute(p) ? p : join(process.cwd(), p)))
  : readdirSync(inputDir)
      .filter((f) => extname(f).toLowerCase() === '.obj')
      .map((f) => resolve(join(inputDir, f)))
      .sort();

/** All consumer nodes, in a stable reporting/emission order. */
const NODE_ORDER = [
  'body',
  'wheel-front-left',
  'wheel-front-right',
  'wheel-back-left',
  'wheel-back-right',
  'wheel',
];

console.log('OBJ/MTL -> glTF 2.0 (Y-up, metres)');
console.log('');

for (const objPath of objPaths) {
  const dir = dirname(objPath);
  const stem = basename(objPath, extname(objPath));
  const objText = readFileSync(objPath, 'utf8');
  const mtlFile = join(dir, stem + '.mtl');
  const mtlText = readFileSync(mtlFile, 'utf8');

  const { positions, normals, uvs, objects } = parseObj(objText);
  const kd = parseMtl(mtlText);

  // Resolve each material's texture: copy the PNG next to the GLB and reference
  // it by basename (resolved relative to the .obj's own directory). The on-disk
  // case is used as the URI so it stays correct on case-sensitive filesystems
  // (some packs name the file `car3.png` while the MTL says `Car3.png`).
  const materialTexture = new Map(); // material name -> uri | null
  const siblingFiles = readdirSync(dir);
  for (const [name, m] of kd) {
    if (m.mapKd) {
      const desired = basename(m.mapKd.replace(/\\/g, '/'));
      const actual =
        siblingFiles.find((f) => f.toLowerCase() === desired.toLowerCase()) ||
        desired;
      const src = join(dir, actual);
      if (existsSync(src)) {
        copyFileSync(src, join(outputDir, actual));
        materialTexture.set(name, actual);
      } else {
        console.warn(`  ! ${stem}: texture not found: ${src}`);
        materialTexture.set(name, desired);
      }
    }
  }

  // Optionally copy every colour-variant PNG sitting beside this .obj so the game
  // can swap textures at load. Snow/snowcovered variants are skipped.
  if (copyVariants) {
    for (const f of readdirSync(dir)) {
      if (extname(f).toLowerCase() !== '.png') continue;
      if (/snow/i.test(basename(f, '.png'))) continue;
      copyFileSync(join(dir, f), join(outputDir, f));
    }
  }


  // Route every triangle into an output node bucket.
  // nodeBuckets: name -> Map(materialName -> tris[])
  const nodeBuckets = new Map();
  const bucketFor = (name, material, tri) => {
    if (!nodeBuckets.has(name)) nodeBuckets.set(name, new Map());
    const mats = nodeBuckets.get(name);
    if (!mats.has(material)) mats.set(material, []);
    mats.get(material).push(tri);
  };

  for (const object of objects) {
    const role = classifyObject(object.name);
    if (role === 'body') {
      for (const tri of object.tris) bucketFor('body', tri.mat, tri);
    } else if (role === 'frontleft') {
      for (const tri of object.tris) bucketFor('wheel-front-left', tri.mat, tri);
    } else if (role === 'frontright') {
      for (const tri of object.tris) bucketFor('wheel-front-right', tri.mat, tri);
    } else if (role === 'wheel') {
      for (const tri of object.tris) bucketFor('wheel', tri.mat, tri);
    } else {
      // role === 'rear': split the merged rear wheels by centroid X sign.
      for (const tri of object.tris) {
        let cx = 0;
        for (const pi of tri.p) cx += positions[pi * 3];
        cx /= tri.p.length;
        const node = cx < 0 ? 'wheel-back-left' : 'wheel-back-right';
        bucketFor(node, tri.mat, tri);
      }
    }
  }

  // Build the material table (shared across nodes) and the geometry.
  const materialIndex = new Map();
  const materials = [];
  const materialFor = (name) => {
    if (!materialIndex.has(name)) {
      materialIndex.set(name, materials.length);
      const def = kd.get(name) || { color: [0.8, 0.8, 0.8], mapKd: null };
      materials.push({
        name,
        color: def.color,
        mapKdUri: materialTexture.get(name) || null,
      });
    }
    return materialIndex.get(name);
  };

  // Emit only the nodes that actually have geometry (a body-only or wheel-only
  // file must not raise an error).
  const builtNodes = [];
  for (const name of NODE_ORDER) {
    const mats = nodeBuckets.get(name);
    if (!mats || mats.size === 0) continue;
    const primitives = [];
    for (const [matName, tris] of mats) {
      const prim = buildPrimitive(tris, positions, normals, uvs);
      prim.material = materialFor(matName);
      primitives.push(prim);
    }
    builtNodes.push({ name, primitives });
  }

  if (builtNodes.length === 0) {
    console.warn(`  ! ${stem}: no geometry produced`);
    continue;
  }

  const glb = buildGlb(builtNodes, materials);
  writeFileSync(join(outputDir, stem + '.glb'), glb);

  // --- Report per-file measurements ---------------------------------------
  const boxes = new Map();
  let overall = null;
  for (const node of builtNodes) {
    const b = bboxOfNode(node);
    boxes.set(node.name, b);
    overall = overall ? mergeBBox(overall, b) : b;
  }
  const size = [0, 1, 2].map((c) => overall.max[c] - overall.min[c]);
  // Blender Y-up: X = width, Y = height, Z = length.
  const body = boxes.get('body');
  const wheelNames = builtNodes
    .map((n) => n.name)
    .filter((n) => n.startsWith('wheel-') || n === 'wheel');
  console.log(
    `${stem}.glb  L ${size[2].toFixed(3)}  W ${size[0].toFixed(3)}  H ${size[1].toFixed(3)} m` +
      (builtNodes.length < 5 ? `  (${builtNodes.length}/5 nodes)` : ''),
  );
  if (body) {
    console.log(
      `    body bbox Y  ${body.min[1].toFixed(3)} .. ${body.max[1].toFixed(3)}`,
    );
  }
  for (const name of wheelNames) {
    const b = boxes.get(name);
    console.log(
      `    ${name.padEnd(18)} centre (${b.center[0].toFixed(3)}, ${b.center[1].toFixed(3)}, ${b.center[2].toFixed(3)})  r ${(b.size[1] / 2).toFixed(3)}`,
    );
  }
  console.log('');
}
