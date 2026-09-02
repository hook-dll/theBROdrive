import * as THREE from 'three';

import type { WheelSprayState } from '../vehicle/vehicle';
import type { RebaseShift, WorldOrigin } from '../world/origin';

/**
 * Visual tyre tracks on sand.
 *
 * Each mark is an independent quad in one fixed ring-buffer geometry. Wheels contribute
 * only after travelling far enough to make another segment, so cost follows distance rather
 * than frame rate. The oldest marks are overwritten after the pool fills: no allocation,
 * scene-node growth, terrain mutation, or collider rebuild occurs while driving.
 */

/** About 575 m of four-wheel travel at the target spacing. */
const SEGMENT_CAPACITY = 8192;
const TARGET_SPACING = 0.28;
const MAX_LINK_DISTANCE = 3;
const TRACK_WIDTH = 0.18;
const SKID_WIDTH_GAIN = 0.06;
/** Lift along the terrain normal: enough to avoid z-fighting without floating. */
const SURFACE_LIFT = 0.012;
const BASE_ALPHA = 0.16;
const SKID_ALPHA_GAIN = 0.18;

interface WheelCursor {
  valid: boolean;
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
}

const VERTEX = /* glsl */ `
attribute float across;
attribute float alpha;
varying float vAcross;
varying float vAlpha;
#include <fog_pars_vertex>

void main() {
  vAcross = across;
  vAlpha = alpha;
  vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAGMENT = /* glsl */ `
varying float vAcross;
varying float vAlpha;
#include <fog_pars_fragment>

