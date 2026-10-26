/**
 * Generated wheel sets: a lathed tyre on a rim whose face is cut with real windows —
 * a stamped disc's ring of holes, a plastic cover's vents, an alloy's gaps between its
 * spokes — with a dark drum and barrel seen through them. Built about the axle (local
 * X), outer face towards +X, at a nominal size the loader rescales to each car's own
 * tyre (render/carmodel.ts `cloneWheels`), like the Soviet pack's sets beside them.
 *
 * Every design is drawn from photos of the real wheel (`RimDesign.ref`); the designs
 * cover the roster as it is and the foreign cars on the owner's list (STATUS.md
 * "Foreign cars"): Soviet stamped steel, 90s plastic covers, the alloys of the period
 * and an off-roader's.
 *
 * How a face is cut: the face is a surface of revolution (`profile`), and each `band`
 * a ring of it split into sectors, each sector with at most one window (a star-shaped
 * outline about the sector's middle). A sector's border is joined to its window's
 * outline point for point, the window's points found by casting from its middle
 * through each border point, so the border's points are the only ones on the shared
 * edges. Every ring of the rim, band or plain, samples the same angles (`angles`), so no
 * edge has a T-junction to crack along.
 */

import * as THREE from 'three';
import { PartBuilder, type KitSlot, type Vec3 } from './builder';
import { finishKitSurfaces } from './materials';
import { CAR_BODY_POSITION_ATTRIBUTE, KIT_SHADOW_ATTRIBUTE } from '../render/materials';

/** Nominal tyre radius and half width the sets are built at; the loader resizes them. */
const TYRE_R = 0.29;
const HALF_W = 0.085;
const TYRE_SEGMENTS = 20;

/** A slot and, for the vertex-coloured trim, its colour. */
interface Finish {
  readonly slot: KitSlot;
  readonly color?: number;
}

/** A window's outline in its sector's frame: u along the radius, v across, both -1..1. */
type Outline = readonly (readonly [number, number])[];

interface RimSector {
  /** Share of the band's angle, relative to the pattern's other sectors. */
  readonly weight: number;
  readonly window: Outline | null;
}

interface RimBand {
  /** Inner and outer radius over the rim's. */
  readonly r0: number;
  readonly r1: number;
  /** The sectors one repeat of the pattern holds, and how many repeats round. */
  readonly pattern: readonly RimSector[];
  readonly repeat: number;
  /** Angle of the first sector's start, radians. */
  readonly phase?: number;
  /** Turns each window about its middle (a turbine's swirl), radians. */
  readonly twist?: number;
  /** Border points along each radial edge. */
  readonly radialSteps: number;
  /** Metal thickness the windows' walls show; 0 for pressed steel or plastic. */
  readonly depth: number;
}

interface RimCap {
  /** (radius over the rim's, height above the face where it stands) from the edge in. */
  readonly profile: readonly (readonly [number, number])[];
  readonly finish: Finish;
  /** A dark badge disc on top, its radius over the rim's. */
  readonly badge?: number;
}

export interface RimDesign {
  readonly id: string;
  readonly label: string;
  /** What it is drawn from. */
  readonly ref: string;
  /** Rim radius (flange) over the tyre's: a 12" Oka 0.6, an off-roader's tall sidewall 0.52. */
  readonly rimRatio: number;
  readonly face: Finish;
  readonly lip: Finish;
  /** The flange, from its top over the tyre's bead to where the face begins: (radius over rim, x m). */
  readonly lipProfile: readonly (readonly [number, number])[];
  /** The face from its edge (the lip's last point) to the centre: (radius over rim, x m). */
  readonly profile: readonly (readonly [number, number])[];
  readonly bands: readonly RimBand[];
  /** The angles every rim ring samples, besides the bands' own sector edges. */
  readonly baseSegments: number;
  /** Lug nuts: how many, their circle's radius and each nut's, over the rim's. */
  readonly bolts?: { readonly count: number; readonly pitch: number; readonly radius: number; readonly finish: Finish };
  readonly cap?: RimCap;
}

// ---------------------------------------------------------------------------
// Outlines
// ---------------------------------------------------------------------------

/** A superellipse outline, `n` points: power 2 an ellipse, higher squarer. */
function blob(halfU: number, halfV: number, power: number, n = 16, u0 = 0, v0 = 0): Outline {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    out.push([u0 + halfU * Math.sign(c) * Math.abs(c) ** (2 / power), v0 + halfV * Math.sign(s) * Math.abs(s) ** (2 / power)]);
  }
  return out;
}

