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
   * With `notch`: the width of the wall the deck rises in, so the lid's side edge on the
   * tail face runs from the notch at the corners' top in by this much to its foot (the
   * W124's lid between its trapezoid lamps). Absent: 25 mm (`NOTCH_WALL`).
   */
  readonly notchWall?: number;
  /**
   * An intended break in the side's plan at this station (a corner drawn on the real car:
   * where a nose's rounding meets a straight flank, say), with its source in a comment.
   * Changes no geometry: tools/kit-surface.ts does not flag the turn here as a dent.
   */
  readonly corner?: true;
  /**
   * This station's shoulder instead of the car's `shoulder` (moving linearly to the
   * neighbours' own or the car's): a steeper turn from the belt to the deck's edge where a
   * wing's top rounds over into the boot lid (the W124's tail corners). Absent: the car's.
   */
  readonly shoulder?: { readonly inset: number; readonly rise: number };
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
   * The door's frame over the glass is this wide on the strip from this column to the
   * next; the rest up to the rail is the body's. A door cut along its glass's chamfered
   * top (the E34's rear door round the Hofmeister kink), where the painted corner above
   * the chamfer is the C pillar. On a body strip it splits the band at the same line, for
   * the door strip ending on this column to share its corner. Absent: the door's up to the rail.
   */
  readonly frameCut?: number;
  /**
   * The strip's door owner (`upper` / `lower`) on this side only; on the other side the
   * strip is the body's, with the same glass (the UAZ-2206's side door, on its right
   * alone). Absent: both sides.
   */
  readonly only?: 'left' | 'right';
  /**
   * `'black'`: the strip above the belt is black trim instead of paint, up to the rail:
   * the frame round its glass, a blacked-out pillar, the mirror's sail (the Espero's).
   * `'chrome'`: the same strip bright (the W124's divider before its rear quarter glass).
   * The rail's chamfer onto the roof stays painted. Absent: painted.
   */
  readonly finish?: 'black' | 'chrome';
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
  /**
   * The windscreen wraps round its corners onto the sides (the ZIL-130's): the corner
   * between the screen's outer edge and the first column is glass, so with the first
   * column's `glass: 'fixed'` one pane runs from the screen round the corner to the next
   * painted strip (the door's frame), no painted post at the corner. Absent: a painted
   * corner post.
   */
  readonly screenWrap?: true;
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
   * The back light's top edge straight across, a plain trapezoid from behind (the W124):
   * every top corner of the glass at the outer one's height, `rearHeader` under the roof's
   * edge at the outer corner; the header over the glass deepens towards the centre line as
   * the roof's crown rises. Absent: the glass's top follows the crown, `rearHeader` under
   * the roof's edge all across.
   */
  readonly rearTopLevel?: true;
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
   * The front arch's top over the hub, over the tyre radius, where it differs from a
   * circle: its outline becomes a half ellipse `arch` wide and this high, as `rearArchRise`
   * for the rear (the W124's front arch, higher than it is wide: close round the tyre's
   * sides, clear over its top). Absent: a circle.
   */
  readonly frontArchRise?: number;
  /**
   * Both arches' skin outlines as superellipses of this power instead of circles (or the
   * rear's half ellipse): flatter tops and steeper sides, the UAZ-2206's square-cut arches.
   * Absent: round.
   */
  readonly archSquare?: number;
  /**
   * The rear arch's superellipse power where it differs from `archSquare` (the Oka's rear
   * arch, flat-topped over a round front one). Absent: `archSquare`.
   */
  readonly rearArchSquare?: number;
  /**
   * Where each arch is centred off its hub, front and rear (negative ahead): an arch
   * reaching further ahead of the wheel than behind it. Absent: on the hubs.
   */
  readonly archShift?: readonly [number, number];
  /**
   * Segments round each arch (tub columns, spaced evenly in angle). Absent: 12. Fewer on
   * a car whose triangle count is tight (the W124's 8: a 7 mm chord on its 0.34 arch).
   */
  readonly archSegments?: number;
  /**
   * The arches' ends stop at the sill: where the sill stands above the hub (the UAZes'
   * high bodies), the skin's arch edge and the wheel well's wall never run below the sill
   * line, instead of down to the hub's height as a skirt beside the tyre. Absent: the arch
   * edge as `archY` gives it, the well's wall fanned down to the sill or the hub.
   */
  readonly archToSill?: boolean;
  /**
   * The wheels stand clear of the shell: a truck's cab sits between its axles and the
   * wings carry the front arches (`TruckSpec.wings`). The shell cuts no arch and builds no
   * wells, `archY` finds none; `arch`, `frontArchRise` and `archShift` then shape the
   * wings' arches instead. Absent: the shell's arches.
   */
  readonly outside?: true;
  /**
   * Dual rear wheels: each rear `kit_wheel_*` node stands at the pair's centre (the
   * physics' one wheel) and its placeholder draws two tyres this far apart, centre to
   * centre (the ZIL-130's twins). Absent: one tyre.
   */
  readonly twinRear?: number;
  /** The steel disc's bead radius (a 20-inch truck rim 0.254). Absent: 0.62 of the tyre's radius. */
  readonly rimRadius?: number;
}

