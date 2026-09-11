/**
 * Scenario table for the corridor planner.
 *
 * The planner is a pure function, so the interesting cases — a stone in the lane
 * with oncoming traffic close, the same stone with the road clear, a trunk on the
 * verge, a wall across everything — are a table rather than a ten-minute drive
 * with twenty cars and a hope. Run with `bun tools/corridor-bench.ts`.
 */

import { planCorridor, type CorridorObstacle, type CorridorRequest } from '../src/vehicle/corridor';
import { ROAD_HALF_WIDTH } from '../src/world/road';

const CAR_HALF_WIDTH_M = 1.05;
const LANE = -ROAD_HALF_WIDTH / 2;
const STATIC_AVOID_LINE_M = ROAD_HALF_WIDTH + 4 - CAR_HALF_WIDTH_M;

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(52)} ${detail}`);
}

function request(overrides: Partial<CorridorRequest> = {}): CorridorRequest {
  return {
    ownLateral: LANE,
    previousLine: LANE,
    laneOffset: LANE,
    speed: 20,
    desiredSpeed: 25,
    halfWidth: CAR_HALF_WIDTH_M,
    horizon: 200,
    lineRatePerMetre: 0.09,
    asphaltLimit: ROAD_HALF_WIDTH,
    edgeLimit: STATIC_AVOID_LINE_M,
    oncomingLaneCost: 26,
    oncomingGap: Number.POSITIVE_INFINITY,
    oncomingSpeed: 20,
    stopRoom: 45,
    crossingRearClear: true,
    obstacles: [],
    ...overrides,
  };
}

function prop(s: number, lateral: number, halfWidth: number): CorridorObstacle {
  return { s, lateral, halfWidth, speed: 0 };
}
function car(s: number, lateral: number, speed: number): CorridorObstacle {
  return { s, lateral, halfWidth: CAR_HALF_WIDTH_M + 0.4, speed };
}

console.log('corridor planner: scenario table');

const clear = planCorridor(request());
check('clear road holds the lane', Math.abs(clear.line - LANE) < 0.01 && clear.feasible, `line ${clear.line.toFixed(2)}`);

const stone = planCorridor(request({ obstacles: [prop(120, -1.2, 0.9)] }));
check(
  'a stone in the lane is gone round, not braked for',
  Math.abs(stone.line - (-1.2)) > 1.9 && stone.feasible,
  `line ${stone.line.toFixed(2)}, block ${stone.blockDistance}`,
);

const pylon = planCorridor(request({ obstacles: [prop(120, -6.5, 1.2)] }));
check(
  'a pylon off the asphalt changes nothing',
  Math.abs(pylon.line - LANE) < 0.01,
  `line ${pylon.line.toFixed(2)}`,
);

const slowLead = planCorridor(request({ obstacles: [car(60, LANE, 14)] }));
check(
  'a slow car with a clear road is overtaken',
  slowLead.usesOncomingLane && slowLead.feasible,
  `line ${slowLead.line.toFixed(2)}`,
);

// Tucked into the leader's mirrors is exactly when a driver wants the other lane,
// and a lane change measured against our own travel (32 m) called that a certain
// collision: the car sat on the tail and followed it for good. Only the CLOSING
// distance is spent.
const tuckedIn = planCorridor(request({ obstacles: [car(28, LANE, 16)], speed: 17 }));
check(
  'a car already on the leader\u2019s tail still overtakes',
  tuckedIn.usesOncomingLane && tuckedIn.feasible,
  `line ${tuckedIn.line.toFixed(2)}`,
);

const oncomingClose = planCorridor({
  ...request({ obstacles: [car(60, LANE, 14)] }),
  oncomingGap: 120,
});
check(
  'the same car is followed when the oncoming lane is short',
  !oncomingClose.usesOncomingLane && oncomingClose.blockDistance === 60,
  `line ${oncomingClose.line.toFixed(2)}, block ${oncomingClose.blockDistance}`,
);

const noOvertake = planCorridor({
  ...request({ obstacles: [car(60, LANE, 14)] }),
  oncomingLaneCost: Number.POSITIVE_INFINITY,
});
check(
  'a driver that does not overtake queues instead',
  !noOvertake.usesOncomingLane && noOvertake.blockDistance === 60,
  `line ${noOvertake.line.toFixed(2)}`,
);

const wreck = planCorridor({
  ...request({ obstacles: [car(50, LANE, 0)] }),
  oncomingLaneCost: Number.POSITIVE_INFINITY,
});
check(
  'a stopped car with no overtake is passed on the shoulder',
  wreck.usesShoulder && wreck.line < LANE,
  `line ${wreck.line.toFixed(2)}`,
);

const trunk = planCorridor({ ...request({ obstacles: [prop(90, -2.3, 2.0)] }) });
check(
  'a trunk on the right edge is cleared on the right',
  trunk.line <= -2.3 - 2.0 - CAR_HALF_WIDTH_M + 0.3 && trunk.feasible,
  `line ${trunk.line.toFixed(2)}`,
);

const near = planCorridor({ ...request({ obstacles: [prop(12, -2.3, 2.0)] }), speed: 4 });
check(
  'a trunk too close to swerve round is a block, not a line',
  near.blockDistance === 12,
  `line ${near.line.toFixed(2)}, block ${near.blockDistance}`,
);

const wall = planCorridor({ ...request({ obstacles: [prop(30, 0, 6)] }), stopRoom: 40 });
check(
  'a wall across the road is not feasible',
  !wall.feasible && wall.blockDistance === 30,
  `line ${wall.line.toFixed(2)}, feasible=${wall.feasible}`,
);

const hysteresis = planCorridor(request({ previousLine: LANE - 0.2 }));
check(
  'the lane is not abandoned for a fifth of a metre',
  Math.abs(hysteresis.line - LANE) < 0.3,
  `line ${hysteresis.line.toFixed(2)}`,
);

console.log(failures === 0 ? '\nall corridor checks passed' : `\n${failures} corridor check(s) FAILED`);
if (failures) process.exitCode = 1;
