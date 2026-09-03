/**
 * The car catalogue: complete, authored 3D models.
 *
 * The old concept built a car out of attachable parts. That is gone. A car is now
 * ONE finished imported model whose geometry is authoritative:
 *
 *  - the chassis collider comes from the model's `body` bounding box,
 *  - suspension mounts come from its wheel nodes,
 *  - each wheel's radius comes from that wheel node's own bounds,
 *
 * all measured at load time in render/carmodel.ts. This catalogue holds geometry's
 * defaults: mass, gearbox, original engine, tank capacity, springs and steering.
 *
 * Every catalogue model is roadworthy. A wreck is a STATE a body is found in, not a
 * class of body: the same forty-six models supply the player's car, the working
 * cars generated at roadside stops, and the sunken shells scattered beside them.
 *
 * Free-form anchor parts remain cosmetic. The separate four-cell bonnet service
 * layout owns the removable engine, optional turbine, coolant tank and fuel tank.
 */

import type { BodyClass, EngineSpec, GearboxSpec, SuspensionTuning } from '../parts/registry';
import { variant } from '../parts/registry';
import { TRUNK_CELL_COUNT } from './trunk';

/**
 * The two vendored packs, each credited beside its models.
 *
 *  - SOVIET: Low Poly Soviet Car Pack. Fifteen FBX bodies in centimetres, each
 *    carrying its own wheels, colour taken from a shared 9x2 swatch atlas.
 *  - STYLIZED: Stylized Vehicles Pack. Thirty-one Unity FBX bodies, LOD0 only,
 *    with separate doors and wheels and colour taken from a 32x32 palette.
 */
const SOVIET = '/models/soviet';
const STYLIZED = '/models/stylized';

/**
 * The Stylized pack's palette, converted from the PSD it ships as (see
 * tools/psd-to-png.mjs — no browser decodes PSD). It is a 32x32 image of vertical
 * light-to-dark ramps: paint, glass, chrome, tyres, lamps and decals all live in
 * it, and a body's UVs pick shades out of it rather than carrying a texture.
 */
const STYLIZED_PALETTE = `${STYLIZED}/PixelColors.png`;

/**
 * The cabin cut out of the Stylized saloon, fitted to the Soviet shells. A four-seat
 * interior with a dash and a steering wheel, 734 triangles; see
 * tools/extract-interior.mjs for the cut.
 */
const STYLIZED_INTERIOR = {
  file: `${STYLIZED}/interior.glb`,
  textureFile: STYLIZED_PALETTE,
} as const;

/**
 * The pack's palette material, i.e. everything on a body that is not glass or a
 * lamp lens. It is the slot the renderer repaints and weathers.
 */
export const STYLIZED_PAINT_MATERIAL = 'PixelColors';

/** The pack's headlight material. Also the name the split lens mesh takes. */
const STYLIZED_HEADLIGHT_MATERIAL = 'Headlights';

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
 * Authored lamp selectors. A selector names either a mesh node or a material; the
 * loader lifts a named material's triangles into their own mesh (see
 * `isolateLampMaterials` in render/carmodel.ts), so a pack that draws its lamps as
 * material groups on one body mesh and a pack that models each lamp separately both
 * arrive as the separate, individually measurable lenses the beam mounts need.
 */
export interface VehicleLightsDef {
  readonly headlights: readonly string[];
  readonly taillights: readonly string[];
  readonly reverseLights?: readonly string[];
  readonly leftBlinkers?: readonly string[];
  readonly rightBlinkers?: readonly string[];
}

/**
 * The model's own node names for the four wheels the vehicle drives, when the pack
 * names them consistently. Naming them beats finding them by shape: the Stylized
 * pack's doors are near-circular discs TALLER than its wheels, so shape detection
 * mounts four doors as the running gear and the car drives on its own bodywork.
 *
 * A wheel may name several nodes for a body that draws one wheel as a hub plus a
 * tyre; they are detached together and spin as one.
 */
export interface WheelNodeNames {
  readonly wheel_fl: readonly string[];
  readonly wheel_fr: readonly string[];
  readonly wheel_rl: readonly string[];
  readonly wheel_rr: readonly string[];
}

/**
 * One colour's shades inside a pack's palette texture, as a block of texels.
 *
 * The Stylized pack paints by UV: a body's panels point at a column of a 32x32
 * palette holding that colour light-to-dark, and its glass, chrome, tyres, lamps
 * and decals point at other columns. Replacing the block — keeping each shade's
 * luminance relative to `keyRow` — repaints the coachwork and nothing else, which
 * is what lets one geometry file wear the catalogue's twelve factory colours.
 *
 * Rows are counted top-down, as the image is stored. Ramps are two columns wide
 * wherever the pack duplicated them (a door may sample either column), so the span
 * is authored rather than assumed.
 */
