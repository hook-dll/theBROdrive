import type * as THREE from 'three';

/**
 * `uniform float sceneFrameHeight`: the height in device pixels of the target the scene
 * is drawn into, 0 until the renderer first sizes it. For patches that need a pixel's
 * size: the pole line's wires never fall below a pixel wide (world/props/poles.ts
 * `wireMaterial`). A uniform OBJECT handed to every program by reference, so the one
 * write in `setSceneFrameHeight` reaches all of them.
 */
export const sceneFrameHeight: THREE.IUniform<number> = { value: 0 };

/** The scene frame's height in device pixels. */
export function setSceneFrameHeight(heightPx: number): void {
  sceneFrameHeight.value = heightPx;
}
