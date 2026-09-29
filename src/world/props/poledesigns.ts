/**
 * The roadside pole catalogue: ninety plain, believable line poles, each on one support.
 *
 * WHAT THIS REPLACED. The pole line used to be three silhouettes — a timber mast, a
 * lattice mast and a concrete streetlight — each with a lamp head, and one wire strung
 * top to top. A single hand-made form per era meant that a three-hundred-kilometre band
 * was the same pole seven thousand times, and none of them was a pole anybody builds:
 * a line carries its wires on insulators, on arms, at the height the voltage wants.
 *
 * WHAT A DESIGN IS. Twelve families of real roadside construction — telegraph poles,
 * rural three-phase, bracket telephone poles, timber on a concrete stub, rectangular,
 * spun and octagonal concrete, double-circuit concrete, lattice masts, tubular steel,
 * Oppenheimer telescoping steel, and rail or I-beam poles — each enumerated into a
 * handful of variants by DISCRETE choices (arm count, insulator layout and material,
 * cap, braces, fittings), with height, taper and
 * spacing drawn from the design's own hash. Discrete choices step through their lists
 * with the variant index rather than being rolled, which is what guarantees that two
 * designs of one family never come out as the same pole. Nothing is ornamental: the
 * owner asked for poles that are not fancy, and every part here is one that holds a
 * wire up or holds the pole up.
 *
 * FRAME. Metres, ground at y = 0, the pole's own axis on y. +X is LEFT of travel —
 * over the carriageway, because the line stands right of the road (see `twist` in
 * poles.ts) — and Z runs along the road, which is the direction the wires leave in.
 * No part reaches further than 2.6 m toward the road: the line stands 3.1 m outside
 * the asphalt edge, so the most a lean can add still leaves an arm over the gravel.
 *
 * DRAWING. Every design is one vertex-coloured geometry in one comic-banded material,
 * built with the same `DwellingBuilder` the houses use, so a pole is one draw call
 * however many insulators it carries. Each design is built twice: FULL, and MAST
 * only (the structure without arms and insulators) for a pole that has been
 * stripped. Both are built on first use and kept.
 */

import * as THREE from 'three';
import { hash01 } from '../../core/rng';
import { applyComicShading } from '../../render/comic';
import { DwellingBuilder, shade, type P2, type P3, type Weathering } from '../dwellings/builder';
import type { PoleEra } from '../gradient';

/** Height up the shaft that line gear (anomalies in poles.ts) is bolted at. */
export const POLE_GEAR_Y = 3.4;

/** One leg of a pole: where it stands on local X and how thick it is there. */
export interface PoleLeg {
  readonly x: number;
  readonly r: number;
}

/** A point a wire is tied to, and the wire it carries. */
export interface PoleWire {
  readonly at: P3;
  readonly radius: number;
  readonly hex: number;
}

export interface PoleDesign {
  readonly id: number;
  readonly era: PoleEra;
  /** Short Russian description, for the prop gallery. */
  readonly name: string;
  /** Metres between poles of this design. */
  readonly spacing: number;
  /** Top of the structure, metres. */
  readonly height: number;
  /** Wire ties, in the same order on every pole of the design. */
  readonly wires: readonly PoleWire[];
  /** Where a nest sits: on an arm or on the top. */
  readonly nest: P3;
  /** The leg a tarp is tied round, with its radius at the foot. */
  readonly foot: PoleLeg;
  /** The leg line gear is bolted to, with its radius at `POLE_GEAR_Y`. */
  readonly gear: PoleLeg;
  /** One upright capsule per leg for the collider. */
  readonly legs: readonly PoleLeg[];
  readonly full: THREE.BufferGeometry;
  readonly mast: THREE.BufferGeometry;
}

// ---------------------------------------------------------------------------
// Palette. sRGB hex, as the dwellings author theirs.
// ---------------------------------------------------------------------------

const TIMBER = [0x3a2d22, 0x5c4a3a, 0x7d7266, 0x8f8574, 0x6a4a34, 0x4a3c30] as const;
const CONCRETE = [0xb3afa4, 0x9f9c94, 0xb9ab93, 0xa9a79f, 0xc0b9aa] as const;
const STEEL = [0x8e9295, 0x767a7c, 0x4e5357, 0x5c6a5d, 0x6d4633, 0x9a9a92] as const;
const IRON = [0x47433e, 0x6a4634, 0x6c6d68] as const;
const HARDWARE = 0x55585a;
const HARDWARE_DARK = 0x3a3b3c;

interface Insulator {
  readonly hex: number;
  readonly name: string;
}
const GLASS: readonly Insulator[] = [
  { hex: 0x7fbfb0, name: 'бирюзовое стекло' },
  { hex: 0xbfd0ca, name: 'прозрачное стекло' },
  { hex: 0x5f9c7a, name: 'зелёное стекло' },
  { hex: 0x9c6a30, name: 'янтарное стекло' },
  { hex: 0x4f6f9e, name: 'синее стекло' },
  { hex: 0x9fb7a8, name: 'бледное стекло' },
];
const PORCELAIN: readonly Insulator[] = [
  { hex: 0xe4e0d6, name: 'белый фарфор' },
  { hex: 0x6b3b25, name: 'коричневый фарфор' },
  { hex: 0x8a8c86, name: 'серый фарфор' },
];
const POLYMER: readonly Insulator[] = [
  { hex: 0x7c7e79, name: 'серый полимер' },
  { hex: 0x8b4a39, name: 'красный полимер' },
  { hex: 0x5a5e5a, name: 'тёмный полимер' },
];
const POWER_INSULATORS: readonly Insulator[] = [...PORCELAIN, GLASS[2]!, ...POLYMER];

/** Old copper and iron line wire, and the pale aluminium of later conductors. */
const WIRE_DARK = 0x3a3430;
const WIRE_ALUMINIUM = 0x7a7c7e;
const WIRE_CABLE = 0x1c1c1c;

function pickOf<T>(list: readonly T[], i: number): T {
  return list[((i % list.length) + list.length) % list.length]!;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ---------------------------------------------------------------------------
// Drawing context and shared parts
// ---------------------------------------------------------------------------

interface Draw {
  readonly b: DwellingBuilder;
  /** False for the MAST build: structure only, nothing that carries a wire. */
  readonly fittings: boolean;
  readonly wires: PoleWire[];
  nest: P3 | null;
}

/** Wire style a family ties onto everything it hangs. */
interface WireStyle {
  readonly radius: number;
  readonly hex: number;
}

/** A tapering round (or faceted) shaft. `wobble` bends a log's outline a little. */
function shaft(
  b: DwellingBuilder,
  x: number,
  z: number,
  y0: number,
  y1: number,
  r0: number,
  r1: number,
  hex: number | ((segment: number) => number),
  sides: number,
  smooth: boolean,
  rings = 4,
  wobble: (ring: number) => number = () => 1,
): void {
  const profile: P2[] = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    profile.push([lerp(r0, r1, t) * wobble(i), lerp(y0, y1, t)]);
  }
  b.lathe(x, z, profile, sides, hex, { smooth });
}

/** A straight-tapered rectangular column, the section of cast concrete. */
function column(
  b: DwellingBuilder,
  x: number,
  y0: number,
  y1: number,
  hx0: number,
  hz0: number,
  hx1: number,
  hz1: number,
  hex: number,
): void {
  b.hexa(
    [
      [x - hx0, y0, -hz0], [x + hx0, y0, -hz0], [x + hx0, y0, hz0], [x - hx0, y0, hz0],
      [x - hx1, y1, -hz1], [x + hx1, y1, -hz1], [x + hx1, y1, hz1], [x - hx1, y1, hz1],
    ],
    hex,
  );
}

