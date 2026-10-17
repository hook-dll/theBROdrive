/**
 * The Japanese street-toilet POIs (docs/toilet-poi-design.md): what a catalogue entry
 * is made of. A variant is DATA: one service cabin, the family of volumes around it, its
 * layout (scale and siting) and host, the fixtures it carries, an optional face and the
 * scenario it opens with. Geometry is rebuilt from it; progress is saved apart from it
 * (state.ts).
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
 * The scenario a variant opens with. Only its id and the fixtures it needs are
 * catalogued so far: the action sequences and their mistake effects are not implemented
 * yet.
 */
export type ToiletScenarioId = 'clogged-drain';

/**
 * Roof over a volume. On a rectangle: a slab, a pitched house roof, or a pyramid (hōgyō).
 * On a drum: a round slab, or one lifted clear of the walls on slim posts.
 */
export type ToiletRoof = 'flat' | 'gable' | 'pyramid' | 'disc' | 'floating';

/** The pan: a western bowl with a washlet seat and lid, or a floor-level squat pan. */
export type ToiletBowl = 'washlet' | 'squat';

/** The shell's wall finish, as the POI kit draws it (world/poi/kit.ts patterns). */
export type ToiletWallPattern = 'plaster' | 'boards' | 'blocks' | 'metal';

/** Optional exterior dressing on the service cabin. */
export type ToiletDressing =
  /** Cedar boards standing off every wall at varied angles; a cluster's huts wear them too. */
  | 'louvres'
  /** Two freestanding walls before the door that screen it from the street. */
  | 'privacy-walls'
  /** Chimney stacks on the roof and a low picket fence either side of the door. */
  | 'house';

/**
 * A sealed booth beside the service cabin, drawn closed: the player never enters it.
 * `x`, `z` are its ground centre in the variant's frame (the service cabin's centre is the
 * origin and its door faces -Z); `yaw` turns it about Y, its own door facing -Z before the
 * turn. `height` is its wall height above its plinth, as the cabin's is.
 */
export type ToiletAnnex =
  | {
      readonly shape: 'box';
      readonly x: number;
      readonly z: number;
      readonly yaw: number;
      readonly width: number;
      readonly depth: number;
      readonly height: number;
      readonly color: number;
    }
  | {
      readonly shape: 'drum';
      readonly x: number;
      readonly z: number;
      readonly yaw: number;
      readonly radius: number;
      readonly height: number;
      readonly color: number;
    };

/** A slim post from the ground to the cover over it, at `[x, z]`. */
export type ToiletColumn = readonly [number, number];

/** A sealed room of a row, as wide as `width` along X, as deep and tall as the cabin. */
export interface ToiletRowRoom {
  /** Rooms on one side follow each other outwards from the cabin, in catalogue order. */
  readonly side: 'left' | 'right';
  readonly width: number;
  readonly color: number;
}

/** A round or oval eave slab over the whole family. */
export interface ToiletEave {
  readonly x: number;
  readonly z: number;
  readonly radiusX: number;
  readonly radiusZ: number;
  /** Underside, above the ground. */
  readonly y: number;
  readonly thickness: number;
  readonly color: number;
}

/** A ring of vertical louvres about the cabin's centre, holding the eave up; open front and back. */
export interface ToiletLouvreRing {
  /** To the louvres' centre line. */
  readonly radius: number;
  readonly count: number;
  /** Along the ring, and radially. */
  readonly width: number;
  readonly depth: number;
  /** Half the angle, radians, left open at the front (-Z) and at the back (+Z). */
  readonly entrance: number;
  readonly color: number;
}

/** A long cover slab running along X, its underside following `profile`. */
export interface ToiletCanopy {
  /** Plan centre. */
  readonly x: number;
  readonly z: number;
  /** Along X, and across Z. */
  readonly length: number;
  readonly width: number;
  /**
   * Underside heights above the ground at evenly spaced stations from the -X end to the
   * +X end: a sag deflects it, a zigzag folds it, two stations slant it.
   */
  readonly profile: readonly number[];
  readonly thickness: number;
  readonly color: number;
}

/**
 * The plan family: what stands around the one service cabin the player enters. Each is a
 * reusable gesture read off a real building (docs/toilet-poi-design.md, "Families").
 */
