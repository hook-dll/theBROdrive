import * as THREE from 'three';
import type { WebGLProgramParametersWithUniforms } from 'three';
import type { LookPalette } from '../../world/look/palette';

/**
 * THE WORLD'S LIGHTING, FOR EVERY GROUND AND FOLIAGE MATERIAL.
 *
 * slowroads' terrain look is not a shader so much as four cheap lies, and this module
 * is those four lies in one place, so that the tiles (stage 2), the grass and bushes
 * (stage 3), the trees (stage 4) and the road (stage 5) all tell them the same way:
 *
 *  1. BAKED SHADE. A per-vertex shade value (a wood's own shadow, its canopy density,
 *     the litter under it) cuts the DIRECT light completely and takes only a quarter
 *     off the sky's fill. A shadow that dims everything equally reads as dirt; a
 *     shadow that cuts the sun and leaves the sky reads as shade, and it is what makes
 *     a forest floor look like a forest floor at any distance, for no cost per frame.
 *     Stage 2 bakes the value into the tile vertices; until then the terrain reads it
 *     from the ground weights it already carries.
 *  2. GRAZING SHEEN. A surface seen edge-on glows; one facing the eye darkens by up to
 *     half. Flat countryside has no specular to speak of, and without this its hills
 *     are a single shade from the camera to the horizon — the reference frames' "velvet
 *     hills" are this term, not a light.
 *  3. RADIANCE. Sunlit surfaces gain a little more than their albedo can explain:
 *     `direct * (1 + radiance * albedo)`. It raises the contrast between sunlit and
 *     shaded ground without touching the shadow map or the ambient, which is the only
 *     way to keep a sunlit meadow bright while the wood beside it stays dark under a
 *     tone curve that rolls highlights off early.
 *  4. THE FILL'S OWN SHAPE. Land is flat and the sky is not, so the fill is a
 *     hemisphere: sky above, ground bounce below (scene lights, from the palette), and
 *     under a canopy the fill leans green — stage 4's business, and it will read the
 *     same uniforms.
 *
 * WHAT IT IS NOT. No specular, no PBR, no new lighting model: the materials stay stock
 * `MeshStandardMaterial`s so that fog, shadows, the sun's colour and the tone mapping
 * keep working, and the patch edits what reaches `outgoingLight`.
 *
 * HOW IT IS APPLIED. `onBeforeCompile`, chaining onto whatever patch is already there
 * (`applyComicShading`, `applyCloudShadow`, `applyGroundPaint` all do the same), and
 * injecting at two points that every MeshStandard shader has and that those patches do
 * not themselves replace: `<lights_physical_fragment>` for the albedo, and
 * `<opaque_fragment>` for the composed light. Doing it this way — rather than by
 * surgery on three's `lights_fragment_begin` — is what keeps it composing with them.
 *
 * The strengths are live and shared: `setWorldLighting` writes one set of uniforms per
 * frame for every material wearing the patch.
 */

/**
 * Shared uniform values. Module-level objects handed to every patched material, so one
 * write per frame reaches the whole world — the same reason
 * `render/cloudshadow.ts` keeps its field this way.
 */
const uniforms: Record<string, THREE.IUniform> = {
  uWorldFresnel: { value: 0.55 },
  uWorldRadiance: { value: 1.5 },
  uWorldShadowFactor: { value: 0.85 },
};

/**
 * This frame's strengths, from the look palette.
 *
 * `shadowFactor` is the share of the baked shade that applies: zero disables the term
 * outright, which is what a material with nothing baked into it wants.
 */
export function setWorldLighting(palette: LookPalette): void {
  (uniforms.uWorldFresnel!.value as number) = palette.fresnel;
  (uniforms.uWorldRadiance!.value as number) = palette.radiance;
  (uniforms.uWorldShadowFactor!.value as number) = palette.shadowFactor;
}