/** A glass telegraph insulator on its steel pin, standing on `y`. */
const PIN_GLASS: readonly P2[] = [
  [0.046, 0], [0.05, 0.012], [0.047, 0.03], [0.034, 0.045], [0.034, 0.06], [0.04, 0.066],
  [0.041, 0.082], [0.032, 0.098], [0.016, 0.108], [0, 0.112],
];
/** A two-skirt power pin insulator. */
const PIN_POWER: readonly P2[] = [
  [0.05, 0], [0.058, 0.01], [0.05, 0.03], [0.07, 0.04], [0.075, 0.05], [0.06, 0.065],
  [0.052, 0.075], [0.085, 0.09], [0.09, 0.1], [0.07, 0.115], [0.05, 0.13], [0.055, 0.14],
  [0.05, 0.158], [0.03, 0.172], [0, 0.176],
];

function pin(d: Draw, x: number, y: number, z: number, hex: number, wire: WireStyle, power = false, scale = 1): void {
  if (!d.fittings) return;
  const stem = 0.04 * scale;
  d.b.cylinder(x, z, y, y + stem + 0.01, 0.011 * scale, HARDWARE, 6);
  const profile = power ? PIN_POWER : PIN_GLASS;
  d.b.lathe(x, z, profile.map(([r, py]) => [r * scale, y + stem + py * scale] as P2), 9, hex);
  // The tie is in the groove under the crown, which is where the wire really rides.
  d.wires.push({ at: [x, y + stem + (power ? 0.14 : 0.075) * scale, z], ...wire });
}

/** The ribbed body of a line-post insulator, standing on the origin, `sheds` high. */
function postBody(b: DwellingBuilder, hex: number, sheds: number): number {
  b.cylinder(0, 0, 0, 0.05, 0.042, HARDWARE, 8);
  const profile: P2[] = [[0.034, 0.05]];
  let y = 0.07;
  for (let i = 0; i < sheds; i++) {
    profile.push([0.034, y], [0.082, y + 0.012], [0.08, y + 0.022], [0.034, y + 0.036]);
    y += 0.052;
  }
  profile.push([0.034, y + 0.01], [0.03, y + 0.02]);
  b.lathe(0, 0, profile, 10, hex);
  b.cylinder(0, 0, y + 0.02, y + 0.07, 0.036, HARDWARE, 8);
  return y + 0.07;
}

/** An upright line-post insulator. */
function post(d: Draw, x: number, y: number, z: number, hex: number, wire: WireStyle, sheds: number): void {
  if (!d.fittings) return;
  let top = 0;
  d.b.at(x, y, z, 0, () => {
    top = postBody(d.b, hex, sheds);
  });
  d.wires.push({ at: [x, y + top - 0.02, z], ...wire });
}

/** A line-post insulator bolted flat out of a pole's side, pointing along `side` X. */
function sidePost(d: Draw, x: number, y: number, z: number, side: 1 | -1, hex: number, wire: WireStyle, sheds: number): void {
  if (!d.fittings) return;
  let length = 0;
  // Roll -PI/2 turns the post's own +Y onto +X; +PI/2 onto -X.
  d.b.at(x, y, z, 0, () => {
    length = postBody(d.b, hex, sheds);
  }, 0, -side * Math.PI * 0.5);
  d.wires.push({ at: [x + side * (length - 0.02), y + 0.03, z], ...wire });
}

/** A string of cap-and-pin discs hanging from `yTop`, the wire clamped at its foot. */
function string(d: Draw, x: number, yTop: number, z: number, hex: number, wire: WireStyle, discs: number): void {
  if (!d.fittings) return;
  const b = d.b;
  b.box(x - 0.015, yTop - 0.08, z - 0.03, x + 0.015, yTop, z + 0.03, HARDWARE);
  const bottom = yTop - 0.08 - discs * 0.14 - 0.06;
  const profile: P2[] = [[0.014, bottom + 0.06]];
  for (let j = 0; j < discs; j++) {
    const y = bottom + 0.06 + j * 0.14;
    profile.push([0.02, y + 0.012], [0.118, y + 0.034], [0.122, y + 0.044], [0.05, y + 0.074], [0.02, y + 0.11], [0.014, y + 0.14]);
  }
  b.lathe(x, z, profile, 10, hex);
  b.box(x - 0.025, bottom, z - 0.07, x + 0.025, bottom + 0.06, z + 0.07, HARDWARE_DARK);
  d.wires.push({ at: [x, bottom + 0.02, z], ...wire });
}

/** A porcelain spool on a D-bracket standing `out` metres off a shaft face at x = `face`. */
function spool(d: Draw, face: number, y: number, z: number, side: 1 | -1, hex: number, wire: WireStyle): void {
  if (!d.fittings) return;
  const b = d.b;
  const x = face + side * 0.16;
  b.box(Math.min(face, x + side * 0.04), y - 0.012, z - 0.02, Math.max(face, x + side * 0.04), y, z + 0.02, HARDWARE);
  b.box(Math.min(face, x + side * 0.04), y + 0.07, z - 0.02, Math.max(face, x + side * 0.04), y + 0.082, z + 0.02, HARDWARE);
  b.lathe(x, z, [[0.028, y], [0.04, y + 0.008], [0.03, y + 0.022], [0.03, y + 0.048], [0.04, y + 0.062], [0.028, y + 0.07]], 9, hex);
  d.wires.push({ at: [x, y + 0.035, z], ...wire });
}

/** A crossarm along X on the +Z face of a shaft. */
function arm(b: DwellingBuilder, y: number, x0: number, x1: number, z: number, hex: number, width = 0.09, depth = 0.1): void {
  b.box(x0, y - depth / 2, z - width / 2, x1, y + depth / 2, z + width / 2, hex, shade(hex, 1.08));
}

/** A flat steel strap brace from an arm down to the shaft face. */
function strap(b: DwellingBuilder, a: P3, c: P3): void {
  b.beam(a, c, 0.04, HARDWARE_DARK, 0.01);
}

/** Top of a timber pole: sawn flat, cut to a shallow point, or under a tin cap. */
type TimberCap = 'flat' | 'bevel' | 'tin' | 'roof';
function timberCap(b: DwellingBuilder, x: number, h: number, r: number, wood: number, cap: TimberCap): void {
  if (cap === 'bevel') b.cone(x, 0, h, r, 0.07, shade(wood, 0.85), 9);
  else if (cap === 'tin') {
    b.cylinder(x, 0, h - 0.04, h + 0.012, r + 0.018, 0x77736a, 9);
    b.cone(x, 0, h + 0.012, r + 0.018, 0.035, 0x77736a, 9);
  } else if (cap === 'roof') {
    b.gable(x - r - 0.03, x + r + 0.03, -r - 0.05, r + 0.05, h, h + 0.09, {
      roof: shade(wood, 0.8), axis: 'x', over: 0.03, end: 0.02, thick: 0.02, cap: null,
    });
  }
}

/** A step bolt: what a lineman climbs a timber pole on, alternating sides along Z. */
function steps(b: DwellingBuilder, x: number, y0: number, y1: number, radiusAt: (y: number) => number): void {
  let side = 1;
  for (let y = y0; y < y1; y += 0.42) {
    const r = radiusAt(y);
    b.beam([x, y, side * (r - 0.01)], [x, y + 0.01, side * (r + 0.13)], 0.018, HARDWARE_DARK);
    side = -side;
  }
}

