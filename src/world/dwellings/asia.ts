import { DwellingBuilder, Facade, archOutline, rectOutline, shade, type P2, type P3 } from './builder';
import { battens, flower, steps } from './parts';

const FRONT: P3 = [0, 0, -1];
const LEFT_U: P3 = [-1, 0, 0];

function frontAt(b: DwellingBuilder, z: number, width: number, height: number, x = 0): Facade {
  return new Facade(b, [x, 0, z], LEFT_U, FRONT, width, height);
}

/** Edo-period minka: plaster and dark timber, shoji, an engawa and an irimoya thatch. */
export function minka(b: DwellingBuilder): void {
  const plaster = 0xefe9da;
  const timber = 0x3a2a1e;
  const thatch = 0xa18d64;
  const tile = 0x4a4e52;
  const paper = 0xf6f1e3;
  b.trim = timber;
  b.box(-6.3, 0, -4.3, 6.3, 0.5, 4.3, 0x9a968c);
  const house = b.mass(-6, 6, 0.5, 3.3, -4, 4, plaster);
  const frame = (f: Facade): number => {
    f.box(-f.width / 2, f.width / 2, 0, 0.16, 0, 0.05, timber);
    f.box(-f.width / 2, f.width / 2, 1.85, 2.0, 0, 0.05, timber);
    f.box(-f.width / 2, f.width / 2, 2.65, 2.8, 0, 0.05, timber);
    const bays = Math.round(f.width / 1.8);
    for (let i = 0; i <= bays; i++) {
      const u = -f.width / 2 + (f.width * i) / bays;
      f.box(u - 0.09, u + 0.09, 0, 2.8, 0, 0.06, timber);
    }
    return f.width / bays;
  };
  const shoji = (f: Facade, u0: number, u1: number): void => {
    f.shape(rectOutline(u0, 0.16, u1, 1.85), paper, 0.02);
    for (let u = u0 + 0.28; u < u1 - 0.05; u += 0.28) f.box(u - 0.015, u + 0.015, 0.16, 1.85, 0.02, 0.035, timber);
    for (let v = 0.5; v < 1.85; v += 0.34) f.box(u0, u1, v - 0.015, v + 0.015, 0.02, 0.035, timber);
  };
  const bay = frame(house.front);
  for (const face of [house.left, house.back, house.right]) frame(face);
  for (let i = 1; i < 6; i++) {
    const u0 = -6 + i * bay + 0.1;
    if (i === 3) {
      house.front.door(-6 + (i + 0.5) * bay, bay - 0.25, 1.75, 0x5a3e2a, { frame: timber, double: true });
    } else {
      shoji(house.front, u0, u0 + bay - 0.2);
    }
    house.front.glass(rectOutline(u0, 2.03, u0 + bay - 0.2, 2.62), 0.03);
    for (let u = u0 + 0.3; u < u0 + bay - 0.2; u += 0.3) house.front.box(u - 0.015, u + 0.015, 2.03, 2.62, 0.03, 0.05, timber);
  }
  for (const face of [house.left, house.right]) face.window(0, 0.8, 1.2, 0.9, { frame: timber, bars: 4 });
  // Engawa: the veranda deck under a tiled pent roof.
  b.box(-6, 0.5, -5.1, 6, 0.64, -4, 0x6b4a30);
  for (let x = -5.8; x <= 5.8; x += 1.93) {
    b.box(x - 0.08, 0, -5.0, x + 0.08, 0.5, -4.84, timber);
    b.box(x - 0.08, 0.64, -5.0, x + 0.08, 2.75, -4.84, timber);
  }
  b.shed(-6, 6, -5.1, -4, 2.72, 3.2, tile, 0.3, 0.1);
  steps(b, -1.0, 1.0, -5.1, 0.64, 2, 0x9a968c, 0.3);
  // Irimoya: a hipped thatch skirt carrying a gable of dark timber on top.
  b.hip(-6, 6, -4, 4, 3.3, 7.0, { roof: thatch, over: 0.9 });
  b.gable(-2.8, 2.8, -1.2, 1.2, 6.2, 8.0, { roof: thatch, wall: timber, over: 0.35, end: 0.35, thick: 0.3, cap: null });
  b.box(-3.3, 8.2, -0.35, 3.3, 8.6, 0.35, 0x3b3f44);
  for (const x of [-3.3, 3.3]) b.box(x - 0.18, 8.2, -0.45, x + 0.18, 8.85, 0.45, 0x3b3f44);
  const gableEnd = new Facade(b, [-2.8, 0, 0], [0, 0, 1], [-1, 0, 0], 2.4, 8);
  gableEnd.box(-0.5, 0.5, 6.7, 7.1, 0, 0.03, plaster);
}

