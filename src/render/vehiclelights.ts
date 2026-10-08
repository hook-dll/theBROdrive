import * as THREE from 'three';
import {
  GRAPHICS_TIERS,
  shadowsFor,
  vehicleLightSlotsFor,
  type GraphicsQuality,
} from '../game/settings';

/**
 * Renderer spotlights for the vehicle lamps that are LIT, wherever they are.
 *
 * A beam is not a property of the driven car; it is a property of a lamp that is
 * on. This rig therefore holds no per-vehicle slot map: every live vehicle offers
 * its lit lamps each frame with `addBeam`, in the caller's priority order, and the
 * rig hands out one persistent spotlight per offer. A save restored with the player
 * on foot, or a car left parked with its headlights burning, lights the ground
 * exactly as its lenses claim — which the old fixed six-slot-for-one-vehicle rig
 * could not do, because nothing but the driven or last-exited car ever reached it.
 *
 * SHADER PERMUTATIONS. Three keys every lit material's program on the count of
 * *visible* lights, so changing that count recompiles the whole world — the measured
 * dusk hitch the fixed pools exist to avoid. Some GPU drivers also specialize the first
 * executed program around an exactly-zero light contribution, causing a multi-
 * second hitch when a slot first becomes nonzero. Two rules keep both costs off
 * the driving frame:
 *
 *  - Slots are lit by INTENSITY alone. Unclaimed slots stay in the scene at a
 *    visually black, nonzero intensity, so cycling headlights, braking or driving
 *    away remains a uniform write without a zero-to-lit driver specialization.
 *  - The pool NEVER changes size. It was grown on demand, on the argument that a
 *    second lit car is rare enough to pay for when it happens. Measured, that
 *    payment is 4.5 SECONDS of blocked main thread on this scene the moment the
 *    seventh beam is claimed — the whole world's lit materials recompiling in one
 *    frame. Spawning a car at night and switching its lamps on is exactly how a
 *    player meets it. No beam is worth a four-second freeze.
 *
 * Demand beyond the pool is therefore refused, and WHO is refused is decided before
 * any beam is offered: `main.ts` hands the slots out through a `FadingSlotPool`
 * (render/slotpool.ts) — the driven car's lamps pinned, then everyone else's nearest
 * to the camera first — so the farthest lamps lose their pool of light on the ground
 * while their lenses still glow, and a slot changes hands by fading out and in.
 *
 * WHOSE LIGHT MATTERS. The driven car's beams are the only way to read the road at
 * night, so they are projected exactly as authored. Every other car's are projected
 * faded (`ambientBeamGain`) and one beam per lamp pair:
 *
 *  - Comfort. A night with four cars around threw four full-brightness pools across
 *    the asphalt, one of them oncoming and sweeping over the player's own lane. It
 *    read as glare rather than as traffic, which is not a night anybody wants to
 *    drive through, however defensible it is as photometry.
 *  - Pop-in. A pool used to arrive at FULL brightness the instant a car spawned
 *    140 m ahead. Fading the gain to nothing before that range means there is no
 *    step left to see: the lens still glows and approaches, and the ground light
 *    grows in behind it. The range fade alone did NOT cover the pool refusing a
 *    beam: with three cars lit the pool is full well inside 110 m, so slots changed
 *    hands at full gain until the handover fade took that over.
 */
/** The top rung also keeps the projected cone visible three times farther. */
const HEADLIGHT_DISTANCE_SCALE: Record<GraphicsQuality, number> = {
  retro: GRAPHICS_TIERS.retro.headlightDistanceScale,
  acceptable: GRAPHICS_TIERS.acceptable.headlightDistanceScale,
  standard: GRAPHICS_TIERS.standard.headlightDistanceScale,
  blessing: GRAPHICS_TIERS.blessing.headlightDistanceScale,
};
/** Visually zero, but nonzero to prevent first-use GPU driver specialization. */
const DORMANT_INTENSITY = 1e-8;
/**
 * Beam scale for a car the player is NOT driving, by distance from the camera.
 *
 * `AMBIENT_BEAM_GAIN` is the ceiling: enough that an oncoming car's light is seen
 * on the asphalt well before it is alongside (at 60-130 m and a third of the gain it
 * only showed once the car was nearly level), not enough to compete with the
 * player's own beams. A car spawned at 140-170 m arrives with its light already
 * mostly faded out, and grows it in as it comes.
 */
