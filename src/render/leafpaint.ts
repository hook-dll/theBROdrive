import * as THREE from 'three';

/**
 * THE LEAF CARDS' PAINT: clusters of leaves drawn in code, for the crowns of every tree
 * but the spruce (world/props/trees.ts builds a crown from cards textured with these).
 *
 * A crown of solid lumps read as a toy; a crown of leaf clusters reads as foliage at
 * any distance, the way slowroads' trees and every foliage pipeline with alpha cards
 * do it: the cluster's ragged outline, the sky through its gaps and the light and dark
 * leaves inside it carry what no affordable number of triangles can.
 *
 * Painted as SHADE, not colour: grey in rgb (the vertex colour sets the green, so a
 * season is still a change of palette), coverage in alpha. Front leaves are lighter,
 * the leaves behind and underneath darker, each leaf with a thin darker rim — a pinch
 * of ink, the language of the rest of the world.
 *
 * The atlas is a 4 x 4 grid of `CELL` cells:
 *   row 0  small leaves (birch, aspen, willow, alder) x2, broad leaves (lime, maple, oak) x2
 *   row 1  needles (pine) x2, a hanging spray (birch's weeping twigs), SOLID
 *   row 2  spruce branches x3: a flat spray, the branch's base at the bottom of the cell;
 *          a fern frond, its stalk at the bottom
 *   row 3  bark, rough (fissured plates) and smooth (birch: lenticels and grey patches),
 *          each tiling in both directions (see `applyBarkMapping`)
 * SOLID is opaque white: the wood's texture coordinates point there, so wood and leaves
 * are one material and one draw.
 */

const CELL = 256;
const COLS = 4;
const ROWS = 4;

export type LeafSprite = 'small' | 'broad' | 'needle' | 'hanging' | 'fir' | 'frond';

/** Cells of each sprite, as [col, row]. */
const CELLS: Record<LeafSprite, readonly (readonly [number, number])[]> = {
  small: [[0, 0], [1, 0]],
  broad: [[2, 0], [3, 0]],
  needle: [[0, 1], [1, 1]],
  hanging: [[2, 1]],
  fir: [[0, 2], [1, 2], [2, 2]],
  frond: [[3, 2]],
};
const SOLID: readonly [number, number] = [3, 1];

/** Texture coordinates of one of a sprite's cells, inset so mips keep to the cell. */
export function leafCellUv(sprite: LeafSprite, pick: number): { u0: number; v0: number; u1: number; v1: number } {
  const cells = CELLS[sprite];
  const [c, r] = cells[Math.floor(pick * cells.length) % cells.length]!;
  const inset = 3 / CELL;
  return {
    u0: (c + inset) / COLS,
    u1: (c + 1 - inset) / COLS,
    // Canvas rows run down, texture v runs up (flipY).
    v0: 1 - (r + 1 - inset) / ROWS,
    v1: 1 - (r + inset) / ROWS,
  };
}

/** A texture coordinate inside SOLID, for wood. */
export const SOLID_UV: readonly [number, number] = [(SOLID[0] + 0.5) / COLS, 1 - (SOLID[1] + 0.5) / ROWS];

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const grey = (v: number): string => {
  const g = Math.round(Math.min(1, Math.max(0, v)) * 255);
  return `rgb(${g},${g},${g})`;
};

/** One leaf: pointed at both ends, a little asymmetric, rim first then fill. */
function leaf(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, length: number, width: number, shade: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const path = (l: number, w: number): void => {
    ctx.beginPath();
    ctx.moveTo(-l * 0.5, 0);
    ctx.quadraticCurveTo(-l * 0.1, -w, l * 0.5, 0);
    ctx.quadraticCurveTo(-l * 0.05, w * 0.9, -l * 0.5, 0);
    ctx.closePath();
  };
  path(length + 1.8, width + 1.6);
  ctx.fillStyle = grey(shade * 0.55);
  ctx.fill();
  path(length, width);
  ctx.fillStyle = grey(shade);
  ctx.fill();
  ctx.restore();
}

/**
 * A cluster of leaves on a disc. Leaves are laid back to front: the first are the ones
 * deep in the crown, dark; the last the outermost, lit, and the upper side of the
 * cluster is lighter than the lower (the sun is above). They point outward from the
 * middle, as leaves round a shoot do, and thin out toward the rim so the outline is
 * ragged and the sky shows through.
 */
