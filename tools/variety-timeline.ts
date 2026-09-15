/**
 * tools/variety-timeline.ts
 *
 * Does anything actually happen every two or three kilometres?
 *
 * Runs the shipped `src/world/director.ts` over real road lengths and measures the
 * schedule it produces: the gap between consecutive events, per-kind frequency, and
 * whether a kind ever lands twice in a row inside its own channel. The claim the
 * director is built on — a guaranteed floor rather than a hoped-for average — is only
 * worth anything if it is measured, so the bound is a check here and not a comment
 * there.
 *
 *   npx tsx tools/variety-timeline.ts
 *
 * Nothing here is part of the game bundle.
 */

import {
  VarietyChannel,
  varietyEventOfWindow,
  varietyEventsBetween,
  varietyKinds,
  varietyWindowLength,
  type VarietyEvent,
  type VarietyKind,
} from '../src/world/director';

/** The floor the director promises: no two consecutive events further apart than this. */
const GAP_BOUND_M = 2100;
const SEEDS = [1, 7, 42, 1337];
/** Road length used for the frequency census, metres. */
const CENSUS_M = 2_000_000;

const CHANNEL_NAME: Record<number, string> = {
  [VarietyChannel.Horizon]: 'horizon',
  [VarietyChannel.Verge]: 'verge',
  [VarietyChannel.Surface]: 'surface',
};

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(44)} ${detail}`);
}

// -- the first 60 km, drawn ---------------------------------------------------

{
  const events = varietyEventsBetween(42, 0, 60_000);
  console.log('seed 42, first 60 km — one line per event\n');
  let previous = 0;
  for (const e of events) {
    const km = e.s / 1000;
    const gap = e.s - previous;
    previous = e.s;
    const bar = '.'.repeat(Math.min(48, Math.round(km * 48 / 60)));
    console.log(
      `${km.toFixed(2).padStart(6)} km  +${(gap / 1000).toFixed(2)}  ` +
        `${CHANNEL_NAME[e.channel]!.padEnd(8)} ${e.kind.padEnd(12)} ` +
        `${(e.halfLength * 2).toFixed(0).padStart(4)} m  ${e.side > 0 ? 'L' : 'R'}  ${bar}`,
    );
  }
  console.log('');
}

// -- gaps ---------------------------------------------------------------------

let worstGap = 0;
let worstGapAt = 0;
let worstSeed = 0;
const gaps: number[] = [];

for (const seed of SEEDS) {
  const events = varietyEventsBetween(seed, 0, 400_000);
  for (let i = 1; i < events.length; i++) {
    const gap = events[i]!.s - events[i - 1]!.s;
    gaps.push(gap);
    if (gap > worstGap) {
      worstGap = gap;
      worstGapAt = events[i]!.s;
      worstSeed = seed;
    }
  }
}
gaps.sort((a, b) => a - b);
const median = gaps[gaps.length >> 1]!;
const p95 = gaps[Math.floor(gaps.length * 0.95)]!;

console.log('gaps between consecutive events, 4 seeds x 400 km');
console.log(
  `  median ${(median / 1000).toFixed(2)} km   p95 ${(p95 / 1000).toFixed(2)} km   ` +
    `worst ${(worstGap / 1000).toFixed(2)} km (seed ${worstSeed} at ${(worstGapAt / 1000).toFixed(1)} km)\n`,
);

// -- per-kind frequency -------------------------------------------------------

const counts: Record<string, number> = {};
for (const kind of varietyKinds()) counts[kind] = 0;
for (const channel of [VarietyChannel.Horizon, VarietyChannel.Verge, VarietyChannel.Surface]) {
  const w = varietyWindowLength(channel);
  for (let window = 0; window < Math.floor(CENSUS_M / w); window++) {
    counts[varietyEventOfWindow(42, channel, window).kind]! += 1;
  }
}

console.log(`how often each kind comes round, seed 42 over ${(CENSUS_M / 1000).toFixed(0)} km`);
for (const kind of varietyKinds()) {
  const n = counts[kind]!;
  const every = n > 0 ? CENSUS_M / n / 1000 : Infinity;
  const minutes = (every / 90) * 60;
  console.log(
    `  ${kind.padEnd(12)} ${String(n).padStart(5)}x   every ${every.toFixed(1).padStart(5)} km   ` +
      `~${minutes.toFixed(0)} min at 90 km/h`,
  );
}
console.log('');

// -- the promises -------------------------------------------------------------

check(
  'no gap wider than the bound',
  worstGap <= GAP_BOUND_M,
  `worst ${worstGap.toFixed(0)} m against ${GAP_BOUND_M} m`,
);

let repeats = 0;
let spanEscapes = 0;
for (const seed of SEEDS) {
  for (const channel of [VarietyChannel.Horizon, VarietyChannel.Verge, VarietyChannel.Surface]) {
    const w = varietyWindowLength(channel);
    let previous: VarietyEvent | null = null;
    for (let window = 0; window < 4000; window++) {
      const e = varietyEventOfWindow(seed, channel, window);
      // A span that left its own window would break the single-window lookup in
      // `varietyEventAt`, and it would break it silently — as a feature that stops
      // existing halfway along itself.
      const reach = e.halfLength + e.ramp;
      if (e.s - reach < window * w || e.s + reach > (window + 1) * w) spanEscapes++;
      if (previous && previous.kind === e.kind) repeats++;
      previous = e;
    }
  }
}

// One join in eight may repeat by construction (the truncated chain), so the bound is
// the block rate and not zero. 4 seeds x 3 channels x 4000 windows = 48000 joins.
check(
  'a kind rarely repeats itself',
  repeats < 48_000 * 0.07,
  `${repeats} repeats in 48000 windows (${((repeats / 48_000) * 100).toFixed(1)}%)`,
);
check('every span stays in its window', spanEscapes === 0, `${spanEscapes} escaped`);

let determinism = true;
for (let i = 0; i < 200; i++) {
  const s = i * 137.5;
  const a = varietyEventsBetween(7, s, s + 500).map((e) => `${e.kind}@${e.s.toFixed(3)}`).join(',');
  const b = varietyEventsBetween(7, s, s + 500).map((e) => `${e.kind}@${e.s.toFixed(3)}`).join(',');
  if (a !== b) determinism = false;
}
check('the same seed schedules the same road', determinism, 'sampled 200 windows');

const kindsSeen = new Set<VarietyKind>();
for (const e of varietyEventsBetween(42, 0, 200_000)) kindsSeen.add(e.kind);
check(
  'every kind is reachable',
  kindsSeen.size === varietyKinds().length,
  `${kindsSeen.size} of ${varietyKinds().length} kinds in 200 km`,
);

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
