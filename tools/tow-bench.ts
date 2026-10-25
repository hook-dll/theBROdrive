/**
 * tools/tow-bench.ts
 *
 * Headless bench for the car-to-car tow bar (contract kind towing,
 * src/vehicle/cartow.ts).
 *
 *   bun tools/tow-bench.ts            every pair, every manoeuvre
 *   bun tools/tow-bench.ts kit_vaz2101 kit_vaz2110
 *
 * Nothing here is part of the game bundle, and nothing is a re-implementation: the
 * bar is the shipped `CarTowField`, the cars are the shipped `Vehicle`, and the towed
 * car has its engine taken out exactly as the contract spawns it (contracts/world.ts).
 *
 * The tower is driven by a pure-pursuit follower on a path laid out the way the road
 * lays its corners (world/roadcurve.ts: an 85 m tightest radius, entered and left on a
 * spiral), so what is measured is the rig, not a driver yanking the wheel:
 *
 *   kick       65 km/h on a straight, a 0.3 s pulse of 1 degree, then hands steady: the
 *              articulation's peaks 1-3 s and 6-8 s after it (a snake grows, a stable
 *              rig decays) and the towed car's widest swing off the line.
 *   bend       the road's tightest corner, R 85 m and 50 degrees, at 60 and 70 km/h (and
 *              the tower alone at 70, for scale), a 140 m sweeper at 70 and the 85 m on
 *              gravel at 50: the tower's worst distance off the line, the towed car's,
 *              the widest articulation and the hardest bar force.
 *   hairpin    a 30 m radius at 40 km/h, tighter than any road corner.
 *   brake      60 km/h to rest at full pedal on the straight: stopping distance, bar
 *              force, articulation (a jackknife is the articulation running away).
 *   brakebend  the same pedal half way round the R 85 corner from 60 km/h.
 *   rest       standing coupled on the pedal: what either body still moves.
 *   reverse    backing up 8 m at a walk with the wheel straight: allowed to be awkward,
 *              not allowed to fold or explode.
 *   snag       the towed car held while the tower drives off: the bar must SNAP.
 *   rope       the same pair on a 5 m rope with nobody in the towed car: why the bar.
 *
 *   SWEEP=1 bun tools/tow-bench.ts     the R 85 m corner from 60 to 68 km/h: where the
 *                                      rig lets go.
 *
 * BAR FORCE is read off the towed car alone: its momentum change over a step less every
 * impulse its own wheels, suspension and aerodynamics applied (the chassis' impulse
 * calls are counted), horizontal part only. Rapier exposes no joint force, and this is
 * the force the bar actually had to deliver, the post-step correction included.
 */

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { emptyInput, type InputFrame } from '../src/core/input';
import { FIXED_DT, PhysicsWorld } from '../src/core/physics';
import { SurfaceType } from '../src/core/surfaces';
import { GameWorld, newWorldState } from '../src/game/state';
import { benchCarState } from './benchcar';
import { addGround } from './handling-bench';
import { installAssetShim } from './assetshim';
import { installDocumentShim } from './domshim';
import { carModelMeasure, preloadCarModels } from '../src/render/carmodel';
import { CarTowField, towEyeWorld } from '../src/vehicle/cartow';
import { Vehicle } from '../src/vehicle/vehicle';
import { carModel } from '../src/vehicle/carmodels';
import { WorldOrigin } from '../src/world/origin';
import { encodeSaveCode, decodeSaveCode } from '../src/save/save';
import type { WorldState } from '../src/game/state';

// Building a Vehicle paints the sticker atlas, which needs a canvas.
installDocumentShim();
installAssetShim();

/** Oka to UAZ, each towing a car of about its own mass. */
const PAIRS: readonly (readonly [string, string])[] =
  process.argv.length >= 4
    ? [[process.argv[2]!, process.argv[3]!]]
    : [
        ['kit_vaz1111', 'kit_vaz1111'],
        ['kit_vaz2101', 'kit_vaz2110'],
        ['kit_uaz469', 'kit_gaz24'],
      ];
