import { Road, type RoadProjection, type RoadSample } from '../world/road';
import { CIRCUIT_HALF_WIDTH, PlaygroundCircuit } from './circuit';

/**
 * The playground circuit, wearing the road's interface.
 *
 * `Vehicle`, `Autopilot`, `roadSurfaceY` and the hazard index all talk to the road
 * through four geometric questions — where is the centreline at `s`, what is the
 * curvature there, where am I relative to it, and where is a point `lateral` metres
 * to the side. This subclass answers those from a closed lap instead of the world's
 * 40 000 km line, and overrides NOTHING else: `world/road.ts` and
 * `world/roadspine.ts` are not modified, and the real world never sees this class.
 *
 * Subclassing rather than a parallel interface is deliberate. The consumers are
 * typed against `Road`, whose private spine tables make it nominal, so a structural
 * twin could not be passed to them — and changing their signatures to accept a
 * "road-like" thing would spread a test-only abstraction through the whole
 * simulation. Extending it keeps the fiction where it belongs: in this folder.
 *
 * The base constructor is given the same seed, so the inherited `landscape` is the
 * one under the lap and inherited helpers like `hillinessAt` keep working. Nothing
 * here ever touches `spine`, so the 10 million node walk is never triggered.
 */
export class PlaygroundRoad extends Road {
  readonly circuit: PlaygroundCircuit;
  /**
   * One lap, metres.
   *
   * Kept separate from the inherited `length`, which is typed as the world road's
   * exact 40 000 km and is therefore not overridable. Nothing in the driving path
   * reads it — `sampleAt` wraps, so an arclength past the finish line is simply the
   * next lap — and leaving it alone means no consumer typed against `Road` has to
   * learn that a road might be short.
   */
  readonly lapLength: number;

  constructor(seed: number, originX = 0, originZ = 0) {
    super(seed);
    this.circuit = new PlaygroundCircuit(seed, originX, originZ);
    this.lapLength = this.circuit.length;
  }

  override sampleAt(s: number): RoadSample {
    return this.circuit.sampleAt(s);
  }

  override curvatureAt(s: number): number {
    return this.circuit.sampleAt(s).curvature;
  }

  override project(x: number, z: number, hintS?: number): RoadProjection {
    return this.circuit.project(x, z, hintS);
  }

  /**
   * The circuit is ONE fixed-width lap. The world road's widenings are a function of
   * world arclength (`roadprofile.ts`), and a lap's `s` is not that: inherited, the
   * bench would randomly claim two lanes on a ribbon that is 5.8 m wide from end to
   * end and put the autopilot's lane targets off the asphalt.
   */
  override halfWidthAt(): number {
    return CIRCUIT_HALF_WIDTH;
  }

  override lanesPerSideAt(): number {
    return 1;
  }
}
