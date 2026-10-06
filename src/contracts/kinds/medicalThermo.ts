/**
 * Medical thermo box: the reward depends on elapsed time and accumulated heat.
 *
 * Heat is `temperature the box sees x exposed seconds`, summed only above a safe
 * band. Out of a car it sees the air; in a car it sees the cabin, a few degrees warm
 * with the engine off and warmed by the block while the engine runs. That makes the
 * cool of the night and a parked, shut-down car the two things that keep a load
 * cold, which is the decision the kind exists to ask for.
 *
 * Both limits are generous enough to pass an ordinary run; a box carried around all
 * afternoon in a hot car will not.
 */

import { defaultProgress, type ContractKindDef } from '../types';

/** Above this the load starts to cook, degrees C. */
const SAFE_BAND_C = 28;
/** A parked car under a desert sun. */
const PARKED_GAIN_C = 4;
/** A running engine bay/cabin adds this much over the air. */
const ENGINE_GAIN_C = 10;
/** Degree-seconds tolerated. At a 46 C afternoon that is roughly eight minutes. */
const HEAT_LIMIT = 8000;
/** And never more than half an hour on the clock. */
const TIME_LIMIT_S = 1800;

export const medicalThermoKind: ContractKindDef = {
  kind: 'medical_thermo',
  weight: 1,
  offerNames: ['medical thermo box', 'vaccine box', 'plasma carrier', 'insulin case'],
  signatureSticker: 'evil-eye',
  initialProgress: defaultProgress,
  step: (p, ctx) => {
    let seen = ctx.ambientC;
    if (ctx.place === 'car') seen += ctx.car?.engineRunning ? ENGINE_GAIN_C : PARKED_GAIN_C;
    const excess = seen - SAFE_BAND_C;
    if (excess > 0) p.heat += excess * ctx.dt;
    p.statusText = `heat ${Math.min(99, Math.round((p.heat / HEAT_LIMIT) * 100))}%`;
  },
  conditionMet: (p, ctx) => p.heat <= HEAT_LIMIT && ctx.nowS - p.startedAtS <= TIME_LIMIT_S,
};
