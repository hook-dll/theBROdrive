/**
 * Deterministic adaptive-resolution controller harness.
 *
 * Run with `bun tools/adaptive-quality.ts`.
 */

import { AdaptiveResolutionController } from '../src/core/adaptivequality';

type ResolutionAction = 'down' | 'up' | null;

let failures = 0;

function check(label: string, condition: boolean, detail: string): void {
  if (!condition) failures++;
  console.log(`  ${condition ? 'ok  ' : 'FAIL'}  ${label.padEnd(54)} ${detail}`);
}

function equal(label: string, actual: ResolutionAction, expected: ResolutionAction): void {
  check(label, actual === expected, `expected ${expected}, got ${actual}`);
}

function scaleIs(label: string, controller: AdaptiveResolutionController, expected: number): void {
  check(label, Math.abs(controller.scale - expected) < 1e-12, `expected ${expected}, got ${controller.scale}`);
}

function samples(
  controller: AdaptiveResolutionController,
  gpuMs: number | null,
  eligible: boolean,
  allowUpscale: boolean,
  startMs: number,
  count: number,
): ResolutionAction[] {
  return Array.from({ length: count }, (_, index) =>
    controller.sample(gpuMs, eligible, allowUpscale, startMs + index),
  );
}

function noActions(label: string, outcomes: readonly ResolutionAction[]): void {
  const actions = outcomes.filter((outcome) => outcome !== null);
  check(label, actions.length === 0, actions.length === 0 ? 'no resolution change' : actions.join(', '));
}

function slowStep(controller: AdaptiveResolutionController, startMs: number, label: string): void {
  noActions(`${label}: first 23 slow GPU samples`, samples(controller, 20, true, true, startMs, 23));
  equal(`${label}: 24th slow GPU sample`, controller.sample(20, true, true, startMs + 23), 'down');
}

function run(): void {
  const sustainedSlow = new AdaptiveResolutionController('standard');
  noActions('sustained slow load: 23 samples do not step down', samples(sustainedSlow, 20, true, true, 10_000, 23));
  equal(
    'sustained slow load: 24th sample steps down',
    sustainedSlow.sample(20, true, true, 10_023),
    'down',
  );
  scaleIs('standard slow load clamps to its floor', sustainedSlow, 0.85);

  const ineligibleReset = new AdaptiveResolutionController('standard');
  noActions('ineligible reset: partial slow streak has no action', samples(ineligibleReset, 20, true, true, 20_000, 12));
  equal('ineligible reset: excluded frame has no action', ineligibleReset.sample(20, false, true, 20_012), null);
  noActions('ineligible reset: next 23 samples restart the streak', samples(ineligibleReset, 20, true, true, 20_013, 23));
  equal('ineligible reset: restarted 24th sample steps down', ineligibleReset.sample(20, true, true, 20_036), 'down');

  const nullReset = new AdaptiveResolutionController('standard');
  noActions('null reset: partial slow streak has no action', samples(nullReset, 20, true, true, 30_000, 12));
  equal('null reset: unavailable GPU duration has no action', nullReset.sample(null, true, true, 30_012), null);
  noActions('null reset: next 23 samples restart the streak', samples(nullReset, 20, true, true, 30_013, 23));
  equal('null reset: restarted 24th sample steps down', nullReset.sample(20, true, true, 30_036), 'down');

  const cooldown = new AdaptiveResolutionController('acceptable');
  slowStep(cooldown, 40_000, 'cooldown: first sustained slow period');
  scaleIs('cooldown: initial slow period lowers acceptable scale', cooldown, 0.8);
  noActions('cooldown: immediate second sustained slow period is blocked', samples(cooldown, 20, true, true, 40_024, 24));
  scaleIs('cooldown: blocked period preserves scale', cooldown, 0.8);
  equal('cooldown: later eligible sample permits the pending reduction', cooldown.sample(20, true, true, 43_000), 'down');
  scaleIs('cooldown: elapsed cooldown permits another reduction', cooldown, 0.64);

  const upscale = new AdaptiveResolutionController('standard');
  slowStep(upscale, 50_000, 'upscale: initial slow period');
  noActions('upscale: first 119 fast samples do not step up', samples(upscale, 12, true, true, 53_000, 119));
  equal('upscale: 120th fast sample steps up when allowed', upscale.sample(12, true, true, 53_119), 'up');
  scaleIs('upscale: one step applies the 1.05 factor', upscale, 0.8925);

  const driving = new AdaptiveResolutionController('standard');
  slowStep(driving, 60_000, 'driving: initial slow period');
  noActions('driving: 120 fast samples cannot upscale while active', samples(driving, 12, true, false, 63_000, 120));
  scaleIs('driving: active-driving policy preserves reduced scale', driving, 0.85);
  equal('driving: allowing upscale admits the sustained fast evidence', driving.sample(12, true, true, 63_120), 'up');

  const acceptableFloor = new AdaptiveResolutionController('acceptable');
  slowStep(acceptableFloor, 70_000, 'acceptable floor: first reduction');
  slowStep(acceptableFloor, 73_000, 'acceptable floor: second reduction');
  slowStep(acceptableFloor, 76_000, 'acceptable floor: third reduction');
  slowStep(acceptableFloor, 79_000, 'acceptable floor: fourth reduction');
  scaleIs('acceptable floor: repeated reductions clamp at 0.5', acceptableFloor, 0.5);
  noActions('acceptable floor: sustained overload cannot go below floor', samples(acceptableFloor, 20, true, true, 82_000, 24));
  scaleIs('acceptable floor: floor remains stable', acceptableFloor, 0.5);

  const standardFloor = new AdaptiveResolutionController('standard');
  slowStep(standardFloor, 90_000, 'standard floor: initial reduction');
  noActions('standard floor: sustained overload cannot go below floor', samples(standardFloor, 20, true, true, 93_000, 24));
  scaleIs('standard floor: floor remains stable', standardFloor, 0.85);

  const blessing = new AdaptiveResolutionController('blessing');
  noActions('blessing: sustained slow GPU load never changes scale', samples(blessing, 20, true, true, 100_000, 24));
  noActions('blessing: sustained fast GPU load never changes scale', samples(blessing, 12, true, true, 103_000, 120));
  scaleIs('blessing: quality lock remains at full scale', blessing, 1);
}

run();
if (failures > 0) process.exitCode = 1;
