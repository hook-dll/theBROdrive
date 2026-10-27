import { credit } from '../economy/economy';
import { JAR_CAPACITY, purseTotal, takeShells, type ShellKind } from '../economy/shells';
import type { GameWorld } from '../game/state';

/**
 * THE STAKE AND THE PRIZE (game-design2.md §19.7): what a race costs and pays, written so
 * that nothing is ever paid twice and nothing is ever paid back twice.
 *
 * ONE FIELD CARRIES IT: `WorldState.raceStake`, set by `takeStake` and cleared by exactly
 * one of `settleStake` (won: the prize; lost or forfeited: nothing more) or `refundStake`
 * (the race called off before it was decided: a reload, a rival lost to the streaming).
 * Each of them reads the field and does nothing when it is already null, and each writes
 * in the order that can only ever cost the PLAYER on a failure between two deltas, never
 * pay him twice: the shells come out before the stake is recorded; the stake is cleared
 * before the prize or the refund goes in. The deltas of one call land in one JavaScript
 * turn, so the autosave (a microtask) sees all of them or none.
 *
 * A RACE IS NEVER SAVED. A save written mid-race still holds the stake, and the game that
 * loads it pays it back on its first step (race/director.ts), the same shells by kind;
 * the race's cars are dropped on load (save/save.ts).
 */

/** Shells a race costs: taken out of the jar on accepting, fine-style. */
export const RACE_STAKE = 3;
/** Shells a won race pays: the stake twice over, the winner takes all. */
export const RACE_PRIZE = 2 * RACE_STAKE;

/** Whether the jar holds a stake's worth of shells, whatever their kinds. */
export function canStake(world: GameWorld): boolean {
  return purseTotal(world.state.player.shells) >= RACE_STAKE;
}

/**
 * Takes the stake for round `round` at post `postIndex`'s track: `RACE_STAKE` shells drawn
 * out of the jar as a fine draws them (the jar's fine animation shows it), then recorded.
 * False, and nothing taken, with a stake already out or fewer shells than it asks.
 */
export function takeStake(world: GameWorld, postIndex: number, round: number): boolean {
  if (world.state.raceStake !== null || !canStake(world)) return false;
  const player = world.state.player;
  const taking = takeShells(world.seed, player.shellMint, player.shells, RACE_STAKE);
  world.apply({ t: 'shells', shells: taking.purse, mint: taking.mint, fined: taking.taken });
  world.apply({ t: 'race_stake', stake: { postIndex, round, shells: taking.taken } });
  return true;
}

/**
 * The race decided: the stake is spent, and a win pays `RACE_PRIZE` new shells into the
 * jar. Returns the shells paid (0 on a loss), or −1 with no stake out (already settled,
 * refunded, or a dev race run without one).
 */
export function settleStake(world: GameWorld, won: boolean): number {
  if (world.state.raceStake === null) return -1;
  world.apply({ t: 'race_stake', stake: null });
  if (!won) return 0;
  credit(world, RACE_PRIZE);
  return RACE_PRIZE;
}

/**
 * The race called off undecided: the stake's own shells back into the jar, by kind. A jar
 * filled meanwhile past `JAR_CAPACITY` loses what does not fit over the rim, as any pay
 * does. Returns the shells given back, or −1 with no stake out.
 */
export function refundStake(world: GameWorld): number {
  const stake = world.state.raceStake;
  if (stake === null) return -1;
  world.apply({ t: 'race_stake', stake: null });
  const purse = { ...world.state.player.shells };
  const spilled: ShellKind[] = [];
  let total = purseTotal(purse);
  for (const kind of stake.shells) {
    if (total < JAR_CAPACITY) {
      purse[kind]++;
      total++;
    } else {
      spilled.push(kind);
    }
  }
  world.apply({ t: 'shells', shells: purse, spilled });
  return stake.shells.length;
}

/** Post `postIndex`'s track moves past round `round`: the next rival is another draw. Idempotent. */
export function advanceRound(world: GameWorld, postIndex: number, round: number): void {
  world.apply({ t: 'race_round', index: postIndex, round });
}

/** The round post `postIndex`'s track is at. */
export function raceRound(world: GameWorld, postIndex: number): number {
  return world.state.raceRounds[String(postIndex)] ?? 0;
}
