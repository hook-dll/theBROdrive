/**
 * Stickers as projected decal geometry — the whole of what a placed sticker is.
 *
 * A sticker used to be printed inside the car's paint and glass shaders: one mat4 per
 * sticker in a fixed 24-slot uniform array, so a car could carry twenty-four and no
 * more (a car with more kept them in the save and never drew them). They are geometry
 * now. Each sticker is projected ONCE, in chassis metres, onto the car's
 * sticker-carrying surfaces — the paint slots and the window glass placement accepts —
 * trimmed by the sticker's own plane and outline, and every decal of one car is merged
 * into ONE BufferGeometry with the sticker atlas for a texture: one draw call for
 * hundreds of stickers.
 *
 * The projection is the old shader's rule, term for term: a fragment took a sticker
 * when it lay within 4 cm of the sticker's plane, inside its rectangle, and its own
 * face looked the sticker's way (see `project`). Clipping a triangle against those five
 * half-spaces in chassis space resolves the same rule once on the CPU instead of per
 * fragment per frame, and every vertex it produces lies ON the panel, so a decal
 * follows the body's curve exactly as the printed one did — over a panel edge it stops
 * at the edge, on a curved wing it wraps the wing.
 *
 * Everything is rebuilt only when something changes: the merged mesh when the car's
 * stickers change (place, remove, load), the preview — a second, small mesh — only when
 * the aimed pose or size moves. `setStickers` runs every frame during a try-on and does
 * nothing at all when neither moved.
 *
 * The decal mesh hangs under the same node the paint does and carries the same
 * `carBodyPos` the wear is computed in, so it rides the body — including the suspension
 * squash — and gathers the paint's dust and scratches with it (materials.ts
 * STICKER_DECAL_WEAR). A decal is drawn as a transparent overlay that does not write
 * depth, so where two of them land on one spot the newer one, written later in the
 * buffer, stays on top: the order the printed decals were laid in.
 */

import * as THREE from 'three';
import type { StickerState } from '../game/state';
import { stickerDef } from '../items/stickercatalog';
import { stickerAtlas, type AtlasRect } from './stickerart';
import {
  CAR_BODY_POSITION_ATTRIBUTE,
  STICKER_PREVIEW_ALPHA,
  makeCarStickerMaterial,
  type CarGrimeFrame,
} from './materials';

/** The plane window the print covers, metres: the printed decal's own 4 cm slab. */
const DECAL_DEPTH_M = 0.04;
/** How much of the print a face must look along to take it at all. */
const DECAL_FACING_MIN = 0.35;
/** Where the print fades out as a face turns away from the sticker's normal. */
const DECAL_FACING_FADE_LO = 0.35;
const DECAL_FACING_FADE_HI = 0.6;
/** How far a decal floats off the panel it was clipped from, metres. */
const DECAL_LIFT_M = 0.0015;
/** Candidate-lookup grid cell, metres. */
const GRID_CELL_M = 0.5;
/** Vertices a fresh attribute buffer can hold; grows by doubling. */
const MIN_VERTEX_CAPACITY = 64;
/** A triangle cut by six half-spaces can have at most nine corners; twelve is slack. */
const MAX_POLYGON_VERTICES = 12;
/**
 * How long one frame may spend projecting this car's stickers, milliseconds.
 *
 * A sticker is projected over the whole dense body it lands on, and the densest body in
 * the fleet (the GTA V 2110's 89k sticker-carrying triangles) costs about 0.3 ms each:
 * two hundred of them in one go is 60 ms, four frames of hitch while the player is
 * looking straight at the car. Measured, not guessed — see `advance`.
 */
const REBUILD_BUDGET_MS = 3;
/** Stickers between two clock reads while a rebuild runs. */
const REBUILD_CHECK_STRIDE = 8;

/**
 * One mesh the decal path may print on, with the rule that says which of its triangles
 * carry stickers. `render/carmodel.ts` owns that rule — paint slots, window glass, and
 * the paint cell of a palette atlas — through `markStickerSurfaces`, and it is also what
 * leaves the chassis stamp on exactly these meshes, which is the frame read below.
 */
export interface StickerDecalSurface {
  readonly mesh: THREE.Mesh;
  /** Whether the triangle `triangle` of material slot `slot` may carry stickers. */
  readonly accepts: (slot: number, triangle: number) => boolean;
}

/** Decal meshes are drawn, never picked; see `CarStickerDecals`. */
function noRaycast(): void {}

