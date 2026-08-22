/**
 * Hand-built cars: three complete models generated in code rather than loaded.
 *
 * These exist alongside the vendored packs and are measured by exactly the same
 * machinery (render/carmodel.ts): each one is a `THREE.Group` with a `body` node and
 * four `wheel-*` nodes, drawn at real-world metres, origin on the ground midway
 * between the wheels, +Z forward and +X to the left. Nothing downstream can tell
 * them apart from a GLB, which is the point — the catalogue entry only names
 * `procedural://<id>` instead of a file.
 *
 * The shapes come from LOFTING: each body is a list of cross-sections along Z, and
 * `loft` stitches consecutive sections into a hull. That is the one technique that
 * makes a curved, believable car body tractable in code — surface detail comes from
 * where the sections sit and how their outlines change, not from thousands of
 * hand-placed boxes. Sections are authored as half-outlines (x >= 0) and mirrored,
 * so a body is symmetrical by construction and one table edit changes both flanks.
 *
 * Geometry is deliberately non-indexed and flat-shaded: every quad gets its own
 * normals, which is what gives these the crisp faceted look the rest of the game
 * has instead of a smeared low-poly blob.
 */

import * as THREE from 'three';

/* ---------------------------------------------------------------------------
 * Materials. Small local cache: these are shared by every instance of every
 * procedural car, and nothing writes to them per instance.
 * ------------------------------------------------------------------------- */

const materialCache = new Map<string, THREE.MeshStandardMaterial>();

interface Finish {
  readonly color: number;
  readonly metalness?: number;
  readonly roughness?: number;
  readonly opacity?: number;
  /** Emissive strength for lamps, so they read as lit at dusk. */
  readonly glow?: number;
}

function mat(finish: Finish): THREE.MeshStandardMaterial {
  const key = `${finish.color}:${finish.metalness ?? 0}:${finish.roughness ?? 0.6}:${finish.opacity ?? 1}:${finish.glow ?? 0}`;
  let m = materialCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: finish.color,
      metalness: finish.metalness ?? 0,
      roughness: finish.roughness ?? 0.6,
      transparent: (finish.opacity ?? 1) < 1,
      opacity: finish.opacity ?? 1,
      flatShading: true,
      side: THREE.DoubleSide,
    });
    if (finish.glow) {
      m.emissive = new THREE.Color(finish.color);
      m.emissiveIntensity = finish.glow;
    }
    materialCache.set(key, m);
  }
  return m;
}

const CHROME = { color: 0xd8dde2, metalness: 0.95, roughness: 0.22 };
const GLASS = { color: 0x9fc4cf, metalness: 0.1, roughness: 0.06, opacity: 0.55 };
const RUBBER = { color: 0x14161a, roughness: 0.92 };
const MATTE_BLACK = { color: 0x1b1e22, roughness: 0.8 };
const LAMP_WARM = { color: 0xfff0c8, roughness: 0.3, glow: 0.6 };
const LAMP_RED = { color: 0xb4231c, roughness: 0.35, glow: 0.45 };

/* ---------------------------------------------------------------------------
 * Lofting
 * ------------------------------------------------------------------------- */

/** One cross-section: a half-outline in the XY plane at a station along Z. */
interface Section {
  readonly z: number;
  /**
   * Outline points from the centreline up and back down, x >= 0. Mirrored to the
   * other flank automatically, so a point at x = 0 becomes a single spine vertex.
   */
  readonly pts: readonly (readonly [number, number])[];
}

/** Mirrors a half-outline into a full closed loop, dropping duplicate spine points. */
function fullLoop(pts: readonly (readonly [number, number])[]): [number, number][] {
  const loop: [number, number][] = pts.map(([x, y]) => [x, y]);
  for (let i = pts.length - 1; i >= 0; i--) {
    const [x, y] = pts[i];
    if (x <= 1e-6) continue; // spine points are shared, not duplicated
    loop.push([-x, y]);
  }
  return loop;
}

function pushTri(
  target: number[],
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  c: readonly [number, number, number],
): void {
  target.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
}

/**
 * Stitches sections into a hull.
 *
 * Every section must have the same point count: a loft is a quad grid, and letting
 * counts differ is what turns a hull into a mess of slivers. `capFront`/`capBack`
 * fan-close the end sections; leave them off where another piece butts against it.
 */
