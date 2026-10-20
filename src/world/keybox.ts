import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { FoleyEvent } from '../audio/foley';
import { SurfaceType } from '../core/surfaces';
import type { CarState, GameWorld } from '../game/state';
import { carModel } from '../vehicle/carmodels';
import type { ChunkContext } from './chunks';
import { rayBox, type FixtureContext, type FixtureField, type FixtureHoldResult, type WorldFixture } from './fixturefield';
import { SIGN_PLANE, signMaterial, type MarketField } from './market';
import { box, C } from './poi/kit';
import { addStatic, yawRotation } from './props/scatter';

/**
 * The key box beside a lot car (world/carlot.ts): how a car is bought, by hand.
 *
 * A painted steel box on a post, its face to the buyer, with three working parts, each
 * aimed on its own:
 *  - the COIN SLOT: F held feeds coins from the pack one by one, faster as the hand
 *    gets going, until the car's price is in (`lot_pay`, kept in `CarState.lotPaid`, so a
 *    reload never eats them). A little window beside it fills as the coins stack.
 *  - the LEVER: F pulls it. Short of the price it jams and springs back; paid, it goes
 *    all the way down, a key on its tag drops inside and the drawer slides out with it.
 *  - the KEY DRAWER: F takes the key: the car is bought (`car_buy`), its price board comes
 *    down (`MarketField.carSold`) and the drawer slides shut again, empty.
 *
 * The key on its tag is only seen, never carried: taking it IS the purchase. Whether the
 * key has dropped is the box's own in-memory state; a rebuilt box has it back inside,
 * and the paid lever simply drops it again.
 *
 * Built of POI kit boxes (flat materials) and one `signMaterial` board, whose programs
 * `marketProgramAnchor` links at boot: no new shader programs.
 */

/** The box face is local +Z; heights are from the ground under the post. */
const BODY_W = 0.3;
const BODY_H = 0.34;
const BODY_D = 0.16;
const BODY_Y = 1.12;
const FRONT = BODY_D / 2;

const SLOT_X = -0.08;
const SLOT_Y = 1.15;

const LEVER_X = BODY_W / 2 + 0.015;
const LEVER_Y = 1.17;
/** The lever's swing toward the buyer, radians: pulled home, and as far as a jam lets it. */
const LEVER_PULLED = 1.35;
const LEVER_JAM = 0.28;

const DRAWER_Y = 1.0;
/** How far the drawer slides out with a key in it, metres. */
const DRAWER_OUT = 0.11;

/** The coins window: its bottom and height. */
const TUBE_X = 0.08;
const TUBE_Y0 = 1.0;
const TUBE_H = 0.16;

/** Feeding: a pause after the first coin, then coins per second rising with the hold. */
const FEED_DELAY_S = 0.35;
const FEED_RATE_START = 4;
const FEED_RATE_GAIN = 6;
const FEED_RATE_MAX = 18;

/** The pull's timeline, seconds from the press. */
const PULL_DOWN_S = 0.3;
const KEY_FALL_S = 0.25;
const DRAWER_START_S = PULL_DOWN_S + KEY_FALL_S;
const DRAWER_SLIDE_S = 0.35;
const LEVER_RETURN_S = 0.65;
const JAM_S = 0.45;
const COIN_SLIDE_S = 0.09;

/** The key's place in the drawer frame: dropped from inside the box onto the tray. */
const KEY_TOP_Y = 0.2;
const KEY_REST_Y = -0.022;
const KEY_Z = -0.065;

type Part = 'body' | 'slot' | 'lever' | 'drawer';
type Phase = 'idle' | 'dropping' | 'ready' | 'taken';

/**
 * Builds the key box for lot car `carId` on a post at ABSOLUTE (`x`, `y`, `z`), `y` the
 * ground under it, its face turned by `yaw` (the face is local +Z: face the buyer's
 * side). `price` is painted on the box; the coins that count are `CarState.lotPrice`.
 * In the physics band it is solid and registered as a world fixture (its id pushed to
 * `registered`, for the chunk to `fixtures.forget`); beyond it, it is only seen.
 */
