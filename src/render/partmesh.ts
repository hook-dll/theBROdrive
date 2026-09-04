/**
 * Procedural meshes for every part and carried item in the game.
 *
 * Everything is built from primitives — no external assets, no textures. Geometry is
 * built once per logical form and cached; each create* call returns a fresh Object3D
 * that shares the cached BufferGeometry but gets its own materials, so every instance
 * can hold independent dirt/rust.
 *
 * Car bodies are complete, authored GLB models (see render/carmodel.ts); this module
 * only builds the cosmetic parts and held items.
 *
 * Origin conventions (load-bearing for the Vehicle and LoosePartField):
 *  - a part's origin is its mount point, in +X right / +Y up / +Z forward;
 *  - a wheel's origin is the wheel centre with the axle along local +X.
 */
import * as THREE from 'three';
import { variant } from '../parts/registry';
import type { EngineSpec, PartVariant, WheelSpec } from '../parts/registry';
import type {
  FluidKind,
  Item,
  QuarryItem,
  ShadeTint,
  ToolKind,
  WeaponKind,
} from '../items/items';
import { makeConditionMaterial, makeFlatMaterial } from './materials';

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

  cylinder(key: string, radiusTop: number, radiusBottom: number, height: number, radialSegments: number, material: MaterialSpec, position: Vec3, rotation: Vec3 = ZERO, scale: Vec3 = ONE): void {
    this.push(key, () => new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments, 1, false), material, position, rotation, scale);
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
    case 'wheel': return buildWheel(b, v);
    case 'fuel_tank': return buildTank(b, v);
    case 'door': return buildDoor(b, v);
    case 'hood': return buildHood(b, v);
    case 'trunk': return buildTrunk(b, v);
    case 'seat': return buildSeat(b, v);
    case 'mirror': return buildMirror(b, v);
    case 'bumper': return buildBumper(b, v);
    case 'battery': return buildBattery(b, v);
    case 'radiator': return buildRadiator(b, v);
    case 'turbine': return buildTurbine(b, v);
    case 'headlight': return buildHeadlight(b, v);
    case 'exhaust': return buildExhaust(b, v);
    case 'dashboard': return buildDashboard(b, v);
  }
}

// ----------------------------- engines -----------------------------

function buildEngine(b: MeshBuilder, v: PartVariant): void {
  const spec = v.engine as EngineSpec;
  switch (v.id) {
    case 'engine_i4_1600': return buildInline(b, spec, 1.0, false);
    case 'engine_i6_2800': return buildInline(b, spec, 1.12, false);
    // The 1.2: same architecture as the 1.6 but visibly a smaller block.
    case 'engine_lada_1200': return buildInline(b, spec, 0.88, false);
    // The Volga 2.4: a tall, long-stroke four, so a taller block than the 1.6.
    case 'engine_i4_2445': return buildInline(b, spec, 1.09, false);
    case 'engine_v8_5000': return buildV8(b);
    case 'engine_d4_2000': return buildInline(b, spec, 1.18, true);
    case 'engine_d6_6600': return buildInline(b, spec, 1.62, true);
    default: throw new Error(`unhandled engine variant: ${v.id}`);
  }
}

/** Inline engine: block length grows with cylinder count; diesels add a turbo. */
function buildInline(b: MeshBuilder, spec: EngineSpec, scale: number, turbo: boolean): void {
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

  if (turbo) {
    const tz = len * 0.3;
    b.torus(`${id}_turbo`, 0.11 * scale, 0.045 * scale, 8, 18, rusty, [-ex - 0.06 * scale, blockTop * 0.75, tz]);
    b.cylinder(`${id}_turboin`, 0.07 * scale, 0.07 * scale, 0.16 * scale, 10, dark, [-ex - 0.06 * scale, blockTop * 0.75, tz], AXIS_X);
    b.cylinder(`${id}_airintake`, 0.05 * scale, 0.05 * scale, 0.3 * scale, 10, dark, [w * 0.35, headTop + coverH * 0.5, len * 0.42], AXIS_Z);
  }
}

