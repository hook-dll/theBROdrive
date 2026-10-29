import * as THREE from 'three';
import {
  GRAPHICS_TIERS,
  shadowModeDefault,
  shadowModeFor,
  vehicleLightSlotsFor,
  type GraphicsQuality,
} from '../game/settings';
import { SPOT_CLUSTER_MAX_LIGHTS, SPOT_LIGHT_LIVE_MIN, SPOT_REACH_ALL } from './lightshader';
import { SpotClusterPass } from './spotclusters';

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
 *    away remains a uniform write without a zero-to-lit driver specialization. The
 *    spot loop skips a slot that dark (render/lightshader.ts `installClusteredSpotLoop`,
 *    which states what that does and does not risk).
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
 * faded (`ambientBeamGain`), one beam per lamp like the driven car's:
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
/**
 * Visually zero, but nonzero to prevent first-use GPU driver specialization. Below
 * render/lightshader.ts `SPOT_LIGHT_LIVE_MIN`, so the spot loop skips a dormant slot.
 */
const DORMANT_INTENSITY = 1e-8;
/**
 * Every projected lamp's authored intensity is scaled by this. The lamps were authored
 * against a frame shown linear-encoded, about a gamma darker than its light; through the
 * post pass's sRGB encode (core/renderer.ts `drawFrame`) the same beam's falloff spilled
 * across the dunes at three times the screen value. Matched by screenshot at midnight:
 * the pool on the road reads as before, the sand beyond it stays night.
 */
const LAMP_EXPOSURE = 0.35;
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

/**
 * The hand torch, a slot of this rig like the lamps, so lighting it is an intensity write:
 * as its own scene light toggled `visible`, the first press changed three's spot count and
 * relinked every lit program mid-walk. Retuned with the lamps (`LAMP_EXPOSURE`): 150 was
 * authored against the old linear-encoded frame, 52 is the screen value, so it is not
 * scaled again.
 */
const TORCH_COLOR = 0xffedbd;
const TORCH_INTENSITY = 52;
const TORCH_DISTANCE_M = 65;
const TORCH_ANGLE = 0.32;
const TORCH_PENUMBRA = 0.58;
const TORCH_DECAY = 1.7;
/** How far ahead of the eye the torch is aimed, metres (only its direction matters). */
const TORCH_AIM_M = 25;
const _forward = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _toCentre = new THREE.Vector3();

/**
 * Whether spot `light` puts any light on a sphere (world `centre`, `radius`). Exact where
 * three's light is exactly zero, conservative everywhere else: a slot left in is a cost,
 * a slot left out is a lamp missing from the car.
 *
 *  - Dormant (`SPOT_LIGHT_LIVE_MIN`, the shader's own test): the loop skips it anyway.
 *  - Range: three's `getDistanceAttenuation` is zero from `distance` on (0: unlimited).
 *  - Cone: `getSpotAttenuation` is zero outside the OUTER cone, `angle`; the penumbra
 *    only softens inside it. The test is the centre's distance from the cone's side
 *    line, which never exceeds its distance from the cone itself.
 *  - Behind the lamp nothing is lit (the cone is under 90 degrees).
 *  - A sphere round the lamp itself always counts: a car's own lamps, its courtesy lamp
 *    and the shadowed headlamp are inside its own sphere.
 */
function spotReaches(light: THREE.SpotLight, centre: THREE.Vector3, radius: number): boolean {
  const color = light.color;
  if (!(Math.max(color.r, color.g, color.b) * light.intensity >= SPOT_LIGHT_LIVE_MIN)) return false;
  const toCentre = _toCentre.subVectors(centre, light.position);
  const distanceSq = toCentre.lengthSq();
  if (distanceSq <= radius * radius) return true;
  if (light.distance > 0) {
    const range = light.distance + radius;
    if (distanceSq > range * range) return false;
  }
  const axis = _axis.subVectors(light.target.position, light.position);
  const axisLength = axis.length();
  if (!(axisLength > 1e-6) || !(light.angle < Math.PI / 2)) return true;
  const along = toCentre.dot(axis) / axisLength;
  if (along < -radius) return false;
  const across = Math.sqrt(Math.max(0, distanceSq - along * along));
  return Math.cos(light.angle) * across - Math.sin(light.angle) * along <= radius;
}

