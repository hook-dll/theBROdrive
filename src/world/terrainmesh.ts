import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { SurfaceType } from '../core/surfaces';
import { applyComicShading } from '../render/comic';
import { applyCloudShadow } from '../render/cloudshadow';
import { weather } from './weather';
import { type Road } from './road';
import { RoadDistance } from './roaddistance';
import {
  BERM_CREST,
  BERM_FADE,
  BERM_START,
  CORRIDOR_INNER,
  DETAIL_REACH,
  type Terrain,
} from './terrain';
import { CHUNK_LENGTH, type ChunkContent, type ChunkContext, type ChunkProvider } from './chunks';
import { desertPaletteAt } from './gradient';
import { DESERT_TILE_SIZE } from './deserttiledata';

/**
 * Desert either side of the road.
 *
 * One road-aligned (s, lateral) grid serves as both the visible mesh and — out to
 * `PHYSICS_LATERAL` — the collider, so what you see is exactly what the wheels
 * feel, with no second sampling pass and no seam between a physics surface and a
 * drawn one. Lateral spacing grows geometrically: metres at the verge, hundreds of
 * metres at the horizon, which is what lets the vista reach kilometres for a few
 * hundred triangles.
 *
 * The bands, outward from the centreline:
 *   - to `PHYSICS_LATERAL`: drawn and solid. Fine at the verge, progressively
 *     coarser, and (see `terrain.ts`) progressively steeper past
 *     `HOSTILE_LATERAL_START`, so leaving the road becomes hard work rather than
 *     hitting an invisible wall.
 *   - to `FAR_LATERAL`: drawn only. Distant landscape; nothing to collide with out
 *     there because nothing can reach it.
 * Beyond that the fog ramp (main.ts) and the sky dome close the view.
 */

/**
 * How far out this mesh reaches, each side of the road. Chosen against the fog: at the
 * default view distance nothing beyond it resolves, so drawing further only costs
 * triangles on a weak GPU. Exported because the vista starts where this stops, and
 * because a view distance no larger than this needs no vista at all.
 */
export const NEAR_TERRAIN_REACH = 1500;
/**
 * How far out the ground is solid, each side of the road. The berm turns genuinely
 * unclimbable before this, so the edge is reached by choice, not by surprise — and
 * `main.ts` catches anything that gets past it anyway.
 */
const PHYSICS_LATERAL = 600;
/** Lateral spacing growth factor; resolution falls off away from the road. */
const LATERAL_RATIO = 1.35;
/**
 * FIELD LATTICE step along the road, metres. Must divide CHUNK_LENGTH.
 *
 * This is where the expensive part of the terrain is sampled: four fractal fields and
 * a landscape lookup, about 1 us a vertex. Eight metres is what that budget buys over
 * a 3 km fan, and it sets a 20 m floor on the wavelength the coarse bands may carry
 * (see GRAIN_WAVELENGTH in terrain.ts).
 */
const S_STEP = 8;
/**
 * Longitudinal sub-samples per field-lattice row inside `DETAIL_REACH`.
 *
 * The near desert is drawn and collided on the refined grid instead of on the field
 * lattice, and that is the whole reason the desert can have chop and holes in it: a
 * refined vertex's base height is BILINEARLY INTERPOLATED off the field lattice rather
 * than resampled from it, so it costs one lerp instead of five noise fields, and only
 * `Terrain.detailAt` — one two-octave field plus one lookup — is evaluated per vertex.
 *
 * An INTEGER subdivision, and that is load-bearing rather than tidy. The refined grid's
 * outermost column sits on the `DETAIL_REACH` ring and has to reproduce the coarse edge
 * it stitches to, which it only does if every field row is also a refined row: at 2.5 m
 * against an 8 m lattice the refined column chorded across the coarse polyline's kinks
 * and left a 23 mm crack at the seam, measured by tools/desert-ride.ts. At an integer
 * ratio every third refined row IS the coarse row and the two in between lie exactly on
 * the segment joining them.
 *
 * Three gives 2.67 m, which gives the detail layer's shortest octave (7 m) 2.6 samples
 * per wavelength — the same ratio the road's own collider gives its shortest bump
 * (3.33 m over a 1.333 m step), and the same reason: below it a wave reaches the trimesh
 * as seed-dependent spikes instead of as the shape it is.
 */
const FINE_SUBDIVISIONS = 3;
/** Refined grid step, metres, longitudinal and lateral alike. */
const FINE_STEP = S_STEP / FINE_SUBDIVISIONS;
/**
 * Cap on the field lattice's own ring spacing inside `DETAIL_REACH`, metres.
 *
 * The refined grid interpolates the field lattice, so the lattice's lateral spacing is
 * what limits the BASE under the chop: at the unconstrained 1.35 ratio the rings are
 * 25 m apart by 70 m out, which chords the 23.6 m ripple octave into a straight line.
 * Twelve metres costs three extra rings a side — 156 field samples a chunk, about
 * 0.16 ms — and keeps every coarse band the lattice claims to carry resolved right out
 * to the seam.
 */
const DETAIL_RING_CAP = 12;
/** Terrain tucks 8 cm beneath the asphalt edge, covering numerical seam cracks. */
const ROAD_SEAM_OVERLAP = 0.08;
const TERRAIN_INNER = CORRIDOR_INNER - ROAD_SEAM_OVERLAP;
/** Keep overlapped terrain below the road ribbon to prevent z-fighting. */
const ROAD_SEAM_DROP = 0.015;

/**
 * The one surface every terrain collider registers, and the only place in the world
 * that registers it.
 *
 * A chunk's fan spans gravel verge, sand and rock outcrops, but it is ONE trimesh, so
 * the registry can only hold one answer for it. Sand is that answer, and the desert
 * is mostly sand, so traction is right almost everywhere. Anything that needs the
 * real material at a point asks `Terrain.surfaceFromFrame` instead — the wheel spray
 * does exactly that, and it recognises "this contact is terrain, not road or scenery"
 * by comparing against this constant. Register it anywhere else and the spray will
 * treat that collider as open desert.
 */
export const TERRAIN_COLLIDER_SURFACE = SurfaceType.Sand;

/**
 * Ring spacing across the berm's face, metres. It climbs its 22 m over 70 m of lateral
 * distance, so this puts three rings on the face; at the unconstrained geometric spacing
 * out there the whole thing would be one facet and a 31-degree wall would draw as a
 * gentle ramp.
 */
const BERM_RING_SPACING = 24;
/**
 * Ring spacing across the berm's back, out to where it has faded away. Coarser than the
 * face — nothing past the crest is drivable — but still capped, because the fade is the
 * part that has to read as the back of a bank rather than as a step.
 */
const BERM_BACK_RING_SPACING = 90;
/**
 * Ring spacing from there out to this mesh's own draw distance. Everything past
 * FAR_LATERAL belongs to the vista (render/vista.ts), which has its own, much coarser,
 * rings.
 */
const OUTER_RING_SPACING = 150;

/**
 * Fold guard for road-relative terrain.
 *
 * A lateral row offsets each road sample along that sample's normal. On a curve,
 * normals converge on the inside and diverge on the outside; far enough away the
 * inside offset reaches a cusp and runs BACKWARDS. Indexing across that cusp makes
 * a kilometres-wide inverted triangle that sweeps over the road and closes the sky
 * as chunks stream.
 *
 * Valid longitudinal edges must still point along the centreline tangent and may
 * not grow absurdly relative to the centre row's own step. Both tests are derived
 * from the generated geometry, so they are independent of seed and kilometre.
 */
