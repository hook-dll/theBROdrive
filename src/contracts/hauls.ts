/**
 * THE PICK-UP SLOT'S HAUL (game-design2.md §7.8): no post card offers a haul. Each post's
 * pick-up slot (world/haulbay.ts) holds one by itself, at a ROUND
 * (`WorldState.haulRounds`, 0 when absent): round `r`'s haul is `postHaul(seed, post, r)`
 * (contracts/offers.ts), a trailer load, a broken car to tow or a car to tow over,
 * bound for the next post. Its load stands in the slot while it is empty
 * (contracts/haulbays.ts), and a sign beside the slot says where it goes
 * (world/haulsign.ts).
 *
 * TAKE IS PHYSICAL: hitching the waiting trailer to a car or putting the waiting car on
 * the tow bar (a haul's car is sealed and only towed, contracts/world.ts `haulCarSeal`;
 * a save from before that may still have the player sitting in one, and his move to its
 * wheel takes it) binds the haul to its load there and then
 * (`takeHaulLoads`, player/interaction.ts) — the `haul_take` that moves the post on to its
 * next round, whose load appears once the slot is empty again. Refused at
 * `ACTIVE_CONTRACT_LIMIT` jobs out or `ACTIVE_HAUL_LIMIT` hauls out: the action does not
 * happen and the load keeps waiting.
 */

import type { GameWorld, WorldState } from '../game/state';
import { contractThing, type ContractCargoItem } from '../items/items';
import { parsePostHaulId, postHaul } from './offers';
import { ACTIVE_CONTRACT_LIMIT, ACTIVE_HAUL_LIMIT, activeContracts } from './registry';
import { haulLoadContractId, haulLoadId } from './world';

/** What a take refused at `ACTIVE_CONTRACT_LIMIT` says. */
const LIMIT_TEXT = 'three jobs already out — hand one in first';
/** What a take refused at `ACTIVE_HAUL_LIMIT` says. */
const HAUL_LIMIT_TEXT = 'one haul at a time — hand in the one you have first';

/** The round post `index`'s pick-up slot is at. */
export function haulRound(state: WorldState, index: number): number {
  return state.haulRounds[String(index)] ?? 0;
}

/** The haul waiting at post `index`'s pick-up slot: its current round's. */
export function waitingHaul(state: WorldState, seed: number, index: number): ContractCargoItem {
  return postHaul(seed, index, haulRound(state, index));
}

/**
 * The haul trailer or car `loadId` waits for, or null when it waits for none: taken
 * already, handed in, not a pick-up slot's load, or a round its post has moved past.
 */
export function waitingHaulOfLoad(state: WorldState, seed: number, loadId: string): ContractCargoItem | null {
  const contractId = haulLoadContractId(loadId);
  const at = contractId ? parsePostHaulId(contractId) : null;
  if (!at || at.round !== haulRound(state, at.index) || state.hauls[contractId!] || state.handedInLoads[loadId] !== undefined) return null;
  const haul = postHaul(seed, at.index, at.round);
  return haulLoadId(haul) === loadId ? haul : null;
}

/**
 * Takes the waiting hauls among `ids` (trailers and cars an action is about to hitch,
 * bar or sit in), each told in a toast: true when the action may go on — all taken, or
 * none waits — false when it is refused, said in a toast, with nothing taken. Each
 * `haul_take` moves its post on a round.
 */
export function takeHaulLoads(world: GameWorld, ids: readonly string[], toast: (text: string) => void): boolean {
  const state = world.state;
  const taking: { haul: ContractCargoItem; loadId: string }[] = [];
  for (const loadId of ids) {
    const haul = waitingHaulOfLoad(state, world.seed, loadId);
    if (haul) taking.push({ haul, loadId });
  }
  if (taking.length === 0) return true;
  const active = activeContracts(state);
  const refusal = active.all.size + taking.length > ACTIVE_CONTRACT_LIMIT ? LIMIT_TEXT
    : active.hauls.size + taking.length > ACTIVE_HAUL_LIMIT ? HAUL_LIMIT_TEXT
    : null;
  if (refusal) {
    toast(refusal);
    return false;
  }
  for (const { haul, loadId } of taking) {
    world.apply({
      t: 'haul_take',
      haul: { contract: haul, loadId },
      postRound: { index: haul.sourceCourierIndex, round: parsePostHaulId(haul.id)!.round },
    });
    toast(`the ${contractThing(haul).name} is yours — take it to ${haul.destination ?? 'the next post'}`);
  }
  return true;
}
