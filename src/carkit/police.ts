/**
 * A service livery over a catalogue body (`KitLook.livery`): the UAZ-469 militia car
 * (`LOOK_UAZ469_POLICE`, `KIT_SPECS.uaz469_police`, catalogue `kit_uaz469_police`), the
 * 469's body, cabin and running gear in the owner's colours (2026-10-18): a black car (the
 * game sets the car's paint) with white doors, «МИЛИЦИЯ» in dark blue on the front doors
 * and a light bar on the roof.
 *
 * - The doors are livery paint (slot `livery`, materials.ts): paint share 1, so dust,
 *   scratches and stickers take them as any paint, but drawn in the colour each vertex
 *   was built in, not the car's (render/materials.ts `CAR_LAMP_LIVERY`). Every door's
 *   paint mesh (skin, edges, frame) becomes livery after the shell holes are cut.
 * - The lettering is painted into the front doors' skin, not laid on it: the skin's
 *   triangles are split along each letter's strokes (convex outlines on the skin's plane)
 *   and the pieces inside take the lettering's colour. One surface, nothing to fight.
 * - The light bar: a black housing rooted in the roof, a dark blue lens each side and a
 *   lit twin of each (slot `lamp_glow`, drawn unlit) in the same place. Each pair is
 *   switched by pose on its rig channel, `beacon_l` (+x, the left) and `beacon_r`: the
 *   dark lens shows at 0, the lit one at 1 (`kitMotion` kind `visible`, rig.ts), never
 *   both. The lit one is hidden as built, so the mid and far traffic meshes, baked in the
 *   built pose, show the dark lens (render/farcars.ts `collectPieces`).
 */

import * as THREE from 'three';
import { PartBuilder, clipPolygon, newell, polygonArea, type Vec3 } from './builder';
import { addBuilt, pivotGroup, type KitContext } from './context';
import type { KitLook } from './spec';
import { LOOK_UAZ469 } from './uaz';

export interface LiveryLook {
  /** The doors' colour (skin, edges and frames): livery paint over the car's own. */
  readonly doors: number;
  /**
   * Lettering painted into both front doors' skin, reading front to back on the left and
   * back to front on the right, as each side is seen. `s` is the line's centre along the
   * car, `y` its baseline and `height` its capitals' height. Letters: `GLYPHS`.
   */
  readonly lettering: { readonly text: string; readonly colour: number; readonly s: number; readonly y: number; readonly height: number };
  /**
   * A light bar across the roof centred at `s`, its housing `half` wide each side of the
   * centre line; its lenses `dark` unlit, `lit` lit (drawn unlit, in that colour).
   */
  readonly lightBar: { readonly s: number; readonly half: number; readonly dark: number; readonly lit: number };
}

/**
 * UAZ-469 of the militia (owner, 2026-10-18): white doors, «МИЛИЦИЯ» in dark blue on the
 * front doors between the crease (0.86) and the handle (1.04 ± 0.015 at s 1.91-2.06), on
 * the front door's skin from its front edge (1.36) to its rear edge's rake (2.01 at the
 * baseline): 0.54 long at 85 mm, centred at 1.68; a light bar over the front seats.
 */
export const LOOK_UAZ469_POLICE: KitLook = {
  ...LOOK_UAZ469,
  label: 'UAZ-469 Militsiya',
  livery: {
    doors: 0xf2f2ee,
    lettering: { text: 'МИЛИЦИЯ', colour: 0x1d2f6e, s: 1.68, y: 0.905, height: 0.085 },
    lightBar: { s: 1.75, half: 0.56, dark: 0x22418f, lit: 0x6f9dff },
  },
};

/** A letter in em units (capital height 1): its advance and its strokes, each a convex outline. */
interface Glyph {
  readonly advance: number;
  readonly strokes: readonly (readonly (readonly [number, number])[])[];
}

/** Stroke width, em. */
const STROKE = 0.2;
/** Space between letters, em. */
const TRACKING = 0.16;

