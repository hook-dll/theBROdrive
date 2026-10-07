/**
 * Heavy crate: 80-200 kg that loads the car carrying it for real.
 *
 * The mass is stored on the item (`massKg`), so `itemMass` returns it and it reaches
 * physics with no extra plumbing: `Vehicle.computeStats` sums the boot's item
 * masses, `refreshLoad` re-sizes the springs and chassis mass, and the player's pack
 * limit slows them down on foot. There is nothing to fail, so once delivered it
 * always pays its signature sticker.
 *
 * Cargo mass is linear from the offer seed: 80..200 kg. An engine block is 120-150 kg;
 * a 2106's whole payload is about 400 kg with the people in it, and the 300-700 kg this
 * used to draw sat a saloon on its bump stops at the rear.
 */

import { hash01 } from '../../core/rng';
import { defaultProgress, type ContractKindDef } from '../types';

/** 'HVC1' domain, keeps the mass independent of the offer's other draws. */
const MASS_DOMAIN = 0x48564331;
const MASS_MIN_KG = 80;
const MASS_RANGE_KG = 121;

export const heavyCrateKind: ContractKindDef = {
  kind: 'heavy_crate',
  weight: 1,
  offerNames: ['heavy crates', 'machine crates', 'engine block crate', 'workshop crates'],
  signatureSticker: 'chevrons',
  initialProgress: defaultProgress,
  massKg: (seed) => MASS_MIN_KG + Math.floor(hash01(seed, MASS_DOMAIN) * MASS_RANGE_KG),
  step: () => {},
  conditionMet: () => true,
};
