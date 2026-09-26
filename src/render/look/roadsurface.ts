import * as THREE from 'three';
import type { WebGLProgramParametersWithUniforms } from 'three';
import { SURFACES, SurfaceType } from '../../core/surfaces';
import { TRACK_RUT_HALF_M, TRACK_RUT_OFFSET_M } from '../../world/tracks';
import { applyCloudShadow } from '../cloudshadow';
import { applyGroundSpotlightNormals } from '../comic';
import { applySnowCover, applyWetness } from '../season';
import { maxAnisotropy } from '../texturequality';
import { ASPHALT_STENCIL } from '../wetglints';
import { GROUND_SCALE, groundColourUniforms } from './groundcolor.glsl';
import { GRAVEL_GAIN } from './groundmaterial';
import { groundTextures, imageLoader } from './groundtextures';
import { applyWorldLighting } from './lighting';

/**
 * THE ROAD CORRIDOR, AS PHOTOGRAPHS AND ONE LIGHT — the carriageway, the verge, the
 * paint, the dirt tracks and the stream crossings — in the same shape stage 2 gave the
 * ground (`render/look/groundmaterial.ts`): the CC0 files in `public/look` carry the
 * material, `world/look/palette.ts` carries the colour, and `render/look/lighting.ts`
 * carries the light.
 *
 * WHAT THE PHOTOGRAPH BOUGHT. slowroads' road look is mostly one trick — a base texture
 * whose own ALPHA is a ragged asphalt edge, cut with `alphaTest 0.75` over a
 * gravel-painted verge — and this mesh had none of it: a procedural canvas tile of
 * uniform aggregate ending on a straight polygon edge, weathered per vertex into wheel
 * paths and a dusty rim. `road_asphalt.webp` (tools/look/road.mjs) is the real thing:
 * 24 m of chip seal with polished wheel paths, tar-seamed repairs, a longitudinal crack,
 * and a crumb edge whose 0.75 contour sits about 1.4 % inside the mat. So the mat now
 * ENDS the way a worn one does, into the gravel beneath it, and the per-vertex
 * weathering that used to fake that wear is gone with it.
 *
 * CRUMBING INTO WHAT. The shoulder the road mesh lays either side of the mat
 * (world/roadmesh.ts, from `world/shoulder.ts`) samples `public/look/gravel.webp` — the
 * SAME texture, at the SAME world period and with the SAME per-frame palette tint the
 * tiles use for their own verge gravel (`GROUND_SCALE.gravel`, `uGroundGravel`,
 * `GRAVEL_GAIN`) — so a cut-away asphalt edge reveals the band that was already there.
 * There is one gravel photograph in the world and whichever surface is on top samples it
 * from the world position: that is the whole of "one verge, not two competing bands".
 *
 * ENVIRONMENT REFLECTION IS THE ROAD'S, NOT THE VERGE'S. The saturated blue strip along
 * the mat in winter was `scene.environment` (the sky's own gradient) coming back off a
 * flat, rough surface with no diffuse worth seeing. Everything ground-shaped here — the
 * verge, the tracks, the concrete — now has `envMapIntensity: 0`, exactly as the tiles
 * do. The carriageway keeps it: a wet road mirroring the grey sky is the effect this
 * game already had, and `render/wetglints.ts` lays the lamp streaks on top of it. The
 * wetness patch only lowers the road's roughness while rain is falling on it and the
 * snow is off.
 *
 * WHERE THE COLOUR COMES FROM. The photographs are albedo, not paint, so the palette's
 * per-district surface colour (`core/surfaces.ts`) rides on the vertex as a MULTIPLIER:
 * the tint that takes this texel set to the colour that surface should be. The means
 * below are what the photographs themselves measure at, so a fresh asphalt district
 * lands on its own albedo and a concrete one on a concrete's.
 *
 * EVERYTHING HERE IS LAZY, down to the textures: the headless tools build these
 * materials through the real providers (`tools/surface-paint.ts`), and under Node there
 * is no <img> to decode a webp with, so nothing may be requested at module scope.
 */