void main() {
  float edge = 1.0 - smoothstep( 0.72, 1.0, abs( vAcross ) );
  float visibility = 1.0;
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      visibility = exp( -fogDensity * fogDensity * vFogDepth * vFogDepth );
    #else
      visibility = 1.0 - smoothstep( fogNear, fogFar, vFogDepth );
    #endif
  #endif
  // Zero source colour plus OneMinusSrcAlpha destination blending darkens whatever
  // light the terrain already received. Tracks can never glow independently at night.
  gl_FragColor = vec4( 0.0, 0.0, 0.0, vAlpha * edge * visibility );
}`;


export class SandTyreTracks {
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly mesh: THREE.Mesh;
  private readonly positions = new Float32Array(SEGMENT_CAPACITY * 4 * 3);
  private readonly alpha = new Float32Array(SEGMENT_CAPACITY * 4);
  private readonly positionAttr: THREE.BufferAttribute;
  private readonly alphaAttr: THREE.BufferAttribute;
  private cursors = new WeakMap<WheelSprayState, WheelCursor>();
  private readonly unregisterOrigin: () => void;
  private cursor = 0;
  private count = 0;

  constructor(
    private readonly scene: THREE.Scene,
    origin: WorldOrigin,
  ) {
    const across = new Float32Array(SEGMENT_CAPACITY * 4);
    const indices = new Uint32Array(SEGMENT_CAPACITY * 6);
    for (let i = 0; i < SEGMENT_CAPACITY; i++) {
      const v = i * 4;
      const o = i * 6;
      across[v] = -1;
      across[v + 1] = 1;
      across[v + 2] = -1;
      across[v + 3] = 1;
      indices[o] = v;
      indices[o + 1] = v + 2;
      indices[o + 2] = v + 1;
      indices[o + 3] = v + 1;
      indices[o + 4] = v + 2;
      indices[o + 5] = v + 3;
    }

    this.positionAttr = new THREE.BufferAttribute(this.positions, 3);
    this.positionAttr.setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(this.alpha, 1);
    this.alphaAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.positionAttr);
    this.geometry.setAttribute('across', new THREE.BufferAttribute(across, 1));
    this.geometry.setAttribute('alpha', this.alphaAttr);
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        ...THREE.UniformsLib.fog,
      },
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
    // Marks move through the ring after the geometry's first bounds calculation.
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    scene.add(this.mesh);
    this.unregisterOrigin = origin.register(this);
  }


  /**
   * Extends one wheel's trail, or breaks it when that wheel leaves sand/contact.
   * Interpolation fills high-speed gaps without making emission frame-rate dependent.
   */
  sample(wheel: WheelSprayState, onSand: boolean): void {
    let previous = this.cursors.get(wheel);
    if (!previous) {
      previous = { valid: false, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0 };
      this.cursors.set(wheel, previous);
    }
    if (!onSand || !wheel.inContact) {
      previous.valid = false;
      return;
    }

    const normalLength = Math.hypot(wheel.normalX, wheel.normalY, wheel.normalZ) || 1;
    const nx = wheel.normalX / normalLength;
    const ny = wheel.normalY / normalLength;
    const nz = wheel.normalZ / normalLength;
    if (!previous.valid) {
      this.setCursor(previous, wheel.contactX, wheel.contactY, wheel.contactZ, nx, ny, nz);
      return;
    }

    const dx = wheel.contactX - previous.x;
    const dy = wheel.contactY - previous.y;
    const dz = wheel.contactZ - previous.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance < TARGET_SPACING) return;
    if (distance > MAX_LINK_DISTANCE) {
      this.setCursor(previous, wheel.contactX, wheel.contactY, wheel.contactZ, nx, ny, nz);
      return;
    }

    const pieces = Math.max(1, Math.round(distance / TARGET_SPACING));
    const slip = Math.min(1, Math.max(Math.abs(wheel.slipRatio), wheel.slideT));
    let x0 = previous.x;
    let y0 = previous.y;
    let z0 = previous.z;
    let nx0 = previous.nx;
    let ny0 = previous.ny;
    let nz0 = previous.nz;
    for (let piece = 1; piece <= pieces; piece++) {
      const t = piece / pieces;
      const x1 = previous.x + dx * t;
      const y1 = previous.y + dy * t;
      const z1 = previous.z + dz * t;
      let nx1 = previous.nx + (nx - previous.nx) * t;
      let ny1 = previous.ny + (ny - previous.ny) * t;
      let nz1 = previous.nz + (nz - previous.nz) * t;
      const nLength = Math.hypot(nx1, ny1, nz1) || 1;
      nx1 /= nLength;
      ny1 /= nLength;
      nz1 /= nLength;
      this.writeSegment(x0, y0, z0, nx0, ny0, nz0, x1, y1, z1, nx1, ny1, nz1, slip);
      x0 = x1;
      y0 = y1;
      z0 = z1;
      nx0 = nx1;
      ny0 = ny1;
      nz0 = nz1;
    }
    this.setCursor(previous, wheel.contactX, wheel.contactY, wheel.contactZ, nx, ny, nz);
  }

  rebase(shift: RebaseShift): void {
    for (let i = 0; i < SEGMENT_CAPACITY * 4; i++) {
      const i3 = i * 3;
      this.positions[i3] -= shift.dx;
      this.positions[i3 + 2] -= shift.dz;
    }
    this.positionAttr.needsUpdate = true;
    // Wheel telemetry is rebased by its owning body; stale cursor endpoints must not bridge
    // from the old frame to the first sample in the new one.
    this.cursors = new WeakMap<WheelSprayState, WheelCursor>();
  }

  dispose(): void {
    this.unregisterOrigin();
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }

  private setCursor(
    cursor: WheelCursor,
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
  ): void {
    cursor.valid = true;
    cursor.x = x;
    cursor.y = y;
    cursor.z = z;
    cursor.nx = nx;
    cursor.ny = ny;
    cursor.nz = nz;
  }

  private writeSegment(
    x0: number,
    y0: number,
    z0: number,
    nx0: number,
    ny0: number,
    nz0: number,
    x1: number,
    y1: number,
    z1: number,
    nx1: number,
    ny1: number,
    nz1: number,
    slip: number,
  ): void {
    let tx = x1 - x0;
    let ty = y1 - y0;
    let tz = z1 - z0;
    const tangentLength = Math.hypot(tx, ty, tz) || 1;
    tx /= tangentLength;
    ty /= tangentLength;
    tz /= tangentLength;

    // right = normal × travel: both width axes lie in their endpoint's ground plane.
    let rx0 = ny0 * tz - nz0 * ty;
    let ry0 = nz0 * tx - nx0 * tz;
    let rz0 = nx0 * ty - ny0 * tx;
    const rightLength0 = Math.hypot(rx0, ry0, rz0) || 1;
    rx0 /= rightLength0;
    ry0 /= rightLength0;
    rz0 /= rightLength0;
    let rx1 = ny1 * tz - nz1 * ty;
    let ry1 = nz1 * tx - nx1 * tz;
    let rz1 = nx1 * ty - ny1 * tx;
    const rightLength1 = Math.hypot(rx1, ry1, rz1) || 1;
    rx1 /= rightLength1;
    ry1 /= rightLength1;
    rz1 /= rightLength1;

    const halfWidth = (TRACK_WIDTH + SKID_WIDTH_GAIN * slip) * 0.5;
    const segment = this.cursor;
    this.cursor = (segment + 1) % SEGMENT_CAPACITY;
    if (this.count < SEGMENT_CAPACITY) {
      this.count++;
      this.geometry.setDrawRange(0, this.count * 6);
    }
    const v = segment * 4;
    const opacity = BASE_ALPHA + SKID_ALPHA_GAIN * slip;
    this.writeVertex(v, x0, y0, z0, nx0, ny0, nz0, rx0, ry0, rz0, -halfWidth, opacity);
    this.writeVertex(v + 1, x0, y0, z0, nx0, ny0, nz0, rx0, ry0, rz0, halfWidth, opacity);
    this.writeVertex(v + 2, x1, y1, z1, nx1, ny1, nz1, rx1, ry1, rz1, -halfWidth, opacity);
    this.writeVertex(v + 3, x1, y1, z1, nx1, ny1, nz1, rx1, ry1, rz1, halfWidth, opacity);
    this.positionAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
  }

  private writeVertex(
    vertex: number,
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    rx: number,
    ry: number,
    rz: number,
    across: number,
    opacity: number,
  ): void {
    const i3 = vertex * 3;
    this.positions[i3] = x + rx * across + nx * SURFACE_LIFT;
    this.positions[i3 + 1] = y + ry * across + ny * SURFACE_LIFT;
    this.positions[i3 + 2] = z + rz * across + nz * SURFACE_LIFT;
    this.alpha[vertex] = opacity;
  }
}
