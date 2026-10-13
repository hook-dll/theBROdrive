/**
 * A kit car, as numbers.
 *
 * FRAME: metres; `s` runs REARWARD from the front bumper's tip, `y` is up from the
 * ground the tyres stand on, `x` is the car's left. The builder turns that into the
 * game's chassis frame (+Z forward) at the end; specs never see it.
 *
 * The body is two surfaces that share one seam:
 *
 *  - the TUB: half-sections at `stations` lofted nose to tail (sill, crease, belt,
 *    shoulder, deck). Its sides are notched by the wheel arches; its deck is the bonnet
 *    and boot top, and is open over the cabin;
 *  - the GREENHOUSE: rings standing on the edge of that opening, from the belt up to
 *    the roof rail, with the roof laid over the top ring. Its side columns are the
 *    pillars and the door shut lines, slanted as the real ones are.
 *
 * Doors, bonnet, boot or tailgate and the fuel flap are cut out of those two
 * surfaces along their grid lines, so every shut line is straight and meets the next
 * one at a shared corner.
 */

import type { CabinLayoutOverride } from './interior';

/** One half-section of the tub; every value is interpolated between stations. */
export interface TubStation {
  readonly s: number;
  /** Bottom edge of the side (the sill's underside). */
  readonly sill: number;
  /** The widest line along the side. */
  readonly crease: number;
  /** Top of the side: where it turns in to the shoulder. */
  readonly belt: number;
  /** Bonnet/boot height on the centre line. Unused under the cabin. */
  readonly deck: number;
  /** Half widths at the sill, the crease and the belt. */
  readonly wSill: number;
  readonly wCrease: number;
  readonly wBelt: number;
  /**
   * 0 (default): the deck crowns from its edge to the centre line. 1: it lies level out
   * to the pillar row and rises straight to the edge there — an estate's tailgate sill.
   */
  readonly flat?: number;
  /**
   * A boot lid that comes down between two lamp corners (the 2115's): the deck lies
   * level at `deck` out to just short of this half width, rises there in a short wall to
   * the corners' top (the deck edge) and stays level out to the side. The lid is cut
   * along this line instead of the pillar row; between stations it moves linearly.
   */
  readonly notch?: number;
}

/** Who owns one strip of the greenhouse side, between a column and the next. */
export type CabinOwner = 'body' | 'door1' | 'door2';

/** The glass in one greenhouse strip. */
export type CabinGlass = 'none' | 'drop' | 'vent' | 'fixed';

export interface CabinColumn {
  /** Where the column stands at the belt. */
  readonly s: number;
  /** Where it meets the roof rail; differs from `s` for a slanted pillar. */
  readonly top: number;
  /** Owner of the strip from this column to the next, above the belt. */
  readonly upper?: CabinOwner;
  /** Owner of the same strip below the belt (doors overlap a pillar there). */
  readonly lower?: CabinOwner;
  readonly glass?: CabinGlass;
}

export interface CabinSpec {
  /**
   * Greenhouse side columns from the windscreen's base corner (the cowl) to the
   * back light's base corner. Their belt positions are also columns of the tub.
   */
  readonly columns: readonly CabinColumn[];
  /** Roof-rail height and half width (the top ring). */
  readonly rail: number;
  readonly railHalf: number;
  /** Roof crown on the centre line, above the rail. */
  readonly crown: number;
  /** The rail's chamfer onto the roof: inset across, rise up. */
  readonly railInset: number;
  readonly railRise: number;
  /** Side glass: its bottom above the belt and its top below the rail. */
  readonly glassBottom: number;
  readonly glassTop: number;
  /** Windscreen: base strip above the cowl and header below the rail. */
  readonly screenBottom: number;
  readonly screenHeader: number;
  /** Back light: base strip above the deck and header below the rail. */
  readonly rearBottom: number;
  readonly rearHeader: number;
  /**
   * A hatch's tailgate folds at a knee: glass above, a painted panel below. The knee's
   * position on the centre line; absent, the back light runs straight to its base.
   */
  readonly rearKnee?: { readonly s: number; readonly y: number };
  /** Pillar strip at the windscreen and back light edges, across the deck. */
  readonly pillar: number;
}