/** Chinese hall: red columns and lattice on a stone platform, under a curved tiled roof. */
export function chinese(b: DwellingBuilder): void {
  const brick = 0x8a8d8e;
  const red = 0xa8322a;
  const green = 0x2f7f6e;
  const gold = 0xd8a93a;
  const tile = 0x55595c;
  const stone = 0xa8a29a;
  const paper = 0xf2ead8;
  b.trim = red;
  b.box(-7, 0, -5, 7, 0.7, 5, stone);
  steps(b, -1.6, 1.6, -5, 0.7, 3, shade(stone, 0.92), 0.32);
  const hall = b.mass(-6, 6, 0.7, 4.7, -3.5, 3.5, brick);
  const columns = [-5.4, -3.2, -1.1, 1.1, 3.2, 5.4];
  for (const x of columns) {
    b.cylinder(x, -4.2, 0.7, 0.9, 0.28, shade(stone, 0.9), 10);
    b.cylinder(x, -4.2, 0.9, 4.0, 0.18, red, 12);
  }
  // Lattice screens between the columns, a studded double door in the middle bay.
  for (let i = 0; i + 1 < columns.length; i++) {
    const x0 = columns[i]!;
    const x1 = columns[i + 1]!;
    const u0 = -x1 + 0.25;
    const u1 = -x0 - 0.25;
    if (Math.abs(x0 + x1) < 0.01) {
      hall.front.door(0, 1.8, 2.9, red, { double: true, frame: shade(red, 0.7) });
      for (let k = 0; k < 20; k++) hall.front.box(-0.75 + (k % 5) * 0.36, -0.7 + (k % 5) * 0.36, 0.5 + Math.floor(k / 5) * 0.55, 0.55 + Math.floor(k / 5) * 0.55, 0.035, 0.06, gold);
      continue;
    }
    hall.front.shape(rectOutline(u0, 0.3, u1, 3.0), red, 0.02);
    hall.front.shape(rectOutline(u0 + 0.12, 1.1, u1 - 0.12, 2.9), paper, 0.03);
    for (let u = u0 + 0.28; u < u1 - 0.12; u += 0.28) hall.front.box(u - 0.02, u + 0.02, 1.1, 2.9, 0.03, 0.05, red);
    for (let v = 1.3; v < 2.9; v += 0.3) hall.front.box(u0 + 0.12, u1 - 0.12, v - 0.02, v + 0.02, 0.03, 0.05, red);
    hall.front.glass(rectOutline(u0 + 0.12, 3.1, u1 - 0.12, 3.35), 0.03);
  }
  // Painted beam and brackets over the columns.
  b.box(-6.4, 3.9, -4.45, 6.4, 4.4, -3.95, green);
  for (const y of [4.02, 4.28]) b.box(-6.42, y, -4.47, 6.42, y + 0.05, -3.93, gold);
  for (const x of columns) b.box(x - 0.3, 4.4, -4.5, x + 0.3, 4.65, -3.9, red);
  // The roof: a curved section pushed along the hall, then upturned corners and a crested ridge.
  const top: P2[] = [[-4.9, 4.4], [-4.3, 4.55], [-3.5, 4.95], [-2.6, 5.5], [-1.7, 6.15], [-0.8, 6.75], [0, 7.05], [0.8, 6.75], [1.7, 6.15], [2.6, 5.5], [3.5, 4.95], [4.3, 4.55], [4.9, 4.4]];
  const under = [...top].reverse().map(([z, y]): P2 => [z * 0.98, y - 0.32]);
  b.extrude([...top, ...under], 'x', -7.0, 7.0, tile, { cap: 0x7a2a22, smooth: true });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const p = (x: number, y: number, z: number): P3 => [sx * x, y, sz * z];
      b.hexa([p(6.2, 4.12, 4.3), p(7.0, 4.12, 4.3), p(7.0, 4.12, 4.95), p(6.2, 4.12, 4.95), p(7.3, 4.92, 5.2), p(7.5, 4.92, 5.2), p(7.5, 5.06, 5.42), p(7.3, 5.06, 5.42)], shade(tile, 1.08));
    }
  }
  b.box(-6.8, 6.95, -0.26, 6.8, 7.45, 0.26, 0x44484b);
  for (const sx of [-1, 1]) {
    b.beam([sx * 6.6, 7.2, 0], [sx * 7.05, 8.1, 0], 0.3, 0x44484b);
    b.beam([sx * 7.05, 8.1, 0], [sx * 6.7, 8.45, 0], 0.22, 0x44484b);
  }
  for (const x of [-4.5, -1.5, 1.5, 4.5]) b.box(x - 0.12, 7.45, -0.12, x + 0.12, 7.75, 0.12, gold);
}

