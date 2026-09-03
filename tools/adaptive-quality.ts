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
  noActions(`${label}: first 7 slow GPU samples`, samples(controller, 12, true, true, startMs, 7));
  equal(`${label}: 8th slow GPU sample`, controller.sample(12, true, true, startMs + 7), 'down');
}

function run(): void {
  const sustainedSlow = new AdaptiveResolutionController('standard');
  noActions('sustained slow load: 7 samples do not step down', samples(sustainedSlow, 12, true, true, 10_000, 7));
  equal(
    'sustained slow load: 8th sample steps down',
    sustainedSlow.sample(12, true, true, 10_007),
    'down',
  );
  scaleIs('standard slow load takes one conservative step', sustainedSlow, 0.85);

  const ineligibleReset = new AdaptiveResolutionController('standard');
  noActions('ineligible reset: partial slow streak has no action', samples(ineligibleReset, 12, true, true, 20_000, 4));
  equal('ineligible reset: excluded frame has no action', ineligibleReset.sample(12, false, true, 20_004), null);
  noActions('ineligible reset: next 7 samples restart the streak', samples(ineligibleReset, 12, true, true, 20_005, 7));
  equal('ineligible reset: restarted 8th sample steps down', ineligibleReset.sample(12, true, true, 20_012), 'down');

  const nullReset = new AdaptiveResolutionController('standard');
  noActions('null reset: partial slow streak has no action', samples(nullReset, 12, true, true, 30_000, 4));
  equal('null reset: unavailable GPU duration has no action', nullReset.sample(null, true, true, 30_004), null);
  noActions('null reset: next 7 samples restart the streak', samples(nullReset, 12, true, true, 30_005, 7));
  equal('null reset: restarted 8th sample steps down', nullReset.sample(12, true, true, 30_012), 'down');

  const cooldown = new AdaptiveResolutionController('acceptable');
  slowStep(cooldown, 40_000, 'cooldown: first sustained slow period');
  scaleIs('cooldown: initial slow period lowers acceptable scale', cooldown, 0.85);
  noActions('cooldown: immediate second sustained slow period is blocked', samples(cooldown, 12, true, true, 40_008, 8));
  scaleIs('cooldown: blocked period preserves scale', cooldown, 0.85);
  equal('cooldown: later eligible sample permits the pending reduction', cooldown.sample(12, true, true, 42_000), 'down');
  scaleIs('cooldown: elapsed cooldown permits another reduction', cooldown, 0.7224999999999999);

  const upscale = new AdaptiveResolutionController('standard');
  slowStep(upscale, 50_000, 'upscale: initial slow period');
  noActions('upscale: first 239 fast samples do not step up', samples(upscale, 6, true, true, 52_000, 239));
  equal('upscale: 240th fast sample steps up when allowed', upscale.sample(6, true, true, 52_239), 'up');
  scaleIs('upscale: one step applies the 1.03 factor', upscale, 0.8755);

  const driving = new AdaptiveResolutionController('standard');
  slowStep(driving, 60_000, 'driving: initial slow period');
  noActions('driving: 240 fast samples cannot upscale while active', samples(driving, 6, true, false, 62_000, 240));
  scaleIs('driving: active-driving policy preserves reduced scale', driving, 0.85);
  equal('driving: allowing upscale admits the sustained fast evidence', driving.sample(6, true, true, 62_240), 'up');

  const acceptableFloor = new AdaptiveResolutionController('acceptable');
  for (let step = 0; step < 6; step++) slowStep(acceptableFloor, 70_000 + step * 2_000, `acceptable floor: reduction ${step + 1}`);
  scaleIs('acceptable floor: repeated reductions clamp at 0.4', acceptableFloor, 0.4);
  noActions('acceptable floor: sustained overload cannot go below floor', samples(acceptableFloor, 12, true, true, 84_000, 8));

  const standardFloor = new AdaptiveResolutionController('standard');
  for (let step = 0; step < 4; step++) slowStep(standardFloor, 90_000 + step * 2_000, `standard floor: reduction ${step + 1}`);
  scaleIs('standard floor: repeated reductions clamp at 0.55', standardFloor, 0.55);

  const blessing = new AdaptiveResolutionController('blessing');
  slowStep(blessing, 100_000, 'blessing: sustained slow load');
  scaleIs('blessing: adaptive protection remains available', blessing, 0.85);
}

run();
if (failures > 0) process.exitCode = 1;
