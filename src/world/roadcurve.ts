import { hashUnit2, hashUnit3, Noise1D } from '../core/rng';
import { characterAt, characterOf, districtAt, districtStartOf, newCharacterBuffer, newDistrictBuffer, type RoadCharacter } from './roadcharacter';
import { villageSpanCovering } from './village';

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
const ROUTE_WAVELENGTH = 3600;
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
 * 0.75 m/s³ sits at the top of the range road guidance uses (0.3-0.6) and 4 m/s² is
 * the cornering budget an ordinary traffic car actually spends — the careful mode's
 * own figure is 3.2 and the hurried one's 4.7 — so the entry this sizes is the one a
 * stream car will really arrive at. It is deliberately NOT the frantic figure: a
 * transition long enough for the calm majority is comfortable for everybody, while
 * one sized for the fastest driver is a flick for the rest.
 */
const TRANSITION_JERK_MPS3 = 0.75;
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

/**
 * The heading budget the no-crossing theorem gives: `deviation + headingMax + village`
 * must stay under 90 degrees. 1.42 rad leaves the theorem three degrees of slack.
 */
const HEADING_BUDGET = 1.42;

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
  /**
   * The bend a VILLAGE gets, radians, or 0 where the section has no village in it.
   *
   * THE ONE LAND TIE THE HEADING CAN MAKE, and the reason is in the architecture rather
   * than in the countryside: the heading is a pure function of arclength, so a feature can
   * bend the road only if it is PLACED ALONG THE ROAD. A village is — it is a schedule in
   * `world/village.ts`, exactly as the surface changes and the roadside eras are — while a
   * stream, a ravine, a ridge or a wood edge is a two-dimensional field, and where the road
   * meets one of those depends on where the road has already got to. That is an ODE, not a
   * function of `s`, and it is the thing the three integrators must agree on bit for bit
   * (see the header); it is named in the plan as its own piece of work.
   *
   * WHAT THE BEND IS. A road does not pass a village in a straight line for no reason: the
   * street follows the bend, or the road swings round the outside of one. So a section that
   * has a village in the middle of its street gets a LARGER heading change than its
   * character asked for — added to the section's own bend, never subtracted, so the cadence
   * cannot drop to nothing. The direction is the section's own, which already turns over
   * from section to section, so one village is swung one way and the next the other.
   *
   * `HEADING_BUDGET` keeps `deviation + headingMax + this` inside the no-crossing budget:
   * the largest characters spend 1.25 rad, and 0.2 more still leaves the guarantee whole.
   */
  private villageBend(index: number, s: number, c: RoadCharacter, turnBudget: number): number {
    const village = villageSpanCovering(this.seed, s);
    if (!village) return 0;
    const magnitude = 0.2 + 0.14 * hashUnit3(this.turnMagnitudeSeed, village.index, 0x811c);
    const sign = hashUnit3(this.turnTimingSeed ^ 0x51ab3f, village.index, 7) < 0.5 ? -1 : 1;
    // The village's own direction, drawn from its index: the road curves through this
    // village one way and through the next one the other.
    //
    // IT KEEPS ITS SIGN, AND THE REVIEW'S `Math.abs(bend)` IS NOT LANDED. Making the bend
    // only ever add to the section's own |bearing| reads better against this block's own
    // text, and it was tried: measured with `tools/road-selfcross.ts`, the tightest corner
    // on the road fell to 65 m on seeds 1 and 7 and 67 m on seed 42, against that guard's
    // 68 m floor (85 m authored, 20% of tolerance), where the signed bend holds 68 on all
    // four. The reason is that what a corner has to turn is `drawn - from` — the difference
    // between THIS section's bearing and the PREVIOUS one's — so a bend that always adds
    // loads every section with its predecessor's added bend as well, and no per-section
    // budget can see that. Bounding the pair needs the two sections' bends solved together,
    // which is a change to how a section's bearing is assembled, not to this function.
    const room = Math.max(0, HEADING_BUDGET - c.deviation - c.headingMax);
    return sign * Math.min(magnitude, room, turnBudget);
  }

  /**
   * THE BEARING A SECTION ENDS ON, and the ONE place a section's bend is assembled.
   *
   * Both the section's own target and the bend its village adds, because the NEXT
   * section starts from whatever this one actually reached: adding a village to the
   * target in one place and not in the other is a heading step of the village's own
   * size at the section's boundary — measured, 17 degrees in four metres, which is the
   * same fault this file already had once.
   */
  private sectionBearing(
    k: number,
    index: number,
    c: RoadCharacter,
    sectionStart: number,
    sectionLength: number,
  ): number {
    const base = this.sectionTarget(k, index, c);
    const middle = sectionStart + (index + 0.5) * sectionLength;
    // The village's bend is bounded by the CORNER the section can build, not only by the
    // no-crossing budget. A corner of `MIN_CORNER_RADIUS` needs `transitionLength` metres of
    // road per radian it turns — 1.875 of them for the smootherstep's peak slope alone — so
    // a section has room for `room / transitionLength(MIN_CORNER_RADIUS, 1)` radians in
    // total. A bend past that builds a corner tighter than the world's own floor, which is
    // what the added village bend did at first: measured with `tools/road-selfcross.ts`, 65
    // and 67 m against its 68 m floor on seeds 1, 7 and 42, where the floor had held on all
    // four before. (`room / MIN_CORNER_RADIUS` is the same requirement WITHOUT the peak
    // factor, and it is not enough: the smootherstep's peak curvature is 1.875 times its
    // mean, and the guard measures the peak.)
    const room = sectionLength * (1 - c.straightShare);
    const turnBudget = Math.max(
      0,
      room / transitionLength(MIN_CORNER_RADIUS, 1) - Math.abs(base),
    );
    const bend = this.villageBend(index, middle, c, turnBudget);
    return base + bend * (base >= 0 ? 1 : -1);
  }

  private sectionTarget(district: number, index: number, c: RoadCharacter): number {
    const magnitude =
      c.headingMin +
      (c.headingMax - c.headingMin) *
        hashUnit3(this.turnMagnitudeSeed, district, index);
    // The sign holds for `signRun` sections and then turns over, so a kind can be a
    // ribbon of bends (1) or a road that sweeps one way for a kilometre (5).
    const run = Math.max(1, c.signRun);
    const step = Math.floor(index / run) + district;
    return (step + this.turnParity) % 2 === 0 ? magnitude : -magnitude;
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
        ? this.sectionBearing(k, index - 1, c, this.district.start, sectionLength)
        : this.previousDistrictTarget(k);
    // The village's bend rides on the section's own, in the section's own direction: the
    // road curves THROUGH the village rather than only past it.
    const drawn = this.sectionBearing(k, index, c, this.district.start, sectionLength);
    const radius =
      c.radiusMin +
      (c.radiusMax - c.radiusMin) * hashUnit3(this.turnRadiusSeed, k, index);
    // The turning part of a section is what the character leaves for it. A pan road
    // holds its bearing for four fifths of four kilometres; an esses district gives its
    // corner almost the whole 700 m and reads as one continuous rhythm.
    const room = sectionLength * (1 - c.straightShare);
    // WHEN THE ROOM IS SHORT, THE RADIUS GIVES WAY — NOT THE ANGLE, AND NOT THE
    // CONTINUITY.
    //
    // It used to be the other way round: the heading change was scaled down to fit the
    // room while the NEXT section still started from the section's UNSCALED target. So a
    // section whose transition did not fit never reached its bearing, the following
    // section began at a bearing nobody had arrived at, and the heading STEPPED. Measured
    // on seed 1337 with the country's own cadence: a 37-degree step in four metres at
    // s = 42 868, a six-metre radius corner, and a road that is not a road.
    //
    // A section ALWAYS reaches its target now. What gives is the corner, and only ever
    // by tightening it: the radius is solved for the LARGEST value whose transition fits
    // the room, by bisection because both requirements (the geometry and the lateral
    // jerk) fall with the radius and so do not cross twice. The floor is the tightest
    // corner this world builds, so the worst a short section can do is a bend as tight as
    // the catalogue's own `MIN_CORNER_RADIUS` — which is a bend, and not a cliff in the
    // heading field.
    //
    // `lo` HOLDS A RADIUS THAT FITS AND `hi` ONE THAT DOES NOT, because `transitionLength`
    // grows with the radius. The first version had the two the other way round: it returned
    // the SMALLEST radius that still fitted — about 87 m for a section only slightly short
    // of its room — so a village that needed a touch more bend bought a corner three times
    // tighter than the room allowed, and when the very first mid was too long it returned
    // the untouched radius and the jerk sizing was ignored entirely.
    const change = drawn - from;
    let fitted = radius;
    if (room > 0 && transitionLength(radius, Math.abs(change)) > room) {
      let lo = MIN_CORNER_RADIUS;
      let hi = radius;
      for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        if (transitionLength(mid, Math.abs(change)) <= room) lo = mid;
        else hi = mid;
      }
      fitted = lo;
    }
    // The corner is whatever the radius and the angle need, or the room, whichever is less:
    // a room shorter than the tightest corner's transition is still the room.
    const transition = transitionLength(fitted, Math.abs(change));
    const length = room > 0 ? Math.min(room, transition) : transition;
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
    return this.sectionBearing(k - 1, sections - 1, previous, start, (end - start) / sections);
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
