import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { FoleyEvent } from '../audio/foley';
import { nextOffer, offerDestinationIndex, postStock } from '../contracts/offers';
import {
  ACTIVE_CONTRACT_LIMIT,
  activeContractIds,
  contractAcceptRefusal,
  contractDeliveryEffect,
  contractPosting,
  contractRelease,
  contractReturnRefusal,
  contractRewardSticker,
  deliveryQuality,
  earnsSticker,
  isContractClosed,
} from '../contracts/registry';
import { formatClock, isLate, urgentRemainingS, type ContractKind, type DeliveryEffect, type DeliveryProbe } from '../contracts/types';
import { isContractCarId, postHaulPlace } from '../contracts/world';
import { contractPay, formatMoney } from '../economy/economy';
import type { GameWorld } from '../game/state';
import {
  contractIdOf,
  contractKindOf,
  contractThing,
  isHaul,
  type ContractCargoItem,
  type Item,
  type StickerEnvelopeItem,
} from '../items/items';
import { thingBootFootprint, thingCard, type PostCard, type ThingDef } from '../items/things';
import { carModel, hasCarModel, type CarModelDef } from '../vehicle/carmodels';
import { bootHolds } from '../vehicle/trunk';
import { buildCardMachine, CardMachine, MACHINE_D, PANEL_X, PANEL_Y, paintCardFace, registerCardMachineSigns, type CardMachineParts } from './cardmachine';
import type { ChunkContext } from './chunks';
import type { FixtureContext, FixtureField } from './fixturefield';
import { paintSign, SIGN_PLANE } from './market';
import { placeNameAt } from './placenames';
import { postId, postStop, type PostStop } from './poststops';

/**
 * THE POST MACHINE (game-design2.md §7): where contracts are taken and handed in, by
 * hand. One stands at every settlement's `post` spot (world/settlement.ts), the physical
 * face of the post network (world/poststops.ts) and its offers (contracts/offers.ts).
 *
 * A card machine (world/cardmachine.ts): its four cards are the post's four offers, one
 * per property of a thing (§7.2) — ordinary, fragile, bulky or a haul, teddies. A card
 * prints the thing, where it goes and how far, the pay, its tags, a haul's or a race's
 * note, and says when the thing will not fit the car standing on the post's lay-by. The
 * crank turns through them for as long as the player likes; TAKE gives the one showing,
 * always, fitting or not: the car can be changed. Its thing falls into the tray (a
 * passenger party is one teddy each), and so do a haul's papers, its trailer or car
 * waiting on the lay-by (contracts/world.ts); the machine lets go of the player so he
 * picks them up. The card it was on falls away and the slot's next offer is under it
 * (`nextOffer`): the machine never runs dry.
 *
 * The TRAY takes things too, which its painted label says: clicked with a thing bound
 * here in hand, the machine draws it in, pays into the player's money and, for a
 * delivery handled with care and on time (registry.ts `earnsSticker`), drops the signed
 * sticker envelope into the tray. A haul is handed in the same way, with its trailer or
 * car on the lay-by and its papers in hand, in the pack or in a boot. A thing this post
 * will not sign for goes back as a RETURN TO SENDER (`contractReturnRefusal`): no pay, no
 * sticker, the job closed. Worked with a thing for here, the window shows the HAND-IN
 * card first: what to put in the tray, what it pays and whether a sticker comes, that
 * it is a return, or why the tray will not take it.
 *
 * TAKE refuses while the player already has `ACTIVE_CONTRACT_LIMIT` jobs out
 * (`activeContractIds`), and the cards' footer says so.
 *
 * What the machine holds is saved in `WorldState.courierStorage` (`courier_storage`
 * delta, the saved shape of the courier days): see `postStock`. Things an old save left in
 * a courier's boot come back through the tray when the machine is first worked.
 */

