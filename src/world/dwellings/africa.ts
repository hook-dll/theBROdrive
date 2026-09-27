import { DwellingBuilder, Facade, archOutline, rectOutline, shade, type P2, type P3 } from './builder';
import { flower, steps, stonework } from './parts';

const FRONT: P3 = [0, 0, -1];
const LEFT_U: P3 = [-1, 0, 0];

function frontAt(b: DwellingBuilder, z: number, width: number, height: number, x = 0): Facade {
  return new Facade(b, [x, 0, z], LEFT_U, FRONT, width, height);
}

/** Sahelian mud house from Djenné: buttresses crowned with cones, toron stakes bristling. */
export function djenne(b: DwellingBuilder): void {
  const mud = 0xb9774a;
  const light = 0xc98a5a;
  const wood = 0x5a3a22;
  b.trim = wood;
  b.hexa(
    [[-5, 0, -3.5], [5, 0, -3.5], [5, 0, 3.5], [-5, 0, 3.5], [-4.8, 6.2, -3.3], [4.8, 6.2, -3.3], [4.8, 6.2, 3.3], [-4.8, 6.2, 3.3]],
    mud,
  );
  b.parapet(-4.8, 4.8, -3.3, 3.3, 6.2, 0.55, 0.3, light);
  // Buttresses up the front, each ending in a rounded pinnacle above the parapet.
  for (const x of [-4.6, -2.3, -0.95, 0.95, 2.3, 4.6]) {
    const wide = Math.abs(x) < 1 ? 0.7 : 0.6;
    b.hexa(
      [[x - wide / 2, 0, -3.95], [x + wide / 2, 0, -3.95], [x + wide / 2, 0, -3.3], [x - wide / 2, 0, -3.3], [x - wide / 2 + 0.08, 7.0, -3.6], [x + wide / 2 - 0.08, 7.0, -3.6], [x + wide / 2 - 0.08, 7.0, -3.2], [x - wide / 2 + 0.08, 7.0, -3.2]],
      light,
    );
    b.lathe(x, -3.4, [[wide / 2 - 0.05, 7.0], [wide / 2 - 0.12, 7.5], [0.12, 8.0], [0, 8.15]], 10, light);
  }
  for (const x of [-3.45, -1.62, 0, 1.62, 3.45]) b.lathe(x, -3.2, [[0.22, 6.7], [0.12, 7.1], [0, 7.25]], 8, light);
  // Toron: palm-wood stakes left in the wall as permanent scaffolding.
  for (const y of [2.1, 3.9, 5.5]) {
    for (let x = -4.2; x <= 4.2; x += 0.84) {
      if (Math.abs(x) < 0.5) continue;
      b.box(x - 0.05, y - 0.05, -4.05, x + 0.05, y + 0.05, -3.25, wood);
    }
  }
  const face = frontAt(b, -3.48, 10, 6.2);
  face.shape(archOutline(0, 0, 1.25, 3.0), shade(mud, 0.72), 0.015);
  face.door(0, 1.1, 2.4, wood, { frame: shade(mud, 0.6), panels: true });
  for (let k = 0; k < 12; k++) face.box(-0.4 + (k % 4) * 0.27, -0.34 + (k % 4) * 0.27, 0.5 + Math.floor(k / 4) * 0.6, 0.56 + Math.floor(k / 4) * 0.6, 0.035, 0.06, 0xc9a24a);
  for (const u of [-3.45, -1.62, 1.62, 3.45]) {
    face.window(u, 3.2, 0.55, 0.7, { frame: wood, bars: 2 });
    face.window(u, 1.0, 0.45, 0.55, { frame: wood, bars: 1 });
  }
  for (const x of [-3.0, 3.0]) b.box(x - 0.1, 5.95, -3.9, x + 0.1, 6.1, -3.2, 0x8a5a3c);
  const side = new Facade(b, [5, 0, 0], [0, 0, -1], [1, 0, 0], 7, 6.2);
  side.window(0, 3.3, 0.55, 0.7, { frame: wood, bars: 2 });
}

