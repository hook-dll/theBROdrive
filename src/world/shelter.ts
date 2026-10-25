import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { SurfaceType } from '../core/surfaces';
import type { FoleyEvent } from '../audio/foley';
import { isPassenger, teddyId, teddyItem } from '../contracts/kinds/teddyPassengers';
import { offerDestinationIndex } from '../contracts/offers';
import { ACTIVE_CONTRACT_LIMIT, activeContracts } from '../contracts/registry';
import { shelterBench, teddySeating, type ShelterBench } from '../contracts/shelters';
import { formatClock, isLate } from '../contracts/types';
import { carUniqueness, contractPay, formatMoney, uniquenessBonus } from '../economy/economy';
import type { GameWorld } from '../game/state';
import { contractIdOf, type ContractCargoItem } from '../items/items';
import { createItemMesh, disposeItemMeshResources } from '../render/partmesh';
import type { ChunkContext } from './chunks';
import { rayBox, type FixtureContext, type FixtureField, type WorldFixture } from './fixturefield';
import { postParkingSlot } from './haulbay';
import { paintSign, repaintSign, SIGN_PLANE } from './market';
import { box, C, mergeKitStatics } from './poi/kit';
import { deliveryStickers, laybyCarId } from './post';
import { postStop, type PostStop } from './poststops';
import { addStatic, yawRotation } from './props/scatter';
import { SERVICE_HALF, spotPose, type SettlementSpot } from './settlement';

/**
 * THE TEDDY SHELTER (game-design2.md §6.3, §10): on every settlement's service strip at
 * its reserved spot (`SettlementLayout.shelter`), a bench under a lean-to tin canopy, open
 * all round. Two steel posts at the back carry everything: each has an arm out under the
 * seat with a strut beneath it, and at its top a rafter under the canopy, which falls to
 * the back so the rain runs off behind the bench and not onto the pad. No walls, no floor
 * slab: only the posts' concrete footings. It was a three-walled box (2026-10-24), and
 * "the stop is a massive box now — make it light: only a bench and a skewed roof over
 * it, two metal posts carrying both" (owner, 2026-10-25).
 * On the post at the waiting party's end hangs the timetable: where the party waiting
 * goes and how far, how many wait, what each pays (the lay-by car's sticker bonus in it,
 * as the post's cards print it), and the urgent clock or the race.
 *
 * The party's teddies sit on the bench (the teddy item's own model), left of its middle;
 * who is still there is read from the world (contracts/shelters.ts `shelterBench`), so a
 * teddy taken here or put back shows at once. F on a teddy takes it into the hands; F at
 * the shelter with a teddy in hand seats it (`teddySeating`): delivered and paid, put
 * back at its source, or refused with where it rides on to. Delivered teddies sit right
 * of the middle until the chunk is streamed out with the player long gone; they are not
 * saved.
 *
 * Shared kit materials, merged; only the timetable has its own painted board.
 */

// The shelter, local metres: the origin on the ground over the footprint's highest
// corner, at the canopy's centre; the open front (where one sits facing) to -Z.
/** The canopy's half width and half depth: the spot's footprint. */
const HALF_W = SERVICE_HALF.shelter[0];
const HALF_D = SERVICE_HALF.shelter[1];
const ROOF_T = 0.05;
/** The canopy's centre height (its underside's middle) and its fall to the back, rad. */
const ROOF_Y = 2.3;
const ROOF_PITCH = 0.12;
/** The rafters under the canopy, one on each post: their height and width. */
const RAFTER_H = 0.1;
const RAFTER_W = 0.06;
const RAFTER_Y = ROOF_Y - ROOF_T / 2 - RAFTER_H / 2;
/** The two posts: their x either side, their z behind the bench, their square section. */
const POST_X = 1.3;
const POST_Z = 0.42;
const POST_W = 0.08;
/** A post's top: where its rafter's middle line passes over it. */
const POST_TOP = RAFTER_Y - Math.tan(ROOF_PITCH) * POST_Z;
/** The bench: seat height and depth, its middle (just in front of the posts), its length. */
const SEAT_Y = 0.45;
const SEAT_D = 0.42;
const SEAT_Z = POST_Z - POST_W / 2 - 0.03 - SEAT_D / 2;
const BENCH_HALF_L = 1.6;
/** The backrest's two slats, bolted to the posts' fronts: their heights and their z. */
const BACK_SLATS = [0.66, 0.84] as const;
const BACK_Z = POST_Z - POST_W / 2 - 0.015;
/**
 * Places along the bench, round its middle: the waiting party's to the viewer's left of
 * it, its first place nearest, and the arrivals' as far to the right, so a party of one
 * sits near the middle and the two lots are told apart by the gap between them. They
 * were spread from end to end, and a lone teddy sat at the very end of the bench ("they
 * could sit closer to the centre", owner, 2026-10-26).
 */
