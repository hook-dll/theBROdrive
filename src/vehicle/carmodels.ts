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
 * layout owns the removable engine, optional turbine, radiator and fuel tank.
 */

import type { BodyClass, EngineSpec, GearboxSpec, SuspensionTuning } from '../parts/registry';
import { variant } from '../parts/registry';
import { TRUNK_CELL_COUNT } from './trunk';

/**
 * The two vendored packs, each credited beside its models.
 *
 *  - SOVIET: Low Poly Soviet Car Pack. Fifteen FBX bodies in centimetres, each
 *    carrying its own wheels, colour taken from a shared 9x2 swatch atlas.
 *  - SAAS: private GTA SA mod conversions, normalized offline into texture-free
 *    GLBs with six runtime material roles and explicit wheel, hub and lamp nodes.
 */
const SOVIET = '/models/soviet';
const SAAS = '/models/saas';

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

/* ---- the Soviet families ----
 *
 * One SOFT preset used to carry eleven cars, which is why they all rode the same:
 * a Volga on leaf springs and 15-inch balloon tyres, a Fiat-derived Zhiguli, a
 * MacPherson-strut Samara from 1984 and a long-travel Niva are four different
 * chassis, and the ride frequency is where that difference lives.
 *
 * Every figure below is what the real suspension measures, and the ladder is the
 * real one: the Volga is the softest thing in the catalogue, the Zhigulis sit at
 * the period saloon norm, the payload-sprung estates ring hard at the back, the
 * Samara is a decade newer and firmer at both ends, and the Niva trades frequency
 * for travel rather than for softness.
 */

/*
 * `Vehicle.rebuild` adds one sixth of the measured wheel radius to the catalogue's
 * clearance before placing the contact plane. The Soviet numbers below are
 * therefore BASE clearances, already reduced by that measured lift: the suspension
 * probe then reads the real 190/174/165/170/150/220/205 mm under the body. Writing
 * those real figures directly made every car sit 50-63 mm too high.
 */

/**
 * GAZ-21: 0.95 Hz front on 240 mm of sag, a LEAF-sprung rear at 1.15 Hz, and
 * lever-arm dampers that were marginal when new (0.18/0.30 of critical). It floats,
 * takes a set slowly and keeps moving after the road has stopped — and that motion
 * IS the load transfer, which is what makes its breakaway progressive and its
 * cornering limit low. 190 mm of clearance, because it was built for Soviet roads.
 */
const SUSP_VOLGA_21: SuspensionTuning = {
  frontHz: 0.95,
  rearHz: 1.15,
  compressionRatio: 0.18,
  reboundRatio: 0.3,
  bumpTravel: 0.1,
  rideHeight: 0.127,
};

/** GAZ-24: the same layout fifteen years later, with dampers that work. */
const SUSP_VOLGA_24: SuspensionTuning = {
  frontHz: 1.0,
  rearHz: 1.22,
  compressionRatio: 0.2,
  reboundRatio: 0.34,
  bumpTravel: 0.1,
  rideHeight: 0.112,
};

/**
 * The Zhiguli saloons. Coils at both ends, a live rear axle on four links and a
 * Panhard rod: a 1966 Fiat chassis, so FIRMER and better damped than anything else
 * the USSR built in the sixties — 1.10 Hz front, 1.28 rear, and the flat-ride
 * relationship between them that keeps it from pitching.
 */
const SUSP_ZHIGULI: SuspensionTuning = {
  frontHz: 1.1,
  rearHz: 1.28,
  compressionRatio: 0.24,
  reboundRatio: 0.38,
  bumpTravel: 0.095,
  rideHeight: 0.114,
};

/**
 * The 2102/2104 estates: rear springs rated for 430 kg of cargo that is not in the
 * back, so the tail rings at 1.55 Hz against the front's 1.10. Empty, it skips over
 * sharp bumps and steps out on a rough bend — the same mechanism as the empty
 * pickup, on a car that looks like a saloon.
 */
const SUSP_ZHIGULI_ESTATE: SuspensionTuning = {
  frontHz: 1.1,
  rearHz: 1.55,
  compressionRatio: 0.24,
  reboundRatio: 0.4,
  bumpTravel: 0.09,
  rideHeight: 0.12,
};

/**
 * Samara: MacPherson struts in front, a trailing-arm torsion beam behind, and the
 * first Soviet car with dampers matched to its springs. 1.30/1.55 Hz and 0.28/0.42
 * of critical — firm for the pack, ordinary for 1984, and the reason it turns in
 * instead of leaning first.
 */
