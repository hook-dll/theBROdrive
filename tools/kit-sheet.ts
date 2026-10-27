/**
 * tools/kit-sheet.ts — one kit car's review sheet, in one command
 *
 * What the owner looks at when he reviews a body, on one page, without a browser or a
 * server: the car as built, closed, ray-traced in its own colours from six fixed angles,
 * its cabin from the driver's eye, and every reference photo its refs file names.
 *
 *   nice -n 15 bun tools/kit-sheet.ts <id> [id ...]   → build/kitcheck/<car>/review.png
 *
 * Rows, left to right: front three-quarter (35° to the left of the nose), left side,
 * rear three-quarter (150°); straight front, straight rear, three-quarter from above
 * (35° round, 35° up); the cabin (the driver's eye, 70°, a little down) and the refs'
 * photos (`sources` with an image, the drawing D aside: kit-drawing's overlays show it).
 * Paint is drawn the neutral blue-grey of the checks' renders; every other part in its own
 * colour, glass a blue film. Same angles every time, so two sheets of one car compare.
 *
 * Nothing here is part of the game bundle.
 */

import { existsSync, readFileSync } from 'node:fs';
import { installAssetShim } from './assetshim';
import { buildCar, image, kitIds, loadImage, lookAt, nodeAt, outDir, perspective, RayGrid, savePng, sideBySide, soupOf, trace, type Image, type V3 } from './kitlib';

installAssetShim();

const ROOT = new URL('../', import.meta.url).pathname;
const W = 560;
const H = 360;
const WHITE = [255, 255, 255, 255] as const;

/** Images one under another (left-aligned) on a white sheet, `gap` px apart. */
function stacked(rows: readonly Image[], gap = 8): Image {
  const w = Math.max(...rows.map((r) => r.w));
  const h = rows.reduce((a, r) => a + r.h, 0) + gap * (rows.length - 1);
  const out = image(w, h, [255, 255, 255, 255]);
  let y = 0;
  for (const r of rows) {
    for (let py = 0; py < r.h; py++) out.px.set(r.px.subarray(py * r.w * 4, (py + 1) * r.w * 4), ((y + py) * w) * 4);
    y += r.h + gap;
  }
  return out;
}

async function sheet(id: string): Promise<string> {
  const car = buildCar(id);
  const s = soupOf(car.root);
  const grid = new RayGrid(s, (t) => !s.meshes[s.mesh[t]!]!.hidden);
  let top = 0;
  for (let i = 1; i < s.v.length; i += 3) top = Math.max(top, s.v[i]!);
  const centre: V3 = [0, top / 2, 0];
  const range = 1.55 * car.spec.length;
  const view = (azDeg: number, elDeg: number): Image => {
    const az = (azDeg * Math.PI) / 180, el = (elDeg * Math.PI) / 180;
    const eye: V3 = [centre[0] + range * Math.sin(az) * Math.cos(el), centre[1] + range * Math.sin(el), centre[2] + range * Math.cos(az) * Math.cos(el)];
    return trace(s, grid, W, H, lookAt(eye, centre, 30, W, H).ray, undefined, WHITE).img;
  };
  const rows: Image[] = [
    sideBySide([view(35, 8), view(90, 3), view(150, 8)]),
    sideBySide([view(0, 3), view(180, 3), view(35, 35)]),
  ];
  const third: Image[] = [];
  const eye = nodeAt(car.root, 'kit_driver_eye');
  if (eye) third.push(trace(s, grid, W, H, perspective(eye, 0, -0.18, 70, W, H).ray, undefined, [235, 240, 245, 255]).img);
  const refsPath = `${ROOT}src/carkit/refs/${id}.json`;
  if (existsSync(refsPath)) {
    const refs = JSON.parse(readFileSync(refsPath, 'utf8')) as { sources: Record<string, { image?: string }> };
    for (const [tag, source] of Object.entries(refs.sources)) {
      if (tag === 'D' || !source.image || !existsSync(`${ROOT}${source.image}`)) continue;
      third.push(await loadImage(`${ROOT}${source.image}`, undefined, H));
    }
  }
  if (third.length > 0) rows.push(sideBySide(third));
  const path = `${await outDir(id)}review.png`;
  await savePng(stacked(rows), path);
  return path;
}

for (const id of kitIds(process.argv.slice(2))) console.log(`${id.padEnd(10)} ${await sheet(id)}`);
