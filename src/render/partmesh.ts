/**
 * Procedural meshes for every part and carried item in the game.
 *
 * Everything is built from primitives; the football adds one generated leather texture.
 * Geometry and immutable materials are cached, while
 * each create* call returns a fresh Object3D. Condition-sensitive parts still get
 * independent materials so dirt and rust never bleed between instances.
 *
 * Car bodies are complete, authored GLB models (see render/carmodel.ts); this module
 * only builds the service parts and held items.
 *
 * Origin convention (load-bearing for the Vehicle and LoosePartField): a part's
 * origin is its mount point, in +X right / +Y up / +Z forward.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { maxAnisotropy } from './texturequality';
import { variant } from '../parts/registry';
import type { EngineSpec, PartVariant } from '../parts/registry';
import type {
  Item,
  QuarryItem,
  ShadeTint,
  ToolKind,
  WeaponKind,
} from '../items/items';
import { contractThing, isBrokenThing, spongeSpent } from '../items/items';
import { makeFlatMaterial } from './materials';
import { applyComicShading } from './comic';
import {
  AXIS_X,
  AXIS_Z,
  MeshBuilder,
  ONE,
  ZERO,
  buildGroup,
  cachedGeo,
  clearGeometryCache,
  cond,
  flat,
  glass,
  halfExtentsOf,
  type Instruction,
} from './meshbuilder';
import { buildThingInto, thingModelKey } from './thingmesh';

// ---------------------------------------------------------------------------
// Part blueprints
// ---------------------------------------------------------------------------

interface Blueprint {
  readonly instructions: readonly Instruction[];
  readonly halfExtents: { x: number; y: number; z: number };
}

const blueprintCache = new Map<string, Blueprint>();

function blueprint(variantId: string): Blueprint {
  let bp = blueprintCache.get(variantId);
  if (bp === undefined) {
    const builder = new MeshBuilder();
    buildPart(builder, variant(variantId));
    const instructions = builder.instructions;
    bp = { instructions, halfExtents: halfExtentsOf(instructions) };
    blueprintCache.set(variantId, bp);
  }
  return bp;
}

function buildPart(b: MeshBuilder, v: PartVariant): void {
  switch (v.kind) {
    case 'engine': return buildEngine(b, v);
    case 'gearbox': return buildGearbox(b, v);
    case 'radiator': return buildRadiator(b, v);
    case 'turbine': return buildTurbine(b, v);
    case 'air_filter': return buildAirFilter(b, v);
  }
}

// ----------------------------- engines -----------------------------

function buildEngine(b: MeshBuilder, v: PartVariant): void {
  const spec = v.engine as EngineSpec;
  switch (v.id) {
    case 'engine_i4_1600': return buildInline(b, spec, 1.0);
    case 'engine_uzam_412de': return buildInline(b, spec, 0.97);
    // The UAZ's tall 2.89-litre UMZ four is physically larger than the 1.6 family.
    case 'engine_umz_4213': return buildInline(b, spec, 1.16);
    case 'engine_i6_2800': return buildInline(b, spec, 1.12);
    // The imports, scaled by displacement against the 1.6 at 1.0.
    case 'engine_bmw_m30': return buildInline(b, spec, 1.14);
    case 'engine_bmw_m10_tii': return buildInline(b, spec, 1.06);
    case 'engine_cosworth_bda': return buildInline(b, spec, 0.98);
    case 'engine_ford_cologne_v6': return buildVee(b, spec, 1.0);
    // The Rover's alloy V8 is compact for eight cylinders; the Chevrolet is not.
    case 'engine_rover_v8': return buildVee(b, spec, 0.98);
    case 'engine_chevy_350': return buildVee(b, spec, 1.14);
    // The Soviet fours, scaled by displacement against the 1.6 at 1.0.
    case 'engine_lada_1200': return buildInline(b, spec, 0.88);
    case 'engine_lada_1300':
    case 'engine_samara_1300': return buildInline(b, spec, 0.91);
    case 'engine_lada_1500':
    case 'engine_samara_1500':
    // The 2111 is the 21083's block on injection.
    case 'engine_vaz_2111': return buildInline(b, spec, 0.96);
    // Half a 2108: the 1.3's 76 mm bore and block section, two cylinders long.
    case 'engine_vaz_1111': return buildInline(b, spec, 0.91);
    case 'engine_lada_1600':
    case 'engine_lada_rally':
    case 'engine_niva_1600': return buildInline(b, spec, 1.0);
    case 'engine_niva_1700': return buildInline(b, spec, 1.02);
    // The Nexia's 1.5, the 2111's size.
    case 'engine_daewoo_g15mf': return buildInline(b, spec, 0.96);
    // The Espero's 2.0 Family II: a bigger block than the 1.5.
    case 'engine_daewoo_c20le': return buildInline(b, spec, 1.05);
    // The Astra F's 1.6 Family I, the Nexia's block a size up.
    case 'engine_opel_c16nz': return buildInline(b, spec, 0.98);
    // The Vectra's 2.0 Family II, the Espero's block.
    case 'engine_opel_c20ne': return buildInline(b, spec, 1.05);
    // The Volga 2.4: a tall, long-stroke four, so a taller block than the 1.6. The UAZ's
    // UMZ-4178 and the GAZ-31029's ZMZ-402 are the same block.
    case 'engine_zmz_21':
    case 'engine_zmz_24':
    case 'engine_zmz_402':
    case 'engine_umz_4178': return buildInline(b, spec, 1.09);
    default: throw new Error(`unhandled engine variant: ${v.id}`);
  }
}

/** Inline engine: block length grows with cylinder count. */
function buildInline(b: MeshBuilder, spec: EngineSpec, scale: number): void {
  const n = spec.cylinders;
  const id = `inline_${n}_${scale}`;
  const iron = cond(0x3a3f45, 0.8, 0.5);
  const alloy = cond(0xaab0b6, 0.9, 0.3);
  const dark = cond(0x23262a, 0.5, 0.7);
  const rusty = cond(0x6a4a35, 0.85, 0.55);

  const len = (0.2 + n * 0.17) * scale;
  const w = 0.46 * scale;
  const sumpH = 0.05 * scale;
  const blockH = 0.17 * scale;
  const headH = 0.08 * scale;
  const coverH = 0.08 * scale;
  const blockTop = sumpH + blockH;
  const headTop = blockTop + headH;

  b.box(`${id}_sump`, w * 0.7, sumpH, len * 0.7, iron, [0, sumpH / 2, 0]);
  b.box(`${id}_block`, w, blockH, len, iron, [0, sumpH + blockH / 2, 0]);
  b.box(`${id}_head`, w * 0.92, headH, len, alloy, [0, blockTop + headH / 2, 0]);
  b.box(`${id}_cover`, w * 0.55, coverH, len * 0.9, alloy, [0, headTop + coverH / 2, 0]);

  // intake manifold: plenum on the +X side
  b.box(`${id}_intake`, 0.14 * scale, 0.12 * scale, len * 0.55, dark, [w * 0.5 + 0.07 * scale, blockTop + headH * 0.5, 0]);

  // exhaust pipe along Z on the -X side, with one runner per cylinder
  const ex = w * 0.55 + 0.05 * scale;
  b.cylinder(`${id}_expipe`, 0.05 * scale, 0.05 * scale, len * 0.85, 12, rusty, [-ex, blockTop * 0.45, 0], AXIS_Z);
  for (let i = 0; i < n; i++) {
    const z = (i / (n - 1) - 0.5) * len * 0.68;
    b.cylinder(`${id}_runner_${i}`, 0.034 * scale, 0.034 * scale, 0.16 * scale, 8, rusty, [-(w * 0.5 + ex) / 2, blockTop * 0.55, z], AXIS_X);
  }

  // ignition leads / spark plugs along the head
  for (let i = 0; i < n; i++) {
    const z = (i / (n - 1) - 0.5) * len * 0.6;
    b.cylinder(`${id}_plug_${i}`, 0.018 * scale, 0.018 * scale, 0.05 * scale, 6, dark, [0, headTop + coverH + 0.01 * scale, z]);
  }
}

/**
 * V engine: a short block with two banks splayed at 90 degrees, a carburettor or
 * injection plenum in the valley between them and a manifold down each flank.
 */
