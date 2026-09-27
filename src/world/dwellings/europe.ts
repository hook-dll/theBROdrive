import { DwellingBuilder, Facade, archOutline, shade, type P2, type P3 } from './builder';
import { battens, carvedWindow, flower, glazedWall, jitter, logWalls, porthole, siding, steps, stonework } from './parts';

const FRONT: P3 = [0, 0, -1];
const LEFT_U: P3 = [-1, 0, 0];

/** A facade on the plane z = z0 looking -Z, with `v` measured from the ground. */
function frontAt(b: DwellingBuilder, z: number, width: number, height: number, x = 0): Facade {
  return new Facade(b, [x, 0, z], LEFT_U, FRONT, width, height);
}

/** Izba with carved window surrounds, blue shutters and a horse-head ridge. */
export function izba(b: DwellingBuilder): void {
  const white = 0xf4f0e6;
  const blue = 0x2f7bc8;
  const roof = 0x5e9468;
  const boards = 0xb07d4b;
  b.trim = white;
  const x0 = -3.2;
  const x1 = 3.2;
  const z0 = -3.0;
  const z1 = 3.0;
  const r = 0.15;
  const base = 0.5;
  const eave = 3.2;
  const ridge = 5.6;
  b.box(x0 - 0.12, 0, z0 - 0.12, x1 + 0.12, base, z1 + 0.12, 0x8d877b);
  logWalls(b, x0, x1, z0, z1, base, eave, r, [0x9d6b3d, 0x8e5f35, 0xa7744a], 0.3, 0x4a3322);
  const front = frontAt(b, z0 - r, 6.4, eave);
  for (const u of [-1.8, 0, 1.8]) carvedWindow(front, u, 1.45, 0.72, 1.05, white, blue);
  const left = new Facade(b, [x0 - r, 0, 0], [0, 0, 1], [-1, 0, 0], 6, eave);
  carvedWindow(left, -1.2, 1.45, 0.72, 1.05, white, blue);
  carvedWindow(left, 1.4, 1.45, 0.72, 1.05, white, blue);
  b.gable(x0, x1, z0, z1, eave, ridge, { axis: 'z', roof, wall: boards, over: 0.55, end: 0.55, thick: 0.16 });
  const pediment = frontAt(b, z0, 6.4, ridge);
  pediment.band(eave, 0.16, white, 0.1, 0.3);
  pediment.window(0, eave + 0.6, 0.6, 0.75, { frame: white, surround: white, surroundWidth: 0.08, shutters: blue });
  const slope = (ridge - eave) / 3.2;
  for (const side of [-1, 1]) {
    pediment.plank([side * 3.75, eave - 0.55 * slope - 0.12], [0, ridge - 0.14], 0.26, white, 0.05, 0.48);
  }
  pediment.shape([[-0.13, ridge - 0.3], [0.13, ridge - 0.3], [0.13, ridge - 1.0], [0, ridge - 1.18], [-0.13, ridge - 1.0]], white, 0.05, 0.5);
  // Okhlupen: the ridge log ending in a horse's head over the gable.
  const wood = 0x6e4a2c;
  b.box(-0.12, ridge + 0.14, z0 - 0.6, 0.12, ridge + 0.36, z1 + 0.6, wood);
  b.box(-0.09, ridge + 0.3, z0 - 0.95, 0.09, ridge + 0.82, z0 - 0.6, wood);
  b.box(-0.08, ridge + 0.6, z0 - 1.2, 0.08, ridge + 0.78, z0 - 0.9, wood);
  b.chimney(1.2, 1.0, ridge - 1.4, ridge + 0.9, 0.55, 0xb6563d);
  // Side porch with its own little gable.
  const porchFloor = 0x8a6a48;
  b.box(x1 + r, 0, -1.4, x1 + 1.9, base, 0.7, porchFloor);
  for (let i = 0; i < 2; i++) b.box(x1 + 1.9 + i * 0.3, 0, -1.2, x1 + 2.2 + i * 0.3, base - (i + 1) * 0.17, 0.5, shade(porchFloor, 0.9));
  const right = new Facade(b, [x1 + r, 0, 0], [0, 0, -1], [1, 0, 0], 6, eave);
  right.door(0.35, 0.9, 2.0, 0x7b4a2a, { v: base, panels: true, frame: white });
  for (const z of [-1.3, 0.6]) b.box(x1 + 1.72, base, z - 0.08, x1 + 1.88, base + 2.35, z + 0.08, wood);
  b.gable(x1 + r, x1 + 1.95, -1.45, 0.75, base + 2.35, base + 3.05, { roof, wall: boards, over: 0.18, end: 0.12, thick: 0.1 });
}

