/**
 * The frame's display transform, which the fullscreen pass applies once
 * (core/renderer.ts `drawFrame`, render/hazeshader.ts `toDisplay`): scene radiance times
 * `SCENE_EXPOSURE`, the tone curve below, the sRGB encode.
 */
export const SCENE_EXPOSURE = 1;

/**
 * `displayCurve(radiance)`: the Khronos PBR Neutral shoulder without its toe.
 *
 * Chosen by screenshots against Three's ACES, AgX and full Neutral. Neutral shows an
 * authored sRGB colour under unit light as that colour and only rolls off what is
 * brighter, so the sand, the paint and the sky keep their hue, where ACES pushed sunlit
 * sand toward yellow-white and AgX greyed the desert. Its toe is the part left out: it
 * lowers every channel by an offset set by the darkest one, which turned dusk and night
 * into saturated blue roads and magenta lamp pools. Below `START` the curve is the
 * identity; above it the peak channel rolls off toward 1 and the colour desaturates a
 * little as it goes, as Neutral's does.
 */
export const DISPLAY_CURVE_GLSL = /* glsl */ `
vec3 displayCurve(vec3 color) {
  const float START = 0.8;
  const float DESATURATION = 0.15;
  color *= ${SCENE_EXPOSURE.toFixed(4)};
  float peak = max(color.r, max(color.g, color.b));
  if (peak < START) return color;
  float d = 1.0 - START;
  float newPeak = 1.0 - d * d / (peak + d - START);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (DESATURATION * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}
`;

/**
 * `sceneFromScreen(code)`: the scene radiance the display transform shows at the given
 * screen value (0..1, sRGB-encoded), for light authored as a SCREEN value rather than as
 * radiance — the catalogue stars and planets, tuned by the pixel they put on the screen.
 * The curve is the identity below its shoulder, and nothing authored this way is that
 * bright, so this is the sRGB decode and the exposure. Needs Three's `sRGBTransferEOTF`,
 * which every non-raw ShaderMaterial has.
 */
export const SCENE_FROM_SCREEN_GLSL = /* glsl */ `
vec3 sceneFromScreen(vec3 code) {
  return sRGBTransferEOTF(vec4(max(code, 0.0), 1.0)).rgb / ${SCENE_EXPOSURE.toFixed(4)};
}
`;
