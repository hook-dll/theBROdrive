/**
 * This car's lamps: which of them are lit, what the lenses emit, and the beams they
 * cast into the shared light rig.
 *
 * The module owns all per-vehicle lamp state — beam mode, indicator phase, lens
 * materials and beam mounts — and reaches back to the vehicle that owns it only
 * through `VehicleLampsContext`. Mount geometry and beam shapes are its own tuning
 * and live here with the code that reads them.
 */

import * as THREE from 'three';
import type { CarState, GameWorld } from '../game/state';
import {
  POOL_COLS,
  POOL_GRID_STRIDE,
  POOL_LIFT_M,
  POOL_ROWS,
  POOL_VERTS,
  spotIrradiance,
  type LampPoolField,
  type LampView,
  type PoolRoadFrame,
} from '../render/lamppools';
import { LAMP_EXPOSURE, type VehicleLightRig } from '../render/vehiclelights';

/**
 * A vehicle's lamps as the light pool sees them: each group is lit or dark as a
 * whole and holds its slots as a whole (render/slotpool.ts). Headlamps, the running
 * and stop glow, and the reversing lamps are separate because they switch
 * separately; the index of a group in `BEAM_GROUPS` is its pool key.
 */
export const BEAM_GROUPS = ['front', 'tail', 'reverse'] as const;
export type BeamGroup = (typeof BEAM_GROUPS)[number];
import { carLensGlows, makeCarGrimeMaterial, setCarGrime, setCarLensGrime, type LensGlow } from '../render/materials';
import type { CarModelDef } from './carmodels';
import { clamp } from './vehicletuning';

/** Headlight placement as fractions of the chassis box (x of half-width, y of height). */
const HEADLIGHT_X_FRACTION = 0.62;
const HEADLIGHT_Y_FRACTION = 0.28;
/** Minimum real height of a lamp above the settled tyre contact plane. */
const HEADLIGHT_MIN_HEIGHT = 0.65;

/**
 * Beam geometry per mode.
 *
 * A single inverse-power cone must cover both the bumper and the useful road
 * distance. Even a 0.7 decay still made the foreground about five times brighter
 * than terrain at 100 m. The deliberately shallow exponents below make the beam
 * read like a shaped automotive projector rather than a bare inverse-square bulb:
 * compared with the original tune, 5 m receives roughly two-thirds of the
 * irradiance while 100–150 m receives several times as much. Cone, aim and cutoff remain unchanged.
 */
interface HeadlightBeam {
  readonly intensity: number;
  readonly distance: number;
  readonly angle: number;
  readonly penumbra: number;
  readonly targetDistance: number;
  readonly targetDrop: number;
  /** Exponent in Three's distance attenuation `intensity / distance^decay`. */
  readonly decay: number;
}

interface VehicleBeamMount {
  /** Source and aim in chassis-local coordinates. */
  readonly sourceLocal: THREE.Vector3;
  readonly aimLocal: THREE.Vector3;
}

interface ProjectedBeamShape {
  readonly distance: number;
  readonly angle: number;
  readonly penumbra: number;
  readonly decay: number;
}

/**
 * TEMPERATURE AND SOFTNESS. A period sealed beam is a tungsten filament behind
 * glass: roughly 3000 K, which is a warm amber-white, not the 6500 K white these
 * beams used to project. The difference is not decorative. A white pool on ochre
 * asphalt saturates all three channels at once and clips to paper under ACES, so
 * the road ahead arrived as a flat overexposed disc — the "torch bolted to the
 * bumper" look. A warm beam clips its blue channel LAST, so the same amount of
 * light lands as graded sand instead of as white, and the night stops fighting the
 * dawn and dusk palettes it sits between.
 *
 * The intensities below are therefore ~15% lower than the white tune with a
 * slightly steeper falloff, which trades a burnt foreground for a gradient, and
 * the penumbra is much wider so the pool has no hard elliptical rim to catch the
 * eye. Readability is not paid for out of this: it is bought back in sky.ts, where
 * a moonlit fill lifts the desert out of absolute black so that the beam is read
 * against a visible world rather than against a void.
 */
const HEADLIGHT_BEAM_TINT = 0xffd7a3;

/**
 * Dipped beam: broad foreground light aimed to meet the ground at roughly half
 * the previous range. Both its aim distance and attenuation cutoff are halved, so
 * the cone does not merely point past a shorter cutoff.
 */
const HEADLIGHT_LOW: HeadlightBeam = {
  intensity: 10.5,
  distance: 144,
  angle: 0.853,
  penumbra: 0.9,
  targetDistance: 13,
  targetDrop: 0.5,
  decay: 0.3,
};

/**
 * Main beam: narrower and longer than dipped beam, with both aim and cutoff halved
 * from the previous long-distance tune.
 */
const HEADLIGHT_HIGH: HeadlightBeam = {
  intensity: 17,
  distance: 260,
  angle: 0.616,
  penumbra: 0.66,
  targetDistance: 28,
  targetDrop: 0.45,
  decay: 0.26,
};

export type HeadlightMode = 'off' | 'low' | 'high';

type EmissiveMaterial = THREE.MeshStandardMaterial | THREE.MeshPhongMaterial;
/** Which blinkers run: one side for a turn or a lane change, both for the hazards. */
export type IndicatorSide = 'off' | 'left' | 'right' | 'hazard';

/** One flash of a key-fob wink, seconds; a wink is two flashes with a gap between. */
const WINK_FLASH_S = 0.2;

/** Lens emission stays white-hot; only the light it THROWS carries the filament's warmth. */
const HEADLIGHT_EMISSIVE = 0xffffff;
/**
 * Share of a beam a fully dirt-caked lens keeps back. A third, not more: the driven
 * car's own beams are how the road is read at night, and a dusty lamp is a dimmer
 * road, not a blind one.
 */
