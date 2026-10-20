import * as THREE from 'three';
import { maxAnisotropy } from '../render/texturequality';
import type { Desert, DesertEmblem } from './gradient';

/**
 * SIGN PLATES: a signpost board painted like a licence plate of its region.
 *
 * A US plate shows something of its state — a mesa, a cactus, a sunrise — under the
 * state's name; a stop's board here does the same for its desert (world/gradient.ts
 * `desertAt`): a dark header strip spelling the region's name, a pale field with the
 * region's emblem painted in it, a ground band along the bottom, a painted frame.
 * Every colour is the region's own sand hue at a few fixed lightnesses, so a run of
 * stops in one desert wears one plate and the next desert's are plainly another.
 *
 * Flat fills only, five tones a plate: no gradient, no shading, no texture. The text
 * is the darkest tone with a halo of the field's, so it reads where it crosses the
 * emblem; the emblem stays in mid tones behind it.
 *
 * `RING_GLYPH` in a line is painted as a ring, not set as a letter: the turning circle
 * at the road's start seen from above, which is what lies behind the first stop.
 */

/** Stands in a line for the road's-start ring. */
export const RING_GLYPH = '◯';

/** Canvas size, px: twice as wide as high, the board's own proportions. */
const PLATE_W = 1024;
const PLATE_H = 512;
/** Painted frame round the plate and its corners' radius, px. */
const FRAME_PX = 16;
const CORNER_PX = 44;
/** The header strip's bottom edge, px from the top. */
const HEADER_BOTTOM = 84;
/** Where the field meets the ground band, px from the top. */
const HORIZON = 300;
/** Text sizes, px: the region's name in the header, the stop's name, the two directions. */
const HEADER_TEXT_PX = 46;
const NAME_TEXT_PX = 124;
const ROW_TEXT_PX = 80;
/** Vertical centres of the stop's name and of the two direction rows, px. */
const NAME_Y = 192;
const ROW_Y = [362, 448] as const;
/** Inset of the text from the frame, px. */
const TEXT_INSET_PX = 46;
/** Field-coloured halo round every letter, as a fraction of its size. */
const HALO = 0.2;
/**
 * The ring, as fractions of the digits' height (diameter) and the font size (stroke):
 * larger than a letter and twice as heavy as its strokes, a doughnut — paving round the
 * island — so it never reads as an O.
 */
const RING_DIAMETER = 1.18;
const RING_STROKE = 0.25;
const FONT = 'sans-serif';

/** One region's plate tones, CSS colours, and the frame's as a hex for the backing box. */
export interface PlateStyle {
  readonly field: string;
  readonly band: string;
  readonly motif: string;
  readonly header: string;
  readonly ink: string;
  /** The header's tone as 0xRRGGBB: the backing box behind the board wears it. */
  readonly frameHex: number;
}

const styles = new Map<Desert, PlateStyle>();
const hsl = { h: 0, s: 0, l: 0 };
const scratch = new THREE.Color();

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function css(h: number, s: number, l: number): string {
  return `hsl(${(h * 360).toFixed(1)}, ${(s * 100).toFixed(1)}%, ${(l * 100).toFixed(1)}%)`;
}

/** HSL lightness of each tone, on a day plate and on a night plate. */
const DAY_TONES = { field: 0.9, band: 0.75, motif: 0.54, header: 0.28, ink: 0.12 } as const;
const NIGHT_TONES = { field: 0.2, band: 0.3, motif: 0.47, header: 0.85, ink: 0.94 } as const;
/** A sand darker than this HSL lightness gets the night plate: the cinders, the lava, the tuff. */
const NIGHT_PLATE_BELOW_L = 0.42;

/**
 * The region's tones: its sand's hue at fixed lightnesses, so every plate has the same
 * contrast whatever the desert. A dark desert's plate is the light one turned over —
 * pale letters on a dark field under a pale header — so the dark regions read as dark
 * from the road too. The saturation follows the sand's, clamped so the grey deserts
 * still read as a colour and the hot ones do not shout. The motif takes the accent's
 * hue, the region's second sand.
 */