const PLACES = 6;
const WAITING_PLACES = 3;
/** The nearest places' middles either side of the bench's, and the step out to the next. */
const PLACE_INNER = 0.3;
const PLACE_STEP = 0.4;
/** A teddy's middle across the seat, and how far its pick box reaches past its model all round. */
const TEDDY_Z = SEAT_Z + 0.02;
const TEDDY_PICK_MARGIN = 0.02;
/** The timetable: its board on the front of the post at the waiting places' end, over the backrest. */
const BOARD_W = 0.8;
const BOARD_H = 0.75;
const BOARD_X = -POST_X;
const BOARD_Y = 1.5;
const BOARD_Z = POST_Z - POST_W / 2 - 0.015;
const BOARD_PAINT = ['#f2ecd8', '#1f3f7a'] as const;
/** The bench and the board are read again this often, s. */
const REFRESH_S = 0.4;

/** The text of a shelter's timetable for `bench`, the pay read with `stickers`. */
function timetable(world: GameWorld, stop: PostStop, bench: ShelterBench, stickers: number): string[] {
  const party = bench.party;
  const km = (postStop(world.seed, offerDestinationIndex(party)).s - stop.s) / 1000;
  const waiting = bench.waiting.filter(Boolean).length;
  const bonus = uniquenessBonus(stickers);
  const lines = [
    `→ ${(party.destination ?? 'the next post').toUpperCase()}`,
    `${km.toFixed(1)} km · ${waiting === 0 ? 'nobody waiting' : `${waiting} waiting`}`,
    `${formatMoney(contractPay(world.seed, party, stickers))} a teddy${bonus > 0 ? ` · +${Math.round(bonus * 100)}%` : ''}`,
  ];
  if (party.raceLegs) lines.push(`RACE ${party.raceLegs} STOP${party.raceLegs > 1 ? 'S' : ''}`);
  if (party.urgentS !== undefined) lines.push(`URGENT ${formatClock(party.urgentS)}`);
  return lines;
}

/** Bench place `place`'s middle along the bench, local x. */
function placeX(place: number): number {
  const waiting = place < WAITING_PLACES;
  const out = PLACE_INNER + (waiting ? place : place - WAITING_PLACES) * PLACE_STEP;
  return waiting ? -out : out;
}

/**
 * A teddy's model, half its size (it is centred on its bounds), measured from the first
 * one built: it sits that high over the seat, and its pick box is it and the margin.
 */
let teddyHalf: THREE.Vector3 | null = null;

/** A teddy sitting on bench place `place`, facing the pad, hidden until shown. */
function seatedTeddy(root: THREE.Object3D, party: ContractCargoItem, place: number): THREE.Object3D {
  const mesh = createItemMesh(party);
  teddyHalf ??= new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3()).multiplyScalar(0.5);
  // As on a car seat (vehicle/cabincargo.ts): it receives shadows, it casts none.
  mesh.traverse((node) => {
    node.castShadow = false;
  });
  mesh.userData.kitKeep = true;
  mesh.position.set(placeX(place), SEAT_Y + teddyHalf.y, TEDDY_Z);
  mesh.rotation.y = Math.PI;
  mesh.visible = false;
  root.add(mesh);
  return mesh;
}

/**
 * Builds post stop `stop`'s shelter on its settlement spot `at`, its open front to the
 * pad. In the physics band it is solid and registers its fixture (id pushed to
 * `registered`); beyond it, it is only seen. `disposers` gets the board and the teddies.
 */
