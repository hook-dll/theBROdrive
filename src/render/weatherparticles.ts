import * as THREE from 'three';
import { weather } from '../world/weather';
import { SandColor } from './desertdust';

/**
 * PARTICLES OF WEATHER: rain, flying dust, and sand streaming along the ground.
 *
 * One instanced quad per particle in a box that travels with the camera, the classic
 * rain-box: each particle's place is its seed times the box, minus how far the air
 * has flowed, minus where the camera is — all folded back into the box with `mod`.
 * So a particle is fixed in the moving AIR, not on the screen: driving into rain
 * brings the streaks at you, turning pans across them, and a parked car watches them
 * fall past. Nothing is simulated or uploaded per frame; the CPU writes one pan
 * vector and one velocity.
 *
 * WHY STREAKS AND NOT DROPS. A raindrop is a millimetre wide and moves 9 m/s; what the
 * eye (and a camera) sees is its path during one look, a streak along its velocity
 * RELATIVE TO THE VIEWER. That same rule gives slanting rain in a crosswind, rain that
 * rushes at the windscreen at speed and hangs almost vertical when parked, and dust
 * that shoots past in a haboob as lines rather than as confetti. Width is held at a
 * pixel or so at every distance, so near streaks do not become grey planks.
 *
 * COST. Three draw calls at most, each skipped entirely while its weather is absent;
 * the instance count follows the intensity, so a drizzle costs a fraction of a
 * downpour. Drawn in the scene pass, depth-tested, so the car and the ground occlude
 * them and the ink pass never sees them as edges (they are too faint to trip it).
 */

interface LayerSpec {
  /** Most particles at full intensity. */
  readonly count: number;
  /** Box extents around the camera, metres. */
  readonly box: THREE.Vector3;
  /** 0 = thin streak, 1 = soft puff. */
  readonly puff: number;
  /** Streak exposure, seconds: how much of its path one frame shows. */
  readonly shutter: number;
  /** Minimum and maximum visible length, metres. */
  readonly minLength: number;
  readonly maxLength: number;
  /** Width in pixels at any distance, and a physical floor in metres. */
  readonly widthPx: number;
  readonly widthM: number;
  /** Peak opacity. */
  readonly alpha: number;
  /** Hug the ground: particles live in a band this tall above `groundY`. 0 = free. */
  readonly groundBand: number;
}

const VERTEX = /* glsl */ `
attribute vec4 aSeed;
uniform vec3 uBox;
uniform vec3 uPan;
uniform vec3 uCamera;
uniform vec3 uVelocity;
uniform float uShutter;
uniform vec2 uLength;
uniform float uWidthPx;
uniform float uWidthM;
uniform float uPixel;
uniform float uGroundBand;
uniform float uGroundY;
uniform float uPuff;
varying float vFade;
varying vec2 vQuad;
varying float vFog;

void main() {
  // Where this particle is in the air, relative to the camera, folded into the box.
  vec3 local = mod(aSeed.xyz * uBox - uPan, uBox) - uBox * 0.5;
  vec3 centre = uCamera + local;
  if (uGroundBand > 0.0) {
    // Ground-hugging: height is the seed within a band above the ground, bunched low.
    centre.y = uGroundY + aSeed.y * aSeed.y * uGroundBand;
  }
  // Fade the faces of the box so the wrap never pops, and the lens so a particle
  // never fills the screen.
  vec3 edge = abs(local) / (uBox * 0.5);
  float box = 1.0 - smoothstep(0.6, 1.0, max(edge.x, max(uGroundBand > 0.0 ? 0.0 : edge.y, edge.z)));
  vec3 toEye = centre - cameraPosition;
  float dist = length(toEye);
  float nearFade = smoothstep(0.6, 2.2, dist);
  vFade = box * nearFade * (0.55 + 0.45 * aSeed.w);

  float speed = length(uVelocity);
  vec3 along = speed > 1e-3 ? uVelocity / speed : vec3(0.0, -1.0, 0.0);
  float len = clamp(speed * uShutter, uLength.x, uLength.y) * (0.7 + 0.6 * aSeed.w);
  vec3 across = normalize(cross(along, toEye / max(dist, 1e-3)) + vec3(1e-5, 0.0, 0.0));
  float width = max(uWidthM, uWidthPx * uPixel * dist) * (uPuff > 0.5 ? (0.6 + 1.4 * aSeed.w) : 1.0);
  // Puffs are round-ish blobs stretched along the flow; streaks are lines.
  float span = uPuff > 0.5 ? max(len, width * 2.0) : len;
  vec3 world = centre + along * (position.y - 0.5) * span + across * position.x * width;
  vQuad = vec2(position.x, position.y * 2.0 - 1.0);
  vec4 view = viewMatrix * vec4(world, 1.0);
  vFog = -view.z;
  gl_Position = projectionMatrix * view;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uPuff;
uniform vec3 uFogColor;
uniform float uFogDensity;
varying float vFade;
varying vec2 vQuad;
varying float vFog;

void main() {
  float shape = uPuff > 0.5
    ? (1.0 - smoothstep(0.2, 1.0, length(vQuad)))
    : (1.0 - abs(vQuad.x)) * (1.0 - smoothstep(0.6, 1.0, abs(vQuad.y)));
  float a = shape * vFade * uAlpha;
  if (a < 0.003) discard;
  float fogAmount = 1.0 - exp(-uFogDensity * uFogDensity * vFog * vFog);
  gl_FragColor = vec4(mix(uColor, uFogColor, fogAmount), a * (1.0 - fogAmount * 0.7));
}
`;

