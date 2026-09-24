import * as THREE from 'three';

import { applyCloudShadow } from '../render/cloudshadow';
import { applyComicShading } from '../render/comic';
import { CoverKind, Crop, newCoverSample } from './landcover';
import type { WorldOrigin } from './origin';
import type { Road } from './road';
import type { RoadDistance } from './roaddistance';
import type { Terrain } from './terrain';

/**
 * GRASS, drawn by the GPU.
 *
 * WHY IT LOOKS LIKE A CARPET AND NOT LIKE TUFTS. Every blade takes the colour of the
 * ground it grows from, so what shows between blades is the same colour as the blades'
 * roots and the eye reads one continuous sward — seen from above too. Tips are only a
 * little lighter. The comic ground shading lights blades on an upward normal, exactly
 * as it lights the ground, so a blade is the ground with height rather than an object
 * standing on it.
 *
 * WHY IT DOES NOT POP. Three rings, each a square grid of clumps fixed to WORLD cells
 * (a clump never moves as the camera does), denser near and wider-bladed far, out to
 * `RADIUS_M`. In the last `SETTLE_M` a blade lies down into the ground; since it is the
 * ground's colour, that is invisible — there is no edge to see, near or behind.
 *
 * WHERE THE NUMBERS COME FROM. A camera-centred cache of `CACHE_N`² one-metre texels —
 * ground height, ground colour, and grass parameters (height, wheat, flowers) — filled
 * from the land cover and the drawn tiles, wrapped toroidally and topped up a strip
 * at a time as the camera moves, so the vertex shader only reads textures.
 */

const CACHE_N = 256;
const RADIUS_M = 95;
const SETTLE_M = 22;
/** Rings: [inner, outer, cell, blade width]. */
const RINGS: readonly [number, number, number, number][] = [
  [0, 24, 0.2, 0.045],
  [24, 55, 0.45, 0.07],
  [55, RADIUS_M, 0.9, 0.13],
];
const BLADES_PER_CLUMP = 3;
const SEGMENTS = 3;
/** Texels re-sampled per frame while a strip or a tile is pending. */
const FILL_BUDGET = 3000;

function bladeGeometry(): THREE.BufferGeometry {
  // A clump of blades, each a tapering strip of SEGMENTS quads and a tip. `aBlade`
  // is (blade index, height 0..1, side -1..1); the shader shapes everything else.
  const vertsPerBlade = SEGMENTS * 2 + 1;
  const blade: number[] = [];
  const index: number[] = [];
  for (let b = 0; b < BLADES_PER_CLUMP; b++) {
    const base = b * vertsPerBlade;
    for (let k = 0; k < SEGMENTS; k++) {
      const t = k / SEGMENTS;
      blade.push(b, t, -1, b, t, 1);
    }
    blade.push(b, 1, 0);
    for (let k = 0; k < SEGMENTS - 1; k++) {
      const a = base + k * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const a = base + (SEGMENTS - 1) * 2;
    index.push(a, a + 1, a + 2);
  }
  const g = new THREE.InstancedBufferGeometry();
  const count = blade.length / 3;
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(count * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(count * 3).fill(1), 3));
  g.setAttribute('aBlade', new THREE.Float32BufferAttribute(blade, 3));
  g.setIndex(index);
  return g;
}

const cover = newCoverSample();