/** The same izba sixty winters on: grey logs, a sunk corner, a holed roof, boards nailed over. */
export function izbaRuin(b: DwellingBuilder): void {
  const grey = [0x6f675b, 0x625a4f, 0x7a7266];
  const white = 0xd9d3c4;
  const roof = 0x6f756c;
  const boards = 0x8b7a62;
  const plank = 0x9a8b72;
  b.trim = white;
  const x0 = -3.2;
  const x1 = 3.2;
  const z0 = -3.0;
  const z1 = 3.0;
  const r = 0.15;
  const base = 0.4;
  const eave = 3.0;
  const ridge = 5.3;
  const slope = (ridge - eave) / 3.2;
  // Pivot on the right sill: the rotted left corner has sunk into the sand.
  b.at(x1, 0, 0, 0.1, () => b.at(-x1, 0, 0, 0, () => {
    b.box(x0 - 0.1, -0.2, z0 - 0.1, x1 + 0.1, base, z1 + 0.1, 0x7d776b);
    logWalls(b, x0, x1, z0, z1, base, eave, r, grey, 0.28, 0x2f2720);
    const front = frontAt(b, z0 - r, 6.4, eave);
    carvedWindow(front, -1.8, 1.35, 0.72, 1.05, white, 0x5c7e98);
    front.window(0, 1.35, 0.72, 1.05, { frame: white, surround: white, surroundWidth: 0.1, boarded: plank });
    front.window(1.8, 1.35, 0.72, 1.05, { frame: white, sill: white });
    front.plank([2.35, 1.2], [2.75, 2.45], 0.34, 0x5c7e98, 0.04, 0.02);
    b.gable(x0, x1, z0, z1, eave, ridge, { axis: 'z', roof: boards, wall: boards, over: 0.5, end: 0.5, thick: 0.15, cap: null });
    // Re-roof the -X slope whole and the +X slope in two pieces round a hole. Each slab
    // overhangs the old roof by 3 cm at every edge and stands 5 cm proud of it, and the
    // two slabs cross at the ridge: flush with the old boards, their ends and eaves
    // shared its planes and flickered.
    const slab = (za: number, zb: number, side: number): void => {
      const xe = side * (3.2 + 0.53);
      const xr = -side * 0.03;
      const ye = eave - 0.53 * slope + 0.02;
      b.hexa(
        [[xe, ye, za], [xe, ye, zb], [xr, ridge + 0.05, zb], [xr, ridge + 0.05, za], [xe, ye + 0.21, za], [xe, ye + 0.21, zb], [xr, ridge + 0.26, zb], [xr, ridge + 0.26, za]],
        roof,
      );
    };
    slab(z0 - 0.53, z1 + 0.53, -1);
    slab(z0 - 0.53, -0.9, 1);
    slab(1.1, z1 + 0.53, 1);
    const hole = (x: number): number => ridge - x * slope + 0.025;
    b.poly([[0.35, hole(0.35), -0.9], [2.9, hole(2.9), -0.9], [2.9, hole(2.9), 1.1], [0.35, hole(0.35), 1.1]], 0x231c16, [slope, 1, 0]);
    for (const z of [-0.45, 0.1, 0.65]) b.beam([0.1, ridge + 0.05, z], [3.3, eave - 0.05, z], 0.1, 0x6c5d4b);
    b.box(-0.1, ridge + 0.14, z0 - 0.5, 0.1, ridge + 0.3, -1.0, 0x5b4a3a);
    const left = new Facade(b, [x0 - r, 0, 0], [0, 0, 1], [-1, 0, 0], 6, eave);
    left.window(-1.2, 1.35, 0.72, 1.05, { frame: white, boarded: plank, surround: white, surroundWidth: 0.1 });
    const right = new Facade(b, [x1 + r, 0, 0], [0, 0, -1], [1, 0, 0], 6, eave);
    right.door(0.35, 0.9, 1.95, 0x5b4636, { v: base, boarded: plank, frame: white });
  }), 0, 0.05);
  // The chimney came down; its bricks lie where they fell.
  const rand = jitter(0xb1a5);
  for (let i = 0; i < 9; i++) {
    const x = rand(-2.6, -0.6);
    const z = rand(-4.4, -3.5);
    b.at(x, 0.1, z, rand(0, Math.PI), () => b.box(-0.13, -0.07, -0.06, 0.13, 0.07, 0.06, i % 2 ? 0x9a4d38 : 0x86432f), rand(-0.3, 0.3));
  }
  b.hexa(
    [[-3.6, 0, -3.5], [3.6, 0, -3.5], [3.6, 0, -3.15], [-3.6, 0, -3.15], [-3.6, 0, -3.5], [3.6, 0, -3.5], [3.6, 0.55, -3.15], [-3.6, 0.8, -3.15]],
    0xcfae7d,
  );
}

/** Soviet dacha: green boards, a mezzanine in the gable and a glazed veranda. */
export function dacha(b: DwellingBuilder): void {
  const wall = 0x79a86b;
  const trim = 0xf6f2e8;
  const roof = 0xbd4b3b;
  const base = 0x9b948a;
  b.trim = trim;
  b.box(-3.6, 0, -2.6, 3.6, 0.45, 3.1, base);
  const house = b.mass(-3.5, 3.5, 0.45, 3.2, -2.5, 3.0, wall);
  for (const face of [house.left, house.right, house.back]) battens(face, 0, 2.75, 0.4, shade(wall, 0.84));
  house.left.window(0.3, 0.7, 0.95, 1.25, { cross: true, sill: trim, shutters: 0x3f6f47 });
  house.right.window(-0.8, 0.7, 0.95, 1.25, { cross: true, sill: trim, shutters: 0x3f6f47 });
  house.back.window(0, 0.7, 0.95, 1.25, { cross: true, sill: trim });
  b.gable(-3.5, 3.5, -2.5, 3.0, 3.2, 6.4, { axis: 'z', roof, wall, over: 0.42, end: 0.45 });
  const pediment = frontAt(b, -2.5, 7, 6.4);
  battens(pediment, 3.25, 3.9, 0.4, shade(wall, 0.84), -2.2, 2.2);
  pediment.window(0, 3.75, 1.1, 1.25, { cross: true, surround: trim, surroundWidth: 0.08 });
  pediment.band(3.2, 0.14, trim, 0.08, 0.3);
  // Veranda: a solid parapet, then a band of glass on three sides.
  const vz0 = -4.9;
  const vz1 = -2.5;
  b.box(-3.3, 0, vz0, 3.3, 0.45, vz1, base);
  const low = b.mass(-3.2, 3.2, 0.45, 1.25, vz0, vz1, 0xefe3c4);
  for (const face of [low.front, low.left, low.right]) battens(face, 0, 0.8, 0.3, 0xd8c9a6);
  const band = b.mass(-3.2, 3.2, 1.25, 2.8, vz0, vz1, 0x39474d);
  glazedWall(band.front, 0.55, trim, 0.64, [-0.62, 0.62]);
  glazedWall(band.left, 0.6, trim, 0.64);
  glazedWall(band.right, 0.6, trim, 0.64);
  b.shed(-3.3, 3.3, vz0, vz1, 2.9, 3.35, roof, 0.3, 0.12);
  low.front.door(0, 0.95, 2.1, 0x5d8a55, { glass: true, frame: trim });
  steps(b, -0.75, 0.75, vz0, 0.45, 2, base);
  b.chimney(-1.4, 1.2, 4.5, 7.1, 0.5, 0xa9523f);
}