/**
 * Metres one repeat of the road photographs covers ALONG the road
 * (public/look/manifest.json). All four road photographs share that layout — u across
 * the carriageway, v along it — which is why one `uv` set serves the asphalt, the snow
 * and both overlays.
 */
export const ROAD_TILE_M = 24;
/**
 * What the u axis was authored against, metres. The carriageway it is mapped onto is
 * narrower (5.8 m for the narrow profile), so the aggregate is stretched a little over
 * a quarter; the alternative — using 7 m of texture and stopping short of the mesh edge
 * — would throw away the ragged edge, which is the whole point of the file.
 */
export const ROAD_SPAN_M = 7;

/**
 * WHAT EACH PHOTOGRAPH IS WORTH, in linear rgb per channel — the mean of the committed
 * file, measured over a 256 px resample with sRGB decoded per channel:
 *
 *   road_asphalt.webp   sRGB 107.1 / 100.9 / 92.4  ->  linear 0.1561 / 0.1378 / 0.1150
 *   gravel.webp         sRGB 109.3 / 103.8 / 93.9  ->  linear 0.1707 / 0.1535 / 0.1255
 *
 * Read as an ALBEDO both are honest figures for the material (asphalt, compacted
 * gravel), which is why the road's brightness may now come from the photograph instead
 * of from a grey canvas divided through its own mean. A district whose palette colour
 * differs from the mean is tinted by that ratio and nothing else about the surface moves.
 */
const ASPHALT_PHOTO_MEAN = { r: 0.1561, g: 0.1378, b: 0.115 };
const GRAVEL_PHOTO_MEAN = { r: 0.1707, g: 0.1535, b: 0.1255 };

/**
 * WHAT THE GRADE TAKES OFF, GIVEN BACK.
 *
 * `core/surfaces.ts`'s colours were authored against a carriageway with no world light
 * patch on it — stage 2's road was lit by the stock Lambert and nothing else — and
 * `render/look/lighting.ts` now cuts 25-30 % off a surface the camera faces (that is the
 * "darker near the camera" half of the fresnel grade, and it is wanted: it is why the
 * road reads as a road going away from you). What it does NOT want to do is put the
 * asphalt below its own palette's level, and measured against the reference frames it
 * did: the near carriageway in `docs/slowroads-steam/img/autumn-day-5s.jpg` measures
 * luma 68 and `autumn-day-20s.jpg` 54, where ours measured 45 in the same view.
 *
 * So every road surface tint is lifted by what the face-on grade costs it. It is one
 * number for the whole corridor, it multiplies the tint and not the palette, and a
 * district still reads at its own colour relative to every other district.
 */
export const ROAD_ALBEDO_LIFT = 1.35;

/**
 * The per-district tint, for every surface the game has.
 *
 * Built from `SURFACES` rather than written out, so `core/surfaces.ts` stays the one
 * place a surface's colour is decided — physics and paint keep reading the same table.
 * A gravel district is paved with `gravel.webp` (the carriageway shader mixes it in), so
 * its tint is stated against that file's mean and not the asphalt's.
 */
export const ROAD_SURFACE_TINT = ((): Record<SurfaceType, THREE.Color> => {
  const out = {} as Record<SurfaceType, THREE.Color>;
  for (const [key, props] of Object.entries(SURFACES)) {
    const surface = Number(key) as SurfaceType;
    const mean = surface === SurfaceType.Gravel ? GRAVEL_PHOTO_MEAN : ASPHALT_PHOTO_MEAN;
    const colour = new THREE.Color(props.color);
    out[surface] = colour.setRGB(
      (colour.r / mean.r) * ROAD_ALBEDO_LIFT,
      (colour.g / mean.g) * ROAD_ALBEDO_LIFT,
      (colour.b / mean.b) * ROAD_ALBEDO_LIFT,
      THREE.NoColorSpace,
    );
  }
  return out;
})();

