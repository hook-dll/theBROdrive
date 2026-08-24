import * as THREE from 'three';

/**
 * Cheap sand and gravel spray thrown from the driven wheels.
 *
 * One THREE.Points holding a fixed ring of motes: `emit` overwrites the oldest
 * slot, `update` integrates position and writes fade/shrink back into the same
 * buffers, and the GPU draws the whole pool in a single call. Nothing allocates
 * after construction. A per-mote fade and shrink needs per-vertex attributes,
 * which PointsMaterial's single uniform size/opacity cannot express, so the
 * material is a tiny shader instead — one warm sand tone, soft round points,
 * nothing else.
 */

/** Number of motes in the ring. At ~0.7 s life the pool sustains ~570/s. */
const POOL_SIZE = 400;
/**
 * Motes per second per unit of `strength` (dust·slip·speed).
 *
 * Deliberately well under what the pool can sustain. The first value (160) let a
 * bogged wheelspin saturate all 400 slots inside one second, and a saturated ring
 * is worse than a smaller one: motes get recycled before they have faded, so the
 * plume stops thinning out at its edges and reads as a solid moving mass instead
 * of dust. Leaving headroom is what makes it look like particles.
 */
const EMIT_RATE = 55;
/** Hard cap on motes one emit call may spawn, so a launch cannot dump the pool. */
const MAX_BURST = 10;
/**
 * Ceiling on the caller's `strength` for COUNT purposes. Above this a tyre throws
 * its motes harder, not more of them — see `emit`.
 */
const STRENGTH_MAX = 3;
/** Constant downward acceleration, m/s² — a fraction of real g so dust hangs. */
const DUST_GRAVITY = 6.5;
/** Mote lifetime bounds, seconds. */
const LIFE_MIN = 0.5;
const LIFE_MAX = 0.9;
/**
 * Spawn diameter bounds, world metres.
 *
 * Measured rather than guessed. At 0.07-0.16 m the motes projected to 7.3 px on
 * average against a pebble-strewn sand ground and were invisible in a screenshot
 * despite 218 of them being on screen. These land nearer 18-22 px, which reads as
 * thrown dust. They can be this large because POINT_PX_MAX now bounds the
 * near-camera case — that was what produced shards before, not the world size.
 */
const SIZE_MIN = 0.18;
const SIZE_MAX = 0.38;
/** Fraction of spawn size a mote keeps at expiry. */
const SIZE_SHRINK = 0.3;
/** Horizontal ejection speed at full fling, m/s, backwards. */
const EJECT_SPEED = 6;
/** Upward ejection speed at full fling, m/s. */
const EJECT_UP = 1.8;
/** Ejection intensity saturates: fling = min(1, strength * this). */
const EJECT_GAIN = 0.6;
/** Horizontal throw spread, radians (± this around straight-backward). */
const SPREAD_RAD = 0.5;
/**
 * Half a 1080p drawing buffer, the same scale three.js feeds its built-in
 * points shader so `size` reads in world units. A larger buffer simply renders
 * the motes a little finer, which is acceptable for dust.
 */
const POINT_SCALE = 540;

/**
 * Screen-space clamp on a mote, pixels.
 *
 * `gl_PointSize = size * scale / -z` is unbounded as z approaches the near plane,
 * and motes are flung BACKWARD from the wheel — straight at the chase camera. One
 * passing within a few centimetres of the lens was covering the whole frame, and
 * the ink-outline pass then drew a hard edge around the blob, which is what turned
 * a dust plume into a fan of brown shards. Clamping is the fix rather than shrinking
 * `size`, because the world size is correct at every sane distance; only the
 * degenerate near case needed bounding.
 */
const POINT_PX_MAX = 34;
const POINT_PX_MIN = 1;