const SUSP_SAMARA: SuspensionTuning = {
  frontHz: 1.3,
  rearHz: 1.55,
  compressionRatio: 0.28,
  reboundRatio: 0.42,
  bumpTravel: 0.085,
  rideHeight: 0.096,
};

/**
 * Niva: coils on all four corners with 200 mm of wheel travel and 220 mm under the
 * floor. It is NOT a leaf-sprung truck — that was the old tuning's mistake, and it
 * gave the car a 1.85 Hz rear that hopped. A Niva's rear rings barely faster than
 * its front (1.20 against 1.15) and pays for its ground clearance in TRAVEL, which
 * is what lets it keep four tyres on a surface a saloon skates over.
 */
const SUSP_NIVA: SuspensionTuning = {
  frontHz: 1.15,
  rearHz: 1.2,
  compressionRatio: 0.24,
  reboundRatio: 0.4,
  bumpTravel: 0.14,
  rideHeight: 0.158,
};

/**
 * The rally 2105: uprated springs, gas dampers, long travel and 5 cm of extra
 * stance, because a rally car is raised, not lowered. 1.55/1.75 Hz.
 */
const SUSP_LADA_RALLY: SuspensionTuning = {
  frontHz: 1.55,
  rearHz: 1.75,
  compressionRatio: 0.32,
  reboundRatio: 0.48,
  bumpTravel: 0.12,
  rideHeight: 0.152,
};

/**
 * SOFT: the rear-engined vans and buses, which are sprung for a load they are not
 * carrying at the wrong end of the car. The least damped preset in the catalogue,
 * so the body leans, wallows and takes its set slowly.
 *
 * It used to carry the entire Soviet pack as well. It no longer does: those cars
 * have their own families above, because a leaf-sprung Volga, a Fiat-derived
 * Zhiguli, a strut-front Samara and a long-travel Niva were never one spring rate.
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
 * `frontWeightShare` overrides those defaults for bodies whose engine is not over
 * the axle the drive bias implies. Drive bias cannot distinguish a front-engine
 * RWD car from a rear-engine one, and treating both as 53% front makes the latter
 * rotate around an axle it does not actually load.
 */
export function frontWeightFraction(model: {
  readonly rearDriveBias: number;
  readonly bodyClass: BodyClass;
  readonly frontWeightShare?: number;
}): number {
  if (model.frontWeightShare !== undefined) return model.frontWeightShare;
  if (model.bodyClass === 'truck' || model.bodyClass === 'bus') return 0.57;
  // Drive bias is the fallback layout: 0 is transverse front-drive, 1 is a front
  // engine driving the back axle, and a half is four-wheel drive.
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
 * Authored lamp selectors. A selector names a mesh node or material carrying one
 * independently controlled lamp channel. Normalized models provide those meshes
 * directly, so their bounds locate the light source without inspecting triangles
 * or treating an entire body as one lens.
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
 * names them consistently. Naming them beats finding them by shape: a normalized
 * GTA SA body draws each wheel as a tyre plus a separate hub island, and shape
 * detection would mount the tyres alone and leave the hubs standing in the body.
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

/** Mechanical era shared by cars with the same steering and tyre construction. */
export type HandlingProfile = 'classic' | 'road' | 'sport' | 'utility';


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
   * shared 9x2 atlas, replaced in the fragment shader; the GTA SA conversions ship
   * flat runtime materials whose paint slots are recoloured outright.
   */
  readonly paintStyle?: 'soviet-atlas' | 'solid-paint';
  /** Original Soviet body-paint cell, in the FBX UV coordinate system. */
  readonly paintUvCell?: readonly [number, number];
  /**
   * The window glass, which the two packs encode incompatibly.
   *
   * A normalized GTA SA body draws its windows as separate meshes sharing one
   * authored `car_glass` material, so naming that material is enough. A Soviet body
   * has no window objects at all: its glass is a REGION OF ONE MESH whose UVs point
   * at a single atlas swatch, so the loader cuts those triangles out into their own
   * mesh (`isolateGlass` in render/carmodel.ts).
   *
   * Set one or the other, never both.
   */
  readonly glassMaterial?: string;
  readonly glassUvCell?: readonly [number, number];
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
  readonly bodyClass: BodyClass;
  /** Uniform model-units-to-metres scale. */
  readonly scale: number;
  /**
   * Yaw applied to the imported model before it is measured, radians.
   *
   * The game drives toward +Z, so a model authored nose-first down -Z arrives
   * back to front: it drives in reverse and its front axle steers from the rear.
   * Nothing in a model file declares which end the lights are on — a body is just a
   * mesh — so this is authored per pack. Both shipped packs are nose-first down +Z
   * and set nothing.
   *
   * It is applied before measurement rather than at draw time on purpose. Every
   * derived quantity — the chassis box, which axle is the front one and the gizmo
   * anchors — comes out of the measured geometry, so rotating the geometry first is
   * what keeps all of them agreeing with each other.
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
  /**
   * Longitudinal-only tyre-compound multiplier. Defaults to 1; a value above one
   * gives a competition tyre more drive/brake authority without pretending its
   * period lateral construction can pull the same coefficient.
   */
  readonly longitudinalGripScale?: number;
  readonly suspension: SuspensionTuning;
  /** Steering lock at the front axle, radians. */
  readonly steerLock: number;
  /** Fraction of drive torque to the rear axle. 1 = RWD, 0 = FWD, 0.5 = 4WD. */
  readonly rearDriveBias: number;
  /**
   * Steering, tyre and driveline character. `classic` preserves the Soviet model;
   * later radial-tyred cars and working vehicles use their own mechanisms.
   */
  readonly handlingProfile: HandlingProfile;
  /** Static share of kerb weight carried by the front axle, when layout needs an override. */
  readonly frontWeightShare?: number;
  /**
   * The body's drag area, Cd·A in m². Authored where the real car's is known; a
   * body that omits it falls back to one shared Cd over its measured box, which
   * only lands for a mid-seventies saloon shape (see `Vehicle`'s constructor).
   */
  readonly dragArea?: number;
  /** Authored lenses whose per-instance materials mirror the vehicle's live controls. */
  readonly lights?: VehicleLightsDef;
  readonly gizmoAnchors: readonly GizmoAnchorDef[];
  /** Every car body carries the shared 4x2 trunk. */
  readonly storageCells: number;
}

