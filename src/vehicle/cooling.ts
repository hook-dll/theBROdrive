/**
 * Engine cooling: water, radiators and a real coolant temperature.
 *
 * This is a LUMPED THERMAL MODEL, not a fluid simulation. One temperature stands
 * for block, head and water together, heat goes in from combustion and leaves
 * through the fitted radiator, and everything the player can change — which
 * radiator is bolted in, how much water is in it, how hard they are driving, how
 * fast the air is moving through the core, what time of day it is — is a term in
 * that one balance:
 *
 *   dT/dt = ( heatIn - heatOut ) / thermalMass
 *   heatIn  = idle + load * throttle + rpm * revs                     [kW]
 *   heatOut = ( radiator * airflow * waterEffect + shell ) * (T - air) [kW]
 *
 * Consequences that fall out of the shape rather than being special-cased:
 *  - Light load warms up to a stable temperature; heavy load stabilises higher.
 *  - An adequate radiator finds an equilibrium; an undersized one cannot, so the
 *    temperature keeps climbing while the load lasts. That is the fitment mechanic.
 *  - Dry means the radiator contributes NOTHING and only the bare shell loss
 *    remains, so temperature runs away in tens of seconds instead of instantly
 *    destroying the engine.
 *  - A stopped engine has no heat input, so it decays to air temperature — slowly,
 *    because the thermal mass is the same iron either way.
 *
 * INTEGRATION IS SEMI-IMPLICIT (see `stepTemperature`): the cooling term is
 * evaluated at the END of the step, which is unconditionally stable for any dt.
 * A forward-Euler version of the same balance oscillates and then diverges once
 * `dt * k / mass` exceeds 2, which a hitching frame or a slow tick reaches easily;
 * this cannot, and that is why a 5 Hz run and a 60 Hz run agree.
 *
 * NETPLAY/SAVE: the class holds no renderer or physics reference. Its whole
 * persistent state is one number, mirrored into `CarState.engineTempC`.
 */

import type { EngineHeatSpec, EngineSpec, RadiatorClass, RadiatorSpec } from '../parts/registry';
import { engineHeat } from '../parts/registry';

/**
 * Temperature bands. The names are what the dashboard paints and what the rest of
 * the game asks about; the numbers behind them are per engine (`EngineHeatSpec`).
 */
export type CoolingZone = 'cold' | 'normal' | 'warm' | 'hot' | 'critical';

/** Everything the dashboard needs about engine temperature; no physics. */
export interface EngineTempReadout {
  /** Coolant temperature, degrees Celsius. */
  readonly celsius: number;
  readonly zone: CoolingZone;
  /** Position on the gauge, 0..1, already clamped. */
  readonly fraction: number;
  /** Warning-lamp text for this zone, or null when nothing is wrong. */
  readonly warning: string | null;
}

/** What the fixed step knows about the car this tick. */
export interface CoolingContext {
  /** Applied throttle, 0..1. The dominant heat term. */
  readonly load: number;
  /** Crank speed as a fraction of the redline, 0..1. */
  readonly revs: number;
  /** Road speed, m/s. Only its magnitude matters: reversing cools too. */
  readonly speedMps: number;
  /** Air temperature at the grille, degrees Celsius. */
  readonly ambientC: number;
  /** False while the engine is not turning: no combustion heat. */
  readonly engineRunning: boolean;
}

export interface RadiatorFit {
  /** Multiplies the radiator's rated capability once fitted. */
  readonly multiplier: number;
  /**
   * Why this radiator is a compromise, for the bonnet prompt. Null when the fit is
   * right. A wrong fit is never REFUSED — an undersized radiator physically bolts
   * on and then cooks the engine, which is the lesson.
   */
  readonly warning: string | null;
}