/**
 * The vertex tint for a surface of a STATED albedo — what the multiplier on the vertex
 * has to be for the carriageway to come out at that albedo through the photograph. The
 * features the director paints (fresh bitumen, laid rubber, drifted sand) are stated as
 * the colour they would be on a road, and this is what turns each into its tint.
 */
export function roadAlbedoTint(albedo: THREE.Color, out: THREE.Color): THREE.Color {
  return out.setRGB(
    (albedo.r / ASPHALT_PHOTO_MEAN.r) * ROAD_ALBEDO_LIFT,
    (albedo.g / ASPHALT_PHOTO_MEAN.g) * ROAD_ALBEDO_LIFT,
    (albedo.b / ASPHALT_PHOTO_MEAN.b) * ROAD_ALBEDO_LIFT,
    THREE.NoColorSpace,
  );
}

/**
 * The roadside canopy density at which the seasonal overlay has taken the road over
 * completely. slowroads gates the same layer on `saturate(vShadow * 3)`.
 */
const OVERLAY_FULL = 3;

/** Roughness of rained-in aggregate, and of a mat that has lost its binder. */
const ROAD_ROUGHNESS = 0.9;
const ROAD_WORN_ROUGHNESS = 0.99;

/**
 * The shoulder ribbon's own level, relative to the gravel photograph, as a bare number
 * the CPU bakes into its vertex colour.
 *
 * The tiles lift their verge gravel by `0.78 + 0.6 w²` (w = their own verge weight,
 * `render/look/groundmaterial.ts`), which is 1.38 at the asphalt's edge — where the
 * shoulder always is. Matching that number is what makes the strip and the band one
 * surface at the hand-over instead of a lit strip beside a flat one.
 */
export const SHOULDER_LEVEL = 1.38;

// ---------------------------------------------------------------------------
// The photographs
// ---------------------------------------------------------------------------

interface RoadTextureSpec {
  /** File under `/look/`. */
  readonly file: string;
  /** What it is, for the one place these are enumerated. */
  readonly role: string;
}

const ROAD_TEXTURE_SPECS = {
  asphalt: { file: 'road_asphalt.webp', role: 'chip-seal carriageway, ragged edge in alpha' },
  snow: { file: 'road_snow.webp', role: 'pressed snow with ruts, ragged edge in alpha' },
  overlaySpring: { file: 'road_overlay_spring.webp', role: 'moss and young grass, coverage in alpha' },
  overlayAutumn: { file: 'road_overlay_autumn.webp', role: 'fallen leaves, coverage in alpha' },
} as const;

export type RoadTextureName = keyof typeof ROAD_TEXTURE_SPECS;
export type RoadTextures = Readonly<Record<RoadTextureName, THREE.Texture>>;

let loaded: RoadTextures | null = null;

/**
 * The road's photographs, loaded on the first request and shared for the life of the
 * session — the same contract as `groundTextures`: the texture object is handed out
 * immediately and the image arrives when it arrives.
 *
 * `wrapS` is CLAMP: u runs across the carriageway exactly once, so a repeat would bleed
 * one ragged edge into the other side of the mat. `wrapT` tiles along the road.
 */
export function roadTextures(): RoadTextures {
  if (loaded) return loaded;
  const loader = imageLoader();
  const out = {} as Record<RoadTextureName, THREE.Texture>;
  for (const [name, spec] of Object.entries(ROAD_TEXTURE_SPECS) as [RoadTextureName, RoadTextureSpec][]) {
    const texture = loader ? loader.load(`/look/${spec.file}`) : new THREE.Texture();
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = maxAnisotropy();
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.name = `road ${name} (${spec.role})`;
    out[name] = texture;
  }
  loaded = out;
  return loaded;
}

// ---------------------------------------------------------------------------
// Shader plumbing
// ---------------------------------------------------------------------------

