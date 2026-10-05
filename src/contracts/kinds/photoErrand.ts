/**
 * Photo errand (kind 20): an errand note names one thing to photograph, and the
 * courier signs it only with a matching photograph.
 *
 * The subject is chosen at generation from what actually lies on the road between the
 * source courier and a few couriers ahead (contracts/photosubjects.ts): a mirage, a
 * monument, a roadside building or a courier car. The note carries its subject's
 * stable id and name in `progress`, so the boot, the hand and the prompt all read what
 * is being asked for, and the delivery can match a photograph taken anywhere, at any
 * later time, through a save.
 *
 * THE PHOTOGRAPH IS THE CONDITION. A `photograph` item records the subjects the frame
 * test recognised at the shutter (`PhotoEvidence`), so the courier only needs to look
 * in the player's pack and its own boot — no world access, no image analysis. The
 * delivery consumes the photo it accepted, in the same transaction as the note.
 *
 * The signature wants a photograph taken AFTER the errand started (the note's own
 * clock) and framed closer than the evidence's ordinary bar. Both live on the photo,
 * so a picture taken before the pickup still delivers — for the ordinary sticker.
 */

import { pick } from '../../core/rng';
import type { PhotographItem } from '../../items/items';
import { courierStop } from '../../world/couriers';
import {
  PHOTO_SUBJECT_CATEGORIES,
  type PhotoSubjectSpec,
  type PhotoSubjectsProvider,
} from '../photosubjects';
import { defaultProgress, type ContractKindDef, type DeliveryProbe } from '../types';

/** 'PEC1', 'PES1': the category draw and the subject draw within it. */
const CATEGORY_DOMAIN = 0x50454331;
const SUBJECT_DOMAIN = 0x50455331;
/** Road metres ahead of the source courier where the subject must stand. */
const MIN_AHEAD_M = 400;
/** How many couriers ahead of the source the errand may point at (≈ 27 km). */
const ERRAND_COURIERS_AHEAD = 3;

/**
 * The subject this errand names: a category drawn from among those present ahead,
 * then one instance of it. Null only when the world seed has nothing ahead at all,
 * which a road with monuments cannot be — the fallback below still finds one.
 */
export function errandSubject(
  seed: number,
  generatedSeed: number,
  courierIndex: number,
  provider: PhotoSubjectsProvider,
): PhotoSubjectSpec | null {
  const here = courierStop(seed, courierIndex);
  const aheadS = courierStop(seed, courierIndex + ERRAND_COURIERS_AHEAD).s;
  let list = provider(here.s + MIN_AHEAD_M, aheadS);
  // A courier near the end of the road has little ahead of it; widen backwards so the
  // errand is still completable rather than empty.
  if (list.length === 0) list = provider(0, aheadS);
  if (list.length === 0) return null;
  const present = PHOTO_SUBJECT_CATEGORIES.filter((category) =>
    list.some((subject) => subject.category === category),
  );
  if (present.length === 0) return null;
  const category = pick(present, generatedSeed, CATEGORY_DOMAIN);
  return pick(
    list.filter((subject) => subject.category === category),
    generatedSeed,
    SUBJECT_DOMAIN,
  );
}

interface FoundPhoto {
  readonly item: PhotographItem;
  /** True when it came out of the player's pack rather than the courier's cells. */
  readonly inPack: boolean;
}

/** The first photograph showing this subject in the pack, then in the courier's cells. */
function findPhoto(subjectId: string, probe: DeliveryProbe): FoundPhoto | null {
  if (!subjectId) return null;
  for (const item of probe.carried) {
    if (item?.type === 'photograph' && item.evidence?.subjects.includes(subjectId)) {
      return { item, inPack: true };
    }
  }
  for (const item of probe.courierCells) {
    if (item?.type === 'photograph' && item.evidence?.subjects.includes(subjectId)) {
      return { item, inPack: false };
    }
  }
  return null;
}

export const photoErrandKind: ContractKindDef = {
  kind: 'photo_errand',
  weight: 1,
  offerNames: ['photo errand', 'courier photo job', 'photography commission', 'snapshot errand'],
  signatureSticker: 'sunset',
  initialProgress: (generatedSeed, offer) => {
    const subject = errandSubject(offer.seed, generatedSeed, offer.courierIndex, offer.photoSubjects);
    return {
      ...defaultProgress(),
      subjectId: subject?.id ?? '',
      // The label is what the boot, hand and prompt show next to the cargo name.
      statusText: subject ? subject.label.slice(0, 40) : '',
    };
  },
  acceptRefusal: (item, probe) => {
    const progress = item.progress;
    if (!progress.subjectId) return 'this errand names no subject';
    if (findPhoto(progress.subjectId, probe)) return null;
    return `bring a photograph of ${progress.statusText || 'the subject'}`;
  },
  step: () => {},
  conditionMet: (p, ctx) => {
    const found = findPhoto(p.subjectId, ctx.probe);
    if (!found || !found.item.evidence) return false;
    const evidence = found.item.evidence;
    // A photo taken before the note left its courier cannot carry the signature.
    if (evidence.playedS < p.startedAtS) return false;
    return evidence.subjectsClose.includes(p.subjectId);
  },
  onDelivered: (item, probe) => {
    const found = findPhoto(item.progress.subjectId, probe);
    if (!found) return null;
    return found.inPack
      ? { consumeCarried: [found.item.id] }
      : { consumeCourierItems: [found.item.id] };
  },
};
