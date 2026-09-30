/**
 * tools/look/tris.mjs
 *
 * Where a frame's triangles and draw calls go: boots into the car at a tier, renders one
 * frame with per-object accounting, and prints the heaviest owners (grouped by the
 * nearest named ancestor) plus a chase-camera screenshot.
 *
 *   node tools/look/tris.mjs <out.png>      (TIER, SEED, W, H as in far.mjs)
 */
import { bootIntoCar, launch, sleep } from './boot.mjs';

const [out] = process.argv.slice(2);
const W = +(process.env.W ?? 1280);
const H = +(process.env.H ?? 720);
const browser = await launch({ W, H });
try {
  const page = await bootIntoCar(browser, {
    URL: process.env.URL ?? 'http://localhost:5199/', W, H, SEED: process.env.SEED ?? 'flick', TIER: process.env.TIER,
  });
  await sleep(3000);
  if (out) await page.screenshot({ path: out });
  const report = await page.evaluate(() => {
    const b = window.__bro;
    const r = b.renderer.renderer;
    const groups = new Map();
    const label = (o) => {
      let named = '';
      for (let p = o; p; p = p.parent) if (p.name) { named = p.name; break; }
      let top = o;
      while (top.parent && top.parent !== scene) top = top.parent;
      const m = [].concat(o.material)[0];
      const per = o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3;
      return `${named || 'top#' + scene.children.indexOf(top)} mat=${m.name || m.type} ${m.color ? '#' + m.color.getHexString() : ''} per=${Math.round(per)}`;
    };
    const cam = b.renderer.camera;
    const scene = b.renderer.scene;
        scene.traverseVisible((o) => {
      if (!o.isMesh && !o.isPoints && !o.isLine) return;
      const g = o.geometry;
      if (!g) return;
      const idx = g.index ? g.index.count : (g.attributes.position?.count ?? 0);
      const inst = o.isInstancedMesh ? o.count : 1;
      const range = g.drawRange.count === Infinity ? idx : Math.min(idx, g.drawRange.count);
      const tris = o.isMesh ? (range / 3) * inst : 0;
      const k = label(o) + (o.isInstancedMesh ? ' [inst]' : '');
      const e = groups.get(k) ?? { n: 0, tris: 0, mats: new Set() };
      e.n += 1; e.tris += tris;
      for (const m of [].concat(o.material)) e.mats.add(m.type);
      groups.set(k, e);
    });
    const rows = [...groups].sort((a, b) => b[1].tris - a[1].tris).slice(0, 30)
      .map(([k, e]) => `${String(Math.round(e.tris)).padStart(8)} tris ${String(e.n).padStart(4)} obj  ${k}  (${[...e.mats].join(',')})`);
    return `info: ${JSON.stringify(r.info.render)}\n` + rows.join('\n');
  });
  console.log(report);
} finally {
  await browser.close();
}
