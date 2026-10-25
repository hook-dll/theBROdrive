/**
 * THE HAUL BAYS AT WORK (game-design2.md §7.8): a haul's load waits in its source post's
 * bay before its card is taken, and is handed in by reversing it into another post's.
 *
 * WAITING. While a post's bulky card (`HAUL_SLOT`) shows a haul, its machine is streamed in
 * (the chunk is solid), the player is within `SPAWN_M` and the bay is empty (`bayOccupied`:
 * no car, trailer or player on its floor), the load is stood in the bay as if reversed in
 * (contracts/world.ts `spawnHaulLoad`), from the offer alone. A waiting load the player has
 * left `WAITING_CLEAR_M` behind is taken out of the world again, and comes back the same
 * when he returns. A taken card's next haul appears only once the bay is empty again.
 *
 * THE HAND-IN, every tick for each taken haul's load while it is live:
 *  - it stands at a bay: its footprint (`loadFootprint`) within `NEAR_M` of the bay's floor;
 *  - it ENTERED REVERSING: the moment its tail crossed into the bay, it was moving tail
 *    first (its motion along its own heading negative). A tail that leaves the bay forgets
 *    it; a load first seen with its tail already inside (the source bay it waited in, a
 *    reload) has no entry and is neither accepted nor told off;
 *  - all of its footprint is inside the bay's floor and its heading is within
 *    `BAY_YAW_TOLERANCE` of nose out (`bayFit`);
 *  - its kind has no objection (contracts/kinds: step out of a car to hand it over, empty
 *    its boot and seats);
 *  - it has stood still (under `STILL_KMH`) for `ACCEPT_STILL_S`.
 * Then it is uncoupled (the trailer off the ball, the tow bar off), the contract closes
 * (`haul_close`) and the load stays in the bay locked for good (contracts/world.ts
 * `haulLoadLock`), until the player is `CLEAR_M` away and it is out of view: then it goes.
 *
 * DESTINATION OR RETURN. The same reverse-in at a post that may sign for the haul
 * (`contractDestinationRefusal`: any post past its source, a race's from its finish on)
 * is a DELIVERY and pays `contractPay` (urgent bonus, the pulling car's stickers) plus a
 * race win; at ANY other post, its source included, it is a RETURN TO SENDER: no pay, the
 * contract closed. A post's bay is the one or the other, never both: the destination
 * always wins.
 *
 * While the load stands still at a bay and is not accepted, the reason is told once in a
 * toast (again after `RETELL_S`): back it in, straighten up, all the way in, step out,
 * empty it — and "not this job's trailer" for a trailer or towed car behind the player's
 * car that is not the load of the haul he has out.
 */

import { carUniqueness, contractPay, credit, formatMoney } from '../economy/economy';
import type { GameWorld, WorldState } from '../game/state';
import { contractKindOf, contractThing, isHaul } from '../items/items';
import { carModelMeasure } from '../render/carmodel';
import { hasCarModel } from '../vehicle/carmodels';
import { TRAILER_BALL_Z, TRAILER_HALF_LENGTH, TRAILER_HALF_WIDTH } from '../vehicle/trailer';
import { postHaulBay, type HaulBay } from '../world/haulbay';
import { LAYBY_CAR_RANGE_M } from '../world/post';
import { postStopsBetween } from '../world/poststops';
import { HAUL_SLOT, postStock } from './offers';
import { contractDestinationRefusal, contractKindRefusal } from './registry';
import type { DeliveryProbe } from './types';
import { boundHaul, haulLoadId, isHaulLoadId, spawnHaulLoad, type ContractWorldDeps } from './world';

/** How far off nose out a load may stand in the bay and be accepted, radians. */
export const BAY_YAW_TOLERANCE = (20 * Math.PI) / 180;
/** Still: slower than this, km/h. */
const STILL_KMH = 0.5;
const STILL_MPS = STILL_KMH / 3.6;
/** Stood still in the bay this long, the load is accepted, s. */
const ACCEPT_STILL_S = 2;
/** Stood still at a bay this long, the reason it is not accepted is told, s. */
const TELL_STILL_S = 1;
/** The same reason is told again after this long, s. */
const RETELL_S = 6;
/** A load is at a bay when its footprint comes this close to the bay's floor, m. */
const NEAR_M = 1.5;
/** The tail counts as inside the opening this far either side of the floor, m: a load backing in askew. */
const TAIL_SLACK_M = 0.5;
/** Bays this far along the road either way are looked at, m. */
const BAY_REACH_M = 1200;
/**
 * A waiting load is stood in its bay only with the player this close, m: well inside the
 * nearest the solid desert ever ends (world/ranges.ts `DESERT_SOLID_REACH_M`, 480 m).
 */
