/**
 * tools/climb-limit.ts
 *
 * How steep a grade may the landscape present before the game's own weakest car
 * cannot deal with it? Three separate ceilings, because they fail differently and
 * the lowest of them is the answer:
 *
 *   1. TORQUE, from a standstill. First gear times the final drive against the
 *      wheel radius, at the engine's own peak torque, minus rolling resistance.
 *      Analytic, from parts/registry.ts and the model catalogue.
 *
 *   2. TRACTION. The driven axle's share of the weight times the surface's
 *      longitudinal grip. Analytic here and MEASURED by `--sweep`, which drives the
 *      real car up a real incline in Rapier through `runInclineLaunchCheck`, so load
 *      transfer, the differential and the clutch are all in the loop. (For the loose
 *      surfaces that sweep is `tools/climb-sweep.ts`, which is the one that matters:
 *      this bench is honest asphalt, and nothing climbs a dune honestly.)
 *
 *   3. HEAT, which is the one nobody expects and the one that actually binds.
 *      Airflow through the core is linear in road speed and heat in is set by
 *      throttle, not by speed, so a long full-throttle crawl is the worst case the
 *      cooling system ever sees: the steeper the grade, the slower the crawl, the
 *      less air, the hotter it sits. The ceiling is therefore a MINIMUM SUSTAINABLE
 *      SPEED, and the grade that pins the car to exactly that speed.
 *
 * The thermal numbers are not a re-derivation: they run the real
 * `EngineCoolingSystem` to its fixed point with the stock radiator for the engine,
 * full of water, so the thermostat, the fit multiplier and the airflow curve are the
 * shipped ones rather than copies of them.
 *
 *   npx tsx tools/climb-limit.ts [--sweep] [modelId ...]
 *
 * Nothing here is part of the game bundle.
 */

import { SURFACES, SurfaceType } from '../src/core/surfaces';
import {
  engineHeat,
  variant,
  type EngineSpec,
  type RadiatorClass,
  type RadiatorSpec,
} from '../src/parts/registry';
import {
  CAR_MODELS,
  frontWeightFraction,
  modelEngine,
  modelGearbox,
  type CarModelDef,
} from '../src/vehicle/carmodels';
import {
  ambientAirC,
  EngineCoolingSystem,
  preferredRadiatorClass,
} from '../src/vehicle/cooling';
import fits from '../src/vehicle/model-fits.json';
import { installAssetShim } from './assetshim';
import { runInclineLaunchCheck } from './handling-bench';

/** Driveline efficiency, crank to contact patch: a period manual box and hypoid axle. */
const DRIVELINE_EFFICIENCY = 0.88;
/** Wheel radius used when a body has no measured fit, metres. */
const FALLBACK_WHEEL_RADIUS = 0.35;
const GRAVITY = 9.81;
const AIR_DENSITY = 1.2;

/** The surface the road is made of where it matters; every ceiling is quoted on it. */
const ROAD_SURFACE = SurfaceType.Asphalt;
const ROAD = SURFACES[ROAD_SURFACE];

/** The stock core for each class, so a car is judged with the radiator it ships with. */
const STOCK_RADIATOR: Record<RadiatorClass, RadiatorSpec> = {
  small: variant('radiator_lada').radiator!,
  standard: variant('radiator_standard').radiator!,
  large: variant('radiator_copper').radiator!,
};

/** Seconds of simulated running the thermal fixed point is read after. */
const SETTLE_SECONDS = 3600;

/** The torque curve's own endpoints, as `Drivetrain` states them. */
const IDLE_TORQUE_FRACTION = 0.62;
const REDLINE_TORQUE_FRACTION = 0.82;

interface Ceiling {
  readonly def: CarModelDef;
  readonly engine: EngineSpec;
  readonly torqueNm: number;
  readonly firstGearTotal: number;
  readonly wheelRadius: number;
  /** Steepest grade first gear can push the kerb mass up, as a fraction. */
  readonly torqueGrade: number;
  /** Steepest grade the driven axle can put down on this surface, as a fraction. */
  readonly tractionGrade: number;
  readonly powerPerTonne: number;
}

