import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { FoleyEvent } from '../audio/foley';
import { isContractClosed } from '../contracts/registry';
import { carShells, formatPay } from '../economy/economy';
import { poseOnGround } from '../game/spawn';
import type { CarState, GameWorld, WorldState } from '../game/state';
import type { Item } from '../items/items';
import { oilCapacity } from '../parts/registry';
import { carModelMeasure, carSpawnYAboveGround } from '../render/carmodel';
import { makeFlatPaletteMaterial } from '../render/materials';
import { fillGameText } from '../ui/shellsprites';
import { DieCastShop, dieCastGeometry, dieCastShopAvailable, type DieCastOrder } from '../ui/diecastshop';
import { bonnetWaterCapacity, createBonnetStorage } from '../vehicle/bonnet';
import { emptyCabin } from '../vehicle/cabin';
import { CAR_MODELS, carModel, hasCarModel, modelEngine } from '../vehicle/carmodels';
import { factoryPaintHex, visiblePaintHex } from '../vehicle/carpaint';
import { COLD_SOAK_C } from '../vehicle/cooling';
import { TRAILER_BALL_Z, TRAILER_HALF_WIDTH } from '../vehicle/trailer';
import { trunkCellCount } from '../vehicle/trunk';
import type { ChunkContext } from './chunks';
import { devLook } from './devlook';
import { rayBox, type FixtureContext, type FixtureField, type FixtureFocus, type WorldFixture } from './fixturefield';
import type { ParkingSlot } from './haulbay';
import type { V3 } from './poi/kit';
import { postSlot } from './poislots';
import type { PostStop } from './poststops';
import type { Road } from './road';
import { roadsideStop, spotPose, type SettlementSpot } from './settlement';
import type { Terrain } from './terrain';
import {
  BUTTON_HALF,
  buildToyStand,
  buttonCentre,
  paintToyBay,
  PLAQUE_HALF,
  plaqueCentre,
  STAND_FACES,
  WHEEL_HALF,
  wheelCentre,
  type StandLayout,
  type ToyStandParts,
} from './toystand';

/**
 * THE TOY BOX (game-design2.md §13.4): the collection of the player's cars, a STAND
 * beside every post, between it and the stop, with a marked BAY on the asphalt in front
 * of it. The stand is one of three trial designs (world/toystand.ts, `devLook.stand`): a
 * model under a bell of brass hoops on a pedestal, a fairground carousel, or a showroom
 * podium. Owner, 2026-10-26: "a nice pedestal where the current car spins and you turn a
 * handle to choose another"; it was a card machine before.
 *
 * Worked up close as the card machines are (player/machinefocus.ts): F frames it, and
 *  - the HANDWHEEL on its front, turning about the axis that faces the viewer, is dragged
 *    round by the cursor without end; every sixth of a turn is the next entry, clockwise
 *    forward. The mouse wheel turns it an entry at a time, and so does a click. The
 *    entries are the boxed cars, then THE CATALOGUE (`TOY_CATALOGUE`): every car of the
 *    game, cheapest first, round to the boxed cars again.
 *  - the TURNTABLE shows the selected entry as a die-cast model (ui/diecastshop.ts, built
 *    in a worker, in the car's own visible paint; a catalogue car in the factory colour
 *    the next one bought of it will have), turning slowly. A new selection sinks the
 *    model into the stand and brings the next one up with a quick spin. The models are
 *    one cache for every stand (`modelCache`), the selection and its two neighbours
 *    ordered and any other order still waiting dropped, so a fast turn through the
 *    catalogue builds only what it stops at.
 *  - the brass PLAQUE says what the car is (model, comfort, boot cells; a boxed car's
 *    stickers, fuel and place in the box and what TAKE OUT will do now, or why it will
 *    not; a catalogue car's price in shells and whether the jar holds it).
 *  - the BUTTON, named under it for what it does: TAKE OUT swaps the selected boxed car
 *    for the one in the bay; BUY takes a catalogue car's price (`carShells`, the lot
 *    price) out of the jar and puts a new car of that model into the box
 *    (`orderCatalogueCar`, `car_order`), selected at once for TAKE OUT. Short of shells,
 *    the button rattles and nothing is taken.
 *
 * THE BAY (`toyBay`) is a yellow rectangle painted along the lay-by in front of the post
 * and the stand, between them and the parking line, a car's length and a little more,
 * and the swap works only through it (owner: the car must never land on the player's
 * head). TAKE OUT (`readBaySwap`):
 *  - the player must be on foot and not inside the bay or within `BAY_PLAYER_MARGIN_M`
 *    of its paint ("step out of the bay");
 *  - the player's car whose middle stands inside the bay (the one he last drove when it
 *    is there) goes into the box first (`FixtureContext.boxCar`), refused while it holds
 *    an active job's cargo (a broken souvenir goes in with it), a trailer or a tow bar
 *    (`boxRefusal`); with none in it, the bay must be empty and nothing goes in;
 *  - nothing else may reach into the bay: no other car, his own included, and no
 *    trailer (each taken as its own rectangle, as it stands);
 *  - then the selected car comes out in the bay's middle, nosed the way the lay-by's
 *    traffic runs, as it went in (fuel, wear, stickers, parts, its boot's own things), in
 *    the same press as the other went in. It is the car the post reads when none stands
 *    on its lay-by from then on (`PlayerState.lastDrivenCarId`).
 *
 * A boxed car is out of the world: in `WorldState.toyBox`, not in `cars`, so nothing
 * streams it, draws it or counts it (`car_box`, `car_unbox`; a bought one arrives there,
 * `car_order`). Only the player's own cars (`CarState.papers`) go in; a haul's car and
 * a lot car never do.
 */

