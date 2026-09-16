/**
 * Scenario table for the corridor planner.
 *
 * The planner is a pure function, so the interesting cases — a stone in the lane
 * with oncoming traffic close, the same stone with the road clear, a trunk on the
 * verge, a wall across everything — are a table rather than a ten-minute drive
 * with twenty cars and a hope. Run with `bun tools/corridor-bench.ts`.
 */

import { evaluateCorridorLine, planCorridor, type CorridorObstacle, type CorridorRequest } from '../src/vehicle/corridor';
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
    crossingSpeed: 25,
    manoeuvreFloorSpeed: 3.5,
    halfWidth: CAR_HALF_WIDTH_M,
    horizon: 200,
    // The manoeuvre's share of a dry-asphalt cornering budget, as `drive` computes it.
    lineAccel: 2.2,
    asphaltLimit: ROAD_HALF_WIDTH,
    edgeLimit: STATIC_AVOID_LINE_M,
    mayCrossCrown: true,
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
  mayCrossCrown: false,
});
check(
  'a driver that does not overtake queues instead',
  !noOvertake.usesOncomingLane && noOvertake.blockDistance === 60,
  `line ${noOvertake.line.toFixed(2)}`,
);

const wreck = planCorridor({
  ...request({ obstacles: [car(50, LANE, 0)] }),
  oncomingLaneCost: Number.POSITIVE_INFINITY,
  mayCrossCrown: false,
});
check(
  'a stopped car with no overtake is passed on the shoulder',
  wreck.usesShoulder && wreck.line < LANE,
  `line ${wreck.line.toFixed(2)}`,
);