/**
 * Steepest grade a given tractive force can hold a mass on, as a fraction.
 *
 * Bisected on the angle rather than solved, because both `sin` and `cos` matter at
 * these slopes — 30% is 16.7 degrees, where the normal load is already down 4% and
 * the small-angle form would quietly overstate the answer.
 */
function gradeForForce(availableN: number, massKg: number): number {
  let lo = 0;
  let hi = 3;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const angle = Math.atan(mid);
    const need = massKg * GRAVITY * (Math.sin(angle) + ROAD.rollingResistance * Math.cos(angle));
    if (need <= availableN) lo = mid;
    else hi = mid;
  }
  return lo;
}

function wheelRadiusOf(def: CarModelDef): number {
  const fit = (fits as Record<string, { wheels?: { radius: number }[] } | undefined>)[def.id];
  const wheels = fit?.wheels;
  if (!wheels || wheels.length === 0) return FALLBACK_WHEEL_RADIUS;
  return wheels.reduce((sum, w) => sum + w.radius, 0) / wheels.length;
}

/**
 * The two mechanical ceilings for one body.
 *
 * Traction uses the STATIC driven-axle share, without the rearward transfer a climb
 * adds: the transfer helps a rear-drive car and hurts a front-drive one, and which
 * way it lands is exactly what the Rapier sweep is for.
 */
function ceilingFor(def: CarModelDef): Ceiling {
  const engine = modelEngine(def);
  const gearbox = modelGearbox(def);
  const radius = wheelRadiusOf(def);
  const firstGearTotal = gearbox.ratios[0]! * gearbox.finalDrive;
  const driveForce = (engine.peakTorqueNm * firstGearTotal * DRIVELINE_EFFICIENCY) / radius;
  // A trailer adds mass to be dragged up but no grip: its own wheels are unpowered,
  // so the driven axle still carries only the car's share.
  const total = def.mass + towKg;

  const front = frontWeightFraction(def);
  const drivenShare =
    def.rearDriveBias >= 0.99 ? 1 - front : def.rearDriveBias <= 0.01 ? front : 1;
  const gripForce =
    ROAD.frictionSlip *
    def.wheelGrip *
    (def.longitudinalGripScale ?? 1) *
    drivenShare *
    def.mass *
    GRAVITY;

  return {
    def,
    engine,
    torqueNm: engine.peakTorqueNm,
    firstGearTotal,
    wheelRadius: radius,
    torqueGrade: gradeForForce(driveForce, total),
    tractionGrade: gradeForForce(gripForce, total),
    powerPerTonne: engine.peakPowerKw / (total / 1000),
  };
}

/**
 * Normalised engine torque at `rpm`, the same three-segment curve `Drivetrain`
 * applies (idle 0.62, peak 1.0, redline 0.82). Duplicated rather than imported
 * because the class wants a whole car around it to answer this.
 */
function torqueAt(engine: EngineSpec, rpm: number): number {
  if (rpm <= engine.idleRpm) return IDLE_TORQUE_FRACTION * engine.peakTorqueNm;
  if (rpm < engine.torquePeakRpm) {
    const t = (rpm - engine.idleRpm) / (engine.torquePeakRpm - engine.idleRpm);
    return (IDLE_TORQUE_FRACTION + (1 - IDLE_TORQUE_FRACTION) * t) * engine.peakTorqueNm;
  }
  const t = (rpm - engine.torquePeakRpm) / (engine.redlineRpm - engine.torquePeakRpm);
  return (1 - (1 - REDLINE_TORQUE_FRACTION) * t) * engine.peakTorqueNm;
}