function buildVee(b: MeshBuilder, spec: EngineSpec, scale: number): void {
  const n = spec.cylinders;
  const perBank = Math.ceil(n / 2);
  const id = `vee_${n}_${scale}`;
  const iron = cond(0x3a3f45, 0.8, 0.5);
  const alloy = cond(0xaab0b6, 0.9, 0.3);
  const dark = cond(0x23262a, 0.5, 0.7);
  const rusty = cond(0x6a4a35, 0.85, 0.55);

  const len = (0.24 + perBank * 0.15) * scale;
  const w = 0.5 * scale;
  const sumpH = 0.06 * scale;
  const blockH = 0.16 * scale;
  const blockTop = sumpH + blockH;
  const bankW = 0.2 * scale;
  const bankH = 0.14 * scale;
  const tilt = Math.PI / 4;

  b.box(`${id}_sump`, w * 0.7, sumpH, len * 0.75, iron, [0, sumpH / 2, 0]);
  b.box(`${id}_block`, w, blockH, len, iron, [0, sumpH + blockH / 2, 0]);
  for (const side of [-1, 1]) {
    const x = side * w * 0.3;
    const y = blockTop + bankH * 0.45;
    b.box(`${id}_bank_${side}`, bankW, bankH, len, iron, [x, y, 0], [0, 0, -side * tilt]);
    b.box(`${id}_cover_${side}`, bankW * 0.8, 0.05 * scale, len * 0.92, alloy, [x + side * 0.05 * scale, y + bankH * 0.5, 0], [0, 0, -side * tilt]);
    // One exhaust manifold per bank, low on the flank.
    b.cylinder(`${id}_expipe_${side}`, 0.045 * scale, 0.045 * scale, len * 0.85, 12, rusty, [side * (w * 0.5 + 0.06 * scale), blockTop * 0.6, 0], AXIS_Z);
    for (let i = 0; i < perBank; i++) {
      const z = (perBank > 1 ? i / (perBank - 1) - 0.5 : 0) * len * 0.7;
      b.cylinder(`${id}_plug_${side}_${i}`, 0.018 * scale, 0.018 * scale, 0.05 * scale, 6, dark, [x + side * 0.1 * scale, y + bankH * 0.35, z], [0, 0, -side * tilt]);
    }
  }
  // Intake plenum in the valley, with the air cleaner's drum on top.
  b.box(`${id}_plenum`, w * 0.34, 0.1 * scale, len * 0.7, alloy, [0, blockTop + bankH * 0.7, 0]);
  b.cylinder(`${id}_aircleaner`, 0.16 * scale, 0.16 * scale, 0.06 * scale, 16, dark, [0, blockTop + bankH * 0.7 + 0.08 * scale, 0]);
}

// ----------------------------- gearboxes -----------------------------

function buildGearbox(b: MeshBuilder, v: PartVariant): void {
  const alloy = cond(0x9aa3ab, 0.9, 0.35);
  const dark = cond(0x23262a, 0.5, 0.7);
  let scale = 1;
  let manual = true;
  let fins = false;
  switch (v.id) {
    case 'gearbox_izh_4': scale = 0.98; manual = true; fins = false; break;
    case 'gearbox_uaz_4': scale = 1.1; manual = true; fins = false; break;
    // Small four-speed: the estate's own box, noticeably shorter than the 5-speed.
    case 'gearbox_lada_4': scale = 0.92; manual = true; fins = false; break;
    case 'gearbox_manual5': scale = 1.15; manual = true; fins = false; break;
    // The Soviet boxes: the classics' own casings, the Volga's longer three- and
    // four-speeds, the Samara transaxle (which carries its final drive) and the
    // Nivas, which carry a transfer case as well.
    case 'gearbox_lada_4_2102':
    case 'gearbox_lada_4_2105':
    case 'gearbox_lada_4_tall':
    case 'gearbox_lada_4_1600': scale = 0.92; manual = true; fins = false; break;
    case 'gearbox_lada_5': scale = 1.0; manual = true; fins = false; break;
    case 'gearbox_gaz_3': scale = 1.05; manual = true; fins = false; break;
    case 'gearbox_gaz_4':
    case 'gearbox_gaz_4_31029': scale = 1.1; manual = true; fins = false; break;
    case 'gearbox_samara_5':
    case 'gearbox_samara_5_tall': scale = 1.08; manual = true; fins = true; break;
    // The Oka's transaxle: the Samara layout at a smaller scale, final drive included.
    case 'gearbox_oka_4': scale = 0.86; manual = true; fins = true; break;
    // The Opel F16 transaxle, final drive included: the Samara's layout.
    case 'gearbox_opel_f16_nexia': scale = 1.05; manual = true; fins = true; break;
    // The Opel F13 transaxle, the same layout.
    case 'gearbox_opel_f13_wr': scale = 1.03; manual = true; fins = true; break;
    // The Vectra's F16, the Nexia box with another axle.
    case 'gearbox_opel_f16_wr_355': scale = 1.05; manual = true; fins = true; break;
    case 'gearbox_niva_4': scale = 1.2; manual = true; fins = false; break;
    case 'gearbox_niva_5': scale = 1.26; manual = true; fins = false; break;
    case 'gearbox_auto3': scale = 1.2; manual = false; fins = true; break;
    case 'gearbox_truck6': scale = 1.5; manual = true; fins = true; break;
    default: throw new Error(`unhandled gearbox variant: ${v.id}`);
  }
  const id = v.id;
  const len = 0.6 * scale;
  const w = 0.3 * scale;
  const h = 0.26 * scale;

  b.cylinder(`${id}_bell`, 0.2 * scale, 0.16 * scale, 0.2 * scale, 20, alloy, [0, 0.02 * scale, len * 0.4], AXIS_Z);
  b.box(`${id}_case`, w, h, len, alloy, [0, 0, 0]);
  b.cylinder(`${id}_tail`, 0.09 * scale, 0.09 * scale, 0.3 * scale, 16, alloy, [0, -0.02 * scale, -len * 0.55], AXIS_Z);

  if (manual) {
    b.cylinder(`${id}_lever`, 0.015 * scale, 0.015 * scale, 0.22 * scale, 8, dark, [w * 0.35, h * 0.5, -len * 0.1]);
    b.sphere(`${id}_knob`, 0.035 * scale, 10, 8, dark, [w * 0.35, h * 0.5 + 0.11 * scale, -len * 0.1]);
  }
  if (fins) {
    for (let i = 0; i < 4; i++) {
      const z = (i / 3 - 0.5) * len * 0.7;
      b.box(`${id}_fin_${i}`, w * 0.7, 0.015 * scale, 0.05 * scale, dark, [0, h * 0.5 + 0.008 * scale, z]);
    }
  }
}


/**
 * The generic flat-panel door.
 *
 * Canonical face is -Z; the mount's ±90° yaw turns it onto the flank.
 */

/**
 * Dashboards. Wide and shallow, sitting in front of the driver's eye.
 *
 * Origin is the mount point; the binnacle stands above it and the fascia runs
 * forward, as it does in the car.
 */







/** The radiator: one core, a header and bottom tank, and the filler cap. */
function buildRadiator(b: MeshBuilder, v: PartVariant): void {
  const blackenedSteel = cond(0x2c3135, 0.7, 0.6);
  const paintedSteel = cond(0x566068, 0.75, 0.5);
  const cap = flat(0x2d4b6b, 0.55);
  const id = v.id;
  b.box(`${id}_core`, 0.72, 0.5, 0.06, blackenedSteel, [0, 0, 0]);
  b.box(`${id}_top`, 0.72, 0.08, 0.10, paintedSteel, [0, 0.25, 0]);
  b.box(`${id}_bot`, 0.72, 0.08, 0.10, paintedSteel, [0, -0.25, 0]);
  b.box(`${id}_tank_l`, 0.08, 0.44, 0.12, paintedSteel, [-0.36, 0, 0]);
  b.box(`${id}_tank_r`, 0.08, 0.44, 0.12, paintedSteel, [0.36, 0, 0]);
  for (let i = -3; i <= 3; i++) {
    b.box(`${id}_fin_${i}`, 0.68, 0.04, 0.02, paintedSteel, [0, i * 0.055, 0.035]);
  }
  b.box(`${id}_mount`, 0.42, 0.04, 0.12, blackenedSteel, [0, -0.29, 0]);
  b.cylinder(`${id}_inlet`, 0.045, 0.045, 0.12, 8, paintedSteel, [-0.24, 0.29, 0.08], AXIS_Z);
  b.cylinder(`${id}_outlet`, 0.045, 0.045, 0.12, 8, paintedSteel, [0.24, -0.29, 0.08], AXIS_Z);
  b.cylinder(`${id}_fan_mount`, 0.058, 0.058, 0.03, 8, blackenedSteel, [0, 0, -0.06], AXIS_Z);
  b.cylinder(`${id}_neck`, 0.055, 0.055, 0.06, 12, paintedSteel, [0.24, 0.31, 0]);
  b.cylinder(`${id}_cap`, 0.065, 0.065, 0.035, 12, cap, [0.24, 0.3575, 0]);
}

