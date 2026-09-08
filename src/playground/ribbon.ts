import type { PhysicsWorld } from '../core/physics';
import { SurfaceType } from '../core/surfaces';
import { CIRCUIT_HALF_WIDTH, type PlaygroundCircuit } from './circuit';
import type { PlaygroundRoad } from './playgroundroad';

/**
 * The circuit as a driveable surface: one closed ribbon of asphalt.
 *
 * Shared by the headless lap bench and the dev scene so the thing you watch is the
 * thing that was measured. Three properties of it are load-bearing, and every one
 * was learned by having the car fired into the air on the start line:
 *
 *  - THE SEAM IS STITCHED BY INDEX, and the row step is the lap divided by the row
 *    count, so the closing quad is an ordinary quad. Repeating the first row gives
 *    two coincident rows and degenerate triangles; a 1 m step that does not divide
 *    the lap leaves the closing quad spanning a gap.
 *  - HEIGHTS COME FROM `circuit.surfaceY`, never from the road's `roadSurfaceY`. The
 *    road's surface noise is a function of arclength along a line with no period, so
 *    on a lap it does not meet itself: the seam arrived 10 cm out of step, which is a
 *    hammer blow to a raycast suspension.
 *  - THE SHOULDER IS ROAD, NOT TERRAIN. The verge the autopilot is allowed to use
 *    continues the road surface rather than following the landscape, which at the
 *    hairpin exit puts a 0.6 m ledge across the ribbon.
 */

/** Solid ground a little past the asphalt, matching the autopilot's verge allowance. */
export const RIBBON_HALF_WIDTH = CIRCUIT_HALF_WIDTH + 3;
/**
 * How far the sand shelf reaches beyond the verge.
 *
 * Without it the lap is a viaduct: on the flat first site nothing ever left the
 * ribbon, but the moment the circuit had real gradients a car that ran wide fell
 * off the world and slid 489 m down the hill. The game has desert flush with the
 * asphalt everywhere, so the playground has a shelf — level with the road edge,
 * because a test track wants a recoverable excursion, not a second terrain system.
 */
const APRON_WIDTH = 45;
const RIBBON_STEP = 1;

export interface CircuitRibbon {
  readonly vertices: Float32Array;
  readonly indices: Uint32Array;
  /** Rows in the strip; two vertices each, inner then outer. */
  readonly rows: number;
  /** Arclength between rows, metres. Exactly divides the lap. */
  readonly step: number;
}

/**
 * One closed strip between two lateral offsets. Signs are kept as given, so a strip
 * from -45 to -5.9 is the left shelf and one from -5.9 to +5.9 is the road.
 */
export function buildCircuitRibbon(
  road: PlaygroundRoad,
  circuit: PlaygroundCircuit,
  innerLateral = -RIBBON_HALF_WIDTH,
  outerLateral = RIBBON_HALF_WIDTH,
): CircuitRibbon {
  const rows = Math.round(circuit.length / RIBBON_STEP);
  const step = circuit.length / rows;
  const vertices = new Float32Array(rows * 6);
  const point = { x: 0, y: 0, z: 0 };
  for (let row = 0; row < rows; row++) {
    const s = row * step;
    for (let side = 0; side < 2; side++) {
      const lateral = side === 0 ? innerLateral : outerLateral;
      road.offsetPoint(s, lateral, point);
      const i = (row * 2 + side) * 3;
      vertices[i] = point.x;
      vertices[i + 1] = circuit.surfaceY(s, lateral);
      vertices[i + 2] = point.z;
    }
  }
  const indices = new Uint32Array(rows * 6);
  for (let row = 0, i = 0; row < rows; row++) {
    const a = row * 2;
    const b = ((row + 1) % rows) * 2;
    indices[i++] = a;
    indices[i++] = b;
    indices[i++] = a + 1;
    indices[i++] = b;
    indices[i++] = b + 1;
    indices[i++] = a + 1;
  }
  return { vertices, indices, rows, step };
}

/** The lateral spans of the road and its two shelves, inner to outer. */
export const CIRCUIT_STRIPS: readonly {
  readonly inner: number;
  readonly outer: number;
  readonly surface: SurfaceType;
}[] = [
  { inner: -RIBBON_HALF_WIDTH, outer: RIBBON_HALF_WIDTH, surface: SurfaceType.Asphalt },
  { inner: -RIBBON_HALF_WIDTH - APRON_WIDTH, outer: -RIBBON_HALF_WIDTH, surface: SurfaceType.Sand },
  { inner: RIBBON_HALF_WIDTH, outer: RIBBON_HALF_WIDTH + APRON_WIDTH, surface: SurfaceType.Sand },
];

/** Road plus shelves as colliders, each with its own surface. */
export function addCircuitCollider(
  physics: PhysicsWorld,
  road: PlaygroundRoad,
  circuit: PlaygroundCircuit,
): void {
  for (const strip of CIRCUIT_STRIPS) {
    const ribbon = buildCircuitRibbon(road, circuit, strip.inner, strip.outer);
    physics.addStaticTrimesh(ribbon.vertices, ribbon.indices, strip.surface);
  }
}
