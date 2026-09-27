import { DwellingBuilder, Facade, archOutline, rectOutline, shade, type P2, type P3 } from './builder';
import { battens, jitter, logWalls, porch, porthole, siding, steps, stonework, wheel } from './parts';

const FRONT: P3 = [0, 0, -1];
const LEFT_U: P3 = [-1, 0, 0];

function frontAt(b: DwellingBuilder, z: number, width: number, height: number, x = 0): Facade {
  return new Facade(b, [x, 0, z], LEFT_U, FRONT, width, height);
}

/** A block whose walls lean in by `batter` over its height: adobe is never plumb. */
function battered(b: DwellingBuilder, x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, batter: number, hex: number): void {
  b.hexa(
    [
      [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
      [x0 + batter, y1, z0 + batter], [x1 - batter, y1, z0 + batter], [x1 - batter, y1, z1 - batter], [x0 + batter, y1, z1 - batter],
    ],
    hex,
  );
}

/** Taos-style pueblo: stepped adobe blocks, protruding vigas, a ladder and an oven. */
export function pueblo(b: DwellingBuilder): void {
  const adobe = 0xc88c5a;
  const adobeLight = 0xd49a66;
  const turquoise = 0x2fa3a0;
  const viga = 0x5b3a22;
  b.trim = turquoise;
  battered(b, -6, 6, -4, 4, 0, 2.9, 0.12, adobe);
  b.parapet(-5.88, 5.88, -3.88, 3.88, 2.9, 0.35, 0.28, adobeLight);
  battered(b, -4.5, 2.5, -0.5, 3.8, 2.9, 5.7, 0.1, adobeLight);
  b.parapet(-4.4, 2.4, -0.4, 3.7, 5.7, 0.3, 0.25, adobe);
  const lower = frontAt(b, -4 + 0.055, 12, 2.9);
  lower.door(-1.2, 0.95, 1.9, turquoise, { frame: viga });
  for (const u of [-4.2, 1.6, 4.0]) lower.window(u, 1.0, 0.6, 0.7, { frame: turquoise });
  const upper = frontAt(b, -0.5 + 0.05, 7, 2.8, -1);
  upper.door(-1.6, 0.85, 1.8, turquoise, { frame: viga, v: 0 });
  upper.window(0.9, 1.0, 0.6, 0.7, { frame: turquoise });
  for (let x = -5.4; x <= 5.4; x += 0.9) b.box(x - 0.09, 2.52, -4.55, x + 0.09, 2.7, -3.92, viga);
  for (let x = -4.1; x <= 2.1; x += 0.9) b.box(x - 0.09, 5.3, -1.0, x + 0.09, 5.48, -0.42, viga);
  // Ladder leaning on the lower roof.
  for (const x of [3.0, 3.55]) b.beam([x, 0, -5.0], [x, 3.9, -4.0], 0.08, viga);
  for (let k = 1; k < 10; k++) {
    const t = k / 10;
    b.beam([2.96, 3.9 * t, -5.0 + t], [3.59, 3.9 * t, -5.0 + t], 0.05, viga);
  }
  // Canales: drain spouts through the parapet.
  for (const x of [-3.0, 4.8]) b.box(x - 0.1, 2.95, -4.5, x + 0.1, 3.1, -3.85, shade(viga, 1.2));
  // Chile ristras by the door.
  for (const u of [-1.9, -0.5]) lower.box(u - 0.07, u + 0.07, 1.2, 2.2, 0.02, 0.12, 0xb22a1c);
  // Horno: the beehive oven.
  b.dome(7.6, -2.4, 0, 1.0, adobeLight, 1.1, 14, 5);
  b.radial(7.6, -2.4, 1.0, 1.0, -Math.PI / 2, 0, 1, 1).shape(archOutline(0, 0.1, 0.45, 0.45), 0x2b1f18, 0.02, -0.02);
}

/** Plains tipi: painted bands on a canvas cone, poles crossing above the smoke flaps. */
export function tipi(b: DwellingBuilder): void {
  const canvas = 0xece0c4;
  const red = 0xb33b2c;
  const blue = 0x2f5a9a;
  const soot = 0x6b5a48;
  const pole = 0x6b4a2c;
  const yellow = 0xe8b33a;
  b.trim = pole;
  const profile: P2[] = [[2.8, 0], [2.55, 0.55], [2.3, 1.1], [1.6, 2.8], [1.35, 3.4], [0.8, 4.75], [0.3, 5.95]];
  const bands = [red, canvas, canvas, blue, canvas, soot];
  b.lathe(0, 0, profile, 22, (i) => bands[i]!);
  const radiusAt = (y: number): number => {
    for (let i = 0; i + 1 < profile.length; i++) {
      const [r0, y0] = profile[i]!;
      const [r1, y1] = profile[i + 1]!;
      if (y <= y1) return r0 + ((y - y0) / (y1 - y0)) * (r1 - r0);
    }
    return profile[profile.length - 1]![0];
  };
  /** A point painted on the cone at `angle`, `u` metres along the surface sideways. */
  const onCone = (angle: number, u: number, y: number, lift = 0.02): P3 => {
    const r = radiusAt(y) + lift;
    const a = angle + u / Math.max(0.2, r);
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  };
  const front = -Math.PI / 2;
  const door = archOutline(0, 0.12, 0.95, 1.45, 8);
  b.poly(door.map(([u, v]) => onCone(front, u, v, 0.03)), 0x8a5a36, [0, 0.25, -1]);
  // A ring of painted suns on the blue band.
  for (let k = 0; k < 7; k++) {
    const angle = front + ((k + 0.5) / 7) * Math.PI * 2;
    const disc: P3[] = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      disc.push(onCone(angle, Math.cos(a) * 0.2, 3.1 + Math.sin(a) * 0.2, 0.03));
    }
    b.poly(disc, yellow, [Math.cos(angle), 0.4, Math.sin(angle)]);
  }
  // Zigzag along the red skirt.
  for (let k = 0; k < 16; k++) {
    const angle = (k / 16) * Math.PI * 2;
    if (Math.abs(angle - (3 * Math.PI) / 2) < 0.3) continue;
    b.poly([onCone(angle, -0.3, 0.62, 0.03), onCone(angle, 0.3, 0.62, 0.03), onCone(angle, 0, 0.95, 0.03)], canvas, [Math.cos(angle), 0.4, Math.sin(angle)]);
  }
  // Smoke flaps, propped open.
  for (const side of [-1, 1]) {
    const a = front + side * 0.35;
    const base = onCone(a, 0, 4.5, 0.05);
    const top = onCone(a, 0, 5.9, 0.05);
    const out: P3 = [Math.cos(a + side * 0.8) * 0.9, 0.2, Math.sin(a + side * 0.8) * 0.9];
    b.hexa(
      [base, [base[0] + out[0], base[1], base[2] + out[2]], [base[0] + out[0], base[1], base[2] + out[2] + 0.05], [base[0], base[1], base[2] + 0.05],
        top, [top[0] + out[0] * 0.6, top[1] + 0.3, top[2] + out[2] * 0.6], [top[0] + out[0] * 0.6, top[1] + 0.3, top[2] + out[2] * 0.6 + 0.05], [top[0], top[1], top[2] + 0.05]],
      canvas,
    );
  }
  // Poles crossing at the neck and fanning out above it.
  for (let k = 0; k < 11; k++) {
    const a = (k / 11) * Math.PI * 2;
    b.beam([Math.cos(a) * 0.36, 5.6, Math.sin(a) * 0.36], [-Math.cos(a) * 0.85, 7.7 + (k % 3) * 0.2, -Math.sin(a) * 0.85], 0.07, pole);
  }
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    b.box(Math.cos(a) * 2.95 - 0.04, 0, Math.sin(a) * 2.95 - 0.04, Math.cos(a) * 2.95 + 0.04, 0.3, Math.sin(a) * 2.95 + 0.04, pole);
  }
}

