import * as THREE from 'three';

import { applyComicShading } from '../render/comic';
import { applyBarkMapping } from '../render/leafpaint';
import { injectSeason, SEASON_TREE_RANDOM_GLSL, SNOW_GLSL } from '../render/season';
import { TREE_KINDS } from './deserttiledata';
import type { TreeVariant } from './props/trees';

/**
 * FAR TREES AS IMPOSTORS: every tree past the model range drawn as one quad turned to
 * face the camera, painted from an atlas baked out of the tree's own far model.
 *
 * This is what lets a wood be seen from a kilometre as trees, and approach as
 * trees. The models cost hundreds of triangles each and stop at a few hundred metres;
 * a quad costs two, so the same wood can stand out to the horizon's haze. Nothing
 * here scales a tree: a model hands over to its impostor across a band of camera
 * distance by alpha to coverage (`applyModelDissolve`) — the impostor fades in over
 * the band's first half, the model out over its second, so the two never leave a hole
 * between them, and under MSAA the fractional coverage resolves to a blend. A dither
 * fixed to the screen did this first and filled the band with grain. At the far end a
 * tree dissolves whole, one at a time, rather than shrinking.
 *
 * WHY NOT ONE EXACT DISTANCE. The models are refilled every 14 m of travel
 * (world/forest.ts), so a hard swap happened a whole ring of trees at a time, and a
 * model and its impostor are never lit exactly alike: driving, the handover ring
 * blinked every second. Measured per frame from the camera, on the GPU, the handover
 * no longer waits for a refill and no longer happens to a tree all at once.
 *
 * WHY ALPHA TO COVERAGE. A tree past a kilometre is a few pixels of a mipmapped cut-out;
 * alpha-tested at 0.5 each pixel was all or nothing, and the pixels crawled as the
 * quad slid under them. Coverage gives the edge its multisamples; the alpha is
 * restored per mip level, since averaging thins a crown's edge below the cut and far
 * trees would otherwise shrink as they recede.
 *
 * Lighting is the model's own: the atlas is baked twice, once in albedo and once in
 * the model's normals as the bake camera saw them, and the quad turns those normals
 * with itself. A crown keeps its dark underside and shaded flank, so the handover from
 * the model a hundred-odd metres away is a change of drawing, not of light. A normal
 * guessed from the quad's shape instead (the first version) lit every far crown flat
 * and pale.
 */

const CELL_W = 96;
const CELL_H = 192;
const COLS = 21;
/**
 * Sides every variant is baked from, evenly round it. A tree seen from one side only
 * turned that side to the camera as the car drove past: a crooked oak or a leaning
 * willow at two hundred metres swung round with the view. The shader blends the two
 * views nearest the real one, as slowroads does.
 */
export const IMPOSTOR_VIEWS = 6;
/**
 * Empty texels round every cell. Without them a mip level blends a cell's edge with
 * its neighbour's, and a far crown wore the foot of the tree baked above it as a dash
 * over its top.
 */
const GUTTER = 5;

export interface ImpostorCell {
  /** The first of the variant's `IMPOSTOR_VIEWS` consecutive cells. */
  readonly index: number;
  /** Quad size at scale 1, metres. */
  readonly width: number;
  readonly height: number;
  /** Metres the model's foot sits below the quad's bottom (a sunk bush). */
  readonly drop: number;
}

export interface ImpostorAtlas {
  readonly texture: THREE.Texture;
  /** The same cells in normals, bake-camera space, packed to 0..1. */
  readonly normals: THREE.Texture;
  readonly cols: number;
  readonly rows: number;
  /** [kind][variant] */
  readonly cells: readonly (readonly ImpostorCell[])[];
}

/**
 * Renders every variant's far model from `IMPOSTOR_VIEWS` sides into one atlas, and its
 * normals into another. Eight bits a channel: the albedo is stored sRGB, so its darks
 * keep their steps.
 */
