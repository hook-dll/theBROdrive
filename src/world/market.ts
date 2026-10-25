import * as THREE from 'three';
import { makeFlatPaletteMaterial } from '../render/materials';
import { maxAnisotropy } from '../render/texturequality';
import { fillGameText } from '../ui/balls';
import { box, C } from './poi/kit';

/**
 * What the roadside sells beside the machines: the cars on the lots (world/carlot.ts),
 * whose price signs come down when they are bought, and the painted signs every machine
 * and lot board is made of.
 *
 * Everything here is scenery for a streamed chunk. A lot car's price is a pure function
 * of the seed and the stop; whether it was bought is in `WorldState` (`CarState.lotPrice`),
 * so a rebuilt chunk shows exactly what is left.
 */

/** Live lot signs, following streamed physics chunks, keyed by the car's id. */
export class MarketField {
  private readonly lotSigns = new Map<string, THREE.Object3D>();

  registerLotSign(carId: string, sign: THREE.Object3D): void {
    this.lotSigns.set(carId, sign);
  }

  /** Drops a chunk's registrations, by lot car id. */
  forget(ids: readonly string[]): void {
    for (const id of ids) this.lotSigns.delete(id);
  }

  /** A lot car was bought: its price sign comes down. */
  carSold(carId: string): void {
    const sign = this.lotSigns.get(carId);
    if (sign) sign.visible = false;
  }
}

// ---------------------------------------------------------------------------
// Signs
// ---------------------------------------------------------------------------

/**
 * A painted board, one per distinct text, kept for the session: there are a handful of
 * machine titles and one price per car model, so the cache stays small, and nothing
 * built per chunk has to be disposed with it.
 */
const signCache = new Map<string, THREE.MeshStandardMaterial>();

/**
 * The board's material: the 20 km sign's shape (a map, roughness 0.6, metalness 0.1, no
 * shadows), whose program `marketProgramAnchor` links at boot. Cached per text.
 */
export function signMaterial(lines: readonly string[], bg: string, fg: string, width = 512, height = 256): THREE.MeshStandardMaterial {
  const key = signKey(lines, bg, fg, width, height);
  const cached = signCache.get(key);
  if (cached) return cached;
  const material = paintSign(lines, bg, fg, width, height);
  signCache.set(key, material);
  return material;
}

/**
 * A board's material painted fresh, the same shape as `signMaterial`'s, NOT cached: for
 * text that is never painted twice (a stop's own post plate), owned and disposed —
 * material and map — by whoever built it.
 */
export function paintSign(lines: readonly string[], bg: string, fg: string, width = 512, height = 256): THREE.MeshStandardMaterial {
  // The headless tools (tools/poi-*.ts) build stops with no DOM: their boards are blank.
  if (typeof document === 'undefined') {
    const blank = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    blank.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map: blank, roughness: 0.6, metalness: 0.1 });
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  if (g) drawSign(g, 0, 0, width, height, lines, bg, fg);
  return boardMaterial(canvas);
}

/**
 * Paints `lines` again over a board `paintSign` made, on its own canvas: a board whose
 * text changes while it stands (a shelter's timetable). Headless, nothing to paint.
 */
export function repaintSign(material: THREE.MeshStandardMaterial, lines: readonly string[], bg: string, fg: string): void {
  const texture = material.map;
  const canvas = texture?.image as HTMLCanvasElement | undefined;
  if (typeof document === 'undefined' || !texture || !(canvas instanceof HTMLCanvasElement)) return;
  const g = canvas.getContext('2d');
  if (!g) return;
  drawSign(g, 0, 0, canvas.width, canvas.height, lines, bg, fg);
  texture.needsUpdate = true;
}

/** A board's material over a painted canvas: the shape `marketProgramAnchor` links. */
function boardMaterial(canvas: HTMLCanvasElement): THREE.MeshStandardMaterial {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy();
  return new THREE.MeshStandardMaterial({ map: texture, roughness: 0.6, metalness: 0.1 });
}

/** Paints one board, `width` by `height`, with its top left corner at (`x`, `y`). */
function drawSign(
  g: CanvasRenderingContext2D, x: number, y: number, width: number, height: number,
  lines: readonly string[], bg: string, fg: string,
): void {
  g.fillStyle = bg;
  g.fillRect(x, y, width, height);
  const border = Math.max(3, Math.round(height * 0.03));
  g.strokeStyle = fg;
  g.lineWidth = border;
  g.strokeRect(x + border, y + border, width - border * 2, height - border * 2);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const rows = lines.length;
  const rowH = (height - border * 4) / rows;
  for (let i = 0; i < rows; i++) {
    // The first line is the headline; the rest are smaller.
    const size = Math.round(rowH * (i === 0 ? 0.72 : 0.6));
    g.font = `bold ${size}px sans-serif`;
    fillGameText(g, lines[i]!, x + width * 0.5, y + border * 2 + rowH * (i + 0.5), width - border * 6);
  }
}

// ---------------------------------------------------------------------------
// The sign atlas
// ---------------------------------------------------------------------------

/**
 * The boards whose text is known before the drive starts (a card machine's title, button
 * and tray, a drum's stencil), painted side by side on one canvas: they draw in one
 * material, so a machine's three boards merge into one draw (poi/kit.ts `mergeKitStatics`)
 * instead of three, each with a texture of its own.
 *
 * Registered at module load (`registerAtlasSign`) and painted once, on the first board
 * asked for, so the texture is uploaded once and never repainted: a board with a text
 * only the drive decides (a price, a place name) keeps its own material (`signMaterial`).
 */
