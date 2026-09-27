import * as THREE from 'three';
import { hashUnit3 } from '../core/rng';
import { DwellingBuilder, mix, type P3 } from '../world/dwellings/builder';

/**
 * The stranded fleet of the `ships` tableau: three vessels a player knows by outline
 * alone — a side trawler of the kind the Aral Sea left in the sand, a small freighter
 * with its bridge aft and derricks over the holds, and a barque with bare yards and
 * the rags of her topsails.
 *
 * WHY THREE HULLS AND REAL METRES. The fleet used to be one hull, one unit tall,
 * stretched per instance to any length-to-height ratio between 2.2 and 3.5. A ship is
 * recognised by its proportions — freeboard against length, the sheer climbing to the
 * bow, a tall house on a low hull — and a non-uniform scale throws exactly those away.
 * Each form here is authored at its own size and only ever scaled uniformly.
 *
 * WHAT MAKES ONE READ AS A SHIP, in the order the eye takes it in from the road:
 *   1. the SHEER: the deck edge rises toward the bow in a parabola, and a pale strake
 *      along it draws that line against a dark hull;
 *   2. the ENDS: a raked stem whose head stands forward of its foot, and a transom
 *      that overhangs the sand aft;
 *   3. the HOUSE and its GLASS: a white block with a dark window band, standing on a
 *      hull much longer than it;
 *   4. the TOPHAMPER: masts, booms, a funnel, gallows — thin things against the sky.
 *
 * The hull is a loft of stations with section fullness running from a round-bilged
 * midbody to a V at the stem, smooth-shaded from normals computed off the loft itself,
 * with the deck edge kept as a hard crease. The light is baked into the vertex colours
 * like every other mirage form (the material is unlit), from the port quarter above,
 * so the two flanks of one hull are told apart and the bilge turns into shadow.
 */

/** Hull of one ship, in metres: +X forward, +Y up, keel at y = 0 amidships. */
interface HullSpec {
  readonly length: number;
  readonly beam: number;
  /** Keel to deck edge amidships. */
  readonly depth: number;
  /** Deck-edge rise over amidships at the transom and at the stem. */
  readonly sheerAft: number;
  readonly sheerFore: number;
  /** Half-beam kept at the transom, as a fraction of the full half-beam. */
  readonly transom: number;
  /** Fractions of the length over which the plan closes to the stem and to the transom. */
  readonly entrance: number;
  readonly run: number;
  /** Keel rise at the stem and at the transom, as fractions of the depth. */
  readonly forefoot: number;
  readonly keelRiseAft: number;
  /** Metres the stem head stands forward of its foot, and the transom top aft of its foot. */
  readonly rake: number;
  readonly counter: number;
  /** Extra half-beam at the deck edge in the bow, as a fraction of the local half-beam. */
  readonly flare: number;
  /** Deck crown at the centreline, metres. */
  readonly camber: number;
  readonly paint: {
    readonly bottom: number;
    readonly boot: number;
    readonly topside: number;
    readonly sheer: number;
    readonly deck: number;
    readonly streak: number;
  };
  /**
   * Chance per station band of a rust run down from the deck edge. It stops halfway
   * to the boot top: a full-height band of rust a station wide read as a painted
   * stripe rather than as weather.
   */
  readonly streaks: number;
  /** Section height where the bottom paint ends, the boot top ends, and the sheer strake starts. */
  readonly waterline: number;
  readonly bootTop: number;
  readonly sheerStrake: number;
  readonly salt: number;
}

export interface ShipForm {
  readonly name: 'trawler' | 'freighter' | 'barque';
  readonly build: () => THREE.BufferGeometry;
  /** Hull length and beam, metres at scale 1: the footprint the ground is fitted under. */
  readonly length: number;
  readonly beam: number;
  /** Keel to deck amidships: what the sand is measured against when a hull is buried. */
  readonly depth: number;
  /** Relative frequency in a fleet. */
  readonly share: number;
}

const STATIONS = 22;
/**
 * Section heights, keel to deck edge, as fractions of the local depth. Paint bands
 * change colour on these, so the waterline, boot top and sheer strake of every hull
 * are spliced in rather than approximated.
 */
const BASE_SECTION = [0, 0.03, 0.08, 0.15, 0.24, 0.45, 0.62, 0.76, 1] as const;

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