export class VehicleLightRig {
  readonly headlightDistanceScale: number;
  private readonly lights: THREE.SpotLight[] = [];
  /**
   * The one spotlight that casts a shadow: the driven car's driver's side headlamp; the
   * other lamp takes a pool slot (vehiclelamps.ts `syncProjectedLights`). Null where
   * the tier draws no sun shadow either.
   *
   * Its own light, not a pool slot, and taken OUT of the slot budget: the count of
   * spots and of shadowed spots is compiled into every lit program, so both are
   * fixed here, and the total stays the tier's. Measured in the prototype on an M2
   * Pro: one shadowed headlamp +0.4 ms GPU and ~16 depth draws at night; two cost
   * +4 ms, which is why only one lamp is shadowed.
   */
  private readonly shadowLight: THREE.SpotLight | null;
  private shadowClaimed = false;
  /** The hand torch (`TORCH_INTENSITY`): always in the scene, dormant while off. */
  private readonly torch: THREE.SpotLight;
  /**
   * The clustered spotlights in three's order, the torch then the pool: bit `b` of a
   * cluster word (render/spotclusters.ts) is `clusterLights[b]`. Three numbers spots
   * shadow-casting first, then in scene order, which holds while this rig's lights are
   * the only spotlights drawn (`ownsEverySpot`).
   */
  private readonly clusterLights: THREE.SpotLight[];
  private readonly ownLights: Set<THREE.Object3D>;
  /** Builds the per-frame cluster grid; core/renderer.ts runs it around the scene pass. */
  readonly clusterPass: SpotClusterPass;
  /** Whether no spotlight but this rig's was visible in the scene at `endFrame`. */
  private ownsEverySpot = true;
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
    // again: see `vehicleLightSlots` for what it costs per pixel.
    let slots = vehicleLightSlotsFor(quality, mobilePresentation);
    // The rung's default, not `Settings.shadows`: a shadowed lamp is a light that can
    // never be added or removed later, and the player's choice may change mid-drive.
    // With the shadow map off the lamp simply casts nothing.
    if (
      shadowModeFor(shadowModeDefault(quality), quality, mobilePresentation) !== 'off'
      && slots > 1
    ) {
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
    const torch = new THREE.SpotLight(
      TORCH_COLOR,
      DORMANT_INTENSITY,
      TORCH_DISTANCE_M,
      TORCH_ANGLE,
      TORCH_PENUMBRA,
      TORCH_DECAY,
    );
    torch.castShadow = false;
    scene.add(torch, torch.target);
    this.torch = torch;
    // Every spot is one bit of a 32-bit word: the kit car's `SPOT_REACH` mask names them
    // all, a cluster word (render/spotclusters.ts) the torch and the pool.
    slots = Math.min(slots, SPOT_CLUSTER_MAX_LIGHTS - 1 - (this.shadowLight === null ? 0 : 1));
    for (let i = 0; i < slots; i++) {
      const light = new THREE.SpotLight(0xffffff, DORMANT_INTENSITY);
      light.castShadow = false;
      scene.add(light, light.target);
      this.lights.push(light);
    }
    this.clusterLights = [torch, ...this.lights];
    this.ownLights = new Set<THREE.Object3D>(this.clusterLights);
    if (this.shadowLight !== null) this.ownLights.add(this.shadowLight);
    this.clusterPass = new SpotClusterPass(this.clusterLights, () => this.ownsEverySpot);
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
    light.intensity = intensity * LAMP_EXPOSURE;
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
    light.intensity = intensity * LAMP_EXPOSURE;
    light.distance = distance;
    light.angle = angle;
    light.penumbra = penumbra;
    light.decay = decay;
    return true;
  }

  /**
   * Lights the hand torch from `camera`'s eye along its view, or darkens it. Its own slot,
   * so it never takes a lamp's light and never changes the program.
   */
  setTorch(on: boolean, camera: THREE.Camera): void {
    const torch = this.torch;
    if (!on) {
      torch.intensity = DORMANT_INTENSITY;
      return;
    }
    torch.intensity = TORCH_INTENSITY;
    torch.position.copy(camera.position);
    camera.getWorldDirection(_forward);
    torch.target.position.copy(camera.position).addScaledVector(_forward, TORCH_AIM_M);
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
    // A spotlight of anyone else's would shift three's numbering under the masks.
    this.ownsEverySpot = true;
    for (const child of this.scene.children) {
      if ((child as THREE.SpotLight).isSpotLight && child.visible && !this.ownLights.has(child)) {
        this.ownsEverySpot = false;
        break;
      }
    }
  }

  /**
   * The slots that can light a sphere (world `centre`, `radius`) this frame, as the
   * mask a kit car's body and glass skip the rest by (render/materials.ts
   * `setCarSpotReach`, render/lightshader.ts `SPOT_REACH`). Call after `endFrame`.
   *
   * Bit `i` is the renderer's spot light `i`: the shadowed beam 0, then the torch and the
   * pool (`clusterLights`). While a spotlight not of this rig is visible every bit is set.
   */
  spotReachMask(centre: THREE.Vector3, radius: number): number {
    if (!this.ownsEverySpot) return SPOT_REACH_ALL;
    const offset = this.shadowLight === null ? 0 : 1;
    let mask = 0;
    if (this.shadowLight !== null && spotReaches(this.shadowLight, centre, radius)) mask |= 1;
    for (let i = 0; i < this.clusterLights.length; i++) {
      if (spotReaches(this.clusterLights[i], centre, radius)) mask |= 1 << (i + offset);
    }
    return mask;
  }

  clear(): void {
    this.used = 0;
    this.shadowClaimed = false;
    this.endFrame();
  }

  dispose(): void {
    this.clear();
    for (const light of this.clusterLights) {
      this.scene.remove(light, light.target);
    }
    this.lights.length = 0;
    if (this.shadowLight !== null) {
      this.scene.remove(this.shadowLight, this.shadowLight.target);
      this.shadowLight.shadow.dispose();
    }
  }

}
