/**
 * Kit wheels: a lathed tyre with a squared shoulder on a pressed steel or cast rim, and
 * whatever covers its face. Built about the axle (local X), outer face towards +X.
 *
 * Every style fits every kit car: the loader rescales a wheel to the car's own tyre
 * (render/carmodel.ts `cloneWheels`), and each car instance draws one style for all
 * four (`KIT_WHEEL_STYLES`, picked by its appearance key). The styles share the kit's
 * four wheel slots — tyre, rim, chrome and vertex-coloured trim — so a new one costs
 * no shader program.
 */

import * as THREE from 'three';
import { PartBuilder, type KitSlot, type Vec3 } from './builder';
import { kitMaterial } from './materials';

const SEGMENTS = 14;

/** What covers a wheel's face. */
export interface WheelStyle {
  readonly id: string;
  readonly label: string;
  /** The rim's face: dished pressed steel, or a cast alloy face with holes round it. */
  readonly face: 'steel' | 'alloy';
  /** Paint on a steel face, by trim colour; absent, the bare silver of the rim slot. */
  readonly paint?: number;
  /** Over the hub: nothing (four bolts showing), a small cap, a chrome dome, or a full plastic cover. */
  readonly cover: 'bolts' | 'cap' | 'dome' | 'full';
  /** A chrome ring round the rim's edge. */
  readonly ring: boolean;
}

/**
 * The five styles a Zhiguli or a Samara of the period was seen on, all interchangeable:
 * the plain stamped wheel, the factory chrome dome, the dome with a trim ring, the full
 * plastic cover of the eighties, and the cast "daisy".
 */
export const KIT_WHEEL_STYLES: readonly WheelStyle[] = [
  { id: 'steel-cap', label: 'Штамповка с колпачком', face: 'steel', cover: 'cap', ring: false },
  { id: 'steel-dome', label: 'Хромированный колпак', face: 'steel', cover: 'dome', ring: false },
  { id: 'dome-ring', label: 'Колпак с кольцом', face: 'steel', paint: 0x2a2c2e, cover: 'dome', ring: true },
  { id: 'full-cover', label: 'Колпак на весь диск', face: 'steel', cover: 'full', ring: false },
  { id: 'alloy-daisy', label: 'Литьё «ромашка»', face: 'alloy', cover: 'cap', ring: false },
];

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

/**
 * A flat-ish polygon lying on a face of revolution, facing +X, from (y, z) points:
 * each point stands `lift` off the face at its own radius (`faceX`).
 */
function facePoly(b: PartBuilder, slot: KitSlot, faceX: (r: number) => number, lift: number, points: readonly (readonly [number, number])[]): void {
  b.poly(slot, points.map(([y, z]) => [faceX(Math.hypot(y, z)) + lift, y, z] as Vec3));
}

/** Height of a lathe profile at radius r (profile points ordered by falling radius). */
function profileX(profile: readonly (readonly [number, number])[], r: number): number {
  for (let i = 1; i < profile.length; i++) {
    const [r0, x0] = profile[i - 1]!;
    const [r1, x1] = profile[i]!;
    if (r <= r0 && r >= r1) return x0 + ((r - r0) / (r1 - r0 || 1)) * (x1 - x0);
  }
  return profile[profile.length - 1]![1];
}

export function buildWheel(radius: number, width: number, style: WheelStyle): THREE.Group {
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
  // The rim's face: a dished disc from the outer bead into the hub.
  const faceSlot: KitSlot = style.paint === undefined ? 'rim' : 'trim';
  if (style.paint !== undefined) b.color(style.paint);
  const profile: [number, number][] = style.face === 'steel'
    ? [[rim, w * 0.82], [rim * 0.96, w * 0.55], [rim * 0.72, w * 0.5], [rim * 0.5, w * 0.62], [rim * 0.001, w * 0.62]]
    // Cast: a flatter, thicker face flush with the bead.
    : [[rim, w * 0.82], [rim * 0.97, w * 0.74], [rim * 0.3, w * 0.7], [rim * 0.001, w * 0.7]];
  lathe(b, faceSlot, profile);
  // Inner face so the wheel is closed from behind.
  lathe(b, faceSlot, [
    [rim * 0.001, -w * 0.5],
    [rim, -w * 0.82],
  ]);
  if (style.face === 'alloy') {
    // Eight dark petals round the hub: the daisy's holes.
    b.color(0x1c1d1e);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const petal: [number, number][] = [];
      for (let k = 0; k < 6; k++) {
        const t = (k / 6) * Math.PI * 2;
        const along = rim * 0.6 + Math.cos(t) * rim * 0.2;
        const across = Math.sin(t) * rim * 0.11;
        petal.push([Math.cos(a) * along - Math.sin(a) * across, Math.sin(a) * along + Math.cos(a) * across]);
      }
      facePoly(b, 'trim', (r) => profileX(profile, r), 0.002, petal);
    }
  }
  if (style.ring) {
    lathe(b, 'chrome', [
      [rim * 1.02, w * 0.84],
      [rim * 0.97, w * 0.86],
      [rim * 0.86, w * 0.6],
    ]);
  }
  switch (style.cover) {
    case 'bolts':
    case 'cap':
      // Four lug bolts on the pitch circle, and a small chrome cap over the hub.
      b.color(0x6f7377);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        b.cylinderX('trim', [w * 0.64 + (style.face === 'alloy' ? w * 0.08 : 0), Math.cos(a) * rim * 0.32, Math.sin(a) * rim * 0.32], 0.012, 0.012, 5);
      }
      if (style.cover === 'cap') {
        const x0 = style.face === 'alloy' ? w * 0.7 : w * 0.6;
        lathe(b, 'chrome', [
          [rim * 0.24, x0],
          [rim * 0.2, x0 + w * 0.12],
          [rim * 0.001, x0 + w * 0.15],
        ], 10);
      }
      break;
    case 'dome':
      // A wide chrome dome over the hub and its bolts, out to most of the dish.
      lathe(b, 'chrome', [
        [rim * 0.78, w * 0.56],
        [rim * 0.72, w * 0.76],
        [rim * 0.45, w * 0.92],
        [rim * 0.001, w * 0.98],
      ], 12);
      break;
    case 'full': {
      // A light plastic cover over the whole rim, slotted round its edge.
      b.color(0xb9bcbf);
      const cover: [number, number][] = [
        [rim * 1.01, w * 0.86],
        [rim * 0.9, w * 0.95],
        [rim * 0.35, w * 1.0],
        [rim * 0.001, w * 1.02],
      ];
      lathe(b, 'trim', cover);
      b.color(0x232526);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const r0 = rim * 0.62;
        const r1 = rim * 0.86;
        const half = 0.014;
        facePoly(b, 'trim', (r) => profileX(cover, r), 0.002, [
          [ca * r0 - sa * half, sa * r0 + ca * half],
          [ca * r0 + sa * half, sa * r0 - ca * half],
          [ca * r1 + sa * half, sa * r1 - ca * half],
          [ca * r1 - sa * half, sa * r1 + ca * half],
        ]);
      }
      b.color(0x8d9093).cylinderX('chrome', [w * 1.02, 0, 0], rim * 0.16, 0.004, 10);
      break;
    }
  }
  const group = new THREE.Group();
  for (const [slot, geometry] of b.build()) {
    const mesh = new THREE.Mesh(geometry, kitMaterial(slot));
    mesh.name = slot;
    group.add(mesh);
  }
  return group;
}
