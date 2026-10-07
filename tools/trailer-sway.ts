/**
 * tools/trailer-sway.ts
 *
 * Headless bench for the towed trailer's dynamics (src/vehicle/trailer.ts): the real
 * `Vehicle`, the real `Trailer` and the real drawbar, on one flat asphalt plate, stepped
 * in the game's own order (car, trailer, solver, post-steps).
 *
 *   ~/.bun/bin/bun tools/trailer-sway.ts            all sections
 *   ~/.bun/bin/bun tools/trailer-sway.ts sway       one section: load | sway | brake | park
 *   TOW=sv_gaz24 CARGO=500 ~/.bun/bin/bun tools/trailer-sway.ts sway
 *
 * The default rig is the worst the game allows: a VAZ-2101 (955 kg) towing a full
 * trailer (1020 kg). The cargo sits in one of three places on the bed (PLACEMENTS):
 * centred (8% of the trailer's weight on the ball), against the headboard (15-16%) or
 * against the tailgate with its centre over the axle (0-1%).
 *
 * LOAD   the tow car's axle loads parked, solo and towing: the tongue as the car's
 *        own wheels measure it (front + rear change), as the trailer's axle leaves it
 *        (weight minus the two springs), as the lever predicts and as the trailer
 *        reports it (`tongueLoadN`), and the car's rear bump-stop reserve.
 * SWAY   straight-line perturbation, a fresh rig per speed (60-140 km/h): run up on a
 *        gentle lane hold, a 0.02 rad, 0.3 s steering pulse, then the wheel held where
 *        it was (fixed control: no driver damping). The articulation RATE's peaks give
 *        the damping ratio by logarithmic decrement and the frequency by their spacing;
 *        a rig that folds past 25° is DIVERGED, and one that snakes past 25° on the way
 *        up to the speed is reported as SNAKED.
 * BRAKE  braking in a bend with the wheel frozen (R, KMH, PEDAL; default 80 m,
 *        70 km/h, full pedal), trailer brakes mirroring the pedal against none: the
 *        articulation added (fold), the car's path tightening (turn-in), the push on
 *        the ball, whether a trailer wheel locked, and the stop.
 * PARK   an uncoupled trailer standing on a 12° grade, nose down and side on: how far
 *        it creeps in 10 s on its held wheels.
 *
 * SWAY also reports the hitch's anchor error, how often the post-step correction
 * (`enforceHitch`) fires, and an A/B of the tail-heavy case at AB_KMH (100) with that
 * correction switched off. TRACE=<steps> and TRACE_SWAY=1 print the runs.
 */

import * as THREE from 'three';
import { emptyInput, type InputFrame } from '../src/core/input';
import { FIXED_DT, PhysicsWorld } from '../src/core/physics';
import { GameWorld, newWorldState, type TrailerState } from '../src/game/state';
import { preloadCarModels } from '../src/render/carmodel';
import { preloadTrailerModel } from '../src/render/trailermodel';
import { Trailer, TRAILER_BALL_Z, TRAILER_MODEL_FIT, TRAILER_TARE_KG } from '../src/vehicle/trailer';
import { Vehicle } from '../src/vehicle/vehicle';
import { carModel } from '../src/vehicle/carmodels';
import { WorldOrigin } from '../src/world/origin';
import { addGround, addInclineGround } from './handling-bench';
import { benchCarState } from './benchcar';
import { installAssetShim } from './assetshim';
import { installDocumentShim } from './domshim';

installDocumentShim();
installAssetShim();

const TOW = process.env.TOW ?? 'sv_vaz2101';
const CARGO_KG = Number(process.env.CARGO ?? 700);
const SECTION = process.argv[2] ?? 'all';
const G = 9.81;

/** The axle's position on the bed, metres forward of its centre (trailer.ts AXLE_Z). */
const AXLE_Z = -0.2;

