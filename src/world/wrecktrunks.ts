/** A static roadside shell whose trunk remains usable even though the car cannot drive. */
export interface WreckTrunk {
  readonly id: string;
  readonly modelId: string;
  /** Absolute world-space chassis origin. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly qx: number;
  readonly qy: number;
  readonly qz: number;
  readonly qw: number;
  readonly halfExtents: readonly [number, number, number];
}

/** Live registrations follow the POI physics chunks; stored contents live in WorldState. */
export class WreckTrunkField {
  private readonly trunks = new Map<string, WreckTrunk>();

  register(trunk: WreckTrunk): void {
    this.trunks.set(trunk.id, trunk);
  }

  forget(ids: readonly string[]): void {
    for (const id of ids) this.trunks.delete(id);
  }

  get(id: string): WreckTrunk | null {
    return this.trunks.get(id) ?? null;
  }

  values(): IterableIterator<WreckTrunk> {
    return this.trunks.values();
  }

  dispose(): void {
    this.trunks.clear();
  }
}