function loft(
  sections: readonly Section[],
  { capFront = true, capBack = true }: { capFront?: boolean; capBack?: boolean } = {},
): THREE.BufferGeometry {
  const loops = sections.map((s) => fullLoop(s.pts));
  const n = loops[0].length;
  for (const loop of loops) {
    if (loop.length !== n) throw new Error('loft: sections must share a point count');
  }

  const verts: number[] = [];
  for (let i = 0; i < loops.length - 1; i++) {
    const z0 = sections[i].z;
    const z1 = sections[i + 1].z;
    const a = loops[i];
    const b = loops[i + 1];
    for (let j = 0; j < n; j++) {
      const k = (j + 1) % n;
      const p0: [number, number, number] = [a[j][0], a[j][1], z0];
      const p1: [number, number, number] = [a[k][0], a[k][1], z0];
      const p2: [number, number, number] = [b[k][0], b[k][1], z1];
      const p3: [number, number, number] = [b[j][0], b[j][1], z1];
      pushTri(verts, p0, p1, p2);
      pushTri(verts, p0, p2, p3);
    }
  }

  const cap = (index: number, flip: boolean): void => {
    const loop = loops[index];
    const z = sections[index].z;
    // Fan from the loop's centroid: these outlines are convex enough for it, and it
    // keeps the cap's facets consistent with the hull's.
    let cx = 0;
    let cy = 0;
    for (const [x, y] of loop) {
      cx += x;
      cy += y;
    }
    cx /= loop.length;
    cy /= loop.length;
    for (let j = 0; j < loop.length; j++) {
      const k = (j + 1) % loop.length;
      const a: [number, number, number] = [loop[j][0], loop[j][1], z];
      const b: [number, number, number] = [loop[k][0], loop[k][1], z];
      const c: [number, number, number] = [cx, cy, z];
      if (flip) pushTri(verts, b, a, c);
      else pushTri(verts, a, b, c);
    }
  };
  if (capBack) cap(0, true);
  if (capFront) cap(loops.length - 1, false);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** Interpolates a rounded rectangle half-outline: the workhorse body section. */
function roundedHalf(
  halfWidth: number,
  bottom: number,
  top: number,
  radius: number,
  steps = 3,
): [number, number][] {
  const r = Math.min(radius, Math.min(halfWidth, (top - bottom) / 2));
  const pts: [number, number][] = [[0, bottom]];
  pts.push([halfWidth - r, bottom]);
  for (let i = 1; i <= steps; i++) {
    const t = (i / (steps + 1)) * (Math.PI / 2);
    pts.push([halfWidth - r + Math.sin(t) * r, bottom + r - Math.cos(t) * r]);
  }
  pts.push([halfWidth, bottom + r]);
  pts.push([halfWidth, top - r]);
  for (let i = 1; i <= steps; i++) {
    const t = (i / (steps + 1)) * (Math.PI / 2);
    pts.push([halfWidth - r + Math.cos(t) * r, top - r + Math.sin(t) * r]);
  }
  pts.push([halfWidth - r, top]);
  pts.push([0, top]);
  return pts;
}

/* ---------------------------------------------------------------------------
 * Parts
 * ------------------------------------------------------------------------- */

interface Builder {
  add(geometry: THREE.BufferGeometry, finish: Finish, transform?: THREE.Matrix4): void;
  group: THREE.Group;
}

function builder(name: string): Builder {
  const group = new THREE.Group();
  group.name = name;
  return {
    group,
    add(geometry, finish, transform) {
      const mesh = new THREE.Mesh(geometry, mat(finish));
      if (transform) mesh.applyMatrix4(transform);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    },
  };
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

function at(x: number, y: number, z: number, euler?: readonly [number, number, number]): THREE.Matrix4 {
  _v.set(x, y, z);
  if (euler) _q.setFromEuler(new THREE.Euler(euler[0], euler[1], euler[2]));
  else _q.identity();
  return new THREE.Matrix4().compose(_v, _q, _s);
}

/** A box, centred on its own origin. */
function box(w: number, h: number, d: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d);
}

/** A cylinder along Z (tube stock, exhausts, roll cage) . */
function tube(radius: number, length: number, segments = 8): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(radius, radius, length, segments);
  g.rotateX(Math.PI / 2);
  return g;
}

