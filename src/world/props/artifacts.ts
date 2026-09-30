/**
 * The strange things at the 20 km marks: four artefacts that nobody on this road made.
 *
 * They replace the old cairn, chrome shrine and snapped sign, which read as litter or
 * as a badly made obelisk. Each is a few meshes on shared geometry and materials, and
 * each MOVES — slowly, the way something that does not care about you moves:
 *
 *  - MONOLITH: an obsidian slab hanging over a disc of fused glass, bobbing and turning,
 *    glyph seams breathing teal, pebbles floating beneath it.
 *  - ORBIT: a violet crystal spinning over a scorched ring while seven stones circle it
 *    on a tilted orbit, each tumbling.
 *  - BLOOM: hexagonal crystals bursting out of the sand, a pulse of light climbing
 *    through them in turn, one shard floating and turning above.
 *  - GATE: a dark ring half sunk in the sand, its segment lamps chasing round it, and
 *    a shimmering membrane in the hole you can drive through.
 *
 * ANIMATION COSTS NOTHING OFF SCREEN. Every moving mesh sets its own transform from
 * absolute time in `onBeforeRender`, so only what the camera draws is touched, the
 * result is identical whichever pass (shadow or colour) runs first, and there is no
 * per-chunk update to register. The glow materials are module-level and pulse on
 * their own `onBeforeRender` the same way.
 */

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { hash01 } from '../../core/rng';
import { SurfaceType } from '../../core/surfaces';
import type { ChunkContext } from '../chunks';
import { addStatic, yawRotation } from './scatter';

export type ArtifactKind = 'monolith' | 'orbit' | 'bloom' | 'gate';

export interface ArtifactBuild {
  readonly ctx: ChunkContext;
  readonly group: THREE.Group;
  readonly bodies: RAPIER.RigidBody[];
  readonly colliders: RAPIER.Collider[];
  readonly seed: number;
  /** Absolute world position of the artefact's foot. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Road heading at the artefact. */
  readonly heading: number;
}

/** Seconds, from one clock for every artefact. Absolute, so passes agree. */
function now(): number {
  return performance.now() / 1000;
}

/**
 * Lets `pose` move `object` every time it is drawn. The world matrix is rebuilt on the
 * spot, so the frame drawn is the frame posed rather than one behind.
 */
function animate(object: THREE.Mesh, pose: (t: number, o: THREE.Mesh) => void): void {
  object.onBeforeRender = () => {
    pose(now(), object);
    // Chunk content is frozen (`matrixAutoUpdate = false`, world/chunks.ts), so the
    // local matrix is rebuilt by hand before the world one.
    object.updateMatrix();
    object.updateMatrixWorld(true);
  };
}

// ---------------------------------------------------------------------------
// Materials, shared
// ---------------------------------------------------------------------------

const TEAL = new THREE.Color(0x4ff0d8);
const VIOLET = new THREE.Color(0xb46bff);

const matObsidian = new THREE.MeshStandardMaterial({
  color: 0x15141c,
  roughness: 0.22,
  metalness: 0.55,
  flatShading: true,
});
const matGlassFused = new THREE.MeshStandardMaterial({
  color: 0x2a2a30,
  roughness: 0.12,
  metalness: 0.2,
});
const matScorch = new THREE.MeshStandardMaterial({
  color: 0x3b2a22,
  roughness: 1,
  metalness: 0,
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
});
const matStone = new THREE.MeshStandardMaterial({
  color: 0x9a7a5c,
  roughness: 0.95,
  metalness: 0,
  flatShading: true,
});
const matRingMetal = new THREE.MeshStandardMaterial({
  color: 0x2c2f38,
  roughness: 0.35,
  metalness: 0.8,
  flatShading: true,
});

/** A glow material whose intensity breathes between `lo` and `hi` over `period` s. */
function glow(color: THREE.Color, lo: number, hi: number, period: number, phase = 0): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: color.clone().multiplyScalar(0.35),
    emissive: color,
    emissiveIntensity: (lo + hi) / 2,
    roughness: 0.4,
    metalness: 0,
    flatShading: true,
    userData: { lo, hi, period, phase },
  });
}

