/**
 * Sand route (kind 12): the case commissions a run over a line of gates planted off
 * the road, on sand, ahead of the courier it came from.
 *
 * The gates are not a spawned object; they are a pure function of the offer seed and
 * the road geometry (`contracts/gates.ts`), rebuilt whenever they are needed and
 * drawn by the runtime's gate field while the crate is out of its source courier. The
 * only thing saved is how many have been passed.
 *
 * Only the next expected gate is armed, so the sequence has to be taken in order. A
 * gate is passed when the carrying car's absolute position walks across its segment
 * between the posts; the signature pays when all of them are behind the car before
 * delivery.
 */

import { gateSequenceStep, sandRouteGateCount } from '../gates';
import { defaultProgress, type ContractKindDef } from '../types';

export const sandRouteKind: ContractKindDef = {
  kind: 'sand_route',
  weight: 1,
  offerNames: ['sand route order', 'desert course slip', 'track waybill', 'off-road route'],
  signatureSticker: 'cactus',
  initialProgress: defaultProgress,
  step: (p, ctx) => {
    const gates = ctx.gatesFor?.(ctx.item) ?? null;
    if (gates === null || gates.length === 0) return;
    const car = ctx.car;
    if (car !== null) {
      p.gatesPassed = gateSequenceStep(ctx.item.id, gates, p.gatesPassed, car.absoluteX, car.absoluteZ);
    }
    p.statusText = `gates ${Math.min(p.gatesPassed, gates.length)}/${gates.length}`;
  },
  conditionMet: (p, ctx) => p.gatesPassed >= sandRouteGateCount(ctx.item.generatedSeed),
};