/** The sticker's frame in chassis metres, plus where its design sits in the atlas. */
const _stickerQ = new THREE.Quaternion();
const STICKER_FORWARD = new THREE.Vector3(0, 0, 1);
/** The sticker's normal, tangent and bitangent: its frame, reused for a whole sticker. */
const _n = new THREE.Vector3();
const _t = new THREE.Vector3();
const _b = new THREE.Vector3();
/** The sticker's contact point, chassis metres. */
const _centre = new THREE.Vector3();
/** Six half-spaces a decal is clipped to, four floats each: `dot(p, n) + d >= 0`. */
const _planes = new Float64Array(6 * 4);
/** Sutherland-Hodgman working polygons, chassis metres, and their vertex normals. */
const _polyA = new Float64Array(MAX_POLYGON_VERTICES * 3);
const _polyB = new Float64Array(MAX_POLYGON_VERTICES * 3);
const _normA = new Float64Array(MAX_POLYGON_VERTICES * 3);
const _normB = new Float64Array(MAX_POLYGON_VERTICES * 3);
/** Scratch point. */
const _point = new THREE.Vector3();
/** Scratch normal, for reading a source geometry's own. */
const _normalScratch = new THREE.Vector3();

/**
 * Every sticker-carrying triangle of one car, in chassis metres, plus the grid that
 * finds the candidates for a sticker without walking the car. Built lazily — the first
 * time the car has a sticker to draw — so a traffic car with none costs nothing.
 */
class StickerDecalSource {
  /** Nine floats a triangle: its three corners in the chassis frame. */
  readonly corners: Float32Array;
  /** The same triangles' vertex normals, in the body node's frame. */
  readonly normals: Float32Array;
  readonly triangles: number;
  /** Chassis into the body node's frame: decal geometry is built in the body's own. */
  readonly toBody: THREE.Matrix4;

  private readonly cellStart: Int32Array;
  private readonly cellOrder: Int32Array;
  private readonly nx: number;
  private readonly ny: number;
  private readonly nz: number;
  private readonly minX: number;
  private readonly minY: number;
  private readonly minZ: number;
  /** Per triangle: the query that last looked at it, so a cell overlap is visited once. */
  private readonly visited: Int32Array;
  private query = 0;

  constructor(body: THREE.Object3D, toBody: THREE.Matrix4, surfaces: readonly StickerDecalSurface[]) {
    // The decal mesh is a child of the body node, and `carBodyPos` is the chassis frame
    // the body's own fit transform maps into: the decal geometry is built in the body's
    // local frame, so it follows the body (and the suspension squash) like the paint.
    // `toBody` is the REST inverse, captured when the car was cloned: read live, it
    // carried whatever bouncy-car squash the body had at the first sticker.
    this.toBody = toBody;
    const collected = collectTriangles(surfaces, body);
    this.corners = collected.corners;
    this.normals = collected.normals;
    this.triangles = this.corners.length / 9;
    const min = collected.min;
    const max = collected.max;
    this.minX = min.x;
    this.minY = min.y;
    this.minZ = min.z;
    this.nx = Math.max(1, Math.ceil((max.x - min.x) / GRID_CELL_M));
    this.ny = Math.max(1, Math.ceil((max.y - min.y) / GRID_CELL_M));
    this.nz = Math.max(1, Math.ceil((max.z - min.z) / GRID_CELL_M));
    const cells = this.nx * this.ny * this.nz;
    const counts = new Int32Array(cells + 1);
    for (let tri = 0; tri < this.triangles; tri++) {
      this.eachCell(tri, (cell) => {
        counts[cell + 1]!++;
      });
    }
    for (let cell = 0; cell < cells; cell++) counts[cell + 1]! += counts[cell]!;
    const order = new Int32Array(counts[cells]!);
    const cursor = counts.slice(0, cells);
    for (let tri = 0; tri < this.triangles; tri++) {
      this.eachCell(tri, (cell) => {
        order[cursor[cell]!++] = tri;
      });
    }
    this.cellStart = counts;
    this.cellOrder = order;
    this.visited = new Int32Array(this.triangles);
  }

