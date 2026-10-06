/**
 * Urgent film: a soft deadline that starts the first time the cargo leaves its
 * source courier. Late delivery never destroys the cargo — it only drops the
 * special reward to the ordinary one.
 *
 * The deadline length is drawn from the offer seed (10-20 game minutes) and stored
 * in `softDeadlineS` at generation; the absolute deadline is fixed at pickup, so a
 * reload mid-drive keeps the same clock.
 */

import { hash01 } from '../../core/rng';
import { clockText, defaultProgress, type ContractKindDef } from '../types';

/** 'URG1' domain. */
const DEADLINE_DOMAIN = 0x55524731;
const DEADLINE_MIN_S = 600;
const DEADLINE_RANGE_S = 601;

export const urgentFilmKind: ContractKindDef = {
  kind: 'urgent_film',
  weight: 1,
  offerNames: ['urgent film', 'rush film can', 'newsreel reel', 'screening print'],
  signatureSticker: 'lightning',
  initialProgress: (seed) => ({
    ...defaultProgress(),
    softDeadlineS: DEADLINE_MIN_S + Math.floor(hash01(seed, DEADLINE_DOMAIN) * DEADLINE_RANGE_S),
  }),
  step: (p, ctx) => {
    if (p.deadlineS <= 0 && p.softDeadlineS > 0) p.deadlineS = p.startedAtS + p.softDeadlineS;
    const remaining = p.deadlineS - ctx.nowS;
    if (remaining <= 0) {
      p.late = true;
      p.statusText = 'overdue';
    } else {
      p.statusText = `${clockText(remaining)} left`;
    }
  },
  conditionMet: (p) => !p.late,
};