export interface CoolingState {
  readonly temperatureC: number;
  readonly zone: CoolingZone;
  /** Water in the fitted radiator, litres, and what it could hold. */
  readonly waterLitres: number;
  readonly waterCapacity: number;
  /** 0..1 of capacity; 0 when no radiator is fitted at all. */
  readonly waterFraction: number;
  readonly radiatorClass: RadiatorClass | null;
  readonly fit: RadiatorFit;
  /** Torque scale this temperature imposes, 0..1. */
  readonly performance: number;
  /** Rev ceiling as a fraction of the redline, 0..1. */
  readonly revLimit: number;
  readonly overheating: boolean;
  readonly critical: boolean;
  /** The engine has been cooked past saving and must be marked destroyed. */
  readonly seized: boolean;
}

/**
 * Desert air, degrees Celsius, from the game clock alone.
 *
 * A full weather system is not in this game and this feature does not justify one.
 * What the model actually needs from the outside world is a number that is brutal
 * in the afternoon and kind before dawn, because that is what makes "wait for the
 * cool of the morning" a real decision on a marginal radiator. A single cosine
 * about the daily mean gives exactly that, lagged three hours past noon so the
 * peak lands mid-afternoon like real ground-heated air rather than at solar noon.
 *
 * 14 C at dawn to 46 C mid-afternoon is a Sahara summer's day, which is the place
 * this game is set.
 */
const AIR_MEAN_C = 30;
const AIR_SWING_C = 16;
const AIR_PEAK_HOUR = 15;

/**
 * The temperature to assume for an engine nobody has been simulating: a car in a
 * save file, a car that has just been spawned into the world. The daily mean rather
 * than the current air temperature, because the alternative is threading a clock
 * into every construction site to gain a couple of degrees that the first seconds
 * of simulation erase anyway.
 */
export const COLD_SOAK_C = AIR_MEAN_C;

export function ambientAirC(timeOfDay: number, dayLength: number): number {
  if (!Number.isFinite(timeOfDay) || !Number.isFinite(dayLength) || dayLength <= 0) {
    return AIR_MEAN_C;
  }
  const dayFraction = ((timeOfDay / dayLength) % 1 + 1) % 1;
  const peak = AIR_PEAK_HOUR / 24;
  // PLUS: the cosine is 1 at `AIR_PEAK_HOUR`, so that hour must be the hottest.
  // Subtracting made mid-afternoon the coldest hour of the day.
  return AIR_MEAN_C + AIR_SWING_C * Math.cos((dayFraction - peak) * Math.PI * 2);
}

/**
 * Road speed at which ram air through the core is as good as it gets, m/s.
 *
 * 22 m/s is 80 km/h. Above it a bigger number would be a lie: the core is already
 * flowing all the air it can pass, and a car doing 140 does not cool twice as well
 * as one doing 80.
 */
const FULL_AIRFLOW_MPS = 22;
/**
 * Airflow at a standstill, as a fraction of full flow. This is the fan and
 * convection: enough to idle in the shade forever, nowhere near enough to hold
 * temperature under load, which is why a laden climb at walking pace is the way to
 * cook an engine.
 */
const IDLE_AIRFLOW = 0.34;
/**
 * Heat the bare engine sheds to the air whatever the radiator does, kW/K. Small,
 * but it is what keeps a dry engine's temperature FINITE and what cools a parked
 * car down. Roughly a hot lump of iron the size of a block in still air.
 */
const SHELL_LOSS_KW_PER_K = 0.055;
/**
 * Water level at which cooling is as good as a full core, as a fraction of
 * capacity. Below it the core is partly air and its effect falls away linearly, so
 * a half-empty radiator is a real handicap rather than a binary failure.
 */
const FULL_WATER_FRACTION = 0.7;
/**
 * Thermostat opening window, kelvin: it starts to crack this far below the
 * engine's operating temperature and is fully open this many kelvin later.
 *
 * A 10 K start and an 18 K window put a lightly loaded engine a few degrees under
 * its rating and leave the valve fully open well before the warning lamp, so the
 * radiator's own capability is what decides everything from there up.
 */