/** V8: two tilted banks form the V; exhaust runners count to four per side. */
function buildV8(b: MeshBuilder): void {
  const iron = cond(0x3a3f45, 0.8, 0.5);
  const alloy = cond(0xaab0b6, 0.9, 0.3);
  const dark = cond(0x23262a, 0.5, 0.7);
  const rusty = cond(0x6a4a35, 0.85, 0.55);
  const len = 0.72;

  b.box('v8_crank', 0.52, 0.12, len, iron, [0, 0.07, 0]);
  b.box('v8_bank_l', 0.3, 0.24, len * 0.9, alloy, [-0.15, 0.22, 0], [0, 0, 0.45]);
  b.box('v8_bank_r', 0.3, 0.24, len * 0.9, alloy, [0.15, 0.22, 0], [0, 0, -0.45]);
  b.box('v8_intake', 0.22, 0.08, len * 0.7, dark, [0, 0.32, 0]);

  for (const side of [-1, 1]) {
    const ex = side * 0.36;
    b.cylinder(`v8_expipe_${side}`, 0.05, 0.05, len * 0.85, 12, rusty, [ex, 0.2, 0], AXIS_Z);
    for (let i = 0; i < 4; i++) {
      const z = (i / 3 - 0.5) * len * 0.6;
      b.cylinder(`v8_runner_${side}_${i}`, 0.03, 0.03, 0.14, 8, rusty, [side * 0.29, 0.22, z], AXIS_X);
    }
  }
}

// ----------------------------- gearboxes -----------------------------

