/**
 * Trailer equipment (kind 6): the papers and the loaded trailer they belong to must
 * arrive together.
 *
 * The post's lever handing over the papers is the pickup: the loaded trailer is
 * spawned on that post's lay-by the first time the cargo leaves the machine
 * (`contracts/world.ts`), named after the offer seed, and from then on it is an
 * ordinary trailer — hitch it, tow it, drop it. The target post only signs when it is
 * standing within `DELIVERY_RANGE_M` of its lay-by, and the delivery consumes it.
 *
 * How it got there is not judged: a hit or tipped trailer still counts, and every
 * delivery pays its signature sticker.
 */

import { contractTrailerId } from '../world';
import type { ContractKindDef } from '../types';

/** The parked trailer counts as delivered inside this radius of the post's lay-by, m. */
const DELIVERY_RANGE_M = 25;

export const trailerEquipmentKind: ContractKindDef = {
  kind: 'trailer_equipment',
  weight: 1,
  offerNames: [
    'workshop trailer papers',
    'plant trailer papers',
    'generator trailer papers',
    'trailer logbook',
  ],
  signatureSticker: 'su-oval',
  acceptRefusal: (item, probe) => {
    const at = probe.trailerPosition(contractTrailerId(item));
    if (!at) return 'its equipment trailer is not here';
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
