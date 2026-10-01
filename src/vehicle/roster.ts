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
  {
    // Moskvich-412 (1967): UZAM-412 1.48 four, 75 hp at 5800 and 11.5 kgm at 3800,
    // four-speed on a 4.22 axle, leaf-sprung rear, 1045 kg; 140 km/h, 0-100 in 19 s.
    id: 'rs_moskvich412',
    label: 'Moskvich-412',
    body: 'moskvich412.glb',
    bodyClass: 'car',
    factory: { length: 4.25, width: 1.55, height: 1.48, clearance: 0.175, wheelbase: 2.4, frontTrack: 1.27, rearTrack: 1.27, wheelRadius: 0.29, tyreWidth: 0.165, frontOverhang: 0.68 },
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
    factory: { length: 3.506, width: 1.525, height: 1.33, clearance: 0.12, wheelbase: 2.434, frontTrack: 1.29, rearTrack: 1.27, wheelRadius: 0.275, tyreWidth: 0.155, frontOverhang: 0.55 },
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
];

export function rosterEngineId(car: RosterCar): string {
  return typeof car.engine === 'string' ? car.engine : `rs_${car.id.slice(3)}_engine`;
}

export function rosterGearboxId(car: RosterCar): string {
  return typeof car.gearbox === 'string' ? car.gearbox : `rs_${car.id.slice(3)}_gearbox`;
}
