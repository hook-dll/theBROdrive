/**
 * Deterministic seeded randomness. Everything in the world derives from a single
 * integer seed, so the same seed always yields the same road, terrain and props.
 */

/** Fast 32-bit PRNG. Returns a function producing floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Mixes integers into a well-distributed 32-bit hash. Order matters.
 *
 * The final avalanche step is not optional. An FNV-style loop alone leaves the low
 * bits of the *last* input dominating the result, so `hash(seed, tag, i)` for
 * consecutive `i` returns values that ramp almost linearly instead of scattering —
 * which silently breaks every threshold test built on it (a 55%-occupancy check
 * fired 0 times out of 25 before this was fixed). The rotate inside the loop spreads
 * each freshly XORed byte upward; the Murmur3 fmix32 tail then avalanches it.
 */
export function hash(...ints: number[]): number {
  let h = 0x811c9dc5;
  for (const v of ints) {
    h ^= v | 0;
    h = Math.imul(h, 0x01000193);
    h = (h << 13) | (h >>> 19);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Hash to a float in [0, 1). */
export function hash01(...ints: number[]): number {
  return hash(...ints) / 4294967296;
}

/**
 * `hash01` for a fixed two or three integers, without the rest-parameter arrays.
 *
 * Identical output to `hash01(a, b)` / `hash01(a, b, c)` — same mixer, unrolled, and
 * checked equal over a few thousand inputs — and that equality is the point: the
 * variadic form allocates TWO arrays per call (one for `hash01`'s own rest parameter,
 * one to spread into `hash`), and every lattice corner of every noise band is one
 * call. The road integrates 100k nodes eagerly the first time a chunk asks for the
 * coarse road index, so that churn lands in one frame. Measured with
 * tools/terrain-perf.ts: chunk build mean 11.37 ms and worst 222.72 ms through the
 * variadic form, 3.66 ms and 39.03 ms through these.
 */
function fold(h: number, v: number): number {
  const m = Math.imul(h ^ (v | 0), 0x01000193);
  return (m << 13) | (m >>> 19);
}

function avalanche(h: number): number {
  let x = h ^ (h >>> 16);
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

export function hashUnit2(a: number, b: number): number {
  return avalanche(fold(fold(0x811c9dc5, a), b));
}

export function hashUnit3(a: number, b: number, c: number): number {
  return avalanche(fold(fold(fold(0x811c9dc5, a), b), c));
}

/** Quintic smoothstep, the standard Perlin fade. C2-continuous. */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Smooth 1D value noise in [-1, 1]. Used for road curvature and grade, where C1
 * continuity is what keeps turns and hills from kinking.
 */
export class Noise1D {
  private readonly seed: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
  }

  /** Value at x. Lattice spacing is 1 unit. */
  at(x: number): number {
    const i = Math.floor(x);
    // Interpolation of lattice values in [-1,1] gives smooth, zero-mean noise.
    const g0 = hashUnit2(this.seed, i) * 2 - 1;
    const g1 = hashUnit2(this.seed, i + 1) * 2 - 1;
    return lerp(g0, g1, fade(x - i));
  }

  /** Sum of octaves. `lacunarity` scales frequency, `gain` scales amplitude. */
  fbm(x: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let freq = 1;
    for (let o = 0; o < octaves; o++) {
      sum += this.at(x * freq + o * 37.1) * amp;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }
}

/** Smooth 2D value noise in [-1, 1]. Used for dune terrain and scatter density. */
export class Noise2D {
  private readonly seed: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
  }

  private grad(ix: number, iy: number): number {
    return hashUnit3(this.seed, ix, iy) * 2 - 1;
  }

  at(x: number, y: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const tx = fade(x - ix);
    const ty = fade(y - iy);
    const a = lerp(this.grad(ix, iy), this.grad(ix + 1, iy), tx);
    const b = lerp(this.grad(ix, iy + 1), this.grad(ix + 1, iy + 1), tx);
    return lerp(a, b, ty);
  }

  fbm(x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let freq = 1;
    for (let o = 0; o < octaves; o++) {
      sum += this.at(x * freq + o * 19.7, y * freq - o * 11.3) * amp;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }
}

/** Picks an element deterministically from `items` using an integer key. */
export function pick<T>(items: readonly T[], ...key: number[]): T {
  const item = items[Math.floor(hash01(...key) * items.length) % items.length];
  if (item === undefined) throw new Error('pick() from empty array');
  return item;
}