/** Frontier log cabin: white chinking between the logs, a fieldstone chimney, a porch. */
export function logCabin(b: DwellingBuilder): void {
  const logs = [0x7a5230, 0x6d4829, 0x85593a];
  const chink = 0xe6dfcc;
  const dark = 0x4a3321;
  const shakes = 0x6e5238;
  const stone = [0x8d877c, 0x7a756b, 0x9c968a, 0x6f6a60];
  b.trim = dark;
  logWalls(b, -3.6, 3.6, -2.8, 2.8, 0.3, 2.95, 0.14, logs, 0.22, chink, 0.07);
  b.box(-3.7, 0, -2.9, 3.7, 0.3, 2.9, 0x6f6a60);
  const front = frontAt(b, -2.8 - 0.14, 7.2, 2.95);
  front.door(0, 0.95, 1.95, 0x5a3b24, { v: 0.3, frame: dark, panels: true });
  for (const u of [-2.1, 2.1]) front.window(u, 1.25, 0.75, 0.85, { frame: dark, cross: true, shutters: 0x7a3a26 });
  b.gable(-3.6, 3.6, -2.8, 2.8, 2.95, 5.0, { roof: shakes, wall: 0x7a5230, over: 0.45, end: 0.4 });
  const gableEnd = new Facade(b, [-3.6, 0, 0], [0, 0, 1], [-1, 0, 0], 5.6, 5.0);
  battens(gableEnd, 3.0, 3.6, 0.35, 0x5f3f24, -1.8, 1.8);
  gableEnd.window(0, 3.25, 0.55, 0.6, { frame: dark });
  porch(b, -3.6, 3.6, -4.7, -2.95, 0.3, 2.35, { deck: 0x7d5a3a, post: 0x5f3f24, roof: shakes }, 4, 0.3);
  steps(b, -0.6, 0.6, -4.7, 0.3, 1, 0x7d5a3a);
  // Fieldstone chimney up the right gable, stepping in as it rises.
  const rand = jitter(0x10ca);
  for (let y = 0, row = 0; y < 5.9; y += 0.32, row++) {
    const half = y < 2.6 ? 0.8 : 0.5;
    for (let z = -half; z < half - 0.05; z += 0.4) {
      const width = Math.min(0.4, half - z);
      b.box(3.62, y, z, 3.62 + (y < 2.6 ? 0.9 : 0.62) + rand(-0.04, 0.04), y + 0.32, z + width, stone[(row + Math.round(z * 10)) % stone.length]!);
    }
  }
  // Split logs stacked by the wall.
  for (let row = 0; row < 3; row++) {
    for (let k = 0; k < 5 - row; k++) {
      const z = -1.8 + k * 0.28 + row * 0.14;
      b.extrude([[z - 0.13, 0.13 + row * 0.25], [z, 0.02 + row * 0.25], [z + 0.13, 0.13 + row * 0.25], [z, 0.26 + row * 0.25]], 'x', -4.6, -3.8, logs[k % 3]!, { cap: 0xc9a97a });
    }
  }
}

/** New England saltbox: two storeys in front, one behind, under one long rear slope. */
export function saltbox(b: DwellingBuilder): void {
  const wall = 0x5f7788;
  const trim = 0xf3efe6;
  const roof = 0x4a4643;
  b.trim = trim;
  const x0 = -5.5;
  const x1 = 5.5;
  const pitch = 0.75;
  const ridgeZ = -1.2;
  const ridge = 7.7;
  const frontWall = 5.6;
  const backWall = 3.8;
  b.box(x0 - 0.1, 0, -4.1, x1 + 0.1, 0.45, 4.1, 0x8a847a);
  b.extrude([[-4, 0.45], [4, 0.45], [4, backWall], [ridgeZ, ridge], [-4, frontWall]], 'x', x0, x1, wall);
  const over = 0.35;
  const end = 0.3;
  const thick = 0.15;
  const slab = (za: number, ya: number, zb: number, yb: number): void =>
    b.hexa(
      [[x0 - end, ya, za], [x1 + end, ya, za], [x1 + end, yb, zb], [x0 - end, yb, zb], [x0 - end, ya + thick, za], [x1 + end, ya + thick, za], [x1 + end, yb + thick, zb], [x0 - end, yb + thick, zb]],
      roof,
    );
  slab(-4 - over, frontWall - over * pitch, ridgeZ, ridge);
  slab(ridgeZ, ridge, 4 + over, backWall - over * pitch);
  const front = frontAt(b, -4, 11, frontWall);
  siding(front, 0.45, frontWall, 0.24, wall);
  for (const u of [-4, -2, 0, 2, 4]) front.window(u, 3.55, 0.9, 1.35, { bars: 1, rails: 2, sill: trim, frame: trim });
  for (const u of [-4, -2, 2, 4]) front.window(u, 1.05, 0.9, 1.45, { bars: 1, rails: 2, sill: trim, frame: trim });
  front.door(0, 1.0, 2.1, 0x2d3f2a, { v: 0.45, panels: true, frame: trim, canopy: trim });
  steps(b, -0.8, 0.8, -4.1, 0.45, 2, 0x8a847a);
  // Siding on the gable ends, clipped to the saltbox outline.
  for (const x of [x0, x1]) {
    const facing = x < 0 ? -1 : 1;
    const end = new Facade(b, [x, 0, 0], [0, 0, facing < 0 ? 1 : -1], [facing, 0, 0], 8, ridge);
    const toU = (z: number): number => (facing < 0 ? z : -z);
    for (let v = 0.45 + 0.24; v < ridge - 0.2; v += 0.24) {
      const zFront = v <= frontWall ? -4 : -4 + (v - frontWall) / pitch;
      const zBack = v <= backWall ? 4 : 4 - (v - backWall) / pitch;
      if (zBack - zFront < 0.3) continue;
      const a = toU(zFront + 0.05);
      const c = toU(zBack - 0.05);
      end.box(Math.min(a, c), Math.max(a, c), v - 0.035, v, 0, 0.012, shade(wall, 0.8));
    }
    end.window(toU(-2.4), 3.55, 0.8, 1.2, { bars: 1, rails: 2 });
    end.window(toU(1.4), 1.1, 0.8, 1.2, { bars: 1, rails: 2 });
  }
  const brick = 0x8e4632;
  b.box(-0.8, 5.0, ridgeZ - 0.6, 0.8, ridge + 1.1, ridgeZ + 0.6, brick);
  b.box(-0.9, ridge + 1.1, ridgeZ - 0.7, 0.9, ridge + 1.25, ridgeZ + 0.7, shade(brick, 0.75));
}

/** Queen Anne "painted lady": a round turret, a cross gable, fish-scale shingles, a porch. */
export function victorian(b: DwellingBuilder): void {
  const pink = 0xe8a9b6;
  const mint = 0x8fd1bd;
  const cream = 0xf4e8cc;
  const roof = 0x5b4f6b;
  b.trim = cream;
  b.box(-5.1, 0, -3.6, 4.1, 0.6, 4.1, 0x7a6a70);
  const main = b.mass(-5, 4, 0.6, 6.4, -3.5, 4, pink);
  const wing = b.mass(0, 4, 0.6, 6.4, -4.9, -3.5, pink);
  for (const face of [main.left, main.back, main.right, wing.front, wing.right, wing.left]) siding(face, 0, 5.8, 0.22, pink);
  for (const face of [main.front, wing.front, main.left]) face.band(2.8, 0.2, mint, 0.07);
  wing.front.window(0, 0.6, 1.5, 1.9, { cross: true, surround: mint, surroundWidth: 0.1, hood: cream });
  wing.front.window(0, 3.6, 1.3, 1.6, { cross: true, surround: mint, surroundWidth: 0.1 });
  main.front.window(1.6, 3.6, 0.9, 1.6, { cross: true, surround: mint, surroundWidth: 0.08 });
  main.front.door(1.6, 1.0, 2.25, 0x6a3a4a, { glass: true, frame: cream, surround: mint });
  main.left.window(0.5, 0.8, 0.9, 1.7, { cross: true, surround: mint, surroundWidth: 0.08 });
  main.left.window(0.5, 3.6, 0.9, 1.6, { cross: true, surround: mint, surroundWidth: 0.08 });
  b.hip(-5, 4, -3.5, 4, 6.4, 9.8, { roof, over: 0.35 });
  b.gable(0, 4, -4.9, -1.5, 6.4, 9.1, { axis: 'z', roof, wall: pink, over: 0.3, end: 0.2 });
  // Fish-scale shingles in the cross gable, in two alternating colours.
  const pediment = frontAt(b, -4.9, 4, 9.1, 2);
  for (let row = 0; row < 5; row++) {
    const v = 6.55 + row * 0.42;
    const half = 1.85 * (1 - (v + 0.2 - 6.4) / 2.7);
    for (let u = -half + 0.2; u <= half - 0.2; u += 0.38) {
      const scale: P2[] = [[u - 0.18, v + 0.36]];
      for (let i = 0; i <= 6; i++) {
        const a = Math.PI + (i / 6) * Math.PI;
        scale.push([u + Math.cos(a) * 0.18, v + 0.18 + Math.sin(a) * 0.18]);
      }
      scale.push([u + 0.18, v + 0.36]);
      pediment.shape(scale, (row + Math.round(u * 3)) % 2 ? mint : cream, 0.025);
    }
  }
  pediment.window(0, 7.1, 0.6, 0.7, { arch: true, frame: cream });
  // Round turret on the free front corner.
  const tx = -4.6;
  const tz = -3.6;
  b.lathe(tx, tz, [[1.5, 0], [1.5, 0.6], [1.45, 0.62], [1.45, 7.0]], 18, (i) => (i === 0 ? 0x7a6a70 : pink), { capTop: false });
  for (const y of [2.8, 6.2]) b.lathe(tx, tz, [[1.53, y], [1.53, y + 0.2]], 18, mint);
  b.lathe(tx, tz, [[1.75, 6.95], [1.2, 8.3], [0.5, 10.2], [0, 11.4]], 18, roof);
  b.ball(tx, 11.55, tz, 0.16, 0xc9a24a, 1, 8);
  for (const angle of [-Math.PI / 2 - 0.2, -Math.PI + 0.35]) {
    for (const v of [1.1, 3.8]) b.radial(tx, tz, 1.45, 1.45, angle, 0.6, 1, 6).window(0, v, 0.6, 1.4, { cross: true, frame: cream });
  }
  // Between the turret and the wing: turned posts, balusters and gingerbread brackets.
  b.box(-3.0, 0, -5.2, 0, 0.6, -3.5, 0x9a8a78);
  for (const x of [-2.95, -2.25, -0.95, -0.15]) {
    b.box(x - 0.08, 0.6, -5.08, x + 0.08, 3.1, -4.92, cream);
    b.ball(x, 1.4, -5.0, 0.11, cream, 1, 8);
    b.box(x - 0.1, 2.7, -5.1, x + 0.1, 3.1, -4.9, mint);
  }
  for (let x = -2.9; x < -0.2; x += 0.2) if (x < -2.2 || x > -1.0) b.box(x - 0.025, 0.6, -5.06, x + 0.025, 1.45, -5.0, cream);
  b.box(-2.95, 1.42, -5.1, -2.2, 1.5, -4.96, cream);
  b.box(-1.0, 1.42, -5.1, -0.1, 1.5, -4.96, cream);
  b.box(-3.0, 3.05, -5.25, 0, 3.2, -3.5, mint);
  b.shed(-3.0, 0, -5.25, -3.5, 3.25, 3.7, roof, 0.15, 0.1);
  steps(b, -2.1, -1.1, -5.2, 0.6, 3, 0x9a8a78, 0.28);
  b.chimney(-2.6, 2.2, 8.0, 10.6, 0.6, 0x9a4a3a, cream);
}

