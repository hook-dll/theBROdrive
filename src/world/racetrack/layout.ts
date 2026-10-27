import { SurfaceType } from '../../core/surfaces';

/**
 * THE SHAPE OF A RACE TRACK: a closed loop on flat ground, before it is put anywhere.
 *
 * The world road cannot turn back on itself (road.ts), so a lap is separate geometry, as
 * the dev circuit already is (playground/circuit.ts). That one is authored once; these
 * are rolled per post, so the construction has to guarantee by itself the three things
 * the circuit's author checked by hand: the loop CLOSES, it never CROSSES or crowds
 * itself, and it is SMOOTH enough that the autopilot drives it like a road.
 *
 * A ROUNDED STAR POLYGON. Six to nine corners stand round an ellipse at increasing
 * angles, each pushed in or out a little, and one or two are pulled hard toward the
 * middle. Because every corner is at a larger angle round the centre than the one
 * before, the polygon is star-shaped about it and therefore SIMPLE whatever the rolls
 * were; a corner pulled inward turns the loop AGAINST its own direction there (a
 * `counter` corner), which is what stops a loop reading as an oval. Each corner is
 * then rounded by an arc tangent to both its edges, so the loop is straights and arcs
 * and closes exactly: an arc of turn θ and radius R takes `R tan(θ/2)` off each edge
 * and turns the heading by exactly θ, and the corners' turns sum to one revolution.
 *
 * The corner's radius is rolled by how sharp the corner is, so the polygon decides the
 * character: a corner of 115° or more is a HAIRPIN (20-27 m), 70° a TIGHT one, 35° a
 * MEDIUM, and the shallow ones FAST bends and SWEEPERS up to 300 m. The sharpest corner
 * is always tight, so every lap has its technical corner, and a loop with no corner
 * sharp enough to give one is thrown away and rolled again.
 *
 * Long straights other than the start straight may carry a DOUBLE S: turn a, back 2a,
 * and a again. That pattern leaves the heading AND the lateral offset where they were,
 * so it drops into a straight without disturbing the closure; only its along-road
 * length is taken off the straight. Tight radii make a CHICANE, wide ones ESSES.
 *
 * SMOOTHNESS, AND THE CLOSURE IT COSTS. Straight-into-arc is a step in curvature, which
 * a steering controller feels as a kick. The curvature table is box-filtered over
 * `CURVATURE_SMOOTH_M`, which turns every step into a linear ramp — a clothoid — and
 * keeps the total turn exactly one revolution, so the heading still closes. The
 * POSITION no longer closes exactly after filtering, by centimetres; two straights'
 * lengths are corrected by Newton until it does, to a tenth of a millimetre, and a
 * loop whose correction would make a straight too short is rolled again.
 *
 * Everything here is in a LOCAL frame: the loop starts at (0, 0) heading +Z (forward is
 * `(sin h, cos h)` as on the road) at the start of the start straight. Placing it
 * beside a post, its heights and its ground are site.ts's business.
 */

/** The character of one piece of the loop, for the bench and the dressing (curbs, tyres). */
export type TrackPieceKind =
  | 'straight'
  | 'hairpin'
  | 'tight'
  | 'medium'
  | 'fast'
  | 'sweeper'
  | 'counter'
  | 'chicane'
  | 'esses';

/** One straight or arc of the loop, in driving order. */
export interface TrackPiece {
  readonly kind: TrackPieceKind;
  /** Metres. Two straights' lengths are adjusted by the closure. */
  length: number;
  /** Signed curvature, 1/m: positive turns toward positive lateral (LEFT), as the road's. */
  readonly curvature: number;
  /**
   * Cross-slope the piece is laid at, as a fraction, signed like the road's banking
   * (`DriveRoad.bankingAt`): `y = centre - bank * lateral`, so a bank with the
   * curvature's sign leans INTO the bend and one against it is off-camber.
   */
  readonly bank: number;
}

/** Surface kinds a track sector is laid in, and the tyre surface each one is. */
export type TrackSurfaceKind = 'asphalt' | 'gravel' | 'dirt';

