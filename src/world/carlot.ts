import * as THREE from 'three';
import { hash01 } from '../core/rng';
import type { CarState } from '../game/state';
import { carShells, formatPrice } from '../economy/economy';
import type { ShellPrice } from '../economy/shells';
import { oilCapacity, variant } from '../parts/registry';
import { CAR_MODELS, type CarModelDef } from '../vehicle/carmodels';
import { trunkCellCount } from '../vehicle/trunk';
import { bonnetWaterCapacity, createBonnetStorage } from '../vehicle/bonnet';
import { COLD_SOAK_C } from '../vehicle/cooling';
import type { ChunkContext } from './chunks';
import type { Poi } from './poi';
import { box, C, mergeKitStatics } from './poi/kit';
import { SIGN_PLANE, signMaterial, type MarketField } from './market';
import { emptyCabin } from '../vehicle/cabin';

/**
 * The car lots: one car for sale, with its price on a board beside it and a key box
 * (world/keybox.ts) on a post by the board, at the settlements whose layout has a lot.
 * Cars are bought, never found.
 *
 * Which settlements have a lot is their layout's (world/settlement.ts); which model
 * stands on it is a pure function of the seed, the stop and its km band. The car itself
 * is a real car in world state from the moment its chunk enters the physics band
 * (`car_add`), carrying `lotPrice` (shells) until it is bought: its key box takes the price
 * out of the player's jar in the one kind that box takes (`lot_pay`, `lotPaid`), and taking
 * the key from its drawer is `car_buy`: it is his from then on, and the car he had goes
 * into the toy box (world/toybox.ts). Nobody sits in it before that. Car prices are flat
 * (`carShells`, 5 to 10 shells by model); what changes down the road is which models
 * stand on the lots: dearer ones further on, the foreign cars only past `FOREIGN_FROM_KM`.
 */

const LOT_DOMAIN = 0x4c4f5431; // 'LOT1'

/** Kilometres per lot band: the model on a lot is drawn per band. */
const LOT_BAND_KM = 50;
/**
 * The dearest car a lot at home stands, shells, and how much dearer one may be per band
 * further on: which models a lot may hold, never what they cost.
 */
const LOT_SHELLS_HOME = 6;
const LOT_SHELLS_PER_BAND = 1;
/** The foreign cars stand on lots only this far from home. */
const FOREIGN_FROM_KM = 300;
const FOREIGN: Readonly<Record<string, true>> = { kit_nexia: true, kit_espero: true, kit_astraf: true, kit_vectraa: true };
/** The start car: never on a lot. */
const START_MODEL_ID = 'kit_vaz1111';

/**
 * The model standing on a stop's lot, or null when nothing on the road's pool is cheap
 * enough here. Whether a stop has a lot at all is its settlement layout's call
 * (world/settlement.ts).
 */
export function lotModel(seed: number, poi: Poi): CarModelDef | null {
  const band = Math.floor(poi.s / 1000 / LOT_BAND_KM);
  const bandKm = band * LOT_BAND_KM;
  const ceiling = LOT_SHELLS_HOME + band * LOT_SHELLS_PER_BAND;
  const pool = CAR_MODELS.filter(
    (def) =>
      def.id !== START_MODEL_ID
      && carShells(def.id) <= ceiling
      && (bandKm >= FOREIGN_FROM_KM || !FOREIGN[def.id]),
  );
  if (pool.length === 0) return null;
  return pool[Math.floor(hash01(seed, LOT_DOMAIN, band, poi.index) * pool.length)]!;
}

/**
 * The car standing on a lot: kept, not new. Some fuel to drive it off, the water part
 * topped, the oil in, a used filter, and its price until somebody pays it.
 */
export function makeLotCar(
  poi: Poi,
  carId: string,
  def: CarModelDef,
  x: number,
  y: number,
  z: number,
  yaw: number,
): CarState {
  const engine = variant(def.engineId).engine;
  const halfYaw = yaw / 2;
  const roll = (n: number): number => hash01(poi.variantSeed, LOT_DOMAIN, n);
  const bonnet = createBonnetStorage(carId, def.engineId, 0.1 + roll(9) * 0.5);
  return {
    id: carId,
    modelId: def.id,
    headlightMode: 'off',
    taillightsOn: false,
    reverseLightsOn: false,
    stickers: [],
    dirt: 0.25 + roll(7) * 0.3,
    scratches: 0.1 + roll(8) * 0.25,
    paint: null,
    fuelLitres: def.tankLitres * (0.2 + roll(3) * 0.15),
    waterLitres: bonnetWaterCapacity(bonnet) * (0.6 + roll(10) * 0.3),
    oilLitres: engine ? oilCapacity(engine) : 0,
    engineTempC: COLD_SOAK_C,
    storage: new Array(trunkCellCount(def.trunkGrid)).fill(null),
    bonnet,
    cabin: emptyCabin(),
    odometer: Math.floor(roll(4) * 180_000),
    x,
    y,
    z,
    qx: 0,
    qy: Math.sin(halfYaw),
    qz: 0,
    qw: Math.cos(halfYaw),
    lotPrice: carShells(def.id),
  };
}

/**
 * The price board beside a lot car: a post and a painted board, its face turned by
 * `faceYaw` (the board faces local +Z), showing `price` (its key box's kind and the
 * car's `lotPrice`). Registered with the market so buying the car takes it down at once.
 */
export function buildLotSign(
  ctx: ChunkContext,
  group: THREE.Group,
  carId: string,
  def: CarModelDef,
  price: ShellPrice,
  x: number,
  y: number,
  z: number,
  faceYaw: number,
  market: MarketField,
  registered: string[],
): void {
  const root = new THREE.Group();
  root.name = 'lot-sign';
  root.position.set(x - ctx.originX, y - 0.05, z - ctx.originZ);
  root.rotation.y = faceYaw;
  box(root, [0.06, 1.3, 0.06], [0, 0.65, -0.04], C.darkMetal);
  box(root, [0.68, 0.46, 0.03], [0, 1.2, -0.02], C.white);
  const board = new THREE.Mesh(
    SIGN_PLANE,
    signMaterial(['FOR SALE', def.label, formatPrice(price)], '#f2e6c4', '#7a1f12', 512, 340),
  );
  board.scale.set(0.64, 0.42, 1);
  board.position.set(0, 1.2, 0);
  root.add(board);
  mergeKitStatics(root);
  group.add(root);
  market.registerLotSign(carId, root);
  registered.push(carId);
}