export function buildShelter(
  ctx: ChunkContext,
  stop: PostStop,
  at: SettlementSpot,
  group: THREE.Group,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
  fixtures: FixtureField,
  registered: string[],
  disposers: Array<() => void>,
): void {
  const { x, z, yaw } = spotPose(ctx.road, at);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // The ground over the highest corner; the footings reach under the lowest.
  let low = Infinity;
  let high = -Infinity;
  for (const [lx, lz] of [[-HALF_W, -HALF_D], [HALF_W, -HALF_D], [-HALF_W, HALF_D], [HALF_W, HALF_D]] as const) {
    const h = ctx.terrain.heightAt(x + c * lx + s * lz, z - s * lx + c * lz, at.s);
    low = Math.min(low, h);
    high = Math.max(high, h);
  }
  const y = high + 0.02;
  const footBottom = low - y - 0.15;

  const root = new THREE.Group();
  root.name = 'teddy-shelter';
  root.position.set(x - ctx.originX, y, z - ctx.originZ);
  root.rotation.y = yaw;

  // The bench's arm runs from the post's back out under the seat's front; its strut
  // from low on the post's front up to under the arm's front end.
  const armFront = SEAT_Z - SEAT_D / 2;
  const armLength = POST_Z + POST_W / 2 - armFront;
  const strutDz = armFront + 0.05 - (POST_Z - POST_W / 2);
  const strutDy = SEAT_Y - 0.1 - 0.15;
  const strutLength = Math.hypot(strutDz, strutDy);
  for (const sx of [-1, 1]) {
    const px = sx * POST_X;
    // The post in its concrete footing, up to its rafter under the canopy.
    box(root, [0.22, 0.05 - footBottom, 0.22], [px, (0.05 + footBottom) / 2, POST_Z], C.concrete);
    box(root, [POST_W, POST_TOP, POST_W], [px, POST_TOP / 2, POST_Z], C.darkMetal, undefined, false, 'metal');
    box(root, [RAFTER_W, RAFTER_H, 2 * HALF_D - 0.1], [px, RAFTER_Y, 0], C.darkMetal, [ROOF_PITCH, 0, 0], false, 'metal');
    box(root, [0.05, 0.06, armLength], [px, SEAT_Y - 0.07, armFront + armLength / 2], C.darkMetal, undefined, false, 'metal');
    box(root, [0.04, 0.04, strutLength], [px, 0.15 + strutDy / 2, POST_Z - POST_W / 2 + strutDz / 2], C.darkMetal, [Math.atan2(-strutDy, strutDz), 0, 0], false, 'metal');
  }
  // The tin canopy, falling to the back, and its fascia along the high front edge.
  box(root, [2 * HALF_W, ROOF_T, 2 * HALF_D], [0, ROOF_Y + ROOF_T / 2, 0], C.roofTin, [ROOF_PITCH, 0, 0], false, 'metal');
  box(
    root,
    [2 * HALF_W, 0.1, 0.03],
    [0, ROOF_Y + ROOF_T / 2 + HALF_D * Math.sin(ROOF_PITCH) - 0.03, -HALF_D * Math.cos(ROOF_PITCH) - 0.015],
    C.white,
  );
  // The bench: three slats on the arms, two for the back on the posts' fronts.
  for (const k of [-1, 0, 1]) box(root, [2 * BENCH_HALF_L, 0.04, SEAT_D / 3 - 0.02], [0, SEAT_Y - 0.02, SEAT_Z + (k * SEAT_D) / 3], C.timber);
  for (const by of BACK_SLATS) box(root, [2 * BENCH_HALF_L, 0.1, 0.03], [0, by, BACK_Z], C.timber);
  // The timetable's frame.
  box(root, [BOARD_W + 0.06, BOARD_H + 0.06, 0.03], [BOARD_X, BOARD_Y, BOARD_Z], C.darkTimber);

  const world = ctx.world;
  const bench = shelterBench(world.state, world.seed, stop.index);
  const bay = postParkingSlot(world.seed, ctx.road, stop.index, 'handIn');
  const stickersNow = (): number => {
    const car = laybyCarId(world.state, bay.x, bay.z, (id) => world.state.cars[id] ?? null);
    return car ? carUniqueness(world.state.cars[car]!) : 0;
  };
  const stickers = stickersNow();
  const boardMaterial = paintSign(timetable(world, stop, bench, stickers), ...BOARD_PAINT, 512, 480);
  const board = new THREE.Mesh(SIGN_PLANE, boardMaterial);
  board.userData.kitKeep = true;
  board.scale.set(BOARD_W, BOARD_H, 1);
  board.position.set(BOARD_X, BOARD_Y, BOARD_Z - 0.017);
  board.rotation.y = Math.PI;
  root.add(board);

  const teddies: THREE.Object3D[] = [];
  const places = ctx.hasPhysics ? PLACES : WAITING_PLACES;
  for (let place = 0; place < places; place++) teddies.push(seatedTeddy(root, bench.party, place));
  bench.waiting.forEach((waits, seat) => {
    teddies[seat]!.visible = waits;
  });
  disposers.push(() => {
    boardMaterial.map?.dispose();
    boardMaterial.dispose();
    for (const teddy of teddies) disposeItemMeshResources(teddy);
  });

  mergeKitStatics(root, { deep: true });
  group.add(root);

  if (!ctx.hasPhysics) return;
  const rotation = yawRotation(yaw);
  const solid = (lx: number, ly: number, lz: number, hx: number, hy: number, hz: number, rot = rotation): void => {
    addStatic(ctx, bodies, colliders, x + c * lx + s * lz, y + ly, z - s * lx + c * lz, RAPIER.ColliderDesc.cuboid(hx, hy, hz), SurfaceType.Concrete, rot);
  };
  for (const sx of [-1, 1]) solid(sx * POST_X, (POST_TOP + footBottom) / 2, POST_Z, POST_W / 2, (POST_TOP - footBottom) / 2, POST_W / 2);
  // The seat down to the ground, so nothing dropped rolls under it out of reach; the backrest.
  solid(0, SEAT_Y / 2, SEAT_Z, BENCH_HALF_L, SEAT_Y / 2, SEAT_D / 2);
  const backTop = BACK_SLATS[1] + 0.05;
  solid(0, (SEAT_Y + backTop) / 2, BACK_Z, BENCH_HALF_L, (backTop - SEAT_Y) / 2, 0.015);
  // The canopy, pitched with the yaw: a van's roof or a climber finds it.
  const pitched = new THREE.Quaternion().setFromEuler(new THREE.Euler(ROOF_PITCH, yaw, 0, 'YXZ'));
  solid(0, ROOF_Y + ROOF_T / 2, 0, HALF_W, ROOF_T / 2, HALF_D, { x: pitched.x, y: pitched.y, z: pitched.z, w: pitched.w });

  const shelter = new Shelter(world, stop, x, y, z, yaw, bay.x, bay.z, teddies, boardMaterial, stickersNow, bench, stickers);
  registered.push(fixtures.register(shelter));
}