/**
 * The tyre surface (core/surfaces.ts) behind each sector kind. Dirt is the LOOSE kind
 * the handling already models for the verge (`LooseShoulder`: mu 0.8, deep loose
 * material), not `Sand`, which is the desert's tar pit and would make a racing
 * surface a bog; packed graded gravel is `Gravel`.
 */
export const TRACK_SURFACE: Readonly<Record<TrackSurfaceKind, SurfaceType>> = {
  asphalt: SurfaceType.Asphalt,
  gravel: SurfaceType.Gravel,
  dirt: SurfaceType.LooseShoulder,
};

/** A run of one surface along the lap, `startS` inclusive to the next run's start. */
export interface TrackSector {
  readonly startS: number;
  readonly endS: number;
  readonly kind: TrackSurfaceKind;
}

/** The finished loop: its pieces and the 1 m table every reader samples. */
export interface TrackLoop {
  readonly pieces: readonly TrackPiece[];
  /** Arclength each piece starts at; piece 0 is the start straight and starts at 0. */
  readonly pieceStarts: Float64Array;
  /** Lap length, metres. */
  readonly length: number;
  /** Table rows; row `i` is at `i * length / count`. */
  readonly count: number;
  readonly xs: Float64Array;
  readonly zs: Float64Array;
  readonly headings: Float64Array;
  /** Filtered (clothoid) curvature of the cell starting at each row. */
  readonly curvatures: Float64Array;
  /** Filtered cross-slope at each row. */
  readonly banks: Float64Array;
  /** Surface sectors in lap order, covering [0, length). */
  readonly sectors: readonly TrackSector[];
  /** +1 when the loop turns left overall, -1 right: the inside of the loop is that side. */
  readonly turn: 1 | -1;
  /** XZ gap between the table's end and its start after the closure, metres. */
  readonly closureResidualM: number;
}

/** Table step, metres (adjusted so a whole number of rows spans the lap). */
export const TRACK_STEP_M = 1;
/** Length of the clothoid every curvature step is spread into, metres. */
export const CURVATURE_SMOOTH_M = 12;
/** Length a change of banking is spread over, metres. */
const BANK_SMOOTH_M = 30;
/** Shortest lap kept, and longest. */
export const TRACK_MIN_LENGTH_M = 1800;
export const TRACK_MAX_LENGTH_M = 3500;
/** Lap length the polygon is sized for, before rounding takes its share. */
const TARGET_MIN_M = 2050;
const TARGET_MAX_M = 3400;
/** Shortest straight left between two corners, metres. */
const MIN_STRAIGHT_M = 22;
/** The start straight holds the grid, the line and the paddock beside them. */
export const START_STRAIGHT_MIN_M = 170;
/** No corner is rounded tighter than this, metres. */
const MIN_RADIUS_M = 19;
/**
 * THE SELF-CLEARANCE. Any two points of the centreline more than `NEIGHBOUR_S_M` apart
 * along the lap must be at least `TRACK_CLEAR_M` apart on the ground: two widths of
 * track and run-off (2 x (5 + 10) m) and a few metres of sand between them. A hairpin's
 * two legs are the case that sets it: at the 19 m floor they stand 38 m apart, and
 * `NEIGHBOUR_S_M` is longer than the half-turn of the tightest corner can be, so a
 * hairpin is not counted as the track meeting itself.
 */
export const TRACK_CLEAR_M = 36;
export const NEIGHBOUR_S_M = 70;

type Rand = () => number;

