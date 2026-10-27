import { hash01 } from '../core/rng';
import type { CarState } from '../game/state';
import { variant } from '../parts/registry';
import type { AutopilotMode } from '../vehicle/autopilot';
import { bonnetPart } from '../vehicle/bonnet';
import { CAR_MODELS, carModel, modelEngine, type CarModelDef } from '../vehicle/carmodels';

/**
 * WHO WAITS AT THE GRID: the rival's car and how hard it is driven.
 *
 * MATCHED CLASS. The rival's model is the catalogue car (`CAR_MODELS`) nearest the car
 * the player came in, by
 *
 *   distance = |ln(powerToWeight / player's)| + MASS_WEIGHT · |ln(mass / player's)|
 *
 * with the player's power the engine actually in his bonnet's engine cell (a swap counts;
 * an empty cell falls back to the model's own) over his model's kerb mass. Power to
 * weight decides who is quicker on a straight, so it is the term that matters; mass only
 * breaks ties between cars of one class (a light Oka and a heavy UAZ of the same ratio
 * drive nothing alike, and a trailer race weighs the lighter car down more). The rival is
 * one of the `CANDIDATES` nearest, drawn from the seed, the track's post and the race
 * round, so the same round at the same post in the same car is always the same rival,
 * and the next round is (usually) another one. Nothing about the rival follows the race:
 * there is NO rubber-banding.
 *
 * THE LEVEL is the driver: one of the autopilot's own three characters (vehicle/
 * autopilot.ts), so each is a real way of driving rather than a speed knob on one, and
 * none of them knows where the player is.
 *
 *  - STEADY: the `sleeper` — 80 km/h at most, under half of the tyres in a bend, its own
 *    lane. A boy who keeps going beats it.
 *  - FAST: the `hurried` driver — 105 km/h, two thirds of the tyres, its own lane, no
 *    racing line. A boy who drives well beats it.
 *  - WILD: the `frantic` racer — the racing line, the tyres used to within a fifth, the
 *    late braking, the car's power its only limit on a straight.
 *
 * Measured alone in the starting VAZ-2101 on three tracks of seed 1337 (tools/
 * race-bench.ts), the flying laps average 149.5 s, 121.6 s and 114.5 s: FAST is a fifth
 * quicker than STEADY, WILD another 6%. A `frantic` racer held to 0.7 of its pace (140
 * km/h) lapped within 0.2 s of the full one — on 1.8-2.5 km laps the corners, not the
 * straights, set the time — so a pace cap is no level; the characters are.
 */

export type RivalLevel = 'steady' | 'fast' | 'wild';

/** Who drives the rival at each level; see THE LEVEL. */
export const RIVAL_MODES: Readonly<Record<RivalLevel, AutopilotMode>> = {
  steady: 'sleeper',
  fast: 'hurried',
  wild: 'frantic',
};

/** Share of rounds at each level, in order: mostly steady, now and then wild. */
const LEVEL_SHARES: readonly [RivalLevel, number][] = [
  ['steady', 0.45],
  ['fast', 0.35],
  ['wild', 0.2],
];

/** Weight of the mass term against the power-to-weight term; see MATCHED CLASS. */
const MASS_WEIGHT = 0.35;
/** The rival is drawn from this many catalogue cars nearest the player's. */
const CANDIDATES = 3;
/** Share of rounds that are trailer races. */
export const TRAILER_RACE_SHARE = 1 / 3;

/** Domain tags of the draws: 'RVM1' model, 'RVL1' level, 'RVT1' trailer. */
const MODEL_DOMAIN = 0x52564d31;
const LEVEL_DOMAIN = 0x52564c31;
const TRAILER_DOMAIN = 0x52565431;

/** What one round at one track is: who waits, how he drives, and whether trailers are on. */
export interface RivalPlan {
  readonly modelId: string;
  readonly level: RivalLevel;
  readonly trailer: boolean;
}

/** A car's figures for the match: peak power, kW, and kerb mass, kg. */
export interface CarClass {
  readonly powerKw: number;
  readonly massKg: number;
}

/** The class of a car as it stands: its fitted engine's power (the model's when the cell is empty) and its model's mass. */
export function carClassOf(car: Pick<CarState, 'modelId' | 'bonnet'>): CarClass {
  const def = carModel(car.modelId);
  const fitted = bonnetPart(car.bonnet, 0);
  const engine = (fitted ? variant(fitted.variantId).engine : undefined) ?? modelEngine(def);
  return { powerKw: engine.peakPowerKw, massKg: def.mass };
}

/** A catalogue model's class, as delivered. */
export function modelClassOf(def: CarModelDef): CarClass {
  return { powerKw: modelEngine(def).peakPowerKw, massKg: def.mass };
}

/** The match distance between two classes; see MATCHED CLASS. */
export function classDistance(a: CarClass, b: CarClass): number {
  const ratio = a.powerKw / a.massKg / (b.powerKw / b.massKg);
  return Math.abs(Math.log(ratio)) + MASS_WEIGHT * Math.abs(Math.log(a.massKg / b.massKg));
}

/** The catalogue cars nearest `player`, nearest first. */
export function nearestModels(player: CarClass, count = CANDIDATES): CarModelDef[] {
  return [...CAR_MODELS]
    .map((def) => ({ def, d: classDistance(modelClassOf(def), player) }))
    .sort((a, b) => a.d - b.d || (a.def.id < b.def.id ? -1 : 1))
    .slice(0, count)
    .map((entry) => entry.def);
}

/**
 * Round `round` at the track of post `postIndex`, against a player in a car of class
 * `player`: the rival's model, its level, and whether it is a trailer race.
 */
export function rivalPlan(seed: number, postIndex: number, round: number, player: CarClass): RivalPlan {
  const candidates = nearestModels(player);
  const modelAt = Math.floor(hash01(seed, MODEL_DOMAIN, postIndex, round) * candidates.length);
  const u = hash01(seed, LEVEL_DOMAIN, postIndex, round);
  let level: RivalLevel = 'steady';
  let acc = 0;
  for (const [name, share] of LEVEL_SHARES) {
    acc += share;
    if (u < acc) {
      level = name;
      break;
    }
  }
  const trailer = hash01(seed, TRAILER_DOMAIN, postIndex, round) < TRAILER_RACE_SHARE;
  return { modelId: candidates[Math.min(modelAt, candidates.length - 1)]!.id, level, trailer };
}
