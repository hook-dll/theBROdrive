/**
 * tools/reality.ts
 *
 * Every catalogue car against the real one, with a verdict.
 *
 * "Drives like the real one" is only a claim you can check if the real one's
 * numbers sit in the same table, so each model has a factory-target manifest below,
 * with its sources, and the real bench (`Vehicle.fixedUpdate` on Rapier, through
 * `handling-bench.ts`) is measured against it:
 *
 *   engine     net full-throttle power at the rated speed and torque at the torque
 *              peak, read off `engineTorqueNm` — the curve the car drives on — and
 *              held to the catalogue within 1%
 *   geometry   wheelbase, front track and rolling radius of the LOADED model
 *   top        flat-out on level asphalt, at the test load
 *   0-100      at the test load, measured the way a factory measures it: a manual
 *              box changed at the power-optimal point, not the automatic
 *   turn       full-lock radius, converted to the outer-front-wheel figure a factory
 *              turning circle quotes (centreline + half the real track)
 *   brake      100-0 km/h, against period road tests (see the manifest note)
 *   lat, ride  printed beside their period figures, not held to them
 *
 * A column with no credible factory figure prints a dash and is not judged: a
 * missing target is stated, never invented. The run EXITS NON-ZERO if any judged
 * column is out of tolerance. A 0-100 the owner has accepted is printed as a KNOWN
 * deviation with its cause (see the note above the manifest's shorthands).
 *
 *   bun tools/reality.ts [modelId ...]      (default: every catalogue model)
 *
 * Nothing here is part of the game bundle.
 */

import { installAssetShim } from './assetshim';
import { FIXED_DT, type PhysicsWorld } from '../src/core/physics';
import { SurfaceType } from '../src/core/surfaces';
import { CAR_MODELS, carModel, modelEngine, modelGearbox } from '../src/vehicle/carmodels';
import { carModelMeasure, preloadCarModels } from '../src/render/carmodel';
import { createPartMesh } from '../src/render/partmesh';
import { engineTorqueNm, fullThrottleUpshiftDue } from '../src/vehicle/drivetrain';
import { benchOne, drive, driveUntil, makeRig, measureTopSpeed, type Rig } from './handling-bench';

installAssetShim();

/** Tolerances, as fractions of the factory figure. */
const TOLERANCE = {
  engine: 0.01,
  geometry: 0.005,
  top: 0.05,
  to100: 0.08,
  turn: 0.03,
  brake: 0.1,
} as const;

/** Driver and one passenger at 75 kg each: the condition VAZ's manuals state. */
const DRIVER_AND_PASSENGER_KG = 150;

interface Target {
  /** Wheelbase, front track and rolling radius, m. */
  readonly wheelbase: number;
  readonly track: number;
  readonly radius: number;
  /** Top speed, km/h. */
  readonly top: number;
  /** 0-100 km/h, s, or null where no credible factory figure exists. */
  readonly to100: number | null;
  /** Mass aboard for top and 0-100, kg, and the source's words for it. */
  readonly loadKg: number;
  readonly load: string;
  /** Turning radius by the outer front wheel, m. */
  readonly turn: number;
  /** 100-0 km/h braking distance, m, where a period road test is known. */
  readonly brake: number | null;
  /** Steady-state lateral acceleration, g, where a period test is known. */
  readonly lat: number | null;
  /** Design front heave frequency, Hz. */
  readonly hz: number;
  readonly source: string;
  /**
   * A 0-100 deviation the owner has accepted, with its physical cause. It is still
   * measured and printed; it is reported as KNOWN instead of failing, and a known
   * deviation that comes back inside tolerance FAILS, so the note cannot outlive the
   * reason for it. Never a wider tolerance: the target stays the factory's.
   */
  readonly known0to100?: string;
}

