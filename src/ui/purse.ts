import {
  denominationLabel,
  formatMoney,
  PURSE_COIN_MM,
  PURSE_DENOMINATIONS,
  purseCoins,
  RUB,
} from '../economy/economy';
import { PURSE_TUBE_CAP } from '../render/purse';

/**
 * The purse as the HUD draws it (ui/hud.ts `setPurse`): the same Vyborg coin holder the
 * machines take into their slot (render/purse.ts), flat and in few tones. The aluminium
 * case, six tubes sized to their coins with the coins of the balance stacked edge-on
 * from the open end at the bottom (at most `PURSE_TUBE_CAP` a tube), a blue pusher riding
 * on each stack with its denomination embossed on it, and the total on a paper tag
 * beside the case.
 */

const CASE = '#a3aaac';
const CASE_EDGE = '#5e6668';
const TUBE = '#2c3032';
const KOPECK = '#c29a45';
const RUBLE = '#cfcfc6';
const COIN_EDGE = 'rgba(0, 0, 0, 0.35)';
const PUSHER = '#2f5fa6';
const PUSHER_TEXT = '#b9cdf0';
const TAG = '#efe6cf';
const INK = '#2a2620';

/** Paints the purse holding `kopecks` over the whole of `g`'s `w` × `h` pixels. */
export function drawPurse(g: CanvasRenderingContext2D, w: number, h: number, kopecks: number): void {
  g.clearRect(0, 0, w, h);
  const pad = h * 0.05;
  const caseW = w * 0.64;
  const caseH = h - pad * 2;
  const x0 = pad;
  const y0 = pad;

  // The case: a flat slab with a darker rim.
  g.fillStyle = CASE;
  g.strokeStyle = CASE_EDGE;
  g.lineWidth = Math.max(2, h * 0.025);
  g.beginPath();
  g.roundRect(x0, y0, caseW, caseH, h * 0.08);
  g.fill();
  g.stroke();

  // The tubes across it, each as wide as its coin.
  const wall = caseW * 0.025;
  const scale = (caseW - wall * (PURSE_COIN_MM.length + 1)) / PURSE_COIN_MM.reduce((sum, mm) => sum + mm, 0);
  const tubeTop = y0 + caseH * 0.08;
  const tubeBottom = y0 + caseH * 0.92;
  const pusherH = (tubeBottom - tubeTop) * 0.17;
  const pitch = (tubeBottom - tubeTop - pusherH) / PURSE_TUBE_CAP;
  const counts = purseCoins(kopecks);
  let x = x0 + wall;
  PURSE_COIN_MM.forEach((mm, i) => {
    const d = mm * scale;
    g.fillStyle = TUBE;
    g.fillRect(x, tubeTop, d, tubeBottom - tubeTop);
    // The coins, edge-on, from the open end up.
    const n = Math.min(PURSE_TUBE_CAP, counts[i]!);
    g.fillStyle = PURSE_DENOMINATIONS[i]! >= RUB ? RUBLE : KOPECK;
    for (let k = 0; k < n; k++) {
      const top = tubeBottom - pitch * (k + 1);
      g.fillRect(x + 1, top + 1, d - 2, pitch - 1);
    }
    g.strokeStyle = COIN_EDGE;
    g.lineWidth = 1;
    for (let k = 1; k < n; k++) {
      const line = Math.round(tubeBottom - pitch * k) + 0.5;
      g.beginPath();
      g.moveTo(x + 1, line);
      g.lineTo(x + d - 1, line);
      g.stroke();
    }
    // The pusher on the stack, or at the open end of an empty tube.
    const pusherTop = tubeBottom - pitch * n - pusherH;
    g.fillStyle = PUSHER;
    g.fillRect(x, pusherTop, d, pusherH);
    g.fillStyle = PUSHER_TEXT;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `bold ${Math.round(pusherH * 0.62)}px sans-serif`;
    g.fillText(denominationLabel(PURSE_DENOMINATIONS[i]!).replace('коп', ''), x + d / 2, pusherTop + pusherH / 2, d * 0.95);
    x += d + wall;
  });

  // The total on its tag.
  const tagX = x0 + caseW + pad * 1.4;
  const tagW = w - tagX - pad;
  const tagH = caseH * 0.62;
  const tagY = y0 + (caseH - tagH) / 2;
  g.fillStyle = TAG;
  g.fillRect(tagX, tagY, tagW, tagH);
  g.strokeStyle = INK;
  g.lineWidth = Math.max(2, h * 0.02);
  g.strokeRect(tagX, tagY, tagW, tagH);
  g.fillStyle = INK;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const rub = Math.floor(kopecks / RUB);
  const kop = kopecks % RUB;
  if (rub > 0 && kop > 0) {
    g.font = `bold ${Math.round(tagH * 0.34)}px sans-serif`;
    g.fillText(`${rub}р`, tagX + tagW / 2, tagY + tagH * 0.31, tagW * 0.9);
    g.fillText(`${kop}коп`, tagX + tagW / 2, tagY + tagH * 0.71, tagW * 0.9);
  } else {
    g.font = `bold ${Math.round(tagH * 0.38)}px sans-serif`;
    g.fillText(formatMoney(kopecks), tagX + tagW / 2, tagY + tagH / 2, tagW * 0.9);
  }
}