class Hull {
  private readonly heights: readonly number[];

  constructor(private readonly spec: HullSpec) {
    const bands = [spec.waterline, spec.bootTop, spec.sheerStrake];
    this.heights = [...new Set([...BASE_SECTION, ...bands])].sort((a, b) => a - b);
  }

  /** Station parameter, 0 at the transom foot to 1 at the stem foot. */
  tAt(x: number): number {
    return Math.min(1, Math.max(0, x / this.spec.length + 0.5));
  }

  private bowClosing(t: number): number {
    return Math.max(0, (t - (1 - this.spec.entrance)) / this.spec.entrance);
  }

  private sternClosing(t: number): number {
    return Math.max(0, (this.spec.run - t) / this.spec.run);
  }

  /** Half-beam of the plan at the deck, before flare. */
  halfBeam(t: number): number {
    const u = this.bowClosing(t);
    const v = this.sternClosing(t);
    const bow = Math.pow(Math.max(0, 1 - u * u), 0.62);
    const stern = 1 - (1 - this.spec.transom) * v * v;
    return Math.max(0.035, bow * stern) * this.spec.beam * 0.5;
  }

  /** 1 for the round-bilged midbody, falling to 0 (a V) at the stem and lower aft. */
  private fullness(t: number): number {
    return Math.max(0, (1 - this.bowClosing(t)) * (1 - 0.55 * this.sternClosing(t)));
  }

  keel(t: number): number {
    const s = this.spec;
    return (
      s.depth * s.forefoot * smoothstep(1 - s.entrance * 0.7, 1, t) ** 1.4 +
      s.depth * s.keelRiseAft * smoothstep(s.run, 0, t)
    );
  }

  deck(t: number): number {
    const s = this.spec;
    const k = (t - 0.5) / 0.5;
    return s.depth + (k > 0 ? s.sheerFore : s.sheerAft) * k * k;
  }

  /** Deck height at a length position; what a house or a mast is stood on. */
  deckAt(x: number): number {
    return this.deck(this.tAt(x));
  }

  /** Narrowest deck half-beam over a length range: how wide a house there may be. */
  fit(x0: number, x1: number): number {
    let narrowest = Infinity;
    for (let i = 0; i <= 8; i++) narrowest = Math.min(narrowest, this.halfBeam(this.tAt(x0 + ((x1 - x0) * i) / 8)));
    return narrowest;
  }

  /** Superellipse section: round bilge amidships, a V where `fullness` is zero. */
  private section(h: number, t: number): number {
    const f = this.fullness(t);
    const bilge = 0.26 + 0.74 * (1 - f);
    const p = 1.25 + 1.75 * f;
    const base = h >= bilge ? 1 : Math.pow(1 - Math.pow(1 - h / bilge, p), 1 / p);
    const flare = this.spec.flare * this.bowClosing(t) * Math.max(0, (h - 0.5) / 0.5) ** 2;
    return base + flare;
  }

  /** A point on the starboard (+Z) side at section height `h`. */
  private side(t: number, h: number, sign: number): P3 {
    const s = this.spec;
    const keel = this.keel(t);
    const y = keel + (this.deck(t) - keel) * h;
    const lean = h ** 1.5;
    const x =
      (t - 0.5) * s.length +
      s.rake * lean * smoothstep(1 - s.entrance, 1, t) ** 2 -
      s.counter * lean * smoothstep(s.run, 0, t) ** 2;
    return [x, y, sign * this.halfBeam(t) * this.section(h, t)];
  }

  /** Where the stem head is: a bowsprit or a forestay is made fast here. */
  stemHead(): P3 {
    return this.side(1, 1, 0);
  }

  /** A point on the flank at a length position and section height, for fittings on the side. */
  flank(x: number, h: number, sign: number): P3 {
    return this.side(this.tAt(x), h, sign);
  }

