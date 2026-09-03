#!/usr/bin/env node
/**
 * tools/fbx-inspect.mjs
 *
 * Dumps the scene graph three.js's own FBXLoader produces for an FBX file: node
 * hierarchy, mesh vertex counts, per-mesh and per-material-group world bounds, UV
 * ranges and material names, plus the whole model's bounding box.
 *
 * This is ground truth for authoring catalogue entries. The loader's node and
 * material NAMES are what `VehicleLightsDef` selectors have to match, its bounds
 * are what `render/carmodel.ts` will measure, and the per-group UV ranges are what
 * identify a palette cell for atlas repainting.
 *
 * Usage: node tools/fbx-inspect.mjs <file.fbx> [...]
 */
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

/**
 * Headless DOM shim. FBXLoader resolves the texture slots it finds, which reaches
 * three's ImageLoader and therefore `document.createElementNS`. Nothing here needs
 * pixels — only the material and texture NAMES — so an inert element is enough.
 */
globalThis.document ??= {
  createElementNS: () => ({
    style: {},
    setAttribute() {},
    addEventListener() {},
    removeEventListener() {},
  }),
};

const loader = new FBXLoader();

function fmt(v) {
  return v.toFixed(3);
}

function depthOf(node) {
  let depth = 0;
  for (let p = node.parent; p; p = p.parent) depth++;
  return depth;
}

/** World-space bounds and UV bounds of one index range of a mesh. */
function rangeBounds(mesh, start, count) {
  const position = mesh.geometry.attributes.position;
  const uv = mesh.geometry.attributes.uv;
  const index = mesh.geometry.index;
  const box = new THREE.Box3();
  const uvBox = new THREE.Box2();
  const p = new THREE.Vector3();
  const t = new THREE.Vector2();
  const end = Math.min(start + count, index ? index.count : position.count);
  for (let i = start; i < end; i++) {
    const vi = index ? index.getX(i) : i;
    p.fromBufferAttribute(position, vi).applyMatrix4(mesh.matrixWorld);
    box.expandByPoint(p);
    if (uv) uvBox.expandByPoint(t.fromBufferAttribute(uv, vi));
  }
  return { box, uvBox };
}

function describe(box, uvBox) {
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  let uv = '';
  if (!uvBox.isEmpty()) {
    uv =
      ` uv=[${fmt(uvBox.min.x)}..${fmt(uvBox.max.x)}]` +
      `x[${fmt(uvBox.min.y)}..${fmt(uvBox.max.y)}]`;
  }
  return (
    ` size=(${fmt(size.x)},${fmt(size.y)},${fmt(size.z)})` +
    ` centre=(${fmt(centre.x)},${fmt(centre.y)},${fmt(centre.z)})` +
    uv
  );
}

for (const file of process.argv.slice(2)) {
  const buf = readFileSync(file);
  const scene = loader.parse(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    `${dirname(file)}/`,
  );
  scene.updateMatrixWorld(true);
  console.log(`=== ${file}`);
  scene.traverse((node) => {
    const pad = '  '.repeat(depthOf(node));
    if (!node.isMesh) {
      console.log(`${pad}${node.name || '(unnamed)'} <${node.type}>`);
      return;
    }
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    const geometry = node.geometry;
    const drawCount = geometry.index ? geometry.index.count : geometry.attributes.position.count;
    const whole = rangeBounds(node, 0, drawCount);
    console.log(
      `${pad}${node.name || '(unnamed)'} <Mesh> verts=${geometry.attributes.position.count}` +
        ` indexed=${geometry.index ? 'yes' : 'no'} groups=${geometry.groups.length}` +
        describe(whole.box, whole.uvBox),
    );
    const groups = geometry.groups.length
      ? geometry.groups
      : [{ start: 0, count: drawCount, materialIndex: 0 }];
    for (const group of groups) {
      const material = materials[group.materialIndex ?? 0];
      const { box, uvBox } = rangeBounds(node, group.start, group.count);
      const map = material?.map;
      console.log(
        `${pad}  [${group.materialIndex ?? 0}] ${material?.name ?? '?'}` +
          ` <${material?.type ?? '?'}>` +
          (map ? ` map=${map.name || map.source?.data?.src || 'set'}` : '') +
          ` tris=${group.count / 3}` +
          describe(box, uvBox),
      );
    }
    const unused = materials
      .map((m, i) => [m, i])
      .filter(([, i]) => !groups.some((g) => (g.materialIndex ?? 0) === i))
      .map(([m]) => m?.name ?? '?');
    if (unused.length) console.log(`${pad}  (slots with no geometry: ${unused.join(', ')})`);
  });
  const total = new THREE.Box3().setFromObject(scene, true);
  const size = total.getSize(new THREE.Vector3());
  console.log(
    `TOTAL size=(${fmt(size.x)},${fmt(size.y)},${fmt(size.z)})` +
      ` min=(${fmt(total.min.x)},${fmt(total.min.y)},${fmt(total.min.z)})` +
      ` max=(${fmt(total.max.x)},${fmt(total.max.y)},${fmt(total.max.z)})`,
  );
}