/** The Victorian nobody lives in: L-plan, square tower, boarded eyes, a sagging porch. */
export function victorianGhost(b: DwellingBuilder): void {
  const wall = 0x77707e;
  const trim = 0xb8b2a6;
  const roof = 0x2b2a2e;
  const plank = 0x8f836f;
  const hole = 0x17151a;
  b.trim = trim;
  b.box(-4.6, 0, -4.6, 4.6, 0.5, 4.6, 0x5d5856);
  const main = b.mass(-4.5, 4.5, 0.5, 6.2, -1, 4.5, wall);
  const wing = b.mass(-4.5, 0, 0.5, 6.2, -4.5, -1, wall);
  const tower = b.mass(1.4, 4.0, 0.5, 7.6, -3.6, -1, wall);
  for (const face of [main.front, main.left, main.back, main.right, wing.front, wing.left, wing.right, tower.front, tower.right, tower.left]) siding(face, 0, face.height, 0.25, wall);
  wing.front.window(0, 0.7, 1.1, 1.8, { cross: true, boarded: plank, hood: trim });
  wing.front.window(0, 3.6, 1.0, 1.6, { cross: true, arch: true });
  wing.front.shape([[-0.2, 4.1], [0.1, 4.55], [0.35, 4.2], [0.18, 4.9], [-0.3, 4.6]], hole, 0.02, 0.03);
  wing.front.plank([0.75, 3.3], [1.05, 5.0], 0.4, 0x3d3a45, 0.04, 0.02);
  tower.front.window(0, 0.9, 0.9, 1.6, { cross: true, boarded: plank });
  tower.front.window(0, 3.7, 0.9, 1.5, { cross: true });
  tower.front.shape([[-0.35, 4.3], [0.05, 4.8], [0.3, 4.45], [0.2, 5.1], [-0.2, 4.9]], hole, 0.02, 0.03);
  tower.front.window(0, 5.6, 0.5, 0.8, { arch: true, boarded: plank });
  main.front.door(-0.7, 0.95, 2.2, 0x3b2f2a, { panels: true, boarded: plank });
  main.left.window(1.5, 0.7, 1.0, 1.7, { cross: true, boarded: plank, shutters: 0x3d3a45 });
  main.left.window(1.5, 3.6, 1.0, 1.6, { cross: true });
  b.gable(-4.5, 4.5, -1, 4.5, 6.2, 9.0, { roof, wall, over: 0.35, end: 0.3 });
  b.gable(-4.5, 0, -4.5, -1, 6.2, 8.6, { axis: 'z', roof, wall, over: 0.3, end: 0.25 });
  // The tower's mansard cap and a bent weathervane.
  b.hexa(
    [[1.25, 7.6, -3.75], [4.15, 7.6, -3.75], [4.15, 7.6, -0.85], [1.25, 7.6, -0.85], [1.75, 9.0, -3.25], [3.65, 9.0, -3.25], [3.65, 9.0, -1.35], [1.75, 9.0, -1.35]],
    roof,
  );
  b.hip(1.75, 3.65, -3.25, -1.35, 9.0, 9.7, { roof: shade(roof, 1.2), over: 0 });
  b.beam([2.7, 9.7, -2.3], [2.95, 11.0, -2.2], 0.05, 0x3a3a3a);
  b.beam([2.45, 10.9, -2.25], [3.5, 10.7, -2.1], 0.05, 0x3a3a3a);
  // Holes through the main roof.
  const slope = 2.8 / 2.75;
  const onBack = (x: number, z: number): P3 => [x, 9.0 - (z - 1.75) * slope + 0.02, z];
  b.poly([onBack(-3.2, 2.4), onBack(-1.6, 2.2), onBack(-1.4, 3.6), onBack(-3.5, 3.9)], hole, [0, 1, slope]);
  const wingSlope = 2.4 / 2.25;
  const onWing = (x: number, z: number): P3 => [x, 8.6 - (x + 2.25) * wingSlope + 0.02, z];
  b.poly([onWing(-1.9, -3.6), onWing(-0.6, -3.4), onWing(-0.4, -2.2), onWing(-1.7, -2.5)], hole, [wingSlope, 1, 0]);
  // The porch across the wing: one post gone, the roof hanging from the other.
  b.box(-4.6, 0, -6.0, -0.2, 0.45, -4.5, 0x6b6258);
  b.box(-4.45, 0.45, -5.9, -4.29, 2.9, -5.74, trim);
  b.at(-4.4, 2.95, -5.0, 0, () => b.box(0, -0.06, -1.0, 4.3, 0.08, 0.55, roof), 0, -0.2);
  b.at(-1.8, 0.08, -6.7, 0.5, () => b.box(-1.2, -0.08, -0.08, 1.2, 0.08, 0.08, trim));
  b.chimney(-2.8, 2.6, 7.4, 10.0, 0.6, 0x5e4a44, trim);
}

/** New Orleans shotgun: one room wide, bright paint, a gingerbread porch, raised on piers. */
export function shotgun(b: DwellingBuilder): void {
  const yellow = 0xf2c94c;
  const white = 0xf6f3ea;
  const green = 0x2d6a4f;
  const tin = 0xb5b8b6;
  b.trim = white;
  for (let z = -5.6; z <= 5.6; z += 1.4) for (const x of [-2.0, 2.0]) b.box(x - 0.2, 0, z - 0.2, x + 0.2, 0.75, z + 0.2, 0x9b4a36);
  const skirt = 0x3e5a47;
  for (const [x, zA, zB] of [[-2.28, -6, 6], [2.28, -6, 6]] as const) b.box(x - 0.02, 0, zA, x + 0.02, 0.7, zB, skirt);
  const house = b.mass(-2.3, 2.3, 0.75, 4.1, -6, 6, yellow);
  for (const face of [house.front, house.left, house.right, house.back]) siding(face, 0, 3.3, 0.2, yellow);
  house.front.door(-0.9, 0.9, 2.5, green, { glass: true, frame: white, v: 0 });
  house.front.glass([[-1.3, 2.62], [-0.5, 2.62], [-0.5, 2.95], [-1.3, 2.95]], 0.03);
  house.front.window(0.9, 0.25, 0.9, 2.3, { shutters: green, frame: white, cross: true });
  for (const z of [-3, 0.5, 3.5]) {
    house.left.window(-z, 0.6, 0.8, 1.6, { shutters: green, frame: white, cross: true });
    house.right.window(z, 0.6, 0.8, 1.6, { shutters: green, frame: white, cross: true });
  }
  b.gable(-2.3, 2.3, -6, 6, 4.1, 6.3, { axis: 'z', roof: tin, wall: yellow, over: 0.3, end: 0.25 });
  const pediment = frontAt(b, -6, 4.6, 6.3);
  pediment.window(0, 4.55, 0.7, 0.8, { frame: white, rails: 4 });
  for (const side of [-1, 1]) pediment.plank([side * 2.55, 3.95], [0, 6.25], 0.18, white, 0.04, 0.2);
  // Porch: deck, turned posts, a frieze of gingerbread brackets.
  b.box(-2.5, 0, -7.9, 2.5, 0.75, -6, 0x8a7b68);
  for (const x of [-2.3, -0.8, 0.8, 2.3]) {
    b.box(x - 0.07, 0.75, -7.78, x + 0.07, 3.55, -7.64, white);
    b.ball(x, 1.4, -7.71, 0.1, white, 1.3, 8);
  }
  const frieze = frontAt(b, -7.8, 5, 4.2);
  frieze.box(-2.45, 2.45, 3.45, 3.62, 0, 0.05, white);
  for (let u = -2.2; u <= 2.2; u += 0.34) frieze.shape([[u - 0.12, 3.45], [u + 0.12, 3.45], [u, 3.2]], white, 0.03);
  for (const x of [-2.3, -0.8, 0.8, 2.3]) {
    for (const side of [-1, 1]) frieze.shape([[x + side * 0.07, 3.45], [x + side * 0.55, 3.45], [x + side * 0.07, 2.95]], white, 0.04, 0.02);
  }
  b.shed(-2.5, 2.5, -7.9, -6, 3.62, 4.0, tin, 0.15, 0.1);
  steps(b, -1.5, -0.3, -7.9, 0.75, 3, 0x8a7b68, 0.28);
}