/** Mongolian ger: felt over lattice walls, a painted orange door and the crown on top. */
export function yurt(b: DwellingBuilder): void {
  const felt = 0xefeae0;
  const blue = 0x2f5fa8;
  const rope = 0x5a4632;
  const orange = 0xd9771f;
  b.trim = 0xc0392b;
  b.lathe(0, 0, [[3.25, 0], [3.25, 0.15], [3.2, 0.2], [3.2, 1.55], [3.2, 1.75]], 26, (i) => [0x6b5a48, 0x6b5a48, felt, blue][i]!, { capTop: false });
  for (const y of [0.55, 1.05]) b.lathe(0, 0, [[3.24, y], [3.24, y + 0.07]], 26, rope);
  b.lathe(0, 0, [[3.4, 1.68], [3.25, 1.8], [2.4, 2.25], [1.35, 2.72], [0.62, 2.98]], 26, (i) => [felt, blue, felt, felt][i]!);
  b.lathe(0, 0, [[0.62, 2.95], [0.62, 3.12], [0.5, 3.18], [0.2, 3.3], [0, 3.32]], 14, (i) => (i === 0 ? orange : 0xc0392b));
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    b.beam([Math.cos(a) * 0.62, 3.0, Math.sin(a) * 0.62], [Math.cos(a) * 3.3, 1.75, Math.sin(a) * 3.3], 0.05, rope);
  }
  const door = b.radial(0, 0, 3.2, 3.2, -Math.PI / 2, 0, 1.4, 1.75);
  door.door(0, 0.95, 1.4, orange, { frame: 0xc0392b, v: 0.12, double: true });
  for (const [u, v] of [[-0.24, 0.9], [0.24, 0.9], [-0.24, 0.45], [0.24, 0.45]] as const) flower(door, u, v, 0.22, 0xf4c430, 0x2f5fa8, 0.05);
  door.box(-0.65, 0.65, 0, 0.12, 0, 0.3, 0x6b4a30);
  b.cylinder(0.9, 0.9, 2.3, 3.9, 0.1, 0x6f7070, 8);
}