const rect = (u0: number, v0: number, u1: number, v1: number): (readonly [number, number])[] => [
  [u0, v0],
  [u1, v0],
  [u1, v1],
  [u0, v1],
];

/** Block capitals, straight strokes only: the letters the liveries spell. */
const GLYPHS: Readonly<Record<string, Glyph>> = {
  М: {
    advance: 0.9,
    strokes: [
      rect(0, 0, STROKE, 1),
      rect(0.9 - STROKE, 0, 0.9, 1),
      [[STROKE, 0.7], [0.45, 0.25], [0.45, 0.55], [STROKE, 1]],
      [[0.45, 0.25], [0.9 - STROKE, 0.7], [0.9 - STROKE, 1], [0.45, 0.55]],
    ],
  },
  И: {
    advance: 0.72,
    strokes: [rect(0, 0, STROKE, 1), rect(0.72 - STROKE, 0, 0.72, 1), [[STROKE, 0], [0.72 - STROKE, 0.65], [0.72 - STROKE, 1], [STROKE, 0.35]]],
  },
  Л: {
    advance: 0.72,
    strokes: [rect(0.72 - STROKE, 0, 0.72, 1), rect(0.18, 1 - STROKE, 0.72, 1), [[0, 0], [STROKE, 0], [0.18 + STROKE, 1 - STROKE], [0.18, 1 - STROKE]]],
  },
  Ц: {
    advance: 0.86,
    strokes: [rect(0, 0, STROKE, 1), rect(0.72 - STROKE, 0, 0.72, 1), rect(0, 0, 0.86, STROKE), rect(0.7, -0.2, 0.86, STROKE)],
  },
  Я: {
    advance: 0.72,
    strokes: [
      rect(0.72 - STROKE, 0, 0.72, 1),
      rect(0, 1 - STROKE, 0.72, 1),
      rect(0, 0.42, 0.72, 0.6),
      rect(0, 0.42, STROKE, 1),
      [[0, 0], [0.22, 0], [0.42, 0.42], [0.2, 0.42]],
    ],
  },
};

/** How far a part stands into the surface it is built on (exterior.ts `FACE_ROOT`). */
const ROOT = 0.007;
/** The light bar: housing height over the roof and half depth; lens height, half depth and inner end; the middle block. */
const BAR_HEIGHT = 0.035;
const BAR_HALF_DEPTH = 0.11;
const LENS_HEIGHT = 0.085;
const LENS_HALF_DEPTH = 0.085;
const LENS_INNER = 0.13;
const LENS_END = 0.02;
const MIDDLE_HALF = 0.1;
const MIDDLE_HEIGHT = 0.06;
const MIDDLE_HALF_DEPTH = 0.07;
const BAR_COLOUR = 0x19191b;
const MIDDLE_COLOUR = 0x2b2c2e;

/**
 * Dresses the car in `livery`: run after the shell's holes are cut (kit.ts), on the
 * finished skin, before the ends lean and the flat runs merge.
 */
export function buildLivery(ctx: KitContext, livery: LiveryLook): void {
  paintDoors(ctx, livery);
  buildLightBar(ctx, livery.lightBar);
}

/** The lettering's strokes on one side's front door skin, in the car frame. */
function letteringOutlines(ctx: KitContext, lettering: LiveryLook['lettering'], side: 1 | -1): Vec3[][] {
  const glyphs = [...lettering.text].map((letter) => {
    const glyph = GLYPHS[letter];
    if (!glyph) throw new Error(`Kit livery: no glyph for "${letter}"`);
    return glyph;
  });
  const width = glyphs.reduce((sum, g) => sum + g.advance, 0) + TRACKING * (glyphs.length - 1);
  const h = lettering.height;
  const front = lettering.s - (width * h) / 2;
  const rear = lettering.s + (width * h) / 2;
  const outlines: Vec3[][] = [];
  let pen = 0;
  for (const glyph of glyphs) {
    for (const stroke of glyph.strokes) {
      outlines.push(
        stroke.map(([u, v]): Vec3 => {
          const s = side > 0 ? front + (pen + u) * h : rear - (pen + u) * h;
          const y = lettering.y + v * h;
          return [side * ctx.frame.sideX(s, y), y, ctx.frame.z(s)];
        }),
      );
    }
    pen += glyph.advance + TRACKING;
  }
  return outlines;
}

