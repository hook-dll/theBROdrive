// THROWAWAY: swell-table bench and HEAD comparison. Delete before commit.
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { Road, ROAD_LENGTH } from '../src/world/road';
import { buildSpine } from '../src/world/roadspine';

const mode = process.argv[2]!;
const seed = Number(process.argv[3] ?? 1337) >>> 0;

const bytes = (o: object): number =>
  Object.values(o).reduce((n, v) => n + (ArrayBuffer.isView(v) ? v.byteLength : 0), 0);

if (mode === 'spine') {
  const gc = (globalThis as { gc?: () => void }).gc;
  gc?.();
  const before = process.memoryUsage();
  const t0 = performance.now();
  const spine = buildSpine(seed, ROAD_LENGTH);
  const ms = performance.now() - t0;
  const after = process.memoryUsage();
  console.log(
    `buildSpine(${seed}) ${ms.toFixed(0)} ms, tables ${(bytes(spine) / 1e6).toFixed(2)} MB, ` +
      `rss +${((after.rss - before.rss) / 1e6).toFixed(1)} MB, heap +${((after.heapUsed - before.heapUsed) / 1e6).toFixed(1)} MB, ` +
      `arrayBuffers +${((after.arrayBuffers - before.arrayBuffers) / 1e6).toFixed(1)} MB`,
  );
} else if (mode === 'cold') {
  const road = new Road(seed);
  road.spine;
  road.sampleAt(0);
  const times: number[] = [];
  for (let k = 5; k <= 44; k++) {
    const t0 = performance.now();
    road.sampleAt(k * 10000 + 5000);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  console.log(`seed ${seed} cold block p50 ${times[20]!.toFixed(2)} ms, max ${times[times.length - 1]!.toFixed(2)} ms`);
} else if (mode === 'dump' || mode === 'compare') {
  const road = new Road(seed);
  const slots = Math.ceil(400_000 / 950);
  const out: unknown[] = [];
  for (let slot = 0; slot < slots; slot++) {
    const w = road.swells.swellOf(slot);
    out.push(w ? { ...w } : null);
  }
  const file = `/tmp/swells-head-${seed}.json`;
  if (mode === 'dump') {
    writeFileSync(file, JSON.stringify(out));
    console.log(`dumped ${slots} slots, ${out.filter(Boolean).length} swells, to ${file}`);
  } else {
    if (!existsSync(file)) throw new Error('no dump');
    const head = JSON.parse(readFileSync(file, 'utf8')) as (Record<string, number> | null)[];
    let diffs = 0;
    for (let slot = 0; slot < slots; slot++) {
      const a = head[slot];
      const b = out[slot] as Record<string, number> | null;
      if (!a || !b) {
        if (a !== b) { diffs++; console.log(`slot ${slot}: head ${!!a} new ${!!b}`); }
        continue;
      }
      for (const key of Object.keys(a)) {
        if (!Object.is(a[key], b[key])) { diffs++; console.log(`slot ${slot} ${key}: ${a[key]} vs ${b[key]}`); }
      }
      if (Object.keys(a).length !== Object.keys(b).length) { diffs++; console.log(`slot ${slot}: key count`); }
    }
    console.log(`seed ${seed}: ${slots} slots, ${head.filter(Boolean).length} swells, ${diffs} differences`);
    if (diffs) process.exit(1);
  }
}