export function plateStyle(desert: Desert): PlateStyle {
  const cached = styles.get(desert);
  if (cached) return cached;
  scratch.setHex(desert.sand, THREE.SRGBColorSpace).getHSL(hsl, THREE.SRGBColorSpace);
  const { h, s, l } = hsl;
  scratch.setHex(desert.accent, THREE.SRGBColorSpace).getHSL(hsl, THREE.SRGBColorSpace);
  const motifH = hsl.h;
  const tones = l < NIGHT_PLATE_BELOW_L ? NIGHT_TONES : DAY_TONES;
  const headerS = clamp(s, 0.25, 0.65);
  const style: PlateStyle = {
    field: css(h, clamp(s * 0.7, 0.18, 0.55), tones.field),
    band: css(h, clamp(s * 0.8, 0.2, 0.6), tones.band),
    motif: css(motifH, clamp(s * 0.9, 0.22, 0.6), tones.motif),
    header: css(h, headerS, tones.header),
    ink: css(h, clamp(s * 0.6, 0.16, 0.45), tones.ink),
    frameHex: scratch.setHSL(h, headerS, tones.header, THREE.SRGBColorSpace).getHex(THREE.SRGBColorSpace),
  };
  styles.set(desert, style);
  return style;
}

/**
 * A board's material, the market sign's shape (a map, no shadows; `marketProgramAnchor`
 * links its program at boot), painted fresh and NOT cached: a stop's text is its own.
 * Owned and disposed — material and map — by whoever built it. `lines` are the stop's
 * name and the left and right direction rows.
 */
export function paintPlate(desert: Desert, lines: readonly [string, string, string]): THREE.MeshStandardMaterial {
  // The headless tools (tools/poi-*.ts) build stops with no DOM: their boards are blank.
  if (typeof document === 'undefined') {
    const blank = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    blank.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map: blank, roughness: 0.9, metalness: 0 });
  }
  const canvas = document.createElement('canvas');
  canvas.width = PLATE_W;
  canvas.height = PLATE_H;
  const g = canvas.getContext('2d');
  if (g) paint(g, plateStyle(desert), desert, lines);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy();
  return new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9, metalness: 0 });
}

function paint(g: CanvasRenderingContext2D, style: PlateStyle, desert: Desert, lines: readonly [string, string, string]): void {
  const W = PLATE_W;
  const H = PLATE_H;
  g.fillStyle = style.header;
  g.fillRect(0, 0, W, H);

  g.save();
  g.beginPath();
  g.roundRect(FRAME_PX, FRAME_PX, W - FRAME_PX * 2, H - FRAME_PX * 2, CORNER_PX);
  g.clip();
  g.fillStyle = style.field;
  g.fillRect(0, 0, W, H);
  const emblem = EMBLEMS[desert.emblem];
  emblem.sky?.(g, style);
  g.fillStyle = style.band;
  g.fillRect(0, HORIZON, W, H - HORIZON);
  emblem.ground?.(g, style);
  g.fillStyle = style.header;
  g.fillRect(0, 0, W, HEADER_BOTTOM);
  g.restore();

  // Two bolt heads in the header strip, as on a plate.
  g.fillStyle = style.field;
  for (const x of [FRAME_PX + 40, W - FRAME_PX - 40]) {
    g.beginPath();
    g.arc(x, (FRAME_PX + HEADER_BOTTOM) / 2, 9, 0, Math.PI * 2);
    g.fill();
  }
  g.font = `bold ${HEADER_TEXT_PX}px ${FONT}`;
  g.letterSpacing = `${Math.round(HEADER_TEXT_PX * 0.18)}px`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = style.field;
  g.fillText(desert.name.toUpperCase(), W / 2, (FRAME_PX + HEADER_BOTTOM) / 2 + 2, W - 260);
  g.letterSpacing = '0px';

  const left = FRAME_PX + TEXT_INSET_PX;
  const right = W - FRAME_PX - TEXT_INSET_PX;
  paintRow(g, style, lines[0], NAME_TEXT_PX, NAME_Y, 'center', left, right);
  paintRow(g, style, lines[1], ROW_TEXT_PX, ROW_Y[0], 'left', left, right);
  paintRow(g, style, lines[2], ROW_TEXT_PX, ROW_Y[1], 'right', left, right);
}

/**
 * One line of text centred on `y`, shrunk to fit between `left` and `right`, every
 * `RING_GLYPH` in it painted as a ring (see `RING_DIAMETER`). A halo pass in the field's
 * tone, then the ink.
 */
