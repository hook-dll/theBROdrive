import * as THREE from 'three';

/**
 * Shared instanced batches for chunk props.
 *
 * A chunk used to own one `InstancedMesh` per prop kind, so a chunk with a dozen kinds
 * cost a dozen draw calls for a handful of instances each. Here the chunks of a band
 * share what draws them, in one of two forms.
 *
 * MULTI-DRAW BATCHES, for every opaque kind with one material and no `lod`: the scatter's
 * standing forms and the pole bodies. All such kinds of one material, shadow flags and
 * vertex layout in `BATCHED_BAND_CHUNKS` consecutive chunks are instances of ONE
 * `BatchedMesh`, whatever their geometry: one multi-draw per pass, and three culls each
 * instance on its own (`perObjectFrustumCulled`) in every pass, the shadow cascades
 * included, so no pass draws an instance it would have culled as a mesh of its own. With
 * pages of four chunks, each mirror pass (render/carmirrors.ts) drew ~22 pages at the
 * monument on seed `flick`, km 40; a page of a longer band would have drawn whole
 * wherever any of it was in view (the frame's triangles went 1.7 M to 2.1 M at 16 chunks).
 *  - Layout: three's batch takes one vertex layout. A kind's geometry is copied in with an
 *    index (made for a non-indexed one) and without `uv` when the material has no texture
 *    to read it with (`batchSource`), so the scatter's forms of `matProp` share one batch.
 *  - Program: a batch is its own program (`USE_BATCHING`), linked at boot through
 *    `batchedProgramAnchor`, which builds its batches exactly as `allocate` does. Every
 *    batch makes its colour texture with its first instance, white, so the key always
 *    carries `batchingColor`: without one, three r185 tests `object.colorTexture` (a
 *    name the batch does not have) and resolves the program again on every draw.
 *  - A released instance is deleted and its id reused; a broken prop leaves the draw
 *    (`hideInstance`). The batch is disposed with its last instance.
 *
 * PAGES, for the rest: the contact shadows (transparent, sorted back to front as one
 * object), the delineators (two materials over groups, which a multi-draw cannot split)
 * and the `lod` kinds. The chunks of one band (`BATCH_BAND_CHUNKS`) share pages per
 * geometry and material pair. A page is one `InstancedMesh` of `BATCH_PAGE_SLOTS` slots.
 * It is removed as soon as its last slot is released.
 *
 * Frame of reference: a page or batch is anchored at the floating origin when it was
 * created. A slot's matrix is written relative to that anchor, so a rebase only moves
 * the pages and batches (`rebase`), never their instances, and the ground fade's dissolve
 * pattern, hashed in that frame (render/groundfade.ts), does not jump at a rebase.
 *
 * Culling: a page's or batch's bounding sphere grows as slots are allocated, from the
 * geometry sphere transformed by each slot's matrix. It never shrinks while it lives,
 * so it stays conservative.
 *
 * Range (`BatchKind.lod`): a kind with a `lod` keeps its pages per world cell
 * (`LOD_CELL_M`) as well as per band, so a page is a patch of ground. `syncLod` then
 * sets each such page by how far the camera is from the nearest of its instances: the
 * kind's own geometry, its `far` geometry, or not drawn at all. Only the page's geometry
 * and visibility change, never its slots, so a `BatchSlot` held by a caller stays valid.
 */

/**
 * Side of the world cell an LOD kind's pages are kept per, metres. Smaller cells follow
 * the camera more closely and cost more draw calls; at 160 m the ground cover inside its
 * 290 m fade is about twenty cells per form.
 */
const LOD_CELL_M = 160;
/** A page switches back to the nearer state only this far inside the line it crossed. */
const LOD_HYSTERESIS_M = 8;

/** Consecutive chunks that share one set of pages. */
export const BATCH_BAND_CHUNKS = 4;
/** Slots in one page. Each slot is a 4x4 matrix (64 bytes), so a page is 16 KB. */
export const BATCH_PAGE_SLOTS = 256;
/**
 * Consecutive chunks that share one multi-draw batch: 3.2 km, so the ~13 chunks in range
 * are one or two batches per material. Culling is per instance, so the length costs no
 * triangles; it is bounded by f32 precision, the anchor being where the origin stood.
 */