const KMH = 1 / 3.6;
const DEG = 180 / Math.PI;

// ---------------------------------------------------------------------------
// the path: a curvature profile integrated into a polyline

interface Path {
  x: Float64Array;
  z: Float64Array;
  yaw: Float64Array;
  step: number;
}

/**
 * A straight lead-in, a spiral into a constant radius, the arc, a spiral out and a
 * straight run-out. Heading 0 is +Z; a positive curvature turns left (+X), which is the
 * direction a positive yaw rate turns the cars.
 */
function cornerPath(leadM: number, radiusM: number, turnDeg: number, spiralM: number): Path {
  const step = 0.25;
  const turn = turnDeg / DEG;
  const k = 1 / radiusM;
  // A spiral turns half as much as an arc of its length.
  const arcM = Math.max(0, (turn - k * spiralM) / k);
  const total = leadM + 2 * spiralM + arcM + 600;
  const n = Math.ceil(total / step);
  const x = new Float64Array(n);
  const z = new Float64Array(n);
  const yaw = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const s = i * step;
    let kappa = 0;
    if (s > leadM && s <= leadM + spiralM) kappa = (k * (s - leadM)) / spiralM;
    else if (s > leadM + spiralM && s <= leadM + spiralM + arcM) kappa = k;
    else if (s > leadM + spiralM + arcM && s <= leadM + 2 * spiralM + arcM) {
      kappa = k * (1 - (s - leadM - spiralM - arcM) / spiralM);
    }
    yaw[i] = yaw[i - 1]! + kappa * step;
    x[i] = x[i - 1]! + Math.sin(yaw[i]!) * step;
    z[i] = z[i - 1]! + Math.cos(yaw[i]!) * step;
  }
  return { x, z, yaw, step };
}

/** Nearest path index to a point, searched forward of a hint. */
function nearest(path: Path, px: number, pz: number, hint: number): number {
  let best = hint;
  let bestD = Infinity;
  const from = Math.max(0, hint - 40);
  const to = Math.min(path.x.length - 1, hint + 400);
  for (let i = from; i <= to; i++) {
    const d = (path.x[i]! - px) ** 2 + (path.z[i]! - pz) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Signed distance of a point from the path at index `i`, positive to the path's left. */
function lateralOf(path: Path, i: number, px: number, pz: number): number {
  const yaw = path.yaw[i]!;
  return (px - path.x[i]!) * Math.cos(yaw) - (pz - path.z[i]!) * Math.sin(yaw);
}

function yawOf(q: { x: number; y: number; z: number; w: number }): number {
  return Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
}

function wrapPi(a: number): number {
  let v = a;
  while (v > Math.PI) v -= 2 * Math.PI;
  while (v < -Math.PI) v += 2 * Math.PI;
  return v;
}

function speedOf(v: Vehicle): number {
  const l = v.chassis.linvel();
  return Math.hypot(l.x, l.z);
}

/** Body-local point to world, Rapier's frame. */
function worldPoint(v: Vehicle, local: { x: number; y: number; z: number }): THREE.Vector3 {
  const t = v.chassis.translation();
  const r = v.chassis.rotation();
  return new THREE.Vector3(local.x, local.y, local.z)
    .applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w))
    .add(new THREE.Vector3(t.x, t.y, t.z));
}

function axleZ(v: Vehicle, front: boolean): number {
  let sum = 0;
  let n = 0;
  for (const w of v.modelMeasure.wheels) {
    if (w.isFront !== front) continue;
    sum += w.pos[2];
    n++;
  }
  return n > 0 ? sum / n : 0;
}

// ---------------------------------------------------------------------------
// the rig

interface TowRig {
  physics: PhysicsWorld;
  world: GameWorld;
  tower: Vehicle;
  towed: Vehicle;
  field: CarTowField;
  input: InputFrame;
  path: Path;
  hint: number;
  /** Horizontal impulse the towed car's own code applied this step, N·s. */
  ownX: number;
  ownZ: number;
  prevVx: number;
  prevVz: number;
  /** Horizontal bar force of the last step, N. */
  barN: number;
  broke: boolean;
  /** The `rope` comparison only: a 5 m rope instead of the shipped bar. */
  rope: RAPIER.ImpulseJoint | null;
  /** The rope-towed car's own controls: nobody at the wheel, nobody on the pedal. */
  towedInput: InputFrame;
}

