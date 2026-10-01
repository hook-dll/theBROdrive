import * as THREE from 'three';
import { hashUnit3 } from '../core/rng';
import { DwellingBuilder, shade, type P2, type P3 } from '../world/dwellings/builder';
import type { Road } from '../world/road';
import type { Terrain } from '../world/terrain';
import { BoxOccupancy } from './mirage-occupancy';

/**
 * The odd tableaus: twenty apparitions nobody would expect beside a desert road —
 * bowling pins the height of a house, a chess game left out on the sand, a flock of
 * rubber ducks. They share the palms' and the city's manner: unlit, vertex-coloured,
 * one baked light direction, pale enough to sit in the haze, and drawn through a
 * handful of instanced meshes per encounter.
 *
 * Each form is authored as a small closed solid one unit tall with the dwelling
 * builder's primitives (lathe, box, ball, loft), read in DISPLAY colour, and then has
 * its light baked in from the normals so a sunny side survives an unlit material.
 * The normals are dropped afterwards; the mirage never lights anything.
 */
export const NOVELTY_KINDS = [
  'bowling',
  'chess',
  'ducks',
  'teapots',
  'parasols',
  'icecream',
  'lighthouses',
  'windmills',
  'dice',
  'cones',
  'snowmen',
  'balloons',
  'matryoshkas',
  'rockets',
  'mushrooms',
  'moai',
  'pencils',
  'dominoes',
  'flamingos',
  'gnomes',
] as const;
export type NoveltyKind = (typeof NOVELTY_KINDS)[number];

/**
 * The layouts are authored at a believable giant's scale; the tableau reads at a
 * kilometre, where the palms stand at three times their height and the city's towers
 * pass forty metres. This brings the odd ones up to the same presence.
 */
const NOVELTY_SCALE = 2.4;
/** Nearest any form may stand to the centreline, beyond the setback: off the asphalt. */
const VERGE_M = 10;

const SALT_SPOT = 0x2b51;
const SALT_SHAPE = 0x4d73;
const SALT_COLOUR = 0x5e84;

/** Same light as the city's toned boxes: top brightest, +X sunlit, -X in shade. */
function bakeLight(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const normal = geometry.getAttribute('normal');
  const colour = geometry.getAttribute('color');
  for (let i = 0; i < colour.count; i++) {
    const tone = Math.min(1.2, Math.max(0.5, 0.86 + 0.19 * normal.getX(i) + 0.31 * normal.getY(i) + 0.075 * normal.getZ(i)));
    colour.setXYZ(i, colour.getX(i) * tone, colour.getY(i) * tone, colour.getZ(i) * tone);
  }
  geometry.deleteAttribute('normal');
  return geometry;
}

/**
 * A solid form, rescaled to stand exactly one unit tall on y = 0.
 *
 * Drawn a unit up and brought back down: the builder drops any face lying on y = 0 and
 * looking down, as a house's never shows, but a toppled pin, a die on its side and a
 * doll's half lying on the sand all show exactly that face, and without it they were
 * open cans.
 */
function solid(draw: (b: DwellingBuilder) => void): THREE.BufferGeometry {
  const b = new DwellingBuilder({ grime: 0 }, true);
  b.at(0, 1, 0, 0, () => draw(b));
  const geometry = b.geometry();
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const height = Math.max(1e-3, box.max.y - box.min.y);
  geometry.translate(0, -box.min.y, 0);
  geometry.scale(1 / height, 1 / height, 1 / height);
  geometry.computeBoundingSphere();
  return bakeLight(geometry);
}

/** A smooth path through `points`, resampled evenly: what a tube is swept along. */
function curve(points: readonly P3[], samples: number): P3[] {
  const path = new THREE.CatmullRomCurve3(
    points.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
    false,
    'centripetal',
  );
  return path.getSpacedPoints(samples).map((p): P3 => [p.x, p.y, p.z]);
}

function ellipse(r: number, cy: number, sy: number, steps = 8): P2[] {
  const points: P2[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = -Math.PI / 2 + (i / steps) * Math.PI;
    points.push([Math.max(0, Math.cos(t) * r), cy + Math.sin(t) * r * sy]);
  }
  return points;
}

function ring(r: number, y: number, n = 16): P3[] {
  const points: P3[] = [];
  for (let e = 0; e < n; e++) {
    const a = (e / n) * Math.PI * 2;
    points.push([Math.cos(a) * r, y, Math.sin(a) * r]);
  }
  return points;
}

// ---- forms --------------------------------------------------------------------

function bowlingPin(): THREE.BufferGeometry {
  return solid((b) => {
    const profile: P2[] = [[0.12, 0], [0.16, 0.06], [0.195, 0.2], [0.19, 0.33], [0.14, 0.46], [0.095, 0.55], [0.085, 0.6], [0.085, 0.63], [0.088, 0.66], [0.09, 0.69], [0.105, 0.76], [0.115, 0.84], [0.1, 0.93], [0.06, 0.985], [0, 1]];
    b.lathe(0, 0, profile, 14, (i) => (i === 6 || i === 8 ? 0xe0463a : 0xfaf7f0));
  });
}

function bowlingBall(): THREE.BufferGeometry {
  return solid((b) => {
    b.ball(0, 0.5, 0, 0.5, 0x3a62c4, 1, 16);
    for (const [x, y] of [[-0.09, 0.88], [0.09, 0.88], [0, 0.72]] as const) {
      const z = -Math.sqrt(Math.max(0, 0.25 - x * x - (y - 0.5) * (y - 0.5)));
      b.ball(x, y, z * 0.97, 0.055, 0x1c2238, 1, 8);
    }
  });
}

// ---- chess: a Staunton set on its board -----------------------------------------
//
// Every piece is drawn in KING units (the king 1.0 tall) and is then scaled to one unit
// by `solid`, so the layout gives each piece back its own height (`CHESS_TOP`) and the
// feet keep one proportion across the set: a pawn is a short piece on a narrow foot, not
// a king shrunk. Each is one turned profile where the real piece is turned — foot, stem,
// collar and head in a single lathe, so the light rolls round it — with the knight's head
// and the crowns added where no lathe reaches.

const IVORY = 0xf6f0e2;

/** Drawn height of each piece, king units; the order is the form order. */
const CHESS_TOP = [0.525, 0.655, 0.72, 0.8, 0.893, 1] as const;
/** Radius of each piece's foot, king units. */
const CHESS_FOOT = [0.19, 0.2, 0.2, 0.19, 0.2, 0.21] as const;

/** The foot every piece stands on: a broad plinth, a bead and a cove up to the stem. */
function chessFoot(radius: number): P2[] {
  return [[radius, 0], [radius, 0.03], [radius * 0.93, 0.042], [radius * 0.95, 0.056], [radius * 0.8, 0.074], [radius * 0.66, 0.095]];
}

/** Points round a sphere's upper part, from the neck it grows out of to its crown. */
function headArc(r: number, cy: number, neck: number, steps = 8): P2[] {
  const from = -Math.acos(Math.min(1, neck / r));
  const points: P2[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = from + (i / steps) * (Math.PI / 2 - from);
    points.push([Math.max(0, Math.cos(a) * r), cy + Math.sin(a) * r]);
  }
  return points;
}

function chessPawn(): THREE.BufferGeometry {
  return solid((b) => {
    const profile: P2[] = [...chessFoot(CHESS_FOOT[0]), [0.1, 0.13], [0.08, 0.2], [0.066, 0.27], [0.12, 0.285], [0.12, 0.305], [0.07, 0.315], ...headArc(0.1, 0.425, 0.056)];
    b.lathe(0, 0, profile, 20, IVORY);
  });
}

function chessRook(): THREE.BufferGeometry {
  return solid((b) => {
    // The turret: a slightly waisted drum, a flared parapet and a sunk roof inside it.
    const profile: P2[] = [...chessFoot(CHESS_FOOT[1]), [0.14, 0.13], [0.125, 0.18], [0.115, 0.42], [0.125, 0.44], [0.16, 0.47], [0.16, 0.6], [0.115, 0.6], [0.115, 0.575], [0, 0.575]];
    b.lathe(0, 0, profile, 24, IVORY);
    // Four merlons on the parapet, each an arc of the ring in three flat pieces.
    for (let k = 0; k < 4; k++) {
      const centre = Math.PI / 4 + (k * Math.PI) / 2;
      for (let piece = 0; piece < 3; piece++) {
        const a0 = centre - 0.45 + (piece * 0.9) / 3;
        const a1 = centre - 0.45 + ((piece + 1) * 0.9) / 3;
        const at = (r: number, a: number, y: number): P3 => [Math.cos(a) * r, y, Math.sin(a) * r];
        b.hexa([at(0.115, a0, 0.6), at(0.16, a0, 0.6), at(0.16, a1, 0.6), at(0.115, a1, 0.6), at(0.115, a0, 0.655), at(0.16, a0, 0.655), at(0.16, a1, 0.655), at(0.115, a1, 0.655)], IVORY);
      }
    }
  });
}

function chessKnight(): THREE.BufferGeometry {
  return solid((b) => {
    b.lathe(0, 0, [...chessFoot(CHESS_FOOT[2]), [0.13, 0.12], [0.12, 0.15], [0.14, 0.175], [0.14, 0.195], [0.11, 0.205], [0, 0.205]], 20, IVORY);
    // The horse's head in profile, looking along +Z: chest, jaw, muzzle, forehead, the
    // pricked ear and the arched back of the neck.
    const head: P2[] = [
      [-0.12, 0.2], [0.12, 0.2], [0.11, 0.26], [0.06, 0.31], [0.07, 0.35], [0.13, 0.37], [0.2, 0.38], [0.215, 0.42],
      [0.2, 0.47], [0.14, 0.55], [0.08, 0.62], [0.05, 0.66], [0.03, 0.72], [-0.01, 0.68], [-0.05, 0.63], [-0.1, 0.56],
      [-0.13, 0.46], [-0.14, 0.34], [-0.13, 0.26],
    ];
    b.extrude(head, 'x', -0.07, 0.07, IVORY, { smooth: true });
    // The mane, a narrower ridge standing proud down the back of the neck.
    const mane: P2[] = [[-0.13, 0.46], [-0.1, 0.56], [-0.05, 0.63], [-0.02, 0.665], [-0.07, 0.665], [-0.125, 0.6], [-0.16, 0.48], [-0.16, 0.36], [-0.14, 0.34]];
    b.extrude(mane, 'x', -0.04, 0.04, shade(IVORY, 0.9), { smooth: true });
    for (const side of [-1, 1]) b.ball(side * 0.068, 0.56, 0.1, 0.018, 0x2a2622, 1, 8);
  });
}

function chessBishop(): THREE.BufferGeometry {
  return solid((b) => {
    const profile: P2[] = [
      ...chessFoot(CHESS_FOOT[3]), [0.1, 0.13], [0.08, 0.2], [0.066, 0.38], [0.062, 0.43], [0.11, 0.45], [0.11, 0.47], [0.07, 0.48],
      [0.066, 0.5], [0.085, 0.53], [0.1, 0.57], [0.102, 0.61], [0.092, 0.65], [0.07, 0.69], [0.04, 0.72], [0.015, 0.735], [0, 0.74],
    ];
    b.lathe(0, 0, profile, 20, IVORY);
    b.ball(0, 0.77, 0, 0.03, IVORY, 1, 10);
    // The mitre's slit, cut aslant across its face.
    b.at(0, 0.62, 0.09, 0, () => b.box(-0.045, -0.008, -0.014, 0.045, 0.008, 0.016, 0x3a3430), 0, Math.PI / 4);
  });
}