/** A copper ground wire stapled down the back (-Z) face of a timber pole. */
function groundWire(b: DwellingBuilder, x: number, h: number, r0: number, r1: number): void {
  b.beam([x, 0.2, -r0 - 0.004], [x, h - 0.25, -r1 - 0.004], 0.013, 0x4a3a2c, 0.008);
}

/** A timber log shaft with a slightly irregular outline, from the design's hash. */
function logShaft(b: DwellingBuilder, x: number, y0: number, h: number, r0: number, r1: number, wood: number, h1: (k: number) => number, salt: number): void {
  shaft(b, x, 0, y0, h, r0, r1, wood, 9, true, 5, (ring) => 1 + (h1(salt + ring) - 0.5) * 0.07);
}

// ---------------------------------------------------------------------------
// Families
// ---------------------------------------------------------------------------

interface Plan {
  readonly name: string;
  readonly spacing: number;
  readonly height: number;
  readonly weather: Weathering;
  readonly foot: PoleLeg;
  readonly gear: PoleLeg;
  readonly legs: readonly PoleLeg[];
  draw(d: Draw): void;
}

type HashFn = (k: number) => number;
type Family = (v: number, h: HashFn) => Plan;

function timberWeather(h: HashFn): Weathering {
  return { fade: 0.15 + h(90) * 0.3, grime: 0.28, patchy: 0.22 };
}

/** A. The telegraph pole: arms of glass insulators, the oldest line on any desert road. */
const telegraph: Family = (v, h) => {
  const layouts: readonly (readonly [number, number])[] = [[1, 2], [1, 4], [2, 2], [2, 4], [1, 6], [3, 2], [2, 4], [1, 4], [2, 2], [3, 2]];
  const [arms, pins] = pickOf(layouts, v);
  const height = 6.2 + h(1) * 1.4;
  const r0 = 0.13 + h(2) * 0.03;
  const r1 = 0.085 + h(3) * 0.02;
  const wood = pickOf(TIMBER, v * 5 + 1);
  const armWood = v % 3 === 0 ? 0x857b6c : shade(wood, 1.1);
  const glass = pickOf(GLASS, v * 3 + (v >> 1));
  const cap = pickOf<TimberCap>(['bevel', 'flat', 'tin', 'roof'], v + (v >> 2));
  const braces = v % 3 !== 1;
  const topPin = arms * pins < 8 && v % 4 === 2;
  const climbable = v % 2 === 0;
  const armLength = pins >= 6 ? 2.3 : pins === 4 ? 1.7 + h(5) * 0.3 : 1.1 + h(5) * 0.4;
  const radiusAt = (y: number): number => lerp(r0, r1, y / height);
  const wire: WireStyle = { radius: 0.01, hex: WIRE_DARK };
  return {
    name: `Телеграфный · ${arms} × ${pins} · ${glass.name}`,
    spacing: 42 + h(6) * 6,
    height,
    weather: timberWeather(h),
    foot: { x: 0, r: r0 },
    gear: { x: 0, r: radiusAt(POLE_GEAR_Y) },
    legs: [{ x: 0, r: 0.15 }],
    draw(d) {
      const b = d.b;
      logShaft(b, 0, 0, height, r0, r1, wood, h, 20);
      if (climbable) steps(b, 0, 2.1, height - 1.3, radiusAt);
      if (!d.fittings) return;
      if (topPin) pin(d, 0, height, 0, glass.hex, wire);
      else timberCap(b, 0, height, r1, wood, cap);
      const half = pins / 2;
      const outer = armLength / 2 - 0.1;
      const inner = pins > 2 ? 0.26 : outer;
      for (let k = 0; k < arms; k++) {
        const y = height - 0.32 - k * 0.55;
        const z = radiusAt(y) + 0.045;
        arm(b, y, -armLength / 2, armLength / 2, z, armWood);
        if (braces) {
          for (const side of [-1, 1]) strap(b, [side * 0.42, y - 0.05, z + 0.05], [side * 0.03, y - 0.58, radiusAt(y - 0.58) + 0.005]);
        }
        for (let i = 0; i < half; i++) {
          const x = half === 1 ? outer : lerp(inner, outer, i / (half - 1));
          for (const side of [-1, 1]) pin(d, side * x, y + 0.05, z, glass.hex, wire);
        }
      }
      const topZ = radiusAt(height - 0.32) + 0.045;
      d.nest = topPin ? [-0.42, height - 0.26, topZ] : [0, height + 0.02, 0];
    },
  };
};

/** B. Rural three-phase on timber: one arm, porcelain, a neutral below. */
const ruralPower: Family = (v, h) => {
  const layout = pickOf(['triangle', 'flat', 'alley'] as const, v);
  const height = 8.2 + h(1) * 1.1;
  const r0 = 0.16 + h(2) * 0.03;
  const r1 = 0.1 + h(3) * 0.02;
  const wood = pickOf(TIMBER, v * 2 + 3);
  const insulator = pickOf(POWER_INSULATORS, v * 5 + 2);
  const neutral = v % 2 === 0;
  const grounded = v % 3 === 0;
  const armLength = 2.3 + h(4) * 0.3;
  const radiusAt = (y: number): number => lerp(r0, r1, y / height);
  const wire: WireStyle = { radius: 0.013, hex: v % 2 === 0 ? WIRE_DARK : WIRE_ALUMINIUM };
  const layoutName = layout === 'triangle' ? 'треугольник' : layout === 'flat' ? 'в ряд' : 'консоль к дороге';
  return {
    name: `Сельская ЛЭП · ${layoutName} · ${insulator.name}`,
    spacing: 50 + h(6) * 8,
    height,
    weather: timberWeather(h),
    foot: { x: 0, r: r0 },
    gear: { x: 0, r: radiusAt(POLE_GEAR_Y) },
    legs: [{ x: 0, r: 0.17 }],
    draw(d) {
      const b = d.b;
      logShaft(b, 0, 0, height, r0, r1, wood, h, 20);
      if (grounded) groundWire(b, 0, height, r0, r1);
      if (!d.fittings) return;
      timberCap(b, 0, height, r1, wood, 'bevel');
      const y = height - 0.28;
      const z = radiusAt(y) + 0.05;
      const armWood = shade(wood, 1.12);
      const x0 = layout === 'alley' ? -0.35 : -armLength / 2;
      const x1 = layout === 'alley' ? 2.1 : armLength / 2;
      arm(b, y, x0, x1, z, armWood, 0.095, 0.11);
      const brace = (xa: number): void => b.beam([xa, y - 0.05, z], [0, y - 0.8, z - 0.02], 0.05, armWood);
      const tips = layout === 'alley' ? [0.45, 1.25, 2.0] : layout === 'flat' ? [x0 + 0.12, 0.4, x1 - 0.12] : [x0 + 0.12, x1 - 0.12];
      if (layout === 'alley') brace(1.35);
      else {
        brace(-0.75);
        brace(0.75);
      }
      for (const x of tips) pin(d, x, y + 0.055, z, insulator.hex, wire, true, 1.4);
      if (layout === 'triangle') {
        b.beam([0, height - 0.45, r1 + 0.03], [0, height + 0.22, r1 + 0.03], 0.05, HARDWARE_DARK);
        pin(d, 0, height + 0.22, r1 + 0.03, insulator.hex, wire, true, 1.4);
      }
      if (neutral) spool(d, radiusAt(y - 1.3), y - 1.3, 0, 1, pickOf(PORCELAIN, v).hex, { radius: 0.011, hex: WIRE_DARK });
      d.nest = [-0.6, y + 0.07, z];
    },
  };
};

