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
  /**
   * An intended break in the side's plan at this station (a corner drawn on the real car:
   * where a nose's rounding meets a straight flank, say), with its source in a comment.
   * Changes no geometry: tools/kit-surface.ts does not flag the turn here as a dent.
   */
  readonly corner?: true;
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
  /**
   * Below the belt the shut line on this column runs upright down to height `y`, then
   * straight to `s` at the doors' bottom (the 2110's rear door, whose edge runs forward to
   * the sill in front of the rear arch). `round`: radii of its upper corner (upright to
   * slope) and lower corner (slope to the door's bottom edge). `knee`: an `[s, y]` point
   * the slope bends at on its way down, rounded by the upper radius (the Astra F's rear
   * door: quickly forward over the arch's top, then nearly upright in front of it).
   * Absent: upright.
   */
  readonly foot?: { readonly y: number; readonly s: number; readonly round?: readonly [number, number]; readonly knee?: readonly [number, number] };
  /**
   * The column's top point stands this far below the rail: one straight chamfer of the
   * rail's front corner from the A pillar up to the next column's top (the Samaras' A
   * pillar). Absent: at the rail.
   */
  readonly drop?: number;
  /**
   * Like `drop`, but the rail's edge over the point, the roof's outer rows and the end
   * glass's outer top corner come down with it: one convex chamfer of the whole corner,
   * where `drop` alone leaves the rail's strip tipped in (the tens' A pillar). Only on
   * the first or last column. Absent: none.
   */
  readonly cornerDrop?: number;
  /**
   * The glass's top edge on this column stands this far lower, the frame above it
   * widening by as much; the rail and the outer edge stay put. One chamfer of a glass
   * corner inside its frame (the tens' front door glass). Absent: the frame's own width.
   */
  readonly glassDrop?: number;
  /**
   * The glass's foot on this column stands this far higher over the belt, the frame
   * under it filling: with the next column's foot at the belt, the glass's foot slopes
   * down behind it and the frame below is the mirror's sail at the pane's front corner
   * (the Opels' and the Espero's). Absent: the belt's `glassBottom`.
   */
  readonly glassRise?: number;
  /**
   * The strip's door owner (`upper` / `lower`) on this side only; on the other side the
   * strip is the body's, with the same glass (the UAZ-2206's side door, on its right
   * alone). Absent: both sides.
   */
  readonly only?: 'left' | 'right';
  /**
   * `'black'`: the strip above the belt is black trim instead of paint, up to the rail:
   * the frame round its glass, a blacked-out pillar, the mirror's sail (the Espero's).
   * The rail's chamfer onto the roof stays painted. Absent: painted.
   */
  readonly finish?: 'black';
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
  /**
   * How the crown falls across: `crown · (1 − f^crownPower)` at fraction f of the roof's
   * half width. Default 2 (a parabola); 3 keeps the middle flatter and rolls it down
   * into the gutters (the UAZ-2206).
   */
  readonly crownPower?: number;
  /** The rail's chamfer onto the roof: inset across, rise up. */
  readonly railInset: number;
  readonly railRise: number;
  /**
   * A row along that chamfer at `[across, up]` fractions of `railInset` and `railRise` from
   * the rail, so the roof's edge turns into the side glass and the screens' headers in two
   * steps (convex with `up` > `across`). Absent: one straight chamfer.
   */
  readonly railBend?: readonly [number, number];
  /**
   * The roof's line in profile: `[s, drop]` points, nose to tail. At s everything at the
   * roof (the rail and its chamfer, the side glass's and the end glass's tops, the roof's
   * rows) stands `drop` lower, linear between the points and held beyond them. The
   * greenhouse gets a row of the roof at every point, so the roof bends there: a roof
   * rounding down into the windscreen and the back light (the Volgas', the tens').
   * Absent: level.
   */
  readonly roofDrop?: readonly (readonly [number, number])[];
  /** Side glass: its bottom above the belt and its top below the rail. */
  readonly glassBottom: number;
  readonly glassTop: number;
  /** Windscreen: base strip above the cowl and header below the rail. */
  readonly screenBottom: number;
  readonly screenHeader: number;
  /**
   * A windscreen curved in plan: how far its foot stands ahead of the cowl on the centre
   * line, fading to nothing at the corners (by 1 − frac²); the bonnet ends that far
   * forward. Absent: the screen's foot straight across at the cowl.
   */
  readonly screenFoot?: number;
  /**
   * The windscreen's top curved in plan too: how far ahead of the first column's top it
   * stands on the centre line, fading to nothing at the corners (by 1 − frac²); the roof's
   * front edge follows it (the UAZ-2206's screen). Absent: straight across at the
   * column's top.
   */
  readonly screenTop?: number;
  /** Windscreen wiper blade length (the parts catalogues: the classics 330 mm, the Samaras 510 mm, the tens 500 mm). */
  readonly wiperBlade: number;
  /**
   * Where the wiper spindles stand: `top` in the screen frame's header, the arms hanging
   * down and parked along the header (the old UAZ-469's, motor СЛ236Е "верхнее
   * расположение"). Absent: under the screen's foot.
   */
  readonly wiperMount?: 'top';
  /**
   * `1`: a single wiper, on the driver's (left-hand) spindle of the pair (the W124's
   * monowiper, its lifting sweep not drawn). Absent: the pair.
   */
  readonly wipers?: 1;
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
  /**
   * The back light as one pane each side of the centre line in a painted frame (the
   * UAZ-2206's rear doors): half widths `x0` to `x1`, heights `y0` to `y1`, corners
   * rounded by `r`. The tailgate's top runs straight across at `top`, the body above it up
   * to the roof. Replaces the glass band between `rearBottom` and `rearHeader`. Absent:
   * one pane across that band.
   */
  readonly rearPanes?: { readonly x0: number; readonly x1: number; readonly y0: number; readonly y1: number; readonly r: number; readonly top: number };
  /**
   * A canvas top (the UAZ-469's): the roof, the rail's chamfer onto it and every painted
   * greenhouse strip of the body or the tailgate behind `from` (the strip's middle at the
   * belt) are canvas in `colour`, unpainted trim; the windscreen's frame, the pillars ahead
   * of `from` and the doors' frames stay painted. The sun visors hang from the windscreen
   * frame's header bar, not under the roof (interior.ts `headliner`). Absent: all painted.
   */
  readonly softTop?: { readonly colour: number; readonly from: number };
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
  /**
   * The rear arch's radius over the tyre radius where it differs from the front's (the
   * 2110's rear arch hugs the tyre); absent, the rear takes `arch`.
   */
  readonly rearArch?: number;
  /**
   * The rear arch's top over the hub, over the tyre radius, where it is lower than a
   * circle: the arch's outline becomes a half ellipse `rearArch` wide and this high (the
   * 2110's rear arch covers the tyre's top). Absent: a circle. Only the skin's arch and
   * its liner follow it; the wells and humps inside keep the circle, clear of the tyre.
   */
  readonly rearArchRise?: number;
  /**
   * Both arches' skin outlines as superellipses of this power instead of circles (or the
   * rear's half ellipse): flatter tops and steeper sides, the UAZ-2206's square-cut arches.
   * Absent: round.
   */
  readonly archSquare?: number;
  /**
   * Where each arch is centred off its hub, front and rear (negative ahead): an arch
   * reaching further ahead of the wheel than behind it. Absent: on the hubs.
   */
  readonly archShift?: readonly [number, number];
  /**
   * The arches' ends stop at the sill: where the sill stands above the hub (the UAZes'
   * high bodies), the skin's arch edge and the wheel well's wall never run below the sill
   * line, instead of down to the hub's height as a skirt beside the tyre. Absent: the arch
   * edge as `archY` gives it, the well's wall fanned down to the sill or the hub.
   */
  readonly archToSill?: boolean;
}

