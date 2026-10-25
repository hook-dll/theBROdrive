/**
 * tools/look/hud.mjs
 *
 * Screenshots of the HUD strip (ui/hud.ts, ui/hudmap.ts, ui/balls.ts) in the real game:
 * driving under the autopilot with a fat purse and a thin one, a pile mid-change, each
 * backlight, on foot, far off the road, at a post's shop with prices on its cards, and
 * at a phone's width. Each card is also painted alone at full size (`card-*.png`), so
 * the balls on it can be judged without the world around them.
 *
 *   npm run dev -- --port 5199          (in another terminal)
 *   node tools/look/hud.mjs <outdir>
 *
 * Environment: URL, SEED, TIER, W H DPR as tools/look/far.mjs (default 1440x810 at 2).
 * Kill the dev server when done: the user runs their own.
 */
import fs from 'node:fs';
import { bootIntoCar, launch, sleep, until } from './boot.mjs';

const [out] = process.argv.slice(2);
if (!out) {
  console.error('usage: node tools/look/hud.mjs <outdir>');
  process.exit(1);
}
fs.mkdirSync(out, { recursive: true });
const W = +(process.env.W ?? 1440);
const H = +(process.env.H ?? 810);
const URL = process.env.URL ?? 'http://localhost:5199/';

const browser = await launch({ W, H });
try {
  const page = await bootIntoCar(browser, {
    URL, W, H, DPR: +(process.env.DPR ?? 2), SEED: process.env.SEED ?? 'flick', TIER: process.env.TIER,
  });
  const shot = async (name) => {
    await page.screenshot({ path: `${out}/${name}.png` });
    console.log(`${out}/${name}.png`);
  };
  const money = (rubles) => page.evaluate((r) => window.__bro.world.apply({ t: 'money', rubles: r }), rubles);
  const backlight = (b) => page.evaluate((v) => document.querySelector('.hud-strip')?.setAttribute('data-backlight', v), b);

  await money(1347);
  await page.evaluate(() => {
    const a = window.__bro.autopilot;
    a.setMode('hurried');
    a.setEngaged(true);
  });
  await sleep(9000);
  await shot('drive-autopilot');
  await page.evaluate(() => window.__bro.autopilot.setEngaged(false));
  await sleep(2500);
  await shot('drive');

  // The pile changing: 1599 → 1600 fuses nine small and nine middle balls into a big one.
  await money(1599);
  await sleep(800);
  await money(1600);
  await sleep(200);
  await shot('pile-mid-change');
  await sleep(900);
  await shot('pile-1600');
  await money(7);
  await sleep(900);
  await shot('pile-7');
  await money(0);
  await sleep(900);
  await shot('pile-0');
  await money(1347);

  for (const b of ['green', 'amber', 'blue']) {
    await backlight(b);
    await sleep(300);
    await shot(`backlight-${b}`);
  }

  // On foot, and then far off to the left of the road.
  await page.evaluate(() => window.__bro.world.apply({ t: 'exit_car' }));
  await sleep(2500);
  await shot('foot');
  await page.evaluate(() => {
    const b = window.__bro;
    const p = b.player.position;
    const h = b.road.headingAt(b.player.s);
    b.player.teleport(p.x + Math.cos(h) * 900, p.y + 40, p.z - Math.sin(h) * 900);
  });
  await sleep(600);
  await shot('foot-far-left');

  // A post's shop, prices on its cards; then the cards painted alone.
  await page.evaluate(() => window.__bro.standAtPost(1, 'shop'));
  await until(page, () => window.__bro.settled(), null, 120000, 'the post');
  await sleep(2500);
  await shot('shop');
  const cards = await page.evaluate(async () => {
    const { paintCardFace } = await import('/src/world/cardmachine.ts');
    const { formatMoney } = await import('/src/economy/economy.ts');
    const faces = [
      { band: '#2d5d8a', bandText: 'PART', corner: '1/4', headline: 'gearbox, worn', lines: [formatMoney(137), 'fits the bonnet'], footer: '' },
      { band: '#8a2d2d', bandText: 'JOB', corner: '2/5', headline: 'piano', lines: ['→ Dustwell · 6.2 km', `${formatMoney(352)} · bulky`, 'three rivals race you to it'], footer: 'the pay goes into your money' },
      { band: '#3b6b35', bandText: 'GUM', corner: '3/4', headline: 'bubble gum', lines: [formatMoney(2), 'NOT ENOUGH MONEY'], footer: '' },
    ];
    return faces.map((face) => {
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = 320;
      paintCardFace(c.getContext('2d'), c.width, c.height, face);
      return c.toDataURL('image/png').split(',')[1];
    });
  });
  cards.forEach((data, i) => fs.writeFileSync(`${out}/card-${i}.png`, Buffer.from(data, 'base64')));
  // A toast with an amount in it, as the HUD paints one.
  await page.evaluate(async () => {
    const { setGameText } = await import('/src/ui/balls.ts');
    const { formatMoney } = await import('/src/economy/economy.ts');
    const toast = document.createElement('div');
    toast.className = 'hud-toast';
    setGameText(toast, `race won — ${formatMoney(30)} more in the pay`);
    document.querySelector('.hud-toasts')?.append(toast);
    const prompt = document.querySelector('.hud-prompt');
    if (prompt) {
      setGameText(prompt, `VAZ-2106 for sale — ${formatMoney(450)} · ${formatMoney(120)} paid · pay at the key box`);
      prompt.classList.remove('is-hidden');
    }
  });
  await sleep(300);
  await shot('toast-prompt');

  // A phone's width.
  await page.setViewport({ width: 760, height: 360, deviceScaleFactor: 2 });
  await sleep(1200);
  await shot('narrow');
} finally {
  await browser.close();
}
