import * as THREE from 'three';

import { desertPaletteAt } from '../world/gradient';
import { WorldOrigin, type RebaseShift } from '../world/origin';

/**
 * Cheap wheel spray: sand and grit thrown off loose ground, tyre smoke scrubbed off
 * sealed ground, and one pool of motes that does both.
 *
 * One THREE.Points holding a fixed ring of motes: `emit` overwrites the oldest slot,
 * `update` integrates position and writes fade/shrink back into the same buffers, and
 * the GPU draws the whole pool in a single call. Nothing allocates after
 * construction. A per-mote fade and shrink needs per-vertex attributes, which
 * PointsMaterial's single uniform size/opacity cannot express, so the material is a
 * tiny shader instead.
 *
 * WHAT THE GROUND DECIDES. `emit` takes a `smoke` mix, 0..1, which the caller reads
 * off the surface under the wheel (`SurfaceProps.dust` and `.smoke`). It is not just
 * a colour: it interpolates the whole profile, because sand and smoke are different
 * physics wearing the same particle. Sand is heavy, thrown hard and far, opaque, and
 * the colour of the ground it came from. Smoke is buoyant, barely leaves the contact
 * patch, translucent, grey-white, and there is much less of it — a tyre scrubbing on
 * asphalt makes a wisp, not a rooster tail. Interpolating rather than branching means
 * gravel and rock, which do a bit of both, get a bit of both.
 *
 * The mix rides in a per-mote attribute rather than a uniform, so motes thrown on
 * sand keep their colour and weight after the wheel crosses onto tarmac. A uniform
 * would repaint the whole tail the instant the surface changed.
 */

/** Number of motes in the ring. At ~0.7 s life the pool sustains ~570/s. */
const POOL_SIZE = 400;
/**
 * Motes per second per unit of `strength` (yield·slip·speed), at the sand end of the
 * mix; `SMOKE_EMIT_RATE` is the other end.
 *
 * Deliberately well under what the pool can sustain. The first value (160) let a
 * bogged wheelspin saturate all 400 slots inside one second, and a saturated ring
 * is worse than a smaller one: motes get recycled before they have faded, so the
 * plume stops thinning out at its edges and reads as a solid moving mass instead
 * of dust. Leaving headroom is what makes it look like particles.
 *
 * The smoke rate is a third of it, and the caller has already scaled `strength` down
 * by the sealed surface's smaller yield, so the two reductions compound. That is what
 * makes a scrub on tarmac a wisp instead of a pale rooster tail.
 */
const EMIT_RATE = 55;
const SMOKE_EMIT_RATE = 20;
/** Hard cap on motes one emit call may spawn, so a launch cannot dump the pool. */
const MAX_BURST = 10;
/**
 * Ceiling on the caller's `strength` for COUNT purposes. Above this a tyre throws
 * its motes harder, not more of them — see `emit`.
 */
const STRENGTH_MAX = 3;
/**
 * Downward acceleration, m/s². Sand is a fraction of real g so it hangs; smoke is
 * very slightly buoyant, because a puff that falls out of the air reads as grit that
 * someone recoloured.
 */
const DUST_GRAVITY = 6.5;
const SMOKE_GRAVITY = -0.35;
/** Mote lifetime bounds, seconds. Smoke lingers a little longer than it travels. */
const LIFE_MIN = 0.5;
const LIFE_MAX = 0.9;
const SMOKE_LIFE_MIN = 0.55;
const SMOKE_LIFE_MAX = 1.1;
/**
 * Spawn diameter bounds, world metres.
 *
 * Measured rather than guessed. At 0.07-0.16 m the motes projected to 7.3 px on
 * average against a pebble-strewn sand ground and were invisible in a screenshot
 * despite 218 of them being on screen. These land nearer 18-22 px, which reads as
 * thrown dust. They can be this large because POINT_PX_MAX now bounds the
 * near-camera case — that was what produced shards before, not the world size.
 *
 * Smoke is coarser and there is less of it, which is the trade that keeps a wisp
 * visible at a fifth of the mote count.
 */
