/**
 * tools/kit-check.ts — `npm run kit-check [-- id ...]`
 *
 * Every check a kit car must pass, in one run, with one pass/fail table per car. The
 * checks run one after another (never in parallel: each builds every car, and reality
 * drives each on the physics bench), each as its own process, under `nice -n 15`:
 *   zfight       tools/kit-zfight.ts       no visible z-fight in any band, no shell slit
 *   proportions  tools/kit-proportions.ts  fit row and hub moves within the hard gates
 *   reality      tools/reality.ts          engine, geometry, top speed, 0-100, turn, brakes
 *   mirrors      tools/kit-mirrors.ts      both door mirrors ≥ 60 % seen from the driver's eye
 *   surface      tools/kit-surface.ts      no dents or kinks; triangles and slivers in budget
 *   drawing      tools/kit-drawing.ts      the built car against src/carkit/refs/<car>.json
 *   dash         (kit-drawing)             future cars require a sourced dash photo and `dash` block;
 *                                         owner-accepted existing cars are explicitly exempt
 *
 * A car with no refs file is UNVERIFIED and a future car with no referenced dash is
 * DASH UNVERIFIED (both fail the acceptance gate). Existing cars named in
 * `tools/kit-drawing.ts` are accepted as-is for their dashboards. Evidence (renders, crops,
 * overlays, each tool's JSON) lands in build/kitcheck/ (gitignored); each tool's own log in
 * build/kitcheck/<tool>.log. Exits 1 if any car fails any check.
 *
 *   nice -n 15 bun tools/kit-check.ts [--no-images] [id ...]   (default: every kit car)
 *
 * Nothing here is part of the game bundle.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { kitIds } from './kitlib';

const ROOT = new URL('../', import.meta.url).pathname;
const OUT = `${ROOT}build/kitcheck/`;
mkdirSync(OUT, { recursive: true });

const args = process.argv.slice(2);
const ids = kitIds(args);
const named = args.some((a) => !a.startsWith('--'));
const images = args.includes('--no-images') ? ['--no-images'] : [];

interface Run {
  code: number;
  out: string;
}

/** One tool, niced, its log kept; returns its exit code and output. */
function run(tool: string, toolArgs: string[]): Run {
  const t0 = performance.now();
  const p = Bun.spawnSync(['nice', '-n', '15', process.execPath, `${ROOT}tools/${tool}.ts`, ...toolArgs], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' });
  const out = `${p.stdout.toString()}${p.stderr.toString()}`;
  writeFileSync(`${OUT}${tool}.log`, out);
  console.log(`${tool.padEnd(16)} exit ${p.exitCode}  ${((performance.now() - t0) / 1000).toFixed(0)} s`);
  return { code: p.exitCode ?? 1, out };
}

/** The lines a tool lists under its failure header, keyed by the car they name. */
function failedLines(out: string, header: RegExp): Map<string, string[]> {
  const by = new Map<string, string[]>();
  const lines = out.split('\n');
  const at = lines.findIndex((l) => header.test(l));
  if (at < 0) return by;
  for (const l of lines.slice(at + 1)) {
    const m = /^\s+(kit_)?([a-z0-9_]+)[: ]/.exec(l);
    if (!m) continue;
    const id = m[2]!;
    (by.get(id) ?? by.set(id, []).get(id)!).push(l.trim());
  }
  return by;
}

const modelIds = ids.map((id) => `kit_${id}`);
// reality.ts holds only the cars with a factory-target manifest entry (`TARGETS`, keyed
// `kit_<id>: {`); the rest are listed as having none, which is not a failure.
const realitySource = readFileSync(`${ROOT}tools/reality.ts`, 'utf8');
const withTargets = modelIds.filter((m) => new RegExp(`^\\s*(\\},\\s*)?${m}: \\{`, 'm').test(realitySource));
const zf = run('kit-zfight', [...(named ? ids : []), '--json', `${OUT}zfight.json`]);
const pr = run('kit-proportions', modelIds);
const re = run('reality', withTargets);
const mi = run('kit-mirrors', [...(named ? ids : []), ...images, '--json', `${OUT}mirrors.json`]);
const su = run('kit-surface', [...(named ? ids : []), ...images, '--json', `${OUT}surface.json`]);
const dr = run('kit-drawing', [...(named ? ids : []), ...images, '--json', `${OUT}drawing.json`]);

const readJson = (name: string): unknown => JSON.parse(readFileSync(`${OUT}${name}`, 'utf8'));
const zfight = readJson('zfight.json') as { results: { id: string; clusters: { severity: number }[]; slits: unknown[] }[] };
const mirrors = readJson('mirrors.json') as { id: string; mirrors: { side: string; seen: number; points: number }[]; findings: { level: string }[] }[];
const surface = readJson('surface.json') as { id: string; hits: { kind: string }[]; complexity: { total: number; findings: { level: string }[] } }[];
const drawing = readJson('drawing.json') as { id: string; body: string; dash: string; rows: { ok: boolean; info?: boolean }[]; dashRows: { ok: boolean }[] }[];
const prFails = failedLines(pr.out, /out of gate \(!\):/);
const reFails = failedLines(re.out, /out of tolerance \(!\):/);

const cell = (ok: boolean, text: string): string => (ok ? text : `✗ ${text}`);
const rows: string[][] = [];
let failing = 0;
for (const id of ids) {
  const z = zfight.results.find((r) => r.id === id);
  const zBad = z ? z.clusters.filter((c) => c.severity > 0).length + z.slits.length : -1;
  const m = mirrors.find((r) => r.id === id);
  const mBad = m ? m.findings.filter((f) => f.level === 'fail').length : -1;
  const mText = m ? m.mirrors.map((x) => `${x.side[0]!.toUpperCase()}${Math.round((100 * x.seen) / Math.max(1, x.points))}%`).join(' ') : 'n/a';
  const s = surface.find((r) => r.id === id);
  const dents = s ? s.hits.filter((h) => h.kind !== 'flip').length : -1;
  const cBad = s ? s.complexity.findings.filter((f) => f.level === 'fail').length : -1;
  const d = drawing.find((r) => r.id === id);
  const judged = d ? d.rows.filter((r) => !r.info) : [];
  const checks = [
    zBad === 0,
    !prFails.has(`kit_${id}`) && !prFails.has(id),
    !reFails.has(`kit_${id}`) && !reFails.has(id),
    mBad === 0,
    dents === 0,
    cBad === 0,
    !!d && d.body !== 'MISMATCH',
    !!d && (d.dash === 'OK' || d.dash === 'ACCEPTED EXISTING'),
  ];
  if (checks.some((c) => !c)) failing++;
  rows.push([
    id,
    cell(checks[0]!, zBad < 0 ? 'n/a' : zBad === 0 ? 'pass' : `${zBad}`),
    cell(checks[1]!, checks[1] ? 'pass' : `${prFails.get(`kit_${id}`)?.length ?? prFails.get(id)?.length}`),
    cell(checks[2]!, !withTargets.includes(`kit_${id}`) ? 'no target' : checks[2] ? 'pass' : `${reFails.get(`kit_${id}`)?.length ?? reFails.get(id)?.length}`),
    cell(checks[3]!, mText),
    cell(checks[4]!, dents < 0 ? 'n/a' : `${dents}`),
    cell(checks[5]!, s ? `${s.complexity.total}${cBad > 0 ? ` (${cBad})` : ''}` : 'n/a'),
    cell(checks[6]!, d ? `${d.body === 'VERIFIED' ? 'ok' : d.body} ${judged.filter((r) => r.ok).length}/${judged.length}` : 'n/a'),
    cell(checks[7]!, d ? `${d.dash === 'OK' ? 'ok' : d.dash} ${d.dashRows.filter((r) => r.ok).length}/${d.dashRows.length}` : 'n/a'),
  ]);
}
const head = ['car', 'zfight', 'proportions', 'reality', 'mirrors seen', 'dents', 'tris', 'drawing', 'dash'];
const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
const fmt = (r: string[]): string => r.map((c, i) => c.padEnd(widths[i]!)).join('  ');
console.log(`\n${fmt(head)}\n${widths.map((w) => '-'.repeat(w)).join('  ')}`);
for (const r of rows) console.log(fmt(r));
console.log(`\nlogs and evidence: build/kitcheck/ (<tool>.log, <tool>.json, <car>/*.png)`);
const toolsFailed = [zf, pr, re, mi, su, dr].some((r) => r.code !== 0);
if (failing > 0 || toolsFailed) {
  console.log(`\nFAIL: ${failing} of ${ids.length} car(s) fail a check (✗); details in each tool's log`);
  process.exit(1);
}
console.log(`\nPASS: all ${ids.length} car(s) pass every check`);
