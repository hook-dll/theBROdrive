/**
 * Ordinary parcel: no condition beyond reaching a later courier, so it pays the
 * offer's own seed-random sticker. This is the common kind and the one the rest of
 * the system was built around; it never needs progress.
 */

import { defaultProgress, type ContractKindDef } from '../types';

export const PARCEL_NAMES = [
  'sealed film parcel',
  'radio parts parcel',
  'workshop papers',
  'road letters',
  'medical parcel',
  'machine drawings',
  'cassette parcel',
  'survey notes',
] as const;

export const parcelKind: ContractKindDef = {
  kind: 'parcel',
  weight: 4,
  offerNames: PARCEL_NAMES,
  signatureSticker: null,
  initialProgress: defaultProgress,
  step: () => {},
  conditionMet: () => false,
};
