import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { FoleyEvent } from '../audio/foley';
import { nextOffer, offerDestinationIndex, POST_OFFER_COUNT, postStock, redrawOffer, SPECIAL_SLOT } from '../contracts/offers';
import {
  ACTIVE_CONTRACT_LIMIT,
  ACTIVE_HAUL_LIMIT,
  activeContracts,
  contractAcceptRefusal,
  isContractClosed,
} from '../contracts/registry';
import { isPassenger } from '../contracts/kinds/teddyPassengers';
import { formatClock, urgentRemainingS, type ContractKind, type DeliveryProbe } from '../contracts/types';
import { haulLoadId, isContractCarId } from '../contracts/world';
import { carUniqueness, contractPay, formatMoney, RELIC_STICKERS, SPECIAL_CARD_STICKERS, uniquenessBonusText } from '../economy/economy';
import type { GameWorld, WorldState } from '../game/state';
import {
  contractIdOf,
  contractKindOf,
  contractThing,
  isHaul,
  type ContractCargoItem,
  type Item,
} from '../items/items';
import { hasTag, thingBootFootprint, thingCard, type PostCard, type ThingDef } from '../items/things';
import { carModel, hasCarModel, type CarModelDef } from '../vehicle/carmodels';
import { bootHolds } from '../vehicle/trunk';
import { buildCardMachine, CardMachine, NICHE_FLOOR_Y, NICHE_X, NICHE_Z, paintCardFace, registerCardMachineSigns, thingName, type CardMachineParts } from './cardmachine';
import type { ChunkContext } from './chunks';
import type { FixtureContext, FixtureField } from './fixturefield';
import { placeNameAt } from './placenames';
import { postId, postStop, type PostStop } from './poststops';
import { postParkingSlot } from './haulbay';
import { box, mergeKitStatics } from './poi/kit';

/**
 * THE POST MACHINE (game-design2.md §7): where contracts are taken and handed in, by
 * hand. One stands at every settlement's `post` spot (world/settlement.ts), the physical
 * face of the post network (world/poststops.ts) and its offers (contracts/offers.ts).
 *
 * A card machine (world/cardmachine.ts): its three cards are the post's three offers, one
 * per property of a thing (§7.2) — ordinary, fragile, bulky or a haul — and a fourth, a
 * SPECIAL thing (relics among them from `RELIC_STICKERS`), while the car on the
 * lay-by has `SPECIAL_CARD_STICKERS` stickers or more (§12); hidden, its slot keeps its
 * round. A card prints the thing, where it goes and how far, the pay, its tags, a haul's
 * or a race's note, the lay-by car's sticker bonus, and says when the thing will not fit
 * that car. The wheel turns through them for as long as the player likes; TAKE gives the
 * one showing, always, fitting or not: the car can be changed. Its thing appears in the
 * machine's GRID, its one cell, and he takes it from there into his hands or pack as
 * from a boot; with something lying there already, TAKE refuses and says so. A HAUL
 * gives nothing (§7.8): its load already waits in the first slot of
 * the post's parking row (world/haulbay.ts, contracts/haulbays.ts), and TAKE binds the
 * contract to it (`haul_take`), which lifts its lock; with no load in the slot (the slot
 * is taken) TAKE refuses. The card it was on falls away and the slot's next offer is
 * under it (`nextOffer`): the machine never runs dry.
 *
 * THE LAY-BY CAR is the player's car standing within `LAYBY_CAR_RANGE_M` of the post's
 * hand-in slot, the middle of its parking row: the one he last drove
 * (`PlayerState.lastDrivenCarId`) when it is there, else
 * the nearest. Its stickers open the fifth card and add `uniquenessBonus` to the pay the
 * cards print. A delivery is paid by the same car's stickers, read when the grid takes
 * it; with no car on the lay-by, by the car he last drove, wherever it stands.
 *
 * The GRID takes things in too: a thing bound here, put into the empty cell, lies there a
 * moment while the machine draws it in, and the pay goes into the player's money (§7.7:
 * no envelope, stickers are only bought). A thing this post will not sign for goes in as
 * a RETURN TO SENDER: no pay, the job closed. Standing at it with a thing in hand, the
 * window shows the HAND-IN card first, and follows what he holds: what to put in the
 * grid, what it pays, that it is a return, or why it will not take it. A haul is handed
 * in by its load, in the second slot (contracts/haulbays.ts), never at the grid.
 *
 * TAKE refuses while the player already has `ACTIVE_CONTRACT_LIMIT` jobs out, and a haul
 * while he has `ACTIVE_HAUL_LIMIT` hauls out (`activeContracts`); the cards say so.
 *
 * The stock is saved in `WorldState.courierStorage` (`courier_storage` delta, the saved
 * shape of the courier days): see `postStock`. What lies in the grid is saved apart
 * (`WorldState.machineGrids`): a thing given there is out of the stock, its contract
 * active and its clock running, which the stock's cells could not say. Things an old
 * save left in a courier's boot are put into the grid when the machine is built, and
 * stay in the stock's cells after its offers until the grid has room for them.
 */

