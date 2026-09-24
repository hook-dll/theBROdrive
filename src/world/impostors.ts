import * as THREE from 'three';

import { applyComicShading } from '../render/comic';
import type { TreeVariant } from './props/trees';

/**
 * FAR TREES AS IMPOSTORS: every tree past the model range drawn as one quad turned to
 * face the camera, painted from an atlas baked out of the tree's own far model.
 *
 * This is what lets a wood be seen from two kilometres as trees, and approach as
 * trees. The models cost hundreds of triangles each and stop at a few hundred metres;
 * a quad costs two, so the same wood can stand out to the horizon's haze. Nothing
 * here scales a tree: an impostor is swapped for its model at one exact distance
 * (both sides measure from the same point, see `setBucketCentre`), and at the far
 * end it dissolves pixel by pixel into the canopy blanket rather than shrinking.
 *
 * Lighting is the ground's comic shading on a bent normal — facing the camera,
 * rounded toward the quad's sides — so a far crown has a lit and a shaded half on the
 * sun's side like its model does. The atlas holds albedo only.
 */

const CELL_W = 128;
const CELL_H = 256;
const COLS = 8;

export interface ImpostorCell {
  readonly index: number;
  /** Quad size at scale 1, metres. */
  readonly width: number;
  readonly height: number;
  /** Metres the model's foot sits below the quad's bottom (a sunk bush). */
  readonly drop: number;
}

export interface ImpostorAtlas {
  readonly texture: THREE.Texture;
  readonly cols: number;
  readonly rows: number;
  /** [kind][variant] */
  readonly cells: readonly (readonly ImpostorCell[])[];
}

/** Renders every variant's far model side-on into one atlas. */
export function bakeImpostorAtlas(renderer: THREE.WebGLRenderer, variants: readonly TreeVariant[][]): ImpostorAtlas {
  const total = variants.reduce((n, k) => n + k.length, 0);
  const rows = Math.ceil(total / COLS);
  const target = new THREE.WebGLRenderTarget(COLS * CELL_W, rows * CELL_H, {
    type: THREE.HalfFloatType,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
  });
  target.texture.colorSpace = THREE.LinearSRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, 0, -100, 100);
  camera.position.set(0, 0, 50);
  camera.lookAt(0, 0, 0);

  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevAutoClear = renderer.autoClear;
  const prevScissor = renderer.getScissorTest();
  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = false;
  renderer.clear(true, true, true);
  renderer.setScissorTest(true);

  const cells: ImpostorCell[][] = [];
  let index = 0;
  const box = new THREE.Box3();
  for (const kind of variants) {
    const kindCells: ImpostorCell[] = [];
    for (const variant of kind) {
      scene.clear();
      box.makeEmpty();
      for (const part of variant.far) {
        const source = part.material;
        const mesh = new THREE.Mesh(
          part.geometry,
          new THREE.MeshBasicMaterial({
            map: source.map,
            color: source.color,
            vertexColors: source.vertexColors,
            alphaTest: source.alphaTest,
            side: THREE.DoubleSide,
          }),
        );
        scene.add(mesh);
        part.geometry.computeBoundingBox();
        box.union(part.geometry.boundingBox!);
      }
      const halfW = Math.max(box.max.x, -box.min.x, box.max.z, -box.min.z, (box.max.y - box.min.y) / 4) * 1.02;
      const height = box.max.y - box.min.y;
      // Keep the cell's 1:2 aspect: whichever of width and height is short is padded.
      const quadW = Math.max(halfW * 2, height / 2);
      const quadH = quadW * 2;
      camera.left = -quadW / 2;
      camera.right = quadW / 2;
      camera.bottom = box.min.y;
      camera.top = box.min.y + quadH;
      camera.updateProjectionMatrix();
      const col = index % COLS;
      const row = Math.floor(index / COLS);
      renderer.setViewport(col * CELL_W, row * CELL_H, CELL_W, CELL_H);
      renderer.setScissor(col * CELL_W, row * CELL_H, CELL_W, CELL_H);
      renderer.render(scene, camera);
      for (const child of scene.children) ((child as THREE.Mesh).material as THREE.Material).dispose();
      kindCells.push({ index, width: quadW, height: quadH, drop: -box.min.y });
      index++;
    }
    cells.push(kindCells);
  }

  renderer.setScissorTest(prevScissor);
  renderer.autoClear = prevAutoClear;
  renderer.setClearColor(prevClear, prevAlpha);
  renderer.setRenderTarget(prevTarget);
  return { texture: target.texture, cols: COLS, rows, cells };
}

/** Floats per impostor in each of the two instance attributes. */
const A = 4;

interface Range {
  start: number;
  count: number;
}

/**
 * The impostor buffer: one instanced quad draw for every far tree. Tiles own
 * contiguous ranges of it, first-fit; a freed range is zeroed (a zero-size quad
 * rasterises nothing) and reused.
 */
export class ImpostorField {
  readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly material: THREE.MeshStandardMaterial;
  private a0: Float32Array;
  private a1: Float32Array;
  private capacity: number;
  private highWater = 0;
  private readonly free: Range[] = [];
  private readonly owned = new Map<string, Range>();
  private readonly uniforms = {
    uBucketCentre: { value: new THREE.Vector2() },
    uFrom: { value: 0 },
    uTo: { value: 0 },
    uDissolve: { value: 0 },
    uCells: { value: new THREE.Vector2() },
  };

