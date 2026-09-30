/**
 * tools/look/gpu.mjs
 *
 * GPU milliseconds per frame, measured by the renderer's own timer queries, while the
 * autopilot drives. For comparing rungs against each other on one machine: the absolute
 * numbers are this machine's, the RATIOS are what carry to a weaker one.
 *
 *   TIER=retro node tools/look/gpu.mjs [seconds]      (SEED, W, H as in far.mjs)
 */
import { bootIntoCar, launch, sleep } from './boot.mjs';

const seconds = +(process.argv[2] ?? 20);
const W = +(process.env.W ?? 1280);
const H = +(process.env.H ?? 720);
const browser = await launch({ W, H });
try {
  const page = await bootIntoCar(browser, {
    URL: process.env.URL ?? 'http://localhost:5199/', W, H, SEED: process.env.SEED ?? 'flick', TIER: process.env.TIER,
  });
  const ok = await page.evaluate(() => {
    const b = window.__bro;
    b.autopilot.setMode('hurried');
    b.autopilot.setEngaged(true);
    return b.renderer.measuresGpuTime;
  });
  if (!ok) console.log('this browser exposes no GPU timer');
  const samples = [];
  for (let i = 0; i < seconds; i++) {
    await sleep(1000);
    samples.push(await page.evaluate(() => {
      const r = window.__bro.renderer;
      return { gpu: r.gpuFrameMs, px: r.renderedPixels, calls: r.drawCalls, tris: r.drawnTriangles };
    }));
  }
  const gpus = samples.map((s) => s.gpu).filter((g) => g !== null).sort((a, b) => a - b);
  const last = samples[samples.length - 1];
  console.log(
    `tier ${process.env.TIER ?? 'boot'}: gpu median ${gpus[gpus.length >> 1]?.toFixed(2)} ms `
    + `(min ${gpus[0]?.toFixed(2)}, max ${gpus[gpus.length - 1]?.toFixed(2)}), `
    + `${(last.px / 1e6).toFixed(2)} Mpx, ${last.calls} calls, ${Math.round(last.tris / 1000)}k tris`,
  );
} finally {
  await browser.close();
}
