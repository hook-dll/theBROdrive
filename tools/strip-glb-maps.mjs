#!/usr/bin/env node
/**
 * tools/strip-glb-maps.mjs
 *
 * Removes the PBR maps a flat-shaded renderer never looks at from a .glb, and
 * rewrites the file without their bytes.
 *
 * Why this exists: bought models are authored for a PBR renderer, and their weight
 * is almost never geometry. The trailer that prompted this is 3.22 MB, of which
 * 2.37 MB is three texture images — a base-colour JPEG plus two 1024x1024 PNGs
 * carrying a normal map and a shared occlusion/metallic-roughness map. This game
 * draws with flat-ish MeshStandardMaterial under comic banding and an ink outline
 * pass, and every car in the catalogue uses BASE COLOUR ONLY. A normal map's fine
 * detail is quantised away by the banding, and an AO map is redundant against it.
 *
 * So the saving is available for free: keep base colour, drop the rest, and the
 * file loses three quarters of its size with no visible change under this
 * renderer. Decimating geometry would have been the wrong lever — 10k triangles
 * for a trailer is fine, and cutting it would cost silhouette, which this art
 * direction actually shows.
 *
 * What it does, precisely:
 *  - Keeps `pbrMetallicRoughness.baseColorTexture`; deletes `normalTexture`,
 *    `occlusionTexture`, `emissiveTexture` and `metallicRoughnessTexture` from
 *    every material.
 *  - Drops every texture/sampler/image that nothing references any more.
 *  - Rebuilds the BIN chunk containing only the buffer views still reachable, and
 *    renumbers every index that points into the arrays it changed.
 *
 * Usage:
 *   node tools/strip-glb-maps.mjs public/models/trailer/trailer.glb            # in place
 *   node tools/strip-glb-maps.mjs input.glb output.glb                         # to a copy
 *   node tools/strip-glb-maps.mjs input.glb --dry-run                          # report only
 */

import { readFileSync, writeFileSync } from 'node:fs';

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'
/** Material slots this renderer ignores. Base colour is deliberately not here. */
const DROPPED_SLOTS = ['normalTexture', 'occlusionTexture', 'emissiveTexture'];

function fail(message) {
  console.error(`strip-glb-maps: ${message}`);
  process.exit(1);
}

function parseGlb(bytes) {
  if (bytes.readUInt32LE(0) !== GLB_MAGIC) fail('not a .glb (bad magic)');
  let json = null;
  let bin = Buffer.alloc(0);
  let offset = 12;
  while (offset < bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === CHUNK_JSON) json = JSON.parse(body.toString('utf8'));
    else if (type === CHUNK_BIN) bin = body;
    // Chunks are 4-byte aligned; the stored length excludes the padding.
    offset += 8 + length + ((4 - (length % 4)) % 4);
  }
  if (!json) fail('no JSON chunk');
  return { json, bin };
}

/** Pads to the 4-byte boundary the GLB spec requires, with the filler it requires. */
function pad(buffer, filler) {
  const extra = (4 - (buffer.length % 4)) % 4;
  return extra === 0 ? buffer : Buffer.concat([buffer, Buffer.alloc(extra, filler)]);
}

function writeGlb(json, bin) {
  const jsonChunk = pad(Buffer.from(JSON.stringify(json), 'utf8'), 0x20); // spaces
  const binChunk = pad(bin, 0x00);
  const total = 12 + 8 + jsonChunk.length + (binChunk.length > 0 ? 8 + binChunk.length : 0);

  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);

  const parts = [header];
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.writeUInt32LE(CHUNK_JSON, 4);
  parts.push(jsonHeader, jsonChunk);

  if (binChunk.length > 0) {
    const binHeader = Buffer.alloc(8);
    binHeader.writeUInt32LE(binChunk.length, 0);
    binHeader.writeUInt32LE(CHUNK_BIN, 4);
    parts.push(binHeader, binChunk);
  }
  return Buffer.concat(parts);
}

const args = process.argv.slice(2);
const input = args[0];
if (!input) fail('usage: node tools/strip-glb-maps.mjs <input.glb> [output.glb|--dry-run]');
const dryRun = args.includes('--dry-run');
const output = dryRun ? null : (args[1] && !args[1].startsWith('--') ? args[1] : input);

const original = readFileSync(input);
const { json, bin } = parseGlb(original);

// --- 1. Strip the slots ----------------------------------------------------
let slotsRemoved = 0;
for (const material of json.materials ?? []) {
  for (const slot of DROPPED_SLOTS) {
    if (material[slot] !== undefined) {
      delete material[slot];
      slotsRemoved++;
    }
  }
  const pbr = material.pbrMetallicRoughness;
  if (pbr?.metallicRoughnessTexture !== undefined) {
    delete pbr.metallicRoughnessTexture;
    slotsRemoved++;
  }
}

// --- 2. Find what is still referenced --------------------------------------
// Walked generically: a texture index can appear in any `*Texture: { index }`
// object anywhere in the material tree (including KHR extensions), so this looks
// for the shape rather than a fixed list of names.
const usedTextures = new Set();
const collectTextures = (node) => {
  if (Array.isArray(node)) {
    for (const item of node) collectTextures(item);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    if (key.endsWith('Texture') && value && typeof value.index === 'number') {
      usedTextures.add(value.index);
    }
    collectTextures(value);
  }
};
collectTextures(json.materials ?? []);

