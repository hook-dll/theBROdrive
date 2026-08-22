/**
 * The car catalogue: complete, authored 3D models.
 *
 * The old concept built a car out of parts and generated its shell procedurally.
 * That is gone. A car is now ONE finished model (Kenney Car Kit, CC0 — see
 * public/models/kenney-car-kit/LICENSE.txt) whose geometry is authoritative:
 *
 *  - the chassis collider comes from the model's `body` bounding box,
 *  - the four suspension mounts come from the model's `wheel-*` node positions,
 *  - each wheel's radius comes from that wheel node's own bounds,
 *
 * all measured at load time in render/carmodel.ts. Nothing in this file repeats a
 * dimension the artist already committed to in the GLB; what lives here is only
 * what geometry cannot say: mass, drivetrain, springs and how far the thing steers.
 *
 * Parts still exist, but only as *gizmos*: cosmetic things found in the world and
 * bolted onto anchor points (see `gizmoAnchors` and the anchor derivation in
 * render/carmodel.ts). They never make a car drivable — a complete model already is.
 */

import type { BodyClass, EngineSpec, GearboxSpec, SuspensionTuning } from '../parts/registry';
import { variant } from '../parts/registry';

/**
 * Vendored packs, all free and credited in a LICENSE file beside their models.
 *
 *  - KENNEY: Kenney Car Kit, CC0. Stylised, own wheels, one colormap atlas.
 *  - QUATERNIUS: Quaternius Realistic Car Pack, CC0. Real-world metres, own
 *    wheels, flat per-material colours (converted from OBJ by tools/obj-to-glb.mjs).
 */
const KIT = '/models/kenney-car-kit';
const QUATERNIUS = '/models/quaternius-cars';
const PSX = '/models/psx-cars';
const DEJUNES = '/models/dejunes';

/**
 * Model units to metres.
 *
 * The kit is stylised-stubby: its sedan is 2.55 long on a 1.5 m width, where a real
 * saloon is 4.4 on 1.8. Scaling by *length* would give 2.6 m wide cartoons on 0.5 m
 * wheels, so the kit is scaled by width instead: 1.2 puts the track, the body width
 * and the wheels (0.36 m radius) on real-car numbers and leaves the cars short,
 * which is the kit's own proportion and reads as deliberate.
 */
const CAR_SCALE = 1.2;
const TRUCK_SCALE = 1.3;
const KART_SCALE = 1.05;

/* ---- suspension presets ----
 *
 * Rates are per kilogram of chassis mass (see Vehicle), so the same numbers suit a
 * kart and a firetruck. `restLength` is a geometric offset, not a ride-height knob:
 * Vehicle derives the mount from the body box and the static sag (see the ride
 * height rule there), so changing a rate changes how the car MOVES, not how high it
 * stands.
 *
 * Two things bound how soft these can be:
 *  - static sag is `g / (4 * stiffness)`, so 15 sagged 164 mm — most of a car's
 *    whole travel — and the body wallowed onto its bump stops under load;
 *  - `maxTravel` is also DROOP, and a wheel is drawn at its full droop the moment
 *    it unloads. With 200 mm of it, lifting the front under acceleration dropped
 *    the front wheels through the road surface. That is the artefact behind
 *    "wheels get under road a bit on accelerating".
 * Hence firmer rates and shorter travel: ~100 mm of sag on a car and 120 mm of
 * droop, which still soaks up the desert without letting a wheel leave the arch.
 */

const SUSP_CAR: SuspensionTuning = {
  restLength: 0.3,
  maxTravel: 0.12,
  stiffness: 24,
  compression: 0.9,
  relaxation: 1.2,
  maxForce: 26000,
};

const SUSP_SPORT: SuspensionTuning = {
  restLength: 0.24,
  maxTravel: 0.1,
  stiffness: 32,
  compression: 1.0,
  relaxation: 1.35,
  maxForce: 30000,
};

const SUSP_TRUCK: SuspensionTuning = {
  restLength: 0.36,
  maxTravel: 0.16,
  stiffness: 20,
  compression: 0.85,
  relaxation: 1.15,
  maxForce: 42000,
};

const SUSP_KART: SuspensionTuning = {
  restLength: 0.14,
  maxTravel: 0.07,
  stiffness: 38,
  compression: 1.1,
  relaxation: 1.4,
  maxForce: 12000,
};

/**
 * A mount point for a gizmo, in model space (metres, origin on the ground between
 * the wheels — the GLB's own origin). Positions are fractions of the measured body
 * box rather than absolutes, so one table serves a kart and a firetruck; the
 * fractions are resolved against real bounds in render/carmodel.ts.
 */
export interface GizmoAnchorDef {
  readonly id: string;
  readonly label: string;
  /** [x, y, z] as fractions: x of half-width, y of body height, z of half-length. */
  readonly frac: readonly [number, number, number];
  readonly yaw?: number;
}