/** Rope length, m: the middle of the law's 4-6 m (ПДД РФ 20.3). */
const ROPE_M = 5;

async function makeTowRig(
  towerModel: string,
  towedModel: string,
  path: Path,
  surface = SurfaceType.Asphalt,
  coupling: 'bar' | 'rope' | 'solo' = 'bar',
): Promise<TowRig> {
  const physics = await PhysicsWorld.create();
  addGround(physics, surface);
  const world = new GameWorld(newWorldState(7));
  const scene = new THREE.Scene();
  const origin = new WorldOrigin();
  const gap = carModelMeasure(towerModel).halfExtents[2] + carModelMeasure(towedModel).halfExtents[2] + 1.2;
  const towerState = benchCarState(towerModel, { id: 'tower', z: 0 });
  const towedState = benchCarState(towedModel, { id: 'towed', z: -gap });
  // The contract's broken car: no engine in the bay, as contracts/world.ts spawns it.
  towedState.bonnet[0] = null;
  world.state.cars.tower = towerState;
  world.state.cars.towed = towedState;
  const vehicles = new Map<string, Vehicle>();
  const tower = new Vehicle(physics, world, towerState, scene, origin);
  const towed = new Vehicle(physics, world, towedState, scene, origin);
  vehicles.set('tower', tower);
  vehicles.set('towed', towed);
  const rig: TowRig = {
    physics,
    world,
    tower,
    towed,
    field: null as unknown as CarTowField,
    input: emptyInput(),
    path,
    hint: 0,
    ownX: 0,
    ownZ: 0,
    prevVx: 0,
    prevVz: 0,
    barN: 0,
    broke: false,
    rope: null,
    towedInput: emptyInput(),
  };
  rig.field = new CarTowField(
    physics,
    world,
    scene,
    origin,
    (carId) => vehicles.get(carId) ?? null,
    () => {
      rig.broke = true;
    },
  );
  // Count what the towed car's own code pushes it with, so the rest is the bar.
  const body = towed.chassis;
  const applyImpulse = body.applyImpulse.bind(body);
  const applyImpulseAtPoint = body.applyImpulseAtPoint.bind(body);
  body.applyImpulse = (impulse: RAPIER.Vector, wake: boolean): void => {
    rig.ownX += impulse.x;
    rig.ownZ += impulse.z;
    applyImpulse(impulse, wake);
  };
  body.applyImpulseAtPoint = (impulse: RAPIER.Vector, point: RAPIER.Vector, wake: boolean): void => {
    rig.ownX += impulse.x;
    rig.ownZ += impulse.z;
    applyImpulseAtPoint(impulse, point, wake);
  };

  // Both settle onto their springs before coupling.
  const input = rig.input;
  input.autoShift = true;
  input.brake = 1;
  for (let i = 0; i < 240; i++) {
    tower.fixedUpdate(FIXED_DT, input);
    towed.fixedUpdate(FIXED_DT, input);
    physics.step();
    tower.postStep();
    towed.postStep();
  }
  input.brake = 0;
  if (coupling === 'bar') {
    rig.field.hitch(tower, 'tower', towed, 'towed');
  } else if (coupling === 'rope') {
    // Bumper eye to bumper eye, the rope as long as the law asks; the towed car's
    // wheel is let go (`analog` at 0 is hands off: its own castor swings it).
    const towerEye = { x: 0, y: 0, z: -tower.modelMeasure.halfExtents[2] };
    const towedEye = { x: 0, y: 0, z: towed.modelMeasure.halfExtents[2] };
    rig.rope = physics.world.createImpulseJoint(
      physics.rapier.JointData.rope(ROPE_M, towerEye, towedEye),
      tower.chassis,
      towed.chassis,
      true,
    );
    rig.rope.setContactsEnabled(true);
    rig.towedInput.steerMode = 'analog';
  }
  const v = towed.chassis.linvel();
  rig.prevVx = v.x;
  rig.prevVz = v.z;
  return rig;
}