/**
 * The period round air cleaner element: a pleated paper ring between two steel end
 * caps, the size of a dinner plate.
 */
function buildAirFilter(b: MeshBuilder, v: PartVariant): void {
  const steel = cond(0x3d4247, 0.8, 0.45);
  const paper = cond(0xd9c48a, 0.05, 0.9);
  b.cylinder(`${v.id}_cap_bottom`, 0.15, 0.15, 0.01, 24, steel, [0, 0.005, 0]);
  b.cylinder(`${v.id}_cap_top`, 0.15, 0.15, 0.01, 24, steel, [0, 0.065, 0]);
  b.torus(`${v.id}_pleats`, 0.12, 0.028, 10, 32, paper, [0, 0.035, 0], [Math.PI / 2, 0, 0], [1, 1, 1.05]);
  b.cylinder(`${v.id}_mesh`, 0.09, 0.09, 0.05, 20, steel, [0, 0.035, 0]);
}

function buildTurbine(b: MeshBuilder, v: PartVariant): void {
  const steel = cond(0x7b838b, 0.9, 0.3);
  const dark = cond(0x34383d, 0.8, 0.5);
  b.cylinder(`${v.id}_compressor`, 0.19, 0.19, 0.18, 20, steel, [0, 0, 0], AXIS_X);
  b.cylinder(`${v.id}_hub`, 0.07, 0.07, 0.22, 16, dark, [0, 0, 0], AXIS_X);
  b.cylinder(`${v.id}_inlet`, 0.09, 0.09, 0.2, 16, steel, [0.18, 0.08, 0], AXIS_Z);
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

const itemBlueprintCache = new Map<string, Blueprint>();

function itemBlueprint(key: string, build: (b: MeshBuilder) => void): Blueprint {
  let bp = itemBlueprintCache.get(key);
  if (bp === undefined) {
    const builder = new MeshBuilder();
    build(builder);
    const instructions = builder.instructions;
    bp = { instructions, halfExtents: halfExtentsOf(instructions) };
    itemBlueprintCache.set(key, bp);
  }
  return bp;
}

function buildToolInto(b: MeshBuilder, kind: ToolKind, spent: boolean): void {
  switch (kind) {
    case 'sponge': return sponge(b, spent);
    default: throw new Error(`unhandled tool kind: ${kind}`);
  }
}

/** Car-wash sponge size, metres: the big bone-shaped block sold for washing a car. */
const SPONGE_L = 0.21;
const SPONGE_T = 0.07;
const SPONGE_END_W = 0.125;
const SPONGE_WAIST_W = 0.088;
/** How far in from each end the rounding of the end starts. */
const SPONGE_END_R = 0.035;

/** Half the sponge's width at `x` along it: full at the ends, pinched at the waist. */
function spongeHalfWidth(x: number): number {
  const waist = Math.cos((Math.PI * x) / SPONGE_L);
  let half = SPONGE_END_W / 2 - ((SPONGE_END_W - SPONGE_WAIST_W) / 2) * waist * waist;
  const intoEnd = Math.abs(x) - (SPONGE_L / 2 - SPONGE_END_R);
  if (intoEnd > 0) half *= Math.sqrt(Math.max(0, 1 - (intoEnd / SPONGE_END_R) ** 2));
  return half;
}

/**
 * The foam body: the bone outline extruded through the sponge's thickness with a deep
 * soft bevel, so every edge is the rounded, squashable edge of coarse foam rather than
 * a cut block. Built in XY, then laid flat: length along X, thickness along Y.
 */
function spongeBodyGeometry(): THREE.BufferGeometry {
  const bevel = 0.014;
  const inset = 0.011;
  const shape = new THREE.Shape();
  const steps = 40;
  const outline = (x: number): number => Math.max(0.004, spongeHalfWidth(x) - inset);
  const reach = SPONGE_L / 2 - inset;
  for (let i = 0; i <= steps; i++) {
    const x = -reach + (2 * reach * i) / steps;
    const y = outline(x * (SPONGE_L / 2) / reach);
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  for (let i = steps; i >= 0; i--) {
    const x = -reach + (2 * reach * i) / steps;
    shape.lineTo(x, -outline(x * (SPONGE_L / 2) / reach));
  }
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: SPONGE_T - 2 * bevel,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: inset,
    bevelSegments: 4,
    curveSegments: 8,
  });
  geometry.rotateX(Math.PI / 2);
  geometry.center();
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * The open cells of the foam, merged into one mesh: shallow flattened pits scattered
 * over the top, bottom and both long flanks, dense and of every size, which is what
 * tells a coarse wash sponge from a fine kitchen one at arm's length.
 */
function spongePoresGeometry(): THREE.BufferGeometry {
  const rnd = (() => {
    let state = 0x5b0a9e11;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return (state >>> 8) / 0x1000000;
    };
  })();
  const cell = new THREE.SphereGeometry(1, 7, 4);
  const pores: THREE.BufferGeometry[] = [];
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const add = (x: number, y: number, z: number, normal: THREE.Vector3, r: number): void => {
    quat.setFromUnitVectors(up, normal);
    matrix.compose(new THREE.Vector3(x, y, z), quat, new THREE.Vector3(r * (0.8 + rnd() * 0.6), r * 0.22, r * (0.7 + rnd() * 0.5)));
    pores.push(cell.clone().applyMatrix4(matrix));
  };
  const half = SPONGE_T / 2;
  // Top and bottom faces, inside the bevel.
  for (const side of [1, -1]) {
    for (let i = 0; i < 70; i++) {
      const x = (rnd() - 0.5) * (SPONGE_L - 0.04);
      const w = spongeHalfWidth(x) - 0.018;
      if (w <= 0) continue;
      add(x, side * (half - 0.0005), (rnd() * 2 - 1) * w, new THREE.Vector3(0, side, 0), 0.0025 + rnd() * rnd() * 0.0055);
    }
  }
  // The two long flanks, following the waist's curve.
  for (const side of [1, -1]) {
    for (let i = 0; i < 64; i++) {
      const x = (rnd() - 0.5) * (SPONGE_L - 0.06);
      const w = spongeHalfWidth(x);
      const dw = (spongeHalfWidth(x + 0.001) - spongeHalfWidth(x - 0.001)) / 0.002;
      const normal = new THREE.Vector3(-dw * side, 0, side).normalize();
      add(x, (rnd() - 0.5) * (SPONGE_T - 0.03), side * (w - 0.0005), normal, 0.0022 + rnd() * rnd() * 0.005);
    }
  }
  const merged = mergeGeometries(pores, false);
  cell.dispose();
  for (const pore of pores) pore.dispose();
  if (!merged) throw new Error('sponge pores failed to merge');
  return merged;
}

/**
 * A car-wash sponge: the big bone-shaped block of coarse open-cell foam sold for
 * washing a car — about 21 by 12 by 7 cm, pinched at the waist for the grip, soft on
 * every edge, pitted all over, and with no scouring layer, because a scourer is the
 * last thing that goes near paint. A spent one has taken the colour of everything it
 * wiped off.
 */
function sponge(b: MeshBuilder, spent: boolean): void {
  const body = flat(spent ? 0x7d6c4c : 0xf0b62e, 0.97);
  const pore = flat(spent ? 0x4a3e2e : 0xa8741a, 1);
  b.push('sponge_body_bone', spongeBodyGeometry, body, [0, 0, 0]);
  b.push('sponge_pores_bone', spongePoresGeometry, pore, [0, 0, 0]);
}