/** Shared defaults; every entry below states only what makes it itself. */
type Entry = Omit<
  CarModelDef,
  'file' | 'scale' | 'suspension' | 'lights' | 'gizmoAnchors' | 'storageCells' | 'handlingProfile'
> & {
  /** Model file name within the pack directory named by `dir`. */
  readonly glb: string;
  /** Directory containing `glb`. */
  readonly dir: string;
  readonly scale?: number;
  readonly suspension?: SuspensionTuning;
  readonly handlingProfile?: HandlingProfile;
  readonly lights?: VehicleLightsDef;
  readonly gizmoAnchors?: readonly GizmoAnchorDef[];
  /** Legacy authored hint; the catalogue normalizer now gives every body eight cells. */
  readonly storageCells?: number;
};



/**
 * Low Poly Soviet Car Pack — fifteen bodies, one FBX each, and the only pack in
 * the catalogue that is about the same cars this game is already about.
 *
 * They needed no conversion and no simplification. Every one is 4.0k-5.8k triangles,
 * modelled in real-world proportions, nose-first
 * down +Z the way this game drives, and carrying its own four wheels as separate
 * meshes — so `detectWheels` finds them by shape and the whole pack lands on the
 * standard path. FBXLoader reports them in centimetres.
 *
 * Colour is UV, not material: each body's UVs point into a region of the pack's
 * shared `albedo.png` palette. The atlas is not one paint picture: it is eighteen
 * solid swatches carrying paint, glass, chrome, lamp and trim colours. The renderer
 * replaces only each body's paint swatch, leaving every functional colour intact.
 *
 * ---- life-size, per body ----
 *
 * The pack is NOT uniformly scaled: at the flat 0.01 the whole pack used to share,
 * a Zhiguli measured a 2.29 m wheelbase against the real 2.424, while the GAZ-24 and
 * both Nivas came out oversize (2.93 against 2.80, 2.28 against 2.20). So each body
 * carries its own `scale`, set from the real car's WHEELBASE, because that is the
 * dimension every handling quantity is measured against: turn radius, load transfer,
 * pitch lever and the axle positions the springs are rated at. Length then lands
 * within 3% and rolling radius within a few percent for every body except the
 * Samaras, whose wheels are drawn 8% oversize relative to their own bodies.
 *
 * What uniform scale CANNOT fix is track width: the modeller drew the Volgas too
 * wide (1.63 m against 1.41 real) and the Zhigulis too narrow (1.29 against 1.35),
 * and squashing a body on one axis to correct it would be visible. The consequence
 * is honest and small: the Volgas resist roll slightly more than they should and the
 * Zhigulis slightly less. It is not compensated for in the springs, because a spring
 * rate is not a place to hide a geometry error.
 *
 * ---- everything else is the real car's ----
 *
 * Engines, gearboxes and final drives are the factory's, from the pack's own Soviet
 * driveline table (parts/registry.ts). Masses are kerb masses, weight distribution
 * is the factory axle split, `dragArea` is the body's real Cd·A, steering lock is
 * derived from the published turning circle at each body's own measured wheelbase,
 * and the grip ladder is what period tyres actually pull (see the note above the
 * table).
 */