/** Anchors every road vehicle has. Roof, both deck ends, both flanks. */
const ROAD_ANCHORS: readonly GizmoAnchorDef[] = [
  { id: 'gizmo_roof', label: 'roof', frac: [0, 1, 0.05] },
  { id: 'gizmo_nose', label: 'bonnet', frac: [0, 0.62, 0.72] },
  { id: 'gizmo_tail', label: 'tail', frac: [0, 0.62, -0.82] },
  { id: 'gizmo_flank_l', label: 'left flank', frac: [0.95, 0.45, -0.1], yaw: Math.PI / 2 },
  { id: 'gizmo_flank_r', label: 'right flank', frac: [-0.95, 0.45, -0.1], yaw: -Math.PI / 2 },
];

/** Open-bed vehicles get a load area instead of a tail shelf. */
const BED_ANCHORS: readonly GizmoAnchorDef[] = [
  { id: 'gizmo_roof', label: 'cab roof', frac: [0, 1, 0.35] },
  { id: 'gizmo_nose', label: 'bonnet', frac: [0, 0.62, 0.82] },
  { id: 'gizmo_bed_f', label: 'front of bed', frac: [0, 0.5, -0.25] },
  { id: 'gizmo_bed_r', label: 'rear of bed', frac: [0, 0.5, -0.7] },
  { id: 'gizmo_flank_l', label: 'left flank', frac: [0.95, 0.45, -0.1], yaw: Math.PI / 2 },
  { id: 'gizmo_flank_r', label: 'right flank', frac: [-0.95, 0.45, -0.1], yaw: -Math.PI / 2 },
];

export interface CarModelDef {
  /** Stable id; appears in save files. */
  readonly id: string;
  readonly label: string;
  /** Model URL (.glb or .fbx), served from public/. */
  readonly file: string;
  /**
   * Base-colour texture URL, when the pack ships liveries separately from the
   * geometry. Several catalogue entries can then share one model file.
   */
  readonly textureFile?: string;
  /**
   * Set when the model has no wheels of its own: the wheels come from `file` below
   * and are mounted at fractions of the measured body box (see
   * render/carmodel.ts). Packs that ship one wheel and many bodies need this —
   * nothing in such a body says where its axles are.
   */
  readonly separateWheels?: {
    /** Wheel model URL, shared between every car that uses it. */
    readonly file: string;
    /** Front axle line, as a fraction of half-length (+Z is forward). */
    readonly frontZFrac: number;
    /** Rear axle line, as a fraction of half-length. */
    readonly rearZFrac: number;
    /** Wheel centre, as a fraction of half-width. */
    readonly trackFrac: number;
    /** Multiplies the wheel's measured size, for packs drawn at another scale. */
    readonly radiusScale?: number;
  };
  /**
   * Set when the model carries its own wheels but under the modeller's names
   * (`Wheel_1`, `Cylinder006`, ...). The loader then finds the four discs by shape
   * and renames them, instead of borrowing a wheel from another file.
   */
  readonly detectWheels?: boolean;
  readonly bodyClass: BodyClass;
  /** Uniform model-units-to-metres scale. */
  readonly scale: number;
  /** Kerb mass, kg. Complete vehicle — there are no parts left to add to it. */
  readonly mass: number;
  /** Engine and gearbox, by part-variant id, so the specs live in one table. */
  readonly engineId: string;
  readonly gearboxId: string;
  readonly tankLitres: number;
  /** Tyre grip multiplier on the surface's friction. */
  readonly wheelGrip: number;
  readonly suspension: SuspensionTuning;
  /** Steering lock at the front axle, radians. */
  readonly steerLock: number;
  /** Fraction of drive torque to the rear axle. 1 = RWD, 0 = FWD, 0.5 = 4WD. */
  readonly rearDriveBias: number;
  /**
   * In-car camera, as fractions of the measured body box: x of half-width, y of
   * body height (0 = floor, 1 = roof), z of half-length. Resolved in
   * render/carmodel.ts.
   */
  readonly viewFrac: readonly [number, number, number];
  readonly gizmoAnchors: readonly GizmoAnchorDef[];
}

/** Shared defaults; every entry below states only what makes it itself. */
type Entry = Omit<CarModelDef, 'file' | 'scale' | 'suspension' | 'viewFrac' | 'gizmoAnchors'> & {
  /** Model file name within the pack directory named by `dir`. */
  readonly glb?: string;
  /** Pack directory; defaults to the Kenney kit. */
  readonly dir?: string;
  /**
   * Id of a car built in code (render/proceduralcars.ts) instead of loaded. Set
   * this OR `glb`, never both.
   */
  readonly procedural?: string;
  readonly scale?: number;
  readonly suspension?: SuspensionTuning;
  readonly viewFrac?: readonly [number, number, number];
  readonly gizmoAnchors?: readonly GizmoAnchorDef[];
};

