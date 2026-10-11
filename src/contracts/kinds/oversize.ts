/**
 * Oversize load (kind 7): a 3.8 m bundle of pipes or beams on a contract trailer,
 * overhanging both ends of the 2.8 m bed. Same trailer-to-courier delivery as kind 6,
 * with the load as the whole point.
 *
 * The load is physical, not a label: the trailer carries an extra collider the size
 * of the overhang (`TrailerState.load`, vehicle/trailer.ts), so traffic, rocks and
 * gateposts hit the load itself, and its mass rides the ordinary bed payload path.
 * How it got there is not judged: a struck or tipped load still counts, and every
 * delivery pays its signature sticker.
 */

import { contractTrailerId } from '../world';
import type { ContractKindDef } from '../types';

/** The parked trailer counts as delivered inside this radius of the courier, m. */
const DELIVERY_RANGE_M = 25;

export const oversizeKind: ContractKindDef = {
  kind: 'oversize',
  weight: 1,
  offerNames: [
    'pipe bundle waybill',
    'girder load waybill',
    'oversize beam papers',
    'long pipes job sheet',
  ],
  signatureSticker: 'not-sure',
  acceptRefusal: (item, probe) => {
    const at = probe.trailerPosition(contractTrailerId(item));
    if (!at) return 'its oversize trailer is not here';
    const dx = probe.courierX - at.x;
    const dz = probe.courierZ - at.z;
    if (dx * dx + dz * dz > DELIVERY_RANGE_M * DELIVERY_RANGE_M) {
      return `bring the load within ${DELIVERY_RANGE_M} m`;
    }
    return null;
  },
  onDelivered: (item) => ({
    deltas: [{ t: 'trailer_remove', trailerId: contractTrailerId(item) }],
  }),
};