const THERMOSTAT_START_BELOW_K = 10;
const THERMOSTAT_WINDOW_K = 18;
/**
 * Water boiled off per hour per kelvin above the warning temperature.
 *
 * There is no leak model here, and none is needed for water to be a consumable:
 * an engine that is allowed to run hot loses water, which makes it run hotter. That
 * loop is the punishment for ignoring the gauge. At 20 K over the lamp a full
 * nine-litre core is gone in about twelve minutes of driving.
 */
const WATER_BOIL_LPH_PER_K = 2.2;
/** Water lost per hour of running regardless of temperature: hoses and the cap. */
const WATER_SEEP_LPH = 0.55;
/**
 * Seconds above the engine's maximum temperature before it is destroyed.
 *
 * A grace period rather than an instant kill: the critical lamp, the power cut and
 * the stall all arrive first, so a player who lifts off keeps their engine. Only
 * holding it wide open through all three warnings seizes it.
 */
const SEIZE_SECONDS = 6;

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/**
 * Which radiator an engine wants, for prompts and for the compatibility warning.
 *
 * Derived from the engine's own cooling requirement against the class capabilities
 * in the catalogue, so adding a radiator class or retuning an engine cannot leave a
 * stale table behind.
 */
const CLASS_CAPABILITY: Readonly<Record<RadiatorClass, number>> = {
  small: 1.1,
  standard: 1.65,
  large: 2.45,
};

/**
 * How well a radiator suits an engine.
 *
 * Two penalties, both mild, because the raw kW/K difference between the classes is
 * already the main consequence:
 *  - An UNDERSIZED core also flows badly for the engine's water pump, so it loses
 *    a further tenth of its rating. This is what turns "slightly too small" into
 *    "will not hold temperature towing".
 *  - An OVERSIZED core is not a bonus. Its capability is capped at a fifth above
 *    what the engine asks for, so bolting the copper core to a 1.2 four buys the
 *    water capacity and the thermal margin but not a magic cold engine.
 */
export function radiatorFit(engine: EngineSpec, radiator: RadiatorSpec | null): RadiatorFit {
  if (radiator === null) return { multiplier: 0, warning: 'no radiator fitted' };
  const need = engineHeat(engine).coolingRequirementKwPerK;
  const have = radiator.coolingKwPerK;
  if (have < need * 0.95) {
    return {
      multiplier: 0.9,
      warning: `${radiator.klass} radiator is undersized for this engine`,
    };
  }
  if (have > need * 1.2) {
    return { multiplier: (need * 1.2) / have, warning: null };
  }
  return { multiplier: 1, warning: null };
}

/** The class an engine is happiest with: the smallest one that can hold it. */
export function preferredRadiatorClass(engine: EngineSpec): RadiatorClass {
  const need = engineHeat(engine).coolingRequirementKwPerK;
  if (CLASS_CAPABILITY.small >= need * 0.95) return 'small';
  if (CLASS_CAPABILITY.standard >= need * 0.95) return 'standard';
  return 'large';
}

export function coolingZone(heat: EngineHeatSpec, celsius: number): CoolingZone {
  if (celsius >= heat.criticalC) return 'critical';
  if (celsius >= heat.warningC) return 'hot';
  if (celsius > heat.optimalMaxC) return 'warm';
  if (celsius < heat.optimalMinC) return 'cold';
  return 'normal';
}

/**
 * Gauge position, 0..1.
 *
 * Anchored on the engine's OWN thresholds rather than a fixed 0-140 scale, so the
 * needle means the same thing on a petrol four and a truck diesel that runs 20 K
 * hotter: half scale is the middle of its working band, and the red starts at its
 * critical temperature. `optimalMinC - 40` puts a cold desert morning near the
 * bottom stop without ever pinning it there.
 */
export function tempGaugeFraction(heat: EngineHeatSpec, celsius: number): number {
  const low = heat.optimalMinC - 40;
  const span = heat.maxC - low;
  return span > 0 ? clamp((celsius - low) / span, 0, 1) : 0;
}