function chessQueen(): THREE.BufferGeometry {
  return solid((b) => {
    const profile: P2[] = [
      ...chessFoot(CHESS_FOOT[4]), [0.105, 0.13], [0.085, 0.2], [0.065, 0.48], [0.062, 0.53], [0.115, 0.555], [0.115, 0.575], [0.068, 0.585],
      [0.064, 0.6], [0.08, 0.64], [0.115, 0.72], [0.13, 0.755], [0.105, 0.762], [0.06, 0.772], [0, 0.775],
    ];
    b.lathe(0, 0, profile, 22, IVORY);
    // The coronet: a ring of beads round the crown's rim.
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2;
      b.ball(Math.cos(a) * 0.122, 0.768, Math.sin(a) * 0.122, 0.024, IVORY, 1, 8);
    }
    b.ball(0, 0.815, 0, 0.045, IVORY, 1, 12);
    b.ball(0, 0.875, 0, 0.018, IVORY, 1, 8);
  });
}

function chessKing(): THREE.BufferGeometry {
  return solid((b) => {
    const profile: P2[] = [
      ...chessFoot(CHESS_FOOT[5]), [0.11, 0.13], [0.09, 0.2], [0.068, 0.52], [0.065, 0.58], [0.125, 0.605], [0.125, 0.625], [0.072, 0.635],
      [0.068, 0.65], [0.085, 0.69], [0.12, 0.77], [0.12, 0.79], [0.09, 0.81], [0.05, 0.82], [0, 0.822],
    ];
    b.lathe(0, 0, profile, 22, IVORY);
    b.box(-0.018, 0.81, -0.018, 0.018, 1.0, 0.018, IVORY);
    b.box(-0.065, 0.895, -0.018, 0.065, 0.932, 0.018, IVORY);
  });
}

/** Board: a walnut frame round eight by eight squares, one unit square and one unit tall. */
const BOARD_BORDER = 0.045;

function chessBoard(): THREE.BufferGeometry {
  return solid((b) => {
    const frame = 0x4a3222;
    const light = 0xf0e2c0;
    const dark = 0x6e4a2e;
    const inner = 0.5 - BOARD_BORDER;
    const square = (2 * inner) / 8;
    // Squares as full-height columns, the frame a touch lower round them: no square
    // lies on a slab it could fight at a kilometre.
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        const x = -inner + i * square;
        const z = -inner + j * square;
        b.box(x, 0, z, x + square, 1, z + square, (i + j) % 2 ? light : dark);
      }
    }
    b.box(-0.5, 0, -0.5, 0.5, 0.985, -inner, frame);
    b.box(-0.5, 0, inner, 0.5, 0.985, 0.5, frame);
    b.box(-0.5, 0, -inner, -inner, 0.985, inner, frame);
    b.box(inner, 0, -inner, 0.5, 0.985, inner, frame);
  });
}

function rubberDuck(): THREE.BufferGeometry {
  return solid((b) => {
    const yellow = 0xfbd83a;
    const orange = 0xf28a24;
    b.lathe(0, 0, ellipse(0.34, 0.3, 0.8, 10), 16, yellow, { sx: 1.35 });
    b.at(-0.4, 0.38, 0, 0, () => b.cone(0, 0, 0, 0.13, 0.26, yellow, 10), 0, 0.7);
    b.lathe(0.02, 0, ellipse(0.12, 0.34, 0.6, 6), 12, 0xf1c52c, { sx: 1.8, sz: 2.8 });
    b.ball(0.3, 0.74, 0, 0.21, yellow, 1, 14);
    b.at(0.48, 0.7, 0, 0, () => b.lathe(0, 0, [[0.08, 0], [0.06, 0.1], [0, 0.16]], 10, orange), 0, -Math.PI / 2);
    for (const z of [-0.12, 0.12]) b.ball(0.43, 0.82, z, 0.035, 0x1f1c1a, 1, 6);
  });
}

/** Teapot body, bottom to lid seat: what the handle and the spout are sunk into. */
const TEAPOT_BODY: readonly P2[] = [[0.22, 0], [0.3, 0.03], [0.37, 0.1], [0.405, 0.2], [0.41, 0.28], [0.405, 0.34], [0.39, 0.42], [0.33, 0.52], [0.24, 0.58], [0.17, 0.6]];

function teapot(): THREE.BufferGeometry {
  return solid((b) => {
    const white = 0xf8f6f0;
    const blue = 0x3f6fc4;
    b.lathe(0, 0, TEAPOT_BODY, 24, (i) => (i === 4 ? blue : white));
    b.lathe(0, 0, [[0.19, 0.6], [0.185, 0.615], [0.15, 0.66], [0.08, 0.695], [0.03, 0.705], [0, 0.706]], 20, white);
    b.ball(0, 0.74, 0, 0.042, blue, 1, 10);
    // Handle and spout are single swept tubes whose ends are buried in the body, so each
    // leaves it as one piece: no joints to read, no daylight where it meets the pot.
    b.tube(curve([[-0.32, 0.48, 0], [-0.43, 0.53, 0], [-0.55, 0.51, 0], [-0.62, 0.4, 0], [-0.61, 0.27, 0], [-0.52, 0.17, 0], [-0.36, 0.14, 0]], 22), 0.035, 12, white);
    b.tube(curve([[0.33, 0.2, 0], [0.45, 0.25, 0], [0.54, 0.35, 0], [0.59, 0.46, 0], [0.64, 0.54, 0], [0.7, 0.58, 0]], 16), (t) => 0.075 - 0.043 * t, 12, white);
  });
}

function teacup(): THREE.BufferGeometry {
  return solid((b) => {
    const white = 0xf8f6f0;
    const blue = 0x3f6fc4;
    b.lathe(0, 0, [[0.44, 0], [0.44, 0.06]], 24, white);
    // Over the rim and down inside to the tea, so the cup has a wall and not a skin.
    const cup: P2[] = [[0.2, 0.06], [0.22, 0.1], [0.255, 0.3], [0.275, 0.42], [0.3, 0.6], [0.32, 0.7], [0.295, 0.705], [0.28, 0.645], [0, 0.645]];
    b.lathe(0, 0, cup, 24, (i) => (i === 2 ? blue : i === 7 ? 0x6a4228 : white));
    b.tube(curve([[0.27, 0.56, 0], [0.36, 0.6, 0], [0.44, 0.54, 0], [0.46, 0.43, 0], [0.41, 0.33, 0], [0.33, 0.28, 0], [0.23, 0.27, 0]], 20), 0.028, 10, white);
  });
}

function parasol(colours: readonly [number, number]): () => THREE.BufferGeometry {
  return () =>
    solid((b) => {
      b.cylinder(0, 0, 0, 0.94, 0.018, 0xe8e2d4, 8);
      const wedges = 10;
      const apex: P3 = [0, 1.0, 0];
      for (let k = 0; k < wedges; k++) {
        const a0 = (k / wedges) * Math.PI * 2;
        const a1 = ((k + 1) / wedges) * Math.PI * 2;
        const mid = (a0 + a1) / 2;
        b.poly([apex, [Math.cos(a0) * 0.62, 0.8, Math.sin(a0) * 0.62], [Math.cos(a1) * 0.62, 0.8, Math.sin(a1) * 0.62]], colours[k % 2]!, [Math.cos(mid) * 0.3, 1, Math.sin(mid) * 0.3]);
        const tip = (a0 + a1) / 2;
        b.poly([[Math.cos(a0) * 0.62, 0.8, Math.sin(a0) * 0.62], [Math.cos(a1) * 0.62, 0.8, Math.sin(a1) * 0.62], [Math.cos(tip) * 0.6, 0.74, Math.sin(tip) * 0.6]], colours[k % 2]!, [Math.cos(tip), 0, Math.sin(tip)]);
      }
      b.lathe(0, 0, [[0, 0.95], [0.62, 0.8]], 20, colours[1], { capTop: false });
      b.ball(0, 1.01, 0, 0.03, 0xe8e2d4, 1, 6);
    });
}

function iceCream(scoops: readonly number[]): () => THREE.BufferGeometry {
  return () =>
    solid((b) => {
      const waffle = [0xe0a85e, 0xcc9048];
      const profile: P2[] = [];
      for (let i = 0; i <= 6; i++) profile.push([0.22 * (i / 6), 0.62 * (i / 6)]);
      b.lathe(0, 0, profile, 16, (i) => waffle[i % 2]!, { smooth: false });
      b.lathe(0, 0, [[0.235, 0.6], [0.235, 0.66]], 16, 0xb97c3c);
      let y = 0.72;
      scoops.forEach((colour, k) => {
        const r = 0.22 - k * 0.02;
        b.ball(0, y, 0, r, colour, 0.9, 14);
        for (let d = 0; d < 5; d++) {
          const a = (d / 5) * Math.PI * 2 + k;
          b.ball(Math.cos(a) * r * 0.85, y - r * 0.55, Math.sin(a) * r * 0.85, r * 0.28, colour, 1.3, 6);
        }
        y += r * 1.45;
      });
      b.ball(0, y - 0.05, 0, 0.07, 0xd8203a, 1, 8);
      b.beam([0, y + 0.01, 0], [0.05, y + 0.14, 0.02], 0.012, 0x4a7a2a);
    });
}

function lighthouse(): THREE.BufferGeometry {
  return solid((b) => {
    const red = 0xe0463a;
    const white = 0xfaf7f0;
    const bands: P2[] = [];
    for (let i = 0; i <= 6; i++) bands.push([0.14 - 0.055 * (i / 6), 0.05 + 0.67 * (i / 6)]);
    b.lathe(0, 0, [[0.16, 0], [0.16, 0.05]], 16, 0x8a847a);
    b.lathe(0, 0, bands, 16, (i) => (i % 2 ? white : red));
    b.lathe(0, 0, [[0.13, 0.72], [0.13, 0.745]], 16, 0x2a2c2e);
    b.lathe(0, 0, [[0.07, 0.745], [0.07, 0.84]], 12, 0x9fd8e2);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      b.box(Math.cos(a) * 0.07 - 0.006, 0.745, Math.sin(a) * 0.07 - 0.006, Math.cos(a) * 0.07 + 0.006, 0.84, Math.sin(a) * 0.07 + 0.006, 0x2a2c2e);
    }
    b.lathe(0, 0, [[0.09, 0.84], [0.06, 0.9], [0, 0.93]], 12, red);
    b.ball(0, 0.95, 0, 0.022, 0x2a2c2e, 1, 6);
    b.box(0.13, 0, -0.08, 0.32, 0.1, 0.08, white);
    b.gable(0.13, 0.32, -0.08, 0.08, 0.1, 0.16, { roof: red, wall: white, over: 0.02, end: 0.02, thick: 0.02, cap: null });
  });
}

