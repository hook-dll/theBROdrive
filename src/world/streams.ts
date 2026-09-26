import { Noise2D } from '../core/rng';

/**
 * THE WATERCOURSES: where a stream runs, how big it is, and the valley it lies in.
 *
 * The middle belt is cut by small rivers the way a hand is cut by lines, and a country
 * road does not ignore them: it descends into the valley, crosses on a bridge or a
 * culvert, and climbs the far side. Measured against the road services of the zone, a
 * regional road crosses a mapped watercourse every 4.6-8 km, carries a bridge once per
 * 15-18.5 km (about 45 m long), and puts a culvert in the embankment about once a
 * kilometre (docs/research-2026-09-26-landscape.md, 1.4).
 *
 * WHY THIS IS A FIELD AND NOT A SCHEDULE. A lake can be a list of sites because a lake
 * is a point; a river is a line, and a line has to be a function of position or the road
 * and the ground can disagree about where it runs. So the network is the zero set of a
 * fractal field: one sample of two octaves at `LINE_WAVELENGTH`, and its zero contour is
 * a meandering line that wanders with a bend radius of about a kilometre — which is what
 * a small river in this country does.
 *
 * It carries THREE THINGS AT ONCE, which is why it is one field and not three:
 *
 *   the VALLEY   a broad cut 3-15 m deep and a few hundred metres across, subtracted
 *                from `Landscape.heightAt` (world/landscape.ts). Because the road takes
 *                its own elevation from that field, this is what makes a road descend
 *                into a river valley and climb out — 15-30 m over 300-700 m, which at
 *                4-6% is inside the grades such roads are built to (СП 34.13330.2021,
 *                60-100 per mille).
 *   the CHANNEL  the incised bed itself, 0.5-3 m below the valley floor and 7-30 m
 *                wide, carved by `Terrain` and NOT faded away from the road, so it
 *                passes under the road on its own bed. Where the road spans it, the
 *                ground under the asphalt is the channel (see `spanAt`); where it does
 *                not, the graded embankment fills it and the stream goes through a pipe.
 *   the WATER    the surface, a fixed rise above the bed's own floor (`waterLevelAt`).
 *
 * SIZE IS A SEPARATE, SLOW FIELD, and it is what makes one line read as a hierarchy.
 * A single noise gives every reach the same width, which is how a procedural river ends
 * up looking like a hose. `size` varies over about four kilometres, so the same line is
 * a dry balka in one district, a brook in the next and a river with a bridge on it in
 * the third — and the valley, the channel, the water and the bridge decision all read
 * the SAME number, so they cannot disagree.
 */

/**
 * Wavelength of the network, metres. Also THE SCALE OF THE FIELD: a field value times
 * this is a real distance, because near a zero contour the field is nearly linear and
 * its gradient is order one per unit. The ravine field in `terrain.ts` leans on the
 * same fact.
 */
export const LINE_WAVELENGTH = 2600;
/** Wavelength of the size field, metres: how far you drive between a brook and a river. */
const SIZE_WAVELENGTH = 4200;
/**
 * Wavelength of the pond field, metres, and how big a pond is.
 *
 * VILLAGE PONDS ARE THE WATER YOU ACTUALLY SEE in this country. A lake is one per fifty
 * square kilometres and a river is mostly hidden under its own banks; a pond is 30-60 m
 * of open water at the foot of a dam, in the dip beside a road, and there is one in most
 * villages and at many a farm. So they are a feature OF THE WATERCOURSE: a reach that has
 * been dammed, which is what almost every pond here is — a dam across a brook in a balka.
 *
 * The wavelength is the length of a ponded stretch; the field is sampled across the
 * channel rather than along it, and at this scale the difference across 30 m of bed is
 * nothing, so the pool comes out level with itself.
 */
const POND_WAVELENGTH = 340;
const POND_HALF = 0.013;
/** How much deeper the dammed reach is dug than the stream's own bed, metres. */
const POND_DEPTH_M = 1.5;
/** Freeboard: the pool stands this far below the ground that holds it. */
const POND_FREEBOARD_M = 0.18;

/**
 * Half-widths in FIELD UNITS, so metres are these times `LINE_WAVELENGTH`:
 *
 *   FLOOR_HALF    0.045 -> 117 m: the flat floor the road and a village sit on
 *   RIM_HALF      0.150 -> 390 m: where the valley meets the open country
 *   CHANNEL_HALF  0.0018..0.0063 -> 5..16 m: the bed, and the span a bridge covers
 *
 * The bed's width is also the water's width (the level fills half its depth, so about
 * two thirds of the cut is under water: a 6-23 m stream) AND the size of the tiles'
 * water mesh, which is built on the 3 m terrain lattice — every metre of bed width is
 * a column of quads, so widening this is the one change here that costs frame time.
 */
const FLOOR_HALF = 0.05;
const RIM_HALF = 0.185;
const CHANNEL_HALF_MIN = 0.0018;
const CHANNEL_HALF_SPAN = 0.0045;

