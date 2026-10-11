/**
 * Fragile radio receiver. Nothing on the way is scored: a dropped or shaken radio
 * still counts, and every delivery pays its signature sticker.
 */

import type { ContractKindDef } from '../types';

export const fragileRadioKind: ContractKindDef = {
  kind: 'fragile_radio',
  weight: 1,
  offerNames: ['fragile radio', 'valve radio', 'shortwave set', 'radio receiver'],
  signatureSticker: 'cassette',
};
