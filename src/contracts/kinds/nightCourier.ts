/**
 * Night courier: light-sensitive cargo that must be delivered inside the night
 * window (20:00 -> 06:00). Delivered by day it still pays, but only the ordinary
 * sticker. Daylight exposure also counts against it, so a load carried through a
 * whole day is spoiled even if it arrives after dark.
 */

import { clockText, defaultProgress, isDaylightTime, isNightTime, type ContractKindDef } from '../types';

/** Daylight seconds before the special reward is spoiled (ten minutes of sun). */
const EXPOSURE_LIMIT_S = 600;

export const nightCourierKind: ContractKindDef = {
  kind: 'night_courier',
  weight: 1,
  offerNames: ['night mail', 'luminous cargo', 'phosphor drums', 'after-dark packet'],
  signatureSticker: 'moon',
  initialProgress: defaultProgress,
  step: (p, ctx) => {
    if (isDaylightTime(ctx.timeOfDay, ctx.dayLength)) p.exposureS += ctx.dt;
    // "Sun-exposed" only once the limit is gone: in play it read "for night delivery —
    // sun-exposed" after 28 s of dusk, and the delivery then paid the moon anyway.
    const left = EXPOSURE_LIMIT_S - p.exposureS;
    if (left < 0) p.statusText = 'sun-spoiled';
    else if (isNightTime(ctx.timeOfDay, ctx.dayLength)) p.statusText = 'for night delivery';
    else p.statusText = `keep it out of the sun · ${clockText(left)}`;
  },
  conditionMet: (p, ctx) =>
    isNightTime(ctx.timeOfDay, ctx.dayLength) && p.exposureS <= EXPOSURE_LIMIT_S,
};
