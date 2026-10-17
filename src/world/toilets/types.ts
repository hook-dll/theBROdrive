/**
 * The Japanese street-toilet POIs (docs/toilet-poi-design.md): what a catalogue entry
 * is made of. A variant is DATA: one shell spec, the fixtures it carries, an optional
 * face and the scenario it opens with. Geometry is rebuilt from it; progress is saved
 * apart from it (state.ts).
 */

/** Progress through a visit, in order. */
export type ToiletState = 'arrived' | 'inspected' | 'repairing' | 'cleaning' | 'testing' | 'healthy';

export const TOILET_STATES: readonly ToiletState[] = ['arrived', 'inspected', 'repairing', 'cleaning', 'testing', 'healthy'];

/** What the optional face shows. */
export type ToiletEmotion = 'sleepy' | 'angry' | 'embarrassed' | 'worried' | 'relieved' | 'happy' | 'proud';

export const TOILET_EMOTIONS: readonly ToiletEmotion[] = ['sleepy', 'angry', 'embarrassed', 'worried', 'relieved', 'happy', 'proud'];

/** The physical verbs a fixture may answer to. */
export type ToiletVerb = 'open' | 'close' | 'turn' | 'press' | 'pull' | 'slide' | 'insert' | 'pour' | 'pump' | 'wipe';

/**
 * The scenario a variant opens with. Only its id is catalogued so far: the action
 * sequences and their mistake effects are not implemented yet.
 */
export type ToiletScenarioId = 'clogged-drain';

/** Roof over the cabin's ceiling: a slab, a pitched house roof, or a pyramid (hōgyō). */
export type ToiletRoof = 'flat' | 'gable' | 'pyramid';

/** The pan: a western bowl with a washlet seat and lid, or a floor-level squat pan. */
export type ToiletBowl = 'washlet' | 'squat';

/** The shell's wall finish, as the POI kit draws it (world/poi/kit.ts patterns). */
export type ToiletWallPattern = 'plaster' | 'boards' | 'blocks' | 'metal';

/** Optional exterior dressing on the one shell. */
export type ToiletDressing =
  /** Vertical timber battens over every wall (cedar cladding). */
  | 'battens'
  /** Two freestanding walls before the door that screen it from the street. */
  | 'privacy-walls'
  /** Chimney stacks on the roof and a low picket fence either side of the door. */
  | 'house';

/** Hex colours, sRGB. */
export interface ToiletPalette {
  /** Walls front, back, left, right (the door is in the front, facing -Z). */
  readonly walls: readonly [number, number, number, number];
  readonly trim: number;
  readonly roof: number;
  readonly plinth: number;
  readonly floor: number;
  readonly door: number;
  /** Battens, privacy walls, chimneys and fence. */
  readonly accent: number;
}

/** The one low-poly cabin every variant is drawn from (geometry.ts). Metres. */
export interface ToiletShellSpec {
  /** Outer wall faces, X. At least 2.2 for the fixtures to fit (geometry.ts throws otherwise). */
  readonly width: number;
  /** Outer wall faces, Z. At least 2.2. */
  readonly depth: number;
  /** Interior wall height above the plinth. At least 2.4, for the back window over the mirror. */
  readonly height: number;
  readonly roof: ToiletRoof;
  /** How far the roof reaches past the walls. */
  readonly overhang: number;
  readonly wallPattern: ToiletWallPattern;
  readonly palette: ToiletPalette;
  readonly dressing: readonly ToiletDressing[];
}

/** The stateful fixtures a cabin can carry; each kind has one builder in fixtures.ts. */
export type ToiletFixtureKind = 'door' | 'valve' | 'flush' | 'lid' | 'plunger' | 'floor-dirt';

/** Optional eyes and brows over the door. */
export interface ToiletFaceSpec {
  /** Shown on arrival, before anything is fixed. */
  readonly arrival: ToiletEmotion;
  /** Eye white radius, metres. */
  readonly size: number;
  readonly brow: number;
}

/**
 * Where a variant's facts came from. The variants are low-poly readings of real
 * buildings, never copies: only the facts listed are used, and no image is reproduced.
 */
export interface ToiletSourceCard {
  readonly url: string;
  readonly title: string;
  /** Author or publisher, and the licence of what was used ("facts only" when no asset is). */
  readonly author: string;
  readonly licence: string;
  /** ISO date. */
  readonly accessed: string;
  readonly silhouette?: string;
  readonly plan?: string;
  readonly fixtures?: string;
  readonly palette?: string;
}

export interface ToiletVariant {
  /** Stable: saves and the POI catalogue key on it. */
  readonly id: string;
  readonly name: string;
  /** Second line in the gallery: designer, place, year. */
  readonly note: string;
  readonly shell: ToiletShellSpec;
  readonly bowl: ToiletBowl;
  /** The fixtures present, in the order the gallery lists them. */
  readonly fixtures: readonly ToiletFixtureKind[];
  readonly face: ToiletFaceSpec | null;
  readonly scenario: ToiletScenarioId;
  readonly sources: readonly ToiletSourceCard[];
}
