/**
 * The car catalogue: complete, authored 3D models.
 *
 * The old concept built a car out of attachable parts. That is gone. A car is now
 * ONE finished model — imported or built in render/proceduralcars.ts — whose
 * geometry is authoritative:
 *
 *  - the chassis collider comes from the model's `body` bounding box,
 *  - suspension mounts come from its wheel nodes (or authored body-box fractions
 *    for packs that ship a shared wheel separately),
 *  - each wheel's radius comes from that wheel model's own bounds,
 *
 * all measured at load time in render/carmodel.ts. This catalogue holds geometry's
 * defaults: mass, gearbox, original engine, tank capacity, springs and steering.
 *
 * Free-form anchor parts remain cosmetic. The separate four-cell bonnet service
 * layout owns the removable engine, optional turbine, coolant tank and fuel tank.
 */

import type { BodyClass, EngineSpec, GearboxSpec, SuspensionTuning } from '../parts/registry';
import { variant } from '../parts/registry';
import { TRUNK_CELL_COUNT } from './trunk';

/**
 * Vendored packs, all free and credited in a LICENSE file beside their models.
 *
 *  - QUATERNIUS: Realistic Car Pack, CC0, real-world metres and own wheels.
 *  - PSX: GGBotNet PSX Style Cars, CC0, shared wheel and texture liveries.
 *  - DEJUNES: free-use low-poly cars, OBJ/GLB and FBX.
 *  - LOWPOLY: RgsDev Free Low Poly Vehicles Pack, CC-BY-4.0, 21 bodies sharing
 *    one GLB (flat colours, no textures).
 *
 * Generated cars use the `procedural://` scheme and live in
 * render/proceduralcars.ts rather than a directory.
 */
const QUATERNIUS = '/models/quaternius-cars';
const PSX = '/models/psx-cars';
const DEJUNES = '/models/dejunes';
const LOWPOLY = '/models/lowpoly-pack';
const SOVIET = '/models/soviet';

/* ---- suspension presets ----
 *
 * Written in the four numbers a chassis engineer actually uses — ride frequency,
 * damping ratio, bump travel and ride height — because the numbers Rapier wants are
 * derivable from those and the reverse is not. `Vehicle.rebuild` does that
 * conversion (see `wheelSpringRate` below); nothing in this file is a raw rate any
 * more.
 *
 * ---- the algebra that was wrong, and what it cost ----
 *
 * Rapier's ray-cast spring force is `stiffness * compression * chassis_mass`, i.e.
 * the rate is per kilogram of the WHOLE chassis. The body's heave mode therefore
 * stands on all four of those springs at once:
 *
 *     K_total = 4 * k * m     omega = sqrt(K_total / m) = 2 * sqrt(k)
 *
 * This file used to divide by 2*pi after taking `sqrt(k)` alone, missing the factor
 * of two, and every comment in it was wrong by an octave: the "1.06 Hz" saloon was
 * really 2.11 Hz, the "0.87 Hz" truck 1.74 Hz, the "1.33 Hz" fastback 2.66 Hz. The
 * whole catalogue rode between a modern sports car and a racing car, and the same
 * slip put damping at 0.45 and 0.63 of critical rather than the 0.23/0.31 the
 * comments claimed — stiff AND over-damped, which is exactly the "too stiff for no
 * reason" the ride reads as.
 *
 * The critical-damping figure is `2 * sqrt(k * cornerShare)`, and `suspension-probe.ts`
 * checks all of this against a bare Rapier controller so the octave cannot come back.
 *
 * ---- what a period car actually is ----
 *
 * A 1970s saloon runs 1.0-1.3 Hz at the front with the rear 10-20% higher (a rear
 * that rings slightly faster than the front makes the two ends come back into phase
 * as the car drives over a bump instead of pitching — the flat-ride rule, and the
 * reason no real car is sprung evenly). Damping is 0.2-0.3 of critical in
 * compression and 0.35-0.5 in rebound; a rebound-biased damper is what stops a soft
 * spring throwing the body back up. An unladen leaf-sprung pickup is the odd one
 * out: its rear springs are sized for a payload it is not carrying, so it hops.
 *
 * ---- travel, and why a soft spring needs it ----
 *
 * Static deflection follows from the frequency alone: `sag = g / omega^2`, which is
 * 188 mm at 1.15 Hz and 73 mm at 1.85 Hz. Rapier clamps the spring at
 * `rest +/- maxTravel` and a clamp is a rigid stop, so `Vehicle` sizes the travel as
 * `sag + bumpTravel` and puts a progressive bump stop in front of the clamp; the
 * numbers below are that bump travel, not the total.
 *
 * Droop is not a knob: a linear spring extends until it reaches free length, so the
 * available droop is exactly the sag. That is real, and it is why a soft car lifts
 * an inside wheel further.
 */

/** Body heave frequency (Hz) of a per-kilogram rate at a corner carrying `share`. */
export function heaveFrequencyHz(stiffness: number, share: number): number {
  return Math.sqrt(stiffness / share) / (2 * Math.PI);
}

/**
 * The per-kilogram rate that puts a corner carrying `share` of the mass at `hz`.
 * Inverse of `heaveFrequencyHz`; `share` is that wheel's fraction of the sprung
 * weight, so a front-heavy car's front springs come out stiffer for the same
 * frequency, which is what real spring rates do.
 */
export function wheelSpringRate(hz: number, share: number): number {
  const omega = 2 * Math.PI * hz;
  return omega * omega * share;
}

/** The per-kilogram damping coefficient for `ratio` of critical at that corner. */
export function wheelDampingRate(hz: number, ratio: number, share: number): number {
  return 2 * ratio * (2 * Math.PI * hz) * share;
}

/** Fraction of critical damping a per-kilogram coefficient represents. */
export function suspensionDampingRatio(
  stiffness: number,
  damping: number,
  share: number,
): number {
  return damping / (2 * Math.sqrt(stiffness * share));
}

/** Static spring compression (m) at a given ride frequency. Load cancels out. */
export function staticSagM(hz: number): number {
  const omega = 2 * Math.PI * hz;
  return 9.81 / (omega * omega);
}

