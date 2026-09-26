import * as THREE from 'three';

import { applyCloudShadow } from '../render/cloudshadow';
import { GROUND_COLOR_GLSL, groundColourUniforms } from '../render/look/groundcolor.glsl';
import { groundTextures } from '../render/look/groundtextures';
import { applyWorldLighting } from '../render/look/lighting';
import { injectSeason } from '../render/season';
import type { GraphicsQuality } from '../game/settings';
import { CoverKind, Crop, newCoverSample } from './landcover';
import type { WorldOrigin } from './origin';
import type { Road } from './road';
import type { RoadDistance } from './roaddistance';
import { shoulderWidthAt } from './shoulder';
import type { BasinFootprint } from './lakes';
import type { Terrain } from './terrain';
import {
  TRACK_HALF_WIDTH_M,
  TRACK_MAX_LENGTH_M,
  TRACK_RUT_HALF_M,
  TRACK_RUT_OFFSET_M,
  trackAt,
  trackPossibleNear,
  type TrackSample,
} from './tracks';

/**
 * GRASS: the road verge, as tufts of real blades.
 *
 * WHAT IT IS, AND WHAT IT IS NOT. This is not a meadow. It is a band of tufts that
 * follows the road — short ones where the gravel ends, tall ones in the ditch, thinning
 * outwards into the field — and past the band the ground's own blade photograph is the
 * grass, exactly as slowroads does it (`notes/SrGrass.md` §5). A meadow of tufts out to
 * the horizon would cost a square kilometre of instances to look like a green texture; a
 * band 20-28 m wide looks like a verge, which is the part the eye is ever close to.
 *
 * A TUFT is two crossed cards cut out of `grass_atlas.webp` — eight 256 px cells, each
 * rendered inside a frame of its own size in metres, which `manifest.json` lists — and
 * the card is drawn AT the cell's own size, so the 1.30 m cell is a 1.30 m stand of
 * grass. The atlas is greyscale: it carries the plant's own luminance and nothing else.
 * The colour comes from `groundcolor.glsl.ts`, THE SAME FUNCTION the terrain is painted
 * with, called in the fragment stage with the tuft's own per-vertex inputs and the
 * sprite's own texel brightness as the blade term — the term that decides how far a
 * blade tip has climbed from the green base towards the pale, dry peak. That is why a
 * tuft does not read as a sticker on the ground: it is the ground's own paint, at the
 * ground's own world scales, from the ground's own uniforms, with height.
 *
 * THE LATTICE LIVES IN ROAD SPACE. A tuft's place is (arclength along the road, offset
 * out from the shoulder edge, and which side), not (x, z). A band 28 m wide and 300 m
 * long cannot be covered by an axis-aligned square without paying for the carriageway
 * and for the field beyond it, and any square large enough to reach 150 m along a curve
 * is hundreds of thousands of cells. So there is a small texture of road stations — the
 * centre, the frame and the two edge widths, one station per lattice step — and every
 * cell is anchored to the ABSOLUTE arclength and to the absolute cell index. A cell's
 * position, its jitter, its kind and its colour are therefore pure functions of the
 * world and never of the camera, which is the contract that keeps the combed-grass bug
 * out (`docs/slowroads.md`): nothing about a tuft may depend on the camera except the
 * sink of its far end.
 *
 * THE DENSITY is the notes' own table: `acceptable` a token band, `standard` 20 m at a
 * 0.55 m pitch taking 65 %, `blessing` 28 m at 0.5 m taking 85 %. The far half of the
 * span drops to every other cell in both directions — slowroads' own device, whose outer
 * chunk cells sample at a quarter rate — with a per-cell fade, so the density falls off
 * over thirty metres instead of at a line.
 *
 * THE DATA RULES are the ones the world has always had, and they are the CPU's, in
 * `sampleTexel`: nothing on the carriageway or its gravel shoulder, nothing in a stream
 * bed, a bog, a lake, a rut or on ground the wheels have made wet; standing crop becomes
 * ears, a flowering meadow keeps its flower mask, a wood's floor keeps its baked shade
 * and grows short deep-shade blades.
 *
 * WHY THE CACHE EXISTS. Placement is per lattice cell in the shader, but the world's
 * answer to "what is here" is a query — land cover, road distance, wetness, bogs,
 * streams, lakes. One query per cell per frame is thousands of queries a frame; instead
 * the 256 m window of 1 m texels the previous grass kept is filled a strip at a time as
 * the camera moves and uploaded as rectangles, and every cell reads its own texel. A
 * texel is a metre, so the height is a staircase of a decimetre on a steep verge — the
 * tuft's root, not its surface — and the density, the kind and the shade are fields that
 * are smooth at that scale anyway.
 */

/**
 * One rung of the grass: the band, the pitch, the take and the reach.
 *
 * `band` is measured OUT from the shoulder edge, `cell` is the lattice pitch both ways,
 * `accept` is the share of lattice points that carry a tuft where the ground wants one at
 * all, and `span` is how far along the road tufts are drawn either side of the camera.
 */
interface GrassTier {
  readonly band: number;
  readonly cell: number;
  readonly accept: number;
  readonly span: number;
}

const GRASS_TIERS: Record<GraphicsQuality, GrassTier> = {
  acceptable: { band: 6, cell: 0.9, accept: 0.4, span: 55 },
  standard: { band: 20, cell: 0.55, accept: 0.65, span: 110 },
  blessing: { band: 28, cell: 0.5, accept: 0.85, span: 150 },
};

/** The cache: 1 m texels in a window this many metres square, wrapped toroidally. */
const CACHE_N = 256;
/** Texels sampled per frame while a strip of the window is still to be filled. */
const FILL_BUDGET = 3000;
/** Seconds for flattened grass to stand back up. */
const RECOVER_S = 25;
/**
 * Where the far half of the span starts, as a share of it, and how long its thinning
 * takes. Beyond `FAR_START` the lattice keeps every other cell both ways — a quarter of
 * the tufts, at twice the pitch — so the vertex stage is spent where it can be seen.
 */