/** Cargo placements, metres forward of the bed centre: the 2.2 m crate on the 2.8 m bed. */
const PLACEMENTS = {
  nose: 0.3,
  normal: 0,
  tail: -0.29,
} as const;
type Placement = keyof typeof PLACEMENTS;

/** The tongue share the lever predicts: the empty bed's mass is centred, the cargo at `cargoZ`. */
function predictedTongueFraction(cargoKg: number, cargoZ: number): number {
  const comZ = (cargoKg * cargoZ) / (TRAILER_TARE_KG + cargoKg);
  return (comZ - AXLE_Z) / (TRAILER_BALL_Z - AXLE_Z);
}

// ---------------------------------------------------------------------------
// rig

interface SwayRig {
  physics: PhysicsWorld;
  vehicle: Vehicle;
  trailer: Trailer | null;
  input: InputFrame;
  /** Pedal the trailer's brakes see: the car's, or nothing for brakes-off runs. */
  trailerBrakes: boolean;
  /** Integral of the speed hold, so cruise sits ON the target rather than below it. */
  throttleI: number;
  /**
   * The line the heading hold steers back to. Re-laid where the rig is after every
   * fixed-control observation, which leaves it metres off the old line: steering back
   * across that gap at speed is a slalom, and a slalom is not what is being measured.
   */
  laneX: number;
}

const START_Z = -3500;

async function makeRig(cargoKg: number | null, placement: Placement): Promise<SwayRig> {
  const physics = await PhysicsWorld.create();
  addGround(physics);
  const world = new GameWorld(newWorldState(3));
  const scene = new THREE.Scene();
  const origin = new WorldOrigin();
  const state = benchCarState(TOW, { id: 'tow', z: START_Z });
  world.state.cars[state.id] = state;
  const vehicle = new Vehicle(physics, world, state, scene, origin);
  const input = emptyInput();
  let trailer: Trailer | null = null;
  if (cargoKg !== null) {
    const ts: TrailerState = {
      id: 'bench:trailer', hitchedTo: null, cargoKg: 0, cargoZ: PLACEMENTS[placement],
      x: 0, y: 1, z: START_Z - 6, qx: 0, qy: 0, qz: 0, qw: 1,
    };
    world.state.trailers[ts.id] = ts;
    trailer = new Trailer(physics, world, ts, scene, origin);
    trailer.setCargo(cargoKg);
    trailer.hitchTo(vehicle, state.id);
  }
  const rig: SwayRig = { physics, vehicle, trailer, input, trailerBrakes: true, throttleI: 0, laneX: 0 };
  input.brake = 1;
  for (let i = 0; i < 480; i++) step(rig);
  input.brake = 0;
  return rig;
}

let hitchErrors: number[] = [];

/**
 * The plate is 8 km; a 120 km/h run needs more. Past +2500 m the rig is carried back
 * 5000 m, exactly as the game's floating origin carries it (same velocities, every
 * cached position shifted through `rebase`), except that the ground — uniform and
 * effectively infinite — stays where it is.
 */
const WRAP_AT_Z = 2500;
const WRAP_BY_Z = 5000;

function step(rig: SwayRig): void {
  rig.vehicle.fixedUpdate(FIXED_DT, rig.input);
  rig.trailer?.fixedUpdate(FIXED_DT, rig.trailerBrakes ? rig.vehicle.brakeCommand : 0);
  // Same slot as main.ts: after the controllers, before the solver.
  const ct = rig.vehicle.chassis.translation();
  if (ct.z > WRAP_AT_Z) {
    const shift = { dx: 0, dz: WRAP_BY_Z };
    for (const body of [rig.vehicle.chassis, rig.trailer?.rigidBody]) {
      if (!body) continue;
      const t = body.translation();
      body.setTranslation({ x: t.x, y: t.y, z: t.z - WRAP_BY_Z }, false);
    }
    rig.physics.world.propagateModifiedBodyPositionsToColliders();
    rig.vehicle.rebase(shift);
    rig.trailer?.rebase(shift);
  }
  rig.physics.step();
  rig.vehicle.postStep();
  rig.trailer?.postStep();
  if (rig.trailer) hitchErrors.push(anchorError(rig));
}