/** What the last `aim` hit: a waiting teddy by its bench place, or the shelter. */
type Part = { readonly kind: 'teddy'; readonly seat: number } | { readonly kind: 'shelter' } | null;

class Shelter implements WorldFixture {
  readonly id: string;
  private part: Part = null;
  private refreshIn = REFRESH_S;
  /** The board's state as last painted: round, who waits, the stickers. */
  private paintedKey: string;
  /** Teddies delivered here this visit: the next one sits on arrival place `arrivals % 3`. */
  private arrivals = 0;

  constructor(
    private readonly world: GameWorld,
    private readonly stop: PostStop,
    /** The root's origin (on the ground at the canopy's centre), ABSOLUTE metres, and the front's yaw. */
    private readonly x: number,
    private readonly y: number,
    private readonly z: number,
    private readonly yaw: number,
    /** The post's haul bay, ABSOLUTE: where the lay-by car is looked for. */
    private readonly bayX: number,
    private readonly bayZ: number,
    /** The teddy on each bench place: the waiting party's, then the arrivals'. */
    private readonly teddies: readonly THREE.Object3D[],
    private readonly board: THREE.MeshStandardMaterial,
    /** The lay-by car's stickers from its saved pose, for the board. */
    private readonly boardStickers: () => number,
    private bench: ShelterBench,
    stickers: number,
  ) {
    this.id = `shelter:${stop.index}`;
    this.paintedKey = this.key(bench, stickers);
  }