const POST_LOOK = {
  body: 0x3e5f86,
  buttonLabel: 'TAKE',
  buttonColour: 0x3f8a4a,
} as const;
/** How the card's band reads each property. */
const CARD_BAND: Readonly<Record<PostCard, string>> = {
  ordinary: '#4f7a4a',
  fragile: '#3f6f8f',
  bulky: '#2f4f7a',
  special: '#8a6a1f',
};
/** A relic's band, on the special card. */
const RELIC_BAND = '#6a2f5f';
/** A race card's band, whatever its property. */
const RACE_BAND = '#a2452f';
/** The hand-in card's band: a delivery, a return to sender. */
const HAND_IN_BAND: Readonly<Record<HandInCard['mode'], string>> = {
  deliver: '#2f6a3a',
  return: '#6a5a2f',
};
/** What the machine says when TAKE is refused for the limit. */
const LIMIT_TEXT = 'three jobs already out — hand one in or return it';
/** What the machine says when TAKE of a haul is refused: one haul at a time. */
const HAUL_LIMIT_TEXT = 'one haul already out — hand it in or return it first';
/** What the machine says when TAKE of a haul finds no load in the pick-up slot. */
const BAY_TAKEN_TEXT = 'slot 1 is taken — its load comes when the slot is clear';
registerCardMachineSigns(POST_LOOK);

/** A car counts as standing on the post's lay-by inside this radius of its hand-in slot, m. */
export const LAYBY_CAR_RANGE_M = 20;
/** A thing this heavy or more says its mass on the card, kg. */
const HEAVY_KG = 20;

/** What the card's band calls the offer: its property, a haul's kind, a race, an urgent clock. */
function bandText(offer: ContractCargoItem, thing: ThingDef): string {
  // A post's offer is never the teddies, who wait in the shelter (world/shelter.ts).
  const card = thingCard(thing) ?? 'ordinary';
  const property = isHaul(offer) ? 'HAUL' : hasTag(thing, 'relic') ? 'RELIC' : card.toUpperCase();
  const urgent = offer.urgentS === undefined ? '' : ` · URGENT ${formatClock(offer.urgentS)}`;
  if (offer.raceLegs) return urgent ? `${property} · RACE ${offer.raceLegs}${urgent}` : `${property} · RACE ${offer.raceLegs} STOP${offer.raceLegs > 1 ? 'S' : ''}`;
  return `${property}${urgent}`;
}

/** The card's second line after the pay: the tags, a heavy thing's mass. */
function tagText(offer: ContractCargoItem, thing: ThingDef): string {
  const tags = thing.tags.length > 0 ? thing.tags.join(', ') : 'haul';
  return thing.massKg >= HEAVY_KG && !isHaul(offer) ? `${tags}, ${thing.massKg} kg` : tags;
}

/** How a haul's load waits, and how it is handed in, for its card. */
function haulNote(thing: ThingDef): string | null {
  switch (thing.place) {
    case 'trailer':
      return 'on a trailer in slot 1 · back it into their slot 2';
    case 'tow':
      return 'in slot 1, on the tow bar · back it into their slot 2';
    case 'transfer':
      return 'in slot 1, drive it · back it into their slot 2';
    default:
      return null;
  }
}