/**
 * A wheel: tyre, rim face and a hub, built about the X axis so the vehicle can spin
 * it about X the way it spins every other wheel in the game.
 *
 * `tread` cuts blocks out of the sidewall silhouette, which is what separates a
 * knobbly off-road tyre from a road one at this poly count.
 */
function wheelGroup(
  name: string,
  radius: number,
  width: number,
  rim: Finish,
  tread: boolean,
): THREE.Group {
  const b = builder(name);
  const segments = tread ? 14 : 16;

  // Tyre as a lathe about X: two side walls plus a tread band.
  const tyre = new THREE.CylinderGeometry(radius, radius, width, segments, 1, true);
  tyre.rotateZ(Math.PI / 2);
  b.add(tyre, RUBBER);
  const shoulder = new THREE.CylinderGeometry(radius * 0.86, radius * 0.86, width * 1.02, segments);
  shoulder.rotateZ(Math.PI / 2);
  b.add(shoulder, RUBBER);

  if (tread) {
    // Chunky blocks standing proud of the carcass, alternating across the tread.
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const lug = box(width * 0.42, radius * 0.16, radius * 0.34);
      const t = at(
        (i % 2 === 0 ? 1 : -1) * width * 0.22,
        Math.sin(a) * radius,
        Math.cos(a) * radius,
        [-a, 0, 0],
      );
      b.add(lug, RUBBER, t);
    }
  }

  // Rim: a dished face either side, so the wheel reads as a wheel from any angle.
  for (const side of [-1, 1]) {
    const face = new THREE.CylinderGeometry(radius * 0.62, radius * 0.66, width * 0.12, segments);
    face.rotateZ(Math.PI / 2);
    b.add(face, rim, at(side * width * 0.42, 0, 0));
    const hub = new THREE.CylinderGeometry(radius * 0.16, radius * 0.16, width * 0.2, 8);
    hub.rotateZ(Math.PI / 2);
    b.add(hub, CHROME, at(side * width * 0.46, 0, 0));
    // Spokes: five bars, which at this scale is all it takes to read as an alloy.
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const spoke = box(width * 0.1, radius * 0.5, radius * 0.14);
      b.add(
        spoke,
        rim,
        at(side * width * 0.46, Math.sin(a) * radius * 0.3, Math.cos(a) * radius * 0.3, [-a, 0, 0]),
      );
    }
  }
  return b.group;
}

/* ---------------------------------------------------------------------------
 * Car 1 — "Wedge": a Group-B rally coupe. Flat wedge nose, boxed arches, a
 * glasshouse cut straight off the top and a wing you could serve dinner on.
 * ------------------------------------------------------------------------- */

const WEDGE_PAINT = { color: 0xe8e4dc, metalness: 0.45, roughness: 0.38 };
const WEDGE_ACCENT = { color: 0xc8341f, roughness: 0.45 };

