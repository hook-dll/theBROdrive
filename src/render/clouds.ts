import * as THREE from 'three';

/**
 * CUMULUS: clouds with a body, for the price of a few hundred quads.
 *
 * WHAT THEY WERE. Noise on a plane in the sky dome's shader: flat blotches with no
 * volume, lit by two samples, and — the dome being the backdrop — stars shone through
 * them. The owner: "coarse, unrealistic, not Shishkin".
 *
 * WHAT THEY ARE (docs/research-2026-09-26.md). Volumetric clouds raymarched ONCE, at
 * load, into an atlas, then drawn as cards lit by the live sun — the same trick as the
 * trees' impostors, and the cheap end of what Sea of Thieves and the volumetric
 * renderers do. The bake keeps, per texel:
 *   atlas A  rgb: light reaching the visible surface from up, +x and -x
 *            a:   coverage (1 - transmittance through the whole cloud)
 *   atlas B  rg: light from +z and -z
 *            b:  height inside the cloud (0 at its flat base, 1 at its top)
 *            a:  how much cloud the ray crossed (thin edges transmit the sun)
 * At draw time a card is lit from those: the sunward side warm, the shade cool and
 * blue-grey, the base darker, a silver lining where the sun is behind a thin edge
 * (Shishkin's "Rye", "Midday"). Near the horizon clouds sink into the haze as the land
 * does.
 *
 * FIVE FAMILIES (the third pass). One template is one cloud, and after the second pass
 * every shape in the sky was the same foot-body-turrets heap at another size: "dumb in
 * shape and very monotonous", and rightly. The atlas now holds five *species* — a flat
 * humilis dome, a group of mediocris heads, a congestus tower, fractus shreds and a
 * stratocumulus sheet — six variants each, each with its own erosion profile. The
 * families are one table, read by the bake (which builds the shape) and by the draw
 * (which stretches the cell to the family's aspect), so the atlas stores a silhouette
 * that fills its cell and the table says how tall, how deep and how big it is drawn.
 * Two views, one bake: every family is baked twice, side and from below.
 *
 * EROSION, NOT NOISE. The second pass added fbm value noise to the surface, which is
 * why the outlines were smooth domes with loose specks around them: value noise only
 * ever makes hills, and adding it can lift a stray lobe over the visibility threshold.
 * A cumulus crown is a stack of lobes with sharp creases between them, so the detail is
 * two octaves of inverted Worley — 1 at a feature point, 0 in the creases — SUBTRACTED
 * from the coverage. Subtracting cannot invent mass, and the reduction of the shape to
 * this one rule (each family fills its box, each puff no further from its neighbour than
 * the radius it shows) is what makes the shapes read as clouds.
 *
 * TWO VIEWS. A card that only turns about the vertical is seen edge-on from under the
 * cloud: overhead, a cloud was a smeared streak. So every shape is baked twice — from
 * the side (atlas rows 0..4) and from below (rows 5..9: the footprint the flat base was
 * cut from) — and each cloud is two quads, an upright one facing the camera and a flat
 * one at its base, cross-faded by how high the cloud stands in the view (`VIEW_FADE_*`).
 * The impostors' view blend, with two views.
 *
 * THE FIELD (`placeClouds`). `COUNT` clouds over a square of `FIELD_M` that wraps round
 * the camera, so there are always clouds and they keep their world places: driving under
 * them, they pass overhead with real parallax; the wind moves the whole field. They are
 * placed in clusters on a lattice that runs along the wind, so clumps line up in streets;
 * every cluster stands on its region's own condensation level, so a region's clouds share
 * one flat base; and every cloud takes its family from its region, so the sky has fair
 * stretches of shreds and domes and convective ones of heads and towers. The cover
 * decides how many show, and the families are dealt cover bands in order, so a closing
 * sky brings out the towers. Cards are sorted far to near every so often, into the draw
 * buffer that is not being drawn (see `sort`).
 *
 * THE SKY BEHIND. Drawn after the stars, blended over them: a cloud hides the stars.
 */

/** Cloud families, one atlas row each: the side view in rows 0..4, below in 5..9. */
const FAMILIES = 5;
const VIEW_ROWS = FAMILIES;
const ATLAS_ROWS = VIEW_ROWS * 2;

/**
 * The five families, as a table the bake and the draw both read.
 *
 * A cell is one shape in "shape space": x in [-1, 1], y in [0, 2 * aspect], z in
 * [-depth, depth], every length in it the same physical length — a puff is as round as
 * it is built. The cell holds the shape's whole bounding box, so the draw stretches the
 * cell's y axis to `aspect * width` and its z axis to `depth * width`, and the cloud on
 * screen is the baked one up to a uniform scale in each axis. That is what makes five
 * families out of one bake: the atlas stores the silhouette, the table decides how tall,
 * how deep and how heavy it is drawn.
 *
 * `aspect` drawn height over width (a cumulus humilis is a third as tall as it is wide,
 * a congestus half again as tall, a stratocumulus sheet a tenth); `depth` the
 * footprint's half depth in halves of the width; `size` the width scale against the
 * field's own widths, so a family arrives at its own size; `flatten` how far the puffs
 * are squashed vertically, which is what makes a flat dome out of round lumps and a
 * sheet out of nearly flat ones; `billow`/`wispy` how hard the lobes' creases and the
 * torn under-edge are eroded out of the mass; `density` the mass (fractus is thin,
 * translucent shreds); `base` how hard the condensation level cuts the bottom flat
 * (fractus has no flat base at all).
 *
 * The families, after the WMO species (docs/research-2026-09-26.md):
 *   humilis        broad flat domes, one head, wider than tall
 *   mediocris      three or four cauliflower heads on a common base, as tall as wide
 *   congestus      a wide base under a tower of tiers, tattered crown
 *   fractus        torn shreds, thin, no base at all
 *   stratocumulus  a clumped sheet of rolled clouds
 */
interface CloudFamily {
  readonly name: string;
  readonly aspect: number;
  readonly depth: number;
  readonly size: number;
  readonly flatten: number;
  readonly billow: number;
  readonly wispy: number;
  readonly density: number;
  readonly base: number;
}
const FAMILY_TABLE: readonly CloudFamily[] = [
  { name: 'humilis', aspect: 0.3, depth: 0.75, size: 1.0, flatten: 1.3, billow: 0.3, wispy: 0.2, density: 1.0, base: 1.0 },
  { name: 'mediocris', aspect: 0.85, depth: 0.85, size: 1.05, flatten: 1.05, billow: 0.34, wispy: 0.22, density: 1.0, base: 1.0 },
  { name: 'congestus', aspect: 1.15, depth: 0.9, size: 1.15, flatten: 0.6, billow: 0.36, wispy: 0.24, density: 1.05, base: 1.0 },
  { name: 'fractus', aspect: 0.4, depth: 0.6, size: 0.6, flatten: 1.1, billow: 0.3, wispy: 0.26, density: 0.85, base: 0.35 },
  { name: 'stratocumulus', aspect: 0.12, depth: 1.0, size: 1.05, flatten: 2.0, billow: 0.22, wispy: 0.18, density: 0.95, base: 0.85 },
];
/**
 * Variants per family: 25 shapes in the atlas, and every cloud draws one of them
 * mirrored or not, at its own size and its own aspect within the family's. The atlas is
 * 1600x2560, 16 MB a texture at load — the knob to turn if memory ever matters more
 * than variety.
 */