/** What TAKE of a haul says: where its load is and what to do with it. */
function haulTakenText(thing: ThingDef): string {
  switch (thing.place) {
    case 'trailer':
      return `the ${thing.name} is yours — hitch its trailer in slot 1`;
    case 'tow':
      return `the ${thing.name} is yours — put it on your tow bar in slot 1`;
    default:
      return `the ${thing.name} is yours — drive it out of slot 1`;
  }
}

/**
 * True when `thing` can never ride in `model` (§7.2): a thing of the boot whose cells
 * the car's grid has not, or a seat thing that can lie on a seat instead never. The
 * carpet and the hauls fit every car: each has a rear bench and a tow ball.
 */
function wontFit(thing: ThingDef, model: CarModelDef): boolean {
  if (thing.place !== 'cells' || thing.seat) return false;
  const footprint = thingBootFootprint(thing);
  return footprint !== null && !bootHolds(model.trunkGrid, footprint);
}

/** What the hand-in card calls the thing to put in the grid, with its article: none before a possessive ("dad's tool box"). */
function cargoNoun(item: ContractCargoItem): string {
  const name = contractThing(item).name;
  return (name.includes("'s ") ? name : `the ${name}`).toUpperCase();
}

/**
 * The card the window shows first while the player works the machine with a thing in
 * hand: what to put in the grid for a delivery or a return. `key` tells two apart.
 */
interface HandInCard {
  readonly key: string;
  readonly mode: 'deliver' | 'return';
  readonly band: string;
  readonly headline: string;
  readonly lines: readonly string[];
  readonly footer: string;
}

/**
 * The LAY-BY CAR of the post whose hand-in slot's middle is (`haulX`, `haulZ`), ABSOLUTE: the
 * player's car standing within `LAYBY_CAR_RANGE_M` of it, the one he last drove when it
 * is there, else the nearest; none, null. A haul's own car is not one to load, and a car
 * for sale is nobody's. `position`: where a car stands, absolute.
 */
export function laybyCarId(
  state: WorldState,
  haulX: number,
  haulZ: number,
  position: (carId: string) => { readonly x: number; readonly z: number } | null,
): string | null {
  let best: string | null = null;
  let bestD2 = LAYBY_CAR_RANGE_M * LAYBY_CAR_RANGE_M;
  for (const [carId, car] of Object.entries(state.cars)) {
    if (isContractCarId(carId) || car.lotPrice !== undefined || !hasCarModel(car.modelId)) continue;
    const at = position(carId);
    if (!at) continue;
    const d2 = (at.x - haulX) ** 2 + (at.z - haulZ) ** 2;
    if (d2 > LAYBY_CAR_RANGE_M * LAYBY_CAR_RANGE_M) continue;
    if (carId === state.player.lastDrivenCarId) return carId;
    if (d2 > bestD2) continue;
    bestD2 = d2;
    best = carId;
  }
  return best;
}

/**
 * The stickers a delivery is paid by: the lay-by car's (`laybyCarId`); with no car on
 * the lay-by, the car the player last drove, wherever it stands.
 */
export function deliveryStickers(state: WorldState, laybyCar: string | null): number {
  const id = laybyCar ?? state.player.lastDrivenCarId;
  const car = id ? state.cars[id] : undefined;
  return car ? carUniqueness(car) : 0;
}

/**
 * Builds stop `stop`'s machine at ABSOLUTE (`x`, `z`) on the lay-by, its front turned by
 * `yaw` (front local -Z: the settlement spot's convention), a tied parcel in its
 * showcase. In the physics band it is solid and registers its fixture (id pushed to
 * `registered`, for the chunk to forget); beyond it, it is only seen. `disposers` gets
 * the card materials.
 */