/**
 * One fixed step in the game's own order (main.ts): the tower's controls, the bar's
 * step for the towed car, the solve, the bar's correction, the latches.
 */
function step(rig: TowRig, control: (rig: TowRig) => void, afterSolve?: (rig: TowRig) => void): void {
  control(rig);
  rig.tower.fixedUpdate(FIXED_DT, rig.input);
  rig.ownX = 0;
  rig.ownZ = 0;
  if (rig.rope) rig.towed.fixedUpdate(FIXED_DT, rig.towedInput);
  else rig.field.fixedUpdate(FIXED_DT, (carId) => (carId === 'tower' ? rig.tower.brakeCommand : 0));
  rig.physics.step();
  afterSolve?.(rig);
  rig.field.postStep(FIXED_DT);
  rig.tower.postStep();
  rig.towed.postStep();
  const v = rig.towed.chassis.linvel();
  const m = rig.towed.chassis.mass();
  rig.barN = rig.field.isTowed('towed') || rig.rope
    ? Math.hypot(m * (v.x - rig.prevVx) - rig.ownX, m * (v.z - rig.prevVz) - rig.ownZ) / FIXED_DT
    : 0;
  rig.prevVx = v.x;
  rig.prevVz = v.z;
}

/** Pure pursuit on the path at a target speed; `pedal` overrides the speed control. */
function follow(targetMps: number, pedal: number | null = null, kickRad = 0): (rig: TowRig) => void {
  return (rig) => {
    const t = rig.tower.chassis.translation();
    const yaw = yawOf(rig.tower.chassis.rotation());
    const v = speedOf(rig.tower);
    rig.hint = nearest(rig.path, t.x, t.z, rig.hint);
    const wheelbase = rig.tower.modelDef.factory.wheelbase;
    const lookM = Math.max(6, 0.9 * v);
    const ahead = Math.min(rig.path.x.length - 1, rig.hint + Math.round(lookM / rig.path.step));
    const dx = rig.path.x[ahead]! - t.x;
    const dz = rig.path.z[ahead]! - t.z;
    const alpha = wrapPi(Math.atan2(dx, dz) - yaw);
    const want = Math.atan((2 * wheelbase * Math.sin(alpha)) / Math.hypot(dx, dz)) + kickRad;
    rig.input.steer = rig.tower.steeringInputForWheelAngle(want);
    rig.input.steerMode = 'direct';
    rig.input.reverse = false;
    rig.input.handbrake = false;
    if (pedal !== null) {
      rig.input.throttle = 0;
      rig.input.brake = pedal;
      return;
    }
    const dv = targetMps - v;
    rig.input.throttle = Math.max(0, Math.min(1, dv * 0.5));
    rig.input.brake = dv < -1 ? Math.max(0, Math.min(1, -dv * 0.3)) : 0;
  };
}

/** Articulation, the towed car's heading off the tower's, degrees. */
function articulation(rig: TowRig): number {
  return wrapPi(yawOf(rig.tower.chassis.rotation()) - yawOf(rig.towed.chassis.rotation())) * DEG;
}

function finiteRig(rig: TowRig): boolean {
  for (const body of [rig.tower.chassis, rig.towed.chassis]) {
    const t = body.translation();
    const l = body.linvel();
    if (!Number.isFinite(t.x + t.y + t.z + l.x + l.y + l.z)) return false;
  }
  return true;
}

/** Accelerates on the path's lead-in to `mps`, then holds it for `holdS`. */
function runUp(rig: TowRig, mps: number, holdS: number): void {
  const control = follow(mps);
  for (let i = 0; i < 60 / FIXED_DT && speedOf(rig.tower) < mps - 0.3; i++) step(rig, control);
  for (let i = 0; i < holdS / FIXED_DT; i++) step(rig, control);
}