const FOLD_MIN_FORWARD_COS = 0.04;
const FOLD_MAX_EDGE_RATIO = 18;

/**
 * One piece of ground, one height.
 *
 * Every streamed road chunk fans outward from its own centreline span, so tight
 * bends make neighbouring fans overlap. Their heights are now sampled from the
 * same absolute field; overlap is therefore harmless compared with omission.
 *
 * Do not assign exclusive ownership to one streamed chunk. Streaming order cannot
 * guarantee that the chosen neighbour is attached in the same frame, and a pair of
 * ownership decisions can reject both sides of a boundary. Either case exposes the
 * sky as a pale wedge. Duplicate coverage may cost depth overdraw, but it preserves
 * the stronger invariant: every valid patch of ground is drawn.
 *
 * The fold guard still rejects cells whose own road-normal parameterisation has
 * inverted. Other overlapping fans and the camera-centred vista cover those cells.
 * Near the road, frame-derived height is cross-faded into the absolute field over
 * WORLD_HEIGHT_START..FULL so the asphalt edge remains bit-identical to the terrain.
 */
/** Lateral offset where height starts blending from frame-derived to position-derived. */
const WORLD_HEIGHT_START = 30;
/** Lateral offset past which height is purely a function of world position. */
const WORLD_HEIGHT_FULL = 60;
/**
 * Spacing of the absolute world lattice this provider reads the nearest-branch distance
 * on, metres. Small enough that the berm's own rise is captured (140 m of lateral
 * distance), large enough that a chunk's 3 km fan costs a few hundred searches. The
 * vista asks the same field for a much coarser one.
 */
const DIST_LATTICE = 50;

/**
 * Palette scratch colours, reused for every arclength row so a palette lookup
 * never allocates. The desert's sand, rock and gravel albedos come from
 * `desertPaletteAt` rather than the static `SURFACES` table, so they track the
 * colour cycle; asphalt, cracked asphalt and concrete never appear on terrain.
 */
const sandLinear = new THREE.Color();

/**
 * One arclength row's road frame: the centreline point, and the unit vector a lateral
 * offset is measured along. Reused per row, so no row allocates.
 *
 * `Road.offsetPoint` clamps `s` to the road's extent, which would collapse every apron
 * sample onto the boundary frame and flatten the apron to nothing. Beyond either end
 * the boundary frame is continued linearly instead — constant heading and height —
 * which is exact for the straight, flat runout behind s = 0 and a deliberate straight
 * continuation past the road's end. In range this is identical to `road.offsetPoint`.
 *
 * Per ROW rather than per vertex, which is the change from `offsetPoint`. Every vertex
 * in a row shares this frame, and `road.sampleAt` is a node lookup plus an
 * interpolation at 0.17 us — paid a hundred times over per row of the refined grid if
 * it is asked once per vertex.
 */
const rowFrame = { x: 0, z: 0, lateralX: 0, lateralZ: 0 };

function setRowFrame(road: Road, s: number): void {
  const c = road.sampleAt(s);
  const ds = s - c.s;
  const sinHeading = Math.sin(c.heading);
  const cosHeading = Math.cos(c.heading);
  rowFrame.x = c.x + sinHeading * ds;
  rowFrame.z = c.z + cosHeading * ds;
  rowFrame.lateralX = cosHeading;
  rowFrame.lateralZ = -sinHeading;
}

/**
 * One component of a refined vertex, bilinearly interpolated out of the four field
 * vertices bracketing it. `base` indices are into the interleaved position array and
 * already carry the component offset.
 *
 * All three components go through here, and they have to agree exactly: a weight of 1
 * must reproduce the field vertex bit for bit in x and z as well as in y, or the refined
 * grid stops being a subdivision of the field quads and the seam opens up. `a + (b - a)
 * * 1` does that; `a * (1 - t) + b * t` does not.
 */
function bilinear(
  positions: Float32Array,
  nearInner: number,
  nearOuter: number,
  farInner: number,
  farOuter: number,
  across: number,
  along: number,
): number {
  const near = positions[nearInner]! + (positions[nearOuter]! - positions[nearInner]!) * across;
  const far = positions[farInner]! + (positions[farOuter]! - positions[farInner]!) * across;
  return near + (far - near) * along;
}

/**
 * Shared near/far desert material. Physical normals and the live key light choose the
 * lee side; a restrained relief re-ramp keeps broad dune shading visible after sky fill,
 * haze and tone mapping without a terrain shadow map or another draw.
 * The player-centred tiles use the same authored material with one extra distance
 * transition. They arrive as a square worker-streamed window while the vista is a
 * camera-centred disc; the tile shader removes only its small-scale height detail
 * between these radii. The opaque base terrain remains intact, so distant objects
 * can never show through the transition.
 */
export const DESERT_TILE_FADE_FULL = 300;
export const DESERT_TILE_FADE_GONE = DESERT_TILE_SIZE * 2;
/**
 * Grit on the road shoulder, in the ground's own ink: a finer, denser stipple than the
 * desert's, weighted per vertex (`aShoulderGrit`, 0 where the strip meets the sand) so
 * it thins out into the plain ground. Two sizes, the small ones darker: crushed stone
 * reads as grains, not as a photograph laid on a drawing.
 */
const SHOULDER_GRIT_FRAGMENT = /* glsl */ `
if ( vShoulderGrit > 0.001 ) {
  vec2 fineUv = vComicWorld.xz / 0.16;
  float fineFoot = max( fwidth( fineUv.x ), fwidth( fineUv.y ) );
  float fine = comicStipple( fineUv, fineFoot ) * ( 1.0 - smoothstep( 0.3, 0.8, fineFoot ) );
  vec2 coarseUv = vComicWorld.xz / 0.42 + 7.3;
  float coarseFoot = max( fwidth( coarseUv.x ), fwidth( coarseUv.y ) );
  float coarse = comicStipple( coarseUv, coarseFoot ) * ( 1.0 - smoothstep( 0.3, 0.8, coarseFoot ) );
  gl_FragColor.rgb *= 1.0 - vShoulderGrit * ( fine * 0.3 + coarse * 0.2 );
}
#include <tonemapping_fragment>`;

/**
 * THE DESERT'S OWN SURFACE, on every material that draws it (tiles, vista, the vista's
 * overlap ring, the road shoulder), so the pattern is continuous across every seam
 * between them. Four things the flat one-colour-per-tile sand did not have:
 *
 *  1. BROAD PATCHES. Two octaves at 288 m and 96 m move the sand between a redder and a
 *     paler, yellower tone, and a third at 144 m lays pale dry crusts. Hue and
 *     saturation carry it; luminance moves only a few percent, because a darker patch
 *     of ground reads as a cloud's shadow (terrainmesh's own history).
 *  2. CRESTS AND TROUGHS. On the tiles, whose `aTerrainDetail` IS the wind-scale relief,
 *     crests are a shade lighter and the troughs between them warmer: sand sorts that way.
 *  3. PEBBLE FIELDS. The comic stipple's density follows a 48 m noise, so some ground is
 *     strewn with stones and some is clean sand, and the crusts are clean.
 *  4. WIND RIPPLES near the eye: one sine per fragment across the dune axis, 0.55 m
 *     apart, bent by a per-vertex warp, gone by 42 m and wherever it would alias.
 *
 * EVERYTHING NOISY IS PER VERTEX. A fragment-stage noise on this shader once cost 34 ms
 * of GPU through register spilling (cloudshadow.ts), so the fragment stage gets only
 * interpolated values, one multiply and, near the eye, one sine. Every noise is periodic
 * in the cloud field's rebase pan (`uGroundPan`, 36864 m), so a rebase moves nothing;
 * past 700-1600 m the patches give way to their mean, where the vista's rings are too
 * coarse to carry them.
 */