const BATCHED_BAND_CHUNKS = 16;
/** Instances a batch is made with; it doubles when full. */
const BATCHED_FIRST_INSTANCES = 512;
/** Vertices a batch is made with, at least; it doubles when full. */
const BATCHED_FIRST_VERTICES = 16384;

/** What a batch draws. Kinds with the same geometry and material share pages. */
export interface BatchKind {
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material | THREE.Material[];
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
  readonly renderOrder?: number;
  readonly lod?: BatchLod;
}

/**
 * Range rules for a kind. Distances run across the ground (x, z) from the camera to the
 * page's nearest instance, the plane the ground cover's own fade is measured in.
 */
export interface BatchLod {
  /**
   * Drawn instead of the kind's geometry past `distance`. It must carry the same
   * attributes, so the page keeps its shader program.
   */
  readonly far?: { readonly geometry: THREE.BufferGeometry; readonly distance: number };
  /** Past this every instance has faded to nothing in the vertex shader: the page is not drawn. */
  readonly hideBeyond: number;
}

/** The chunk a slot is allocated for. `ChunkContext` satisfies this. */
export interface BatchChunk {
  readonly chunkIndex: number;
  readonly originX: number;
  readonly originZ: number;
}

/** One slot in a page or batch. Callers keep it to blank the instance later. */
export interface BatchSlot {
  readonly mesh: THREE.InstancedMesh | THREE.BatchedMesh;
  readonly instance: number;
}

/** The floating origin. `WorldOrigin` satisfies this. */
export interface BatchOrigin {
  readonly x: number;
  readonly z: number;
}

interface Family {
  readonly key: string;
  readonly kind: BatchKind;
  readonly pages: Page[];
}

interface Page {
  readonly mesh: THREE.InstancedMesh;
  readonly family: Family;
  readonly anchorX: number;
  readonly anchorZ: number;
  readonly sphere: THREE.Sphere;
  /** Released slots, reused before a fresh one. */
  readonly free: number[];
  /** Slots ever handed out. The page draws `next` instances. */
  next: number;
  live: number;
  /** For an LOD kind: what `syncLod` last set. */
  range: PageRange;
}

const enum PageRange {
  Near,
  Far,
  Hidden,
}

/** A multi-draw batch: every batchable kind of one material, flags and layout in a band. */
interface Batch {
  readonly key: string;
  readonly mesh: THREE.BatchedMesh;
  readonly anchorX: number;
  readonly anchorZ: number;
  readonly sphere: THREE.Sphere;
  /** Each kind geometry's id in `mesh`. */
  readonly geometryIds: Map<THREE.BufferGeometry, number>;
  live: number;
}

/** What a kind's geometry is copied into a batch as, and the layout that picks the batch. */
interface BatchSource {
  readonly geometry: THREE.BufferGeometry;
  readonly layout: string;
}

const ZERO_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);
const WHITE = new THREE.Color(1, 1, 1);
const _sphere = new THREE.Sphere();
const _matrix = new THREE.Matrix4();

const identities = new WeakMap<object, number>();
let nextIdentity = 1;
/** A stable number per geometry or material object, for keying families. */
function identityOf(object: object): number {
  let id = identities.get(object);
  if (id === undefined) {
    id = nextIdentity++;
    identities.set(object, id);
  }
  return id;
}

const texturedMaterials = new WeakMap<THREE.Material, boolean>();
const batchSources = new WeakMap<THREE.Material, WeakMap<THREE.BufferGeometry, BatchSource>>();

/**
 * `geometry` as a batch of `material` takes it: indexed, and without `uv` when the
 * material holds no texture (no map, so its program never reads one). Shares the
 * geometry's attributes; built once per pair.
 */
function batchSource(geometry: THREE.BufferGeometry, material: THREE.Material): BatchSource {
  let sources = batchSources.get(material);
  if (!sources) {
    sources = new WeakMap();
    batchSources.set(material, sources);
  }
  let source = sources.get(geometry);
  if (source) return source;
  let textured = texturedMaterials.get(material);
  if (textured === undefined) {
    textured = Object.values(material).some((value) => (value as THREE.Texture | null)?.isTexture === true);
    texturedMaterials.set(material, textured);
  }
  const copy = new THREE.BufferGeometry();
  let layout = '';
  for (const name of Object.keys(geometry.attributes).sort()) {
    if (name === 'uv' && !textured) continue;
    const attribute = geometry.getAttribute(name) as THREE.BufferAttribute;
    copy.setAttribute(name, attribute);
    layout += `|${name}:${attribute.itemSize}${attribute.normalized ? 'n' : ''}:${attribute.array.constructor.name}`;
  }
  const count = geometry.getAttribute('position').count;
  copy.setIndex(geometry.index ?? Array.from({ length: count }, (_, i) => i));
  if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
  copy.boundingSphere = geometry.boundingSphere;
  source = { geometry: copy, layout };
  sources.set(geometry, source);
  return source;
}

