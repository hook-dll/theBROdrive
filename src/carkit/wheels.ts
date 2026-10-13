/**
 * Kit wheels: a lathed tyre with a squared shoulder, a pressed steel rim and the
 * hubcap the car left the factory with. Built about the axle (local X), outer face
 * towards +X, so the left wheels are turned round by their node.
 */

import * as THREE from 'three';
import { PartBuilder, type KitSlot, type Vec3 } from './builder';
import { kitMaterial } from './materials';

const SEGMENTS = 14;

/** Revolves (radius, x) profile points about X into rings joined by quads. */
function lathe(b: PartBuilder, slot: KitSlot, profile: readonly (readonly [number, number])[], segments = SEGMENTS): void {
  const rings: Vec3[][] = profile.map(([r, x]) => {
    const ring: Vec3[] = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      ring.push([x, Math.cos(a) * r, Math.sin(a) * r]);
    }
    return ring;
  });
  for (let i = 0; i + 1 < rings.length; i++) b.bridge(slot, rings[i]!, rings[i + 1]!, true);
}

export interface WheelLook {
  readonly hubcap: 'chrome-dome' | 'small-cap';
}

export function buildWheel(radius: number, width: number, look: WheelLook): THREE.Group {
  const b = new PartBuilder();
  const w = width / 2;
  const rim = radius * 0.62;
  const shoulder = 0.022;
  // Tyre: inner bead, sidewall, squared tread, sidewall, outer bead.
  b.color(0x161617);
  lathe(b, 'tyre', [
    [rim, -w * 0.82],
    [radius - shoulder * 2, -w],
    [radius - shoulder * 0.4, -w * 0.92],
    [radius, -w * 0.7],
    [radius, w * 0.7],
    [radius - shoulder * 0.4, w * 0.92],
    [radius - shoulder * 2, w],
    [rim, w * 0.82],
  ]);
  // Rim: a dished steel disc from the outer bead into the hub.
  lathe(b, 'rim', [
    [rim, w * 0.82],
    [rim * 0.96, w * 0.55],
    [rim * 0.72, w * 0.5],
    [rim * 0.5, w * 0.62],
    [rim * 0.001, w * 0.62],
  ]);
  // Inner face so the wheel is closed from behind.
  lathe(b, 'rim', [
    [rim * 0.001, -w * 0.5],
    [rim, -w * 0.82],
  ]);
  if (look.hubcap === 'chrome-dome') {
    // A full chrome dome over the hub and its bolts.
    lathe(b, 'chrome', [
      [rim * 0.55, w * 0.6],
      [rim * 0.5, w * 0.78],
      [rim * 0.3, w * 0.9],
      [rim * 0.001, w * 0.94],
    ], 12);
  } else {
    // A small centre cap, the four lug bolts round it in the open.
    b.color(0x6f7377);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      b.cylinderX('trim', [w * 0.64, Math.cos(a) * rim * 0.32, Math.sin(a) * rim * 0.32], 0.012, 0.012, 5);
    }
    lathe(b, 'chrome', [
      [rim * 0.24, w * 0.6],
      [rim * 0.2, w * 0.72],
      [rim * 0.001, w * 0.75],
    ], 10);
  }
  const group = new THREE.Group();
  for (const [slot, geometry] of b.build()) {
    const mesh = new THREE.Mesh(geometry, kitMaterial(slot));
    mesh.name = slot;
    group.add(mesh);
  }
  return group;
}