/**
 * One end of the car leaning (`rearLean`, `frontLean`): above `base` every point moves
 * towards the car's middle by `lean` m per m of height (negative: outwards). `peak` bends
 * the end once more: above `peak.y` the offset goes on from the value reached there at
 * `peak.lean` per metre — a nose or tail whose foremost (rearmost) point is a crease, the
 * face below it and the lip above both running in (GAZ-24: `lean` < 0, `peak.lean` > 0),
 * or a shark nose. Every part is cut at `peak.y`, so nothing spans the bend. `full`: the
 * s from which outwards the lean is in full (front default `bonnetFront`, rear default
 * the rear base, the cabin's last column).
 */
export interface EndLean {
  readonly base: number;
  readonly lean: number;
  readonly blend: number;
  readonly full?: number;
  readonly peak?: { readonly y: number; readonly lean: number };
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
   * drive under it (the UAZ-2206). `'truck'`: a bonneted truck (the ZIL-130); the shell is
   * its cab alone (stations and greenhouse), standing on a ladder frame between the axles
   * (`wheels.outside`); bonnet, wings, front, chassis, bay and platform are `truck`'s
   * (truck.ts), the cab's furniture a bench across it.
   */
  readonly platform: 'classic' | 'samara' | 'niva' | 'van' | 'truck';
  readonly stations: readonly TubStation[];
  readonly cabin: CabinSpec;
  readonly wheels: WheelSpec;
  /**
   * Shoulder: the belt turns in by `inset` and up by `rise` to the deck's edge. `convex`:
   * a twisted shoulder quad (where the stations' own `shoulder`s change it, the W124's tail
   * corners) is cut on the diagonal that folds it outward. Absent: one face, fanned by the
   * builder, so the two sides fold on mirrored diagonals and one of them in (a dent).
   */
  readonly shoulder: { readonly inset: number; readonly rise: number; readonly convex?: true };
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
  /**
   * Two soft ribs along the bonnet, one each side: the deck's middle row runs from half
   * width `from[1]` at s `from[0]` to `to[1]` at `to[0]`, and the deck between them stands
   * `rise` over the crown, falling to the bonnet's cut outside (body.ts `ribRise`): the
   * E34's raised middle. Needs `bonnet`. Absent: the middle row halves the bonnet, on the crown.
   */
  readonly bonnetRib?: { readonly from: readonly [number, number]; readonly to: readonly [number, number]; readonly rise: number };
  /** Boot lid from the back light's base to this s; a tailgate when absent. */
  readonly bootEnd?: number;
  /**
   * `false`: no fuel tank standing on the boot's right shelf (a classic-platform saloon
   * whose tank lies under the floor, the E34's). Absent: the classic's tank in the boot.
   */
  readonly bootTank?: false;
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
   * `peak` bends it once more (see `EndLean`).
   */
  readonly rearLean?: EndLean;
  /**
   * The front face leaning back as one plane above `base` (m per m of height), in full
   * ahead of `full` (default the bonnet's front edge) and blended out over `blend` metres
   * behind it: a nose whose lamps and face rake back from the bumper to the bonnet's lip
   * (the Samaras', the tens'). Corner lamps must lie where it is in full, so they lean
   * with the body's faces exactly; `base` on a row of the face (its crease) for the same.
   * `peak` bends it once more (see `EndLean`).
   */
  readonly frontLean?: EndLean;
  /**
   * Fuel flap on a rear wing (the right one unless `side` says left): s and height ranges.
   * `cup`: how far inside the skin the filler cup's back lies (exterior.ts `buildFiller`;
   * 0.035 when absent, the flap's own thickness). On a flank upright at the flap the closed
   * flap's inner skin lies at that depth too, and the cup's back fights it seen through the
   * glass from the far side: such a car sets a deeper cup. Absent: no flap in the shell
   * (a truck's tank stands on its frame, `TruckSpec.tank`).
   */
  readonly flap?: { readonly s0: number; readonly s1: number; readonly y0: number; readonly y1: number; readonly side?: 'left' | 'right'; readonly cup?: number };
  readonly look: KitLook;
  /** Per-car changes to the platform's cabin layout (interior.ts `LAYOUTS`): another dash, wheel or gauges. */
  readonly cabinLayout?: CabinLayoutOverride;
  /** Everything of a `'truck'` platform's but its cab (truck.ts); required there, absent on every car. */
  readonly truck?: TruckSpec;
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
   * Mirrors on tubular arms from the body instead of on the doors (the ZIL-130's): two
   * tubes, from `root` and `brace` on the side (s, height; on the skin there), converge on
   * the head's centre at `head` (s, height, half width); the head `half` wide and high. On
   * the body, not the door: they stay as the door opens. Absent: door mirrors
   * (`mirrorStalk`, `mirrorMount`).
   */
  readonly mirrorArm?: {
    readonly root: readonly [s: number, y: number];
    readonly brace: readonly [s: number, y: number];
    readonly head: readonly [s: number, y: number, x: number];
    readonly half: readonly [number, number];
  };
  /**
   * Door mirrors on an upright stalk: the head this much higher than on the short arm at
   * the door's top and 3.5 cm further back, the stalk rising to it from a bracket on the
   * door's skin under the belt at its front edge (the UAZ-469). Absent: the short arm.
   */
  readonly mirrorStalk?: number;
  /**
   * `'base'`: the head on a short thick neck straight out of a black base on the door's
   * skin at the glass's front foot, straddling the belt, the head's centre 7 cm over the
   * belt (the E34's). Absent: the short arm (or `mirrorStalk`).
   */
  readonly mirrorMount?: 'base';
  /** The head's half width and half height, when measured. Absent: 0.06 × 0.045. */
  readonly mirrorHead?: readonly [number, number];
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
   * `grip`: the handle is a thin bar (1.6 cm tall) over a black recess with the pull
   * lever's bright lip at its foot, `half` its half length and `drop` the lip's foot under
   * the bar's centre (the W124's). Absent: the bar alone, as before.
   */
  readonly handles?: {
    readonly front: number;
    readonly rear: number;
    readonly y: number;
    readonly half: number;
    readonly grip?: { readonly half: number; readonly drop: number };
  };
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
  /**
   * `null`: no bumper on this end face (a truck's cab, whose faces stand under its bonnet
   * and against its platform; the truck's own bumper is `TruckSpec.bumper`). Items then
   * take the bumper's anchors at the face's sill.
   */
  readonly bumper: BumperLook | null;
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
       * the wheel arch). `'arch'`: back to the wheel arch's edge at every height, so its
       * end is the arch's front (rear) edge (the Oka's plastic bumpers). Absent: a short
       * wrap standing off the corner.
       */
      readonly wrapTo?: number | 'arch';
      /**
       * Its face upright down to height `y`, then straight back by `back` m to its bottom
       * edge (the W124's apron under its band), at most to the end face; that drawn-back
       * apron in `finish` (the E34's black valance tucked under its rear bumper), absent the
       * bumper's own. Absent: the face drawn in only at its foot's bevel.
       */
      readonly foot?: { readonly y: number; readonly back: number; readonly finish?: Finish };
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
   * line, or a pair of blocks (one each side) when `x` is a span. `on`: laid on a part
   * standing this far out of the face (a slat on a lamp band, a strip on a lens) instead
   * of rooted in the face: from `on` to `proud`, no back, cutting nothing and no hole in
   * the shell, so neither its host nor the face is cut up round it.
   */
  | { readonly kind: 'panel'; readonly x: FaceX | Span<FaceX>; readonly y: Span<FaceY>; readonly finish: Finish; readonly proud: number; readonly on?: number }
  /**
   * A round lamp in a ring: chrome, or `ring` (the E34's black rings). `standOut`: the
   * ring's front this far out of the face, the lens 7 mm ahead of it (the E34's lamps flush
   * in their band). Absent: the ring 26 mm out, the lens 8 mm ahead of it.
   */
  | { readonly kind: 'round'; readonly role: LampRole; readonly x: FaceX; readonly y: FaceY; readonly radius: number; readonly ring?: Finish; readonly standOut?: number }
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