/*
 * ---- known 0-100 deviations, and why ----
 *
 * Every car in the table reaches its catalogue top speed within 2% on its factory net
 * power, mass, ratios and efficiency, so the power at speed is right. Its standing
 * start is where the model and the catalogue part, for three different reasons:
 *
 * LAUNCH_TRACTION. The first gear of a rear-drive classic is traction-limited for its
 * first 3-5 seconds: the tyre's longitudinal peak is `wheelGrip` x asphalt's 0.988,
 * about 0.57, because one coefficient serves the tyre AND the period brake test it was
 * calibrated to (0.53 g mean). A real 165/80R13 on dry asphalt has 0.8 or more; the
 * drum brakes, not the tyre, held those cars to 0.55 g. Measured: the driven wheels
 * sit at the tyre's optimal slip through all of first gear whether the throttle is
 * floored or feathered to hold 0.12 slip (identical 0-45 km/h times), and the clutch
 * already slips the engine at its torque peak, so neither the launch rpm nor the
 * driver is the lever. The fix is a tyre peak separate from the brake capability, in
 * the tyre model (vehicle.ts), not in the drivetrain.
 *
 * CATALOGUE_OPTIMISTIC. A point-mass run from the catalogue's own net kW, kerb mass
 * plus the stated 150 kg, the gearbox's ratios and efficiency and the Cd·A that fits
 * the top speed is already slower than the printed time, before any tyre is involved
 * (2108 17.4 s against 16, 21099 16.5 against 13.5, Oka 33 against 30, 2110 16.6
 * against 15, 2141 15.8 against 14.9). Those times were measured on engines rated
 * before GOST 14846-81's net standard, or lighter than the stated load; the model
 * uses the net figure as printed and does not make it up.
 *
 * NIVA_LOSSES. Both Nivas are 11-14% QUICKER than their catalogues: the point-mass run
 * gives 20.6 and 21.8 s against 23 and 25. What the model leaves out is the Niva's
 * own: all-terrain tyres rolling at about 0.02 against the asphalt table's 0.013, and
 * a permanent 4x4 with its centre differential always turning. Per-tyre rolling
 * resistance is not a catalogue field; adding it is a tyre-model change.
 */
const LAUNCH_TRACTION = 'launch traction-limited at the tyre/brake shared peak (see note)';
const CATALOGUE_OPTIMISTIC = 'catalogue time beats a point-mass run from its own net kW (see note)';
const NIVA_LOSSES = 'Niva tyre rolling and full-time 4x4 losses not modelled (see note)';

const STATED = 'driver + passenger (stated)';
const ASSUMED = 'driver + passenger (assumed: the VAZ manuals\' condition)';

/*
 * The manifest. Sources, abbreviated per entry:
 *
 *   AO    autoopt.ru encyclopedia, which reprints the period factory catalogues
 *         (https://www.autoopt.ru/auto/encyclopedia/car/<make>/mark/<model>)
 *   man.  the factory owner's / repair manual for that model (URL per entry)
 *   wiki  ru.wikipedia infobox: secondary, used only where nothing better exists
 *
 * GEOMETRY is the published wheelbase and front track; the rolling radius is the
 * catalogue tyre size's, as `FACTORY_GEOMETRY` in vehicle/carmodels.ts derives it.
 *
 * BRAKING is not the catalogue's "38 m from 80 km/h": that is a type-approval
 * ceiling at full mass with a response allowance, not a measurement. The figures here
 * are 100-0 equivalents of period road tests on these cars' drums and cross-plies —
 * 0.5 g for the GAZ-21 to 0.66 g for a Samara — carried over from the pack's first
 * reality table, where each was converted from its 80 km/h figure. Cars with no such
 * test are not judged on braking.
 *
 * 0-100 LOAD. The Samara, Niva and Oka manuals state their 0-100 and top speed
 * "with driver and one passenger"; the 2103 catalogue says the same of its top speed.
 * The classics' catalogues print no condition, and they are measured the same way.
 */