const SPAWN_M = 400;
/** A waiting load the player is this far from is taken out of the world, m. */
const WAITING_CLEAR_M = 900;
/** A handed-in load goes once the player is this far from it and it is out of view, m. */
const CLEAR_M = 150;
/** Closer than this, a waiting load is not stood in a bay the player is looking at, m. */
const SEEN_SPAWN_M = 200;
/** Spawns and clearing-away run this often, s. */
const SCAN_S = 0.5;
/** The floor counts as taken this far past its walls, m. */
const OCCUPIED_MARGIN_M = 0.2;

const BACK_IT_IN = 'back it in';
const STRAIGHTEN = "doesn't fit — straighten up";
const FURTHER = 'not all the way in — back it further';

/** Where a load stands: ABSOLUTE metres of its body's origin, its heading (+Z its nose) and velocity. */
export interface LoadPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  vx: number;
  vz: number;
}

/** A load's outline on the ground in its own frame, metres: +Z its nose, the origin its body's. */
export interface Footprint {
  /** Its nose's (a trailer's ball's) distance ahead of the origin. */
  readonly front: number;
  /** Its tail's, negative: behind the origin. */
  readonly rear: number;
  /** Half its width. */
  readonly half: number;
}

/** Where a bay is, for the geometry below: `HaulBay` is one. */
export interface BayRect {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly halfWidth: number;
  readonly halfDepth: number;
}

/**
 * How a load stands in a bay: `in`, all of it inside and within `BAY_YAW_TOLERANCE` of
 * nose out; `short`, square but its nose still out of the opening; `skewed`, turned off
 * nose out or out over a side; `nose-in`, turned round, its nose to the back wall.
 */
export type BayFit = 'in' | 'short' | 'skewed' | 'nose-in';

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** Heading of a body turned by a quaternion: its +Z on the ground. */
export function yawOfQuaternion(qx: number, qy: number, qz: number, qw: number): number {
  return Math.atan2(2 * (qx * qz + qw * qy), 1 - 2 * (qx * qx + qy * qy));
}

const scratch = { x: 0, z: 0 };

/** Bay-local metres of an ABSOLUTE point: x across the floor, z out of the opening. */
function toBay(bay: BayRect, px: number, pz: number, out: { x: number; z: number }): void {
  const dx = px - bay.x;
  const dz = pz - bay.z;
  const s = Math.sin(bay.yaw);
  const c = Math.cos(bay.yaw);
  out.z = dx * s + dz * c;
  out.x = dx * c - dz * s;
}

/** Corner `k` (0..3) of a footprint at `pose`, ABSOLUTE. */
function corner(pose: LoadPose, foot: Footprint, k: number, out: { x: number; z: number }): void {
  const lx = (k & 1 ? 1 : -1) * foot.half;
  const lz = k & 2 ? foot.front : foot.rear;
  const s = Math.sin(pose.yaw);
  const c = Math.cos(pose.yaw);
  out.x = pose.x + lx * c + lz * s;
  out.z = pose.z - lx * s + lz * c;
}

/** How a load with footprint `foot` at `pose` stands in `bay`; see `BayFit`. */
export function bayFit(bay: BayRect, pose: LoadPose, foot: Footprint): BayFit {
  const off = wrapAngle(pose.yaw - bay.yaw);
  if (Math.abs(off) > Math.PI / 2) return 'nose-in';
  let across = false;
  let along = false;
  for (let k = 0; k < 4; k++) {
    corner(pose, foot, k, scratch);
    toBay(bay, scratch.x, scratch.z, scratch);
    if (Math.abs(scratch.x) > bay.halfWidth) across = true;
    if (Math.abs(scratch.z) > bay.halfDepth) along = true;
  }
  if (across || Math.abs(off) > BAY_YAW_TOLERANCE) return 'skewed';
  return along ? 'short' : 'in';
}

