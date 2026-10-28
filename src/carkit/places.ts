import * as THREE from 'three';
import type { PlaceRoom } from '../vehicle/cabin';
import { KIT_PLACE_NODE } from './interior';

/**
 * Fits each cabin place's room (interior.ts `KIT_PLACE_NODE`) to the finished car.
 *
 * The interior lays a room out from the seat it stands on: over the cushion to the
 * seat back's foot, between the tunnel and the door. What else reaches into it differs
 * by car and is not the seat's to know: a glovebox hanging low before the front seat,
 * a front seat's back leaning over the bench's front edge, an ashtray in a door card,
 * the sills under a footwell's edge. So the room is cut here against every triangle of
 * the built car, doors shut, until none touches it: each touching triangle is cut off
 * by the one face of the room (top, a side, the front, the back) that loses the least
 * room. A place left too small for anything is taken out.
 *
 * tools/cabin-places.ts checks the result against the same triangles.
 */

/** The room starts this far over its surface: the cushion's own top is not in it. */
export const PLACE_LIFT = 0.003;
/** A cut stops this short of what it cuts against. */
const CUT_CLEAR = 0.01;
/** The least room worth keeping: across, along, up. */
const MIN_WIDTH = 0.16;
const MIN_DEPTH = 0.12;
const MIN_HEIGHT = 0.1;
/** Passes over the triangles before a place that keeps being cut is given up. */
const MAX_PASSES = 24;

interface Room {
  x0: number;
  x1: number;
  z0: number;
  /** Front of the surface's own part of the room. */
  z1: number;
  /** Front of the room with its overhang: at least `z1`. */
  zo: number;
  height: number;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _tri = new THREE.Triangle();
const _box = new THREE.Box3();
const _w = new THREE.Box3();
const _m = new THREE.Matrix4();
const _bounds = new THREE.Box3();

export function fitCabinPlaces(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  const places: THREE.Object3D[] = [];
  const meshes: THREE.Mesh[] = [];
  root.traverse((node) => {
    if (node.name.startsWith(`${KIT_PLACE_NODE}:`)) places.push(node);
    else if ((node as THREE.Mesh).isMesh) meshes.push(node as THREE.Mesh);
  });
  for (const node of places) fitPlace(node, meshes);
}

function fitPlace(node: THREE.Object3D, meshes: readonly THREE.Mesh[]): void {
  const start = node.userData.kitPlace as PlaceRoom;
  const room: Room = {
    x0: -start.halfX,
    x1: start.halfX,
    z0: -start.halfZ,
    z1: start.halfZ,
    zo: start.halfZ + start.overhang,
    height: start.height,
  };
  const inverse = node.matrixWorld.clone().invert();
  // The room in the car's frame, grown, to skip meshes nowhere near it.
  const reach = new THREE.Box3(
    new THREE.Vector3(room.x0, 0, room.z0),
    new THREE.Vector3(room.x1, room.height, room.zo),
  ).applyMatrix4(node.matrixWorld);
  const near = meshes.filter((mesh) => {
    mesh.geometry.computeBoundingBox();
    return _bounds.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld).intersectsBox(reach);
  });

  // The room only shrinks from pass to pass, so a triangle whose box misses the first
  // room (or that has no area) never touches it: the passes go over the rest, in the node's
  // frame, in the meshes' order.
  const first = new THREE.Box3(new THREE.Vector3(room.x0, PLACE_LIFT, room.z0), new THREE.Vector3(room.x1, room.height, room.zo)).expandByScalar(1e-6);
  const tris: number[] = [];
  for (const mesh of near) {
    _m.multiplyMatrices(inverse, mesh.matrixWorld);
    const position = mesh.geometry.getAttribute('position');
    const index = mesh.geometry.getIndex();
    const count = index ? index.count : position.count;
    for (let i = 0; i < count; i += 3) {
      _a.fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(_m);
      _b.fromBufferAttribute(position, index ? index.getX(i + 1) : i + 1).applyMatrix4(_m);
      _c.fromBufferAttribute(position, index ? index.getX(i + 2) : i + 2).applyMatrix4(_m);
      _tri.set(_a, _b, _c);
      if (_tri.getArea() < 1e-10) continue;
      if (!_w.setFromPoints([_a, _b, _c]).intersectsBox(first)) continue;
      tris.push(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z, _c.x, _c.y, _c.z);
    }
  }

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let cut = false;
    for (let i = 0; i < tris.length; i += 9) {
      _a.set(tris[i]!, tris[i + 1]!, tris[i + 2]!);
      _b.set(tris[i + 3]!, tris[i + 4]!, tris[i + 5]!);
      _c.set(tris[i + 6]!, tris[i + 7]!, tris[i + 8]!);
      _tri.set(_a, _b, _c);
      _box.min.set(room.x0, PLACE_LIFT, room.z0);
      _box.max.set(room.x1, room.height, room.zo);
      if (!_box.intersectsTriangle(_tri)) continue;
      _w.setFromPoints([_a, _b, _c]).intersect(_box);
      if (!cutRoom(room, _w)) {
        node.removeFromParent();
        return;
      }
      cut = true;
    }
    if (!cut) {
      store(node, room);
      return;
    }
  }
  node.removeFromParent();
}

/**
 * Cuts the room clear of `w` (a touching triangle's extent inside it) by the face that
 * keeps the most room; false when every cut leaves too little.
 */
function cutRoom(room: Room, w: THREE.Box3): boolean {
  const width = room.x1 - room.x0;
  const depth = room.zo - room.z0;
  type Cut = { volume: number; apply: () => void };
  const cuts: Cut[] = [];
  const consider = (w2: number, d2: number, h2: number, apply: () => void): void => {
    if (w2 < MIN_WIDTH || h2 < MIN_HEIGHT || d2 < MIN_DEPTH) return;
    cuts.push({ volume: w2 * d2 * h2, apply });
  };
  const top = w.min.y - CUT_CLEAR;
  consider(width, depth, top, () => (room.height = top));
  const left = w.min.x - CUT_CLEAR;
  consider(left - room.x0, depth, room.height, () => (room.x1 = left));
  const right = w.max.x + CUT_CLEAR;
  consider(room.x1 - right, depth, room.height, () => (room.x0 = right));
  const back = w.max.z + CUT_CLEAR;
  consider(width, room.zo - back, room.height, () => {
    room.z0 = back;
    room.z1 = Math.max(room.z1, back);
  });
  const front = w.min.z - CUT_CLEAR;
  // Over the surface's own front edge only the overhang goes; under it, the room's depth.
  consider(width, front - room.z0, room.height, () => {
    room.zo = front;
    room.z1 = Math.min(room.z1, front);
  });
  if (cuts.length === 0) return false;
  let best = cuts[0]!;
  for (const cut of cuts) if (cut.volume > best.volume) best = cut;
  best.apply();
  return true;
}

/** The fitted room back on the node, the node moved to its middle on the surface. */
function store(node: THREE.Object3D, room: Room): void {
  const cx = (room.x0 + room.x1) / 2;
  const cz = (room.z0 + room.z1) / 2;
  // In the node's own turned frame, then into its parent's.
  node.position.add(_a.set(cx, 0, cz).applyQuaternion(node.quaternion));
  const room2: PlaceRoom = {
    halfX: (room.x1 - room.x0) / 2,
    halfZ: (room.z1 - room.z0) / 2,
    height: room.height,
    overhang: Math.max(0, room.zo - room.z1),
  };
  node.userData.kitPlace = room2;
}