const TARGETS: Readonly<Record<string, Target>> = {
  sv_gaz21: {
    wheelbase: 2.7, track: 1.41, radius: 0.365, top: 130, to100: null,
    loadKg: DRIVER_AND_PASSENGER_KG, load: ASSUMED, turn: 6.3, brake: 87, lat: 0.6, hz: 0.95,
    source: 'AO gaz-21; man. garage-m21.narod.ru/garage/texnxar.htm (no factory 0-100)',
  },
  sv_gaz24: {
    wheelbase: 2.8, track: 1.476, radius: 0.354, top: 145, to100: null,
    loadKg: DRIVER_AND_PASSENGER_KG, load: ASSUMED, turn: 5.5, brake: 78, lat: 0.64, hz: 1.0,
    source: 'man. long-vehicle.narod.ru/gaz24/book24/24_tech.htm (no factory 0-100)',
  },
  sv_vaz2101: {
    wheelbase: 2.424, track: 1.349, radius: 0.297, top: 142, to100: 20,
    loadKg: DRIVER_AND_PASSENGER_KG, load: ASSUMED, turn: 5.6, brake: 75, lat: 0.7, hz: 1.1,
    source: 'AO vaz-2101 (1982 catalogue)',
  },
  sv_vaz2102: {
    wheelbase: 2.424, track: 1.365, radius: 0.297, top: 138, to100: 23,
    loadKg: DRIVER_AND_PASSENGER_KG, load: ASSUMED, turn: 5.6, brake: 76, lat: 0.68, hz: 1.1,
    source: 'wiki VAZ-2102 (AO has no table); turn as VAZ-2101',
  },
  sv_vaz2103: {
    wheelbase: 2.424, track: 1.365, radius: 0.288, top: 152, to100: 17,
    loadKg: DRIVER_AND_PASSENGER_KG, load: STATED, turn: 5.6, brake: 74, lat: 0.71, hz: 1.1,
    source: 'AO vaz-2103',
  },
  sv_vaz2104: {
    wheelbase: 2.424, track: 1.365, radius: 0.288, top: 137, to100: 18.5,
    loadKg: DRIVER_AND_PASSENGER_KG, load: ASSUMED, turn: 5.6, brake: 76, lat: 0.69, hz: 1.1,
    source: 'AO vaz-2104 (base 2104, 1.3); turn per AO vaz-2105',
    known0to100: LAUNCH_TRACTION,
  },
  sv_vaz2105: {
    wheelbase: 2.424, track: 1.365, radius: 0.288, top: 145, to100: 18,
    loadKg: DRIVER_AND_PASSENGER_KG, load: ASSUMED, turn: 5.6, brake: 74, lat: 0.71, hz: 1.1,
    source: 'AO vaz-2105',
    known0to100: LAUNCH_TRACTION,
  },
  // Not a catalogue car: the pack's own rally build, held to the targets it was
  // built to rather than to any factory's.
  sv_vaz2105r: {
    wheelbase: 2.424, track: 1.365, radius: 0.3, top: 170, to100: 11,
    loadKg: 75, load: 'driver only (build target)', turn: 5.6, brake: 51, lat: 0.85, hz: 1.55,
    source: 'pack build targets, not factory',
    known0to100: LAUNCH_TRACTION,
  },
  sv_vaz2106: {
    wheelbase: 2.424, track: 1.365, radius: 0.288, top: 150, to100: 16,
    loadKg: DRIVER_AND_PASSENGER_KG, load: ASSUMED, turn: 5.6, brake: 74, lat: 0.72, hz: 1.1,
    source: 'AO vaz-2106',
    known0to100: LAUNCH_TRACTION,
  },
  sv_vaz2107: {
    wheelbase: 2.424, track: 1.365, radius: 0.288, top: 150, to100: 17,
    loadKg: DRIVER_AND_PASSENGER_KG, load: ASSUMED, turn: 5.6, brake: 74, lat: 0.72, hz: 1.1,
    source: 'AO vaz-2107 (VAZ-2103 engine)',
    known0to100: LAUNCH_TRACTION,
  },
  sv_vaz2108: {
    wheelbase: 2.46, track: 1.4, radius: 0.281, top: 148, to100: 16,
    loadKg: DRIVER_AND_PASSENGER_KG, load: STATED, turn: 5.2, brake: 66, lat: 0.78, hz: 1.3,
    source: 'AO vaz-2108; man. vaz-sputnik.ru/2109/1-4.html',
    known0to100: CATALOGUE_OPTIMISTIC,
  },
  sv_vaz2109: {
    wheelbase: 2.46, track: 1.4, radius: 0.281, top: 148, to100: 16,
    loadKg: DRIVER_AND_PASSENGER_KG, load: STATED, turn: 5.2, brake: 66, lat: 0.78, hz: 1.3,
    source: 'AO vaz-2109; man. vaz-sputnik.ru/2109/1-4.html',
    known0to100: CATALOGUE_OPTIMISTIC,
  },
  sv_vaz21099: {
    wheelbase: 2.46, track: 1.4, radius: 0.281, top: 154, to100: 13.5,
    loadKg: DRIVER_AND_PASSENGER_KG, load: STATED, turn: 5.2, brake: 66, lat: 0.78, hz: 1.3,
    source: 'man. vaz-sputnik.ru/21099/1.html',
    known0to100: CATALOGUE_OPTIMISTIC,
  },
  sv_niva: {
    wheelbase: 2.2, track: 1.43, radius: 0.343, top: 132, to100: 23,
    loadKg: DRIVER_AND_PASSENGER_KG, load: STATED, turn: 5.5, brake: 75, lat: 0.66, hz: 1.15,
    source: 'AO vaz-2121; lada-niva.ru/niva/soobschenie-s-harakteristikami.html',
    known0to100: NIVA_LOSSES,
  },
  sv_niva_long: {
    wheelbase: 2.7, track: 1.44, radius: 0.343, top: 132, to100: 25,
    loadKg: DRIVER_AND_PASSENGER_KG, load: ASSUMED, turn: 6.3, brake: 78, lat: 0.64, hz: 1.15,
    source: 'AO vaz-2131; lada-niva.ru/vid-img/sravnenie.jpg',
    known0to100: NIVA_LOSSES,
  },
  sa_azlk2141: {
    wheelbase: 2.58, track: 1.44, radius: 0.31, top: 158, to100: 14.9,
    loadKg: DRIVER_AND_PASSENGER_KG, load: ASSUMED, turn: 5.0, brake: null, lat: null, hz: 1.15,
    source: 'AO moskvich-2141 (2141-01, VAZ-2106-70 engine)',
    known0to100: CATALOGUE_OPTIMISTIC,
  },
  sa_oka: {
    wheelbase: 2.18, track: 1.214, radius: 0.26, top: 120, to100: 30,
    loadKg: DRIVER_AND_PASSENGER_KG, load: STATED, turn: 4.8, brake: null, lat: null, hz: 1.3,
    source: 'man. autoprospect.ru/vaz/1111-oka/1-4-tekhnicheskie-kharakteristiki.html (no Oka brake test; the manual quotes the Samara norm)',
    known0to100: CATALOGUE_OPTIMISTIC,
  },
  sa_uaz330364: {
    wheelbase: 2.55, track: 1.445, radius: 0.372, top: 105, to100: null,
    loadKg: DRIVER_AND_PASSENGER_KG, load: ASSUMED, turn: 6.3, brake: null, lat: null, hz: 1.3,
    source: 'truck-and-bus.ru/brands/uaz/uaz-330364 (top); AO uaz-2206 (turn, same chassis)',
  },
  sa_izh2715: {
    wheelbase: 2.4, track: 1.27, radius: 0.305, top: 125, to100: null,
    loadKg: DRIVER_AND_PASSENGER_KG, load: ASSUMED, turn: 5.25, brake: null, lat: null, hz: 1.3,
    source: 'AO ij-2715 (no factory 0-100)',
  },
  gt_vaz2110: {
    wheelbase: 2.492, track: 1.41, radius: 0.288, top: 162, to100: 15,
    loadKg: DRIVER_AND_PASSENGER_KG, load: ASSUMED, turn: 5.2, brake: null, lat: null, hz: 1.3,
    source: 'man. autoprospect.ru/vaz/2110-zhiguli/1-obshhie-svedeniya.html (2110, carburettor)',
    known0to100: CATALOGUE_OPTIMISTIC,
  },
};

