import * as THREE from 'three';
import { hashUnit3 } from '../core/rng';
import type { WorldOrigin } from '../world/origin';
import type { Road } from '../world/road';
import type { Terrain } from '../world/terrain';
import { fitGround } from '../world/footprint';

const MIN_GAP_M = 3_000;
const GAP_RANGE_M = 5_000;
const APPROACH_M = 900;
const RETREAT_M = 260;
/**
 * Metres of travel over which an apparition evaporates once you have come for it.
 *
 * Ten, and that number is the whole character of a mirage in this game: leave the
 * asphalt and the town is gone before the car has straightened up. The lakes in
 * render/lakewater.ts import it so both kinds of apparition thin out at one rate and
 * cannot drift apart into two different-feeling tricks.
 */
export const MIRAGE_FADE_BAND_M = 10;
const FADE_FROM_ROAD_M = 1;
const GONE_FROM_ROAD_M = FADE_FROM_ROAD_M + MIRAGE_FADE_BAND_M;

const MAX_PLANTS = 420;
const MAX_BLOCKS = 512;
const MAX_CITY_WINDOWS = 1_536;
const MAX_CITY_ACCENTS = 512;
const MAX_CITY_ROOFS = 192;
const MAX_CITY_STREETS = 192;
/** Metres a roof cone is buried in the block it caps, so their faces never coincide. */
const ROOF_SINK_M = 0.3;
const MAX_SHIPS = 240;

/**
 * Nearest a wreck may ground itself to the asphalt, and how far the field reaches out.
 *
 * A hull is seventy metres of ship. Sat at the verge like a palm it is a wall the
 * road runs along, and the eye cannot take in a shape it cannot see the ends of, so
 * the fleet alone stands well back: sixty metres is far enough that the nearest wreck
 * fits in the windscreen whole.
 */
const SHIP_NEAR_M = 60;
const SHIP_SPREAD_M = 210;
/** Placement attempts per wreck before the slot is left empty. */
const SHIP_ATTEMPTS = 10;

const SALT_GAP = 0x31a7;
const SALT_LENGTH = 0x42b9;
const SALT_VARIANT = 0x53cb;
const SALT_PLACEMENT = 0x64dd;
const SALT_SHAPE = 0x75ef;
const SALT_COLOUR = 0x8711;

export const MIRAGE_TABLEAU_KINDS = ['palms', 'trees', 'cacti', 'city', 'ships'] as const;
export type MirageKind = (typeof MIRAGE_TABLEAU_KINDS)[number];

interface Encounter {
  readonly index: number;
  readonly startS: number;
  readonly length: number;
  readonly kind: MirageKind;
}

export type CardTriangle = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  colour: THREE.Color,
  z?: number,
) => void;

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
/**
 * A mirage colour authored in DISPLAY space.
 *
 * Pass 2 in core/renderer.ts copies the linear scene target to the canvas
 * untouched, so an unlit material's colour reaches the screen at its own numeric
 * value. Converting an authored hex from sRGB darkens it by a whole gamma, and a
 * tableau multiplies its card palette by an instance colour, so that darkening
 * landed twice: palm fronds measured one or two code values on screen — a black
 * paper cut-out of a palm rather than a green one.
 */
export function displayColour(hex: number): THREE.Color {
  return new THREE.Color().setHex(hex, THREE.LinearSRGBColorSpace);
}

/**
 * Per-kind haze tint applied to every instance of a grove. Near white on purpose:
 * it multiplies the card palette, so it varies the light on a plant instead of
 * replacing its colour.
 */
export const PALM_TINT = displayColour(0xfff1dc);
export const TREE_TINT = displayColour(0xf9f2e2);
export const CACTUS_TINT = displayColour(0xf3f8e6);
const SHIP_TINT = displayColour(0xffe9d2);


/** Two perpendicular copies of every triangle: a readable flat from any road angle. */
export function crossedCardGeometry(draw: (triangle: CardTriangle) => void): THREE.BufferGeometry {
  const positions: number[] = [];
  const colours: number[] = [];
  const triangle: CardTriangle = (ax, ay, bx, by, cx, cy, colour, z = 0) => {
    positions.push(
      ax, ay, z, bx, by, z, cx, cy, z,
      z, ay, -ax, z, by, -bx, z, cy, -cx,
    );
    for (let i = 0; i < 6; i++) colours.push(colour.r, colour.g, colour.b);
  };
  draw(triangle);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  return geometry;
}

/**
 * The furthest any vertex of a card sits from its origin in the ground plane.
 *
 * A crossed card holds both copies, so this one number bounds the whole footprint
 * under a uniform XZ scale and under any yaw. It is the radius a spacing test has to
 * use; anything smaller is a licence to overlap, and every hand-picked value tried
 * here was smaller.
 */
function planarReach(geometry: THREE.BufferGeometry): number {
  const position = geometry.getAttribute('position');
  let worst = 0;
  for (let i = 0; i < position.count; i++) {
    worst = Math.max(worst, Math.hypot(position.getX(i), position.getZ(i)));
  }
  return worst;
}

/**
 * The three palms. A grove of one silhouette repeated is a wallpaper, and the cheapest
 * cure is not more geometry but a second and a third set of proportions: a tall thin
 * one that leans, a stout one carrying dates, and a young one barely out of the sand.
 */
interface PalmForm {
  /** Height of the crown up the unit trunk. */
  readonly crownY: number;
  /** Sideways drift of the trunk's top: a palm is never plumb. */
  readonly lean: number;
  /** Trunk thickness multiplier. */
  readonly girth: number;
  readonly fronds: number;
  /** Frond length, and how hard the tip is pulled down. */
  readonly reach: number;
  readonly droop: number;
  readonly leafWidth: number;
  /** Depth the crown is spread over, in unit-height. */
  readonly depth: number;
  /** Phase of the per-frond length wobble, so two forms differ frond by frond. */
  readonly phase: number;
  readonly nuts: boolean;
}

const PALM_FORMS: readonly PalmForm[] = [
  { crownY: 0.74, lean: 0.06, girth: 1, fronds: 9, reach: 0.58, droop: 0.42, leafWidth: 1, depth: 0.34, phase: 0, nuts: false },
  { crownY: 0.62, lean: -0.04, girth: 1.35, fronds: 11, reach: 0.52, droop: 0.3, leafWidth: 1.25, depth: 0.4, phase: 1.7, nuts: true },
  { crownY: 0.5, lean: 0.14, girth: 0.85, fronds: 7, reach: 0.62, droop: 0.55, leafWidth: 0.9, depth: 0.3, phase: 3.1, nuts: false },
];

/**
 * Date palms, in three forms.
 *
 * A FROND IS TWO STRIPS, NOT ONE TRIANGLE. The old palm spread eight flat triangles of
 * a single green from one point: a starfish, and one with no underside. Each frond
 * here is an arc with a lit upper half and a shadowed lower half split along its own
 * spine, which is what gives a crown its dome from a flat card — the same tone trick
 * the acacia and the city use.
 *
 * THE FRONDS ARE ALSO SPREAD IN DEPTH, and that is not decoration. Coplanar cards a
 * few millimetres apart are below the depth buffer's resolution at the distance these
 * are seen from, so the near frond and the far frond swap places pixel by pixel as the
 * camera moves: a crown that boils. Laid out across a quarter of the palm's height
 * they are simply a crown with a front and a back, and the ordering is unambiguous.
 */