  /** Visits every triangle whose bounding box meets the chassis-space box, once each. */
  queryBox(
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number,
    visit: (base: number) => void,
  ): void {
    const query = ++this.query;
    const ix0 = this.cellX(minX);
    const ix1 = this.cellX(maxX);
    const iy0 = this.cellY(minY);
    const iy1 = this.cellY(maxY);
    const iz0 = this.cellZ(minZ);
    const iz1 = this.cellZ(maxZ);
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let iy = iy0; iy <= iy1; iy++) {
        const rowBase = (iz * this.ny + iy) * this.nx;
        for (let ix = ix0; ix <= ix1; ix++) {
          const cell = rowBase + ix;
          const end = this.cellStart[cell + 1]!;
          for (let i = this.cellStart[cell]!; i < end; i++) {
            const tri = this.cellOrder[i]!;
            if (this.visited[tri] === query) continue;
            this.visited[tri] = query;
            visit(tri * 9);
          }
        }
      }
    }
  }

  /** The grid cells one triangle's bounding box covers. */
  private eachCell(tri: number, visit: (cell: number) => void): void {
    const base = tri * 9;
    const corners = this.corners;
    const x0 = this.cellX(Math.min(corners[base]!, corners[base + 3]!, corners[base + 6]!));
    const x1 = this.cellX(Math.max(corners[base]!, corners[base + 3]!, corners[base + 6]!));
    const y0 = this.cellY(Math.min(corners[base + 1]!, corners[base + 4]!, corners[base + 7]!));
    const y1 = this.cellY(Math.max(corners[base + 1]!, corners[base + 4]!, corners[base + 7]!));
    const z0 = this.cellZ(Math.min(corners[base + 2]!, corners[base + 5]!, corners[base + 8]!));
    const z1 = this.cellZ(Math.max(corners[base + 2]!, corners[base + 5]!, corners[base + 8]!));
    for (let iz = z0; iz <= z1; iz++) {
      for (let iy = y0; iy <= y1; iy++) {
        const rowBase = (iz * this.ny + iy) * this.nx;
        for (let ix = x0; ix <= x1; ix++) visit(rowBase + ix);
      }
    }
  }

  private cellX(x: number): number {
    const index = Math.floor((x - this.minX) / GRID_CELL_M);
    return index < 0 ? 0 : index >= this.nx ? this.nx - 1 : index;
  }

  private cellY(y: number): number {
    const index = Math.floor((y - this.minY) / GRID_CELL_M);
    return index < 0 ? 0 : index >= this.ny ? this.ny - 1 : index;
  }

  private cellZ(z: number): number {
    const index = Math.floor((z - this.minZ) / GRID_CELL_M);
    return index < 0 ? 0 : index >= this.nz ? this.nz - 1 : index;
  }
}

/**
 * Reads every sticker-carrying triangle into one flat array of chassis-local corners,
 * straight from the stamp `carmodel.ts` writes (`carBodyPos`): that attribute IS this
 * frame, so the source needs no matrix maths at all. The stamp covers exactly the
 * meshes the sticker rule accepts, so a mesh without it is not a sticker surface.
 */
function collectTriangles(surfaces: readonly StickerDecalSurface[], body: THREE.Object3D): {
  corners: Float32Array;
  normals: Float32Array;
  min: THREE.Vector3;
  max: THREE.Vector3;
} {
  const taken: { bodyPos: THREE.BufferAttribute; normal: THREE.BufferAttribute | null; index: THREE.BufferAttribute | null; triangles: Int32Array; used: number; toBodyNormal: THREE.Matrix3 | null }[] = [];
  let total = 0;
  // Normals go from each mesh's own frame into the body's, a RELATIVE transform: the
  // car's world pose cancels out of it, so a car that gets its first sticker facing
  // anywhere is lit right (it used to bake in the yaw it had at that moment).
  body.updateWorldMatrix(true, true);
  const bodyInverse = body.matrixWorld.clone().invert();
  for (const { mesh, accepts } of surfaces) {
    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position');
    const bodyPos = geometry.getAttribute(CAR_BODY_POSITION_ATTRIBUTE) as THREE.BufferAttribute | undefined;
    if (!position || !bodyPos) continue;
    const normal = (geometry.getAttribute('normal') as THREE.BufferAttribute | undefined) ?? null;
    const index = geometry.index;
    const count = index ? index.count / 3 : position.count / 3;
    const slots = materialSlots(geometry, count);
    const list = new Int32Array(count);
    let used = 0;
    for (let tri = 0; tri < count; tri++) {
      if (accepts(slots ? slots[tri]! : 0, tri)) list[used++] = tri;
    }
    if (used === 0) continue;
    // A normal has to arrive in the decal's own frame: the inverse transpose of the
    // transform its positions take, which is the mesh's chassis frame then the body's.
    const toBodyNormal = normal
      ? new THREE.Matrix3()
          .setFromMatrix4(new THREE.Matrix4().multiplyMatrices(bodyInverse, mesh.matrixWorld))
          .invert()
          .transpose()
      : null;
    taken.push({ bodyPos, normal, index, triangles: list, used, toBodyNormal });
    total += used * 9;
  }

  const corners = new Float32Array(total);
  const normals = new Float32Array(total);
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  let out = 0;
  for (const { bodyPos, normal, index, triangles, used, toBodyNormal } of taken) {
    for (let i = 0; i < used; i++) {
      const tri = triangles[i]!;
      for (let c = 0; c < 3; c++) {
        const vertex = index ? index.getX(tri * 3 + c) : tri * 3 + c;
        const x = bodyPos.getX(vertex);
        const y = bodyPos.getY(vertex);
        const z = bodyPos.getZ(vertex);
        corners[out] = x;
        corners[out + 1] = y;
        corners[out + 2] = z;
        if (normal && toBodyNormal) {
          _normalScratch.set(normal.getX(vertex), normal.getY(vertex), normal.getZ(vertex)).applyMatrix3(toBodyNormal).normalize();
          normals[out] = _normalScratch.x;
          normals[out + 1] = _normalScratch.y;
          normals[out + 2] = _normalScratch.z;
        }
        out += 3;
        min.x = Math.min(min.x, x);
        min.y = Math.min(min.y, y);
        min.z = Math.min(min.z, z);
        max.x = Math.max(max.x, x);
        max.y = Math.max(max.y, y);
        max.z = Math.max(max.z, z);
      }
    }
  }
  if (total === 0) {
    min.set(0, 0, 0);
    max.set(0, 0, 0);
  }
  return { corners, normals, min, max };
}