interface SovietSpec {
  readonly id: string;
  readonly label: string;
  readonly file: string;
  /** Model-units-to-metres, set from the real car's wheelbase. See the note above. */
  readonly scale: number;
  /** Kerb mass, kg, as delivered. */
  readonly mass: number;
  readonly engineId: string;
  readonly gearboxId: string;
  readonly tankLitres: number;
  readonly wheelGrip: number;
  readonly longitudinalGripScale?: number;
  readonly steerLock: number;
  readonly rearDriveBias: number;
  readonly handlingProfile?: HandlingProfile;
  /** Factory front-axle share of the kerb mass. */
  readonly frontWeightShare: number;
  /** The real body's drag area, Cd·A in m². */
  readonly dragArea: number;
  readonly suspension: SuspensionTuning;
  readonly storageCells?: number;
  readonly visualRideLiftWheelFraction?: number;
}


/*
 * ---- the grip ladder, and why it sits so far below 1.0 ----
 *
 * `wheelGrip` multiplies the profile's lateral coefficient and the longitudinal
 * one together, so it is the tyre — and these are period Soviet tyres. What the
 * real cars pull on dry asphalt, and what each figure below is calibrated to:
 *
 *   GAZ-21, 6.70-15 cross-ply          0.62 g   a tall, soft, hot-running carcass
 *   GAZ-24, 7.35-14                    0.66 g
 *   Zhiguli, 155/165-80R13 radial      0.70 g   Fiat-era radials, narrow
 *   later classics, 165/80R13          0.72 g
 *   Samara, 165/70R13                  0.78 g   a lower profile and a wider rim
 *   Niva, 175/80R16 all-terrain        0.66 g   soft block tread, tall sidewall
 *   rally 2105                         0.85 g   the only one built to corner
 *
 * The old ladder ran 0.88-1.04, which measured 0.89-1.04 g on the bench: a 1956
 * Volga cornering like a modern hatchback, and — because the same number sets the
 * brake capacity — stopping from 100 km/h in 51 m on drums. The figures below put
 * the Volga's stop back around 60 m, which is what a period test recorded.
 *
 * The ORDER is unchanged and it still runs backwards from every other pack: these
 * are the oldest cars in the catalogue, and the Samaras are the only ones with a
 * decade of tyre development behind them.
 *
 * ---- steering lock ----
 *
 * Every `steerLock` is derived, not chosen: a factory turning radius is measured by
 * the OUTER FRONT WHEEL, so the path radius of the car's centreline is that figure
 * less half a track, and the bicycle-model lock that produces it at this body's own
 * (now life-size) wheelbase is `atan(wheelbase / R) + steerPlay`. The play term is
 * there because the classic profile's 0.024 rad of backlash is subtracted from the
 * rack command before it reaches the tyre.
 */