/** Post-war "Finnish" prefab: blue lap siding, a gabled dormer and a side porch. */
export function finnishHouse(b: DwellingBuilder): void {
  const wall = 0x6e93b8;
  const trim = 0xf4f1ea;
  const roof = 0x878b86;
  b.trim = trim;
  b.box(-3.3, 0, -3.3, 3.3, 0.4, 3.3, 0x8f8a80);
  const house = b.mass(-3.2, 3.2, 0.4, 3.1, -3.2, 3.2, wall);
  for (const face of [house.front, house.back, house.left, house.right]) siding(face, 0, 2.7, 0.22, wall);
  house.front.window(-1.5, 0.7, 1.0, 1.25, { cross: true, sill: trim, surround: trim, surroundWidth: 0.07 });
  house.front.window(1.5, 0.7, 1.0, 1.25, { cross: true, sill: trim, surround: trim, surroundWidth: 0.07 });
  house.right.window(0, 0.7, 1.0, 1.25, { cross: true, sill: trim });
  house.back.window(-1, 0.7, 1.0, 1.25, { cross: true, sill: trim });
  b.gable(-3.2, 3.2, -3.2, 3.2, 3.1, 6.6, { roof, wall, over: 0.4, end: 0.35 });
  for (const x of [-3.2, 3.2]) {
    const gableSide = new Facade(b, [x, 0, 0], [0, 0, x < 0 ? 1 : -1], [x < 0 ? -1 : 1, 0, 0], 6.4, 6.6);
    gableSide.window(0, 3.8, 0.9, 1.1, { cross: true, surround: trim, surroundWidth: 0.07 });
  }
  // Gabled dormer punching through the front slope.
  const dormer = b.mass(-1.3, 1.3, 3.0, 4.9, -3.3, -0.4, wall);
  siding(dormer.front, 0, 1.9, 0.22, wall);
  dormer.front.window(0, 0.35, 1.2, 1.15, { cross: true, surround: trim, surroundWidth: 0.07 });
  b.gable(-1.3, 1.3, -3.3, -0.4, 4.9, 5.9, { axis: 'z', roof, wall, over: 0.2, end: 0.25 });
  // Left porch.
  b.box(-4.9, 0, -1.2, -3.2, 0.4, 1.0, 0x7d6a55);
  house.left.door(-0.1, 0.9, 2.0, 0x7b5234, { panels: true, v: 0 });
  for (const z of [-1.1, 0.9]) b.box(-4.8, 0.4, z - 0.07, -4.66, 2.7, z + 0.07, trim);
  b.gable(-4.95, -3.2, -1.25, 1.05, 2.7, 3.3, { roof, wall: trim, over: 0.15, end: 0.12, thick: 0.1 });
  b.chimney(1.3, 1.6, 4.4, 7.2, 0.5, 0xa75842);
}

/** Two-storey plastered barrack, long abandoned: plaster off to the brick, windows boarded. */
export function barrack(b: DwellingBuilder): void {
  const wall = 0xd9ad55;
  const brick = 0x9c5a44;
  const trim = 0xe9e3d3;
  const plank = 0x9b8a6d;
  b.trim = trim;
  b.box(-8.1, 0, -4.1, 8.1, 0.5, 4.1, 0x8a857b);
  const house = b.mass(-8, 8, 0.5, 6.6, -4, 4, wall);
  house.front.band(2.85, 0.12, shade(wall, 0.82), 0.05);
  const xs = [-6.4, -4.2, -2.0, 2.0, 4.2, 6.4];
  xs.forEach((u, i) => {
    for (const [floor, v] of [[0, 0.95], [1, 3.9]] as const) {
      const boarded = (i + floor * 3) % 4 === 1 || (i === 5 && floor === 0);
      house.front.window(u, v, 1.2, 1.5, { cross: true, sill: trim, boarded: boarded ? plank : undefined });
      house.back.window(u, v, 1.2, 1.5, { cross: true, sill: trim, boarded: (i + floor) % 3 === 0 ? plank : undefined });
    }
  });
  house.front.window(0, 3.9, 1.2, 1.5, { cross: true, sill: trim });
  house.front.door(0, 1.4, 2.3, 0x5c4a3c, { double: true, panels: true, boarded: plank });
  house.front.box(-1.3, 1.3, 2.9, 3.05, 0, 1.3, 0x8f8b82);
  for (const u of [-1.1, 1.1]) b.beam([u, 0.5 + 2.45, -4.0], [u, 0.5 + 2.95, -5.2], 0.1, 0x6d6a62);
  steps(b, -1.4, 1.4, -4.1, 0.5, 2, 0x8f8b82);
  for (const face of [house.left, house.right]) {
    face.window(-1.6, 0.95, 1.1, 1.5, { cross: true, sill: trim, boarded: plank });
    face.window(1.6, 3.9, 1.1, 1.5, { cross: true, sill: trim });
  }
  // Plaster has fallen away in sheets, showing the brick behind.
  const patches: readonly P2[][] = [
    [[-7.4, 2.3], [-6.2, 2.6], [-5.6, 2.0], [-6.1, 1.2], [-7.2, 1.0], [-7.7, 1.6]],
    [[3.0, 5.6], [4.1, 5.9], [4.6, 5.3], [3.7, 4.9], [3.1, 5.0]],
    [[-3.3, 0.6], [-2.4, 0.9], [-2.2, 0.4], [-3.4, 0.1]],
    [[5.1, 2.9], [5.8, 3.2], [6.2, 2.6], [5.4, 2.4]],
  ];
  for (const patch of patches) house.front.shape(patch, brick, 0.012);
  house.left.shape([[-2.9, 4.6], [-1.6, 5.2], [-0.9, 4.4], [-1.9, 3.7], [-2.8, 3.9]], brick, 0.012);
  b.hip(-8, 8, -4, 4, 6.6, 8.9, { roof: 0x8d8e88, over: 0.45 });
  const slope = (8.9 - 6.6) / 4;
  const onRoof = (x: number, z: number): P3 => [x, 8.9 - (Math.abs(z) - 0) * slope + 0.02, z];
  b.poly([onRoof(-3.4, -1.1), onRoof(-1.6, -1.1), onRoof(-1.3, -3.2), onRoof(-3.8, -3.6)], 0x2a2521, [0, 1, -slope]);
  b.poly([onRoof(3.6, 1.6), onRoof(5.2, 1.4), onRoof(5.6, 3.3), onRoof(3.3, 3.6)], 0x2a2521, [0, 1, slope]);
  b.chimney(-4.5, 0.6, 8.0, 9.9, 0.6, 0x9c5a44);
  b.chimney(4.5, 0.6, 8.0, 9.9, 0.6, 0x9c5a44);
  for (const x of [-7.95, 7.95]) b.box(x - 0.06, 0.5, -4.1, x + 0.06, 6.5, -3.98, 0x6f6f6a);
}

/** Ukrainian mazanka: whitewash, a blue skirt, painted flowers and a deep thatch. */
export function mazanka(b: DwellingBuilder): void {
  const white = 0xf5f2ea;
  const blue = 0x3c6fb8;
  const thatch = 0xcaa35c;
  b.trim = blue;
  const house = b.mass(-3.8, 3.8, 0, 2.9, -2.5, 2.5, white);
  for (const face of [house.front, house.back, house.left, house.right]) face.band(0, 0.45, blue, 0.02);
  b.box(-3.6, 0, -2.95, 3.6, 0.42, -2.5, 0xb88d63);
  for (const u of [-2.3, 2.3]) {
    house.front.window(u, 1.05, 0.75, 0.85, { cross: true, surround: 0xf6e7b5, surroundWidth: 0.08 });
    flower(house.front, u - 0.85, 1.5, 0.42, 0xd8453c, 0xf2c14e);
    flower(house.front, u + 0.85, 1.5, 0.42, 0x3a8f58, 0xd8453c);
    flower(house.front, u, 2.35, 0.34, 0xd8453c, 0x3a8f58);
  }
  house.front.door(0, 0.95, 1.95, 0x7a4b2b, { panels: true, surround: 0xf6e7b5 });
  house.left.window(0, 1.0, 0.7, 0.8, { cross: true });
  house.back.window(-1.5, 1.0, 0.7, 0.8, { cross: true });
  b.hip(-3.8, 3.8, -2.5, 2.5, 2.9, 5.6, { roof: thatch, over: 0.6 });
  b.box(-1.3, 5.45, -0.12, 1.3, 5.7, 0.12, shade(thatch, 0.72));
  b.chimney(1.2, 0.8, 4.4, 6.2, 0.5, white, 0xd9d3c3);
}

