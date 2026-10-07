/**
 * The cactus air dancers that stand beside every courier: a fabric tube on a blower,
 * a cartoon cactus with two flailing arms. Cosmetic, never saved, no collider — the
 * courier is the thing you came for.
 *
 * A TUBE IN AIRFLOW, NOT A RIG. The first version skinned a mesh to rigid bones and
 * drove them with summed sines and a scripted fold; big joint angles pinched and tore
 * the skin, the arms came apart from the body and none of it read as fabric. Here the
 * centreline is a chain of points simulated in its own frame (position-based, fixed
 * step): every segment is a hard length constraint, so the tube can bend, crumple and
 * whip but never stretch; the arms are chains whose first point IS a body point, so
 * they cannot come off. Air pressure is what makes the tube stand — lift on every
 * point and a straightening pull between neighbours, both scaled by how inflated it
 * is — and turbulence grows toward the open top. When the blower's flow drops the
 * pressure goes, gravity takes over and the tube crumples wherever it happens to
 * give; when the flow returns it shoots back up whipping. Nothing in that is scripted
 * beyond the flow itself.
 *
 * THE MESH is swept along the simulated chain every animated frame: a smooth curve
 * through the points, rotation-minimising frames, fixed rings written into
 * preallocated buffers (no allocation per frame), normals from the frames. Body, arms
 * and blower are one geometry and one draw per dancer. The look — green, darker ribs,
 * white spines, a flower on the top and a big printed grin — is one shared procedural
 * texture, so the face is printed on the fabric and folds with it.
 *
 * CARS. The blower is not solid. A car that reaches the tube pushes the chain points
 * it overlaps out of its way and carries them with its own velocity, and chokes the
 * flow for a moment, so the tube is shoved over the car's path and then re-inflates.
 *
 * SHADER RULE. One material for every dancer and the boot anchor (a hidden, real
 * dancer added to the scene at construction), so `waitForFrameShaders` links the
 * program behind the loading cover and the first courier in view compiles nothing.
 */

import * as THREE from 'three';
import { hashUnit3 } from '../../core/rng';
import { weather } from '../weather';

// ---------------------------------------------------------------------------
// Shape, metres, in the dancer's own frame: ground at y = 0, the face (+Z) at the road.
// ---------------------------------------------------------------------------

/** The blower: a squat box the tube rises out of. */
const BLOWER_HALF_W = 0.38;
const BLOWER_H = 0.5;
/** Body tube: tall enough to read over a parked car from the lane. */
const BODY_POINTS = 14;
const BODY_SEG_M = 0.4;
const BODY_LEN_M = BODY_SEG_M * (BODY_POINTS - 1);
const BODY_RADIUS_M = 0.27;
/** Arms: long cactus arms out of the sides in the upper third, open at the end. */
const ARM_POINTS = 7;
const ARM_SEG_M = 0.3;
const ARM_RADIUS_M = 0.115;
const ARM_FLARE_M = 0.15;
/** The body point an arm grows from, and which side (±X) each arm leaves by. */
const ARM_ATTACH = 9;
const ARM_SIDE = [-1, 1] as const;

/** Mesh resolution. */
const BODY_RINGS = 44;
const BODY_SIDES = 20;
const ARM_RINGS = 16;
const ARM_SIDES = 12;

/**
 * Where a dancer stands relative to the car it advertises: this far forward along the
 * car's own heading, and this far further from the road than the car's parked flank.
 * 2.8 m clears the widest car's half-track and keeps the blower off the lane.
 */
export const DANCER_ALONG_M = 0.5;
export const DANCER_OUT_M = 2.8;

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

const STEP_S = 1 / 120;
const MAX_STEPS = 8;
const ITERATIONS = 6;
const GRAVITY = 9.8;
/** Lift per point while fully inflated, as a fraction of gravity: just over 1. */
const LIFT = 1.06;
/**
 * Straightening pull between neighbours while fully inflated, per iteration. Low on
 * purpose: at 0.11 the tube stood like a pole and the turbulence never showed.
 */
const BEND_STIFFNESS = 0.025;
const ARM_BEND_STIFFNESS = 0.07;
/** Velocity kept per step: fabric in air is damped, but not to a crawl. */
const DAMPING = 0.99;
/** Turbulence, m/s², at the open top of a fully inflated tube; grows as height^1.3. */
const TURBULENCE = 45;
const TURBULENCE_POW = 1.3;
const ARM_TURBULENCE = 34;
/**
 * Lateral jostle of a deflating tube, m/s² at the top. A straight column losing its
 * pressure only pushes down on itself; this is the sag that lets it fold over.
 */
const SLACK = 10;
/**
 * Wind push per m/s of wind: the tube leans and folds downwind, the way the storm's
 * dust flies (`weather.windX/Z` is the direction it blows toward). A haboob's 17 m/s
 * lays it well over; a breeze barely shows.
 */
const WIND_PUSH = 1.1;
/** How fast the tube loses and regains pressure, seconds. */
const DEFLATE_S = 0.16;
const INFLATE_S = 0.32;
/** Flow dropouts: every few seconds the blower chokes for about a second. */
const DROP_GAP_MIN_S = 3.2;
const DROP_GAP_MAX_S = 7.5;
const DROP_LEN_MIN_S = 0.7;
const DROP_LEN_MAX_S = 1.7;
/** Flow left during a dropout: enough to twitch, not to stand. */
const DROP_FLOW = 0.05;
/** Beyond this the dancer is left as it is and not simulated, metres. */
const ANIMATE_RANGE_M = 350;
const ANIMATE_RANGE_SQ = ANIMATE_RANGE_M * ANIMATE_RANGE_M;
const DANCER_DOMAIN = 0x41495232; // 'AIR2'

