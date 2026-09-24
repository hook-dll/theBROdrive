import { hashUnit3, Noise2D } from '../core/rng';

/**
 * LAND COVER: what grows at a point. The countryside's answer to "what colour is the
 * sand here", and the one place that answers it — the ground tiles paint from it, the
 * vista paints and raises its canopy from it, the forest plants its trees from it and
 * the wheels ask it what they are standing on. So a wood is a wood in all four at
 * once, and cannot be green on the ground and bare in the trees.
 *
 * Pure: a function of the seed, a world position and the distance to the road. No
 * three.js, so the tile and vista workers import it as they are.
 *
 * THE PIECES, largest first:
 *
 *   FARMLAND   a slow regional field that decides whether this is ploughed country
 *              or wooded country. Kolkhoz land comes in districts, not in specks.
 *   FOREST     a thresholded fractal, its threshold raised in farmland, so woods are
 *              the mass of wooded country and the copses and shelter belts of
 *              farmland. Always cleared back from the road: a verge of meadow and
 *              scrub, then the wood's edge.
 *   FIELDS     where there is no wood in farmland: rectangular plots on a grid
 *              whose orientation turns from district to district, each plot one
 *              crop, with a grass margin between plots.
 *   MEADOW     everything else: grass, drier and greener in patches.
 *
 * Colours are LINEAR rgb (vertex colours go to the shader unconverted), authored in
 * sRGB below and converted once at module load.
 */

export type Season = 'summer';

export const enum CoverKind {
  Meadow = 0,
  Field = 1,
  Forest = 2,
}

/** Crops a plot can carry, in the order `CROP_WEIGHTS` lists them. */
export const enum Crop {
  Wheat = 0,
  Rye = 1,
  Stubble = 2,
  Ploughed = 3,
  GreenCrop = 4,
  Fallow = 5,
  Hay = 6,
}

export interface CoverSample {
  kind: CoverKind;
  /** 0..1 how much of this point is wood. 1 is closed canopy. */
  forest: number;
  /** 0..1 the share of birch (and aspen) in the wood, against spruce. */
  birch: number;
  /** Crop index when `kind` is Field, else -1. */
  crop: number;
  /** 0..1 inside a field plot, falling to 0 in the grass margin between plots. */
  plot: number;
  /** 0..1 lushness of meadow grass: 0 is dry and straw-coloured, 1 deep green. */
  lush: number;
  /** Linear ground colour. */
  r: number;
  g: number;
  b: number;
}

