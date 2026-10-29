/**
 * THE PEDAL LEVER: throttle and brake on two switches (the keyboard's W and S, the
 * mouse's buttons while mouse driving), the throttle as a lever with notches, like a
 * train's controller, and the brake as a pedal held by its key.
 *
 *     notch   4  3  2  1      0          −1
 *     pedal   throttle 80/60/40/20 %   nothing   brake, while the key is held
 *
 * A held key used to be a floored pedal 0.7 s in, so cruising on part throttle meant
 * tapping for ever. Taps now set a CRUISE the lever holds between presses, and a hold is
 * the plain pedal it always was:
 *
 *  - A TAP of the throttle key (under `LONG_PRESS_S`) moves the lever one notch up, and
 *    from neutral or the brake straight to notch 1. The pedal travels to the new notch
 *    gently (`NOTCH_RATE_PER_S`), starting the moment the key goes down.
 *  - HELD past `LONG_PRESS_S` it is the plain pedal: it heads for the floor for as long
 *    as it is held (kickdown), the cruise is cancelled, and let go the pedal comes off at
 *    once and the lever is in neutral.
 *  - A PRESS of the brake key on a throttle notch moves the lever one notch down: that
 *    is lifting off, not braking. In neutral, or held past `BRAKE_HOLD_S` from any notch,
 *    it is the BRAKE (−1): the throttle goes to 0 and stays there, and the brake pedal
 *    goes down to the car's threshold pedal — the hardest stop that still rolls the
 *    wheels (`Vehicle.thresholdBrakePedal`, `setBrakeKnee`) — in `BRAKE_KNEE_S`, as the
 *    keyboard brake always did. Let go, the brake comes off and the lever is in neutral.
 *  - A BRAKE EXCLUDES THROTTLE: after it the throttle is 0 until the throttle key is
 *    pressed again. Stepping down through the throttle notches is only lifting off; a
 *    car that stalls on a hill under throttle still pulls away.
 *  - REVERSE (the automatic's, at rest) is asked for only while the brake key is HELD
 *    long, never by a tap: the brake pedal is then the reverse throttle, as before.
 *
 * Both keys at once: the brake wins.
 */
export const THROTTLE_NOTCHES = [0.2, 0.4, 0.6, 0.8] as const;
/** The brake notch, and the top throttle notch. */
export const LEVER_MIN = -1;
export const LEVER_MAX = THROTTLE_NOTCHES.length;
/** Seconds the throttle key must be held to stop being a press and kick down. */
export const LONG_PRESS_S = 0.11;
/** Seconds the brake key must be held on a throttle notch to stop lifting and brake. */
export const BRAKE_HOLD_S = 0.11;
/** Pedal travel per second between notches: one throttle notch in 0.2 s. */
export const NOTCH_RATE_PER_S = 1;
/** Throttle travel per second towards the floor while the key is held. */
export const KICKDOWN_RATE_PER_S = 3;
/** Seconds for the brake pedal to reach the threshold pedal from off. */
export const BRAKE_KNEE_S = 0.1;
/** Either pedal coming off, per second. */
export const RELEASE_RATE_PER_S = 12;

export class PedalLever {
  /** −1..4: see the table above. */
  notch = 0;
  throttle = 0;
  brake = 0;
  /** The brake pedal's ceiling: the driven car's threshold pedal (`step`'s `knee`). */
  knee = 1;
  /** The automatic's reverse request: the brake key held long. */
  reverse = false;
  private throttleHeldS = -1;
  private brakeHeldS = -1;
  /** The throttle key has been held (and the pedal not yet off since): the plain pedal. */
  private pedalling = false;
  /** This press of the brake key is a brake, not a lift. */
  private braking = false;

  /** Back to neutral with both pedals off, at once: a new seat, a lost focus. */
  reset(): void {
    this.notch = 0;
    this.throttle = 0;
    this.brake = 0;
    this.reverse = false;
    this.throttleHeldS = -1;
    this.brakeHeldS = -1;
    this.braking = false;
    this.pedalling = false;
  }

  /**
   * `knee` is the brake pedal's ceiling, the driven car's threshold pedal. `plain` drops
   * the cruise (a race, race/director.ts): every press is a hold from its first frame, so
   * the throttle key heads for the floor and the brake key brakes, and no notch is set.
   */
  step(throttleKey: boolean, brakeKey: boolean, dt: number, knee: number, plain = false): void {
    this.knee = knee;
    if (brakeKey) {
      if (this.brakeHeldS < 0) {
        // The press: a lift on a throttle notch, the brake in neutral.
        this.brakeHeldS = plain ? BRAKE_HOLD_S : 0;
        if (this.notch > 0 && !plain) this.notch -= 1;
        else this.braking = true;
      } else {
        this.brakeHeldS += dt;
      }
      if (this.brakeHeldS >= BRAKE_HOLD_S) this.braking = true;
    } else {
      this.brakeHeldS = -1;
      this.braking = false;
    }
    if (this.braking) this.notch = LEVER_MIN;
    else if (this.notch === LEVER_MIN || plain) this.notch = 0;

    if (throttleKey && !brakeKey) {
      if (this.throttleHeldS < 0) {
        this.throttleHeldS = plain ? LONG_PRESS_S : 0;
        if (!plain) this.notch = this.notch < 1 ? 1 : Math.min(LEVER_MAX, this.notch + 1);
      } else {
        this.throttleHeldS += dt;
      }
    } else {
      this.throttleHeldS = -1;
    }
    const kickdown = this.throttleHeldS >= LONG_PRESS_S;
    this.reverse = this.braking && this.brakeHeldS >= BRAKE_HOLD_S;
    // A hold cancels the cruise: the pedal is the key's, and let go it is off.
    if (kickdown) {
      this.notch = 0;
      this.pedalling = true;
    }

    const throttleWant = kickdown ? 1 : this.notch > 0 ? THROTTLE_NOTCHES[this.notch - 1]! : 0;
    const brakeWant = this.braking ? knee : 0;

    // The throttle: gently between notches; quickly towards the floor while held, and
    // off at once when the held key comes up or the brake goes on.
    const throttleRate = this.braking
      ? RELEASE_RATE_PER_S
      : kickdown
        ? KICKDOWN_RATE_PER_S
        : this.pedalling
          ? RELEASE_RATE_PER_S
          : NOTCH_RATE_PER_S;
    this.throttle = approach(this.throttle, throttleWant, throttleRate * dt);
    if (!kickdown && this.throttle === throttleWant) this.pedalling = false;
    const brakeRate = brakeWant > this.brake ? knee / BRAKE_KNEE_S : RELEASE_RATE_PER_S;
    this.brake = approach(this.brake, brakeWant, brakeRate * dt);
  }
}

function approach(value: number, target: number, maxStep: number): number {
  return value < target ? Math.min(target, value + maxStep) : Math.max(target, value - maxStep);
}
