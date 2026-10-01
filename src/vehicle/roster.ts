/**
 * The roster: the fifty cars of cooking.md, each one record.
 *
 * A roster car is a real car on a body built by tools/carshape/carbody.py from its own
 * photographs and dimensions (public/models/carshape/<body>.glb). Everything the game
 * needs about it is here, in one place, so adding a car is adding a record:
 *
 *   factory      the published dimensions the loader fits the body and axles to
 *   driveline    the engine and gearbox, either an existing part variant's id or an
 *                inline spec that becomes the variant `rs_<id>_engine` / `_gearbox`
 *   chassis      mass, weight split, drive, tyre, springs, bars, differentials
 *   target       what tools/reality.ts holds the car to, with its source
 *
 * `dragArea` and `steerLock` are calibrated on tools/reality.ts (top speed and the
 * outer-wheel turning radius), as in the rest of the catalogue.
 *
 * Type-only imports: the part registry and the catalogue both read this file.
 */

import type { BodyClass, EngineSpec, GearboxSpec, SuspensionTuning } from '../parts/registry';
import type { FactoryGeometry, HandlingProfile, LimitedSlip, TyreSpec, VehicleLightsDef } from './carmodels';

export interface InlineEngine {
  readonly label: string;
  readonly mass: number;
  readonly spec: EngineSpec;
  /** The maker's rating as printed, for tools/reality.ts. */
  readonly rated: { readonly kw: number } | { readonly ps: number } | { readonly hp: number };
  readonly ratedTorqueNm: number;
  readonly source: string;
}

export interface InlineGearbox {
  readonly label: string;
  readonly mass: number;
  readonly spec: GearboxSpec;
}

export interface RosterCar {
  readonly id: string;
  readonly label: string;
  /** File under public/models/carshape. */
  readonly body: string;
  readonly bodyClass: BodyClass;
  readonly factory: FactoryGeometry;
  readonly mass: number;
  readonly frontWeightShare: number;
  readonly rearDriveBias: number;
  readonly engine: string | InlineEngine;
  readonly gearbox: string | InlineGearbox;
  readonly tankLitres: number;
  readonly wheelGrip: number;
  readonly brakeDecelG: number;
  readonly steerLock: number;
  readonly dragArea: number;
  readonly handlingProfile: HandlingProfile;
  readonly suspension: SuspensionTuning;
  readonly tyre: TyreSpec;
  readonly antiRoll?: { readonly front: number; readonly rear: number };
  readonly frontDiff?: LimitedSlip;
  readonly rearDiff?: LimitedSlip;
  /** Lamp nodes the body actually has; the default is the full carbody.py set. */
  readonly lights?: VehicleLightsDef;
  readonly target: {
    readonly top: number;
    readonly to100: number | null;
    /** Outer-front-wheel turning radius, m. */
    readonly turn: number;
    readonly source: string;
  };
}

/** The lamp nodes tools/carshape/carbody.py writes for a car with every function. */
export const CARSHAPE_LIGHTS: VehicleLightsDef = {
  headlights: ['headlights'],
  taillights: ['taillights'],
  reverseLights: ['reverse_lights'],
  leftBlinkers: ['front_blinker_left', 'rear_blinker_left'],
  rightBlinkers: ['front_blinker_right', 'rear_blinker_right'],
};

/* ---- suspension, as the catalogue writes it (see the notes in carmodels.ts) ---- */
const S = (frontHz: number, rearHz: number, compressionRatio: number, reboundRatio: number, bumpTravel: number): SuspensionTuning =>
  ({ frontHz, rearHz, compressionRatio, reboundRatio, bumpTravel });

export const ROSTER: readonly RosterCar[] = [
  {
    // VAZ-2101 (1970): the pack's sv_vaz2101 driveline and chassis on its own body.
    id: 'rs_vaz2101',
    label: 'VAZ-2101 Zhiguli',
    body: 'vaz2101.glb',
    bodyClass: 'car',
    factory: { length: 4.073, width: 1.611, height: 1.382, clearance: 0.17, wheelbase: 2.424, frontTrack: 1.349, rearTrack: 1.305, wheelRadius: 0.297, tyreWidth: 0.155, frontOverhang: 0.63 },
    mass: 955,
    frontWeightShare: 0.51,
    rearDriveBias: 1,
    engine: 'engine_lada_1200',
    gearbox: 'gearbox_lada_4',
    tankLitres: 39,
    wheelGrip: 0.558,
    brakeDecelG: 0.5,
    steerLock: 0.52,
    dragArea: 0.95,
    handlingProfile: 'classic',
    suspension: S(1.1, 1.28, 0.24, 0.38, 0.095),
    tyre: { construction: 'radial', aspect: 0.8 },
    target: { top: 142, to100: 20, turn: 5.6, source: 'AO vaz-2101 (1982 catalogue)' },
  },
  {
    // Fiat 124 Berlina (1966): 1197 cc 124A four, 60 PS DIN at 5600 and 8.9 kgm at
    // 3400, four-speed on a 4.3 axle, discs all round, 855 kg; 150 km/h, 10.6 m circle.
    id: 'rs_fiat124',
    label: 'Fiat 124',
    body: 'fiat124.glb',
    bodyClass: 'car',
    factory: { length: 4.042, width: 1.625, height: 1.42, clearance: 0.13, wheelbase: 2.42, frontTrack: 1.33, rearTrack: 1.30, wheelRadius: 0.29, tyreWidth: 0.15, frontOverhang: 0.56 },
    mass: 855,
    frontWeightShare: 0.53,
    rearDriveBias: 1,
    engine: {
      label: '1.2 Fiat 124A inline-four', mass: 108,
      spec: { peakPowerKw: 44.1, powerPeakRpm: 5600, peakTorqueNm: 87, torquePeakRpm: 3400, redlineRpm: 6000, idleRpm: 800, bsfc: 0.32, brakingCoeff: 0.0138, cylinders: 4 },
      rated: { ps: 60 }, ratedTorqueNm: 87, source: 'Fiat 124 (1966) catalogue: 60 CV DIN at 5600, 8.9 kgm at 3400',
    },
    gearbox: {
      label: 'Fiat 124 four-speed', mass: 30,
      spec: { ratios: [3.75, 2.3, 1.49, 1.0], reverse: 3.87, finalDrive: 4.3, shiftTime: 0.35, automatic: false, efficiency: 0.9 },
    },
    tankLitres: 39,
    wheelGrip: 0.58,
    brakeDecelG: 0.65,
    steerLock: 0.551,
    dragArea: 0.640,
    handlingProfile: 'classic',
    suspension: S(1.1, 1.28, 0.24, 0.38, 0.095),
    tyre: { construction: 'radial', aspect: 0.82 },
    lights: { ...CARSHAPE_LIGHTS },
    target: { top: 150, to100: null, turn: 5.3, source: 'Fiat 124 (1966) catalogue; turning circle 10.6 m' },
  },
];

export function rosterEngineId(car: RosterCar): string {
  return typeof car.engine === 'string' ? car.engine : `rs_${car.id.slice(3)}_engine`;
}

export function rosterGearboxId(car: RosterCar): string {
  return typeof car.gearbox === 'string' ? car.gearbox : `rs_${car.id.slice(3)}_gearbox`;
}
