/**
 * One tank: the special reward is voided by refuelling the carrying car.
 *
 * The runtime spots a refuel as a rise in the car's fuel between ticks (the pour
 * path writes `car_fuel` with a higher level; burning only lowers it), so the check
 * needs no hook into the interaction code. Fuel is allowed — the delivery always
 * pays — only the bonus is lost.
 */

import { defaultProgress, type ContractKindDef } from '../types';

export const oneTankKind: ContractKindDef = {
  kind: 'one_tank',
  weight: 1,
  offerNames: ['fuel run', 'jerrycan consignment', 'depot fuel order', 'drum of petrol'],
  signatureSticker: 'route-m4',
  initialProgress: defaultProgress,
  step: (p, ctx) => {
    if (!p.violated && ctx.car?.refuelled) {
      p.violated = true;
      p.statusText = 'refuelled — bonus lost';
    }
  },
  conditionMet: (p) => !p.violated,
};
