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
 * class of body: the same twenty models supply the player's car, the working
 * cars generated at roadside stops, and the sunken shells scattered beside them.
 *
 * Free-form anchor parts remain cosmetic. The separate four-cell bonnet service
 * layout owns the removable engine, optional turbine, radiator and fuel tank.
 */

import type { BodyClass, EngineSpec, GearboxSpec, SuspensionTuning } from '../parts/registry';
import { variant } from '../parts/registry';
import modelFits from './model-fits.json';

import { TRUNK_CELL_COUNT } from './trunk';
const MODEL_FITS = modelFits as unknown as Record<string, CarModelFit>;
function modelFit(id: string): CarModelFit {
  const fit = MODEL_FITS[id];
  if (!fit) throw new Error(`Model "${id}" is missing fit metadata`);
  return fit;
}


/**
 * The three vendored packs, each credited beside its models.
 *
 *  - SOVIET: Low Poly Soviet Car Pack. Fifteen FBX bodies in centimetres, each
 *    carrying its own wheels, colour taken from a shared 9x2 swatch atlas.
 *  - SAAS: private GTA SA mod conversions, normalized offline into texture-free
 *    GLBs with six runtime material roles and explicit wheel, hub and lamp nodes.
 *  - GTAV: GTA V add-on fragments (.yft inside an .rpf), normalized by
 *    `tools/import-yft-vehicle.py` into the same texture-free contract as SAAS.
 *    Its wheels are one authored assembly instanced at four corners, so these
 *    bodies have wheel nodes and no separate hub nodes.
 */
const SOVIET = '/models/soviet';
const SAAS = '/models/saas';
const GTAV = '/models/gtav';

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
 * The spring rate in N/m — the rate a real spring HAS — that puts a corner carrying
 * `cornerMassKg` of sprung mass at `hz`.
 *
 * The per-kilogram form above is what Rapier's ray-cast suspension wants, because it
 * multiplies the number it is given by the chassis mass. That makes it useless as a
 * description of a spring: a car with a per-kilogram rate sags to the same ride height
 * empty and loaded, which is the opposite of what a spring does. So the rate is kept
 * in newtons per metre and divided by whatever mass is present at the boundary, and
 * the corner then sits lower and rings slower as it is loaded.
 */
export function wheelSpringRateAbs(hz: number, cornerMassKg: number): number {
  const omega = 2 * Math.PI * hz;
  return omega * omega * cornerMassKg;
}

/** The absolute damping coefficient, N·s/m, for `ratio` of critical at that corner. */
export function wheelDampingRateAbs(hz: number, ratio: number, cornerMassKg: number): number {
  const omega = 2 * Math.PI * hz;
  return 2 * ratio * omega * cornerMassKg;
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
 * clearance before placing the contact plane. The numbers in `FACTORY_GEOMETRY` are
 * therefore BASE clearances, already reduced by that measured lift: the suspension
 * probe then reads 144-224 mm under a settled body, the Niva highest and the
 * AZLK-2141 lowest. Writing those real figures directly made every car sit 50-63 mm
 * too high.
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
};

/** GAZ-24: the same layout fifteen years later, with dampers that work. */
const SUSP_VOLGA_24: SuspensionTuning = {
  frontHz: 1.0,
  rearHz: 1.22,
  compressionRatio: 0.2,
  reboundRatio: 0.34,
  bumpTravel: 0.1,
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
};

