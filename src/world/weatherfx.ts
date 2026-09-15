import * as THREE from 'three';
import { hashUnit3 } from '../core/rng';
import type { ChunkContent, ChunkContext, ChunkProvider } from './chunks';
import {
  VarietyChannel,
  varietyEventOfWindow,
  varietyWindowAt,
  type VarietyEvent,
} from './director';
import { desertPaletteAt } from './gradient';

/**
 * DISTANT WEATHER: something happening out there, over the road the event spans.
 *
 * The variety director (`world/director.ts`) schedules a `weather` event roughly
 * every 26 km of road, and this is what appears when it does — one phenomenon
 * standing 600 to 1800 m off the road on the event's own side, in view for the
 * kilometre of road the event covers, then gone.
 *
 * WHY IT IS ALLOWED TO BE FLAT. Everything here is three or four alpha sheets of
 * about a hundred triangles. At 600 m the smallest of these phenomena is 90 metres
 * across on screen and its silhouette is the entire content of it: a rain shaft is
 * a soft vertical smear, a dust front is a long ragged hem, a smoke column is a
 * leaning line. None of those is a shape a volumetric anything would draw better,
 * and all three are things the eye recognises from the outline alone. The
 * distant mirage (`render/mirage.ts`) settled the same question the same way for
 * the same reason.
 *
 * WHY IT IS BUILT BY A CHUNK PROVIDER and not, like the mirage, by a resident
 * render-side object: a phenomenon is placed off a specific arclength and needs the
 * road frame and the terrain height there, which is exactly what a chunk build
 * already has in hand, and streaming it means the sheets and their material live
 * and die with the road under them instead of being kept alive across 40 000 km.
 *
 * NO PHYSICS, NO SHADOWS, NO COLLIDERS. It is weather 600 m away. The one thing it
 * must not do is let the player reach it: see `WEATHER_NEAR_GONE`.
 */

/** The three families, in the order `event.draw` selects them. */
export const WEATHER_FAMILIES = ['virga', 'dustWall', 'smokeColumn'] as const;
export type WeatherFamily = (typeof WEATHER_FAMILIES)[number];

/**
 * How far off the road a phenomenon stands, metres.
 *
 * The floor is what makes it weather rather than scenery: inside about 400 m the
 * player reads a dust wall as an obstacle and steers for the gap, and at road speed
 * a 500 m object crosses the windscreen in seconds, so it flicks past instead of
 * standing there. The ceiling is what keeps it legible — the fog at the weakest
 * rung's 1500 m horizon has eaten most of the contrast by 1800 m, and past that
 * these become a faint stain rather than an event.
 */
export const WEATHER_LATERAL_MIN = 600;
export const WEATHER_LATERAL_SPAN = 1200;

/**
 * The along-road fade, metres from the phenomenon's own arclength.
 *
 * Bounded by the streamer, not by taste: visual chunks live `VISUAL_RADIUS` (6) x
 * `CHUNK_LENGTH` (200) = 1200 m either side of the player, so a phenomenon that
 * were still visible at 1200 m would VANISH mid-view the moment its chunk left
 * range. Fading out by 1150 m keeps the disappearance inside the fade and not
 * inside the frame.
 */
const WEATHER_ALONG_FULL = 900;
const WEATHER_ALONG_GONE = 1150;
/**
 * The proximity dissolve, metres. Exported because the band is the one number here
 * that has to be checked against the road rather than chosen.
 *
 * A player who leaves the road and drives at it keeps its chunk alive — chunk range
 * is measured along the road, and his projected arclength barely moves while he
 * drives out into the desert — so without this he arrives at a 1600 m dust wall made
 * of two triangles and drives through it. It dissolves first.
 *
 * THE CEILING IS NOT A TASTE. It was 520 m, midway between the road and
 * `WEATHER_LATERAL_MIN`, on the assumption that something placed 600 m off one
 * arclength stays 600 m from the road. It does not: the road turns, and
 * `tools/sky-variety.ts` measured the asphalt coming within 477 m of a phenomenon
 * over the very stretch it is visible from (4 seeds, 1600 km). A 520 m ceiling
 * therefore dissolved weather while the player was on the road looking straight at
 * it. 320 m leaves 150 m of measured margin under the worst approach the road makes
 * on its own, and still takes the sheets away from anyone who drives out at them.
 */