/** Tudor half-timbered cottage with a jettied upper floor and a brick stack. */
export function tudor(b: DwellingBuilder): void {
  const plaster = 0xf0e8d5;
  const timber = 0x3a281c;
  const roof = 0x6b4a3a;
  b.trim = timber;
  const ground = b.mass(-4.2, 4.2, 0, 2.8, -3, 3, plaster);
  const upper = b.mass(-4.4, 4.4, 2.8, 5.4, -3.4, 3.2, plaster);
  const frameWall = (f: Facade, height: number, posts: readonly number[], braces: readonly [number, number, number, number][]): void => {
    f.box(-f.width / 2, f.width / 2, 0, 0.18, 0, 0.04, timber);
    f.box(-f.width / 2, f.width / 2, height - 0.18, height, 0, 0.04, timber);
    for (const u of posts) f.box(u - 0.09, u + 0.09, 0, height, 0, 0.04, timber);
    for (const [u0, v0, u1, v1] of braces) f.plank([u0, v0], [u1, v1], 0.16, timber, 0.035, 0.005);
  };
  frameWall(ground.front, 2.8, [-4.1, -2.4, -0.7, 0.7, 2.4, 4.1], [[-4.1, 0.2, -2.4, 2.6], [-0.7, 0.2, 0.7, 2.6]]);
  ground.front.window(-1.55, 1.0, 1.2, 1.1, { bars: 2, rails: 2, frame: timber });
  ground.front.window(3.25, 1.0, 1.0, 1.1, { bars: 1, rails: 2, frame: timber });
  ground.front.door(1.55, 0.95, 2.1, 0x5a3a26, { panels: true, frame: timber });
  frameWall(upper.front, 2.6, [-4.3, -2.9, -1.2, 1.2, 2.9, 4.3], [[-2.9, 0.2, -1.2, 2.4], [2.9, 0.2, 1.2, 2.4]]);
  upper.front.window(-3.6, 0.8, 0.9, 1.0, { bars: 1, rails: 2, frame: timber });
  upper.front.window(0, 0.8, 1.6, 1.0, { bars: 3, rails: 2, frame: timber });
  upper.front.window(3.6, 0.8, 0.9, 1.0, { bars: 1, rails: 2, frame: timber });
  for (const f of [ground.left, ground.back]) frameWall(f, 2.8, [-f.width / 2 + 0.1, 0, f.width / 2 - 0.1], [[-f.width / 2 + 0.1, 0.2, -1.2, 2.6]]);
  for (const f of [upper.left, upper.back, upper.right]) frameWall(f, 2.6, [-f.width / 2 + 0.1, -1.5, 1.5, f.width / 2 - 0.1], [[-1.5, 0.2, -0.75, 2.4]]);
  ground.back.window(1.8, 1.0, 1.1, 1.1, { bars: 2, rails: 2, frame: timber });
  upper.left.window(0, 0.8, 1.0, 1.0, { bars: 2, rails: 2, frame: timber });
  // Jetty brackets under the overhang.
  for (const u of [-3.6, -1.2, 1.2, 3.6]) b.beam([u, 2.2, -3.0], [u, 2.8, -3.35], 0.14, timber);
  b.gable(-4.4, 4.4, -3.4, 3.2, 5.4, 9.2, { roof, wall: plaster, over: 0.35, end: 0.3 });
  const gableEnd = new Facade(b, [-4.4, 0, 0], [0, 0, 1], [-1, 0, 0], 6.6, 9.2);
  gableEnd.box(-0.08, 0.08, 5.4, 8.9, 0, 0.04, timber);
  gableEnd.plank([-3.1, 5.5], [0, 8.6], 0.16, timber, 0.035, 0.005);
  gableEnd.plank([3.1, 5.5], [0, 8.6], 0.16, timber, 0.035, 0.005);
  gableEnd.window(0, 6.3, 0.7, 0.9, { bars: 1, rails: 1, frame: timber });
  // External brick stack on the right gable, with two pots.
  const brick = 0x9b4a36;
  b.box(4.4, 0, -0.8, 5.1, 7.8, 0.8, brick);
  b.box(4.5, 7.8, -0.5, 5.0, 9.9, 0.5, brick);
  b.box(4.45, 9.9, -0.55, 5.05, 10.05, 0.55, shade(brick, 0.8));
  for (const z of [-0.22, 0.22]) b.cylinder(4.75, z, 10.05, 10.5, 0.13, 0xb4643f, 10);
}

/** Alpine chalet: stone below, timber above, a flower-boxed balcony under a broad eave. */
export function chalet(b: DwellingBuilder): void {
  const stone = [0xb9b1a4, 0xa69e91, 0xc4bdb1, 0x9b9488];
  const timber = 0xa7693a;
  const dark = 0x6a4026;
  const shutter = 0x2e6d44;
  const trim = 0xf2ede2;
  b.trim = trim;
  const ground = b.mass(-4.5, 4.5, 0, 2.8, -3.5, 3.5, 0xa9a194);
  for (const face of [ground.front, ground.left, ground.right, ground.back]) stonework(face, 0, 2.8, 0.42, stone, 0xc4a1 + face.width * 10);
  ground.front.door(-2.4, 1.1, 2.2, 0x6d3f22, { arch: true, frame: 0xd5cec0, panels: true });
  ground.front.window(0.6, 1.0, 1.0, 1.1, { cross: true, shutters: shutter });
  ground.front.window(3.0, 1.0, 1.0, 1.1, { cross: true, shutters: shutter });
  const upper = b.mass(-4.7, 4.7, 2.8, 5.4, -3.7, 3.7, timber);
  for (const face of [upper.front, upper.left, upper.right, upper.back]) siding(face, 0, 2.6, 0.26, timber);
  for (const u of [-3, 0, 3]) upper.front.window(u, 0.75, 1.0, 1.25, { cross: true, shutters: shutter });
  upper.left.window(0, 0.75, 1.0, 1.25, { cross: true, shutters: shutter });
  upper.right.window(0, 0.75, 1.0, 1.25, { cross: true, shutters: shutter });
  // Balcony: deck on brackets, a cut-board railing, and red geraniums along it.
  b.box(-5.0, 2.72, -5.0, 5.0, 2.9, -3.7, dark);
  for (const x of [-4.2, -1.4, 1.4, 4.2]) b.beam([x, 2.1, -3.5], [x, 2.75, -4.8], 0.16, dark);
  for (let i = 0; i < 34; i++) {
    const x = -4.9 + i * 0.297;
    b.box(x, 2.9, -5.0, x + 0.2, 2.9 + (i % 2 === 0 ? 0.95 : 0.85), -4.94, i % 2 === 0 ? timber : shade(timber, 0.85));
  }
  for (const side of [-1, 1]) b.box(side * 4.95 - 0.03, 2.9, -5.0, side * 4.95 + 0.03, 3.85, -3.7, dark);
  b.box(-5.0, 3.85, -5.05, 5.0, 3.95, -4.9, dark);
  for (let i = 0; i < 6; i++) {
    const x = -4.1 + i * 1.64;
    b.box(x - 0.55, 3.95, -5.12, x + 0.55, 4.18, -4.85, 0x7b4a2a);
    for (let k = 0; k < 5; k++) b.box(x - 0.5 + k * 0.23, 4.18, -5.08, x - 0.34 + k * 0.23, 4.36, -4.9, k % 2 ? 0xd23c3c : 0x3f8a3a);
  }
  b.gable(-4.7, 4.7, -3.7, 3.7, 5.4, 7.0, { axis: 'z', roof: 0x5b4a3c, wall: timber, over: 1.3, end: 1.5, thick: 0.22 });
  const pediment = frontAt(b, -3.7, 9.4, 7.0);
  pediment.door(0, 1.1, 1.1, 0x6d3f22, { v: 5.55, frame: dark });
  for (const u of [-3.2, -1.6, 0, 1.6, 3.2]) b.box(u - 0.1, 5.8 - Math.abs(u) * 0.2, -5.25, u + 0.1, 6.0 - Math.abs(u) * 0.2, -3.7, dark);
}