  constructor(atlas: ImpostorAtlas, from: number, to: number) {
    this.capacity = 16384;
    this.a0 = new Float32Array(this.capacity * A);
    this.a1 = new Float32Array(this.capacity * A);
    this.geometry = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    this.geometry.index = quad.index;
    this.geometry.setAttribute('position', quad.getAttribute('position'));
    this.geometry.setAttribute('normal', quad.getAttribute('normal'));
    this.geometry.setAttribute('uv', quad.getAttribute('uv'));
    this.attach();
    this.uniforms.uFrom.value = from;
    this.uniforms.uTo.value = to;
    this.uniforms.uDissolve.value = to * 0.82;
    this.uniforms.uCells.value.set(atlas.cols, atlas.rows);

    const material = applyComicShading(
      new THREE.MeshStandardMaterial({ map: atlas.texture, alphaTest: 0.5, roughness: 0.95, metalness: 0 }),
      { contourStrength: 0, stippleStrength: 0, shadowWarmth: 0.3 },
    );
    const compileComic = material.onBeforeCompile;
    const u = this.uniforms;
    material.onBeforeCompile = (shader, renderer) => {
      compileComic.call(material, shader, renderer);
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
attribute vec4 aImp0;
attribute vec4 aImp1;
uniform vec2 uBucketCentre;
uniform float uFrom;
uniform float uTo;
uniform float uDissolve;
uniform vec2 uCells;
varying vec2 vImpUv;
varying float vImpTint;
varying float vImpFade;
varying float vImpHash;`,
        )
        .replace(
          '#include <beginnormal_vertex>',
          `vec3 impBase = aImp0.xyz;
vec3 impWorld = ( modelMatrix * vec4( impBase, 1.0 ) ).xyz;
vec2 impTo = cameraPosition.xz - impWorld.xz;
vec3 impFwd = normalize( vec3( impTo.x, 0.0, impTo.y ) + vec3( 1e-4, 0.0, 0.0 ) );
vec3 impRight = vec3( impFwd.z, 0.0, -impFwd.x );
vec3 objectNormal = normalize( impFwd * 0.8 + impRight * position.x * 1.4 + vec3( 0.0, 0.3, 0.0 ) );`,
        )
        .replace(
          '#include <begin_vertex>',
          `float impCell = aImp1.x;
float impDist = length( impBase.xz - uBucketCentre );
float impCam = length( impTo );
vec3 transformed = impBase + impRight * position.x * aImp1.y + vec3( 0.0, position.y * aImp1.z - aImp0.w, 0.0 );
if ( impDist < uFrom || impCam > uTo || aImp1.y <= 0.0 ) transformed = impBase;
vec2 impCellXY = vec2( mod( impCell, uCells.x ), floor( impCell / uCells.x ) );
vImpUv = ( impCellXY + uv ) / uCells;
vImpTint = aImp1.w;
vImpFade = smoothstep( uDissolve, uTo, impCam );
vImpHash = fract( sin( dot( impBase.xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec2 vImpUv;
varying float vImpTint;
varying float vImpFade;
varying float vImpHash;`,
        )
        .replace(
          '#include <map_fragment>',
          `if ( vImpHash < vImpFade ) discard;
vec4 sampledDiffuseColor = texture2D( map, vImpUv );
diffuseColor *= sampledDiffuseColor;
diffuseColor.rgb *= vImpTint;`,
        );
    };
    const comicKey = material.customProgramCacheKey;
    material.customProgramCacheKey = () => `${comicKey.call(material)}:impostor-v1`;
    this.material = material;
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
  }

  private attach(): void {
    const a0 = new THREE.InstancedBufferAttribute(this.a0, A);
    const a1 = new THREE.InstancedBufferAttribute(this.a1, A);
    a0.setUsage(THREE.DynamicDrawUsage);
    a1.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('aImp0', a0);
    this.geometry.setAttribute('aImp1', a1);
    this.geometry.instanceCount = this.highWater;
  }

  /** The point both the CPU model buckets and this shader measure the swap from. */
  setBucketCentre(x: number, z: number): void {
    this.uniforms.uBucketCentre.value.set(x, z);
  }

  has(key: string): boolean {
    return this.owned.has(key);
  }

  /**
   * Writes a tile's impostors. `fill(i, a0, a1, at)` writes impostor `i` of `count`
   * into the two arrays at float offset `at`.
   */
  add(key: string, count: number, fill: (i: number, a0: Float32Array, a1: Float32Array, at: number) => void): void {
    this.remove(key);
    if (count === 0) {
      this.owned.set(key, { start: 0, count: 0 });
      return;
    }
    const range = this.allocate(count);
    for (let i = 0; i < count; i++) fill(i, this.a0, this.a1, (range.start + i) * A);
    this.owned.set(key, range);
    this.touch(range);
  }

  remove(key: string): void {
    const range = this.owned.get(key);
    if (!range) return;
    this.owned.delete(key);
    if (range.count === 0) return;
    this.a1.fill(0, range.start * A, (range.start + range.count) * A);
    this.touch(range);
    this.free.push({ start: range.start, count: range.count });
  }

  keys(): IterableIterator<string> {
    return this.owned.keys();
  }

  private allocate(count: number): Range {
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
      const range = { start: f.start, count };
      f.start += count;
      f.count -= count;
      if (f.count === 0) this.free.splice(i, 1);
      return range;
    }
    if (this.highWater + count > this.capacity) this.grow(this.highWater + count);
    const range = { start: this.highWater, count };
    this.highWater += count;
    this.geometry.instanceCount = this.highWater;
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
    this.capacity = capacity;
    this.attach();
  }

  private touch(range: Range): void {
    for (const name of ['aImp0', 'aImp1']) {
      const attribute = this.geometry.getAttribute(name) as THREE.InstancedBufferAttribute;
      attribute.addUpdateRange(range.start * A, range.count * A);
      attribute.needsUpdate = true;
    }
  }
}