function wedge(): THREE.Group {
  const b = builder('body');

  // Lower hull: a wedge in side view (nose 0.42 high, tail 0.78) with the flanks
  // pulled in at both ends so the arches can stand outside them.
  const hull: Section[] = [
    { z: -2.0, pts: roundedHalf(0.72, 0.24, 0.82, 0.1) },
    { z: -1.62, pts: roundedHalf(0.86, 0.2, 0.86, 0.12) },
    { z: -0.6, pts: roundedHalf(0.9, 0.18, 0.9, 0.12) },
    { z: 0.5, pts: roundedHalf(0.9, 0.18, 0.84, 0.12) },
    { z: 1.44, pts: roundedHalf(0.84, 0.2, 0.66, 0.14) },
    { z: 1.92, pts: roundedHalf(0.72, 0.26, 0.5, 0.12) },
    { z: 2.06, pts: roundedHalf(0.6, 0.34, 0.46, 0.1) },
  ];
  b.add(loft(hull), WEDGE_PAINT);

  // Glasshouse: a separate, narrower loft sitting on the beltline, tapering to a
  // fastback. Kept as its own piece so the glass and the roof can differ.
  const cabin: Section[] = [
    { z: -1.35, pts: roundedHalf(0.74, 0.86, 0.98, 0.06) },
    { z: -0.95, pts: roundedHalf(0.78, 0.86, 1.2, 0.1) },
    { z: 0.05, pts: roundedHalf(0.8, 0.86, 1.26, 0.12) },
    { z: 0.72, pts: roundedHalf(0.76, 0.86, 1.16, 0.14) },
    { z: 1.0, pts: roundedHalf(0.7, 0.86, 0.92, 0.1) },
  ];
  b.add(loft(cabin, { capFront: false, capBack: false }), GLASS);

  // Roof skin over the glass, so the cabin is not one dark lump, plus a scoop.
  b.add(box(1.46, 0.06, 1.5), WEDGE_PAINT, at(0, 1.27, -0.35));
  b.add(box(0.5, 0.1, 0.6), MATTE_BLACK, at(0, 1.33, -0.1));

  // Flared arches: blisters that arc OVER each tyre, their outer face flush with
  // the tread rather than standing a hand's width outboard of it. The bottom edge
  // starts above the wheel centre so the tyre is visible under the flare — that
  // gap is what makes a car look like it has wheels rather than skirts.
  for (const [z, halfLen] of [
    [1.32, 0.56],
    [-1.28, 0.6],
  ] as const) {
    for (const side of [1, -1] as const) {
      const arch: Section[] = [
        { z: -halfLen, pts: roundedHalf(0.1, 0.5, 0.78, 0.06) },
        { z: -halfLen * 0.5, pts: roundedHalf(0.17, 0.44, 0.9, 0.1) },
        { z: halfLen * 0.5, pts: roundedHalf(0.17, 0.44, 0.9, 0.1) },
        { z: halfLen, pts: roundedHalf(0.1, 0.5, 0.78, 0.06) },
      ];
      const g = loft(arch);
      g.translate(side * 0.84, 0, z);
      b.add(g, WEDGE_PAINT);
    }
  }

  // Front: a splitter tucked under the nose (not a diving board), a slatted grille
  // and square lamps sunk into the wedge.
  b.add(box(1.66, 0.06, 0.24), MATTE_BLACK, at(0, 0.22, 2.02));
  b.add(box(1.1, 0.16, 0.06), MATTE_BLACK, at(0, 0.36, 2.1));
  for (const side of [1, -1] as const) {
    b.add(box(0.34, 0.16, 0.06), LAMP_WARM, at(side * 0.48, 0.44, 2.06));
    b.add(box(0.3, 0.12, 0.05), LAMP_RED, at(side * 0.5, 0.5, -1.99));
  }
  // Bonnet vents, hinted with two dark slots.
  for (const side of [1, -1] as const) b.add(box(0.34, 0.03, 0.16), MATTE_BLACK, at(side * 0.34, 0.86, 1.5));

  // Rear wing on twin stanchions, and a tailpipe pair.
  b.add(box(1.72, 0.05, 0.34), WEDGE_ACCENT, at(0, 1.28, -1.9));
  for (const side of [1, -1] as const) {
    b.add(box(0.06, 0.34, 0.16), MATTE_BLACK, at(side * 0.62, 1.1, -1.88));
    b.add(tube(0.055, 0.3), CHROME, at(side * 0.3, 0.28, -2.12));
  }
  // Sill stripes: the accent colour, low on the flanks.
  for (const side of [1, -1] as const) b.add(box(0.03, 0.1, 2.3), WEDGE_ACCENT, at(side * 0.91, 0.34, -0.1));

  // Mirrors on stalks.
  for (const side of [1, -1] as const) {
    b.add(tube(0.02, 0.16), MATTE_BLACK, at(side * 0.86, 0.94, 0.9, [0, Math.PI / 2, 0]));
    b.add(box(0.06, 0.1, 0.16), MATTE_BLACK, at(side * 0.98, 0.96, 0.9));
  }

  const car = new THREE.Group();
  car.add(b.group);
  const rim = { color: 0xd9b23a, metalness: 0.7, roughness: 0.35 };
  addWheels(car, 0.35, 0.26, 0.84, 1.32, -1.28, rim, false);
  return car;
}

/* ---------------------------------------------------------------------------
 * Car 2 — "Streamliner": a late-thirties aero saloon. Teardrop plan, pontoon
 * fenders swallowing the wheels, split screen, boat tail, far too much chrome.
 * ------------------------------------------------------------------------- */

const STREAM_PAINT = { color: 0x1d4536, metalness: 0.55, roughness: 0.3 };
const STREAM_TRIM = { color: 0xd9cfae, roughness: 0.5 };

