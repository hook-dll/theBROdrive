import { hashUnit3, Noise1D } from '../core/rng';
import { Landscape } from './landscape';
import { characterAt, characterOf, districtAt, districtStartOf, newCharacterBuffer, newDistrictBuffer, type RoadCharacter } from './roadcharacter';

/**
 * The road's heading field and the one node recurrence that integrates it.
 *
 * This exists as its own module for a single reason: THREE things integrate the
 * road and they must produce bit-identical doubles. `Road` integrates a block at a
 * time around the player, `buildSpine` integrates the whole road once to snapshot
 * checkpoints, and the spine worker does the same off the main thread. A copy of
 * the recurrence in any of them is a copy that drifts, and a drifted copy means the
 * road built from a checkpoint is a different road from the one built by walking —
 * which shows up as a step in the middle of a chunk seam, not as a compile error.
 *
 * So the recurrence lives here, once, and everything calls it.
 *
 * ---------------------------------------------------------------------------
 * HEADING IS A FUNCTION OF ARCLENGTH, NOT AN INTEGRAL OF ONE
 * ---------------------------------------------------------------------------
 *
 * It used to be the integral of a curvature noise. An integral of zero-mean noise is
 * a random walk, so the heading was unbounded: over 40 000 km it swept 33 full turns,
 * and a curve whose heading covers every direction over and over MUST come back over
 * itself. Measured, 92.5% of the road ran within 1100 m of a part of itself more than
 * 5 km away in arclength, and the closest approach was zero — it crossed. The whole
 * world was one 443 x 223 km bowl with the road scribbled inside it, because the
 * berm and the mountains are functions of distance from the NEAREST PASS of the road
 * (see `Terrain.surroundHeight`) and the scribble's corridors covered their own
 * footprint twice over.
 *
 * Bounding the heading with a restoring force does not work, and it is worth knowing
 * why before anyone tries it again: the restoring term and the corners are the same
 * channel. A pull strong enough to bound a random walk against a curvature reaching
 * 1/170 m is a pull that flattens the corners. Measured at a gain of 4e-6 — already a
 * 250 km-radius turn — the heading still swept 8.5 turns and 93.5% of the road was
 * still merged with itself.
 *
 * So the heading itself is the bounded quantity:
 *
 *     heading(s) = ROUTE_DEVIATION * fbm(s / ROUTE_WAVELENGTH)   <- broad sweep
 *                + turnSequence(seed, s)                          <- actual corners
 *
 * and curvature is its derivative. Two consequences, and the first is a theorem:
 *
 *  1. NO SELF-INTERSECTION. With |heading| < 90 degrees the road's coordinate along
 *     the axis heading 0 has d/ds = cos(heading) > 0, so it is strictly increasing. A
 *     curve whose projection onto an axis is strictly monotone cannot cross itself.
 *     Better, it is a separation bound rather than a mere absence of crossings: two
 *     points a metres apart in arclength are at least `a * cos(max deviation)` apart
 *     on the ground. `tools/road-selfcross.ts` is the acceptance test.
 *
 *  2. THE RECURRENCE CARRIES NO HEADING. Only x and z accumulate, so heading cannot
 *     drift between the three integrators at all — the hazard this module was built
 *     to contain is reduced to two numbers.
 *
 * WHAT IT COSTS, because it is not free. Over one single-sign run the heading can
 * only travel from -D to +D, so `sweeper length * curvature <= 2 * D`: a bounded road
 * cannot hold a tight radius for kilometres. The old road's 4.7 km single-sign runs
 * turned the heading through 557 degrees — those "long sweepers" WERE the corkscrew
 * that made it cross itself, and they cannot survive.
 *
 * The replacement separates slow route sweep from authored turn sequences. The
 * earlier gated-noise corner term could satisfy a minimum-radius probe at one tiny
 * patch while remaining near zero through the kilometres a player actually saw.
 * Alternating seeded bearings instead guarantee a meaningful heading change in every
 * section, then hold that bearing long enough to leave a real straight or sweeper.
 */

/** Spacing between integration nodes. Small enough that 4 m chords read as curved. */
export const NODE_SPACING = 4;
/**
 * Tight-corner target, metres.
 *
 * Radius alone was the wrong goal. An 85 m curvature spike can make a probe happy
 * while the road before and after it keeps almost the same bearing — exactly the
 * straight aerial view reported from play. A turn now has TWO authored dimensions:
 * 85-140 m peak radius and 25-60 degrees of accumulated heading change.
 *
 * The no-crossing theorem still owns the hard limit. Broad route sweep spends
 * 0.95 rad and a turn bearing spends at most 0.52 rad, for 1.47 rad (84.2 degrees)
 * total: below 90 degrees, so forward progress remains strictly positive.
 */
export const MIN_CORNER_RADIUS = 85;

/**
 * THE ROUTE TERM: where the road goes.
 *
 * `ROUTE_DEVIATION` is the main deviation budget, and the no-crossing guarantee
 * rests on the sum of it and the corner deviation staying below 90 degrees. Two
 * low-gain octaves work only at the kilometre scale: this term sweeps rather than
 * corners.
 */
const ROUTE_DEVIATION = 0.95;
const ROUTE_WAVELENGTH = 1600;
const ROUTE_OCTAVES = 2;
const ROUTE_GAIN = 0.25;

