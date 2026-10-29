import * as THREE from 'three';
import { stickerDef, type StickerKind } from '../items/stickercatalog';
import { stickerAtlas, stickerDieCut, type AtlasRect } from './stickerart';
import { maxAnisotropy } from './texturequality';

/**
 * THE STICKER FIGURINE (items/items.ts `StickerFigurineItem`), the claw machine's prize
 * (world/claw.ts): a thick block cut in the outline of one sticker, its print on both
 * faces (seen mirrored from the back, as through clear acrylic), its edges vinyl white.
 *
 * The outline is read off the sticker atlas (render/stickerart.ts): from the design's
 * middle, the farthest inked pixel along each of `OUTLINE_RAYS` directions, the notches
 * between neighbours filled — the die-cut rim for most designs (a star is a star, an
 * oval an oval). A design printed on clear film (bullet holes, TURBO, the chevrons) has
 * no rim to follow and stands on a rounded block instead. Every figurine is the same
 * size along its longer side (`FIGURINE_SIZE_M`), whatever its sticker's size on a car.
 *
 * Its face is +Z, its middle at the origin. One material, so a figurine is one draw, in
 * a shape linked at boot so it never links a program on sight: a sign board's
 * (world/market.ts `marketProgramAnchor`: a map, no shadows) over the atlas printed on
 * vinyl white, with a white band under it that the edges read. Figurines cast and receive
 * no shadows, as items do. Geometry is built once per design and the material once,
 * shared by every figurine (no item-owned resources to dispose).
 *
 * A claw machine's heap is ONE mesh (`FigurineBatch`): every figurine's triangles in one
 * buffer with the same material, so the heap is one draw whatever its count. A figurine
 * is moved or taken out of it by rewriting its own range of the buffer, once, when it
 * moves; nothing is rebuilt per frame.
 *
 * Headless (the tools, no DOM) there is no atlas: every figurine is a plain block.
 */

/** The longer side of every figurine's outline, metres. */
export const FIGURINE_SIZE_M = 0.17;
/** Its thickness, metres. */
export const FIGURINE_THICK_M = 0.035;
/** Directions the outline is read along from the design's middle: 124 triangles a figurine. */
const OUTLINE_RAYS = 32;
/** The atlas is read for outlines at this share of its resolution, once for every design. */
const TRACE_SCALE = 0.5;
/** Atlas alpha (0..255) above which a pixel is print or rim. */
const INKED_ALPHA = 96;
/** The faces' texture is the atlas at this share of its resolution: a figurine is 17 cm. */
const FACE_SCALE = 0.5;
/** The block's edges and what shows round a print: the die-cut rim's white. */
const VINYL = '#f3eee2';
/** The white band under the printed atlas on the face texture, pixels: the edges' colour. */
const EDGE_BAND_PX = 32;

const geometries = new Map<StickerKind, THREE.BufferGeometry>();
let face: { material: THREE.MeshStandardMaterial; atlasShare: number } | null = null;
/** The atlas's alpha at `TRACE_SCALE`, read once for every design's outline. */
let traceAlpha: { readonly data: Uint8ClampedArray; readonly width: number; readonly height: number } | null = null;

/** A figurine of sticker `kind`, sharing its geometry and the material. */
export function createFigurineMesh(kind: StickerKind): THREE.Mesh {
  const mesh = new THREE.Mesh(figurineGeometry(kind), figurineFace().material);
  mesh.name = 'sticker-figurine';
  return mesh;
}

/**
 * The block for sticker `kind`, extruded along Z about the origin: its two faces read
 * the design's atlas rectangle, its edges the white band.
 */