/** Dust Bowl farmhouse, left to the wind: bare boards, a torn roof, dunes up the walls. */
export function dustbowl(b: DwellingBuilder): void {
  const boards = 0x9d9a90;
  const tin = 0x8a5a3c;
  const plank = 0xa89a80;
  const gap = 0x2a241f;
  const sand = 0xd6b27a;
  b.trim = 0xb7b1a3;
  b.box(-4.1, 0, -3.1, 4.1, 0.4, 3.1, 0x6f6a60);
  const house = b.mass(-4, 4, 0.4, 4.6, -3, 3, boards);
  for (const face of [house.front, house.left, house.right, house.back]) siding(face, 0, 4.2, 0.26, boards);
  house.front.window(-2.2, 0.8, 0.9, 1.4, { cross: true, boarded: plank });
  house.front.window(2.2, 0.8, 0.9, 1.4, { cross: true });
  house.front.window(-2.2, 2.9, 0.8, 1.0, { cross: true });
  house.front.window(2.2, 2.9, 0.8, 1.0, { cross: true, boarded: plank });
  house.front.door(0, 0.9, 2.05, 0x6d5c4a, { panels: true, frame: 0xb7b1a3 });
  // Missing siding boards, showing the dark frame behind.
  for (const [u, v, w] of [[-3.3, 1.9, 1.1], [1.0, 3.5, 1.4], [3.2, 1.3, 0.6], [-1.0, 3.9, 0.9]] as const) {
    house.front.shape([[u - w / 2, v], [u + w / 2, v + 0.04], [u + w / 2, v + 0.22], [u - w / 2, v + 0.2]], gap, 0.016);
  }
  house.left.window(0, 0.8, 0.9, 1.4, { cross: true, boarded: plank });
  b.gable(-4, 4, -3, 3, 4.6, 7.0, { roof: tin, wall: boards, over: 0.3, end: 0.3 });
  const slope = 2.4 / 3;
  const onFront = (x: number, z: number): P3 => [x, 7.0 + z * slope + 0.02 + 0.14, z];
  b.poly([onFront(-2.6, -0.4), onFront(-1.2, -0.3), onFront(-1.0, -2.3), onFront(-2.8, -2.6)], gap, [0, 1, -slope]);
  b.poly([onFront(1.9, -1.1), onFront(3.0, -1.0), onFront(3.1, -2.9), onFront(1.7, -2.8)], gap, [0, 1, -slope]);
  // The porch roof hangs off one surviving post.
  b.box(-3.9, 0, -4.6, 3.9, 0.35, -3.05, 0x807a6e);
  b.box(3.62, 0.35, -4.5, 3.78, 2.6, -4.34, 0x8d877b);
  b.at(3.9, 2.62, -3.8, 0, () => b.box(-7.8, -0.06, -0.85, 0, 0.06, 0.8, tin), 0.05, 0.32);
  b.at(-2.0, 0.08, -5.4, 0.3, () => b.box(-1.1, -0.08, -0.08, 1.1, 0.08, 0.08, 0x8d877b));
  // Drifts: the wind has been piling sand against this wall for years.
  b.hexa([[-5.4, 0, -4.9], [0.6, 0, -4.9], [0.6, 0, -3.0], [-5.4, 0, -3.0], [-5.0, 0, -4.9], [-0.4, 0, -4.9], [-0.6, 1.1, -3.0], [-4.2, 1.35, -3.0]], sand);
  b.hexa([[-5.8, 0, -3.0], [-4.0, 0, -3.0], [-4.0, 0, 2.4], [-5.8, 0, 2.4], [-5.8, 0, -3.0], [-4.0, 1.25, -3.0], [-4.0, 0.7, 2.4], [-5.8, 0, 2.4]], sand);
  // Windmill: a lattice tower and a fan of vanes.
  const leg = 0x6d665c;
  const mx = 7.2;
  const mz = 2.0;
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) b.beam([mx + dx * 1.0, 0, mz + dz * 1.0], [mx + dx * 0.2, 8.0, mz + dz * 0.2], 0.08, leg);
  for (const y of [2, 4, 6]) {
    const h = 1.0 - (y / 8) * 0.8;
    b.beam([mx - h, y, mz - h], [mx + h, y, mz - h], 0.05, leg);
    b.beam([mx - h, y, mz + h], [mx + h, y, mz + h], 0.05, leg);
    b.beam([mx - h, y, mz - h], [mx - h, y, mz + h], 0.05, leg);
    b.beam([mx + h, y, mz - h], [mx + h, y, mz + h], 0.05, leg);
  }
  b.box(mx - 0.25, 8.0, mz - 0.25, mx + 0.25, 8.4, mz + 0.25, leg);
  for (let k = 0; k < 14; k++) {
    if (k === 3 || k === 9) continue;
    const a = (k / 14) * Math.PI * 2;
    b.beam([mx + Math.cos(a) * 0.3, 8.3 + Math.sin(a) * 0.3, mz - 0.42], [mx + Math.cos(a) * 1.5, 8.3 + Math.sin(a) * 1.5, mz - 0.42], 0.22, 0xa39b8c, 0.02);
  }
  b.beam([mx, 8.3, mz], [mx, 8.3, mz + 2.2], 0.07, leg);
  b.box(mx - 0.02, 7.9, mz + 1.6, mx + 0.02, 8.9, mz + 2.4, 0xa39b8c);
}

/** Army-surplus Quonset hut: corrugated half-cylinder, rust-streaked, a faded star. */
export function quonset(b: DwellingBuilder): void {
  const iron = 0x9a6a4a;
  const end = 0x8d8a7e;
  const white = 0xd9d4c4;
  b.trim = 0x5c5a52;
  // Corrugation as alternating tones round a smooth arc: a zigzag outline read as a
  // lumpy rock at any distance, stripes read as sheet iron.
  const ring = (z: number): P3[] => {
    const points: P3[] = [];
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * Math.PI;
      points.push([Math.cos(a) * 3.4, Math.sin(a) * 3.4, z]);
    }
    return points;
  };
  b.loft([ring(-6), ring(6)], (_ring, edge) => (edge < 0 ? end : edge % 2 ? shade(iron, 0.8) : iron));
  const face = frontAt(b, -6, 6.8, 3.4);
  face.door(0, 1.8, 2.3, 0x4f5a45, { double: true, panels: true, frame: 0x5c5a52 });
  for (const u of [-2.1, 2.1]) face.window(u, 1.1, 0.9, 0.8, { frame: 0x5c5a52, bars: 1 });
  for (const [u, top] of [[-2.35, 1.0], [-1.9, 1.0], [2.3, 1.0], [2.0, 1.0]] as const) face.box(u - 0.05, u + 0.05, top - 0.35, top - 0.02, 0, 0.01, 0x7b4a2f);
  // The faded star over the door.
  const star: P2[] = [];
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i / 10) * Math.PI * 2;
    const r = i % 2 === 0 ? 0.42 : 0.17;
    star.push([Math.cos(a) * r, 2.85 + Math.sin(a) * r]);
  }
  face.shape(star, white, 0.015);
  // Entry vestibule and a stovepipe.
  b.cylinder(1.6, 2.5, 2.9, 4.4, 0.13, 0x3a3835, 10);
  b.box(-1.3, 0, -6.5, 1.3, 0.12, -6, 0x7a766c);
}

