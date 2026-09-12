import type { DriveRoad, RoadProjection, RoadSample } from './road';
import type { RoadConditionBuffer } from './gradient';

/**
 * The finite world road viewed in the opposite driving direction.
 *
 * Its arclength increases while the base road's decreases. Heading turns by π,
 * grade and curvature change sign, and left/right lateral signs swap. Geometry is
 * never copied: every query delegates to the same authoritative road.
 */
export class ReversedRoad implements DriveRoad {
  readonly length: number;

  constructor(private readonly forward: DriveRoad) {
    this.length = forward.length;
  }
  conditionAt(s: number, out: RoadConditionBuffer): void {
    this.forward.conditionAt(this.forwardS(s), out);
  }


  sampleAt(s: number): RoadSample {
    const sample = this.forward.sampleAt(this.forwardS(s));
    return {
      s: this.reverseS(sample.s),
      x: sample.x,
      y: sample.y,
      z: sample.z,
      heading: sample.heading + Math.PI,
      grade: -sample.grade,
      curvature: -sample.curvature,
    };
  }

  curvatureAt(s: number): number {
    return -this.forward.curvatureAt(this.forwardS(s));
  }

  project(x: number, z: number, hintS?: number): RoadProjection {
    const projection = this.forward.project(
      x,
      z,
      hintS === undefined ? undefined : this.forwardS(hintS),
    );
    return {
      s: this.reverseS(projection.s),
      lateral: -projection.lateral,
      height: projection.height,
    };
  }

  offsetPoint(
    s: number,
    lateral: number,
    out?: { x: number; y: number; z: number },
  ): { x: number; y: number; z: number } {
    return this.forward.offsetPoint(this.forwardS(s), -lateral, out);
  }

  halfWidthAt(s: number): number {
    return this.forward.halfWidthAt(this.forwardS(s));
  }

  lanesPerSideAt(s: number): number {
    return this.forward.lanesPerSideAt(this.forwardS(s));
  }

  /**
   * THE SAME NUMBER AS THE FORWARD ROAD, NOT ITS NEGATION.
   *
   * Every lateral in this view is already mirrored — `project` negates what the
   * forward road reports and `offsetPoint` negates what it is given — so a lane
   * centre of -1.45 means "1.45 m right of MY travel" in whichever view asks for it.
   * Negating here put the oncoming stream on the forward stream's side of the crown:
   * traffic spawned into occupied lanes, and what did spawn drove at it head-on.
   */
  laneCentreAt(s: number, lane: number): number {
    return this.forward.laneCentreAt(this.forwardS(s), lane);
  }

  private forwardS(s: number): number {
    return Math.max(0, Math.min(this.length, this.length - s));
  }

  private reverseS(s: number): number {
    return this.length - s;
  }
}
