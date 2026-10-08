/**
 * Pure drivetrain simulation: crank, clutch, gears, engine braking and fuel.
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
 * keeps it. Launches do not depend on it: a standing start slips the clutch at the
 * torque peak (see the automatic clutch note).
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
 * closed throttle. Scaled by engine size so a big V8 resists far more than
 * a small four at the same crank speed.
 */
const PUMPING_LOSS_FRACTION = 0.03;

/*
 * ---- the turbocharger ----
 *
 * A bolt-on exhaust turbine (bonnet cell 1) over an engine built without one. It
 * adds torque in proportion to its BOOST, 0..1, and the boost is the whole feel of
 * the thing:
 *
 *  - it wants exhaust: nothing below `TURBO_SPOOL_START` of the rev range, full
 *    boost from `TURBO_SPOOL_FULL`, and in proportion to the pedal in between;
 *  - it lags: the wheel takes `TURBO_SPOOL_UP_S` to wind up and sheds boost faster
 *    when the pedal comes up, so a turbo car pulls late and then hard.
 *
 * At full boost the curve is `1 + TURBO_TORQUE_GAIN` times the engine's own, so the
 * power, the fuel burned on it and the heat into the water (vehicle/cooling.ts) all
 * rise together.
 */
export const TURBO_TORQUE_GAIN = 0.35;
const TURBO_SPOOL_START = 0.3;
const TURBO_SPOOL_FULL = 0.6;
const TURBO_SPOOL_UP_S = 0.8;
const TURBO_SPOOL_DOWN_S = 0.35;
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
 * It MUST be applied only to the closed-throttle end of the pedal. Scaling the
 * drive path instead would bleed engine friction out of the part-throttle blend
 * (`update`) and move every part-throttle response the traffic and the autopilot
 * are tuned on. The closed-throttle pumping fades out over the first
 * `PART_THROTTLE_PUMPING_FADE` of pedal (`crankTorqueNm`), so the overrun drag is
 * continuous with the part-throttle blend instead of jumping at a pedal of zero, and
 * from that pedal up the blend is exactly what it always was.
 */
const CLOSED_THROTTLE_BRAKE_FACTOR = 2.5;
/** Pedal over which the closed-throttle pumping fades into the open-throttle friction. */
const PART_THROTTLE_PUMPING_FADE = 0.1;
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
/**
 * An upshift must also land the taller gear this far above the downshift point, on
 * ROAD speed. The shift itself costs speed: the clutch is open for `shiftTime`, and on
 * sand the rolling resistance takes most of a metre per second off the car in that
 * time. Landing exactly on the downshift point, the box took second at the top of
 * first and dropped straight back into it the moment the shift completed, for good.
 */
const UP_SHIFT_HOLD_MARGIN = 1.15;
/** Throttle at which an automatic in neutral or reverse engages first gear. */
const AUTO_ENGAGE_THROTTLE = 0.12;
/** Road speed below which neutral may engage drive while the car is still rolling. */
const AUTO_NEUTRAL_ENGAGE_MPS = 2;
/** Forward speed below which an automatic may safely change drive direction. */
const AUTO_DIRECTION_CHANGE_MPS = 0.25;

/** Flywheel time constants: cranks rev up quickly and fall back more slowly. */
const FLYWHEEL_UP_TAU = 0.12;
const FLYWHEEL_DOWN_TAU = 0.35;

/*
 * ---- the automatic clutch ----
 *
 * There is no clutch pedal; a controller works the clutch in both gearbox modes, the
 * way a period automated manual does. The clutch is one of four states:
 *
 *   open     neutral or mid-shift: nothing crosses it, and the crank follows the
 *            pedal (`freeRev`) or, mid-shift, the speed the next gear will take.
 *   launch   the gearbox side would turn the crank below idle (pulling away, or
 *            stopping in gear). The controller loads the engine to hold it at the
 *            BITE speed, idle plus the pedal's share of the way to the torque peak,
 *            so a standing start in any gear pulls at the torque the pedal asks for
 *            and a stop never stalls the engine. It locks once the car catches up.
 *   sync     closing after a shift (or after an overload broke it loose). The clutch
 *            carries what the driver's pedal will deliver once locked and the engine
 *            management brings the crank to the gearbox's speed: fuel is cut while the
 *            crank is fast, and in the automatic mode the throttle is blipped while it
 *            is slow. In the manual mode there is no blip — a downshift without the
 *            driver's own blip closes the clutch over `MANUAL_SYNC_TAU_S` and the
 *            gearbox drags the crank up through the wheels: a real shunt.
 *   locked   crank and gearbox turn together; the crank's inertia rides on the driven
 *            wheels (`drivenWheelInertiaKgM2`) and its torque, positive or the overrun
 *            drag, goes straight through. It breaks loose into `sync` when holding it
 *            would take more than `CLUTCH_CAPACITY_FACTOR` of peak torque.
 *
 * A slipping clutch only ever passes torque from the faster side to the slower one,
 * which is what keeps the engine braking out of a launch and the drive out of a stop.
 * The crank is a real state while it slips: torque in, clutch torque out, over the
 * crank's own inertia (`crankInertiaKgM2`).
 */
