/**
 * Fragile radio receiver: starts at 100% and only ever loses condition.
 *
 * Damage comes from the car it rides in — the same unexplained-speed loss and
 * landing depth the paint and the audio already read — plus a rollover while the
 * chassis is over, and a flat loss the moment the player drops it (any hand or boot
 * to ground transition, detected by the runtime, which is the item drop path).
 *
 * Above `SAFE_CONDITION` the special reward holds; below it the delivery still pays,
 * with the ordinary seed-random sticker.
 */

import { IMPACT_UNEXPLAINED_FLOOR_MPS } from '../../vehicle/vehicletuning';
import { clamp01, defaultProgress, type ContractKindDef } from '../types';

/** A shunt at the collision floor barely scuffs it; 5 m/s takes about a quarter. */
const DAMAGE_PER_MPS = 0.05;
/** Landings are vertical, so they start higher and hurt more per m/s. */
const LANDING_FLOOR_MPS = 2;
const LANDING_DAMAGE_PER_MPS = 0.06;
/** Per second spent on its roof. */
const ROLLOVER_DAMAGE_PER_S = 0.15;
/** One drop onto the ground, flat. */
const DROP_DAMAGE = 0.12;
/** Condition that still counts as "delivered intact". */
const SAFE_CONDITION = 0.6;

export const fragileRadioKind: ContractKindDef = {
  kind: 'fragile_radio',
  weight: 1,
  offerNames: ['fragile radio', 'valve radio', 'shortwave set', 'radio receiver'],
  signatureSticker: 'cassette',
  initialProgress: defaultProgress,
  step: (p, ctx) => {
    const car = ctx.car;
    if (car) {
      if (car.impactMps > IMPACT_UNEXPLAINED_FLOOR_MPS) {
        p.condition -= (car.impactMps - IMPACT_UNEXPLAINED_FLOOR_MPS) * DAMAGE_PER_MPS;
      }
      if (car.landingMps > LANDING_FLOOR_MPS) {
        p.condition -= (car.landingMps - LANDING_FLOOR_MPS) * LANDING_DAMAGE_PER_MPS;
      }
      if (car.upsideDown) p.condition -= ROLLOVER_DAMAGE_PER_S * ctx.dt;
    }
    if (ctx.droppedThisTick) p.condition -= DROP_DAMAGE;
    p.condition = clamp01(p.condition);
    p.statusText = `${Math.round(p.condition * 100)}%`;
  },
  conditionMet: (p) => p.condition >= SAFE_CONDITION,
};