export function palmGeometry(variant = 0): THREE.BufferGeometry {
  const form = PALM_FORMS[Math.abs(Math.round(variant)) % PALM_FORMS.length]!;
  return crossedCardGeometry((triangle) => {
    const barkLit = displayColour(0xd0a271);
    const barkShade = displayColour(0x946c45);
    const leafLit = displayColour(0x9ad778);
    const leafShade = displayColour(0x4f8149);
    const nut = displayColour(0xc8893f);
    const quad = (
      ax: number, ay: number, bx: number, by: number,
      cx: number, cy: number, dx: number, dy: number,
      colour: THREE.Color, z = 0,
    ): void => {
      triangle(ax, ay, bx, by, cx, cy, colour, z);
      triangle(ax, ay, cx, cy, dx, dy, colour, z);
    };

    // Trunk: a leaning arc, split down its length into a lit face and a shaded one.
    const crownY = form.crownY;
    const trunkAt = (t: number): readonly [number, number, number] => [
      form.lean * t * t,
      crownY * t,
      0.055 * form.girth * (1 - 0.42 * t),
    ];
    for (let i = 0; i < 5; i++) {
      const [x0, y0, r0] = trunkAt(i / 5);
      const [x1, y1, r1] = trunkAt((i + 1) / 5);
      quad(x0 - r0, y0, x0, y0, x1, y1, x1 - r1, y1, barkShade);
      quad(x0, y0, x0 + r0, y0, x1 + r1, y1, x1, y1, barkLit);
    }

    const [crownX, crownTop] = trunkAt(1);
    const count = form.fronds;
    for (let k = 0; k < count; k++) {
      // Fan from one side to the other, with the frond's own reach and droop varied
      // by a fixed wobble so no two arms of a crown are the same length.
      const spread = k / (count - 1);
      const angle = Math.PI * (1.08 - spread * 1.16);
      const wobble = Math.sin(k * 2.399 + form.phase);
      const reach = form.reach * (0.86 + wobble * 0.14);
      const droop = form.droop * (0.8 + (1 - Math.abs(Math.cos(angle))) * 0.5);
      const halfWidth = 0.052 * form.leafWidth;
      // Interleaved depth: neighbours in the fan are never neighbours in depth, so
      // the pair that overlaps most on screen is the pair furthest apart in z.
      const z = (((k * 7) % count) / (count - 1) - 0.5) * form.depth;

      const spine = (t: number): readonly [number, number] => [
        crownX + Math.cos(angle) * reach * t,
        crownTop + Math.sin(angle) * reach * t - droop * reach * t * t,
      ];
      const SEGMENTS = 4;
      for (let i = 0; i < SEGMENTS; i++) {
        const t0 = i / SEGMENTS;
        const t1 = (i + 1) / SEGMENTS;
        const [ax, ay] = spine(t0);
        const [bx, by] = spine(t1);
        const dx = bx - ax;
        const dy = by - ay;
        const len = Math.max(1e-4, Math.hypot(dx, dy));
        const nx = (-dy / len);
        const ny = (dx / len);
        // Widest a third of the way out, closed to a point at the tip.
        const w0 = halfWidth * Math.sin(Math.PI * Math.pow(t0, 0.55));
        const w1 = halfWidth * Math.sin(Math.PI * Math.pow(t1, 0.55));
        quad(ax, ay, ax + nx * w0, ay + ny * w0, bx + nx * w1, by + ny * w1, bx, by, leafLit, z);
        quad(ax, ay, bx, by, bx - nx * w1, by - ny * w1, ax - nx * w0, ay - ny * w0, leafShade, z - 0.03);
      }
    }

    if (form.nuts) {
      // A date cluster hanging under the crown: three small darts, not a sphere.
      for (let i = 0; i < 3; i++) {
        const x = crownX + (i - 1) * 0.055;
        triangle(x - 0.045, crownTop - 0.01, x + 0.045, crownTop - 0.01, x, crownTop - 0.11, nut, -0.34);
      }
    }
  });
}

/**
 * A desert acacia: a leaning, tapered trunk that forks twice into a flat-topped canopy.
 *
 * A FLAT CARD GETS ITS VOLUME FROM TONE, not from shape — the same trick the city uses
 * with its wall, window and roof paints. Every part here is drawn in a lit tone and a
 * shadowed one split down a consistent light direction, and the canopy is seven
 * overlapping clumps rather than one mass so its edge breaks against the sky instead of
 * reading as a cut-out lozenge. The earlier version was a stick and three diamonds.
 */
export function treeGeometry(): THREE.BufferGeometry {
  return crossedCardGeometry((triangle) => {
    const barkLit = displayColour(0xc59a60);
    const barkShade = displayColour(0x8a6742);
    const leafLit = displayColour(0xb2dc8a);
    const leafMid = displayColour(0x86bb6a);
    const leafShade = displayColour(0x5c8a4c);
    const quad = (
      ax: number, ay: number, bx: number, by: number,
      cx: number, cy: number, dx: number, dy: number,
      colour: THREE.Color, z = 0,
    ): void => {
      triangle(ax, ay, bx, by, cx, cy, colour, z);
      triangle(ax, ay, cx, cy, dx, dy, colour, z);
    };

    // Trunk: root flare at the ground, tapering and leaning slightly right.
    quad(-0.115, 0, -0.045, 0.1, -0.028, 0.46, -0.075, 0.46, barkShade);
    quad(-0.045, 0.1, 0.09, 0.06, 0.052, 0.46, -0.028, 0.46, barkLit);
    quad(0.09, 0.06, 0.125, 0, 0.06, 0, 0.052, 0.12, barkShade);
    // Fork: three limbs reaching out under the canopy.
    quad(-0.075, 0.44, -0.028, 0.44, -0.12, 0.68, -0.17, 0.66, barkShade, -0.001);
    quad(-0.01, 0.44, 0.05, 0.44, 0.2, 0.66, 0.15, 0.69, barkLit, -0.001);
    quad(-0.02, 0.5, 0.03, 0.5, 0.04, 0.72, -0.01, 0.72, barkLit, -0.001);

    /**
     * One clump of foliage: a shadowed underside with a lit cap over it.
     *
     * The three tones are separated in depth by centimetres of the tree's own height,
     * not by thousandths. A depth buffer's resolution at the distance a tableau is
     * seen from is measured in tens of centimetres, so the old millimetre offsets were
     * BELOW THE NOISE: the shadow and the cap swapped places pixel by pixel as the
     * camera moved, which is the boiling canopy. Two clumps also shared an offset
     * exactly, and those fought at any distance at all.
     */
    const clump = (x: number, y: number, rx: number, ry: number, z: number): void => {
      triangle(x - rx, y, x + rx, y, x + rx * 0.45, y - ry * 0.75, leafShade, z);
      triangle(x - rx, y, x + rx * 0.45, y - ry * 0.75, x - rx * 0.45, y - ry * 0.7, leafShade, z);
      triangle(x - rx, y, x - rx * 0.35, y + ry, x + rx * 0.2, y + ry * 0.95, leafMid, z - 0.035);
      triangle(x - rx, y, x + rx * 0.2, y + ry * 0.95, x + rx, y, leafMid, z - 0.035);
      triangle(x - rx * 0.5, y + ry * 0.5, x - rx * 0.1, y + ry * 1.05, x + rx * 0.45, y + ry * 0.6, leafLit, z - 0.07);
    };
    // Spread through the crown rather than stacked on one plane: neighbouring clumps
    // sit at opposite ends of the depth range, so the pair that overlaps most on
    // screen is the pair furthest apart in z. In the perpendicular copy the same
    // spread becomes width, which is what a canopy has anyway.
    clump(-0.44, 0.74, 0.26, 0.16, 0.24);
    clump(0.42, 0.76, 0.27, 0.17, -0.18);
    clump(-0.2, 0.8, 0.3, 0.2, 0.06);
    clump(0.18, 0.82, 0.31, 0.21, -0.3);
    clump(-0.05, 0.9, 0.33, 0.2, 0.18);
    clump(-0.3, 0.95, 0.2, 0.14, -0.08);
    clump(0.26, 0.96, 0.21, 0.14, 0.32);
  });
}

/**
 * A saguaro: a fluted column with two arms, each turning up at the elbow.
 *
 * Roundness comes from three vertical strips — shade, body, highlight — running the
 * whole height, which is what a flat quad of one green could never give. The ribs are
 * two darker lines inside the body strip, the crown is domed rather than pointed, and
 * the blooms sit on the tips where they actually grow.
 */
