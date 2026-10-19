import * as THREE from 'three';
import type { Item } from '../items/items';
import { createItemMesh, disposeItemMeshResources } from '../render/partmesh';
import { setPartCondition } from '../render/materials';
import { KIT_PLACE_NODE } from '../carkit/interior';
import { CABIN_PLACES, layFit, type CabinRooms, type ItemBounds, type PlaceRoom } from './cabin';

/**
 * What lies in a kit car's cabin, drawn (vehicle/cabin.ts): each thing hung from its
 * place's node in the car (carkit/interior.ts `KIT_PLACE_NODE`), so it rides the car,
 * and the front seat's rides that seat. It stands on the place's surface, laid against
 * the back of the room, turned the way `layFit` fits it; a thing on a place the car
 * has none of is not drawn. Moved from one place to another — off a seat onto the
 * floor — it falls there over `FALL_S` rather than jumping.
 *
 * The item meshes are the loose items' own (render/partmesh.ts), whose programs the boot
 * anchor links (`itemProgramAnchor`); in the cabin they cast no shadow, as the cabin
 * does not, so they need no depth program either.
 */

/** A thing stands this far over its place's surface, clear of the cushion's own top. */
const STAND_LIFT = 0.004;
/** How long a thing takes to fall from a seat to the floor, seconds. */
const FALL_S = 0.35;

/** Each look's drawn bounds about its mesh's origin, measured once. */
const boundsCache = new Map<string, THREE.Box3>();

/** The key a thing's look is drawn by: things with one key are drawn alike. */
function lookKey(item: Item): string {
  switch (item.type) {
    case 'part':
      return `part:${item.part.variantId}`;
    case 'tool':
      return `tool:${item.tool}`;
    case 'fluid_can':
      return `fluid:${item.fluid}:${item.capacity}`;
    case 'quarry':
      return `quarry:${item.mass}`;
    case 'contract_cargo':
      return `cargo:${item.contractKind}:${item.shape ?? ''}`;
    default:
      return item.type;
  }
}

function lookBox(item: Item): THREE.Box3 {
  const key = lookKey(item);
  let box = boundsCache.get(key);
  if (!box) {
    const mesh = createItemMesh(item);
    box = new THREE.Box3().setFromObject(mesh);
    disposeItemMeshResources(mesh);
    boundsCache.set(key, box);
  }
  return box;
}

/** A thing's drawn size, metres, unturned (`ItemBounds`): what decides where it fits. */
export function cabinItemBounds(item: Item): ItemBounds {
  const box = lookBox(item);
  return { x: box.max.x - box.min.x, y: box.max.y - box.min.y, z: box.max.z - box.min.z };
}

interface Shown {
  readonly item: Item;
  readonly mesh: THREE.Object3D;
  place: number;
  /** Where it lies at rest on its place, in its holder's frame. */
  readonly rest: { position: THREE.Vector3; quaternion: THREE.Quaternion };
  /** The fall in progress: the pose it left, in its new holder's frame, and when (ms). */
  fall: { readonly position: THREE.Vector3; readonly quaternion: THREE.Quaternion; readonly started: number } | null;
}

export class CabinCargoView {
  /** Under each place's node, undoing the car's fitted scale so things keep their own size; null where the car has no such place. */
  private readonly holders: (THREE.Group | null)[];
  private shown: (Shown | null)[];
  /** Each place's room in metres, for laying things (vehicle/cabin.ts). */
  readonly rooms: CabinRooms;
  private readonly matrix = new THREE.Matrix4();
  private readonly scale = new THREE.Vector3();

  constructor(body: THREE.Object3D) {
    body.updateMatrixWorld(true);
    const rootScale = body.parent ? body.parent.getWorldScale(new THREE.Vector3()).x : 1;
    const rooms: (PlaceRoom | null)[] = [];
    this.holders = CABIN_PLACES.map((place) => {
      const node = body.getObjectByName(`${KIT_PLACE_NODE}:${place}`);
      if (!node) {
        rooms.push(null);
        return null;
      }
      // The node's scale against the car's root: the kit body's fit.
      const scale = node.getWorldScale(new THREE.Vector3()).x / rootScale;
      const room = node.userData.kitPlace as PlaceRoom;
      rooms.push({ halfX: room.halfX * scale, halfZ: room.halfZ * scale, height: room.height * scale, overhang: room.overhang * scale });
      const holder = new THREE.Group();
      holder.name = 'cabin_cargo';
      holder.scale.setScalar(1 / scale);
      node.add(holder);
      return holder;
    });
    this.rooms = rooms;
    this.shown = CABIN_PLACES.map(() => null);
  }

