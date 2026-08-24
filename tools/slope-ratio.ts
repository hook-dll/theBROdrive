/**
 * tools/slope-ratio.ts
 *
 * Why `src/world/landscape.ts` builds its own value noise instead of using `Noise2D`.
 *
 * The landscape must be gentle at its WORST and interesting on AVERAGE, so the
 * quantity that decides whether hills are possible at all is the ratio between a
 * band's typical slope and its hard maximum. This measures that ratio for the
 * candidate interpolants, over 400k samples on an irrational walk so nothing lands on
 * a lattice line. `cubic + bimodal` wins by a factor of two over `Noise2D`'s
 * `quintic + uniform`, which is the difference between a 1.4% road and a 2.8% one
 * under the same no-cliff bound.
 *
 *   npx tsx tools/slope-ratio.ts
 *
 * Nothing here is part of the game bundle.
 */

import { hash01 } from '../src/core/rng';

type Fade = { name: string; peak: number; f: (t: number) => number };

const quintic: Fade = {
  name: 'quintic',
  peak: 1.875,
  f: (t) => t * t * t * (t * (t * 6 - 15) + 10),
};

const cubic: Fade = { name: 'cubic', peak: 1.5, f: (t) => t * t * (3 - 2 * t) };

function trapezoid(r: number): Fade {
  const p = 1 / (1 - r);
  const head = (u: number) => u * u * u - (u * u * u * u) / 2;
  return {
    name: `trapezoid r=${r}`,
    peak: p,
    f: (t) => {
      if (t < r) return p * r * head(t / r);
      if (t > 1 - r) return 1 - p * r * head((1 - t) / r);
      return p * r * 0.5 + p * (t - r);
    },
  };
}

type Lattice = { name: string; v: (a: number, b: number) => number };
const uniform: Lattice = { name: 'uniform', v: (a, b) => hash01(0x1234, a, b) * 2 - 1 };
const bimodal: Lattice = { name: 'bimodal', v: (a, b) => (hash01(0x1234, a, b) < 0.5 ? -1 : 1) };

function field(fade: Fade, lat: Lattice, x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const tx = fade.f(x - ix);
  const ty = fade.f(y - iy);
  const a = lat.v(ix, iy) + (lat.v(ix + 1, iy) - lat.v(ix, iy)) * tx;
  const b = lat.v(ix, iy + 1) + (lat.v(ix + 1, iy + 1) - lat.v(ix, iy + 1)) * tx;
  return a + (b - a) * ty;
}

const EPS = 1e-3;
for (const fade of [quintic, cubic, trapezoid(0.2), trapezoid(0.3), trapezoid(0.4)]) {
  for (const lat of [uniform, bimodal]) {
    // Slope of `field` in lattice units, sampled on an irrational walk so samples do
    // not land on lattice lines.
    let sum = 0;
    let max = 0;
    let count = 0;
    for (let i = 1; i <= 400_000; i++) {
      const x = i * 0.017_321;
      const y = i * 0.011_803 + Math.floor(i / 977) * 0.7;
      const dx = (field(fade, lat, x + EPS, y) - field(fade, lat, x - EPS, y)) / (2 * EPS);
      const dy = (field(fade, lat, x, y + EPS) - field(fade, lat, x, y - EPS)) / (2 * EPS);
      const g = Math.hypot(dx, dy);
      sum += g;
      count++;
      if (g > max) max = g;
    }
    // Hard bound: two lattice values 2 apart, both axes at the fade's peak slope.
    const bound = Math.hypot(2 * fade.peak, 2 * fade.peak);
    const mean = sum / count;
    console.log(
      `${fade.name.padEnd(16)} ${lat.name.padEnd(8)} mean ${mean.toFixed(3)}  ` +
        `max ${max.toFixed(3)}  bound ${bound.toFixed(3)}  mean/bound ${(mean / bound).toFixed(3)}  ` +
        `mean/max ${(mean / max).toFixed(3)}`,
    );
  }
}