/**
 * THE CORNER SEQUENCE, and every number in it comes from the district.
 *
 * Each corner transitions from one signed bearing to the next, so the turn is
 * guaranteed, and a quintic smootherstep supplies entry, one peak-curvature apex and
 * exit with zero curvature at both ends.
 *
 * ONE SET OF CONSTANTS USED TO SERVE THE WHOLE ROAD: a corner every kilometre, 25-60
 * degrees, 85-140 m of peak radius, everywhere, for forty thousand kilometres.
 * Measured over 40 km of it, the median radius came out at 3 km and the geometry
 * allowed 350 km/h at the median — the road asked nothing of anyone. Cadence, radius,
 * angle and route wander are properties of the KIND of road, so they live in
 * `roadcharacter.ts` and are read per district here.
 *
 * PHRASES, NOT A METRONOME. Districts then fixed the averages but each still laid its
 * corners out one per `cornerSpacing`, evenly, so a district was the same corner
 * repeated. Roads people like to drive come in phrases — a few corners that belong
 * together, then a straight to breathe on — so a district is cut into phrases:
 *
 *  - A phrase holds `phraseMin`-`phraseMax` corners (at most `MAX_PHRASE_CORNERS`)
 *    and owns that many `cornerSpacing`s of road, scaled by one factor per district
 *    so the phrases tile it exactly. Density is the district's; rhythm is the phrase's.
 *  - Each corner is preceded by a LINK of `linkMin`-`linkMax` metres of straight and
 *    then winds on over its transition. Whatever the phrase's corners leave of it is
 *    held straight after the last one: the BREATHER. So esses (links 0-60 m) run
 *    three or four corners into each other, rolling country (40-220 m) a pair or a
 *    trio, and a highway's one to three sweepers sit hundreds of metres apart before
 *    kilometres of straight.
 *  - A phrase either TIGHTENS or OPENS. Its radii drift by `RADIUS_SHAPE_SLOPE` of
 *    the district's range from first corner to last, and a phrase with an even count
 *    holds one SAME-SIDE step: a bearing from the bottom `COMPOUND_BAND` of the range
 *    followed by one from the top (the corner turns further — it tightens), or the
 *    reverse (it unwinds — it opens). Every other step flips side, as before.
 *  - SIDES ARE BOOKKEEPING, NOT A CHAIN. Every phrase starts and ends on the same side,
 *    and consecutive phrases alternate, so a phrase join is always a full turn. A
 *    district's last bearing is on the side its index's parity names, and its last
 *    phrase takes an odd number of flips when that disagrees (a lone corner becomes a
 *    pair to manage it). So the bearing a phrase starts FROM — its predecessor's last,
 *    or the previous district's last — is one O(1) lookup, never a walk back.
 *
 * A district boundary is a phrase boundary, and a phrase boundary is a held bearing,
 * so curvature is continuous everywhere: zero at every join, smootherstep inside.
 *
 * THE TRANSITION IS A CLOTHOID BUDGET, NOT A CONSTANT. Smootherstep's maximum
 * derivative is 1.875, so a transition of `1.875 · Δθ · R` makes the requested peak
 * radius true by construction — that is the geometry. What the length ALSO has to
 * respect is how fast the curvature is allowed to arrive, because lateral jerk is
 * `v³ · dκ/ds` and a corner entered in twenty metres is a flick of the wheel however
 * correct its apex is. Road design sizes transition curves from exactly this, so the
 * length is the longer of the two requirements: the geometric one, and `v³ · Δκ / j`
 * at the speed the corner itself allows. The one thing above it is the PHRASE: a
 * corner may not run past its share of the phrase, because the phrase's end is the
 * bearing the next phrase starts from (see `turnAt`).
 */
const MAX_PHRASE_CORNERS = 4;
/** Phrases a district can hold. 15 km of 2-corner switchback phrases is about 20. */
const MAX_DISTRICT_PHRASES = 64;
/**
 * Same-side pairs draw from the bottom and top 35% of the bearing range, so the step
 * between them is at least 30% of the range: a corner you feel, not a wobble.
 */
const COMPOUND_BAND = 0.35;
/**
 * How far a phrase's radius drifts from its first corner to its last, as a share of
 * the district's radius range (±half each end), and how much per-corner jitter rides
 * on top. Clamped into the range, so no corner is tighter than the district allows.
 */
const RADIUS_SHAPE_SLOPE = 0.6;
const RADIUS_JITTER = 0.5;
const SMOOTHERSTEP_MAX_SLOPE = 1.875;
/**
 * Lateral jerk the transition is sized for, m/s³, and the cornering budget the entry
 * speed is derived from, m/s².
 *
 * 0.5 m/s³ sits inside the comfort range road guidance uses (0.3-0.6) and 4 m/s² is
 * the cornering budget an ordinary traffic car actually spends — the careful mode's
 * own figure is 3.2 and the hurried one's 4.7 — so the entry this sizes is the one a
 * stream car will really arrive at. It is deliberately NOT the frantic figure: a
 * transition long enough for the calm majority is comfortable for everybody, while
 * one sized for the fastest driver is a flick for the rest.
 */