  draw(b: DwellingBuilder): void {
    const s = this.spec;
    const hs = this.heights;
    const sideCount = hs.length * 2 - 1;
    const rings: P3[][] = [];
    const ts: number[] = [];
    for (let i = 0; i <= STATIONS; i++) {
      // Stations bunch toward the bow, where the plan and the stem curve fastest.
      const u = i / STATIONS;
      const t = u < 0.5 ? u * 0.9 : 0.45 + (u - 0.5) * 1.1;
      ts.push(t);
      const ring: P3[] = [];
      for (let k = hs.length - 1; k >= 0; k--) ring.push(this.side(t, hs[k]!, 1));
      for (let k = 1; k < hs.length; k++) ring.push(this.side(t, hs[k]!, -1));
      const port = ring[sideCount - 1]!;
      const starboard = ring[0]!;
      ring.push(port);
      ring.push([(port[0] + starboard[0]) / 2, (port[1] + starboard[1]) / 2 + s.camber, 0]);
      ring.push(starboard);
      rings.push(ring);
    }

    // Smooth normals off the loft itself, with the deck edge kept as a crease: the
    // side and the deck each carry their own copy of the edge vertex.
    const normals: P3[][] = rings.map((ring, r) => {
      const before = rings[Math.max(0, r - 1)]!;
      const after = rings[Math.min(rings.length - 1, r + 1)]!;
      const t = ts[r]!;
      const middle = (this.keel(t) + this.deck(t)) / 2;
      const slope = (after[0]![1] - before[0]![1]) / Math.max(1e-6, after[0]![0] - before[0]![0]);
      const deckNormal = new THREE.Vector3(-slope, 1, 0).normalize();
      return ring.map((p, e): P3 => {
        if (e >= sideCount) return [deckNormal.x, deckNormal.y, deckNormal.z];
        const a = ring[Math.max(0, e - 1)]!;
        const c = ring[Math.min(sideCount - 1, e + 1)]!;
        const along = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
        const length = new THREE.Vector3(after[e]![0] - before[e]![0], after[e]![1] - before[e]![1], after[e]![2] - before[e]![2]);
        const n = along.cross(length);
        if (n.lengthSq() < 1e-12) n.set(0, p[1] < middle ? -1 : 0, Math.sign(p[2]));
        n.normalize();
        if (n.y * (p[1] - middle) + n.z * p[2] < 0) n.negate();
        return [n.x, n.y, n.z];
      });
    });

    const paint = (r: number, e: number): number => {
      if (e < 0) return s.paint.topside;
      if (e >= sideCount - 1) return s.paint.deck;
      // Segment e runs from ring vertex e to e + 1; its height is their mean.
      const k0 = e < hs.length ? hs.length - 1 - e : e - (hs.length - 1);
      const k1 = e + 1 < hs.length ? hs.length - 2 - e : e + 1 - (hs.length - 1);
      const h = (hs[k0]! + hs[k1]!) / 2;
      if (h < s.waterline) return s.paint.bottom;
      if (h < s.bootTop) return s.paint.boot;
      if (h > s.sheerStrake) return s.paint.sheer;
      const side = e < hs.length ? 1 : 2;
      const runs = h > (s.bootTop + s.sheerStrake) / 2 && hashUnit3(s.salt, r, side) < s.streaks;
      return runs ? s.paint.streak : s.paint.topside;
    };
    b.loft(rings, paint, true, normals);
  }
}

/** Ships are lit from the port quarter, above: the flanks differ, the bilge turns dark. */
function bakeLight(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const normal = geometry.getAttribute('normal');
  const colour = geometry.getAttribute('color');
  for (let i = 0; i < colour.count; i++) {
    const tone = Math.min(1.18, Math.max(0.46, 0.8 + 0.06 * normal.getX(i) + 0.3 * normal.getY(i) - 0.16 * normal.getZ(i)));
    colour.setXYZ(i, colour.getX(i) * tone, colour.getY(i) * tone, colour.getZ(i) * tone);
  }
  geometry.deleteAttribute('normal');
  return geometry;
}

/**
 * Drawn ten metres up and brought back down: the builder drops any face lying on
 * y = 0 and looking down, and the keel's bottom is exactly that.
 */
const DRAW_LIFT = 10;

function ship(draw: (b: DwellingBuilder) => void): THREE.BufferGeometry {
  const b = new DwellingBuilder({ grime: 0 }, true);
  b.at(0, DRAW_LIFT, 0, 0, () => draw(b));
  const geometry = b.geometry();
  geometry.translate(0, -DRAW_LIFT, 0);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return bakeLight(geometry);
}

