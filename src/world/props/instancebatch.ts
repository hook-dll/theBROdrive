import * as THREE from 'three';

/**
 * Shared instanced batches for chunk props.
 *
 * A chunk used to own one `InstancedMesh` per prop kind, so a chunk with a dozen kinds
 * cost a dozen draw calls for a handful of instances each. Here the chunks of one band
 * (`BATCH_BAND_CHUNKS` consecutive chunks) share pages per geometry and material pair.
 * A page is one `InstancedMesh` of `BATCH_PAGE_SLOTS` slots. It is removed as soon as
 * its last slot is released.
 *
 * Frame of reference: a page is anchored at the floating origin when it was created.
 * A slot's matrix is written relative to that anchor, so a rebase only moves the pages
 * (`rebase`), never their instances.
 *
 * Culling: a page's bounding sphere grows as slots are allocated, from the geometry
 * sphere transformed by each slot's matrix. It never shrinks while the page lives, so
 * it stays conservative.
 */

/** Consecutive chunks that share one set of pages. */
export const BATCH_BAND_CHUNKS = 4;
/** Slots in one page. Each slot is a 4x4 matrix (64 bytes), so a page is 16 KB. */
export const BATCH_PAGE_SLOTS = 256;

/** What a batch draws. Kinds with the same geometry and material share pages. */
export interface BatchKind {
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material | THREE.Material[];
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
  readonly renderOrder?: number;
}

/** The chunk a slot is allocated for. `ChunkContext` satisfies this. */
export interface BatchChunk {
  readonly chunkIndex: number;
  readonly originX: number;
  readonly originZ: number;
}

/** One slot in a page. Callers keep it to blank the instance later. */
export interface BatchSlot {
  readonly mesh: THREE.InstancedMesh;
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

const ZERO_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);
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

export class InstanceBatches {
  /** Holds every page. Added to the scene once, by the streamer. */
  readonly root = new THREE.Group();
  private readonly families = new Map<string, Family>();
  private readonly pageOf = new Map<THREE.InstancedMesh, Page>();

  constructor(private readonly origin: BatchOrigin) {}

  /**
   * Takes a slot for one instance of `kind` in `chunk`. `local` is the matrix in the
   * chunk's own frame, the same matrix the chunk would have set on its own mesh.
   */
  allocate(chunk: BatchChunk, kind: BatchKind, local: THREE.Matrix4): BatchSlot {
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
   * Gives a slot back. It is blanked, so it draws nothing, and its index is reused.
   * Callers forget any breakable or cover handle on the slot first.
   */
  release(slot: BatchSlot): void {
    const page = this.pageOf.get(slot.mesh);
    if (!page) return;
    page.mesh.setMatrixAt(slot.instance, ZERO_MATRIX);
    page.mesh.instanceMatrix.needsUpdate = true;
    page.free.push(slot.instance);
    page.live--;
    if (page.live === 0) this.closePage(page);
  }

  /** Moves every page after the floating origin moved. Instances are not touched. */
  rebase(): void {
    for (const family of this.families.values()) {
      for (const page of family.pages) {
        page.mesh.position.set(page.anchorX - this.origin.x, 0, page.anchorZ - this.origin.z);
        page.mesh.updateMatrix();
      }
    }
  }

  /** Removes and frees every page. */
  dispose(): void {
    for (const family of this.families.values()) {
      for (const page of [...family.pages]) this.closePage(page);
    }
    this.families.clear();
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
