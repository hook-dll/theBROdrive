/**
 * SMART UPSCALING: AMD FidelityFX Super Resolution 1, its two passes ported to GLSL ES 3.0
 * from the public FSR1 source (ffx_fsr1.h, v1.20210629, the non-packed 32-bit paths).
 *
 *  - EASU (edge-adaptive spatial upsampling) takes the finished frame from the scene's
 *    size to the canvas's: a 12-tap Lanczos-like kernel stretched along the local edge
 *    and clamped to the four nearest texels, so an edge stays a line where the
 *    compositor's bilinear tap smears it into a ramp.
 *  - RCAS (robust contrast-adaptive sharpening) at the canvas's size: a 5-tap cross
 *    whose negative lobe is solved per pixel for the most sharpening that cannot clip.
 *
 * Where they run (core/renderer.ts `drawFrame`): after the finishing pass
 * (render/hazeshader.ts), on its tone-mapped, display-encoded picture, which is the
 * perceptual space FSR1 expects, and after its FXAA, the antialiasing EASU expects to be
 * given. The ink and FXAA are drawn at the scene's size before EASU.
 *
 * The port: `texelFetch` stands in for the HLSL gather (WebGL2 has none), so the taps
 * are addressed in texels from `gl_FragCoord`; the kernel is mirror-symmetric, so GL's
 * upward y needs no flip. The approximate reciprocals (`APrxLoRcpF1`...) are exact
 * divisions here, held off zero where the bit tricks returned a large finite number.
 *
 * ---------------------------------------------------------------------------------
 * FidelityFX Super Resolution 1 (EASU, RCAS)
 *
 * Copyright (c) 2021 Advanced Micro Devices, Inc. All rights reserved.
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 * ---------------------------------------------------------------------------------
 */

/**
 * EASU: `tFrame` (the finished frame, display-encoded, one texel per scene pixel) to
 * this pass's target. `uScale` is input texels per output pixel on each axis
 * (`FsrEasuCon`'s con0.xy); the rest of its constants are texel offsets here.
 */
