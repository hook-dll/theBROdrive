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

/**
 * Feeds a machine whose GPU cost is PROPORTIONAL to the pixels it is asked to
 * shade, which is the worst case the controller predicts against: every rung it
 * climbs costs it the full square of the step.
 */
function driveModelled(
  controller: AdaptiveResolutionController,
  fullScaleMs: number,
  startMs: number,
  durationMs: number,
): { changes: number; scales: number[] } {
  const scales: number[] = [];
  for (let i = 0; i < durationMs; i++) {
    const cost = fullScaleMs * controller.scale * controller.scale;
    if (controller.sample(cost, true, true, startMs + i) !== null) scales.push(controller.scale);
  }
  return { changes: scales.length, scales };
}

/** Whether a fresh controller leaves full resolution alone at this cost. */
function holdsFullScale(quality: 'acceptable' | 'standard' | 'blessing', costMs: number): boolean {
  const controller = new AdaptiveResolutionController(quality);
  for (let i = 0; i < 4_000; i++) {
    if (controller.sample(costMs, true, true, i) === 'down') return false;
  }
  return true;
}

/**
 * The most expensive frame a rung will carry at full resolution, discovered by
 * bisection rather than read from the constants — so these checks keep asking the
 * same question after the thresholds are retuned.
 */
function largestToleratedCost(quality: 'acceptable' | 'standard' | 'blessing'): number {
  let affordable = 0;
  let refused = 400;
  for (let i = 0; i < 24; i++) {
    const mid = (affordable + refused) / 2;
    if (holdsFullScale(quality, mid)) affordable = mid;
    else refused = mid;
  }
  return affordable;
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
  //
  // The overloaded machine here is modelled as one whose cost FOLLOWS its pixel
  // count, because that is the only overload resolution can answer — and, since the
  // controller now measures whether its reductions are landing, the only one it is
  // willing to spend the picture on. See the futility check further down for the
  // other kind.
  {
    const floored = new AdaptiveResolutionController('standard');
    const overloaded = largestToleratedCost('standard') * 20;
    const descent = driveModelled(floored, overloaded, 40_000, 200_000);
    let previous = 1;
    for (const [index, scale] of descent.scales.entries()) {
      check(
        `floor: reduction ${index + 1} lowers the scale and not past it`,
        scale < previous && scale > 0,
        `scale ${scale.toFixed(4)}`,
      );
      previous = scale;
    }
    check(
      'floor: sustained overload is answered more than once',
      descent.scales.length > 1,
      `${descent.scales.length} reductions`,
    );
    check('floor: the floor is still a picture', floored.scale > 0.1, `scale ${floored.scale}`);

    // And once at the floor, a machine that is still overloaded is not asked to give
    // more: the controller says nothing rather than emitting a no-op reduction.
    const stuck = driveModelled(floored, overloaded, 300_000, 60_000);
    check(
      'floor: overload at the floor reports no further reduction',
      stuck.changes === 0,
      `scale ${floored.scale}`,
    );
  }

  // --- and the picture is not spent where it cannot buy anything ---------------
  //
  // The frame this game actually submits is dominated by per-call work: cutting a
  // phone's pixel budget by nearly three times moved the cost of submitting a frame
  // by twenty per cent. A controller that treats every millisecond as fill answers
  // that by halving the picture and arriving at the same duration — the player pays
  // in film grain, ink outlines and surface texture, and gets no frame rate for it.
  {
    const stalling = new AdaptiveResolutionController('standard');
    const stall = largestToleratedCost('standard') * 2;
    let clock = 3_000_000;
    for (let i = 0; i < 200_000; i++) stalling.sample(stall, true, true, clock++);
    check(
      'a cost the pixel count does not move is not paid for with the picture',
      stalling.scale >= 0.8,
      `scale ${stalling.scale.toFixed(3)}`,
    );

    // ...and the moment the same machine is overloaded by something resolution CAN
    // answer, the refusal above must not have locked it out of adapting.
    const fell = driveModelled(stalling, stall * 2, clock, 200_000);
    check(
      'a measured refusal does not become a permanent one',
      stalling.scale < 0.8 && fell.changes > 0,
      `scale ${stalling.scale.toFixed(3)} after ${fell.changes} changes`,
    );
  }

  // --- an installed floor is the one that counts ------------------------------
  {
    const installed = new AdaptiveResolutionController('blessing');
    installed.setMinimumScale(0.42);
    driveModelled(installed, largestToleratedCost('blessing') * 20, 500_000, 200_000);
    const scale = installed.scale;
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

  // --- the resolution the machine can afford is REACHABLE ---------------------
  //
  // The bug this answers: a load that lifts leaves the scale where it fell. The
  // controller used to require the frame to become cheap in absolute terms before
  // it would return a single pixel, while a much smaller cost was enough to take
  // them — so any sustained load (a night of lit lamps, the dawn that switches the
  // heat-mirage warp back on, a burst of streamed shader variants) walked the scale
  // down and nothing walked it back for the rest of the session.
  //
  // Stated without reference to any threshold in the controller: a cost the rung
  // comfortably CARRIES at full resolution is one it must also CLIMB BACK to. A
  // fifth under its own measured tolerance is what "comfortably" means here —
  // right ON the tolerance a controller is entitled to stop one rung short.
  {
    const tolerated = largestToleratedCost('standard');
    check(
      'the controller tolerates some cost at full resolution',
      tolerated > 0,
      `${tolerated.toFixed(2)} ms`,
    );

    const recovered = new AdaptiveResolutionController('standard');
    let clock = 1_000_000;
    // A night's worth of genuine overload first: it costs what its pixel count says,
    // so the controller spends every rung it has on it and lands at the floor.
    driveModelled(recovered, tolerated * 8, clock, 200_000);
    clock += 200_000;
    const floorScale = recovered.scale;
    check('the transient put the scale on the floor', floorScale < 1, `scale ${floorScale.toFixed(3)}`);

    // The load lifts. The frame now costs, at full resolution, a fifth less than
    // what this controller has just said it would carry there.
    const climb = driveModelled(recovered, tolerated * 0.8, clock, 120_000);
    check(
      'an affordable resolution is climbed back to, not merely permitted',
      recovered.scale === 1,
      `scale ${recovered.scale.toFixed(3)} after ${climb.changes} changes`,
    );
  }

  // --- and the ladder settles instead of hunting ------------------------------
  {
    const settling = new AdaptiveResolutionController('standard');
    const tolerated = largestToleratedCost('standard');
    // Three times the affordable cost: the machine cannot hold full resolution, so
    // the controller must find a rung and then leave it alone. A rung it steps off
    // and back onto forever is a resolution that visibly pulses while driving.
    driveModelled(settling, tolerated * 3, 2_000_000, 60_000);
    const settled = settling.scale;
    const quiet = driveModelled(settling, tolerated * 3, 2_060_000, 60_000);
    check(
      'a machine that cannot hold full resolution settles on one rung',
      quiet.changes === 0 && settling.scale === settled,
      `scale ${settled.toFixed(3)}, ${quiet.changes} further changes`,
    );
    check(
      'the rung it settles on is a picture, not a postage stamp',
      settled > 0.5,
      `scale ${settled.toFixed(3)}`,
    );
  }

  // --- a pinned scale is the player's, and stays his -------------------------
  //
  // `Auto` is this controller; a named render scale is the other answer, and the
  // promise it makes is that the number does not move. It must still MEASURE, because
  // the development frame report reads the average to say whether a hot frame is
  // waiting on the GPU or the CPU — on a phone there is no other way to tell.
  {
    const pinned = new AdaptiveResolutionController('standard');
    pinned.setPinned(true);
    const overloaded = drive(pinned, SLOW_MS * 4, true, true, 3_000_000);
    check(
      'a pinned scale does not move under sustained overload',
      overloaded.action === null && pinned.scale === 1,
      `scale ${pinned.scale}`,
    );
    check(
      'a pinned controller still measures the frame',
      pinned.averageGpuMs !== null && pinned.averageGpuMs > SLOW_MS,
      `average ${pinned.averageGpuMs?.toFixed(1) ?? 'none'} ms`,
    );

    // And returning to Auto starts from full resolution with nothing remembered: the
    // slope and the average were measured at a pixel count that no longer applies.
    const released = new AdaptiveResolutionController('standard');
    drive(released, SLOW_MS, true, true, 4_000_000);
    const reduced = released.scale;
    released.setPinned(true);
    released.setPinned(false);
    check(
      'leaving a pinned scale returns to full resolution, not to the old reduction',
      reduced < 1 && released.scale === 1 && released.averageGpuMs === null,
      `was ${reduced.toFixed(3)}, now ${released.scale}`,
    );
  }
}

run();
if (failures > 0) process.exitCode = 1;
