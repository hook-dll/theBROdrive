import * as THREE from 'three';

/**
 * `WebGLRenderer.compileAsync`, safe against a material freed while it links.
 *
 * Three's own polls every material it compiled until its program reports ready, and
 * reads `currentProgram.isReady()` with no guard. A material disposed in the meantime
 * has no program any more, and the poll throws from a timer, uncaught: "Cannot read
 * properties of undefined (reading 'isReady')". The title room did that whenever New
 * game was pressed before its programs had linked: the room and the calendar
 * photograph's studio were disposed under the poll.
 *
 * This is the same wait, with a freed (or never prepared) material counted as done.
 * Links exactly what `compileAsync` would (it calls the same `compile`), so the
 * shader-variant anchors are unaffected.
 */
export function compileAsyncSafe(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Object3D,
  camera: THREE.Camera,
  targetScene: THREE.Scene | null = null,
): Promise<THREE.Object3D> {
  const pending = renderer.compile(scene, camera, targetScene);
  return new Promise((resolve) => {
    const check = (): void => {
      for (const material of pending) {
        const program = (renderer.properties.get(material) as { currentProgram?: { isReady(): boolean } }).currentProgram;
        if (!program || program.isReady()) pending.delete(material);
      }
      if (pending.size === 0) resolve(scene);
      else setTimeout(check, 10);
    };
    check();
  });
}
