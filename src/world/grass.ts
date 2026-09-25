import * as THREE from 'three';

import { applyCloudShadow } from '../render/cloudshadow';
import { applyComicShading } from '../render/comic';
import { FOREST_SHADE, groundVary } from '../render/groundpaint';
import { injectSeason } from '../render/season';
import { TUFT_KINDS, TUFT_VARIANTS, tuftAtlas } from '../render/tuftpaint';
import { CoverKind, Crop, MUD, newCoverSample } from './landcover';
import type { WorldOrigin } from './origin';
import type { Road } from './road';
import { shoulderWidthAt } from './shoulder';
import {
  TRACK_HALF_WIDTH_M,
  TRACK_MAX_LENGTH_M,
  TRACK_RUT_HALF_M,
  TRACK_RUT_OFFSET_M,
  trackAt,
  trackPossibleNear,
  type TrackSample,
} from './tracks';
import type { RoadDistance } from './roaddistance';
import type { Terrain } from './terrain';

/**
 * GRASS: painted cards, drawn by the GPU.
 *
 * WHAT A TUFT IS. Two crossed quads standing on the ground, turned once in the world
 * (a card that turned to face the camera swept the near grass round like a comb as
 * the car moved), each carrying a painted tuft (render/tuftpaint.ts): a meadow tuft, a tussock, tall grass
 * in flower, or standing crop. The painting holds shade and coverage, not colour: the
 * root takes the colour of the ground it grows from — the land cover's, mottled
 * exactly as the ground paint mottles it — and the tip a lighter one, so tufts and
 * ground read as one sward. Lit on an upward normal, as the ground is.
 *
 * WHY IT IS CHEAP. Four triangles a tuft and a few tens of thousands of tufts, where
 * the fans of blades it replaced took 15 triangles each and 55 thousand of them. The
 * vertex shader drops tufts behind the camera and out to the sides before they reach
 * the rasteriser. Coverage goes through alpha-to-coverage under MSAA, sharpened to a
 * pixel, so edges are smooth with no sorting and no blending.
 *
 * WHY IT NEEDS NO DEPTH. The ink pass outlines by depth, and inked grass is a field
 * of scribbles, so tufts write none; the painting carries its own thin rim instead.
 * Without depth the draw order is the visibility order, so each ring walks its grid
 * from the far side toward the camera, and the rings are drawn far one first.
 *
 * WHY NOTHING MOVES WITH THE CAR. Nothing about a tuft may depend on the camera's
 * distance, except sinking into the ground at the far edge: every such dependence is
 * a ring that travels with the car. Tufts that thinned out with distance by shrinking
 * made a belt of grass that rose ahead of the car and lay down behind it; rings of
 * different density handing over made a line that ran ahead of it. So, as slowroads
 * does it: one grid of constant density out to `RADIUS_M`, and past `RADIUS_M - SPROUT_M` tufts shrink into the ground,
 * whose paint already carries the same strokes — there is no edge to see.
 *
 * WHERE THE NUMBERS COME FROM. A camera-centred cache of `CACHE_N`² one-metre texels —
 * ground height, ground colour, and grass parameters (height, wheat, flowers,
 * density) — filled from the land cover and the drawn tiles, wrapped toroidally and
 * topped up a strip at a time as the camera moves, so the vertex shader only reads
 * textures.
 */

const CACHE_N = 256;
const RADIUS_M = 70;
/** Band at the outer edge over which tufts grow out of the ground. */
const SPROUT_M = 15;
/** Width of the band in which two neighbouring rings hand over. */
const RING_BLEND_M = 8;
/** Rings: [inner, outer, cell, card width]. */
const RINGS: readonly [number, number, number, number][] = [
  [0, RADIUS_M, 0.6, 1],
];
/** Seconds for flattened grass to stand back up. */
const RECOVER_S = 25;
/** Texels re-sampled per frame while a strip or a tile is pending. */
const FILL_BUDGET = 3000;