/** A block of house centred on the centreline, from `x0` to `x1`. */
function house(b: DwellingBuilder, x0: number, x1: number, y0: number, y1: number, half: number, hex: number, top = hex): void {
  b.box(x0, y0, -half, x1, y1, half, hex, top);
}

/** Evenly spaced dark windows on both flanks of a house, standing proud of the wall. */
function windows(b: DwellingBuilder, x0: number, x1: number, y0: number, y1: number, half: number, count: number, hex: number): void {
  const pitch = (x1 - x0) / count;
  const width = pitch * 0.52;
  for (let i = 0; i < count; i++) {
    const cx = x0 + pitch * (i + 0.5);
    for (const sign of [1, -1]) {
      b.box(cx - width / 2, y0, sign * half, cx + width / 2, y1, sign * (half + 0.07), hex);
    }
  }
}

/** The same across one end wall of a house, at `x`, standing proud toward `dir`. */
function endWindows(b: DwellingBuilder, x: number, dir: number, y0: number, y1: number, half: number, count: number, hex: number): void {
  const pitch = (half * 2 - 0.8) / count;
  const width = pitch * 0.5;
  for (let i = 0; i < count; i++) {
    const cz = -half + 0.4 + pitch * (i + 0.5);
    b.box(x, y0, cz - width / 2, x + dir * 0.07, y1, cz + width / 2, hex);
  }
}

/** A square spar from `a` to `b`, tapering by drawing its upper part thinner. */
function spar(b: DwellingBuilder, a: P3, c: P3, width: number, hex: number): void {
  const mid: P3 = [a[0] + (c[0] - a[0]) * 0.6, a[1] + (c[1] - a[1]) * 0.6, a[2] + (c[2] - a[2]) * 0.6];
  b.beam(a, mid, width, hex);
  b.beam(mid, c, width * 0.62, hex);
}

const WHITE = 0xe2dccd;
const WHITE_ROOF = 0xc9c1b1;
const GLASS = 0x1f2328;
const BLACK = 0x25221f;
const RUST = 0x8c4a2b;

const TRAWLER_HULL: HullSpec = {
  length: 36,
  beam: 7.6,
  depth: 3.9,
  sheerAft: 0.7,
  sheerFore: 2.5,
  transom: 0.74,
  entrance: 0.42,
  run: 0.3,
  forefoot: 0.5,
  keelRiseAft: 0.16,
  rake: 2.6,
  counter: 1,
  flare: 0.3,
  camber: 0.18,
  paint: { bottom: 0x93402a, boot: 0x2c2826, topside: 0x3b4854, sheer: 0xd9d2c2, deck: 0x6c5546, streak: mix(0x3b4854, RUST, 0.45) },
  streaks: 0.3,
  waterline: 0.3,
  bootTop: 0.37,
  sheerStrake: 0.86,
  salt: 0x7a11,
};

/**
 * A side trawler: long low hull, house amidships with a wheelhouse on top, a raked
 * funnel, a foremast with its derrick, the gallows on the starboard rail and an
 * A-frame over the stern. Thirty-six metres.
 */
