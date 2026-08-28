/**
 * Pure drivetrain simulation: crank, gears, engine braking and fuel.
 *
 * No Three.js, no Rapier. It consumes numbers and produces numbers, so it is
 * testable in isolation and reusable by an AI driver or a replay without a
 * physics world. Everything with a unit is SI: radians, metres, seconds, Nm,
 * litres.
 */

import type { EngineSpec, GearboxSpec } from '../parts/registry';

const RAD_PER_SEC_PER_RPM = (2 * Math.PI) / 60;
const RPM_PER_RAD_PER_SEC = 60 / (2 * Math.PI);

/** Gear index: -1 = reverse, 0 = neutral, 1..n = forward gears. */
const GEAR_REVERSE = -1;
const GEAR_NEUTRAL = 0;

/** Normalised torque at idle. High enough to launch from a standstill. */
const IDLE_TORQUE_FRACTION = 0.62;
/** Normalised torque remaining at the redline before the fuel cut. */
const REDLINE_TORQUE_FRACTION = 0.82;

/**
 * Pumping loss as a fraction of peak torque. This is the constant (RPM-
 * independent) part of engine braking: the work of dragging air through a
 * closed throttle. Scaled by engine size so a big diesel resists far more than
 * a small four at the same crank speed.
 */
const PUMPING_LOSS_FRACTION = 0.03;
/**
 * Closed-throttle engine-braking multiplier.
 *
 * `brakingCoeff` and `PUMPING_LOSS_FRACTION` model the engine's *open-throttle*
 * drag (mechanical friction plus a little pumping), which the drive path
 * subtracts from produced torque. With the throttle shut, the manifold sits at
 * strong vacuum and the engine must pump against itself, so the retarding
 * torque is several times that open-throttle figure.
 *
 * Derivation (reference car: 1008 kg wagon, engine_i4_1600 brakingCoeff 0.055 /
 * peakTorque 125 Nm, 4-speed finalDrive 3.9, wheel radius 0.35 m, coasting at
 * 70 km/h ≈ 19.4 m/s):
 *   4th gear runs the crank at 2069 rpm = 216.7 rad/s, so open-throttle drag is
 *   0.055×216.7 + 0.03×125 = 15.7 Nm at the crank. Through 3.9:1 that is
 *   174.6 N at the contact patch, i.e. 0.17 m/s² on 1008 kg. A real 1.6 L
 *   petrol engine coasts down around 0.5 m/s² in top gear, so the closed-
 *   throttle retarding torque is ~2.9× the open-throttle figure; 2.5 lands 4th
 *   at ~0.43 m/s², 2nd at ~1.6 m/s² and 1st, through its deep 3.65:1 ratio, far
 *   harder (~3.6 m/s² once the over-redline rev is soft-capped below).
 *
 * It MUST be applied only to the closed-throttle engine-braking branch. Scaling
 * the drive path instead would bleed the engine friction out of the produced
 * torque and regress the measured acceleration figures.
 */
const CLOSED_THROTTLE_BRAKE_FACTOR = 2.5;
/**
 * Fraction of the over-redline crank speed that still contributes viscous
 * braking drag. Past the redline an engine's pumping work is throttled by valve
 * float and intake-flow limits, so each extra rad/s adds less and less braking.
 * A non-zero gain preserves "dragged past its redline brakes harder and harder"
 * (it never flatlines) while bounding the runaway in too-low a gear so 1st-gear
 * coast-down stays ~2.5-4 m/s² instead of climbing past 5.
 */
const OVER_REV_BRAKE_GAIN = 0.2;

/** Automatic shift points, as fractions of redline. The wide gap is hysteresis. */
const UP_SHIFT_RPM_FRACTION = 0.8;
const DOWN_SHIFT_RPM_FRACTION = 0.4;
/**
 * An upshift must leave the taller gear at least this multiple of idle rpm, or the
 * box would immediately hunt back down. 1.25 keeps a real margin without blocking
 * the tall top gears on a heavy truck.
 */
const UP_SHIFT_IDLE_MARGIN = 1.25;
/** Throttle at which an automatic in neutral or reverse engages first gear. */
const AUTO_ENGAGE_THROTTLE = 0.12;
/** Road speed below which neutral may engage drive while the car is still rolling. */
const AUTO_NEUTRAL_ENGAGE_MPS = 2;
/** Forward speed below which an automatic may safely change drive direction. */
const AUTO_DIRECTION_CHANGE_MPS = 0.25;

