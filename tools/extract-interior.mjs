#!/usr/bin/env node
/**
 * tools/extract-interior.mjs
 *
 * Cuts a componentized, glass-free cabin out of a Stylized Vehicles Pack body.
 * Soviet shells use these cabins without inheriting the donor's windows or door
 * cards. Seats, dashboard, floor/tunnel, shelves and steering wheel remain separate
 * nodes so the runtime can fit the useful structure without stretching side trim
 * through the host doors.
 *
 * The donor's cabin is baked into its body mesh. Window bounds locate the glazed
 * aperture; palette columns reject exterior paint; a conservative side cutoff
 * rejects door cards. The remaining triangles are divided spatially into functional
 * groups. Output coordinates are metres about the donor body centre and carry the
 * donor body size as glTF extras for three-axis fitting in `render/carmodel.ts`.
 *
 * Usage: node tools/extract-interior.mjs <Donor> <out.glb> <paintColumn> [span]
 *   e.g. node tools/extract-interior.mjs Sedan3 public/models/stylized/interior-sedan.glb 22 2
 */
import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

globalThis.document ??= {
  createElementNS: () => ({
    style: {},
    setAttribute() {},
    addEventListener() {},
    removeEventListener() {},
  }),
};


/**
 * `GLTFExporter` reads its own Blob back through a `FileReader` to emit GLB. Bun has
 * Blob but not FileReader, so this is the one method the exporter calls.
 */
globalThis.FileReader ??= class {
  onloadend = null;
  result = null;
  readAsArrayBuffer(blob) {
    void blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.();
    });
  }
};
/** Model-units-to-metres for this pack; keep in sync with vehicle/carmodels.ts. */
const PACK_SCALE = 0.007;
/** Palette grid of the pack's PixelColors image. */
const PALETTE_COLUMNS = 32;

const [donor, out, paintColumnArg, spanArg] = process.argv.slice(2);
if (!donor || !out) {
  console.error('usage: node tools/extract-interior.mjs <Donor> <out.glb> <paintColumn> [span]');
  process.exit(1);
}
const paintColumn = Number(paintColumnArg ?? -1);
const paintSpan = Number(spanArg ?? 2);

const file = `Stylized Vehicles Pack/Models/Detailed/${donor}/${donor}.fbx`;
const buf = readFileSync(file);
const scene = new FBXLoader().parse(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  `Stylized Vehicles Pack/Models/Detailed/${donor}/`,
);
scene.updateMatrixWorld(true);

const WHEELS = new Set(['FL', 'FR', 'BL', 'BR', 'BL2', 'BR2']);
const meshes = [];
scene.traverse((n) => {
  if (n.isMesh) meshes.push(n);
});

const windows = meshes.filter((m) => m.name.startsWith('Window'));
const wheel = meshes.find((m) => m.name === 'steering_wheel');
const body = meshes.find((m) => m.name === donor);
if (!body) throw new Error(`no body mesh named "${donor}"`);
if (windows.length === 0) throw new Error('no Window* meshes to locate the cabin');

/** Body box excluding the wheels — the same box the game measures a chassis from. */
const bodyBox = new THREE.Box3();
for (const m of meshes) {
  if (!WHEELS.has(m.name)) bodyBox.union(new THREE.Box3().setFromObject(m, true));
}

/**
 * The cabin volume: the glazed aperture, opened downward to the body floor and
 * inflated a little so a seat back touching the rear glass is not sliced off.
 * Preserve the authored glass top before inflation: geometry above it is donor
 * roof/lining, not portable cabin furniture.
 */
const cabin = new THREE.Box3();
for (const m of windows) cabin.union(new THREE.Box3().setFromObject(m, true));
const glazingTop = cabin.max.y;
cabin.min.y = bodyBox.min.y;
cabin.expandByScalar(6);

const centroid = new THREE.Vector3();
const a = new THREE.Vector3();
const b = new THREE.Vector3();
const c = new THREE.Vector3();

/** Copies the triangles of `mesh` that pass `keep` into a fresh geometry. */
function cut(mesh, keep) {
  const position = mesh.geometry.attributes.position;
  const uv = mesh.geometry.attributes.uv;
  const normal = mesh.geometry.attributes.normal;
  const index = mesh.geometry.index;
  const count = index ? index.count : position.count;
  const at = (i) => (index ? index.getX(i) : i);
  const kept = [];
  for (let tri = 0; tri * 3 < count; tri++) {
    a.fromBufferAttribute(position, at(tri * 3)).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(position, at(tri * 3 + 1)).applyMatrix4(mesh.matrixWorld);
    c.fromBufferAttribute(position, at(tri * 3 + 2)).applyMatrix4(mesh.matrixWorld);
    centroid.copy(a).add(b).add(c).multiplyScalar(1 / 3);
    let column = -1;
    if (uv) {
      const u =
        (uv.getX(at(tri * 3)) + uv.getX(at(tri * 3 + 1)) + uv.getX(at(tri * 3 + 2))) / 3;
      column = Math.floor(u * PALETTE_COLUMNS);
    }
    if (keep(centroid, column)) kept.push(tri);
  }

  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(mesh.geometry.attributes)) {
    const size = attribute.itemSize;
    const data = new Float32Array(kept.length * 3 * size);
    let w = 0;
    for (const tri of kept) {
      for (let k = 0; k < 3; k++) {
        const vertex = at(tri * 3 + k);
        for (let ch = 0; ch < size; ch++) data[w++] = attribute.getComponent(vertex, ch);
      }
    }
    geometry.setAttribute(name, new THREE.Float32BufferAttribute(data, size));
  }
  if (!normal) geometry.computeVertexNormals();
  return { geometry, triangles: kept.length };
}