/** Whether `kind` draws as an instance of a multi-draw batch rather than in a page. */
function batchable(kind: BatchKind): boolean {
  return !Array.isArray(kind.material) && !kind.material.transparent && !kind.lod;
}

/**
 * Takes a held instance out of the picture: a broken prop. A batch's leaves the draw; a
 * page's slot gets a zero matrix. `release` still gives it back with its chunk.
 */
export function hideInstance(mesh: THREE.InstancedMesh | THREE.BatchedMesh, instance: number): void {
  if (mesh instanceof THREE.BatchedMesh) {
    mesh.setVisibleAt(instance, false);
    return;
  }
  mesh.setMatrixAt(instance, ZERO_MATRIX);
  mesh.instanceMatrix.needsUpdate = true;
}

export class InstanceBatches {
  /** Holds every page and batch. Added to the scene once, by the streamer. */
  readonly root = new THREE.Group();
  private readonly families = new Map<string, Family>();
  private readonly pageOf = new Map<THREE.InstancedMesh, Page>();
  /** The pages of LOD kinds, the only ones `syncLod` walks. */
  private readonly lodPages: Page[] = [];
  private readonly batches = new Map<string, Batch>();
  private readonly batchOf = new Map<THREE.BatchedMesh, Batch>();

  constructor(private readonly origin: BatchOrigin) {}

  /**
   * Takes a slot for one instance of `kind` in `chunk`. `local` is the matrix in the
   * chunk's own frame, the same matrix the chunk would have set on its own mesh.
   */
  allocate(chunk: BatchChunk, kind: BatchKind, local: THREE.Matrix4): BatchSlot {
    if (batchable(kind)) return this.allocateBatched(chunk, kind, local);
    const band = Math.floor(chunk.chunkIndex / BATCH_BAND_CHUNKS);
    let key = `${identityOf(kind.geometry)}:${identityOf(kind.material)}:${band}`;
    if (kind.lod) {
      const cellX = Math.floor((local.elements[12] + chunk.originX) / LOD_CELL_M);
      const cellZ = Math.floor((local.elements[14] + chunk.originZ) / LOD_CELL_M);
      key += `:${cellX}:${cellZ}`;
    }
    let family = this.families.get(key);
    if (!family) {
      family = { key, kind, pages: [] };
      this.families.set(key, family);
    }
    const page =
      family.pages.find((p) => p.free.length > 0 || p.next < BATCH_PAGE_SLOTS) ?? this.openPage(family);
    const instance = page.free.pop() ?? page.next++;
    page.live++;
    page.mesh.count = page.next;

    // Chunk frame to page frame: the chunk's origin minus the page's anchor.
    _matrix.copy(local);
    _matrix.elements[12] += chunk.originX - page.anchorX;
    _matrix.elements[14] += chunk.originZ - page.anchorZ;
    page.mesh.setMatrixAt(instance, _matrix);
    page.mesh.instanceMatrix.needsUpdate = true;

    _sphere.copy(family.kind.geometry.boundingSphere!).applyMatrix4(_matrix);
    page.sphere.union(_sphere);

    return { mesh: page.mesh, instance };
  }

  /**
   * Gives a slot back. It is blanked, so it draws nothing, and its index is reused.
   * Callers forget any breakable or cover handle on the slot first.
   */
  release(slot: BatchSlot): void {
    if (slot.mesh instanceof THREE.BatchedMesh) {
      const batch = this.batchOf.get(slot.mesh);
      if (!batch) return;
      batch.mesh.deleteInstance(slot.instance);
      batch.live--;
      if (batch.live === 0) this.closeBatch(batch);
      return;
    }
    const page = this.pageOf.get(slot.mesh);
    if (!page) return;
    page.mesh.setMatrixAt(slot.instance, ZERO_MATRIX);
    page.mesh.instanceMatrix.needsUpdate = true;
    page.free.push(slot.instance);
    page.live--;
    if (page.live === 0) this.closePage(page);
  }

