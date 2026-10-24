/**
 * tools/look/programs.mjs
 *
 * The shader program budget (render/programbudget.ts): boots the real game at each
 * graphics tier and reads the programs linked when the loading cover lifts. Without
 * flags it reports, per tier, what is new against config/program-budget.json and what
 * the list holds that nothing links any more. `--write` replaces the list with what was
 * linked: run it only when a new program is wanted, and say why in the commit.
 *
 *   node tools/look/programs.mjs [--write] [tier,...]   (default every tier)
 *
 * Needs a dev server on 5199 (URL as in far.mjs). The check itself also runs in every
 * dev boot and prints `[program budget]` errors to the console, so any look tool shows
 * them; this is the tool that writes the list.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { bootIntoCar, HORIZON_M, launch, until } from './boot.mjs';

const args = process.argv.slice(2);
const write = args.includes('--write');
const tiers = (args.find((a) => !a.startsWith('--')) ?? Object.keys(HORIZON_M).join(',')).split(',');
const FILE = new URL('../../config/program-budget.json', import.meta.url);
const budget = JSON.parse(readFileSync(FILE, 'utf8'));
let changed = false;
for (const tier of tiers) {
  const browser = await launch({ W: 1280, H: 720 });
  try {
    const page = await bootIntoCar(browser, { URL: process.env.URL ?? 'http://localhost:5199/', W: 1280, H: 720, SEED: process.env.SEED ?? 'flick', TIER: tier });
    await until(page, () => !!window.__broBootPrograms, null, 30000, 'the boot programs');
    const boot = await page.evaluate(() => window.__broBootPrograms);
    if (boot.tier !== tier) console.log(`(asked for ${tier}, the boot settled on ${boot.tier})`);
    const listed = new Map((budget[boot.tier] ?? []).map((e) => [e.id, e]));
    const live = new Map(boot.programs.map((e) => [e.id, e]));
    const fresh = [...live.values()].filter((e) => !listed.has(e.id));
    const gone = [...listed.values()].filter((e) => !live.has(e.id));
    console.log(`${boot.tier}: ${live.size} programs, budget ${listed.size}; ${fresh.length} new, ${gone.length} no longer linked`);
    for (const e of fresh) console.log(`  + ${e.id} ${e.label}`);
    for (const e of gone) console.log(`  - ${e.id} ${e.label}`);
    if (write) {
      budget[boot.tier] = [...live.values()].sort((a, b) => a.label.localeCompare(b.label));
      changed = true;
    }
  } finally {
    await browser.close();
  }
}
if (changed) {
  writeFileSync(FILE, JSON.stringify(budget, null, 2) + '\n');
  console.log(`wrote ${FILE.pathname}`);
}
