/**
 * Ordinary parcel: no signature, so it pays the offer's own seed-random sticker.
 * This is the common kind.
 */

import type { ContractKindDef } from '../types';

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
};
