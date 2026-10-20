import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { FoleyEvent } from '../audio/foley';
import { nextOffer, offerDestinationIndex, postStock } from '../contracts/offers';
import {
  contractAcceptRefusal,
  contractDeliveryEffect,
  contractPosting,
  contractRelease,
  contractRewardSticker,
} from '../contracts/registry';
import type { DeliveryProbe } from '../contracts/types';
import { postHaulPlace } from '../contracts/world';
import { contractPay, formatMoney } from '../economy/economy';
import type { GameWorld } from '../game/state';
import {
  contractTier,
  isHaulKind,
  type ContractCargoItem,
  type Item,
  type StickerEnvelopeItem,
} from '../items/items';
import { buildCardMachine, CardMachine, MACHINE_D, PANEL_X, PANEL_Y, paintCardFace, type CardMachineParts } from './cardmachine';
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
 * of each tier — the name, where it goes and how far, the pay, the cargo kind. The crank
 * turns through them for as long as the player likes; TAKE gives the one showing, always:
 * no licence, no empty hands asked first. Its cargo falls into the tray (a passenger
 * party is one teddy each), and so do a haul's papers, its trailer or car waiting on the
 * lay-by (contracts/world.ts); the machine lets go of the player so he picks them up.
 * The card it was on falls away and the slot's next offer is under it (`nextOffer`): the
 * machine never runs dry.
 *
 * The TRAY takes cargo too, which its painted label says: clicked with cargo bound here
 * in hand, the machine draws it in, pays into the purse sitting in its slot and drops the
 * signed sticker envelope into the tray. A haul is handed in the same way, with its
 * trailer or car on the lay-by and its papers in hand, in the pack or in a boot. A
 * registered parcel opens the rotary dial first (ui/dial.ts) and needs the PIN printed on
 * its label. Worked with cargo for here, the window shows the HAND-IN card first: what to
 * put in the tray and what it pays, or why the tray will not take it.
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
  trayLabel: '▼ HAND CARGO IN HERE ▼',
} as const;
/** How the card's band reads each tier. */
const TIER_BAND: Readonly<Record<string, string>> = {
  'easy run': '#4f7a4a',
  'race · 1 stop': '#b0702a',
  'race · 2 stops': '#a2452f',
  'big haul': '#2f4f7a',
};

/** The cargo kind as the card prints it. */
function kindText(offer: ContractCargoItem): string {
  if (offer.party) return `passengers ×${offer.party.size}`;
  if (isHaulKind(offer.contractKind)) return 'haul';
  switch (offer.contractKind) {
    case 'fragile_radio':
      return 'fragile';
    case 'heavy_crate':
      return 'heavy';
    default:
      return 'parcel';
  }
}

/** What the hand-in card calls the thing to put in the tray. */
function cargoNoun(item: ContractCargoItem): string {
  if (item.party) return 'TEDDY';
  if (isHaulKind(item.contractKind)) return 'PAPERS';
  switch (item.contractKind) {
    case 'fragile_radio':
      return 'RADIO';
    case 'heavy_crate':
      return 'CRATE';
    default:
      return 'PARCEL';
  }
}

/**
 * The card the window shows first while the player works the machine with cargo for
 * here: what to put in the tray (`ok`), or why it will not take it. `key` tells two apart.
 */
interface HandInCard {
  readonly key: string;
  readonly ok: boolean;
  readonly headline: string;
  readonly lines: readonly string[];
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

/** A delivery the tray would take now: the cargo and where it is held. */
interface Posting {
  readonly item: ContractCargoItem;
  /** In the pack (or the hands), or in a car's boot cell or cabin place. */
  readonly from: { readonly carId: string; readonly cell: number; readonly cabin: boolean } | null;
}

class PostMachine extends CardMachine {
  protected readonly title = 'POST';
  /** The offer standing in each slot, and what an old save left inside. */
  private readonly offers: ContractCargoItem[];
  private strays: Item[];
  /** The registered parcel whose PIN was dialled here, so the tray takes it. */
  private dialledFor: string | null = null;
  /** The hand-in card, standing first among the cards while the machine is worked. */
  private handIn: HandInCard | null = null;

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
    this.start();
  }