/** Dutch canal house: brick, a stepped gable, sash windows and a fanlit door. */
export function dutchGable(b: DwellingBuilder): void {
  const brick = 0x9e4a37;
  const stone = 0xf1ece0;
  const green = 0x1f5a45;
  b.trim = stone;
  const house = b.mass(-3.25, 3.25, 0, 6.6, -5, 5, brick);
  house.front.band(0, 0.5, 0x6f6a62, 0.04);
  house.front.band(3.55, 0.14, stone, 0.06);
  for (const u of [-1.6, 1.6]) house.front.window(u, 4.0, 1.1, 1.9, { bars: 1, rails: 2, sill: stone, lintel: stone });
  house.front.window(-1.6, 1.0, 1.1, 1.9, { bars: 1, rails: 2, sill: stone, lintel: stone });
  house.front.door(1.4, 1.1, 2.2, green, { panels: true, v: 0.5 });
  house.front.glass(archOutline(1.4, 2.9, 1.0, 0.5), 0.03);
  house.front.box(0.75, 2.05, 2.78, 2.86, 0, 0.07, stone);
  steps(b, -2.1, -0.7, -5, 0.5, 3, 0x7d786f);
  // The stepped gable stands proud of the roof behind it.
  // The roof starts behind the gable wall, so no slab edge shows across the steps.
  b.gable(-3.25, 3.25, -5, 5, 6.6, 9.4, { axis: 'z', roof: 0x3f3d3c, wall: brick, over: 0.2, end: -0.4 });
  const tiers = [[3.25, 6.6, 7.25], [2.65, 7.25, 7.95], [2.0, 7.95, 8.65], [1.35, 8.65, 9.35], [0.7, 9.35, 10.1]] as const;
  for (const [half, y0, y1] of tiers) {
    b.box(-half, y0, -5.02, half, y1, -4.62, brick);
    b.box(-half - 0.06, y1, -5.08, half + 0.06, y1 + 0.1, -4.56, stone);
  }
  const pediment = frontAt(b, -5.02, 6.5, 10.1);
  porthole(pediment, 0, 8.0, 0.42, stone);
  for (const u of [-1.6, 1.6]) pediment.window(u, 6.95, 0.55, 0.7, { bars: 1 });
  for (const u of [-1.6, 1.6]) house.back.window(u, 3.9, 1.0, 1.7, { bars: 1, rails: 2, sill: stone });
}

/** Swedish falu-red cottage with white corners and a little glass porch. */
export function faluCottage(b: DwellingBuilder): void {
  const red = 0x8e2b22;
  const white = 0xf5f2ea;
  b.trim = white;
  b.box(-4.1, 0, -2.85, 4.1, 0.4, 2.85, 0x8a8479);
  const house = b.mass(-4, 4, 0.4, 3.2, -2.75, 2.75, red);
  for (const face of [house.front, house.back, house.left, house.right]) {
    battens(face, 0, 2.8, 0.36, shade(red, 0.82));
    face.box(-face.width / 2 - 0.02, -face.width / 2 + 0.16, 0, 2.8, 0, 0.05, white);
    face.box(face.width / 2 - 0.16, face.width / 2 + 0.02, 0, 2.8, 0, 0.05, white);
  }
  for (const u of [-2.6, 2.6]) house.front.window(u, 0.75, 1.0, 1.3, { bars: 1, rails: 1, sill: white, surround: white, surroundWidth: 0.06 });
  house.back.window(-1.5, 0.75, 1.0, 1.3, { bars: 1, rails: 1 });
  house.back.window(1.5, 0.75, 1.0, 1.3, { bars: 1, rails: 1 });
  b.gable(-4, 4, -2.75, 2.75, 3.2, 5.6, { roof: 0x2f2d2c, wall: red, over: 0.35, end: 0.35 });
  for (const x of [-4, 4]) {
    const end = new Facade(b, [x, 0, 0], [0, 0, x < 0 ? 1 : -1], [x < 0 ? -1 : 1, 0, 0], 5.5, 5.6);
    end.window(0, 3.55, 0.8, 0.9, { bars: 1, rails: 1 });
    end.plank([-3.15, 2.95], [0, 5.72], 0.2, white, 0.04, 0.3);
    end.plank([3.15, 2.95], [0, 5.72], 0.2, white, 0.04, 0.3);
  }
  // Glass porch, white-framed, with its own gable.
  const porchMass = b.mass(-1.2, 1.2, 0.4, 2.7, -4.3, -2.75, 0x39474d);
  glazedWall(porchMass.front, 0.5, white, 0.55, [-0.5, 0.5]);
  glazedWall(porchMass.left, 0.5, white, 0.55);
  glazedWall(porchMass.right, 0.5, white, 0.55);
  porchMass.front.door(0, 0.85, 2.05, white, { glass: true, frame: white });
  b.gable(-1.2, 1.2, -4.3, -2.75, 2.7, 3.5, { axis: 'z', roof: 0x2f2d2c, wall: white, over: 0.15, end: 0.15, thick: 0.1 });
  steps(b, -0.8, 0.8, -4.3, 0.4, 2, 0x8a8479);
  b.chimney(1.8, 0.6, 4.4, 6.3, 0.5, 0xe8e3d6);
}