/** A 20 km square of asphalt: a Volga needs several kilometres to settle at its top. */
function addLongGround(physics: PhysicsWorld): void {
  physics.addHeightfield(
    1,
    1,
    new Float32Array(4),
    { x: 20000, y: 1, z: 20000 },
    { x: 0, y: 0, z: 0 },
    SurfaceType.Asphalt,
  );
}

/** Mean rolling radius of the axle that drives, as `Vehicle` computes it. */
function drivenRadiusOf(modelId: string): number {
  const wheels = carModelMeasure(modelId).wheels;
  const rearDriven = carModel(modelId).rearDriveBias >= 0.5;
  const driven = wheels.filter((w) => w.isFront !== rearDriven);
  return driven.reduce((sum, w) => sum + w.radius, 0) / driven.length;
}

/**
 * 0-100 km/h through a manual box driven the way a factory test driver drives it:
 * first gear engaged before the clock starts, full throttle, and each change made at
 * the power-optimal point (`fullThrottleUpshiftDue`, the same definition the
 * automatic uses at wide-open throttle) — decided on the crank speed the road speed
 * implies in the engaged gear, so a free-revving crank mid-change cannot trigger a
 * second one.
 */
function manualZeroToHundred(rig: Rig, modelId: string): number | null {
  const engine = modelEngine(carModel(modelId));
  const gearbox = modelGearbox(carModel(modelId));
  const radius = drivenRadiusOf(modelId);
  // A settings delta, never a field write: a fresh world shares DEFAULT_SETTINGS by
  // reference, and mutating it would put every later rig in manual too.
  rig.world.apply({
    t: 'settings',
    settings: { ...rig.world.state.settings, gearboxMode: 'manual' },
  });

  // Select first and let the change complete, on the brake.
  drive(rig, gearbox.shiftTime + 0.3, (t, f) => {
    f.shift = t === 0 ? 1 : 0;
    f.brake = 1;
    f.throttle = 0;
  });
  if (rig.vehicle.gearLabel !== '1') throw new Error(`${modelId}: could not select first gear`);

  let reached: number | null = null;
  let t = 0;
  driveUntil(
    rig,
    60,
    (_, f) => {
      f.brake = 0;
      f.throttle = 1;
      f.steer = 0;
      f.shift = 0;
      const gear = Number(rig.vehicle.gearLabel);
      if (gear >= 1 && gear < gearbox.ratios.length) {
        const ratio = gearbox.ratios[gear - 1]!;
        const wheelRad = Math.abs(rig.vehicle.audio.forwardMps) / radius;
        const rpm = (wheelRad * ratio * gearbox.finalDrive * 60) / (2 * Math.PI);
        if (fullThrottleUpshiftDue(engine, rpm, ratio, gearbox.ratios[gear]!)) f.shift = 1;
      }
    },
    () => {
      t += FIXED_DT;
      if (rig.vehicle.speedKmh >= 100) reached = t;
      return reached !== null;
    },
  );
  return reached;
}

