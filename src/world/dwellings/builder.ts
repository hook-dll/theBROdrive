import * as THREE from 'three';
import { hashUnit2 } from '../../core/rng';
import { applyComicShading } from '../../render/comic';
import { TINTED_GLASS } from '../../render/materials';

/**
 * Geometry builder for the exterior-only dwellings.
 *
 * A dwelling is a closed shell: nobody walks in, so there are no rooms, no openings
 * and no interior faces. Doors and passages are PAINTED panels standing a few
 * centimetres proud of the wall, and windows are panes of the car glass tint
 * (`TINTED_GLASS`), which is an opaque sky mirror and therefore never needs anything
 * modelled behind it.
 *
 * Everything a house is made of lands in TWO buffers: one vertex-coloured body drawn
 * with the comic-banded material the rest of the scenery uses, and one glass mesh.
 * Colour is per vertex rather than per material, so fifty palettes cost two draw
 * calls a house and one program for the lot; there are no textures anywhere.
 *
 * Weathering is also baked into the vertex colour as it is emitted: sun bleach toward
 * dust, sand splash darkening toward the ground, and per-face patchiness for the
 * abandoned ones. Walls only have vertices at their foot and head, so the splash
 * reads as a soft gradient up the whole wall rather than a band.
 *
 * Coordinates: metres, ground at y = 0, front facing -Z (the gallery and the POI
 * catalogue both look at a building from -Z).
 */

export type P2 = readonly [number, number];
export type P3 = readonly [number, number, number];

export interface Weathering {
  /** 0..1 sun bleach toward a pale dusty tone. */
  readonly fade?: number;
  /** 0..1 sand splash and damp darkening toward the ground. */
  readonly grime?: number;
  /** 0..1 per-face tone scatter: patchy repaint, rot and replaced boards. */
  readonly patchy?: number;
}

export interface WindowStyle {
  /** Frame colour; the builder's `trim` when omitted. */
  readonly frame?: number;
  readonly frameWidth?: number;
  readonly sill?: number;
  readonly shutters?: number;
  /** Mullion and transom. */
  readonly cross?: boolean;
  /** Vertical glazing bars. */
  readonly bars?: number;
  /** Horizontal glazing bars. */
  readonly rails?: number;
  readonly arch?: boolean;
  /** Painted surround wider than the frame (nalichnik, gypsum band, stone dressing). */
  readonly surround?: number;
  readonly surroundWidth?: number;
  /** Planks nailed across: abandoned. The glass stays behind them. */
  readonly boarded?: number;
  /** A heavy block over the head. */
  readonly lintel?: number;
  /** Awning or hood over the window. */
  readonly hood?: number;
}

export interface DoorStyle {
  readonly frame?: number;
  readonly arch?: boolean;
  /** A small pane in the upper leaf. */
  readonly glass?: boolean;
  /** Two raised panels on the leaf, a shade darker. */
  readonly panels?: boolean;
  /** Double leaf with a centre line. */
  readonly double?: boolean;
  readonly step?: number;
  readonly canopy?: number;
  readonly boarded?: number;
  readonly surround?: number;
  /** Where the leaf starts above the facade's own foot, for doors up a stair. */
  readonly v?: number;
}

export interface GableOptions {
  readonly roof: number;
  /** Colour of the triangular gable infill; omitted leaves the gable open to the slabs. */
  readonly wall?: number;
  /** Ridge direction. */
  readonly axis?: 'x' | 'z';
  /** Eave overhang, measured horizontally. */
  readonly over?: number;
  /** Overhang past the gable ends. */
  readonly end?: number;
  readonly thick?: number;
  /** Ridge cap colour; null for none. */
  readonly cap?: number | null;
}

export interface HipOptions {
  readonly roof: number;
  readonly over?: number;
  /** Ridge direction; the longer side when omitted. */
  readonly axis?: 'x' | 'z';
  /** Horizontal inset of each ridge end from the (overhung) footprint end. */
  readonly inset?: number;
}

export interface LatheOptions {
  readonly sx?: number;
  readonly sz?: number;
  readonly phase?: number;
  readonly smooth?: boolean;
  readonly capTop?: boolean;
  readonly capBottom?: boolean;
}

const HEXA_FACES = [
  [0, 1, 2, 3],
  [4, 5, 6, 7],
  [0, 1, 5, 4],
  [1, 2, 6, 5],
  [2, 3, 7, 6],
  [3, 0, 4, 7],
] as const;

/** Dusty and a touch warm: what bleaching and sand both push a wall toward. */
const DUST = new THREE.Color(0xb7a68a);
/** The dark of damp sand and old splash at a wall's foot. */
const SPLASH = new THREE.Color(0x5b4632);

const linearCache = new Map<number, THREE.Color>();
function linear(hex: number): THREE.Color {
  let colour = linearCache.get(hex);
  if (!colour) {
    colour = new THREE.Color(hex);
    linearCache.set(hex, colour);
  }
  return colour;
}

/** sRGB hex scaled toward black (k < 1) or white (k > 1), for trims and shadows. */
export function shade(hex: number, k: number): number {
  const channel = (value: number): number => {
    const scaled = k <= 1 ? value * k : value + (255 - value) * (k - 1);
    return Math.max(0, Math.min(255, Math.round(scaled)));
  };
  return (channel((hex >> 16) & 255) << 16) | (channel((hex >> 8) & 255) << 8) | channel(hex & 255);
}

/** sRGB hex blend. */
export function mix(a: number, b: number, t: number): number {
  const channel = (shift: number): number =>
    Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t);
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

/** Rectangle with a semicircular head, counter-clockwise, `h` the full height. */
export function archOutline(u: number, v: number, w: number, h: number, segments = 8): P2[] {
  const r = w / 2;
  const spring = v + Math.max(0, h - r);
  const points: P2[] = [[u - r, v], [u + r, v]];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI;
    points.push([u + Math.cos(a) * r, spring + Math.sin(a) * r]);
  }
  return points;
}

