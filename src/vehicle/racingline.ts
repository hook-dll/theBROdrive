/**
 * THE RACING LINE: the least-curved path through the road that is free to use.
 *
 * A driver at the limit is not faster because it brakes later; it is faster because
 * it drives a bigger radius than the road has. Into a bend from the outside edge, to
 * the inside at the apex, out to the outside again: the same bend on a line whose
 * radius is larger than the road's, and the speed a radius allows goes as its square
 * root. Measured on a 60 m right-hander 50 m long with 4.6 m of road to use, the
 * line's sharpest curvature is 11.1 mrad/m against the road's 16.7 — a fifth more
 * speed for the same grip.
 *
 * WHAT IS SOLVED. Offsets `y` from the centreline at a fixed spacing `h` over a preview
 * window, each held inside a band `[lo, hi]` the caller supplies (its own lane, or the
 * whole asphalt where the opposing half is seen to be clear). The path's curvature is
 * the road's plus the offset's second derivative, `k = κ + y''`, and the line minimises
 * `Σ k²` — the textbook minimum-curvature line — plus a faint pull toward a HOME offset
 * so that on a straight, where every straight line is equally good, the car goes back
 * to its own lane instead of carrying the last apex's offset down the road.
 *
 * It is not the shortest path: a taut string through a bend WRAPS the inside edge
 * and keeps the edge's own curvature the whole way round, which gains nothing where
 * the speed is decided. Nor is it the least PEAK curvature: on a long bend (a 90 m
 * radius turning through 76 degrees) least squares still runs the apex along the
 * inside edge at the road's own curvature and spends its gain on the entry and exit.
 * Reweighting toward the peak was tried and made the solve jump between lines; this
 * is the line that is smooth and stable from one step to the next.
 *
 * HOW. The objective is quadratic and its Hessian is pentadiagonal, so an exact solve
 * is a banded LDLᵀ in O(n). The band limits are handled by an active set: solve with
 * the current set of offsets pinned to their limits, pin whatever still violates one,
 * release any pinned offset the solution pulls back inside, repeat. The first offset
 * is always pinned: it is the car. 0.06 ms a solve for a 600 m window.
 *
 * WHAT A DRIVER GETS BACK. The offset and its slope anywhere in the window, and the
 * PATH's curvature there — what the speed through that bend has to be planned on.
 *
 * Positive offset is left of travel, and positive road curvature turns toward it: the
 * heading's derivative `(cos h, −sin h)` is the lateral axis of `offsetPoint`.
 */

/** Metres between solved offsets. */
export const RACING_LINE_STEP_M = 5;
/**
 * Weight of the pull toward the home offset, against curvature squared. It sets the
 * length a straight takes to bring the line home: a deviation `Δ` returned over `L`
 * costs about `(Δ/L²)²` of curvature per metre and `λΔ²` of pull, which balance at
 * `L = λ^(-1/4)` — 100 m here, a few seconds of road at racing speed. At 150 m the
 * line was still in the opposing half 260 m past a bend (tools/racing-line.ts).
 */
const HOME_WEIGHT = 1 / 100 ** 4;
/**
 * Weight of keeping the line's first segment at the slope the car is already on,
 * against curvature squared. The window re-solves every step and its band changes as
 * sight opens and traffic comes and goes; left free, the first segment turned with
 * each re-solve and asked a car at the limit for a lateral flick it did not have
 * (measured on the playground esses: the line swinging across the crown at 5 m/s
 * while the car was already using its tyres on the bend). Stiff, but a preference:
 * a slope pinned outright made the first segment a fixed point that never turned.
 */
const HEADING_WEIGHT = 0.02;
/** Active-set passes before the solve settles for the best it has. */
const MAX_ACTIVE_SET_PASSES = 40;

export interface RacingLineRoad {
  curvatureAt(s: number): number;
}

/**
 * Writes the usable band at `s` (`distance` metres ahead of the car) into `out` as
 * `[lo, hi, home]`: the offsets the line must stay between, and the one it settles to
 * where nothing is gained by leaving it.
 */
export type RacingLineBand = (s: number, distance: number, out: [number, number, number]) => void;

