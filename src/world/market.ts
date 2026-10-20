import * as THREE from 'three';
import { maxAnisotropy } from '../render/texturequality';
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
  const key = `${lines.join('\n')}|${bg}|${fg}|${width}x${height}`;
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
  if (g) {
    g.fillStyle = bg;
    g.fillRect(0, 0, width, height);
    const border = Math.max(3, Math.round(height * 0.03));
    g.strokeStyle = fg;
    g.lineWidth = border;
    g.strokeRect(border, border, width - border * 2, height - border * 2);
    g.fillStyle = fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const rows = lines.length;
    const rowH = (height - border * 4) / rows;
    for (let i = 0; i < rows; i++) {
      // The first line is the headline; the rest are smaller.
      const size = Math.round(rowH * (i === 0 ? 0.72 : 0.6));
      g.font = `bold ${size}px sans-serif`;
      g.fillText(lines[i]!, width * 0.5, border * 2 + rowH * (i + 0.5), width - border * 6);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy();
  return new THREE.MeshStandardMaterial({ map: texture, roughness: 0.6, metalness: 0.1 });
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
  return group;
}