/**
 * Clutch torque capacity as a multiple of the engine's peak torque. Period clutches
 * are sized at 1.3-1.6 times the engine they sit behind; a turbo's boost eats most of
 * that margin, which is where "slips under extreme load" comes from.
 */
const CLUTCH_CAPACITY_FACTOR = 1.5;
/** Seconds for the clutch to clamp from open to its full capacity. */
const CLUTCH_ENGAGE_S = 0.12;
/** Time constant the launch controller pulls the crank to the bite speed with, s. */
const LAUNCH_SLIP_TAU_S = 0.15;
/** Time constant of the engine management's rev-match while the clutch closes, s. */
const SYNC_TAU_S = 0.12;
/**
 * Time constant the manual mode's clutch drags an unmatched crank up to the gearbox's
 * speed with, s. Long enough that a sane downshift's shunt stays inside the rear
 * tyres; a downshift that lands near the redline still chirps them.
 */
const MANUAL_SYNC_TAU_S = 0.3;
/**
 * The slowest a closing clutch's controller lets the slip shrink, rad/s² at the crank
 * (about 2000 rpm a second): the exponential approach alone would leave a tail of
 * slip that never quite closes.
 */
const CLUTCH_SYNC_MIN_ACCEL_RAD_S2 = 200;
/** Slip at which a closing clutch counts as locked, rad/s at the crank (~20 rpm). */
const CLUTCH_LOCK_SLIP_RAD_S = 2;

type ClutchState = 'open' | 'launch' | 'sync' | 'locked';

/**
 * Idle fuel burn fudge. The pumping-work estimate alone under-predicts real
 * idle consumption (~0.5–1 L/h for a small engine) because it ignores accessory
 * load and the poor thermal efficiency off-load; ×6 lands it in that range.
 */
const IDLE_BURN_FACTOR = 6;

