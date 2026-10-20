import { GAMEPLAY_CONFIG } from '../config';
import { hash, hash01 } from '../core/rng';
import type { Item } from '../items/items';
import type { StaticCarLids } from '../render/staticlids';

/** One courier every 9 km, jittered and snapped to a guaranteed POI slot. */
const COURIER_PERIOD_M = 9_000;
const COURIER_JITTER_M = 1_200;
const DEFAULT_POI_SPACING_M = GAMEPLAY_CONFIG.poiSpacingMetres;
const FIRST_COURIER_M = 7_000;
const COURIER_DOMAIN = 0x43555231; // 'CUR1'
const OFFER_DOMAIN = 0x4f464631; // 'OFF1'

export interface CourierStop {
  /** Monotonic along the road. Any greater index may receive this courier's cargo. */
  readonly index: number;
  readonly s: number;
  readonly lateral: number;
  readonly appearanceSeed: number;
}

export interface CourierTrunk {
  readonly id: string;
  readonly index: number;
  readonly modelId: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly qx: number;
  readonly qy: number;
  readonly qz: number;
  readonly qw: number;
  readonly halfExtents: readonly [number, number, number];
  /** Procedural untouched contents. WorldState owns a full override after first edit. */
  readonly defaultStorage: readonly (Item | null)[];
}

export function courierId(index: number): string {
  return `courier:${index}`;
}

export function courierSlotIndex(seed: number, band: number, poiSpacing = DEFAULT_POI_SPACING_M): number {
  const target = FIRST_COURIER_M
    + band * COURIER_PERIOD_M
    + (hash01(seed, COURIER_DOMAIN, band, 0) - 0.5) * COURIER_JITTER_M * 2;
  return Math.max(1, Math.round(target / poiSpacing));
}

export function isCourierPoiSlot(
  seed: number,
  poiIndex: number,
  poiSpacing = DEFAULT_POI_SPACING_M,
): boolean {
  const estimate = Math.round((poiIndex * poiSpacing - FIRST_COURIER_M) / COURIER_PERIOD_M);
  for (let band = estimate - 1; band <= estimate + 1; band++) {
    if (band >= 0 && courierSlotIndex(seed, band, poiSpacing) === poiIndex) return true;
  }
  return false;
}

/**
 * The single courier stop with this index, purely from the seed. `couriersBetween`
 * is a range query; this is the same draw for one index, so a system that only knows
 * "the cargo came from courier 7" can find where courier 7 parks without the chunk
 * being built (the contract spawn of a trailer or a car needs exactly that).
 */
export function courierStop(
  seed: number,
  index: number,
  poiSpacing = DEFAULT_POI_SPACING_M,
): CourierStop {
  const s = courierSlotIndex(seed, index, poiSpacing) * poiSpacing;
  const side = hash01(seed, COURIER_DOMAIN, index, 1) < 0.5 ? -1 : 1;
  return {
    index,
    s,
    lateral: side * (17 + hash01(seed, COURIER_DOMAIN, index, 2) * 8),
    appearanceSeed: hash(seed, COURIER_DOMAIN, index, 3),
  };
}

export function couriersBetween(
  seed: number,
  fromS: number,
  toS: number,
  poiSpacing = DEFAULT_POI_SPACING_M,
): CourierStop[] {
  const first = Math.max(
    0,
    Math.floor((fromS - FIRST_COURIER_M - COURIER_JITTER_M) / COURIER_PERIOD_M) - 1,
  );
  const last = Math.max(
    first,
    Math.ceil((toS - FIRST_COURIER_M + COURIER_JITTER_M) / COURIER_PERIOD_M) + 1,
  );
  const out: CourierStop[] = [];
  for (let index = first; index <= last; index++) {
    const stop = courierStop(seed, index, poiSpacing);
    if (stop.s < fromS || stop.s >= toS) continue;
    out.push(stop);
  }
  return out;
}

/**
 * Index of the first courier at or past `fromS` whose index is at least `minIndex`.
 * Courier arclengths grow with the index (the jitter is under half a period), so the
 * walk starts one band short of the estimate and stops at the first match.
 */
export function nextCourierIndex(
  seed: number,
  fromS: number,
  minIndex: number,
  poiSpacing = DEFAULT_POI_SPACING_M,
): number {
  const estimate = Math.floor((fromS - FIRST_COURIER_M - COURIER_JITTER_M) / COURIER_PERIOD_M) - 1;
  let index = Math.max(0, minIndex, estimate);
  while (courierSlotIndex(seed, index, poiSpacing) * poiSpacing < fromS) index++;
  return index;
}


/**
 * Live registrations follow streamed physics chunks; save data owns edited contents.
 * A courier's boot lid (render/staticlids.ts) joins it once its model is drawn, and shuts
 * again when the chunk is rebuilt: only the contents persist.
 */
export class CourierField {
  private readonly trunks = new Map<string, CourierTrunk>();
  private readonly lidsById = new Map<string, StaticCarLids>();

  register(trunk: CourierTrunk): void {
    this.trunks.set(trunk.id, trunk);
  }

  /** The boot lid of a registered courier's model, which may arrive after the courier itself. */
  attachLids(id: string, lids: StaticCarLids): void {
    if (this.trunks.has(id)) this.lidsById.set(id, lids);
  }

  forget(ids: readonly string[]): void {
    for (const id of ids) {
      this.trunks.delete(id);
      this.lidsById.delete(id);
    }
  }

  get(id: string): CourierTrunk | null {
    return this.trunks.get(id) ?? null;
  }

  /** A courier's boot lid, or null before its model is drawn. */
  lids(id: string): StaticCarLids | null {
    return this.lidsById.get(id) ?? null;
  }

  values(): IterableIterator<CourierTrunk> {
    return this.trunks.values();
  }

  /** Eases every registered courier's boot lid, once a rendered frame. */
  syncVisuals(dt: number): void {
    for (const lids of this.lidsById.values()) lids.update(dt);
  }

  dispose(): void {
    this.trunks.clear();
    this.lidsById.clear();
  }
}
