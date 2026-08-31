import { WorldWorkScheduler } from '../src/world/workqueue';

const BUDGET_MS = 3;
const FRAME_ID = 41;
const ROAD_TAG = 'road:chunk-42';
const DESERT_TAG = 'desert:tile-7,3';

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`world work: ${message}`);
}

/** Deliberately crosses the shared budget in one indivisible scheduler job. */
function spendAtLeast(ms: number): void {
  const deadline = performance.now() + ms;
  while (performance.now() < deadline) {
    // Reading the monotonic clock is intentional: elapsed time is the contract here.
  }
}

const startedAt = performance.now();
const scheduler = new WorldWorkScheduler(BUDGET_MS);

scheduler.setPending('road', true);
scheduler.setPending('desert', true);
expect(scheduler.hasPending, 'two pending owners were not aggregated');
scheduler.setPending('road', false);
expect(scheduler.hasPending, 'clearing road hid pending desert work');
scheduler.setPending('desert', false);
expect(!scheduler.hasPending, 'pending work remained after every owner cleared');

let roadRuns = 0;
let desertRuns = 0;
const roadRan = scheduler.tryRun(FRAME_ID, ROAD_TAG, () => {
  roadRuns++;
  spendAtLeast(BUDGET_MS + 2);
});
expect(roadRan && roadRuns === 1, 'the first road job did not run');
expect(scheduler.workedThisFrame, 'running road work did not mark the frame as worked');
expect(scheduler.lastJobTag === ROAD_TAG, 'road work did not publish its job tag');
expect(scheduler.frameWorkMs >= BUDGET_MS, `road work used only ${scheduler.frameWorkMs.toFixed(3)} ms`);

const consumedWorkMs = scheduler.frameWorkMs;
scheduler.beginFrame(FRAME_ID);
expect(scheduler.workedThisFrame, 'same-frame beginFrame reset workedThisFrame');
expect(scheduler.frameWorkMs === consumedWorkMs, 'same-frame beginFrame reset frameWorkMs');
expect(scheduler.lastJobTag === ROAD_TAG, 'same-frame beginFrame reset lastJobTag');

const desertRanSameFrame = scheduler.tryRun(FRAME_ID, DESERT_TAG, () => {
  desertRuns++;
});
expect(!desertRanSameFrame && desertRuns === 0, 'desert work bypassed road work\'s shared budget');
expect(scheduler.frameWorkMs === consumedWorkMs, 'a rejected job changed frame work telemetry');
expect(scheduler.lastJobTag === ROAD_TAG, 'a rejected job replaced the completed job tag');

scheduler.beginFrame(FRAME_ID + 1);
expect(!scheduler.workedThisFrame, 'a genuinely new frame did not reset workedThisFrame');
expect(scheduler.frameWorkMs === 0, 'a genuinely new frame did not reset frameWorkMs');
expect(scheduler.lastJobTag === null, 'a genuinely new frame did not reset lastJobTag');

const desertRanNextFrame = scheduler.tryRun(FRAME_ID + 1, DESERT_TAG, () => {
  desertRuns++;
});
expect(desertRanNextFrame && desertRuns === 1, 'desert work did not resume on the next frame');
expect(scheduler.workedThisFrame, 'next-frame desert work did not mark the frame as worked');
expect(scheduler.lastJobTag === DESERT_TAG, 'next-frame desert work did not replace the job tag');

scheduler.beginFrame(FRAME_ID + 1);
expect(scheduler.workedThisFrame, 'repeated next-frame beginFrame reset workedThisFrame');
expect(scheduler.lastJobTag === DESERT_TAG, 'repeated next-frame beginFrame reset lastJobTag');

console.log(
  `world work: ${roadRuns} road and ${desertRuns} desert jobs; ` +
    `road consumed ${consumedWorkMs.toFixed(3)} ms of a ${BUDGET_MS} ms shared budget; ` +
    `completed in ${(performance.now() - startedAt).toFixed(3)} ms`,
);