function dutchWindmill(): THREE.BufferGeometry {
  return solid((b) => {
    const body = 0xe9dcc0;
    const cap = 0x4a4e52;
    const sail = 0xfaf4e4;
    const frame = 0x6b4a30;
    b.lathe(0, 0, [[0.2, 0], [0.2, 0.06], [0.17, 0.08], [0.13, 0.62]], 8, (i) => (i < 2 ? 0x9a8a78 : body), { smooth: false });
    b.box(-0.21, 0.2, -0.21, 0.21, 0.23, 0.21, frame);
    b.lathe(0, 0, [[0.15, 0.6], [0.12, 0.7], [0.05, 0.76], [0, 0.78]], 10, cap);
    b.box(-0.04, 0.06, -0.195, 0.04, 0.17, -0.18, 0x3a6f4a);
    b.at(0, 0.64, -0.2, 0, () => {
      b.ball(0, 0, 0, 0.035, frame, 1, 6);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + 0.35;
        const c = Math.cos(a);
        const s = Math.sin(a);
        b.beam([0, 0, 0], [c * 0.52, s * 0.52, 0], 0.025, frame);
        const nx = -s;
        const ny = c;
        const at = (r: number, w: number, z: number): P3 => [c * r + nx * w, s * r + ny * w, z];
        b.hexa([at(0.12, 0.01, -0.005), at(0.5, 0.01, -0.005), at(0.5, 0.11, -0.005), at(0.12, 0.11, -0.005), at(0.12, 0.01, 0.005), at(0.5, 0.01, 0.005), at(0.5, 0.11, 0.005), at(0.12, 0.11, 0.005)], sail);
        for (const r of [0.2, 0.3, 0.4]) b.beam(at(r, 0.0, -0.01), at(r, 0.11, -0.01), 0.012, frame);
      }
    });
  });
}

/** Die faces: pips in a 3x3 grid, standard opposite faces summing to seven. */
const PIPS: Readonly<Record<number, readonly (readonly [number, number])[]>> = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};

/** Rounding of a die's edges and corners, as a fraction of its side. */
const DIE_ROUND = 0.13;

/**
 * The six ways a die comes to rest: a quarter or half turn about the middle of its foot,
 * and the lift, in heights, that brings the turned cube back up onto the sand.
 */
const DIE_REST: readonly { readonly pitch: number; readonly roll: number; readonly lift: number }[] = [
  { pitch: 0, roll: 0, lift: 0 },
  { pitch: Math.PI, roll: 0, lift: 1 },
  { pitch: Math.PI / 2, roll: 0, lift: 0.5 },
  { pitch: -Math.PI / 2, roll: 0, lift: 0.5 },
  { pitch: 0, roll: Math.PI / 2, lift: 0.5 },
  { pitch: 0, roll: -Math.PI / 2, lift: 0.5 },
];

function die(body: number, pip: number): () => THREE.BufferGeometry {
  return () =>
    solid((b) => {
      // A rounded cube: every horizontal section is a square with rounded corners, the
      // corners' radius swelling out of the bottom band and back in through the top.
      const r = DIE_ROUND;
      const inner = 0.5 - r;
      const bands = 4;
      const steps = 4;
      const section = (y: number, rho: number): P3[] => {
        const ring: P3[] = [];
        for (const [cx, cz, start] of [[inner, inner, 0], [-inner, inner, 0.5], [-inner, -inner, 1], [inner, -inner, 1.5]] as const) {
          for (let k = 0; k <= steps; k++) {
            const a = (start + (k / steps) * 0.5) * Math.PI;
            ring.push([cx + Math.cos(a) * rho, y, cz + Math.sin(a) * rho]);
          }
        }
        return ring;
      };
      const rings: P3[][] = [];
      for (let k = 0; k <= bands; k++) {
        const phi = -Math.PI / 2 + (k / bands) * (Math.PI / 2);
        rings.push(section(r + Math.sin(phi) * r, Math.cos(phi) * r));
      }
      for (let k = 0; k <= bands; k++) {
        const phi = (k / bands) * (Math.PI / 2);
        rings.push(section(1 - r + Math.sin(phi) * r, Math.cos(phi) * r));
      }
      b.loft(rings, body);
      // Pips: round, a shallow dome standing just proud of the face and rooted inside
      // it, so the face and the pip meet along a crease and never share a plane.
      const faces: readonly [number, P3, P3, P3, number, number][] = [
        [1, [0, 1, 0], [1, 0, 0], [0, 0, 1], 0, 0],
        [6, [0, 0, 0], [1, 0, 0], [0, 0, 1], Math.PI, 0],
        [2, [0, 0.5, -0.5], [1, 0, 0], [0, 1, 0], -Math.PI / 2, 0],
        [5, [0, 0.5, 0.5], [1, 0, 0], [0, 1, 0], Math.PI / 2, 0],
        [3, [0.5, 0.5, 0], [0, 0, 1], [0, 1, 0], 0, -Math.PI / 2],
        [4, [-0.5, 0.5, 0], [0, 0, 1], [0, 1, 0], 0, Math.PI / 2],
      ];
      for (const [count, centre, u, v, pitch, roll] of faces) {
        for (const [a, c] of PIPS[count]!) {
          const x = centre[0] + (u[0] * a + v[0] * c) * 0.25;
          const y = centre[1] + (u[1] * a + v[1] * c) * 0.25;
          const z = centre[2] + (u[2] * a + v[2] * c) * 0.25;
          b.at(x, y, z, 0, () => b.lathe(0, 0, [[0.078, -0.02], [0.078, 0.004], [0.05, 0.011], [0, 0.013]], 14, pip), pitch, roll);
        }
      }
    });
}

function trafficCone(): THREE.BufferGeometry {
  return solid((b) => {
    const orange = 0xf46a2a;
    const white = 0xfaf7f0;
    b.box(-0.32, 0, -0.32, 0.32, 0.05, 0.32, 0xd04e1e);
    const profile: P2[] = [[0.26, 0.05], [0.22, 0.25], [0.19, 0.38], [0.175, 0.45], [0.15, 0.56], [0.13, 0.64], [0.11, 0.72], [0.05, 0.95], [0.03, 1]];
    b.lathe(0, 0, profile, 16, (i) => (i === 2 || i === 4 ? white : orange));
  });
}

function snowman(): THREE.BufferGeometry {
  return solid((b) => {
    const snow = 0xf6f8fc;
    const coal = 0x24262a;
    b.ball(0, 0.24, 0, 0.25, snow, 0.95, 16);
    b.ball(0, 0.6, 0, 0.18, snow, 1, 14);
    b.ball(0, 0.86, 0, 0.13, snow, 1, 12);
    b.lathe(0, 0, [[0.17, 0.95], [0.17, 0.97]], 14, coal);
    b.lathe(0, 0, [[0.1, 0.97], [0.1, 1.15]], 12, coal);
    b.lathe(0, 0, [[0.135, 0.72], [0.135, 0.77]], 14, 0xd8322a);
    b.box(0.06, 0.58, -0.14, 0.12, 0.75, -0.1, 0xd8322a);
    b.at(0, 0.86, -0.12, 0, () => b.cone(0, 0, 0, 0.03, 0.17, 0xf28a24, 8), -Math.PI / 2);
    for (const x of [-0.045, 0.045]) b.ball(x, 0.9, -0.115, 0.018, coal, 1, 6);
    for (const y of [0.52, 0.6, 0.68]) b.ball(0, y, -Math.sqrt(0.0324 - (y - 0.6) * (y - 0.6)), 0.02, coal, 1, 6);
    for (const side of [-1, 1]) {
      b.beam([side * 0.15, 0.64, 0], [side * 0.38, 0.8, 0], 0.025, 0x6b4a30);
      b.beam([side * 0.32, 0.76, 0], [side * 0.4, 0.72, 0], 0.018, 0x6b4a30);
    }
  });
}

function balloon(colours: readonly [number, number]): () => THREE.BufferGeometry {
  return () =>
    solid((b) => {
      const profile: P2[] = [[0.12, 0.32], [0.3, 0.45], [0.42, 0.6], [0.46, 0.72], [0.44, 0.84], [0.36, 0.94], [0.2, 1.0], [0.02, 1.02]];
      b.loft(profile.map(([r, y]) => ring(r, y, 16)), (_ring, edge) => (edge < 0 ? colours[0] : colours[edge % 2]!));
      b.box(-0.07, 0, -0.07, 0.07, 0.09, 0.07, 0x8a5a36);
      for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) b.beam([x * 0.06, 0.09, z * 0.06], [x * 0.09, 0.33, z * 0.09], 0.008, 0x3a2e24);
    });
}

// ---- matryoshka -------------------------------------------------------------------
//
// One turned outline — belly, waist, a round head — painted where a matryoshka is
// painted: the scarf over the head and down the back, a face in the scarf's opening, an
// apron down the front with a rose on it. The paint is the skin's own colour, quad by
// quad, and each ring's vertices are slid onto the edges of the face and apron ovals so
// those edges run smooth instead of in steps; the eyes, cheeks, mouth and rose are
// small domes rooted in the surface.

const DOLL_KEYS: readonly P2[] = [
  [0.26, 0], [0.3, 0.035], [0.335, 0.12], [0.345, 0.22], [0.335, 0.33], [0.305, 0.43], [0.26, 0.51], [0.225, 0.565],
  [0.215, 0.6], [0.225, 0.65], [0.232, 0.72], [0.222, 0.8], [0.19, 0.87], [0.135, 0.935], [0.07, 0.978], [0, 1],
];
/** Where the doll opens, as a fraction of her height. */
const DOLL_CUT = 0.5;
/** Where the scarf's lower edge crosses the shoulders, and the hair meets the face. */
const DOLL_SCARF = 0.575;
const DOLL_HAIR = 0.818;
/** The painted ovals: centre height, half height, and half width as an angle from the front. */
const DOLL_FACE = { y: 0.745, h: 0.118, w: 0.78 } as const;
const DOLL_APRON = { y: 0.3, h: 0.235, w: 0.95 } as const;
const DOLL_WOOD = 0xe6c89a;
/**
 * Vertices round each ring: segments across the front, in each side band, and round
 * the back. The back is fixed from ring to ring beyond `DOLL_SPREAD` either side of the
 * front; only the front and the side bands follow the ovals.
 */
const DOLL_FRONT = 12;
const DOLL_SIDE = 4;
const DOLL_BACK = 20;
const DOLL_SIDES = DOLL_FRONT + 2 * DOLL_SIDE + DOLL_BACK;
const DOLL_SPREAD = 1.25;
/** Height over which the front spreads out again beyond an oval's point. */
const DOLL_EASE = 0.045;

/**
 * The outline resampled finely, with a row exactly on the cut, on the scarf's and the
 * hair's edges, and at the top and bottom points of both ovals.
 */