export interface DrivetrainOutput {
  /**
   * Wheel torque through the clutch, Nm, summed over the driven wheels, in the wheel's
   * own sense: positive pushes the car forward. Driving in a forward gear it is
   * positive and in reverse negative; the engine's overrun drag (engine braking)
   * comes out with the opposite sign of the gear, so it acts at the driven tyres like
   * any other torque. Zero with the clutch open.
   */
  readonly driveTorqueNm: number;
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
 * lands 0.17 kg·m² for the 1.2 and about 0.4 for the 5.7 V8 — the range real
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
  if (engine.torqueCurve && engine.torqueCurve.length >= 2) {
    const torque = publishedCurveNm(engine, engine.torqueCurve, rpm);
    return torque > 0 ? torque * fuelCutFade(rpm, cutRpm) : 0;
  }
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
 * A published curve (`EngineSpec.torqueCurve`) read at `rpm`.
 *
 * Between its points: a monotone cubic Hermite with Fritsch-Carlson slopes, which
 * passes through every point, keeps a plateau flat and never invents a bump the data
 * does not have. Below the first point it rises from the idle torque the two-point
 * curve also uses; past the last it falls as the two-point curve does past its power
 * peak (Leiderman, `T ∝ 1 + x - x²`), from wherever the data ends.
 */
function publishedCurveNm(
  engine: EngineSpec,
  points: readonly (readonly [number, number])[],
  rpm: number,
): number {
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (rpm <= first[0]) {
    const idleNm = IDLE_TORQUE_FRACTION * engine.peakTorqueNm;
    if (rpm <= engine.idleRpm || first[0] <= engine.idleRpm) return rpm < first[0] ? idleNm : first[1];
    return idleNm + ((first[1] - idleNm) * (rpm - engine.idleRpm)) / (first[0] - engine.idleRpm);
  }
  if (rpm >= last[0]) {
    const x = rpm / last[0];
    return last[1] * (1 + x - x * x);
  }
  let i = 0;
  while (points[i + 1]![0] < rpm) i++;
  const secant = (k: number): number =>
    (points[k + 1]![1] - points[k]![1]) / (points[k + 1]![0] - points[k]![0]);
  const slope = (k: number): number => {
    if (k === 0) return secant(0);
    if (k === points.length - 1) return secant(k - 1);
    const a = secant(k - 1);
    const b = secant(k);
    // Fritsch-Carlson: flat at a turning point, the harmonic mean elsewhere.
    return a * b <= 0 ? 0 : (2 * a * b) / (a + b);
  };
  const [x0, y0] = points[i]!;
  const [x1, y1] = points[i + 1]!;
  const h = x1 - x0;
  const t = (rpm - x0) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * y0 +
    (t3 - 2 * t2 + t) * h * slope(i) +
    (-2 * t3 + 3 * t2) * y1 +
    (t3 - t2) * h * slope(i + 1)
  );
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

/**
 * How far `matchGearbox` may re-gear a body's final drive, as a multiple of it. Wide
 * enough for a 5.7 V8 in a Zhiguli; narrow enough that a pairing the road-load model
 * places badly still leaves a first gear that pulls away.
 */
const MATCH_FINAL_DRIVE_MIN = 0.55;
const MATCH_FINAL_DRIVE_MAX = 1.6;

/** Road speed, m/s, at which `powerW` holds a car against its rolling and air drag. */
function roadLoadTopSpeed(powerW: number, rollingForceN: number, dragCoeff: number): number {
  // (F_roll + c·v²)·v rises monotonically with v, so a bisection cannot miss.
  let lo = 0;
  let hi = 150;
  for (let i = 0; i < 40; i++) {
    const v = 0.5 * (lo + hi);
    if ((rollingForceN + dragCoeff * v * v) * v < powerW) lo = v;
    else hi = v;
  }
  return lo;
}

/**
 * The gearbox a body runs once `engine` replaces its factory `stockEngine`: the
 * swap brings a box geared for the new engine, silently, because a player choosing
 * ratios by hand is a spreadsheet, not a game.
 *
 * The ratios, reverse, shift time, efficiency and automatic flag stay the body's:
 * they belong to its driveline (a rear axle, a transaxle, a transfer case), not to
 * the engine. What moves is the final drive, so that top gear meets the new engine's
 * power peak at the road speed its power can actually hold against this body's
 * rolling resistance and drag. It is scaled against the factory pairing rather than
 * set from first principles, so a stock car is returned unchanged and every swap
 * keeps the character the factory geared the car with: a car geared a little short
 * for acceleration stays a little short with any engine.
 */
export function matchGearbox(
  box: GearboxSpec,
  stockEngine: EngineSpec,
  engine: EngineSpec,
  rollingForceN: number,
  dragCoeff: number,
): GearboxSpec {
  if (engine === stockEngine) return box;
  const stockTop = roadLoadTopSpeed(stockEngine.peakPowerKw * 1000 * box.efficiency, rollingForceN, dragCoeff);
  const top = roadLoadTopSpeed(engine.peakPowerKw * 1000 * box.efficiency, rollingForceN, dragCoeff);
  if (!(stockTop > 0) || !(top > 0)) return box;
  const scale = clamp(
    (engine.powerPeakRpm / stockEngine.powerPeakRpm) * (stockTop / top),
    MATCH_FINAL_DRIVE_MIN,
    MATCH_FINAL_DRIVE_MAX,
  );
  return { ...box, finalDrive: box.finalDrive * scale };
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
  /** See the automatic clutch note. */
  private clutch: ClutchState = 'open';
  /** How far the closing clutch has clamped, 0..1 of `CLUTCH_CAPACITY_FACTOR`. */
  private engagement = 0;
  /** Gearbox-side clutch speed last tick, rad/s at the crank, for the overload check. */
  private lastInputRadS = 0;

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
    this.clutch = 'open';
    this.engagement = 0;
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
   * A forward pull cannot come from the gears right now: neutral or reverse is in, or a
   * shift is under way. False with no gearbox at all, which has nothing to interrupt.
   */
  get isForwardDriveInterrupted(): boolean {
    return this.gearbox != null && (this.gear < 1 || this.shiftTimer > 0);
  }

  /**
   * THE PEDAL THAT PUTS `forceN` ON THE ROAD at `roadSpeed`, in the gear a car pulling
   * away uses: the engaged forward gear, first from neutral, reverse, or mid-shift, and
   * reverse when `reverse` is asked. The inverse of `crankTorqueNm` above its pumping
   * fade, through the gearbox's efficiency, read at the crank speed the wheels give or
   * idle, whichever is higher: a launch holds the crank at or above idle, so this is
   * what the pedal needs at most. 1 when no pedal is enough.
   *
   * For the traffic driver's hill starts: a proportional pedal at walking pace asks for
   * a fifth of the pedal, and through `net = (T + friction)·pedal − friction` that is a
   * few percent of the engine — less than a 5% grade takes to stand still on.
   */
  throttleForWheelForce(forceN: number, roadSpeed: number, wheelRadius: number, reverse: boolean): number {
    const engine = this.engine;
    const gearbox = this.gearbox;
    if (engine == null || gearbox == null || forceN <= 0 || !(wheelRadius > 0)) return 0;
    const ratio = reverse
      ? Math.abs(gearbox.reverse)
      : this.ratioOfGear(this.gear >= 1 ? this.gear : 1);
    const total = ratio * gearbox.finalDrive;
    if (!(total > 0)) return 1;
    const crankRad = Math.max(engine.idleRpm / RPM_PER_RAD_PER_SEC, (Math.abs(roadSpeed) / wheelRadius) * total);
    const rpm = clamp(crankRad * RPM_PER_RAD_PER_SEC, engine.idleRpm, engine.redlineRpm);
    const netNm = (forceN * wheelRadius) / (total * gearbox.efficiency);
    const friction = engine.brakingCoeff * crankRad + PUMPING_LOSS_FRACTION * engine.peakTorqueNm;
    return clamp((netNm + friction) / (this.wotTorqueNm(rpm) + friction), 0, 1);
  }

  /** Direction the selected gear drives the car: 1 forward, -1 reverse, 0 neutral. */
  get gearDirection(): number {
    return this.gearbox == null ? 0 : Math.sign(this.gear);
  }

  /** The clutch is locked: the crank turns with the driven wheels. */
  private get coupled(): boolean {
    return (
      this.gearbox != null &&
      this.engine != null &&
      this.gear !== GEAR_NEUTRAL &&
      this.shiftTimer <= 0 &&
      this.clutch === 'locked'
    );
  }

  /**
   * Wheel speed (rad/s) the engaged gear allows before the engine would pass its
   * redline, or Infinity when the clutch is not locked (neutral, mid-shift, slipping,
   * no gearbox). A driven wheel locked to the crank through the gears has this hard
   * ceiling on how fast it can be spun up no matter how little grip the tyre has —
   * which is what bounds wheelspin instead of letting a slipping wheel run away. A
   * slipping clutch bounds it instead: a wheel that catches the crank locks it.
   */
  get maxDrivenWheelSpinRadS(): number {
    const gearbox = this.gearbox;
    const engine = this.engine;
    if (gearbox == null || engine == null || !this.coupled) return Infinity;
    const total = Math.abs(this.gearRatio() * gearbox.finalDrive);
    return total > 0 ? engine.redlineRpm / RPM_PER_RAD_PER_SEC / total : Infinity;
  }

  /**
   * Rotating inertia the CRANK adds to one driven wheel, kg·m², or 0 when the clutch
   * is not locked (neutral, mid-shift, slipping, no gearbox): a slipping clutch passes
   * a torque set by its own friction, not by the crank's acceleration.
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
    if (gearbox == null || engine == null || !this.coupled || drivenWheels <= 0) return 0;
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

  /** A turbocharger is fitted (bonnet cell 1). */
  private turboFitted = false;
  /** Current boost, 0..1; see the turbocharger note above. */
  private boostValue = 0;
  /** Share of torque the air filter lets the engine breathe for (vehicle/airfilter.ts). */
  private intakeBreath = 1;

  /**
   * The intake side, set by the Vehicle from the bonnet: whether a turbo is fitted,
   * and how freely the air filter breathes. Like the thermal limits, these act on the
   * torque where it is made, so fuel and engine braking describe the same engine.
   */
  setInduction(turboFitted: boolean, breath: number): void {
    this.turboFitted = turboFitted;
    if (!turboFitted) this.boostValue = 0;
    this.intakeBreath = clamp(Number.isFinite(breath) ? breath : 1, 0, 1);
  }

  /** Turbo boost right now, 0..1. Zero with no turbocharger fitted. */
  get boost(): number {
    return this.boostValue;
  }

  private updateBoost(dt: number, demand: number, engine: EngineSpec | null): void {
    if (!this.turboFitted || engine == null) {
      this.boostValue = 0;
      return;
    }
    const rev = this.rpmValue / engine.redlineRpm;
    const u = clamp((rev - TURBO_SPOOL_START) / (TURBO_SPOOL_FULL - TURBO_SPOOL_START), 0, 1);
    const target = demand * u * u * (3 - 2 * u);
    const tau = target > this.boostValue ? TURBO_SPOOL_UP_S : TURBO_SPOOL_DOWN_S;
    this.boostValue += (target - this.boostValue) * (1 - Math.exp(-dt / tau));
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
    return (
      engineTorqueNm(e, rpm, e.redlineRpm * this.thermalRevLimit) *
      this.thermalPerformance *
      this.intakeBreath *
      (1 + TURBO_TORQUE_GAIN * this.boostValue)
    );
  }

  /**
   * Advance the simulation by dt. `autoShift` is the driver's gearbox-mode
   * preference (the settings value), passed per call rather than stored: it is
   * player input that can change at any tick boundary, not vehicle hardware, so
   * a per-call argument keeps this class's behaviour fully determined by each
   * call — an AI driver or a replay cannot forget to configure it, and there is
   * no second configuration channel beside the fitted parts (reconfigure). The
   * decision itself is the OR of hardware and driver: see the gate below.
   *
   * Two wheel speeds, because they answer two different questions. The crank is
   * geared to the DRIVEN wheels (`drivenWheelAngularSpeed`), so a spinning tyre revs
   * the engine out towards its cut and the torque it makes there is what bounds the
   * spin — the tachometer and the engine note show it too. The gearbox decides on
   * ROAD speed (`wheelAngularSpeed`) where it matters: a wheel locked under braking
   * is not a reason to drop to first (see `automaticShift`).
   */
  update(
    dt: number,
    throttle: number,
    wheelAngularSpeed: number,
    drivenWheelAngularSpeed: number,
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
        drivenWheelAngularSpeed,
        wheelRadius,
        reverseRequested,
      );
    }

