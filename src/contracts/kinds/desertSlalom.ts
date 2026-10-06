/**
 * Desert slalom (kind 13): a short technical section of alternating gates just off
 * each shoulder, entered from the asphalt and returning to it.
 *
 * Same gate system as the sand route (`contracts/gates.ts`): a pure layout from the
 * offer seed and the road geometry, order enforced by arming only the next gate, and
 * crossing measured from the carrying car's path between ticks. What is added here is
 * the clock and the run:
 *
 * - the timer runs from the first gate to the last, so backing up to retake a missed
 *   gate costs the section the time it really costs;
 * - the seeded limit (18-32 s) is loose enough to recover from one miss — the section
 *   is about 60 m — and blowing it loses only the signature;
 * - the signature also wants the car back on the asphalt after the last gate, which is
 *   read from the live wheel surfaces.
 */

import { gateSequenceStep, slalomGateCount, slalomTimeLimitS } from '../gates';
import { clockText, defaultProgress, type ContractKindDef } from '../types';

export const desertSlalomKind: ContractKindDef = {
  kind: 'desert_slalom',
  weight: 1,
  offerNames: ['slalom slip', 'handling test order', 'desert time trial', 'gymkhana card'],
  signatureSticker: 'chequered',
  initialProgress: (seed) => ({ ...defaultProgress(), gateTimeLimitS: slalomTimeLimitS(seed) }),
  step: (p, ctx) => {
    const gates = ctx.gatesFor?.(ctx.item) ?? null;
    if (gates === null || gates.length === 0) return;
    const count = gates.length;
    const car = ctx.car;

    if (car !== null && p.gatesPassed < count) {
      const before = p.gatesPassed;
      p.gatesPassed = gateSequenceStep(ctx.item.id, gates, p.gatesPassed, car.absoluteX, car.absoluteZ);
      if (before === 0 && p.gatesPassed > 0) p.gateStartedAtS = ctx.nowS;
      if (p.gatesPassed >= count && p.gateFinishedAtS === 0) p.gateFinishedAtS = ctx.nowS;
    }

    // A record written before the limit was saved (0) falls back to the seed's own, so
    // an old save is not an unwinnable section.
    const limit = p.gateTimeLimitS > 0 ? p.gateTimeLimitS : slalomTimeLimitS(ctx.item.generatedSeed);
    if (
      p.gateStartedAtS > 0
      && p.gateFinishedAtS === 0
      && ctx.nowS - p.gateStartedAtS > limit
      && !p.violated
    ) {
      p.violated = true;
      p.statusText = 'over time — bonus lost';
      return;
    }
    // The last beat of the section: back on the asphalt, and only once the run is in.
    if (car !== null && p.gatesPassed >= count && car.onRoad) p.gateReturned = true;

    if (p.violated) return;
    const elapsed = p.gateFinishedAtS > 0
      ? p.gateFinishedAtS - p.gateStartedAtS
      : p.gateStartedAtS > 0 ? ctx.nowS - p.gateStartedAtS : 0;
    p.statusText = `slalom ${clockText(elapsed)}`;
  },
  conditionMet: (p, ctx) =>
    p.gatesPassed >= slalomGateCount(ctx.item.generatedSeed) && p.gateReturned && !p.violated,
};