const DOLL_PROFILE: readonly P2[] = (() => {
  const path = new THREE.CatmullRomCurve3(DOLL_KEYS.map(([r, y]) => new THREE.Vector3(r, y, 0)), false, 'centripetal');
  const points = path.getSpacedPoints(56).map((p): P2 => [Math.max(0, p.x), p.y]);
  points[0] = DOLL_KEYS[0]!;
  points[points.length - 1] = [0, 1];
  const rows = [DOLL_CUT, DOLL_SCARF, DOLL_HAIR, DOLL_FACE.y - DOLL_FACE.h, DOLL_FACE.y + DOLL_FACE.h, DOLL_APRON.y - DOLL_APRON.h, DOLL_APRON.y + DOLL_APRON.h];
  for (const y of rows) {
    const i = points.findIndex(([, py]) => py >= y);
    if (Math.abs(points[i]![1] - y) < 1e-4) continue;
    const [r0, y0] = points[i - 1]!;
    const [r1, y1] = points[i]!;
    points.splice(i, 0, [r0 + ((r1 - r0) * (y - y0)) / (y1 - y0), y]);
  }
  return points;
})();

function dollRadius(y: number): number {
  for (let i = 0; i + 1 < DOLL_PROFILE.length; i++) {
    const [r0, y0] = DOLL_PROFILE[i]!;
    const [r1, y1] = DOLL_PROFILE[i + 1]!;
    if (y <= y1) return r0 + ((r1 - r0) * (y - y0)) / Math.max(1e-9, y1 - y0);
  }
  return 0;
}

/** Widest the whole doll is, and the lid half, in their own heights. */
const DOLL_RADIUS = Math.max(...DOLL_PROFILE.map(([r]) => r));
const DOLL_LID_RADIUS = Math.max(...DOLL_PROFILE.filter(([, y]) => y >= DOLL_CUT).map(([r]) => r)) / (1 - DOLL_CUT);

/** Whether a height is within an oval's span, its top and bottom points included. */
function inOval(oval: { readonly y: number; readonly h: number }, y: number): boolean {
  return Math.abs(y - oval.y) <= oval.h + 1e-6;
}

/** Half the width of an oval at a height, as an angle from the front. */
function ovalHalf(oval: { readonly y: number; readonly h: number; readonly w: number }, y: number): number {
  const t = Math.min(1, Math.abs(y - oval.y) / oval.h);
  return oval.w * Math.sqrt(1 - t * t);
}

/**
 * A ring's angles, from the left edge of the front round to it again. Where a ring
 * crosses the face or the apron its `DOLL_FRONT` segments span exactly that oval, so the
 * oval's edge is a column of vertices running up the doll rather than a staircase
 * across a grid; elsewhere the front and side bands share their spread evenly, eased
 * in over `DOLL_EASE` beyond each oval's point so no ring is sheared against the next.
 * The back never moves.
 */
function dollAngles(y: number): number[] {
  const oval = inOval(DOLL_FACE, y) ? DOLL_FACE : inOval(DOLL_APRON, y) ? DOLL_APRON : null;
  const beyond = Math.min(...[DOLL_FACE, DOLL_APRON].map((o) => Math.abs(y - o.y) - o.h));
  const t = Math.min(1, Math.max(0, beyond / DOLL_EASE));
  const half = oval ? ovalHalf(oval, y) : ((DOLL_SPREAD * DOLL_FRONT) / (DOLL_FRONT + 2 * DOLL_SIDE)) * t * t * (3 - 2 * t);
  const centre = 1.5 * Math.PI;
  const angles: number[] = [];
  for (let k = 0; k <= DOLL_FRONT; k++) angles.push(centre - half + (k * 2 * half) / DOLL_FRONT);
  for (let k = 1; k <= DOLL_SIDE; k++) angles.push(centre + half + (k * (DOLL_SPREAD - half)) / DOLL_SIDE);
  for (let k = 1; k < DOLL_BACK; k++) angles.push(centre + DOLL_SPREAD + (k * (2 * Math.PI - 2 * DOLL_SPREAD)) / DOLL_BACK);
  for (let k = 0; k < DOLL_SIDE; k++) angles.push(centre + 2 * Math.PI - DOLL_SPREAD + (k * (DOLL_SPREAD - half)) / DOLL_SIDE);
  return angles;
}

function matryoshka(body: number, scarf: number, part: 'whole' | 'bottom' | 'top'): () => THREE.BufferGeometry {
  return () =>
    solid((b) => {
      const skin = 0xf8e2c8;
      const hair = 0x6a3a1e;
      const apron = 0xfaf2dc;
      const cut = DOLL_CUT;
      const profile = DOLL_PROFILE.filter(([, y]) => (part === 'bottom' ? y <= cut + 1e-6 : part === 'top' ? y >= cut - 1e-6 : true));
      // The outline's normal at each row: the mean of the two segments meeting there.
      const normalAt = (i: number): P2 => {
        let nr = 0;
        let ny = 0;
        for (const s of [i - 1, i]) {
          const a = profile[s];
          const c = profile[s + 1];
          if (!a || !c) continue;
          const length = Math.hypot(c[1] - a[1], c[0] - a[0]) || 1;
          nr += (c[1] - a[1]) / length;
          ny += -(c[0] - a[0]) / length;
        }
        const length = Math.hypot(nr, ny) || 1;
        return [nr / length, ny / length];
      };
      const angles = profile.map(([, y]) => dollAngles(y));
      const rings = profile.map(([r, y], i) => angles[i]!.map((a): P3 => [Math.cos(a) * r, y, Math.sin(a) * r]));
      const normals = profile.map((_, i) => {
        const [nr, ny] = normalAt(i);
        return angles[i]!.map((a): P3 => [Math.cos(a) * nr, ny, Math.sin(a) * nr]);
      });
      // A quad is on the front exactly when it lies in the front columns, so the face and
      // the apron are those columns within their ovals' heights.
      const colour = (ring: number, edge: number): number => {
        if (edge < 0) return DOLL_WOOD;
        const y = (profile[ring]![1] + profile[ring + 1]![1]) / 2;
        const front = edge < DOLL_FRONT;
        if (front && inOval(DOLL_FACE, y)) return y > DOLL_HAIR ? hair : skin;
        if (y >= DOLL_SCARF) return scarf;
        if (front && inOval(DOLL_APRON, y)) return apron;
        return body;
      };
      b.loft(rings, colour, false, normals);
      if (part !== 'top') b.poly(rings[0]!, DOLL_WOOD, [0, -1, 0]);
      if (part !== 'whole') {
        // The cut: a lip and a shallow well of bare wood, the inside of a doll, on the
        // same vertices as the rim so the two meet without a seam.
        const rimRing = part === 'bottom' ? rings[rings.length - 1]! : rings[0]!;
        const rim = angles[part === 'bottom' ? angles.length - 1 : 0]!;
        const up = part === 'bottom' ? 1 : -1;
        const rc = dollRadius(cut) - 0.025;
        const floor = cut - up * 0.03;
        const ring = (r: number, y: number): P3[] => rim.map((a): P3 => [Math.cos(a) * r, y, Math.sin(a) * r]);
        const facing = (n: P3): P3[] => rim.map(() => n);
        const inward = rim.map((a): P3 => [-Math.cos(a), 0, -Math.sin(a)]);
        b.loft([rimRing, ring(rc, cut)], DOLL_WOOD, false, [facing([0, up, 0]), facing([0, up, 0])]);
        b.loft([ring(rc, cut), ring(rc, floor)], shade(DOLL_WOOD, 0.9), false, [inward, inward]);
        b.poly(ring(rc, floor), DOLL_WOOD, [0, up, 0]);
      }
      // Features as small domes rooted in the surface at (height, angle from the front).
      const dome = (y: number, d: number, radius: number, sink: number, hex: number, sy = 1): void => {
        if (part === 'bottom' ? y + radius > cut : part === 'top' ? y - radius < cut : false) return;
        const r = dollRadius(y) - sink;
        const a = 1.5 * Math.PI + d;
        b.ball(Math.cos(a) * r, y, Math.sin(a) * r, radius, hex, sy, 10);
      };
      for (const side of [-1, 1]) {
        dome(0.765, side * 0.27, 0.02, 0.008, 0x2a2622);
        dome(0.72, side * 0.42, 0.034, 0.022, 0xee7a80, 0.8);
      }
      dome(0.69, 0, 0.02, 0.012, 0xc8322a, 0.6);
      dome(0.6, 0, 0.042, 0.02, shade(scarf, 0.85));
      // The rose on the apron, and its two leaves.
      const onApron = (s: number, y: number): number => s / dollRadius(y);
      dome(0.31, 0, 0.05, 0.03, 0xb82222);
      for (let k = 0; k < 5; k++) {
        const t = (k / 5) * Math.PI * 2 + 0.3;
        const y = 0.31 + Math.sin(t) * 0.07;
        dome(y, onApron(Math.cos(t) * 0.07, y), 0.04, 0.026, 0xe8463a);
      }
      for (const side of [-1, 1]) dome(0.215, onApron(side * 0.1, 0.215), 0.036, 0.024, 0x3a8f58, 0.6);
    });
}

function rocket(body: number, trim: number): () => THREE.BufferGeometry {
  return () =>
    solid((b) => {
      b.lathe(0, 0, [[0.1, 0.02], [0.08, 0.15]], 12, 0x3a3c40);
      b.lathe(0, 0, [[0.13, 0.14], [0.16, 0.25], [0.17, 0.45], [0.15, 0.65], [0.1, 0.8], [0.04, 0.92], [0, 0.97]], 16, (i) => (i >= 4 ? trim : body));
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + Math.PI / 2;
        const c = Math.cos(a);
        const s = Math.sin(a);
        const t = 0.012;
        const at = (r: number, y: number, side: number): P3 => [c * r - s * t * side, y, s * r + c * t * side];
        b.hexa([at(0.12, 0.14, -1), at(0.36, 0.0, -1), at(0.36, 0.0, 1), at(0.12, 0.14, 1), at(0.13, 0.42, -1), at(0.36, 0.22, -1), at(0.36, 0.22, 1), at(0.13, 0.42, 1)], trim);
      }
      b.ball(0, 0.55, -0.155, 0.07, 0xb9bfc4, 1, 10);
      b.ball(0, 0.55, -0.17, 0.052, 0x2f6f8a, 1, 10);
    });
}

function mushroom(cap: number, spots: boolean, stout: number): () => THREE.BufferGeometry {
  return () =>
    solid((b) => {
      const stem = 0xf4ecd8;
      b.lathe(0, 0, [[0.12 * stout, 0], [0.1 * stout, 0.3], [0.09 * stout, 0.5], [0.1 * stout, 0.55]], 14, stem);
      b.lathe(0, 0, [[0.1, 0.52], [0.42, 0.55]], 18, 0xeadcc0, { capTop: false });
      const capProfile: P2[] = [[0.42, 0.55], [0.44, 0.6], [0.4, 0.72], [0.28, 0.84], [0.1, 0.9], [0, 0.91]];
      b.lathe(0, 0, capProfile, 18, cap, { capBottom: false });
      if (!spots) return;
      for (const [r, y, count, phase] of [[0.41, 0.66, 7, 0], [0.3, 0.8, 5, 0.4], [0.12, 0.89, 3, 1.1]] as const) {
        for (let k = 0; k < count; k++) {
          const a = (k / count) * Math.PI * 2 + phase;
          b.ball(Math.cos(a) * r, y, Math.sin(a) * r, 0.05, 0xfaf7f0, 0.55, 6);
        }
      }
    });
}