/** The corridor's own per-vertex block, on the carriageway and nothing else. */
const ROAD_LOOK = 'aRoadLook';
/** The same shade channel alone, for the strips that have no unsealed state. */
const ROAD_SHADE = 'aRoadShade';
const WORLD_VARYING = 'vRoadWorld';

const GRAVEL_PARS = /* glsl */ `
uniform sampler2D uGroundTexGravel;
uniform vec3 uGroundGravel;`;

/** The gravel photograph at the ground's own world period, in metres. */
const GRAVEL_SAMPLE = `texture2D( uGroundTexGravel, ${WORLD_VARYING}.xz / ${GROUND_SCALE.gravel.toFixed(4)} )`;

/** The photograph uniforms a strip needs, pointing at the ground's own texture objects. */
function gravelUniforms(): Record<string, THREE.IUniform> {
  return {
    uGroundTexGravel: { value: groundTextures().gravel },
    uGroundGravel: groundColourUniforms().uGroundGravel!,
  };
}

/**
 * What one corridor fragment body needs declared, and where its vertex plumbing goes.
 *
 * The world position is written in the vertex stage from `transformed` rather than read
 * out of three's own `<worldpos_vertex>`: that chunk only fills `worldPosition` when
 * some other feature asked for it, and the verge's period has to be the world position
 * whether or not a shadow map happens to be on.
 */
interface RoadSurfacePatch {
  readonly vertexPars: string;
  readonly vertexBody: string;
  readonly fragmentPars: string;
  readonly fragmentBody: string;
  /**
   * GLSL for the surface's own wear, 0 fresh .. 1 decayed, when it has one. Only the
   * carriageway does (`aRoadLook.z`); the strips have no decay of their own.
   */
  readonly wear?: string;
}

const WORLD_PARS_VERTEX = `varying vec3 ${WORLD_VARYING};`;
const WORLD_BODY_VERTEX = `${WORLD_VARYING} = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`;

/**
 * THE CARRIAGEWAY. Runs after `<color_fragment>`, so `diffuseColor` already holds the
 * asphalt photograph times the district's tint, and before `<alphatest_fragment>`, so a
 * crumb the snow has not covered still cuts the fragment away.
 */