/** C. The bracket telephone pole: no arm, insulators screwed into the shaft. */
const bracketPhone: Family = (v, h) => {
  const count = pickOf([2, 3, 4, 4, 6, 5], v);
  const height = 5.6 + h(1) * 1.0;
  const r0 = 0.12 + h(2) * 0.02;
  const r1 = 0.08 + h(3) * 0.015;
  const wood = pickOf(TIMBER, v * 4 + 2);
  const glass = pickOf(GLASS, v * 2 + 1);
  const cap = pickOf<TimberCap>(['roof', 'tin', 'bevel'], v);
  const radiusAt = (y: number): number => lerp(r0, r1, y / height);
  const wire: WireStyle = { radius: 0.009, hex: WIRE_DARK };
  return {
    name: `Телефонный на крючьях · ${count} ${count < 5 ? 'провода' : 'проводов'} · ${glass.name}`,
    spacing: 38 + h(6) * 6,
    height,
    weather: timberWeather(h),
    foot: { x: 0, r: r0 },
    gear: { x: 0, r: radiusAt(POLE_GEAR_Y) },
    legs: [{ x: 0, r: 0.14 }],
    draw(d) {
      const b = d.b;
      logShaft(b, 0, 0, height, r0, r1, wood, h, 20);
      if (!d.fittings) return;
      timberCap(b, 0, height, r1, wood, cap);
      for (let i = 0; i < count; i++) {
        const y = height - 0.35 - Math.floor(i / 2) * 0.4 - (i % 2) * 0.2;
        const side = i % 2 === 0 ? 1 : -1;
        const r = radiusAt(y);
        const x = side * (r + 0.13);
        b.box(Math.min(side * r * 0.5, x + side * 0.03), y - 0.03, -0.025, Math.max(side * r * 0.5, x + side * 0.03), y, 0.025, shade(wood, 1.15));
        pin(d, x, y, 0, glass.hex, wire);
      }
      d.nest = [0, height + 0.05, 0];
    },
  };
};

/** D. A timber pole bolted to a short concrete stub, so the rot starts above the sand. */
const stubbed: Family = (v, h) => {
  const kit = pickOf(['triangle', 'flat', 'rack', 'triangle+rack', 'flat+rack', 'rack'] as const, v);
  const height = 8 + h(1) * 1.2;
  const r0 = 0.14 + h(2) * 0.02;
  const r1 = 0.1 + h(3) * 0.015;
  const stubTop = 2.6 + h(4) * 0.4;
  const wood = pickOf(TIMBER, v * 5);
  const concrete = pickOf(CONCRETE, v * 2 + 1);
  const insulator = pickOf(POWER_INSULATORS, v * 3 + 1);
  const xt = -(0.11 + r0);
  const radiusAt = (y: number): number => lerp(r0, r1, (y - 0.45) / (height - 0.45));
  const wire: WireStyle = { radius: 0.012, hex: v % 2 === 0 ? WIRE_ALUMINIUM : WIRE_DARK };
  const kitName = kit === 'rack' ? '0,4 кВ на вертикальных катушках' : kit.startsWith('triangle') ? '10 кВ треугольником' : '10 кВ в ряд';
  return {
    name: `Деревянный на ж/б приставке · ${kitName}`,
    spacing: 48 + h(6) * 7,
    height,
    weather: timberWeather(h),
    foot: { x: 0, r: 0.14 },
    gear: { x: xt, r: radiusAt(POLE_GEAR_Y) },
    legs: [{ x: 0, r: 0.15 }, { x: xt, r: r0 }],
    draw(d) {
      const b = d.b;
      column(b, 0, 0, stubTop, 0.12, 0.12, 0.095, 0.095, concrete);
      b.hexa(
        [
          [-0.095, stubTop, -0.095], [0.095, stubTop, -0.095], [0.095, stubTop, 0.095], [-0.095, stubTop, 0.095],
          [-0.095, stubTop + 0.06, -0.05], [0.095, stubTop + 0.06, -0.05], [0.095, stubTop + 0.06, 0.05], [-0.095, stubTop + 0.06, 0.05],
        ],
        concrete,
      );
      logShaft(b, xt, 0.45, height, r0, r1, wood, h, 20);
      // Two wire bands round the stub and the butt together.
      for (const y of [1.15, stubTop - 0.35]) {
        const x0 = xt - r0 - 0.012;
        b.box(x0, y, -0.132, 0.132, y + 0.035, -0.12, HARDWARE_DARK);
        b.box(x0, y, 0.12, 0.132, y + 0.035, 0.132, HARDWARE_DARK);
        b.box(0.12, y, -0.132, 0.132, y + 0.035, 0.132, HARDWARE_DARK);
        b.box(x0, y, -0.132, x0 + 0.012, y + 0.035, 0.132, HARDWARE_DARK);
      }
      if (!d.fittings) return;
      timberCap(b, xt, height, r1, wood, 'tin');
      if (kit !== 'rack') {
        const y = height - 0.3;
        const z = radiusAt(y) + 0.05;
        arm(b, y, xt - 1.05, xt + 1.05, z, 0x5a5d5f, 0.07, 0.07);
        for (const side of [-1, 1]) strap(b, [xt + side * 0.6, y - 0.04, z], [xt + side * 0.03, y - 0.6, radiusAt(y - 0.6)]);
        const tips = kit.startsWith('triangle') ? [xt - 0.93, xt + 0.93] : [xt - 0.93, xt + 0.35, xt + 0.93];
        for (const x of tips) pin(d, x, y + 0.035, z, insulator.hex, wire, true, 1.3);
        if (kit.startsWith('triangle')) {
          b.beam([xt, height - 0.4, r1 + 0.03], [xt, height + 0.2, r1 + 0.03], 0.05, HARDWARE_DARK);
          pin(d, xt, height + 0.2, r1 + 0.03, insulator.hex, wire, true, 1.3);
        }
        d.nest = [xt - 0.55, y + 0.05, z];
      }
      if (kit.includes('rack')) {
        const top = kit === 'rack' ? height - 0.35 : height - 1.4;
        const face = xt + radiusAt(top);
        b.beam([face + 0.02, top + 0.1, 0], [face + 0.02, top - 1.25, 0], 0.05, HARDWARE_DARK, 0.03);
        for (let i = 0; i < 4; i++) spool(d, face + 0.03, top - i * 0.36, 0, 1, pickOf(PORCELAIN, v + i).hex, { radius: 0.011, hex: WIRE_DARK });
        if (kit === 'rack') d.nest = [xt, height + 0.05, 0];
      }
    },
  };
};

// --- concrete ---------------------------------------------------------------

type Traverse = 'tri' | 'flat' | 'double' | 'offset' | 'post';

/**
 * The steel traverse a concrete or tubular pole carries, on the +Z face at `face`.
 * `radiusAt` is the shaft's half-width in Z at a height, for the braces' foot.
 */