/** Axis-aligned rectangle outline, counter-clockwise. */
export function rectOutline(u0: number, v0: number, u1: number, v1: number): P2[] {
  return [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
}

function ccw(points: readonly P2[]): P2[] {
  const contour = points.map(([u, v]) => new THREE.Vector2(u, v));
  return THREE.ShapeUtils.isClockWise(contour) ? [...points].reverse() : [...points];
}

function triangulate(points: readonly P2[]): number[][] {
  return THREE.ShapeUtils.triangulateShape(points.map(([u, v]) => new THREE.Vector2(u, v)), []);
}

let bodyMaterial: THREE.MeshStandardMaterial | null = null;
let glassMaterial: THREE.MeshStandardMaterial | null = null;

/** The one body material every dwelling shares: vertex colour, comic banding. */
export function dwellingBodyMaterial(): THREE.MeshStandardMaterial {
  bodyMaterial ??= applyComicShading(
    new THREE.MeshStandardMaterial({ name: 'dwelling-body', vertexColors: true, roughness: 0.86, metalness: 0 }),
    { contourStrength: 0, stippleStrength: 0 },
  );
  return bodyMaterial;
}

let skinMaterial: THREE.MeshStandardMaterial | null = null;

/**
 * The facade skin's material: the body's, pulled towards the eye by a polygon offset.
 * The offset scales with the depth slope and the buffer's own resolution, so a panel a
 * centimetre off its wall wins cleanly at any distance instead of fighting the wall
 * once the depth steps grow past a centimetre.
 */
export function dwellingSkinMaterial(): THREE.MeshStandardMaterial {
  skinMaterial ??= applyComicShading(
    new THREE.MeshStandardMaterial({
      name: 'dwelling-skin',
      vertexColors: true,
      roughness: 0.86,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    }),
    { contourStrength: 0, stippleStrength: 0 },
  );
  return skinMaterial;
}

/** Window panes: the car tint, so a house window and a windscreen are the same glass. */
export function dwellingGlassMaterial(): THREE.MeshStandardMaterial {
  glassMaterial ??= new THREE.MeshStandardMaterial({
    name: 'dwelling-glass',
    ...TINTED_GLASS,
    // A pane is a skin on its wall too (see `dwellingSkinMaterial`).
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
  });
  return glassMaterial;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _t = new THREE.Vector3();
const _n = new THREE.Vector3();
const _w = new THREE.Vector3();
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _na = new THREE.Vector3();
const _nb = new THREE.Vector3();
const _nc = new THREE.Vector3();
const _colour = new THREE.Color();
const _grey = new THREE.Color();
const _euler = new THREE.Euler();
const _quaternion = new THREE.Quaternion();
const _position = new THREE.Vector3();
const UNIT = new THREE.Vector3(1, 1, 1);

export class DwellingBuilder {
  /** Frame colour windows and doors take when their style does not name one. */
  trim = 0xefe6d2;

  private readonly bodyPositions: number[] = [];
  private readonly bodyNormals: number[] = [];
  private readonly bodyColours: number[] = [];
  /**
   * SKIN: everything a facade lays a few centimetres proud of its wall — painted panels,
   * frames, sills, a whole wall in a second colour. Kept apart from the shell and drawn
   * with a polygon offset (see `dwellingSkinMaterial`), because at 1-3 cm off the wall
   * the depth buffer cannot tell the two apart from a couple of hundred metres, and the
   * coloured panel flickered in and out of the white wall behind it.
   */
  private readonly skinPositions: number[] = [];
  private readonly skinNormals: number[] = [];
  private readonly skinColours: number[] = [];
  private skinDepth = 0;
  private readonly glassPositions: number[] = [];
  private readonly glassNormals: number[] = [];
  private matrix = new THREE.Matrix4();
  private readonly stack: THREE.Matrix4[] = [];
  private serial = 0;
  private readonly fade: number;
  private readonly grime: number;
  private readonly patchy: number;
  private readonly display: boolean;

  /**
   * @param display Read every hex as a DISPLAY colour (see `displayColour` in
   *   render/mirage-tableau.ts) instead of sRGB: for unlit forms whose colour must
   *   reach the screen at its own numeric value.
   */
  constructor(weather: Weathering = {}, display = false) {
    this.fade = weather.fade ?? 0;
    this.grime = weather.grime ?? 0.18;
    this.patchy = weather.patchy ?? 0;
    this.display = display;
  }

  /**
   * Draws inside a frame moved to (x, y, z) and turned by yaw about Y, then pitch
   * about X, then roll about Z. Rigid only: normals are carried by the rotation.
   */
  at(x: number, y: number, z: number, yaw: number, draw: () => void, pitch = 0, roll = 0): void {
    this.stack.push(this.matrix.clone());
    _euler.set(pitch, yaw, roll, 'YXZ');
    _quaternion.setFromEuler(_euler);
    _position.set(x, y, z);
    this.matrix.multiply(new THREE.Matrix4().compose(_position, _quaternion, UNIT));
    draw();
    this.matrix = this.stack.pop()!;
  }

  // ---- emission --------------------------------------------------------------

  private shadeInto(hex: number, y: number, serial: number, out: THREE.Color): THREE.Color {
    if (this.display) out.setHex(hex, THREE.LinearSRGBColorSpace);
    else out.copy(linear(hex));
    if (this.fade > 0) {
      const luminance = out.r * 0.2126 + out.g * 0.7152 + out.b * 0.0722;
      _grey.setRGB(luminance, luminance, luminance);
      out.lerp(_grey, this.fade * 0.45).lerp(DUST, this.fade * 0.3);
    }
    if (this.patchy > 0) {
      out.multiplyScalar(1 + (hashUnit2(serial, 0x5eed) - 0.5) * this.patchy * 0.36);
    }
    if (this.grime > 0) {
      const t = Math.min(1, Math.max(0, 1 - y / 1.6));
      out.lerp(SPLASH, this.grime * 0.55 * t * t);
    }
    return out;
  }

  private pushVertex(glass: boolean, p: THREE.Vector3, n: THREE.Vector3, hex: number, serial: number): void {
    if (glass) {
      this.glassPositions.push(p.x, p.y, p.z);
      this.glassNormals.push(n.x, n.y, n.z);
      return;
    }
    const colour = this.shadeInto(hex, p.y, serial, _colour);
    if (this.skinDepth > 0) {
      this.skinPositions.push(p.x, p.y, p.z);
      this.skinNormals.push(n.x, n.y, n.z);
      this.skinColours.push(colour.r, colour.g, colour.b);
      return;
    }
    this.bodyPositions.push(p.x, p.y, p.z);
    this.bodyNormals.push(n.x, n.y, n.z);
    this.bodyColours.push(colour.r, colour.g, colour.b);
  }

  /** Draws `draw` into the facade skin (see `skinPositions`). */
  skin(draw: () => void): void {
    this.skinDepth++;
    try {
      draw();
    } finally {
      this.skinDepth--;
    }
  }

  /** One flat triangle; `outward` (local direction) settles the winding. */
  private emit(glass: boolean, a: P3, b: P3, c: P3, outward: P3 | null, hex: number, serial: number): void {
    _a.set(a[0], a[1], a[2]).applyMatrix4(this.matrix);
    _b.set(b[0], b[1], b[2]).applyMatrix4(this.matrix);
    _c.set(c[0], c[1], c[2]).applyMatrix4(this.matrix);
    _e1.subVectors(_b, _a);
    _e2.subVectors(_c, _a);
    _n.crossVectors(_e1, _e2);
    const length = _n.length();
    if (length < 1e-9) return;
    _n.divideScalar(length);
    if (outward) {
      _w.set(outward[0], outward[1], outward[2]).transformDirection(this.matrix);
      if (_n.dot(_w) < 0) {
        _t.copy(_b);
        _b.copy(_c);
        _c.copy(_t);
        _n.negate();
      }
    }
    // A face lying on the sand, looking down into it, is never seen.
    if (_n.y < -0.98 && _a.y < 0.02 && _b.y < 0.02 && _c.y < 0.02) return;
    this.pushVertex(glass, _a, _n, hex, serial);
    this.pushVertex(glass, _b, _n, hex, serial);
    this.pushVertex(glass, _c, _n, hex, serial);
  }

  /** Smooth triangle: per-vertex local normals, winding checked against them. */
  private emitSmooth(a: P3, b: P3, c: P3, na: P3, nb: P3, nc: P3, hex: number, serial: number): void {
    _a.set(a[0], a[1], a[2]).applyMatrix4(this.matrix);
    _b.set(b[0], b[1], b[2]).applyMatrix4(this.matrix);
    _c.set(c[0], c[1], c[2]).applyMatrix4(this.matrix);
    _na.set(na[0], na[1], na[2]).transformDirection(this.matrix);
    _nb.set(nb[0], nb[1], nb[2]).transformDirection(this.matrix);
    _nc.set(nc[0], nc[1], nc[2]).transformDirection(this.matrix);
    _e1.subVectors(_b, _a);
    _e2.subVectors(_c, _a);
    _n.crossVectors(_e1, _e2);
    if (_n.lengthSq() < 1e-18) return;
    _w.copy(_na).add(_nb).add(_nc);
    if (_n.dot(_w) < 0) {
      _t.copy(_b);
      _b.copy(_c);
      _c.copy(_t);
      _t.copy(_nb);
      _nb.copy(_nc);
      _nc.copy(_t);
    }
    this.pushVertex(false, _a, _na, hex, serial);
    this.pushVertex(false, _b, _nb, hex, serial);
    this.pushVertex(false, _c, _nc, hex, serial);
  }

  /** Convex planar polygon, fan triangulated. */
  poly(points: readonly P3[], hex: number, outward: P3): void {
    const serial = ++this.serial;
    for (let i = 1; i + 1 < points.length; i++) {
      this.emit(false, points[0]!, points[i]!, points[i + 1]!, outward, hex, serial);
    }
  }

  /** Convex planar pane of window glass. */
  glassPoly(points: readonly P3[], outward: P3): void {
    for (let i = 1; i + 1 < points.length; i++) {
      this.emit(true, points[0]!, points[i]!, points[i + 1]!, outward, 0, 0);
    }
  }

  // ---- solids ------------------------------------------------------------------

  /**
   * Any hexahedron: corners 0-3 the bottom ring, 4-7 the top ring above them in the
   * same order. Degenerate faces drop out, so wedges, prisms, hips and pyramids are
   * all this with corners pinched together. Winding is taken from the centroid, which
   * is right for every convex solid.
   */
  hexa(corners: readonly P3[], hex: number, top = hex, bottom = hex): void {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const p of corners) {
      cx += p[0] / 8;
      cy += p[1] / 8;
      cz += p[2] / 8;
    }
    HEXA_FACES.forEach((face, index) => {
      const colour = index === 0 ? bottom : index === 1 ? top : hex;
      let fx = 0;
      let fy = 0;
      let fz = 0;
      for (const k of face) {
        fx += corners[k]![0] / 4;
        fy += corners[k]![1] / 4;
        fz += corners[k]![2] / 4;
      }
      const outward: P3 = [fx - cx, fy - cy, fz - cz];
      const serial = ++this.serial;
      const [i0, i1, i2, i3] = face;
      this.emit(false, corners[i0]!, corners[i1]!, corners[i2]!, outward, colour, serial);
      this.emit(false, corners[i0]!, corners[i2]!, corners[i3]!, outward, colour, serial);
    });
  }

  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, hex: number, top = hex): void {
    const ax = Math.min(x0, x1);
    const bx = Math.max(x0, x1);
    const ay = Math.min(y0, y1);
    const by = Math.max(y0, y1);
    const az = Math.min(z0, z1);
    const bz = Math.max(z0, z1);
    this.hexa(
      [[ax, ay, az], [bx, ay, az], [bx, ay, bz], [ax, ay, bz], [ax, by, az], [bx, by, az], [bx, by, bz], [ax, by, bz]],
      hex,
      top,
    );
  }

  /** A square-section member from `a` to `b`: posts, poles, braces, rafters. */
  beam(a: P3, b: P3, width: number, hex: number, height = width): void {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const length = Math.hypot(dx, dy, dz);
    if (length < 1e-6) return;
    const d = new THREE.Vector3(dx / length, dy / length, dz / length);
    const reference = Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const side = new THREE.Vector3().crossVectors(d, reference).normalize().multiplyScalar(width / 2);
    const up = new THREE.Vector3().crossVectors(side, d).normalize().multiplyScalar(height / 2);
    const corner = (p: P3, s: number, u: number): P3 => [
      p[0] + side.x * s + up.x * u,
      p[1] + side.y * s + up.y * u,
      p[2] + side.z * s + up.z * u,
    ];
    this.hexa(
      [corner(a, -1, -1), corner(a, 1, -1), corner(a, 1, 1), corner(a, -1, 1), corner(b, -1, -1), corner(b, 1, -1), corner(b, 1, 1), corner(b, -1, 1)],
      hex,
    );
  }

  /**
   * Surface of revolution about a vertical axis at (cx, cz). `profile` runs bottom to
   * top as [radius, y]; `hex` may vary by profile segment, which is how painted bands,
   * rings and caps come for free.
   */
  lathe(
    cx: number,
    cz: number,
    profile: readonly P2[],
    segments: number,
    hex: number | ((segment: number) => number),
    options: LatheOptions = {},
  ): void {
    const sx = options.sx ?? 1;
    const sz = options.sz ?? 1;
    const phase = options.phase ?? 0;
    const smooth = options.smooth ?? true;
    const colourOf = (segment: number): number => (typeof hex === 'number' ? hex : hex(segment));
    const segmentNormal: P2[] = [];
    for (let i = 0; i + 1 < profile.length; i++) {
      const [r0, y0] = profile[i]!;
      const [r1, y1] = profile[i + 1]!;
      const nr = y1 - y0;
      const ny = -(r1 - r0);
      const length = Math.hypot(nr, ny) || 1;
      segmentNormal.push([nr / length, ny / length]);
    }
    const vertexNormal = (i: number, segment: number): P2 => {
      const own = segmentNormal[segment]!;
      if (!smooth) return own;
      const neighbour = segmentNormal[i === segment ? segment - 1 : segment + 1];
      if (!neighbour || own[0] * neighbour[0] + own[1] * neighbour[1] < 0.6) return own;
      const nr = own[0] + neighbour[0];
      const ny = own[1] + neighbour[1];
      const length = Math.hypot(nr, ny) || 1;
      return [nr / length, ny / length];
    };
    const point = (r: number, y: number, angle: number): P3 => [
      cx + Math.cos(angle) * r * sx,
      y,
      cz + Math.sin(angle) * r * sz,
    ];
    const normal = (n: P2, angle: number): P3 => {
      const x = (Math.cos(angle) * n[0]) / sx;
      const z = (Math.sin(angle) * n[0]) / sz;
      const length = Math.hypot(x, n[1], z) || 1;
      return [x / length, n[1] / length, z / length];
    };
    for (let i = 0; i + 1 < profile.length; i++) {
      const [r0, y0] = profile[i]!;
      const [r1, y1] = profile[i + 1]!;
      const n0 = vertexNormal(i, i);
      const n1 = vertexNormal(i + 1, i);
      const colour = colourOf(i);
      for (let j = 0; j < segments; j++) {
        const a0 = phase + (j / segments) * Math.PI * 2;
        const a1 = phase + ((j + 1) / segments) * Math.PI * 2;
        const serial = ++this.serial;
        const p00 = point(r0, y0, a0);
        const p01 = point(r0, y0, a1);
        const p10 = point(r1, y1, a0);
        const p11 = point(r1, y1, a1);
        if (smooth) {
          this.emitSmooth(p00, p01, p11, normal(n0, a0), normal(n0, a1), normal(n1, a1), colour, serial);
          this.emitSmooth(p00, p11, p10, normal(n0, a0), normal(n1, a1), normal(n1, a0), colour, serial);
        } else {
          const outward = normal(segmentNormal[i]!, (a0 + a1) / 2);
          this.emit(false, p00, p01, p11, outward, colour, serial);
          this.emit(false, p00, p11, p10, outward, colour, serial);
        }
      }
    }
    const first = profile[0]!;
    const last = profile[profile.length - 1]!;
    const cap = (r: number, y: number, up: boolean, colour: number): void => {
      const ring: P3[] = [];
      for (let j = 0; j < segments; j++) ring.push(point(r, y, phase + (j / segments) * Math.PI * 2));
      this.poly(ring, colour, [0, up ? 1 : -1, 0]);
    };
    if ((options.capBottom ?? true) && first[0] > 1e-4) cap(first[0], first[1], false, colourOf(0));
    if ((options.capTop ?? true) && last[0] > 1e-4) cap(last[0], last[1], true, colourOf(profile.length - 2));
  }

  /**
   * Prism of a 2D outline pushed along X (outline in [z, y]) or Z (outline in [x, y]),
   * from `a0` to `a1`. Concave outlines are fine: the caps are triangulated. With
   * `smooth`, neighbouring side faces within ~53 degrees share normals, which is what
   * makes a vault or a hull read round under the banded light.
   */
  extrude(
    outline: readonly P2[],
    axis: 'x' | 'z',
    a0: number,
    a1: number,
    hex: number,
    options: { readonly cap?: number; readonly smooth?: boolean; readonly caps?: boolean } = {},
  ): void {
    const points = ccw(outline);
    const map = (p: P2, a: number): P3 => (axis === 'x' ? [a, p[1], p[0]] : [p[0], p[1], a]);
    const mapNormal = (n: P2): P3 => (axis === 'x' ? [0, n[1], n[0]] : [n[0], n[1], 0]);
    const edgeNormals: P2[] = points.map((p, i) => {
      const q = points[(i + 1) % points.length]!;
      const du = q[0] - p[0];
      const dv = q[1] - p[1];
      const length = Math.hypot(du, dv) || 1;
      return [dv / length, -du / length];
    });
    const count = points.length;
    const vertexNormal = (vertex: number, edge: number): P3 => {
      const own = edgeNormals[edge]!;
      if (!options.smooth) return mapNormal(own);
      const other = edgeNormals[vertex === edge ? (edge - 1 + count) % count : (edge + 1) % count]!;
      if (own[0] * other[0] + own[1] * other[1] < 0.6) return mapNormal(own);
      const u = own[0] + other[0];
      const v = own[1] + other[1];
      const length = Math.hypot(u, v) || 1;
      return mapNormal([u / length, v / length]);
    };
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count;
      const p0 = map(points[i]!, a0);
      const p1 = map(points[j]!, a0);
      const q0 = map(points[i]!, a1);
      const q1 = map(points[j]!, a1);
      const serial = ++this.serial;
      if (options.smooth) {
        const ni = vertexNormal(i, i);
        const nj = vertexNormal(j, i);
        this.emitSmooth(p0, p1, q1, ni, nj, nj, hex, serial);
        this.emitSmooth(p0, q1, q0, ni, nj, ni, hex, serial);
      } else {
        const outward = mapNormal(edgeNormals[i]!);
        this.emit(false, p0, p1, q1, outward, hex, serial);
        this.emit(false, p0, q1, q0, outward, hex, serial);
      }
    }
    if (options.caps === false) return;
    const capColour = options.cap ?? hex;
    const lo = Math.min(a0, a1);
    const hi = Math.max(a0, a1);
    const out: P3 = axis === 'x' ? [1, 0, 0] : [0, 0, 1];
    const back: P3 = axis === 'x' ? [-1, 0, 0] : [0, 0, -1];
    const serialLo = ++this.serial;
    const serialHi = ++this.serial;
    for (const [i, j, k] of triangulate(points)) {
      this.emit(false, map(points[i!]!, lo), map(points[j!]!, lo), map(points[k!]!, lo), back, capColour, serialLo);
      this.emit(false, map(points[i!]!, hi), map(points[j!]!, hi), map(points[k!]!, hi), out, capColour, serialHi);
    }
  }

  /**
   * Skins rings of equal vertex count, first to last; `closeEnds` fans both end
   * rings shut. Winding comes from each ring's centroid, so every ring must be a
   * convex section — split a concave one (a chevron roof) into convex slabs.
   * `normals`, one per ring vertex, shades the skin smooth instead of faceted.
   */
  loft(
    rings: readonly (readonly P3[])[],
    hex: number | ((ring: number, edge: number) => number),
    closeEnds = true,
    normals?: readonly (readonly P3[])[],
  ): void {
    const colourOf = (ring: number, edge: number): number => (typeof hex === 'number' ? hex : hex(ring, edge));
    const centroid = (ring: readonly P3[]): P3 => {
      let x = 0;
      let y = 0;
      let z = 0;
      for (const p of ring) {
        x += p[0] / ring.length;
        y += p[1] / ring.length;
        z += p[2] / ring.length;
      }
      return [x, y, z];
    };
    const centres = rings.map(centroid);
    for (let r = 0; r + 1 < rings.length; r++) {
      const a = rings[r]!;
      const c = rings[r + 1]!;
      const ca = centres[r]!;
      const cc = centres[r + 1]!;
      const mid: P3 = [(ca[0] + cc[0]) / 2, (ca[1] + cc[1]) / 2, (ca[2] + cc[2]) / 2];
      for (let e = 0; e < a.length; e++) {
        const f = (e + 1) % a.length;
        const p0 = a[e]!;
        const p1 = a[f]!;
        const q0 = c[e]!;
        const q1 = c[f]!;
        const outward: P3 = [
          (p0[0] + p1[0] + q0[0] + q1[0]) / 4 - mid[0],
          (p0[1] + p1[1] + q0[1] + q1[1]) / 4 - mid[1],
          (p0[2] + p1[2] + q0[2] + q1[2]) / 4 - mid[2],
        ];
        const serial = ++this.serial;
        const colour = colourOf(r, e);
        if (normals) {
          const n = normals[r]!;
          const m = normals[r + 1]!;
          this.emitSmooth(p0, p1, q1, n[e]!, n[f]!, m[f]!, colour, serial);
          this.emitSmooth(p0, q1, q0, n[e]!, m[f]!, m[e]!, colour, serial);
        } else {
          this.emit(false, p0, p1, q1, outward, colour, serial);
          this.emit(false, p0, q1, q0, outward, colour, serial);
        }
      }
    }
    if (!closeEnds || rings.length < 2) return;
    const first = centres[0]!;
    const second = centres[1]!;
    const last = centres[centres.length - 1]!;
    const before = centres[centres.length - 2]!;
    this.poly(rings[0]!, colourOf(0, -1), [first[0] - second[0], first[1] - second[1], first[2] - second[2]]);
    this.poly(rings[rings.length - 1]!, colourOf(rings.length - 1, -1), [last[0] - before[0], last[1] - before[1], last[2] - before[2]]);
  }

  /**
   * A round tube along a path: a handle, a spout, a neck. One ring per path point,
   * smooth-shaded, and framed by carrying the previous ring's normal forward (parallel
   * transport) so the sides never twist round a bend. `radius` and `hex` may vary along
   * the path (t runs 0..1 from the first point); both ends are capped, so an end buried
   * in a body leaves no hole if it pokes out.
   */
  tube(
    path: readonly P3[],
    radius: number | ((t: number) => number),
    sides: number,
    hex: number | ((t: number) => number),
  ): void {
    const count = path.length;
    if (count < 2) return;
    const last = count - 1;
    const radiusAt = (i: number): number => (typeof radius === 'number' ? radius : radius(i / last));
    const colourAt = (segment: number): number => (typeof hex === 'number' ? hex : hex((segment + 0.5) / last));
    const tangent = (i: number): THREE.Vector3 => {
      const a = path[Math.max(0, i - 1)]!;
      const b = path[Math.min(last, i + 1)]!;
      return new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    };
    const first = tangent(0);
    const normal = Math.abs(first.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const binormal = new THREE.Vector3();
    const points: P3[][] = [];
    const normals: P3[][] = [];
    let end = first;
    for (let i = 0; i < count; i++) {
      const t = tangent(i);
      end = t;
      normal.addScaledVector(t, -normal.dot(t)).normalize();
      binormal.crossVectors(t, normal);
      const r = radiusAt(i);
      const p = path[i]!;
      const ringPoints: P3[] = [];
      const ringNormals: P3[] = [];
      for (let k = 0; k < sides; k++) {
        const a = (k / sides) * Math.PI * 2;
        const nx = Math.cos(a) * normal.x + Math.sin(a) * binormal.x;
        const ny = Math.cos(a) * normal.y + Math.sin(a) * binormal.y;
        const nz = Math.cos(a) * normal.z + Math.sin(a) * binormal.z;
        ringNormals.push([nx, ny, nz]);
        ringPoints.push([p[0] + nx * r, p[1] + ny * r, p[2] + nz * r]);
      }
      points.push(ringPoints);
      normals.push(ringNormals);
    }
    for (let i = 0; i < last; i++) {
      const colour = colourAt(i);
      const a = points[i]!;
      const b = points[i + 1]!;
      const na = normals[i]!;
      const nb = normals[i + 1]!;
      for (let k = 0; k < sides; k++) {
        const l = (k + 1) % sides;
        const serial = ++this.serial;
        this.emitSmooth(a[k]!, a[l]!, b[l]!, na[k]!, na[l]!, nb[l]!, colour, serial);
        this.emitSmooth(a[k]!, b[l]!, b[k]!, na[k]!, nb[l]!, nb[k]!, colour, serial);
      }
    }
    if (radiusAt(0) > 1e-4) this.poly(points[0]!, colourAt(0), [-first.x, -first.y, -first.z]);
    if (radiusAt(last) > 1e-4) this.poly(points[last]!, colourAt(last - 1), [end.x, end.y, end.z]);
  }

  /**
   * A facade tangent to an upright round or oval wall at `angle` (radians, -PI/2 is
   * the front). Features stay flat, so keep them within a metre or so of the centre.
   */
  radial(cx: number, cz: number, rx: number, rz: number, angle: number, y0 = 0, width = 2, height = 3): Facade {
    const nx = Math.cos(angle) / rx;
    const nz = Math.sin(angle) / rz;
    const length = Math.hypot(nx, nz) || 1;
    const n: P3 = [nx / length, 0, nz / length];
    return new Facade(
      this,
      [cx + Math.cos(angle) * rx, y0, cz + Math.sin(angle) * rz],
      [n[2], 0, -n[0]],
      n,
      width,
      height,
    );
  }

  // ---- building parts --------------------------------------------------------

  /** A block of wall with its four facades, front at z0 looking -Z. */
  mass(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, hex: number, top = hex): Mass {
    this.box(x0, y0, z0, x1, y1, z1, hex, top);
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const width = x1 - x0;
    const depth = z1 - z0;
    const height = y1 - y0;
    return {
      front: new Facade(this, [cx, y0, z0], [-1, 0, 0], [0, 0, -1], width, height),
      back: new Facade(this, [cx, y0, z1], [1, 0, 0], [0, 0, 1], width, height),
      left: new Facade(this, [x0, y0, cz], [0, 0, 1], [-1, 0, 0], depth, height),
      right: new Facade(this, [x1, y0, cz], [0, 0, -1], [1, 0, 0], depth, height),
    };
  }

  /** Two roof slabs over a triangular gable infill, with optional ridge cap. */
  gable(x0: number, x1: number, z0: number, z1: number, eave: number, ridge: number, options: GableOptions): void {
    if ((options.axis ?? 'x') === 'z') {
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      const halfX = (x1 - x0) / 2;
      const halfZ = (z1 - z0) / 2;
      this.at(cx, 0, cz, Math.PI / 2, () => this.gable(-halfZ, halfZ, -halfX, halfX, eave, ridge, { ...options, axis: 'x' }));
      return;
    }
    const zc = (z0 + z1) / 2;
    const half = (z1 - z0) / 2;
    const slope = (ridge - eave) / half;
    const over = options.over ?? 0.35;
    const end = options.end ?? 0.25;
    const thick = options.thick ?? 0.14;
    if (options.wall !== undefined) {
      this.hexa(
        [[x0, eave, z0], [x1, eave, z0], [x1, eave, z1], [x0, eave, z1], [x0, ridge, zc], [x1, ridge, zc], [x1, ridge, zc], [x0, ridge, zc]],
        options.wall,
      );
    }
    const xa = x0 - end;
    const xb = x1 + end;
    for (const side of [-1, 1]) {
      const zEave = zc + side * (half + over);
      const yEave = eave - over * slope;
      this.hexa(
        [
          [xa, yEave, zEave], [xb, yEave, zEave], [xb, ridge, zc], [xa, ridge, zc],
          [xa, yEave + thick, zEave], [xb, yEave + thick, zEave], [xb, ridge + thick, zc], [xa, ridge + thick, zc],
        ],
        options.roof,
      );
    }
    const cap = options.cap === undefined ? shade(options.roof, 0.78) : options.cap;
    if (cap !== null) {
      this.box(xa - 0.02, ridge + thick - 0.04, zc - 0.11, xb + 0.02, ridge + thick + 0.08, zc + 0.11, cap);
    }
  }

  /** A solid hipped roof; a square footprint with no ridge left is a pyramid. */
  hip(x0: number, x1: number, z0: number, z1: number, eave: number, ridge: number, options: HipOptions): void {
    const over = options.over ?? 0.4;
    const width = x1 - x0;
    const depth = z1 - z0;
    const axis = options.axis ?? (width >= depth ? 'x' : 'z');
    const half = (axis === 'x' ? depth : width) / 2;
    const slope = (ridge - eave) / half;
    const y = eave - over * slope;
    const ax = x0 - over;
    const bx = x1 + over;
    const az = z0 - over;
    const bz = z1 + over;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    if (axis === 'x') {
      const inset = Math.min(width / 2 + over, options.inset ?? half + over);
      const ra = ax + inset;
      const rb = bx - inset;
      this.hexa(
        [[ax, y, az], [bx, y, az], [bx, y, bz], [ax, y, bz], [ra, ridge, cz], [rb, ridge, cz], [rb, ridge, cz], [ra, ridge, cz]],
        options.roof,
      );
    } else {
      const inset = Math.min(depth / 2 + over, options.inset ?? half + over);
      const ra = az + inset;
      const rb = bz - inset;
      this.hexa(
        [[ax, y, az], [bx, y, az], [bx, y, bz], [ax, y, bz], [cx, ridge, ra], [cx, ridge, ra], [cx, ridge, rb], [cx, ridge, rb]],
        options.roof,
      );
    }
  }

  /** Mono-pitch slab falling from `high` at z1 to `low` at z0 (or reversed). */
  shed(x0: number, x1: number, z0: number, z1: number, yAtZ0: number, yAtZ1: number, hex: number, over = 0.3, thick = 0.14): void {
    const slope = (yAtZ1 - yAtZ0) / (z1 - z0);
    const za = z0 - over;
    const zb = z1 + over;
    const ya = yAtZ0 - over * slope;
    const yb = yAtZ1 + over * slope;
    const xa = x0 - over;
    const xb = x1 + over;
    this.hexa(
      [[xa, ya, za], [xb, ya, za], [xb, yb, zb], [xa, yb, zb], [xa, ya + thick, za], [xb, ya + thick, za], [xb, yb + thick, zb], [xa, yb + thick, zb]],
      hex,
    );
  }

  /** A wedge of wall filling the gap under a shed roof, flush with the walls. */
  wedge(x0: number, x1: number, z0: number, z1: number, y: number, yAtZ0: number, yAtZ1: number, hex: number): void {
    this.hexa(
      [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [x0, yAtZ0, z0], [x1, yAtZ0, z0], [x1, yAtZ1, z1], [x0, yAtZ1, z1]],
      hex,
    );
  }

  /** Low wall round a flat roof. */
  parapet(x0: number, x1: number, z0: number, z1: number, y: number, height: number, width: number, hex: number): void {
    this.box(x0, y, z0, x1, y + height, z0 + width, hex);
    this.box(x0, y, z1 - width, x1, y + height, z1, hex);
    this.box(x0, y, z0 + width, x0 + width, y + height, z1 - width, hex);
    this.box(x1 - width, y, z0 + width, x1, y + height, z1 - width, hex);
  }

  /** Hemisphere (or any fraction of one, `rise` < 1 flattens it) standing at `y`. */
  dome(cx: number, cz: number, y: number, radius: number, hex: number, rise = 1, segments = 18, rings = 6): void {
    const profile: P2[] = [];
    for (let i = 0; i <= rings; i++) {
      const a = (i / rings) * (Math.PI / 2);
      profile.push([Math.cos(a) * radius, y + Math.sin(a) * radius * rise]);
    }
    this.lathe(cx, cz, profile, segments, hex, { capBottom: false });
  }

  /** Cone from a base ring at `y` to an apex `height` above it. */
  cone(cx: number, cz: number, y: number, radius: number, height: number, hex: number, segments = 14): void {
    this.lathe(cx, cz, [[radius, y], [0, y + height]], segments, hex, { smooth: segments > 10 });
  }

  /** Sphere centred at (cx, cy, cz); `sy` squashes or stretches it vertically. */
  ball(cx: number, cy: number, cz: number, radius: number, hex: number, sy = 1, segments = 12): void {
    const profile: P2[] = [];
    const rings = Math.max(4, Math.round(segments / 2));
    for (let i = 0; i <= rings; i++) {
      const a = -Math.PI / 2 + (i / rings) * Math.PI;
      profile.push([Math.cos(a) * radius, cy + Math.sin(a) * radius * sy]);
    }
    this.lathe(cx, cz, profile, segments, hex);
  }

  cylinder(cx: number, cz: number, y0: number, y1: number, radius: number, hex: number, segments = 14): void {
    this.lathe(cx, cz, [[radius, y0], [radius, y1]], segments, hex, { smooth: segments > 10 });
  }

  chimney(x: number, z: number, y0: number, y1: number, width: number, hex: number, cap = shade(hex, 0.7)): void {
    this.box(x - width / 2, y0, z - width / 2, x + width / 2, y1, z + width / 2, hex);
    this.box(x - width / 2 - 0.06, y1, z - width / 2 - 0.06, x + width / 2 + 0.06, y1 + 0.12, z + width / 2 + 0.06, cap);
    this.box(x - width / 4, y1 + 0.12, z - width / 4, x + width / 4, y1 + 0.16, z + width / 4, 0x2a2622);
  }

  /** Railing of posts and a top rail between two points at ground height `y`. */
  railing(a: P2, b: P2, y: number, height: number, hex: number, posts = 6, width = 0.07): void {
    this.beam([a[0], y + height, a[1]], [b[0], y + height, b[1]], width * 1.2, hex);
    for (let i = 0; i <= posts; i++) {
      const t = i / posts;
      const x = a[0] + (b[0] - a[0]) * t;
      const z = a[1] + (b[1] - a[1]) * t;
      this.box(x - width / 2, y, z - width / 2, x + width / 2, y + height, z + width / 2, hex);
    }
  }

  /** Everything opaque that was drawn, as one vertex-coloured geometry. */
  geometry(): THREE.BufferGeometry {
    const body = new THREE.BufferGeometry();
    // Shell first, skin after it, as two draw groups of one geometry: the shell drawn
    // plain, the skin with a polygon offset (`dwellingGroup`). A consumer that ignores
    // the groups — the collider, a single-material mirage — sees one closed body.
    body.setAttribute('position', new THREE.Float32BufferAttribute([...this.bodyPositions, ...this.skinPositions], 3));
    body.setAttribute('normal', new THREE.Float32BufferAttribute([...this.bodyNormals, ...this.skinNormals], 3));
    body.setAttribute('color', new THREE.Float32BufferAttribute([...this.bodyColours, ...this.skinColours], 3));
    const shell = this.bodyPositions.length / 3;
    const skin = this.skinPositions.length / 3;
    if (skin > 0) {
      body.addGroup(0, shell, 0);
      body.addGroup(shell, skin, 1);
    }
    body.computeBoundingSphere();
    return body;
  }

  /** Every window pane, or null for a house without one. */
  glassGeometry(): THREE.BufferGeometry | null {
    if (this.glassPositions.length === 0) return null;
    const glass = new THREE.BufferGeometry();
    glass.setAttribute('position', new THREE.Float32BufferAttribute(this.glassPositions, 3));
    glass.setAttribute('normal', new THREE.Float32BufferAttribute(this.glassNormals, 3));
    glass.computeBoundingSphere();
    return glass;
  }

  finish(name: string): THREE.Group {
    return dwellingGroup(name, this.geometry(), this.glassGeometry());
  }
}