/** The GLSL the patch needs, in one place so every consumer sees the same maths. */
const WORLD_LIGHT_PARS = /* glsl */ `
uniform float uWorldFresnel;
uniform float uWorldRadiance;
uniform float uWorldShadowFactor;
`;

/**
 * The grazing sheen, applied to the ALBEDO before the lights run.
 *
 * slowroads' numbers, kept because they are the look: the glow is a quartic shoulder
 * that only bites in the last quarter towards the view direction (a surface grazing the
 * eye), and the darkening saturates at a quarter to a half. Scaling the albedo rather
 * than the light means a sunlit slope and a shaded one change together, so nothing
 * clips.
 */
const WORLD_FRESNEL_HOOK = /* glsl */ `
#include <lights_physical_fragment>
{
	// The surface's own facing: 0 grazes the eye, 1 faces it square.
	float wlFacing = 1.0 - clamp( dot( normalize( normal ), normalize( vViewPosition ) ), 0.0, 1.0 );
	if ( uWorldFresnel > 0.0 ) {
		float wlGlow = max( 0.0, wlFacing - 0.75 ) * 4.0;
		wlGlow *= wlGlow * uWorldFresnel;
		float wlDark = 1.0 - min( 1.0, wlFacing * 1.3333 );
		wlDark = 0.25 + min( 0.25, max( 0.0, wlDark * uWorldFresnel - 0.25 ) * 0.5 );
		diffuseColor.rgb *= 1.0 + wlGlow - wlDark;
	}
}
`;

interface WorldLightingOptions {
  /**
   * GLSL expression for the baked shade, 0 unshaded .. 1 in the deep of a wood.
   * Anything the shader already has in scope may be used (`vGround.z` on the tiles).
   */
  readonly shade?: string;
  /** How much of the hole to cut. Overridden per frame by the palette's shadowFactor. */
  readonly shadeStrength?: number;
}

const patched = new WeakSet<THREE.Material>();

/**
 * Gives one material the world lighting patch. Returns the same material, so it can be
 * wrapped around a construction expression. Idempotent; chains onto existing patches.
 */
export function applyWorldLighting(
  material: THREE.MeshStandardMaterial,
  options: WorldLightingOptions = {},
): THREE.MeshStandardMaterial {
  if (patched.has(material)) return material;
  patched.add(material);

  const shade = options.shade ?? '0.0';
  const strength = options.shadeStrength ?? 1;

  const previousCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => {
    previousCompile.call(material, shader, renderer);
    for (const [name, uniform] of Object.entries(uniforms)) shader.uniforms[name] = uniform;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${WORLD_LIGHT_PARS}`)
      .replace('#include <lights_physical_fragment>', WORLD_FRESNEL_HOOK)
      .replace(
        '#include <opaque_fragment>',
        `${worldLightHook(shade, strength)}\n#include <opaque_fragment>`,
      );
  };

  const previousKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () => `${previousKey.call(material)}:world-light-v1`;
  return material;
}

/** The composed-light end of the patch, with the material's own shade expression. */
function worldLightHook(shade: string, strength: number): string {
  return `{
	// Baked shade: the sun does not reach under a canopy, and only a quarter of the sky
	// does. Cutting direct light fully and the fill by a fraction is the difference
	// between shade and a grey stain; it is also why a wood is dark and still green.
	float wlShade = clamp( ( ${shade} ) * ${strength.toFixed(3)} * uWorldShadowFactor, 0.0, 1.0 );
	outgoingLight -= reflectedLight.directDiffuse * wlShade;
	outgoingLight -= reflectedLight.indirectDiffuse * ( 0.75 - min( wlShade, 0.75 ) );

	// Radiant sun: direct light only, scaled by the surface's own albedo, so nothing
	// glows at night, nothing glows in shade, and a pale field gains more than a dark
	// wood — which is the contrast the reference frames have.
	outgoingLight += reflectedLight.directDiffuse * ( uWorldRadiance * diffuseColor.rgb );
}`;
}
