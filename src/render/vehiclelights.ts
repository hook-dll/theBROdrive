import * as THREE from 'three';
import {
  GRAPHICS_TIERS,
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
 * *visible* lights, so changing that count recompiles the world (see the dusk hitch
 * documented in render/lights.ts). Some GPU drivers also specialize the first
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
 * Demand beyond the pool is therefore refused. `main.ts` offers beams in priority
 * order — the driven car first, then nearest to the camera — so a refusal costs the
 * FARTHEST lamp its pool of light on the ground, while its lens still glows.
 *
 * WHOSE LIGHT MATTERS. The driven car's beams are the only way to read the road at
 * night, so they are projected exactly as authored. Every other car's are projected
 * faded (`ambientBeamGain`), for two reasons that happen to be the same fix:
 *
 *  - Comfort. A night with four cars around threw four full-brightness pools across
 *    the asphalt, one of them oncoming and sweeping over the player's own lane. It
 *    read as glare rather than as traffic, which is not a night anybody wants to
 *    drive through, however defensible it is as photometry.
 *  - Pop-in. A pool used to arrive at FULL brightness — the instant a car spawned
 *    140 m ahead, or the instant the pool stopped refusing its beam. Fading the
 *    gain to nothing before either range means there is no step left to see: the
 *    lens still glows and approaches, and the ground light grows in behind it.
 */
/** The top rung also keeps the projected cone visible three times farther. */
const HEADLIGHT_DISTANCE_SCALE: Record<GraphicsQuality, number> = {
  acceptable: GRAPHICS_TIERS.acceptable.headlightDistanceScale,
  standard: GRAPHICS_TIERS.standard.headlightDistanceScale,
  blessing: GRAPHICS_TIERS.blessing.headlightDistanceScale,
};
/** Visually zero, but nonzero to prevent first-use GPU driver specialization. */
const DORMANT_INTENSITY = 1e-8;
/**
 * Beam scale for a car the player is NOT driving, by distance from the camera.
 *
 * `AMBIENT_BEAM_GAIN` is the ceiling: enough that a passing car lays a soft wash on
 * the road, not enough to compete with the player's own beams for the lane ahead.
 * The window closes before `SPAWN_MIN_M` in world/traffic.ts (140 m), so a spawn can
 * never arrive already lighting the ground.
 */
const AMBIENT_BEAM_GAIN = 0.34;
const AMBIENT_BEAM_FULL_M = 60;
const AMBIENT_BEAM_GONE_M = 130;

export function ambientBeamGain(distanceM: number): number {
  if (distanceM <= AMBIENT_BEAM_FULL_M) return AMBIENT_BEAM_GAIN;
  if (distanceM >= AMBIENT_BEAM_GONE_M) return 0;
  const t =
    (distanceM - AMBIENT_BEAM_FULL_M) / (AMBIENT_BEAM_GONE_M - AMBIENT_BEAM_FULL_M);
  // Smoothstep, so the light grows in without an audible knee at either end.
  return AMBIENT_BEAM_GAIN * (1 - t * t * (3 - 2 * t));
}

export class VehicleLightRig {
  readonly headlightDistanceScale: number;
  private readonly lights: THREE.SpotLight[] = [];
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
    const slots = vehicleLightSlotsFor(quality, mobilePresentation);
    for (let i = 0; i < slots; i++) {
      const light = new THREE.SpotLight(0xffffff, DORMANT_INTENSITY);
      light.castShadow = false;
      scene.add(light, light.target);
      this.lights.push(light);
    }
    this.scene = scene;
  }

  /** Persistent spotlights in the scene. Fixed for the session; see the note above. */
  get lightCount(): number {
    return this.lights.length;
  }

  /** Beams projected in the frame just assembled. */
  get beamCount(): number {
    return this.used;
  }

  /** Starts a frame's collection. Nothing is darkened until `endFrame`. */
  beginFrame(): void {
    this.used = 0;
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

  /** Makes every unclaimed slot visually dark without returning to exact zero. */
  endFrame(): void {
    for (let i = this.used; i < this.lights.length; i++) {
      this.lights[i].intensity = DORMANT_INTENSITY;
    }
  }

  clear(): void {
    this.used = 0;
    this.endFrame();
  }

  dispose(): void {
    this.clear();
    for (const light of this.lights) {
      this.scene.remove(light, light.target);
    }
    this.lights.length = 0;
  }

}