const AMBIENT_BEAM_GAIN = 0.5;
const AMBIENT_BEAM_FULL_M = 110;
const AMBIENT_BEAM_GONE_M = 170;

export function ambientBeamGain(distanceM: number): number {
  if (distanceM <= AMBIENT_BEAM_FULL_M) return AMBIENT_BEAM_GAIN;
  if (distanceM >= AMBIENT_BEAM_GONE_M) return 0;
  const t =
    (distanceM - AMBIENT_BEAM_FULL_M) / (AMBIENT_BEAM_GONE_M - AMBIENT_BEAM_FULL_M);
  // Smoothstep, so the light grows in without an audible knee at either end.
  return AMBIENT_BEAM_GAIN * (1 - t * t * (3 - 2 * t));
}

/**
 * How far the driven car's headlamp shadow reaches, metres.
 *
 * Not the beam's own reach: the beam's `distance` is a light cutoff (432-780 m on the
 * top rung), and three takes the shadow camera's far plane from it, which put the
 * whole road ahead in the depth pass — 156 draws a frame in the prototype. The beam
 * is still about half as bright at 100-200 m as at 10 m (decay 0.26-0.3), so a short
 * shadow would leave lit posts with none; 160 m covers where a post's streak can be
 * told from the sand, and the 2048 map keeps a texel near 0.2 m out there.
 */
const HEADLAMP_SHADOW_RANGE_M = 160;
const HEADLAMP_SHADOW_MAP = 2048;

/**
 * Gives `light` a shadow whose far plane is `HEADLAMP_SHADOW_RANGE_M`, not the light's
 * cutoff. `SpotLightShadow.updateMatrices` reads the far plane from `light.distance`
 * (three does not export the class to subclass), so the distance is lent a shorter
 * value for that one call and given back.
 */
function limitShadowRange(light: THREE.SpotLight): void {
  const shadow = light.shadow;
  const update = shadow.updateMatrices.bind(shadow);
  shadow.updateMatrices = (target: THREE.Light): void => {
    const distance = light.distance;
    light.distance = distance > 0 ? Math.min(distance, HEADLAMP_SHADOW_RANGE_M) : HEADLAMP_SHADOW_RANGE_M;
    update(target);
    light.distance = distance;
  };
}

export class VehicleLightRig {
  readonly headlightDistanceScale: number;
  private readonly lights: THREE.SpotLight[] = [];
  /**
   * The one spotlight that casts a shadow: the driven car's headlamps, as one beam
   * from between them. Null where the tier draws no sun shadow either.
   *
   * Its own light, not a pool slot, and taken OUT of the slot budget: the count of
   * spots and of shadowed spots is compiled into every lit program, so both are
   * fixed here, and the total stays the tier's. Measured in the prototype on an M2
   * Pro: one shadowed headlamp +0.4 ms GPU and ~16 depth draws at night; two cost
   * +4 ms, which is why the pair is merged rather than shadowed lamp by lamp.
   */
  private readonly shadowLight: THREE.SpotLight | null;
  private shadowClaimed = false;
  private readonly scene: THREE.Scene;
  /** Slots claimed so far this frame; also the next free index. */
  private used = 0;

  constructor(
    scene: THREE.Scene,
    quality: GraphicsQuality = 'standard',
    mobilePresentation = false,
  ) {
    this.headlightDistanceScale = HEADLIGHT_DISTANCE_SCALE[quality];
    // The count is compiled into every lit material, so it is decided here and never
    // again: see `mobileVehicleLightSlots` for what it costs per pixel.
    let slots = vehicleLightSlotsFor(quality, mobilePresentation);
    if (shadowsFor(quality, mobilePresentation) && slots > 1) {
      const light = new THREE.SpotLight(0xffffff, DORMANT_INTENSITY);
      limitShadowRange(light);
      light.shadow.mapSize.set(HEADLAMP_SHADOW_MAP, HEADLAMP_SHADOW_MAP);
      light.shadow.camera.near = 0.3;
      light.shadow.bias = -0.0004;
      light.shadow.normalBias = 0.03;
      light.castShadow = true;
      scene.add(light, light.target);
      this.shadowLight = light;
      slots -= 1;
    } else {
      this.shadowLight = null;
    }
    for (let i = 0; i < slots; i++) {
      const light = new THREE.SpotLight(0xffffff, DORMANT_INTENSITY);
      light.castShadow = false;
      scene.add(light, light.target);
      this.lights.push(light);
    }
    this.scene = scene;
  }