/** A trapezoid narrowing towards the hub (u -1), its corners cut by `round`. */
function trapezoid(u0: number, u1: number, inner: number, outer: number, round: number): Outline {
  const corners: [number, number][] = [
    [u0, -inner],
    [u1, -outer],
    [u1, outer],
    [u0, inner],
  ];
  const out: [number, number][] = [];
  for (let i = 0; i < 4; i++) {
    const p = corners[i]!;
    const prev = corners[(i + 3) % 4]!;
    const next = corners[(i + 1) % 4]!;
    // Each corner as three points: in from both edges and a midpoint pulled to the corner.
    const a: [number, number] = [p[0] + (prev[0] - p[0]) * round, p[1] + (prev[1] - p[1]) * round];
    const b: [number, number] = [p[0] + (next[0] - p[0]) * round, p[1] + (next[1] - p[1]) * round];
    out.push(a, [(a[0] + b[0]) / 4 + p[0] / 2, (a[1] + b[1]) / 4 + p[1] / 2], b);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

const STEEL_SILVER: Finish = { slot: 'rim' };
const ALLOY: Finish = { slot: 'alloy' };
const NUT: Finish = { slot: 'trim', color: 0x5d6064 };
const BADGE_DARK = 0x1d1f22;

/** A pressed steel wheel's flange: bead seat, the rolled lip, down the well to the disc. */
const STEEL_LIP: readonly (readonly [number, number])[] = [
  [1.06, 0.073],
  [0.99, 0.068],
  [0.95, 0.04],
];

/** An alloy's flange: a thicker, flatter lip standing nearly level with the face. */
const ALLOY_LIP: readonly (readonly [number, number])[] = [
  [1.065, 0.077],
  [0.99, 0.078],
  [0.96, 0.072],
];

/** A cover's own rim: the steel lip, a little of it showing round the cover. */
const COVER_LIP: readonly (readonly [number, number])[] = [
  [1.06, 0.073],
  [0.985, 0.066],
];

export const RIM_DESIGNS: readonly RimDesign[] = [
  {
    id: 'gw_oka',
    label: 'ВАЗ-1111: штамповка, 14 отверстий, 3 гайки',
    ref: 'Commons "1994 VAZ 1111 red front.jpg" (CC BY 4.0), "2000 VAZ 1111 (11113021) front.jpg" (CC0): silver pressed disc, a ring of 14 round holes at ~0.78 of the rim, a raised centre with three nuts on 3x98 and a small hub cap; 4.5x12 ET40 (auto.ru)',
    rimRatio: 0.6,
    face: STEEL_SILVER,
    lip: STEEL_SILVER,
    lipProfile: STEEL_LIP,
    profile: [
      [0.95, 0.04],
      [0.9, 0.032],
      [0.64, 0.032],
      [0.46, 0.05],
      [0.0, 0.05],
    ],
    bands: [{ r0: 0.64, r1: 0.9, pattern: [{ weight: 1, window: blob(0.64, 0.6, 2, 12) }], repeat: 14, radialSteps: 3, depth: 0 }],
    baseSegments: 28,
    bolts: { count: 3, pitch: 0.29, radius: 0.065, finish: NUT },
    cap: { profile: [[0.16, 0], [0.155, 0.11], [0.0, 0.13]], finish: { slot: 'chrome' }, badge: 0.1 },
  },
  {
    id: 'gw_vaz_steel16',
    label: 'ВАЗ-2110: штамповка, 16 отверстий, 4 болта',
    ref: 'Commons "1998 Lada 21100 blue front.jpg" (CC0): silver pressed disc, a ring of 16 round holes at ~0.75 of the rim, four bolts on 4x98 round an open centre',
    rimRatio: 0.58,
    face: STEEL_SILVER,
    lip: STEEL_SILVER,
    lipProfile: STEEL_LIP,
    profile: [
      [0.95, 0.04],
      [0.88, 0.03],
      [0.62, 0.03],
      [0.42, 0.05],
      [0.0, 0.05],
    ],
    bands: [{ r0: 0.62, r1: 0.88, pattern: [{ weight: 1, window: blob(0.56, 0.56, 2, 12) }], repeat: 16, radialSteps: 3, depth: 0 }],
    baseSegments: 32,
    bolts: { count: 4, pitch: 0.29, radius: 0.065, finish: NUT },
    cap: { profile: [[0.15, 0], [0.15, 0.05], [0.0, 0.05]], finish: { slot: 'trim', color: 0x2e3033 } },
  },
  {
    id: 'gw_cover_vents',
    label: 'Колпак: кольцо прорезей (Audi 80, VW, Ford)',
    ref: 'Commons "Audi 80 2.0 E (B4) – f 14042024.jpg" (CC BY-SA 3.0 de): a flat silver plastic full cover over the steel wheel, a ring of 24 short slots near its edge, a dark badge in the middle',
    rimRatio: 0.58,
    face: STEEL_SILVER,
    lip: STEEL_SILVER,
    lipProfile: COVER_LIP,
    profile: [
      [0.985, 0.066],
      [0.96, 0.08],
      [0.94, 0.082],
      [0.7, 0.084],
      [0.64, 0.088],
      [0.0, 0.094],
    ],
    bands: [{ r0: 0.7, r1: 0.94, pattern: [{ weight: 1, window: blob(0.9, 0.32, 6, 12) }], repeat: 24, radialSteps: 3, depth: 0 }],
    baseSegments: 48,
    cap: { profile: [[0.17, 0], [0.16, 0.012], [0.0, 0.016]], finish: { slot: 'rim' }, badge: 0.12 },
  },
  {
    id: 'gw_cover_turbine',
    label: 'Колпак-турбина (Opel Astra F, Vectra A)',
    ref: 'Commons "Holden Astra Vectra wheel trim (27748913420).jpg" (CC BY 2.0): the GM cover of the Astra F / Vectra A, ten swept blades with dark gaps between them, a badge in a plain hub',
    rimRatio: 0.58,
    face: STEEL_SILVER,
    lip: STEEL_SILVER,
    lipProfile: COVER_LIP,
    profile: [
      [0.985, 0.066],
      [0.97, 0.078],
      [0.92, 0.082],
      [0.5, 0.088],
      [0.0, 0.096],
    ],
    bands: [{
      r0: 0.5,
      r1: 0.92,
      // Each gap a triangle from a point near the hub to a wide mouth at the rim.
      pattern: [{ weight: 1, window: [[-0.95, -0.3], [0.95, -0.05], [0.95, 0.95]] }],
      repeat: 10,
      radialSteps: 4,
      twist: 0.1,
      depth: 0,
    }],
    baseSegments: 40,
    cap: { profile: [[0.2, 0], [0.19, 0.01], [0.0, 0.014]], finish: { slot: 'rim' }, badge: 0.11 },
  },
  {
    id: 'gw_alloy_split7',
    label: 'Литьё: 7 сдвоенных спиц (ВАЗ-2112)',
    ref: 'Commons "Lada 112 wiki.jpg" (CC BY-SA 3.0): the 2112\'s alloy, seven spokes each split by a slot, wide windows between them, a small cap over four bolts',
    rimRatio: 0.6,
    face: ALLOY,
    lip: ALLOY,
    lipProfile: ALLOY_LIP,
    profile: [
      [0.96, 0.072],
      [0.88, 0.066],
      [0.38, 0.074],
      [0.0, 0.078],
    ],
    bands: [{
      r0: 0.38,
      r1: 0.88,
      pattern: [
        { weight: 1.45, window: trapezoid(-0.8, 0.9, 0.5, 0.86, 0.3) },
        { weight: 0.55, window: blob(0.66, 0.3, 3, 12, 0.1) },
      ],
      repeat: 7,
      radialSteps: 3,
      depth: 0.03,
    }],
    baseSegments: 42,
    bolts: { count: 4, pitch: 0.24, radius: 0.06, finish: NUT },
    cap: { profile: [[0.16, 0], [0.15, 0.02], [0.0, 0.026]], finish: ALLOY, badge: 0.1 },
  },
  {
    id: 'gw_alloy_8hole',
    label: 'Литьё: 8 окон (Mercedes W124)',
    ref: 'Commons "The tire wheel of Mercedes-Benz 500E (W124).jpg" (CC BY-SA 4.0): the flat 8-hole alloy fitted to the W124 from ~1992 (mbclub.co.uk guide), eight rounded trapezoid windows round a flat hub, five bolts and a star badge',
    rimRatio: 0.6,
    face: ALLOY,
    lip: ALLOY,
    lipProfile: ALLOY_LIP,
    profile: [
      [0.96, 0.072],
      [0.9, 0.07],
      [0.42, 0.076],
      [0.0, 0.08],
    ],
    bands: [{ r0: 0.42, r1: 0.9, pattern: [{ weight: 1, window: trapezoid(-0.86, 0.86, 0.48, 0.72, 0.35) }], repeat: 8, radialSteps: 4, depth: 0.035 }],
    baseSegments: 40,
    bolts: { count: 5, pitch: 0.27, radius: 0.055, finish: NUT },
    cap: { profile: [[0.15, 0], [0.14, 0.012], [0.0, 0.02]], finish: ALLOY, badge: 0.11 },
  },
  {
    id: 'gw_alloy_cross',
    label: 'Литьё cross-spoke (BMW E34, BBS)',
    ref: 'Commons "BBS forged cross-spoke aluminium wheel 1991 a.jpg" (CC BY-SA 3.0): the BBS mesh (BMW Style 5 on the E34): an outer ring of small triangular gaps, an inner ring of larger ones, a polished lip and a domed cap',
    rimRatio: 0.6,
    face: ALLOY,
    lip: { slot: 'chrome' },
    lipProfile: ALLOY_LIP,
    profile: [
      [0.96, 0.072],
      [0.92, 0.062],
      [0.62, 0.066],
      [0.6, 0.068],
      [0.3, 0.076],
      [0.0, 0.078],
    ],
    // Every gap fills its sector, so the metal left between them is the mesh's thin
    // crossing spokes, running on from the outer ring into the inner.
    bands: [
      {
        r0: 0.62,
        r1: 0.92,
        pattern: [
          { weight: 1, window: [[-1, 0], [1, -1], [1, 1]] },
          { weight: 1, window: [[-1, -1], [1, 0], [-1, 1]] },
        ],
        repeat: 10,
        radialSteps: 2,
        depth: 0.02,
      },
      {
        r0: 0.3,
        r1: 0.6,
        pattern: [{ weight: 1, window: [[-1, 0], [1, -1], [1, 1]] }],
        repeat: 10,
        radialSteps: 2,
        depth: 0.024,
      },
    ],
    baseSegments: 20,
    cap: { profile: [[0.28, 0], [0.26, 0.03], [0.18, 0.05], [0.0, 0.056]], finish: ALLOY, badge: 0.14 },
  },
  {
    id: 'gw_alloy_fan',
    label: 'Литьё «вентилятор» (Mitsubishi Pajero II)',
    ref: 'Commons "Mitsubishi Pajero (second generation) (front), Serdang.jpg" (CC BY-SA 3.0): the Pajero II alloy, twelve narrow curved fins in a deep dish round a raised hub, on a tall off-road tyre',
    rimRatio: 0.53,
    face: ALLOY,
    lip: ALLOY,
    lipProfile: ALLOY_LIP,
    profile: [
      [0.96, 0.072],
      [0.88, 0.05],
      [0.4, 0.062],
      [0.0, 0.07],
    ],
    bands: [{
      r0: 0.4,
      r1: 0.88,
      pattern: [{ weight: 1, window: [[-0.9, -0.45], [0.9, 0.0], [0.9, 0.95], [-0.9, 0.35]] }],
      repeat: 12,
      radialSteps: 3,
      twist: 0.12,
      depth: 0.028,
    }],
    baseSegments: 48,
    bolts: { count: 6, pitch: 0.27, radius: 0.05, finish: NUT },
    cap: { profile: [[0.22, 0], [0.2, 0.05], [0.12, 0.07], [0.0, 0.072]], finish: ALLOY, badge: 0.1 },
  },
];

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

function at(r: number, a: number, x: number): Vec3 {
  return [x, Math.cos(a) * r, Math.sin(a) * r];
}

/** One triangle wound so its normal faces `out`. */
function tri(b: PartBuilder, slot: KitSlot, p: Vec3, q: Vec3, s: Vec3, out: Vec3): void {
  const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2];
  const vx = s[0] - p[0], vy = s[1] - p[1], vz = s[2] - p[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  if (nx * out[0] + ny * out[1] + nz * out[2] < 0) b.tri(slot, p, s, q);
  else b.tri(slot, p, q, s);
}

function quad(b: PartBuilder, slot: KitSlot, p: Vec3, q: Vec3, s: Vec3, t: Vec3, out: Vec3): void {
  tri(b, slot, p, q, s, out);
  tri(b, slot, p, s, t, out);
}

function ink(b: PartBuilder, finish: Finish): KitSlot {
  if (finish.color !== undefined) b.color(finish.color);
  return finish.slot;
}

/**
 * Revolves a (radius, x) profile at `angles` into joined rings, each quad facing away
 * from `inside` (a point of the solid in the same plane).
 */
function lathe(b: PartBuilder, slot: KitSlot, profile: readonly (readonly [number, number])[], angles: readonly number[], inside: readonly [number, number]): void {
  for (let k = 0; k + 1 < profile.length; k++) {
    const [r0, x0] = profile[k]!;
    const [r1, x1] = profile[k + 1]!;
    // The profile's normal in its plane, turned away from the inside point.
    let nr = x1 - x0;
    let nx = -(r1 - r0);
    if (nr * ((r0 + r1) / 2 - inside[0]) + nx * ((x0 + x1) / 2 - inside[1]) < 0) {
      nr = -nr;
      nx = -nx;
    }
    for (let i = 0; i < angles.length; i++) {
      const a = angles[i]!;
      const c = angles[(i + 1) % angles.length]!;
      const m = (a + c + (c < a ? Math.PI * 2 : 0)) / 2;
      quad(b, slot, at(r0, a, x0), at(r0, c, x0), at(r1, c, x1), at(r1, a, x1), [nx, nr * Math.cos(m), nr * Math.sin(m)]);
    }
  }
}

/** x of a (radius, x) profile at radius r (radii falling along it). */
function profileX(profile: readonly (readonly [number, number])[], r: number): number {
  if (r >= profile[0]![0]) return profile[0]![1];
  for (let i = 1; i < profile.length; i++) {
    const [r0, x0] = profile[i - 1]!;
    const [r1, x1] = profile[i]!;
    if (r <= r0 && r >= r1) return x0 + ((r - r0) / (r1 - r0 || 1)) * (x1 - x0);
  }
  return profile[profile.length - 1]![1];
}

/** Each band's sectors as [start, end, window], radians, round the whole turn. */
function sectorsOf(band: RimBand): [number, number, Outline | null][] {
  const total = band.pattern.reduce((sum, s) => sum + s.weight, 0) * band.repeat;
  const out: [number, number, Outline | null][] = [];
  let a = band.phase ?? 0;
  for (let k = 0; k < band.repeat; k++) {
    for (const sector of band.pattern) {
      const span = (sector.weight / total) * Math.PI * 2;
      out.push([a, a + span, sector.window]);
      a += span;
    }
  }
  return out;
}

const norm = (a: number): number => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

/** The angles every rim ring samples: the base division and every band's sector edges. */
function anglesOf(design: RimDesign): number[] {
  const set: number[] = [];
  for (let i = 0; i < design.baseSegments; i++) set.push((i / design.baseSegments) * Math.PI * 2);
  for (const band of design.bands) for (const [a] of sectorsOf(band)) set.push(norm(a));
  set.sort((p, q) => p - q);
  const out: number[] = [];
  for (const a of set) if (out.length === 0 || a - out[out.length - 1]! > 1e-6) out.push(a);
  if (out.length > 1 && Math.PI * 2 - out[out.length - 1]! + out[0]! < 1e-6) out.pop();
  return out;
}

/** The ring's angles from a to b (a < b, unwrapped), both ends included. */
function anglesBetween(angles: readonly number[], a: number, b: number): number[] {
  const out = [a];
  const turns = Math.floor(a / (Math.PI * 2));
  for (let t = turns; t <= turns + 1; t++) {
    for (const g of angles) {
      const u = g + t * Math.PI * 2;
      if (u > a + 1e-6 && u < b - 1e-6) out.push(u);
    }
  }
  out.sort((p, q) => p - q);
  out.push(b);
  return out;
}

/** Smallest t > 0 where c + t·d meets the outline's edge; Infinity if it never does. */
function castToOutline(cy: number, cz: number, dy: number, dz: number, outline: readonly (readonly [number, number])[]): number {
  let best = Infinity;
  for (let i = 0; i < outline.length; i++) {
    const [ay, az] = outline[i]!;
    const [by, bz] = outline[(i + 1) % outline.length]!;
    const ey = by - ay, ez = bz - az;
    const den = dy * ez - dz * ey;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((ay - cy) * ez - (az - cz) * ey) / den;
    const s = ((ay - cy) * dz - (az - cz) * dy) / den;
    if (t > 1e-9 && s >= -1e-9 && s <= 1 + 1e-9 && t < best) best = t;
  }
  return best;
}

/** One band of the face: each sector's border joined to its window, the windows walled. */
function buildBand(b: PartBuilder, design: RimDesign, band: RimBand, rr: number, angles: readonly number[], faceSlot: KitSlot): void {
  const faceX = (r: number): number => profileX(design.profile, r / rr);
  const r0 = band.r0 * rr;
  const r1 = band.r1 * rr;
  for (const [a0, a1, window] of sectorsOf(band)) {
    // The border, round the sector: inner arc, far radial edge, outer arc back, near edge.
    const border: [number, number][] = [];
    const inner = anglesBetween(angles, a0, a1);
    for (let i = 0; i < inner.length - 1; i++) border.push([r0, inner[i]!]);
    for (let i = 0; i < band.radialSteps; i++) border.push([r0 + ((r1 - r0) * i) / band.radialSteps, a1]);
    for (let i = inner.length - 1; i > 0; i--) border.push([r1, inner[i]!]);
    for (let i = 0; i < band.radialSteps; i++) border.push([r1 - ((r1 - r0) * i) / band.radialSteps, a0]);
    const ring = border.map(([r, a]) => at(r, a, faceX(r)));
    const rc = (r0 + r1) / 2;
    const ac = (a0 + a1) / 2;
    const cy = Math.cos(ac) * rc;
    const cz = Math.sin(ac) * rc;
    if (!window) {
      const centre = at(rc, ac, faceX(rc));
      for (let i = 0; i < ring.length; i++) tri(b, faceSlot, centre, ring[i]!, ring[(i + 1) % ring.length]!, [1, 0, 0]);
      continue;
    }
    // The window in the face's plane: its outline placed in the sector's frame.
    const uy = Math.cos(ac), uz = Math.sin(ac);
    const vy = -uz, vz = uy;
    const hr = (r1 - r0) / 2;
    const ht = (rc * (a1 - a0)) / 2;
    const twist = band.twist ?? 0;
    const outline = window.map(([u, v]): [number, number] => {
      const su = u * hr, sv = v * ht;
      const tu = su * Math.cos(twist) - sv * Math.sin(twist);
      const tv = su * Math.sin(twist) + sv * Math.cos(twist);
      return [cy + uy * tu + vy * tv, cz + uz * tu + vz * tv];
    });
    const hole: Vec3[] = border.map(([r, a]) => {
      const dy = Math.cos(a) * r - cy;
      const dz = Math.sin(a) * r - cz;
      const t = Math.min(castToOutline(cy, cz, dy, dz, outline), 0.9);
      const y = cy + dy * t, z = cz + dz * t;
      return [faceX(Math.hypot(y, z)), y, z];
    });
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      quad(b, faceSlot, ring[i]!, ring[j]!, hole[j]!, hole[i]!, [1, 0, 0]);
    }
    if (band.depth > 0) {
      for (let i = 0; i < hole.length; i++) {
        const j = (i + 1) % hole.length;
        const p = hole[i]!, q = hole[j]!;
        const my = (p[1] + q[1]) / 2, mz = (p[2] + q[2]) / 2;
        quad(b, faceSlot, p, q, [q[0] - band.depth, q[1], q[2]], [p[0] - band.depth, p[1], p[2]], [0, cy - my, cz - mz]);
      }
    }
  }
}

/** The face: plain rings of the profile between the bands, the bands, the centre. */
function buildFace(b: PartBuilder, design: RimDesign, rr: number, angles: readonly number[]): void {
  const slot = ink(b, design.face);
  const edges = design.bands.map((band) => [band.r0, band.r1] as const);
  const inBand = (r0: number, r1: number): boolean => edges.some(([lo, hi]) => r0 >= lo - 1e-6 && r1 <= hi + 1e-6);
  const radii = [...new Set([...design.profile.map(([r]) => r), ...edges.flat()])].sort((p, q) => q - p);
  for (let i = 0; i + 1 < radii.length; i++) {
    const ra = radii[i]!, rb = radii[i + 1]!;
    if (inBand(rb, ra)) continue;
    lathe(b, slot, [[ra * rr, profileX(design.profile, ra)], [rb * rr, profileX(design.profile, rb)]], angles, [rr * 2, -1]);
  }
  for (const band of design.bands) buildBand(b, design, band, rr, angles, slot);
}

function buildTyre(b: PartBuilder, rr: number): void {
  const angles = Array.from({ length: TYRE_SEGMENTS }, (_, i) => (i / TYRE_SEGMENTS) * Math.PI * 2);
  const R = TYRE_R, w = HALF_W;
  const bead = rr * 1.04;
  b.color(0x161617);
  lathe(b, 'tyre', [
    [bead, -w * 0.8],
    [R - R * 0.14, -w],
    [R, -w * 0.72],
    [R, w * 0.72],
    [R - R * 0.14, w],
    [bead, w * 0.8],
  ], angles, [(R + rr) / 2, 0]);
}

/** One wheel of a design, at the nominal size, with every surface finished. */
export function buildRimWheel(design: RimDesign): THREE.Group {
  const b = new PartBuilder();
  const rr = TYRE_R * design.rimRatio;
  const angles = anglesOf(design);
  buildTyre(b, rr);
  // The flange, from its top over the tyre's bead to the face's edge.
  const lip = ink(b, design.lip);
  lathe(b, lip, design.lipProfile.map(([r, x]) => [r * rr, x] as const), angles, [rr * 1.3, -0.3]);
  buildFace(b, design, rr, angles);
  // What the windows show: the barrel inside the rim and the brake drum behind the face,
  // at the tyre's division (they meet nothing else, so need not share the rim's angles).
  const inner = Array.from({ length: TYRE_SEGMENTS }, (_, i) => (i / TYRE_SEGMENTS) * Math.PI * 2);
  b.color(0x2a2c2f);
  const faceBack = Math.min(...design.profile.map(([, x]) => x)) - 0.04;
  lathe(b, 'trim', [[rr * 0.96, faceBack + 0.03], [rr * 0.96, -HALF_W * 0.8]], inner, [rr * 2, 0]);
  // The drum closes the wheel: seen from behind (only ever from under the arch) its back
  // is the same dark disc, the material being double sided.
  b.color(0x17181a);
  lathe(b, 'trim', [[rr * 0.96, faceBack], [0, faceBack]], inner, [0, -1]);
  if (design.bolts) {
    const { count, pitch, radius, finish } = design.bolts;
    const slot = ink(b, finish);
    const nut = radius * rr;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.PI / count;
      const r = pitch * rr;
      const x = profileX(design.profile, pitch) + nut * 0.7;
      b.cylinderX(slot, [x, Math.cos(a) * r, Math.sin(a) * r], nut, nut * 0.7, 6);
    }
  }
  if (design.cap) {
    const cap = design.cap;
    const slot = ink(b, cap.finish);
    const base = profileX(design.profile, cap.profile[0]![0]);
    const capAngles = Array.from({ length: 12 }, (_, i) => (i / 12) * Math.PI * 2);
    lathe(b, slot, cap.profile.map(([r, h]) => [r * rr, base + h * rr] as const), capAngles, [0, -1]);
    if (cap.badge) {
      b.color(BADGE_DARK);
      const top = base + cap.profile[cap.profile.length - 1]![1] * rr + 0.0015;
      lathe(b, 'trim', [[cap.badge * rr, top], [0, top]], capAngles, [0, -1]);
    }
  }
  const group = new THREE.Group();
  for (const [slot, geometry] of b.build()) {
    const mesh = new THREE.Mesh(geometry);
    mesh.name = `rim_${slot}`;
    mesh.userData.kitSlot = slot;
    group.add(mesh);
  }
  finishKitSurfaces(group);
  // What the car's own kit material reads besides the surface bytes, so a set draws in
  // it (render/carmodel.ts): the chassis stamp, which only places dirt on paint (none
  // here), and the shadow flags, casting and receiving as every wheel does.
  for (const mesh of group.children as THREE.Mesh[]) {
    const count = mesh.geometry.getAttribute('position').count;
    mesh.geometry.setAttribute(CAR_BODY_POSITION_ATTRIBUTE, new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    mesh.geometry.setAttribute(KIT_SHADOW_ATTRIBUTE, new THREE.BufferAttribute(new Uint8Array(count * 2).fill(255), 2, true));
  }
  return group;
}

export function rimDesign(id: string): RimDesign | undefined {
  return RIM_DESIGNS.find((design) => design.id === id);
}

/** A generated set's id (`RimDesign.id`) rather than a pack model's. */
export function isGeneratedWheelSet(id: string): boolean {
  return id.startsWith('gw_');
}