export interface PalettePaintRamp {
  readonly column: number;
  readonly columns: number;
  readonly row: number;
  readonly rows: number;
  /** The shade that reads as the car's colour; the others scale from its luminance. */
  readonly keyRow: number;
}


export interface CarModelDef {
  /** Stable id; appears in save files. */
  readonly id: string;
  readonly label: string;
  /** Model URL (.glb or .fbx), served from public/. */
  readonly file: string;
  /**
   * Base-colour texture URL, when the pack ships its palette separately from the
   * geometry. Both packs do, so the map is loaded once per pack and shared.
   */
  readonly textureFile?: string;
  /**
   * How this pack encodes body colour. Soviet bodies select a solid swatch from a
   * shared 9x2 atlas, replaced in the fragment shader; Stylized bodies sample a
   * light-to-dark ramp of a 32x32 palette, replaced by rebuilding that palette.
   */
  readonly paintStyle?: 'soviet-atlas' | 'stylized-palette';
  /** Original Soviet body-paint cell, in the FBX UV coordinate system. */
  readonly paintUvCell?: readonly [number, number];
  /** The Stylized palette block holding this body's coachwork colour. */
  readonly paintRamp?: PalettePaintRamp;
  /**
   * The window glass, which the two packs encode incompatibly.
   *
   * A Stylized body draws its windows as separate meshes sharing one authored
   * `Glass` material, so naming that material is enough. A Soviet body has no
   * window objects at all: its glass is a REGION OF ONE MESH whose UVs point at a
   * single atlas swatch, so the loader has to cut those triangles out before it can
   * make them see-through (`isolateGlass` in render/carmodel.ts).
   *
   * Set one or the other, never both.
   */
  readonly glassMaterial?: string;
  readonly glassUvCell?: readonly [number, number];
  /**
   * A cabin fitted to a body that has none of its own.
   *
   * The Soviet bodies are hollow shells: with the glass now see-through you look
   * straight through them. The Stylized pack bakes its seats, dash and floor into
   * the same mesh as the outer shell, so the cabin was cut out of a donor body
   * offline (tools/extract-interior.mjs) and is fitted here to each hollow body's
   * own measured box.
   */
  readonly interior?: {
    readonly file: string;
    /** The donor pack's palette, which the cut cabin still samples. */
    readonly textureFile: string;
  };
  /**
   * Visual-only body lift as a fraction of wheel radius. Suspension, collider,
   * centre of mass and wheel mounts remain unchanged.
   */
  readonly visualRideLiftWheelFraction?: number;
  /**
   * Set when the model carries its own wheels but under the modeller's names
   * (`Wheel_1`, `Cylinder006`, ...). The loader then finds the four discs by shape
   * and renames them to the convention.
   */
  readonly detectWheels?: boolean;
  /** Set instead of `detectWheels` when the pack names its wheels consistently. */
  readonly wheelNodes?: WheelNodeNames;
  /**
   * Nodes deleted at load because the game does not model what they are.
   *
   * The Stylized truck is a 6x4 tractor: a twin-axle rear bogie whose two wheel
   * pairs sit 1.6 m apart along Z. Ray-cast suspension drives four wheels, and a
   * wheel that never turns is worse on a moving vehicle than one that is not
   * there, so the middle axle goes and the truck runs as the 4x2 its physics is.
   */
  readonly unusedNodes?: readonly string[];
  readonly bodyClass: BodyClass;
  /** Uniform model-units-to-metres scale. */
  readonly scale: number;
  /**
   * Yaw applied to the imported model before it is measured, radians.
   *
   * The game drives toward +Z, so a model authored nose-first down -Z arrives
   * back to front: it drives in reverse, its driver looks out of the rear window and
   * its front axle steers from the rear. Nothing in a model file declares which end
   * the lights are on — a body is just a mesh — so this is authored per pack. Both
   * shipped packs are nose-first down +Z and set nothing.
   *
   * It is applied before measurement rather than at draw time on purpose. Every
   * derived quantity — the chassis box, which axle is the front one, the gizmo
   * anchors and the driver's eye — comes out of the measured geometry, so rotating
   * the geometry first is what keeps all of them agreeing with each other.
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
  /** Every car body carries the shared 4x2 trunk. */
  readonly storageCells: number;
}

/** Shared defaults; every entry below states only what makes it itself. */
type Entry = Omit<
  CarModelDef,
  'file' | 'scale' | 'suspension' | 'viewFrac' | 'lights' | 'gizmoAnchors' | 'storageCells'