const LENS_GRIME_BEAM_LOSS = 0.35;
/** Running and stop lenses are red even when unlit; controls only raise their emission. */
const TAILLIGHT_EMISSIVE = 0xff0000;
const REVERSE_LIGHT_EMISSIVE = 0xf4f7ff;
const BLINKER_EMISSIVE = 0xff8a00;
/**
 * Stop-lens emission. Kept just over the display curve's shoulder: the curve
 * (render/displaytransform.ts) bleaches a channel toward white by how far its peak
 * overshoots, so the old 6 showed pure red as pink (≈ sRGB 1, 0.69, 0.69). At 1.2 the
 * lens reads full red, still twice the running lamp's 0.55; the thrown beam carries
 * the rest of the brake's brightness.
 */
const BRAKE_LENS_INTENSITY = 1.2;
/**
 * The colour each switched lens role glows in, in the order of a model's lamp role
 * selectors (head, tail, stop, reverse, left and right blinker; render/carmodel.ts
 * `lampRoleSelectors`) and of `VehicleLamps.lensLevel`. The far and mid traffic meshes
 * light their lenses from it (render/farcars.ts).
 */
export const LENS_ROLE_EMISSIVE: readonly number[] = [
  HEADLIGHT_EMISSIVE,
  TAILLIGHT_EMISSIVE,
  TAILLIGHT_EMISSIVE,
  REVERSE_LIGHT_EMISSIVE,
  BLINKER_EMISSIVE,
  BLINKER_EMISSIVE,
];

const TAILLIGHT_BEAM = {
  distance: 6,
  angle: 0.68,
  penumbra: 0.78,
  decay: 1.4,
  targetDistance: 3.5,
  targetDrop: 0.12,
  // Halved with the encoded frame (core/renderer.ts `drawFrame`): a saturated red pool
  // keeps its whole red channel through the sRGB encode, and at 6 / 24 it spread a
  // metre-wide magenta slab behind every car at night.
  runningIntensity: 3,
  brakeIntensity: 12,
} as const;
const REVERSE_LIGHT_BEAM = {
  distance: 10,
  angle: 0.38,
  penumbra: 0.62,
  decay: 1.1,
  targetDistance: 6,
  targetDrop: 0.18,
  intensity: 24,
} as const;
/** 90 flashes per minute, with equal on/off halves. */
const BLINKER_PERIOD_S = 2 / 3;

/**
 * A lamp group's ground pool (render/lamppools.ts): its grid's rows, metres from the
 * lamps along the beam, covering where the beam reads on the ground. A headlamp's pool
 * reaches as far as its light is still seen on night asphalt, a rear lamp's to its cutoff.
 */
const LOW_POOL_ROWS: readonly number[] = [-1.5, 2.5, 10, 24, 45, 75];
const HIGH_POOL_ROWS: readonly number[] = [-1.5, 2.5, 12, 30, 60, 110];
const TAIL_POOL_ROWS: readonly number[] = [-0.5, 0.6, 1.6, 3, 4.5, 6.2];
const REVERSE_POOL_ROWS: readonly number[] = [-0.5, 1, 2.5, 4.5, 7, 10.2];
/**
 * A headlamp pool's first row laid on the terrain, sampled; the rows before it lie on the
 * car's own tyre contact plane, which is exact under the car and costs nothing. A rear
 * pool lies on the plane throughout: it ends within ten metres of the car.
 */
const FIRST_SAMPLED_ROW = 2;
/** How far a car may move, or turn, before its pool's terrain rows are sampled again. */
const POOL_RESAMPLE_M = 1;
const POOL_RESAMPLE_RAD = 0.035;
/** A pool's half-width at a row, as a share of the cone's own spread there. */
const POOL_SPREAD = 0.95;
const POOL_MIN_HALF_WIDTH_M = 0.6;

/**
 * The headlamp footprint `headlampViewScore` samples: metres ahead, and the depth of road
 * each row stands for. Three samples a row, on the axis and at 0.6 of the cone's spread.
 */
const SCORE_ROWS: readonly number[] = [3, 8, 15, 27, 45];
const SCORE_ROW_DEPTH: readonly number[] = [4, 6, 9, 15, 22];
const SCORE_ACROSS: readonly number[] = [-0.6, 0, 0.6];
/**
 * Light on the player's own car counts double: it is the inside of his cabin, his
 * bonnet and his mirrors, and no pool can put it there (owner, 2026-10-29).
 */
const CAR_LIGHT_WEIGHT = 2;

const _poolGrid = new Float32Array(POOL_VERTS * POOL_GRID_STRIDE);
const _poolRoadSample: PoolRoadFrame = { s: 0, lateral: 0, heading: 0, halfWidth: 0 };
const _poolLampA = new THREE.Vector3();
const _poolLampB = new THREE.Vector3();
const _poolAxis = new THREE.Vector3();
const _poolPoint = new THREE.Vector3();
const _poolUp = new THREE.Vector3();
const _poolColor = new THREE.Color();

/** The colour a lit group's light lands in: the filament's warmth, red, or white. */
function beamColor(group: BeamGroup): number {
  return group === 'front' ? HEADLIGHT_BEAM_TINT : group === 'tail' ? TAILLIGHT_EMISSIVE : REVERSE_LIGHT_EMISSIVE;
}

/** An authored lamp lens: the node is named by a selector, or its material is. */
function isLampLens(selectors: ReadonlySet<string>, mesh: THREE.Mesh, source: THREE.Material): boolean {
  return selectors.has(mesh.name) || selectors.has(source.name);
}

/** The car's own copy of an authored lens material: grimed, and dark until a control lights it. */
function lensMaterial(source: EmissiveMaterial): EmissiveMaterial {
  const material = makeCarGrimeMaterial(source.clone());
  material.emissive.setHex(0x000000);
  material.emissiveIntensity = 0;
  return material;
}

/**
 * One mesh per lamp lens a Vehicle of `model` binds on `root`, over the lens's own
 * geometry and carrying the material the Vehicle makes for it — what a shader warm-up
 * has to compile, because a Vehicle makes its lens materials only as it is built.
 * Never bound into `root` and never drawn (see carmodel.ts, program anchors). A kit
 * car's lenses are its one material's (`carLensGlows`), already in its anchor.
 */