const POST_LOOK = {
  title: 'POST',
  body: 0x3e5f86,
  buttonLabel: 'TAKE',
  buttonColour: 0x3f8a4a,
  trayLabel: '▼ HAND THINGS IN HERE ▼',
} as const;
/** How the card's band reads each property. */
const CARD_BAND: Readonly<Record<PostCard, string>> = {
  ordinary: '#4f7a4a',
  fragile: '#3f6f8f',
  bulky: '#2f4f7a',
  teddies: '#a2602f',
};
/** A race card's band, whatever its property. */
const RACE_BAND = '#a2452f';
/** The hand-in card's band: a delivery, a return to sender, a refusal. */
const HAND_IN_BAND: Readonly<Record<HandInCard['mode'], string>> = {
  deliver: '#2f6a3a',
  return: '#6a5a2f',
  refused: '#7a3a2a',
};
/** What the machine says when TAKE is refused for the limit. */
const LIMIT_TEXT = 'three jobs already out — hand one in or return it';
registerCardMachineSigns(POST_LOOK);

/** A car counts as standing on the post's lay-by inside this radius of its haul place, m. */
const LAYBY_CAR_RANGE_M = 20;
/** A thing this heavy or more says its mass on the card, kg. */
const HEAVY_KG = 20;

/** What the card's band calls the offer: its property, a haul's kind, a race, an urgent clock. */
function bandText(offer: ContractCargoItem, thing: ThingDef): string {
  const card = thingCard(thing);
  const property = isHaul(offer) ? 'HAUL' : card === 'teddies' ? 'TEDDIES' : card.toUpperCase();
  const urgent = offer.urgentS === undefined ? '' : ` · URGENT ${formatClock(offer.urgentS)}`;
  if (offer.raceLegs) return urgent ? `${property} · RACE ${offer.raceLegs}${urgent}` : `${property} · RACE ${offer.raceLegs} STOP${offer.raceLegs > 1 ? 'S' : ''}`;
  return `${property}${urgent}`;
}

/** The card's second line after the pay: the tags, a party, a heavy thing's mass. */
function tagText(offer: ContractCargoItem, thing: ThingDef): string {
  if (offer.party) return 'passengers';
  const tags = thing.tags.length > 0 ? thing.tags.join(', ') : 'haul';
  return thing.massKg >= HEAVY_KG && !isHaul(offer) ? `${tags}, ${thing.massKg} kg` : tags;
}

/** How a haul's load waits, for its card. */
function haulNote(thing: ThingDef): string | null {
  switch (thing.place) {
    case 'trailer':
      return 'on a trailer, waiting on the lay-by';
    case 'tow':
      return 'to the repair on the tow bar';
    case 'transfer':
      return 'drive it over to a friend';
    default:
      return null;
  }
}

/**
 * True when `thing` can never ride in `model` (§7.2): a thing of the boot whose cells
 * the car's grid has not, or a seat thing that can lie on a seat instead never. The
 * carpet, the teddies and the hauls fit every car: each has a rear bench, three seats
 * and a tow ball.
 */
function wontFit(thing: ThingDef, model: CarModelDef): boolean {
  if (thing.place !== 'cells' || thing.seat) return false;
  const footprint = thingBootFootprint(thing);
  return footprint !== null && !bootHolds(model.trunkGrid, footprint);
}

/** What the hand-in card calls the thing to put in the tray, with its article: none before a possessive ("dad's tool box"). */
function cargoNoun(item: ContractCargoItem): string {
  if (item.party) return 'THE TEDDY';
  if (isHaul(item)) return 'THE PAPERS';
  const name = contractThing(item).name;
  return (name.includes("'s ") ? name : `the ${name}`).toUpperCase();
}

/**
 * The card the window shows first while the player works the machine with cargo for
 * here: what to put in the tray for a delivery or a return, or why it will not take it.
 * `key` tells two apart.
 */
