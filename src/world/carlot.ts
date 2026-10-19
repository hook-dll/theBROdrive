import * as THREE from 'three';
import { hash01 } from '../core/rng';
import type { CarState } from '../game/state';
import { carPrice } from '../economy/economy';
import { oilCapacity, variant } from '../parts/registry';
import { CAR_MODELS, type CarModelDef } from '../vehicle/carmodels';
import { bonnetWaterCapacity, createBonnetStorage } from '../vehicle/bonnet';
import { COLD_SOAK_C } from '../vehicle/cooling';
import type { ChunkContext } from './chunks';
import type { Poi } from './poi';
import type { PoiStock } from './poislots';
import { box, C } from './poi/kit';
import { SIGN_PLANE, signMaterial, type MarketField } from './market';
import { emptyCabin } from '../vehicle/cabin';

/**
 * The car lots: one car for sale, with its price on a board beside it, at some of the
 * stops that have a car field. Cars are bought, never found.
 *
 * Which stops have a lot, and which model stands on it, are pure functions of the seed,
 * the stop and its km band. The car itself is a real car in world state from the moment
 * its chunk enters the physics band (`car_add`), carrying `lotPrice` until it is bought
 * (`car_buy`): nobody sits in it before that. Car prices are flat (`carPrice`); what
 * changes down the road is which models stand on the lots: dearer ones further on, the
 * foreign cars only past `FOREIGN_FROM_KM`.
 */

const LOT_DOMAIN = 0x4c4f5431; // 'LOT1'

/** Chance a stop's car field has a car for sale, by what the stop is. */
const LOT_CHANCE: Readonly<Record<PoiStock, number>> = {
  salvage: 0.55,
  scrap: 0.4,
  fuel: 0.3,
  store: 0.25,
  home: 0.15,
  mast: 0.1,
};

/** Kilometres per lot band: the model on a lot is drawn per band. */
const LOT_BAND_KM = 50;
/** The dearest car a lot at home asks, coins, and how that ceiling rises per km. */
const LOT_PRICE_BASE = 40;
const LOT_PRICE_PER_KM = 0.5;
/** The foreign cars stand on lots only this far from home. */
const FOREIGN_FROM_KM = 300;
const FOREIGN: Readonly<Record<string, true>> = { kit_nexia: true, kit_espero: true, kit_astraf: true, kit_vectraa: true };
/** The start car: never on a lot. */
const START_MODEL_ID = 'kit_vaz1111';

/**
 * The car for sale in a field of `slotCount` places, or null when this stop has none: the
 * slot it takes and the model standing there.
 */
export function lotOffer(seed: number, poi: Poi, slotCount: number): { slot: number; def: CarModelDef } | null {
  if (slotCount === 0) return null;
  if (hash01(poi.variantSeed, LOT_DOMAIN, 0) >= LOT_CHANCE[poi.stock]) return null;
  const band = Math.floor(poi.s / 1000 / LOT_BAND_KM);
  const bandKm = band * LOT_BAND_KM;
  const ceiling = LOT_PRICE_BASE + bandKm * LOT_PRICE_PER_KM;
  const pool = CAR_MODELS.filter(
    (def) =>
      def.id !== START_MODEL_ID
      && carPrice(def.id) <= ceiling
      && (bandKm >= FOREIGN_FROM_KM || !FOREIGN[def.id]),
  );
  if (pool.length === 0) return null;
  return {
    slot: Math.floor(hash01(poi.variantSeed, LOT_DOMAIN, 1) * slotCount),
    def: pool[Math.floor(hash01(seed, LOT_DOMAIN, band, poi.index) * pool.length)]!,
  };
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
    storage: new Array(def.storageCells).fill(null),
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
    lotPrice: carPrice(def.id),
  };
}

/**
 * The price board beside a lot car: a post and a painted board, its face turned by
 * `faceYaw` (the board faces local +Z). Registered with the market so buying the car
 * takes it down at once.
 */
export function buildLotSign(
  ctx: ChunkContext,
  group: THREE.Group,
  carId: string,
  def: CarModelDef,
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
    signMaterial(['FOR SALE', def.label, `${carPrice(def.id)} coins`], '#f2e6c4', '#7a1f12', 512, 340),
  );
  board.scale.set(0.64, 0.42, 1);
  board.position.set(0, 1.2, 0);
  root.add(board);
  group.add(root);
  market.registerLotSign(carId, root);
  registered.push(carId);
}
