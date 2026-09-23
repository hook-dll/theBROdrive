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

/*
 * ---- the wide-open-throttle curve ----
 *
 * `engineTorqueNm` is the engine's external speed characteristic: NET crank torque
 * at full throttle, the curve a factory brake records and the one a catalogue's two
 * figures are points on. It is built so that both of those points are exact:
 *
 *   torque peak  (torquePeakRpm, peakTorqueNm), with zero slope, because it is a peak;
 *   power peak   (powerPeakRpm, peakPowerKw / omega), with dT/domega = -T/omega,
 *                which is exactly the slope that makes T*omega stationary there.
 *
 * Idle to torque peak is a cubic Hermite segment, peak to power peak a shape-
 * preserving segment that meets the power point's slope (see `fallingSegment`), and
 * past the power peak power follows Leiderman's external-characteristic polynomial
 * P/Pmax = x + x^2 - x^3 (x = n / n_P, the textbook form for a carburettor petrol
 * engine), which is stationary at x = 1 and loses power gently: 1% at 7% over the
 * power peak, 2% at 10%. The last LIMITER_RAMP_RPM before the fuel cut then fade the
 * torque smoothly to zero, which is what a soft limiter does and what stops the
 * engine hitting a wall of zero torque at one exact crank speed.
 */

/**
 * Net full-throttle torque at idle, as a fraction of peak. A carburettor four at
 * 800 rpm is running far below the speed its manifold and cam are tuned for; the
 * curve this replaced delivered 0.63 of peak net here, and the standing-start and
 * climb checks (handling-cli, climb-sweep) were built on that, so the net figure
 * keeps it. Launches do not depend on it: first gear slips the clutch at the torque
 * peak (see `update`).
 */
const IDLE_TORQUE_FRACTION = 0.62;
/**
 * Start slope of the idle-to-peak segment, as a multiple of that segment's secant.
 * 1.5 is inside the Fritsch-Carlson monotone region (<= 3) and gives the full early
 * rise and flat top of a real curve: 88% of peak halfway between idle and the peak.
 */
const IDLE_RISE_SLOPE = 1.5;
/** Crank speed over which the fuel cut fades torque to zero, rpm. */
const LIMITER_RAMP_RPM = 150;

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
 * Derivation (VAZ-2101 1.2, brakingCoeff 0.0144, peak torque 87 Nm): at 3000 rpm
 *   = 314 rad/s the open-throttle drag is 0.0144×314 + 0.03×87 = 7.1 Nm, which is
 *   1.2 bar of friction mean effective pressure on 1.2 litres — a period petrol
 *   four's figure. A shut throttle adds the pumping loop on top, and overrun
 *   measurements of such engines put the total at two to three times the open-
 *   throttle drag; 2.5 lands the 1.2 on 18 Nm at 3000 rpm and the Volga 2.4 on
 *   about 43 Nm, the believable overrun figures the Soviet driveline note in
 *   parts/registry.ts is sized to.
 *
 * It MUST be applied only to the closed-throttle engine-braking branch. Scaling
 * the drive path instead would bleed engine friction out of the part-throttle
 * blend (`update`) and move every part-throttle response the traffic and the
 * autopilot are tuned on.
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

/**
 * Part-throttle automatic shift points, as fractions of redline. The wide gap is
 * hysteresis. At wide-open throttle the upshift is instead power-optimal (see
 * `automaticShift`): a driver asking for everything wants the gear that pushes
 * hardest, not the one that is quietest.
 */
const UP_SHIFT_RPM_FRACTION = 0.8;
const DOWN_SHIFT_RPM_FRACTION = 0.4;
/**
 * Throttle at and above which the automatic treats the request as wide open and
 * shifts on wheel force. Below it the 0.8-redline rule holds, which is what keeps
 * traffic and the autopilot, driving on a speed controller's part throttle, from
 * revving every car out between gears.
 */
const WOT_SHIFT_THROTTLE = 0.95;
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

/**
 * Rotating inertia of the crank, flywheel and clutch, kg·m², DERIVED rather than
 * authored so a new engine variant needs no extra number.
 *
 * Peak torque is the size of an engine. For a four-stroke, torque is
 * `BMEP · displacement / 4π`, and BMEP is roughly constant across a class of engine —
 * about 9 bar for these naturally aspirated period units — so displacement in litres
 * is close to `peakTorqueNm / TORQUE_PER_LITRE`. The catalogue's factory net figures
 * agree with themselves on that: 87 N·m from 1.198 litres (73 per litre), 116 from
 * 1.569 (74), 186 from 2.445 (76), 44 from the 0.649 Oka twin (68).
 *
 * Inertia is then a fixed clutch-and-input-shaft term plus a term that grows with
 * displacement, which is what a bigger crank and a bigger flywheel are. The result
 * lands 0.17 kg·m² for the 1.2 and about 0.5 for a truck diesel — the range real
 * assemblies of this era occupy.
 */