/** Material slot of every triangle of a multi-slot mesh; null when there is only one. */
function materialSlots(geometry: THREE.BufferGeometry, triangles: number): Int32Array | null {
  if (geometry.groups.length <= 1) return null;
  const slots = new Int32Array(triangles);
  for (const group of geometry.groups) {
    const first = Math.floor(group.start / 3);
    const last = Math.min(triangles, Math.ceil((group.start + group.count) / 3));
    for (let tri = first; tri < last; tri++) slots[tri] = group.materialIndex ?? 0;
  }
  return slots;
}

/**
 * Vertex buffers for one decal mesh, grown by doubling and never shrunk: a rebuild
 * writes from the front and `drawRange` says how much of it is live, so sticker after
 * sticker allocates nothing once the first few have been placed.
 */
class DecalBuffer {
  readonly geometry = new THREE.BufferGeometry();
  count = 0;

  private position!: THREE.BufferAttribute;
  private normal!: THREE.BufferAttribute;
  private uv!: THREE.BufferAttribute;
  private bodyPos!: THREE.BufferAttribute;
  private decal!: THREE.BufferAttribute;
  private capacity = 0;
  /** Vertices the GPU already has: a rebuild that spans frames uploads only the rest. */
  private uploaded = 0;
  /** Set while the attributes are fresh, when the whole buffer has to go over once. */
  private regrown = false;
  private readonly min = new THREE.Vector3();
  private readonly max = new THREE.Vector3();

  constructor() {
    this.grow(MIN_VERTEX_CAPACITY);
  }

  reset(): void {
    this.count = 0;
    this.uploaded = 0;
    this.min.set(Infinity, Infinity, Infinity);
    this.max.set(-Infinity, -Infinity, -Infinity);
  }

  /** One vertex: body-local position and normal, atlas uv, chassis position, opacity. */
  push(
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    u: number,
    v: number,
    bx: number,
    by: number,
    bz: number,
    alpha: number,
  ): void {
    if (this.count === this.capacity) this.grow(this.capacity * 2);
    const i = this.count++;
    this.position.setXYZ(i, x, y, z);
    this.normal.setXYZ(i, nx, ny, nz);
    this.uv.setXY(i, u, v);
    this.bodyPos.setXYZ(i, bx, by, bz);
    this.decal.setX(i, alpha);
    this.min.min(_point.set(x, y, z));
    this.max.max(_point);
  }

  /**
   * Publishes what was written. The mesh hides when there is nothing to draw, and the
   * bounding sphere is set rather than computed: the buffer keeps stale vertices past
   * `count`, and three would measure those into the sphere.
   */
  commit(mesh: THREE.Mesh): void {
    if (this.count === 0) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    this.geometry.setDrawRange(0, this.count);
    if (this.uploaded !== this.count || this.regrown) {
      for (const attribute of [this.position, this.normal, this.uv, this.bodyPos, this.decal]) {
        attribute.clearUpdateRanges();
        // A buffer three has not seen yet is uploaded whole when it is first bound, so
        // only a buffer that is already on the GPU needs the new range.
        if (!this.regrown) {
          attribute.addUpdateRange(
            this.uploaded * attribute.itemSize,
            (this.count - this.uploaded) * attribute.itemSize,
          );
        }
        attribute.needsUpdate = true;
      }
      this.uploaded = this.count;
      this.regrown = false;
    }
    const sphere = this.geometry.boundingSphere ?? new THREE.Sphere();
    this.geometry.boundingSphere = sphere;
    sphere.center.copy(this.max).add(this.min).multiplyScalar(0.5);
    sphere.radius = this.max.distanceTo(this.min) * 0.5 + 0.01;
  }