export function lampLensAnchors(model: CarModelDef, root: THREE.Object3D): THREE.Mesh[] {
  const lights = model.lights;
  if (!lights) return [];
  const selectors = new Set([
    ...lights.headlights,
    ...lights.taillights,
    ...(lights.brakeLights ?? []),
    ...(lights.reverseLights ?? []),
    ...(lights.leftBlinkers ?? []),
    ...(lights.rightBlinkers ?? []),
  ]);
  const anchors: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const source of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!isLampLens(selectors, object, source) || carLensGlows(source)) continue;
      if (!(source instanceof THREE.MeshStandardMaterial) && !(source instanceof THREE.MeshPhongMaterial)) continue;
      anchors.push(new THREE.Mesh(object.geometry, lensMaterial(source)));
    }
  });
  return anchors;
}

/**
 * What the lamps need from the vehicle that owns them.
 */
export interface VehicleLampsContext {
  /** The vehicle's visual root: every beam is projected from its render pose. */
  readonly rootGroup: THREE.Object3D;
  /**
   * The model definition. Its `id` names this car in a binding error, and its
   * `lights` selectors are the authored lamp channels this module binds.
   */
  readonly model: CarModelDef;
  /** Authoritative car state: the restored lamp snapshot is read from it. */
  readonly car: CarState;
  /** The save lamp state is published to, as throttled deltas. */
  readonly world: GameWorld;
  /** Service-brake demand, 0..1; the stop lamps follow the pedal. */
  brakeCommand(): number;
  /** True while the gearbox is in reverse; the reverse lamps follow the gear. */
  reversing(): boolean;
}

export class VehicleLamps {
  private readonly ctx: VehicleLampsContext;

  private headlightMounts: VehicleBeamMount[] = [];
  private taillightMounts: VehicleBeamMount[] = [];
  private reverseLightMounts: VehicleBeamMount[] = [];
  private headlightEnvironmentFactor = 1;
  private headlightMode: HeadlightMode;
  private headlightLensMeshes: THREE.Mesh[] = [];
  private taillightLensMeshes: THREE.Mesh[] = [];
  private reverseLightLensMeshes: THREE.Mesh[] = [];
  /** Keep a loaded lamp snapshot visible until the first simulation step re-evaluates it. */
  private restoredLightStatePending = true;
  /**
   * Each lens role's glows: this car's own lens materials, or a kit car's roles of its one
   * material (render/materials.ts `carLensGlows`). Every control writes all of a role's.
   */
  private readonly headlightLensMaterials: LensGlow[] = [];
  private readonly taillightMaterials: LensGlow[] = [];
  private readonly brakeLightMaterials: LensGlow[] = [];
  private readonly reverseLightMaterials: LensGlow[] = [];
  private readonly leftBlinkerMaterials: LensGlow[] = [];
  private readonly rightBlinkerMaterials: LensGlow[] = [];
  /** The lens materials this car made itself (`lensMaterial`): grimed here, freed in `clear`. */
  private readonly ownLensMaterials: EmissiveMaterial[] = [];
  /** A kit car's one material, whose lens dust is a uniform of its own (`setCarLensGrime`). */
  private kitBody: THREE.Material | null = null;
  private rearLightState = -1;
  private reverseLightState = false;
  private indicatorSide: IndicatorSide = 'off';
  private indicatorElapsed = 0;
  private taillightBeamIntensity = 0;
  private reverseLightBeamIntensity = 0;
  private readonly projectedLightSource = new THREE.Vector3();
  private readonly projectedLightTarget = new THREE.Vector3();
  private indicatorLit = false;
  /** Seconds into a "here I am" double flash of both blinkers; negative when none. */
  private winkElapsed = -1;
  /** Dust on the lenses, 0..1: dims what they show and what they throw. */
  private grime = 0;
  /** The settled tyre contact plane, chassis-local y: what a pool's near rows lie on. */
  private contactPlaneY = 0;
  /**
   * The headlamp pool's terrain rows (`FIRST_SAMPLED_ROW` on): per vertex the ground's
   * absolute height and its road lateral less the car's, kept between samples; and the
   * pose and beam they were sampled for (x NaN: none).
   */
  private readonly poolSamples = new Float64Array(POOL_VERTS * POOL_GRID_STRIDE);
  private poolSampledX = NaN;
  private poolSampledZ = NaN;
  private poolSampledHeading = 0;
  private poolSampledMode: HeadlightMode = 'off';
  /** The car's road frame, taken once a frame it lays a pool (`poolFrameId`). */
  private readonly poolRoad: PoolRoadFrame = { s: NaN, lateral: 0, heading: 0, halfWidth: 0 };
  private poolFrameId = -1;

  constructor(ctx: VehicleLampsContext) {
    this.ctx = ctx;
    this.headlightMode = ctx.car.headlightMode;
  }

  /** Off -> dipped beam -> high beam -> off. */
  cycleHeadlights(): void {
    this.setHeadlights(
      this.headlightMode === 'off' ? 'low' : this.headlightMode === 'low' ? 'high' : 'off',
    );
  }
  /** Sets an exact beam state; autonomous drivers use this instead of cycling UI state. */
  setHeadlights(mode: HeadlightMode): void {
    if (mode === this.headlightMode) return;
    this.restoredLightStatePending = false;
    this.headlightMode = mode;
    this.applyHeadlightMode();
    this.applyRearLightState();
    this.pushState();
  }

  /** The beam state the driver selected. */
  get mode(): HeadlightMode {
    return this.headlightMode;
  }
  /** Sets an exact indicator state; autonomous drivers must not use toggle semantics. */
  setIndicator(side: IndicatorSide): void {
    if (this.indicatorSide === side) return;
    this.indicatorSide = side;
    this.indicatorElapsed = 0;
    this.applyIndicatorState(side !== 'off');
  }

  toggleIndicator(side: 'left' | 'right'): void {
    this.setIndicator(this.indicatorSide === side ? 'off' : side);
  }

  get indicator(): IndicatorSide {
    return this.indicatorSide;
  }

  /** Whether the indicator lamps are lit at this instant of their blink. */
  get blinkerLit(): boolean {
    return this.indicatorLit;
  }

