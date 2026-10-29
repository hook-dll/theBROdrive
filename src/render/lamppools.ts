import * as THREE from 'three';

import { desertPaletteAt } from '../world/gradient';
import type { RebaseShift, WorldOrigin } from '../world/origin';

/**
 * THE SECOND TIER OF LAMP LIGHT: a lamp without a spotlight slot still lights the ground.
 *
 * The renderer's spot slots are few and fixed (render/vehiclelights.ts): measured on a
 * night drive with normal traffic, 23-31 beams wanted one at the median and up to 47,
 * against 11 slots. A lamp refused a slot used to lay NO light at all: its lens glowed and
 * the road under it stayed night. Each lamp without a slot now lays a POOL instead: a
 * soft additive patch on the ground under its beam, shaded per pixel by the same spot,
 * range and incidence terms three's own spotlight uses, so a beam handed from its pool to
 * a slot (or back) by the slot pool's fade (render/slotpool.ts) neither steps nor shifts.
 * What a pool cannot do is light anything standing in the beam: a car, a post. That is
 * what the slots are spent on (main.ts ranks the headlamps by `LampView`), and the tail,
 * stop and reversing lamps of every car but the driven one are pools only: their light is
 * a few metres of ground.
 *
 * ONE DRAW CALL. Every pool is a grid of `POOL_ROWS` x `POOL_COLS` vertices in one
 * geometry, rewritten each frame in place like the contact patches
 * (render/contactpatches.ts); the draw range says how many are live. The grid lies on the
 * ground: the rows near the car on its own tyre contact plane, the far rows of a
 * headlamp's pool where the beam is this frame at the terrain's height, sampled by the
 * caller (`takeSamples`, `groundHeight`) when the car has moved on, and the whole pool's
 * depth pulled toward the eye so the coarse grid never sinks into what it lights.
 *
 * WHAT IT LIGHTS. A pool adds light, so it carries the reflectance of the ground under
 * it, and the ground under a headlamp's pool is two: dark asphalt and the sand either
 * side, which takes the same beam five times brighter. Every vertex carries its signed
 * distance from the road's centreline, linear across a pool on a road straight enough to
 * see, and the shader picks asphalt or the desert's sand there by the road's half-width.
 */

/** Rows of a pool's grid, along the beam; the first is just behind the lamp. */
export const POOL_ROWS = 6;
/** Columns of a pool's grid, across the beam: left edge, axis, right edge. */
export const POOL_COLS = 3;
export const POOL_VERTS = POOL_ROWS * POOL_COLS;
/** Pools in the field: every lit group of about twenty cars. */
const POOL_CAPACITY = 64;
/**
 * Floats per vertex in the one interleaved buffer: position, lamp A, lamp B, beam axis,
 * colour (3 each), the beam's cone cosine, penumbra cosine, decay and cutoff, then the
 * vertex's road lateral and the road's half-width.
 */
const STRIDE = 21;
/** Floats per vertex of the grids callers pass: position and road lateral. */
export const POOL_GRID_STRIDE = 4;
/** Lift off the ground, metres, besides the polygon offset: the far rows are chords. */
export const POOL_LIFT_M = 0.05;
/**
 * The depth pull toward the eye (see the vertex shader): this much at the eye plus this
 * share of the distance, so 0.3 m at 10 m, 0.6 m at 30 m and 1.3 m at 75 m.
 */
const POOL_PULL_NEAR_M = 0.15;
const POOL_PULL_PER_M = 0.015;
/**
 * The reflectance a pool's light lands on, asphalt and sand, as the ground's own shading
 * shows a spotlight's at night (the comic banding, render/comic.ts, takes about half of a
 * dim light away). Matched by screenshot: the same lamp as a slot and as a pool, on the
 * road and on the sand beside it. Sand is the desert's own colour at the road's arclength
 * (world/gradient.ts) times `SAND_ALBEDO_SCALE`.
 */
const ROAD_ALBEDO = new THREE.Color(0.1, 0.094, 0.085);
const SAND_ALBEDO_SCALE = 0.8;
/** Metres either side of the asphalt's edge over which the two blend. */
const ROAD_EDGE_BLEND_M = 0.3;
/** Height samples the field allows per frame (`takeSamples`), about 0.15 ms of terrain. */
const SAMPLES_PER_FRAME = 36;

