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
import type { VehicleLightRig } from '../render/vehiclelights';
import { addWetGlare } from '../render/cloudshadow';

/**
 * A vehicle's lamps as the light pool sees them: each group is lit or dark as a
 * whole and holds its slots as a whole (render/slotpool.ts). Headlamps, the running
 * and stop glow, and the reversing lamps are separate because they switch
 * separately; the index of a group in `BEAM_GROUPS` is its pool key.
 */
export const BEAM_GROUPS = ['front', 'tail', 'reverse'] as const;
export type BeamGroup = (typeof BEAM_GROUPS)[number];
import { makeCarGrimeMaterial, setCarGrime } from '../render/materials';
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
export type IndicatorSide = 'off' | 'left' | 'right';

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

const TAILLIGHT_BEAM = {
  distance: 6,
  angle: 0.68,
  penumbra: 0.78,
  decay: 1.4,
  targetDistance: 3.5,
  targetDrop: 0.12,
  runningIntensity: 6,
  brakeIntensity: 24,
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
 * Never bound into `root` and never drawn (see carmodel.ts, program anchors).
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
      if (!isLampLens(selectors, object, source)) continue;
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
  private readonly headlightLensMaterials: EmissiveMaterial[] = [];
  private readonly taillightMaterials: EmissiveMaterial[] = [];
  private readonly brakeLightMaterials: EmissiveMaterial[] = [];
  private readonly reverseLightMaterials: EmissiveMaterial[] = [];
  private readonly leftBlinkerMaterials: EmissiveMaterial[] = [];
  private readonly rightBlinkerMaterials: EmissiveMaterial[] = [];
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

  toggleIndicator(side: Exclude<IndicatorSide, 'off'>): void {
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
    for (const list of this.lampMaterialLists()) setCarGrime(list, grime);
  }

  private lampMaterialLists(): readonly EmissiveMaterial[][] {
    return [
      this.headlightLensMaterials,
      this.taillightMaterials,
      this.brakeLightMaterials,
      this.reverseLightMaterials,
      this.leftBlinkerMaterials,
      this.rightBlinkerMaterials,
    ];
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
        const on = (materials: readonly EmissiveMaterial[]): void => {
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
   * Spotlights `group` projects while lit: one per lamp, or a single one for the
   * pair when `merged`. Zero while it is dark, so a dark group asks the pool nothing.
   */
  beamCount(group: BeamGroup, merged: boolean): number {
    const { mounts, intensity } = this.beamGroup(group);
    if (mounts.length === 0 || !(intensity > 0)) return 0;
    return merged ? 1 : mounts.length;
  }

  /**
   * Offers one LIT lamp group to the shared rig, projected from local mounts through
   * the interpolated render pose. Called for every live vehicle, not just the driven
   * one: a lamp that is on casts a beam whoever left it on, so a restored save and a
   * car abandoned with its headlights burning both light the ground. The caller has
   * already secured `beamCount(group, merged)` slots for it (render/slotpool.ts).
   *
   * `gain` scales the beam. The driven car is offered 1: its own beams are the only
   * way to read the road at night and MUST NOT be touched. Every other car is offered
   * its range fade (`ambientBeamGain`) times its share of the pool.
   *
   * `merged` projects a lamp pair as ONE spotlight from between the two, carrying
   * both lamps' light. Other cars are drawn that way: at the range their pools are
   * seen from, two cones a metre apart are one pool of light, and the pool then
   * carries twice as many cars as it would lamps.
   */
  syncProjectedLights(rig: VehicleLightRig, group: BeamGroup, gain: number, merged: boolean): void {
    if (!(gain > 0)) return;
    const { mounts, intensity } = this.beamGroup(group);
    if (mounts.length === 0 || !(intensity > 0)) return;
    const shape: ProjectedBeamShape =
      group === 'front'
        ? this.headlightMode === 'high'
          ? HEADLIGHT_HIGH
          : HEADLIGHT_LOW
        : group === 'tail'
          ? TAILLIGHT_BEAM
          : REVERSE_LIGHT_BEAM;
    const color =
      group === 'front' ? HEADLIGHT_BEAM_TINT : group === 'tail' ? TAILLIGHT_EMISSIVE : REVERSE_LIGHT_EMISSIVE;
    const distanceScale = group === 'front' ? rig.headlightDistanceScale : 1;
    if (merged) {
      this.projectBeam(rig, mounts, color, intensity * gain * mounts.length, shape, distanceScale);
      return;
    }
    for (const mount of mounts) {
      this.projectBeam(rig, mount, color, intensity * gain, shape, distanceScale);
    }
  }

  /**
   * Headlamps this car would lay in the road for an eye at `eye` (scene space): both,
   * or none while they are off or point away from it. A lamp aimed away draws no
   * streak at all (the shader's `aim`), so it must not hold one of the few streaks the
   * road can draw while an oncoming car waits for it.
   */
  wetGlareLamps(eye: THREE.Vector3): number {
    if (this.headlightMode === 'off' || !(this.headlightEnvironmentFactor > 0)) return 0;
    const root = this.ctx.rootGroup;
    const forward = this.projectedLightTarget.set(0, 0, 1).applyQuaternion(root.quaternion);
    const facing = forward.x * (eye.x - root.position.x) + forward.z * (eye.z - root.position.z);
    return facing > 0 ? this.headlightMounts.length : 0;
  }

  /**
   * Offers the lit headlamps to the road's reflection streaks (`render/cloudshadow.ts`),
   * scaled by `share`, this car's hold on the streak list. Not range-faded like the
   * projected beams: the streak of a lamp in the road is seen as far as the lamp is.
   */
  offerWetGlare(share: number): void {
    if (this.headlightMode === 'off') return;
    const strength =
      (this.headlightMode === 'high' ? 1.4 : 1) *
      this.headlightEnvironmentFactor *
      this.beamThroughGrime *
      share;
    if (!(strength > 0)) return;
    const q = this.ctx.rootGroup.quaternion;
    for (const mount of this.headlightMounts) {
      const source = this.projectedLightSource.copy(mount.sourceLocal).applyQuaternion(q).add(this.ctx.rootGroup.position);
      const forward = this.projectedLightTarget
        .copy(mount.aimLocal)
        .sub(mount.sourceLocal)
        .applyQuaternion(q)
        .normalize();
      addWetGlare(source, forward, strength);
    }
  }

  /** One spotlight from `mount`, or from between all of `mount`'s lamps. */
  private projectBeam(
    rig: VehicleLightRig,
    mount: VehicleBeamMount | readonly VehicleBeamMount[],
    color: THREE.ColorRepresentation,
    intensity: number,
    shape: ProjectedBeamShape,
    distanceScale: number,
  ): void {
    const sourceWorld = this.projectedLightSource;
    const targetWorld = this.projectedLightTarget;
    if (Array.isArray(mount)) {
      sourceWorld.set(0, 0, 0);
      targetWorld.set(0, 0, 0);
      for (const lamp of mount as readonly VehicleBeamMount[]) {
        sourceWorld.add(lamp.sourceLocal);
        targetWorld.add(lamp.aimLocal);
      }
      sourceWorld.multiplyScalar(1 / mount.length);
      targetWorld.multiplyScalar(1 / mount.length);
    } else {
      const lamp = mount as VehicleBeamMount;
      sourceWorld.copy(lamp.sourceLocal);
      targetWorld.copy(lamp.aimLocal);
    }
    sourceWorld.applyQuaternion(this.ctx.rootGroup.quaternion).add(this.ctx.rootGroup.position);
    targetWorld.applyQuaternion(this.ctx.rootGroup.quaternion).add(this.ctx.rootGroup.position);
    rig.addBeam(
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


  /**
   * Rebinds the model's authored lamp materials and rebuilds every beam mount off
   * the freshly instantiated body.
   *
   * `halfExtents` is the measured chassis box and `contactPlaneY` the settled tyre
   * contact plane: a pack with no lamp metadata places its headlights from those.
   */
  build(halfExtents: readonly [number, number, number], contactPlaneY: number): void {
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

  private bindLampMaterials(
    selectors: readonly string[] | undefined,
    output: EmissiveMaterial[],
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
    );
    this.taillightLensMeshes = this.bindLampMaterials(
      lights.taillights,
      this.taillightMaterials,
    );
    this.bindLampMaterials(lights.brakeLights, this.brakeLightMaterials);
    this.reverseLightLensMeshes = this.bindLampMaterials(
      lights.reverseLights,
      this.reverseLightMaterials,
    );
    this.bindLampMaterials(lights.leftBlinkers, this.leftBlinkerMaterials);
    this.bindLampMaterials(lights.rightBlinkers, this.rightBlinkerMaterials);
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
      if (combinedRearLens && braking) runningIntensity = 6;
      for (const material of this.taillightMaterials) {
        material.emissive.setHex(runningIntensity > 0 ? TAILLIGHT_EMISSIVE : 0x000000);
        material.emissiveIntensity = runningIntensity;
      }
      const brakeIntensity = braking ? 6 : 0;
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
    const apply = (materials: readonly EmissiveMaterial[], active: boolean): void => {
      for (const material of materials) {
        material.emissive.setHex(active ? BLINKER_EMISSIVE : 0x000000);
        material.emissiveIntensity = active ? 5 : 0;
      }
    };
    apply(this.leftBlinkerMaterials, lit && this.indicatorSide === 'left');
    apply(this.rightBlinkerMaterials, lit && this.indicatorSide === 'right');
  }

  /** Releases this car's per-instance lamp materials and forgets every mount. */
  clear(): void {
    for (const material of this.headlightLensMaterials) material.dispose();
    for (const material of this.taillightMaterials) material.dispose();
    for (const material of this.brakeLightMaterials) material.dispose();
    for (const material of this.reverseLightMaterials) material.dispose();
    for (const material of this.leftBlinkerMaterials) material.dispose();
    for (const material of this.rightBlinkerMaterials) material.dispose();
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
