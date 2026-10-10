import * as THREE from 'three';
import { dwellingGroup } from './dwellings/builder';
import { buildDwellingGeometry } from './dwellings/catalogue';
import { DWELLINGS } from './dwellings/list';
import { POI_VARIANTS, poiVariantIndex } from './poi-variants';
import { createVariantInstance, warmVariantAssets, type VariantInstance } from './poivariantbuild';
import { MAST_IDS } from './poislots';

/**
 * Every building the world scatters: the three masts built from the POI kit, then the
 * fifty exterior-only dwellings. The story house is one of these dwellings, placed on its
 * own by src/story/sitebuild.ts rather than by the road's POI stream.
 *
 * Both kinds come out as the same `VariantInstance`, so placement, colliders and loot
 * never ask which kind they are standing next to.
 */
export type PoiStructureKind = 'mast' | 'dwelling';

export interface PoiStructure {
  readonly id: string;
  readonly name: string;
  /** Who built it, where and when; or what it is for. */
  readonly note: string;
  readonly kind: PoiStructureKind;
  /** Authored `[x, z]` extent, metres: what the pure placement keeps clear by. */
  readonly footprint: readonly [number, number];
}

export const POI_STRUCTURES: readonly PoiStructure[] = [
  ...MAST_IDS.map((id): PoiStructure => {
    const definition = POI_VARIANTS[poiVariantIndex(id)]!;
    return { id, name: definition.name, note: 'Вышки и связь', kind: 'mast', footprint: definition.footprint };
  }),
  ...DWELLINGS.map((definition): PoiStructure => ({
    id: definition.id,
    name: definition.name,
    note: definition.origin,
    kind: 'dwelling',
    footprint: definition.footprint,
  })),
];

export function structureCount(): number {
  return POI_STRUCTURES.length;
}

export function structureDef(index: number): PoiStructure {
  const definition = POI_STRUCTURES[index];
  if (!definition) throw new RangeError(`Unknown POI structure ${index}`);
  return definition;
}

interface DwellingAssets {
  readonly body: THREE.BufferGeometry;
  readonly glass: THREE.BufferGeometry | null;
  readonly halfX: number;
  readonly halfZ: number;
}

/**
 * One geometry pair per dwelling for the whole session. A house is pure, so building
 * it again per placement would only cost time: 0.1–15k triangles each, and the stream
 * has a 3 ms budget per job.
 */
const dwellingCache = new Map<number, DwellingAssets>();

function dwellingAssets(dwelling: number): DwellingAssets {
  let assets = dwellingCache.get(dwelling);
  if (!assets) {
    const { body, glass } = buildDwellingGeometry(dwelling);
    body.computeBoundingBox();
    const box = body.boundingBox!;
    // SYMMETRIC about the origin, and the larger side of each axis. A house is not
    // centred on its origin (a chimney on one gable, a stair down one side), and every
    // consumer of these numbers — the ground fit, the wreck keep-out, the yard the loot
    // is laid in — treats them as a box centred on the anchor.
    assets = {
      body,
      glass,
      halfX: Math.max(1, -box.min.x, box.max.x),
      halfZ: Math.max(1, -box.min.z, box.max.z),
    };
    dwellingCache.set(dwelling, assets);
  }
  return assets;
}

const dwellingOffset = MAST_IDS.length;

/** Places one structure: fresh Object3Ds over cached geometry, at the local origin. */
export function createStructureInstance(index: number): VariantInstance {
  const definition = structureDef(index);
  if (definition.kind === 'mast') {
    const instance = createVariantInstance(poiVariantIndex(definition.id));
    instance.group.userData.poiStructure = definition.id;
    return instance;
  }
  const assets = dwellingAssets(index - dwellingOffset);
  const group = dwellingGroup(`poi-${definition.id}`, assets.body, assets.glass);
  group.userData.poiStructure = definition.id;
  return {
    group,
    // The closed shell itself: nothing can be entered, so a trimesh of what is drawn is
    // exactly the obstacle, porch steps and all.
    solid: assets.body,
    halfExtentX: assets.halfX,
    halfExtentZ: assets.halfZ,
    footprint: definition.footprint,
    id: definition.id,
  };
}

/**
 * Builds every structure's shared assets during loading, so the first time each one
 * streams in while driving costs only the Object3D wrapping. Also warms the kit-built
 * variants, which includes the kit-built masts.
 */
export function warmPoiStructures(): void {
  warmVariantAssets();
  for (let dwelling = 0; dwelling < DWELLINGS.length; dwelling++) dwellingAssets(dwelling);
}
