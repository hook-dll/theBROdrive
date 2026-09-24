import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { applyComicShading } from '../../render/comic';
import { TreeKind } from '../deserttiledata';
import type { Season } from '../landcover';

/**
 * THE WOOD'S TREES: spruce, birch and bush models (CC0, Quaternius; prepared by
 * tools/nature-prep.mjs into public/models/nature), each in a near and a far LOD.
 *
 * FOLIAGE IS GREY IN THE TEXTURE AND COLOURED BY THE SEASON. The source leaves come
 * yellow (the birch pack is autumnal) or red (the bush); on load every foliage texture
 * is reduced to its own luminance, normalised to a mean of one, and the material's
 * colour supplies the hue. Summer is a colour, autumn is a colour, and the model is
 * the same model.
 *
 * The drawing is the comic ground's: banded light and the post pass's ink round every
 * silhouette. Foliage is alpha-TESTED, not blended: the ink pass outlines by depth,
 * and a blended card writes none.
 */

export interface TreePart {
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.MeshStandardMaterial;
  /**
   * Shadow-map material for foliage: the cards' alpha cut-out, so a crown casts the
   * shadow of its leaves and not of the square cards they are painted on. Without it
   * every card was an opaque square in the shadow map, and the crowns wore a
   * crawling lattice of their own card shadows.
   */
  readonly depthMaterial: THREE.MeshDepthMaterial | null;
  readonly foliage: boolean;
}

const depthCache = new Map<string, THREE.MeshDepthMaterial>();

function foliageDepth(material: THREE.MeshStandardMaterial): THREE.MeshDepthMaterial {
  const hit = depthCache.get(material.uuid);
  if (hit) return hit;
  const depth = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    map: material.map,
    alphaTest: material.alphaTest,
    side: THREE.DoubleSide,
  });
  depthCache.set(material.uuid, depth);
  return depth;
}

/** One model at one level of detail: its parts, in the tree's own metres. */
export type TreeLod = readonly TreePart[];

export interface TreeVariant {
  readonly near: TreeLod;
  readonly far: TreeLod;
}

/**
 * Bark multiplier per kind. The spruce bark texture is a warm red-brown that the
 * comic bands push to orange; a real spruce's lower trunk and dead branches are grey.
 */
const BARK_TINT: Record<TreeKind, number> = {
  [TreeKind.Birch]: 0xffffff,
  [TreeKind.Spruce]: 0x6a5f55,
  [TreeKind.Bush]: 0xffffff,
  [TreeKind.Broadleaf]: 0x77736c,
};
/** Kinds whose bark texture is reduced to luminance and coloured by `BARK_TINT`. */
const GREY_BARK: Record<TreeKind, boolean> = {
  [TreeKind.Birch]: false,
  [TreeKind.Spruce]: true,
  [TreeKind.Bush]: false,
  [TreeKind.Broadleaf]: true,
};

/** Trunk collider radius per kind at scale 1, metres; 0 for things a car drives through. */
export const TREE_TRUNK_RADIUS: readonly number[] = [0.24, 0.32, 0, 0.3];

interface KindSource {
  readonly files: readonly string[];
  /** Mesh names to take from each file; empty means the whole scene is one tree. */
  readonly meshes: readonly string[];
  /** Height a scale-1 instance stands, metres. */
  readonly height: number;
  /**
   * Share of the height sunk into the ground. A bush is a crown with no trunk: stood
   * on its lowest leaf it hovers, so its base goes into the grass it grows out of.
   */
  readonly sink?: number;
  /**
   * Trunk thickness multiplier, applied to the bark below the first branches and
   * eased out above them. The MegaKit broadleaves are storybook oaks with flared
   * trunks; a Russian lime or aspen is a slim grey bole.
   */
  readonly girth?: number;
}

const SOURCES: Record<TreeKind, KindSource> = {
  [TreeKind.Birch]: { files: ['birch'], meshes: ['BirchTree_1', 'BirchTree_2', 'BirchTree_4', 'BirchTree_5'], height: 17 },
  [TreeKind.Spruce]: { files: ['spruce-1', 'spruce-2', 'spruce-3', 'spruce-4', 'spruce-5'], meshes: [], height: 21 },
  [TreeKind.Bush]: { files: ['bush'], meshes: [], height: 2.6, sink: 0.35 },
  [TreeKind.Broadleaf]: { files: ['broad-1', 'broad-2', 'broad-3', 'broad-4'], meshes: [], height: 17, girth: 0.55 },
};

/** Foliage colour per kind and season, sRGB. */
const FOLIAGE: Record<Season, Record<TreeKind, number>> = {
  summer: {
    [TreeKind.Birch]: 0x7d9a3e,
    [TreeKind.Spruce]: 0x3b5a34,
    [TreeKind.Bush]: 0x6c8a3a,
    [TreeKind.Broadleaf]: 0x5f7f34,
  },
};

/** Luminance of a texture, normalised to a mean of about one, as a new texture. */
function greyFoliage(texture: THREE.Texture): THREE.Texture {
  const image = texture.image as HTMLImageElement | ImageBitmap;
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const g = canvas.getContext('2d');
  if (!g) return texture;
  g.drawImage(image, 0, 0);
  const data = g.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3]! < 128) continue;
    sum += 0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!;
    count++;
  }
  const mean = count > 0 ? sum / count : 128;
  // A mean of ~200/255 leaves headroom for the lighter veins without clipping.
  const gain = 200 / mean;
  for (let i = 0; i < px.length; i += 4) {
    const l = Math.min(255, (0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!) * gain);
    px[i] = px[i + 1] = px[i + 2] = l;
  }
  g.putImageData(data, 0, 0);
  const out = new THREE.CanvasTexture(canvas);
  out.colorSpace = THREE.SRGBColorSpace;
  out.flipY = texture.flipY;
  out.anisotropy = 4;
  return out;
}

