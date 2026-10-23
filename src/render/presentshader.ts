/**
 * THE SHRINK: a frame drawn with more lines than the screen has, brought down to the
 * screen's own pixels by the game rather than by the browser.
 *
 * WHY NOT THE COMPOSITOR. A canvas whose drawing buffer is larger than the device pixels
 * it covers is scaled by the browser with one bilinear tap per screen pixel. That is a
 * filter two source texels wide, which is a correct average only at exactly 2x. At the
 * ratios this game actually meets — 1440 lines in the ~990 a maximised window has on a
 * 1080-line monitor is 1.45x, 1080 in it is 1.09x — some texels are weighted almost
 * fully and their neighbours almost not at all, so the supersample's extra lines are
 * partly thrown away: a thin pole or a wire beyond fifty metres keeps its stair steps
 * and gains a blur. The frame cost 2.1x the screen's pixels for a fraction of the gain.
 *
 * WHAT THIS DOES. An area average: each screen pixel's footprint on the frame (`uScale`
 * texels wide and high, never more than 2) is covered exactly, every texel weighted by
 * the share of it the footprint overlaps, which is the box filter image resizers call
 * "area". At a ratio of at most 2 a footprint touches at most three texels on each axis,
 * so the loop is a fixed 3x3 of `texelFetch` with the empty taps weighted to zero.
 *
 * IN LINEAR LIGHT. The finishing pass (render/hazeshader.ts) writes display-encoded
 * colour into the frame target, as it would to the canvas; averaging those numbers would
 * darken every edge between a bright and a dark texel, so each texel is decoded first
 * and the mean is encoded once, by Three's output transform for the canvas.
 */

export const PRESENT_VERTEX = /* glsl */ `
  void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const PRESENT_FRAGMENT = /* glsl */ `
  uniform sampler2D tFrame;
  /** The frame target's size, texels. */
  uniform vec2 uFrameSize;
  /** Frame texels per screen pixel on each axis, 1..2. */
  uniform vec2 uScale;

  void main() {
    vec2 lo = floor(gl_FragCoord.xy) * uScale;
    vec2 hi = lo + uScale;
    vec2 first = floor(lo);
    ivec2 last = ivec2(uFrameSize) - 1;
    vec3 sum = vec3(0.0);
    float total = 0.0;
    for (int j = 0; j < 3; j++) {
      float y = first.y + float(j);
      float wy = max(0.0, min(hi.y, y + 1.0) - max(lo.y, y));
      for (int i = 0; i < 3; i++) {
        float x = first.x + float(i);
        float w = wy * max(0.0, min(hi.x, x + 1.0) - max(lo.x, x));
        if (w <= 0.0) continue;
        vec4 texel = texelFetch(tFrame, min(ivec2(x, y), last), 0);
        sum += sRGBTransferEOTF(texel).rgb * w;
        total += w;
      }
    }
    gl_FragColor = linearToOutputTexel(vec4(sum / max(total, 1e-6), 1.0));
  }
`;