const ROAD_PATCH: RoadSurfacePatch = {
  vertexPars: `attribute vec3 ${ROAD_LOOK};
varying vec3 vRoadLook;
${WORLD_PARS_VERTEX}`,
  vertexBody: `vRoadLook = ${ROAD_LOOK};
${WORLD_BODY_VERTEX}`,
  fragmentPars: `varying vec3 vRoadLook;
${WORLD_PARS_VERTEX}
uniform sampler2D uRoadSnow;
uniform sampler2D uRoadOverlaySpring;
uniform sampler2D uRoadOverlayAutumn;
${GRAVEL_PARS}`,
  fragmentBody: /* glsl */ `
{
	// --- AN UNSEALED DISTRICT is the same carriageway paved with graded gravel. It is
	// sampled in WORLD metres because the verge beside it is, so a gravel road and its
	// shoulder are one continuous material instead of two bands meeting at the mat's
	// edge. No ragged alpha either: a graded road is spread to its own edge and what it
	// meets there is the same gravel.
	if ( vRoadLook.y > 0.002 ) {
		vec3 roadGravel = ${GRAVEL_SAMPLE}.rgb * vColor.rgb;
		diffuseColor.rgb = mix( diffuseColor.rgb, roadGravel, vRoadLook.y );
		diffuseColor.a = mix( diffuseColor.a, 1.0, vRoadLook.y );
	}
	// --- THE SEASONAL OVERLAY: leaves that have come down in the autumn, moss creeping
	// in from the edges in the spring, and only where the road runs under a canopy —
	// which is what makes it read as litter under trees rather than as a carpet down the
	// middle of a field. slowroads weights the same layer the same way
	// (saturate(vShadow * 3)) and hangs its art on the same edges of the carriageway.
	float roadOverlay = clamp( vRoadLook.x * ${OVERLAY_FULL.toFixed(1)}, 0.0, 1.0 );
	if ( roadOverlay > 0.01 ) {
		if ( uSeasonTurn > 0.01 ) {
			vec4 leaves = texture2D( uRoadOverlayAutumn, vMapUv );
			diffuseColor.rgb = mix( diffuseColor.rgb, leaves.rgb, roadOverlay * leaves.a * uSeasonTurn );
		}
		if ( uSeasonFresh > 0.01 ) {
			vec4 moss = texture2D( uRoadOverlaySpring, vMapUv );
			diffuseColor.rgb = mix(
				diffuseColor.rgb, moss.rgb,
				roadOverlay * moss.a * uSeasonFresh * ( 1.0 - uSeasonTurn )
			);
		}
	}
	// --- PACKED SNOW: the same carriageway under its own winter photograph — pressed
	// snow, two polished ruts, grit and patches worn through to wet asphalt, and the
	// SAME ragged alpha edge, so the mat still crumbles into the verge and the season
	// does not move the road's outline. slowroads swaps the whole base and drops the
	// paint; a continuous snow channel lets this crossfade instead.
	if ( uSeasonSnow > 0.005 ) {
		// The snow photograph brings its own albedo — pressed snow measures 0.46-0.51
		// linear, which is what snow is — so the district's tint comes off with the
		// asphalt it was tinting: a surface colour is a fact about the surface, and under
		// ten centimetres of snow the road's district is not the thing you are looking at.
		vec4 packed = texture2D( uRoadSnow, vMapUv );
		diffuseColor.rgb = mix( diffuseColor.rgb, packed.rgb, uSeasonSnow );
		diffuseColor.a = mix( diffuseColor.a, packed.a, uSeasonSnow );
	}
}`,
  wear: 'vRoadLook.z',
};

/** THE SHOULDER: the ground's own verge band, laid by the road mesh instead of a tile. */
const SHOULDER_PATCH: RoadSurfacePatch = {
  vertexPars: `attribute float ${ROAD_SHADE};
varying float vRoadShade;
${WORLD_PARS_VERTEX}`,
  vertexBody: `vRoadShade = ${ROAD_SHADE};
${WORLD_BODY_VERTEX}`,
  fragmentPars: `varying float vRoadShade;
${WORLD_PARS_VERTEX}
${GRAVEL_PARS}`,
  fragmentBody: /* glsl */ `
{
	// \`vColor\` carries only this strip's own level and mottle: the tint itself comes from
	// the palette once a frame, exactly as the tiles' verge does, so the season moves
	// both together.
	diffuseColor.rgb = ${GRAVEL_SAMPLE}.rgb * uGroundGravel * ${GRAVEL_GAIN.toFixed(3)} * vColor.rgb;
}`,
};

/**
 * THE PAINT. Its wear is the vertex alpha (a chalky coat thin enough in places to show
 * the aggregate through), so the only thing the shader has to say about it is that
 * winter takes it off the road: a snowed carriageway is drawn by its own snow
 * photograph, and slowroads drops the paint maps entirely for the same reason.
 */
const MARKING_PATCH: RoadSurfacePatch = {
  vertexPars: `attribute float ${ROAD_SHADE};
varying float vRoadShade;`,
  vertexBody: `vRoadShade = ${ROAD_SHADE};`,
  fragmentPars: 'varying float vRoadShade;',
  fragmentBody: /* glsl */ `
{
	diffuseColor.a *= 1.0 - smoothstep( 0.1, 0.6, uSeasonSnow );
}`,
};

/**
 * A DIRT TRACK. The ruts are a function of the lateral coordinate rather than a painted
 * texture: a rut is a little over half a metre wide with a soft edge, and neither five
 * vertex columns across a 3.4 m ribbon nor a tiled picture can carry that shape at the
 * distance a track is read from. Nothing is drawn between the ruts or beside them, so
 * the strip of grass down the middle of a Russian dirt road is the ground's own grass.
 */