/** 1950s aluminium travel trailer: a riveted bullet on two wheels with a striped awning. */
export function airstream(b: DwellingBuilder): void {
  const aluminium = 0xc5ccd2;
  const stripe = 0x2f6fb3;
  const length = 3.8;
  const stations: number[] = [];
  for (let i = 0; i <= 14; i++) stations.push(length * Math.sin(-Math.PI / 2 + (i / 14) * Math.PI));
  const ringPoints = 16;
  const rings = stations.map((x) => {
    const s = Math.min(1, Math.abs(x) / length);
    const f = Math.pow(Math.max(0, 1 - Math.pow(s, 3)), 1 / 3);
    const halfW = 1.22 * Math.max(0.02, f);
    const halfH = 1.2 * Math.max(0.02, f);
    const ring: P3[] = [];
    for (let k = 0; k < ringPoints; k++) {
      const t = (k / ringPoints) * Math.PI * 2;
      const c = Math.cos(t);
      const n = Math.sin(t);
      ring.push([x, 1.72 + Math.sign(n) * Math.pow(Math.abs(n), 0.6) * halfH, Math.sign(c) * Math.pow(Math.abs(c), 0.6) * halfW]);
    }
    return ring;
  });
  b.loft(rings, aluminium);
  /** The body's -Z skin at (x, y), pushed `lift` proud: panes and paint follow the curve. */
  const skin = (x: number, y: number, lift = 0.03): number => {
    const s = Math.min(1, Math.abs(x) / length);
    const f = Math.pow(Math.max(0, 1 - Math.pow(s, 3)), 1 / 3);
    const n = Math.min(1, Math.abs(y - 1.72) / Math.max(0.02, 1.2 * f));
    const sine = Math.pow(n, 1 / 0.6);
    const cosine = Math.sqrt(Math.max(0, 1 - sine * sine));
    return -(Math.pow(cosine, 0.6) * 1.22 * f) - lift;
  };
  const pane = (x0: number, x1: number, y0: number, y1: number): void => {
    b.glassPoly([[x0, y0, skin(x0, y0)], [x1, y0, skin(x1, y0)], [x1, y1, skin(x1, y1)], [x0, y1, skin(x0, y1)]], [0, 0, -1]);
  };
  pane(-2.6, -1.5, 1.95, 2.45);
  pane(0.9, 2.3, 1.95, 2.45);
  // A painted belt line down both flanks, broken by the door.
  for (let x = -3.3; x < 3.3 - 1e-6; x += 0.3) {
    const x1 = x + 0.3;
    for (const side of [-1, 1]) {
      if (side < 0 && x1 > -0.65 && x < 0.25) continue;
      const z = (px: number, py: number): number => -side * skin(px, py, 0.015);
      b.poly([[x, 1.36, z(x, 1.36)], [x1, 1.36, z(x1, 1.36)], [x1, 1.52, z(x1, 1.52)], [x, 1.52, z(x, 1.52)]], stripe, [0, 0, side]);
    }
  }
  b.poly(archOutline(0, 0, 0.72, 1.95).map(([u, v]) => [-0.2 + u, 0.62 + v, skin(-0.2 + u, 0.62 + v, 0.02)] as P3), 0xaeb6bc, [0, 0, -1]);
  b.box(-0.02, 1.5, skin(0, 1.54, 0.07), 0.08, 1.58, skin(0, 1.54, 0.02), 0x3a3a3a);
  // Striped awning over the door.
  for (let k = 0; k < 7; k++) {
    const x0 = -1.1 + k * 0.28;
    b.hexa(
      [[x0, 2.72, skin(x0, 2.72, 0)], [x0 + 0.28, 2.72, skin(x0 + 0.28, 2.72, 0)], [x0 + 0.28, 2.45, -2.4], [x0, 2.45, -2.4], [x0, 2.77, skin(x0, 2.77, 0)], [x0 + 0.28, 2.77, skin(x0 + 0.28, 2.77, 0)], [x0 + 0.28, 2.5, -2.4], [x0, 2.5, -2.4]],
      k % 2 ? 0xf2efe6 : 0x2fa3a0,
    );
  }
  for (const x of [-1.05, 0.8]) b.beam([x, 0, -2.35], [x, 2.47, -2.38], 0.04, 0x9aa1a6);
  for (const x of [-0.45, 0.35]) for (const z of [-1.25, 1.25]) wheel(b, x, 0.38, z, 0.38, 0.22, 0x1f1f1f, 0xe8e6e0);
  // Hitch, gas bottle and jack.
  b.beam([3.6, 0.7, -0.5], [5.1, 0.55, 0], 0.08, 0x3a3a3a);
  b.beam([3.6, 0.7, 0.5], [5.1, 0.55, 0], 0.08, 0x3a3a3a);
  b.lathe(4.4, 0, [[0.2, 0.75], [0.22, 0.85], [0.22, 1.35], [0.12, 1.5], [0.05, 1.55]], 10, 0xeae6da);
  b.box(4.95, 0, -0.06, 5.07, 0.6, 0.06, 0x3a3a3a);
}

/** A 1970s single-wide, sinking at one end: two-tone siding, foil in one window. */
export function trailerWreck(b: DwellingBuilder): void {
  const cream = 0xe6d9bc;
  const band = 0xa0582a;
  const tin = 0xb3b5b2;
  const plank = 0xa3957a;
  const frame = 0xb8bcbe;
  b.trim = frame;
  b.at(7, 0, 0, 0, () => b.at(-7, 0, 0, 0, () => {
    const home = b.mass(-7, 7, 0.65, 3.2, -2.1, 2.1, cream);
    for (const face of [home.front, home.back]) {
      face.band(0.9, 0.45, band, 0.015);
      battens(face, 0, 2.55, 0.3, shade(cream, 0.9));
    }
    home.front.window(-5.2, 1.0, 1.2, 0.9, { frame, rails: 1 });
    home.front.window(-2.4, 1.0, 1.4, 0.9, { frame, boarded: plank });
    home.front.window(3.3, 1.0, 1.2, 0.9, { frame, rails: 1 });
    home.front.shape([[5.35, 1.0], [6.35, 1.0], [6.35, 1.9], [5.35, 1.9]], 0xd8dadc, 0.03);
    home.front.box(5.25, 5.35, 0.92, 1.98, 0, 0.05, frame);
    home.front.box(6.35, 6.45, 0.92, 1.98, 0, 0.05, frame);
    home.front.door(0.6, 0.85, 1.95, 0xd8cdb0, { frame, glass: true });
    b.gable(-7, 7, -2.1, 2.1, 3.2, 3.65, { roof: tin, wall: cream, over: 0.12, end: 0.08, thick: 0.08 });
    // Skirting with panels missing.
    for (let x = -6.9; x < 6.9; x += 1.2) {
      if (Math.round(x * 10) % 3 === 0) continue;
      b.box(x, 0, -2.08, x + 1.15, 0.65, -2.02, 0xcfc4a8);
    }
    b.box(-7, 0, -1.9, 7, 0.62, 1.9, 0x1c1916);
    // Tyre on the roof and a dish on a pole.
    b.lathe(-2.5, 0.8, [[0.42, 3.62], [0.42, 3.82]], 12, 0x1f1f1f);
    b.beam([6.4, 3.3, 1.5], [6.4, 4.1, 1.5], 0.06, 0x8a8a88);
    b.at(6.4, 4.2, 1.5, 0.6, () => b.dome(0, 0, 0, 0.45, 0xdedcd6, 0.35, 12, 3), -1.0);
  }), 0, 0.035);
  // A broken aluminium awning over the door, one end on the ground.
  for (let k = 0; k < 4; k++) {
    const x0 = -1.2 + k * 0.62;
    const x1 = x0 + 0.55;
    const far = (x: number): number => 1.9 - ((x + 1.2) / 2.4) * 1.6;
    b.at(-0.6, 0, -2.4, 0, () => b.hexa(
      [[x0, 2.3, 0.3], [x1, 2.3, 0.3], [x1, far(x1), -1.4], [x0, far(x0), -1.4], [x0, 2.34, 0.3], [x1, 2.34, 0.3], [x1, far(x1) + 0.04, -1.4], [x0, far(x0) + 0.04, -1.4]],
      k % 2 ? 0x9fa4a6 : 0xd9d6cf,
    ));
  }
  steps(b, -1.0, -0.2, -2.1, 0.65, 3, 0x8e8e8a, 0.26);
}

