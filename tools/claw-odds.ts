/**
 * The claw machine's odds (world/claw.ts), measured on the real heap and the real grip
 * rule, no browser:
 *
 *   nice -n 15 ~/.bun/bin/bun tools/claw-odds.ts
 *
 * Every machine of 200 seeds × 20 stops is tried 60 times in one visit (its heap never
 * refilled, so it thins as it is won), the claw dropped two ways:
 *  - AIMED: over a figurine of the heap picked at random, off by up to 3 cm either way
 *    (a player aiming at one);
 *  - ANYWHERE: at a random point of everywhere the claw reaches, chute corner and all
 *    (a player not aiming at all).
 * A try holds nothing over bare felt (a miss), holds a figurine to the chute by
 * `clawHolds`, else drops it back where it lay. Prints tries per win, the most tries
 * between two wins, and the share of misses. The design holds 1 win in 3–5 tries and
 * never more than five aimed (the pity rule).
 */

import { hash01 } from '../src/core/rng';
import { CLAW_REACH, ClawHeap, clawHolds } from '../src/world/claw';

const SEEDS = 200;
const STOPS = 20;
const TRIES = 60;
const AIM_SLOP_M = 0.03;
const DOMAIN = 0x4f444453; // 'ODDS'

for (const mode of ['aimed', 'anywhere'] as const) {
  let tries = 0;
  let wins = 0;
  let misses = 0;
  let longest = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    for (let stop = 0; stop < STOPS; stop++) {
      const heap = new ClawHeap(seed, stop, []);
      let sinceWin = 0;
      for (let t = 1; t <= TRIES; t++) {
        const roll = (k: number): number => hash01(seed, DOMAIN, stop, t, k);
        let x: number;
        let z: number;
        if (mode === 'aimed') {
          const pile = heap.prizes.filter((p) => p.state === 'pile');
          const aim = pile[Math.floor(roll(1) * pile.length)]!;
          x = aim.x + (roll(2) * 2 - 1) * AIM_SLOP_M;
          z = aim.z + (roll(3) * 2 - 1) * AIM_SLOP_M;
        } else {
          x = (roll(4) * 2 - 1) * CLAW_REACH.x;
          z = (roll(5) * 2 - 1) * CLAW_REACH.z;
        }
        tries++;
        sinceWin++;
        const target = heap.prizeUnder(x, z);
        if (!target) {
          misses++;
          continue;
        }
        if (!clawHolds(seed, stop, t, sinceWin)) continue;
        wins++;
        longest = Math.max(longest, sinceWin);
        sinceWin = 0;
        target.state = 'gone';
        heap.settle();
      }
    }
  }
  console.log(
    `${mode.padEnd(8)}  ${(tries / wins).toFixed(2)} tries a win, at most ${longest} between wins, ${((100 * misses) / tries).toFixed(1)}% misses`,
  );
}