/**
 * A door face is its skin, and livery, when it faces out of its side within this (cos
 * 45°): the flat skin, the shoulder over the belt (12° in on the 469), the frame's outer
 * face. Its edges (the end faces in the shut gaps, the frame's top) keep the car's paint:
 * they lie a few millimetres off the body's jamb flanges, which are the car's paint too,
 * and two colours there fight in the depth buffer from 25 m (tools/kit-zfight.ts).
 */
const SKIN_FACING = Math.SQRT1_2;

/**
 * Every door's skin becomes livery paint (`${door}_livery`, beside its `${door}_paint`,
 * which keeps the edges), the front doors' lettered.
 */
function paintDoors(ctx: KitContext, livery: LiveryLook): void {
  const { root } = ctx;
  root.updateMatrixWorld(true);
  const rootInverse = root.matrixWorld.clone().invert();
  const ink = new THREE.Color(livery.lettering.colour);
  const white = new THREE.Color(livery.doors);
  let painted = 0;
  for (const [owner, { node }] of ctx.nodes) {
    if (!/^door_[fr][lr]$/.test(owner)) continue;
    const mesh = node.children.find((c) => c.name === `${owner}_paint`) as THREE.Mesh | undefined;
    if (!mesh) throw new Error(`Kit livery: no "${owner}_paint" to paint`);
    const side = owner.endsWith('l') ? 1 : -1;
    const outlines = owner.startsWith('door_f') ? letteringOutlines(ctx, livery.lettering, side) : [];
    const toCar = rootInverse.clone().multiply(mesh.matrixWorld);
    const toLocal = toCar.clone().invert();
    const geometry = mesh.geometry;
    const car = (geometry.getAttribute('position') as THREE.BufferAttribute).clone().applyMatrix4(toCar);
    const split = inlay(Array.from(car.array), outlines);
    // Tags a tool hangs on the geometry per triangle (tools/kit-zfight.ts `prov`) follow the split.
    const tags = geometry.userData.prov as unknown[] | undefined;
    const skin = { positions: [] as number[], colors: [] as number[], prov: [] as unknown[] };
    const edge = { positions: [] as number[], colors: [] as number[], prov: [] as unknown[] };
    for (let t = 0; t < split.inked.length; t++) {
      const tri = split.positions.slice(t * 9, t * 9 + 9);
      const n = newell([
        [tri[0]!, tri[1]!, tri[2]!],
        [tri[3]!, tri[4]!, tri[5]!],
        [tri[6]!, tri[7]!, tri[8]!],
      ]);
      const outward = (side * n[0]) / Math.hypot(n[0], n[1], n[2]);
      const into = outward > SKIN_FACING ? skin : edge;
      const c = into === edge ? white : split.inked[t] ? ink : white;
      into.positions.push(...tri);
      for (let k = 0; k < 3; k++) into.colors.push(c.r, c.g, c.b);
      if (tags) into.prov.push(tags[split.from[t]!]);
    }
    if (skin.positions.length === 0) throw new Error(`Kit livery: "${owner}" has no skin facing out`);
    const write = (target: THREE.BufferGeometry, part: typeof skin): void => {
      target.setAttribute('position', new THREE.Float32BufferAttribute(part.positions, 3).applyMatrix4(toLocal));
      target.setAttribute('color', new THREE.Float32BufferAttribute(part.colors, 3));
      target.deleteAttribute('normal');
      target.computeVertexNormals();
      target.computeBoundingBox();
      target.computeBoundingSphere();
      if (tags) target.userData.prov = part.prov;
    };
    const skinMesh = new THREE.Mesh(new THREE.BufferGeometry(), mesh.material);
    write(skinMesh.geometry, skin);
    skinMesh.name = `${owner}_livery`;
    skinMesh.userData.kitSlot = 'livery';
    skinMesh.position.copy(mesh.position);
    skinMesh.quaternion.copy(mesh.quaternion);
    skinMesh.scale.copy(mesh.scale);
    node.add(skinMesh);
    if (edge.positions.length > 0) write(geometry, edge);
    else mesh.removeFromParent();
    painted++;
  }
  if (painted === 0) throw new Error('Kit livery: the car has no doors');
}