  dispose(): void {
    this.geometry.dispose();
  }

  private grow(vertices: number): void {
    const previous = this.capacity;
    this.capacity = Math.max(vertices, MIN_VERTEX_CAPACITY);
    const positions = new Float32Array(this.capacity * 3);
    const normals = new Float32Array(this.capacity * 3);
    const uvs = new Float32Array(this.capacity * 2);
    const bodyPositions = new Float32Array(this.capacity * 3);
    const decals = new Float32Array(this.capacity);
    // A rebuild can outgrow the buffer half way through, so what is already written has
    // to come across: dropping it would leave the first vertices of the decal at the
    // car's origin.
    if (previous > 0) {
      positions.set(this.position.array.subarray(0, previous * 3));
      normals.set(this.normal.array.subarray(0, previous * 3));
      uvs.set(this.uv.array.subarray(0, previous * 2));
      bodyPositions.set(this.bodyPos.array.subarray(0, previous * 3));
      decals.set(this.decal.array.subarray(0, previous));
    }
    // Dispose before the swap: three keys a GPU buffer by attribute object, so replacing
    // one without disposing leaks the buffer it was holding.
    this.geometry.dispose();
    this.position = new THREE.BufferAttribute(positions, 3);
    this.normal = new THREE.BufferAttribute(normals, 3);
    this.uv = new THREE.BufferAttribute(uvs, 2);
    this.bodyPos = new THREE.BufferAttribute(bodyPositions, 3);
    this.decal = new THREE.BufferAttribute(decals, 1);
    for (const attribute of [this.position, this.normal, this.uv, this.bodyPos, this.decal]) {
      attribute.setUsage(THREE.DynamicDrawUsage);
    }
    this.regrown = true;
    this.geometry.setAttribute('position', this.position);
    this.geometry.setAttribute('normal', this.normal);
    this.geometry.setAttribute('uv', this.uv);
    this.geometry.setAttribute(CAR_BODY_POSITION_ATTRIBUTE, this.bodyPos);
    this.geometry.setAttribute('aDecal', this.decal);
  }
}

/** The pose of the sticker the preview last drew, so an unchanged aim costs nothing. */
interface PreviewPose {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  roll: number;
  scale: number;
  kind: string;
  mirror: boolean;
}

/**
 * One car's stickers, drawn as merged decal geometry under its body node.
 *
 * Created per car instance by render/carmodel.ts, handed the paint material whose dirt
 * and scratches its decals wear. Nothing here runs until the car actually has a sticker
 * — or until one is being tried on it.
 */
export class CarStickerDecals {
  private readonly placed = new DecalBuffer();
  private readonly preview = new DecalBuffer();
  private readonly placedMesh: THREE.Mesh;
  private readonly previewMesh: THREE.Mesh;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly previewMaterial: THREE.MeshStandardMaterial;
  private readonly lastPreview: PreviewPose = {
    x: NaN, y: NaN, z: NaN, nx: NaN, ny: NaN, nz: NaN, roll: NaN, scale: NaN, kind: '', mirror: false,
  };
  private source: StickerDecalSource | null = null;
  private placedLength = -1;
  private placedStickers: readonly StickerState[] | null = null;
  /** The rebuild in flight: which list, and how far through it this frame got. */
  private build: { readonly stickers: readonly StickerState[]; next: number } | null = null;
  /** A slice is already booked for the next frame; a restart must not book a second. */
  private buildScheduled = false;
  /** rAF target for the next slice of a rebuild; one function, made once. */
  private readonly continueBuild = (): void => {
    this.buildScheduled = false;
    this.advance();
  };
  /** Chassis into the body node's REST frame, taken before anything animates the body. */
  private readonly restToBody: THREE.Matrix4;

