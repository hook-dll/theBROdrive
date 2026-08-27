import * as THREE from 'three';
import { Body } from 'astronomy-engine';
import type { CelestialFrame } from './astronomy';

const PLANET_RADIUS = 2785;
const COLORS: Record<string, number> = {
  [Body.Mercury]: 0xd8cfbd,
  [Body.Venus]: 0xfff1c2,
  [Body.Mars]: 0xff8b58,
  [Body.Jupiter]: 0xffddb0,
  [Body.Saturn]: 0xf4d7a1,
  [Body.Uranus]: 0xb8edf0,
  [Body.Neptune]: 0x8faeff,
};

const VERTEX = /* glsl */ `
attribute vec3 aColor;
attribute float aMagnitude;
varying vec3 vColor;
varying float vFlux;
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  float altitude = asin(clamp(normalize(position).y, -1.0, 1.0));
  float altitudeDeg = degrees(altitude);
  float airMass = altitudeDeg > -1.0
    ? 1.0 / (sin(max(altitude, radians(-0.99))) + 0.50572 * pow(max(0.01, altitudeDeg + 6.07995), -1.6364))
    : 100.0;
  float observedMagnitude = aMagnitude + 0.2 * max(0.0, airMass - 1.0);
  vFlux = pow(10.0, -0.4 * observedMagnitude) * smoothstep(radians(-0.6), radians(0.15), altitude);
  vColor = aColor;
  gl_Position = projectionMatrix * mvPosition;
  gl_Position.z = gl_Position.w;
  gl_PointSize = clamp(1.4 + max(0.0, 2.0 - observedMagnitude) * 0.55, 1.4, 5.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform float uExposure;
varying vec3 vColor;
varying float vFlux;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float r2 = dot(p, p);
  if (r2 > 0.25) discard;
  float energy = vFlux * uExposure * 18.0;
  float alpha = min(1.0, energy * exp(-r2 * 16.0));
  gl_FragColor = vec4(vColor, alpha);
}
`;

export class PlanetField {
  readonly points: THREE.Points;
  private readonly positions: THREE.BufferAttribute;
  private readonly magnitudes: THREE.BufferAttribute;
  private readonly material: THREE.ShaderMaterial;

  constructor() {
    const positionValues = new Float32Array(7 * 3);
    const magnitudeValues = new Float32Array(7);
    const colorValues = new Float32Array(7 * 3);
    const color = new THREE.Color();
    const bodies = [Body.Mercury, Body.Venus, Body.Mars, Body.Jupiter, Body.Saturn, Body.Uranus, Body.Neptune];
    for (let i = 0; i < bodies.length; i++) {
      color.setHex(COLORS[bodies[i]]);
      colorValues[i * 3] = color.r;
      colorValues[i * 3 + 1] = color.g;
      colorValues[i * 3 + 2] = color.b;
    }
    const geometry = new THREE.BufferGeometry();
    this.positions = new THREE.BufferAttribute(positionValues, 3);
    this.magnitudes = new THREE.BufferAttribute(magnitudeValues, 1);
    geometry.setAttribute('position', this.positions);
    geometry.setAttribute('aMagnitude', this.magnitudes);
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colorValues, 3));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { uExposure: { value: 0 } },
      depthWrite: false,
      transparent: true,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = -7;
  }

  update(frame: CelestialFrame, exposure: number): void {
    for (let i = 0; i < frame.planets.length; i++) {
      const planet = frame.planets[i];
      this.positions.setXYZ(
        i,
        planet.direction.x * PLANET_RADIUS,
        planet.direction.y * PLANET_RADIUS,
        planet.direction.z * PLANET_RADIUS,
      );
      this.magnitudes.setX(i, planet.magnitude);
    }
    this.positions.needsUpdate = true;
    this.magnitudes.needsUpdate = true;
    this.material.uniforms.uExposure.value = exposure;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
