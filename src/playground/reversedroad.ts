import type { RoadProjection, RoadSample } from '../world/road';
import { PlaygroundRoad } from './playgroundroad';

/**
 * The same lap, parameterised BACKWARDS. This is what makes oncoming traffic.
 *
 * `Autopilot` only ever drives toward increasing `s` on the road it was given, and
 * teaching it to drive a road in reverse would mean a direction flag threaded
 * through every geometric decision it makes — lane sign, curvature sign, hazard
 * ordering, lookahead. There is nothing to gain from that: a closed circuit walked
 * the other way IS a road, and one whose right-hand lane is the forward lap's left.
 *
 * So a car driving north on this view is physically driving south on the circuit,
 * holding its own lane, braking for its own corners, and meeting the forward
 * traffic head-on — with the shipped controller, unmodified. The mirror is exact:
 *
 *   s'        = L - s          (so `wrap(-s)` gives the forward arclength)
 *   heading'  = heading + π
 *   curvature'= -curvature     (dh'/ds' = -dh/ds)
 *   grade'    = -grade         (what climbs one way descends the other)
 *   lateral'  = -lateral       (left of travel is the other side of the road)
 *
 * `Road.offsetPoint` needs no override: heading + π flips both of its basis terms,
 * which is precisely the lateral negation above.
 */
export class ReversedPlaygroundRoad extends PlaygroundRoad {
  override sampleAt(s: number): RoadSample {
    const forward = this.circuit.sampleAt(this.circuit.wrap(-s));
    return {
      s: this.circuit.wrap(s),
      x: forward.x,
      y: forward.y,
      z: forward.z,
      heading: forward.heading + Math.PI,
      grade: -forward.grade,
      curvature: -forward.curvature,
    };
  }

  override curvatureAt(s: number): number {
    return -this.circuit.sampleAt(this.circuit.wrap(-s)).curvature;
  }

  override project(x: number, z: number, hintS?: number): RoadProjection {
    const forward = this.circuit.project(
      x,
      z,
      hintS === undefined ? undefined : this.circuit.wrap(-hintS),
    );
    return {
      s: this.circuit.wrap(-forward.s),
      lateral: -forward.lateral,
      height: forward.height,
    };
  }
}