function yawOf(q: { x: number; y: number; z: number; w: number }): number {
  return Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
}

function wrapPi(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

const deg = (r: number): number => (r * 180) / Math.PI;

function articulation(rig: SwayRig): number {
  if (!rig.trailer) return 0;
  return wrapPi(yawOf(rig.trailer.rigidBody.rotation()) - yawOf(rig.vehicle.chassis.rotation()));
}

function speedMps(rig: SwayRig): number {
  const v = rig.vehicle.chassis.linvel();
  return Math.hypot(v.x, v.z);
}

/** Distance between the ball and the drawbar eye after the post-step, m. */
function anchorError(rig: SwayRig): number {
  const t = rig.trailer as unknown as {
    carAnchor: { x: number; y: number; z: number } | null;
    trailerAnchor: { x: number; y: number; z: number } | null;
  };
  if (!t.carAnchor || !t.trailerAnchor) return 0;
  const a = new THREE.Vector3(t.carAnchor.x, t.carAnchor.y, t.carAnchor.z);
  const cr = rig.vehicle.chassis.rotation();
  const ct = rig.vehicle.chassis.translation();
  a.applyQuaternion(new THREE.Quaternion(cr.x, cr.y, cr.z, cr.w)).add(new THREE.Vector3(ct.x, ct.y, ct.z));
  const b = new THREE.Vector3(t.trailerAnchor.x, t.trailerAnchor.y, t.trailerAnchor.z);
  const tr = rig.trailer!.rigidBody.rotation();
  const tt = rig.trailer!.rigidBody.translation();
  b.applyQuaternion(new THREE.Quaternion(tr.x, tr.y, tr.z, tr.w)).add(new THREE.Vector3(tt.x, tt.y, tt.z));
  return a.distanceTo(b);
}

/** Post-step correction audit: how often it acts and how much speed it moves. */
const hitchAudit = { calls: 0, fired: 0, dvSum: 0, enabled: true };
{
  const proto = Trailer.prototype as unknown as { enforceHitch: () => void };
  const original = proto.enforceHitch;
  proto.enforceHitch = function (this: Trailer) {
    hitchAudit.calls++;
    if (!hitchAudit.enabled) return;
    const before = this.rigidBody.linvel();
    const b = { x: before.x, y: before.y, z: before.z };
    original.call(this);
    const after = this.rigidBody.linvel();
    const dv = Math.hypot(after.x - b.x, after.y - b.y, after.z - b.z);
    if (dv > 0) hitchAudit.fired++;
    hitchAudit.dvSum += dv;
  };
}

/**
 * Heading and lane hold on the straight +Z line, as a wheel angle, plus a speed hold.
 * Used to arrive at the test speed; the measurement itself is fixed-control.
 */
function cruise(rig: SwayRig, target: number, steerAngle: number | null): number {
  const t = rig.vehicle.chassis.translation();
  const yaw = yawOf(rig.vehicle.chassis.rotation());
  const v = speedMps(rig);
  // A gentle driver: small corrections only, the way one holds a lane with a trailer.
  const want = steerAngle ?? Math.max(-0.02, Math.min(0.02, -0.6 * wrapPi(yaw) - 0.02 * (t.x - rig.laneX)));
  rig.input.steer = rig.vehicle.steeringInputForWheelAngle(want);
  const dv = target - v;
  rig.throttleI = Math.max(0, Math.min(1, rig.throttleI + dv * 0.2 * FIXED_DT));
  rig.input.throttle = Math.max(0, Math.min(1, rig.throttleI + dv * 0.5));
  rig.input.brake = dv < -1.5 ? Math.min(1, -dv * 0.2) : 0;
  return want;
}

interface SwayResult {
  speedKmh: number;
  zeta: number | null;
  freqHz: number | null;
  /** First peak of the articulation RATE, deg/s. */
  firstPeakRate: number;
  /** Largest articulation angle reached, degrees. */
  maxDeg: number;
  diverged: boolean;
  peaks: number;
}

/**
 * Damping ratio and frequency from the alternating peaks of the articulation RATE
 * (trailer yaw rate less the car's). The rate is used rather than the angle because a
 * fixed-control car settles onto a slightly different heading or a gentle curve after
 * the pulse, which leaves the ANGLE with an offset the peaks would misread; in any
 * steady state the two bodies yaw together and the rate is zero.
 */
function analyse(rates: number[], maxAngle: number, speedKmh: number): SwayResult {
  const peaks: { i: number; v: number }[] = [];
  for (let i = 1; i < rates.length - 1; i++) {
    const a = rates[i - 1], b = rates[i], c = rates[i + 1];
    if ((b > a && b >= c && b > 0) || (b < a && b <= c && b < 0)) {
      if (Math.abs(b) < deg2rad(0.05)) continue;
      const last = peaks[peaks.length - 1];
      if (last && Math.sign(last.v) === Math.sign(b)) {
        if (Math.abs(b) > Math.abs(last.v)) peaks[peaks.length - 1] = { i, v: b };
        continue;
      }
      peaks.push({ i, v: b });
    }
  }
  const use = peaks.slice(0, 6);
  let zeta: number | null = null;
  let freqHz: number | null = null;
  if (use.length >= 3) {
    let decSum = 0;
    for (let k = 0; k + 1 < use.length; k++) {
      decSum += Math.log(Math.abs(use[k].v) / Math.abs(use[k + 1].v));
    }
    const delta = (2 * decSum) / (use.length - 1);
    zeta = delta / Math.sqrt(4 * Math.PI * Math.PI + delta * delta);
    const halfPeriod = ((use[use.length - 1].i - use[0].i) / (use.length - 1)) * FIXED_DT;
    freqHz = 1 / (2 * halfPeriod);
  }
  const maxDeg = deg(maxAngle);
  return {
    speedKmh,
    zeta,
    freqHz,
    firstPeakRate: use.length ? deg(Math.abs(use[0].v)) : 0,
    maxDeg,
    diverged: maxDeg > 25,
    peaks: peaks.length,
  };
}

function deg2rad(d: number): number {
  return (d * Math.PI) / 180;
}

const PULSE_RAD = 0.02;
const PULSE_S = 0.3;
const OBSERVE_S = 10;

/** One perturbation at the rig's current speed. */
function perturb(rig: SwayRig, target: number): SwayResult {
  // Settle on the line with the heading hold, then average its last second of steer.
  let trim = 0;
  const settleSteps = Math.round(4 / FIXED_DT);
  for (let i = 0; i < settleSteps; i++) {
    const w = cruise(rig, target, null);
    if (i >= settleSteps - 60) trim += w / 60;
    step(rig);
  }
  const rates: number[] = [];
  let maxAngle = 0;
  const steps = Math.round((PULSE_S + OBSERVE_S) / FIXED_DT);
  for (let i = 0; i < steps; i++) {
    const t = i * FIXED_DT;
    cruise(rig, target, trim + (t < PULSE_S ? PULSE_RAD : 0));
    step(rig);
    const art = Math.abs(articulation(rig));
    maxAngle = Math.max(maxAngle, art);
    if (t >= PULSE_S && rig.trailer) {
      rates.push(rig.trailer.rigidBody.angvel().y - rig.vehicle.chassis.angvel().y);
    }
    if (process.env.TRACE_SWAY && i % 6 === 0 && rig.trailer) {
      console.log(
        `      ${t.toFixed(1)}  art ${deg(articulation(rig)).toFixed(3)}°  car yaw ${deg(rig.vehicle.chassis.angvel().y).toFixed(3)}°/s` +
        `  trailer yaw ${deg(rig.trailer.rigidBody.angvel().y).toFixed(3)}°/s  steer ${rig.input.steer.toFixed(4)}  v ${(speedMps(rig) * 3.6).toFixed(2)}`,
      );
    }
    if (art > deg2rad(60)) break;
  }
  rig.laneX = rig.vehicle.chassis.translation().x;
  return analyse(rates, maxAngle, target * 3.6);
}

/** Largest articulation seen during the last `accelerate`, degrees. */
let accelMaxArtDeg = 0;

/**
 * Accelerates on the heading hold for up to 400 s; returns the speed reached, km/h.
 * Flat out until close: the automatic only takes top gear on a wide-open throttle.
 * Keeps the largest articulation it saw, because a rig past its critical speed
 * starts to snake on its own on the way up, before any pulse.
 */
function accelerate(rig: SwayRig, target: number): number {
  accelMaxArtDeg = 0;
  for (let i = 0; i < Math.round(400 / FIXED_DT); i++) {
    cruise(rig, target, null);
    if (speedMps(rig) < target - 1) rig.input.throttle = 1;
    step(rig);
    accelMaxArtDeg = Math.max(accelMaxArtDeg, Math.abs(deg(articulation(rig))));
    if (process.env.TRACE && i % (Number(process.env.TRACE) || 600) === 0) {
      const p = rig.vehicle.chassis.translation();
      console.log(
        `      t ${(i * FIXED_DT).toFixed(1)} s  ${(speedMps(rig) * 3.6).toFixed(1)} km/h  gear ${rig.vehicle.gearLabel}` +
        `  thr ${rig.input.throttle.toFixed(2)}  steer ${rig.input.steer.toFixed(3)}  art ${deg(articulation(rig)).toFixed(2)}°  x ${p.x.toFixed(2)}  z ${p.z.toFixed(0)}`,
      );
    }
    if (speedMps(rig) > target - 0.3) break;
    if (accelMaxArtDeg > 25) break;
  }
  return speedMps(rig) * 3.6;
}

function report(r: SwayResult): string {
  return (
    `zeta ${r.zeta === null ? '  n/a' : r.zeta.toFixed(3).padStart(6)}` +
    `  f ${r.freqHz === null ? ' n/a' : r.freqHz.toFixed(2)} Hz  first rate peak ${r.firstPeakRate.toFixed(2)}°/s` +
    `  max angle ${r.maxDeg.toFixed(2)}°  peaks ${r.peaks}${r.diverged ? '  DIVERGED' : ''}`
  );
}

async function sway(): Promise<void> {
  console.log(`\n== SWAY: ${carModel(TOW).label} + trailer ${CARGO_KG} kg, ${PULSE_RAD} rad pulse ${PULSE_S}s, fixed control ==`);
  const places = (process.env.PLACES?.split(',') ?? ['normal', 'tail', 'nose']) as Placement[];
  const speeds = process.env.SPEEDS?.split(',').map(Number) ?? [60, 80, 100, 120, 130, 140];
  for (const placement of places) {
    const tongue = predictedTongueFraction(CARGO_KG, PLACEMENTS[placement]);
    console.log(`  ${placement.padEnd(6)} cargo z ${PLACEMENTS[placement].toFixed(2)} m  tongue ${(tongue * 100).toFixed(1)}%`);
    hitchErrors = [];
    hitchAudit.calls = 0; hitchAudit.fired = 0; hitchAudit.dvSum = 0;
    // A fresh rig per speed, run up from rest on the lane hold: nothing one point
    // leaves behind (an offset, a heading, a half-damped weave) reaches the next.
    for (const kmh of speeds) {
      const rig = await makeRig(CARGO_KG, placement);
      const reached = accelerate(rig, kmh / 3.6);
      if (reached < kmh - 3) {
        console.log(
          `    ${kmh.toString().padStart(3)} km/h  not reached (${reached.toFixed(1)})` +
          `${accelMaxArtDeg > 5 ? `  SNAKED on the way up: articulation ${accelMaxArtDeg.toFixed(1)}°` : ''}`,
        );
      } else {
        const r = perturb(rig, kmh / 3.6);
        console.log(`    ${kmh.toString().padStart(3)} km/h  ${report(r)}`);
      }
      rig.vehicle.dispose();
      rig.trailer?.dispose();
    }
    const sorted = [...hitchErrors].sort((a, b) => a - b);
    console.log(
      `    hitch error mean ${((hitchErrors.reduce((a, b) => a + b, 0) / hitchErrors.length) * 1000).toFixed(2)} mm` +
      `  p95 ${(sorted[Math.floor(sorted.length * 0.95)] * 1000).toFixed(2)} mm  max ${(sorted[sorted.length - 1] * 1000).toFixed(1)} mm` +
      `  correction fired ${hitchAudit.fired}/${hitchAudit.calls} steps, mean dv ${(hitchAudit.dvSum / Math.max(1, hitchAudit.fired)).toFixed(4)} m/s`,
    );
  }
  // A/B: the critical (tail-heavy) case without the post-step correction.
  const abSpeed = Number(process.env.AB_KMH ?? 100);
  for (const enabled of [true, false]) {
    hitchAudit.enabled = enabled;
    const rig = await makeRig(CARGO_KG, 'tail');
    const target = abSpeed / 3.6;
    const reached = accelerate(rig, target);
    const r = perturb(rig, target);
    console.log(`  A/B tail ${reached.toFixed(0)} km/h  correction ${enabled ? 'on ' : 'off'}  ${report(r)}`);
    rig.vehicle.dispose();
    rig.trailer?.dispose();
  }
  hitchAudit.enabled = true;
}

// ---------------------------------------------------------------------------

function axleLoads(rig: SwayRig): { front: number; rear: number; rearReserveMm: number } {
  let front = 0, rear = 0, reserve = Infinity;
  for (const w of rig.vehicle.wheelRide) {
    if (w.isFront) front += w.loadN;
    else {
      rear += w.loadN;
      reserve = Math.min(reserve, w.reserveM);
    }
  }
  return { front, rear, rearReserveMm: reserve * 1000 };
}

async function load(): Promise<void> {
  console.log(`\n== LOAD: ${carModel(TOW).label} parked, axle loads (N) ==`);
  const solo = await makeRig(null, 'normal');
  for (let i = 0; i < 120; i++) { solo.input.brake = 1; step(solo); }
  const s = axleLoads(solo);
  console.log(`  solo                      front ${s.front.toFixed(0)}  rear ${s.rear.toFixed(0)}  rear bump reserve ${s.rearReserveMm.toFixed(0)} mm`);
  solo.vehicle.dispose();
  for (const [kg, placement] of [[0, 'normal'], [CARGO_KG, 'normal'], [CARGO_KG, 'tail'], [CARGO_KG, 'nose']] as [number, Placement][]) {
    const rig = await makeRig(kg, placement);
    const trailer = rig.trailer;
    if (!trailer) continue;
    // Trailer wheels free (rolling resistance only): with both ends braked the pair is
    // statically indeterminate, and a horizontal preload left by the settle moves the
    // tongue by H · hitch height / wheelbase.
    rig.trailerBrakes = false;
    for (let i = 0; i < 240; i++) { rig.input.brake = 1; step(rig); }
    const l = axleLoads(rig);
    const weight = trailer.massKg * G;
    const predicted = predictedTongueFraction(kg, PLACEMENTS[placement]) * weight;
    const measured = l.front + l.rear - (s.front + s.rear);
    // The trailer's own springs, read off its private controller: bench introspection.
    const springs = (trailer as unknown as { controller: { wheelSuspensionForce(i: number): number | null } }).controller;
    const atBall = weight - (springs.wheelSuspensionForce(0) ?? 0) - (springs.wheelSuspensionForce(1) ?? 0);
    console.log(
      `  ${String(kg).padStart(3)} kg ${placement.padEnd(6)}  front ${l.front.toFixed(0)} (${(l.front - s.front).toFixed(0).padStart(5)})` +
      `  rear ${l.rear.toFixed(0)} (${l.rear >= s.rear ? '+' : ''}${(l.rear - s.rear).toFixed(0)})  tongue: car wheels ${measured.toFixed(0)} N` +
      `  trailer axle ${atBall.toFixed(0)} N  lever ${predicted.toFixed(0)} N` +
      `  reported ${trailer.tongueLoadN.toFixed(0)} N (${(trailer.tongueFraction * 100).toFixed(1)}%)  rear reserve ${l.rearReserveMm.toFixed(0)} mm`,
    );
    rig.vehicle.dispose();
    rig.trailer?.dispose();
  }
}

// ---------------------------------------------------------------------------

async function brake(): Promise<void> {
  const R = Number(process.env.R ?? 80);
  const v0 = Number(process.env.KMH ?? 70) / 3.6;
  const pedal = Number(process.env.PEDAL ?? 1);
  console.log(
    `\n== BRAKE IN A TURN: R ${R} m at ${(v0 * 3.6).toFixed(0)} km/h (${(v0 * v0 / R / G).toFixed(2)} g), pedal ${pedal}, wheel frozen ==` +
    '\n  turn-in = the car\'s path curvature (yaw rate / speed) at its peak over the stop, against the curvature it' +
    '\n  held before braking: above 1 the trailer is pushing the car into the bend. fold = articulation added in the' +
    '\n  sense the rig was already bent, above what it had in the steady turn.',
  );
  for (const placement of ['normal', 'tail'] as Placement[]) {
    for (const brakes of [true, false]) {
      const rig = await makeRig(CARGO_KG, placement);
      rig.trailerBrakes = brakes;
      // Accelerate on the straight, then hold a circle by curvature feedback.
      for (let i = 0; i < Math.round(60 / FIXED_DT); i++) {
        cruise(rig, v0, null);
        step(rig);
        if (speedMps(rig) > v0 - 0.3) break;
      }
      const L = rig.vehicle.modelDef.factory.wheelbase;
      let trim = 0;
      const holdSteps = Math.round(8 / FIXED_DT);
      for (let i = 0; i < holdSteps; i++) {
        const w = rig.vehicle.chassis.angvel().y;
        const v = speedMps(rig);
        const curvature = v > 1 ? w / v : 0;
        const ff = Math.atan(L / R);
        trim = (i === 0 ? ff : trim) + 0.05 * (1 / R - curvature);
        cruise(rig, v0, trim);
        step(rig);
      }
      const art0 = articulation(rig);
      const kappa0 = rig.vehicle.chassis.angvel().y / Math.max(1, speedMps(rig));
      const start = rig.vehicle.chassis.translation();
      const sx = start.x, sz = start.z;
      let maxFold = 0;
      let maxTurnIn = 1;
      let maxSlide = 0;
      let pushSum = 0;
      let pushMax = 0;
      let pushSteps = 0;
      let t = 0;
      const steerInput = rig.input.steer;
      const trailerSpeed = (): number => {
        const v = rig.trailer ? rig.trailer.rigidBody.linvel() : { x: 0, z: 0 };
        return Math.hypot(v.x, v.z);
      };
      // The trailer's own tyres' share of its slowdown, as its impact check reads it.
      const own = rig.trailer as unknown as { ownDecelMps2: number } | null;
      while (speedMps(rig) > 0.5 && t < 15) {
        rig.input.steer = steerInput;
        rig.input.throttle = 0;
        rig.input.brake = pedal;
        const before = trailerSpeed();
        step(rig);
        t += FIXED_DT;
        const art = articulation(rig);
        maxFold = Math.max(maxFold, (art - art0) * Math.sign(art0 || 1));
        const v = speedMps(rig);
        if (v > 4) maxTurnIn = Math.max(maxTurnIn, (rig.vehicle.chassis.angvel().y / v) / kappa0);
        if (rig.trailer && own) {
          for (const s of rig.trailer.wheelSpray) maxSlide = Math.max(maxSlide, s.slideSlip);
          // Push on the ball: the trailer's deceleration its own tyres do not explain,
          // times its mass — what the car is doing to stop it.
          if (v > 2) {
            const push = rig.trailer.massKg * ((before - trailerSpeed()) / FIXED_DT - own.ownDecelMps2);
            pushSum += push;
            pushMax = Math.max(pushMax, push);
            pushSteps++;
          }
        }
      }
      const end = rig.vehicle.chassis.translation();
      console.log(
        `  ${placement.padEnd(6)} trailer brakes ${brakes ? 'on ' : 'off'}  articulation ${deg(art0).toFixed(1)}°  fold +${deg(maxFold).toFixed(1)}°` +
        `  turn-in ×${maxTurnIn.toFixed(2)}  ball push mean ${(pushSum / Math.max(1, pushSteps) / 1000).toFixed(2)} kN` +
        ` peak ${(pushMax / 1000).toFixed(2)} kN  trailer wheel slide ${maxSlide.toFixed(2)}` +
        `  stop ${Math.hypot(end.x - sx, end.z - sz).toFixed(1)} m in ${t.toFixed(1)} s${maxFold > deg2rad(30) ? '  JACKKNIFE' : ''}`,
      );
      rig.vehicle.dispose();
      rig.trailer?.dispose();
    }
  }
}

// ---------------------------------------------------------------------------

async function park(): Promise<void> {
  console.log('\n== PARK: uncoupled trailer on a 12° grade, 10 s ==');
  for (const yawDeg of [0, 90]) {
    const physics = await PhysicsWorld.create();
    addInclineGround(physics, 12, undefined, 60);
    const world = new GameWorld(newWorldState(3));
    const scene = new THREE.Scene();
    const origin = new WorldOrigin();
    const half = (yawDeg * Math.PI) / 360;
    const y = Math.tan(deg2rad(12)) * 0 + 1.2;
    const ts: TrailerState = {
      id: 'park', hitchedTo: null, cargoKg: 0, x: 0, y, z: 0,
      qx: Math.sin(deg2rad(-12) / 2) * Math.cos(half), qy: Math.sin(half) * Math.cos(deg2rad(-12) / 2), qz: 0, qw: Math.cos(half) * Math.cos(deg2rad(-12) / 2),
    };
    world.state.trailers[ts.id] = ts;
    const trailer = new Trailer(physics, world, ts, scene, origin);
    trailer.setCargo(CARGO_KG);
    for (let i = 0; i < 120; i++) { trailer.fixedUpdate(FIXED_DT, 0); physics.step(); trailer.postStep(); }
    const p0 = trailer.rigidBody.translation();
    const a = { x: p0.x, y: p0.y, z: p0.z };
    for (let i = 0; i < 600; i++) {
      trailer.fixedUpdate(FIXED_DT, 0);
      physics.step();
      trailer.postStep();
      if (process.env.TRACE && i % 60 === 59) {
        const p = trailer.rigidBody.translation();
        const v = trailer.rigidBody.linvel();
        console.log(`      ${((i + 1) / 60).toFixed(0)} s  moved ${(Math.hypot(p.x - a.x, p.z - a.z) * 1000).toFixed(1)} mm  v ${Math.hypot(v.x, v.z).toFixed(4)} m/s`);
      }
    }
    const p1 = trailer.rigidBody.translation();
    console.log(`  ${yawDeg === 0 ? 'nose down the slope' : 'side on to slope  '}  creep ${(Math.hypot(p1.x - a.x, p1.z - a.z) * 1000).toFixed(1)} mm`);
    trailer.dispose();
  }
}

await preloadCarModels([TOW]);
await preloadTrailerModel(TRAILER_MODEL_FIT);
console.log(`trailer bench: tow ${TOW}, cargo ${CARGO_KG} kg`);
if (SECTION === 'all' || SECTION === 'load') await load();
if (SECTION === 'all' || SECTION === 'sway') await sway();
if (SECTION === 'all' || SECTION === 'brake') await brake();
if (SECTION === 'all' || SECTION === 'park') await park();
