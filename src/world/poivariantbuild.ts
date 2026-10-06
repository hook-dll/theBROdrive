/**
 * A gallery POI variant, made ready to stand in the world.
 *
 * The variants in `poi-variants.ts` are a VISUAL catalogue. They are authored about a
 * local origin with the ground at Y=0, they carry no physics and no game entities. None
 * of that is a defect in the catalogue — it is what a catalogue is — but it means the two
 * things the world needs from a building have to be produced here, once, for every
 * variant:
 *
 *   ONE MERGED GROUP. The variants are built from thousands of small boxes (measured:
 *   3,954 meshes across the 26), which is fine for a gallery you look at one building at
 *   a time and ruinous for a streamed world. `mergePoiStatics` collapses them by material
 *   to 6-49 meshes per variant, and this module always merges before anything else
 *   touches the tree.
 *
 *   ONE COLLIDER GEOMETRY. A building must stop a car without sealing its own doors. The
 *   shells are built with real openings — `wallWithOpenings` leaves a hole and trims it —
 *   so a trimesh of the merged walls, floors and bulky props is both solid and walkable,
 *   and needs no hand-authored proxy. Roofs are excluded: nobody drives on them, and they
 *   are the one part that would enclose the interior from above.
 *
 * AND ALL OF IT IS CACHED, because building is not cheap. Measured on a 5950X, one
 * variant costs 3.74 ms to build and 11.4 ms at worst — against a streaming budget of
 * 3 ms per frame, one job per frame. Rebuilding per placement would therefore hitch on
 * every POI, and this world has one every 7.7 km. The result is position-independent:
 * `mergePoiStatics` bakes each mesh's transform into its geometry at the local origin, so
 * the merged geometry and the collider geometry are the same wherever the building ends
 * up. So they are built once per session and shared, and placing a
 * building afterwards is only wrapping them in fresh Object3Ds. That also means the
 * geometry is never leaked: it belongs to the cache, not to a streamed chunk.
 *
 * Determinism: every variant builder is pure — no `Math.random` anywhere in the catalogue
 * — so the same index always produces the same building. Which index goes where is the
 * caller's decision, and it must come from the world seed.
 */

import * as THREE from 'three';
import { createPoiVariant, mergePoiStatics, POI_VARIANTS } from './poi-variants';

/**
 * What the world needs from any building it places: a visual group, one collider
 * geometry and measured extents. Kit-built variants and dwellings both produce one
 * (see world/poistructures.ts).
 */
export interface VariantInstance {
  /** Merged visual group. Local origin is the building's ground centre. */
  readonly group: THREE.Group;
  /**
   * Solid geometry in the group's local space, for one static trimesh collider.
   *
   * Position-only and non-indexed: a physics trimesh needs triangles, and carrying
   * normals and UVs through the merge would cost memory for nothing. SHARED between
   * every instance of this variant — read it, do not mutate it.
   */
  readonly solid: THREE.BufferGeometry;
  /** Measured XZ bounds of everything above ground, metres, centred on the origin. */
  readonly halfExtentX: number;
  readonly halfExtentZ: number;
  /** Authored footprint, `[x, z]`, for reference. */
  readonly footprint: readonly [number, number];
  readonly id: string;
}

export function variantCount(): number {
  return POI_VARIANTS.length;
}

export function variantDef(index: number): (typeof POI_VARIANTS)[number] {
  const def = POI_VARIANTS[index];
  if (!def) throw new RangeError(`Unknown POI variant ${index}`);
  return def;
}

/**
 * One mesh of the finished variant, with everything needed to rebuild it.
 *
 * THE TRANSFORM IS NOT OPTIONAL, and getting this wrong is not subtle. `mergePoiStatics`
 * bakes the world matrix into the geometry of every mesh it MERGES — but it deliberately
 * leaves others alone (roof panels, door-obstacle markers, anything with a unique
 * material), and those keep their transform on the Object3D. A cache that stored
 * only geometry and material and rebuilt a mesh at the origin collapsed every un-merged
 * mesh into the ground: measured, a two-storey variant lost all twelve of its roof panels
 * and `long-house` came out 2.8 m tall instead of 5.5 m.
 *
 * It is the WORLD matrix rather than the local one, because a variant's parts are NESTED:
 * a tilted container's shell lives inside its own rotated group, and rebuilding that mesh
 * as a flat child of a new root would drop the ancestor's transform. Measured on
 * `buried-container`, which is the deliberately half-sunk one: 0.46 m too tall. Composing
 * the whole chain costs nothing and removes the whole class of error.
 *
 * `userData` is kept for the same reason as the transform — `poiRoof` lives there, and
 * the gallery's roof button reads it.
 */