function cactusGeometry(): THREE.BufferGeometry {
  return crossedCardGeometry((triangle) => {
    const shade = displayColour(0x4f7a52);
    const body = displayColour(0x76ab74);
    const lit = displayColour(0x9ecf92);
    const rib = displayColour(0x628c61);
    const bloom = displayColour(0xf7d7a0);
    const quad = (
      x0: number, y0: number, x1: number, y1: number, colour: THREE.Color, z = 0,
    ): void => {
      triangle(x0, y0, x1, y0, x1, y1, colour, z);
      triangle(x0, y0, x1, y1, x0, y1, colour, z);
    };
    /** A limb as three tonal strips, with a domed cap. */
    const column = (
      x0: number, x1: number, y0: number, y1: number, z: number,
    ): void => {
      const w = x1 - x0;
      quad(x0, y0, x0 + w * 0.3, y1, shade, z);
      quad(x0 + w * 0.3, y0, x0 + w * 0.78, y1, body, z);
      quad(x0 + w * 0.78, y0, x1, y1, lit, z);
      quad(x0 + w * 0.42, y0, x0 + w * 0.47, y1 - w * 0.4, rib, z - 0.0005);
      quad(x0 + w * 0.62, y0, x0 + w * 0.67, y1 - w * 0.4, rib, z - 0.0005);
      // Dome: two steps rather than a point, so the tip is not a spike.
      triangle(x0, y1, x1, y1, x1 - w * 0.18, y1 + w * 0.34, body, z);
      triangle(x0, y1, x1 - w * 0.18, y1 + w * 0.34, x0 + w * 0.18, y1 + w * 0.34, body, z);
      triangle(x0 + w * 0.18, y1 + w * 0.34, x1 - w * 0.18, y1 + w * 0.34, x0 + w * 0.5, y1 + w * 0.52, lit, z - 0.001);
    };

    column(-0.1, 0.1, 0, 0.92, 0);
    // Left arm: out, then up, with the elbow filled so the turn is not a notch.
    quad(-0.4, 0.4, -0.08, 0.53, body, -0.002);
    quad(-0.4, 0.4, -0.33, 0.46, shade, -0.0025);
    column(-0.4, -0.26, 0.44, 0.74, -0.003);
    // Right arm, higher and shorter.
    quad(0.08, 0.56, 0.36, 0.68, body, -0.002);
    quad(0.29, 0.56, 0.36, 0.62, shade, -0.0025);
    column(0.25, 0.38, 0.6, 0.83, -0.003);
    // Blooms on the three tips.
    triangle(-0.06, 1.0, 0.06, 1.0, 0, 1.07, bloom, -0.004);
    triangle(-0.36, 0.82, -0.28, 0.82, -0.32, 0.88, bloom, -0.004);
    triangle(0.28, 0.91, 0.36, 0.91, 0.32, 0.97, bloom, -0.004);
  });
}
/**
 * A beached freighter, listing, with its plating gone amidships.
 *
 * THREE THINGS MAKE A HULL READ AS A HULL and the earlier version had none of them.
 * It LISTS: the whole wreck leans, which is the difference between a ship aground and a
 * box on sand. It has SHEER: the deck line curves up toward the bow instead of running
 * level, which is the one curve the eye uses to tell a ship from a shed. And it is lit
 * from one side, in four rust tones plus a bleached deck, so the flank has a top, a
 * middle and a shadowed turn of the bilge.
 *
 * The hold is open to the sky — a dark interior with frames standing in it — and sand
 * has drifted against the low side. Authored one unit tall like every other card, so an
 * instance's height scales the whole wreck.
 */
/**
 * A wreck with VOLUME, not a drawn silhouette.
 *
 * The fleet used to be flat cards, and a card is the wrong instrument for a seventy-metre
 * hull. It was two perpendicular copies of one hand-drawn profile, which is a trick that
 * works for a palm — a small form needs a second plane or it vanishes when you look down
 * its edge — and is nonsense for a ship, where the second copy is a whole second vessel at
 * right angles. Measured on the shipped geometry: half of every vertex had a perpendicular
 * twin, the extent was the full length along BOTH axes, and of its 109 edges 83 were open
 * boundary — two shells with two normals between them. From the road that is literally an
 * X, and the player reported exactly an X.
 *
 * So the hull is built as a solid. A station list runs from stern to bow, each station
 * carrying its own half-beam and its own keel and deck heights, and consecutive stations
 * are lofted into a closed ring. That is the cheapest way to make a recognisable ship:
 * the sheer line rising to the bow, the plan narrowing forward, the bilge turning — all of
 * it falls out of two one-dimensional tables rather than being drawn face by face.
 *
 * The winding is settled by the geometry itself rather than by hand. A closed surface's
 * signed volume is positive when its normals face out, so the sign is measured and the
 * triangles are flipped if it comes back negative. That is what lets the material drop to
 * single-sided: a solid does not need its own inside drawn, and the old DoubleSide setting
 * was the other half of why these read as planes.
 *
 * Colour is still the same painted palette, indexed by height up the hull, so the banding
 * that made the flat ones legible survives the change to real form.
 */