/** Nubian house: a painted courtyard front with plates in the wall, vaults and a dome behind. */
export function nubian(b: DwellingBuilder): void {
  const ochre = 0xe8b75a;
  const white = 0xf4f1e8;
  const blue = 0x2f8fc2;
  const red = 0xc2452f;
  const green = 0x3a9a6a;
  b.trim = white;
  b.box(-6, 0, -3.2, 6, 3.0, 3.2, white);
  const vault = (cx: number, r: number): void => {
    const arc: P2[] = [];
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * Math.PI;
      arc.push([cx + Math.cos(a) * r, 3.0 + Math.sin(a) * r]);
    }
    b.extrude(arc, 'z', -3.0, 3.0, white, { smooth: true, cap: shade(white, 0.95) });
  };
  vault(-4.1, 1.8);
  vault(-0.6, 1.6);
  b.cylinder(3.6, 0.4, 3.0, 3.5, 2.1, white, 20);
  b.dome(3.6, 0.4, 3.5, 2.1, white, 1, 20, 6);
  b.cylinder(3.6, 0.4, 5.55, 5.95, 0.35, white, 10);
  b.dome(3.6, 0.4, 5.95, 0.35, blue, 1, 10, 3);
  // The painted front wall of the courtyard, taller than the rooms behind it.
  const wall = b.mass(-6.2, 6.2, 0, 3.8, -3.8, -3.2, ochre);
  for (let u = -6.1; u < 6.1; u += 0.55) wall.front.shape([[u, 3.8], [u + 0.5, 3.8], [u + 0.25, 4.25]], white, 0.3, -0.3);
  wall.front.band(0, 0.35, blue, 0.02);
  wall.front.band(3.35, 0.12, white, 0.03);
  const face = wall.front;
  // Proud of the blue base band (0.02) it crosses, or the two fight at the arch's feet.
  face.shape(archOutline(0, 0, 3.0, 3.35, 12), white, 0.026);
  face.door(0, 1.7, 2.7, blue, { arch: true, double: true, panels: true, frame: red });
  for (let k = 0; k < 9; k++) {
    const u = -2.3 + k * 0.575;
    const colour = [red, blue, green][k % 3]!;
    face.shape([[u - 0.26, 3.05], [u + 0.26, 3.05], [u, 3.3]], colour, 0.035);
  }
  for (const side of [-1, 1]) {
    for (let k = 0; k < 5; k++) face.shape([[side * 1.75 - 0.18, 0.4 + k * 0.5], [side * 1.75 + 0.18, 0.4 + k * 0.5], [side * 1.75, 0.65 + k * 0.5]], [red, green][k % 2]!, 0.035);
  }
  // Plates set into the wall, as the Nubians do: a white disc with a blue rim.
  const plate = (u: number, v: number): void => {
    const rim: P2[] = [];
    const dish: P2[] = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      rim.push([u + Math.cos(a) * 0.24, v + Math.sin(a) * 0.24]);
      dish.push([u + Math.cos(a) * 0.17, v + Math.sin(a) * 0.17]);
    }
    face.shape(rim, blue, 0.04);
    face.shape(dish, white, 0.05);
  };
  for (const [u, v] of [[-3.2, 2.6], [-4.4, 2.6], [3.2, 2.6], [4.4, 2.6], [-2.6, 3.3], [2.6, 3.3]] as const) plate(u, v);
  for (const u of [-4.0, 4.0]) {
    face.window(u, 1.2, 0.6, 0.8, { frame: blue, bars: 2, surround: white, surroundWidth: 0.1 });
    flower(face, u, 0.7, 0.35, red, white);
  }
}