export function buildPost(
  ctx: ChunkContext,
  stop: PostStop,
  x: number,
  z: number,
  yaw: number,
  group: THREE.Group,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
  fixtures: FixtureField,
  registered: string[],
  disposers: Array<() => void>,
): void {
  const parts = buildCardMachine(ctx, stop.s, x, z, yaw, POST_LOOK, group, bodies, colliders, disposers);
  // The parcel: brown paper, twine round it both ways and a pale label on its front,
  // each standing 5-6 mm proud of what it lies on.
  const at: [number, number, number] = [NICHE_X, NICHE_FLOOR_Y + 0.06, NICHE_Z];
  box(parts.root, [0.17, 0.12, 0.1], at, 0x9c7650);
  box(parts.root, [0.012, 0.13, 0.11], at, 0xd8c9a0);
  box(parts.root, [0.18, 0.13, 0.012], at, 0xd8c9a0);
  box(parts.root, [0.06, 0.04, 0.012], [NICHE_X + 0.045, at[1] - 0.01, NICHE_Z - 0.05], 0xece4cf);
  mergeKitStatics(parts.root);
  const slot = postParkingSlot(ctx.world.seed, ctx.road, stop.index, 'handIn');
  const machine = new PostMachine(ctx.world, stop, slot.x, slot.z, parts);
  if (ctx.hasPhysics) registered.push(fixtures.register(machine));
}

/** What the grid would take now: the thing in hand, and whether it is delivered or returned. */
interface Posting {
  readonly item: ContractCargoItem;
  readonly mode: 'deliver' | 'return';
}

class PostMachine extends CardMachine {
  /** The id of the thing in hand the hand-in card was last made for (null: none); undefined while not engaged. */
  private handInFor: string | null | undefined = undefined;
  /** The offer standing in each slot (the four, then `SPECIAL_SLOT`). */
  private readonly offers: ContractCargoItem[];
  /** What an old save left in a courier's boot and the grid has had no room for yet, in order. */
  private readonly strays: Item[];
  /** The hand-in card, standing first among the cards while the machine is worked. */
  private handIn: HandInCard | null = null;
  /** The model of the car standing on the lay-by when the cards were last painted, or null. */
  private laybyModel: CarModelDef | null = null;
  /** That car's id and stickers (`carUniqueness`): null and 0 with no car there. */
  private laybyCarId: string | null = null;
  private laybyStickers = 0;
  /** The player has `ACTIVE_CONTRACT_LIMIT` contracts out: TAKE refuses (`refreshLimit`). */
  private atLimit = false;
  /** The player has `ACTIVE_HAUL_LIMIT` hauls out: TAKE refuses a haul (`refreshLimit`). */
  private haulsAtLimit = false;

  constructor(
    world: GameWorld,
    private readonly stop: PostStop,
    /** ABSOLUTE metres of the middle of the post's hand-in slot: the lay-by car and the deliveries measure from it. */
    private readonly haulX: number,
    private readonly haulZ: number,
    parts: CardMachineParts,
  ) {
    super(`post:${stop.index}`, parts, world);
    this.findLaybyCar((carId) => world.state.cars[carId] ?? null);
    const stock = postStock(world.state, world.seed, stop.index, this.relics);
    this.offers = stock.offers.slice();
    this.strays = stock.strays.slice();
    // Into the grid where they fit; saved there with the next change (`save`), and read
    // the same way from the stock's cells until then.
    this.settleStrays();
    this.start();
  }

  /** The lay-by car's stickers show the fifth card. */
  private get specialShown(): boolean {
    return this.laybyStickers >= SPECIAL_CARD_STICKERS;
  }

  /** The lay-by car's stickers let the fifth card offer relics. */
  private get relics(): boolean {
    return this.laybyStickers >= RELIC_STICKERS;
  }

  /** Puts the strays the grid has room for into it, in order. */
  private settleStrays(): void {
    for (let k = 0; k < this.strays.length;) {
      if (this.give(this.strays[k]!)) this.strays.splice(k, 1);
      else k++;
    }
  }

  /**
   * Writes the stock as it stands — the offer in each slot, then the strays still out of
   * the grid — and the grid, with what a hand-in consumed and completed.
   */
  private save(extra?: { consumedItemId?: string; completedContractId?: string; completedContractKind?: ContractKind }): void {
    this.world.apply({ t: 'courier_storage', courierId: postId(this.stop.index), cells: [...this.offers, ...this.strays], ...extra });
    this.saveGrid();
  }