export function newCoverSample(): CoverSample {
  return { kind: CoverKind.Meadow, forest: 0, birch: 0, crop: -1, plot: 0, lush: 0, r: 0, g: 0, b: 0 };
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

type Rgb = readonly [number, number, number];

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function hex(v: number): Rgb {
  return [
    srgbToLinear(((v >> 16) & 255) / 255),
    srgbToLinear(((v >> 8) & 255) / 255),
    srgbToLinear((v & 255) / 255),
  ];
}

interface Palette {
  readonly meadowDry: Rgb;
  readonly meadowLush: Rgb;
  readonly margin: Rgb;
  readonly forestFloor: Rgb;
  /** Canopy as seen from afar: spruce and birch ends. */
  readonly canopySpruce: Rgb;
  readonly canopyBirch: Rgb;
  readonly crops: readonly Rgb[];
}

/**
 * Late summer. Chosen by looking against the comic ground shading, which lifts
 * nothing and bands the light, so these are the colours the eye should read: a
 * meadow that is green but has started to straw, fields in their August state, and a
 * wood that is darker than anything around it.
 */
const SUMMER: Palette = {
  meadowDry: hex(0x9a9468),
  meadowLush: hex(0x6f7f4f),
  margin: hex(0x7f8758),
  forestFloor: hex(0x52573a),
  canopySpruce: hex(0x33503a),
  canopyBirch: hex(0x71883f),
  crops: [
    hex(0xd6bd72), // wheat, ripe
    hex(0xc4b486), // rye, greyer
    hex(0xd2c79c), // stubble, pale
    hex(0x76604a), // ploughed
    hex(0x86a052), // oats / potatoes, still green
    hex(0x9aa064), // fallow, going back to meadow
    hex(0xb3ae70), // hay meadow, mown
  ],
};

const PALETTES: Record<Season, Palette> = { summer: SUMMER };

/** Relative frequency of each crop, same order as `Crop`. */
const CROP_WEIGHTS = [5, 2, 3, 3, 3, 3, 2];
const CROP_TOTAL = CROP_WEIGHTS.reduce((a, b) => a + b, 0);

// ---------------------------------------------------------------------------
// Geometry of the cover
// ---------------------------------------------------------------------------

const FARMLAND_WAVELENGTH = 5200;
const FOREST_WAVELENGTH = 820;
/** Forest threshold in wooded country and in farmland. Higher = less wood. */
const FOREST_THRESHOLD_WOODED = -0.08;
const FOREST_THRESHOLD_FARMLAND = 0.3;
/** Width of the fractal band over which a wood's edge goes from none to closed. */
const FOREST_EDGE = 0.045;
const BIRCH_WAVELENGTH = 340;

/**
 * The cleared strip either side of the road, metres from the centreline. How far back
 * the wood stands changes along the road — for a kilometre it crowds the ditch, then it
 * stands off across a strip of meadow — and inside that the edge wanders in bays.
 */
const CLEAR_NEAR = 11;
const CLEAR_FAR = 62;
const CLEAR_WAVELENGTH = 700;
const CLEAR_BAYS = 12;
/** Fields do not run right up to the road: a meadow strip and the ditch come first. */
const FIELD_CLEAR = 30;

const PLOT_REGION = 2400;
const PLOT_MIN = 150;
const PLOT_MAX = 380;
const MARGIN_M = 3;

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export class LandCover {
  private readonly farmland: Noise2D;
  private readonly forestNoise: Noise2D;
  private readonly birchNoise: Noise2D;
  private readonly lushNoise: Noise2D;
  private readonly edgeNoise: Noise2D;
  private readonly seed: number;
  season: Season = 'summer';

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.farmland = new Noise2D(seed ^ 0x3c6ef372);
    this.forestNoise = new Noise2D(seed ^ 0xa54ff53a);
    this.birchNoise = new Noise2D(seed ^ 0x510e527f);
    this.lushNoise = new Noise2D(seed ^ 0x9b05688c);
    this.edgeNoise = new Noise2D(seed ^ 0x1f83d9ab);
  }

  /** 0..1: how much of a farming district this is. */
  farmlandAt(x: number, z: number): number {
    return smoothstep(-0.15, 0.25, this.farmland.fbm(x / FARMLAND_WAVELENGTH, z / FARMLAND_WAVELENGTH, 2, 2, 0.5));
  }

  /**
   * Wood density at a point, 0..1, before any road clearing. The fractal gets four
   * octaves so a wood's edge has bays and outliers down to a few tens of metres.
   */
  private rawForest(x: number, z: number, farm: number): number {
    const n = this.forestNoise.fbm(x / FOREST_WAVELENGTH, z / FOREST_WAVELENGTH, 4, 2.1, 0.5);
    const threshold = FOREST_THRESHOLD_WOODED + (FOREST_THRESHOLD_FARMLAND - FOREST_THRESHOLD_WOODED) * farm;
    return smoothstep(threshold, threshold + FOREST_EDGE, n);
  }

  /** Road clearing, 0 (cleared) .. 1 (wood allowed), from the distance to the road. */
  private clearing(x: number, z: number, roadDist: number): number {
    if (roadDist > CLEAR_FAR + CLEAR_BAYS) return 1;
    const stand = smoothstep(-0.4, 0.4, this.edgeNoise.fbm(x / CLEAR_WAVELENGTH + 7, z / CLEAR_WAVELENGTH - 3, 2, 2, 0.5));
    const edge = CLEAR_NEAR + (CLEAR_FAR - CLEAR_NEAR) * stand * stand +
      CLEAR_BAYS * (0.5 + 0.5 * this.edgeNoise.at(x / 70, z / 70));
    return smoothstep(edge - 4, edge + 2, roadDist);
  }

  /**
   * A copse (kolok, perelesok) at a point, 0..1: a clump of trees standing out in the
   * open, tens of metres across. Rare, and never where a field is ploughed.
   */
  copseAt(x: number, z: number): number {
    return smoothstep(0.52, 0.62, this.forestNoise.fbm(x / 95 - 41, z / 95 + 13, 2, 2.2, 0.5));
  }

  /** Share of broadleaf (lime, aspen, alder) among a wood's deciduous trees, 0..1. */
  broadleafAt(x: number, z: number): number {
    return smoothstep(-0.2, 0.35, this.birchNoise.fbm(x / 260 + 19, z / 260 - 5, 2, 2, 0.5));
  }

  /**
   * A shelter belt (lesopolosa) at a point, 0..1: a row of trees a few metres wide
   * along some of the field boundaries of farmland. The planted wind-breaks are the
   * single most characteristic line in Russian field country.
   */
  beltAt(x: number, z: number): number {
    const b = this.plotFrame(x, z);
    const farm = this.farmlandAt(x, z);
    if (farm < 0.3) return 0;
    let w = 0;
    // Belts run along whole grid lines: the choice is per line, not per plot.
    if (hashUnit3(this.seed ^ 0x61, b.rx * 131 + b.rz, b.iu) < 0.4) {
      w = Math.max(w, 1 - smoothstep(2, 6, Math.min(b.fu, b.su - b.fu)));
    }
    if (hashUnit3(this.seed ^ 0x62, b.rx * 131 + b.rz, b.iv) < 0.25) {
      w = Math.max(w, 1 - smoothstep(2, 6, Math.min(b.fv, b.sv - b.fv)));
    }
    return w * smoothstep(0.3, 0.5, farm);
  }

  private readonly frameScratch = { rx: 0, rz: 0, iu: 0, iv: 0, fu: 0, fv: 0, su: 1, sv: 1 };

  /** The plot grid at a point: region, cell, position inside the cell, cell size. */
  private plotFrame(x: number, z: number): { rx: number; rz: number; iu: number; iv: number; fu: number; fv: number; su: number; sv: number } {
    const f = this.frameScratch;
    f.rx = Math.floor(x / PLOT_REGION);
    f.rz = Math.floor(z / PLOT_REGION);
    const angle = hashUnit3(this.seed ^ 0x51, f.rx, f.rz) * Math.PI;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    const u = x * ca - z * sa;
    const v = x * sa + z * ca;
    f.su = PLOT_MIN + (PLOT_MAX - PLOT_MIN) * hashUnit3(this.seed ^ 0x52, f.rx, f.rz);
    f.sv = PLOT_MIN + (PLOT_MAX - PLOT_MIN) * hashUnit3(this.seed ^ 0x53, f.rx, f.rz) * 0.7;
    f.iu = Math.floor(u / f.su);
    f.iv = Math.floor(v / f.sv);
    f.fu = u - f.iu * f.su;
    f.fv = v - f.iv * f.sv;
    return f;
  }

  /** Wood density only, for callers that need nothing else (tree planting). */
  forestAt(x: number, z: number, roadDist: number): number {
    const f = this.rawForest(x, z, this.farmlandAt(x, z));
    return f === 0 ? 0 : f * this.clearing(x, z, roadDist);
  }

  /** Birch share of a wood, 0..1. */
  birchAt(x: number, z: number): number {
    return smoothstep(-0.25, 0.3, this.birchNoise.fbm(x / BIRCH_WAVELENGTH, z / BIRCH_WAVELENGTH, 3, 2, 0.5));
  }

  /**
   * Full cover sample. `roadDist` is the distance to the nearest pass of the road in
   * metres; far-off callers may pass anything large.
   */
  sample(x: number, z: number, roadDist: number, out: CoverSample): CoverSample {
    const pal = PALETTES[this.season];
    const farm = this.farmlandAt(x, z);
    const forest = this.rawForest(x, z, farm) * this.clearing(x, z, roadDist);
    const birch = this.birchAt(x, z);
    const lush = smoothstep(-0.45, 0.45, this.lushNoise.fbm(x / 70, z / 70, 3, 2.2, 0.5));
    out.forest = forest;
    out.birch = birch;
    out.lush = lush;
    out.crop = -1;
    out.plot = 0;

    // Meadow first; everything else is blended over it.
    // Mottling: a meadow is never one colour. Patches of a few tens of metres, lighter
    // and darker, so the ground reads as grass seen from a car rather than as felt.
    const mottle = 0.9 + 0.2 * this.lushNoise.at(x / 13 + 31, z / 13 - 17);
    let r = (pal.meadowDry[0] + (pal.meadowLush[0] - pal.meadowDry[0]) * lush) * mottle;
    let g = (pal.meadowDry[1] + (pal.meadowLush[1] - pal.meadowDry[1]) * lush) * mottle;
    let b = (pal.meadowDry[2] + (pal.meadowLush[2] - pal.meadowDry[2]) * lush) * mottle;
    out.kind = CoverKind.Meadow;

    if (farm > 0.05 && roadDist > FIELD_CLEAR && forest < 0.5) {
      const plot = this.plotAt(x, z);
      if (plot.crop >= 0) {
        const c = pal.crops[plot.crop]!;
        // A shelter belt takes its strip out of the crop, so the plough stops short of it.
        const belt = this.beltAt(x, z);
        const inside = plot.inside * (1 - belt) * farm * smoothstep(FIELD_CLEAR, FIELD_CLEAR + 8, roadDist);
        // Margin grass between plots, then the crop.
        r += (pal.margin[0] - r) * farm;
        g += (pal.margin[1] - g) * farm;
        b += (pal.margin[2] - b) * farm;
        r += (c[0] - r) * inside;
        g += (c[1] - g) * inside;
        b += (c[2] - b) * inside;
        if (inside > 0.5) {
          out.kind = CoverKind.Field;
          out.crop = plot.crop;
        }
        out.plot = inside;
      }
    }

    if (forest > 0) {
      r += (pal.forestFloor[0] - r) * forest;
      g += (pal.forestFloor[1] - g) * forest;
      b += (pal.forestFloor[2] - b) * forest;
      if (forest > 0.5) out.kind = CoverKind.Forest;
    }
    out.r = r;
    out.g = g;
    out.b = b;
    return out;
  }

  /**
   * Canopy colour of a wood seen from far off, linear rgb, into `out` (length 3).
   * Varies with the birch share and a little per-crown noise.
   */
  canopyColour(x: number, z: number, birch: number, out: Float32Array | number[], at = 0): void {
    const pal = PALETTES[this.season];
    const v = 0.88 + 0.24 * hashUnit3(this.seed ^ 0x77, Math.floor(x / 9), Math.floor(z / 9));
    out[at] = (pal.canopySpruce[0] + (pal.canopyBirch[0] - pal.canopySpruce[0]) * birch) * v;
    out[at + 1] = (pal.canopySpruce[1] + (pal.canopyBirch[1] - pal.canopySpruce[1]) * birch) * v;
    out[at + 2] = (pal.canopySpruce[2] + (pal.canopyBirch[2] - pal.canopySpruce[2]) * birch) * v;
  }

  private readonly plotScratch = { crop: -1, inside: 0 };

  /**
   * The plot at a point: which crop, and how far inside the plot (0 in the margin).
   * Plots are cells of a grid rotated per region; the cell size is hashed per column
   * and row so fields are not all one size.
   */
  private plotAt(x: number, z: number): { crop: number; inside: number } {
    const out = this.plotScratch;
    const { rx, rz, iu, iv, fu, fv, su, sv } = this.plotFrame(x, z);
    const edge = Math.min(fu, su - fu, fv, sv - fv);
    // Some cells are not fields at all: meadow, or left for the wood to take.
    const pickT = hashUnit3(this.seed ^ 0x54, iu * 7919 + rx, iv * 104729 + rz);
    if (pickT < 0.18) {
      out.crop = -1;
      out.inside = 0;
      return out;
    }
    let w = ((pickT - 0.18) / 0.82) * CROP_TOTAL;
    let crop = 0;
    while (crop < CROP_WEIGHTS.length - 1 && w >= CROP_WEIGHTS[crop]!) {
      w -= CROP_WEIGHTS[crop]!;
      crop++;
    }
    out.crop = crop;
    out.inside = smoothstep(MARGIN_M * 0.5, MARGIN_M * 1.5, edge);
    return out;
  }
}
