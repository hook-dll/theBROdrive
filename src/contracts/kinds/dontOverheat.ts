/**
 * Don't overheat: the carrying car's engine temperature must not enter the danger
 * zone. The zone is the live cooling system's own `overheating` flag (hot or
 * critical), so the cargo follows the same warning lamp the dashboard shows rather
 * than a second threshold.
 */

import { defaultProgress, type ContractKindDef } from '../types';

export const dontOverheatKind: ContractKindDef = {
  kind: 'dont_overheat',
  weight: 1,
  offerNames: ['instrument cluster', 'temperature probe', 'coolant sensor', 'gauge set'],
  signatureSticker: 'radiation',
  initialProgress: defaultProgress,
  step: (p, ctx) => {
    if (!p.violated && ctx.car?.engineOverheating) {
      p.violated = true;
      p.statusText = 'engine overheated — bonus lost';
    }
  },
  conditionMet: (p) => !p.violated,
};
