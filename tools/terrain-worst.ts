/**
 * tools/terrain-worst.ts
 *
 * Finds the viewpoint where the drawn desert disagrees with itself the most, so a
 * screenshot can be aimed at the artefact instead of hoping to stumble on it.
 * Scans arclength for a seed and ranks by conflicts within 600 m of the camera.
 *
 *   npx tsx tools/terrain-worst.ts [seed] [fromM] [toM]
 *
 * Nothing here is part of the game bundle.
 */

import { overlapAt } from './terrain-overlap';

const seed = Number(process.argv[2] ?? 1337);
const from = Number(process.argv[3] ?? 22000);
const to = Number(process.argv[4] ?? 28000);

const rows: { s: number; near: number; total: number; worst: number }[] = [];
for (let s = from; s <= to; s += 200) {
  const r = overlapAt(seed, s);
  rows.push({ s, near: r.nearConflicts, total: r.conflicts, worst: r.worstSpreadM });
}
rows.sort((a, b) => b.near - a.near || b.worst - a.worst);
for (const r of rows.slice(0, 10)) {
  console.log(`s ${r.s}: ${r.near} conflicts inside 600 m, ${r.total} total, worst spread ${r.worst} m`);
}