  protected override gridTaken(): void {
    this.settleStrays();
    this.save();
  }

  /**
   * Finds the lay-by car (`laybyCarId`; `position`: where a car stands, absolute). True
   * when what the cards print of it (its model, its stickers) changed.
   */
  private findLaybyCar(position: (carId: string) => { readonly x: number; readonly z: number } | null): boolean {
    const best = laybyCarId(this.world.state, this.haulX, this.haulZ, position);
    const car = best ? this.world.state.cars[best]! : null;
    const model = car ? carModel(car.modelId) : null;
    const stickers = car ? carUniqueness(car) : 0;
    const changed = model !== this.laybyModel || stickers !== this.laybyStickers;
    this.laybyCarId = best;
    this.laybyModel = model;
    this.laybyStickers = stickers;
    return changed;
  }

  /** The stickers a delivery here is paid by (`deliveryStickers`), the lay-by read live. */
  private deliveryStickers(ctx: FixtureContext): number {
    this.refreshLayby(ctx);
    return deliveryStickers(this.world.state, this.laybyCarId);
  }

  /**
   * The lay-by car from the live bodies; on a change the special slot is drawn again
   * for its relic tier (same round) and the cards repaint.
   */
  private refreshLayby(ctx: FixtureContext): void {
    const probe = this.probe(ctx);
    const relics = this.relics;
    if (!this.findLaybyCar((carId) => probe.carPosition(carId))) return;
    if (relics !== this.relics) this.offers[SPECIAL_SLOT] = redrawOffer(this.world.seed, this.offers[SPECIAL_SLOT]!, this.relics);
    this.cardsChanged();
  }

  /** Cards before the offers: the hand-in card, while there is one. */
  private get lead(): number {
    return this.handIn ? 1 : 0;
  }

  protected cardCount(): number {
    return this.lead + POST_OFFER_COUNT + (this.specialShown ? 1 : 0);
  }

  protected paintCard(g: CanvasRenderingContext2D, w: number, h: number, index: number): void {
    const count = this.cardCount();
    if (this.handIn && index === 0) {
      const card = this.handIn;
      paintCardFace(g, w, h, {
        band: HAND_IN_BAND[card.mode],
        bandText: card.band,
        corner: `1/${count}`,
        headline: card.headline,
        lines: card.lines,
        footer: card.footer,
      });
      return;
    }
    const slot = index - this.lead;
    const offer = slot === SPECIAL_SLOT && !this.specialShown ? undefined : this.offers[slot];
    if (!offer) return;
    const thing = contractThing(offer);
    const km = (postStop(this.world.seed, offerDestinationIndex(offer)).s - this.stop.s) / 1000;
    const lines = [
      `→ ${offer.destination ?? 'the next post'} · ${km.toFixed(1)} km`,
      `${formatMoney(contractPay(this.world.seed, offer, this.laybyStickers))} · ${tagText(offer, thing)}`,
    ];
    const bonus = uniquenessBonusText(this.laybyStickers);
    if (bonus) lines.push(bonus);
    // At the limit the card says so before any note: TAKE will refuse it.
    if (this.atLimit) lines.push('three jobs out: hand one in or return it');
    else if (this.haulsAtLimit && isHaul(offer)) lines.push('one haul out: hand it in or return it');
    const haul = haulNote(thing);
    if (haul) lines.push(haul);
    if (offer.raceLegs) lines.push('three rivals race you to it');
    if (this.laybyModel && wontFit(thing, this.laybyModel)) lines.push(`won't fit your ${this.laybyModel.label}`);
    paintCardFace(g, w, h, {
      band: offer.raceLegs ? RACE_BAND : hasTag(thing, 'relic') ? RELIC_BAND : CARD_BAND[thingCard(thing) ?? 'ordinary'],
      bandText: bandText(offer, thing),
      corner: `${index + 1}/${count}`,
      headline: thing.name,
      lines,
      footer: `from ${placeNameAt(this.world.seed, this.stop.s)}`,
    });
  }