const SOVIET_SPECS: readonly SovietSpec[] = [
  {
    // GAZ-21 Volga: 2.445 litre, 70 hp at 4000, three speeds on the column, and
    // 1.46 tonnes of chrome on cross-plies. Turning radius 6.3 m, top speed 130.
    // Nothing about this car is quick, and its 0.48 rearward weight bias plus a
    // 0.95 Hz front end is why it heaves onto its outside front tyre and stays
    // there.
    id: 'sv_gaz21',
    label: 'GAZ-21 Volga',
    file: 'gz21.fbx',
    scale: 0.010305,
    mass: 1460,
    engineId: 'engine_zmz_21',
    gearboxId: 'gearbox_gaz_3',
    tankLitres: 60,
    wheelGrip: 0.522,
    steerLock: 0.519,
    rearDriveBias: 1,
    frontWeightShare: 0.48,
    dragArea: 1.05,
    suspension: SUSP_VOLGA_21,
    visualRideLiftWheelFraction: 1 / 6,
  },
  {
    // GAZ-24 Volga: the same idea fifteen years later. 95 hp, four speeds on the
    // floor, 145 km/h, and a 5.65 m turning radius on a longer wheelbase — so it
    // needs MORE lock than the 21 to match it.
    id: 'sv_gaz24',
    label: 'GAZ-24 Volga',
    file: 'gz24.fbx',
    scale: 0.009556,
    mass: 1420,
    engineId: 'engine_zmz_24',
    gearboxId: 'gearbox_gaz_4',
    tankLitres: 55,
    wheelGrip: 0.6,
    steerLock: 0.598,
    rearDriveBias: 1,
    frontWeightShare: 0.49,
    dragArea: 1.0,
    suspension: SUSP_VOLGA_24,
  },
  {
    // VAZ-2101, the Zhiguli. 1.198 litre, 62 hp, 955 kg, 140 km/h at the redline in
    // a direct fourth on a 4.30 axle. The default car, and the one everything else
    // in this table is judged against.
    id: 'sv_vaz2101',
    label: 'VAZ-2101 Zhiguli',
    file: 'vz01.fbx',
    scale: 0.010585,
    mass: 955,
    engineId: 'engine_lada_1200',
    gearboxId: 'gearbox_lada_4',
    tankLitres: 39,
    wheelGrip: 0.558,
    steerLock: 0.52,
    rearDriveBias: 1,
    frontWeightShare: 0.51,
    dragArea: 0.82,
    suspension: SUSP_ZHIGULI,
  },
  {
    // VAZ-2102: the 2101 as an estate. Same running gear, 430 kg of payload rating
    // in the back, and the empty-estate rear end that comes with it.
    id: 'sv_vaz2102',
    label: 'VAZ-2102 estate',
    file: 'vz02.fbx',
    scale: 0.010632,
    mass: 1010,
    engineId: 'engine_lada_1200',
    gearboxId: 'gearbox_lada_4',
    tankLitres: 39,
    wheelGrip: 0.551,
    steerLock: 0.522,
    rearDriveBias: 1,
    frontWeightShare: 0.5,
    dragArea: 0.92,
    suspension: SUSP_ZHIGULI_ESTATE,
    storageCells: 5,
  },
  {
    // VAZ-2103: 1.452 litre, 71 hp, twin headlights, a tachometer and the 4.10 axle
    // behind the close-ratio box. The fastest of the early saloons at 152 km/h.
    id: 'sv_vaz2103',
    label: 'VAZ-2103',
    file: 'vz03.fbx',
    scale: 0.010632,
    mass: 1030,
    engineId: 'engine_lada_1500',
    gearboxId: 'gearbox_lada_4_tall',
    tankLitres: 39,
    wheelGrip: 0.574,
    steerLock: 0.525,
    rearDriveBias: 1,
    frontWeightShare: 0.51,
    dragArea: 0.82,
    suspension: SUSP_ZHIGULI,
  },
  {
    // VAZ-2104: the 2105's estate on the 1.5. The workhorse of the line, and the
    // heaviest of the classics.
    id: 'sv_vaz2104',
    label: 'VAZ-2104 estate',
    file: 'vz04.fbx',
    scale: 0.010585,
    mass: 1050,
    engineId: 'engine_lada_1500',
    gearboxId: 'gearbox_lada_4',
    tankLitres: 39,
    wheelGrip: 0.56,
    steerLock: 0.521,
    rearDriveBias: 1,
    frontWeightShare: 0.5,
    dragArea: 0.92,
    suspension: SUSP_ZHIGULI_ESTATE,
    storageCells: 5,
  },
  {
    // VAZ-2105: square lights, the belt-cam 1.3, 64 hp. The one everyone's uncle
    // had, and mechanically the plainest car here.
    id: 'sv_vaz2105',
    label: 'VAZ-2105',
    file: 'vz05.fbx',
    scale: 0.010632,
    mass: 995,
    engineId: 'engine_lada_1300',
    gearboxId: 'gearbox_lada_4',
    tankLitres: 39,
    wheelGrip: 0.57,
    steerLock: 0.522,
    rearDriveBias: 1,
    frontWeightShare: 0.51,
    dragArea: 0.83,
    suspension: SUSP_ZHIGULI,
  },
  {
    // The pack's rally 2105: stripes, spot lamps, twin Webers, a 6800 rpm limit and
    // 5 cm of extra stance, because a rally car is RAISED. Its 1.6 has nothing
    // below 3000 rpm and everything above it; the springs are the stiffest in the
    // pack and it is the only Soviet body on the sport steering profile, because
    // somebody rebuilt this one to be driven hard.
    id: 'sv_vaz2105r',
    label: 'VAZ-2105 rally',
    file: 'vz05r.fbx',
    scale: 0.010632,
    mass: 960,
    engineId: 'engine_lada_rally',
    gearboxId: 'gearbox_lada_5',
    tankLitres: 39,
    wheelGrip: 0.615,
    // Homologation/rally compound: markedly better drive and braking than the
    // cross-ply road tyre, without giving it modern steady-state lateral g.
    longitudinalGripScale: 1.27,
    steerLock: 0.508,
    rearDriveBias: 1,
    handlingProfile: 'sport',
    frontWeightShare: 0.52,
    dragArea: 0.9,
    suspension: SUSP_LADA_RALLY,
    storageCells: 1,
  },
  {
    // VAZ-2106: 1.569 litre, 75 hp, and the 3.90 axle. 152 km/h, and the strongest
    // pull of the classic saloons.
    id: 'sv_vaz2106',
    label: 'VAZ-2106',
    file: 'vz06.fbx',
    scale: 0.010585,
    mass: 1035,
    engineId: 'engine_lada_1600',
    gearboxId: 'gearbox_lada_4_1600',
    tankLitres: 39,
    wheelGrip: 0.58,
    steerLock: 0.52,
    rearDriveBias: 1,
    frontWeightShare: 0.51,
    dragArea: 0.82,
    suspension: SUSP_ZHIGULI,
  },
  {
    // VAZ-2107: the 2105 with a grille that thinks it is a Mercedes, the 1.5 and
    // the five-speed. Fifth is an 0.82 overdrive, so it is the relaxed one.
    id: 'sv_vaz2107',
    label: 'VAZ-2107',
    file: 'vz07.fbx',
    scale: 0.010632,
    mass: 1050,
    engineId: 'engine_lada_1500',
    gearboxId: 'gearbox_lada_5',
    tankLitres: 39,
    wheelGrip: 0.582,
    steerLock: 0.521,
    rearDriveBias: 1,
    frontWeightShare: 0.51,
    dragArea: 0.84,
    suspension: SUSP_ZHIGULI,
  },
  {
    // VAZ-2108 Sputnik: the break with everything above it. Front-wheel drive on a
    // transaxle, five speeds, MacPherson struts, rack-and-pinion steering, 900 kg
    // and 62% of it over the front axle. It steers like a different decade because
    // it is one, so it is the first Soviet body on the `road` profile.
    id: 'sv_vaz2108',
    label: 'VAZ-2108 Sputnik',
    file: 'vz08.fbx',
    scale: 0.010123,
    mass: 900,
    engineId: 'engine_samara_1300',
    gearboxId: 'gearbox_samara_5',
    tankLitres: 43,
    wheelGrip: 0.65,
    steerLock: 0.56,
    rearDriveBias: 0,
    handlingProfile: 'road',
    frontWeightShare: 0.62,
    dragArea: 0.72,
    suspension: SUSP_SAMARA,
    storageCells: 2,
  },
  {
    // VAZ-2109: the five-door Samara. Same running gear, 20 kg and a longer roof.
    id: 'sv_vaz2109',
    label: 'VAZ-2109 Samara',
    file: 'vz09.fbx',
    scale: 0.010123,
    mass: 920,
    engineId: 'engine_samara_1300',
    gearboxId: 'gearbox_samara_5',
    tankLitres: 43,
    wheelGrip: 0.65,
    steerLock: 0.56,
    rearDriveBias: 0,
    handlingProfile: 'road',
    frontWeightShare: 0.615,
    dragArea: 0.72,
    suspension: SUSP_SAMARA,
    storageCells: 3,
  },
  {
    // VAZ-21099: the Samara with a boot grafted on, the 1.5 and the tall 3.706
    // axle. 156 km/h makes it the fastest thing in the pack that was sold as one.
    id: 'sv_vaz21099',
    label: 'VAZ-21099',
    file: 'vz099.fbx',
    scale: 0.010082,
    mass: 960,
    engineId: 'engine_samara_1500',
    gearboxId: 'gearbox_samara_5_tall',
    tankLitres: 43,
    wheelGrip: 0.65,
    steerLock: 0.56,
    rearDriveBias: 0,
    handlingProfile: 'road',
    frontWeightShare: 0.6,
    dragArea: 0.7,
    suspension: SUSP_SAMARA,
  },
  {
    // VAZ-2121 Niva: 1.6, 80 hp, permanent four-wheel drive through a locking centre
    // diff, 220 mm of clearance and a 2.20 m wheelbase — the shortest in the pack.
    // Its transfer case's high range is folded into the 4.68 final drive, so it is
    // geared a fifth shorter than the 2106 it shares a block with: 132 km/h flat
    // out, and it will pull away from anything here on a surface.
    id: 'sv_niva',
    label: 'VAZ-2121 Niva',
    file: 'vz21.fbx',
    scale: 0.009649,
    mass: 1210,
    engineId: 'engine_niva_1600',
    gearboxId: 'gearbox_niva_4',
    tankLitres: 42,
    wheelGrip: 0.576,
    steerLock: 0.482,
    rearDriveBias: 0.5,
    handlingProfile: 'utility',
    frontWeightShare: 0.53,
    dragArea: 1.3,
    suspension: SUSP_NIVA,
    storageCells: 4,
  },
  {
    // VAZ-2131: the Niva stretched by half a metre, on the 1.7 and five speeds.
    // 1.4 tonnes on the same springs, so it rolls more and stops worse.
    id: 'sv_niva_long',
    label: 'VAZ-2131 Niva',
    file: 'vz31.fbx',
    scale: 0.009783,
    mass: 1400,
    engineId: 'engine_niva_1700',
    gearboxId: 'gearbox_niva_5',
    tankLitres: 42,
    wheelGrip: 0.574,
    steerLock: 0.498,
    rearDriveBias: 0.5,
    handlingProfile: 'utility',
    frontWeightShare: 0.52,
    dragArea: 1.2,
    suspension: SUSP_NIVA,
    storageCells: 6,
  },
];