const textures = json.textures ?? [];
const usedImages = new Set();
const usedSamplers = new Set();
for (const index of usedTextures) {
  const texture = textures[index];
  if (!texture) continue;
  if (typeof texture.source === 'number') usedImages.add(texture.source);
  if (typeof texture.sampler === 'number') usedSamplers.add(texture.sampler);
}

// --- 3. Report before doing anything irreversible ---------------------------
const images = json.images ?? [];
const bufferViews = json.bufferViews ?? [];
const sizeOfImage = (image) =>
  typeof image.bufferView === 'number' ? (bufferViews[image.bufferView]?.byteLength ?? 0) : 0;

let droppedImageBytes = 0;
for (let i = 0; i < images.length; i++) {
  if (!usedImages.has(i)) droppedImageBytes += sizeOfImage(images[i]);
}

console.log(`${input}`);
console.log(`  material slots removed : ${slotsRemoved}`);
console.log(`  images   ${images.length} -> ${usedImages.size}`);
console.log(`  textures ${textures.length} -> ${usedTextures.size}`);
console.log(`  image bytes dropped    : ${(droppedImageBytes / 1024).toFixed(0)} kB`);

if (dryRun) {
  console.log('  (dry run: nothing written)');
  process.exit(0);
}

// --- 4. Rebuild images/textures/samplers with renumbered indices ------------
const remap = (used, list) => {
  const map = new Map();
  const kept = [];
  for (let i = 0; i < list.length; i++) {
    if (!used.has(i)) continue;
    map.set(i, kept.length);
    kept.push(list[i]);
  }
  return { map, kept };
};

const imageRemap = remap(usedImages, images);
const samplerRemap = remap(usedSamplers, json.samplers ?? []);
const textureRemap = remap(usedTextures, textures);

for (const texture of textureRemap.kept) {
  if (typeof texture.source === 'number') texture.source = imageRemap.map.get(texture.source);
  if (typeof texture.sampler === 'number') texture.sampler = samplerRemap.map.get(texture.sampler);
}

// Point every surviving `*Texture` at its new texture index.
const renumberTextures = (node) => {
  if (Array.isArray(node)) {
    for (const item of node) renumberTextures(item);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    if (key.endsWith('Texture') && value && typeof value.index === 'number') {
      value.index = textureRemap.map.get(value.index);
    }
    renumberTextures(value);
  }
};
renumberTextures(json.materials ?? []);

// --- 5. Rebuild the BIN chunk from the surviving buffer views ---------------
// Every accessor and every kept image names a buffer view; anything else in the
// old BIN was reachable only from an image we just dropped.
const keptViews = new Set();
for (const accessor of json.accessors ?? []) {
  if (typeof accessor.bufferView === 'number') keptViews.add(accessor.bufferView);
}
for (const image of imageRemap.kept) {
  if (typeof image.bufferView === 'number') keptViews.add(image.bufferView);
}
// Sparse accessors carry their own views.
for (const accessor of json.accessors ?? []) {
  const sparse = accessor.sparse;
  if (!sparse) continue;
  if (typeof sparse.indices?.bufferView === 'number') keptViews.add(sparse.indices.bufferView);
  if (typeof sparse.values?.bufferView === 'number') keptViews.add(sparse.values.bufferView);
}

const viewMap = new Map();
const newViews = [];
const binParts = [];
let cursor = 0;
for (let i = 0; i < bufferViews.length; i++) {
  if (!keptViews.has(i)) continue;
  const view = bufferViews[i];
  const start = view.byteOffset ?? 0;
  const slice = bin.subarray(start, start + view.byteLength);
  // Views are re-emitted 4-byte aligned, which every accessor component type in
  // glTF 2.0 is satisfied by and which keeps the chunk spec-legal.
  const alignment = (4 - (cursor % 4)) % 4;
  if (alignment > 0) {
    binParts.push(Buffer.alloc(alignment));
    cursor += alignment;
  }
  viewMap.set(i, newViews.length);
  newViews.push({ ...view, buffer: 0, byteOffset: cursor });
  binParts.push(slice);
  cursor += slice.length;
}

const rewire = (node) => {
  if (Array.isArray(node)) {
    for (const item of node) rewire(item);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'bufferView' && typeof value === 'number') {
      const next = viewMap.get(value);
      if (next === undefined) fail(`buffer view ${value} was dropped but is still referenced`);
      node[key] = next;
    } else {
      rewire(value);
    }
  }
};
rewire(json.accessors ?? []);
rewire(imageRemap.kept);

const newBin = Buffer.concat(binParts);
json.images = imageRemap.kept;
json.textures = textureRemap.kept;
if (json.samplers) json.samplers = samplerRemap.kept;
json.bufferViews = newViews;
json.buffers = [{ byteLength: newBin.length }];

const rebuilt = writeGlb(json, newBin);
writeFileSync(output, rebuilt);

const before = original.length / 1024;
const after = rebuilt.length / 1024;
console.log(
  `  ${before.toFixed(0)} kB -> ${after.toFixed(0)} kB ` +
    `(${(100 * (1 - after / before)).toFixed(0)}% smaller)  written to ${output}`,
);
