import * as THREE from 'three';

import type { RebaseShift, WorldOrigin } from '../world/origin';

/**
 * Contact shadows under the wheels of every visible car.
 *
 * A real car is told apart from a car-shaped object by one thing: where its weight is.
 * The wheels are where the body meets the ground, and a wheel carrying nothing looks
 * exactly like a wheel carrying everything — the tyre is a rigid mesh pinned to a ray
 * and it does not squash, so nothing on screen reports the load. Four soft dark quads,
 * one per tyre, sized to the footprint and DARKENED IN PROPORTION TO THE LOAD, report it
 * twice over: a car sits on its wheels instead of hovering over them, and in a corner
 * the inner tyres visibly lighten while the outer ones darken. That transfer of weight
 * is the single most useful thing a driver can be shown, and nothing in the renderer
 * showed it.
 *
 * WHY NOT A SHADOW MAP. There is one, and it misses exactly this. Its frustum is 144 m
 * across at 2048 texels — 7 cm per texel — and at low sun the projection stretches by
 * roughly 15:1 along the light, so a wheel's shadow is a metre-wide smear that detaches
 * from the tyre that casts it. The cheapest graphics tier switches shadow maps off
 * entirely. A contact patch is neither affected by any of that nor costs a shadow pass,
 * and at night it is the only one of the two that still works.
 *
 * ONE DRAW CALL. Every patch on screen lives in a single geometry, exactly as the
 * projected light rig does it, and it is filled in the caller's priority order — nearest
 * first — so a limited pool spends itself on the cars the player can see. Nothing is
 * allocated per frame: the vertices are overwritten in place and the draw range says how
 * many are live.
 */

/** Vehicles whose tyres get a patch. Oldest offers are dropped; nearest are kept. */
export const PATCH_VEHICLES = 12;
/** Quads in the pool: four tyres on each of the vehicles above. */
const PATCH_CAPACITY = PATCH_VEHICLES * 4;
/**
 * Darkness under a tyre carrying its own static load, before the load scale.
 *
 * Tuned against the sand, which is the brightest ground and the one that shows a shadow
 * least: on asphalt the same value reads stronger without doing anything extra, which is
 * correct — a dark surface shows less of the sky.
 */
const BASE_ALPHA = 0.34;
/** Load multiplier at which a patch stops darkening further, so a spike cannot go black. */
const MAX_LOAD_SCALE = 1.15;
/** Lift along the contact normal, metres: enough to clear z-fighting without floating. */
const SURFACE_LIFT = 0.014;

const VERTEX = /* glsl */ `
attribute vec2 quad;
attribute float alpha;
varying vec2 vQuad;
varying float vAlpha;
#include <fog_pars_vertex>

void main() {
  vQuad = quad;
  vAlpha = alpha;
  vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAGMENT = /* glsl */ `
varying vec2 vQuad;
varying float vAlpha;
#include <fog_pars_fragment>