/** 1960s A-frame: roof to the ground, a glazed gable and a deck across it. */
export function aFrame(b: DwellingBuilder): void {
  const shingle = 0x3f4b3d;
  const timber = 0xa87044;
  const dark = 0x5b3a22;
  b.trim = dark;
  b.box(-4.3, 0, -4.6, 4.3, 0.3, 4.6, 0x8a8479);
  b.gable(-4, 4, -4.5, 4.5, 0.3, 8.6, { axis: 'z', roof: shingle, wall: timber, over: 0.35, end: 0.9, thick: 0.2 });
  const gableFace = frontAt(b, -4.5, 8, 8.6);
  const slope = 8.3 / 4;
  const halfAt = (y: number): number => Math.max(0, 4 - (y - 0.3) / slope);
  const inset = 0.35;
  const glassTop = 8.0;
  gableFace.glass([[-halfAt(0.9) + inset, 0.9], [halfAt(0.9) - inset, 0.9], [0, glassTop - inset]], 0.02);
  for (const u of [-2, -1, 1, 2]) {
    const top = 0.3 + (4 - Math.abs(u)) * slope - 0.3;
    gableFace.box(u - 0.06, u + 0.06, 0.9, top, 0, 0.07, dark);
  }
  gableFace.box(-0.08, 0.08, 0.9, glassTop - 0.3, 0, 0.07, dark);
  gableFace.box(-halfAt(3.2), halfAt(3.2), 3.1, 3.3, 0, 0.07, dark);
  gableFace.box(-halfAt(0.9), halfAt(0.9), 0.8, 0.95, 0, 0.07, dark);
  gableFace.door(0, 1.0, 2.0, 0xc2492f, { v: 0.95, frame: dark, glass: true });
  // Deck across the glass at the loft floor, on four posts.
  b.box(-3.0, 3.0, -6.1, 3.0, 3.2, -4.5, timber);
  b.railing([-3.0, -6.05], [3.0, -6.05], 3.2, 1.0, dark, 10, 0.06);
  for (const x of [-2.9, 2.9]) b.railing([x, -6.05], [x, -4.6], 3.2, 1.0, dark, 3, 0.06);
  for (const x of [-2.8, 2.8]) b.box(x - 0.1, 0, -6.0, x + 0.1, 3.0, -5.8, dark);
  steps(b, -0.7, 0.7, -4.6, 0.3, 1, 0x8a8479);
  b.cylinder(1.6, 2.0, 5.0, 9.4, 0.16, 0x1d1d1d, 10);
  b.lathe(1.6, 2.0, [[0.3, 9.4], [0.3, 9.45], [0, 9.7]], 10, 0x1d1d1d);
}

/** Palm Springs modern: a butterfly roof over glass, a stone wall and a carport. */
export function butterfly(b: DwellingBuilder): void {
  const yellow = 0xf2d77b;
  const white = 0xf4f1ea;
  const black = 0x1f2224;
  const stone = [0xb9a58a, 0xa8937a, 0xc7b699, 0x9c8a70];
  b.trim = black;
  b.box(-7.2, 0, -4.2, 7.2, 0.2, 4.2, 0xd9d2c3);
  b.extrude([[-7, 0.2], [7, 0.2], [7, 3.5], [0, 2.8], [-7, 3.5]], 'z', -4, 4, yellow);
  const over = 0.9;
  const drop = 0.7 / 7;
  for (const side of [-1, 1]) {
    const xo = side * (7 + over);
    const yo = 3.5 + over * drop;
    b.hexa(
      [[0, 2.8, -4.7], [xo, yo, -4.7], [xo, yo, 4.7], [0, 2.8, 4.7], [0, 3.0, -4.7], [xo, yo + 0.2, -4.7], [xo, yo + 0.2, 4.7], [0, 3.0, 4.7]],
      white,
    );
  }
  const front = frontAt(b, -4, 14, 3.5);
  // Glass wall from floor to roof over the living room.
  for (let k = 0; k < 5; k++) {
    const u0 = 1.2 + k * 1.1;
    const topAt = (u: number): number => 2.8 + (Math.abs(u) / 7) * 0.7 - 0.05;
    front.glass([[u0, 0.2], [u0 + 1.1, 0.2], [u0 + 1.1, topAt(u0 + 1.1)], [u0, topAt(u0)]], 0.02);
    front.box(u0 - 0.03, u0 + 0.03, 0.2, topAt(u0), 0, 0.06, black);
  }
  front.box(6.67, 6.73, 0.2, 3.45, 0, 0.06, black);
  stonework(front, 0.2, 3.0, 0.3, stone, 0xb07a, -1.0, 1.1);
  front.door(-2.0, 1.1, 2.3, 0x2fb3a8, { frame: white, v: 0.2 });
  // Breeze-block screen beside the door.
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 7; col++) {
      const u = -6.4 + col * 0.42;
      const v = 0.45 + row * 0.38;
      front.box(u, u + 0.4, v, v + 0.36, 0, 0.1, white);
      front.box(u + 0.1, u + 0.3, v + 0.09, v + 0.27, 0.1, 0.11, 0x8c7a4e);
    }
  }
  // Carport off the right side.
  b.box(-12.5, 2.6, -3.2, -7, 2.78, 3.2, white);
  for (const [x, z] of [[-12.3, -3.0], [-12.3, 3.0], [-9.6, -3.0], [-9.6, 3.0]] as const) b.box(x - 0.06, 0, z - 0.06, x + 0.06, 2.6, z + 0.06, black);
}

/** Streamline Moderne: a rounded corner, speed lines, portholes and glass block. */
export function streamline(b: DwellingBuilder): void {
  const white = 0xf3efe4;
  const pink = 0xf0a7b5;
  const teal = 0x3fb3ab;
  b.trim = pink;
  const radius = 2.0;
  const cx = 3.0;
  const cz = -1.5;
  const main = b.mass(-5, cx, 0, 6.4, -3.5, 3.5, white);
  b.box(cx, 0, cz, 5, 6.4, 3.5, white);
  b.cylinder(cx, cz, 0, 6.4, radius, white, 24);
  // Speed lines: three bands round the front and the curve.
  for (const y of [2.6, 2.85, 3.1]) {
    main.front.box(-4, 3.4, y, y + 0.1, 0, 0.06, pink);
    b.lathe(cx, cz, [[radius + 0.06, y], [radius + 0.06, y + 0.1]], 24, pink, { phase: 0 });
  }
  b.box(-5.02, 6.2, -3.55, cx, 6.55, 3.55, pink);
  b.box(cx, 6.2, cz, 5.05, 6.55, 3.55, pink);
  b.lathe(cx, cz, [[radius + 0.05, 6.2], [radius + 0.05, 6.55]], 24, pink);
  // Curved ribbon of glass round the corner, pane by pane.
  const panes = 7;
  for (let k = 0; k < panes; k++) {
    const a0 = -Math.PI / 2 + (k / panes) * (Math.PI / 2);
    const a1 = -Math.PI / 2 + ((k + 1) / panes) * (Math.PI / 2);
    const r = radius + 0.02;
    const p = (a: number, y: number): P3 => [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
    const mid = (a0 + a1) / 2;
    b.glassPoly([p(a0, 3.8), p(a1, 3.8), p(a1, 5.0), p(a0, 5.0)], [Math.cos(mid), 0, Math.sin(mid)]);
    b.box(cx + Math.cos(a0) * r - 0.03, 3.75, cz + Math.sin(a0) * r - 0.03, cx + Math.cos(a0) * r + 0.03, 5.05, cz + Math.sin(a0) * r + 0.03, pink);
  }
  main.front.glass([[-3.95, 3.8], [-0.6, 3.8], [-0.6, 5.0], [-3.95, 5.0]], 0.02);
  main.front.box(-3.05, -0.55, 3.72, 3.8, 0, 0.06, pink);
  main.front.box(-3.05, -0.55, 5.0, 5.08, 0, 0.06, pink);
  main.front.box(-3.2, 3.4, 5.15, 5.22, 0, 0.55, white);
  porthole(main.front, -2.3, 1.4, 0.45, pink);
  main.front.door(0.2, 1.0, 2.2, teal, { frame: pink });
  main.front.box(-0.65, 1.05, 2.4, 2.52, 0, 0.8, white);
  // Glass-block panel beside the door.
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 3; col++) main.front.box(1.2 + col * 0.3, 1.47 + col * 0.3, 0.3 + row * 0.3, 0.57 + row * 0.3, 0, 0.04, 0xcfe6ea);
  }
  // Vertical fin over the corner.
  b.box(cx + 1.3, 6.4, cz - 1.45, cx + 1.45, 8.4, cz - 1.3, white);
  for (const y of [7.0, 7.5, 8.0]) b.box(cx + 1.1, y, cz - 1.65, cx + 1.65, y + 0.1, cz - 1.1, teal);
}

