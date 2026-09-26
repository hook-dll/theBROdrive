import * as THREE from 'three';

import { applyComicShading } from '../render/comic';
import { applyBarkMapping } from '../render/leafpaint';
import { injectSeason, SEASON_TREE_RANDOM_GLSL, SNOW_GLSL } from '../render/season';
import { isImpostorKind, TREE_KINDS, UNDERGROWTH_KIND_FROM, UNDERGROWTH_KIND_TO } from './deserttiledata';
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

/**
 * Cell height in texels per pixel of drawing buffer height: 192 texels at 2700 px, the
 * 4K television on the top rung the measured sheet was taken from (see `impostorLayout`).
 */
const CELL_TEXELS_PER_BUFFER_PX = 192 / 2700;
/** Cells are 1:2, as the bake camera's frustum is: a cell is half as wide as tall. */
const CELL_ASPECT = 2;
/** Texel multiples a cell height snaps to, so every mip level is a whole number of texels. */
const CELL_STEP = 16;
/** Coarsest and finest cell heights. */
const CELL_H_MIN = 32;
const CELL_H_MAX = 192;
/**
 * Atlas columns before the height is spent. Twenty-one is what made the sheet 2016 px
 * wide (21 * 96) at the reference cell, which every WebGL2 device allows; a wider sheet
 * would use the height limit faster than it needs to.
 */
const COLS = 21;
/**
 * Sides every variant is baked from, evenly round it. A tree seen from one side only
 * turned that side to the camera as the car drove past: a crooked oak or a leaning
 * willow at two hundred metres swung round with the view. The shader blends the two
 * views nearest the real one, as slowroads does.
 */
export const IMPOSTOR_VIEWS = 6;
/** Sides the layout holds to before the cell is made coarse (see `impostorLayout`). */
const PREFERRED_VIEWS: readonly number[] = [IMPOSTOR_VIEWS, 5, 4];
/** The sides a GPU too small to hold four is left with: below three the swing shows. */
const FALLBACK_VIEWS: readonly number[] = [3, 2];
/**
 * Empty texels round every cell, as a share of the cell's width. Without them a mip
 * level blends a cell's edge with its neighbour's, and a far crown wore the foot of the
 * tree baked above it as a dash over its top.
 */
const GUTTER_SHARE = 5 / 96;

/** How one machine's atlas is laid out: see `impostorLayout`. */
export interface ImpostorLayout {
  /** Sides each variant is baked from, evenly round it. */
  readonly views: number;
  readonly cellW: number;
  readonly cellH: number;
  /** Empty texels round each cell. */
  readonly gutter: number;
  readonly cols: number;
  readonly rows: number;
}

export interface ImpostorCell {
  /** The first of the variant's `layout.views` consecutive cells. */
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
  readonly layout: ImpostorLayout;
  /** [kind][variant] */
  readonly cells: readonly (readonly ImpostorCell[])[];
}

/**
 * The atlas one machine gets: a cell its own drawing buffer can read, and as many sides
 * as its GPU can hold.
 *
 * CELL SIZE. A cell's texels are spent on the quad's screen pixels: at the hand-over
 * distance (`world/forest.ts`) the median quad is 278 px tall on a 2700 px buffer, so
 * 192 texels is under two texels a pixel there and a smaller cell is a visible loss —
 * but a phone drawing 640x360 renders that same quad under 70 px tall, and 192 texels
 * over 70 pixels was 194 MB of its memory spent on texels it never resolves. The cell
 * therefore scales with the drawing buffer and is *capped* at the measured 192: every
 * screen this large or larger gets the sheet measured today (a 4K television on the top
 * rung draws 4800x2700, settings.ts), and every smaller one gets the sheet its own pixels
 * ask for.
 *
 * VIEWS. Six sides, blended two at a time by the shader. A GPU whose `maxTextureSize`
 * cannot hold the whole sheet gives up sides before detail, because that is what
 * measurement says is cheaper: against the models at the hand-over distance and out to
 * 300 m, four sides moved the mean pixel error from 3.40 to 3.47 (+2%), three sides to
 * 3.67, where halving the cell to 96 moved it to 3.75 (+10%) and to 64 to 3.85 — and the
 * cell is the loss the eye sees on every frame, not only while turning.
 *
 * Neither can be unbounded. 164 variants at six sides is 2016 x 9024, which is past the
 * 8192 most Android GPUs stop at and four times what 4096 allows: the sheets would come
 * back incomplete, and every far tree would sample a texture that failed to allocate.
 */