function between(rand: Rand, lo: number, hi: number): number {
  return lo + (hi - lo) * rand();
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

interface Corner {
  readonly turn: number;
  radius: number;
  readonly floor: number;
}

/** Tangent length an arc takes off each of its edges. */
function tangent(corner: Corner): number {
  return corner.radius * Math.tan(Math.abs(corner.turn) / 2);
}

function cornerKind(corner: Corner, loopTurn: number): TrackPieceKind {
  if (Math.sign(corner.turn) !== loopTurn) return 'counter';
  const angle = Math.abs(corner.turn);
  if (corner.radius <= 30 && angle >= 2.0) return 'hairpin';
  if (corner.radius <= 40) return 'tight';
  if (corner.radius <= 80) return 'medium';
  if (corner.radius <= 160) return 'fast';
  return 'sweeper';
}

/**
 * Cross-slope for a corner by its kind: fast corners banked in (up to 8%, the steep end
 * of what a circuit lays), tight ones barely, and the counter-corners flat.
 */
function cornerBank(rand: Rand, kind: TrackPieceKind): number {
  switch (kind) {
    case 'sweeper':
    case 'fast':
      return rand() < 0.75 ? between(rand, 0.04, 0.08) : between(rand, 0.015, 0.03);
    case 'medium':
      return between(rand, 0.02, 0.045);
    case 'tight':
    case 'hairpin':
      return between(rand, 0, 0.03);
    default:
      return 0;
  }
}

/**
 * The rounded polygon's pieces in driving order, longest straight first, or null when
 * this roll gives no technical corner or cannot fit its arcs on its edges.
 */
function polygonPieces(rand: Rand): { pieces: TrackPiece[]; loopTurn: 1 | -1 } | null {
  const n = 6 + Math.floor(rand() * 4);
  const target = between(rand, TARGET_MIN_M, TARGET_MAX_M);
  const aspect = between(rand, 1.15, 1.9);
  // Ramanujan's ellipse perimeter for semi-axes (aspect * b, b).
  const perimeterPerB = Math.PI * (3 * (aspect + 1) - Math.sqrt((3 * aspect + 1) * (aspect + 3)));
  const b = target / perimeterPerB;
  const a = aspect * b;
  const mirror = rand() < 0.5 ? -1 : 1;
  const xs = new Float64Array(n);
  const zs = new Float64Array(n);
  const rho = new Float64Array(n);
  for (let i = 0; i < n; i++) rho[i] = between(rand, 0.84, 1.12);
  // The pulled-in corners: one usually, sometimes two, never neighbours.
  const reflexRoll = rand();
  const reflexCount = reflexRoll < 0.6 ? 1 : reflexRoll < 0.85 ? 2 : 0;
  const first = Math.floor(rand() * n);
  if (reflexCount >= 1) rho[first]! *= between(rand, 0.4, 0.62);
  if (reflexCount >= 2) {
    const second = (first + 2 + Math.floor(rand() * (n - 3))) % n;
    rho[second]! *= between(rand, 0.4, 0.62);
  }
  for (let i = 0; i < n; i++) {
    const phi = (Math.PI * 2 * (i + (rand() - 0.5) * 0.55)) / n;
    xs[i] = mirror * a * rho[i]! * Math.cos(phi);
    zs[i] = b * rho[i]! * Math.sin(phi);
  }

  // Edge headings, corner turns, and the loop's own direction.
  const edgeHeading = new Float64Array(n);
  const edgeLength = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    edgeHeading[i] = Math.atan2(xs[j]! - xs[i]!, zs[j]! - zs[i]!);
    edgeLength[i] = Math.hypot(xs[j]! - xs[i]!, zs[j]! - zs[i]!);
  }
  const corners: Corner[] = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const turn = wrapAngle(edgeHeading[i]! - edgeHeading[(i + n - 1) % n]!);
    total += turn;
    corners.push({ turn, radius: 0, floor: MIN_RADIUS_M });
  }
  // Star-shaped about the origin, so the turns sum to exactly one revolution.
  if (Math.abs(Math.abs(total) - Math.PI * 2) > 1e-6) return null;
  const loopTurn: 1 | -1 = total > 0 ? 1 : -1;

  let sharpest = -1;
  for (let i = 0; i < n; i++) {
    const corner = corners[i]!;
    const angle = Math.abs(corner.turn);
    if (Math.sign(corner.turn) !== loopTurn) corner.radius = between(rand, 45, 100);
    else if (angle >= 2.0) corner.radius = between(rand, 20, 27);
    else if (angle >= 1.2) corner.radius = between(rand, 30, 60);
    else if (angle >= 0.6) corner.radius = between(rand, 60, 140);
    else corner.radius = between(rand, 130, 300);
    if (Math.sign(corner.turn) === loopTurn && (sharpest < 0 || angle > Math.abs(corners[sharpest]!.turn))) sharpest = i;
  }
  // Every lap has its technical corner, and a roll too round to give one is rolled again.
  if (sharpest < 0 || Math.abs(corners[sharpest]!.turn) < 1.5) return null;
  corners[sharpest]!.radius = Math.min(corners[sharpest]!.radius, between(rand, 20, 27));

  // Fit the arcs on their edges, shrinking the hungrier end of an edge that is too short.
  const free = new Float64Array(n);
  let fitted = false;
  for (let pass = 0; pass < 40 && !fitted; pass++) {
    let worst = -1;
    for (let i = 0; i < n; i++) {
      free[i] = edgeLength[i]! - tangent(corners[i]!) - tangent(corners[(i + 1) % n]!);
      if (free[i]! < MIN_STRAIGHT_M && (worst < 0 || free[i]! < free[worst]!)) worst = i;
    }
    if (worst < 0) {
      fitted = true;
      break;
    }
    const head = corners[worst]!;
    const tail = corners[(worst + 1) % n]!;
    const shrink = tangent(head) >= tangent(tail) ? head : tail;
    const other = shrink === head ? tail : head;
    if (shrink.radius * 0.85 >= shrink.floor) shrink.radius *= 0.85;
    else if (other.radius * 0.85 >= other.floor) other.radius *= 0.85;
    else return null;
  }
  if (!fitted) return null;

  const pieces: TrackPiece[] = [];
  for (let i = 0; i < n; i++) {
    const corner = corners[i]!;
    const kind = cornerKind(corner, loopTurn);
    pieces.push({
      kind,
      length: corner.radius * Math.abs(corner.turn),
      curvature: Math.sign(corner.turn) / corner.radius,
      bank: Math.sign(corner.turn) * cornerBank(rand, kind),
    });
    pieces.push({ kind: 'straight', length: free[i]!, curvature: 0, bank: 0 });
  }
  // The longest straight is the start straight, and the lap starts at its beginning.
  let longest = 1;
  for (let i = 3; i < pieces.length; i += 2) if (pieces[i]!.length > pieces[longest]!.length) longest = i;
  if (pieces[longest]!.length < START_STRAIGHT_MIN_M) return null;
  const ordered = [...pieces.slice(longest), ...pieces.slice(0, longest)];

  // One corner laid slightly OFF-CAMBER: a medium or fast one, never the fastest.
  if (rand() < 0.6) {
    const candidates = ordered.filter((p) => p.kind === 'medium' || p.kind === 'fast');
    if (candidates.length >= 2) {
      const chosen = candidates[Math.floor(rand() * candidates.length)]!;
      const index = ordered.indexOf(chosen);
      ordered[index] = { ...chosen, bank: -Math.sign(chosen.curvature) * between(rand, 0.015, 0.03) };
    }
  }
  return { pieces: ordered, loopTurn };
}