/** Icelandic turf farmhouse: three grass-roofed bays behind painted timber gables. */
export function turfHouse(b: DwellingBuilder): void {
  const grass = 0x6f934b;
  const turf = 0x6b5d3f;
  b.trim = 0xf1ede3;
  const bays = [
    { x: -4.6, w: 4.0, h: 3.3, front: 0x2b2b2d, feature: 'window' },
    { x: 0, w: 5.0, h: 4.1, front: 0xf1ede3, feature: 'door' },
    { x: 4.8, w: 4.2, h: 3.1, front: 0x8c2e26, feature: 'window' },
  ] as const;
  const z0 = -3.4;
  const z1 = 3.6;
  b.hexa(
    [[-7.4, 0, z0 + 0.2], [7.6, 0, z0 + 0.2], [7.6, 0, z1 + 0.6], [-7.4, 0, z1 + 0.6], [-6.8, 1.3, z0 + 0.4], [7.0, 1.3, z0 + 0.4], [7.0, 1.3, z1], [-6.8, 1.3, z1]],
    turf,
    grass,
  );
  for (const bay of bays) {
    const half = bay.w / 2;
    b.gable(bay.x - half, bay.x + half, z0, z1, 1.25, bay.h, { axis: 'z', roof: grass, wall: turf, over: 0.3, end: 0.12, thick: 0.4, cap: shade(grass, 0.85) });
    const outline: P2[] = [[-half + 0.35, 0], [half - 0.35, 0], [half - 0.35, 1.25], [0, bay.h - 0.15], [-half + 0.35, 1.25]];
    const plate = new Facade(b, [bay.x, 0, z0], LEFT_U, FRONT, bay.w, bay.h);
    plate.shape(outline, bay.front, 0.08);
    const face = new Facade(b, [bay.x, 0, z0 - 0.08], LEFT_U, FRONT, bay.w, bay.h);
    const trim = bay.front === 0xf1ede3 ? 0x2b2b2d : 0xf1ede3;
    battens(face, 0, 1.2, 0.3, shade(bay.front, bay.front === 0x2b2b2d ? 1.25 : 0.86), -half + 0.4, half - 0.4);
    if (bay.feature === 'door') {
      face.door(0, 0.95, 1.95, 0xa3312b, { frame: trim });
      face.window(0, 2.5, 0.6, 0.7, { frame: trim, bars: 1 });
    } else {
      face.window(0, 0.8, 0.9, 0.9, { frame: trim, bars: 1, rails: 1 });
      face.window(0, 2.15, 0.5, 0.5, { frame: trim });
    }
    face.plank([-half + 0.3, 1.2], [0, bay.h - 0.05], 0.14, trim, 0.03, 0.02);
    face.plank([half - 0.3, 1.2], [0, bay.h - 0.05], 0.14, trim, 0.03, 0.02);
  }
}

/** Second Empire villa: rusticated ground floor, slate mansard with dormers. */
export function mansard(b: DwellingBuilder): void {
  const stone = 0xe8d9bb;
  const slate = 0x566273;
  const trim = 0xf6f0e2;
  const iron = 0x25282b;
  b.trim = trim;
  const house = b.mass(-6, 6, 0, 3.7, -4, 4, stone);
  for (const face of [house.front, house.back, house.left, house.right]) {
    for (let v = 0.45; v < 3.4; v += 0.45) face.box(-face.width / 2, face.width / 2, v, v + 0.035, 0, 0.012, shade(stone, 0.82));
    face.band(3.5, 0.22, trim, 0.2, 0.1);
    face.band(0, 0.4, shade(stone, 0.85), 0.05);
  }
  for (const u of [-4.3, -2.2, 2.2, 4.3]) {
    house.front.window(u, 0.8, 1.05, 2.1, { arch: true, cross: true, frame: trim, surround: shade(stone, 1.08), surroundWidth: 0.12 });
    house.front.box(u - 0.62, u + 0.62, 0.75, 0.8, 0, 0.35, iron);
    for (let k = 0; k < 7; k++) house.front.box(u - 0.6 + k * 0.2, u - 0.57 + k * 0.2, 0.8, 1.45, 0.3, 0.33, iron);
    house.front.box(u - 0.62, u + 0.62, 1.42, 1.47, 0, 0.35, iron);
  }
  house.front.door(0, 1.5, 2.9, 0x2d4a5a, { arch: true, double: true, panels: true, surround: shade(stone, 1.08) });
  house.front.box(-1.3, 1.3, 3.1, 3.2, 0, 0.9, trim);
  steps(b, -1.2, 1.2, -4, 0.3, 2, 0xcfc5b3);
  for (const u of [-3.5, 0, 3.5]) house.left.window(u * 0.8, 0.8, 1.0, 2.0, { arch: true, cross: true });
  // Mansard: a steep lower slope, then a low hip over it.
  b.hexa(
    [[-6.15, 3.72, -4.15], [6.15, 3.72, -4.15], [6.15, 3.72, 4.15], [-6.15, 3.72, 4.15], [-5.3, 6.5, -3.3], [5.3, 6.5, -3.3], [5.3, 6.5, 3.3], [-5.3, 6.5, 3.3]],
    slate,
  );
  b.hip(-5.3, 5.3, -3.3, 3.3, 6.5, 7.3, { roof: shade(slate, 0.85), over: 0.08 });
  b.box(-5.4, 6.45, -3.4, 5.4, 6.6, 3.4, trim);
  for (const x of [-4.2, -1.4, 1.4, 4.2]) {
    const dormer = b.mass(x - 0.65, x + 0.65, 4.0, 5.9, -4.0, -2.8, stone);
    dormer.front.window(0, 0.2, 0.8, 1.4, { arch: true, cross: true });
    b.gable(x - 0.65, x + 0.65, -4.0, -2.8, 5.9, 6.55, { axis: 'z', roof: slate, wall: trim, over: 0.12, end: 0.12, thick: 0.08 });
  }
  for (let x = -4.8; x <= 4.8; x += 0.4) b.box(x - 0.02, 7.3, -0.02, x + 0.02, 7.65, 0.02, iron);
  b.box(-4.8, 7.62, -0.03, 4.8, 7.67, 0.03, iron);
  for (const x of [-5.4, 5.4]) b.chimney(x, 0, 5.8, 8.2, 0.7, 0xb8674a, trim);
}