const VARIANT_COUNT = 5;
/** Atlas columns: one per variant. */
const ATLAS_COLS = VARIANT_COUNT;
const HUMILIS = 0;
const MEDIOCRIS = 1;
const CONGESTUS = 2;
const FRACTUS = 3;
const STRATOCUMULUS = 4;

/**
 * The family table as GLSL, two vec4s a family: A is aspect, depth, billow erosion and
 * wispy erosion, B is density, base hardness and puff flatten. One source of truth: the
 * bake builds the shape from the same numbers the draw reads. Uniforms rather than a
 * const array because the row is only known at run time and dynamic indexing of a const
 * array is not something to lean on.
 */
const FAMILY_GLSL = /* glsl */ `
uniform vec4 uFamA[${FAMILIES}];
uniform vec4 uFamB[${FAMILIES}];
`;
/** The family table as the uniform values the bake uploads. */
const FAMILY_UNIFORMS = {
  uFamA: { value: FAMILY_TABLE.map((f) => new THREE.Vector4(f.aspect, f.depth, f.billow, f.wispy)) },
  uFamB: { value: FAMILY_TABLE.map((f) => new THREE.Vector4(f.density, f.base, f.flatten, 0)) },
};

/**
 * Sine of the cloud's elevation over which the side view hands over to the view from
 * below: ~20 to ~44 degrees. A big cloud a kilometre or two off spans tens of degrees,
 * so its upright card already reads as a streak toward its near edge at 30; the first
 * try, 30..53, left exactly that streak in the sky.
 */
const VIEW_FADE_LOW = 0.35;
const VIEW_FADE_HIGH = 0.7;
/** Cell pixels. 2:1 was a side-view cell's proportion; the below view wants square. */
const CELL_W = 320;
const CELL_H = 256;
/** Clouds in the field, the field's side, and how high they float over the camera. */
const COUNT = 220;
const FIELD_M = 36000;
const ALTITUDE_M = 1600;
/**
 * How far the condensation level wanders over the field, metres, and how much of it
 * a single cloud keeps to itself. A region's clouds all stand on one base plane.
 */
const BASE_WANDER_M = 320;
const BASE_JITTER_M = 26;
/** Card width range, metres, before the family's own size scale. */
const WIDTH_MIN_M = 900;
const WIDTH_MAX_M = 2300;
/** Metres of camera travel between re-sorts. */
const RESORT_M = 400;

/**
 * The bake: one full-screen pass over the whole atlas, each texel marching its cell's
 * cloud along the view axis. CELL SPACE: x in [-1, 1], y in [0, 1] (the condensation
 * level at 0, the crown at 1), z in [-depth, depth]. A family's builder fills that box
 * — puffs round, laid out in the family's own real proportions — so a cell holds one
 * shape's whole bounding box and the draw stretches it back to the size the table says.
 *
 * FIVE FAMILIES (see FAMILY_TABLE). One template could only ever be one cloud: the
 * second pass gave every shape a foot, a body and three turrets and the middle belt's
 * sky has five different clouds in it. Each builder below is a different *arrangement*
 * — a dome, a group of heads, a tower, a shred, a sheet — not the same heap at another
 * scale, and the erosion profile differs with it (a congestus boils at the crown, a
 * fractus is frayed all through).
 *
 * EROSION, NOT NOISE. The heap of puffs is the coverage; the detail is subtracted from
 * it. The old bake *added* fbm value noise to the surface, which is why the outlines
 * were smooth and why stray puffs left beads floating beside the cloud (noise alone
 * lifted them over the threshold). A cumulus has creases, not hills: two octaves of
 * inverted Worley — 1 at a feature point, 0 in the creases between them — erode the
 * mass, the coarse one (its grid broken up by a domain warp) biting bays out of the
 * silhouette and the fine one fraying it. The coarse erosion is strongest at the crown
 * (billowy heads), the fine one at the under-edge (torn, wispy bottom).
 */