function shipGeometry(): THREE.BufferGeometry {
  const hullLit = displayColour(0xcf7a4e);
  const hull = displayColour(0xb35f3c);
  const bilge = displayColour(0x7d4029);
  const rust = displayColour(0xe6a05c);
  const deck = displayColour(0xd9c19c);
  const dark = displayColour(0x4a2a1d);
  const drift = displayColour(0xd9ab74);

  const positions: number[] = [];
  const colours: number[] = [];
  type P3 = readonly [number, number, number];
  const tri = (a: P3, b: P3, c: P3, colour: THREE.Color): void => {
    positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let i = 0; i < 3; i++) colours.push(colour.r, colour.g, colour.b);
  };
  const quad = (a: P3, b: P3, c: P3, d: P3, colour: THREE.Color): void => {
    tri(a, b, c, colour);
    tri(a, c, d, colour);
  };

  /**
   * Stations, stern to bow. `halfBeam` is the plan, `keelY` the bottom and `deckY` the
   * deck edge: the sheer climbs forward and the plan narrows to a raked stem.
   */
  const stations: readonly { x: number; halfBeam: number; keelY: number; deckY: number }[] = [
    { x: -0.58, halfBeam: 0.055, keelY: 0.16, deckY: 0.32 },
    { x: -0.44, halfBeam: 0.068, keelY: 0.10, deckY: 0.36 },
    { x: -0.26, halfBeam: 0.074, keelY: 0.06, deckY: 0.4 },
    { x: -0.08, halfBeam: 0.076, keelY: 0.04, deckY: 0.43 },
    { x: 0.1, halfBeam: 0.073, keelY: 0.04, deckY: 0.45 },
    { x: 0.28, halfBeam: 0.065, keelY: 0.05, deckY: 0.46 },
    { x: 0.44, halfBeam: 0.051, keelY: 0.07, deckY: 0.47 },
    { x: 0.6, halfBeam: 0.032, keelY: 0.11, deckY: 0.5 },
    { x: 0.72, halfBeam: 0.016, keelY: 0.15, deckY: 0.54 },
    { x: 0.78, halfBeam: 0.007, keelY: 0.19, deckY: 0.58 },
  ];

  /** One station's closed cross-section, keel round the starboard side to the keel again. */
  const ring = (s: (typeof stations)[number]): P3[] => {
    const depth = s.deckY - s.keelY;
    const w = s.halfBeam;
    const at = (h: number, z: number): P3 => [s.x, s.keelY + depth * h, z];
    return [
      at(0, 0),
      at(0.3, w * 0.78),
      at(0.72, w),
      at(1, w * 0.82),
      at(1, 0),
      at(1, -w * 0.82),
      at(0.72, -w),
      at(0.3, -w * 0.78),
    ];
  };
  const bandColour = (s: (typeof stations)[number], y: number): THREE.Color => {
    const h = (y - s.keelY) / Math.max(1e-6, s.deckY - s.keelY);
    if (h >= 0.999) return deck;
    if (h < 0.3) return bilge;
    if (h < 0.78) return hull;
    return hullLit;
  };

  const rings = stations.map(ring);
  for (let i = 0; i + 1 < stations.length; i++) {
    const a = rings[i]!;
    const b = rings[i + 1]!;
    for (let k = 0; k < a.length; k++) {
      const k2 = (k + 1) % a.length;
      const y = (a[k]![1] + a[k2]![1] + b[k]![1] + b[k2]![1]) * 0.25;
      quad(a[k]!, a[k2]!, b[k2]!, b[k]!, bandColour(stations[i]!, y));
    }
  }
  // Both ends closed, so the solid is watertight and needs no second side.
  for (const [index, end] of [stations[0]!, stations[stations.length - 1]!].entries()) {
    const r = rings[index === 0 ? 0 : rings.length - 1]!;
    for (let k = 1; k + 1 < r.length; k++) {
      tri(r[0]!, r[k]!, r[k + 1]!, index === 0 ? bilge : hull);
    }
  }

  /**
   * A solid box, for everything that stands on the deck. Six faces, twelve triangles, and
   * it shares the ship's lean so the whole wreck lists together.
   */
  const box = (
    cx: number,
    cy: number,
    cz: number,
    hx: number,
    hy: number,
    hz: number,
    lean: number,
    colour: THREE.Color,
    top: THREE.Color = colour,
  ): void => {
    const lift = (x: number, y: number, z: number): P3 => [x, y + (x - cx) * lean, z];
    const x0 = cx - hx;
    const x1 = cx + hx;
    const y0 = cy - hy;
    const y1 = cy + hy;
    const z0 = cz - hz;
    const z1 = cz + hz;
    const v = (x: number, y: number, z: number): P3 => lift(x, y, z);
    quad(v(x0, y1, z0), v(x1, y1, z0), v(x1, y1, z1), v(x0, y1, z1), top);
    quad(v(x0, y0, z1), v(x1, y0, z1), v(x1, y0, z0), v(x0, y0, z0), colour);
    quad(v(x0, y0, z0), v(x1, y0, z0), v(x1, y1, z0), v(x0, y1, z0), colour);
    quad(v(x0, y1, z1), v(x1, y1, z1), v(x1, y0, z1), v(x0, y0, z1), colour);
    quad(v(x0, y0, z1), v(x0, y1, z1), v(x0, y1, z0), v(x0, y0, z0), colour);
    quad(v(x1, y0, z0), v(x1, y1, z0), v(x1, y1, z1), v(x1, y0, z1), colour);
  };
  /** The wreck's own lean: bow down to starboard by about seven degrees. */
  const LEAN = -0.12;

  // Deckhouse aft: three tiers, each set back, with a dark window band on the middle one.
  box(-0.42, 0.38, 0, 0.075, 0.045, 0.052, LEAN, hull);
  box(-0.41, 0.47, 0, 0.058, 0.045, 0.042, LEAN, hullLit);
  box(-0.4, 0.545, 0, 0.042, 0.03, 0.03, LEAN, hull);
  box(-0.41, 0.47, 0.043, 0.05, 0.02, 0.002, LEAN, dark);
  box(-0.41, 0.47, -0.043, 0.05, 0.02, 0.002, LEAN, dark);
  // Funnel, raked aft, with its band.
  box(-0.2, 0.62, 0, 0.045, 0.09, 0.032, LEAN, hull);
  box(-0.2, 0.665, 0, 0.046, 0.018, 0.033, LEAN, dark);
  // Mast and boom forward, still standing; the boom is a slim box, not a line.
  box(0.32, 0.62, 0, 0.011, 0.17, 0.011, LEAN, hull);
  box(0.3, 0.66, 0, 0.09, 0.008, 0.008, LEAN, hull);
  // Boot stripe along the old waterline, a thin proud box rather than a painted face.
  box(0.05, 0.09, 0, 0.6, 0.006, 0.078, LEAN, rust);

  // Debris on the sand: two plates and a drift of sand, which remain flat because they
  // are lying on the ground and a plate has no third dimension to lose.
  quad(
    [-0.86, 0.01, -0.06], [-0.66, 0.01, 0.02], [-0.68, 0.05, 0.06], [-0.9, 0.05, -0.02],
    bilge,
  );
  quad(
    [-0.7, 0.005, 0.1], [-0.52, 0.005, 0.09], [-0.53, 0.055, 0.13], [-0.69, 0.055, 0.14],
    drift,
  );

  // WINDING BY MEASUREMENT, not by hand: a closed surface encloses a positive signed
  // volume, so the sign is read off the geometry and the triangles flipped when it comes
  // back negative. Getting the loft's triangle order right on paper is not worth the
  // effort when the answer is one sum away.
  let volume = 0;
  for (let i = 0; i < positions.length; i += 9) {
    const ax = positions[i]!;
    const ay = positions[i + 1]!;
    const az = positions[i + 2]!;
    const bx = positions[i + 3]!;
    const by = positions[i + 4]!;
    const bz = positions[i + 5]!;
    const cx = positions[i + 6]!;
    const cy = positions[i + 7]!;
    const cz = positions[i + 8]!;
    volume += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
  }
  if (volume < 0) {
    for (let i = 0; i < positions.length; i += 9) {
      for (let k = 0; k < 3; k++) {
        const t = positions[i + 3 + k]!;
        positions[i + 3 + k] = positions[i + 6 + k]!;
        positions[i + 6 + k] = t;
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** A solid needs its outside drawn and nothing else. */
function hullMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.FrontSide,
    transparent: true,
    opacity: 0,
    depthWrite: true,
    fog: true,
    toneMapped: true,
  });
}

export function cardMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0,
    depthWrite: true,
    fog: true,
    toneMapped: true,
  });
}

/**
 * Blocks are box instances, and the material may only ask for vertex colours when the
 * geometry actually carries them: `vertexColors: true` over a plain `BoxGeometry` made
 * the shader read a disabled attribute — a constant black — and multiplied every
 * building by zero, which is why the sandstone city once rendered as a silhouette.
 * Per-building paint arrives through `instanceColor` either way.
 */
function blockMaterial(toned: boolean): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: 0xffffff,
    vertexColors: toned,
    transparent: true,
    opacity: 0,
    depthWrite: true,
    fog: true,
    toneMapped: true,
  });
}

/**
 * A box whose six faces carry six tones, so an unlit building has a sunny side.
 *
 * The city is drawn with `MeshBasicMaterial` for the same reason the mirages are: it
 * is refracted light rather than a surface, and a lit material put the sun behind the
 * skyline as often as in front of it. The cost of that was a town of flat rectangles
 * where two walls meeting at a corner were the same number, so the corner vanished
 * and every block read as a sticker. One baked light direction — top brightest, +X
 * sunlit, -X in shade — costs nothing and gives every box its third dimension back.
 * `instanceColor` multiplies this, so a building's paint still arrives per instance.
 */
function tonedBoxGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  // BoxGeometry's groups run +X, -X, +Y, -Y, +Z, -Z, four vertices each.
  const faceTone = [1.1, 0.72, 1.18, 0.58, 0.95, 0.8];
  const position = geometry.getAttribute('position');
  const colours = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const tone = faceTone[Math.floor(i / 4)] ?? 1;
    colours[i * 3] = tone;
    colours[i * 3 + 1] = tone;
    colours[i * 3 + 2] = tone;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  return geometry;
}

/** The same treatment for a roof cone: lit on the +X side, shaded away from it. */
function tonedConeGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.ConeGeometry(0.5, 1, 6);
  const position = geometry.getAttribute('position');
  const colours = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const facing = (x * 0.82 + z * 0.3) / 0.5;
    const tone = 0.74 + Math.max(0, facing) * 0.42;
    colours[i * 3] = tone;
    colours[i * 3 + 1] = tone;
    colours[i * 3 + 2] = tone;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  return geometry;
}

/**
 * Wall paint per building.
 *
 * A desert town is mostly sandstone and whitewash, so those two families carry most
 * of the weight; terracotta, faded teal, dusty blue, pale rose and olive are the
 * minority of painted blocks that let a skyline read as a town rather than as one
 * quarry. Authored in the same DISPLAY space as `displayColour`: pale, because the
 * frame is tone mapped on the way out and a mid-lightness wall reads as shadow.
 */
interface CityPaint {
  readonly hue: number;
  readonly saturation: number;
  readonly lightness: number;
  /** Relative share of the buildings that receive this family. */
  readonly weight: number;
}

const CITY_WALL_PAINTS: readonly CityPaint[] = [
  { hue: 0.085, saturation: 0.3, lightness: 0.7, weight: 3 },
  { hue: 0.11, saturation: 0.15, lightness: 0.79, weight: 2.2 },
  { hue: 0.045, saturation: 0.33, lightness: 0.67, weight: 1.4 },
  { hue: 0.47, saturation: 0.18, lightness: 0.73, weight: 1 },
  { hue: 0.58, saturation: 0.17, lightness: 0.72, weight: 1 },
  { hue: 0.96, saturation: 0.16, lightness: 0.75, weight: 0.8 },
  { hue: 0.2, saturation: 0.17, lightness: 0.71, weight: 0.8 },
];