interface MergedMesh {
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material | THREE.Material[];
  /** The mesh's matrix relative to the variant root, with every ancestor composed in. */
  readonly matrix: THREE.Matrix4;
  readonly userData: Record<string, unknown>;
}

/** Everything about a variant that does not depend on where it is placed. */
interface VariantAssets {
  readonly meshes: readonly MergedMesh[];
  readonly solid: THREE.BufferGeometry;
  readonly halfExtentX: number;
  readonly halfExtentZ: number;
  readonly def: (typeof POI_VARIANTS)[number];
}

const assetCache = new Map<number, VariantAssets>();

/** Keeps only the triangles, in the root's local space, of everything solid. */
function collectSolidGeometry(root: THREE.Group): THREE.BufferGeometry {
  const positions: number[] = [];
  const vertex = new THREE.Vector3();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    // Roofs are the one part that would roof over the interior; nothing drives on them.
    if (mesh.userData.poiRoof === true) return;
    const attribute = mesh.geometry.getAttribute('position');
    if (!attribute) return;
    mesh.updateWorldMatrix(true, false);
    const index = mesh.geometry.getIndex();
    if (index) {
      for (let i = 0; i < index.count; i++) {
        vertex.fromBufferAttribute(attribute, index.getX(i)).applyMatrix4(mesh.matrixWorld);
        positions.push(vertex.x, vertex.y, vertex.z);
      }
    } else {
      for (let i = 0; i < attribute.count; i++) {
        vertex.fromBufferAttribute(attribute, i).applyMatrix4(mesh.matrixWorld);
        positions.push(vertex.x, vertex.y, vertex.z);
      }
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

/** Measured half-extents of everything above ground, so a setback can trust them. */
function measureHalfExtents(root: THREE.Group): { x: number; z: number } {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root, true);
  return {
    x: Math.max(1, (bounds.max.x - bounds.min.x) / 2),
    z: Math.max(1, (bounds.max.z - bounds.min.z) / 2),
  };
}

/** Builds a variant's shared assets. Expensive; call once per variant per session. */
function buildAssets(index: number): VariantAssets {
  const root = createPoiVariant(index);
  root.updateMatrixWorld(true);
  mergePoiStatics(root);
  root.updateMatrixWorld(true);

  const meshes: MergedMesh[] = [];
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    meshes.push({
      geometry: mesh.geometry,
      material: mesh.material,
      // Relative to the root, which is at the origin here, so this IS the mesh's whole
      // placement in the variant's own space.
      matrix: mesh.matrixWorld.clone(),
      userData: { ...mesh.userData },
    });
  });

  const solid = collectSolidGeometry(root);
  const half = measureHalfExtents(root);
  const def = variantDef(index);
  return {
    meshes,
    solid,
    halfExtentX: half.x,
    halfExtentZ: half.z,
    def,
  };
}

/** The cached assets for a variant, building them on first use. */
function assetsFor(index: number): VariantAssets {
  let assets = assetCache.get(index);
  if (!assets) {
    assets = buildAssets(index);
    assetCache.set(index, assets);
  }
  return assets;
}

/**
 * Builds every variant's assets up front.
 *
 * Called during loading rather than left to first use, because first use happens while
 * the player is driving: without this, the first time each kit building appears
 * it costs a full build inside a 3 ms streaming budget. Warmed, every later placement is
 * only Object3D wrapping.
 */
export function warmVariantAssets(): void {
  for (let index = 0; index < POI_VARIANTS.length; index++) assetsFor(index);
}

/**
 * Places one variant: fresh Object3Ds over the cached geometry, at the origin.
 *
 * The group has NOT been positioned and `solid` is in local space; the caller places
 * both. `mergePoiStatics` bakes world matrices, so merging before any positioning is not
 * merely tidier — it is the contract that makes the cache valid.
 */
export function createVariantInstance(index: number): VariantInstance {
  const assets = assetsFor(index);
  const group = new THREE.Group();
  group.name = `poi-${assets.def.id}`;
  group.userData.poiVariant = assets.def.id;

  for (const part of assets.meshes) {
    const mesh = new THREE.Mesh(part.geometry, part.material);
    part.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
    // `poiRoof` rides here, which is correct: every instance of a variant is the same
    // building, and the gallery's roof button reads this same flag.
    Object.assign(mesh.userData, part.userData);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  return {
    group,
    solid: assets.solid,
    halfExtentX: assets.halfExtentX,
    halfExtentZ: assets.halfExtentZ,
    footprint: assets.def.footprint,
    id: assets.def.id,
  };
}