/**
 * The bay: half its length (along the car) and half its width, metres. The GAZ-31029's
 * 4.88 m with 0.26 m to spare at each end; the widest car's 1.9 m with 0.35 m.
 */
export const BAY_HALF_LENGTH_M = 2.7;
export const BAY_HALF_WIDTH_M = 1.3;
/** Asphalt kept between the bay's paint and the service band the stand stands on, metres. */
const BAY_SERVICE_CLEAR_M = 0.5;
/**
 * The bay's middle along the road from the stand's, metres: toward the post, so it runs
 * −6.7…−1.3 along the pad, in front of the post and the stand. Nearer the parking row
 * the row's straight ends came within 0.2 m of it on the tightest curves
 * (tools/poi-placement.ts, 20 seeds); from here it keeps the bench's metre.
 */
const BAY_ALONG_M = -1.4;
/** The player must stand this far outside the bay's paint for a car to come out. */
export const BAY_PLAYER_MARGIN_M = 0.5;

/**
 * True when `car` carries an active contract thing (`isContractClosed` false), in its boot
 * or its cabin. A closed one — a broken souvenir — is
 * the car's own thing now and goes into the box with it.
 */
export function carHoldsContract(car: CarState, completedIds: readonly string[]): boolean {
  const active = (item: Item | null): boolean => item?.type === 'contract_cargo' && !isContractClosed(item, completedIds);
  return car.storage.some(active) || car.cabin.some(active);
}

/**
 * Why the player's car `carId` may not go into the toy box now, or null when it may:
 * not his, sat in, holding contract cargo, or coupled to a trailer or a tow bar.
 */
export function boxRefusal(state: WorldState, carId: string): string | null {
  const car = state.cars[carId];
  if (!car?.papers) return 'only your own car goes in the box';
  const label = carModel(car.modelId).label;
  if (state.player.drivingCarId === carId) return `get out of the ${label} first`;
  if (carHoldsContract(car, state.completedContractIds)) return `take the jobs out of the ${label} first`;
  const coupled =
    (car.towedBy ?? null) !== null ||
    Object.values(state.cars).some((other) => other.towedBy === carId) ||
    Object.values(state.trailers).some((trailer) => trailer.hitchedTo === carId);
  if (coupled) return `unhitch the ${label} first`;
  return null;
}

/**
 * Post stop `index`'s toy box bay, ABSOLUTE metres, in the parking row's slot shape
 * (world/haulbay.ts `ParkingSlot`: `yaw` the heading of a car standing in it, local +Z its
 * nose, `halfDepth` along it). Pure from the seed and the road: along the road at the
 * stand's arclength plus `BAY_ALONG_M`, its outer paint `BAY_SERVICE_CLEAR_M` short of the
 * service band, so it lies between the stand and the lay-by's parking line (world/layby.ts),
 * where traffic stops and drives through.
 */
export function toyBay(seed: number, road: Road, index: number): ParkingSlot {
  const stop = roadsideStop(seed, postSlot(index));
  const at = stop?.layout.toybox;
  if (!stop?.pad || !at) throw new Error(`toyBay: post ${index} has no toy box`);
  const s = at.s + BAY_ALONG_M;
  const u = stop.pad.serviceInner - BAY_SERVICE_CLEAR_M - BAY_HALF_WIDTH_M;
  const middle = road.offsetPoint(s, stop.layout.side * u);
  const heading = road.headingAt(s);
  // Nosed the way traffic on that side runs, as the start's car is (story/site.ts).
  return {
    x: middle.x,
    z: middle.z,
    yaw: stop.layout.side < 0 ? heading : heading + Math.PI,
    halfWidth: BAY_HALF_WIDTH_M,
    halfDepth: BAY_HALF_LENGTH_M,
    s,
  };
}

/** Something standing on the pad as a rectangle, ABSOLUTE metres: its middle, heading and half sizes. */
export interface BayFootprint {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly halfWidth: number;
  readonly halfLength: number;
}

/** Whether ABSOLUTE (`x`, `z`) lies inside `bay`, grown by `margin` all round. */
export function inToyBay(bay: ParkingSlot, x: number, z: number, margin = 0): boolean {
  const dx = x - bay.x;
  const dz = z - bay.z;
  const sin = Math.sin(bay.yaw);
  const cos = Math.cos(bay.yaw);
  return Math.abs(dx * cos - dz * sin) < bay.halfWidth + margin && Math.abs(dx * sin + dz * cos) < bay.halfDepth + margin;
}

/** Whether `other`'s rectangle reaches into `bay`'s: the separating-axis test on the four sides' normals. */
export function overlapsToyBay(bay: ParkingSlot, other: BayFootprint): boolean {
  const dx = other.x - bay.x;
  const dz = other.z - bay.z;
  const axes = [bay.yaw, bay.yaw + Math.PI / 2, other.yaw, other.yaw + Math.PI / 2];
  for (const axis of axes) {
    // The axis (sin, cos) and its perpendicular: each rectangle's reach along it.
    const ax = Math.sin(axis);
    const az = Math.cos(axis);
    const reach = (yaw: number, halfWidth: number, halfLength: number): number =>
      halfLength * Math.abs(Math.sin(yaw) * ax + Math.cos(yaw) * az) + halfWidth * Math.abs(Math.cos(yaw) * ax - Math.sin(yaw) * az);
    const gap = Math.abs(dx * ax + dz * az);
    if (gap >= reach(bay.yaw, bay.halfWidth, bay.halfDepth) + reach(other.yaw, other.halfWidth, other.halfLength)) return false;
  }
  return true;
}

