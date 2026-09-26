import * as THREE from 'three';

import { maxAnisotropy } from '../texturequality';

/**
 * THE GROUND'S PHOTOGRAPHS (public/look, assembled by tools/look/ground.mjs).
 *
 * Eighteen CC0 tiles and masks, loaded once for the life of the session and shared by
 * every ground material — the tiles, the vista and the grass — so a material swap
 * cannot be the reason two pieces of ground disagree. Their sources, licences and the
 * metres one repeat covers are in `public/look/LICENSES.md` and `manifest.json`; the
 * scales the SHADER uses are in `groundcolor.glsl.ts` (`GROUND_SCALE`), because the
 * shader also has to keep them divisible by the floating origin's step.
 *
 * COLOUR SPACE IS PART OF THE DATA, not a per-material choice: an albedo is loaded as
 * sRGB so the sampler returns linear light, and a mask as linear data so its numbers
 * mean what they say. Sampling a mask through the sRGB curve darkened it by a fifth,
 * which is a whole layer's worth of contrast.
 *
 * LOADING IS ASYNCHRONOUS AND DELIBERATELY UNGUARDED BY A PROMISE. A texture object is
 * handed out immediately and the image arrives into it when it arrives: the first
 * frames of a boot show the ground grey, the warm-up screen covers most of it, and no
 * material has to know whether its textures are ready. Under Node (the lab pages and
 * `tools/*.ts` build these materials without a WebGL context) there is no `document` to
 * load an image with, so nothing is requested at all.
 */

interface GroundTextureSpec {
  /** File under `/look/`. */
  readonly file: string;
  /** True for an albedo (sRGB), false for a mask or height. */
  readonly srgb: boolean;
  /** What it is, for the one place these are enumerated. */
  readonly role: string;
}

const SPECS = {
  grass: { file: 'grass.webp', srgb: true, role: 'greyscale meadow, 7 m' },
  grassSnow: { file: 'grass_snow.webp', srgb: true, role: 'winter meadow, 7 m' },
  forestSpring: { file: 'forest_spring.webp', srgb: true, role: 'forest floor, spring' },
  forestSummer: { file: 'forest_summer.webp', srgb: true, role: 'forest floor, summer' },
  forestAutumn: { file: 'forest_autumn.webp', srgb: true, role: 'forest floor, leaf litter' },
  forestWinter: { file: 'forest_winter.webp', srgb: true, role: 'forest floor, frozen' },
  soil: { file: 'soil.webp', srgb: true, role: 'ploughed earth' },
  stubble: { file: 'stubble.webp', srgb: true, role: 'harvested field' },
  peat: { file: 'peat.webp', srgb: true, role: 'bog peat' },
  gravel: { file: 'gravel.webp', srgb: true, role: 'verge gravel' },
  rock: { file: 'rock.webp', srgb: true, role: 'cutting and ravine rock' },
  rockHeight: { file: 'rock_height.webp', srgb: false, role: 'crack and bump map' },
  shore: { file: 'sand.webp', srgb: true, role: 'lake shore silt and sand' },
  noiseFine: { file: 'noise_fine.webp', srgb: false, role: 'the 7/100/500/4000 m fades' },
  noiseVariation: { file: 'noise_variation.webp', srgb: false, role: 'the 500/2000 m patch map' },
  detailNear: { file: 'detail_near.webp', srgb: false, role: 'near multiplicative detail' },
  detailFar: { file: 'detail_far.webp', srgb: false, role: 'far multiplicative detail' },
  detailFarWinter: { file: 'detail_far_winter.webp', srgb: false, role: 'far detail, winter' },
} as const;

export type GroundTextureName = keyof typeof SPECS;

/** Every name, in declaration order: the shader's sampler list without loading anything. */
export const GROUND_TEXTURE_NAMES = Object.keys(SPECS) as GroundTextureName[];

export type GroundTextures = Readonly<Record<GroundTextureName, THREE.Texture>>;

/** Metres one repeat of the patch map covers where the grass asks for its mottling. */
export const GROUND_VARY_M = 125;

let loaded: GroundTextures | null = null;
let vary: { texture: THREE.Texture; metres: number } | null = null;

/**
 * An image loader, or null where this environment cannot decode one.
 *
 * A `document` IS NOT ENOUGH, and that is what this checks for now: three's `ImageLoader`
 * builds its `<img>` with `document.createElementNS`, which the headless tools' document
 * shim (`tools/domshim.ts`) does not provide — so a tool that built a real material died
 * at module scope with `document.createElementNS is not a function`. The road corridor's
 * materials (`render/look/roadsurface.ts`) are built by `tools/surface-paint.ts` through
 * the real provider, which is how this was found.
 */
export function imageLoader(): THREE.TextureLoader | null {
  return typeof document === 'undefined' || typeof document.createElementNS !== 'function'
    ? null
    : new THREE.TextureLoader();
}

/**
 * The whole set, loading it on the first request. One object for the session: the same
 * `THREE.Texture` must reach every material, or the GPU uploads and the filters are
 * duplicated per material.
 */
export function groundTextures(): GroundTextures {
  if (loaded) return loaded;
  const loader = imageLoader();
  const out = {} as Record<GroundTextureName, THREE.Texture>;
  for (const [name, spec] of Object.entries(SPECS) as [GroundTextureName, GroundTextureSpec][]) {
    // THE LOADER'S OWN TEXTURE, configured here before it is ever uploaded. Its callback
    // hands back the TEXTURE and not the decoded image, so assigning `texture.image` from
    // it puts a Texture inside a Texture: the upload then reads nothing and every ground
    // layer samples black. `TextureLoader` has already marked it for update by the time
    // the image arrives, so no callback is needed at all.
    const texture = loader ? loader.load(`/look/${spec.file}`) : new THREE.Texture();
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = maxAnisotropy();
    texture.colorSpace = spec.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.name = `${name} (${spec.role})`;
    out[name] = texture;
  }
  loaded = out;
  return loaded;
}

/**
 * The slow mottling the grass tufts take their colour from, so a tuft is the colour of
 * the ground it stands in. The patch map, at the scale the old painted ground used.
 */
export function groundVaryTexture(): { texture: THREE.Texture; metres: number } {
  vary ??= { texture: groundTextures().noiseVariation, metres: GROUND_VARY_M };
  return vary;
}