  /** Moves every page and batch after the floating origin moved. Instances are not touched. */
  rebase(): void {
    for (const family of this.families.values()) {
      for (const page of family.pages) {
        page.mesh.position.set(page.anchorX - this.origin.x, 0, page.anchorZ - this.origin.z);
        page.mesh.updateMatrix();
      }
    }
    for (const batch of this.batches.values()) {
      batch.mesh.position.set(batch.anchorX - this.origin.x, 0, batch.anchorZ - this.origin.z);
      batch.mesh.updateMatrix();
    }
  }

  /**
   * Sets every LOD page's geometry and visibility for a camera at (`x`, `z`), in the
   * render frame. Once per rendered frame, after the camera moved; it walks only the
   * LOD pages (a few dozen) and touches a page only when its range changes.
   */
  syncLod(x: number, z: number): void {
    for (const page of this.lodPages) {
      const lod = page.family.kind.lod!;
      const hideBeyond = lod.hideBeyond;
      const sphere = page.sphere;
      // Ground distance to the nearest point the page's instances can occupy.
      const d = sphere.isEmpty()
        ? Infinity
        : Math.hypot(sphere.center.x + page.mesh.position.x - x, sphere.center.z + page.mesh.position.z - z) - sphere.radius;
      const was = page.range;
      let range: PageRange;
      if (d > hideBeyond - (was === PageRange.Hidden ? LOD_HYSTERESIS_M : 0)) range = PageRange.Hidden;
      else if (lod.far && d > lod.far.distance - (was === PageRange.Near ? 0 : LOD_HYSTERESIS_M)) range = PageRange.Far;
      else range = PageRange.Near;
      if (range === was) continue;
      page.range = range;
      page.mesh.visible = range !== PageRange.Hidden;
      if (range !== PageRange.Hidden) page.mesh.geometry = range === PageRange.Far ? lod.far!.geometry : page.family.kind.geometry;
    }
  }

  /** Removes and frees every page and batch. */
  dispose(): void {
    for (const family of this.families.values()) {
      for (const page of [...family.pages]) this.closePage(page);
    }
    this.families.clear();
    for (const batch of [...this.batches.values()]) this.closeBatch(batch);
  }

  private allocateBatched(chunk: BatchChunk, kind: BatchKind, local: THREE.Matrix4): BatchSlot {
    const material = kind.material as THREE.Material;
    const source = batchSource(kind.geometry, material);
    const band = Math.floor(chunk.chunkIndex / BATCHED_BAND_CHUNKS);
    const key = `${identityOf(material)}:${+!!kind.castShadow}${+!!kind.receiveShadow}:${kind.renderOrder ?? 0}:${band}${source.layout}`;
    const batch = this.batches.get(key) ?? this.openBatch(key, kind, source.geometry);
    const mesh = batch.mesh;

    let geometryId = batch.geometryIds.get(kind.geometry);
    if (geometryId === undefined) {
      const vertices = source.geometry.getAttribute('position').count;
      const indices = source.geometry.index!.count;
      if (vertices > mesh.unusedVertexCount || indices > mesh.unusedIndexCount) {
        let vertexCapacity = mesh.geometry.getAttribute('position').count;
        let indexCapacity = mesh.geometry.index!.count;
        const usedVertices = vertexCapacity - mesh.unusedVertexCount;
        const usedIndices = indexCapacity - mesh.unusedIndexCount;
        while (usedVertices + vertices > vertexCapacity) vertexCapacity *= 2;
        while (usedIndices + indices > indexCapacity) indexCapacity *= 2;
        mesh.setGeometrySize(vertexCapacity, indexCapacity);
      }
      geometryId = mesh.addGeometry(source.geometry);
      batch.geometryIds.set(kind.geometry, geometryId);
    }
    if (mesh.instanceCount >= mesh.maxInstanceCount) mesh.setInstanceCount(mesh.maxInstanceCount * 2);
    const instance = mesh.addInstance(geometryId);
    // The colour texture, white, with the first instance (see the header); ids reused
    // later keep that white.
    if (batch.live === 0) mesh.setColorAt(instance, WHITE);
    batch.live++;

    _matrix.copy(local);
    _matrix.elements[12] += chunk.originX - batch.anchorX;
    _matrix.elements[14] += chunk.originZ - batch.anchorZ;
    mesh.setMatrixAt(instance, _matrix);

    _sphere.copy(source.geometry.boundingSphere!).applyMatrix4(_matrix);
    batch.sphere.union(_sphere);

    return { mesh, instance };
  }