interface HandInCard {
  readonly key: string;
  readonly mode: 'deliver' | 'return' | 'refused';
  readonly band: string;
  readonly headline: string;
  readonly lines: readonly string[];
  readonly footer: string;
}

/**
 * Builds stop `stop`'s machine at ABSOLUTE (`x`, `z`) on the sand, its front turned by
 * `yaw` (front local -Z: the settlement spot's convention). In the physics band it is
 * solid and registers its fixture (id pushed to `registered`, for the chunk to forget);
 * beyond it, it is only seen. `disposers` gets the card materials.
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
  // The office's name on the plate beside the button: painted for this one machine and
  // disposed with it, not kept in the session's sign cache.
  const plateMaterial = paintSign(['POST OFFICE', placeNameAt(ctx.world.seed, stop.s).toUpperCase()], '#f2ecd8', '#26221c', 256, 224);
  disposers.push(() => {
    plateMaterial.map?.dispose();
    plateMaterial.dispose();
  });
  const plate = new THREE.Mesh(SIGN_PLANE, plateMaterial);
  plate.scale.set(0.26, 0.23, 1);
  plate.position.set(PANEL_X, PANEL_Y, -MACHINE_D / 2 - 0.004);
  plate.rotation.y = Math.PI;
  parts.root.add(plate);

  const haul = postHaulPlace(ctx.world.seed, ctx.road, stop.index);
  const machine = new PostMachine(ctx.world, stop, haul.x, haul.z, parts);
  if (ctx.hasPhysics) registered.push(fixtures.register(machine));
}

/** What the tray would take now: the cargo, where it is held, and whether it is delivered or returned. */
interface Posting {
  readonly item: ContractCargoItem;
  /** In the pack (or the hands), or in a car's boot cell or cabin place. */
  readonly from: { readonly carId: string; readonly cell: number; readonly cabin: boolean } | null;
  readonly mode: 'deliver' | 'return';
}

class PostMachine extends CardMachine {
  protected readonly title = 'POST';
  /** The offer standing in each slot, and what an old save left inside. */
  private readonly offers: ContractCargoItem[];
  private strays: Item[];
  /** The hand-in card, standing first among the cards while the machine is worked. */
  private handIn: HandInCard | null = null;
  /** The model of the car standing on the lay-by when the cards were last painted, or null. */
  private laybyModel: CarModelDef | null = null;
  /** The player has `ACTIVE_CONTRACT_LIMIT` contracts out: TAKE refuses (`refreshLimit`). */
  private atLimit = false;

  constructor(
    private readonly world: GameWorld,
    private readonly stop: PostStop,
    /** ABSOLUTE metres of the lay-by place where hauls are left and handed in. */
    private readonly haulX: number,
    private readonly haulZ: number,
    parts: CardMachineParts,
  ) {
    super(`post:${stop.index}`, parts);
    const stock = postStock(world.state, world.seed, stop.index);
    this.offers = stock.offers.slice();
    this.strays = stock.strays.slice();
    this.laybyModel = this.findLaybyModel((carId) => world.state.cars[carId] ?? null);
    this.start();
  }

  /** Writes the stock as it stands: the offer in each slot, nothing else. */
  private saveStock(extra?: { consumedItemId?: string; completedContractId?: string; completedContractKind?: ContractKind }): void {
    this.world.apply({ t: 'courier_storage', courierId: postId(this.stop.index), cells: this.offers.slice(), ...extra });
  }

  /**
   * The model of the car nearest the lay-by's haul place within `LAYBY_CAR_RANGE_M`
   * (`position`: where a car stands, absolute), or null: what the cards say a thing
   * will not fit. A haul's own car is not one to load, and a car for sale is nobody's.
   */
  private findLaybyModel(position: (carId: string) => { readonly x: number; readonly z: number } | null): CarModelDef | null {
    let best: CarModelDef | null = null;
    let bestD2 = LAYBY_CAR_RANGE_M * LAYBY_CAR_RANGE_M;
    for (const [carId, car] of Object.entries(this.world.state.cars)) {
      if (isContractCarId(carId) || car.lotPrice !== undefined || !hasCarModel(car.modelId)) continue;
      const at = position(carId);
      if (!at) continue;
      const d2 = (at.x - this.haulX) ** 2 + (at.z - this.haulZ) ** 2;
      if (d2 > bestD2) continue;
      bestD2 = d2;
      best = carModel(car.modelId);
    }
    return best;
  }