export interface WheelSpec {
  /** Axle positions along s. */
  readonly front: number;
  readonly rear: number;
  readonly radius: number;
  readonly width: number;
  /** Half tracks, centre of tyre. */
  readonly frontHalfTrack: number;
  readonly rearHalfTrack: number;
  /** Arch radius over the tyre radius. */
  readonly arch: number;
}

/** Everything the builder needs for one car. */
export interface KitCarSpec {
  readonly id: string;
  readonly length: number;
  readonly platform: 'classic' | 'samara';
  readonly stations: readonly TubStation[];
  readonly cabin: CabinSpec;
  readonly wheels: WheelSpec;
  /** Shoulder: the belt turns in by `inset` and up by `rise` to the deck's edge. */
  readonly shoulder: { readonly inset: number; readonly rise: number };
  /** Bottom of the doors (top of the sill below them). */
  readonly doorBottom: number;
  /** Bonnet from this s to the cowl. */
  readonly bonnetFront: number;
  /** Boot lid from the back light's base to this s; a tailgate when absent. */
  readonly bootEnd?: number;
  /**
   * The back leaning forward as one plane above `base` (m per m of height), blended in
   * over `blend` metres ahead of the rear base: an estate whose lamps lie on the slope.
   */
  readonly rearLean?: { readonly base: number; readonly lean: number; readonly blend: number };
  /** Fuel flap on a rear wing (the right one unless `side` says left): s and height ranges. */
  readonly flap: { readonly s0: number; readonly s1: number; readonly y0: number; readonly y1: number; readonly side?: 'left' | 'right' };
  readonly look: KitLook;
  /** Per-car changes to the platform's cabin layout (interior.ts `LAYOUTS`): another dash, wheel or gauges. */
  readonly cabinLayout?: CabinLayoutOverride;
}

/**
 * Everything that is styling rather than shape. The ends of the car are described as
 * lists of parts placed on the end face, so a new face is data, not code.
 */
export interface KitLook {
  readonly label: string;
  /** Interior vinyl colour. */
  readonly upholstery: number;
  readonly dash: number;
  /** Headrests on the front seats. */
  readonly headrests: boolean;
  readonly front: FaceLook;
  readonly rear: FaceLook;
  /** Door handles and mirrors. */
  readonly brightwork: Finish;
  /** A strip along the sill between the arches, or none. */
  readonly sill: Finish | null;
  /** A strip along the flank at `y`, nose to tail, broken at the shut lines; or none. */
  readonly waist: { readonly y: number; readonly height: number; readonly finish: Finish } | null;
  /** The amber side repeater on each front wing (s and y ranges), or none. */
  readonly repeater: { readonly s0: number; readonly s1: number; readonly y0: number; readonly y1: number } | null;
}

/** Surface finishes trim is made in: bright metal, black plastic, bare aluminium, rubber, or the body's paint. */
export type Finish = 'chrome' | 'black' | 'alloy' | 'rubber' | 'paint';

/** One end of the car: its bumper and what stands on its face. */
export interface FaceLook {
  readonly bumper: BumperLook;
  /** Drawn in order; later items stand on earlier ones (a lamp on its surround). */
  readonly items: readonly FaceItem[];
  /**
   * Items on the boot lid or tailgate where it comes down to the end face (the 2115's
   * lamp bar), placed on the end face like `items` but riding on the lid as it opens.
   */
  readonly lid?: readonly FaceItem[];
}