const FAR_START = 0.42;
const FAR_FADE_M = 30;
/**
 * The card's own gain, against the ground's.
 *
 * The atlas is a render of real plants with their own shading, so its cut-out texels
 * average 0.098 in linear light (measured over the eight cells), and 1/0.098 = 10.2 is
 * what makes a tuft's MEAN albedo the ground's tint — exactly as `GRASS_GAIN` (1/0.214)
 * does for the ground's own blade photograph. Mean against mean, though, is not what the
 * eye compares: the ground is seen at its own texel scale, so what stands beside a tuft
 * is the photograph's BRIGHT blades and not the average over its dark gaps — measured on
 * the close-up check frame, two and a half times the mean. A tuft is a dense stand whose
 * every texel is a plant, so it presents its mean. The gain therefore carries part of
 * that ratio too: measured on the close-up check frame, 10.2 stood on the ground as a dark
 * card and 26 as a washed-out one; 13 is a tuft of the brightness of the grass it grows
 * out of AND keeps the verge inside the reference frames' own luma (87) and low contrast.
 *
 * One number for all eight cells: the ears and the dry stalks are paler plants and should
 * read paler.
 */
const CARD_GAIN = 13.0;
/** The station texture's two rows: the frame, then the edge widths. */
const STATION_ROW_FRAME = 0.25;
const STATION_ROW_EDGE = 0.75;
/** Stations reach this far past the span, so the texture is rewritten rarely. */
const STATION_MARGIN = 34;

/** Kinds the CPU hands a texel; the shader picks the atlas cell from them. */
const KIND_MEADOW = 0;
const KIND_CROP = 1;
const KIND_FLOWERS = 2;

/**
 * The two crossed cards. `aCorner` is (side -1..1, height 0..1, which card); the unit
 * quad is scaled in the vertex stage by the atlas cell's own frame, so the mesh carries
 * no size of its own.
 */
function cardGeometry(): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(24), 3));
  g.setAttribute(
    'normal',
    new THREE.Float32BufferAttribute(new Array(8).fill([0, 1, 0]).flat(), 3),
  );
  g.setAttribute(
    'aCorner',
    new THREE.Float32BufferAttribute(
      [-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0, -1, 0, 1, 1, 0, 1, -1, 1, 1, 1, 1, 1],
      3,
    ),
  );
  g.setIndex([0, 1, 2, 2, 1, 3, 4, 5, 6, 6, 5, 7]);
  return g;
}

const cover = newCoverSample();
const track: TrackSample = { dist: Infinity, fade: 0 };
const stationPoint = { x: 0, y: 0, z: 0 };

