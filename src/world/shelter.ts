import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { SurfaceType } from '../core/surfaces';
import type { FoleyEvent } from '../audio/foley';
import { isPassenger } from '../contracts/kinds/teddyPassengers';
import { offerDestinationIndex } from '../contracts/offers';
import { ACTIVE_CONTRACT_LIMIT, activeContracts } from '../contracts/registry';
import { abandonedTeddies, shelterBench, teddyAbandon, teddyGetOff, type ShelterBench, type TeddyGetOff } from '../contracts/shelters';
import { formatClock, isLate } from '../contracts/types';
import { contractPay, credit, fine, FINE_SHELLS, formatFine, formatPay } from '../economy/economy';
import type { GameWorld } from '../game/state';
import type { ContractCargoItem } from '../items/items';
import type { LoosePartField } from '../parts/loose';
import { createItemMesh, disposeItemMeshResources } from '../render/partmesh';
import { createWavingTeddy, TEDDY_WAVE_SIDE, type WavingTeddy } from '../render/thingmesh';
import type { ChunkContext } from './chunks';
import { rayBox, type FixtureContext, type FixtureField, type WorldFixture } from './fixturefield';
import { paintSign, repaintSign, SIGN_PLANE } from './market';
import { box, C, mergeKitStatics } from './poi/kit';
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
 * On the post at the waiting teddies' end hangs the timetable: for each teddy waiting,
 * the town it goes to, how far, what it pays (economy/economy.ts `contractPay`: the
 * route's kilometres) and its urgent clock.
 *
 * The waiting teddies sit on the bench (the teddy item's own model), left of its middle;
 * who is still there is read from the world (contracts/shelters.ts `shelterBench`), so a
 * teddy taken here or put back shows at once. EACH TEDDY IS ITS OWN CONTRACT, with its
 * own town: F on one takes it into the hands ("F - to <town>, please").
 *
 * A teddy PUT ON THE BENCH — F at the shelter with it in hand, or dropped anywhere on the
 * seat and come to rest (`settleBenchTeddies`) — does what `teddyGetOff` says:
 *  - at its destination it gets off: its contract is delivered and paid there and then
 *    (`teddy_seat`), and it sits up, WAVES A PAW GOODBYE and is gone (`WAVE_S`);
 *  - at its own source it is put back: no pay, it waits on the bench again;
 *  - anywhere else nothing happens: dropped there, it stays where it lies; F does nothing.
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
 * Places along the bench, round its middle: the waiting teddies' to the viewer's left of
 * it, the first place nearest, and the ones F seats at their destination as far to the
 * right, so a lone teddy sits near the middle and the two lots are told apart by the gap
 * between them. They were spread from end to end, and a lone teddy sat at the very end
 * of the bench ("they could sit closer to the centre", owner, 2026-10-26).
 */
const PLACES = 6;
const WAITING_PLACES = 3;
/** The nearest places' middles either side of the bench's, and the step out to the next. */
const PLACE_INNER = 0.3;
const PLACE_STEP = 0.4;
/** A teddy's middle across the seat, and how far its pick box reaches past its model all round. */
const TEDDY_Z = SEAT_Z + 0.02;
const TEDDY_PICK_MARGIN = 0.02;
/**
 * What counts as ON the bench for a dropped teddy come to rest (`benchX`): its middle
 * over the seat, from a teddy's length in front of its edge back to the backrest, and
 * from the seat up to `ON_SEAT_HIGH` over it. A drop (player/interaction.ts `drop`)
 * lands 1.2 m down the view ray, short of what the ray hits, and lies there asleep until
 * something wakes it: aimed at the seat from a step away it hangs a little over it and
 * in front of its edge, so that counts.
 */
const ON_SEAT_FRONT = SEAT_Z - SEAT_D / 2 - 0.25;
const ON_SEAT_BACK = BACK_Z + 0.03;
const ON_SEAT_HIGH = 1.2;
/** The timetable: its board on the front of the post at the waiting places' end, over the backrest. */
const BOARD_W = 0.8;
const BOARD_H = 0.75;
const BOARD_X = -POST_X;
const BOARD_Y = 1.5;
const BOARD_Z = POST_Z - POST_W / 2 - 0.015;
const BOARD_PAINT = ['#f2ecd8', '#1f3f7a'] as const;
/** The bench and the board are read again this often, s. */
const REFRESH_S = 0.4;
/**
 * THE GOODBYE: a teddy that got off sits up where it was put, raises its paw out to the
 * side (`WAVE_RAISE_S`), waves it (`WAVE_HZ`, `WAVE_SWING` rad either way, the body
 * rocking with it) until `WAVE_S`, then shrinks away to nothing in `WAVE_GONE_S`.
 */
const WAVE_RAISE_S = 0.35;
const WAVE_S = 2.1;
const WAVE_GONE_S = 0.35;
const WAVE_LIFT = 2.5;
const WAVE_SWING = 0.45;
const WAVE_HZ = 2.4;
const WAVE_ROCK = 0.08;
/** Teddies that can be waving at one bench at once; a fourth cuts the oldest short. */
const WAVERS = 3;
/** How far in from the bench's ends a waving teddy sits. */
const WAVE_END_MARGIN = 0.15;
/** Dropped teddies are looked for on the benches this often, s (`settleBenchTeddies`). */
const SETTLE_S = 0.25;

/** The text of a shelter's timetable for `bench`: two lines for each teddy waiting. */
function timetable(world: GameWorld, stop: PostStop, bench: ShelterBench): string[] {
  const lines: string[] = [];
  bench.teddies.forEach((teddy, seat) => {
    if (!bench.waiting[seat]) return;
    const km = (postStop(world.seed, offerDestinationIndex(teddy)).s - stop.s) / 1000;
    const urgent = teddy.urgentS === undefined ? '' : ` · URGENT ${formatClock(teddy.urgentS)}`;
    lines.push(`→ ${(teddy.destination ?? 'the next post').toUpperCase()}`, `${km.toFixed(1)} km · ${formatPay(contractPay(world.seed, teddy))}${urgent}`);
  });
  return lines.length > 0 ? lines : ['TEDDY STOP', 'nobody waiting'];
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
function seatedTeddy(root: THREE.Object3D, teddy: ContractCargoItem, place: number): THREE.Object3D {
  const mesh = createItemMesh(teddy);
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

/** A teddy waving goodbye on the bench: its model, and how far into the wave it is (-1 idle). */
interface Waver {
  readonly teddy: WavingTeddy;
  t: number;
}

/** A waving teddy for the bench, facing the pad, hidden until it waves. */
function waver(root: THREE.Object3D): Waver {
  const teddy = createWavingTeddy();
  teddy.root.traverse((node) => {
    node.castShadow = false;
  });
  teddy.root.userData.kitKeep = true;
  teddy.root.rotation.y = Math.PI;
  teddy.root.visible = false;
  root.add(teddy.root);
  return { teddy, t: -1 };
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
  const boardMaterial = paintSign(timetable(world, stop, bench), ...BOARD_PAINT, 512, 480);
  const board = new THREE.Mesh(SIGN_PLANE, boardMaterial);
  board.userData.kitKeep = true;
  board.scale.set(BOARD_W, BOARD_H, 1);
  board.position.set(BOARD_X, BOARD_Y, BOARD_Z - 0.017);
  board.rotation.y = Math.PI;
  root.add(board);

  // Every teddy is drawn alike: the round's first stands for them all.
  const model = bench.teddies[0]!;
  const teddies: THREE.Object3D[] = [];
  for (let place = 0; place < WAITING_PLACES; place++) teddies.push(seatedTeddy(root, model, place));
  bench.waiting.forEach((waits, seat) => {
    teddies[seat]!.visible = waits;
  });
  // Only the physics band's shelter is worked, so only it waves.
  const wavers: Waver[] = [];
  for (let k = 0; ctx.hasPhysics && k < WAVERS; k++) wavers.push(waver(root));
  disposers.push(() => {
    boardMaterial.map?.dispose();
    boardMaterial.dispose();
    for (const teddy of teddies) disposeItemMeshResources(teddy);
    for (const w of wavers) disposeItemMeshResources(w.teddy.root);
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

  const shelter = new Shelter(world, stop, x, y, z, yaw, teddies, wavers, boardMaterial, bench);
  registered.push(fixtures.register(shelter));
}

/** What the last `aim` hit: a waiting teddy by its bench place, or the shelter. */
type Part = { readonly kind: 'teddy'; readonly seat: number } | { readonly kind: 'shelter' } | null;

class Shelter implements WorldFixture {
  readonly id: string;
  private part: Part = null;
  private refreshIn = REFRESH_S;
  /** The board's state as last painted: round, who waits. */
  private paintedKey: string;
  /** Teddies F has seated here this visit: the next one sits on place `WAITING_PLACES + arrivals % 3`. */
  private arrivals = 0;

  constructor(
    private readonly world: GameWorld,
    private readonly stop: PostStop,
    /** The root's origin (on the ground at the canopy's centre), ABSOLUTE metres, and the front's yaw. */
    private readonly x: number,
    private readonly y: number,
    private readonly z: number,
    private readonly yaw: number,
    /** The teddy on each waiting bench place. */
    private readonly teddies: readonly THREE.Object3D[],
    /** The teddies that wave goodbye, idle until one gets off here. */
    private readonly wavers: readonly Waver[],
    private readonly board: THREE.MeshStandardMaterial,
    private bench: ShelterBench,
  ) {
    this.id = `shelter:${stop.index}`;
    this.paintedKey = this.key(bench);
  }

  /** The post this shelter stands at. */
  get postIndex(): number {
    return this.stop.index;
  }

  private key(bench: ShelterBench): string {
    return `${bench.round}|${bench.waiting.map((w) => (w ? 1 : 0)).join('')}`;
  }

  /** Reads the bench again; on a change, the teddies and the board follow. */
  private refresh(): void {
    this.bench = shelterBench(this.world.state, this.world.seed, this.stop.index);
    const key = this.key(this.bench);
    if (key === this.paintedKey) return;
    this.paintedKey = key;
    for (let place = 0; place < WAITING_PLACES; place++) this.teddies[place]!.visible = this.bench.waiting[place] === true;
    repaintSign(this.board, timetable(this.world, this.stop, this.bench), ...BOARD_PAINT);
  }

  update(dt: number): void {
    for (const w of this.wavers) if (w.t >= 0) this.wave(w, dt);
    this.refreshIn -= dt;
    if (this.refreshIn > 0) return;
    this.refreshIn = REFRESH_S;
    this.refresh();
  }

  /** One frame of `w`'s goodbye (see `WAVE_S`); at its end it is gone and idle again. */
  private wave(w: Waver, dt: number): void {
    w.t += dt;
    if (w.t >= WAVE_S + WAVE_GONE_S) {
      w.t = -1;
      w.teddy.root.visible = false;
      return;
    }
    this.pose(w);
  }

  /** Sets `w` to where its goodbye is at `w.t`. */
  private pose(w: Waver): void {
    const { root, shoulder } = w.teddy;
    const raise = Math.min(1, w.t / WAVE_RAISE_S);
    const swing = w.t > WAVE_RAISE_S ? Math.sin((w.t - WAVE_RAISE_S) * WAVE_HZ * 2 * Math.PI) : 0;
    shoulder.rotation.z = TEDDY_WAVE_SIDE * (raise * raise * (3 - 2 * raise) * WAVE_LIFT + swing * WAVE_SWING);
    root.rotation.z = -TEDDY_WAVE_SIDE * swing * WAVE_ROCK * raise;
    const gone = Math.max(0, (w.t - WAVE_S) / WAVE_GONE_S);
    root.scale.setScalar(Math.max(0.001, 1 - gone * gone));
    // Chunk content is frozen (`matrixAutoUpdate = false`, world/chunks.ts): the local
    // matrices are rebuilt by hand before the world ones.
    shoulder.updateMatrix();
    root.updateMatrix();
    root.updateMatrixWorld(true);
  }

  /** A teddy sits up at local `x` along the bench and waves goodbye; the oldest wave is cut short when all are busy. */
  private startWave(x: number): void {
    let w = this.wavers[0];
    for (const other of this.wavers) {
      if (other.t < 0) {
        w = other;
        break;
      }
      if (w && other.t > w.t) w = other;
    }
    if (!w || !teddyHalf) return;
    const at = Math.max(-BENCH_HALF_L + WAVE_END_MARGIN, Math.min(BENCH_HALF_L - WAVE_END_MARGIN, x));
    w.t = 0;
    w.teddy.root.position.set(at, SEAT_Y + teddyHalf.y, TEDDY_Z);
    w.teddy.root.visible = true;
    this.pose(w);
  }

  /**
   * Local x along the bench of an ABSOLUTE point lying on its seat (see `ON_SEAT_FRONT`),
   * or null when it is not on the bench.
   */
  benchX(ax: number, ay: number, az: number): number | null {
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    const rx = ax - this.x;
    const rz = az - this.z;
    const lx = c * rx - s * rz;
    const lz = s * rx + c * rz;
    const ly = ay - this.y - SEAT_Y;
    if (Math.abs(lx) > BENCH_HALF_L || lz < ON_SEAT_FRONT || lz > ON_SEAT_BACK || ly < -0.02 || ly > ON_SEAT_HIGH) return null;
    return lx;
  }

  /**
   * `teddy`, put on this bench at local `x`, gets off (`getOff.mode` 'deliver'): recorded
   * delivered, paid, and it waves goodbye there. The caller has taken it out of the hands
   * or off the ground. The pay.
   */
  getOff(teddy: ContractCargoItem, getOff: Extract<TeddyGetOff, { mode: 'deliver' }>, x: number): number {
    // Read before it closes: late or not.
    const pay = contractPay(this.world.seed, teddy);
    // Recorded first, then paid: a failure between cannot pay twice.
    this.world.apply({ t: 'teddy_seat', teddyId: teddy.id, sourcePost: getOff.sourcePost, round: getOff.round, roundDone: getOff.roundDone });
    credit(this.world, pay);
    this.startWave(x);
    this.refresh();
    return pay;
  }

  /** A teddy put back on its own bench waits there again: the bench is read at once. The caller has taken it out of the hands or off the ground. */
  putBack(): void {
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

  /** Why a waiting teddy cannot be taken now, or null: the limit. */
  private takeRefusal(): string | null {
    if (activeContracts(this.world.state).all.size >= ACTIVE_CONTRACT_LIMIT) return 'three jobs out — hand one in or return it';
    return null;
  }

  /** The teddy in hand and what putting it on this bench does, when F puts it here rather than taking another. */
  private heldTeddy(ctx: FixtureContext): { readonly teddy: ContractCargoItem; readonly getOff: TeddyGetOff } | null {
    const held = ctx.held;
    if (held?.type !== 'contract_cargo' || !isPassenger(held)) return null;
    const getOff = teddyGetOff(this.world.state, this.world.seed, held, this.stop.index);
    // At a teddy of the bench, F takes it, unless the one in hand gets off here.
    if (this.part?.kind === 'teddy' && getOff.mode !== 'deliver') return null;
    return { teddy: held, getOff };
  }

  prompt(ctx: FixtureContext): string | null {
    const held = this.heldTeddy(ctx);
    if (held) {
      const { teddy, getOff } = held;
      if (getOff.mode === 'stay') return `this one rides on to ${teddy.destination ?? 'another town'}`;
      if (getOff.mode === 'return') return '[F] put the teddy back — no pay';
      const late = isLate(teddy) ? ' · late' : '';
      return `[F] seat the teddy — ${formatPay(contractPay(this.world.seed, teddy))}${late}`;
    }
    if (this.part?.kind === 'teddy') {
      const to = this.bench.teddies[this.part.seat]?.destination ?? 'the next post';
      const why = this.takeRefusal();
      return why ? `teddy → ${to} — ${why}` : `F - to ${to}, please`;
    }
    const waiting = this.bench.waiting.filter(Boolean).length;
    return `teddy shelter · ${waiting === 0 ? 'nobody waiting' : `${waiting} waiting`}`;
  }

  press(ctx: FixtureContext): FoleyEvent | null {
    const held = this.heldTeddy(ctx);
    if (held) {
      const { teddy, getOff } = held;
      if (getOff.mode === 'stay') return null;
      ctx.give(teddy.id);
      if (getOff.mode === 'return') {
        this.putBack();
        ctx.toast('teddy back on the bench — no pay');
        return 'drop';
      }
      const x = placeX(WAITING_PLACES + (this.arrivals++ % (PLACES - WAITING_PLACES)));
      ctx.toast(`teddy got off at ${teddy.destination ?? 'its town'} · ${formatPay(this.getOff(teddy, getOff, x))}`);
      return 'coin';
    }
    if (this.part?.kind !== 'teddy') return null;
    return this.take(ctx, this.part.seat);
  }

  /** F on the waiting teddy on bench place `seat`: into the hands. */
  private take(ctx: FixtureContext, seat: number): FoleyEvent {
    this.refresh();
    const teddy = this.bench.teddies[seat];
    if (!teddy || this.bench.waiting[seat] !== true) return 'refused';
    const why = this.takeRefusal();
    if (why) {
      ctx.toast(why);
      return 'refused';
    }
    if (!ctx.inventory.add(teddy)) {
      ctx.toast('hands full');
      return 'refused';
    }
    this.refresh();
    return 'pickup';
  }
}

/** Seconds to the next look for dropped teddies on the benches. */
let settleIn = SETTLE_S;

/** What a settle step did, for the HUD: its toast, and whether it is a pay (the coin's sound; a fine sounds by itself). */
export interface TeddyNews {
  readonly text: string;
  readonly coin: boolean;
}

/**
 * One fixed step, every `SETTLE_S`:
 *  - every teddy lying loose and come to rest on the bench of its destination's or its
 *    source's shelter (`Shelter.benchX`) is put on it (`teddyGetOff`): at its destination
 *    it is taken off the ground and gets off, waving goodbye; at its source it is taken
 *    off the ground and waits on the bench again. On any other bench it stays where it lies;
 *  - every teddy lying on the ground `ABANDON_M` from the player at ABSOLUTE (`x`, `z`)
 *    is left behind (contracts/shelters.ts `abandonedTeddies`): closed undelivered
 *    (`teddy_abandon`), gone from the world, then FINED.
 * The toast, or null when nothing happened.
 */
export function settleBenchTeddies(
  fixtures: FixtureField,
  loose: LoosePartField,
  world: GameWorld,
  x: number,
  z: number,
  dt: number,
): TeddyNews | null {
  settleIn -= dt;
  if (settleIn > 0) return null;
  settleIn = SETTLE_S;
  let toast: TeddyNews | null = null;
  loose.forEachRestingItem((item, ax, ay, az) => {
    if (item.type !== 'contract_cargo' || !isPassenger(item)) return;
    for (const index of [offerDestinationIndex(item), item.sourceCourierIndex]) {
      const shelter = fixtures.get(`shelter:${index}`);
      if (!(shelter instanceof Shelter)) continue;
      const at = shelter.benchX(ax, ay, az);
      if (at === null) continue;
      const getOff = teddyGetOff(world.state, world.seed, item, shelter.postIndex);
      if (getOff.mode === 'stay') return;
      loose.remove(item.id);
      if (getOff.mode === 'return') {
        shelter.putBack();
        toast = { text: 'teddy back on the bench — no pay', coin: false };
      } else {
        toast = { text: `teddy got off at ${item.destination ?? 'its town'} · ${formatPay(shelter.getOff(item, getOff, at))}`, coin: true };
      }
      return;
    }
  });
  for (const teddy of abandonedTeddies(world.state, x, z)) {
    // Recorded first, then fined: a reload finds it closed and never fines it twice.
    world.apply(teddyAbandon(world.state, world.seed, teddy));
    loose.remove(teddy.id);
    toast = { text: `left the teddy for ${teddy.destination ?? 'its town'} behind — ${formatFine(fine(world, FINE_SHELLS))}`, coin: false };
  }
  return toast;
}
