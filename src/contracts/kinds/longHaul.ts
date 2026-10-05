/**
 * Long haul: accepted only at a courier at least N indices further on than the
 * source, where N is 2 or 3 drawn from the offer seed. Nearer couriers refuse, and
 * the refusal reason is shown through the ordinary prompt/delivery path.
 *
 * Nothing to track while it rides; once a far enough courier accepted it, the
 * condition is met by construction, so it pays its signature sticker.
 */

import { hash01 } from '../../core/rng';
import { defaultProgress, type ContractKindDef } from '../types';

/** 'LH11' domain. */
const LEAD_DOMAIN = 0x4c483131;

export const longHaulKind: ContractKindDef = {
  kind: 'long_haul',
  weight: 1,
  offerNames: ['long-haul pallet', 'transit documents', 'through cargo', 'waybill bundle'],
  signatureSticker: 'camels',
  initialProgress: defaultProgress,
  acceptRefusal: (item, probe) => {
    const lead = 2 + (hash01(item.generatedSeed, LEAD_DOMAIN) < 0.5 ? 0 : 1);
    if (probe.targetCourierIndex < item.sourceCourierIndex + lead) {
      return `long haul — take it at least ${lead} couriers further on`;
    }
    return null;
  },
  step: () => {},
  conditionMet: () => true,
};
