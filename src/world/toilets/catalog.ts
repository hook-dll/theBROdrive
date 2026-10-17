/**
 * The Japanese street-toilet catalogue (docs/toilet-poi-design.md). Five of the planned
 * fifty so far, all low-poly readings of THE TOKYO TOILET project in Shibuya, each drawn
 * from the one shell in geometry.ts. Ids are stable: saves key on them.
 *
 * The world does not place these yet; they stand in the POI gallery
 * (`?poi-gallery&type=toilet`) and go through the POI merge path like every kit variant
 * (world/poi-variants.ts).
 */

import type { ToiletSourceCard, ToiletVariant } from './types';

const ACCESSED = '2026-10-17';

/** Every variant here is read from this round-up; the facts used are on each card. */
const ROUNDUP = {
  url: 'https://www.dezeen.com/2024/03/08/tokyo-toilets-wim-wenders-perfect-days/',
  title: "Explore all 17 Tokyo Toilet projects featured in Wim Wenders' film Perfect Days",
  author: 'Jane Englefield, Dezeen (photography Satoshi Nagare, courtesy The Nippon Foundation)',
  licence: 'Facts only: no image, drawing or text is reproduced',
  accessed: ACCESSED,
} as const;

function card(facts: Omit<ToiletSourceCard, keyof typeof ROUNDUP>): ToiletSourceCard {
  return { ...ROUNDUP, ...facts };
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
    },
    bowl: 'washlet',
    fixtures: ['door', 'lid', 'flush', 'valve', 'plunger', 'floor-dirt'],
    face: { arrival: 'embarrassed', size: 0.15, brow: 0.2 },
    scenario: 'clogged-drain',
    sources: [
      card({
        silhouette: 'Rectilinear box of tinted glass that turns opaque when occupied; drawn as opaque tinted panels',
        plan: 'One of the three cubicles (male, female, accessible), drawn alone',
        palette: 'Shades of orange, pink and purple',
      }),
    ],
  },
  {
    id: 'toilet-kuma-nabeshima',
    name: 'Кедровая хижина',
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
      dressing: ['battens'],
    },
    bowl: 'washlet',
    fixtures: ['door', 'lid', 'flush', 'valve', 'plunger', 'floor-dirt'],
    face: { arrival: 'sleepy', size: 0.13, brow: 0.17 },
    scenario: 'clogged-drain',
    sources: [
      card({
        silhouette: 'Small cedar-clad hut, one of five joined by a stepped walkway',
        plan: 'One hut of the five, drawn alone',
        palette: 'Cedar cladding',
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
    },
    bowl: 'washlet',
    fixtures: ['door', 'lid', 'flush', 'valve', 'plunger', 'floor-dirt'],
    face: { arrival: 'worried', size: 0.14, brow: 0.19 },
    scenario: 'clogged-drain',
    sources: [
      card({
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
    },
    bowl: 'washlet',
    fixtures: ['door', 'lid', 'flush', 'valve', 'plunger', 'floor-dirt'],
    face: { arrival: 'angry', size: 0.13, brow: 0.2 },
    scenario: 'clogged-drain',
    sources: [
      card({
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
    },
    bowl: 'squat',
    fixtures: ['door', 'flush', 'valve', 'plunger', 'floor-dirt'],
    face: null,
    scenario: 'clogged-drain',
    sources: [
      card({
        silhouette: 'Board-marked concrete walls after the primitive kawaya huts once used as toilets',
        plan: 'A maze of fifteen walls encloses it; drawn as two screen walls before one cubicle',
        palette: 'Board-marked concrete',
      }),
    ],
  },
];

/** A variant by id; throws on a typo so a caller never builds the wrong thing. */
export function toiletVariant(id: string): ToiletVariant {
  const variant = TOILET_VARIANTS.find((candidate) => candidate.id === id);
  if (!variant) throw new Error(`Unknown toilet variant "${id}"`);
  return variant;
}