/** Where a point lies in the road's frame. */
export interface PoolRoadFrame {
  s: number;
  /** Signed distance from the centreline, positive LEFT of travel (world/road.ts). */
  lateral: number;
  /** The road's heading at `s`: travel is (sin, cos) in x, z. */
  heading: number;
  halfWidth: number;
}

/** The ground pools lie on, in ABSOLUTE world coordinates. */
export interface PoolGround {
  /** The road frame at a point; `hintS` (finite) makes it a local search. */
  frame(x: number, z: number, hintS: number, out: PoolRoadFrame): PoolRoadFrame;
  /** Ground height at a point whose road arclength is `s`. */
  heightAt(x: number, z: number, s: number): number;
}

const VERTEX = /* glsl */ `
attribute vec2 quad;
attribute vec3 lampA;
attribute vec3 lampB;
attribute vec3 beamAxis;
attribute vec3 beamColor;
attribute vec4 beamShape;
attribute vec2 roadFrame;
varying vec2 vQuad;
varying vec2 vRoad;
varying vec3 vToA;
varying vec3 vToB;
varying vec3 vAxis;
varying vec3 vColor;
varying vec4 vShape;
#include <fog_pars_vertex>

void main() {
  vQuad = quad;
  // Linear across a triangle, since the lamps are constant over the pool: exact.
  vToA = lampA - position;
  vToB = lampB - position;
  vAxis = beamAxis;
  vColor = beamColor;
  vShape = beamShape;
  vRoad = roadFrame;
  vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
  // THE DEPTH IS PULLED TOWARD THE EYE along the view ray (POOL_PULL_*): the screen
  // position is unchanged, but a pool drawn as chords between rows 20-30 m apart, over a
  // road's crown or a race track's asphalt raised over the ground the terrain reports,
  // still lies in front of the ground it lights instead of under it. Anything standing
  // on that ground is metres in front of it along a ray this shallow, and still hides it.
  float eyeDistance = max( length( mvPosition.xyz ), 1e-3 );
  float pull = min( 0.5 * eyeDistance, ${POOL_PULL_NEAR_M.toFixed(2)} + ${POOL_PULL_PER_M.toFixed(3)} * eyeDistance );
  gl_Position = projectionMatrix * vec4( mvPosition.xyz * ( 1.0 - pull / eyeDistance ), 1.0 );
  #include <fog_vertex>
}`;

const FRAGMENT = /* glsl */ `
uniform vec3 uRoadAlbedo;
uniform vec3 uSandAlbedo;
varying vec2 vQuad;
varying vec2 vRoad;
varying vec3 vToA;
varying vec3 vToB;
varying vec3 vAxis;
varying vec3 vColor;
varying vec4 vShape;
#include <fog_pars_fragment>

// Three's spotlight on a Lambert surface (lights_pars_begin: getSpotAttenuation,
// getDistanceAttenuation; render/groundlight.ts: the ground's diffuse), without the colour.
float lampLight( vec3 toLamp, vec3 normal ) {
  float d = max( length( toLamp ), 1e-4 );
  vec3 l = toLamp / d;
  float spot = smoothstep( vShape.x, vShape.y, dot( -l, vAxis ) );
  float falloff = 1.0 / max( pow( d, vShape.z ), 0.01 );
  float r = d / vShape.w;
  r *= r;
  float window = clamp( 1.0 - r * r, 0.0, 1.0 );
  return spot * falloff * window * window * clamp( dot( normal, l ), 0.0, 1.0 );
}

void main() {
  // The ground's own up, not the grid's facets: rows 20-30 m apart made each facet's
  // light a step of its own, and a facet tipped as its rows were resampled. The light
  // under a lamp is the ground's; a pool only reads where the ground is nearly level.
  vec3 normal = vec3( 0.0, 1.0, 0.0 );
  float light = lampLight( vToA, normal ) + lampLight( vToB, normal );
  // The grid only covers where the beam reads; its rim is faded so it never shows.
  float rim = ( 1.0 - smoothstep( 0.7, 1.0, abs( vQuad.y ) ) ) * ( 1.0 - smoothstep( 0.8, 1.0, vQuad.x ) );
  float visibility = 1.0;
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      visibility = exp( -fogDensity * fogDensity * vFogDepth * vFogDepth );
    #else
      visibility = 1.0 - smoothstep( fogNear, fogFar, vFogDepth );
    #endif
  #endif
  float sand = smoothstep( vRoad.y - ${ROAD_EDGE_BLEND_M.toFixed(2)}, vRoad.y + ${ROAD_EDGE_BLEND_M.toFixed(2)}, abs( vRoad.x ) );
  vec3 albedo = mix( uRoadAlbedo, uSandAlbedo, sand );
  // Added to what the ground already shows, as a slot's light would be: Lambert,
  // albedo over pi (render/groundlight.ts).
  gl_FragColor = vec4( vColor * albedo * ( 0.31830989 * light * rim * visibility ), 1.0 );
}`;