const BAKE_FRAGMENT = /* glsl */ `
precision highp float;
in vec2 vUv;
layout(location = 0) out highp vec4 outA;
layout(location = 1) out highp vec4 outB;
${FAMILY_GLSL}
float h31( vec3 p ) {
  p = fract( p * vec3( 0.1031, 0.1030, 0.0973 ) );
  p += dot( p, p.yzx + 33.33 );
  return fract( ( p.x + p.y ) * p.z );
}
float h11( float n ) { return fract( sin( n * 91.3458 ) * 47453.5453 ); }
float vnoise( vec3 p ) {
  vec3 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  float a = h31( i ), b = h31( i + vec3( 1, 0, 0 ) ), c = h31( i + vec3( 0, 1, 0 ) ), d = h31( i + vec3( 1, 1, 0 ) );
  float e = h31( i + vec3( 0, 0, 1 ) ), g = h31( i + vec3( 1, 0, 1 ) ), k = h31( i + vec3( 0, 1, 1 ) ), l = h31( i + vec3( 1, 1, 1 ) );
  return mix( mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y ), mix( mix( e, g, f.x ), mix( k, l, f.x ), f.y ), f.z );
}
/**
 * Inverted Worley over the eight cells round the corner: 1 at the nearest feature
 * point, 0 in the creases. The creases are the whole point — value noise only ever
 * makes smooth hills, and a cumulus crown is a stack of lobes with sharp valleys
 * between them.
 */
float worley( vec3 p ) {
  vec3 i = floor( p ), f = p - i;
  // The full 3x3x3 neighbourhood. Searching only the eight cells at the floor corner —
  // the usual cheap shortcut — misses feature points in the cells BELOW the sample, and
  // the field then creases along every integer boundary: a lattice of squares, plainly
  // visible once a cell is magnified a few times on a 4K screen. Twenty-seven cells it
  // is.
  float best = 8.0;
  for ( int k = 0; k < 27; k++ ) {
    vec3 o = vec3( float( k % 3 - 1 ), float( ( k / 3 ) % 3 - 1 ), float( ( k / 9 ) % 3 - 1 ) );
    vec3 r = o - f + vec3( h31( i + o ), h31( i + o + 31.0 ), h31( i + o + 71.0 ) );
    best = min( best, dot( r, r ) );
  }
  return clamp( 1.0 - sqrt( best ), 0.0, 1.0 );
}
float shapeSeed;
int shapeFam;
float shapeH;
float shapeDepth;
float shapeFlatten;
const int PUFFS = 44;
vec4 puffs[ PUFFS ];
int puffCount;
void put( float x, float y, float z, float r ) {
  if ( puffCount >= PUFFS ) return;
  puffs[ puffCount ] = vec4( x, y, z, r );
  puffCount++;
}
/**
 * A row of count puffs across the shape, from -spread to +spread in x, all at height
 * y (a little scattered) with radius r (a little varied), spread over z of the cell's
 * depth about zOff. Every family below is a handful of these: the numbers are the
 * shape.
 *
 * THE ONE RULE. A puff shows a radius of ~0.59 of the one it is given, so no neighbour
 * is placed further away than that and no row is either. Looser than that and the shape
 * is a bunch of blobs with sky between them — a fractus became a row of beads and a
 * congestus a pile of grapes before this rule was tightened. Rows here are step ~0.2
 * for a 0.3 puff, i.e. about two thirds of a visible radius, so the mass is one mass
 * with an outline that steps in, and the lobes come from the erosion.
 */
void row( float count, float spread, float y, float r, float z, float zOff, float seed ) {
  for ( int n = 0; n < 10; n++ ) {
    if ( float( n ) >= count ) break;
    float i = float( n );
    float a = h11( seed + i * 1.7 );
    float b = h11( seed + i * 3.9 + 11.0 );
    float c = h11( seed + i * 5.3 + 23.0 );
    float cx = count > 1.5 ? i / ( count - 1.0 ) * 2.0 - 1.0 : 0.0;
    put( cx * spread + ( a - 0.5 ) * 0.11, y * ( 0.95 + 0.1 * c ), zOff + ( b - 0.5 ) * z, r * ( 0.9 + 0.2 * a ) );
  }
}
/**
 * The five builders. Shape space is isotropic and the family's real proportions: x in
 * [-1, 1], y in [0, 2 * aspect], z in [-depth, depth], and the cell holds all of it.
 * Each family fills that box with its own arrangement of puffs — a dome, a group of
 * heads, a tower, a strand, a sheet — so a cell holds a whole different cloud and not
 * the same heap at another size. The rows stop just short of the box's top; the
 * erosion takes the last of it off, so a family is drawn at its own aspect.
 */
void buildPuffs() {
  float H = shapeH;
  float D = shapeDepth;
  float s = shapeSeed;
  int f = shapeFam;
  float i, j, t;
  puffCount = 0;
  if ( f == ${HUMILIS} ) {
    // A wide flat dome, five rows of shrinking puffs, the lowest carrying the outline out
    // to the cell's sides and every next row narrower. Wider than tall and worn flat on
    // top — a humilis has no tower in it, only a low crown of lobes.
    row( 9.0, 0.80, H * 0.06, 0.34, 1.5 * D, 0.0, s * 3.1 );
    row( 7.0, 0.64, H * 0.32, 0.34, 1.3 * D, 0.0, s * 7.7 );
    row( 5.0, 0.46, H * 0.58, 0.33, 1.0 * D, 0.0, s * 11.3 );
    row( 3.0, 0.28, H * 0.82, 0.32, 0.7 * D, 0.0, s * 17.9 );
  } else if ( f == ${MEDIOCRIS} ) {
    // Three or four cauliflower heads on one base: the rows step in as they climb, so the
    // outline is a group of lobes and not one smooth heap, and they overlap hard enough
    // that the body is one mass — the heads come from the stepping and the erosion, not
    // from spheres standing apart.
    row( 9.0, 0.80, H * 0.05, 0.36, 1.5 * D, 0.0, s * 3.7 );
    row( 7.0, 0.66, H * 0.25, 0.36, 1.3 * D, 0.0, s * 9.1 );
    row( 5.0, 0.50, H * 0.45, 0.35, 1.1 * D, 0.0, s * 13.7 );
    row( 4.0, 0.36, H * 0.65, 0.34, 0.9 * D, 0.0, s * 19.3 );
    row( 2.0, 0.20, H * 0.84, 0.33, 0.6 * D, 0.0, s * 23.9 );
  } else if ( f == ${CONGESTUS} ) {
    // A wide base under a tower. Twelve tiers of two heads climb 0.075 of the cloud's
    // height apart — under half the height of a head, so each tier is buried in the one
    // below and the tower is one mass that leans and boils; the heads are stretched
    // vertically (flatten 0.6), which is what lets twelve tiers cover a tower of 2.5
    // widths. A small tattered row closes the crown. The cauliflower is the erosion's.
    row( 9.0, 0.80, H * 0.03, 0.32, 1.5 * D, 0.0, s * 3.3 );
    for ( int n = 0; n < 9; n++ ) {
      i = float( n );
      t = i / 8.0;
      j = h11( s * 15.1 + i );
      float y = H * ( 0.06 + 0.1 * i );
      float cx = ( h11( s * 11.7 + i ) - 0.5 ) * 0.22 * ( 1.0 - 0.6 * t );
      float r = 0.5 - 0.02 * i;
      // Three heads a tier, half a radius apart, so a tier is one wide lobed head and the
      // tower it builds is nearly as wide as the cloud's base — a column of spheres is
      // what a reader calls "a pillar", wide boiling heads are a congestus.
      put( cx - r * 0.45, y, ( h11( s * 21.3 + i ) - 0.5 ) * 0.9 * D, r );
      put( cx, y + H * 0.012, ( h11( s * 26.9 + i ) - 0.5 ) * 0.9 * D, r * ( 0.94 + 0.06 * j ) );
      put( cx + r * 0.45, y + H * 0.004, ( h11( s * 31.7 + i ) - 0.5 ) * 0.9 * D, r * ( 0.92 + 0.08 * j ) );
    }
    row( 3.0, 0.42, H * 0.95, 0.3, 0.6 * D, 0.0, s * 41.3 );
  } else if ( f == ${FRACTUS} ) {
    // Torn shreds: no flat base and no tower, only a strand of puffs, thin enough for the
    // sky to show through. Ragged is the edge, not the middle: every puff lies well
    // inside its neighbour's visible radius, and the row spread is small enough that the
    // strand is one wisp rather than a row of beads.
    row( 8.0, 0.80, H * 0.24, 0.34, 1.2 * D, 0.0, s * 3.9 );
    row( 6.0, 0.62, H * 0.52, 0.32, 0.9 * D, 0.05 * D, s * 9.7 );
    row( 3.0, 0.36, H * 0.78, 0.30, 0.6 * D, -0.1 * D, s * 13.3 );
  } else {
    // Stratocumulus: a sheet, not a heap. Four rows of clumps down the cell's depth, the
    // puffs flattened harder than any other family's, each clump two overlapping puffs so
    // the rolls are rolls and not a dotted line. From below it is the same rolls over one
    // flat base.
    row( 7.0, 0.88, H * 0.30, 0.30, 0.7 * D, 0.0, s * 4.3 );
    row( 6.0, 0.80, H * 0.62, 0.26, 0.55 * D, 0.5 * D, s * 11.9 );
    row( 7.0, 0.88, H * 0.12, 0.29, 0.6 * D, -0.55 * D, s * 17.3 );
    row( 5.0, 0.74, H * 0.86, 0.22, 0.4 * D, 0.45 * D, s * 23.9 );
  }
}
/**
 * The mass, 0..1, in cell space: the puffs' sum against the threshold, the two Worley
 * erosions subtracted from the coverage, then the flat base. Subtracting can never
 * invent mass, which is what keeps the loose specks out of the sky.
 */
float density( vec3 p, bool fine ) {
  float sum = 0.0;
  for ( int i = 0; i < PUFFS; i++ ) {
    // Only the puffs this shape's builder actually wrote: the array is not cleared, and
    // a stale slot read as a puff scatters loose blobs through the sky.
    if ( i >= puffCount ) break;
    vec4 q = puffs[ i ];
    // A puff's visible radius is ~0.59 of its own. The family's flatten squashes them
    // vertically: a flat dome is made of flatter lumps, a sheet of much flatter ones,
    // and the row under the flat base is flatter still.
    float squash = q.y < 0.12 * shapeH ? shapeFlatten * 1.3 : shapeFlatten;
    vec3 d = vec3( p.x - q.x, ( p.y * shapeH - q.y ) * squash, p.z - q.z );
    sum += exp( -3.0 * dot( d, d ) / ( q.w * q.w ) );
  }
  float cov = clamp( ( sum - 0.35 ) * 2.2, 0.0, 1.0 );
  if ( cov <= 0.0 ) return 0.0;
  vec4 A = uFamA[ shapeFam ];
  vec4 B = uFamB[ shapeFam ];
  vec3 s = vec3( p.x, p.y * shapeH, p.z );
  float up = clamp( p.y, 0.0, 1.0 );
  // The detail is SUBTRACTED from the coverage, and its troughs are what bite: where
  // the field is low — the creases between lobes, not the lobes — the mass is eaten
  // away, and the level surface is displaced into lobes by it. Subtracting can never
  // invent mass, so no specks float beside the cloud. The warp under the coarse field
  // is what stops the lobes from falling on Worley's own grid.
  float warp = ( vnoise( s * 0.9 + shapeSeed * 3.0 ) - 0.5 ) * 0.7;
  float billow = worley( s * 3.2 + warp );
  // One amount of erosion, and it is capped. A carve deeper than the coverage the puffs
  // leave in the cols between them cuts the shape into beads: the mound keeps its mass,
  // the necks do not. With the cap nothing can ever be cut through.
  float carve = A.z * smoothstep( 0.05, 0.6, up ) * ( 1.0 - billow );
  if ( fine ) {
    // Finer lobes, crown only, and only here: lightT marches with fine false, so this
    // field shapes the outline without banding the shading — a tower's creases darken
    // the light, they do not open the silhouette.
    float lobe = worley( s * 6.6 + shapeSeed * 2.3 + warp * 0.6 );
    carve += A.z * 0.5 * smoothstep( 0.4, 0.9, up ) * ( 1.0 - lobe );
    float fray = worley( s * 8.6 + shapeSeed * 1.7 );
    carve += A.w * ( 1.0 - 0.7 * up ) * ( 1.0 - fray );
  }
  float d = cov - min( carve, 0.42 );
  d = clamp( d, 0.0, 1.0 ) * B.x;
  // The condensation level: a flat base, cut sharp for the families that have one and
  // left ragged for fractus.
  float cut = smoothstep( 0.0, 0.05, p.y + ( vnoise( s * 9.0 ) - 0.5 ) * 0.08 );
  return d * mix( 1.0, cut, B.y );
}
/**
 * Transmittance from p toward l: steps through the cloud, stopped where the box is
 * behind us. Beer's law with a powder term: deep inside is dark, and the very edge
 * less dark than a plain exponential would have it.
 */
float lightT( vec3 p, vec3 l ) {
  float od = 0.0;
  for ( int i = 1; i <= 8; i++ ) {
    vec3 q = p + l * ( float( i ) * 0.11 );
    if ( q.y > 1.06 || q.y < -0.06 || abs( q.x ) > 1.06 || abs( q.z ) > shapeDepth + 0.06 ) break;
    od += density( q, false );
  }
  return exp( -od * 0.11 * 7.0 );
}
/** The box every builder fills, plus the noise's own reach: the ray's span inside it. */
bool slab( vec3 ro, vec3 rd, out float t0, out float t1 ) {
  vec3 lo = vec3( -1.0, -0.03, -shapeDepth - 0.02 );
  vec3 hi = vec3( 1.0, 1.03, shapeDepth + 0.02 );
  vec3 a = ( lo - ro ) / rd, b = ( hi - ro ) / rd;
  vec3 mn = min( a, b ), mx = max( a, b );
  t0 = max( max( mn.x, mn.y ), max( mn.z, 0.0 ) );
  t1 = min( min( mx.x, mx.y ), mx.z );
  return t1 > t0;
}
void main() {
  vec2 cellF = vUv * vec2( ${ATLAS_COLS}.0, ${ATLAS_ROWS}.0 );
  vec2 cell = floor( cellF );
  vec2 inCell = fract( cellF );
  bool below = cell.y >= ${VIEW_ROWS}.0;
  float row = mod( cell.y, ${VIEW_ROWS}.0 );
  shapeFam = int( row + 0.5 );
  shapeSeed = row * ${ATLAS_COLS}.0 + cell.x + 1.0;
  shapeH = 2.0 * uFamA[ shapeFam ].x;
  shapeDepth = uFamA[ shapeFam ].y;
  shapeFlatten = uFamB[ shapeFam ].z;
  buildPuffs();
  vec3 ro, rd;
  if ( below ) {
    // From under the base, straight up: the cell's v runs across z, so the flat quad
    // the draw lays under the cloud reads the footprint it was cut from.
    ro = vec3( inCell.x * 2.0 - 1.0, -0.02, ( inCell.y * 2.0 - 1.0 ) * shapeDepth );
    rd = vec3( 0.0, 1.0, 0.0 );
  } else {
    ro = vec3( inCell.x * 2.0 - 1.0, inCell.y, shapeDepth + 0.15 );
    rd = vec3( 0.0, 0.0, -1.0 );
  }
  outA = vec4( 0.0 );
  outB = vec4( 0.0 );
  float t0, t1;
  if ( !slab( ro, rd, t0, t1 ) ) return;
  const int STEPS = 30;
  float dt = ( t1 - t0 ) / float( STEPS );
  float T = 1.0;
  float depth = 0.0;
  vec4 lA = vec4( 0.0 ); // up, +x, -x
  vec2 lB = vec2( 0.0 ); // +z (toward the viewer), -z
  float hgt = 0.0;
  float W = 0.0;
  for ( int i = 0; i < STEPS; i++ ) {
    if ( T < 0.02 ) break;
    vec3 p = ro + rd * ( t0 + dt * ( float( i ) + 0.5 ) );
    float d = density( p, true );
    if ( d < 0.005 ) continue;
    float a = 1.0 - exp( -d * dt * 11.0 );
    float seen = T * a;
    lA.x += seen * lightT( p, vec3( 0.0, 1.0, 0.0 ) );
    lA.y += seen * lightT( p, vec3( 1.0, 0.0, 0.0 ) );
    lA.z += seen * lightT( p, vec3( -1.0, 0.0, 0.0 ) );
    lB.x += seen * lightT( p, vec3( 0.0, 0.0, 1.0 ) );
    lB.y += seen * lightT( p, vec3( 0.0, 0.0, -1.0 ) );
    hgt += seen * p.y;
    W += seen;
    depth += d * dt;
    T *= 1.0 - a;
  }
  float alpha = 1.0 - T;
  float inv = 1.0 / max( W, 1e-4 );
  // DITHER. The atlas is eight bits a channel, and these four fields are smooth: written
  // straight they become a staircase of flat plateaus a few thousandths apart, and a card
  // magnified three to six times on a 4K screen shows that staircase as a grid of squares
  // lying over the cloud. Half a step of dither, hashed from the texel, scatters each
  // plateau into fine grain instead; the card's own bilinear filter averages neighbouring
  // texels back to the value that was meant. This is the whole reason the 8-bit target is
  // allowed here at all.
  float dn = 1.0 / 255.0;
  vec4 dither = vec4(
    h31( vec3( gl_FragCoord.xy, 1.0 ) ) - 0.5,
    h31( vec3( gl_FragCoord.xy, 2.0 ) ) - 0.5,
    h31( vec3( gl_FragCoord.xy, 3.0 ) ) - 0.5,
    h31( vec3( gl_FragCoord.xy, 4.0 ) ) - 0.5
  ) * dn;
  outA = vec4( lA.x * inv, lA.y * inv, lA.z * inv, alpha ) + dither;
  outB = vec4( lB.x * inv, lB.y * inv, clamp( hgt * inv, 0.0, 1.0 ), clamp( depth * 1.8, 0.0, 1.0 ) );
  outB.rg += dither.xy;
  outB.ba += dither.zw;
}
`

