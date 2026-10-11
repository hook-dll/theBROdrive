/**
 * The traffic bench over several seeds, one after another, with the impacts summed.
 *
 * One seed is one random stream, and any change to a driver reshuffles all of it: the
 * same build gives anywhere from 0 to 5 impacts in the mixed queue depending on the
 * seed. A driving change is judged on the totals here, before and after, not on one
 * run of `traffic-bench.ts`.
 *
 *   bun tools/traffic-seeds.ts            # default seeds
 *   bun tools/traffic-seeds.ts 42 7 99    # these
 */

const DEFAULT_SEEDS = [42, 7, 1337, 2024, 99];
const seeds = process.argv.length > 2 ? process.argv.slice(2).map(Number) : DEFAULT_SEEDS;

/** Checks whose detail line starts with an impact count, summed across seeds. */
const IMPACT_CHECKS = [
  'mixed traffic queues without collision',
  'the turn costs no collisions',
  'lay-by stops cost no collisions',
  'own-side: hand-ins cost no collisions',
  'far-side: hand-ins cost no collisions',
];

const totals = new Map<string, number>(IMPACT_CHECKS.map((label) => [label, 0]));
const failures = new Map<string, number[]>();

for (const seed of seeds) {
  const run = Bun.spawnSync(['nice', '-n', '15', process.execPath, 'tools/traffic-bench.ts', String(seed)], {
    cwd: `${import.meta.dir}/..`,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const out = run.stdout.toString();
  const failed: string[] = [];
  for (const line of out.split('\n')) {
    const m = /^\s+(ok|FAIL)\s+(.+?)\s{2,}(.*)$/.exec(line);
    if (!m) continue;
    const [, verdict, label, detail] = m as unknown as [string, string, string, string];
    const impacts = /^(\d+) impact/.exec(detail);
    if (impacts && totals.has(label)) totals.set(label, totals.get(label)! + Number(impacts[1]));
    if (verdict === 'FAIL') {
      failed.push(label);
      failures.set(label, [...(failures.get(label) ?? []), seed]);
    }
  }
  console.log(`seed ${String(seed).padEnd(6)} ${failed.length === 0 ? 'all ok' : `FAIL: ${failed.join('; ')}`}`);
}

console.log('\nimpacts summed over seeds', seeds.join(', '));
for (const [label, count] of totals) console.log(`  ${String(count).padStart(3)}  ${label}`);
if (failures.size > 0) {
  console.log('\nfailing checks by seed');
  for (const [label, list] of failures) console.log(`  ${label}: ${list.join(', ')}`);
}