/**
 * Valley depth below the open country by size, metres: a balka to a river valley.
 *
 * 2.5 m for a dry dell to 12 m for a reach big enough to be bridged. A small river in
 * the middle belt cuts 3-8 m; the 20 m valleys the literature quotes are the Vazuza and
 * its peers, which are not what a country road crosses every few kilometres.
 */
const VALLEY_MIN_M = 2.5;
const VALLEY_SPAN_M = 9;
/** How far the bed is cut below the valley floor by size, metres. */
const CHANNEL_MIN_M = 0.55;
const CHANNEL_SPAN_M = 2.6;
/**
 * How full the bed runs, as a fraction of its own depth.
 *
 * Not a fixed rise in metres, and the difference is the whole visible difference between
 * water and a wet ditch: a brook 0.55 m deep filled to 0.22 would be a damp line down
 * the middle of its channel, while a river 3.15 m deep filled to the same 0.22 gives a
 * water surface a third of a metre wide. Water fills a channel to a bank, so the level
 * is a share of the cut — two thirds of the bed's width is under water, the banks stand
 * above it, and a bridge deck over one of these has 1.5 m of air under it rather than
 * eight centimetres.
 */
const WATER_FILL = 0.5;

/**
 * Where water begins and where a crossing gets a bridge, in `size`.
 *
 * A dry reach is not a gap in anything: its valley and its bed are both there, and the
 * country is full of them (балка — a valley whose stream dried up centuries ago). Below
 * `SIZE_WATER` the bed is left dry; above it the stream runs. Above `SIZE_BRIDGE` the
 * road spans the channel on a deck; below it the embankment carries a culvert.
 *
 * Both numbers are set by measurement, not by taste: `tools/landscape-census.ts` counts
 * crossings along a real road, and the targets are one watercourse every 2.5-8 km and
 * one bridge per 15-18.5 km.
 */
const SIZE_WATER = 0.3;
const SIZE_BRIDGE = 0.84;

/**
 * The steepest a valley flank can be, as a fraction: the deepest reach climbing out of
 * its floor over the flattest half of the flank. `landscape.ts` adds it to the field's
 * own budget, because the road takes its grade from the sum and `tools/climb-sweep.ts`
 * tests the cars against that sum rather than against the bands alone.
 */
export const MAX_VALLEY_SLOPE =
  (1.5 * (VALLEY_MIN_M + VALLEY_SPAN_M)) / ((RIM_HALF - FLOOR_HALF) * LINE_WAVELENGTH);