/** Hacienda: ochre walls, a portal of painted arches, clay tile and an espadaña bell gable. */
export function hacienda(b: DwellingBuilder): void {
  const ochre = 0xd9a55b;
  const tile = 0xb4553a;
  const blue = 0x2e5f9e;
  const viga = 0x5b3a22;
  const shadow = 0x4a3024;
  b.trim = viga;
  const main = b.mass(-8, 8, 0, 3.4, -1, 4, ochre);
  const wing = b.mass(4, 8, 0, 3.4, -5.5, -1, ochre);
  const tileRoof = (x0: number, x1: number, z0: number, z1: number, axis: 'x' | 'z'): void => {
    b.gable(x0, x1, z0, z1, 3.4, 4.6, { axis, roof: tile, wall: ochre, over: 0.45, end: 0.35, thick: 0.16 });
  };
  tileRoof(-8, 8, -1, 4, 'x');
  tileRoof(4, 8, -5.5, -1, 'z');
  // Barrel-tile ribs down the front slope.
  const slope = 1.2 / 2.5;
  for (let x = -8.2; x <= 8.2; x += 0.34) {
    if (x > 3.6) break;
    b.beam([x, 4.6 + 0.2, 1.5], [x, 3.4 - 0.45 * slope + 0.18, -1.45], 0.13, shade(tile, 0.8), 0.07);
  }
  // Portal: a wall of painted arches under a shed roof, with the vigas showing.
  const portal = b.mass(-8, 4, 0, 3.1, -3.4, -1, ochre);
  for (let k = 0; k < 5; k++) {
    const u = -4.8 + k * 2.4;
    portal.front.shape(archOutline(u, 0, 1.7, 2.45, 10), shadow, 0.015);
    portal.front.box(u + 1.05, u + 1.35, 0, 0.35, 0, 0.1, shade(ochre, 0.85));
  }
  b.shed(-8, 4, -3.4, -1, 3.2, 3.5, tile, 0.3, 0.14);
  for (let x = -7.6; x <= 3.6; x += 0.8) b.box(x - 0.08, 2.85, -3.8, x + 0.08, 3.0, -3.3, viga);
  wing.front.door(0, 1.4, 2.3, blue, { double: true, panels: true, frame: viga, arch: true });
  for (let k = 0; k < 10; k++) wing.front.box(-0.55 + (k % 5) * 0.27, -0.49 + (k % 5) * 0.27, 0.6 + Math.floor(k / 5) * 0.8, 0.66 + Math.floor(k / 5) * 0.8, 0.035, 0.06, 0x2a2622);
  for (const u of [3.5, -3.5]) {
    main.back.window(u, 1.0, 0.9, 1.3, { shutters: blue, bars: 3, frame: 0x2a2622 });
  }
  wing.right.window(0, 1.0, 0.9, 1.3, { shutters: blue, bars: 3, frame: 0x2a2622 });
  // Espadaña: a curved bell gable standing above the wing's front.
  const bell: P2[] = [[-1.6, 3.3], [1.6, 3.3], [1.6, 4.3], [1.1, 4.5], [0.75, 5.3], [0.4, 5.5], [0, 5.7], [-0.4, 5.5], [-0.75, 5.3], [-1.1, 4.5], [-1.6, 4.3]];
  b.extrude(bell.map(([u, v]): P2 => [6 - u, v]), 'z', -5.65, -5.35, ochre);
  const gableWall = frontAt(b, -5.5, 4, 6, 6);
  gableWall.shape(archOutline(0, 4.2, 0.6, 0.9), shadow, 0.02, 0.15);
  b.lathe(6, -5.74, [[0.2, 4.35], [0.14, 4.6], [0.06, 4.75], [0, 4.8]], 10, 0x8a6a3a);
  // Pots along the portal.
  for (const x of [-7.5, -5.1, -2.7, -0.3]) b.lathe(x, -3.8, [[0.2, 0], [0.28, 0.3], [0.22, 0.55], [0.26, 0.6]], 10, 0xb86a3e);
}

/** Mexican casitas: three painted cubes of different heights, a tinaco on the roof. */
export function casita(b: DwellingBuilder): void {
  const magenta = 0xd23f8a;
  const sun = 0xf2b632;
  const teal = 0x2fb3b0;
  const white = 0xf5f1e6;
  const cobalt = 0x2350a8;
  b.trim = white;
  const a = b.mass(-6, -2, 0, 3.2, -2.5, 2.5, magenta);
  const c = b.mass(-2, 2.2, 0, 6.2, -2.8, 3, sun);
  const d = b.mass(2.2, 6, 0, 3.6, -2.4, 2.5, teal);
  for (const [mass, colour, h] of [[a, sun, 3.2], [c, cobalt, 6.2], [d, magenta, 3.6]] as const) {
    mass.front.band(0, 0.4, colour, 0.02);
    mass.front.band(h - 0.3, 0.3, white, 0.05);
  }
  b.parapet(-6, -2, -2.5, 2.5, 3.2, 0.4, 0.2, magenta);
  b.parapet(-2, 2.2, -2.8, 3, 6.2, 0.45, 0.2, sun);
  b.parapet(2.2, 6, -2.4, 2.5, 3.6, 0.35, 0.2, teal);
  a.front.door(0.8, 0.95, 2.1, teal, { frame: white });
  a.front.window(-1.0, 1.0, 0.8, 1.0, { frame: cobalt, surround: white, surroundWidth: 0.12, bars: 3 });
  c.front.door(0, 1.05, 2.2, magenta, { frame: white, arch: true });
  c.front.window(0, 3.6, 1.0, 1.4, { frame: white, cross: true, surround: cobalt, surroundWidth: 0.1 });
  d.front.window(-0.6, 1.0, 0.9, 1.1, { frame: white, shutters: sun, cross: true });
  d.front.door(1.2, 0.85, 2.0, cobalt, { frame: white });
  // Balcony on the tall one.
  b.box(-1.2, 3.3, -3.5, 1.2, 3.42, -2.8, white);
  b.railing([-1.15, -3.45], [1.15, -3.45], 3.42, 0.95, 0x1d1d1d, 8, 0.04);
  for (const x of [-1.1, 1.1]) b.railing([x, -3.45], [x, -2.85], 3.42, 0.95, 0x1d1d1d, 2, 0.04);
  // Tinaco and pot plants on the roofs.
  b.lathe(4.3, 0.8, [[0.55, 3.6], [0.6, 3.75], [0.6, 4.8], [0.3, 5.0], [0.3, 5.1]], 14, 0x1d1d1d);
  for (const [x, z, y] of [[-5.3, -2.2, 3.6], [-3.9, -2.2, 3.6], [0.9, -2.6, 6.65]] as const) {
    b.lathe(x, z, [[0.16, y], [0.2, y + 0.28]], 8, 0xb86a3e);
    b.ball(x, y + 0.45, z, 0.26, 0x3f8a3a, 1, 8);
  }
  // Papel picado across the gap between two parapets.
  for (let k = 0; k < 9; k++) {
    const x = 2.35 + k * 0.4;
    const y = 4.25 - Math.sin((k / 8) * Math.PI) * 0.35;
    b.poly([[x, y, -2.45], [x + 0.3, y, -2.45], [x + 0.15, y - 0.32, -2.45]], [0xd23f8a, 0xf2b632, 0x2fb3b0, 0x7a4fc0][k % 4]!, [0, 0, -1]);
  }
  b.beam([2.2, 4.3, -2.45], [5.9, 3.95, -2.45], 0.015, 0x2a2622);
}