export class RacingLine {
  private startS = 0;
  private count = 0;
  private offsets = new Float64Array(0);
  private curvatures = new Float64Array(0);
  private lows = new Float64Array(0);
  private highs = new Float64Array(0);
  private homes = new Float64Array(0);
  private pathCurvatures = new Float64Array(0);
  /** -1 pinned low, +1 pinned high, 2 pinned to the car, 0 free. */
  private pins = new Int8Array(0);
  private previousPins = new Int8Array(0);
  // Banded system scratch: the three upper diagonals, the right-hand side, and the
  // factorisation (D and the two sub-diagonals of L).
  private d0 = new Float64Array(0);
  private d1 = new Float64Array(0);
  private d2 = new Float64Array(0);
  private rhs = new Float64Array(0);
  private fd = new Float64Array(0);
  private l1 = new Float64Array(0);
  private l2 = new Float64Array(0);
  private valid = false;
  /** Slope the car is on at the first sample; see `HEADING_WEIGHT`. */
  private startSlope = 0;
  private readonly band: [number, number, number] = [0, 0, 0];

  /** Forget the previous line. */
  reset(): void {
    this.valid = false;
  }

  /** Arclength the solved window ends at. */
  get endS(): number {
    return this.startS + (this.count - 1) * RACING_LINE_STEP_M;
  }

  /** Whether `s` lies inside the solved window. */
  covers(s: number): boolean {
    return this.valid && s >= this.startS && s <= this.endS;
  }

  /**
   * Re-solves the line over `[s, s + window]`, starting from the car's own line
   * (`offset`) so the new line joins the one being driven without a step, and — as
   * a stiff preference rather than a pin — at the slope the car is already following,
   * `slope` metres per metre. See `HEADING_WEIGHT`.
   */
  solve(
    road: RacingLineRoad,
    s: number,
    window: number,
    offset: number,
    slope: number,
    band: RacingLineBand,
  ): void {
    const h = RACING_LINE_STEP_M;
    const n = Math.max(4, Math.ceil(window / h) + 1);
    // The previous solution's pins, shifted onto the new samples, are the warm start:
    // the same apexes are pinned from one step to the next, so the active set is
    // usually right on the first pass.
    if (this.previousPins.length < n) this.previousPins = new Int8Array(n);
    const previousPins = this.previousPins;
    previousPins.fill(0, 0, n);
    if (this.valid) {
      for (let i = 0; i < n; i++) {
        const u = Math.round((s + i * h - this.startS) / h);
        previousPins[i] = u >= 0 && u < this.count ? this.pins[u]! : 0;
      }
    }
    this.ensureCapacity(n);
    for (let i = 0; i < n; i++) {
      const at = s + i * h;
      this.curvatures[i] = road.curvatureAt(at);
      band(at, i * h, this.band);
      this.lows[i] = Math.min(this.band[0], this.band[1]);
      this.highs[i] = Math.max(this.band[0], this.band[1]);
      this.homes[i] = Math.min(this.highs[i]!, Math.max(this.lows[i]!, this.band[2]));
      this.pins[i] = previousPins[i] === 2 ? 0 : previousPins[i]!;
    }
    // Only the car's own position is pinned. Pinning its slope as well made the first
    // segment a fixed point — each solve inherited the last one's slope at the car and
    // pinned it again — so the line could never turn where the car is; the slope is a
    // starting guess and the solve is free to change it.
    this.pins[0] = 2;
    this.offsets[0] = offset;
    this.startSlope = slope;

    this.solveActiveSet(n);
    // Whatever the passes left, the line never leaves its band.
    for (let i = 1; i < n; i++) {
      this.offsets[i] = Math.min(this.highs[i]!, Math.max(this.lows[i]!, this.offsets[i]!));
    }
    const hh = h * h;
    const last = n - 1;
    for (let i = 0; i < n; i++) {
      const a = this.offsets[Math.max(0, i - 1)]!;
      const b = this.offsets[i]!;
      const c = this.offsets[Math.min(last, i + 1)]!;
      this.pathCurvatures[i] =
        i === 0 || i === last ? this.curvatures[i]! : this.curvatures[i]! + (a - 2 * b + c) / hh;
    }
    this.startS = s;
    this.count = n;
    this.valid = true;
  }