/** Flywheel time constants: cranks rev up quickly and fall back more slowly. */
const FLYWHEEL_UP_TAU = 0.12;
const FLYWHEEL_DOWN_TAU = 0.35;

/**
 * Idle fuel burn fudge. The pumping-work estimate alone under-predicts real
 * idle consumption (~0.5–1 L/h for a small engine) because it ignores accessory
 * load and the poor thermal efficiency off-load; ×6 lands it in that range.
 */
const IDLE_BURN_FACTOR = 6;

export interface DrivetrainOutput {
  /**
   * Net wheel torque the engine is *driving* with, Nm, signed by gear direction:
   * positive in a forward gear, negative in reverse, zero when engine braking.
   */
  readonly driveTorqueNm: number;
  /**
   * Magnitude of retarding wheel torque from engine braking (closed-throttle
   * pumping + viscous drag), Nm, always >= 0. Zero while the engine is driving.
   */
  readonly engineBrakeTorqueNm: number;
  /** Crank speed, RPM. */
  readonly rpm: number;
  /** Fuel consumed this tick, litres. Never negative. */
  readonly fuelBurnLitres: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Torque at the wheel contact patch from a drive torque and tyre radius. */
export function wheelTorqueToForce(torqueNm: number, wheelRadius: number): number {
  return wheelRadius > 0 ? torqueNm / wheelRadius : 0;
}

export class Drivetrain {
  /** Fixed by the body; kept for reference by callers that split axle torque. */
  readonly rearDriveBias: number;

  private engine: EngineSpec | null = null;
  private gearbox: GearboxSpec | null = null;

  private gear = GEAR_NEUTRAL;
  private rpmValue = 0;
  /** Seconds of remaining torque interruption from an in-progress shift. */
  private shiftTimer = 0;
  /** Litres/second burned while idling in neutral. */
  private idleBurnLps = 0;

  constructor(engine: EngineSpec | null, gearbox: GearboxSpec | null, rearDriveBias: number) {
    this.rearDriveBias = rearDriveBias;
    this.reconfigure(engine, gearbox);
  }

  /**
   * Swap the engine/gearbox in place so a part change does not allocate a new
   * object (and so the Vehicle can keep one drivetrain for its lifetime).
   */
  reconfigure(engine: EngineSpec | null, gearbox: GearboxSpec | null): void {
    this.engine = engine;
    this.gearbox = gearbox;

    if (engine) {
      this.rpmValue = clamp(this.rpmValue, engine.idleRpm, engine.redlineRpm);
      this.idleBurnLps = this.idleFuelRateLps(engine);
    } else {
      this.rpmValue = 0;
      this.idleBurnLps = 0;
    }

    // Drop out of any gear the new gearbox no longer offers.
    this.gear = gearbox ? clamp(this.gear, GEAR_REVERSE, gearbox.ratios.length) : GEAR_NEUTRAL;
    this.shiftTimer = 0;
  }

  get rpm(): number {
    return this.rpmValue;
  }

  get gearLabel(): string {
    if (this.gearbox == null) return 'N';
    if (this.gear === GEAR_REVERSE) return 'R';
    if (this.gear === GEAR_NEUTRAL) return 'N';
    return String(this.gear);
  }

  /** True when the fitted transmission shifts itself regardless of player assist. */
  get isPhysicallyAutomatic(): boolean {
    return this.gearbox?.automatic === true;
  }

  /** Reverse is selected and its shift interruption has fully elapsed. */
  get isReverseDriveEngaged(): boolean {
    return this.gear === GEAR_REVERSE && this.shiftTimer <= 0;
  }

  /**
   * Wheel speed (rad/s) the engaged gear allows before the engine would pass its
   * redline, or Infinity when nothing is driving the wheel (neutral, mid-shift, no
   * gearbox). A driven wheel is geared to the crank, so this is the hard ceiling on
   * how fast it can be spun up no matter how little grip the tyre has — which is
   * what bounds wheelspin instead of letting a slipping wheel run away.
   */
  get maxDrivenWheelSpinRadS(): number {
    const gearbox = this.gearbox;
    const engine = this.engine;
    if (gearbox == null || engine == null || this.gear === GEAR_NEUTRAL || this.shiftTimer > 0) {
      return Infinity;
    }
    const total = Math.abs(this.gearRatio() * gearbox.finalDrive);
    return total > 0 ? engine.redlineRpm / RPM_PER_RAD_PER_SEC / total : Infinity;
  }