/**
 * The everyday saloon: 1.15 Hz front, 1.32 Hz rear. Sag 188/143 mm, and a soft
 * damper that lets the body take a set before it comes back.
 */
const SUSP_CAR: SuspensionTuning = {
  frontHz: 1.15,
  rearHz: 1.32,
  compressionRatio: 0.26,
  reboundRatio: 0.42,
  bumpTravel: 0.09,
  rideHeight: 0.16,
};

/**
 * SOFT: what the Soviet saloons ride on. The softest car in the catalogue and the
 * least damped, so it leans, wallows and takes its set slowly — and that motion IS
 * the load transfer, which is what makes its breakaway progressive.
 *
 * The softness is in the SPRINGS only. Ride height stays at the saloon figure: a
 * Zhiguli sits at a normal car's clearance, and the extra sag a soft spring needs is
 * paid for out of travel (see the travel note above), never out of stance.
 */
const SUSP_SOFT: SuspensionTuning = {
  frontHz: 1.02,
  rearHz: 1.18,
  compressionRatio: 0.22,
  reboundRatio: 0.36,
  bumpTravel: 0.1,
  rideHeight: 0.155,
};

/** "Sport" in this era means a firm saloon on stiffer dampers, not a modern chassis. */
const SUSP_SPORT: SuspensionTuning = {
  frontHz: 1.38,
  rearHz: 1.55,
  compressionRatio: 0.3,
  reboundRatio: 0.46,
  bumpTravel: 0.08,
  rideHeight: 0.13,
};

/**
 * The V8 fastback: the firmest and lowest thing here, because its launch torque
 * will seesaw anything softer. Still 1.5 Hz rather than a track car's 2.5.
 */
const SUSP_FASTBACK: SuspensionTuning = {
  frontHz: 1.5,
  rearHz: 1.68,
  compressionRatio: 0.32,
  reboundRatio: 0.48,
  bumpTravel: 0.075,
  rideHeight: 0.12,
};

/**
 * Unladen leaf-sprung working vehicle. The rear is sprung for a payload that is not
 * in the bed, so it rings at 1.85 Hz against the front's 1.3 and skips over sharp
 * bumps — the empty-pickup hop, and the reason the tail steps out on a rough bend.
 */
const SUSP_TRUCK: SuspensionTuning = {
  frontHz: 1.3,
  rearHz: 1.85,
  compressionRatio: 0.24,
  reboundRatio: 0.38,
  bumpTravel: 0.11,
  rideHeight: 0.22,
};

/* ---- weight distribution ----
 *
 * Where the mass sits along the wheelbase, as a fraction on the FRONT axle. It is
 * not a tuning knob: for a front-engined car it follows from the layout, and it is
 * the single most load-bearing number in the car's balance, because every axle load,
 * spring rate, load-sensitivity reference and transfer calculation is measured
 * against it. `Vehicle` turns it into the chassis' centre of mass and each wheel's
 * static load using the model's own axle positions.
 *
 * The figures are period kerb measurements:
 *
 *   front-engine RWD saloon      52-55% front   (engine ahead of the axle, live
 *                                                axle and tank behind)
 *   transverse FWD hatchback     60-63% front   (engine, box and diff all on the
 *                                                front axle; nothing over the rear)
 *   part-time 4WD wagon/off-road 55-57% front   (a transfer case adds mass amidships)
 *   working vehicle, empty bed   56-58% front   (the payload it is sprung for is
 *                                                not in it — the empty-pickup case)
 *
 * Nothing here is rear-engined: the catalogue has no rear-engine layout, and if one
 * arrives it needs its own entry rather than a guess from its drive bias.
 */
export function frontWeightFraction(model: {
  readonly rearDriveBias: number;
  readonly bodyClass: BodyClass;
}): number {
  if (model.bodyClass === 'truck' || model.bodyClass === 'bus') return 0.57;
  // Drive bias is the layout: 0 is transverse front-drive, 1 is a front engine
  // driving the back axle, and a half is four-wheel drive with the mass amidships.
  if (model.rearDriveBias <= 0.01) return 0.62;
  if (model.rearDriveBias >= 0.99) return 0.53;
  return 0.56;
}

/**
 * A mount point for a gizmo, in model space (metres, origin on the ground between
 * the wheels — the model's own origin). Positions are fractions of the measured
 * body box rather than absolutes, so one table serves every body; the fractions are
 * resolved against real bounds in render/carmodel.ts.
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

/**
 * Authored lamp selectors. A selector may name either a mesh node or its material;
 * this covers FBX exports with separate lamp objects and GLBs with material-split
 * body meshes without mutating either asset format.
 */
export interface VehicleLightsDef {
  readonly headlights: readonly string[];
  readonly taillights: readonly string[];
  readonly reverseLights?: readonly string[];
  readonly leftBlinkers?: readonly string[];
  readonly rightBlinkers?: readonly string[];
}



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
  /**
   * Body node to extract when several vehicles share one pack file. Absent means
   * the whole scene is the vehicle.
   */
  readonly packNode?: string;
  /** Wheel node name prefix within a pack file; absent means `packNode`. */
  readonly packWheelPrefix?: string;
  readonly bodyClass: BodyClass;
  /** Uniform model-units-to-metres scale. */
  readonly scale: number;
  /**
   * Yaw applied to the imported model before it is measured, radians.
   *
   * The game drives toward +Z, so a model authored nose-first down -Z arrives
   * back to front: it drove in reverse, its hood camera looked out of the boot and
   * its front axle steered from the rear. Two of the DeJunes bodies are authored
   * that way (`Math.PI` below), which nothing in the file declares — a body is just
   * a mesh, and only looking at it tells you which end the lights are on.
   *
   * It is applied before measurement rather than at draw time on purpose. Every
   * derived quantity — the chassis box, which axle is the front one, the gizmo
   * anchors, the hood camera — comes out of the measured geometry, so rotating the
   * geometry first is what keeps all of them agreeing with each other.
   */
  readonly yaw?: number;
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
  /** Authored lenses whose per-instance materials mirror the vehicle's live controls. */
  readonly lights?: VehicleLightsDef;
  readonly gizmoAnchors: readonly GizmoAnchorDef[];
  /**
   * Whether this model belongs to a roadworthy pack. Only Quaternius and Soviet
   * cars may appear as working vehicles or in the development spawn menu; every
   * other model remains available to the static world-wreck pool.
   */
  readonly spawnable: boolean;
  /** Every car body, roadworthy or wreck-only, carries the shared 4x2 trunk. */
  readonly storageCells: number;
}