/** `value` against `target` as a signed fraction, or null when there is no target. */
function deviation(value: number | null, target: number | null): number | null {
  if (value === null || target === null || target === 0) return null;
  return (value - target) / target;
}

function pad(value: string | number, width: number): string {
  return String(value).padStart(width);
}

let failures = 0;
const failed: string[] = [];
const known: string[] = [];

/** Formats a deviation and records a failure when it is out of `tolerance`. */
function judged(label: string, id: string, dev: number | null, tolerance: number): string {
  if (dev === null) return pad('-', 6);
  const bad = Math.abs(dev) > tolerance;
  if (bad) {
    failures++;
    failed.push(`${id} ${label} ${(dev * 100).toFixed(1)}%`);
  }
  return `${pad(`${(dev * 100).toFixed(1)}%`, 6)}${bad ? '!' : ' '}`;
}

/**
 * `judged`, for a column the manifest has an accepted deviation on. Out of tolerance
 * it is listed as KNOWN; back inside tolerance the stale note is itself a failure.
 */
function judgedKnown(
  label: string,
  id: string,
  dev: number | null,
  tolerance: number,
  reason: string | undefined,
): string {
  if (reason === undefined || dev === null) return judged(label, id, dev, tolerance);
  const out = Math.abs(dev) > tolerance;
  if (out) known.push(`${id} ${label} ${(dev * 100).toFixed(1)}%: ${reason}`);
  else {
    failures++;
    failed.push(`${id} ${label}: known deviation is back inside tolerance; remove the note`);
  }
  return `${pad(`${(dev * 100).toFixed(1)}%`, 6)}${out ? '~' : ' '}`;
}