> & {
  /** Model file name within the pack directory named by `dir`. */
  readonly glb: string;
  /** Directory containing `glb`. */
  readonly dir: string;
  readonly scale?: number;
  readonly suspension?: SuspensionTuning;
  readonly viewFrac?: readonly [number, number, number];
  readonly lights?: VehicleLightsDef;
  readonly gizmoAnchors?: readonly GizmoAnchorDef[];
  /** Legacy authored hint; the catalogue normalizer now gives every body eight cells. */
  readonly storageCells?: number;
};


/**
 * FALLBACK in-car eye, as fractions of the body box, for a body with no steering
 * wheel to sit behind.
 *
 * The in-car view is a real driver's eye now: `driverEyePoint` in
 * render/carmodel.ts derives it from the cabin's own steering wheel, which is the
 * one thing in a car whose position IS the driver's — it fixes the side, the
 * setback and the height, on all forty-six bodies, without a fraction being guessed
 * at anywhere.
 *
 * It used to be a HOOD camera riding on the nose, because these packs' windows were
 * opaque painted geometry and from inside the cabin the shell was a closed box. The
 * glass is see-through now (`isolateGlass`) and the hollow Soviet shells have a
 * fitted cabin, so the constraint that forced the eye onto the bonnet is gone.
 *
 * These fractions therefore only apply to a body that somehow has no wheel at all,
 * and they keep the nose placement for exactly that case: an eye dropped into the
 * middle of an empty shell sees nothing but its own roof.
 */
const VIEW_CAR: readonly [number, number, number] = [0, 0.78, 0.96];
/** A cab-forward truck has almost no bonnet: sit high, right at the front face. */
const VIEW_CAB: readonly [number, number, number] = [0, 0.9, 0.96];

/**
 * Low Poly Soviet Car Pack — fifteen bodies, one FBX each, and the only pack in
 * the catalogue that is about the same cars this game is already about.
 *
 * They needed no conversion and no simplification. Every one is 4.0k-5.8k triangles,
 * modelled in real-world proportions, nose-first
 * down +Z the way this game drives, and carrying its own four wheels as separate
 * meshes — so `detectWheels` finds them by shape and the whole pack lands on the
 * standard path. FBXLoader reports them in centimetres, hence `scale: 0.01`.
 *
 * Colour is UV, not material: each body's UVs point into a region of the pack's
 * shared `albedo.png` palette. The atlas is not one paint picture: it is eighteen
 * solid swatches carrying paint, glass, chrome, lamp and trim colours. The renderer
 * replaces only each body's paint swatch, leaving every functional colour intact.
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
  readonly visualRideLiftWheelFraction?: number;
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
    visualRideLiftWheelFraction: 1 / 6,
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

/**
 * Body-paint swatch used by each Soviet FBX. The shared atlas also carries glass,
 * chrome, lamps, tyres and interior colours; replacing the whole texture would tint
 * those parts too. Recolouring only this UV cell preserves the rest of the authored
 * palette and the rally car's decals.
 */
const SOVIET_PAINT_CELLS: Readonly<Record<string, readonly [number, number]>> = {
  'gz21.fbx': [8, 1],
  'gz24.fbx': [1, 0],
  'vz01.fbx': [0, 0],
  'vz02.fbx': [7, 0],
  // Measured, not authored: this body's coachwork samples (4, 0), and the (0, 1)
  // this used to name is the grey trim swatch — so recolouring it repainted the
  // bumpers and left the car its factory dark blue.
  'vz03.fbx': [4, 0],
  'vz04.fbx': [8, 1],
  'vz05.fbx': [1, 0],
  'vz05r.fbx': [7, 0],
  'vz06.fbx': [0, 0],
  'vz07.fbx': [2, 0],
  'vz08.fbx': [8, 1],
  'vz09.fbx': [4, 0],
  'vz099.fbx': [6, 0],
  'vz21.fbx': [7, 0],
  'vz31.fbx': [0, 0],
};

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

/**
 * The Stylized pack draws its lamps as material groups on the body mesh rather
 * than as separate objects, so every selector here is a MATERIAL name and the
 * loader lifts each one into its own mesh. The pack has no reversing lenses.
 */
function stylizedLights(blinkers: boolean): VehicleLightsDef {
  const lights: VehicleLightsDef = {
    headlights: [STYLIZED_HEADLIGHT_MATERIAL],
    taillights: ['BrakeLights'],
  };
  if (!blinkers) return lights;
  return { ...lights, leftBlinkers: ['TurnLight_L'], rightBlinkers: ['TurnLight_R'] };
}