function streamliner(): THREE.Group {
  const b = builder('body');

  // The hull is a true teardrop: widest at the cowl, tapering to a rounded tail.
  const hull: Section[] = [
    { z: -2.35, pts: roundedHalf(0.34, 0.34, 0.7, 0.16, 4) },
    { z: -2.0, pts: roundedHalf(0.56, 0.28, 0.86, 0.2, 4) },
    { z: -1.3, pts: roundedHalf(0.8, 0.24, 1.0, 0.24, 4) },
    { z: -0.3, pts: roundedHalf(0.88, 0.22, 1.04, 0.26, 4) },
    { z: 0.6, pts: roundedHalf(0.86, 0.22, 1.0, 0.26, 4) },
    { z: 1.4, pts: roundedHalf(0.78, 0.24, 0.86, 0.24, 4) },
    { z: 2.05, pts: roundedHalf(0.62, 0.3, 0.72, 0.2, 4) },
    { z: 2.35, pts: roundedHalf(0.4, 0.38, 0.62, 0.14, 4) },
  ];
  b.add(loft(hull), STREAM_PAINT);

  // Cabin: narrow, tall, set well back, with a rounded roof and a fastback that
  // melts into the tail — the whole point of the shape.
  const cabin: Section[] = [
    { z: -1.5, pts: roundedHalf(0.6, 0.98, 1.14, 0.14, 4) },
    { z: -1.05, pts: roundedHalf(0.72, 0.98, 1.42, 0.2, 4) },
    { z: -0.2, pts: roundedHalf(0.74, 0.98, 1.5, 0.22, 4) },
    { z: 0.55, pts: roundedHalf(0.68, 0.98, 1.36, 0.2, 4) },
    { z: 0.95, pts: roundedHalf(0.56, 0.98, 1.1, 0.16, 4) },
  ];
  b.add(loft(cabin, { capFront: false, capBack: false }), GLASS);
  // Painted roof and pillars over the glass loft.
  b.add(box(1.3, 0.07, 1.5), STREAM_PAINT, at(0, 1.5, -0.45));
  for (const side of [1, -1] as const) {
    b.add(box(0.07, 0.5, 0.1), STREAM_PAINT, at(side * 0.66, 1.2, 0.86, [0, 0, side * 0.25]));
    b.add(box(0.07, 0.46, 0.12), STREAM_PAINT, at(side * 0.68, 1.2, -1.35, [0, 0, -side * 0.2]));
  }
  // Split windscreen: a centre bar is the single detail that dates the shape.
  b.add(box(0.05, 0.42, 0.06), CHROME, at(0, 1.22, 0.92, [0.32, 0, 0]));

  // Pontoon fenders: half-teardrops arcing over each wheel. Their bottom edge sits
  // just above the wheel centre, so the tyre shows beneath — hung lower (as they
  // first were) they swallowed the wheels whole and the car read as a boat with
  // skirts. Their outer face lines up with the tread, not outboard of it.
  for (const [z, len, height, out] of [
    [1.42, 0.76, 1.06, 0.82],
    [-1.42, 0.82, 1.04, 0.82],
  ] as const) {
    for (const side of [1, -1] as const) {
      const fender: Section[] = [
        { z: -len, pts: roundedHalf(0.12, 0.56, height * 0.7, 0.08, 3) },
        { z: -len * 0.5, pts: roundedHalf(0.22, 0.48, height * 0.94, 0.14, 3) },
        { z: 0, pts: roundedHalf(0.24, 0.46, height, 0.16, 3) },
        { z: len * 0.5, pts: roundedHalf(0.22, 0.48, height * 0.94, 0.14, 3) },
        { z: len, pts: roundedHalf(0.12, 0.56, height * 0.7, 0.08, 3) },
      ];
      const g = loft(fender);
      g.translate(side * out, 0, z);
      b.add(g, STREAM_PAINT);
    }
  }

  // Prow: a tall narrow grille with chrome bars, faired headlamps either side.
  b.add(box(0.5, 0.62, 0.1), CHROME, at(0, 0.62, 2.3));
  for (let i = 0; i < 7; i++) b.add(box(0.44, 0.02, 0.14), STREAM_PAINT, at(0, 0.38 + i * 0.08, 2.32));
  for (const side of [1, -1] as const) {
    b.add(new THREE.SphereGeometry(0.16, 10, 8), STREAM_TRIM, at(side * 0.62, 0.78, 2.02));
    b.add(new THREE.SphereGeometry(0.11, 10, 8), LAMP_WARM, at(side * 0.66, 0.78, 2.12));
    // Running boards along the sills, between the fenders.
    b.add(box(0.22, 0.05, 1.5), MATTE_BLACK, at(side * 0.84, 0.3, 0));
    // Chrome spear down the flank: the era's favourite trick.
    b.add(box(0.02, 0.04, 3.3), CHROME, at(side * 0.9, 0.72, -0.1));
    // Tail lamps on little chrome plinths.
    b.add(new THREE.SphereGeometry(0.07, 8, 6), LAMP_RED, at(side * 0.5, 0.78, -2.32));
  }
  // Spare wheel faired into the boat tail, and a pair of exhaust tips.
  b.add(new THREE.CylinderGeometry(0.3, 0.3, 0.14, 14), STREAM_PAINT, at(0, 0.72, -2.36, [Math.PI / 2, 0, 0]));
  b.add(tube(0.05, 0.26), CHROME, at(0.3, 0.3, -2.4));

  const car = new THREE.Group();
  car.add(b.group);
  const rim = { color: 0xd9cfae, metalness: 0.35, roughness: 0.5 };
  addWheels(car, 0.42, 0.22, 0.82, 1.42, -1.42, rim, false);
  return car;
}