  /**
   * Manual shift: -1 down, +1 up. Reverse sits below neutral; neutral below 1.
   * With driver assist active this is the +/- gate of a real automatic: the
   * request applies immediately and stays authoritative while the shift is in
   * progress (shiftTimer), after which the next automatic decision may override
   * it — intended, not a fight.
   */
  shift(direction: number): void {
    if (this.gearbox == null || direction === 0) return;
    const n = this.gearbox.ratios.length;
    const next = this.gear + (direction > 0 ? 1 : -1);
    const target = clamp(next, GEAR_REVERSE, n);
    if (target === this.gear) return;
    this.setGear(target);
  }

  /**
   * Normalised torque shape, scaled by peak torque: rises from idle to a peak,
   * falls gently toward the redline, then cuts completely at the redline so the
   * engine can never be fuelled past it.
   */
  torqueCurve(rpm: number): number {
    const e = this.engine;
    if (e == null || rpm <= 0 || rpm >= e.redlineRpm) return 0;

    let normalised: number;
    if (rpm <= e.idleRpm) {
      normalised = IDLE_TORQUE_FRACTION;
    } else if (rpm < e.torquePeakRpm) {
      const t = (rpm - e.idleRpm) / (e.torquePeakRpm - e.idleRpm);
      normalised = IDLE_TORQUE_FRACTION + (1 - IDLE_TORQUE_FRACTION) * t;
    } else {
      const t = (rpm - e.torquePeakRpm) / (e.redlineRpm - e.torquePeakRpm);
      normalised = 1 - (1 - REDLINE_TORQUE_FRACTION) * t;
    }

    return normalised * e.peakTorqueNm;
  }