export const WEATHER_NEAR_GONE = 150;
export const WEATHER_NEAR_FULL = 320;
/**
 * Twilight band, on the sky's own day factor. Deliberately the identical band
 * `render/mirage.ts` fades its vessels across: both are daylight illusions, both
 * are unlit display-space geometry that would glow against a dark desert, and a
 * player watching them leave at two different times would be watching a bug.
 */
const WEATHER_DAY_LOW = 0.12;
const WEATHER_DAY_HIGH = 0.42;

/** Hash domains. Distinct from every other system's, and from each other. */
const SALT_LATERAL = 0x57544831; // 'WTH1'
const SALT_SIZE = 0x57544832; // 'WTH2'
const SALT_RAGGED = 0x57544833; // 'WTH3'

/** Sheet tessellation. The silhouette is the content, so it all goes on the edge. */
const SHEET_COLUMNS = 10;
const SHEET_ROWS = 6;

/**
 * One alpha sheet, in the phenomenon's own frame: X across, Y up from the ground
 * under the anchor, Z zero. Every number is metres except the alphas and `ragged`.
 */
interface Sheet {
  /** Width at the bottom edge, and at the top edge: a shaft tapers, a plume spreads. */
  readonly width: number;
  readonly widthTop: number;
  /** Bottom and top edge heights above the ground under the anchor. */
  readonly base: number;
  readonly top: number;
  /** Where the sheet's own centreline sits, and how far the top leans off it. */
  readonly offset: number;
  readonly lean: number;
  /** Authored display colours, bottom and top. */
  readonly colourLow: number;
  readonly colourHigh: number;
  /** Opacity at the bottom and top edges, before the side and ragged fades. */
  readonly alphaLow: number;
  readonly alphaHigh: number;
  /**
   * Fraction of the sheet the ragged silhouette may eat away, from whichever end
   * is the faded one. This is the difference between weather and a billboard: the
   * straight edge of a quad is the one thing no cloud, dust front or smoke column
   * has.
   */
  readonly ragged: number;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Which family an event's own roll produces. Thirds of `draw`, so the three are
 * equally likely and the answer is a pure function of the event.
 */
export function weatherFamilyFor(draw: number): WeatherFamily {
  const index = Math.min(WEATHER_FAMILIES.length - 1, Math.floor(draw * WEATHER_FAMILIES.length));
  return WEATHER_FAMILIES[index]!;
}

/** Signed lateral offset of an event's phenomenon, metres. Pure in the event. */
export function weatherLateralFor(seed: number, event: VarietyEvent): number {
  const roll = hashUnit3(seed, event.index, SALT_LATERAL);
  return event.side * (WEATHER_LATERAL_MIN + roll * WEATHER_LATERAL_SPAN);
}

/**
 * How visible a phenomenon is: the product of the day, the along-road fade and the
 * proximity dissolve. Exported because `tools/sky-variety.ts` checks the envelope
 * closes at both ends without needing a camera.
 */
export function weatherOpacity(dayFactor: number, along: number, planar: number): number {
  const daylight = smoothstep(WEATHER_DAY_LOW, WEATHER_DAY_HIGH, dayFactor);
  const arrival = 1 - smoothstep(WEATHER_ALONG_FULL, WEATHER_ALONG_GONE, along);
  const clearance = smoothstep(WEATHER_NEAR_GONE, WEATHER_NEAR_FULL, planar);
  return daylight * arrival * clearance;
}

// ---------------------------------------------------------------------------
// The families
// ---------------------------------------------------------------------------

/**
 * VIRGA. Rain that never lands: a shaft falling out of a cloud base and evaporating
 * in the dry air a few hundred metres above the sand. It is the most common thing
 * in a desert sky that reads unmistakably as weather, and the whole of it is the
 * gap at the bottom — a shaft drawn down to the ground is just rain, and rain here
 * would be a lie about the climate.
 *
 * The shaft's top overlaps the cloud slab by ten metres: at 600 m a one-metre seam
 * between two alpha sheets is a visible bright line, and the overlap costs nothing
 * because neither sheet writes depth.
 */
const VIRGA_SHEETS: readonly Sheet[] = [
  {
    width: 900,
    widthTop: 1120,
    base: 720,
    top: 910,
    offset: 0,
    lean: 40,
    colourLow: 0x565d6b,
    colourHigh: 0x99a3b1,
    alphaLow: 0.58,
    alphaHigh: 0.24,
    ragged: 0.42,
  },
  {
    width: 300,
    widthTop: 500,
    base: 300,
    top: 730,
    offset: -60,
    lean: 90,
    colourLow: 0x4d5764,
    colourHigh: 0x5e6b7c,
    alphaLow: 0,
    alphaHigh: 0.5,
    ragged: 0.4,
  },
];

/**
 * A HABOOB FRONT. Low, wide, and made of the ground it is carrying: the colour
 * comes from `desertPaletteAt` at the event's own arclength, so the wall is the
 * same sand as the district it is crossing rather than a generic brown.
 *
 * Both sheets start BELOW the anchor's ground height. The anchor is one terrain
 * sample up to 1800 m out and the desert between it and the road is not flat, so a
 * hem drawn exactly at the anchor's height stands clear of the ground wherever the
 * land falls away — the one failure the player would certainly notice. Twenty
 * metres of the wall is buried instead.
 */
function dustWallSheets(sand: number, shade: number): readonly Sheet[] {
  return [
    {
      width: 1600,
      widthTop: 1420,
      base: -20,
      top: 220,
      offset: 0,
      lean: -60,
      colourLow: shade,
      colourHigh: sand,
      alphaLow: 0.74,
      alphaHigh: 0.14,
      ragged: 0.5,
    },
    {
      width: 720,
      widthTop: 520,
      base: -20,
      top: 340,
      offset: 380,
      lean: -120,
      colourLow: shade,
      colourHigh: sand,
      alphaLow: 0.56,
      alphaHigh: 0.1,
      ragged: 0.62,
    },
  ];
}

/**
 * A SMOKE COLUMN. Thin, dark, and leaning: somebody is burning something out there,
 * which is the only one of the three that implies a person. The lean is the whole
 * reading — a vertical column is a chimney, a leaning one is smoke in wind — and it
 * continues across the two sheets, the upper plume starting where the column's top
 * has already been carried 150 m downwind.
 */
const SMOKE_COLUMN_SHEETS: readonly Sheet[] = [
  {
    width: 70,
    widthTop: 260,
    base: -8,
    top: 520,
    offset: 0,
    lean: 150,
    colourLow: 0x2c2926,
    colourHigh: 0x6d6762,
    alphaLow: 0.82,
    alphaHigh: 0.14,
    ragged: 0.5,
  },
  {
    width: 240,
    widthTop: 440,
    base: 480,
    top: 780,
    offset: 150,
    lean: 210,
    colourLow: 0x6b655f,
    colourHigh: 0x8d877f,
    alphaLow: 0.3,
    alphaHigh: 0.02,
    ragged: 0.7,
  },
];

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/**
 * Colour scratches. Two, and reused across every vertex of every sheet: a sheet's
 * ramp is one lerp between two fixed ends, and allocating a Color per vertex to
 * express that is the one thing a geometry build must not do.
 */
const colourLow = new THREE.Color();
const colourHigh = new THREE.Color();
const colourAt = new THREE.Color();

/**
 * One sheet as a grid with its shape in the vertex alpha.
 *
 * WHY THE ALPHA IS VERTEX DATA and not a texture: it is per-phenomenon (a ragged
 * hem hashed from the event), it is wanted in four channels alongside a vertical
 * colour ramp, and a 77-vertex grid carries it for nothing — where a texture would
 * be an atlas, a sampler and a per-fragment fetch on geometry that is already
 * translucent. `world/lakes.ts` bakes its shoreline the same way.
 *
 * The three fades multiply:
 *  - VERTICAL, from `alphaLow` to `alphaHigh`, which is what makes a shaft a shaft.
 *  - SIDEWAYS, a raised sine, so neither vertical edge of the quad is ever an edge
 *    in the picture. Raised to 0.65 rather than left linear because a plain sine
 *    has half the sheet at under half opacity and the phenomenon loses its body.
 *  - RAGGED, per column, eating into the faded end by up to `ragged` of the height.
 *    Hashed on the event so it is the same silhouette every time this chunk is
 *    rebuilt.
 */
function sheetGeometry(sheet: Sheet, seed: number, event: VarietyEvent, index: number): THREE.BufferGeometry {
  const across = SHEET_COLUMNS + 1;
  const up = SHEET_ROWS + 1;
  const count = across * up;
  const positions = new Float32Array(count * 3);
  const colours = new Float32Array(count * 4);
  // The faded end is the one the raggedness eats into, so a cloud frays upward and
  // a rain shaft frays downward off the same rule.
  const fadedAtTop = sheet.alphaHigh < sheet.alphaLow;
  colourLow.setHex(sheet.colourLow, THREE.LinearSRGBColorSpace);
  colourHigh.setHex(sheet.colourHigh, THREE.LinearSRGBColorSpace);

  for (let column = 0; column < across; column++) {
    const u = column / SHEET_COLUMNS;
    const side = Math.pow(Math.sin(Math.PI * u), 0.65);
    const cut = sheet.ragged * hashUnit3(seed, event.index, SALT_RAGGED + index * 0x1f + column);
    for (let row = 0; row < up; row++) {
      const v = row / SHEET_ROWS;
      const width = sheet.width + (sheet.widthTop - sheet.width) * v;
      const i = column * up + row;
      positions[i * 3] = sheet.offset + sheet.lean * v + (u - 0.5) * width;
      positions[i * 3 + 1] = sheet.base + (sheet.top - sheet.base) * v;
      positions[i * 3 + 2] = 0;

      colourAt.copy(colourLow).lerp(colourHigh, v);
      // Distance from the faded end, so the ragged bite is taken out of it.
      const fromFaded = fadedAtTop ? 1 - v : v;
      const alpha =
        (sheet.alphaLow + (sheet.alphaHigh - sheet.alphaLow) * v) *
        side *
        smoothstep(cut, cut + 0.28, fromFaded);
      colours[i * 4] = colourAt.r;
      colours[i * 4 + 1] = colourAt.g;
      colours[i * 4 + 2] = colourAt.b;
      colours[i * 4 + 3] = alpha;
    }
  }

  const indices = new Uint16Array(SHEET_COLUMNS * SHEET_ROWS * 6);
  let ii = 0;
  for (let column = 0; column < SHEET_COLUMNS; column++) {
    for (let row = 0; row < SHEET_ROWS; row++) {
      const a = column * up + row;
      const b = a + up;
      indices[ii++] = a;
      indices[ii++] = b;
      indices[ii++] = a + 1;
      indices[ii++] = a + 1;
      indices[ii++] = b;
      indices[ii++] = b + 1;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 4));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

// ---------------------------------------------------------------------------
// The live set
// ---------------------------------------------------------------------------

/**
 * Every phenomenon currently streamed in, so one call a frame can fade them.
 *
 * THIS IS PRESENTATION STATE, NOT WORLD STATE, and the distinction is the whole
 * reason it is allowed to exist. Nothing here decides what is built, where it
 * stands or what it looks like — all of that is a pure function of the seed and the
 * event, and a rebuilt chunk reproduces itself exactly whether or not this array
 * ever existed. What it carries is one opacity per live phenomenon, which depends
 * on the camera and the sun and therefore cannot be baked. Entries are added by a
 * build and removed by that build's own `dispose`, so the set is exactly the set on
 * screen and its order is never read.
 */
interface LivePhenomenon {
  readonly group: THREE.Group;
  readonly material: THREE.MeshBasicMaterial;
  /** Absolute anchor, in f64, so a rebase cannot move the fade. */
  readonly anchorX: number;
  readonly anchorZ: number;
  /** Unit road heading at the anchor: resolves the camera offset into along/across. */
  readonly headingX: number;
  readonly headingZ: number;
  /**
   * Unit span axis of the sheets in world XZ, and half their widest span.
   *
   * THE DISSOLVE IS A DISTANCE TO THE THING, NOT TO ITS CENTRE. A haboob front is
   * 1600 m wide, so its own edge stands up to 800 m from the anchor the fade used to
   * measure: a camera a few metres from the sheet reported 600 m of clearance, kept
   * the wall at full opacity, and the player was inside a kilometre of dust looking
   * at its side edge. Reported from play exactly that way.
   */
  readonly spanX: number;
  readonly spanZ: number;
  readonly halfSpan: number;
}

const live: LivePhenomenon[] = [];

/**
 * Fades every streamed phenomenon for this frame. Called once from `main.ts` beside
 * the mirage's own update, with the sky's day factor and the ABSOLUTE camera
 * position — absolute because the anchors are kept in f64 world coordinates, which
 * is the only frame a rebase leaves alone.
 *
 * The along-road distance is taken as the camera offset resolved onto the road
 * heading at the anchor rather than by projecting the camera onto the road: the
 * projection is a search, this is a dot product, and over the 2.3 km of straight-ish
 * road a phenomenon is visible from the two answers differ by less than the fade
 * band is wide.
 */
export function setWeatherFrame(dayFactor: number, cameraX: number, cameraZ: number): void {
  for (const phenomenon of live) {
    const dx = cameraX - phenomenon.anchorX;
    const dz = cameraZ - phenomenon.anchorZ;
    const along = Math.abs(dx * phenomenon.headingX + dz * phenomenon.headingZ);
    // Nearest point of the sheets' own footprint, not their centre: the camera offset
    // is resolved onto the span axis, clamped to the span, and what is left is the
    // distance to the thing itself. See `LivePhenomenon.spanX`.
    const spanAt = Math.max(
      -phenomenon.halfSpan,
      Math.min(phenomenon.halfSpan, dx * phenomenon.spanX + dz * phenomenon.spanZ),
    );
    const planar = Math.hypot(dx - spanAt * phenomenon.spanX, dz - spanAt * phenomenon.spanZ);
    const opacity = weatherOpacity(dayFactor, along, planar);
    // Below a quarter of a percent the sheets contribute nothing but blend cost and
    // a transparent sort, so they leave the draw list entirely.
    phenomenon.group.visible = opacity > 0.0025;
    phenomenon.material.opacity = opacity;
  }
}

// ---------------------------------------------------------------------------
// Footprint geometry
// ---------------------------------------------------------------------------

/**
 * Half the widest ground footprint the sheets reach, metres, including the lean and
 * the offset of the sheet that sticks out furthest.
 */
function sheetHalfSpan(sheets: readonly Sheet[]): number {
  let half = 0;
  for (const sheet of sheets) {
    const widest = Math.max(sheet.width, sheet.widthTop) * 0.5;
    const centre = Math.abs(sheet.offset) + Math.abs(sheet.lean);
    half = Math.max(half, centre + widest);
  }
  return half;
}

/**
 * The facing, chosen as the one that keeps the sheets furthest from the road.
 *
 * The span is perpendicular to whatever bearing the front is faced from, so the
 * facing decides where a kilometre of dust reaches. Clamping it against the anchor's
 * own lateral is not enough — the road turns, and over the reach a phenomenon is
 * visible from it can come back to within 477 m of an anchor placed 600 m out, which
 * is how a haboob ended up standing over the carriageway with its centre reporting
 * 600 m of clearance. So the clearance is MEASURED: the road is walked over the reach
 * the fade keeps the thing visible across, the candidate facings are scored on the
 * nearest approach of the footprint itself, and the best one wins. The preference for
 * the authored facing is a tie-break, not a constraint — a smear seen end-on is worth
 * less than a wall in the windscreen.
 *
 * Build-time only, once per weather chunk: one every 21 km of road.
 */
const YAW_CANDIDATES = 24;

function chooseSpanYaw(
  road: ChunkContext['road'],
  eventS: number,
  anchorX: number,
  anchorZ: number,
  halfSpan: number,
  wanted: number,
): { yaw: number; clearance: number } {
  let bestYaw = wanted;
  let bestScore = -Infinity;
  let bestClearance = 0;
  for (let i = 0; i < YAW_CANDIDATES; i++) {
    const yaw = wanted + (i * Math.PI) / YAW_CANDIDATES;
    const spanX = Math.cos(yaw);
    const spanZ = -Math.sin(yaw);
    let clearance = Infinity;
    for (let s = eventS - WEATHER_ALONG_GONE; s <= eventS + WEATHER_ALONG_GONE; s += 25) {
      const at = road.sampleAt(s);
      const dx = at.x - anchorX;
      const dz = at.z - anchorZ;
      const alongSpan = Math.max(-halfSpan, Math.min(halfSpan, dx * spanX + dz * spanZ));
      const d = Math.hypot(dx - alongSpan * spanX, dz - alongSpan * spanZ);
      if (d < clearance) clearance = d;
    }
    // Tie-break toward the authored facing, worth a few metres of clearance only.
    const score = clearance + (i === 0 ? 1 : 0);
    if (score > bestScore) {
      bestScore = score;
      bestYaw = yaw;
      bestClearance = clearance;
    }
  }
  return { yaw: bestYaw, clearance: bestClearance };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * Builds the phenomenon whose event CENTRE falls in this chunk, and nothing
 * otherwise.
 *
 * Owning the centre rather than the span is what keeps one phenomenon one object: a
 * `weather` span is 900-1200 m plus 300 m of ramp at each end, which is up to nine
 * chunks, and every one of them would otherwise build its own copy standing in the
 * same place. The span is not wasted — it is exactly the stretch of road the fade
 * above keeps it visible over.
 */
export class WeatherProvider implements ChunkProvider {
  readonly id = 'weather';

  build(ctx: ChunkContext): ChunkContent | null {
    const event = weatherEventCentredIn(ctx.world.seed, ctx.sStart, ctx.sEnd);
    if (event === null) return null;

    const seed = ctx.world.seed;
    const lateral = weatherLateralFor(seed, event);
    const anchor = ctx.road.offsetPoint(event.s, lateral);
    const groundY = ctx.terrain.heightAt(anchor.x, anchor.z, event.s);

    const family = weatherFamilyFor(event.draw);
    let sheets: readonly Sheet[];
    if (family === 'virga') {
      sheets = VIRGA_SHEETS;
    } else if (family === 'dustWall') {
      const palette = desertPaletteAt(event.s);
      // The lit face is the district's own sand; the hem is that sand in its own
      // shadow, which is what gives a 200 m wall any depth at all from 600 m away.
      sheets = dustWallSheets(palette.sand, palette.rock);
    } else {
      sheets = SMOKE_COLUMN_SHEETS;
    }

    // UNLIT, AUTHORED IN DISPLAY SPACE, for the reason `render/mirage.ts` sets out
    // at length: the renderer copies the linear scene target to the canvas
    // untouched, and a shaded material puts the sun behind these as often as in
    // front of them, which turned every one of them into a black cut-out.
    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      // Both faces: the player drives PAST this, so he sees it from both bearings,
      // and a single-sided sheet disappears as he crosses its plane.
      side: THREE.DoubleSide,
      fog: true,
    });

    const group = new THREE.Group();
    const geometries: THREE.BufferGeometry[] = [];
    for (let i = 0; i < sheets.length; i++) {
      const geometry = sheetGeometry(sheets[i]!, seed, event, i);
      geometries.push(geometry);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      group.add(mesh);
    }

    // Seeded size, within a fifth: enough that two virgas are not the same virga,
    // little enough that each family keeps the proportions it was drawn with.
    const sizeRoll = hashUnit3(seed, event.index, SALT_SIZE);
    group.scale.set(0.9 + sizeRoll * 0.3, 0.85 + sizeRoll * 0.35, 1);

    // Origin-relative, like everything a provider puts in the scene; the anchor
    // itself stays absolute in `live` so the per-frame fade survives a rebase.
    group.position.set(anchor.x - ctx.originX, groundY, anchor.z - ctx.originZ);
    // Faced from where it becomes clear rather than from the road beside it: these
    // are broadside objects, and a front seen end-on is a smear.
    //
    // BUT THE FACING MAY NOT WALK THE SHEET ONTO THE ROAD, and neither may its size.
    // The span is perpendicular to the bearing the front is faced from, so a haboob at
    // the minimum lateral faced from 900 m back ran its own 1600 m of width ACROSS the
    // carriageway — at 600 m out the across-component of the span axis is 0.83, which
    // reaches 664 m, past the road and out the other side — and the fade could not
    // save it because the fade measured the anchor. Reported from play as a yellow wall
    // standing over the road. So the facing is chosen on MEASURED clearance, and what
    // is still too wide for the room the road leaves is drawn smaller rather than
    // drawn across the asphalt: a 1.6 km front is authored scenery, a front in the
    // windscreen is a bug.
    const heading = ctx.road.sampleAt(event.s).heading;
    const approach = ctx.road.sampleAt(event.s - WEATHER_ALONG_FULL);
    const wanted = Math.atan2(approach.x - anchor.x, approach.z - anchor.z);
    const authoredHalfSpan = sheetHalfSpan(sheets) * group.scale.x;
    const faced = chooseSpanYaw(
      ctx.road,
      event.s,
      anchor.x,
      anchor.z,
      authoredHalfSpan,
      wanted,
    );
    group.rotation.y = faced.yaw;
    // The room the road leaves beside the chosen facing, and the size that fits it.
    // `clearance` is measured with the authored span already clamped in, so growing
    // room can only mean the sheets were never the limit.
    const room = faced.clearance + authoredHalfSpan - WEATHER_NEAR_FULL;
    const fit = Math.max(0, Math.min(1, room / Math.max(authoredHalfSpan, 1e-3)));
    if (fit < 1) group.scale.multiplyScalar(fit);
    const halfSpan = authoredHalfSpan * (fit < 1 ? fit : 1);
    group.visible = false;

    const spanX = Math.cos(group.rotation.y);
    const spanZ = -Math.sin(group.rotation.y);
    const phenomenon: LivePhenomenon = {
      group,
      material,
      anchorX: anchor.x,
      anchorZ: anchor.z,
      headingX: Math.sin(heading),
      headingZ: Math.cos(heading),
      spanX,
      spanZ,
      halfSpan,
    };
    live.push(phenomenon);

    return {
      group,
      bodies: [],
      colliders: [],
      dispose: () => {
        // Out of the live set FIRST: past this point nothing writes its opacity
        // again, and the last thing written was whatever the final frame left
        // there — so the group is put to sleep explicitly rather than handed back
        // still carrying a visible state it can no longer maintain.
        const at = live.indexOf(phenomenon);
        if (at >= 0) live.splice(at, 1);
        group.visible = false;
        for (const geometry of geometries) geometry.dispose();
        material.dispose();
      },
    };
  }
}

/**
 * The `weather` event whose centre lies in `[fromS, toS)`, or null.
 *
 * Asks the director by WINDOW rather than calling `varietyEventsBetween`, which
 * allocates an array of every event of every channel meeting the chunk: a 200 m
 * chunk touches at most two 4000 m horizon windows, and 99% of chunks are
 * answering "no" here.
 */
function weatherEventCentredIn(seed: number, fromS: number, toS: number): VarietyEvent | null {
  const first = varietyWindowAt(VarietyChannel.Horizon, fromS);
  const last = varietyWindowAt(VarietyChannel.Horizon, toS);
  for (let window = first; window <= last; window++) {
    if (window < 0) continue;
    const event = varietyEventOfWindow(seed, VarietyChannel.Horizon, window);
    if (event.kind !== 'weather') continue;
    if (event.s >= fromS && event.s < toS) return event;
  }
  return null;
}