/**
 * Roofs are the one part of a block nobody whitewashes: fired tile, painted tin,
 * patinated copper or slate. They are therefore darker and more saturated than the
 * wall below, which is what gives the skyline its punctuation.
 */
const CITY_ROOF_PAINTS: readonly CityPaint[] = [
  { hue: 0.03, saturation: 0.44, lightness: 0.57, weight: 3 },
  { hue: 0.08, saturation: 0.19, lightness: 0.61, weight: 2 },
  { hue: 0.44, saturation: 0.2, lightness: 0.56, weight: 1.2 },
  { hue: 0.6, saturation: 0.17, lightness: 0.59, weight: 1 },
];

/** Weighted pick from a paint list for a unit hash. */
function pickPaint(paints: readonly CityPaint[], unit: number): CityPaint {
  let total = 0;
  for (const paint of paints) total += paint.weight;
  let cursor = unit * total;
  for (const paint of paints) {
    cursor -= paint.weight;
    if (cursor <= 0) return paint;
  }
  return paints[0]!;
}

/**
 * Rare render-only tableaus around the road.
 *
 * Every encounter is deterministic, starts 3–8 km after the previous one, and draws
 * from a shuffled set of five forms so each group of five contains every form once.
 * Only the active encounter owns instance matrices. Nothing enters physics, streaming,
 * saves, terrain, or shadow passes. Each tableau uses a handful of instanced draws,
 * preserving local coordinates around the encounter anchor at any road distance.
 */
export class MirageTableau {
  private readonly root = new THREE.Group();
  /** One instanced mesh per palm form; an instance picks its form by hash. */
  private readonly palms: readonly THREE.InstancedMesh[];
  private readonly trees: THREE.InstancedMesh;
  private readonly cacti: THREE.InstancedMesh;
  private readonly blocks: THREE.InstancedMesh;
  private readonly cityWindows: THREE.InstancedMesh;
  private readonly cityAccents: THREE.InstancedMesh;
  private readonly cityRoofs: THREE.InstancedMesh;
  private readonly cityStreets: THREE.InstancedMesh;
  private readonly ships: THREE.InstancedMesh;
  private readonly materials: readonly THREE.MeshBasicMaterial[];
  private readonly encounters: readonly Encounter[];

  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly colour = new THREE.Color();
  /** Accepted wreck centres and their footprint radii, so a new hulk can dodge them. */
  private readonly shipX = new Float32Array(MAX_SHIPS);
  private readonly shipZ = new Float32Array(MAX_SHIPS);
  private readonly shipRadius = new Float32Array(MAX_SHIPS);

  private activeEncounter = -1;
  private anchorX = 0;
  private anchorY = 0;
  private anchorZ = 0;
  private densityScale = 1;
  private sizeScale = 1;
  /**
   * How far a wreck reaches from its own origin per unit of length scale, MEASURED
   * off the geometry rather than guessed.
   *
   * Two hand-written constants in a row got this wrong and the fleet kept crossing.
   * A hull is not centred on its origin: the bow runs to 0.78 of the length while the
   * stern stops at 0.58, and the debris reaches further still, so its footprint is
   * neither a half-length nor a circle about the middle. It is the furthest vertex in
   * the XZ plane, and only the geometry knows where that is. What this guards against
   * is hulls INTERSECTING; the crossing the player reported was the silhouette itself,
   * which is a separate fault and is fixed in `shipGeometry`.
   */
  private readonly shipReach: number;
  private setbackM = 0;
  private previewActive = false;
  private previewOpacity = 0;

