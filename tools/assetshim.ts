/**
 * tools/assetshim.ts
 *
 * The parts of a browser three's model loaders reach for, and nothing more, so a
 * headless tool can load the REAL car models instead of testing a stand-in.
 *
 * Three things stand between Node and a catalogue car:
 *
 *  - the model paths are root-absolute (`/models/...`) because the dev server serves
 *    them out of `public/`, and three builds a `Request` from that before fetching,
 *    which rejects a relative path outright. Rewritten to file URLs on the default
 *    loading manager — the manager `render/carmodel.ts` gets when it constructs its
 *    loaders.
 *  - Node's `fetch` refuses `file:` URLs, so it is taught to read them off the disk.
 *  - TEXTURES cannot be decoded without a browser at all: three's image path wants
 *    `self`, an `<img>` element and `createObjectURL`. Every texture request therefore
 *    resolves to one blank texture. Nothing a physics or geometry tool measures reads
 *    a pixel. The FBX packs additionally ship authoring cameras, and `FBXLoader` sizes
 *    a camera's aspect from `window.innerWidth` before `carmodel.ts` gets the chance
 *    to throw the camera away.
 *
 * Geometry, node names and bounds — everything `carModelMeasure` reads — are decoded
 * normally, which is the whole point: a bench that cannot load the real bodies cannot
 * measure the real wheelbase, track or ride height.
 *
 * Shared rather than copied, for the same reason `domshim.ts` is.
 *
 * Nothing here is part of the game bundle.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

class BunProgressEvent extends Event implements ProgressEvent {
  readonly lengthComputable: boolean;
  readonly loaded: number;
  readonly total: number;
  constructor(type: string, init: ProgressEventInit = {}) {
    super(type, init);
    this.lengthComputable = init.lengthComputable ?? false;
    this.loaded = init.loaded ?? 0;
    this.total = init.total ?? 0;
  }
}

/**
 * Resolves every texture request to one blank texture.
 *
 * Decoding an image needs a browser: three's image path wants `self`, an `<img>`
 * element and `createObjectURL`. Nothing a physics, geometry or light-rig tool
 * measures reads a pixel, and `render/carmodel.ts` treats an undecodable palette as
 * "leave the pack's authored colour alone", so a blank stands in for all of them.
 */
export function installBlankTextures(): void {
  const blank = new THREE.Texture();
  THREE.TextureLoader.prototype.load = function (
    _url: string,
    onLoad?: (texture: THREE.Texture) => void,
  ): THREE.Texture {
    onLoad?.(blank);
    return blank;
  };
}

/** Installs every shim the model loaders need. Idempotent. */
export function installAssetShim(): void {
  if (globalThis.ProgressEvent === undefined) globalThis.ProgressEvent = BunProgressEvent;

  const root = new URL('../public/', import.meta.url).href;
  THREE.DefaultLoadingManager.setURLModifier((url) =>
    url.startsWith('/') ? root + url.slice(1) : url,
  );

  const upstream = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('file:')) {
      return new Response(new Uint8Array(await readFile(fileURLToPath(url))));
    }
    return upstream(input, init);
  }) as typeof fetch;

  installBlankTextures();

  const scope = globalThis as unknown as {
    self?: unknown;
    window?: { innerWidth: number; innerHeight: number };
  };
  scope.self ??= globalThis;
  scope.window ??= { innerWidth: 1920, innerHeight: 1080 };
}