  /**
   * Advance the simulation by dt. `autoShift` is the driver's gearbox-mode
   * preference (the settings value), passed per call rather than stored: it is
   * player input that can change at any tick boundary, not vehicle hardware, so
   * a per-call argument keeps this class's behaviour fully determined by each
   * call — an AI driver or a replay cannot forget to configure it, and there is
   * no second configuration channel beside the fitted parts (reconfigure). The
   * decision itself is the OR of hardware and driver: see the gate below.
   */
  update(
    dt: number,
    throttle: number,
    wheelAngularSpeed: number,
    wheelRadius: number,
    autoShift: boolean,
    reverseRequested: boolean,
    forwardDemand: number,
  ): DrivetrainOutput {

    dt = dt > 0 ? dt : 0;
    const demand = clamp(throttle, 0, 1);

    if (this.shiftTimer > 0) this.shiftTimer = Math.max(0, this.shiftTimer - dt);

    const engine = this.engine;
    const gearbox = this.gearbox;

    // The gearbox shifts itself when it is physically automatic OR the driver
    // asked for the assist (settings gearbox mode). Hardware wins: a physically
    // automatic gearbox keeps shifting even in manual mode — the assist only
    // ever ADDS automatic behaviour, never removes it.
    if (gearbox && (gearbox.automatic || autoShift) && this.shiftTimer <= 0) {
      this.automaticShift(
        engine,
        gearbox,
        demand,
        clamp(forwardDemand, 0, 1),
        wheelAngularSpeed,
        wheelRadius,
        reverseRequested,
      );
    }

    // --- Crank speed ---
    let crankSpeed: number; // rad/s, signed: positive = natural crank rotation.
    if (engine == null) {
      this.rpmValue = 0;
      crankSpeed = 0;
    } else if (gearbox == null || this.gear === GEAR_NEUTRAL || this.shiftTimer > 0) {
      // Clutch open (no gearbox, neutral, or mid-shift): crank free-revs.
      this.rpmValue = this.freeRev(engine, dt, demand);
      crankSpeed = this.rpmValue / RPM_PER_RAD_PER_SEC;
    } else {
      // Gear engaged: the crank is locked to wheel speed through the ratios.
      // `crankSpeed` is kept RAW (unclamped) here: in too low a gear it can
      // overshoot the redline, and that over-rev is what makes engine braking
      // violent. Only `this.rpmValue` — used for fuelling, idle behaviour and
      // the HUD — is clamped below. Engine braking deliberately reads the
      // unclamped geared speed further down.
      const total = this.gearRatio() * gearbox.finalDrive;
      crankSpeed = wheelAngularSpeed * total;
      this.rpmValue = clamp(
        Math.abs(crankSpeed) * RPM_PER_RAD_PER_SEC,
        engine.idleRpm,
        engine.redlineRpm,
      );
    }
    const crankSpeedAbs = Math.abs(crankSpeed);

    let driveTorqueNm = 0;
    let engineBrakeTorqueNm = 0;
    let fuelBurnLitres = 0;

    if (
      engine != null &&
      gearbox != null &&
      this.gear !== GEAR_NEUTRAL &&
      this.shiftTimer <= 0
    ) {
      const total = this.gearRatio() * gearbox.finalDrive; // signed (reverse is -)

      const driveCrank = this.torqueCurve(this.rpmValue) * demand; // >= 0
      // Mechanical friction + pumping at OPEN throttle. This is subtracted from
      // the produced torque below and is the base the closed-throttle engine
      // braking is built from; it is already calibrated into the acceleration
      // figures, so it must never be scaled on the drive side.
      const frictionCrank =
        engine.brakingCoeff * crankSpeedAbs + PUMPING_LOSS_FRACTION * engine.peakTorqueNm;

      const netCrank = driveCrank - frictionCrank; // signed Nm at the crank

      if (netCrank >= 0) {
        // Driving: the gear carries the direction (forward or reverse).
        driveTorqueNm = netCrank * total;
      } else {
        // Engine braking, reported as a magnitude of retarding wheel torque
        // (Nm). It is computed from the TRUE geared crank speed (unclamped), so
        // an over-revving engine drags harder — the whole point of engine
        // braking in too low a gear. The clamped `this.rpmValue` is only used
        // for the fuelling curve above, so a 1st-gear over-rev cuts fuel yet
        // still brakes far harder than 2nd.
        //
        // Past the redline the viscous contribution is soft-capped (see
        // OVER_REV_BRAKE_GAIN) so the drag keeps rising but cannot runaway.
        const brakeCrankSpeed = this.brakeCrankSpeed(crankSpeedAbs, engine);
        const brakeFriction =
          engine.brakingCoeff * brakeCrankSpeed + PUMPING_LOSS_FRACTION * engine.peakTorqueNm;
        engineBrakeTorqueNm = brakeFriction * CLOSED_THROTTLE_BRAKE_FACTOR * Math.abs(total);
      }

      // Fuel on positive mechanical work, via bsfc (litres per kWh).
      const drivePowerKw = (driveCrank * crankSpeedAbs) / 1000;
      fuelBurnLitres += (drivePowerKw * engine.bsfc) / 3600 * dt;
    }

    // Idle burn: keeping the engine turning with no load in neutral.
    if (engine != null && this.gear === GEAR_NEUTRAL && this.shiftTimer <= 0 && this.rpmValue > 0) {
      fuelBurnLitres += this.idleBurnLps * dt;
    }

    return {
      driveTorqueNm,
      engineBrakeTorqueNm,
      rpm: this.rpmValue,
      fuelBurnLitres: fuelBurnLitres < 0 ? 0 : fuelBurnLitres,
    };
  }

  private setGear(g: number): void {
    this.gear = g;
    this.shiftTimer = this.gearbox ? this.gearbox.shiftTime : 0;
  }

  private gearRatio(): number {
    if (this.gearbox == null) return 0;
    if (this.gear === GEAR_REVERSE) return -this.gearbox.reverse;
    if (this.gear >= 1) return this.gearbox.ratios[this.gear - 1];
    return 0;
  }

  /**
   * Crank speed fed to the closed-throttle BRAKING drag. Below the redline it is
   * the true geared speed (an over-revving engine drags harder); past the
   * redline the over-rev contributes at OVER_REV_BRAKE_GAIN so braking keeps
   * rising but cannot runaway in too low a gear. The fuelling path is separate
   * and always uses the clamped `rpmValue`.
   */
  private brakeCrankSpeed(crankSpeedAbs: number, engine: EngineSpec): number {
    const redlineRad = engine.redlineRpm / RPM_PER_RAD_PER_SEC;
    if (crankSpeedAbs <= redlineRad) return crankSpeedAbs;
    return redlineRad + (crankSpeedAbs - redlineRad) * OVER_REV_BRAKE_GAIN;
  }