class Layer {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private readonly geometry: THREE.InstancedBufferGeometry;
  /** Accumulated flow of the air, metres, kept reduced into the box in f64. */
  private readonly flow = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private readonly spec: LayerSpec,
    seed: number,
  ) {
    const base = new THREE.PlaneGeometry(2, 1, 1, 1);
    base.translate(0, 0.5, 0);
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.index = base.index;
    this.geometry.setAttribute('position', base.getAttribute('position'));
    const seeds = new Float32Array(spec.count * 4);
    let h = seed >>> 0 || 1;
    for (let i = 0; i < seeds.length; i++) {
      // xorshift: seeds only need to be well spread, and this keeps the module free
      // of a dependency on the world's hash just to lay out rain.
      h ^= h << 13;
      h ^= h >>> 17;
      h ^= h << 5;
      seeds[i] = ((h >>> 0) % 100_000) / 100_000;
    }
    this.geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    this.geometry.instanceCount = 0;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      // The quad is built from the flow and view directions, so its winding follows
      // whichever way the particle moves: both faces are the front.
      side: THREE.DoubleSide,
      uniforms: {
        uBox: { value: spec.box.clone() },
        uPan: { value: new THREE.Vector3() },
        uCamera: { value: new THREE.Vector3() },
        uVelocity: { value: new THREE.Vector3() },
        uShutter: { value: spec.shutter },
        uLength: { value: new THREE.Vector2(spec.minLength, spec.maxLength) },
        uWidthPx: { value: spec.widthPx },
        uWidthM: { value: spec.widthM },
        uPixel: { value: 0.001 },
        uGroundBand: { value: spec.groundBand },
        uGroundY: { value: 0 },
        uPuff: { value: spec.puff },
        uColor: { value: new THREE.Color() },
        uAlpha: { value: 0 },
        uFogColor: { value: new THREE.Color() },
        uFogDensity: { value: 0 },
      },
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    // After the opaque world and the sky, before nothing else that is transparent
    // cares: these are faint enough that their order among themselves is invisible.
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
  }

  /**
   * `airVelocity` is the air's own motion in the world (wind, and the fall of rain),
   * `viewerVelocity` the camera's, both m/s. `absCamera` is the camera in absolute
   * world metres (f64), `relCamera` the same point in the scene's rebased frame.
   */
  update(
    intensity: number,
    dt: number,
    airVelocity: THREE.Vector3,
    viewerVelocity: THREE.Vector3,
    absCamera: THREE.Vector3,
    relCamera: THREE.Vector3,
    groundY: number,
    pixel: number,
    color: THREE.Color,
    fog: THREE.FogExp2,
  ): void {
    const count = Math.floor(this.spec.count * Math.min(1, intensity));
    this.mesh.visible = count > 0;
    this.geometry.instanceCount = count;
    if (count === 0) return;
    const box = this.spec.box;
    this.flow.addScaledVector(airVelocity, dt);
    this.flow.set(wrap(this.flow.x, box.x), wrap(this.flow.y, box.y), wrap(this.flow.z, box.z));
    const u = this.material.uniforms;
    (u.uPan.value as THREE.Vector3).set(
      wrap(absCamera.x - this.flow.x, box.x),
      wrap(absCamera.y - this.flow.y, box.y),
      wrap(absCamera.z - this.flow.z, box.z),
    );
    (u.uCamera.value as THREE.Vector3).copy(relCamera);
    (u.uVelocity.value as THREE.Vector3).copy(airVelocity).sub(viewerVelocity);
    u.uPixel.value = pixel;
    u.uGroundY.value = groundY;
    (u.uColor.value as THREE.Color).copy(color);
    u.uAlpha.value = this.spec.alpha * Math.min(1, 0.35 + 0.65 * intensity);
    (u.uFogColor.value as THREE.Color).copy(fog.color);
    u.uFogDensity.value = fog.density;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}

function wrap(v: number, period: number): number {
  return v - period * Math.floor(v / period);
}