    if (engine == null) {
      this.rpmValue = 0;
      this.clutch = 'open';
      this.engagement = 0;
      return { driveTorqueNm: 0, rpm: 0, fuelBurnLitres: 0 };
    }

    const automated = gearbox != null && (gearbox.automatic || autoShift);
    const total = gearbox == null ? 0 : this.gearRatio() * gearbox.finalDrive; // signed: reverse is -
    // The clutch's gearbox side, at crank speed: the mean of the driven wheels, which is
    // what an open differential turns the propshaft at.
    const inputRad = drivenWheelAngularSpeed * total;
    const lastInputRad = this.lastInputRadS;
    this.lastInputRadS = inputRad;
    // The crank speed a launch holds the engine at: idle, plus the pedal's share of the
    // way to the torque peak.
    const biteRpm = engine.idleRpm + demand * Math.max(0, engine.torquePeakRpm - engine.idleRpm);

    if (gearbox == null || this.gear === GEAR_NEUTRAL || this.shiftTimer > 0) {
      // Clutch open: the crank free-revs. It idles at a shut throttle and approaches
      // (but never reaches) the redline at full — or the thermal ceiling, so a driver
      // blipping a boiling engine cannot rev it past the limit the gears respect.
      const ceilingRpm = engine.redlineRpm * this.thermalRevLimit * 0.95;
      let targetRpm = engine.idleRpm + demand * Math.max(0, ceilingRpm - engine.idleRpm);
      // Mid-shift the engine management steers the crank toward the speed the NEW gear
      // will take: fuel is cut while the pedal would carry it past that (both modes —
      // lifting for the change is what every driver does), and in the automatic mode
      // the throttle is blipped up to it on a downshift. In the manual mode a
      // downshift is matched by the driver's own blip or not at all. A gear going in
      // below idle is a pull-away: the crank follows the pedal up to the bite the
      // launch will hold it at, as a driver raises the revs with the clutch down.
      if (this.gear !== GEAR_NEUTRAL) {
        const gearboxRpm = inputRad * RPM_PER_RAD_PER_SEC;
        if (gearboxRpm < engine.idleRpm) {
          targetRpm = Math.min(targetRpm, biteRpm);
        } else {
          const matchedRpm = Math.min(gearboxRpm, ceilingRpm);
          if (targetRpm > matchedRpm || automated) targetRpm = matchedRpm;
        }
      }
      const tau = targetRpm > this.rpmValue ? FLYWHEEL_UP_TAU : FLYWHEEL_DOWN_TAU;
      this.rpmValue += (targetRpm - this.rpmValue) * (1 - Math.exp(-dt / tau));
      this.clutch = 'open';
      this.engagement = 0;
      this.updateBoost(dt, demand, engine);
      // Idle burn: keeping the engine turning with no load in neutral.
      const idling = this.gear === GEAR_NEUTRAL && this.shiftTimer <= 0;
      return { driveTorqueNm: 0, rpm: this.rpmValue, fuelBurnLitres: idling ? this.idleBurnLps * dt : 0 };
    }