export const EASU_FRAGMENT = /* glsl */ `
  uniform sampler2D tFrame;
  uniform vec2 uScale;

  vec3 easuLoad(ivec2 p, ivec2 last) {
    return texelFetch(tFrame, clamp(p, ivec2(0), last), 0).rgb;
  }

  /** Luma times two, in two multiply-adds: FSR's own. */
  float easuLuma(vec3 c) {
    return c.b * 0.5 + (c.r * 0.5 + c.g);
  }

  // FsrEasuSetF: the '+' around one of the four nearest texels gives the gradient's
  // direction, and how one-sided it is gives the edge's length; bilinear-weighted.
  //    a
  //  b c d
  //    e
  void easuSet(inout vec2 dir, inout float len, float w, float lA, float lB, float lC, float lD, float lE) {
    float dc = lD - lC;
    float cb = lC - lB;
    float lenX = 1.0 / max(max(abs(dc), abs(cb)), 1.0 / 65536.0);
    float dirX = lD - lB;
    dir.x += dirX * w;
    lenX = clamp(abs(dirX) * lenX, 0.0, 1.0);
    lenX *= lenX;
    len += lenX * w;
    float ec = lE - lC;
    float ca = lC - lA;
    float lenY = 1.0 / max(max(abs(ec), abs(ca)), 1.0 / 65536.0);
    float dirY = lE - lA;
    dir.y += dirY * w;
    lenY = clamp(abs(dirY) * lenY, 0.0, 1.0);
    lenY *= lenY;
    len += lenY * w;
  }

  // FsrEasuTapF: one tap of the rotated, stretched, windowed Lanczos-2 approximation.
  void easuTap(inout vec3 aC, inout float aW, vec2 off, vec2 dir, vec2 len2, float lob, float clp, vec3 c) {
    vec2 v = vec2(off.x * dir.x + off.y * dir.y, off.x * -dir.y + off.y * dir.x);
    v *= len2;
    float d2 = min(v.x * v.x + v.y * v.y, clp);
    float wB = (2.0 / 5.0) * d2 - 1.0;
    float wA = lob * d2 - 1.0;
    wB *= wB;
    wA *= wA;
    wB = (25.0 / 16.0) * wB - (25.0 / 16.0 - 1.0);
    float w = wB * wA;
    aC += c * w;
    aW += w;
  }

  void main() {
    ivec2 last = textureSize(tFrame, 0) - 1;
    // The output pixel's centre in input texels, from texel centres: con0.
    vec2 pp = gl_FragCoord.xy * uScale - 0.5;
    vec2 fp = floor(pp);
    pp -= fp;
    ivec2 f0 = ivec2(fp);
    // The 12-tap kernel around 'f':
    //    b c
    //  e f g h
    //  i j k l
    //    n o
    vec3 b = easuLoad(f0 + ivec2(0, -1), last);
    vec3 c = easuLoad(f0 + ivec2(1, -1), last);
    vec3 e = easuLoad(f0 + ivec2(-1, 0), last);
    vec3 f = easuLoad(f0, last);
    vec3 g = easuLoad(f0 + ivec2(1, 0), last);
    vec3 h = easuLoad(f0 + ivec2(2, 0), last);
    vec3 i = easuLoad(f0 + ivec2(-1, 1), last);
    vec3 j = easuLoad(f0 + ivec2(0, 1), last);
    vec3 k = easuLoad(f0 + ivec2(1, 1), last);
    vec3 l = easuLoad(f0 + ivec2(2, 1), last);
    vec3 n = easuLoad(f0 + ivec2(0, 2), last);
    vec3 o = easuLoad(f0 + ivec2(1, 2), last);
    float bL = easuLuma(b);
    float cL = easuLuma(c);
    float eL = easuLuma(e);
    float fL = easuLuma(f);
    float gL = easuLuma(g);
    float hL = easuLuma(h);
    float iL = easuLuma(i);
    float jL = easuLuma(j);
    float kL = easuLuma(k);
    float lL = easuLuma(l);
    float nL = easuLuma(n);
    float oL = easuLuma(o);

    vec2 dir = vec2(0.0);
    float len = 0.0;
    easuSet(dir, len, (1.0 - pp.x) * (1.0 - pp.y), bL, eL, fL, gL, jL);
    easuSet(dir, len, pp.x * (1.0 - pp.y), cL, fL, gL, hL, kL);
    easuSet(dir, len, (1.0 - pp.x) * pp.y, fL, iL, jL, kL, nL);
    easuSet(dir, len, pp.x * pp.y, gL, jL, kL, lL, oL);

    // Normalise the direction, and no direction at all is horizontal.
    vec2 dir2 = dir * dir;
    float dirR = dir2.x + dir2.y;
    bool zro = dirR < 1.0 / 32768.0;
    dirR = zro ? 1.0 : inversesqrt(dirR);
    dir.x = zro ? 1.0 : dir.x;
    dir *= dirR;
    // {0..2} to {0..1}, shaped with a square.
    len = len * 0.5;
    len *= len;
    // Stretch the kernel: 1 across a horizontal or vertical edge, up to sqrt(2) on a diagonal.
    float stretch = (dir.x * dir.x + dir.y * dir.y) / max(abs(dir.x), abs(dir.y));
    vec2 len2 = vec2(1.0 + (stretch - 1.0) * len, 1.0 - 0.5 * len);
    // The window moves from +/-sqrt(2) to a little past 2 with the amount of edge.
    float lob = 0.5 + ((1.0 / 4.0 - 0.04) - 0.5) * len;
    float clp = 1.0 / lob;

    vec3 aC = vec3(0.0);
    float aW = 0.0;
    easuTap(aC, aW, vec2(0.0, -1.0) - pp, dir, len2, lob, clp, b);
    easuTap(aC, aW, vec2(1.0, -1.0) - pp, dir, len2, lob, clp, c);
    easuTap(aC, aW, vec2(-1.0, 1.0) - pp, dir, len2, lob, clp, i);
    easuTap(aC, aW, vec2(0.0, 1.0) - pp, dir, len2, lob, clp, j);
    easuTap(aC, aW, vec2(0.0, 0.0) - pp, dir, len2, lob, clp, f);
    easuTap(aC, aW, vec2(-1.0, 0.0) - pp, dir, len2, lob, clp, e);
    easuTap(aC, aW, vec2(1.0, 1.0) - pp, dir, len2, lob, clp, k);
    easuTap(aC, aW, vec2(2.0, 1.0) - pp, dir, len2, lob, clp, l);
    easuTap(aC, aW, vec2(2.0, 0.0) - pp, dir, len2, lob, clp, h);
    easuTap(aC, aW, vec2(1.0, 0.0) - pp, dir, len2, lob, clp, g);
    easuTap(aC, aW, vec2(1.0, 2.0) - pp, dir, len2, lob, clp, o);
    easuTap(aC, aW, vec2(0.0, 2.0) - pp, dir, len2, lob, clp, n);

    // Normalise, and dering against the four nearest texels.
    vec3 min4 = min(min(f, g), min(j, k));
    vec3 max4 = max(max(f, g), max(j, k));
    // Already display-encoded: written as it is, never through \`linearToOutputTexel\`.
    gl_FragColor = vec4(min(max4, max(min4, aC / aW)), 1.0);
  }
`;