  constructor(
    scene: THREE.Scene,
    private readonly road: Road,
    private readonly terrain: Terrain,
    private readonly seed: number,
    private readonly origin: WorldOrigin,
  ) {
    const palmMaterial = cardMaterial();
    const treeMaterial = cardMaterial();
    const cactusMaterial = cardMaterial();
    const stoneMaterial = blockMaterial(true);
    const windowMaterial = blockMaterial(false);
    const accentMaterial = blockMaterial(true);
    const roofMaterial = blockMaterial(true);
    const streetMaterial = blockMaterial(false);
    const shipMaterial = hullMaterial();
    this.materials = [
      palmMaterial,
      treeMaterial,
      cactusMaterial,
      stoneMaterial,
      shipMaterial,
      windowMaterial,
      accentMaterial,
      roofMaterial,
      streetMaterial,
    ];

    this.palms = PALM_FORMS.map(
      (_form, index) => new THREE.InstancedMesh(palmGeometry(index), palmMaterial, MAX_PLANTS),
    );
    this.trees = new THREE.InstancedMesh(treeGeometry(), treeMaterial, MAX_PLANTS);
    this.cacti = new THREE.InstancedMesh(cactusGeometry(), cactusMaterial, MAX_PLANTS);
    const box = new THREE.BoxGeometry(1, 1, 1);
    this.blocks = new THREE.InstancedMesh(tonedBoxGeometry(), stoneMaterial, MAX_BLOCKS);
    this.cityWindows = new THREE.InstancedMesh(box, windowMaterial, MAX_CITY_WINDOWS);
    this.cityAccents = new THREE.InstancedMesh(tonedBoxGeometry(), accentMaterial, MAX_CITY_ACCENTS);
    this.cityRoofs = new THREE.InstancedMesh(
      tonedConeGeometry(),
      roofMaterial,
      MAX_CITY_ROOFS,
    );
    this.cityStreets = new THREE.InstancedMesh(box, streetMaterial, MAX_CITY_STREETS);
    const hull = shipGeometry();
    this.shipReach = planarReach(hull);
    this.ships = new THREE.InstancedMesh(hull, shipMaterial, MAX_SHIPS);

    for (const mesh of this.meshes) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.root.add(mesh);
    }
    this.root.visible = false;
    scene.add(this.root);
    this.encounters = this.buildSchedule();
  }

  update(playerS: number, playerLateral: number, dayFactor: number): void {
    const encounterIndex = this.findEncounter(playerS);
    if (encounterIndex < 0 || dayFactor <= 0.12) {
      this.root.visible = false;
      return;
    }
    if (encounterIndex !== this.activeEncounter) this.activate(encounterIndex);

    const encounter = this.encounters[encounterIndex]!;
    const roadFade = 1 - smoothstep(FADE_FROM_ROAD_M, GONE_FROM_ROAD_M, Math.abs(playerLateral));
    const approachFade = smoothstep(encounter.startS - APPROACH_M, encounter.startS - 420, playerS);
    const retreatFade = 1 - smoothstep(
      encounter.startS + encounter.length,
      encounter.startS + encounter.length + RETREAT_M,
      playerS,
    );
    const daylightFade = smoothstep(0.12, 0.42, dayFactor);
    const opacity = roadFade * approachFade * retreatFade * daylightFade;
    this.root.visible = opacity > 0.002;
    if (!this.root.visible) return;

    this.setMaterialOpacity(opacity);
    this.root.position.set(
      this.anchorX - this.origin.x,
      this.anchorY,
      this.anchorZ - this.origin.z,
    );
  }

  /**
   * Direct presentation path for comparing every authored tableau in the lab.
   *
   * The tableau always straddles the road exactly as it does in game: the anchor is
   * the centreline, `setback` pushes both verges outward, and `scale` resizes the
   * forms only. Moving or scaling the group as a whole would drag the far verge
   * across the asphalt, which is the one thing a roadside tableau must never do.
   */
  showPreview(
    kind: MirageKind,
    startS: number,
    length: number,
    setback: number,
    opacity: number,
    scale: number,
    variation: number,
    density: number,
  ): void {
    this.previewActive = true;
    const encounter = {
      index: Math.round(variation),
      startS,
      length: Math.max(80, length),
      kind,
    };
    this.activateEncounter(encounter, density, scale, setback);
    this.root.scale.setScalar(1);
    this.root.position.set(
      this.anchorX - this.origin.x,
      this.anchorY,
      this.anchorZ - this.origin.z,
    );
    this.previewOpacity = Math.min(1, Math.max(0, opacity));
    this.setPreviewDayFactor(1, 0);
  }

  /**
   * The lab is driveable, so the preview owes the player the same vanishing act the
   * game gives: leave the asphalt and the apparition goes with it.
   */
  setPreviewDayFactor(dayFactor: number, playerLateral: number): void {
    const roadFade = 1 - smoothstep(FADE_FROM_ROAD_M, GONE_FROM_ROAD_M, Math.abs(playerLateral));
    const alpha = this.previewOpacity * smoothstep(0.12, 0.42, dayFactor) * roadFade;
    this.setMaterialOpacity(alpha);
    this.root.visible = this.previewActive && alpha > 0.002;
  }

  hide(): void {
    this.previewActive = false;
    this.root.visible = false;
  }

  private get meshes(): readonly THREE.InstancedMesh[] {
    return [
      ...this.palms,
      this.trees,
      this.cacti,
      this.blocks,
      this.cityWindows,
      this.cityAccents,
      this.cityRoofs,
      this.cityStreets,
      this.ships,
    ];
  }

  private setMaterialOpacity(opacity: number): void {
    for (const material of this.materials) material.opacity = opacity;
    // Ships are broader and warmer; a little less alpha keeps them in the same
    // atmospheric distance as the plants without becoming a flat orange wall.
    this.materials[4]!.opacity = opacity * 0.74;
    this.materials[5]!.opacity = opacity * 0.9;
    this.materials[6]!.opacity = opacity * 0.82;
    this.materials[7]!.opacity = opacity * 0.86;
    this.materials[8]!.opacity = opacity * 0.58;
  }

  private buildSchedule(): readonly Encounter[] {
    const encounters: Encounter[] = [];
    let startS = MIN_GAP_M + hashUnit3(this.seed, -1, SALT_GAP) * GAP_RANGE_M;
    let index = 0;
    let permutation: MirageKind[] = [];
    while (startS < this.road.length) {
      if (index % 5 === 0) {
        permutation = ['palms', 'trees', 'cacti', 'city', 'ships'];
        const block = Math.floor(index / 5);
        for (let i = permutation.length - 1; i > 0; i--) {
          const j = Math.floor(hashUnit3(this.seed, block * 8 + i, SALT_VARIANT) * (i + 1));
          const swap = permutation[i]!;
          permutation[i] = permutation[j]!;
          permutation[j] = swap;
        }
      }
      const kind = permutation[index % 5]!;
      encounters.push({
        index,
        startS,
        // A fleet is the one tableau read as a LANDSCAPE rather than as a verge: it
        // needs to arrive, surround and leave, and 700 m of it goes by in half a
        // minute. It also has to spread its hulls out, and the length is the only
        // axis with room to do that, because their distance from the road is fixed.
        length:
          kind === 'ships'
            ? 1_400 + hashUnit3(this.seed, index, SALT_LENGTH) * 260
            : 680 + hashUnit3(this.seed, index, SALT_LENGTH) * 520,
        kind,
      });
      startS += MIN_GAP_M + hashUnit3(this.seed, index, SALT_GAP) * GAP_RANGE_M;
      index++;
    }
    return encounters;
  }

  private findEncounter(playerS: number): number {
    const target = playerS + APPROACH_M;
    let lo = 0;
    let hi = this.encounters.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.encounters[mid]!.startS <= target) lo = mid + 1;
      else hi = mid;
    }
    const candidate = lo - 1;
    if (candidate < 0) return -1;
    const encounter = this.encounters[candidate]!;
    return playerS <= encounter.startS + encounter.length + RETREAT_M ? candidate : -1;
  }

  private activate(index: number): void {
    this.activeEncounter = index;
    const encounter = this.encounters[index]!;
    // Palms are the one grove worth seeing as ARCHITECTURE rather than as vegetation:
    // a thin stand of giants reads as an oasis somebody could walk into, while three
    // hundred ordinary ones are a hedge along the road. Tenfold fewer at three times
    // the height is the same triangle budget spent on silhouettes you can tell apart.
    const palms = encounter.kind === 'palms';
    this.activateEncounter(encounter, palms ? 0.1 : 1, palms ? 3 : 1, 0);
  }

  /**
   * `size` scales the forms only and `setback` pushes both verges away from the
   * asphalt; neither may move the tableau sideways, so the road always runs through
   * the middle of it.
   */
  private activateEncounter(
    encounter: Encounter,
    density: number,
    size: number,
    setback: number,
  ): void {
    this.densityScale = Math.min(1, Math.max(0.02, density));
    this.sizeScale = Math.min(8, Math.max(0.05, size));
    this.setbackM = Math.max(0, setback);
    for (const mesh of this.meshes) {
      mesh.count = 0;
      mesh.visible = false;
    }
    const anchor = this.road.sampleAt(encounter.startS);
    this.anchorX = anchor.x;
    this.anchorY = anchor.y;
    this.anchorZ = anchor.z;
    switch (encounter.kind) {
      case 'palms':
        this.buildPlants(this.palms, encounter, 360, 9, 185, 8, 18, PALM_TINT);
        break;
      case 'trees':
        this.buildPlants([this.trees], encounter, 390, 9, 150, 7, 16, TREE_TINT);
        break;
      case 'cacti':
        this.buildPlants([this.cacti], encounter, 420, 8, 220, 3.5, 11, CACTUS_TINT);
        break;
      case 'city':
        this.buildCity(encounter);
        break;
      case 'ships':
        this.buildShips(encounter);
        break;
    }
  }

  /**
   * Scatters one plant species along the encounter.
   *
   * `forms` is a set of interchangeable silhouettes sharing one material: an instance
   * picks one by hash and lands in that form's own buffer, so a grove of three palms
   * costs three draws instead of one and never repeats the same tree twice in a row.
   */
  private buildPlants(
    forms: readonly THREE.InstancedMesh[],
    encounter: Encounter,
    count: number,
    lateralMin: number,
    lateralMax: number,
    heightMin: number,
    heightMax: number,
    tint: THREE.Color,
  ): void {
    const instanceCount = Math.max(1, Math.round(count * this.densityScale));
    const used = new Array<number>(forms.length).fill(0);
    for (let i = 0; i < instanceCount; i++) {
      const key = encounter.index * MAX_PLANTS + i;
      const along = hashUnit3(this.seed, key, SALT_PLACEMENT);
      const s = encounter.startS + 8 + along * along * (encounter.length - 16);
      const side = hashUnit3(this.seed, key, SALT_PLACEMENT + 1) < 0.5 ? -1 : 1;
      const depth = hashUnit3(this.seed, key, SALT_PLACEMENT + 2);
      const lateral = side * (this.setbackM + lateralMin + depth * depth * (lateralMax - lateralMin));
      const point = this.road.offsetPoint(s, lateral);
      const ground = this.terrain.heightAt(point.x, point.z, s);
      const height = (heightMin + hashUnit3(this.seed, key, SALT_SHAPE) * (heightMax - heightMin)) * this.sizeScale;
      const widthScale = 0.82 + hashUnit3(this.seed, key, SALT_SHAPE + 1) * 0.36;
      const yaw = hashUnit3(this.seed, key, SALT_SHAPE + 2) * Math.PI;

      const form = Math.min(
        forms.length - 1,
        Math.floor(hashUnit3(this.seed, key, SALT_VARIANT) * forms.length),
      );
      const mesh = forms[form]!;
      const slot = used[form]!;
      if (slot >= MAX_PLANTS) continue;
      used[form] = slot + 1;

      this.setTransform(mesh, slot, point.x - this.anchorX, ground - this.anchorY, point.z - this.anchorZ, height * widthScale, height, height * widthScale, yaw);
      // The instance colour MULTIPLIES the card palette, so it is a haze tint near
      // white rather than a second base colour. Two dark factors multiplied is what
      // made a grove black; here the far rows are lifted toward the shimmering air
      // and the near ones keep their own green.
      const lift =
        (0.9 + depth * 0.3) *
        (0.94 + hashUnit3(this.seed, key, SALT_COLOUR) * 0.14);
      this.colour.copy(tint).multiplyScalar(lift);
      mesh.setColorAt(slot, this.colour);
    }
    for (let form = 0; form < forms.length; form++) {
      const mesh = forms[form]!;
      mesh.count = used[form]!;
      mesh.visible = mesh.count > 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  /**
   * A compact skyline rather than a pile of anonymous boxes:
   * warm masonry blocks, cool window rhythm, balconies, roof caps and the dark
   * strips of streets between them. Everything remains instanced and render-only.
   */
  private buildCity(encounter: Encounter): void {
    let count = 0;
    let windowCount = 0;
    let accentCount = 0;
    let roofCount = 0;
    let streetCount = 0;
    const buildings = Math.max(1, Math.round(156 * this.densityScale));
    const groundRelative = (ground: number): number => ground - this.anchorY;
    const localPoint = (
      point: { readonly x: number; readonly z: number },
      localX: number,
      localZ: number,
      heading: number,
    ): { x: number; z: number } => ({
      x: point.x + Math.cos(heading) * localX + Math.sin(heading) * localZ - this.anchorX,
      z: point.z - Math.sin(heading) * localX + Math.cos(heading) * localZ - this.anchorZ,
    });

    for (let i = 0; i < buildings; i++) {
      const key = encounter.index * MAX_BLOCKS + i;
      const along = hashUnit3(this.seed, key, SALT_PLACEMENT);
      const s = encounter.startS + 10 + along * along * (encounter.length - 20);
      const side = hashUnit3(this.seed, key, SALT_PLACEMENT + 1) < 0.5 ? -1 : 1;
      const depth = hashUnit3(this.seed, key, SALT_PLACEMENT + 2);
      const lateral = side * (this.setbackM + 18 + depth * depth * 127);
      const point = this.road.offsetPoint(s, lateral);
      const heading = this.road.sampleAt(s).heading;
      const width = (5 + hashUnit3(this.seed, key, SALT_SHAPE) * 9) * this.sizeScale;
      const buildingDepth =
        (5 + hashUnit3(this.seed, key, SALT_SHAPE + 1) * 9) * this.sizeScale;
      const tower = hashUnit3(this.seed, key, SALT_SHAPE + 6) > 0.92;
      const height = (
        tower
          ? 24 + hashUnit3(this.seed, key, SALT_SHAPE + 2) * 24
          : 4 + hashUnit3(this.seed, key, SALT_SHAPE + 2) * 14
      ) * this.sizeScale;
      // A block is plumb, so it is seated on the LOWEST corner of its own footprint:
      // on 10% ground a 12 m block placed from its centre sample stands on a plinth
      // of air along one wall.
      const ground = fitGround(
        this.terrain,
        point.x,
        point.z,
        heading,
        width * 0.5,
        buildingDepth * 0.5,
        s,
        2,
      ).seatAt(0, 0, width * 0.5, buildingDepth * 0.5);
      const y = groundRelative(ground);
      this.cityColour(key, depth, 0);
      count = this.addBox(
        count,
        point.x - this.anchorX,
        y,
        point.z - this.anchorZ,
        width,
        height,
        buildingDepth,
        heading,
        this.colour,
      );

      let totalHeight = height;
      if (hashUnit3(this.seed, key, SALT_SHAPE + 3) > 0.48) {
        const upperHeight = height * (0.18 + hashUnit3(this.seed, key, SALT_SHAPE + 4) * 0.25);
        this.cityColour(key, depth, 1);
        count = this.addBox(
          count,
          point.x - this.anchorX,
          y + totalHeight,
          point.z - this.anchorZ,
          width * 0.58,
          upperHeight,
          buildingDepth * 0.62,
          heading,
          this.colour,
        );
        totalHeight += upperHeight;
      }
      if (hashUnit3(this.seed, key, SALT_SHAPE + 5) > 0.72) {
        this.colour.setHSL(0.09, 0.24, 0.76 + depth * 0.08);
        count = this.addBox(
          count,
          point.x - this.anchorX,
          y + totalHeight,
          point.z - this.anchorZ,
          width * 1.08,
          0.7,
          buildingDepth * 1.08,
          heading,
          this.colour,
        );
      }

      // A little road-shadow at each block prevents the city reading as weightless
      // cubes and costs only one additional instanced box at most.
      if (streetCount < MAX_CITY_STREETS && hashUnit3(this.seed, key, SALT_COLOUR + 4) > 0.28) {
        this.colour.setHSL(0.08, 0.2, 0.29 + depth * 0.08);
        streetCount = this.addBox(
          streetCount,
          point.x - this.anchorX,
          y,
          point.z - this.anchorZ,
          width * 1.45,
          0.06,
          buildingDepth * 0.28,
          heading,
          this.colour,
          this.cityStreets,
        );
      }

      const rows = Math.max(1, Math.min(4, Math.floor(height / 3.4)));
      const columns = width > 9 ? 2 : 1;
      const windowHeight = Math.max(0.35, Math.min(1.05, height / (rows * 3.6)));
      const windowWidth = Math.max(0.28, Math.min(1.7, width / (columns * 4.4)));
      const fronts = hashUnit3(this.seed, key, SALT_PLACEMENT + 5) > 0.34 ? 2 : 1;
      for (let face = 0; face < fronts; face++) {
        const localZ = (face === 0 ? 1 : -1) * (buildingDepth * 0.5 + 0.045);
        for (let row = 0; row < rows; row++) {
          const floorY = 1.1 + row * (height / (rows + 0.45));
          for (let column = 0; column < columns; column++) {
            if (windowCount >= MAX_CITY_WINDOWS) break;
            const localX = (column - (columns - 1) * 0.5) * width * 0.34;
            const windowPoint = localPoint(point, localX, localZ, heading);
            this.cityWindowColour(key, depth, row + column + face);
            windowCount = this.addBox(
              windowCount,
              windowPoint.x,
              y + floorY,
              windowPoint.z,
              windowWidth,
              windowHeight,
              0.07,
              heading,
              this.colour,
              this.cityWindows,
            );
          }
        }
      }

      // Balconies make the mid-rise blocks read as inhabited buildings, not crates.
      if (rows > 1) {
        for (let row = 0; row < rows; row++) {
          if (accentCount >= MAX_CITY_ACCENTS) break;
          if (hashUnit3(this.seed, key, SALT_SHAPE + 11 + row) < 0.48) continue;
          const localZ = buildingDepth * 0.5 + 0.1;
          const balconyPoint = localPoint(point, 0, localZ, heading);
          this.cityAccentColour(key, depth);
          accentCount = this.addBox(
            accentCount,
            balconyPoint.x,
            y + 0.92 + row * (height / (rows + 0.45)),
            balconyPoint.z,
            width * 0.82,
            0.1,
            0.22,
            heading,
            this.colour,
            this.cityAccents,
          );
        }
      }

      if (roofCount < MAX_CITY_ROOFS && (tower || hashUnit3(this.seed, key, SALT_SHAPE + 12) > 0.63)) {
        const roofHeight = Math.max(1.2, Math.min(5, width * 0.24));
        this.cityRoofColour(key, depth);
        this.cityRoofs.setColorAt(roofCount, this.colour);
        this.setTransform(
          this.cityRoofs,
          roofCount++,
          point.x - this.anchorX,
          // Sunk, not seated. The cone's base cap and the block's top face are the same
          // plane otherwise, and two coplanar faces at a kilometre is a shimmering roof
          // — the one artefact in the city you can see from the road.
          y + totalHeight + roofHeight * 0.5 - ROOF_SINK_M,
          point.z - this.anchorZ,
          width * 0.86,
          roofHeight,
          buildingDepth * 0.86,
          heading,
        );
        if (tower && accentCount < MAX_CITY_ACCENTS) {
          this.colour.setHSL(0.08, 0.25, 0.63 + depth * 0.12);
          accentCount = this.addBox(
            accentCount,
            point.x - this.anchorX,
            y + totalHeight + roofHeight,
            point.z - this.anchorZ,
            0.18 * this.sizeScale,
            roofHeight * 1.8,
            0.18 * this.sizeScale,
            heading,
            this.colour,
            this.cityAccents,
          );
        }
      }
    }
    this.blocks.count = count;
    this.cityWindows.count = windowCount;
    this.cityAccents.count = accentCount;
    this.cityRoofs.count = roofCount;
    this.cityStreets.count = streetCount;
    for (const mesh of [this.blocks, this.cityWindows, this.cityAccents, this.cityRoofs, this.cityStreets]) {
      mesh.visible = true;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  /**
   * Sandstone under a desert noon, not albedo: these lightnesses are what the screen
   * receives (see `displayColour`), and the frame is tone mapped on the way out, so a
   * wall has to be authored near white to read as pale stone rather than as shadow.
   */
  private cityColour(key: number, depth: number, tier: number): void {
    const paint = pickPaint(CITY_WALL_PAINTS, hashUnit3(this.seed, key, SALT_COLOUR));
    const hue = paint.hue + (hashUnit3(this.seed, key, SALT_COLOUR + 1) - 0.5) * 0.018;
    const saturation =
      paint.saturation * (0.8 + hashUnit3(this.seed, key, SALT_COLOUR + 2) * 0.45);
    // `depth` lifts the far rows toward the haze, and a set-back upper storey is a
    // shade paler than the mass it stands on: sunlight on a setback, not a new colour.
    const lightness =
      paint.lightness +
      depth * 0.1 +
      tier * 0.035 +
      (hashUnit3(this.seed, key, SALT_COLOUR + 3) - 0.5) * 0.055;
    this.colour.setHSL(hue, Math.min(0.62, saturation), Math.min(0.93, lightness));
  }

  private cityRoofColour(key: number, depth: number): void {
    const paint = pickPaint(CITY_ROOF_PAINTS, hashUnit3(this.seed, key, SALT_COLOUR + 50));
    this.colour.setHSL(
      paint.hue + (hashUnit3(this.seed, key, SALT_COLOUR + 51) - 0.5) * 0.02,
      paint.saturation * (0.85 + hashUnit3(this.seed, key, SALT_COLOUR + 52) * 0.3),
      Math.min(0.9, paint.lightness + depth * 0.12),
    );
  }
  private cityWindowColour(key: number, depth: number, variant: number): void {
    const cool = hashUnit3(this.seed, key, SALT_COLOUR + 20 + variant) > 0.64;
    this.colour.setHSL(
      cool ? 0.56 : 0.11,
      cool ? 0.22 : 0.3,
      0.68 + depth * 0.16 + hashUnit3(this.seed, key, SALT_COLOUR + 30 + variant) * 0.12,
    );
  }

  private cityAccentColour(key: number, depth: number): void {
    this.colour.setHSL(
      0.07 + hashUnit3(this.seed, key, SALT_COLOUR + 40) * 0.04,
      0.2 + depth * 0.08,
      0.54 + depth * 0.14,
    );
  }

  /**
   * A drowned fleet the sea left behind, each hulk grounded at its own angle.
   *
   * A wreck is a card up to seventy metres long, so placing them by hash alone piled
   * them into each other: the field read as a scrapyard of intersecting planes. Each
   * candidate has to clear the hulls already down by the sum of their footprint radii,
   * and a slot that cannot find room after `SHIP_ATTEMPTS` tries is simply left
   * empty — the fleet thins out instead of overlapping.
   *
   * THE FOOTPRINT IS A SQUARE'S DIAGONAL, NOT A HALF-LENGTH. A wreck is two
   * perpendicular cards, so it reaches its full length along X AND along Z: a circle
   * sized to half the hull left the corners of one pair free to sit inside the other,
   * and the wrecks that crossed were the ones lying at right angles to each other.
   * The card runs -0.72 to 0.78 of its length, so the honest radius is 0.78 times the
   * root of two.
   */
  private buildShips(encounter: Encounter): void {
    // Half the fleet it was. The count was set against a 700 m encounter; over 1.5 km
    // the same hulls would read as a breaker's yard rather than as a stranded fleet,
    // and the clearance test would spend its attempts refusing them.
    const slots = Math.max(1, Math.round(55 * this.densityScale));
    let placed = 0;
    for (let i = 0; i < slots; i++) {
      const key = encounter.index * MAX_SHIPS + i;
      // A freighter is long, so the card is scaled well past its height; the list
      // ranges from a coaster to something that took a dock to build.
      const height = (6 + hashUnit3(this.seed, key, SALT_SHAPE) * 15) * this.sizeScale;
      const length = height * (2.2 + hashUnit3(this.seed, key, SALT_SHAPE + 1) * 1.3);
      const radius = length * this.shipReach;
      let x = 0;
      let z = 0;
      let hintS = 0;
      let depth = 0;
      let room = false;
      for (let attempt = 0; attempt < SHIP_ATTEMPTS && !room; attempt++) {
        const salt = SALT_PLACEMENT + attempt * 3;
        const along = hashUnit3(this.seed, key, salt);
        const s = encounter.startS + 20 + along * (encounter.length - 40);
        const side = hashUnit3(this.seed, key, salt + 1) < 0.5 ? -1 : 1;
        const candidateDepth = hashUnit3(this.seed, key, salt + 2);
        const lateral =
          side * (this.setbackM + SHIP_NEAR_M + candidateDepth * candidateDepth * SHIP_SPREAD_M);
        const point = this.road.offsetPoint(s, lateral);
        room = true;
        for (let other = 0; other < placed; other++) {
          const dx = point.x - this.shipX[other]!;
          const dz = point.z - this.shipZ[other]!;
          const clearance = radius + this.shipRadius[other]!;
          if (dx * dx + dz * dz < clearance * clearance) {
            room = false;
            break;
          }
        }
        if (!room) continue;
        x = point.x;
        z = point.z;
        hintS = s;
        depth = candidateDepth;
      }
      if (!room) continue;
      const yaw = hashUnit3(this.seed, key, SALT_SHAPE + 2) * Math.PI * 2;
      // A hull lies ALONG the dune it stranded on: the keel takes the ground's own
      // tilt, and the derelict lean is added to that rather than used instead of it.
      // The footprint the ground fit is taken over: half a LENGTH along the hull, but
      // half a BEAM across it. These were equal while a wreck was a square card, and
      // they are not any more — the hull is 0.14 of its length in beam, so fitting a
      // square sampled ground the ship does not stand on and tilted it for terrain it
      // never touches.
      const plane = fitGround(this.terrain, x, z, yaw, length * 0.5, length * 0.07, hintS, 2);
      const roll = plane.roll + (hashUnit3(this.seed, key, SALT_SHAPE + 3) - 0.5) * 0.5;
      this.setTransform(
        this.ships,
        placed,
        x - this.anchorX,
        plane.centreY - this.anchorY,
        z - this.anchorZ,
        length,
        height,
        length,
        yaw,
        roll,
        plane.pitch,
      );
      const lift =
        (0.86 + depth * 0.32) *
        (0.9 + hashUnit3(this.seed, key, SALT_COLOUR) * 0.2);
      this.colour.copy(SHIP_TINT).multiplyScalar(lift);
      this.ships.setColorAt(placed, this.colour);
      this.shipX[placed] = x;
      this.shipZ[placed] = z;
      this.shipRadius[placed] = radius;
      placed++;
      if (placed >= MAX_SHIPS) break;
    }
    this.ships.count = placed;
    this.ships.visible = true;
    this.ships.instanceMatrix.needsUpdate = true;
    if (this.ships.instanceColor) this.ships.instanceColor.needsUpdate = true;
  }

  private addBox(
    index: number,
    x: number,
    groundY: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    yaw: number,
    colour: THREE.Color,
    mesh: THREE.InstancedMesh = this.blocks,
  ): number {
    this.setTransform(mesh, index, x, groundY + height * 0.5, z, width, height, depth, yaw);
    mesh.setColorAt(index, colour);
    return index + 1;
  }

  /**
   * `YXZ`, so `roll` keeps the meaning it had when this took no pitch (with
   * `pitch = 0` the composition is the same `Ry·Rz`) and the pair now reads as the
   * ground's own tilt, exactly as `GroundPlane` reports it.
   */
  private setTransform(
    mesh: THREE.InstancedMesh,
    index: number,
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    yaw: number,
    roll = 0,
    pitch = 0,
  ): void {
    this.position.set(x, y, z);
    this.euler.set(pitch, yaw, roll, 'YXZ');
    this.quaternion.setFromEuler(this.euler);
    this.scale.set(width, height, depth);
    this.matrix.compose(this.position, this.quaternion, this.scale);
    mesh.setMatrixAt(index, this.matrix);
  }
}
