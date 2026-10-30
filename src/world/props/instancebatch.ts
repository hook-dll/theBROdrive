import * as THREE from 'three';

/**
 * Shared instanced batches for chunk props.
 *
 * A chunk used to own one `InstancedMesh` per prop kind, so a chunk with a dozen kinds
 * cost a dozen draw calls for a handful of instances each. Here the chunks of a band
 * share what draws them, in one of two forms.
 *
 * MULTI-DRAW BATCHES, for every opaque kind with one material: the scatter's standing
 * forms, the ground cover and the pole bodies. All such kinds of one material, shadow flags and
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
 *    carries `batchingColor` and every batch, the anchor's included, is one program
 *    (three r185 also re-resolved a batch without one on every draw; fixed in r186).
 *  - A released instance is deleted and its id reused; a broken prop leaves the draw
 *    (`hideInstance`). The batch is disposed with its last instance.
 *
 * PAGES, for the rest: the delineators (two materials over groups, which a multi-draw
 * cannot split) and transparent kinds that must sort. The chunks of one band
 * (`BATCH_BAND_CHUNKS`) share pages per geometry and material pair. A page is one
 * `InstancedMesh` of `BATCH_PAGE_SLOTS` slots. It is removed as soon as its last slot is
 * released.
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
 * Range (`BatchKind.lod`): the kinds with a `lod` (the ground cover) have batches of
 * their own, and each pass's camera decides per instance (`lodSort`) from its ground
 * distance to the instance's origin, the point the cover's vertex fade measures from:
 * past `hideBeyond` it is not drawn, past `far.distance` it draws its `far` geometry.
 * They were pages per 160 m cell, switched as a whole by the nearest instance to the
 * main camera: ~80 visible pages, ~28 draws in the frame and ~13 in each mirror.
 */

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
  /**
   * For a kind whose every instance has a geometry of its own (a desert tile's ground):
   * the most vertices and indices one may have. Its geometry slot in the batch is that
   * size, and when the instance is released the slot is kept and rewritten by the next
   * such instance (`setGeometryAt`), so streaming tiles neither grows nor fragments the
   * batch's buffers.
   */
  readonly reserve?: { readonly vertices: number; readonly indices: number };
  /**
   * A transparent kind whose instances may blend in any order among themselves (the
   * contact shadows: one dark colour, so two overlapping discs give the same result in
   * either order). Such a kind can be a multi-draw batch, still placed among the other
   * transparent objects by its `renderOrder`.
   */
  readonly orderFree?: boolean;
}

/**
 * Range rules for a kind. Distances run across the ground (x, z) from the camera to the
 * instance's origin, the plane the ground cover's own fade is measured in.
 */
export interface BatchLod {
  /**
   * Drawn instead of the kind's geometry past `distance`. It must carry the same
   * attributes, so the batch keeps its shader program.
   */
  readonly far?: { readonly geometry: THREE.BufferGeometry; readonly distance: number };
  /** Past this the instance has faded to nothing in the vertex shader: it is not drawn. */
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
}

/** A geometry's range rule in an LOD batch, its far form as a draw range of the batch. */
interface LodRule {
  readonly hideBeyond: number;
  readonly farDistance: number;
  readonly farStart: number;
  readonly farCount: number;
}