  constructor(
    private readonly body: THREE.Object3D,
    private readonly surfaces: readonly StickerDecalSurface[],
    frame: CarGrimeFrame | null,
  ) {
    body.updateMatrix();
    this.restToBody = body.matrix.clone().invert();
    this.material = makeCarStickerMaterial(frame);
    this.previewMaterial = makeCarStickerMaterial(frame, STICKER_PREVIEW_ALPHA);
    this.placedMesh = new THREE.Mesh(this.placed.geometry, this.material);
    // Decals are not a surface to aim at: the placement ray takes the nearest face, and
    // a decal (or the hidden preview's stale geometry) has no sticker rule, so it used
    // to refuse the paint right under it and make the try-on flicker out.
    this.placedMesh.raycast = noRaycast;
    this.placedMesh.name = 'stickers';
    this.placedMesh.visible = false;
    this.placedMesh.castShadow = false;
    this.placedMesh.receiveShadow = false;
    // The preview draws after the placed decals whatever the depth sort says: it is the
    // thing under the crosshair and has to read over what is already stuck on.
    this.previewMesh = new THREE.Mesh(this.preview.geometry, this.previewMaterial);
    this.previewMesh.name = 'sticker-preview';
    this.previewMesh.visible = false;
    this.previewMesh.castShadow = false;
    this.previewMesh.receiveShadow = false;
    this.previewMesh.renderOrder = 1;
    this.previewMesh.raycast = noRaycast;
    body.add(this.placedMesh, this.previewMesh);
  }

  /**
   * Draws this car's placed stickers, plus the one being tried on (`preview`), or clears
   * both. Called every frame while a sticker is in hand: an unchanged list and an
   * unchanged aim cost a comparison each and nothing else.
   *
   * A changed list starts a rebuild rather than running one: `advance` does the first
   * slice now and the rest over the next frames.
   */
  setStickers(stickers: readonly StickerState[], preview: StickerState | null = null): void {
    if (stickers !== this.placedStickers || stickers.length !== this.placedLength) {
      // The list is append-only in play: a sticker added to the same array extends the
      // build from where it stood instead of blanking every placed one to start over.
      const builtUpTo = this.placedLength;
      const appended = stickers === this.placedStickers && stickers.length > builtUpTo
        && (this.build === null || this.build.stickers === stickers);
      this.placedStickers = stickers;
      this.placedLength = stickers.length;
      this.source ??= this.makeSource();
      if (!appended) {
        this.placed.reset();
        this.build = { stickers, next: 0 };
      } else {
        // A build in flight on this list just runs on to the new length.
        this.build ??= { stickers, next: builtUpTo };
      }
      if (!this.buildScheduled) this.advance();
    }
    if (!preview) {
      // Forget the pose too, or the same sticker coming back at the same aim would be
      // judged unchanged and stay hidden.
      this.lastPreview.kind = '';
      if (this.previewMesh.visible) {
        this.preview.reset();
        this.preview.commit(this.previewMesh);
      }
      return;
    }
    if (!this.poseChanged(preview)) return;
    this.source ??= this.makeSource();
    this.preview.reset();
    this.project(preview, this.preview);
    this.preview.commit(this.previewMesh);
  }

  private makeSource(): StickerDecalSource {
    return new StickerDecalSource(this.body, this.restToBody, this.surfaces);
  }

  /**
   * Projects as much of the pending rebuild as this frame can afford, publishes what is
   * done, and comes back next frame for the rest. The player is looking at the car while
   * hundreds of stickers stream on, so the work has to fit between two frames rather
   * than inside one.
   */
  private advance(): void {
    const build = this.build;
    if (!build) return;
    const until = performance.now() + REBUILD_BUDGET_MS;
    let next = build.next;
    while (next < build.stickers.length) {
      this.project(build.stickers[next]!, this.placed);
      next++;
      if (next % REBUILD_CHECK_STRIDE === 0 && performance.now() >= until) break;
    }
    build.next = next;
    this.placed.commit(this.placedMesh);
    if (next < build.stickers.length) {
      this.buildScheduled = true;
      requestAnimationFrame(this.continueBuild);
      return;
    }
    this.build = null;
  }

  /** Releases this car's decal geometry and materials (the atlas itself is shared). */
  dispose(): void {
    this.build = null;
    this.placedMesh.removeFromParent();
    this.previewMesh.removeFromParent();
    this.placed.dispose();
    this.preview.dispose();
    this.material.dispose();
    this.previewMaterial.dispose();
    this.source = null;
  }

  /** Whether the aimed sticker moved since the preview was drawn. */
  private poseChanged(sticker: StickerState): boolean {
    const last = this.lastPreview;
    const scale = sticker.scale ?? 1;
    const mirror = sticker.mirror === true;
    const changed = last.kind !== sticker.kind
      || last.x !== sticker.x
      || last.y !== sticker.y
      || last.z !== sticker.z
      || last.nx !== sticker.nx
      || last.ny !== sticker.ny
      || last.nz !== sticker.nz
      || last.roll !== sticker.roll
      || last.scale !== scale
      || last.mirror !== mirror;
    if (changed) {
      last.kind = sticker.kind;
      last.x = sticker.x;
      last.y = sticker.y;
      last.z = sticker.z;
      last.nx = sticker.nx;
      last.ny = sticker.ny;
      last.nz = sticker.nz;
      last.roll = sticker.roll;
      last.scale = scale;
      last.mirror = mirror;
    }
    return changed;
  }

