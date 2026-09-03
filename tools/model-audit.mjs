#!/usr/bin/env node
/**
 * tools/model-audit.mjs
 * Prints, for every .glb/.fbx in a model directory: the model's size in its OWN
 * units, then per mesh the material-group count and UV range, then per material the
 * colour and whether it carries a texture.
 *
 * This is what the catalogue's scales and the per-part livery rule in
 * render/carmodel.ts were derived from: it shows which material of a body is the
 * paint slot (the one with a map) and which are part colours (glass, grill, lights,
 * tyres), and it gives the raw length/width a scale has to be fitted to. By default it
 * audits the Stylized Vehicles Pack.
 *
 * Usage: node tools/model-audit.mjs [public/models/<pack>]
 *
 * Note: an embedded-texture .glb never settles here — three's glTF image path needs
 * a real DOM, and the stubs below only go as far as the FBX path needs.
 */
// three's ImageLoader wants a DOM; a stub is enough to record which file each
// material asks for.
globalThis.document = {
  createElementNS: () => ({
    set src(v) { this._src = v; },
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
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
const DIR = (process.argv[2] ?? 'public/models/stylized') + '/';

function report(name, scene) {
  scene.updateMatrixWorld(true);
  const s = new THREE.Box3().setFromObject(scene, true).getSize(new THREE.Vector3());
  const out = [`${name}: ${s.x.toFixed(3)} x ${s.y.toFixed(3)} x ${s.z.toFixed(3)}`];
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const uv = o.geometry.attributes.uv;
    let uvr = 'no-uv';
    if (uv) {
      let a = 1e9, b = -1e9, c = 1e9, d = -1e9;
      for (let i = 0; i < uv.count; i++) {
        const x = uv.getX(i), y = uv.getY(i);
        a = Math.min(a, x); b = Math.max(b, x); c = Math.min(c, y); d = Math.max(d, y);
      }
      uvr = `u[${a.toFixed(2)},${b.toFixed(2)}] v[${c.toFixed(2)},${d.toFixed(2)}]`;
    }
    out.push(`  mesh "${o.name}" groups=${o.geometry.groups.length} ${uvr}`);
    for (const m of mats) {
      const src = m.map ? (m.map.source?.data?.src ?? m.map.name ?? 'yes') : 'no';
      out.push(
        `     mat "${m.name}" color=#${m.color ? m.color.getHexString() : '-'} map=${src}` +
          (m.map ? ` flipY=${m.map.flipY}` : ''),
      );
    }
  });
  return out.join('\n');
}

const fbx = new FBXLoader();
const gltf = new GLTFLoader();
const logs = [];
for (const f of readdirSync(DIR).sort()) {
  const ext = f.toLowerCase().slice(f.lastIndexOf('.'));
  if (ext !== '.fbx' && ext !== '.glb') continue;
  const buf = readFileSync(DIR + f);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const scene =
    ext === '.fbx'
      ? fbx.parse(ab, DIR)
      : (await new Promise((res, rej) => gltf.parse(ab, DIR, res, rej))).scene;
  logs.push(report(f, scene));
}
console.log(logs.join('\n\n'));