export function bakeImpostorAtlas(renderer: THREE.WebGLRenderer, variants: readonly TreeVariant[][]): ImpostorAtlas {
  const total = variants.reduce((n, k) => n + k.length, 0) * IMPOSTOR_VIEWS;
  const rows = Math.ceil(total / COLS);
  const target = new THREE.WebGLRenderTarget(COLS * CELL_W, rows * CELL_H, {
    type: THREE.UnsignedByteType,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
  });
  target.texture.colorSpace = THREE.SRGBColorSpace;
  const normalTarget = new THREE.WebGLRenderTarget(COLS * CELL_W, rows * CELL_H, {
    type: THREE.UnsignedByteType,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
  });
  normalTarget.texture.colorSpace = THREE.LinearSRGBColorSpace;
  const normalMaterial = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
  // The normals' alpha carries which texels are leaves (`aWood` 0), for the season to
  // recolour: leaves over coverage, once the mips have averaged both (see the shader).
  // Leaf cards are cut out by the same atlas the albedo pass uses, and their normals
  // are the crown's, on both faces (world/props/trees.ts).
  const leafMap = variants.flat().flatMap((v) => v.far).find((part) => part.material.map)?.material.map ?? null;
  normalMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uLeafMap = { value: leafMap };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aWood;\nvarying float vLeaf;\nvarying vec2 vLeafUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLeaf = 1.0 - aWood;\nvLeafUv = uv;');
    // The normal material's fragment shader has no <common> to hang it on.
    shader.fragmentShader = `uniform sampler2D uLeafMap;\nvarying float vLeaf;\nvarying vec2 vLeafUv;\n${shader.fragmentShader
      .replace('#include <normal_fragment_begin>', `${THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', 'normal *= vLeaf > 0.5 ? 1.0 : faceDirection;')}
${leafMap ? 'if ( texture2D( uLeafMap, vLeafUv ).a < 0.5 ) discard;' : ''}`)
      .replace('gl_FragColor.a = 1.0;', 'gl_FragColor.a = vLeaf;')}`;
  };
  normalMaterial.customProgramCacheKey = () => 'impostor-normal-leaf-v2';
  const scene = new THREE.Scene();
  // The model turns on this, not the camera round it: see the view angle in the shader.
  const turntable = new THREE.Group();
  scene.add(turntable);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, 0, -100, 100);
  camera.position.set(0, 0, 50);
  camera.lookAt(0, 0, 0);

  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevAutoClear = renderer.autoClear;
  renderer.autoClear = false;
  // Empty texels face the viewer, so a crown's mipmapped rim blends toward a sane normal.
  renderer.setRenderTarget(normalTarget);
  renderer.setClearColor(new THREE.Color(0.5, 0.5, 1), 0);
  renderer.clear(true, true, true);
  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, true, true);

  const cells: ImpostorCell[][] = [];
  let index = 0;
  const box = new THREE.Box3();
  for (const kind of variants) {
    const kindCells: ImpostorCell[] = [];
    for (const variant of kind) {
      turntable.clear();
      box.makeEmpty();
      for (const part of variant.far) {
        const source = part.material;
        const bake = new THREE.MeshBasicMaterial({
          map: source.map,
          color: source.color,
          vertexColors: source.vertexColors,
          // Leaf cards are cut out by the atlas's alpha; in the game by coverage, here
          // by a plain test.
          alphaTest: source.map ? 0.5 : source.alphaTest,
          side: THREE.DoubleSide,
        });
        // The trunks' bark wraps its own texture coordinates (render/leafpaint.ts).
        if (source.map) applyBarkMapping(bake);
        const mesh = new THREE.Mesh(part.geometry, bake);
        turntable.add(mesh);
        part.geometry.computeBoundingBox();
        box.union(part.geometry.boundingBox!);
      }
      // The widest the crown can be from any side: its box's farthest corner.
      const reachX = Math.max(box.max.x, -box.min.x);
      const reachZ = Math.max(box.max.z, -box.min.z);
      const halfW = Math.max(Math.hypot(reachX, reachZ) * 0.85, reachX, reachZ, (box.max.y - box.min.y) / 4) * 1.02;
      const height = box.max.y - box.min.y;
      // Keep the cell's 1:2 aspect: whichever of width and height is short is padded.
      const quadW = Math.max(halfW * 2, height / 2);
      const quadH = quadW * 2;
      camera.left = -quadW / 2;
      camera.right = quadW / 2;
      camera.bottom = box.min.y;
      camera.top = box.min.y + quadH;
      camera.updateProjectionMatrix();
      for (let view = 0; view < IMPOSTOR_VIEWS; view++) {
        const cell = index + view;
        const col = cell % COLS;
        const row = Math.floor(cell / COLS);
        // Seen from the side at angle view / IMPOSTOR_VIEWS of a turn round the model.
        turntable.rotation.y = -(view / IMPOSTOR_VIEWS) * Math.PI * 2;
        // The cell is set on the targets, not through `renderer.setViewport`: that one is
        // in CSS pixels and three multiplies it by the device pixel ratio even when
        // drawing into a texture. On a 2x screen every cell landed twice as big and
        // twice as far, and far trees wore scraps of their neighbours: floating trunks,
        // half crowns, dark rectangles.
        for (const t of [target, normalTarget]) {
          t.viewport.set(col * CELL_W + GUTTER, row * CELL_H + GUTTER, CELL_W - 2 * GUTTER, CELL_H - 2 * GUTTER);
          t.scissor.set(col * CELL_W, row * CELL_H, CELL_W, CELL_H);
          t.scissorTest = true;
        }
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
        scene.overrideMaterial = normalMaterial;
        renderer.setRenderTarget(normalTarget);
        renderer.render(scene, camera);
        scene.overrideMaterial = null;
      }
      for (const child of turntable.children) ((child as THREE.Mesh).material as THREE.Material).dispose();
      kindCells.push({ index, width: quadW, height: quadH, drop: -box.min.y });
      index += IMPOSTOR_VIEWS;
    }
    cells.push(kindCells);
  }

  renderer.autoClear = prevAutoClear;
  renderer.setClearColor(prevClear, prevAlpha);
  renderer.setRenderTarget(prevTarget);
  normalMaterial.dispose();
  return { texture: target.texture, normals: normalTarget.texture, cols: COLS, rows, cells };
}