/**
 * A 400 ml aerosol, upright, the nozzle aimed down +Z the way the tools point. The
 * tin is the paint's own colour, the only label a shelf of them needs.
 */
function buildSprayCanInto(b: MeshBuilder, paint: number): void {
  const tin = cond(paint, 0.55, 0.32);
  const steel = cond(0xb9bdc1, 0.9, 0.3);
  const actuator = flat(0xe8e4dc, 0.5);
  b.cylinder('spray_tin', 0.033, 0.033, 0.19, 16, tin, [0, 0, 0]);
  b.cylinder('spray_rim_bottom', 0.034, 0.034, 0.01, 16, steel, [0, -0.095, 0]);
  b.cylinder('spray_shoulder', 0.012, 0.034, 0.03, 16, steel, [0, 0.11, 0]);
  b.cylinder('spray_valve', 0.01, 0.01, 0.012, 8, steel, [0, 0.13, 0]);
  b.box('spray_actuator', 0.024, 0.02, 0.028, actuator, [0, 0.145, 0.002]);
  b.cylinder('spray_nozzle', 0.004, 0.004, 0.008, 6, flat(0x202225, 0.6), [0, 0.148, 0.018], AXIS_Z);
}

/**
 * One jerrycan for every fluid, the khaki steel of a real one: a can holds whatever was
 * poured into it first (items/items.ts), so its colour says nothing about its contents.
 * The label (`itemLabel`) does.
 */
function buildFluidCanInto(b: MeshBuilder): void {
  const metal = cond(0x5a6238, 0.7, 0.4);
  const cap = flat(0x23262a, 0.6);
  b.box('fuel_body', 0.34, 0.24, 0.16, metal, [0, 0, 0]);
  b.box('fuel_handle_l', 0.04, 0.1, 0.04, metal, [-0.08, 0.18, 0]);
  b.box('fuel_handle_r', 0.04, 0.1, 0.04, metal, [0.08, 0.18, 0]);
  b.box('fuel_handle_top', 0.2, 0.04, 0.04, metal, [0, 0.24, 0]);
  b.cylinder('fuel_spout', 0.025, 0.025, 0.1, 10, metal, [0, 0.1, 0.1], AXIS_Z);
  b.cylinder('fuel_cap', 0.03, 0.03, 0.03, 10, cap, [0, 0.16, 0.1], AXIS_Z);
}

function buildWeaponInto(b: MeshBuilder, kind: WeaponKind): void {
  switch (kind) {
    case 'rifle': return rifle(b);
    case 'shotgun': return shotgun(b);
    default: throw new Error(`unhandled weapon kind: ${kind}`);
  }
}

function rifle(b: MeshBuilder): void {
  const steel = cond(0x2e3236, 0.9, 0.35);
  const wood = flat(0x6b4a2e, 0.7);
  b.cylinder('rifle_barrel', 0.012, 0.012, 0.5, 10, steel, [0, 0.02, 0.25], AXIS_Z);
  b.box('rifle_receiver', 0.05, 0.07, 0.28, steel, [0, 0, 0.02]);
  b.box('rifle_stock', 0.05, 0.09, 0.3, wood, [0, -0.02, -0.28]);
  b.box('rifle_mag', 0.04, 0.14, 0.06, steel, [0, -0.1, 0.05]);
  b.cylinder('rifle_scope', 0.02, 0.02, 0.16, 10, steel, [0, 0.06, 0.05], AXIS_Z);
}

function shotgun(b: MeshBuilder): void {
  const steel = cond(0x3a3f45, 0.85, 0.4);
  const wood = flat(0x6b4a2e, 0.7);
  b.cylinder('shotgun_barrel', 0.018, 0.018, 0.5, 10, steel, [0, 0.02, 0.26], AXIS_Z);
  b.cylinder('shotgun_pump', 0.03, 0.03, 0.12, 10, wood, [0, 0.02, 0.08], AXIS_Z);
  b.box('shotgun_receiver', 0.05, 0.07, 0.24, steel, [0, 0, -0.05]);
  b.box('shotgun_stock', 0.05, 0.1, 0.26, wood, [0, -0.02, -0.26]);
}

function buildAmmoInto(b: MeshBuilder): void {
  const boxMat = flat(0x8a7a4a, 0.7);
  const shell = cond(0xb0a058, 0.9, 0.3);
  b.box('ammo_box', 0.16, 0.1, 0.12, boxMat, [0, 0, 0]);
  for (let i = 0; i < 5; i++) {
    const x = (i / 4 - 0.5) * 0.12;
    b.cylinder(`ammo_shell_${i}`, 0.012, 0.012, 0.05, 8, shell, [x, 0.06, 0]);
  }
}

function buildQuarryInto(b: MeshBuilder): void {
  const feather = flat(0x6b5a48, 0.9);
  const beak = flat(0xc9a227, 0.5);
  b.sphere('quarry_body', 0.14, 12, 10, feather, [0, 0.06, 0], [1, 0.75, 1.3]);
  b.sphere('quarry_head', 0.06, 10, 8, feather, [0, 0.16, 0.16]);
  b.cylinder('quarry_beak', 0.015, 0.005, 0.06, 8, beak, [0, 0.15, 0.24], AXIS_Z);
  b.box('quarry_wing_l', 0.02, 0.18, 0.1, feather, [-0.1, 0.05, 0], [0.5, 0, 0.3]);
  b.box('quarry_wing_r', 0.02, 0.18, 0.1, feather, [0.1, 0.05, 0], [-0.5, 0, 0.3]);
  b.box('quarry_tail', 0.1, 0.02, 0.12, feather, [0, 0.1, -0.18], [-0.3, 0, 0]);
}

function buildBubbleGumInto(b: MeshBuilder): void {
  const wrapper = flat(0xd94f83, 0.5);
  const wrapperEdge = flat(0xf2a6bf, 0.48);
  const label = flat(0xffe28a, 0.5);
  const gum = flat(0xf7b0c8, 0.7);

  // A broad paper sleeve around five parallel sticks. The exposed ends keep every
  // piece individually readable, while the solid top makes this a packet, not rails.
  b.box('bubble_gum_wrapper_bottom', 0.2, 0.012, 0.11, wrapper, [0, 0, 0]);
  b.box('bubble_gum_wrapper_top', 0.135, 0.012, 0.11, wrapper, [-0.0325, 0.046, 0]);
  b.box('bubble_gum_wrapper_seal', 0.018, 0.052, 0.11, wrapperEdge, [-0.091, 0.023, 0]);
  b.box('bubble_gum_wrapper_lip', 0.012, 0.052, 0.11, wrapperEdge, [0.041, 0.023, 0]);
  b.box('bubble_gum_label', 0.072, 0.004, 0.064, label, [-0.031, 0.054, 0]);
  for (let i = 0; i < 5; i++) {
    b.box(
      `bubble_gum_piece_${i}`,
      0.16,
      0.027,
      0.016,
      gum,
      [0.012, 0.024, -0.036 + i * 0.018],
    );
  }
}