/** An adobe ruin: roofless walls of broken height, windows gaping, sand heaped inside. */
export function adobeRuin(b: DwellingBuilder): void {
  const adobe = 0xb8875a;
  const brick = 0x9b5b3e;
  const void_ = 0x33241b;
  const sand = 0xc99f6b;
  const viga = 0x5a4332;
  b.trim = viga;
  const rand = jitter(0xad0b);
  const T = 0.24;
  /**
   * One wall, ONE solid: its outline is the ground line and a crumbled crest through
   * `heights` (evenly spaced from `from` to `to`, with a little rubble noise between),
   * pushed through the wall's thickness. Built from per-metre blocks instead, the
   * neighbouring blocks overlapped with coplanar faces and flickered.
   */
  const wall = (axis: 'x' | 'z', fixed: number, from: number, to: number, heights: readonly number[]): void => {
    const crest: P2[] = [];
    const steps = (heights.length - 1) * 3;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const f = t * (heights.length - 1);
      const k = Math.min(heights.length - 2, Math.floor(f));
      const h = heights[k]! + (heights[k + 1]! - heights[k]!) * (f - k);
      const bump = i === 0 || i === steps ? 0 : rand(-0.09, 0.09);
      crest.push([from + (to - from) * t, h + bump]);
    }
    const outline: P2[] = [[from, 0], [to, 0], ...crest.reverse()];
    // Axis 'z' walls run along X (outline in [x, y]); axis 'x' walls run along Z.
    b.extrude(outline, axis, fixed - T, fixed + T, adobe);
  };
  // Front and back walls run the full width; the side walls stop against their inner
  // faces, so no two solids share a face.
  wall('z', -4, -5 - T, 5 + T, [2.8, 3.0, 2.9, 2.8, 2.7, 2.2, 1.3, 1.1, 2.3, 2.9, 2.7]);
  wall('z', 4, -5 - T, 5 + T, [2.4, 2.9, 3.0, 3.0, 2.6, 2.1, 1.4, 1.9, 2.5, 2.8, 2.6]);
  wall('x', -5, -4 + T, 4 - T, [2.8, 2.5, 1.7, 1.2, 1.8, 2.4, 2.6, 2.4, 2.2]);
  wall('x', 5, -4 + T, 4 - T, [2.7, 2.9, 3.0, 2.8, 2.2, 1.5, 2.0, 2.6, 2.8]);
  // The sand the wind put inside, heaped to the sills, and a drift against the front.
  b.hexa([[-4.76, 0, -3.76], [4.76, 0, -3.76], [4.76, 0, 3.76], [-4.76, 0, 3.76], [-3.0, 1.1, -1.8], [2.2, 0.9, -1.6], [2.8, 0.8, 2.0], [-2.4, 1.0, 2.4]], sand);
  b.hexa([[-6.4, 0, -5.6], [-0.2, 0, -5.6], [-0.2, 0, -4.3], [-6.4, 0, -4.3], [-6.0, 0, -5.6], [-0.6, 0, -5.6], [-0.9, 0.85, -4.3], [-5.2, 1.1, -4.3]], sand);
  // Features are placed in WORLD x and converted, so each one can be checked against
  // the crest above it: nothing painted may stand higher than the wall it is on, and no
  // two painted shapes overlap (they sit millimetres apart and would flicker).
  const front = frontAt(b, -4 - T, 10.5, 3);
  const onFront = (x0: number, x1: number, v0: number, v1: number): P2[] => rectOutline(-x1, v0, -x0, v1);
  front.shape(onFront(-2.2, -1.2, 0.6, 2.25), void_, 0.012);
  front.box(1.05, 2.35, 2.25, 2.42, 0, 0.1, viga);
  front.shape(onFront(-4.3, -3.5, 1.0, 1.9), void_, 0.012);
  front.shape(onFront(3.2, 4.0, 1.0, 1.95), void_, 0.012);
  for (const [x0, x1, v0, v1] of [[-0.4, 0.5, 1.2, 1.8], [-0.2, 0.6, 0.3, 0.8], [-5.0, -4.5, 0.4, 1.0]] as const) {
    front.shape([[-x1, v0], [-x0, v0 + 0.1], [-x0 - 0.1, v1], [-x1 + 0.1, v1 - 0.05]], brick, 0.01);
  }
  const back = new Facade(b, [0, 0, 4 + T], [1, 0, 0], [0, 0, 1], 10.5, 3);
  back.shape(rectOutline(-1.0, 1.0, 0.0, 2.0), void_, 0.012);
  // Vigas: some still across, some fallen in.
  for (const [x, drop] of [[-3.4, 0], [-1.6, 0.9], [2.8, 0.3]] as const) {
    b.beam([x, 2.6 - drop, -4.4], [x + rand(-0.4, 0.4), 2.2 - drop * 1.5, 4.4], 0.2, viga);
  }
  b.beam([0.6, 0.1, -5.8], [2.4, 1.2, -4.3], 0.18, viga);
}

/** Yucatec Maya na: an oval lime-washed wall under a very steep thatch. */
export function maya(b: DwellingBuilder): void {
  const lime = 0xf1ece0;
  const ochre = 0xa9482c;
  const thatch = 0xb99a5a;
  const stone = 0xa39c8e;
  b.trim = 0x5a3c26;
  const house = (cx: number, cz: number, r: number, sx: number, h: number, scale: number): void => {
    b.lathe(cx, cz, [[r + 0.35, 0], [r + 0.35, 0.3]], 20, stone, { sx });
    b.lathe(cx, cz, [[r, 0.3], [r, 0.65], [r, h]], 20, (i) => (i === 0 ? ochre : lime), { sx, capTop: false });
    b.lathe(
      cx,
      cz,
      [[r + 0.35, h - 0.2], [r * 0.85, h + 1.3 * scale], [r * 0.5, h + 2.9 * scale], [r * 0.14, h + 4.2 * scale], [0.02, h + 4.35 * scale]],
      20,
      thatch,
      { sx: sx * 1.05 },
    );
  };
  house(0, 0, 2.6, 1.6, 2.3, 1);
  const front = b.radial(0, 0, 2.6 * 1.6, 2.6, -Math.PI / 2, 0.3, 2, 2);
  front.door(0, 0.9, 1.85, 0x6b4a2c, { frame: 0x5a3c26 });
  for (const u of [-0.9, 0.9]) front.box(u - 0.18, u + 0.18, 1.35, 1.72, 0, 0.02, ochre);
  front.box(-1.1, 1.1, 1.92, 2.0, 0, 0.02, ochre);
  house(-4.6, 4.2, 1.5, 1.2, 1.9, 0.62);
  for (const [x, z] of [[4.9, -1.8], [5.4, -0.9]] as const) b.lathe(x, z, [[0.28, 0], [0.38, 0.3], [0.3, 0.55]], 10, 0xb86a3e);
}

/** Barbados chattel house: two pastel gables side by side, jalousies and fretwork. */
export function chattel(b: DwellingBuilder): void {
  const blue = 0x7cc6e0;
  const pink = 0xf29bb6;
  const white = 0xf8f6f0;
  const stone = [0xb4ad9f, 0x9f998c, 0xc2bcae];
  b.trim = white;
  const plinth = b.mass(-4.5, 4.5, 0, 0.55, -2.6, 2.6, 0xa9a395);
  stonework(plinth.front, 0, 0.55, 0.27, stone, 0xc4a7);
  const units = [
    { x0: -4.4, x1: 0, colour: blue, roof: 0xb8bcbf, jalousie: pink },
    { x0: 0, x1: 4.4, colour: pink, roof: 0xb8483a, jalousie: 0x3aa0c4 },
  ];
  for (const unit of units) {
    const body = b.mass(unit.x0, unit.x1, 0.55, 3.2, -2.5, 2.5, unit.colour);
    for (const face of [body.front, body.back, body.left, body.right]) siding(face, 0, 2.65, 0.22, unit.colour);
    b.gable(unit.x0, unit.x1, -2.5, 2.5, 3.2, 5.0, { axis: 'z', roof: unit.roof, wall: unit.colour, over: 0.25, end: 0.35 });
    const pediment = frontAt(b, -2.5, 4.4, 5.0, (unit.x0 + unit.x1) / 2);
    for (let k = 0; k < 7; k++) {
      const t = (k + 0.5) / 7;
      const u = -2.2 + t * 2.2;
      const v = 3.2 + t * 1.8 - 0.25;
      pediment.shape([[u - 0.1, v], [u + 0.1, v], [u, v - 0.22]], white, 0.03, 0.3);
      pediment.shape([[-u - 0.1, v], [-u + 0.1, v], [-u, v - 0.22]], white, 0.03, 0.3);
    }
    pediment.window(0, 3.55, 0.45, 0.55, { frame: white });
  }
  // Jalousies: shutter boards louvred across, painted in the neighbour's colour.
  const jalousie = (f: Facade, u: number, v: number, w: number, h: number, colour: number): void => {
    f.window(u, v, w, h, { frame: white });
    for (const side of [-1, 1]) {
      const x0 = u + side * (w / 2 + 0.1);
      const x1 = x0 + side * (w / 2);
      f.box(Math.min(x0, x1), Math.max(x0, x1), v - 0.05, v + h + 0.05, 0, 0.05, colour);
      for (let y = v + 0.08; y < v + h; y += 0.12) f.box(Math.min(x0, x1) + 0.04, Math.max(x0, x1) - 0.04, y, y + 0.04, 0.05, 0.07, shade(colour, 0.8));
    }
  };
  const blueFace = new Facade(b, [-2.2, 0.55, -2.5], LEFT_U, FRONT, 4.4, 2.65);
  const pinkFace = new Facade(b, [2.2, 0.55, -2.5], LEFT_U, FRONT, 4.4, 2.65);
  for (const u of [-1.0, 1.0]) jalousie(blueFace, u, 0.55, 0.7, 1.3, pink);
  pinkFace.door(-0.6, 0.9, 2.0, 0x3aa0c4, { frame: white, panels: true });
  jalousie(pinkFace, 1.2, 0.55, 0.7, 1.3, 0x3aa0c4);
  // Gallery across the pink unit, with a fretwork valance.
  b.box(0.2, 0, -4.0, 4.4, 0.55, -2.55, 0xa9a395);
  for (const x of [0.35, 2.3, 4.25]) b.box(x - 0.07, 0.55, -3.92, x + 0.07, 2.9, -3.78, white);
  const valance = frontAt(b, -3.95, 4.3, 3.2, 2.3);
  valance.box(-2.1, 2.1, 2.75, 2.9, 0, 0.05, white);
  for (let u = -2.0; u <= 2.0; u += 0.25) valance.shape([[u - 0.1, 2.75], [u + 0.1, 2.75], [u, 2.55]], white, 0.03);
  b.shed(0.2, 4.4, -4.0, -2.55, 2.95, 3.25, 0xb8bcbf, 0.12, 0.08);
  b.railing([0.3, -3.95], [1.9, -3.95], 0.55, 0.8, white, 6, 0.05);
  steps(b, 2.3, 3.3, -4.0, 0.55, 2, 0xa9a395);
}