/** The shared scratch of the last `at()` call. Callers read it immediately. */
export interface StreamSample {
  /** |field value| of the centreline: times `LINE_WAVELENGTH` it is metres to the line. */
  d: number;
  /** 0..1 how big the watercourse is here. */
  size: number;
  /** Weight of the incised bed at this point, 0..1: 0 up on the valley side. */
  bed: number;
  /** How far the bed is cut below the valley floor here, metres. */
  bedDepth: number;
  /** Metres of valley cut from the landscape here. */
  valley: number;
  /** How much of the road's corridor grading the bed takes over here, 0..1. */
  span: number;
  /** Whether this reach carries water, 0..1 across the switch. */
  water: number;
  /**
   * How much of the valley's flat floor this point is: 1 on the floor beside the stream,
   * 0 up the flank. The floor is where the hay is cut and where the plough does not go,
   * because it is under water every spring.
   */
  flood: number;
  /** How dammed this reach is, 0..1: the pond in the dip by the road. */
  pond: number;
  /** The dug hollow that holds a pond, 0..1, at this point. */
  bowl: number;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function smoothstep01(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

export class Streams {
  private readonly lineNoise: Noise2D;
  private readonly sizeNoise: Noise2D;
  private readonly pondNoise: Noise2D;
  private readonly scratch: StreamSample = {
    d: RIM_HALF,
    size: 0,
    bed: 0,
    bedDepth: 0,
    valley: 0,
    span: 0,
    water: 0,
    flood: 0,
    pond: 0,
    bowl: 0,
  };
  /**
   * One-entry memo on the last (x, z).
   *
   * Everything that shapes ground asks about the SAME point twice: `Terrain.relief`
   * carves the bed, `gradedBase` asks whether the road spans it, and the fine-detail
   * layer asks whether it has to step aside — all for one vertex, in that order. A
   * sample is three noise reads, and this makes it one. Exact float keys, because the
   * callers pass the same expression's result, not a rounded copy.
   */
  private memoX = Number.NaN;
  private memoZ = Number.NaN;
  readonly seed: number;

  constructor(seed: number) {
    const base = seed >>> 0;
    this.seed = base;
    this.lineNoise = new Noise2D(base ^ 0x7a4d3b19);
    this.sizeNoise = new Noise2D(base ^ 0x2f9e5c71);
    this.pondNoise = new Noise2D(base ^ 0x6d2b79f5);
  }

  /**
   * The watercourse at a point: the network's distance, and everything derived from it.
   *
   * Two octaves for the line, ONE for the size. The size field is a slow swell and an
   * octave of detail in it would only make neighbouring crossings differ, which is the
   * one thing it must not do: it is what the valley, the channel, the water and the
   * bridge all agree on.
   */
  at(x: number, z: number): StreamSample {
    const s = this.scratch;
    if (x === this.memoX && z === this.memoZ) return s;
    this.memoX = x;
    this.memoZ = z;
    s.d = Math.abs(this.lineNoise.fbm(x / LINE_WAVELENGTH, z / LINE_WAVELENGTH, 2, 2, 0.5));
    if (s.d >= RIM_HALF) {
      s.size = 0;
      s.bed = 0;
      s.bedDepth = 0;
      s.valley = 0;
      s.span = 0;
      s.water = 0;
      s.flood = 0;
      s.pond = 0;
      s.bowl = 0;
      return s;
    }
    // A LINEAR ramp, not a smoothstep. A smoothstep on a value-noise swell saturates:
    // two thirds of the country ends up at size 0 or size 1, crossings become either
    // brooks or rivers with nothing between, and the bridge count swings by a factor of
    // three between seeds. A ramp keeps the middle populated, which is what this field
    // exists for — a reach is usually middling, sometimes big, sometimes dry.
    s.size = Math.min(1, Math.max(0, 0.7 * this.sizeNoise.at(x / SIZE_WAVELENGTH, z / SIZE_WAVELENGTH) + 0.5));
    const half = CHANNEL_HALF_MIN + CHANNEL_HALF_SPAN * s.size;
    const t = s.d / half;
    s.bed = t >= 1 ? 0 : 1 - t * t;
    s.bedDepth = CHANNEL_MIN_M + CHANNEL_SPAN_M * s.size;
    s.valley = (VALLEY_MIN_M + VALLEY_SPAN_M * s.size) * (1 - smoothstep(FLOOR_HALF, RIM_HALF, s.d));
    s.span = smoothstep01((s.size - (SIZE_BRIDGE - 0.12)) / 0.18) * s.bed;
    s.water = smoothstep01((s.size - (SIZE_WATER - 0.08)) / 0.16);
    s.flood = 1 - smoothstep(FLOOR_HALF * 0.45, FLOOR_HALF, s.d);
    // A pond is a SMALL watercourse that somebody has dammed: a river is not ponded, and
    // a reach with no water in it has nothing to hold back.
    s.pond =
      s.water *
      (1 - smoothstep(0.55, 0.85, s.size)) *
      smoothstep01((this.pondNoise.at(x / POND_WAVELENGTH, z / POND_WAVELENGTH) - 0.34) / 0.2);
    const bowlT = s.d / POND_HALF;
    s.bowl = s.pond * (bowlT >= 1 ? 0 : 1 - bowlT * bowlT);
    return s;
  }

  /** The centreline field itself, signed. */
  private lineValue(x: number, z: number): number {
    return this.lineNoise.fbm(x / LINE_WAVELENGTH, z / LINE_WAVELENGTH, 2, 2, 0.5);
  }

  /**
   * The nearest point of the watercourse's own centreline, into `out`.
   *
   * One Newton step along the field's gradient, which is what makes the level a LEVEL:
   * the surface has to be one height across the section, and the ground it stands in is
   * not flat across the section — a road descending into a valley crosses the floor at
   * a slope, so a level read off the local ground would ride up the bank with it and
   * leave the water above the bed on one side and under it on the other.
   *
   * Called only where a bed is actually present, so the five extra noise reads are paid
   * on the few hundred metres of a tile that stand over water.
   */
  thalwegInto(x: number, z: number, out: { x: number; z: number }): void {
    const h = 3;
    const f0 = this.lineValue(x, z);
    const gx = (this.lineValue(x + h, z) - this.lineValue(x - h, z)) / (2 * h);
    const gz = (this.lineValue(x, z + h) - this.lineValue(x, z - h)) / (2 * h);
    const grad2 = gx * gx + gz * gz;
    if (grad2 < 1e-12) {
      out.x = x;
      out.z = z;
      return;
    }
    out.x = x - (f0 * gx) / grad2;
    out.z = z - (f0 * gz) / grad2;
  }

  /**
   * Height of the water surface over a bed whose centreline floor stands at `floorY`,
   * or NaN where the reach is dry or there is no bed under this point. NaN rather than
   * zero because zero is a real surface height in a world that reaches -200 m (see
   * `Terrain.waterLevelAt`).
   *
   * THE BED, and not merely the valley: the level is a level, so anything that digs
   * below it anywhere in the reach fills up. A ravine running into the valley floor, one
   * of the wash hollows, a lake basin — all of them stand metres below the floodplain,
   * and a level offered across the whole valley would flood every one of them with
   * stream water a kilometre from the stream.
   */
  waterSurface(floorY: number, sample: StreamSample): number {
    if (sample.water <= 0 || (sample.bed <= 0 && sample.bowl <= 0)) return Number.NaN;
    // Two surfaces, blended: a stream stands a share of its own depth up its bed, and a
    // dammed reach stands just below the ground that holds it — which is what makes a
    // pond a sheet of open water 30-60 m across instead of a fuller channel.
    const stream = floorY - (1 - WATER_FILL) * sample.bedDepth;
    const pond = floorY - POND_FREEBOARD_M;
    return stream + (pond - stream) * sample.pond;
  }
}