export class LampPoolField {
  /** The rig's headlamp reach scale (render/vehiclelights.ts), for a headlamp's cutoff. */
  readonly headlightDistanceScale: number;
  readonly mesh: THREE.Mesh;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly data = new Float32Array(POOL_CAPACITY * POOL_VERTS * STRIDE);
  private readonly buffer: THREE.InterleavedBuffer;
  private readonly unregisterOrigin: () => void;
  /** Pools written this frame; the draw range follows it. */
  private used = 0;
  private samplesLeft = SAMPLES_PER_FRAME;
  /** Counts frames, so a car asks for its road frame once a frame (`frameId`). */
  private frame = 0;
  private readonly sandAlbedo = new THREE.Color();
  private sandArclength = Number.NaN;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly origin: WorldOrigin,
    private readonly ground: PoolGround,
    headlightDistanceScale: number,
  ) {
    this.headlightDistanceScale = headlightDistanceScale;
    const quad = new Float32Array(POOL_CAPACITY * POOL_VERTS * 2);
    const indices = new Uint16Array(POOL_CAPACITY * (POOL_ROWS - 1) * (POOL_COLS - 1) * 6);
    let o = 0;
    for (let p = 0; p < POOL_CAPACITY; p++) {
      const base = p * POOL_VERTS;
      for (let r = 0; r < POOL_ROWS; r++) {
        for (let c = 0; c < POOL_COLS; c++) {
          const v = base + r * POOL_COLS + c;
          quad[v * 2] = r / (POOL_ROWS - 1);
          quad[v * 2 + 1] = c - (POOL_COLS - 1) / 2;
          if (r === POOL_ROWS - 1 || c === POOL_COLS - 1) continue;
          indices[o++] = v;
          indices[o++] = v + POOL_COLS;
          indices[o++] = v + 1;
          indices[o++] = v + 1;
          indices[o++] = v + POOL_COLS;
          indices[o++] = v + POOL_COLS + 1;
        }
      }
    }
    this.buffer = new THREE.InterleavedBuffer(this.data, STRIDE);
    this.buffer.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(this.buffer, 3, 0));
    this.geometry.setAttribute('lampA', new THREE.InterleavedBufferAttribute(this.buffer, 3, 3));
    this.geometry.setAttribute('lampB', new THREE.InterleavedBufferAttribute(this.buffer, 3, 6));
    this.geometry.setAttribute('beamAxis', new THREE.InterleavedBufferAttribute(this.buffer, 3, 9));
    this.geometry.setAttribute('beamColor', new THREE.InterleavedBufferAttribute(this.buffer, 3, 12));
    this.geometry.setAttribute('beamShape', new THREE.InterleavedBufferAttribute(this.buffer, 4, 15));
    this.geometry.setAttribute('roadFrame', new THREE.InterleavedBufferAttribute(this.buffer, 2, 19));
    this.geometry.setAttribute('quad', new THREE.BufferAttribute(quad, 2));
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.ShaderMaterial({
      name: 'lamp-pool',
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        ...THREE.UniformsLib.fog,
        uRoadAlbedo: { value: ROAD_ALBEDO },
        uSandAlbedo: { value: this.sandAlbedo },
      },
      fog: true,
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'lamp-pools';
    // Rewritten every frame; bounds computed once would cull the field wrongly. In the
    // scene from boot, so the boot warm-up links its one program.
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.unregisterOrigin = origin.register(this);
  }

  /** Absolute X of the floating origin: scene = absolute - origin. */
  get originX(): number {
    return this.origin.x;
  }

  get originZ(): number {
    return this.origin.z;
  }

  /** Pools drawn this frame. */
  get poolCount(): number {
    return this.used;
  }

  /** This frame's number; see `frame`. */
  get frameId(): number {
    return this.frame;
  }

  /**
   * Starts a frame's collection at the active road arclength `s`, whose desert colour
   * the sand under the pools takes. Nothing is hidden until `endFrame`.
   */
  beginFrame(s: number): void {
    this.used = 0;
    this.samplesLeft = SAMPLES_PER_FRAME;
    this.frame++;
    if (!(Math.abs(s - this.sandArclength) < 25)) {
      this.sandArclength = s;
      this.sandAlbedo.setHex(desertPaletteAt(s).sand).multiplyScalar(SAND_ALBEDO_SCALE);
    }
  }

  /**
   * Claims `count` terrain samples from this frame's allowance; false when it is spent.
   * The callers' walk starts at a different car each frame (main.ts), so it goes round.
   */
  takeSamples(count: number): boolean {
    if (this.samplesLeft < count) return false;
    this.samplesLeft -= count;
    return true;
  }

  /** The road frame at an absolute world position; a NaN hint searches the whole road. */
  roadFrame(x: number, z: number, hintS: number, out: PoolRoadFrame): PoolRoadFrame {
    return this.ground.frame(x, z, hintS, out);
  }

  /** Ground height at an absolute world position whose road arclength is `s`. */
  groundHeight(x: number, z: number, s: number): number {
    return this.ground.heightAt(x, z, s);
  }

  /**
   * Writes one lamp group's pool, or does nothing when the field is full.
   *
   * `grid` holds `POOL_VERTS` vertices of `POOL_GRID_STRIDE` floats, row by row from the
   * lamps outwards and left to right: scene position and road lateral. `halfWidth` is the
   * road's there. `lampA`/`lampB` are the group's two lamps; `axis` the beam's unit
   * direction; `r,g,b` the linear colour times intensity, gain and share, as a
   * spotlight's `color * intensity` would be.
   */
  add(
    grid: Float32Array,
    halfWidth: number,
    lampA: THREE.Vector3,
    lampB: THREE.Vector3,
    axis: THREE.Vector3,
    r: number,
    g: number,
    b: number,
    coneCos: number,
    penumbraCos: number,
    decay: number,
    cutoff: number,
  ): void {
    if (!(r + g + b > 0) || this.used >= POOL_CAPACITY) return;
    const data = this.data;
    let o = this.used * POOL_VERTS * STRIDE;
    this.used++;
    for (let v = 0; v < POOL_VERTS; v++) {
      const i = v * POOL_GRID_STRIDE;
      data[o] = grid[i];
      data[o + 1] = grid[i + 1];
      data[o + 2] = grid[i + 2];
      data[o + 3] = lampA.x;
      data[o + 4] = lampA.y;
      data[o + 5] = lampA.z;
      data[o + 6] = lampB.x;
      data[o + 7] = lampB.y;
      data[o + 8] = lampB.z;
      data[o + 9] = axis.x;
      data[o + 10] = axis.y;
      data[o + 11] = axis.z;
      data[o + 12] = r;
      data[o + 13] = g;
      data[o + 14] = b;
      data[o + 15] = coneCos;
      data[o + 16] = penumbraCos;
      data[o + 17] = decay;
      data[o + 18] = cutoff;
      data[o + 19] = grid[i + 3];
      data[o + 20] = halfWidth;
      o += STRIDE;
    }
  }

  /** Publishes the frame: one upload of the live pools. */
  endFrame(): void {
    const count = this.used * (POOL_ROWS - 1) * (POOL_COLS - 1) * 6;
    if (this.geometry.drawRange.count !== count) this.geometry.setDrawRange(0, count);
    if (this.used === 0) return;
    this.buffer.clearUpdateRanges();
    this.buffer.addUpdateRange(0, this.used * POOL_VERTS * STRIDE);
    this.buffer.needsUpdate = true;
  }

  /** Shifts every vertex and lamp across a floating-origin step (see contactpatches.ts). */
  rebase(shift: RebaseShift): void {
    const data = this.data;
    for (let o = 0; o < data.length; o += STRIDE) {
      data[o] -= shift.dx;
      data[o + 2] -= shift.dz;
      data[o + 3] -= shift.dx;
      data[o + 5] -= shift.dz;
      data[o + 6] -= shift.dx;
      data[o + 8] -= shift.dz;
    }
    this.buffer.clearUpdateRanges();
    this.buffer.needsUpdate = true;
  }

  dispose(): void {
    this.unregisterOrigin();
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}