  setEnvironmentFactor(factor: number): void {
    const next = clamp(factor, 0, 1);
    if (next === this.headlightEnvironmentFactor) return;
    this.headlightEnvironmentFactor = next;
    this.applyHeadlightMode();
    this.applyRearLightState(true);
  }

  /**
   * The simulation has produced its own verdict: stop showing the lamp snapshot the
   * save was loaded with and publish live state instead.
   */
  adoptLiveState(): void {
    this.restoredLightStatePending = false;
  }

  /**
   * Dust on every lens of this car, from the body's own dirt. The lens film is the
   * grime shader (render/materials.ts); the beam loss is here, because a dirty
   * headlight is a darker road, not only a duller lamp — and on a night drive through
   * the desert that is the reason to stop and wipe them.
   */
  setGrime(grime: number): void {
    if (grime === this.grime) return;
    this.grime = grime;
    setCarGrime(this.ownLensMaterials, grime);
    if (this.kitBody) setCarLensGrime(this.kitBody, grime);
  }

  /**
   * How brightly lens role `role` (an index into `LENS_ROLE_EMISSIVE`) glows this instant,
   * as it leaves the lens: its lenses' `emissiveIntensity`, which every control above
   * writes to all of a role's lenses at once, through the dust the lens shader takes off
   * it (`GRIME_EMISSIVE` in render/materials.ts; keep the two in step). 0 for a role the
   * model has no lens for.
   */
  lensLevel(role: number): number {
    const materials =
      role === 0 ? this.headlightLensMaterials
      : role === 1 ? this.taillightMaterials
      : role === 2 ? this.brakeLightMaterials
      : role === 3 ? this.reverseLightMaterials
      : role === 4 ? this.leftBlinkerMaterials
      : this.rightBlinkerMaterials;
    const film = Math.min(1.1 * this.grime, 1);
    return (materials[0]?.emissiveIntensity ?? 0) * (1 - 0.8 * film);
  }

  /** Share of a beam that gets through the dust on its lens. */
  private get beamThroughGrime(): number {
    return 1 - LENS_GRIME_BEAM_LOSS * this.grime;
  }

  /**
   * Two quick flashes of all four blinkers, the way a car answers its key fob: the
   * sticker envelope uses it to say "this one" without a marker in the world.
   */
  wink(): void {
    this.winkElapsed = 0;
  }

  /** Advances the blinker phase by one step; a parked car blinks too. */
  advance(dt: number): void {
    if (this.winkElapsed >= 0) {
      this.winkElapsed += dt;
      const t = this.winkElapsed;
      const lit = t < WINK_FLASH_S || (t > WINK_FLASH_S * 2 && t < WINK_FLASH_S * 3);
      if (t > WINK_FLASH_S * 3.5) {
        this.winkElapsed = -1;
        this.applyIndicatorState(this.indicatorLit);
      } else {
        const on = (materials: readonly LensGlow[]): void => {
          for (const material of materials) {
            material.emissive.setHex(lit ? BLINKER_EMISSIVE : 0x000000);
            material.emissiveIntensity = lit ? 5 : 0;
          }
        };
        on(this.leftBlinkerMaterials);
        on(this.rightBlinkerMaterials);
      }
      return;
    }
    if (this.indicatorSide === 'off') {
      if (this.indicatorLit) this.applyIndicatorState(false);
      return;
    }
    this.indicatorElapsed = (this.indicatorElapsed + dt) % BLINKER_PERIOD_S;
    const lit = this.indicatorElapsed < BLINKER_PERIOD_S * 0.5;
    if (lit !== this.indicatorLit) this.applyIndicatorState(lit);
  }

  /**
   * True while any lamp on this vehicle is emitting. Lets the caller skip dark
   * vehicles entirely and order the lit ones before they claim rig slots.
   */
  anyLit(): boolean {
    return (
      (this.headlightMode !== 'off' && this.headlightEnvironmentFactor > 0) ||
      this.taillightBeamIntensity > 0 ||
      this.reverseLightBeamIntensity > 0
    );
  }

  /** Mounts of one beam group, and the intensity it projects at full gain. */
  private beamGroup(group: BeamGroup): { mounts: readonly VehicleBeamMount[]; intensity: number } {
    const out = this.beamGroupScratch;
    if (group === 'front') {
      out.mounts = this.headlightMounts;
      out.intensity =
        this.headlightMode === 'off'
          ? 0
          : (this.headlightMode === 'high' ? HEADLIGHT_HIGH : HEADLIGHT_LOW).intensity *
            this.headlightEnvironmentFactor;
    } else if (group === 'tail') {
      out.mounts = this.taillightMounts;
      out.intensity = this.taillightBeamIntensity;
    } else {
      out.mounts = this.reverseLightMounts;
      out.intensity = this.reverseLightBeamIntensity;
    }
    out.intensity *= this.beamThroughGrime;
    return out;
  }
  private readonly beamGroupScratch: { mounts: readonly VehicleBeamMount[]; intensity: number } = {
    mounts: [],
    intensity: 0,
  };

  /**
   * Pool spotlights `group` projects while lit: one per lamp, or one fewer than its
   * lamps when `shadowed` (one lamp takes the rig's shadowed beam instead). Zero while
   * it is dark, so a dark group asks the pool nothing.
   */
  beamCount(group: BeamGroup, shadowed = false): number {
    const { mounts, intensity } = this.beamGroup(group);
    if (mounts.length === 0 || !(intensity > 0)) return 0;
    return shadowed ? mounts.length - 1 : mounts.length;
  }