void main() {
  // An ellipse with a soft shoulder rather than a hard edge: a contact patch is a
  // pressure distribution, not a rectangle, and its edge is where the tyre stops
  // touching — which is a gradient, not a line.
  float d = length( vQuad );
  float edge = 1.0 - smoothstep( 0.35, 1.0, d );
  float visibility = 1.0;
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      visibility = exp( -fogDensity * fogDensity * vFogDepth * vFogDepth );
    #else
      visibility = 1.0 - smoothstep( fogNear, fogFar, vFogDepth );
    #endif
  #endif
  // Zero source colour with a OneMinusSrcAlpha destination factor MULTIPLIES the light
  // the ground already received, so a patch can only ever darken. It cannot glow at
  // midnight, and it cannot brighten a bright surface into a highlight.
  gl_FragColor = vec4( 0.0, 0.0, 0.0, vAlpha * edge * visibility );
}`;

export class ContactPatchField {
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly mesh: THREE.Mesh;
  private readonly positions = new Float32Array(PATCH_CAPACITY * 4 * 3);
  private readonly alphas = new Float32Array(PATCH_CAPACITY * 4);
  private readonly positionAttr: THREE.BufferAttribute;
  private readonly alphaAttr: THREE.BufferAttribute;
  private readonly unregisterOrigin: () => void;
  /** Quads written this frame; the draw range follows it. */
  private used = 0;

  constructor(
    private readonly scene: THREE.Scene,
    origin: WorldOrigin,
  ) {
    const quad = new Float32Array(PATCH_CAPACITY * 4 * 2);
    const indices = new Uint32Array(PATCH_CAPACITY * 6);
    for (let i = 0; i < PATCH_CAPACITY; i++) {
      const v = i * 4;
      const o = i * 6;
      // Corners, in the same order the indices below walk them.
      quad[v * 2] = -1;
      quad[v * 2 + 1] = -1;
      quad[v * 2 + 2] = 1;
      quad[v * 2 + 3] = -1;
      quad[v * 2 + 4] = -1;
      quad[v * 2 + 5] = 1;
      quad[v * 2 + 6] = 1;
      quad[v * 2 + 7] = 1;
      indices[o] = v;
      indices[o + 1] = v + 2;
      indices[o + 2] = v + 1;
      indices[o + 3] = v + 1;
      indices[o + 4] = v + 2;
      indices[o + 5] = v + 3;
    }

    this.positionAttr = new THREE.BufferAttribute(this.positions, 3);
    this.positionAttr.setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(this.alphas, 1);
    this.alphaAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.positionAttr);
    this.geometry.setAttribute('quad', new THREE.BufferAttribute(quad, 2));
    this.geometry.setAttribute('alpha', this.alphaAttr);
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { ...THREE.UniformsLib.fog },
      fog: true,
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.ZeroFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    // Patches move through the pool every frame, so the geometry's computed bounds are
    // stale the moment they are written; culling on them would pop the whole field.
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.unregisterOrigin = origin.register(this);
  }

  /** Starts a frame's collection. Nothing is hidden until `endFrame`. */
  beginFrame(): void {
    this.used = 0;
  }

  /**
   * Writes one tyre's patch, or does nothing if the pool is full.
   *
   * All four corners go in ONE ground plane built from the contact normal and the wheel
   * plane's own forward direction, so a patch lies flat on a banked or rutted surface
   * instead of standing up through it.
   */
  add(
    contactX: number,
    contactY: number,
    contactZ: number,
    forwardX: number,
    forwardY: number,
    forwardZ: number,
    normalX: number,
    normalY: number,
    normalZ: number,
    halfWidth: number,
    halfLength: number,
    opacity: number,
  ): void {
    if (opacity <= 0) return;
    if (this.used >= PATCH_CAPACITY) return;

    // Normalise the normal: the terrain's own is unit length already, but a tyre on a
    // collider seam can report one that is not, and a scaled normal sinks the patch.
    const nLength = Math.hypot(normalX, normalY, normalZ) || 1;
    const nx = normalX / nLength;
    const ny = normalY / nLength;
    const nz = normalZ / nLength;

    // The wheel's forward, projected into the ground plane and renormalised. On flat
    // ground this is the wheel's heading; on a slope it is the direction the patch
    // actually lies in, which is what its long axis has to follow.
    const alongN = forwardX * nx + forwardY * ny + forwardZ * nz;
    let ax = forwardX - nx * alongN;
    let ay = forwardY - ny * alongN;
    let az = forwardZ - nz * alongN;
    const aLength = Math.hypot(ax, ay, az);
    if (aLength > 1e-4) {
      ax /= aLength;
      ay /= aLength;
      az /= aLength;
    } else {
      // Degenerate — a wheel pointing straight down the normal. Any axis in the plane
      // will do, and the patch's own shape does not depend on which.
      ax = 1;
      ay = 0;
      az = 0;
    }
    // right = forward × normal, which is in the ground plane and perpendicular to both.
    let rx = ay * nz - az * ny;
    let ry = az * nx - ax * nz;
    let rz = ax * ny - ay * nx;
    const rLength = Math.hypot(rx, ry, rz) || 1;
    rx /= rLength;
    ry /= rLength;
    rz /= rLength;

    const cx = contactX + nx * SURFACE_LIFT;
    const cy = contactY + ny * SURFACE_LIFT;
    const cz = contactZ + nz * SURFACE_LIFT;

    const quad = this.used++;
    const v = quad * 4;
    this.writeVertex(v, cx, cy, cz, ax, ay, az, rx, ry, rz, -halfLength, -halfWidth, opacity);
    this.writeVertex(v + 1, cx, cy, cz, ax, ay, az, rx, ry, rz, -halfLength, halfWidth, opacity);
    this.writeVertex(v + 2, cx, cy, cz, ax, ay, az, rx, ry, rz, halfLength, -halfWidth, opacity);
    this.writeVertex(v + 3, cx, cy, cz, ax, ay, az, rx, ry, rz, halfLength, halfWidth, opacity);
  }

  /**
   * Publishes the frame.
   *
   * The draw range is set only when it changes, and the attribute updates are issued
   * once for the whole pool rather than per patch: twelve cars' worth of tyres is 48
   * quads, and re-uploading that once a frame is a few kilobytes — but flagging it
   * per patch would queue the same upload forty-eight times.
   */
  endFrame(): void {
    const indices = this.used * 6;
    if (this.geometry.drawRange.count !== indices) {
      this.geometry.setDrawRange(0, indices);
    }
    if (this.used === 0) return;
    this.positionAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
  }

  /** Shifts every live vertex across a floating-origin step. */
  rebase(shift: RebaseShift): void {
    // The whole pool, not only the live range: a stale vertex from the previous frame
    // would otherwise be drawn at the wrong place for one frame after the origin moves,
    // which is long enough to see.
    for (let i = 0; i < PATCH_CAPACITY * 4; i++) {
      const i3 = i * 3;
      this.positions[i3] -= shift.dx;
      this.positions[i3 + 2] -= shift.dz;
    }
    this.positionAttr.needsUpdate = true;
  }

  dispose(): void {
    this.unregisterOrigin();
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }

  private writeVertex(
    vertex: number,
    cx: number,
    cy: number,
    cz: number,
    ax: number,
    ay: number,
    az: number,
    rx: number,
    ry: number,
    rz: number,
    along: number,
    across: number,
    opacity: number,
  ): void {
    const i3 = vertex * 3;
    this.positions[i3] = cx + ax * along + rx * across;
    this.positions[i3 + 1] = cy + ay * along + ry * across;
    this.positions[i3 + 2] = cz + az * along + rz * across;
    this.alphas[vertex] = opacity;
  }
}

/** Darkness from the load a tyre is carrying, as a multiplier on the base alpha. */
export function patchOpacity(loadN: number, staticLoadN: number, gain: number): number {
  if (!(gain > 0) || !(staticLoadN > 1)) return 0;
  const scale = Math.min(MAX_LOAD_SCALE, Math.max(0, loadN / staticLoadN));
  return BASE_ALPHA * scale * gain;
}
