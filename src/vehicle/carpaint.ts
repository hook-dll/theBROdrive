import * as THREE from 'three';

/**
 * Car paint: the factory palette, the per-car colour picked from it, and a respray
 * laid over that colour from a spray can.
 *
 * The palette is the renderer's and the gameplay's at once. A car's factory colour
 * is a hash of its model and id into this list (render/carmodel.ts paints it at
 * instancing), and every spray can in the world carries one of these same colours,
 * so anything the desert can paint a car, the player can paint it too.
 */

export interface CarPaintSwatch {
  readonly hex: number;
  readonly name: string;
}

/** Curated factory colours shared by both imported packs, and the spray-can range. */
export const CAR_PAINTS: readonly CarPaintSwatch[] = [
  { hex: 0x4078a2, name: 'deep blue' },
  { hex: 0x85b5cd, name: 'powder blue' },
  { hex: 0x40776b, name: 'dark teal' },
  { hex: 0x88a28c, name: 'sage' },
  { hex: 0xa34e43, name: 'oxide red' },
  { hex: 0xcf794c, name: 'burnt orange' },
  { hex: 0xd8b754, name: 'ochre' },
  { hex: 0xe2ddcc, name: 'ivory' },
  { hex: 0xb0a58e, name: 'beige' },
  { hex: 0x846e8e, name: 'plum' },
  { hex: 0x7d8e9f, name: 'slate' },
  { hex: 0x444b52, name: 'charcoal' },
];

/** The palette entry for a colour, or undefined when `hex` is not a palette paint. */
export function carPaintSwatch(hex: number): CarPaintSwatch | undefined {
  return CAR_PAINTS.find((swatch) => swatch.hex === hex);
}

/**
 * Stable string avalanche: a saved/generated car keeps its colour and its wear
 * pattern across reloads.
 */
export function appearanceHash(modelId: string, appearanceKey: string): number {
  let h = 0x811c9dc5;
  const key = `${modelId}:${appearanceKey}`;
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** The factory colour a car of this model and key leaves the works in, 0xRRGGBB. */
export function factoryPaintHex(modelId: string, appearanceKey: string): number {
  return CAR_PAINTS[appearanceHash(modelId, appearanceKey) % CAR_PAINTS.length]!.hex;
}

/**
 * A two-tone body's second colour. Neighbouring swatches are skipped: they can read
 * as one paint under desert sunlight.
 */
export function secondaryFactoryPaintHex(modelId: string, appearanceKey: string): number {
  const h = appearanceHash(modelId, appearanceKey);
  const primaryIndex = h % CAR_PAINTS.length;
  const offset = 3 + ((h >>> 8) % (CAR_PAINTS.length - 5));
  return CAR_PAINTS[(primaryIndex + offset) % CAR_PAINTS.length]!.hex;
}

/**
 * A respray in progress or finished: `coat` laid over `base`, `cover` of the way.
 *
 * Kept as three numbers rather than one mixed colour because a coat goes on over
 * seconds of held spray, and a colour rounded to 8 bits every frame would stall
 * short of its target. `base` is whatever the car looked like when this coat was
 * started — the factory colour, or the visible mix of an unfinished earlier coat.
 */
export interface CarPaint {
  base: number;
  coat: number;
  /** 0..1: how much of the coat is on. */
  cover: number;
}

const baseScratch = new THREE.Color();
const coatScratch = new THREE.Color();

/**
 * The colour a respray shows, into `target`. Mixed in the linear working space, the
 * same space the shader lights it in, so half a coat looks like half a coat.
 */
export function carPaintColor(paint: CarPaint, target: THREE.Color): THREE.Color {
  baseScratch.setHex(paint.base);
  coatScratch.setHex(paint.coat);
  return target.lerpColors(baseScratch, coatScratch, paint.cover);
}

const visibleScratch = new THREE.Color();

/** The visible colour of a car, respray or factory, as 0xRRGGBB. */
export function visiblePaintHex(
  paint: CarPaint | null,
  modelId: string,
  appearanceKey: string,
): number {
  if (paint === null) return factoryPaintHex(modelId, appearanceKey);
  return carPaintColor(paint, visibleScratch).getHex();
}