  /**
   * Offers one LIT lamp group to the shared rig, projected from local mounts through
   * the interpolated render pose. Called for every live vehicle, not just the driven
   * one: a lamp that is on casts a beam whoever left it on, so a restored save and a
   * car abandoned with its headlights burning both light the ground. The caller has
   * already secured `beamCount(group)` slots for it (render/slotpool.ts).
   *
   * `gain` scales the beam. The driven car is offered 1: its own beams are the only
   * way to read the road at night and MUST NOT be touched. Every other car is offered
   * its range fade (`ambientBeamGain`) times its share of the pool.
   *
   * Every lamp is its own beam, other cars' included. Traffic used to project a pair
   * as ONE spotlight from between the lamps, to carry twice as many cars in the pool;
   * up close two lit headlamps then laid one pool in the road.
   *
   * `shadowed` sends ONE lamp, the driver's side one (the largest local x), to the rig's
   * shadow-casting spotlight (`VehicleLightRig.addShadowBeam`) and every other lamp to a
   * pool slot of its own (`beamCount(group, true)`): the driven car's headlamps,
   * where the tier draws shadows. The pair used to go to the shadowed beam as one light
   * from between the lamps, so the car laid ONE pool and one glint in the road; two
   * shadowed lamps measured +4 ms, so the other lamp lights without a shadow and thins
   * the first one's shadows as a second real lamp does.
   */
  syncProjectedLights(
    rig: VehicleLightRig,
    group: BeamGroup,
    gain: number,
    shadowed: boolean,
  ): void {
    if (!(gain > 0)) return;
    const { mounts, intensity } = this.beamGroup(group);
    if (mounts.length === 0 || !(intensity > 0)) return;
    const shape = this.beamShape(group);
    const color = beamColor(group);
    const distanceScale = group === 'front' ? rig.headlightDistanceScale : 1;
    let shadowMount: VehicleBeamMount | null = null;
    if (shadowed) {
      for (const mount of mounts) if (!shadowMount || mount.sourceLocal.x > shadowMount.sourceLocal.x) shadowMount = mount;
    }
    for (const mount of mounts) {
      this.projectBeam(rig, mount, color, intensity * gain, shape, distanceScale, mount === shadowMount);
    }
  }

  /** One spotlight from `mount`. */
  private projectBeam(
    rig: VehicleLightRig,
    mount: VehicleBeamMount,
    color: THREE.ColorRepresentation,
    intensity: number,
    shape: ProjectedBeamShape,
    distanceScale: number,
    shadowed: boolean,
  ): void {
    const sourceWorld = this.projectedLightSource.copy(mount.sourceLocal);
    const targetWorld = this.projectedLightTarget.copy(mount.aimLocal);
    sourceWorld.applyQuaternion(this.ctx.rootGroup.quaternion).add(this.ctx.rootGroup.position);
    targetWorld.applyQuaternion(this.ctx.rootGroup.quaternion).add(this.ctx.rootGroup.position);
    (shadowed ? rig.addShadowBeam : rig.addBeam).call(
      rig,
      sourceWorld,
      targetWorld,
      color,
      intensity,
      shape.distance * distanceScale,
      shape.angle,
      shape.penumbra,
      shape.decay,
    );
  }

  /** The beam a lit group projects, by group and, for the headlamps, by mode. */
  private beamShape(group: BeamGroup): ProjectedBeamShape {
    if (group === 'front') return this.headlightMode === 'high' ? HEADLIGHT_HIGH : HEADLIGHT_LOW;
    return group === 'tail' ? TAILLIGHT_BEAM : REVERSE_LIGHT_BEAM;
  }

  /** `point` in chassis-local coordinates, moved to the scene through the render pose. */
  private toScene(point: THREE.Vector3): THREE.Vector3 {
    return point.applyQuaternion(this.ctx.rootGroup.quaternion).add(this.ctx.rootGroup.position);
  }

  /**
   * How much of this car's headlamp light the player sees: render/lamppools.ts
   * `LampView` says what the score is and why. Zero while the headlamps are dark.
   * `distanceScale` is the rig's headlamp reach scale.
   */
  headlampViewScore(view: LampView, distanceScale: number): number {
    const { mounts, intensity } = this.beamGroup('front');
    if (mounts.length === 0 || !(intensity > 0)) return 0;
    const shape = this.beamShape('front');
    const first = mounts[0];
    const last = mounts[mounts.length - 1];
    const midX = (first.sourceLocal.x + last.sourceLocal.x) / 2;
    const midZ = (first.sourceLocal.z + last.sourceLocal.z) / 2;
    const lamp = this.toScene(_poolLampA.copy(first.sourceLocal).add(last.sourceLocal).multiplyScalar(0.5));
    const axis = _poolAxis
      .subVectors(first.aimLocal, first.sourceLocal)
      .applyQuaternion(this.ctx.rootGroup.quaternion)
      .normalize();
    const up = _poolUp.set(0, 1, 0).applyQuaternion(this.ctx.rootGroup.quaternion);
    const coneCos = Math.cos(shape.angle);
    const penumbraCos = Math.cos(shape.angle * (1 - shape.penumbra));
    const cutoff = shape.distance * distanceScale;
    const spread = Math.tan(shape.angle) * POOL_SPREAD;
    let score = 0;
    for (let row = 0; row < SCORE_ROWS.length; row++) {
      const ahead = SCORE_ROWS[row];
      // Each sample stands for a third of the row's width.
      const area = (SCORE_ROW_DEPTH[row] * 2 * ahead * spread) / SCORE_ACROSS.length;
      for (const across of SCORE_ACROSS) {
        const point = this.toScene(_poolPoint.set(midX + across * ahead * spread, this.contactPlaneY, midZ + ahead));
        const weight = view.groundWeight(point, area);
        if (weight > 0) {
          score += weight * spotIrradiance(lamp, axis, point, up, coneCos, penumbraCos, shape.decay, cutoff);
        }
      }
    }
    const car = view.carTarget();
    if (car !== null) {
      const weight = view.carWeight();
      if (weight > 0) {
        score +=
          CAR_LIGHT_WEIGHT * weight * spotIrradiance(lamp, axis, car, null, coneCos, penumbraCos, shape.decay, cutoff);
      }
    }
    return score * intensity * mounts.length;
  }

