#!/usr/bin/env node
/**
 * tools/nature-prep.mjs
 *
 * Prepares the countryside's tree and bush models (CC0, Quaternius — see
 * public/models/nature/LICENSE.md) for the forest renderer (src/world/props/trees.ts).
 *
 *   node tools/nature-prep.mjs <raw-download-dir>
 *
 * The raw downloads are not in the repo. Each source becomes two files:
 *
 *   <out>.glb       near LOD: welded, simplified to NEAR_RATIO of its vertices
 *   <out>-far.glb   far LOD:  simplified to FAR_RATIO
 *
 * and both lose their normal maps (the comic shading banding the light is the
 * surface; a normal map only adds noise it then quantises) and have every texture
 * scaled down with macOS `sips` to TEXTURE_MAX (bark) or LEAF_MAX (foliage).
 *
 * Simplifying card foliage sounds wrong and measured fine: meshoptimizer collapses
 * the extra loops along each branch card and leaves the card outlines, which are all
 * the silhouette is. A MegaKit pine at 12% is visually indistinguishable at any
 * distance the game shows one from.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NodeIO } from '@gltf-transform/core';
import { dedup, prune, simplify, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

/**
 * `cards` is the share of foliage cards kept at [near, far]. Loose-card foliage
 * (a birch's leaf clusters, a bush) has nothing for the simplifier to collapse — every
 * card is its own island — so it is THINNED instead: keep that share of the cards and
 * grow each about its own centre so the crown covers what it covered.
 */
const SOURCES = [
  { src: 'mk-rfnxJv0Rqa.glb', out: 'spruce-1', cards: [1, 1] },
  { src: 'mk-79gmlLnweB.glb', out: 'spruce-2', cards: [1, 1] },
  { src: 'mk-699sFuLCN2.glb', out: 'spruce-3', cards: [1, 1] },
  { src: 'birch-trees.glb', out: 'birch', cards: [0.45, 0.14] },
  { src: 'mk-EoTERLq3z2.glb', out: 'bush', cards: [0.6, 0.25] },
];
const NEAR_RATIO = 0.12;
const FAR_RATIO = 0.03;
/** A thinned card grows by at most this much, however few are kept. */
const CARD_GROWTH_MAX = 1.9;
const TEXTURE_MAX = 256;
const LEAF_MAX = 512;

const rawDir = process.argv[2];
if (!rawDir) {
  console.error('usage: node tools/nature-prep.mjs <raw-download-dir>');
  process.exit(1);
}
const outDir = 'public/models/nature';
const scratch = mkdtempSync(join(tmpdir(), 'nature-prep-'));
const io = new NodeIO();
await MeshoptSimplifier.ready;

function shrinkTextures(document) {
  for (const material of document.getRoot().listMaterials()) {
    material.setNormalTexture(null);
  }
  for (const texture of document.getRoot().listTextures()) {
    const image = texture.getImage();
    if (!image) continue;
    const leaf = /leaf|leaves/i.test(texture.getName() || texture.getURI());
    const file = join(scratch, `t-${Math.random().toString(36).slice(2)}.png`);
    writeFileSync(file, image);
    execFileSync('sips', ['-Z', String(leaf ? LEAF_MAX : TEXTURE_MAX), file], { stdio: 'ignore' });
    texture.setImage(new Uint8Array(readFileSync(file)));
  }
}

/**
 * Keeps `share` of the loose foliage cards in every leaf primitive, deterministically,
 * each kept card scaled about its centroid. Cards are the connected components of the
 * welded index buffer.
 */
function thinCards(document, share) {
  if (share >= 1) return;
  const growth = Math.min(CARD_GROWTH_MAX, Math.sqrt(1 / share));
  for (const mesh of document.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const material = prim.getMaterial();
      if (!material || !/leaf|leaves/i.test(material.getName())) continue;
      const indices = prim.getIndices();
      const position = prim.getAttribute('POSITION');
      if (!indices || !position) continue;
      const idx = indices.getArray();
      const n = position.getCount();
      const parent = new Int32Array(n).map((_, i) => i);
      const find = (a) => {
        while (parent[a] !== a) a = parent[a] = parent[parent[a]];
        return a;
      };
      for (let t = 0; t < idx.length; t += 3) {
        const a = find(idx[t]);
        parent[find(idx[t + 1])] = a;
        parent[find(idx[t + 2])] = a;
      }
      // Kept components: a cheap hash of the root index, so the choice is stable.
      const keep = (root) => ((Math.imul(root + 1, 2654435761) >>> 0) / 4294967296) < share;
      const sum = new Map();
      const p = [0, 0, 0];
      for (let v = 0; v < n; v++) {
        const r = find(v);
        position.getElement(v, p);
        const acc = sum.get(r) ?? [0, 0, 0, 0];
        acc[0] += p[0];
        acc[1] += p[1];
        acc[2] += p[2];
        acc[3]++;
        sum.set(r, acc);
      }
      for (let v = 0; v < n; v++) {
        const r = find(v);
        if (!keep(r)) continue;
        const c = sum.get(r);
        position.getElement(v, p);
        for (let k = 0; k < 3; k++) p[k] = c[k] / c[3] + (p[k] - c[k] / c[3]) * growth;
        position.setElement(v, p);
      }
      const kept = [];
      for (let t = 0; t < idx.length; t += 3) if (keep(find(idx[t]))) kept.push(idx[t], idx[t + 1], idx[t + 2]);
      indices.setArray(new (idx.constructor)(kept));
    }
  }
}

for (const { src, out, cards } of SOURCES) {
  for (const [suffix, ratio, share] of [['', NEAR_RATIO, cards[0]], ['-far', FAR_RATIO, cards[1]]]) {
    const document = await io.read(join(rawDir, src));
    shrinkTextures(document);
    await document.transform(weld());
    thinCards(document, share);
    await document.transform(
      simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.05 }),
      dedup(),
      prune(),
    );
    const path = join(outDir, `${out}${suffix}.glb`);
    await io.write(path, document);
    let triangles = 0;
    for (const mesh of document.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) triangles += (prim.getIndices()?.getCount() ?? 0) / 3;
    }
    console.log(`${path}: ${triangles} triangles`);
  }
}