const ZONE_WARNING: Readonly<Record<CoolingZone, string | null>> = {
  cold: null,
  normal: null,
  warm: null,
  hot: 'ENGINE OVERHEATING',
  critical: 'ENGINE CRITICAL — STOP',
};

/**
 * One semi-implicit step of the thermal balance.
 *
 * Exported and pure because this is the part that must be provably frame-rate
 * independent: the harness drives it at 5 Hz and 240 Hz and compares.
 *
 * Solving `T' = T + dt*(Q - k*(T' - air))/m` for `T'` rather than evaluating the
 * loss at `T` is the whole trick. The result is a weighted average of the current
 * temperature and the equilibrium the current load implies, so it approaches that
 * equilibrium and can never cross it however large `dt` is.
 */
export function stepTemperature(
  celsius: number,
  ambientC: number,
  heatInKw: number,
  lossKwPerK: number,
  thermalMassKjPerK: number,
  dt: number,
): number {
  const mass = thermalMassKjPerK > 0 ? thermalMassKjPerK : 1;
  if (!(dt > 0)) return celsius;
  const a = (dt * lossKwPerK) / mass;
  const next = (celsius + a * ambientC + (dt * heatInKw) / mass) / (1 + a);
  // A NaN can only arrive from outside (a corrupt save, a divide upstream); the
  // engine bay is no place to propagate one, so it falls back to air temperature.
  return Number.isFinite(next) ? clamp(next, ambientC - 5, 400) : ambientC;
}

/**
 * The cooling system of ONE car: temperature, the fitted radiator and its water.
 *
 * The car owns the authoritative water level (`CarState.waterLitres`) and the
 * authoritative temperature (`CarState.engineTempC`); this object is the live
 * simulation over them, mirrored exactly like fuel is (see `Vehicle.fixedUpdate`).
 * Nothing here reaches for world state, which is what lets the harness drive it
 * without a physics world and what keeps two cars' temperatures independent.
 */
export class EngineCoolingSystem {
  private engine: EngineSpec | null = null;
  private heat: EngineHeatSpec | null = null;
  private radiator: RadiatorSpec | null = null;
  private fitCache: RadiatorFit = { multiplier: 0, warning: 'no radiator fitted' };
  private temperatureC: number;
  private water = 0;
  private overheatSeconds = 0;
  private seizedFlag = false;

  constructor(ambientC = AIR_MEAN_C) {
    this.temperatureC = ambientC;
  }

  /**
   * Rebinds the hardware. Called from `Vehicle.rebuild`, so a radiator swapped in
   * the bonnet takes effect on the next tick with no other bookkeeping.
   */
  configure(engine: EngineSpec | null, radiator: RadiatorSpec | null): void {
    this.engine = engine;
    this.heat = engine ? engineHeat(engine) : null;
    this.radiator = radiator;
    this.fitCache = engine ? radiatorFit(engine, radiator) : { multiplier: 0, warning: null };
  }

  installRadiator(radiator: RadiatorSpec | null): void {
    this.configure(this.engine, radiator);
  }

  /** Straight from authority, litres. Clamped to what the fitted core can hold. */
  setWater(litres: number): void {
    const capacity = this.radiator?.capacity ?? 0;
    this.water = clamp(Number.isFinite(litres) ? litres : 0, 0, capacity);
  }

  /** Pours in, returns the litres that actually fitted. */
  addWater(litres: number): number {
    const capacity = this.radiator?.capacity ?? 0;
    const accepted = clamp(litres, 0, Math.max(0, capacity - this.water));
    this.water += accepted;
    return accepted;
  }

  get waterLitres(): number {
    return this.water;
  }

  get temperature(): number {
    return this.temperatureC;
  }

  /** Straight from authority, degrees Celsius. */
  setTemperature(celsius: number): void {
    this.temperatureC = Number.isFinite(celsius) ? clamp(celsius, -60, 400) : AIR_MEAN_C;
  }

  /** Back to a cold, unseized engine. Used on a fresh car and by the harness. */
  reset(ambientC = AIR_MEAN_C): void {
    this.temperatureC = ambientC;
    this.overheatSeconds = 0;
    this.seizedFlag = false;
  }

