/**
 * Procedural meshes for every part and carried item in the game.
 *
 * Everything is built from primitives; the football adds one generated leather texture
 * and the postcard two painted faces. Geometry and immutable materials are cached, while
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
  FluidKind,
  Item,
  QuarryItem,
  ShadeTint,
  ToolKind,
  WeaponKind,
} from '../items/items';
import { spongeSpent } from '../items/items';
import { makeConditionMaterial, makeFlatMaterial } from './materials';
import { applyComicShading } from './comic';
import { drawPalmCard } from './mirage-tableau';
import { locale, t } from '../i18n/i18n';

// ---------------------------------------------------------------------------
// Geometry cache
// ---------------------------------------------------------------------------

const geometryCache = new Map<string, THREE.BufferGeometry>();

function cachedGeo(key: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let geometry = geometryCache.get(key);
  if (geometry === undefined) {
    geometry = build();
    geometryCache.set(key, geometry);
  }
  return geometry;
}

// ---------------------------------------------------------------------------
// Material specs (resolved lazily per instance)
// ---------------------------------------------------------------------------

type MaterialSpec =
  | { kind: 'cond'; color: number; metalness: number; roughness: number }
  | { kind: 'flat'; color: number; roughness: number }
  | { kind: 'glass'; color: number; roughness: number };

const cond = (color: number, metalness = 0.85, roughness = 0.4): MaterialSpec => ({
  kind: 'cond', color, metalness, roughness,
});
const flat = (color: number, roughness = 0.6): MaterialSpec => ({ kind: 'flat', color, roughness });
const glass = (color: number, roughness = 0.06): MaterialSpec => ({ kind: 'glass', color, roughness });

function resolveMaterial(spec: MaterialSpec): THREE.Material {
  switch (spec.kind) {
    case 'cond':
      return makeConditionMaterial(spec.color, spec.metalness, spec.roughness);
    case 'flat':
      return makeFlatMaterial(spec.color, spec.roughness);
    case 'glass': {
      // High transmission, low opacity: the tint must read as clean glass, never
      // a dark slab. DoubleSide means both faces of a thin box contribute, so the
      // per-face opacity is kept low to leave the road clearly visible.
      const material = makeFlatMaterial(spec.color, spec.roughness);
      material.transparent = true;
      material.opacity = 0.12;
      material.side = THREE.DoubleSide;
      material.depthWrite = false;
      return material;
    }
  }
}

// ---------------------------------------------------------------------------
// Instructions: geometry + material + transform, replayed per instance
// ---------------------------------------------------------------------------

type Vec3 = readonly [number, number, number];

interface Instruction {
  readonly name: string;
  readonly geometry: THREE.BufferGeometry;
  readonly material: MaterialSpec;
  readonly position: Vec3;
  readonly rotation: Vec3;
  readonly scale: Vec3;
}

const ZERO: Vec3 = [0, 0, 0];
const ONE: Vec3 = [1, 1, 1];
// Cylinders are built along +Y; these Euler angles re-point that axis.
const AXIS_X: Vec3 = [0, 0, -Math.PI / 2]; // +Y -> +X
const AXIS_Z: Vec3 = [Math.PI / 2, 0, 0]; // +Y -> +Z

class MeshBuilder {
  readonly instructions: Instruction[] = [];

  push(
    key: string,
    build: () => THREE.BufferGeometry,
    material: MaterialSpec,
    position: Vec3,
    rotation: Vec3 = ZERO,
    scale: Vec3 = ONE,
  ): void {
    this.instructions.push({ name: key, geometry: cachedGeo(key, build), material, position, rotation, scale });
  }

  box(key: string, w: number, h: number, d: number, material: MaterialSpec, position: Vec3, rotation: Vec3 = ZERO, scale: Vec3 = ONE): void {
    this.push(key, () => new THREE.BoxGeometry(w, h, d), material, position, rotation, scale);
  }

  cylinder(
    key: string,
    radiusTop: number,
    radiusBottom: number,
    height: number,
    radialSegments: number,
    material: MaterialSpec,
    position: Vec3,
    rotation: Vec3 = ZERO,
    scale: Vec3 = ONE,
    openEnded = false,
  ): void {
    this.push(
      key,
      () => new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments, 1, openEnded),
      material,
      position,
      rotation,
      scale,
    );
  }

  torus(key: string, radius: number, tube: number, radialSegments: number, tubularSegments: number, material: MaterialSpec, position: Vec3, rotation: Vec3 = ZERO, scale: Vec3 = ONE, arc = Math.PI * 2): void {
    this.push(key, () => new THREE.TorusGeometry(radius, tube, radialSegments, tubularSegments, arc), material, position, rotation, scale);
  }

  sphere(key: string, radius: number, widthSegments: number, heightSegments: number, material: MaterialSpec, position: Vec3, scale: Vec3 = ONE): void {
    this.push(key, () => new THREE.SphereGeometry(radius, widthSegments, heightSegments), material, position, ZERO, scale);
  }
}

function buildGroup(instructions: readonly Instruction[]): THREE.Group {
  const group = new THREE.Group();
  for (const ins of instructions) {
    const mesh = new THREE.Mesh(ins.geometry, resolveMaterial(ins.material));
    mesh.name = ins.name;
    mesh.position.set(ins.position[0], ins.position[1], ins.position[2]);
    mesh.rotation.set(ins.rotation[0], ins.rotation[1], ins.rotation[2]);
    mesh.scale.set(ins.scale[0], ins.scale[1], ins.scale[2]);
    if (ins.material.kind === 'glass') {
      // Glass must never be shadowed into a black slab.
      mesh.castShadow = false;
      mesh.receiveShadow = false;
    }
    group.add(mesh);
  }
  return group;
}

/** Bounding-box half-extents of a set of instructions, honouring their transforms. */
function halfExtentsOf(instructions: readonly Instruction[]): { x: number; y: number; z: number } {
  const total = new THREE.Box3();
  const tmp = new THREE.Box3();
  const euler = new THREE.Euler();
  const quat = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const matrix = new THREE.Matrix4();

  for (const ins of instructions) {
    if (ins.geometry.boundingBox === null) ins.geometry.computeBoundingBox();
    tmp.copy(ins.geometry.boundingBox as THREE.Box3);
    pos.set(ins.position[0], ins.position[1], ins.position[2]);
    euler.set(ins.rotation[0], ins.rotation[1], ins.rotation[2]);
    quat.setFromEuler(euler);
    scl.set(ins.scale[0], ins.scale[1], ins.scale[2]);
    matrix.compose(pos, quat, scl);
    tmp.applyMatrix4(matrix);
    total.union(tmp);
  }

  const size = new THREE.Vector3();
  total.getSize(size);
  return { x: size.x / 2, y: size.y / 2, z: size.z / 2 };
}

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
    case 'fuel_tank': return buildTank(b, v);
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
    case 'engine_samara_1500': return buildInline(b, spec, 0.96);
    // Half a 2108: the 1.3's 76 mm bore and block section, two cylinders long.
    case 'engine_vaz_1111': return buildInline(b, spec, 0.91);
    case 'engine_lada_1600':
    case 'engine_lada_rally':
    case 'engine_niva_1600': return buildInline(b, spec, 1.0);
    case 'engine_niva_1700': return buildInline(b, spec, 1.02);
    // The Volga 2.4: a tall, long-stroke four, so a taller block than the 1.6.
    case 'engine_zmz_21':
    case 'engine_zmz_24': return buildInline(b, spec, 1.09);
    // The proving ground's engines. Flat (boxer) units stand in as vees until they
    // have a blueprint of their own; the scale is displacement against the 1.6.
    case 'engine_citroen_a06': return buildInline(b, spec, 0.72);
    case 'engine_bmc_1275s': return buildInline(b, spec, 0.9);
    case 'engine_rover_k18': return buildInline(b, spec, 1.0);
    case 'engine_lancia_integrale_16v': return buildInline(b, spec, 1.06);
    case 'engine_rover_200tdi': return buildInline(b, spec, 1.18);
    case 'engine_vw_type1_1600': return buildVee(b, spec, 0.9);
    case 'engine_porsche_930_10': return buildVee(b, spec, 1.04);
    case 'engine_ford_50_ho': return buildVee(b, spec, 1.1);
    case 'engine_ferrari_f113a': return buildVee(b, spec, 1.2);
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
    case 'gearbox_gaz_4': scale = 1.1; manual = true; fins = false; break;
    case 'gearbox_samara_5':
    case 'gearbox_samara_5_tall': scale = 1.08; manual = true; fins = true; break;
    // The Oka's transaxle: the Samara layout at a smaller scale, final drive included.
    case 'gearbox_oka_4': scale = 0.86; manual = true; fins = true; break;
    case 'gearbox_niva_4': scale = 1.2; manual = true; fins = false; break;
    case 'gearbox_niva_5': scale = 1.26; manual = true; fins = false; break;
    case 'gearbox_auto3': scale = 1.2; manual = false; fins = true; break;
    case 'gearbox_truck6': scale = 1.5; manual = true; fins = true; break;
    // The proving ground's boxes; transaxles carry their final drive, so they get fins.
    case 'gearbox_citroen_4': scale = 0.8; manual = true; fins = true; break;
    case 'gearbox_mini_cr4': scale = 0.82; manual = true; fins = true; break;
    case 'gearbox_vw_t2_4': scale = 0.95; manual = true; fins = true; break;
    case 'gearbox_rover_pg1': scale = 1.0; manual = true; fins = true; break;
    case 'gearbox_porsche_915': scale = 1.1; manual = true; fins = true; break;
    case 'gearbox_ferrari_tr5': scale = 1.2; manual = true; fins = true; break;
    case 'gearbox_bw_t5': scale = 1.05; manual = true; fins = false; break;
    case 'gearbox_lancia_integrale': scale = 1.15; manual = true; fins = true; break;
    case 'gearbox_landrover_lt77': scale = 1.3; manual = true; fins = false; break;
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