const TORQUE_PER_LITRE = 72;
const CRANK_INERTIA_BASE = 0.1;
const CRANK_INERTIA_PER_LITRE = 0.055;

function crankInertiaKgM2(engine: EngineSpec): number {
  const litres = Math.max(0, engine.peakTorqueNm) / TORQUE_PER_LITRE;
  return CRANK_INERTIA_BASE + CRANK_INERTIA_PER_LITRE * litres;
}

/**
 * Shape of the torque-peak-to-power-peak segment on u = 0..1: s(0) = 0, s(1) = 1,
 * zero slope at the torque peak and slope `beta` (in units of the segment's secant)
 * at the power peak. Up to beta = 3 that is the cubic Hermite segment, which stays
 * monotone exactly there (the Fritsch-Carlson bound for a zero start slope); a
 * steeper power point — a flat torque curve that falls hard just before its rated
 * speed, as the Zhiguli fours do — needs u^beta, which meets both slopes, has no
 * overshoot, and is the same curve as the cubic at beta = 3.
 */
function fallingSegment(u: number, beta: number): number {
  if (beta <= 3) return (beta - 2) * u * u * u + (3 - beta) * u * u;
  return Math.pow(u, beta);
}

/**
 * NET crank torque at wide-open throttle, Nm: the external speed characteristic
 * described above the constants, passing exactly through the catalogue's torque
 * point and power point.
 *
 * `cutRpm` is the fuel cut. It defaults to the engine's `redlineRpm`; `Drivetrain`
 * lowers it with the thermal rev limit, so a boiling engine refuses the top of its
 * range instead of making less torque everywhere. Pure and exported so every tool
 * asking "what can this engine do here" reads the one curve the car drives on.
 *
 * Inconsistent data is clamped rather than trusted: a power point below the torque
 * peak's rpm is moved just above it, and a power point whose torque exceeds the peak
 * torque (a catalogue typo, or a power figure from a different rating standard) is
 * held at the peak, so the curve never rises past `peakTorqueNm`.
 */
export function engineTorqueNm(
  engine: EngineSpec,
  rpm: number,
  cutRpm: number = engine.redlineRpm,
): number {
  if (!(rpm > 0) || rpm >= cutRpm) return 0;
  const peakNm = engine.peakTorqueNm;
  const peakRpm = engine.torquePeakRpm;
  const powerRpm = Math.max(engine.powerPeakRpm, peakRpm + 1);
  const powerNm = Math.min(
    peakNm,
    (engine.peakPowerKw * 1000) / (powerRpm * RAD_PER_SEC_PER_RPM),
  );

  let torque: number;
  if (rpm <= engine.idleRpm) {
    torque = IDLE_TORQUE_FRACTION * peakNm;
  } else if (rpm < peakRpm) {
    const u = (rpm - engine.idleRpm) / (peakRpm - engine.idleRpm);
    const a = IDLE_RISE_SLOPE;
    const rise = (a - 2) * u * u * u + (3 - 2 * a) * u * u + a * u;
    torque = peakNm * (IDLE_TORQUE_FRACTION + (1 - IDLE_TORQUE_FRACTION) * rise);
  } else if (rpm < powerRpm) {
    const drop = peakNm - powerNm;
    if (drop <= 1e-9) {
      torque = peakNm;
    } else {
      // Stationary power at the power point: dT/drpm = -T / rpm there, expressed in
      // units of this segment's secant slope.
      const beta = ((powerNm / powerRpm) * (powerRpm - peakRpm)) / drop;
      torque = peakNm - drop * fallingSegment((rpm - peakRpm) / (powerRpm - peakRpm), beta);
    }
  } else {
    // Leiderman past the power peak: P ∝ x + x² - x³, so T ∝ 1 + x - x².
    const x = rpm / powerRpm;
    torque = powerNm * (1 + x - x * x);
  }

  return torque > 0 ? torque * fuelCutFade(rpm, cutRpm) : 0;
}

/**
 * Share of fuelling the soft limiter leaves at this crank speed: 1 below its ramp,
 * easing to 0 at the cut. It scales the GROSS torque, so an engine on its cut is
 * motored — it still costs its friction — rather than running free.
 */
export function fuelCutFade(rpm: number, cutRpm: number): number {
  const ramp = (cutRpm - rpm) / LIMITER_RAMP_RPM;
  if (ramp >= 1) return 1;
  if (ramp <= 0) return 0;
  return ramp * ramp * (3 - 2 * ramp);
}

