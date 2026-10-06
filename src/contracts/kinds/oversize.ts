/**
 * Oversize load (kind 7): a 3.8 m bundle of pipes or beams on a contract trailer,
 * overhanging both ends of the 2.8 m bed. Same trailer-to-courier delivery as kind 6,
 * with the load as the whole point.
 *
 * The load is physical, not a label: the trailer carries an extra collider the size
 * of the overhang (`TrailerState.load`, vehicle/trailer.ts), so traffic, rocks and
 * gateposts hit the load itself, and its mass rides the ordinary bed payload path.
 * The special reward needs the load to arrive untouched — the same unexplained
 * speed-loss measure kind 6 uses, plus the tip check that matters most on a long,
 * high load.
 */

import { contractTrailerId } from '../world';
import { defaultProgress, type ContractKindDef } from '../types';

/** The parked trailer counts as delivered inside this radius of the courier, m. */
const DELIVERY_RANGE_M = 25;
/**
 * Lower than the equipment trailer's bar, because this is the dimension the kind
 * exists for: the overhang clips things the bed would clear, so the player is
 * asked to keep it clean and a 3 m/s scrape is already a real one.
 */
const IMPACT_LIMIT_MPS = 3;

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
  initialProgress: defaultProgress,
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
  step: (p, ctx) => {
    const trailerId = contractTrailerId(ctx.item);
    const car = ctx.car;
    const hooked = car !== null && car.trailerId === trailerId;
    p.statusText = hooked ? 'load on the bed' : '';
    if (p.violated || !hooked || car === null) return;
    if (car.trailerUpsideDown) {
      p.violated = true;
      p.statusText = 'load tipped — bonus lost';
    } else if (car.trailerImpactMps > IMPACT_LIMIT_MPS) {
      p.violated = true;
      p.statusText = 'load struck — bonus lost';
    }
  },
  conditionMet: (p) => !p.violated,
  onDelivered: (item) => ({
    deltas: [{ t: 'trailer_remove', trailerId: contractTrailerId(item) }],
  }),
};
