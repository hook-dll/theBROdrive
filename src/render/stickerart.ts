import * as THREE from 'three';
import { STICKERS, type StickerKind } from '../items/stickercatalog';
import { maxAnisotropy } from './texturequality';

/**
 * The sticker designs, drawn once into one atlas.
 *
 * Everything is drawn here with the 2D canvas — there is no image file — in the
 * world's own comic language: flat printed colour and a firm ink line. Almost every
 * design is DIE-CUT: the vinyl is cut a few millimetres outside the print, so a white
 * rim runs round the shape, which is what makes a sticker read as a sticker on any
 * paint. The few printed on clear film (bullet holes, TURBO, the chevrons) have none.
 *
 * The atlas is stored premultiplied: the paint shader (materials.ts, CAR_STICKERS)
 * blends `paint * (1 - a) + rgb`, so the transparent border of every design filters
 * to nothing instead of to a dark fringe.
 */

/** Print resolution, pixels per metre of sticker: ~0.75 mm a pixel. */
const PX_PER_M = 1300;
/** White die-cut rim, pixels (~6 mm). */
const CUT = 8;
/** Gap between designs in the atlas, pixels, so mip levels do not bleed. */
const GAP = 12;
const ATLAS_W = 2048;

const INK = '#221a14';
const PAPER = '#f4efe2';
const RED = '#c8302a';
const YELLOW = '#f2c230';
const BLUE = '#2d5c9e';
const GREEN = '#3c7d3a';
const ORANGE = '#e8742a';

/** UV rectangle of one design in the atlas: u0, v0 (bottom-left), u1, v1. */
export type AtlasRect = readonly [number, number, number, number];