  /** Solves with the band limits handled by an active set; see the class note. */
  private solveActiveSet(n: number): void {
    for (let pass = 0; pass < MAX_ACTIVE_SET_PASSES; pass++) {
      this.solvePinned(n);
      let changed = false;
      // Pin every offset that crossed its band; release every pinned one whose
      // gradient would move it back inside.
      for (let i = 1; i < n; i++) {
        const y = this.offsets[i]!;
        if (this.pins[i] === 0) {
          if (y > this.highs[i]! + 1e-9) {
            this.pins[i] = 1;
            changed = true;
          } else if (y < this.lows[i]! - 1e-9) {
            this.pins[i] = -1;
            changed = true;
          }
        } else {
          const g = this.gradientAt(i, n);
          // At the upper limit a positive gradient means lowering the offset lowers
          // the cost, so the limit is no longer holding it; mirrored at the lower.
          if ((this.pins[i] === 1 && g > 0) || (this.pins[i] === -1 && g < 0)) {
            this.pins[i] = 0;
            changed = true;
          }
        }
      }
      if (!changed) break;
    }
  }

  /** The line's offset at `s`, linearly interpolated and held at the window's ends. */
  offsetAt(s: number): number {
    return this.interpolate(this.offsets, s);
  }

  /** Metres of offset per metre of road at `s`. */
  slopeAt(s: number): number {
    if (this.count < 2) return 0;
    const u = Math.min(this.count - 1.001, Math.max(0, (s - this.startS) / RACING_LINE_STEP_M));
    const i = Math.floor(u);
    return (this.offsets[i + 1]! - this.offsets[i]!) / RACING_LINE_STEP_M;
  }

  /** Curvature of the driven path at `s`, rad/m, signed like the road's. */
  pathCurvatureAt(s: number): number {
    return this.interpolate(this.pathCurvatures, s);
  }

  private ensureCapacity(n: number): void {
    if (this.offsets.length >= n) return;
    this.offsets = new Float64Array(n);
    this.curvatures = new Float64Array(n);
    this.lows = new Float64Array(n);
    this.highs = new Float64Array(n);
    this.homes = new Float64Array(n);
    this.pathCurvatures = new Float64Array(n);
    this.pins = new Int8Array(n);
    this.d0 = new Float64Array(n);
    this.d1 = new Float64Array(n);
    this.d2 = new Float64Array(n);
    this.rhs = new Float64Array(n);
    this.fd = new Float64Array(n);
    this.l1 = new Float64Array(n);
    this.l2 = new Float64Array(n);
  }