/**
 * Drops a double S into the longest straights after the start straight: turn a, back
 * 2a, a again, which returns both heading and lateral offset (see the header). Tight
 * radii make a chicane, wide ones esses; the straight keeps at least 40 m either side.
 */
function insertDoubleS(rand: Rand, pieces: TrackPiece[]): TrackPiece[] {
  const straights = pieces
    .map((piece, index) => ({ piece, index }))
    .filter(({ piece, index }) => index > 0 && piece.kind === 'straight')
    .sort((p, q) => q.piece.length - p.piece.length);
  const replace = new Map<number, TrackPiece[]>();
  let placed = 0;
  let chicane = false;
  for (const { piece, index } of straights) {
    if (placed >= 2) break;
    if (rand() >= (placed === 0 ? 0.85 : 0.45)) continue;
    const wantChicane: boolean = !chicane && rand() < 0.65;
    const radius = wantChicane ? between(rand, 26, 38) : between(rand, 60, 100);
    const angle = wantChicane ? between(rand, 0.4, 0.6) : between(rand, 0.3, 0.48);
    const along = 4 * radius * Math.sin(angle);
    const spare = piece.length - along - 80;
    if (spare < 0) continue;
    const before = 40 + spare * between(rand, 0.25, 0.75);
    const after = piece.length - along - before;
    const sign = rand() < 0.5 ? -1 : 1;
    const kind: TrackPieceKind = wantChicane ? 'chicane' : 'esses';
    const arc = (turn: number): TrackPiece => ({ kind, length: radius * angle, curvature: turn / radius, bank: 0 });
    replace.set(index, [
      { kind: 'straight', length: before, curvature: 0, bank: 0 },
      arc(sign),
      arc(-sign),
      arc(-sign),
      arc(sign),
      { kind: 'straight', length: after, curvature: 0, bank: 0 },
    ]);
    placed++;
    chicane ||= wantChicane;
  }
  const out: TrackPiece[] = [];
  pieces.forEach((piece, index) => out.push(...(replace.get(index) ?? [piece])));
  return out;
}