/**
 * The in-car view is a HOOD camera: it rides on the very nose of the car, above and
 * just behind the front edge, looking forward.
 *
 * A true driver's-seat eye does not work with these models. Their windows are
 * painted geometry rather than glass, so from inside the cabin the shell is an
 * opaque box; the only way to see out was to hide the whole body, which left the
 * player floating with no car around them.
 *
 * The z fraction has to be near 1 (the front face of the body box), not halfway. At
 * 0.62 the eye still sits over the *engine bay* of a long-nosed body and the
 * bonnet's own bulge fills the frame — measured on screen with the Quaternius
 * saloon, whose 4.2 m body puts 0.62 of half-length a full metre behind its nose.
 */
const VIEW_CAR: readonly [number, number, number] = [0, 0.78, 0.96];
/** A cab-forward truck has almost no bonnet: sit high, right at the front face. */
const VIEW_CAB: readonly [number, number, number] = [0, 0.9, 0.96];
/** A kart is an open shell; the camera rides just over its nose cone. */
const VIEW_KART: readonly [number, number, number] = [0, 0.9, 0.9];

/**
 * Axle placement for the body-only packs, as fractions of the measured body box.
 *
 * These are the numbers no file contains: a body modelled without wheels says
 * nothing about where its axles are, so the arches have to be matched by eye.
 * Front and rear are deliberately asymmetric — a road car's rear axle sits closer
 * to its tail than its front axle does to its nose.
 */
const PSX_AXLES = { frontZFrac: 0.6, rearZFrac: -0.66, trackFrac: 0.78 } as const;

/**
 * The PSX pack is modelled about 1.4x life size (its saloon is 6.15 long), so each
 * body is scaled to a believable length; the shared wheel comes down with it.
 */
interface PsxSpec {
  readonly id: string;
  readonly label: string;
  readonly glb: string;
  readonly scale: number;
  readonly mass: number;
  readonly engineId: string;
  readonly gearboxId: string;
  readonly tankLitres: number;
  readonly bodyClass?: BodyClass;
  readonly suspension?: SuspensionTuning;
  readonly rearDriveBias?: number;
  /** Extra liveries: label suffix -> texture file, all sharing this body. */
  readonly liveries?: readonly (readonly [string, string])[];
}

const PSX_SPECS: readonly PsxSpec[] = [
  {
    id: 'psx_saloon',
    label: 'PSX saloon',
    glb: 'Car.glb',
    scale: 0.72,
    mass: 1240,
    engineId: 'engine_i4_1600',
    gearboxId: 'gearbox_manual5',
    tankLitres: 55,
    liveries: [
      ['blue', 'car_blue.png'],
      ['grey', 'car_gray.png'],
      ['red', 'car_red.png'],
    ],
  },
  {
    id: 'psx_coupe',
    label: 'PSX coupe',
    glb: 'Car2.glb',
    scale: 0.68,
    mass: 1180,
    engineId: 'engine_i6_2800',
    gearboxId: 'gearbox_manual5',
    tankLitres: 60,
    suspension: SUSP_SPORT,
    rearDriveBias: 1,
    liveries: [
      ['black', 'car2_black.png'],
      ['red', 'car2_red.png'],
    ],
  },
  {
    id: 'psx_hatch',
    label: 'PSX hatchback',
    glb: 'Car3.glb',
    scale: 0.78,
    mass: 980,
    engineId: 'engine_i4_1600',
    gearboxId: 'gearbox_manual5',
    tankLitres: 45,
    liveries: [
      ['red', 'car3_red.png'],
      ['yellow', 'car3_yellow.png'],
    ],
  },
  {
    id: 'psx_wagon',
    label: 'PSX estate',
    glb: 'Car4.glb',
    scale: 0.72,
    mass: 1420,
    engineId: 'engine_d4_2000',
    gearboxId: 'gearbox_manual5',
    tankLitres: 65,
    liveries: [
      ['grey', 'car4_grey.png'],
      ['pale', 'car4_lightgrey.png'],
      ['orange', 'car4_lightorange.png'],
    ],
  },
  {
    id: 'psx_cruiser',
    label: 'PSX cruiser',
    glb: 'Car5.glb',
    scale: 0.63,
    mass: 1520,
    engineId: 'engine_v8_5000',
    gearboxId: 'gearbox_auto3',
    tankLitres: 75,
    rearDriveBias: 1,
    liveries: [
      ['green', 'car5_green.png'],
      ['grey', 'car5_grey.png'],
    ],
  },
  {
    id: 'psx_police',
    label: 'PSX police cruiser',
    glb: 'Car5_Police.glb',
    scale: 0.63,
    mass: 1580,
    engineId: 'engine_v8_5000',
    gearboxId: 'gearbox_auto3',
    tankLitres: 75,
    rearDriveBias: 1,
    liveries: [['county', 'car5_police_la.png']],
  },
  {
    id: 'psx_taxi',
    label: 'PSX taxi',
    glb: 'Car5_Taxi.glb',
    scale: 0.63,
    mass: 1540,
    engineId: 'engine_i6_2800',
    gearboxId: 'gearbox_auto3',
    tankLitres: 75,
  },
  {
    id: 'psx_pickup',
    label: 'PSX pickup',
    glb: 'Car6.glb',
    scale: 0.7,
    mass: 1460,
    engineId: 'engine_i6_2800',
    gearboxId: 'gearbox_manual5',
    tankLitres: 70,
    rearDriveBias: 1,
    suspension: SUSP_TRUCK,
  },
  {
    id: 'psx_van',
    label: 'PSX van',
    glb: 'Car7.glb',
    scale: 0.76,
    mass: 1720,
    engineId: 'engine_d4_2000',
    gearboxId: 'gearbox_manual5',
    tankLitres: 75,
    suspension: SUSP_TRUCK,
    liveries: [
      ['black', 'car7_black.png'],
      ['brown', 'car7_brown.png'],
      ['green', 'car7_green.png'],
      ['grey', 'car7_grey.png'],
      ['red', 'car7_red.png'],
    ],
  },
  {
    id: 'psx_box_truck',
    label: 'PSX box truck',
    glb: 'Car8.glb',
    scale: 0.64,
    mass: 2600,
    engineId: 'engine_d6_6600',
    gearboxId: 'gearbox_truck6',
    tankLitres: 110,
    bodyClass: 'truck',
    suspension: SUSP_TRUCK,
    rearDriveBias: 1,
    liveries: [
      ['grey', 'Car8_grey.png'],
      ['mail', 'Car8_mail.png'],
      ['purple', 'Car8_purple.png'],
    ],
  },
];

