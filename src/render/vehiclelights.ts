import * as THREE from 'three';

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
 */
/**
 * Persistent spotlights. Covers one fully lit car: two headlights, two tail lamps
 * and two reversing lamps, which is the common night case and today's cost.
 */
const SLOT_COUNT = 6;
/** Visually zero, but nonzero to prevent first-use GPU driver specialization. */
const DORMANT_INTENSITY = 1e-8;

export class VehicleLightRig {
  private readonly lights: THREE.SpotLight[] = [];
  private readonly scene: THREE.Scene;
  /** Slots claimed so far this frame; also the next free index. */
  private used = 0;

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < SLOT_COUNT; i++) {
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