const glowSeam = glow(TEAL, 0.6, 2.2, 3.4);
const glowRing = glow(TEAL, 0.5, 1.6, 3.4, 0.5);
const glowCore = glow(VIOLET, 1.2, 2.6, 2.2);
const glowLamp = new THREE.MeshStandardMaterial({ color: 0x113c38, emissive: TEAL, emissiveIntensity: 0.15, roughness: 0.4 });

/** Crystal tints, teal to violet; a bloom picks per crystal. */
const crystalMats: readonly THREE.MeshStandardMaterial[] = [0, 0.33, 0.66, 1].map((t) => {
  const c = TEAL.clone().lerp(VIOLET, t);
  return new THREE.MeshStandardMaterial({
    color: c.clone().multiplyScalar(0.55),
    emissive: c,
    emissiveIntensity: 0.35,
    roughness: 0.18,
    metalness: 0.1,
    flatShading: true,
    transparent: true,
    opacity: 0.88,
  });
});

/** Called once a frame by whichever glow mesh is drawn first; cheap and idempotent. */
function breathe(material: THREE.MeshStandardMaterial, t: number): void {
  const { lo, hi, period, phase } = material.userData as { lo: number; hi: number; period: number; phase: number };
  const u = 0.5 + 0.5 * Math.sin(((t / period) + phase) * Math.PI * 2);
  material.emissiveIntensity = lo + (hi - lo) * u * u;
}

// ---------------------------------------------------------------------------
// Geometry, shared
// ---------------------------------------------------------------------------

/** A tall slab, a little narrower at the top: the monolith. */
const slabGeo = (() => {
  const g = new THREE.BoxGeometry(0.95, 4.2, 0.34, 1, 1, 1);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > 0) {
      p.setX(i, p.getX(i) * 0.82);
      p.setZ(i, p.getZ(i) * 0.85);
    }
  }
  g.computeVertexNormals();
  return g;
})();
const seamGeo = new THREE.BoxGeometry(0.05, 3.3, 0.02);
const glyphGeo = new THREE.BoxGeometry(0.28, 0.05, 0.02);
const discGeo = new THREE.CylinderGeometry(2.3, 2.5, 0.08, 40);
const scorchGeo = new THREE.CircleGeometry(3.6, 40).rotateX(-Math.PI / 2);
const groundRingGeo = new THREE.TorusGeometry(1.7, 0.05, 6, 64).rotateX(Math.PI / 2);
const pebbleGeo = new THREE.IcosahedronGeometry(1, 0);
const coreGeo = new THREE.OctahedronGeometry(0.55, 0);
const standingGeo = new THREE.CylinderGeometry(0.22, 0.34, 1.6, 5).translate(0, 0.8, 0);
const crystalBodyGeo = new THREE.CylinderGeometry(1, 1, 1, 6).translate(0, 0.5, 0);
const crystalTipGeo = new THREE.ConeGeometry(1, 0.9, 6).translate(0, 0.45, 0);
const gateRingGeo = new THREE.TorusGeometry(2.7, 0.3, 10, 48);
const gateLampGeo = new THREE.BoxGeometry(0.2, 0.62, 0.66);
const membraneGeo = new THREE.CircleGeometry(2.42, 48);

// ---------------------------------------------------------------------------
// The gate's membrane: a shimmering, iridescent film, additive
// ---------------------------------------------------------------------------