/**
 * Whether two rectangles on the ground overlap (separating axes): each a centre, a
 * heading (+Z ahead) and half its width and length.
 */
function rectsOverlap(
  ax: number, az: number, ayaw: number, ahx: number, ahz: number,
  bx: number, bz: number, byaw: number, bhx: number, bhz: number,
): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  const as = Math.sin(ayaw);
  const ac = Math.cos(ayaw);
  const bs = Math.sin(byaw);
  const bc = Math.cos(byaw);
  // Each rectangle's across (cos, -sin) and ahead (sin, cos) axes.
  const axes = [ac, -as, as, ac, bc, -bs, bs, bc];
  for (let i = 0; i < 8; i += 2) {
    const nx = axes[i]!;
    const nz = axes[i + 1]!;
    const ra = ahx * Math.abs(ac * nx - as * nz) + ahz * Math.abs(as * nx + ac * nz);
    const rb = bhx * Math.abs(bc * nx - bs * nz) + bhz * Math.abs(bs * nx + bc * nz);
    if (Math.abs(dx * nx + dz * nz) > ra + rb) return false;
  }
  return true;
}

/** Whether a footprint at `pose` overlaps `bay`'s floor grown by `margin` all round. */
export function footprintTouchesBay(bay: BayRect, pose: LoadPose, foot: Footprint, margin: number): boolean {
  const mid = (foot.front + foot.rear) / 2;
  return rectsOverlap(
    bay.x, bay.z, bay.yaw, bay.halfWidth + margin, bay.halfDepth + margin,
    pose.x + Math.sin(pose.yaw) * mid, pose.z + Math.cos(pose.yaw) * mid, pose.yaw, foot.half, (foot.front - foot.rear) / 2,
  );
}

/**
 * The outline of trailer or car `id` (vehicle/trailer.ts: the tailboard, or the long load
 * when it overhangs, to the ball; render/carmodel.ts: a car's measured body), or null for
 * an id that is neither.
 */
export function loadFootprint(state: WorldState, id: string): Footprint | null {
  const trailer = state.trailers[id];
  if (trailer) {
    // A load longer than the box stays centred on it (`Trailer.cargoZ`).
    const load = trailer.load?.halfExtents;
    return {
      front: TRAILER_BALL_Z,
      rear: -Math.max(TRAILER_HALF_LENGTH, load ? load[2] : 0),
      half: Math.max(TRAILER_HALF_WIDTH, load ? load[0] : 0),
    };
  }
  const car = state.cars[id];
  if (!car || !hasCarModel(car.modelId)) return null;
  const [hx, , hz] = carModelMeasure(car.modelId).halfExtents;
  return { front: hz, rear: -hz, half: hx };
}

/** What the bays need of the running game (main.ts). */
export interface HaulBayHost {
  /** Fills `out` with the live pose of materialised car or trailer `id`; false when it is not materialised. */
  livePose(id: string, out: LoadPose): boolean;
  /** Post `index`'s machine is streamed in: its chunk is solid (world/fixturefield.ts). */
  postLive(index: number): boolean;
  /** Drops whatever couples load `id`: a trailer's ball, a tow bar. Recorded. */
  uncouple(id: string): void;
  /** A sphere at ABSOLUTE metres is in the camera's view. */
  inView(x: number, y: number, z: number, radius: number): boolean;
  /** Rubles a race win adds for handing `contractId` in now (contracts/race.ts). */
  racePay(contractId: string): number;
  toast(text: string): void;
}

/** What the bays remember of one load at a bay between ticks. */
interface Watch {
  /** The post whose bay it is at, or -1. */
  bay: number;
  /** It entered that bay reversing (true), forwards (false), or its entry was not seen (null). */
  reversed: boolean | null;
  /** Its tail was outside the bay at the last tick; null before the first look. */
  tailOut: boolean | null;
  /** Its origin at the last tick, ABSOLUTE. */
  px: number;
  pz: number;
  /** Seconds it has stood still. */
  still: number;
  /** The reason last told, and how long ago. */
  told: string | null;
  toldAgo: number;
  /** The tick it was last looked at; a watch not looked at this tick is dropped. */
  seen: number;
}

type MutableProbe = { -readonly [K in keyof DeliveryProbe]: DeliveryProbe[K] };

