import * as THREE from 'three';
import type { GraphicsQuality } from '../game/settings';

const CATALOG_URL = '/data/tycho2.bin';
const MAGIC = 'TBR1';
const RECORD_FLOATS = 6;
const RECORD_BYTES = RECORD_FLOATS * 4;
const J2000_MILLISECONDS = Date.UTC(2000, 0, 1, 12);
const JULIAN_YEAR_MILLISECONDS = 365.25 * 86_400_000;
const MAS_TO_RAD = Math.PI / (180 * 3_600_000);
const STAR_RADIUS = 2790;

/**
 * How deep each tier's sky goes, as a limiting visual magnitude.
 *
 * The catalogue file is SORTED BY MAGNITUDE, so a limit is a prefix of it and a
 * tier change is one `setDrawRange` — no refetch, no rebuilt buffers, no shader
 * recompile, and the switch lands on the next frame rather than the next load.
 * Everything past the prefix is still resident on the GPU, which is the point:
 * the whole file is uploaded once and the draw range decides how much sky is
 * spent per frame.
 *
 * Magnitude 8 is naked-eye-plus: about 45,600 stars, the deepest a Tycho-2 cut
 * stays cheap at. `blessing` runs to 8.5, which is where this data's photometry
 * is still colour-complete (see tools/build-star-catalog.mjs) and which adds
 * roughly 32,000 more — the faint grain between the constellations that makes a
 * desert sky read as crowded rather than plotted.
 */
const MAGNITUDE_LIMIT: Record<GraphicsQuality, number> = {
  acceptable: 8,
  standard: 8,
  blessing: 8.5,
};

const STAR_VERTEX = /* glsl */ `
attribute vec3 aColor;
attribute float aMagnitude;
uniform vec3 uMoonDir;
uniform float uMoonAngularRadius;
varying vec3 vColor;
varying float vFlux;

varying float vMoonMask;
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vec3 worldDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  float altitude = asin(clamp(worldDir.y, -1.0, 1.0));
  float altitudeDeg = degrees(altitude);
  float airMass = altitudeDeg > -1.0
    ? 1.0 / (sin(max(altitude, radians(-0.99))) + 0.50572 * pow(max(0.01, altitudeDeg + 6.07995), -1.6364))
    : 100.0;
  float extinctionMag = 0.2 * max(0.0, airMass - 1.0);
  float observedMagnitude = aMagnitude + extinctionMag;
  // Point centers need no angular antialiasing: mask only stars actually behind
  // the lunar disk. A fixed smoothstep width erased a ring of sky around it.
  vMoonMask = step(
    cos(uMoonAngularRadius * 1.05),
    dot(worldDir, uMoonDir)
  );
  vFlux = pow(10.0, -0.4 * observedMagnitude) * smoothstep(radians(-0.6), radians(0.15), altitude);
  vColor = aColor;
  gl_Position = projectionMatrix * mvPosition;
  gl_Position.z = gl_Position.w;
  // At least three device pixels across. A 1.5 px point alternated between one and
  // four covered pixels as the celestial sphere moved, making faint stars jump from
  // black to full brightness. An integer-sized footprint keeps total energy stable.
  gl_PointSize = clamp(3.0 + max(0.0, 2.0 - observedMagnitude) * 0.45, 3.0, 5.0);
}
`;

const STAR_FRAGMENT = /* glsl */ `
uniform float uExposure;
uniform float uSkyVisibility;
varying vec3 vColor;
varying float vFlux;
varying float vMoonMask;

void main() {
  vec2 p = gl_PointCoord - 0.5;
  float r2 = dot(p, p);
  if (r2 > 0.25) discard;
  float psf = exp(-r2 * 12.0);
  // The wider footprint carries roughly three times the pixel area of the old
  // 1.5 px point, so reduce per-pixel gain to retain catalogue brightness without
  // restoring the saturated white/black flicker.
  float energy = vFlux * uExposure * uSkyVisibility * 60.0;
  float alpha = min(1.0, energy * psf) * (1.0 - vMoonMask);
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(vColor, alpha);
}
`;
function blackbodyColor(bv: number, out: THREE.Color): void {
  const temperature = 4600 * (
    1 / (0.92 * bv + 1.7) +
    1 / (0.92 * bv + 0.62)
  );
  const t = temperature / 100;
  let r: number;
  let g: number;
  let b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(Math.max(t, 1)) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  out.setRGB(
    THREE.MathUtils.clamp(r / 255, 0, 1),
    THREE.MathUtils.clamp(g / 255, 0, 1),
    THREE.MathUtils.clamp(b / 255, 0, 1),
    THREE.SRGBColorSpace,
  );
  const luminance = out.r * 0.2126 + out.g * 0.7152 + out.b * 0.0722;
  if (luminance > 0) out.multiplyScalar(1 / luminance);
}

