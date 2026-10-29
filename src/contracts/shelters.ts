/**
 * THE TEDDY SHELTER'S RULES (game-design2.md §10): which teddies wait on a post's bench,
 * and what putting a teddy on a bench does. The shelter itself — its roof, posts, bench,
 * timetable, the teddies drawn on it and the goodbye wave — is world/shelter.ts.
 *
 * WAITING. Each post's shelter is at a ROUND (`WorldState.shelterRounds`, 0 when
 * absent); round `r`'s teddies are `shelterTeddies(seed, post, r)` (contracts/offers.ts):
 * 1–3 of them, EACH ITS OWN CONTRACT with its own destination (mostly the next town or
 * the one after), maybe urgent, all drawn from the seed. Nothing else about the bench is
 * saved: a teddy is on it while its item is nowhere in the world — not in the hands, a
 * car or on the ground — and it has not got off (its id among `completedContractIds`).
 *
 * TAKING. F on a teddy on the bench puts it in the hands, and its contract is active
 * (one of `ACTIVE_CONTRACT_LIMIT`, refused at the limit). Those left keep waiting.
 *
 * GETTING OFF (`teddyGetOff`): a teddy put on a bench — set down with F at the shelter,
 * or dropped anywhere on its seat — does what that bench is to it:
 *  - its DESTINATION's: it gets off. Its contract is delivered and paid
 *    (`teddy_seat`); it waves goodbye and is gone (world/shelter.ts);
 *  - its own SOURCE's: it is put back, no pay; it waits on the bench again;
 *  - any other: nothing. It stays where it was put.
 *
 * LEFT BEHIND (`abandonedTeddies`): a teddy lying on the ground anywhere — off its
 * destination's bench and off its own, both of which take it at once — that the player
 * is `ABANDON_M` from in a straight line, the haul loads' rule (contracts/haulbays.ts),
 * live or streamed out (its saved place): its contract closes undelivered
 * (`teddy_abandon`), it is gone from the world, and it is FINED `FINE_SHELLS`, in that
 * order, so a reload finds it closed and never fines it twice (world/shelter.ts).
 *
 * When every teddy of a round has closed — got off at its destination or left behind —
 * the round is done and the bench fills with the next round.
 */

import type { WorldDelta, WorldState } from '../game/state';
import type { ContractCargoItem, Item } from '../items/items';
import { isPassenger } from './kinds/teddyPassengers';
import { offerDestinationIndex, parseShelterTeddyId, shelterTeddies, shelterTeddyId } from './offers';
import { ABANDON_M } from './types';

/** The teddies of post `index`'s shelter's round now, by bench place, and which are still on it. */
export interface ShelterBench {
  readonly round: number;
  /** The round's teddies by bench place, each its own contract (`shelterTeddies`). */
  readonly teddies: readonly ContractCargoItem[];
  /** One per teddy, by bench place: true while it waits there. */
  readonly waiting: readonly boolean[];
}

/** Of `ids`, those whose item is out in the world: in the hands, any car, on the ground. */
function outInWorld(state: WorldState, ids: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  const visit = (item: Item | null): void => {
    if (item?.type === 'contract_cargo' && ids.has(item.id)) out.add(item.id);
  };
  state.player.carried.forEach(visit);
  for (const car of Object.values(state.cars)) {
    car.storage.forEach(visit);
    car.cabin.forEach(visit);
  }
  for (const loose of Object.values(state.looseItems)) visit(loose.item);
  return out;
}

/** Post `index`'s shelter: its round's teddies and who is still on the bench. */
export function shelterBench(state: WorldState, seed: number, index: number): ShelterBench {
  const round = state.shelterRounds[String(index)] ?? 0;
  const teddies = shelterTeddies(seed, index, round);
  const out = outInWorld(state, new Set(teddies.map((teddy) => teddy.id)));
  const waiting = teddies.map((teddy) => !out.has(teddy.id) && !state.completedContractIds.includes(teddy.id));
  return { round, teddies, waiting };
}

/** What putting a teddy on a shelter's bench does; see the header. */
export type TeddyGetOff =
  | {
      readonly mode: 'deliver';
      /** The source post and round of the teddy, whose bench moves on when `roundDone`. */
      readonly sourcePost: number;
      readonly round: number;
      /** Every other teddy of its round has got off already: this one closes the round. */
      readonly roundDone: boolean;
    }
  | { readonly mode: 'return' }
  | { readonly mode: 'stay' };

/** What putting `item` (a teddy) on post `index`'s bench does now. */
export function teddyGetOff(state: WorldState, seed: number, item: ContractCargoItem, index: number): TeddyGetOff {
  const from = parseShelterTeddyId(item.id);
  if (!isPassenger(item) || !from || state.completedContractIds.includes(item.id)) return { mode: 'stay' };
  if (index === item.sourceCourierIndex) {
    // Back on its own bench only while its round is the one waiting there.
    return (state.shelterRounds[String(index)] ?? 0) === from.round ? { mode: 'return' } : { mode: 'stay' };
  }
  if (index !== offerDestinationIndex(item)) return { mode: 'stay' };
  return { mode: 'deliver', sourcePost: from.index, round: from.round, roundDone: closesRound(state, seed, from) };
}

/** Whether every other teddy of the round of shelter teddy `from` has closed already. */
function closesRound(state: WorldState, seed: number, from: { index: number; round: number; seat: number }): boolean {
  const size = shelterTeddies(seed, from.index, from.round).length;
  for (let seat = 0; seat < size; seat++) {
    if (seat !== from.seat && !state.completedContractIds.includes(shelterTeddyId(from.index, from.round, seat))) return false;
  }
  return true;
}

/**
 * The open teddies lying on the ground `ABANDON_M` or more from the player at ABSOLUTE
 * (`x`, `z`), by their saved place: left behind. Close each with `teddyAbandon`.
 */
export function abandonedTeddies(state: WorldState, x: number, z: number): ContractCargoItem[] {
  const out: ContractCargoItem[] = [];
  for (const loose of Object.values(state.looseItems)) {
    const teddy = loose.item;
    if (teddy.type !== 'contract_cargo' || !isPassenger(teddy) || state.completedContractIds.includes(teddy.id)) continue;
    if (parseShelterTeddyId(teddy.id) && Math.hypot(loose.x - x, loose.z - z) >= ABANDON_M) out.push(teddy);
  }
  return out;
}

/** The `teddy_abandon` that closes `teddy` (a shelter teddy) left behind, read from the state now. */
export function teddyAbandon(state: WorldState, seed: number, teddy: ContractCargoItem): Extract<WorldDelta, { t: 'teddy_abandon' }> {
  const from = parseShelterTeddyId(teddy.id)!;
  return { t: 'teddy_abandon', teddyId: teddy.id, sourcePost: from.index, round: from.round, roundDone: closesRound(state, seed, from) };
}