export function figurineGeometry(kind: StickerKind): THREE.BufferGeometry {
  const cached = geometries.get(kind);
  if (cached) return cached;
  const def = stickerDef(kind);
  const aspect = def.widthM / def.heightM;
  const w = aspect >= 1 ? FIGURINE_SIZE_M : FIGURINE_SIZE_M * aspect;
  const h = aspect >= 1 ? FIGURINE_SIZE_M / aspect : FIGURINE_SIZE_M;
  const rect = typeof document === 'undefined' ? undefined : stickerAtlas().rects.get(kind);
  const outline = rect && stickerDieCut(kind) ? traceOutline(rect, w, h) : null;
  const shape = outline ? new THREE.Shape(outline) : roundedBlock(w, h);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: FIGURINE_THICK_M, bevelEnabled: false, curveSegments: 4 });
  geometry.translate(0, 0, -FIGURINE_THICK_M / 2);
  // Group 0 is the faces: they read the design's rectangle (the outline's box is the
  // design's own), squeezed into the face texture's top share; group 1, the edges, the
  // band under it.
  if (rect) {
    const share = figurineFace().atlasShare;
    const band = (1 - share) / 2;
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
    const [u0, v0, u1, v1] = rect;
    for (const group of geometry.groups) {
      for (let i = group.start; i < group.start + group.count; i++) {
        if (group.materialIndex === 0) {
          const v = v0 + (position.getY(i) / h + 0.5) * (v1 - v0);
          uv.setXY(i, u0 + (position.getX(i) / w + 0.5) * (u1 - u0), 1 - (1 - v) * share);
        } else {
          uv.setXY(i, 0.5, band);
        }
      }
    }
    uv.needsUpdate = true;
  }
  // One material: every group draws with it, in one draw.
  geometry.clearGroups();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometries.set(kind, geometry);
  return geometry;
}

/**
 * A HEAP of figurines as ONE mesh: each figurine's triangles copied into one buffer, in
 * the order of `kinds` and at the poses of `matrices` (the heap mesh's frame), all drawn
 * with the figurine material in one draw. `place` writes
 * one figurine's range at a pose, `hide` folds it to nothing; each uploads only that
 * range, and only when called — the heap is static between them. Its bounds are `bounds`
 * (the glass box the figurines stay in), set once, so a moved figurine is never culled.
 */
export class FigurineBatch {
  readonly mesh: THREE.Mesh;
  private readonly kinds: readonly StickerKind[];
  /** First vertex and vertex count of each figurine's range. */
  private readonly starts: number[] = [];
  private readonly counts: number[] = [];
  private readonly position: THREE.BufferAttribute;
  private readonly normal: THREE.BufferAttribute;
  private readonly normalMatrix = new THREE.Matrix3();

  constructor(kinds: readonly StickerKind[], matrices: readonly THREE.Matrix4[], bounds: THREE.Sphere) {
    this.kinds = kinds;
    let total = 0;
    for (const kind of kinds) {
      const count = figurineGeometry(kind).getAttribute('position').count;
      this.starts.push(total);
      this.counts.push(count);
      total += count;
    }
    const geometry = new THREE.BufferGeometry();
    this.position = new THREE.BufferAttribute(new Float32Array(total * 3), 3);
    this.normal = new THREE.BufferAttribute(new Float32Array(total * 3), 3);
    const uv = new THREE.BufferAttribute(new Float32Array(total * 2), 2);
    this.position.setUsage(THREE.DynamicDrawUsage);
    this.normal.setUsage(THREE.DynamicDrawUsage);
    kinds.forEach((kind, i) => uv.array.set((figurineGeometry(kind).getAttribute('uv') as THREE.BufferAttribute).array, this.starts[i]! * 2));
    geometry.setAttribute('position', this.position);
    geometry.setAttribute('normal', this.normal);
    geometry.setAttribute('uv', uv);
    geometry.boundingSphere = bounds.clone();
    geometry.boundingBox = new THREE.Box3().setFromCenterAndSize(bounds.center, new THREE.Vector3().setScalar(bounds.radius * 2));
    this.mesh = new THREE.Mesh(geometry, figurineFace().material);
    this.mesh.name = 'figurine-heap';
    // Uploaded whole the first time it is drawn: no ranges to send.
    matrices.forEach((matrix, i) => this.write(i, matrix));
  }

