/**
 * A thing carried by hand (game-design2.md §7.3): anything of the boy's that rides in a
 * boot, on a seat or across the rear bench (items/things.ts). Handed in through the
 * destination post's tray from the hands. No signature: it pays the offer's own
 * seed-random sticker.
 */

import type { ContractKindDef } from '../types';

export const thingKind: ContractKindDef = {
  kind: 'thing',
  signatureSticker: null,
};
