import { hash01 } from '../core/rng';
import { ROAD_LENGTH } from './road';

/**
 * THE POST NETWORK: the settlements down the road, each with its «ПОЧТА» machine
 * (world/post.ts) and its shop. Stop 0 IS THE START: a new game opens on its lay-by
 * (story/site.ts), `START_POST_S` up the road from the turning circle at the road's end
 * (world/terminus.ts). Stops 1-3 follow at 2.5-4 km each, and
 * every later one at 2.5-8 km. The sequence is monotonic along the road: stop `index`
 * hands out its offers (contracts/offers.ts) and signs cargo from any lower index.
 *
 * Every stop's arclength is the sum of the gaps before it, so the stops are kept in one
 * prefix table per seed, grown on demand: the whole 40 000 km road is under 16 000 stops,
 * and every reader (the chunk builders, the terrain and vista workers through the
 * lay-bys) draws the same gaps from the seed alone.
 *
 * The draws keep the courier domain the network was born with.
 */
/** Arclength of stop 0, the start settlement: half a kilometre on from the turning circle. */
export const START_POST_S = 500;
/** Stops 1 to `EARLY_GAPS` follow at the short gap. */
const EARLY_GAPS = 3;
const EARLY_GAP_MIN_M = 2_500;
const EARLY_GAP_SPAN_M = 1_500;
const GAP_MIN_M = 2_500;
const GAP_SPAN_M = 5_500;
/** The shortest gap between two stops: a reader may assume no two are closer. */
export const POST_GAP_MIN_M = Math.min(EARLY_GAP_MIN_M, GAP_MIN_M);
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

/** One seed's stop arclengths, `count` of them valid; grown by doubling. */
interface PostTable {
  s: Float64Array;
  count: number;
}

const tables = new Map<number, PostTable>();

/** Gap from stop `index - 1` to stop `index`; stop 0's is from the road's start. */
function gapBefore(seed: number, index: number): number {
  if (index === 0) return START_POST_S;
  const roll = hash01(seed, POST_DOMAIN, index, 0);
  if (index <= EARLY_GAPS) return EARLY_GAP_MIN_M + roll * EARLY_GAP_SPAN_M;
  return GAP_MIN_M + roll * GAP_SPAN_M;
}

/** The seed's table, filled at least through stop `index` or past arclength `s`. */
function tableThrough(seed: number, index: number, s: number): PostTable {
  let table = tables.get(seed);
  if (!table) {
    table = { s: new Float64Array(256), count: 0 };
    tables.set(seed, table);
  }
  while (table.count <= index || (table.count > 0 && table.s[table.count - 1]! <= s && table.s[table.count - 1]! <= ROAD_LENGTH)) {
    if (table.count === table.s.length) {
      const grown = new Float64Array(table.s.length * 2);
      grown.set(table.s);
      table.s = grown;
    }
    const before = table.count > 0 ? table.s[table.count - 1]! : 0;
    table.s[table.count] = before + gapBefore(seed, table.count);
    table.count++;
  }
  return table;
}

/** Arclength of stop `index`, metres from the house. */
export function postS(seed: number, index: number): number {
  return tableThrough(seed, index, -Infinity).s[index]!;
}

/**
 * The single post stop with this index, purely from the seed. `postStopsBetween` is a
 * range query; this is the same draw for one index, so a system that only knows "the
 * cargo came from stop 7" can find it without the chunk being built.
 */
export function postStop(seed: number, index: number): PostStop {
  return { index, s: postS(seed, index) };
}

/**
 * Index of the first stop at or past arclength `s` (binary search over the table, which
 * is filled past `s` first).
 */
function firstStopAtOrPast(seed: number, s: number): number {
  const table = tableThrough(seed, 0, s);
  let lo = 0;
  let hi = table.count - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (table.s[mid]! < s) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Stops whose arclength falls in [fromS, toS), in order. */
export function postStopsBetween(seed: number, fromS: number, toS: number): PostStop[] {
  const out: PostStop[] = [];
  for (let index = firstStopAtOrPast(seed, fromS); ; index++) {
    const s = postS(seed, index);
    if (s >= toS || s > ROAD_LENGTH) break;
    out.push({ index, s });
  }
  return out;
}

/** Index of the first post stop at or past `fromS` whose index is at least `minIndex`. */
export function nextPostIndex(seed: number, fromS: number, minIndex: number): number {
  return Math.max(minIndex, firstStopAtOrPast(seed, fromS));
}

/** The last bracket found: the terrain asks about neighbouring arclengths in runs. */
let lastTable: PostTable | null = null;
let lastAfter = 0;

/**
 * The stops either side of arclength `s`: the last one before it (-1 before stop 0) and
 * the first at or past it. What the roadside slots (world/poislots.ts) are looked up by.
 */
export function postBracket(seed: number, s: number): { before: number; after: number } {
  const table = tables.get(seed);
  if (table && table === lastTable && lastAfter < table.count) {
    const at = table.s[lastAfter]!;
    if (at >= s && (lastAfter === 0 || table.s[lastAfter - 1]! < s)) return { before: lastAfter - 1, after: lastAfter };
  }
  const after = firstStopAtOrPast(seed, s);
  lastTable = tables.get(seed)!;
  lastAfter = after;
  return { before: after - 1, after };
}