export type BumperLook =
  /** A bar on brackets, its ends turned round the corners. */
  | {
      readonly kind: 'blade';
      readonly finish: Finish;
      /** Centre height over the sill's bevel, and the bar's height. */
      readonly lift: number;
      readonly height: number;
      /** How far the bar reaches out of the face's plane at its middle. */
      readonly depth: number;
      /** The lower `share` of the bar in another finish (the 2107's black lower face). */
      readonly lower?: { readonly finish: Finish; readonly share: number };
      /** A strip along the bar's face, or none. */
      readonly strip: Finish | null;
      /** Plastic caps over the ends where they wrap round the corners. */
      readonly ends?: Finish;
      /**
       * Overriders standing on the bar, `inset` in from its end: half width and half
       * height, and how far their centre stands below the bar's.
       */
      readonly overriders: { readonly inset: number; readonly half: readonly [number, number]; readonly drop: number; readonly finish: Finish } | null;
    }
  /** A deep moulded bumper wrapping the corners, with a groove along it. */
  | {
      readonly kind: 'moulded';
      /** Its foot under the sill's bevel, and its height. */
      readonly drop: number;
      readonly height: number;
      /** Its finish (the 2115's is body colour); dark plastic when absent. */
      readonly finish?: Finish;
    };

/**
 * A height on an end face, from one of its lines plus an offset in metres:
 * `bumperTop` / `bumperBottom` (the bumper's band), `belt` (the side's top at the end
 * station), `deck` (the bonnet or boot edge there) and `mid` (halfway from the bumper's
 * top to the deck).
 */
export type FaceY = readonly [FaceAnchor, number];
export type FaceAnchor = 'bumperTop' | 'bumperBottom' | 'belt' | 'deck' | 'mid';

/** A distance across an end face: from the centre line, or in from the side. */
export type FaceX = { readonly centre: number } | { readonly inset: number };

/** A part's extent along one axis: a centre and half size, or from one line to another. */
export type Span<T> = { readonly at: T; readonly half: number } | { readonly from: T; readonly to: T };

/** What a lens does: the vehicle lights each role as one. `blinker` takes its side's role. */
export type LampRole = 'head' | 'tail' | 'brake' | 'reverse' | 'blinker' | 'inert';

/**
 * One part on an end face. Everything not on the centre line is built on both sides.
 * `proud` is how far it stands out of the face.
 */
export type FaceItem =
  /** A flat surround from one side to the other. */
  | { readonly kind: 'panel'; readonly x: FaceX; readonly y: Span<FaceY>; readonly finish: Finish; readonly proud: number }
  /** A round lamp in a chrome ring. */
  | { readonly kind: 'round'; readonly role: LampRole; readonly x: FaceX; readonly y: FaceY; readonly radius: number }
  /**
   * A lens, rectangular unless `slant`: how far its top edge's outer and inner ends stand
   * inboard of the bottom's (a trapezoid, or a parallelogram when both move).
   */
  | {
      readonly kind: 'lens';
      readonly role: LampRole;
      readonly x: Span<FaceX>;
      readonly y: Span<FaceY>;
      readonly depth: number;
      readonly proud: number;
      readonly slant?: { readonly outer: number; readonly inner: number };
    }
  /** A grille on the centre line out to `x`: an optional frame and back, and bars across it. */
  | {
      readonly kind: 'grille';
      readonly x: FaceX;
      readonly y: Span<FaceY>;
      /** The whole grille stands this far out of the face (the 2107's). */
      readonly standOut?: number;
      readonly frame?: { readonly finish: Finish; readonly margin: number };
      /** A dark plate behind the bars. */
      readonly back: boolean;
      readonly bars: {
        readonly dir: 'vertical' | 'horizontal';
        readonly count: number;
        readonly finish: Finish | 'dark';
        /** First and last bar centres stand this far in from the grille's edges. */
        readonly margin: number;
        /** Bar width across its run, and its depth out of the face from the bar's front. */
        readonly width: number;
        readonly depth: number;
        readonly proud: number;
      };
    }
  /**
   * A tail-lamp cluster in a black housing: columns of cells from the outer edge in,
   * each column's roles from the top down.
   */
  | { readonly kind: 'cluster'; readonly x: Span<FaceX>; readonly y: Span<FaceY>; readonly columns: readonly (readonly LampRole[])[] }
  /** A rectangular outline of `width` bars (a chrome surround); both sides unless centred. */
  | { readonly kind: 'frame'; readonly x: Span<FaceX>; readonly y: Span<FaceY>; readonly width: number; readonly finish: Finish; readonly proud: number };