export function impostorLayout(
  variants: readonly TreeVariant[][],
  maxTextureSize: number,
  bufferHeight: number,
): ImpostorLayout {
  let cells = 0;
  variants.forEach((kind, index) => {
    if (isImpostorKind(index)) cells += kind.length;
  });
  const limit = Math.max(64, Math.floor(maxTextureSize));
  const wanted = CELL_STEP * Math.round(((Math.max(1, bufferHeight) * CELL_TEXELS_PER_BUFFER_PX) / CELL_STEP));
  const tallest = Math.min(CELL_H_MAX, Math.max(CELL_H_MIN, wanted));
  const fit = (views: number, cellH: number): ImpostorLayout | null => {
    const cellW = Math.max(8, Math.round(cellH / CELL_ASPECT));
    // As many columns as the sheet's width allows: fewer, wider rows fit a small GPU.
    const cols = Math.min(COLS, Math.max(1, Math.floor(limit / cellW)));
    const rows = Math.ceil((cells * views) / cols);
    if (rows * cellH > limit) return null;
    return { views, cellW, cellH, gutter: Math.max(1, Math.round(cellW * GUTTER_SHARE)), cols, rows };
  };
  // Sides first (six, five, four), the cell only after those: measured above the cell is
  // the dearer trade, and four sides at the screen's own cell read better than six over
  // a cell made coarse to pay for them. Below four the swing the sides exist to prevent
  // comes back, so a GPU that small is served by three or two sides at the finest cell
  // that fits instead.
  for (const views of PREFERRED_VIEWS) {
    const layout = fit(views, tallest);
    if (layout) return layout;
  }
  for (let cellH = tallest; cellH >= CELL_H_MIN; cellH -= CELL_STEP) {
    for (const views of PREFERRED_VIEWS) {
      const layout = fit(views, cellH);
      if (layout) return layout;
    }
  }
  for (const views of FALLBACK_VIEWS) {
    for (let cellH = tallest; cellH >= CELL_H_MIN; cellH -= CELL_STEP) {
      const layout = fit(views, cellH);
      if (layout) return layout;
    }
  }
  // WebGL2 guarantees 2048 texels a side and two sides at the coarsest cell fit in that
  // with room to spare, so no working device gets here: it stands for a capability report
  // too broken to size a sheet from, and gives the smallest one there is.
  return { views: 2, cellW: 16, cellH: 32, gutter: 1, cols: 8, rows: Math.ceil((cells * 2) / 8) };
}

/**
 * Renders every variant's far model from the layout's sides into one atlas, and its
 * normals into another. Eight bits a channel: the albedo is stored sRGB, so its darks
 * keep their steps.
 */