/** A surface the lettering is painted on lies within this of its outline's plane… */
const INLAY_REACH = 0.015;
/** …and is turned less than 40° from it (builder.ts `cutUnder`'s rule). */
const INLAY_TURN = Math.cos((40 * Math.PI) / 180);
/** Pieces smaller than this (m²) are not split off. */
const INLAY_SLIVER = 1e-12;

/**
 * Flat triangles (9 numbers each) split along the outlines (convex, on the surface): each
 * output triangle, whether it lies inside an outline (`inked`), and its input triangle
 * (`from`). Inside and outside pieces are clipped against the same planes in the same
 * order (`clipPolygon`), so they meet on the very same points and leave no crack.
 */
function inlay(positions: readonly number[], outlines: readonly (readonly Vec3[])[]): { positions: number[]; inked: boolean[]; from: number[] } {
  const unit = (a: Vec3): Vec3 => {
    const l = Math.hypot(a[0], a[1], a[2]);
    return [a[0] / l, a[1] / l, a[2] / l];
  };
  const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cutters = outlines.map((poly) => {
    const n = unit(newell(poly));
    const d = dot(n, poly[0]!);
    const sides = poly.map((p, i) => {
      const q = poly[(i + 1) % poly.length]!;
      const e: Vec3 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
      const m = unit([n[1] * e[2] - n[2] * e[1], n[2] * e[0] - n[0] * e[2], n[0] * e[1] - n[1] * e[0]]);
      const at = dot(m, p);
      return (x: Vec3): number => dot(m, x) - at;
    });
    sides.push((x) => INLAY_REACH - (dot(n, x) - d), (x) => INLAY_REACH + (dot(n, x) - d));
    const lo = [0, 1, 2].map((a) => Math.min(...poly.map((p) => p[a]!)) - INLAY_REACH);
    const hi = [0, 1, 2].map((a) => Math.max(...poly.map((p) => p[a]!)) + INLAY_REACH);
    return { n, sides, lo, hi };
  });
  const out: number[] = [];
  const inked: boolean[] = [];
  const from: number[] = [];
  for (let t = 0; t < positions.length; t += 9) {
    const tri: Vec3[] = [0, 3, 6].map((k): Vec3 => [positions[t + k]!, positions[t + k + 1]!, positions[t + k + 2]!]);
    const facing = unit(newell(tri));
    let pieces: { poly: Vec3[]; ink: boolean }[] = [{ poly: tri, ink: false }];
    for (const c of cutters) {
      if (Math.abs(dot(facing, c.n)) < INLAY_TURN) continue;
      if ([0, 1, 2].some((a) => Math.max(tri[0]![a]!, tri[1]![a]!, tri[2]![a]!) < c.lo[a]! || Math.min(tri[0]![a]!, tri[1]![a]!, tri[2]![a]!) > c.hi[a]!)) continue;
      const next: typeof pieces = [];
      for (const piece of pieces) {
        let inside: Vec3[] = piece.poly;
        for (const side of c.sides) inside = clipPolygon(inside, side, 1);
        if (piece.ink || inside.length < 3 || polygonArea(inside) <= INLAY_SLIVER) {
          next.push(piece);
          continue;
        }
        next.push({ poly: inside, ink: true });
        // The piece less the outline: what lies outside each side in turn.
        let rest: Vec3[] = piece.poly;
        for (const side of c.sides) {
          const outside = clipPolygon(rest, side, -1);
          if (outside.length >= 3 && polygonArea(outside) > INLAY_SLIVER) next.push({ poly: outside, ink: false });
          rest = clipPolygon(rest, side, 1);
          if (rest.length < 3) break;
        }
      }
      pieces = next;
    }
    for (const { poly, ink } of pieces) {
      for (let i = 1; i + 1 < poly.length; i++) {
        for (const p of [poly[0]!, poly[i]!, poly[i + 1]!]) out.push(p[0], p[1], p[2]);
        inked.push(ink);
        from.push(t / 9);
      }
    }
  }
  return { positions: out, inked, from };
}

