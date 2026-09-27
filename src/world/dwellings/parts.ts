import { mulberry32 } from '../../core/rng';
import { DwellingBuilder, Facade, shade, type P2 } from './builder';

/** Deterministic per-house jitter, so a rebuilt house is the same house. */
export function jitter(seed: number): (lo: number, hi: number) => number {
  const next = mulberry32(seed);
  return (lo, hi) => lo + next() * (hi - lo);
}

function logSection(centre: number, y: number, r: number): P2[] {
  const points: P2[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    points.push([centre + Math.cos(a) * r, y + Math.sin(a) * r]);
  }
  return points;
}

/**
 * Horizontal log walls. The X walls and the Z walls alternate by half a log, as a
 * notched corner does, and every log runs `projection` past the corner. A solid core
 * sits inside so the gaps between round logs show `core` rather than daylight: dark
 * for an izba, white chinking for a frontier cabin.
 */
export function logWalls(
  b: DwellingBuilder,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  y0: number,
  y1: number,
  r: number,
  colours: readonly number[],
  projection: number,
  core: number,
  gap = 0,
): void {
  b.box(x0 + r * 0.2, y0, z0 + r * 0.2, x1 - r * 0.2, y1, z1 - r * 0.2, core);
  const pitch = r * 2 + gap;
  let course = 0;
  for (let y = y0 + r; y + r <= y1 + 1e-6; y += pitch, course++) {
    const colour = colours[course % colours.length]!;
    b.extrude(logSection(z0, y, r), 'x', x0 - projection, x1 + projection, colour, { smooth: true });
    b.extrude(logSection(z1, y, r), 'x', x0 - projection, x1 + projection, colour, { smooth: true });
    const yz = y + pitch / 2;
    if (yz + r > y1 + 1e-6) continue;
    const other = colours[(course + 1) % colours.length]!;
    b.extrude(logSection(x0, yz, r), 'z', z0 - projection, z1 + projection, other, { smooth: true });
    b.extrude(logSection(x1, yz, r), 'z', z0 - projection, z1 + projection, other, { smooth: true });
  }
}

/**
 * Lap siding: a darker shadow line under every board. Thinner than the glass sits
 * proud of the wall, so windows and doors cover it without cutting holes.
 */
export function siding(f: Facade, v0: number, v1: number, spacing: number, hex: number, u0 = -f.width / 2, u1 = f.width / 2): void {
  const line = shade(hex, 0.8);
  for (let v = v0 + spacing; v < v1 - 0.02; v += spacing) f.box(u0, u1, v - 0.035, v, 0, 0.012, line);
}

/** Vertical board-and-batten lines. */
export function battens(f: Facade, v0: number, v1: number, spacing: number, hex: number, u0 = -f.width / 2, u1 = f.width / 2): void {
  for (let u = u0 + spacing / 2; u < u1; u += spacing) f.box(u - 0.035, u + 0.035, v0, v1, 0, 0.014, hex);
}

/** Coursed stone veneer: each block its own tone, which is what makes a wall read as stone. */
export function stonework(
  f: Facade,
  v0: number,
  v1: number,
  course: number,
  colours: readonly number[],
  seed: number,
  u0 = -f.width / 2,
  u1 = f.width / 2,
): void {
  const rand = jitter(seed);
  let row = 0;
  for (let v = v0; v < v1 - 0.01; v += course, row++) {
    const top = Math.min(v1, v + course);
    let u = u0 - (row % 2) * course * 0.7;
    while (u < u1) {
      const length = course * rand(1.1, 2.3);
      const a = Math.max(u0, u);
      const c = Math.min(u1, u + length);
      if (c - a > 0.05) {
        const colour = colours[Math.floor(rand(0, colours.length))]!;
        // Never proud of the glass (0.02): windows sit in the veneer, not behind it.
        f.box(a + 0.02, c - 0.02, v + 0.02, top - 0.02, 0, 0.007 + rand(0, 0.009), colour);
      }
      u += length;
    }
  }
}

/** Russian carved window: white surround with a pediment and drops, painted shutters. */
export function carvedWindow(f: Facade, u: number, v: number, w: number, h: number, trim: number, shutter: number): void {
  f.window(u, v, w, h, { frame: trim, surround: trim, surroundWidth: 0.1, shutters: shutter, cross: true, sill: trim });
  const top = v + h + 0.2;
  f.shape([[u - w / 2 - 0.34, top], [u + w / 2 + 0.34, top], [u, top + 0.42]], trim, 0.04);
  f.shape([[u - w / 2 - 0.2, top + 0.06], [u + w / 2 + 0.2, top + 0.06], [u, top + 0.3]], shade(shutter, 1.05), 0.05);
  for (const side of [-1, 1]) {
    const x = u + side * (w / 2 + 0.18);
    f.shape([[x - 0.07, v - 0.2], [x + 0.07, v - 0.2], [x, v - 0.45]], trim, 0.04);
  }
}