/** Thai house on stilts: two teak pavilions with steep gables and crossed kalae. */
export function thaiStilt(b: DwellingBuilder): void {
  const teak = 0x7a4a2a;
  const dark = 0x4f2f1a;
  const roof = 0x7b3b2a;
  const carved = 0x9a6a3a;
  b.trim = dark;
  for (const x of [-5.6, -3.0, -0.4, 2.2, 5.0]) {
    for (const z of [-3.2, 0, 3.2]) b.box(x - 0.12, 0, z - 0.12, x + 0.12, 2.25, z + 0.12, dark);
  }
  b.box(-6, 2.2, -3.6, 5.6, 2.42, 3.6, teak);
  const pavilion = (x0: number, x1: number, z0: number, z1: number, wallTop: number, ridge: number): void => {
    const lean = 0.15;
    b.hexa(
      [[x0, 2.42, z0], [x1, 2.42, z0], [x1, 2.42, z1], [x0, 2.42, z1], [x0 + lean, wallTop, z0 + lean], [x1 - lean, wallTop, z0 + lean], [x1 - lean, wallTop, z1 - lean], [x0 + lean, wallTop, z1 - lean]],
      teak,
    );
    const cx = (x0 + x1) / 2;
    const front = frontAt(b, z0 + 0.08, x1 - x0, wallTop, cx);
    battens(front, 2.42, wallTop, 0.4, shade(teak, 0.8));
    front.window(-(x1 - x0) / 4, 3.1, 0.8, 1.0, { frame: dark, shutters: dark });
    front.window((x1 - x0) / 4, 3.1, 0.8, 1.0, { frame: dark, shutters: dark });
    b.gable(x0 + lean, x1 - lean, z0 + lean, z1 - lean, wallTop, ridge, { axis: 'z', roof, wall: carved, over: 0.7, end: 0.75, thick: 0.18, cap: dark });
    const pediment = frontAt(b, z0 + lean, x1 - x0, ridge, cx);
    const halfW = (x1 - x0) / 2 - lean;
    for (let row = 0; row < 3; row++) {
      const v = wallTop + 0.4 + row * 0.8;
      const reach = halfW * (1 - (v - wallTop + 0.4) / (ridge - wallTop)) - 0.3;
      if (reach < 0.3) continue;
      for (let u = -reach; u <= reach; u += 0.6) pediment.shape([[u - 0.18, v], [u, v - 0.22], [u + 0.18, v], [u, v + 0.22]], dark, 0.03);
    }
    for (const zEnd of [z0 + lean - 0.75, z1 - lean + 0.75]) {
      b.beam([cx - 0.55, ridge - 0.3, zEnd], [cx + 0.35, ridge + 1.0, zEnd], 0.14, dark);
      b.beam([cx + 0.55, ridge - 0.3, zEnd], [cx - 0.35, ridge + 1.0, zEnd], 0.14, dark);
    }
  };
  pavilion(-5.6, -0.6, -3.0, 3.0, 4.9, 8.4);
  pavilion(1.0, 5.2, -1.6, 3.2, 4.6, 7.6);
  b.railing([-0.4, -3.55], [2.9, -3.55], 2.42, 0.8, dark, 5, 0.07);
  b.railing([4.1, -3.55], [5.55, -3.55], 2.42, 0.8, dark, 2, 0.07);
  b.railing([5.55, -3.55], [5.55, 3.55], 2.42, 0.8, dark, 8, 0.07);
  steps(b, 3.0, 4.0, -3.6, 2.42, 8, dark, 0.3);
  for (const [x, z] of [[0.3, -3.2], [5.1, -3.1], [5.1, 2.9]] as const) {
    b.lathe(x, z, [[0.2, 2.42], [0.26, 2.8]], 10, 0x9a5a3a);
    b.ball(x, 3.05, z, 0.34, 0x3f8a3a, 1.1, 10);
  }
}

