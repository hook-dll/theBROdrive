/**
 * The Japanese street-toilet catalogue (docs/toilet-poi-design.md). Ten of the planned
 * fifty so far: nine low-poly readings of THE TOKYO TOILET project in Shibuya and one of
 * the Tobe Zoo toilet in Ehime, each a service cabin (geometry.ts) inside one of the plan
 * families (families.ts). Ids are stable: saves key on them.
 *
 * The world does not place these yet; they stand in the POI gallery
 * (`?poi-gallery&type=toilet`) and go through the POI merge path like every kit variant
 * (world/poi-variants.ts).
 */

import type { ToiletSourceCard, ToiletVariant } from './types';

const ACCESSED = '2026-10-17';
const FACTS_ONLY = 'Facts only: no image, drawing or text is reproduced';

type Facts = Pick<ToiletSourceCard, 'silhouette' | 'plan' | 'fixtures' | 'palette'>;

/** The round-up all seventeen Tokyo Toilets were first read from. */
function roundup(facts: Facts): ToiletSourceCard {
  return {
    url: 'https://www.dezeen.com/2024/03/08/tokyo-toilets-wim-wenders-perfect-days/',
    title: "Explore all 17 Tokyo Toilet projects featured in Wim Wenders' film Perfect Days",
    author: 'Jane Englefield, Dezeen (photography Satoshi Nagare, courtesy The Nippon Foundation)',
    licence: FACTS_ONLY,
    accessed: ACCESSED,
    ...facts,
  };
}

/** A project page on THE TOKYO TOILET's own site: the creator's statement and the captions. */
function official(slug: string, place: string, facts: Facts): ToiletSourceCard {
  return {
    url: `https://tokyotoilet.jp/en/${slug}/`,
    title: `${place} - THE TOKYO TOILET`,
    author: 'THE TOKYO TOILET, The Nippon Foundation (photography Satoshi Nagare)',
    licence: FACTS_ONLY,
    accessed: ACCESSED,
    ...facts,
  };
}