/** Terminal velocity of a raindrop, m/s. */
const RAIN_FALL_MPS = 8.5;

export class WeatherParticles {
  private readonly rain: Layer;
  private readonly dust: Layer;
  private readonly drift: Layer;
  private readonly air = new THREE.Vector3();
  private readonly viewer = new THREE.Vector3();
  private readonly lastCamera = new THREE.Vector3();
  private hasLast = false;
  private readonly abs = new THREE.Vector3();
  private readonly colour = new THREE.Color();
  private readonly scratch = new THREE.Vector3();
  private readonly world = new THREE.Vector3();

  constructor(scene: THREE.Scene, seed: number) {
    this.rain = new Layer(scene, {
      count: 9000,
      box: new THREE.Vector3(36, 20, 36),
      puff: 0,
      shutter: 0.032,
      minLength: 0.45,
      maxLength: 1.5,
      widthPx: 1.3,
      widthM: 0.004,
      alpha: 0.5,
      groundBand: 0,
    }, seed ^ 0x5241494e);
    this.dust = new Layer(scene, {
      count: 2200,
      box: new THREE.Vector3(56, 22, 56),
      puff: 1,
      shutter: 0.06,
      minLength: 0.6,
      maxLength: 3.5,
      widthPx: 1.5,
      widthM: 0.5,
      alpha: 0.16,
      groundBand: 0,
    }, seed ^ 0x44555354);
    this.drift = new Layer(scene, {
      count: 3200,
      box: new THREE.Vector3(44, 1, 44),
      puff: 0,
      shutter: 0.08,
      minLength: 0.4,
      maxLength: 2.2,
      widthPx: 1.6,
      widthM: 0.03,
      alpha: 0.24,
      groundBand: 0.7,
    }, seed ^ 0x44524946);
  }

  /**
   * `camera` is the render camera (scene-relative), `originX/Z` the rebase origin.
   * `groundY` is the scene height of the ground under the camera; `fog` the scene's.
   */
  update(
    dt: number,
    camera: THREE.PerspectiveCamera,
    originX: number,
    originZ: number,
    groundY: number,
    drawHeight: number,
    fog: THREE.FogExp2,
    daylight: number,
    skyColor: THREE.Color,
  ): void {
    // World position, not `camera.position`: the camera may hang off a rig.
    const rel = camera.getWorldPosition(this.world);
    this.abs.set(rel.x + originX, rel.y, rel.z + originZ);
    // Viewer velocity from the camera's own motion, rebase-proof because it is taken
    // in absolute metres; lightly smoothed so a camera spring does not shake the rain.
    if (this.hasLast && dt > 1e-4) {
      this.scratch.subVectors(this.abs, this.lastCamera).divideScalar(dt);
      if (this.scratch.lengthSq() > 90 * 90) this.scratch.set(0, 0, 0);
      this.viewer.lerp(this.scratch, Math.min(1, dt * 12));
    }
    this.lastCamera.copy(this.abs);
    this.hasLast = true;

    const pixel = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(1, drawHeight);
    const w = weather;
    const windX = w.windX * w.windMps;
    const windZ = w.windZ * w.windMps;
    // Everything is lit by the sky it falls through: bright streaks against a dark
    // deck by day, faint grey ones by night, a white flash when lightning goes.
    const light = 0.06 + 0.94 * daylight;

    this.air.set(windX * 0.8, -RAIN_FALL_MPS, windZ * 0.8);
    this.colour.copy(skyColor).lerp(WHITE, 0.45).multiplyScalar(0.8 * light + w.flash * 0.8);
    this.rain.update(w.rain, dt, this.air, this.viewer, this.abs, rel, groundY, pixel, this.colour, fog);

    this.air.set(windX, 0.6, windZ);
    // Flying dust is the fog's own colour, lifted toward lit sand so a clot of it
    // reads against the murk it is part of.
    this.colour.copy(fog.color).lerp(SAND, 0.35 * light);
    this.dust.update(Math.max(w.dust * 1.1, w.drift * w.wind * 0.3), dt, this.air, this.viewer, this.abs, rel, groundY, pixel, this.colour, fog);

    this.air.set(windX * 1.15, 0, windZ * 1.15);
    this.colour.copy(SAND).multiplyScalar(0.35 + 0.65 * light);
    this.drift.update(w.drift * Math.min(1, w.windMps / 8), dt, this.air, this.viewer, this.abs, rel, groundY, pixel, this.colour, fog);
  }

  dispose(): void {
    this.rain.dispose();
    this.dust.dispose();
    this.drift.dispose();
  }
}

const WHITE = new THREE.Color(1, 1, 1);
/** Blown sand, carried round the palette with the ground it blows off. */
const SAND = new SandColor(new THREE.Color().setStyle('#e0b884')).value;