export class GrassField {
  private tier: GrassTier;
  /** Ground height, metres: the tuft's root is read from this, and its normal too. */
  private readonly heightData: Float32Array;
  /** RGBA8: height/1.6 m, kind, baked shade, density. */
  private readonly paramData: Uint8Array;
  /** R8: how upright the grass stands, 255 fresh, 0 flattened by a wheel or a boot. */
  private readonly stateData: Uint8Array;
  private readonly heightTex: THREE.DataTexture;
  private readonly paramTex: THREE.DataTexture;
  private readonly stateTex: THREE.DataTexture;
  private readonly stationTex: THREE.DataTexture;
  /** The station texture's half-float storage, written by `writeStations`. */
  private readonly stationHalf: Uint16Array;
  /** How many stations the texture holds, and the arclength of its first one. */
  private readonly stationCount: number;
  private stationBase = Number.NaN;
  private stationOriginX = Number.NaN;
  private stationOriginZ = Number.NaN;
  /** World cell of each texel's current content: which cell a slot holds. */
  private readonly cellX: Int32Array;
  private readonly cellZ: Int32Array;
  private readonly pending: number[] = [];
  private pendingHead = 0;
  private windowX = Number.NaN;
  private windowZ = Number.NaN;
  /**
   * Basins whose water covers part of the window, refreshed when the window moves.
   *
   * Nothing grows in a lake: the water is drawn from the basin's own bowl, and a grass
   * card standing in it is a tuft in the water — part of where the owner's "озёра
   * являются миражами" came from. The footprints are resolved once per window, so the
   * per-texel test is a distance against a list and not a search.
   */
  private readonly basinScratch: BasinFootprint[] = [];
  private basinCount = 0;
  private readonly uniforms: Record<string, THREE.IUniform> = {};
  private mesh: THREE.Mesh | null = null;
  private time = 0;
  /** The camera's own arclength, carried as the hint for the next projection. */
  private camS = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly origin: WorldOrigin,
    private readonly terrain: Terrain,
    private readonly road: Road,
    private readonly roadDistance: RoadDistance,
    private readonly groundHeightAt: (x: number, z: number) => number | null,
    quality: GraphicsQuality,
  ) {
    this.tier = GRASS_TIERS[quality];
    const n = CACHE_N * CACHE_N;
    this.heightData = new Float32Array(n);
    this.paramData = new Uint8Array(n * 4);
    this.stateData = new Uint8Array(n);
    this.cellX = new Int32Array(n).fill(0x7fffffff);
    this.cellZ = new Int32Array(n).fill(0x7fffffff);
    this.stationCount = Math.ceil((2 * (this.tier.span + STATION_MARGIN)) / this.tier.cell) + 4;
    this.heightTex = this.cacheTexture(this.heightData, THREE.RedFormat, THREE.FloatType);
    this.paramTex = this.cacheTexture(this.paramData, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.stateTex = this.cacheTexture(this.stateData, THREE.RedFormat, THREE.UnsignedByteType);
    // Half floats, because the texture is FILTERED: the lattice steps between stations and
    // a cell sits between two of them, so its road frame is interpolated. A station's own
    // precision at 150 m is 6 cm, a fifth of the jitter the cell carries anyway.
    this.stationHalf = new Uint16Array(this.stationCount * 2 * 4);
    this.stationTex = new THREE.DataTexture(
      this.stationHalf,
      this.stationCount,
      2,
      THREE.RGBAFormat,
      THREE.HalfFloatType,
    );
    this.stationTex.minFilter = THREE.LinearFilter;
    this.stationTex.magFilter = THREE.LinearFilter;
    this.stationTex.generateMipmaps = false;
    this.stationTex.wrapS = THREE.ClampToEdgeWrapping;
    this.stationTex.wrapT = THREE.ClampToEdgeWrapping;
    this.stationTex.needsUpdate = true;
    Object.assign(this.uniforms, {
      uGrassHeight: { value: this.heightTex },
      uGrassParams: { value: this.paramTex },
      uGrassState: { value: this.stateTex },
      uGrassStation: { value: this.stationTex },
      uGrassAtlas: { value: groundTextures().grassAtlas },
      uGrassFlora: { value: groundTextures().grassFlora },
      // The ground's own sampler names, because `groundMeadowAt` / `groundMeadowDetail`
      // are the ground's own functions and name them in their own terms.
      uGroundTexNoiseFine: { value: groundTextures().noiseFine },
      uGroundTexNoiseVariation: { value: groundTextures().noiseVariation },
      uGroundTexDetailNear: { value: groundTextures().detailNear },
      uGroundTexDetailFar: { value: groundTextures().detailFar },
      uStationBaseRel: { value: 0 },
      uStationShift: { value: new THREE.Vector2() },
      uOriginMod: { value: new THREE.Vector2() },
      uCamRel: { value: new THREE.Vector2() },
      uTime: { value: 0 },
    });
    this.buildLattice();
  }

  private cacheTexture(
    data: Uint8Array | Float32Array,
    format: THREE.PixelFormat,
    type: THREE.TextureDataType,
  ): THREE.DataTexture {
    const tex = new THREE.DataTexture(data, CACHE_N, CACHE_N, format, type);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    return tex;
  }

  /** Builds the lattice for the current rung: the geometry's size and the shader's. */
  private buildLattice(): void {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
      this.mesh = null;
    }
    const { cell, span, band } = this.tier;
    // The along-axis is sized to the span, the across-axis to the band, and both carry
    // one cell of slack so a jittered cell is never left out at the edge.
    const along = 2 * (Math.ceil(span / cell) + 1);
    const across = 2 * (Math.ceil(band / cell) + 1);
    const geometry = cardGeometry();
    geometry.instanceCount = along * across;
    const material = this.createMaterial(along, across);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    // NOT shadowed, because the ground is not: the tiles refuse the shadow map outright
    // (world/terrainmesh.ts — its frustum edge read as dark plates), so a tuft that took
    // it stood in shade on a sunlit verge as a dark card. A tuft is the ground's own
    // surface, and it takes exactly what the ground takes.
    mesh.receiveShadow = false;
    // After everything that writes depth, so a tuft still hides behind the car, a tree
    // or a post. Depth is not written: the tufts are the ground's own surface.
    mesh.renderOrder = 10;
    mesh.onBeforeRender = (renderer) => this.upload(renderer);
    this.scene.add(mesh);
    this.mesh = mesh;
    // The band and the pitch changed, so every texel's density and height are stale.
    this.cellX.fill(0x7fffffff);
    this.cellZ.fill(0x7fffffff);
    this.windowX = Number.NaN;
    this.windowZ = Number.NaN;
    this.pending.length = 0;
    this.pendingHead = 0;
    this.stationBase = Number.NaN;
  }

  /** The rung changed: same field, a different band, pitch and reach. */
  setQuality(quality: GraphicsQuality): void {
    const next = GRASS_TIERS[quality];
    if (next === this.tier) return;
    this.tier = next;
    this.buildLattice();
  }

  private createMaterial(along: number, across: number): THREE.MeshStandardMaterial {
    const material = applyWorldLighting(
      applyCloudShadow(
        new THREE.MeshStandardMaterial({
          roughness: 0.93,
          metalness: 0,
          side: THREE.DoubleSide,
          depthWrite: false,
          alphaToCoverage: true,
        }),
      ),
      // The baked shade is the wood's own density, straight out of the params texel: the
      // same field the tiles take theirs from.
      { shade: 'vGrassShade' },
    );
    const { cell, span, band, accept } = this.tier;
    const uniforms = this.uniforms;
    const previousPatch = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      // The patches already on it — cloud shadow and the world lighting — and then this
      // one: the season goes in LAST, because `injectSeason` consumes the `#include
      // <common>` line that both patches and this one hang their declarations off.
      previousPatch.call(material, shader, renderer);
      Object.assign(shader.uniforms, uniforms, groundColourUniforms());
      const lattice = /* glsl */ `
        const float GRASS_CELL = ${cell.toFixed(4)};
        const float GRASS_ALONG = ${along.toFixed(1)};
        const float GRASS_ACROSS = ${across.toFixed(1)};
        const float GRASS_HALF = ${(across / 2).toFixed(1)};
        const float GRASS_MID = ${(along / 2).toFixed(1)};
        const float GRASS_STATIONS = ${this.stationCount.toFixed(1)};
        const float GRASS_SPAN = ${span.toFixed(2)};
        const float GRASS_BAND = ${band.toFixed(2)};
        const float GRASS_ACCEPT = ${accept.toFixed(3)};
        const float GRASS_FAR_START = ${(span * FAR_START).toFixed(2)};
        const float GRASS_FAR_FADE = ${FAR_FADE_M.toFixed(2)};
        const float GRASS_GAIN = ${CARD_GAIN.toFixed(3)};
        const float GRASS_CACHE = ${CACHE_N.toFixed(1)};
      `;
      shader.vertexShader = shader.vertexShader
        // The ground's own colour maths goes in too: the tuft's colour inputs come from
        // `groundMeadowAt`, which is the ground's function and names the ground's samplers.
        .replace('#include <common>', `#include <common>\n${lattice}\n${VERTEX_PRELUDE}\n${GROUND_COLOR_GLSL}`)
        .replace('#include <begin_vertex>', VERTEX_BODY)

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>\n${FRAGMENT_PRELUDE}\n${GROUND_COLOR_GLSL}\n${lattice}`,
        )
        .replace('#include <color_fragment>', FRAGMENT_BODY)
        .replace(
          '#include <normal_fragment_begin>',
          // Both faces of a card are lit by the GROUND's normal — the normal of the terrain
          // the tuft grows out of, from the height cache — so the card's own facing never
          // enters the light, and three's flip of a back face is overridden with it. A
          // crossed card lit by its own facing brightens and darkens as the car passes.
          `${THREE.ShaderChunk.normal_fragment_begin}
normal = normalize( vGrassNormal );`,
        );
      injectSeason(shader);
    };
    const key = material.customProgramCacheKey;
    material.customProgramCacheKey = () => `${key.call(material)}:grass-verge-v1:${along}x${across}`;
    return material;
  }

  /** Slots currently flattened, standing back up over `RECOVER_S`. */
  private readonly flattened = new Set<number>();
  private recoverCarry = 0;

  /**
   * Flattens the grass in a disc at an ABSOLUTE point: a wheel or a boot passing. It
   * springs back over `RECOVER_S`, so a track across a verge is visible behind the car
   * and gone after it.
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
        const slot =
          (((cz % CACHE_N) + CACHE_N) % CACHE_N) * CACHE_N + (((cx % CACHE_N) + CACHE_N) % CACHE_N);
        if (this.cellX[slot] !== cx || this.cellZ[slot] !== cz) continue;
        if (this.stateData[slot] === 0) continue;
        this.stateData[slot] = 0;
        this.flattened.add(slot);
        this.markDirty(cx, cz, true);
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
      const v = Math.min(255, this.stateData[slot]! + step);
      this.stateData[slot] = v;
      if (v >= 255) this.flattened.delete(slot);
      this.markSlotDirty(slot, true);
    }
  }

  /**
   * `x`/`z`: the camera's ABSOLUTE position; `fx`/`fz`: its look direction on the ground,
   * unused by the geometry but kept for the signature the game calls; `dt`: seconds, for
   * the wind.
   */
  update(x: number, z: number, _fx: number, _fz: number, dt: number): void {
    this.time = (this.time + dt) % 3600;
    this.uniforms.uTime!.value = this.time;
    (this.uniforms.uOriginMod!.value as THREE.Vector2).set(
      ((this.origin.x % CACHE_N) + CACHE_N) % CACHE_N,
      ((this.origin.z % CACHE_N) + CACHE_N) % CACHE_N,
    );
    (this.uniforms.uCamRel!.value as THREE.Vector2).set(x - this.origin.x, z - this.origin.z);
    this.camS = this.road.project(x, z, this.camS).s;
    const cell = this.tier.cell;
    const snap = Math.floor(this.camS / cell) * cell;
    if (!(Math.abs(snap - this.stationBase) < STATION_MARGIN * 0.5)) this.writeStations(this.camS);
    this.uniforms.uStationBaseRel!.value = (snap - this.stationBase) / cell;
    (this.uniforms.uStationShift!.value as THREE.Vector2).set(
      this.stationOriginX - this.origin.x,
      this.stationOriginZ - this.origin.z,
    );
    this.refreshWindow(x, z);
    this.fill();
    this.recover(dt);
  }

  /** Writes the road's own frame, one station per lattice step, around the camera. */
  private writeStations(camS: number): void {
    const { cell, span } = this.tier;
    const base = Math.floor((camS - span - STATION_MARGIN) / cell) * cell;
    const data = this.stationHalf;
    const count = this.stationCount;
    for (let k = 0; k < count; k++) {
      const s = Math.min(Math.max(base + k * cell, 0), this.road.length);
      this.road.offsetPoint(s, 0, stationPoint);
      const centreX = stationPoint.x - this.origin.x;
      const centreZ = stationPoint.z - this.origin.z;
      const roadY = stationPoint.y;
      this.road.offsetPoint(s, 1, stationPoint);
      let rightX = stationPoint.x - this.origin.x - centreX;
      let rightZ = stationPoint.z - this.origin.z - centreZ;
      const length = Math.hypot(rightX, rightZ) || 1;
      rightX /= length;
      rightZ /= length;
      const half = this.road.halfWidthAt(s);
      const o = k * 4;
      data[o] = THREE.DataUtils.toHalfFloat(centreX);
      data[o + 1] = THREE.DataUtils.toHalfFloat(centreZ);
      data[o + 2] = THREE.DataUtils.toHalfFloat(rightX);
      data[o + 3] = THREE.DataUtils.toHalfFloat(rightZ);
      const o2 = (count + k) * 4;
      data[o2] = THREE.DataUtils.toHalfFloat(half + shoulderWidthAt(s, 1));
      data[o2 + 1] = THREE.DataUtils.toHalfFloat(half + shoulderWidthAt(s, -1));
      data[o2 + 2] = THREE.DataUtils.toHalfFloat(roadY);
      data[o2 + 3] = THREE.DataUtils.toHalfFloat(half);
    }
    this.stationBase = base;
    this.stationOriginX = this.origin.x;
    this.stationOriginZ = this.origin.z;
    this.stationTex.needsUpdate = true;
  }

  /** Queues every texel whose slot now belongs to a different world cell. */
  private refreshWindow(x: number, z: number): void {
    const wx = Math.floor(x) - CACHE_N / 2;
    const wz = Math.floor(z) - CACHE_N / 2;
    if (wx === this.windowX && wz === this.windowZ) return;
    const full =
      !Number.isFinite(this.windowX) ||
      Math.abs(wx - this.windowX) >= CACHE_N ||
      Math.abs(wz - this.windowZ) >= CACHE_N;
    const ox = this.windowX;
    const oz = this.windowZ;
    this.windowX = wx;
    this.windowZ = wz;
    const cx = wx + CACHE_N / 2;
    const cz = wz + CACHE_N / 2;
    // A basin reaches 484 m from its centre and the window is 256 m square, so the radius
    // is half the diagonal plus that reach.
    this.basinCount = this.terrain.basins.placementsNear(
      cx,
      cz,
      this.roadDistance.ownerAt(cx, cz, 20),
      CACHE_N * 0.71 + 484,
      this.basinScratch,
    );
    const add: number[] = [];
    for (let zz = wz; zz < wz + CACHE_N; zz++) {
      for (let xx = wx; xx < wx + CACHE_N; xx++) {
        if (!full && xx >= ox && xx < ox + CACHE_N && zz >= oz && zz < oz + CACHE_N) continue;
        add.push(xx, zz);
      }
    }
    if (full) {
      this.pending.length = 0;
      this.pendingHead = 0;
    }
    // Nearest first, so the ground under the car is ready before the horizon's.
    const order = new Array(add.length / 2).fill(0).map((_, i) => i);
    order.sort(
      (a, b) =>
        Math.hypot(add[a * 2]! - x, add[a * 2 + 1]! - z) -
        Math.hypot(add[b * 2]! - x, add[b * 2 + 1]! - z),
    );
    for (const i of order) this.pending.push(add[i * 2]!, add[i * 2 + 1]!);
  }

  /** Rows of the window whose content changed, as a span of columns each. */
  private readonly rowMin = new Int32Array(CACHE_N).fill(CACHE_N);
  private readonly rowMax = new Int32Array(CACHE_N).fill(-1);
  /** Rows whose change is to the state texture alone (trampling). */
  private readonly rowStateOnly = new Uint8Array(CACHE_N).fill(1);
  private uploadedOnce = false;

  private markDirty(cx: number, cz: number, stateOnly = false): void {
    this.markSlotDirty(
      (((cz % CACHE_N) + CACHE_N) % CACHE_N) * CACHE_N + (((cx % CACHE_N) + CACHE_N) % CACHE_N),
      stateOnly,
    );
  }

  private markSlotDirty(slot: number, stateOnly = false): void {
    const y = Math.floor(slot / CACHE_N);
    const x = slot - y * CACHE_N;
    if (x < this.rowMin[y]!) this.rowMin[y] = x;
    if (x > this.rowMax[y]!) this.rowMax[y] = x;
    if (!stateOnly) this.rowStateOnly[y] = 0;
  }

  /**
   * Uploads the changed rectangles, or the whole textures the first time. The window
   * moves a cell every metre, and a whole upload is three textures; this is what keeps a
   * drive from re-uploading 300 KB a frame.
   */
  private upload(renderer: THREE.WebGLRenderer): void {
    const props = renderer.properties;
    const ready =
      this.uploadedOnce &&
      [this.heightTex, this.paramTex, this.stateTex].every(
        (t) => (props.get(t) as { __webglTexture?: WebGLTexture }).__webglTexture,
      );
    if (!ready) {
      this.heightTex.needsUpdate = true;
      this.paramTex.needsUpdate = true;
      this.stateTex.needsUpdate = true;
      this.uploadedOnce = true;
      this.rowMin.fill(CACHE_N);
      this.rowMax.fill(-1);
      this.rowStateOnly.fill(1);
      return;
    }
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const state = renderer.state;
    state.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    state.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    state.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    state.pixelStorei(gl.UNPACK_ROW_LENGTH, CACHE_N);
    const put = (
      tex: THREE.DataTexture,
      format: number,
      type: number,
      data: ArrayBufferView,
      x0: number,
      y0: number,
      w: number,
      h: number,
    ): void => {
      state.bindTexture(
        gl.TEXTURE_2D,
        (props.get(tex) as { __webglTexture: WebGLTexture }).__webglTexture,
      );
      state.pixelStorei(gl.UNPACK_SKIP_PIXELS, x0);
      state.pixelStorei(gl.UNPACK_SKIP_ROWS, y0);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, y0, w, h, format, type, data);
    };
    let y = 0;
    while (y < CACHE_N) {
      if (this.rowMax[y]! < 0) {
        y++;
        continue;
      }
      const x0 = this.rowMin[y]!;
      const x1 = this.rowMax[y]!;
      const stateOnly = this.rowStateOnly[y]!;
      let y1 = y + 1;
      while (
        y1 < CACHE_N &&
        this.rowMin[y1] === x0 &&
        this.rowMax[y1] === x1 &&
        this.rowStateOnly[y1] === stateOnly
      ) {
        y1++;
      }
      const w = x1 - x0 + 1;
      const h = y1 - y;
      put(this.stateTex, gl.RED, gl.UNSIGNED_BYTE, this.stateData, x0, y, w, h);
      if (!stateOnly) {
        put(this.heightTex, gl.RED, gl.FLOAT, this.heightData, x0, y, w, h);
        put(this.paramTex, gl.RGBA, gl.UNSIGNED_BYTE, this.paramData, x0, y, w, h);
      }
      for (let k = y; k < y1; k++) {
        this.rowMin[k] = CACHE_N;
        this.rowMax[k] = -1;
        this.rowStateOnly[k] = 1;
      }
      y = y1;
    }
    state.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    state.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
    state.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    state.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  }

  private fill(): void {
    let done = 0;
    const retry: number[] = [];
    while (this.pendingHead < this.pending.length && done < FILL_BUDGET) {
      const cx = this.pending[this.pendingHead++]!;
      const cz = this.pending[this.pendingHead++]!;
      done++;
      // Stale: the window has moved on past this cell.
      if (
        cx < this.windowX ||
        cx >= this.windowX + CACHE_N ||
        cz < this.windowZ ||
        cz >= this.windowZ + CACHE_N
      ) {
        continue;
      }
      if (!this.sampleTexel(cx, cz)) retry.push(cx, cz);
      this.markDirty(cx, cz);
    }
    if (this.pendingHead >= this.pending.length) {
      this.pending.length = 0;
      this.pendingHead = 0;
    }
    // Cells whose tile had not arrived go to the back of the queue.
    for (const v of retry) this.pending.push(v);
  }

  /**
   * Samples one world cell into its slot — and this is where every rule about where grass
   * may stand lives. False if the ground under it is not loaded yet.
   */
  private sampleTexel(cx: number, cz: number): boolean {
    const slot =
      (((cz % CACHE_N) + CACHE_N) % CACHE_N) * CACHE_N + (((cx % CACHE_N) + CACHE_N) % CACHE_N);
    const x = cx + 0.5;
    const z = cz + 0.5;
    const y = this.groundHeightAt(x, z);
    const o = slot * 4;
    if (y === null) {
      this.paramData[o + 3] = 0;
      return false;
    }
    for (let i = 0; i < this.basinCount; i++) {
      const basin = this.basinScratch[i]!;
      const dx = x - basin.x;
      const dz = z - basin.z;
      const wet = basin.inner - 0.5;
      if (dx * dx + dz * dz < wet * wet) {
        this.paramData[o + 3] = 0;
        return true;
      }
    }
    this.heightData[slot] = y;
    this.cellX[slot] = cx;
    this.cellZ[slot] = cz;
    const owner = this.roadDistance.ownerAt(x, z, 20);
    let roadDist = this.roadDistance.distAt(x, z, 20);
    let toEdge = 99;
    let roadY = y;
    track.dist = Infinity;
    if (
      roadDist < 60 ||
      (roadDist < TRACK_MAX_LENGTH_M + 30 && trackPossibleNear(this.road.seed, owner))
    ) {
      const p = this.road.project(x, z, owner);
      roadDist = Math.abs(p.lateral);
      const edge = this.road.halfWidthAt(p.s);
      toEdge = roadDist - edge - shoulderWidthAt(p.s, Math.sign(p.lateral) || 1);
      roadY = this.road.offsetPoint(p.s, 0).y;
      trackAt(this.road.seed, p.s, p.lateral, edge, track);
    }
    this.terrain.cover.sample(x, z, roadDist, cover);
    let height = 0.34 + 0.34 * cover.lush;
    let kind = KIND_MEADOW;
    // Tufts come in clumps: a slow blotchy field, lusher where the meadow is lush.
    const clump = this.terrain.cover.clumpAt(x, z);
    let density = Math.max(0, Math.min(1, 0.28 + clump * (0.5 + 0.5 * cover.lush)));
    const wet = this.terrain.wetnessAt(x, z);
    if (cover.kind === CoverKind.Field) {
      const crop = cover.crop;
      if (crop === Crop.Wheat || crop === Crop.Rye) {
        // A standing crop is a crop everywhere in its plot: dense, and its own atlas cell.
        height = 1.2;
        kind = KIND_CROP;
        density = 0.9;
      } else if (crop === Crop.GreenCrop) {
        height = 0.6;
        density = 0.75;
      } else if (crop === Crop.Stubble || crop === Crop.Ploughed) {
        height = 0;
      } else {
        height = 0.5;
      }
    } else if (cover.kind === CoverKind.Forest) {
      height = 0.4;
      density *= 0.45;
    } else if (cover.lush > 0.55) {
      kind = KIND_FLOWERS;
    }
    // Nothing grows in a watercourse's bed or in a pond (world/streams.ts): it is water
    // and gravel, and a bed of grass tufts standing in the water is the one thing that
    // would make a stream read as a damp ditch.
    const dug = this.terrain.road.landscape.streams.at(x, z);
    if (dug.bed > 0 || dug.bowl > 0.15) height = 0;
    // Nor on a bog: sphagnum and tussocks are not a lawn.
    else if (this.terrain.bogAt(x, z) > 0.45) height = 0;
    // Off the bare shoulder and its first handspan of gravel.
    else if (toEdge < 0.35) height = 0;
    else if (toEdge < 1.2) {
      density *= 0.75;
      height *= 0.7;
    } else if (toEdge < 4) density *= 0.6;
    else if (toEdge < 9) {
      // The ditch: the ground falls away from the road, and the uncut grass with it.
      const fell = Math.max(0, Math.min(1, (roadY - y) / 0.9));
      height = Math.max(height, 0.7 + 0.6 * fell);
      density = Math.max(density, 0.55 + 0.35 * fell);
    }
    if (wet > 0.55) height = 0;
    // A dirt track (world/tracks.ts): nothing on the ruts, short grass between them.
    if (track.dist < TRACK_HALF_WIDTH_M + 0.6 && track.fade > 0.3) {
      const fromRut = Math.abs(track.dist - TRACK_RUT_OFFSET_M);
      if (fromRut < TRACK_RUT_HALF_M + 0.2) height = 0;
      else height *= 0.55;
    }
    // The band. Past it the ground's own blade photograph is the grass, and the last fifth
    // thins out on the ground's own patch noise — which the shader has and the CPU does
    // not, so the thinning is the shader's, and there is no edge to see.
    const past = (toEdge - 4) / Math.max(1, this.tier.band - 4);
    if (past > 0) {
      density *= Math.max(0, 1 - 0.85 * past);
      if (toEdge > this.tier.band) density = 0;
    }
    // A wood's baked shade, exactly as the ground takes it: its forest density, less what
    // mud or plough has taken.
    let earth = cover.crop === Crop.Ploughed ? cover.plot : 0;
    earth = Math.max(earth, Math.min(1, wet * 1.4));
    this.paramData[o] = Math.min(255, Math.round((height / 1.6) * 255));
    this.paramData[o + 1] = kind;
    this.paramData[o + 2] = Math.round(Math.min(1, cover.forest * (1 - earth)) * 255);
    this.paramData[o + 3] = Math.round(density * 255);
    // Alpha is how upright the grass stands: a fresh cell is untrampled.
    this.stateData[slot] = 255;
    this.flattened.delete(slot);
    return true;
  }
}

/**
 * The vertex stage's extra declarations. Every one of these is the road's own frame, the
 * cache, or the noise fields the ground's colour function reads — nothing is per-frame
 * per-tuft state, because there is none: a cell's whole content is a hash of its index.
 */
const VERTEX_PRELUDE = /* glsl */ `
attribute vec3 aCorner;
uniform sampler2D uGrassHeight;
uniform sampler2D uGrassParams;
uniform sampler2D uGrassState;
uniform sampler2D uGrassStation;
uniform sampler2D uGroundTexNoiseFine;
uniform sampler2D uGroundTexNoiseVariation;
uniform sampler2D uGroundTexDetailNear;
uniform sampler2D uGroundTexDetailFar;
uniform float uStationBaseRel;
uniform vec2 uStationShift;
uniform vec2 uOriginMod;
uniform vec2 uCamRel;
uniform float uTime;
varying vec2 vTuftUv;
varying vec2 vGrassRoot;
varying float vGrassView;
varying vec3 vGrassNormal;
varying float vGrassFade7;
varying float vGrassFade100;
varying float vGrassVariation;
varying float vGrassCloseVar;
varying float vGrassLight;
varying float vGrassDark;
varying float vGrassShade;
varying float vFlower;
varying vec3 vFlowerColour;

float grassHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
ivec2 grassTexel( vec2 rel ) {
  return ivec2( mod( floor( rel + uOriginMod ), GRASS_CACHE ) );
}
`;

/** The vertex stage's body, in place of three's `begin_vertex`. */
const VERTEX_BODY = /* glsl */ `
${THREE.ShaderChunk.begin_vertex}

// --- Where the cell is ---------------------------------------------------------
float gI = mod( float( gl_InstanceID ), GRASS_ALONG );
float gJ = floor( float( gl_InstanceID ) / GRASS_ALONG );
float gIRel = gI - GRASS_MID;
float gSide = gJ < GRASS_HALF ? -1.0 : 1.0;
float gLatIdx = gJ < GRASS_HALF ? gJ : gJ - GRASS_HALF;
vec2 gCellIdx = vec2( gI, gJ );
float gJitS = grassHash( gCellIdx + 0.37 );
float gJitL = grassHash( gCellIdx + 7.31 );
float gJitV = grassHash( gCellIdx + 13.7 );
// The station the cell hangs off: the absolute arclength index, jittered along the road.
float gStation = uStationBaseRel + gIRel + ( gJitS - 0.5 );
vec2 gStationUv = vec2( ( gStation + 0.5 ) / GRASS_STATIONS, 0.0 );
vec4 gFrame = texture2D( uGrassStation, gStationUv + vec2( 0.0, ${STATION_ROW_FRAME.toFixed(2)} ) );
vec4 gEdgeRow = texture2D( uGrassStation, gStationUv + vec2( 0.0, ${STATION_ROW_EDGE.toFixed(2)} ) );
float gEdge = gSide > 0.0 ? gEdgeRow.x : gEdgeRow.y;
float gShoulder = gEdge - gEdgeRow.w;
float gLat = ( gLatIdx + 0.5 + ( gJitL - 0.5 ) ) * GRASS_CELL;
vec2 gFoot = gFrame.xy + uStationShift + gFrame.zw * ( gSide * ( gEdge + gLat ) );
vec2 gToCam = gFoot - uCamRel;
float gDist = length( gToCam );
float gAlong = abs( gIRel ) * GRASS_CELL;

// --- What the ground says about it --------------------------------------------
ivec2 gTexel = grassTexel( gFoot );
vec4 gParam = texelFetch( uGrassParams, gTexel, 0 );
// The root's height is read here rather than inside the branch below because the shadow
// map is looked up at the root, outside it, for every cell.
float gRootY = texelFetch( uGrassHeight, gTexel, 0 ).r;
// A byte texture samples NORMALISED (0..1), which is why the params below are read
// straight and the kind is scaled back up by the 255 it was written with.
float gUpright = texelFetch( uGrassState, gTexel, 0 ).r;
float gDensity = gParam.a;
// The last fifth of the band thins out on the ground's own patch noise, so the band has
// a ragged edge where the ground's colour already turns, and not a line.
float gOuter = clamp( ( gLat - GRASS_BAND * 0.55 ) / ( GRASS_BAND * 0.45 ), 0.0, 1.0 );
float gVar2000 = texture2D( uGroundTexNoiseVariation, gFoot / 2000.0 ).r;
float gVar500 = texture2D( uGroundTexNoiseVariation, gFoot / 500.0 ).r;
float gRagged = 1.0 - gOuter * ( 0.55 + 0.45 * gVar500 );
// The far half of the span keeps every other cell in both directions — a quarter of the
// tufts at twice the pitch — thinned over GRASS_FAR_FADE metres rather than cut.
float gFar = smoothstep( GRASS_FAR_START, GRASS_FAR_START + GRASS_FAR_FADE, gAlong );
float gParity = max( mod( gI, 2.0 ), mod( gJ, 2.0 ) );
float gKept = gParity < 0.5 ? 1.0 : step( grassHash( gCellIdx + 3.1 ), 1.0 - gFar );
float gSink = smoothstep( GRASS_SPAN * 0.72, GRASS_SPAN, gDist );
float gTake = gDensity * GRASS_ACCEPT * gRagged * gKept * step( gSink, 0.999 );
float gAlive = step( grassHash( gCellIdx + 21.3 ), gTake );

transformed = vec3( uCamRel.x, -4000.0, uCamRel.y );
vTuftUv = vec2( 0.0 );
vGrassRoot = gFoot;
vGrassView = gDist;
vGrassNormal = vec3( 0.0, 1.0, 0.0 );
vGrassShade = 0.0;
vFlower = 0.0;
vFlowerColour = vec3( 0.0 );

if ( gAlive > 0.5 ) {
	// --- The root, the ground's normal, and the tint ------------------------------
	ivec2 gDx = grassTexel( gFoot + vec2( 1.0, 0.0 ) );
	ivec2 gDz = grassTexel( gFoot + vec2( 0.0, 1.0 ) );
	vec3 gNormal = normalize( vec3(
		gRootY - texelFetch( uGrassHeight, gDx, 0 ).r, 1.0,
		gRootY - texelFetch( uGrassHeight, gDz, 0 ).r ) );

	// THE GROUND'S OWN INPUTS, from the ground's own function: the same fades, the same
	// patch maps and the same paleness, sampled once at the root (\`groundMeadowAt\`). It is
	// called rather than written out because the two copies had drifted apart — a tuft
	// stood in front of its own ground as pale straw while the ground under it stayed
	// green — and a tuft's whole colour is the ground's colour.
	GroundMeadow gMeadow = groundMeadowAt( gFoot, gRootY, min( 80.0, gShoulder + gLat ), 0.0 );
	vGrassFade7 = gMeadow.fade7;
	vGrassFade100 = gMeadow.fade100;
	vGrassVariation = gMeadow.variation;
	vGrassCloseVar = gMeadow.closeVar;
	vGrassLight = gMeadow.light;
	vGrassDark = gMeadow.dark;
	vGrassShade = gParam.b;

	// --- Which sprite, and how tall ----------------------------------------------
	// The atlas cells are real plants in frames of their own size, so the choice of cell
	// IS the choice of height: short at the gravel, medium in the meadow, tall in the
	// ditch and in the shade of a wood.
	float gHeight = gParam.r * 1.6;
	float gKind = gParam.g * 255.0;
	// The card's own size IS the cell's frame (its world size in the manifest), and the two
	// short cells' frames are 0.28 and 0.34 m. Two metres from the eye that is a spike
	// buried in the ground's own magnified blade photograph, and the verge read as the
	// photograph's speckle with a few spikes in it — the "неоновый шум" of the check
	// frame. So the short sward is the MEDIUM cell drawn short, and the two tiny cells are
	// not used: slowroads' own cards are a metre across whatever the plant is.
	float gShort = gHeight < 0.5 ? 0.72 : 1.0;
	float gCell = ( gHeight < 0.85 ? 0.9 : 1.3 ) * gShort;
	float gCellIndex = gHeight < 0.85 ? 1.0 : 2.0;
	if ( gKind > 0.5 && gKind < 1.5 ) {
		gCell = 1.2;
		gCellIndex = 4.0;
	} else if ( gKind > 1.5 ) {
		gCell = 1.15;
		gCellIndex = 3.0;
	} else if ( gParam.b > 0.45 ) {
		gCell = 1.3;
		gCellIndex = 7.0;
	}
	// Winter: the sward goes over and the snow lies on it, patch by patch, exactly as the
	// ground takes it. What stands is a dry stalk.
	float gSnow = seasonSnowAt( 0.0, seasonPatch( gFoot ) );
	if ( gSnow > 0.35 ) {
		gCell = 1.2;
		gCellIndex = 5.0;
	}
	float gUp = clamp( gUpright, 0.0, 1.0 );
	// The card's own size varies by half its own height again, which is what stops a band
	// of equally tall cards from reading as a row of boxes with one top edge.
	float gTall = gCell * ( 0.62 + 0.76 * gJitV ) * ( 0.3 + 0.7 * gUp ) * ( 1.0 - 0.85 * gSnow );
	// The far end of the span sinks into the ground it grew out of, by its own height, so
	// the grass goes under rather than fading out; and it is gone altogether past the span.
	gTall *= 1.0 - gSink * 1.25;

	// --- The card ------------------------------------------------------------------
	float gYaw = gJitV * 6.2831853 + aCorner.z * 1.5708;
	vec2 gAcross = vec2( cos( gYaw ), sin( gYaw ) );
	float gW = gTall;
	float gFlip = gJitS < 0.5 ? -1.0 : 1.0;
	float gWind = gUp * ( sin( uTime * 1.5 + ( gFoot.x + uOriginMod.x ) * 0.21 + ( gFoot.y + uOriginMod.y ) * 0.17 ) * 0.5 + 0.5 );
	// Trampled grass lies over, away from where the wheel came from: any fixed way reads.
	float gFall = gJitL * 6.2832;
	vec2 gTop = vec2( 0.62, 0.44 ) * ( gWind * 0.14 * gTall )
		+ vec2( cos( gFall ), sin( gFall ) ) * ( 1.0 - gUp ) * gTall * 1.3;
	vec2 gAt = gFoot + gAcross * aCorner.x * gW * 0.5 + gTop * aCorner.y;
	float gY = gRootY - 0.03 + aCorner.y * gTall * 0.86;
	transformed = vec3( gAt.x, gY, gAt.y );

	// --- The sprite's own uv, and the flower mask ----------------------------------
	vTuftUv = vec2( ( gCellIndex + 0.5 + aCorner.x * gFlip * 0.49 ) / 8.0, aCorner.y );
	vFlower = gKind > 1.5 ? 1.0 : 0.0;
	vFlowerColour = gJitS < 0.45 ? vec3( 0.92, 0.9, 0.82 )
		: gJitS < 0.8 ? vec3( 0.9, 0.72, 0.1 ) : vec3( 0.32, 0.4, 0.88 );
	// The ground's normal, not the card's: a crossed card lit by its own facing flips
	// bright and dark as the car passes it, and a tuft is the ground's own surface.
	vGrassNormal = gNormal;
}
`;

/**
 * The fragment stage's extra declarations. The tint itself is not here: it is
 * `groundGrassTint`, the ground's own function, called with the tuft's interpolated
 * inputs and the sprite's texel as the blade term.
 */
const FRAGMENT_PRELUDE = /* glsl */ `
uniform sampler2D uGrassAtlas;
uniform sampler2D uGrassFlora;
uniform sampler2D uGroundTexDetailNear;
uniform sampler2D uGroundTexDetailFar;
uniform sampler2D uGroundTexNoiseFine;
uniform sampler2D uGroundTexNoiseVariation;
varying vec2 vTuftUv;
varying vec2 vGrassRoot;
varying float vGrassView;
varying vec3 vGrassNormal;
varying float vGrassFade7;
varying float vGrassFade100;
varying float vGrassVariation;
varying float vGrassCloseVar;
varying float vGrassLight;
varying float vGrassDark;
varying float vGrassShade;
varying float vFlower;
varying vec3 vFlowerColour;
`;

/** The fragment stage's body, in place of three's `color_fragment`. */
const FRAGMENT_BODY = /* glsl */ `
${THREE.ShaderChunk.color_fragment}
{
	vec2 gW = vGrassRoot;
	vec4 gCard = texture2D( uGrassAtlas, vTuftUv );
	// The ground's colour function, with the sprite's own texel brightness as the blade
	// term: the same paint, at the same scales, from the same uniforms.
	// The blade term is the sprite's texel IN THE GROUND'S UNITS: the tile shader hands the
	// colour function its photographed blade normalised to a mean of one (its own
	// GRASS_GAIN), and a raw texel — a tenth of that — leaves every tuft in the dark green
	// base while the ground beside it has climbed to the pale tips.
	float gBlade = gCard.r * GRASS_GAIN;
	vec3 gTint = groundGrassTint(
		vGrassFade7, vGrassFade100, vGrassVariation, vGrassCloseVar, vGrassLight, vGrassDark, gBlade );
	// THE GROUND'S OWN DETAIL, from the ground's own function: the 100 m speckle and the
	// 500 m blotches that stop a repeated photograph from reading as one. Without it a tuft
	// is a lighter patch on the ground it stands in — the "pale tuft" the eye catches at
	// once — because the ground's sward is these masks multiplied together.
	float gDetail = groundMeadowDetail(
		gW, vGrassLight, vGrassView,
		1.0 - texture2D( uGroundTexDetailNear, gW / 100.0 ).r );
	gTint *= 1.0 - min( 0.8, gDetail );
	diffuseColor.rgb = gTint * gCard.rgb * GRASS_GAIN;
	float gMask = texture2D( uGrassFlora, vTuftUv ).r * vFlower;
	diffuseColor.rgb = mix( diffuseColor.rgb, vFlowerColour * gCard.rgb * GRASS_GAIN, gMask );
	// The cut-out, SHARPENED AROUND A HALF AND NOT WIDENED. A mip averages blade and gap,
	// so a distant tuft loses coverage — which is the sink's and the far thinning's
	// business, not the cut-out's. Widening the alpha by the mip level (stage 3's first
	// pass did, by a fifth a level) took the sparse top of every card over the threshold
	// long before its plant did, and a band of tufts forty metres away came out as a grid
	// of opaque rectangles. The sharpen is kept: it is what makes the cut a plant's
	// silhouette rather than a fuzzy blob, at every distance.
	// THE CUT TIGHTENS WITH DISTANCE, and it is the shape that needs it. Every cell of the
	// atlas is a dense stand of plants that fills its frame to the sides, so at a distance
	// — where a mip has averaged blade and gap into one soft edge — a half keeps the whole
	// frame and a band of tufts becomes a grid of rectangles forty metres wide of the road.
	// Raising the cut towards the plant's own core leaves the middle of the stand and drops
	// its frame, which is also what thin grass looks like from there.
	vec2 gTexel = vTuftUv * vec2( textureSize( uGrassAtlas, 0 ) );
	float gCut = mix( 0.5, 0.72, smoothstep( 12.0, 60.0, vGrassView ) );
	float gAlpha = clamp( ( gCard.a - gCut ) / max( fwidth( gCard.a ), 0.0001 ) + gCut, 0.0, 1.0 );
	if ( gAlpha < 0.01 ) discard;
	diffuseColor.a = gAlpha;
	
}
`;
