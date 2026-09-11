/**
 * tools/adaptive-resolution.ts
 *
 * Does the dynamic-resolution controller survive a launch, and can it come back?
 *
 * The drawing buffer is scaled from measured GPU time, and two failures there are
 * invisible in code review but ruin the picture:
 *
 *   1. The launch transient — shader variants for freshly streamed content, first
 *      texture uploads, the boot GC — is the most expensive part of the session. If
 *      the controller judges it, the player enters the world at the resolution floor,
 *      where the film grain is filtered away by the upscale and the ink outlines
 *      smear into a general darkening.
 *   2. Once down, it has to be able to come back up. The previous policy needed 240
 *      CONSECUTIVE samples under the fast threshold and reset that count on any
 *      sample in the band between the thresholds, which on an integrated GPU is
 *      where a healthy frame lives — so a drop was permanent for the session.
 *
 * This drives the real controller with a synthetic GPU whose cost follows the scale
 * (fill-bound, so cost is proportional to pixels) and asserts both.
 *
 *   bun run tools/adaptive-resolution.ts
 *
 * Nothing here is part of the game bundle.
 */

import { AdaptiveResolutionController } from '../src/core/adaptivequality';

let failures = 0;

function check(label: string, ok: boolean, detail: string): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}  ${detail}`);
  if (!ok) failures++;
}

const FRAME_MS = 1000 / 60;

/** Cost at full resolution, in ms, for a fill-bound frame at `scale`. */
function costAt(fullCostMs: number, scale: number): number {
  return fullCostMs * scale * scale;
}

interface Run {
  readonly scale: number;
  readonly changes: number;
}

/**
 * Runs `frames` frames whose full-resolution cost is `fullCostMs`, starting the
 * clock at `startMs`. `frozen` frames are rendered but not judged, which is what
 * the launch settle does with the transient.
 */
function drive(
  controller: AdaptiveResolutionController,
  frames: number,
  fullCostMs: number,
  startMs: number,
  frozen = 0,
): Run {
  let changes = 0;
  for (let frame = 0; frame < frames; frame++) {
    const now = startMs + frame * FRAME_MS;
    const eligible = frame >= frozen;
    if (controller.sample(costAt(fullCostMs, controller.scale), eligible, true, now) !== null) {
      changes++;
    }
  }
  return { scale: controller.scale, changes };
}

// --- 1. A launch transient must not decide the session's resolution -------------
//
// Forty frames of 30 ms (a cold first second) followed by an ordinary 6 ms drive.

{
  const judged = new AdaptiveResolutionController('standard');
  drive(judged, 40, 30, 0);
  const afterTransient = judged.scale;
  drive(judged, 600, 6, 40 * FRAME_MS);
  check(
    'a judged launch transient drags the scale down',
    afterTransient < 1,
    `scale ${afterTransient.toFixed(3)} after the transient alone`,
  );

  const settled = new AdaptiveResolutionController('standard');
  // The settle discards the first 30 frames, exactly as main.ts does.
  drive(settled, 40, 30, 0, 30);
  const enter = settled.scale;
  const drive60s = drive(settled, 3600, 6, 40 * FRAME_MS);
  check(
    'the settled launch enters at full resolution',
    enter === 1,
    `scale ${enter.toFixed(3)} when the cover lifts`,
  );
  check(
    'and a healthy drive never moves it',
    drive60s.scale === 1 && drive60s.changes === 0,
    `scale ${drive60s.scale.toFixed(3)} after 60 s, ${drive60s.changes} change(s)`,
  );
}

// --- 2. Sustained load steps down, and stops ------------------------------------

{
  const controller = new AdaptiveResolutionController('standard');
  const heavy = drive(controller, 3600, 20, 0);
  const settledScale = controller.scale;
  const more = drive(controller, 1800, 20, 3600 * FRAME_MS);
  check(
    'sustained overload reduces the scale',
    settledScale < 1 && settledScale >= 0.55,
    `scale ${settledScale.toFixed(3)} after 60 s, ${heavy.changes} step(s)`,
  );
  check(
    'and settles instead of sliding to the floor',
    more.scale === settledScale
      && costAt(20, settledScale) < 11,
    `scale ${more.scale.toFixed(3)}, ${costAt(20, more.scale).toFixed(1)} ms/frame`,
  );
}

// --- 3. A drop is recoverable ---------------------------------------------------
//
// Thirty seconds of genuine overload, then the load goes away. The old policy could
// not climb out of this at all; the requirement is that the whole range is crossed
// in well under a minute of headroom.

{
  const controller = new AdaptiveResolutionController('standard');
  drive(controller, 1800, 48, 0);
  const bottom = controller.scale;
  const recovery = drive(controller, 1800, 5, 1800 * FRAME_MS);
  check(
    'a heavy stretch reaches the floor',
    bottom <= 0.56,
    `scale ${bottom.toFixed(3)}`,
  );
  check(
    'and 30 s of headroom restores full resolution',
    recovery.scale === 1,
    `scale ${recovery.scale.toFixed(3)} after ${recovery.changes} upward step(s)`,
  );
}

// --- 4. A single stall is not evidence ------------------------------------------
//
// One second of 40 ms frames inside an otherwise healthy drive: a mirage tableau
// coming into view, a traffic burst, a GC. The average must absorb it.

{
  const controller = new AdaptiveResolutionController('standard');
  drive(controller, 600, 6, 0);
  drive(controller, 60, 40, 600 * FRAME_MS);
  const afterStall = controller.scale;
  const after = drive(controller, 1200, 6, 660 * FRAME_MS);
  check(
    'a one-second stall costs at most one step',
    afterStall >= 0.85,
    `scale ${afterStall.toFixed(3)}`,
  );
  check(
    'and the drive gets its resolution back',
    after.scale === 1,
    `scale ${after.scale.toFixed(3)}`,
  );
}

// --- 5. The launch settle leaves on a verdict, not on quiet ---------------------
//
// This mirrors `settleLaunchResolution` in main.ts: discard the transient, then run
// the real frame path until the controller has MEASURED the scale it is holding.
// The first version of that loop left as soon as 60 frames passed without a change,
// which on a machine that needs to step down is before the controller has said
// anything — so the descent happened afterwards, in front of the player.

{
  const DISCARD = 30;
  const settle = (controller: AdaptiveResolutionController, fullCostMs: number) => {
    let now = 0;
    let frames = 0;
    while (now < 20_000) {
      const cost = costAt(fullCostMs, controller.scale);
      // A slow frame takes as long as it costs; pacing the settle by frame count
      // alone would measure the machine rather than the wait.
      now += Math.max(FRAME_MS, cost);
      frames++;
      const eligible = frames > DISCARD;
      controller.sample(cost, eligible, true, now);
      if (eligible && controller.verdictReached(now)) break;
    }
    return { scale: controller.scale, ms: now };
  };

  const healthy = new AdaptiveResolutionController('standard');
  const quick = settle(healthy, 6);
  check(
    'a machine with headroom settles in about a second and a half',
    quick.scale === 1 && quick.ms < 3_000,
    `scale ${quick.scale.toFixed(3)} after ${(quick.ms / 1000).toFixed(1)} s`,
  );

  const strained = new AdaptiveResolutionController('standard');
  const slow = settle(strained, 26);
  const enteredCost = costAt(26, slow.scale);
  check(
    'a strained machine finishes its descent under the cover',
    slow.scale < 1 && enteredCost < 11 && slow.ms < 20_000,
    `scale ${slow.scale.toFixed(3)} at ${enteredCost.toFixed(1)} ms after ${(slow.ms / 1000).toFixed(1)} s`,
  );
  const drive5min = drive(strained, 18_000, 26, slow.ms);
  check(
    'and the picture then holds still for the whole drive',
    drive5min.changes === 0,
    `${drive5min.changes} change(s) over 5 min, scale ${drive5min.scale.toFixed(3)}`,
  );
}

console.log(
  failures === 0
    ? '\nall adaptive-resolution checks passed'
    : `\n${failures} adaptive-resolution check(s) FAILED`,
);
if (failures > 0) process.exitCode = 1;