  /**
   * Clips one sticker's print out of the car's sticker-carrying triangles.
   *
   * The frame is the placement's, as the shader built it: +Z onto the surface normal,
   * then rolled about it, with the print running along the tangent. Triangles whose own
   * face does not look along the sticker's normal are left alone (`abs`, so a print
   * crosses a thin edge to the panel behind it, as it always did), and what a taken
   * triangle contributes is the part of it inside the sticker's slab and rectangle.
   */
  private project(sticker: StickerState, out: DecalBuffer): void {
    const source = this.source;
    const rect = stickerAtlas().rects.get(sticker.kind);
    if (!source || !rect) return;
    const def = stickerDef(sticker.kind);
    const scale = sticker.scale ?? 1;
    const halfW = (def.widthM / 2) * scale;
    const halfH = (def.heightM / 2) * scale;
    _n.set(sticker.nx, sticker.ny, sticker.nz);
    if (_n.lengthSq() < 1e-8) _n.set(0, 1, 0);
    _n.normalize();
    _stickerQ.setFromUnitVectors(STICKER_FORWARD, _n);
    _t.set(1, 0, 0).applyQuaternion(_stickerQ).applyAxisAngle(_n, sticker.roll);
    _b.crossVectors(_n, _t);

    const cx = sticker.x;
    const cy = sticker.y;
    const cz = sticker.z;
    _centre.set(cx, cy, cz);
    const alongN = _n.x * cx + _n.y * cy + _n.z * cz;
    const alongT = _t.x * cx + _t.y * cy + _t.z * cz;
    const alongB = _b.x * cx + _b.y * cy + _b.z * cz;
    writePlane(0, _n.x, _n.y, _n.z, -alongN + DECAL_DEPTH_M);
    writePlane(1, -_n.x, -_n.y, -_n.z, alongN + DECAL_DEPTH_M);
    writePlane(2, _t.x, _t.y, _t.z, -alongT + halfW);
    writePlane(3, -_t.x, -_t.y, -_t.z, alongT + halfW);
    writePlane(4, _b.x, _b.y, _b.z, -alongB + halfH);
    writePlane(5, -_b.x, -_b.y, -_b.z, alongB + halfH);

    // The sticker's own box, chassis metres, for the candidate lookup.
    const reachX = Math.abs(_t.x) * halfW + Math.abs(_b.x) * halfH + Math.abs(_n.x) * DECAL_DEPTH_M;
    const reachY = Math.abs(_t.y) * halfW + Math.abs(_b.y) * halfH + Math.abs(_n.y) * DECAL_DEPTH_M;
    const reachZ = Math.abs(_t.z) * halfW + Math.abs(_b.z) * halfH + Math.abs(_n.z) * DECAL_DEPTH_M;
    const flip = sticker.mirror ? -1 : 1;
    source.queryBox(
      cx - reachX, cy - reachY, cz - reachZ, cx + reachX, cy + reachY, cz + reachZ,
      (base) => this.emitClipped(base, flip, halfW, halfH, rect, out),
    );
  }