function traverse(
  d: Draw,
  kind: Traverse,
  height: number,
  face: (y: number) => number,
  insulator: number,
  wire: WireStyle,
  steel: number,
  power: boolean,
): void {
  const b = d.b;
  const pinOn = (x: number, y: number, z: number): void => {
    if (kind === 'post') post(d, x, y + 0.04, z, insulator, wire, 5);
    else pin(d, x, y + 0.04, z, insulator, wire, power, power ? 1.4 : 1.3);
  };
  const oneArm = (y: number, x0: number, x1: number, tips: readonly number[]): void => {
    const z = face(y) + 0.045;
    arm(b, y, x0, x1, z, steel, 0.075, 0.08);
    for (const x of [x0 * 0.6, x1 * 0.6]) {
      if (Math.abs(x) > 0.3) strap(b, [x, y - 0.04, z], [Math.sign(x) * 0.03, y - 0.65, face(y - 0.65) + 0.004]);
    }
    for (const x of tips) pinOn(x, y, z);
  };
  switch (kind) {
    case 'tri': {
      const y = height - 0.9;
      oneArm(y, -1.05, 1.05, [-0.93, 0.93]);
      const z = face(height) + 0.03;
      b.beam([0, height - 0.5, z], [0, height + 0.35, z], 0.06, steel, 0.04);
      pinOn(0, height + 0.35, z);
      d.nest = [-0.5, y + 0.05, face(y) + 0.045];
      break;
    }
    case 'flat':
    case 'post': {
      const y = height - 0.25;
      oneArm(y, -1.25, 1.25, [-1.12, 0.45, 1.12]);
      d.nest = [-0.55, y + 0.05, face(y) + 0.045];
      break;
    }
    case 'double': {
      oneArm(height - 0.3, -1.0, 1.0, [-0.88, 0.88]);
      oneArm(height - 1.5, -1.0, 1.0, [-0.88, 0.88]);
      d.nest = [0, height + 0.02, 0];
      break;
    }
    case 'offset': {
      const y = height - 0.3;
      const z = face(y) + 0.045;
      arm(b, y, -0.3, 2.05, z, steel, 0.075, 0.08);
      strap(b, [1.35, y - 0.04, z], [0.03, y - 0.95, face(y - 0.95) + 0.004]);
      for (const x of [0.55, 1.25, 1.95]) pinOn(x, y, z);
      d.nest = [0, height + 0.02, 0];
      break;
    }
  }
}

/** A black telecom cable on a stub bracket, road side, where a line shares its poles. */
function telecomCable(d: Draw, face: number, y: number): void {
  if (!d.fittings) return;
  d.b.box(face - 0.02, y - 0.03, -0.03, face + 0.26, y + 0.03, 0.03, HARDWARE_DARK);
  d.b.box(face + 0.2, y - 0.07, -0.05, face + 0.28, y + 0.01, 0.05, HARDWARE_DARK);
  d.wires.push({ at: [face + 0.24, y - 0.05, 0], radius: 0.022, hex: WIRE_CABLE });
}

/** The painted number plate a maintained concrete line carries at eye height. */
function numberPlate(b: DwellingBuilder, face: number): void {
  b.box(face, 2.3, -0.06, face + 0.006, 2.44, 0.06, 0xe8e4da);
  b.box(face + 0.004, 2.34, -0.04, face + 0.009, 2.4, 0.04, 0x2a2a2a);
}

function concreteWeather(h: HashFn): Weathering {
  return { fade: 0.1 + h(90) * 0.2, grime: 0.32, patchy: 0.07 };
}

/** E. The rectangular vibrated-concrete pole, the most common line pole there is. */
const rectConcrete: Family = (v, h) => {
  const kind = pickOf<Traverse>(['tri', 'flat', 'double', 'offset', 'post', 'tri', 'flat', 'post', 'double', 'offset'], v);
  const height = 9.5 + h(1) * 1.5;
  const concrete = pickOf(CONCRETE, v * 3);
  const steel = pickOf(STEEL, v + 2);
  const insulator = kind === 'post' ? pickOf(POLYMER, v) : pickOf(POWER_INSULATORS, v * 2 + 1);
  const hx0 = 0.14;
  const hz0 = 0.09;
  const hx1 = 0.085;
  const hz1 = 0.062;
  const faceZ = (y: number): number => lerp(hz0, hz1, y / height);
  const faceX = (y: number): number => lerp(hx0, hx1, y / height);
  const wire: WireStyle = { radius: 0.014, hex: WIRE_ALUMINIUM };
  const cable = v % 3 === 1;
  const kindName = { tri: 'треугольник', flat: 'в ряд', double: 'две траверсы', offset: 'консоль к дороге', post: 'опорные изоляторы' }[kind];
  return {
    name: `Ж/б прямоугольный · ${kindName} · ${insulator.name}${cable ? ' · кабель' : ''}`,
    spacing: 60 + h(6) * 12,
    height,
    weather: concreteWeather(h),
    foot: { x: 0, r: hx0 },
    gear: { x: 0, r: faceX(POLE_GEAR_Y) },
    legs: [{ x: 0, r: 0.16 }],
    draw(d) {
      const b = d.b;
      column(b, 0, 0, height, hx0, hz0, hx1, hz1, concrete);
      if (v % 2 === 0) numberPlate(b, faceX(2.4));
      if (!d.fittings) return;
      traverse(d, kind, height, faceZ, insulator.hex, wire, steel, kind !== 'post');
      if (cable) telecomCable(d, faceX(5.2), 5.2);
    },
  };
};

/** F, G. Spun (round) and octagonal concrete: taller lines, later work. */
function roundConcrete(sides: 12 | 8): Family {
  return (v, h) => {
    const kinds: readonly (Traverse | 'string')[] = sides === 12
      ? ['string', 'tri', 'post', 'string', 'tri', 'post', 'flat', 'double']
      : ['post', 'string', 'tri', 'double', 'flat', 'string'];
    const kind = pickOf(kinds, v);
    const height = 10 + h(1) * 2;
    const r0 = 0.19 + h(2) * 0.03;
    const r1 = 0.11 + h(3) * 0.02;
    const concrete = pickOf(CONCRETE, v * 2 + (sides === 8 ? 3 : 0));
    const steel = pickOf(STEEL, v * 3 + 1);
    const insulator = kind === 'post' ? pickOf(POLYMER, v + 1) : pickOf(POWER_INSULATORS, v * 3 + 2);
    const radiusAt = (y: number): number => lerp(r0, r1, y / height);
    const wire: WireStyle = { radius: 0.016, hex: WIRE_ALUMINIUM };
    const cable = v % 3 === 2;
    const kindName = kind === 'string' ? 'гирлянды' : { tri: 'треугольник', flat: 'в ряд', double: 'две траверсы', offset: 'консоль', post: 'опорные изоляторы' }[kind];
    return {
      name: `Ж/б ${sides === 12 ? 'центрифугированный' : 'восьмигранный'} · ${kindName} · ${insulator.name}`,
      spacing: 65 + h(6) * 15,
      height,
      weather: concreteWeather(h),
      foot: { x: 0, r: r0 },
      gear: { x: 0, r: radiusAt(POLE_GEAR_Y) },
      legs: [{ x: 0, r: r0 }],
      draw(d) {
        const b = d.b;
        // Spun concrete is cast in lengths; a faint change of tone marks each joint.
        const rings = Math.round(height / 1.6);
        shaft(b, 0, 0, 0, height, r0, r1, (i) => (i % 2 === 0 ? concrete : shade(concrete, 0.96)), sides, sides === 12, rings);
        b.cylinder(0, 0, height, height + 0.03, r1 + 0.012, steel, sides);
        if (v % 2 === 1) numberPlate(b, radiusAt(2.4));
        if (!d.fittings) return;
        if (kind === 'string') {
          const y = height - 0.45;
          const z = radiusAt(y) + 0.05;
          arm(b, y, -1.6, 1.6, z, steel, 0.08, 0.09);
          for (const x of [-1.0, 1.0]) strap(b, [x, y - 0.04, z], [Math.sign(x) * 0.04, y - 0.8, radiusAt(y - 0.8)]);
          string(d, -1.48, y - 0.045, z, insulator.hex, wire, 3 + (v % 2));
          string(d, 1.48, y - 0.045, z, insulator.hex, wire, 3 + (v % 2));
          const y2 = y - 1.6;
          const z2 = radiusAt(y2) + 0.05;
          arm(b, y2, -0.2, 1.3, z2, steel, 0.08, 0.09);
          strap(b, [0.9, y2 - 0.04, z2], [0.04, y2 - 0.7, radiusAt(y2 - 0.7)]);
          string(d, 1.18, y2 - 0.045, z2, insulator.hex, wire, 3 + (v % 2));
          d.nest = [0, height + 0.04, 0];
        } else {
          traverse(d, kind, height, radiusAt, insulator.hex, wire, steel, kind !== 'post');
        }
        if (cable) telecomCable(d, radiusAt(5.4), 5.4);
      },
    };
  };
}