export function bakeImpostorAtlas(
  renderer: THREE.WebGLRenderer,
  variants: readonly TreeVariant[][],
  layout = impostorLayout(
    variants,
    renderer.capabilities.maxTextureSize,
    renderer.getDrawingBufferSize(new THREE.Vector2()).y,
  ),
): ImpostorAtlas {
  const { views, cellW, cellH, gutter, cols, rows } = layout;
  const total = variants.reduce((n, kind, index) => (isImpostorKind(index) ? n + kind.length : n), 0) * views;
  const target = new THREE.WebGLRenderTarget(cols * cellW, rows * cellH, {
    type: THREE.UnsignedByteType,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
  });
  target.texture.colorSpace = THREE.SRGBColorSpace;
  const normalTarget = new THREE.WebGLRenderTarget(cols * cellW, rows * cellH, {
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
  for (const [kindIndex, kind] of variants.entries()) {
    const kindCells: ImpostorCell[] = [];
    // The undergrowth never stands as an impostor (see `isImpostorKind`): baking its
    // cells was a quarter of the sheet, and its models are the only thing that draws it.
    if (!isImpostorKind(kindIndex)) {
      cells.push(kindCells);
      continue;
    }
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
      for (let view = 0; view < views; view++) {
        const cell = index + view;
        const col = cell % cols;
        const row = Math.floor(cell / cols);
        // Seen from the side at angle view / views of a turn round the model.
        turntable.rotation.y = -(view / views) * Math.PI * 2;
        // The cell is set on the targets, not through `renderer.setViewport`: that one is
        // in CSS pixels and three multiplies it by the device pixel ratio even when
        // drawing into a texture. On a 2x screen every cell landed twice as big and
        // twice as far, and far trees wore scraps of their neighbours: floating trunks,
        // half crowns, dark rectangles.
        //
        // The margin is the same on both axes, and the frustum is squeezed into the cell
        // by exactly as much as the draw stretches it back out (see below): the two
        // anisotropies cancel, and the measured impostor silhouette is 0.983 of its
        // model's height, the same as at the cell this layout is capped at.
        for (const t of [target, normalTarget]) {
          t.viewport.set(col * cellW + gutter, row * cellH + gutter, cellW - 2 * gutter, cellH - 2 * gutter);
          t.scissor.set(col * cellW, row * cellH, cellW, cellH);
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
      index += views;
    }
    cells.push(kindCells);
  }

  renderer.autoClear = prevAutoClear;
  renderer.setClearColor(prevClear, prevAlpha);
  renderer.setRenderTarget(prevTarget);
  normalMaterial.dispose();
  return { texture: target.texture, normals: normalTarget.texture, layout, cells };
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
/** Impostors packed and uploaded per frame while a repack is under way: 1 MB a frame. */
const PACK_SLICE = 32768;

/**
 * Impostors per draw chunk: 1 MB an attribute. A draw buffer is cut into chunks this
 * size, each its own GPU buffer and draw, because ANGLE on Metal copies a whole buffer
 * the GPU may still be reading before it lets a write into it: a slice written into a
 * 16 MB buffer cost the copy of all 16 MB, 8 ms, every frame of a repack.
 */
const CHUNK = 65536;
/** Texels a row of the store textures. */
const STORE_WIDTH = 1024;
/** Frames a draw buffer stays out of the draw before it is written again. */
const IDLE_FRAMES = 4;


interface DrawChunk {
  readonly geometry: THREE.InstancedBufferGeometry;
  readonly mesh: THREE.Mesh;
  /** Store indices of the impostors it draws. */
  readonly index: Float32Array;
  /** Our own GPU buffer (see `addChunk`), and what of it awaits upload. */
  readonly buf: WebGLBuffer;
  dirtyFrom: number;
  dirtyTo: number;
  count: number;
}

interface DrawSlot {
  readonly chunks: DrawChunk[];
  /** Impostors written, over all its chunks. */
  count: number;
}

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
const RECULL_MOVE_M = 120;

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
 *
 * NEVER IN ONE FRAME. The cone holds up to a million impostors, 34 MB; packed and
 * uploaded in one frame that was a 40–110 ms hitch every 40 m of road, the stutter the
 * owner saw at 144 Hz. So there are two draw buffers: the front one is drawn while the
 * back one is packed and uploaded `PACK_SLICE` impostors a frame, and they swap when it
 * is whole. A tile that arrives meanwhile is appended to the front buffer as it is.
 */
export class ImpostorField {
  /** Holds both draw buffers' meshes: position it, the pair follows. */
  readonly mesh: THREE.Group;
  private readonly slots: [DrawSlot, DrawSlot];
  private front = 0;
  private frame = 0;
  private swapFrame = -1000;
  private job: { ranges: Range[]; index: number; written: number } | null = null;
  private readonly material: THREE.MeshStandardMaterial;
  private a0: Float32Array;
  private a1: Float32Array;
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
    /** Which of the layout's sides the atlas holds, and where a cell's content sits in it. */
    uImpViews: { value: IMPOSTOR_VIEWS },
    uImpInset: { value: new THREE.Vector2() },
    uImpCell: { value: new THREE.Vector2(1, 1) },
    uImpNormals: { value: null as THREE.Texture | null },
    /** The first atlas cell of each tree kind, so a cell knows its kind. */
    uImpKindFrom: { value: [] as number[] },
    /** The store: every impostor's two vec4s, one texel each, `STORE_WIDTH` a row. */
    uImpData0: { value: null as THREE.DataTexture | null },
    uImpData1: { value: null as THREE.DataTexture | null },
  };

  /**
   * `from`, `blend`: the centre and width of the band in which a model hands over to
   * its impostor (see `applyModelDissolve`). `to`: where a tree of a wood dissolves
   * into the canopy blanket. `openTo`: where a tree outside a wood does (its tint is
   * stored negative, see world/forest.ts).
   */
  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    atlas: ImpostorAtlas,
    from: number,
    blend: number,
    to: number,
    openTo: number,
    keepTo: number,
  ) {
    this.capacity = 65536;
    this.a0 = new Float32Array(this.capacity * A);
    this.a1 = new Float32Array(this.capacity * A);
    this.data0 = this.storeTexture(this.a0);
    this.data1 = this.storeTexture(this.a1);
    this.uniforms.uImpData0.value = this.data0;
    this.uniforms.uImpData1.value = this.data1;
    this.quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    this.slots = [{ chunks: [], count: 0 }, { chunks: [], count: 0 }];
    this.uniforms.uFrom.value = from;
    this.uniforms.uBlend.value = blend;
    this.uniforms.uTo.value = to;
    this.uniforms.uOpenTo.value = openTo;
    this.uniforms.uKeepTo.value = keepTo;
    this.uniforms.uCells.value.set(atlas.layout.cols, atlas.layout.rows);
    this.uniforms.uImpViews.value = atlas.layout.views;
    this.uniforms.uImpInset.value.set(atlas.layout.gutter / atlas.layout.cellW, atlas.layout.gutter / atlas.layout.cellH);
    this.uniforms.uImpCell.value.set(1 - (2 * atlas.layout.gutter) / atlas.layout.cellW, 1 - (2 * atlas.layout.gutter) / atlas.layout.cellH);
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
attribute float aImpIndex;
uniform highp sampler2D uImpData0;
uniform highp sampler2D uImpData1;
uniform float uFrom;
uniform float uBlend;
uniform float uTo;
uniform float uOpenTo;
uniform float uKeepTo;
uniform vec2 uCells;
uniform float uImpViews;
uniform vec2 uImpInset;
uniform vec2 uImpCell;
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
          `// The impostor's data, by its index into the store (see \`ImpostorField\`).
ivec2 impTexel = ivec2( int( aImpIndex ) % ${STORE_WIDTH}, int( aImpIndex ) / ${STORE_WIDTH} );
vec4 aImp0 = texelFetch( uImpData0, impTexel, 0 );
vec4 aImp1 = texelFetch( uImpData1, impTexel, 0 );
vec3 impBase = aImp0.xyz;
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
// the model by -view / views of a turn), and the two baked views either side of it.
float impSide = mod( ( atan( impTo.x, impTo.y ) - impYaw ) / 6.2832 * uImpViews, uImpViews );
float impView0 = floor( impSide );
vImpView = impSide - impView0;
vec2 impInCell = uImpInset + uv * uImpCell;
float impCellA = impCell + impView0;
float impCellB = impCell + mod( impView0 + 1.0, uImpViews );
vImpUv = ( vec2( mod( impCellA, uCells.x ), floor( impCellA / uCells.x ) ) + impInCell ) / uCells;
vImpUv2 = ( vec2( mod( impCellB, uCells.x ), floor( impCellB / uCells.x ) ) + impInCell ) / uCells;
vImpTint = impKeeper ? aImp1.w - 10.0 : abs( aImp1.w );
vImpHash = fract( sin( dot( impBase.xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
// Past its reach a tree goes, but each at its own distance (over the last 30% of the
// reach) and never at once: over its own 12% of the reach it fades by coverage, which
// MSAA resolves to a blend. Switched whole it "materialised out of thin air" at the
// sides of the view as the car drove up (the owner's words).
float impGone = impReach * ( 0.7 + 0.3 * vImpHash );
vImpFade = 1.0 - smoothstep( impGone - impReach * 0.12, impGone, impCam );
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
          `// Nothing before the model hands over (see applyModelDissolve), nothing past its reach.
if ( vImpSwap <= 0.0 || vImpFade <= 0.0 ) discard;
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
diffuseColor.a *= min( 1.0, 2.0 * vImpSwap ) * vImpFade;`,
      );
    };
    const comicKey = material.customProgramCacheKey;
    material.customProgramCacheKey = () => `${comicKey.call(material)}:impostor-v12`;
    this.material = material;
    this.mesh = new THREE.Group();
    this.mesh.matrixAutoUpdate = false;
  }

  private readonly quad: THREE.BufferGeometry;

  /**
   * A new chunk for `slot`: its own geometry, mesh and GPU buffers.
   *
   * THE BUFFERS ARE OURS, not three's (`GLBufferAttribute`), for one reason: three
   * uploads a mesh's attributes only while it draws it, so a chunk being filled had to
   * be drawn (with no instances), and a buffer bound to a draw is one the GPU is using:
   * every write into it waited for the GPU, 8-14 ms, measured. Now a chunk being filled
   * is hidden, written only after it has been out of the draw for `IDLE_FRAMES`, and
   * uploaded here (`flush`) when we choose.
   */
  private addChunk(slot: DrawSlot): DrawChunk {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = this.quad.index;
    geometry.setAttribute('position', this.quad.getAttribute('position'));
    geometry.setAttribute('normal', this.quad.getAttribute('normal'));
    geometry.setAttribute('uv', this.quad.getAttribute('uv'));
    const index = new Float32Array(CHUNK);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, CHUNK * 4, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    const attribute = new THREE.GLBufferAttribute(buf, gl.FLOAT, 1, 4, CHUNK);
    // Read as per-instance by three's binding (it checks the flag, not the class).
    Object.assign(attribute, { isInstancedBufferAttribute: true, meshPerAttribute: 1 });
    geometry.setAttribute('aImpIndex', attribute as unknown as THREE.BufferAttribute);
    geometry.instanceCount = 0;
    // three.js caps an instanced draw at `_maxInstanceCount`, worked out once from the
    // attributes bound at the first draw. Unchecked cast: a real field the typings omit.
    (geometry as THREE.InstancedBufferGeometry & { _maxInstanceCount?: number })._maxInstanceCount = CHUNK;
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.visible = false;
    this.mesh.add(mesh);
    const chunk = { geometry, mesh, index, buf, dirtyFrom: CHUNK, dirtyTo: 0, count: 0 };
    slot.chunks.push(chunk);
    return chunk;
  }

  /** Uploads what has been written into `slot`'s chunks since the last flush. */
  private flush(slot: DrawSlot): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    for (const c of slot.chunks) {
      if (c.dirtyTo <= c.dirtyFrom) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, c.buf);
      gl.bufferSubData(gl.ARRAY_BUFFER, c.dirtyFrom * 4, c.index, c.dirtyFrom, c.dirtyTo - c.dirtyFrom);
      c.dirtyFrom = CHUNK;
      c.dirtyTo = 0;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  /**
   * Copies `count` impostors of store range `range` from `from` into `slot` at its end,
   * chunk by chunk, marking just what was written for upload. `live`: the slot is being
   * drawn, so its chunks draw what they hold at once.
   */
  private appendTo(slot: DrawSlot, range: Range, from = 0, count = range.count - from, live = false): void {
    let src = range.start + from;
    let left = count;
    while (left > 0) {
      const index = Math.floor(slot.count / CHUNK);
      const chunk = slot.chunks[index] ?? this.addChunk(slot);
      const at = slot.count - index * CHUNK;
      const take = Math.min(left, CHUNK - at);
      for (let k = 0; k < take; k++) chunk.index[at + k] = src + k;
      chunk.dirtyFrom = Math.min(chunk.dirtyFrom, at);
      chunk.dirtyTo = Math.max(chunk.dirtyTo, at + take);
      chunk.count = at + take;
      if (live) {
        chunk.geometry.instanceCount = chunk.count;
        chunk.mesh.visible = true;
      }
      slot.count += take;
      src += take;
      left -= take;
    }
  }

  /** Empties a slot: its chunks draw nothing and are written over from the start. */
  private clearSlot(slot: DrawSlot): void {
    for (const c of slot.chunks) {
      c.count = 0;
      c.geometry.instanceCount = 0;
      c.mesh.visible = false;
    }
    slot.count = 0;
  }

  /** Whether a tile's range stands in the cone the last cull was made for. */
  private inCone(range: Range, camX: number, camZ: number, ux: number, uz: number, cosCone: number): boolean {
    const dx = range.x - camX;
    const dz = range.z - camZ;
    const d = Math.hypot(dx, dz);
    if (d <= CULL_NEAR_M + range.r + RECULL_MOVE_M) return true;
    const cosAt = (dx * ux + dz * uz) / d;
    const spread = Math.asin(Math.min(1, (range.r + RECULL_MOVE_M) / d));
    return Math.acos(Math.max(-1, Math.min(1, cosAt))) - spread <= Math.acos(cosCone);
  }

  private coneUx = 0;
  private coneUz = 1;
  private coneCos = -1;

  /** Packs the next slice of the back buffer; swaps it to the front when whole. */
  private pump(): void {
    const job = this.job;
    if (!job) return;
    const back = this.slots[1 - this.front]!;
    let budget = PACK_SLICE;
    while (budget > 0 && job.index < job.ranges.length) {
      const range = job.ranges[job.index]!;
      const take = Math.min(budget, range.count - job.written);
      this.appendTo(back, range, job.written, take);
      budget -= take;
      job.written += take;
      if (job.written >= range.count) {
        job.index++;
        job.written = 0;
      }
    }
    this.flush(back);
    if (job.index < job.ranges.length) return;
    const front = this.slots[this.front]!;
    for (const c of back.chunks) {
      c.geometry.instanceCount = c.count;
      c.mesh.visible = c.count > 0;
    }
    this.clearSlot(front);
    this.front = 1 - this.front;
    this.swapFrame = this.frame;
    this.job = null;
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
    // THE RUNS THEMSELVES, NOT THEIR SPAN. A tile is one contiguous run of rows
    // (`allocate` hands back one), so recording the run is enough to upload exactly what
    // changed. It used to record `min(start)` and `max(start + count)` and upload
    // everything between them, which is a different thing entirely once rows are RECYCLED:
    // a tile placed in a freed low row while another sits at the high-water mark made the
    // span cover every row in between — measured on the bench, 193 rows = 6.05 MB per
    // flush of mostly unchanged data, 3.1-6.5 GB per 20 s of driving, 97% of every byte
    // the frame uploaded, and 52-292 ms frames on ANGLE over Metal.
    this.storeRuns.push([Math.floor(range.start / STORE_WIDTH), Math.floor((range.start + count - 1) / STORE_WIDTH) + 1]);
    // Not into the buffer being drawn: a write into a buffer the GPU may still be
    // reading waits for the GPU (8 ms a write, measured). Into the repack under way, or
    // the next one, which a new tile asks for.
    if (this.job) this.job.ranges.push(range);
    else this.cullDirty = true;
  }

  remove(key: string): void {
    const range = this.owned.get(key);
    if (!range) return;
    this.owned.delete(key);
    if (range.count === 0) return;
    this.free.push({ start: range.start, count: range.count, x: 0, z: 0, r: 0 });
    // Not repacked for: the draw buffers hold copies, and a removed tile is one that
    // has fallen out of the window, far behind; the next repack drops it.
  }

  /**
   * Packs the tiles in view into the draw buffers, when the view has moved enough to
   * need it. Camera position in the impostors' anchor-relative metres; `fx`/`fz` its
   * look direction on the ground; `halfFov` half its horizontal field of view.
   */
  cull(camX: number, camZ: number, fx: number, fz: number, halfFov: number): void {
    this.frame++;
    this.flushStore();
    this.pump();
    const yaw = Math.atan2(fx, fz);
    let turn = Math.abs(yaw - this.cullYaw);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    const moved = Math.hypot(camX - this.cullX, camZ - this.cullZ);
    // One repack at a time: a new one starts once the last has swapped in, and not until
    // the buffer it will write into has been out of the draw for a few frames — until
    // the GPU is surely done reading it.
    if (this.job || this.frame - this.swapFrame < IDLE_FRAMES) return;
    if (!this.cullDirty && !(turn > RECULL_TURN) && !(moved > RECULL_MOVE_M)) return;
    this.cullDirty = false;
    this.cullX = camX;
    this.cullZ = camZ;
    this.cullYaw = yaw;
    const flat = Math.hypot(fx, fz) || 1;
    this.coneUx = fx / flat;
    this.coneUz = fz / flat;
    // The cone must still cover the view after the largest turn allowed between culls,
    // and the frames the repack takes.
    this.coneCos = Math.cos(Math.min(Math.PI, halfFov + RECULL_TURN + 0.15));
    const ranges: Range[] = [];
    for (const range of this.owned.values()) {
      if (range.count > 0 && this.inCone(range, camX, camZ, this.coneUx, this.coneUz, this.coneCos)) ranges.push(range);
    }
    this.clearSlot(this.slots[1 - this.front]!);
    this.job = { ranges, index: 0, written: 0 };
    // The first frame: the very first cull has nothing in front to show meanwhile.
    this.pump();
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
    // The store is CPU-side only: the draw chunks never grow.
    let capacity = this.capacity;
    while (capacity < needed) capacity *= 2;
    const a0 = new Float32Array(capacity * A);
    const a1 = new Float32Array(capacity * A);
    a0.set(this.a0);
    a1.set(this.a1);
    this.a0 = a0;
    this.a1 = a1;
    this.capacity = capacity;
    // New textures, uploaded whole by three: rare, the store only grows early on.
    this.data0.dispose();
    this.data1.dispose();
    this.data0 = this.storeTexture(a0);
    this.data1 = this.storeTexture(a1);
    this.uniforms.uImpData0.value = this.data0;
    this.uniforms.uImpData1.value = this.data1;
    // The new textures are uploaded whole by three, so the runs recorded against the old
    // ones describe nothing.
    this.storeRuns.length = 0;
  }

  private data0: THREE.DataTexture;
  private data1: THREE.DataTexture;
  /**
   * Row runs written since the last upload, as `[y0, y1)` pairs. Cleared by `flushStore`,
   * dropped wholesale when `grow` replaces the textures (which are then uploaded whole).
   */
  private readonly storeRuns: [number, number][] = [];

  private storeTexture(data: Float32Array): THREE.DataTexture {
    const t = new THREE.DataTexture(data, STORE_WIDTH, data.length / A / STORE_WIDTH, THREE.RGBAFormat, THREE.FloatType);
    t.minFilter = THREE.NearestFilter;
    t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  }

  /**
   * Uploads the store's rows written since the last call, ONE RECTANGLE PER RUN.
   *
   * A tile is a contiguous run of rows, so a tile costs its own rows (2 rows, 64 KiB, for
   * a five-hundred-tree tile) rather than everything between the lowest and the highest
   * row written this frame. Overlapping and adjacent runs are merged first, and the runs
   * are sorted once per flush: the list holds one entry per tile added, which is a handful
   * per second, not per frame.
   *
   * Once three has made the textures (their first draw), the upload is done by hand, as
   * the grass cache does, so only those rows go up.
   */
  private flushStore(): void {
    if (this.storeRuns.length === 0) return;
    const props = this.renderer.properties;
    const t0 = (props.get(this.data0) as { __webglTexture?: WebGLTexture }).__webglTexture;
    const t1 = (props.get(this.data1) as { __webglTexture?: WebGLTexture }).__webglTexture;
    if (!t0 || !t1) {
      this.data0.needsUpdate = true;
      this.data1.needsUpdate = true;
      this.storeRuns.length = 0;
      return;
    }
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const state = this.renderer.state;
    state.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    state.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    state.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    state.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    this.storeRuns.sort((a, b) => a[0] - b[0]);
    let runStart = this.storeRuns[0]![0];
    let runEnd = this.storeRuns[0]![1];
    for (let i = 1; i <= this.storeRuns.length; i++) {
      const next = this.storeRuns[i];
      if (next && next[0] <= runEnd) {
        if (next[1] > runEnd) runEnd = next[1];
        continue;
      }
      for (const [tex, data] of [[t0, this.a0], [t1, this.a1]] as const) {
        state.bindTexture(gl.TEXTURE_2D, tex);
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          0,
          runStart,
          STORE_WIDTH,
          runEnd - runStart,
          gl.RGBA,
          gl.FLOAT,
          data,
          runStart * STORE_WIDTH * A,
        );
      }
      runStart = next ? next[0] : 0;
      runEnd = next ? next[1] : 0;
    }
    this.storeRuns.length = 0;
  }
}