  /** Clips one source triangle and writes the pieces of it the sticker covers. */
  private emitClipped(
    base: number,
    flip: number,
    halfW: number,
    halfH: number,
    rect: AtlasRect,
    out: DecalBuffer,
  ): void {
    const corners = this.source!.corners;
    const normals = this.source!.normals;
    const ax = corners[base]!;
    const ay = corners[base + 1]!;
    const az = corners[base + 2]!;
    const e1x = corners[base + 3]! - ax;
    const e1y = corners[base + 4]! - ay;
    const e1z = corners[base + 5]! - az;
    const e2x = corners[base + 6]! - ax;
    const e2y = corners[base + 7]! - ay;
    const e2z = corners[base + 8]! - az;
    let fx = e1y * e2z - e1z * e2y;
    let fy = e1z * e2x - e1x * e2z;
    let fz = e1x * e2y - e1y * e2x;
    const length = Math.sqrt(fx * fx + fy * fy + fz * fz);
    if (length < 1e-12) return;
    fx /= length;
    fy /= length;
    fz /= length;
    const facing = Math.abs(fx * _n.x + fy * _n.y + fz * _n.z);
    if (facing < DECAL_FACING_MIN) return;
    const alpha = facing >= DECAL_FACING_FADE_HI
      ? 1
      : (facing - DECAL_FACING_FADE_LO) / (DECAL_FACING_FADE_HI - DECAL_FACING_FADE_LO);

    let vertices = 3;
    for (let i = 0; i < 9; i++) {
      _polyA[i] = corners[base + i]!;
      _normA[i] = normals[base + i]!;
    }
    let src = _polyA;
    let dst = _polyB;
    let srcNormals = _normA;
    let dstNormals = _normB;
    for (let plane = 0; plane < 6; plane++) {
      const px = _planes[plane * 4]!;
      const py = _planes[plane * 4 + 1]!;
      const pz = _planes[plane * 4 + 2]!;
      const pd = _planes[plane * 4 + 3]!;
      let written = 0;
      for (let i = 0; i < vertices; i++) {
        const j = i + 1 === vertices ? 0 : i + 1;
        const xi = src[i * 3]!;
        const yi = src[i * 3 + 1]!;
        const zi = src[i * 3 + 2]!;
        const xj = src[j * 3]!;
        const yj = src[j * 3 + 1]!;
        const zj = src[j * 3 + 2]!;
        const di = px * xi + py * yi + pz * zi + pd;
        const dj = px * xj + py * yj + pz * zj + pd;
        if (di >= 0) {
          dst[written * 3] = xi;
          dst[written * 3 + 1] = yi;
          dst[written * 3 + 2] = zi;
          dstNormals[written * 3] = srcNormals[i * 3]!;
          dstNormals[written * 3 + 1] = srcNormals[i * 3 + 1]!;
          dstNormals[written * 3 + 2] = srcNormals[i * 3 + 2]!;
          written++;
        }
        if ((di >= 0) !== (dj >= 0)) {
          const k = di / (di - dj);
          dst[written * 3] = xi + (xj - xi) * k;
          dst[written * 3 + 1] = yi + (yj - yi) * k;
          dst[written * 3 + 2] = zi + (zj - zi) * k;
          dstNormals[written * 3] = srcNormals[i * 3]! + (srcNormals[j * 3]! - srcNormals[i * 3]!) * k;
          dstNormals[written * 3 + 1] = srcNormals[i * 3 + 1]! + (srcNormals[j * 3 + 1]! - srcNormals[i * 3 + 1]!) * k;
          dstNormals[written * 3 + 2] = srcNormals[i * 3 + 2]! + (srcNormals[j * 3 + 2]! - srcNormals[i * 3 + 2]!) * k;
          written++;
        }
        if (written > MAX_POLYGON_VERTICES) return;
      }
      const taken = src;
      src = dst;
      dst = taken;
      const takenNormals = srcNormals;
      srcNormals = dstNormals;
      dstNormals = takenNormals;
      vertices = written;
      if (vertices < 3) return;
    }

    for (let i = 2; i < vertices; i++) {
      this.emitVertex(src, srcNormals, 0, flip, halfW, halfH, rect, alpha, out);
      this.emitVertex(src, srcNormals, i - 1, flip, halfW, halfH, rect, alpha, out);
      this.emitVertex(src, srcNormals, i, flip, halfW, halfH, rect, alpha, out);
    }
  }

  /** Writes one clipped vertex: lifted off the panel it came from, at its atlas uv. */
  private emitVertex(
    src: Float64Array,
    normals: Float64Array,
    index: number,
    flip: number,
    halfW: number,
    halfH: number,
    rect: AtlasRect,
    alpha: number,
    out: DecalBuffer,
  ): void {
    const px = src[index * 3]!;
    const py = src[index * 3 + 1]!;
    const pz = src[index * 3 + 2]!;
    const dx = px - _centre.x;
    const dy = py - _centre.y;
    const dz = pz - _centre.z;
    const u = 0.5 + ((flip * (dx * _t.x + dy * _t.y + dz * _t.z)) / halfW) * 0.5;
    const v = 0.5 + ((dx * _b.x + dy * _b.y + dz * _b.z) / halfH) * 0.5;
    _point.set(px + _n.x * DECAL_LIFT_M, py + _n.y * DECAL_LIFT_M, pz + _n.z * DECAL_LIFT_M);
    _point.applyMatrix4(this.source!.toBody);
    out.push(
      _point.x,
      _point.y,
      _point.z,
      normals[index * 3]!,
      normals[index * 3 + 1]!,
      normals[index * 3 + 2]!,
      rect[0] + u * (rect[2] - rect[0]),
      rect[1] + v * (rect[3] - rect[1]),
      px,
      py,
      pz,
      alpha,
    );
  }
}

/** Places one clip half-space: inside means `dot(p, n) + d >= 0`. */
function writePlane(index: number, nx: number, ny: number, nz: number, d: number): void {
  _planes[index * 4] = nx;
  _planes[index * 4 + 1] = ny;
  _planes[index * 4 + 2] = nz;
  _planes[index * 4 + 3] = d;
}