/** Everything the builder needs for one car. */
export interface KitCarSpec {
  readonly id: string;
  readonly length: number;
  /**
   * Picks the interior layout (interior.ts `LAYOUTS`) and the bay and underbody (bay.ts).
   * `'niva'`: the classic's longitudinal engine and cabin with permanent four-wheel drive
   * (transfer box, front axle) and its own dash. `'van'`: forward control, the cab over
   * the front axle and the engine under a cover between the front seats, no engine bay
   * ahead of the screen, a high flat floor from the dash to the rear doors, four-wheel
   * drive under it (the UAZ-2206).
   */
  readonly platform: 'classic' | 'samara' | 'niva' | 'van';
  readonly stations: readonly TubStation[];
  readonly cabin: CabinSpec;
  readonly wheels: WheelSpec;
  /** Shoulder: the belt turns in by `inset` and up by `rise` to the deck's edge. */
  readonly shoulder: { readonly inset: number; readonly rise: number };
  /** Bottom of the doors (top of the sill below them). */
  readonly doorBottom: number;
  /** Bonnet from this s to the cowl. */
  readonly bonnetFront: number;
  /**
   * A bonnet whose side cut stands `inset` in from the deck's edge (the 2110's runs along
   * the top of the wings, almost at the edge) instead of at the pillar row; it ends
   * `SCUTTLE` short of the cowl, or at `rear`, a scuttle deck left between it and the
   * windscreen (the UAZ-469's). `nose`: the bonnet comes down the front face between the
   * head lamps to height `y`, its half width `half` at the bottom and at the top; its
   * front face items hang on it (`FaceLook.lid`). Absent: the pillar-row bonnet.
   */
  readonly bonnet?: { readonly inset: number; readonly rear?: number; readonly nose?: { readonly y: number; readonly half: readonly [number, number] } };
  /** Boot lid from the back light's base to this s; a tailgate when absent. */
  readonly bootEnd?: number;
  /**
   * The silencer's top and the tail pipe this far under the floor (the shell's underside
   * over their run) instead of at the clearance: a body standing high over its axles (the
   * UAZs', floor 0.42-0.56 over a 0.22 clearance), where a silencer at the clearance hangs
   * a hand's width under the tail. The pipe runs under the rear axle as before and climbs
   * behind it. Absent: the silencer SILENCER_TUCK over the clearance (bay.ts `exhaust`).
   */
  readonly exhaustTuck?: number;
  /**
   * A tailgate hinged upright at its left or right edge (a rear door, the UAZ-469's on its
   * right), opening sideways; `'split'`: two leaves cut on the centre line, each hinged at
   * its outer edge (`tailgate_l`, `tailgate_r`: the UAZ-2206's rear doors). Absent: hinged
   * at the roof.
   */
  readonly tailgateHinge?: 'left' | 'right' | 'split';
  /**
   * The back leaning forward as one plane above `base` (m per m of height), blended in
   * over `blend` metres ahead of the rear base: an estate whose lamps lie on the slope.
   */
  readonly rearLean?: { readonly base: number; readonly lean: number; readonly blend: number };
  /**
   * The front face leaning back as one plane above `base` (m per m of height), in full
   * ahead of `full` (default the bonnet's front edge) and blended out over `blend` metres
   * behind it: a nose whose lamps and face rake back from the bumper to the bonnet's lip
   * (the Samaras', the tens'). Corner lamps must lie where it is in full, so they lean
   * with the body's faces exactly; `base` on a row of the face (its crease) for the same.
   */
  readonly frontLean?: { readonly base: number; readonly lean: number; readonly blend: number; readonly full?: number };
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
  /** The dash's colour; on a `dashPainted` car only its knobs and louvres are shaded from it. */
  readonly dash: number;
  /**
   * A painted steel dash: its body, the instrument plate and the glovebox lid are drawn in
   * the paint slot (interior.ts `dashSurface`), so they take the car's own colour and wear.
   */
  readonly dashPainted?: boolean;
  /** Headrests on the front seats. */
  readonly headrests: boolean;
  readonly front: FaceLook;
  readonly rear: FaceLook;
  /** Door handles and mirrors (the mirrors in `mirrorFinish` when given). */
  readonly brightwork: Finish;
  /**
   * The door mirrors' finish when it differs from the handles' (the W124's body-colour
   * mirrors with chrome handles). Absent: `brightwork`.
   */
  readonly mirrorFinish?: Finish;
  /**
   * The grey (0..1, in display terms) the paint is multiplied by on parts in the `'tone'`
   * finish: a darker tone of the body colour that follows the car's paint (the W124's
   * cladding and bumpers). Required when any part is in `'tone'`.
   */
  readonly tone?: number;
  /** Door mirrors: `'left'` only the driver's (the base Oka). Absent: both. */
  readonly mirrors?: 'left';
  /**
   * Door mirrors on an upright stalk: the head this much higher than on the short arm at
   * the door's top and 3.5 cm further back, the stalk rising to it from a bracket on the
   * door's skin under the belt at its front edge (the UAZ-469). Absent: the short arm.
   */
  readonly mirrorStalk?: number;
  /**
   * Centre s of the door mirrors' heads, when measured: on a black sail at the side
   * glass's front foot (the Espero, the Opels), so the driver sees them through the glass.
   * Absent: 8 cm behind the front door frame's first column.
   */
  readonly mirrorS?: number;
  /**
   * Vertical correction for a measured mirror head whose centre is below the generic
   * belt-relative placement. Positive is up; absent is zero.
   */
  readonly mirrorHeightOffset?: number;
  /**
   * How far the door mirror's head centre stands out from the door's skin at the belt,
   * when measured (the GAZ-24's drawn 0.04). Absent: 0.1.
   */
  readonly mirrorReach?: number;
  /**
   * Where the outside door handles stand, when measured: the centre s of the front doors'
   * and of the rear (side) doors' handle, their height and half length along the car.
   * Absent: 0.13 ahead of each door's rear edge, under the belt.
   */
  readonly handles?: { readonly front: number; readonly rear: number; readonly y: number; readonly half: number };
  /**
   * Outside fittings on a split tailgate's leaves (`tailgateHinge: 'split'`): hinge straps
   * across each leaf's outer shut line, in body colour, from ±x0 out to ±x1, one per [y0,
   * y1] band; and one handle (`brightwork`) on the `leaf`, from ±x0 to ±x1 at height y.
   */
  readonly rearLeaves?: {
    readonly hinges: { readonly x0: number; readonly x1: number; readonly bands: readonly (readonly [number, number])[] };
    readonly handle: { readonly leaf: 'left' | 'right'; readonly x0: number; readonly x1: number; readonly y: number };
  };
  /** A strip along the sill between the arches, or none. */
  readonly sill: Finish | null;
  /**
   * A strip along the flank at `y`, nose to tail, broken at the shut lines and where it
   * meets a wheel arch; or none.
   */
  readonly waist: {
    readonly y: number;
    readonly height: number;
    readonly finish: Finish;
    /** Where it starts and ends along the car, when not nose to tail (the Opels' strips run along the doors only). */
    readonly span?: readonly [s0: number, s1: number];
  } | null;
  /**
   * Side cladding: a panel on each flank from the sill up to `top`, standing `proud` off
   * the skin (default 6 mm), from `span[0]` to `span[1]` (default nose to tail), broken at
   * the shut lines and stopping short of the wheel arches like the waist, each piece on
   * the panel whose skin it lies on (the W124's "Sacco boards"). `edge`: a bright strip
   * of that finish and `height` along its top (the W124's chrome line, in line with its
   * bumpers' `moulding.edge`).
   */
  readonly cladding?: {
    readonly top: number;
    readonly finish: Finish;
    readonly proud?: number;
    readonly span?: readonly [s0: number, s1: number];
    readonly edge?: { readonly finish: Finish; readonly height: number };
  };
  /** The amber side repeater on each front wing (s and y ranges), or none. */
  readonly repeater: { readonly s0: number; readonly s1: number; readonly y0: number; readonly y1: number } | null;
  /** A body-colour wing on the boot lid or tailgate with the high brake lamp, or none. */
  readonly spoiler?: SpoilerLook;
  /**
   * Lamp units wrapping round the corners of the front or tail face onto the flanks, flush
   * with the body (the 2110's and 2115's head lamps and indicators, and their tail lamps).
   */
  readonly cornerLamps?: readonly CornerLamp[];
  /**
   * A pressed feature line along the flank: a narrow painted ridge through `points`
   * ([s, y], linear between), broken at the shut lines like the waist (the 2110's line
   * under the windows).
   */
  readonly featureLine?: { readonly points: readonly (readonly [number, number])[]; readonly height: number };
}