function trawler(): THREE.BufferGeometry {
  return ship((b) => {
    const hull = new Hull(TRAWLER_HULL);
    hull.draw(b);
    const sink = 0.3;
    // House amidships and the wheelhouse on it, a lifeboat either side of the top.
    const d = hull.deckAt(-1);
    const houseHalf = hull.fit(-7, 3.5) * 0.8;
    house(b, -7, 3.5, d - sink, d + 2.5, houseHalf, WHITE, WHITE_ROOF);
    windows(b, -6, 3, d + 1.1, d + 1.7, houseHalf, 6, GLASS);
    const wheelHalf = houseHalf * 0.82;
    house(b, -1.2, 3.3, d + 2.5, d + 4.8, wheelHalf, WHITE, WHITE_ROOF);
    b.box(3.3, d + 3.6, -wheelHalf + 0.3, 3.38, d + 4.35, wheelHalf - 0.3, GLASS);
    b.box(-0.9, d + 3.6, wheelHalf, 3, d + 4.35, wheelHalf + 0.07, GLASS);
    b.box(-0.9, d + 3.6, -wheelHalf - 0.07, 3, d + 4.35, -wheelHalf, GLASS);
    b.box(-1.5, d + 4.8, -wheelHalf - 0.3, 3.7, d + 5.05, wheelHalf + 0.3, WHITE_ROOF);
    for (const sign of [1, -1]) {
      b.box(-6.2, d + 2.5, sign * (houseHalf - 1.3), -2.4, d + 3.4, sign * (houseHalf - 0.2), 0xd8692e, WHITE);
    }
    // Radar mast on the wheelhouse roof.
    b.beam([1.4, d + 5, 0], [1.4, d + 7.4, 0], 0.22, WHITE);
    b.beam([1.4, d + 7, -1], [1.4, d + 7, 1], 0.16, WHITE);
    // Funnel, raked aft, with its band and a black top.
    b.at(-4.4, d + 2.3, 0, 0, () => {
      b.lathe(0, 0, [[0.95, 0], [0.95, 2.1], [0.95, 2.7], [0.95, 3.3], [0.9, 3.7]], 12, (i) => (i === 1 ? 0xb3402b : i === 3 ? BLACK : WHITE), { sx: 1.25 });
    }, 0, 0.16);
    // Foremast with a crosstree, the derrick boom resting forward, and the stays.
    const fore = 8.5;
    const df = hull.deckAt(fore);
    spar(b, [fore, df - sink, 0], [fore, df + 11, 0], 0.42, WHITE);
    b.beam([fore, df + 8, -1.5], [fore, df + 8, 1.5], 0.2, WHITE);
    b.beam([fore, df + 1.2, 0], [fore + 8, df + 4.4, 0], 0.26, RUST);
    const stem = hull.stemHead();
    b.beam([fore, df + 10.6, 0], [stem[0] - 0.4, stem[1] + 0.6, 0], 0.11, BLACK);
    b.beam([fore, df + 10.6, 0], [1.4, d + 7.2, 0], 0.11, BLACK);
    // Gallows on the starboard rail, fore and aft of the house: the side trawler's mark.
    for (const x of [6, -11]) {
      const y = hull.deckAt(x);
      const z = hull.fit(x - 0.6, x + 0.6) - 0.3;
      b.beam([x - 0.7, y - sink, z], [x - 0.5, y + 2.6, z + 0.25], 0.26, RUST);
      b.beam([x + 0.7, y - sink, z], [x + 0.5, y + 2.6, z + 0.25], 0.26, RUST);
      b.beam([x - 0.6, y + 2.6, z + 0.25], [x + 0.6, y + 2.6, z + 0.25], 0.26, RUST);
    }
    // A-frame over the stern, leaning aft.
    const xs = -16;
    const ds = hull.deckAt(xs);
    const zs = hull.fit(xs - 0.5, xs + 0.5) - 0.4;
    b.beam([xs, ds - sink, zs], [xs - 1.2, ds + 5, 0.5], 0.3, RUST);
    b.beam([xs, ds - sink, -zs], [xs - 1.2, ds + 5, -0.5], 0.3, RUST);
    b.beam([xs - 1.2, ds + 5, -0.9], [xs - 1.2, ds + 5, 0.9], 0.3, RUST);
    // Hawse pipes either side of the stem: two dark eyes that make a bow a face.
    for (const sign of [1, -1]) {
      const p = hull.flank(15.2, 0.8, sign);
      b.box(p[0] - 0.4, p[1] - 0.35, p[2] - 0.05 * sign, p[0] + 0.4, p[1] + 0.35, p[2] + 0.1 * sign, BLACK);
    }
  });
}

const FREIGHTER_HULL: HullSpec = {
  length: 64,
  beam: 10.6,
  depth: 5.4,
  sheerAft: 0.9,
  sheerFore: 2.4,
  transom: 0.72,
  entrance: 0.34,
  run: 0.28,
  forefoot: 0.46,
  keelRiseAft: 0.22,
  rake: 3.8,
  counter: 1.8,
  flare: 0.26,
  camber: 0.22,
  paint: { bottom: 0x9a3d2b, boot: 0xd8d2c4, topside: 0x26282b, sheer: 0x26282b, deck: 0x6a5a4c, streak: mix(0x26282b, RUST, 0.4) },
  streaks: 0.34,
  waterline: 0.33,
  bootTop: 0.36,
  sheerStrake: 0.96,
  salt: 0x3c57,
};

/**
 * A small freighter of the fifties: black hull, white accommodation three decks
 * high aft with bridge wings, the funnel behind it, and derricks between the hatches.
 * Sixty-four metres.
 */
