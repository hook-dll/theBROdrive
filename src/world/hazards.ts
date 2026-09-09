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

/** Read-only obstacle field consumed by a driver. */
export interface HazardField {
  forEachAhead(s: number, distance: number, fn: (hazard: RoadHazard) => void): void;
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

/**
 * The same hazards viewed from the opposite end of a finite road.
 *
 * Converted records are stable because Autopilot latches a chosen hazard across
 * ticks; one mutable scratch object would silently move that plan to the next prop.
 */
export class ReversedHazardIndex implements HazardField {
  private readonly reversed = new WeakMap<RoadHazard, RoadHazard>();

  constructor(
    private readonly forward: HazardField,
    private readonly roadLength: number,
  ) {}

  forEachAhead(s: number, distance: number, fn: (hazard: RoadHazard) => void): void {
    const start = Math.max(0, this.roadLength - s - Math.max(0, distance));
    const end = Math.min(this.roadLength, this.roadLength - s);
    this.forward.forEachAhead(start, end - start, (hazard) => {
      let reversed = this.reversed.get(hazard);
      if (!reversed) {
        reversed = {
          s: this.roadLength - hazard.s,
          lateral: -hazard.lateral,
          radius: hazard.radius,
          breakable: hazard.breakable,
        };
        this.reversed.set(hazard, reversed);
      }
      fn(reversed);
    });
  }
}
