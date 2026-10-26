/**
 * The boy's gait: how far one step carries him and how much his head rises and falls
 * on it, both by ground speed. The camera's head bob (render/cameras.ts) runs one cycle
 * per step and the footstep audio (audio/foley.ts) sounds one step per step, so the two
 * keep the same cadence.
 *
 * A boy of about 1.3 m (eye at 1.10 m) takes short, quick steps: at the game's walk
 * (3.4 m/s, already a trot) about 1 m a step, 3.5 steps a second; at its sprint (6.2 m/s)
 * about 1.55 m, 4 a second; crouch-walking (1.5 m/s) 0.6 m, 2.5 a second.
 */

/** Metres of ground one step covers at `speedMps`. */
export function stepLength(speedMps: number): number {
  return 0.3 + 0.2 * speedMps;
}

/**
 * The head's rise and fall over one step at `speedMps`, metres from the middle: 2 cm at
 * the walk, a bouncier 4.5 cm at the sprint, never under 1 cm while moving.
 */
export function bobAmplitude(speedMps: number): number {
  return Math.max(0.01, 0.02 + (speedMps - 3.4) * (0.025 / 2.8));
}