    // A gear is in and the clutch is closing or closed. Below idle at the gearbox side
    // the engine would stall, so the controller slips it as for a launch.
    const idleRad = engine.idleRpm / RPM_PER_RAD_PER_SEC;
    if (this.clutch === 'open') this.clutch = inputRad < idleRad ? 'launch' : 'sync';
    else if (inputRad < idleRad) this.clutch = 'launch';

    const inertia = crankInertiaKgM2(engine);
    const capacity = CLUTCH_CAPACITY_FACTOR * engine.peakTorqueNm;
    let crankRad = this.rpmValue / RPM_PER_RAD_PER_SEC;
    let engineNm = 0;
    let clutchNm = 0;

    if (this.clutch === 'locked') {
      this.rpmValue = clamp(inputRad * RPM_PER_RAD_PER_SEC, engine.idleRpm, engine.redlineRpm);
      this.updateBoost(dt, demand, engine);
      engineNm = this.crankTorqueNm(engine, inputRad, demand);
      // What holding the lock takes: the engine's torque less what swings the crank at
      // the rate the wheels are imposing. A landing on spinning wheels or a wheel
      // snatched by a rut asks more than the clutch holds, and it slips.
      const holdingNm = dt > 0 ? engineNm - (inertia * (inputRad - lastInputRad)) / dt : engineNm;
      if (Math.abs(holdingNm) > capacity) {
        this.clutch = 'sync';
        this.engagement = 1;
      } else {
        clutchNm = engineNm;
        crankRad = inputRad;
      }
    } else {
      this.updateBoost(dt, demand, engine);
      this.engagement = Math.min(1, this.engagement + dt / CLUTCH_ENGAGE_S);
    }