/**
 * The drawn house over its two geometries. They are not owned by the group: the world
 * caches one pair per dwelling and wraps it again for every placement.
 */
export function dwellingGroup(
  name: string,
  body: THREE.BufferGeometry,
  glass: THREE.BufferGeometry | null,
): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  const bodyMesh = new THREE.Mesh(
    body,
    body.groups.length > 0 ? [dwellingBodyMaterial(), dwellingSkinMaterial()] : dwellingBodyMaterial(),
  );
  bodyMesh.name = `${name}-body`;
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  group.add(bodyMesh);
  if (glass) {
    const glassMesh = new THREE.Mesh(glass, dwellingGlassMaterial());
    glassMesh.name = `${name}-glass`;
    // A pane is a skin on a wall; its shadow would only be the wall's again.
    glassMesh.castShadow = false;
    glassMesh.receiveShadow = true;
    group.add(glassMesh);
  }
  return group;
}

export interface Mass {
  readonly front: Facade;
  readonly back: Facade;
  readonly left: Facade;
  readonly right: Facade;
}

/**
 * One wall seen from outside: `u` runs left to right for a viewer facing it, `v` up
 * from the wall's own foot, and `d` out of the wall. Everything added here is a
 * painted or glazed skin a few centimetres proud of the surface.
 *
 * A facade draws in the builder's CURRENT frame, so use it inside the same `at`
 * scope that created it.
 */