  /** Reads the limits (`activeContracts`) into `atLimit` and `haulsAtLimit`; repaints on a change. */
  private refreshLimit(): void {
    const active = activeContracts(this.world.state);
    const atLimit = active.all.size >= ACTIVE_CONTRACT_LIMIT;
    const haulsAtLimit = active.hauls.size >= ACTIVE_HAUL_LIMIT;
    if (atLimit === this.atLimit && haulsAtLimit === this.haulsAtLimit) return;
    this.atLimit = atLimit;
    this.haulsAtLimit = haulsAtLimit;
    this.cardsChanged();
  }

  protected pressButton(ctx: FixtureContext, index: number): FoleyEvent {
    // TAKE on the hand-in card: it is the grid that takes cargo in.
    if (this.handIn && index === 0) return this.refuse();
    const slot = index - this.lead;
    const offer = slot === SPECIAL_SLOT && !this.specialShown ? undefined : this.offers[slot];
    if (!offer) return 'click';
    this.refreshLimit();
    if (this.atLimit) {
      ctx.toast(LIMIT_TEXT);
      return this.refuse();
    }
    if (this.haulsAtLimit && isHaul(offer)) {
      ctx.toast(HAUL_LIMIT_TEXT);
      return this.refuse();
    }
    if (isHaul(offer)) {
      // A haul gives nothing (§7.8): the load waiting in the bay is the job, and TAKE binds
      // the contract to it, which lifts its lock. Bound first, so the card never stands for
      // a job already out.
      const loadId = haulLoadId(offer);
      if (!this.world.state.trailers[loadId] && !this.world.state.cars[loadId]) {
        ctx.toast(BAY_TAKEN_TEXT);
        return this.refuse();
      }
      this.world.apply({ t: 'haul_take', haul: { contract: offer, loadId } });
      this.offers[slot] = nextOffer(this.world.seed, offer, this.relics);
      this.save();
      this.cardsChanged();
      this.refreshLimit();
      ctx.toast(haulTakenText(contractThing(offer)));
      return 'mount';
    }
    if (!this.cellFree()) {
      ctx.toast(`no room in the grid for the ${contractThing(offer).name} — take out what lies there first`);
      return this.refuse();
    }
    // The stock and the grid in one save, so the cargo never exists twice: the slot's
    // next offer stands in, and the thing lies in the grid for him to take.
    this.offers[slot] = nextOffer(this.world.seed, offer, this.relics);
    this.give(offer);
    this.save();
    this.cardsChanged();
    this.refreshLimit();
    return 'mount';
  }

  protected override onEngaged(ctx: FixtureContext, first: boolean): void {
    if (first) {
      // The car on the lay-by now, from its live body: the cards repaint when it changed.
      this.refreshLayby(ctx);
      this.refreshLimit();
    }
    // The hand-in card follows what is in hand while he stands there.
    const held = ctx.held?.id ?? null;
    if (held === this.handInFor) return;
    this.handInFor = held;
    this.showHandIn(this.handInCard(ctx));
  }

  protected override onDisengaged(): void {
    // Walked away, the window goes back to the offers.
    this.handInFor = undefined;
    this.showHandIn(null);
  }

  /** The hand-in card for the thing in hand, or null when he holds none. */
  private handInCard(ctx: FixtureContext): HandInCard | null {
    const posting = this.posting(ctx);
    if (!posting) return null;
    const item = posting.item;
    const name = contractThing(item).name;
    const headline = `PUT ${cargoNoun(item)} IN THE GRID`;
    let card: Omit<HandInCard, 'key'>;
    if (posting.mode === 'return') {
      const closed = isContractClosed(item, this.world.state.completedContractIds);
      card = {
        mode: 'return',
        band: 'RETURN — NO PAY',
        headline,
        lines: closed
          ? [name, 'the post takes it off your hands', 'no pay']
          : [name, 'back to the sender', 'no pay'],
        footer: closed ? '' : 'the job is closed and off your list',
      };
    } else {
      const left = urgentRemainingS(item);
      const stickers = this.deliveryStickers(ctx);
      const lines = [name, `pays ${formatMoney(contractPay(this.world.seed, item, stickers))}${left === null ? '' : left < 0 ? ' · late: base pay' : ' · urgent +50%'}`];
      const bonus = uniquenessBonusText(stickers);
      if (bonus) lines.push(bonus);
      card = { mode: 'deliver', band: left === null ? 'HAND IN' : left < 0 ? 'HAND IN · LATE' : 'HAND IN · ON TIME', headline, lines, footer: 'the pay goes into your money' };
    }
    return { ...card, key: `${card.mode}:${item.id}:${card.headline}:${card.lines.join('|')}` };
  }