/** A porch: deck on the ground, posts, and a flat or gently sloped roof. */
export function porch(
  b: DwellingBuilder,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  deck: number,
  height: number,
  colours: { readonly deck: number; readonly post: number; readonly roof: number },
  posts = 4,
  fall = 0.35,
): void {
  b.box(x0, 0, z0, x1, deck, z1, colours.deck);
  const outer = Math.min(z0, z1);
  for (let i = 0; i < posts; i++) {
    const x = x0 + 0.15 + ((x1 - x0 - 0.3) * i) / Math.max(1, posts - 1);
    b.box(x - 0.08, deck, outer + 0.08, x + 0.08, deck + height, outer + 0.24, colours.post);
  }
  const inner = Math.max(z0, z1);
  b.shed(x0, x1, outer, inner, deck + height - fall + 0.02, deck + height + 0.2, colours.roof, 0.2, 0.12);
}

/** Steps climbing from the ground to `height`, toward -Z from `z`. */
export function steps(b: DwellingBuilder, x0: number, x1: number, z: number, height: number, count: number, hex: number, tread = 0.3): void {
  for (let i = 0; i < count; i++) {
    const top = (height * (i + 1)) / count;
    b.box(x0, 0, z - tread * (count - i), x1, top, z - tread * (count - i - 1), i % 2 === 0 ? hex : shade(hex, 0.93));
  }
}

/** A wheel whose axle runs along Z. */
export function wheel(b: DwellingBuilder, x: number, y: number, z: number, r: number, width: number, tyre: number, hub: number): void {
  b.at(x, y, z, 0, () => {
    b.lathe(0, 0, [[r, -width / 2], [r, width / 2]], 14, tyre);
    b.lathe(0, 0, [[r * 0.5, -width / 2 - 0.01], [r * 0.5, width / 2 + 0.01]], 10, hub);
  }, Math.PI / 2);
}

/**
 * A wall that is all glass: one pane over the whole facade, then the glazing grid on
 * top of it. `skip` leaves a gap in the grid where a painted door stands in front.
 */
export function glazedWall(
  f: Facade,
  spacing: number,
  frame: number,
  transom = 0.62,
  skip: readonly [number, number] | null = null,
  bar = 0.06,
): void {
  const w = f.width;
  const h = f.height;
  f.glass([[-w / 2, 0], [w / 2, 0], [w / 2, h], [-w / 2, h]], 0.02);
  const outside = (u0: number, u1: number): boolean => skip === null || u1 < skip[0] || u0 > skip[1];
  const count = Math.max(1, Math.round(w / spacing));
  for (let i = 0; i <= count; i++) {
    const u = -w / 2 + (w * i) / count;
    const u0 = Math.max(-w / 2, u - bar / 2);
    const u1 = Math.min(w / 2, u + bar / 2);
    if (outside(u0, u1)) f.box(u0, u1, 0, h, 0, 0.05, frame);
  }
  const rails = [0, h * transom, h - bar];
  for (const v of rails) {
    if (skip === null) {
      f.box(-w / 2, w / 2, v, v + bar, 0, 0.05, frame);
    } else {
      if (skip[0] > -w / 2) f.box(-w / 2, skip[0], v, v + bar, 0, 0.05, frame);
      if (skip[1] < w / 2) f.box(skip[1], w / 2, v, v + bar, 0, 0.05, frame);
    }
  }
}

/** A painted folk flower: four petals round a centre. */
export function flower(f: Facade, u: number, v: number, size: number, petal: number, centre: number, depth = 0.03): void {
  const s = size / 2;
  for (const [du, dv] of [[0, 1], [1, 0], [0, -1], [-1, 0]] as const) {
    const cu = u + du * s * 0.9;
    const cv = v + dv * s * 0.9;
    f.shape([[cu - s * 0.45, cv], [cu, cv - s * 0.45], [cu + s * 0.45, cv], [cu, cv + s * 0.45]], petal, depth);
  }
  f.shape([[u - s * 0.3, v], [u, v - s * 0.3], [u + s * 0.3, v], [u, v + s * 0.3]], centre, depth + 0.01);
}

/** Round glass port with a ring frame. */
export function porthole(f: Facade, u: number, v: number, r: number, frame: number, segments = 14): void {
  const circle = (radius: number): P2[] => {
    const points: P2[] = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      points.push([u + Math.cos(a) * radius, v + Math.sin(a) * radius]);
    }
    return points;
  };
  f.glass(circle(r), 0.03);
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    f.shape(
      [
        [u + Math.cos(a0) * r, v + Math.sin(a0) * r],
        [u + Math.cos(a0) * (r + 0.09), v + Math.sin(a0) * (r + 0.09)],
        [u + Math.cos(a1) * (r + 0.09), v + Math.sin(a1) * (r + 0.09)],
        [u + Math.cos(a1) * r, v + Math.sin(a1) * r],
      ],
      frame,
      0.06,
    );
  }
}