interface Track {
  towerOff: number;
  towedOff: number;
  artic: number;
  barN: number;
}

function newTrack(): Track {
  return { towerOff: 0, towedOff: 0, artic: 0, barN: 0 };
}

/** Folds this step into the running worst figures. */
function track(rig: TowRig, into: Track): void {
  const t = rig.tower.chassis.translation();
  const hint = nearest(rig.path, t.x, t.z, rig.hint);
  into.towerOff = Math.max(into.towerOff, Math.abs(lateralOf(rig.path, hint, t.x, t.z)));
  const rear = worldPoint(rig.towed, { x: 0, y: 0, z: axleZ(rig.towed, false) });
  const towedHint = nearest(rig.path, rear.x, rear.z, Math.max(0, hint - 60));
  into.towedOff = Math.max(into.towedOff, Math.abs(lateralOf(rig.path, towedHint, rear.x, rear.z)));
  into.artic = Math.max(into.artic, Math.abs(articulation(rig)));
  into.barN = Math.max(into.barN, rig.barN);
}

function status(rig: TowRig): string {
  if (!finiteRig(rig)) return 'NON-FINITE';
  if (rig.rope) return 'rope';
  if (rig.broke || !rig.field.isTowed('towed')) return 'bar broke';
  return 'coupled';
}

const fmt = (n: number, d = 2): string => n.toFixed(d);

// ---------------------------------------------------------------------------
// manoeuvres

async function kick(tower: string, towed: string): Promise<string> {
  const rig = await makeTowRig(tower, towed, cornerPath(5000, 85, 1, 10));
  runUp(rig, 65 * KMH, 4);
  const control = follow(65 * KMH);
  const pulse = follow(65 * KMH, null, 1 / DEG);
  let early = 0;
  let late = 0;
  const all = newTrack();
  for (let i = 0; i < 10 / FIXED_DT; i++) {
    const t = i * FIXED_DT;
    step(rig, t < 0.3 ? pulse : control);
    track(rig, all);
    const a = Math.abs(articulation(rig));
    if (t >= 1 && t < 3) early = Math.max(early, a);
    if (t >= 6 && t < 8) late = Math.max(late, a);
  }
  return (
    `kick 65 km/h   artic peak 1-3 s ${fmt(early)}°  6-8 s ${fmt(late)}°` +
    `  towed swing ${fmt(all.towedOff)} m  bar ${fmt(all.barN, 0)} N  ${status(rig)}`
  );
}

async function bend(
  tower: string,
  towed: string,
  label: string,
  radius: number,
  turnDeg: number,
  kmh: number,
  surface: SurfaceType,
  coupling: 'bar' | 'solo' = 'bar',
): Promise<string> {
  const lead = 250;
  const rig = await makeTowRig(tower, towed, cornerPath(lead, radius, turnDeg, 35), surface, coupling);
  // Up to speed on the lead-in, then measured from the spiral to well past the exit.
  const control = follow(kmh * KMH);
  while (rig.hint * rig.path.step < lead - 30 && (coupling === 'solo' || rig.field.isTowed('towed'))) step(rig, control);
  const worst = newTrack();
  const enter = speedOf(rig.tower) / KMH;
  const exitS = lead + 70 + (turnDeg / DEG) * radius + 60;
  for (let i = 0; i < 40 / FIXED_DT && rig.hint * rig.path.step < exitS && (coupling === 'solo' || rig.field.isTowed('towed')); i++) {
    step(rig, control);
    track(rig, worst);
  }
  if (coupling === 'solo') {
    return `${label.padEnd(14)} in at ${fmt(enter, 0)} km/h  tower alone, off line ${fmt(worst.towerOff)} m`;
  }
  return (
    `${label.padEnd(14)} in at ${fmt(enter, 0)} km/h  tower off line ${fmt(worst.towerOff)} m` +
    `  towed ${fmt(worst.towedOff)} m  artic ${fmt(worst.artic, 1)}°  bar ${fmt(worst.barN, 0)} N  ${status(rig)}`
  );
}