export type ToiletForm =
  /** The cabin alone. */
  | { readonly family: 'cabin' }
  /** Sealed rooms either side of the cabin in one row along X, under one roof. */
  | { readonly family: 'row'; readonly rooms: readonly ToiletRowRoom[] }
  /** Separate huts scattered about the cabin, each on its own plinth under its own roof of the cabin's kind. */
  | { readonly family: 'cluster'; readonly huts: readonly ToiletAnnex[] }
  /**
   * A concave vessel: one curved wall wrapping behind the cabin and reaching forward
   * either side of the door, its rim rising from the back to the tips and flaring out, with
   * faucets at several heights on its inner face. Its circle's centre is on the cabin's
   * front face line.
   */
  | {
      readonly family: 'vessel';
      /** To the wall's centre line at the ground. */
      readonly radius: number;
      /** Half the arc, radians, measured from straight behind the cabin. */
      readonly sweep: number;
      /** Rim heights above the ground: straight behind the cabin, and at the tips. */
      readonly back: number;
      readonly tips: number;
      /** Outward lean, radians. */
      readonly flare: number;
      readonly thickness: number;
      readonly color: number;
      /** Spout heights above the ground, one faucet each, alternating sides. */
      readonly faucets: readonly number[];
    }
  /** A round or oval eave over the cabin, held by a louvre ring or by columns, with booths beneath. */
  | {
      readonly family: 'eave';
      readonly eave: ToiletEave;
      readonly louvres: ToiletLouvreRing | null;
      readonly booths: readonly ToiletAnnex[];
      readonly columns: readonly ToiletColumn[];
    }
  /** One long deflected, folded or slanted canopy on columns over the cabin and sealed cubes. */
  | {
      readonly family: 'canopy';
      readonly canopy: ToiletCanopy;
      readonly cubes: readonly ToiletAnnex[];
      readonly columns: readonly ToiletColumn[];
    };

export type ToiletFamily = ToiletForm['family'];

export const TOILET_FAMILIES: readonly ToiletFamily[] = ['cabin', 'row', 'cluster', 'vessel', 'eave', 'canopy'];

/** Hex colours, sRGB. */
export interface ToiletPalette {
  /** Walls front, back, left, right (the door is in the front, facing -Z); a drum takes the back's. */
  readonly walls: readonly [number, number, number, number];
  /** Opening trim, the annexes' door frames, columns and the floating roofs' posts. */
  readonly trim: number;
  readonly roof: number;
  readonly plinth: number;
  readonly floor: number;
  readonly door: number;
  /** Louvres, privacy walls, chimneys and fence. */
  readonly accent: number;
}

/**
 * The one low-poly service cabin the player enters (geometry.ts), and the family drawn
 * around it (families.ts). Metres.
 */
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
  /**
   * Wraps the side and back walls in a drum of this radius whose circle runs through the
   * front corners: a round booth with a flat door front. Its roof is `disc` or `floating`.
   */
  readonly drum?: number;
  readonly wallPattern: ToiletWallPattern;
  readonly palette: ToiletPalette;
  readonly dressing: readonly ToiletDressing[];
  readonly form: ToiletForm;
}

/** The stateful fixtures a cabin can carry; each kind has one builder in fixtures.ts. */
export type ToiletFixtureKind = 'door' | 'valve' | 'flush' | 'lid' | 'plunger' | 'floor-dirt';

/**
 * The fixtures each scenario acts on: a variant opening with a scenario carries at least
 * these (toilet-check holds it). The lid is the bowl's, never a scenario's.
 */
export const TOILET_SCENARIO_FIXTURES: { readonly [id in ToiletScenarioId]: readonly ToiletFixtureKind[] } = {
  'clogged-drain': ['door', 'valve', 'plunger', 'flush', 'floor-dirt'],
};

/**
 * The layout: the scale and siting a player reads on arrival, across the plan families
 * (layouts.ts holds each one's rules and planned share; docs/toilet-poi-design.md,
 * "Layouts"). Not to be confused with `toiletLayout` (geometry.ts), the fixture layout
 * inside the cabin.
 */
export type ToiletLayoutKind =
  /** One cabin on its own. */
  | 'single'
  /** One cabin inside a small open gesture: a wall, an eave, a canopy. */
  | 'pavilion'
  /** Sealed rooms beside the cabin in one line under one roof. */
  | 'row'
  /** Separate huts about the cabin. */
  | 'cluster'
  /** A round plan about the cabin: a ring, a drum court, a round eave. */
  | 'circular'
  /** Many sealed booths under one large cover: a station or park block. */
  | 'large-public'
  /** An outbuilding of a non-toilet POI (`ToiletVariant.host`). */
  | 'facility-attached'
  /** Off-grid, in the open desert: its own water and light. */
  | 'desert-autonomous';

/**
 * The non-toilet POI an attached toilet belongs to, and where it stands on that POI's
 * plot. The toilet is an outbuilding: it stands clear of the host's authored footprint,
 * its door facing away from it (toilet-check holds both against the footprint).
 */
export interface ToiletHost {
  /** The host's id in world/poistructures.ts `POI_STRUCTURES`: a mast or a dwelling. */
  readonly structure: string;
  /** The toilet's origin in the host's frame (front at -Z, ground at y = 0), metres. */
  readonly at: readonly [number, number];
  /** About +Y from the host's frame, radians; at 0 the toilet's door faces -Z like the host's front. */
  readonly yaw: number;
}

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
  /** Scale and siting class; layouts.ts holds what each allows. */
  readonly layout: ToiletLayoutKind;
  /** Only for a `facility-attached` layout: the non-toilet POI it belongs to. */
  readonly host?: ToiletHost;
  readonly bowl: ToiletBowl;
  /** The fixtures present, in the order the gallery lists them. */
  readonly fixtures: readonly ToiletFixtureKind[];
  readonly face: ToiletFaceSpec | null;
  readonly scenario: ToiletScenarioId;
  readonly sources: readonly ToiletSourceCard[];
}