/**
 * The light bar across the roof at `bar.s`: a black housing rooted in the roof, a black
 * block between the lamps, and each side a dark lens and its lit twin on that side's
 * beacon channel. All in the car frame on the root: drawn at every distance, baked into
 * the mid and far meshes with the dark lenses.
 */
function buildLightBar(ctx: KitContext, bar: LiveryLook['lightBar']): void {
  const { frame, root } = ctx;
  const cabin = frame.spec.cabin;
  const s0 = bar.s - BAR_HALF_DEPTH;
  const s1 = bar.s + BAR_HALF_DEPTH;
  if (s0 < frame.screenTopS(0) + cabin.railInset || s1 > cabin.columns[cabin.columns.length - 1]!.top) {
    throw new Error(`Kit livery: the light bar at s ${bar.s} is off the roof`);
  }
  // The roof under the housing (body.ts `buildShell` `roofPoint`): lowest at its outer
  // corners, where the crown falls away and the roof's profile drops most.
  const inner = cabin.railHalf - cabin.railInset;
  const roofY = (s: number, x: number): number => cabin.rail + cabin.railRise + frame.crownAt(Math.min(1, Math.abs(x) / inner)) - frame.roofDrop(s);
  const corners = [s0, s1].flatMap((s) => [roofY(s, bar.half), roofY(s, 0)]);
  const low = Math.min(...corners);
  const top = Math.max(...corners) + BAR_HEIGHT;
  const z = frame.z(bar.s);

  const b = new PartBuilder();
  // No bottom: rooted in the roof, whose canvas under it is closed in.
  b.color(BAR_COLOUR).boxFrom('trim', [-bar.half, low - ROOT, z - BAR_HALF_DEPTH], [bar.half, top, z + BAR_HALF_DEPTH], 0b110111);
  b.color(MIDDLE_COLOUR).boxFrom('trim', [-MIDDLE_HALF, top - ROOT, z - MIDDLE_HALF_DEPTH], [MIDDLE_HALF, top + MIDDLE_HEIGHT, z + MIDDLE_HALF_DEPTH], 0b110111);
  addBuilt(root, b, [0, 0, 0], 'light_bar');

  for (const [side, channel] of [[1, 'beacon_l'], [-1, 'beacon_r']] as const) {
    const x0 = side * LENS_INNER;
    const x1 = side * (bar.half - LENS_END);
    const min: Vec3 = [Math.min(x0, x1), top - ROOT, z - LENS_HALF_DEPTH];
    const max: Vec3 = [Math.max(x0, x1), top + LENS_HEIGHT, z + LENS_HALF_DEPTH];
    const at: Vec3 = [(x0 + x1) / 2, top, z];
    // The two lenses are the same box: the rig shows one at a time, so they never fight.
    for (const lit of [false, true]) {
      const node = pivotGroup(`${channel}_${lit ? 'lit' : 'dark'}`, at, { channel, kind: 'visible', axis: [0, 0, 0], amount: lit ? 1 : -1 });
      node.visible = !lit;
      const lens = new PartBuilder().color(lit ? bar.lit : bar.dark).boxFrom(lit ? 'lamp_glow' : 'trim', min, max, 0b110111);
      addBuilt(node, lens, at, channel);
      root.add(node);
    }
  }
}
