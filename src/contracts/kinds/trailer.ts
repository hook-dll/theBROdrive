/**
 * A trailer load (game-design2.md §7.3): a wardrobe, a piano, a sofa or a bed, too big
 * for any boot. The papers and the loaded trailer they belong to must arrive together.
 *
 * The post's lever handing over the papers is the pickup: the loaded trailer is
 * spawned on that post's lay-by the first time the papers leave the machine
 * (`contracts/world.ts`), named after the offer seed, and from then on it is an
 * ordinary trailer — hitch it, tow it, drop it. The bed is the long load: longer than
 * the trailer's bed, it overhangs both ends with a collider of its own. The target post
 * only signs when the trailer stands within `DELIVERY_RANGE_M` of its lay-by, and the
 * delivery consumes it.
 *
 * How it got there is not judged yet: a hit or tipped trailer still counts.
 */

import { contractTrailerId } from '../world';
import type { ContractKindDef } from '../types';

/** The parked trailer counts as delivered inside this radius of the post's lay-by, m. */
const DELIVERY_RANGE_M = 25;

export const trailerKind: ContractKindDef = {
  kind: 'trailer',
  acceptRefusal: (item, probe) => {
    const at = probe.trailerPosition(contractTrailerId(item));
    if (!at) return 'its trailer is not here';
    const dx = probe.postX - at.x;
    const dz = probe.postZ - at.z;
    if (dx * dx + dz * dz > DELIVERY_RANGE_M * DELIVERY_RANGE_M) {
      return `bring its trailer onto the post's lay-by, within ${DELIVERY_RANGE_M} m`;
    }
    return null;
  },
  onDelivered: (item) => ({
    deltas: [{ t: 'trailer_remove', trailerId: contractTrailerId(item) }],
  }),
};