/**
 * Settled coolant temperature, degrees C, of holding `speedMps` at `load` throttle
 * and `revs` of redline. Runs the shipped cooling system to its fixed point rather
 * than restating its balance: stock core for the engine, full of water.
 *
 * Water is topped back up every step on purpose. Above the warning temperature the
 * real system boils coolant away, which drifts the fixed point upward — this reports
 * the steady state of a SOUND car, not the tail of a slow failure.
 */
function settledTemperature(
  def: CarModelDef,
  speedMps: number,
  load: number,
  revs: number,
  ambientC: number,
): number {
  const engine = modelEngine(def);
  const radiator = STOCK_RADIATOR[preferredRadiatorClass(engine)];
  const cooling = new EngineCoolingSystem(ambientC);
  cooling.configure(engine, radiator);
  cooling.setTemperature(ambientC);
  for (let t = 0; t < SETTLE_SECONDS; t += 5) {
    cooling.setWater(radiator.capacity);
    cooling.update(5, { ambientC, engineRunning: true, load, revs, speedMps });
  }
  return cooling.temperature;
}

interface ClimbState {
  readonly speedMps: number;
  readonly gear: number;
  readonly load: number;
  readonly temperatureC: number;
}

/**
 * The COOLEST way to climb a given grade, over every gear and every speed the car
 * can actually hold on it.
 *
 * Searching instead of assuming full throttle matters, because the two terms pull
 * opposite ways: going slower cuts the power demanded (less heat) but also cuts
 * airflow through the core (less cooling), and which wins depends on the grade. This
 * is the driver doing the sensible thing — the right gear, and no more throttle than
 * the hill needs.
 */
function bestClimb(def: CarModelDef, grade: number, ambientC: number): ClimbState | null {
  const engine = modelEngine(def);
  const gearbox = modelGearbox(def);
  const radius = wheelRadiusOf(def);
  const angle = Math.atan(grade);
  const resistance =
    (def.mass + towKg) *
    GRAVITY *
    (Math.sin(angle) + ROAD.rollingResistance * Math.cos(angle));
  let best: ClimbState | null = null;

  for (let g = 0; g < gearbox.ratios.length; g++) {
    const total = gearbox.ratios[g]! * gearbox.finalDrive;
    for (let speedMps = 1; speedMps <= 34; speedMps += 0.5) {
      const rpm = ((speedMps / radius) * total * 60) / (2 * Math.PI);
      if (rpm < engine.idleRpm || rpm > engine.redlineRpm) continue;
      const maxForce = (torqueAt(engine, rpm) * total * DRIVELINE_EFFICIENCY) / radius;
      const need = resistance + 0.5 * AIR_DENSITY * def.dragArea * speedMps * speedMps;
      if (need > maxForce) continue;
      const load = need / maxForce;
      const revs = rpm / engine.redlineRpm;
      const temperatureC = settledTemperature(def, speedMps, load, revs, ambientC);
      if (!best || temperatureC < best.temperatureC) {
        best = { speedMps, gear: g + 1, load, temperatureC };
      }
    }
  }
  return best;
}

/**
 * Steepest grade the car can climb INDEFINITELY without passing `limitC`, plus how
 * it has to be driven there. Monotone in grade (a steeper hill needs more power at
 * every speed), so a bisection is sound.
 */
function thermalCeiling(def: CarModelDef, ambientC: number, limitC: number) {
  const ok = (grade: number) => {
    const state = bestClimb(def, grade, ambientC);
    return state !== null && state.temperatureC <= limitC;
  };
  if (!ok(0)) return { grade: 0, state: null };
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 9; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return { grade: lo, state: bestClimb(def, lo, ambientC) };
}

installAssetShim();

const args = process.argv.slice(2);
const sweep = args.includes('--sweep');
const chosen = args.filter((a) => !a.startsWith('--'));
/**
 * Trailer mass hanging off the ball, kg. `--tow=1020` is TRAILER_TARE_KG plus a full
 * TRAILER_CAPACITY_KG load, i.e. the worst thing the player can be dragging uphill.
 */