  private key(bench: ShelterBench, stickers: number): string {
    return `${bench.round}|${bench.waiting.map((w) => (w ? 1 : 0)).join('')}|${stickers}`;
  }

  /** Reads the bench again; on a change, the teddies and the board follow. */
  private refresh(): void {
    this.bench = shelterBench(this.world.state, this.world.seed, this.stop.index);
    const stickers = this.boardStickers();
    const key = this.key(this.bench, stickers);
    if (key === this.paintedKey) return;
    this.paintedKey = key;
    for (let place = 0; place < WAITING_PLACES; place++) this.teddies[place]!.visible = this.bench.waiting[place] === true;
    repaintSign(this.board, timetable(this.world, this.stop, this.bench, stickers), ...BOARD_PAINT);
  }

  update(dt: number): void {
    this.refreshIn -= dt;
    if (this.refreshIn > 0) return;
    this.refreshIn = REFRESH_S;
    this.refresh();
  }

  aim(
    originX: number,
    originZ: number,
    eyeX: number,
    eyeY: number,
    eyeZ: number,
    dx: number,
    dy: number,
    dz: number,
    range: number,
  ): number {
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    const rx = eyeX + originX - this.x;
    const rz = eyeZ + originZ - this.z;
    const ox = c * rx - s * rz;
    const oy = eyeY - this.y;
    const oz = s * rx + c * rz;
    const lx = c * dx - s * dz;
    const lz = s * dx + c * dz;
    // A waiting teddy wins over the shelter round it. Its model was measured as the
    // bench was built, before this fixture.
    let best = Infinity;
    let part: Part = null;
    const half = teddyHalf;
    this.bench.waiting.forEach((waits, seat) => {
      if (!waits || !half) return;
      const hx = half.x + TEDDY_PICK_MARGIN;
      const hy = half.y + TEDDY_PICK_MARGIN;
      const hz = half.z + TEDDY_PICK_MARGIN;
      const hit = rayBox(ox, oy, oz, lx, dy, lz, placeX(seat), SEAT_Y + half.y, TEDDY_Z, hx, hy, hz);
      if (hit < best) {
        best = hit;
        part = { kind: 'teddy', seat };
      }
    });
    if (best > range) {
      // The bench's seat and backrest, the posts and the timetable: not the air under the
      // canopy, so a thing lying on the ground or on the seat is still picked up before
      // the shelter.
      const seat = rayBox(ox, oy, oz, lx, dy, lz, 0, SEAT_Y / 2, SEAT_Z, BENCH_HALF_L, SEAT_Y / 2, SEAT_D / 2);
      const backTop = BACK_SLATS[1] + 0.05;
      const back = rayBox(ox, oy, oz, lx, dy, lz, 0, (SEAT_Y + backTop) / 2, BACK_Z, BENCH_HALF_L, (backTop - SEAT_Y) / 2, 0.03);
      const board = rayBox(ox, oy, oz, lx, dy, lz, BOARD_X, BOARD_Y, BOARD_Z, BOARD_W / 2 + 0.03, BOARD_H / 2 + 0.03, 0.03);
      best = Math.min(seat, back, board);
      for (const sx of [-1, 1]) {
        best = Math.min(best, rayBox(ox, oy, oz, lx, dy, lz, sx * POST_X, POST_TOP / 2, POST_Z, POST_W / 2 + 0.02, POST_TOP / 2, POST_W / 2 + 0.02));
      }
      part = { kind: 'shelter' };
    }
    this.part = best > range ? null : part;
    return best > range ? Infinity : best;
  }

  /** The stickers a delivery here is paid by, the lay-by car read live (world/post.ts `deliveryStickers`). */
  private stickers(ctx: FixtureContext): number {
    const probe = ctx.probe(this.stop.index, this.bayX, this.bayZ);
    return deliveryStickers(this.world.state, laybyCarId(this.world.state, this.bayX, this.bayZ, (id) => probe.carPosition(id)));
  }

  /** Why the waiting teddy cannot be taken now, or null: the limit, for the first of a party. */
  private takeRefusal(): string | null {
    const active = activeContracts(this.world.state);
    if (!active.all.has(this.bench.party.id) && active.all.size >= ACTIVE_CONTRACT_LIMIT) return 'three jobs out — hand one in or return it';
    return null;
  }

