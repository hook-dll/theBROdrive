import { hash01 } from '../core/rng';
import type { CarState } from '../game/state';
import { variant } from '../parts/registry';
import { bonnetPart } from '../vehicle/bonnet';
import { CAR_MODELS, carModel, modelEngine, type CarModelDef } from '../vehicle/carmodels';

/**
 * WHO WAITS AT THE GRID: the field of rivals, their cars and how hard each is driven.
 *
 * A FIELD OF `FIELD_SIZE` RIVALS races the player round every track, four cars on the
 * grid. Each round at a track (`raceRounds`) is one field, a pure function of the seed,
 * the post, the round and the car the player came in, so the same round in the same car
 * is always the same field and the next round is (usually) another one.
 *
 * MATCHED CLASS. The rivals' models are drawn from the `CANDIDATES` catalogue cars
 * (`CAR_MODELS`) nearest the car the player came in, by
 *
 *   distance = |ln(powerToWeight / player's)| + MASS_WEIGHT · |ln(mass / player's)|
 *
 * with the player's power the engine actually in his bonnet's engine cell (a swap counts;
 * an empty cell falls back to the model's own) over his model's kerb mass. Power to
 * weight decides who is quicker on a straight, so it is the term that matters; mass only
 * breaks ties. The candidates are dealt out in a seeded order, so a field is as varied
 * as the catalogue round the player's class allows: three different cars when there are
 * three near enough, the nearest ones again only past that.
 *
 * EVERY RIVAL IS A RACER: the autopilot's `frantic` driver (vehicle/autopilot.ts), the
 * racing line, late braking and the car's power its only limit on a straight. What sets
 * one rival apart from another is only its CAR: every rival drives at the top SKILL
 * (`RIVAL_SKILL`, 1). A skill, 0..1, is two of the autopilot's racing knobs: `gripShare`
 * (the share of the frantic driver's own tyre budget it dares to corner and brake on:
 * 0.80 at skill 0, the full frantic driver at 1) and `pace` (the share of its cruise it
 * holds on a straight). Fields of mixed skills (0..1, mostly the slow end) were too easy
 * to beat (owner, second round), so the whole field is as good as the old pole sitter;
 * the lower skills stay in `driverFor` for the benches' skill ladder. The sleeper and
 * hurried characters are not racers (90 and 105 km/h, half the tyres): a field of them
 * was beaten by anybody who kept going, which is no race.
 *
 * The grid is in the deal's order: the first car dealt is on pole.
 *
 * Nothing about a rival follows the race: there is NO rubber-banding.
 */

/** Rivals in a field: with the player, four cars on the grid. */
export const FIELD_SIZE = 3;

/** The skill every rival drives at; see EVERY RIVAL IS A RACER. */
export const RIVAL_SKILL = 1;
/** A skill's two racing knobs (see EVERY RIVAL IS A RACER): grip share and pace, at skill 0 and 1. */
const GRIP_SHARE_AT = [0.8, 1] as const;
const PACE_AT = [0.62, 1] as const;

/** Weight of the mass term against the power-to-weight term; see MATCHED CLASS. */
const MASS_WEIGHT = 0.35;
/** The field is dealt from this many catalogue cars nearest the player's. */
const CANDIDATES = 6;
/** Share of rounds that are trailer races. */
export const TRAILER_RACE_SHARE = 1 / 3;

/** Domain tags of the draws: 'RVM1' models, 'RVT1' trailer. */
const MODEL_DOMAIN = 0x52564d31;
const TRAILER_DOMAIN = 0x52565431;

/** One rival of a field: its car and its driving. */
export interface RivalDriver {
  readonly modelId: string;
  /** 0..1; see EVERY RIVAL IS A RACER. */
  readonly skill: number;
  /** The autopilot's racing knobs for that skill (`Autopilot.setGripShare`, `setPace`). */
  readonly gripShare: number;
  readonly pace: number;
}

/** What one round at one track is: the field, and whether trailers are on. */
export interface FieldPlan {
  readonly trailer: boolean;
  /** `FIELD_SIZE` rivals in grid order, pole first. */
  readonly rivals: readonly RivalDriver[];
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

/** A skill's racing knobs. */
export function driverFor(modelId: string, skill: number): RivalDriver {
  return {
    modelId,
    skill,
    gripShare: GRIP_SHARE_AT[0] + (GRIP_SHARE_AT[1] - GRIP_SHARE_AT[0]) * skill,
    pace: PACE_AT[0] + (PACE_AT[1] - PACE_AT[0]) * skill,
  };
}

/**
 * Round `round` at the track of post `postIndex`, against a player in a car of class
 * `player`: the field, and whether it is a trailer race.
 */
export function fieldPlan(seed: number, postIndex: number, round: number, player: CarClass): FieldPlan {
  // The candidates in a seeded order (each one's own draw), dealt round the field.
  const candidates = nearestModels(player)
    .map((def, i) => ({ id: def.id, key: hash01(seed, MODEL_DOMAIN, postIndex, round, i) }))
    .sort((a, b) => a.key - b.key);
  const rivals: RivalDriver[] = [];
  for (let k = 0; k < FIELD_SIZE; k++) rivals.push(driverFor(candidates[k % candidates.length]!.id, RIVAL_SKILL));
  const trailer = hash01(seed, TRAILER_DOMAIN, postIndex, round) < TRAILER_RACE_SHARE;
  return { trailer, rivals };
}
