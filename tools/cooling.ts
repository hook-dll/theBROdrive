/**
 * Engine cooling harness.
 *
 * Drives `EngineCoolingSystem` directly — no Rapier, no Three, no world — because
 * every claim the cooling system makes is a claim about one arithmetic model: that
 * the one core holds every engine, what a dry core does, what a standing car
 * cannot cool, how the core fades as its water leaves, and above all that none of
 * it depends on the frame rate.
 *
 * Run: `bun tools/cooling.ts`
 */

import {
  EngineCoolingSystem,
  ambientAirC,
  radiatorKwPerK,
  stepTemperature,
  waterCoolingEffect,
  COLD_SOAK_C,
} from '../src/vehicle/cooling';
import {
  engineHeat,
  variant,
  variantsOfKind,
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

const SMALL_ENGINE = engineOf('engine_i4_1600');
const BIG_ENGINE = engineOf('engine_chevy_350');
/** The one radiator, in every car's bonnet. */
const RADIATOR: RadiatorSpec = variant('radiator').radiator!;

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
    boost?: number;
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
      boost: options.boost ?? 0,
    });
  }
  return { temperature: system.temperature, water: system.waterLitres, system };
}

console.log('cooling: the core and the water in it');

check(
  'the one core is rated against the engine it cools, not a class',
  radiatorKwPerK(engineHeat(SMALL_ENGINE)) < radiatorKwPerK(engineHeat(BIG_ENGINE)),
  `1.6 ${radiatorKwPerK(engineHeat(SMALL_ENGINE)).toFixed(2)} kW/K, ` +
    `5.7 ${radiatorKwPerK(engineHeat(BIG_ENGINE)).toFixed(2)} kW/K`,
);
check(
  'water keeps full effect at the brim and none at all when dry',
  waterCoolingEffect(1) === 1 &&
    waterCoolingEffect(0) === 0 &&
    Math.abs(waterCoolingEffect(0.6) - 0.85) < 1e-9 &&
    Math.abs(waterCoolingEffect(0.3) - 0.45) < 1e-9,
  `1.00=${waterCoolingEffect(1).toFixed(2)} 0.60=${waterCoolingEffect(0.6).toFixed(2)} ` +
    `0.30=${waterCoolingEffect(0.3).toFixed(2)} dry=${waterCoolingEffect(0).toFixed(2)}`,
);
check(
  'cooling effect only ever falls as the water leaves',
  (() => {
    let previous = waterCoolingEffect(0);
    for (let fill = 0.01; fill <= 1.0001; fill += 0.01) {
      const now = waterCoolingEffect(fill);
      if (now < previous - 1e-9) return false;
      previous = now;
    }
    return true;
  })(),
  'monotone across the whole 0..1 fill range',
);

// The whole point of a single core: it is rated from the engine's own full-load
// heat, so there is no engine in the registry it cannot hold — the imports included.
check(
  'a full core holds every catalogue engine at cruise and at full load',
  (() => {
    const hot: string[] = [];
    for (const v of variantsOfKind('engine')) {
      const heat = engineHeat(v.engine!);
      for (const load of [0.3, 1] as const) {
        const settled = run(v.engine!, RADIATOR, {
          seconds: 600,
          load,
          revs: 0.4 + 0.4 * load,
          speedMps: CRUISE_SPEED,
        });
        if (!(settled.temperature < heat.warningC && settled.temperature > heat.optimalMinC)) {
          hot.push(`${v.id}@${load} ${settled.temperature.toFixed(0)} C`);
        }
      }
    }
    return hot.length === 0;
  })(),
  `${variantsOfKind('engine').length} engines in band at 38 C, 90 km/h, both loads`,
);

console.log('cooling: temperature behaviour');

const smallHeat = engineHeat(SMALL_ENGINE);
const warmUp = run(SMALL_ENGINE, RADIATOR, {
  seconds: 240,
  load: 0.25,
  revs: 0.35,
  speedMps: CRUISE_SPEED,
});
check(
  'small engine + full water stabilises in band',
  warmUp.temperature > smallHeat.optimalMinC && warmUp.temperature < smallHeat.warningC,
  `${warmUp.temperature.toFixed(1)} C (band ${smallHeat.optimalMinC}-${smallHeat.warningC})`,
);