/** Where the cars and trailers stand now, as rectangles, or null for one not in the world. */
export interface BayWorld {
  car(carId: string): BayFootprint | null;
  trailer(trailerId: string): BayFootprint | null;
}

/** What TAKE OUT would do with the bay now: the car that goes in, or why nothing may. */
export interface BaySwap {
  readonly inCarId: string | null;
  readonly refusal: string | null;
}

/** The rules of TAKE OUT at `bay` (see the header), from the state and where things stand. */
export function readBaySwap(state: WorldState, bay: ParkingSlot, where: BayWorld): BaySwap {
  const player = state.player;
  if (player.drivingCarId) return { inCarId: null, refusal: 'step out of the car first' };
  if (inToyBay(bay, player.x, player.z, BAY_PLAYER_MARGIN_M)) return { inCarId: null, refusal: 'step out of the bay' };
  // The car that goes in: his own, its middle in the bay; the last driven, else the nearest.
  let inCarId: string | null = null;
  let best = Infinity;
  for (const [carId, car] of Object.entries(state.cars)) {
    if (!car.papers) continue;
    const at = where.car(carId);
    if (!at || !inToyBay(bay, at.x, at.z)) continue;
    if (carId === player.lastDrivenCarId) {
      inCarId = carId;
      break;
    }
    const d2 = (at.x - bay.x) ** 2 + (at.z - bay.z) ** 2;
    if (d2 >= best) continue;
    best = d2;
    inCarId = carId;
  }
  if (inCarId) {
    const refusal = boxRefusal(state, inCarId);
    if (refusal) return { inCarId, refusal };
  }
  for (const [carId, car] of Object.entries(state.cars)) {
    if (carId === inCarId) continue;
    const at = where.car(carId);
    if (!at || !overlapsToyBay(bay, at)) continue;
    const label = carModel(car.modelId).label;
    if (!car.papers) return { inCarId, refusal: `the bay is taken: a ${label} stands in it` };
    // His own: half in with the bay otherwise empty, he means it to go in.
    if (!inCarId && !inToyBay(bay, at.x, at.z)) return { inCarId, refusal: `drive the ${label} right into the bay` };
    return { inCarId, refusal: `move your ${label} out of the bay` };
  }
  for (const trailerId of Object.keys(state.trailers)) {
    const at = where.trailer(trailerId);
    if (at && overlapsToyBay(bay, at)) return { inCarId, refusal: 'the bay is taken: a trailer stands in it' };
  }
  return { inCarId, refusal: null };
}

/** The heading a saved quaternion turns local +Z to. */
function quaternionYaw(q: { readonly qx: number; readonly qy: number; readonly qz: number; readonly qw: number }): number {
  return Math.atan2(2 * (q.qx * q.qz + q.qw * q.qy), 1 - 2 * (q.qx * q.qx + q.qy * q.qy));
}

/**
 * THE CATALOGUE on every stand's wheel, after the boxed cars: every car of the game
 * (`CAR_MODELS`), cheapest first (`carShells`, the lot price) and by name within a price.
 */
export const TOY_CATALOGUE: readonly string[] = [...CAR_MODELS]
  .sort((a, b) => carShells(a.id) - carShells(b.id) || a.label.localeCompare(b.label))
  .map((def) => def.id);

/**
 * The id the next `modelId` bought from the catalogue gets: the first free
 * `car:toy:<seed>:<model>:<k>`, boxed or out. Its factory colour is hashed from it
 * (vehicle/carpaint.ts), so the turntable shows the very paint the car will have.
 */
export function catalogueCarId(seed: number, state: WorldState, modelId: string): string {
  for (let k = 0; ; k++) {
    const id = `car:toy:${seed.toString(36)}:${modelId}:${k}`;
    if (!state.cars[id] && !state.toyBox[id]) return id;
  }
}

/** Litres of a new car's tank it comes with, as a share: enough to reach a pump. */
const CATALOGUE_FUEL_SHARE = 0.25;

/**
 * A car new from the catalogue, boxed: clean and unscratched, nothing on the odometer,
 * its water and oil topped, a fresh air filter, an empty boot, a quarter of a tank. Its
 * pose is the box's: `car_unbox` gives it one.
 */
export function makeCatalogueCar(carId: string, modelId: string): CarState {
  const def = carModel(modelId);
  const bonnet = createBonnetStorage(carId, def.engineId);
  return {
    id: carId,
    modelId,
    papers: true,
    stickers: [],
    headlightMode: 'off',
    taillightsOn: false,
    reverseLightsOn: false,
    dirt: 0,
    scratches: 0,
    paint: null,
    fuelLitres: def.tankLitres * CATALOGUE_FUEL_SHARE,
    waterLitres: bonnetWaterCapacity(bonnet),
    oilLitres: oilCapacity(modelEngine(def)),
    engineTempC: COLD_SOAK_C,
    storage: new Array<Item | null>(trunkCellCount(def.trunkGrid)).fill(null),
    bonnet,
    cabin: emptyCabin(),
    odometer: 0,
    x: 0,
    y: 0,
    z: 0,
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
  };
}

/**
 * BUY: `pay` takes `modelId`'s price (`carShells`) out of the jar in one go, and a new
 * car of it goes into the toy box (`car_order`). Its id, or null with nothing taken
 * when the jar is short.
 */
export function orderCatalogueCar(world: GameWorld, modelId: string, pay: (count: number) => boolean): string | null {
  const carId = catalogueCarId(world.seed, world.state, modelId);
  if (!pay(carShells(modelId))) return null;
  world.apply({ t: 'car_order', car: makeCatalogueCar(carId, modelId) });
  return carId;
}