export class GrassField {
  private readonly heightData = new Float32Array(CACHE_N * CACHE_N);
  private readonly colourData = new Uint8Array(CACHE_N * CACHE_N * 4);
  private readonly paramData = new Uint8Array(CACHE_N * CACHE_N * 4);
  private readonly heightTex: THREE.DataTexture;
  private readonly colourTex: THREE.DataTexture;
  private readonly paramTex: THREE.DataTexture;
  /** World cell of each texel's current content, or NaN: which cell a slot holds. */
  private readonly cellX = new Int32Array(CACHE_N * CACHE_N).fill(0x7fffffff);
  private readonly cellZ = new Int32Array(CACHE_N * CACHE_N).fill(0x7fffffff);
  private readonly pending: number[] = [];
  private pendingHead = 0;
  private windowX = Number.NaN;
  private windowZ = Number.NaN;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly meshes: THREE.Mesh[] = [];
  private time = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly origin: WorldOrigin,
    private readonly terrain: Terrain,
    private readonly road: Road,
    private readonly roadDistance: RoadDistance,
    private readonly groundHeightAt: (x: number, z: number) => number | null,
  ) {
    this.heightTex = new THREE.DataTexture(this.heightData, CACHE_N, CACHE_N, THREE.RedFormat, THREE.FloatType);
    this.colourTex = new THREE.DataTexture(this.colourData, CACHE_N, CACHE_N, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.paramTex = new THREE.DataTexture(this.paramData, CACHE_N, CACHE_N, THREE.RGBAFormat, THREE.UnsignedByteType);
    for (const t of [this.heightTex, this.colourTex, this.paramTex]) {
      t.minFilter = THREE.NearestFilter;
      t.magFilter = THREE.NearestFilter;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.generateMipmaps = false;
      t.needsUpdate = true;
    }
    this.uniforms = {
      uGrassHeight: { value: this.heightTex },
      uGrassColour: { value: this.colourTex },
      uGrassParams: { value: this.paramTex },
      uOriginMod: { value: new THREE.Vector2() },
      uCamRel: { value: new THREE.Vector2() },
      uTime: { value: 0 },
    };
    const geometry = bladeGeometry();
    for (const [rin, rout, cell, width] of RINGS) {
      const side = Math.ceil((rout * 2) / cell) + 2;
      const g = geometry.clone() as THREE.InstancedBufferGeometry;
      g.instanceCount = side * side;
      const material = this.createMaterial(rin, rout, cell, side, width);
      const mesh = new THREE.Mesh(g, material);
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.userData.snap = { cell, side };
      scene.add(mesh);
      this.meshes.push(mesh);
    }
  }

  private createMaterial(rin: number, rout: number, cell: number, side: number, width: number): THREE.MeshStandardMaterial {
    // Lit EXACTLY as the ground (world/terrainmesh.ts), cloud shadow included: a blade
    // is the ground's own surface with height, and any difference in the light shows
    // up as a band where the grass ends.
    const material = applyCloudShadow(
      applyComicShading(
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0, side: THREE.DoubleSide }),
        { lightingStrength: 0, shadowWarmth: 0, reliefShadeStrength: 0, contourStrength: 0, stippleStrength: 0, spotlightNormals: 'smooth' },
      ),
    );
    const u = this.uniforms;
    const local = {
      uSnapIndex: { value: new THREE.Vector2() },
      uSnapRel: { value: new THREE.Vector2() },
    };
    material.userData.local = local;
    const compileComic = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      compileComic.call(material, shader, renderer);
      Object.assign(shader.uniforms, u, local);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
attribute vec3 aBlade;
uniform sampler2D uGrassHeight;
uniform sampler2D uGrassColour;
uniform sampler2D uGrassParams;
uniform vec2 uOriginMod;
uniform vec2 uCamRel;
uniform float uTime;
uniform vec2 uSnapIndex;
uniform vec2 uSnapRel;
float gHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
ivec2 gTexel( vec2 rel ) {
  vec2 m = mod( floor( rel + uOriginMod ), ${CACHE_N.toFixed(1)} );
  return ivec2( m );
}
float gHeightAt( vec2 rel ) {
  vec2 f = fract( rel + uOriginMod );
  float a = texelFetch( uGrassHeight, gTexel( rel ), 0 ).r;
  float b = texelFetch( uGrassHeight, gTexel( rel + vec2( 1.0, 0.0 ) ), 0 ).r;
  float c = texelFetch( uGrassHeight, gTexel( rel + vec2( 0.0, 1.0 ) ), 0 ).r;
  float d = texelFetch( uGrassHeight, gTexel( rel + vec2( 1.0, 1.0 ) ), 0 ).r;
  return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
}`,
        )
        .replace(
          '#include <color_vertex>',
          `float gSide = ${side.toFixed(1)};