const membraneUniforms = { uTime: { value: 0 } };
const matMembrane = new THREE.ShaderMaterial({
  uniforms: membraneUniforms,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  blending: THREE.AdditiveBlending,
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    varying float vDist;
    void main() {
      vUv = uv * 2.0 - 1.0;
      vec4 mv = modelViewMatrix * vec4( position, 1.0 );
      vDist = length( mv.xyz );
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    varying vec2 vUv;
    varying float vDist;
    void main() {
      float r = length( vUv );
      float a = atan( vUv.y, vUv.x );
      // A slow spiral of ripples drawn inwards, broken by a second, faster set.
      float swirl = sin( r * 18.0 - uTime * 2.2 + a * 3.0 ) * 0.5 + 0.5;
      float ripple = sin( r * 41.0 + uTime * 3.7 - a * 5.0 ) * 0.5 + 0.5;
      float film = swirl * 0.7 + ripple * 0.3;
      vec3 teal = vec3( 0.31, 0.94, 0.85 );
      vec3 violet = vec3( 0.71, 0.42, 1.0 );
      vec3 colour = mix( teal, violet, 0.5 + 0.5 * sin( a * 2.0 + uTime * 0.6 + r * 4.0 ) );
      // Thin in the middle, bright at the rim where the film meets the ring.
      float rim = smoothstep( 0.55, 1.0, r );
      float alpha = ( 0.08 + 0.22 * film + 0.35 * rim ) * ( 1.0 - smoothstep( 0.97, 1.0, r ) );
      alpha *= 1.0 - smoothstep( 250.0, 700.0, vDist );
      gl_FragColor = vec4( colour * alpha, alpha );
    }`,
});

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function root(b: ArtifactBuild, yaw: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(b.x - b.ctx.originX, b.y, b.z - b.ctx.originZ);
  g.rotation.y = yaw;
  b.group.add(g);
  return g;
}

function mesh(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow;
  m.receiveShadow = shadow;
  parent.add(m);
  return m;
}

function buildMonolith(b: ArtifactBuild): void {
  const phase = hash01(b.seed, 1) * 10;
  const g = root(b, hash01(b.seed, 0) * Math.PI * 2);

  mesh(g, scorchGeo, matScorch, false).position.y = 0.03;
  const disc = mesh(g, discGeo, matGlassFused);
  disc.position.y = -0.01;
  const ring = mesh(g, groundRingGeo, glowRing, false);
  ring.position.y = 0.08;
  ring.onBeforeRender = () => breathe(glowRing, now());

  const slab = mesh(g, slabGeo, matObsidian);
  // The seams and glyphs ride on the slab; they are its children, so they move with it.
  for (const side of [-1, 1]) {
    const seam = mesh(slab, seamGeo, glowSeam, false);
    seam.position.set(side * 0.22, -0.1, 0.176);
    seam.onBeforeRender = () => breathe(glowSeam, now());
    const back = mesh(slab, seamGeo, glowSeam, false);
    back.position.set(side * 0.22, -0.1, -0.176);
  }
  for (let i = 0; i < 4; i++) {
    const glyph = mesh(slab, glyphGeo, glowSeam, false);
    glyph.position.set((hash01(b.seed, 20 + i) - 0.5) * 0.18, 0.9 - i * 0.55, 0.177);
    glyph.scale.x = 0.5 + hash01(b.seed, 30 + i);
  }
  const hover = 3.2;
  animate(slab, (t, o) => {
    o.position.y = hover + Math.sin(t * 1.25 + phase) * 0.14;
    o.rotation.y = t * 0.16 + phase;
    o.rotation.z = Math.sin(t * 0.7 + phase) * 0.025;
  });
  // Children do not get their own world matrix update from `animate`: the slab's
  // `updateMatrixWorld` already recurses into them.

  for (let i = 0; i < 4; i++) {
    const pebble = mesh(g, pebbleGeo, matStone);
    const r = 0.1 + hash01(b.seed, 40 + i) * 0.12;
    const ang = (i / 4) * Math.PI * 2 + hash01(b.seed, 50 + i);
    const dist = 0.7 + hash01(b.seed, 60 + i) * 0.7;
    const p0 = hash01(b.seed, 70 + i) * 6;
    pebble.scale.set(r, r * 0.8, r * 1.1);
    animate(pebble, (t, o) => {
      o.position.set(Math.cos(ang) * dist, 0.55 + 0.25 * Math.sin(t * 0.9 + p0), Math.sin(ang) * dist);
      o.rotation.set(t * 0.3 + p0, t * 0.2, 0);
    });
  }

  if (b.ctx.hasPhysics) {
    // The disc is a low step, and the slab above it is out of reach of any car.
    addStatic(b.ctx, b.bodies, b.colliders, b.x, b.y + 0.04, b.z, RAPIER.ColliderDesc.cylinder(0.05, 2.4), SurfaceType.Concrete);
  }
}

function buildOrbit(b: ArtifactBuild): void {
  const phase = hash01(b.seed, 1) * 10;
  const g = root(b, hash01(b.seed, 0) * Math.PI * 2);

  mesh(g, scorchGeo, matScorch, false).position.y = 0.03;
  // Three standing stones around the circle, leaning out as if pushed.
  for (let i = 0; i < 3; i++) {
    const s = mesh(g, standingGeo, matStone);
    const ang = (i / 3) * Math.PI * 2 + hash01(b.seed, 10 + i) * 0.6;
    s.position.set(Math.cos(ang) * 3.1, -0.1, Math.sin(ang) * 3.1);
    s.rotation.set(Math.sin(ang) * 0.18, hash01(b.seed, 14 + i) * 3, -Math.cos(ang) * 0.18);
    s.scale.setScalar(0.8 + hash01(b.seed, 18 + i) * 0.5);
  }

  const core = mesh(g, coreGeo, glowCore, false);
  animate(core, (t, o) => {
    breathe(glowCore, t);
    o.position.y = 2.3 + Math.sin(t * 0.9 + phase) * 0.12;
    o.rotation.set(0.35, t * 0.9 + phase, 0);
    o.scale.set(1, 1.5, 1);
  });

  const tilt = 0.25 + hash01(b.seed, 2) * 0.2;
  const count = 7;
  for (let i = 0; i < count; i++) {
    const stone = mesh(g, pebbleGeo, matStone);
    const r = 0.22 + hash01(b.seed, 30 + i) * 0.22;
    stone.scale.set(r * (0.9 + hash01(b.seed, 40 + i) * 0.5), r, r * (0.8 + hash01(b.seed, 50 + i) * 0.5));
    const offset = (i / count) * Math.PI * 2;
    const radius = 2.2 + hash01(b.seed, 60 + i) * 0.5;
    animate(stone, (t, o) => {
      const a = offset + t * 0.28;
      const x = Math.cos(a) * radius;
      const z = Math.sin(a) * radius;
      o.position.set(x, 2.3 + z * Math.sin(tilt) + Math.sin(t * 1.3 + i) * 0.06, z * Math.cos(tilt));
      o.rotation.set(t * 0.5 + i, t * 0.35 + offset, 0);
    });
  }

  if (b.ctx.hasPhysics) {
    // The standing stones are what a car can meet; the orbit is overhead.
    addStatic(b.ctx, b.bodies, b.colliders, b.x, b.y + 0.8, b.z, RAPIER.ColliderDesc.cylinder(0.8, 3.3), SurfaceType.Rock);
  }
}

function buildBloom(b: ArtifactBuild): void {
  const g = root(b, hash01(b.seed, 0) * Math.PI * 2);
  mesh(g, scorchGeo, matScorch, false).position.y = 0.03;

  const count = 9 + Math.floor(hash01(b.seed, 1) * 5);
  const crystals: THREE.Mesh[] = [];
  for (let i = 0; i < count; i++) {
    const tall = i === 0 ? 3.4 : 0.7 + hash01(b.seed, 10 + i) * 2.4;
    const radius = (i === 0 ? 0.34 : 0.12 + hash01(b.seed, 20 + i) * 0.2) * (0.7 + tall * 0.1);
    const mat = crystalMats[Math.floor(hash01(b.seed, 30 + i) * crystalMats.length)]!;
    const holder = new THREE.Group();
    const ang = hash01(b.seed, 40 + i) * Math.PI * 2;
    const dist = i === 0 ? 0 : 0.3 + hash01(b.seed, 50 + i) * 1.3;
    holder.position.set(Math.cos(ang) * dist, -0.15, Math.sin(ang) * dist);
    // Leaning out from the heart of the cluster, the way a geode breaks open.
    const lean = i === 0 ? 0.05 : 0.2 + (dist / 1.6) * 0.5;
    holder.rotation.set(Math.sin(ang) * lean, hash01(b.seed, 60 + i) * 3, -Math.cos(ang) * lean);
    g.add(holder);
    const body = mesh(holder, crystalBodyGeo, mat);
    body.scale.set(radius, tall, radius);
    const tip = mesh(holder, crystalTipGeo, mat);
    tip.scale.set(radius, radius * 1.6, radius);
    tip.position.y = tall;
    crystals.push(body, tip);
  }
  // The pulse: each material lights up in turn, so the glow climbs through the cluster.
  crystals[0]!.onBeforeRender = () => {
    const t = now();
    crystalMats.forEach((m, k) => {
      const u = Math.max(0, Math.sin(t * 1.6 - k * 0.9));
      m.emissiveIntensity = 0.25 + 1.6 * u * u * u;
    });
  };

  const shard = mesh(g, coreGeo, crystalMats[3]!, false);
  const phase = hash01(b.seed, 2) * 10;
  animate(shard, (t, o) => {
    o.position.y = 4.4 + Math.sin(t * 0.8 + phase) * 0.2;
    o.rotation.set(0.2, t * 0.7, 0.1);
    o.scale.set(0.45, 0.8, 0.45);
  });

  if (b.ctx.hasPhysics) {
    addStatic(b.ctx, b.bodies, b.colliders, b.x, b.y + 1, b.z, RAPIER.ColliderDesc.cylinder(1, 1.4), SurfaceType.Rock);
  }
}

function buildGate(b: ArtifactBuild): void {
  // The ring stands across the road's direction, so its hole looks along the road.
  const yaw = b.heading + Math.PI / 2 + (hash01(b.seed, 0) - 0.5) * 0.5;
  const g = root(b, yaw);
  const centreY = 2.25;

  mesh(g, scorchGeo, matScorch, false).position.y = 0.03;
  const ring = mesh(g, gateRingGeo, matRingMetal);
  ring.position.y = centreY;
  ring.rotation.y = Math.PI / 2;

  const lamps = 16;
  const lampMats: THREE.MeshStandardMaterial[] = [];
  for (let i = 0; i < lamps; i++) {
    const a = (i / lamps) * Math.PI * 2;
    const y = centreY + Math.sin(a) * 2.7;
    if (y < 0.15) continue; // under the sand
    const lampMat = glowLamp.clone();
    lampMats.push(lampMat);
    const lamp = mesh(g, gateLampGeo, lampMat, false);
    lamp.position.set(0, y, Math.cos(a) * 2.7);
    lamp.rotation.x = -a;
  }
  const membrane = mesh(g, membraneGeo, matMembrane, false);
  membrane.position.y = centreY;
  membrane.rotation.y = Math.PI / 2;
  membrane.onBeforeRender = () => {
    const t = now();
    membraneUniforms.uTime.value = t % 1000;
    // A light runs round the ring, three lamps long.
    const head = (t * 5) % lampMats.length;
    lampMats.forEach((m, k) => {
      const d = (head - k + lampMats.length) % lampMats.length;
      m.emissiveIntensity = 0.15 + 2.2 * Math.max(0, 1 - d / 3);
    });
  };

  if (b.ctx.hasPhysics) {
    // Two feet where the ring meets the sand; the hole itself is open.
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    for (const side of [-1, 1]) {
      const lz = side * 2.05;
      addStatic(
        b.ctx, b.bodies, b.colliders,
        b.x + s * lz, b.y + 0.9, b.z + c * lz,
        RAPIER.ColliderDesc.cuboid(0.32, 0.9, 0.6),
        SurfaceType.Concrete,
        yawRotation(yaw),
      );
    }
  }
}

/** Builds one artefact of `kind` at the build's position. */
export function buildArtifact(kind: ArtifactKind, b: ArtifactBuild): void {
  switch (kind) {
    case 'monolith':
      return buildMonolith(b);
    case 'orbit':
      return buildOrbit(b);
    case 'bloom':
      return buildBloom(b);
    case 'gate':
      return buildGate(b);
  }
}

/** Metres further from the asphalt than a sign stands: these are wide. */
export const ARTIFACT_EXTRA_SETBACK_M = 4;