function buildMedicineBottleInto(b: MeshBuilder): void {
  const amberGlass = glass(0x8a4319, 0.12);
  const cap = flat(0xe7dfc8, 0.92);
  const capWear = flat(0xc9bfa8, 1);
  const label = flat(0xf3f0e7, 0.96);
  const pill = flat(0xf2ead8, 0.8);

  // Two complete pills sit inside the transparent amber bottle. They are separate
  // three-piece capsules, not a texture or an inventory count, so the dose remains
  // literally readable through the glass from any close view.
  b.cylinder('medicine_pill_0_body', 0.011, 0.011, 0.034, 10, pill, [0, 0.027, -0.014], AXIS_X);
  b.sphere('medicine_pill_0_end_l', 0.011, 8, 6, pill, [-0.017, 0.027, -0.014]);
  b.sphere('medicine_pill_0_end_r', 0.011, 8, 6, pill, [0.017, 0.027, -0.014]);
  b.cylinder('medicine_pill_1_body', 0.011, 0.011, 0.034, 10, pill, [0.006, 0.049, 0.014], AXIS_Z);
  b.sphere('medicine_pill_1_end_l', 0.011, 8, 6, pill, [0.006, 0.049, -0.003]);
  b.sphere('medicine_pill_1_end_r', 0.011, 8, 6, pill, [0.006, 0.049, 0.031]);

  b.cylinder('medicine_bottle_body', 0.052, 0.055, 0.12, 18, amberGlass, [0, 0.06, 0]);
  b.cylinder('medicine_bottle_shoulder', 0.036, 0.052, 0.032, 18, amberGlass, [0, 0.136, 0]);
  b.cylinder('medicine_bottle_neck', 0.036, 0.036, 0.025, 18, amberGlass, [0, 0.1645, 0], ZERO, ONE, true);

  // A thin paper band follows the bottle wall instead of hovering as a flat card.
  // It stays deliberately unprinted: the two physical pills already communicate the dose.
  b.cylinder('medicine_label', 0.0557, 0.0557, 0.052, 24, label, [0, 0.078, 0], ZERO, ONE, true);

  // Alternating cream rings make the lid visibly worn rather than factory white.
  b.cylinder('medicine_cap', 0.043, 0.043, 0.039, 18, cap, [0, 0.19, 0]);
  b.cylinder('medicine_cap_wear_low', 0.0435, 0.0435, 0.004, 18, capWear, [0, 0.175, 0]);
  b.cylinder('medicine_cap_wear_high', 0.0435, 0.0435, 0.004, 18, capWear, [0, 0.197, 0]);
}


function buildBinocularsInto(b: MeshBuilder): void {
  const body = flat(0x252824, 0.75);
  const rim = cond(0x444942, 0.65, 0.3);
  const glass = flat(0x263d42, 0.35);
  for (const x of [-0.065, 0.065]) {
    b.cylinder('binocular_body', 0.047, 0.058, 0.18, 12, body, [x, 0, 0], AXIS_Z);
    b.cylinder('binocular_rim', 0.061, 0.061, 0.018, 12, rim, [x, 0, 0.095], AXIS_Z);
    b.cylinder('binocular_glass', 0.052, 0.052, 0.006, 12, glass, [x, 0, 0.106], AXIS_Z);
  }
  b.box('binocular_bridge', 0.09, 0.035, 0.08, body, [0, 0, 0]);
  b.cylinder('binocular_focus', 0.018, 0.018, 0.05, 10, rim, [0, 0.045, 0], AXIS_Z);
}

function buildTorchlightInto(b: MeshBuilder): void {
  const body = flat(0x343836, 0.7);
  const metal = cond(0x737a76, 0.55, 0.65);
  const lens = flat(0xfff1bd, 0.25);
  b.cylinder('torch_body', 0.035, 0.042, 0.23, 12, body, [0, 0, 0], AXIS_Z);
  b.cylinder('torch_head', 0.07, 0.045, 0.08, 12, metal, [0, 0, 0.155], AXIS_Z);
  b.cylinder('torch_lens', 0.058, 0.058, 0.008, 12, lens, [0, 0, 0.2], AXIS_Z);
  b.box('torch_switch', 0.025, 0.012, 0.045, metal, [0, 0.04, 0.015]);
}

function buildSunShadesInto(b: MeshBuilder, tint: ShadeTint): void {
  const frame = flat(0x28251f, 0.65);
  const lensColor = tint === 'green' ? 0x416a42 : tint === 'yellow' ? 0xb78e32 : 0x8b3934;
  const lens = flat(lensColor, 0.35);
  for (const x of [-0.052, 0.052]) {
    b.box('shade_lens', 0.092, 0.054, 0.008, lens, [x, 0, 0]);
  }
  b.box('shade_bridge', 0.022, 0.012, 0.014, frame, [0, 0.01, 0]);
  b.box('shade_top', 0.205, 0.012, 0.014, frame, [0, 0.034, 0]);
  b.box('shade_arm_l', 0.012, 0.014, 0.16, frame, [-0.105, 0.025, -0.075]);
  b.box('shade_arm_r', 0.012, 0.014, 0.16, frame, [0.105, 0.025, -0.075]);
}

function buildProfessionalCameraInto(b: MeshBuilder): void {
  const body = flat(0x202224, 0.78);
  const rubber = flat(0x121416, 0.92);
  const metal = cond(0x555b60, 0.65, 0.42);
  const glass = flat(0x263841, 0.25);

  // Full-size magnesium body, deep right-hand grip and a raised pentaprism make
  // this read as a professional SLR silhouette rather than a compact camera.
  b.box('camera_body', 0.25, 0.145, 0.09, body, [0, 0, 0]);
  // The grip is on the holder's RIGHT: with the lens at +Z and +Y up, that is the model's -X.
  b.box('camera_grip', 0.07, 0.17, 0.105, rubber, [-0.105, -0.012, 0.006]);
  b.box('camera_prism', 0.09, 0.055, 0.075, body, [-0.018, 0.092, 0]);
  b.box('camera_hotshoe', 0.045, 0.008, 0.04, metal, [-0.018, 0.124, -0.005]);
  b.cylinder('camera_mode_dial', 0.027, 0.027, 0.016, 12, metal, [0.085, 0.086, 0], ZERO);
  b.cylinder('camera_shutter', 0.012, 0.012, 0.01, 10, metal, [-0.094, 0.093, 0.02], ZERO);

  // Three stepped barrel sections and a broad front element: deliberately as
  // large as the body is tall, like an L-series zoom on a full-frame DSLR.
  b.cylinder('camera_lens_mount', 0.072, 0.072, 0.035, 16, metal, [-0.018, 0, 0.06], AXIS_Z);
  b.cylinder('camera_lens_barrel', 0.067, 0.062, 0.11, 16, rubber, [-0.018, 0, 0.13], AXIS_Z);
  b.cylinder('camera_focus_ring', 0.071, 0.071, 0.035, 16, body, [-0.018, 0, 0.18], AXIS_Z);
  b.cylinder('camera_lens_rim', 0.075, 0.075, 0.018, 16, metal, [-0.018, 0, 0.205], AXIS_Z);
  b.cylinder('camera_lens_glass', 0.064, 0.064, 0.006, 16, glass, [-0.018, 0, 0.218], AXIS_Z);
}

export const FOOTBALL_RADIUS = 0.11;
/** Half the width of a stitched seam between two panels, metres. */
const FOOTBALL_SEAM_HALF_WIDTH = 0.001;
/**
 * The seam in the leather's maps: lit as the leather is, so paler than the unlit line it
 * once was (0x514e48), and a groove in the relief.
 */
const FOOTBALL_SEAM_ALBEDO = '#7b7870';
const FOOTBALL_SEAM_RELIEF = '#5c5c5c';

let footballSurfaceMaterial: THREE.MeshStandardMaterial | null = null;
let footballPanelMaterial: THREE.MeshStandardMaterial | null = null;

const FOOTBALL_PHI = (1 + Math.sqrt(5)) / 2;
const FOOTBALL_ICOSAHEDRON_VERTICES = [
  [-1, FOOTBALL_PHI, 0], [1, FOOTBALL_PHI, 0],
  [-1, -FOOTBALL_PHI, 0], [1, -FOOTBALL_PHI, 0],
  [0, -1, FOOTBALL_PHI], [0, 1, FOOTBALL_PHI],
  [0, -1, -FOOTBALL_PHI], [0, 1, -FOOTBALL_PHI],
  [FOOTBALL_PHI, 0, -1], [FOOTBALL_PHI, 0, 1],
  [-FOOTBALL_PHI, 0, -1], [-FOOTBALL_PHI, 0, 1],
] as const;
const FOOTBALL_ICOSAHEDRON_FACES = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
] as const;

function footballVertex(index: number): THREE.Vector3 {
  const source = FOOTBALL_ICOSAHEDRON_VERTICES[index]!;
  return new THREE.Vector3(source[0], source[1], source[2]).normalize();
}

/** Vertex one third of the way along a directed icosahedron edge. */
function footballTruncatedVertex(from: number, to: number, radius: number): THREE.Vector3 {
  return footballVertex(from).multiplyScalar(2).add(footballVertex(to)).normalize().multiplyScalar(radius);
}