const _toLamp = new THREE.Vector3();

/**
 * Light a spot puts on a surface at `point` with unit `normal` (null: facing the lamp),
 * per unit of its intensity: three's spot cone, distance falloff and incidence, as the
 * pool's shader and the slot itself compute them.
 */
export function spotIrradiance(
  lamp: THREE.Vector3,
  axis: THREE.Vector3,
  point: THREE.Vector3,
  normal: THREE.Vector3 | null,
  coneCos: number,
  penumbraCos: number,
  decay: number,
  cutoff: number,
): number {
  const toLamp = _toLamp.subVectors(lamp, point);
  const d = Math.max(toLamp.length(), 1e-4);
  toLamp.divideScalar(d);
  const t = Math.min(1, Math.max(0, (-toLamp.dot(axis) - coneCos) / (penumbraCos - coneCos)));
  const spot = t * t * (3 - 2 * t);
  if (!(spot > 0)) return 0;
  const r = (d / cutoff) ** 2;
  const window = Math.max(0, 1 - r * r);
  const incidence = normal === null ? 1 : Math.max(0, normal.dot(toLamp));
  return (spot * window * window * incidence) / Math.max(d ** decay, 0.01);
}

/**
 * Who should hold a spotlight slot: how much of a beam's light the player SEES.
 *
 * Slots went to the nearest cars. A car's distance says little about its light on
 * screen: an oncoming car's beam lies on the road in front of the camera, a car ahead
 * driving away lights road nobody looks at past it, and a car close BEHIND the player
 * lights the road round him and the inside of his cabin, which a distance order ranked
 * last of the three. A headlamp is therefore scored by its light on the ground in the
 * view, each sample of its footprint weighted by the share of the screen that ground
 * covers (`groundWeight`), plus its light on the player's own car, weighted by the share
 * of the screen the car covers (`carWeight`): from the cabin that is the whole screen.
 * The scores are in one unit, light times screen fraction, and are compared to each
 * other and to `main.ts`'s floor, below which a beam is left to its pool.
 */