  /**
   * Cost: `Σ_{i=1}^{n-2} (κ_i + (y_{i-1} − 2y_i + y_{i+1})/h²)² + λ Σ (y_i − home_i)²`.
   * Each curvature row touches three offsets with weights `(1, −2, 1)/h²`, so the
   * Hessian `2(DᵀD + λI)` is pentadiagonal. Pinned offsets become identity rows and
   * their columns move to the right-hand side, which keeps it symmetric and banded.
   */
  private solvePinned(n: number): void {
    const h = RACING_LINE_STEP_M;
    const w = 1 / (h * h);
    const { d0, d1, d2, rhs, offsets, pins, curvatures } = this;
    d0.fill(0, 0, n);
    d1.fill(0, 0, n);
    d2.fill(0, 0, n);
    rhs.fill(0, 0, n);
    for (let j = 0; j < n; j++) {
      d0[j] = HOME_WEIGHT;
      rhs[j] = HOME_WEIGHT * this.homes[j]!;
    }
    // Heading: HEADING_WEIGHT · (y₁ − y₀ − slope·h)², with y₀ the pinned car.
    d0[1] = d0[1]! + HEADING_WEIGHT;
    rhs[1] = rhs[1]! + HEADING_WEIGHT * (offsets[0]! + this.startSlope * h);
    // Row i of D is (w, −2w, w) at offsets i−1, i, i+1.
    for (let i = 1; i < n - 1; i++) {
      const k = curvatures[i]!;
      const ww = w * w;
      rhs[i - 1] = rhs[i - 1]! - w * k;
      rhs[i] = rhs[i]! + 2 * w * k;
      rhs[i + 1] = rhs[i + 1]! - w * k;
      d0[i - 1] = d0[i - 1]! + ww;
      d0[i] = d0[i]! + 4 * ww;
      d0[i + 1] = d0[i + 1]! + ww;
      d1[i - 1] = d1[i - 1]! - 2 * ww;
      d1[i] = d1[i]! - 2 * ww;
      d2[i - 1] = d2[i - 1]! + ww;
    }
    // Pinned values: fixed offsets for the car's two, limits for the rest.
    for (let j = 0; j < n; j++) {
      if (pins[j] === 1) offsets[j] = this.highs[j]!;
      else if (pins[j] === -1) offsets[j] = this.lows[j]!;
    }
    // Move pinned columns into the right-hand side of the free rows, then make the
    // pinned rows identity.
    for (let j = 0; j < n; j++) {
      if (pins[j] === 0) continue;
      const v = offsets[j]!;
      if (j - 1 >= 0 && pins[j - 1] === 0) rhs[j - 1] = rhs[j - 1]! - d1[j - 1]! * v;
      if (j - 2 >= 0 && pins[j - 2] === 0) rhs[j - 2] = rhs[j - 2]! - d2[j - 2]! * v;
      if (j + 1 < n && pins[j + 1] === 0) rhs[j + 1] = rhs[j + 1]! - d1[j]! * v;
      if (j + 2 < n && pins[j + 2] === 0) rhs[j + 2] = rhs[j + 2]! - d2[j]! * v;
    }
    for (let j = 0; j < n; j++) {
      if (pins[j] === 0) continue;
      d0[j] = 1;
      rhs[j] = offsets[j]!;
      d1[j] = 0;
      d2[j] = 0;
      if (j - 1 >= 0) d1[j - 1] = 0;
      if (j - 2 >= 0) d2[j - 2] = 0;
    }
    // Banded LDLᵀ: A[i][i-1] = d1[i-1], A[i][i-2] = d2[i-2].
    const { fd, l1, l2 } = this;
    for (let i = 0; i < n; i++) {
      const a2 = i >= 2 ? d2[i - 2]! : 0;
      const a1 = i >= 1 ? d1[i - 1]! : 0;
      l2[i] = i >= 2 ? a2 / fd[i - 2]! : 0;
      l1[i] = i >= 1 ? (a1 - (i >= 2 ? l2[i]! * l1[i - 1]! * fd[i - 2]! : 0)) / fd[i - 1]! : 0;
      fd[i] =
        d0[i]! -
        (i >= 2 ? l2[i]! * l2[i]! * fd[i - 2]! : 0) -
        (i >= 1 ? l1[i]! * l1[i]! * fd[i - 1]! : 0);
    }
    // Forward, diagonal, back.
    for (let i = 0; i < n; i++) {
      offsets[i] =
        rhs[i]! - (i >= 1 ? l1[i]! * offsets[i - 1]! : 0) - (i >= 2 ? l2[i]! * offsets[i - 2]! : 0);
    }
    for (let i = 0; i < n; i++) offsets[i] = offsets[i]! / fd[i]!;
    for (let i = n - 1; i >= 0; i--) {
      offsets[i] =
        offsets[i]! -
        (i + 1 < n ? l1[i + 1]! * offsets[i + 1]! : 0) -
        (i + 2 < n ? l2[i + 2]! * offsets[i + 2]! : 0);
    }
  }

  /** Half the cost's derivative with respect to offset `j`, at the current offsets. */
  private gradientAt(j: number, n: number): number {
    const w = 1 / (RACING_LINE_STEP_M * RACING_LINE_STEP_M);
    let g = HOME_WEIGHT * (this.offsets[j]! - this.homes[j]!);
    if (j === 1) {
      g += HEADING_WEIGHT * (this.offsets[1]! - this.offsets[0]! - this.startSlope * RACING_LINE_STEP_M);
    }
    for (let i = Math.max(1, j - 1); i <= Math.min(n - 2, j + 1); i++) {
      const k =
        this.curvatures[i]! +
        (this.offsets[i - 1]! - 2 * this.offsets[i]! + this.offsets[i + 1]!) * w;
      const coefficient = i === j ? -2 * w : w;
      g += k * coefficient;
    }
    return g;
  }

  private interpolate(values: Float64Array, s: number): number {
    if (this.count === 0) return 0;
    const u = Math.min(this.count - 1, Math.max(0, (s - this.startS) / RACING_LINE_STEP_M));
    const i = Math.min(this.count - 2, Math.floor(u));
    const t = u - i;
    return values[i]! + (values[i + 1]! - values[i]!) * t;
  }
}