/** Sana'a tower house, two storeys of it: stone below, brick above, gypsum lace round every window. */
export function yemen(b: DwellingBuilder): void {
  const stone = [0x7b5236, 0x6f4a31, 0x87603f];
  const brick = 0x9a6a47;
  const gypsum = 0xf5f1e6;
  b.trim = gypsum;
  const house = b.mass(-4, 4, 0, 7.4, -3.5, 3.5, brick);
  for (const face of [house.front, house.left, house.right, house.back]) {
    stonework(face, 0, 3.2, 0.45, stone, 0x7e30 + Math.round(face.width * 7));
    face.band(3.2, 0.2, gypsum, 0.05);
    face.band(6.4, 0.16, gypsum, 0.05);
    for (let u = -face.width / 2 + 0.2; u < face.width / 2 - 0.2; u += 0.4) {
      face.shape([[u, 3.4], [u + 0.2, 3.62], [u + 0.4, 3.4]], gypsum, 0.03);
      face.shape([[u, 6.2], [u + 0.2, 6.4], [u + 0.4, 6.2]], gypsum, 0.03);
    }
  }
  // Crenellated white parapet.
  for (const [x0, z0, x1, z1] of [[-4, -3.5, 4, -3.3], [-4, 3.3, 4, 3.5], [-4, -3.3, -3.8, 3.3], [3.8, -3.3, 4, 3.3]] as const) {
    b.box(x0, 7.4, z0, x1, 7.7, z1, gypsum);
  }
  for (let x = -3.8; x <= 3.8; x += 0.5) b.box(x - 0.12, 7.7, -3.52, x + 0.12, 8.05, -3.28, gypsum);
  // Qamariya: a tall window with a half-moon fanlight, both edged in gypsum.
  const qamariya = (f: Facade, u: number, v: number): void => {
    f.window(u, v, 0.8, 1.1, { frame: gypsum, surround: gypsum, surroundWidth: 0.16, bars: 1 });
    const top = v + 1.1 + 0.2;
    f.shape(archOutline(u, top - 0.06, 1.2, 0.66, 10), gypsum, 0.02);
    f.glass(archOutline(u, top, 0.9, 0.45, 10), 0.035);
    for (let k = 1; k < 4; k++) {
      const a = (k / 4) * Math.PI;
      f.plank([u, top], [u + Math.cos(a) * 0.44, top + Math.sin(a) * 0.44], 0.04, gypsum, 0.02, 0.035);
    }
    for (const side of [-1, 1]) f.shape(archOutline(u + side * 0.55, top + 0.62, 0.12, 0.12, 6), gypsum, 0.03);
  };
  for (const u of [-2.2, 0, 2.2]) qamariya(house.front, u, 4.1);
  for (const u of [-2.2, 2.2]) qamariya(house.front, u, 1.2);
  qamariya(house.left, 0, 4.1);
  qamariya(house.right, 0, 4.1);
  house.front.door(0, 1.2, 2.4, 0x5a3a22, { arch: true, frame: gypsum, surround: gypsum, panels: true });
}