/** One entry per body; the pack's scale, palette and wheel detection are shared. */
const SOVIET_CARS: readonly Entry[] = SOVIET_SPECS.map((spec) => ({
  id: spec.id,
  label: spec.label,
  dir: SOVIET,
  glb: spec.file,
  textureFile: `${SOVIET}/albedo.png`,
  // Every body in this pack draws its windows as a region of the one body mesh,
  // UV-mapped to the atlas's dark teal swatch. Measured on all fifteen.
  glassUvCell: [3, 1],
  // These bodies are hollow shells, and see-through glass is what makes that
  // obvious: a fitted cabin is what you look at through it.
  interior: STYLIZED_INTERIOR,
  lights: sovietLights(spec.file),
  detectWheels: true,
  bodyClass: 'car',
  storageCells: spec.storageCells,
  visualRideLiftWheelFraction: spec.visualRideLiftWheelFraction,
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

/**
 * Stylized Vehicles Pack — thirty-one Unity FBX bodies, the detailed LOD0 of each.
 *
 * The pack ships four levels of detail per vehicle and a merged "combined" variant.
 * LOD0 detailed is the one used, because it is the only variant whose doors, windows
 * and interior are separate objects: the doors have to stay addressable to be
 * openable, and the combined variant throws them away.
 *
 * They arrive already agreeing with this game's conventions — nose down +Z, +X to
 * the left, origin on the ground between the wheels — so no yaw is needed and the
 * measured geometry can be trusted directly. What they do NOT agree with is scale:
 * FBXLoader reports them in centimetres at roughly 1.43x life size (its saloon is
 * 6.57 m long on 0.88 m wheels), so the pack scale is 0.007 rather than 0.01. That
 * lands the saloon at 4.60 m on a 2.48 m wheelbase, a 1.52 m track and 0.62 m
 * wheels, and every other body in believable proportion to it.
 *
 * Two pack-wide traits need the loader's help, both handled from this table:
 *
 *  - WHEELS ARE NAMED, not shaped. `FL/FR/BL/BR` are consistent across all 31
 *    bodies, and shape detection actively fails here: a door is a near-circular
 *    disc TALLER than a wheel, so the four largest discs on a saloon are its doors.
 *  - LAMPS ARE MATERIALS, not meshes. Headlights, brake lights and both indicators
 *    are material groups of the body mesh, which the loader lifts into their own
 *    meshes so each lens can be measured and lit on its own.
 */
interface StylizedSpec {
  readonly id: string;
  readonly label: string;
  /** File stem; the pack's own model name, kept so the asset is traceable. */
  readonly file: string;
  readonly bodyClass?: BodyClass;
  readonly mass: number;
  readonly engineId: string;
  readonly gearboxId: string;
  readonly tankLitres: number;
  readonly wheelGrip: number;
  readonly steerLock: number;
  readonly rearDriveBias: number;
  readonly suspension?: SuspensionTuning;
  /** This body's coachwork ramp in the 32x32 palette. */
  readonly paint: PalettePaintRamp;
  /** Set for the three supercars the pack gave no indicator lenses. */
  readonly noBlinkers?: boolean;
  readonly visualRideLiftWheelFraction?: number;
  /** Nodes the game deletes rather than model; see `unusedNodes`. */
  readonly unusedNodes?: readonly string[];
  /** Rear wheel nodes, when they are not the usual `BL`/`BR`. */
  readonly rearWheelNodes?: readonly [string, string];
}

/** Palette block: first column, columns spanned, first row, rows, and key shade. */
function ramp(
  column: number,
  columns: number,
  row: number,
  rows: number,
  keyRow: number,
): PalettePaintRamp {
  return { column, columns, row, rows, keyRow };
}

/*
 * Every ramp below was measured, not guessed: each body was rendered from five
 * viewpoints with the palette cell index written out as colour, and the coachwork
 * ramp is the block those renders actually show. A UV-area histogram does not
 * answer this — these bodies carry more hidden interior and underside surface,
 * mapped to the palette's greys, than they carry visible paint.
 *
 * Figures are read off the shapes: the muscle coupes get the V8 and the firm
 * fastback springs, the utilities get four-wheel drive on truck springs, the vans
 * and the three lorries get diesels and the crashbox, and the supercars get the
 * highest grip in the catalogue.
 */
const STYLIZED_SPECS: readonly StylizedSpec[] = [
  // ---- Car1-5: coupes and muscle. Long bonnets, rear drive, firm. ----
  {
    id: 'st_muscle_fastback',
    label: 'muscle fastback',
    file: 'Car1',
    mass: 1520,
    engineId: 'engine_v8_5000',
    gearboxId: 'gearbox_manual4',
    tankLitres: 80,
    wheelGrip: 1.05,
    steerLock: 0.55,
    rearDriveBias: 1,
    suspension: SUSP_FASTBACK,
    paint: ramp(0, 2, 0, 12, 6),
  },
  {
    id: 'st_muscle_coupe',
    label: 'muscle coupe',
    file: 'Car2',
    mass: 1450,
    engineId: 'engine_v8_5000',
    gearboxId: 'gearbox_manual4',
    tankLitres: 75,
    wheelGrip: 1.06,
    steerLock: 0.56,
    rearDriveBias: 1,
    suspension: SUSP_FASTBACK,
    paint: ramp(5, 2, 0, 15, 5),
  },
  {
    id: 'st_skyline_coupe',
    label: 'hardtop coupe',
    file: 'Car3',
    mass: 1180,
    engineId: 'engine_i6_2800',
    gearboxId: 'gearbox_manual5',
    tankLitres: 65,
    wheelGrip: 1.04,
    steerLock: 0.58,
    rearDriveBias: 1,
    suspension: SUSP_SPORT,
    paint: ramp(7, 2, 16, 15, 22),
  },
  {
    id: 'st_fastback_six',
    label: 'straight-six fastback',
    file: 'Car4',
    mass: 1080,
    engineId: 'engine_i6_2800',
    gearboxId: 'gearbox_manual5',
    tankLitres: 60,
    wheelGrip: 1.08,
    steerLock: 0.6,
    rearDriveBias: 1,
    suspension: SUSP_SPORT,
    paint: ramp(12, 2, 16, 15, 21),
  },
  {
    // Boxy 80s rally homologation coupe: four-wheel drive is the whole point of it.
    id: 'st_quattro_coupe',
    label: 'rally coupe',
    file: 'Car5',
    mass: 1250,
    engineId: 'engine_i6_2800',
    gearboxId: 'gearbox_manual5',
    tankLitres: 70,
    wheelGrip: 1.12,
    steerLock: 0.58,
    rearDriveBias: 0.5,
    suspension: SUSP_SPORT,
    paint: ramp(3, 2, 0, 32, 8),
  },

  // ---- Jeep1-5: utilities. 4WD, truck springs, a visual lift on the short ones. ----
  {
    id: 'st_open_jeep',
    label: 'open jeep',
    file: 'Jeep1',
    mass: 1180,
    engineId: 'engine_i4_1600',
    gearboxId: 'gearbox_manual4',
    tankLitres: 55,
    wheelGrip: 0.95,
    steerLock: 0.66,
    rearDriveBias: 0.5,
    suspension: SUSP_TRUCK,
    paint: ramp(14, 2, 16, 10, 18),
    visualRideLiftWheelFraction: 1 / 6,
  },
  {
    id: 'st_v8_pickup',
    label: 'V8 pickup',
    file: 'Jeep2',
    mass: 1780,
    engineId: 'engine_v8_5000',
    gearboxId: 'gearbox_manual4',
    tankLitres: 80,
    wheelGrip: 1.0,
    steerLock: 0.58,
    rearDriveBias: 0.5,
    suspension: SUSP_TRUCK,
    paint: ramp(18, 2, 16, 16, 18),
    visualRideLiftWheelFraction: 1 / 6,
  },
  {
    id: 'st_short_landie',
    label: 'short off-roader',
    file: 'Jeep3',
    mass: 1720,
    engineId: 'engine_d4_2000',
    gearboxId: 'gearbox_manual4',
    tankLitres: 75,
    wheelGrip: 0.98,
    steerLock: 0.6,
    rearDriveBias: 0.5,
    suspension: SUSP_TRUCK,
    paint: ramp(20, 2, 20, 9, 25),
    visualRideLiftWheelFraction: 1 / 6,
  },
  {
    id: 'st_wagon_4x4',
    label: '4x4 estate',
    file: 'Jeep4',
    mass: 1690,
    engineId: 'engine_d4_2000',
    gearboxId: 'gearbox_manual5',
    tankLitres: 80,
    wheelGrip: 1.0,
    steerLock: 0.58,
    rearDriveBias: 0.5,
    suspension: SUSP_TRUCK,
    paint: ramp(22, 2, 16, 16, 18),
  },
  {
    id: 'st_kei_4x4',
    label: 'small 4x4',
    file: 'Jeep5',
    mass: 1050,
    engineId: 'engine_i4_1600',
    gearboxId: 'gearbox_manual5',
    tankLitres: 40,
    wheelGrip: 0.94,
    steerLock: 0.64,
    rearDriveBias: 0.5,
    suspension: SUSP_TRUCK,
    paint: ramp(24, 2, 16, 16, 16),
    visualRideLiftWheelFraction: 1 / 6,
  },

  // ---- MicroBus1-5: vans. Cab-forward, so the driver's eye sits at the screen. ----
  {
    // Rear-engined, rear-drive and softly sprung, like the bus it is drawn from.
    id: 'st_split_bus',
    label: 'split-screen bus',
    file: 'MicroBus1',
    bodyClass: 'bus',
    mass: 1320,
    engineId: 'engine_i4_1600',
    gearboxId: 'gearbox_manual4',
    tankLitres: 60,
    wheelGrip: 0.9,
    steerLock: 0.6,
    rearDriveBias: 1,
    suspension: SUSP_SOFT,
    paint: ramp(26, 2, 16, 16, 18),
  },
  {
    id: 'st_transporter',
    label: 'transporter van',
    file: 'MicroBus2',
    bodyClass: 'bus',
    mass: 1620,
    engineId: 'engine_d4_2000',
    gearboxId: 'gearbox_manual5',
    tankLitres: 70,
    wheelGrip: 0.94,
    steerLock: 0.58,
    rearDriveBias: 0,
    paint: ramp(28, 2, 16, 16, 17),
  },
  {
    id: 'st_cabover_van',
    label: 'cab-over van',
    file: 'MicroBus3',
    bodyClass: 'bus',
    mass: 1480,
    engineId: 'engine_i4_1600',
    gearboxId: 'gearbox_manual4',
    tankLitres: 60,
    wheelGrip: 0.9,
    steerLock: 0.62,
    rearDriveBias: 1,
    suspension: SUSP_TRUCK,
    paint: ramp(28, 2, 0, 11, 0),
  },
  {
    id: 'st_panel_van',
    label: 'panel van',
    file: 'MicroBus4',
    bodyClass: 'bus',
    mass: 1540,
    engineId: 'engine_d4_2000',
    gearboxId: 'gearbox_manual5',
    tankLitres: 65,
    wheelGrip: 0.92,
    steerLock: 0.6,
    rearDriveBias: 1,
    suspension: SUSP_TRUCK,
    paint: ramp(27, 1, 0, 14, 0),
  },
  {
    id: 'st_shag_van',
    label: 'custom van',
    file: 'MicroBus5',
    bodyClass: 'bus',
    mass: 1900,
    engineId: 'engine_v8_5000',
    gearboxId: 'gearbox_auto3',
    tankLitres: 90,
    wheelGrip: 0.95,
    steerLock: 0.56,
    rearDriveBias: 1,
    suspension: SUSP_TRUCK,
    paint: ramp(30, 2, 0, 16, 5),
  },

  // ---- Sedan1-5: the everyday cars. ----
  {
    id: 'st_big_saloon',
    label: 'big saloon',
    file: 'Sedan1',
    mass: 1420,
    engineId: 'engine_i6_2800',
    gearboxId: 'gearbox_auto3',
    tankLitres: 65,
    wheelGrip: 0.96,
    steerLock: 0.56,
    rearDriveBias: 1,
    suspension: SUSP_SOFT,
    paint: ramp(24, 2, 0, 16, 4),
  },
  {
    id: 'st_estate',
    label: 'family estate',
    file: 'Sedan2',
    mass: 1360,
    engineId: 'engine_i4_1600',
    gearboxId: 'gearbox_manual5',
    tankLitres: 60,
    wheelGrip: 0.96,
    steerLock: 0.58,
    rearDriveBias: 0,
    paint: ramp(3, 2, 0, 32, 10),
  },
  {
    id: 'st_compact_saloon',
    label: 'compact saloon',
    file: 'Sedan3',
    mass: 1300,
    engineId: 'engine_i4_2445',
    gearboxId: 'gearbox_manual5',
    tankLitres: 70,
    wheelGrip: 1.0,
    steerLock: 0.58,
    rearDriveBias: 1,
    paint: ramp(22, 2, 0, 16, 4),
  },
  {
    id: 'st_repmobile',
    label: 'rep saloon',
    file: 'Sedan4',
    mass: 1280,
    engineId: 'engine_i4_1600',
    gearboxId: 'gearbox_manual5',
    tankLitres: 62,
    wheelGrip: 0.98,
    steerLock: 0.6,
    rearDriveBias: 0,
    paint: ramp(20, 2, 0, 16, 4),
  },
  {
    id: 'st_sport_touring',
    label: 'sport touring',
    file: 'Sedan5',
    mass: 1240,
    engineId: 'engine_i6_2800',
    gearboxId: 'gearbox_manual5',
    tankLitres: 65,
    wheelGrip: 1.02,
    steerLock: 0.58,
    rearDriveBias: 1,
    suspension: SUSP_SPORT,
    paint: ramp(18, 2, 0, 16, 5),
  },

  // ---- SpecialCar1-5: service vehicles. Two saloons, an ambulance, a bullion
  // van and a fire engine. The three big ones are lorries: diesel, crashbox and
  // truck springs, with the cab-forward driving position that comes with bodyClass.
  {
    id: 'st_patrol_car',
    label: 'patrol car',
    file: 'SpecialCar1',
    mass: 1680,
    engineId: 'engine_v8_5000',
    gearboxId: 'gearbox_auto3',
    tankLitres: 75,
    wheelGrip: 1.06,
    steerLock: 0.58,
    rearDriveBias: 1,
    suspension: SUSP_SPORT,
    paint: ramp(3, 2, 0, 32, 27),
  },
  {
    id: 'st_city_taxi',
    label: 'city taxi',
    file: 'SpecialCar2',
    mass: 1560,
    engineId: 'engine_i6_2800',
    gearboxId: 'gearbox_auto3',
    tankLitres: 70,
    wheelGrip: 0.96,
    steerLock: 0.58,
    rearDriveBias: 1,
    suspension: SUSP_SOFT,
    paint: ramp(16, 2, 0, 8, 3),
  },
  {
    id: 'st_ambulance',
    label: 'ambulance',
    file: 'SpecialCar3',
    bodyClass: 'truck',
    mass: 3400,
    engineId: 'engine_d4_2000',
    gearboxId: 'gearbox_manual5',
    tankLitres: 90,
    wheelGrip: 0.92,
    steerLock: 0.52,
    rearDriveBias: 1,
    suspension: SUSP_TRUCK,
    paint: ramp(0, 2, 16, 14, 20),
  },
  {
    id: 'st_bullion_van',
    label: 'bullion van',
    file: 'SpecialCar4',
    bodyClass: 'truck',
    mass: 4600,
    engineId: 'engine_d6_6600',
    gearboxId: 'gearbox_truck6',
    tankLitres: 120,
    wheelGrip: 0.9,
    steerLock: 0.52,
    rearDriveBias: 1,
    suspension: SUSP_TRUCK,
    paint: ramp(3, 2, 0, 32, 11),
  },
  {
    id: 'st_fire_engine',
    label: 'fire engine',
    file: 'SpecialCar5',
    bodyClass: 'truck',
    mass: 11000,
    engineId: 'engine_d6_6600',
    gearboxId: 'gearbox_truck6',
    tankLitres: 240,
    wheelGrip: 0.88,
    steerLock: 0.48,
    rearDriveBias: 1,
    suspension: SUSP_TRUCK,
    paint: ramp(3, 2, 0, 32, 2),
  },

  // ---- SportCar1-5: the supercars. Highest grip here; the first three were
  // drawn without indicator lenses, which `noBlinkers` states rather than lets
  // the lamp binder discover as a missing selector.
  {
    id: 'st_mid_engine_v8',
    label: 'mid-engined V8',
    file: 'SportCar1',
    mass: 1620,
    engineId: 'engine_v8_5000',
    gearboxId: 'gearbox_manual5',
    tankLitres: 80,
    wheelGrip: 1.25,
    steerLock: 0.54,
    rearDriveBias: 0.5,
    suspension: SUSP_FASTBACK,
    paint: ramp(16, 2, 8, 6, 11),
    noBlinkers: true,
  },
  {
    id: 'st_hypercar',
    label: 'hypercar',
    file: 'SportCar2',
    mass: 1900,
    engineId: 'engine_v8_5000',
    gearboxId: 'gearbox_manual5',
    tankLitres: 100,
    wheelGrip: 1.28,
    steerLock: 0.52,
    rearDriveBias: 0.5,
    suspension: SUSP_FASTBACK,
    paint: ramp(14, 2, 0, 5, 2),
    noBlinkers: true,
  },
  {
    id: 'st_wedge_sports',
    label: 'wedge sports',
    file: 'SportCar3',
    mass: 1540,
    engineId: 'engine_i6_2800',
    gearboxId: 'gearbox_manual5',
    tankLitres: 60,
    wheelGrip: 1.2,
    steerLock: 0.56,
    rearDriveBias: 0.5,
    suspension: SUSP_SPORT,
    paint: ramp(3, 2, 0, 32, 13),
    noBlinkers: true,
  },
  {
    id: 'st_rear_engine_sports',
    label: 'rear-engined sports',
    file: 'SportCar4',
    mass: 1320,
    engineId: 'engine_i6_2800',
    gearboxId: 'gearbox_manual5',
    tankLitres: 65,
    wheelGrip: 1.22,
    steerLock: 0.56,
    rearDriveBias: 1,
    suspension: SUSP_FASTBACK,
    paint: ramp(16, 2, 0, 8, 3),
  },
  {
    id: 'st_turbo_coupe',
    label: 'turbo coupe',
    file: 'SportCar5',
    mass: 1450,
    engineId: 'engine_i6_2800',
    gearboxId: 'gearbox_manual5',
    tankLitres: 70,
    wheelGrip: 1.18,
    steerLock: 0.56,
    rearDriveBias: 1,
    suspension: SUSP_SPORT,
    paint: ramp(0, 2, 16, 14, 20),
  },

  {
    // 6x4 tractor unit. Its middle axle is deleted and the rearmost pair drives,
    // which puts the wheelbase at 3.47 m and leaves no wheel standing still.
    id: 'st_tractor_unit',
    label: 'tractor unit',
    file: 'Truck1',
    bodyClass: 'truck',
    mass: 7800,
    engineId: 'engine_d6_6600',
    gearboxId: 'gearbox_truck6',
    tankLitres: 300,
    wheelGrip: 0.94,
    steerLock: 0.46,
    rearDriveBias: 1,
    suspension: SUSP_TRUCK,
    paint: ramp(12, 2, 8, 8, 9),
    unusedNodes: ['BL', 'BR'],
    rearWheelNodes: ['BL2', 'BR2'],
  },
];

/** One entry per body; scale, palette, wheel naming and lamp materials are shared. */
const STYLIZED_CARS: readonly Entry[] = STYLIZED_SPECS.map((spec) => {
  const [rl, rr] = spec.rearWheelNodes ?? (['BL', 'BR'] as const);
  return {
    id: spec.id,
    label: spec.label,
    dir: STYLIZED,
    glb: `${spec.file}.fbx`,
    textureFile: STYLIZED_PALETTE,
    paintStyle: 'stylized-palette',
    glassMaterial: 'Glass',
    paintRamp: spec.paint,
    lights: stylizedLights(spec.noBlinkers !== true),
    wheelNodes: {
      wheel_fl: ['FL'],
      wheel_fr: ['FR'],
      wheel_rl: [rl],
      wheel_rr: [rr],
    },
    unusedNodes: spec.unusedNodes,
    bodyClass: spec.bodyClass ?? 'car',
    visualRideLiftWheelFraction: spec.visualRideLiftWheelFraction,
    mass: spec.mass,
    engineId: spec.engineId,
    gearboxId: spec.gearboxId,
    tankLitres: spec.tankLitres,
    wheelGrip: spec.wheelGrip,
    // Centimetres at about 1.43x life size; 0.007 puts the saloon at 4.6 m.
    scale: 0.007,
    suspension: spec.suspension,
    steerLock: spec.steerLock,
    rearDriveBias: spec.rearDriveBias,
  } satisfies Entry;
});

const ENTRIES: readonly Entry[] = [
  // -------------------------------------------------------------------------
  // Low Poly Soviet Car Pack. Fifteen FBX bodies, one per model, each carrying
  // its own wheels (found by shape) and taking its colour from the pack's shared
  // palette atlas. Life-size in centimetres, nose-first down +Z, 4-6k triangles.
  // -------------------------------------------------------------------------
  ...SOVIET_CARS,

  // -------------------------------------------------------------------------
  // Stylized Vehicles Pack. Thirty-one Unity FBX bodies at detailed LOD0, each
  // with named wheels, separate doors and windows, and lamps drawn as material
  // groups the loader lifts into their own lenses.
  // -------------------------------------------------------------------------
  ...STYLIZED_CARS,
];

export const CAR_MODELS: readonly CarModelDef[] = ENTRIES.map((e) => ({
  id: e.id,
  label: e.label,
  file: `${e.dir}/${e.glb}`,
  textureFile: e.textureFile,
  paintStyle: e.paintStyle ?? (e.dir === SOVIET ? 'soviet-atlas' : undefined),
  paintUvCell: e.dir === SOVIET ? SOVIET_PAINT_CELLS[e.glb] : undefined,
  paintRamp: e.paintRamp,
  glassMaterial: e.glassMaterial,
  glassUvCell: e.glassUvCell,
  interior: e.interior,
  visualRideLiftWheelFraction: e.visualRideLiftWheelFraction,
  detectWheels: e.detectWheels,
  wheelNodes: e.wheelNodes,
  unusedNodes: e.unusedNodes,
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
  lights: e.lights,
  gizmoAnchors: e.gizmoAnchors ?? ROAD_ANCHORS,
  storageCells: TRUNK_CELL_COUNT,
}));

const BY_ID = new Map(CAR_MODELS.map((m) => [m.id, m]));

/**
 * The model a new game starts in and every unknown saved id resolves to. The
 * Zhiguli: the cheapest, softest, most ordinary thing in the catalogue, and the
 * one car this game is most about.
 */
export const DEFAULT_CAR_MODEL_ID = 'sv_vaz2101';

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