async function brake(tower: string, towed: string, inBend: boolean): Promise<string> {
  const lead = inBend ? 250 : 5000;
  const rig = await makeTowRig(tower, towed, cornerPath(lead, 85, 50, 35));
  const control = follow(60 * KMH);
  if (inBend) {
    // Into the corner and half way round it.
    const brakeAt = lead + 35 + 25;
    while (rig.hint * rig.path.step < brakeAt && rig.field.isTowed('towed')) step(rig, control);
  } else {
    runUp(rig, 60 * KMH, 3);
  }
  const from = speedOf(rig.tower) / KMH;
  const start = rig.tower.chassis.translation();
  const worst = newTrack();
  const pedal = follow(0, 1);
  let seconds = 0;
  for (let i = 0; i < 20 / FIXED_DT && speedOf(rig.tower) > 0.2; i++) {
    step(rig, pedal);
    track(rig, worst);
    seconds += FIXED_DT;
  }
  const end = rig.tower.chassis.translation();
  return (
    `${(inBend ? 'brake in bend' : 'brake').padEnd(14)} from ${fmt(from, 0)} km/h: ${fmt(Math.hypot(end.x - start.x, end.z - start.z), 1)} m` +
    ` in ${fmt(seconds, 1)} s  artic ${fmt(worst.artic, 1)}°  bar ${fmt(worst.barN, 0)} N` +
    (inBend ? `  tower off line ${fmt(worst.towerOff)} m` : '') +
    `  ${status(rig)}`
  );
}

/**
 * Standing coupled for 10 s on the tower's pedal, as at a junction: the worst ground
 * speed either body still has over the last 8 s. A coupling that jitters shows here.
 */
async function rest(tower: string, towed: string): Promise<string> {
  const rig = await makeTowRig(tower, towed, cornerPath(5000, 85, 1, 10));
  let towerMps = 0;
  let towedMps = 0;
  let spin = 0;
  const hold = follow(0, 1);
  for (let i = 0; i < 10 / FIXED_DT; i++) {
    step(rig, hold);
    if (i * FIXED_DT < 2) continue;
    towerMps = Math.max(towerMps, speedOf(rig.tower));
    towedMps = Math.max(towedMps, speedOf(rig.towed));
    const w = rig.towed.chassis.angvel();
    spin = Math.max(spin, Math.hypot(w.x, w.y, w.z));
  }
  return (
    `rest 10 s      worst speed tower ${fmt(towerMps * 1000, 1)} mm/s  towed ${fmt(towedMps * 1000, 1)} mm/s` +
    `  towed spin ${fmt(spin * DEG, 2)}°/s  ${status(rig)}`
  );
}

async function reverse(tower: string, towed: string): Promise<string> {
  const rig = await makeTowRig(tower, towed, cornerPath(5000, 85, 1, 10));
  const start = rig.tower.chassis.translation();
  let worst = 0;
  let travelled = 0;
  for (let i = 0; i < 25 / FIXED_DT && travelled < 8; i++) {
    step(rig, (r) => {
      r.input.steer = 0;
      r.input.steerMode = 'direct';
      r.input.throttle = 0;
      r.input.reverse = true;
      // Reverse is driven by the brake pedal once it is in (`reverseDriveEngaged`).
      r.input.brake = speedOf(r.tower) < 5 * KMH ? 0.35 : 0;
    });
    const t = rig.tower.chassis.translation();
    travelled = Math.hypot(t.x - start.x, t.z - start.z);
    worst = Math.max(worst, Math.abs(articulation(rig)));
  }
  return `reverse        ${fmt(travelled, 1)} m back, artic ${fmt(worst, 1)}°  ${status(rig)}`;
}

/** True while the two bodies' own chassis colliders touch. */
function touching(rig: TowRig): boolean {
  let touch = false;
  rig.physics.world.contactPair(rig.tower.collisionCollider, rig.towed.collisionCollider, (manifold) => {
    for (let i = 0; i < manifold.numContacts(); i++) if (manifold.contactDist(i) <= 0.01) touch = true;
  });
  return touch;
}

