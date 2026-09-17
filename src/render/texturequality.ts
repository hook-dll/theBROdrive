import type * as THREE from 'three';

/**
 * Shared hardware anisotropic-filtering ceiling, read once from the live WebGL
 * context and reused by every procedurally-built texture in the game.
 *
 * WHY ONE NUMBER FOR EVERYTHING, not a hand-picked cap per texture. Three clamps
 * `texture.anisotropy` to `capabilities.getMaxAnisotropy()` on upload
 * (WebGLTextures.setTextureParameters), so the cap can never exceed what the
 * device actually supports — asking for more than a phone's GPU can do just
 * becomes that phone's own maximum, silently. And the cap is a CEILING, not a
 * flat cost: the GPU picks how many samples a fragment actually needs from the
 * texture coordinate derivatives (how oblique that fragment's view of the
 * texture is), and only spends up to `min(cap, that need)`. A sticker or sign
 * viewed near face-on asks for one or two samples whatever the cap says, so
 * capping it low buys nothing on the frames where it stays face-on and only
 * loses sharpness on the rare frame it doesn't (a sign glimpsed edge-on while
 * passing it). There is no texture in this game for which a lower cap is a
 * deliberate performance trade — so there is exactly one cap, not one per file.
 */
let cachedMax: number | null = null;

/**
 * Call once, right after a `THREE.WebGLRenderer` is constructed, before any
 * texture that reads `maxAnisotropy()` is built.
 */
export function primeMaxAnisotropy(webgl: THREE.WebGLRenderer): void {
  cachedMax = webgl.capabilities.getMaxAnisotropy();
}

/** The live hardware cap. 1 (no anisotropic filtering) if nothing has primed it yet. */
export function maxAnisotropy(): number {
  return cachedMax ?? 1;
}
