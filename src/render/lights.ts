import * as THREE from 'three';

/**
 * GPU street-light budget.
 *
 * Lamp chunks expose invisible PointLight markers. This class copies the nearest
 * six marker states into six persistent renderer lights: three in front of the
 * view and three behind it.
 *
 * The six slots stay visible for the whole session and are lit by intensity alone
 * (zero by day, `LAMP_POINT` at night). Three.js keys each material's shader on the
 * count of *visible* point lights, so toggling the slots' `visible` at dusk changed
 * that key 0 -> 6 and recompiled every lit material in a single frame — the
 * measured evening hitch. Keeping the count constant compiles the point-light
 * permutation once, at startup, and dusk becomes a plain uniform write.
 */

/** Three pools ahead and three behind the player. */
const STREETLIGHT_SLOT_COUNT = 6;
const LIGHTS_PER_DIRECTION = STREETLIGHT_SLOT_COUNT / 2;
/** Three concrete-era poles can be ~255 m away. */
const CUTOFF_DISTANCE = 300;
const CUTOFF_DISTANCE_SQ = CUTOFF_DISTANCE * CUTOFF_DISTANCE;

export class LightBudget {
  /** Invisible source markers from streamed chunks and the homestead. */
  private readonly sources: THREE.PointLight[] = [];
  /** The only point lights the renderer ever sees; lit by intensity, never toggled. */
  private readonly slots: THREE.PointLight[] = [];
  private readonly distSq: number[] = [];
  /** World positions mirror source markers without allocating during selection. */
  private readonly sourceWorld: THREE.Vector3[] = [];
  private chosen = new Uint8Array(0);
  private sourceRevision = -1;

  constructor(private readonly scene: THREE.Scene) {
    for (let i = 0; i < STREETLIGHT_SLOT_COUNT; i++) {
      const slot = new THREE.PointLight(0xffc37a, 0, 46, 2);
      slot.userData.lightBudgetSlot = true;
      this.slots.push(slot);
      scene.add(slot);
    }
  }

  /** Called only after chunks are added or removed, never as a periodic traversal. */
  private rescan(revision: number): void {
    if (revision === this.sourceRevision) return;
    this.sourceRevision = revision;
    this.sources.length = 0;
    this.scene.traverse((object) => {
      const point = object as THREE.PointLight;
      if (point.isPointLight && point.userData.lightBudgetSlot !== true) this.sources.push(point);
    });
  }

  /**
   * Updates the fixed streetlight slots. Source markers stay invisible and are
   * never counted by Three's forward-light shader.
   */
  update(
    x: number,
    y: number,
    z: number,
    forwardX: number,
    forwardZ: number,
    nightFactor: number,
    sourceRevision: number,
  ): void {
    this.rescan(sourceRevision);

    const night = nightFactor > 0;
    if (!night) {
      for (const slot of this.slots) {
        if (slot.intensity !== 0) slot.intensity = 0;
      }
      return;
    }

    const count = this.sources.length;
    if (this.chosen.length < count) this.chosen = new Uint8Array(count);
    if (this.distSq.length < count) this.distSq.length = count;
    while (this.sourceWorld.length < count) this.sourceWorld.push(new THREE.Vector3());

    const viewLength = Math.hypot(forwardX, forwardZ);
    const fx = viewLength > 1e-4 ? forwardX / viewLength : 0;
    const fz = viewLength > 1e-4 ? forwardZ / viewLength : 1;
    for (let i = 0; i < count; i++) {
      this.sources[i].getWorldPosition(this.sourceWorld[i]);
      const world = this.sourceWorld[i];
      const dx = world.x - x;
      const dy = world.y - y;
      const dz = world.z - z;
      this.distSq[i] = dx * dx + dy * dy + dz * dz;
    }

    let slotIndex = 0;
    for (let direction = 0; direction < 2; direction++) {
      const front = direction === 0;
      for (let k = 0; k < LIGHTS_PER_DIRECTION; k++) {
        let best = -1;
        let bestDistance = CUTOFF_DISTANCE_SQ;
        for (let i = 0; i < count; i++) {
          const source = this.sources[i];
          if (this.chosen[i] !== 0 || source.intensity <= 0) continue;
          const world = this.sourceWorld[i];
          const dot = (world.x - x) * fx + (world.z - z) * fz;
          if ((front ? dot >= 0 : dot < 0) && this.distSq[i] <= bestDistance) {
            bestDistance = this.distSq[i];
            best = i;
          }
        }
        if (best >= 0) this.assignSlot(slotIndex++, best);
      }
    }

    // At an end of the road or in a sparse stretch one direction may have fewer
    // lamps. Fill remaining slots with the closest eligible fixtures instead.
    while (slotIndex < STREETLIGHT_SLOT_COUNT) {
      let best = -1;
      let bestDistance = CUTOFF_DISTANCE_SQ;
      for (let i = 0; i < count; i++) {
        if (this.chosen[i] !== 0 || this.sources[i].intensity <= 0) continue;
        if (this.distSq[i] <= bestDistance) {
          bestDistance = this.distSq[i];
          best = i;
        }
      }
      this.assignSlot(slotIndex++, best);
    }

    for (let i = 0; i < count; i++) this.chosen[i] = 0;
  }

  private assignSlot(slotIndex: number, sourceIndex: number): void {
    const slot = this.slots[slotIndex];
    const source = sourceIndex >= 0 ? this.sources[sourceIndex] : null;
    if (sourceIndex >= 0) this.chosen[sourceIndex] = 1;
    const intensity = source?.intensity ?? 0;
    if (slot.intensity !== intensity) slot.intensity = intensity;
    if (!source) return;
    const world = this.sourceWorld[sourceIndex];
    if (
      slot.position.x !== world.x ||
      slot.position.y !== world.y ||
      slot.position.z !== world.z
    ) {
      slot.position.copy(world);
    }
    if (slot.distance !== source.distance) slot.distance = source.distance;
    if (slot.decay !== source.decay) slot.decay = source.decay;
    if (!slot.color.equals(source.color)) slot.color.copy(source.color);
  }
}