  /** Writes the stock as it stands: the offer in each slot, nothing else. */
  private saveStock(extra?: { consumedItemId?: string; completedContractId?: string; completedContractKind?: ContractCargoItem['contractKind'] }): void {
    this.world.apply({ t: 'courier_storage', courierId: postId(this.stop.index), cells: this.offers.slice(), ...extra });
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
        band: card.ok ? '#2f6a3a' : '#7a3a2a',
        bandText: card.ok ? 'HAND IN' : 'NOT TAKEN HERE',
        corner: `1/${count}`,
        headline: card.headline,
        lines: card.lines,
        footer: card.ok ? 'the pay goes into the purse in the slot' : '',
      });
      return;
    }
    const offer = this.offers[index - this.lead];
    if (!offer) return;
    const km = (postStop(this.world.seed, offerDestinationIndex(offer)).s - this.stop.s) / 1000;
    const tier = contractTier(offer);
    const lines = [
      `→ ${offer.destination ?? 'the next post'} · ${km.toFixed(1)} km`,
      `${formatMoney(contractPay(this.world.seed, offer))} · ${kindText(offer)}`,
    ];
    if (offer.raceLegs) lines.push('a rival races you to it');
    if (offer.registeredPin) lines.push('registered — PIN on the label');
    if (isHaulKind(offer.contractKind)) lines.push('its load waits on the lay-by');
    paintCardFace(g, w, h, {
      band: TIER_BAND[tier] ?? '#4f5a66',
      bandText: tier.toUpperCase(),
      corner: `${index + 1}/${count}`,
      headline: offer.cargoName,
      lines,
      footer: `from ${placeNameAt(this.world.seed, this.stop.s)}`,
    });
  }

  protected pressButton(ctx: FixtureContext, index: number): FoleyEvent {
    // TAKE on the hand-in card: it is the tray that takes cargo in.
    if (this.handIn && index === 0) return this.refuse();
    const slot = index - this.lead;
    const offer = this.offers[slot];
    if (!offer) return 'click';
    // The stock first, so the cargo never exists twice: the slot's next offer stands in.
    this.offers[slot] = nextOffer(this.world.seed, offer);
    this.saveStock();
    this.cardsChanged();
    // A haul's papers fall into the tray like any cargo; its load is on the lay-by.
    this.give(ctx, isHaulKind(offer.contractKind) ? [offer] : contractRelease(offer));
    return 'mount';
  }

  override setFocused(focused: boolean, ctx: FixtureContext): void {
    super.setFocused(focused, ctx);
    // Let go of, the window goes back to the offers.
    if (!focused) this.showHandIn(null);
  }

  protected override onFocused(ctx: FixtureContext): void {
    this.showHandIn(this.handInCard(ctx));
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
      const completes = contractPosting(item, this.world.state.completedContractIds).completes;
      const lines = [
        item.cargoName,
        completes ? `pays ${formatMoney(contractPay(this.world.seed, item))}` : 'paid with the last of the party',
      ];
      if (item.registeredPin && this.dialledFor !== item.id) lines.push('registered — dial the PIN on its label');
      const headline = posting.from === null && ctx.held?.id === item.id
        ? `PUT THE ${cargoNoun(item)} IN THE TRAY`
        : 'CLICK THE TRAY TO HAND IT IN';
      return { key: `ok:${item.id}:${headline}:${lines.join('|')}`, ok: true, headline, lines };
    }
    if (refusal) return { key: `no:${refusal}`, ok: false, headline: 'THE TRAY WILL NOT TAKE IT', lines: [refusal] };
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

  /** What the tray would take: the cargo in hand, else a haul's papers bound here. */
  private posting(ctx: FixtureContext): { posting: Posting | null; refusal: string | null } {
    const held = ctx.held;
    if (held?.type === 'contract_cargo') {
      return { posting: { item: held, from: null }, refusal: contractAcceptRefusal(held, this.probe(ctx)) };
    }
    if (held !== null) return { posting: null, refusal: null };
    // Empty hands: a haul is handed in by its papers wherever they are, with its trailer
    // or car on the lay-by.
    let refusal: string | null = null;
    const consider = (item: Item | null, from: Posting['from']): Posting | null => {
      if (item?.type !== 'contract_cargo' || !isHaulKind(item.contractKind)) return null;
      // Papers from this post itself are the job just taken, not one to hand in.
      if (item.sourceCourierIndex >= this.stop.index) return null;
      const why = contractAcceptRefusal(item, this.probe(ctx));
      if (why === null) return { item, from };
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
    if (!posting || refusal) return posting || refusal ? 'refused' : null;
    const item = posting.item;
    if (item.registeredPin && this.dialledFor !== item.id) {
      const pin = item.registeredPin;
      ctx.dial(pin, () => {
        this.dialledFor = item.id;
        // Still in hand after the dial: posted at once.
        if (ctx.held?.id === item.id) this.useTray(ctx);
      });
      return 'click';
    }
    const probe = this.probe(ctx);
    const effect = contractDeliveryEffect(item, probe);
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
    // The completed id and the ledger first; the kind's own world change (the trailer or
    // car taken in) after it, so a crash between the halves cannot pay twice.
    this.saveStock({ consumedItemId: item.id, completedContractId: contractId, completedContractKind: item.contractKind });
    if (effect?.deltas) for (const delta of effect.deltas) this.world.apply(delta);
    ctx.give(item.id);
    // Into the purse in the slot, before the envelope drops and the machine lets go.
    ctx.credit(pay);
    const envelope: StickerEnvelopeItem = {
      type: 'sticker_envelope',
      id: `${contractId}:signed:${this.stop.index}`,
      stickerKind: contractRewardSticker(item),
      completedContractId: contractId,
    };
    this.give(ctx, [envelope]);
    return 'coin';
  }
}