/** One entry per body, plus one per extra livery over the same geometry. */
const PSX_CARS: readonly Entry[] = PSX_SPECS.flatMap((spec) => {
  const base: Entry = {
    id: spec.id,
    label: spec.label,
    dir: PSX,
    glb: spec.glb,
    bodyClass: spec.bodyClass ?? 'car',
    mass: spec.mass,
    engineId: spec.engineId,
    gearboxId: spec.gearboxId,
    tankLitres: spec.tankLitres,
    wheelGrip: 1,
    scale: spec.scale,
    suspension: spec.suspension,
    steerLock: 0.58,
    rearDriveBias: spec.rearDriveBias ?? 0,
    separateWheels: { file: `${PSX}/Wheel.glb`, ...PSX_AXLES },
  };
  return [
    base,
    ...(spec.liveries ?? []).map((livery) => ({
      ...base,
      id: `${spec.id}_${livery[0]}`,
      label: `${spec.label} (${livery[0]})`,
      textureFile: `${PSX}/${livery[1]}`,
    })),
  ];
});

/**
 * DeJunes. `car.glb` is the converted OBJ (2.53 long, so scaled up); the wheel is
 * the pack's own. The FBX models it ships alongside are loaded straight from the
 * files the author published.
 */
const DEJUNES_CARS: readonly Entry[] = [
  {
    id: 'dj_compact',
    label: 'DeJunes compact',
    dir: DEJUNES,
    glb: 'car.glb',
    bodyClass: 'car',
    mass: 1060,
    engineId: 'engine_i4_1600',
    gearboxId: 'gearbox_manual5',
    tankLitres: 48,
    wheelGrip: 1,
    scale: 1.74,
    steerLock: 0.6,
    rearDriveBias: 0,
    separateWheels: { file: `${DEJUNES}/wheel.glb`, ...PSX_AXLES },
  },
  // The FBX trio ships in centimetres (its bodies measure 337-561 units long), so
  // the scales here are that conversion plus a nudge to a believable length. They
  // carry their own wheels under the modeller's names, hence `detectWheels`.
  {
    id: 'dj_sports',
    label: 'DeJunes sports car',
    dir: DEJUNES,
    glb: 'porsche.fbx',
    bodyClass: 'car',
    mass: 1240,
    engineId: 'engine_v8_5000',
    gearboxId: 'gearbox_manual5',
    tankLitres: 62,
    wheelGrip: 1.18,
    scale: 0.0131,
    suspension: SUSP_SPORT,
    steerLock: 0.58,
    rearDriveBias: 1,
    detectWheels: true,
  },
  {
    id: 'dj_taxi',
    label: 'DeJunes taxi',
    dir: DEJUNES,
    glb: 'taxi.fbx',
    textureFile: `${DEJUNES}/paintjob.png`,
    bodyClass: 'car',
    mass: 1340,
    engineId: 'engine_i6_2800',
    gearboxId: 'gearbox_auto3',
    tankLitres: 60,
    wheelGrip: 0.98,
    scale: 0.0084,
    steerLock: 0.58,
    rearDriveBias: 1,
    detectWheels: true,
  },
  {
    id: 'dj_lowpoly',
    label: 'DeJunes coupe',
    dir: DEJUNES,
    glb: 'car.fbx',
    textureFile: `${DEJUNES}/paintjob_0.png`,
    bodyClass: 'car',
    mass: 1180,
    engineId: 'engine_i6_2800',
    gearboxId: 'gearbox_manual5',
    tankLitres: 55,
    wheelGrip: 1.05,
    scale: 0.0088,
    steerLock: 0.58,
    rearDriveBias: 1,
    detectWheels: true,
  },
];