  /** Persistent pool spotlights in the scene. Fixed for the session; see the note above. */
  get lightCount(): number {
    return this.lights.length;
  }

  /** Whether the driven car's headlamps go to the shadowed beam instead of the pool. */
  get hasShadowBeam(): boolean {
    return this.shadowLight !== null;
  }

  /** Beams projected in the frame just assembled. */
  get beamCount(): number {
    return this.used;
  }

  /** Starts a frame's collection. Nothing is darkened until `endFrame`. */
  beginFrame(): void {
    this.used = 0;
    this.shadowClaimed = false;
  }

  /**
   * Projects the driven car's headlamps into the shadowed beam. Same arguments as
   * `addBeam`. @returns whether the beam was taken (false on a tier without it).
   */
  addShadowBeam(
    sourceWorld: THREE.Vector3,
    targetWorld: THREE.Vector3,
    color: THREE.ColorRepresentation,
    intensity: number,
    distance: number,
    angle: number,
    penumbra: number,
    decay: number,
  ): boolean {
    const light = this.shadowLight;
    if (light === null || !(intensity > 0)) return false;
    this.shadowClaimed = true;
    light.position.copy(sourceWorld);
    light.target.position.copy(targetWorld);
    light.color.set(color);
    light.intensity = intensity;
    light.distance = distance;
    light.angle = angle;
    light.penumbra = penumbra;
    light.decay = decay;
    return true;
  }

  /**
   * Projects one lit lamp. Dark lamps are rejected without claiming a slot, which
   * is what lets many vehicles share the pool: a parked car with only its
   * headlights on costs two lights, not six.
   *
   * @returns whether a spotlight was assigned.
   */
  addBeam(
    sourceWorld: THREE.Vector3,
    targetWorld: THREE.Vector3,
    color: THREE.ColorRepresentation,
    intensity: number,
    distance: number,
    angle: number,
    penumbra: number,
    decay: number,
  ): boolean {
    if (!(intensity > 0)) return false;
    if (this.used >= this.lights.length) return false;
    const light = this.lights[this.used++];
    light.position.copy(sourceWorld);
    light.target.position.copy(targetWorld);
    light.color.set(color);
    light.intensity = intensity;
    light.distance = distance;
    light.angle = angle;
    light.penumbra = penumbra;
    light.decay = decay;
    return true;
  }

  /**
   * Makes every unclaimed slot visually dark without returning to exact zero. An
   * unclaimed shadowed beam also stops re-rendering its map (as the sun's does at
   * night, render/sky.ts): `castShadow` stays on, since it is compiled into every
   * lit program. One pass is still drawn before the map exists, so its allocation
   * never waits for the first dark drive.
   */
  endFrame(): void {
    for (let i = this.used; i < this.lights.length; i++) {
      this.lights[i].intensity = DORMANT_INTENSITY;
    }
    const shadowLight = this.shadowLight;
    if (shadowLight !== null) {
      if (!this.shadowClaimed) shadowLight.intensity = DORMANT_INTENSITY;
      shadowLight.shadow.autoUpdate = this.shadowClaimed || shadowLight.shadow.map === null;
    }
  }

  clear(): void {
    this.used = 0;
    this.shadowClaimed = false;
    this.endFrame();
  }

  dispose(): void {
    this.clear();
    for (const light of this.lights) {
      this.scene.remove(light, light.target);
    }
    this.lights.length = 0;
    if (this.shadowLight !== null) {
      this.scene.remove(this.shadowLight, this.shadowLight.target);
      this.shadowLight.shadow.dispose();
    }
  }

}