function freighter(): THREE.BufferGeometry {
  return ship((b) => {
    const hull = new Hull(FREIGHTER_HULL);
    hull.draw(b);
    const sink = 0.35;
    // Accommodation, three tiers stepping back, and the bridge wings out to the rail.
    const d = hull.deckAt(-22);
    const x0 = -29;
    const x1 = -17;
    const h1 = hull.fit(x0, x1) * 0.9;
    house(b, x0, x1, d - sink, d + 2.7, h1, WHITE, WHITE_ROOF);
    windows(b, x0 + 0.5, x1 - 0.5, d + 1.1, d + 1.8, h1, 7, GLASS);
    endWindows(b, x0, -1, d + 1.1, d + 1.8, h1, 5, GLASS);
    endWindows(b, x1, 1, d + 1.1, d + 1.8, h1, 5, GLASS);
    const h2 = h1 * 0.86;
    house(b, x0 + 1, x1 - 0.8, d + 2.7, d + 5.3, h2, WHITE, WHITE_ROOF);
    windows(b, x0 + 1.5, x1 - 1.3, d + 3.8, d + 4.5, h2, 6, GLASS);
    endWindows(b, x0 + 1, -1, d + 3.8, d + 4.5, h2, 4, GLASS);
    endWindows(b, x1 - 0.8, 1, d + 3.8, d + 4.5, h2, 4, GLASS);
    const h3 = h2 * 0.9;
    house(b, x0 + 3.5, x1 - 0.8, d + 5.3, d + 7.8, h3, WHITE, WHITE_ROOF);
    // Wings are open platforms behind a waist-high bulwark, not more house: a full-height
    // block out to the rail read from astern as a second building standing on the first.
    const wing = hull.fit(x1 - 3, x1) - 0.1;
    for (const sign of [1, -1]) {
      b.box(x1 - 2.2, d + 5.3, sign * (h3 - 0.2), x1 - 0.8, d + 6.5, sign * wing, WHITE, WHITE_ROOF);
    }
    b.box(x1 - 0.8, d + 6.6, -h3 + 0.3, x1 - 0.72, d + 7.3, h3 - 0.3, GLASS);
    b.box(x0 + 3.2, d + 7.8, -h3 - 0.3, x1 - 0.5, d + 8.1, h3 + 0.3, WHITE_ROOF);
    // Signal mast on the bridge top.
    b.beam([x1 - 3, d + 8, 0], [x1 - 3, d + 12.5, 0], 0.26, WHITE);
    b.beam([x1 - 3, d + 11.4, -1.6], [x1 - 3, d + 11.4, 1.6], 0.16, WHITE);
    // Funnel behind the house: oval, raked, black top over a red band.
    b.at(-24.5, d + 5, 0, 0, () => {
      b.lathe(0, 0, [[1.6, 0], [1.6, 2.4], [1.6, 3.4], [1.58, 4.1], [1.5, 5]], 14, (i) => (i === 1 ? 0xb8382a : i === 3 ? BLACK : 0xe2dccd), { sx: 1.35 });
    }, 0, 0.14);
    // Hatch coamings over three holds, the covers greened with old paint.
    for (const [a, c] of [[-13, -2], [4, 15], [19, 25]] as const) {
      const half = hull.fit(a, c) * 0.62;
      const y = Math.max(hull.deckAt(a), hull.deckAt(c));
      b.box(a, y - sink - 0.6, -half, c, y + 1.2, half, 0x5b5f4a, 0x6d6a50);
    }
    // Two masts between the holds, each with a crosstree and a boom over either hatch.
    for (const x of [1, 17]) {
      const y = hull.deckAt(x);
      spar(b, [x, y - sink, 0], [x, y + 14, 0], 0.62, WHITE);
      b.beam([x, y + 8.5, -2.6], [x, y + 8.5, 2.6], 0.26, WHITE);
      for (const [dir, rise] of [[1, 5.5], [-1, 3.2]] as const) {
        b.beam([x, y + 1.6, 0.5 * dir], [x + dir * 9.5, y + 1.6 + rise, 0.5 * dir], 0.32, RUST);
      }
      b.beam([x, y + 13.6, 0], [x + 8.5, y + 7.3, 0.5], 0.09, BLACK);
    }
    // A short foremast on the forecastle and the stay from it to the stem.
    const fx = 27;
    const fy = hull.deckAt(fx);
    b.beam([fx, fy - sink, 0], [fx, fy + 7, 0], 0.4, WHITE);
    const stem = hull.stemHead();
    b.beam([fx, fy + 6.8, 0], [stem[0] - 0.5, stem[1] + 0.4, 0], 0.1, BLACK);
    b.beam([fx, fy + 6.8, 0], [17, hull.deckAt(17) + 13.6, 0], 0.1, BLACK);
    // Windlass on the forecastle and the hawse eyes below it.
    b.box(fx + 1.2, fy - sink, -1.6, fx + 2.6, fy + 0.9, 1.6, RUST);
    for (const sign of [1, -1]) {
      const p = hull.flank(28.8, 0.84, sign);
      b.box(p[0] - 0.55, p[1] - 0.45, p[2] - 0.05 * sign, p[0] + 0.55, p[1] + 0.45, p[2] + 0.1 * sign, BLACK);
    }
    // Ensign staff at the stern.
    const stern = hull.flank(-32, 1, 0);
    b.beam([stern[0] + 0.3, stern[1] - 0.3, 0], [stern[0] - 0.4, stern[1] + 3.2, 0], 0.12, WHITE);
  });
}