const towKg = Number(args.find((a) => a.startsWith('--tow='))?.slice(6) ?? 0);
const bodies =
  chosen.length > 0 ? CAR_MODELS.filter((m) => chosen.includes(m.id)) : CAR_MODELS;

const ceilings = bodies
  .map(ceilingFor)
  .sort(
    (a, b) =>
      Math.min(a.torqueGrade, a.tractionGrade) - Math.min(b.torqueGrade, b.tractionGrade),
  );

const deg = (grade: number) => ((Math.atan(grade) * 180) / Math.PI).toFixed(1);

console.log(
  `standstill ceilings on ${ROAD.label}, kerb mass` +
    `${towKg > 0 ? ` + ${towKg} kg trailer` : ', no trailer'} (${bodies.length} bodies)\n`,
);
console.log('body                kg   kW/t     Nm   1st*fd   torque   traction   binding');
for (const c of ceilings.slice(0, 10)) {
  console.log(
    `${c.def.id.padEnd(16)} ${String(c.def.mass).padStart(5)} ${c.powerPerTonne.toFixed(1).padStart(6)} ` +
      `${String(c.torqueNm).padStart(6)} ${c.firstGearTotal.toFixed(1).padStart(8)} ` +
      `${`${(c.torqueGrade * 100).toFixed(0)}%`.padStart(8)} ${`${(c.tractionGrade * 100).toFixed(0)}%`.padStart(10)}   ` +
      `${c.torqueGrade < c.tractionGrade ? 'torque' : 'traction'}`,
  );
}

const weakest = ceilings[0]!;
const weakestGrade = Math.min(weakest.torqueGrade, weakest.tractionGrade);
console.log(
  `\nweakest body: ${weakest.def.label} (${weakest.def.id}), ` +
    `${(weakestGrade * 100).toFixed(0)}% = ${deg(weakestGrade)} deg from a standstill`,
);

console.log('\n--- heat: the ceiling on a climb that never ends ---------------------');
console.log('body              air    sustainable   how (gear/speed/throttle)   before seizure');
for (const c of ceilings.slice(0, 4)) {
  const heat = engineHeat(c.engine);
  for (const [label, ambient] of [
    ['night', ambientAirC(0.208, 1)],
    ['mean', 30],
    ['afternoon', ambientAirC(0.625, 1)],
  ] as const) {
    const warn = thermalCeiling(c.def, ambient, heat.warningC);
    const seize = thermalCeiling(c.def, ambient, heat.maxC);
    const how = warn.state
      ? `${warn.state.gear} gear, ${(warn.state.speedMps * 3.6).toFixed(0)} km/h, ${(warn.state.load * 100).toFixed(0)}% throttle`
      : 'cannot hold any grade';
    console.log(
      `${c.def.id.padEnd(16)} ${`${ambient.toFixed(0)}C`.padStart(5)}   ` +
        `${`${(warn.grade * 100).toFixed(1)}%`.padStart(8)} (${deg(warn.grade)} deg)   ` +
        `${how.padEnd(30)} ${`${(seize.grade * 100).toFixed(1)}%`.padStart(6)}  [${label}]`,
    );
  }
}

if (sweep) {
  console.log('\n--- Rapier sweep: steepest incline the car actually leaves ----------');
  for (const c of ceilings.slice(0, 3)) {
    let low = 1;
    let high = 40;
    let best = 0;
    for (let step = 0; step < 7; step++) {
      const mid = (low + high) / 2;
      let ok = true;
      try {
        await runInclineLaunchCheck(c.def.id, mid, ROAD_SURFACE);
      } catch {
        ok = false;
      }
      if (ok) {
        best = mid;
        low = mid;
      } else {
        high = mid;
      }
    }
    console.log(
      `${c.def.id.padEnd(16)} pulls away up to ${best.toFixed(1)} deg = ` +
        `${(Math.tan((best * Math.PI) / 180) * 100).toFixed(0)}% grade`,
    );
  }
}