function moai(pukao: boolean): () => THREE.BufferGeometry {
  return () =>
    solid((b) => {
      const stone = 0x958a7a;
      const dark = 0x4a423a;
      b.box(-0.2, 0, -0.14, 0.2, 0.26, 0.14, stone);
      b.hexa([[-0.22, 0.25, -0.17], [0.22, 0.25, -0.17], [0.22, 0.25, 0.15], [-0.22, 0.25, 0.15], [-0.19, 0.95, -0.16], [0.19, 0.95, -0.16], [0.19, 0.95, 0.12], [-0.19, 0.95, 0.12]], stone);
      b.box(-0.2, 0.68, -0.22, 0.2, 0.77, -0.14, stone);
      b.box(-0.15, 0.6, -0.19, -0.05, 0.68, -0.165, dark);
      b.box(0.05, 0.6, -0.19, 0.15, 0.68, -0.165, dark);
      b.hexa([[-0.06, 0.45, -0.28], [0.06, 0.45, -0.28], [0.06, 0.45, -0.17], [-0.06, 0.45, -0.17], [-0.03, 0.69, -0.22], [0.03, 0.69, -0.22], [0.03, 0.69, -0.17], [-0.03, 0.69, -0.17]], stone);
      b.box(-0.12, 0.36, -0.22, 0.12, 0.41, -0.16, stone);
      b.box(-0.1, 0.25, -0.2, 0.1, 0.33, -0.16, stone);
      for (const side of [-1, 1]) b.box(side * 0.2, 0.45, -0.05, side * 0.25, 0.82, 0.05, stone);
      if (pukao) b.lathe(0, 0.0, [[0.15, 0.95], [0.16, 1.05], [0.14, 1.1]], 12, 0xa8553e);
    });
}

function pencil(body: number): () => THREE.BufferGeometry {
  return () =>
    solid((b) => {
      b.lathe(0, 0, [[0, 0], [0.014, 0.035], [0.06, 0.12]], 6, (i) => (i === 0 ? 0x2a2a2a : 0xeccf9e), { smooth: false });
      b.lathe(0, 0, [[0.06, 0.12], [0.06, 0.82]], 6, body, { smooth: false });
      b.lathe(0, 0, [[0.063, 0.82], [0.063, 0.9]], 12, 0xc8ccd0);
      b.lathe(0, 0, [[0.058, 0.9], [0.058, 0.98], [0.04, 1.0]], 12, 0xf28b9a);
    });
}

function domino(top: number, bottom: number): () => THREE.BufferGeometry {
  return () =>
    solid((b) => {
      const ivory = 0xfaf6ec;
      const black = 0x1f1d1c;
      b.box(-0.25, 0, -0.06, 0.25, 1, 0.06, ivory);
      b.box(-0.2, 0.49, -0.07, 0.2, 0.51, -0.06, black);
      for (const [count, y0] of [[top, 0.75], [bottom, 0.25]] as const) {
        for (const [a, c] of PIPS[count]!) {
          const x = a * 0.13;
          const y = y0 + c * 0.13;
          b.box(x - 0.035, y - 0.035, -0.075, x + 0.035, y + 0.035, -0.06, black);
        }
      }
    });
}

function flamingo(): THREE.BufferGeometry {
  return solid((b) => {
    const pink = 0xf590b4;
    const deep = 0xe06a96;
    b.lathe(0, 0, ellipse(0.13, 0.62, 0.75, 10), 18, pink, { sx: 1.6 });
    // The folded wing, a deeper pink standing proud of the flank.
    b.lathe(-0.04, 0, ellipse(0.1, 0.64, 0.6, 8), 16, deep, { sx: 1.5, sz: 1.45 });
    b.at(-0.2, 0.64, 0, 0, () => b.cone(0, 0, 0, 0.06, 0.14, deep, 10), 0, 1.2);
    // One S from the breast to the head: forward, back over the breast, forward again,
    // the neck thinning as it rises, and its root buried in the body.
    const neck = curve([[0.15, 0.64, 0], [0.2, 0.71, 0], [0.235, 0.79, 0], [0.21, 0.87, 0], [0.14, 0.94, 0], [0.115, 1.01, 0], [0.14, 1.075, 0], [0.19, 1.105, 0]], 28);
    b.tube(neck, (t) => 0.032 - 0.011 * t, 10, pink);
    b.ball(0.205, 1.105, 0, 0.046, pink, 1, 12);
    for (const side of [-1, 1]) b.ball(0.222, 1.12, side * 0.038, 0.01, 0x1f1c1a, 1, 6);
    // The beak bends down at half its length, pale to the bend and black past it.
    const beak = curve([[0.235, 1.105, 0], [0.28, 1.1, 0], [0.305, 1.075, 0], [0.312, 1.035, 0]], 10);
    b.tube(beak, (t) => 0.024 - 0.016 * t, 8, (t) => (t < 0.55 ? 0xf6f0e4 : 0x1f1c1a));
    // One leg to stand on, the other folded up under the body.
    b.tube([[0, 0.58, 0.03], [0, 0.33, 0.03], [0.01, 0.02, 0.03]], 0.012, 8, deep);
    b.ball(0, 0.33, 0.03, 0.018, deep, 1, 8);
    b.tube([[0, 0.58, -0.03], [0.08, 0.36, -0.03], [-0.02, 0.3, -0.03]], 0.012, 8, deep);
    b.ball(0.08, 0.36, -0.03, 0.018, deep, 1, 8);
    b.box(-0.04, 0, 0.0, 0.07, 0.014, 0.06, deep);
  });
}

function gnome(): THREE.BufferGeometry {
  return solid((b) => {
    const blue = 0x3a6fb0;
    const red = 0xd8322a;
    for (const x of [-0.08, 0.08]) b.box(x - 0.06, 0, -0.1, x + 0.06, 0.07, 0.06, 0x4a2f22);
    b.lathe(0, 0, [[0.2, 0.06], [0.19, 0.2], [0.185, 0.24], [0.15, 0.42], [0.12, 0.48]], 14, (i) => (i === 1 ? 0x2a2622 : blue));
    b.at(0, 0.5, -0.05, 0, () => b.lathe(0, 0, [[0, 0], [0.13, 0.26]], 12, 0xf8f6f0), Math.PI);
    b.ball(0, 0.56, -0.01, 0.11, 0xf2c4a0, 1, 12);
    b.ball(0, 0.53, -0.115, 0.04, 0xe8907a, 1, 8);
    for (const x of [-0.04, 0.04]) b.ball(x, 0.6, -0.1, 0.014, 0x1f1c1a, 1, 6);
    b.lathe(0, 0, [[0.14, 0.6], [0.08, 0.8], [0.035, 0.94], [0, 1.0]], 12, red);
    for (const side of [-1, 1]) b.beam([side * 0.16, 0.4, 0], [side * 0.2, 0.24, -0.06], 0.06, blue);
  });
}

// ---- layouts --------------------------------------------------------------------

/** A ground spot beside the road, in world coordinates. */
interface Spot {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly s: number;
  readonly lateral: number;
  /** -1 or 1: which verge. */
  readonly side: number;
  /** 0 near the road .. 1 at the far edge of the field. */
  readonly depth: number;
}

interface PutOptions {
  readonly pitch?: number;
  readonly roll?: number;
  /** Metres added to the ground height. */
  readonly lift?: number;
  /** Horizontal scale relative to the height. */
  readonly widen?: number;
  /** Vertical squash, for the melting and the sinking. */
  readonly squash?: number;
  /** Display-colour multiplier on top of the haze tint. */
  readonly colour?: number;
}

/** What a layout may ask of the field it is filling. */
interface Placer {
  readonly length: number;
  readonly size: number;
  count(n: number): number;
  rand(key: number, salt?: number): number;
  /**
   * A random spot on either verge, `near`..`far` metres beyond the setback. Each
   * `attempt` is a fresh draw for the same key, for a layout that has to look again.
   */
  spot(key: number, near: number, far: number, attempt?: number): Spot;
  /** A spot `along` metres into the encounter, `lateral` metres beyond the setback on `side`. */
  verge(along: number, side: number, lateral: number): Spot;
  /** A spot moved `along` the road and `away` from it, following its curve. */
  offset(spot: Spot, along: number, away: number): Spot;
  /**
   * A spot moved `along` the road's direction AT `spot` and `away` from the road, in
   * straight lines: a rigid frame for a board or a row that must not bend with a curve.
   */
  frame(spot: Spot, along: number, away: number): Spot;
  /** Yaw that turns a form's -Z face toward the road. */
  facing(spot: Spot): number;
  /** Yaw of the road's own direction at a spot: it turns a form's +Z along the road. */
  heading(spot: Spot): number;
  /** A form's own bounds at one unit tall: how far it reaches, for spacing a row. */
  extent(form: number): THREE.Box3;
  /**
   * Stands a form, or refuses to: false when it would enter anything already standing
   * (touching is fine) or its buffer is full, and then nothing was placed.
   */
  put(form: number, spot: Spot, height: number, yaw: number, options?: PutOptions): boolean;
  /**
   * Up to `tries` attempts at a group that must stand whole: `lay` places it and says
   * whether every part that matters went down; when it did not, all it placed is taken
   * up again and the next attempt starts clean.
   */
  whole(tries: number, lay: (attempt: number) => boolean): boolean;
}

interface NoveltySpec {
  readonly forms: readonly (() => THREE.BufferGeometry)[];
  /** Instances each form may hold. */
  readonly capacity: number;
  /** Near-white haze tint in display space; it multiplies the baked palette. */
  readonly tint: number;
  readonly layout: (p: Placer) => void;
}

const PASTELS = [0xffc4d4, 0xc4f0dc, 0xc8dcff, 0xfff0b0, 0xe4d0ff];

/** Fresh spots a lone form is offered before its slot is left empty. */
const SINGLE_TRIES = 6;
/** Fresh spots a whole group (a board, a row, a snake) is offered. */
const GROUP_TRIES = 5;

/** A lone form: a spot for `key`, and another each time the last was taken. */
function single(p: Placer, key: number, near: number, far: number, place: (at: Spot) => boolean): boolean {
  return p.whole(SINGLE_TRIES, (attempt) => place(p.spot(key, near, far, attempt)));
}

/** Furthest a form reaches from its own axis in the ground plane, in its heights. */
function reach(p: Placer, form: number): number {
  const box = p.extent(form);
  return Math.max(-box.min.x, box.max.x, -box.min.z, box.max.z);
}

/**
 * Three games left out on the sand, as FEN ranks from the eighth down to the first
 * (upper case white): a full Italian middlegame, a Sicilian a pawn each lighter, and a
 * rook ending with most of the set already taken.
 */
const CHESS_POSITIONS: readonly (readonly string[])[] = [
  ['r.bq.rk.', 'ppp..ppp', '..np.n..', '..b.p...', '..B.P...', '..PP.N..', 'PP...PPP', 'RNBQ.RK.'],
  ['r..qkb.r', '.p.bpppp', 'p.np.n..', '........', '...NP...', '..N.BP..', 'PPPQ..PP', '..KR.B.R'],
  ['.....rk.', 'p....ppp', '.p......', '........', '..P.....', '......P.', 'P....PKP', '...R....'],
];
/** FEN letter to form: pawn, rook, knight, bishop, queen, king. */
const CHESS_LETTERS = 'prnbqk';
/** A side's full set, in form order. */
const CHESS_SET = [8, 2, 2, 2, 1, 1] as const;
const CHESS_WHITE = 0xffffff;
const CHESS_BLACK = 0x4a4038;