function cluster(ctx: CanvasRenderingContext2D, rnd: () => number, count: number, length: number, width: number): void {
  const R = CELL * 0.47;
  const cx = CELL / 2;
  const cy = CELL / 2;
  // A few twigs the leaves hang off, dark, from the middle out.
  ctx.strokeStyle = grey(0.18);
  ctx.lineCap = 'round';
  for (let t = 0; t < 5; t++) {
    const a = rnd() * Math.PI * 2;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.quadraticCurveTo(cx + Math.cos(a + 0.4) * R * 0.4, cy + Math.sin(a + 0.4) * R * 0.4, cx + Math.cos(a) * R * 0.8, cy + Math.sin(a) * R * 0.8);
    ctx.stroke();
  }
  for (let i = 0; i < count; i++) {
    const depth = i / (count - 1);
    // Outer leaves come later: radius grows with depth, with plenty of scatter.
    const r = R * Math.min(0.97, Math.sqrt(rnd()) * (0.55 + 0.45 * depth) + 0.05);
    const a = rnd() * Math.PI * 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    // Leave the rim ragged: fewer leaves the further out.
    if (r > R * 0.82 && rnd() < 0.3) continue;
    const up = 1 - y / CELL;
    const shade = 0.42 + 0.36 * depth + 0.22 * up + (rnd() - 0.5) * 0.12;
    const angle = a + (rnd() - 0.5) * 1.3;
    const s = 0.8 + rnd() * 0.4;
    leaf(ctx, x, y, angle, length * s, width * s, shade);
  }
}

/** A tuft of needles: pine shoots, each a star of thin strokes round a light tip. */
function needles(ctx: CanvasRenderingContext2D, rnd: () => number): void {
  const R = CELL * 0.46;
  const cx = CELL / 2;
  const cy = CELL / 2;
  ctx.lineCap = 'round';
  const shoots = 34;
  for (let i = 0; i < shoots; i++) {
    const depth = i / (shoots - 1);
    const r = R * Math.sqrt(rnd()) * 0.78;
    const a = rnd() * Math.PI * 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    const up = 1 - y / CELL;
    const shade = 0.38 + 0.4 * depth + 0.2 * up;
    const len = 20 + rnd() * 14;
    // Needles fan round the shoot, pointing mostly outward and up.
    for (let k = 0; k < 16; k++) {
      const na = a + (rnd() - 0.5) * 2.6 - 0.5;
      const l = len * (0.6 + rnd() * 0.4);
      ctx.strokeStyle = grey(shade * 0.55);
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(na) * l, y + Math.sin(na) * l);
      ctx.stroke();
      ctx.strokeStyle = grey(shade + (rnd() - 0.5) * 0.1);
      ctx.lineWidth = 2.2;
      ctx.stroke();
    }
  }
}

/** Birch's weeping sprays: thin twigs hanging down, small leaves strung along them. */
function hanging(ctx: CanvasRenderingContext2D, rnd: () => number): void {
  const strands = 14;
  ctx.lineCap = 'round';
  for (let i = 0; i < strands; i++) {
    const depth = i / (strands - 1);
    const x0 = CELL * (0.15 + rnd() * 0.7);
    const y0 = CELL * (0.04 + rnd() * 0.2);
    const drop = CELL * (0.55 + rnd() * 0.38);
    const sway = (rnd() - 0.5) * CELL * 0.2;
    ctx.strokeStyle = grey(0.2);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(x0 + sway, y0 + drop * 0.5, x0 + sway * 0.6, y0 + drop);
    ctx.stroke();
    const leaves = 9 + Math.floor(rnd() * 5);
    for (let k = 0; k < leaves; k++) {
      const t = (k + rnd() * 0.5) / leaves;
      const x = x0 + sway * (2 * t * (1 - t) + 0.6 * t * t) + (rnd() - 0.5) * 10;
      const y = y0 + drop * t;
      const shade = 0.45 + 0.35 * depth + 0.15 * (1 - t) + (rnd() - 0.5) * 0.1;
      leaf(ctx, x, y, Math.PI / 2 + (rnd() - 0.5) * 1.6, 20 + rnd() * 6, 9 + rnd() * 3, shade);
    }
  }
}

