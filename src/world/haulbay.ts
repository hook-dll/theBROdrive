import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { SurfaceType } from '../core/surfaces';
import type { ChunkContext } from './chunks';
import { fitGround } from './footprint';
import { box, C, mergeKitStatics } from './poi/kit';
import { postSlot } from './poislots';
import { matReflector } from './props/delineators';
import type { Road } from './road';
import {
  HAUL_BAY_HALF_DEPTH_M,
  HAUL_BAY_HALF_WIDTH_M,
  HAUL_BAY_WALL_M,
  roadsideStop,
} from './settlement';

/**
 * THE HAUL BAY (game-design2.md §6.3, §7.8): the pen on a settlement's service strip at
 * +4…+7 m from the stop, at right angles to the road and open to the pad. A haul's
 * trailer or car waits in it, and is handed in by reversing into another post's.
 *
 * A concrete floor painted with its side lines and a stop line at the back, and three
 * low walls — the two sides and the back — with red and white bands and a reflector on
 * each wall end at the opening and two on the back wall, so the pen reads in the head
 * lamps of a car backing in at night. The walls are solid; the floor is only drawn, the
 * terrain under it is the levelled lay-by site, so there is no step at the opening.
 */

/** Where a post's haul bay is, ABSOLUTE metres. */
export interface HaulBay {
  /** The middle of the floor inside the walls. */
  readonly x: number;
  readonly z: number;
  /**
   * Heading of a haul standing in it nose out, the way it was reversed in: its forward
   * (sin yaw, cos yaw) points out of the opening onto the pad, its tail at the back wall.
   * The bay's local frame: +X along the road, +Z out of the opening.
   */
  readonly yaw: number;
  /** Inside, half its width (local X) and half its depth (local Z), metres. */
  readonly halfWidth: number;
  readonly halfDepth: number;
  /** The middle of the open side (local +Z at `halfDepth`), where the pad is. */
  readonly openX: number;
  readonly openZ: number;
  /** Arclength hint for terrain sampling. */
  readonly s: number;
}

/**
 * Post stop `index`'s haul bay: pure from the seed and the road, so it needs no chunk
 * built. Hauls are left in it (contracts/world.ts), and the post and its deliveries
 * measure against it.
 */
export function postHaulBay(seed: number, road: Road, index: number): HaulBay {
  const at = roadsideStop(seed, postSlot(index))?.layout.bay;
  if (!at) throw new Error(`postHaulBay: post ${index} has no haul bay`);
  const side = Math.sign(at.lateral);
  const centre = road.offsetPoint(at.s, at.lateral);
  const open = road.offsetPoint(at.s, at.lateral - side * HAUL_BAY_HALF_DEPTH_M);
  return {
    x: centre.x,
    z: centre.z,
    yaw: Math.atan2(open.x - centre.x, open.z - centre.z),
    halfWidth: HAUL_BAY_HALF_WIDTH_M,
    halfDepth: HAUL_BAY_HALF_DEPTH_M,
    openX: open.x,
    openZ: open.z,
    s: at.s,
  };
}

/** Height of the walls, metres: over a bumper, under a mirror. */
const WALL_H = 0.9;
const FLOOR_THICK = 0.14;
/** The floor's top over the fitted ground, metres: clear of the sand, not a step. */
const FLOOR_PROUD = 0.02;
const PAINT_YELLOW = 0xc9a227;
const PAINT_W = 0.1;
/** The stop line, this far in from the back wall, metres. */
const STOP_LINE_IN = 0.35;
const BAND_H = 0.15;
const REFLECTOR = new THREE.BoxGeometry(1, 1, 1);

/**
 * One reflector chip: the delineators' material on a plain mesh receiving shadows, the
 * variant DebrisField's broken-post anchor links at boot (world/debris.ts).
 */
function reflector(parent: THREE.Object3D, x: number, y: number, z: number): void {
  const chip = new THREE.Mesh(REFLECTOR, matReflector);
  chip.scale.set(0.09, 0.14, 0.014);
  chip.position.set(x, y, z);
  chip.receiveShadow = true;
  parent.add(chip);
}