/** Cycladic house: whitewashed cubes, an outside stair, blue doors and a blue dome. */
export function cycladic(b: DwellingBuilder): void {
  const white = 0xf7f6f1;
  const blue = 0x2159c4;
  b.trim = blue;
  const low = b.mass(-3.2, 3.2, 0, 3.0, -2.6, 2.6, white);
  const high = b.mass(-3.2, 0.2, 3.0, 5.7, -0.6, 2.6, white);
  b.box(-3.3, 3.0, -2.7, 3.3, 3.15, 2.7, white);
  b.box(-3.3, 5.7, -0.7, 0.3, 5.85, 2.7, white);
  b.parapet(0.2, 3.3, -2.7, 2.7, 3.15, 0.45, 0.14, white);
  low.front.door(-1.6, 1.0, 2.2, blue, { arch: true, panels: true, frame: white });
  low.front.window(1.4, 1.1, 0.8, 1.0, { shutters: blue, frame: white, cross: true });
  high.front.window(-0.6, 0.8, 0.8, 1.0, { shutters: 0x1f8f8a, frame: white, cross: true });
  high.front.door(0.9, 0.8, 2.0, 0x1f8f8a, { frame: white, arch: true });
  low.left.window(0, 1.1, 0.7, 0.9, { shutters: blue, frame: white });
  // Outside stair up the right-hand wall to the terrace, whitewashed solid.
  for (let i = 0; i < 10; i++) {
    b.box(3.2, 0, -2.2 + i * 0.44, 4.3, 0.3 * (i + 1), 2.6, white);
  }
  b.hexa(
    [[4.3, 0, -2.3], [4.42, 0, -2.3], [4.42, 0, 2.6], [4.3, 0, 2.6], [4.3, 0.5, -2.3], [4.42, 0.5, -2.3], [4.42, 3.45, 2.6], [4.3, 3.45, 2.6]],
    white,
  );
  // Chapel dome on a drum, with a little cross.
  b.cylinder(-1.5, 1.0, 5.85, 6.55, 0.95, white, 16);
  b.dome(-1.5, 1.0, 6.55, 0.95, blue, 1, 18, 6);
  b.box(-1.53, 7.5, 0.97, -1.47, 8.0, 1.03, white);
  b.box(-1.7, 7.75, 0.97, -1.3, 7.81, 1.03, white);
  // Pergola on the terrace with bougainvillea over it.
  for (const [x, z] of [[0.6, -2.3], [2.8, -2.3]] as const) b.box(x - 0.1, 3.15, z - 0.1, x + 0.1, 5.3, z + 0.1, white);
  for (let i = 0; i < 6; i++) b.box(0.3 + i * 0.5, 5.3, -2.5, 0.4 + i * 0.5, 5.42, -0.5, 0x9a7a55);
  const bloom = [[0.7, -2.25, 0.34], [1.15, -2.45, 0.28], [1.6, -2.3, 0.36], [2.1, -2.5, 0.3], [2.55, -2.2, 0.38], [2.95, -1.7, 0.3], [3.0, -1.2, 0.34], [1.9, -1.9, 0.26]] as const;
  bloom.forEach(([x, z, r], i) => b.ball(x, 5.35 - (i % 3) * 0.12, z, r, i % 2 ? 0xd23a8c : 0xe0559e, 0.85, 10));
  for (const [x, z] of [[0.6, -2.3], [2.8, -2.3]] as const) b.ball(x, 4.2, z - 0.12, 0.28, 0x3f7f3a, 1.4, 8);
  b.chimney(-2.6, 2.0, 5.85, 6.7, 0.45, white, white);
}

/** Apulian trulli: whitewashed drums under corbelled stone cones and white pinnacles. */
export function trullo(b: DwellingBuilder): void {
  const white = 0xf4f1ea;
  const stone = [0x8f8b80, 0x857f74, 0x98948a];
  const green = 0x3d7a4f;
  b.trim = 0xe6dfcf;
  const units = [
    { x: -2.8, z: 0, r: 2.0, h: 2.1, s: 1.0 },
    { x: 1.4, z: -0.4, r: 2.4, h: 2.3, s: 1.2 },
    { x: 4.3, z: 2.4, r: 1.6, h: 1.9, s: 0.85 },
  ];
  for (const unit of units) {
    b.lathe(unit.x, unit.z, [[unit.r + 0.08, 0], [unit.r + 0.08, 0.35], [unit.r, 0.4], [unit.r, unit.h]], 18, (i) => (i < 1 ? 0xb9b2a4 : white), { capTop: false });
    const top = unit.h + 3.1 * unit.s;
    b.lathe(
      unit.x,
      unit.z,
      [[unit.r + 0.12, unit.h], [unit.r * 0.95, unit.h + 0.25 * unit.s], [unit.r * 0.72, unit.h + 1.3 * unit.s], [unit.r * 0.42, unit.h + 2.35 * unit.s], [0.24, top]],
      18,
      (i) => (i === 0 ? white : stone[i % stone.length]!),
    );
    b.lathe(unit.x, unit.z, [[0.24, top], [0.24, top + 0.22], [0.36, top + 0.3], [0.2, top + 0.52], [0, top + 0.72]], 12, white);
    const face = b.radial(unit.x, unit.z, unit.r, unit.r, -Math.PI / 2, 0, 2, unit.h);
    if (unit.r > 2.2) face.door(0, 1.0, 1.9, green, { arch: true, frame: white, panels: true });
    else face.window(0, 0.9, 0.55, 0.7, { frame: white, arch: true });
    // A painted white sign on the cone, as each trullo carries one.
    const sign = b.radial(unit.x, unit.z, unit.r * 0.8, unit.r * 0.8, -Math.PI / 2 - 0.1, unit.h + 1.0 * unit.s, 1, 1);
    sign.shape([[-0.18, 0], [0.18, 0], [0, 0.34]], white, 0.2, 0.1);
  }
  b.box(-1.1, 0, -2.0, -0.2, 1.6, 1.4, white);
  b.box(-1.4, 1.6, -2.1, 0.1, 1.72, 1.5, 0xb9b2a4);
  steps(b, 0.9, 1.9, -2.85, 0.3, 2, 0xb9b2a4, 0.25);
}