/** Toraja tongkonan on its piles, under a saddle roof that sweeps up at both ends. */
export function tongkonan(b: DwellingBuilder): void {
  const post = 0x3a2a1e;
  const red = 0x9a2e22;
  const black = 0x161412;
  const white = 0xf2ede2;
  const yellow = 0xe0b43a;
  b.trim = black;
  for (const x of [-3.2, -1.1, 1.1, 3.2]) for (const z of [-1.5, 1.5]) b.box(x - 0.16, 0, z - 0.16, x + 0.16, 2.3, z + 0.16, post);
  b.box(-3.7, 2.2, -2.0, 3.7, 2.45, 2.0, post);
  const body = b.mass(-3.5, 3.5, 2.45, 4.4, -1.8, 1.8, red);
  /** Carved wall panel: a sun in a square, then crossed diamonds, in the Toraja palette. */
  const carve = (f: Facade, count: number, v0: number, v1: number): void => {
    const w = f.width / count;
    for (let k = 0; k < count; k++) {
      const u = -f.width / 2 + (k + 0.5) * w;
      const h = v1 - v0;
      f.shape(rectOutline(u - w / 2 + 0.06, v0, u + w / 2 - 0.06, v1), black, 0.02);
      if (k % 2 === 0) {
        const sun: P2[] = [];
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          const r = (i % 2 === 0 ? 0.42 : 0.3) * Math.min(w, h);
          sun.push([u + Math.cos(a) * r, v0 + h / 2 + Math.sin(a) * r]);
        }
        f.shape(sun, yellow, 0.03);
        f.shape(archOutline(u, v0 + h / 2 - 0.1, 0.2, 0.2, 6), red, 0.04);
      } else {
        for (const dv of [-0.25, 0.25]) f.shape([[u, v0 + h / 2 + dv - 0.22], [u + 0.3, v0 + h / 2 + dv], [u, v0 + h / 2 + dv + 0.22], [u - 0.3, v0 + h / 2 + dv]], white, 0.03);
      }
    }
  };
  carve(body.front, 7, 0.35, 1.7);
  carve(body.back, 7, 0.35, 1.7);
  body.front.door(0, 0.7, 1.4, 0x5a3a22, { frame: black, v: 0.3 });
  // The saddle: two lofted slabs, each ring a convex quad, rising and narrowing to the ends.
  const L = 7.6;
  const ridgeAt = (x: number): number => 7.0 + 2.3 * Math.pow(Math.abs(x) / L, 2.4);
  const eaveAt = (x: number): number => 4.3 + 1.4 * Math.pow(Math.abs(x) / L, 2.0);
  const halfAt = (x: number): number => 3.0 - 0.9 * Math.pow(Math.abs(x) / L, 2);
  const stations: number[] = [];
  for (let i = 0; i <= 16; i++) stations.push(-L + (i / 16) * 2 * L);
  for (const side of [-1, 1]) {
    const rings = stations.map((x): P3[] => [
      [x, eaveAt(x), side * halfAt(x)],
      [x, ridgeAt(x), 0],
      [x, ridgeAt(x) + 0.42, 0],
      [x, eaveAt(x) + 0.42, side * (halfAt(x) + 0.06)],
    ]);
    b.loft(rings, (ring) => (ring % 2 ? 0x4a4035 : 0x55493b));
  }
  // Gable ends closing the attic over the body, painted with a sun.
  for (const x of [-3.5, 3.5]) {
    const under = (z: number): number => eaveAt(x) + (ridgeAt(x) - eaveAt(x)) * (1 - Math.abs(z) / halfAt(x));
    b.extrude([[-1.8, 4.4], [1.8, 4.4], [1.8, under(1.8) - 0.05], [0, ridgeAt(x) - 0.08], [-1.8, under(1.8) - 0.05]], 'x', x - 0.1, x + 0.1, red);
    const end = new Facade(b, [x + Math.sign(x) * 0.1, 0, 0], [0, 0, x < 0 ? 1 : -1], [Math.sign(x), 0, 0], 3.6, 8);
    const sun: P2[] = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const r = i % 2 === 0 ? 0.55 : 0.38;
      sun.push([Math.cos(a) * r, 5.5 + Math.sin(a) * r]);
    }
    end.shape(sun, yellow, 0.03);
  }
  // Tulak somba: the post under each prow, hung with buffalo horns.
  for (const x of [-6.6, 6.6]) {
    b.box(x - 0.18, 0, -0.18, x + 0.18, ridgeAt(x) - 0.05, 0.18, post);
    for (let k = 0; k < 6; k++) {
      const y = 2.6 + k * 0.42;
      for (const s of [-1, 1]) {
        b.beam([x, y, s * 0.12], [x, y + 0.12, s * 0.55], 0.1, white);
        b.beam([x, y + 0.12, s * 0.55], [x, y + 0.42, s * 0.62], 0.08, white);
      }
    }
  }
  steps(b, -0.5, 0.5, -1.8, 2.45, 7, post, 0.3);
}