/** Yazd house: adobe cube, a dome, and a tall badgir catching the wind. */
export function windcatcher(b: DwellingBuilder): void {
  const adobe = 0xcda577;
  const dome = 0xc49a6a;
  const slot = 0x3a2a20;
  const tile = 0x2f9aa8;
  const wood = 0x5f3d25;
  b.trim = wood;
  const house = b.mass(-5, 3, 0, 4.2, -3, 3, adobe);
  b.parapet(-5, 3, -3, 3, 4.2, 0.45, 0.25, shade(adobe, 1.05));
  const room = b.mass(3, 7, 0, 3.2, -2.5, 2.5, adobe);
  b.cylinder(5, 0, 3.2, 3.7, 1.7, adobe, 18);
  b.dome(5, 0, 3.7, 1.7, dome, 0.95, 18, 6);
  // The windcatcher: a tall shaft with slotted vents under a flat cap.
  const bx0 = -3.8;
  const bx1 = -1.6;
  const bz0 = -1.0;
  const bz1 = 0.9;
  const tower = b.mass(bx0, bx1, 4.2, 9.4, bz0, bz1, adobe);
  b.box(bx0 - 0.15, 9.4, bz0 - 0.15, bx1 + 0.15, 9.65, bz1 + 0.15, shade(adobe, 0.9));
  for (let x = bx0 + 0.15; x < bx1; x += 0.55) b.box(x, 9.65, bz0 - 0.1, x + 0.28, 9.95, bz1 + 0.1, shade(adobe, 0.9));
  for (const face of [tower.front, tower.back, tower.left, tower.right]) {
    const n = Math.max(2, Math.round(face.width / 0.45));
    for (let k = 0; k < n; k++) {
      const u = -face.width / 2 + (face.width * (k + 0.5)) / n;
      face.box(u - 0.11, u + 0.11, 2.6, 4.9, 0, 0.015, slot);
    }
    face.band(2.35, 0.14, shade(adobe, 0.85), 0.05);
  }
  // Entrance: a shallow recess, a tiled band, a studded door.
  house.front.shape(archOutline(0.6, 0, 2.0, 3.2, 10), shade(adobe, 0.86), 0.015);
  house.front.box(-0.5, 1.7, 3.35, 3.55, 0, 0.03, tile);
  house.front.door(0.6, 1.1, 2.3, wood, { arch: true, double: true, frame: shade(adobe, 0.7) });
  for (let k = 0; k < 16; k++) house.front.box(0.2 + (k % 4) * 0.27, 0.26 + (k % 4) * 0.27, 0.45 + Math.floor(k / 4) * 0.45, 0.51 + Math.floor(k / 4) * 0.45, 0.035, 0.07, 0x2a2622);
  for (const u of [-2.4, 2.6]) house.front.window(u, 2.6, 0.55, 0.7, { frame: wood, bars: 2, arch: true });
  room.front.window(0, 1.4, 0.6, 0.8, { frame: wood, bars: 2, arch: true });
}

/** Two rondavels: painted round walls under cone thatch. */
export function rondavel(b: DwellingBuilder): void {
  const ochre = 0xc47a45;
  const white = 0xf2ede2;
  const dark = 0x3a2a22;
  const thatch = 0xb89a5e;
  b.trim = dark;
  const hut = (cx: number, cz: number, r: number, h: number, wall: number, band: number): void => {
    b.lathe(cx, cz, [[r, 0], [r, 0.4], [r, h * 0.78], [r, h * 0.86], [r, h]], 18, (i) => [dark, wall, band, wall][i]!, { capTop: false });
    b.lathe(cx, cz, [[r + 0.75, h - 0.3], [r + 0.1, h + 0.15], [r * 0.45, h + (r * 1.1)], [0.15, h + r * 1.5], [0, h + r * 1.56]], 18, thatch);
    b.lathe(cx, cz, [[0.3, h + r * 1.4], [0.08, h + r * 1.75], [0.02, h + r * 1.95]], 8, shade(thatch, 0.7));
    // Painted triangles round the wall, alternating black and white.
    for (let k = 0; k < 14; k++) {
      const angle = (k / 14) * Math.PI * 2;
      if (Math.abs(Math.sin(angle) + 1) < 0.08) continue;
      const face = b.radial(cx, cz, r, r, angle, 0, 1, h);
      face.shape([[-0.22, 0.45], [0.22, 0.45], [0, 0.95]], k % 2 ? white : dark, 0.02);
    }
    const door = b.radial(cx, cz, r, r, -Math.PI / 2, 0, 1.2, h);
    door.door(0, 0.85, 1.8, 0x7a4a2a, { frame: white, step: 0x9a8a78 });
  };
  hut(0, 0, 2.8, 2.5, ochre, white);
  hut(-4.9, 3.1, 1.8, 2.2, white, ochre);
  b.box(-3.2, 0, 0.9, -2.2, 1.1, 2.4, ochre);
}