/**
 * WHY NOT A ROPE: the same pair on a 5 m rope, nobody at the towed car's wheel or
 * pedal (the only way a towed car with nobody in it can be on a rope). A straight
 * stop from 60 km/h: does it roll into the tower, and how hard. The road's tightest
 * corner at 60 km/h: how far off the tower's line it runs.
 */
async function rope(tower: string, towed: string): Promise<string[]> {
  const stop = await makeTowRig(tower, towed, cornerPath(5000, 85, 1, 10), SurfaceType.Asphalt, 'rope');
  runUp(stop, 60 * KMH, 4);
  const from = speedOf(stop.tower) / KMH;
  let hitKmh: number | null = null;
  const pedal = follow(0, 1);
  for (let i = 0; i < 20 / FIXED_DT && (speedOf(stop.tower) > 0.2 || speedOf(stop.towed) > 0.2); i++) {
    const closing = Math.hypot(
      stop.towed.chassis.linvel().x - stop.tower.chassis.linvel().x,
      stop.towed.chassis.linvel().z - stop.tower.chassis.linvel().z,
    );
    step(stop, pedal);
    if (hitKmh === null && touching(stop)) hitKmh = closing / KMH;
  }
  const corner = await makeTowRig(tower, towed, cornerPath(250, 85, 50, 35), SurfaceType.Asphalt, 'rope');
  const control = follow(60 * KMH);
  while (corner.hint * corner.path.step < 220) step(corner, control);
  const worst = newTrack();
  const exitS = 250 + 70 + (50 / DEG) * 85 + 60;
  for (let i = 0; i < 40 / FIXED_DT && corner.hint * corner.path.step < exitS; i++) {
    step(corner, control);
    track(corner, worst);
  }
  return [
    `rope brake     from ${fmt(from, 0)} km/h: ` +
      (hitKmh === null ? 'no contact' : `towed car runs into the tower at ${fmt(hitKmh, 1)} km/h`) +
      `  ${status(stop)}`,
    `rope R85 60    tower off line ${fmt(worst.towerOff)} m  towed ${fmt(worst.towedOff)} m  artic ${fmt(worst.artic, 1)}°` +
      `  ${status(corner)}`,
  ];
}

async function snag(tower: string, towed: string): Promise<string> {
  const rig = await makeTowRig(tower, towed, cornerPath(5000, 85, 1, 10));
  runUp(rig, 30 * KMH, 2);
  const at = speedOf(rig.tower) / KMH;
  const hold = rig.towed.chassis.translation();
  const holdPoint = { x: hold.x, y: hold.y, z: hold.z };
  const control = follow(30 * KMH);
  let brokeAt: number | null = null;
  for (let i = 0; i < 4 / FIXED_DT; i++) {
    // A snag: the towed car is against something immovable, every step, so the bar
    // sees the whole of the tower's motion as stretch.
    step(rig, control, (r) => {
      r.towed.chassis.setTranslation(holdPoint, true);
      r.towed.chassis.setLinvel({ x: 0, y: 0, z: 0 }, true);
      r.towed.chassis.setAngvel({ x: 0, y: 0, z: 0 }, true);
    });
    if (!rig.field.isTowed('towed')) {
      brokeAt = (i + 1) * FIXED_DT;
      break;
    }
  }
  const a = towEyeWorld(rig.tower, 'rear', { x: 0, y: 0, z: 0 });
  const b = towEyeWorld(rig.towed, 'front', { x: 0, y: 0, z: 0 });
  return (
    `snag           held at ${fmt(at, 0)} km/h: ` +
    (brokeAt === null ? 'DID NOT BREAK' : `snapped after ${fmt(brokeAt)} s, eyes ${fmt(Math.hypot(a.x - b.x, a.z - b.z))} m apart`) +
    `  state cleared: ${rig.world.state.cars.towed?.towedBy === null}`
  );
}

// ---------------------------------------------------------------------------
// save round-trip