const ENTRIES: readonly Entry[] = [
  // ---- road cars -----------------------------------------------------------
  {
    id: 'car_sedan',
    label: 'sedan',
    glb: 'sedan.glb',
    bodyClass: 'car',
    mass: 1180,
    engineId: 'engine_i4_1600',
    gearboxId: 'gearbox_manual4',
    tankLitres: 45,
    wheelGrip: 1.0,
    steerLock: 0.6,
    rearDriveBias: 1,
  },
  {
    id: 'car_sedan_sports',
    label: 'sports sedan',
    glb: 'sedan-sports.glb',
    bodyClass: 'car',
    mass: 1060,
    engineId: 'engine_i6_2800',
    gearboxId: 'gearbox_manual5',
    tankLitres: 55,
    wheelGrip: 1.1,
    suspension: SUSP_SPORT,
    steerLock: 0.62,
    rearDriveBias: 1,
  },
  {
    id: 'car_hatchback_sports',
    label: 'sports hatchback',
    glb: 'hatchback-sports.glb',
    bodyClass: 'car',
    mass: 980,
    engineId: 'engine_i4_1600',
    gearboxId: 'gearbox_manual5',
    tankLitres: 42,
    wheelGrip: 1.08,
    suspension: SUSP_SPORT,
    steerLock: 0.64,
    rearDriveBias: 0,
  },
  {
    id: 'car_taxi',
    label: 'taxi',
    glb: 'taxi.glb',
    bodyClass: 'car',
    mass: 1290,
    engineId: 'engine_i6_2800',
    gearboxId: 'gearbox_auto3',
    tankLitres: 60,
    wheelGrip: 0.95,
    steerLock: 0.58,
    rearDriveBias: 1,
  },
  {
    id: 'car_police',
    label: 'police cruiser',
    glb: 'police.glb',
    bodyClass: 'car',
    mass: 1420,
    engineId: 'engine_v8_5000',
    gearboxId: 'gearbox_auto3',
    tankLitres: 70,
    wheelGrip: 1.06,
    steerLock: 0.6,
    rearDriveBias: 1,
  },
  {
    id: 'car_suv',
    label: 'SUV',
    glb: 'suv.glb',
    bodyClass: 'car',
    mass: 1650,
    engineId: 'engine_d4_2000',
    gearboxId: 'gearbox_manual5',
    tankLitres: 70,
    wheelGrip: 1.05,
    suspension: SUSP_TRUCK,
    steerLock: 0.56,
    rearDriveBias: 0.5,
  },
  {
    id: 'car_suv_luxury',
    label: 'luxury SUV',
    glb: 'suv-luxury.glb',
    bodyClass: 'car',
    mass: 1880,
    engineId: 'engine_v8_5000',
    gearboxId: 'gearbox_auto3',
    tankLitres: 85,
    wheelGrip: 1.02,
    suspension: SUSP_TRUCK,
    steerLock: 0.54,
    rearDriveBias: 0.5,
  },
  {
    id: 'car_van',
    label: 'van',
    glb: 'van.glb',
    bodyClass: 'car',
    mass: 1720,
    engineId: 'engine_d4_2000',
    gearboxId: 'gearbox_manual5',
    tankLitres: 75,
    wheelGrip: 0.92,
    suspension: SUSP_TRUCK,
    steerLock: 0.52,
    rearDriveBias: 1,
    viewFrac: VIEW_CAB,
  },
  // ---- race ----------------------------------------------------------------
  {
    id: 'car_race',
    label: 'race car',
    glb: 'race.glb',
    bodyClass: 'car',
    mass: 760,
    engineId: 'engine_v8_5000',
    gearboxId: 'gearbox_manual5',
    tankLitres: 60,
    wheelGrip: 1.35,
    suspension: SUSP_SPORT,
    steerLock: 0.55,
    rearDriveBias: 1,
    viewFrac: VIEW_CAR,
  },
  {
    id: 'car_race_future',
    label: 'concept racer',
    glb: 'race-future.glb',
    bodyClass: 'car',
    mass: 820,
    engineId: 'engine_v8_5000',
    gearboxId: 'gearbox_auto3',
    tankLitres: 60,
    wheelGrip: 1.4,
    suspension: SUSP_SPORT,
    steerLock: 0.55,
    rearDriveBias: 0.5,
    viewFrac: VIEW_CAR,
  },
  // ---- working vehicles ----------------------------------------------------
  {
    id: 'car_truck',
    label: 'flatnose truck',
    glb: 'truck.glb',
    bodyClass: 'truck',
    mass: 3400,
    engineId: 'engine_d6_6600',
    gearboxId: 'gearbox_truck6',
    tankLitres: 140,
    wheelGrip: 0.98,
    scale: TRUCK_SCALE,
    suspension: SUSP_TRUCK,
    steerLock: 0.48,
    rearDriveBias: 1,
    viewFrac: VIEW_CAB,
    gizmoAnchors: BED_ANCHORS,
  },
  {
    id: 'car_truck_flat',
    label: 'flatbed truck',
    glb: 'truck-flat.glb',
    bodyClass: 'truck',
    mass: 3100,
    engineId: 'engine_d6_6600',
    gearboxId: 'gearbox_truck6',
    tankLitres: 140,
    wheelGrip: 0.98,
    scale: TRUCK_SCALE,
    suspension: SUSP_TRUCK,
    steerLock: 0.48,
    rearDriveBias: 1,
    viewFrac: VIEW_CAB,
    gizmoAnchors: BED_ANCHORS,
  },
  {
    id: 'car_delivery',
    label: 'delivery box van',
    glb: 'delivery.glb',
    bodyClass: 'truck',
    mass: 2900,
    engineId: 'engine_d4_2000',
    gearboxId: 'gearbox_manual5',
    tankLitres: 100,
    wheelGrip: 0.9,
    scale: TRUCK_SCALE,
    suspension: SUSP_TRUCK,
    steerLock: 0.5,
    rearDriveBias: 1,
    viewFrac: VIEW_CAB,
  },
  {
    id: 'car_delivery_flat',
    label: 'flatbed delivery',
    glb: 'delivery-flat.glb',
    bodyClass: 'truck',
    mass: 2600,
    engineId: 'engine_d4_2000',
    gearboxId: 'gearbox_manual5',
    tankLitres: 100,
    wheelGrip: 0.9,
    scale: TRUCK_SCALE,
    suspension: SUSP_TRUCK,
    steerLock: 0.5,
    rearDriveBias: 1,
    viewFrac: VIEW_CAB,
    gizmoAnchors: BED_ANCHORS,
  },
  {
    id: 'car_ambulance',
    label: 'ambulance',
    glb: 'ambulance.glb',
    bodyClass: 'truck',
    mass: 3000,
    engineId: 'engine_d6_6600',
    gearboxId: 'gearbox_auto3',
    tankLitres: 110,
    wheelGrip: 1.0,
    scale: TRUCK_SCALE,
    suspension: SUSP_TRUCK,
    steerLock: 0.5,
    rearDriveBias: 1,
    viewFrac: VIEW_CAB,
  },
  {
    id: 'car_firetruck',
    label: 'fire engine',
    glb: 'firetruck.glb',
    bodyClass: 'truck',
    mass: 4600,
    engineId: 'engine_d6_6600',
    gearboxId: 'gearbox_truck6',
    tankLitres: 160,
    wheelGrip: 1.0,
    scale: TRUCK_SCALE,
    suspension: SUSP_TRUCK,
    steerLock: 0.46,
    rearDriveBias: 1,
    viewFrac: VIEW_CAB,
  },
  {
    id: 'car_garbage_truck',
    label: 'garbage truck',
    glb: 'garbage-truck.glb',
    bodyClass: 'truck',
    mass: 5200,
    engineId: 'engine_d6_6600',
    gearboxId: 'gearbox_truck6',
    tankLitres: 160,
    wheelGrip: 0.95,
    scale: TRUCK_SCALE,
    suspension: SUSP_TRUCK,
    steerLock: 0.44,
    rearDriveBias: 1,
    viewFrac: VIEW_CAB,
  },
  // ---- tractors: slow, torquey, four-wheel drive ----------------------------
  {
    id: 'car_tractor',
    label: 'tractor',
    glb: 'tractor.glb',
    bodyClass: 'truck',
    mass: 2800,
    engineId: 'engine_d4_2000',
    gearboxId: 'gearbox_truck6',
    tankLitres: 80,
    wheelGrip: 1.25,
    scale: TRUCK_SCALE,
    suspension: SUSP_TRUCK,
    steerLock: 0.75,
    rearDriveBias: 0.5,
    viewFrac: VIEW_CAB,
    gizmoAnchors: BED_ANCHORS,
  },
  {
    id: 'car_tractor_shovel',
    label: 'shovel tractor',
    glb: 'tractor-shovel.glb',
    bodyClass: 'truck',
    mass: 3300,
    engineId: 'engine_d4_2000',
    gearboxId: 'gearbox_truck6',
    tankLitres: 80,
    wheelGrip: 1.25,
    scale: TRUCK_SCALE,
    suspension: SUSP_TRUCK,
    steerLock: 0.75,
    rearDriveBias: 0.5,
    viewFrac: VIEW_CAB,
    gizmoAnchors: BED_ANCHORS,
  },
  {
    id: 'car_tractor_police',
    label: 'police tractor',
    glb: 'tractor-police.glb',
    bodyClass: 'truck',
    mass: 2850,
    engineId: 'engine_d4_2000',
    gearboxId: 'gearbox_truck6',
    tankLitres: 80,
    wheelGrip: 1.25,
    scale: TRUCK_SCALE,
    suspension: SUSP_TRUCK,
    steerLock: 0.75,
    rearDriveBias: 0.5,
    viewFrac: VIEW_CAB,
    gizmoAnchors: BED_ANCHORS,
  },
  // ---- karts: the whole reason the kit ships five of them ------------------
  ...(['oobi', 'oodi', 'ooli', 'oopi', 'oozi'] as const).map((name, i) => ({
    id: `car_kart_${name}`,
    label: `kart ${name}`,
    glb: `kart-${name}.glb`,
    bodyClass: 'car' as BodyClass,
    mass: 220 + i * 6,
    engineId: 'engine_i4_1600',
    gearboxId: 'gearbox_manual4',
    tankLitres: 12,
    wheelGrip: 1.3,
    scale: KART_SCALE,
    suspension: SUSP_KART,
    steerLock: 0.7,
    rearDriveBias: 1,
    viewFrac: VIEW_KART,
  })),

  // -------------------------------------------------------------------------
  // Quaternius Realistic Car Pack (CC0). Modelled in real-world metres — a
  // 4.22 m sedan on a 2.44 m wheelbase with 0.26 m wheels — so these take no
  // scaling at all, and they sit next to the stylised kit as the "sensible car"
  // end of the collection.
  // -------------------------------------------------------------------------
  {
    id: 'car_q_normal1',
    label: 'saloon',
    dir: QUATERNIUS,
    glb: 'NormalCar1.glb',
    bodyClass: 'car',
    mass: 1240,
    engineId: 'engine_i4_1600',
    gearboxId: 'gearbox_manual5',
    tankLitres: 55,
    wheelGrip: 1.0,
    scale: 1,
    steerLock: 0.6,
    rearDriveBias: 0,
  },
  {
    id: 'car_q_normal2',
    label: 'city hatch',
    dir: QUATERNIUS,
    glb: 'NormalCar2.glb',
    bodyClass: 'car',
    mass: 940,
    engineId: 'engine_i4_1600',
    gearboxId: 'gearbox_manual5',
    tankLitres: 40,
    wheelGrip: 0.98,
    scale: 1,
    steerLock: 0.64,
    rearDriveBias: 0,
  },
  {
    id: 'car_q_sports',
    label: 'coupe',
    dir: QUATERNIUS,
    glb: 'SportsCar.glb',
    bodyClass: 'car',
    mass: 1120,
    engineId: 'engine_i6_2800',
    gearboxId: 'gearbox_manual5',
    tankLitres: 60,
    wheelGrip: 1.12,
    scale: 1,
    suspension: SUSP_SPORT,
    steerLock: 0.6,
    rearDriveBias: 1,
  },
  {
    id: 'car_q_sports2',
    label: 'fastback',
    dir: QUATERNIUS,
    glb: 'SportsCar2.glb',
    bodyClass: 'car',
    mass: 1180,
    engineId: 'engine_v8_5000',
    gearboxId: 'gearbox_manual5',
    tankLitres: 65,
    wheelGrip: 1.15,
    scale: 1,
    suspension: SUSP_SPORT,
    steerLock: 0.58,
    rearDriveBias: 1,
  },
  {
    id: 'car_q_suv',
    label: 'off-roader',
    dir: QUATERNIUS,
    glb: 'SUV.glb',
    bodyClass: 'car',
    mass: 1780,
    engineId: 'engine_d4_2000',
    gearboxId: 'gearbox_manual5',
    tankLitres: 80,
    wheelGrip: 1.08,
    scale: 1,
    suspension: SUSP_TRUCK,
    steerLock: 0.56,
    rearDriveBias: 0.5,
  },
  {
    id: 'car_q_taxi',
    label: 'city taxi',
    dir: QUATERNIUS,
    glb: 'Taxi.glb',
    bodyClass: 'car',
    mass: 1320,
    engineId: 'engine_i6_2800',
    gearboxId: 'gearbox_auto3',
    tankLitres: 60,
    wheelGrip: 0.96,
    scale: 1,
    steerLock: 0.58,
    rearDriveBias: 1,
  },
  {
    id: 'car_q_cop',
    label: 'patrol car',
    dir: QUATERNIUS,
    glb: 'Cop.glb',
    bodyClass: 'car',
    mass: 1380,
    engineId: 'engine_v8_5000',
    gearboxId: 'gearbox_auto3',
    tankLitres: 70,
    wheelGrip: 1.06,
    scale: 1,
    steerLock: 0.6,
    rearDriveBias: 1,
  },

  // -------------------------------------------------------------------------
  // PSX Style Cars by GGBotNet (CC0). Textured, PSX-era bodies with no wheels of
  // their own: they all borrow the pack's single Wheel model, mounted from the
  // fractions in `PSX_AXLES` (see the separateWheels note in render/carmodel.ts).
  // The pack is modelled at roughly 1.4x life size, hence PSX_SCALE.
  // -------------------------------------------------------------------------
  ...PSX_CARS,

  // -------------------------------------------------------------------------
  // DeJunes (itch.io, "free for any kind of projects"). One converted OBJ body
  // plus three FBX models loaded as they shipped. Also body-only.
  // -------------------------------------------------------------------------
  ...DEJUNES_CARS,

  // -------------------------------------------------------------------------
  // Built in code (render/proceduralcars.ts). Same contract as any pack: a body
  // and four named wheels, drawn in metres, so they are measured and driven by
  // exactly the same path. Their scale is 1 because they are authored life-size.
  // -------------------------------------------------------------------------
  {
    id: 'proc_wedge',
    label: 'Group-B wedge',
    procedural: 'wedge',
    bodyClass: 'car',
    mass: 980,
    engineId: 'engine_i6_2800',
    gearboxId: 'gearbox_manual5',
    tankLitres: 70,
    wheelGrip: 1.22,
    scale: 1,
    suspension: SUSP_SPORT,
    steerLock: 0.62,
    rearDriveBias: 0.5,
  },
  {
    id: 'proc_streamliner',
    label: 'streamliner',
    procedural: 'streamliner',
    bodyClass: 'car',
    mass: 1520,
    engineId: 'engine_i6_2800',
    gearboxId: 'gearbox_manual4',
    tankLitres: 65,
    wheelGrip: 0.88,
    scale: 1,
    steerLock: 0.5,
    rearDriveBias: 1,
  },
  {
    id: 'proc_dune_runner',
    label: 'dune runner',
    procedural: 'dunerunner',
    bodyClass: 'car',
    mass: 720,
    engineId: 'engine_v8_5000',
    gearboxId: 'gearbox_manual5',
    tankLitres: 90,
    wheelGrip: 1.3,
    scale: 1,
    suspension: SUSP_TRUCK,
    steerLock: 0.72,
    rearDriveBias: 1,
    viewFrac: [0, 0.86, 0.92],
  },
];