const TRANSITION_JERK_MPS3 = 0.5;
const TRANSITION_LATERAL_MPS2 = 4;

function smootherstep01(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Transition length for a bend of `radius` turning through `headingChange`, metres.
 *
 * `v = sqrt(a · R)` is the speed the apex allows, and `Δκ = 1 / R`, so the jerk
 * requirement is `v³ / (j · R)` = `(a · R)^1.5 / (j · R)` — which grows with the
 * radius, exactly as it should: a 600 m sweeper is entered at 49 m/s and needs a
 * couple of hundred metres of winding on, while a 60 m hairpin taken at 15 m/s needs
 * a hundred. The geometric requirement dominates for tight corners with a large
 * heading change, the jerk requirement for fast open ones.
 */
function transitionLength(radius: number, headingChange: number): number {
  const geometric = SMOOTHERSTEP_MAX_SLOPE * headingChange * radius;
  const speed = Math.sqrt(TRANSITION_LATERAL_MPS2 * radius);
  const jerk = (speed * speed * speed) / (TRANSITION_JERK_MPS3 * radius);
  return Math.max(geometric, jerk);
}


/**
 * SUPERELEVATION: how far a corner is banked, as a fraction of cross-slope.
 *
 * The old law was `drop = curvature * 3 * lateral`, which at a 100 m radius is a 3%
 * cross-slope — a third of what a real road of that radius is built with — and it was
 * the same everywhere whatever kind of road it was. Road design sizes banking from the
 * speed the corner is FOR, by the point-mass relation
 *
 *     e + f = V² / (127 R)        (V in km/h, R in metres)
 *
 * so the bank is what the corner needs beyond the side friction a driver is expected
 * to spend. `E_MAX` caps it as a real standard does — 8% where ice is not a
 * consideration — and the district's `bankShare` says how much of that a road of this
 * kind was actually built with: a maintained highway all of it, a bulldozed desert
 * track none.
 *
 * It lives on the heading field because that is where the two things it needs already
 * are: the curvature and the district's character. Both the mesh and the driver's
 * speed plan read the SAME function — a copy in either would be a corner the car is
 * banked into and does not know about, or the reverse.
 */
const E_MAX = 0.08;
/** Side friction the design speed is expected to spend, leaving the rest to banking. */
const F_DESIGN = 0.12;

/** First stretch out of the house is dead straight, for the garage exit. */
const STRAIGHT_RUNOUT = 260;

/**
 * Half-step used to differentiate the heading into a curvature. Half a node, so the
 * value it reports is the average bend across the segment the geometry is built from
 * rather than a point value the mesh never sees.
 */
const CURVATURE_STEP = NODE_SPACING * 0.5;

/**
 * CORNER AND CREST TOGETHER: a phrase's first corner can be moved so it turns in just
 * past a brow, and the driver meets it blind or already going downhill.
 *
 * The road's elevation is `Landscape.heightAt` under the centreline, so a crest is a
 * property of where the road IS — and where it is depends on every corner before it.
 * That is the one input here that is not a function of arclength, and it is handled
 * without giving that up:
 *
 *  - ONLY DELAYS. A phrase may start up to `room` metres later than laid out, never
 *    earlier, and the whole phrase moves with its first corner. Before the laid-out
 *    start the heading is the held bearing whatever is decided, so the road up to it,
 *    and along the held bearing ahead of it, is known without the decision.
 *  - THE ROOM COMES OUT OF THE BREATHER: at most `CREST_SHIFT_MAX`, and at most
 *    `CREST_BREATHER_SHARE` of the phrase's own straight. Every bearing, every radius
 *    and every phrase boundary is untouched, so the heading budget and the
 *    no-crossing bound are exactly what they were; a delayed phrase just has a
 *    shorter breather.
 *  - A DECISION LIVES INSIDE ONE CHECKPOINT INTERVAL. A phrase whose possible span —
 *    laid-out start to last corner's end plus the room — crosses a multiple of
 *    `CHECKPOINT_SPACING` is never moved. That is the safe variant, and it is what
 *    lets any interval be decided from its own checkpoint alone: a SCOUT walks the
 *    interval with `stepNode` from the checkpoint — the same doubles the spine walk
 *    and a block replay produce — and decides each eligible phrase as it reaches the
 *    laid-out start, so every later decision sees the road the earlier ones made.
 *    The checkpoints come from the spine when there is one; otherwise the heading
 *    chains them itself, interval by interval, exactly as the spine walk would.
 *  - THE PROBE: from the scout's position, project the held bearing ahead in
 *    `CREST_PROBE_STEP` steps and read the landscape. A crest is a local high point
 *    followed by at least `CREST_DROP_M` of fall within `CREST_DROP_RUN`; of the
 *    crests the room can reach, the one with the biggest fall wins, and the phrase
 *    starts `CREST_LEAD` past it. A phrase that is already starting downhill takes
 *    the lead and no more. No brow in reach: the phrase stays where it was laid out.
 *
 * Cost: one scout per checkpoint interval that has an eligible phrase, walked only as
 * far as its last one, plus about twenty landscape reads per phrase. A Road replaying a
 * new 10 km block pays it once; the spine build roughly doubles in hilly districts.
 * Never per frame, and every buffer is preallocated.
 */
const CREST_SHIFT_MAX = 240;
const CREST_BREATHER_SHARE = 0.5;
const CREST_LEAD = 25;
const CREST_PROBE_STEP = 16;
/** Fall that makes a high point a brow, over the run after it: a 1.6% average drop. */
const CREST_DROP_RUN = 96;
const CREST_DROP_M = 1.5;
/** Probe samples: the room, the drop run and a step either side, with headroom. */
const CREST_PROBE_SAMPLES = 32;

/**
 * Metres between the spine's position checkpoints, and the interval a crest decision
 * is confined to. Here rather than in roadspine.ts because the heading needs it and
 * roadspine.ts imports this module. 10 km = 2500 nodes to replay, ~0.5 ms.
 */
export const CHECKPOINT_SPACING = 10_000;
const INTERVAL_NODES = CHECKPOINT_SPACING / NODE_SPACING;
/** Eligible phrases one interval can hold: phrases are over a kilometre long. */
const MAX_INTERVAL_PHRASES = 32;
/** Intervals whose decisions are kept. Road keeps eight blocks; this keeps more. */
const DECISION_SLOTS = 16;

/** Position checkpoints every `CHECKPOINT_SPACING`, index 0 at s = 0. */
export interface HeadingCheckpoints {
  readonly checkpointX: Float64Array;
  readonly checkpointZ: Float64Array;
}

/** One district's phrases. `phraseStart[phrases]` is the district's end, exactly. */
interface DistrictLayout {
  index: number;
  start: number;
  end: number;
  character: RoadCharacter;
  phrases: number;
  readonly phraseStart: Float64Array;
  readonly corners: Uint8Array;
  used: number;
}

/** One phrase, laid out. Corner positions are relative to `start` and unshifted. */
interface PhraseLayout {
  district: number;
  phrase: number;
  start: number;
  corners: number;
  from: number;
  readonly target: Float64Array;
  readonly cornerStart: Float64Array;
  readonly cornerLength: Float64Array;
  /** How late the crest coupling may start the phrase, metres; 0 if it may not. */
  room: number;
  used: number;
}

/** The crest decisions of one checkpoint interval, in arclength order. */
interface IntervalDecisions {
  interval: number;
  count: number;
  readonly p0: Float64Array;
  readonly room: Float64Array;
  readonly from: Float64Array;
  /** NaN until the scout reaches the phrase. */
  readonly shift: Float64Array;
  used: number;
}

function newDistrictLayout(): DistrictLayout {
  return {
    index: -1,
    start: 0,
    end: 0,
    character: characterOf(0, 0),
    phrases: 0,
    phraseStart: new Float64Array(MAX_DISTRICT_PHRASES + 1),
    corners: new Uint8Array(MAX_DISTRICT_PHRASES),
    used: 0,
  };
}

function newPhraseLayout(): PhraseLayout {
  return {
    district: -1,
    phrase: -1,
    start: 0,
    corners: 0,
    from: 0,
    target: new Float64Array(MAX_PHRASE_CORNERS),
    cornerStart: new Float64Array(MAX_PHRASE_CORNERS),
    cornerLength: new Float64Array(MAX_PHRASE_CORNERS),
    room: 0,
    used: 0,
  };
}

function newIntervalDecisions(): IntervalDecisions {
  return {
    interval: -1,
    count: 0,
    p0: new Float64Array(MAX_INTERVAL_PHRASES),
    room: new Float64Array(MAX_INTERVAL_PHRASES),
    from: new Float64Array(MAX_INTERVAL_PHRASES),
    shift: new Float64Array(MAX_INTERVAL_PHRASES),
    used: 0,
  };
}

/** Index of the phrase of `d` holding `s`: the last whose start is at or before it. */
function phraseIndex(d: DistrictLayout, s: number): number {
  let lo = 0;
  let hi = d.phrases - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (d.phraseStart[mid]! <= s) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Heading at arclength s, radians, and its derivative.
 *
 * Ramped in over the runout so the road leaves the house on the trunk bearing — which
 * is heading zero, i.e. +Z — and then blends into the full heading field.
 *
 * Every cache in here is MEMOISATION of a pure function of (seed, s): a value is the
 * same whether it came from a cache, a recomputation, the spine worker or a block
 * replay. The crest decisions are pure too, given the checkpoints, which are
 * themselves the walk of this same field from zero.
 */
export class RoadHeading {
  private readonly route: Noise1D;
  private readonly seed: number;
  private readonly turnMagnitudeSeed: number;
  private readonly turnTimingSeed: number;
  private readonly turnRadiusSeed: number;
  private readonly phraseSeed: number;
  private readonly turnParity: number;
  private readonly landscape: Landscape;
  private readonly checkpointSource: (() => HeadingCheckpoints) | undefined;
  /**
   * Character scratch, reused. `at` is called ten million times for a spine walk and
   * three times per curvature sample; a fresh object per call would be an allocation
   * in the hottest path the world has.
   */
  private readonly character = newCharacterBuffer();
  private readonly district = newDistrictBuffer();
  private readonly districts: DistrictLayout[] = [newDistrictLayout(), newDistrictLayout()];
  private readonly phrases: PhraseLayout[] = [newPhraseLayout(), newPhraseLayout()];
  private readonly decisions: IntervalDecisions[] = Array.from(
    { length: DECISION_SLOTS },
    newIntervalDecisions,
  );
  private clock = 0;
  /** Scratch for layouts that must not disturb the caches. */
  private readonly previousDistrict = newDistrictLayout();
  private readonly scoutPhrase = newPhraseLayout();
  private readonly fromTarget = new Float64Array(MAX_PHRASE_CORNERS);
  private readonly radius = new Float64Array(MAX_PHRASE_CORNERS);
  private readonly probe = new Float64Array(CREST_PROBE_SAMPLES);
  private readonly scoutNode: NodeState = { x: 0, z: 0 };
  /** Checkpoints known so far: copied from the source, or chained by scouting. */
  private readonly checkpointX: number[] = [0];
  private readonly checkpointZ: number[] = [0];

  /**
   * `checkpoints` hands over the spine's position checkpoints, so a crest decision
   * deep in the road replays one interval instead of walking from the house. Without
   * it the heading chains its own, which is the same walk and the same doubles.
   */
  constructor(seed: number, checkpoints?: () => HeadingCheckpoints) {
    const s = seed >>> 0;
    this.seed = s;
    this.route = new Noise1D(s ^ 0x9e3779b9);
    this.turnMagnitudeSeed = (s ^ 0x3c6ef372) >>> 0;
    this.turnTimingSeed = (s ^ 0x85ebca6b) >>> 0;
    this.turnRadiusSeed = (s ^ 0xc2b2ae35) >>> 0;
    this.phraseSeed = (s ^ 0x165667b1) >>> 0;
    this.turnParity = s & 1;
    this.landscape = new Landscape(s);
    this.checkpointSource = checkpoints;
  }

  /**
   * Cuts district `k` into phrases. Draws corner counts until the phrases cover the
   * district, keeps whichever of the last two totals is nearer its length, and scales
   * every phrase by the one factor that makes them tile it.
   */
  private layoutDistrict(k: number, out: DistrictLayout): void {
    const start = districtStartOf(this.seed, k);
    const end = districtStartOf(this.seed, k + 1);
    const c = characterOf(this.seed, k);
    const length = end - start;
    const span = c.phraseMax - c.phraseMin + 1;
    let n = 0;
    let total = 0;
    let previousTotal = 0;
    while (n < MAX_DISTRICT_PHRASES && total < length) {
      previousTotal = total;
      const m = Math.min(
        c.phraseMax,
        c.phraseMin + Math.floor(hashUnit3(this.phraseSeed, k, n * 8) * span),
      );
      out.corners[n] = m;
      total += m * c.cornerSpacing;
      n++;
    }
    if (n > 1 && total - length > length - previousTotal) {
      n--;
      total = previousTotal;
    }
    // The last phrase must end on the district's side; when the alternation leaves it
    // on the other one it needs an odd number of flips, and a lone corner has none.
    if (((n - 1) & 1) === 1 && out.corners[n - 1] === 1) {
      out.corners[n - 1] = 2;
      total += c.cornerSpacing;
    }
    const scale = length / total;
    let at = start;
    for (let i = 0; i < n; i++) {
      out.phraseStart[i] = at;
      at += out.corners[i]! * c.cornerSpacing * scale;
    }
    out.phraseStart[n] = end;
    out.index = k;
    out.start = start;
    out.end = end;
    out.character = c;
    out.phrases = n;
  }

  /**
   * The district `s` falls in, laid out. A range test on the cached bounds is the
   * same test `districtAt` makes, so a hit and a miss agree to the bit.
   */
  private districtFor(s: number): DistrictLayout {
    const slots = this.districts;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]!;
      if (slot.index >= 0 && s >= slot.start && s < slot.end) {
        slot.used = ++this.clock;
        return slot;
      }
    }
    districtAt(this.seed, s, this.district);
    const victim = slots[0]!.used <= slots[1]!.used ? slots[0]! : slots[1]!;
    this.layoutDistrict(this.district.index, victim);
    victim.used = ++this.clock;
    return victim;
  }

  /**
   * Bearings and peak radii of phrase `i` of district `k`, which has `n` phrases and
   * gives this one `m` corners.
   *
   * Sides: district `k`'s last bearing lies on the side its parity names. Its phrases
   * start on that side for even `i` and the other for odd, and end where they started
   * — except the last, which ends on the district's side. Every corner flips side
   * except at most one same-side step, placed so the count of flips has the parity
   * that asks for.
   */
  private phraseShape(
    k: number,
    i: number,
    n: number,
    m: number,
    c: RoadCharacter,
    target: Float64Array,
    radius: Float64Array,
  ): void {
    const districtSide = ((k + this.turnParity) & 1) === 0 ? 1 : -1;
    const first = (i & 1) === 0 ? districtSide : -districtSide;
    const flips = i === n - 1 && ((n - 1) & 1) === 1 ? 1 : 0;
    const compoundAt =
      ((m - 1 - flips) & 1) === 1
        ? 1 + Math.floor(hashUnit3(this.phraseSeed, k, i * 8 + 1) * (m - 1))
        : -1;
    const tightens = hashUnit3(this.phraseSeed, k, i * 8 + 2) < 0.5;
    const range = c.headingMax - c.headingMin;
    const drift = tightens ? -RADIUS_SHAPE_SLOPE : RADIUS_SHAPE_SLOPE;
    let sign = first;
    for (let j = 0; j < m; j++) {
      if (j > 0 && j !== compoundAt) sign = -sign;
      const draw = hashUnit3(this.turnMagnitudeSeed, k, i * 8 + j);
      let magnitude = c.headingMin + range * draw;
      const low = c.headingMin + range * COMPOUND_BAND * draw;
      const high = c.headingMax - range * COMPOUND_BAND * draw;
      if (j === compoundAt - 1) magnitude = tightens ? low : high;
      else if (j === compoundAt) magnitude = tightens ? high : low;
      target[j] = sign * magnitude;

      const along = m > 1 ? j / (m - 1) - 0.5 : 0;
      const jitter = (hashUnit3(this.turnRadiusSeed, k, i * 8 + j) - 0.5) * RADIUS_JITTER;
      const u = Math.min(1, Math.max(0, 0.5 + jitter + drift * along));
      radius[j] = c.radiusMin + (c.radiusMax - c.radiusMin) * u;
    }
  }

  /** The bearing phrase `i` of district layout `d` starts from: its predecessor's last. */
  private phraseFrom(i: number, d: DistrictLayout): number {
    if (i > 0) {
      const m = d.corners[i - 1]!;
      this.phraseShape(d.index, i - 1, d.phrases, m, d.character, this.fromTarget, this.radius);
      return this.fromTarget[m - 1]!;
    }
    if (d.index <= 0) return 0;
    const p = this.previousDistrict;
    this.layoutDistrict(d.index - 1, p);
    const m = p.corners[p.phrases - 1]!;
    this.phraseShape(p.index, p.phrases - 1, p.phrases, m, p.character, this.fromTarget, this.radius);
    return this.fromTarget[m - 1]!;
  }

  /**
   * Lays phrase `i` of `d` out: each corner takes its link and its transition, and the
   * last takes what is left, holding the breather after it.
   *
   * A corner whose link and transition want more than an even share of what the phrase
   * has left takes that share, link first to go: it then runs at a tighter radius than
   * drawn, which is a firmer corner, not a kink. A phrase owns one `cornerSpacing` per
   * corner, so on average that is no tighter than the old one-corner sections made it.
   */
  private layoutPhrase(i: number, d: DistrictLayout, out: PhraseLayout): void {
    const k = d.index;
    const c = d.character;
    const m = d.corners[i]!;
    const from = this.phraseFrom(i, d);
    this.phraseShape(k, i, d.phrases, m, c, out.target, this.radius);
    const start = d.phraseStart[i]!;
    const length = d.phraseStart[i + 1]! - start;
    let used = 0;
    let previous = from;
    let slack = 0;
    for (let j = 0; j < m; j++) {
      const target = out.target[j]!;
      const want = transitionLength(this.radius[j]!, Math.abs(target - previous));
      const link =
        c.linkMin + (c.linkMax - c.linkMin) * hashUnit3(this.turnTimingSeed, k, i * 8 + j);
      const last = j === m - 1;
      const share = last ? length - used : Math.min(link + want, (length - used) / (m - j));
      const gap = Math.min(link, Math.max(0, share - want));
      const corner = Math.min(want, share - gap);
      out.cornerStart[j] = used + gap;
      out.cornerLength[j] = corner;
      if (last) slack = share - gap - corner;
      used += share;
      previous = target;
    }

    let room = 0;
    if (c.crestChance > 0 && hashUnit3(this.phraseSeed, k, i * 8 + 3) < c.crestChance) {
      const reach = Math.min(CREST_SHIFT_MAX, slack * CREST_BREATHER_SHARE);
      const p0 = start + out.cornerStart[0]!;
      const latest = start + out.cornerStart[m - 1]! + out.cornerLength[m - 1]! + reach;
      if (
        reach >= CREST_PROBE_STEP &&
        Math.floor(p0 / CHECKPOINT_SPACING) === Math.floor(latest / CHECKPOINT_SPACING)
      ) {
        room = reach;
      }
    }

    out.district = k;
    out.phrase = i;
    out.start = start;
    out.corners = m;
    out.from = from;
    out.room = room;
  }

  /** The phrase `s` falls in, laid out and cached two deep. */
  private phraseAt(s: number): PhraseLayout {
    const d = this.districtFor(s);
    const i = phraseIndex(d, s);
    const slots = this.phrases;
    for (let j = 0; j < slots.length; j++) {
      const slot = slots[j]!;
      if (slot.district === d.index && slot.phrase === i) {
        slot.used = ++this.clock;
        return slot;
      }
    }
    const victim = slots[0]!.used <= slots[1]!.used ? slots[0]! : slots[1]!;
    this.layoutPhrase(i, d, victim);
    victim.used = ++this.clock;
    return victim;
  }

  /**
   * The corner bearing at `s`.
   *
   * A PHRASE MUST ARRIVE AT THE BEARING THE NEXT PHRASE STARTS FROM, and so must every
   * corner inside it at the one after. The bearing chain is a sequence of drawn
   * targets — that is what keeps the heading bounded — so a corner that turned less
   * than the gap to its own target would hand the next one a bearing it does not start
   * from, and the heading would STEP at the join. Measured on the old one-corner
   * sections: 108 of 319 on seed 1337, up to 45.6 degrees, a crease in plan and a
   * full-width spike in `curvatureAt` that put a step in the deck at the wheel tracks
   * (see `roadsurface.ts`). So the angle never gives way; the layout gives the length.
   *
   * The crest shift is looked up only inside the span it could change, and the phrase
   * is fetched again after it, because the lookup may scout — which walks this very
   * function and reuses the caches.
   */
  private turnAt(s: number): number {
    if (s < 0) return 0;
    let phrase = this.phraseAt(s);
    let shift = 0;
    if (phrase.room > 0) {
      const p0 = phrase.start + phrase.cornerStart[0]!;
      const last = phrase.corners - 1;
      const latest =
        phrase.start + phrase.cornerStart[last]! + phrase.cornerLength[last]! + phrase.room;
      if (s > p0 && s < latest) {
        shift = this.crestShift(p0);
        phrase = this.phraseAt(s);
      }
    }
    const u = s - phrase.start - shift;
    let bearing = phrase.from;
    for (let j = 0; j < phrase.corners; j++) {
      const a = phrase.cornerStart[j]!;
      if (u <= a) return bearing;
      const length = phrase.cornerLength[j]!;
      const target = phrase.target[j]!;
      if (u < a + length) return bearing + (target - bearing) * smootherstep01((u - a) / length);
      bearing = target;
    }
    return bearing;
  }

  /** How late the phrase laid out to start at `p0` starts, metres. */
  private crestShift(p0: number): number {
    const interval = Math.floor(p0 / CHECKPOINT_SPACING);
    const d = this.findDecisions(interval) ?? this.scout(interval, false);
    d.used = ++this.clock;
    for (let e = 0; e < d.count; e++) {
      if (d.p0[e] === p0) {
        const shift = d.shift[e]!;
        if (Number.isNaN(shift)) throw new Error(`crest decision at ${p0} read before it was made`);
        return shift;
      }
    }
    throw new Error(`no crest decision for the phrase at ${p0}`);
  }

  private findDecisions(interval: number): IntervalDecisions | undefined {
    for (let i = 0; i < this.decisions.length; i++) {
      if (this.decisions[i]!.interval === interval) return this.decisions[i];
    }
    return undefined;
  }

  /** Makes checkpoint `b` known: from the source if it has it, else by chaining. */
  private ensureCheckpoint(b: number): void {
    if (b < this.checkpointX.length) return;
    const source = this.checkpointSource?.();
    if (source) {
      for (let k = this.checkpointX.length; k < source.checkpointX.length; k++) {
        this.checkpointX.push(source.checkpointX[k]!);
        this.checkpointZ.push(source.checkpointZ[k]!);
      }
    }
    while (this.checkpointX.length <= b) this.scout(this.checkpointX.length - 1, true);
  }

  /**
   * Decides every crest-eligible phrase that is laid out to start in `interval`, by
   * walking the road from the interval's checkpoint and probing ahead at each one.
   * With `extend`, walks the whole interval and records the next checkpoint.
   */
  private scout(interval: number, extend: boolean): IntervalDecisions {
    this.ensureCheckpoint(interval);
    let d = this.findDecisions(interval);
    if (!d) {
      d = this.decisions[0]!;
      for (let i = 1; i < this.decisions.length; i++) {
        if (this.decisions[i]!.used < d.used) d = this.decisions[i]!;
      }
    }
    d.interval = interval;
    d.count = 0;
    d.used = ++this.clock;

    const lo = interval * CHECKPOINT_SPACING;
    const hi = lo + CHECKPOINT_SPACING;
    const phrase = this.scoutPhrase;
    let s = lo;
    for (;;) {
      const district = this.districtFor(s);
      let past = false;
      for (let i = phraseIndex(district, s); i < district.phrases; i++) {
        this.layoutPhrase(i, district, phrase);
        const p0 = phrase.start + phrase.cornerStart[0]!;
        if (p0 >= hi) {
          past = true;
          break;
        }
        if (phrase.room > 0 && p0 >= lo) {
          if (d.count === MAX_INTERVAL_PHRASES) throw new Error('too many crest phrases in one interval');
          d.p0[d.count] = p0;
          d.room[d.count] = phrase.room;
          d.from[d.count] = phrase.from;
          d.shift[d.count] = Number.NaN;
          d.count++;
        }
      }
      if (past || district.end >= hi) break;
      s = district.end;
    }

    const node = this.scoutNode;
    node.x = this.checkpointX[interval]!;
    node.z = this.checkpointZ[interval]!;
    const first = interval * INTERVAL_NODES;
    let next = 0;
    let n = 0;
    for (; n < INTERVAL_NODES; n++) {
      const sample = (first + n) * NODE_SPACING + CURVATURE_STEP;
      while (next < d.count && d.p0[next]! <= sample) {
        d.shift[next] = this.decide(node.x, node.z, (first + n) * NODE_SPACING, next, d);
        next++;
      }
      if (next === d.count && !extend) break;
      stepNode(node, this, first + n);
    }
    while (next < d.count) {
      d.shift[next] = this.decide(node.x, node.z, (first + n) * NODE_SPACING, next, d);
      next++;
    }
    if (extend && this.checkpointX.length === interval + 1) {
      this.checkpointX.push(node.x);
      this.checkpointZ.push(node.z);
    }
    return d;
  }

  /**
   * The crest probe for entry `e`, from the road's own position `(x, z)` at `s`, just
   * before the phrase's laid-out start. Projects the held bearing — which is exactly
   * the road for as long as the phrase is delayed — and returns the delay.
   */
  private decide(x: number, z: number, s: number, e: number, d: IntervalDecisions): number {
    const p0 = d.p0[e]!;
    const room = d.room[e]!;
    const from = d.from[e]!;
    const lastCrest = p0 + room - CREST_LEAD;
    const run = CREST_DROP_RUN / CREST_PROBE_STEP;
    const samples = Math.min(
      CREST_PROBE_SAMPLES - 1,
      Math.ceil((lastCrest + CREST_DROP_RUN - s) / CREST_PROBE_STEP),
    );
    const heights = this.probe;
    let px = x;
    let pz = z;
    heights[0] = this.landscape.heightAt(px, pz);
    for (let j = 1; j <= samples; j++) {
      const h = this.compose(s + (j - 0.5) * CREST_PROBE_STEP, from);
      px += Math.sin(h) * CREST_PROBE_STEP;
      pz += Math.cos(h) * CREST_PROBE_STEP;
      heights[j] = this.landscape.heightAt(px, pz);
    }
    let best = -1;
    let bestFall = 0;
    for (let j = 0; j + run <= samples && s + j * CREST_PROBE_STEP <= lastCrest; j++) {
      const here = heights[j]!;
      if (j > 0 && here < heights[j - 1]!) continue;
      if (here <= heights[j + 1]!) continue;
      const fall = here - heights[j + run]!;
      if (fall >= CREST_DROP_M && fall > bestFall) {
        bestFall = fall;
        best = j;
      }
    }
    if (best < 0) return 0;
    return Math.min(room, Math.max(0, s + best * CREST_PROBE_STEP + CREST_LEAD - p0));
  }

  /** Route wander plus a corner bearing, ramped in over the runout. */
  private compose(s: number, turn: number): number {
    const ramp = Math.min(1, Math.max(0, (s - STRAIGHT_RUNOUT) / STRAIGHT_RUNOUT));
    // The route wander is the district's too — it is the difference between a road
    // that is straight and one that is merely never quite straight — and it is read
    // with the CROSSFADED character, because unlike the cadence it is a continuous
    // quantity and a step in it would be a step in the heading.
    characterAt(this.seed, s, this.character);
    const route =
      this.route.fbm(s / ROUTE_WAVELENGTH, ROUTE_OCTAVES, 2.1, ROUTE_GAIN) *
      this.character.deviation;
    return (route + turn) * ramp;
  }

  at(s: number): number {
    return this.compose(s, this.turnAt(s));
  }


  /**
   * Signed curvature, radians per metre, by central difference on the heading.
   *
   * Differenced rather than duplicated analytically because the heading combines the
   * slow noise field, the runout clamp and seeded smootherstep transitions. Camber and
   * the HUD are the only consumers and neither can tell the difference.
   */
  /**
   * Cross-slope at `s`, signed so a positive curvature banks the mat down toward the
   * inside of the bend. Zero on a straight and on a road nobody surveyed.
   */
  bankingAt(s: number): number {
    const curvature = this.curvatureAt(s);
    const magnitude = Math.abs(curvature);
    if (magnitude < 1e-5) return 0;
    characterAt(this.seed, s, this.character);
    const demand =
      (this.character.designSpeedKmh * this.character.designSpeedKmh) /
        (127 / magnitude) -
      F_DESIGN;
    return Math.sign(curvature) * Math.min(E_MAX, Math.max(0, demand)) * this.character.bankShare;
  }

  curvatureAt(s: number): number {
    return (this.at(s + CURVATURE_STEP) - this.at(s - CURVATURE_STEP)) / (2 * CURVATURE_STEP);
  }
}

/**
 * One integration node, carried between steps. Mutated in place by `stepNode`, which
 * is called ten million times for a 40 000 km spine walk and must not allocate.
 *
 * No heading: it is a function of arclength now, so a node cannot carry a stale one
 * and a checkpoint has nothing to store but a position.
 */
export interface NodeState {
  x: number;
  z: number;
}

/**
 * Advances `node` from integration index `i` to `i + 1`.
 *
 * Midpoint rule: the heading is taken at the segment's centre, which is second-order
 * accurate and matters over ten million nodes. It used to average the headings at the
 * two ends, which is the same rule reached the long way round when heading had to be
 * integrated alongside position; with an analytic heading the centre is available
 * directly. Only XZ is integrated — elevation is READ from the landscape at the
 * node's own position, so it carries no state and cannot drift.
 */
export function stepNode(node: NodeState, heading: RoadHeading, i: number): void {
  const h = heading.at(i * NODE_SPACING + CURVATURE_STEP);
  node.x += Math.sin(h) * NODE_SPACING;
  node.z += Math.cos(h) * NODE_SPACING;
}