const near = planCorridor({ ...request({ obstacles: [prop(2, -2.3, 2.0)] }), speed: 4 });
check(
  'a trunk too close to swerve round is a block, not a line',
  near.blockDistance === 2 && !near.feasible,
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

// Hard permission cannot lose to feasibility, even when an old caller still assigns
// Infinity as the crossing preference. Every own-side line here contains the wall.
const crownRequest = request({
  ownLateral: -2,
  previousLine: -2,
  laneOffset: -2,
  speed: 0,
  halfWidth: 1,
  asphaltLimit: 5,
  edgeLimit: 4,
  stopRoom: 20,
  obstacles: [prop(10, -2, 2)],
  oncomingLaneCost: Number.POSITIVE_INFINITY,
  mayCrossCrown: false,
});
const forbiddenCrossing = planCorridor(crownRequest);
const permittedCrossing = planCorridor({ ...crownRequest, mayCrossCrown: true });
check(
  'a forbidden crossing cannot beat a blocked permitted line',
  forbiddenCrossing.admissible && !forbiddenCrossing.feasible
    && !forbiddenCrossing.usesOncomingLane && forbiddenCrossing.blockDistance === 10
    && permittedCrossing.admissible && permittedCrossing.feasible && permittedCrossing.usesOncomingLane,
  `forbidden ${forbiddenCrossing.line}, feasible=${forbiddenCrossing.feasible}; permitted ${permittedCrossing.line}`,
);

const infinitePreference = planCorridor({
  ...crownRequest,
  mayCrossCrown: true,
  lineAllowed: (line) => line >= 1,
  obstacles: [prop(10, 4, 0.5)],
});
check(
  'an infinite-price feasible candidate is not overwritten by a blocked one',
  infinitePreference.admissible && infinitePreference.feasible
    && infinitePreference.line <= 2.5 && infinitePreference.blockDistance === Number.POSITIVE_INFINITY,
  `line ${infinitePreference.line}, feasible=${infinitePreference.feasible}, block ${infinitePreference.blockDistance}`,
);

// The predicate describes the whole transition: the unsafe adjacent band also bars
// destinations beyond it, whether proposed as lane centres or avoidance lattice points.
const bandRequest = request({
  ownLateral: -2,
  previousLine: -2,
  laneOffset: -2,
  laneCentres: [-2, -4, -6],
  speed: 0,
  halfWidth: 1,
  asphaltLimit: 8,
  edgeLimit: 7,
  stopRoom: 30,
  mayCrossCrown: false,
  obstacles: [prop(20, -1, 3)],
});
const freeBand = planCorridor(bandRequest);
const closedBandRequest = { ...bandRequest, lineAllowed: (line: number) => line >= -3 };
const closedBand = planCorridor(closedBandRequest);
check(
  'a closed adjacent band cannot be bypassed through the lattice or farther lane',
  freeBand.feasible && freeBand.line <= -5
    && closedBand.admissible && !closedBand.feasible && closedBand.line >= -3
    && !evaluateCorridorLine(closedBandRequest, -4.25).admissible
    && !evaluateCorridorLine(closedBandRequest, -6).admissible,
  `open ${freeBand.line}; closed ${closedBand.line}, block ${closedBand.blockDistance}`,
);
const nowhere = planCorridor({ ...bandRequest, lineAllowed: () => false });
check(
  'a search with no permitted candidate reports the occupied line, not a clear route',
  !nowhere.admissible && !nowhere.feasible
    && nowhere.line === bandRequest.ownLateral && nowhere.blockDistance === 20,
  `line ${nowhere.line}, admissible=${nowhere.admissible}, block ${nowhere.blockDistance}`,
);

const heldRequest = request({
  ownLateral: -4,
  previousLine: -4,
  laneOffset: -2,
  speed: 0,
  halfWidth: 1,
  asphaltLimit: 8,
  edgeLimit: 7,
  stopRoom: 40,
  mayCrossCrown: false,
  obstacles: [prop(25, -4, 0.5)],
});
const freeProposal = planCorridor(heldRequest);
const held = evaluateCorridorLine(heldRequest, -4);
const occupiedByTraffic = evaluateCorridorLine({
  ...heldRequest,
  obstacles: [{ ...prop(25, -4, 0.5), movable: true }],
}, -4);
check(
  'a held line keeps its own obstacle metrics when the new proposal is free',
  freeProposal.admissible && freeProposal.feasible && freeProposal.blockDistance === Number.POSITIVE_INFINITY
    && held.admissible && !held.feasible && held.line === -4 && held.blockDistance === 25 && held.blockSpeed === 0,
  `proposal ${freeProposal.line}, block ${freeProposal.blockDistance}; held block ${held.blockDistance}`,
);
check(
  'an occupied traffic corridor is admissible and feasible, unlike a static block',
  occupiedByTraffic.admissible && occupiedByTraffic.feasible
    && occupiedByTraffic.blockDistance === 25 && occupiedByTraffic.blockSpeed === 0,
  `admissible=${occupiedByTraffic.admissible}, feasible=${occupiedByTraffic.feasible}, block ${occupiedByTraffic.blockDistance}`,
);
const sweptHeld = evaluateCorridorLine({
  ...heldRequest,
  ownLateral: -2,
  speed: 20,
  obstacles: [prop(5, -2, 0.5)],
}, -6);
check(
  'fixed-line evaluation checks the swept transition, not only its clear destination',
  sweptHeld.admissible && !sweptHeld.feasible && sweptHeld.blockDistance === 5,
  `line ${sweptHeld.line}, block ${sweptHeld.blockDistance}`,
);
const crossingRequest = request({
  ownLateral: -2,
  laneOffset: -2,
  halfWidth: 1,
  asphaltLimit: 6,
  edgeLimit: 5,
  obstacles: [car(30, -2, 20), car(100, -2, 5)],
  oncomingGap: 200,
});
const crossing = evaluateCorridorLine(crossingRequest, 2);
const refused = evaluateCorridorLine({ ...crossingRequest, oncomingGap: 100 }, 2);
check(
  'crossing timing uses the slowest own-lane body, while headway uses the nearest',
  crossing.admissible && crossing.feasible && crossing.usesOncomingLane
    && crossing.laneBlockDistance === 30 && crossing.laneBlockSpeed === 20,
  `admissible=${crossing.admissible}, leader ${crossing.laneBlockDistance} m at ${crossing.laneBlockSpeed} m/s`,
);
check(
  'fixed-line evaluation rejects a crossing without enough oncoming room',
  !refused.admissible && !refused.feasible && refused.crossingRefused && refused.waitingForOncoming,
  `admissible=${refused.admissible}, refused=${refused.crossingRefused}`,
);

// A lateral deadline belongs to the candidate, not the line held last step. The
// wider move must finish in the same closing room and therefore permits less speed.
const manoeuvreRequest = request({
  ownLateral: -2,
  previousLine: -2,
  laneOffset: -2,
  speed: 0,
  halfWidth: 1,
  lineAccel: 2,
  asphaltLimit: 10,
  edgeLimit: 9,
  obstacles: [prop(20, -2, 1)],
});
const shortMove = evaluateCorridorLine(manoeuvreRequest, 1);
const wideMove = evaluateCorridorLine(manoeuvreRequest, 7);
const alreadyClear = evaluateCorridorLine({ ...manoeuvreRequest, ownLateral: 1 }, 7);
check(
  'each candidate owns its manoeuvre speed and an already-clear band has no deadline',
  shortMove.admissible && wideMove.admissible && alreadyClear.admissible
    && Math.abs(shortMove.manoeuvreSpeed - 10 * Math.sqrt(2 / 3)) < 1e-10
    && Math.abs(wideMove.manoeuvreSpeed - 10 * Math.sqrt(2 / 9)) < 1e-10
    && alreadyClear.manoeuvreSpeed === Number.POSITIVE_INFINITY,
  `short ${shortMove.manoeuvreSpeed}, wide ${wideMove.manoeuvreSpeed}, clear ${alreadyClear.manoeuvreSpeed}`,
);

// The oncoming car is closer to the shared obstruction than we are, so the
// bottleneck priority exception cannot mask the crossing's own timing requirement.
const squeezeCrossingRequest = {
  ...manoeuvreRequest,
  speed: 5,
  lineAccel: 0.6,
  obstacles: [prop(120, -2, 1)],
  oncomingGap: 235,
};
const pendingCrossing = evaluateCorridorLine(squeezeCrossingRequest, 7);
const clearCrossing = evaluateCorridorLine({ ...squeezeCrossingRequest, ownLateral: 7 }, 7);
check(
  'oncoming room rejects the slow pending crossing but permits the already-clear pass',
  !pendingCrossing.admissible && pendingCrossing.crossingRefused
    && pendingCrossing.manoeuvreSpeed < squeezeCrossingRequest.crossingSpeed
    && pendingCrossing.blockDistance === Number.POSITIVE_INFINITY
    && clearCrossing.admissible && clearCrossing.feasible && !clearCrossing.crossingRefused
    && clearCrossing.manoeuvreSpeed === Number.POSITIVE_INFINITY,
  `pending ${pendingCrossing.manoeuvreSpeed} m/s, refused=${pendingCrossing.crossingRefused}; clear admissible=${clearCrossing.admissible}`,
);

console.log(failures === 0 ? '\nall corridor checks passed' : `\n${failures} corridor check(s) FAILED`);
if (failures) process.exitCode = 1;