/** A multi-draw batch: every batchable kind of one material, flags and layout in a band. */
interface Batch {
  readonly key: string;
  readonly mesh: THREE.BatchedMesh;
  readonly anchorX: number;
  readonly anchorZ: number;
  readonly sphere: THREE.Sphere;
  /** Each shared kind geometry's id in `mesh`. */
  readonly geometryIds: Map<THREE.BufferGeometry, number>;
  /** Geometry slots of `reserve` kinds: those in use, and those free to be rewritten. */
  readonly reserved: Set<number>;
  readonly freeGeometry: number[];
  live: number;
  /** For an LOD batch: each geometry id's rule, and each instance's ground position. */
  readonly lodRules: (LodRule | undefined)[] | null;
  groundX: Float32Array;
  groundZ: Float32Array;
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
  return !Array.isArray(kind.material) && (!kind.material.transparent || kind.orderFree === true);
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
    const key = `${identityOf(kind.geometry)}:${identityOf(kind.material)}:${band}`;
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
   * Rewrites a held slot's matrix: `local` in `chunk`'s frame, as `allocate` took it. For
   * an owner that moves its instances after placing them (the desert tiles' fade). The
   * bounds are not grown: a caller may only shrink or keep an instance inside them.
   */
  place(slot: BatchSlot, chunk: BatchChunk, local: THREE.Matrix4): void {
    const owner = slot.mesh instanceof THREE.BatchedMesh ? this.batchOf.get(slot.mesh) : this.pageOf.get(slot.mesh);
    if (!owner) return;
    _matrix.copy(local);
    _matrix.elements[12] += chunk.originX - owner.anchorX;
    _matrix.elements[14] += chunk.originZ - owner.anchorZ;
    slot.mesh.setMatrixAt(slot.instance, _matrix);
    if (slot.mesh instanceof THREE.InstancedMesh) slot.mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Rewrites a `reserve` slot's geometry in place (a desert tile's ground switching
   * between its fine and far indices). The geometry must have the layout the slot was
   * made with and fit its reserved size.
   */
  setGeometry(slot: BatchSlot, geometry: THREE.BufferGeometry): void {
    if (!(slot.mesh instanceof THREE.BatchedMesh)) return;
    const batch = this.batchOf.get(slot.mesh);
    if (!batch) return;
    const id = batch.mesh.getGeometryIdAt(slot.instance);
    if (!batch.reserved.has(id)) throw new Error('InstanceBatches.setGeometry: not a reserved slot');
    batch.mesh.setGeometryAt(id, batchSource(geometry, batch.mesh.material as THREE.Material).geometry);
  }

  /**
   * Gives a slot back. It is blanked, so it draws nothing, and its index is reused.
   * Callers forget any breakable or cover handle on the slot first.
   */
  release(slot: BatchSlot): void {
    if (slot.mesh instanceof THREE.BatchedMesh) {
      const batch = this.batchOf.get(slot.mesh);
      if (!batch) return;
      const geometryId = batch.mesh.getGeometryIdAt(slot.instance);
      batch.mesh.deleteInstance(slot.instance);
      if (batch.reserved.has(geometryId)) batch.freeGeometry.push(geometryId);
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
    const key = `${identityOf(material)}:${+!!kind.castShadow}${+!!kind.receiveShadow}:${kind.renderOrder ?? 0}:${kind.lod ? 'lod' : ''}:${band}${source.layout}`;
    const batch = this.batches.get(key) ?? this.openBatch(key, kind, source.geometry);
    const mesh = batch.mesh;

    let geometryId = kind.reserve ? batch.freeGeometry.pop() : batch.geometryIds.get(kind.geometry);
    if (geometryId !== undefined && kind.reserve) {
      mesh.setGeometryAt(geometryId, source.geometry);
    } else if (geometryId === undefined) {
      if (kind.reserve) {
        geometryId = addBatchGeometry(mesh, source.geometry, kind.reserve.vertices, kind.reserve.indices);
        batch.reserved.add(geometryId);
      } else {
        geometryId = addBatchGeometry(mesh, source.geometry);
        batch.geometryIds.set(kind.geometry, geometryId);
        if (kind.lod && batch.lodRules) {
          const far = kind.lod.far;
          let farStart = 0;
          let farCount = 0;
          if (far) {
            const range = mesh.getGeometryRangeAt(addBatchGeometry(mesh, batchSource(far.geometry, material).geometry))!;
            farStart = range.start;
            farCount = range.count;
          }
          batch.lodRules[geometryId] = {
            hideBeyond: kind.lod.hideBeyond,
            farDistance: far ? far.distance : Infinity,
            farStart,
            farCount,
          };
        }
      }
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
    if (batch.lodRules) {
      if (instance >= batch.groundX.length) {
        const size = mesh.maxInstanceCount;
        const x = new Float32Array(size);
        const z = new Float32Array(size);
        x.set(batch.groundX);
        z.set(batch.groundZ);
        batch.groundX = x;
        batch.groundZ = z;
      }
      batch.groundX[instance] = _matrix.elements[12];
      batch.groundZ[instance] = _matrix.elements[14];
    }

    _sphere.copy(source.geometry.boundingSphere!).applyMatrix4(_matrix);
    batch.sphere.union(_sphere);

    return { mesh, instance };
  }

  private openBatch(key: string, kind: BatchKind, first: THREE.BufferGeometry): Batch {
    // Room for two of the first geometry (or of a reserved slot): a batch's buffers only
    // exist after its first `addGeometry`, so the first must fit without growing.
    const vertexCapacity = Math.max(BATCHED_FIRST_VERTICES, (kind.reserve?.vertices ?? first.getAttribute('position').count) * 2);
    const indexCapacity = Math.max(vertexCapacity * 2, (kind.reserve?.indices ?? first.index?.count ?? 0) * 2);
    const mesh = new THREE.BatchedMesh(BATCHED_FIRST_INSTANCES, vertexCapacity, indexCapacity, kind.material as THREE.Material);
    mesh.castShadow = kind.castShadow ?? false;
    mesh.receiveShadow = kind.receiveShadow ?? false;
    mesh.renderOrder = kind.renderOrder ?? 0;
    // Opaque: drawn in instance order, as a page draws its slots. An LOD batch sorts, so
    // its `customSort` sees each pass's list and takes out what is out of range.
    mesh.sortObjects = kind.lod !== undefined;
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
      reserved: new Set(),
      freeGeometry: [],
      live: 0,
      lodRules: kind.lod ? [] : null,
      groundX: new Float32Array(kind.lod ? BATCHED_FIRST_INSTANCES : 0),
      groundZ: new Float32Array(kind.lod ? BATCHED_FIRST_INSTANCES : 0),
    };
    // @types/three leaves out the list items' instance `index`, which three does set.
    if (kind.lod) mesh.customSort = (list, camera) => lodSort(batch, list as DrawItem[], camera);
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
    };
    mesh.position.set(0, 0, 0);
    mesh.updateMatrix();
    family.pages.push(page);
    this.pageOf.set(mesh, page);
    this.root.add(mesh);
    return page;
  }

  private closePage(page: Page): void {
    const family = page.family;
    const at = family.pages.indexOf(page);
    if (at >= 0) family.pages.splice(at, 1);
    if (family.pages.length === 0) this.families.delete(family.key);
    this.pageOf.delete(page.mesh);
    this.root.remove(page.mesh);
    page.mesh.dispose();
  }
}

/**
 * Adds `geometry` to `mesh` (with `vertices` and `indices` reserved, when given), growing
 * the batch's buffers by doubling first if it does not fit.
 */
function addBatchGeometry(mesh: THREE.BatchedMesh, geometry: THREE.BufferGeometry, vertices?: number, indices?: number): number {
  const needVertices = vertices ?? geometry.getAttribute('position').count;
  const needIndices = indices ?? geometry.index!.count;
  if (needVertices > mesh.unusedVertexCount || needIndices > mesh.unusedIndexCount) {
    let vertexCapacity = mesh.geometry.getAttribute('position').count;
    let indexCapacity = mesh.geometry.index!.count;
    const usedVertices = vertexCapacity - mesh.unusedVertexCount;
    const usedIndices = indexCapacity - mesh.unusedIndexCount;
    while (usedVertices + needVertices > vertexCapacity) vertexCapacity *= 2;
    while (usedIndices + needIndices > indexCapacity) indexCapacity *= 2;
    mesh.setGeometrySize(vertexCapacity, indexCapacity);
  }
  return mesh.addGeometry(geometry, vertices, indices);
}

/** One entry of three's per-pass multi-draw list (BatchedMesh `customSort`). */
interface DrawItem {
  start: number;
  count: number;
  z: number;
  index: number;
}

const _eye = new THREE.Vector3();

/**
 * An LOD batch's draw list for one pass (the frame, a mirror, a shadow cascade): every
 * instance past its `hideBeyond` from that pass's camera, across the ground, is taken
 * out, one past its far distance draws its far geometry's range, and the rest is sorted
 * near to far as three sorts an opaque batch.
 */
function lodSort(batch: Batch, list: DrawItem[], camera: THREE.Camera): void {
  const rules = batch.lodRules!;
  const mesh = batch.mesh;
  _eye.setFromMatrixPosition(camera.matrixWorld);
  const eyeX = _eye.x - mesh.position.x;
  const eyeZ = _eye.z - mesh.position.z;
  const groundX = batch.groundX;
  const groundZ = batch.groundZ;
  let kept = 0;
  for (let i = 0; i < list.length; i++) {
    const item = list[i]!;
    const rule = rules[mesh.getGeometryIdAt(item.index)];
    if (rule) {
      const d = Math.hypot(groundX[item.index]! - eyeX, groundZ[item.index]! - eyeZ);
      if (d > rule.hideBeyond) continue;
      if (d > rule.farDistance) {
        item.start = rule.farStart;
        item.count = rule.farCount;
      }
    }
    list[kept++] = item;
  }
  list.length = kept;
  list.sort((a, b) => a.z - b.z);
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