const SIZE_MIN = 0.18;
const SIZE_MAX = 0.38;
const SMOKE_SIZE_MIN = 0.3;
const SMOKE_SIZE_MAX = 0.62;
/** Fraction of spawn size a mote keeps at expiry. Smoke expands instead. */
const SIZE_SHRINK = 0.3;
const SMOKE_SIZE_GROW = 2.1;
/** Peak opacity at spawn. Smoke is thin: it is suspended rubber, not ground. */
const ALPHA_MAX = 1;
const SMOKE_ALPHA_MAX = 0.5;
/** Horizontal ejection speed at full fling, m/s, backwards. */
const EJECT_SPEED = 6;
const SMOKE_EJECT_SPEED = 1.5;
/** Upward ejection speed at full fling, m/s. */
const EJECT_UP = 1.8;
const SMOKE_EJECT_UP = 0.85;
/** Ejection intensity saturates: fling = min(1, strength * this). */
const EJECT_GAIN = 0.6;
/** Horizontal throw spread, radians (± this around straight-backward). */
const SPREAD_RAD = 0.5;
const SMOKE_SPREAD_RAD = 0.9;
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
attribute float tint;
uniform float scale;
uniform float pxMin;
uniform float pxMax;
varying float vAlpha;
varying float vTint;

void main() {
  vAlpha = alpha;
  vTint = tint;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(size * scale / -mvPosition.z, pxMin, pxMax);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 sandColor;
uniform vec3 smokeColor;
varying float vAlpha;
varying float vTint;

void main() {
  // Soft round mote: full alpha at the centre, gone at the rim, so the pool of
  // individual points reads as dust rather than a screen of squares.
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  // Smoke gets a softer edge than grit: a wider falloff on the same disc, so a
  // sparse handful of large motes still reads as a cloud and not as pale pebbles.
  float edge = mix(0.35, 0.9, vTint);
  float a = smoothstep(1.0, edge, r2) * vAlpha;
  gl_FragColor = vec4(mix(sandColor, smokeColor, vTint), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * Scratch colour for the thrown sand, reused every frame so the palette-driven spray
 * never allocates.
 *
 * The lift that separates the spray from the ground it came off now lives in the
 * palette itself (`DesertPalette.spray`), not here. It used to be a lerp toward white
 * in the linear working space, which brightens by moving all three channels toward
 * each other — so it desaturated as it lifted, and the warm `#d29459` sand threw a
 * neutral cream that did not look like that desert. The palette raises lightness in
 * HSL instead and keeps hue and saturation, so thrown sand is the same sand.
 */
const spraySand = new THREE.Color();

export class WheelSpray {
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly points: THREE.Points;

  private readonly position = new Float32Array(POOL_SIZE * 3);
  private readonly velocity = new Float32Array(POOL_SIZE * 3);
  private readonly size = new Float32Array(POOL_SIZE);
  private readonly alpha = new Float32Array(POOL_SIZE);
  private readonly tint = new Float32Array(POOL_SIZE);
  private readonly age = new Float32Array(POOL_SIZE);
  private readonly life = new Float32Array(POOL_SIZE);
  private readonly spawnSize = new Float32Array(POOL_SIZE);
  /** Size multiplier a mote reaches at expiry: under 1 for grit, over 1 for smoke. */
  private readonly endSize = new Float32Array(POOL_SIZE);
  private readonly spawnAlpha = new Float32Array(POOL_SIZE);
  /** Per-mote gravity, so a tail keeps the weight of the ground it came off. */
  private readonly gravity = new Float32Array(POOL_SIZE);

  private readonly posAttr: THREE.BufferAttribute;
  private readonly sizeAttr: THREE.BufferAttribute;
  private readonly alphaAttr: THREE.BufferAttribute;
  private readonly tintAttr: THREE.BufferAttribute;

  /** Ring head: the slot the next mote overwrites. */
  private cursor = 0;
  /** Fractional mote accumulator, so low emission rates still fire steadily. */
  private acc = 0;

  constructor(
    private readonly scene: THREE.Scene,
    origin: WorldOrigin,
  ) {
    // The mote positions are RELATIVE (the contact points from BodyOrigin are
    // already relative, see emit), so on a rebase the live motes must be shifted by
    // the frame step or a still-airborne tail streaks a kilometre across the screen
    // for the rest of its sub-second life. Cheap: 400 slots, once per rebase.
    origin.register(this);
    this.posAttr = new THREE.BufferAttribute(this.position, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.posAttr);

    this.sizeAttr = new THREE.BufferAttribute(this.size, 1);
    this.sizeAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('size', this.sizeAttr);

    this.alphaAttr = new THREE.BufferAttribute(this.alpha, 1);
    this.alphaAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('alpha', this.alphaAttr);

    this.tintAttr = new THREE.BufferAttribute(this.tint, 1);
    this.tintAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('tint', this.tintAttr);

    // Airborne material, NOT the ground's own albedo.
    //
    // Matching the ground sand exactly was the first attempt and it made the spray
    // invisible: identical colour against an identical background, with the camera
    // looking down at the same lit surface the motes came from. Real thrown dust
    // reads LIGHTER than the ground it came off, because a suspended grain is lit
    // from every side while packed sand is shadowed by its neighbours. So the spray
    // is the desert palette's sand lifted toward white (SPRAY_SAND_LIFT), re-sampled
    // every frame from desertPaletteAt so it always matches the ground it came off.
    //
    // The smoke tone is the same argument run against the other background. Tyre
    // smoke over dark asphalt has to be pale to separate from it, but pure white
    // against a bright desert sky reads as a rendering error, so it is a cool grey
    // with the faintest blue in it — burnt rubber, not steam.
    const smoke = new THREE.Color(0xd2d3d8);
    smoke.convertSRGBToLinear();

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        sandColor: { value: spraySand },
        smokeColor: { value: smoke },
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
   * Rebasable: shift every live (and stale) mote's RELATIVE X/Z by the frame step.
   * Y is a height, untouched. Skipping this would be defensible — a mote lives under
   * a second, so a streak is barely a frame — but the shift is 400 subtractions once
   * per rebase, far cheaper than the confusion it saves, and it keeps the pool's
   * geometry bit-identical to what the next spawn writes.
   */
  rebase(shift: RebaseShift): void {
    const position = this.position;
    for (let i = 0; i < POOL_SIZE; i++) {
      const i3 = i * 3;
      position[i3] -= shift.dx;
      position[i3 + 2] -= shift.dz;
    }
    this.posAttr.needsUpdate = true;
  }

  /**
   * Fling `strength` worth of motes from a contact point, backward along the wheel's
   * forward direction.
   *
   * `strength` is yield·slip·speed from the caller, so both the count and the ejection
   * speed track how hard the tyre is working. `smoke` is 0..1 from the surface under
   * that tyre and picks the profile: 0 throws sand, 1 breathes tyre smoke, and every
   * value between mixes the two linearly. It is resolved HERE, at spawn, and stored
   * per mote, so a tail thrown on sand does not turn grey when the wheel reaches
   * tarmac two metres later.
   */
  emit(
    x: number,
    y: number,
    z: number,
    dirX: number,
    dirZ: number,
    strength: number,
    smoke: number,
    dt: number,
  ): void {
    if (strength <= 0 || dt <= 0) return;
    const mix = smoke < 0 ? 0 : smoke > 1 ? 1 : smoke;
    // `strength` is yield·slip·speed and is UNBOUNDED — a bogged wheel spinning at
    // slip 7 against a rolling 2 m/s comes in around 14, which at any useful rate
    // saturates the whole ring inside a second. Clamped so the ring always has
    // headroom to let its oldest motes fade out; past this point a harder-working
    // tyre throws its motes FASTER (see `fling` below) rather than throwing more,
    // which is both cheaper and what a rooster tail actually looks like.
    const work = Math.min(strength, STRENGTH_MAX);
    this.acc += work * (EMIT_RATE + (SMOKE_EMIT_RATE - EMIT_RATE) * mix) * dt;
    if (this.acc > MAX_BURST) this.acc = MAX_BURST;
    const n = this.acc | 0;
    this.acc -= n;
    if (n <= 0) return;

    // Normalise the forward direction. The wheels hand it over unit-length, but
    // a stray magnitude must never scale the spread.
    const len = Math.hypot(dirX, dirZ) || 1;
    const fx = dirX / len;
    const fz = dirZ / len;

    // The profile, resolved once for this burst.
    const fling = Math.min(1, strength * EJECT_GAIN);
    const speed = fling * (EJECT_SPEED + (SMOKE_EJECT_SPEED - EJECT_SPEED) * mix);
    const up = fling * (EJECT_UP + (SMOKE_EJECT_UP - EJECT_UP) * mix);
    const spread = SPREAD_RAD + (SMOKE_SPREAD_RAD - SPREAD_RAD) * mix;
    const lifeMin = LIFE_MIN + (SMOKE_LIFE_MIN - LIFE_MIN) * mix;
    const lifeSpan = LIFE_MAX + (SMOKE_LIFE_MAX - LIFE_MAX) * mix - lifeMin;
    const sizeMin = SIZE_MIN + (SMOKE_SIZE_MIN - SIZE_MIN) * mix;
    const sizeSpan = SIZE_MAX + (SMOKE_SIZE_MAX - SIZE_MAX) * mix - sizeMin;
    const endSize = SIZE_SHRINK + (SMOKE_SIZE_GROW - SIZE_SHRINK) * mix;
    const peakAlpha = ALPHA_MAX + (SMOKE_ALPHA_MAX - ALPHA_MAX) * mix;
    const grav = DUST_GRAVITY + (SMOKE_GRAVITY - DUST_GRAVITY) * mix;

    for (let k = 0; k < n; k++) {
      const i = this.cursor;
      this.cursor = (i + 1) % POOL_SIZE;
      const i3 = i * 3;

      // Backward ± a horizontal spread, so a tail fans out instead of a line.
      const ang = (Math.random() - 0.5) * 2 * spread;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const vx = -fx * ca + fz * sa;
      const vz = -fx * sa - fz * ca;
      const s = speed * (0.6 + 0.8 * Math.random());

      this.velocity[i3] = vx * s;
      this.velocity[i3 + 1] = up * (0.5 + 0.8 * Math.random());
      this.velocity[i3 + 2] = vz * s;

      // `x/y/z` are the wheel contact point, already RELATIVE: BodyOrigin keeps
      // `WheelSprayState.contact*` in the relative frame, and this Float32Array is
      // relative too, so the write is frame-consistent with no origin subtraction.
      // Do NOT add one here — that would double-rebase every mote off the wheel.
      this.position[i3] = x + (Math.random() - 0.5) * 0.08;
      this.position[i3 + 1] = y + 0.02 + Math.random() * 0.05;
      this.position[i3 + 2] = z + (Math.random() - 0.5) * 0.08;

      this.life[i] = lifeMin + Math.random() * lifeSpan;
      this.age[i] = 0;
      this.spawnSize[i] = sizeMin + Math.random() * sizeSpan;
      this.size[i] = this.spawnSize[i];
      this.endSize[i] = endSize;
      this.spawnAlpha[i] = peakAlpha;
      this.alpha[i] = peakAlpha;
      this.tint[i] = mix;
      this.gravity[i] = grav;
    }

    this.posAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.tintAttr.needsUpdate = true;
  }

  /**
   * A dry-brush impact uses the same ring, shader and rebase path as wheel spray.
   * Fourteen motes are a visible burst without consuming the 400-slot pool; their
   * forward bias is intentional — the car carries snapped twigs down-road, whereas a
   * tyre's contact patch always throws behind it.
   */
  emitBurst(x: number, y: number, z: number, dirX: number, dirZ: number, speed: number): void {
    const len = Math.hypot(dirX, dirZ) || 1;
    const fx = dirX / len;
    const fz = dirZ / len;
    const count = 14;
    const throwSpeed = Math.min(14, 4 + speed * 0.45);
    for (let k = 0; k < count; k++) {
      const i = this.cursor;
      this.cursor = (i + 1) % POOL_SIZE;
      const i3 = i * 3;
      const angle = (Math.random() - 0.5) * 1.25;
      const ca = Math.cos(angle);
      const sa = Math.sin(angle);
      this.velocity[i3] = (fx * ca - fz * sa) * throwSpeed * (0.55 + Math.random() * 0.7);
      this.velocity[i3 + 1] = 1.1 + Math.random() * 2.5;
      this.velocity[i3 + 2] = (fx * sa + fz * ca) * throwSpeed * (0.55 + Math.random() * 0.7);
      this.position[i3] = x + (Math.random() - 0.5) * 0.3;
      this.position[i3 + 1] = y + Math.random() * 0.25;
      this.position[i3 + 2] = z + (Math.random() - 0.5) * 0.3;
      this.life[i] = 0.55 + Math.random() * 0.45;
      this.age[i] = 0;
      this.spawnSize[i] = 0.12 + Math.random() * 0.22;
      this.size[i] = this.spawnSize[i];
      this.endSize[i] = 0.22;
      this.spawnAlpha[i] = 0.9;
      this.gravity[i] = DUST_GRAVITY;
      this.alpha[i] = 0.9;
      this.tint[i] = 0;
    }
    this.posAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.tintAttr.needsUpdate = true;
  }

  /**
   * Advances every live mote: gravity, integration, then fade and size.
   *
   * Gravity, peak opacity and the end-of-life size all come from the mote's own slot
   * rather than from constants, because the pool holds sand and smoke at the same
   * time — a car crossing from the verge onto the road has both in flight.
   */
  update(dt: number, s: number): void {
    // Re-tint to the thrown-sand colour of the ground at the player's distance, which
    // the palette derives from that ground's own hue and saturation. Mutated in place,
    // so the uniform never allocates.
    spraySand.setHex(desertPaletteAt(s).spray);
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
      this.velocity[i3 + 1] -= this.gravity[i] * dt;
      this.position[i3] += this.velocity[i3] * dt;
      this.position[i3 + 1] += this.velocity[i3 + 1] * dt;
      this.position[i3 + 2] += this.velocity[i3 + 2] * dt;
      this.alpha[i] = this.spawnAlpha[i] * (1 - t);
      this.size[i] = this.spawnSize[i] * (1 + (this.endSize[i] - 1) * t);
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
