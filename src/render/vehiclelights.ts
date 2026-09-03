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
 *  - The pool only ever GROWS, and only when demand exceeds it. The initial block
 *    covers one fully lit car (two headlights, two tail lamps, two reversing lamps)
 *    — today's cost, unchanged for the overwhelmingly common case. A second lit car
 *    parked beside the first costs one recompile, once, and never again that
 *    session. Unlike dusk, that demand is created deliberately by the player and is
 *    rare, so paying for it when it happens beats charging every frame for slots
 *    that are almost always dark.
 */
const INITIAL_SLOT_COUNT = 6;
/** Growth granularity: one lamp pair, so a second lit car does not overshoot. */
const GROWTH_BLOCK = 2;
/** Visually zero, but nonzero to prevent first-use GPU driver specialization. */
const DORMANT_INTENSITY = 1e-8;
/**
 * Hard ceiling. Beyond this the per-fragment cost of the forward-lighting loop is
 * indefensible on any machine, and a WebGL uniform budget is a real wall rather
 * than a preference. Twelve lamp pairs is more lit vehicles than the world ever
 * gathers in one place; the caller offers beams nearest-first, so anything refused
 * here is the farthest beam of an improbable crowd.
 */
const MAX_SLOT_COUNT = 24;

export class VehicleLightRig {
  private readonly lights: THREE.SpotLight[] = [];
  /** Slots claimed so far this frame; also the next free index. */
  private used = 0;

  constructor(private readonly scene: THREE.Scene) {
    this.grow(INITIAL_SLOT_COUNT);
  }

  /** Persistent spotlights in the scene. Grows with demand, never shrinks. */
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
    if (this.used >= this.lights.length) {
      if (this.lights.length >= MAX_SLOT_COUNT) return false;
      this.grow(Math.min(GROWTH_BLOCK, MAX_SLOT_COUNT - this.lights.length));
    }
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

  private grow(count: number): void {
    for (let i = 0; i < count; i++) {
      const light = new THREE.SpotLight(0xffffff, DORMANT_INTENSITY);
      light.castShadow = false;
      this.scene.add(light, light.target);
      this.lights.push(light);
    }
  }
}