/**
 * A lamp unit on an end face wrapping round the body's corner onto each flank
 * (`KitLook.cornerLamps`), lying flush on the surface: points from its inner end on the
 * face round the corner to its end on the flank. A point is on the face at half width `x`
 * ([bottom, top] for a leaning edge), on the flank at `s` (car frame), or, with neither,
 * on the corner itself (the face's edge); `y` its bottom and top there, straight between
 * points. The stretch after a point is a lens in its `role`'s slot. `end` is the face it
 * starts on, the front (default) or the tail; lamps stacked one over another are separate
 * units.
 */
export interface CornerLamp {
  readonly end?: 'front' | 'rear';
  readonly points: readonly CornerLampPoint[];
  /**
   * Ribbed lens (the Mercedes' self-cleaning ribs): this many darker horizontal lines
   * across it at equal steps, in the lens's own slot, flat (no relief). Absent: a plain lens.
   */
  readonly ribs?: number;
}

export interface CornerLampPoint {
  readonly x?: number | readonly [number, number];
  readonly s?: number;
  readonly y: readonly [number, number];
  /** The lens from this point to the next; absent on the last point. */
  readonly role?: LampRole;
}

/**
 * A spoiler (the 2115's on its boot lid, the 2112's on its tailgate glass), hung on the
 * lid so it lifts with it: a wing whose ends come down to the lid as end plates running
 * forward, and a pedestal under its middle carrying the high-mounted brake lamp on its
 * back. `s` in the car's frame (as `repeater`), heights above the ground.
 */
