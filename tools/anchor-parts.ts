/**
 * tools/anchor-parts.ts
 *
 * Which parts may hang on a car's cosmetic anchors, and which may not.
 *
 * The anchors (`GizmoAnchor`, render/carmodel.ts) exist because a mirror, a bumper or
 * a spare dashboard has nowhere else to go, and bolting one to the roof is the point.
 * An ENGINE is not that: it belongs in a bonnet slot, and previewing a ghost engine at
 * every anchor on the car advertised a dozen wrong destinations and none of the right
 * one — which is what `hasServiceSlot` now excludes, for the interaction resolve and
 * the ghost previews alike.
 *
 * This pins both halves of that rule: every kind a bonnet slot takes is excluded, and
 * the junk the anchors were built for is still offered.
 *
 *   npx tsx tools/anchor-parts.ts
 *
 * Nothing here is part of the game bundle.
 */

import { ALL_VARIANTS, variant, type PartKind } from '../src/parts/registry';
import { BONNET_SLOT_KINDS, hasServiceSlot } from '../src/vehicle/bonnet';

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(42)} ${detail}`);
}

const excluded = ALL_VARIANTS.filter((v) => hasServiceSlot(v.id));
const offered = ALL_VARIANTS.filter((v) => !hasServiceSlot(v.id));

const excludedKinds = new Set<PartKind>(excluded.map((v) => v.kind));
const offeredKinds = [...new Set<PartKind>(offered.map((v) => v.kind))].sort();

console.log(`${ALL_VARIANTS.length} variants: ${excluded.length} service, ${offered.length} junk`);
console.log(`  anchors still offer: ${offeredKinds.join(', ')}`);
console.log('');

// Every bonnet slot must actually have stock, or the exclusion would be excluding
// nothing and the engine ghosts would be back.
for (const slot of BONNET_SLOT_KINDS) {
  const stock = ALL_VARIANTS.filter((v) => v.kind === slot);
  check(`${slot}: has variants`, stock.length > 0, `${stock.length} in the catalogue`);
  check(
    `${slot}: every variant excluded`,
    stock.length > 0 && stock.every((v) => hasServiceSlot(v.id)),
    `${stock.filter((v) => hasServiceSlot(v.id)).length}/${stock.length}`,
  );
}

check(
  'nothing else is excluded',
  excludedKinds.size === BONNET_SLOT_KINDS.length,
  `${[...excludedKinds].sort().join(', ')}`,
);

// The other half: the anchors are not quietly dead now. Trim and dashboards have no
// service slot and are exactly what the ghost previews are for.
for (const kind of ['mirror', 'bumper', 'dashboard', 'wheel'] as const) {
  const stock = ALL_VARIANTS.filter((v) => v.kind === kind);
  check(
    `${kind}: still mounts on an anchor`,
    stock.length > 0 && stock.every((v) => !hasServiceSlot(v.id)),
    `${stock.length} variants offered`,
  );
}

// And the predicate must read the kind, not the id: a renamed variant of a slot kind
// must still be excluded.
const engine = ALL_VARIANTS.find((v) => v.kind === 'engine');
check(
  'the rule keys on kind, not id',
  engine !== undefined && variant(engine.id).kind === 'engine' && hasServiceSlot(engine.id),
  engine ? engine.id : 'no engine variant',
);

console.log(failures === 0 ? 'all checks passed' : `${failures} CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