/** A model ready to stand on a turntable: its geometry (floor-centred) and its size at 1:1. */
interface Model {
  readonly geometry: THREE.BufferGeometry;
  readonly halfWidth: number;
  readonly halfLength: number;
  readonly height: number;
}

/** The world's one die-cast shop for the stands, opened on the first order; null headless. */
let toyShop: DieCastShop | null | undefined;
/**
 * Every stand's built models by `modelId:paint`, oldest first: about 1.3 MB of arrays
 * each, so the oldest no turntable shows is let go past `MODEL_CACHE_MAX`.
 */
const MODEL_CACHE_MAX = 8;
const modelCache = new Map<string, Model>();
/** How many turntables show each cached model now: those are never let go. */
const modelsShown = new Map<string, number>();
/** The orders waiting or being built, by key. */
const modelOrders = new Map<string, DieCastOrder>();
/** The live stands, each with the keys it wants built (its selection and neighbours). */
const modelWants = new Map<object, ReadonlySet<string>>();

/** `key`'s model, marked the most recently used. */
function cachedModel(key: string): Model | undefined {
  const model = modelCache.get(key);
  if (model) {
    modelCache.delete(key);
    modelCache.set(key, model);
  }
  return model;
}

function showModel(key: string, delta: 1 | -1): void {
  const count = (modelsShown.get(key) ?? 0) + delta;
  if (count > 0) modelsShown.set(key, count);
  else modelsShown.delete(key);
}

/** Drops every waiting order no live stand wants any more. */
function dropUnwantedOrders(): void {
  for (const [key, order] of modelOrders) {
    if ([...modelWants.values()].some((keys) => keys.has(key))) continue;
    if (toyShop?.cancel(order)) modelOrders.delete(key);
  }
}

/**
 * Stand `who` wants `wants` built (`modelId`, `paint` and key each), null when it is
 * gone: orders the missing ones and drops every waiting order no live stand wants.
 */
function wantModels(who: object, wants: ReadonlyArray<{ readonly key: string; readonly modelId: string; readonly paint: number }> | null): void {
  if (wants) modelWants.set(who, new Set(wants.map((want) => want.key)));
  else modelWants.delete(who);
  dropUnwantedOrders();
  for (const { key, modelId, paint } of wants ?? []) {
    if (modelCache.has(key) || modelOrders.has(key) || !hasCarModel(modelId)) continue;
    if (toyShop === undefined) toyShop = dieCastShopAvailable() ? new DieCastShop('toy box', false) : null;
    if (!toyShop) return;
    const order: DieCastOrder = {
      modelId,
      color: paint,
      scale: 1,
      done: (arrays) => {
        modelOrders.delete(key);
        const geometry = dieCastGeometry(arrays);
        geometry.computeBoundingBox();
        const { min, max } = geometry.boundingBox!;
        // Its floor at the origin, its middle on the axle.
        geometry.translate(-(min.x + max.x) / 2, -min.y, -(min.z + max.z) / 2);
        modelCache.set(key, { geometry, halfWidth: (max.x - min.x) / 2, halfLength: (max.z - min.z) / 2, height: max.y - min.y });
        for (const old of modelCache.keys()) {
          if (modelCache.size <= MODEL_CACHE_MAX) break;
          if (modelsShown.has(old) || old === key) continue;
          modelCache.get(old)!.geometry.dispose();
          modelCache.delete(old);
        }
      },
    };
    modelOrders.set(key, order);
    toyShop.order(order);
  }
}

/**
 * Builds stop `stop`'s toy box on its settlement spot `at`, its front to the road, and
 * paints its bay. In the physics band it is solid, registers its fixture (id pushed to
 * `registered`) and orders its model; beyond it, it is only seen. `disposers` gets the
 * plaque and the stand's model orders (the built models stay in the shared cache).
 */
export function buildToyBox(
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
  const parts = buildToyStand(ctx, stop.s, x, z, yaw, devLook.stand, group, bodies, colliders, disposers);
  const bay = toyBay(ctx.world.seed, ctx.road, stop.index);
  paintToyBay(ctx, bay, group);
  const box = new ToyBox(ctx.world, ctx.terrain, stop, bay, parts, ctx.hasPhysics);
  disposers.push(() => box.dispose());
  if (ctx.hasPhysics) registered.push(fixtures.register(box));
}

/**
 * Where to stand to work the toy box, in its spot's frame: metres toward the viewer's
 * left (local +X) and out in front of it (app/devtools.ts `standAtPost`).
 */
export function toyBoxApproach(): readonly [number, number] {
  const face = STAND_FACES[devLook.stand];
  return [face[0], 0.8 - face[2]];
}

/** One car per sixth of a turn of the handwheel: a spoke. Clockwise as the framing camera sees it is forward. */
const DETENT = Math.PI / 3;
/** Timelines, seconds: the button, its rattle, the model going down and coming up. */
const BUTTON_S = 0.3;
const REFUSE_S = 0.4;
const SINK_S = 0.3;
const RISE_S = 0.55;
/** The turns a model makes coming up, on top of the turntable's own. */
const RISE_TURNS = 1;
const FOCUS_FOV = 50;

type Part = 'body' | 'wheel' | 'button' | 'plaque';

/** The plaque's footer band: the button will work, or will not. */
const READY_BAND = '#2f5a2a';
const REFUSED_BAND = '#7a2a1a';

/** What the wheel selects: a boxed car (`carId`), or a catalogue model (`carId` null). */
interface Entry {
  readonly carId: string | null;
  readonly modelId: string;
}

/** An entry's model as the turntable shows it: its model, its paint and its cache key. */
interface EntryModel {
  readonly key: string;
  readonly modelId: string;
  readonly paint: number;
}

