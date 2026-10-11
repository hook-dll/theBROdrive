/**
 * Trailer equipment (kind 6): the papers and the loaded trailer they belong to must
 * arrive together.
 *
 * Taking the papers out of the source courier's boot is the pickup: the loaded
 * trailer is spawned beside that courier the first time the cargo leaves it
 * (`contracts/world.ts`), named after the offer seed, and from then on it is an
 * ordinary trailer — hitch it, tow it, drop it. The courier only signs when it is
 * standing within `DELIVERY_RANGE_M` of the target, and the delivery consumes it.
 *
 * How it got there is not judged: a hit or tipped trailer still counts, and every
 * delivery pays its signature sticker.
 */

import { contractTrailerId } from '../world';
import type { ContractKindDef } from '../types';

/** The parked trailer counts as delivered inside this radius of the courier, m. */
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
    const dx = probe.courierX - at.x;
    const dz = probe.courierZ - at.z;
    if (dx * dx + dz * dz > DELIVERY_RANGE_M * DELIVERY_RANGE_M) {
      return `bring its trailer within ${DELIVERY_RANGE_M} m`;
    }
    return null;
  },
  onDelivered: (item) => ({
    deltas: [{ t: 'trailer_remove', trailerId: contractTrailerId(item) }],
  }),
};