function footballNeighbours(vertex: number): number[] {
  const neighbours = new Set<number>();
  for (const face of FOOTBALL_ICOSAHEDRON_FACES) {
    const at = (face as readonly number[]).indexOf(vertex);
    if (at < 0) continue;
    neighbours.add(face[(at + 1) % 3]!);
    neighbours.add(face[(at + 2) % 3]!);
  }
  const normal = footballVertex(vertex);
  const reference = Math.abs(normal.y) < 0.9
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(1, 0, 0);
  const tangentX = reference.cross(normal).normalize();
  const tangentY = normal.clone().cross(tangentX);
  return [...neighbours].sort((a, b) => {
    const av = footballVertex(a);
    const bv = footballVertex(b);
    return Math.atan2(av.dot(tangentY), av.dot(tangentX))
      - Math.atan2(bv.dot(tangentY), bv.dot(tangentX));
  });
}

function footballPentagonGeometry(): THREE.BufferGeometry {
  const radius = FOOTBALL_RADIUS * 1.006;
  const positions: number[] = [];
  const normals: number[] = [];
  const pushPoint = (point: THREE.Vector3): void => {
    point.normalize();
    positions.push(point.x * radius, point.y * radius, point.z * radius);
    normals.push(point.x, point.y, point.z);
  };
  const pushCurvedTriangle = (
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    depth: number,
  ): void => {
    if (depth === 0) {
      pushPoint(a);
      pushPoint(b);
      pushPoint(c);
      return;
    }
    const ab = a.clone().add(b).normalize();
    const bc = b.clone().add(c).normalize();
    const ca = c.clone().add(a).normalize();
    pushCurvedTriangle(a, ab, ca, depth - 1);
    pushCurvedTriangle(ab, b, bc, depth - 1);
    pushCurvedTriangle(ca, bc, c, depth - 1);
    pushCurvedTriangle(ab, bc, ca, depth - 1);
  };

  for (let vertex = 0; vertex < FOOTBALL_ICOSAHEDRON_VERTICES.length; vertex++) {
    const centre = footballVertex(vertex);
    const neighbours = footballNeighbours(vertex);
    for (let side = 0; side < neighbours.length; side++) {
      const a = footballTruncatedVertex(vertex, neighbours[side]!, 1);
      const b = footballTruncatedVertex(vertex, neighbours[(side + 1) % neighbours.length]!, 1);
      // A flat triangle lies inside the round white shell except at its vertices,
      // leaving only black specks visible. Projecting a subdivided fan back onto
      // the sphere makes the complete pentagonal leather panel cover the shell.
      pushCurvedTriangle(centre, a, b, 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
}

/**
 * Every seam between two panels as the arc's two ends on the unit sphere: each edge of the
 * truncated icosahedron, split at its middle as the panels' own outlines are.
 */
function footballSeams(): readonly (readonly [THREE.Vector3, THREE.Vector3])[] {
  const edges = new Map<string, readonly [number, number, number, number]>();
  const addPolygon = (nodes: readonly (readonly [number, number])[]): void => {
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i]!;
      const b = nodes[(i + 1) % nodes.length]!;
      const aKey = `${a[0]}:${a[1]}`;
      const bKey = `${b[0]}:${b[1]}`;
      const key = aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
      if (!edges.has(key)) edges.set(key, [a[0], a[1], b[0], b[1]]);
    }
  };

  for (let vertex = 0; vertex < FOOTBALL_ICOSAHEDRON_VERTICES.length; vertex++) {
    addPolygon(footballNeighbours(vertex).map((neighbour) => [vertex, neighbour] as const));
  }
  for (const [a, b, c] of FOOTBALL_ICOSAHEDRON_FACES) {
    addPolygon([[a, b], [b, a], [b, c], [c, b], [c, a], [a, c]]);
  }

  const seams: (readonly [THREE.Vector3, THREE.Vector3])[] = [];
  for (const [a0, a1, b0, b1] of edges.values()) {
    seams.push([footballTruncatedVertex(a0, a1, 1), footballTruncatedVertex(b0, b1, 1)]);
  }
  return seams;
}

/**
 * Paints the seams into the leather's maps, as the body's sphere unwraps them
 * (`SphereGeometry`: u round from -X, v down from +Y): a groove a few millimetres wide in
 * the texture, so it keeps its size at any distance and mips away cleanly. (It was a set
 * of lines over the ball: a pixel wide however far off, and a program of their own.)
 */
function paintFootballSeams(albedo: CanvasRenderingContext2D, relief: CanvasRenderingContext2D, width: number, height: number): void {
  const across = (FOOTBALL_SEAM_HALF_WIDTH * 2) / FOOTBALL_RADIUS;
  const ry = Math.max(0.6, (across / Math.PI) * height * 0.5);
  const point = new THREE.Vector3();
  const dot = (x: number, y: number, rx: number): void => {
    for (const [g, colour] of [[albedo, FOOTBALL_SEAM_ALBEDO], [relief, FOOTBALL_SEAM_RELIEF]] as const) {
      g.fillStyle = colour;
      for (const shift of [-width, 0, width]) {
        g.beginPath();
        g.ellipse(x + shift, y, rx, ry, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
  };
  for (const [from, to] of footballSeams()) {
    const angle = from.angleTo(to);
    // A dot every half texel along the arc.
    const steps = Math.ceil((angle / Math.PI) * height * 2);
    for (let i = 0; i <= steps; i++) {
      point.copy(from).lerp(to, i / steps).normalize();
      const theta = Math.acos(THREE.MathUtils.clamp(point.y, -1, 1));
      let u = Math.atan2(point.z, -point.x) / (Math.PI * 2);
      if (u < 0) u += 1;
      const sin = Math.max(Math.sin(theta), 0.02);
      dot(u * width, (theta / Math.PI) * height, Math.min(width / 4, ry / sin));
    }
  }
}

function footballMaterial(): THREE.MeshStandardMaterial {
  if (footballSurfaceMaterial) return footballSurfaceMaterial;

  // Fine enough for the seams to be a groove, not a smear: 1024 round the ball, 512
  // pole to pole, so a texel is square on the equator.
  const width = 1024;
  const height = 512;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const reliefCanvas = document.createElement('canvas');
  reliefCanvas.width = width;
  reliefCanvas.height = height;
  const albedo = canvas.getContext('2d');
  const relief = reliefCanvas.getContext('2d');
  if (!albedo || !relief) throw new Error('Canvas 2D is required for the football surface');
  albedo.fillStyle = '#ded9cc';
  albedo.fillRect(0, 0, width, height);
  relief.fillStyle = '#858585';
  relief.fillRect(0, 0, width, height);

  // Fixed-seed pores and faint wear make the white panels read as pebbled leather. Laid
  // on a 256 grid, each pore the size it was on the 256-square map this replaced.
  const poreW = width / 256;
  const poreH = height / 256;
  let seed = 0x4f1bbcdc;
  for (let i = 0; i < 2600; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const x = seed & 255;
    const y = (seed >>> 8) & 255;
    const light = (seed >>> 17) & 1;
    albedo.fillStyle = light ? 'rgba(255,255,255,0.05)' : 'rgba(55,48,39,0.045)';
    albedo.fillRect(x * poreW, y * poreH, poreW, poreH);
    relief.fillStyle = light ? '#969696' : '#747474';
    relief.fillRect(x * poreW, y * poreH, poreW, poreH);
  }
  paintFootballSeams(albedo, relief, width, height);

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = maxAnisotropy();
  const bumpMap = new THREE.CanvasTexture(reliefCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.anisotropy = maxAnisotropy();
  footballSurfaceMaterial = applyComicShading(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map,
      bumpMap,
      bumpScale: 0.0011,
      roughness: 0.86,
      metalness: 0,
    }),
    { contourStrength: 0, stippleStrength: 0 },
  );
  return footballSurfaceMaterial;
}

function createFootballMesh(): THREE.Group {
  const root = new THREE.Group();
  const body = new THREE.Mesh(
    cachedGeo('football_body_detailed', () => new THREE.SphereGeometry(FOOTBALL_RADIUS, 32, 20)),
    footballMaterial(),
  );
  body.name = 'football_body';
  root.add(body);

  footballPanelMaterial ??= applyComicShading(
    new THREE.MeshStandardMaterial({ color: 0x20201f, roughness: 0.84, metalness: 0 }),
    { contourStrength: 0, stippleStrength: 0 },
  );
  const panels = new THREE.Mesh(
    cachedGeo('football_pentagons', footballPentagonGeometry),
    footballPanelMaterial,
  );
  panels.name = 'football_black_panels';
  root.add(panels);

  return root;
}

function buildPocketWatchBodyInto(b: MeshBuilder): void {
  const caseMetal = cond(0xb08b45, 0.82, 0.34);
  const face = flat(0xd8d2c4, 0.48);
  const ink = flat(0x29251e, 0.72);
  b.cylinder('pocket_watch_case', 0.068, 0.068, 0.018, 20, caseMetal, [0, 0, 0], AXIS_Z);
  b.cylinder('pocket_watch_face', 0.059, 0.059, 0.004, 20, face, [0, 0, 0.012], AXIS_Z);
  for (let hour = 0; hour < 12; hour++) {
    const angle = hour * Math.PI / 6;
    const radius = hour % 3 === 0 ? 0.047 : 0.05;
    const length = hour % 3 === 0 ? 0.014 : 0.009;
    b.box(
      `pocket_watch_tick_${hour}`,
      0.0035,
      length,
      0.0025,
      ink,
      [Math.sin(angle) * radius, Math.cos(angle) * radius, 0.015],
      [0, 0, -angle],
    );
  }
  b.cylinder('pocket_watch_crown', 0.011, 0.011, 0.016, 10, caseMetal, [0, 0.077, 0], AXIS_X);
  b.torus('pocket_watch_loop', 0.018, 0.005, 8, 14, caseMetal, [0, 0.096, 0]);
}

function createPocketWatchMesh(): THREE.Group {
  const root = buildGroup(itemBlueprint('pocket_watch_body', buildPocketWatchBodyInto).instructions);
  // Radium-style lume: dark green by day, self-lit after the sky light has fallen.
  // This material belongs to one watch because emissive state is not part of the
  // shared flat-material cache; the ordinary item-resource disposer releases it.
  const lumeMaterial = makeFlatMaterial(0x173b2a, 0.7).clone();
  lumeMaterial.emissive.setHex(0x68ff87);
  lumeMaterial.emissiveIntensity = 0.04;
  lumeMaterial.userData.itemOwnedResource = true;
  root.userData.pocketWatchLumeMaterial = lumeMaterial;
  for (let hour = 0; hour < 12; hour++) {
    const angle = hour * Math.PI / 6;
    const major = hour % 3 === 0;
    const radius = major ? 0.047 : 0.05;
    const strip = new THREE.Mesh(
      cachedGeo(
        major ? 'pocket_watch_lume_tick_major' : 'pocket_watch_lume_tick_minor',
        () => new THREE.BoxGeometry(0.0018, major ? 0.008 : 0.005, 0.0014),
      ),
      lumeMaterial,
    );
    strip.name = `pocket_watch_lume_tick_${hour}`;
    strip.position.set(Math.sin(angle) * radius, Math.cos(angle) * radius, 0.0168);
    strip.rotation.z = -angle;
    strip.castShadow = false;
    strip.receiveShadow = false;
    root.add(strip);
  }

  const ink = flat(0x29251e, 0.72);
  const needle = buildGroup(
    itemBlueprint('pocket_watch_needle', (b) => {
      b.box('pocket_watch_hand', 0.004, 0.046, 0.003, ink, [0, 0.023, 0.018]);
      b.cylinder('pocket_watch_pin', 0.006, 0.006, 0.004, 10, ink, [0, 0, 0.019], AXIS_Z);
    }).instructions,
  );
  needle.name = 'pocket_watch_needle';
  const handLume = new THREE.Mesh(
    cachedGeo('pocket_watch_hand_lume', () => new THREE.BoxGeometry(0.0018, 0.032, 0.0014)),
    lumeMaterial,
  );
  handLume.name = 'pocket_watch_hand_lume';
  handLume.position.set(0, 0.024, 0.0202);
  handLume.castShadow = false;
  handLume.receiveShadow = false;
  needle.add(handLume);
  root.add(needle);

  const coverMetal = cond(0xa78340, 0.82, 0.38);
  const cover = buildGroup(
    itemBlueprint('pocket_watch_cover', (b) => {
      b.cylinder('pocket_watch_lid_disc', 0.069, 0.069, 0.012, 20, coverMetal, [0, -0.068, 0], AXIS_Z);
      b.torus('pocket_watch_lid_ring', 0.053, 0.003, 8, 18, coverMetal, [0, -0.068, 0.007]);
    }).instructions,
  );
  cover.name = 'pocket_watch_cover';
  cover.position.set(0, 0.068, 0.024);
  root.add(cover);
  setPocketWatchState(root, 0);
  return root;
}

/** Keeps the lid open and updates the dial and ambient-light-driven lume. */
export function setPocketWatchState(
  root: THREE.Object3D,
  timeOfDay: number,
  dayFactor = 1,
): void {
  const cover = root.getObjectByName('pocket_watch_cover');
  if (cover) cover.rotation.x = -Math.PI * 0.76;
  const needle = root.getObjectByName('pocket_watch_needle');
  if (needle) {
    needle.visible = true;
    const halfDay = 12 * 60;
    const fraction = (((timeOfDay % halfDay) + halfDay) % halfDay) / halfDay;
    needle.rotation.z = -fraction * Math.PI * 2;
  }
  const lume = root.userData.pocketWatchLumeMaterial as THREE.MeshStandardMaterial | undefined;
  if (lume) {
    const darkness = 1 - Math.min(1, Math.max(0, dayFactor));
    lume.emissiveIntensity = 0.04 + darkness * 1.25;
  }
}

function createPhotographMesh(imageDataUrl: string): THREE.Group {
  const root = buildGroup(
    itemBlueprint('photograph', (b) => {
      const paper = flat(0xe9e0cb, 0.86);
      // Keep the overall width, but bring the paper closer to the 16:9 print
      // so the border can stay narrow and identical on all four sides.
      b.box('photograph_paper', 0.19, 0.1095, 0.006, paper, [0, 0, 0]);
    }).instructions,
  );
  const texture = new THREE.TextureLoader().load(imageDataUrl);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    side: THREE.DoubleSide,
    roughness: 0.9,
    metalness: 0,
  });
  material.userData.itemOwnedResource = true;
  const image = new THREE.Mesh(
    cachedGeo('photograph_image', () => new THREE.PlaneGeometry(0.184, 0.1035)),
    material,
  );
  image.name = 'photograph_image';
  image.position.set(0, 0, 0.004);
  root.add(image);
  return root;
}

function buildStickerEnvelopeInto(b: MeshBuilder): void {
  const paper = flat(0xd8c8ad, 0.9);
  const fold = flat(0xb9a78c, 0.92);
  const seal = flat(0x8e2231, 0.72);
  b.box('sticker_envelope', 0.23, 0.15, 0.012, paper, [0, 0, 0]);
  b.box('sticker_envelope_fold', 0.18, 0.008, 0.014, fold, [0, 0.015, 0.002], [0, 0, -0.34]);
  b.cylinder('sticker_envelope_seal', 0.027, 0.027, 0.008, 14, seal, [0, -0.005, 0.011], AXIS_Z);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** A fresh Object3D for a part variant, sharing cached geometry, origin at the mount point. */
export function createPartMesh(variantId: string): THREE.Object3D {
  return buildGroup(blueprint(variantId).instructions);
}

/** Collider half-extents for a part, derived from its built geometry's bounds. */
export function partHalfExtents(variantId: string): { x: number; y: number; z: number } {
  return blueprint(variantId).halfExtents;
}

/** Sets how many individually modelled sticks remain visible in a bubble-gum pack. */
export function setBubbleGumPieceCount(root: THREE.Object3D, charges: number): void {
  const visible = Math.max(0, Math.min(5, Math.trunc(charges)));
  root.traverse((object) => {
    if (!object.name.startsWith('bubble_gum_piece_')) return;
    const index = Number(object.name.slice('bubble_gum_piece_'.length));
    object.visible = Number.isInteger(index) && index < visible;
  });
}

interface MedicinePartHome {
  readonly position: THREE.Vector3;
  readonly rotation: THREE.Euler;
  readonly scale: THREE.Vector3;
}

/**
 * Animates the bottle's loose pieces in model space. The hand moves the bottle as
 * a whole; this moves the uncorked lid and both physical pills independently.
 */
export function setMedicineUseProgress(root: THREE.Object3D, rawProgress: number): void {
  const progress = Math.max(0, Math.min(1, rawProgress));
  root.traverse((object) => {
    const isCap = object.name.startsWith('medicine_cap');
    const isPill = object.name.startsWith('medicine_pill_');
    if (!isCap && !isPill) return;

    let home = object.userData.medicinePartHome as MedicinePartHome | undefined;
    if (!home) {
      home = {
        position: object.position.clone(),
        rotation: object.rotation.clone(),
        scale: object.scale.clone(),
      };
      object.userData.medicinePartHome = home;
    }
    object.position.copy(home.position);
    object.rotation.copy(home.rotation);
    object.scale.copy(home.scale);
    object.visible = true;

    if (isCap) {
      // The cap clears the neck during the first quarter of the action. At the
      // endpoint the matching world rigid body takes over the same flight.
      const flight = Math.min(1, progress / 0.23);
      object.position.x += flight * 0.16;
      object.position.y += flight * 0.08 + Math.sin(flight * Math.PI) * 0.08;
      object.position.z += flight * 0.035;
      object.rotation.x += flight * 8;
      object.rotation.z += flight * 4;
      object.visible = progress < 0.23;
      return;
    }

    // Once the tipped bottle reaches the mouth, both complete capsules leave
    // through the neck and separate slightly before disappearing behind camera.
    const flight = Math.max(0, Math.min(1, (progress - 0.5) / 0.18));
    const side = object.name.includes('_0_') ? -1 : 1;
    object.position.x += side * flight * 0.045;
    object.position.y += flight * 0.2;
    object.position.z += flight * 0.04;
    object.scale.multiplyScalar(1 + flight * 0.35);
    object.visible = progress < 0.7;
  });
}

export type MedicineRemnantKind = 'bottle' | 'cap';

/** Centred, empty medicine-bottle pieces for dynamic debris after the dose. */
export function createMedicineRemnantMesh(kind: MedicineRemnantKind): THREE.Object3D {
  const instructions = itemBlueprint('medicine_bottle', buildMedicineBottleInto).instructions.filter((ins) =>
    kind === 'cap'
      ? ins.name.startsWith('medicine_cap')
      : ins.name.startsWith('medicine_bottle_') || ins.name === 'medicine_label',
  );
  const model = buildGroup(instructions);
  const bounds = new THREE.Box3().setFromObject(model);
  const centre = bounds.getCenter(new THREE.Vector3());
  model.position.sub(centre);

  const root = new THREE.Group();
  root.name = kind === 'cap' ? 'spent_medicine_cap' : 'spent_medicine_bottle';
  root.add(model);
  return root;
}

/**
 * Hidden meshes in every material shape a world item is drawn with, for the scene at
 * boot: `waitForFrameShaders` links their programs behind the loading cover, and the
 * anchor keeps them linked. Items lie in the world only where a POI, a story site or a
 * wreck put them, so the first one in view used to link its programs on the spot —
 * measured at seed 1337 km 44, the medicine bottle on a home's step linked both faces
 * of its amber glass (transparent and double-sided, drawn back face then front: two
 * programs) mid-drive, and a spray tin the condition program on a boot that held no
 * part. The shapes: flat and glass (the bottle itself, its meshes as a loose item has
 * them, no shadows), condition (parts, cans, tins: one program for every condition
 * material), and the football's mapped and bumped leather (its seams are painted in).
 * Every other world item is built from these. Photographs are left out: only the player
 * puts them on the ground.
 */
export function itemProgramAnchor(): THREE.Object3D {
  const group = new THREE.Group();
  group.name = 'item-anchor';
  group.visible = false;
  const condition = new MeshBuilder();
  condition.box('item_anchor_condition', 0.01, 0.01, 0.01, cond(0xffffff), ZERO);
  group.add(
    buildGroup(itemBlueprint('medicine_bottle', buildMedicineBottleInto).instructions),
    buildGroup(condition.instructions),
    createFootballMesh(),
  );
  return group;
}

/** A held/carried item mesh. Parts reuse createPartMesh; other items build from primitives. */
export function createItemMesh(item: Item): THREE.Object3D {
  switch (item.type) {
    case 'part':
      return createPartMesh(item.part.variantId);
    case 'tool': {
      const spent = spongeSpent(item);
      return buildGroup(
        itemBlueprint(`tool_${item.tool}${spent ? '_spent' : ''}`, (b) => buildToolInto(b, item.tool, spent)).instructions,
      );
    }
    case 'fluid_can': {
      // One jerrycan shape at every size: a 20 L can is drawn at 0.85 of the shape (it
      // stood too big against a vending machine's tray), smaller cans by the cube root
      // of their volume, so a 5 L bottle stands two thirds of a 20 L can's height.
      const can = buildGroup(
        itemBlueprint('fluid_can', buildFluidCanInto).instructions,
      );
      can.scale.setScalar(0.85 * Math.cbrt(Math.min(1, Math.max(0.1, item.capacity / 20))));
      return can;
    }
    case 'spray_can':
      return buildGroup(
        itemBlueprint(`spray_${item.paint.toString(16)}`, (b) => buildSprayCanInto(b, item.paint)).instructions,
      );
    case 'weapon':
      return buildGroup(itemBlueprint(`weapon_${item.weapon}`, (b) => buildWeaponInto(b, item.weapon)).instructions);
    case 'ammo':
      return buildGroup(itemBlueprint('ammo', (b) => buildAmmoInto(b)).instructions);
    case 'quarry': {
      const mesh = buildGroup(itemBlueprint('quarry', (b) => buildQuarryInto(b)).instructions);
      const s = Math.max(0.7, Math.min(1.6, Math.cbrt((item as QuarryItem).mass)));
      mesh.scale.setScalar(s);
      return mesh;
    }
    case 'bubble_gum': {
      const mesh = buildGroup(itemBlueprint('bubble_gum', (b) => buildBubbleGumInto(b)).instructions);
      setBubbleGumPieceCount(mesh, item.charges);
      return mesh;
    }
    case 'medicine':
      return buildGroup(itemBlueprint('medicine_bottle', buildMedicineBottleInto).instructions);
    case 'binoculars':
      return buildGroup(itemBlueprint('binoculars', buildBinocularsInto).instructions);
    case 'torchlight':
      return buildGroup(itemBlueprint('torchlight', buildTorchlightInto).instructions);
    case 'sun_shades':
      return buildGroup(
        itemBlueprint(`sun_shades_${item.tint}`, (b) => buildSunShadesInto(b, item.tint)).instructions,
      );
    case 'camera':
      return buildGroup(itemBlueprint('professional_camera', buildProfessionalCameraInto).instructions);
    case 'photograph':
      return createPhotographMesh(item.imageDataUrl);
    case 'football':
      return createFootballMesh();
    case 'pocket_watch':
      return createPocketWatchMesh();
    case 'contract_cargo': {
      // Every thing is drawn with its own model, whole or broken (render/thingmesh.ts);
      // a haul is never an item.
      const thing = contractThing(item);
      const broken = isBrokenThing(item);
      return buildGroup(itemBlueprint(thingModelKey(thing, broken), (b) => buildThingInto(b, thing, broken)).instructions);
    }
    case 'sticker_envelope':
      return buildGroup(itemBlueprint('sticker_envelope', buildStickerEnvelopeInto).instructions);
  }
}

/** Releases per-instance item materials and textures; cached primitive resources stay shared. */
export function disposeItemMeshResources(root: THREE.Object3D): void {
  const disposedMaterials = new Set<THREE.Material>();
  const disposedTextures = new Set<THREE.Texture>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (
        material.userData.itemOwnedResource !== true ||
        disposedMaterials.has(material)
      ) {
        continue;
      }
      disposedMaterials.add(material);
      const mapped = material as THREE.Material & { map?: THREE.Texture | null };
      const texture = mapped.map;
      if (texture && !disposedTextures.has(texture)) {
        disposedTextures.add(texture);
        texture.dispose();
      }
      material.dispose();
    }
  });
}

/** Releases every cached BufferGeometry. Call on teardown. */
export function disposeMeshCache(): void {
  clearGeometryCache();
  blueprintCache.clear();
  itemBlueprintCache.clear();
}