const SPECS: Readonly<Record<NoveltyKind, NoveltySpec>> = {
  bowling: {
    forms: [bowlingPin, bowlingBall],
    capacity: 160,
    tint: 0xfff4e8,
    layout: (p) => {
      for (let c = 0; c < p.count(9); c++) {
        const h = (7 + p.rand(c, 1) * 7) * p.size;
        const spacing = 0.55 * h;
        p.whole(GROUP_TRIES, (attempt) => {
          const centre = p.spot(c, 25, 170, attempt);
          const yaw = p.heading(centre);
          const knocked: number[] = [];
          for (let row = 0; row < 4; row++) {
            for (let i = 0; i <= row; i++) {
              const key = c * 16 + row * 4 + i;
              // A knocked pin is missing from the rack and lies clear of it below.
              if (p.rand(key, 2) < 0.2) knocked.push(key);
              else if (!p.put(0, p.frame(centre, (i - row / 2) * spacing, row * spacing * 0.87), h, yaw)) return false;
            }
          }
          knocked.forEach((key, k) => {
            const at = p.frame(centre, (p.rand(key, 4) - 0.5) * 5 * spacing, (4 + k * 0.9 + p.rand(key, 5)) * spacing);
            p.put(0, at, h, p.rand(key, 3) * Math.PI * 2, { pitch: Math.PI / 2, lift: reach(p, 0) * h });
          });
          if (p.rand(c, 4) < 0.7) p.put(1, p.frame(centre, (p.rand(c, 5) - 0.5) * h, -2.2 * h), 0.55 * h, p.rand(c, 6) * Math.PI);
          return true;
        });
      }
    },
  },
  chess: {
    forms: [chessPawn, chessRook, chessKnight, chessBishop, chessQueen, chessKing, chessBoard],
    capacity: 112,
    tint: 0xfff6ea,
    layout: (p) => {
      for (let board = 0; board < p.count(3); board++) {
        const q = (2.8 + p.rand(board, 1) * 1.2) * p.size;
        const king = 1.7 * q;
        const width = (8 * q) / (1 - 2 * BOARD_BORDER);
        const position = CHESS_POSITIONS[Math.floor(p.rand(board, 2) * CHESS_POSITIONS.length)]!;
        p.whole(GROUP_TRIES, (attempt) => {
          const centre = p.spot(board, 40, 130, attempt);
          const yaw = p.heading(centre);
          // Level, not draped over the dune: its top a little above the highest corner's
          // sand and its frame run down into the lowest, as a board pushed into sand is.
          let low = Infinity;
          let high = -Infinity;
          for (const [a, w] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]] as const) {
            const y = p.frame(centre, (a * width) / 2, (w * width) / 2).y;
            low = Math.min(low, y);
            high = Math.max(high, y);
          }
          const top = high + 0.12 * q;
          const bottom = low - 0.1 * q;
          if (!p.put(6, centre, top - bottom, yaw, { widen: width / (top - bottom), lift: bottom - centre.y })) return false;
          const standing = [0, 0, 0, 0, 0, 0];
          const standingBlack = [0, 0, 0, 0, 0, 0];
          position.forEach((rank, r) => {
            for (let f = 0; f < 8; f++) {
              const letter = rank[f]!;
              const form = CHESS_LETTERS.indexOf(letter.toLowerCase());
              if (form < 0) continue;
              const white = letter !== letter.toLowerCase();
              (white ? standing : standingBlack)[form]!++;
              const at = p.frame(centre, (3.5 - r) * q, (f - 3.5) * q);
              const turn = (p.rand(board * 64 + r * 8 + f, 3) - 0.5) * 0.3;
              p.put(form, at, CHESS_TOP[form]! * king, yaw + (white ? 0 : Math.PI) + turn, { lift: top - at.y, colour: white ? CHESS_WHITE : CHESS_BLACK });
            }
          });
          // What has been taken stands in a row on the far side of the board.
          let slot = 0;
          for (const [counts, colour] of [[standing, CHESS_WHITE], [standingBlack, CHESS_BLACK]] as const) {
            CHESS_SET.forEach((full, form) => {
              for (let k = counts[form]!; k < full; k++, slot++) {
                const at = p.frame(centre, -width / 2 + (0.7 + slot * 0.95) * q, width / 2 + 0.9 * q);
                const h = CHESS_TOP[form]! * king;
                const fallen = p.rand(board * 64 + slot, 4) < 0.25;
                if (fallen && p.put(form, at, h, yaw + Math.PI / 2, { pitch: Math.PI / 2, lift: (CHESS_FOOT[form]! / CHESS_TOP[form]!) * h, colour })) continue;
                p.put(form, at, h, yaw + (p.rand(board * 64 + slot, 5) - 0.5), { colour });
              }
            });
          }
          return true;
        });
      }
      // A few giant pieces wandered off on their own.
      for (let k = 0; k < p.count(6); k++) {
        const q = (2.8 + p.rand(100 + k, 7) * 1.2) * p.size;
        const form = Math.min(5, Math.floor(p.rand(100 + k, 8) * 6));
        const colour = k % 2 ? CHESS_BLACK : CHESS_WHITE;
        const h = CHESS_TOP[form]! * 1.7 * q;
        const fallen = p.rand(100 + k, 9) < 0.4;
        const yaw = p.rand(100 + k, 10) * Math.PI * 2;
        single(p, 100 + k, 20, 170, (at) =>
          p.put(form, at, h, yaw, fallen ? { pitch: Math.PI / 2, lift: (CHESS_FOOT[form]! / CHESS_TOP[form]!) * h, colour } : { colour }),
        );
      }
    },
  },
  ducks: {
    forms: [rubberDuck],
    capacity: 96,
    tint: 0xfff6e0,
    layout: (p) => {
      const box = p.extent(0);
      for (let k = 0; k < p.count(24); k++) {
        const h = (4 + p.rand(k, 1) * 8) * p.size;
        const brood = p.rand(k, 4) <= 0.2;
        p.whole(SINGLE_TRIES, (attempt) => {
          const at = p.spot(k, 12, 175, attempt);
          // The form's beak is +X, which heading - PI/2 turns down the road. A mother
          // leading ducklings faces the way they go; a lone duck either way.
          const ahead = p.heading(at) - Math.PI / 2;
          const turn = brood ? (p.rand(k, 6) - 0.5) * 0.2 : (p.rand(k, 2) < 0.5 ? 0 : Math.PI) + (p.rand(k, 6) - 0.5) * 1.2;
          if (!p.put(0, at, h, ahead + turn, { roll: (p.rand(k, 3) - 0.5) * 0.2 })) return false;
          if (!brood) return true;
          // Ducklings in single file behind her, each a stride clear of the one ahead.
          let behind = -box.min.x * h;
          for (let d = 1; d <= 4; d++) {
            const size = h * 0.45;
            behind += 0.1 * h + box.max.x * size;
            p.put(0, p.frame(at, -behind, 0), size, ahead + (p.rand(k * 8 + d, 5) - 0.5) * 0.4);
            behind += -box.min.x * size;
          }
          return true;
        });
      }
    },
  },
  teapots: {
    forms: [teapot, teacup],
    capacity: 64,
    tint: 0xfff8f0,
    layout: (p) => {
      for (let c = 0; c < p.count(9); c++) {
        const h = (8 + p.rand(c, 1) * 6) * p.size;
        const colour = PASTELS[c % PASTELS.length]!;
        // The cups stand round the pot on a ring that clears both, whichever way either faces.
        const ring = reach(p, 0) * h + reach(p, 1) * h * 0.42 + 0.15 * h;
        p.whole(SINGLE_TRIES, (attempt) => {
          const centre = p.spot(c, 25, 150, attempt);
          if (!p.put(0, centre, h, p.rand(c, 2) * Math.PI * 2, { colour })) return false;
          const cups = 2 + Math.floor(p.rand(c, 3) * 3);
          for (let k = 0; k < cups; k++) {
            const a = (k / cups) * Math.PI * 2 + p.rand(c, 4);
            p.put(1, p.frame(centre, Math.cos(a) * ring, Math.sin(a) * ring), h * 0.42, p.rand(c * 8 + k, 5) * Math.PI * 2, { colour });
          }
          return true;
        });
      }
    },
  },
  parasols: {
    forms: [parasol([0xe8463a, 0xfaf6ec]), parasol([0x3a78d0, 0xfaf6ec]), parasol([0xf6c43a, 0x2fb3b0])],
    capacity: 64,
    tint: 0xfff6ea,
    layout: (p) => {
      const canopy = reach(p, 0);
      for (let c = 0; c < p.count(12); c++) {
        const n = 3 + Math.floor(p.rand(c, 1) * 4);
        p.whole(GROUP_TRIES, (attempt) => {
          const centre = p.spot(c, 15, 150, attempt);
          // A row down the beach, each canopy clear of the last whatever their sizes.
          let along = 0;
          let previous = 0;
          for (let k = 0; k < n; k++) {
            const key = c * 8 + k;
            const h = (6 + p.rand(key, 2) * 5) * p.size;
            along += k === 0 ? 0 : previous + canopy * h + 0.1 * h;
            previous = canopy * h;
            const placed = p.put(Math.floor(p.rand(key, 4) * 3), p.frame(centre, along, (p.rand(key, 3) - 0.5) * h), h, p.rand(key, 5) * Math.PI * 2, {
              pitch: (p.rand(key, 6) - 0.5) * 0.3,
              roll: (p.rand(key, 7) - 0.5) * 0.3,
            });
            if (k === 0 && !placed) return false;
          }
          return true;
        });
      }
    },
  },
  icecream: {
    forms: [iceCream([0xf6a8c0]), iceCream([0xb0e6c8, 0xfaeecd]), iceCream([0x8a5a3a, 0xf6a8c0, 0xfaeecd])],
    capacity: 64,
    tint: 0xfff6ee,
    layout: (p) => {
      for (let k = 0; k < p.count(26); k++) {
        const h = (6 + p.rand(k, 1) * 10) * p.size;
        single(p, k, 14, 165, (at) =>
          p.put(Math.floor(p.rand(k, 2) * 3), at, h, p.rand(k, 3) * Math.PI * 2, { pitch: (p.rand(k, 4) - 0.5) * 0.35, roll: (p.rand(k, 5) - 0.5) * 0.35, lift: -0.04 * h }),
        );
      }
    },
  },
  lighthouses: {
    forms: [lighthouse],
    capacity: 24,
    tint: 0xfff4ea,
    layout: (p) => {
      for (let k = 0; k < p.count(9); k++) {
        const h = (22 + p.rand(k, 1) * 18) * p.size;
        single(p, k, 50, 220, (at) => p.put(0, at, h, p.facing(at) + (p.rand(k, 2) - 0.5)));
      }
    },
  },
  windmills: {
    forms: [dutchWindmill],
    capacity: 32,
    tint: 0xfff4e6,
    layout: (p) => {
      for (let k = 0; k < p.count(12); k++) {
        const h = (12 + p.rand(k, 1) * 8) * p.size;
        single(p, k, 40, 200, (at) => p.put(0, at, h, p.facing(at) + (p.rand(k, 2) - 0.5)));
      }
    },
  },
  dice: {
    forms: [die(0xfaf7f0, 0x1f1d1c), die(0xe0463a, 0xfaf7f0)],
    capacity: 64,
    tint: 0xfff6ee,
    layout: (p) => {
      for (let t = 0; t < p.count(16); t++) {
        const h = (5 + p.rand(t, 1) * 5) * p.size;
        if (p.rand(t, 2) < 0.2) {
          // One the size of a house, come down on an edge and half into the sand.
          const big = h * 1.5;
          single(p, t, 20, 170, (at) => p.put(p.rand(t, 3) < 0.7 ? 0 : 1, at, big, p.rand(t, 4) * Math.PI * 2, { roll: Math.PI / 4, lift: -0.2 * big }));
          continue;
        }
        // A throw: two dice, now and then three, each come to rest on a face of its own.
        const n = p.rand(t, 5) < 0.25 ? 3 : 2;
        p.whole(GROUP_TRIES, (attempt) => {
          const at = p.spot(t, 14, 170, attempt);
          for (let k = 0; k < n; k++) {
            const key = t * 4 + k;
            const a = p.rand(key, 16 + attempt) * Math.PI * 2;
            const r = k === 0 ? 0 : (1.3 + p.rand(key, 24 + attempt) * 1.1) * h;
            const rest = DIE_REST[Math.floor(p.rand(key, 6) * DIE_REST.length)]!;
            const form = (t + k) % 3 === 2 ? 1 : 0;
            if (!p.put(form, p.frame(at, Math.cos(a) * r, Math.sin(a) * r), h, p.rand(key, 7) * Math.PI * 2, { pitch: rest.pitch, roll: rest.roll, lift: rest.lift * h })) return false;
          }
          return true;
        });
      }
    },
  },
  cones: {
    forms: [trafficCone],
    capacity: 256,
    tint: 0xfff4ea,
    layout: (p) => {
      // Roadworks for a road nobody is building: rows of cones along both verges.
      for (let row = 0; row < 4; row++) {
        const side = row % 2 === 0 ? -1 : 1;
        const lateral = 22 + (row >> 1) * 16;
        const h = (5 + (row >> 1) * 1.5) * p.size;
        const spacing = 10 * p.size;
        const n = Math.min(60, Math.floor((p.length - 40) / spacing));
        for (let k = 0; k < n; k++) {
          const at = p.verge(20 + k * spacing, side, lateral);
          const key = row * 128 + k;
          const knocked = p.rand(key, 1) < 0.14 && p.put(0, at, h, p.rand(key, 2) * Math.PI * 2, { pitch: 1.35, lift: 0.18 * h });
          if (!knocked) p.put(0, at, h, p.rand(key, 3) * Math.PI);
        }
      }
    },
  },
  snowmen: {
    forms: [snowman],
    capacity: 48,
    tint: 0xf4f8ff,
    layout: (p) => {
      for (let k = 0; k < p.count(22); k++) {
        const h = (6 + p.rand(k, 1) * 6) * p.size;
        const melting = p.rand(k, 2) < 0.3;
        single(p, k, 14, 165, (at) =>
          p.put(0, at, h, p.facing(at) + (p.rand(k, 3) - 0.5) * 0.8, melting ? { squash: 0.7, roll: (p.rand(k, 4) - 0.5) * 0.3, widen: 1.15 } : {}),
        );
      }
    },
  },
  balloons: {
    forms: [balloon([0xe8463a, 0xf6c43a]), balloon([0x3a78d0, 0xfaf6ec]), balloon([0x3aa06a, 0xf28a3a])],
    capacity: 48,
    tint: 0xfff6ee,
    layout: (p) => {
      for (let k = 0; k < p.count(16); k++) {
        const h = (14 + p.rand(k, 1) * 10) * p.size;
        single(p, k, 20, 200, (at) =>
          p.put(Math.floor(p.rand(k, 2) * 3), at, h, p.rand(k, 3) * Math.PI * 2, { lift: (12 + p.rand(k, 4) * 48) * p.size, roll: (p.rand(k, 5) - 0.5) * 0.12 }),
        );
      }
    },
  },
  matryoshkas: {
    forms: [
      matryoshka(0xd8322a, 0xf6c43a, 'whole'),
      matryoshka(0x2f5fa8, 0xe8463a, 'whole'),
      matryoshka(0xd8322a, 0xf6c43a, 'bottom'),
      matryoshka(0x2f5fa8, 0xe8463a, 'bottom'),
      matryoshka(0xd8322a, 0xf6c43a, 'top'),
      matryoshka(0x2f5fa8, 0xe8463a, 'top'),
    ],
    capacity: 48,
    tint: 0xfff4ea,
    layout: (p) => {
      for (let set = 0; set < p.count(10); set++) {
        const colourway = set % 2;
        const n = 5 + Math.floor(p.rand(set, 2) * 2);
        const first = (12 + p.rand(set, 1) * 6) * p.size;
        // Some sets have been opened: the eldest stands in two halves, her lid on its side.
        const opened = p.rand(set, 3) < 0.4;
        p.whole(GROUP_TRIES, (attempt) => {
          const start = p.spot(set, 16, 110, attempt);
          const yaw = p.facing(start);
          let h = first;
          let along = 0;
          for (let k = 0; k < n; k++) {
            const radius = DOLL_RADIUS * h;
            if (k > 0) along += radius + 0.12 * first;
            const at = p.frame(start, along, 0);
            if (k === 0 && opened) {
              if (!p.put(2 + colourway, at, h * DOLL_CUT, yaw)) return false;
              const lid = h * (1 - DOLL_CUT);
              // On its side behind the base, crown away from the road so the bare wood of
              // its open face is what the road sees.
              if (!p.put(4 + colourway, p.frame(start, 0, radius + 0.15 * first), lid, yaw, { pitch: Math.PI / 2, lift: DOLL_LID_RADIUS * lid })) return false;
            } else if (!p.put(colourway, at, h, yaw)) {
              return false;
            }
            along += radius;
            h *= 0.8;
          }
          return true;
        });
      }
    },
  },
  rockets: {
    forms: [rocket(0xfaf7f0, 0xe0463a), rocket(0xc8ccd2, 0x2fb3b0)],
    capacity: 32,
    tint: 0xfff4ea,
    layout: (p) => {
      for (let k = 0; k < p.count(12); k++) {
        const h = (14 + p.rand(k, 1) * 12) * p.size;
        const form = p.rand(k, 2) < 0.6 ? 0 : 1;
        const yaw = p.rand(k, 4) * Math.PI * 2;
        // Now and then one came down nose first.
        const crashed = p.rand(k, 3) < 0.15;
        single(p, k, 30, 190, (at) =>
          p.put(form, at, h, yaw, crashed ? { pitch: Math.PI + (p.rand(k, 5) - 0.5) * 0.5, lift: 0.85 * h } : {}),
        );
      }
    },
  },
  mushrooms: {
    forms: [mushroom(0xe0322a, true, 1), mushroom(0x9a6238, false, 1.6)],
    capacity: 96,
    tint: 0xfff6ee,
    layout: (p) => {
      for (let c = 0; c < p.count(12); c++) {
        const n = 3 + Math.floor(p.rand(c, 1) * 5);
        const form = p.rand(c, 2) < 0.7 ? 0 : 1;
        p.whole(GROUP_TRIES, (attempt) => {
          const centre = p.spot(c, 14, 160, attempt);
          for (let k = 0; k < n; k++) {
            const key = c * 8 + k;
            const h = (3 + p.rand(key, 3) * 9) * p.size;
            // A mushroom that would grow into its neighbour comes up elsewhere in the ring.
            let placed = false;
            for (let look = 0; look < 4 && !placed; look++) {
              const a = p.rand(key, 16 + look * 4) * Math.PI * 2;
              const r = p.rand(key, 17 + look * 4) * 14 * p.size;
              placed = p.put(form, p.frame(centre, Math.cos(a) * r, Math.sin(a) * r), h, p.rand(key, 6) * Math.PI * 2, { roll: (p.rand(key, 7) - 0.5) * 0.25 });
            }
            if (k === 0 && !placed) return false;
          }
          return true;
        });
      }
    },
  },
  moai: {
    forms: [moai(false), moai(true)],
    capacity: 48,
    tint: 0xfff2e6,
    layout: (p) => {
      for (let row = 0; row < p.count(8); row++) {
        const n = 5 + Math.floor(p.rand(row, 1) * 3);
        const h = (10 + p.rand(row, 2) * 5) * p.size;
        p.whole(GROUP_TRIES, (attempt) => {
          const start = p.spot(row, 25, 110, attempt);
          const yaw = p.facing(start);
          for (let k = 0; k < n; k++) {
            const placed = p.put(p.rand(row * 8 + k, 3) < 0.3 ? 1 : 0, p.frame(start, k * h * 0.62, 0), h * (0.9 + p.rand(row * 8 + k, 4) * 0.2), yaw, { lift: -0.12 * h });
            if (k === 0 && !placed) return false;
          }
          return true;
        });
      }
    },
  },
  pencils: {
    forms: [pencil(0xf6c43a), pencil(0xe0463a), pencil(0x3a78d0)],
    capacity: 64,
    tint: 0xfff6ee,
    layout: (p) => {
      for (let k = 0; k < p.count(30); k++) {
        const h = (10 + p.rand(k, 1) * 14) * p.size;
        const form = Math.floor(p.rand(k, 2) * 3);
        const yaw = p.rand(k, 4) * Math.PI * 2;
        const lying = p.rand(k, 3) < 0.2;
        single(p, k, 14, 170, (at) =>
          p.put(form, at, h, yaw, lying ? { pitch: Math.PI / 2, lift: 0.06 * h } : { pitch: (p.rand(k, 5) - 0.5) * 0.5, roll: (p.rand(k, 6) - 0.5) * 0.5, lift: -0.08 * h }),
        );
      }
    },
  },
  dominoes: {
    forms: [domino(3, 5), domino(6, 2)],
    capacity: 160,
    tint: 0xfff6ee,
    layout: (p) => {
      for (let snake = 0; snake < p.count(6); snake++) {
        const h = (8 + p.rand(snake, 1) * 4) * p.size;
        const n = 30 + Math.floor(p.rand(snake, 2) * 20);
        const falling = 8 + Math.floor(p.rand(snake, 3) * 6);
        const spacing = 0.55 * h;
        const wiggle = (2 + p.rand(snake, 4) * 3) * h;
        // A snake stands whole or not at all: one crossing another is two snakes in a heap.
        p.whole(GROUP_TRIES, (attempt) => {
          const start = p.spot(snake, 14, 70, attempt);
          for (let k = 0; k < n; k++) {
            const along = k * spacing;
            const away = Math.sin(along / wiggle) * h * 1.5;
            const slope = (Math.cos(along / wiggle) * (h * 1.5)) / wiggle;
            const at = p.offset(start, along, away);
            const fallen = k - (n - falling);
            const tilt = fallen < 0 ? 0 : Math.min(1.38, 0.2 + fallen * 0.16);
            const yaw = p.heading(at) + Math.atan(slope) * start.side;
            if (!p.put(k % 2, at, h, yaw, { pitch: tilt })) return false;
          }
          return true;
        });
      }
    },
  },
  flamingos: {
    forms: [flamingo],
    capacity: 96,
    tint: 0xfff4f4,
    layout: (p) => {
      for (let flock = 0; flock < p.count(6); flock++) {
        const n = 6 + Math.floor(p.rand(flock, 1) * 9);
        p.whole(GROUP_TRIES, (attempt) => {
          const centre = p.spot(flock, 18, 150, attempt);
          for (let k = 0; k < n; k++) {
            const key = flock * 16 + k;
            const h = (6 + p.rand(key, 2) * 6) * p.size;
            // A bird that would stand in another steps somewhere else in the flock.
            let placed = false;
            for (let look = 0; look < 4 && !placed; look++) {
              const a = p.rand(key, 16 + look * 4) * Math.PI * 2;
              const r = Math.sqrt(p.rand(key, 17 + look * 4)) * 22 * p.size;
              placed = p.put(0, p.frame(centre, Math.cos(a) * r, Math.sin(a) * r), h, p.rand(key, 5) * Math.PI * 2);
            }
            if (k === 0 && !placed) return false;
          }
          return true;
        });
      }
    },
  },
  gnomes: {
    forms: [gnome],
    capacity: 64,
    tint: 0xfff6ee,
    layout: (p) => {
      for (let c = 0; c < p.count(12); c++) {
        const n = 2 + Math.floor(p.rand(c, 1) * 4);
        p.whole(GROUP_TRIES, (attempt) => {
          const centre = p.spot(c, 14, 150, attempt);
          for (let k = 0; k < n; k++) {
            const key = c * 8 + k;
            const h = (4 + p.rand(key, 2) * 5) * p.size;
            const at = p.frame(centre, (k - n / 2) * h * 0.9, (p.rand(key, 3) - 0.5) * h);
            const placed = p.put(0, at, h, p.facing(at) + (p.rand(key, 4) - 0.5) * 1.2);
            if (k === 0 && !placed) return false;
          }
          return true;
        });
      }
    },
  },
};

