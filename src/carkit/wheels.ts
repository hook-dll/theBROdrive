/**
 * The kit car's own wheel: a lathed tyre on a plain dished steel disc, built about the
 * axle (local X), outer face towards +X.
 *
 * It sets where and how big the car's wheels are; what the car is seen on is a set from
 * the Soviet pack (`CarModelDef.wheelSetPool`), rescaled to this tyre by the loader
 * (render/carmodel.ts `cloneWheels`).
 */

import * as THREE from 'three';
import { PartBuilder, type KitSlot, type Vec3 } from './builder';
import { kitMaterial } from './materials';

const SEGMENTS = 14;

/** Revolves (radius, x) profile points about X into rings joined by quads. */
function lathe(b: PartBuilder, slot: KitSlot, profile: readonly (readonly [number, number])[]): void {
  const rings: Vec3[][] = profile.map(([r, x]) => {
    const ring: Vec3[] = [];
    for (let i = 0; i < SEGMENTS; i++) {
      const a = (i / SEGMENTS) * Math.PI * 2;
      ring.push([x, Math.cos(a) * r, Math.sin(a) * r]);
    }
    return ring;
  });
  for (let i = 0; i + 1 < rings.length; i++) b.bridge(slot, rings[i]!, rings[i + 1]!, true);
}

export function buildWheel(radius: number, width: number): THREE.Group {
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
  // A dished disc from the outer bead into the hub, closed from behind.
  lathe(b, 'rim', [[rim, w * 0.82], [rim * 0.96, w * 0.55], [rim * 0.72, w * 0.5], [rim * 0.5, w * 0.62], [rim * 0.001, w * 0.62]]);
  lathe(b, 'rim', [[rim * 0.001, -w * 0.5], [rim, -w * 0.82]]);
  const group = new THREE.Group();
  for (const [slot, geometry] of b.build()) {
    const mesh = new THREE.Mesh(geometry, kitMaterial(slot));
    mesh.name = slot;
    group.add(mesh);
  }
  return group;
}
