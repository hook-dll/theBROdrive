import * as THREE from 'three';
import type { ChunkContext } from './chunks';
import { fitGround } from './footprint';
import { box, C, mergeKitStatics } from './poi/kit';
import { postSlot } from './poislots';
import type { Road } from './road';
import {
  PARKING_SLOT_HALF_DEPTH_M,
  PARKING_SLOT_HALF_WIDTH_M,
  PARKING_SLOT_PITCH_M,
  roadsideStop,
} from './settlement';

/**
 * THE PARKING ROW (game-design2.md §6.3, §7.8): three slots side by side on the post's
 * lay-by, painted on its asphalt in white, each at 45° to the road and leaning with the
 * lay-by's traffic, a herringbone `/ / /` seen from the road. A car arriving turns into
 * a slot nose first; a load is reversed in against the traffic and leaves forward. Each
 * slot is 3.5 m wide, room to walk between two cars parked side by side.
 *
 *  1. PICK-UP, the first a driver reaches: a haul's load waits in it before its card is
 *     taken, nose out, as if reversed in (contracts/world.ts `spawnHaulLoad`).
 *  2. HAND-IN: a haul's load is handed in by reversing it into the destination post's
 *     second slot (contracts/haulbays.ts).
 *  3. SALE: the settlement's car for sale, when it has one (world/poi.ts `buildLot`);
 *     marked and empty otherwise.
 *
 * It replaces the walled pen on the sand past the lay-by's edge, which looked like no
 * part of the place (owner, 2026-10-25). The slots are only paint: no walls, no kerb,
 * nothing to hit; the ground under them is the lay-by's own level pad.
 */

/** One slot, ABSOLUTE metres: the rectangle a car or a load stands in. */
export interface ParkingSlot {
  /** Its middle. */
  readonly x: number;
  readonly z: number;
  /**
   * Heading of a car standing in it nose out, the way it was reversed in: its forward
   * (sin yaw, cos yaw) points out of the opening onto the pad, its tail at the back line.
   * The slot's local frame: +Z out of the opening, X across it.
   */
  readonly yaw: number;
  /** Inside, half its width (local X) and half its depth (local Z), metres. */
  readonly halfWidth: number;
  readonly halfDepth: number;
  /** Arclength hint for terrain sampling. */
  readonly s: number;
}

/** What a slot of the row is for, in the order a driver reaches them. */
export type ParkingSlotRole = 'pickup' | 'handIn' | 'sale';
const ROLE_INDEX: Readonly<Record<ParkingSlotRole, number>> = { pickup: 0, handIn: 1, sale: 2 };

/**
 * Post stop `index`'s three slots, in the order a driver on the lay-by reaches them:
 * pure from the seed and the road, so it needs no chunk built. The row is straight,
 * along the road's tangent at its middle slot (world/settlement.ts `parking`), so the
 * slots' sides meet whatever the road's curve does.
 */
export function postParkingSlots(seed: number, road: Road, index: number): readonly ParkingSlot[] {
  const at = roadsideStop(seed, postSlot(index))?.layout.parking;
  if (!at) throw new Error(`postParkingSlots: post ${index} has no parking row`);
  // The lay-by's traffic runs +s on side -1, -s on side +1.
  const travel = -Math.sign(at.lateral);
  const heading = road.headingAt(at.s);
  const middle = road.offsetPoint(at.s, at.lateral);
  const tx = Math.sin(heading) * travel;
  const tz = Math.cos(heading) * travel;
  const slots: ParkingSlot[] = [];
  for (let k = -1; k <= 1; k++) {
    slots.push({
      x: middle.x + tx * k * PARKING_SLOT_PITCH_M,
      z: middle.z + tz * k * PARKING_SLOT_PITCH_M,
      yaw: heading + at.yaw,
      halfWidth: PARKING_SLOT_HALF_WIDTH_M,
      halfDepth: PARKING_SLOT_HALF_DEPTH_M,
      s: at.s + travel * k * PARKING_SLOT_PITCH_M,
    });
  }
  return slots;
}

/** Post stop `index`'s slot for `role`; see `postParkingSlots`. */
export function postParkingSlot(seed: number, road: Road, index: number, role: ParkingSlotRole): ParkingSlot {
  return postParkingSlots(seed, road, index)[ROLE_INDEX[role]]!;
}

/** The paint, metres: a line's width, and its top over the fitted ground. */
const PAINT_W = 0.12;
const PAINT_PROUD = 0.02;

/**
 * Paints `slots` (`postParkingSlots`) on the lay-by: each slot's sides and its back
 * line, in the kit's white. Only drawn: a car parks on the pad's own collider.
 */
export function buildParkingRow(ctx: ChunkContext, slots: readonly ParkingSlot[], group: THREE.Group): void {
  const root = new THREE.Group();
  root.name = 'parking-row';
  // Which way along local X the next slot lies.
  const first = slots[0]!;
  const last = slots[slots.length - 1]!;
  const next = Math.sign((last.x - first.x) * Math.cos(first.yaw) - (last.z - first.z) * Math.sin(first.yaw));
  slots.forEach((slot, k) => {
    const w = slot.halfWidth;
    const d = slot.halfDepth;
    const plane = fitGround(ctx.terrain, slot.x, slot.z, slot.yaw, w + PAINT_W, d + PAINT_W, slot.s);
    const frame = new THREE.Group();
    frame.position.set(slot.x - ctx.originX, plane.centreY, slot.z - ctx.originZ);
    frame.rotation.set(plane.pitch, slot.yaw, plane.roll, 'YXZ');
    root.add(frame);
    // Deep enough to bridge what the fit misses, its top just proud of the asphalt.
    const thick = PAINT_PROUD + plane.residual;
    const y = PAINT_PROUD - thick / 2;
    const paint = (sx: number, sz: number, x: number, z: number): void => {
      box(frame, [sx, thick, sz], [x, y, z], C.white).castShadow = false;
    };
    // The side the previous slot shares, the far side for the last, the back line.
    paint(PAINT_W, 2 * d, -next * w, 0);
    if (k === slots.length - 1) paint(PAINT_W, 2 * d, next * w, 0);
    paint(2 * w + PAINT_W, PAINT_W, 0, -d);
  });
  mergeKitStatics(root, { deep: true });
  group.add(root);
}
