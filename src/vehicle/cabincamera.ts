/**
 * The cabin camera's eye per car model and seat.
 *
 * The driver's eye is the kit's own seat (`CarModelMeasure.cabinEye`, from the cushion and
 * a seated eye height, see carkit/interior.ts), or the bonnet mount on a body that has no
 * seat. The front passenger's is the driver's mirrored across the car. The rear seats'
 * come from the bench the same way (`CarModelMeasure.rearEye`, the left one; the right is
 * its mirror). A front bench's middle place has its own, on the centre line
 * (`CarModelMeasure.middleEye`), else the driver's moved onto it.
 * All in chassis-local metres: +X the car's left, +Y up, +Z forward.
 */

import type { PlayerSeat } from '../game/state';
import { carModelMeasure } from '../render/carmodel';

type Eye = readonly [number, number, number];

export class CabinCamera {
  private readonly seatEye: [number, number, number] = [0, 0, 0];

  /** The eye the cabin view uses for `seat` in `modelId`; see the notes above. */
  eyeFor(modelId: string, seat: PlayerSeat): Eye {
    if (seat === 'driver') return driverEye(modelId);
    if (seat === 'middle') {
      const middle = carModelMeasure(modelId).middleEye;
      if (middle) return middle;
    }
    const front = seat === 'passenger' || seat === 'middle';
    const from = front ? driverEye(modelId) : carModelMeasure(modelId).rearEye ?? driverEye(modelId);
    // Mirrored for the right-hand seats, into one scratch: the view reads it every frame.
    const mirror = seat === 'passenger' || seat === 'rear-right';
    this.seatEye[0] = seat === 'middle' ? 0 : mirror ? -from[0] : from[0];
    this.seatEye[1] = from[1];
    this.seatEye[2] = from[2];
    return this.seatEye;
  }
}

/** The driver's eye for `modelId`: the kit seat, else the bonnet mount. */
function driverEye(modelId: string): Eye {
  const measure = carModelMeasure(modelId);
  return measure.cabinEye ?? measure.hoodPoint;
}
