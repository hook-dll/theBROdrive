/**
 * THE PEDAL LEVER: throttle and brake on two switches (the keyboard's W and S, the
 * mouse's buttons while mouse driving), as a lever with notches, like a train's
 * controller, rather than as two pedals a key can only hold to the floor.
 *
 *     notch   4  3  2  1      0         −1             −2
 *     pedal   throttle 80/60/40/20 %   nothing   gentle brake   full brake
 *
 * A held key used to be a floored pedal 0.7 s in, so cruising on part throttle meant
 * tapping for ever. The lever holds a pedal of its own between presses:
 *
 *  - A PRESS of the throttle key moves the lever one notch up, and from any brake notch
 *    straight to notch 1: the brake comes off at once. A press of the brake key moves it
 *    one notch down; from 0 that is the gentle brake. The pedal travels to the new notch
 *    gently (`NOTCH_RATE_PER_S`), starting the moment the key goes down.
 *  - HELD past `LONG_PRESS_S` the throttle key floors the pedal for as long as it is held
 *    (kickdown), and let go it eases back to its notch; the brake key drops the lever to
 *    full brake, which stays. The quarter second before the hard stop is a driver's own
 *    reaction time, and the gentle brake is already on during it.
 *  - A BRAKE EXCLUDES THROTTLE: once the lever is in a brake notch the throttle is 0
 *    until the throttle key is pressed again. Stepping down through the throttle notches
 *    is only lifting off; a car that stalls on a hill under throttle still pulls away.
 *  - REVERSE (the automatic's, at rest) is asked for only while the brake key is HELD
 *    long, never by a tap: the brake pedal is then the reverse throttle, as before.
 *
 * Both keys at once: the brake wins.
 */
export const THROTTLE_NOTCHES = [0.2, 0.4, 0.6, 0.8] as const;
/** The lowest and highest notch: full brake, and the top throttle notch. */
export const LEVER_MIN = -2;
export const LEVER_MAX = THROTTLE_NOTCHES.length;
/** The gentle brake's pedal (notch −1), and the full brake's (notch −2). */
export const GENTLE_BRAKE = 0.3;
export const FULL_BRAKE = 1;
/** Seconds a key must be held to stop being a press and become a hold. */
export const LONG_PRESS_S = 0.25;
/** Pedal travel per second between notches: one throttle notch in 0.2 s. */
export const NOTCH_RATE_PER_S = 1;
/** Throttle travel per second while kicking down, and back to the notch after. */
export const KICKDOWN_RATE_PER_S = 3;
/** Brake travel per second onto the gentle brake, and on to the full one. */
export const BRAKE_RATE_PER_S = 3;
/** Either pedal coming off because the other one was asked for, per second. */
export const RELEASE_RATE_PER_S = 12;

export class PedalLever {
  /** −2..4: see the table above. */
  notch = 0;
  throttle = 0;
  brake = 0;
  /** The automatic's reverse request: the brake key held long. */
  reverse = false;
  private throttleHeldS = -1;
  private brakeHeldS = -1;

  /** Back to neutral with both pedals off, at once: a new seat, a lost focus. */
  reset(): void {
    this.notch = 0;
    this.throttle = 0;
    this.brake = 0;
    this.reverse = false;
    this.throttleHeldS = -1;
    this.brakeHeldS = -1;
  }

  step(throttleKey: boolean, brakeKey: boolean, dt: number): void {
    // Press edges move the lever; holding past the long press is counted from them.
    if (brakeKey) {
      if (this.brakeHeldS < 0) {
        this.brakeHeldS = 0;
        this.notch = Math.max(LEVER_MIN, this.notch - 1);
      } else {
        this.brakeHeldS += dt;
      }
    } else {
      this.brakeHeldS = -1;
    }
    if (throttleKey && !brakeKey) {
      if (this.throttleHeldS < 0) {
        this.throttleHeldS = 0;
        this.notch = this.notch < 1 ? 1 : Math.min(LEVER_MAX, this.notch + 1);
      } else {
        this.throttleHeldS += dt;
      }
    } else {
      this.throttleHeldS = -1;
    }
    const brakeLong = this.brakeHeldS >= LONG_PRESS_S;
    const kickdown = this.throttleHeldS >= LONG_PRESS_S;
    if (brakeLong) this.notch = LEVER_MIN;
    this.reverse = brakeLong;

    const throttleWant = kickdown ? 1 : this.notch > 0 ? THROTTLE_NOTCHES[this.notch - 1]! : 0;
    const brakeWant = this.notch === -1 ? GENTLE_BRAKE : this.notch <= -2 ? FULL_BRAKE : 0;

    // The throttle: gently between notches, quickly to and from a kickdown, and off at
    // once under a brake.
    const throttleRate =
      brakeWant > 0
        ? RELEASE_RATE_PER_S
        : kickdown || this.throttle > THROTTLE_NOTCHES[LEVER_MAX - 1]!
          ? KICKDOWN_RATE_PER_S
          : NOTCH_RATE_PER_S;
    this.throttle = approach(this.throttle, throttleWant, throttleRate * dt);
    // The brake: on at its own speed, off at once when the throttle is asked for.
    const brakeRate = brakeWant >= this.brake ? BRAKE_RATE_PER_S : RELEASE_RATE_PER_S;
    this.brake = approach(this.brake, brakeWant, brakeRate * dt);
  }
}

function approach(value: number, target: number, maxStep: number): number {
  return value < target ? Math.min(target, value + maxStep) : Math.max(target, value - maxStep);
}
