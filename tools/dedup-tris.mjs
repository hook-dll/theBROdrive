#!/usr/bin/env node
// tools/dedup-tris.mjs -- weld, then drop triangles that re-cover a surface
// another triangle in the same primitive already covers, for
// tools/vehicle-pipeline.md's assembly step.
//
// These GTA donors ship the same surface two and three times over: RAGE draws
// the copies in separate passes, so they never fight there, but merged into
// one mesh per runtime role they land at identical depth and the depth buffer
// picks per pixel -- torn, high-contrast, jagged mottling across painted
// panels, glass and lamp lenses.
//
// `tools/import-yft-vehicle.py` already drops the copies it can see, but it
// works on its own pre-weld positions; welding afterwards pulls near-coincident
// vertices together and creates a fresh crop of exact duplicates that only a
// post-weld pass can see. Run this between assembly and `gltf-transform
// optimize --weld false`.
//
// Only same-facing duplicates go. A coincident pair wound the opposite way is
// a deliberately two-sided sheet, one side of which is culled anyway, so it
// never fights, and dropping it would make the sheet vanish edge-on.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: node tools/dedup-tris.mjs <in.glb> <out.glb>');
  process.exit(1);
}

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const doc = await io.read(input);
await doc.transform(weld());

const Q = 2000; // half-millimetre grid
const H1 = 73856093, H2 = 19349663, H3 = 83492791;

let removed = 0;
let kept = 0;
for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const indices = prim.getIndices();
    const pos = prim.getAttribute('POSITION');
    if (!indices || !pos) continue;
    const ia = indices.getArray();
    const seen = new Set();
    const out = [];
    const a = [], b = [], c = [];
    for (let t = 0; t < ia.length; t += 3) {
      pos.getElement(ia[t], a);
      pos.getElement(ia[t + 1], b);
      pos.getElement(ia[t + 2], c);
      // Corner hashes, sorted: the same surface keys the same however the
      // donor ordered its corners.
      const codes = [a, b, c]
        .map((v) =>
          (Math.round(v[0] * Q) * H1) ^ (Math.round(v[1] * Q) * H2) ^ (Math.round(v[2] * Q) * H3),
        )
        .sort((x, y) => x - y);
      // The quantised face normal keeps the opposite winding of a two-sided
      // sheet distinct from the copy facing the other way.
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      ];
      const len = Math.hypot(n[0], n[1], n[2]) || 1;
      const key = `${codes[0]},${codes[1]},${codes[2]}|${Math.round((n[0] / len) * 16)},${Math.round((n[1] / len) * 16)},${Math.round((n[2] / len) * 16)}`;
      if (seen.has(key)) {
        removed++;
        continue;
      }
      seen.add(key);
      out.push(ia[t], ia[t + 1], ia[t + 2]);
      kept++;
    }
    if (out.length !== ia.length) {
      indices.setArray(new Uint32Array(out));
    }
  }
}

await io.write(output, doc);
console.log(`${output}: ${kept} triangles, ${removed} coincident duplicates dropped`);