  /** Writes figurine `i` at `matrix` (the heap mesh's frame). */
  place(i: number, matrix: THREE.Matrix4): void {
    this.write(i, matrix);
    this.upload(i);
  }

  /**
   * Writes figurine `i` at `matrix` (the heap mesh's frame). Straight on the arrays, with
   * three's own arithmetic (`Vector3.applyMatrix4`, `applyMatrix3`, `normalize`) written
   * out: a heap is tens of thousands of vertices, built in the frame its machine streams in.
   */
  private write(i: number, matrix: THREE.Matrix4): void {
    const source = figurineGeometry(this.kinds[i]!);
    const from = (source.getAttribute('position') as THREE.BufferAttribute).array;
    const normals = (source.getAttribute('normal') as THREE.BufferAttribute).array;
    const e = matrix.elements;
    const n = this.normalMatrix.getNormalMatrix(matrix).elements;
    const toPosition = this.position.array;
    const toNormal = this.normal.array;
    const count = this.counts[i]!;
    for (let k = 0, at = this.starts[i]! * 3; k < count; k++, at += 3) {
      const x = from[k * 3]!;
      const y = from[k * 3 + 1]!;
      const z = from[k * 3 + 2]!;
      const w = 1 / (e[3]! * x + e[7]! * y + e[11]! * z + e[15]!);
      toPosition[at] = (e[0]! * x + e[4]! * y + e[8]! * z + e[12]!) * w;
      toPosition[at + 1] = (e[1]! * x + e[5]! * y + e[9]! * z + e[13]!) * w;
      toPosition[at + 2] = (e[2]! * x + e[6]! * y + e[10]! * z + e[14]!) * w;
      const a = normals[k * 3]!;
      const b = normals[k * 3 + 1]!;
      const c = normals[k * 3 + 2]!;
      const nx = n[0]! * a + n[3]! * b + n[6]! * c;
      const ny = n[1]! * a + n[4]! * b + n[7]! * c;
      const nz = n[2]! * a + n[5]! * b + n[8]! * c;
      const scale = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
      toNormal[at] = nx * scale;
      toNormal[at + 1] = ny * scale;
      toNormal[at + 2] = nz * scale;
    }
  }

  /** Folds figurine `i` to a point: it is out of the heap (held, falling, won). */
  hide(i: number): void {
    const start = this.starts[i]!;
    (this.position.array as Float32Array).fill(0, start * 3, (start + this.counts[i]!) * 3);
    this.upload(i);
  }

  private upload(i: number): void {
    const start = this.starts[i]! * 3;
    const count = this.counts[i]! * 3;
    this.position.addUpdateRange(start, count);
    this.normal.addUpdateRange(start, count);
    this.position.needsUpdate = true;
    this.normal.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
  }
}

/**
 * The die-cut outline of the design at `rect` on the atlas, scaled to `w` x `h` metres
 * about its middle (y up); null when nothing on it reads as inked.
 */