/** Rajasthani haveli: two storeys of sandstone, jharokha oriels, chhatris on the roof. */
export function haveli(b: DwellingBuilder): void {
  const sand = 0xd58c64;
  const light = 0xf0d2b0;
  const blue = 0x3a6fb0;
  const green = 0x3f8f5a;
  const wood = 0x5a3a22;
  b.trim = light;
  const house = b.mass(-6, 6, 0, 7.4, -4, 4, sand);
  for (const face of [house.front, house.left, house.right, house.back]) {
    face.band(3.5, 0.25, light, 0.1);
    face.band(7.2, 0.2, light, 0.12, 0.05);
    face.band(0, 0.4, shade(sand, 0.85), 0.04);
  }
  b.parapet(-6, 6, -4, 4, 7.4, 0.5, 0.25, light);
  const f = house.front;
  f.shape(archOutline(0, 0, 3.0, 3.3, 12), light, 0.02);
  f.door(0, 1.8, 2.8, wood, { arch: true, double: true, panels: true, frame: shade(light, 0.9) });
  for (let k = 0; k < 18; k++) f.box(-0.7 + (k % 6) * 0.27, -0.65 + (k % 6) * 0.27, 0.6 + Math.floor(k / 6) * 0.6, 0.65 + Math.floor(k / 6) * 0.6, 0.035, 0.07, 0xc9a24a);
  // Frescoed panels flanking the gate.
  for (const side of [-1, 1]) {
    const u = side * 2.7;
    f.shape(rectOutline(u - 0.85, 0.7, u + 0.85, 2.9), blue, 0.015);
    f.shape(rectOutline(u - 0.72, 0.83, u + 0.72, 2.77), 0xf6ecd6, 0.025);
    flower(f, u, 1.8, 0.7, 0xc2452f, green, 0.035);
    for (const dv of [-0.7, 0.7]) flower(f, u, 1.8 + dv, 0.3, green, 0xc2452f, 0.035);
  }
  for (const u of [-4.7, 4.7]) f.window(u, 1.0, 0.8, 1.3, { arch: true, bars: 3, rails: 3, frame: light });
  // Jharokhas: oriel windows on brackets, each capped by its own little dome.
  for (const x of [-3.6, 0, 3.6]) {
    b.box(x - 0.9, 4.05, -4.85, x + 0.9, 4.22, -4.0, light);
    for (const dx of [-0.6, 0.6]) b.beam([x + dx, 3.3, -4.0], [x + dx, 4.08, -4.75], 0.14, light);
    const oriel = b.mass(x - 0.8, x + 0.8, 4.22, 5.9, -4.75, -4.0, sand);
    oriel.front.window(0, 0.25, 1.05, 1.25, { arch: true, bars: 3, frame: light });
    oriel.left.window(0, 0.35, 0.3, 1.0, { frame: light });
    oriel.right.window(0, 0.35, 0.3, 1.0, { frame: light });
    b.box(x - 0.9, 5.9, -4.85, x + 0.9, 6.02, -3.9, light);
    b.dome(x, -4.38, 6.02, 0.72, light, 0.85, 14, 4);
    b.ball(x, 6.75, -4.38, 0.09, 0xc9a24a, 1.6, 6);
  }
  for (const u of [-4.9, 4.9]) f.window(u, 4.4, 0.8, 1.3, { arch: true, bars: 2, frame: light });
  // Chhatris at the roof corners.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const cx = sx * 5.2;
      const cz = sz * 3.2;
      for (const [dx, dz] of [[-0.45, -0.45], [0.45, -0.45], [0.45, 0.45], [-0.45, 0.45]] as const) {
        b.box(cx + dx - 0.07, 7.6, cz + dz - 0.07, cx + dx + 0.07, 8.8, cz + dz + 0.07, light);
      }
      b.box(cx - 0.65, 8.8, cz - 0.65, cx + 0.65, 8.95, cz + 0.65, light);
      b.dome(cx, cz, 8.95, 0.6, light, 0.9, 12, 4);
      b.ball(cx, 9.62, cz, 0.08, 0xc9a24a, 1.6, 6);
    }
  }
}