/**
 * Body-paint swatch used by each Soviet FBX. The shared atlas also carries glass,
 * chrome, lamps, tyres and trim colours; replacing the whole texture would tint
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
 * Visual-only lift for the VAZ bodies, as a fraction of wheel radius.
 *
 * These fifteen models are authored sitting lower on their wheels than the real
 * cars did, so a Zhiguli looked slammed next to a Volga that already carries this
 * correction. It is a RENDER offset and nothing else: the suspension, the collider,
 * the centre of mass, the wheel mounts and every clearance the physics reads stay
 * exactly where `SUSP_*.rideHeight` puts them (see `visualBodyLift`).
 */
const VAZ_VISUAL_RIDE_LIFT = 1 / 6;

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
  lights: sovietLights(spec.file),
  detectWheels: true,
  bodyClass: 'car',
  storageCells: spec.storageCells,
  visualRideLiftWheelFraction:
    spec.visualRideLiftWheelFraction ??
    (spec.file.startsWith('vz') ? VAZ_VISUAL_RIDE_LIFT : undefined),
  mass: spec.mass,
  engineId: spec.engineId,
  gearboxId: spec.gearboxId,
  tankLitres: spec.tankLitres,
  wheelGrip: spec.wheelGrip,
  longitudinalGripScale: spec.longitudinalGripScale,
  // FBXLoader reports this pack in centimetres, and each body's factor makes that
  // body life-size against the real car's wheelbase (see the pack note above).
  scale: spec.scale,
  suspension: spec.suspension,
  steerLock: spec.steerLock,
  rearDriveBias: spec.rearDriveBias,
  handlingProfile: spec.handlingProfile,
  frontWeightShare: spec.frontWeightShare,
  dragArea: spec.dragArea,
}));