const TRACK_PATCH: RoadSurfacePatch = {
  vertexPars: `attribute float aTrackLateral;
varying float vTrackLateral;
${WORLD_PARS_VERTEX}`,
  vertexBody: `vTrackLateral = aTrackLateral;
${WORLD_BODY_VERTEX}`,
  fragmentPars: `varying float vTrackLateral;
${WORLD_PARS_VERTEX}
${GRAVEL_PARS}`,
  fragmentBody: /* glsl */ `
{
	// A trough: full coverage at the rut's centre, gone 15 cm outside it, times a slow
	// thinning along the track so the two lines are pressed ground and not two bands.
	float rutLeft = abs( vTrackLateral - ${TRACK_RUT_OFFSET_M.toFixed(3)} ) / ${TRACK_RUT_HALF_M.toFixed(3)};
	float rutRight = abs( vTrackLateral + ${TRACK_RUT_OFFSET_M.toFixed(3)} ) / ${TRACK_RUT_HALF_M.toFixed(3)};
	float rut = max(
		1.0 - smoothstep( 0.35, 1.0, rutLeft ),
		1.0 - smoothstep( 0.35, 1.0, rutRight )
	);
	// Deeper where the ground under it is darker, which is where it is softer: the
	// gravel photograph's own luminance, at its own scale, and no second fetch.
	vec4 trackGround = ${GRAVEL_SAMPLE};
	float trod = dot( trackGround.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
	rut *= clamp( 0.8 + 0.4 * trod, 0.0, 1.0 );
	// Packed and damp in the trough itself, which is what makes a rut read as a rut.
	diffuseColor.rgb = trackGround.rgb * uGroundGravel * ${GRAVEL_GAIN.toFixed(3)} * vColor.rgb * mix( 1.0, 0.86, rut );
	diffuseColor.a = rut * vColor.a;
}`,
};

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

export interface RoadMaterials {
  /** The asphalt ribbon. */
  readonly road: THREE.MeshStandardMaterial;
  /** The dark skirt the mat's open edges are closed down with. */
  readonly bed: THREE.MeshStandardMaterial;
  /** The bare shoulder (`world/shoulder.ts`). */
  readonly shoulder: THREE.MeshStandardMaterial;
  /** The paint, drawn over the carriageway. */
  readonly marking: THREE.MeshStandardMaterial;
  /** A dirt track's rutted ribbon. */
  readonly track: THREE.MeshStandardMaterial;
  /** A bridge deck, a parapet, a culvert headwall. */
  readonly crossing: THREE.MeshStandardMaterial;
}

/**
 * The stencil bit the asphalt and its markings write where they are the visible surface
 * (`render/wetglints.ts` reads it so the lamp streaks land on the road and not across
 * the verge).
 */
function markAsphalt<M extends THREE.Material>(material: M): M {
  material.stencilWrite = true;
  material.stencilRef = ASPHALT_STENCIL;
  material.stencilWriteMask = ASPHALT_STENCIL;
  material.stencilFunc = THREE.AlwaysStencilFunc;
  material.stencilZPass = THREE.ReplaceStencilOp;
  return material;
}

let materials: RoadMaterials | null = null;

