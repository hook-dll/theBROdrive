/**
 * tools/look/hud.mjs
 *
 * Screenshots of the HUD (ui/hud.ts, ui/hudmap.ts, ui/hudgyro.ts, ui/hudjar.ts, ui/shellsprites.ts)
 * in the real game: driving under the autopilot and by hand, on foot, far off the road,
 * on foot at a post's shop with the shell jar out — a pour that overfills it (shells
 * popping over the rim) and a spend — prices on the shop's cards, and at a phone's
 * width. Each card is also painted alone at full size (`card-*.png`), so the shells on
 * it can be judged without the world around them.
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
  // Shells paid in (economy/economy.ts `credit`) and a price taken out.
  const pay = (n) => page.evaluate(async (count) => {
    const { credit } = await import('/src/economy/economy.ts');
    credit(window.__bro.world, count);
  }, n);
  const spendSome = (n) => page.evaluate(async (count) => {
    const { debit } = await import('/src/economy/economy.ts');
    debit(window.__bro.world, Math.min(count, window.__bro.world.state.player.shells));
  }, n);

  await pay(12);
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

  // A post's garage machine, prices on its cards; then the cards painted alone.
  await page.evaluate(() => window.__bro.standAtPost(1, 'garage'));
  await until(page, () => window.__bro.settled(), null, 120000, 'the post');
  await sleep(2500);
  await shot('garage');
  // The jar: 12 shells, then 40 more pour in and the full jar loses two over the rim;
  // then a price of 3 is taken out.
  await sleep(1500);
  await shot('jar-12');
  await pay(40);
  await sleep(350);
  await shot('jar-pour');
  await until(page, () => document.querySelectorAll('.hud-jar.is-shown').length > 0, null, 5000, 'the jar');
  for (let i = 0; i < 8; i++) {
    await sleep(250);
    await shot(`jar-after-${i}`);
  }
  await sleep(1500);
  await shot('jar-full');
  await spendSome(3);
  await sleep(320);
  await shot('jar-spend');
  await sleep(2000);
  await shot('jar-after-spend');
  const cards = await page.evaluate(async () => {
    const { paintCardFace } = await import('/src/world/cardmachine.ts');
    const { formatPay } = await import('/src/economy/economy.ts');
    const faces = [
      { band: '#2d5d8a', bandText: 'PART', corner: '1/4', headline: 'gearbox', lines: [formatPay(7), 'fits the bonnet'], footer: '' },
      { band: '#8a2d2d', bandText: 'JOB', corner: '2/5', headline: 'piano', lines: ['→ Dustwell · 6.2 km', `${formatPay(6)} · bulky`], footer: 'the pay goes into your jar' },
      { band: '#3b6b35', bandText: 'GUM', corner: '3/4', headline: 'bubble gum', lines: [formatPay(1), 'NOT ENOUGH SHELLS'], footer: '' },
      { band: '#4f6a3a', bandText: 'CAN', corner: '4/4', headline: 'can 20 L', lines: [formatPay(3), 'empty — fill it at a pump'], footer: '' },
      { band: '#2f4f7a', bandText: 'PART', corner: '1/2', headline: 'engine', lines: [formatPay(10), 'a new engine'], footer: '' },
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
  // A toast and a prompt with a price in them, as the HUD paints them.
  await page.evaluate(async () => {
    const { setGameText } = await import('/src/ui/shellsprites.ts');
    const { formatPay } = await import('/src/economy/economy.ts');
    const toast = document.createElement('div');
    toast.className = 'hud-toast';
    setGameText(toast, `petrol pump — fill ${formatPay(1)}`);
    document.querySelector('.hud-toasts')?.append(toast);
    const prompt = document.querySelector('.hud-prompt');
    if (prompt) {
      setGameText(prompt, `VAZ-2106 for sale — ${formatPay(6)} · pay at the key box`);
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