export interface SpoilerLook {
  /** Half span, and the width of each end plate inside it. */
  readonly half: number;
  readonly plate: number;
  /** The wing's leading and trailing edges, and its top at each. */
  readonly s0: number;
  readonly s1: number;
  readonly top0: number;
  readonly top1: number;
  readonly thickness: number;
  /** Where the end plates' lower edge meets the lid, ahead of the wing. */
  readonly foot: number;
  /**
   * The pedestal under the wing's middle (half width, s from its front to its back) and
   * the brake lamp's lens on its back (half width, bottom and top heights).
   */
  readonly pedestal: { readonly half: number; readonly s0: number; readonly s1: number };
  readonly lamp: { readonly half: number; readonly y0: number; readonly y1: number };
}

/**
 * Surface finishes trim is made in: bright metal, black plastic, bare aluminium, rubber,
 * unpainted grey plastic (the 2115's mouldings), the body's paint, or a darker tone of it
 * (`tone`: the paint times `KitLook.tone`, the W124's cladding and bumpers).
 */
export type Finish = 'chrome' | 'black' | 'alloy' | 'rubber' | 'grey' | 'paint' | 'tone';

/** One end of the car: its bumper and what stands on its face. */
export interface FaceLook {
  readonly bumper: BumperLook;
  /** Drawn in order; later items stand on earlier ones (a lamp on its surround). */
  readonly items: readonly FaceItem[];
  /**
   * Items on a part that comes down to the end face, placed on the end face like `items`
   * but riding on that part as it opens: at the tail the boot lid or tailgate (the 2115's
   * lamp bar), at the nose the bonnet's nose (the 2110's slot).
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
       * How far its ends run back along the flanks from the bar's face, hugging the
       * wings (the Volgas' long wrapped blades). Absent: a short 0.16 return off the corner.
       */
      readonly wrap?: number;
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
      /**
       * A moulding band round it instead of the groove: centre height above the ground,
       * height and finish (the 2115's grey band, in line with its door mouldings). `edge`: a
       * bright strip of that finish and `height` along the band's top, following it round
       * the corners and along `wrapTo` (the W124's chrome line over its black band).
       */
      readonly moulding?: {
        readonly y: number;
        readonly height: number;
        readonly finish: Finish;
        readonly edge?: { readonly finish: Finish; readonly height: number };
      };
      /**
       * Plan radius of its corners where they turn round to the flanks (the 2110's
       * rounded front bumper); absent, 0.09 as on the other cars.
       */
      readonly corner?: number;
      /**
       * Its sides follow the flanks back to this `s` (car frame), flush with the body, its
       * bottom in one line with the sill behind (the 2110's front bumper, running back to
       * the wheel arch). Absent: a short wrap standing off the corner.
       */
      readonly wrapTo?: number;
      /**
       * The bumper continues the body: its top runs out of the end face and the flanks
       * with no ledge, rounding out to its face below (the 2110's and 2112's). Absent: a
       * flat top standing out of the face.
       */
      readonly flush?: boolean;
      /**
       * Pieces laid on its face and following it round the corners, 6 mm proud with the
       * face cut under them (as the moulding): fog lamps and an intake band low on a bumper
       * whose face curves back towards its ends, where a flat face item would sink in at
       * one end and stand out at the other (the Astra F's). `x`: half widths [inner,
       * outer] of each side's piece, or inner 0 for one piece across the centre line; `y`:
       * heights over the bumper's foot, within its upright face (0.08 to 0.05 under its
       * top); the inlay's finish.
       */
      readonly inlays?: readonly { readonly x: readonly [number, number]; readonly y: readonly [number, number]; readonly finish: Finish }[];
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
  /**
   * A flat surround: from one side to the other when `x` is a distance from the centre
   * line, or a pair of blocks (one each side) when `x` is a span.
   */
  | { readonly kind: 'panel'; readonly x: FaceX | Span<FaceX>; readonly y: Span<FaceY>; readonly finish: Finish; readonly proud: number }
  /** A round lamp in a chrome ring. */
  | { readonly kind: 'round'; readonly role: LampRole; readonly x: FaceX; readonly y: FaceY; readonly radius: number }
  /**
   * A lens, rectangular unless `slant`: how far its top edge's outer and inner ends stand
   * inboard of the bottom's (a trapezoid, or a parallelogram when both move; negative
   * leans out).
   */
  | {
      readonly kind: 'lens';
      readonly role: LampRole;
      readonly x: Span<FaceX>;
      readonly y: Span<FaceY>;
      readonly depth: number;
      readonly proud: number;
      readonly slant?: { readonly outer: number; readonly inner: number };
      /** On this side only (+x the car's left): a single lamp, the UAZ-2206's reversing lamp on its left rear door. Absent: both sides. */
      readonly only?: 'left' | 'right';
    }
  /** A grille on the centre line out to `x`: an optional frame and back, and bars across it. */
  | {
      readonly kind: 'grille';
      readonly x: FaceX;
      readonly y: Span<FaceY>;
      /**
       * The whole grille stands this far out of the face (the 2107's). In a moulded
       * bumper (an intake) its front stands at least 10 mm ahead of the bumper's.
       */
      readonly standOut?: number;
      readonly frame?: { readonly finish: Finish; readonly margin: number };
      /**
       * A trapezoid: the top's ends this far inboard of the bottom's (the UAZ-2206's), the
       * frame raised round a recessed back. Absent: a rectangle.
       */
      readonly slant?: number;
      /** A dark plate behind the bars. */
      readonly back: boolean;
      readonly bars: {
        /** `'diamond'`: two crossed sets at ±45°, a mesh (slanted grilles only). */
        readonly dir: 'vertical' | 'horizontal' | 'diamond';
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
   * A tail-lamp cluster straight on the body (no housing): columns of cells from the outer edge in,
   * each column's roles from the top down. The cells tile the span with no seam, rooted
   * in the face; only the unit's outer walls are drawn.
   */
  | { readonly kind: 'cluster'; readonly x: Span<FaceX>; readonly y: Span<FaceY>; readonly columns: readonly (readonly LampRole[])[] }
  /** A rectangular outline of `width` bars (a chrome surround); both sides unless centred. */
  | { readonly kind: 'frame'; readonly x: Span<FaceX>; readonly y: Span<FaceY>; readonly width: number; readonly finish: Finish; readonly proud: number }
  /**
   * A spare wheel in a cover, upright on the face on a bracket: its back `standoff` out of
   * the face, `width` deep. One wheel at `x` (signed: + is the car's left), not a pair. As
   * a tail `lid` item it rides on the tailgate (the UAZ-469's, on its rear door).
   */
  | { readonly kind: 'wheel'; readonly x: number; readonly y: FaceY; readonly radius: number; readonly width: number; readonly standoff: number; readonly finish: Finish };