function paintRow(
  g: CanvasRenderingContext2D,
  style: PlateStyle,
  text: string,
  size: number,
  y: number,
  align: 'left' | 'center' | 'right',
  left: number,
  right: number,
): void {
  const parts = text.split(RING_GLYPH);
  const rings = parts.length - 1;
  // Text and ring both scale with the font, so one measure tells the size that fits.
  const measure = (px: number) => {
    g.font = `bold ${px}px ${FONT}`;
    const cap = g.measureText('0').actualBoundingBoxAscent;
    const widths = parts.map((part) => g.measureText(part).width);
    const ringBox = cap * RING_DIAMETER + px * RING_STROKE;
    return { cap, widths, ringBox, width: widths.reduce((sum, w) => sum + w, 0) + rings * ringBox };
  };
  let m = measure(size);
  if (m.width > right - left) {
    size = Math.floor((size * (right - left)) / m.width);
    m = measure(size);
  }
  const { cap, widths, ringBox } = m;
  const x0 = align === 'left' ? left : align === 'right' ? right - m.width : (left + right - m.width) / 2;
  const baseline = y + cap / 2;
  const ringR = (cap * RING_DIAMETER) / 2 - (size * RING_STROKE) / 2;

  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.lineJoin = 'round';
  for (const pass of ['halo', 'ink'] as const) {
    const halo = pass === 'halo';
    g.strokeStyle = halo ? style.field : style.ink;
    g.fillStyle = style.ink;
    let x = x0;
    for (let i = 0; i < parts.length; i++) {
      if (halo) {
        g.lineWidth = size * HALO;
        g.strokeText(parts[i]!, x, baseline);
      } else {
        g.fillText(parts[i]!, x, baseline);
      }
      x += widths[i]!;
      if (i < rings) {
        g.lineWidth = size * RING_STROKE + (halo ? size * HALO : 0);
        g.beginPath();
        g.arc(x + ringBox / 2, baseline - cap / 2, ringR, 0, Math.PI * 2);
        g.stroke();
        x += ringBox;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Emblems
// ---------------------------------------------------------------------------

/**
 * An emblem paints in two passes: `sky` before the ground band (so a mesa's foot or the
 * rising sun is cut clean by the horizon), `ground` after it (what stands in front).
 */
interface Emblem {
  readonly sky?: (g: CanvasRenderingContext2D, style: PlateStyle) => void;
  readonly ground?: (g: CanvasRenderingContext2D, style: PlateStyle) => void;
}

function polygon(g: CanvasRenderingContext2D, fill: string, points: readonly number[]): void {
  g.fillStyle = fill;
  g.beginPath();
  g.moveTo(points[0]!, points[1]!);
  for (let i = 2; i < points.length; i += 2) g.lineTo(points[i]!, points[i + 1]!);
  g.closePath();
  g.fill();
}

/** A saguaro standing on the ground at `x`, `h` px tall. */
function saguaro(g: CanvasRenderingContext2D, x: number, base: number, h: number): void {
  const trunk = h * 0.2;
  const arm = trunk * 0.7;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.lineWidth = trunk;
  g.beginPath();
  g.moveTo(x, base);
  g.lineTo(x, base - h + trunk / 2);
  g.stroke();
  g.lineWidth = arm;
  g.beginPath();
  g.moveTo(x, base - h * 0.42);
  g.lineTo(x - h * 0.24, base - h * 0.42);
  g.lineTo(x - h * 0.24, base - h * 0.72);
  g.moveTo(x, base - h * 0.55);
  g.lineTo(x + h * 0.22, base - h * 0.55);
  g.lineTo(x + h * 0.22, base - h * 0.8);
  g.stroke();
}

/** A palm leaning by `lean` px, trunk foot at (x, base), `h` px tall. */
function palm(g: CanvasRenderingContext2D, x: number, base: number, h: number, lean: number): void {
  const topX = x + lean;
  const topY = base - h;
  g.lineCap = 'round';
  g.lineWidth = h * 0.08;
  g.beginPath();
  g.moveTo(x, base);
  g.quadraticCurveTo(x + lean * 0.1, base - h * 0.6, topX, topY);
  g.stroke();
  g.lineWidth = h * 0.07;
  for (const [dx, dy] of [[-1, 0.15], [-0.75, -0.35], [-0.2, -0.55], [0.35, -0.5], [0.85, -0.25], [1, 0.2]] as const) {
    const reach = h * 0.42;
    g.beginPath();
    g.moveTo(topX, topY);
    g.quadraticCurveTo(topX + dx * reach * 0.6, topY + (dy - 0.35) * reach * 0.8, topX + dx * reach, topY + (dy + 0.25) * reach);
    g.stroke();
  }
}

const EMBLEMS: Readonly<Record<DesertEmblem, Emblem>> = {
  mesa: {
    sky: (g, s) => {
      polygon(g, s.motif, [30, HORIZON, 100, 120, 420, 120, 480, HORIZON]);
      polygon(g, s.motif, [660, HORIZON, 715, 176, 850, 176, 895, HORIZON]);
      polygon(g, s.band, [915, HORIZON, 940, 222, 1000, 222, 1020, HORIZON]);
    },
  },
  dunes: {
    ground: (g, s) => {
      for (const [fill, y, amp, period, phase] of [
        [s.motif, HORIZON - 34, 30, 560, 0.4],
        [s.band, HORIZON + 6, 18, 400, 2.2],
      ] as const) {
        g.fillStyle = fill;
        g.beginPath();
        g.moveTo(0, PLATE_H);
        for (let x = 0; x <= PLATE_W; x += 16) {
          // A dune's crest is sharp and its back is long: |sin| folded upside down.
          g.lineTo(x, y + amp * (1 - 2 * Math.abs(Math.sin((x / period) * Math.PI + phase))));
        }
        g.lineTo(PLATE_W, PLATE_H);
        g.closePath();
        g.fill();
      }
    },
  },
  sun: {
    sky: (g, s) => {
      const cx = PLATE_W / 2;
      g.fillStyle = s.motif;
      g.beginPath();
      g.arc(cx, HORIZON, 175, Math.PI, 0);
      g.fill();
      for (let i = 0; i < 9; i++) {
        const a = Math.PI + ((i + 0.5) / 9) * Math.PI;
        const spread = 0.075;
        polygon(g, s.motif, [
          cx + Math.cos(a - spread) * 200, HORIZON + Math.sin(a - spread) * 200,
          cx + Math.cos(a) * 420, HORIZON + Math.sin(a) * 420,
          cx + Math.cos(a + spread) * 200, HORIZON + Math.sin(a + spread) * 200,
        ]);
      }
    },
  },
  powerline: {
    ground: (g, s) => {
      g.strokeStyle = s.motif;
      g.fillStyle = s.motif;
      const poles = [70, 360, 650, 940];
      const top = HORIZON - 190;
      for (const x of poles) {
        g.fillRect(x - 7, top, 14, HORIZON + 40 - top);
        g.fillRect(x - 46, top + 12, 92, 11);
      }
      g.lineWidth = 4;
      for (let i = 0; i + 1 < poles.length; i++) {
        for (const off of [-40, 40]) {
          const a = poles[i]! + off;
          const b = poles[i + 1]! + off;
          g.beginPath();
          g.moveTo(a, top + 14);
          g.quadraticCurveTo((a + b) / 2, top + 80, b, top + 14);
          g.stroke();
        }
      }
    },
  },
  cactus: {
    ground: (g, s) => {
      g.strokeStyle = s.motif;
      saguaro(g, 100, HORIZON + 40, 270);
      saguaro(g, 915, HORIZON + 36, 230);
      saguaro(g, 800, HORIZON + 22, 110);
    },
  },
  palm: {
    ground: (g, s) => {
      g.strokeStyle = s.motif;
      palm(g, 90, HORIZON + 40, 260, 44);
      palm(g, 945, HORIZON + 36, 235, -40);
      palm(g, 835, HORIZON + 22, 140, -20);
    },
  },
  moon: {
    sky: (g, s) => {
      g.fillStyle = s.motif;
      g.beginPath();
      g.arc(850, 175, 92, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = s.field;
      g.beginPath();
      g.arc(892, 146, 80, 0, Math.PI * 2);
      g.fill();
      // Four-pointed stars.
      for (const [x, y, r] of [[80, 130, 26], [200, 262, 16], [320, 112, 14], [650, 116, 18], [690, 262, 13], [975, 250, 15]] as const) {
        const k = r * 0.28;
        polygon(g, s.motif, [x, y - r, x + k, y - k, x + r, y, x + k, y + k, x, y + r, x - k, y + k, x - r, y, x - k, y - k]);
      }
    },
  },
  volcano: {
    sky: (g, s) => {
      g.fillStyle = s.band;
      for (const [x, y, r] of [[742, 128, 26], [778, 100, 34], [828, 92, 30]] as const) {
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      }
      polygon(g, s.motif, [520, HORIZON, 700, 150, 735, 166, 768, 150, 960, HORIZON]);
      polygon(g, s.motif, [20, HORIZON, 150, 200, 280, HORIZON]);
    },
  },
};