/** "Sport" in this era means a firm saloon on stiffer dampers, not a modern chassis. */
const SUSP_SPORT: SuspensionTuning = {
  frontHz: 1.38,
  rearHz: 1.55,
  compressionRatio: 0.3,
  reboundRatio: 0.46,
  bumpTravel: 0.08,
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
 * Authored lamp selectors. A selector names a mesh node or material carrying one
 * independently controlled lamp channel. Normalized models provide those meshes
 * directly, so their bounds locate the light source without inspecting triangles
 * or treating an entire body as one lens.
 */
export interface VehicleLightsDef {
  readonly headlights: readonly string[];
  /** Running-light lenses; models with combined rear lenses omit `brakeLights`. */
  readonly taillights: readonly string[];
  /** Dedicated stop-lamp lenses when braking does not use the running-light section. */
  readonly brakeLights?: readonly string[];
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

/** Geometry metadata needed before the visual asset itself is resident. */
export interface CarModelFit {
  readonly halfExtents: readonly [number, number, number];
  readonly wheels: readonly {
    readonly id: string;
    readonly pos: readonly [number, number, number];
    readonly radius: number;
    readonly isFront: boolean;
  }[];
  readonly hoodPoint: readonly [number, number, number];
  readonly visualOffset: readonly [number, number, number];
}
/** Stock exterior and running-gear dimensions, metres. */
export interface FactoryGeometry {
  readonly length: number;
  readonly width: number;
  readonly height: number;
  /** Minimum published ground clearance. */
  readonly clearance: number;
  readonly wheelbase: number;
  readonly frontTrack: number;
  readonly rearTrack: number;
  readonly wheelRadius: number;
  readonly tyreWidth: number;
  /** Nose to front axle; set when source-art axle bias disagrees with factory drawings. */
  readonly frontOverhang?: number;
}


/**
 * A limited-slip differential, as the two numbers its makers quote. It may hold the
 * two wheels of its axle apart in speed with at most `preloadNm` plus `lock` times the
 * torque going through it; anything beyond slips, as an open differential always does.
 *
 *   clutch pack (Salisbury, ZF, Traction-Lok)  preload 50-150 Nm, lock 0.25-0.45
 *   Torsen (torque-sensing gears)              preload 0, lock 0.5-0.6: open when
 *                                              one wheel carries nothing at all
 *   welded or spool                            lock 1 and a preload nothing reaches
 *
 * `lock` is (TBR - 1) / (TBR + 1) for a quoted torque bias ratio.
 */
export interface LimitedSlip {
  readonly lock: number;
  readonly preloadNm: number;
}

/**
 * The tyre the car was sold on, as its size is written on the sidewall. The side-force
 * curve is derived from it (`tyreCurve` in vehicletuning.ts): a tall soft sidewall
 * builds force slowly, peaks late and lets go gently; a low radial is quick, peaks
 * early and breaks away more sharply.
 */
export interface TyreSpec {
  readonly construction: 'crossply' | 'radial';
  /** Sidewall height over section width: 0.82 for 165R13, 0.6 for 225/60. */
  readonly aspect: number;
}

/** Mechanical era shared by cars with the same steering and tyre construction. */
export type HandlingProfile = 'classic' | 'road' | 'sport' | 'utility';




export interface CarModelDef {
  /** Stable id; appears in save files. */
  readonly id: string;
  readonly label: string;
  /** Model URL (.glb or .fbx), served from public/. */
  readonly file: string;
  /** Static geometry metadata; lets physics and POI layout precede visual streaming. */
  readonly fit: CarModelFit;
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
  /** Paint material that receives a deterministic contrasting colour. */
  readonly secondaryPaintMaterial?: string;
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
  /** Factory geometry used to fit body, axles and tyres at load time. */
  readonly factory: FactoryGeometry;
  /**
   * Candidate road Soviet wheel-set model ids. The selected source supplies style
   * only; this car's own factory radius and axle positions remain authoritative.
   */
  readonly wheelSetPool?: readonly string[];
  /**
   * Loaded visual settle in metres. Applied only to the sprung body; axle centres
   * stay fixed and connected suspension geometry deforms continuously.
   */
  readonly loadedRideDrop?: number;
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
   * derived quantity — the chassis box, which axle is the front one and the bonnet
   * camera mount — comes out of the measured geometry, so rotating the geometry first is
   * what keeps all of them agreeing with each other.
   */
  readonly yaw?: number;
  /** Kerb mass, kg. Complete vehicle — there are no parts left to add to it. */
  readonly mass: number;
  /** Engine and gearbox, by part-variant id, so the specs live in one table. */
  readonly engineId: string;
  readonly gearboxId: string;
  readonly tankLitres: number;
  /** Tyre grip multiplier on the surface's friction, in every direction alike. */
  readonly wheelGrip: number;
  /**
   * What the car's own brakes deliver at full pedal on a surface that does not limit
   * them, in g: the drums and discs, not the tyres. Sized to the period 100-0 stops
   * `tools/reality.ts` holds each car to. Where the tyres give out first — loose
   * ground, the wet, bald tyres — they are the limit instead.
   */
  readonly brakeDecelG: number;
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
   * Anti-roll bars, each as a fraction of its own axle's wheel rate (0 = no bar), when
   * the car's are not the period saloon's front-biased pair (`ANTI_ROLL_*_FRACTION` in
   * vehicletuning.ts). The split is the handling balance: the axle with more roll
   * stiffness takes more of the load transfer and runs out of grip first.
   */
  readonly antiRoll?: { readonly front: number; readonly rear: number };
  /** The factory tyre, when the car's own curve should replace the profile's. */
  readonly tyre?: TyreSpec;
  /**
   * A limited-slip differential on that axle; absent is an open one. See
   * `LimitedSlip`. Only meaningful on a driven axle.
   */
  readonly frontDiff?: LimitedSlip;
  readonly rearDiff?: LimitedSlip;
  /**
   * The body's drag area, Cd·A in m². Authored where the real car's is known; a
   * body that omits it falls back to one shared Cd over its measured box, which
   * only lands for a mid-seventies saloon shape (see `Vehicle`'s constructor).
   */
  readonly dragArea?: number;
  /** Authored lenses whose per-instance materials mirror the vehicle's live controls. */
  readonly lights?: VehicleLightsDef;
  /** Every car body carries the shared 4x2 trunk. */
  readonly storageCells: number;
}

/** Shared defaults; every entry below states only what makes it itself. */
type Entry = Omit<
  CarModelDef,
  | 'file'
  | 'fit'
  | 'factory'
  | 'scale'
  | 'suspension'
  | 'lights'
  | 'storageCells'
  | 'handlingProfile'
> & {
  /** Model file name within the pack directory named by `dir`. */
  readonly glb: string;
  /** Directory containing `glb`. */
  readonly dir: string;
  readonly scale?: number;
  readonly suspension?: SuspensionTuning;
  readonly handlingProfile?: HandlingProfile;
  readonly lights?: VehicleLightsDef;
  /** Legacy authored hint; the catalogue normalizer now gives every body eight cells. */
  readonly storageCells?: number;
};

/**
 * Historical stock dimensions. Metric tyre radii come from the listed factory
 * sizes; the three old inch-size vehicles retain their measured period-tyre radii.
 * The 2105 rally keeps its 0.300 m competition tyre on the stock 2105 shell.
 */
const FACTORY_GEOMETRY: Readonly<Record<string, FactoryGeometry>> = {
  sv_gaz21:       { length: 4.830, width: 1.800, height: 1.620, clearance: 0.190, wheelbase: 2.700, frontTrack: 1.410, rearTrack: 1.420, wheelRadius: 0.365, tyreWidth: 0.170 },
  sv_gaz24:       { length: 4.735, width: 1.800, height: 1.490, clearance: 0.174, wheelbase: 2.800, frontTrack: 1.470, rearTrack: 1.420, wheelRadius: 0.354, tyreWidth: 0.187 },
  sv_vaz2101:     { length: 4.073, width: 1.611, height: 1.382, clearance: 0.170, wheelbase: 2.424, frontTrack: 1.349, rearTrack: 1.305, wheelRadius: 0.297, tyreWidth: 0.155 },
  sv_vaz2102:     { length: 4.059, width: 1.611, height: 1.458, clearance: 0.170, wheelbase: 2.424, frontTrack: 1.365, rearTrack: 1.321, wheelRadius: 0.297, tyreWidth: 0.165 },
  sv_vaz2103:     { length: 4.116, width: 1.611, height: 1.446, clearance: 0.170, wheelbase: 2.424, frontTrack: 1.365, rearTrack: 1.321, wheelRadius: 0.288, tyreWidth: 0.165 },
  sv_vaz2104:     { length: 4.115, width: 1.620, height: 1.443, clearance: 0.170, wheelbase: 2.424, frontTrack: 1.365, rearTrack: 1.321, wheelRadius: 0.288, tyreWidth: 0.165 },
  sv_vaz2105:     { length: 4.130, width: 1.620, height: 1.446, clearance: 0.170, wheelbase: 2.424, frontTrack: 1.365, rearTrack: 1.321, wheelRadius: 0.288, tyreWidth: 0.165 },
  sv_vaz2105r:    { length: 4.130, width: 1.620, height: 1.446, clearance: 0.170, wheelbase: 2.424, frontTrack: 1.365, rearTrack: 1.321, wheelRadius: 0.300, tyreWidth: 0.185 },
  sv_vaz2106:     { length: 4.166, width: 1.611, height: 1.444, clearance: 0.170, wheelbase: 2.424, frontTrack: 1.365, rearTrack: 1.321, wheelRadius: 0.288, tyreWidth: 0.165 },
  sv_vaz2107:     { length: 4.128, width: 1.620, height: 1.435, clearance: 0.170, wheelbase: 2.424, frontTrack: 1.365, rearTrack: 1.321, wheelRadius: 0.288, tyreWidth: 0.165 },
  sv_vaz2108:     { length: 4.006, width: 1.650, height: 1.402, clearance: 0.170, wheelbase: 2.460, frontTrack: 1.400, rearTrack: 1.370, wheelRadius: 0.281, tyreWidth: 0.165 },
  sv_vaz2109:     { length: 4.006, width: 1.650, height: 1.402, clearance: 0.160, wheelbase: 2.460, frontTrack: 1.400, rearTrack: 1.370, wheelRadius: 0.281, tyreWidth: 0.165 },
  sv_vaz21099:    { length: 4.205, width: 1.650, height: 1.402, clearance: 0.160, wheelbase: 2.460, frontTrack: 1.400, rearTrack: 1.370, wheelRadius: 0.281, tyreWidth: 0.165 },
  sv_niva:        { length: 3.720, width: 1.680, height: 1.640, clearance: 0.220, wheelbase: 2.200, frontTrack: 1.430, rearTrack: 1.400, wheelRadius: 0.343, tyreWidth: 0.175 },
  sv_niva_long:   { length: 4.240, width: 1.680, height: 1.640, clearance: 0.220, wheelbase: 2.700, frontTrack: 1.440, rearTrack: 1.420, wheelRadius: 0.343, tyreWidth: 0.175 },
  sa_azlk2141:   { length: 4.350, width: 1.690, height: 1.400, clearance: 0.140, wheelbase: 2.580, frontTrack: 1.440, rearTrack: 1.420, wheelRadius: 0.310, tyreWidth: 0.165 },
  sa_vaz2109:   { length: 4.006, width: 1.650, height: 1.402, clearance: 0.160, wheelbase: 2.460, frontTrack: 1.400, rearTrack: 1.370, wheelRadius: 0.281, tyreWidth: 0.165 },
  sa_oka:         { length: 3.200, width: 1.420, height: 1.400, clearance: 0.150, wheelbase: 2.180, frontTrack: 1.214, rearTrack: 1.204, wheelRadius: 0.260, tyreWidth: 0.135 },
  sa_uaz330364:   { length: 4.535, width: 1.974, height: 2.355, clearance: 0.205, wheelbase: 2.550, frontTrack: 1.445, rearTrack: 1.445, wheelRadius: 0.372, tyreWidth: 0.225, frontOverhang: 1.054 },
  sa_izh2715:     { length: 4.130, width: 1.590, height: 1.825, clearance: 0.185, wheelbase: 2.400, frontTrack: 1.270, rearTrack: 1.270, wheelRadius: 0.305, tyreWidth: 0.175 },
  gt_vaz2110:     { length: 4.265, width: 1.680, height: 1.420, clearance: 0.170, wheelbase: 2.492, frontTrack: 1.410, rearTrack: 1.380, wheelRadius: 0.288, tyreWidth: 0.175 },
  // The proving ground (see `PROVING_SPECS`): published dimensions, rolling radius of
  // the factory tyre (the larger, rear one where the axles differ), and the front
  // overhang, because the donor body's own axle placement is some other car's.
  pg_2cv:         { length: 3.830, width: 1.480, height: 1.600, clearance: 0.150, wheelbase: 2.400, frontTrack: 1.260, rearTrack: 1.260, wheelRadius: 0.293, tyreWidth: 0.125, frontOverhang: 0.75 },
  pg_mini:        { length: 3.054, width: 1.410, height: 1.346, clearance: 0.150, wheelbase: 2.036, frontTrack: 1.214, rearTrack: 1.176, wheelRadius: 0.250, tyreWidth: 0.145, frontOverhang: 0.52 },
  pg_911sc:       { length: 4.291, width: 1.652, height: 1.320, clearance: 0.120, wheelbase: 2.272, frontTrack: 1.369, rearTrack: 1.379, wheelRadius: 0.320, tyreWidth: 0.215, frontOverhang: 0.96 },
  pg_mustang:     { length: 4.562, width: 1.735, height: 1.323, clearance: 0.130, wheelbase: 2.553, frontTrack: 1.455, rearTrack: 1.460, wheelRadius: 0.326, tyreWidth: 0.225, frontOverhang: 0.96 },
  pg_defender:    { length: 4.599, width: 1.790, height: 1.996, clearance: 0.215, wheelbase: 2.794, frontTrack: 1.486, rearTrack: 1.486, wheelRadius: 0.393, tyreWidth: 0.190, frontOverhang: 0.70 },
  pg_t2:          { length: 4.505, width: 1.720, height: 1.955, clearance: 0.185, wheelbase: 2.400, frontTrack: 1.385, rearTrack: 1.425, wheelRadius: 0.330, tyreWidth: 0.185, frontOverhang: 0.90 },
  pg_elise:       { length: 3.726, width: 1.701, height: 1.202, clearance: 0.130, wheelbase: 2.300, frontTrack: 1.440, rearTrack: 1.453, wheelRadius: 0.306, tyreWidth: 0.205, frontOverhang: 0.75 },
  pg_testarossa:  { length: 4.485, width: 1.976, height: 1.130, clearance: 0.120, wheelbase: 2.550, frontTrack: 1.518, rearTrack: 1.660, wheelRadius: 0.334, tyreWidth: 0.280, frontOverhang: 1.00 },
  pg_integrale:   { length: 3.900, width: 1.700, height: 1.365, clearance: 0.140, wheelbase: 2.480, frontTrack: 1.400, rearTrack: 1.380, wheelRadius: 0.295, tyreWidth: 0.205, frontOverhang: 0.80 },
  sh_vaz2101:     { length: 4.073, width: 1.611, height: 1.382, clearance: 0.170, wheelbase: 2.424, frontTrack: 1.349, rearTrack: 1.305, wheelRadius: 0.297, tyreWidth: 0.155, frontOverhang: 0.72 },
};

function factoryGeometry(id: string): FactoryGeometry {
  const geometry = FACTORY_GEOMETRY[id];
  if (!geometry) throw new Error(`Model "${id}" is missing factory geometry`);
  return geometry;
}



/**
 * Low Poly Soviet Car Pack — fifteen bodies, one FBX each, and the only pack in
 * the catalogue that is about the same cars this game is already about.
 *
 * They needed no conversion and no simplification. Every one is 4.0k-5.8k
 * triangles, nose-first down +Z, with four consistently named wheel meshes.
 * FBXLoader reports the source geometry in centimetres.
 *
 * Colour is UV, not material: each body's UVs point into a region of the pack's
 * shared `albedo.png` palette. The atlas is not one paint picture: it is eighteen
 * solid swatches carrying paint, glass, chrome, lamp and trim colours. The renderer
 * replaces only each body's paint swatch, leaving every functional colour intact.
 *
 * ---- life-size, per body ----
 *
 * The pack is not uniformly scaled. Each source keeps its wheelbase-derived base
 * scale, then render/carmodel.ts fits body width, body-only height and length to
 * FACTORY_GEOMETRY. Axle positions, front/rear tracks and rolling radii are corrected
 * independently, so fixing an over-wide Volga never widens its tyres and fitting a
 * narrow Zhiguli never changes its wheelbase. The corrected body bounds remain the
 * collider bounds; visual and physical proportions therefore cannot diverge.
 *
 * ---- everything else is the real car's ----
 *
 * Engines, gearboxes and final drives are the factory's, from the pack's own Soviet
 * driveline table (parts/registry.ts). Masses are catalogue kerb masses, weight
 * distribution is the factory axle split, steering lock is derived from the published
 * turning circle at each body's own measured wheelbase, and the grip ladder is what
 * period tyres actually pull (see the note above the table).
 *
 * `dragArea` is calibrated, in this order and never before the others: real mass,
 * ratios and driveline efficiency, then the engine's factory curve, then Cd·A as the
 * one number that puts the car on its catalogue top speed at the tools/reality.ts
 * test load. Where AvtoVAZ published a wind-tunnel Cd the result is checked against
 * it and agrees (Samaras); elsewhere no factory Cd or frontal area exists, and one
 * value per BODY SHELL is fitted to its family's top speeds together (2101/2103/2106,
 * 2105/2107, 2102/2104), so a shared shell cannot hide a different engine's error.
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
  readonly brakeDecelG: number;
  readonly steerLock: number;
  readonly rearDriveBias: number;
  readonly handlingProfile?: HandlingProfile;
  /** Factory front-axle share of the kerb mass. */
  readonly frontWeightShare: number;
  /** Drag area, Cd·A in m²: see the note above on how it is calibrated. */
  readonly dragArea: number;
  readonly suspension: SuspensionTuning;
  /** The factory tyre (see `TyreSpec`). */
  readonly tyre: TyreSpec;
  readonly storageCells?: number;
}


/*
 * ---- the grip ladder, and why it sits so far below 1.0 ----
 *
 * `wheelGrip` multiplies the surface's one coefficient for drive, braking and
 * cornering alike, so it is the tyre — and these are period Soviet tyres. What the
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
 * Volga cornering like a modern hatchback. The stopping distance is NOT set here: it
 * is `brakeDecelG`, the car's own brakes, sized to the period 100-0 test. Sizing it
 * through the tyre is what used to leave every classic spinning its rear wheels in
 * first gear on dry asphalt.
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
 * rack command before it reaches the tyre. The Niva's tyres scrub wider than that
 * bicycle model, so its lock is the one that puts tools/reality.ts on its factory
 * 5.5 m; the same holds for the working vehicles and the Moskvich below.
 */
const SOVIET_SPECS: readonly SovietSpec[] = [
  {
    // GAZ-21 Volga: 2.445 litre, 70 hp at 4000, three speeds on the column, and
    // 1.46 tonnes of chrome on cross-plies. Turning radius 6.3 m, top speed 130.
    // Cd·A 1.12 from that top speed; no factory Cd exists.
    // Nothing about this car is quick, and its 0.48 rearward weight bias plus a
    // 0.95 Hz front end is why it heaves onto its outside front tyre and stays
    // there.
    id: 'sv_gaz21',
    label: 'GAZ-21 Volga',
    file: 'gz21.fbx',
    scale: 0.010305,
    mass: 1460,
    // 6.70-15 cross-ply.
    tyre: { construction: 'crossply', aspect: 0.95 },
    engineId: 'engine_zmz_21',
    gearboxId: 'gearbox_gaz_3',
    tankLitres: 60,
    wheelGrip: 0.522,
    brakeDecelG: 0.42,
    steerLock: 0.519,
    rearDriveBias: 1,
    frontWeightShare: 0.48,
    dragArea: 1.12,
    suspension: SUSP_VOLGA_21,
  },
  {
    // GAZ-24 Volga: the same idea fifteen years later. 95 hp, four speeds on the
    // floor, 145 km/h, and a 5.5 m turning radius on a longer wheelbase (GAZ-24
    // manual) — so it needs MORE lock than the 21 to match it. Cd·A 1.37 from the
    // factory 145 km/h, i.e. Cd ~0.65 on ~2.1 m²: well above ru.wikipedia's unsourced
    // 0.45, which is what 95 hp would need to be a gross rather than a net figure to
    // explain. The catalogue power is used as printed; the drag area carries it.
    id: 'sv_gaz24',
    label: 'GAZ-24 Volga',
    file: 'gz24.fbx',
    scale: 0.009556,
    mass: 1420,
    // 7.35-14 cross-ply.
    tyre: { construction: 'crossply', aspect: 0.95 },
    engineId: 'engine_zmz_24',
    gearboxId: 'gearbox_gaz_4',
    tankLitres: 55,
    wheelGrip: 0.6,
    brakeDecelG: 0.47,
    steerLock: 0.598,
    rearDriveBias: 1,
    frontWeightShare: 0.49,
    dragArea: 1.37,
    suspension: SUSP_VOLGA_24,
  },
  {
    // VAZ-2101, the Zhiguli. 1.198 litre, 64 hp, 955 kg, 142 km/h in a direct
    // fourth on a 4.30 axle, 0-100 in 20 s (1982 catalogue). The default car, and
    // the one everything else in this table is judged against. Cd·A 0.95 is the
    // 2101/2103/2106 shell's, fitted to the three cars' top speeds together.
    id: 'sv_vaz2101',
    label: 'VAZ-2101 Zhiguli',
    file: 'vz01.fbx',
    scale: 0.010585,
    mass: 955,
    // 155 R13, the Zhiguli's Fiat-era radial.
    tyre: { construction: 'radial', aspect: 0.8 },
    engineId: 'engine_lada_1200',
    gearboxId: 'gearbox_lada_4',
    tankLitres: 39,
    wheelGrip: 0.558,
    brakeDecelG: 0.5,
    steerLock: 0.52,
    rearDriveBias: 1,
    frontWeightShare: 0.51,
    dragArea: 0.95,
    suspension: SUSP_ZHIGULI,
  },
  {
    // VAZ-2102: the 2101 as an estate. Same engine on a shorter 4.44 axle, 430 kg
    // of payload rating in the back, and the empty-estate rear end that comes with
    // it. Cd·A 1.07 is the estate shell's, shared with the 2104.
    id: 'sv_vaz2102',
    label: 'VAZ-2102 estate',
    file: 'vz02.fbx',
    scale: 0.010632,
    mass: 1010,
    // 165 R13.
    tyre: { construction: 'radial', aspect: 0.8 },
    engineId: 'engine_lada_1200',
    gearboxId: 'gearbox_lada_4_2102',
    tankLitres: 39,
    wheelGrip: 0.551,
    brakeDecelG: 0.49,
    steerLock: 0.522,
    rearDriveBias: 1,
    frontWeightShare: 0.5,
    dragArea: 1.07,
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
    // 165/80 R13.
    tyre: { construction: 'radial', aspect: 0.8 },
    engineId: 'engine_lada_1500',
    gearboxId: 'gearbox_lada_4_tall',
    tankLitres: 39,
    wheelGrip: 0.574,
    brakeDecelG: 0.5,
    steerLock: 0.525,
    rearDriveBias: 1,
    frontWeightShare: 0.51,
    dragArea: 0.95,
    suspension: SUSP_ZHIGULI,
  },
  {
    // VAZ-2104: the 2105's estate, in its base form with the 2105's 1.3 and 4.3
    // axle (autoopt.ru: 1020 kg, 137 km/h, 18.5 s). The workhorse of the line.
    id: 'sv_vaz2104',
    label: 'VAZ-2104 estate',
    file: 'vz04.fbx',
    scale: 0.010585,
    mass: 1020,
    // 165/80 R13.
    tyre: { construction: 'radial', aspect: 0.8 },
    engineId: 'engine_lada_1300',
    gearboxId: 'gearbox_lada_4_2105',
    tankLitres: 39,
    wheelGrip: 0.56,
    brakeDecelG: 0.49,
    steerLock: 0.521,
    rearDriveBias: 1,
    frontWeightShare: 0.5,
    dragArea: 1.07,
    suspension: SUSP_ZHIGULI_ESTATE,
    storageCells: 5,
  },
  {
    // VAZ-2105: square lights, the belt-cam 1.3, 47 kW, the close-ratio box on a
    // 4.3 axle. The one everyone's uncle had, and mechanically the plainest car here.
    // Cd·A 0.92 is the 2105/2107 shell's.
    id: 'sv_vaz2105',
    label: 'VAZ-2105',
    file: 'vz05.fbx',
    scale: 0.010632,
    mass: 995,
    // 165/80 R13.
    tyre: { construction: 'radial', aspect: 0.8 },
    engineId: 'engine_lada_1300',
    gearboxId: 'gearbox_lada_4_2105',
    tankLitres: 39,
    wheelGrip: 0.57,
    brakeDecelG: 0.5,
    steerLock: 0.522,
    rearDriveBias: 1,
    frontWeightShare: 0.51,
    dragArea: 0.92,
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
    // 185-section competition tyre on a 13-inch rim, about a 70 profile.
    tyre: { construction: 'radial', aspect: 0.7 },
    engineId: 'engine_lada_rally',
    gearboxId: 'gearbox_lada_5',
    tankLitres: 39,
    wheelGrip: 0.615,
    // Rally brakes: pads, harder linings and a servo the road car never had.
    brakeDecelG: 0.75,
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
    // 165/80 R13.
    tyre: { construction: 'radial', aspect: 0.8 },
    engineId: 'engine_lada_1600',
    gearboxId: 'gearbox_lada_4_1600',
    tankLitres: 39,
    wheelGrip: 0.58,
    brakeDecelG: 0.5,
    steerLock: 0.52,
    rearDriveBias: 1,
    frontWeightShare: 0.51,
    dragArea: 0.95,
    suspension: SUSP_ZHIGULI,
  },
  {
    // VAZ-2107: the 2105 with a grille that thinks it is a Mercedes, the 1.5 and
    // the five-speed. Fifth is an 0.82 overdrive, so it is the relaxed one.
    id: 'sv_vaz2107',
    label: 'VAZ-2107',
    file: 'vz07.fbx',
    scale: 0.010632,
    mass: 1030,
    // 165/80 R13.
    tyre: { construction: 'radial', aspect: 0.8 },
    engineId: 'engine_lada_1500',
    gearboxId: 'gearbox_lada_5',
    tankLitres: 39,
    wheelGrip: 0.582,
    brakeDecelG: 0.5,
    steerLock: 0.521,
    rearDriveBias: 1,
    frontWeightShare: 0.51,
    dragArea: 0.92,
    suspension: SUSP_ZHIGULI,
  },
  {
    // VAZ-2108 Sputnik: the break with everything above it. Front-wheel drive on a
    // transaxle, five speeds, MacPherson struts, rack-and-pinion steering, 900 kg
    // and 62% of it over the front axle. It steers like a different decade because
    // it is one, so it is the first Soviet body on the `road` profile. Cd·A 0.88 from
    // its 148 km/h, which is AvtoVAZ's own wind-tunnel Cd of 0.47 on 1.87 m².
    id: 'sv_vaz2108',
    label: 'VAZ-2108 Sputnik',
    file: 'vz08.fbx',
    scale: 0.010123,
    mass: 900,
    // 165/70 R13.
    tyre: { construction: 'radial', aspect: 0.7 },
    engineId: 'engine_samara_1300',
    gearboxId: 'gearbox_samara_5',
    tankLitres: 43,
    wheelGrip: 0.65,
    brakeDecelG: 0.57,
    steerLock: 0.56,
    rearDriveBias: 0,
    handlingProfile: 'road',
    frontWeightShare: 0.62,
    dragArea: 0.88,
    suspension: SUSP_SAMARA,
    storageCells: 2,
  },
  {
    // VAZ-2109: the five-door Samara. Same running gear, 20 kg and a longer roof.
    id: 'sv_vaz2109',
    label: 'VAZ-2109 Samara',
    file: 'vz09.fbx',
    scale: 0.010123,
    mass: 915,
    // 165/70 R13.
    tyre: { construction: 'radial', aspect: 0.7 },
    engineId: 'engine_samara_1300',
    gearboxId: 'gearbox_samara_5',
    tankLitres: 43,
    wheelGrip: 0.65,
    brakeDecelG: 0.57,
    steerLock: 0.56,
    rearDriveBias: 0,
    handlingProfile: 'road',
    frontWeightShare: 0.615,
    dragArea: 0.88,
    suspension: SUSP_SAMARA,
    storageCells: 3,
  },
  {
    // VAZ-21099: the Samara with a boot grafted on, the 1.5, and the manual's 3.9-
    // class axle (it lists 3.7 or 3.9). 154 km/h makes it the fastest thing in the
    // pack that was sold as one. Cd·A 0.84: AvtoVAZ's Cd 0.45 on 1.87 m².
    id: 'sv_vaz21099',
    label: 'VAZ-21099',
    file: 'vz099.fbx',
    scale: 0.010082,
    mass: 970,
    // 165/70 R13.
    tyre: { construction: 'radial', aspect: 0.7 },
    engineId: 'engine_samara_1500',
    gearboxId: 'gearbox_samara_5',
    tankLitres: 43,
    wheelGrip: 0.65,
    brakeDecelG: 0.57,
    steerLock: 0.56,
    rearDriveBias: 0,
    handlingProfile: 'road',
    frontWeightShare: 0.6,
    dragArea: 0.84,
    suspension: SUSP_SAMARA,
  },
  {
    // VAZ-2121 Niva: 1.6, 73 hp, permanent four-wheel drive through a locking centre
    // diff, 220 mm of clearance and a 2.20 m wheelbase — the shortest in the pack.
    // Its transfer case's high range is folded into the 4.92 final drive, so it is
    // geared a fifth shorter than the 2106 it shares a block with: 132 km/h flat
    // out, and it will pull away from anything here on a surface. Cd·A 1.30 from that
    // 132, Cd 0.536 (ru.wikipedia) on about 2.4 m²; the 2131 shares the nose.
    id: 'sv_niva',
    label: 'VAZ-2121 Niva',
    file: 'vz21.fbx',
    scale: 0.009649,
    mass: 1150,
    // 175/80 R16.
    tyre: { construction: 'radial', aspect: 0.8 },
    engineId: 'engine_niva_1600',
    gearboxId: 'gearbox_niva_4',
    tankLitres: 42,
    wheelGrip: 0.576,
    brakeDecelG: 0.48,
    steerLock: 0.496,
    rearDriveBias: 0.5,
    handlingProfile: 'utility',
    frontWeightShare: 0.53,
    dragArea: 1.3,
    suspension: SUSP_NIVA,
    storageCells: 4,
  },
  {
    id: 'sv_niva_long',
    label: 'VAZ-2131 Niva',
    file: 'vz31.fbx',
    scale: 0.009783,
    mass: 1350,
    // 175/80 R16.
    tyre: { construction: 'radial', aspect: 0.8 },
    engineId: 'engine_niva_1700',
    gearboxId: 'gearbox_niva_5',
    tankLitres: 42,
    wheelGrip: 0.574,
    brakeDecelG: 0.47,
    steerLock: 0.498,
    rearDriveBias: 0.5,
    handlingProfile: 'utility',
    frontWeightShare: 0.52,
    dragArea: 1.3,
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

/** Shared pool: road Soviet sets only, excluding rally and both Niva sets. */
const SOVIET_WHEEL_SET_POOL = [
  'sv_gaz21',
  'sv_gaz24',
  'sv_vaz2101',
  'sv_vaz2102',
  'sv_vaz2103',
  'sv_vaz2104',
  'sv_vaz2105',
  'sv_vaz2106',
  'sv_vaz2107',
  'sv_vaz2108',
  'sv_vaz2109',
  'sv_vaz21099',
] as const;

function sovietWheelNodes(file: string): WheelNodeNames {
  const stem = file.slice(0, -4);
  const prefix = stem.startsWith('gz') ? `g${stem.slice(2)}` : stem.slice(2);
  return {
    wheel_fl: [`${prefix}wheel_fl`],
    wheel_fr: [`${prefix}wheel_fr`],
    wheel_rl: [`${prefix}wheel_bl`],
    wheel_rr: [`${prefix}wheel_br`],
  };
}

function sharedSovietWheelPool(file: string): readonly string[] | undefined {
  if (['vz05r.fbx', 'vz21.fbx', 'vz31.fbx'].includes(file)) return undefined;
  return SOVIET_WHEEL_SET_POOL;
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
  lights: sovietLights(spec.file),
  // Soviet FBX wheel names are stable; explicit nodes also keep headless and
  // browser loaders on the same four-corner interpretation.
  detectWheels: false,
  wheelNodes: sovietWheelNodes(spec.file),
  wheelSetPool: sharedSovietWheelPool(spec.file),
  bodyClass: 'car',
  storageCells: spec.storageCells,
  mass: spec.mass,
  engineId: spec.engineId,
  gearboxId: spec.gearboxId,
  tankLitres: spec.tankLitres,
  wheelGrip: spec.wheelGrip,
  brakeDecelG: spec.brakeDecelG,
  // FBXLoader reports this pack in centimetres, and each body's factor makes that
  // body life-size against the real car's wheelbase (see the pack note above).
  scale: spec.scale,
  suspension: spec.suspension,
  steerLock: spec.steerLock,
  rearDriveBias: spec.rearDriveBias,
  handlingProfile: spec.handlingProfile,
  frontWeightShare: spec.frontWeightShare,
  dragArea: spec.dragArea,
  tyre: spec.tyre,
}));

/**
 * Texture-free GTA SA conversions. Scale is fitted from each DFF dummy axle
 * spacing to the real wheelbase; the runtime never sees source pack naming.
 */
const SAAS_SPECS: readonly Entry[] = [
  {
    // AZLK-2141-01 as the 1998 catalogue lists it (autoopt.ru): the VAZ-2106-70 1.6,
    // the 2141 five-speed on a 3.9 axle, 1055 kg, 158 km/h, 0-100 in 14.9 s and a
    // 5.0 m turning radius. Cd·A 0.86 from that 158: the period literature's Cd of
    // 0.35-0.38 on 1.89 m² would give 172 km/h from this engine, so either figure
    // is optimistic and the top speed, the one the catalogue stands behind, wins.
    id: 'sa_azlk2141',
    label: 'AZLK-2141 Svyatogor',
    dir: SAAS,
    glb: 'azlk2141.glb',
    bodyClass: 'car',
    scale: 0.86595,
    mass: 1055,
    // 165/80 R13 class road radial.
    tyre: { construction: 'radial', aspect: 0.8 },
    engineId: 'engine_i4_1600',
    gearboxId: 'gearbox_manual5',
    tankLitres: 55,
    wheelGrip: 0.65,
    brakeDecelG: 0.59,
    suspension: SUSP_SAMARA,
    steerLock: 0.617,
    rearDriveBias: 0,
    handlingProfile: 'road',
    frontWeightShare: 0.62,
    dragArea: 0.86,
    wheelSetPool: SOVIET_WHEEL_SET_POOL,
  },
  {
    // VAZ-2109, 1991, 1.3 L carburettor, five-speed FWD.
    // This personal-use conversion is kept local to the application catalogue.
    id: 'sa_vaz2109',
    label: 'VAZ-2109',
    dir: SAAS,
    glb: 'vaz2109.glb',
    bodyClass: 'car',
    scale: 1,
    mass: 915,
    // 165/70 R13.
    tyre: { construction: 'radial', aspect: 0.7 },
    engineId: 'engine_samara_1300',
    gearboxId: 'gearbox_samara_5',
    tankLitres: 43,
    wheelGrip: 0.65,
    brakeDecelG: 0.57,
    steerLock: 0.56,
    rearDriveBias: 0,
    handlingProfile: 'road',
    frontWeightShare: 0.62,
    dragArea: 0.88,
    suspension: SUSP_SAMARA,
    storageCells: 3,
    paintStyle: 'solid-paint',
    glassMaterial: 'car_glass',
    wheelNodes: {
      wheel_fl: ['wheel_fl'],
      wheel_fr: ['wheel_fr'],
      wheel_rl: ['wheel_rl'],
      wheel_rr: ['wheel_rr'],
    },
    lights: {
      headlights: ['headlights'],
      taillights: ['taillights'],
      brakeLights: ['brake_lights'],
      reverseLights: ['reverse_lights'],
      leftBlinkers: ['front_blinker_left', 'side_blinker_left', 'rear_blinker_left'],
      rightBlinkers: ['front_blinker_right', 'side_blinker_right', 'rear_blinker_right'],
    },
  },
  {
    // VAZ-1111, 1988-1996, per its factory manual: 635 kg kerb, 0.65 litre twin,
    // four-speed transaxle on a 4.54 final drive, 135/80 R12 on 4B-12 rims, 30
    // litre tank, a 4.8 m turning radius by the outer wheel's track, and 120 km/h
    // and 0-100 in 30 s with a driver and one passenger aboard. Cd·A 0.68: Za
    // Rulyom's Cd 0.40 on the textbook's 1.69 m².
    id: 'sa_oka',
    label: 'VAZ-1111 Oka',
    dir: SAAS,
    glb: 'oka.glb',
    bodyClass: 'car',
    scale: 0.97465,
    mass: 635,
    // 135/80 R12.
    tyre: { construction: 'radial', aspect: 0.8 },
    engineId: 'engine_vaz_1111',
    gearboxId: 'gearbox_oka_4',
    tankLitres: 30,
    wheelGrip: 0.61,
    brakeDecelG: 0.55,
    // MacPherson struts in front, trailing arms on an elastic cross-beam behind:
    // the Samara's layout, and its preset.
    suspension: SUSP_SAMARA,
    steerLock: 0.54,
    rearDriveBias: 0,
    handlingProfile: 'road',
    // No factory axle loads are published; transverse front-drive default.
    frontWeightShare: 0.62,
    dragArea: 0.68,
    lights: {
      // Headlamps carry the position lamps inside them. Amber indicators sit in the
      // bumper and on each front wing. The OSVAR 43.3716 rear lamp stacks a clear
      // reversing block, an amber indicator and red running/stop on one 21/5 W
      // bulb. The red fog lamp in the left of the rear bumper is `rear_passive`:
      // nothing in the game switches it.
      headlights: ['headlights'],
      taillights: ['taillights'],
      reverseLights: ['reverse_lights'],
      leftBlinkers: ['front_blinker_left', 'rear_blinker_left'],
      rightBlinkers: ['front_blinker_right', 'rear_blinker_right'],
    },
    wheelSetPool: SOVIET_WHEEL_SET_POOL,
  },
  {
    id: 'sa_uaz330364',
    label: 'UAZ-330364',
    dir: SAAS,
    glb: 'uaz330364.glb',
    bodyClass: 'truck',
    scale: 0.880927,
    mass: 1845,
    // 225/75 R16.
    tyre: { construction: 'radial', aspect: 0.75 },
    engineId: 'engine_umz_4213',
    gearboxId: 'gearbox_uaz_4',
    tankLitres: 56,
    wheelGrip: 0.59,
    brakeDecelG: 0.53,
    suspension: SUSP_TRUCK,
    steerLock: 0.482,
    rearDriveBias: 0.5,
    handlingProfile: 'utility',
    // Factory kerb axle loads: 1180 kg front, 665 kg rear. Boxy cab-over body:
    // Cd·A 3.45 from the 330364's 105 km/h (truck-and-bus.ru), 0.74 of the
    // 1.97 m × 2.355 m frontal envelope. No factory Cd exists. Lock puts it on the
    // UAZ-2206's 6.3 m (autoopt.ru, the same chassis).
    frontWeightShare: 1180 / 1845,
    dragArea: 3.45,
    // This working 4x4 keeps its authored heavy-duty wheels. It neither borrows
    // from the shared road-wheel pool nor donates its set to that pool.
    wheelSetPool: [],
    loadedRideDrop: 0.037,
    secondaryPaintMaterial: 'car_bed_paint',
    wheelNodes: {
      wheel_fl: ['wheel_fl'],
      wheel_fr: ['wheel_fr'],
      wheel_rl: ['wheel_rl'],
      wheel_rr: ['wheel_rr'],
    },
    lights: {
      // The lower front semicircles are white position lamps and therefore share
      // the headlight control; the upper semicircles are the actual indicators.
      headlights: ['headlights'],
      taillights: ['taillights'],
      reverseLights: ['reverse_lights'],
      leftBlinkers: ['front_blinker_left', 'rear_blinker_left'],
      rightBlinkers: ['front_blinker_right', 'rear_blinker_right'],
    },
  },
  {
    id: 'sa_izh2715',
    label: 'IZH-2715-01',
    dir: SAAS,
    glb: 'izh2715.glb',
    bodyClass: 'truck',
    scale: 0.863496,
    mass: 1015,
    // 1984-1997 2715-01 in its factory low-octane commercial specification:
    // UZAM-412DE, 1478 cc, 49 kW and 102 Nm.
    // 175/80 R13.
    tyre: { construction: 'radial', aspect: 0.8 },
    engineId: 'engine_uzam_412de',
    // Moskvich/IZH four-speed with the 4.22 working-vehicle final drive.
    gearboxId: 'gearbox_izh_4',
    tankLitres: 46,
    // 175/80 R13 period road tyre; same dry-road calibration as the 2104 estate.
    wheelGrip: 0.56,
    brakeDecelG: 0.51,
    // Rear leaf springs carrying a 500 kg payload; not the Zhiguli coil-sprung estate.
    suspension: SUSP_TRUCK,
    // Factory outer-front turning radius is 5.25 m (autoopt.ru, IZH-2715); the
    // leaf-sprung pickup scrubs wider than the bicycle model, so the lock is the one
    // that measures 5.25 on tools/reality.ts rather than atan(2.4 / 4.615) + play.
    steerLock: 0.533,
    rearDriveBias: 1,
    handlingProfile: 'classic',
    // Factory unladen axle loads: 550 kg front, 465 kg rear.
    frontWeightShare: 550 / 1015,
    // No factory Cd is published. CdA 1.42 m² is derived from the factory
    // 125 km/h maximum with this engine, gearing, efficiency and tyre.
    dragArea: 1.42,
    lights: {
      // Late PF10 front units: amber upper indicators and clear lower position
      // lenses. UP112 triangular rear indicators are independent of the FP112 /
      // IZHFS4 running-stop blocks and their clear reversing sections.
      headlights: [
        'headlights_left_0', 'headlights_left_1', 'headlights_left_2',
        'headlights_left_3', 'headlights_left_4', 'headlights_left_5', 'headlights_left_6',
        'headlights_right_0', 'headlights_right_1', 'headlights_right_2', 'headlights_right_3',
        'front_position_left_0', 'front_position_left_1',
        'front_position_left_2', 'front_position_left_3',
      ],
      taillights: [
        'taillights_left_0', 'taillights_left_1', 'taillights_left_2',
        'taillights_left_3', 'taillights_left_4', 'taillights_left_5', 'taillights_left_6',
        'taillights_right_0', 'taillights_right_1', 'taillights_right_2',
        'taillights_right_3', 'taillights_right_4', 'taillights_right_5', 'taillights_right_6',
      ],
      reverseLights: ['reverse_lights_left_0', 'reverse_lights_right_0'],
      leftBlinkers: [
        'front_blinker_left_0', 'front_blinker_left_1',
        'front_blinker_left_2', 'front_blinker_left_3',
        'rear_blinker_left_0', 'rear_blinker_left_1',
        'rear_blinker_left_2', 'rear_blinker_left_3',
      ],
      rightBlinkers: [
        'front_blinker_right_0', 'front_blinker_right_1',
        'front_blinker_right_2', 'front_blinker_right_3',
        'rear_blinker_right_0', 'rear_blinker_right_1',
        'rear_blinker_right_2', 'rear_blinker_right_3',
      ],
    },
    wheelSetPool: SOVIET_WHEEL_SET_POOL,
  },
];

const SAAS_CARS: readonly Entry[] = SAAS_SPECS.map((spec) => ({
  ...spec,
  glassMaterial: 'car_glass',
  paintStyle: 'solid-paint',
  lights: spec.lights ?? {
    headlights: ['headlights'],
    taillights: ['taillights'],
  },
  wheelNodes: spec.wheelNodes ?? {
    wheel_fl: ['wheel_fl', 'hub_fl'],
    wheel_fr: ['wheel_fr', 'hub_fr'],
    wheel_rl: ['wheel_rl', 'hub_rl'],
    wheel_rr: ['wheel_rr', 'hub_rr'],
  },
}));

/**
 * GTA V add-on conversions. One body so far: the VAZ-2110, extracted from the
 * fragment's skinned body mesh and its single authored wheel.
 *
 * Scale comes from the wheelbase, as everywhere else: the source measures 2.792
 * between axle centres against the real car's 2492 mm, so 0.89255 puts the track
 * on 1.39 m, the body on 4.24 m and the roof on 1.41 m — the factory figures.
 *
 * The 2110 is a Samara underneath: MacPherson struts in front, a trailing-arm
 * torsion beam behind, transverse 1.5 and a five-speed transaxle driving the
 * front wheels, and the 1.5 is the 21083's derivative (the 2110 manual's carburettor
 * rating, 52.0 kW and 103.9 Nm, is within 1% and 2.5% of it). Cd is the one number
 * the car was actually famous for: 0.33-0.334 in AvtoVAZ's tunnel, on 2.04 m² of
 * frontal area, so 0.68 m² of drag area.
 */
const GTAV_SPECS: readonly Entry[] = [
  {
    id: 'gt_vaz2110',
    label: 'VAZ-2110',
    dir: GTAV,
    glb: 'vaz2110.glb',
    bodyClass: 'car',
    scale: 0.89255,
    mass: 1010,
    // 175/70 R13.
    tyre: { construction: 'radial', aspect: 0.7 },
    engineId: 'engine_samara_1500',
    gearboxId: 'gearbox_samara_5',
    tankLitres: 43,
    wheelGrip: 0.66,
    brakeDecelG: 0.6,
    suspension: SUSP_SAMARA,
    steerLock: 0.58,
    rearDriveBias: 0,
    wheelSetPool: SOVIET_WHEEL_SET_POOL,
    frontWeightShare: 0.62,
    dragArea: 0.68,
  },
];

const GTAV_CARS: readonly Entry[] = GTAV_SPECS.map((spec) => ({
  ...spec,
  glassMaterial: 'car_glass',
  paintStyle: 'solid-paint',
  lights: {
    headlights: ['headlights'],
    taillights: ['taillights'],
    brakeLights: ['brake_lights'],
    reverseLights: ['reverse_lights'],
    leftBlinkers: ['front_blinker_left', 'rear_blinker_left'],
    rightBlinkers: ['front_blinker_right', 'rear_blinker_right'],
  },
  // One wheel mesh instanced at four corners: tyre, rim and hub are one node.
  wheelNodes: {
    wheel_fl: ['wheel_fl'],
    wheel_fr: ['wheel_fr'],
    wheel_rl: ['wheel_rl'],
    wheel_rr: ['wheel_rr'],
  },
}));

/* ---- the proving ground ----
 *
 * Nine cars picked to sit as far apart as possible on the axes that make a car feel
 * like itself — where the engine is, which wheels it drives, how much each horse
 * carries, how high the mass sits and how the springs hold it — so that driving them
 * one after another tests whether the physics is where the variety lives.
 *
 * Each wears the Rgsdev body of its kind (see `rgsLook`), which the loader stretches
 * to the car's published length, width, height and axle positions, so the collider,
 * the wheels and the camera are the real car's and the shape is its archetype's.
 *
 * Figures are the published ones as reprinted by carfolio.com,
 * automobile-catalog.com and the owners' clubs; `dragArea` is fitted to the top speed
 * on tools/reality.ts, as everywhere else in this file.
 */

/** Ultra-soft, long-travel, barely damped: the 2CV leans until the door handles scrape. */
const SUSP_2CV: SuspensionTuning = {
  frontHz: 0.9,
  rearHz: 0.95,
  compressionRatio: 0.16,
  reboundRatio: 0.28,
  bumpTravel: 0.14,
};

/** Rubber cones and almost no travel: a go-kart that hops on anything sharp. */
const SUSP_MINI: SuspensionTuning = {
  frontHz: 1.7,
  rearHz: 1.9,
  compressionRatio: 0.3,
  reboundRatio: 0.45,
  bumpTravel: 0.05,
};

/** Torsion bars front and rear, firm for its day, rear rate for the engine over it. */
const SUSP_911: SuspensionTuning = {
  frontHz: 1.45,
  rearHz: 1.7,
  compressionRatio: 0.3,
  reboundRatio: 0.45,
  bumpTravel: 0.07,
};

/** Fox-body GT: struts in front, a four-link live axle behind, on the soft side of sporty. */
const SUSP_MUSTANG: SuspensionTuning = {
  frontHz: 1.25,
  rearHz: 1.45,
  compressionRatio: 0.24,
  reboundRatio: 0.4,
  bumpTravel: 0.09,
};

/** Coils on beam axles with long travel: it rolls and pitches and keeps its wheels down. */
const SUSP_DEFENDER: SuspensionTuning = {
  frontHz: 1.1,
  rearHz: 1.25,
  compressionRatio: 0.22,
  reboundRatio: 0.38,
  bumpTravel: 0.18,
};

/** Double wishbones on a bonded chassis weighing less than the driver's opinion of it. */
const SUSP_ELISE: SuspensionTuning = {
  frontHz: 1.8,
  rearHz: 2.0,
  compressionRatio: 0.32,
  reboundRatio: 0.5,
  bumpTravel: 0.06,
};

/** A grand tourer's wishbones: firm, but sprung to cross a country at 250. */
const SUSP_TESTAROSSA: SuspensionTuning = {
  frontHz: 1.6,
  rearHz: 1.8,
  compressionRatio: 0.3,
  reboundRatio: 0.48,
  bumpTravel: 0.07,
};

/** Group A homologation: rally-raised, stiff, and well damped. */
const SUSP_INTEGRALE: SuspensionTuning = {
  frontHz: 1.5,
  rearHz: 1.7,
  compressionRatio: 0.3,
  reboundRatio: 0.46,
  bumpTravel: 0.1,
};

/** Everything a borrowed body brings: the file, its materials, lamps and wheel nodes. */
type DonorLook = Pick<
  Entry,
  | 'dir'
  | 'glb'
  | 'scale'
  | 'yaw'
  | 'glassMaterial'
  | 'paintStyle'
  | 'lights'
  | 'wheelNodes'
  | 'secondaryPaintMaterial'
>;

/**
 * Bodies from Rgsdev's Free Low Poly Vehicles Pack (CC0, Raphael Gonçalves,
 * opengameart.org/content/free-low-poly-vehicles-pack), normalized by
 * tools/carshape/normalize_rgs.py: faceless, flat-shaded, a few hundred faces each,
 * with their own wheels, glass and lenses. The loader stretches each to the car's
 * published dimensions, so one sedan can be any saloon.
 */
const RGS = '/models/rgs';
function rgsLook(glb: string): DonorLook {
  return {
    dir: RGS,
    glb,
    scale: 1,
    yaw: undefined,
    glassMaterial: 'car_glass',
    paintStyle: 'solid-paint',
    lights: { headlights: ['headlights'], taillights: ['taillights'] },
    wheelNodes: {
      wheel_fl: ['wheel_fl'],
      wheel_fr: ['wheel_fr'],
      wheel_rl: ['wheel_rl'],
      wheel_rr: ['wheel_rr'],
    },
    secondaryPaintMaterial: undefined,
  };
}

const PROVING_SPECS: readonly Entry[] = [
  {
    // Citroën 2CV6 (1979): 585 kg, 29 bhp, front drive, 117 km/h, and a turning
    // circle of 10.7 m. The softest thing that ever had four wheels.
    ...rgsLook('hatchback.glb'),
    id: 'pg_2cv',
    label: 'Citroën 2CV6',
    bodyClass: 'car',
    mass: 585,
    engineId: 'engine_citroen_a06',
    gearboxId: 'gearbox_citroen_4',
    tankLitres: 20,
    wheelGrip: 0.58,
    brakeDecelG: 0.6,
    suspension: SUSP_2CV,
    steerLock: 0.527,
    rearDriveBias: 0,
    handlingProfile: 'classic',
    frontWeightShare: 0.58,
    // No bars: the 2CV resists roll with its interconnected springs alone.
    antiRoll: { front: 0, rear: 0 },
    // Michelin X 125R15: the 2CV was sold on radials.
    tyre: { construction: 'radial', aspect: 0.82 },
    dragArea: 0.777,
    wheelSetPool: [],
  },
  {
    // Mini Cooper S 1275 (1965): 650 kg, 76 PS, front drive, 157 km/h on ten-inch
    // wheels and a 9.7 m turning circle.
    ...rgsLook('hatchback.glb'),
    id: 'pg_mini',
    label: 'Mini Cooper S',
    bodyClass: 'car',
    mass: 650,
    engineId: 'engine_bmc_1275s',
    gearboxId: 'gearbox_mini_cr4',
    tankLitres: 50,
    wheelGrip: 0.72,
    brakeDecelG: 0.75,
    suspension: SUSP_MINI,
    steerLock: 0.497,
    rearDriveBias: 0,
    handlingProfile: 'road',
    frontWeightShare: 0.62,
    // No bars either: rubber cones, and a nose carrying 62% does the balancing.
    antiRoll: { front: 0, rear: 0 },
    // Dunlop SP 145R10.
    tyre: { construction: 'radial', aspect: 0.82 },
    dragArea: 0.855,
    wheelSetPool: [],
  },
  {
    // Porsche 911 SC (1980): 1160 kg, 204 PS hung behind the rear axle, 39% on the
    // front wheels, 225 km/h. Lift off in a bend and the tail comes round.
    ...rgsLook('sports.glb'),
    id: 'pg_911sc',
    label: 'Porsche 911 SC',
    bodyClass: 'car',
    mass: 1160,
    engineId: 'engine_porsche_930_10',
    gearboxId: 'gearbox_porsche_915',
    tankLitres: 80,
    wheelGrip: 0.82,
    brakeDecelG: 0.95,
    suspension: SUSP_911,
    steerLock: 0.500,
    rearDriveBias: 1,
    handlingProfile: 'sport',
    frontWeightShare: 0.39,
    antiRoll: { front: 0.5, rear: 0.35 },
    // 185/70 front, 215/60 rear.
    tyre: { construction: 'radial', aspect: 0.65 },
    dragArea: 0.827,
    wheelSetPool: [],
  },
  {
    // Ford Mustang GT 5.0 (1990): 1400 kg, 225 hp and 407 Nm through a live axle on
    // 225/60 tyres. Torque everywhere and a tail that follows the throttle.
    ...rgsLook('muscle.glb'),
    id: 'pg_mustang',
    label: 'Ford Mustang GT 5.0',
    bodyClass: 'car',
    mass: 1400,
    engineId: 'engine_ford_50_ho',
    gearboxId: 'gearbox_bw_t5',
    tankLitres: 58,
    wheelGrip: 0.8,
    brakeDecelG: 0.85,
    suspension: SUSP_MUSTANG,
    steerLock: 0.511,
    rearDriveBias: 1,
    handlingProfile: 'sport',
    frontWeightShare: 0.57,
    // The GT's thick front bar against a thin rear one.
    antiRoll: { front: 0.7, rear: 0.35 },
    // Traction-Lok clutch-pack differential, standard on the GT (TBR about 2.5).
    rearDiff: { lock: 0.43, preloadNm: 80 },
    // 225/60 R15.
    tyre: { construction: 'radial', aspect: 0.6 },
    dragArea: 0.846,
    wheelSetPool: [],
  },
  {
    // Land Rover Defender 110 200Tdi (1992): 2064 kg, 107 hp diesel, permanent 4x4,
    // 137 km/h, two metres tall on 7.50R16.
    ...rgsLook('suv.glb'),
    id: 'pg_defender',
    label: 'Land Rover Defender 110',
    bodyClass: 'truck',
    mass: 2064,
    engineId: 'engine_rover_200tdi',
    gearboxId: 'gearbox_landrover_lt77',
    tankLitres: 79,
    wheelGrip: 0.62,
    brakeDecelG: 0.62,
    suspension: SUSP_DEFENDER,
    steerLock: 0.518,
    rearDriveBias: 0.5,
    handlingProfile: 'utility',
    frontWeightShare: 0.5,
    antiRoll: { front: 0.15, rear: 0.2 },
    // 7.50 R16: a truck tyre's tall sidewall.
    tyre: { construction: 'radial', aspect: 0.92 },
    dragArea: 1.671,
    wheelSetPool: [],
  },
  {
    // VW T2 bus 1600 (1975): 1175 kg, 50 PS behind the rear axle, 110 km/h, and
    // nearly two metres of slab side for the wind to lean on.
    ...rgsLook('van.glb'),
    id: 'pg_t2',
    label: 'VW T2 bus',
    bodyClass: 'truck',
    mass: 1175,
    engineId: 'engine_vw_type1_1600',
    gearboxId: 'gearbox_vw_t2_4',
    tankLitres: 56,
    wheelGrip: 0.6,
    brakeDecelG: 0.6,
    suspension: SUSP_SOFT,
    steerLock: 0.472,
    rearDriveBias: 1,
    handlingProfile: 'utility',
    frontWeightShare: 0.43,
    antiRoll: { front: 0.4, rear: 0 },
    // 185 R14 C.
    tyre: { construction: 'radial', aspect: 0.82 },
    dragArea: 1.583,
    wheelSetPool: [],
  },
  {
    // Lotus Elise S1 (1996): 725 kg, 120 PS behind the seats, 39% on the front,
    // 202 km/h. Every input answered at once.
    ...rgsLook('roadster.glb'),
    id: 'pg_elise',
    label: 'Lotus Elise S1',
    bodyClass: 'car',
    mass: 725,
    engineId: 'engine_rover_k18',
    gearboxId: 'gearbox_rover_pg1',
    tankLitres: 36,
    wheelGrip: 0.88,
    brakeDecelG: 1.0,
    suspension: SUSP_ELISE,
    steerLock: 0.551,
    rearDriveBias: 1,
    handlingProfile: 'sport',
    frontWeightShare: 0.39,
    // Front bar only, as built.
    antiRoll: { front: 0.6, rear: 0 },
    // 185/55 R15 front, 205/50 R16 rear.
    tyre: { construction: 'radial', aspect: 0.52 },
    dragArea: 0.679,
    wheelSetPool: [],
  },
  {
    // Ferrari Testarossa (1984): 1506 kg, 390 PS flat twelve amidships, two metres
    // wide, 290 km/h.
    ...rgsLook('sports.glb'),
    id: 'pg_testarossa',
    label: 'Ferrari Testarossa',
    bodyClass: 'car',
    mass: 1506,
    engineId: 'engine_ferrari_f113a',
    gearboxId: 'gearbox_ferrari_tr5',
    tankLitres: 115,
    wheelGrip: 0.88,
    brakeDecelG: 0.95,
    suspension: SUSP_TESTAROSSA,
    steerLock: 0.500,
    rearDriveBias: 1,
    handlingProfile: 'sport',
    frontWeightShare: 0.41,
    antiRoll: { front: 0.55, rear: 0.4 },
    // ZF 40% limited slip.
    rearDiff: { lock: 0.4, preloadNm: 60 },
    // 240/45 and 280/45 VR415.
    tyre: { construction: 'radial', aspect: 0.45 },
    dragArea: 0.695,
    wheelSetPool: [],
  },
  {
    // Lancia Delta HF Integrale 16v (1989): 1250 kg, 200 PS turbo, permanent 4x4
    // split 47/53, 220 km/h. The one that goes anywhere quickly.
    ...rgsLook('hatchback.glb'),
    id: 'pg_integrale',
    label: 'Lancia Delta Integrale',
    bodyClass: 'car',
    mass: 1250,
    engineId: 'engine_lancia_integrale_16v',
    gearboxId: 'gearbox_lancia_integrale',
    tankLitres: 57,
    wheelGrip: 0.85,
    brakeDecelG: 0.9,
    suspension: SUSP_INTEGRALE,
    steerLock: 0.566,
    rearDriveBias: 0.53,
    handlingProfile: 'sport',
    frontWeightShare: 0.6,
    antiRoll: { front: 0.6, rear: 0.4 },
    // Torsen at the back, as on the 16v (TBR about 3).
    rearDiff: { lock: 0.5, preloadNm: 0 },
    // 205/50 R15.
    tyre: { construction: 'radial', aspect: 0.5 },
    dragArea: 0.777,
    wheelSetPool: [],
  },
];

/* ---- the saloon ----
 *
 * The VAZ-2101 body built by tools/carshape/carbody.py from authored character lines
 * (tools/carshape/cars/vaz2101.json), on the VAZ-2101's physics unchanged, so it can be
 * parked beside the pack's Zhiguli and judged against it.
 */
const ZHIGULI = SOVIET_SPECS.find((spec) => spec.id === 'sv_vaz2101')!;
const SHAPE_SPECS: readonly Entry[] = [
  {
    id: 'sh_vaz2101',
    label: 'VAZ-2101 (carshape)',
    dir: '/models/carshape',
    glb: 'vaz2101.glb',
    scale: 1,
    glassMaterial: 'car_glass',
    paintStyle: 'solid-paint',
    wheelNodes: {
      wheel_fl: ['wheel_fl'],
      wheel_fr: ['wheel_fr'],
      wheel_rl: ['wheel_rl'],
      wheel_rr: ['wheel_rr'],
    },
    lights: {
      headlights: ['headlights'],
      taillights: ['taillights'],
      reverseLights: ['reverse_lights'],
      leftBlinkers: ['front_blinker_left', 'rear_blinker_left'],
      rightBlinkers: ['front_blinker_right', 'rear_blinker_right'],
    },
    bodyClass: 'car',
    mass: ZHIGULI.mass,
    engineId: ZHIGULI.engineId,
    gearboxId: ZHIGULI.gearboxId,
    tankLitres: ZHIGULI.tankLitres,
    wheelGrip: ZHIGULI.wheelGrip,
    brakeDecelG: ZHIGULI.brakeDecelG,
    suspension: ZHIGULI.suspension,
    steerLock: ZHIGULI.steerLock,
    rearDriveBias: ZHIGULI.rearDriveBias,
    handlingProfile: ZHIGULI.handlingProfile,
    frontWeightShare: ZHIGULI.frontWeightShare,
    dragArea: ZHIGULI.dragArea,
    tyre: ZHIGULI.tyre,
    wheelSetPool: [],
  },
];

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

  // -------------------------------------------------------------------------
  // GTA V add-on fragments. One skinned body mesh and one wheel per .yft, cut
  // to the exterior and meshopt-compressed without geometry decimation.
  // -------------------------------------------------------------------------
  ...GTAV_CARS,

  // -------------------------------------------------------------------------
  // The proving ground: real cars' physics on borrowed bodies.
  // -------------------------------------------------------------------------
  ...PROVING_SPECS,
  ...SHAPE_SPECS,
];
export const CAR_MODELS: readonly CarModelDef[] = ENTRIES.map((e) => ({
  id: e.id,
  label: e.label,
  file: `${e.dir}/${e.glb}`,
  fit: modelFit(e.id),
  textureFile: e.textureFile,
  paintStyle: e.paintStyle ?? (e.dir === SOVIET ? 'soviet-atlas' : undefined),
  secondaryPaintMaterial: e.secondaryPaintMaterial,
  paintUvCell: e.dir === SOVIET ? SOVIET_PAINT_CELLS[e.glb] : undefined,
  glassMaterial: e.glassMaterial,
  glassUvCell: e.glassUvCell,
  factory: factoryGeometry(e.id),
  wheelSetPool: e.wheelSetPool,
  loadedRideDrop: e.loadedRideDrop,
  wheelNodes: e.wheelNodes,
  bodyClass: e.bodyClass,
  scale: e.scale ?? 1,
  yaw: e.yaw,
  mass: e.mass,
  engineId: e.engineId,
  gearboxId: e.gearboxId,
  tankLitres: e.tankLitres,
  wheelGrip: e.wheelGrip,
  brakeDecelG: e.brakeDecelG,
  suspension: e.suspension ?? SUSP_CAR,
  steerLock: e.steerLock,
  rearDriveBias: e.rearDriveBias,
  handlingProfile: e.handlingProfile ?? 'classic',
  frontWeightShare: e.frontWeightShare,
  antiRoll: e.antiRoll,
  tyre: e.tyre,
  frontDiff: e.frontDiff,
  rearDiff: e.rearDiff,
  dragArea: e.dragArea,
  lights: e.lights,
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
