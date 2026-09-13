/**
 * Deterministic adaptive-resolution controller harness.
 *
 * Run with `bun tools/adaptive-quality.ts`.
 *
 * These assert the CONTRACTS of the controller, not the tuned numbers behind them. The
 * previous version pinned the settle window ("the 8th slow sample steps down") and the
 * per-tier floor constants, so it went red the moment either was retuned — it was
 * reporting a change of opinion, not a defect, and by then it had been red long enough
 * that nobody read it. Every check below survives a retune: it asks whether a machine in
 * trouble is protected, not by how many samples.
 */

import { AdaptiveResolutionController } from '../src/core/adaptivequality';

type ResolutionAction = 'down' | 'up' | null;

let failures = 0;

function check(label: string, condition: boolean, detail: string): void {
  if (!condition) failures++;
  console.log(`  ${condition ? 'ok  ' : 'FAIL'}  ${label.padEnd(56)} ${detail}`);
}

/** A slow frame, a fast frame, and a machine under no load at all. */
const SLOW_MS = 12;
const FAST_MS = 1;

/**
 * Feeds one frame per millisecond until the controller acts, or gives up.
 *
 * Driven rather than counted: how long a controller waits before it commits is a tuning
 * decision, while the fact that it eventually does is the contract. `capMs` is a
 * millisecond budget, which also bounds the wait wherever a cooldown applies.
 */
function drive(
  controller: AdaptiveResolutionController,
  gpuMs: number,
  eligible: boolean,
  allowUpscale: boolean,
  startMs: number,
  capMs = 600,
): { action: ResolutionAction; samples: number } {
  for (let i = 0; i < capMs; i++) {
    const action = controller.sample(gpuMs, eligible, allowUpscale, startMs + i);
    if (action !== null) return { action, samples: i + 1 };
  }
  return { action: null, samples: capMs };
}

function run(): void {
  // --- evidence, and the lack of it -----------------------------------------
  {
    const quiet = new AdaptiveResolutionController('standard');
    check(
      'a single slow frame is not enough evidence',
      quiet.sample(SLOW_MS, true, true, 1_000) === null,
      `scale stayed ${quiet.scale}`,
    );

    // A driver that reports a duration every other frame must still be able to adapt: a
    // null is an absence of evidence, not evidence of health.
    const alternating = new AdaptiveResolutionController('standard');
    let acted = false;
    for (let i = 0; i < 600 && !acted; i++) {
      acted = alternating.sample(i % 2 === 0 ? SLOW_MS : null, true, true, 10_000 + i) === 'down';
    }
    check('a null sample neither blocks nor excuses adaptation', acted, `scale ${alternating.scale}`);

    const ineligible = new AdaptiveResolutionController('standard');
    let ineligibleActed = false;
    for (let i = 0; i < 600 && !ineligibleActed; i++) {
      ineligibleActed =
        ineligible.sample(SLOW_MS, i % 2 === 0, true, 20_000 + i) === 'down';
    }
    check(
      'an ineligible frame neither blocks nor excuses adaptation',
      ineligibleActed,
      `scale ${ineligible.scale}`,
    );
  }

  // --- sustained overload is answered, conservatively ------------------------
  {
    const loaded = new AdaptiveResolutionController('standard');
    const first = drive(loaded, SLOW_MS, true, true, 30_000);
    check('sustained overload steps the scale down', first.action === 'down', `after ${first.samples} samples`);
    check(
      'one step never removes more than half the resolution',
      loaded.scale < 1 && loaded.scale >= 0.5,
      `scale ${loaded.scale}`,
    );
  }

  // --- reductions stop at a floor --------------------------------------------
  {
    const floored = new AdaptiveResolutionController('standard');
    let previous = floored.scale;
    let steps = 0;
    for (let round = 0; round < 40; round++) {
      const { action } = drive(floored, SLOW_MS, true, true, 40_000 + round * 10_000);
      if (action !== 'down') break;
      steps++;
      check(
        `floor: reduction ${steps} lowers the scale and not past it`,
        floored.scale < previous && floored.scale > 0,
        `scale ${floored.scale.toFixed(4)}`,
      );
      previous = floored.scale;
    }
    check('floor: sustained overload is answered more than once', steps > 1, `${steps} reductions`);
    check('floor: the reductions stop at a floor', steps < 40, `${steps} reductions`);
    check('floor: the floor is still a picture', floored.scale > 0.1, `scale ${floored.scale}`);

    // And once at the floor, a machine that is still overloaded is not asked to give
    // more: the controller says nothing rather than emitting a no-op reduction.
    const stuck = drive(floored, SLOW_MS, true, true, 40_000 + 40 * 10_000);
    check('floor: overload at the floor reports no further reduction', stuck.action !== 'down', `scale ${floored.scale}`);
  }

  // --- an installed floor is the one that counts ------------------------------
  {
    const installed = new AdaptiveResolutionController('blessing');
    installed.setMinimumScale(0.42);
    let scale = installed.scale;
    for (let round = 0; round < 40; round++) {
      const { action } = drive(installed, SLOW_MS, true, true, 500_000 + round * 10_000);
      if (action !== 'down') break;
      scale = installed.scale;
    }
    check(
      'a floor installed by the renderer is honoured',
      Math.abs(scale - 0.42) < 1e-9,
      `scale ${scale}`,
    );

    // Changing rung must not leave the previous rung's floor behind.
    installed.setQuality('blessing');
    check(
      'a new rung reinstates its own floor',
      installed.scale >= 0.42,
      `scale ${installed.scale}`,
    );
  }

  // --- recovery is earned, never assumed -------------------------------------
  {
    const recovering = new AdaptiveResolutionController('standard');
    drive(recovering, SLOW_MS, true, true, 600_000);
    const reduced = recovering.scale;
    check('a reduced scale is the starting point for recovery', reduced < 1, `scale ${reduced}`);

    // While the driver is working the car, no upscale is admitted however fast the GPU
    // looks: a stutter under load is the worst time to add pixels.
    let droveUp = false;
    for (let i = 0; i < 600 && !droveUp; i++) {
      droveUp = recovering.sample(FAST_MS, true, false, 601_000 + i) === 'up';
    }
    check('upscale stays out while the car is being driven', !droveUp, `scale ${recovering.scale}`);

    const up = drive(recovering, FAST_MS, true, true, 700_000);
    check('sustained headroom is spent on resolution', up.action === 'up', `after ${up.samples} samples`);
    check('the scale never passes the display', recovering.scale <= 1, `scale ${recovering.scale}`);
  }
}

run();
if (failures > 0) process.exitCode = 1;