function buildGearbox(b: MeshBuilder, v: PartVariant): void {
  const alloy = cond(0x9aa3ab, 0.9, 0.35);
  const dark = cond(0x23262a, 0.5, 0.7);
  let scale = 1;
  let manual = true;
  let fins = false;
  switch (v.id) {
    case 'gearbox_manual4': scale = 1.0; manual = true; fins = false; break;
    // Small four-speed: the estate's own box, noticeably shorter than the 5-speed.
    case 'gearbox_lada_4': scale = 0.92; manual = true; fins = false; break;
    case 'gearbox_manual5': scale = 1.15; manual = true; fins = false; break;
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

// ----------------------------- wheels -----------------------------

function buildWheel(b: MeshBuilder, v: PartVariant): void {
  const spec = v.wheel as WheelSpec;
  const R = spec.radius;
  const W = spec.width;
  const id = v.id;
  const isKnobbly = v.id === 'wheel_offroad_15';
  const isBald = v.id === 'wheel_bald_14';

  const tyre = flat(isBald ? 0x1b1c1e : 0x151617, isBald ? 0.55 : 0.85);
  const rim = cond(0x8b9096, 0.9, 0.32);
  const hub = cond(0x565b60, 0.85, 0.45);

  // Tyre radius is exactly the physics radius; axle along +X.
  b.cylinder(`${id}_tyre`, R, R, W, 28, tyre, [0, 0, 0], AXIS_X);
  b.cylinder(`${id}_rim`, R * 0.55, R * 0.55, W * 1.04, 20, rim, [0, 0, 0], AXIS_X);
  b.cylinder(`${id}_hub`, R * 0.16, R * 0.16, W * 1.1, 10, hub, [0, 0, 0], AXIS_X);

  if (isKnobbly) {
    const lugs = 10;
    for (let i = 0; i < lugs; i++) {
      const a = (i / lugs) * Math.PI * 2;
      b.box(
        `${id}_lug_${i}`,
        W * 0.7,
        0.05,
        0.06,
        tyre,
        [0, Math.cos(a) * R, Math.sin(a) * R],
        [a, 0, 0],
      );
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

// ----------------------------- trim -----------------------------

/**
 * The generic flat-panel door.
 *
 * Canonical face is -Z; the mount's ±90° yaw turns it onto the flank.
 */
function buildDoor(b: MeshBuilder, v: PartVariant): void {
  const panel = cond(0x9aa3ab, 0.85, 0.4);
  const gls = glass(0xa8ccd4, 0.06);
  const handle = cond(0xdadde2, 1.0, 0.15);
  const id = v.id;
  const w = id === 'door_truck' ? 1.15 : 0.95;
  const h = id === 'door_truck' ? 1.05 : 0.85;
  const d = 0.06;

  b.box(`${id}_panel`, w, h, d, panel, [0, 0, 0]);
  b.box(`${id}_glass`, w * 0.78, h * 0.42, d * 0.4, gls, [0, h * 0.22, -d * 0.45]);
  b.box(`${id}_handle`, 0.16, 0.04, d * 0.8, handle, [w * 0.15, -h * 0.02, -d * 0.6]);
}

/**
 * Dashboards. Wide and shallow, sitting in front of the driver's eye.
 *
 * Origin is the mount point; the binnacle stands above it and the fascia runs
 * forward, so the part reads correctly from the interior camera.
 */
function buildDashboard(b: MeshBuilder, v: PartVariant): void {
  const id = v.id;
  const dark = flat(0x24262a, 0.85);
  const dial = flat(0xd8d2c4, 0.4);
  const chrome = cond(0xc6ccd2, 0.95, 0.2);
  const wheelMat = flat(0x1b1d20, 0.7);

  let w = 1.32;
  let depth = 0.26;
  let binnacle = true;
  let wheelR = 0.19;
  switch (id) {
    case 'dash_std': w = 1.32; depth = 0.26; wheelR = 0.19; break;
    case 'dash_truck': w = 1.6; depth = 0.32; wheelR = 0.23; break;
    // Flat plastic shelf with a single binnacle: the real 2102 fascia.
    case 'dash_lada': w = 1.36; depth = 0.22; wheelR = 0.185; break;
    // Competition car: bare bulkhead, gauges on a plate, no padding at all.
    case 'dash_rally': w = 1.1; depth = 0.14; binnacle = false; wheelR = 0.16; break;
    default: break;
  }

  b.box(`${id}_fascia`, w, 0.14, depth, dark, [0, 0, -depth / 2]);
  b.box(`${id}_top`, w, 0.035, depth * 0.9, dark, [0, 0.085, -depth / 2]);
  if (binnacle) {
    b.box(`${id}_binnacle`, 0.42, 0.16, 0.14, dark, [-w * 0.22, 0.1, -0.09]);
    b.cylinder(`${id}_dial_big`, 0.07, 0.07, 0.02, 16, dial, [-w * 0.28, 0.1, -0.02], AXIS_Z);
    b.cylinder(`${id}_dial_small`, 0.045, 0.045, 0.02, 14, dial, [-w * 0.13, 0.1, -0.02], AXIS_Z);
  } else {
    b.box(`${id}_gauge_plate`, 0.36, 0.12, 0.02, chrome, [-w * 0.2, 0.09, -0.02]);
    for (let i = 0; i < 3; i++) {
      b.cylinder(`${id}_gauge_${i}`, 0.035, 0.035, 0.018, 12, dial, [-w * 0.2 + (i - 1) * 0.1, 0.09, -0.03], AXIS_Z);
    }
  }
  // Glovebox lid on the passenger side, and the wheel on its column.
  b.box(`${id}_glovebox`, w * 0.3, 0.1, 0.02, dark, [w * 0.26, -0.01, -0.01]);
  b.cylinder(`${id}_column`, 0.022, 0.022, 0.2, 8, dark, [-w * 0.21, 0.02, 0.08], [0.5, 0, 0]);
  b.torus(`${id}_wheel`, wheelR, 0.016, 6, 18, wheelMat, [-w * 0.21, 0.09, 0.16], [1.15, 0, 0]);
}

function buildHood(b: MeshBuilder, v: PartVariant): void {
  const panel = cond(0x9aa3ab, 0.85, 0.4);
  const id = v.id;
  // The estate's bonnet is narrower and longer than the generic lid, and carries
  // the two pressed swages the real one has.
  const w = id === 'hood_truck' ? 1.5 : id === 'hood_lada' ? 1.42 : 1.3;
  const d = id === 'hood_truck' ? 1.35 : id === 'hood_lada' ? 0.88 : 1.0;
  b.box(`${id}_panel`, w, 0.05, d, panel, [0, 0, 0]);
  if (id === 'hood_lada') {
    for (const s of [-1, 1] as const) {
      b.box(`${id}_swage_${s < 0 ? 'l' : 'r'}`, 0.05, 0.018, d * 0.82, panel, [s * 0.3, 0.032, 0]);
    }
  }
}

function buildTrunk(b: MeshBuilder, v: PartVariant): void {
  const panel = cond(0x9aa3ab, 0.85, 0.4);
  if (v.id === 'trunk_lada') {
    // A tailgate, not a boot lid: taller than it is deep, with the glass in it.
    const gls = glass(0xa8ccd4, 0.06);
    const chrome = cond(0xc6ccd2, 0.95, 0.2);
    b.box('trunk_lada_panel', 1.34, 0.3, 0.05, panel, [0, -0.2, 0]);
    b.box('trunk_lada_frame', 1.34, 0.42, 0.04, panel, [0, 0.17, 0]);
    b.box('trunk_lada_glass', 1.2, 0.34, 0.02, gls, [0, 0.17, -0.02]);
    b.box('trunk_lada_handle', 0.16, 0.035, 0.04, chrome, [0, -0.06, -0.04]);
    return;
  }
  b.box(`${v.id}_panel`, 1.25, 0.05, 0.75, panel, [0, 0, 0]);
}

function buildSeat(b: MeshBuilder, v: PartVariant): void {
  const id = v.id;
  const isLada = id === 'seat_lada';
  // Period Soviet vinyl: warmer and shinier than the generic cloth.
  const fabric = isLada ? flat(0x6a5a48, 0.6) : flat(0x3a3f45, 0.9);
  const frame = cond(0x23262a, 0.6, 0.6);
  const w = id === 'seat_bench' ? 1.0 : isLada ? 0.5 : 0.52;

  b.box(`${id}_cushion`, w, 0.12, 0.5, fabric, [0, 0.12, 0.04]);
  b.box(`${id}_back`, w, isLada ? 0.54 : 0.62, 0.12, fabric, [0, isLada ? 0.38 : 0.42, -0.2]);
  if (id === 'seat_bucket') {
    b.box(`${id}_bolster_l`, 0.08, 0.1, 0.5, fabric, [-w / 2 - 0.02, 0.12, 0.04]);
    b.box(`${id}_bolster_r`, 0.08, 0.1, 0.5, fabric, [w / 2 + 0.02, 0.12, 0.04]);
  }
  if (isLada) {
    // Separate headrest on two posts, as on the 2102's front seats.
    b.box(`${id}_headrest`, w * 0.62, 0.11, 0.1, fabric, [0, 0.75, -0.19]);
    for (const s of [-1, 1] as const) {
      b.cylinder(`${id}_post_${s < 0 ? 'l' : 'r'}`, 0.012, 0.012, 0.08, 6, frame, [s * w * 0.2, 0.68, -0.19]);
    }
  }
  b.box(`${id}_rail1`, 0.04, 0.05, 0.5, frame, [-w * 0.35, 0.02, 0]);
  b.box(`${id}_rail2`, 0.04, 0.05, 0.5, frame, [w * 0.35, 0.02, 0]);
}

function buildMirror(b: MeshBuilder, v: PartVariant): void {
  const chrome = cond(0xdadde2, 1.0, 0.12);
  const face = flat(0x9fb6c4, 0.08);

  if (v.id === 'mirror_lada') {
    // The Zhiguli wing mirror is not a round pod on a post: it is a small upright
    // chrome housing, taller than it is wide, on a short cranked arm that stands off
    // the wing. The glass faces rearward (-Z), which the mount's yaw then toes in.
    b.cylinder('mirror_lada_foot', 0.016, 0.02, 0.03, 10, chrome, [0, 0.015, 0]);
    // Cranked arm: up off the wing, then outboard to carry the head clear of the
    // A-pillar so the driver can actually see past it.
    b.cylinder('mirror_lada_arm', 0.011, 0.011, 0.075, 8, chrome, [0, 0.055, 0], [0, 0, 0.35]);
    b.box('mirror_lada_head', 0.035, 0.105, 0.055, chrome, [-0.026, 0.115, 0]);
    b.box('mirror_lada_glass', 0.012, 0.088, 0.042, face, [-0.04, 0.115, -0.006]);
    return;
  }

  b.cylinder(`${v.id}_stalk`, 0.02, 0.02, 0.1, 8, chrome, [0, 0.05, 0]);
  b.torus(`${v.id}_ring`, 0.09, 0.015, 8, 24, chrome, [0, 0.13, 0]);
  b.cylinder(`${v.id}_face`, 0.075, 0.075, 0.012, 20, face, [0, 0.13, 0], AXIS_Z);
}

function buildBumper(b: MeshBuilder, v: PartVariant): void {
  const id = v.id;
  const isLada = id === 'bumper_lada';
  const chrome = cond(0xdadde2, 1.0, 0.12);
  const mat = id === 'bumper_chrome' || isLada ? chrome : cond(0x4a4f55, 0.85, 0.5);
  const w = id === 'bumper_chrome' ? 1.6 : isLada ? 1.5 : 2.0;
  const h = id === 'bumper_chrome' ? 0.12 : isLada ? 0.1 : 0.2;

  b.box(`${id}_bar`, w, h, 0.1, mat, [0, 0, 0]);
  if (id === 'bumper_steel') {
    b.box(`${id}_strut_l`, 0.06, h, 0.3, mat, [-w * 0.4, 0, -0.12]);
    b.box(`${id}_strut_r`, 0.06, h, 0.3, mat, [w * 0.4, 0, -0.12]);
  }
  if (isLada) {
    // Thin chrome blade on two stalks, with the overriders the period car wore.
    for (const s of [-1, 1] as const) {
      const side = s < 0 ? 'l' : 'r';
      b.box(`${id}_stalk_${side}`, 0.05, h * 0.8, 0.16, mat, [s * w * 0.32, 0, -0.1]);
      b.box(`${id}_over_${side}`, 0.07, h * 1.7, 0.12, mat, [s * w * 0.24, 0.01, 0.02]);
    }
  }
}

function buildBattery(b: MeshBuilder, v: PartVariant): void {
  const caseMat = flat(0x23262a, 0.7);
  const terminal = cond(0xb0b4ba, 0.9, 0.3);
  const id = v.id;
  const w = id === 'battery_heavy' ? 0.42 : 0.32;
  const h = id === 'battery_heavy' ? 0.28 : 0.22;
  b.box(`${id}_case`, w, h, 0.2, caseMat, [0, h * 0.5, 0]);
  b.cylinder(`${id}_t1`, 0.025, 0.025, 0.03, 10, terminal, [-w * 0.25, h, -0.05]);
  b.cylinder(`${id}_t2`, 0.025, 0.025, 0.03, 10, terminal, [w * 0.25, h, 0.05]);
}

/**
 * Radiators range from the estate's narrow single-pass unit to a twin-pass copper
 * core. Their origins all remain at the core centre so bonnet slots and previews
 * can exchange classes without changing the established mount placement.
 */
function buildRadiator(b: MeshBuilder, v: PartVariant): void {
  const klass = v.radiator?.klass ?? 'standard';
  const blackenedSteel = cond(0x2c3135, 0.7, 0.6);
  const paintedSteel = cond(0x566068, 0.75, 0.5);
  const copper = cond(0xb87333, 0.9, 0.35);
  const copperTank = cond(0x7f4d2c, 0.85, 0.45);
  const cap = flat(0x2d4b6b, 0.55);
  const id = v.id;

  if (klass === 'small') {
    // The 2102's narrow, single-pass core has fewer exposed cooling rows than the
    // replacement unit, which keeps it recognisable without spending detail on a
    // part that is deliberately the cheap cooling option.
    b.box(`${id}_core`, 0.52, 0.38, 0.05, paintedSteel, [0, 0, 0]);
    b.box(`${id}_top`, 0.52, 0.065, 0.085, blackenedSteel, [0, 0.19, 0]);
    b.box(`${id}_bot`, 0.52, 0.065, 0.085, blackenedSteel, [0, -0.19, 0]);
    for (let i = -1; i <= 2; i++) {
      b.box(`${id}_fin_${i}`, 0.48, 0.035, 0.018, paintedSteel, [0, i * 0.07 - 0.035, 0.034]);
    }
    b.box(`${id}_mount`, 0.30, 0.035, 0.10, blackenedSteel, [0, -0.235, 0]);
    b.cylinder(`${id}_inlet`, 0.038, 0.038, 0.11, 8, blackenedSteel, [-0.16, 0.215, 0.07], AXIS_Z);
    b.cylinder(`${id}_outlet`, 0.038, 0.038, 0.11, 8, blackenedSteel, [0.16, -0.205, 0.07], AXIS_Z);
    b.cylinder(`${id}_fan_mount`, 0.052, 0.052, 0.035, 8, blackenedSteel, [0, 0, -0.055], AXIS_Z);
    b.cylinder(`${id}_neck`, 0.048, 0.048, 0.055, 10, blackenedSteel, [0.16, 0.24, 0]);
    b.cylinder(`${id}_cap`, 0.058, 0.058, 0.03, 10, cap, [0.16, 0.2825, 0]);
    return;
  }

  if (klass === 'large') {
    // Two separated slabs make the thick copper core read as a twin-pass unit from
    // the side; the rear ring leaves the fan's clearance legible at inventory scale.
    b.box(`${id}_core_front`, 0.92, 0.66, 0.055, copper, [0, 0, 0.0425]);
    b.box(`${id}_core_rear`, 0.92, 0.66, 0.055, copperTank, [0, 0, -0.0425]);
    b.box(`${id}_top`, 0.92, 0.10, 0.18, copperTank, [0, 0.33, 0]);
    b.box(`${id}_bot`, 0.92, 0.10, 0.18, copperTank, [0, -0.33, 0]);
    b.box(`${id}_tank_l`, 0.12, 0.60, 0.22, copperTank, [-0.46, 0, 0]);
    b.box(`${id}_tank_r`, 0.12, 0.60, 0.22, copperTank, [0.46, 0, 0]);
    for (let i = 0; i < 10; i++) {
      b.box(`${id}_fin_${i}`, 0.84, 0.035, 0.024, copper, [0, (i / 9 - 0.5) * 0.54, 0.085]);
    }
    b.torus(`${id}_fan_shroud`, 0.19, 0.018, 8, 16, blackenedSteel, [0, 0, -0.095]);
    b.box(`${id}_mount`, 0.50, 0.04, 0.16, copperTank, [0, -0.42, 0]);
    b.cylinder(`${id}_inlet`, 0.055, 0.055, 0.14, 10, copperTank, [-0.30, 0.40, 0.12], AXIS_Z);
    b.cylinder(`${id}_outlet`, 0.055, 0.055, 0.14, 10, copperTank, [0.30, -0.40, 0.12], AXIS_Z);
    b.cylinder(`${id}_fan_mount`, 0.065, 0.065, 0.03, 10, blackenedSteel, [0, 0, -0.125], AXIS_Z);
    b.cylinder(`${id}_neck`, 0.065, 0.065, 0.08, 12, copperTank, [0.30, 0.42, 0]);
    b.cylinder(`${id}_cap`, 0.075, 0.075, 0.04, 12, cap, [0.30, 0.48, 0]);
    return;
  }

  // The standard replacement preserves the original 0.72 x 0.5 x 0.06 core and
  // seven fin rows, while side tanks distinguish it from the smaller single-pass unit.
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

function buildTurbine(b: MeshBuilder, v: PartVariant): void {
  const steel = cond(0x7b838b, 0.9, 0.3);
  const dark = cond(0x34383d, 0.8, 0.5);
  b.cylinder(`${v.id}_compressor`, 0.19, 0.19, 0.18, 20, steel, [0, 0, 0], AXIS_X);
  b.cylinder(`${v.id}_hub`, 0.07, 0.07, 0.22, 16, dark, [0, 0, 0], AXIS_X);
  b.cylinder(`${v.id}_inlet`, 0.09, 0.09, 0.2, 16, steel, [0.18, 0.08, 0], AXIS_Z);
}

function buildHeadlight(b: MeshBuilder, v: PartVariant): void {
  const chrome = cond(0xdadde2, 1.0, 0.12);
  const lens = flat(0xe8e4d8, 0.15);
  b.cylinder(`${v.id}_housing`, 0.1, 0.085, 0.06, 20, chrome, [0, 0, 0], AXIS_Z);
  b.cylinder(`${v.id}_lens`, 0.082, 0.082, 0.02, 20, lens, [0, 0, 0.035], AXIS_Z);
}

function buildExhaust(b: MeshBuilder, v: PartVariant): void {
  const steel = cond(0x6f747a, 0.85, 0.5);

  if (v.id === 'exhaust_lada') {
    // Flat oval silencer rather than the generic fat cylinder. A 0.09 m radius
    // drum hangs 90 mm below its mount, which on a car with 170 mm of clearance
    // put the exhaust lower than the chassis itself and made it scrape on
    // everything. A 70 mm deep box tucks under the floor pan and stays above the
    // collider's underside, which is what the real car's pressed silencer does.
    b.cylinder('exhaust_lada_pipe', 0.028, 0.028, 0.66, 10, steel, [0, 0.01, 0.16], AXIS_Z);
    b.box('exhaust_lada_muffler', 0.17, 0.07, 0.36, steel, [0, 0, -0.3]);
    b.box('exhaust_lada_muffler_end_f', 0.13, 0.055, 0.03, steel, [0, 0, -0.115]);
    b.box('exhaust_lada_muffler_end_r', 0.13, 0.055, 0.03, steel, [0, 0, -0.485]);
    b.cylinder('exhaust_lada_tail', 0.026, 0.026, 0.16, 10, steel, [0, 0.008, -0.56], AXIS_Z);
    return;
  }

  b.cylinder(`${v.id}_pipe`, 0.04, 0.04, 0.7, 12, steel, [0, 0, 0.1], AXIS_Z);
  b.cylinder(`${v.id}_muffler`, 0.09, 0.09, 0.32, 16, steel, [0, 0, -0.35], AXIS_Z);
  b.cylinder(`${v.id}_tail`, 0.035, 0.035, 0.14, 10, steel, [0, 0, -0.55], AXIS_Z);
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

function buildToolInto(b: MeshBuilder, kind: ToolKind): void {
  switch (kind) {
    case 'brush': return brush(b);
    case 'sponge': return sponge(b);
    case 'wrench': return wrench(b);
    default: throw new Error(`unhandled tool kind: ${kind}`);
  }
}

function brush(b: MeshBuilder): void {
  const handle = flat(0x6b4a2e, 0.7);
  const bristle = flat(0x3a3f45, 0.9);
  b.cylinder('brush_handle', 0.02, 0.02, 0.22, 10, handle, [0, 0.02, 0.1], AXIS_Z);
  b.box('brush_head', 0.06, 0.03, 0.14, handle, [0, 0.02, 0.28]);
  b.box('brush_bristles', 0.05, 0.02, 0.12, bristle, [0, -0.01, 0.28]);
}

function sponge(b: MeshBuilder): void {
  const body = flat(0xc9a227, 0.9);
  b.box('sponge_body', 0.14, 0.05, 0.1, body, [0, 0, 0]);
}

function wrench(b: MeshBuilder): void {
  const steel = cond(0x8b9096, 0.9, 0.35);
  b.cylinder('wrench_handle', 0.02, 0.02, 0.24, 10, steel, [0, 0, 0], AXIS_Z);
  b.torus('wrench_end1', 0.05, 0.016, 6, 16, steel, [0, 0, 0.12], ZERO, ONE, Math.PI * 1.2);
  b.torus('wrench_end2', 0.05, 0.016, 6, 16, steel, [0, 0, -0.12], ZERO, ONE, Math.PI * 1.2);
}

/**
 * Colour-codes the can by fluid, the way a workshop shelf does: red petrol, yellow
 * diesel, and the two engine fluids in the colours those bottles actually come in —
 * blue water, dark blue-black oil. It is the only way to tell four identical cans
 * apart at a glance in the inventory strip.
 */
function buildFluidCanInto(b: MeshBuilder, fluid: FluidKind): void {
  const color =
    fluid === 'petrol' ? 0xb03a2e
    : fluid === 'diesel' ? 0xc9a227
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
  const wrapperEdge = flat(0xf08ab0, 0.45);
  const gum = flat(0xf7b0c8, 0.7);

  // A shallow open wrapper with five separate sticks. Each stick has its own named
  // mesh so the held view can remove exactly one at the mouth without rebuilding.
  b.box('bubble_gum_wrapper', 0.2, 0.012, 0.105, wrapper, [0, 0, 0]);
  b.box('bubble_gum_wrapper_left', 0.012, 0.026, 0.105, wrapperEdge, [-0.094, 0.013, 0]);
  b.box('bubble_gum_wrapper_right', 0.012, 0.026, 0.105, wrapperEdge, [0.094, 0.013, 0]);
  for (let i = 0; i < 5; i++) {
    b.box(
      `bubble_gum_piece_${i}`,
      0.03,
      0.024,
      0.078,
      gum,
      [-0.068 + i * 0.034, 0.018, 0],
    );
  }
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

/** A held/carried item mesh. Parts reuse createPartMesh; other items build from primitives. */
export function createItemMesh(item: Item): THREE.Object3D {
  switch (item.type) {
    case 'part':
      return createPartMesh(item.part.variantId);
    case 'tool':
      return buildGroup(itemBlueprint(`tool_${item.tool}`, (b) => buildToolInto(b, item.tool)).instructions);
    case 'fluid_can':
      return buildGroup(
        itemBlueprint(`fluid_${item.fluid}`, (b) => buildFluidCanInto(b, item.fluid)).instructions,
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
    case 'binoculars':
      return buildGroup(itemBlueprint('binoculars', buildBinocularsInto).instructions);
    case 'torchlight':
      return buildGroup(itemBlueprint('torchlight', buildTorchlightInto).instructions);
    case 'sun_shades':
      return buildGroup(
        itemBlueprint(`sun_shades_${item.tint}`, (b) => buildSunShadesInto(b, item.tint)).instructions,
      );
  }
}

/** Releases every cached BufferGeometry. Call on teardown. */
export function disposeMeshCache(): void {
  for (const geometry of geometryCache.values()) geometry.dispose();
  geometryCache.clear();
  blueprintCache.clear();
  itemBlueprintCache.clear();
}
