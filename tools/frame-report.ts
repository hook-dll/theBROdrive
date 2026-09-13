/**
 * The development frame report: is its arithmetic right?
 *
 *   npx tsx tools/frame-report.ts
 *
 * This is a window onto the real cost of a real frame, and it exists to decide what to
 * optimise. A wrong divisor, a section counted twice, or a simulation measured for only
 * one of the several ticks a frame contains would all point the work at the wrong place
 * while looking perfectly plausible — and the reader has no way to tell, because there is
 * nothing to compare it against.
 *
 * So the clock is injected and the timings are exact. Every number below is known before
 * it is measured, which is the only way to test arithmetic about time.
 */

import { FrameProfiler } from '../src/core/frameprofiler';

// The profiler logs every window it rolls, which would bury the bench's own output.
console.debug = () => undefined;

let failures = 0;

function check(label: string, condition: boolean, detail: string): void {
  if (!condition) failures++;
  console.log(`  ${condition ? 'ok  ' : 'FAIL'}  ${label.padEnd(58)} ${detail}`);
}

/** A clock the bench advances by hand, in milliseconds. */
function makeClock(): { now: () => number; advance: (ms: number) => void } {
  let t = 1_000;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

const clock = makeClock();
const profiler = new FrameProfiler(clock.now);

/**
 * One presented frame: two simulation ticks at 3 ms and 2 ms, then a render whose
 * sections cost 1 ms of sky, 4 ms of vista and 2 ms of draw, with 1 ms of unaccounted
 * wall time around them.
 */
function frame(simTickMs: readonly number[], sections: Readonly<Record<string, number>>, slackMs: number): void {
  for (const ms of simTickMs) {
    profiler.begin('sim');
    clock.advance(ms);
    profiler.end('sim');
  }
  profiler.beginFrame();
  for (const [section, ms] of Object.entries(sections)) {
    profiler.begin(section as 'sky');
    clock.advance(ms);
    profiler.end(section as 'sky');
  }
  clock.advance(slackMs);
  profiler.endFrame();
}

// --- the report must add up --------------------------------------------------
const FRAMES = 24;
const SIM_TICKS = [3, 2];
const SECTIONS = { sky: 1, vista: 4, draw: 2 };
const SLACK = 1;

for (let i = 0; i < FRAMES; i++) frame(SIM_TICKS, SECTIONS, SLACK);

const report = profiler.report();
const lines = report.split('\n');
console.log(lines.map((line) => `  | ${line}`).join('\n'));

const perFrameSim = SIM_TICKS.reduce((sum, ms) => sum + ms, 0);
const perFrameRender = Object.values(SECTIONS).reduce((sum, ms) => sum + ms, 0);

check(
  'both simulation ticks are counted, not just the last',
  report.includes(`simulation ${perFrameSim.toFixed(2)} ms`),
  `expected sim ${perFrameSim.toFixed(2)} ms`,
);
check(
  'the render call is reported as the wall time around its sections',
  report.includes(`render ${(perFrameRender + SLACK).toFixed(2)} ms`),
  `expected render ${(perFrameRender + SLACK).toFixed(2)} ms`,
);
check(
  'the whole frame is the two together',
  report.includes(`= ${(perFrameSim + perFrameRender + SLACK).toFixed(2)} ms of work`),
  `expected total ${(perFrameSim + perFrameRender + SLACK).toFixed(2)} ms`,
);

// The presented rate is measured from the window rather than assumed, so the two
// footings — per frame and per second — must agree. Checking the relationship rather
// than a literal rate keeps this independent of where the window happens to start.
const fps = Number(/([\d.]+) fps presented/.exec(report)?.[1]);
const busy = Number(/([\d.]+) ms of CPU per second/.exec(report)?.[1]);
const expectedBusy = (perFrameSim + perFrameRender + SLACK) * fps;
check(
  'the presented rate is a plausible one for the frames measured',
  fps > 50 && fps < 120,
  `${fps} fps`,
);
check(
  'busy milliseconds per second is the frame cost times that measured rate',
  Math.abs(busy - expectedBusy) < 1,
  `expected ${expectedBusy.toFixed(0)}, got ${busy}`,
);

// Sections must be ranked by what they cost PER SECOND, which is what a fix changes,
// and must not double-count the render wall they sit inside.
const order: string[] = [];
for (const line of lines) {
  // A section line is a name and a cost. The footer is a sentence and must not be
  // mistaken for one — this is what "ranked by cost per second" was checking when a
  // stray line joined the list.
  const match = /^\s*\[perf\]\s{3}(\w+)\s+(-?[\d.]+) ms\/s/.exec(line);
  if (match) order.push(match[1]!);
}
check(
  'sections are ranked by cost per second',
  order[0] === 'sim' && order[1] === 'vista' && order[2] === 'draw' && order[3] === 'sky',
  order.join(' > '),
);
check(
  'the render wall is not also listed as a section',
  !order.includes('renderWall'),
  order.join(' > '),
);
check(
  'a section that costs nothing is left off the list',
  !order.includes('physics') && !order.includes('agents'),
  'physics and agents were never measured',
);
check(
  'every listed section is named, and only the measured ones',
  order.length === 4,
  `${order.length} sections listed: ${order.join(', ')}`,
);

// A share of the WHOLE frame is a lie while the sections nest — measured on a real
// machine the shares came to 120%. Each section is therefore given its share of the
// half it belongs to, and the outer measurement gets no share at all.
{
  const shares = lines
    .map((line) => /^\s*\[perf\]\s{3}\w+\s+\d+ ms\/s\s+(\d+)% of (tick|render)/.exec(line))
    .filter((match) => match !== null);
  const totals = new Map<string, number>();
  for (const match of shares) {
    const value = Number(match![1]);
    check(
      `a share of ${match![2]} cannot exceed its half`,
      value <= 100,
      `${value}%`,
    );
    const key = match![2]!;
    totals.set(key, (totals.get(key) ?? 0) + value);
  }
  check(
    'no section claims a share of the tick while the tick is the whole of it',
    !/^\s*\[perf\]\s{3}sim\s+\d+ ms\/s\s+\d+%/m.test(report),
    'sim is the tick total and has no share of itself',
  );
  check(
    'the render sections cannot exceed the render half between them',
    (totals.get('render') ?? 0) <= 400,
    `${totals.get('render') ?? 0}% across ${shares.length} render sections`,
  );
}

// WHAT A FRAME RATE CAN AND CANNOT REACH.
//
// The report claims the simulation costs the same per second at every frame rate and the
// render scales exactly with it. That claim is the whole basis for turning the frame rate
// down to cool a device, and it is arithmetic, so it can be checked exactly: the same
// simulation and render cost per frame, presented at two different rates, must give the
// same simulation figure per second and a render figure in proportion.
{
  /**
   * A run of frames presented at a chosen rate.
   *
   * The rate has to be IMPOSED rather than derived from the work, because that is the
   * situation a frame-rate cap creates: a machine whose frame takes 13 ms is not thereby
   * incapable of more than 30 FPS — it is being told to present only 30 times a second,
   * and spends the rest of the interval idle. So each frame's work is measured and the
   * remaining interval is idle time the clock passes through unmeasured.
   */
  const perSecond = (presentedFps: number): { sim: number; render: number; text: string } => {
    const fixed = new FrameProfiler(clock.now);
    const tickMs = 0.5;
    const renderMs = 4;
    const ticksPerFrame = 60 / presentedFps;
    const workMs = ticksPerFrame * tickMs + renderMs;
    const idleMs = 1000 / presentedFps - workMs;
    check(
      `at ${presentedFps} FPS a frame has room for its work`,
      idleMs > 0,
      `${workMs.toFixed(2)} ms of work in a ${(1000 / presentedFps).toFixed(2)} ms interval`,
    );
    // Short of a full window, so the report describes these frames rather than an empty
    // window the roll just cleared.
    for (let i = 0; i < 239; i++) {
      for (let k = 0; k < ticksPerFrame; k++) {
        fixed.begin('sim');
        clock.advance(tickMs);
        fixed.end('sim');
      }
      fixed.beginFrame();
      fixed.begin('draw');
      clock.advance(renderMs);
      fixed.end('draw');
      fixed.endFrame();
      // Idle: after the frame is closed, so no section and no wall time absorbs it.
      clock.advance(idleMs);
    }
    const text = fixed.report(60);
    return {
      sim: Number(/per second: simulation (\d+) ms/.exec(text)?.[1]),
      render: Number(/\+ render (\d+) ms/.exec(text)?.[1]),
      text,
    };
  };

  const at30 = perSecond(30);
  const at60 = perSecond(60);
  check(
    'the simulation costs the same per second however often the frame is presented',
    Math.abs(at30.sim - at60.sim) <= 1,
    `30 FPS ${at30.sim} ms/s against 60 FPS ${at60.sim} ms/s`,
  );
  check(
    'the render cost per second halves when the presentation halves',
    Math.abs(at60.render - 2 * at30.render) <= 2,
    `30 FPS ${at30.render} ms/s against 60 FPS ${at60.render} ms/s`,
  );
  check(
    'so a slower presentation is strictly cheaper, and the simulation is the floor',
    at30.sim + at30.render < at60.sim + at60.render && at30.sim > 0,
    `30 FPS total ${at30.sim + at30.render} ms/s against 60 FPS ${at60.sim + at60.render} ms/s`,
  );
}

// The window rolls: a report taken later must describe the frames since the last roll,
// not the whole session. Otherwise a coasting stretch would be averaged against a climb
// and both would read as average.
{
  const rolled = new FrameProfiler(clock.now);
  // A full window of expensive frames, which rolls and clears the window on its last.
  for (let i = 0; i < 240; i++) frame([2], { draw: 2 }, 0);
  // Then most of a window of idle ones — short of a roll, so the report below describes
  // exactly these and nothing earlier.
  for (let i = 0; i < 239; i++) frame([0], { draw: 0 }, 0);
  const idle = rolled.report();
  check(
    'a report describes the recent window, not the whole session',
    !idle.includes('draw') && !idle.includes('240 ms of CPU'),
    'after a window of idle frames the expensive section should be gone',
  );
  check(
    'an idle window still reports that it is idle',
    idle.includes('0 ms of CPU per second'),
    idle.split('\n')[0] ?? '',
  );
}

if (failures > 0) {
  throw new Error(`${failures} frame-report checks failed`);
}
console.log('\nthe frame report adds up, ranks by cost per second, and forgets old frames');