  private openBatch(key: string, kind: BatchKind, first: THREE.BufferGeometry): Batch {
    const vertexCapacity = Math.max(BATCHED_FIRST_VERTICES, first.getAttribute('position').count * 2);
    const mesh = new THREE.BatchedMesh(BATCHED_FIRST_INSTANCES, vertexCapacity, vertexCapacity * 2, kind.material as THREE.Material);
    mesh.castShadow = kind.castShadow ?? false;
    mesh.receiveShadow = kind.receiveShadow ?? false;
    mesh.renderOrder = kind.renderOrder ?? 0;
    // Opaque: drawn in instance order, as a page draws its slots.
    mesh.sortObjects = false;
    const sphere = new THREE.Sphere();
    sphere.makeEmpty();
    mesh.boundingSphere = sphere;
    const batch: Batch = {
      key,
      mesh,
      anchorX: this.origin.x,
      anchorZ: this.origin.z,
      sphere,
      geometryIds: new Map(),
      live: 0,
    };
    mesh.position.set(0, 0, 0);
    mesh.updateMatrix();
    this.batches.set(key, batch);
    this.batchOf.set(mesh, batch);
    this.root.add(mesh);
    return batch;
  }

  private closeBatch(batch: Batch): void {
    this.batches.delete(batch.key);
    this.batchOf.delete(batch.mesh);
    this.root.remove(batch.mesh);
    batch.mesh.dispose();
  }

  private openPage(family: Family): Page {
    const kind = family.kind;
    if (kind.geometry.boundingSphere === null) kind.geometry.computeBoundingSphere();
    const mesh = new THREE.InstancedMesh(kind.geometry, kind.material, BATCH_PAGE_SLOTS);
    mesh.count = 0;
    mesh.castShadow = kind.castShadow ?? false;
    mesh.receiveShadow = kind.receiveShadow ?? false;
    mesh.renderOrder = kind.renderOrder ?? 0;
    // Set by hand so three's culling never reads the zero matrices of unused slots.
    const sphere = new THREE.Sphere();
    sphere.makeEmpty();
    mesh.boundingSphere = sphere;
    // The anchor is the origin right now, so the page sits at zero until `rebase`.
    const page: Page = {
      mesh,
      family,
      anchorX: this.origin.x,
      anchorZ: this.origin.z,
      sphere,
      free: [],
      next: 0,
      live: 0,
      range: PageRange.Near,
    };
    mesh.position.set(0, 0, 0);
    mesh.updateMatrix();
    family.pages.push(page);
    this.pageOf.set(mesh, page);
    if (kind.lod) this.lodPages.push(page);
    this.root.add(mesh);
    return page;
  }

  private closePage(page: Page): void {
    const family = page.family;
    const at = family.pages.indexOf(page);
    if (at >= 0) family.pages.splice(at, 1);
    if (family.pages.length === 0) this.families.delete(family.key);
    this.pageOf.delete(page.mesh);
    if (family.kind.lod) this.lodPages.splice(this.lodPages.indexOf(page), 1);
    this.root.remove(page.mesh);
    page.mesh.dispose();
  }
}

/**
 * Hidden batches holding the multi-draw programs of `kinds`, for the scene at boot (see
 * .omp/rules/shader-variants.md): one instance of the first kind of each batch, built by
 * `allocate` itself, so the anchor has the material, shadow flags, layout and colour
 * texture of the batches the streamer makes. Its batches are never released.
 */
export function batchedProgramAnchor(name: string, kinds: readonly BatchKind[]): THREE.Object3D {
  const batches = new InstanceBatches({ x: 0, z: 0 });
  const chunk: BatchChunk = { chunkIndex: 0, originX: 0, originZ: 0 };
  const identity = new THREE.Matrix4();
  for (const kind of kinds) {
    if (batchable(kind)) batches.allocate(chunk, kind, identity);
  }
  batches.root.name = name;
  batches.root.visible = false;
  return batches.root;
}