/** H. Double-circuit concrete: three arms, six wires, the barrel silhouette. */
const doubleCircuit: Family = (v, h) => {
  const height = 12 + h(1) * 1.2;
  const concrete = pickOf(CONCRETE, v + 2);
  const steel = pickOf(STEEL, v * 3);
  const insulator = pickOf([POLYMER[0]!, PORCELAIN[0]!, GLASS[2]!, PORCELAIN[1]!], v);
  const posts = v % 2 === 0;
  const hx0 = 0.16;
  const hz0 = 0.1;
  const hx1 = 0.09;
  const hz1 = 0.065;
  const faceZ = (y: number): number => lerp(hz0, hz1, y / height);
  const faceX = (y: number): number => lerp(hx0, hx1, y / height);
  const wire: WireStyle = { radius: 0.015, hex: WIRE_ALUMINIUM };
  return {
    name: `Ж/б двухцепный · ${posts ? 'опорные изоляторы' : 'штыревые'} · ${insulator.name}`,
    spacing: 70 + h(6) * 10,
    height,
    weather: concreteWeather(h),
    foot: { x: 0, r: hx0 },
    gear: { x: 0, r: faceX(POLE_GEAR_Y) },
    legs: [{ x: 0, r: 0.18 }],
    draw(d) {
      const b = d.b;
      column(b, 0, 0, height, hx0, hz0, hx1, hz1, concrete);
      numberPlate(b, faceX(2.4));
      if (!d.fittings) return;
      const lengths = [1.7, 2.3, 1.7];
      lengths.forEach((length, k) => {
        const y = height - 0.3 - k * 1.5;
        const z = faceZ(y) + 0.045;
        const half = length / 2;
        arm(b, y, -half, half, z, steel, 0.075, 0.08);
        for (const side of [-1, 1]) {
          strap(b, [side * half * 0.6, y - 0.04, z], [side * 0.03, y - 0.6, faceZ(y - 0.6)]);
          if (posts) post(d, side * (half - 0.1), y + 0.04, z, insulator.hex, wire, 5);
          else pin(d, side * (half - 0.1), y + 0.04, z, insulator.hex, wire, true, 1.4);
        }
      });
      d.nest = [0, height + 0.02, 0];
    },
  };
};

// --- steel ------------------------------------------------------------------

