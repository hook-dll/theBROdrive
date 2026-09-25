import type * as THREE from 'three';

/**
 * `renderer.compileAsync`, without its crash. Three polls every compiled material's
 * program until it is ready, and a material disposed while it waits — the streamer
 * unloads chunks and tiles all through the boot — has no program left: three threw
 * reading `isReady` of undefined and the boot or the car it was warming never came.
 * Here a material with no program is simply done.
 */
export function compileSafely(
  renderer: THREE.WebGLRenderer,
  object: THREE.Object3D,
  camera: THREE.Camera,
  lightsFrom: THREE.Scene | null = null,
): Promise<void> {
  const materials = renderer.compile(object, camera, lightsFrom);
  return new Promise((resolve) => {
    const check = (): void => {
      for (const material of materials) {
        const program = (renderer.properties.get(material) as { currentProgram?: { isReady(): boolean } })
          .currentProgram;
        if (!program || program.isReady()) materials.delete(material);
      }
      if (materials.size === 0) resolve();
      else setTimeout(check, 10);
    };
    check();
  });
}