    if (this.clutch !== 'locked') {
      const slip = crankRad - inputRad;
      const pedalNm = this.crankTorqueNm(engine, crankRad, demand);
      // The torque that closes the slip over `tau`, never slower than
      // CLUTCH_SYNC_MIN_ACCEL_RAD_S2 so the last of it closes in finite time and locks.
      const syncNm = (tau: number): number =>
        inertia * Math.sign(slip) * Math.max(Math.abs(slip) / tau, CLUTCH_SYNC_MIN_ACCEL_RAD_S2);
      // The torque the controller asks the clutch for, before its friction decides.
      let wantNm: number;
      if (this.clutch === 'launch') {
        engineNm = pedalNm;
        wantNm = engineNm + (inertia * (crankRad - biteRpm / RPM_PER_RAD_PER_SEC)) / LAUNCH_SLIP_TAU_S;
      } else if (slip > 0) {
        // Crank fast (an upshift): carry what the pedal will deliver once locked and cut
        // fuel to bring the crank down to it, never fuelling past the pedal.
        wantNm = Math.max(0, this.crankTorqueNm(engine, inputRad, demand));
        engineNm = clamp(wantNm - syncNm(SYNC_TAU_S), this.crankTorqueNm(engine, crankRad, 0), pedalNm);
      } else if (automated) {
        // Crank slow (a downshift), automatic: blip it up while the clutch carries the
        // overrun drag the pedal will have once locked.
        wantNm = Math.min(0, this.crankTorqueNm(engine, inputRad, demand));
        engineNm = clamp(wantNm - syncNm(SYNC_TAU_S), pedalNm, this.crankTorqueNm(engine, crankRad, 1));
      } else {
        // Crank slow, manual: the gearbox drags it up through the clutch — the shunt.
        engineNm = pedalNm;
        wantNm = engineNm + syncNm(MANUAL_SYNC_TAU_S);
      }
      // A slipping clutch only passes torque from the faster side to the slower, and
      // no more than it has clamped.
      const capNm = this.engagement * capacity;
      clutchNm = clamp(wantNm, slip > 0 ? 0 : -capNm, slip < 0 ? 0 : capNm);
      crankRad += (dt * (engineNm - clutchNm)) / inertia;
      const after = crankRad - inputRad;
      const locks =
        this.clutch === 'launch'
          ? after <= 0 && inputRad >= idleRad
          : after * slip <= 0 || Math.abs(after) < CLUTCH_LOCK_SLIP_RAD_S;
      if (locks) {
        this.clutch = 'locked';
        this.engagement = 1;
        crankRad = inputRad;
      }
      // The idle governor holds the floor; a gearbox dragging the crank over the
      // redline is the one thing that can carry it past.
      crankRad = clamp(crankRad, idleRad, Math.max(engine.redlineRpm / RPM_PER_RAD_PER_SEC, inputRad));
      this.rpmValue = crankRad * RPM_PER_RAD_PER_SEC;
    }