  /** Each frame the car is drawn near: what lies where, against what is drawn. */
  sync(cabin: readonly (Item | null)[], now: number): void {
    let changed = false;
    for (let place = 0; place < this.shown.length; place++) {
      if ((this.shown[place]?.item ?? null) !== (cabin[place] ?? null)) changed = true;
    }
    if (changed) this.relay(cabin, now);
    for (const shown of this.shown) if (shown?.fall) this.animate(shown, now);
  }

  /** The place a drawn thing lies on, from any of its parts, or -1. */
  placeOf(object: THREE.Object3D): number {
    for (let node: THREE.Object3D | null = object; node; node = node.parent) {
      const place = node.userData.cabinPlace as number | undefined;
      if (place !== undefined) return place;
    }
    return -1;
  }

  dispose(): void {
    for (const shown of this.shown) if (shown) this.release(shown);
    this.shown = CABIN_PLACES.map(() => null);
    for (const holder of this.holders) holder?.removeFromParent();
  }

  /** Draws `cabin` afresh, carrying each thing that moved over to its new place. */
  private relay(cabin: readonly (Item | null)[], now: number): void {
    const pool = new Map<Item, Shown>();
    for (const shown of this.shown) if (shown) pool.set(shown.item, shown);
    const next: (Shown | null)[] = CABIN_PLACES.map(() => null);
    for (let place = 0; place < next.length; place++) {
      const item = cabin[place];
      if (!item) continue;
      const holder = this.holders[place];
      const room = this.rooms[place];
      const old = pool.get(item);
      pool.delete(item);
      if (!holder || !room) {
        if (old) this.release(old);
        continue;
      }
      if (old && old.place === place) {
        next[place] = old;
        continue;
      }
      let mesh: THREE.Object3D;
      let fall: Shown['fall'] = null;
      if (old) {
        mesh = old.mesh;
        // Where it was, seen from its new place: it falls from there.
        mesh.updateWorldMatrix(true, false);
        holder.updateWorldMatrix(true, false);
        this.matrix.copy(holder.matrixWorld).invert().multiply(mesh.matrixWorld);
        const position = new THREE.Vector3();
        const quaternion = new THREE.Quaternion();
        this.matrix.decompose(position, quaternion, this.scale);
        fall = { position, quaternion, started: now };
      } else {
        mesh = createItemMesh(item);
        if (item.type === 'part') setPartCondition(mesh, item.part);
        mesh.traverse((node) => {
          node.castShadow = false;
        });
      }
      mesh.userData.cabinPlace = place;
      holder.add(mesh);
      const rest = restPose(item, room);
      mesh.position.copy(fall ? fall.position : rest.position);
      mesh.quaternion.copy(fall ? fall.quaternion : rest.quaternion);
      next[place] = { item, mesh, place, rest, fall };
    }
    for (const shown of pool.values()) this.release(shown);
    this.shown = next;
  }

  private release(shown: Shown): void {
    shown.mesh.removeFromParent();
    disposeItemMeshResources(shown.mesh);
  }

  private animate(shown: Shown, now: number): void {
    const fall = shown.fall!;
    const t = Math.min(1, (now - fall.started) / (FALL_S * 1000));
    // Falling: slow off the edge, fast onto the floor; turning as it goes.
    shown.mesh.position.lerpVectors(fall.position, shown.rest.position, t * t);
    shown.mesh.quaternion.slerpQuaternions(fall.quaternion, shown.rest.quaternion, Math.min(1, t * 1.4));
    if (t >= 1) shown.fall = null;
  }
}

/** On the room's surface, against its back, centred across, turned the way it fits. */
function restPose(item: Item, room: PlaceRoom): { position: THREE.Vector3; quaternion: THREE.Quaternion } {
  const box = lookBox(item);
  const turned = layFit(cabinItemBounds(item), room)?.turned ?? false;
  // Turned a quarter about up: its x runs back along the car (x' = z, z' = -x).
  const minX = turned ? box.min.z : box.min.x;
  const maxX = turned ? box.max.z : box.max.x;
  const minZ = turned ? -box.max.x : box.min.z;
  const maxZ = turned ? -box.min.x : box.max.z;
  return {
    position: new THREE.Vector3(-(minX + maxX) / 2, STAND_LIFT - box.min.y, -room.halfZ - minZ),
    quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), turned ? Math.PI / 2 : 0),
  };
}