export function buildKeyBox(
  ctx: ChunkContext,
  carId: string,
  price: number,
  x: number,
  y: number,
  z: number,
  yaw: number,
  group: THREE.Group,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
  fixtures: FixtureField,
  registered: string[],
  market: MarketField,
): void {
  const root = new THREE.Group();
  root.name = 'key-box';
  root.position.set(x - ctx.originX, y - 0.04, z - ctx.originZ);
  root.rotation.y = yaw;

  // The post, the box and its cap.
  box(root, [0.07, BODY_Y - BODY_H / 2 + 0.04, 0.07], [0, (BODY_Y - BODY_H / 2 + 0.04) / 2, -0.03], C.darkMetal);
  box(root, [BODY_W, BODY_H, BODY_D], [0, BODY_Y, 0], C.fadedGreen);
  box(root, [BODY_W + 0.04, 0.03, BODY_D + 0.04], [0, BODY_Y + BODY_H / 2 + 0.015, 0], C.darkMetal);
  // The plate over the slot.
  const plate = new THREE.Mesh(SIGN_PLANE, signMaterial(['CAR KEY', `${price} coins`], '#f2e6c4', '#26221c', 256, 128));
  plate.scale.set(0.24, 0.075, 1);
  plate.position.set(0, BODY_Y + BODY_H / 2 - 0.05, FRONT + 0.002);
  root.add(plate);
  // The coin slot: a steel escutcheon and its dark slit.
  box(root, [0.07, 0.08, 0.012], [SLOT_X, SLOT_Y, FRONT + 0.006], C.metal);
  box(root, [0.009, 0.05, 0.006], [SLOT_X, SLOT_Y, FRONT + 0.013], 0x111314);
  // The coins window: a dark slit that fills from the bottom as the price goes in.
  box(root, [0.034, TUBE_H + 0.012, 0.006], [TUBE_X, TUBE_Y0 + TUBE_H / 2, FRONT + 0.003], C.darkMetal);
  const fill = box(root, [0.022, 1, 0.004], [TUBE_X, TUBE_Y0, FRONT + 0.007], C.ochre);
  // The drawer's mouth, dark behind the drawer front.
  box(root, [0.22, 0.08, 0.004], [0, DRAWER_Y, FRONT + 0.001], 0x16191a);

  // A coin on its way in: shown edge-on in front of the slit for a moment per coin.
  const coin = box(root, [0.004, 0.028, 0.028], [SLOT_X, SLOT_Y, FRONT + 0.03], C.ochre);
  coin.visible = false;

  // The lever: a hub on the box's right flank and an arm with a red knob, swinging
  // about local X toward the buyer.
  const lever = new THREE.Group();
  lever.position.set(LEVER_X, LEVER_Y, 0);
  box(lever, [0.03, 0.05, 0.05], [0, 0, 0], C.darkMetal);
  box(lever, [0.022, 0.2, 0.022], [0.022, 0.1, 0], C.metal);
  box(lever, [0.045, 0.045, 0.045], [0.022, 0.21, 0], C.fadedRed);
  root.add(lever);

  // The drawer: its front and handle, and the tray behind them that shows once it slides out.
  const drawer = new THREE.Group();
  drawer.position.set(0, DRAWER_Y, FRONT);
  box(drawer, [0.2, 0.07, 0.015], [0, 0, 0.0075], C.metal);
  box(drawer, [0.08, 0.014, 0.022], [0, 0, 0.026], C.darkMetal);
  box(drawer, [0.17, 0.008, 0.11], [0, -0.03, -0.055], C.concreteLight);
  box(drawer, [0.008, 0.04, 0.11], [-0.085, -0.012, -0.055], C.darkMetal);
  box(drawer, [0.008, 0.04, 0.11], [0.085, -0.012, -0.055], C.darkMetal);
  root.add(drawer);

  // The key on its tag, built upright; it lies flat once it lands in the tray.
  const key = new THREE.Group();
  box(key, [0.024, 0.024, 0.005], [0, 0, 0], C.metal);
  box(key, [0.008, 0.045, 0.003], [0, -0.034, 0], C.metal);
  box(key, [0.012, 0.01, 0.003], [0.008, -0.05, 0], C.metal);
  box(key, [0.012, 0.004, 0.004], [-0.016, 0.012, 0], C.darkMetal);
  box(key, [0.032, 0.05, 0.003], [-0.034, 0.004, 0], C.ochre, [0, 0, 0.3]);
  // A toy-sized key, as everything in the boy's world is: big enough to read in the tray.
  key.scale.setScalar(1.5);
  key.visible = false;
  drawer.add(key);

  group.add(root);
  if (!ctx.hasPhysics) {
    setFill(fill, ctx.world.state.cars[carId] ?? null);
    return;
  }

  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  addStatic(
    ctx, bodies, colliders, x, y - 0.04 + BODY_Y, z,
    RAPIER.ColliderDesc.cuboid(BODY_W / 2, BODY_H / 2, BODY_D / 2),
    SurfaceType.Concrete,
    yawRotation(yaw),
  );
  const postH = BODY_Y - BODY_H / 2;
  addStatic(
    ctx, bodies, colliders, x - s * 0.03, y - 0.04 + postH / 2, z - c * 0.03,
    RAPIER.ColliderDesc.cuboid(0.035, postH / 2, 0.035),
    SurfaceType.Concrete,
  );

  const fixture = new KeyBox(ctx.world, market, carId, x, y - 0.04, z, yaw, lever, drawer, key, coin, fill);
  registered.push(fixtures.register(fixture));
}