  /**
   * Lays one LIT lamp group's light on the ground as a pool (render/lamppools.ts), for
   * a group that holds no spotlight slot, or as the rest of one fading between the two:
   * `gain` is the range fade times the share the slot does not show.
   *
   * The grid follows the beam: from the lamps out along the car's own axis, as wide as
   * the cone. Its near rows lie on the tyre contact plane, rebuilt every frame from the
   * render pose; a headlamp's far rows lie where the beam is this frame, at the terrain
   * height sampled when the car had last moved a metre or turned two degrees, as the
   * field's per-frame allowance goes round (main.ts starts its walk at a different car
   * each frame). The pool's depth is pulled toward the eye (render/lamppools.ts), so the
   * chords between rows, a road's crown and a race track's raised asphalt never bury it.
   */
  syncLampPool(field: LampPoolField, group: BeamGroup, gain: number): void {
    if (!(gain > 0)) return;
    const { mounts, intensity } = this.beamGroup(group);
    if (mounts.length === 0 || !(intensity > 0)) return;
    const shape = this.beamShape(group);
    const front = group === 'front';
    const rows = front
      ? this.headlightMode === 'high'
        ? HIGH_POOL_ROWS
        : LOW_POOL_ROWS
      : group === 'tail'
        ? TAIL_POOL_ROWS
        : REVERSE_POOL_ROWS;
    const first = mounts[0];
    const last = mounts[mounts.length - 1];
    const midX = (first.sourceLocal.x + last.sourceLocal.x) / 2;
    const midZ = (first.sourceLocal.z + last.sourceLocal.z) / 2;
    const halfSpacing = Math.abs(last.sourceLocal.x - first.sourceLocal.x) / 2;
    const spread = Math.tan(shape.angle) * POOL_SPREAD;
    const along = front ? 1 : -1;
    if (front && !this.samplePoolTerrain(field, rows, midX, midZ, halfSpacing, spread)) return;
    const grid = _poolGrid;
    // Near rows: the car's own lateral, carried across the road by the offset from it.
    const road = this.roadFrameAt(field);
    const root = this.ctx.rootGroup.position;
    const cos = Math.cos(road.heading);
    const sin = Math.sin(road.heading);
    for (let row = 0; row < POOL_ROWS; row++) {
      const ahead = rows[row];
      const halfWidth = halfSpacing + Math.max(POOL_MIN_HALF_WIDTH_M, ahead * spread);
      const sampled = front && row >= FIRST_SAMPLED_ROW;
      for (let column = 0; column < POOL_COLS; column++) {
        const v = (row * POOL_COLS + column) * POOL_GRID_STRIDE;
        const point = this.toScene(
          _poolPoint.set(midX + (column - 1) * halfWidth, this.contactPlaneY + POOL_LIFT_M, midZ + along * ahead),
        );
        grid[v] = point.x;
        grid[v + 2] = point.z;
        if (sampled) {
          // Where the car's beam is NOW, at the ground's height sampled a frame or a few
          // ago: the grid travels with the car and never lags or snaps across the road.
          grid[v + 1] = this.poolSamples[v];
          grid[v + 3] = road.lateral + this.poolSamples[v + 1];
        } else {
          grid[v + 1] = point.y;
          grid[v + 3] = road.lateral + (point.x - root.x) * cos - (point.z - root.z) * sin;
        }
      }
    }
    const lampA = this.toScene(_poolLampA.copy(first.sourceLocal));
    const lampB = this.toScene(_poolLampB.copy(last.sourceLocal));
    const axis = _poolAxis
      .subVectors(first.aimLocal, first.sourceLocal)
      .applyQuaternion(this.ctx.rootGroup.quaternion)
      .normalize();
    // Two lamps per group by construction; any more are carried by the outer pair.
    const scale = intensity * gain * LAMP_EXPOSURE * (mounts.length / 2);
    const color = _poolColor.set(beamColor(group));
    field.add(
      grid,
      road.halfWidth,
      lampA,
      lampB,
      axis,
      color.r * scale,
      color.g * scale,
      color.b * scale,
      Math.cos(shape.angle),
      Math.cos(shape.angle * (1 - shape.penumbra)),
      shape.decay,
      shape.distance * (front ? field.headlightDistanceScale : 1),
    );
  }

  /** The car's road frame this frame, taken at most once a frame. */
  private roadFrameAt(field: LampPoolField): PoolRoadFrame {
    if (this.poolFrameId !== field.frameId) {
      this.poolFrameId = field.frameId;
      const root = this.ctx.rootGroup.position;
      field.roadFrame(root.x + field.originX, root.z + field.originZ, this.poolRoad.s, this.poolRoad);
    }
    return this.poolRoad;
  }