const BAKE_VERTEX = /* glsl */ `
in vec3 position;
in vec2 uv;
out vec2 vUv;
void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }
`;

/**
 * The draw: two quads per cloud, instanced. `aCloud` places it in the field, `aShape`
 * picks its cell, `aLook` is what the family table says about it — the aspect the cell
 * is stretched to, the footprint's depth and which side the shape was mirrored on.
 */
const DRAW_VERTEX = /* glsl */ `
attribute vec4 aCloud; // x, z in the field, altitude, width
attribute vec2 aShape; // atlas column (the variant), own random
attribute vec4 aLook; // drawn aspect, footprint depth, mirror, atlas row (the family)
attribute float aView; // 0: the upright side card, 1: the flat card under the base
uniform vec2 uCamAbs;
uniform vec2 uWind;
uniform float uCover;
uniform float uOvercast;
varying vec2 vUv;
varying vec3 vRight;
varying vec3 vFwd;
varying float vElev;
varying float vShow;
varying vec3 vDir;
void main() {
  float F = ${FIELD_M.toFixed(1)};
  vec2 at = aCloud.xy + uWind;
  vec2 rel = mod( at - uCamAbs + F * 0.5, F ) - F * 0.5;
  // Fewer as the cover falls: each cloud has its own threshold, and the families are
  // dealt thresholds in order, so a low cover leaves the humilis and the fractus and
  // the congestus waits for the sky to build (see the placement in the constructor).
  vShow = smoothstep( aShape.y, aShape.y + 0.08, uCover ) * ( 1.0 - smoothstep( F * 0.4, F * 0.5, length( rel ) ) );
  // Rain cloud: as the sky closes in, the heaps swell and sink (a nimbostratus base
  // sits at half fair-weather cumulus height) until the cards overlap into one deck
  // with a lumpy underside, instead of fair-weather puffs pasted on a grey dome.
  vec3 centre = vec3( rel.x, aCloud.z * ( 1.0 - 0.45 * uOvercast ), rel.y );
  float w = aCloud.w * ( 0.35 + 0.65 * vShow ) * ( 1.0 + 0.8 * uOvercast );
  float mir = aLook.z;
  vec3 p;
  if ( aView < 0.5 ) {
    // Upright, turned to face the camera about the vertical. The cell holds the shape's
    // bounding box, so its height here is the family's aspect times the width — a
    // humilis a third as tall as it is wide, a congestus half again as tall. Mirrored
    // where this cloud took the coin's other side; the cell is read mirrored with the
    // geometry, so the baked light stays on the side the sun really is on.
    vec3 fwd = normalize( vec3( -rel.x, 0.0, -rel.y ) + vec3( 1e-4, 0.0, 0.0 ) );
    vRight = vec3( fwd.z, 0.0, -fwd.x );
    vFwd = fwd;
    p = centre + vRight * position.x * mir * w + vec3( 0.0, ( position.y + 0.5 ) * w * aLook.x, 0.0 );
  } else {
    // Flat at the base, on the cloud's own heading (fixed in the world, so it does not
    // spin as the camera passes beneath). As deep as the family's footprint, as baked.
    float a = aShape.y * 6.2831853;
    vFwd = vec3( -sin( a ), 0.0, cos( a ) );
    vRight = vec3( vFwd.z, 0.0, -vFwd.x );
    p = centre + vRight * position.x * w + vFwd * position.y * w * aLook.y;
  }
  // The hand-over between the views, by the cloud's elevation in the view.
  float up = smoothstep( ${VIEW_FADE_LOW}, ${VIEW_FADE_HIGH}, centre.y / length( centre ) );
  vShow *= aView < 0.5 ? 1.0 - up : up;
  vDir = p;
  vElev = normalize( p ).y;
  vUv = ( vec2( aShape.x, aLook.w + aView * ${VIEW_ROWS}.0 ) + vec2( position.x * ( aView < 0.5 ? mir : 1.0 ) + 0.5, position.y + 0.5 ) ) / vec2( ${ATLAS_COLS}.0, ${ATLAS_ROWS}.0 );
  // The camera's own position: the field is built round it, in camera-relative metres.
  gl_Position = projectionMatrix * viewMatrix * vec4( cameraPosition + p, 1.0 );
  // On the far plane (in front of the sky dome): behind everything real.
  gl_Position.z = gl_Position.w * 0.99999;
  if ( vShow <= 0.001 ) gl_Position = vec4( 0.0, 0.0, -2.0, 1.0 );
}
`;

