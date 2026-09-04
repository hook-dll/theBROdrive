/**
 * Engine cooling harness.
 *
 * Drives `EngineCoolingSystem` directly — no Rapier, no Three, no world — because
 * every claim the cooling system makes is a claim about one arithmetic model:
 * which radiator holds which engine, what a dry core does, what a standing car
 * cannot cool, and above all that none of it depends on the frame rate.
 *
 * Run: `bun tools/cooling.ts`
 */

import {
  EngineCoolingSystem,
  ambientAirC,
  preferredRadiatorClass,
  radiatorFit,
  stepTemperature,
  COLD_SOAK_C,
} from '../src/vehicle/cooling';
import {
  engineHeat,
  variant,
  type EngineSpec,
  type RadiatorSpec,
} from '../src/parts/registry';
import { DAY_LENGTH } from '../src/game/state';

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(58)} ${detail}`);
}

const engineOf = (id: string): EngineSpec => variant(id).engine!;
const radiatorOf = (id: string): RadiatorSpec => variant(id).radiator!;

const SMALL_ENGINE = engineOf('engine_i4_1600');
const BIG_ENGINE = engineOf('engine_v8_5000');
const TRUCK_DIESEL = engineOf('engine_d6_6600');
const SMALL_RAD = radiatorOf('radiator_small');
const STANDARD_RAD = radiatorOf('radiator_standard');
const LARGE_RAD = radiatorOf('radiator_copper');

const CRUISE_AMBIENT = 38;
const CRUISE_SPEED = 25;

/**
 * Runs a scenario and returns the final temperature. `dt` is a parameter because
 * frame-rate independence is one of the things under test.
 */
function run(
  engine: EngineSpec | null,
  radiator: RadiatorSpec | null,
  options: {
    seconds: number;
    dt?: number;
    load?: number;
    revs?: number;
    speedMps?: number;
    ambientC?: number;
    running?: boolean;
    waterFill?: number;
    startC?: number;
  },
): { temperature: number; water: number; system: EngineCoolingSystem } {
  const system = new EngineCoolingSystem(options.startC ?? COLD_SOAK_C);
  system.configure(engine, radiator);
  system.setWater((radiator?.capacity ?? 0) * (options.waterFill ?? 1));
  system.setTemperature(options.startC ?? COLD_SOAK_C);
  const dt = options.dt ?? 1 / 60;
  const steps = Math.round(options.seconds / dt);
  for (let i = 0; i < steps; i++) {
    system.update(dt, {
      load: options.load ?? 0,
      revs: options.revs ?? 0,
      speedMps: options.speedMps ?? 0,
      ambientC: options.ambientC ?? CRUISE_AMBIENT,
      engineRunning: options.running ?? true,
    });
  }
  return { temperature: system.temperature, water: system.waterLitres, system };
}

console.log('cooling: fitment');

check(
  'each catalogue engine maps onto a radiator class',
  preferredRadiatorClass(SMALL_ENGINE) === 'small' &&
    preferredRadiatorClass(engineOf('engine_i6_2800')) === 'standard' &&
    preferredRadiatorClass(BIG_ENGINE) === 'large' &&
    preferredRadiatorClass(TRUCK_DIESEL) === 'large',
  `1.6=${preferredRadiatorClass(SMALL_ENGINE)} 2.8=${preferredRadiatorClass(engineOf('engine_i6_2800'))} v8=${preferredRadiatorClass(BIG_ENGINE)} d6=${preferredRadiatorClass(TRUCK_DIESEL)}`,
);
check(
  'an undersized radiator fits, derated, with a stated reason',
  radiatorFit(BIG_ENGINE, SMALL_RAD).multiplier < 1 &&
    radiatorFit(BIG_ENGINE, SMALL_RAD).warning !== null,
  `${radiatorFit(BIG_ENGINE, SMALL_RAD).warning}`,
);
check(
  'an oversized radiator is allowed and capped, not a bonus',
  radiatorFit(SMALL_ENGINE, LARGE_RAD).multiplier < 1 &&
    radiatorFit(SMALL_ENGINE, LARGE_RAD).warning === null,
  `multiplier=${radiatorFit(SMALL_ENGINE, LARGE_RAD).multiplier.toFixed(2)}`,
);
check(
  'no radiator at all rejects nothing and says so',
  radiatorFit(SMALL_ENGINE, null).multiplier === 0 &&
    radiatorFit(SMALL_ENGINE, null).warning === 'no radiator fitted',
  `${radiatorFit(SMALL_ENGINE, null).warning}`,
);

console.log('cooling: temperature behaviour');

const smallHeat = engineHeat(SMALL_ENGINE);
const warmUp = run(SMALL_ENGINE, SMALL_RAD, {
  seconds: 240,
  load: 0.25,
  revs: 0.35,
  speedMps: CRUISE_SPEED,
});
check(
  'small engine + matched radiator + full water stabilises in band',
  warmUp.temperature > smallHeat.optimalMinC && warmUp.temperature < smallHeat.warningC,
  `${warmUp.temperature.toFixed(1)} C (band ${smallHeat.optimalMinC}-${smallHeat.warningC})`,
);

const warmUpTime = (() => {
  const system = new EngineCoolingSystem(COLD_SOAK_C);
  system.configure(SMALL_ENGINE, SMALL_RAD);
  system.setWater(SMALL_RAD.capacity);
  system.setTemperature(COLD_SOAK_C);
  for (let t = 0; t < 600; t += 0.5) {
    system.update(0.5, {
      load: 0.25,
      revs: 0.35,
      speedMps: CRUISE_SPEED,
      ambientC: CRUISE_AMBIENT,
      engineRunning: true,
    });
    if (system.temperature >= smallHeat.optimalMinC) return t;
  }
  return Number.POSITIVE_INFINITY;
})();
check(
  'warm-up is gradual, not instant',
  warmUpTime > 20 && warmUpTime < 300,
  `${warmUpTime.toFixed(0)} s to reach ${smallHeat.optimalMinC} C`,
);

const bigOnSmall = run(BIG_ENGINE, SMALL_RAD, {
  seconds: 180,
  load: 1,
  revs: 0.8,
  speedMps: CRUISE_SPEED,
});
const bigOnLarge = run(BIG_ENGINE, LARGE_RAD, {
  seconds: 180,
  load: 1,
  revs: 0.8,
  speedMps: CRUISE_SPEED,
});
check(
  'big engine on a small radiator overheats under load',
  bigOnSmall.temperature > engineHeat(BIG_ENGINE).warningC,
  `${bigOnSmall.temperature.toFixed(1)} C vs warning ${engineHeat(BIG_ENGINE).warningC}`,
);
check(
  'the same load on the right radiator copes',
  bigOnLarge.temperature < engineHeat(BIG_ENGINE).warningC &&
    bigOnLarge.temperature < bigOnSmall.temperature - 20,
  `${bigOnLarge.temperature.toFixed(1)} C vs ${bigOnSmall.temperature.toFixed(1)} C`,
);

const dry = run(SMALL_ENGINE, SMALL_RAD, {
  seconds: 60,
  load: 0.5,
  revs: 0.5,
  speedMps: CRUISE_SPEED,
  waterFill: 0,
  startC: smallHeat.operatingC,
});
check(
  'a dry radiator lets the temperature run away',
  dry.temperature > smallHeat.criticalC,
  `${dry.temperature.toFixed(1)} C after 60 s dry`,
);

const half = run(SMALL_ENGINE, STANDARD_RAD, {
  seconds: 180,
  load: 0.6,
  revs: 0.5,
  speedMps: CRUISE_SPEED,
  waterFill: 0.3,
});
const full = run(SMALL_ENGINE, STANDARD_RAD, {
  seconds: 180,
  load: 0.6,
  revs: 0.5,
  speedMps: CRUISE_SPEED,
  waterFill: 1,
});
check(
  'a part-filled core cools worse than a full one',
  half.temperature > full.temperature + 5,
  `30% fill ${half.temperature.toFixed(1)} C vs full ${full.temperature.toFixed(1)} C`,
);

const standing = run(SMALL_ENGINE, SMALL_RAD, {
  seconds: 180,
  load: 0.55,
  revs: 0.45,
  speedMps: 0,
});
const moving = run(SMALL_ENGINE, SMALL_RAD, {
  seconds: 180,
  load: 0.55,
  revs: 0.45,
  speedMps: CRUISE_SPEED,
});
check(
  'standing still cools worse than moving',
  standing.temperature > moving.temperature + 10,
  `standing ${standing.temperature.toFixed(1)} C vs moving ${moving.temperature.toFixed(1)} C`,
);
check(
  'the first metre per second does not dump the temperature',
  (() => {
    const crawl = run(SMALL_ENGINE, SMALL_RAD, {
      seconds: 180,
      load: 0.55,
      revs: 0.45,
      speedMps: 0.4,
    });
    return Math.abs(crawl.temperature - standing.temperature) < 3;
  })(),
  'crawl and standstill within 3 C',
);

const cooling = run(SMALL_ENGINE, SMALL_RAD, {
  seconds: 600,
  running: false,
  startC: smallHeat.operatingC,
});
check(
  'a stopped engine cools toward air temperature',
  cooling.temperature < smallHeat.optimalMinC && cooling.temperature > CRUISE_AMBIENT - 1,
  `${cooling.temperature.toFixed(1)} C after 10 min stopped (air ${CRUISE_AMBIENT})`,
);

// Air temperature on a MARGINAL setup: the V8 on a standard core has no capability
// to spare, so the afternoon is what decides whether it holds temperature. A car
// that is comfortably cooled must NOT behave this way — see the next check.
const hotDay = run(BIG_ENGINE, STANDARD_RAD, {
  seconds: 240,
  load: 0.8,
  revs: 0.7,
  speedMps: CRUISE_SPEED,
  ambientC: 46,
});
const coolNight = run(BIG_ENGINE, STANDARD_RAD, {
  seconds: 240,
  load: 0.8,
  revs: 0.7,
  speedMps: CRUISE_SPEED,
  ambientC: 14,
});
check(
  'desert afternoon cooks a marginal radiator that copes at night',
  hotDay.temperature > coolNight.temperature + 25 &&
    hotDay.temperature > engineHeat(BIG_ENGINE).warningC &&
    coolNight.temperature < engineHeat(BIG_ENGINE).warningC,
  `46 C air -> ${hotDay.temperature.toFixed(1)} C, 14 C air -> ${coolNight.temperature.toFixed(1)} C`,
);
check(
  'a healthy engine at cruise rejects the ambient swing through its thermostat',
  (() => {
    const hot = run(SMALL_ENGINE, SMALL_RAD, {
      seconds: 300,
      load: 0.3,
      revs: 0.4,
      speedMps: CRUISE_SPEED,
      ambientC: 46,
    });
    const cold = run(SMALL_ENGINE, SMALL_RAD, {
      seconds: 300,
      load: 0.3,
      revs: 0.4,
      speedMps: CRUISE_SPEED,
      ambientC: 5,
    });
    return (
      Math.abs(hot.temperature - cold.temperature) < 12 &&
      cold.temperature > engineHeat(SMALL_ENGINE).optimalMinC
    );
  })(),
  'thermostat holds the working band across a 41 K air swing',
);
check(
  'the clock produces a hot afternoon and a cool dawn',
  ambientAirC(DAY_LENGTH * 0.625, DAY_LENGTH) > 44 &&
    ambientAirC(DAY_LENGTH * 0.125, DAY_LENGTH) < 18,
  `15:00 ${ambientAirC(DAY_LENGTH * 0.625, DAY_LENGTH).toFixed(1)} C, 03:00 ${ambientAirC(DAY_LENGTH * 0.125, DAY_LENGTH).toFixed(1)} C`,
);

console.log('cooling: robustness');

const fast = run(BIG_ENGINE, SMALL_RAD, {
  seconds: 120,
  dt: 1 / 240,
  load: 1,
  revs: 0.8,
  speedMps: CRUISE_SPEED,
});
const slow = run(BIG_ENGINE, SMALL_RAD, {
  seconds: 120,
  dt: 0.2,
  load: 1,
  revs: 0.8,
  speedMps: CRUISE_SPEED,
});
const stutter = run(BIG_ENGINE, SMALL_RAD, {
  seconds: 120,
  dt: 2,
  load: 1,
  revs: 0.8,
  speedMps: CRUISE_SPEED,
});
check(
  '240 Hz, 5 Hz and 0.5 Hz agree within 2 C',
  Math.abs(fast.temperature - slow.temperature) < 2 &&
    Math.abs(fast.temperature - stutter.temperature) < 2,
  `${fast.temperature.toFixed(1)} / ${slow.temperature.toFixed(1)} / ${stutter.temperature.toFixed(1)} C`,
);
check(
  'a one-hour hitch cannot make the integrator diverge or oscillate',
  (() => {
    const t = stepTemperature(90, 40, 200, 1.2, 30, 3600);
    return Number.isFinite(t) && t > 40 && t < 400;
  })(),
  `${stepTemperature(90, 40, 200, 1.2, 30, 3600).toFixed(1)} C`,
);
check(
  'garbage input cannot poison the state',
  (() => {
    const system = new EngineCoolingSystem();
    system.configure(SMALL_ENGINE, SMALL_RAD);
    system.setWater(Number.NaN);
    system.setTemperature(Number.NaN);
    system.update(Number.NaN, {
      load: Number.NaN,
      revs: Number.POSITIVE_INFINITY,
      speedMps: Number.NaN,
      ambientC: Number.NaN,
      engineRunning: true,
    });
    system.update(1, {
      load: 2,
      revs: -5,
      speedMps: Number.NEGATIVE_INFINITY,
      ambientC: 40,
      engineRunning: true,
    });
    return (
      Number.isFinite(system.temperature) && Number.isFinite(system.waterLitres) && system.waterLitres >= 0
    );
  })(),
  'temperature and water stay finite',
);
check(
  'no engine and no radiator is a valid state, not a crash',
  (() => {
    const system = new EngineCoolingSystem(90);
    system.configure(null, null);
    system.update(1, {
      load: 1,
      revs: 1,
      speedMps: 0,
      ambientC: 40,
      engineRunning: true,
    });
    return system.readout() === null && system.getState().waterCapacity === 0;
  })(),
  'readout null, capacity 0',
);
check(
  'water cannot exceed the fitted core, and a smaller core spills the rest',
  (() => {
    const system = new EngineCoolingSystem();
    system.configure(SMALL_ENGINE, LARGE_RAD);
    system.addWater(99);
    const filled = system.waterLitres;
    system.installRadiator(SMALL_RAD);
    system.setWater(filled);
    return filled === LARGE_RAD.capacity && system.waterLitres === SMALL_RAD.capacity;
  })(),
  `large ${LARGE_RAD.capacity} L -> small ${SMALL_RAD.capacity} L`,
);

console.log('cooling: consequences');

const cooked = (() => {
  const system = new EngineCoolingSystem(engineHeat(BIG_ENGINE).operatingC);
  system.configure(BIG_ENGINE, SMALL_RAD);
  system.setWater(0);
  system.setTemperature(engineHeat(BIG_ENGINE).operatingC);
  let sawHot = false;
  let sawCritical = false;
  let seized = false;
  let powerAtCritical = 1;
  for (let t = 0; t < 600; t += 0.25) {
    system.update(0.25, {
      load: 1,
      revs: 0.9,
      speedMps: CRUISE_SPEED,
      ambientC: CRUISE_AMBIENT,
      engineRunning: true,
    });
    const state = system.getState();
    if (state.zone === 'hot') sawHot = true;
    if (state.critical) {
      sawCritical = true;
      powerAtCritical = state.performance;
    }
    if (system.takeSeizure()) {
      seized = true;
      break;
    }
  }
  return { sawHot, sawCritical, seized, powerAtCritical };
})();
check(
  'the zones arrive in order: hot, then critical, then seizure',
  cooked.sawHot && cooked.sawCritical && cooked.seized,
  `hot=${cooked.sawHot} critical=${cooked.sawCritical} seized=${cooked.seized}`,
);
check(
  'power is already cut before the engine seizes',
  cooked.powerAtCritical < 0.5,
  `performance ${cooked.powerAtCritical.toFixed(2)} at critical`,
);
check(
  'lifting off in the hot zone does not seize the engine',
  (() => {
    const system = new EngineCoolingSystem(engineHeat(SMALL_ENGINE).warningC + 2);
    system.configure(SMALL_ENGINE, SMALL_RAD);
    system.setWater(SMALL_RAD.capacity);
    system.setTemperature(engineHeat(SMALL_ENGINE).warningC + 2);
    for (let t = 0; t < 120; t += 0.25) {
      system.update(0.25, {
        load: 0,
        revs: 0.15,
        speedMps: CRUISE_SPEED,
        ambientC: CRUISE_AMBIENT,
        engineRunning: true,
      });
      if (system.takeSeizure()) return false;
    }
    return system.getState().zone === 'normal' || system.getState().zone === 'cold';
  })(),
  'recovers to the working band',
);
check(
  'a cold engine is down on power and a warm one is not',
  (() => {
    const cold = new EngineCoolingSystem(20);
    cold.configure(SMALL_ENGINE, SMALL_RAD);
    cold.setTemperature(20);
    const warm = new EngineCoolingSystem(smallHeat.operatingC);
    warm.configure(SMALL_ENGINE, SMALL_RAD);
    warm.setTemperature(smallHeat.operatingC);
    return cold.getState().performance < 0.95 && warm.getState().performance === 1;
  })(),
  'cold penalty present, warm engine unpenalised',
);

const boiled = run(BIG_ENGINE, SMALL_RAD, {
  seconds: 600,
  load: 1,
  revs: 0.9,
  speedMps: CRUISE_SPEED,
});
const sipped = run(SMALL_ENGINE, SMALL_RAD, {
  seconds: 600,
  load: 0.25,
  revs: 0.35,
  speedMps: CRUISE_SPEED,
});
check(
  'an engine run hot loses water much faster than a healthy one',
  SMALL_RAD.capacity - boiled.water > (SMALL_RAD.capacity - sipped.water) * 4,
  `boiling lost ${(SMALL_RAD.capacity - boiled.water).toFixed(2)} L, healthy lost ${(SMALL_RAD.capacity - sipped.water).toFixed(2)} L in 10 min`,
);
check(
  'a parked car does not boil its radiator away',
  run(SMALL_ENGINE, SMALL_RAD, { seconds: 3600, running: false, startC: 130 }).water ===
    SMALL_RAD.capacity,
  'water unchanged over an hour parked',
);
check(
  'two systems on the same engine spec do not share state',
  (() => {
    const a = new EngineCoolingSystem(30);
    const b = new EngineCoolingSystem(30);
    a.configure(SMALL_ENGINE, SMALL_RAD);
    b.configure(SMALL_ENGINE, SMALL_RAD);
    a.setWater(SMALL_RAD.capacity);
    b.setWater(SMALL_RAD.capacity);
    for (let i = 0; i < 600; i++) {
      a.update(0.25, { load: 1, revs: 0.9, speedMps: 0, ambientC: 40, engineRunning: true });
      b.update(0.25, { load: 0, revs: 0, speedMps: 0, ambientC: 40, engineRunning: false });
    }
    return a.temperature - b.temperature > 40;
  })(),
  'independent temperatures',
);

console.log(
  `\nequilibria at 38 C air, 90 km/h: ` +
    `1.6+small ${warmUp.temperature.toFixed(0)} C, ` +
    `V8+large ${bigOnLarge.temperature.toFixed(0)} C, ` +
    `V8+small ${bigOnSmall.temperature.toFixed(0)} C`,
);
console.log(failures === 0 ? 'ALL OK' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
