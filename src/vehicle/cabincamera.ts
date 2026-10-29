/**
 * The cabin camera's eye per car model and seat.
 *
 * A kit car's seats are its own: the driver's eye is `CarModelMeasure.cabinEye`, every
 * other seat's is in `CarModelMeasure.seats` with the way the seat faces, each over its
 * cushion at a seated eye height (carkit/interior.ts `Cabin.eyes`). A body with no kit
 * cabin has only its bonnet mount, which every seat looks from, ahead.
 * All in chassis-local metres: +X the car's left, +Y up, +Z forward.
 */

import type { PlayerSeat } from '../game/state';
import type { CarModelMeasure, SeatMeasure } from '../render/carmodel';

/** The eye the cabin view uses for `seat` of a car `measure`d so; see the notes above. */
export function seatEye(measure: CarModelMeasure, seat: PlayerSeat): readonly [number, number, number] {
  return seatMeasure(measure, seat)?.eye ?? measure.cabinEye ?? measure.hoodPoint;
}

/**
 * The way `seat` faces, the cabin view's straight ahead: radians about the car's up axis
 * from its nose (π a rearward seat, -π/2 one on the left wall facing across).
 */
export function seatYaw(measure: CarModelMeasure, seat: PlayerSeat): number {
  return seatMeasure(measure, seat)?.yaw ?? 0;
}

function seatMeasure(measure: CarModelMeasure, seat: PlayerSeat): SeatMeasure | undefined {
  if (!measure.seats || seat === 'driver') return undefined;
  for (const measured of measure.seats) if (measured.seat === seat) return measured;
  return undefined;
}