export class HaulBays {
  private readonly bays = new Map<number, HaulBay>();
  private readonly watches = new Map<string, Watch>();
  private scanIn = 0;
  private tickNo = 0;
  private readonly pose: LoadPose = { x: 0, y: 0, z: 0, yaw: 0, vx: 0, vz: 0 };
  private readonly other: LoadPose = { x: 0, y: 0, z: 0, yaw: 0, vx: 0, vz: 0 };
  private readonly probe: MutableProbe;

  constructor(
    private readonly deps: ContractWorldDeps,
    private readonly host: HaulBayHost,
  ) {
    this.probe = {
      targetPostIndex: -1,
      postX: 0,
      postZ: 0,
      drivingCarId: null,
      trailerPosition: (id) => (this.state.trailers[id] && this.poseOf(id, this.other) ? { x: this.other.x, z: this.other.z } : null),
      carPosition: (id) => (this.state.cars[id] && this.poseOf(id, this.other) ? { x: this.other.x, z: this.other.z } : null),
      car: (id) => this.state.cars[id] ?? null,
    };
  }

  private get world(): GameWorld {
    return this.deps.world;
  }

  private get state(): WorldState {
    return this.deps.world.state;
  }

  /**
   * One fixed step, after the physics and the contract walk: (`x`, `z`) is where the
   * player is, ABSOLUTE (his car when he drives), and `s` its arclength.
   */
  tick(dt: number, x: number, z: number, s: number): void {
    this.tickNo++;
    this.scanIn -= dt;
    if (this.scanIn <= 0) {
      this.scanIn = SCAN_S;
      this.refreshBays(s);
      this.spawnWaiting(x, z);
      this.clearAway(x, z);
    }
    if (this.bays.size === 0) {
      this.watches.clear();
      return;
    }
    for (const [contractId, haul] of Object.entries(this.state.hauls)) {
      this.watchLoad(dt, haul.loadId, contractId);
    }
    this.watchStrangers(dt);
    for (const [id, watch] of this.watches) {
      if (watch.seen !== this.tickNo) this.watches.delete(id);
    }
  }

  /** The bays of the posts within `BAY_REACH_M` of arclength `s`. */
  private refreshBays(s: number): void {
    const near = postStopsBetween(this.world.seed, s - BAY_REACH_M, s + BAY_REACH_M);
    const keep = new Set<number>();
    for (const stop of near) {
      keep.add(stop.index);
      if (!this.bays.has(stop.index)) this.bays.set(stop.index, postHaulBay(this.world.seed, this.deps.road, stop.index));
    }
    for (const index of this.bays.keys()) {
      if (!keep.has(index)) this.bays.delete(index);
    }
  }

  /** Fills `out` with where `id` stands: live, else as saved and at rest. False when it is neither a car nor a trailer. */
  private poseOf(id: string, out: LoadPose): boolean {
    if (this.host.livePose(id, out)) return true;
    const saved = this.state.cars[id] ?? this.state.trailers[id];
    if (!saved) return false;
    out.x = saved.x;
    out.y = saved.y;
    out.z = saved.z;
    out.yaw = yawOfQuaternion(saved.qx, saved.qy, saved.qz, saved.qw);
    out.vx = 0;
    out.vz = 0;
    return true;
  }

  /** Anything standing on `bay`'s floor: a car, a trailer, or the player at (`x`, `z`). */
  private bayOccupied(bay: HaulBay, x: number, z: number): boolean {
    toBay(bay, x, z, scratch);
    if (Math.abs(scratch.x) < bay.halfWidth + 1 && Math.abs(scratch.z) < bay.halfDepth + 1) return true;
    for (const id of [...Object.keys(this.state.cars), ...Object.keys(this.state.trailers)]) {
      const foot = loadFootprint(this.state, id);
      if (!foot || !this.poseOf(id, this.other)) continue;
      if (footprintTouchesBay(bay, this.other, foot, OCCUPIED_MARGIN_M)) return true;
    }
    return false;
  }