interface Design {
  /** Die-cut white rim round the print. */
  readonly cut: boolean;
  /** Draws the print into (0, 0, w, h), pixels, y down. */
  readonly draw: (g: CanvasRenderingContext2D, w: number, h: number) => void;
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function starPath(g: CanvasRenderingContext2D, cx: number, cy: number, outer: number, inner: number, points = 5, rot = -Math.PI / 2): void {
  g.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = rot + (i * Math.PI) / points;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function fillStroke(g: CanvasRenderingContext2D, fill: string, line: number, stroke = INK): void {
  g.fillStyle = fill;
  g.fill();
  if (line > 0) {
    g.lineWidth = line;
    g.strokeStyle = stroke;
    g.lineJoin = 'round';
    g.stroke();
  }
}

function circle(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
}

/** Text fitted to `maxW`, centred on (x, y). */
function text(
  g: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  size: number,
  maxW: number,
  colour: string,
  weight = '900',
  italic = false,
): void {
  g.font = `${italic ? 'italic ' : ''}${weight} ${size}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
  const width = g.measureText(s).width;
  const k = width > maxW ? maxW / width : 1;
  g.save();
  g.translate(x, y);
  g.scale(k, 1);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = colour;
  g.fillText(s, 0, 0);
  g.restore();
}

/** A warning triangle, point up, red rim and white field, as a road sign. */
function warningTriangle(g: CanvasRenderingContext2D, w: number, h: number): void {
  const pad = 4;
  g.beginPath();
  g.moveTo(w / 2, pad);
  g.lineTo(w - pad, h - pad);
  g.lineTo(pad, h - pad);
  g.closePath();
  g.lineJoin = 'round';
  fillStroke(g, RED, 6);
  const inset = Math.min(w, h) * 0.17;
  g.beginPath();
  g.moveTo(w / 2, pad + inset * 1.25);
  g.lineTo(w - pad - inset * 1.1, h - pad - inset * 0.6);
  g.lineTo(pad + inset * 1.1, h - pad - inset * 0.6);
  g.closePath();
  fillStroke(g, PAPER, 0);
}

// ---------------------------------------------------------------------------
// The designs
// ---------------------------------------------------------------------------

const DESIGNS: Record<StickerKind, Design> = {
  star: {
    cut: true,
    draw(g, w, h) {
      const r = Math.min(w, h) * 0.5 - 4;
      starPath(g, w / 2, h / 2 + r * 0.06, r, r * 0.42);
      fillStroke(g, RED, 7);
      starPath(g, w / 2, h / 2 + r * 0.06, r * 0.72, r * 0.3);
      g.lineWidth = 5;
      g.strokeStyle = YELLOW;
      g.stroke();
    },
  },
  'su-oval': {
    cut: true,
    draw(g, w, h) {
      g.beginPath();
      g.ellipse(w / 2, h / 2, w / 2 - 4, h / 2 - 4, 0, 0, Math.PI * 2);
      fillStroke(g, PAPER, 8);
      text(g, 'SU', w / 2, h / 2 + 4, h * 0.62, w * 0.62, INK);
    },
  },
  studs: {
    cut: true,
    draw(g, w, h) {
      warningTriangle(g, w, h);
      text(g, 'Ш', w / 2, h * 0.64, h * 0.42, w * 0.4, INK);
    },
  },
  learner: {
    cut: true,
    draw(g, w, h) {
      warningTriangle(g, w, h);
      text(g, 'У', w / 2, h * 0.64, h * 0.42, w * 0.4, INK);
    },
  },
  'limit-90': {
    cut: true,
    draw(g, w, h) {
      const r = Math.min(w, h) / 2 - 4;
      circle(g, w / 2, h / 2, r);
      fillStroke(g, RED, 4);
      circle(g, w / 2, h / 2, r * 0.76);
      fillStroke(g, PAPER, 0);
      text(g, '90', w / 2, h / 2 + 3, r * 0.95, r * 1.2, INK);
    },
  },
  camels: {
    cut: true,
    draw(g, w, h) {
      warningTriangle(g, w, h);
      // A camel in silhouette: body with a hump, neck forward, four legs.
      g.save();
      g.translate(w * 0.5, h * 0.66);
      const k = w / 320;
      g.scale(k, k);
      g.fillStyle = INK;
      g.beginPath();
      g.moveTo(-58, 0);
      g.bezierCurveTo(-60, -30, -30, -34, -18, -46);
      g.bezierCurveTo(-6, -58, 12, -50, 18, -34);
      g.bezierCurveTo(26, -22, 36, -22, 42, -34);
      g.lineTo(52, -58);
      g.bezierCurveTo(56, -66, 70, -66, 72, -58);
      g.lineTo(66, -52);
      g.lineTo(58, -30);
      g.bezierCurveTo(54, -12, 48, -4, 40, 0);
      g.closePath();
      g.fill();
      g.lineWidth = 7;
      g.lineCap = 'round';
      g.strokeStyle = INK;
      for (const x of [-48, -36, 24, 36]) {
        g.beginPath();
        g.moveTo(x, -4);
        g.lineTo(x + (x < 0 ? -2 : 2), 34);
        g.stroke();
      }
      g.restore();
    },
  },
  'route-m4': {
    cut: true,
    draw(g, w, h) {
      roundRect(g, 3, 3, w - 6, h - 6, 14);
      fillStroke(g, RED, 0);
      roundRect(g, 10, 10, w - 20, h - 20, 9);
      g.lineWidth = 5;
      g.strokeStyle = PAPER;
      g.stroke();
      text(g, 'М-4', w / 2, h / 2 + 3, h * 0.56, w * 0.78, PAPER);
    },
  },
  radiation: {
    cut: true,
    draw(g, w, h) {
      const r = Math.min(w, h) / 2 - 4;
      const cx = w / 2;
      const cy = h / 2;
      circle(g, cx, cy, r);
      fillStroke(g, YELLOW, 6);
      g.fillStyle = INK;
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / 3;
        g.beginPath();
        g.moveTo(cx + Math.cos(a - 0.52) * r * 0.24, cy + Math.sin(a - 0.52) * r * 0.24);
        g.arc(cx, cy, r * 0.82, a - 0.52, a + 0.52);
        g.arc(cx, cy, r * 0.24, a + 0.52, a - 0.52, true);
        g.closePath();
        g.fill();
      }
      circle(g, cx, cy, r * 0.15);
      g.fill();
    },
  },
  chequered: {
    cut: true,
    draw(g, w, h) {
      // A flag rippling: a grid of cells whose rows wave.
      const cols = 7;
      const rows = 5;
      const x0 = 8;
      const y0 = 10;
      const cw = (w - 16) / cols;
      const ch = (h - 26) / rows;
      const wave = (x: number): number => Math.sin((x / (w - 16)) * Math.PI * 1.6) * h * 0.06;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const xa = x0 + c * cw;
          const xb = xa + cw;
          g.beginPath();
          g.moveTo(xa, y0 + r * ch + wave(xa - x0));
          g.lineTo(xb, y0 + r * ch + wave(xb - x0));
          g.lineTo(xb, y0 + (r + 1) * ch + wave(xb - x0));
          g.lineTo(xa, y0 + (r + 1) * ch + wave(xa - x0));
          g.closePath();
          g.fillStyle = (r + c) % 2 === 0 ? INK : PAPER;
          g.fill();
        }
      }
      g.beginPath();
      g.moveTo(x0, y0 + wave(0));
      for (let x = 0; x <= w - 16; x += 4) g.lineTo(x0 + x, y0 + wave(x));
      for (let x = w - 16; x >= 0; x -= 4) g.lineTo(x0 + x, y0 + rows * ch + wave(x));
      g.closePath();
      g.lineWidth = 5;
      g.strokeStyle = INK;
      g.stroke();
    },
  },
  'number-07': {
    cut: true,
    draw(g, w, h) {
      const r = Math.min(w, h) / 2 - 4;
      circle(g, w / 2, h / 2, r);
      fillStroke(g, PAPER, 9);
      circle(g, w / 2, h / 2, r * 0.86);
      g.lineWidth = 4;
      g.strokeStyle = RED;
      g.stroke();
      text(g, '07', w / 2, h / 2 + 6, r * 1.15, r * 1.45, INK);
    },
  },
  cactus: {
    cut: true,
    draw(g, w, h) {
      // Sun behind, then a saguaro.
      circle(g, w * 0.68, h * 0.3, w * 0.26);
      fillStroke(g, ORANGE, 0);
      g.lineCap = 'round';
      const cx = w * 0.46;
      // One outline round the whole plant: every limb's ink first, then every limb's
      // green, so the joints merge instead of each limb outlining over the last.
      const limbs: [number, number, number, number, number][] = [
        [cx, h - 18, cx, h * 0.14, w * 0.2],
        [cx - w * 0.22, h * 0.6, cx - w * 0.22, h * 0.32, w * 0.12],
        [cx - w * 0.22, h * 0.6, cx, h * 0.6, w * 0.12],
        [cx + w * 0.22, h * 0.5, cx + w * 0.22, h * 0.24, w * 0.12],
        [cx + w * 0.22, h * 0.5, cx, h * 0.5, w * 0.12],
      ];
      for (const [pass, colour, extra] of [['ink', INK, 10], ['green', GREEN, 0]] as const) {
        void pass;
        for (const [x0, y0, x1, y1, width] of limbs) {
          g.beginPath();
          g.moveTo(x0, y0);
          g.lineTo(x1, y1);
          g.lineWidth = width + extra;
          g.strokeStyle = colour;
          g.stroke();
        }
      }
      // Ribs.
      g.lineWidth = 3;
      g.strokeStyle = '#2a5a28';
      g.beginPath();
      g.moveTo(cx, h * 0.18);
      g.lineTo(cx, h - 22);
      g.stroke();
      // Ground.
      g.beginPath();
      g.moveTo(6, h - 12);
      g.quadraticCurveTo(w / 2, h - 26, w - 6, h - 12);
      g.lineWidth = 6;
      g.strokeStyle = INK;
      g.stroke();
    },
  },
  sunset: {
    cut: true,
    draw(g, w, h) {
      roundRect(g, 4, 4, w - 8, h - 8, 18);
      g.save();
      g.clip();
      const sky = g.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#6a2c6e');
      sky.addColorStop(0.55, ORANGE);
      g.fillStyle = sky;
      g.fillRect(0, 0, w, h);
      // Striped sun, the stripes widening down.
      const cx = w / 2;
      const cy = h * 0.66;
      const r = h * 0.4;
      circle(g, cx, cy, r);
      g.fillStyle = YELLOW;
      g.fill();
      g.fillStyle = ORANGE;
      for (let i = 0; i < 5; i++) {
        const y = cy - r * 0.1 + i * r * 0.2;
        g.fillRect(cx - r, y, 2 * r, 3 + i * 3);
      }
      // Dunes.
      g.fillStyle = '#b8612c';
      g.beginPath();
      g.moveTo(0, h * 0.8);
      g.quadraticCurveTo(w * 0.3, h * 0.62, w * 0.62, h * 0.8);
      g.quadraticCurveTo(w * 0.85, h * 0.7, w, h * 0.76);
      g.lineTo(w, h);
      g.lineTo(0, h);
      g.fill();
      g.restore();
      roundRect(g, 4, 4, w - 8, h - 8, 18);
      g.lineWidth = 7;
      g.strokeStyle = INK;
      g.stroke();
    },
  },
  flames: {
    cut: true,
    draw(g, w, h) {
      // Hot-rod flames: a rounded body at the front (left) and five tongues licking
      // back, each curling to a point. Drawn three times, red, orange and yellow, each
      // shorter and slimmer inside the last.
      const layer = (k: number, fill: string, line: number): void => {
        const x0 = 6 + k * w * 0.035;
        const cy = h / 2;
        const spread = 1 - 0.22 * k;
        const reach = 1 - 0.2 * k;
        const tips = [0.8, 0.97, 1, 0.9, 0.72].map((l, i) => ({
          x: x0 + (w - 10 - x0) * l * reach,
          y: cy + (i - 2) * h * 0.2 * spread,
        }));
        const valley = (i: number): { x: number; y: number } => ({
          x: x0 + (w - x0) * (0.4 + 0.06 * (i % 2)) * reach,
          y: (tips[i]!.y + tips[i + 1]!.y) / 2,
        });
        g.beginPath();
        g.moveTo(x0 + h * 0.2, cy - h * 0.42 * spread);
        g.quadraticCurveTo(x0 + (w - x0) * 0.45, tips[0]!.y - h * 0.12, tips[0]!.x, tips[0]!.y);
        for (let i = 0; i < 4; i++) {
          const v = valley(i);
          const t = tips[i + 1]!;
          g.quadraticCurveTo(tips[i]!.x - (w - x0) * 0.28, (tips[i]!.y + v.y) / 2 + h * 0.03, v.x, v.y);
          g.quadraticCurveTo(t.x - (w - x0) * 0.3, t.y - h * 0.1, t.x, t.y);
        }
        g.quadraticCurveTo(x0 + (w - x0) * 0.45, tips[4]!.y + h * 0.1, x0 + h * 0.2, cy + h * 0.42 * spread);
        g.quadraticCurveTo(x0 - h * 0.05, cy, x0 + h * 0.2, cy - h * 0.42 * spread);
        g.closePath();
        fillStroke(g, fill, line);
      };
      layer(0, RED, 7);
      layer(1, ORANGE, 0);
      layer(2, YELLOW, 0);
    },
  },
  lightning: {
    cut: true,
    draw(g, w, h) {
      g.beginPath();
      g.moveTo(w * 0.62, 4);
      g.lineTo(w * 0.1, h * 0.56);
      g.lineTo(w * 0.46, h * 0.56);
      g.lineTo(w * 0.3, h - 4);
      g.lineTo(w * 0.92, h * 0.4);
      g.lineTo(w * 0.54, h * 0.4);
      g.closePath();
      fillStroke(g, YELLOW, 7);
    },
  },
  rocket: {
    cut: true,
    draw(g, w, h) {
      const cx = w / 2;
      // Exhaust.
      g.beginPath();
      g.moveTo(cx - w * 0.14, h * 0.72);
      g.quadraticCurveTo(cx, h * 1.02, cx + w * 0.14, h * 0.72);
      fillStroke(g, ORANGE, 5);
      // Fins.
      g.beginPath();
      g.moveTo(cx - w * 0.17, h * 0.5);
      g.lineTo(cx - w * 0.36, h * 0.76);
      g.lineTo(cx - w * 0.14, h * 0.7);
      g.moveTo(cx + w * 0.17, h * 0.5);
      g.lineTo(cx + w * 0.36, h * 0.76);
      g.lineTo(cx + w * 0.14, h * 0.7);
      fillStroke(g, RED, 5);
      // Body.
      g.beginPath();
      g.moveTo(cx, h * 0.04);
      g.bezierCurveTo(cx + w * 0.26, h * 0.2, cx + w * 0.2, h * 0.6, cx + w * 0.14, h * 0.72);
      g.lineTo(cx - w * 0.14, h * 0.72);
      g.bezierCurveTo(cx - w * 0.2, h * 0.6, cx - w * 0.26, h * 0.2, cx, h * 0.04);
      g.closePath();
      fillStroke(g, PAPER, 6);
      circle(g, cx, h * 0.34, w * 0.08);
      fillStroke(g, BLUE, 5);
      text(g, 'СССР', cx, h * 0.54, w * 0.13, w * 0.24, RED);
      text(g, 'ПОЕХАЛИ!', cx, h * 0.93, w * 0.13, w * 0.9, INK);
    },
  },
  sputnik: {
    cut: true,
    draw(g, w, h) {
      const cx = w * 0.4;
      const cy = h * 0.42;
      const r = h * 0.2;
      g.lineCap = 'round';
      g.lineWidth = 5;
      g.strokeStyle = INK;
      for (const [dx, dy] of [[1, 0.9], [1, 0.62], [0.9, 1.05], [0.72, 1.12]] as const) {
        g.beginPath();
        g.moveTo(cx, cy);
        g.lineTo(cx + dx * w * 0.56, cy + dy * h * 0.46);
        g.stroke();
      }
      circle(g, cx, cy, r);
      const shine = g.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
      shine.addColorStop(0, '#ffffff');
      shine.addColorStop(1, '#9aa3ab');
      fillStroke(g, '#c4ccd2', 6);
      circle(g, cx, cy, r - 3);
      g.fillStyle = shine;
      g.fill();
      for (const [x, y] of [[0.12, 0.14], [0.82, 0.16], [0.2, 0.86], [0.92, 0.52]] as const) {
        starPath(g, w * x, h * y, h * 0.06, h * 0.025, 4, 0);
        fillStroke(g, YELLOW, 0);
      }
    },
  },
  cassette: {
    cut: true,
    draw(g, w, h) {
      roundRect(g, 4, 4, w - 8, h - 8, 10);
      fillStroke(g, '#35302c', 6);
      roundRect(g, w * 0.1, h * 0.14, w * 0.8, h * 0.46, 6);
      fillStroke(g, ORANGE, 4);
      text(g, 'С-90', w / 2, h * 0.24, h * 0.13, w * 0.3, INK);
      roundRect(g, w * 0.24, h * 0.3, w * 0.52, h * 0.2, 12);
      fillStroke(g, PAPER, 4);
      for (const x of [0.34, 0.66]) {
        circle(g, w * x, h * 0.4, h * 0.075);
        fillStroke(g, '#35302c', 3);
      }
      g.beginPath();
      g.moveTo(w * 0.24, h - 8);
      g.lineTo(w * 0.3, h * 0.72);
      g.lineTo(w * 0.7, h * 0.72);
      g.lineTo(w * 0.76, h - 8);
      g.lineWidth = 4;
      g.strokeStyle = '#8a8076';
      g.stroke();
    },
  },
  smiley: {
    cut: true,
    draw(g, w, h) {
      const r = Math.min(w, h) / 2 - 4;
      circle(g, w / 2, h / 2, r);
      fillStroke(g, YELLOW, 7);
      g.fillStyle = INK;
      g.beginPath();
      g.ellipse(w / 2 - r * 0.33, h / 2 - r * 0.22, r * 0.09, r * 0.17, 0, 0, Math.PI * 2);
      g.ellipse(w / 2 + r * 0.33, h / 2 - r * 0.22, r * 0.09, r * 0.17, 0, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.arc(w / 2, h / 2 + r * 0.02, r * 0.55, 0.18 * Math.PI, 0.82 * Math.PI);
      g.lineWidth = 7;
      g.lineCap = 'round';
      g.strokeStyle = INK;
      g.stroke();
    },
  },
  peace: {
    cut: true,
    draw(g, w, h) {
      const r = Math.min(w, h) / 2 - 4;
      const cx = w / 2;
      const cy = h / 2;
      circle(g, cx, cy, r);
      fillStroke(g, '#6bb0a0', 0);
      g.lineWidth = r * 0.16;
      g.strokeStyle = PAPER;
      g.lineCap = 'butt';
      circle(g, cx, cy, r * 0.78);
      g.stroke();
      g.beginPath();
      g.moveTo(cx, cy - r * 0.78);
      g.lineTo(cx, cy + r * 0.78);
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(Math.PI / 4) * r * 0.78, cy + Math.sin(Math.PI / 4) * r * 0.78);
      g.moveTo(cx, cy);
      g.lineTo(cx - Math.cos(Math.PI / 4) * r * 0.78, cy + Math.sin(Math.PI / 4) * r * 0.78);
      g.stroke();
      circle(g, cx, cy, r);
      g.lineWidth = 6;
      g.strokeStyle = INK;
      g.stroke();
    },
  },
  horseshoe: {
    cut: true,
    draw(g, w, h) {
      const cx = w / 2;
      const cy = h * 0.46;
      const r = w * 0.36;
      g.lineCap = 'butt';
      g.beginPath();
      g.arc(cx, cy, r, Math.PI * 0.82, Math.PI * 2.18, false);
      g.lineWidth = r * 0.46 + 10;
      g.strokeStyle = INK;
      g.stroke();
      g.lineWidth = r * 0.46;
      g.strokeStyle = '#a8adb2';
      g.stroke();
      g.fillStyle = INK;
      for (let i = 0; i < 7; i++) {
        const a = Math.PI * (0.9 + (i * 1.2) / 6);
        circle(g, cx + Math.cos(a) * r, cy + Math.sin(a) * r, 4);
        g.fill();
      }
      starPath(g, cx, cy + r * 0.2, r * 0.32, r * 0.13);
      fillStroke(g, YELLOW, 3);
    },
  },
  'evil-eye': {
    cut: true,
    draw(g, w, h) {
      const r = Math.min(w, h) / 2 - 4;
      const cx = w / 2;
      const cy = h / 2;
      circle(g, cx, cy, r);
      fillStroke(g, '#1f4fa0', 6);
      circle(g, cx, cy, r * 0.66);
      fillStroke(g, PAPER, 0);
      circle(g, cx, cy, r * 0.42);
      fillStroke(g, '#7fb6e6', 0);
      circle(g, cx, cy, r * 0.2);
      fillStroke(g, INK, 0);
      circle(g, cx - r * 0.1, cy - r * 0.1, r * 0.06);
      fillStroke(g, '#ffffff', 0);
    },
  },
  'bullet-holes': {
    cut: false,
    draw(g, w, h) {
      // Printed on clear film: the paint shows round each hole.
      const hole = (x: number, y: number, r: number, seed: number): void => {
        g.strokeStyle = 'rgba(236,236,230,0.9)';
        g.lineWidth = 2;
        for (let i = 0; i < 9; i++) {
          const a = seed + i * 0.7 + Math.sin(seed * 3 + i) * 0.3;
          const len = r * (1.8 + ((i * 37 + seed * 11) % 10) / 6);
          g.beginPath();
          g.moveTo(x + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.9);
          g.lineTo(x + Math.cos(a + 0.1) * len, y + Math.sin(a + 0.1) * len);
          g.stroke();
        }
        circle(g, x, y, r * 1.1);
        g.fillStyle = '#c9c6bd';
        g.fill();
        circle(g, x, y, r * 0.8);
        g.fillStyle = '#4a4540';
        g.fill();
        circle(g, x, y, r * 0.5);
        g.fillStyle = '#0c0a09';
        g.fill();
      };
      hole(w * 0.25, h * 0.38, h * 0.1, 1);
      hole(w * 0.62, h * 0.28, h * 0.085, 2.3);
      hole(w * 0.52, h * 0.7, h * 0.11, 4.1);
    },
  },
  paws: {
    cut: true,
    draw(g, w, h) {
      const paw = (x: number, y: number, s: number, a: number): void => {
        g.save();
        g.translate(x, y);
        g.rotate(a);
        g.fillStyle = INK;
        g.beginPath();
        g.ellipse(0, s * 0.25, s * 0.42, s * 0.34, 0, 0, Math.PI * 2);
        g.fill();
        for (const [tx, ty] of [[-0.42, -0.2], [-0.15, -0.48], [0.15, -0.48], [0.42, -0.2]] as const) {
          g.beginPath();
          g.ellipse(tx * s, ty * s, s * 0.15, s * 0.2, tx * 0.6, 0, Math.PI * 2);
          g.fill();
        }
        g.restore();
      };
      const s = h * 0.36;
      paw(w * 0.12, h * 0.62, s, 1.45);
      paw(w * 0.37, h * 0.36, s, 1.65);
      paw(w * 0.62, h * 0.62, s, 1.45);
      paw(w * 0.87, h * 0.36, s, 1.65);
    },
  },
  turbo: {
    cut: false,
    draw(g, w, h) {
      // Speed lines trailing, then the word leaning into the wind.
      g.fillStyle = RED;
      for (let i = 0; i < 3; i++) g.fillRect(0, h * (0.24 + i * 0.2), w * (0.22 - i * 0.05), h * 0.1);
      g.lineWidth = 8;
      g.strokeStyle = INK;
      g.font = `italic 900 ${h * 0.86}px "Arial Black", Arial, sans-serif`;
      g.textAlign = 'right';
      g.textBaseline = 'middle';
      const width = g.measureText('TURBO').width;
      g.save();
      g.translate(w - 4, h / 2 + 3);
      g.scale(Math.min(1, (w * 0.76) / width), 1);
      g.strokeText('TURBO', 0, 0);
      g.fillStyle = YELLOW;
      g.fillText('TURBO', 0, 0);
      g.restore();
    },
  },
  chevrons: {
    cut: false,
    draw(g, w, h) {
      roundRect(g, 2, 2, w - 4, h - 4, 6);
      g.save();
      g.clip();
      g.fillStyle = YELLOW;
      g.fillRect(0, 0, w, h);
      g.fillStyle = INK;
      const step = h * 0.9;
      for (let x = -h; x < w + h; x += step) {
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x + step * 0.45, 0);
        g.lineTo(x + step * 0.45 + h * 0.5, h / 2);
        g.lineTo(x + step * 0.45, h);
        g.lineTo(x, h);
        g.lineTo(x + h * 0.5, h / 2);
        g.closePath();
        g.fill();
      }
      g.restore();
      roundRect(g, 2, 2, w - 4, h - 4, 6);
      g.lineWidth = 4;
      g.strokeStyle = INK;
      g.stroke();
    },
  },
  skull: {
    cut: true,
    draw(g, w, h) {
      const cx = w / 2;
      const cy = h * 0.56;
      // Crossed bones behind the skull, knuckled at both ends.
      const bone = (a: number, pass: 'ink' | 'bone'): void => {
        g.save();
        g.translate(cx, cy);
        g.rotate(a);
        const len = w * 0.4;
        const r = h * 0.075;
        const extra = pass === 'ink' ? 5 : 0;
        g.fillStyle = pass === 'ink' ? INK : PAPER;
        g.fillRect(-len, -h * 0.045 - extra, len * 2, h * 0.09 + extra * 2);
        for (const x of [-len, len]) {
          for (const y of [-r * 0.7, r * 0.7]) {
            circle(g, x, y, r + extra);
            g.fill();
          }
        }
        g.restore();
      };
      for (const pass of ['ink', 'bone'] as const) {
        bone(0.62, pass);
        bone(-0.62, pass);
      }
      g.beginPath();
      g.arc(cx, h * 0.38, w * 0.28, Math.PI * 0.82, Math.PI * 2.18);
      g.lineTo(cx + w * 0.15, h * 0.7);
      g.lineTo(cx - w * 0.15, h * 0.7);
      g.closePath();
      fillStroke(g, PAPER, 6);
      g.fillStyle = INK;
      for (const sx of [-1, 1]) {
        g.beginPath();
        g.ellipse(cx + sx * w * 0.11, h * 0.42, w * 0.075, h * 0.075, 0, 0, Math.PI * 2);
        g.fill();
      }
      g.beginPath();
      g.moveTo(cx, h * 0.5);
      g.lineTo(cx - w * 0.035, h * 0.57);
      g.lineTo(cx + w * 0.035, h * 0.57);
      g.fill();
      g.lineWidth = 3;
      g.strokeStyle = INK;
      for (const x of [-0.07, 0, 0.07]) {
        g.beginPath();
        g.moveTo(cx + x * w, h * 0.63);
        g.lineTo(cx + x * w, h * 0.7);
        g.stroke();
      }
    },
  },
  cat: {
    cut: true,
    draw(g, w, h) {
      const cx = w / 2;
      const cy = h * 0.56;
      const r = w * 0.36;
      g.beginPath();
      g.moveTo(cx - r * 0.95, cy - r * 0.2);
      g.lineTo(cx - r * 0.85, cy - r * 1.2);
      g.lineTo(cx - r * 0.3, cy - r * 0.8);
      g.quadraticCurveTo(cx, cy - r * 0.9, cx + r * 0.3, cy - r * 0.8);
      g.lineTo(cx + r * 0.85, cy - r * 1.2);
      g.lineTo(cx + r * 0.95, cy - r * 0.2);
      g.bezierCurveTo(cx + r * 1.1, cy + r * 0.8, cx - r * 1.1, cy + r * 0.8, cx - r * 0.95, cy - r * 0.2);
      g.closePath();
      fillStroke(g, '#3a3531', 6);
      for (const s of [-1, 1]) {
        g.beginPath();
        g.ellipse(cx + s * r * 0.38, cy - r * 0.1, r * 0.2, r * 0.24, 0, 0, Math.PI * 2);
        fillStroke(g, '#d9c23a', 0);
        g.beginPath();
        g.ellipse(cx + s * r * 0.38, cy - r * 0.1, r * 0.06, r * 0.2, 0, 0, Math.PI * 2);
        fillStroke(g, INK, 0);
      }
      g.beginPath();
      g.moveTo(cx - r * 0.1, cy + r * 0.2);
      g.lineTo(cx + r * 0.1, cy + r * 0.2);
      g.lineTo(cx, cy + r * 0.32);
      g.closePath();
      fillStroke(g, '#e89aa0', 0);
      g.strokeStyle = PAPER;
      g.lineWidth = 2;
      for (const s of [-1, 1]) {
        for (const dy of [0.28, 0.4]) {
          g.beginPath();
          g.moveTo(cx + s * r * 0.2, cy + r * dy);
          g.lineTo(cx + s * r * 0.9, cy + r * (dy + (dy - 0.34) * 1.5));
          g.stroke();
        }
      }
    },
  },
  dice: {
    cut: true,
    draw(g, w, h) {
      const die = (x: number, y: number, s: number, a: number, pips: number): void => {
        g.save();
        g.translate(x, y);
        g.rotate(a);
        roundRect(g, -s / 2, -s / 2, s, s, s * 0.18);
        fillStroke(g, PAPER, 6);
        const at: Record<number, [number, number][]> = {
          3: [[-1, -1], [0, 0], [1, 1]],
          5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
        };
        g.fillStyle = RED;
        for (const [px, py] of at[pips]!) {
          circle(g, px * s * 0.27, py * s * 0.27, s * 0.09);
          g.fill();
        }
        g.restore();
      };
      die(w * 0.3, h * 0.52, h * 0.66, -0.25, 5);
      die(w * 0.7, h * 0.48, h * 0.66, 0.3, 3);
    },
  },
  moon: {
    cut: true,
    draw(g, w, h) {
      const r = Math.min(w, h) / 2 - 4;
      circle(g, w / 2, h / 2, r);
      fillStroke(g, '#23305c', 6);
      g.beginPath();
      g.arc(w * 0.44, h / 2, r * 0.62, 0, Math.PI * 2);
      g.fillStyle = YELLOW;
      g.fill();
      circle(g, w * 0.56, h * 0.44, r * 0.56);
      g.fillStyle = '#23305c';
      g.fill();
      for (const [x, y, s] of [[0.72, 0.28, 0.1], [0.78, 0.62, 0.07], [0.6, 0.76, 0.05]] as const) {
        starPath(g, w * x, h * y, r * s * 1.6, r * s * 0.7);
        fillStroke(g, PAPER, 0);
      }
    },
  },
  'not-sure': {
    cut: true,
    draw(g, w, h) {
      roundRect(g, 3, 3, w - 6, h - 6, 10);
      fillStroke(g, PAPER, 5);
      text(g, 'НЕ УВЕРЕН — НЕ ОБГОНЯЙ!', w / 2, h / 2 + 3, h * 0.46, w * 0.9, RED);
    },
  },
};

// ---------------------------------------------------------------------------
// The atlas
// ---------------------------------------------------------------------------

let atlas: { texture: THREE.CanvasTexture; rects: Map<StickerKind, AtlasRect> } | null = null;

/** Renders one design with its die-cut rim into its own canvas. */
function renderDesign(kind: StickerKind, w: number, h: number): HTMLCanvasElement {
  const design = DESIGNS[kind];
  const print = document.createElement('canvas');
  print.width = w;
  print.height = h;
  const pg = print.getContext('2d')!;
  const inset = design.cut ? CUT : 2;
  pg.save();
  pg.translate(inset, inset);
  design.draw(pg, w - inset * 2, h - inset * 2);
  pg.restore();
  if (!design.cut) return print;

  // The rim: the print's silhouette spread outward by CUT in every direction, white.
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const og = out.getContext('2d')!;
  const steps = 24;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    og.drawImage(print, Math.cos(a) * (CUT - 1), Math.sin(a) * (CUT - 1));
  }
  og.drawImage(print, 0, 0);
  og.globalCompositeOperation = 'source-in';
  og.fillStyle = '#fbfaf6';
  og.fillRect(0, 0, w, h);
  og.globalCompositeOperation = 'source-over';
  og.drawImage(print, 0, 0);
  return out;
}

/** The shared atlas, drawn on first use; `rects` in texture UV (v up). */
export function stickerAtlas(): { texture: THREE.CanvasTexture; rects: Map<StickerKind, AtlasRect> } {
  if (atlas) return atlas;
  const sized = STICKERS.map((def) => ({
    kind: def.kind as StickerKind,
    w: Math.round(def.widthM * PX_PER_M),
    h: Math.round(def.heightM * PX_PER_M),
  })).sort((a, b) => b.h - a.h);
  // Shelf packing, tallest first.
  const placed: { kind: StickerKind; x: number; y: number; w: number; h: number }[] = [];
  let x = GAP;
  let y = GAP;
  let shelf = 0;
  for (const s of sized) {
    if (x + s.w + GAP > ATLAS_W) {
      x = GAP;
      y += shelf + GAP;
      shelf = 0;
    }
    placed.push({ ...s, x, y });
    x += s.w + GAP;
    shelf = Math.max(shelf, s.h);
  }
  const height = 2 ** Math.ceil(Math.log2(y + shelf + GAP));
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_W;
  canvas.height = height;
  const g = canvas.getContext('2d')!;
  const rects = new Map<StickerKind, AtlasRect>();
  for (const p of placed) {
    g.drawImage(renderDesign(p.kind, p.w, p.h), p.x, p.y);
    // Canvas y runs down and the texture is flipped on upload: v = 1 at the top.
    rects.set(p.kind, [p.x / ATLAS_W, 1 - (p.y + p.h) / height, (p.x + p.w) / ATLAS_W, 1 - p.y / height]);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.premultiplyAlpha = true;
  texture.anisotropy = maxAnisotropy();
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  atlas = { texture, rects };
  return atlas;
}