const warmUpTime = (() => {
  const system = new EngineCoolingSystem(COLD_SOAK_C);
  system.configure(SMALL_ENGINE, RADIATOR);
  system.setWater(RADIATOR.capacity);
  system.setTemperature(COLD_SOAK_C);
  for (let t = 0; t < 600; t += 0.5) {
    system.update(0.5, {
      load: 0.25,
      revs: 0.35,
      speedMps: CRUISE_SPEED,
      ambientC: CRUISE_AMBIENT,
      engineRunning: true,
      boost: 0,
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

// The core no longer comes in sizes: what decides whether the car holds temperature
// is how much water is in the one that is fitted. A fifth-full core is the in-play
// "I ignored the gauge" case.
const bigHeat = engineHeat(BIG_ENGINE);
const lowWater = run(BIG_ENGINE, RADIATOR, {
  seconds: 300,
  load: 1,
  revs: 0.8,
  speedMps: CRUISE_SPEED,
  waterFill: 0.2,
});
const fullWater = run(BIG_ENGINE, RADIATOR, {
  seconds: 300,
  load: 1,
  revs: 0.8,
  speedMps: CRUISE_SPEED,
});
check(
  'a fifth-full core climbs into the hot zone where a full one holds',
  lowWater.temperature > bigHeat.warningC &&
    fullWater.temperature < bigHeat.warningC &&
    lowWater.temperature > fullWater.temperature + 20,
  `20% ${lowWater.temperature.toFixed(1)} C vs full ${fullWater.temperature.toFixed(1)} C ` +
    `(warning ${bigHeat.warningC})`,
);

const dry = run(SMALL_ENGINE, RADIATOR, {
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

// Full load at a crawl: the airflow is near its standstill floor, so the boost term
// is not masked by a thermostat that has already opened all the way.
const unboosted = (() => {
  const system = new EngineCoolingSystem(CRUISE_AMBIENT);
  system.configure(BIG_ENGINE, RADIATOR);
  system.setTemperature(CRUISE_AMBIENT);
  for (let t = 0; t < 1200; t += 5) {
    system.setWater(RADIATOR.capacity);
    system.update(5, {
      load: 1,
      revs: 0.8,
      speedMps: 5,
      ambientC: CRUISE_AMBIENT,
      engineRunning: true,
      boost: 0,
    });
  }
  return system.temperature;
})();
const boosted = (() => {
  const system = new EngineCoolingSystem(CRUISE_AMBIENT);
  system.configure(BIG_ENGINE, RADIATOR);
  system.setTemperature(CRUISE_AMBIENT);
  for (let t = 0; t < 1200; t += 5) {
    system.setWater(RADIATOR.capacity);
    system.update(5, {
      load: 1,
      revs: 0.8,
      speedMps: 5,
      ambientC: CRUISE_AMBIENT,
      engineRunning: true,
      boost: 1,
    });
  }
  return system.temperature;
})();
check(
  'a turbo raises the equilibrium temperature under full load',
  boosted > unboosted + 10,
  `boosted ${boosted.toFixed(1)} C vs naturally aspirated ${unboosted.toFixed(1)} C`,
);

const standing = run(SMALL_ENGINE, RADIATOR, {
  seconds: 300,
  load: 1,
  revs: 0.8,
  speedMps: 0,
});
const moving = run(SMALL_ENGINE, RADIATOR, {
  seconds: 300,
  load: 1,
  revs: 0.8,
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
    // A thermostat-dominated case: both runs sit in the working band, where the
    // linear airflow curve is what decides the difference.
    const still = run(SMALL_ENGINE, RADIATOR, {
      seconds: 300,
      load: 0.55,
      revs: 0.45,
      speedMps: 0,
    });
    const crawl = run(SMALL_ENGINE, RADIATOR, {
      seconds: 300,
      load: 0.55,
      revs: 0.45,
      speedMps: 0.4,
    });
    return Math.abs(crawl.temperature - still.temperature) < 3;
  })(),
  'crawl and standstill within 3 C',
);

const cooling = run(SMALL_ENGINE, RADIATOR, {
  seconds: 600,
  running: false,
  startC: smallHeat.operatingC,
});
check(
  'a stopped engine cools toward air temperature',
  cooling.temperature < smallHeat.optimalMinC && cooling.temperature > CRUISE_AMBIENT - 1,
  `${cooling.temperature.toFixed(1)} C after 10 min stopped (air ${CRUISE_AMBIENT})`,
);

check(
  'a healthy engine at cruise rejects the ambient swing through its thermostat',
  (() => {
    const hot = run(SMALL_ENGINE, RADIATOR, {
      seconds: 300,
      load: 0.3,
      revs: 0.4,
      speedMps: CRUISE_SPEED,
      ambientC: 46,
    });
    const cold = run(SMALL_ENGINE, RADIATOR, {
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
  `15:00 ${ambientAirC(DAY_LENGTH * 0.625, DAY_LENGTH).toFixed(1)} C, ` +
    `03:00 ${ambientAirC(DAY_LENGTH * 0.125, DAY_LENGTH).toFixed(1)} C`,
);

console.log('cooling: robustness');

const fast = run(BIG_ENGINE, RADIATOR, {
  seconds: 120,
  dt: 1 / 240,
  load: 1,
  revs: 0.8,
  speedMps: CRUISE_SPEED,
});
const slow = run(BIG_ENGINE, RADIATOR, {
  seconds: 120,
  dt: 0.2,
  load: 1,
  revs: 0.8,
  speedMps: CRUISE_SPEED,
});
const stutter = run(BIG_ENGINE, RADIATOR, {
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
    system.configure(SMALL_ENGINE, RADIATOR);
    system.setWater(Number.NaN);
    system.setTemperature(Number.NaN);
    system.update(Number.NaN, {
      load: Number.NaN,
      revs: Number.POSITIVE_INFINITY,
      speedMps: Number.NaN,
      ambientC: Number.NaN,
      engineRunning: true,
      boost: Number.NaN,
    });
    system.update(1, {
      load: 2,
      revs: -5,
      speedMps: Number.NEGATIVE_INFINITY,
      ambientC: 40,
      engineRunning: true,
      boost: 5,
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
      boost: 0,
    });
    return system.readout() === null && system.getState().waterCapacity === 0;
  })(),
  'readout null, capacity 0',
);
check(
  'water cannot exceed the fitted core, and pulling the core spills it',
  (() => {
    const system = new EngineCoolingSystem();
    system.configure(SMALL_ENGINE, RADIATOR);
    system.addWater(99);
    const filled = system.waterLitres;
    system.installRadiator(null);
    system.setWater(filled);
    return filled === RADIATOR.capacity && system.waterLitres === 0;
  })(),
  `filled to ${RADIATOR.capacity} L, then 0 L with no core`,
);

console.log('cooling: consequences');

const cooked = (() => {
  const system = new EngineCoolingSystem(bigHeat.operatingC);
  system.configure(BIG_ENGINE, RADIATOR);
  system.setWater(0);
  system.setTemperature(bigHeat.operatingC);
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
      boost: 0,
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
    const system = new EngineCoolingSystem(smallHeat.warningC + 2);
    system.configure(SMALL_ENGINE, RADIATOR);
    system.setWater(RADIATOR.capacity);
    system.setTemperature(smallHeat.warningC + 2);
    for (let t = 0; t < 120; t += 0.25) {
      system.update(0.25, {
        load: 0,
        revs: 0.15,
        speedMps: CRUISE_SPEED,
        ambientC: CRUISE_AMBIENT,
        engineRunning: true,
        boost: 0,
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
    cold.configure(SMALL_ENGINE, RADIATOR);
    cold.setTemperature(20);
    const warm = new EngineCoolingSystem(smallHeat.operatingC);
    warm.configure(SMALL_ENGINE, RADIATOR);
    warm.setTemperature(smallHeat.operatingC);
    return cold.getState().performance < 0.95 && warm.getState().performance === 1;
  })(),
  'cold penalty present, warm engine unpenalised',
);

const boiled = run(BIG_ENGINE, RADIATOR, {
  seconds: 600,
  load: 1,
  revs: 0.9,
  speedMps: CRUISE_SPEED,
  waterFill: 0.2,
});
const sipped = run(SMALL_ENGINE, RADIATOR, {
  seconds: 600,
  load: 0.25,
  revs: 0.35,
  speedMps: CRUISE_SPEED,
});
check(
  'an engine run hot loses water much faster than a healthy one',
  RADIATOR.capacity * 0.2 - boiled.water > (RADIATOR.capacity - sipped.water) * 4,
  `boiling lost ${(RADIATOR.capacity * 0.2 - boiled.water).toFixed(2)} L, ` +
    `healthy lost ${(RADIATOR.capacity - sipped.water).toFixed(2)} L in 10 min`,
);
check(
  'a parked car does not boil its radiator away',
  run(SMALL_ENGINE, RADIATOR, { seconds: 3600, running: false, startC: 130 }).water ===
    RADIATOR.capacity,
  'water unchanged over an hour parked',
);
check(
  'two systems on the same engine spec do not share state',
  (() => {
    const a = new EngineCoolingSystem(30);
    const b = new EngineCoolingSystem(30);
    a.configure(SMALL_ENGINE, RADIATOR);
    b.configure(SMALL_ENGINE, RADIATOR);
    a.setWater(RADIATOR.capacity);
    b.setWater(RADIATOR.capacity);
    for (let i = 0; i < 600; i++) {
      a.update(0.25, { load: 1, revs: 0.9, speedMps: 0, ambientC: 40, engineRunning: true, boost: 0 });
      b.update(0.25, { load: 0, revs: 0, speedMps: 0, ambientC: 40, engineRunning: false, boost: 0 });
    }
    return a.temperature - b.temperature > 40;
  })(),
  'independent temperatures',
);

console.log(
  `\nequilibria at 38 C air, 90 km/h: ` +
    `1.6+full ${warmUp.temperature.toFixed(0)} C, ` +
    `5.7+full ${fullWater.temperature.toFixed(0)} C, ` +
    `5.7+20% ${lowWater.temperature.toFixed(0)} C`,
);
console.log(failures === 0 ? 'ALL OK' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