  /** Puts `card` first in the window (null takes the hand-in card away), and shows it. */
  private showHandIn(card: HandInCard | null): void {
    if ((card?.key ?? null) === (this.handIn?.key ?? null)) return;
    const had = this.handIn !== null;
    this.handIn = card;
    // The selection stays on the same offer; a new hand-in card is turned to at once.
    if (card && !had) this.selected = 0;
    else if (!card && had) this.selected = Math.max(0, this.selected - 1);
    this.cardsChanged();
  }

  private probe(ctx: FixtureContext): DeliveryProbe {
    return ctx.probe(this.stop.index, this.haulX, this.haulZ);
  }

  /**
   * What the grid would take: the thing in hand, delivered when this post signs for it
   * (`contractAcceptRefusal`), else taken back as a return to sender — any post takes any
   * thing back, and a delivery always wins over a return. Never a teddy: teddies get off
   * on a shelter's bench (world/shelter.ts).
   */
  private posting(ctx: FixtureContext): Posting | null {
    const held = ctx.held;
    if (held?.type !== 'contract_cargo' || isPassenger(held)) return null;
    const deliver = !isContractClosed(held, this.world.state.completedContractIds)
      && contractAcceptRefusal(held, this.probe(ctx)) === null;
    return { item: held, mode: deliver ? 'deliver' : 'return' };
  }

  protected override putPrompt(ctx: FixtureContext, held: Item): string | null {
    if (isPassenger(held)) return null;
    const posting = this.posting(ctx);
    if (!posting) return null;
    return `[F] ${posting.mode === 'deliver' ? 'hand in' : 'return'} ${thingName(posting.item)}`;
  }

  /**
   * The thing in hand put to the empty cell: it lies there while the machine draws it in
   * (`swallow`), and is delivered or returned. Anything that is not the post's cargo stays
   * in the hand.
   */
  protected override putIn(ctx: FixtureContext, held: Item): FoleyEvent | null {
    if (isPassenger(held)) {
      ctx.toast('teddies get off at a shelter — seat it on the bench');
      return 'refused';
    }
    // `posting` reads the same held thing.
    const posting = this.posting(ctx);
    if (!posting) {
      ctx.toast('the post takes only the things it sends');
      return 'refused';
    }
    const item = posting.item;
    if (posting.mode === 'return') return this.takeBack(ctx, item);
    const stickers = this.deliveryStickers(ctx);
    const pay = contractPay(this.world.seed, item, stickers) + ctx.racePay(item.id);
    this.swallow(item);
    // The completed id and the ledger first, then the pay, so a crash between cannot pay twice.
    this.save({ consumedItemId: item.id, completedContractId: item.id, completedContractKind: contractKindOf(item) });
    ctx.give(item.id);
    ctx.credit(pay);
    this.refreshLimit();
    this.showHandIn(this.handInCard(ctx));
    return 'coin';
  }

  /**
   * RETURN TO SENDER: the grid takes `item` back with no pay, and its contract is closed —
   * recorded in `completedContractIds` without a kind, so the ledger does not count it
   * and it no longer counts against the limit.
   */
  private takeBack(ctx: FixtureContext, item: ContractCargoItem): FoleyEvent {
    const contractId = contractIdOf(item);
    const open = !this.world.state.completedContractIds.includes(contractId);
    this.swallow(item);
    this.save(open ? { consumedItemId: item.id, completedContractId: contractId } : { consumedItemId: item.id });
    ctx.give(item.id);
    this.showHandIn(this.handInCard(ctx));
    this.refreshLimit();
    return 'drop';
  }
}