  /** Consumes the seize event exactly once, so it cannot destroy an engine twice. */
  takeSeizure(): boolean {
    if (!this.seizedFlag) return false;
    this.seizedFlag = false;
    return true;
  }

  /**
   * Heat rejection available right now, kW/K: the fitted core derated by the
   * thermostat, the fit, airflow and water level, plus the shell loss that never
   * goes away.
   *
   * THE THERMOSTAT IS LOAD-BEARING, not detail. Without it the balance has only one
   * equilibrium per load, so a correctly cooled car cruising gently settles at 50 C
   * and never reaches its working temperature at all — measured, and it is exactly
   * the "engine never warms up" complaint. A real thermostat closes the radiator
   * circuit below its rating, which makes the ENGINE choose the temperature at light
   * load and the RADIATOR choose it at high load. That is both physical and the
   * behaviour the feature needs: warm up to operating temperature, hold it, and
   * climb above it only when the radiator has run out of capability.
   *
   * Airflow is LINEAR in speed from a standstill, deliberately. A curve that
   * started steep would make the first metre per second of a rolling start dump the
   * temperature, which reads as a bug from the driver's seat.
   */
  private lossKwPerK(speedMps: number): number {
    const capacity = this.radiator?.capacity ?? 0;
    const fill = capacity > 0 ? this.water / capacity : 0;
    // Dry is dry: no water, no circuit, and the core is an ornament.
    const waterEffect = fill <= 0 ? 0 : clamp(fill / FULL_WATER_FRACTION, 0, 1);
    const speed = Math.abs(Number.isFinite(speedMps) ? speedMps : 0);
    const airflow = IDLE_AIRFLOW + (1 - IDLE_AIRFLOW) * clamp(speed / FULL_AIRFLOW_MPS, 0, 1);
    const core = (this.radiator?.coolingKwPerK ?? 0) * this.fitCache.multiplier;
    return core * airflow * waterEffect * this.thermostat() + SHELL_LOSS_KW_PER_K;
  }

  /**
   * How far the thermostat has opened, 0..1, over a window around the engine's
   * operating temperature. Smooth rather than a switch: a hard-opening valve makes
   * the temperature hunt across its own rating every few seconds, which shows up on
   * the gauge as a twitching needle.
   */
  private thermostat(): number {
    const heat = this.heat;
    if (heat === null) return 1;
    const t = clamp(
      (this.temperatureC - (heat.operatingC - THERMOSTAT_START_BELOW_K)) / THERMOSTAT_WINDOW_K,
      0,
      1,
    );
    return t * t * (3 - 2 * t);
  }

  /**
   * Advances temperature and water by `dt` seconds.
   *
   * A missing engine still runs the loss half of the balance: a car parked with no
   * engine in it has an ambient engine bay, not a stale 90 C reading that reappears
   * when a fresh engine is dropped in.
   */
  update(dt: number, ctx: CoolingContext): void {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    const step = Math.min(dt, 5);
    const ambient = Number.isFinite(ctx.ambientC) ? ctx.ambientC : AIR_MEAN_C;
    const heat = this.heat;
    if (heat === null) {
      this.temperatureC = stepTemperature(
        this.temperatureC,
        ambient,
        0,
        SHELL_LOSS_KW_PER_K,
        30,
        step,
      );
      return;
    }

    const running = ctx.engineRunning;
    const load = clamp(Number.isFinite(ctx.load) ? ctx.load : 0, 0, 1);
    const revs = clamp(Number.isFinite(ctx.revs) ? ctx.revs : 0, 0, 1);
    const heatInKw = running
      ? heat.idleHeatKw + heat.loadHeatKw * load + heat.rpmHeatKw * revs
      : 0;

    this.temperatureC = stepTemperature(
      this.temperatureC,
      ambient,
      heatInKw,
      this.lossKwPerK(ctx.speedMps),
      heat.thermalMassKjPerK,
      step,
    );

    // Water only moves while the engine turns: a parked car does not boil its
    // radiator dry, however hot the afternoon is.
    if (running && this.radiator !== null) {
      const overshoot = Math.max(0, this.temperatureC - heat.warningC);
      const lossLph = WATER_SEEP_LPH + WATER_BOIL_LPH_PER_K * overshoot;
      this.water = Math.max(0, this.water - (lossLph / 3600) * step);
    }

    if (this.temperatureC >= heat.maxC) {
      this.overheatSeconds += step;
      if (this.overheatSeconds >= SEIZE_SECONDS) {
        this.seizedFlag = true;
        this.overheatSeconds = 0;
      }
    } else {
      // Decays rather than resets, so repeatedly bouncing off the maximum still
      // adds up to a seizure instead of being free.
      this.overheatSeconds = Math.max(0, this.overheatSeconds - step * 0.5);
    }
  }

