// ---------------------------------------------------------------------------
// The finishing pass: the scene's linear radiance to the picture on the display.
//
// One fullscreen pass over the scene target and its depth (core/renderer.ts
// `drawFrame`). In order:
//
//   SAMPLING  the scene image, straight or through the cinema lens's Panini
//             projection (`paniniSource`), optionally through FXAA (`fxaaSample`).
//             Every pixel samples its own scene coordinate: nothing in this pass
//             displaces the image.
//
//   WEATHER   on radiance, before the display transform: the approaching haboob wall
//             (`dustWall`), the storm's own dust once inside it, and the near veil of
//             mgla or rain (`uVeil`). All three are driven by world/weather.ts through
//             `Renderer.setWeather` and are off in clear weather. The scene's own fog
//             (render/airfog.ts, the dust storm's FogExp2) is not this pass's.
//
//   DISPLAY   the tone curve and the sRGB encode (`toDisplay`), once; then the grade,
//             the contrast S-curve, the ink, the retro dither and the screen overlays
//             (shades, binoculars, viewfinder) on the displayed picture.
//
// There is no heat haze: no refractive shimmer, no inferior mirage and no daylight
// sand veil over the horizon. The pass reads no heat input at all.
// ---------------------------------------------------------------------------

import { DISPLAY_CURVE_GLSL, SCENE_FROM_SCREEN_GLSL } from './displaytransform';

/**
 * Eye height over the ground assumed before the loop has supplied a real one (a
 * standing player), metres. The dust wall adds it to a ray's climb to place the wall's
 * crest and foot; see `Renderer.setEyeAboveGround`.
 */
export const DEFAULT_EYE_HEIGHT_M = 1.6;

/**
 * Fullscreen triangle: three clip-space vertices, one corner padded to cover the whole
 * frame. `uv` carries the screen UV (0 = bottom, 1 = top).
 */
