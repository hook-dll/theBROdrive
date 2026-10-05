/**
 * Clean delivery: a significant impact voids the special reward; light touches are
 * forgiven.
 *
 * The threshold is deliberately above the paint's own damage floor
 * (`SCRATCH_IMPACT_THRESHOLD_MPS`, 1.8 m/s, where shell damage begins): a kerb
 * scrape is 1.8, a real shunt into a rock is well past the limit below. Landings
 * count at their own, higher bar.
 */

import { defaultProgress, type ContractKindDef } from '../types';

/** A genuinely hard hit, m/s of unexplained speed loss. */
const IMPACT_LIMIT_MPS = 3.5;
/** A dropped car landing hard, m/s. */
const LANDING_LIMIT_MPS = 3;

export const cleanDeliveryKind: ContractKindDef = {
  kind: 'clean_delivery',
  weight: 1,
  offerNames: ['porcelain set', 'crockery crate', 'paint tins', 'mirror panes'],
  signatureSticker: 'horseshoe',
  initialProgress: defaultProgress,
  step: (p, ctx) => {
    if (p.violated || !ctx.car) return;
    if (ctx.car.impactMps > IMPACT_LIMIT_MPS || ctx.car.landingMps > LANDING_LIMIT_MPS) {
      p.violated = true;
      p.statusText = 'rough delivery — bonus lost';
    }
  },
  conditionMet: (p) => !p.violated,
};