/**
 * A bonneted truck's everything but its cab (`platform: 'truck'`, truck.ts): chassis,
 * bonnet, wings, front, bay and the load platform. The car's frame of reference: `s` back
 * from the front bumper's face, heights over the ground, `x` half widths (built on both
 * sides unless a field says which).
 */
export interface TruckSpec {
  /**
   * Ladder frame: two channel rails `depth` tall, their outer faces `half` off the centre
   * line, flanges `flange` wide, from `s0` to `s1`, their top at `top` [at s0, at s1]
   * (straight between); a cross member at every `cross` s.
   */
  readonly frame: {
    readonly s0: number;
    readonly s1: number;
    readonly half: number;
    readonly depth: number;
    readonly flange: number;
    readonly top: readonly [number, number];
    readonly cross: readonly number[];
  };
  /** Leaf springs under the rails, [s0, s1] at each axle. */
  readonly springs: { readonly front: readonly [number, number]; readonly rear: readonly [number, number] };
  /**
   * The bonnet, hinged at its rear edge (`s1`, the top there): the centre line's top at
   * `top` ([s, y] from the nose's tip at `s0`), its sides upright from the lower edge
   * `edge` (the wings' top line), `half` wide [at s0, at s1], rolling `roll` (across, down)
   * from the side's top into the crown; louvres on each side (`louvres`: s and height
   * ranges, count).
   */
  readonly bonnet: {
    readonly s0: number;
    readonly s1: number;
    readonly top: readonly (readonly [number, number])[];
    readonly edge: number;
    readonly half: readonly [number, number];
    readonly roll: readonly [number, number];
    readonly louvres: { readonly s: readonly [number, number]; readonly y: readonly [number, number]; readonly count: number };
  };
  /**
   * The front wings, each a pressed panel from the face (`s0`) back to the cab's door
   * (`s1`): the top from the bonnet's lower edge out, rolling down at `brow` into the
   * flank `outer` off the centre line (narrowing to `nose` at `s0` over the first `taper`
   * metres), the flank down to `bottom` [front, rear]; the arch is the wheels' (`arch`,
   * `frontArchRise`, `archShift`). Behind the bonnet the top meets the cab's side at
   * `cab`. An amber repeater on each flank at `repeater` (s, height, radius).
   */
  readonly wings: {
    readonly s0: number;
    readonly s1: number;
    readonly outer: number;
    readonly nose: number;
    readonly taper: number;
    readonly brow: number;
    readonly bottom: readonly [number, number];
    readonly cab: number;
    readonly repeater: readonly [s: number, y: number, r: number];
  };
  /**
   * The face between the wings [P; owner, 2026-10-28]: a rounded nose between two flat
   * cheeks. The cheeks stand at `s`, out to `half`, from `y[0]` to `y[1]`, their top outer
   * corners rounded `corner`, in the face's `colour` (the late ZIL's white); each holds a
   * round head lamp and the indicator over it (x, height, lens radius) in black rings, in
   * one sunken pocket filling the cheek. The nose (`nose`: half width, how far its middle
   * stands out, the radius its top and bottom roll back on) is one arc in plan from cheek
   * to cheek; on it the `grille` block (heights, half width) swells as a rounded box by its
   * `proud`. The `slots` (each row: heights, half width of the row, count and the gap
   * between slots, or one opening `count` 1) are recesses in the nose. The cheeks' white
   * runs on round the wings' rounded noses to their flanks (`wrap`).
   */
  readonly face: {
    readonly s: number;
    readonly half: number;
    readonly y: readonly [number, number];
    readonly corner: number;
    readonly colour: number;
    readonly slots: readonly { readonly y: readonly [number, number]; readonly half: number; readonly count: number; readonly gap: number }[];
    readonly nose: { readonly half: number; readonly proud: number; readonly round: number };
    readonly grille: { readonly y: readonly [number, number]; readonly half: number; readonly proud: number };
    readonly head: readonly [x: number, y: number, r: number];
    readonly blinker: readonly [x: number, y: number, r: number];
  };
  /**
   * A black steel channel across the front: its face at s 0, `depth` deep, `half` wide,
   * heights `y`, its front corners rounded in plan and its front edges rolled (truck.ts
   * `BUMPER_CORNER`, `BUMPER_ROLL`); tow hooks on its top at ±`hooks`.
   */
  readonly bumper: { readonly depth: number; readonly half: number; readonly y: readonly [number, number]; readonly hooks: number };
  /**
   * On the cab: three amber marker lamps on the roof's front (`markers`: s, x of the outer
   * pair); a step under each door (s range, tread height, outer half width).
   */
  readonly cab: {
    readonly markers: readonly [s: number, x: number];
    readonly step: { readonly s: readonly [number, number]; readonly y: number; readonly out: number };
  };
  /**
   * The fuel tank outside the left rail: s range, heights, outer half width; its filler
   * on the top at `cap` (s, x): a neck with a cap hinged at its outer edge, opened as a
   * car's flap (channel `flap`), over the `KIT_FILLER_NODE` box a can pours into.
   */
  readonly tank: { readonly s: readonly [number, number]; readonly y: readonly [number, number]; readonly out: number; readonly cap: readonly [s: number, x: number] };
  /**
   * A toolbox under the platform's front on the left, between the frame and the side
   * beam: s range, heights (its top sunk into the floor), inner half width; its face
   * stands out of the side beam to the platform's edge.
   */
  readonly toolbox: { readonly s: readonly [number, number]; readonly y: readonly [number, number]; readonly inner: number };
  /** The silencer inside the right rail (s range) and the tail pipe's exit (s), turned out ahead of the rear wheels. */
  readonly exhaust: { readonly silencer: readonly [number, number]; readonly tail: number };
  /**
   * The load platform: from the front board's face `s0` to the tail board's back `s1`,
   * its floor's top `floor`, `half` wide outside (the boards' hinges), boards `side` tall
   * over the floor with `ribs` pressed ribs along them; under the floor a dark steel
   * beam round its edge, `beam` deep from the floor's top, on two sills over the rails;
   * the front board fixed, the two side boards and the tail board dropping about their
   * bottom edges (`board_l`, `board_r`, `board_tail`).
   */
  readonly platform: { readonly s0: number; readonly s1: number; readonly floor: number; readonly beam: number; readonly half: number; readonly inside: number; readonly side: number; readonly ribs: number };
  /** Rear lamp units on brackets at the frame's end: s, half width out, height. */
  readonly rearLamps: readonly [s: number, x: number, y: number];
  /**
   * Mud flaps either side of the rear wheels: the tops' s [ahead, behind], half widths
   * [inner, outer], heights [foot, top], and how far each foot leans away from the wheel.
   */
  readonly flaps: { readonly s: readonly [number, number]; readonly x: readonly [number, number]; readonly y: readonly [number, number]; readonly lean: number };
  /**
   * Under the bonnet: the four service cells the bonnet's grid draws its parts in
   * (bay.ts `KIT_BONNET_CELL_NODE`), as a car's. Each an x range across, an s range along
   * and the floor it stands on; its top is the closed bonnet's inner skin over it. The
   * engine's s range also routes the gearbox and the exhaust.
   */
  readonly bay: Readonly<Record<'engine' | 'turbine' | 'radiator' | 'air_filter', TruckCell>>;
}

/** A truck's bonnet cell (`TruckSpec.bay`): across, along, and the floor it stands on. */
export interface TruckCell {
  readonly x: readonly [number, number];
  readonly s: readonly [number, number];
  readonly floor: number;
}