/** A car, as the tube feels it: a capsule along its heading, from the ground up. */
const CAR_HALF_LEN_M = 2.1;
const CAR_RADIUS_M = 0.95;
const CAR_TOP_M = 1.5;
/** Cars farther than this from a dancer are not worth asking for velocity. */
const KNOCK_REACH_M = BODY_LEN_M + 4;
/** A car that touches the tube chokes it for this long, so it goes over the car. */
const KNOCK_CHOKE_S = 0.9;
/** Most cars handed to the field in one frame; more than enough beside one courier. */
const MAX_CARS = 6;

// ---------------------------------------------------------------------------
// Texture: one shared procedural sheet. u runs round the tube (0.5 = the front, the
// face), v up the body. Arms read the ribbed band without the face; the blower reads
// the dark patch in the bottom-left corner.
// ---------------------------------------------------------------------------

const TEX_W = 512;
const TEX_H = 1024;
/** Body v starts above the blower's dark patch. */
const BODY_V0 = 0.03;
/** The band arms read: ribs and spines, no face. */
const ARM_V0 = 0.2;
const ARM_V1 = 0.5;
const BLOWER_UV = 0.008;

function buildTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const g = canvas.getContext('2d')!;
  // Canvas y grows downward and the texture is flipped on upload, so v = 1 - y / H.
  const yOf = (v: number): number => (1 - v) * TEX_H;
  // Cactus green with a soft vertical light, then the ribs: eight darker grooves
  // with a pale ridge beside each.
  g.fillStyle = '#4f9d3a';
  g.fillRect(0, 0, TEX_W, TEX_H);
  const ribs = 8;
  for (let r = 0; r < ribs; r++) {
    const x = ((r + 0.5) / ribs) * TEX_W;
    const groove = g.createLinearGradient(x - 18, 0, x + 18, 0);
    groove.addColorStop(0, 'rgba(32,82,30,0)');
    groove.addColorStop(0.5, 'rgba(32,82,30,0.75)');
    groove.addColorStop(1, 'rgba(32,82,30,0)');
    g.fillStyle = groove;
    g.fillRect(x - 18, 0, 36, TEX_H);
    g.fillStyle = 'rgba(160,214,110,0.35)';
    g.fillRect(x + 20, 0, 5, TEX_H);
  }
  // Spines: small white starbursts on the ridges (a fan of three read as arrows).
  g.strokeStyle = 'rgba(250,248,230,0.95)';
  g.lineWidth = 2.2;
  g.lineCap = 'round';
  for (let r = 0; r < ribs; r++) {
    const x = ((r + 0.5) / ribs) * TEX_W + 22;
    for (let k = 0; k < 22; k++) {
      const y = 30 + k * 44 + (r % 2) * 22;
      g.beginPath();
      for (let s = 0; s < 4; s++) {
        const a = (s / 4) * Math.PI + 0.35;
        g.moveTo(x - Math.cos(a) * 6, y - Math.sin(a) * 6);
        g.lineTo(x + Math.cos(a) * 6, y + Math.sin(a) * 6);
      }
      g.stroke();
    }
  }
  // The face, on the front (u = 0.5), near the top. The sheet is 1.7 m round by
  // 5.2 m up on a 512x1024 canvas, so a round eye is wider in pixels than tall.
  const pxPerMU = TEX_W / (Math.PI * 2 * BODY_RADIUS_M);
  const pxPerMV = TEX_H / BODY_LEN_M;
  const cx = TEX_W * 0.5;
  const eyeY = yOf(0.86);
  const ellipse = (x: number, y: number, rm: number, fill: string, stroke?: string): void => {
    g.beginPath();
    g.ellipse(x, y, rm * pxPerMU, rm * pxPerMV, 0, 0, Math.PI * 2);
    g.fillStyle = fill;
    g.fill();
    if (stroke) {
      g.lineWidth = 5;
      g.strokeStyle = stroke;
      g.stroke();
    }
  };
  // A puzzled face: one eye wide under a brow shot up, the other narrowed under a brow
  // pulled down, both pupils rolled up toward the raised side, and a crooked wavy mouth.
  // The dancer has no idea what it is doing out here, and neither does anyone else.
  for (const side of [-1, 1]) {
    const wide = side < 0;
    const ex = cx + side * 0.13 * pxPerMU;
    const ey = eyeY + (wide ? -0.02 : 0.02) * pxPerMV;
    const r = wide ? 0.105 : 0.075;
    ellipse(ex, ey, r, '#ffffff', '#141414');
    ellipse(ex - 0.03 * pxPerMU, ey - 0.035 * pxPerMV, wide ? 0.045 : 0.038, '#141414');
    ellipse(ex - 0.04 * pxPerMU, ey - 0.05 * pxPerMV, 0.013, '#ffffff');
    g.beginPath();
    g.lineWidth = 9;
    g.strokeStyle = '#1a2a14';
    if (wide) {
      // High, arched: "what?"
      g.moveTo(ex - 0.09 * pxPerMU, ey - 0.17 * pxPerMV);
      g.quadraticCurveTo(ex, ey - 0.3 * pxPerMV, ex + 0.08 * pxPerMU, ey - 0.19 * pxPerMV);
    } else {
      // Low and slanted down toward the nose: "hmm."
      g.moveTo(ex - 0.08 * pxPerMU, ey - 0.15 * pxPerMV);
      g.lineTo(ex + 0.09 * pxPerMU, ey - 0.1 * pxPerMV);
    }
    g.stroke();
  }
  // The mouth: a small crooked squiggle, off to one side.
  const mouthY = yOf(0.79);
  const mx = cx + 0.04 * pxPerMU;
  g.beginPath();
  g.lineWidth = 8;
  g.strokeStyle = '#1a1010';
  g.lineCap = 'round';
  g.moveTo(mx - 0.11 * pxPerMU, mouthY + 0.01 * pxPerMV);
  g.bezierCurveTo(
    mx - 0.05 * pxPerMU, mouthY - 0.05 * pxPerMV,
    mx - 0.01 * pxPerMU, mouthY + 0.06 * pxPerMV,
    mx + 0.04 * pxPerMU, mouthY,
  );
  g.quadraticCurveTo(mx + 0.08 * pxPerMU, mouthY - 0.04 * pxPerMV, mx + 0.11 * pxPerMU, mouthY - 0.03 * pxPerMV);
  g.stroke();
  // The flower on top: pink petals at the crown, a yellow heart at the very tip.
  g.fillStyle = '#ef5f9e';
  g.fillRect(0, 0, TEX_W, yOf(0.955));
  g.fillStyle = '#ffd23f';
  g.fillRect(0, 0, TEX_W, yOf(0.985));
  for (let k = 0; k < 10; k++) {
    g.fillStyle = k % 2 ? '#f590bd' : '#ef5f9e';
    g.fillRect((k / 10) * TEX_W, yOf(0.955), TEX_W / 20, yOf(0.94) - yOf(0.955));
  }
  // The blower's patch.
  g.fillStyle = '#3d4246';
  g.fillRect(0, yOf(BLOWER_UV * 2), TEX_W * BLOWER_UV * 2, TEX_H * BLOWER_UV * 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/**
 * One material for every dancer and the anchor. DoubleSide because the arms are open
 * tubes you can see into; nothing about it varies per instance. Made on first use (the
 * field's boot anchor), not at import: the texture needs a canvas, and headless tools
 * import the world without a DOM.
 */
let dancerMaterialValue: THREE.MeshStandardMaterial | null = null;
function dancerMaterial(): THREE.MeshStandardMaterial {
  return (dancerMaterialValue ??= new THREE.MeshStandardMaterial({
    map: buildTexture(),
    roughness: 0.78,
    metalness: 0,
    side: THREE.DoubleSide,
  }));
}

// ---------------------------------------------------------------------------
// Geometry layout (vertex counts and the static index/uv buffers)
// ---------------------------------------------------------------------------

/** A tube's ring grid repeats its first column so the texture wraps without a seam. */
const BODY_VERTS = BODY_RINGS * (BODY_SIDES + 1);
const ARM_VERTS = ARM_RINGS * (ARM_SIDES + 1);
const BLOWER_VERTS = 20;
const ARM_BASE = BODY_VERTS;
const BLOWER_BASE = BODY_VERTS + 2 * ARM_VERTS;
const VERTEX_COUNT = BLOWER_BASE + BLOWER_VERTS;

function gridIndices(out: number[], base: number, rings: number, sides: number): void {
  for (let r = 0; r < rings - 1; r++) {
    for (let s = 0; s < sides; s++) {
      const a = base + r * (sides + 1) + s;
      const b = a + sides + 1;
      out.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
}

const SHARED_INDEX: number[] = (() => {
  const out: number[] = [];
  gridIndices(out, 0, BODY_RINGS, BODY_SIDES);
  gridIndices(out, ARM_BASE, ARM_RINGS, ARM_SIDES);
  gridIndices(out, ARM_BASE + ARM_VERTS, ARM_RINGS, ARM_SIDES);
  // Blower: four sides and the top, four vertices each (flat normals).
  for (let f = 0; f < 5; f++) {
    const a = BLOWER_BASE + f * 4;
    out.push(a, a + 1, a + 2, a, a + 2, a + 3);
  }
  return out;
})();

const SHARED_UV: Float32Array = (() => {
  const uv = new Float32Array(VERTEX_COUNT * 2);
  const grid = (base: number, rings: number, sides: number, v0: number, v1: number): void => {
    for (let r = 0; r < rings; r++) {
      const v = v0 + (v1 - v0) * (r / (rings - 1));
      for (let s = 0; s <= sides; s++) {
        const i = base + r * (sides + 1) + s;
        uv[i * 2] = s / sides;
        uv[i * 2 + 1] = v;
      }
    }
  };
  grid(0, BODY_RINGS, BODY_SIDES, BODY_V0, 1);
  grid(ARM_BASE, ARM_RINGS, ARM_SIDES, ARM_V0, ARM_V1);
  grid(ARM_BASE + ARM_VERTS, ARM_RINGS, ARM_SIDES, ARM_V0, ARM_V1);
  for (let i = BLOWER_BASE; i < VERTEX_COUNT; i++) {
    uv[i * 2] = BLOWER_UV;
    uv[i * 2 + 1] = BLOWER_UV;
  }
  return uv;
})();

/** The blower box never moves: written once per geometry. */
function writeBlower(position: Float32Array, normal: Float32Array): void {
  const w = BLOWER_HALF_W;
  const h = BLOWER_H;
  const faces: readonly (readonly number[])[] = [
    // corners (x, y, z) ×4, then the normal
    [-w, 0, w, w, 0, w, w, h, w, -w, h, w, 0, 0, 1],
    [w, 0, -w, -w, 0, -w, -w, h, -w, w, h, -w, 0, 0, -1],
    [w, 0, w, w, 0, -w, w, h, -w, w, h, w, 1, 0, 0],
    [-w, 0, -w, -w, 0, w, -w, h, w, -w, h, -w, -1, 0, 0],
    [-w, h, w, w, h, w, w, h, -w, -w, h, -w, 0, 1, 0],
  ];
  for (let f = 0; f < faces.length; f++) {
    const face = faces[f]!;
    for (let c = 0; c < 4; c++) {
      const i = BLOWER_BASE + f * 4 + c;
      position[i * 3] = face[c * 3]!;
      position[i * 3 + 1] = face[c * 3 + 1]!;
      position[i * 3 + 2] = face[c * 3 + 2]!;
      normal[i * 3] = face[12]!;
      normal[i * 3 + 1] = face[13]!;
      normal[i * 3 + 2] = face[14]!;
    }
  }
}

// ---------------------------------------------------------------------------
// Sweeping a tube along a chain
// ---------------------------------------------------------------------------

const _p = new THREE.Vector3();
const _t = new THREE.Vector3();
const _n = new THREE.Vector3();
const _b = new THREE.Vector3();
const _side = new THREE.Vector3();

/** Catmull-Rom point and tangent at parameter t ∈ [0, count - 1] of a flat xyz chain. */
function curveAt(points: Float32Array, count: number, t: number, outP: THREE.Vector3, outT: THREE.Vector3): void {
  const k = Math.min(count - 2, Math.floor(t));
  const u = t - k;
  const i0 = Math.max(0, k - 1) * 3;
  const i1 = k * 3;
  const i2 = (k + 1) * 3;
  const i3 = Math.min(count - 1, k + 2) * 3;
  const u2 = u * u;
  const u3 = u2 * u;
  for (let c = 0; c < 3; c++) {
    const p0 = points[i0 + c]!;
    const p1 = points[i1 + c]!;
    const p2 = points[i2 + c]!;
    const p3 = points[i3 + c]!;
    const a = 2 * p1;
    const b = p2 - p0;
    const d = 2 * p0 - 5 * p1 + 4 * p2 - p3;
    const e = -p0 + 3 * p1 - 3 * p2 + p3;
    outP.setComponent(c, 0.5 * (a + b * u + d * u2 + e * u3));
    outT.setComponent(c, 0.5 * (b + 2 * d * u + 3 * e * u2));
  }
  if (outT.lengthSq() < 1e-10) outT.set(0, 1, 0);
  outT.normalize();
}

/**
 * Writes `rings` rings round the curve through `points`, radius from `radius(s)`
 * (s = 0..1 along the tube) scaled by `inflate`. The first ring's frame starts from
 * `seed` (the direction u = 0.5 faces), then each ring's normal is the previous one
 * with the new tangent projected out: rotation-minimising, so the tube never twists.
 */
function sweep(
  points: Float32Array,
  count: number,
  rings: number,
  sides: number,
  base: number,
  seed: THREE.Vector3,
  radius: (s: number) => number,
  inflate: number,
  position: Float32Array,
  normal: Float32Array,
): void {
  for (let r = 0; r < rings; r++) {
    const s = r / (rings - 1);
    curveAt(points, count, s * (count - 1), _p, _t);
    // Rotation-minimising frame: carry the previous normal, take the tangent out.
    if (r === 0) _n.copy(seed);
    _n.addScaledVector(_t, -_n.dot(_t));
    if (_n.lengthSq() < 1e-8) _n.set(1, 0, 0).addScaledVector(_t, -_t.x);
    _n.normalize();
    _b.crossVectors(_t, _n);
    const rad = radius(s) * inflate;
    for (let k = 0; k <= sides; k++) {
      // u = 0.5 is the seed direction, so the face prints where the seed points.
      const theta = (k / sides - 0.5) * Math.PI * 2;
      const c = Math.cos(theta);
      const sn = Math.sin(theta);
      const nx = _n.x * c + _b.x * sn;
      const ny = _n.y * c + _b.y * sn;
      const nz = _n.z * c + _b.z * sn;
      const i = (base + r * (sides + 1) + k) * 3;
      position[i] = _p.x + nx * rad;
      position[i + 1] = _p.y + ny * rad;
      position[i + 2] = _p.z + nz * rad;
      normal[i] = nx;
      normal[i + 1] = ny;
      normal[i + 2] = nz;
    }
  }
}

/** Body radius along the tube: a slight belly, then a dome that closes the crown. */
function bodyRadius(s: number): number {
  const belly = 1 + 0.06 * Math.sin(s * Math.PI);
  const crown = 0.93;
  if (s <= crown) return BODY_RADIUS_M * belly;
  const d = (s - crown) / (1 - crown);
  return BODY_RADIUS_M * belly * Math.sqrt(Math.max(0, 1 - d * d));
}

function armRadius(s: number): number {
  // Narrow out of the body, flaring at the open end the air leaves by.
  return ARM_RADIUS_M + (ARM_FLARE_M - ARM_RADIUS_M) * s * s * s;
}

// ---------------------------------------------------------------------------
// One dancer
// ---------------------------------------------------------------------------

/** Where a dancer stands, in absolute metres. */
export interface DancerSite {
  readonly x: number;
  readonly z: number;
  /** Ground height at the site, absolute. */
  readonly y: number;
  /** Facing: the face looks along this yaw's +Z, i.e. at the road. */
  readonly yaw: number;
  readonly seed: number;
  /** The chunk's build origin, so the rig can be placed in the chunk's own frame. */
  readonly originX: number;
  readonly originZ: number;
}

/** The chunk that built a dancer hands this back on dispose. */
export interface DancerHandle {
  readonly root: THREE.Group;
}

/** A car near a dancer this frame, in that dancer's own frame. */
interface CarProbe {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  vx: number;
  vz: number;
}

const FRONT = new THREE.Vector3(0, 0, 1);

class Dancer implements DancerHandle {
  readonly root = new THREE.Group();
  readonly absX: number;
  readonly absZ: number;
  readonly yaw: number;
  readonly geometry: THREE.BufferGeometry;
  private readonly position: Float32Array;
  private readonly normal: Float32Array;
  /** Chains, xyz flat: the body, then each arm. Previous positions for the integrator. */
  readonly body = new Float32Array(BODY_POINTS * 3);
  readonly bodyPrev = new Float32Array(BODY_POINTS * 3);
  readonly arms = [new Float32Array(ARM_POINTS * 3), new Float32Array(ARM_POINTS * 3)] as const;
  readonly armsPrev = [new Float32Array(ARM_POINTS * 3), new Float32Array(ARM_POINTS * 3)] as const;
  /** Seeded character: turbulence phases and rates, so no two dance in step. */
  readonly seed: number;
  readonly phase: Float32Array = new Float32Array(6);
  readonly rate: number;
  /** Blower flow (target) and the tube's actual pressure, 0..1. */
  air = 1;
  dropStart: number;
  dropEnd: number;
  drops = 0;
  chokeUntil = -1;
  carCount = 0;
  readonly cars: CarProbe[] = Array.from({ length: MAX_CARS }, () => ({ ax: 0, az: 0, bx: 0, bz: 0, vx: 0, vz: 0 }));
  /** Leftover simulation time below one step. */
  accumulator = 0;

  constructor(site: DancerSite, now: number) {
    this.absX = site.x;
    this.absZ = site.z;
    this.yaw = site.yaw;
    this.seed = site.seed;
    for (let k = 0; k < this.phase.length; k++) {
      this.phase[k] = hashUnit3(site.seed, DANCER_DOMAIN, k) * Math.PI * 2;
    }
    this.rate = 0.85 + hashUnit3(site.seed, DANCER_DOMAIN, 10) * 0.35;
    this.dropStart = now + 1.5 + hashUnit3(site.seed, DANCER_DOMAIN, 11) * 5;
    this.dropEnd = this.dropStart + DROP_LEN_MIN_S;

    // Standing straight up, arms out and up.
    for (let i = 0; i < BODY_POINTS; i++) {
      this.body[i * 3] = 0;
      this.body[i * 3 + 1] = BLOWER_H + i * BODY_SEG_M;
      this.body[i * 3 + 2] = 0;
    }
    this.bodyPrev.set(this.body);
    for (let a = 0; a < 2; a++) {
      const arm = this.arms[a];
      const side = ARM_SIDE[a];
      for (let i = 0; i < ARM_POINTS; i++) {
        arm[i * 3] = side * i * ARM_SEG_M * 0.8;
        arm[i * 3 + 1] = this.body[ARM_ATTACH * 3 + 1]! + i * ARM_SEG_M * 0.6;
        arm[i * 3 + 2] = 0;
      }
      this.armsPrev[a].set(arm);
    }

    this.position = new Float32Array(VERTEX_COUNT * 3);
    this.normal = new Float32Array(VERTEX_COUNT * 3);
    writeBlower(this.position, this.normal);
    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(SHARED_INDEX);
    geometry.setAttribute('position', new THREE.BufferAttribute(this.position, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('normal', new THREE.BufferAttribute(this.normal, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('uv', new THREE.BufferAttribute(SHARED_UV, 2));
    // Fixed bounds that hold any pose the chains can reach, so culling works and no
    // per-frame bounds pass is needed.
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2.5, 0), BODY_LEN_M + 2.6);
    this.geometry = geometry;
    this.rebuildMesh();

    const mesh = new THREE.Mesh(geometry, dancerMaterial());
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    this.root.name = 'airdancer';
    this.root.add(mesh);
  }

  /** Sweeps the body and both arms along the chains into the geometry's buffers. */
  rebuildMesh(): void {
    const inflate = 0.62 + 0.38 * this.air;
    sweep(this.body, BODY_POINTS, BODY_RINGS, BODY_SIDES, 0, FRONT, bodyRadius, inflate, this.position, this.normal);
    for (let a = 0; a < 2; a++) {
      // The arm's frame starts facing forward, like the body's, so its ribs line up.
      sweep(this.arms[a], ARM_POINTS, ARM_RINGS, ARM_SIDES, ARM_BASE + a * ARM_VERTS, FRONT, armRadius, inflate, this.position, this.normal);
    }
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('normal') as THREE.BufferAttribute).needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// The field
// ---------------------------------------------------------------------------

/**
 * Owns every live dancer and the boot anchor that compiles their program before a
 * courier is ever in sight.
 */
export class DancerField {
  private readonly anchor = new THREE.Group();
  private readonly dancers: Dancer[] = [];
  private time = 0;

  constructor(private readonly scene: THREE.Scene) {
    // A real, hidden dancer: same geometry layout, same material. The boot warm-up
    // walks the scene with `traverse`, so this links the program behind the loading
    // cover; nothing draws it.
    this.anchor.name = 'airdancer-anchor';
    this.anchor.visible = false;
    this.anchor.add(new Dancer({ x: 0, z: 0, y: 0, yaw: 0, seed: 0, originX: 0, originZ: 0 }, 0).root);
    scene.add(this.anchor);
  }

  /** Dancers whose chunks are built; zero almost everywhere between couriers. */
  get count(): number {
    return this.dancers.length;
  }

  /** Builds one dancer into `target` (the courier's chunk group). */
  spawn(target: THREE.Object3D, site: DancerSite): DancerHandle {
    const dancer = new Dancer(site, this.time);
    dancer.root.position.set(site.x - site.originX, site.y, site.z - site.originZ);
    dancer.root.rotation.y = site.yaw;
    dancer.root.updateMatrix();
    target.add(dancer.root);
    this.dancers.push(dancer);
    return dancer;
  }

  /** Drops dancers whose chunk has gone and frees their geometry. */
  forget(handles: readonly DancerHandle[]): void {
    if (handles.length === 0) return;
    const dropped = new Set<DancerHandle>(handles);
    for (let i = this.dancers.length - 1; i >= 0; i--) {
      const dancer = this.dancers[i]!;
      if (!dropped.has(dancer)) continue;
      dancer.geometry.dispose();
      this.dancers.splice(i, 1);
    }
  }

  /** Whether absolute (x, z) is close enough to a dancer for a car there to matter. */
  near(x: number, z: number): boolean {
    for (const dancer of this.dancers) {
      const dx = dancer.absX - x;
      const dz = dancer.absZ - z;
      if (dx * dx + dz * dz < KNOCK_REACH_M * KNOCK_REACH_M) return true;
    }
    return false;
  }

  /**
   * A car at absolute (x, z), facing (fx, fz) (unit, ground plane), moving (vx, vz)
   * m/s. Recorded for this frame's simulation in each nearby dancer's own frame; the
   * tube points it overlaps are shoved out of its way inside the solver.
   */
  knock(x: number, z: number, fx: number, fz: number, vx: number, vz: number): void {
    for (const dancer of this.dancers) {
      const dx = x - dancer.absX;
      const dz = z - dancer.absZ;
      if (dx * dx + dz * dz > KNOCK_REACH_M * KNOCK_REACH_M) continue;
      if (dancer.carCount >= MAX_CARS) continue;
      // World into the dancer's frame: the inverse of its yaw.
      const cos = Math.cos(dancer.yaw);
      const sin = Math.sin(dancer.yaw);
      const lx = cos * dx - sin * dz;
      const lz = sin * dx + cos * dz;
      const lfx = cos * fx - sin * fz;
      const lfz = sin * fx + cos * fz;
      const car = dancer.cars[dancer.carCount++]!;
      car.ax = lx - lfx * CAR_HALF_LEN_M;
      car.az = lz - lfz * CAR_HALF_LEN_M;
      car.bx = lx + lfx * CAR_HALF_LEN_M;
      car.bz = lz + lfz * CAR_HALF_LEN_M;
      car.vx = cos * vx - sin * vz;
      car.vz = sin * vx + cos * vz;
    }
  }

  /**
   * Simulates and re-sweeps every dancer near enough to be seen, at a fixed step,
   * from the live weather wind. Absolute camera coordinates: the caller adds the
   * floating origin.
   */
  update(dt: number, cameraX: number, cameraZ: number): void {
    if (this.dancers.length === 0) return;
    this.time += dt;
    for (const dancer of this.dancers) {
      const dx = dancer.absX - cameraX;
      const dz = dancer.absZ - cameraZ;
      if (dx * dx + dz * dz > ANIMATE_RANGE_SQ) {
        dancer.carCount = 0;
        dancer.accumulator = 0;
        continue;
      }
      dancer.accumulator = Math.min(dancer.accumulator + dt, STEP_S * MAX_STEPS);
      // The wind in the dancer's frame, as a push: direction (toward) times speed.
      const cos = Math.cos(dancer.yaw);
      const sin = Math.sin(dancer.yaw);
      const push = weather.windMps * WIND_PUSH;
      const windX = (cos * weather.windX - sin * weather.windZ) * push;
      const windZ = (sin * weather.windX + cos * weather.windZ) * push;
      let stepTime = this.time - dancer.accumulator;
      while (dancer.accumulator >= STEP_S) {
        dancer.accumulator -= STEP_S;
        stepTime += STEP_S;
        this.step(dancer, stepTime, windX, windZ);
      }
      dancer.carCount = 0;
      dancer.rebuildMesh();
    }
  }

  dispose(): void {
    for (const dancer of this.dancers) dancer.geometry.dispose();
    this.dancers.length = 0;
    this.scene.remove(this.anchor);
  }

  /** The blower's flow at `t`: on, but for seeded dropouts and a car's choke. */
  private flow(dancer: Dancer, t: number): number {
    if (t >= dancer.dropEnd) {
      // Schedule the next dropout from this dancer's own seed and count.
      const n = dancer.drops++;
      const gap = DROP_GAP_MIN_S + hashUnit3(dancer.seed, DANCER_DOMAIN, 20 + 2 * n) * (DROP_GAP_MAX_S - DROP_GAP_MIN_S);
      const len = DROP_LEN_MIN_S + hashUnit3(dancer.seed, DANCER_DOMAIN, 21 + 2 * n) * (DROP_LEN_MAX_S - DROP_LEN_MIN_S);
      dancer.dropStart = t + gap;
      dancer.dropEnd = dancer.dropStart + len;
    }
    if (t < dancer.chokeUntil) return DROP_FLOW;
    if (t >= dancer.dropStart) return DROP_FLOW;
    // A healthy blower still pulses a little.
    return 0.9 + 0.1 * Math.sin(t * 5.3 + dancer.phase[0]!);
  }

  private step(dancer: Dancer, t: number, windX: number, windZ: number): void {
    const h = STEP_S;
    const target = this.flow(dancer, t);
    const tau = target < dancer.air ? DEFLATE_S : INFLATE_S;
    dancer.air += (target - dancer.air) * (1 - Math.exp(-h / tau));
    const air = dancer.air;
    const r = dancer.rate;
    const ph = dancer.phase;

    // Body: integrate. Points 0 and 1 are held by the blower's outlet.
    const body = dancer.body;
    const prev = dancer.bodyPrev;
    for (let i = 2; i < BODY_POINTS; i++) {
      const w = i / (BODY_POINTS - 1);
      const turb = TURBULENCE * air * Math.pow(w, TURBULENCE_POW);
      const slack = SLACK * (1 - air) * w;
      // Travelling waves up the tube plus a fast flutter at the top; the wind leans it.
      const ax =
        turb * (Math.sin(t * 2.6 * r + ph[1]! - i * 0.55) + 0.6 * Math.sin(t * 6.1 * r + ph[2]! - i * 0.9) * w) +
        slack * Math.sin(t * 1.7 + ph[3]! + i * 0.7) +
        windX * (0.3 + 0.7 * w);
      const az =
        turb * (Math.cos(t * 2.1 * r + ph[3]! - i * 0.5) + 0.6 * Math.sin(t * 7.3 * r + ph[4]! - i * 1.1) * w) +
        slack * Math.cos(t * 1.3 + ph[4]! + i * 0.6) +
        windZ * (0.3 + 0.7 * w);
      const ay = GRAVITY * (LIFT * air - 1) + turb * 0.25 * Math.sin(t * 4.4 * r + ph[5]! + i);
      integrate(body, prev, i, ax, ay, az, h);
    }
    for (let a = 0; a < 2; a++) {
      const arm = dancer.arms[a];
      const armPrev = dancer.armsPrev[a];
      const side = ARM_SIDE[a];
      for (let i = 1; i < ARM_POINTS; i++) {
        const w = i / (ARM_POINTS - 1);
        const turb = ARM_TURBULENCE * air * w;
        const q = ph[a + 1]! * 1.7;
        const ax = turb * Math.sin(t * 3.4 * r + q - i * 0.8) + side * 4 * air + windX * 0.5;
        const az = turb * Math.cos(t * 2.9 * r + q * 1.3 - i * 0.7) + windZ * 0.5;
        const ay = GRAVITY * (LIFT * 0.92 * air - 1) + turb * 0.6 * Math.sin(t * 5.1 * r + q + i * 0.9);
        integrate(arm, armPrev, i, ax, ay, az, h);
      }
    }

    // Constraints.
    for (let it = 0; it < ITERATIONS; it++) {
      // The outlet holds the first segment upright.
      body[0] = 0;
      body[1] = BLOWER_H;
      body[2] = 0;
      body[3] = 0;
      body[4] = BLOWER_H + BODY_SEG_M;
      body[5] = 0;
      straighten(body, BODY_POINTS, BODY_SEG_M, BEND_STIFFNESS * air, 2);
      lengths(body, BODY_POINTS, BODY_SEG_M, 2);
      for (let a = 0; a < 2; a++) {
        const arm = dancer.arms[a];
        // The arm's root IS the body point: it cannot come off.
        arm[0] = body[ARM_ATTACH * 3]!;
        arm[1] = body[ARM_ATTACH * 3 + 1]!;
        arm[2] = body[ARM_ATTACH * 3 + 2]!;
        // It leaves by the side, out and a little up, whichever way the body leans.
        sideDirection(body, ARM_ATTACH, ARM_SIDE[a], _side);
        const pull = 0.5 * (0.35 + 0.65 * air);
        arm[3] += (arm[0] + _side.x * ARM_SEG_M - arm[3]) * pull;
        arm[4] += (arm[1] + _side.y * ARM_SEG_M - arm[4]) * pull;
        arm[5] += (arm[2] + _side.z * ARM_SEG_M - arm[5]) * pull;
        straighten(arm, ARM_POINTS, ARM_SEG_M, ARM_BEND_STIFFNESS * air, 1);
        lengths(arm, ARM_POINTS, ARM_SEG_M, 1);
      }
      if (dancer.carCount > 0) {
        if (this.shove(dancer, body, dancer.bodyPrev, BODY_POINTS, BODY_RADIUS_M, h)) dancer.chokeUntil = t + KNOCK_CHOKE_S;
        for (let a = 0; a < 2; a++) {
          if (this.shove(dancer, dancer.arms[a], dancer.armsPrev[a], ARM_POINTS, ARM_RADIUS_M, h)) {
            dancer.chokeUntil = t + KNOCK_CHOKE_S;
          }
        }
      }
      ground(body, dancer.bodyPrev, BODY_POINTS, BODY_RADIUS_M);
      ground(dancer.arms[0], dancer.armsPrev[0], ARM_POINTS, ARM_RADIUS_M);
      ground(dancer.arms[1], dancer.armsPrev[1], ARM_POINTS, ARM_RADIUS_M);
    }
  }

  /**
   * Pushes every chain point a car's capsule overlaps out to its surface and gives it
   * the car's velocity; true when anything was touched.
   */
  private shove(dancer: Dancer, chain: Float32Array, prev: Float32Array, count: number, radius: number, h: number): boolean {
    let touched = false;
    for (let c = 0; c < dancer.carCount; c++) {
      const car = dancer.cars[c]!;
      const sx = car.bx - car.ax;
      const sz = car.bz - car.az;
      const len2 = sx * sx + sz * sz;
      const reach = CAR_RADIUS_M + radius;
      for (let i = 1; i < count; i++) {
        const j = i * 3;
        if (chain[j + 1]! > CAR_TOP_M + radius) continue;
        const px = chain[j]!;
        const pz = chain[j + 2]!;
        let u = ((px - car.ax) * sx + (pz - car.az) * sz) / Math.max(1e-6, len2);
        u = Math.min(1, Math.max(0, u));
        const qx = car.ax + sx * u;
        const qz = car.az + sz * u;
        let dx = px - qx;
        let dz = pz - qz;
        const d = Math.hypot(dx, dz);
        if (d >= reach) continue;
        if (d < 1e-4) {
          dx = -sz;
          dz = sx;
        }
        const inv = 1 / Math.max(1e-4, Math.hypot(dx, dz));
        chain[j] = qx + dx * inv * reach;
        chain[j + 2] = qz + dz * inv * reach;
        // Carried along: the point leaves with the car's own velocity.
        prev[j] = chain[j]! - car.vx * h;
        prev[j + 2] = chain[j + 2]! - car.vz * h;
        touched = true;
      }
    }
    return touched;
  }
}

/** One verlet step of point `i`, damped, under acceleration (ax, ay, az). */
function integrate(p: Float32Array, prev: Float32Array, i: number, ax: number, ay: number, az: number, h: number): void {
  const j = i * 3;
  const h2 = h * h;
  for (let c = 0; c < 3; c++) {
    const a = c === 0 ? ax : c === 1 ? ay : az;
    const x = p[j + c]!;
    const v = (x - prev[j + c]!) * DAMPING;
    prev[j + c] = x;
    p[j + c] = x + v + a * h2;
  }
}

/** Hard segment lengths, from the held root outward: the tube never stretches. */
function lengths(p: Float32Array, count: number, seg: number, firstFree: number): void {
  for (let i = 1; i < count; i++) {
    const a = (i - 1) * 3;
    const b = i * 3;
    const dx = p[b]! - p[a]!;
    const dy = p[b + 1]! - p[a + 1]!;
    const dz = p[b + 2]! - p[a + 2]!;
    const d = Math.hypot(dx, dy, dz) || 1e-6;
    const k = (d - seg) / d;
    if (i < firstFree) continue;
    if (i - 1 < firstFree) {
      // The point below is held: this one takes the whole correction.
      p[b] -= dx * k;
      p[b + 1] -= dy * k;
      p[b + 2] -= dz * k;
    } else {
      p[a] += dx * k * 0.5;
      p[a + 1] += dy * k * 0.5;
      p[a + 2] += dz * k * 0.5;
      p[b] -= dx * k * 0.5;
      p[b + 1] -= dy * k * 0.5;
      p[b + 2] -= dz * k * 0.5;
    }
  }
}

/** Pressure: each point pulled toward the line its two predecessors set. */
function straighten(p: Float32Array, count: number, seg: number, stiffness: number, firstFree: number): void {
  if (stiffness <= 0) return;
  for (let i = Math.max(2, firstFree); i < count; i++) {
    const a = (i - 2) * 3;
    const b = (i - 1) * 3;
    const c = i * 3;
    const dx = p[b]! - p[a]!;
    const dy = p[b + 1]! - p[a + 1]!;
    const dz = p[b + 2]! - p[a + 2]!;
    const inv = seg / (Math.hypot(dx, dy, dz) || 1e-6);
    p[c] += (p[b]! + dx * inv - p[c]!) * stiffness;
    p[c + 1] += (p[b + 1]! + dy * inv - p[c + 1]!) * stiffness;
    p[c + 2] += (p[b + 2]! + dz * inv - p[c + 2]!) * stiffness;
  }
}

/** Nothing below the ground (tube radius above it); a point on the ground drags. */
function ground(p: Float32Array, prev: Float32Array, count: number, radius: number): void {
  for (let i = 1; i < count; i++) {
    const j = i * 3;
    if (p[j + 1]! >= radius) continue;
    p[j + 1] = radius;
    prev[j] = p[j]! + (prev[j]! - p[j]!) * 0.5;
    prev[j + 2] = p[j + 2]! + (prev[j + 2]! - p[j + 2]!) * 0.5;
    prev[j + 1] = Math.max(prev[j + 1]!, radius);
  }
}

/**
 * The direction an arm leaves the body at point `i`: the body's side (±X turned with
 * the tube's lean), tilted up the tube.
 */
function sideDirection(body: Float32Array, i: number, side: number, out: THREE.Vector3): void {
  const a = (i - 1) * 3;
  const b = (i + 1) * 3;
  _t.set(body[b]! - body[a]!, body[b + 1]! - body[a + 1]!, body[b + 2]! - body[a + 2]!).normalize();
  // Side = tangent × front: (0,1,0) × (0,0,1) = (1,0,0) when the tube stands straight.
  out.crossVectors(_t, FRONT);
  if (out.lengthSq() < 1e-6) out.set(1, 0, 0);
  out.normalize().multiplyScalar(side * 0.8).addScaledVector(_t, 0.6).normalize();
}