export class StarField {
  readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;
  /**
   * Magnitude of each star, in file order. Kept because the draw range for a tier
   * is found by searching it, and the search has to be exact: an off-by-one prefix
   * silently drops a star from the sky or draws one the tier did not ask for.
   */
  private readonly sortedMagnitudes: Float32Array;

  constructor(buffer: ArrayBuffer, epoch: Date, quality: GraphicsQuality) {
    const view = new DataView(buffer);
    const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
    if (magic !== MAGIC) throw new Error(`Unsupported star catalogue: ${magic}`);
    const count = view.getUint32(4, true);
    if (buffer.byteLength !== 8 + count * RECORD_BYTES) {
      throw new Error('Star catalogue length does not match its header');
    }

    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const magnitudes = new Float32Array(count);
    const years = (epoch.getTime() - J2000_MILLISECONDS) / JULIAN_YEAR_MILLISECONDS;
    const color = new THREE.Color();
    let offset = 8;
    for (let i = 0; i < count; i++) {
      let ra = view.getFloat32(offset, true); offset += 4;
      let dec = view.getFloat32(offset, true); offset += 4;
      const pmRa = view.getFloat32(offset, true); offset += 4;
      const pmDec = view.getFloat32(offset, true); offset += 4;
      const magnitude = view.getFloat32(offset, true); offset += 4;
      const bv = view.getFloat32(offset, true); offset += 4;
      // The prefix trick below is only a magnitude cut if the file is ordered.
      if (i > 0 && magnitude < magnitudes[i - 1]) {
        throw new Error('Star catalogue is not sorted by magnitude');
      }
      dec += pmDec * years * MAS_TO_RAD;
      ra += (pmRa * years * MAS_TO_RAD) / Math.max(0.01, Math.cos(dec));
      const cosDec = Math.cos(dec);
      positions[i * 3] = Math.cos(ra) * cosDec * STAR_RADIUS;
      positions[i * 3 + 1] = Math.sin(ra) * cosDec * STAR_RADIUS;
      positions[i * 3 + 2] = Math.sin(dec) * STAR_RADIUS;
      blackbodyColor(bv, color);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
      magnitudes[i] = magnitude;
    }
    this.sortedMagnitudes = magnitudes;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aMagnitude', new THREE.BufferAttribute(magnitudes, 1));
    this.material = new THREE.ShaderMaterial({
      vertexShader: STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
      uniforms: {
        uExposure: { value: 1 },
        uSkyVisibility: { value: 0 },
        uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
        uMoonAngularRadius: { value: 0.0045 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = -8;
    this.points.matrixAutoUpdate = false;
    this.setQuality(quality);
  }

  /**
   * Chooses how faint this tier's sky goes. Every star stays resident; only the
   * draw range moves, so this is a per-frame-cost change and nothing else — safe
   * to call from the settings menu with the sky already on screen.
   */
  setQuality(quality: GraphicsQuality): void {
    const limit = MAGNITUDE_LIMIT[quality];
    const magnitudes = this.sortedMagnitudes;
    // Upper bound of the prefix, by bisection: the count of stars at or brighter
    // than the limit. Two tiers share a limit, so this runs at most twice a session.
    let low = 0;
    let high = magnitudes.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (magnitudes[mid] <= limit) low = mid + 1;
      else high = mid;
    }
    this.points.geometry.setDrawRange(0, low);
  }

  /** Stars the current tier draws. Read by tools and the dev hook, not the loop. */
  get drawnCount(): number {
    return this.points.geometry.drawRange.count;
  }

  update(
    rotation: THREE.Matrix4,
    exposure: number,
    skyVisibility: number,
    moonDirection: THREE.Vector3,
    moonAngularRadius: number,
  ): void {
    this.points.matrix.copy(rotation);
    this.points.matrixWorldNeedsUpdate = true;
    this.material.uniforms.uExposure.value = exposure;
    this.material.uniforms.uSkyVisibility.value = skyVisibility;
    this.material.uniforms.uMoonDir.value.copy(moonDirection);
    this.material.uniforms.uMoonAngularRadius.value = moonAngularRadius;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}

export async function loadStarField(
  epoch: Date,
  quality: GraphicsQuality,
): Promise<StarField> {
  const response = await fetch(CATALOG_URL);
  if (!response.ok) throw new Error(`Star catalogue failed to load: HTTP ${response.status}`);
  return new StarField(await response.arrayBuffer(), epoch, quality);
}