    // Into the gears: their efficiency is what the gears, bearings, propshafts and
    // differentials take out of a driving torque on the way to the hubs. Not out of the
    // overrun drag, deliberately. Driven backwards the driveline's own losses ADD to the
    // drag instead of taking a share of it, so the physical correction would be a
    // division, not a multiplication — and it would be a few per cent of a drag whose
    // factor (CLOSED_THROTTLE_BRAKE_FACTOR) is itself only known to that precision.
    const driveTorqueNm = clutchNm * total * (clutchNm > 0 ? gearbox.efficiency : 1);

    // Fuel on positive mechanical work, via bsfc (litres per kWh): the gross torque the
    // engine made, which is its net plus its own friction.
    const workRad = Math.abs(crankRad);
    const grossNm =
      engineNm + engine.brakingCoeff * workRad + PUMPING_LOSS_FRACTION * engine.peakTorqueNm;
    const fuelBurnLitres = (((Math.max(0, grossNm) * workRad) / 1000) * engine.bsfc) / 3600 * dt;

    return { driveTorqueNm, rpm: this.rpmValue, fuelBurnLitres };
  }

  /**
   * NET crank torque at crank speed `crankRad` (rad/s) and pedal `demand`. The
   * catalogue curve is net torque, so a full pedal returns exactly that curve and a
   * part pedal the gross torque it opens up, charged the engine's own losses:
   *
   *   net = (T_wot + friction) * demand - friction,
   *
   * the part-throttle response the traffic and the autopilot were tuned on. Below
   * `PART_THROTTLE_PUMPING_FADE` of pedal the friction grows into the closed-throttle
   * overrun drag, `CLOSED_THROTTLE_BRAKE_FACTOR` times it: engine braking.
   *
   * Friction and drag are read at the TRUE crank speed, which a gear dragging the crank
   * puts past its redline: an over-revving engine drags harder — the whole point of
   * engine braking in too low a gear — with the over-rev share soft-capped
   * (`OVER_REV_BRAKE_GAIN`) so it cannot run away. The fuelling reads the crank clamped
   * to its rev range, so a 1st-gear over-rev cuts fuel yet still brakes far harder than
   * 2nd.
   */
  private crankTorqueNm(engine: EngineSpec, crankRad: number, demand: number): number {
    const rpm = clamp(crankRad * RPM_PER_RAD_PER_SEC, engine.idleRpm, engine.redlineRpm);
    const pumping = PUMPING_LOSS_FRACTION * engine.peakTorqueNm;
    const friction = engine.brakingCoeff * crankRad + pumping;
    // The limiter cuts FUEL, so it fades the gross torque, friction's share included:
    // floored at the cut the net is minus the friction (the engine is motored and
    // brakes), not zero, and there is no positive work left to burn fuel on.
    const fuelled = fuelCutFade(rpm, engine.redlineRpm * this.thermalRevLimit);
    const drive = (this.wotTorqueNm(rpm) + friction * fuelled) * demand;
    const overrun =
      CLOSED_THROTTLE_BRAKE_FACTOR *
      (engine.brakingCoeff * this.brakeCrankSpeed(crankRad, engine) + pumping);
    const open = Math.min(1, demand / PART_THROTTLE_PUMPING_FADE);
    return drive - (overrun + (friction - overrun) * open);
  }

  /**
   * A car that joins the road ALREADY ROLLING: into the gear it would be in at this
   * wheel speed — the lowest one that keeps the crank under `UP_SHIFT_RPM_FRACTION` of
   * the redline — with the crank turning to match. Not a shift, so no interruption; and
   * it has to be done, because the automatic only ever takes a gear from neutral at a
   * walking pace, so a car set moving in neutral would coast for good.
   */
  engageAtWheelSpeed(wheelAngularSpeed: number): void {
    const gearbox = this.gearbox;
    const engine = this.engine;
    if (gearbox == null || engine == null) return;
    const wheelRpm = Math.abs(wheelAngularSpeed) * gearbox.finalDrive * RPM_PER_RAD_PER_SEC;
    let gear = gearbox.ratios.length;
    for (let g = 1; g <= gearbox.ratios.length; g++) {
      if (wheelRpm * Math.abs(gearbox.ratios[g - 1]) <= engine.redlineRpm * UP_SHIFT_RPM_FRACTION) {
        gear = g;
        break;
      }
    }
    this.gear = gear;
    this.shiftTimer = 0;
    this.clutch = 'locked';
    this.engagement = 1;
    this.lastInputRadS = wheelAngularSpeed * gearbox.ratios[gear - 1] * gearbox.finalDrive;
    this.rpmValue = clamp(wheelRpm * Math.abs(gearbox.ratios[gear - 1]), engine.idleRpm, engine.redlineRpm);
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
   * and always reads the crank clamped to its rev range.
   */
  private brakeCrankSpeed(crankSpeedAbs: number, engine: EngineSpec): number {
    const redlineRad = engine.redlineRpm / RPM_PER_RAD_PER_SEC;
    if (crankSpeedAbs <= redlineRad) return crankSpeedAbs;
    return redlineRad + (crankSpeedAbs - redlineRad) * OVER_REV_BRAKE_GAIN;
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
    drivenWheelAngularSpeed: number,
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

    const roadAbs = Math.abs(wheelAngularSpeed) * gearbox.finalDrive * RPM_PER_RAD_PER_SEC;
    // The engine runs at the DRIVEN wheels' speed, which a tyre working at 2% slip at
    // the top of third already puts into the fuel cut while road speed says there is
    // room: judged on road speed alone, the rally 2105 sat on its limiter in third at
    // 141 km/h. So both decisions are judged on whichever is faster — the crank's own
    // speed while a wheel flares, road speed while one is locked. A locked wheel is
    // then still no reason to drop to first, and a spinning one is no reason to drop
    // into a gear that would only spin it harder.
    const crankAbs = Math.max(
      roadAbs,
      Math.abs(drivenWheelAngularSpeed) * gearbox.finalDrive * RPM_PER_RAD_PER_SEC,
    );
    const ratio = Math.abs(this.ratioOfGear(this.gear));
    const current = crankAbs * ratio;

    if (this.gear < n) {
      const nextRatio = Math.abs(this.ratioOfGear(this.gear + 1));
      const due =
        throttle >= WOT_SHIFT_THROTTLE
          ? fullThrottleUpshiftDue(
              engine,
              crankAbs * ratio,
              ratio,
              nextRatio,
              engine.redlineRpm * this.thermalRevLimit,
            )
          : crankAbs * ratio > engine.redlineRpm * UP_SHIFT_RPM_FRACTION;
      // Never upshift into a gear that cannot pull or that the downshift rule would
      // take straight back at this ROAD speed once the shift has cost its share of it:
      // a wheel spinning up in first must not make the box hunt between first and
      // second. See UP_SHIFT_HOLD_MARGIN.
      const nextRoadRpm = roadAbs * nextRatio;
      if (
        due &&
        nextRoadRpm > engine.idleRpm * UP_SHIFT_IDLE_MARGIN &&
        nextRoadRpm >= engine.redlineRpm * DOWN_SHIFT_RPM_FRACTION * UP_SHIFT_HOLD_MARGIN
      ) {
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