/** Scales the coins window's fill to what is paid of the price (full once sold). */
function setFill(fill: THREE.Mesh, car: CarState | null): void {
  const price = car?.lotPrice;
  const share = !car ? 0 : price === undefined ? 1 : Math.min(1, (car.lotPaid ?? 0) / price);
  const h = Math.max(0.0005, share * TUBE_H);
  fill.scale.y = h;
  fill.position.y = TUBE_Y0 + h / 2;
  fill.visible = share > 0;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.min(1, Math.max(0, t));
}

class KeyBox implements WorldFixture {
  readonly id: string;
  /** The part the last `aim` hit. */
  private part: Part | null = null;
  private phase: Phase;
  /** Seconds into the pull (`dropping`), or into the drawer closing (`taken`). */
  private clock = 0;
  /** Seconds left of a jammed pull's rattle. */
  private jam = 0;
  /** How far the drawer stands out, metres: the drawer aim follows it. */
  private drawerOut = 0;
  /** Seconds left of the coin sliding into the slot. */
  private coinT = 0;
  /** The hold's feeding: seconds to the next coin, seconds held, and a dry-pack flag. */
  private feedWait = 0;
  private feedRun = 0;
  private dry = false;

  constructor(
    private readonly world: GameWorld,
    private readonly market: MarketField,
    private readonly carId: string,
    /** ABSOLUTE metres of the box's root (the post foot). */
    private readonly x: number,
    private readonly y: number,
    private readonly z: number,
    private readonly yaw: number,
    private readonly lever: THREE.Object3D,
    private readonly drawer: THREE.Object3D,
    private readonly key: THREE.Object3D,
    private readonly coin: THREE.Object3D,
    private readonly fill: THREE.Mesh,
  ) {
    this.id = `keybox:${carId}`;
    const car = world.state.cars[carId];
    this.phase = car && car.lotPrice === undefined ? 'taken' : 'idle';
    this.clock = DRAWER_SLIDE_S;
    setFill(fill, car ?? null);
  }

  private car(): CarState | null {
    return this.world.state.cars[this.carId] ?? null;
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
    // The eye and the ray in the box's frame (face +Z, ground under the post at y 0).
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    const rx = eyeX - (this.x - originX);
    const rz = eyeZ - (this.z - originZ);
    const ox = c * rx - s * rz;
    const oy = eyeY - this.y;
    const oz = s * rx + c * rz;
    const lx = c * dx - s * dz;
    const lz = s * dx + c * dz;
    // The parts stand proud of the body, so a ray at one meets it first.
    let best = rayBox(ox, oy, oz, lx, dy, lz, 0, BODY_Y, 0, BODY_W / 2, BODY_H / 2, BODY_D / 2);
    let part: Part = 'body';
    let t = rayBox(ox, oy, oz, lx, dy, lz, SLOT_X, SLOT_Y, FRONT + 0.02, 0.055, 0.055, 0.03);
    if (t < best) {
      best = t;
      part = 'slot';
    }
    t = rayBox(ox, oy, oz, lx, dy, lz, LEVER_X + 0.02, LEVER_Y + 0.08, 0.06, 0.04, 0.16, 0.12);
    if (t < best) {
      best = t;
      part = 'lever';
    }
    const out = this.drawerOut;
    t = rayBox(ox, oy, oz, lx, dy, lz, 0, DRAWER_Y, FRONT - 0.005 + out / 2, 0.115, 0.05, 0.035 + out / 2);
    if (t < best) {
      best = t;
      part = 'drawer';
    }
    this.part = best > range ? null : part;
    return best > range ? Infinity : best;
  }

  prompt(ctx: FixtureContext): string | null {
    const car = this.car();
    if (!car) return null;
    const price = car.lotPrice;
    if (price === undefined || this.phase === 'taken') return 'key box — empty';
    const paid = car.lotPaid ?? 0;
    const label = carModel(car.modelId).label;
    switch (this.part) {
      case 'slot': {
        if (this.phase !== 'idle') return 'coin slot — the key is in the drawer';
        if (paid >= price) return `${label} paid — pull the lever`;
        const coins = ctx.coins();
        return coins > 0
          ? `[hold F] feed coins — ${paid}/${price} paid · ${coins} in pack`
          : `coin slot — ${paid}/${price} paid · no coins`;
      }
      case 'lever':
        if (this.phase !== 'idle') return 'lever — the key is down';
        return paid >= price ? '[F] pull the lever' : `[F] pull the lever — ${price - paid} coins short`;
      case 'drawer':
        return this.phase === 'ready' ? `[F] take the key — ${label}` : 'key drawer — empty';
      case 'body':
        return `key box — ${label} · ${paid}/${price} paid`;
      default:
        return null;
    }
  }