class ToyBox implements WorldFixture {
  readonly id: string;
  private part: Part | null = null;
  private focused = false;
  /** The boxed cars in the box's order, then the catalogue; the one the wheel has selected. */
  private entries: Entry[] = [];
  private selected = 0;
  /** The bay as last read (on focus, after a press): the plaque's last lines. */
  private swap: BaySwap = { inCarId: null, refusal: null };
  /** The handwheel's angle, where it is easing to, and the detent it last counted. */
  private wheelAngle = 0;
  private wheelTarget = 0;
  private detent = 0;
  private gripping = false;
  private gripTravel = 0;
  private buttonT = -1;
  private refuseT = 0;
  /** The turntable's angle. */
  private turn = 0;
  /** The model the selection wants on the turntable, the one standing there, and how far up it is (0 sunk, 1 up). */
  private wanted: string | null = null;
  private shown: string | null = null;
  private rise = 0;
  private mesh: THREE.Mesh | null = null;
  /** How many entries are boxed cars: the rest is the catalogue. */
  private boxedCount = 0;
  private readonly layout: StandLayout;
  private readonly focusPose: FixtureFocus;

  constructor(
    private readonly world: GameWorld,
    private readonly terrain: Terrain,
    private readonly stop: PostStop,
    private readonly bay: ParkingSlot,
    private readonly parts: ToyStandParts,
    /** Models are ordered only for a stand the player can reach. */
    private readonly live: boolean,
  ) {
    this.id = `toybox:${stop.index}`;
    this.layout = parts.layout;
    const { face, floor } = this.layout;
    // Framed from in front, looking between the plaque and the turntable. A lectern beside
    // the turntable (carousel, podium) stands in front of part of it, so the eye goes over
    // to the turntable's side and up, and the model shows past the lectern.
    const aside = Math.sign(floor[0] - face[0]);
    const blend = aside === 0 ? 0.4 : 0.5;
    const look: V3 = [face[0] + blend * (floor[0] - face[0]), face[1] + 0.35 * (floor[1] - face[1]), face[2] + blend * (floor[2] - face[2])];
    const [eyeX, eyeY, eyeZ] = this.absolute(
      aside === 0 ? [look[0] - 0.45, look[1] + 0.7, face[2] - 1.7] : [look[0] + 0.55 * aside, look[1] + 1.0, face[2] - 2.0],
    );
    const [lookX, lookY, lookZ] = this.absolute(look);
    this.focusPose = { eyeX, eyeY, eyeZ, lookX, lookY, lookZ, fov: FOCUS_FOV };
    this.listEntries();
    this.selectionChanged(false);
  }

  /** A point of the stand's frame in ABSOLUTE metres. */
  private absolute(p: V3): [number, number, number] {
    const c = Math.cos(this.parts.yaw);
    const s = Math.sin(this.parts.yaw);
    return [this.parts.x + c * p[0] + s * p[2], this.parts.y + p[1], this.parts.z - s * p[0] + c * p[2]];
  }

  /** The chunk went: its models stay in the cache for the next stand, its waiting orders go. */
  dispose(): void {
    if (this.shown !== null) showModel(this.shown, -1);
    this.shown = null;
    wantModels(this, null);
  }

  focus(): FixtureFocus {
    return this.focusPose;
  }

  setFocused(focused: boolean, ctx: FixtureContext): void {
    const was = this.focused;
    this.focused = focused;
    if (!focused) this.release();
    else if (!was) this.refresh(ctx);
  }

  /** The boxed cars then the catalogue, the selection kept on the entry it was on, else on `select`. */
  private listEntries(select?: string): void {
    const current = this.entries[this.selected];
    const toyBox = this.world.state.toyBox;
    const boxed = Object.keys(toyBox).map((carId): Entry => ({ carId, modelId: toyBox[carId]!.modelId }));
    this.boxedCount = boxed.length;
    this.entries = [...boxed, ...TOY_CATALOGUE.map((modelId): Entry => ({ carId: null, modelId }))];
    const keep = this.entries.findIndex((entry) =>
      select !== undefined ? entry.carId === select : current !== undefined && entry.carId === current.carId && entry.modelId === current.modelId,
    );
    // A car gone out of the box: the entry that took its place.
    this.selected = keep >= 0 ? keep : current === undefined ? 0 : Math.min(this.selected, this.entries.length - 1);
  }

  /** The box's cars and the bay read again, the plaque repainted and the neighbours' models ordered. */
  private refresh(ctx: FixtureContext, select?: string): void {
    this.listEntries(select);
    this.swap = this.readSwap(ctx);
    this.selectionChanged(true);
  }

  /** Entry `index`'s model: a boxed car in its visible paint, a catalogue car in the next one's factory paint. */
  private entryModel(index: number): EntryModel {
    const { carId, modelId } = this.entries[index]!;
    const car = carId === null ? undefined : this.world.state.toyBox[carId];
    const paint = car ? visiblePaintHex(car.paint, modelId, car.id) : factoryPaintHex(modelId, catalogueCarId(this.world.seed, this.world.state, modelId));
    return { key: `${modelId}:${paint}`, modelId, paint };
  }

  /**
   * The selection or what the plaque says changed: repaint it, name the button, and ask
   * for the model; with `neighbours`, the entries a turn either way too, so the next one
   * is there when it is asked for.
   */
  private selectionChanged(neighbours: boolean): void {
    const count = this.entries.length;
    const wanted = this.entryModel(this.selected);
    this.wanted = wanted.key;
    if (this.live) {
      const wants = [wanted];
      if (neighbours) wants.push(this.entryModel((this.selected + 1) % count), this.entryModel((this.selected + count - 1) % count));
      wantModels(this, wants);
    }
    const buying = this.entries[this.selected]!.carId === null;
    this.parts.takeOutLabel.visible = !buying;
    this.parts.buyLabel.visible = buying;
    this.paintPlaque();
  }