/** The corridor's materials, built once and shared by every chunk for the session. */
export function roadMaterials(): RoadMaterials {
  if (materials) return materials;

  const textures = roadTextures();
  const gravel = gravelUniforms();
  const roadUniforms = {
    uRoadSnow: { value: textures.snow },
    uRoadOverlaySpring: { value: textures.overlaySpring },
    uRoadOverlayAutumn: { value: textures.overlayAutumn },
    ...gravel,
  };

  // --- THE CARRIAGEWAY. A stock MeshStandardMaterial, so fog, the sun's colour, the
  // shadow map and the tone curve keep working; the patches do the rest.
  const road = markAsphalt(
    applyWorldLighting(
      applyCloudShadow(
        applyWetness(
          applyGroundSpotlightNormals(
            new THREE.MeshStandardMaterial({
              vertexColors: true,
              map: textures.asphalt,
              // The crumb edge: where the photograph's own alpha drops under three
              // quarters the fragment is discarded and the gravel beneath shows.
              alphaTest: 0.75,
              roughness: ROAD_ROUGHNESS,
              metalness: 0,
              // A wet road mirrors the grey sky. The verge beside it does not — it is
              // ground, and a hemisphere of sky used as a reflection paints it.
              envMapIntensity: 1,
            }),
          ),
          // Rained on: darker by nearly half and glossy, so the sky comes off it. Not
          // when it is snowed over, which the patch already guards for.
          0.44, 0.16,
        ),
      ),
      // Baked shade from the canopy at the road's edge: a forest road is dark under its
      // own trees without a shadow map reaching there.
      //
      // THE WOOD'S OWN CURVE, not the density itself, AND A CEILING ON IT.
      // `aRoadLook.x` is a land cover's wood density — a 1.5 km field, so half this
      // country reads 0.5 of it — and taking it raw put the carriageway of an open road
      // with a treeline on one side 70 % into the shade while the field beside it stayed
      // lit. What shades a road is a canopy that comes out over it: below half density
      // there is none, and by 0.95 the road is in the wood — but even there it keeps
      // six tenths of the sun, because the light that reaches a forest road comes round
      // and through the crowns and not only from a hole in them. Measured against the
      // reference frames, a full cut put the wood's own carriageway at a quarter of the
      // open road's level, where `autumn-day-20s.jpg` is at three quarters of it.
      //
      // The seasonal overlay below still takes the density itself, because a treeline
      // does not shade the road and does drop its leaves on it.
      { shade: 'smoothstep( 0.5, 0.95, vRoadLook.x ) * 0.55' },
    ),
  );
  patchRoadSurface(road, ROAD_PATCH, roadUniforms, 'road');

  // --- THE BED. Seen through the crumb in the last two centimetres of asphalt: damp
  // earth under the mat, not a black outline around it.
  const bed = applyWorldLighting(
    applyCloudShadow(
      applyGroundSpotlightNormals(
        new THREE.MeshStandardMaterial({
          color: 0x3a352c,
          roughness: 1,
          metalness: 0,
          envMapIntensity: 0,
        }),
      ),
    ),
    {},
  );

  // --- THE SHOULDER. Trodden earth and gravel between the asphalt and the grass, lit and
  // tinted exactly as the tiles' own verge band is.
  const shoulder = applyWorldLighting(
    applySnowCover(
      applyWetness(
        applyCloudShadow(
          applyGroundSpotlightNormals(
            new THREE.MeshStandardMaterial({
              vertexColors: true,
              roughness: 0.95,
              metalness: 0,
              envMapIntensity: 0,
              // It lies on the ground a few centimetres up; this keeps it on top where
              // the tiles' interpolation brings them level with it.
              polygonOffset: true,
              // Units only: a slope factor would pull the tucked edge back out.
              polygonOffsetFactor: 0,
              polygonOffsetUnits: -2,
            }),
          ),
        ),
        0.35, null,
      ),
      // Snow lies on the verge as it lies on the open ground beside it, greyer than the
      // drift because it is packed and gritted.
      0.95, 0.9,
    ),
    { shade: 'smoothstep( 0.5, 0.95, vRoadShade ) * 0.55' },
  );
  patchRoadSurface(shoulder, SHOULDER_PATCH, gravel, 'shoulder');

  // --- THE PAINT. Worn, so it is a LAYER with coverage in the vertex alpha rather than
  // an opaque stripe. Transparent and depth-write off: the road under it is already drawn.
  const marking = markAsphalt(
    applyWorldLighting(
      applyCloudShadow(
        applyWetness(
          applyGroundSpotlightNormals(
            new THREE.MeshStandardMaterial({
              vertexColors: true,
              roughness: 0.94,
              metalness: 0,
              envMapIntensity: 0,
              transparent: true,
              depthWrite: false,
              // Flush with the asphalt under a tyre, and lifted in depth so a polygon
              // seam can never print as a hairline of road through the paint.
              polygonOffset: true,
              polygonOffsetFactor: -1,
              polygonOffsetUnits: -1,
            }),
          ),
          0.3, null,
        ),
      ),
      // The paint is no darker than the surface it lies on: the same wood curve, so a
      // line under a treeline stays legible and a line in a wood does not glow.
      { shade: 'smoothstep( 0.5, 0.95, vRoadShade ) * 0.55' },
    ),
  );
  patchRoadSurface(marking, MARKING_PATCH, {}, 'marking');

  // --- A DIRT TRACK. Two ruts pressed into packed ground, with the real ground showing
  // between them and beside them, because the ribbon carries no coverage there at all.
  const track = applyWorldLighting(
    applySnowCover(
      applyWetness(
        applyCloudShadow(
          applyGroundSpotlightNormals(
            new THREE.MeshStandardMaterial({
              vertexColors: true,
              roughness: 0.95,
              metalness: 0,
              envMapIntensity: 0,
              transparent: true,
              alphaToCoverage: true,
              // Both faces: where a track bends hard two rows can cross.
              side: THREE.DoubleSide,
              polygonOffset: true,
              polygonOffsetFactor: -1.5,
              polygonOffsetUnits: -4,
            }),
          ),
        ),
        0.4, null,
      ),
      // Snowed over like the ground the ruts are pressed into, and the ruts stay the
      // darker thing in it, which is what a snowed-in track looks like from the road.
      0.45, 0.8,
    ),
    {},
  );
  patchRoadSurface(track, TRACK_PATCH, gravel, 'track');

  // --- A CROSSING: a concrete deck, a parapet, a culvert headwall. Flat colours rather
  // than a photograph (`world/streamcrossings.ts` writes them per vertex), so all it
  // wants is the world's light and the weather.
  const crossing = applyWorldLighting(
    applySnowCover(
      applyWetness(
        applyCloudShadow(
          new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.92,
            metalness: 0,
            envMapIntensity: 0,
          }),
        ),
        0.25, null,
      ),
      0.5, 0.9,
    ),
    {},
  );

  materials = { road, bed, shoulder, marking, track, crossing };
  return materials;
}

