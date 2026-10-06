/**
 * Bald tyres (kind 11): a set of worn tyres, and while it rides in a car that car is
 * held on the `bald` compound — index 0 of `TYRE_COMPOUNDS`, grip and side response
 * both 0.55. The composition root fits and removes the force on every tick (see
 * `Vehicle.setEnforcedTyreCompound`), because a respawned car is built free and the
 * driver's own cycle key is refused while it holds; the crate must be IN the car, not
 * merely carried, for the tyres to be on it.
 *
 * The signature is for keeping it on the road with them: no heavy impact and no
 * rollover for the whole trip. A heavy impact is 4 m/s of unexplained speed loss, the
 * same bar the convoy kind uses and the same order as the trailer kind's 3.5 — a real
 * shunt, so a kerb scuff or a wing mirror does not cost the sticker.
 */

import { defaultProgress, type ContractKindDef } from '../types';

/** Unexplained speed loss, m/s, that counts as a heavy impact. */
const IMPACT_LIMIT_MPS = 4;

export const baldTyresKind: ContractKindDef = {
  kind: 'bald_tyres',
  weight: 1,
  offerNames: ['set of bald tyres', 'worn tyre set', 'slick tyres', 'retread set'],
  signatureSticker: 'studs',
  initialProgress: defaultProgress,
  step: (p, ctx) => {
    const car = ctx.car;
    if (car === null) {
      p.statusText = 'fit the tyres to a car';
      return;
    }
    // The tyres were actually on a car: without this a hand-carried crate would pay
    // the signature for a condition that never applied.
    p.heat = 1;
    if (p.violated) return;
    if (car.impactMps > IMPACT_LIMIT_MPS) {
      p.violated = true;
      p.statusText = 'hard hit — bonus lost';
    } else if (car.upsideDown) {
      p.violated = true;
      p.statusText = 'on its roof — bonus lost';
    } else {
      p.statusText = 'bald tyres fitted';
    }
  },
  conditionMet: (p) => p.heat > 0 && !p.violated,
};