export const TOILET_VARIANTS: readonly ToiletVariant[] = [
  {
    id: 'toilet-ban-fukamachi',
    name: 'Цветной павильон',
    note: 'Shigeru Ban · Yoyogi Fukamachi Mini Park · 2020',
    shell: {
      width: 2.6,
      depth: 2.4,
      height: 2.6,
      roof: 'flat',
      overhang: 0.12,
      wallPattern: 'plaster',
      palette: {
        walls: [0xe0782e, 0x7c4fa0, 0xe07fa8, 0xe8964a],
        trim: 0x2c2c2e,
        roof: 0xd8d4cc,
        plinth: 0x9a968c,
        floor: 0xb8b4aa,
        door: 0xe0782e,
        accent: 0x2c2c2e,
      },
      dressing: [],
      form: {
        family: 'row',
        rooms: [
          { side: 'left', width: 2.2, color: 0xe07fa8 },
          { side: 'right', width: 2.2, color: 0x7c4fa0 },
        ],
      },
    },
    bowl: 'washlet',
    fixtures: ['door', 'lid', 'flush', 'valve', 'plunger', 'floor-dirt'],
    face: { arrival: 'embarrassed', size: 0.15, brow: 0.2 },
    scenario: 'clogged-drain',
    sources: [
      roundup({
        silhouette: 'Rectilinear boxes of tinted glass that turn opaque when occupied; drawn as opaque tinted panels',
        plan: 'Three cubicles (male, female, accessible) in a row: the cabin and two sealed rooms either side',
        palette: 'Shades of orange, pink and purple',
      }),
      official('yoyogifukamachi_mini_park', 'Yoyogi Fukamachi Mini Park', {
        silhouette: 'Exterior glass that turns opaque when the door is locked; drawn in its opaque state',
        plan: 'A multipurpose toilet, a women’s and a men’s toilet',
      }),
    ],
  },
  {
    id: 'toilet-kuma-nabeshima',
    name: 'Кедровая деревня',
    note: 'Kengo Kuma · Nabeshima Shoto Park · 2021',
    shell: {
      width: 2.2,
      depth: 2.2,
      height: 2.5,
      roof: 'flat',
      overhang: 0.3,
      wallPattern: 'boards',
      palette: {
        walls: [0x8a6038, 0x8a6038, 0x8a6038, 0x8a6038],
        trim: 0x3a2a1c,
        roof: 0x4a4a46,
        plinth: 0x77746b,
        floor: 0x9c968a,
        door: 0x7a5232,
        accent: 0x6e4526,
      },
      dressing: ['louvres'],
      form: {
        family: 'cluster',
        huts: [
          { shape: 'box', x: -3.5, z: -0.6, yaw: 0.35, width: 2.0, depth: 2.0, height: 2.3, color: 0x7d5632 },
          { shape: 'box', x: 3.4, z: -0.2, yaw: -0.3, width: 2.2, depth: 1.8, height: 2.7, color: 0x94683e },
          { shape: 'box', x: -2.0, z: 3.0, yaw: 0.15, width: 1.8, depth: 1.8, height: 2.4, color: 0x86603a },
          { shape: 'box', x: 2.2, z: 3.4, yaw: -0.5, width: 2.0, depth: 2.2, height: 2.6, color: 0x8a6038 },
        ],
      },
    },
    bowl: 'washlet',
    fixtures: ['door', 'lid', 'flush', 'valve', 'plunger', 'floor-dirt'],
    face: { arrival: 'sleepy', size: 0.13, brow: 0.17 },
    scenario: 'clogged-drain',
    sources: [
      roundup({
        silhouette: 'Small cedar-clad huts',
        plan: 'Five huts joined by a stepped walkway: the cabin and four sealed huts at varied angles',
        palette: 'Cedar cladding',
      }),
      official('nabesima_park', 'Nabeshima Shoto Park', {
        silhouette: 'Five huts, each covered with cedar board louvres installed at random angles',
        plan: 'A toilet village of separate huts, each for a different need, joined by a walk in the woods',
        palette: 'Yoshino cedar louvres',
      }),
    ],
  },
  {
    id: 'toilet-nigo-jingumae',
    name: 'Домик',
    note: 'NIGO® · Jingumae · 2021',
    shell: {
      width: 2.6,
      depth: 2.4,
      height: 2.4,
      roof: 'gable',
      overhang: 0.25,
      wallPattern: 'boards',
      palette: {
        walls: [0xe8e4da, 0xe8e4da, 0xe8e4da, 0xe8e4da],
        trim: 0x2f5d9e,
        roof: 0xb03a2e,
        plinth: 0x8c8a84,
        floor: 0xa8a49a,
        door: 0x2f5d9e,
        accent: 0xf2f0ea,
      },
      dressing: ['house'],
      form: { family: 'cabin' },
    },
    bowl: 'washlet',
    fixtures: ['door', 'lid', 'flush', 'valve', 'plunger', 'floor-dirt'],
    face: { arrival: 'worried', size: 0.14, brow: 0.19 },
    scenario: 'clogged-drain',
    sources: [
      roundup({
        silhouette: 'Small house with a red pitched roof and three chimney-style elements',
        plan: 'Partly surrounded by a white picket fence',
        palette: 'Red roof, blue-framed windows',
      }),
    ],
  },
  {
    id: 'toilet-newson-urasando',
    name: 'Медная кровля',
    note: 'Marc Newson · Urasando · 2023',
    shell: {
      width: 2.4,
      depth: 2.4,
      height: 2.6,
      roof: 'pyramid',
      overhang: 0.45,
      wallPattern: 'blocks',
      palette: {
        walls: [0x9c9a94, 0x9c9a94, 0x9c9a94, 0x9c9a94],
        trim: 0x4a4844,
        roof: 0xb06a3c,
        plinth: 0x77746b,
        floor: 0xa29b89,
        door: 0x5a5852,
        accent: 0x8a5a34,
      },
      dressing: [],
      form: { family: 'cabin' },
    },
    bowl: 'washlet',
    fixtures: ['door', 'lid', 'flush', 'valve', 'plunger', 'floor-dirt'],
    face: { arrival: 'angry', size: 0.13, brow: 0.2 },
    scenario: 'clogged-drain',
    sources: [
      roundup({
        silhouette: 'Concrete block under a traditionally shaped copper roof, after temples and tea rooms',
        plan: 'The central accessible toilet of three, drawn alone',
        palette: 'Concrete and copper',
      }),
    ],
  },
  {
    id: 'toilet-wonderwall-ebisu',
    name: 'Современная кавая',
    note: 'Wonderwall / Masamichi Katayama · Ebisu Park · 2020',
    shell: {
      width: 2.2,
      depth: 2.4,
      height: 2.5,
      roof: 'flat',
      overhang: 0.2,
      wallPattern: 'boards',
      palette: {
        walls: [0x8f8b82, 0x8f8b82, 0x8f8b82, 0x8f8b82],
        trim: 0x55524c,
        roof: 0x7c7870,
        plinth: 0x6c6962,
        floor: 0x8a867c,
        door: 0x55524c,
        accent: 0x8f8b82,
      },
      dressing: ['privacy-walls'],
      form: { family: 'cabin' },
    },
    bowl: 'squat',
    fixtures: ['door', 'flush', 'valve', 'plunger', 'floor-dirt'],
    face: null,
    scenario: 'clogged-drain',
    sources: [
      roundup({
        silhouette: 'Board-marked concrete walls after the primitive kawaya huts once used as toilets',
        plan: 'A maze of fifteen walls encloses it; drawn as two screen walls before one cubicle',
        palette: 'Board-marked concrete',
      }),
    ],
  },
  {
    id: 'toilet-fujimoto-nishisando',
    name: 'Белый сосуд',
    note: 'Sou Fujimoto · Nishisando · 2023',
    shell: {
      width: 2.6,
      depth: 2.4,
      height: 2.6,
      roof: 'flat',
      overhang: 0.15,
      wallPattern: 'plaster',
      palette: {
        walls: [0xf2f0ec, 0xf2f0ec, 0xf2f0ec, 0xf2f0ec],
        trim: 0xbdb8ae,
        roof: 0xe8e5de,
        plinth: 0xb8b4aa,
        floor: 0xc9c5bb,
        door: 0xd8d4cc,
        accent: 0xe8e5de,
      },
      dressing: [],
      form: {
        family: 'vessel',
        radius: 3.5,
        sweep: 1.9,
        back: 3.5,
        tips: 4.3,
        flare: 0.12,
        thickness: 0.22,
        color: 0xf6f4f0,
        faucets: [0.55, 0.7, 0.85, 1.0, 0.75],
      },
    },
    bowl: 'washlet',
    fixtures: ['door', 'lid', 'flush', 'valve', 'plunger', 'floor-dirt'],
    face: { arrival: 'worried', size: 0.14, brow: 0.19 },
    scenario: 'clogged-drain',
    sources: [
      official('nishisando', 'Nishisando', {
        silhouette: 'One large vessel with a concave centre, its curves after the outline of a vessel',
        plan: 'The toilets stand beyond an archway; drawn as one cabin held in the vessel’s curve',
        fixtures: 'Five faucets at different heights, for children, adults and wheelchair users',
        palette: 'Pure white walls',
      }),
    ],
  },
  {
    id: 'toilet-kobayashi-sasazuka',
    name: 'Жёлтый навес',
    note: 'Junko Kobayashi (GONDOLA) · Sasazuka Greenway · 2023',
    shell: {
      width: 2.4,
      depth: 2.4,
      height: 2.7,
      roof: 'disc',
      overhang: 0.12,
      drum: 1.9,
      wallPattern: 'metal',
      palette: {
        walls: [0x8b4a2b, 0x8b4a2b, 0x8b4a2b, 0x8b4a2b],
        trim: 0x3a2a22,
        roof: 0x6e3a22,
        plinth: 0x77746b,
        floor: 0x9c968a,
        door: 0x5a3424,
        accent: 0xe3b51e,
      },
      dressing: [],
      form: {
        family: 'eave',
        eave: { x: 0, z: 0.6, radiusX: 5.2, radiusZ: 3.6, y: 4.3, thickness: 0.18, color: 0xe3b51e },
        louvres: null,
        booths: [
          { shape: 'drum', x: -3.4, z: 0.5, yaw: 0, radius: 1.0, height: 3.4, color: 0x7f4326 },
          { shape: 'drum', x: 3.5, z: 0.5, yaw: 0, radius: 1.15, height: 3.0, color: 0x8d4e2c },
          { shape: 'drum', x: 1.7, z: 3.0, yaw: 0, radius: 0.8, height: 3.7, color: 0x854829 },
        ],
        columns: [
          [-4.0, -1.4],
          [4.0, -1.4],
          [-2.8, 3.2],
          [3.6, 3.0],
        ],
      },
    },
    bowl: 'washlet',
    fixtures: ['door', 'lid', 'flush', 'valve', 'plunger', 'floor-dirt'],
    face: { arrival: 'angry', size: 0.14, brow: 0.2 },
    scenario: 'clogged-drain',
    sources: [
      official('sasazuka_greenway', 'Sasazuka Greenway', {
        silhouette: 'A large yellow oval awning hanging over a series of cylindrical toilets of various heights',
        plan: 'Each column under the elevated railway is a toilet booth; drawn as a drum cabin and three sealed drums on posts',
        palette: 'Weathering steel panels, rusted once; a yellow awning',
      }),
    ],
  },
  {
    id: 'toilet-ando-jingu-dori',
    name: 'Амаядори',
    note: 'Tadao Ando · Jingu-Dori Park · 2020',
    shell: {
      width: 2.4,
      depth: 2.4,
      height: 2.7,
      roof: 'flat',
      overhang: 0.08,
      wallPattern: 'plaster',
      palette: {
        walls: [0xa9a69e, 0xa9a69e, 0xa9a69e, 0xa9a69e],
        trim: 0x4a4844,
        roof: 0x8f8c85,
        plinth: 0x77746b,
        floor: 0x9c968a,
        door: 0x6a6862,
        accent: 0x5a5a56,
      },
      dressing: [],
      form: {
        family: 'eave',
        eave: { x: 0, z: -0.7, radiusX: 3.9, radiusZ: 3.9, y: 3.3, thickness: 0.3, color: 0x9d9a92 },
        louvres: { radius: 3.0, count: 60, width: 0.06, depth: 0.24, entrance: 0.42, color: 0x4a4640 },
        booths: [],
        columns: [],
      },
    },
    bowl: 'washlet',
    fixtures: ['door', 'lid', 'flush', 'valve', 'plunger', 'floor-dirt'],
    face: null,
    scenario: 'clogged-drain',
    sources: [
      official('jingu-dori_park', 'Jingu-Dori Park', {
        silhouette: 'A circular plan under a spanning roof whose eaves protrude on the Shibuya Station side',
        plan: 'A cylindrical wall of vertical louvres with entrances on opposite sides; the accessible toilet at the centre of the station-side entrance',
        palette: 'A latticed exterior wall',
      }),
    ],
  },
  {
    id: 'toilet-ito-yoyogi-hachiman',
    name: 'Три гриба',
    note: 'Toyo Ito · Yoyogi-Hachiman · 2021',
    shell: {
      width: 2.4,
      depth: 2.4,
      height: 2.6,
      roof: 'floating',
      overhang: 0.4,
      drum: 1.85,
      wallPattern: 'plaster',
      palette: {
        walls: [0x8a8478, 0x8a8478, 0x8a8478, 0x8a8478],
        trim: 0x3a3836,
        roof: 0xe6e2da,
        plinth: 0x77746b,
        floor: 0x9c968a,
        door: 0x4a4744,
        accent: 0xd9d3c7,
      },
      dressing: [],
      form: {
        family: 'cluster',
        huts: [
          { shape: 'drum', x: -4.6, z: 0.2, yaw: 0, radius: 1.6, height: 2.4, color: 0x5e5a55 },
          { shape: 'drum', x: 4.6, z: 0.2, yaw: 0, radius: 1.6, height: 2.8, color: 0xd8d2c6 },
        ],
      },
    },
    bowl: 'washlet',
    fixtures: ['door', 'lid', 'flush', 'valve', 'plunger', 'floor-dirt'],
    face: { arrival: 'sleepy', size: 0.14, brow: 0.18 },
    scenario: 'clogged-drain',
    sources: [
      official('yoyogi_hachiman', 'Yoyogi-Hachiman', {
        silhouette: 'Three cylinders like mushrooms, each under a round roof that looks as if it floats',
        plan: 'Three separate toilets in a row with circulation space between them',
        palette: 'Small round tiles in a colourful gradation; drawn as three shades',
      }),
    ],
  },
  {
    id: 'toilet-yanoaoyama-tobe-zoo',
    name: 'Кедровый навес',
    note: 'Yano Aoyama Architecture Design · Tobe Zoo, Ehime · 2026',
    shell: {
      width: 2.4,
      depth: 2.4,
      height: 2.5,
      roof: 'flat',
      overhang: 0.04,
      wallPattern: 'blocks',
      palette: {
        walls: [0x9a968d, 0x9a968d, 0x9a968d, 0x9a968d],
        trim: 0x3c3f41,
        roof: 0x8a867e,
        plinth: 0x6c6962,
        floor: 0x8a867c,
        door: 0x6b5a48,
        accent: 0x6b6e70,
      },
      dressing: [],
      form: {
        family: 'canopy',
        canopy: {
          x: 1.6,
          z: 0.15,
          length: 12,
          width: 4.4,
          profile: [3.75, 3.49, 3.3, 3.19, 3.15, 3.19, 3.3, 3.49, 3.75],
          thickness: 0.2,
          color: 0xc79a62,
        },
        cubes: [{ shape: 'box', x: 3.2, z: 0, yaw: 0, width: 2.2, depth: 2.2, height: 2.5, color: 0x9a968d }],
        columns: [
          [-3.6, -1.9],
          [1.6, -1.9],
          [6.8, -1.9],
          [-3.6, 2.2],
          [1.6, 2.2],
          [6.8, 2.2],
        ],
      },
    },
    bowl: 'washlet',
    fixtures: ['door', 'lid', 'flush', 'valve', 'plunger', 'floor-dirt'],
    face: null,
    scenario: 'clogged-drain',
    sources: [
      {
        url: 'https://www.dezeen.com/2026/07/25/yano-aoyama-architecture-design-tobe-zoo-toilet/',
        title: 'Yano Aoyama Architecture Design tops public toilet in Japan with sweeping timber canopy',
        author: 'Jon Astbury, Dezeen (photography Nishikawa Masao)',
        licence: FACTS_ONLY,
        accessed: ACCESSED,
        silhouette: 'A 12 m cross-laminated cedar canopy left to deflect under its own weight into a gentle bowed curve, on rows of slender steel columns along its edges',
        plan: 'Two 2 x 2 m cubic volumes of precast concrete blocks under the canopy, by the zoo entrance',
        palette: 'Chiselled concrete and Ehime cedar',
      },
    ],
  },
];

/** A variant by id; throws on a typo so a caller never builds the wrong thing. */
export function toiletVariant(id: string): ToiletVariant {
  const variant = TOILET_VARIANTS.find((candidate) => candidate.id === id);
  if (!variant) throw new Error(`Unknown toilet variant "${id}"`);
  return variant;
}
