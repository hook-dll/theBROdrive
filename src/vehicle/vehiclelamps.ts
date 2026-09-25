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
import type { WetGlints } from '../render/wetglints';
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

/** Lens emission stays white-hot; only the light it THROWS carries the filament's warmth. */
const HEADLIGHT_EMISSIVE = 0xffffff;
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

  /** Advances the blinker phase by one step; a parked car blinks too. */
  advance(dt: number): void {
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

  /**
   * Offers this vehicle's LIT lamps to the shared rig, projected from local mounts
   * through the interpolated render pose. Called for every live vehicle, not just
   * the driven one: a lamp that is on casts a beam whoever left it on, so a
   * restored save and a car abandoned with its headlights burning both light the
   * ground. Dark lamps are offered nothing and cost no slot.
   *
   * `gain` scales every beam this vehicle casts. The driven car is offered 1: its
   * own beams are the only way to read the road at night and MUST NOT be touched.
   * Ambient cars are offered a faded gain (see `ambientBeamGain`), which is both a
   * comfort and a pop-in fix: a beam that is already near zero at the range where
   * the pool refuses it, or where its car spawned, has nothing left to snap.
   * A gain of zero claims no slot at all, so the pool always belongs to the beams
   * near enough to be seen.
   */
  syncProjectedLights(rig: VehicleLightRig, gain: number): void {
    if (!(gain > 0)) return;
    const headlightBeam = this.headlightMode === 'high' ? HEADLIGHT_HIGH : HEADLIGHT_LOW;
    const headlightIntensity =
      this.headlightMode === 'off'
        ? 0
        : headlightBeam.intensity * this.headlightEnvironmentFactor * gain;
    for (let i = 0; i < 2; i++) {
      this.projectBeam(
        rig,
        this.headlightMounts[i],
        HEADLIGHT_BEAM_TINT,
        headlightIntensity,
        headlightBeam,
        rig.headlightDistanceScale,
      );
      this.projectBeam(
        rig,
        this.taillightMounts[i],
        TAILLIGHT_EMISSIVE,
        this.taillightBeamIntensity * gain,
        TAILLIGHT_BEAM,
      );
      this.projectBeam(
        rig,
        this.reverseLightMounts[i],
        REVERSE_LIGHT_EMISSIVE,
        this.reverseLightBeamIntensity * gain,
        REVERSE_LIGHT_BEAM,
      );
    }
  }

  /**
   * Offers this vehicle's lit lamps to the wet-road reflections (render/wetglints.ts)
   * at their OWN brightness — no range gain: a mirror image does not fade with the
   * distance the ground light does, which is the whole point of drawing it apart
   * from the spotlight pool. `ground` is the road height under the car.
   */
  offerGlints(glints: WetGlints, ground: number): void {
    const headlightBeam = this.headlightMode === 'high' ? HEADLIGHT_HIGH : HEADLIGHT_LOW;
    const headlight = this.headlightMode === 'off' ? 0 : headlightBeam.intensity * this.headlightEnvironmentFactor;
    for (let i = 0; i < 2; i++) {
      // Lens lobes: a headlight throws most of its light down its axis, a tail lamp is
      // meant to be seen from wide behind, a reversing lamp between the two.
      this.offerGlint(glints, ground, this.headlightMounts[i], HEADLIGHT_BEAM_TINT, headlight, this.headlightMode === 'high' ? 10 : 6);
      this.offerGlint(glints, ground, this.taillightMounts[i], TAILLIGHT_EMISSIVE, this.taillightBeamIntensity, 2);
      this.offerGlint(glints, ground, this.reverseLightMounts[i], REVERSE_LIGHT_EMISSIVE, this.reverseLightBeamIntensity, 3);
    }
  }

  private offerGlint(
    glints: WetGlints,
    ground: number,
    mount: VehicleBeamMount | undefined,
    color: THREE.ColorRepresentation,
    brightness: number,
    lobe: number,
  ): void {
    if (!mount || !(brightness > 0)) return;
    const source = this.projectedLightSource
      .copy(mount.sourceLocal)
      .applyQuaternion(this.ctx.rootGroup.quaternion)
      .add(this.ctx.rootGroup.position);
    const axis = this.projectedLightTarget
      .copy(mount.aimLocal)
      .applyQuaternion(this.ctx.rootGroup.quaternion)
      .add(this.ctx.rootGroup.position)
      .sub(source)
      .normalize();
    glints.addLamp(source, ground, axis, lobe, color, brightness);
  }

  private projectBeam(
    rig: VehicleLightRig,
    mount: VehicleBeamMount | undefined,
    color: THREE.ColorRepresentation,
    intensity: number,
    shape: ProjectedBeamShape,
    distanceScale = 1,
  ): void {
    if (!mount || !(intensity > 0)) return;
    const sourceWorld = this.projectedLightSource
      .copy(mount.sourceLocal)
      .applyQuaternion(this.ctx.rootGroup.quaternion)
      .add(this.ctx.rootGroup.position);
    const targetWorld = this.projectedLightTarget
      .copy(mount.aimLocal)
      .applyQuaternion(this.ctx.rootGroup.quaternion)
      .add(this.ctx.rootGroup.position);
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
      const nodeMatch = wanted.has(object.name);
      let matched = false;
      const bind = (source: THREE.Material): THREE.Material => {
        if (!nodeMatch && !wanted.has(source.name)) return source;
        matched = true;
        if (
          !(source instanceof THREE.MeshStandardMaterial) &&
          !(source instanceof THREE.MeshPhongMaterial)
        ) {
          throw new Error(
            `Car model "${this.ctx.model.id}" lamp material cannot emit light: ${source.name}`,
          );
        }
        const material = source.clone();
        material.emissive.setHex(0x000000);
        material.emissiveIntensity = 0;
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