/**
 * Whether a driver at full throttle gains by changing up now: the next, taller gear
 * (`nextRatio`) puts at least as much force on the road at this road speed as the
 * current one (`ratio`, turning the crank at `rpm`), or the current gear has run
 * into the limiter ramp and cannot go on.
 *
 * Wheel force is `T(rpm) · ratio · final drive · efficiency / radius`, and everything
 * after the ratio is shared by both gears, so the comparison is `T · ratio`. That is
 * the power-optimal change point: below it the lower gear pulls harder, above it the
 * taller one does. Below the torque peak it can never fire — the taller gear turns
 * the crank slower, where this curve makes no more torque — and at or below idle
 * there is nothing to compare, so it needs no speed gate.
 *
 * Pure and exported because it is one definition of "shifting well": the automatic
 * uses it at wide-open throttle, and the reality bench drives its factory-style
 * manual 0-100 runs on it.
 */
export function fullThrottleUpshiftDue(
  engine: EngineSpec,
  rpm: number,
  ratio: number,
  nextRatio: number,
  cutRpm: number = engine.redlineRpm,
): boolean {
  if (!(ratio > 0) || !(nextRatio > 0) || !(rpm > engine.idleRpm)) return false;
  if (rpm >= cutRpm - LIMITER_RAMP_RPM) return true;
  const nextRpm = (rpm * nextRatio) / ratio;
  return (
    engineTorqueNm(engine, nextRpm, cutRpm) * nextRatio >=
    engineTorqueNm(engine, rpm, cutRpm) * ratio
  );
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
   * Rotating inertia the CRANK adds to one driven wheel, kg·m², or 0 when the clutch
   * is open (neutral, mid-shift, no gearbox).
   *
   * This is the term whose absence made a bumpy road undriveable. A driven wheel is
   * not a free disc: it is bolted through the gears to a crankshaft and a flywheel,
   * and gearing multiplies that inertia by the SQUARE of the ratio. Without it the
   * only thing resisting drive torque was the wheel's own ~1.2 kg·m², so a first-gear
   * 2000 N·m at the wheel spun it up 13 rad/s — nearly 5 m/s of slip — in a single
   * 60 Hz step. Any dip in load (a pothole, a crest, a bump) was therefore an instant
   * wheelspin, traction control cut 85% of the torque to answer it, and the car could
   * not accelerate: measured on the real road collider, 0-100 km/h took 14.8 s
   * against 8.6 s on a flat plane of the same asphalt, with the aid then fitted lit 68% of
   * the run (tools/surface-feel.ts).
   *
   * `drivenWheels` is the divisor because that is how the torque is split. Through an
   * open differential the crank speed is the MEAN of the driven wheel speeds, so the
   * exact system is an n x n mass matrix: `I·k²/n²` on the diagonal and the same value
   * off it. This returns the diagonal — the value that is exactly right for the case
   * that matters, ONE wheel breaking away on its own — and leaves the coupling out, so
   * a wheel is never restrained by inertia it does not really have.
   */
  drivenWheelInertiaKgM2(drivenWheels: number): number {
    const gearbox = this.gearbox;
    const engine = this.engine;
    if (gearbox == null || engine == null || this.gear === GEAR_NEUTRAL || this.shiftTimer > 0) {
      return 0;
    }
    if (drivenWheels <= 0) return 0;
    const total = Math.abs(this.gearRatio() * gearbox.finalDrive);
    return (crankInertiaKgM2(engine) * total * total) / (drivenWheels * drivenWheels);
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
   * Torque scale and rev ceiling imposed from outside, both 0..1.
   *
   * Only the cooling system writes these (see `Vehicle.fixedUpdate`), and they exist
   * here rather than in the caller because torque and crank speed are produced here:
   * scaling the delivered wheel torque afterwards would leave the fuel burn, the
   * engine braking and the rev limit all describing an engine that is not the one
   * making power.
   */
  private thermalPerformance = 1;
  private thermalRevLimit = 1;

  setThermalLimits(performance: number, revLimit: number): void {
    this.thermalPerformance = clamp(Number.isFinite(performance) ? performance : 1, 0, 1);
    this.thermalRevLimit = clamp(Number.isFinite(revLimit) ? revLimit : 1, 0.4, 1);
  }

  /**
   * Net full-throttle crank torque this engine can make at `rpm` right now: the
   * catalogue curve (`engineTorqueNm`) with the cooling system's two limits applied.
   *
   * The cut moves DOWN with the thermal rev limit, which is what makes an
   * overheating engine refuse the last part of its rev range instead of simply
   * making less torque everywhere: holding a boiling engine off the redline is the
   * one thing that lets it cool while still moving the car.
   */
  private wotTorqueNm(rpm: number): number {
    const e = this.engine;
    if (e == null) return 0;
    return engineTorqueNm(e, rpm, e.redlineRpm * this.thermalRevLimit) * this.thermalPerformance;
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
      // In first/reverse, below the road speed corresponding to the requested crank
      // speed, the clutch slips instead of dragging the engine down to idle. This is
      // the hill-start behaviour a manual driver gets by raising the revs and feeding
      // the clutch. Taller gears stay rigidly coupled; otherwise every upshift below
      // the torque peak would silently ride the clutch.
      const total = this.gearRatio() * gearbox.finalDrive;
      crankSpeed = wheelAngularSpeed * total;
      const gearedRpm = Math.abs(crankSpeed) * RPM_PER_RAD_PER_SEC;
      const launchGear = this.gear === 1 || this.gear === GEAR_REVERSE;
      const clutchRpm = launchGear
        ? engine.idleRpm + demand * Math.max(0, engine.torquePeakRpm - engine.idleRpm)
        : gearedRpm;
      this.rpmValue = clamp(
        Math.max(gearedRpm, clutchRpm),
        engine.idleRpm,
        engine.redlineRpm,
      );
    }
    const crankSpeedAbs = Math.max(
      Math.abs(crankSpeed),
      demand > 0 ? this.rpmValue / RPM_PER_RAD_PER_SEC : 0,
    );

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

      // Mechanical friction + pumping at OPEN throttle, from the TRUE geared crank
      // speed. It is the base the closed-throttle engine braking is built from, and
      // the part-throttle blend below runs through it: the catalogue curve is NET
      // torque, so full throttle must return exactly that curve and a shut throttle
      // exactly minus the friction,
      //
      //   net = (T_wot + friction) * demand - friction,
      //
      // which is the engine's gross torque scaled by the pedal and then charged its
      // own losses — engine braking and part-throttle response as the traffic and
      // the autopilot were tuned on.
      const frictionCrank =
        engine.brakingCoeff * crankSpeedAbs + PUMPING_LOSS_FRACTION * engine.peakTorqueNm;
      // The limiter cuts FUEL, so it fades the gross torque, friction's share included:
      // floored at the cut the net is minus the friction (the engine is motored and
      // brakes), not zero, and there is no positive work left to burn fuel on.
      const fuelled = fuelCutFade(this.rpmValue, engine.redlineRpm * this.thermalRevLimit);
      const driveCrank =
        (this.wotTorqueNm(this.rpmValue) + frictionCrank * fuelled) * demand; // >= 0

      const netCrank = driveCrank - frictionCrank; // signed Nm at the crank

      if (netCrank >= 0) {
        // Driving: the gear carries the direction (forward or reverse), and the
        // gearbox's efficiency is what the gears, bearings, propshafts and
        // differentials take out of the crank's torque on the way to the hubs.
        driveTorqueNm = netCrank * total * gearbox.efficiency;
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
        //
        // No efficiency term here, deliberately. Driven backwards the driveline's
        // own losses ADD to the drag instead of taking a share of it, so the
        // physical correction would be a division, not a multiplication — and it
        // would be a few per cent of an overrun drag whose factor
        // (CLOSED_THROTTLE_BRAKE_FACTOR) is itself only known to that precision.
        // Leaving it out keeps engine braking exactly where it was tuned.
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
    // redline at full throttle — or the thermal ceiling, when one is imposed, so a
    // driver blipping a boiling engine in neutral cannot rev it past the limit the
    // gears already respect.
    const ceiling = engine.redlineRpm * this.thermalRevLimit * 0.95;
    const target = engine.idleRpm + throttle * Math.max(0, ceiling - engine.idleRpm);
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
   *
   * At wide-open throttle the upshift is power-optimal (`fullThrottleUpshiftDue`);
   * below it the 0.8-redline rule holds. The downshift rule and the idle margin
   * guard both, so neither upshift rule can hunt.
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
    const ratio = Math.abs(this.ratioOfGear(this.gear));
    const current = wheelAbs * ratio;

    if (this.gear < n) {
      const nextRatio = Math.abs(this.ratioOfGear(this.gear + 1));
      const due =
        throttle >= WOT_SHIFT_THROTTLE
          ? fullThrottleUpshiftDue(
              engine,
              current,
              ratio,
              nextRatio,
              engine.redlineRpm * this.thermalRevLimit,
            )
          : current > engine.redlineRpm * UP_SHIFT_RPM_FRACTION;
      // Never upshift into a gear that cannot pull: the taller gear must still
      // leave the engine clear of idle, or the box would hunt straight back down.
      if (due && wheelAbs * nextRatio > engine.idleRpm * UP_SHIFT_IDLE_MARGIN) {
        this.setGear(this.gear + 1);
        return;
      }
    }
    if (this.gear > 1 && current < engine.redlineRpm * DOWN_SHIFT_RPM_FRACTION) {
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