function traceOutline(rect: AtlasRect, w: number, h: number): THREE.Vector2[] | null {
  if (!traceAlpha) {
    const atlas = stickerAtlas().texture.image as HTMLCanvasElement;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(atlas.width * TRACE_SCALE);
    canvas.height = Math.round(atlas.height * TRACE_SCALE);
    const g = canvas.getContext('2d', { willReadFrequently: true });
    if (!g) return null;
    g.drawImage(atlas, 0, 0, canvas.width, canvas.height);
    traceAlpha = { data: g.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height };
  }
  const { data, width, height } = traceAlpha;
  // The rectangle in pixels (y down): v = 1 is the top row.
  const x0 = Math.round(rect[0] * width);
  const y0 = Math.round((1 - rect[3]) * height);
  const pw = Math.max(1, Math.round((rect[2] - rect[0]) * width));
  const ph = Math.max(1, Math.round((rect[3] - rect[1]) * height));
  const cx = pw / 2;
  const cy = ph / 2;
  const radii = new Array<number>(OUTLINE_RAYS).fill(0);
  for (let i = 0; i < OUTLINE_RAYS; i++) {
    const a = (i / OUTLINE_RAYS) * Math.PI * 2;
    // Shape y is up, canvas y down.
    const dx = Math.cos(a);
    const dy = -Math.sin(a);
    for (let t = 0; ; t += 1) {
      const px = Math.floor(cx + dx * t);
      const py = Math.floor(cy + dy * t);
      if (px < 0 || py < 0 || px >= pw || py >= ph) break;
      if (data[((y0 + py) * width + x0 + px) * 4 + 3]! > INKED_ALPHA) radii[i] = t + 1;
    }
  }
  if (radii.every((r) => r === 0)) return null;
  // A notch narrower than a ray's spacing (between two paw prints, a star's inner
  // corner where the rim is thin) is filled to its neighbours' mean, twice.
  for (let pass = 0; pass < 2; pass++) {
    const was = radii.slice();
    for (let i = 0; i < OUTLINE_RAYS; i++) {
      const mean = (was[(i + OUTLINE_RAYS - 1) % OUTLINE_RAYS]! + was[(i + 1) % OUTLINE_RAYS]!) / 2;
      radii[i] = Math.max(was[i]!, mean * 0.92);
    }
  }
  const metres = w / pw;
  const least = 0.2 * Math.min(pw, ph) / 2;
  return radii.map((r, i) => {
    const a = (i / OUTLINE_RAYS) * Math.PI * 2;
    const radius = Math.max(least, r);
    return new THREE.Vector2(
      Math.max(-w / 2, Math.min(w / 2, Math.cos(a) * radius * metres)),
      Math.max(-h / 2, Math.min(h / 2, Math.sin(a) * radius * metres)),
    );
  });
}

/** A rounded block `w` x `h` metres about the origin: a design on clear film stands on one. */
function roundedBlock(w: number, h: number): THREE.Shape {
  const r = 0.14 * Math.min(w, h);
  const x = w / 2;
  const y = h / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-x + r, -y);
  shape.lineTo(x - r, -y);
  shape.quadraticCurveTo(x, -y, x, -y + r);
  shape.lineTo(x, y - r);
  shape.quadraticCurveTo(x, y, x - r, y);
  shape.lineTo(-x + r, y);
  shape.quadraticCurveTo(-x, y, -x, y - r);
  shape.lineTo(-x, -y + r);
  shape.quadraticCurveTo(-x, -y, -x + r, -y);
  return shape;
}

/**
 * The faces' board material over the atlas printed on vinyl white, with the white band
 * under it, and the share of the texture's height the atlas takes (its top).
 */
function figurineFace(): { material: THREE.MeshStandardMaterial; atlasShare: number } {
  if (face) return face;
  let map: THREE.Texture;
  let atlasShare = 1;
  if (typeof document === 'undefined') {
    map = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    map.needsUpdate = true;
  } else {
    const atlas = stickerAtlas().texture.image as HTMLCanvasElement;
    const canvas = document.createElement('canvas');
    const atlasH = Math.round(atlas.height * FACE_SCALE);
    canvas.width = Math.round(atlas.width * FACE_SCALE);
    canvas.height = atlasH + EDGE_BAND_PX;
    atlasShare = atlasH / canvas.height;
    const g = canvas.getContext('2d');
    if (g) {
      g.fillStyle = VINYL;
      g.fillRect(0, 0, canvas.width, canvas.height);
      g.drawImage(atlas, 0, 0, canvas.width, atlasH);
    }
    map = new THREE.CanvasTexture(canvas);
    map.anisotropy = maxAnisotropy();
  }
  map.colorSpace = THREE.SRGBColorSpace;
  face = { material: new THREE.MeshStandardMaterial({ map, roughness: 0.6, metalness: 0.1 }), atlasShare };
  return face;
}
