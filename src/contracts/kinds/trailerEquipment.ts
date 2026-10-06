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
 * The special reward has ONE condition: the trailer arrived undamaged — never hit
 * hard and never tipped. Its impacts are the same measure the car's own are
 * (`Trailer.lastImpact`), read through the carrying car's coupled trailer.
 */

import { contractTrailerId } from '../world';
import { defaultProgress, type ContractKindDef } from '../types';

/** The parked trailer counts as delivered inside this radius of the courier, m. */
const DELIVERY_RANGE_M = 25;
/** A genuine shunt on the drawbar or the bed, m/s of unexplained speed loss. */
const IMPACT_LIMIT_MPS = 3.5;

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
  initialProgress: defaultProgress,
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
  step: (p, ctx) => {
    const trailerId = contractTrailerId(ctx.item);
    const car = ctx.car;
    const hooked = car !== null && car.trailerId === trailerId;
    p.statusText = hooked ? 'trailer hooked' : '';
    if (p.violated || !hooked || car === null) return;
    if (car.trailerUpsideDown) {
      p.violated = true;
      p.statusText = 'trailer tipped — bonus lost';
    } else if (car.trailerImpactMps > IMPACT_LIMIT_MPS) {
      p.violated = true;
      p.statusText = 'trailer hit — bonus lost';
    }
  },
  conditionMet: (p) => !p.violated,
  onDelivered: (item) => ({
    deltas: [{ t: 'trailer_remove', trailerId: contractTrailerId(item) }],
  }),
};