/**
 * Makes a tree model's material give way to its impostor between `from - blend / 2` and
 * `from + blend / 2` metres of camera distance, measured at the tree's foot. Only
 * instanced draws are affected; the material keeps its program otherwise.
 */
export function applyModelDissolve(material: THREE.Material, from: number, blend: number): void {
  const flag = material.userData as { impostorDissolve?: boolean };
  if (flag.impostorDissolve) return;
  flag.impostorDissolve = true;
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
varying float vImpostorSwap;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
#ifdef USE_INSTANCING
vec3 dissolveFoot = ( modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
vImpostorSwap = smoothstep( ${(from - blend / 2).toFixed(1)}, ${(from + blend / 2).toFixed(1)}, length( cameraPosition.xz - dissolveFoot.xz ) );
#else
vImpostorSwap = 0.0;
#endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vImpostorSwap;`)
      .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
// Fades out over the second half of the band as the impostor fades in over the first:
// never a hole between them (see the header).
diffuseColor.a *= min( 1.0, 2.0 * ( 1.0 - vImpostorSwap ) );
if ( diffuseColor.a < 0.004 ) discard;`);
  };
  // Coverage from alpha: under MSAA a fractional alpha covers that share of a pixel's
  // samples, which the resolve turns into a blend. Discarded by a screen dither, the
  // handover band was a field of grain at 150 m.
  material.alphaToCoverage = true;
  const previousKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () => `${previousKey.call(material)}:impostor-dissolve-v2`;
  material.needsUpdate = true;
}

/** Floats per impostor in each of the two instance attributes. */
const A = 4;

interface Range {
  start: number;
  count: number;
  /** The tile's centre, anchor-relative metres, and the radius its trees stand in. */
  x: number;
  z: number;
  r: number;
}

/** A tile this near is drawn whichever way the camera looks. */
const CULL_NEAR_M = 400;
/** Degrees the view may turn, and metres the camera may travel, before a re-cull. */
const RECULL_TURN = (10 * Math.PI) / 180;
const RECULL_MOVE_M = 40;

/**
 * The impostor buffer: one instanced quad draw for every far tree in view. Tiles own
 * contiguous ranges of a CPU-side store, first-fit; a freed range is reused.
 *
 * WHAT IS DRAWN. The store holds every far tree out to six kilometres all round, some
 * six hundred thousand, and drawn whole the GPU placed all of them every frame to
 * discard the two thirds behind and beside the camera: most of the impostors' cost.
 * The draw buffer is the store's tiles that stand in a cone round the view, copied
 * together, and rebuilt only when the view has turned or travelled far enough that
 * the cone's margin could be used up (`RECULL_TURN`, `RECULL_MOVE_M`).
 */
export class ImpostorField {
  readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly material: THREE.MeshStandardMaterial;
  private a0: Float32Array;
  private a1: Float32Array;
  /** The draw buffers: the tiles in view, packed (see the class comment). */
  private d0: Float32Array;
  private d1: Float32Array;
  private capacity: number;
  private cullDirty = true;
  private cullX = Number.NaN;
  private cullZ = Number.NaN;
  private cullYaw = Number.NaN;
  private highWater = 0;
  private readonly free: Range[] = [];
  private readonly owned = new Map<string, Range>();
  private readonly uniforms = {
    uFrom: { value: 0 },
    uBlend: { value: 0 },
    uTo: { value: 0 },
    uOpenTo: { value: 0 },
    uKeepTo: { value: 0 },
    uCells: { value: new THREE.Vector2() },
    uImpNormals: { value: null as THREE.Texture | null },
    /** The first atlas cell of each tree kind, so a cell knows its kind. */
    uImpKindFrom: { value: [] as number[] },
  };

  /**
   * `from`, `blend`: the centre and width of the band in which a model hands over to
   * its impostor (see `applyModelDissolve`). `to`: where a tree of a wood dissolves
   * into the canopy blanket. `openTo`: where a tree outside a wood does (its tint is
   * stored negative, see world/forest.ts).
   */
  constructor(atlas: ImpostorAtlas, from: number, blend: number, to: number, openTo: number, keepTo: number) {
    this.capacity = 16384;
    this.a0 = new Float32Array(this.capacity * A);
    this.a1 = new Float32Array(this.capacity * A);
    this.d0 = new Float32Array(this.capacity * A);
    this.d1 = new Float32Array(this.capacity * A);
    this.geometry = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    this.geometry.index = quad.index;
    this.geometry.setAttribute('position', quad.getAttribute('position'));
    this.geometry.setAttribute('normal', quad.getAttribute('normal'));
    this.geometry.setAttribute('uv', quad.getAttribute('uv'));
    this.attach();
    this.uniforms.uFrom.value = from;
    this.uniforms.uBlend.value = blend;
    this.uniforms.uTo.value = to;
    this.uniforms.uOpenTo.value = openTo;
    this.uniforms.uKeepTo.value = keepTo;
    this.uniforms.uCells.value.set(atlas.cols, atlas.rows);
    this.uniforms.uImpNormals.value = atlas.normals;
    this.uniforms.uImpKindFrom.value = atlas.cells.map((kind) => kind[0]?.index ?? 1e9);

    const material = applyComicShading(
      new THREE.MeshStandardMaterial({ map: atlas.texture, alphaTest: 0.5, alphaToCoverage: true, roughness: 0.95, metalness: 0 }),
      { contourStrength: 0, stippleStrength: 0, shadowWarmth: 0.3 },
    );
    const compileComic = material.onBeforeCompile;
    const u = this.uniforms;
    material.onBeforeCompile = (shader, renderer) => {
      compileComic.call(material, shader, renderer);
      Object.assign(shader.uniforms, u);
      injectSeason(shader);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
attribute vec4 aImp0;
attribute vec4 aImp1;
uniform float uFrom;
uniform float uBlend;
uniform float uTo;
uniform float uOpenTo;
uniform float uKeepTo;
uniform vec2 uCells;
uniform float uImpKindFrom[${TREE_KINDS.length}];
varying vec3 vImpAutumn;
varying float vImpTurn;
varying float vImpBare;
varying float vImpEvergreen;
varying vec2 vImpUv;
varying vec2 vImpUv2;
varying float vImpView;
varying float vImpTint;
varying float vImpFade;
varying float vImpSwap;
varying float vImpHash;
varying vec3 vImpRight;
varying vec3 vImpFwd;`,
        )
        .replace(
          '#include <beginnormal_vertex>',
          `vec3 impBase = aImp0.xyz;
vec3 impWorld = ( modelMatrix * vec4( impBase, 1.0 ) ).xyz;
vec2 impTo = cameraPosition.xz - impWorld.xz;
vec3 impFwd = normalize( vec3( impTo.x, 0.0, impTo.y ) + vec3( 1e-4, 0.0, 0.0 ) );
vec3 impRight = vec3( impFwd.z, 0.0, -impFwd.x );
// Overwritten per pixel from the normal atlas; this only feeds three's varyings.
vec3 objectNormal = impFwd;
vImpRight = impRight;
vImpFwd = impFwd;`,
        )
        .replace(
          '#include <begin_vertex>',
          `// a1.x: the variant's first cell, plus the tree's own turn as a fraction.
float impCell = floor( aImp1.x );
float impYaw = fract( aImp1.x ) * 6.2832;
float impCam = length( impTo );
// A tree of a wood dissolves at uTo; one outside a wood carries on to uOpenTo, and a
// wood's far keeper (tint + 10: world/farwoods.ts) to uKeepTo, widening as the rest of
// its wood dissolves so the wood keeps its mass.
bool impKeeper = aImp1.w > 5.0;
float impReach = aImp1.w < 0.0 ? uOpenTo : impKeeper ? uKeepTo : uTo;
float impWiden = impKeeper ? 1.0 + 0.8 * smoothstep( uTo * 0.8, uTo * 1.1, impCam ) : 1.0;
vec3 transformed = impBase + impRight * position.x * aImp1.y * impWiden + vec3( 0.0, position.y * aImp1.z * ( 1.0 + ( impWiden - 1.0 ) * 0.25 ) - aImp0.w, 0.0 );
if ( impCam < uFrom - uBlend * 0.5 || impCam > impReach || aImp1.y <= 0.0 ) transformed = impBase;
vImpSwap = smoothstep( uFrom - uBlend * 0.5, uFrom + uBlend * 0.5, impCam );
// Which side of the tree the camera sees, in the tree's own frame (the bake turned
// the model by -view / VIEWS of a turn), and the two baked views either side of it.
float impSide = mod( ( atan( impTo.x, impTo.y ) - impYaw ) / 6.2832 * ${IMPOSTOR_VIEWS.toFixed(1)}, ${IMPOSTOR_VIEWS.toFixed(1)} );
float impView0 = floor( impSide );
vImpView = impSide - impView0;
vec2 impInCell = vec2( ${(GUTTER / CELL_W).toFixed(5)}, ${(GUTTER / CELL_H).toFixed(5)} ) + uv * vec2( ${(1 - (2 * GUTTER) / CELL_W).toFixed(5)}, ${(1 - (2 * GUTTER) / CELL_H).toFixed(5)} );
float impCellA = impCell + impView0;
float impCellB = impCell + mod( impView0 + 1.0, ${IMPOSTOR_VIEWS.toFixed(1)} );
vImpUv = ( vec2( mod( impCellA, uCells.x ), floor( impCellA / uCells.x ) ) + impInCell ) / uCells;
vImpUv2 = ( vec2( mod( impCellB, uCells.x ), floor( impCellB / uCells.x ) ) + impInCell ) / uCells;
vImpTint = impKeeper ? aImp1.w - 10.0 : abs( aImp1.w );
vImpFade = smoothstep( impReach * 0.82, impReach, impCam );
vImpHash = fract( sin( dot( impBase.xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
// The season, as the model takes it: the same kind, the same random from the same tint.
int impKind = 0;
for ( int k = 1; k < ${TREE_KINDS.length}; k++ ) if ( impCell >= uImpKindFrom[ k ] - 0.5 ) impKind = k;
float tint = vImpTint;
vImpTurn = seasonLeafTurn( impKind, ${SEASON_TREE_RANDOM_GLSL} );
vImpAutumn = seasonLeafTarget( impKind, ${SEASON_TREE_RANDOM_GLSL} );
vImpBare = seasonLeafBare( impKind, ${SEASON_TREE_RANDOM_GLSL} );
vImpEvergreen = seasonIsEvergreen( impKind );`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec2 vImpUv;
varying vec2 vImpUv2;
varying float vImpView;
varying float vImpTint;
varying float vImpFade;
varying float vImpSwap;
varying float vImpHash;
varying vec3 vImpRight;
varying vec3 vImpFwd;
varying vec3 vImpAutumn;
varying float vImpTurn;
varying float vImpBare;
varying float vImpEvergreen;
uniform sampler2D uImpNormals;`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
// The model's normal as baked (x right, y up, z toward the bake camera), turned with
// the quad: see the header.
vec3 impBaked = mix( texture2D( uImpNormals, vImpUv ).xyz, texture2D( uImpNormals, vImpUv2 ).xyz, vImpView ) * 2.0 - 1.0;
vec3 impWorldNormal = normalize( vImpRight * impBaked.x + vec3( 0.0, impBaked.y, 0.0 ) + vImpFwd * impBaked.z );
normal = normalize( ( viewMatrix * vec4( impWorldNormal, 0.0 ) ).xyz );`,
        )
        .replace(
          '#include <map_fragment>',
          `// Nothing before the model hands over (see applyModelDissolve); past its reach a tree
// goes whole, one at a time: dithered at two kilometres it read as a haze of dots.
if ( vImpSwap <= 0.0 || vImpHash < vImpFade ) discard;
// The two baked views either side of the camera's, blended by how far between.
vec4 sampledDiffuseColor = mix( texture2D( map, vImpUv ), texture2D( map, vImpUv2 ), vImpView );
// Leaves recoloured for the season, as the model's are (render/season.ts). The leaf
// mask is averaged with the empty texels by the mips just as coverage is, so the
// share of leaves among what is there is the one over the other.
if ( vImpTurn > 0.0 || vImpBare > 0.0 || uSeasonSnow > 0.0 ) {
  vec4 impN = mix( texture2D( uImpNormals, vImpUv ), texture2D( uImpNormals, vImpUv2 ), vImpView );
  float impLeaf = clamp( impN.a / max( sampledDiffuseColor.a, 0.004 ), 0.0, 1.0 );
  float impShade = seasonLuma( sampledDiffuseColor.rgb );
  sampledDiffuseColor.rgb = mix( sampledDiffuseColor.rgb, vImpAutumn * impShade, vImpTurn * impLeaf );
  // Fallen leaves: the leaf share of the texel goes, the wood stays.
  sampledDiffuseColor.a *= 1.0 - impLeaf * ( 1.0 - seasonLeafKeep( vImpBare, impShade * 3.1 ) );
  sampledDiffuseColor.rgb = mix( sampledDiffuseColor.rgb, seasonTwigs( sampledDiffuseColor.rgb, vImpBare ), impLeaf );
  // Snow on an evergreen's upper side, by the baked normal (y is up in the bake).
  float impUp = impN.y * 2.0 - 1.0;
  sampledDiffuseColor.rgb = mix( sampledDiffuseColor.rgb, ${SNOW_GLSL} * sampledDiffuseColor.a, vImpEvergreen * uSeasonSnow * smoothstep( 0.15, 0.7, impUp ) * 0.8 * impLeaf );
}
// Alpha lost to mip averaging, given back: see the header.
vec2 impTexel = vImpUv * vec2( textureSize( map, 0 ) );
float impMip = 0.5 * log2( max( max( dot( dFdx( impTexel ), dFdx( impTexel ) ), dot( dFdy( impTexel ), dFdy( impTexel ) ) ), 1.0 ) );
sampledDiffuseColor.a *= 1.0 + impMip * 0.12;
diffuseColor *= sampledDiffuseColor;
diffuseColor.rgb *= vImpTint;`,
        );
    };
    // The model's complement: fades in over the first half of the handover band.
    const compileSwap = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      compileSwap.call(material, shader, renderer);
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <alphatest_fragment>',
        `#include <alphatest_fragment>
diffuseColor.a *= min( 1.0, 2.0 * vImpSwap );`,
      );
    };
    const comicKey = material.customProgramCacheKey;
    material.customProgramCacheKey = () => `${comicKey.call(material)}:impostor-v10`;
    this.material = material;
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
  }

  private attach(): void {
    const a0 = new THREE.InstancedBufferAttribute(this.d0, A);
    const a1 = new THREE.InstancedBufferAttribute(this.d1, A);
    a0.setUsage(THREE.DynamicDrawUsage);
    a1.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('aImp0', a0);
    this.geometry.setAttribute('aImp1', a1);
    this.geometry.instanceCount = 0;
    this.cullDirty = true;
    // three.js caps an instanced draw at `_maxInstanceCount`, which it works out ONCE,
    // from the attributes bound at the first draw, and never again. Grown past the first
    // buffer's 16384, every impostor after it was stored and never drawn: only the
    // nearest kilometre of trees showed and the rest of the land stood bare.
    // Unchecked cast: `_maxInstanceCount` is a real three.js field the typings omit.
    const cached = this.geometry as THREE.InstancedBufferGeometry & { _maxInstanceCount?: number };
    cached._maxInstanceCount = this.capacity;
  }

  has(key: string): boolean {
    return this.owned.has(key);
  }

  /**
   * Writes a tile's impostors. `fill(i, a0, a1, at)` writes impostor `i` of `count`
   * into the two arrays at float offset `at`. `x`/`z` is the tile's centre in the
   * same anchor-relative metres as the impostors, `r` the radius its trees stand in.
   */
  add(
    key: string,
    count: number,
    fill: (i: number, a0: Float32Array, a1: Float32Array, at: number) => void,
    x: number,
    z: number,
    r: number,
  ): void {
    this.remove(key);
    if (count === 0) {
      this.owned.set(key, { start: 0, count: 0, x, z, r });
      return;
    }
    const range = this.allocate(count, x, z, r);
    for (let i = 0; i < count; i++) fill(i, this.a0, this.a1, (range.start + i) * A);
    this.owned.set(key, range);
    this.cullDirty = true;
  }

  remove(key: string): void {
    const range = this.owned.get(key);
    if (!range) return;
    this.owned.delete(key);
    if (range.count === 0) return;
    this.free.push({ start: range.start, count: range.count, x: 0, z: 0, r: 0 });
    this.cullDirty = true;
  }

  /**
   * Packs the tiles in view into the draw buffers, when the view has moved enough to
   * need it. Camera position in the impostors' anchor-relative metres; `fx`/`fz` its
   * look direction on the ground; `halfFov` half its horizontal field of view.
   */
  cull(camX: number, camZ: number, fx: number, fz: number, halfFov: number): void {
    const yaw = Math.atan2(fx, fz);
    let turn = Math.abs(yaw - this.cullYaw);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    const moved = Math.hypot(camX - this.cullX, camZ - this.cullZ);
    if (!this.cullDirty && !(turn > RECULL_TURN) && !(moved > RECULL_MOVE_M)) return;
    this.cullDirty = false;
    this.cullX = camX;
    this.cullZ = camZ;
    this.cullYaw = yaw;
    const flat = Math.hypot(fx, fz) || 1;
    const ux = fx / flat;
    const uz = fz / flat;
    // The cone must still cover the view after the largest turn allowed between culls.
    const cosCone = Math.cos(Math.min(Math.PI, halfFov + RECULL_TURN + 0.08));
    let n = 0;
    for (const range of this.owned.values()) {
      if (range.count === 0) continue;
      const dx = range.x - camX;
      const dz = range.z - camZ;
      const d = Math.hypot(dx, dz);
      const near = CULL_NEAR_M + range.r + RECULL_MOVE_M;
      if (d > near) {
        // The tile's widest angle off the view: its centre's, less what its radius
        // (and the travel allowed between culls) subtends.
        const cosAt = (dx * ux + dz * uz) / d;
        const spread = Math.asin(Math.min(1, (range.r + RECULL_MOVE_M) / d));
        if (Math.acos(Math.max(-1, Math.min(1, cosAt))) - spread > Math.acos(cosCone)) continue;
      }
      const from = range.start * A;
      const to = (range.start + range.count) * A;
      this.d0.set(this.a0.subarray(from, to), n * A);
      this.d1.set(this.a1.subarray(from, to), n * A);
      n += range.count;
    }
    this.geometry.instanceCount = n;
    for (const name of ['aImp0', 'aImp1']) {
      const attribute = this.geometry.getAttribute(name) as THREE.InstancedBufferAttribute;
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, Math.max(1, n) * A);
      attribute.needsUpdate = true;
    }
  }

  keys(): IterableIterator<string> {
    return this.owned.keys();
  }

  private allocate(count: number, x: number, z: number, r: number): Range {
    this.free.sort((a, b) => a.start - b.start);
    // Coalesce neighbours so freed rows become one range again.
    for (let i = 0; i < this.free.length - 1; ) {
      const a = this.free[i]!;
      const b = this.free[i + 1]!;
      if (a.start + a.count === b.start) {
        a.count += b.count;
        this.free.splice(i + 1, 1);
      } else {
        i++;
      }
    }
    for (let i = 0; i < this.free.length; i++) {
      const f = this.free[i]!;
      if (f.count < count) continue;
      const range = { start: f.start, count, x, z, r };
      f.start += count;
      f.count -= count;
      if (f.count === 0) this.free.splice(i, 1);
      return range;
    }
    if (this.highWater + count > this.capacity) this.grow(this.highWater + count);
    const range = { start: this.highWater, count, x, z, r };
    this.highWater += count;
    return range;
  }

  private grow(needed: number): void {
    let capacity = this.capacity;
    while (capacity < needed) capacity *= 2;
    const a0 = new Float32Array(capacity * A);
    const a1 = new Float32Array(capacity * A);
    a0.set(this.a0);
    a1.set(this.a1);
    this.a0 = a0;
    this.a1 = a1;
    this.d0 = new Float32Array(capacity * A);
    this.d1 = new Float32Array(capacity * A);
    this.capacity = capacity;
    this.attach();
  }
}