const VERTEX = /* glsl */ `
attribute float size;
attribute float alpha;
uniform float scale;
uniform float pxMin;
uniform float pxMax;
varying float vAlpha;

void main() {
  vAlpha = alpha;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(size * scale / -mvPosition.z, pxMin, pxMax);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 color;
varying float vAlpha;

void main() {
  // Soft round mote: full alpha at the centre, gone at the rim, so the pool of
  // individual points reads as dust rather than a screen of squares.
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  float a = smoothstep(1.0, 0.35, r2) * vAlpha;
  gl_FragColor = vec4(color, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class WheelSpray {
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly points: THREE.Points;

  private readonly position = new Float32Array(POOL_SIZE * 3);
  private readonly velocity = new Float32Array(POOL_SIZE * 3);
  private readonly size = new Float32Array(POOL_SIZE);
  private readonly alpha = new Float32Array(POOL_SIZE);
  private readonly age = new Float32Array(POOL_SIZE);
  private readonly life = new Float32Array(POOL_SIZE);
  private readonly spawnSize = new Float32Array(POOL_SIZE);

  private readonly posAttr: THREE.BufferAttribute;
  private readonly sizeAttr: THREE.BufferAttribute;
  private readonly alphaAttr: THREE.BufferAttribute;

  /** Ring head: the slot the next mote overwrites. */
  private cursor = 0;
  /** Fractional mote accumulator, so low emission rates still fire steadily. */
  private acc = 0;

  constructor(private readonly scene: THREE.Scene) {
    this.posAttr = new THREE.BufferAttribute(this.position, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.posAttr);

    this.sizeAttr = new THREE.BufferAttribute(this.size, 1);
    this.sizeAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('size', this.sizeAttr);

    this.alphaAttr = new THREE.BufferAttribute(this.alpha, 1);
    this.alphaAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('alpha', this.alphaAttr);

    // Airborne dust, NOT the ground's own albedo.
    //
    // Matching the sand exactly (0xbf9f6b) was the first attempt and it made the
    // spray invisible: identical colour against an identical background, with the
    // camera looking down at the same lit surface the motes came from. Real thrown
    // dust reads LIGHTER than the ground it came off, because a suspended grain is
    // lit from every side while packed sand is shadowed by its neighbours. So this
    // is the sand hue lifted toward white — enough to separate from the ground
    // without becoming a smoke effect.
    const sand = new THREE.Color(0xe0cca6);
    sand.convertSRGBToLinear();

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        color: { value: sand },
        scale: { value: POINT_SCALE },
        pxMin: { value: POINT_PX_MIN },
        pxMax: { value: POINT_PX_MAX },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    // Motes travel outside the box their first bounding sphere was built from,
    // so skip the stale-box frustum cull.
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  /**
   * Fling `strength` worth of motes from a contact point, backward along the
   * wheel's forward direction. `strength` is dust·slip·speed from the caller, so
   * both the count and the ejection speed track how hard the tyre is working.
   */
  emit(
    x: number,
    y: number,
    z: number,
    dirX: number,
    dirZ: number,
    strength: number,
    dt: number,
  ): void {
    if (strength <= 0 || dt <= 0) return;
    // `strength` is dust·slip·speed and is UNBOUNDED — a bogged wheel spinning at
    // slip 7 against a rolling 2 m/s comes in around 14, which at any useful rate
    // saturates the whole ring inside a second. Clamped so the ring always has
    // headroom to let its oldest motes fade out; past this point a harder-working
    // tyre throws its motes FASTER (see `fling` below) rather than throwing more,
    // which is both cheaper and what a rooster tail actually looks like.
    const work = Math.min(strength, STRENGTH_MAX);
    this.acc += work * EMIT_RATE * dt;
    if (this.acc > MAX_BURST) this.acc = MAX_BURST;
    const n = this.acc | 0;
    this.acc -= n;
    if (n <= 0) return;

    // Normalise the forward direction. The wheels hand it over unit-length, but
    // a stray magnitude must never scale the spread.
    const len = Math.hypot(dirX, dirZ) || 1;
    const fx = dirX / len;
    const fz = dirZ / len;

    const fling = Math.min(1, strength * EJECT_GAIN);
    const speed = fling * EJECT_SPEED;
    const up = fling * EJECT_UP;

    for (let k = 0; k < n; k++) {
      const i = this.cursor;
      this.cursor = (i + 1) % POOL_SIZE;
      const i3 = i * 3;

      // Backward ± a horizontal spread, so a tail fans out instead of a line.
      const ang = (Math.random() - 0.5) * 2 * SPREAD_RAD;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const vx = -fx * ca + fz * sa;
      const vz = -fx * sa - fz * ca;
      const s = speed * (0.6 + 0.8 * Math.random());

      this.velocity[i3] = vx * s;
      this.velocity[i3 + 1] = up * (0.5 + 0.8 * Math.random());
      this.velocity[i3 + 2] = vz * s;

      this.position[i3] = x + (Math.random() - 0.5) * 0.08;
      this.position[i3 + 1] = y + 0.02 + Math.random() * 0.05;
      this.position[i3 + 2] = z + (Math.random() - 0.5) * 0.08;

      this.life[i] = LIFE_MIN + Math.random() * (LIFE_MAX - LIFE_MIN);
      this.age[i] = 0;
      this.spawnSize[i] = SIZE_MIN + Math.random() * (SIZE_MAX - SIZE_MIN);
      this.size[i] = this.spawnSize[i];
      this.alpha[i] = 1;
    }

    this.posAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
  }

  /** Advances every live mote: gravity, integration, then fade and shrink. */
  update(dt: number): void {
    if (dt <= 0) return;
    for (let i = 0; i < POOL_SIZE; i++) {
      const life = this.life[i];
      if (life <= 0) continue;
      const age = this.age[i] + dt;
      if (age >= life) {
        this.life[i] = 0;
        this.alpha[i] = 0;
        this.size[i] = 0;
        continue;
      }
      this.age[i] = age;
      const t = age / life;
      const i3 = i * 3;
      this.velocity[i3 + 1] -= DUST_GRAVITY * dt;
      this.position[i3] += this.velocity[i3] * dt;
      this.position[i3 + 1] += this.velocity[i3 + 1] * dt;
      this.position[i3 + 2] += this.velocity[i3 + 2] * dt;
      this.alpha[i] = 1 - t;
      this.size[i] = this.spawnSize[i] * (1 - (1 - SIZE_SHRINK) * t);
    }
    this.posAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.points);
    this.geometry.dispose();
    this.material.dispose();
  }
}