const GROUND_VERTEX_PARS = /* glsl */ `
varying vec3 vGroundTint;
varying vec2 vGroundWorld;
varying vec3 vGroundSurface;
float groundHash( float cx, float cz, float salt ) {
  vec3 h = fract( vec3( cx, cz, cx + cz + salt ) * 0.1031 );
  h += dot( h, h.yzx + 33.33 );
  return fract( ( h.x + h.y ) * h.z );
}
float groundNoise( vec2 p, float cells, float salt ) {
  vec2 i = floor( p );
  vec2 f = p - i;
  f = f * f * ( 3.0 - 2.0 * f );
  vec2 i0 = i - cells * floor( i / cells );
  vec2 i1 = i0 + 1.0;
  i1 -= cells * floor( i1 / cells );
  float a = groundHash( i0.x, i0.y, salt );
  float b = groundHash( i1.x, i0.y, salt );
  float c = groundHash( i0.x, i1.y, salt );
  float d = groundHash( i1.x, i1.y, salt );
  return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
}`;

const GROUND_VERTEX_HOOK = (crests: boolean): string => /* glsl */ `#include <worldpos_vertex>
{
  vec3 groundAt = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
  vec2 p = groundAt.xz + uGroundPan;
  vGroundWorld = p;
  float far = smoothstep( 700.0, 1600.0, distance( groundAt, cameraPosition ) );
  float patchValue = groundNoise( p / 288.0, 128.0, 11.0 ) * 0.65 + groundNoise( p / 96.0, 384.0, 12.0 ) * 0.35;
  // Value noise rarely leaves 0.3-0.7: stretched so the patches reach their full range.
  float red = mix( clamp( ( patchValue - 0.5 ) * 3.2, -1.0, 1.0 ), 0.0, far );
  vec3 tint = vec3( 1.0 ) + red * vec3( 0.03, -0.06, -0.16 );
  float crust = smoothstep( 0.64, 0.84, groundNoise( p / 144.0, 256.0, 13.0 ) ) * ( 1.0 - far );
  tint = mix( tint, vec3( 1.08, 1.07, 1.02 ), crust * 0.8 );
${
  crests
    ? `  float crest = clamp( aTerrainDetail / 0.45, -1.0, 1.0 ) * ( 1.0 - crust );
  tint *= vec3( 1.0 ) + crest * vec3( 0.035, 0.035, 0.02 ) - max( -crest, 0.0 ) * vec3( 0.0, 0.02, 0.05 );`
    : ''
}
  vGroundTint = tint;
  float pebbles = smoothstep( 0.3, 0.85, groundNoise( p / 48.0, 768.0, 14.0 ) );
  float density = mix( mix( 0.07, 0.4, pebbles * pebbles ) * ( 1.0 - 0.8 * crust ), 0.22, far );
  float warp = groundNoise( p / 7.2, 5120.0, 15.0 ) * 7.0;
  float ripples = smoothstep( 0.3, 0.7, groundNoise( p / 72.0, 512.0, 16.0 ) ) * ( 1.0 - crust );
  vGroundSurface = vec3( density, warp, ripples );
}`;

/** Night glitter lattice: one candidate grain per cell, this many metres across. */
const GLITTER_CELL_M = 0.35;
/**
 * Share of cells holding a grain: dense at the eye, sparse far off. Uniform density
 * looked like glitter only in the distance, because perspective packs thousands of
 * cells into the far rows of the screen and leaves the near ground a few grains wide.
 * Grading it by distance evens that out on screen: about two grains a square metre at
 * the wheels, one in four square metres by 30 m.
 */
const GLITTER_OCCUPANCY_NEAR = 0.25;
const GLITTER_OCCUPANCY_FAR = 0.03;
/** A grain's own radius as a share of the cell: 0.012 x 0.35 m, about 4 mm. */
const GLITTER_GRAIN_CELLS = 0.012;

const GROUND_FRAGMENT_PARS = /* glsl */ `
varying vec3 vGroundTint;
varying vec2 vGroundWorld;
varying vec3 vGroundSurface;
uniform float uGlitter;
uniform float uGlitterTime;
float glitterHash( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
float groundStipple( vec2 world, float footprint, float keepBelow ) {
  vec2 cell = floor( world );
  vec2 local = fract( world ) - 0.5;
  if ( comicHash( cell ) > keepBelow ) return 0.0;
  vec2 jitter = vec2( comicHash( cell + 11.3 ), comicHash( cell + 27.7 ) ) - 0.5;
  float radius = 0.05 + comicHash( cell + 3.1 ) * 0.055;
  float d = length( local - jitter * 0.55 );
  float edge = max( footprint, 0.015 );
  return 1.0 - smoothstep( radius - edge, radius + edge, d );
}`;

/**
 * NIGHT GLITTER: the one piece of magic the desert keeps for the dark, when the
 * mirages are gone. Here and there a grain catches the starlight and winks, rose-gold,
 * sea-green or lilac (never the white of the stars above it), each on its own slow beat,
 * the field of them drifting past as the eye moves, the way mica in sand does. Added
 * after lighting, shows where no lamp reaches.
 *
 * A GRAIN IS A POINT OF LIGHT, AND IT HAS TO LAST TO BE SEEN. The first cut drew each
 * grain its true two centimetres and faded it out wherever that fell under a pixel,
 * which from the chase camera was nearly everywhere: nobody saw it. The second floored
 * the world radius at the pixel footprint, and at a grazing angle that footprint is
 * long across the road and short along it, so every grain became a large bright dash.
 * The third measured the disc in PIXELS on each screen axis separately (the fragment's
 * cell offset over its own fwidth) but kept it under a pixel wide, and that wrote the
 * glitter off twice over. A disc smaller than the fragment grid is a lottery: the
 * owning fragment reaches full brightness only when the grain happens to fall on the
 * pixel centre, and off-duty the rest of the time, so the same grain dims and vanishes
 * as the pixel grid slides under it. And the camera term in the beat swept each grain
 * through its wink in 30-80 ms at driving speed — two frames of one pixel, which the
 * eye integrates into the sand. The disc is a whole pixel across now — the fragment that
 * owns a grain is lit in full wherever the grain falls inside it, and the light fades
 * out over the next pixel, so a grain is a point and not a coin — the eye-motion term is
 * a tenth of its old rate, and the peak reads at all (see GLITTER_PEAK). It fades with
 * distance, 55-90 m.
 *
 * Cost: a uniform branch, derivatives taken once outside any divergent branch (they
 * are undefined inside one), one distance test, one arithmetic hash for the cells that
 * hold no grain. Its own hash, not the comic one: `vGroundWorld` runs to tens of
 * kilometres, where a sine hash is garbage.
 */
