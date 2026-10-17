/**
 * Throwaway audit: do walls/floors/ceilings in the POI gallery meet each other flush
 * (touching, not interpenetrating)? See tools/poizfight.ts `nearDuplicatePanels` for
 * what counts as a near-duplicate panel and what is excluded by construction.
 *
 *   npx tsx tools/poi-flush-check.ts
 */

import * as THREE from 'three';
import { POI_VARIANTS } from '../src/world/poi-variants';
import { boxCandidates, nearDuplicatePanels } from './poizfight';

let totalFlags = 0;
let totalCandidates = 0;

for (const def of POI_VARIANTS) {
  const root = new THREE.Group();
  def.build(root);
  const candidates = boxCandidates(root, false);
  totalCandidates += candidates.length;
  const flags = nearDuplicatePanels(candidates);
  if (flags.length > 0) {
    console.log(`${def.id} (${candidates.length} candidates): ${flags.length} near-duplicate panel(s)`);
    for (const f of flags) console.log(`    ${f}`);
    totalFlags += flags.length;
  }
}

console.log('');
console.log(`${totalCandidates} axis-aligned wall/floor/ceiling candidates scanned across ${POI_VARIANTS.length} variants`);
console.log(`${totalFlags} near-duplicate panel(s) flagged`);
process.exit(0);