  /** Stands each streamed-in post's waiting haul in its empty bay; see the header. */
  private spawnWaiting(x: number, z: number): void {
    const state = this.state;
    for (const [index, bay] of this.bays) {
      const d = Math.hypot(bay.x - x, bay.z - z);
      if (d > SPAWN_M || !this.host.postLive(index)) continue;
      // Nothing appears where it is seen up close: it waits for a look away.
      if (d < SEEN_SPAWN_M && this.host.inView(bay.x, this.deps.terrain.heightAt(bay.x, bay.z, bay.s) + 1, bay.z, 4)) continue;
      const offer = postStock(state, this.world.seed, index, false).offers[HAUL_SLOT];
      if (!offer || !isHaul(offer) || state.hauls[offer.id] || state.completedContractIds.includes(offer.id)) continue;
      const id = haulLoadId(offer);
      if (state.trailers[id] || state.cars[id] || this.bayOccupied(bay, x, z)) continue;
      spawnHaulLoad(this.deps, offer);
    }
  }

  /** Takes out of the world the handed-in loads the player has left, and the waiting ones far behind. */
  private clearAway(x: number, z: number): void {
    const state = this.state;
    const gone = (id: string): void => {
      if (state.trailers[id]) this.world.apply({ t: 'trailer_remove', trailerId: id });
      else this.world.apply({ t: 'car_remove', carId: id });
    };
    for (const id of Object.keys(state.handedInLoads)) {
      if (!this.poseOf(id, this.pose)) continue;
      if (Math.hypot(this.pose.x - x, this.pose.z - z) <= CLEAR_M) continue;
      if (this.host.inView(this.pose.x, this.pose.y, this.pose.z, 4)) continue;
      gone(id);
    }
    for (const id of [...Object.keys(state.trailers), ...Object.keys(state.cars)]) {
      if (!isHaulLoadId(id) || state.handedInLoads[id] !== undefined || boundHaul(state, id)) continue;
      if (!this.poseOf(id, this.pose) || Math.hypot(this.pose.x - x, this.pose.z - z) <= WAITING_CLEAR_M) continue;
      gone(id);
    }
  }

  /** The post whose bay a footprint at `pose` is at (within `NEAR_M`), or -1. */
  private bayAt(pose: LoadPose, foot: Footprint): number {
    for (const [index, bay] of this.bays) {
      if (footprintTouchesBay(bay, pose, foot, NEAR_M)) return index;
    }
    return -1;
  }

  /**
   * Follows `id` at the bays this tick: which bay it is at, how its tail came in, how long
   * it has stood. Null when it is not live or not at a bay.
   */
  private follow(dt: number, id: string, foot: Footprint): Watch | null {
    const pose = this.pose;
    if (!this.host.livePose(id, pose)) return null;
    let watch = this.watches.get(id);
    if (!watch) {
      watch = { bay: -1, reversed: null, tailOut: null, px: pose.x, pz: pose.z, still: 0, told: null, toldAgo: 0, seen: 0 };
      this.watches.set(id, watch);
    }
    watch.seen = this.tickNo;
    const index = this.bayAt(pose, foot);
    if (index !== watch.bay) {
      watch.bay = index;
      watch.reversed = null;
      watch.tailOut = null;
      watch.told = null;
    }
    if (index >= 0) {
      const bay = this.bays.get(index)!;
      const s = Math.sin(pose.yaw);
      const c = Math.cos(pose.yaw);
      toBay(bay, pose.x + s * foot.rear, pose.z + c * foot.rear, scratch);
      const inside = scratch.z < bay.halfDepth && Math.abs(scratch.x) < bay.halfWidth + TAIL_SLACK_M;
      if (inside && watch.tailOut === true) {
        // The tail crossed into the bay this tick: which way along its own heading it moved.
        watch.reversed = (pose.x - watch.px) * s + (pose.z - watch.pz) * c < 0;
      } else if (!inside) {
        watch.reversed = null;
      }
      watch.tailOut = !inside;
    }
    watch.px = pose.x;
    watch.pz = pose.z;
    watch.still = Math.hypot(pose.vx, pose.vz) < STILL_MPS ? watch.still + dt : 0;
    watch.toldAgo += dt;
    return index >= 0 ? watch : null;
  }

  /** Tells `why` once the load has stood a moment, and again after `RETELL_S`. */
  private tell(watch: Watch, why: string): void {
    if (watch.still < TELL_STILL_S || (why === watch.told && watch.toldAgo < RETELL_S)) return;
    watch.told = why;
    watch.toldAgo = 0;
    this.host.toast(why);
  }