export const HAZE_VERTEX = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;
export const HAZE_FRAGMENT = /* glsl */ `
  ${DISPLAY_CURVE_GLSL}
  ${SCENE_FROM_SCREEN_GLSL}
  uniform sampler2D tDiffuse;
  uniform sampler2D tDepth;
  uniform vec2 uResolution;
  /**
   * The eye's height over the ground, metres (core/renderer.ts \`setEyeAboveGround\`):
   * the dust wall measures its crest and foot from the ground, its rays from the eye.
   */
  uniform float uEyeAbove;
  uniform mat3 uCameraRotation;
  uniform float uTanHalfFov;
  /**
   * Panini strength d of the cinema lens (core/renderer.ts \`panini\`); 0 is the plain
   * rectilinear frame, and is what every frame outside cinema mode has. The scene is
   * rendered rectilinear; the lens shows it fitted to the same horizontal coverage, so
   * the edges stop stretching and the centre comes up larger. A uniform, not a define:
   * toggling or tuning the lens never builds a program.
   */
  uniform float uPanini;
  uniform float uCameraNear;
  uniform float uCameraFar;
  uniform float uInkStrength;
  uniform float uInkThreshold;
  uniform float uFxaa;
  uniform float uEncodeOutput;
  uniform vec3 uViewTint;
  uniform float uViewTintStrength;
  uniform float uBinoculars;
  uniform float uCameraViewfinder;

  // --- Weather (world/weather.ts) ---
  /** Distance to an approaching haboob wall, metres upwind; negative when none. */
  uniform float uWallM;
  /** Inside a haboob: the dust's density per metre from the camera; 0 outside. */
  uniform float uDustInside;
  /** Unit horizontal direction the wind blows toward (world x, z). */
  uniform vec2 uWindDir;
  /** The camera's absolute position along the wall, reduced to one noise period. */
  uniform float uWallPan;
  uniform float uWallTime;
  /** Direction to the sun, world space; the sun's display colour; the sky's horizon. */
  uniform vec3 uSunDirW;
  uniform vec3 uSunCol;
  uniform vec3 uWallAir;
  /** The dust's own colour: the sand here, carried round the palette (render/desertdust.ts). */
  uniform vec3 uDustAlbedo;
  /** The FogExp2 density the dust storm adds this frame (sky.dustFogDensity). */
  uniform float uFogDensity;
  /** Colour separation of the grade: >1 scrubbed air, <1 haze and dust. */
  uniform float uGradeSat;
  /** The look's display-space S-curve, 0 (none) .. 1 (full smoothstep). */
  uniform float uContrast;
  /**
   * Suspended haze from the first tens of metres out. The scene fog is exponential-
   * squared, which is right for distance and leaves the near world spotless; real
   * mgla or rain takes the contrast off the NEAR ground too, and that flat, milky
   * foreground is most of what makes it read as weather rather than as far fog.
   */
  uniform float uVeil;

  varying vec2 vUv;

  /** Unit view-space direction for a pixel of the rectilinear scene image. */
  vec3 cameraRay(vec2 uv) {
    vec2 ndc = uv * 2.0 - 1.0;
    float aspect = uResolution.x / uResolution.y;
    return normalize(vec3(
      ndc.x * aspect * uTanHalfFov,
      ndc.y * uTanHalfFov,
      -1.0
    ));
  }

  /**
   * Where in the rectilinear scene image a Panini-projected screen pixel looks.
   *
   * The output keeps the frame's full horizontal coverage (the rectilinear edge maps to
   * the screen edge), with one scale for both axes, so the middle of the frame is
   * magnified and the top and bottom lose a little. Inverse of Sharpless' Panini:
   * screen (x, y) -> longitude, latitude -> rectilinear tangent plane.
   */
  vec2 paniniSource(vec2 uv) {
    float aspect = uResolution.x / uResolution.y;
    float tx = uTanHalfFov * aspect;
    float d = uPanini;
    float edge = atan(tx);
    float xMax = (d + 1.0) * sin(edge) / (d + cos(edge));
    float scale = xMax / tx;
    vec2 ndc = uv * 2.0 - 1.0;
    float x = ndc.x * tx * scale;
    float y = ndc.y * uTanHalfFov * scale;
    float k = x * x / ((d + 1.0) * (d + 1.0));
    float dscr = max(0.0, k * k * d * d - (k + 1.0) * (k * d * d - 1.0));
    float clon = (-k * d + sqrt(dscr)) / (k + 1.0);
    float s = (d + 1.0) / (d + clon);
    float lon = atan(x, s * clon);
    float lat = atan(y, s);
    vec2 plane = vec2(tan(lon), tan(lat) / cos(lon));
    return clamp(vec2(plane.x / tx, plane.y / uTanHalfFov) * 0.5 + 0.5, 0.0, 1.0);
  }

  /**
   * Catmull-Rom bicubic sample of the scene in nine bilinear taps. The lens magnifies
   * the centre past the scene target's own texel grid, and a bilinear tap there is a
   * soft picture.
   */
  vec4 sceneSample(sampler2D tex, vec2 uv) {
    vec2 samplePos = uv * uResolution;
    vec2 texPos1 = floor(samplePos - 0.5) + 0.5;
    vec2 f = samplePos - texPos1;
    vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
    vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
    vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
    vec2 w3 = f * f * (-0.5 + 0.5 * f);
    vec2 w12 = w1 + w2;
    vec2 offset12 = w2 / w12;
    vec2 texPos0 = (texPos1 - 1.0) / uResolution;
    vec2 texPos3 = (texPos1 + 2.0) / uResolution;
    vec2 texPos12 = (texPos1 + offset12) / uResolution;
    vec4 result = vec4(0.0);
    result += texture2D(tex, vec2(texPos0.x, texPos0.y)) * w0.x * w0.y;
    result += texture2D(tex, vec2(texPos12.x, texPos0.y)) * w12.x * w0.y;
    result += texture2D(tex, vec2(texPos3.x, texPos0.y)) * w3.x * w0.y;
    result += texture2D(tex, vec2(texPos0.x, texPos12.y)) * w0.x * w12.y;
    result += texture2D(tex, vec2(texPos12.x, texPos12.y)) * w12.x * w12.y;
    result += texture2D(tex, vec2(texPos3.x, texPos12.y)) * w3.x * w12.y;
    result += texture2D(tex, vec2(texPos0.x, texPos3.y)) * w0.x * w3.y;
    result += texture2D(tex, vec2(texPos12.x, texPos3.y)) * w12.x * w3.y;
    result += texture2D(tex, vec2(texPos3.x, texPos3.y)) * w3.x * w3.y;
    // Catmull-Rom overshoots at high-contrast edges; a negative colour channel is meaningless.
    return max(result, vec4(0.0));
  }

  /**
   * The scene's colour at \`uv\`: one bilinear tap, or Catmull-Rom while the lens is on.
   * The retro rung keeps its tap even under the lens: its pixels are the look.
   */
  vec4 sceneTap(vec2 uv) {
    #ifndef RETRO
    if (uPanini > 0.0) return sceneSample(tDiffuse, uv);
    #endif
    return texture2D(tDiffuse, uv);
  }

  /**
   * Scene radiance to the display: the tone curve (render/displaytransform.ts), then
   * the sRGB encode. The scene target is linear HDR (core/renderer.ts
   * \`sceneTargetType\`), and this pass is where the picture is mapped to the display,
   * ONCE, after the dust and the veil have worked on radiance. Everything after it —
   * the grade, the ink, the retro dither — works on the encoded picture the eye sees,
   * and FXAA and the ink measure their steps through it (\`fxaaLuma\`, \`inkEdge\`).
   *
   * \`linearToOutputTexel\` is Three's output encode: sRGB for this pass, drawn to the
   * canvas. \`uEncodeOutput\` puts the sRGB encode back where the renderer draws this
   * pass into its own frame target to shrink it to the screen
   * (render/presentshader.ts): Three treats every render target as linear, and the
   * grade, the ink and the grain after this must see the same encoded picture
   * whichever way the frame leaves.
   */
  vec3 toDisplay(vec3 radiance) {
    vec4 shown = linearToOutputTexel(vec4(displayCurve(radiance), 1.0));
    return uEncodeOutput > 0.5 ? sRGBTransferOETF(shown).rgb : shown.rgb;
  }

  /**
   * The scene's colour at \`uv\` near enough to how the display shows it for measuring a
   * step: FXAA and the ink take thirty taps a pixel, and the exact transform in each
   * cost a tenth of the frame at 3 Mpx. The curve is the identity below its shoulder,
   * and a square root is the sRGB encode within a few code values.
   */
  vec3 displayTap(vec2 uv) {
    return sqrt(clamp(texture2D(tDiffuse, uv).rgb, 0.0, 1.0));
  }

  /** Perspective depth-buffer value converted to negative view-space Z. */
  float perspectiveDepthToViewZ(float depth) {
    return (uCameraNear * uCameraFar) /
      ((uCameraFar - uCameraNear) * depth - uCameraFar);
  }

  /** Distance along a view ray to a surface at the given view-space Z. */
  float rayDistance(float viewZ, vec3 viewDir) {
    return min(uCameraFar, -viewZ / max(1e-4, -viewDir.z));
  }

  /** Hash of a lattice point to [0, 1). The inputs are whole numbers below ~600. */
  float wallHash(vec2 cell) {
    vec3 q = fract(cell.xyx * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }

  /** Value noise for the dust wall. Arguments stay within a few hundred cells. */
  float wallNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = p - i;
    vec2 w = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(wallHash(i), wallHash(i + vec2(1.0, 0.0)), w.x),
      mix(wallHash(i + vec2(0.0, 1.0)), wallHash(i + vec2(1.0, 1.0)), w.x),
      w.y
    );
  }

  float wallFbm(vec2 p) {
    return wallNoise(p) * 0.55 + wallNoise(p * 2.13 + 17.0) * 0.3 + wallNoise(p * 4.37 + 41.0) * 0.15;
  }

  /**
   * THE HABOOB WALL, as what it is: a slab of dust standing on a line across the wind,
   * a kilometre high, marching downwind. Every pixel's ray is intersected with the
   * wall's face; if it enters the dust before it reaches the surface the pixel shows,
   * the rest of the ray inside the dust is what hides that surface. So the wall rises
   * behind the dunes and in front of the sky, swallows the road as it comes, and when
   * it is fifty metres away the whole world beyond fifty metres is inside it — with
   * no geometry, no sorting and one branch nobody pays for on a clear day.
   *
   * Returns rgb and opacity.
   */
  vec4 dustWall(vec3 dir, float sceneDistance) {
    float toward = -dot(dir.xz, uWindDir);
    // Cut exactly where the distance fade below reaches zero, never before it.
    if (toward * 22000.0 <= uWallM) return vec4(0.0);
    float entry = uWallM / toward;
    if (entry >= sceneDistance) return vec4(0.0);
    vec3 at = dir * entry;
    float height = at.y + uEyeAbove;
    float along = dot(at.xz, vec2(-uWindDir.y, uWindDir.x)) + uWallPan;
    // Seen along its own length the wall recedes for tens of kilometres; there its
    // fine billows would be sub-pixel noise, so detail gives way to the broad shape.
    float far = smoothstep(2500.0, 14000.0, entry);
    // Crest: towers up to a kilometre and a half along a ragged line, rolling up and
    // over as they come. The billow is advected upward in height, which is how the
    // leading edge of a density current actually churns.
    float crest = mix(mix(560.0, 1450.0, wallFbm(vec2(along / 1300.0, 3.1))), 950.0, far);
    float billow = mix(wallFbm(vec2(along / 210.0, height / 180.0 - uWallTime * 0.05)), 0.5, far);
    float edge = crest + (billow - 0.5) * 520.0;
    float body = smoothstep(edge + 25.0, edge - 150.0, height);
    float path = min(sceneDistance, 60000.0) - entry;
    // Far along its own length the wall thins into the air instead of ending.
    float opacity = body * (1.0 - exp(-path / 40.0)) * (1.0 - smoothstep(6000.0, 22000.0, entry));
    // Light. The face we see points downwind; it is lit when the sun is on our side
    // of it and a silhouette with a burning crest when the sun is behind it.
    vec2 sunFlat = uSunDirW.xz / max(1e-3, length(uSunDirW.xz));
    float frontLit = clamp(0.5 + 0.5 * dot(uWindDir, sunFlat), 0.0, 1.0);
    float rise = clamp(height / max(edge, 1.0), 0.0, 1.0);
    // The face is not a curtain: lobes of denser dust bulge out of it and catch the
    // light, with darker hollows between, and it is streaked where it drags the ground.
    float lobes = mix(wallFbm(vec2(along / 320.0, height / 140.0 - uWallTime * 0.03) + 5.0), 0.5, far);
    float puff = smoothstep(0.25, 0.8, billow) * 0.5 + smoothstep(0.3, 0.75, lobes) * 0.5;
    vec3 albedo = uDustAlbedo;
    vec3 lit = uSunCol * (0.15 + 0.8 * frontLit) * mix(0.25, 0.95, pow(rise, 1.3)) * (0.75 + 0.4 * puff);
    vec3 col = albedo * (uWallAir * 0.45 * (0.85 + 0.25 * puff) + lit);
    // Crest rim when the sun is behind: a thin bright fringe along the edge.
    float rim = smoothstep(edge - 140.0, edge - 10.0, height) * (1.0 - frontLit);
    col += uSunCol * vec3(1.0, 0.72, 0.42) * rim * 0.45;
    // Aerial perspective: tens of kilometres of air turn it into a stain.
    // Aerial perspective: the dust the storm itself has thrown ahead of the wall, by
    // the same law the scene's fog applies to the land, so near arrival a ridge and
    // the wall behind it fade together instead of the ridge standing as a pale
    // cut-out. The clear-air base fog is left out: in clean air a haboob is seen from
    // tens of kilometres, far more sharply than the land in front of it.
    float fogged = 1.0 - exp(-uFogDensity * uFogDensity * entry * entry);
    col = mix(col, uWallAir, max(fogged, 1.0 - exp(-entry / 16000.0)));
    return vec4(col, opacity);
  }

  /**
   * Ink outline strength at a pixel, from the colour gradient around it.
   *
   * A Sobel on the already-shaded image, not on a depth buffer, and deliberately:
   * the ground's own shading is banded (render/comic.ts), so its band boundaries ARE
   * the strata edges a pen would draw, and a colour edge detector inks both those and
   * every silhouette in one pass.
   *
   * Full RGB distance rather than luminance: a tan dune against a blue sky is a
   * enormous HUE step and barely a brightness one, so a luminance-only detector left
   * the one edge that matters most — the skyline — undrawn.
   *
   * Taps are a pixel and a half out, so the line lands on the edge itself rather than
   * on the antialiasing gradient beside it. Measured on the displayed picture
   * (\`displayTap\`): an edge is a step the eye sees, and in radiance the same dune
   * edge is a step ten times larger at noon than at dusk.
   */
  float inkEdge(vec2 uv, vec2 texel) {
    vec2 d = texel * 1.5;
    vec3 c  = displayTap(uv);
    vec3 cx = displayTap(uv + vec2(d.x, 0.0));
    vec3 cX = displayTap(uv - vec2(d.x, 0.0));
    vec3 cy = displayTap(uv + vec2(0.0, d.y));
    vec3 cY = displayTap(uv - vec2(0.0, d.y));
    // Central differences rather than a full 3x3 kernel: four taps instead of
    // eight, and on a banded image the diagonals add nothing but cost.
    float grad = max(length(cx - cX), length(cy - cY));
    // Relative, not absolute: a step of 0.05 matters in the shaded side of a dune
    // and is invisible across bright sand, so it is measured against local
    // brightness.
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float rel = grad / max(0.18, lum);
    return smoothstep(uInkThreshold, uInkThreshold * 2.6, rel);
  }

  /** FXAA's edge thresholds: the contrast below which a pixel is left alone, absolute and
   *  relative to its brightest neighbour. FXAA 3.11's own "high quality" pair: the
   *  stricter "extreme" one three's FXAAShader uses also softens the road's aggregate and
   *  the stipple, which are texture, not jaggies. */
  #define FXAA_CONTRAST 0.0625
  #define FXAA_RELATIVE 0.125
  /** How much of the sub-pixel blend is taken; 1 is the full blur of a lone bright texel. */
  #define FXAA_SUBPIXEL 0.75
  #define FXAA_STEPS 6
  #define FXAA_GUESS 8.0
  /** Pixels per step of the walk along an edge, after the first. */
  const float FXAA_STEP[FXAA_STEPS] = float[FXAA_STEPS](1.0, 1.5, 2.0, 2.0, 2.0, 4.0);

  /** Luma of the picture as the display shows it: what the eye sees as a step. */
  float fxaaLuma(vec2 uv) {
    return dot(displayTap(uv), vec3(0.299, 0.587, 0.114));
  }

  /**
   * The picture at \`uv\` through FXAA (Lottes' algorithm, in the form three ships as
   * FXAAShader): a pixel on a luma edge is sampled a fraction of a pixel across it, by
   * how far along the edge's run it stands, so a stair of whole pixels becomes a ramp.
   * Five taps decide that a pixel is flat, and most of a frame is.
   *
   * It replaces four-sample MSAA, which had to resolve the colour and the depth target
   * every frame. FXAA works on the shaded picture, so it smooths what MSAA never could
   * (the edges inside alpha-tested leaves and in the banded shading) and is blind to a
   * sub-pixel wire, which MSAA saw. The ink is drawn after it, from the same picture.
   */
  vec4 fxaaSample(vec2 uv) {
    vec2 px = 1.0 / uResolution;
    float m = fxaaLuma(uv);
    float n = fxaaLuma(uv + vec2(0.0, px.y));
    float e = fxaaLuma(uv + vec2(px.x, 0.0));
    float s = fxaaLuma(uv - vec2(0.0, px.y));
    float w = fxaaLuma(uv - vec2(px.x, 0.0));
    float highest = max(max(max(max(n, e), s), w), m);
    float lowest = min(min(min(min(n, e), s), w), m);
    float contrast = highest - lowest;
    if (contrast < max(FXAA_CONTRAST, FXAA_RELATIVE * highest)) return sceneTap(uv);
    float ne = fxaaLuma(uv + px);
    float nw = fxaaLuma(uv + vec2(-px.x, px.y));
    float se = fxaaLuma(uv + vec2(px.x, -px.y));
    float sw = fxaaLuma(uv - px);

    // Sub-pixel: how far the centre stands from its neighbourhood's weighted mean.
    float mean = (2.0 * (n + e + s + w) + ne + nw + se + sw) / 12.0;
    float sub = smoothstep(0.0, 1.0, clamp(abs(mean - m) / contrast, 0.0, 1.0));
    sub = sub * sub * FXAA_SUBPIXEL;

    // The edge's direction, and the side of this pixel it runs along.
    float horizontal = abs(n + s - 2.0 * m) * 2.0 + abs(ne + se - 2.0 * e) + abs(nw + sw - 2.0 * w);
    float vertical = abs(e + w - 2.0 * m) * 2.0 + abs(ne + nw - 2.0 * n) + abs(se + sw - 2.0 * s);
    bool isHorizontal = horizontal >= vertical;
    float pLuma = isHorizontal ? n : e;
    float nLuma = isHorizontal ? s : w;
    float pGradient = abs(pLuma - m);
    float nGradient = abs(nLuma - m);
    float across = isHorizontal ? px.y : px.x;
    float opposite = pLuma;
    float gradient = pGradient;
    if (pGradient < nGradient) {
      across = -across;
      opposite = nLuma;
      gradient = nGradient;
    }

    // Walk the edge both ways to where it ends.
    vec2 edgeUv = uv;
    vec2 along = isHorizontal ? vec2(px.x, 0.0) : vec2(0.0, px.y);
    if (isHorizontal) edgeUv.y += across * 0.5;
    else edgeUv.x += across * 0.5;
    float edgeLuma = (m + opposite) * 0.5;
    float threshold = gradient * 0.25;
    vec2 pUv = edgeUv + along * FXAA_STEP[0];
    float pDelta = fxaaLuma(pUv) - edgeLuma;
    bool pEnd = abs(pDelta) >= threshold;
    for (int i = 1; i < FXAA_STEPS && !pEnd; i++) {
      pUv += along * FXAA_STEP[i];
      pDelta = fxaaLuma(pUv) - edgeLuma;
      pEnd = abs(pDelta) >= threshold;
    }
    if (!pEnd) pUv += along * FXAA_GUESS;
    vec2 nUv = edgeUv - along * FXAA_STEP[0];
    float nDelta = fxaaLuma(nUv) - edgeLuma;
    bool nEnd = abs(nDelta) >= threshold;
    for (int i = 1; i < FXAA_STEPS && !nEnd; i++) {
      nUv -= along * FXAA_STEP[i];
      nDelta = fxaaLuma(nUv) - edgeLuma;
      nEnd = abs(nDelta) >= threshold;
    }
    if (!nEnd) nUv -= along * FXAA_GUESS;

    float pDistance = isHorizontal ? pUv.x - uv.x : pUv.y - uv.y;
    float nDistance = isHorizontal ? uv.x - nUv.x : uv.y - nUv.y;
    bool pNearer = pDistance <= nDistance;
    float shortest = pNearer ? pDistance : nDistance;
    bool deltaSign = (pNearer ? pDelta : nDelta) >= 0.0;
    // Blended only on the side of the edge where the run ends: the other side is the edge's
    // inside, already the right colour.
    float edgeBlend = deltaSign == (m - edgeLuma >= 0.0) ? 0.0 : 0.5 - shortest / (pDistance + nDistance);
    float blend = max(sub, edgeBlend);
    if (isHorizontal) uv.y += across * blend;
    else uv.x += across * blend;
    return sceneTap(uv);
  }

  void main() {
    // The scene image's coordinate this screen pixel shows: itself, or through the
    // cinema lens. Everything that reads the scene uses it; the screen overlays
    // (binocular eyes, viewfinder) stay on vUv.
    vec2 uv = uPanini > 0.0 ? paniniSource(vUv) : vUv;
    // One depth tap a pixel: the weather and the ink gate read it.
    float viewZ = perspectiveDepthToViewZ(texture2D(tDepth, uv).x);
    float depthM = -viewZ;
    // A uniform branch: every fragment agrees, and with FXAA off this is the one tap.
    vec4 color = uFxaa > 0.5 ? fxaaSample(uv) : sceneTap(uv);

    if (uWallM >= 0.0 || uDustInside > 0.0) {
      vec3 wallView = cameraRay(uv);
      float sceneD = depthM >= uCameraFar * 0.999 ? 1e7 : rayDistance(viewZ, wallView);
      if (uWallM >= 0.0) {
        vec4 wall = dustWall(normalize(uCameraRotation * wallView), sceneD);
        color.rgb = mix(color.rgb, sceneFromScreen(wall.rgb), wall.a);
      }
      // Inside the storm: the wall's own dust, lit as its foot is (low on the face, so
      // little of the sun), hiding every pixel by its distance. The sky counts as 2 km,
      // so it goes under in the thick of it and comes back as the storm thins.
      if (uDustInside > 0.0) {
        vec2 sunFlat = uSunDirW.xz / max(1e-3, length(uSunDirW.xz));
        float frontLit = clamp(0.5 + 0.5 * dot(uWindDir, sunFlat), 0.0, 1.0);
        vec3 inside = uDustAlbedo * (uWallAir * 0.45 + uSunCol * (0.15 + 0.8 * frontLit) * 0.25);
        float k = uDustInside * min(sceneD, 2000.0);
        color.rgb = mix(color.rgb, sceneFromScreen(inside), 1.0 - exp(-k * k));
      }
    }

    // The weather's near veil (mgla, rain): geometry only, the sky keeps its own colour.
    if (uVeil > 0.0 && depthM < uCameraFar * 0.999) {
      color.rgb = mix(color.rgb, sceneFromScreen(uWallAir), uVeil * (1.0 - exp(-depthM / 320.0)));
    }
    // The one display transform of the frame. Everything above worked on radiance —
    // the dust and the veil are light added and taken away, as the scene's own fog
    // is — and everything below works on the picture the display shows.
    color.rgb = toDisplay(color.rgb);

    // A small finish on the displayed picture: a luminance-preserving colour
    // separation, then warm highlights against slightly cooler shadows. It enriches
    // the desert palette without being a second tone curve. The separation is the
    // art direction's: 1.5 keeps the desert the saturated ochre it was painted against
    // a frame shown a gamma dark, where every colour's channel ratios reached the screen
    // squared; the authored palette through the encoded frame alone reads pale.
    float gradeLum = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
    color.rgb = mix(vec3(gradeLum), color.rgb, 1.5 * uGradeSat);
    float highlightWarmth = smoothstep(0.16, 0.82, gradeLum);
    color.rgb *= mix(
      vec3(0.993, 0.998, 1.006),
      vec3(1.012, 1.003, 0.985),
      highlightWarmth
    );
    color.rgb = clamp(color.rgb, 0.0, 1.0);
    // The look's contrast: a smoothstep S on the displayed values, black and white
    // held. The game was painted against a frame shown a gamma dark, which read as hard
    // noon contrast; the encoded frame is right and flatter, and this is where the art
    // direction puts the punch back, after the tone curve and before the ink.
    color.rgb = mix(color.rgb, color.rgb * color.rgb * (3.0 - 2.0 * color.rgb), uContrast);

    // Ink is for surfaces, and "surface" is a depth question rather than a screen-height
    // one. The gate used to be a screen-height test against uHorizon, which kept the
    // outline pass off the sky and every star point — but it also left everything whose
    // silhouette rises above the horizon undrawn, so a tree got a line round its trunk
    // and none round its crown.
    //
    // The sky, the stars and the planets all render with depthWrite off, so they
    // leave depth at the far plane while real geometry does not. Testing the depth this
    // shader already samples excludes them by the property that actually distinguishes
    // them, and lets a canopy, a roof or a mast keep its outline against open sky.
    if (uInkStrength > 0.0 && depthM < uCameraFar * 0.999) {
      float ink = inkEdge(uv, 1.0 / uResolution) * uInkStrength;
      // The line is the surface's own colour driven down, not a black overlay:
      // black lines on sand read as dirt, dark-sand lines read as ink.
      color.rgb = mix(color.rgb, color.rgb * 0.34, ink);
    }

    #ifdef RETRO
    // The retro rung's ORDERED dither onto a short palette: a fixed 4x4 Bayer pattern
    // stays put on the screen and turns every gradient — the sky, the sand falling away
    // into fog — into the stepped bands of a period framebuffer.
    vec2 cell = mod(floor(gl_FragCoord.xy), 4.0);
    vec2 cellLow = mod(cell, 2.0);
    vec2 cellHigh = floor(cell * 0.5);
    float bayer = (
      4.0 * mod(2.0 * cellLow.x + 3.0 * cellLow.y, 4.0)
      + mod(2.0 * cellHigh.x + 3.0 * cellHigh.y, 4.0)
    ) / 16.0;
    color.rgb = clamp(floor(color.rgb * RETRO_LEVELS + bayer) / RETRO_LEVELS, 0.0, 1.0);
    #endif

    // Worn shades are a coloured-glass transmission curve, not a flat alpha wash:
    // retained channels stay bright while the others are absorbed.
    color.rgb *= mix(vec3(1.0), uViewTint, uViewTintStrength);

    // Two separated circular ocular fields. Aspect correction makes lensUv square;
    // the small overlap preserves binocular fusion without reading as one wide oval.
    vec2 lensUv = vec2((vUv.x - 0.5) * uResolution.x / uResolution.y, vUv.y - 0.5);
    float leftEye = 1.0 - smoothstep(0.335, 0.35, length(lensUv - vec2(-0.27, 0.0)));
    float rightEye = 1.0 - smoothstep(0.335, 0.35, length(lensUv - vec2(0.27, 0.0)));
    float ocular = max(leftEye, rightEye);
    color.rgb *= mix(1.0, ocular, uBinoculars);

    // A broad, softly rounded eyecup vignette: unlike the binocular mask it keeps
    // one professional-camera frame, but the dark top, bottom and corners make the
    // eye-at-viewfinder state unmistakable.
    vec2 finder = abs(vUv * 2.0 - 1.0);
    float finderShape = pow(finder.x, 8.0) + pow(finder.y / 0.84, 8.0);
    float finderMask = 1.0 - smoothstep(0.82, 1.04, finderShape);
    color.rgb *= mix(1.0, finderMask, uCameraViewfinder);

    gl_FragColor = color;
  }
`;