/** The carriageway's shared material (the road lab and the terminus pad draw with it). */
export function roadAsphaltMaterial(): THREE.MeshStandardMaterial {
  return roadMaterials().road;
}

/**
 * Chains one corridor shader body, and the vertex plumbing it needs, onto a material.
 *
 * Applied LAST of its chain on purpose: every patch finds the same `#include` still in
 * place and splices its text immediately after it, so the patch that runs last is the
 * FIRST text after the include — ahead of the others' declarations, which is where a
 * `varying` has to be. It also puts the body before the wetness and snow patches, so
 * those compose over the material this body has just decided.
 */
function patchRoadSurface(
  material: THREE.MeshStandardMaterial,
  patch: RoadSurfacePatch,
  uniforms: Record<string, THREE.IUniform>,
  key: string,
): void {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (
    shader: WebGLProgramParametersWithUniforms,
    renderer: THREE.WebGLRenderer,
  ) => {
    previous.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${patch.vertexPars}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${patch.vertexBody}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${patch.fragmentPars}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${patch.fragmentBody}`);
    if (patch.wear) {
      // A road that has lost its binder grips less, drains worse and scatters more light
      // than one laid last year; the district's own decay is on the vertex, and this is
      // the only place it shows.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = mix( roughnessFactor, ${ROAD_WORN_ROUGHNESS.toFixed(3)}, ${patch.wear} );`,
      );
    }
  };
  const previousKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () => `${previousKey.call(material)}:${key}-v1`;
}