const GROUND_GLITTER_HOOK = /* glsl */ `
if ( uGlitter > 0.0 ) {
  vec2 grainAt = vGroundWorld / ${GLITTER_CELL_M.toFixed(2)};
  vec2 grainFootprint = max( fwidth( grainAt ), vec2( 1e-4 ) );
  float glitterDist = length( vViewPosition );
  if ( glitterDist < 90.0 ) {
    vec2 grainCell = mod( floor( grainAt ), 4096.0 );
    float grainRoll = glitterHash( grainCell );
    float grainOccupancy = mix( ${GLITTER_OCCUPANCY_NEAR.toFixed(3)}, ${GLITTER_OCCUPANCY_FAR.toFixed(3)}, smoothstep( 3.0, 30.0, glitterDist ) );
    if ( grainRoll > 1.0 - grainOccupancy ) {
      vec2 grainOffset = vec2( glitterHash( grainCell + 5.0 ), glitterHash( grainCell + 9.0 ) ) - 0.5;
      // Two discs, the larger wins: the grain's true few millimetres, which near the
      // eye covers two or three pixels, and a whole pixel on each screen axis (the
      // offset over its own footprint), which keeps a distant grain a point instead of a
      // dash and lights the fragment that owns it in full wherever the grain falls
      // inside it — the sub-pixel phase is what used to flicker a glint into noise.
      vec2 grainOff = fract( grainAt ) - 0.5 - grainOffset * 0.6;
      vec2 grainPx = grainOff / grainFootprint;
      float grain = max(
        1.0 - smoothstep( 0.55, 1.1, length( grainPx ) ),
        1.0 - smoothstep( ${(GLITTER_GRAIN_CELLS * 0.4).toFixed(4)}, ${GLITTER_GRAIN_CELLS.toFixed(4)}, length( grainOff ) )
      );
      float beat = sin( uGlitterTime * ( 0.7 + grainRoll * 2.6 ) + grainRoll * 91.0
        + dot( cameraPosition.xz, vec2( 0.9, 1.3 ) ) * ( 0.08 + 0.06 * glitterHash( grainCell + 2.0 ) ) );
      float wink = pow( max( beat, 0.0 ), 8.0 );
      // Coloured the way sand's own crystals are, and nothing like the stars above:
      // rose-gold, sea-green and lilac, never white.
      float hue = glitterHash( grainCell + 4.0 );
      vec3 grainColour = hue < 0.45 ? vec3( 1.0, 0.62, 0.42 ) : hue < 0.8 ? vec3( 0.42, 0.95, 0.78 ) : vec3( 0.78, 0.5, 1.0 );
      outgoingLight += grainColour * grain * wink * uGlitter * ( 1.0 - smoothstep( 55.0, 90.0, glitterDist ) );
    }
  }
}
#include <opaque_fragment>`;

/** Night glitter's two uniforms, shared by every desert ground material. */
const glitterUniforms = {
  uGlitter: { value: 0 },
  uGlitterTime: { value: 0 },
};
/**
 * Peak added radiance of one winking grain at full night (linear, before tone mapping).
 *
 * THE NUMBER IS SET BY THE PIXEL, like `NIGHT_FILL_INTENSITY`, and measured in the game,
 * not predicted from the tone curve: a grain spends most of its beat below its peak,
 * lands on part of a pixel, and the canvas is resampled to the display. From the chase
 * camera at midnight, 0.3 left the brightest glint in a frame at about 60 of 255 and no
 * pixel over 100, a speck the owner still could not find. 0.8 puts the brightest at
 * 130-140, a couple of dozen pixels a frame over 100 and a couple of hundred over 40,
 * against sand at 6: points of light, still one grain per half square metre near the
 * eye, so it is a starfield on the sand and not a carpet of light.
 */
const GLITTER_PEAK = 0.8;

/**
 * Per rendered frame: the glitter comes up as the day goes (`dayFactor` from the sky),
 * and dims on wet sand and in blowing dust, which have no dry grains to catch light.
 */
export function advanceDesertGlitter(dt: number, dayFactor: number): void {
  glitterUniforms.uGlitterTime.value = (glitterUniforms.uGlitterTime.value + dt) % 3600;
  const night = 1 - Math.min(1, Math.max(0, dayFactor / 0.35));
  glitterUniforms.uGlitter.value =
    GLITTER_PEAK * night * night * (1 - 0.8 * weather.wet) * (1 - weather.dust) * (1 - 0.6 * weather.cloud);
}

const GROUND_COLOR_HOOK = (grit: boolean): string => /* glsl */ `#include <color_fragment>
diffuseColor.rgb *= vGroundTint;
{
  float rippleFade = vGroundSurface.z * ( 1.0 - smoothstep( 14.0, 42.0, length( vViewPosition ) ) );
${grit ? '  rippleFade *= 1.0 - min( 1.0, vShoulderGrit * 2.0 );\n' : ''}  if ( rippleFade > 0.001 ) {
    float phase = dot( vGroundWorld, vec2( -0.5736, 0.8192 ) ) * 11.42 + vGroundSurface.y;
    float alias = 1.0 - smoothstep( 0.7, 1.8, fwidth( phase ) );
    float wave = sin( phase );
    // A ripple is a sharp lit crest and a broad lee, not a sine.
    wave = wave > 0.0 ? wave * wave * wave : 0.45 * wave;
    diffuseColor.rgb *= 1.0 + 0.055 * wave * rippleFade * alias;
  }
}`;

interface DesertGroundOptions {
  /** The tiles' wheel-scale relief, `aTerrainDetail`: fades out far off, tones crests. */
  readonly detail?: boolean;
  /** The road shoulder's grit, `aShoulderGrit`. */
  readonly grit?: boolean;
}

/**
 * Gives a comic, cloud-shadowed ground material the desert surface above (and, on the
 * tiles, their detail fade; on the shoulder, its grit). Chains onto the patches already
 * there, which must include `applyComicShading` and `applyCloudShadow`: the stipple and
 * `uGroundPan` come from them.
 */