  /** The teddy in hand, when it is one and F seats it here rather than taking another. */
  private heldTeddy(ctx: FixtureContext): ContractCargoItem | null {
    const held = ctx.held;
    if (held?.type !== 'contract_cargo' || !isPassenger(held)) return null;
    // At a teddy of the bench, F takes it, unless the one in hand is delivered here.
    if (this.part?.kind === 'teddy' && teddySeating(this.world.state, held, this.stop.index).mode !== 'deliver') return null;
    return held;
  }

  prompt(ctx: FixtureContext): string | null {
    const party = this.bench.party;
    const to = party.destination ?? 'the next post';
    const held = this.heldTeddy(ctx);
    if (held) {
      const seating = teddySeating(this.world.state, held, this.stop.index);
      if (seating.mode === 'refuse') return seating.why;
      if (seating.mode === 'return') return '[F] put the teddy back — no pay';
      const late = isLate(held) ? ' · late' : '';
      return `[F] seat the teddy — ${formatMoney(contractPay(this.world.seed, held, this.stickers(ctx)))}${late}`;
    }
    if (this.part?.kind === 'teddy') {
      const why = this.takeRefusal();
      if (why) return `teddy → ${to} — ${why}`;
      return `[F] take the teddy → ${to}`;
    }
    const waiting = this.bench.waiting.filter(Boolean).length;
    return `teddy shelter → ${to} · ${waiting === 0 ? 'nobody waiting' : `${waiting} waiting`}`;
  }

  press(ctx: FixtureContext): FoleyEvent | null {
    const held = this.heldTeddy(ctx);
    if (held) return this.seat(ctx, held);
    if (this.part?.kind !== 'teddy') return null;
    return this.take(ctx, this.part.seat);
  }

  /** F on the waiting teddy on bench place `seat`: into the hands. */
  private take(ctx: FixtureContext, seat: number): FoleyEvent {
    this.refresh();
    if (this.bench.waiting[seat] !== true) return 'refused';
    const why = this.takeRefusal();
    if (why) {
      ctx.toast(why);
      return 'refused';
    }
    const teddy = teddyItem(this.bench.party, seat);
    // A party races once, and its first teddy delivered decided it: one taken after that
    // is no fresh start for the rivals (contracts/race.ts `observe`).
    const party = this.bench.party;
    if (party.raceLegs !== undefined && this.bench.waiting.some((_, k) => this.world.state.completedContractIds.includes(teddyId(party.id, k)))) {
      teddy.progress.started = true;
    }
    if (!ctx.inventory.add(teddy)) {
      ctx.toast('hands full');
      return 'refused';
    }
    this.refresh();
    return 'pickup';
  }

  /** F with `teddy` in hand: seated here, delivered or put back, or refused. */
  private seat(ctx: FixtureContext, teddy: ContractCargoItem): FoleyEvent {
    const seating = teddySeating(this.world.state, teddy, this.stop.index);
    if (seating.mode === 'refuse') {
      ctx.toast(seating.why);
      return 'refused';
    }
    const partyId = contractIdOf(teddy);
    const delivered = seating.mode === 'deliver';
    // Read before anything changes: the stickers, the race the first delivery decides.
    const pay = delivered ? contractPay(this.world.seed, teddy, this.stickers(ctx)) + ctx.racePay(partyId) : 0;
    // Recorded first, then paid: a failure between cannot pay twice.
    this.world.apply({
      t: 'teddy_seat',
      teddyId: teddy.id,
      partyId,
      sourcePost: seating.sourcePost,
      round: seating.round,
      delivered,
      close: seating.close,
    });
    ctx.give(teddy.id);
    if (delivered) {
      ctx.credit(pay);
      const arrival = this.teddies[WAITING_PLACES + (this.arrivals % (PLACES - WAITING_PLACES))];
      this.arrivals++;
      if (arrival) arrival.visible = true;
      ctx.toast(`teddy seated — ${formatMoney(pay)}${seating.close ? ' · job done' : ''}`);
    } else {
      ctx.toast(seating.close ? 'teddy back on the bench — the job is off your list' : 'teddy back on the bench — no pay');
    }
    this.refresh();
    return delivered ? 'coin' : 'drop';
  }
}