  private freeRev(engine: EngineSpec, dt: number, throttle: number): number {
    // Target idles at closed throttle and approaches (but never reaches) the
    // redline at full throttle.
    const target = engine.idleRpm + throttle * (engine.redlineRpm * 0.95 - engine.idleRpm);
    const tau = target > this.rpmValue ? FLYWHEEL_UP_TAU : FLYWHEEL_DOWN_TAU;
    this.rpmValue += (target - this.rpmValue) * (1 - Math.exp(-dt / tau));
    return this.rpmValue;
  }

  /**
   * Automatic gear selection.
   *
   * Decisions are made on the rpm the crank WOULD see at the current wheel speed
   * in a given gear, never on `rpmValue`. Through a shift (and on the tick that
   * ends one) the clutch is open and `rpmValue` is the free-revving crank, which
   * at full throttle sits above the upshift threshold no matter how slowly the
   * car is moving: deciding on it walked a standing car straight up through every
   * gear and left it unable to pull away at all.
   */
  private automaticShift(
    engine: EngineSpec | null,
    gearbox: GearboxSpec,
    throttle: number,
    forwardDemand: number,
    wheelAngularSpeed: number,
    wheelRadius: number,
    reverseRequested: boolean,
  ): void {
    if (engine == null) return;
    const n = gearbox.ratios.length;
    const roadSpeed = wheelAngularSpeed * wheelRadius;
    const atRest = Math.abs(roadSpeed) <= AUTO_DIRECTION_CHANGE_MPS;

    // Pedals request a direction rather than a permanent gear selection. An
    // opposite engaged gear remains authoritative until the car has stopped.
    // Neutral may take first during a slow roll because no direction is engaged.
    //
    // `forwardDemand` is independent of delivered throttle: while braking a
    // reversing car it stays non-zero so the selector can leave reverse at rest.
    if (this.gear === GEAR_REVERSE) {
      if (!reverseRequested && forwardDemand > AUTO_ENGAGE_THROTTLE && atRest) this.setGear(1);
      return;
    }
    if (this.gear === GEAR_NEUTRAL) {
      if (reverseRequested) {
        if (Math.abs(roadSpeed) <= AUTO_NEUTRAL_ENGAGE_MPS) this.setGear(GEAR_REVERSE);
      } else if (
        forwardDemand > AUTO_ENGAGE_THROTTLE &&
        Math.abs(roadSpeed) <= AUTO_NEUTRAL_ENGAGE_MPS
      ) {
        this.setGear(1);
      }
      return;
    }
    if (reverseRequested && atRest) {
      this.setGear(GEAR_REVERSE);
      return;
    }

    const wheelAbs = Math.abs(wheelAngularSpeed) * gearbox.finalDrive * RPM_PER_RAD_PER_SEC;
    const current = wheelAbs * Math.abs(this.ratioOfGear(this.gear));

    if (this.gear < n && current > engine.redlineRpm * UP_SHIFT_RPM_FRACTION) {
      // Never upshift into a gear that cannot pull: the taller gear must still
      // leave the engine clear of idle, or the box would hunt straight back down.
      const next = wheelAbs * Math.abs(this.ratioOfGear(this.gear + 1));
      if (next > engine.idleRpm * UP_SHIFT_IDLE_MARGIN) this.setGear(this.gear + 1);
    } else if (this.gear > 1 && current < engine.redlineRpm * DOWN_SHIFT_RPM_FRACTION) {
      this.setGear(this.gear - 1);
    }
  }

  /** Ratio of an arbitrary forward gear; `gearRatio()` only knows the current one. */
  private ratioOfGear(gear: number): number {
    if (this.gearbox == null || gear < 1) return 0;
    return this.gearbox.ratios[gear - 1] ?? 0;
  }

  private idleFuelRateLps(engine: EngineSpec): number {
    const idleRad = engine.idleRpm / RPM_PER_RAD_PER_SEC;
    const pumpingWorkKw = (PUMPING_LOSS_FRACTION * engine.peakTorqueNm * idleRad) / 1000;
    return (pumpingWorkKw * engine.bsfc) / 3600 * IDLE_BURN_FACTOR;
  }
}
