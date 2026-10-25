/**
 * A trailer load (game-design2.md §7.3, §7.8): a wardrobe, a piano, a sofa or a bed on a
 * KMZ trailer, too big for any boot.
 *
 * The loaded trailer waits in the source post's bay before its card is taken
 * (contracts/world.ts `spawnHaulLoad`), named after the offer seed; TAKE binds it and
 * from then on it is an ordinary trailer — hitch it, tow it, drop it. The bed is the long
 * load: longer than the trailer's bed, it overhangs both ends with a collider of its own.
 * It is handed in by reversing it into the destination post's bay (contracts/haulbays.ts),
 * which uncouples it and keeps it; a trailer has no rule of its own on top of the bay's.
 *
 * How it got there is not judged: a hit or tipped trailer still counts.
 */

import type { ContractKindDef } from '../types';

export const trailerKind: ContractKindDef = {
  kind: 'trailer',
};