  /** The scale `model` stands at: as large as the variant allows, inside its reach and clear of its pole. */
  private scaleOf(model: Model): number {
    const { ride, reach, inner, maxScale } = this.layout;
    const a = model.halfWidth * model.halfWidth + model.halfLength * model.halfLength;
    // The outer corner on the reach: (ride + w s)² + (l s)² = reach².
    const outer = (-ride * model.halfWidth + Math.sqrt(ride * ride * model.halfWidth * model.halfWidth - a * (ride * ride - reach * reach))) / a;
    const inside = ride > 0 ? (ride - inner) / model.halfWidth : Infinity;
    return Math.min(maxScale, outer, inside);
  }

  private paintPlaque(): void {
    const map = this.parts.plaque.map;
    const canvas: unknown = map?.image;
    // The headless tools build stops with no DOM: their plaque is a blank data texture.
    if (!map || typeof HTMLCanvasElement === 'undefined' || !(canvas instanceof HTMLCanvasElement)) return;
    const g = canvas.getContext('2d');
    if (!g) return;
    const w = canvas.width;
    const h = canvas.height;
    const entry = this.entries[this.selected]!;
    g.save();
    // A brass plate with an engraved border and four screws.
    const brass = g.createLinearGradient(0, 0, w, h);
    brass.addColorStop(0, '#e6cb7e');
    brass.addColorStop(0.55, '#c9a24c');
    brass.addColorStop(1, '#a9832f');
    g.fillStyle = brass;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#6b5220';
    g.lineWidth = 5;
    g.strokeRect(14, 14, w - 28, h - 28);
    g.fillStyle = '#6b5220';
    for (const [sx, sy] of [[28, 28], [w - 28, 28], [28, h - 28], [w - 28, h - 28]] as const) {
      g.beginPath();
      g.arc(sx, sy, 7, 0, Math.PI * 2);
      g.fill();
    }
    g.textBaseline = 'middle';
    g.fillStyle = '#3a2a10';
    g.font = `bold ${Math.round(h * 0.075)}px sans-serif`;
    g.textAlign = 'left';
    const model = carModel(entry.modelId);
    const car = entry.carId === null ? undefined : this.world.state.toyBox[entry.carId];
    const ordinal = car ? `${this.selected + 1}/${this.boxedCount}` : `${this.selected - this.boxedCount + 1}/${TOY_CATALOGUE.length}`;
    g.fillText(car ? 'TOY BOX' : 'CATALOGUE', w * 0.08, h * 0.13, w * 0.5);
    g.textAlign = 'right';
    g.fillText(ordinal, w * 0.92, h * 0.13, w * 0.3);
    g.fillRect(w * 0.06, h * 0.2, w * 0.88, 3);

    const headline = model.label;
    const lines = [`comfort ${model.comfort} · boot ${trunkCellCount(model.trunkGrid)} cells`];
    let footer: string;
    let refused: boolean;
    if (car) {
      const stickers = car.stickers.length;
      const inCar = this.swap.inCarId ? this.world.state.cars[this.swap.inCarId] : undefined;
      lines.push(
        `${stickers} sticker${stickers === 1 ? '' : 's'} · ${Math.round(car.fuelLitres)} l of fuel`,
        this.swap.refusal ?? (inCar ? `your ${carModel(inCar.modelId).label} goes into the box` : 'the bay is clear'),
      );
      refused = this.swap.refusal !== null;
      footer = refused ? 'TAKE OUT will not work now' : 'TAKE OUT: it comes out in the bay';
    } else {
      const price = carShells(entry.modelId);
      const have = this.world.state.player.shells;
      refused = have < price;
      lines.push(`a new one: ${formatPay(price)}`, refused ? `${formatPay(price - have)} short` : 'it waits in the box, to take out');
      footer = refused ? 'BUY will not work: too few shells' : 'BUY: a new one into your box';
    }
    g.textAlign = 'left';
    g.font = `bold ${Math.round(h * 0.12)}px sans-serif`;
    fillGameText(g, headline, w * 0.08, h * 0.32, w * 0.84);
    g.font = `${Math.round(h * 0.07)}px sans-serif`;
    lines.forEach((line, i) => fillGameText(g, line, w * 0.08, h * (0.47 + i * 0.105), w * 0.84));
    // The footer engraved on a band of its own: green when the button will work, red when not.
    g.fillStyle = refused ? REFUSED_BAND : READY_BAND;
    g.fillRect(w * 0.06, h * 0.79, w * 0.88, h * 0.12);
    g.fillStyle = '#f2e6c4';
    g.font = `bold ${Math.round(h * 0.062)}px sans-serif`;
    g.textAlign = 'center';
    fillGameText(g, footer, w / 2, h * 0.85, w * 0.84);
    g.restore();
    map.needsUpdate = true;
  }

  /** The bay as it is now, from the live poses. */
  private readSwap(ctx: FixtureContext): BaySwap {
    const state = this.world.state;
    const probe = ctx.probe(this.stop.index, this.bay.x, this.bay.z);
    return readBaySwap(state, this.bay, {
      car: (carId) => {
        const car = state.cars[carId];
        const at = probe.carPosition(carId);
        if (!car || !at || !hasCarModel(car.modelId)) return null;
        const half = carModelMeasure(car.modelId).halfExtents;
        return { x: at.x, z: at.z, yaw: quaternionYaw(car), halfWidth: half[0], halfLength: half[2] };
      },
      trailer: (trailerId) => {
        const trailer = state.trailers[trailerId];
        const at = probe.trailerPosition(trailerId);
        if (!trailer || !at) return null;
        // Its ball's reach both ways: whichever way it stands, the drawbar is covered.
        return { x: at.x, z: at.z, yaw: quaternionYaw(trailer), halfWidth: TRAILER_HALF_WIDTH, halfLength: TRAILER_BALL_Z };
      },
    });
  }