  /**
   * Torque scale for this temperature.
   *
   * Cold costs at most a tenth, and that ceiling is deliberate. A cold engine really
   * is down on power, but every drive in this game starts cold, and the first
   * measured version took 28% off the crank for the first minute and a half — which
   * moved the whole catalogue's acceleration figures (tools/handling-bench.ts) and
   * made pulling away feel broken rather than feel cold. A tenth is noticeable in
   * the seat and invisible in the numbers that matter.
   *
   * Above the warning lamp power falls away linearly to the critical point, which is
   * the pressure that makes a player lift off before something breaks; past critical
   * the engine will not run at all, so what is left is only what limps it off the
   * road.
   */
  private performanceFor(heat: EngineHeatSpec): number {
    const t = this.temperatureC;
    if (t < heat.optimalMinC) {
      const cold = clamp((t - (heat.optimalMinC - 45)) / 45, 0, 1);
      return 0.9 + 0.1 * cold;
    }
    if (t <= heat.optimalMaxC) return 1;
    if (t <= heat.warningC) return 1 - 0.08 * ((t - heat.optimalMaxC) / (heat.warningC - heat.optimalMaxC));
    if (t < heat.criticalC) {
      return 0.92 - 0.47 * ((t - heat.warningC) / (heat.criticalC - heat.warningC));
    }
    return 0.35;
  }

  getState(): CoolingState {
    const heat = this.heat;
    const capacity = this.radiator?.capacity ?? 0;
    if (heat === null) {
      return {
        temperatureC: this.temperatureC,
        zone: 'cold',
        waterLitres: this.water,
        waterCapacity: capacity,
        waterFraction: capacity > 0 ? this.water / capacity : 0,
        radiatorClass: this.radiator?.klass ?? null,
        fit: this.fitCache,
        performance: 1,
        revLimit: 1,
        overheating: false,
        critical: false,
        seized: false,
      };
    }
    const zone = coolingZone(heat, this.temperatureC);
    return {
      temperatureC: this.temperatureC,
      zone,
      waterLitres: this.water,
      waterCapacity: capacity,
      waterFraction: capacity > 0 ? this.water / capacity : 0,
      radiatorClass: this.radiator?.klass ?? null,
      fit: this.fitCache,
      performance: this.performanceFor(heat),
      // A hot engine is held short of the redline: the last thousand rpm is where
      // the heat is made, and taking it away is a limp-home, not a punishment.
      revLimit: zone === 'hot' ? 0.82 : zone === 'critical' ? 0.7 : 1,
      overheating: zone === 'hot' || zone === 'critical',
      critical: zone === 'critical',
      seized: this.seizedFlag,
    };
  }

  /** What the dashboard paints. Null engine means an empty gauge, not a cold one. */
  readout(): EngineTempReadout | null {
    const heat = this.heat;
    if (heat === null) return null;
    const zone = coolingZone(heat, this.temperatureC);
    return {
      celsius: this.temperatureC,
      zone,
      fraction: tempGaugeFraction(heat, this.temperatureC),
      warning: ZONE_WARNING[zone],
    };
  }
}
