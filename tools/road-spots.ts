/**
 * tools/road-spots.ts
 *
 * Finds arclengths worth photographing: a steep pull with a crest just ahead, so a
 * screenshot from the road actually shows the road rising and dropping away.
 *
 *   npx tsx tools/road-spots.ts [seed]
 *
 * Nothing here is part of the game bundle.
 */

import { Road } from '../src/world/road';

const seed = Number(process.argv[2] ?? 1337);
const road = new Road(seed);

interface Spot {
  s: number;
  gradePct: number;
  crestInM: number;
  dropAfterM: number;
}

const spots: Spot[] = [];
for (let s = 1000; s <= 40_000; s += 20) {
  const g = road.gradeAt(s);
  if (g < 0.07) continue;
  // Distance to the next crest, and how far the road falls in the 400 m after it.
  let crest = -1;
  for (let d = 20; d <= 400; d += 20) {
    if (road.gradeAt(s + d) < 0) {
      crest = d;
      break;
    }
  }
  if (crest < 60 || crest > 300) continue;
  const top = road.sampleAt(s + crest).y;
  const after = road.sampleAt(s + crest + 400).y;
  spots.push({
    s,
    gradePct: +(g * 100).toFixed(1),
    crestInM: crest,
    dropAfterM: +(top - after).toFixed(1),
  });
}

spots.sort((a, b) => b.dropAfterM - a.dropAfterM);
for (const spot of spots.slice(0, 8)) {
  console.log(
    `s ${spot.s}: climbing ${spot.gradePct}%, crest in ${spot.crestInM} m, then drops ${spot.dropAfterM} m in 400 m`,
  );
}