  /** TAKE OUT: the bay's car into the box and the selected one out into the bay, or a refusal. */
  private takeOut(ctx: FixtureContext, outId: string): FoleyEvent {
    const state = this.world.state;
    const out = state.toyBox[outId];
    if (!out) return this.refuse();
    const swap = this.readSwap(ctx);
    if (swap.refusal) {
      ctx.toast(swap.refusal);
      this.swap = swap;
      this.paintPlaque();
      return this.refuse();
    }
    let boxedLabel: string | null = null;
    if (swap.inCarId) {
      const going = state.cars[swap.inCarId]!;
      ctx.boxCar(swap.inCarId);
      if (state.cars[swap.inCarId]) return this.refuse();
      boxedLabel = carModel(going.modelId).label;
    }
    this.world.apply({ t: 'car_unbox', carId: outId, ...this.standing(out) });
    const label = carModel(out.modelId).label;
    ctx.toast(boxedLabel ? `the ${boxedLabel} went into the box, the ${label} is out` : `the ${label} is out in the bay`);
    // The turntable shows the car that went in.
    this.refresh(ctx, swap.inCarId ?? undefined);
    // Let go, so the player sees it standing there.
    ctx.stepBack();
    return 'mount';
  }

  /**
   * BUY: a new `modelId` into the box for its price, selected at once so TAKE OUT is the
   * next press; the turntable keeps the model, which was already in the bought car's paint.
   */
  private buy(ctx: FixtureContext, modelId: string): FoleyEvent {
    const label = carModel(modelId).label;
    const carId = orderCatalogueCar(this.world, modelId, (count) => ctx.debit(count));
    if (!carId) {
      ctx.toast(`the ${label} is ${formatPay(carShells(modelId))}: too few shells`);
      return this.refuse();
    }
    ctx.toast(`the ${label} is yours: it waits in the box`);
    this.refresh(ctx, carId);
    return 'coin';
  }

  private refuse(): FoleyEvent {
    this.refuseT = REFUSE_S;
    return 'refused';
  }

  /** The pose `car` comes out at: in the bay's middle, on its own wheels, in clear air over the ground. */
  private standing(car: CarState): { x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number } {
    const { x, z, yaw, s } = this.bay;
    const measure = carModelMeasure(car.modelId);
    const plane = poseOnGround(measure.wheels, x, z, yaw, (gx, gz) => this.terrain.heightAt(gx, gz));
    const groundY = plane ? plane.groundY : this.terrain.heightAt(x, z, s);
    const y = carSpawnYAboveGround(measure, groundY);
    if (plane) return { x, y, z, qx: plane.qx, qy: plane.qy, qz: plane.qz, qw: plane.qw };
    return { x, y, z, qx: 0, qy: Math.sin(yaw / 2), qz: 0, qw: Math.cos(yaw / 2) };
  }

  /** The cursor or eye ray in the stand's frame. */
  private toLocal(originX: number, originZ: number, eyeX: number, eyeY: number, eyeZ: number, dx: number, dz: number): [number, number, number, number, number] {
    const c = Math.cos(this.parts.yaw);
    const s = Math.sin(this.parts.yaw);
    const rx = eyeX - (this.parts.x - originX);
    const rz = eyeZ - (this.parts.z - originZ);
    return [c * rx - s * rz, eyeY - this.parts.y, s * rx + c * rz, c * dx - s * dz, s * dx + c * dz];
  }

  aim(originX: number, originZ: number, eyeX: number, eyeY: number, eyeZ: number, dx: number, dy: number, dz: number, range: number): number {
    const [ox, oy, oz, lx, lz] = this.toLocal(originX, originZ, eyeX, eyeY, eyeZ, dx, dz);
    let best = Infinity;
    let part: Part = 'body';
    const test = (p: Part, c: V3, h: V3): void => {
      const t = rayBox(ox, oy, oz, lx, dy, lz, c[0], c[1], c[2], h[0], h[1], h[2]);
      if (t < best) {
        best = t;
        part = p;
      }
    };
    for (const solid of this.layout.solids) test('body', solid.c, solid.h);
    const face = this.layout.face;
    test('plaque', plaqueCentre(face), PLAQUE_HALF);
    test('wheel', wheelCentre(face), WHEEL_HALF);
    test('button', buttonCentre(face), BUTTON_HALF);
    this.part = best > range ? null : part;
    return best > range ? Infinity : best;
  }

  prompt(_ctx: FixtureContext): string | null {
    // Worked up close it says nothing: the plaque and the model are the text.
    if (this.focused || this.part === null) return null;
    return '[F] TOY BOX';
  }

  press(ctx: FixtureContext): FoleyEvent | null {
    switch (this.part) {
      case 'button': {
        this.buttonT = 0;
        const entry = this.entries[this.selected]!;
        return entry.carId === null ? this.buy(ctx, entry.modelId) : this.takeOut(ctx, entry.carId);
      }
      case 'wheel':
        // A click without a drag still turns it one entry.
        return this.turnBy(1);
      default:
        return null;
    }
  }

  grab(originX: number, originZ: number, eyeX: number, eyeY: number, eyeZ: number, dx: number, dy: number, dz: number): boolean {
    this.aim(originX, originZ, eyeX, eyeY, eyeZ, dx, dy, dz, Infinity);
    if (this.part !== 'wheel') return false;
    this.gripping = true;
    this.gripTravel = 0;
    return true;
  }

