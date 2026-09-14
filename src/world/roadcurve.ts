import { hashUnit2, hashUnit3, Noise1D } from '../core/rng';
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
 * THE CORNER SEQUENCE, and every number in it now comes from the district.
 *
 * The shape is unchanged and it is a good shape: each section transitions from one
 * signed bearing to the opposite sign, so the turn is guaranteed, and seeded timing,
 * angle and radius stop the cadence reading like a metronome. A quintic smootherstep
 * supplies entry, one peak-curvature apex and exit with zero curvature at both ends.
 *
 * WHAT CHANGED IS THAT ONE SET OF CONSTANTS USED TO SERVE THE WHOLE ROAD: a corner
 * every kilometre, 25-60 degrees, 85-140 m of peak radius, everywhere, for forty
 * thousand kilometres. Measured over 40 km of it, the median radius came out at 3 km
 * and the geometry allowed 350 km/h at the median — the road asked nothing of anyone.
 * Cadence, radius, angle, route wander and the straight share are properties of the
 * KIND of road, so they live in `roadcharacter.ts` and are read per section here.
 *
 * THE TRANSITION IS A CLOTHOID BUDGET, NOT A CONSTANT. Smootherstep's maximum
 * derivative is 1.875, so a transition of `1.875 · Δθ · R` makes the requested peak
 * radius true by construction — that is the geometry. What the length ALSO has to
 * respect is how fast the curvature is allowed to arrive, because lateral jerk is
 * `v³ · dκ/ds` and a corner entered in twenty metres is a flick of the wheel however
 * correct its apex is. Road design sizes transition curves from exactly this, so the
 * length is the longer of the two requirements: the geometric one, and `v³ · Δκ / j`
 * at the speed the corner itself allows.
 */
const TURN_START_MIN = 120;
const TURN_START_MAX = 300;
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
 * Heading at arclength s, radians, and its derivative.
 *
 * Ramped in over the runout so the road leaves the house on the trunk bearing — which
 * is heading zero, i.e. +Z — and then blends into the full heading field.
 */
export class RoadHeading {
  private readonly route: Noise1D;
  private readonly seed: number;
  private readonly turnMagnitudeSeed: number;
  private readonly turnTimingSeed: number;
  private readonly turnRadiusSeed: number;
  private readonly turnParity: number;
  /**
   * Character scratch, reused. `at` is called ten million times for a spine walk and
   * three times per curvature sample; a fresh object per call would be an allocation
   * in the hottest path the world has.
   */
  private readonly character = newCharacterBuffer();
  private readonly district = newDistrictBuffer();

  constructor(seed: number) {
    const s = seed >>> 0;
    this.seed = s;
    this.route = new Noise1D(s ^ 0x9e3779b9);
    this.turnMagnitudeSeed = (s ^ 0x3c6ef372) >>> 0;
    this.turnTimingSeed = (s ^ 0x85ebca6b) >>> 0;
    this.turnRadiusSeed = (s ^ 0xc2b2ae35) >>> 0;
    this.turnParity = s & 1;
  }


  /**
   * The bearing the section holds, and every section belongs to ONE district.
   *
   * Sections are laid out by dividing the district's own length into a whole number of
   * them, so a district boundary is always a section boundary and the cadence inside a
   * district never moves. That is what keeps the heading field continuous: a section
   * starts from its predecessor's bearing, and the predecessor of a district's first
   * section is the LAST section of the district before it, computed from that
   * district's own character.
   */
  private sectionTarget(district: number, index: number, c: RoadCharacter): number {
    const magnitude =
      c.headingMin +
      (c.headingMax - c.headingMin) *
        hashUnit3(this.turnMagnitudeSeed, district, index);
    return ((district + index + this.turnParity) & 1) === 0 ? magnitude : -magnitude;
  }

  private sectionsIn(start: number, end: number, spacing: number): number {
    return Math.max(1, Math.round((end - start) / spacing));
  }

  private turnAt(s: number): number {
    districtAt(this.seed, s, this.district);
    const k = this.district.index;
    const c = characterOf(this.seed, k);
    const sections = this.sectionsIn(this.district.start, this.district.end, c.cornerSpacing);
    const sectionLength = (this.district.end - this.district.start) / sections;
    const index = Math.min(
      sections - 1,
      Math.max(0, Math.floor((s - this.district.start) / sectionLength)),
    );
    const local = s - this.district.start - index * sectionLength;

    const from =
      index > 0
        ? this.sectionTarget(k, index - 1, c)
        : this.previousDistrictTarget(k);
    const drawn = this.sectionTarget(k, index, c);
    const radius =
      c.radiusMin +
      (c.radiusMax - c.radiusMin) * hashUnit3(this.turnRadiusSeed, k, index);
    // The turning part of a section is what the character leaves for it. A pan road
    // holds its bearing for four fifths of four kilometres; an esses district gives its
    // corner almost the whole 700 m and reads as one continuous rhythm.
    const room = sectionLength * (1 - c.straightShare);
    // WHEN THE ROOM IS SHORT, THE ANGLE GIVES WAY — NOT THE RADIUS.
    //
    // Both are authored, but only one can be honoured in a section that cannot hold the
    // whole transition, and they fail differently: a clamped LENGTH makes the corner
    // tighter than the character asked for, so a pan road would quietly acquire 700 m
    // hairpins, while a reduced ANGLE makes it a kink instead of a corner — which is
    // what a pan road's corners are. So the heading change is scaled to fit and the
    // peak radius stays true by construction.
    let change = drawn - from;
    let length = transitionLength(radius, Math.abs(change));
    if (length > room && room > 0) {
      change *= room / length;
      length = Math.min(room, transitionLength(radius, Math.abs(change)));
    }
    const start = Math.min(
      Math.max(0, sectionLength - length),
      TURN_START_MIN +
        (TURN_START_MAX - TURN_START_MIN) * hashUnit3(this.turnTimingSeed, k, index),
    );

    if (local <= start) return from;
    if (local >= start + length) return from + change;
    return from + change * smootherstep01((local - start) / length);
  }

  /** The bearing the district before `k` ended on, in its own character's terms. */
  private previousDistrictTarget(k: number): number {
    if (k <= 0) return 0;
    const previous = characterOf(this.seed, k - 1);
    const start = districtStartOf(this.seed, k - 1);
    const end = districtStartOf(this.seed, k);
    const sections = this.sectionsIn(start, end, previous.cornerSpacing);
    return this.sectionTarget(k - 1, sections - 1, previous);
  }

  at(s: number): number {
    const ramp = Math.min(1, Math.max(0, (s - STRAIGHT_RUNOUT) / STRAIGHT_RUNOUT));
    const turn = this.turnAt(s);
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