/* ---------------------------------------------------------------------------
 * Car 3 — "Dune runner": an open desert buggy. Exposed tube frame, single seat
 * pod, long-travel arms, huge knobbly tyres and a light bar.
 * ------------------------------------------------------------------------- */

const BUGGY_FRAME = { color: 0xb75b1e, metalness: 0.5, roughness: 0.45 };
const BUGGY_PANEL = { color: 0xd8b25c, roughness: 0.65 };

function duneRunner(): THREE.Group {
  const b = builder('body');

  // Central tub: a shallow monocoque the driver sits in, tapering at both ends.
  const tub: Section[] = [
    { z: -1.5, pts: roundedHalf(0.5, 0.42, 0.78, 0.12, 3) },
    { z: -0.9, pts: roundedHalf(0.62, 0.38, 0.86, 0.14, 3) },
    { z: 0.2, pts: roundedHalf(0.64, 0.36, 0.82, 0.14, 3) },
    { z: 1.1, pts: roundedHalf(0.5, 0.4, 0.7, 0.12, 3) },
    { z: 1.6, pts: roundedHalf(0.34, 0.46, 0.62, 0.1, 3) },
  ];
  b.add(loft(tub), BUGGY_PANEL);

  // Roll cage: a hoop over the cockpit, a windscreen hoop, and the spars that tie
  // them together. All the same tube stock, because that is how one is welded up.
  const R = 0.045;
  const hoop = (topY: number, halfW: number, z: number, lean: number): void => {
    b.add(tube(R, topY - 0.5), BUGGY_FRAME, at(halfW, (topY + 0.5) / 2, z, [Math.PI / 2, 0, 0]));
    b.add(tube(R, topY - 0.5), BUGGY_FRAME, at(-halfW, (topY + 0.5) / 2, z, [Math.PI / 2, 0, 0]));
    b.add(tube(R, halfW * 2), BUGGY_FRAME, at(0, topY, z + lean, [0, Math.PI / 2, 0]));
  };
  hoop(1.36, 0.6, -0.55, 0);
  hoop(1.16, 0.56, 0.62, 0);
  for (const side of [1, -1] as const) {
    // Roof spars and the diagonal brace back to the engine bay.
    b.add(tube(R, 1.2), BUGGY_FRAME, at(side * 0.58, 1.3, 0.03, [0.17, 0, 0]));
    b.add(tube(R, 1.35), BUGGY_FRAME, at(side * 0.58, 0.95, -1.18, [-0.75, 0, 0]));
    b.add(tube(R, 0.8), BUGGY_FRAME, at(side * 0.58, 0.72, 1.1, [0.9, 0, 0]));
  }

  // Cockpit: a bucket seat, a wheel on a raked column, a roll of gauges.
  b.add(box(0.44, 0.1, 0.44), MATTE_BLACK, at(0.16, 0.62, -0.42));
  b.add(box(0.42, 0.5, 0.08), MATTE_BLACK, at(0.16, 0.86, -0.62, [-0.22, 0, 0]));
  b.add(tube(0.025, 0.34), MATTE_BLACK, at(0.16, 0.86, 0.16, [-0.9, 0, 0]));
  b.add(new THREE.TorusGeometry(0.14, 0.022, 6, 14), MATTE_BLACK, at(0.16, 0.98, 0.28, [0.65, 0, 0]));
  b.add(box(0.3, 0.12, 0.1), MATTE_BLACK, at(0.16, 1.02, 0.42, [0.3, 0, 0]));

  // Engine out the back, air filter proud of the deck, and side pipes.
  b.add(box(0.62, 0.44, 0.6), MATTE_BLACK, at(0, 0.7, -1.35));
  b.add(new THREE.CylinderGeometry(0.16, 0.16, 0.2, 10), CHROME, at(0, 1.02, -1.35));
  for (const side of [1, -1] as const) {
    b.add(tube(0.05, 0.9), CHROME, at(side * 0.42, 0.62, -1.85, [0.25, 0, 0]));
  }

  // Nose: a skid plate, a spare strapped flat, and a light bar on the front hoop.
  b.add(box(1.0, 0.06, 0.5), BUGGY_FRAME, at(0, 0.4, 1.62));
  b.add(new THREE.CylinderGeometry(0.34, 0.34, 0.26, 12), RUBBER, at(0, 0.72, -1.95, [Math.PI / 2, 0, 0]));
  b.add(box(1.0, 0.1, 0.12), MATTE_BLACK, at(0, 1.42, -0.5));
  for (let i = -2; i <= 2; i++) {
    b.add(new THREE.CylinderGeometry(0.075, 0.075, 0.08, 10), LAMP_WARM, at(i * 0.2, 1.42, -0.44, [Math.PI / 2, 0, 0]));
  }
  for (const side of [1, -1] as const) {
    // Long-travel arms, angled down and out to where the wheels actually are.
    for (const z of [1.28, -1.22] as const) {
      b.add(tube(0.05, 0.62), BUGGY_FRAME, at(side * 0.52, 0.5, z, [0, side * 1.25, 0]));
      b.add(tube(0.035, 0.5), MATTE_BLACK, at(side * 0.5, 0.78, z, [0, side * 1.05, -side * 0.5]));
    }
  }

  const car = new THREE.Group();
  car.add(b.group);
  const rim = { color: 0x2a2d31, metalness: 0.55, roughness: 0.5 };
  addWheels(car, 0.46, 0.34, 0.86, 1.28, -1.22, rim, true);
  return car;
}