/** Ndebele homestead: a painted front wall and gateway in bold outlined colour fields. */
export function ndebele(b: DwellingBuilder): void {
  const white = 0xf6f3ea;
  const black = 0x151515;
  const colours = [0xe63946, 0xf4c430, 0x2a6fdb, 0x2fa84f, 0x7b3fa0];
  const thatch = 0xb89a5e;
  b.trim = black;
  const house = b.mass(-4.5, 4.5, 0, 3.0, -3.0, 2.5, white);
  b.hip(-4.5, 4.5, -3.0, 2.5, 3.0, 5.2, { roof: thatch, over: 0.5 });
  /**
   * One painted panel: black outlines first, colour fields inset on top of them, a
   * motif per cell — stepped gables, diamonds and razor blades, as the women paint.
   */
  const panel = (f: Facade, u0: number, u1: number, v0: number, v1: number, seed: number): void => {
    f.shape(rectOutline(u0, v0, u1, v1), white, 0.015);
    f.box(u0, u1, v0, v0 + 0.1, 0.015, 0.025, black);
    f.box(u0, u1, v1 - 0.1, v1, 0.015, 0.025, black);
    const cells = Math.max(1, Math.round((u1 - u0) / 1.1));
    const w = (u1 - u0) / cells;
    for (let c = 0; c < cells; c++) {
      const a = u0 + c * w;
      const mid = a + w / 2;
      const h = v1 - v0 - 0.2;
      const base = v0 + 0.1;
      const colour = colours[(c + seed) % colours.length]!;
      const second = colours[(c + seed + 2) % colours.length]!;
      f.box(a - 0.04, a + 0.04, v0, v1, 0.015, 0.03, black);
      switch ((c + seed) % 3) {
        case 0: {
          const step = (s: number): P2[] => [
            [a + 0.12 + s, base + s], [a + w - 0.12 - s, base + s], [a + w - 0.12 - s, base + h * 0.45],
            [mid + w * 0.18 - s, base + h * 0.45], [mid + w * 0.18 - s, base + h * 0.8 - s], [mid - w * 0.18 + s, base + h * 0.8 - s],
            [mid - w * 0.18 + s, base + h * 0.45], [a + 0.12 + s, base + h * 0.45],
          ];
          f.shape(step(0), black, 0.03);
          f.shape(step(0.08), colour, 0.04);
          break;
        }
        case 1: {
          const diamond = (s: number): P2[] => [[mid, base + 0.1 + s], [a + w - 0.15 - s, base + h / 2], [mid, base + h - 0.1 - s], [a + 0.15 + s, base + h / 2]];
          f.shape(diamond(0), black, 0.03);
          f.shape(diamond(0.08), colour, 0.04);
          f.shape(diamond(0.28), second, 0.05);
          break;
        }
        default: {
          for (let k = 0; k < 3; k++) {
            const x = a + 0.2 + k * (w - 0.4) / 3;
            f.shape(rectOutline(x, base + 0.15, x + (w - 0.4) / 3 - 0.08, base + h - 0.15), black, 0.03);
            f.shape(rectOutline(x + 0.06, base + 0.21, x + (w - 0.4) / 3 - 0.14, base + h - 0.21), k === 1 ? second : colour, 0.04);
          }
        }
      }
    }
  };
  panel(house.front, -4.4, -0.7, 0.35, 2.8, 0);
  panel(house.front, 0.7, 4.4, 0.35, 2.8, 2);
  house.front.band(0, 0.35, black, 0.02);
  house.front.door(0, 0.95, 2.1, colours[2]!, { frame: black });
  // The low courtyard wall and its stepped gateway.
  const wallFront = b.mass(-5.6, 5.6, 0, 1.9, -5.4, -5.0, white);
  panel(wallFront.front, -5.5, -1.7, 0.25, 1.75, 1);
  panel(wallFront.front, 1.7, 5.5, 0.25, 1.75, 4);
  for (const x of [-1.25, 1.25]) {
    b.box(x - 0.45, 0, -5.55, x + 0.45, 2.6, -4.85, white);
    b.box(x - 0.3, 2.6, -5.45, x + 0.3, 3.0, -4.95, white);
    const pylon = frontAt(b, -5.55, 0.9, 3.0, x);
    pylon.box(-0.45, 0.45, 2.5, 2.6, 0, 0.02, black);
    pylon.shape([[-0.3, 0.3], [0.3, 0.3], [0.3, 2.3], [-0.3, 2.3]], black, 0.02);
    pylon.shape([[-0.22, 0.38], [0.22, 0.38], [0.22, 2.22], [-0.22, 2.22]], colours[x < 0 ? 0 : 1]!, 0.03);
  }
  const gate = frontAt(b, -5.0, 1.6, 2.2);
  gate.shape(rectOutline(-0.8, 0, 0.8, 1.9), black, 0.012);
}

