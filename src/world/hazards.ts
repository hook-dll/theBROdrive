/**
 * Road-frame obstacle knowledge emitted by chunk prop construction.
 *
 * Entries retain only arclength and signed lateral offset. Those are durable across
 * floating-origin rebases; the absolute positions used to build a prop never escape
 * its chunk. A chunk owns one array, so teardown has one exact deletion operation.
 */
export interface RoadHazard {
  readonly s: number;
  readonly lateral: number;
  readonly radius: number;
  readonly breakable: boolean;
}

export class HazardIndex {
  private readonly byChunk = new Map<string, RoadHazard[]>();
  private readonly ordered: RoadHazard[] = [];
  private dirty = false;

  /** Adds one hazard to the chunk that created its matching collider. */
  add(chunkKey: string, hazard: RoadHazard): void {
    let hazards = this.byChunk.get(chunkKey);
    if (!hazards) {
      hazards = [];
      this.byChunk.set(chunkKey, hazards);
    }
    hazards.push(hazard);
    this.dirty = true;
  }

  /** Removes exactly the hazards owned by an unloaded chunk. */
  forget(chunkKey: string): void {
    const hazards = this.byChunk.get(chunkKey);
    if (!hazards) return;
    this.byChunk.delete(chunkKey);
    for (const hazard of hazards) {
      const index = this.ordered.indexOf(hazard);
      if (index >= 0) this.ordered.splice(index, 1);
    }
    this.dirty = true;
  }

  /**
   * Visits hazards in [s, s + distance]. Sorting only when construction or teardown
   * changed membership makes the 60 Hz read a forward scan with no transient arrays.
   */
  forEachAhead(s: number, distance: number, fn: (hazard: RoadHazard) => void): void {
    if (this.dirty) this.rebuildOrder();
    const end = s + Math.max(0, distance);
    for (const hazard of this.ordered) {
      if (hazard.s < s) continue;
      if (hazard.s > end) break;
      fn(hazard);
    }
  }

  private rebuildOrder(): void {
    this.ordered.length = 0;
    for (const hazards of this.byChunk.values()) {
      for (const hazard of hazards) this.ordered.push(hazard);
    }
    this.ordered.sort((a, b) => a.s - b.s);
    this.dirty = false;
  }
}