  /** Cards before the offers: the hand-in card, while there is one. */
  private get lead(): number {
    return this.handIn ? 1 : 0;
  }

  protected cardCount(): number {
    return this.lead + this.offers.length;
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
    const offer = this.offers[index - this.lead];
    if (!offer) return;
    const thing = contractThing(offer);
    const km = (postStop(this.world.seed, offerDestinationIndex(offer)).s - this.stop.s) / 1000;
    const lines = [
      `→ ${offer.destination ?? 'the next post'} · ${km.toFixed(1)} km`,
      `${formatMoney(contractPay(this.world.seed, offer))} · ${tagText(offer, thing)}`,
    ];
    // At the limit the card says so before any note: TAKE will refuse it.
    if (this.atLimit) lines.push('three jobs out: hand one in or return it');
    const haul = haulNote(thing);
    if (haul) lines.push(haul);
    if (offer.raceLegs) lines.push('three rivals race you to it');
    if (this.laybyModel && wontFit(thing, this.laybyModel)) lines.push(`won't fit your ${this.laybyModel.label}`);
    paintCardFace(g, w, h, {
      band: offer.raceLegs ? RACE_BAND : CARD_BAND[thingCard(thing)],
      bandText: bandText(offer, thing),
      corner: `${index + 1}/${count}`,
      headline: offer.party ? `${thing.name} ×${offer.party.size}` : thing.name,
      lines,
      footer: `from ${placeNameAt(this.world.seed, this.stop.s)}`,
    });
  }

  /** True when the player already has `ACTIVE_CONTRACT_LIMIT` contracts out; repaints on a change. */
  private refreshLimit(): void {
    const atLimit = activeContractIds(this.world.state).size >= ACTIVE_CONTRACT_LIMIT;
    if (atLimit === this.atLimit) return;
    this.atLimit = atLimit;
    this.cardsChanged();
  }

  protected pressButton(ctx: FixtureContext, index: number): FoleyEvent {
    // TAKE on the hand-in card: it is the tray that takes cargo in.
    if (this.handIn && index === 0) return this.refuse();
    const slot = index - this.lead;
    const offer = this.offers[slot];
    if (!offer) return 'click';
    this.refreshLimit();
    if (this.atLimit) {
      ctx.toast(LIMIT_TEXT);
      return this.refuse();
    }
    // The stock first, so the cargo never exists twice: the slot's next offer stands in.
    this.offers[slot] = nextOffer(this.world.seed, offer);
    this.saveStock();
    this.cardsChanged();
    // A haul's papers fall into the tray like any thing (`contractRelease`: a teddy party
    // is one teddy each); its load is on the lay-by.
    this.give(ctx, contractRelease(offer));
    this.refreshLimit();
    return 'mount';
  }

  override setFocused(focused: boolean, ctx: FixtureContext): void {
    super.setFocused(focused, ctx);
    // Let go of, the window goes back to the offers.
    if (!focused) this.showHandIn(null);
  }

  protected override onFocused(ctx: FixtureContext): void {
    // The car on the lay-by now, from its live body: the cards repaint when it changed.
    const probe = this.probe(ctx);
    const model = this.findLaybyModel((carId) => probe.carPosition(carId));
    if (model !== this.laybyModel) {
      this.laybyModel = model;
      this.cardsChanged();
    }
    this.showHandIn(this.handInCard(ctx));
    this.refreshLimit();
    if (this.strays.length === 0) return;
    // What a courier's boot held in an old save comes back here, once.
    const strays = this.strays;
    this.strays = [];
    this.saveStock();
    this.give(ctx, strays);
  }

