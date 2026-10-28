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
import { kitBodyMaterial } from './materials';

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

/**
 * One tyre on its disc into `b`, about local X, the disc's face towards +X: `rim` the
 * bead's radius.
 */
export function wheelInto(b: PartBuilder, radius: number, width: number, rim = radius * 0.62): void {
  const w = width / 2;
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
}

/**
 * The placeholder wheel, outer face to +X. `twin`: a dual pair, two tyres that far apart
 * centre to centre about the node (`WheelSpec.twinRear`), the inner one turned round so
 * the two discs face each other's backs as on a truck's hub. `rim`: the bead's radius
 * (`WheelSpec.rimRadius`).
 */
export function buildWheel(radius: number, width: number, twin?: number, rim?: number): THREE.Group {
  const b = new PartBuilder();
  if (twin === undefined) {
    wheelInto(b, radius, width, rim);
  } else {
    b.pushAt([twin / 2, 0, 0]);
    wheelInto(b, radius, width, rim);
    b.pop().pushAt([-twin / 2, 0, 0], [0, Math.PI, 0]);
    wheelInto(b, radius, width, rim);
    b.pop();
  }
  const group = new THREE.Group();
  for (const [slot, geometry] of b.build()) {
    const mesh = new THREE.Mesh(geometry, kitBodyMaterial());
    mesh.name = slot;
    mesh.userData.kitSlot = slot;
    group.add(mesh);
  }
  return group;
}