/**
 * Texture-free GTA SA conversions. Scale is fitted from each DFF dummy axle
 * spacing to the real wheelbase; the runtime never sees source pack naming.
 */
const SAAS_SPECS: readonly Entry[] = [
  {
    id: 'sa_azlk2141',
    label: 'AZLK-2141 Svyatogor',
    dir: SAAS,
    glb: 'azlk2141.glb',
    bodyClass: 'car',
    scale: 0.86595,
    mass: 1070,
    engineId: 'engine_i4_1600',
    gearboxId: 'gearbox_manual5',
    tankLitres: 55,
    wheelGrip: 0.65,
    suspension: SUSP_SAMARA,
    steerLock: 0.58,
    rearDriveBias: 0,
    handlingProfile: 'road',
    frontWeightShare: 0.62,
    dragArea: 0.74,
  },
  {
    id: 'sa_oka',
    label: 'VAZ-1111 Oka',
    dir: SAAS,
    glb: 'oka.glb',
    bodyClass: 'car',
    scale: 0.97465,
    mass: 645,
    engineId: 'engine_lada_1200',
    gearboxId: 'gearbox_lada_4',
    tankLitres: 30,
    wheelGrip: 0.61,
    suspension: SUSP_SAMARA,
    steerLock: 0.62,
    rearDriveBias: 0,
    handlingProfile: 'road',
    frontWeightShare: 0.62,
    dragArea: 0.62,
  },
  {
    id: 'sa_uaz330364',
    label: 'UAZ-330364',
    dir: SAAS,
    glb: 'uaz330364.glb',
    bodyClass: 'truck',
    scale: 0.950393,
    mass: 1845,
    engineId: 'engine_i4_2445',
    gearboxId: 'gearbox_manual4',
    tankLitres: 56,
    wheelGrip: 0.59,
    suspension: SUSP_TRUCK,
    steerLock: 0.55,
    rearDriveBias: 0.5,
    handlingProfile: 'utility',
    frontWeightShare: 0.52,
    dragArea: 1.85,
  },
  {
    id: 'sa_izh2715',
    label: 'IZH-2715',
    dir: SAAS,
    glb: 'izh2715.glb',
    bodyClass: 'truck',
    scale: 0.863496,
    mass: 1015,
    engineId: 'engine_lada_1500',
    gearboxId: 'gearbox_lada_4',
    tankLitres: 46,
    wheelGrip: 0.56,
    suspension: SUSP_ZHIGULI_ESTATE,
    steerLock: 0.55,
    rearDriveBias: 1,
    handlingProfile: 'classic',
    frontWeightShare: 0.53,
    dragArea: 1.0,
  },
];