/** Shared defaults; every entry below states only what makes it itself. */
type Entry = Omit<
  CarModelDef,
  | 'file'
  | 'scale'
  | 'suspension'
  | 'viewFrac'
  | 'lights'
  | 'gizmoAnchors'
  | 'spawnable'
  | 'storageCells'
> & {
  /** Model file name within the pack directory named by `dir`. */
  readonly glb?: string;
  /** Directory containing `glb`; required for imported models. */
  readonly dir?: string;
  /**
   * Id of a car built in code (render/proceduralcars.ts) instead of loaded. Set
   * this OR `glb`, never both.
   */
  readonly procedural?: string;
  readonly scale?: number;
  readonly suspension?: SuspensionTuning;
  readonly viewFrac?: readonly [number, number, number];
  readonly lights?: VehicleLightsDef;
  readonly gizmoAnchors?: readonly GizmoAnchorDef[];
  /** Legacy authored hint; the catalogue normalizer now gives every body eight cells. */
  readonly storageCells?: number;
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
  readonly storageCells?: number;
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
    storageCells: 2,
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
    storageCells: 2,
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
    storageCells: 4,
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
    storageCells: 4,
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
    storageCells: 5,
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

/**
 * One entry per body, plus one per extra livery over the same geometry.
 *
 * These models remain in the complete catalogue for static world wrecks.
 */
const PSX_CARS: readonly Entry[] = PSX_SPECS.flatMap((spec) => {
  const base: Entry = {
    id: spec.id,
    label: spec.label,
    dir: PSX,
    glb: spec.glb,
    bodyClass: spec.bodyClass ?? 'car',
    storageCells: spec.storageCells,
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
 *
 * ---- scale ----
 *
 * These bodies are drawn CHUNKY: the taxi is 561 units long on 251 wide, a 2.24:1
 * footprint where a real saloon is 2.6:1, and the sports car is 2.03:1. Scaling
 * them to a believable LENGTH therefore made them 2.1-2.2 m wide and 1.6-1.7 m
 * tall — wider than the Quaternius SUV and half a metre taller than its saloon,
 * which is the "too huge" everyone saw: side by side the excess reads as width and
 * height, not length.
 *
 * So they are scaled to WIDTH instead, 1.95 m across (the two with mirrors measure
 * mirror to mirror, so their bodies land near the 1.81 m Quaternius saloon), and
 * length falls out at 3.96-4.36 m. Heights come down to 1.43-1.56 m, inside the
 * pack range they park next to.
 */
const DEJUNES_CARS: readonly Entry[] = [
  {
    id: 'dj_compact',
    storageCells: 2,
    label: 'DeJunes compact',
    dir: DEJUNES,
    glb: 'car.glb',
    // Authored nose-first down -Z: its taillights were leading the way.
    yaw: Math.PI,
    bodyClass: 'car',
    mass: 1060,
    engineId: 'engine_i4_1600',
    gearboxId: 'gearbox_manual5',
    tankLitres: 48,
    wheelGrip: 1,
    scale: 1.74,
    steerLock: 0.6,
    rearDriveBias: 0,
    // Its arches sit closer together than the PSX saloons the shared fractions were
    // matched to: at -0.66 the rear axle lands ~17 cm behind this body's rear arch.
    // -0.582 puts the rear wheel back under the arch (measured off car.glb).
    separateWheels: { file: `${DEJUNES}/wheel.glb`, frontZFrac: 0.6, rearZFrac: -0.582, trackFrac: 0.78 },
  },
  // The FBX trio ships in centimetres (its bodies measure 337-561 units long), so
  // the scales here are that conversion plus the width fit described above. They
  // carry their own wheels under the modeller's names, hence `detectWheels`.
  //
  // Textures: each FBX names its own maps per material. The taxi's resolve (it ships
  // `paintjob.png` for the body and `paintjob_plate.png` for the plate, and the
  // loader finds both beside the model), so it needs no `textureFile` — overriding
  // it with one map was what put body paint on the number plate. `car.fbx` asks for
  // a `Paintjob2.png` the pack never shipped, so its paint slot IS overridden, with
  // one of the five liveries it did ship.
  {
    id: 'dj_sports',
    storageCells: 2,
    label: 'DeJunes sports car',
    dir: DEJUNES,
    glb: 'porsche.fbx',
    // Also authored nose-first down -Z; the spoiler was out front.
    yaw: Math.PI,
    bodyClass: 'car',
    mass: 1240,
    engineId: 'engine_v8_5000',
    gearboxId: 'gearbox_manual5',
    tankLitres: 62,
    wheelGrip: 1.18,
    scale: 0.01175,
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
    bodyClass: 'car',
    mass: 1340,
    engineId: 'engine_i6_2800',
    gearboxId: 'gearbox_auto3',
    tankLitres: 60,
    wheelGrip: 0.98,
    scale: 0.00777,
    steerLock: 0.58,
    rearDriveBias: 1,
    detectWheels: true,
  },
  {
    id: 'dj_lowpoly',
    storageCells: 2,
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
    scale: 0.00777,
    steerLock: 0.58,
    rearDriveBias: 1,
    detectWheels: true,
  },
];

/**
 * RgsDev "Free Low Poly Vehicles Pack" (Sketchfab, CC-BY-4.0 — attribution beside
 * vehicles.glb). 21 finished bodies in ONE GLB sharing ONE material set: the pack
 * is 21 flat baseColorFactor colours and zero images, so there is no livery to
 * repaint and no per-entry material cloning ever happens.
 *
 * The 21 bodies sit in a showroom row inside that one scene, each a named node
 * with its own world transform, so an entry names the node to extract (`packNode`)
 * and the loader pulls that subtree plus its four `<name> wheel …` siblings into a
 * fresh group before measurement (render/carmodel.ts). Geometry and materials stay
 * shared across all 21 because extraction clones Object3D nodes with `clone(true)`,
 * which copies every transform but leaves each BufferGeometry and Material pointing
 * at the same buffer — the file is parsed once and its GPU resources are never
 * duplicated (the loader caches the parsed scene by file URL).
 *
 * ---- scale: fitted to the Quaternius footprint ----
 *
 * The pack is drawn CHUNKY. Its car bodies are all 2.81 m wide on 5.0-6.1 m of
 * length — a 1.9:1 footprint where the Quaternius saloon is 4.22 x 1.81, i.e.
 * 2.3:1 — so no uniform scale can match a real car in both directions. Fitting
 * LENGTH (what this file used to do) was the wrong half to pick: the saloon landed
 * at a believable 4.71 m and 2.53 m WIDE, half a metre wider than the Quaternius
 * SUV, and the whole pack read as monster trucks parked next to normal cars.
 *
 * So each body is fitted by FOOTPRINT AREA instead: `scale = sqrt(target L*W /
 * raw L*W)` against a target taken from the vehicle it is meant to be (the
 * Quaternius saloon's 4.22 x 1.81 for a saloon, real-world figures for the classes
 * that pack has none of). Area splits the mismatch between the two axes, so the
 * saloon lands at 3.85 x 2.07 — a little short and a little wide of the Quaternius
 * saloon instead of a lot wider — and every body in the pack now parks in the same
 * size band as the rest of the catalogue: cars 3.3-4.9 m long and 1.76-2.36 m wide,
 * the semi 11.7 m, the bus 9.9 m. They still LOOK chunky, which is the point; they
 * are no longer a different scale of world.
 *
 * The targets and the arithmetic are in `tools/lowpoly-fit.mjs`; re-run it after
 * touching a target and paste the scale it prints.
 *
 * Drivetrain follows the fleet's diesel weighting (see the gas-stop stock): the
 * heavy, low-revving four — Bus, Truck, truck-with-trailer, Firetruck — take the
 * 6.6 diesel, the three working vehicles — Pickup, Van, Ambulance — the 2.0 diesel,
 * and everything car-shaped stays petrol. Seven diesels in twenty-one is a third,
 * exactly the mix the fluid stock is weighted for.
 */
interface LowPolySpec {
  readonly id: string;
  readonly label: string;
  /** Node name inside vehicles.glb, also the `<name> wheel …` prefix. */
  readonly packNode: string;
  readonly scale: number;
  readonly mass: number;
  readonly engineId: string;
  readonly gearboxId: string;
  readonly tankLitres: number;
  readonly wheelGrip: number;
  readonly steerLock: number;
  readonly rearDriveBias: number;
  readonly bodyClass?: BodyClass;
  readonly suspension?: SuspensionTuning;
  readonly storageCells?: number;
  readonly viewFrac?: readonly [number, number, number];
}

const LOWPOLY_SPECS: readonly LowPolySpec[] = [
  {
    id: 'lp_monster_truck',
    label: 'low-poly monster truck',
    packNode: 'Monster Truck',
    scale: 0.812, // fits 4.6 x 2.30 m
    mass: 4200,
    engineId: 'engine_v8_5000',
    gearboxId: 'gearbox_manual5',
    tankLitres: 120,
    wheelGrip: 1.2,
    steerLock: 0.56,
    rearDriveBias: 0.5,
    bodyClass: 'truck',
    suspension: SUSP_TRUCK,
    // A show toy, not a boot: the load space is a driver's lap at best.
    storageCells: 1,
    // Giant 1.9 m wheels on a 4.9 m body read as a sideshow, not road stock. It
    // stays in the desert as scenery but is never something the player chooses.
  },
  {
    id: 'lp_suv',
    label: 'low-poly SUV',
    packNode: 'SUV',
    scale: 0.798, // fits 4.4 x 2.05 m
    mass: 1780,
    engineId: 'engine_i6_2800',
    gearboxId: 'gearbox_manual5',
    tankLitres: 80,
    wheelGrip: 1.05,
    steerLock: 0.56,
    rearDriveBias: 0.5,
    suspension: SUSP_TRUCK,
    storageCells: 4,
  },
  {
    id: 'lp_pickup',
    label: 'low-poly pickup',
    packNode: 'Pickup',
    scale: 0.84, // fits 5.0 x 2.00 m
    mass: 1550,
    engineId: 'engine_d4_2000',
    gearboxId: 'gearbox_manual5',
    tankLitres: 70,
    wheelGrip: 1.0,
    steerLock: 0.56,
    rearDriveBias: 1,
    bodyClass: 'truck',
    suspension: SUSP_TRUCK,
    // Open bed carries less than a box, more than a boot.
    storageCells: 4,
  },
  {
    id: 'lp_hatchback',
    label: 'low-poly hatchback',
    packNode: 'Hatchback',
    scale: 0.653, // fits 3.6 x 1.70 m
    mass: 980,
    engineId: 'engine_i4_1600',
    gearboxId: 'gearbox_manual5',
    tankLitres: 42,
    wheelGrip: 0.98,
    steerLock: 0.64,
    rearDriveBias: 0,
    storageCells: 2,
  },
  {
    id: 'lp_sedan',
    label: 'low-poly sedan',
    packNode: 'Sedan',
    scale: 0.735, // fits 4.3 x 1.85 m
    mass: 1250,
    engineId: 'engine_i4_1600',
    gearboxId: 'gearbox_manual5',
    tankLitres: 55,
    wheelGrip: 0.95,
    steerLock: 0.6,
    rearDriveBias: 0,
  },
  {
    id: 'lp_muscle',
    label: 'low-poly muscle',
    packNode: 'Muscle',
    scale: 0.724, // fits 4.7 x 1.90 m
    mass: 1350,
    engineId: 'engine_v8_5000',
    gearboxId: 'gearbox_manual5',
    tankLitres: 65,
    wheelGrip: 1.08,
    steerLock: 0.6,
    rearDriveBias: 1,
    suspension: SUSP_SPORT,
    storageCells: 2,
  },
  {
    id: 'lp_muscle_2',
    label: 'low-poly muscle 2',
    packNode: 'Muscle 2',
    scale: 0.724, // fits 4.7 x 1.90 m
    mass: 1380,
    engineId: 'engine_v8_5000',
    gearboxId: 'gearbox_manual5',
    tankLitres: 65,
    wheelGrip: 1.08,
    steerLock: 0.6,
    rearDriveBias: 1,
    suspension: SUSP_SPORT,
    storageCells: 2,
  },
  {
    id: 'lp_van',
    label: 'low-poly van',
    packNode: 'Van',
    scale: 0.758, // fits 4.9 x 1.95 m
    mass: 1750,
    engineId: 'engine_d4_2000',
    gearboxId: 'gearbox_manual5',
    tankLitres: 75,
    wheelGrip: 0.9,
    steerLock: 0.56,
    rearDriveBias: 0,
    suspension: SUSP_TRUCK,
    storageCells: 5,
  },
  {
    id: 'lp_ambulance',
    label: 'low-poly ambulance',
    packNode: 'Ambulance',
    scale: 0.826, // fits 5.4 x 2.10 m
    mass: 2100,
    engineId: 'engine_d4_2000',
    gearboxId: 'gearbox_manual5',
    tankLitres: 85,
    wheelGrip: 0.9,
    steerLock: 0.56,
    rearDriveBias: 1,
    bodyClass: 'truck',
    suspension: SUSP_TRUCK,
    // A patient bay, not a cargo hold: it carries less than the bare box it is.
    storageCells: 5,
    // Bonneted like the van, so it keeps the hood camera despite truck class.
    viewFrac: VIEW_CAR,
  },
  {
    id: 'lp_truck',
    label: 'low-poly truck',
    packNode: 'Truck',
    scale: 0.931, // fits 6.5 x 2.45 m
    mass: 4200,
    engineId: 'engine_d6_6600',
    gearboxId: 'gearbox_truck6',
    tankLitres: 130,
    wheelGrip: 0.88,
    steerLock: 0.5,
    rearDriveBias: 1,
    bodyClass: 'truck',
    suspension: SUSP_TRUCK,
  },
  {
    // Twelve wheels, four that drive: this is a semi, not a car. The loader takes
    // the front pair plus the LEADING rear pair (the truck's own axles) as the
    // driven four and leaves the trailing tandem and the trailer's three bogies
    // bolted to the body — see the "extra axles" note in render/carmodel.ts.
    id: 'lp_truck_trailer',
    label: 'low-poly truck with trailer',
    packNode: 'Truck with trailer',
    scale: 0.874, // fits 14.0 x 2.50 m
    mass: 6800,
    engineId: 'engine_d6_6600',
    gearboxId: 'gearbox_truck6',
    tankLitres: 150,
    wheelGrip: 0.85,
    steerLock: 0.5,
    rearDriveBias: 1,
    bodyClass: 'truck',
    suspension: SUSP_TRUCK,
  },
  {
    id: 'lp_bus',
    label: 'low-poly bus',
    packNode: 'Bus',
    scale: 0.719, // fits 10.8 x 2.50 m
    mass: 9500,
    engineId: 'engine_d6_6600',
    gearboxId: 'gearbox_truck6',
    tankLitres: 220,
    wheelGrip: 0.85,
    steerLock: 0.5,
    rearDriveBias: 1,
    bodyClass: 'bus',
    suspension: SUSP_TRUCK,
  },
  {
    id: 'lp_firetruck',
    label: 'low-poly firetruck',
    packNode: 'Firetruck',
    scale: 0.771, // fits 7.8 x 2.50 m
    mass: 7800,
    engineId: 'engine_d6_6600',
    gearboxId: 'gearbox_truck6',
    tankLitres: 150,
    wheelGrip: 0.85,
    steerLock: 0.5,
    rearDriveBias: 1,
    bodyClass: 'truck',
    suspension: SUSP_TRUCK,
    // Municipal machinery, not personal transport: it belongs parked at a station
    // or abandoned in the sand, not on the spawn menu.
  },
  {
    id: 'lp_limousine',
    label: 'low-poly limousine',
    packNode: 'Limousine',
    scale: 0.655, // fits 6.5 x 1.90 m
    mass: 2100,
    engineId: 'engine_i6_2800',
    gearboxId: 'gearbox_auto3',
    tankLitres: 85,
    wheelGrip: 0.95,
    steerLock: 0.5,
    rearDriveBias: 1,
    // A long body, not a big boot: the stretch carries passengers, not cargo.
    storageCells: 4,
  },
  {
    id: 'lp_police_sedan',
    label: 'low-poly police sedan',
    packNode: 'Police Sedan',
    scale: 0.735, // fits 4.3 x 1.85 m
    mass: 1320,
    engineId: 'engine_i6_2800',
    gearboxId: 'gearbox_auto3',
    tankLitres: 70,
    wheelGrip: 1.0,
    steerLock: 0.6,
    rearDriveBias: 1,
  },
  {
    id: 'lp_police_suv',
    label: 'low-poly police SUV',
    packNode: 'Police SUV',
    scale: 0.798, // fits 4.4 x 2.05 m
    mass: 1900,
    engineId: 'engine_i6_2800',
    gearboxId: 'gearbox_auto3',
    tankLitres: 85,
    wheelGrip: 1.05,
    steerLock: 0.56,
    rearDriveBias: 0.5,
    suspension: SUSP_TRUCK,
    storageCells: 4,
  },
  {
    id: 'lp_police_muscle',
    label: 'low-poly police muscle',
    packNode: 'Police Muscle',
    scale: 0.724, // fits 4.7 x 1.90 m
    mass: 1420,
    engineId: 'engine_v8_5000',
    gearboxId: 'gearbox_auto3',
    tankLitres: 70,
    wheelGrip: 1.1,
    steerLock: 0.6,
    rearDriveBias: 1,
    suspension: SUSP_SPORT,
    storageCells: 2,
  },
  {
    id: 'lp_police_sports',
    label: 'low-poly police sports',
    packNode: 'Police Sports',
    scale: 0.708, // fits 4.2 x 1.80 m
    mass: 1380,
    engineId: 'engine_v8_5000',
    gearboxId: 'gearbox_auto3',
    tankLitres: 65,
    wheelGrip: 1.12,
    steerLock: 0.6,
    rearDriveBias: 1,
    suspension: SUSP_SPORT,
    storageCells: 2,
  },
  {
    id: 'lp_roadster',
    label: 'low-poly roadster',
    packNode: 'Roadster',
    scale: 0.667, // fits 3.9 x 1.72 m
    mass: 980,
    engineId: 'engine_i4_1600',
    gearboxId: 'gearbox_manual5',
    tankLitres: 60,
    wheelGrip: 1.05,
    steerLock: 0.62,
    rearDriveBias: 1,
    suspension: SUSP_SPORT,
    // Two seats and a scuttle, nothing more to put things in.
    storageCells: 1,
  },
  {
    id: 'lp_sports',
    label: 'low-poly sports car',
    packNode: 'Sports',
    scale: 0.708, // fits 4.2 x 1.80 m
    mass: 1150,
    engineId: 'engine_i6_2800',
    gearboxId: 'gearbox_manual5',
    tankLitres: 65,
    wheelGrip: 1.1,
    steerLock: 0.6,
    rearDriveBias: 1,
    suspension: SUSP_SPORT,
    storageCells: 2,
  },
  {
    id: 'lp_taxi',
    label: 'low-poly taxi',
    packNode: 'Taxi',
    scale: 0.735, // fits 4.3 x 1.85 m
    mass: 1320,
    engineId: 'engine_i6_2800',
    gearboxId: 'gearbox_auto3',
    tankLitres: 60,
    wheelGrip: 0.95,
    steerLock: 0.58,
    rearDriveBias: 1,
  },
];

/** One entry per body; the pack file, its extraction and the defaults are shared. */
const LOWPOLY_CARS: readonly Entry[] = LOWPOLY_SPECS.map((spec) => ({
  id: spec.id,
  label: spec.label,
  dir: LOWPOLY,
  glb: 'vehicles.glb',
  packNode: spec.packNode,
  bodyClass: spec.bodyClass ?? 'car',
  storageCells: spec.storageCells,
  mass: spec.mass,
  engineId: spec.engineId,
  gearboxId: spec.gearboxId,
  tankLitres: spec.tankLitres,
  wheelGrip: spec.wheelGrip,
  scale: spec.scale,
  suspension: spec.suspension,
  steerLock: spec.steerLock,
  rearDriveBias: spec.rearDriveBias,
  viewFrac: spec.viewFrac,
}));

/**
 * Low Poly Soviet Car Pack — fifteen bodies, one FBX each, and the only pack in
 * the catalogue that is about the same cars this game is already about.
 *
 * They needed no conversion and no simplification. Every one is 4.0k-5.8k triangles
 * (the DeJunes bodies are heavier), modelled in real-world proportions, nose-first
 * down +Z the way this game drives, and carrying its own four wheels as separate
 * meshes — so `detectWheels` finds them by shape and the whole pack lands on the
 * standard path. FBXLoader reports them in centimetres, hence `scale: 0.01`.
 *
 * Colour is UV, not material: each body's UVs point into a region of the pack's
 * shared `albedo.png` palette, and the pack ships one FBX per colour. One colour per
 * model is vendored — a Volga is white because a Volga was white — and `textureFile`
 * hands the same 16 KB atlas to all fifteen.
 *
 * Figures are the real cars': the Zhiguli line runs the 1.2 that already exists as a
 * part (`engine_lada_1200`, authored from the 2101), the 1.5-1.6 cars step up to the
 * generic 1.6, the Samaras are front-wheel drive on five speeds, and both Nivas are
 * 4WD on truck springs because that is what a Niva is for.
 */
interface SovietSpec {
  readonly id: string;
  readonly label: string;
  readonly file: string;
  readonly mass: number;
  readonly engineId: string;
  readonly gearboxId: string;
  readonly tankLitres: number;
  readonly wheelGrip: number;
  readonly steerLock: number;
  readonly rearDriveBias: number;
  readonly suspension?: SuspensionTuning;
  readonly storageCells?: number;
}

/*
 * The grip ladder runs backwards from every other pack on purpose: these are
 * cross-ply-era cars, not modern tyres. The RWD classics sit lowest (0.88-0.94)
 * because their tyres and geometry predate radials; the front-drive Samaras step
 * up to 0.96 because they are a decade newer and run radials; the rally 2105
 * (1.04) is the one somebody built to corner; and the Nivas stay low (0.90-0.92)
 * on grip but claw it back with four-wheel drive.
 */
const SOVIET_SPECS: readonly SovietSpec[] = [
  {
    // GAZ-21 Volga: 2.4 litre, 70 hp, three-speed column shift, and 1.5 tonnes of
    // chrome. It now runs its own lazy 2.4 four (`engine_i4_2445`) instead of
    // borrowing the 2.8 six; the four-speed stands in for the column change.
    id: 'sv_gaz21',
    label: 'GAZ-21 Volga',
    file: 'gz21.fbx',
    mass: 1460,
    engineId: 'engine_i4_2445',
    gearboxId: 'gearbox_manual4',
    tankLitres: 60,
    wheelGrip: 0.88,
    steerLock: 0.52,
    rearDriveBias: 1,
    suspension: SUSP_SOFT,
  },
  {
    // GAZ-24 Volga: the same idea fifteen years later, 95 hp and slightly lighter.
    id: 'sv_gaz24',
    label: 'GAZ-24 Volga',
    file: 'gz24.fbx',
    mass: 1420,
    engineId: 'engine_i4_2445',
    gearboxId: 'gearbox_manual4',
    tankLitres: 55,
    wheelGrip: 0.90,
    steerLock: 0.54,
    rearDriveBias: 1,
    suspension: SUSP_SOFT,
  },
  {
    // VAZ-2101, the Zhiguli. 1.2 litre, 62 hp, 955 kg: the car the parts bin's
    // `engine_lada_1200` was authored from, finally attached to its own body.
    id: 'sv_vaz2101',
    label: 'VAZ-2101 Zhiguli',
    file: 'vz01.fbx',
    mass: 985,
    engineId: 'engine_lada_1200',
    gearboxId: 'gearbox_lada_4',
    tankLitres: 39,
    wheelGrip: 0.90,
    steerLock: 0.6,
    rearDriveBias: 1,
    suspension: SUSP_SOFT,
  },
  {
    // VAZ-2102: the 2101 as an estate. Same running gear, a boot you can sleep in.
    id: 'sv_vaz2102',
    label: 'VAZ-2102 estate',
    file: 'vz02.fbx',
    mass: 1030,
    engineId: 'engine_lada_1200',
    gearboxId: 'gearbox_lada_4',
    tankLitres: 39,
    wheelGrip: 0.90,
    steerLock: 0.6,
    rearDriveBias: 1,
    suspension: SUSP_SOFT,
    storageCells: 5,
  },
  {
    // VAZ-2103: 1.5 litre, twin headlights, the "luxury" one.
    id: 'sv_vaz2103',
    label: 'VAZ-2103',
    file: 'vz03.fbx',
    mass: 1030,
    engineId: 'engine_i4_1600',
    gearboxId: 'gearbox_lada_4',
    tankLitres: 39,
    wheelGrip: 0.92,
    steerLock: 0.6,
    rearDriveBias: 1,
    suspension: SUSP_SOFT,
  },
  {
    // VAZ-2104: the 2105's estate. The workhorse of the line.
    id: 'sv_vaz2104',
    label: 'VAZ-2104 estate',
    file: 'vz04.fbx',
    mass: 1060,
    engineId: 'engine_i4_1600',
    gearboxId: 'gearbox_lada_4',
    tankLitres: 39,
    wheelGrip: 0.90,
    steerLock: 0.6,
    rearDriveBias: 1,
    suspension: SUSP_SOFT,
    storageCells: 5,
  },
  {
    // VAZ-2105: square lights, 1.3 litre, the one everyone's uncle had.
    id: 'sv_vaz2105',
    label: 'VAZ-2105',
    file: 'vz05.fbx',
    mass: 995,
    engineId: 'engine_lada_1200',
    gearboxId: 'gearbox_lada_4',
    tankLitres: 39,
    wheelGrip: 0.92,
    steerLock: 0.6,
    rearDriveBias: 1,
    suspension: SUSP_SOFT,
  },
  {
    // The pack's rally 2105: stripes, spot lamps, and 7 cm more ride height than its
    // showroom twin. Sport springs and more grip, because somebody built it for this.
    id: 'sv_vaz2105r',
    label: 'VAZ-2105 rally',
    file: 'vz05r.fbx',
    mass: 960,
    engineId: 'engine_i4_1600',
    gearboxId: 'gearbox_manual5',
    tankLitres: 39,
    wheelGrip: 1.04,
    steerLock: 0.64,
    rearDriveBias: 1,
    suspension: SUSP_SPORT,
    storageCells: 1,
  },
  {
    // VAZ-2106: 1.6 litre, 78 hp. The fastest of the classic saloons.
    id: 'sv_vaz2106',
    label: 'VAZ-2106',
    file: 'vz06.fbx',
    mass: 1035,
    engineId: 'engine_i4_1600',
    gearboxId: 'gearbox_lada_4',
    tankLitres: 39,
    wheelGrip: 0.94,
    steerLock: 0.6,
    rearDriveBias: 1,
    suspension: SUSP_SOFT,
  },
  {
    // VAZ-2107: the 2105 with a grille that thinks it is a Mercedes.
    id: 'sv_vaz2107',
    label: 'VAZ-2107',
    file: 'vz07.fbx',
    mass: 1060,
    engineId: 'engine_i4_1600',
    gearboxId: 'gearbox_manual5',
    tankLitres: 39,
    wheelGrip: 0.94,
    steerLock: 0.6,
    rearDriveBias: 1,
    suspension: SUSP_SOFT,
  },
  {
    // VAZ-2108 Sputnik: the break with everything above it — front-wheel drive,
    // five speeds, three doors, 900 kg. Steers like a different decade.
    id: 'sv_vaz2108',
    label: 'VAZ-2108 Sputnik',
    file: 'vz08.fbx',
    mass: 945,
    engineId: 'engine_lada_1200',
    gearboxId: 'gearbox_manual5',
    tankLitres: 43,
    wheelGrip: 0.96,
    steerLock: 0.64,
    rearDriveBias: 0,
    storageCells: 2,
  },
  {
    // VAZ-2109: the five-door Samara.
    id: 'sv_vaz2109',
    label: 'VAZ-2109 Samara',
    file: 'vz09.fbx',
    mass: 970,
    engineId: 'engine_lada_1200',
    gearboxId: 'gearbox_manual5',
    tankLitres: 43,
    wheelGrip: 0.96,
    steerLock: 0.64,
    rearDriveBias: 0,
    storageCells: 3,
  },
  {
    // VAZ-21099: the Samara with a boot grafted on, and 16 cm longer for it.
    id: 'sv_vaz21099',
    label: 'VAZ-21099',
    file: 'vz099.fbx',
    mass: 985,
    engineId: 'engine_i4_1600',
    gearboxId: 'gearbox_manual5',
    tankLitres: 43,
    wheelGrip: 0.96,
    steerLock: 0.62,
    rearDriveBias: 0,
  },
  {
    // VAZ-2121 Niva: 1.6 litre, permanent four-wheel drive, a locking centre diff
    // and 22 cm of clearance. The one car in the catalogue built for this desert.
    id: 'sv_niva',
    label: 'VAZ-2121 Niva',
    file: 'vz21.fbx',
    mass: 1210,
    engineId: 'engine_i4_1600',
    gearboxId: 'gearbox_manual4',
    tankLitres: 42,
    wheelGrip: 0.92,
    steerLock: 0.62,
    rearDriveBias: 0.5,
    suspension: SUSP_TRUCK,
    storageCells: 4,
  },
  {
    // VAZ-2131: the Niva stretched to five doors. Same drivetrain, 43 cm more of it.
    id: 'sv_niva_long',
    label: 'VAZ-2131 Niva',
    file: 'vz31.fbx',
    mass: 1285,
    engineId: 'engine_i4_1600',
    gearboxId: 'gearbox_manual5',
    tankLitres: 42,
    wheelGrip: 0.90,
    steerLock: 0.6,
    rearDriveBias: 0.5,
    suspension: SUSP_TRUCK,
    storageCells: 6,
  },
];

function sovietLights(file: string): VehicleLightsDef {
  const stem = file.slice(0, -4);
  const prefix = stem.startsWith('gz') ? `g${stem.slice(2)}` : stem.slice(2);
  const headlights = [prefix === '31' ? '31bodyhead;ights' : `${prefix}bodyheadlights`];
  const taillights = [`${prefix}bodytaillights`];
  const reverseLights = ['01', '02', '03'].includes(prefix)
    ? undefined
    : [`${prefix}bodyreverselights`];
  if (prefix === 'g21') return { headlights, taillights, reverseLights };
  if (prefix === 'g24') {
    return {
      headlights,
      taillights,
      reverseLights,
      leftBlinkers: ['g24bodyfrontleftblinker', 'g24bodyrearleftblinker'],
      rightBlinkers: ['g24bodyfrontrightblinker', 'g24bodyrearrightblinker'],
    };
  }
  return {
    headlights,
    taillights,
    reverseLights,
    leftBlinkers: [`${prefix}bodyleftblinkers`],
    rightBlinkers: [`${prefix}bodyrightblinkers`],
  };
}

const QUATERNIUS_LIGHTS: VehicleLightsDef = {
  headlights: ['Headlights'],
  taillights: ['TailLights'],
};


/** One entry per body; the pack's scale, palette and wheel detection are shared. */
const SOVIET_CARS: readonly Entry[] = SOVIET_SPECS.map((spec) => ({
  id: spec.id,
  label: spec.label,
  dir: SOVIET,
  glb: spec.file,
  textureFile: `${SOVIET}/albedo.png`,
  lights: sovietLights(spec.file),
  detectWheels: true,
  bodyClass: 'car',
  storageCells: spec.storageCells,
  mass: spec.mass,
  engineId: spec.engineId,
  gearboxId: spec.gearboxId,
  tankLitres: spec.tankLitres,
  wheelGrip: spec.wheelGrip,
  // FBXLoader reports this pack in centimetres; the models are life-size.
  scale: 0.01,
  suspension: spec.suspension,
  steerLock: spec.steerLock,
  rearDriveBias: spec.rearDriveBias,
}));

const ENTRIES: readonly Entry[] = [
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
    storageCells: 2,
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
    storageCells: 2,
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
    storageCells: 2,
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
    suspension: SUSP_FASTBACK,
    steerLock: 0.58,
    rearDriveBias: 1,
  },
  {
    id: 'car_q_suv',
    storageCells: 4,
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
  // RgsDev Free Low Poly Vehicles Pack (CC-BY-4.0). 21 bodies in one GLB, each
  // extracted by `packNode`; flat colours, no textures, shared geometry.
  // -------------------------------------------------------------------------
  ...LOWPOLY_CARS,

  // -------------------------------------------------------------------------
  // Low Poly Soviet Car Pack. Fifteen FBX bodies, one per model, each carrying
  // its own wheels (found by shape) and taking its colour from the pack's shared
  // palette atlas. Life-size in centimetres, nose-first down +Z, 4-6k triangles.
  // -------------------------------------------------------------------------
  ...SOVIET_CARS,

  // -------------------------------------------------------------------------
  // Built in code (render/proceduralcars.ts). Same contract as any pack: a body
  // and four named wheels, drawn in metres, so they are measured and driven by
  // exactly the same path. Their scale is 1 because they are authored life-size.
  // -------------------------------------------------------------------------
  {
    id: 'proc_wedge',
    storageCells: 2,
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
    storageCells: 1,
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

function entryFile(entry: Entry): string {
  if (entry.procedural) return `procedural://${entry.procedural}`;
  if (!entry.dir || !entry.glb) {
    throw new Error(`Car catalogue entry "${entry.id}" has no model source`);
  }
  return `${entry.dir}/${entry.glb}`;
}

export const CAR_MODELS: readonly CarModelDef[] = ENTRIES.map((e) => ({
  id: e.id,
  label: e.label,
  file: entryFile(e),
  textureFile: e.textureFile,
  separateWheels: e.separateWheels,
  detectWheels: e.detectWheels,
  packNode: e.packNode,
  packWheelPrefix: e.packWheelPrefix,
  bodyClass: e.bodyClass,
  scale: e.scale ?? 1,
  yaw: e.yaw,
  mass: e.mass,
  engineId: e.engineId,
  gearboxId: e.gearboxId,
  tankLitres: e.tankLitres,
  wheelGrip: e.wheelGrip,
  suspension: e.suspension ?? SUSP_CAR,
  steerLock: e.steerLock,
  rearDriveBias: e.rearDriveBias,
  viewFrac: e.viewFrac ?? (e.bodyClass === 'car' ? VIEW_CAR : VIEW_CAB),
  lights: e.lights ?? (e.dir === QUATERNIUS ? QUATERNIUS_LIGHTS : undefined),
  gizmoAnchors: e.gizmoAnchors ?? ROAD_ANCHORS,
  spawnable: e.dir === QUATERNIUS || e.dir === SOVIET,
  storageCells: TRUNK_CELL_COUNT,
}));

/**
 * The only roadworthy model pool: Quaternius Realistic Car Pack and Low Poly
 * Soviet Car Pack. It feeds both the development spawn menu and the rare working
 * cars generated at POIs. `CAR_MODELS` remains the full static-wreck catalogue.
 */
export const SPAWNABLE_CAR_MODELS: readonly CarModelDef[] = CAR_MODELS.filter(
  (m) => m.spawnable,
);

/** Static wreck-only models, kept out of the roadworthy spawn pool by construction. */
export const WRECK_ONLY_CAR_MODELS: readonly CarModelDef[] = CAR_MODELS.filter(
  (model) => !model.spawnable,
);

const BY_ID = new Map(CAR_MODELS.map((m) => [m.id, m]));

/** The model a new game starts in and every fallback resolves to. */
export const DEFAULT_CAR_MODEL_ID = 'car_q_normal1';

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