float gCell = ${cell.toFixed(3)};
vec2 gGrid = vec2( mod( float( gl_InstanceID ), gSide ), floor( float( gl_InstanceID ) / gSide ) ) - floor( gSide * 0.5 );
vec2 gIndex = mod( uSnapIndex + gGrid, 8192.0 );
vec2 gJit = vec2( gHash( gIndex ), gHash( gIndex + 17.3 ) );
vec2 gRel = uSnapRel + ( gGrid + gJit ) * gCell;
float gDist = length( gRel - uCamRel );
vec4 gParam = texelFetch( uGrassParams, gTexel( gRel ), 0 );
vec3 gGround = texelFetch( uGrassColour, gTexel( gRel ), 0 ).rgb;
gGround = pow( gGround, vec3( 2.2 ) );
float gRand = gHash( gIndex + 3.1 );
float gUsed = step( ${rin.toFixed(1)}, gDist ) * step( gDist, ${rout.toFixed(1)} );
float gSettle = 1.0 - smoothstep( ${(RADIUS_M - SETTLE_M).toFixed(1)}, ${RADIUS_M.toFixed(1)}, gDist );
float gWheat = gParam.g;
float gFlower = step( 1.0 - gParam.b * 0.12, gHash( gIndex + 9.7 ) ) * step( 0.5, aBlade.y );
float gTall = gParam.r * ( 0.55 + 0.9 * gRand ) * gSettle * gUsed;
vec3 gTip = mix( gGround * vec3( 1.1, 1.1, 1.0 ), vec3( 0.62, 0.46, 0.16 ), gWheat );
vec3 gFlowerColour = gHash( gIndex + 5.5 ) < 0.5 ? vec3( 0.9, 0.88, 0.8 ) : vec3( 0.85, 0.66, 0.08 );
vColor = vec4( 1.0 );
vColor.rgb = mix( gGround, gTip, smoothstep( 0.0, 1.0, aBlade.y ) );
vColor.rgb = mix( vColor.rgb, gFlowerColour, gFlower * step( 0.99, aBlade.y ) );`,
        )
      // Both faces of a blade are lit as its upward normal: three.js flips the normal
      // of a back face, which turned half of every sward toward the ground and dark.
      shader.fragmentShader = shader.fragmentShader.replace(
        'float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;',
        'float faceDirection = 1.0;',
      );
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <begin_vertex>',
          `float gYaw = ( gHash( gIndex + 1.7 ) + aBlade.x / ${BLADES_PER_CLUMP.toFixed(1)} ) * 6.2832;