/** Hebridean blackhouse: drystone oval walls under a roped thatch. */
export function blackhouse(b: DwellingBuilder): void {
  const thatch = 0xb39458;
  const rope = 0x4a3a28;
  b.trim = 0x5a4a38;
  const sx = 1.85;
  b.lathe(0, 0, [[3.0, 0], [2.95, 0.55], [2.9, 1.1], [2.83, 1.7]], 22, (i) => [0x8e8a82, 0x7f7b73, 0x9a968d][i]!, { sx, capTop: true });
  b.lathe(0, 0, [[2.95, 1.6], [2.7, 2.35], [2.1, 3.05], [1.15, 3.6], [0, 3.85]], 22, thatch, { sx });
  // Rope netting over the thatch, weighted with stones along the eave.
  const heights = [1.62, 2.35, 3.05, 3.6, 3.85];
  const radii = [2.97, 2.72, 2.12, 1.17, 0.02];
  for (let i = -4; i <= 4; i++) {
    const x = i * 1.1;
    let previous: P3 | null = null;
    for (const side of [-1, 1]) {
      previous = null;
      for (let k = 0; k < heights.length; k++) {
        const r = radii[k]!;
        const along = x / sx;
        const z = side * Math.sqrt(Math.max(0, r * r - along * along)) + side * 0.04;
        if (r * r < along * along) continue;
        const point: P3 = [x, heights[k]! + 0.05, z];
        if (previous) b.beam(previous, point, 0.05, rope);
        previous = point;
      }
      if (Math.abs(x) < 4.6) b.box(x - 0.15, 1.1, side * 3.0 - 0.15, x + 0.15, 1.4, side * 3.0 + 0.15, 0x6f6b64);
    }
  }
  const front = b.radial(0, 0, 3.0 * sx, 3.0, -Math.PI / 2, 0, 2, 1.8);
  front.door(0, 0.85, 1.55, 0xa8382c, { frame: 0x5a4a38 });
  for (const angle of [-Math.PI / 2 - 0.42, -Math.PI / 2 + 0.42]) {
    b.radial(0, 0, 3.0 * sx, 3.0, angle, 0, 1, 1.8).window(0, 0.8, 0.45, 0.5, { frame: 0x5a4a38 });
  }
  // A stack of peat beside the door.
  for (let i = 0; i < 3; i++) b.box(6.2 + i * 0.1, i * 0.4, -1.6 + i * 0.1, 7.6 - i * 0.1, (i + 1) * 0.4, -0.2 - i * 0.1, i % 2 ? 0x4b3526 : 0x57402d);
}

/** Bauhaus house: white cubes, ribbon windows, a cantilever and three primary accents. */
export function bauhaus(b: DwellingBuilder): void {
  const white = 0xf4f4f0;
  const black = 0x1d1f21;
  b.trim = black;
  const low = b.mass(-5, 3, 0, 3.1, -3, 3, white);
  const high = b.mass(-2, 5, 3.1, 6.2, -2, 3.5, white);
  b.box(-5.05, 3.1, -3.05, 3.05, 3.22, 3.05, white);
  b.box(-2.05, 6.2, -2.05, 5.05, 6.32, 3.55, white);
  const ribbon = (f: Facade, u0: number, u1: number, v0: number, v1: number): void => {
    f.glass([[u0, v0], [u1, v0], [u1, v1], [u0, v1]], 0.02);
    f.box(u0 - 0.04, u1 + 0.04, v0 - 0.05, v0, 0, 0.05, black);
    f.box(u0 - 0.04, u1 + 0.04, v1, v1 + 0.05, 0, 0.05, black);
    for (let u = u0; u <= u1 + 1e-6; u += (u1 - u0) / Math.max(1, Math.round((u1 - u0) / 1.2))) f.box(u - 0.025, u + 0.025, v0, v1, 0, 0.05, black);
  };
  ribbon(low.front, -3.6, 2.5, 1.0, 2.2);
  ribbon(high.front, -3.2, 1.2, 0.9, 2.1);
  ribbon(high.left, -2.2, 2.2, 0.9, 2.1);
  ribbon(low.left, -2.2, 1.2, 1.0, 2.2);
  low.front.door(3.4, 1.0, 2.2, 0xe8b624, { frame: black, glass: true });
  // One wall red, one block blue.
  high.right.shape([[-2.75, 0], [2.75, 0], [2.75, 3.1], [-2.75, 3.1]], 0xc8322d, 0.01);
  b.box(3.2, 0, -1.4, 4.4, 3.1, 1.2, 0x2356a8);
  b.box(4.85, 0, -1.95, 5.0, 3.1, -1.8, black);
  // The low roof is the upper floor's terrace, railed along its edge.
  b.railing([-5, -2.95], [3, -2.95], 3.22, 1.0, black, 12, 0.04);
}

/** Tbilisi house: brick below, a turquoise glazed wooden gallery above. */
export function tbilisi(b: DwellingBuilder): void {
  const brick = 0xc58f63;
  const plaster = 0xe8d3b3;
  const wood = 0x3a9e98;
  const trim = 0xf6f1e6;
  b.trim = trim;
  const ground = b.mass(-4.5, 4.5, 0, 3.0, -3.5, 3.5, brick);
  ground.front.door(-2.4, 1.3, 2.4, 0x6a3e26, { arch: true, double: true, panels: true, surround: shade(brick, 0.85) });
  for (const u of [0.4, 2.8]) ground.front.window(u, 0.9, 1.0, 1.6, { arch: true, cross: true, surround: shade(brick, 0.85), surroundWidth: 0.14 });
  ground.left.window(0, 0.9, 1.0, 1.6, { arch: true, cross: true });
  const upper = b.mass(-4.5, 4.5, 3.0, 6.0, -3.5, 3.5, plaster);
  upper.back.window(-1.5, 0.8, 1.0, 1.5, { cross: true, shutters: wood });
  upper.back.window(1.5, 0.8, 1.0, 1.5, { cross: true, shutters: wood });
  // The gallery: carved panels below, a band of small panes above.
  const gallery = b.mass(-4.7, 4.7, 3.1, 4.2, -4.7, -3.5, wood);
  for (let i = 0; i < 12; i++) {
    const u = -4.3 + i * 0.78;
    gallery.front.shape([[u - 0.25, 0.25], [u, 0.12], [u + 0.25, 0.25], [u + 0.25, 0.85], [u, 0.98], [u - 0.25, 0.85]], trim, 0.02);
    gallery.front.shape([[u - 0.12, 0.55], [u, 0.35], [u + 0.12, 0.55], [u, 0.75]], 0xd46a4a, 0.03);
  }
  const panes = b.mass(-4.7, 4.7, 4.2, 5.8, -4.7, -3.5, 0x2f3b40);
  glazedWall(panes.front, 0.42, wood, 0.7, null, 0.07);
  glazedWall(panes.left, 0.4, wood, 0.7, null, 0.07);
  glazedWall(panes.right, 0.4, wood, 0.7, null, 0.07);
  b.box(-4.8, 5.8, -4.8, 4.8, 5.95, -3.5, wood);
  for (const x of [-4.2, -1.4, 1.4, 4.2]) b.beam([x, 2.3, -3.5], [x, 3.1, -4.6], 0.14, shade(wood, 0.75));
  b.hip(-4.5, 4.5, -4.7, 3.5, 6.0, 7.6, { roof: 0xa3a6a4, over: 0.4 });
  b.chimney(2.4, 1.6, 6.6, 8.4, 0.55, brick);
}