/**
 * RCAS: `tFrame` (EASU's output, or the finished frame itself where nothing is
 * upscaled) sharpened one for one. `uSharpness` is `FsrRcasCon`'s con.x, the linear
 * strength exp2(-stops): 1 the most RCAS allows, 0.5 one stop less.
 */
export const RCAS_FRAGMENT = /* glsl */ `
  uniform sampler2D tFrame;
  uniform float uSharpness;

  /** The limit of natural-looking sharpening (FSR_RCAS_LIMIT). */
  #define RCAS_LIMIT (0.25 - (1.0 / 16.0))

  void main() {
    ivec2 last = textureSize(tFrame, 0) - 1;
    ivec2 sp = ivec2(gl_FragCoord.xy);
    //    b
    //  d e f
    //    h
    vec3 b = texelFetch(tFrame, clamp(sp + ivec2(0, -1), ivec2(0), last), 0).rgb;
    vec3 d = texelFetch(tFrame, clamp(sp + ivec2(-1, 0), ivec2(0), last), 0).rgb;
    vec3 e = texelFetch(tFrame, sp, 0).rgb;
    vec3 f = texelFetch(tFrame, clamp(sp + ivec2(1, 0), ivec2(0), last), 0).rgb;
    vec3 h = texelFetch(tFrame, clamp(sp + ivec2(0, 1), ivec2(0), last), 0).rgb;
    // Min and max of the ring.
    vec3 mn4 = min(min(b, d), min(f, h));
    vec3 mx4 = max(max(b, d), max(f, h));
    // The lobe each channel may take before it clips at 0 or 1. Held off zero where
    // the source's reciprocal gave infinity: a channel black or white all round then
    // allows no lobe, as there.
    vec3 hitMin = min(mn4, e) / max(4.0 * mx4, vec3(1.0 / 65536.0));
    vec3 hitMax = (1.0 - max(mx4, e)) / min(4.0 * mn4 - 4.0, vec3(-1.0 / 65536.0));
    vec3 lobeRGB = max(-hitMin, hitMax);
    float lobe = max(-RCAS_LIMIT, min(max(max(lobeRGB.r, lobeRGB.g), lobeRGB.b), 0.0)) * uSharpness;
    // Resolve.
    vec3 pix = (lobe * (b + d + h + f) + e) / (4.0 * lobe + 1.0);
    // Already display-encoded: written as it is, never through \`linearToOutputTexel\`.
    gl_FragColor = vec4(pix, 1.0);
  }
`;