export const CAR_MODELS: readonly CarModelDef[] = ENTRIES.map((e) => ({
  id: e.id,
  label: e.label,
  file: e.procedural ? `procedural://${e.procedural}` : `${e.dir ?? KIT}/${e.glb}`,
  textureFile: e.textureFile,
  separateWheels: e.separateWheels,
  detectWheels: e.detectWheels,
  bodyClass: e.bodyClass,
  scale: e.scale ?? CAR_SCALE,
  mass: e.mass,
  engineId: e.engineId,
  gearboxId: e.gearboxId,
  tankLitres: e.tankLitres,
  wheelGrip: e.wheelGrip,
  suspension: e.suspension ?? SUSP_CAR,
  steerLock: e.steerLock,
  rearDriveBias: e.rearDriveBias,
  viewFrac: e.viewFrac ?? (e.bodyClass === 'car' ? VIEW_CAR : VIEW_CAB),
  gizmoAnchors: e.gizmoAnchors ?? ROAD_ANCHORS,
}));

const BY_ID = new Map(CAR_MODELS.map((m) => [m.id, m]));

/** The model a new game starts in and every fallback resolves to. */
export const DEFAULT_CAR_MODEL_ID = 'car_sedan';

export function carModel(id: string): CarModelDef {
  const m = BY_ID.get(id);
  if (!m) throw new Error(`Unknown car model "${id}"`);
  return m;
}

export function hasCarModel(id: string): boolean {
  return BY_ID.has(id);
}

/** The engine spec behind a model, resolved through the part-variant table. */
export function modelEngine(def: CarModelDef): EngineSpec {
  const spec = variant(def.engineId).engine;
  if (!spec) throw new Error(`Car model "${def.id}" names a non-engine variant`);
  return spec;
}

export function modelGearbox(def: CarModelDef): GearboxSpec {
  const spec = variant(def.gearboxId).gearbox;
  if (!spec) throw new Error(`Car model "${def.id}" names a non-gearbox variant`);
  return spec;
}
