/**
 * THE TEDDY SHELTER'S RULES (game-design2.md §10): which party waits on a post's bench,
 * which of its teddies are still there, and what seating a teddy on a bench does. The
 * shelter itself — its roof, walls, bench, timetable and the teddies drawn on it — is
 * world/shelter.ts.
 *
 * WAITING. Each post's shelter is at a ROUND (`WorldState.shelterRounds`, 0 when
 * absent); round `r`'s party is `shelterParty(seed, post, r)` (contracts/offers.ts):
 * 1–3 teddies, bound for the next post, maybe urgent, all drawn from
 * the seed. Nothing else about the bench is saved: a teddy is on it while its item
 * (`teddyItem`) is nowhere in the world — not in the hands, a car or on the ground — and
 * it has not been delivered (its own id among `completedContractIds`).
 *
 * TAKING. F on a teddy on the bench puts it in the hands. The first one taken makes the
 * party's contract active (one of `ACTIVE_CONTRACT_LIMIT`, refused at the limit); more
 * of the same party add nothing to the count. The player takes one, two or all of them;
 * those left keep waiting and can be taken while the contract is open.
 *
 * SEATING (F with a teddy in hand at a shelter, `teddySeating`):
 *  - at a post that may sign for it (`contractDestinationRefusal`: past its source) it
 *    is DELIVERED and paid there and then;
 *  - at its own source shelter it is PUT BACK: no pay, it waits on the bench again;
 *  - anywhere else it is refused: "this one rides on to …".
 * The contract closes when the last of its teddies out is seated, here or there:
 * DELIVERED when any of the party was delivered, else RETURNED; the source shelter then
 * moves to the next round, and its bench fills with the next party. Only a party seated
 * WHOLE at its destination pays; one that closes otherwise is fined (world/shelter.ts).
 */

import type { WorldState } from '../game/state';
import { contractIdOf, type ContractCargoItem, type Item } from '../items/items';
import { isPassenger, teddyId } from './kinds/teddyPassengers';
import { parseShelterPartyId, shelterParty } from './offers';
import { contractDestinationRefusal } from './registry';

/** The party waiting at post `index`'s shelter now, and which of its bench places still hold a teddy. */
export interface ShelterBench {
  /** The party's contract (`shelterParty`): destination, pay, urgent, `party.size`. */
  readonly party: ContractCargoItem;
  readonly round: number;
  /** One per teddy of the party, by bench place: true while it waits there. */
  readonly waiting: readonly boolean[];
}

/** Ids of the teddies of party `partyId` out in the world: in the hands, any car, on the ground. */
function teddiesOut(state: WorldState, partyId: string): Set<string> {
  const out = new Set<string>();
  const visit = (item: Item | null): void => {
    if (item?.type === 'contract_cargo' && item.party?.id === partyId) out.add(item.id);
  };
  state.player.carried.forEach(visit);
  for (const car of Object.values(state.cars)) {
    car.storage.forEach(visit);
    car.cabin.forEach(visit);
  }
  for (const loose of Object.values(state.looseItems)) visit(loose.item);
  return out;
}

/** Post `index`'s shelter: its party and who is still on the bench. */
export function shelterBench(state: WorldState, seed: number, index: number): ShelterBench {
  const round = state.shelterRounds[String(index)] ?? 0;
  const party = shelterParty(seed, index, round);
  const size = party.party?.size ?? 1;
  const out = teddiesOut(state, party.id);
  const waiting: boolean[] = [];
  for (let seat = 0; seat < size; seat++) {
    const id = teddyId(party.id, seat);
    waiting.push(!out.has(id) && !state.completedContractIds.includes(id));
  }
  return { party, round, waiting };
}

/** What seating a teddy at a shelter does; see the header. */
export type TeddySeating =
  | {
      readonly mode: 'deliver' | 'return';
      /** The party's contract closes with this one: delivered or returned. */
      readonly close: 'delivered' | 'returned' | null;
      /** The source post and round of the party, whose shelter moves on when it closes. */
      readonly sourcePost: number;
      readonly round: number;
    }
  | { readonly mode: 'refuse'; readonly why: string };

/** What seating `item` (a teddy in hand) on post `index`'s bench does now. */
export function teddySeating(state: WorldState, item: ContractCargoItem, index: number): TeddySeating {
  const partyId = contractIdOf(item);
  const from = parseShelterPartyId(partyId);
  if (!isPassenger(item) || !from || state.completedContractIds.includes(partyId)) {
    return { mode: 'refuse', why: 'its ride is over' };
  }
  let mode: 'deliver' | 'return';
  if (index === item.sourceCourierIndex) mode = 'return';
  else if (contractDestinationRefusal(item, index) === null) mode = 'deliver';
  else {
    return { mode: 'refuse', why: `this one rides on to ${item.destination ?? 'the next post'}` };
  }
  const others = teddiesOut(state, partyId);
  others.delete(item.id);
  let close: 'delivered' | 'returned' | null = null;
  if (others.size === 0) {
    const size = item.party?.size ?? 1;
    let delivered = mode === 'deliver';
    for (let seat = 0; seat < size && !delivered; seat++) delivered = state.completedContractIds.includes(teddyId(partyId, seat));
    close = delivered ? 'delivered' : 'returned';
  }
  return { mode, close, sourcePost: from.index, round: from.round };
}
