import type * as THREE from 'three';
import { DwellingBuilder, type Weathering } from './builder';
import { DWELLINGS } from './list';
import {
  barrack,
  bauhaus,
  blackhouse,
  chalet,
  cycladic,
  dacha,
  dutchGable,
  faluCottage,
  finnishHouse,
  izba,
  izbaRuin,
  mansard,
  mazanka,
  tbilisi,
  trullo,
  tudor,
  turfHouse,
} from './europe';
import {
  adobeRuin,
  aFrame,
  airstream,
  butterfly,
  casita,
  chattel,
  dustbowl,
  hacienda,
  logCabin,
  maya,
  pueblo,
  quonset,
  saltbox,
  shotgun,
  streamline,
  tipi,
  trailerWreck,
  victorian,
  victorianGhost,
} from './americas';
import { djenne, lebanese, ndebele, nubian, rondavel, windcatcher, yemen } from './africa';
import { chinese, futuro, haveli, minka, thaiStilt, tongkonan, yurt } from './asia';

/**
 * Exterior-only dwellings: fifty houses from different peoples and periods, none
 * taller than two storeys, none with a way in. See ./builder.ts for what that buys.
 * Their data lives in ./list.ts; this pairs each entry with the builder that draws it.
 */
const BUILDERS: Readonly<Record<string, (b: DwellingBuilder) => void>> = {
  'izba': izba,
  'izba-ruin': izbaRuin,
  'dacha': dacha,
  'finnish-house': finnishHouse,
  'barrack': barrack,
  'mazanka': mazanka,
  'tudor': tudor,
  'chalet': chalet,
  'dutch-gable': dutchGable,
  'falu-cottage': faluCottage,
  'turf-house': turfHouse,
  'mansard': mansard,
  'cycladic': cycladic,
  'trullo': trullo,
  'blackhouse': blackhouse,
  'bauhaus': bauhaus,
  'tbilisi': tbilisi,
  'pueblo': pueblo,
  'tipi': tipi,
  'log-cabin': logCabin,
  'saltbox': saltbox,
  'victorian': victorian,
  'victorian-ghost': victorianGhost,
  'shotgun': shotgun,
  'dustbowl': dustbowl,
  'quonset': quonset,
  'airstream': airstream,
  'trailer-wreck': trailerWreck,
  'a-frame': aFrame,
  'butterfly': butterfly,
  'streamline': streamline,
  'hacienda': hacienda,
  'casita': casita,
  'adobe-ruin': adobeRuin,
  'maya': maya,
  'chattel': chattel,
  'djenne': djenne,
  'nubian': nubian,
  'yemen': yemen,
  'windcatcher': windcatcher,
  'rondavel': rondavel,
  'ndebele': ndebele,
  'lebanese': lebanese,
  'minka': minka,
  'chinese': chinese,
  'yurt': yurt,
  'thai-stilt': thaiStilt,
  'tongkonan': tongkonan,
  'haveli': haveli,
  'futuro': futuro,
};

const ABANDONED: Weathering = { fade: 0.4, grime: 0.6, patchy: 0.9 };

export interface DwellingGeometry {
  /** Vertex-coloured shell: what is drawn with the comic material and what is collided with. */
  readonly body: THREE.BufferGeometry;
  readonly glass: THREE.BufferGeometry | null;
}

/** Builds one dwelling's two geometries. Pure: the same index is always the same house. */
export function buildDwellingGeometry(index: number): DwellingGeometry {
  const definition = DWELLINGS[index];
  const build = definition && BUILDERS[definition.id];
  if (!definition || !build) throw new RangeError(`Unknown dwelling ${index}`);
  const builder = new DwellingBuilder(definition.weather ?? (definition.abandoned ? ABANDONED : undefined));
  build(builder);
  return { body: builder.geometry(), glass: builder.glassGeometry() };
}
