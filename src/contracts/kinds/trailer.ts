/**
 * A trailer load (game-design2.md §7.3, §7.8): a wardrobe, a piano, a sofa or a bed on a
 * KMZ trailer, too big for any boot.
 *
 * The loaded trailer waits in the source post's pick-up slot (contracts/hauls.ts,
 * contracts/world.ts `spawnHaulLoad`), named after its contract; hitching it to a car
 * takes it, and from then on it is an ordinary trailer — tow it, drop it, hitch it
 * again. The bed is the long load: longer than the trailer's box, it stands against the
 * headboard and out over the back, the tailboard off, with a collider of its own. It is
 * handed in by parking all of it inside the destination post's hand-in slot, either way
 * round (contracts/haulbays.ts), which uncouples it and keeps it; a trailer has no rule
 * of its own on top of the bay's.
 *
 * How it got there is not judged: a hit or tipped trailer still counts.
 */

import type { ContractKindDef } from '../types';

export const trailerKind: ContractKindDef = {
  kind: 'trailer',
};