/**
 * A spruce branch seen from above: a main twig from the cell's foot to its top, side
 * twigs off it both ways, shorter toward the tip so the spray is a narrow triangle,
 * and every twig furred with short needles, dark under, lighter on top.
 */
function firBranch(ctx: CanvasRenderingContext2D, rnd: () => number): void {
  const cx = CELL / 2;
  const foot = CELL - 6;
  const tip = 8;
  ctx.lineCap = 'round';
  const needled = (x0: number, y0: number, x1: number, y1: number, shade: number, fur: number): void => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(3, Math.floor(len / 3.2));
    const ax = (x1 - x0) / len;
    const ay = (y1 - y0) / len;
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const x = x0 + (x1 - x0) * t;
        const y = y0 + (y1 - y0) * t;
        const l = fur * (1 - 0.45 * t) * (0.75 + rnd() * 0.5);
        for (const side of [-1, 1]) {
          // Needles point forward along the twig and out to its side.
          const nx = ax * 0.55 + -ay * side * 0.85;
          const ny = ay * 0.55 + ax * side * 0.85;
          ctx.strokeStyle = grey(pass === 0 ? shade * 0.68 : shade + (rnd() - 0.5) * 0.12);
          ctx.lineWidth = pass === 0 ? 2.8 : 1.9;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + nx * l, y + ny * l);
          ctx.stroke();
        }
      }
    }
  };
  const twigs = 11;
  for (let i = 0; i < twigs; i++) {
    const t = (i + 0.5) / twigs;
    const y = foot + (tip - foot) * t;
    const reach = (CELL * 0.44) * (1 - t * 0.8) * (0.8 + rnd() * 0.35);
    for (const side of [-1, 1]) {
      const ex = cx + side * reach;
      const ey = y - reach * (0.55 + rnd() * 0.3);
      needled(cx, y, ex, ey, 0.66 + 0.24 * rnd() + 0.1 * t, 11);
    }
  }
  needled(cx, foot, cx, tip, 0.85, 13);
}

/**
 * A fern frond (bracken, lady fern): a stalk from the cell's foot to its tip, pairs of
 * leaflets off it, longest a third of the way up and shortening to a point, each
 * leaflet toothed into lobes. Lighter toward the tip, where the frond catches light.
 */