/** I. The lattice mast: four legs, cross-braced faces, strings off the arm tips. */
const lattice: Family = (v, h) => {
  const height = 11 + h(1) * 3;
  const body = height - 0.9;
  const bh = 0.45 + h(2) * 0.25;
  const th = 0.16 + h(3) * 0.06;
  const panels = 5 + (v % 3);
  const steel = pickOf(STEEL, pickOf([0, 1, 5, 0, 2, 1, 5, 3, 0, 1], v));
  const insulator = pickOf([GLASS[2]!, PORCELAIN[1]!, PORCELAIN[0]!, POLYMER[0]!, GLASS[0]!], v);
  const twoLevels = v % 2 === 1;
  const xBraced = v % 3 !== 2;
  const reach = 1.9 + h(4) * 0.4;
  const discs = 4 + (v % 3);
  const half = (y: number): number => lerp(bh, th, Math.min(1, y / body));
  const wire: WireStyle = { radius: 0.018, hex: WIRE_ALUMINIUM };
  return {
    name: `Решётчатая мачта · ${twoLevels ? 'два яруса' : 'один ярус'} · ${xBraced ? 'крестовая решётка' : 'зигзаг'} · ${insulator.name}`,
    spacing: 95 + h(6) * 25,
    height,
    weather: { fade: 0.1, grime: 0.12, patchy: 0.05 },
    foot: { x: 0, r: bh + 0.05 },
    gear: { x: 0, r: half(POLE_GEAR_Y) * 1.2 },
    legs: [{ x: 0, r: Math.min(0.6, bh) }],
    draw(d) {
      const b = d.b;
      const corners: readonly (readonly [number, number])[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      const at = (c: readonly [number, number], y: number): P3 => [c[0] * half(y), y, c[1] * half(y)];
      for (const c of corners) b.beam(at(c, 0), at(c, body), 0.075, steel);
      for (let i = 0; i < panels; i++) {
        const y0 = (body * i) / panels;
        const y1 = (body * (i + 1)) / panels;
        for (let f = 0; f < 4; f++) {
          const ca = corners[f]!;
          const cb = corners[(f + 1) % 4]!;
          b.beam(at(ca, y1), at(cb, y1), 0.045, steel);
          if (xBraced || i % 2 === 0) b.beam(at(ca, y0), at(cb, y1), 0.035, steel);
          if (xBraced || i % 2 === 1) b.beam(at(cb, y0), at(ca, y1), 0.035, steel);
        }
      }
      // The peak that carries the earth wire.
      for (const c of corners) b.beam(at(c, body), [0, height, 0], 0.05, steel);
      const levels = twoLevels ? [body - 0.25, body - 2.3] : [body - 0.25];
      for (const y of levels) {
        const w = half(y);
        for (const side of [-1, 1]) {
          const tip: P3 = [side * reach, y, 0];
          b.beam([side * w, y, -w], tip, 0.05, steel);
          b.beam([side * w, y, w], tip, 0.05, steel);
          b.beam([side * w, y - 0.9, -w], tip, 0.035, steel);
          b.beam([side * w, y - 0.9, w], tip, 0.035, steel);
        }
      }
      if (!d.fittings) return;
      for (const y of levels) {
        for (const side of [-1, 1]) string(d, side * (reach - 0.06), y - 0.03, 0, insulator.hex, wire, discs);
      }
      d.wires.push({ at: [0, height - 0.02, 0], radius: 0.009, hex: 0x6d6f70 });
      d.nest = [-(half(levels[0]!) + 0.45), levels[0]! + 0.05, 0];
    },
  };
};

/** J. The tubular steel monopole: the tidy, recent line. */
const tubular: Family = (v, h) => {
  const kind = pickOf(['davit', 'staggered', 'flat', 'davit', 'staggered', 'flat', 'davit', 'staggered', 'flat', 'single'] as const, v);
  const sides = v % 2 === 0 ? 12 : 8;
  const height = 11 + h(1) * 3;
  const r0 = 0.22 + h(2) * 0.04;
  const r1 = 0.1 + h(3) * 0.02;
  const steel = pickOf(STEEL, pickOf([3, 0, 2, 1, 3, 5, 0, 2, 4, 1], v));
  const insulator = pickOf(POLYMER, v + (v >> 1));
  const radiusAt = (y: number): number => lerp(r0, r1, y / height);
  const wire: WireStyle = { radius: 0.017, hex: WIRE_ALUMINIUM };
  const kindName = { davit: 'изогнутые консоли', staggered: 'изоляторы вразбежку', flat: 'прямая траверса', single: 'односторонняя консоль' }[kind];
  return {
    name: `Стальной трубчатый ${sides === 12 ? 'круглый' : 'восьмигранный'} · ${kindName}`,
    spacing: 80 + h(6) * 15,
    height,
    weather: { fade: 0.08, grime: 0.14, patchy: 0.04 },
    foot: { x: 0, r: r0 + 0.08 },
    gear: { x: 0, r: radiusAt(POLE_GEAR_Y) },
    legs: [{ x: 0, r: r0 }],
    draw(d) {
      const b = d.b;
      b.box(-0.34, 0, -0.34, 0.34, 0.05, 0.34, shade(steel, 0.9));
      for (const [x, z] of [[-0.26, -0.26], [0.26, -0.26], [0.26, 0.26], [-0.26, 0.26]] as const) b.cylinder(x, z, 0.05, 0.12, 0.025, HARDWARE_DARK, 6);
      const joint = height * (0.38 + h(4) * 0.1);
      shaft(b, 0, 0, 0.05, joint + 0.3, r0, radiusAt(joint + 0.3), steel, sides, sides === 12, 2);
      shaft(b, 0, 0, joint, height, radiusAt(joint) - 0.012, r1, steel, sides, sides === 12, 3);
      b.cylinder(0, 0, height, height + 0.04, r1 + 0.015, shade(steel, 0.85), sides);
      if (!d.fittings) return;
      switch (kind) {
        case 'davit': {
          const y0 = height - 0.9;
          for (const side of [-1, 1]) {
            const path: P3[] = [];
            for (let i = 0; i <= 6; i++) {
              const t = i / 6;
              path.push([side * lerp(radiusAt(y0) - 0.02, 1.85, t), y0 + Math.sin(t * Math.PI * 0.5) * 0.45, 0]);
            }
            b.tube(path, (t) => lerp(0.06, 0.035, t), 7, steel);
            string(d, side * 1.8, y0 + 0.42, 0, insulator.hex, wire, 3);
          }
          post(d, 0, height + 0.04, 0, insulator.hex, wire, 6);
          d.nest = [-0.8, y0 + 0.3, 0];
          break;
        }
        case 'staggered': {
          const ys = [height - 0.4, height - 1.6, height - 2.8];
          ys.forEach((y, k) => {
            const side = k % 2 === 0 ? 1 : -1;
            const r = radiusAt(y);
            b.box(Math.min(side * r, side * (r + 0.05)), y - 0.08, -0.07, Math.max(side * r, side * (r + 0.05)), y + 0.08, 0.07, HARDWARE_DARK);
            sidePost(d, side * (r + 0.05), y, 0, side, insulator.hex, wire, 6);
          });
          d.nest = [0, height + 0.05, 0];
          break;
        }
        case 'flat': {
          const y = height - 0.3;
          const z = radiusAt(y) + 0.06;
          b.beam([-1.5, y, z], [1.5, y, z], 0.1, steel);
          for (const side of [-1, 1]) b.beam([side * 0.9, y - 0.03, z], [side * 0.05, y - 0.7, radiusAt(y - 0.7)], 0.05, steel);
          for (const x of [-1.38, 0.5, 1.38]) post(d, x, y + 0.05, z, insulator.hex, wire, 5);
          d.nest = [-0.6, y + 0.06, z];
          break;
        }
        case 'single': {
          const y0 = height - 0.5;
          b.beam([0, y0, 0], [2.05, y0 + 0.08, 0], 0.09, steel);
          b.beam([0, y0 - 0.9, 0], [1.4, y0 + 0.02, 0], 0.05, steel);
          for (const x of [0.7, 1.35, 1.98]) string(d, x, y0 + 0.02, 0, insulator.hex, wire, 3);
          d.nest = [0, height + 0.05, 0];
          break;
        }
      }
    },
  };
};

/** K. The Oppenheimer pole: telescoping iron tubes, the steel telegraph of the desert. */
const oppenheimer: Family = (v, h) => {
  const kit = pickOf(['arm2', 'arm4', 'bracket2', 'top', 'arm2+top', 'bracket3'] as const, v);
  const height = 6 + h(1) * 0.8;
  const iron = pickOf(IRON, v);
  const glass = pickOf(GLASS, v * 5 + 2);
  const a = 2.3 + h(2) * 0.3;
  const c = 4.3 + h(3) * 0.3;
  const wire: WireStyle = { radius: 0.009, hex: WIRE_DARK };
  const kitName = { arm2: 'траверса на два', arm4: 'траверса на четыре', bracket2: 'два крюка', top: 'один изолятор', 'arm2+top': 'траверса и макушка', bracket3: 'три крюка' }[kit];
  return {
    name: `Телескопический стальной (Оппенгеймер) · ${kitName} · ${glass.name}`,
    spacing: 44 + h(6) * 6,
    height,
    weather: { fade: 0.1, grime: 0.3, patchy: 0.12 },
    foot: { x: 0, r: 0.14 },
    gear: { x: 0, r: 0.08 },
    legs: [{ x: 0, r: 0.14 }],
    draw(d) {
      const b = d.b;
      b.lathe(0, 0, [[0.2, 0], [0.16, 0.12], [0.14, 0.14], [0.14, 0.38], [0.11, 0.42]], 10, shade(iron, 0.9));
      b.cylinder(0, 0, 0.4, a, 0.1, iron, 10);
      b.cylinder(0, 0, a - 0.08, a + 0.08, 0.118, shade(iron, 0.9), 10);
      b.cylinder(0, 0, a, c, 0.08, iron, 10);
      b.cylinder(0, 0, c - 0.07, c + 0.07, 0.096, shade(iron, 0.9), 10);
      b.cylinder(0, 0, c, height, 0.062, iron, 10);
      b.dome(0, 0, height, 0.07, shade(iron, 0.9), 0.8, 10, 3);
      if (!d.fittings) return;
      if (kit.startsWith('arm')) {
        const y = height - 0.25;
        const pins = kit === 'arm4' ? 4 : 2;
        const length = pins === 4 ? 1.6 : 1.15;
        arm(b, y, -length / 2, length / 2, 0.062 + 0.04, 0x7d7266, 0.08, 0.09);
        const xs = pins === 4 ? [-0.7, -0.3, 0.3, 0.7] : [-0.46, 0.46];
        for (const x of xs) pin(d, x, y + 0.045, 0.102, glass.hex, wire);
        if (kit === 'arm2+top') pin(d, 0, height + 0.05, 0, glass.hex, wire);
        d.nest = kit === 'arm2+top' ? [-0.25, y + 0.06, 0.1] : [0, height + 0.06, 0];
      } else if (kit === 'top') {
        pin(d, 0, height + 0.05, 0, glass.hex, wire);
        d.nest = [0, height - 0.6, 0];
      } else {
        const count = kit === 'bracket3' ? 3 : 2;
        for (let i = 0; i < count; i++) {
          const side = i % 2 === 0 ? 1 : -1;
          const y = height - 0.25 - i * 0.3;
          b.beam([0, y, 0], [side * 0.2, y, 0], 0.025, HARDWARE_DARK);
          b.beam([side * 0.2, y - 0.01, 0], [side * 0.2, y + 0.06, 0], 0.025, HARDWARE_DARK);
          pin(d, side * 0.2, y + 0.06, 0, glass.hex, wire);
        }
        d.nest = [0, height + 0.06, 0];
      }
    },
  };
};

/** Old flat-bottom rail, as a line poles is made of where steel was cheaper than timber. */
const RAIL_OUTLINE: readonly P2[] = [
  [-0.065, -0.075], [0.065, -0.075], [0.065, -0.064], [0.012, -0.05], [0.009, 0.03], [0.034, 0.038],
  [0.036, 0.075], [-0.036, 0.075], [-0.034, 0.038], [-0.009, 0.03], [-0.012, -0.05], [-0.065, -0.064],
];
const I_BEAM_OUTLINE: readonly P2[] = [
  [-0.06, -0.07], [0.06, -0.07], [0.06, -0.058], [0.005, -0.058], [0.005, 0.058], [0.06, 0.058],
  [0.06, 0.07], [-0.06, 0.07], [-0.06, 0.058], [-0.005, 0.058], [-0.005, -0.058], [-0.06, -0.058],
];

/** L. The rail or I-beam pole, set in a concrete footing. */
const railPole: Family = (v, h) => {
  const rail = v % 2 === 0;
  const kit = pickOf(['arm2', 'arm4', 'brackets', 'brackets', 'arm4', 'arm2'] as const, v);
  const height = 6.8 + h(1) * 1.4;
  const iron = pickOf(IRON, v + 1);
  const glass = pickOf(GLASS, v * 5 + 1);
  const wire: WireStyle = { radius: 0.01, hex: WIRE_DARK };
  return {
    name: `${rail ? 'Из старого рельса' : 'Из двутавра'} · ${kit === 'brackets' ? 'крюки' : kit === 'arm4' ? 'траверса на четыре' : 'траверса на два'} · ${glass.name}`,
    spacing: 46 + h(6) * 6,
    height,
    weather: { fade: 0.1, grime: 0.3, patchy: 0.1 },
    foot: { x: 0, r: 0.1 },
    gear: { x: 0, r: 0.075 },
    legs: [{ x: 0, r: 0.12 }],
    draw(d) {
      const b = d.b;
      b.box(-0.22, 0, -0.18, 0.22, 0.14, 0.18, pickOf(CONCRETE, v));
      // The section is authored in (x, y) and pushed along Z; pitching the frame by
      // -PI/2 stands it up, which maps its Z onto the pole's Y.
      b.at(0, 0, 0, 0, () => b.extrude(rail ? RAIL_OUTLINE : I_BEAM_OUTLINE, 'z', 0.1, height, iron), -Math.PI * 0.5);
      if (!d.fittings) return;
      if (kit === 'brackets') {
        for (let i = 0; i < 4; i++) {
          const side = i % 2 === 0 ? 1 : -1;
          const y = height - 0.2 - Math.floor(i / 2) * 0.45 - (i % 2) * 0.2;
          b.beam([side * 0.06, y, 0], [side * 0.24, y, 0], 0.025, HARDWARE_DARK);
          b.beam([side * 0.24, y - 0.01, 0], [side * 0.24, y + 0.06, 0], 0.025, HARDWARE_DARK);
          pin(d, side * 0.24, y + 0.06, 0, glass.hex, wire);
        }
        d.nest = [0, height + 0.04, 0];
      } else {
        const y = height - 0.2;
        const four = kit === 'arm4';
        const length = four ? 1.7 : 1.2;
        arm(b, y, -length / 2, length / 2, 0.11, four ? 0x7d7266 : HARDWARE_DARK, 0.07, 0.07);
        for (const side of [-1, 1]) strap(b, [side * 0.4, y - 0.03, 0.11], [side * 0.02, y - 0.5, 0.08]);
        const xs = four ? [-0.75, -0.32, 0.32, 0.75] : [-0.5, 0.5];
        for (const x of xs) pin(d, x, y + 0.035, 0.11, glass.hex, wire);
        d.nest = [0, height + 0.04, 0];
      }
    },
  };
};

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

interface FamilyEntry {
  readonly era: PoleEra;
  readonly count: number;
  readonly make: Family;
}

/**
 * 30 timber, 28 concrete, 32 steel: ninety. Nothing stands on two legs: the timber
 * H-frame and the concrete portal were removed because they broke the game.
 */
const FAMILIES: readonly FamilyEntry[] = [
  { era: 'timber', count: 10, make: telegraph },
  { era: 'timber', count: 8, make: ruralPower },
  { era: 'timber', count: 6, make: bracketPhone },
  { era: 'timber', count: 6, make: stubbed },
  { era: 'concrete', count: 10, make: rectConcrete },
  { era: 'concrete', count: 8, make: roundConcrete(12) },
  { era: 'concrete', count: 6, make: roundConcrete(8) },
  { era: 'concrete', count: 4, make: doubleCircuit },
  { era: 'steel', count: 10, make: lattice },
  { era: 'steel', count: 10, make: tubular },
  { era: 'steel', count: 6, make: oppenheimer },
  { era: 'steel', count: 6, make: railPole },
];

/** Domain tag of the per-design hash stream. */
const TAG_DESIGN = 0x90d35e;

interface Slot {
  readonly era: PoleEra;
  readonly make: Family;
  readonly variant: number;
}

const SLOTS: readonly Slot[] = FAMILIES.flatMap((family) =>
  Array.from({ length: family.count }, (_, variant) => ({ era: family.era, make: family.make, variant })),
);

export const POLE_DESIGN_COUNT = SLOTS.length;

const byEra: Record<PoleEra, number[]> = { timber: [], steel: [], concrete: [] };
SLOTS.forEach((slot, id) => byEra[slot.era].push(id));

/** Design ids of one era, in catalogue order. Cheap: nothing is built. */
export function poleDesignsOfEra(era: PoleEra): readonly number[] {
  return byEra[era];
}

let material: THREE.MeshStandardMaterial | null = null;

/** The one material every pole shares: vertex colour, comic banding, like the houses. */
export function poleMaterial(): THREE.MeshStandardMaterial {
  material ??= applyComicShading(
    new THREE.MeshStandardMaterial({ name: 'pole-body', vertexColors: true, roughness: 0.8, metalness: 0 }),
    { contourStrength: 0, stippleStrength: 0 },
  );
  return material;
}

function geometryOf(plan: Plan, fittings: boolean): { geometry: THREE.BufferGeometry; draw: Draw } {
  const draw: Draw = { b: new DwellingBuilder(plan.weather), fittings, wires: [], nest: null };
  plan.draw(draw);
  return { geometry: draw.b.geometry(), draw };
}

const plans: (Plan | undefined)[] = [];
const designs: (PoleDesign | undefined)[] = [];

/** The numbers of a design without its geometry: cheap, for scheduling. */
function planOf(id: number): { plan: Plan; slot: Slot } {
  const slot = SLOTS[id];
  if (!slot) throw new Error(`No pole design ${id}`);
  const plan = (plans[id] ??= slot.make(slot.variant, (k) => hash01(TAG_DESIGN, id, k)));
  return { plan, slot };
}

/** Metres between poles of a design, without building it. */
export function poleDesignSpacing(id: number): number {
  return planOf(id).plan.spacing;
}

/** The design with this id, built on first use and kept for the session. */
export function poleDesign(id: number): PoleDesign {
  const cached = designs[id];
  if (cached) return cached;
  const { plan, slot } = planOf(id);
  const full = geometryOf(plan, true);
  const mast = geometryOf(plan, false);
  const design: PoleDesign = {
    id,
    era: slot.era,
    name: plan.name,
    spacing: plan.spacing,
    height: plan.height,
    wires: full.draw.wires,
    nest: full.draw.nest ?? [0, plan.height + 0.02, 0],
    foot: plan.foot,
    gear: plan.gear,
    legs: plan.legs,
    full: full.geometry,
    mast: mast.geometry,
  };
  designs[id] = design;
  return design;
}
