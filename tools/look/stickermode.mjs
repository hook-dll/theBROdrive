/**
 * tools/look/stickermode.mjs
 *
 * The sticker editing mode, driven the way a player drives it: out of the car on F,
 * an envelope in hand, the crosshair on the car, real wheel / Shift+wheel / E / F
 * input. Frames: the hint (cars glowing and winking), the live preview, turned,
 * sized and mirrored, placed; a second sticker overlapping the first (it must go on
 * top); one on a side window. Prints the HUD prompt at each step.
 *
 *   npm run dev -- --port 5199          (in another terminal)
 *   node tools/look/stickermode.mjs <outdir>
 *
 * Environment as far.mjs (URL SEED TIER W H DPR). Kill the dev server when done.
 */
import fs from 'node:fs';
import { bootIntoCar, launch, sleep, until } from './boot.mjs';

const [out] = process.argv.slice(2);
if (!out) {
  console.error('usage: node tools/look/stickermode.mjs <outdir>');
  process.exit(1);
}
fs.mkdirSync(out, { recursive: true });
const W = +(process.env.W ?? 1280);
const H = +(process.env.H ?? 720);
const URL = process.env.URL ?? 'http://localhost:5199/';

const browser = await launch({ W, H });
try {
  const page = await bootIntoCar(browser, {
    URL, W, H, DPR: +(process.env.DPR ?? 1), SEED: process.env.SEED ?? 'flick', TIER: process.env.TIER,
  });
  const prompt = () => page.evaluate(() => document.querySelector('.hud-prompt')?.textContent ?? '');
  const shot = async (name) => {
    await page.screenshot({ path: `${out}/${name}.png` });
    console.log(`${name}: ${await prompt()}`);
  };
  await page.evaluate(() => {
    const b = window.__bro;
    b.world.apply({ t: 'time_of_day', timeOfDay: 14 * 60 });
    b.weather.force('clear');
    b.jumpTo(3);
  });
  await until(page, () => window.__bro.settled(), null, 120000, 'the road');
  await page.evaluate(() => { window.__carId = window.__bro.world.state.player.drivingCarId; });
  await sleep(2500);
  await page.mouse.move(W / 2, H / 2);
  await page.keyboard.press('KeyF');
  await sleep(1500);

  // Stand beside the car's left flank and look at `target` (car-local metres).
  const stand = async (side, along, target) => {
    await page.evaluate(([side, along, target]) => {
      const b = window.__bro;
      const v = b.vehicles.get(window.__carId);
      if (!v) throw new Error(`car ${window.__carId} gone; have ${[...b.vehicles.keys()]}; driving ${b.world.state.player.drivingCarId}`);
      const t = v.chassis.translation();
      const q = v.chassis.rotation();
      const rot = (x, y, z) => {
        // Rotate a car-local vector by the chassis quaternion.
        const ix = q.w * x + q.y * z - q.z * y;
        const iy = q.w * y + q.z * x - q.x * z;
        const iz = q.w * z + q.x * y - q.y * x;
        const iw = -q.x * x - q.y * y - q.z * z;
        return [
          ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
          iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
          iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
        ];
      };
      const [ox, , oz] = rot(side * 2.4, 0, along);
      // teleport takes ABSOLUTE x/z; the chassis is in the floating-origin frame.
      b.player.teleport(t.x + ox + b.origin.x, t.y - 0.4, t.z + oz + b.origin.z);
      window.__aimAt = rot(...target).map((v, i) => v + [t.x, t.y, t.z][i]);
    }, [side, along, target]);
    await sleep(700);
    // Aim: yaw and pitch from the eye to the target, re-set until the view settles.
    for (let k = 0; k < 6; k++) {
      await page.evaluate(() => {
        const b = window.__bro;
        const eye = b.camera.eyePosition;
        const [x, y, z] = window.__aimAt;
        const dx = x - eye.x;
        const dy = y - eye.y;
        const dz = z - eye.z;
        b.camera.setYaw(Math.atan2(dx, dz));
        b.camera.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      });
      await sleep(120);
    }
  };
  const give = (kind) => page.evaluate((kind) => {
    const b = window.__bro;
    const id = `test:${kind}:${Math.random()}`;
    b.inventory.add({ type: 'sticker_envelope', id, stickerKind: kind, completedContractId: id });
    b.inventory.select(id);
  }, kind);
  const wheel = async (notches, shift = false) => {
    if (shift) await page.keyboard.down('ShiftLeft');
    for (let i = 0; i < Math.abs(notches); i++) {
      await page.mouse.wheel({ deltaY: Math.sign(notches) * 100 });
      await sleep(80);
    }
    if (shift) await page.keyboard.up('ShiftLeft');
    await sleep(200);
  };

  await give('flames');
  // The car in view, the crosshair on the road beside its nose: the hint, the car
  // glowing and winking (a wink every 3.5 s, two flashes in its first 0.8 s).
  await stand(-1, 2.5, [-1.2, -0.5, -3.2]);
  for (let i = 0; i < 6; i++) {
    await sleep(300);
    await shot(`hint-${i}`);
  }
  await stand(-1, 0, [-0.8, 0.0, 0.2]);
  await shot('preview');
  await wheel(2);
  await shot('turned');
  await wheel(-3, true);
  await page.keyboard.press('KeyE');
  await sleep(200);
  await shot('bigger-mirrored');
  await page.keyboard.press('KeyF');
  await sleep(400);
  await shot('placed');

  await give('su-oval');
  await stand(-1, 0, [-0.8, 0.05, 0.55]);
  await shot('second-preview');
  await page.keyboard.press('KeyF');
  await sleep(400);
  await shot('second-placed');

  await give('smiley');
  await stand(-1, 0.3, [-0.6, 0.55, 0.3]);
  await shot('glass-preview');
  await page.keyboard.press('KeyF');
  await sleep(400);
  await stand(-1, -0.6, [-0.7, 0.3, 0.2]);
  await shot('overview');
  console.log(JSON.stringify(await page.evaluate(() => {
    const b = window.__bro;
    return b.world.state.cars[window.__carId].stickers.map((s) => [s.kind, s.scale, s.mirror]);
  })));
} finally {
  await browser.close();
}