  /**
   * Brings the headlamp pool's terrain rows up to date if the car has moved on and the
   * field still has samples this frame. @returns false when this beam has never been
   * sampled: the pool waits a frame or two for its turn rather than lying on the tyre
   * plane, which ran 75 m out ahead and dived under the first rise (owner, 2026-10-29).
   */
  private samplePoolTerrain(
    field: LampPoolField,
    rows: readonly number[],
    midX: number,
    midZ: number,
    halfSpacing: number,
    spread: number,
  ): boolean {
    const root = this.ctx.rootGroup;
    const x = root.position.x + field.originX;
    const z = root.position.z + field.originZ;
    const forward = _poolPoint.set(0, 0, 1).applyQuaternion(root.quaternion);
    const heading = Math.atan2(forward.x, forward.z);
    const turn = heading - this.poolSampledHeading;
    const moved = Math.hypot(x - this.poolSampledX, z - this.poolSampledZ);
    const sameBeam = this.poolSampledMode === this.headlightMode && Number.isFinite(this.poolSampledX);
    const fresh =
      sameBeam && moved <= POOL_RESAMPLE_M && Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn))) <= POOL_RESAMPLE_RAD;
    if (fresh || !field.takeSamples((POOL_ROWS - FIRST_SAMPLED_ROW) * POOL_COLS)) return sameBeam;
    const car = this.roadFrameAt(field);
    const at = _poolRoadSample;
    for (let row = FIRST_SAMPLED_ROW; row < POOL_ROWS; row++) {
      const ahead = rows[row];
      const halfWidth = halfSpacing + Math.max(POOL_MIN_HALF_WIDTH_M, ahead * spread);
      for (let column = 0; column < POOL_COLS; column++) {
        const point = this.toScene(_poolPoint.set(midX + (column - 1) * halfWidth, this.contactPlaneY, midZ + ahead));
        const sx = point.x + field.originX;
        const sz = point.z + field.originZ;
        field.roadFrame(sx, sz, car.s, at);
        const v = (row * POOL_COLS + column) * POOL_GRID_STRIDE;
        this.poolSamples[v] = field.groundHeight(sx, sz, at.s) + POOL_LIFT_M;
        this.poolSamples[v + 1] = at.lateral - car.lateral;
      }
    }
    this.poolSampledX = x;
    this.poolSampledZ = z;
    this.poolSampledHeading = heading;
    this.poolSampledMode = this.headlightMode;
    return true;
  }

  /**
   * Rebinds the model's authored lamp materials and rebuilds every beam mount off
   * the freshly instantiated body.
   *
   * `halfExtents` is the measured chassis box and `contactPlaneY` the settled tyre
   * contact plane: a pack with no lamp metadata places its headlights from those.
   */
  build(halfExtents: readonly [number, number, number], contactPlaneY: number): void {
    this.contactPlaneY = contactPlaneY;
    this.poolSampledX = NaN;
    this.bindVehicleLights();
    this.buildHeadlightMounts(halfExtents, contactPlaneY);
    this.buildRearLightMounts(this.taillightLensMeshes, TAILLIGHT_BEAM, this.taillightMounts);
    this.buildRearLightMounts(
      this.reverseLightLensMeshes,
      REVERSE_LIGHT_BEAM,
      this.reverseLightMounts,
    );
    this.applyRearLightState();
  }

  /**
   * Binds the lenses `selectors` names to `output`; `role` is their index in
   * `LENS_ROLE_EMISSIVE`, which picks a kit car's glow of that role.
   */
  private bindLampMaterials(
    selectors: readonly string[] | undefined,
    output: LensGlow[],
    role: number,
  ): THREE.Mesh[] {
    if (!selectors || selectors.length === 0) return [];
    const wanted = new Set(selectors);
    const meshes: THREE.Mesh[] = [];
    this.ctx.rootGroup.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      let matched = false;
      const bind = (source: THREE.Material): THREE.Material => {
        if (!isLampLens(wanted, object, source)) return source;
        matched = true;
        const glows = carLensGlows(source);
        if (glows) {
          this.kitBody = source;
          setCarLensGrime(source, this.grime);
          if (!output.includes(glows[role]!)) output.push(glows[role]!);
          return source;
        }
        if (
          !(source instanceof THREE.MeshStandardMaterial) &&
          !(source instanceof THREE.MeshPhongMaterial)
        ) {
          throw new Error(
            `Car model "${this.ctx.model.id}" lamp material cannot emit light: ${source.name}`,
          );
        }
        const material = lensMaterial(source);
        setCarGrime([material], this.grime);
        this.ownLensMaterials.push(material);
        output.push(material);
        return material;
      };
      object.material = Array.isArray(object.material)
        ? object.material.map(bind)
        : bind(object.material);
      if (matched) meshes.push(object);
    });
    if (output.length === 0) {
      throw new Error(
        `Car model "${this.ctx.model.id}" is missing authored lamp selectors: ${selectors.join(', ')}`,
      );
    }
    return meshes;
  }

  private bindVehicleLights(): void {
    const lights = this.ctx.model.lights;
    if (!lights) return;
    this.headlightLensMeshes = this.bindLampMaterials(
      lights.headlights,
      this.headlightLensMaterials,
      0,
    );
    this.taillightLensMeshes = this.bindLampMaterials(
      lights.taillights,
      this.taillightMaterials,
      1,
    );
    this.bindLampMaterials(lights.brakeLights, this.brakeLightMaterials, 2);
    this.reverseLightLensMeshes = this.bindLampMaterials(
      lights.reverseLights,
      this.reverseLightMaterials,
      3,
    );
    this.bindLampMaterials(lights.leftBlinkers, this.leftBlinkerMaterials, 4);
    this.bindLampMaterials(lights.rightBlinkers, this.rightBlinkerMaterials, 5);
    this.rearLightState = -1;
    this.reverseLightState = false;
    this.applyIndicatorState(false);
  }

  private lampBounds(meshes: readonly THREE.Mesh[]): THREE.Box3 {
    this.ctx.rootGroup.updateMatrixWorld(true);
    const worldToRoot = this.ctx.rootGroup.matrixWorld.clone().invert();
    const bounds = new THREE.Box3();
    for (const mesh of meshes) {
      mesh.geometry.computeBoundingBox();
      const meshBounds = mesh.geometry.boundingBox;
      if (!meshBounds) continue;
      bounds.union(
        meshBounds
          .clone()
          .applyMatrix4(worldToRoot.clone().multiply(mesh.matrixWorld)),
      );
    }
    return bounds;
  }

  private buildRearLightMounts(
    lenses: readonly THREE.Mesh[],
    shape: {
      readonly targetDistance: number;
      readonly targetDrop: number;
    },
    output: VehicleBeamMount[],
  ): void {
    if (lenses.length === 0) return;
    const box = this.lampBounds(lenses);
    const centre = box.getCenter(new THREE.Vector3());
    const halfWidth = Math.max(0.1, (box.max.x - box.min.x) * 0.325);
    const z = box.min.z - 0.015;
    for (const sign of [-1, 1]) {
      const x = centre.x + sign * halfWidth;
      output.push({
        sourceLocal: new THREE.Vector3(x, centre.y, z),
        aimLocal: new THREE.Vector3(
          x,
          centre.y - shape.targetDrop,
          z - shape.targetDistance,
        ),
      });
    }
  }

  /**
   * Headlight mounts follow authored lamp bounds when available. Models without
   * lamp metadata retain the measured-chassis fallback used by static/wreck packs.
   */
  private buildHeadlightMounts(
    halfExtents: readonly [number, number, number],
    contactPlaneY: number,
  ): void {
    let centreX = 0;
    let halfWidth = HEADLIGHT_X_FRACTION * halfExtents[0];
    // Headlight height is measured from the settled contact plane, so a low skirt
    // or oddly-centred model cannot put the light source below an uphill surface.
    let y = Math.max(
      -halfExtents[1] + HEADLIGHT_Y_FRACTION * 2 * halfExtents[1],
      contactPlaneY + HEADLIGHT_MIN_HEIGHT,
    );
    let z = halfExtents[2];
    if (this.headlightLensMeshes.length > 0) {
      const box = this.lampBounds(this.headlightLensMeshes);
      const centre = box.getCenter(new THREE.Vector3());
      centreX = centre.x;
      halfWidth = Math.max(0.1, (box.max.x - box.min.x) * 0.325);
      y = centre.y;
      z = box.max.z;
    }
    for (const sign of [-1, 1]) {
      const x = centreX + sign * halfWidth;
      this.headlightMounts.push({
        sourceLocal: new THREE.Vector3(x, y, z),
        aimLocal: new THREE.Vector3(
          x,
          y - HEADLIGHT_LOW.targetDrop,
          z + HEADLIGHT_LOW.targetDistance,
        ),
      });
    }
    this.applyHeadlightMode();
  }

  private applyHeadlightMode(): void {
    const beam =
      this.headlightMode === 'high'
        ? HEADLIGHT_HIGH
        : this.headlightMode === 'low'
          ? HEADLIGHT_LOW
          : null;
    const shape = beam ?? HEADLIGHT_LOW;
    for (const headlight of this.headlightMounts) {
      headlight.aimLocal.set(
        headlight.sourceLocal.x,
        headlight.sourceLocal.y - shape.targetDrop,
        headlight.sourceLocal.z + shape.targetDistance,
      );
    }
    const intensity = this.headlightMode === 'high' ? 3 : this.headlightMode === 'low' ? 2.4 : 0;
    for (const material of this.headlightLensMaterials) {
      material.emissive.setHex(intensity > 0 ? HEADLIGHT_EMISSIVE : 0x000000);
      material.emissiveIntensity = intensity;
    }
  }

  /**
   * Re-applies the rear lens emission and beam intensities from the current brake
   * command, gear and beam mode. `force` does so even when the running/braking state
   * is unchanged, which is what a change of ambient gain needs.
   */
  applyRearLightState(force = false): void {
    const braking = !this.restoredLightStatePending && this.ctx.brakeCommand() > 0.03;
    const running = this.restoredLightStatePending
      ? this.ctx.car.taillightsOn
      : this.headlightMode !== 'off';
    const next = (running ? 1 : 0) | (braking ? 2 : 0);
    if (force || next !== this.rearLightState) {
      this.rearLightState = next;
      const combinedRearLens = this.brakeLightMaterials.length === 0;
      let runningIntensity = running ? 0.55 : 0;
      if (combinedRearLens && braking) runningIntensity = BRAKE_LENS_INTENSITY;
      for (const material of this.taillightMaterials) {
        material.emissive.setHex(runningIntensity > 0 ? TAILLIGHT_EMISSIVE : 0x000000);
        material.emissiveIntensity = runningIntensity;
      }
      const brakeIntensity = braking ? BRAKE_LENS_INTENSITY : 0;
      for (const material of this.brakeLightMaterials) {
        material.emissive.setHex(brakeIntensity > 0 ? TAILLIGHT_EMISSIVE : 0x000000);
        material.emissiveIntensity = brakeIntensity;
      }
      const authoredBeamIntensity = braking
        ? TAILLIGHT_BEAM.brakeIntensity
        : running
          ? TAILLIGHT_BEAM.runningIntensity
          : 0;
      this.taillightBeamIntensity = authoredBeamIntensity * this.headlightEnvironmentFactor;
    }
    const reversing = this.restoredLightStatePending
      ? this.ctx.car.reverseLightsOn
      : this.ctx.reversing();
    if (!force && reversing === this.reverseLightState) return;
    this.reverseLightState = reversing;
    for (const material of this.reverseLightMaterials) {
      material.emissive.setHex(reversing ? REVERSE_LIGHT_EMISSIVE : 0x000000);
      material.emissiveIntensity = reversing ? 4 : 0;
    }
    this.reverseLightBeamIntensity = reversing
      ? REVERSE_LIGHT_BEAM.intensity * this.headlightEnvironmentFactor
      : 0;
  }

  private applyIndicatorState(lit: boolean): void {
    this.indicatorLit = lit;
    const apply = (materials: readonly LensGlow[], active: boolean): void => {
      for (const material of materials) {
        material.emissive.setHex(active ? BLINKER_EMISSIVE : 0x000000);
        material.emissiveIntensity = active ? 5 : 0;
      }
    };
    const hazard = this.indicatorSide === 'hazard';
    apply(this.leftBlinkerMaterials, lit && (hazard || this.indicatorSide === 'left'));
    apply(this.rightBlinkerMaterials, lit && (hazard || this.indicatorSide === 'right'));
  }

  /** Releases this car's per-instance lamp materials and forgets every mount. */
  clear(): void {
    for (const material of this.ownLensMaterials) material.dispose();
    this.ownLensMaterials.length = 0;
    this.kitBody = null;
    this.headlightMounts = [];
    this.taillightMounts = [];
    this.reverseLightMounts = [];
    this.headlightLensMeshes = [];
    this.taillightLensMeshes = [];
    this.reverseLightLensMeshes = [];
    this.headlightLensMaterials.length = 0;
    this.taillightMaterials.length = 0;
    this.brakeLightMaterials.length = 0;
    this.reverseLightMaterials.length = 0;
    this.leftBlinkerMaterials.length = 0;
    this.rightBlinkerMaterials.length = 0;
    this.rearLightState = -1;
    this.reverseLightState = false;
    this.taillightBeamIntensity = 0;
    this.reverseLightBeamIntensity = 0;
    this.indicatorLit = false;
  }

  /** Publishes the lamp state as a delta when it differs from the saved snapshot. */
  pushState(): void {
    const taillightsOn = this.rearLightState > 0;
    const reverseLightsOn = this.reverseLightState;
    if (
      this.ctx.car.headlightMode === this.headlightMode &&
      this.ctx.car.taillightsOn === taillightsOn &&
      this.ctx.car.reverseLightsOn === reverseLightsOn
    ) {
      return;
    }
    this.ctx.world.apply({
      t: 'car_lights',
      carId: this.ctx.car.id,
      headlightMode: this.headlightMode,
      taillightsOn,
      reverseLightsOn,
    });
  }
}