const _paint = new THREE.Color();
/** White (no tint), for the anchor's pre-created instance colour. */
const _anchorWhite = new THREE.Color(1, 1, 1);

function novelMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.FrontSide,
    transparent: true,
    opacity: 0,
    depthWrite: true,
    fog: true,
    toneMapped: true,
  });
}

/**
 * The instanced meshes of the odd tableaus. A kind's meshes are built the first time
 * it is shown and kept for the session; only the active kind has any instances.
 *
 * Nothing it stands enters anything else it stands: every `put` is tested as an
 * oriented box against all the boxes already down (`BoxOccupancy`) and refused when
 * it would go in, so a layout either finds room or leaves the slot empty.
 */
export class NoveltyField implements Placer {
  readonly group = new THREE.Group();
  readonly material = novelMaterial();
  private readonly built = new Map<NoveltyKind, { readonly meshes: THREE.InstancedMesh[]; readonly bounds: THREE.Box3[] }>();
  private active: THREE.InstancedMesh[] = [];
  private bounds: THREE.Box3[] = [];
  private used: number[] = [];
  private readonly room = new BoxOccupancy();
  private readonly tint = new THREE.Color();

  private encounterIndex = 0;
  private startS = 0;
  length = 0;
  size = 1;
  private density = 1;
  private setback = 0;
  private anchorX = 0;
  private anchorY = 0;
  private anchorZ = 0;

  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly boxCentre = new THREE.Vector3();
  private readonly boxHalf = new THREE.Vector3();
  private readonly colour = new THREE.Color();
  private readonly point = { x: 0, y: 0, z: 0 };

