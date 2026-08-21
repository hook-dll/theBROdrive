import * as THREE from 'three';

/**
 * Renderer, scene and camera ownership.
 *
 * The far plane and fog are set up for the far-orbit camera: zooming out to a few
 * hundred metres means the horizon must still resolve, so the far plane is 4 km and
 * fog is exponential rather than linear. Linear fog over that range either erases
 * the middle distance or leaves the horizon looking like a flat card.
 */

/** Far plane in metres. Must exceed the maximum camera distance by a wide margin. */
export const CAMERA_FAR = 4000;
export const CAMERA_NEAR = 0.08;

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly fog: THREE.FogExp2;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.camera = new THREE.PerspectiveCamera(
      68,
      window.innerWidth / window.innerHeight,
      CAMERA_NEAR,
      CAMERA_FAR,
    );

    // Density is retuned per frame from the sky gradient's haze value.
    this.fog = new THREE.FogExp2(0xd8c39a, 0.00035);
    this.scene.fog = this.fog;

    this.resize();
    window.addEventListener('resize', this.resize);
  }

  dispose(): void {
    window.removeEventListener('resize', this.resize);
    this.renderer.dispose();
  }

  private resize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  };

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