const SAAS_CARS: readonly Entry[] = SAAS_SPECS.map((spec) => ({
  ...spec,
  glassMaterial: 'car_glass',
  paintStyle: 'solid-paint',
  lights: {
    headlights: ['headlights'],
    taillights: ['taillights'],
  },
  wheelNodes: {
    wheel_fl: ['wheel_fl', 'hub_fl'],
    wheel_fr: ['wheel_fr', 'hub_fr'],
    wheel_rl: ['wheel_rl', 'hub_rl'],
    wheel_rr: ['wheel_rr', 'hub_rr'],
  },
}));

const ENTRIES: readonly Entry[] = [
  // -------------------------------------------------------------------------
  // Low Poly Soviet Car Pack. Fifteen FBX bodies, one per model, each carrying
  // its own wheels (found by shape) and taking its colour from the pack's shared
  // palette atlas. Life-size in centimetres, nose-first down +Z, 4-6k triangles.
  // -------------------------------------------------------------------------
  ...SOVIET_CARS,

  // -------------------------------------------------------------------------
  // Private GTA SA mod conversions. Their DFF-specific hierarchy and material
  // names are normalized offline into the explicit six-role runtime contract.
  // -------------------------------------------------------------------------
  ...SAAS_CARS,
];

export const CAR_MODELS: readonly CarModelDef[] = ENTRIES.map((e) => ({
  id: e.id,
  label: e.label,
  file: `${e.dir}/${e.glb}`,
  textureFile: e.textureFile,
  paintStyle: e.paintStyle ?? (e.dir === SOVIET ? 'soviet-atlas' : undefined),
  paintUvCell: e.dir === SOVIET ? SOVIET_PAINT_CELLS[e.glb] : undefined,
  glassMaterial: e.glassMaterial,
  glassUvCell: e.glassUvCell,
  visualRideLiftWheelFraction: e.visualRideLiftWheelFraction,
  detectWheels: e.detectWheels,
  wheelNodes: e.wheelNodes,
  bodyClass: e.bodyClass,
  scale: e.scale ?? 1,
  yaw: e.yaw,
  mass: e.mass,
  engineId: e.engineId,
  gearboxId: e.gearboxId,
  tankLitres: e.tankLitres,
  wheelGrip: e.wheelGrip,
  longitudinalGripScale: e.longitudinalGripScale,
  suspension: e.suspension ?? SUSP_CAR,
  steerLock: e.steerLock,
  rearDriveBias: e.rearDriveBias,
  handlingProfile: e.handlingProfile ?? 'classic',
  frontWeightShare: e.frontWeightShare,
  dragArea: e.dragArea,
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
