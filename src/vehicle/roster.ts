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
    factory: { length: 4.073, width: 1.611, height: 1.382, clearance: 0.17, wheelbase: 2.424, frontTrack: 1.349, rearTrack: 1.305, wheelRadius: 0.297, tyreWidth: 0.155, frontOverhang: 0.603 },
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
    factory: { length: 4.042, width: 1.625, height: 1.42, clearance: 0.13, wheelbase: 2.42, frontTrack: 1.33, rearTrack: 1.30, wheelRadius: 0.29, tyreWidth: 0.15, frontOverhang: 0.595 },
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
  {
    // Moskvich-412 (1967): UZAM-412 1.48 four, 75 hp at 5800 and 11.5 kgm at 3800,
    // four-speed on a 4.22 axle, leaf-sprung rear, 1045 kg; 140 km/h, 0-100 in 19 s.
    id: 'rs_moskvich412',
    label: 'Moskvich-412',
    body: 'moskvich412.glb',
    bodyClass: 'car',
    factory: { length: 4.25, width: 1.55, height: 1.48, clearance: 0.175, wheelbase: 2.4, frontTrack: 1.27, rearTrack: 1.27, wheelRadius: 0.29, tyreWidth: 0.165, frontOverhang: 0.675 },
    mass: 1045,
    frontWeightShare: 0.53,
    rearDriveBias: 1,
    engine: {
      label: '1.5 UZAM-412 inline-four', mass: 125,
      spec: { peakPowerKw: 55.2, powerPeakRpm: 5800, peakTorqueNm: 113, torquePeakRpm: 3800, redlineRpm: 6200, idleRpm: 800, bsfc: 0.33, brakingCoeff: 0.0174, cylinders: 4 },
      rated: { hp: 74 }, ratedTorqueNm: 113, source: 'Moskvich-412 catalogue: 75 l.s. at 5800, 11.5 kgm at 3800',
    },
    gearbox: {
      label: 'Moskvich-412 four-speed', mass: 32,
      spec: { ratios: [3.49, 2.04, 1.33, 1.0], reverse: 3.39, finalDrive: 4.22, shiftTime: 0.35, automatic: false, efficiency: 0.9 },
    },
    tankLitres: 46,
    wheelGrip: 0.56,
    brakeDecelG: 0.55,
    steerLock: 0.52,
    dragArea: 1.181,
    handlingProfile: 'classic',
    suspension: S(1.15, 1.45, 0.24, 0.38, 0.1),
    tyre: { construction: 'crossply', aspect: 0.9 },
    target: { top: 140, to100: null, turn: 5.5, source: 'Moskvich-412 catalogue (autoopt.ru)' },
  },
  {
    // Volvo 240 GL 2.3 (1986): B230F, 114 hp at 5400 and 185 Nm at 2750, M47 five-speed
    // on a 3.73 axle, 1300 kg, live rear axle; 175 km/h, a 9.9 m turning circle.
    id: 'rs_volvo240',
    label: 'Volvo 240',
    body: 'volvo240.glb',
    bodyClass: 'car',
    factory: { length: 4.79, width: 1.71, height: 1.435, clearance: 0.14, wheelbase: 2.64, frontTrack: 1.42, rearTrack: 1.36, wheelRadius: 0.305, tyreWidth: 0.185, frontOverhang: 0.84 },
    mass: 1300,
    frontWeightShare: 0.54,
    rearDriveBias: 1,
    engine: {
      label: '2.3 Volvo B230F inline-four', mass: 150,
      spec: { peakPowerKw: 85, powerPeakRpm: 5400, peakTorqueNm: 185, torquePeakRpm: 2750, redlineRpm: 6000, idleRpm: 800, bsfc: 0.31, brakingCoeff: 0.0294, cylinders: 4 },
      rated: { hp: 114 }, ratedTorqueNm: 185, source: 'Volvo 240 1990 specifications: B230F 114 hp at 5400, 185 Nm at 2750',
    },
    gearbox: {
      label: 'Volvo M47 five-speed', mass: 38,
      spec: { ratios: [4.03, 2.16, 1.37, 1.0, 0.83], reverse: 3.68, finalDrive: 3.73, shiftTime: 0.32, automatic: false, efficiency: 0.9 },
    },
    tankLitres: 60,
    wheelGrip: 0.72,
    brakeDecelG: 0.8,
    steerLock: 0.645,
    dragArea: 0.9,
    handlingProfile: 'road',
    suspension: S(1.05, 1.25, 0.24, 0.4, 0.1),
    tyre: { construction: 'radial', aspect: 0.7 },
    target: { top: 175, to100: null, turn: 4.95, source: 'Volvo 240 GL 2.3 (1990) brochure; 9.9 m turning circle' },
  },
  {
    // VAZ-2108 (1984): the pack's sv_vaz2108 driveline and chassis on its own body.
    id: 'rs_vaz2108',
    label: 'VAZ-2108 Sputnik',
    body: 'vaz2108.glb',
    bodyClass: 'car',
    factory: { length: 4.006, width: 1.62, height: 1.335, clearance: 0.16, wheelbase: 2.46, frontTrack: 1.39, rearTrack: 1.36, wheelRadius: 0.281, tyreWidth: 0.165, frontOverhang: 0.785 },
    mass: 900,
    frontWeightShare: 0.62,
    rearDriveBias: 0,
    engine: 'engine_samara_1300',
    gearbox: 'gearbox_samara_5',
    tankLitres: 43,
    wheelGrip: 0.65,
    brakeDecelG: 0.57,
    steerLock: 0.56,
    dragArea: 0.88,
    handlingProfile: 'road',
    suspension: S(1.3, 1.55, 0.28, 0.42, 0.085),
    tyre: { construction: 'radial', aspect: 0.7 },
    target: { top: 148, to100: null, turn: 5.2, source: 'AO vaz-2108 (its 16 s 0-100 is the catalogue-optimistic case in tools/reality.ts)' },
  },
  {
    // GAZ-21 Volga: the pack's sv_gaz21 driveline and chassis on its own body.
    id: 'rs_gaz21',
    label: 'GAZ-21 Volga',
    body: 'gaz21.glb',
    bodyClass: 'car',
    factory: { length: 4.83, width: 1.8, height: 1.62, clearance: 0.19, wheelbase: 2.7, frontTrack: 1.41, rearTrack: 1.42, wheelRadius: 0.365, tyreWidth: 0.17, frontOverhang: 0.82 },
    mass: 1460,
    frontWeightShare: 0.48,
    rearDriveBias: 1,
    engine: 'engine_zmz_21',
    gearbox: 'gearbox_gaz_3',
    tankLitres: 60,
    wheelGrip: 0.522,
    brakeDecelG: 0.42,
    steerLock: 0.504,
    dragArea: 1.12,
    handlingProfile: 'classic',
    suspension: S(0.95, 1.15, 0.18, 0.3, 0.1),
    tyre: { construction: 'crossply', aspect: 0.95 },
    target: { top: 130, to100: null, turn: 6.3, source: 'AO gaz-21' },
  },
  {
    // Mercedes-Benz 240 D (W123): OM616 2.4 diesel, 72 PS at 4400 and 137 Nm at 2400,
    // four-speed on a 3.69 axle, 1390 kg, semi-trailing-arm rear; 138 km/h, 11.3 m circle.
    id: 'rs_w123',
    label: 'Mercedes-Benz 240 D',
    body: 'w123.glb',
    bodyClass: 'car',
    factory: { length: 4.725, width: 1.786, height: 1.438, clearance: 0.16, wheelbase: 2.795, frontTrack: 1.488, rearTrack: 1.446, wheelRadius: 0.31, tyreWidth: 0.175, frontOverhang: 0.81 },
    mass: 1390,
    frontWeightShare: 0.54,
    rearDriveBias: 1,
    engine: {
      label: '2.4 Mercedes OM616 diesel', mass: 210,
      spec: { peakPowerKw: 53, powerPeakRpm: 4400, peakTorqueNm: 137, torquePeakRpm: 2400, redlineRpm: 4700, idleRpm: 750, bsfc: 0.26, brakingCoeff: 0.0278, cylinders: 4 },
      rated: { ps: 72 }, ratedTorqueNm: 137, source: 'Mercedes-Benz 240 D (W123) data: 72 PS at 4400, 137 Nm at 2400',
    },
    gearbox: {
      label: 'Mercedes four-speed', mass: 40,
      spec: { ratios: [3.9, 2.3, 1.41, 1.0], reverse: 3.66, finalDrive: 3.69, shiftTime: 0.4, automatic: false, efficiency: 0.9 },
    },
    tankLitres: 65,
    wheelGrip: 0.7,
    brakeDecelG: 0.75,
    steerLock: 0.590,
    dragArea: 1.127,
    handlingProfile: 'road',
    suspension: S(1.1, 1.25, 0.26, 0.42, 0.1),
    tyre: { construction: 'radial', aspect: 0.82 },
    target: { top: 138, to100: null, turn: 5.65, source: 'Mercedes-Benz W123 240 D data; 11.3 m turning circle' },
  },
  {
    // BMW 2002 (1968): M10 2.0, 100 PS DIN at 5500 and 16 kgm at 3000, four-speed on a
    // 3.64 axle, semi-trailing-arm rear, 990 kg; 170 km/h, 0-100 in 10.6 s, 10.4 m circle.
    id: 'rs_bmw2002',
    label: 'BMW 2002',
    body: 'bmw2002.glb',
    bodyClass: 'car',
    factory: { length: 4.23, width: 1.59, height: 1.41, clearance: 0.16, wheelbase: 2.5, frontTrack: 1.33, rearTrack: 1.33, wheelRadius: 0.29, tyreWidth: 0.165, frontOverhang: 0.66 },
    mass: 990,
    frontWeightShare: 0.53,
    rearDriveBias: 1,
    engine: {
      label: '2.0 BMW M10 inline-four', mass: 135,
      spec: { peakPowerKw: 73.5, powerPeakRpm: 5500, peakTorqueNm: 157, torquePeakRpm: 3000, redlineRpm: 6200, idleRpm: 850, bsfc: 0.31, brakingCoeff: 0.0242, cylinders: 4 },
      rated: { ps: 100 }, ratedTorqueNm: 157, source: 'BMW 2002 (1968) data: 100 PS DIN at 5500, 16 kgm at 3000',
    },
    gearbox: {
      label: 'BMW 2002 four-speed', mass: 32,
      spec: { ratios: [3.835, 2.053, 1.345, 1.0], reverse: 4.18, finalDrive: 3.64, shiftTime: 0.3, automatic: false, efficiency: 0.9 },
    },
    tankLitres: 46,
    wheelGrip: 0.72,
    brakeDecelG: 0.75,
    steerLock: 0.564,
    dragArea: 0.879,
    handlingProfile: 'road',
    suspension: S(1.2, 1.4, 0.26, 0.42, 0.09),
    tyre: { construction: 'radial', aspect: 0.82 },
    antiRoll: { front: 0.5, rear: 0.0 },
    target: { top: 170, to100: null, turn: 5.2, source: 'BMW 2002 (1968) data; 10.4 m turning circle' },
  },
  {
    // Volkswagen Golf 1.1 (1974): EA111 1.1, 50 PS at 6000 and 7.8 kgm at 3000, four-speed
    // transaxle on a 4.57 final drive, 750 kg; 140 km/h, 0-100 in 16 s, 10.3 m circle.
    id: 'rs_golf1',
    label: 'Volkswagen Golf',
    body: 'golf1.glb',
    bodyClass: 'car',
    factory: { length: 3.815, width: 1.61, height: 1.395, clearance: 0.12, wheelbase: 2.4, frontTrack: 1.39, rearTrack: 1.35, wheelRadius: 0.28, tyreWidth: 0.155, frontOverhang: 0.77 },
    mass: 750,
    frontWeightShare: 0.62,
    rearDriveBias: 0,
    engine: {
      label: '1.1 VW EA111 inline-four', mass: 92,
      spec: { peakPowerKw: 36.8, powerPeakRpm: 6000, peakTorqueNm: 77, torquePeakRpm: 3000, redlineRpm: 6400, idleRpm: 850, bsfc: 0.32, brakingCoeff: 0.0115, cylinders: 4 },
      rated: { ps: 50 }, ratedTorqueNm: 77, source: 'VW Golf 1.1 (1974) data: 50 PS at 6000, 77 Nm at 3000',
    },
    gearbox: {
      label: 'VW Golf four-speed transaxle', mass: 30,
      spec: { ratios: [3.45, 1.96, 1.37, 0.97], reverse: 3.17, finalDrive: 4.57, shiftTime: 0.3, automatic: false, efficiency: 0.92 },
    },
    tankLitres: 45,
    wheelGrip: 0.7,
    brakeDecelG: 0.72,
    steerLock: 0.55,
    dragArea: 0.799,
    handlingProfile: 'road',
    suspension: S(1.3, 1.55, 0.28, 0.42, 0.09),
    tyre: { construction: 'radial', aspect: 0.82 },
    target: { top: 140, to100: null, turn: 5.15, source: 'VW Golf 1.1 (1974) data; 10.3 m turning circle' },
  },
  {
    // Ford Escort Mk II 1600 Sport (1975): Kent 1.6, 84 PS at 5500 and 12.7 kgm at 3500,
    // four-speed on a 3.54 axle, leaf-sprung live axle, 900 kg; 160 km/h, 0-100 in 10.8 s.
    id: 'rs_escort',
    label: 'Ford Escort',
    body: 'escort.glb',
    bodyClass: 'car',
    factory: { length: 3.978, width: 1.595, height: 1.39, clearance: 0.14, wheelbase: 2.405, frontTrack: 1.27, rearTrack: 1.3, wheelRadius: 0.29, tyreWidth: 0.175, frontOverhang: 0.68 },
    mass: 900,
    frontWeightShare: 0.53,
    rearDriveBias: 1,
    engine: {
      label: '1.6 Ford Kent inline-four', mass: 120,
      spec: { peakPowerKw: 61.8, powerPeakRpm: 5500, peakTorqueNm: 125, torquePeakRpm: 3500, redlineRpm: 6200, idleRpm: 800, bsfc: 0.32, brakingCoeff: 0.0193, cylinders: 4 },
      rated: { ps: 84 }, ratedTorqueNm: 125, source: 'Ford Escort 1600 Sport (1975) data: 84 PS DIN at 5500, 125 Nm at 3500',
    },
    gearbox: {
      label: 'Ford Type E four-speed', mass: 28,
      spec: { ratios: [3.337, 1.995, 1.418, 1.0], reverse: 3.876, finalDrive: 3.54, shiftTime: 0.28, automatic: false, efficiency: 0.9 },
    },
    tankLitres: 41,
    wheelGrip: 0.74,
    brakeDecelG: 0.75,
    steerLock: 0.591,
    dragArea: 0.893,
    handlingProfile: 'road',
    suspension: S(1.25, 1.55, 0.26, 0.42, 0.09),
    tyre: { construction: 'radial', aspect: 0.7 },
    target: { top: 160, to100: null, turn: 4.8, source: 'Ford Escort Mk II 1600 Sport data; 9.6 m turning circle' },
  },
  {
    // VAZ-2121 Niva: the pack's sv_niva driveline and chassis on its own body.
    id: 'rs_niva',
    label: 'VAZ-2121 Niva',
    body: 'niva.glb',
    bodyClass: 'car',
    factory: { length: 3.72, width: 1.68, height: 1.64, clearance: 0.22, wheelbase: 2.2, frontTrack: 1.43, rearTrack: 1.4, wheelRadius: 0.343, tyreWidth: 0.175, frontOverhang: 0.7 },
    mass: 1150,
    frontWeightShare: 0.53,
    rearDriveBias: 0.5,
    engine: 'engine_niva_1600',
    gearbox: 'gearbox_niva_4',
    tankLitres: 42,
    wheelGrip: 0.576,
    brakeDecelG: 0.48,
    steerLock: 0.496,
    dragArea: 1.3,
    handlingProfile: 'utility',
    suspension: S(1.15, 1.2, 0.24, 0.4, 0.14),
    tyre: { construction: 'radial', aspect: 0.8 },
    target: { top: 132, to100: null, turn: 5.5, source: 'AO vaz-2121' },
  },
  {
    // ZAZ-968M (1979): MeMZ-968 1.2 air-cooled V4 behind the rear axle, 41 hp at 4400
    // and 75 Nm at 3000, four-speed transaxle on a 4.125 final drive, 840 kg; 118 km/h.
    id: 'rs_zaz968',
    label: 'ZAZ-968M',
    body: 'zaz968.glb',
    bodyClass: 'car',
    factory: { length: 3.765, width: 1.49, height: 1.37, clearance: 0.175, wheelbase: 2.16, frontTrack: 1.228, rearTrack: 1.212, wheelRadius: 0.29, tyreWidth: 0.155, frontOverhang: 0.72 },
    mass: 840,
    frontWeightShare: 0.41,
    rearDriveBias: 1,
    engine: {
      label: '1.2 MeMZ-968 air-cooled V4', mass: 95,
      spec: { peakPowerKw: 30.2, powerPeakRpm: 4400, peakTorqueNm: 75, torquePeakRpm: 3000, redlineRpm: 4800, idleRpm: 900, bsfc: 0.35, brakingCoeff: 0.0149, cylinders: 4 },
      rated: { hp: 41 }, ratedTorqueNm: 75, source: 'ZAZ-968M catalogue: MeMZ-968 41 hp at 4400, 7.6 kgm at 3000',
    },
    gearbox: {
      label: 'ZAZ-968 four-speed transaxle', mass: 30,
      spec: { ratios: [3.8, 2.12, 1.41, 0.96], reverse: 4.165, finalDrive: 4.125, shiftTime: 0.4, automatic: false, efficiency: 0.92 },
    },
    tankLitres: 40,
    wheelGrip: 0.56,
    brakeDecelG: 0.5,
    steerLock: 0.487,
    dragArea: 1.044,
    handlingProfile: 'classic',
    suspension: S(1.15, 1.3, 0.22, 0.36, 0.1),
    tyre: { construction: 'crossply', aspect: 0.9 },
    target: { top: 118, to100: null, turn: 5.25, source: 'ZAZ-968M catalogue (autoopt.ru)' },
  },
  {
    // Renault 5 Alpine (1976): 1.4 Cléon-Fonte, 93 PS at 6400 and 11.8 kgm at 4000,
    // five-speed transaxle, 850 kg; 175 km/h, 0-100 in 9.7 s, a 10 m turning circle.
    id: 'rs_renault5',
    label: 'Renault 5 Alpine',
    body: 'renault5.glb',
    bodyClass: 'car',
    factory: { length: 3.506, width: 1.525, height: 1.33, clearance: 0.12, wheelbase: 2.434, frontTrack: 1.29, rearTrack: 1.27, wheelRadius: 0.275, tyreWidth: 0.155, frontOverhang: 0.50 },
    mass: 850,
    frontWeightShare: 0.6,
    rearDriveBias: 0,
    engine: {
      label: '1.4 Renault Cléon-Fonte inline-four', mass: 105,
      spec: { peakPowerKw: 68.4, powerPeakRpm: 6400, peakTorqueNm: 116, torquePeakRpm: 4000, redlineRpm: 6900, idleRpm: 900, bsfc: 0.31, brakingCoeff: 0.0161, cylinders: 4 },
      rated: { ps: 93 }, ratedTorqueNm: 116, source: 'Renault 5 Alpine (1976) data: 93 PS DIN at 6400, 11.8 kgm at 4000',
    },
    gearbox: {
      label: 'Renault five-speed transaxle', mass: 34,
      spec: { ratios: [3.818, 2.235, 1.478, 1.036, 0.861], reverse: 3.083, finalDrive: 3.78, shiftTime: 0.28, automatic: false, efficiency: 0.92 },
    },
    tankLitres: 38,
    wheelGrip: 0.78,
    brakeDecelG: 0.8,
    steerLock: 0.55,
    dragArea: 0.75,
    handlingProfile: 'sport',
    suspension: S(1.45, 1.7, 0.3, 0.45, 0.08),
    tyre: { construction: 'radial', aspect: 0.7 },
    antiRoll: { front: 0.6, rear: 0.3 },
    target: { top: 175, to100: 9.7, turn: 5.0, source: 'Renault 5 Alpine (1976) data' },
  },
  {
    // Škoda 110 R (1970): 1.1 OHV four behind the rear axle, 52 PS DIN at 4650 and
    // 9.1 kgm at 3500, four-speed transaxle on a 4.44 final drive, 880 kg; 145 km/h.
    id: 'rs_skoda110r',
    label: 'Škoda 110 R',
    body: 'skoda110r.glb',
    bodyClass: 'car',
    factory: { length: 4.155, width: 1.62, height: 1.35, clearance: 0.175, wheelbase: 2.4, frontTrack: 1.28, rearTrack: 1.25, wheelRadius: 0.30, tyreWidth: 0.155, frontOverhang: 0.815 },
    mass: 880,
    frontWeightShare: 0.39,
    rearDriveBias: 1,
    engine: {
      label: '1.1 Škoda 742 inline-four', mass: 95,
      spec: { peakPowerKw: 38.2, powerPeakRpm: 4650, peakTorqueNm: 89, torquePeakRpm: 3500, redlineRpm: 5800, idleRpm: 850, bsfc: 0.33, brakingCoeff: 0.0157, cylinders: 4 },
      rated: { ps: 52 }, ratedTorqueNm: 89, source: 'Škoda 110 R (1970) data: 52 PS DIN at 4650, 9.1 kgm at 3500',
    },
    gearbox: {
      label: 'Škoda four-speed transaxle', mass: 30,
      spec: { ratios: [3.8, 2.12, 1.41, 0.96], reverse: 3.27, finalDrive: 4.44, shiftTime: 0.35, automatic: false, efficiency: 0.92 },
    },
    tankLitres: 32,
    wheelGrip: 0.62,
    brakeDecelG: 0.65,
    steerLock: 0.542,
    dragArea: 0.640,
    handlingProfile: 'classic',
    suspension: S(1.15, 1.35, 0.24, 0.38, 0.1),
    tyre: { construction: 'radial', aspect: 0.82 },
    target: { top: 145, to100: null, turn: 5.25, source: 'Škoda 110 R (1970) data' },
  },
  {
    // Mini Cooper S 1275 (1965): the proving ground's pg_mini driveline and chassis
    // (vehicle/carmodels.ts) on its own body.
    id: 'rs_mini',
    label: 'Mini Cooper S',
    body: 'mini.glb',
    bodyClass: 'car',
    factory: { length: 3.054, width: 1.41, height: 1.346, clearance: 0.15, wheelbase: 2.036, frontTrack: 1.214, rearTrack: 1.176, wheelRadius: 0.255, tyreWidth: 0.145, frontOverhang: 0.45 },
    mass: 650,
    frontWeightShare: 0.62,
    rearDriveBias: 0,
    engine: 'engine_bmc_1275s',
    gearbox: 'gearbox_mini_cr4',
    tankLitres: 50,
    wheelGrip: 0.72,
    brakeDecelG: 0.75,
    steerLock: 0.489,
    dragArea: 0.905,
    handlingProfile: 'road',
    suspension: S(1.7, 1.9, 0.3, 0.45, 0.05),
    tyre: { construction: 'radial', aspect: 0.82 },
    antiRoll: { front: 0, rear: 0 },
    target: { top: 157, to100: null, turn: 4.85, source: 'automobile-catalog Cooper S 1275, 3.44 axle' },
  },
  {
    // Ford Capri 2.0 S (Mk III, 1978): Pinto 2.0, 101 PS at 5200 and 152 Nm at 3500,
    // four-speed on a 3.44 axle, leaf-sprung live axle, 1050 kg; 180 km/h, 10.4 m circle.
    id: 'rs_capri',
    label: 'Ford Capri',
    body: 'capri.glb',
    bodyClass: 'car',
    factory: { length: 4.439, width: 1.698, height: 1.32, clearance: 0.12, wheelbase: 2.563, frontTrack: 1.353, rearTrack: 1.384, wheelRadius: 0.295, tyreWidth: 0.185, frontOverhang: 0.86 },
    mass: 1050,
    frontWeightShare: 0.55,
    rearDriveBias: 1,
    engine: {
      label: '2.0 Ford Pinto inline-four', mass: 140,
      spec: { peakPowerKw: 74.3, powerPeakRpm: 5200, peakTorqueNm: 152, torquePeakRpm: 3500, redlineRpm: 6000, idleRpm: 800, bsfc: 0.32, brakingCoeff: 0.0242, cylinders: 4 },
      rated: { ps: 101 }, ratedTorqueNm: 152, source: 'Ford Capri 2.0 S (1978) data: 101 PS DIN at 5200, 152 Nm at 3500',
    },
    gearbox: {
      label: 'Ford Type E four-speed', mass: 30,
      spec: { ratios: [3.65, 1.97, 1.37, 1.0], reverse: 3.66, finalDrive: 3.44, shiftTime: 0.3, automatic: false, efficiency: 0.9 },
    },
    tankLitres: 58,
    wheelGrip: 0.74,
    brakeDecelG: 0.78,
    steerLock: 0.584,
    dragArea: 0.748,
    handlingProfile: 'road',
    suspension: S(1.2, 1.5, 0.26, 0.42, 0.09),
    tyre: { construction: 'radial', aspect: 0.7 },
    target: { top: 180, to100: null, turn: 5.2, source: 'Ford Capri 2.0 S (Mk III) data; 10.4 m turning circle' },
  },
  {
    // Saab 96 V4 (1967): Ford Taunus 1.5 V4, 65 PS at 4700 and 116 Nm at 2500, column-
    // shift four-speed with the freewheel, front drive, 950 kg; 145 km/h, 10.8 m circle.
    id: 'rs_saab96',
    label: 'Saab 96',
    body: 'saab96.glb',
    bodyClass: 'car',
    factory: { length: 4.02, width: 1.58, height: 1.47, clearance: 0.18, wheelbase: 2.498, frontTrack: 1.22, rearTrack: 1.22, wheelRadius: 0.31, tyreWidth: 0.155, frontOverhang: 0.63 },
    mass: 950,
    frontWeightShare: 0.6,
    rearDriveBias: 0,
    engine: {
      label: '1.5 Ford Taunus V4', mass: 110,
      spec: { peakPowerKw: 47.8, powerPeakRpm: 4700, peakTorqueNm: 116, torquePeakRpm: 2500, redlineRpm: 5500, idleRpm: 800, bsfc: 0.33, brakingCoeff: 0.0209, cylinders: 4 },
      rated: { ps: 65 }, ratedTorqueNm: 116, source: 'Saab 96 V4 (1967) data: 65 PS DIN at 4700, 116 Nm at 2500',
    },
    gearbox: {
      label: 'Saab four-speed with freewheel', mass: 32,
      // Final drive not sourced: set so the published top speed falls at the rated speed.
      spec: { ratios: [3.39, 2.1, 1.34, 0.96], reverse: 3.29, finalDrive: 4.4, shiftTime: 0.4, automatic: false, efficiency: 0.92 },
    },
    tankLitres: 40,
    wheelGrip: 0.66,
    brakeDecelG: 0.66,
    steerLock: 0.52,
    dragArea: 0.618,
    handlingProfile: 'road',
    suspension: S(1.1, 1.3, 0.24, 0.4, 0.11),
    tyre: { construction: 'radial', aspect: 0.82 },
    target: { top: 145, to100: null, turn: 5.4, source: 'Saab 96 V4 (1967) data; 10.8 m turning circle' },
  },
  {
    // Citroën DS 21 (1968): 2175 cc four, 100 PS DIN at 5500 and 17 kgm at 3000, four-
    // speed on a 3.31 final drive, hydropneumatic suspension, 1280 kg; 175 km/h.
    id: 'rs_citroends',
    label: 'Citroën DS',
    body: 'citroends.glb',
    bodyClass: 'car',
    factory: { length: 4.874, width: 1.79, height: 1.47, clearance: 0.145, wheelbase: 3.125, frontTrack: 1.516, rearTrack: 1.316, wheelRadius: 0.33, tyreWidth: 0.18, frontOverhang: 1.016 },
    mass: 1280,
    frontWeightShare: 0.65,
    rearDriveBias: 0,
    engine: {
      label: '2.2 Citroën DX inline-four', mass: 160,
      spec: { peakPowerKw: 73.5, powerPeakRpm: 5500, peakTorqueNm: 167, torquePeakRpm: 3000, redlineRpm: 5900, idleRpm: 800, bsfc: 0.32, brakingCoeff: 0.0270, cylinders: 4 },
      rated: { ps: 100 }, ratedTorqueNm: 167, source: 'Citroën DS 21 (1968) data: 100 PS DIN at 5500, 17 kgm at 3000',
    },
    gearbox: {
      label: 'Citroën DS four-speed transaxle', mass: 40,
      spec: { ratios: [3.25, 1.94, 1.27, 0.86], reverse: 3.17, finalDrive: 3.31, shiftTime: 0.4, automatic: false, efficiency: 0.92 },
    },
    tankLitres: 65,
    wheelGrip: 0.7,
    brakeDecelG: 0.8,
    steerLock: 0.640,
    dragArea: 0.727,
    handlingProfile: 'road',
    // Hydropneumatic: the softest springs on the list, well damped, long travel.
    suspension: S(0.75, 0.8, 0.3, 0.45, 0.16),
    tyre: { construction: 'radial', aspect: 0.82 },
    target: { top: 175, to100: null, turn: 5.6, source: 'Citroën DS 21 (1968) data' },
  },
  {
    // Renault 4 TL (1978): 845 cc four, 34 PS DIN at 5000 and 57 Nm at 2500, four-speed
    // transaxle with the dashboard push-pull lever, 620 kg; 115 km/h, 9.6 m circle.
    id: 'rs_renault4',
    label: 'Renault 4',
    body: 'renault4.glb',
    bodyClass: 'car',
    factory: { length: 3.668, width: 1.485, height: 1.55, clearance: 0.175, wheelbase: 2.401, frontTrack: 1.28, rearTrack: 1.244, wheelRadius: 0.275, tyreWidth: 0.135, frontOverhang: 0.528 },
    mass: 620,
    frontWeightShare: 0.6,
    rearDriveBias: 0,
    engine: {
      label: '0.85 Renault Billancourt inline-four', mass: 70,
      spec: { peakPowerKw: 25, powerPeakRpm: 5000, peakTorqueNm: 57, torquePeakRpm: 2500, redlineRpm: 5400, idleRpm: 800, bsfc: 0.34, brakingCoeff: 0.0101, cylinders: 4 },
      rated: { ps: 34 }, ratedTorqueNm: 57, source: 'Renault 4 TL (1978) data: 34 PS DIN at 5000, 57 Nm at 2500',
    },
    gearbox: {
      label: 'Renault 4 four-speed transaxle', mass: 25,
      spec: { ratios: [3.8, 2.06, 1.36, 0.97], reverse: 3.8, finalDrive: 4.12, shiftTime: 0.45, automatic: false, efficiency: 0.92 },
    },
    tankLitres: 34,
    wheelGrip: 0.6,
    brakeDecelG: 0.62,
    steerLock: 0.590,
    dragArea: 0.942,
    handlingProfile: 'classic',
    // Long soft torsion bars: it leans a long way and rides everything.
    suspension: S(0.95, 1.05, 0.2, 0.32, 0.14),
    tyre: { construction: 'radial', aspect: 0.82 },
    antiRoll: { front: 0.3, rear: 0.0 },
    target: { top: 115, to100: null, turn: 4.8, source: 'Renault 4 TL (1978) data; 9.6 m turning circle' },
  },
  {
    // Porsche 911 SC: the proving ground's pg_911sc driveline and chassis on its own body.
    id: 'rs_porsche911',
    label: 'Porsche 911 SC',
    body: 'porsche911.glb',
    bodyClass: 'car',
    factory: { length: 4.291, width: 1.652, height: 1.32, clearance: 0.12, wheelbase: 2.272, frontTrack: 1.372, rearTrack: 1.38, wheelRadius: 0.31, tyreWidth: 0.2, frontOverhang: 0.932 },
    mass: 1160,
    frontWeightShare: 0.39,
    rearDriveBias: 1,
    engine: 'engine_porsche_930_10',
    gearbox: 'gearbox_porsche_915',
    tankLitres: 80,
    wheelGrip: 0.82,
    brakeDecelG: 0.95,
    steerLock: 0.501,
    dragArea: 0.827,
    handlingProfile: 'sport',
    suspension: S(1.45, 1.7, 0.3, 0.45, 0.07),
    tyre: { construction: 'radial', aspect: 0.65 },
    antiRoll: { front: 0.5, rear: 0.35 },
    target: { top: 225, to100: 7.0, turn: 5.35, source: 'carfolio 911 SC 1980; Porsche 0-100 for the 204 PS SC' },
  },
  {
    // Lancia Delta HF Integrale 16v: the proving ground's pg_integrale driveline and
    // chassis on its own body.
    id: 'rs_delta',
    label: 'Lancia Delta Integrale',
    body: 'delta.glb',
    bodyClass: 'car',
    factory: { length: 3.9, width: 1.7, height: 1.365, clearance: 0.14, wheelbase: 2.48, frontTrack: 1.4, rearTrack: 1.38, wheelRadius: 0.295, tyreWidth: 0.205, frontOverhang: 0.75 },
    mass: 1250,
    frontWeightShare: 0.6,
    rearDriveBias: 0.53,
    engine: 'engine_lancia_integrale_16v',
    gearbox: 'gearbox_lancia_integrale',
    tankLitres: 57,
    wheelGrip: 0.85,
    brakeDecelG: 0.9,
    steerLock: 0.563,
    dragArea: 0.777,
    handlingProfile: 'sport',
    suspension: S(1.5, 1.7, 0.3, 0.46, 0.1),
    tyre: { construction: 'radial', aspect: 0.5 },
    antiRoll: { front: 0.6, rear: 0.4 },
    rearDiff: { lock: 0.5, preloadNm: 0 },
    target: { top: 220, to100: null, turn: 5.2, source: 'Lancia Delta HF Integrale 16v (1989) factory figures' },
  },
  {
    // Honda CR-X 1.6i-16 (1985): ZC 1.6 DOHC, 125 PS at 6500 and 143 Nm at 5500, five-
    // speed transaxle on a 4.27 final drive, 840 kg; 200 km/h, 0-100 in 8.6 s.
    id: 'rs_crx',
    label: 'Honda CR-X',
    body: 'crx.glb',
    bodyClass: 'car',
    factory: { length: 3.675, width: 1.625, height: 1.29, clearance: 0.14, wheelbase: 2.2, frontTrack: 1.4, rearTrack: 1.415, wheelRadius: 0.29, tyreWidth: 0.185, frontOverhang: 0.755 },
    mass: 840,
    frontWeightShare: 0.62,
    rearDriveBias: 0,
    engine: {
      label: '1.6 Honda ZC DOHC inline-four', mass: 105,
      spec: { peakPowerKw: 91.9, powerPeakRpm: 6500, peakTorqueNm: 143, torquePeakRpm: 5500, redlineRpm: 7300, idleRpm: 800, bsfc: 0.29, brakingCoeff: 0.0187, cylinders: 4 },
      rated: { ps: 125 }, ratedTorqueNm: 143, source: 'Honda CR-X 1.6i-16 (1985) data: 125 PS DIN at 6500, 143 Nm at 5500',
    },
    gearbox: {
      label: 'Honda five-speed transaxle', mass: 34,
      spec: { ratios: [3.25, 1.89, 1.25, 0.97, 0.81], reverse: 3.0, finalDrive: 4.27, shiftTime: 0.22, automatic: false, efficiency: 0.92 },
    },
    tankLitres: 41,
    wheelGrip: 0.82,
    brakeDecelG: 0.9,
    steerLock: 0.55,
    dragArea: 0.718,
    handlingProfile: 'sport',
    suspension: S(1.5, 1.7, 0.3, 0.45, 0.08),
    tyre: { construction: 'radial', aspect: 0.6 },
    antiRoll: { front: 0.5, rear: 0.4 },
    target: { top: 200, to100: null, turn: 4.8, source: 'Honda CR-X 1.6i-16 (1985) data' },
  },
  {
    // Mazda MX-5 1.6 (NA, 1989): B6 1.6 DOHC, 115 PS at 6500 and 136 Nm at 5500, five-
    // speed on a 4.3 final drive, double wishbones, 950 kg; 195 km/h, 0-100 in 8.6 s.
    id: 'rs_mx5',
    label: 'Mazda MX-5',
    body: 'mx5.glb',
    bodyClass: 'car',
    factory: { length: 3.97, width: 1.675, height: 1.23, clearance: 0.135, wheelbase: 2.265, frontTrack: 1.41, rearTrack: 1.43, wheelRadius: 0.285, tyreWidth: 0.185, frontOverhang: 0.81 },
    mass: 950,
    frontWeightShare: 0.51,
    rearDriveBias: 1,
    engine: {
      label: '1.6 Mazda B6 DOHC inline-four', mass: 110,
      spec: { peakPowerKw: 84.6, powerPeakRpm: 6500, peakTorqueNm: 136, torquePeakRpm: 5500, redlineRpm: 7200, idleRpm: 850, bsfc: 0.29, brakingCoeff: 0.018, cylinders: 4 },
      rated: { ps: 115 }, ratedTorqueNm: 136, source: 'Mazda MX-5 1.6 (1989) data: 115 PS at 6500, 136 Nm at 5500',
    },
    gearbox: {
      label: 'Mazda M five-speed', mass: 35,
      spec: { ratios: [3.136, 1.888, 1.33, 1.0, 0.814], reverse: 3.758, finalDrive: 4.3, shiftTime: 0.2, automatic: false, efficiency: 0.9 },
    },
    tankLitres: 45,
    wheelGrip: 0.84,
    brakeDecelG: 0.92,
    steerLock: 0.604,
    dragArea: 0.68,
    handlingProfile: 'sport',
    suspension: S(1.45, 1.6, 0.3, 0.45, 0.08),
    tyre: { construction: 'radial', aspect: 0.6 },
    antiRoll: { front: 0.5, rear: 0.3 },
    target: { top: 195, to100: null, turn: 4.6, source: 'Mazda MX-5 1.6 (NA) data; 9.2 m turning circle' },
  },
  {
    // Toyota Corolla Levin GT (AE86, 1985 Europe): 4A-GE 1.6, 124 PS at 6600 and 142 Nm
    // at 5800, T50 five-speed on a 4.3 live axle, 950 kg; 195 km/h, 0-100 in 8.5 s.
    id: 'rs_ae86',
    label: 'Toyota Corolla AE86',
    body: 'ae86.glb',
    bodyClass: 'car',
    factory: { length: 4.18, width: 1.625, height: 1.335, clearance: 0.135, wheelbase: 2.4, frontTrack: 1.355, rearTrack: 1.345, wheelRadius: 0.285, tyreWidth: 0.185, frontOverhang: 0.88 },
    mass: 950,
    frontWeightShare: 0.53,
    rearDriveBias: 1,
    engine: {
      label: '1.6 Toyota 4A-GE inline-four', mass: 110,
      spec: { peakPowerKw: 91.2, powerPeakRpm: 6600, peakTorqueNm: 142, torquePeakRpm: 5800, redlineRpm: 7600, idleRpm: 850, bsfc: 0.29, brakingCoeff: 0.0178, cylinders: 4 },
      rated: { ps: 124 }, ratedTorqueNm: 142, source: 'Toyota Corolla GT (AE86, 1985 Europe) data: 124 PS at 6600, 142 Nm at 5800',
    },
    gearbox: {
      label: 'Toyota T50 five-speed', mass: 32,
      spec: { ratios: [3.587, 2.022, 1.384, 1.0, 0.861], reverse: 3.484, finalDrive: 4.3, shiftTime: 0.22, automatic: false, efficiency: 0.9 },
    },
    tankLitres: 50,
    wheelGrip: 0.78,
    brakeDecelG: 0.85,
    steerLock: 0.581,
    dragArea: 0.744,
    handlingProfile: 'sport',
    suspension: S(1.35, 1.55, 0.28, 0.44, 0.09),
    tyre: { construction: 'radial', aspect: 0.7 },
    antiRoll: { front: 0.55, rear: 0.35 },
    target: { top: 195, to100: null, turn: 4.9, source: 'Toyota Corolla GT (AE86, 1985) data; 9.8 m turning circle' },
  },
  {
    // Lancia Fulvia Coupé Rallye 1.3 S (1970): narrow-angle V4 1.3, 90 PS DIN at 6000
    // and 11.5 kgm at 5000, five-speed on a 4.18 final drive, front drive, 960 kg; 170 km/h.
    id: 'rs_fulvia',
    label: 'Lancia Fulvia Coupé',
    body: 'fulvia.glb',
    bodyClass: 'car',
    factory: { length: 3.935, width: 1.555, height: 1.3, clearance: 0.13, wheelbase: 2.33, frontTrack: 1.3, rearTrack: 1.28, wheelRadius: 0.29, tyreWidth: 0.155, frontOverhang: 0.805 },
    mass: 960,
    frontWeightShare: 0.62,
    rearDriveBias: 0,
    engine: {
      label: '1.3 Lancia narrow V4', mass: 110,
      spec: { peakPowerKw: 66.2, powerPeakRpm: 6000, peakTorqueNm: 113, torquePeakRpm: 5000, redlineRpm: 6800, idleRpm: 900, bsfc: 0.31, brakingCoeff: 0.0159, cylinders: 4 },
      rated: { ps: 90 }, ratedTorqueNm: 113, source: 'Lancia Fulvia Coupé Rallye 1.3 S (1970) data: 90 PS DIN at 6000, 11.5 kgm at 5000',
    },
    gearbox: {
      label: 'Lancia Fulvia five-speed', mass: 34,
      spec: { ratios: [3.25, 2.08, 1.42, 1.0, 0.83], reverse: 3.14, finalDrive: 4.18, shiftTime: 0.28, automatic: false, efficiency: 0.92 },
    },
    tankLitres: 38,
    wheelGrip: 0.72,
    brakeDecelG: 0.8,
    steerLock: 0.55,
    dragArea: 0.804,
    handlingProfile: 'road',
    suspension: S(1.3, 1.5, 0.28, 0.42, 0.09),
    tyre: { construction: 'radial', aspect: 0.82 },
    target: { top: 170, to100: null, turn: 5.0, source: 'Lancia Fulvia Coupé Rallye 1.3 S (1970) data' },
  },
  {
    // Honda Civic 1200 (1973): EB1 1.2, 50 PS DIN at 5000 and 8.6 kgm at 3000, four-
    // speed transaxle on a 4.21 final drive, 700 kg; 140 km/h, 9.4 m turning circle.
    id: 'rs_civic',
    label: 'Honda Civic',
    body: 'civic.glb',
    bodyClass: 'car',
    factory: { length: 3.405, width: 1.505, height: 1.325, clearance: 0.165, wheelbase: 2.2, frontTrack: 1.3, rearTrack: 1.28, wheelRadius: 0.27, tyreWidth: 0.145, frontOverhang: 0.65 },
    mass: 700,
    frontWeightShare: 0.62,
    rearDriveBias: 0,
    engine: {
      label: '1.2 Honda EB1 inline-four', mass: 85,
      spec: { peakPowerKw: 36.8, powerPeakRpm: 5000, peakTorqueNm: 84, torquePeakRpm: 3000, redlineRpm: 6000, idleRpm: 850, bsfc: 0.32, brakingCoeff: 0.0134, cylinders: 4 },
      rated: { ps: 50 }, ratedTorqueNm: 84, source: 'Honda Civic 1200 (1973) data: 50 PS DIN at 5000, 8.6 kgm at 3000',
    },
    gearbox: {
      label: 'Honda Civic four-speed transaxle', mass: 26,
      spec: { ratios: [3.0, 1.789, 1.182, 0.846], reverse: 2.916, finalDrive: 4.21, shiftTime: 0.3, automatic: false, efficiency: 0.92 },
    },
    tankLitres: 38,
    wheelGrip: 0.66,
    brakeDecelG: 0.7,
    steerLock: 0.561,
    dragArea: 0.799,
    handlingProfile: 'road',
    suspension: S(1.35, 1.55, 0.28, 0.42, 0.09),
    tyre: { construction: 'radial', aspect: 0.82 },
    target: { top: 140, to100: null, turn: 4.7, source: 'Honda Civic 1200 (1973) data; 9.4 m turning circle' },
  },
  {
    // Datsun 1600 (510, 1968): L16 1.6, 96 hp SAE (70 kW) at 5600 and 135 Nm at 3600,
    // four-speed on a 3.7 axle, semi-trailing-arm independent rear, 920 kg; 160 km/h.
    id: 'rs_datsun510',
    label: 'Datsun 510',
    body: 'datsun510.glb',
    bodyClass: 'car',
    factory: { length: 4.12, width: 1.56, height: 1.40, clearance: 0.15, wheelbase: 2.42, frontTrack: 1.28, rearTrack: 1.28, wheelRadius: 0.29, tyreWidth: 0.155, frontOverhang: 0.69 },
    mass: 920,
    frontWeightShare: 0.54,
    rearDriveBias: 1,
    engine: {
      label: '1.6 Nissan L16 inline-four', mass: 120,
      spec: { peakPowerKw: 70, powerPeakRpm: 5600, peakTorqueNm: 135, torquePeakRpm: 3600, redlineRpm: 6400, idleRpm: 800, bsfc: 0.32, brakingCoeff: 0.0201, cylinders: 4 },
      rated: { kw: 70 }, ratedTorqueNm: 135, source: 'Datsun 1600 (510, 1968) data: 96 hp SAE gross / 70 kW, 135 Nm at 3600',
    },
    gearbox: {
      label: 'Datsun four-speed', mass: 30,
      spec: { ratios: [3.382, 2.013, 1.312, 1.0], reverse: 3.365, finalDrive: 3.7, shiftTime: 0.3, automatic: false, efficiency: 0.9 },
    },
    tankLitres: 45,
    wheelGrip: 0.68,
    brakeDecelG: 0.72,
    steerLock: 0.571,
    dragArea: 1.020,
    handlingProfile: 'road',
    suspension: S(1.2, 1.4, 0.26, 0.42, 0.09),
    tyre: { construction: 'crossply', aspect: 0.9 },
    target: { top: 160, to100: null, turn: 5.0, source: 'Datsun 1600 (510) data' },
  },
  {
    // Ford Mustang 289 hardtop (1965): 289 cu in V8 two-barrel, 200 hp gross (net
    // about 145 hp, 108 kW) at 4400 and 382 Nm at 2400, three-speed manual on a 3.0
    // axle, leaf-sprung live axle, 1300 kg; 175 km/h, 11.8 m circle.
    id: 'rs_mustang65',
    label: 'Ford Mustang 1965',
    body: 'mustang65.glb',
    bodyClass: 'car',
    factory: { length: 4.613, width: 1.732, height: 1.30, clearance: 0.14, wheelbase: 2.743, frontTrack: 1.422, rearTrack: 1.422, wheelRadius: 0.32, tyreWidth: 0.18, frontOverhang: 0.77 },
    mass: 1300,
    frontWeightShare: 0.56,
    rearDriveBias: 1,
    engine: {
      label: '4.7 Ford 289 V8', mass: 210,
      spec: { peakPowerKw: 108, powerPeakRpm: 4400, peakTorqueNm: 382, torquePeakRpm: 2400, redlineRpm: 4900, idleRpm: 600, bsfc: 0.37, brakingCoeff: 0.0745, cylinders: 8 },
      rated: { kw: 108 }, ratedTorqueNm: 382, source: 'Ford 289 2V (1965): 200 hp gross at 4400; net power estimated at 72%, torque 282 lb-ft gross',
    },
    gearbox: {
      label: 'Ford three-speed', mass: 34,
      spec: { ratios: [2.79, 1.70, 1.0], reverse: 2.87, finalDrive: 3.0, shiftTime: 0.35, automatic: false, efficiency: 0.9 },
    },
    tankLitres: 61,
    wheelGrip: 0.66,
    brakeDecelG: 0.62,
    steerLock: 0.550,
    dragArea: 1.219,
    handlingProfile: 'classic',
    suspension: S(1.1, 1.35, 0.22, 0.36, 0.1),
    tyre: { construction: 'crossply', aspect: 0.9 },
    target: { top: 175, to100: null, turn: 5.9, source: 'Ford Mustang 289 (1965) road tests; 11.8 m turning circle' },
  },
  {
    // Dacia 1300 (1969): Renault 810 1.3, 54 PS DIN at 5250 and 9.0 kgm at 3000, four-
    // speed transaxle on a 3.78 final drive, front drive, 900 kg; 145 km/h.
    id: 'rs_dacia',
    label: 'Dacia 1300',
    body: 'dacia.glb',
    bodyClass: 'car',
    factory: { length: 4.348, width: 1.616, height: 1.435, clearance: 0.12, wheelbase: 2.441, frontTrack: 1.312, rearTrack: 1.312, wheelRadius: 0.28, tyreWidth: 0.145, frontOverhang: 0.87 },
    mass: 900,
    frontWeightShare: 0.6,
    rearDriveBias: 0,
    engine: {
      label: '1.3 Renault 810 inline-four', mass: 100,
      spec: { peakPowerKw: 39.7, powerPeakRpm: 5250, peakTorqueNm: 88, torquePeakRpm: 3000, redlineRpm: 5700, idleRpm: 800, bsfc: 0.33, brakingCoeff: 0.0147, cylinders: 4 },
      rated: { ps: 54 }, ratedTorqueNm: 88, source: 'Dacia 1300 (1969) data: 54 PS DIN at 5250, 9.0 kgm at 3000',
    },
    gearbox: {
      label: 'Renault 12 four-speed transaxle', mass: 30,
      spec: { ratios: [3.61, 2.26, 1.48, 1.03], reverse: 3.08, finalDrive: 3.78, shiftTime: 0.38, automatic: false, efficiency: 0.92 },
    },
    tankLitres: 47,
    wheelGrip: 0.6,
    brakeDecelG: 0.62,
    steerLock: 0.560,
    dragArea: 0.765,
    handlingProfile: 'classic',
    suspension: S(1.05, 1.25, 0.22, 0.36, 0.11),
    tyre: { construction: 'radial', aspect: 0.82 },
    target: { top: 145, to100: null, turn: 5.2, source: 'Dacia 1300 (1969) data' },
  },
  {
    // Volkswagen 1300 Beetle (1966): air-cooled flat four behind the rear axle, 44 PS
    // DIN at 4100 and 89 Nm at 3000, four-speed transaxle on a 4.375 final drive, swing
    // axles, 820 kg; 120 km/h.
    id: 'rs_kafer',
    label: 'Volkswagen Käfer',
    body: 'kafer.glb',
    bodyClass: 'car',
    factory: { length: 4.08, width: 1.58, height: 1.5, clearance: 0.15, wheelbase: 2.42, frontTrack: 1.37, rearTrack: 1.35, wheelRadius: 0.315, tyreWidth: 0.15, frontOverhang: 0.753 },
    mass: 820,
    frontWeightShare: 0.42,
    rearDriveBias: 1,
    engine: {
      label: '1.3 VW air-cooled flat four', mass: 105,
      spec: { peakPowerKw: 32.4, powerPeakRpm: 4100, peakTorqueNm: 89, torquePeakRpm: 3000, redlineRpm: 4600, idleRpm: 850, bsfc: 0.34, brakingCoeff: 0.0185, cylinders: 4 },
      rated: { ps: 44 }, ratedTorqueNm: 89, source: 'VW 1300 (1966) data: 44 PS DIN at 4100, 89 Nm at 3000',
    },
    gearbox: {
      label: 'VW Beetle four-speed transaxle', mass: 30,
      spec: { ratios: [3.8, 2.06, 1.26, 0.89], reverse: 3.88, finalDrive: 4.375, shiftTime: 0.4, automatic: false, efficiency: 0.92 },
    },
    tankLitres: 40,
    wheelGrip: 0.6,
    brakeDecelG: 0.6,
    steerLock: 0.526,
    dragArea: 1.081,
    handlingProfile: 'classic',
    // Swing axles: a soft, high roll centre at the back, and a tail that tucks in.
    suspension: S(1.05, 1.2, 0.22, 0.36, 0.11),
    tyre: { construction: 'crossply', aspect: 0.92 },
    antiRoll: { front: 0.3, rear: 0.0 },
    target: { top: 120, to100: null, turn: 5.5, source: 'VW 1300 (1966) data; 11 m turning circle' },
  },
  {
    // Citroën 2CV6: the proving ground's pg_2cv driveline and chassis on its own body.
    id: 'rs_citroen2cv',
    label: 'Citroën 2CV',
    body: 'citroen2cv.glb',
    bodyClass: 'car',
    factory: { length: 3.83, width: 1.48, height: 1.6, clearance: 0.16, wheelbase: 2.4, frontTrack: 1.26, rearTrack: 1.26, wheelRadius: 0.30, tyreWidth: 0.125, frontOverhang: 0.68 },
    mass: 585,
    frontWeightShare: 0.58,
    rearDriveBias: 0,
    engine: 'engine_citroen_a06',
    gearbox: 'gearbox_citroen_4',
    tankLitres: 20,
    wheelGrip: 0.58,
    brakeDecelG: 0.6,
    steerLock: 0.516,
    dragArea: 0.777,
    handlingProfile: 'classic',
    suspension: S(0.9, 0.95, 0.16, 0.28, 0.14),
    tyre: { construction: 'radial', aspect: 0.82 },
    antiRoll: { front: 0, rear: 0 },
    target: { top: 117, to100: null, turn: 5.35, source: 'carfolio 2CV6 1979 (29 bhp, 585 kg, 117 km/h)' },
  },
  {
    // Peugeot 205 GTI 1.6 (1984): XU5J 1.6, 105 PS at 6250 and 135 Nm at 4000, five-
    // speed transaxle on a 4.06 final drive, 875 kg; 190 km/h, 0-100 in 8.7 s. Lifts off
    // into oversteer: torsion-bar rear with no bar to speak of at the front.
    id: 'rs_peugeot205',
    label: 'Peugeot 205 GTI',
    body: 'peugeot205.glb',
    bodyClass: 'car',
    factory: { length: 3.705, width: 1.572, height: 1.355, clearance: 0.108, wheelbase: 2.42, frontTrack: 1.393, rearTrack: 1.332, wheelRadius: 0.29, tyreWidth: 0.185, frontOverhang: 0.68 },
    mass: 875,
    frontWeightShare: 0.63,
    rearDriveBias: 0,
    engine: {
      label: '1.6 Peugeot XU5J inline-four', mass: 115,
      spec: { peakPowerKw: 77.2, powerPeakRpm: 6250, peakTorqueNm: 135, torquePeakRpm: 4000, redlineRpm: 6800, idleRpm: 850, bsfc: 0.3, brakingCoeff: 0.019, cylinders: 4 },
      rated: { ps: 105 }, ratedTorqueNm: 135, source: 'Peugeot 205 GTI 1.6 (1984) data: 105 PS DIN at 6250, 135 Nm at 4000',
    },
    gearbox: {
      label: 'Peugeot BE1 five-speed', mass: 34,
      spec: { ratios: [3.25, 1.85, 1.28, 0.97, 0.76], reverse: 3.33, finalDrive: 4.06, shiftTime: 0.24, automatic: false, efficiency: 0.92 },
    },
    tankLitres: 50,
    wheelGrip: 0.8,
    brakeDecelG: 0.88,
    steerLock: 0.559,
    dragArea: 0.66,
    handlingProfile: 'sport',
    suspension: S(1.5, 1.85, 0.3, 0.45, 0.08),
    tyre: { construction: 'radial', aspect: 0.6 },
    antiRoll: { front: 0.3, rear: 0.7 },
    target: { top: 190, to100: null, turn: 5.1, source: 'Peugeot 205 GTI 1.6 (1984) data' },
  },
  {
    // Ford Falcon (1960): 144 cu in Thriftpower six, 90 hp gross (net about 65 hp, 48 kW)
    // at 4200 and 138 lb-ft at 2000, three-speed column shift on a 3.10 axle, 1070 kg, leaf-sprung live axle;
    // about 140 km/h, 38.6 ft (11.8 m) turning circle.
    id: 'rs_falcon',
    label: 'Ford Falcon',
    body: 'falcon.glb',
    bodyClass: 'car',
    factory: { length: 4.602, width: 1.793, height: 1.384, clearance: 0.15, wheelbase: 2.781, frontTrack: 1.397, rearTrack: 1.384, wheelRadius: 0.29, tyreWidth: 0.16, frontOverhang: 0.73 },
    mass: 1070,
    frontWeightShare: 0.55,
    rearDriveBias: 1,
    engine: {
      label: '2.4 Ford Thriftpower six', mass: 160,
      spec: { peakPowerKw: 48, powerPeakRpm: 4200, peakTorqueNm: 165, torquePeakRpm: 2000, redlineRpm: 4600, idleRpm: 550, bsfc: 0.29, brakingCoeff: 0.026, cylinders: 6 },
      rated: { kw: 48 }, ratedTorqueNm: 165, source: 'Ford Falcon 1960: 90 hp gross at 4200, 138 lb-ft gross at 2000; net estimated at 72% power, 88% torque',
    },
    gearbox: {
      label: 'Ford three-speed', mass: 32,
      spec: { ratios: [2.76, 1.69, 1.0], reverse: 3.57, finalDrive: 3.1, shiftTime: 0.45, automatic: false, efficiency: 0.9 },
    },
    tankLitres: 53,
    wheelGrip: 0.55,
    brakeDecelG: 0.5,
    steerLock: 0.558,
    dragArea: 1.029,
    handlingProfile: 'classic',
    suspension: S(1.0, 1.2, 0.2, 0.32, 0.1),
    tyre: { construction: 'crossply', aspect: 0.95 },
    target: { top: 140, to100: null, turn: 5.9, source: 'Ford Falcon 1960 data; 38.6 ft turning circle' },
  },
  {
    // UAZ-469B (1972): UMZ-451M 2.45, 75 hp at 4000 and 167 Nm at 2200, four-speed and a
    // two-range transfer case (high 1:1) on 5.125 axles without hub reductions, 4x4
    // engaged, leaf springs all round, 1540 kg; about 110 km/h, 13 m turning circle.
    id: 'rs_uaz469',
    label: 'UAZ-469',
    body: 'uaz469.glb',
    bodyClass: 'car',
    factory: { length: 4.025, width: 1.785, height: 2.015, clearance: 0.22, wheelbase: 2.38, frontTrack: 1.445, rearTrack: 1.445, wheelRadius: 0.37, tyreWidth: 0.215, frontOverhang: 0.68 },
    mass: 1540,
    frontWeightShare: 0.52,
    rearDriveBias: 0.5,
    engine: {
      label: '2.45 UMZ-451M', mass: 170,
      spec: { peakPowerKw: 55, powerPeakRpm: 4000, peakTorqueNm: 167, torquePeakRpm: 2200, redlineRpm: 4300, idleRpm: 600, bsfc: 0.31, brakingCoeff: 0.03, cylinders: 4 },
      rated: { hp: 74 }, ratedTorqueNm: 167, source: 'UAZ-469B catalogue: 75 l.s. at 4000, 17 kgm at 2200',
    },
    gearbox: {
      label: 'UAZ-469 four-speed', mass: 46,
      spec: { ratios: [4.124, 2.641, 1.58, 1.0], reverse: 5.224, finalDrive: 5.125, shiftTime: 0.45, automatic: false, efficiency: 0.85 },
    },
    tankLitres: 78,
    wheelGrip: 0.55,
    brakeDecelG: 0.45,
    steerLock: 0.435,
    dragArea: 2.152,
    handlingProfile: 'utility',
    suspension: S(1.15, 1.25, 0.22, 0.38, 0.16),
    tyre: { construction: 'crossply', aspect: 0.95 },
    target: { top: 110, to100: null, turn: 6.5, source: 'UAZ-469B catalogue; 13 m turning circle' },
  },
  {
    // Land Rover Series III 88 (1971): 2.25 petrol four, 70 hp at 4000 and 120 lb-ft at
    // 1500, all-synchromesh four-speed through a 1.148 high-range transfer to 4.7 axles,
    // 4x4 engaged, leaf springs on beam axles, 1420 kg; about 110 km/h, 11.6 m circle.
    id: 'rs_landrover',
    label: 'Land Rover 88',
    body: 'landrover.glb',
    bodyClass: 'car',
    factory: { length: 3.62, width: 1.68, height: 1.97, clearance: 0.21, wheelbase: 2.235, frontTrack: 1.31, rearTrack: 1.31, wheelRadius: 0.37, tyreWidth: 0.16, frontOverhang: 0.56 },
    mass: 1420,
    frontWeightShare: 0.53,
    rearDriveBias: 0.5,
    engine: {
      label: '2.25 Land Rover petrol four', mass: 175,
      spec: { peakPowerKw: 52, powerPeakRpm: 4000, peakTorqueNm: 163, torquePeakRpm: 1500, redlineRpm: 4400, idleRpm: 600, bsfc: 0.31, brakingCoeff: 0.03, cylinders: 4 },
      rated: { hp: 70 }, ratedTorqueNm: 163, source: 'Land Rover Series III 2.25 petrol: 70 bhp at 4000, 120 lb-ft at 1500',
    },
    gearbox: {
      label: 'Land Rover Series III four-speed', mass: 60,
      spec: { ratios: [3.68, 2.22, 1.5, 1.0], reverse: 4.02, finalDrive: 5.396, shiftTime: 0.5, automatic: false, efficiency: 0.85 },
    },
    tankLitres: 45,
    wheelGrip: 0.55,
    brakeDecelG: 0.45,
    steerLock: 0.459,
    dragArea: 1.6,
    handlingProfile: 'utility',
    suspension: S(1.25, 1.35, 0.2, 0.36, 0.16),
    tyre: { construction: 'crossply', aspect: 0.95 },
    target: { top: 110, to100: null, turn: 5.8, source: 'Land Rover Series III 88 data; 11.6 m turning circle; final drive is 4.7 axle x 1.148 high range' },
  },
  {
    // Jeep CJ-5 (1955-71): F-head Hurricane 2.2 four, 75 hp gross (net about 54 hp, 40 kW)
    // at 4000 and 114 lb-ft gross at 2000, T-90 three-speed through a 1:1 Dana 18 high
    // range to 4.27 axles, 4x4 engaged, leaf springs, 1100 kg; about 100 km/h, 11.4 m circle.
    id: 'rs_jeep',
    label: 'Jeep CJ-5',
    body: 'jeep.glb',
    bodyClass: 'car',
    factory: { length: 3.44, width: 1.74, height: 1.7, clearance: 0.21, wheelbase: 2.057, frontTrack: 1.234, rearTrack: 1.234, wheelRadius: 0.37, tyreWidth: 0.16, frontOverhang: 0.55 },
    mass: 1100,
    frontWeightShare: 0.55,
    rearDriveBias: 0.5,
    engine: {
      label: '2.2 Willys Hurricane four', mass: 150,
      spec: { peakPowerKw: 40, powerPeakRpm: 4000, peakTorqueNm: 136, torquePeakRpm: 2000, redlineRpm: 4400, idleRpm: 600, bsfc: 0.31, brakingCoeff: 0.03, cylinders: 4 },
      rated: { kw: 40 }, ratedTorqueNm: 136, source: 'Willys F4-134 Hurricane: 75 hp gross at 4000, 114 lb-ft gross at 2000; net estimated at 72% power, 88% torque',
    },
    gearbox: {
      label: 'Warner T-90 three-speed', mass: 35,
      spec: { ratios: [2.798, 1.551, 1.0], reverse: 3.798, finalDrive: 4.27, shiftTime: 0.5, automatic: false, efficiency: 0.85 },
    },
    tankLitres: 40,
    wheelGrip: 0.55,
    brakeDecelG: 0.45,
    steerLock: 0.426,
    dragArea: 2.129,
    handlingProfile: 'utility',
    suspension: S(1.35, 1.45, 0.2, 0.36, 0.16),
    tyre: { construction: 'crossply', aspect: 0.95 },
    target: { top: 100, to100: null, turn: 5.7, source: 'Jeep CJ-5 (1955-71) data; 37.5 ft turning circle' },
  },
  {
    // Toyota Land Cruiser BJ40 (1974): 3.0 B diesel, 85 PS at 3600 and 20 kgm at 2200,
    // H41 four-speed through a 1:1 high range to 3.70 axles, 4x4 engaged, leaf springs on
    // beam axles, 1550 kg; about 110 km/h, 10.8 m turning circle.
    id: 'rs_bj40',
    label: 'Toyota Land Cruiser BJ40',
    body: 'bj40.glb',
    bodyClass: 'car',
    factory: { length: 3.87, width: 1.665, height: 1.95, clearance: 0.21, wheelbase: 2.285, frontTrack: 1.404, rearTrack: 1.4, wheelRadius: 0.37, tyreWidth: 0.19, frontOverhang: 0.705 },
    mass: 1550,
    frontWeightShare: 0.55,
    rearDriveBias: 0.5,
    engine: {
      label: '3.0 Toyota B diesel', mass: 250,
      spec: { peakPowerKw: 62.5, powerPeakRpm: 3600, peakTorqueNm: 196, torquePeakRpm: 2200, redlineRpm: 3900, idleRpm: 650, bsfc: 0.25, brakingCoeff: 0.035, cylinders: 4 },
      rated: { ps: 85 }, ratedTorqueNm: 196, source: 'Toyota B diesel (BJ40): 85 PS at 3600, 20 kgm at 2200',
    },
    gearbox: {
      label: 'Toyota H41 four-speed', mass: 55,
      spec: { ratios: [4.925, 2.643, 1.519, 1.0], reverse: 4.925, finalDrive: 3.7, shiftTime: 0.5, automatic: false, efficiency: 0.85 },
    },
    tankLitres: 70,
    wheelGrip: 0.56,
    brakeDecelG: 0.48,
    steerLock: 0.524,
    dragArea: 2.320,
    handlingProfile: 'utility',
    suspension: S(1.25, 1.35, 0.2, 0.36, 0.16),
    tyre: { construction: 'crossply', aspect: 0.95 },
    target: { top: 110, to100: null, turn: 5.4, source: 'Toyota Land Cruiser BJ40 data; 10.8 m turning circle' },
  },
  {
    // Suzuki SJ410 (1982): F10A 970 cc three-cylinder, 45 PS at 5500 and 7.4 kgm at 3000,
    // four-speed through a 1.564 high-range transfer to 4.111 axles, 4x4 engaged, leaf
    // springs, 850 kg; about 110 km/h, 9.8 m turning circle.
    id: 'rs_sj410',
    label: 'Suzuki SJ410',
    body: 'sj410.glb',
    bodyClass: 'car',
    factory: { length: 3.43, width: 1.46, height: 1.68, clearance: 0.21, wheelbase: 2.03, frontTrack: 1.21, rearTrack: 1.22, wheelRadius: 0.35, tyreWidth: 0.16, frontOverhang: 0.557 },
    mass: 850,
    frontWeightShare: 0.54,
    rearDriveBias: 0.5,
    engine: {
      label: '1.0 Suzuki F10A', mass: 80,
      spec: { peakPowerKw: 33, powerPeakRpm: 5500, peakTorqueNm: 73, torquePeakRpm: 3000, redlineRpm: 6000, idleRpm: 800, bsfc: 0.3, brakingCoeff: 0.02, cylinders: 3 },
      rated: { ps: 45 }, ratedTorqueNm: 73, source: 'Suzuki SJ410 data: 45 PS at 5500, 7.4 kgm at 3000',
    },
    gearbox: {
      label: 'Suzuki SJ410 four-speed', mass: 35,
      spec: { ratios: [3.581, 2.022, 1.384, 1.0], reverse: 3.667, finalDrive: 6.43, shiftTime: 0.35, automatic: false, efficiency: 0.85 },
    },
    tankLitres: 40,
    wheelGrip: 0.55,
    brakeDecelG: 0.5,
    steerLock: 0.5,
    dragArea: 1.336,
    handlingProfile: 'utility',
    suspension: S(1.45, 1.55, 0.2, 0.36, 0.15),
    tyre: { construction: 'crossply', aspect: 0.95 },
    target: { top: 110, to100: null, turn: 4.9, source: 'Suzuki SJ410 data; 9.8 m turning circle; final drive is 4.111 axle x 1.564 high range' },
  },
  {
    // Toyota Hilux N40 (1979): 12R 1.6 four, 80 PS JIS gross (net about 68 PS, 50 kW)
    // at 5200 and 12.5 kgm gross at 3000, four-speed on a 4.3 axle, leaf-sprung live
    // axle under an empty bed, 1150 kg; about 135 km/h, 10.6 m turning circle.
    id: 'rs_hilux',
    label: 'Toyota Hilux',
    body: 'hilux.glb',
    bodyClass: 'car',
    factory: { length: 4.305, width: 1.61, height: 1.58, clearance: 0.19, wheelbase: 2.585, frontTrack: 1.3, rearTrack: 1.275, wheelRadius: 0.31, tyreWidth: 0.185, frontOverhang: 0.66 },
    mass: 1150,
    frontWeightShare: 0.58,
    rearDriveBias: 1,
    engine: {
      label: '1.6 Toyota 12R', mass: 140,
      spec: { peakPowerKw: 50, powerPeakRpm: 5200, peakTorqueNm: 110, torquePeakRpm: 3000, redlineRpm: 5800, idleRpm: 700, bsfc: 0.3, brakingCoeff: 0.025, cylinders: 4 },
      rated: { kw: 50 }, ratedTorqueNm: 110, source: 'Toyota 12R: 80 PS JIS gross at 5200, 12.5 kgm at 3000; net estimated at 85% power, 88% torque',
    },
    gearbox: {
      label: 'Toyota four-speed', mass: 36,
      spec: { ratios: [3.789, 2.22, 1.435, 1.0], reverse: 4.316, finalDrive: 4.3, shiftTime: 0.35, automatic: false, efficiency: 0.9 },
    },
    tankLitres: 46,
    wheelGrip: 0.6,
    brakeDecelG: 0.55,
    steerLock: 0.588,
    dragArea: 1.164,
    handlingProfile: 'utility',
    suspension: S(1.15, 1.6, 0.2, 0.34, 0.12),
    tyre: { construction: 'radial', aspect: 0.82 },
    target: { top: 135, to100: null, turn: 5.3, source: 'Toyota Hilux N40 data; 10.6 m turning circle' },
  },
  {
    // Fiat Panda 4x4 (1983): 965 cc four, 48 PS at 5600 and 7.1 kgm at 3500, five-speed
    // with a crawler first through the Steyr-Puch part-time rear drive (engaged), leaf-
    // sprung rear axle, 740 kg; 135 km/h, 9.6 m turning circle. The final drive is chosen
    // to meet the published top speed at peak power in fifth.
    id: 'rs_panda4x4',
    label: 'Fiat Panda 4x4',
    body: 'panda4x4.glb',
    bodyClass: 'car',
    factory: { length: 3.39, width: 1.485, height: 1.461, clearance: 0.18, wheelbase: 2.17, frontTrack: 1.254, rearTrack: 1.258, wheelRadius: 0.29, tyreWidth: 0.145, frontOverhang: 0.585 },
    mass: 740,
    frontWeightShare: 0.58,
    rearDriveBias: 0.5,
    engine: {
      label: '1.0 Fiat 100 four', mass: 80,
      spec: { peakPowerKw: 35, powerPeakRpm: 5600, peakTorqueNm: 70, torquePeakRpm: 3500, redlineRpm: 6200, idleRpm: 800, bsfc: 0.29, brakingCoeff: 0.02, cylinders: 4 },
      rated: { ps: 48 }, ratedTorqueNm: 70, source: 'Fiat Panda 4x4 (1983) data: 48 CV DIN at 5600, 7.1 kgm at 3500',
    },
    gearbox: {
      label: 'Panda 4x4 five-speed', mass: 30,
      spec: { ratios: [3.91, 2.055, 1.348, 0.963, 0.766], reverse: 3.62, finalDrive: 5.9, shiftTime: 0.3, automatic: false, efficiency: 0.87 },
    },
    tankLitres: 35,
    wheelGrip: 0.6,
    brakeDecelG: 0.6,
    steerLock: 0.554,
    dragArea: 0.804,
    handlingProfile: 'utility',
    suspension: S(1.35, 1.5, 0.22, 0.36, 0.12),
    tyre: { construction: 'radial', aspect: 0.82 },
    target: { top: 135, to100: null, turn: 4.8, source: 'Fiat Panda 4x4 (1983) data; 9.6 m turning circle' },
  },
  {
    // Trabant 601 (1964-90): P65 594 cc two-stroke twin, 26 PS at 4200 and 5.5 kgm at 3000,
    // four-speed on a 4.33 final drive, front drive, transverse leaf springs, 615 kg;
    // 107 km/h, 10 m turning circle.
    id: 'rs_trabant',
    label: 'Trabant 601',
    body: 'trabant.glb',
    bodyClass: 'car',
    factory: { length: 3.555, width: 1.504, height: 1.437, clearance: 0.15, wheelbase: 2.02, frontTrack: 1.206, rearTrack: 1.255, wheelRadius: 0.28, tyreWidth: 0.145, frontOverhang: 0.6 },
    mass: 615,
    frontWeightShare: 0.6,
    rearDriveBias: 0,
    engine: {
      label: '0.6 Trabant P65 two-stroke', mass: 45,
      spec: { peakPowerKw: 19, powerPeakRpm: 4200, peakTorqueNm: 54, torquePeakRpm: 3000, redlineRpm: 4800, idleRpm: 900, bsfc: 0.38, brakingCoeff: 0.012, cylinders: 2 },
      rated: { ps: 26 }, ratedTorqueNm: 54, source: 'Trabant 601 data: 26 PS at 4200, 5.5 kgm at 3000',
    },
    gearbox: {
      label: 'Trabant four-speed', mass: 25,
      spec: { ratios: [4.08, 2.32, 1.52, 1.03], reverse: 3.83, finalDrive: 4.33, shiftTime: 0.4, automatic: false, efficiency: 0.9 },
    },
    tankLitres: 26,
    wheelGrip: 0.62,
    brakeDecelG: 0.55,
    steerLock: 0.469,
    dragArea: 0.846,
    handlingProfile: 'road',
    suspension: S(1.25, 1.35, 0.22, 0.36, 0.1),
    tyre: { construction: 'radial', aspect: 0.82 },
    target: { top: 107, to100: null, turn: 5.0, source: 'Trabant 601 data; 10 m turning circle' },
  },
  {
    // Wartburg 353 (1966): 992 cc two-stroke triple, 50 PS at 4250 and 10 kgm at 3000,
    // four-speed on a 4.22 final drive (fourth chosen to meet the published top speed), front drive, coil-sprung independent all round,
    // 900 kg; 130 km/h, 10.5 m turning circle.
    id: 'rs_wartburg',
    label: 'Wartburg 353',
    body: 'wartburg.glb',
    bodyClass: 'car',
    factory: { length: 4.22, width: 1.64, height: 1.4, clearance: 0.155, wheelbase: 2.45, frontTrack: 1.26, rearTrack: 1.29, wheelRadius: 0.29, tyreWidth: 0.165, frontOverhang: 0.79 },
    mass: 900,
    frontWeightShare: 0.58,
    rearDriveBias: 0,
    engine: {
      label: '1.0 Wartburg two-stroke triple', mass: 70,
      spec: { peakPowerKw: 36.8, powerPeakRpm: 4250, peakTorqueNm: 98, torquePeakRpm: 3000, redlineRpm: 4800, idleRpm: 800, bsfc: 0.37, brakingCoeff: 0.012, cylinders: 3 },
      rated: { ps: 50 }, ratedTorqueNm: 98, source: 'Wartburg 353 data: 50 PS at 4250, 10 kgm at 3000',
    },
    gearbox: {
      label: 'Wartburg four-speed', mass: 30,
      spec: { ratios: [3.77, 2.16, 1.35, 0.86], reverse: 3.27, finalDrive: 4.22, shiftTime: 0.4, automatic: false, efficiency: 0.9 },
    },
    tankLitres: 44,
    wheelGrip: 0.64,
    brakeDecelG: 0.6,
    steerLock: 0.539,
    dragArea: 0.936,
    handlingProfile: 'road',
    suspension: S(1.15, 1.25, 0.22, 0.36, 0.1),
    tyre: { construction: 'radial', aspect: 0.82 },
    target: { top: 130, to100: null, turn: 5.25, source: 'Wartburg 353 data; 10.5 m turning circle' },
  },
  {
    // Peugeot 504 GL (1971): XN1 2.0 four, 93 PS DIN at 5600 and 16.7 kgm at 3000, BA7
    // four-speed on a 3.89 axle, semi-trailing-arm rear, 1220 kg; 163 km/h, 10.5 m circle.
    id: 'rs_p504',
    label: 'Peugeot 504',
    body: 'p504.glb',
    bodyClass: 'car',
    factory: { length: 4.49, width: 1.69, height: 1.46, clearance: 0.16, wheelbase: 2.74, frontTrack: 1.42, rearTrack: 1.34, wheelRadius: 0.31, tyreWidth: 0.175, frontOverhang: 0.68 },
    mass: 1220,
    frontWeightShare: 0.54,
    rearDriveBias: 1,
    engine: {
      label: '2.0 Peugeot XN1', mass: 140,
      spec: { peakPowerKw: 68.4, powerPeakRpm: 5600, peakTorqueNm: 164, torquePeakRpm: 3000, redlineRpm: 6000, idleRpm: 800, bsfc: 0.28, brakingCoeff: 0.03, cylinders: 4 },
      rated: { ps: 93 }, ratedTorqueNm: 164, source: 'Peugeot 504 GL (1971): 93 PS DIN at 5600, 16.7 kgm at 3000',
    },
    gearbox: {
      label: 'Peugeot BA7 four-speed', mass: 38,
      spec: { ratios: [3.61, 2.08, 1.36, 1.0], reverse: 3.7, finalDrive: 3.89, shiftTime: 0.35, automatic: false, efficiency: 0.91 },
    },
    tankLitres: 56,
    wheelGrip: 0.7,
    brakeDecelG: 0.72,
    steerLock: 0.622,
    dragArea: 0.934,
    handlingProfile: 'road',
    suspension: S(1.1, 1.25, 0.24, 0.4, 0.1),
    tyre: { construction: 'radial', aspect: 0.82 },
    target: { top: 163, to100: null, turn: 5.25, source: 'Peugeot 504 GL data; 10.5 m turning circle' },
  },
  {
    // Alfa Romeo Giulia Super (1965): 1.6 twin-cam, 98 PS DIN at 5500 and 14 kgm at 2900,
    // five-speed on a 4.56 axle, coil-sprung live axle on a T-bar, 1000 kg; 175 km/h,
    // 11 m turning circle.
    id: 'rs_giulia',
    label: 'Alfa Romeo Giulia',
    body: 'giulia.glb',
    bodyClass: 'car',
    factory: { length: 4.14, width: 1.56, height: 1.43, clearance: 0.15, wheelbase: 2.51, frontTrack: 1.31, rearTrack: 1.27, wheelRadius: 0.3, tyreWidth: 0.155, frontOverhang: 0.655 },
    mass: 1000,
    frontWeightShare: 0.53,
    rearDriveBias: 1,
    engine: {
      label: '1.6 Alfa Romeo twin-cam', mass: 120,
      spec: { peakPowerKw: 72, powerPeakRpm: 5500, peakTorqueNm: 137, torquePeakRpm: 2900, redlineRpm: 6500, idleRpm: 850, bsfc: 0.29, brakingCoeff: 0.025, cylinders: 4 },
      rated: { ps: 98 }, ratedTorqueNm: 137, source: 'Alfa Romeo Giulia Super (1965): 98 CV DIN at 5500, 14 kgm at 2900',
    },
    gearbox: {
      label: 'Alfa Romeo five-speed', mass: 34,
      spec: { ratios: [3.3, 1.99, 1.35, 1.0, 0.79], reverse: 3.01, finalDrive: 4.56, shiftTime: 0.28, automatic: false, efficiency: 0.92 },
    },
    tankLitres: 46,
    wheelGrip: 0.74,
    brakeDecelG: 0.8,
    steerLock: 0.520,
    dragArea: 0.800,
    handlingProfile: 'sport',
    suspension: S(1.25, 1.4, 0.26, 0.42, 0.09),
    tyre: { construction: 'radial', aspect: 0.82 },
    antiRoll: { front: 0.45, rear: 0.2 },
    target: { top: 175, to100: null, turn: 5.5, source: 'Alfa Romeo Giulia Super (1965) data; 11 m turning circle' },
  },
  {
    // Subaru Leone 1600 4WD estate (1975): EA71 1.6 flat-four, 72 PS at 5600 and 11.4 kgm
    // at 3600, four-speed on a 3.889 final drive, part-time rear drive engaged, 1000 kg;
    // 145 km/h, 9.6 m turning circle.
    id: 'rs_leone',
    label: 'Subaru Leone 4WD',
    body: 'leone.glb',
    bodyClass: 'car',
    factory: { length: 3.995, width: 1.5, height: 1.46, clearance: 0.21, wheelbase: 2.455, frontTrack: 1.3, rearTrack: 1.28, wheelRadius: 0.29, tyreWidth: 0.155, frontOverhang: 0.75 },
    mass: 1000,
    frontWeightShare: 0.6,
    rearDriveBias: 0.5,
    engine: {
      label: '1.6 Subaru EA71 flat-four', mass: 95,
      spec: { peakPowerKw: 53, powerPeakRpm: 5600, peakTorqueNm: 112, torquePeakRpm: 3600, redlineRpm: 6200, idleRpm: 800, bsfc: 0.29, brakingCoeff: 0.022, cylinders: 4 },
      rated: { ps: 72 }, ratedTorqueNm: 112, source: 'Subaru Leone 1600 4WD (1975): 72 PS at 5600, 11.4 kgm at 3600',
    },
    gearbox: {
      label: 'Subaru four-speed transaxle', mass: 40,
      spec: { ratios: [3.666, 2.157, 1.379, 0.971], reverse: 3.583, finalDrive: 3.889, shiftTime: 0.3, automatic: false, efficiency: 0.87 },
    },
    tankLitres: 50,
    wheelGrip: 0.62,
    brakeDecelG: 0.62,
    steerLock: 0.624,
    dragArea: 0.977,
    handlingProfile: 'utility',
    suspension: S(1.25, 1.35, 0.22, 0.38, 0.11),
    tyre: { construction: 'radial', aspect: 0.82 },
    target: { top: 145, to100: null, turn: 4.8, source: 'Subaru Leone 1600 4WD (1975) data; 9.6 m turning circle' },
  },
  {
    // Plymouth Valiant (1964): 170 cu in Slant Six, 101 hp gross (net about 73 hp, 54 kW)
    // at 4400 and 155 lb-ft gross at 2400, three-speed on a 3.23 axle, leaf-sprung live
    // axle, torsion bars in front, 1250 kg; about 150 km/h, 11.9 m turning circle.
    id: 'rs_valiant',
    label: 'Plymouth Valiant',
    body: 'valiant.glb',
    bodyClass: 'car',
    factory: { length: 4.628, width: 1.78, height: 1.355, clearance: 0.15, wheelbase: 2.705, frontTrack: 1.42, rearTrack: 1.41, wheelRadius: 0.3, tyreWidth: 0.165, frontOverhang: 0.86 },
    mass: 1250,
    frontWeightShare: 0.55,
    rearDriveBias: 1,
    engine: {
      label: '2.8 Chrysler Slant Six', mass: 190,
      spec: { peakPowerKw: 54, powerPeakRpm: 4400, peakTorqueNm: 185, torquePeakRpm: 2400, redlineRpm: 4800, idleRpm: 600, bsfc: 0.3, brakingCoeff: 0.03, cylinders: 6 },
      rated: { kw: 54 }, ratedTorqueNm: 185, source: 'Chrysler 170 Slant Six (1964): 101 hp gross at 4400, 155 lb-ft gross at 2400; net estimated at 72% power, 88% torque',
    },
    gearbox: {
      label: 'Chrysler three-speed', mass: 35,
      spec: { ratios: [2.95, 1.83, 1.0], reverse: 3.8, finalDrive: 3.23, shiftTime: 0.45, automatic: false, efficiency: 0.9 },
    },
    tankLitres: 49,
    wheelGrip: 0.6,
    brakeDecelG: 0.55,
    steerLock: 0.540,
    dragArea: 0.903,
    handlingProfile: 'classic',
    suspension: S(1.0, 1.15, 0.2, 0.32, 0.1),
    tyre: { construction: 'crossply', aspect: 0.9 },
    target: { top: 150, to100: null, turn: 5.95, source: 'Plymouth Valiant (1964) data; 11.9 m turning circle' },
  },
  {
    // AMC Eagle wagon (1981): 258 cu in (4.2) six, 110 hp at 3200 and 210 lb-ft at 1800
    // (net), Torque-Command three-speed automatic on a 2.35 axle, full-time four-wheel
    // drive through a viscous centre, 1500 kg; about 143 km/h (89 mph), 11.7 m turning circle.
    id: 'rs_eagle',
    label: 'AMC Eagle',
    body: 'eagle.glb',
    bodyClass: 'car',
    factory: { length: 4.74, width: 1.83, height: 1.405, clearance: 0.19, wheelbase: 2.776, frontTrack: 1.5, rearTrack: 1.46, wheelRadius: 0.34, tyreWidth: 0.195, frontOverhang: 0.82 },
    mass: 1500,
    frontWeightShare: 0.56,
    rearDriveBias: 0.5,
    engine: {
      label: '4.2 AMC 258 six', mass: 230,
      spec: { peakPowerKw: 82, powerPeakRpm: 3200, peakTorqueNm: 285, torquePeakRpm: 1800, redlineRpm: 4200, idleRpm: 600, bsfc: 0.3, brakingCoeff: 0.04, cylinders: 6 },
      rated: { hp: 110 }, ratedTorqueNm: 285, source: 'AMC 258 (1981 Eagle): 110 hp net at 3200, 210 lb-ft at 1800',
    },
    gearbox: {
      label: 'Chrysler TorqueFlite (Torque-Command) three-speed', mass: 70,
      spec: { ratios: [2.45, 1.45, 1.0], reverse: 2.2, finalDrive: 2.35, shiftTime: 0.5, automatic: true, efficiency: 0.84 },
    },
    tankLitres: 79,
    wheelGrip: 0.62,
    brakeDecelG: 0.6,
    steerLock: 0.565,
    dragArea: 1.420,
    handlingProfile: 'classic',
    suspension: S(1.05, 1.2, 0.22, 0.36, 0.12),
    tyre: { construction: 'radial', aspect: 0.75 },
    target: { top: 143, to100: null, turn: 5.85, source: 'AMC Eagle wagon (1981) data; 89 mph road-test top speed; 11.7 m turning circle' },
  },
  {
    // Ford Mustang GT 5.0 (1988): 302 HO V8, 225 hp at 4200 and 300 lb-ft at 3200 (net),
    // Borg-Warner T-5 five-speed on a 2.73 Traction-Lok axle, quadra-shock live axle,
    // 1400 kg; 220 km/h, 0-100 in 6.6 s, 11.9 m turning circle.
    id: 'rs_foxgt',
    label: 'Ford Mustang GT 5.0',
    body: 'foxgt.glb',
    bodyClass: 'car',
    factory: { length: 4.562, width: 1.756, height: 1.321, clearance: 0.13, wheelbase: 2.553, frontTrack: 1.448, rearTrack: 1.448, wheelRadius: 0.32, tyreWidth: 0.225, frontOverhang: 0.95 },
    mass: 1400,
    frontWeightShare: 0.57,
    rearDriveBias: 1,
    engine: {
      label: '5.0 Ford 302 HO V8', mass: 210,
      spec: { peakPowerKw: 168, powerPeakRpm: 4200, peakTorqueNm: 407, torquePeakRpm: 3200, redlineRpm: 5000, idleRpm: 650, bsfc: 0.3, brakingCoeff: 0.075, cylinders: 8 },
      rated: { hp: 225 }, ratedTorqueNm: 407, source: 'Ford 5.0 HO (1987-92): 225 hp net at 4200, 300 lb-ft at 3200',
    },
    gearbox: {
      label: 'Borg-Warner T-5 five-speed', mass: 36,
      spec: { ratios: [3.35, 1.93, 1.29, 1.0, 0.68], reverse: 3.15, finalDrive: 2.73, shiftTime: 0.3, automatic: false, efficiency: 0.9 },
    },
    tankLitres: 58,
    wheelGrip: 0.82,
    brakeDecelG: 0.85,
    steerLock: 0.506,
    dragArea: 0.821,
    handlingProfile: 'sport',
    suspension: S(1.3, 1.45, 0.28, 0.45, 0.08),
    tyre: { construction: 'radial', aspect: 0.6 },
    antiRoll: { front: 0.55, rear: 0.25 },
    rearDiff: { lock: 0.45, preloadNm: 40 },
    target: { top: 220, to100: 6.6, turn: 5.95, source: 'Ford Mustang GT 5.0 (1988) road tests; 39 ft turning circle' },
  },
  {
    // Chevrolet C10 (1970): 307 cu in V8, 200 hp gross (net about 145 hp, 108 kW) at 4600
    // and 300 lb-ft gross at 2400, three-speed column shift on a 3.73 axle, coil-sprung
    // trailing-arm rear on the half-ton, empty long bed, 1700 kg; about 155 km/h, 14.6 m
    // turning circle.
    id: 'rs_c10',
    label: 'Chevrolet C10',
    body: 'c10.glb',
    bodyClass: 'car',
    factory: { length: 4.994, width: 1.999, height: 1.77, clearance: 0.2, wheelbase: 3.226, frontTrack: 1.626, rearTrack: 1.6, wheelRadius: 0.36, tyreWidth: 0.2, frontOverhang: 0.73 },
    mass: 1700,
    frontWeightShare: 0.58,
    rearDriveBias: 1,
    engine: {
      label: '5.0 Chevrolet 307 V8', mass: 250,
      spec: { peakPowerKw: 108, powerPeakRpm: 4600, peakTorqueNm: 358, torquePeakRpm: 2400, redlineRpm: 5000, idleRpm: 600, bsfc: 0.36, brakingCoeff: 0.075, cylinders: 8 },
      rated: { kw: 108 }, ratedTorqueNm: 358, source: 'Chevrolet 307 (1970): 200 hp gross at 4600, 300 lb-ft gross at 2400; net estimated at 72% power, 88% torque',
    },
    gearbox: {
      label: 'Saginaw three-speed', mass: 38,
      spec: { ratios: [2.85, 1.68, 1.0], reverse: 2.95, finalDrive: 3.73, shiftTime: 0.5, automatic: false, efficiency: 0.9 },
    },
    tankLitres: 76,
    wheelGrip: 0.6,
    brakeDecelG: 0.55,
    steerLock: 0.521,
    dragArea: 1.720,
    handlingProfile: 'utility',
    suspension: S(1.0, 1.4, 0.2, 0.34, 0.12),
    tyre: { construction: 'crossply', aspect: 0.85 },
    target: { top: 155, to100: null, turn: 7.3, source: 'Chevrolet C10 long bed (1970) data; 48 ft turning circle' },
  },
  {
    // Volkswagen T2 Kombi 1600 (1971): Type 1 1.6 air-cooled flat-four behind the rear
    // axle, 50 PS DIN at 4000 and 10.8 kgm at 2800, four-speed transaxle on a 5.375 overall
    // final drive (4.125 with 1.26 reduction hubs), 1175 kg; 105 km/h, 12.3 m circle.
    id: 'rs_t2',
    label: 'Volkswagen T2',
    body: 't2.glb',
    bodyClass: 'car',
    factory: { length: 4.505, width: 1.72, height: 1.95, clearance: 0.185, wheelbase: 2.4, frontTrack: 1.384, rearTrack: 1.425, wheelRadius: 0.33, tyreWidth: 0.185, frontOverhang: 1.13 },
    mass: 1175,
    frontWeightShare: 0.44,
    rearDriveBias: 1,
    engine: {
      label: '1.6 VW Type 1 flat-four', mass: 115,
      spec: { peakPowerKw: 36.8, powerPeakRpm: 4000, peakTorqueNm: 106, torquePeakRpm: 2800, redlineRpm: 4600, idleRpm: 850, bsfc: 0.3, brakingCoeff: 0.02, cylinders: 4 },
      rated: { ps: 50 }, ratedTorqueNm: 106, source: 'VW T2 1600 (1971): 50 PS DIN at 4000, 10.8 kgm at 2800',
    },
    gearbox: {
      label: 'VW Type 2 four-speed transaxle', mass: 40,
      spec: { ratios: [3.8, 2.06, 1.26, 0.82], reverse: 3.61, finalDrive: 5.375, shiftTime: 0.45, automatic: false, efficiency: 0.88 },
    },
    tankLitres: 56,
    wheelGrip: 0.6,
    brakeDecelG: 0.55,
    steerLock: 0.465,
    dragArea: 1.741,
    handlingProfile: 'utility',
    suspension: S(1.1, 1.2, 0.22, 0.36, 0.12),
    tyre: { construction: 'radial', aspect: 0.82 },
    target: { top: 105, to100: null, turn: 6.15, source: 'VW T2 1600 (1971) data; 12.3 m turning circle' },
  },
];

export function rosterEngineId(car: RosterCar): string {
  return typeof car.engine === 'string' ? car.engine : `rs_${car.id.slice(3)}_engine`;
}

export function rosterGearboxId(car: RosterCar): string {
  return typeof car.gearbox === 'string' ? car.gearbox : `rs_${car.id.slice(3)}_gearbox`;
}