const argv = process.argv.slice(2);
const ids = argv.length > 0 ? argv : CAR_MODELS.map((m) => m.id);
for (const id of ids) {
  if (!TARGETS[id]) throw new Error(`${id}: no factory-target manifest entry`);
}

// Every driveline id must also have a render blueprint. `partmesh.ts` throws on an
// unhandled id, so building one of each proves a loose engine or gearbox can spawn.
const drivelineIds = new Set<string>();
for (const id of ids) {
  drivelineIds.add(carModel(id).engineId);
  drivelineIds.add(carModel(id).gearboxId);
}
for (const id of drivelineIds) createPartMesh(id);
console.log(`--- driveline meshes: ${drivelineIds.size} built ---\n`);

console.log('--- engine: net full-throttle curve at the catalogue points ---');
console.log('model            engine              kW@rated  factory   dev    Nm@peak factory   dev');
for (const id of ids) {
  const def = carModel(id);
  const e = modelEngine(def);
  const kw = (engineTorqueNm(e, e.powerPeakRpm) * e.powerPeakRpm * 2 * Math.PI) / 60 / 1000;
  const nm = engineTorqueNm(e, e.torquePeakRpm);
  console.log(
    `${id.padEnd(16)} ${def.engineId.padEnd(18)} ${pad(kw.toFixed(2), 7)}@${e.powerPeakRpm} ` +
      `${pad(e.peakPowerKw, 6)} ${judged('kW', id, deviation(kw, e.peakPowerKw), TOLERANCE.engine)} ` +
      `${pad(nm.toFixed(1), 6)} ${pad(e.peakTorqueNm, 6)} ` +
      `${judged('Nm', id, deviation(nm, e.peakTorqueNm), TOLERANCE.engine)}`,
  );
}

await preloadCarModels(ids);

console.log('\n--- geometry: the loaded model against the factory ---');
console.log('model              wb    real    dev     track  real    dev     radius  real    dev');
for (const id of ids) {
  const real = TARGETS[id]!;
  const m = carModelMeasure(id);
  const front = m.wheels.filter((w) => w.isFront);
  const rear = m.wheels.filter((w) => !w.isFront);
  const wb = Math.abs(front[0]!.pos[2] - rear[0]!.pos[2]);
  const track = Math.abs(front[0]!.pos[0] - front[1]!.pos[0]);
  const radius = m.wheels[0]!.radius;
  console.log(
    `${id.padEnd(16)} ${wb.toFixed(3)} ${real.wheelbase.toFixed(3)} ` +
      `${judged('wheelbase', id, deviation(wb, real.wheelbase), TOLERANCE.geometry)}  ` +
      `${track.toFixed(3)} ${real.track.toFixed(3)} ` +
      `${judged('track', id, deviation(track, real.track), TOLERANCE.geometry)}  ` +
      `${radius.toFixed(3)}  ${real.radius.toFixed(3)} ` +
      `${judged('radius', id, deviation(radius, real.radius), TOLERANCE.geometry)}`,
  );
}