vec2 gAcross = vec2( cos( gYaw ), sin( gYaw ) );
vec2 gLean = vec2( -gAcross.y, gAcross.x ) * ( 0.25 + 0.35 * gHash( gIndex + aBlade.x ) );
float gWind = sin( uTime * 1.6 + ( gRel.x + uOriginMod.x ) * 0.23 + ( gRel.y + uOriginMod.y ) * 0.19 ) * 0.25 + 0.1;
float gT = aBlade.y;
float gW = ${width.toFixed(3)} * ( 1.0 - gT ) * ( 0.8 + 0.4 * gRand );
// Each blade of a clump stands a little way from the others: from one point they
// read as a star, spread they read as a tussock.
float gSpreadA = ( gHash( gIndex + aBlade.x * 3.7 ) ) * 6.2832;
vec2 gSpread = vec2( cos( gSpreadA ), sin( gSpreadA ) ) * gCell * 0.45 * step( 0.5, aBlade.x );
vec2 gOff = gSpread + gAcross * aBlade.z * gW + ( gLean + vec2( gWind, gWind * 0.5 ) ) * gT * gT * gTall;
float gY = gHeightAt( gRel + gOff ) - 0.05 + gT * gTall * ( 1.0 - 0.25 * gT * gT );
vec3 transformed = vec3( gRel.x + gOff.x, gY, gRel.y + gOff.y );
if ( gTall <= 0.001 ) transformed = vec3( uCamRel.x, -1e4, uCamRel.y );`,
        );
    };
    const key = material.customProgramCacheKey;
    material.customProgramCacheKey = () => `${key.call(material)}:gpu-grass-v1:${cell}`;
    return material;
  }

  /** `x`/`z`: the camera's ABSOLUTE position; `dt`: seconds, for the wind. */
  update(x: number, z: number, dt: number): void {
    this.time = (this.time + dt) % 3600;
    this.uniforms.uTime!.value = this.time;
    (this.uniforms.uOriginMod!.value as THREE.Vector2).set(
      ((this.origin.x % CACHE_N) + CACHE_N) % CACHE_N,
      ((this.origin.z % CACHE_N) + CACHE_N) % CACHE_N,
    );
    (this.uniforms.uCamRel!.value as THREE.Vector2).set(x - this.origin.x, z - this.origin.z);
    for (const mesh of this.meshes) {
      const { cell } = mesh.userData.snap as { cell: number };
      const ix = Math.floor(x / cell);
      const iz = Math.floor(z / cell);
      const local = (mesh.material as THREE.Material).userData.local as {
        uSnapIndex: THREE.IUniform<THREE.Vector2>;
        uSnapRel: THREE.IUniform<THREE.Vector2>;
      };
      local.uSnapIndex.value.set(((ix % 8192) + 8192) % 8192, ((iz % 8192) + 8192) % 8192);
      local.uSnapRel.value.set(ix * cell - this.origin.x, iz * cell - this.origin.z);
    }
    this.refreshWindow(x, z);
    this.fill();
  }

  /** Queues every texel whose slot now belongs to a different world cell. */
  private refreshWindow(x: number, z: number): void {
    const wx = Math.floor(x) - CACHE_N / 2;
    const wz = Math.floor(z) - CACHE_N / 2;
    if (wx === this.windowX && wz === this.windowZ) return;
    const full = !Number.isFinite(this.windowX) || Math.abs(wx - this.windowX) >= CACHE_N || Math.abs(wz - this.windowZ) >= CACHE_N;
    const ox = this.windowX;
    const oz = this.windowZ;
    this.windowX = wx;
    this.windowZ = wz;
    // Nearest first, so the ground under the car is always ready before the horizon.
    const add: number[] = [];
    for (let cz = wz; cz < wz + CACHE_N; cz++) {
      for (let cx = wx; cx < wx + CACHE_N; cx++) {
        if (!full && cx >= ox && cx < ox + CACHE_N && cz >= oz && cz < oz + CACHE_N) continue;
        add.push(cx, cz);
      }
    }
    const cx0 = x;
    const cz0 = z;
    const order = new Array(add.length / 2).fill(0).map((_, i) => i);
    order.sort((a, b) => Math.hypot(add[a * 2]! - cx0, add[a * 2 + 1]! - cz0) - Math.hypot(add[b * 2]! - cx0, add[b * 2 + 1]! - cz0));
    if (full) {
      this.pending.length = 0;
      this.pendingHead = 0;
    }
    for (const i of order) this.pending.push(add[i * 2]!, add[i * 2 + 1]!);
  }

  private fill(): void {
    let done = 0;
    let dirty = false;
    const retry: number[] = [];
    while (this.pendingHead < this.pending.length && done < FILL_BUDGET) {
      const cx = this.pending[this.pendingHead++]!;
      const cz = this.pending[this.pendingHead++]!;
      done++;
      // Stale: the window has moved on past this cell.
      if (cx < this.windowX || cx >= this.windowX + CACHE_N || cz < this.windowZ || cz >= this.windowZ + CACHE_N) continue;
      if (!this.sampleTexel(cx, cz)) retry.push(cx, cz);
      dirty = true;
    }
    if (this.pendingHead >= this.pending.length) {
      this.pending.length = 0;
      this.pendingHead = 0;
    }
    // Cells whose tile had not arrived go to the back of the queue.
    for (const v of retry) this.pending.push(v);
    if (dirty) {
      this.heightTex.needsUpdate = true;
      this.colourTex.needsUpdate = true;
      this.paramTex.needsUpdate = true;
    }
  }

  /** Samples one world cell into its slot. False if its ground is not loaded yet. */
  private sampleTexel(cx: number, cz: number): boolean {
    const slot = (((cz % CACHE_N) + CACHE_N) % CACHE_N) * CACHE_N + (((cx % CACHE_N) + CACHE_N) % CACHE_N);
    const x = cx + 0.5;
    const z = cz + 0.5;
    const y = this.groundHeightAt(x, z);
    const o = slot * 4;
    if (y === null) {
      this.paramData[o] = 0;
      return false;
    }
    this.heightData[slot] = y;
    this.cellX[slot] = cx;
    this.cellZ[slot] = cz;
    let roadDist = this.roadDistance.distAt(x, z, 20);
    let toEdge = 99;
    if (roadDist < 45) {
      const p = this.road.project(x, z, this.roadDistance.ownerAt(x, z, 20));
      roadDist = Math.abs(p.lateral);
      toEdge = roadDist - this.road.halfWidthAt(p.s);
    }
    this.terrain.cover.sample(x, z, roadDist, cover);
    let r = cover.r;
    let g = cover.g;
    let b = cover.b;
    let height = 0.3 + 0.25 * cover.lush;
    let wheat = 0;
    let flowers = cover.lush;
    const wet = this.terrain.wetnessAt(x, z);
    if (cover.kind === CoverKind.Field) {
      const crop = cover.crop;
      if (crop === Crop.Wheat || crop === Crop.Rye) {
        height = 0.9;
        wheat = 1;
        flowers = 0.1;
      } else if (crop === Crop.GreenCrop) {
        height = 0.55;
        flowers = 0;
      } else if (crop === Crop.Stubble) {
        height = 0.12;
        flowers = 0;
      } else if (crop === Crop.Ploughed) {
        height = 0;
      } else {
        height = 0.45;
      }
    } else if (cover.kind === CoverKind.Forest) {
      height = 0.18;
      flowers = 0;
    }
    if (toEdge < 1.0) height = 0;
    else if (toEdge < 4) height *= 0.7;
    else if (toEdge < 9) height *= 1.6; // the uncut ditch
    if (wet > 0.55) height = 0;
    // The ground's colour, as the tiles paint it: mud where it is wet.
    if (wet > 0) {
      const m = Math.min(1, wet * 1.4) * 0.85;
      r += (0.0685 - r) * m;
      g += (0.0467 - g) * m;
      b += (0.0273 - b) * m;
    }
    // Stored gamma-encoded (8 bits), decoded in the shader.
    this.colourData[o] = Math.round(Math.pow(r, 1 / 2.2) * 255);
    this.colourData[o + 1] = Math.round(Math.pow(g, 1 / 2.2) * 255);
    this.colourData[o + 2] = Math.round(Math.pow(b, 1 / 2.2) * 255);
    this.colourData[o + 3] = 255;
    this.paramData[o] = Math.round(Math.min(1, height) * 255);
    this.paramData[o + 1] = wheat * 255;
    this.paramData[o + 2] = Math.round(Math.min(1, flowers) * 255);
    this.paramData[o + 3] = 255;
    return true;
  }
}