const DRAW_FRAGMENT = /* glsl */ `
uniform sampler2D uAtlasA;
uniform sampler2D uAtlasB;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform float uLight;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform float uAmount;
uniform float uGrey;
uniform float uRain;
uniform float uDusk;
varying vec2 vUv;
varying vec3 vRight;
varying vec3 vFwd;
varying float vElev;
varying vec3 vDir;
varying float vShow;
void main() {
  vec4 a = texture2D( uAtlasA, vUv );
  vec4 b = texture2D( uAtlasB, vUv );
  float alpha = a.a * vShow * uAmount;
  if ( alpha < 0.004 ) discard;
  // The sun in the card's own frame (x right, y up, z toward the viewer), and the
  // light baked from the five sides it could come from, blended by it.
  vec3 L = normalize( uLightDir );
  vec3 l = vec3( dot( L, vRight ), L.y, dot( L, vFwd ) );
  vec3 wp = max( l, 0.0 );
  vec3 wn = max( -l, 0.0 );
  vec4 w = vec4( wp.y, wp.x, wn.x, wp.z );
  w *= w;
  float wBack = wn.z * wn.z;
  float lit = ( a.r * w.x + a.g * w.y + a.b * w.z + b.r * w.w + b.g * wBack ) / max( w.x + w.y + w.z + w.w + wBack, 1e-4 );
  float height = b.b;
  float thick = b.a;
  // Silver lining: the sun behind a thin edge, seen through it. The real view ray, so
  // it holds for the flat card under the cloud as for the upright one.
  float rim = pow( max( dot( normalize( vDir ), L ), 0.0 ), 5.0 ) * ( 1.0 - thick ) * 0.9;
  // Shade is the sky's cool blue-grey, deeper under the cloud; light the sun's warm
  // white (Shishkin's clouds: warm where lit, cold in their own shadow).
  // Part of the shade is the sky round the cloud, lower down the horizon's. At dusk the
  // horizon's glow takes a larger part: the zenith has gone deep blue by then, and a
  // cloud shaded from it alone reads as an ink blot against a pink sky. Only a larger
  // part — shaded wholly from the horizon, a cloud is the sky's own colour and flat.
  float horizonShare = mix( 0.3 + 0.25 * ( 1.0 - height ), 0.45 + 0.3 * ( 1.0 - height ), uDusk );
  vec3 shade = mix( mix( uZenith, vec3( 0.5, 0.54, 0.63 ), 0.5 ), uHorizon, horizonShare ) * mix( 0.55, 0.95, height );
  vec3 col = shade * 0.9 + uLightColor * uLight * ( lit * lit * 1.1 + rim );
  // The low sun under the cloud's level lights its base from beneath: the flat bottom
  // goes rose and gold, brightest where the cloud is thin enough to glow through,
  // while the body above keeps its own light and shade. Only the bottom band — the
  // clouds are mostly low heaps (height under 0.5), so a slow falloff tints them all.
  float under = uDusk * ( 1.0 - smoothstep( 0.12, 0.38, height ) ) * ( 0.55 + 0.45 * ( 1.0 - thick ) );
  col += mix( uHorizon, uLightColor, 0.6 ) * under * 0.9;
  // Overcast: the clouds go grey, and in rain dark — darker than the sky between
  // them, darkest at the base, keeping some of their own light and shade so the deck
  // still has a body. The old grey was a flat tone LIGHTER than the overcast dome:
  // pale cut-outs where there should be storm cloud.
  vec3 storm = mix( uHorizon, uZenith, 0.4 ) * mix( 0.5, 1.0, height ) * ( 0.75 + 0.35 * lit ) * ( 1.0 - 0.5 * uRain );
  col = mix( col, storm, uGrey );
  // Low clouds sink into the horizon's haze, as the land does.
  col = mix( uHorizon, col, 0.25 + 0.75 * smoothstep( 0.0, 0.22, vElev ) );
  gl_FragColor = vec4( col, alpha );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** The atlas pair, baked once, both in one pass (two render targets). */
function bake(renderer: THREE.WebGLRenderer): [THREE.Texture, THREE.Texture] {
  const target = new THREE.WebGLRenderTarget(CELL_W * ATLAS_COLS, CELL_H * ATLAS_ROWS, {
    count: 2,
    type: THREE.UnsignedByteType,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
  });
  const material = new THREE.RawShaderMaterial({
    vertexShader: BAKE_VERTEX,
    fragmentShader: BAKE_FRAGMENT,
    uniforms: FAMILY_UNIFORMS,
    glslVersion: THREE.GLSL3,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  const scene = new THREE.Scene();
  scene.add(quad);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  renderer.setRenderTarget(previous);
  material.dispose();
  quad.geometry.dispose();
  for (const t of target.textures) t.colorSpace = THREE.NoColorSpace;
  return [target.textures[0]!, target.textures[1]!];
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic hash of a lattice point, 0..1: the field's own weather, no state. */
function lattice(x: number, z: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Smooth value noise over the field: the corners of `cell`-metre blocks, interpolated.
 * This is what makes a region a region — neighbouring clouds read the same value, so
 * they share a condensation level and a kind of weather — and it costs one hash a
 * corner at load only.
 */
function regionNoise(x: number, z: number, cell: number, seed: number): number {
  const fx = x / cell, fz = z / cell;
  const ix = Math.floor(fx), iz = Math.floor(fz);
  const tx = fx - ix, tz = fz - iz;
  const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
  const a = lattice(ix, iz, seed), b = lattice(ix + 1, iz, seed);
  const c = lattice(ix, iz + 1, seed), d = lattice(ix + 1, iz + 1, seed);
  const lo = a + (b - a) * sx, hi = c + (d - c) * sx;
  return lo + (hi - lo) * sz;
}

/** Wind over the field, metres a second. */
const WIND_X = 3.2;
const WIND_Z = 1.1;

/** Spacing of the cluster lattice across the wind, and of the clusters along it, metres. */
const STREET_ACROSS_M = 6400;
const STREET_ALONG_M = 3100;
/** How far a cluster's own clouds scatter off its centre: wider along the street. */
const CLUSTER_ALONG_M = 1500;
const CLUSTER_ACROSS_M = 900;
/** The scales of the field's weather: the condensation level, convection, the sheet. */
const LEVEL_SCALE_M = 9000;
const CONVECTION_SCALE_M = 11000;
const SHEET_SCALE_M = 15000;
/** Which families show at which cover: [first cover it needs, last]. */
const COVER_BAND: readonly (readonly [number, number])[] = [
  [0.06, 0.5], // humilis
  [0.35, 0.75], // mediocris
  [0.66, 0.98], // congestus: the last to appear, and only in a built-up sky
  [0.02, 0.3], // fractus
  [0.2, 0.7], // stratocumulus
];

/**
 * Which family a cloud draws, from its region's weather and its own coin. Not one
 * species a region: real air has shreds under the domes and domes around the towers, and
 * a region of nothing but shreds is a swarm of gnats in the sky. `sheet` regions are
 * mostly deck with a few domes breaking through, fair regions mostly humilis with a
 * scattering of fractus, convective ones mostly mediocris — and a congestus is an EVENT,
 * a tenth even where the air is most unstable. A fair-weather middle-belt sky that is a
 * field of towers is not the sky the owner is painting.
 */
function pickFamily(conv: number, sheet: number, coin: number): number {
  if (sheet > 0.66) return coin < 0.6 ? STRATOCUMULUS : coin < 0.85 ? HUMILIS : MEDIOCRIS;
  if (conv < 0.4) return coin < 0.74 ? HUMILIS : coin < 0.82 ? FRACTUS : MEDIOCRIS;
  if (conv < 0.62) return coin < 0.3 ? HUMILIS : coin < 0.9 ? MEDIOCRIS : CONGESTUS;
  return coin < 0.26 ? HUMILIS : coin < 0.9 ? MEDIOCRIS : CONGESTUS;
}

/**
 * Fills the instance buffers. A cloud is not placed on its own. The field is dealt out
 * in clusters on a lattice that runs along the wind — the rows are further apart across
 * the wind than the clusters along it, so the clumps line up in streets as cumulus do —
 * and every cloud of a cluster reads the region's own weather: its condensation level
 * (one base plane per region, as the real level is one per air mass), and its families
 * (shreds and low domes where the air is fair, heads and towers where it is not, a
 * clumped sheet where the deck is stable). Clusters thin out where the region's own
 * density noise is low, so the sky has its clear stretches instead of an even soup.
 *
 * Placement is fixed in FIELD space, and the field wraps round the camera: driving
 * takes you under one street and out from under it, and the same clusters come back.
 */
function placeClouds(base: Float32Array, shape: Float32Array, look: Float32Array): void {
  const rnd = mulberry(0x636c6f75);
  const wind = Math.hypot(WIND_X, WIND_Z);
  const ax = WIND_X / wind, az = WIND_Z / wind; // along the street
  const half = FIELD_M * 0.5;
  const rows = Math.ceil(FIELD_M / STREET_ACROSS_M);
  const cols = Math.ceil(FIELD_M / STREET_ALONG_M);
  let n = 0;
  /** One cloud of the cluster whose centre is `along`/`across` metres off the field's. */
  const place = (along: number, across: number): void => {
    const jitter = rnd() - 0.5;
    const offAlong = along + (rnd() - 0.5) * 2 * CLUSTER_ALONG_M;
    const offAcross = across + (rnd() - 0.5) * 2 * CLUSTER_ACROSS_M;
    const x = (((half + offAlong * ax - offAcross * az) % FIELD_M) + FIELD_M) % FIELD_M;
    const z = (((half + offAlong * az + offAcross * ax) % FIELD_M) + FIELD_M) % FIELD_M;
    const conv = regionNoise(x, z, CONVECTION_SCALE_M, 31);
    const sheet = regionNoise(x, z, SHEET_SCALE_M, 57);
    const family = pickFamily(conv, sheet, rnd());
    const spec = FAMILY_TABLE[family]!;
    const band = COVER_BAND[family]!;
    base[n * 4] = x;
    base[n * 4 + 1] = z;
    // The region's condensation level, one plane for the whole cluster, a few metres of
    // its own so the deck is not a ruled line.
    base[n * 4 + 2] = ALTITUDE_M + (regionNoise(x, z, LEVEL_SCALE_M, 13) - 0.5) * 2 * BASE_WANDER_M + jitter * 2 * BASE_JITTER_M;
    // Many small, few large, and the family's own size on top of that.
    base[n * 4 + 3] = (WIDTH_MIN_M + (WIDTH_MAX_M - WIDTH_MIN_M) * rnd() ** 2.2) * spec.size;
    shape[n * 2] = Math.floor(rnd() * VARIANT_COUNT);
    shape[n * 2 + 1] = band[0] + (band[1] - band[0]) * rnd();
    look[n * 4] = spec.aspect * (0.86 + 0.28 * rnd());
    look[n * 4 + 1] = spec.depth;
    look[n * 4 + 2] = rnd() < 0.5 ? 1 : -1;
    look[n * 4 + 3] = family;
    n++;
  };
  for (let pass = 0; n < COUNT && pass < 8; pass++) {
    for (let row = 0; row < rows && n < COUNT; row++) {
      for (let col = 0; col < cols && n < COUNT; col++) {
        // The lattice jitters off its own hash, never off the stream: a cluster keeps
        // its place however many clouds the passes before it placed.
        const along = (col + 0.5 + (lattice(col, row, 3) - 0.5) * 0.7) * STREET_ALONG_M;
        const across = (row + 0.5 + (lattice(col, row, 5) - 0.5) * 0.7) * STREET_ACROSS_M;
        const wx = (((half + along * ax - across * az) % FIELD_M) + FIELD_M) % FIELD_M;
        const wz = (((half + along * az + across * ax) % FIELD_M) + FIELD_M) % FIELD_M;
        const density = regionNoise(wx, wz, CONVECTION_SCALE_M * 1.6, 71);
        const count = pass === 0 ? Math.max(0, Math.round((density - 0.3) * 9)) : 1;
        for (let k = 0; k < count && n < COUNT; k++) place(along, across);
      }
    }
  }
  // Anything the lattice did not reach is a cloud that never shows (cover is under 1).
  for (let i = n; i < COUNT; i++) {
    base[i * 4 + 3] = 0;
    shape[i * 2 + 1] = 2;
    look[i * 4 + 3] = HUMILIS;
    look[i * 4] = FAMILY_TABLE[HUMILIS]!.aspect;
  }
}

interface CloudUniforms {
  readonly zenith: THREE.Color;
  readonly horizon: THREE.Color;
}

export class Clouds {
  readonly mesh: THREE.Group;
  private readonly material: THREE.ShaderMaterial;
  /** Two draw buffers, one drawn while the other is sorted into (see the header). */
  private readonly geoms: [THREE.InstancedBufferGeometry, THREE.InstancedBufferGeometry];
  private readonly meshes: [THREE.Mesh, THREE.Mesh];
  private readonly base: Float32Array;
  private readonly shape: Float32Array;
  /** Per cloud: drawn aspect, footprint depth, mirror, family row (see `placeClouds`). */
  private readonly look: Float32Array;
  private front = 0;
  private sortedAtX = Number.NaN;
  private sortedAtZ = Number.NaN;
  private readonly camAbs = new THREE.Vector2();

  constructor(renderer: THREE.WebGLRenderer, shared: CloudUniforms) {
    const [atlasA, atlasB] = bake(renderer);
    this.base = new Float32Array(COUNT * 4);
    this.shape = new Float32Array(COUNT * 2);
    this.look = new Float32Array(COUNT * 4);
    placeClouds(this.base, this.shape, this.look);
    this.material = new THREE.ShaderMaterial({
      vertexShader: DRAW_VERTEX,
      fragmentShader: DRAW_FRAGMENT,
      uniforms: {
        uAtlasA: { value: atlasA },
        uAtlasB: { value: atlasB },
        uCamAbs: { value: this.camAbs },
        uWind: { value: new THREE.Vector2() },
        uCover: { value: 0.5 },
        uLightDir: { value: new THREE.Vector3(0, 1, 0) },
        uLightColor: { value: new THREE.Color() },
        uLight: { value: 1 },
        uZenith: { value: shared.zenith },
        uHorizon: { value: shared.horizon },
        uAmount: { value: 1 },
        uGrey: { value: 0 },
        uOvercast: { value: 0 },
        uRain: { value: 0 },
        uDusk: { value: 0 },
      },
      transparent: true,
      // The flat card under the base is seen from below, the upright one from either
      // side of its turn: no winding is "front" for both.
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: true,
    });
    // Two quads per cloud (see TWO VIEWS): the flat one first, so where both show
    // during the hand-over the upright one blends over it.
    const quad = new THREE.PlaneGeometry(1, 1);
    const quadPos = quad.getAttribute('position').array as Float32Array;
    const quadIndex = quad.index!.array;
    const positions = new Float32Array(quadPos.length * 2);
    positions.set(quadPos, 0);
    positions.set(quadPos, quadPos.length);
    const views = new Float32Array([1, 1, 1, 1, 0, 0, 0, 0]);
    const indices = new Uint16Array(quadIndex.length * 2);
    for (let k = 0; k < quadIndex.length; k++) {
      indices[k] = quadIndex[k]!;
      indices[k + quadIndex.length] = quadIndex[k]! + 4;
    }
    const position = new THREE.BufferAttribute(positions, 3);
    const view = new THREE.BufferAttribute(views, 1);
    const index = new THREE.BufferAttribute(indices, 1);
    quad.dispose();
    const geom = (): THREE.InstancedBufferGeometry => {
      const g = new THREE.InstancedBufferGeometry();
      g.setIndex(index);
      g.setAttribute('position', position);
      g.setAttribute('aView', view);
      g.setAttribute('aCloud', new THREE.InstancedBufferAttribute(new Float32Array(COUNT * 4), 4));
      g.setAttribute('aShape', new THREE.InstancedBufferAttribute(new Float32Array(COUNT * 2), 2));
      g.setAttribute('aLook', new THREE.InstancedBufferAttribute(new Float32Array(COUNT * 4), 4));
      g.instanceCount = 0;
      return g;
    };
    this.geoms = [geom(), geom()];
    this.mesh = new THREE.Group();
    const card = (g: THREE.InstancedBufferGeometry): THREE.Mesh => {
      const m = new THREE.Mesh(g, this.material);
      m.frustumCulled = false;
      // After the stars (-8) and planets (-7), so a cloud hides them.
      m.renderOrder = 6;
      m.visible = false;
      this.mesh.add(m);
      return m;
    };
    this.meshes = [card(this.geoms[0]), card(this.geoms[1])];
  }

  private windX = 0;
  private windZ = 0;
  private lastT = Number.NaN;

  /**
   * Once a frame. `camX`/`camZ` the camera's ABSOLUTE world position (the field is in
   * world metres), `light` the key light (sun or moon) direction and colour and its
   * strength against full day, `cover` the cumulus cover 0..1, `overcast` 0..1, `rain`
   * 0..1 how hard it is raining out of it, `amount` 0..1 how visible clouds are at all
   * (they fade into the night), `dusk` 0..1 how strongly a low sun lights the bases
   * from underneath.
   */
  update(camX: number, camZ: number, lightDir: THREE.Vector3, lightColor: THREE.Color, light: number, cover: number, overcast: number, rain: number, amount: number, dusk: number): void {
    const u = this.material.uniforms;
    this.camAbs.set(camX, camZ);
    // The wind: its own clock, wrapped on the field, so it never jumps.
    const now = performance.now() * 0.001;
    const dt = Number.isFinite(this.lastT) ? Math.min(0.1, now - this.lastT) : 0;
    this.lastT = now;
    this.windX = (this.windX + dt * WIND_X) % FIELD_M;
    this.windZ = (this.windZ + dt * WIND_Z) % FIELD_M;
    (u.uWind!.value as THREE.Vector2).set(this.windX, this.windZ);
    u.uCover!.value = Math.min(1, cover + overcast * 0.5);
    (u.uLightDir!.value as THREE.Vector3).copy(lightDir);
    (u.uLightColor!.value as THREE.Color).copy(lightColor);
    u.uLight!.value = light;
    u.uGrey!.value = overcast * 0.9;
    u.uOvercast!.value = overcast;
    u.uRain!.value = rain;
    u.uAmount!.value = amount;
    u.uDusk!.value = dusk;
    if (!(Math.hypot(camX - this.sortedAtX, camZ - this.sortedAtZ) < RESORT_M)) this.sort(camX, camZ);
  }

  /**
   * Sorts the clouds far to near into the buffer not being drawn, and swaps: blended
   * cards overlap, and must be drawn back to front. The wind moves the field too slowly
   * between sorts (every `RESORT_M` of travel) to upset the order visibly.
   */
  private sort(camX: number, camZ: number): void {
    this.sortedAtX = camX;
    this.sortedAtZ = camZ;
    const wind = this.material.uniforms.uWind!.value as THREE.Vector2;
    const F = FIELD_M;
    const order = Array.from({ length: COUNT }, (_, i) => {
      const rx = ((((this.base[i * 4]! + wind.x - camX + F / 2) % F) + F) % F) - F / 2;
      const rz = ((((this.base[i * 4 + 1]! + wind.y - camZ + F / 2) % F) + F) % F) - F / 2;
      return { i, d: rx * rx + rz * rz };
    }).sort((a, b) => b.d - a.d);
    const back = 1 - this.front;
    const g = this.geoms[back]!;
    const c = g.getAttribute('aCloud') as THREE.InstancedBufferAttribute;
    const s = g.getAttribute('aShape') as THREE.InstancedBufferAttribute;
    const l = g.getAttribute('aLook') as THREE.InstancedBufferAttribute;
    order.forEach(({ i }, k) => {
      (c.array as Float32Array).set(this.base.subarray(i * 4, i * 4 + 4), k * 4);
      (s.array as Float32Array).set(this.shape.subarray(i * 2, i * 2 + 2), k * 2);
      (l.array as Float32Array).set(this.look.subarray(i * 4, i * 4 + 4), k * 4);
    });
    c.needsUpdate = true;
    s.needsUpdate = true;
    l.needsUpdate = true;
    g.instanceCount = COUNT;
    this.meshes[back]!.visible = true;
    this.meshes[this.front]!.visible = false;
    this.front = back;
  }
}