/** Futuro house, 1968: a yellow plastic saucer on a steel ring, oval windows all round. */
export function futuro(b: DwellingBuilder): void {
  const yellow = 0xf2c230;
  const white = 0xf5f3ee;
  const steel = 0x6a6e72;
  const dark = 0x2a2c2e;
  b.trim = dark;
  const a = 4.0;
  const c = 1.75;
  const cy = 3.55;
  const profile: P2[] = [];
  for (let i = 0; i <= 14; i++) {
    const t = -Math.PI / 2 + (i / 14) * Math.PI;
    profile.push([Math.cos(t) * a, cy + Math.sin(t) * c]);
  }
  b.lathe(0, 0, profile, 32, (i) => (i === 6 || i === 7 ? white : i < 6 ? shade(yellow, 0.94) : yellow));
  // Oval windows round the upper shell, each on its own tangent plane.
  for (let k = 0; k < 12; k++) {
    const phi = (k / 12) * Math.PI * 2 + Math.PI / 12;
    const t = 0.3;
    const centre = new Float64Array([a * Math.cos(t) * Math.cos(phi), cy + c * Math.sin(t), a * Math.cos(t) * Math.sin(phi)]);
    const n = [(Math.cos(t) * Math.cos(phi)) / a, Math.sin(t) / c, (Math.cos(t) * Math.sin(phi)) / a];
    const length = Math.hypot(n[0]!, n[1]!, n[2]!);
    const normal: P3 = [n[0]! / length, n[1]! / length, n[2]! / length];
    const u: P3 = [-Math.sin(phi), 0, Math.cos(phi)];
    const v: P3 = [
      normal[1] * u[2] - normal[2] * u[1],
      normal[2] * u[0] - normal[0] * u[2],
      normal[0] * u[1] - normal[1] * u[0],
    ];
    const oval = (rx: number, ry: number, lift: number): P3[] => {
      const points: P3[] = [];
      for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2;
        const x = Math.cos(angle) * rx;
        const y = Math.sin(angle) * ry;
        points.push([
          centre[0]! + u[0] * x + v[0] * y + normal[0] * lift,
          centre[1]! + u[1] * x + v[1] * y + normal[1] * lift,
          centre[2]! + u[2] * x + v[2] * y + normal[2] * lift,
        ]);
      }
      return points;
    };
    b.poly(oval(0.62, 0.36, 0.03), dark, normal);
    b.glassPoly(oval(0.52, 0.28, 0.05), normal);
  }
  // Steel ring on four splayed legs.
  const ringR = 2.6;
  for (let k = 0; k < 16; k++) {
    const a0 = (k / 16) * Math.PI * 2;
    const a1 = ((k + 1) / 16) * Math.PI * 2;
    b.beam([Math.cos(a0) * ringR, 1.95, Math.sin(a0) * ringR], [Math.cos(a1) * ringR, 1.95, Math.sin(a1) * ringR], 0.16, steel);
  }
  for (let k = 0; k < 4; k++) {
    const angle = Math.PI / 4 + (k * Math.PI) / 2;
    const top: P3 = [Math.cos(angle) * ringR, 1.95, Math.sin(angle) * ringR];
    const foot: P3 = [Math.cos(angle) * 3.5, 0.1, Math.sin(angle) * 3.5];
    b.beam(top, foot, 0.18, steel);
    b.box(foot[0] - 0.3, 0, foot[2] - 0.3, foot[0] + 0.3, 0.1, foot[2] + 0.3, steel);
  }
  // The hatch, dropped open as a stair.
  b.hexa([[-0.6, 1.95, -2.4], [0.6, 1.95, -2.4], [0.6, 0.05, -4.5], [-0.6, 0.05, -4.5], [-0.6, 2.07, -2.35], [0.6, 2.07, -2.35], [0.6, 0.17, -4.45], [-0.6, 0.17, -4.45]], white);
  for (let k = 1; k < 6; k++) {
    const t = k / 6;
    const y = 1.95 + (0.05 - 1.95) * t + 0.13;
    const z = -2.4 + (-4.5 + 2.4) * t;
    b.box(-0.55, y, z - 0.06, 0.55, y + 0.04, z + 0.06, dark);
  }
  for (const x of [-0.62, 0.62]) b.beam([x, 1.95 + 0.9, -2.4], [x, 0.9, -4.4], 0.04, steel);
  b.lathe(0, 0, [[0.95, cy + c - 0.06], [0.95, cy + c + 0.04], [0.6, cy + c + 0.2], [0, cy + c + 0.26]], 16, white);
}