  constructor(
    private readonly road: Road,
    private readonly terrain: Terrain,
    private readonly seed: number,
  ) {
    // A kind's meshes are built on its first encounter, so nothing of `material` is in
    // the scene at boot and its instanced+instanceColor program would first compile
    // mid-drive. One invisible, empty InstancedMesh holds it from boot; every form is
    // built by `solid`, so they all share one attribute layout and therefore one program.
    const anchor = new THREE.InstancedMesh(SPECS[NOVELTY_KINDS[0]].forms[0]!(), this.material, 1);
    anchor.count = 0;
    anchor.visible = false;
    anchor.setColorAt(0, _anchorWhite);
    this.group.add(anchor);
  }

  clear(): void {
    for (const mesh of this.active) {
      mesh.count = 0;
      mesh.visible = false;
    }
    this.active = [];
    this.bounds = [];
    this.room.clear();
  }

  build(
    kind: NoveltyKind,
    encounter: { readonly index: number; readonly startS: number; readonly length: number },
    anchor: { readonly x: number; readonly y: number; readonly z: number },
    density: number,
    size: number,
    setback: number,
  ): void {
    this.clear();
    const spec = SPECS[kind];
    let entry = this.built.get(kind);
    if (!entry) {
      const meshes = spec.forms.map((form) => {
        const mesh = new THREE.InstancedMesh(form(), this.material, spec.capacity);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.count = 0;
        mesh.visible = false;
        this.group.add(mesh);
        return mesh;
      });
      const bounds = meshes.map((mesh) => {
        mesh.geometry.computeBoundingBox();
        return mesh.geometry.boundingBox!.clone();
      });
      entry = { meshes, bounds };
      this.built.set(kind, entry);
    }
    this.active = entry.meshes;
    this.bounds = entry.bounds;
    this.used = entry.meshes.map(() => 0);
    this.tint.setHex(spec.tint, THREE.LinearSRGBColorSpace);
    this.encounterIndex = encounter.index;
    this.startS = encounter.startS;
    this.length = encounter.length;
    this.density = density;
    this.size = size * NOVELTY_SCALE;
    this.setback = setback;
    this.anchorX = anchor.x;
    this.anchorY = anchor.y;
    this.anchorZ = anchor.z;
    spec.layout(this);
    entry.meshes.forEach((mesh, form) => {
      mesh.count = this.used[form]!;
      mesh.visible = mesh.count > 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
  }

  // ---- Placer ------------------------------------------------------------------

  count(n: number): number {
    return Math.max(1, Math.round(n * this.density));
  }

  rand(key: number, salt = 0): number {
    return hashUnit3(this.seed, this.encounterIndex * 8192 + key, SALT_SHAPE + salt);
  }

  spot(key: number, near: number, far: number, attempt = 0): Spot {
    const salt = SALT_SPOT + attempt * 8;
    const along = hashUnit3(this.seed, this.encounterIndex * 8192 + key, salt);
    const s = this.startS + 20 + along * Math.max(0, this.length - 40);
    const side = hashUnit3(this.seed, this.encounterIndex * 8192 + key, salt + 1) < 0.5 ? -1 : 1;
    const depth = hashUnit3(this.seed, this.encounterIndex * 8192 + key, salt + 2);
    return this.at(s, side * (this.setback + near + depth * depth * (far - near)), side, depth);
  }

  verge(along: number, side: number, lateral: number): Spot {
    return this.at(this.startS + along, side * (this.setback + lateral), side, Math.min(1, lateral / 200));
  }

  offset(spot: Spot, along: number, away: number): Spot {
    const lateral = spot.lateral + away * spot.side;
    return this.at(spot.s + along, lateral, spot.side, spot.depth);
  }

  frame(spot: Spot, along: number, away: number): Spot {
    // The road's own basis at the spot (see `Road.offsetPoint`): forward is
    // (sin h, cos h) and positive lateral is (cos h, -sin h).
    const heading = this.road.sampleAt(spot.s).heading;
    const lateral = away * spot.side;
    const x = spot.x + Math.sin(heading) * along + Math.cos(heading) * lateral;
    const z = spot.z + Math.cos(heading) * along - Math.sin(heading) * lateral;
    const projection = this.road.project(x, z, spot.s);
    const s = Math.min(this.road.length, Math.max(0, projection.s));
    // Swung back over the verge, it is pushed out to it like any other spot.
    if (spot.side * projection.lateral < this.setback + VERGE_M) return this.at(s, projection.lateral, spot.side, spot.depth);
    return { x, y: this.terrain.heightAt(x, z, s), z, s, lateral: projection.lateral, side: spot.side, depth: spot.depth };
  }

  facing(spot: Spot): number {
    const centre = this.road.sampleAt(spot.s);
    return Math.atan2(-(centre.x - spot.x), -(centre.z - spot.z));
  }

  heading(spot: Spot): number {
    return this.road.sampleAt(spot.s).heading;
  }

  extent(form: number): THREE.Box3 {
    return this.bounds[form]!;
  }

  put(form: number, spot: Spot, height: number, yaw: number, options: PutOptions = {}): boolean {
    const mesh = this.active[form];
    const bounds = this.bounds[form];
    const slot = this.used[form];
    if (!mesh || !bounds || slot === undefined || slot >= mesh.instanceMatrix.count) return false;
    const width = height * (options.widen ?? 1);
    this.position.set(spot.x - this.anchorX, spot.y + (options.lift ?? 0) - this.anchorY, spot.z - this.anchorZ);
    this.euler.set(options.pitch ?? 0, yaw, options.roll ?? 0, 'YXZ');
    this.quaternion.setFromEuler(this.euler);
    this.scale.set(width, height * (options.squash ?? 1), width);
    this.matrix.compose(this.position, this.quaternion, this.scale);
    bounds.getCenter(this.boxCentre);
    bounds.getSize(this.boxHalf).multiplyScalar(0.5);
    if (!this.room.tryAdd(this.matrix, this.boxCentre, this.boxHalf)) return false;
    this.used[form] = slot + 1;
    mesh.setMatrixAt(slot, this.matrix);
    // Far rows lifted toward the haze, as the groves are; the per-instance colour
    // multiplies the baked palette, so it stays near white unless a layout paints.
    const lift = (0.9 + spot.depth * 0.3) * (0.94 + hashUnit3(this.seed, this.encounterIndex * 8192 + form * 1024 + slot, SALT_COLOUR) * 0.12);
    this.colour.copy(this.tint).multiplyScalar(lift);
    if (options.colour !== undefined) this.colour.multiply(_paint.setHex(options.colour, THREE.LinearSRGBColorSpace));
    mesh.setColorAt(slot, this.colour);
    return true;
  }

  whole(tries: number, lay: (attempt: number) => boolean): boolean {
    for (let attempt = 0; attempt < tries; attempt++) {
      const used = this.used.slice();
      const boxes = this.room.count;
      if (lay(attempt)) return true;
      this.used = used;
      this.room.count = boxes;
    }
    return false;
  }

  private at(s: number, lateral: number, side: number, depth: number): Spot {
    const clamped = Math.min(this.road.length, Math.max(0, s));
    // A cluster laid out round a spot may reach back toward the road; nothing lands on it.
    const safe = side * Math.max(side * lateral, this.setback + VERGE_M);
    this.road.offsetPoint(clamped, safe, this.point);
    const y = this.terrain.heightAt(this.point.x, this.point.z, clamped);
    return { x: this.point.x, y, z: this.point.z, s: clamped, lateral: safe, side, depth };
  }
}