interface Walked {
  count: number;
  step: number;
  residualX: number;
  residualZ: number;
  xs: Float64Array;
  zs: Float64Array;
  headings: Float64Array;
  curvatures: Float64Array;
}

/** Circular moving average over `window` cells (odd), in place into `out`. */
function boxFilter(values: Float64Array, window: number, out: Float64Array): void {
  const n = values.length;
  const half = Math.max(0, Math.floor(window / 2));
  const span = half * 2 + 1;
  let sum = 0;
  for (let k = -half; k <= half; k++) sum += values[((k % n) + n) % n]!;
  for (let i = 0; i < n; i++) {
    out[i] = sum / span;
    sum += values[(i + half + 1) % n]! - values[(((i - half) % n) + n) % n]!;
  }
}

/**
 * Lays the pieces out on the table: each cell's curvature is the pieces' exact mean over
 * it (so a length is a continuous parameter for the Newton step), box-filtered into
 * clothoids, and each cell is then walked as the exact arc of its own curvature.
 */
function walk(pieces: readonly TrackPiece[]): Walked {
  let length = 0;
  for (const piece of pieces) length += piece.length;
  const count = Math.max(8, Math.round(length / TRACK_STEP_M));
  const step = length / count;
  // Cell means from the turning function's increments.
  const raw = new Float64Array(count);
  let piece = 0;
  let pieceStart = 0;
  let pieceTheta = 0;
  const thetaAt = (s: number): number => {
    while (piece < pieces.length - 1 && s > pieceStart + pieces[piece]!.length) {
      pieceTheta += pieces[piece]!.curvature * pieces[piece]!.length;
      pieceStart += pieces[piece]!.length;
      piece++;
    }
    return pieceTheta + pieces[piece]!.curvature * (s - pieceStart);
  };
  let previous = thetaAt(0);
  for (let i = 0; i < count; i++) {
    const next = thetaAt((i + 1) * step);
    raw[i] = (next - previous) / step;
    previous = next;
  }
  const curvatures = new Float64Array(count);
  boxFilter(raw, Math.round(CURVATURE_SMOOTH_M / step) | 1, curvatures);

  const xs = new Float64Array(count);
  const zs = new Float64Array(count);
  const headings = new Float64Array(count);
  let x = 0;
  let z = 0;
  let h = 0;
  for (let i = 0; i < count; i++) {
    xs[i] = x;
    zs[i] = z;
    headings[i] = h;
    const k = curvatures[i]!;
    if (Math.abs(k) < 1e-12) {
      x += Math.sin(h) * step;
      z += Math.cos(h) * step;
    } else {
      // The arc of radius 1/k, centre to the LEFT for k > 0 (positive lateral).
      const r = 1 / k;
      const h1 = h + k * step;
      x += r * (Math.cos(h) - Math.cos(h1));
      z += r * (Math.sin(h1) - Math.sin(h));
      h = h1;
    }
  }
  return { count, step, residualX: x, residualZ: z, xs, zs, headings, curvatures };
}

