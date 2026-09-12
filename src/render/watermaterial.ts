import * as THREE from 'three';

/**
 * The water surface's material: stock `MeshStandardMaterial` with a procedural
 * scrolling normal map, and nothing else.
 *
 * WHY STOCK. Everything water needs here already exists in the scene and is free to a
 * standard material: `FogExp2` (core/renderer.ts) so the far shore dissolves into the
 * same haze as the sand, the one-time sky PMREM assigned to `scene.environment`
 * (render/sky.ts) for the sky reflection, and the sun's own directional light for the
 * specular glitter. A `ShaderMaterial` would have to re-declare the fog chunks and
 * re-derive the environment lookup — that is what render/tyretracks.ts pays — and
 * would still not reflect anything a static probe cannot.
 *
 * WHAT IS DELIBERATELY MISSING. No planar reflection: the renderer has exactly one
 * offscreen target and one fullscreen pass (core/renderer.ts), so a mirrored view
 * means a second camera and a third pass. Distant water reflects the sky, the sun
 * glitters on it, and nothing on the shore appears in it.
 *
 * NOT COMIC-SHADED, on purpose. `applyComicShading` bands and stipples the sand; the
 * water is left smooth so that it reads as the one wet surface in the frame. It still
 * receives the fullscreen ink silhouette like everything else.
 */

/** Normal-map resolution. Power of two so Three can mip it. */
const MAP_SIZE = 256;
/** Metres one tile of the normal map covers. */
export const WAVE_TILE_METRES = 14;
/**
 * Wave train: `[periodU, periodV, amplitude]`. Integer periods keep the map seamless,
 * and four directions are what stop a single scrolling layer from reading as a
 * conveyor belt — the crests cross rather than march.
 */
const WAVES: readonly (readonly [number, number, number])[] = [
  [3, 1, 1],
  [1, -2, 0.75],
  [5, 3, 0.4],
  [2, 4, 0.3],
  [7, -5, 0.16],
];
/** Height-to-normal steepness. Tuned by eye at the shore, where the slope shows most. */
const RELIEF = 2.6;

function createWaveNormalMap(): THREE.DataTexture {
  const heights = new Float32Array(MAP_SIZE * MAP_SIZE);
  let norm = 0;
  for (const [, , amplitude] of WAVES) norm += amplitude;
  for (let iy = 0; iy < MAP_SIZE; iy++) {
    const v = iy / MAP_SIZE;
    for (let ix = 0; ix < MAP_SIZE; ix++) {
      const u = ix / MAP_SIZE;
      let h = 0;
      for (const [ku, kv, amplitude] of WAVES) {
        h += Math.sin(2 * Math.PI * (ku * u + kv * v)) * amplitude;
      }
      heights[iy * MAP_SIZE + ix] = h / norm;
    }
  }

  const data = new Uint8Array(MAP_SIZE * MAP_SIZE * 4);
  for (let iy = 0; iy < MAP_SIZE; iy++) {
    const y0 = ((iy - 1 + MAP_SIZE) % MAP_SIZE) * MAP_SIZE;
    const y1 = ((iy + 1) % MAP_SIZE) * MAP_SIZE;
    const row = iy * MAP_SIZE;
    for (let ix = 0; ix < MAP_SIZE; ix++) {
      const x0 = (ix - 1 + MAP_SIZE) % MAP_SIZE;
      const x1 = (ix + 1) % MAP_SIZE;
      // Wrapped central differences: the map has to tile without a seam line.
      const dhx = (heights[row + x1]! - heights[row + x0]!) * RELIEF;
      const dhy = (heights[y1 + ix]! - heights[y0 + ix]!) * RELIEF;
      const length = Math.hypot(-dhx, -dhy, 1);
      const o = (row + ix) * 4;
      data[o] = Math.round((-dhx / length * 0.5 + 0.5) * 255);
      data[o + 1] = Math.round((-dhy / length * 0.5 + 0.5) * 255);
      data[o + 2] = Math.round((1 / length * 0.5 + 0.5) * 255);
      data[o + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, MAP_SIZE, MAP_SIZE, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/** Drift of the wave field, in map tiles per second. */
const DRIFT_U = 0.021;
const DRIFT_V = 0.034;

export interface WaterMaterial {
  readonly material: THREE.MeshStandardMaterial;
  /** Advances the wave scroll. Called once per rendered frame. */
  advance(dt: number): void;
  dispose(): void;
}

export function createWaterMaterial(): WaterMaterial {
  const normalMap = createWaveNormalMap();
  const material = new THREE.MeshStandardMaterial({
    // The mesh bakes depth into an RGBA colour attribute: shoreline alpha, shallow
    // tint and foam all arrive as vertex data, so none of them costs a shader or a
    // depth read. See world/water.ts.
    vertexColors: true,
    transparent: true,
    // Water is drawn after the opaque pass and is convex from above, so depth writes
    // buy nothing and would make its own foam band sort against itself.
    depthWrite: false,
    roughness: 0.13,
    metalness: 0,
    normalMap,
    envMapIntensity: 1.25,
    // BOTH SIDES, and this is the difference between a lake and nothing at all. The
    // mirage sheet stands a few metres above the road (render/mirage-lake.ts), so a
    // driver's 1.6 m eye looks UP at it: with `FrontSide` every polygon is back-facing
    // and the water is invisible, which is exactly what the first drive showed — a palm
    // grove on the skyline and no water under it. Seen edge-on from just below, the
    // sheet reads as the bright band of an inferior mirage, which is what it is.
    side: THREE.DoubleSide,
  });
  material.normalScale.set(0.5, 0.5);

  return {
    material,
    advance(dt: number): void {
      const offset = normalMap.offset;
      // Wrapped to keep the offset small: a session-long accumulation eventually
      // quantises the scroll in f32.
      offset.x = (offset.x + DRIFT_U * dt) % 1;
      offset.y = (offset.y + DRIFT_V * dt) % 1;
    },
    dispose(): void {
      normalMap.dispose();
      material.dispose();
    },
  };
}
