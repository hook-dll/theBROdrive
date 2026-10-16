import * as THREE from 'three';
import { CLEAN_CULL_GONE_PX } from '../../render/cleanstyle';

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
  /**
   * The kind's largest instance, metres, as its material's Clean cull measures it
   * (render/cleanstyle.ts `applyCleanCull`: the form size times the largest scale). In
   * the Clean style a page is not drawn once even that would be under
   * `CLEAN_CULL_GONE_PX`; the shader has already shrunk every instance in it to nothing.
   */
  readonly cleanSize?: number;
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
  /** For an LOD kind: what `syncLod` last set. */
  range: PageRange;
}

const enum PageRange {
  Near,
  Far,
  Hidden,
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
  /** The pages of LOD kinds, the only ones `syncLod` walks. */
  private readonly lodPages: Page[] = [];

  constructor(private readonly origin: BatchOrigin) {}

  /**
   * Takes a slot for one instance of `kind` in `chunk`. `local` is the matrix in the
   * chunk's own frame, the same matrix the chunk would have set on its own mesh.
   */
  allocate(chunk: BatchChunk, kind: BatchKind, local: THREE.Matrix4): BatchSlot {
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

  /**
   * Sets every LOD page's geometry and visibility for a camera at (`x`, `z`), in the
   * render frame. Once per rendered frame, after the camera moved; it walks only the
   * LOD pages (a few dozen) and touches a page only when its range changes.
   * `cleanPixelsPerMetre` (render/cleanstyle.ts) is 0 outside the Clean style. The
   * ground distance it is divided by is never more than the eye distance the shader
   * divides by, so a page hidden here holds nothing the shader would still draw.
   */
  syncLod(x: number, z: number, cleanPixelsPerMetre: number): void {
    for (const page of this.lodPages) {
      const lod = page.family.kind.lod!;
      const hideBeyond = cleanPixelsPerMetre > 0 && lod.cleanSize !== undefined
        ? Math.min(lod.hideBeyond, (lod.cleanSize * cleanPixelsPerMetre) / CLEAN_CULL_GONE_PX)
        : lod.hideBeyond;
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