/** Heading a straight piece runs at (unfiltered), from the turns before it. */
function pieceHeading(pieces: readonly TrackPiece[], index: number): number {
  let h = 0;
  for (let i = 0; i < index; i++) h += pieces[i]!.curvature * pieces[i]!.length;
  return h;
}

/**
 * Closes the filtered loop by adjusting the start straight and the straight most nearly
 * at right angles to it. Returns the walk, or null when a straight would go short.
 */
function close(pieces: TrackPiece[]): Walked | null {
  const p = 0;
  let q = -1;
  let best = 0.5;
  const hp = pieceHeading(pieces, p);
  for (let i = 1; i < pieces.length; i++) {
    if (pieces[i]!.kind !== 'straight') continue;
    const across = Math.abs(Math.sin(pieceHeading(pieces, i) - hp));
    if (across > best) {
      best = across;
      q = i;
    }
  }
  if (q < 0) return null;
  let walked = walk(pieces);
  for (let iteration = 0; iteration < 10; iteration++) {
    if (Math.hypot(walked.residualX, walked.residualZ) < 1e-4) return walked;
    const delta = 0.5;
    pieces[p]!.length += delta;
    const dp = walk(pieces);
    pieces[p]!.length -= delta;
    pieces[q]!.length += delta;
    const dq = walk(pieces);
    pieces[q]!.length -= delta;
    const a11 = (dp.residualX - walked.residualX) / delta;
    const a21 = (dp.residualZ - walked.residualZ) / delta;
    const a12 = (dq.residualX - walked.residualX) / delta;
    const a22 = (dq.residualZ - walked.residualZ) / delta;
    const det = a11 * a22 - a12 * a21;
    if (Math.abs(det) < 1e-9) return null;
    const lp = (-walked.residualX * a22 + walked.residualZ * a12) / det;
    const lq = (-walked.residualZ * a11 + walked.residualX * a21) / det;
    pieces[p]!.length += lp;
    pieces[q]!.length += lq;
    if (pieces[p]!.length < START_STRAIGHT_MIN_M || pieces[q]!.length < MIN_STRAIGHT_M) return null;
    walked = walk(pieces);
  }
  return Math.hypot(walked.residualX, walked.residualZ) < 1e-3 ? walked : null;
}

/**
 * Smallest XZ distance between two rows more than `NEIGHBOUR_S_M` apart along the lap,
 * metres, searched to `reach` (returns `reach` when nothing is nearer). Rows every
 * `stride`: the table is 1 m, and 4 m is finer than any gap that matters here.
 */
export function loopSeparation(
  xs: ArrayLike<number>,
  zs: ArrayLike<number>,
  length: number,
  reach: number,
  stride = 4,
): number {
  const count = xs.length;
  const step = length / count;
  const cell = reach;
  const grid = new Map<number, number[]>();
  const key = (cx: number, cz: number): number => cx * 73_856_093 + cz * 19_349_663;
  for (let i = 0; i < count; i += stride) {
    const k = key(Math.floor(xs[i]! / cell), Math.floor(zs[i]! / cell));
    let list = grid.get(k);
    if (!list) grid.set(k, (list = []));
    list.push(i);
  }
  let nearest = reach;
  for (let i = 0; i < count; i += stride) {
    const cx = Math.floor(xs[i]! / cell);
    const cz = Math.floor(zs[i]! / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (const j of grid.get(key(cx + dx, cz + dz)) ?? []) {
          if (j <= i) continue;
          const along = Math.min(j - i, count - (j - i)) * step;
          if (along < NEIGHBOUR_S_M) continue;
          const d = Math.hypot(xs[j]! - xs[i]!, zs[j]! - zs[i]!);
          if (d < nearest) nearest = d;
        }
      }
    }
  }
  return nearest;
}