function benchSave(): void {
  console.log('\n== save round-trip ==');
  const [towerModel, towedModel] = PAIRS[0]!;
  const world = newWorldState(9);
  const tower = benchCarState(towerModel, { id: 'tower', z: 0 });
  const towed = benchCarState(towedModel, { id: 'towed', z: -5 });
  towed.bonnet[0] = null;
  const spare = benchCarState(towerModel, { id: 'contract-car:spare', z: 5 });
  world.cars.tower = tower;
  world.cars.towed = towed;
  world.cars['contract-car:spare'] = spare;
  towed.towedBy = 'tower';

  // Through the real serializer AND the real validator, which is what a reload is.
  const round = decodeSaveCode(encodeSaveCode(world));
  const towedBack = round.cars.towed;
  const spareBack = round.cars['contract-car:spare'];
  console.log(
    `  coupling   towedBy=${String(towedBack?.towedBy)} (want tower)` +
    `  tower carries none: ${round.cars.tower?.towedBy == null}`,
  );
  console.log(
    `  spare      survived=${spareBack !== undefined} model=${spareBack?.modelId}` +
    `  engine absent on towed=${towedBack?.bonnet[0] == null}`,
  );

  // A dangling tower, and a three-car chain, must both load with the bar OFF rather
  // than as a coupling the runtime would have to hallucinate.
  const danglingWorld = JSON.parse(JSON.stringify(world)) as WorldState;
  danglingWorld.cars.towed!.towedBy = 'not-a-car';
  const dangling = decodeSaveCode(encodeSaveCode(danglingWorld));
  const chainWorld = JSON.parse(JSON.stringify(world)) as WorldState;
  chainWorld.cars.tower!.towedBy = 'contract-car:spare';
  const chained = decodeSaveCode(encodeSaveCode(chainWorld));
  console.log(
    `  dangling   towedBy=${String(dangling.cars.towed?.towedBy)} (want null)` +
    `  chain kept=${String(chained.cars.towed?.towedBy)}/${String(chained.cars.tower?.towedBy)}` +
    ` (only the direct pair may survive)`,
  );
}

async function main(): Promise<void> {
  await preloadCarModels([...new Set(PAIRS.flat())]);
  for (const [tower, towed] of PAIRS) {
    const probe = await makeTowRig(tower, towed, cornerPath(100, 85, 1, 10));
    console.log(
      `\n== ${carModel(tower).label} (${fmt(probe.tower.chassis.mass(), 0)} kg) towing` +
      ` ${carModel(towed).label} without its engine (${fmt(probe.towed.chassis.mass(), 0)} kg) ==`,
    );
    if (process.env.SWEEP) {
      for (const kmh of [60, 62, 64, 66, 68]) console.log(`  ${await bend(tower, towed, `R85 ${kmh}`, 85, 50, kmh, SurfaceType.Asphalt)}`);
      continue;
    }
    console.log(`  ${await kick(tower, towed)}`);
    console.log(`  ${await bend(tower, towed, 'bend R85 60', 85, 50, 60, SurfaceType.Asphalt)}`);
    console.log(`  ${await bend(tower, towed, 'bend R85 70', 85, 50, 70, SurfaceType.Asphalt)}`);
    console.log(`  ${await bend(tower, towed, 'solo R85 70', 85, 50, 70, SurfaceType.Asphalt, 'solo')}`);
    console.log(`  ${await bend(tower, towed, 'sweep R140 70', 140, 40, 70, SurfaceType.Asphalt)}`);
    console.log(`  ${await bend(tower, towed, 'gravel R85 50', 85, 50, 50, SurfaceType.Gravel)}`);
    console.log(`  ${await bend(tower, towed, 'hairpin R30 40', 30, 90, 40, SurfaceType.Asphalt)}`);
    console.log(`  ${await brake(tower, towed, false)}`);
    console.log(`  ${await brake(tower, towed, true)}`);
    console.log(`  ${await rest(tower, towed)}`);
    console.log(`  ${await reverse(tower, towed)}`);
    console.log(`  ${await snag(tower, towed)}`);
    for (const line of await rope(tower, towed)) console.log(`  ${line}`);
  }
  benchSave();
}

await main();