const bodySize = bodyBox.getSize(new THREE.Vector3());
const bodyCentre = bodyBox.getCenter(new THREE.Vector3());
const interiorTriangle = (p, column) => {
  if (!cabin.containsPoint(p) || p.y >= glazingTop) return false;
  if (column >= paintColumn && column < paintColumn + paintSpan) return false;
  // Door cards and pillars sit against the donor shell. Reject the entire side
  // band, narrowing it above the seat line where only pillars approach the glass.
  const halfWidthFraction = relY(p) > 0.65 ? 0.25 : 0.36;
  return Math.abs(p.x - bodyCentre.x) < bodySize.x * halfWidthFraction;
};

const relY = (p) => (p.y - bodyBox.min.y) / bodySize.y;
const relZ = (p) => (p.z - bodyCentre.z) / bodySize.z;
const components = [
  ['floor_tunnel', (p) => relY(p) < 0.38],
  ['dashboard', (p) => relY(p) >= 0.38 && relZ(p) > 0.1],
  ['rear_shelf', (p) => relY(p) >= 0.38 && relZ(p) < -0.28],
  ['seats', (p) => relY(p) >= 0.38 && relZ(p) >= -0.28 && relZ(p) <= 0.1],
].map(([name, region]) => [
  name,
  cut(body, (p, column) => interiorTriangle(p, column) && region(p)),
]);

// Metres, about the donor body box's own centre, so the mount is a pure offset. The
// scale lives on the root node and the recentring on each child, which is what lets
// the steering wheel keep its AUTHORED transform: its node origin is the steering
// column's axis, and rotating the mesh about that node is the only way to spin the
// rim in its own plane instead of orbiting it round the cabin.
const centre = bodyCentre;
const group = new THREE.Group();
group.name = 'interior';
group.scale.setScalar(PACK_SCALE);
group.userData.donorBodySize = bodySize.toArray().map((value) => value * PACK_SCALE);
const material = new THREE.MeshStandardMaterial({
  // Deliberately NOT the pack's `PixelColors`: the renderer selects a Stylized
  // body's repaintable paint slot by that name, and a fitted cabin is trim, not
  // coachwork. It still samples the same palette image.
  name: 'InteriorTrim',
  roughness: 0.72,
  metalness: 0.05,
});

for (const [name, component] of components) {
  if (component.triangles === 0) continue;
  const mesh = new THREE.Mesh(component.geometry, material);
  mesh.name = name;
  mesh.geometry.applyMatrix4(body.matrixWorld);
  mesh.geometry.translate(-centre.x, -centre.y, -centre.z);
  group.add(mesh);
}

let wheelTriangles = 0;
if (wheel) {
  const disc = cut(wheel, () => true);
  wheelTriangles = disc.triangles;
  const mesh = new THREE.Mesh(disc.geometry, material);
  mesh.name = 'steering_wheel';
  wheel.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale);
  mesh.position.sub(centre);
  group.add(mesh);
}

for (const child of group.children) child.geometry?.computeBoundingBox();
group.updateMatrixWorld(true);

const half = bodyBox.getSize(new THREE.Vector3()).multiplyScalar(0.5 * PACK_SCALE);
const interiorBox = new THREE.Box3().setFromObject(group, true);
const interiorCentre = interiorBox.getCenter(new THREE.Vector3());

const glb = await new Promise((resolve, reject) => {
  new GLTFExporter().parse(group, resolve, reject, { binary: true });
});
writeFileSync(out, Buffer.from(glb));

const fmt = (v) => +v.toFixed(4);
console.log(
  JSON.stringify(
    {
      donor,
      out,
      bytes: glb.byteLength,
      trimTriangles: components.reduce((sum, [, component]) => sum + component.triangles, 0),
      wheelTriangles,
      donorHalfExtents: half.toArray().map(fmt),
      interiorSize: interiorBox.getSize(new THREE.Vector3()).toArray().map(fmt),
      interiorCentre: interiorCentre.toArray().map(fmt),
      /** Mount point as fractions of the donor body box, ready for `resolveFrac`. */
      mountFrac: [
        fmt(interiorCentre.x / half.x),
        fmt((interiorCentre.y / half.y + 1) / 2),
        fmt(interiorCentre.z / half.z),
      ],
    },
    null,
    1,
  ),
);