console.log('\n--- behaviour: measured against the factory (load: see below) ---');
console.log(
  'model              top  real    dev     0-100  real    dev      turn  real    dev    ' +
    'brake  real    dev      lat  real   ride  real',
);
for (const id of ids) {
  const real = TARGETS[id]!;

  const topRig = await makeRig(id, addLongGround);
  topRig.vehicle.setCarriedMass(real.loadKg);
  const top = measureTopSpeed(topRig, 9000);
  topRig.vehicle.dispose();
  if (!top.reachedPlateau) {
    failures++;
    failed.push(`${id} top: no plateau within the run`);
  }

  const accelRig = await makeRig(id);
  accelRig.vehicle.setCarriedMass(real.loadKg);
  const to100 = manualZeroToHundred(accelRig, id);
  accelRig.vehicle.dispose();
  if (to100 === null && real.to100 !== null) {
    failures++;
    failed.push(`${id} 0-100: never reached 100 km/h`);
  }

  // Turning, braking, grip and ride come from the shared sheet, at kerb mass.
  const sheet = await benchOne(id);
  // A factory turning radius is swept by the OUTER FRONT WHEEL, and the bench
  // measures the path of the centre of mass, so the two differ by half a track. The
  // conversion uses the REAL track, so a steering-lock error cannot hide inside a
  // geometry error.
  const realCentre = real.turn - real.track / 2;

  console.log(
    `${id.padEnd(16)} ${pad(top.plateauKmh.toFixed(0), 4)} ${pad(real.top, 5)} ` +
      `${judged('top', id, deviation(top.plateauKmh, real.top), TOLERANCE.top)}  ` +
      `${pad(to100?.toFixed(1) ?? 'never', 6)} ${pad(real.to100 ?? '-', 5)} ` +
      `${judgedKnown('0-100', id, deviation(to100, real.to100), TOLERANCE.to100, real.known0to100)}  ` +
      `${pad(sheet.turnRadiusM.toFixed(2), 5)} ${pad(realCentre.toFixed(2), 5)} ` +
      `${judged('turn', id, deviation(sheet.turnRadiusM, realCentre), TOLERANCE.turn)}  ` +
      `${pad(sheet.brakeDistM.toFixed(1), 5)} ${pad(real.brake ?? '-', 5)} ` +
      `${judged('brake', id, deviation(sheet.brakeDistM, real.brake), TOLERANCE.brake)}  ` +
      `${pad(sheet.skidpadG.toFixed(2), 5)} ${pad(real.lat?.toFixed(2) ?? '-', 5)}  ` +
      `${pad(sheet.bounceHz.toFixed(2), 4)} ${pad(real.hz.toFixed(2), 5)}`,
  );
}

console.log('\n--- test load and sources ---');
for (const id of ids) {
  const real = TARGETS[id]!;
  console.log(`${id.padEnd(16)} +${real.loadKg} kg ${real.load}; ${real.source}`);
}

if (known.length > 0) {
  console.log(`\n${known.length} known deviations (~), accepted with their cause:\n  ${known.join('\n  ')}`);
}
if (failures > 0) {
  console.log(`\n${failures} out of tolerance (!):\n  ${failed.join('\n  ')}`);
  process.exit(1);
}
console.log(`\nall ${ids.length} models within tolerance`);