// ----------------------------- fuel tanks -----------------------------

function buildTank(b: MeshBuilder, v: PartVariant): void {
  const steel = cond(0x6f747a, 0.85, 0.45);
  const cap = flat(0xb03a2e, 0.5);
  const id = v.id;
  let w: number, h: number, d: number;
  switch (v.id) {
    case 'tank_40': w = 0.5; h = 0.24; d = 0.62; break;
    case 'tank_lada_39': w = 0.62; h = 0.2; d = 0.5; break;
    case 'tank_65': w = 0.6; h = 0.28; d = 0.78; break;
    case 'tank_140': w = 1.05; h = 0.4; d = 0.55; break;
    default: throw new Error(`unhandled tank variant: ${v.id}`);
  }

  b.box(`${id}_body`, w, h, d, steel, [0, 0, 0]);
  b.cylinder(`${id}_neck`, 0.04, 0.04, 0.08, 10, steel, [w * 0.3, h * 0.5, 0]);
  b.cylinder(`${id}_cap`, 0.045, 0.045, 0.03, 12, cap, [w * 0.3, h * 0.5 + 0.04, 0]);
  b.box(`${id}_strap1`, w * 1.02, 0.03, 0.03, steel, [0, 0, d * 0.25]);
  b.box(`${id}_strap2`, w * 1.02, 0.03, 0.03, steel, [0, 0, -d * 0.25]);
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
 * Colour-codes the can by fluid, the way a workshop shelf does: red petrol, and the
 * two engine fluids in the colours those bottles actually come in — blue water, dark
 * blue-black oil. It is the only way to tell three identical cans apart at a glance
 * in the inventory strip.
 */
function buildFluidCanInto(b: MeshBuilder, fluid: FluidKind): void {
  const color =
    fluid === 'petrol' ? 0xb03a2e
    : fluid === 'water' ? 0x2f6fa8
    : 0x2b2f3a;
  const metal = cond(color, 0.7, 0.4);
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

let footballSurfaceMaterial: THREE.MeshStandardMaterial | null = null;
let footballPanelMaterial: THREE.MeshStandardMaterial | null = null;
let footballSeamMaterial: THREE.LineBasicMaterial | null = null;

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

function footballSeamGeometry(): THREE.BufferGeometry {
  const radius = FOOTBALL_RADIUS * 1.011;
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

  const positions: number[] = [];
  for (const [a0, a1, b0, b1] of edges.values()) {
    const a = footballTruncatedVertex(a0, a1, radius);
    const b = footballTruncatedVertex(b0, b1, radius);
    const middle = a.clone().add(b).normalize().multiplyScalar(radius);
    positions.push(
      a.x, a.y, a.z, middle.x, middle.y, middle.z,
      middle.x, middle.y, middle.z, b.x, b.y, b.z,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

function footballMaterial(): THREE.MeshStandardMaterial {
  if (footballSurfaceMaterial) return footballSurfaceMaterial;

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const reliefCanvas = document.createElement('canvas');
  reliefCanvas.width = size;
  reliefCanvas.height = size;
  const albedo = canvas.getContext('2d');
  const relief = reliefCanvas.getContext('2d');
  if (!albedo || !relief) throw new Error('Canvas 2D is required for the football surface');
  albedo.fillStyle = '#ded9cc';
  albedo.fillRect(0, 0, size, size);
  relief.fillStyle = '#858585';
  relief.fillRect(0, 0, size, size);

  // Fixed-seed pores and faint wear make the white panels read as pebbled leather.
  let seed = 0x4f1bbcdc;
  for (let i = 0; i < 2600; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const x = seed & 255;
    const y = (seed >>> 8) & 255;
    const light = (seed >>> 17) & 1;
    albedo.fillStyle = light ? 'rgba(255,255,255,0.05)' : 'rgba(55,48,39,0.045)';
    albedo.fillRect(x, y, 1, 1);
    relief.fillStyle = light ? '#969696' : '#747474';
    relief.fillRect(x, y, 1, 1);
  }

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

  footballSeamMaterial ??= new THREE.LineBasicMaterial({ color: 0x514e48 });
  const seams = new THREE.LineSegments(
    cachedGeo('football_panel_seams', footballSeamGeometry),
    footballSeamMaterial,
  );
  seams.name = 'football_panel_seams';
  root.add(seams);
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

/* ---------------------------------------------------------------------------
 * The postcard
 * ------------------------------------------------------------------------- */

/**
 * The card's handwriting, the same system-cursive stack the screen-space card used:
 * one item buys no web font, so it falls through to whatever script face the machine
 * already has, then `cursive`. Canvas takes a font shorthand, so the quotes stay.
 */
const POSTCARD_HAND_FONT =
  '"Segoe Script", "Bradley Hand", "Snell Roundhand", "Apple Chancery", "Comic Sans MS", "Brush Script MT", cursive';
/** Printed card size, metres: real postcard proportions, 148 x 105 mm. */
const POSTCARD_W = 0.148;
const POSTCARD_H = 0.105;
const POSTCARD_THICKNESS = 0.0022;
/**
 * Face texture: the card's own proportions to within a pixel.
 *
 * SUPERSAMPLED ON PURPOSE. Raised, the card sits 0.25 m from the eye, where it covers
 * some 45% of a 16:9 frame's width at the default 58-degree vertical FOV — about 860
 * screen pixels across at 1080p, and half that when adaptive resolution is at its floor.
 * At 2048 the handwriting is still oversampled at the dark end of that range, which is
 * the whole difference between a card you read and a card you squint at; mipmaps and the
 * hardware anisotropy cap carry the minified end for free.
 */
const POSTCARD_TEX_W = 2048;
const POSTCARD_TEX_H = Math.round((POSTCARD_TEX_W * POSTCARD_H) / POSTCARD_W);

/**
 * The note's words: the `postcard.message` string in the player's language. The
 * recipient's address on the right is an illegible scrawl (`drawPostcardScrawl`): it
 * simply cannot be read.
 */
function postcardText(): string {
  return t('postcard.message');
}

/**
 * The hand for the player's language. The Latin script faces carry Cyrillic on most
 * machines, but not Chinese, Japanese or Korean, so those languages put a brush or pen
 * face of their own first rather than landing on whatever sans the system picks.
 */
function postcardHandFont(): string {
  switch (locale()) {
    case 'zh':
      return `"Kaiti SC", "STKaiti", "KaiTi", "Xingkai SC", ${POSTCARD_HAND_FONT}`;
    case 'ja':
      return `"Klee Medium", "Klee", "Klee One", "YuKyokasho", "Hiragino Maru Gothic ProN", ${POSTCARD_HAND_FONT}`;
    case 'ko':
      return `"Nanum Pen Script", "Nanum Pen", "Nanum Brush Script", "Apple SD Gothic Neo", ${POSTCARD_HAND_FONT}`;
    default:
      return POSTCARD_HAND_FONT;
  }
}

/**
 * The message broken into lines that fit `width` in the context's current font. Words
 * break at spaces; Chinese and Japanese, which do not space their words, break between
 * any two characters, except that closing punctuation stays on the line it closes.
 */
function wrapPostcardText(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const cjk = locale() === 'zh' || locale() === 'ja';
  const tokens = cjk ? [...text] : text.split(' ');
  const joiner = cjk ? '' : ' ';
  const noLineStart = '，。、！？：；）」』—…';
  const lines: string[] = [];
  let line = '';
  for (const token of tokens) {
    const candidate = line ? line + joiner + token : token;
    if (!line || ctx.measureText(candidate).width <= width || (cjk && noLineStart.includes(token))) {
      line = candidate;
    } else {
      lines.push(line);
      line = token;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Fixed-seed noise: the same LCG this file's other procedural surfaces use. */
function postcardNoise(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state >>> 8) / 0x1000000;
  };
}

/**
 * Centred, letter-spaced text. Canvas `letterSpacing` is not on every engine, and the
 * tracking is the whole difference between printed furniture and a word.
 */
function drawSpacedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  centreX: number,
  y: number,
  tracking: number,
): void {
  const widths: number[] = [];
  let total = 0;
  for (const ch of text) {
    const width = ctx.measureText(ch).width;
    widths.push(width);
    total += width;
  }
  total += tracking * Math.max(0, text.length - 1);
  let x = centreX - total / 2;
  for (let i = 0; i < text.length; i++) {
    ctx.fillText(text[i]!, x, y);
    x += widths[i]! + tracking;
  }
}

/**
 * The illegible address: two seeded wavy strokes over a soft smudge, so even the
 * stroke count resists reading. Deterministic, and never a word. `rowGap` is the
 * address rule spacing, so the scrawl sits on the rules rather than across them.
 */
function drawPostcardScrawl(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  rowGap: number,
): void {
  const centreY = y + rowGap / 2;
  const smudge = ctx.createRadialGradient(x + width / 2, centreY, 0, x + width / 2, centreY, width * 0.55);
  smudge.addColorStop(0, 'rgba(58, 52, 60, 0.18)');
  smudge.addColorStop(1, 'rgba(58, 52, 60, 0)');
  ctx.fillStyle = smudge;
  ctx.fillRect(x - 10, y - rowGap * 0.6, width + 20, rowGap * 2.2);

  const rnd = postcardNoise(0x5eed1e77);
  ctx.strokeStyle = 'rgba(38, 34, 42, 0.74)';
  ctx.lineWidth = 3.4;
  ctx.lineCap = 'round';
  for (let row = 0; row < 2; row++) {
    const base = y + row * rowGap;
    let px = x;
    ctx.beginPath();
    ctx.moveTo(px, base);
    while (px < x + width) {
      const step = 24 + rnd() * 38;
      const next = Math.min(px + step, x + width);
      ctx.quadraticCurveTo(
        px + step * 0.5,
        base + (rnd() - 0.5) * rowGap * 0.45,
        next,
        base + (rnd() - 0.5) * 18,
      );
      px = next;
    }
    ctx.stroke();
  }
}

/**
 * The stamp: a perforated edge, a printed frame, and a thumbnail of the very sunset the
 * picture side shows, so the two faces are the same holiday.
 */
function drawPostcardStamp(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const perf = 12;
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(0.035);
  ctx.translate(-w / 2, -h / 2);

  // The perforated edge is a body inset by one radius plus a row of bumps along each
  // side, which is what a torn stamp edge actually looks like at this size.
  ctx.fillStyle = '#e6d9b8';
  ctx.fillRect(perf, 0, w - 2 * perf, h);
  ctx.fillRect(0, perf, w, h - 2 * perf);
  for (let cx = perf; cx <= w - perf + 0.5; cx += perf * 2) {
    for (const cy of [0, h]) {
      ctx.beginPath();
      ctx.arc(cx, cy, perf, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  for (let cy = perf; cy <= h - perf + 0.5; cy += perf * 2) {
    for (const cx of [0, w]) {
      ctx.beginPath();
      ctx.arc(cx, cy, perf, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.strokeStyle = 'rgba(158, 52, 40, 0.7)';
  ctx.lineWidth = 4;
  ctx.strokeRect(22, 22, w - 44, h - 44);

  // Its picture: the picture side's sunset in miniature — the sky going from violet to
  // gold, the sun on the sea, sand, and the white house under its blue dome.
  const px = 40;
  const py = 46;
  const pw = w - 80;
  const ph = h - 116;
  const inner = ctx.createLinearGradient(0, py, 0, py + ph);
  inner.addColorStop(0, '#5d4a7e');
  inner.addColorStop(0.25, '#c06a74');
  inner.addColorStop(0.44, '#fbc070');
  inner.addColorStop(0.46, '#7a5a7e');
  inner.addColorStop(0.78, '#3f6f7c');
  inner.addColorStop(0.84, '#d9a478');
  inner.addColorStop(1, '#b8845f');
  ctx.fillStyle = inner;
  ctx.fillRect(px, py, pw, ph);
  ctx.fillStyle = '#ffe2a0';
  ctx.beginPath();
  ctx.arc(px + pw * 0.34, py + ph * 0.45, pw * 0.09, Math.PI, 0);
  ctx.fill();
  ctx.fillRect(px + pw * 0.31, py + ph * 0.5, pw * 0.06, ph * 0.2);
  ctx.fillStyle = '#f2c6ae';
  ctx.fillRect(px + pw * 0.56, py + ph * 0.68, pw * 0.22, ph * 0.2);
  ctx.fillStyle = '#3c6b99';
  ctx.beginPath();
  ctx.arc(px + pw * 0.67, py + ph * 0.68, pw * 0.11, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = 'rgba(60, 54, 48, 0.85)';
  ctx.font = '600 26px Georgia, "Times New Roman", serif';
  drawSpacedText(ctx, 'ПОЧТА', w / 2, h - 34, 3);
  ctx.restore();
}

let postcardTextTextureCache: THREE.CanvasTexture | null = null;

/**
 * The message side: the card's paper, the note in its own hand, and the posted
 * furniture — stamp, cancellation, address rules, divider — drawn once per session.
 * See `postcardFaceMaterials` for why the texture belongs to the module rather than to
 * any one card.
 */
function postcardTextTexture(): THREE.CanvasTexture {
  if (postcardTextTextureCache) return postcardTextTextureCache;

  const canvas = document.createElement('canvas');
  canvas.width = POSTCARD_TEX_W;
  canvas.height = POSTCARD_TEX_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is required for the postcard');

  const W = POSTCARD_TEX_W;
  const H = POSTCARD_TEX_H;
  const margin = 46;

  // The paper, in the tone the screen-space card used, then fibre mottle and the soft
  // edge shading that card's inset shadow gave it.
  ctx.fillStyle = '#efe6cf';
  ctx.fillRect(0, 0, W, H);
  const rnd = postcardNoise(0x1e77a1b3);
  for (let i = 0; i < 2400; i++) {
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(255, 255, 255, 0.05)' : 'rgba(122, 102, 72, 0.045)';
    ctx.fillRect(rnd() * W, rnd() * H, 2, 2);
  }
  const edge = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.95);
  edge.addColorStop(0, 'rgba(150, 120, 70, 0)');
  edge.addColorStop(1, 'rgba(150, 120, 70, 0.17)');
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, W, H);

  // The printed frame, and the rule between the message and the address side.
  ctx.strokeStyle = 'rgba(120, 100, 70, 0.3)';
  ctx.lineWidth = 3;
  ctx.strokeRect(margin, margin, W - 2 * margin, H - 2 * margin);
  const dividerX = Math.round(W * 0.68);
  ctx.strokeStyle = 'rgba(96, 86, 70, 0.4)';
  ctx.beginPath();
  ctx.moveTo(dividerX + 0.5, margin + 40);
  ctx.lineTo(dividerX + 0.5, H - margin - 40);
  ctx.stroke();

  // The message: the largest hand that wraps into the column's width and height, found
  // by measurement, because which script face the machine falls back to decides how
  // wide a line really is, and one language runs half again as long as another.
  const messageLeft = margin + 66;
  const messageWidth = dividerX - messageLeft - 74;
  const messageTop = H * 0.2;
  const messageHeight = H - margin - 70 - messageTop;
  const text = postcardText();
  const handFont = postcardHandFont();
  let fontPx = 116;
  let lines: string[] = [];
  for (; fontPx >= 40; fontPx -= 2) {
    ctx.font = `${fontPx}px ${handFont}`;
    lines = wrapPostcardText(ctx, text, messageWidth);
    if ((lines.length - 1) * fontPx * 1.62 + fontPx <= messageHeight) break;
  }
  ctx.fillStyle = '#2a262e';
  ctx.textBaseline = 'alphabetic';
  const lineGap = fontPx * 1.62;
  let lineY = messageTop + fontPx;
  for (const line of lines) {
    // A hand wanders: each line starts a few pixels off the one above it and tilts by
    // well under a degree, which is the whole difference between writing and print.
    ctx.save();
    ctx.translate(messageLeft + (rnd() - 0.5) * 16, lineY);
    ctx.rotate((rnd() - 0.5) * 0.012);
    ctx.fillText(line, 0, 0);
    ctx.restore();
    lineY += lineGap;
  }

  // The address side: four rules, and the scrawl written across the top two of them.
  const addressLeft = dividerX + 62;
  const addressWidth = W - margin - 54 - addressLeft;
  const ruleTop = Math.round(H * 0.42);
  const ruleGap = Math.round(H * 0.088);
  ctx.strokeStyle = 'rgba(96, 86, 70, 0.26)';
  for (let i = 0; i < 4; i++) {
    const ry = ruleTop + i * ruleGap + 0.5;
    ctx.beginPath();
    ctx.moveTo(addressLeft, ry);
    ctx.lineTo(addressLeft + addressWidth, ry);
    ctx.stroke();
  }
  drawPostcardScrawl(ctx, addressLeft + 6, ruleTop - 8, addressWidth - 12, ruleGap);

  // The stamp, and the cancellation struck across its lower corner and carried off
  // toward the middle of the card.
  const stampW = 208;
  const stampH = 262;
  const stampX = W - margin - 46 - stampW;
  const stampY = margin + 42;
  drawPostcardStamp(ctx, stampX, stampY, stampW, stampH);

  ctx.save();
  ctx.translate(stampX + 34, stampY + stampH - 30);
  ctx.rotate(-0.13);
  ctx.globalAlpha = 0.44;
  ctx.strokeStyle = '#44444e';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(0, 0, 122, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 94, 0, Math.PI * 2);
  ctx.stroke();
  for (let bar = 0; bar < 4; bar++) {
    const by = -42 + bar * 28;
    ctx.beginPath();
    ctx.moveTo(-104, by);
    for (let k = 1; k <= 8; k++) ctx.lineTo(-104 - k * 26, by + (k % 2 === 0 ? 0 : 14));
    ctx.stroke();
  }
  ctx.fillStyle = '#40404a';
  ctx.font = '600 30px Georgia, "Times New Roman", serif';
  drawSpacedText(ctx, '14 08', 0, 12, 4);
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy();
  postcardTextTextureCache = texture;
  return texture;
}

let postcardPhotoTextureCache: THREE.CanvasTexture | null = null;

/**
 * The evening light on the card: what the low sun does to a paint. Warm and a little
 * down, with the blue pulled hardest, so a green stays a green but a sunset one.
 */
const POSTCARD_DUSK: readonly [number, number, number] = [0.94, 0.74, 0.62];
/** `PALM_TINT` (render/mirage-tableau.ts) as sRGB: the grove's own warm haze. */
const POSTCARD_PALM_TINT: readonly [number, number, number] = [1, 0xf1 / 255, 0xdc / 255];

function postcardDuskPaint(hex: number): string {
  const r = ((hex >> 16) & 255) * POSTCARD_PALM_TINT[0] * POSTCARD_DUSK[0];
  const g = ((hex >> 8) & 255) * POSTCARD_PALM_TINT[1] * POSTCARD_DUSK[1];
  const b = (hex & 255) * POSTCARD_PALM_TINT[2] * POSTCARD_DUSK[2];
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

/**
 * One palm, painted from the ending grove's own card (`drawPalmCard`), so the palms on
 * the card are the date palms that stand round the house: the same leaning two-tone
 * trunk, the same fan of drooping split fronds, dates on the stout one. The card is
 * painted back to front in its own depth, which is the order the geometry resolves in,
 * and `mirror` turns it round the way the grove's random yaw does.
 *
 * Its shadow runs long toward the viewer and to the right: the sun is low over the sea,
 * behind the grove and to the left.
 */
function drawPostcardPalm(
  ctx: CanvasRenderingContext2D,
  variant: number,
  x: number,
  baseY: number,
  height: number,
  mirror: boolean,
): void {
  ctx.save();
  ctx.fillStyle = 'rgba(70, 44, 52, 0.28)';
  ctx.translate(x, baseY);
  ctx.transform(1, 0, 0.9, 1, 0, 0);
  ctx.beginPath();
  ctx.ellipse(height * 0.02, height * 0.08, height * 0.05, height * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const triangles: { pts: number[]; hex: number; z: number }[] = [];
  drawPalmCard(variant, (ax, ay, bx, by, cx, cy, hex, z) => {
    triangles.push({ pts: [ax, ay, bx, by, cx, cy], hex, z });
  });
  triangles.sort((a, b) => a.z - b.z);
  const sx = mirror ? -height : height;
  const paints = new Map<number, string>();
  for (const tri of triangles) {
    let paint = paints.get(tri.hex);
    if (!paint) paints.set(tri.hex, (paint = postcardDuskPaint(tri.hex)));
    const p = tri.pts;
    ctx.fillStyle = paint;
    ctx.strokeStyle = paint;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + p[0]! * sx, baseY - p[1]! * height);
    ctx.lineTo(x + p[2]! * sx, baseY - p[3]! * height);
    ctx.lineTo(x + p[4]! * sx, baseY - p[5]! * height);
    ctx.closePath();
    ctx.fill();
    // A hairline in the same paint closes the seams antialiasing leaves between two
    // triangles of one strip.
    ctx.stroke();
  }
}

/**
 * A long, thin evening cloud: a flat lens, violet on top where it is in its own shade
 * and lit rose-gold underneath where the sun, below it, catches it.
 */
function drawPostcardCloud(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, glow: number): void {
  // Built from overlapping puffs of varying length and depth, so the edge frays the way
  // a real streak of cirrus does instead of reading as one ruled lens.
  const rnd = postcardNoise(Math.round(x * 131 + y * 7));
  const puffs = 5 + Math.floor(rnd() * 4);
  for (let i = 0; i < puffs; i++) {
    const px = x + (rnd() - 0.5) * w * 0.8;
    const py = y + (rnd() - 0.5) * h * 0.9;
    const pw = w * (0.18 + rnd() * 0.3);
    const ph = h * (0.5 + rnd() * 0.9);
    ctx.fillStyle = `rgba(118, 82, 124, ${(0.35 * glow + 0.14) * (0.6 + rnd() * 0.4)})`;
    ctx.beginPath();
    ctx.ellipse(px, py, pw / 2, ph / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(255, 170, 118, ${0.6 * glow * (0.5 + rnd() * 0.5)})`;
    ctx.beginPath();
    ctx.ellipse(px + pw * 0.04, py + ph * 0.24, pw * 0.44, ph * 0.26, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * The picture side: the house by the sea at sunset — the sun going down into the sea,
 * its path laid across the water, the white house with its blue dome on the sand and
 * the ending's date palms round it — printed as a vintage photo postcard, with a white
 * border, a warm cast, grain and a vignette.
 *
 * The house and the palms are the ones the ending lands beside (the cycladic dwelling,
 * `drawPalmCard`); only the hour is the card's own, because a postcard from the sea is
 * a sunset.
 */
function postcardPhotoTexture(): THREE.CanvasTexture {
  if (postcardPhotoTextureCache) return postcardPhotoTextureCache;

  const canvas = document.createElement('canvas');
  canvas.width = POSTCARD_TEX_W;
  canvas.height = POSTCARD_TEX_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is required for the postcard');

  const W = POSTCARD_TEX_W;
  const H = POSTCARD_TEX_H;
  const rnd = postcardNoise(0x50a17e2d);
  // The print's white border, then the picture inside it.
  ctx.fillStyle = '#f1e9d6';
  ctx.fillRect(0, 0, W, H);
  const bx = 62;
  const by = 62;
  const bw = W - 2 * bx;
  const bh = H - 2 * by;
  ctx.save();
  ctx.beginPath();
  ctx.rect(bx, by, bw, bh);
  ctx.clip();
  const horizon = by + bh * 0.47;
  const shore = by + bh * 0.72;
  const sunX = bx + bw * 0.34;
  const sunR = bh * 0.055;
  const sunY = horizon - sunR * 0.35;

  // Sky: indigo overhead, through violet and rose to the gold band along the sea.
  const sky = ctx.createLinearGradient(0, by, 0, horizon);
  sky.addColorStop(0, '#2e3566');
  sky.addColorStop(0.3, '#5d4a7e');
  sky.addColorStop(0.58, '#b86478');
  sky.addColorStop(0.8, '#ec8c5e');
  sky.addColorStop(0.94, '#fbc070');
  sky.addColorStop(1, '#ffd98e');
  ctx.fillStyle = sky;
  ctx.fillRect(bx, by, bw, horizon - by);
  // The sun's own glow, wide and low, gathered over where it is setting.
  const glow = ctx.createRadialGradient(sunX, sunY, sunR, sunX, sunY, bw * 0.5);
  glow.addColorStop(0, 'rgba(255, 226, 150, 0.85)');
  glow.addColorStop(0.25, 'rgba(255, 170, 100, 0.35)');
  glow.addColorStop(1, 'rgba(255, 140, 100, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(bx, by, bw, horizon - by);

  // Thin evening clouds in streaks, lit from underneath, brightest nearest the sun.
  for (let i = 0; i < 7; i++) {
    const cy = by + bh * (0.06 + rnd() * 0.32);
    const cx = bx + rnd() * bw;
    const near = 1 - Math.min(1, Math.abs(cx - sunX) / (bw * 0.6));
    const lift = (cy - by) / (horizon - by);
    drawPostcardCloud(ctx, cx, cy, bw * (0.12 + rnd() * 0.22), bh * (0.012 + rnd() * 0.014), 0.25 + near * 0.5 * lift + 0.25 * lift);
  }

  // The sun: half gone into the sea already, a flattened disc the colour of the band.
  ctx.save();
  ctx.beginPath();
  ctx.rect(bx, by, bw, horizon - by);
  ctx.clip();
  const disc = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR);
  disc.addColorStop(0, '#fff6d8');
  disc.addColorStop(0.7, '#ffe6a4');
  disc.addColorStop(1, '#ffc978');
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.ellipse(sunX, sunY, sunR * 1.04, sunR * 0.94, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Sea: the sky's gold and rose thrown back at the horizon, darkening to dusk blue,
  // then the shallows over the sand going turquoise-grey toward the foam.
  const sea = ctx.createLinearGradient(0, horizon, 0, shore);
  sea.addColorStop(0, '#c77a74');
  sea.addColorStop(0.12, '#7a5a7e');
  sea.addColorStop(0.5, '#3a4a74');
  sea.addColorStop(0.82, '#3f6f7c');
  sea.addColorStop(1, '#8fb2a8');
  ctx.fillStyle = sea;
  ctx.fillRect(bx, horizon, bw, shore - horizon);
  // A hairline of light where the sky meets the water.
  ctx.fillStyle = 'rgba(255, 214, 150, 0.7)';
  ctx.fillRect(bx, horizon - 1, bw, 3);

  // Ripples: short dashes squeezed toward the horizon as rows of water are, each
  // lit rose on its sky-facing side.
  ctx.strokeStyle = 'rgba(236, 170, 170, 1)';
  for (let row = 0; row < 30; row++) {
    const t = row / 29;
    const y = horizon + Math.pow(t, 1.7) * (shore - horizon) * 0.9 + 6;
    const count = 4 + Math.round((1 - t) * 20);
    ctx.lineWidth = 1.5 + t * 3;
    for (let i = 0; i < count; i++) {
      const x = bx + rnd() * bw;
      ctx.globalAlpha = 0.06 + rnd() * 0.16;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (10 + rnd() * 44) * (0.4 + t), y + (rnd() - 0.5) * 3);
      ctx.stroke();
    }
  }
  // The sun's path: a column of gold glints under the sun, narrow at the horizon and
  // opening toward the shore, brightest in its middle.
  for (let row = 0; row < 70; row++) {
    const t = row / 69;
    const y = horizon + 3 + Math.pow(t, 1.5) * (shore - horizon) * 0.95;
    const halfWidth = sunR * (0.9 + t * 2.6);
    const count = 3 + Math.round(t * 7);
    ctx.lineWidth = 2 + t * 4;
    for (let i = 0; i < count; i++) {
      const u = (rnd() + rnd() + rnd()) / 3 - 0.5;
      const x = sunX + u * 2 * halfWidth + t * bw * 0.02;
      ctx.strokeStyle = rnd() < 0.3 ? '#fff4d0' : '#ffc46e';
      ctx.globalAlpha = (0.45 + rnd() * 0.5) * (1 - Math.abs(u) * 1.2) * (1 - t * 0.45);
      const len = (14 + rnd() * 40) * (0.5 + t);
      ctx.beginPath();
      ctx.moveTo(x - len / 2, y);
      ctx.lineTo(x + len / 2, y + (rnd() - 0.5) * 2);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  // The foam line and a thin swash line below it, both catching the sky's rose.
  ctx.strokeStyle = 'rgba(250, 226, 214, 0.9)';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(bx, shore);
  for (let x = bx; x < bx + bw; x += 64) {
    ctx.quadraticCurveTo(x + 32, shore + (rnd() - 0.5) * 24, x + 64, shore + (rnd() - 0.5) * 12);
  }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(250, 226, 214, 0.4)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(bx, shore + 34);
  for (let x = bx; x < bx + bw; x += 96) {
    ctx.quadraticCurveTo(x + 48, shore + 34 + (rnd() - 0.5) * 20, x + 96, shore + 34 + (rnd() - 0.5) * 10);
  }
  ctx.stroke();

  // The sand in evening light: wet and mirroring the sky just under the foam, then
  // warm apricot, dimming toward the bottom of the frame as the light goes.
  const sand = ctx.createLinearGradient(0, shore - 8, 0, by + bh);
  sand.addColorStop(0, '#8e6a72');
  sand.addColorStop(0.2, '#c8906c');
  sand.addColorStop(0.55, '#d9a478');
  sand.addColorStop(1, '#a8795e');
  ctx.fillStyle = sand;
  ctx.fillRect(bx, shore - 8, bw, by + bh - (shore - 8));
  // The wet sand's reflection of the sun's path.
  const wet = ctx.createRadialGradient(sunX + bw * 0.03, shore + 40, 0, sunX + bw * 0.03, shore + 40, bw * 0.16);
  wet.addColorStop(0, 'rgba(255, 200, 130, 0.45)');
  wet.addColorStop(1, 'rgba(255, 200, 130, 0)');
  ctx.fillStyle = wet;
  ctx.fillRect(bx, shore - 8, bw, 120);
  for (let i = 0; i < 900; i++) {
    const t = rnd();
    const y = shore + Math.pow(t, 0.6) * (by + bh - shore);
    ctx.fillStyle = rnd() < 0.55 ? 'rgba(90, 56, 50, 0.08)' : 'rgba(255, 220, 180, 0.07)';
    ctx.fillRect(bx + rnd() * bw, y, 3 + rnd() * 9, 1 + rnd() * 2);
  }
  // Wrack along the waterline.
  for (let i = 0; i < 260; i++) {
    const x = bx + rnd() * bw;
    const y = shore - 6 + Math.pow(rnd(), 2) * 120;
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(70, 46, 48, 0.45)' : 'rgba(52, 50, 48, 0.38)';
    ctx.beginPath();
    ctx.ellipse(x, y, 3 + rnd() * 7, 2 + rnd() * 3, rnd() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  // Palms standing behind the house, painted first so the house stands in front.
  const ground = by + bh * 0.9;
  drawPostcardPalm(ctx, 0, bx + bw * 0.79, ground - bh * 0.05, bh * 0.3, false);
  drawPostcardPalm(ctx, 2, bx + bw * 0.95, ground - bh * 0.04, bh * 0.22, true);

  // The house, on the sand right of centre: the cycladic dwelling the ending builds.
  // Its seaward flank takes the last rose light; the face toward us is already in the
  // blue of evening, the windows lit.
  const houseW = bw * 0.17;
  const houseH = bh * 0.15;
  const houseX = bx + bw * 0.6;
  const houseY = ground - houseH;
  ctx.fillStyle = 'rgba(70, 44, 52, 0.3)';
  ctx.beginPath();
  ctx.moveTo(houseX, houseY + houseH);
  ctx.lineTo(houseX + houseW * 0.9, houseY + houseH);
  ctx.lineTo(houseX + houseW * 1.5, houseY + houseH * 1.5);
  ctx.lineTo(houseX + houseW * 0.4, houseY + houseH * 1.5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#f2c6ae';
  ctx.fillRect(houseX, houseY, houseW * 0.62, houseH);
  ctx.fillStyle = '#b39cb0';
  ctx.beginPath();
  ctx.moveTo(houseX + houseW * 0.62, houseY);
  ctx.lineTo(houseX + houseW, houseY + houseH * 0.12);
  ctx.lineTo(houseX + houseW, houseY + houseH * 1.12);
  ctx.lineTo(houseX + houseW * 0.62, houseY + houseH);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#3f5f94';
  ctx.beginPath();
  ctx.arc(houseX + houseW * 0.3, houseY, houseW * 0.28, Math.PI, 0);
  ctx.fill();
  // The dome's rim of sunset, on the side toward the sun.
  ctx.strokeStyle = 'rgba(255, 190, 140, 0.8)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(houseX + houseW * 0.3, houseY, houseW * 0.28 - 2, Math.PI, Math.PI * 1.45);
  ctx.stroke();
  ctx.fillStyle = '#3f5f94';
  ctx.fillRect(houseX + houseW * 0.27, houseY + houseH, houseW * 0.06, houseH * 0.1);
  ctx.fillStyle = '#2b3f63';
  ctx.fillRect(houseX + houseW * 0.08, houseY + houseH * 0.55, houseW * 0.16, houseH * 0.45);
  // Windows with the lamps already on inside.
  ctx.fillStyle = '#ffd488';
  ctx.fillRect(houseX + houseW * 0.36, houseY + houseH * 0.4, houseW * 0.14, houseH * 0.2);
  ctx.fillRect(houseX + houseW * 0.7, houseY + houseH * 0.45, houseW * 0.16, houseH * 0.22);
  const lamp = ctx.createRadialGradient(houseX + houseW * 0.78, houseY + houseH * 0.56, 0, houseX + houseW * 0.78, houseY + houseH * 0.56, houseW * 0.3);
  lamp.addColorStop(0, 'rgba(255, 210, 130, 0.35)');
  lamp.addColorStop(1, 'rgba(255, 210, 130, 0)');
  ctx.fillStyle = lamp;
  ctx.fillRect(houseX, houseY, houseW * 1.2, houseH * 1.2);

  // Palms in front of the house and down the beach: the grove the ending plants round
  // it, one of each form, their crowns across the walls.
  drawPostcardPalm(ctx, 1, bx + bw * 0.54, ground + bh * 0.01, bh * 0.3, false);
  drawPostcardPalm(ctx, 2, bx + bw * 0.43, ground + bh * 0.035, bh * 0.21, false);
  drawPostcardPalm(ctx, 0, bx + bw * 0.88, ground + bh * 0.05, bh * 0.36, true);
  // Two far down the beach to the left, small with distance.
  drawPostcardPalm(ctx, 0, bx + bw * 0.1, shore + bh * 0.09, bh * 0.2, true);
  drawPostcardPalm(ctx, 1, bx + bw * 0.16, shore + bh * 0.1, bh * 0.16, false);

  // Scrub on the dune in front, already in shade.
  for (let i = 0; i < 26; i++) {
    const x = bx + bw * (0.02 + rnd() * 0.4);
    const y = by + bh * (0.91 + rnd() * 0.08);
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(96, 88, 68, 0.55)' : 'rgba(78, 74, 58, 0.5)';
    ctx.beginPath();
    ctx.ellipse(x, y, 8 + rnd() * 16, 5 + rnd() * 7, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // The print itself: a warm cast, grain, a fine halftone scan and a vignette, so the
  // face reads as a photograph printed on card stock rather than as a rendered scene.
  ctx.fillStyle = 'rgba(255, 190, 130, 0.06)';
  ctx.fillRect(bx, by, bw, bh);
  for (let i = 0; i < 22000; i++) {
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(255, 255, 255, 0.05)' : 'rgba(40, 34, 28, 0.055)';
    ctx.fillRect(bx + rnd() * bw, by + rnd() * bh, 2, 2);
  }
  ctx.fillStyle = 'rgba(60, 50, 40, 0.035)';
  for (let y = by; y < by + bh; y += 4) ctx.fillRect(bx, y, bw, 1);
  const vignette = ctx.createRadialGradient(W / 2, H / 2, bh * 0.34, W / 2, H / 2, bw * 0.76);
  vignette.addColorStop(0, 'rgba(30, 20, 30, 0)');
  vignette.addColorStop(1, 'rgba(30, 20, 30, 0.36)');
  ctx.fillStyle = vignette;
  ctx.fillRect(bx, by, bw, bh);
  ctx.restore();
  // A hairline around the image, the way a printed postcard's photograph is keylined.
  ctx.strokeStyle = 'rgba(90, 80, 66, 0.35)';
  ctx.lineWidth = 2;
  ctx.strokeRect(bx, by, bw, bh);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy();
  postcardPhotoTextureCache = texture;
  return texture;
}

let postcardFaceMaterialCache: THREE.MeshStandardMaterial[] | null = null;

/**
 * The card's six faces, in BoxGeometry's order: four paper edges, then the printed side
 * (+Z) and the picture (-Z).
 *
 * SHARED AND MODULE-OWNED, deliberately not `itemOwnedResource`: both 2048-px faces are
 * painted once per session and every postcard in the world — in the hand, flat in the
 * trunk, lying on the ground — uses them, so the ordinary item disposer must leave them
 * alone. Each printed face also carries its own texture as an emissive map at a third
 * strength, which is what keeps the handwriting readable when the card is raised with
 * the sun behind the player.
 */
function postcardFaceMaterials(): THREE.MeshStandardMaterial[] {
  if (postcardFaceMaterialCache) return postcardFaceMaterialCache;

  const paper = new THREE.MeshStandardMaterial({ color: 0xf0e7d2, roughness: 0.9, metalness: 0 });
  const printed = [postcardTextTexture(), postcardPhotoTexture()].map(
    (map) =>
      new THREE.MeshStandardMaterial({
        map,
        emissive: 0xffffff,
        emissiveMap: map,
        emissiveIntensity: 0.34,
        roughness: 0.88,
        metalness: 0,
      }),
  );
  postcardFaceMaterialCache = [paper, paper, paper, paper, ...printed];
  return postcardFaceMaterialCache;
}

/**
 * The postcard itself: one thin card, the same mesh wherever it is — in the hand, flat
 * in a trunk, lying on the ground. The printed side is +Z and the picture -Z, so the
 * card is genuinely turned over to read the other face, exactly as paper is.
 */
function createPostcardMesh(): THREE.Group {
  const root = new THREE.Group();
  const card = new THREE.Mesh(
    cachedGeo('postcard_card', () => new THREE.BoxGeometry(POSTCARD_W, POSTCARD_H, POSTCARD_THICKNESS)),
    postcardFaceMaterials(),
  );
  card.name = 'postcard_card';
  root.add(card);
  return root;
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

function buildContractParcelInto(b: MeshBuilder): void {
  const paper = flat(0x8f6847, 0.92);
  const string = flat(0x3a281c, 0.96);
  const label = flat(0xd9c8a5, 0.9);
  b.box('contract_parcel', 0.32, 0.2, 0.17, paper, [0, 0, 0]);
  b.box('contract_parcel_string_x', 0.018, 0.205, 0.176, string, [0, 0, 0]);
  b.box('contract_parcel_string_y', 0.325, 0.018, 0.176, string, [0, 0, 0]);
  b.box('contract_parcel_label', 0.15, 0.075, 0.006, label, [0.045, 0.025, 0.088]);
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
    case 'fluid_can':
      return buildGroup(
        itemBlueprint(`fluid_${item.fluid}`, (b) => buildFluidCanInto(b, item.fluid)).instructions,
      );
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
    case 'postcard':
      return createPostcardMesh();
    case 'contract_cargo':
      return buildGroup(itemBlueprint('contract_parcel', buildContractParcelInto).instructions);
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
  for (const geometry of geometryCache.values()) geometry.dispose();
  geometryCache.clear();
  blueprintCache.clear();
  itemBlueprintCache.clear();
}