/**
 * Splits the lap into surface sectors at two to four straights' middles, or null when
 * it has too few straights to vary. The sector that wraps round the start straight is
 * asphalt — the grid stands on it — and at least one other is not.
 */
function rollSectors(rand: Rand, pieces: readonly TrackPiece[], starts: Float64Array, length: number): TrackSector[] | null {
  const cuts: number[] = [];
  for (let i = 1; i < pieces.length; i++) {
    const piece = pieces[i]!;
    if (piece.kind === 'straight' && piece.length >= 50) cuts.push(starts[i]! + piece.length * 0.45);
  }
  if (cuts.length < 2) return null;
  const wanted = Math.min(cuts.length, 2 + Math.floor(rand() * 3));
  const chosen: number[] = [];
  while (chosen.length < wanted) chosen.push(cuts.splice(Math.floor(rand() * cuts.length), 1)[0]!);
  chosen.sort((p, q) => p - q);
  // Sector i runs from cut i to cut i + 1; the last wraps through the start straight.
  const kinds: TrackSurfaceKind[] = chosen.map(() => {
    const roll = rand();
    return roll < 0.38 ? 'asphalt' : roll < 0.72 ? 'gravel' : 'dirt';
  });
  kinds[kinds.length - 1] = 'asphalt';
  if (!kinds.some((kind) => kind !== 'asphalt')) {
    kinds[Math.floor(rand() * (kinds.length - 1))] = rand() < 0.6 ? 'gravel' : 'dirt';
  }
  const sectors: TrackSector[] = [{ startS: 0, endS: chosen[0]!, kind: 'asphalt' }];
  for (let i = 0; i < chosen.length; i++) {
    sectors.push({ startS: chosen[i]!, endS: i + 1 < chosen.length ? chosen[i + 1]! : length, kind: kinds[i]! });
  }
  return sectors;
}

/**
 * One loop from a stream of rolls, or null when this roll does not make one: too round
 * for a technical corner, arcs that do not fit, a closure that would shorten a
 * straight past its floor, a lap outside the length window, or a loop that crowds
 * itself. The caller rolls again from the same stream.
 */
export function generateLoop(rand: Rand): TrackLoop | null {
  const polygon = polygonPieces(rand);
  if (!polygon) return null;
  const pieces = insertDoubleS(rand, polygon.pieces);
  const walked = close(pieces);
  if (!walked) return null;
  const length = walked.count * walked.step;
  if (length < TRACK_MIN_LENGTH_M || length > TRACK_MAX_LENGTH_M) return null;
  if (loopSeparation(walked.xs, walked.zs, length, TRACK_CLEAR_M) < TRACK_CLEAR_M) return null;

  const pieceStarts = new Float64Array(pieces.length);
  for (let i = 1; i < pieces.length; i++) pieceStarts[i] = pieceStarts[i - 1]! + pieces[i - 1]!.length;
  const sectors = rollSectors(rand, pieces, pieceStarts, length);
  if (!sectors) return null;

  // Banking per cell from the piece the cell's middle is in, ramped over BANK_SMOOTH_M.
  const rawBank = new Float64Array(walked.count);
  let index = 0;
  for (let i = 0; i < walked.count; i++) {
    const s = (i + 0.5) * walked.step;
    while (index < pieces.length - 1 && s >= pieceStarts[index + 1]!) index++;
    rawBank[i] = pieces[index]!.bank;
  }
  const banks = new Float64Array(walked.count);
  boxFilter(rawBank, Math.round(BANK_SMOOTH_M / walked.step) | 1, banks);

  return {
    pieces,
    pieceStarts,
    length,
    count: walked.count,
    xs: walked.xs,
    zs: walked.zs,
    headings: walked.headings,
    curvatures: walked.curvatures,
    banks,
    sectors,
    turn: polygon.loopTurn,
    closureResidualM: Math.hypot(walked.residualX, walked.residualZ),
  };
}