const BARQUE_HULL: HullSpec = {
  length: 42,
  beam: 9,
  depth: 5.4,
  sheerAft: 2.6,
  sheerFore: 1.8,
  transom: 0.6,
  entrance: 0.36,
  run: 0.34,
  forefoot: 0.34,
  keelRiseAft: 0.08,
  rake: 1.4,
  counter: 2.8,
  flare: 0.2,
  camber: 0.2,
  paint: { bottom: 0x6e8a6c, boot: 0x1f1a16, topside: 0x3f2e22, sheer: 0xdcd2ba, deck: 0x8a7458, streak: 0x54402f },
  streaks: 0.28,
  waterline: 0.34,
  bootTop: 0.44,
  sheerStrake: 0.76,
  salt: 0x51b9,
};

/**
 * A three-masted barque: dark planking over a coppered bottom, the white gunport
 * band with its black ports, a bowsprit, square yards on the fore and main, a gaff
 * on the mizzen, and her topsails hanging in strips. Forty-two metres on deck.
 */
function barque(): THREE.BufferGeometry {
  return ship((b) => {
    const hull = new Hull(BARQUE_HULL);
    hull.draw(b);
    const sink = 0.3;
    const wood = 0x5a4332;
    const canvas = 0xe6dcc2;
    // Painted ports along the white band, a dark square every three metres.
    for (let x = -13; x <= 13; x += 3.2) {
      for (const sign of [1, -1]) {
        const p = hull.flank(x, 0.88, sign);
        b.box(p[0] - 0.45, p[1] - 0.42, p[2] - 0.05 * sign, p[0] + 0.45, p[1] + 0.42, p[2] + 0.09 * sign, BLACK);
      }
    }
    // Poop cabin aft with its skylight.
    const dp = hull.deckAt(-15);
    const cabinHalf = hull.fit(-18, -11) * 0.7;
    house(b, -18, -11, dp - sink, dp + 1.9, cabinHalf, 0xd9cfb6, wood);
    windows(b, -17.4, -11.6, dp + 0.7, dp + 1.3, cabinHalf, 4, GLASS);
    // Bowsprit and jib boom, rising forward off the stem head.
    const stem = hull.stemHead();
    const sprit: P3 = [stem[0] + 7, stem[1] + 2.4, 0];
    const jib: P3 = [stem[0] + 11.5, stem[1] + 4, 0];
    b.beam([stem[0] - 4, stem[1] - 0.4, 0], sprit, 0.62, wood);
    b.beam(sprit, jib, 0.34, wood);

    interface Mast { readonly x: number; readonly height: number; readonly width: number; readonly yards: readonly number[] }
    const masts: readonly Mast[] = [
      { x: 11.5, height: 25, width: 0.66, yards: [18, 14.5, 10] },
      { x: 0, height: 28, width: 0.72, yards: [20, 16, 11] },
      { x: -10.5, height: 20, width: 0.56, yards: [] },
    ];
    const tops: P3[] = [];
    for (const [index, mast] of masts.entries()) {
      const y = hull.deckAt(mast.x);
      const top: P3 = [mast.x, y + mast.height, 0];
      tops.push(top);
      spar(b, [mast.x, y - sink, 0], top, mast.width, wood);
      // Shrouds to both rails: the dark triangles that are a sailing ship's own mark.
      const rail = hull.fit(mast.x - 2, mast.x + 1) - 0.1;
      for (const sign of [1, -1]) {
        for (const dx of [-0.6, -1.8]) {
          b.beam([mast.x, y + mast.height * 0.62, 0], [mast.x + dx, y + 0.2, sign * rail], 0.13, BLACK);
        }
      }
      // Square yards, courses to royals, each hung at its own height.
      mast.yards.forEach((span, level) => {
        const yy = y + mast.height * (0.42 + level * 0.19);
        b.beam([mast.x + 0.35, yy, -span / 2], [mast.x + 0.35, yy, span / 2], 0.34 - level * 0.05, wood);
        if (level === 0) {
          // The course furled on its yard: a fat pale roll.
          b.beam([mast.x + 0.55, yy - 0.35, -span * 0.44], [mast.x + 0.55, yy - 0.35, span * 0.44], 0.62, canvas);
          return;
        }
        // Topsail in hanging strips, ragged at the foot, one torn away entirely.
        const drop = mast.height * 0.16;
        const strips = 5;
        for (let i = 0; i < strips; i++) {
          const rag = hashUnit3(index * 7 + level, i, 0x5a11);
          if (rag < 0.18) continue;
          const z0 = -span * 0.44 + (span * 0.88 * i) / strips;
          const z1 = z0 + (span * 0.88) / strips - 0.12;
          const foot = yy - drop * (0.35 + 0.65 * rag);
          b.box(mast.x + 0.5, foot, z0, mast.x + 0.7, yy - 0.2, z1, canvas);
        }
      });
    }
    // Mizzen gaff and boom, the spanker gone from between them.
    const mz = masts[2]!;
    const my = hull.deckAt(mz.x);
    b.beam([mz.x, my + mz.height * 0.66, 0], [mz.x - 9, my + mz.height * 0.8, 0], 0.26, wood);
    b.beam([mz.x, my + 2.4, 0], [mz.x - 11, my + 3, 0], 0.3, wood);
    // Stays: jib boom to foretop, foretop to maintop, maintop to mizzen top.
    b.beam(jib, tops[0]!, 0.12, BLACK);
    b.beam(sprit, [tops[0]![0], tops[0]![1] - 7, 0], 0.12, BLACK);
    b.beam(tops[0]!, [tops[1]![0], tops[1]![1] - 5, 0], 0.12, BLACK);
    b.beam(tops[1]!, [tops[2]![0], tops[2]![1] - 3, 0], 0.12, BLACK);
    // Stern lantern.
    const stern = hull.flank(-21, 1, 0);
    b.beam([stern[0], stern[1] - 0.5, 0], [stern[0], stern[1] + 1.4, 0], 0.18, BLACK);
    b.box(stern[0] - 0.35, stern[1] + 1.4, -0.35, stern[0] + 0.35, stern[1] + 2.1, 0.35, 0xe8c56a);
  });
}

export const SHIP_FORMS: readonly ShipForm[] = [
  { name: 'trawler', build: trawler, length: TRAWLER_HULL.length, beam: TRAWLER_HULL.beam, depth: TRAWLER_HULL.depth, share: 0.45 },
  { name: 'freighter', build: freighter, length: FREIGHTER_HULL.length, beam: FREIGHTER_HULL.beam, depth: FREIGHTER_HULL.depth, share: 0.3 },
  { name: 'barque', build: barque, length: BARQUE_HULL.length, beam: BARQUE_HULL.beam, depth: BARQUE_HULL.depth, share: 0.25 },
];

/** The form a unit hash picks, by `share`. */
export function shipFormAt(unit: number): number {
  const total = SHIP_FORMS.reduce((sum, form) => sum + form.share, 0);
  let acc = 0;
  for (let i = 0; i < SHIP_FORMS.length; i++) {
    acc += SHIP_FORMS[i]!.share / total;
    if (unit < acc) return i;
  }
  return SHIP_FORMS.length - 1;
}
