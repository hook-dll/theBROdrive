/**
 * Every kit car's cabin places (carkit/interior.ts `KIT_PLACE_NODE`, vehicle/cabin.ts)
 * against every triangle the car is built of, doors shut: the room over each place —
 * its footprint, its height and its front overhang, lifted 3 mm off the surface it
 * stands on — must touch none of them. A thing that fits the room then stands in
 * nothing: not the seat under it, not the seat back, the door, the tunnel or the dash.
 *
 *   npx tsx tools/cabin-places.ts [kit ids…]
 */

import * as THREE from 'three';
import { installAssetShim } from './assetshim';
import { buildKitCar } from '../src/carkit/kit';
import { KIT_SPECS } from '../src/carkit/specs';
import { KitRig } from '../src/carkit/rig';
import { KIT_PLACE_NODE } from '../src/carkit/interior';
import { CABIN_PLACES, type PlaceRoom } from '../src/vehicle/cabin';
import { installProvenance } from './kitlib';

installProvenance();
installAssetShim();

const LIFT = 0.003;
const ids = process.argv.slice(2).length > 0 ? process.argv.slice(2) : Object.keys(KIT_SPECS);
let failures = 0;

const a = new THREE.Vector3();
const b = new THREE.Vector3();
const c = new THREE.Vector3();
const tri = new THREE.Triangle();
const toPlace = new THREE.Matrix4();

for (const id of ids) {
  const root = buildKitCar(id);
  const rig = new KitRig(root, false);
  root.traverse((node) => {
    const motion = node.userData.kitMotion as { channel: string } | undefined;
    if (motion) rig.set(motion.channel, 0, true);
  });
  rig.update(0);
  root.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  root.traverse((node) => {
    if ((node as THREE.Mesh).isMesh) meshes.push(node as THREE.Mesh);
  });
  const rows: string[] = [];
  for (const place of CABIN_PLACES) {
    const node = root.getObjectByName(`${KIT_PLACE_NODE}:${place}`);
    if (!node) {
      rows.push(`${place} —`);
      continue;
    }
    const room = node.userData.kitPlace as PlaceRoom;
    const box = new THREE.Box3(
      new THREE.Vector3(-room.halfX, LIFT, -room.halfZ),
      new THREE.Vector3(room.halfX, room.height, room.halfZ + room.overhang),
    );
    const inverse = node.matrixWorld.clone().invert();
    const hit = new Set<string>();
    const where = new THREE.Box3();
    const clip = new THREE.Box3();
    for (const mesh of meshes) {
      toPlace.multiplyMatrices(inverse, mesh.matrixWorld);
      const position = mesh.geometry.getAttribute('position');
      const index = mesh.geometry.getIndex();
      const count = index ? index.count : position.count;
      for (let i = 0; i < count; i += 3) {
        const ia = index ? index.getX(i) : i;
        const ib = index ? index.getX(i + 1) : i + 1;
        const ic = index ? index.getX(i + 2) : i + 2;
        a.fromBufferAttribute(position, ia).applyMatrix4(toPlace);
        b.fromBufferAttribute(position, ib).applyMatrix4(toPlace);
        c.fromBufferAttribute(position, ic).applyMatrix4(toPlace);
        tri.set(a, b, c);
        if (tri.getArea() < 1e-10) continue;
        if (box.intersectsTriangle(tri)) {
          let name = mesh.name;
          for (let n: THREE.Object3D | null = mesh.parent; n && !name; n = n.parent) name = n.name;
          hit.add(name || '?');
          if (process.env.DEBUG) where.union(clip.setFromPoints([a, b, c]).intersect(box));
        }
      }
    }
    const size = `${(room.halfX * 200).toFixed(0)}×${(room.halfZ * 200).toFixed(0)}+${(room.overhang * 100).toFixed(0)}×${(room.height * 100).toFixed(0)}`;
    if (hit.size > 0) failures++;
    const f = (v: THREE.Vector3): string => `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    const debug = process.env.DEBUG && hit.size > 0 ? ` {${f(where.min)}..${f(where.max)}}` : '';
    rows.push(`${place} ${size}${hit.size > 0 ? ` FAIL[${[...hit].join(',')}]${debug}` : ''}`);
  }
  console.log(`${id.padEnd(16)} ${rows.join('  ')}`);
}
console.log(failures === 0 ? 'PASS: no cabin place touches the car' : `${failures} PLACE(S) TOUCH THE CAR`);
process.exitCode = failures === 0 ? 0 : 1;