export class LampView {
  readonly eye = new THREE.Vector3();
  private readonly frustum = new THREE.Frustum();
  private readonly viewProjection = new THREE.Matrix4();
  private readonly car = new THREE.Sphere();
  private hasCar = false;
  /** The view's solid angle, steradians. */
  private solidAngle = 1;

  /** Takes this frame's camera and the car the player sits in (null on foot). */
  update(camera: THREE.PerspectiveCamera, car: THREE.Object3D | null, carRadius: number): void {
    camera.updateMatrixWorld();
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProjection, camera.coordinateSystem);
    this.eye.setFromMatrixPosition(camera.matrixWorld);
    const halfV = THREE.MathUtils.degToRad(camera.getEffectiveFOV()) / 2;
    const halfH = Math.atan(Math.tan(halfV) * camera.aspect);
    this.solidAngle = 4 * Math.asin(Math.sin(halfH) * Math.sin(halfV));
    this.hasCar = car !== null;
    if (car !== null) {
      this.car.center.setFromMatrixPosition(car.matrixWorld);
      this.car.radius = carRadius;
    }
  }

  /** Share of the screen a flat ground cell of `area` m2 at `point` covers; 0 off screen. */
  groundWeight(point: THREE.Vector3, area: number): number {
    if (!this.frustum.containsPoint(point)) return 0;
    const distanceSq = Math.max(1, point.distanceToSquared(this.eye));
    const distance = Math.sqrt(distanceSq);
    const facing = Math.max(0.05, (this.eye.y - point.y) / distance);
    return Math.min(1, (area * facing) / distanceSq / this.solidAngle);
  }

  /**
   * The player's car as a lit target: its centre (null on foot) and the share of the
   * screen it covers, all of it from the cabin.
   */
  carTarget(): THREE.Vector3 | null {
    return this.hasCar ? this.car.center : null;
  }

  carWeight(): number {
    if (!this.hasCar) return 0;
    const distanceSq = this.car.center.distanceToSquared(this.eye);
    const radius = this.car.radius;
    if (distanceSq <= radius * radius) return 1;
    if (!this.frustum.intersectsSphere(this.car)) return 0;
    return Math.min(1, (Math.PI * radius * radius) / distanceSq / this.solidAngle);
  }
}
