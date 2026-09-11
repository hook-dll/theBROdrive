import { hash, hash01 } from '../core/rng';
import type { ContractCargoItem, Item } from '../items/items';
import { TRUNK_CELL_COUNT } from '../vehicle/trunk';

/** One courier every 9 km, jittered and snapped to a guaranteed POI slot. */
const COURIER_PERIOD_M = 9_000;
const COURIER_JITTER_M = 1_200;
const DEFAULT_POI_SPACING_M = 1_200;
const FIRST_COURIER_M = 7_000;
const COURIER_DOMAIN = 0x43555231; // 'CUR1'
const OFFER_DOMAIN = 0x4f464631; // 'OFF1'
/** Road-centre distance: visible from the lane without blocking the asphalt. */
const COURIER_PARKING_LATERAL_M = 9.5;

const PARCEL_NAMES = [
  'sealed film parcel',
  'radio parts parcel',
  'workshop papers',
  'road letters',
  'medical parcel',
  'machine drawings',
  'cassette parcel',
  'survey notes',
] as const;

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

/** Parks on the POI side but at its road-facing edge, never hidden behind the site. */
export function courierParkingLateral(poiLateral: number): number {
  return (poiLateral < 0 ? -1 : 1) * COURIER_PARKING_LATERAL_M;
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
    const s = courierSlotIndex(seed, index, poiSpacing) * poiSpacing;
    if (s < fromS || s >= toS) continue;
    const side = hash01(seed, COURIER_DOMAIN, index, 1) < 0.5 ? -1 : 1;
    out.push({
      index,
      s,
      lateral: side * (17 + hash01(seed, COURIER_DOMAIN, index, 2) * 8),
      appearanceSeed: hash(seed, COURIER_DOMAIN, index, 3),
    });
  }
  return out;
}

export function courierDefaultStorage(seed: number, index: number): readonly (Item | null)[] {
  const cells: (Item | null)[] = new Array(TRUNK_CELL_COUNT).fill(null);
  for (let slot = 0; slot < 4; slot++) {
    const nameIndex = Math.floor(hash01(seed, OFFER_DOMAIN, index, slot) * PARCEL_NAMES.length);
    const item: ContractCargoItem = {
      type: 'contract_cargo',
      id: `${courierId(index)}:offer:${slot}`,
      sourceCourierIndex: index,
      contractKind: 'parcel',
      cargoName: PARCEL_NAMES[nameIndex]!,
      rewardStickerKind: 'star',
      generatedSeed: hash(seed, OFFER_DOMAIN, index, slot),
    };
    cells[slot] = item;
  }
  return cells;
}

/** Live registrations follow streamed physics chunks; save data owns edited contents. */
export class CourierField {
  private readonly trunks = new Map<string, CourierTrunk>();

  register(trunk: CourierTrunk): void {
    this.trunks.set(trunk.id, trunk);
  }

  forget(ids: readonly string[]): void {
    for (const id of ids) this.trunks.delete(id);
  }

  get(id: string): CourierTrunk | null {
    return this.trunks.get(id) ?? null;
  }

  values(): IterableIterator<CourierTrunk> {
    return this.trunks.values();
  }

  dispose(): void {
    this.trunks.clear();
  }
}