export function applyDesertGround(
  material: THREE.MeshStandardMaterial,
  options: DesertGroundOptions = {},
): THREE.MeshStandardMaterial {
  const detail = options.detail === true;
  const grit = options.grit === true;
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.uGlitter = glitterUniforms.uGlitter;
    shader.uniforms.uGlitterTime = glitterUniforms.uGlitterTime;
    let vertex = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\n${detail ? 'attribute float aTerrainDetail;\n' : ''}${
          grit ? 'attribute float aShoulderGrit;\nvarying float vShoulderGrit;\n' : ''
        }${GROUND_VERTEX_PARS}`,
      )
      .replace('#include <worldpos_vertex>', GROUND_VERTEX_HOOK(detail));
    if (detail) {
      vertex = vertex.replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3( position );
float tileDistance = length( ( modelMatrix * vec4( position, 1.0 ) ).xz - cameraPosition.xz );
float detailFade = smoothstep( ${DESERT_TILE_FADE_FULL.toFixed(1)}, ${DESERT_TILE_FADE_GONE.toFixed(1)}, tileDistance );
transformed.y -= aTerrainDetail * detailFade;${grit ? '\nvShoulderGrit = aShoulderGrit;' : ''}`,
      );
    }
    shader.vertexShader = vertex;
    let fragment = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\n${grit ? 'varying float vShoulderGrit;\n' : ''}${GROUND_FRAGMENT_PARS}`,
      )
      .replace('#include <color_fragment>', GROUND_COLOR_HOOK(grit))
      .replace('comicStipple( stippleUv, footprint )', 'groundStipple( stippleUv, footprint, vGroundSurface.x )')
      .replace('#include <opaque_fragment>', GROUND_GLITTER_HOOK);
    if (grit) fragment = fragment.replace('#include <tonemapping_fragment>', SHOULDER_GRIT_FRAGMENT);
    shader.fragmentShader = fragment;
  };
  const previousKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () =>
    `${previousKey.call(material)}:desert-ground-v2${detail ? ':detail-fade-v1' : ''}${grit ? ':shoulder-grit-v1' : ''}`;
  return material;
}

function createTerrainMaterial(options: DesertGroundOptions): THREE.MeshStandardMaterial {
  return applyDesertGround(
    applyCloudShadow(
      applyComicShading(
        new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.93,
          metalness: 0,
        }),
        {
          lightingStrength: 0,
          shadowWarmth: 0,
          reliefShadeStrength: 0.28,
          spotlightNormals: 'smooth',
        },
      ),
    ),
    options,
  );
}
export const TERRAIN_MATERIAL = createTerrainMaterial({});
/** Fine player-centred tiles whose small-scale height relaxes into the vista base. */
export const DESERT_TILE_MATERIAL = createTerrainMaterial({ detail: true });
/** The road shoulder (world/roadmesh.ts): the tile material plus its grit. */
export const DESERT_SHOULDER_MATERIAL = createTerrainMaterial({ detail: true, grit: true });

/**
 * One chunk's terrain, as two grids sharing one vertex buffer: the sparse FIELD
 * LATTICE (geometric rings, `S_STEP` rows) where the height field is actually
 * sampled, followed by the REFINED GRID that draws and collides the near desert off
 * an interpolation of it.
 *
 * The collider is filtered straight out of the drawn triangle list rather than
 * re-derived from the grids, so solid ground cannot disagree with what is on screen
 * about folds, ownership or the corridor quad — every one of those decisions was
 * already made when `index` was written.
 */
interface BuiltTerrain {
  readonly group: THREE.Group;
  readonly geometry: THREE.BufferGeometry;
  /** Interleaved xyz for every vertex of both grids, origin-relative. */
  readonly positions: Float32Array;
  /** Signed lateral offset of the column each vertex sits on. */
  readonly lateralOf: Float32Array;
  /** The drawn triangles: folds, unowned ground and the road quad already removed. */
  readonly index: Uint32Array;
}

/**
 * The field lattice's lateral rings, memoised.
 *
 * A pure function of the constants above — every chunk in every seed has the same
 * ring list — so it is built once and shared rather than rebuilt per chunk. That is
 * also what lets `drawnGroundY` below sit on the exact same rings the builder uses
 * instead of a second list that could drift from it.
 *
 * Geometric — metres at the verge, hundreds at the horizon — with exceptions, because
 * a pure ratio puts rings where nothing needs them and none where something does.
 * Inside `DETAIL_REACH` the spacing is capped so the refined grid has a resolved base
 * to interpolate; across the berm's face it is capped so the escarpment is not two
 * facets wide; and `DETAIL_REACH` and `PHYSICS_LATERAL` are forced in as exact rings,
 * because the refined grid stitches onto the first and the collider ends on the second
 * — both need a shared row of vertices rather than a meeting mid-quad.
 */
let _rings: { magnitudes: number[]; laterals: number[] } | null = null;

export function fieldRings(): { magnitudes: number[]; laterals: number[] } {
  if (_rings) return _rings;
  const magnitudes: number[] = [TERRAIN_INNER];
  let m = CORRIDOR_INNER;
  while (m < NEAR_TERRAIN_REACH) {
    const geometric = m * LATERAL_RATIO - m;
    const cap =
      m < DETAIL_REACH ? DETAIL_RING_CAP
      : m >= BERM_START - BERM_RING_SPACING && m < BERM_CREST ? BERM_RING_SPACING
      : m < BERM_FADE ? BERM_BACK_RING_SPACING
      : OUTER_RING_SPACING;
    let next = Math.min(m + Math.min(geometric, cap), NEAR_TERRAIN_REACH);
    if (m < DETAIL_REACH && next > DETAIL_REACH) next = DETAIL_REACH;
    else if (m < PHYSICS_LATERAL && next > PHYSICS_LATERAL) next = PHYSICS_LATERAL;
    m = next;
    if (m - magnitudes[magnitudes.length - 1]! < 1) break;
    magnitudes.push(m);
  }
  if (magnitudes[magnitudes.length - 1]! < NEAR_TERRAIN_REACH) {
    magnitudes.push(NEAR_TERRAIN_REACH);
  }

  const laterals: number[] = [];
  for (let i = magnitudes.length - 1; i >= 0; i--) laterals.push(-magnitudes[i]!);
  for (let i = 0; i < magnitudes.length; i++) laterals.push(magnitudes[i]!);
  _rings = { magnitudes, laterals };
  return _rings;
}

/**
 * Keeps the fan's fixed ring topology while its near-road columns follow the local
 * asphalt edge. The outer detail seam remains at `DETAIL_REACH`; only its intervening
 * columns compress through a wide stretch, so strips, berm rings and collider counts
 * do not change.
 */
function rowMagnitude(road: Road, s: number, magnitude: number): number {
  const halfWidth = road.halfWidthAt(s);
  if (magnitude < CORRIDOR_INNER) return halfWidth - ROAD_SEAM_OVERLAP;
  if (magnitude >= DETAIL_REACH) return magnitude;
  return halfWidth + (magnitude - CORRIDOR_INNER) * (DETAIL_REACH - halfWidth) / (DETAIL_REACH - CORRIDOR_INNER);
}

/**
 * Desert BASE height at a world position: `Terrain.openBase` with the nearest-branch
 * distance interpolated off the lattice. A pure function of x and z, which is what
 * makes every chunk agree.
 *
 * Base and not `openHeight` because the detail layer belongs to the refined grid
 * alone: sampling it here as well would both alias it onto the 8 m lattice and double
 * it under every refined vertex.
 */
function worldBase(terrain: Terrain, roadDistance: RoadDistance, x: number, z: number): number {
  return terrain.openBase(
    x,
    z,
    roadDistance.distAt(x, z, DIST_LATTICE),
    roadDistance.ownerAt(x, z, DIST_LATTICE),
  );
}

/**
 * Height of ONE field-lattice vertex, and the only place that blend is written.
 *
 * The near-road frame path is cross-faded into the world path over
 * WORLD_HEIGHT_START..FULL. Inside the corridor the road-edge vertex MUST equal the
 * ribbon's own vertex at that exact `s`, which only the frame knows; past 30 m the two
 * paths are the same arithmetic (the berm is zero that close in), so the fade is between
 * values that agree, and it stays as the guarantee that they must.
 * The last term is the seam tuck: terrain overlaps the asphalt edge slightly and
 * samples the same road surface there, biased just under the ribbon so the floating
 * pixel seam closes without a coplanar z-fight.
 */
function fieldHeight(
  road: Road,
  terrain: Terrain,
  roadDistance: RoadDistance,
  s: number,
  lateral: number,
  x: number,
  z: number,
  isApron: boolean,
): number {
  const absLateral = Math.abs(lateral);
  const blend = Math.min(
    1,
    Math.max(0, (absLateral - WORLD_HEIGHT_START) / (WORLD_HEIGHT_FULL - WORLD_HEIGHT_START)),
  );
  const frameWeight = isApron ? 1 : 1 - blend * blend * (3 - 2 * blend);
  let y: number;
  if (frameWeight >= 1) {
    y = terrain.baseFromFrame(x, z, lateral, s);
  } else if (frameWeight <= 0) {
    y = worldBase(terrain, roadDistance, x, z);
  } else {
    const frameY = terrain.baseFromFrame(x, z, lateral, s);
    const world = worldBase(terrain, roadDistance, x, z);
    y = world + (frameY - world) * frameWeight;
  }
  if (!isApron && absLateral <= road.halfWidthAt(s)) y -= ROAD_SEAM_DROP;
  return y;
}

/**
 * Height of the DRAWN GROUND at a road-frame point: what stands on the desert must
 * stand on the mesh, not on the field the mesh chords.
 *
 * The two are not the same surface and the gap is not small. Laterally the rings reach
 * 90 m apart by a couple of hundred metres out, and a chord that long across the dune
 * field misses the field it chords by `A * (2pi/lambda)^2 * W^2/8` — metres. Nothing
 * noticed while the only thing referring to the ground was the ground; a boulder placed
 * at `Terrain.heightAt` hovers or buries itself by that whole error, and THAT is what
 * held the desert scatter to a 42 m band along the road where the rings are still tight.
 *
 * So this reproduces the mesh instead of approximating it: the same memoised rings, the
 * same `fieldHeight` per corner, bilinear between them exactly as the refined grid
 * interpolates, then the detail layer added on top exactly as the refined grid adds it.
 * Inside `DETAIL_REACH` the answer is the refined grid's own surface to within its
 * 2.67 m chord; outside, it is the coarse quad's surface to the bit.
 *
 * Costs four field samples, about 10 us. Anything placing hundreds of these per chunk
 * should reject candidates BEFORE calling it.
 */
export function drawnGroundY(
  road: Road,
  terrain: Terrain,
  roadDistance: RoadDistance,
  s: number,
  lateral: number,
): number {
  const { magnitudes } = fieldRings();
  const absLateral = Math.abs(lateral);
  const side = lateral < 0 ? -1 : 1;

  // Ring bracket. The list is short and ascending, and a linear walk over ~30 entries
  // beats a binary search's branches at this size. Compare against this row's shifted
  // rings, not the narrow-road reference list.
  let ri = 0;
  while (ri < magnitudes.length - 2 && rowMagnitude(road, s, magnitudes[ri + 1]!) < absLateral) ri++;
  const inner = magnitudes[ri]!;
  const outer = magnitudes[ri + 1]!;
  const innerAtS = rowMagnitude(road, s, inner);
  const outerAtS = rowMagnitude(road, s, outer);
  const across = Math.min(1, Math.max(0, (absLateral - innerAtS) / (outerAtS - innerAtS)));

  // Row bracket, on the same absolute S_STEP lattice every chunk shares.
  const row = Math.floor(s / S_STEP) * S_STEP;
  const along = (s - row) / S_STEP;

  // Apron is a per-CHUNK property in the builder, so ask the same question of the
  // chunk this point falls in rather than of the point.
  const chunk = Math.floor(s / CHUNK_LENGTH);
  const isApron = chunk * CHUNK_LENGTH < 0 || (chunk + 1) * CHUNK_LENGTH > road.length;

  let near = 0;
  let far = 0;
  for (let step = 0; step < 2; step++) {
    const rowS = row + step * S_STEP;
    setRowFrame(road, rowS);
    const bx = rowFrame.x;
    const bz = rowFrame.z;
    const dx = rowFrame.lateralX;
    const dz = rowFrame.lateralZ;
    const innerLat = side * rowMagnitude(road, rowS, inner);
    const outerLat = side * rowMagnitude(road, rowS, outer);
    const innerY = fieldHeight(road, terrain, roadDistance, rowS, innerLat, bx + dx * innerLat, bz + dz * innerLat, isApron);
    const outerY = fieldHeight(road, terrain, roadDistance, rowS, outerLat, bx + dx * outerLat, bz + dz * outerLat, isApron);
    const value = innerY + (outerY - innerY) * across;
    if (step === 0) near = value;
    else far = value;
  }

  const p = road.offsetPoint(s, lateral);
  return near + (far - near) * along + terrain.detailAt(p.x, p.z, absLateral, s);
}

export class TerrainMeshProvider implements ChunkProvider {
  readonly id = 'terrain';

  /**
   * The shared nearest-road-distance field. Injected rather than owned, because the
   * vista mesh reads the same one: two independent copies would index the road twice
   * and, worse, could round the same ground differently.
   */
  constructor(private readonly roadDistance: RoadDistance) {}

  build(ctx: ChunkContext): ChunkContent | null {
    // Every chunk owns a full CHUNK_LENGTH span, even outside the road: the
    // negative and past-end chunks are the desert apron. `ctx.sStart`/`ctx.sEnd`
    // are clamped to the road and therefore empty out there, so derive the span
    // from the chunk index instead.
    const sStart = ctx.chunkIndex * CHUNK_LENGTH;
    const sEnd = (ctx.chunkIndex + 1) * CHUNK_LENGTH;

    const built = this.buildVisual(ctx, sStart, sEnd);
    const bodies: RAPIER.RigidBody[] = [];
    const colliders: RAPIER.Collider[] = [];

    if (ctx.hasPhysics) {
      this.addCollider(ctx, built, bodies, colliders);
    }

    return { group: built.group, bodies, colliders, dispose: () => built.geometry.dispose() };
  }

  private buildVisual(ctx: ChunkContext, sStart: number, sEnd: number): BuiltTerrain {
    const { road, terrain } = ctx;
    // The floating origin, frozen at build time: every height and surface sample
    // below stays absolute, and the subtraction happens only where a coordinate is
    // written into f32.
    const ox = ctx.originX;
    const oz = ctx.originZ;

    const isApron = sStart < 0 || sEnd > road.length;

    const { magnitudes, laterals } = fieldRings();

    const sCount = Math.round((sEnd - sStart) / S_STEP) + 1;
    const latCount = laterals.length;
    const fieldCount = sCount * latCount;

    // The refined grid's own columns run from the road edge out to `DETAIL_REACH`,
    // with the spacing divided evenly into the span rather than stepped off the edge,
    // which would leave a sliver column at the far end. Its innermost column shares
    // the field lattice's reference ring, then each row shifts that ring to its real
    // shoulder while the fixed outer seam stays at 80 m.
    const fineSteps = Math.round((DETAIL_REACH - CORRIDOR_INNER) / FINE_STEP);
    const fineSpacing = (DETAIL_REACH - CORRIDOR_INNER) / fineSteps;
    const fineMagnitudes: number[] = [TERRAIN_INNER];
    for (let i = 1; i < fineSteps; i++) fineMagnitudes.push(CORRIDOR_INNER + i * fineSpacing);
    // Assigned, not accumulated: `CORRIDOR_INNER + fineSteps * fineSpacing` lands an
    // ulp off 80, and an outermost column an ulp outside the ring it is supposed to BE
    // is a column with no ring to reproduce.
    fineMagnitudes.push(DETAIL_REACH);

    const fineLaterals: number[] = [];
    for (let i = fineMagnitudes.length - 1; i >= 0; i--) fineLaterals.push(-fineMagnitudes[i]!);
    for (let i = 0; i < fineMagnitudes.length; i++) fineLaterals.push(fineMagnitudes[i]!);
    const fineCount = fineLaterals.length;
    const fineRows = (sCount - 1) * FINE_SUBDIVISIONS + 1;

    const vertexCount = fieldCount + fineRows * fineCount;
    const positions = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);
    const lateralOf = new Float32Array(vertexCount);

    for (let si = 0; si < sCount; si++) {
      const s = sStart + si * S_STEP;
      // Palette colour is a function of arclength alone, so sample it once per
      // row and reuse it across every lateral column. Neighbouring chunks share
      // the seam row's colour, and a chunk rebuilt after unloading is identical.
      const palette = desertPaletteAt(s);
      sandLinear.setHex(palette.sand);
      setRowFrame(road, s);
      const originX = rowFrame.x;
      const originZ = rowFrame.z;
      const stepX = rowFrame.lateralX;
      const stepZ = rowFrame.lateralZ;
      // Every vertex in the row already knows its own lateral offset, so the terrain
      // never has to project back to the centreline to find its frame.
      for (let li = 0; li < latCount; li++) {
        const lateral = Math.sign(laterals[li]!) * rowMagnitude(road, s, Math.abs(laterals[li]!));
        const px = originX + stepX * lateral;
        const pz = originZ + stepZ * lateral;
        const vi = si * latCount + li;
        const y = fieldHeight(road, terrain, this.roadDistance, s, lateral, px, pz, isApron);
        positions[vi * 3] = px - ox;
        positions[vi * 3 + 1] = y;
        positions[vi * 3 + 2] = pz - oz;
        lateralOf[vi] = lateral;

        // Visual desert is one consistently lit sand colour. Surface classification
        // remains in Terrain for tyre grip and spray, but painting gravel verges and
        // outcrops darker made them read as the shadow patches reported in play.
        colors[vi * 3] = sandLinear.r;
        colors[vi * 3 + 1] = sandLinear.g;
        colors[vi * 3 + 2] = sandLinear.b;
      }
    }

    /**
     * Mark cells whose road-normal parameterisation is still one-to-one.
     *
     * The tangent is measured at the corridor midpoint (average of the ±inner
     * rings). At every lateral column, the longitudinal edge must point broadly in
     * that same direction and stay within a bounded multiple of its length. Once an
     * inside offset reaches its curvature cusp the dot becomes negative; a far
     * outside edge can instead become hundreds of metres long. Either means the
     * cell is a fold, not terrain, and must have no triangles.
     */
    const validCells = new Uint8Array((sCount - 1) * (latCount - 1));
    const leftCentre = magnitudes.length - 1;
    const rightCentre = magnitudes.length;
    // Read back absolute x/z. Positions are origin-relative, while the fold test
    // reasons about world geometry; re-adding the origin keeps it invariant across
    // floating-origin rebases.
    const xz = (vi: number): readonly [number, number] => [
      positions[vi * 3]! + ox,
      positions[vi * 3 + 2]! + oz,
    ];

    for (let si = 0; si < sCount - 1; si++) {
      const row0 = si * latCount;
      const row1 = row0 + latCount;
      const lc0 = xz(row0 + leftCentre);
      const rc0 = xz(row0 + rightCentre);
      const lc1 = xz(row1 + leftCentre);
      const rc1 = xz(row1 + rightCentre);
      const tx = (lc1[0] + rc1[0] - lc0[0] - rc0[0]) * 0.5;
      const tz = (lc1[1] + rc1[1] - lc0[1] - rc0[1]) * 0.5;
      const centreLength = Math.hypot(tx, tz);

      const edgeValid = (li: number): boolean => {
        const a = xz(row0 + li);
        const b = xz(row1 + li);
        const ex = b[0] - a[0];
        const ez = b[1] - a[1];
        const length = Math.hypot(ex, ez);
        if (centreLength < 1e-6 || length < 1e-6) return false;
        const forwardCos = (ex * tx + ez * tz) / (length * centreLength);
        return (
          forwardCos >= FOLD_MIN_FORWARD_COS &&
          length <= centreLength * FOLD_MAX_EDGE_RATIO
        );
      };

      for (let li = 0; li < latCount - 1; li++) {
        if (!isApron && !(edgeValid(li) && edgeValid(li + 1))) continue;
        validCells[si * (latCount - 1) + li] = 1;
      }
    }

    /**
     * Where each refined column and row sits in the field lattice: the pair of rings
     * (or rows) it lies between and how far across. Computed once, because every
     * refined vertex in a column shares its column bracket and every one in a row
     * shares its row bracket — which is what reduces a refined vertex to four loads
     * and three lerps.
     *
     * Both lists ascend, so one walk finds every bracket. A refined column landing
     * exactly on a ring gets weight 1 on that ring, and `a + (b - a) * 1` recovers `b`
     * exactly in floating point — which is what makes the outermost refined column
     * reproduce the coarse vertex it stitches to bit for bit, and the seam watertight.
     */
    const columnLow = new Int32Array(fineCount);
    const columnWeight = new Float64Array(fineCount);
    for (let c = 0, li = 0; c < fineCount; c++) {
      const lateral = fineLaterals[c]!;
      while (li < latCount - 2 && laterals[li + 1]! < lateral) li++;
      const span = laterals[li + 1]! - laterals[li]!;
      columnLow[c] = li;
      columnWeight[c] = span > 0 ? Math.min(1, Math.max(0, (lateral - laterals[li]!) / span)) : 0;
    }

    // Which field cell each refined cell inherits its validity from. Folding and
    // ownership are questions about an 8 m patch of ground answered off a 50 m
    // distance lattice, so re-asking them per refined cell would multiply the one
    // genuinely expensive part of the cell loop by sixteen and change no answer.
    const cellColumn = new Int32Array(fineCount > 0 ? fineCount - 1 : 0);
    for (let c = 0, li = 0; c + 1 < fineCount; c++) {
      const mid = (fineLaterals[c]! + fineLaterals[c + 1]!) * 0.5;
      while (li < latCount - 2 && laterals[li + 1]! <= mid) li++;
      cellColumn[c] = li;
    }

    // Row brackets, straight out of the integer subdivision rather than divided back
    // out of a distance: every FINE_SUBDIVISIONS-th refined row is a field row, gets
    // weight 0 on it, and reproduces it exactly.
    const rowLow = new Int32Array(fineRows);
    const rowWeight = new Float64Array(fineRows);
    for (let j = 0; j < fineRows; j++) {
      const low = Math.min(sCount - 2, Math.floor(j / FINE_SUBDIVISIONS));
      rowLow[j] = low;
      rowWeight[j] = (j - low * FINE_SUBDIVISIONS) / FINE_SUBDIVISIONS;
    }

    // X AND Z ARE INTERPOLATED TOO, not re-derived from the road frame, and that is the
    // second half of the seam contract. A refined column follows the curved offset line
    // if its positions come from `setRowFrame`, while the coarse edge it stitches to is
    // the straight chord between two field rows — so on a 170 m corner the two part
    // company by the chord's sagitta, about 11 mm, and leave a hairline slot in the
    // ground and in the collider. Interpolating position makes the refined grid a
    // subdivision of the field quads rather than a resampling of the road, which is
    // watertight by construction; the 11 mm of curve fidelity it gives up over an 8 m
    // span is invisible and was never in the coarse mesh either.
    for (let j = 0; j < fineRows; j++) {
      const frameS = sStart + j * FINE_STEP;
      const palette = desertPaletteAt(frameS);
      sandLinear.setHex(palette.sand);
      const nearRow = rowLow[j]! * latCount;
      const farRow = nearRow + latCount;
      const alongWeight = rowWeight[j]!;
      const rowBase = fieldCount + j * fineCount;
      for (let c = 0; c < fineCount; c++) {
        const lateral = Math.sign(fineLaterals[c]!) * rowMagnitude(road, frameS, Math.abs(fineLaterals[c]!));
        const low = columnLow[c]!;
        const across = columnWeight[c]!;
        const nearInner = (nearRow + low) * 3;
        const nearOuter = (nearRow + low + 1) * 3;
        const farInner = (farRow + low) * 3;
        const farOuter = (farRow + low + 1) * 3;

        const vi = rowBase + c;
        const x =
          bilinear(positions, nearInner, nearOuter, farInner, farOuter, across, alongWeight);
        const y =
          bilinear(positions, nearInner + 1, nearOuter + 1, farInner + 1, farOuter + 1, across, alongWeight);
        const z =
          bilinear(positions, nearInner + 2, nearOuter + 2, farInner + 2, farOuter + 2, across, alongWeight);
        const px = x + ox;
        const pz = z + oz;
        positions[vi * 3] = x;
        // The height alone carries the detail layer, and it is added AFTER the
        // interpolation: interpolating a coarsely sampled detail term is what aliases
        // it, which is the whole reason this grid exists.
        positions[vi * 3 + 1] = y + terrain.detailAt(px, pz, Math.abs(lateral), frameS);
        positions[vi * 3 + 2] = z;
        lateralOf[vi] = lateral;

        colors[vi * 3] = sandLinear.r;
        colors[vi * 3 + 1] = sandLinear.g;
        colors[vi * 3 + 2] = sandLinear.b;
      }
    }

    // Index only valid cells. The single quad spanning the road is also skipped
    // in-range, where the road mesh owns it; the apron has no road, so it is filled.
    // Everything inside `DETAIL_REACH` is left to the refined grid, so the two never
    // draw the same ground — and because DETAIL_REACH is a forced ring, "inside" is an
    // exact test on both of a cell's edges rather than a straddle.
    const maxTriangles =
      (sCount - 1) * (latCount - 1) * 2 + (fineRows - 1) * (fineCount - 1) * 2;
    const index = new Uint32Array(maxTriangles * 3);
    let written = 0;
    for (let si = 0; si < sCount - 1; si++) {
      for (let li = 0; li < latCount - 1; li++) {
        if (validCells[si * (latCount - 1) + li] === 0) continue;
        const here = laterals[li]!;
        const next = laterals[li + 1]!;
        if (Math.abs(here) <= DETAIL_REACH && Math.abs(next) <= DETAIL_REACH) continue;

        const a = si * latCount + li;
        const b = a + latCount;
        const c = a + 1;
        const d = b + 1;
        index[written++] = a;
        index[written++] = b;
        index[written++] = c;
        index[written++] = b;
        index[written++] = d;
        index[written++] = c;
      }
    }
    for (let j = 0; j + 1 < fineRows; j++) {
      const validRow = rowLow[j]! * (latCount - 1);
      const rowBase = fieldCount + j * fineCount;
      for (let c = 0; c + 1 < fineCount; c++) {
        if (validCells[validRow + cellColumn[c]!] === 0) continue;
        const here = fineLaterals[c]!;
        const next = fineLaterals[c + 1]!;
        if (!isApron && here < 0 && next > 0) continue;

        const a = rowBase + c;
        const b = a + fineCount;
        const cc = a + 1;
        const d = b + 1;
        index[written++] = a;
        index[written++] = b;
        index[written++] = cc;
        index[written++] = b;
        index[written++] = d;
        index[written++] = cc;
      }
    }
    const drawn = index.subarray(0, written);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(drawn, 1));
    // Real slope normals are necessary for broad dunes to retain their volume once
    // their silhouette is below the horizon. The mesh does not cast or receive the
    // sun shadow map, so these normals produce only honest directional lighting.
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, TERRAIN_MATERIAL);
    // The shadow-map frustum moves with the camera. Receiving it made its edge read
    // as kilometre-scale dark plates across otherwise sunlit sand, so terrain uses
    // its direct/hemisphere light uniformly instead.
    mesh.receiveShadow = false;
    const group = new THREE.Group();
    group.add(mesh);

    return {
      group,
      geometry,
      positions,
      lateralOf,
      index: drawn,
    };
  }

  /**
   * Solid ground: the drawn triangles that lie inside `PHYSICS_LATERAL`.
   *
   * Filtering the DRAWN list is the whole trick. The collider costs no extra terrain
   * sampling (the expensive part is already paid), and it cannot disagree with what is
   * on screen about folds, ownership, the corridor quad or the refined grid, because it
   * never re-decides any of them — it only drops what is too far out to stand on. The
   * previous axis-aligned heightfield sampled the terrain a second time on its own 2 m
   * lattice, which cost more than the mesh and still only reached 60 m.
   */
  private addCollider(
    ctx: ChunkContext,
    built: BuiltTerrain,
    bodies: RAPIER.RigidBody[],
    colliders: RAPIER.Collider[],
  ): void {
    const { positions, lateralOf, index } = built;

    // Compact the kept triangles' vertices into their own array. Handing Rapier the
    // whole buffer and indexing only part of it looks tempting, but a trimesh's AABB
    // spans every vertex it was given: the collider would claim a kilometres-wide box
    // in the broad phase and every query in the world would test against it. Measured:
    // 32 ms/frame with the full array, 14 ms with this copy.
    const remap = new Int32Array(positions.length / 3).fill(-1);
    const kept = new Uint32Array(index.length);
    let written = 0;
    let used = 0;
    for (let t = 0; t + 2 < index.length; t += 3) {
      const a = index[t]!;
      const b = index[t + 1]!;
      const c = index[t + 2]!;
      if (
        Math.abs(lateralOf[a]!) > PHYSICS_LATERAL ||
        Math.abs(lateralOf[b]!) > PHYSICS_LATERAL ||
        Math.abs(lateralOf[c]!) > PHYSICS_LATERAL
      ) {
        continue;
      }
      if (remap[a]! < 0) remap[a] = used++;
      if (remap[b]! < 0) remap[b] = used++;
      if (remap[c]! < 0) remap[c] = used++;
      kept[written++] = remap[a]!;
      kept[written++] = remap[b]!;
      kept[written++] = remap[c]!;
    }
    if (written === 0) return;

    const vertices = new Float32Array(used * 3);
    for (let v = 0; v < remap.length; v++) {
      const dst = remap[v]!;
      if (dst < 0) continue;
      vertices[dst * 3] = positions[v * 3]!;
      vertices[dst * 3 + 1] = positions[v * 3 + 1]!;
      vertices[dst * 3 + 2] = positions[v * 3 + 2]!;
    }

    // `vertices` is copied verbatim from the already-relative `positions` above, so
    // the trimesh receives origin-relative vertices — no second subtraction here.
    const collider = ctx.physics.addStaticTrimesh(
      vertices,
      kept.subarray(0, written),
      TERRAIN_COLLIDER_SURFACE,
    );
    colliders.push(collider);
    const body = collider.parent();
    if (body) bodies.push(body);
  }
}