/** Builds `bay` into the chunk: drawn everywhere, solid walls in the physics band. */
export function buildHaulBay(
  ctx: ChunkContext,
  bay: HaulBay,
  group: THREE.Group,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
): void {
  const w = bay.halfWidth;
  const d = bay.halfDepth;
  const t = HAUL_BAY_WALL_M;
  const plane = fitGround(ctx.terrain, bay.x, bay.z, bay.yaw, w + t, d + t, bay.s);

  const root = new THREE.Group();
  root.name = 'haul-bay';
  root.position.set(bay.x - ctx.originX, plane.centreY, bay.z - ctx.originZ);
  root.rotation.set(plane.pitch, bay.yaw, plane.roll, 'YXZ');

  // The floor, its top just proud of the ground, deep enough to bridge what the fit misses.
  const floor = box(root, [2 * (w + t), FLOOR_THICK + plane.residual, 2 * d + t], [0, FLOOR_PROUD - (FLOOR_THICK + plane.residual) / 2, -t / 2], C.concrete);
  floor.castShadow = false;
  // The paint: a line inside each side wall, the stop line at the back.
  const paintY = FLOOR_PROUD + 0.004;
  for (const sx of [-1, 1]) box(root, [PAINT_W, 0.008, 2 * d - 0.2], [sx * (w - 0.15), paintY, 0], PAINT_YELLOW).castShadow = false;
  box(root, [2 * w - 0.5, 0.008, PAINT_W * 1.5], [0, paintY, -d + STOP_LINE_IN], C.white).castShadow = false;

  // The walls: the two sides out to the opening, the back across them.
  const sideLength = 2 * d + t;
  for (const sx of [-1, 1]) {
    const x = sx * (w + t / 2);
    box(root, [t, WALL_H, sideLength], [x, WALL_H / 2, -t / 2], C.concreteLight);
    box(root, [t + 0.02, 0.05, sideLength + 0.02], [x, WALL_H + 0.025, -t / 2], C.white);
    // The wall's end at the opening: red and white bands and a reflector, facing the pad.
    for (let band = 0; band * BAND_H < WALL_H - 0.05; band++) {
      box(root, [t + 0.012, BAND_H, 0.012], [x, (band + 0.5) * BAND_H, d + 0.006], band % 2 === 0 ? C.fadedRed : C.white);
    }
    reflector(root, x, WALL_H - 0.18, d + 0.02);
  }
  box(root, [2 * (w + t), WALL_H, t], [0, WALL_H / 2, -d - t / 2], C.concreteLight);
  box(root, [2 * (w + t) + 0.02, 0.05, t + 0.02], [0, WALL_H + 0.025, -d - t / 2], C.white);
  // Two on the back wall, where the tail lamps of a car backing in find them.
  for (const sx of [-1, 1]) reflector(root, sx * (w - 0.45), 0.6, -d + 0.008);

  mergeKitStatics(root, { deep: true });
  group.add(root);

  if (!ctx.hasPhysics) return;
  root.updateMatrixWorld(true);
  const q = root.quaternion;
  const rotation = { x: q.x, y: q.y, z: q.z, w: q.w };
  const at = new THREE.Vector3();
  const solid = (lx: number, ly: number, lz: number, hx: number, hy: number, hz: number): void => {
    // `root` sits in the chunk's origin frame; `addStatic` takes absolute metres.
    at.set(lx, ly, lz);
    root.localToWorld(at);
    const body = ctx.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(at.x, at.y, at.z));
    const collider = ctx.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setRotation(rotation), body);
    collider.setEnabled(false);
    ctx.physics.surfaces.register(collider.handle, SurfaceType.Concrete);
    bodies.push(body);
    colliders.push(collider);
  };
  for (const sx of [-1, 1]) solid(sx * (w + t / 2), WALL_H / 2, -t / 2, t / 2, WALL_H / 2, sideLength / 2);
  solid(0, WALL_H / 2, -d - t / 2, w + t, WALL_H / 2, t / 2);
}