  /** A taken haul's load at a bay: told off, or accepted; see the header. */
  private watchLoad(dt: number, loadId: string, contractId: string): void {
    const foot = loadFootprint(this.state, loadId);
    if (!foot) return;
    const watch = this.follow(dt, loadId, foot);
    if (!watch) return;
    // Its entry not seen (the source bay it waited in, a reload): nothing to judge.
    if (watch.reversed === null) return;
    const bay = this.bays.get(watch.bay)!;
    const haul = this.state.hauls[contractId]!;
    const fit = bayFit(bay, this.pose, foot);
    let why: string | null;
    if (fit === 'nose-in' || !watch.reversed) why = BACK_IT_IN;
    else if (fit === 'skewed') why = STRAIGHTEN;
    else if (fit === 'short') why = FURTHER;
    else why = contractKindRefusal(haul.contract, this.probeAt(watch.bay, bay));
    if (why !== null) {
      this.tell(watch, why);
      return;
    }
    if (watch.still >= ACCEPT_STILL_S) this.accept(contractId, watch.bay, bay);
  }

  /**
   * A trailer on the ball of the car the player drives, or a car on its bar, that is not
   * the load of a haul taken: "not this job's" at a bay, while a haul is out.
   */
  private watchStrangers(dt: number): void {
    const state = this.state;
    const driving = state.player.drivingCarId;
    if (driving === null || Object.keys(state.hauls).length === 0) return;
    const check = (id: string, what: string): void => {
      if (boundHaul(state, id)) return;
      const foot = loadFootprint(state, id);
      const watch = foot ? this.follow(dt, id, foot) : null;
      if (watch) this.tell(watch, `not this job's ${what}`);
    };
    for (const trailer of Object.values(state.trailers)) {
      if (trailer.hitchedTo === driving) check(trailer.id, 'trailer');
    }
    for (const car of Object.values(state.cars)) {
      if (car.towedBy === driving) check(car.id, 'car');
    }
  }

  /** The hand-in view at post `index`'s bay, for the kinds' own rules. */
  private probeAt(index: number, bay: HaulBay): DeliveryProbe {
    const probe = this.probe;
    probe.targetPostIndex = index;
    probe.postX = bay.x;
    probe.postZ = bay.z;
    probe.drivingCarId = this.state.player.drivingCarId;
    return probe;
  }

  /**
   * The stickers a delivery in `bay` is paid by: the car pulling the load (its trailer's
   * ball, its tow bar), else the player's own car standing nearest the bay within
   * `LAYBY_CAR_RANGE_M` (a car driven over came without one), else none.
   */
  private deliveryStickers(loadId: string, bay: HaulBay): number {
    const state = this.state;
    const pullerId = state.trailers[loadId]?.hitchedTo ?? state.cars[loadId]?.towedBy ?? null;
    const puller = pullerId ? state.cars[pullerId] : undefined;
    if (puller) return carUniqueness(puller);
    let best = 0;
    let bestD = LAYBY_CAR_RANGE_M;
    for (const car of Object.values(state.cars)) {
      if (!car.papers) continue;
      const d = Math.hypot(car.x - bay.x, car.z - bay.z);
      if (d > bestD) continue;
      bestD = d;
      best = carUniqueness(car);
    }
    return best;
  }

  /** Accepts the load of `contractId` in post `index`'s `bay`: delivered, or returned to its sender. */
  private accept(contractId: string, index: number, bay: HaulBay): void {
    const haul = this.state.hauls[contractId]!;
    const contract = haul.contract;
    const delivered = contractDestinationRefusal(contract, index) === null;
    // Read before anything changes: the puller's stickers, the race the hand-in ends.
    const pay = delivered
      ? contractPay(this.world.seed, contract, this.deliveryStickers(haul.loadId, bay)) + this.host.racePay(contractId)
      : 0;
    this.host.uncouple(haul.loadId);
    // The contract closed first, then paid: a failure between cannot pay twice.
    this.world.apply({ t: 'haul_close', contractId, postIndex: index, deliveredKind: delivered ? contractKindOf(contract) : null });
    credit(this.world, pay);
    this.watches.delete(haul.loadId);
    const name = contractThing(contract).name;
    this.host.toast(delivered ? `${name} handed in — ${formatMoney(pay)}` : `${name} back to the sender — no pay`);
  }
}
