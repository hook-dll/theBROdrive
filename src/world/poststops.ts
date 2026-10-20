import { GAMEPLAY_CONFIG } from '../config';
import { hash01 } from '../core/rng';

/**
 * THE POST NETWORK: one «ПОЧТА» machine (world/post.ts) every ~9 km, jittered and snapped
 * to a guaranteed POI slot, which is always a settlement (world/settlement.ts). The
 * sequence is random-access and monotonic along the road: stop `index` hands out its four
 * offers (contracts/offers.ts) and signs cargo from any lower index.
 *
 * The draws keep the courier domain the network was born with, so every saved contract
 * (`ContractCargoItem.sourceCourierIndex`) still names the same stop.
 */
const POST_PERIOD_M = 9_000;
const POST_JITTER_M = 1_200;
const DEFAULT_POI_SPACING_M = GAMEPLAY_CONFIG.poiSpacingMetres;
const FIRST_POST_M = 7_000;
const POST_DOMAIN = 0x43555231; // 'CUR1'

export interface PostStop {
  /** Monotonic along the road. Any greater index may receive this stop's cargo. */
  readonly index: number;
  readonly s: number;
}

/**
 * The stop's key in saved state (`WorldState.courierStorage`) and in contract ids. Saved:
 * never renamed.
 */
export function postId(index: number): string {
  return `courier:${index}`;
}

export function postSlotIndex(seed: number, band: number, poiSpacing = DEFAULT_POI_SPACING_M): number {
  const target = FIRST_POST_M
    + band * POST_PERIOD_M
    + (hash01(seed, POST_DOMAIN, band, 0) - 0.5) * POST_JITTER_M * 2;
  return Math.max(1, Math.round(target / poiSpacing));
}

export function isPostPoiSlot(
  seed: number,
  poiIndex: number,
  poiSpacing = DEFAULT_POI_SPACING_M,
): boolean {
  const estimate = Math.round((poiIndex * poiSpacing - FIRST_POST_M) / POST_PERIOD_M);
  for (let band = estimate - 1; band <= estimate + 1; band++) {
    if (band >= 0 && postSlotIndex(seed, band, poiSpacing) === poiIndex) return true;
  }
  return false;
}

/**
 * The single post stop with this index, purely from the seed. `postStopsBetween` is a
 * range query; this is the same draw for one index, so a system that only knows "the
 * cargo came from stop 7" can find it without the chunk being built.
 */
export function postStop(
  seed: number,
  index: number,
  poiSpacing = DEFAULT_POI_SPACING_M,
): PostStop {
  return { index, s: postSlotIndex(seed, index, poiSpacing) * poiSpacing };
}

export function postStopsBetween(
  seed: number,
  fromS: number,
  toS: number,
  poiSpacing = DEFAULT_POI_SPACING_M,
): PostStop[] {
  const first = Math.max(
    0,
    Math.floor((fromS - FIRST_POST_M - POST_JITTER_M) / POST_PERIOD_M) - 1,
  );
  const last = Math.max(
    first,
    Math.ceil((toS - FIRST_POST_M + POST_JITTER_M) / POST_PERIOD_M) + 1,
  );
  const out: PostStop[] = [];
  for (let index = first; index <= last; index++) {
    const stop = postStop(seed, index, poiSpacing);
    if (stop.s < fromS || stop.s >= toS) continue;
    out.push(stop);
  }
  return out;
}

/**
 * Index of the first post stop at or past `fromS` whose index is at least `minIndex`.
 * Stop arclengths grow with the index (the jitter is under half a period), so the walk
 * starts one band short of the estimate and stops at the first match.
 */
export function nextPostIndex(
  seed: number,
  fromS: number,
  minIndex: number,
  poiSpacing = DEFAULT_POI_SPACING_M,
): number {
  const estimate = Math.floor((fromS - FIRST_POST_M - POST_JITTER_M) / POST_PERIOD_M) - 1;
  let index = Math.max(0, minIndex, estimate);
  while (postSlotIndex(seed, index, poiSpacing) * poiSpacing < fromS) index++;
  return index;
}
