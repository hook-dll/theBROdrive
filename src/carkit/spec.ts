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
  /** Fuel flap on the right side: s range and height range. */
  readonly flap: { readonly s0: number; readonly s1: number; readonly y0: number; readonly y1: number };
  readonly look: KitLook;
}

/** Trim choices that are styling rather than shape. */
export interface KitLook {
  /** Chrome or black plastic bumpers. */
  readonly bumpers: 'chrome' | 'plastic';
  /** Interior vinyl colour. */
  readonly upholstery: number;
  readonly dash: number;
  /** Headlamps: round pairs (2106) or rectangular units (2108). */
  readonly headlamps: 'twin-round' | 'rect';
  /** Rear lamps: wide horizontal cluster (2106) or tall corner units (2108). */
  readonly taillamps: 'classic' | 'samara';
  /** Vent windows in the front doors. */
  readonly ventWindows: boolean;
  /** Headrests on the front seats. */
  readonly headrests: boolean;
  readonly label: string;
}