function cardGeometry(): THREE.InstancedBufferGeometry {
  // Two crossed quads; `aCorner` is (side -1..1, height 0..1, which quad) and the
  // shader places the rest.
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(24), 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(8).fill([0, 1, 0]).flat(), 3));
  g.setAttribute('aCorner', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0, -1, 0, 1, 1, 0, 1, -1, 1, 1, 1, 1, 1], 3));
  g.setIndex([0, 1, 2, 2, 1, 3, 4, 5, 6, 6, 5, 7]);
  return g;
}

const cover = newCoverSample();

const track: TrackSample = { dist: Infinity, fade: 0 };

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
      uCamFwd: { value: new THREE.Vector2(0, 1) },
      uWalk: { value: new THREE.Vector2() },
      uTime: { value: 0 },
    };
    const geometry = cardGeometry();
    RINGS.forEach(([rin, rout, cell, widthScale], ring) => {
      const reach = rout < RADIUS_M ? rout + RING_BLEND_M / 2 : rout;
      const side = Math.ceil((reach * 2) / cell) + 2;
      const g = geometry.clone() as THREE.InstancedBufferGeometry;
      g.instanceCount = side * side;
      const material = this.createMaterial(rin, rout, cell, side, widthScale);
      const mesh = new THREE.Mesh(g, material);
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      // Shadowed as the ground it stands on: see the root lookup in the shader.
      mesh.receiveShadow = true;
      // After everything that writes depth, so tufts still hide behind the car, trees
      // and posts; the far ring first (see the header).
      mesh.renderOrder = 10 + RINGS.length - ring;
      mesh.userData.snap = { cell, side };
      scene.add(mesh);
      this.meshes.push(mesh);
    });
  }

  private createMaterial(rin: number, rout: number, cell: number, side: number, widthScale: number): THREE.MeshStandardMaterial {
    // Lit EXACTLY as the ground (world/terrainmesh.ts), cloud shadow included: a tuft
    // is the ground's own surface with height, and any difference in the light shows
    // up as a band where the grass ends.
    const material = applyCloudShadow(
      applyComicShading(
        new THREE.MeshStandardMaterial({ roughness: 0.93, metalness: 0, side: THREE.DoubleSide, depthWrite: false }),
        { lightingStrength: 0, shadowWarmth: 0, reliefShadeStrength: 0, contourStrength: 0, stippleStrength: 0, spotlightNormals: 'smooth' },
      ),
    );
    material.alphaToCoverage = true;
    const u = this.uniforms;
    const local = {
      uSnapIndex: { value: new THREE.Vector2() },
      uSnapRel: { value: new THREE.Vector2() },
    };
    material.userData.local = local;
    const compileComic = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      compileComic.call(material, shader, renderer);
      injectSeason(shader);
      const vary = groundVary();
      Object.assign(shader.uniforms, u, local, {
        uTuft: { value: tuftAtlas() },
        uGroundVary: { value: vary.texture },
      });
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
attribute vec3 aCorner;
uniform sampler2D uGrassHeight;
uniform sampler2D uGrassColour;
uniform sampler2D uGrassParams;
uniform sampler2D uGroundVary;
uniform vec2 uOriginMod;
uniform vec2 uCamRel;
uniform vec2 uCamFwd;
uniform vec2 uWalk;
uniform float uTime;
uniform vec2 uSnapIndex;
uniform vec2 uSnapRel;
varying vec2 vTuftUv;
varying vec3 vTuftRoot;
varying vec3 vTuftTip;
varying vec3 vTuftAccent;
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
          `#include <color_vertex>
float gSide = ${side.toFixed(1)};
float gCell = ${cell.toFixed(3)};
// Walk the grid from the far side toward the camera: rows run across the view along
// the axis nearer to it (uWalk.x: 1 when that is x; uWalk.y: 1 when the view looks
// toward +axis, where the far rows are the high ones).
float gA = mod( float( gl_InstanceID ), gSide );
float gB = floor( float( gl_InstanceID ) / gSide );
gB = uWalk.y > 0.5 ? gSide - 1.0 - gB : gB;
vec2 gGrid = ( uWalk.x > 0.5 ? vec2( gB, gA ) : vec2( gA, gB ) ) - floor( gSide * 0.5 );
vec2 gIndex = mod( uSnapIndex + gGrid, 8192.0 );
vec2 gJit = vec2( gHash( gIndex ), gHash( gIndex + 17.3 ) );
vec2 gRel = uSnapRel + ( gGrid + gJit ) * gCell;
vec2 gTo = gRel - uCamRel;
float gDist = length( gTo );
vec4 gParam = texelFetch( uGrassParams, gTexel( gRel ), 0 );
vec4 gCache = texelFetch( uGrassColour, gTexel( gRel ), 0 );
vec3 gGround = pow( gCache.rgb, vec3( 2.2 ) );
// Mottled exactly as the ground paint mottles the ground (render/groundpaint.ts).
vec4 gVary = textureLod( uGroundVary, gRel / ${vary.metres.toFixed(1)}, 0.0 );
gGround *= 0.88 + 0.24 * gVary.r;
float gWarm = ( gVary.g - 0.5 ) * 2.0;
gGround *= mix( vec3( 1.0 ), gWarm > 0.0 ? vec3( 1.06, 1.01, 0.86 ) : vec3( 0.93, 1.02, 1.02 ), abs( gWarm ) * 0.6 );
float gRand = gHash( gIndex + 3.1 );
// Hands over to the neighbouring ring across RING_BLEND_M, each tuft at a distance
// of its own, growing over a couple of metres: see the header.
float gInAt = ${(rin - RING_BLEND_M / 2).toFixed(1)} + gHash( gIndex + 11.9 ) * ${RING_BLEND_M.toFixed(1)};
float gOutAt = ${(rout - RING_BLEND_M / 2).toFixed(1)} + gHash( gIndex + 13.7 ) * ${RING_BLEND_M.toFixed(1)};
float gUsed = ${rin > 0 ? 'smoothstep( gInAt - 1.0, gInAt + 1.0, gDist )' : '1.0'}
  * ${rout < RADIUS_M ? '( 1.0 - smoothstep( gOutAt - 1.0, gOutAt + 1.0, gDist ) )' : `step( gDist, ${rout.toFixed(1)} )`};
// Out of sight: behind the camera, or wide of a landscape view.
gUsed *= step( 0.25, dot( gTo, uCamFwd ) / max( gDist, 0.001 ) ) + step( gDist, 4.0 );
float gSprout = 1.0 - smoothstep( ${(RADIUS_M - SPROUT_M).toFixed(1)}, ${RADIUS_M.toFixed(1)}, gDist );
float gWheat = gParam.g;
// The ground's colour for the season, as the ground itself takes it (world/season.ts).
gGround = seasonGround( gGround, vec4( 1.0 - gWheat, gWheat, 0.0, 0.0 ) );
// Tufts gather in clumps: density is the share of cells that carry one here.
float gHere = step( gHash( gIndex + 21.3 ), gParam.a );
// Flattened by a wheel or a boot: lies low and over until it recovers.
float gUpright = gCache.a;
float gTall = gParam.r * 0.78 * ( 0.65 + 0.6 * gRand ) * gSprout * min( 1.0, gUsed ) * gHere * ( 0.3 + 0.7 * gUpright );
float gKindPick = gHash( gIndex + 9.7 );
float gKind = gWheat > 0.5 ? 3.0
  : gKindPick < gParam.b * 0.12 ? 2.0
  : gKindPick > 1.0 - 0.5 * smoothstep( 0.45, 0.8, gParam.r ) ? 1.0
  : 0.0;
// A tuft's mean tone is the ground's own (the painting's mean shade is about 0.55,
// so root 0.66 and tip 1.24 average to 1.0): seen from above the eye sees ground between
// tufts, seen low across a field it sees tufts, and any difference between the two
// is a tone that changes with the view angle — a ring round the car.
vTuftRoot = gGround * 0.66;
vTuftTip = mix( min( gGround * 1.24, vec3( 1.0 ) ), vec3( 0.7, 0.53, 0.2 ), gWheat );
float gHue = gHash( gIndex + 5.5 );
vTuftAccent = gKind > 2.5 ? vec3( 0.78, 0.6, 0.24 )
  : gHue < 0.45 ? vec3( 0.9, 0.88, 0.8 )
  : gHue < 0.8 ? vec3( 0.88, 0.68, 0.08 )
  : vec3( 0.28, 0.36, 0.85 );
// Autumn: the wheat is cut to stubble and the flowers are over.
gTall *= 1.0 - 0.6 * uSeasonDry * gWheat;
vTuftAccent = mix( vTuftAccent, vTuftTip * 0.8, uSeasonDry * 0.85 );`,
        )
        .replace(
          '#include <begin_vertex>',
          `// Faces the camera, turning about the vertical only.
// Turned once, in the world, and crossed with a second card: a card turning to face
// a moving camera swept the near grass round like a comb.
float gYaw = gHash( gIndex + 8.3 ) * 3.1416 + aCorner.z * 1.5708;
vec2 gAcross = vec2( cos( gYaw ), sin( gYaw ) );
float gW = gTall * ${(0.6 * widthScale).toFixed(3)} * ( 0.85 + 0.3 * gHash( gIndex + 7.1 ) ) * ( gKind > 2.5 ? 0.8 : 1.0 );
float gFlip = gHash( gIndex + 2.9 ) < 0.5 ? -1.0 : 1.0;
float gWind = gUpright * ( sin( uTime * 1.6 + ( gRel.x + uOriginMod.x ) * 0.23 + ( gRel.y + uOriginMod.y ) * 0.19 ) * 0.5 + 0.2 );
// Trampled grass lies over, away from where the wheel came from: any fixed way reads.
float gFallA = gHash( gIndex + 4.4 ) * 6.2832;
vec2 gTop = vec2( gWind * 0.18, gWind * 0.09 ) * gTall + vec2( cos( gFallA ), sin( gFallA ) ) * ( 1.0 - gUpright ) * gTall * 1.4;
vec2 gFoot = gRel + gAcross * aCorner.x * gW;
vec2 gAt = gFoot + gTop * aCorner.y;
// Lower than wide, crops apart: from a chase camera looking down every vertical
// line runs to the point under the camera, and a tall tuft is a streak that swings
// round as the car moves. Low tufts keep that streak short, as slowroads crops its own.
float gY = gHeightAt( gFoot ) - 0.05 + aCorner.y * gTall * ( gWheat > 0.5 ? 1.0 : 0.6 );
vec3 transformed = vec3( gAt.x, gY, gAt.y );
if ( gTall <= 0.01 ) transformed = vec3( uCamRel.x, -1e4, uCamRel.y );
// Atlas cell, a couple of texels in from its sides so mips do not borrow a neighbour.
float gCellAt = gKind * ${TUFT_VARIANTS.toFixed(1)} + mod( floor( gHash( gIndex + 6.3 ) * ${TUFT_VARIANTS.toFixed(1)} ) + aCorner.z, ${TUFT_VARIANTS.toFixed(1)} );
vTuftUv = vec2( ( gCellAt + 0.5 + aCorner.x * gFlip * 0.49 ) / ${(TUFT_KINDS * TUFT_VARIANTS).toFixed(1)}, aCorner.y );`,
        )
        // The shadow is looked up at the tuft's ROOT, not up the card. A near-vertical
        // card in the shadow map is mostly acne and came out darker than its ground;
        // unshadowed, tufts glowed in the shade of a tree. From the root, a tuft is in
        // shadow exactly where the ground under it is.
        .replace(
          '#include <shadowmap_vertex>',
          `#ifdef USE_SHADOWMAP
worldPosition = modelMatrix * vec4( gRel.x, gHeightAt( gRel ) + 0.02, gRel.y, 1.0 );
#endif
#include <shadowmap_vertex>`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform sampler2D uTuft;
varying vec2 vTuftUv;
varying vec3 vTuftRoot;
varying vec3 vTuftTip;
varying vec3 vTuftAccent;`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
{
  vec4 tuft = texture2D( uTuft, vTuftUv );
  diffuseColor.rgb = mix( vTuftRoot, vTuftTip, tuft.r );
  diffuseColor.rgb = mix( diffuseColor.rgb, vTuftAccent, tuft.g );
  // Coverage thins as the atlas minifies (a mip averages blade and gap); widen it by
  // the mip level so far tufts keep their body, then sharpen it to about a pixel.
  vec2 tuftTexel = vTuftUv * vec2( textureSize( uTuft, 0 ) );
  float tuftMip = max( 0.0, 0.5 * log2( max( dot( dFdx( tuftTexel ), dFdx( tuftTexel ) ), dot( dFdy( tuftTexel ), dFdy( tuftTexel ) ) ) ) );
  float tuftA = tuft.a * ( 1.0 + tuftMip * 0.22 );
  tuftA = clamp( ( tuftA - 0.5 ) / max( fwidth( tuftA ), 0.0001 ) + 0.5, 0.0, 1.0 );
  if ( tuftA < 0.01 ) discard;
  diffuseColor.a = tuftA;
}`,
        )
        // Both faces of a card are lit as its upward normal: three.js flips the normal
        // of a back face. The chunk is still an \`#include\` here, so it is inlined with
        // the flip removed.
        .replace(
          '#include <normal_fragment_begin>',
          THREE.ShaderChunk.normal_fragment_begin.replace(
            'float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;',
            'float faceDirection = 1.0;',
          ),
        );
    };
    const key = material.customProgramCacheKey;
    material.customProgramCacheKey = () => `${key.call(material)}:grass-cards-v8:${cell}`;
    return material;
  }

  /** Slots currently flattened, standing back up over `RECOVER_S`. */
  private readonly flattened = new Set<number>();
  private recoverCarry = 0;

  /**
   * Flattens the grass in a disc at an ABSOLUTE point: a wheel or a boot passing. It
   * springs back over `RECOVER_S`, so a track across a meadow is visible behind the
   * car and fades after it.
   */
  trample(x: number, z: number, radius: number): void {
    const r = Math.ceil(radius);
    const cx0 = Math.floor(x);
    const cz0 = Math.floor(z);
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const cx = cx0 + dx;
        const cz = cz0 + dz;
        if (Math.hypot(cx + 0.5 - x, cz + 0.5 - z) > radius) continue;
        const slot = (((cz % CACHE_N) + CACHE_N) % CACHE_N) * CACHE_N + (((cx % CACHE_N) + CACHE_N) % CACHE_N);
        if (this.cellX[slot] !== cx || this.cellZ[slot] !== cz) continue;
        const o = slot * 4 + 3;
        if (this.colourData[o]! === 0) continue;
        this.colourData[o] = 0;
        this.flattened.add(slot);
        this.colourTex.needsUpdate = true;
      }
    }
  }

  private recover(dt: number): void {
    if (this.flattened.size === 0) return;
    this.recoverCarry += (dt / RECOVER_S) * 255;
    const step = Math.floor(this.recoverCarry);
    if (step < 1) return;
    this.recoverCarry -= step;
    for (const slot of this.flattened) {
      const o = slot * 4 + 3;
      const v = Math.min(255, this.colourData[o]! + step);
      this.colourData[o] = v;
      if (v >= 255) this.flattened.delete(slot);
    }
    this.colourTex.needsUpdate = true;
  }

  /**
   * `x`/`z`: the camera's ABSOLUTE position; `fx`/`fz`: its look direction on the
   * ground; `dt`: seconds, for the wind.
   */
  update(x: number, z: number, fx: number, fz: number, dt: number): void {
    this.time = (this.time + dt) % 3600;
    this.uniforms.uTime!.value = this.time;
    const flat = Math.hypot(fx, fz);
    if (flat > 1e-4) (this.uniforms.uCamFwd!.value as THREE.Vector2).set(fx / flat, fz / flat);
    const alongX = Math.abs(fx) > Math.abs(fz);
    (this.uniforms.uWalk!.value as THREE.Vector2).set(alongX ? 1 : 0, (alongX ? fx : fz) > 0 ? 1 : 0);
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
    this.recover(dt);
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
    let shoulder = 0;
    track.dist = Infinity;
    if (roadDist < 45 || (roadDist < TRACK_MAX_LENGTH_M + 30 && trackPossibleNear(this.road.seed, this.roadDistance.ownerAt(x, z, 20)))) {
      const p = this.road.project(x, z, this.roadDistance.ownerAt(x, z, 20));
      roadDist = Math.abs(p.lateral);
      const edge = this.road.halfWidthAt(p.s);
      toEdge = roadDist - edge;
      shoulder = shoulderWidthAt(p.s, Math.sign(p.lateral));
      trackAt(this.road.seed, p.s, p.lateral, edge, track);
    }
    this.terrain.cover.sample(x, z, roadDist, cover);
    let r = cover.r;
    let g = cover.g;
    let b = cover.b;
    let height = 0.4 + 0.25 * cover.lush;
    let wheat = 0;
    let flowers = cover.lush;
    // Tufts come in clumps: a slow blotchy field, lusher where the meadow is lush.
    const clump = this.terrain.cover.clumpAt(x, z);
    let density = Math.max(0, Math.min(1, 0.3 + clump * (0.5 + 0.5 * cover.lush)));
    const wet = this.terrain.wetnessAt(x, z);
    if (cover.kind === CoverKind.Field) {
      const crop = cover.crop;
      if (crop === Crop.Wheat || crop === Crop.Rye) {
        // A standing crop is a crop everywhere in its plot: dense, golden.
        height = 0.95;
        wheat = 1;
        flowers = 0.04;
        density = 0.9;
      } else if (crop === Crop.GreenCrop) {
        height = 0.55;
        flowers = 0;
        density = 0.75;
      } else if (crop === Crop.Stubble || crop === Crop.Ploughed) {
        height = 0;
      } else {
        height = 0.5;
      }
    } else if (cover.kind === CoverKind.Forest) {
      height = 0.3;
      flowers = 0;
      density *= 0.4;
    }
    // Off the bare shoulder (world/shoulder.ts), and thin and short just past it, where
    // the grass is taking the gravel back.
    if (toEdge < shoulder + 0.35) height = 0;
    else if (toEdge < shoulder + 1.2) {
      density *= 0.45;
      height *= 0.7;
    } else if (toEdge < 4) density *= 0.35;
    else if (toEdge < 9) {
      // The uncut ditch: tall and thick.
      height *= 1.5;
      density = Math.max(density, 0.65);
    }
    if (wet > 0.55) height = 0;
    // A dirt track (world/tracks.ts): nothing on the ruts, short grass on the strip
    // between them, the verges trodden low.
    if (track.dist < TRACK_HALF_WIDTH_M + 0.6 && track.fade > 0.3) {
      const fromRut = Math.abs(track.dist - TRACK_RUT_OFFSET_M);
      if (fromRut < TRACK_RUT_HALF_M + 0.2) height = 0;
      else height *= 0.55;
    }
    // The ground's colour, as the tiles paint it: mud where it is wet.
    if (wet > 0) {
      const m = Math.min(1, wet * 1.4) * 0.85;
      r += (MUD[0] - r) * m;
      g += (MUD[1] - g) * m;
      b += (MUD[2] - b) * m;
    }
    // A wood's baked shade, exactly as the ground paint takes it (writeGroundWeights in
    // world/deserttiledata.ts): its forest weight, less what mud or plough took.
    let earth = cover.crop === Crop.Ploughed ? cover.plot : 0;
    earth = Math.max(earth, Math.min(1, wet * 1.4));
    const shade = 1 - FOREST_SHADE * cover.forest * (1 - earth);
    r *= shade;
    g *= shade;
    b *= shade;
    // Stored gamma-encoded (8 bits), decoded in the shader.
    this.colourData[o] = Math.round(Math.pow(r, 1 / 2.2) * 255);
    this.colourData[o + 1] = Math.round(Math.pow(g, 1 / 2.2) * 255);
    this.colourData[o + 2] = Math.round(Math.pow(b, 1 / 2.2) * 255);
    // Alpha is how upright the grass stands: a fresh cell is untrampled.
    this.colourData[o + 3] = 255;
    this.flattened.delete(slot);
    this.paramData[o] = Math.round(Math.min(1, height) * 255);
    this.paramData[o + 1] = wheat * 255;
    this.paramData[o + 2] = Math.round(Math.min(1, flowers) * 255);
    this.paramData[o + 3] = Math.round(density * 255);
    return true;
  }
}