  /** The hand-in card for what the player brought, or null when he brought nothing for here. */
  private handInCard(ctx: FixtureContext): HandInCard | null {
    const { posting, refusal } = this.posting(ctx);
    if (posting) {
      const item = posting.item;
      const name = item.party ? 'teddy passenger' : contractThing(item).name;
      const headline = posting.from === null && ctx.held?.id === item.id
        ? `PUT ${cargoNoun(item)} IN THE TRAY`
        : 'CLICK THE TRAY TO HAND IT IN';
      let card: Omit<HandInCard, 'key'>;
      if (posting.mode === 'return') {
        const closed = isContractClosed(item, this.world.state.completedContractIds);
        card = {
          mode: 'return',
          band: 'RETURN — NO PAY',
          headline,
          lines: closed
            ? [name, 'the post takes it off your hands', 'no pay, no sticker']
            : [name, 'back to the sender', 'no pay, no sticker'],
          footer: closed ? '' : 'the job is closed and off your list',
        };
      } else {
        const completes = contractPosting(item, this.world.state.completedContractIds).completes;
        const left = urgentRemainingS(item);
        const lines = [name];
        if (!completes) lines.push('paid with the last of the party');
        else {
          lines.push(`pays ${formatMoney(contractPay(this.world.seed, item))}${left === null ? '' : left < 0 ? ' · late: base pay' : ' · urgent +50%'}`);
          lines.push(stickerLine(item));
        }
        card = { mode: 'deliver', band: left === null ? 'HAND IN' : left < 0 ? 'HAND IN · LATE' : 'HAND IN · ON TIME', headline, lines, footer: 'the pay goes into your money' };
      }
      return { ...card, key: `${card.mode}:${item.id}:${card.headline}:${card.lines.join('|')}` };
    }
    if (refusal) {
      return { key: `no:${refusal}`, mode: 'refused', band: 'NOT TAKEN HERE', headline: 'THE TRAY WILL NOT TAKE IT', lines: [refusal], footer: '' };
    }
    return null;
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
   * What the tray would take: the cargo in hand, else a haul's papers bound here. Cargo
   * in hand that this post will not sign for may still go back as a return
   * (`contractReturnRefusal`); a delivery always wins over a return.
   */
  private posting(ctx: FixtureContext): { posting: Posting | null; refusal: string | null } {
    const held = ctx.held;
    const completed = this.world.state.completedContractIds;
    if (held?.type === 'contract_cargo') {
      const probe = this.probe(ctx);
      if (!isContractClosed(held, completed) && contractAcceptRefusal(held, probe) === null) {
        return { posting: { item: held, from: null, mode: 'deliver' }, refusal: null };
      }
      const back = contractReturnRefusal(held, probe, completed);
      if (back === null) return { posting: { item: held, from: null, mode: 'return' }, refusal: null };
      return { posting: null, refusal: back };
    }
    if (held !== null) return { posting: null, refusal: null };
    // Empty hands: a haul is handed in by its papers wherever they are, with its trailer
    // or car on the lay-by.
    let refusal: string | null = null;
    const consider = (item: Item | null, from: Posting['from']): Posting | null => {
      if (item?.type !== 'contract_cargo' || !isHaul(item)) return null;
      // Papers from this post itself are the job just taken, not one to hand in.
      if (item.sourceCourierIndex >= this.stop.index) return null;
      const why = contractAcceptRefusal(item, this.probe(ctx));
      if (why === null) return { item, from, mode: 'deliver' };
      refusal ??= why;
      return null;
    };
    for (const item of ctx.inventory.all) {
      const found = consider(item, null);
      if (found) return { posting: found, refusal: null };
    }
    for (const [carId, car] of Object.entries(this.world.state.cars)) {
      for (let cell = 0; cell < car.storage.length; cell++) {
        const found = consider(car.storage[cell] ?? null, { carId, cell, cabin: false });
        if (found) return { posting: found, refusal: null };
      }
      for (let cell = 0; cell < car.cabin.length; cell++) {
        const found = consider(car.cabin[cell] ?? null, { carId, cell, cabin: true });
        if (found) return { posting: found, refusal: null };
      }
    }
    return { posting: null, refusal };
  }

  protected override useTray(ctx: FixtureContext): FoleyEvent | null {
    const { posting, refusal } = this.posting(ctx);
    if (!posting) return refusal ? 'refused' : null;
    const item = posting.item;
    const probe = this.probe(ctx);
    const effect = contractDeliveryEffect(item, probe);
    if (posting.mode === 'return') return this.takeBack(ctx, item, effect);
    const result = contractPosting(item, this.world.state.completedContractIds);
    if (posting.from) {
      const { carId, cell, cabin } = posting.from;
      this.world.apply(cabin ? { t: 'car_cabin', carId, place: cell, item: null } : { t: 'car_storage', carId, cell, item: null });
    }
    this.swingChute(true);
    if (!result.completes) {
      // One of a party: taken in, counted, paid with the last of them.
      this.saveStock({ consumedItemId: item.id, completedContractId: item.id });
      ctx.give(item.id);
      this.showHandIn(this.handInCard(ctx));
      return 'drop';
    }
    const contractId = result.contractId;
    const pay = contractPay(this.world.seed, item) + ctx.racePay(contractId);
    const sticker = earnsSticker(item);
    // The completed id and the ledger first; the kind's own world change (the trailer or
    // car taken in) after it, so a crash between the halves cannot pay twice.
    this.saveStock({ consumedItemId: item.id, completedContractId: contractId, completedContractKind: contractKindOf(item) });
    if (effect?.deltas) for (const delta of effect.deltas) this.world.apply(delta);
    ctx.give(item.id);
    // Paid first, before the envelope drops and the machine lets go.
    ctx.credit(pay);
    this.refreshLimit();
    if (!sticker) {
      // Paid, but no envelope: worn under 90% or late (§7.7).
      this.showHandIn(this.handInCard(ctx));
      return 'coin';
    }
    const envelope: StickerEnvelopeItem = {
      type: 'sticker_envelope',
      id: `${contractId}:signed:${this.stop.index}`,
      stickerKind: contractRewardSticker(item),
      completedContractId: contractId,
    };
    this.give(ctx, [envelope]);
    return 'coin';
  }

  /**
   * RETURN TO SENDER: the tray takes `item` back with no pay and no sticker, and its
   * contract is closed — recorded in `completedContractIds` without a kind, so the ledger
   * does not count it and it no longer counts against the limit. A teddy closes its whole
   * party: the rest of it are leftovers any tray takes. A haul's load goes in with its
   * papers (`effect`, the same world change as a delivery).
   */
  private takeBack(ctx: FixtureContext, item: ContractCargoItem, effect: DeliveryEffect | null): FoleyEvent {
    const contractId = contractIdOf(item);
    const open = !this.world.state.completedContractIds.includes(contractId);
    this.swingChute(true);
    this.saveStock(open ? { consumedItemId: item.id, completedContractId: contractId } : { consumedItemId: item.id });
    if (effect?.deltas) for (const delta of effect.deltas) this.world.apply(delta);
    ctx.give(item.id);
    this.showHandIn(this.handInCard(ctx));
    this.refreshLimit();
    return 'drop';
  }
}

/** The hand-in card's line on the sticker envelope: whether this delivery earns one, and why not. */
function stickerLine(item: ContractCargoItem): string {
  if (earnsSticker(item)) return 'a sticker envelope comes with it';
  if (isLate(item)) return 'late: no sticker';
  return `${Math.round(deliveryQuality(item) * 100)}%: no sticker (needs 90%)`;
}
