/**
 * THE SHOULDER: the strip of bare ground between the asphalt's edge and the grass.
 *
 * A Russian country road (category IV, SP 34.13330 table 5.9) has a two-metre
 * shoulder on paper: an edge strip, a metre strengthened with crushed stone, and a
 * grassed half metre. In life the grass has taken most of it back and what shows is
 * a narrow band of trodden earth and gravel along the asphalt, wider here, narrower
 * there. That band is what this is: 0.5 to 0.9 m, wandering along the road on each
 * side on its own. The road mesh draws it (world/roadmesh.ts) and the grass keeps off
 * it (world/grass.ts), both from this one function.
 *
 * Pure, and a function of arclength and side alone.
 */

/** Width of the bare shoulder past the asphalt edge, metres. `side` is -1 or 1. */
export function shoulderWidthAt(s: number, side: number): number {
  const k = side < 0 ? 1.7 : 4.3;
  return 0.7 + 0.14 * Math.sin(s / 23 + k) + 0.08 * Math.sin(s / 7.3 + k * 2.1);
}