/* ---------------------------------------------------------------------------
 * Assembly
 * ------------------------------------------------------------------------- */

/**
 * Adds the four wheels and drops the whole car so its tyres touch y = 0.
 *
 * The loader measures a model assuming its origin is on the ground (that is where
 * every pack puts it), so the last thing each builder does is push its geometry up
 * by one wheel radius rather than leaving the tables to remember it.
 */
function addWheels(
  car: THREE.Group,
  radius: number,
  width: number,
  halfTrack: number,
  frontZ: number,
  rearZ: number,
  rim: Finish,
  tread: boolean,
): void {
  for (const child of car.children) child.position.y += radius;

  for (const [name, x, z] of [
    ['wheel-front-left', halfTrack, frontZ],
    ['wheel-front-right', -halfTrack, frontZ],
    ['wheel-back-left', halfTrack, rearZ],
    ['wheel-back-right', -halfTrack, rearZ],
  ] as const) {
    const wheel = wheelGroup(name, radius, width, rim, tread);
    wheel.position.set(x, radius, z);
    car.add(wheel);
  }
}

const BUILDERS: Record<string, () => THREE.Group> = {
  wedge,
  streamliner,
  dunerunner: duneRunner,
};

/** Builds one procedural car by id. Called once per model, at preload. */
export function proceduralCarScene(id: string): THREE.Group {
  const build = BUILDERS[id];
  if (!build) throw new Error(`Unknown procedural car "${id}"`);
  const car = build();
  car.name = id;
  return car;
}

/** Releases the shared materials. Geometry is owned by the templates. */
export function disposeProceduralMaterials(): void {
  for (const m of materialCache.values()) m.dispose();
  materialCache.clear();
}