export class Facade {
  constructor(
    private readonly b: DwellingBuilder,
    readonly origin: P3,
    readonly u: P3,
    readonly n: P3,
    readonly width: number,
    readonly height: number,
  ) {}

  p(u: number, v: number, d: number): P3 {
    return [
      this.origin[0] + this.u[0] * u + this.n[0] * d,
      this.origin[1] + v,
      this.origin[2] + this.u[2] * u + this.n[2] * d,
    ];
  }

  /** Box in wall coordinates. */
  box(u0: number, u1: number, v0: number, v1: number, d0: number, d1: number, hex: number): void {
    this.b.skin(() => this.b.hexa(
      [
        this.p(u0, v0, d0), this.p(u1, v0, d0), this.p(u1, v0, d1), this.p(u0, v0, d1),
        this.p(u0, v1, d0), this.p(u1, v1, d0), this.p(u1, v1, d1), this.p(u0, v1, d1),
      ],
      hex,
    ));
  }

  /** Painted shape: any outline, raised `depth` off the wall (starting at `from`). */
  shape(outline: readonly P2[], hex: number, depth = 0.025, from = 0): void {
    this.b.skin(() => this.drawShape(outline, hex, depth, from));
  }

  private drawShape(outline: readonly P2[], hex: number, depth: number, from: number): void {
    const points = ccw(outline);
    const outward = this.n;
    const front = from + depth;
    for (const [i, j, k] of triangulate(points)) {
      const a = points[i!]!;
      const b = points[j!]!;
      const c = points[k!]!;
      this.b.poly([this.p(a[0], a[1], front), this.p(b[0], b[1], front), this.p(c[0], c[1], front)], hex, outward);
    }
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!;
      const c = points[(i + 1) % points.length]!;
      const du = c[0] - a[0];
      const dv = c[1] - a[1];
      const length = Math.hypot(du, dv) || 1;
      const nu = dv / length;
      const nv = -du / length;
      const side: P3 = [this.u[0] * nu, nv, this.u[2] * nu];
      this.b.poly([this.p(a[0], a[1], from), this.p(c[0], c[1], from), this.p(c[0], c[1], front), this.p(a[0], a[1], front)], hex, side);
    }
  }

  /** Convex glass pane at depth `d`. */
  glass(outline: readonly P2[], d = 0.03): void {
    this.b.glassPoly(ccw(outline).map(([u, v]) => this.p(u, v, d)), this.n);
  }

  /** A painted plank from one wall point to another, `width` wide. */
  plank(a: P2, c: P2, width: number, hex: number, depth = 0.03, from = 0.04): void {
    const du = c[0] - a[0];
    const dv = c[1] - a[1];
    const length = Math.hypot(du, dv) || 1;
    const pu = (-dv / length) * (width / 2);
    const pv = (du / length) * (width / 2);
    this.shape([[a[0] - pu, a[1] - pv], [c[0] - pu, c[1] - pv], [c[0] + pu, c[1] + pv], [a[0] + pu, a[1] + pv]], hex, depth, from);
  }

  /** Horizontal band across the whole wall: plinth, string course, cornice. */
  band(v: number, height: number, hex: number, depth = 0.06, over = 0): void {
    this.box(-this.width / 2 - over, this.width / 2 + over, v, v + height, 0, depth, hex);
  }

  window(u: number, v: number, w: number, h: number, style: WindowStyle = {}): void {
    const frame = style.frame ?? this.b.trim;
    const fw = style.frameWidth ?? 0.08;
    const left = u - w / 2;
    const right = u + w / 2;
    const arch = style.arch ?? false;
    const straight = arch ? h - w / 2 : h;
    if (style.surround !== undefined) {
      const sw = style.surroundWidth ?? 0.2;
      const outline = arch
        ? archOutline(u, v - fw - sw * 0.6, w + 2 * (fw + sw), h + fw + sw * 1.6)
        : rectOutline(left - fw - sw, v - fw - sw * 0.6, right + fw + sw, v + h + fw + sw);
      this.shape(outline, style.surround, 0.02);
    }
    const glassDepth = style.surround !== undefined ? 0.035 : 0.02;
    this.glass(arch ? archOutline(u, v, w, h) : rectOutline(left, v, right, v + h), glassDepth);
    // Frame: jambs, head and sill rail. An arched head is a ring of short blocks.
    this.box(left - fw, left, v - fw, v + straight, 0, 0.06, frame);
    this.box(right, right + fw, v - fw, v + straight, 0, 0.06, frame);
    this.box(left - fw, right + fw, v - fw, v, 0, 0.06, frame);
    if (arch) {
      const r = w / 2;
      const segments = 7;
      for (let i = 0; i < segments; i++) {
        const a0 = (i / segments) * Math.PI;
        const a1 = ((i + 1) / segments) * Math.PI;
        this.shape(
          [
            [u + Math.cos(a0) * r, v + straight + Math.sin(a0) * r],
            [u + Math.cos(a0) * (r + fw), v + straight + Math.sin(a0) * (r + fw)],
            [u + Math.cos(a1) * (r + fw), v + straight + Math.sin(a1) * (r + fw)],
            [u + Math.cos(a1) * r, v + straight + Math.sin(a1) * r],
          ],
          frame,
          0.06,
        );
      }
    } else {
      this.box(left - fw, right + fw, v + h, v + h + fw, 0, 0.06, frame);
    }
    const bar = Math.max(0.025, fw * 0.45);
    if (style.cross) {
      this.box(u - bar / 2, u + bar / 2, v, v + straight, 0.02, 0.05, frame);
      const transom = v + straight * 0.64;
      this.box(left, right, transom - bar / 2, transom + bar / 2, 0.02, 0.05, frame);
    }
    for (let i = 1; i <= (style.bars ?? 0); i++) {
      const x = left + (w * i) / ((style.bars ?? 0) + 1);
      this.box(x - bar / 2, x + bar / 2, v, v + straight, 0.02, 0.05, frame);
    }
    for (let i = 1; i <= (style.rails ?? 0); i++) {
      const y = v + (straight * i) / ((style.rails ?? 0) + 1);
      this.box(left, right, y - bar / 2, y + bar / 2, 0.02, 0.05, frame);
    }
    if (style.sill !== undefined) {
      this.box(left - fw - 0.06, right + fw + 0.06, v - fw - 0.07, v - fw, 0, 0.14, style.sill);
    }
    if (style.lintel !== undefined) {
      this.box(left - fw - 0.14, right + fw + 0.14, v + h + fw, v + h + fw + 0.2, 0, 0.1, style.lintel);
    }
    if (style.hood !== undefined) {
      const top = v + h + fw;
      const hood = style.hood;
      this.b.skin(() => this.b.hexa(
        [
          this.p(left - fw - 0.1, top + 0.02, 0), this.p(right + fw + 0.1, top + 0.02, 0),
          this.p(right + fw + 0.1, top - 0.18, 0.42), this.p(left - fw - 0.1, top - 0.18, 0.42),
          this.p(left - fw - 0.1, top + 0.1, 0), this.p(right + fw + 0.1, top + 0.1, 0),
          this.p(right + fw + 0.1, top - 0.12, 0.42), this.p(left - fw - 0.1, top - 0.12, 0.42),
        ],
        hood,
      ));
    }
    if (style.shutters !== undefined) {
      const sw = w / 2 + fw * 0.5;
      const dark = shade(style.shutters, 0.72);
      for (const side of [-1, 1]) {
        const inner = side < 0 ? left - fw - 0.02 : right + fw + 0.02;
        const outer = inner + side * sw;
        this.box(Math.min(inner, outer), Math.max(inner, outer), v - fw * 0.5, v + straight + fw * 0.5, 0, 0.045, style.shutters);
        for (let k = 1; k <= 3; k++) {
          const y = v + (straight * k) / 4;
          this.box(Math.min(inner, outer) + 0.04, Math.max(inner, outer) - 0.04, y - 0.015, y + 0.015, 0.045, 0.055, dark);
        }
      }
    }
    if (style.boarded !== undefined) {
      const slack = 0.12;
      this.plank([left - slack, v + h * 0.2], [right + slack, v + h * 0.34], 0.2, style.boarded, 0.035, 0.065);
      this.plank([left - slack, v + h * 0.62], [right + slack, v + h * 0.54], 0.2, shade(style.boarded, 0.86), 0.035, 0.07);
      this.plank([left, v + h * 0.95], [right, v + h * 0.05], 0.18, shade(style.boarded, 1.12), 0.035, 0.105);
    }
  }

  door(u: number, w: number, h: number, hex: number, style: DoorStyle = {}): void {
    const frame = style.frame ?? this.b.trim;
    const v = style.v ?? 0;
    const left = u - w / 2;
    const right = u + w / 2;
    const fw = 0.09;
    const outline = style.arch ? archOutline(u, v, w, h) : rectOutline(left, v, right, v + h);
    const straight = style.arch ? h - w / 2 : h;
    if (style.surround !== undefined) {
      const sw = 0.28;
      this.shape(
        style.arch ? archOutline(u, v, w + 2 * (fw + sw), h + fw + sw) : rectOutline(left - fw - sw, v, right + fw + sw, v + h + fw + sw),
        style.surround,
        0.018,
      );
    }
    this.shape(outline, hex, 0.035, style.surround !== undefined ? 0.018 : 0);
    const leafFront = (style.surround !== undefined ? 0.018 : 0) + 0.035;
    const dark = shade(hex, 0.74);
    this.box(left - fw, left, v, v + straight, 0, 0.07, frame);
    this.box(right, right + fw, v, v + straight, 0, 0.07, frame);
    if (style.arch) {
      const r = w / 2;
      const segments = 7;
      for (let i = 0; i < segments; i++) {
        const a0 = (i / segments) * Math.PI;
        const a1 = ((i + 1) / segments) * Math.PI;
        this.shape(
          [
            [u + Math.cos(a0) * r, v + straight + Math.sin(a0) * r],
            [u + Math.cos(a0) * (r + fw), v + straight + Math.sin(a0) * (r + fw)],
            [u + Math.cos(a1) * (r + fw), v + straight + Math.sin(a1) * (r + fw)],
            [u + Math.cos(a1) * r, v + straight + Math.sin(a1) * r],
          ],
          frame,
          0.07,
        );
      }
    } else {
      this.box(left - fw, right + fw, v + h, v + h + fw, 0, 0.07, frame);
    }
    if (style.double) this.box(u - 0.015, u + 0.015, v, v + straight, leafFront, leafFront + 0.012, dark);
    if (style.panels) {
      const leaves = style.double ? [left + w / 4, right - w / 4] : [u];
      const pw = (style.double ? w / 2 : w) * 0.3;
      for (const x of leaves) {
        this.box(x - pw, x + pw, v + 0.15, v + straight * 0.42, leafFront, leafFront + 0.015, dark);
        if (!style.glass) this.box(x - pw, x + pw, v + straight * 0.5, v + straight * 0.88, leafFront, leafFront + 0.015, dark);
      }
    }
    if (style.glass) {
      const gw = Math.min(w * 0.5, 0.5);
      this.glass(rectOutline(u - gw / 2, v + straight * 0.55, u + gw / 2, v + straight * 0.86), leafFront + 0.006);
    }
    const knobU = style.double ? u + 0.1 : right - 0.14;
    this.box(knobU - 0.03, knobU + 0.03, v + 0.95, v + 1.02, leafFront, leafFront + 0.05, 0xc9a24a);
    if (style.step !== undefined && v <= 0.001) {
      this.box(left - 0.25, right + 0.25, -0.02, 0.16, 0, 0.45, style.step);
    }
    if (style.canopy !== undefined) {
      this.box(left - 0.35, right + 0.35, v + h + fw + 0.08, v + h + fw + 0.2, 0, 0.75, style.canopy);
    }
    if (style.boarded !== undefined) {
      this.plank([left - 0.1, v + straight * 0.3], [right + 0.1, v + straight * 0.3], 0.22, style.boarded, 0.035, leafFront + 0.01);
      this.plank([left - 0.1, v + straight * 0.72], [right + 0.1, v + straight * 0.66], 0.22, shade(style.boarded, 0.85), 0.035, leafFront + 0.015);
      this.plank([left, v + straight * 0.95], [right, v + 0.1], 0.2, shade(style.boarded, 1.1), 0.035, leafFront + 0.05);
    }
  }
}
