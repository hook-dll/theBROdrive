import type { StaticCarLids } from '../render/staticlids';

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

/**
 * Live registrations follow the POI physics chunks; stored contents live in WorldState.
 * A shell's lids (render/staticlids.ts) join it once its model is drawn, and shut again
 * when the chunk is rebuilt: only the contents persist.
 */
export class WreckTrunkField {
  private readonly trunks = new Map<string, WreckTrunk>();
  private readonly lidsById = new Map<string, StaticCarLids>();

  register(trunk: WreckTrunk): void {
    this.trunks.set(trunk.id, trunk);
  }

  /** The lids of a registered shell's model, which may arrive after the shell itself. */
  attachLids(id: string, lids: StaticCarLids): void {
    if (this.trunks.has(id)) this.lidsById.set(id, lids);
  }

  forget(ids: readonly string[]): void {
    for (const id of ids) {
      this.trunks.delete(id);
      this.lidsById.delete(id);
    }
  }

  get(id: string): WreckTrunk | null {
    return this.trunks.get(id) ?? null;
  }

  /** A shell's lids, or null before its model is drawn or for a body with none that open. */
  lids(id: string): StaticCarLids | null {
    return this.lidsById.get(id) ?? null;
  }

  values(): IterableIterator<WreckTrunk> {
    return this.trunks.values();
  }

  /** Eases every registered shell's lids, once a rendered frame. */
  syncVisuals(dt: number): void {
    for (const lids of this.lidsById.values()) lids.update(dt);
  }

  dispose(): void {
    this.trunks.clear();
    this.lidsById.clear();
  }
}