function frond(ctx: CanvasRenderingContext2D, rnd: () => number): void {
  const cx = CELL / 2;
  const foot = CELL - 4;
  const tip = 6;
  ctx.lineCap = 'round';
  const pairs = 16;
  for (let i = 0; i < pairs; i++) {
    const t = (i + 0.6) / pairs;
    const y = foot + (tip - foot) * t;
    // Widest a third of the way up: a lance, not a triangle.
    const reach = CELL * 0.46 * Math.sin(Math.PI * Math.min(1, t * 1.25 + 0.08)) * (0.9 + rnd() * 0.15);
    const shade = 0.5 + 0.4 * t + (rnd() - 0.5) * 0.08;
    for (const side of [-1, 1]) {
      const ex = cx + side * reach;
      const ey = y - reach * 0.35;
      const lobes = Math.max(3, Math.round(reach / 7));
      for (let k = 0; k < lobes; k++) {
        const u = (k + 0.5) / lobes;
        const lx = cx + (ex - cx) * u;
        const ly = y + (ey - y) * u;
        const r = 5.2 * (1 - 0.55 * u) + 1.2;
        ctx.fillStyle = grey(shade * 0.62);
        ctx.beginPath();
        ctx.ellipse(lx, ly + 0.8, r + 1.1, r * 0.75 + 1.1, side * 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = grey(shade + (rnd() - 0.5) * 0.06);
        ctx.beginPath();
        ctx.ellipse(lx, ly, r, r * 0.75, side * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.strokeStyle = grey(0.42);
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(cx, foot);
  ctx.lineTo(cx, tip);
  ctx.stroke();
}

/** Draws `draw` at every horizontal and vertical wrap of the cell, so bark tiles. */
function wrapCell(draw: (dx: number, dy: number) => void): void {
  for (const dx of [-CELL, 0, CELL]) for (const dy of [-CELL, 0, CELL]) draw(dx, dy);
}

/**
 * Rough bark: long vertical plates split by dark wandering fissures, the plates cracked
 * across here and there. Oak, pine's lower trunk, spruce, lime, maple, alder, willow.
 */
function barkRough(ctx: CanvasRenderingContext2D, rnd: () => number): void {
  ctx.fillStyle = grey(0.82);
  ctx.fillRect(0, 0, CELL, CELL);
  const fissures = 7;
  for (let f = 0; f < fissures; f++) {
    const x0 = (f + rnd() * 0.6) * (CELL / fissures);
    const w = 6 + rnd() * 8;
    const wobble = 5 + rnd() * 8;
    const phase = rnd() * 6.28;
    const shade = 0.4 + rnd() * 0.12;
    wrapCell((dx) => {
      ctx.fillStyle = grey(shade);
      ctx.beginPath();
      // Periodic in y so the tile wraps vertically too.
      for (let y = 0; y <= CELL; y += 8) {
        const x = x0 + dx + Math.sin((y / CELL) * Math.PI * 2 * 2 + phase) * wobble;
        if (y === 0) ctx.moveTo(x - w / 2, y);
        else ctx.lineTo(x - w / 2, y);
      }
      for (let y = CELL; y >= 0; y -= 8) {
        const x = x0 + dx + Math.sin((y / CELL) * Math.PI * 2 * 2 + phase) * wobble;
        ctx.lineTo(x + w / 2, y);
      }
      ctx.closePath();
      ctx.fill();
    });
  }
  // Plates: lighter ridges, broken across by short cracks.
  for (let i = 0; i < 30; i++) {
    const x = rnd() * CELL;
    const y = rnd() * CELL;
    const h = 30 + rnd() * 60;
    const w = 8 + rnd() * 10;
    const shade = 0.9 + rnd() * 0.1;
    wrapCell((dx, dy) => {
      ctx.fillStyle = grey(shade);
      ctx.beginPath();
      ctx.ellipse(x + dx, y + dy, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  for (let i = 0; i < 30; i++) {
    const x = rnd() * CELL;
    const y = rnd() * CELL;
    const w = 10 + rnd() * 16;
    wrapCell((dx, dy) => {
      ctx.fillStyle = grey(0.5);
      ctx.fillRect(x + dx, y + dy, w, 3);
    });
  }
}

/**
 * Smooth bark, birch and aspen: pale with dark horizontal lenticels, short and long,
 * and blotches of grey where it has weathered or lichen has taken hold. Painted as
 * shade over the vertex colour, which still carries the birch's white, grey and black.
 */
function barkSmooth(ctx: CanvasRenderingContext2D, rnd: () => number): void {
  ctx.fillStyle = grey(0.95);
  ctx.fillRect(0, 0, CELL, CELL);
  for (let i = 0; i < 26; i++) {
    const x = rnd() * CELL;
    const y = rnd() * CELL;
    const rx = 14 + rnd() * 30;
    const ry = 8 + rnd() * 18;
    const shade = 0.72 + rnd() * 0.14;
    wrapCell((dx, dy) => {
      ctx.fillStyle = grey(shade);
      ctx.beginPath();
      ctx.ellipse(x + dx, y + dy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  for (let i = 0; i < 70; i++) {
    const x = rnd() * CELL;
    const y = rnd() * CELL;
    const long = rnd() < 0.2;
    const w = long ? 24 + rnd() * 30 : 5 + rnd() * 10;
    const h = long ? 2.5 + rnd() * 2 : 1.6 + rnd() * 1.4;
    const shade = 0.2 + rnd() * 0.2;
    wrapCell((dx, dy) => {
      ctx.fillStyle = grey(shade);
      ctx.beginPath();
      ctx.ellipse(x + dx, y + dy, w / 2, h, 0, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}

/** Metres of trunk one bark tile covers: round the trunk, and up it. */
export const BARK_TILE_AROUND_M = 0.6;
export const BARK_TILE_UP_M = 1.2;
/** Offsets on the u coordinate that mark a wood vertex as bark (see `applyBarkMapping`). */
export const BARK_ROUGH_U = 10;
export const BARK_SMOOTH_U = 1000;
const BARK_ROUGH_CELL: readonly [number, number] = [0, 3];
const BARK_SMOOTH_CELL: readonly [number, number] = [1, 3];

/**
 * Samples bark for wood whose u carries a bark offset (`BARK_ROUGH_U`,
 * `BARK_SMOOTH_U`): the fractional part of the coordinate, mapped into the bark's
 * atlas cell, so a trunk's bark repeats up and round it; everything else samples the
 * atlas as it is. The gradients are the unwrapped coordinate's, so a mip is never
 * picked from the jump where the tile repeats. Chains onto `onBeforeCompile`; the
 * material must have the leaf atlas as its map.
 */
export function applyBarkMapping(material: THREE.Material): void {
  const previous = material.onBeforeCompile;
  const inset = 4 / CELL;
  const cellUv = (c: readonly [number, number]): string =>
    `vec2( ${((c[0] + inset) / COLS).toFixed(6)}, ${(1 - (c[1] + 1 - inset) / ROWS).toFixed(6)} )`;
  const size = `vec2( ${((1 - 2 * inset) / COLS).toFixed(6)}, ${((1 - 2 * inset) / ROWS).toFixed(6)} )`;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#ifdef USE_MAP
{
  vec2 barkUv = vMapUv;
  vec4 sampledDiffuseColor;
  if ( barkUv.x > ${(BARK_ROUGH_U - 0.5).toFixed(1)} ) {
    vec2 origin = barkUv.x > ${(BARK_SMOOTH_U - 0.5).toFixed(1)} ? ${cellUv(BARK_SMOOTH_CELL)} : ${cellUv(BARK_ROUGH_CELL)};
    vec2 barkSize = ${size};
    sampledDiffuseColor = textureGrad( map, origin + fract( barkUv ) * barkSize, dFdx( barkUv ) * barkSize, dFdy( barkUv ) * barkSize );
  } else {
    sampledDiffuseColor = texture2D( map, barkUv );
  }
  diffuseColor *= sampledDiffuseColor;
}
#endif`,
    );
  };
  const previousKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () => `${previousKey.call(material)}:bark-v1`;
}

let atlas: THREE.Texture | null = null;

/** The leaf atlas, painted on first use. */
export function leafAtlas(): THREE.Texture {
  if (atlas) return atlas;
  const canvas = document.createElement('canvas');
  canvas.width = CELL * COLS;
  canvas.height = CELL * ROWS;
  const ctx = canvas.getContext('2d')!;
  const paint = (col: number, row: number, draw: () => void): void => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(col * CELL, row * CELL, CELL, CELL);
    ctx.clip();
    ctx.translate(col * CELL, row * CELL);
    draw();
    ctx.restore();
  };
  paint(0, 0, () => cluster(ctx, mulberry(0x6c656166), 900, 15, 7.5));
  paint(1, 0, () => cluster(ctx, mulberry(0x6c656167), 850, 16, 8));
  paint(2, 0, () => cluster(ctx, mulberry(0x62726f61), 520, 22, 12));
  paint(3, 0, () => cluster(ctx, mulberry(0x62726f62), 480, 24, 13));
  paint(0, 1, () => needles(ctx, mulberry(0x6e656564)));
  paint(1, 1, () => needles(ctx, mulberry(0x6e656565)));
  paint(2, 1, () => hanging(ctx, mulberry(0x68616e67)));
  paint(0, 2, () => firBranch(ctx, mulberry(0x66697231)));
  paint(1, 2, () => firBranch(ctx, mulberry(0x66697232)));
  paint(2, 2, () => firBranch(ctx, mulberry(0x66697233)));
  paint(3, 2, () => frond(ctx, mulberry(0x66726e64)));
  paint(BARK_ROUGH_CELL[0], BARK_ROUGH_CELL[1], () => barkRough(ctx, mulberry(0x6261726b)));
  paint(BARK_SMOOTH_CELL[0], BARK_SMOOTH_CELL[1], () => barkSmooth(ctx, mulberry(0x62697263)));
  paint(SOLID[0], SOLID[1], () => {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, CELL, CELL);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.premultiplyAlpha = false;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  atlas = texture;
  return texture;
}
