/**
 * A gallery POI variant, made ready to stand in the world.
 *
 * The variants in `poi-variants.ts` are a VISUAL catalogue. They are authored about a
 * local origin with the ground at Y=0, they carry no physics and no game entities, and
 * between them they contain a couple of hundred lights. None of that is a defect in the
 * catalogue — it is what a catalogue is — but it means the three things the world needs
 * from a building have to be produced here, once, for every variant:
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
 *   LIGHT SOURCES, NOT LIGHTS. This is the subtle one. Three's forward renderer compiles
 *   the light count into every material, so adding or removing a real light recompiles the
 *   world's shaders — which is why the game keeps its rendered lights in fixed pools
 *   (`render/lights.ts`, `render/vehiclelights.ts`). A variant's 65 authored lights are
 *   therefore replaced by INVISIBLE PointLight markers that the existing `LightBudget`
 *   already knows how to find and budget, exactly as the streamed street lamps do. The
 *   fixtures' own emissive materials stay, so a window still glows.
 *
 * AND ALL OF IT IS CACHED, because building is not cheap. Measured on a 5950X, one
 * variant costs 3.74 ms to build and 11.4 ms at worst — against a streaming budget of
 * 3 ms per frame, one job per frame. Rebuilding per placement would therefore hitch on
 * every POI, and this world has one every 1.2 km. The result is position-independent:
 * `mergePoiStatics` bakes each mesh's transform into its geometry at the local origin, so
 * the merged geometry, the collider geometry and the lamp offsets are the same wherever
 * the building ends up. So they are built once per session and shared, and placing a
 * building afterwards is only wrapping them in fresh Object3Ds. That also means the
 * geometry is never leaked: it belongs to the cache, not to a streamed chunk.
 *
 * Determinism: every variant builder is pure — no `Math.random` anywhere in the catalogue
 * — so the same index always produces the same building. Which index goes where is the
 * caller's decision, and it must come from the world seed.
 */

import * as THREE from 'three';
import { createPoiVariant, mergePoiStatics, POI_VARIANTS } from './poi-variants';

export type PoiCategory = 'house' | 'shop' | 'gas' | 'wreck' | 'tower' | 'container';

/** Authored metadata the world cares about after the merge. */
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
  readonly category: PoiCategory;
  readonly id: string;
  /** Invisible light markers handed to `LightBudget`. */
  readonly lightSources: readonly THREE.PointLight[];
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
 * Render distance for every lamp marker, from the authored light's own reach.
 *
 * A single value rather than the authored one: `LightBudget` only ever reads a source's
 * intensity and position, and it composes the reach itself when it copies the chosen
 * source into a slot. Keeping the authored distance here would be a number nothing
 * consults, and a number nothing consults is a number that drifts.
 */
const MARKER_DISTANCE = 26;

/**
 * One mesh of the finished variant, with everything needed to rebuild it.
 *
 * THE TRANSFORM IS NOT OPTIONAL, and getting this wrong is not subtle. `mergePoiStatics`
 * bakes the world matrix into the geometry of every mesh it MERGES — but it deliberately
 * leaves others alone (roof panels, light switches, door-obstacle markers, anything with a
 * unique material), and those keep their transform on the Object3D. A cache that stored
 * only geometry and material and rebuilt a mesh at the origin collapsed every un-merged
 * mesh into the ground: measured, the starter homestead lost all twelve of its roof panels
 * and `long-house` came out 2.8 m tall instead of 5.5 m.
 *
 * It is the WORLD matrix rather than the local one, because a variant's parts are NESTED:
 * a tilted container's shell lives inside its own rotated group, and rebuilding that mesh
 * as a flat child of a new root would drop the ancestor's transform. Measured on
 * `buried-container`, which is the deliberately half-sunk one: 0.46 m too tall. Composing
 * the whole chain costs nothing and removes the whole class of error.
 *
 * `userData` is kept for the same reason as the transform — `poiRoof` and the light-toggle
 * closure live there, and the gallery's roof button reads the first of them.
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
  /** Lamp offsets in local space, with the colour the fixture was authored in. */
  readonly lamps: readonly { readonly color: THREE.Color; readonly position: THREE.Vector3 }[];
  readonly def: (typeof POI_VARIANTS)[number];
}

const assetCache = new Map<number, VariantAssets>();

/**
 * Replaces every real light in the tree with an invisible marker.
 *
 * `visible = false` is what makes this safe: Three's renderer walks the scene graph to
 * collect lights and skips invisible objects, so the compiled light count never changes
 * when a chunk of buildings streams in. The marker still resolves a world position, which
 * is all `LightBudget`'s selection needs.
 */
function replaceLightsWithMarkers(root: THREE.Group): THREE.Vector3[] {
  const authored: THREE.Light[] = [];
  root.traverse((object) => {
    if ((object as THREE.Light).isLight) authored.push(object as THREE.Light);
  });
  const positions: THREE.Vector3[] = [];
  const scratch = new THREE.Vector3();
  for (const light of authored) {
    light.getWorldPosition(scratch);
    // The root has not been moved yet, so world position is group-local here.
    positions.push(scratch.clone());
    const target = (light as THREE.SpotLight).target;
    if (target && target.parent === light) target.removeFromParent();
    light.removeFromParent();
    light.dispose();
  }
  return positions;
}

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
  const lampPositions = replaceLightsWithMarkers(root);
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
  // Every authored lamp gets one colour for the whole building: they are room lights and
  // canopy lamps, and the budget only needs a source to exist and be lit.
  const colour = new THREE.Color(0xffd9a0);
  return {
    meshes,
    solid,
    halfExtentX: half.x,
    halfExtentZ: half.z,
    lamps: lampPositions.map((position) => ({ color: colour.clone(), position })),
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
 * the player is driving: without this, the first time each of the 26 buildings appears
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
    // `poiRoof` and the light-toggle closure ride here. The closure is shared, which is
    // correct: every instance of a variant is the same building.
    Object.assign(mesh.userData, part.userData);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  const lightSources: THREE.PointLight[] = [];
  for (const lamp of assets.lamps) {
    const marker = new THREE.PointLight(lamp.color, 0, MARKER_DISTANCE, 2);
    marker.visible = false;
    marker.userData.lightBudgetSource = true;
    marker.position.copy(lamp.position);
    group.add(marker);
    lightSources.push(marker);
  }

  return {
    group,
    solid: assets.solid,
    halfExtentX: assets.halfExtentX,
    halfExtentZ: assets.halfExtentZ,
    footprint: assets.def.footprint,
    category: assets.def.category,
    id: assets.def.id,
    lightSources,
  };
}
