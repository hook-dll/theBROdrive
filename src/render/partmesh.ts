/**
 * Procedural meshes for every part, body shell and carried item in the game.
 *
 * Everything is built from primitives — no external assets, no textures. Geometry is
 * built once per logical form and cached; each create* call returns a fresh Object3D
 * that shares the cached BufferGeometry but gets its own materials, so every instance
 * can hold independent dirt/rust.
 *
 * Origin conventions (load-bearing for the Vehicle and LoosePartField):
 *  - a part's origin is its slot mount point, in body-local +X right / +Y up / +Z forward;
 *  - a wheel's origin is the wheel centre with the axle along local +X;
 *  - a body's origin is the body centre, matching BodyDef.halfExtents.
 */

import * as THREE from 'three';
import { body, variant } from '../parts/registry';
import type { BodyDef, EngineSpec, PartVariant, WheelSpec } from '../parts/registry';
import type { Item, QuarryItem, ToolKind, WeaponKind } from '../items/items';
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
    this.instructions.push({ geometry: cachedGeo(key, build), material, position, rotation, scale });
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
    case 'headlight': return buildHeadlight(b, v);
    case 'exhaust': return buildExhaust(b, v);
  }
}

// ----------------------------- engines -----------------------------

function buildEngine(b: MeshBuilder, v: PartVariant): void {
  const spec = v.engine as EngineSpec;
  switch (v.id) {
    case 'engine_i4_1600': return buildInline(b, spec, 1.0, false);
    case 'engine_i6_2800': return buildInline(b, spec, 1.12, false);
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

function buildDoor(b: MeshBuilder, v: PartVariant): void {
  const panel = cond(0x9aa3ab, 0.85, 0.4);
  const gls = glass(0xa8ccd4, 0.06);
  const handle = cond(0xdadde2, 1.0, 0.15);
  const id = v.id;
  const w = id === 'door_truck' ? 1.15 : 0.95;
  const h = id === 'door_truck' ? 1.05 : 0.85;
  const d = 0.06;

  // Canonical face is -Z; the slot's ±90° yaw turns it onto the body side.
  b.box(`${id}_panel`, w, h, d, panel, [0, 0, 0]);
  b.box(`${id}_glass`, w * 0.78, h * 0.42, d * 0.4, gls, [0, h * 0.22, -d * 0.45]);
  b.box(`${id}_handle`, 0.16, 0.04, d * 0.8, handle, [w * 0.15, -h * 0.02, -d * 0.6]);
}

function buildHood(b: MeshBuilder, v: PartVariant): void {
  const panel = cond(0x9aa3ab, 0.85, 0.4);
  const id = v.id;
  const w = id === 'hood_truck' ? 1.5 : 1.3;
  const d = id === 'hood_truck' ? 1.35 : 1.0;
  b.box(`${id}_panel`, w, 0.05, d, panel, [0, 0, 0]);
}

function buildTrunk(b: MeshBuilder, v: PartVariant): void {
  const panel = cond(0x9aa3ab, 0.85, 0.4);
  b.box(`${v.id}_panel`, 1.25, 0.05, 0.75, panel, [0, 0, 0]);
}

function buildSeat(b: MeshBuilder, v: PartVariant): void {
  const fabric = flat(0x3a3f45, 0.9);
  const frame = cond(0x23262a, 0.6, 0.6);
  const id = v.id;
  const w = id === 'seat_bench' ? 1.0 : 0.52;

  b.box(`${id}_cushion`, w, 0.12, 0.5, fabric, [0, 0.12, 0.04]);
  b.box(`${id}_back`, w, 0.62, 0.12, fabric, [0, 0.42, -0.2]);
  if (id === 'seat_bucket') {
    b.box(`${id}_bolster_l`, 0.08, 0.1, 0.5, fabric, [-w / 2 - 0.02, 0.12, 0.04]);
    b.box(`${id}_bolster_r`, 0.08, 0.1, 0.5, fabric, [w / 2 + 0.02, 0.12, 0.04]);
  }
  b.box(`${id}_rail1`, 0.04, 0.05, 0.5, frame, [-w * 0.35, 0.02, 0]);
  b.box(`${id}_rail2`, 0.04, 0.05, 0.5, frame, [w * 0.35, 0.02, 0]);
}

function buildMirror(b: MeshBuilder, v: PartVariant): void {
  const chrome = cond(0xdadde2, 1.0, 0.12);
  const face = flat(0x9fb6c4, 0.08);
  b.cylinder(`${v.id}_stalk`, 0.02, 0.02, 0.1, 8, chrome, [0, 0.05, 0]);
  b.torus(`${v.id}_ring`, 0.09, 0.015, 8, 24, chrome, [0, 0.13, 0]);
  b.cylinder(`${v.id}_face`, 0.075, 0.075, 0.012, 20, face, [0, 0.13, 0], AXIS_Z);
}

function buildBumper(b: MeshBuilder, v: PartVariant): void {
  const mat = v.id === 'bumper_chrome' ? cond(0xdadde2, 1.0, 0.12) : cond(0x4a4f55, 0.85, 0.5);
  const id = v.id;
  const w = id === 'bumper_chrome' ? 1.6 : 2.0;
  const h = id === 'bumper_chrome' ? 0.12 : 0.2;
  b.box(`${id}_bar`, w, h, 0.1, mat, [0, 0, 0]);
  if (id === 'bumper_steel') {
    b.box(`${id}_strut_l`, 0.06, h, 0.3, mat, [-w * 0.4, 0, -0.12]);
    b.box(`${id}_strut_r`, 0.06, h, 0.3, mat, [w * 0.4, 0, -0.12]);
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

function buildRadiator(b: MeshBuilder, v: PartVariant): void {
  const copper = cond(0xb87333, 0.9, 0.35);
  const dark = cond(0x23262a, 0.5, 0.7);
  b.box(`${v.id}_core`, 0.72, 0.5, 0.06, copper, [0, 0, 0]);
  b.box(`${v.id}_top`, 0.72, 0.08, 0.1, dark, [0, 0.25, 0]);
  b.box(`${v.id}_bot`, 0.72, 0.08, 0.1, dark, [0, -0.25, 0]);
  for (let i = -3; i <= 3; i++) {
    b.box(`${v.id}_fin_${i}`, 0.68, 0.04, 0.02, copper, [0, i * 0.055, 0.035]);
  }
}

function buildHeadlight(b: MeshBuilder, v: PartVariant): void {
  const chrome = cond(0xdadde2, 1.0, 0.12);
  const lens = flat(0xe8e4d8, 0.15);
  b.cylinder(`${v.id}_housing`, 0.1, 0.085, 0.06, 20, chrome, [0, 0, 0], AXIS_Z);
  b.cylinder(`${v.id}_lens`, 0.082, 0.082, 0.02, 20, lens, [0, 0, 0.035], AXIS_Z);
}

function buildExhaust(b: MeshBuilder, v: PartVariant): void {
  const steel = cond(0x6f747a, 0.85, 0.5);
  b.cylinder(`${v.id}_pipe`, 0.04, 0.04, 0.7, 12, steel, [0, 0, 0.1], AXIS_Z);
  b.cylinder(`${v.id}_muffler`, 0.09, 0.09, 0.32, 16, steel, [0, 0, -0.35], AXIS_Z);
  b.cylinder(`${v.id}_tail`, 0.035, 0.035, 0.14, 10, steel, [0, 0, -0.55], AXIS_Z);
}

// ---------------------------------------------------------------------------
// Body shells
// ---------------------------------------------------------------------------

const bodyBlueprintCache = new Map<string, Blueprint>();

function bodyBlueprint(bd: BodyDef): Blueprint {
  let bp = bodyBlueprintCache.get(bd.id);
  if (bp === undefined) {
    const builder = new MeshBuilder();
    buildBody(builder, bd);
    const instructions = builder.instructions;
    bp = { instructions, halfExtents: halfExtentsOf(instructions) };
    bodyBlueprintCache.set(bd.id, bp);
  }
  return bp;
}

function wheelFloor(bd: BodyDef): number {
  for (const slot of bd.slots) {
    if (slot.id === 'wheel_fl') return slot.pos[1];
  }
  return -0.45;
}

function bodyPaint(id: string): MaterialSpec {
  switch (id) {
    case 'body_sedan': return cond(0x8a3a2e, 0.55, 0.4);
    case 'body_wagon': return cond(0x5a6b4a, 0.55, 0.42);
    case 'body_hatch': return cond(0x9a8a3a, 0.5, 0.42);
    case 'body_pickup': return cond(0x4a5a72, 0.55, 0.4);
    case 'body_bus': return cond(0x7a5230, 0.5, 0.45);
    default: return cond(0x8a8a8a, 0.55, 0.4);
  }
}

/** Fender arches over the four wheel slots, implying the openings. */
function addArches(b: MeshBuilder, bd: BodyDef, floor: number, archR: number, mat: MaterialSpec): void {
  const wx = bd.halfExtents[0] - 0.08;
  const wz = bd.halfExtents[2] - 0.62;
  const spots: ReadonlyArray<readonly [number, number]> = [[-wx, wz], [wx, wz], [-wx, -wz], [wx, -wz]];
  spots.forEach(([x, z], i) => {
    b.torus(`arch_${bd.id}_${i}`, archR, 0.045, 8, 24, mat, [x, floor, z], [0, Math.PI / 2, 0], ONE, Math.PI);
  });
}

function buildBody(b: MeshBuilder, bd: BodyDef): void {
  switch (bd.id) {
    case 'body_sedan': return sedan(b, bd);
    case 'body_wagon': return wagon(b, bd);
    case 'body_hatch': return hatch(b, bd);
    case 'body_pickup': return pickup(b, bd);
    case 'body_bus': return bus(b, bd);
    default: throw new Error(`unknown body: ${bd.id}`);
  }
}

function sedan(b: MeshBuilder, bd: BodyDef): void {
  const hx = bd.halfExtents[0];
  const roof = bd.halfExtents[1];
  const hz = bd.halfExtents[2];
  const floor = wheelFloor(bd);
  const paint = bodyPaint(bd.id);
  const inner = cond(0x2e3236, 0.6, 0.7);
  const gls = glass(0xa8ccd4, 0.06);
  const belt = 0.0;
  const w = hx * 2;

  b.box('sedan_floor', w - 0.12, 0.06, hz * 2 - 0.2, inner, [0, floor + 0.03, 0]);
  b.box('sedan_firewall', w - 0.16, belt - floor, 0.05, inner, [0, (floor + belt) / 2, hz - 0.95]);
  b.box('sedan_sill_l', 0.08, belt - floor, hz * 2 - 0.5, paint, [-hx + 0.04, (floor + belt) / 2, 0]);
  b.box('sedan_sill_r', 0.08, belt - floor, hz * 2 - 0.5, paint, [hx - 0.04, (floor + belt) / 2, 0]);
  b.box('sedan_hooddeck', w - 0.2, 0.06, 0.55, paint, [0, 0.06, hz - 0.6]);
  b.box('sedan_trunkdeck', w - 0.2, 0.12, 0.6, paint, [0, 0.1, -hz + 0.45]);

  // greenhouse: short, between the hood and trunk decks
  greenhouse(b, 'sedan', w - 0.22, belt, roof, 0.62, -0.62, paint, gls);
  addArches(b, bd, floor, 0.42, paint);
}

function wagon(b: MeshBuilder, bd: BodyDef): void {
  const hx = bd.halfExtents[0];
  const roof = bd.halfExtents[1];
  const hz = bd.halfExtents[2];
  const floor = wheelFloor(bd);
  const paint = bodyPaint(bd.id);
  const inner = cond(0x2e3236, 0.6, 0.7);
  const gls = glass(0xa8ccd4, 0.06);
  const belt = 0.0;
  const w = hx * 2;

  b.box('wagon_floor', w - 0.12, 0.06, hz * 2 - 0.2, inner, [0, floor + 0.03, 0]);
  b.box('wagon_firewall', w - 0.16, belt - floor, 0.05, inner, [0, (floor + belt) / 2, hz - 1.0]);
  b.box('wagon_sill_l', 0.08, belt - floor, hz * 2 - 0.5, paint, [-hx + 0.04, (floor + belt) / 2, 0]);
  b.box('wagon_sill_r', 0.08, belt - floor, hz * 2 - 0.5, paint, [hx - 0.04, (floor + belt) / 2, 0]);
  b.box('wagon_hooddeck', w - 0.2, 0.06, 0.55, paint, [0, 0.06, hz - 0.6]);

  // long greenhouse running nearly to the tail
  greenhouse(b, 'wagon', w - 0.22, belt, roof, 0.7, -hz + 0.6, paint, gls);
  addArches(b, bd, floor, 0.44, paint);
}

function hatch(b: MeshBuilder, bd: BodyDef): void {
  const hx = bd.halfExtents[0];
  const roof = bd.halfExtents[1];
  const hz = bd.halfExtents[2];
  const floor = wheelFloor(bd);
  const paint = bodyPaint(bd.id);
  const inner = cond(0x2e3236, 0.6, 0.7);
  const gls = glass(0xa8ccd4, 0.06);
  const belt = 0.0;
  const w = hx * 2;

  b.box('hatch_floor', w - 0.12, 0.06, hz * 2 - 0.2, inner, [0, floor + 0.03, 0]);
  b.box('hatch_firewall', w - 0.16, belt - floor, 0.05, inner, [0, (floor + belt) / 2, hz - 0.85]);
  b.box('hatch_sill_l', 0.08, belt - floor, hz * 2 - 0.5, paint, [-hx + 0.04, (floor + belt) / 2, 0]);
  b.box('hatch_sill_r', 0.08, belt - floor, hz * 2 - 0.5, paint, [hx - 0.04, (floor + belt) / 2, 0]);
  b.box('hatch_hooddeck', w - 0.2, 0.06, 0.45, paint, [0, 0.06, hz - 0.5]);

  // short, tall greenhouse with a steep rear hatch
  greenhouse(b, 'hatch', w - 0.22, belt, roof, 0.6, -hz + 0.55, paint, gls);
  addArches(b, bd, floor, 0.4, paint);
}

function pickup(b: MeshBuilder, bd: BodyDef): void {
  const hx = bd.halfExtents[0];
  const roof = bd.halfExtents[1];
  const hz = bd.halfExtents[2];
  const floor = wheelFloor(bd);
  const paint = bodyPaint(bd.id);
  const inner = cond(0x2e3236, 0.6, 0.7);
  const gls = glass(0xa8ccd4, 0.06);
  const belt = 0.1;
  const w = hx * 2;

  // cab occupies the front ~40%; the bed is open behind it
  const cabZ = hz * 0.45;
  b.box('pickup_floor', w - 0.12, 0.08, hz * 2 - 0.2, inner, [0, floor + 0.04, 0]);
  b.box('pickup_firewall', w - 0.16, belt - floor, 0.05, inner, [0, (floor + belt) / 2, cabZ + 0.25]);
  b.box('pickup_backwall', w - 0.16, belt - floor, 0.05, inner, [0, (floor + belt) / 2, cabZ - 0.6]);
  b.box('pickup_sill_l', 0.1, belt - floor, hz * 2 - 0.5, paint, [-hx + 0.05, (floor + belt) / 2, 0]);
  b.box('pickup_sill_r', 0.1, belt - floor, hz * 2 - 0.5, paint, [hx - 0.05, (floor + belt) / 2, 0]);
  b.box('pickup_hooddeck', w - 0.24, 0.1, 1.0, paint, [0, belt + 0.06, cabZ + 0.65]);

  // cab greenhouse over the front half
  greenhouse(b, 'pickup', w - 0.24, belt, roof, cabZ + 0.25, cabZ - 0.6, paint, gls);

  // open bed: floor + side walls + tailgate (no roof)
  b.box('pickup_bed', w - 0.24, 0.06, hz * 2 - cabZ * 2 - 0.4, inner, [0, floor + 0.12, -cabZ - 0.2]);
  b.box('pickup_bed_l', 0.08, 0.4, hz * 2 - cabZ * 2 - 0.4, paint, [-hx + 0.05, floor + 0.32, -cabZ - 0.2]);
  b.box('pickup_bed_r', 0.08, 0.4, hz * 2 - cabZ * 2 - 0.4, paint, [hx - 0.05, floor + 0.32, -cabZ - 0.2]);
  b.box('pickup_tailgate', w - 0.24, 0.4, 0.06, paint, [0, floor + 0.32, -hz + 0.06]);

  addArches(b, bd, floor, 0.55, paint);
}

function bus(b: MeshBuilder, bd: BodyDef): void {
  const hx = bd.halfExtents[0];
  const roof = bd.halfExtents[1];
  const hz = bd.halfExtents[2];
  const floor = wheelFloor(bd);
  const paint = bodyPaint(bd.id);
  const inner = cond(0x2e3236, 0.6, 0.7);
  const gls = glass(0xa8ccd4, 0.06);
  const belt = 0.35;
  const w = hx * 2;

  b.box('bus_floor', w - 0.16, 0.1, hz * 2 - 0.3, inner, [0, floor + 0.05, 0]);
  b.box('bus_firewall', w - 0.2, belt - floor, 0.08, inner, [0, (floor + belt) / 2, hz - 0.6]);
  b.box('bus_sill_l', 0.1, belt - floor, hz * 2 - 0.5, paint, [-hx + 0.05, (floor + belt) / 2, 0]);
  b.box('bus_sill_r', 0.1, belt - floor, hz * 2 - 0.5, paint, [hx - 0.05, (floor + belt) / 2, 0]);

  // long, tall greenhouse with a pillar every ~1.3 m
  const gz = hz * 2 - 1.2;
  const mid = 0;
  b.box('bus_roof', w - 0.16, 0.06, gz, paint, [0, roof - 0.03, mid]);
  const px = w / 2 - 0.06;
  b.box('bus_glass_l', 0.03, roof - belt - 0.05, gz - 0.08, gls, [-px, (belt + roof) / 2, mid]);
  b.box('bus_glass_r', 0.03, roof - belt - 0.05, gz - 0.08, gls, [px, (belt + roof) / 2, mid]);
  const pillars = 6;
  for (let i = 0; i <= pillars; i++) {
    const z = (i / pillars - 0.5) * gz;
    b.box(`bus_pillar_l_${i}`, 0.08, roof - belt, 0.08, paint, [-px, (belt + roof) / 2, z]);
    b.box(`bus_pillar_r_${i}`, 0.08, roof - belt, 0.08, paint, [px, (belt + roof) / 2, z]);
  }
  b.box('bus_windshield', w - 0.2, roof - belt - 0.05, 0.04, gls, [0, (belt + roof) / 2, gz / 2]);

  addArches(b, bd, floor, 0.62, paint);
}

/** Cabin greenhouse: roof, four pillars and glass, between belt and roof. */
function greenhouse(
  b: MeshBuilder,
  id: string,
  w: number,
  belt: number,
  roof: number,
  zFront: number,
  zRear: number,
  paint: MaterialSpec,
  gls: MaterialSpec,
): void {
  const h = roof - belt;
  const mid = (zFront + zRear) / 2;
  const depth = zFront - zRear;
  const px = w / 2 - 0.05;

  b.box(`${id}_roof`, w, 0.05, depth, paint, [0, roof - 0.03, mid]);
  b.box(`${id}_pl`, 0.08, h, 0.08, paint, [-px, (belt + roof) / 2, zRear]);
  b.box(`${id}_pr`, 0.08, h, 0.08, paint, [px, (belt + roof) / 2, zRear]);
  b.box(`${id}_al`, 0.08, h, 0.08, paint, [-px, (belt + roof) / 2, zFront]);
  b.box(`${id}_ar`, 0.08, h, 0.08, paint, [px, (belt + roof) / 2, zFront]);
  b.box(`${id}_glassl`, 0.03, h - 0.06, depth, gls, [-px, (belt + roof) / 2, mid]);
  b.box(`${id}_glassr`, 0.03, h - 0.06, depth, gls, [px, (belt + roof) / 2, mid]);
  b.box(`${id}_windshield`, w - 0.12, h - 0.06, 0.03, gls, [0, (belt + roof) / 2, zFront + 0.01]);
  b.box(`${id}_rearwin`, w - 0.12, h - 0.06, 0.03, gls, [0, (belt + roof) / 2, zRear - 0.01]);
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

function buildFuelCanInto(b: MeshBuilder, fuel: 'petrol' | 'diesel'): void {
  const color = fuel === 'petrol' ? 0xb03a2e : 0xc9a227;
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** A fresh Object3D for a part variant, sharing cached geometry, origin at the mount point. */
export function createPartMesh(variantId: string): THREE.Object3D {
  return buildGroup(blueprint(variantId).instructions);
}

/** The bare body shell, origin at the body centre. */
export function createBodyMesh(bodyId: string): THREE.Object3D {
  return buildGroup(bodyBlueprint(body(bodyId)).instructions);
}

/** Collider half-extents for a part, derived from its built geometry's bounds. */
export function partHalfExtents(variantId: string): { x: number; y: number; z: number } {
  return blueprint(variantId).halfExtents;
}

/** A held/carried item mesh. Parts reuse createPartMesh; other items build from primitives. */
export function createItemMesh(item: Item): THREE.Object3D {
  switch (item.type) {
    case 'part':
      return createPartMesh(item.part.variantId);
    case 'tool':
      return buildGroup(itemBlueprint(`tool_${item.tool}`, (b) => buildToolInto(b, item.tool)).instructions);
    case 'fuel_can':
      return buildGroup(itemBlueprint(`fuel_${item.fuel}`, (b) => buildFuelCanInto(b, item.fuel)).instructions);
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
  }
}

/** Releases every cached BufferGeometry. Call on teardown. */
export function disposeMeshCache(): void {
  for (const geometry of geometryCache.values()) geometry.dispose();
  geometryCache.clear();
  blueprintCache.clear();
  bodyBlueprintCache.clear();
  itemBlueprintCache.clear();
}