const materialCache = new Map<string, THREE.MeshStandardMaterial>();

function partMaterial(source: THREE.MeshStandardMaterial, foliage: boolean, kind: TreeKind, season: Season, vertexColors: boolean): THREE.MeshStandardMaterial {
  const key = `${source.uuid}:${vertexColors}`;
  const hit = materialCache.get(key);
  if (hit) return hit;
  const material = applyComicShading(
    new THREE.MeshStandardMaterial({
      // Foliage always, and bark where the kind asks for it: the source bark textures are
      // a storybook red-brown that no Russian spruce or lime has.
      map: source.map && (foliage || GREY_BARK[kind]) ? greyFoliage(source.map) : source.map,
      color: foliage ? FOLIAGE[season][kind] : BARK_TINT[kind],
      vertexColors,
      roughness: 0.95,
      metalness: 0,
      side: foliage ? THREE.DoubleSide : THREE.FrontSide,
      alphaTest: foliage ? 0.45 : 0,
      transparent: false,
    }),
    // No stipple on trees: at card scale the dots alias into a crawl across the crown.
    { contourStrength: 0, stippleStrength: 0, shadowWarmth: 0.3 },
  );
  materialCache.set(key, material);
  return material;
}

/**
 * The parts of one tree inside a loaded scene: every mesh under `root` (or the named
 * one), baked into the scene's frame, stood on the origin and scaled to `height`.
 */
function extractTree(root: THREE.Object3D, meshName: string | null, source: KindSource, kind: TreeKind, season: Season): TreeLod {
  const { height } = source;
  const sink = source.sink ?? 0;
  const girth = source.girth ?? 1;
  root.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    if (meshName !== null && o.name !== meshName && o.parent?.name !== meshName) return;
    meshes.push(o);
  });
  if (meshes.length === 0) throw new Error(`tree mesh ${meshName ?? '(scene)'} not found`);
  const parts: { geometry: THREE.BufferGeometry; source: THREE.MeshStandardMaterial }[] = [];
  const box = new THREE.Box3();
  for (const mesh of meshes) {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const baked = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    // Multi-material meshes arrive as groups: split them into one geometry each.
    const groups = baked.groups.length > 0 ? baked.groups : [{ start: 0, count: baked.index?.count ?? baked.getAttribute('position').count, materialIndex: 0 }];
    for (const group of groups) {
      const geometry = baked.index
        ? subGeometry(baked, group.start, group.count)
        : baked;
      parts.push({ geometry, source: materials[group.materialIndex ?? 0] as THREE.MeshStandardMaterial });
      geometry.computeBoundingBox();
      box.union(geometry.boundingBox!);
    }
  }
  const scale = height / Math.max(0.01, box.max.y - box.min.y);
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  return parts.map(({ geometry, source: partSource }) => {
    geometry.translate(-cx, -box.min.y, -cz).scale(scale, scale, scale);
    const foliage = /leaf|leaves/i.test(partSource.name);
    if (girth !== 1 && !foliage) {
      const p = geometry.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i) / height;
        const k = girth + (1 - girth) * Math.min(1, Math.max(0, (y - 0.3) / 0.25));
        p.setXYZ(i, p.getX(i) * k, p.getY(i), p.getZ(i) * k);
      }
      geometry.computeVertexNormals();
    }
    geometry.translate(0, -sink * height, 0);
    geometry.computeBoundingSphere();
    const source = partSource;
    const vertexColors = geometry.getAttribute('color') !== undefined;
    const material = partMaterial(source, foliage, kind, season, vertexColors);
    return { geometry, material, depthMaterial: foliage ? foliageDepth(material) : null, foliage };
  });
}

/** Indices `start .. start+count` of an indexed geometry, as a geometry of its own. */
function subGeometry(g: THREE.BufferGeometry, start: number, count: number): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(g.attributes)) out.setAttribute(name, g.getAttribute(name));
  const index = g.index!.array;
  out.setIndex(Array.from(index.slice(start, start + count)));
  return out;
}

let loading: Promise<readonly TreeVariant[][]> | null = null;

/** Every kind's variants, loaded once. Index by `TreeKind`. */
export function loadTreeVariants(season: Season = 'summer'): Promise<readonly TreeVariant[][]> {
  if (loading) return loading;
  const loader = new GLTFLoader();
  const load = (name: string): Promise<THREE.Object3D> =>
    loader.loadAsync(`${import.meta.env.BASE_URL}models/nature/${name}.glb`).then((g) => g.scene);
  const kinds = [TreeKind.Birch, TreeKind.Spruce, TreeKind.Bush, TreeKind.Broadleaf];
  loading = Promise.all(
    kinds.map(async (kind) => {
      const source = SOURCES[kind];
      const variants: TreeVariant[] = [];
      for (const file of source.files) {
        const [near, far] = await Promise.all([load(file), load(`${file}-far`)]);
        const names = source.meshes.length > 0 ? source.meshes : [null];
        for (const name of names) {
          variants.push({
            near: extractTree(near, name, source, kind, season),
            far: extractTree(far, name, source, kind, season),
          });
        }
      }
      return variants;
    }),
  );
  return loading;
}