  press(ctx: FixtureContext): FoleyEvent | null {
    const car = this.car();
    if (!car || car.lotPrice === undefined) return this.part === null || this.part === 'body' ? null : 'refused';
    switch (this.part) {
      case 'slot':
        // The first coin goes in on the press; `hold` feeds the rest.
        this.dry = false;
        return this.feed(ctx, car);
      case 'lever':
        if (this.phase !== 'idle' || (car.lotPaid ?? 0) < car.lotPrice) {
          this.jam = JAM_S;
          return 'refused';
        }
        this.phase = 'dropping';
        this.clock = 0;
        return 'mount';
      case 'drawer':
        if (this.phase !== 'ready') return 'refused';
        this.world.apply({ t: 'car_buy', carId: this.carId });
        this.market.carSold(this.carId);
        this.phase = 'taken';
        this.clock = 0;
        this.key.visible = false;
        return 'pickup';
      default:
        return null;
    }
  }

  hold(ctx: FixtureContext, dt: number, first: boolean): FixtureHoldResult | null {
    if (this.part !== 'slot') return null;
    if (first) {
      this.feedWait = FEED_DELAY_S;
      this.feedRun = 0;
      return null;
    }
    this.feedRun += dt;
    this.feedWait -= dt;
    if (this.feedWait > 0 || this.dry) return null;
    const car = this.car();
    if (!car || car.lotPrice === undefined || (car.lotPaid ?? 0) >= car.lotPrice) return null;
    this.feedWait += 1 / Math.min(FEED_RATE_MAX, FEED_RATE_START + this.feedRun * FEED_RATE_GAIN);
    const sound = this.feed(ctx, car);
    return { sound, continuous: null };
  }

  /** One coin from the pack into the slot; the sound it makes. */
  private feed(ctx: FixtureContext, car: CarState): FoleyEvent {
    const price = car.lotPrice ?? 0;
    if ((car.lotPaid ?? 0) >= price) return 'refused';
    if (!ctx.spend(1)) {
      this.dry = true;
      return 'refused';
    }
    this.world.apply({ t: 'lot_pay', carId: this.carId, coins: 1 });
    this.coinT = COIN_SLIDE_S;
    setFill(this.fill, car);
    return 'coin';
  }

  update(dt: number): void {
    // The coin edging into the slit.
    if (this.coinT > 0) {
      this.coinT = Math.max(0, this.coinT - dt);
      this.coin.visible = this.coinT > 0;
      this.coin.position.z = FRONT + 0.008 + 0.03 * (this.coinT / COIN_SLIDE_S);
    }

    let lever = 0;
    let drawer = 0;
    if (this.phase === 'dropping') {
      this.clock += dt;
      const t = this.clock;
      // Down, held while the key falls, then back up on its spring.
      lever = t < LEVER_RETURN_S
        ? lerp(0, LEVER_PULLED, t / PULL_DOWN_S)
        : lerp(LEVER_PULLED, 0, (t - LEVER_RETURN_S) / 0.25);
      if (t >= PULL_DOWN_S) {
        const f = (t - PULL_DOWN_S) / KEY_FALL_S;
        this.key.visible = true;
        this.key.position.set(0, lerp(KEY_TOP_Y, KEY_REST_Y, f * f), KEY_Z);
        this.key.rotation.x = lerp(0, -Math.PI / 2, f);
      }
      drawer = lerp(0, DRAWER_OUT, (t - DRAWER_START_S) / DRAWER_SLIDE_S);
      if (t >= LEVER_RETURN_S + 0.25 && t >= DRAWER_START_S + DRAWER_SLIDE_S) this.phase = 'ready';
    } else if (this.phase === 'ready') {
      drawer = DRAWER_OUT;
    } else if (this.phase === 'taken') {
      this.clock = Math.min(DRAWER_SLIDE_S, this.clock + dt);
      drawer = lerp(this.drawerOut, 0, this.clock / DRAWER_SLIDE_S);
    }

    // A jammed pull: the lever gives a hand's width, rattles and springs back.
    if (this.jam > 0) {
      this.jam = Math.max(0, this.jam - dt);
      const k = this.jam / JAM_S;
      lever = Math.max(lever, LEVER_JAM * Math.sin(Math.PI * k) + 0.035 * Math.sin(this.jam * 70) * k);
    }

    this.lever.rotation.x = lever;
    this.drawerOut = drawer;
    this.drawer.position.z = FRONT + drawer;
  }
}