  pivot(): { x: number; y: number; z: number } {
    const [x, y, z] = this.absolute(wheelCentre(this.layout.face));
    return { x, y, z };
  }

  drag(turn: number): FoleyEvent | null {
    if (!this.gripping) return null;
    // The wheel follows the hand round its axle as the screen shows it.
    this.gripTravel += Math.abs(turn);
    this.wheelTarget += turn;
    this.wheelAngle = this.wheelTarget;
    return this.countDetents();
  }

  release(): FoleyEvent | null {
    if (!this.gripping) return null;
    this.gripping = false;
    if (this.gripTravel < 0.05) return this.turnBy(1);
    // Let go, it settles on the nearest spoke.
    this.wheelTarget = Math.round(this.wheelTarget / DETENT) * DETENT;
    return this.countDetents();
  }

  scroll(notches: number): FoleyEvent | null {
    return this.turnBy(notches);
  }

  /** Turns the wheel `steps` spokes on its own (a click, the mouse wheel). */
  private turnBy(steps: number): FoleyEvent | null {
    this.wheelTarget = (Math.round(this.wheelTarget / DETENT) + steps) * DETENT;
    return this.countDetents();
  }

  /** An entry on for every spoke the wheel's target has passed since the last count. */
  private countDetents(): FoleyEvent | null {
    const detent = Math.round(this.wheelTarget / DETENT);
    const steps = detent - this.detent;
    if (steps === 0) return null;
    this.detent = detent;
    const count = this.entries.length;
    this.selected = (((this.selected + steps) % count) + count) % count;
    this.selectionChanged(true);
    return 'click';
  }

  cursor(): 'grab' | 'grabbing' | 'pointer' | null {
    if (this.gripping) return 'grabbing';
    if (this.part === 'wheel') return 'grab';
    if (this.part === 'button') return 'pointer';
    return null;
  }

  update(dt: number): void {
    if (!this.gripping) this.wheelAngle += (this.wheelTarget - this.wheelAngle) * Math.min(1, dt * 14);
    // Seen from the front, a turn about +Z (away from the viewer) is clockwise, as the drag is.
    this.parts.wheel.rotation.z = this.wheelAngle;

    let push = 0;
    if (this.buttonT >= 0) {
      this.buttonT += dt;
      push = 0.02 * Math.sin(Math.PI * Math.min(1, this.buttonT / BUTTON_S));
      if (this.buttonT >= BUTTON_S) this.buttonT = -1;
    }
    if (this.refuseT > 0) {
      this.refuseT = Math.max(0, this.refuseT - dt);
      push += 0.006 * Math.sin(this.refuseT * 70) * (this.refuseT / REFUSE_S);
    }
    this.parts.buttonCap.position.z = buttonCentre(this.layout.face)[2] + push;

    this.updateModel(dt);
    // The chunk froze every matrix when it was placed (world/chunks.ts
    // `freezeStaticSubtree`): the moving parts write their own.
    this.parts.wheel.updateMatrix();
    this.parts.buttonCap.updateMatrix();
    this.parts.turntable.updateMatrix();
    this.mesh?.updateMatrix();
  }

  /** The turntable turns; a model not the wanted one sinks, and the wanted one rises with a spin once it is built. */
  private updateModel(dt: number): void {
    let spin = this.layout.spin;
    if (this.shown !== this.wanted) {
      if (this.shown !== null && this.rise > 0) {
        this.rise = Math.max(0, this.rise - dt / SINK_S);
      } else {
        const model = this.wanted === null ? undefined : cachedModel(this.wanted);
        if (model) this.stand(model);
        else if (this.mesh) this.mesh.visible = false;
        if (this.shown !== null) showModel(this.shown, -1);
        this.shown = model ? this.wanted : null;
        if (this.shown !== null) showModel(this.shown, 1);
      }
    } else if (this.shown !== null && this.rise < 1) {
      this.rise = Math.min(1, this.rise + dt / RISE_S);
      // Easing off as it comes up: `RISE_TURNS` extra turns in all.
      spin += ((4 * Math.PI * RISE_TURNS) / RISE_S) * (1 - this.rise);
    }
    this.turn = (this.turn + spin * dt) % (Math.PI * 2);
    this.parts.turntable.rotation.y = this.turn;
    const model = this.shown === null ? undefined : modelCache.get(this.shown);
    if (this.mesh && model) {
      const depth = model.height * this.mesh.scale.x + 0.02;
      const eased = this.rise * this.rise * (3 - 2 * this.rise);
      this.mesh.position.y = -(1 - eased) * depth;
      this.mesh.visible = this.rise > 0;
    }
  }

  /** Puts `model` on the turntable, sunk, at its scale. */
  private stand(model: Model): void {
    if (!this.mesh) {
      // The POI kit's palette material: the colours are in the vertices, and its program
      // is linked at boot (world/market.ts `marketProgramAnchor`), shadows and all.
      this.mesh = new THREE.Mesh(model.geometry, makeFlatPaletteMaterial(0.88));
      this.mesh.name = 'toy-model';
      this.mesh.castShadow = true;
      this.mesh.receiveShadow = true;
      this.mesh.matrixAutoUpdate = false;
      this.parts.turntable.add(this.mesh);
    }
    this.mesh.geometry = model.geometry;
    this.mesh.scale.setScalar(this.scaleOf(model));
    this.mesh.position.set(this.layout.ride, -(model.height * this.mesh.scale.x + 0.02), 0);
    this.mesh.visible = false;
    this.rise = 0;
  }
}