interface AtlasSign {
  readonly lines: readonly string[];
  readonly bg: string;
  readonly fg: string;
  readonly width: number;
  readonly height: number;
  /** The unit plane, its UVs on this board's cell; set when the atlas is painted. */
  geometry: THREE.PlaneGeometry | null;
}

const atlasSigns = new Map<string, AtlasSign>();
let atlasMaterial: THREE.MeshStandardMaterial | null = null;
/** Each cell's border in the board's own background, so a mip never reads a neighbour. */
const ATLAS_GUTTER = 8;
const ATLAS_WIDTH = 1024;

function signKey(lines: readonly string[], bg: string, fg: string, width: number, height: number): string {
  return `${lines.join('\n')}|${bg}|${fg}|${width}x${height}`;
}

/** Puts a board with a fixed text on the atlas. Module load only: see `AtlasSign`. */
export function registerAtlasSign(lines: readonly string[], bg: string, fg: string, width = 512, height = 256): void {
  if (atlasMaterial) {
    if (import.meta.env?.DEV) console.warn(`sign atlas already painted: "${lines.join(' ')}" keeps its own board`);
    return;
  }
  atlasSigns.set(signKey(lines, bg, fg, width, height), { lines, bg, fg, width, height, geometry: null });
}

/** Packs and paints every registered board, shelf by shelf, tallest first. */
function paintAtlas(): THREE.MeshStandardMaterial {
  const signs = [...atlasSigns.values()].sort((a, b) => b.height - a.height);
  const cells: { sign: AtlasSign; x: number; y: number }[] = [];
  let x = 0;
  let y = 0;
  let shelf = 0;
  for (const sign of signs) {
    const w = sign.width + ATLAS_GUTTER * 2;
    const h = sign.height + ATLAS_GUTTER * 2;
    if (x + w > ATLAS_WIDTH) {
      y += shelf;
      x = 0;
      shelf = 0;
    }
    cells.push({ sign, x: x + ATLAS_GUTTER, y: y + ATLAS_GUTTER });
    x += w;
    shelf = Math.max(shelf, h);
  }
  const height = THREE.MathUtils.ceilPowerOfTwo(Math.max(1, y + shelf));
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_WIDTH;
  canvas.height = height;
  const g = canvas.getContext('2d');
  for (const { sign, x, y } of cells) {
    if (g) {
      g.fillStyle = sign.bg;
      g.fillRect(x - ATLAS_GUTTER, y - ATLAS_GUTTER, sign.width + ATLAS_GUTTER * 2, sign.height + ATLAS_GUTTER * 2);
      drawSign(g, x, y, sign.width, sign.height, sign.lines, sign.bg, sign.fg);
    }
    // The canvas is uploaded flipped: its top row is v = 1.
    const u0 = x / ATLAS_WIDTH;
    const u1 = (x + sign.width) / ATLAS_WIDTH;
    const v1 = 1 - y / height;
    const v0 = 1 - (y + sign.height) / height;
    const geometry = new THREE.PlaneGeometry(1, 1);
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    sign.geometry = geometry;
  }
  return boardMaterial(canvas);
}

/**
 * A board as a mesh on the unit plane (scale it to size): on the atlas when its text was
 * registered (`registerAtlasSign`), else on its own cached material (`signMaterial`).
 */
export function signMesh(lines: readonly string[], bg: string, fg: string, width = 512, height = 256): THREE.Mesh {
  const sign = typeof document === 'undefined' ? undefined : atlasSigns.get(signKey(lines, bg, fg, width, height));
  if (sign) {
    atlasMaterial ??= paintAtlas();
    return new THREE.Mesh(sign.geometry!, atlasMaterial);
  }
  return new THREE.Mesh(SIGN_PLANE, signMaterial(lines, bg, fg, width, height));
}

/** One unit plane, faced +Z; every sign scales it. */
export const SIGN_PLANE = new THREE.PlaneGeometry(1, 1);

/**
 * Hidden meshes holding the market's programs, for the scene at boot: a sign board's (a
 * map, no shadows) and a kit box's (flat, casting and receiving), the two shapes every
 * machine and lot sign is built of. Signs are drawn only where a machine or a lot stands,
 * so without this their program linked on the first one in view.
 */
export function marketProgramAnchor(): THREE.Object3D {
  const group = new THREE.Group();
  group.name = 'market-anchor';
  group.visible = false;
  const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  group.add(new THREE.Mesh(SIGN_PLANE, new THREE.MeshStandardMaterial({ map: texture, roughness: 0.6, metalness: 0.1 })));
  box(group, [1, 1, 1], [0, 0, 0], C.metal);
  // The merged boxes' palette (poi/kit.ts `mergeKitStatics`): the kit box's program with
  // its colours in the vertices. Every roughness shares it.
  const paletteBox = new THREE.BoxGeometry(1, 1, 1);
  paletteBox.setAttribute('color', new THREE.BufferAttribute(new Float32Array(paletteBox.getAttribute('position').count * 3).fill(1), 3));
  const palette = new THREE.Mesh(paletteBox, makeFlatPaletteMaterial(0.88));
  palette.castShadow = true;
  palette.receiveShadow = true;
  group.add(palette);
  return group;
}
