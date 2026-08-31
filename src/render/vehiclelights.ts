import * as THREE from 'three';

/**
 * The six renderer lights shared by whichever vehicle the player is driving.
 * Vehicles own only local lamp geometry and emissive lenses, never scene lights.
 */
export class VehicleLightRig {
  private readonly lights: THREE.SpotLight[];
  readonly lightCount = 6;

  constructor(private readonly scene: THREE.Scene) {
    this.lights = Array.from({ length: this.lightCount }, () => {
      const light = new THREE.SpotLight(0xffffff, 0);
      light.castShadow = false;
      scene.add(light, light.target);
      return light;
    });
  }

  clear(): void {
    for (const light of this.lights) light.intensity = 0;
  }

  setBeam(
    slot: number,
    sourceWorld: THREE.Vector3,
    targetWorld: THREE.Vector3,
    color: THREE.ColorRepresentation,
    intensity: number,
    distance: number,
    angle: number,
    penumbra: number,
    decay: number,
  ): void {
    const light = this.lights[slot];
    if (!light) throw new RangeError(`Invalid vehicle light slot: ${slot}`);
    light.position.copy(sourceWorld);
    light.target.position.copy(targetWorld);
    light.color.set(color);
    light.intensity = intensity;
    light.distance = distance;
    light.angle = angle;
    light.penumbra = penumbra;
    light.decay = decay;
  }

  dispose(): void {
    this.clear();
    for (const light of this.lights) {
      this.scene.remove(light, light.target);
    }
  }
}