/** Lebanese central-hall house: sandstone, a triple-arched window, a red tile hip. */
export function lebanese(b: DwellingBuilder): void {
  const stone = [0xe0c49a, 0xd6b88c, 0xe8d0aa, 0xcfb083];
  const tile = 0xc25a3a;
  const marble = 0xf3efe6;
  const green = 0x2f6b4a;
  const iron = 0x25282b;
  b.trim = marble;
  const house = b.mass(-6, 6, 0, 7.0, -4, 4, 0xdcc096);
  for (const face of [house.front, house.left, house.right, house.back]) {
    stonework(face, 0, 7.0, 0.42, stone, 0x1eb0 + Math.round(face.width * 11));
    face.band(3.4, 0.22, marble, 0.08);
    face.band(6.8, 0.25, marble, 0.14, 0.05);
  }
  b.hip(-6, 6, -4, 4, 7.0, 9.4, { roof: tile, over: 0.55 });
  // The triple arch over a balcony, on slender marble columns.
  const f = house.front;
  // Between the proudest stone (0.016) and the glass (0.02): at the stones' own depth the
  // veneer flickered through the marble.
  f.shape(archOutline(0, 3.8, 3.6, 2.9, 12), marble, 0.018);
  for (const u of [-1.05, 0, 1.05]) f.window(u, 3.9, 0.8, 2.5, { arch: true, frame: marble, bars: 1 });
  for (const u of [-0.52, 0.52]) f.box(u - 0.07, u + 0.07, 3.85, 5.6, 0, 0.12, marble);
  b.box(-2.2, 3.6, -4.9, 2.2, 3.78, -4, marble);
  b.railing([-2.15, -4.85], [2.15, -4.85], 3.78, 0.95, iron, 12, 0.04);
  for (const x of [-2.1, 2.1]) b.railing([x, -4.85], [x, -4.05], 3.78, 0.95, iron, 3, 0.04);
  for (const x of [-1.6, 1.6]) b.beam([x, 3.0, -4.0], [x, 3.62, -4.8], 0.14, marble);
  for (const u of [-4.2, 4.2]) f.window(u, 3.9, 1.0, 2.1, { arch: true, cross: true, shutters: green });
  f.door(0, 1.4, 2.8, 0x5a3a22, { arch: true, double: true, panels: true, surround: marble });
  for (const u of [-2.6, 2.6]) f.window(u, 0.8, 1.0, 2.0, { arch: true, cross: true, shutters: green });
  for (const u of [-4.8, 4.8]) f.window(u, 0.8, 0.8, 1.8, { arch: true, cross: true });
  steps(b, -1.2, 1.2, -4, 0.3, 2, 0xcfc5b3);
  for (const face of [house.left, house.right]) {
    face.window(-1.8, 3.9, 1.0, 2.1, { arch: true, cross: true, shutters: green });
    face.window(1.8, 3.9, 1.0, 2.1, { arch: true, cross: true, shutters: green });
  }
}
