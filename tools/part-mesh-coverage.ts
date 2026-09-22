/**
 * Every catalogue part builds a mesh, so the dev menu can spawn it without hanging.
 *
 *   npx tsx tools/part-mesh-coverage.ts
 *
 * `partmesh.ts`'s per-kind builders switch on `PartVariant.id` and `default: throw`
 * on anything they don't recognise. That throw is synchronous, inside the first
 * frame that tries to draw the spawned part, and nothing catches it — so a gap here
 * does not degrade gracefully, it freezes the game solid the moment a player (or the
 * dev menu's own part dispenser, which iterates every variant in the catalogue) asks
 * for that one id.
 *
 * `tools/soviet-reality.ts` already builds a mesh for every driveline id it exercises,
 * but only for cars whose id starts with `sv_`. That is exactly how an imported
 * UAZ-specific engine once went unbuildable after the Soviet pack's Volga engines
 * were split out: no bench outside the `sv_` cars tried to draw it. This bench has
 * no such blind spot: it builds every id in `ALL_VARIANTS`, the same list the dev
 * menu's part dispenser
 * draws from, so a hole here is a hole a player can actually reach.
 */
import { ALL_VARIANTS } from '../src/parts/registry';
import { createPartMesh } from '../src/render/partmesh';

const failures: string[] = [];
for (const v of ALL_VARIANTS) {
  try {
    createPartMesh(v.id);
  } catch (e) {
    failures.push(`${v.id} (${v.kind}): ${(e as Error).message}`);
  }
}

console.log(`${ALL_VARIANTS.length - failures.length}/${ALL_VARIANTS.length} catalogue parts build a mesh`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  FAIL  ${f}`);
  throw new Error(`${failures.length} part variant(s) cannot be spawned without crashing`);
}
