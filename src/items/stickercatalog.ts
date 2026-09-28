/**
 * Every sticker design in the game: its name, and its physical size on the car.
 *
 * Data only — what each one looks like is drawn in render/stickerart.ts, keyed by the
 * same `kind`. Sizes are about 1.45× the real vinyl (a real 12 cm "Ш" triangle is a
 * speck on a 4 m car from the chase camera), with the big decals — the race number,
 * the flames, the chevrons — sized to their panel. The set is a Soviet road
 * trip into the desert: the stickers a driver actually had (the "Ш" triangle, the SU
 * oval, "Не уверен — не обгоняй"), road signs of the way south, and the badges of a
 * long hot drive.
 *
 * `kind` ids are saved: never rename one; add new ones at the end.
 */

export interface StickerDef {
  readonly kind: string;
  /** What the envelope says it holds. */
  readonly label: string;
  /** Width and height on the panel, metres. */
  readonly widthM: number;
  readonly heightM: number;
}

export const STICKERS = [
  { kind: 'star', label: 'red star', widthM: 0.174, heightM: 0.174 },
  { kind: 'su-oval', label: 'SU oval', widthM: 0.254, heightM: 0.167 },
  { kind: 'studs', label: '"Ш" studded tyres', widthM: 0.217, heightM: 0.196 },
  { kind: 'learner', label: '"У" learner', widthM: 0.217, heightM: 0.196 },
  { kind: 'limit-90', label: 'speed limit 90', widthM: 0.174, heightM: 0.174 },
  { kind: 'camels', label: 'camel crossing', widthM: 0.232, heightM: 0.209 },
  { kind: 'route-m4', label: 'route M-4', widthM: 0.246, heightM: 0.138 },
  { kind: 'radiation', label: 'radiation', widthM: 0.174, heightM: 0.174 },
  { kind: 'chequered', label: 'chequered flag', widthM: 0.246, heightM: 0.16 },
  { kind: 'number-07', label: 'race number 07', widthM: 0.38, heightM: 0.38 },
  { kind: 'cactus', label: 'cactus', widthM: 0.16, heightM: 0.217 },
  { kind: 'sunset', label: 'desert sunset', widthM: 0.246, heightM: 0.16 },
  { kind: 'flames', label: 'flames', widthM: 0.62, heightM: 0.19 },
  { kind: 'lightning', label: 'lightning bolt', widthM: 0.116, heightM: 0.232 },
  { kind: 'rocket', label: '"Поехали!" rocket', widthM: 0.174, heightM: 0.246 },
  { kind: 'sputnik', label: 'sputnik', widthM: 0.217, heightM: 0.189 },
  { kind: 'cassette', label: 'cassette', widthM: 0.217, heightM: 0.145 },
  { kind: 'smiley', label: 'smiley', widthM: 0.145, heightM: 0.145 },
  { kind: 'peace', label: 'peace sign', widthM: 0.16, heightM: 0.16 },
  { kind: 'horseshoe', label: 'lucky horseshoe', widthM: 0.145, heightM: 0.16 },
  { kind: 'evil-eye', label: 'evil eye', widthM: 0.145, heightM: 0.145 },
  { kind: 'bullet-holes', label: 'bullet holes', widthM: 0.261, heightM: 0.174 },
  { kind: 'paws', label: 'paw prints', widthM: 0.34, heightM: 0.13 },
  { kind: 'turbo', label: 'TURBO', widthM: 0.42, heightM: 0.11 },
  { kind: 'chevrons', label: 'hazard chevrons', widthM: 0.56, heightM: 0.125 },
  { kind: 'skull', label: 'skull and bones', widthM: 0.174, heightM: 0.189 },
  { kind: 'cat', label: 'cat', widthM: 0.16, heightM: 0.16 },
  { kind: 'dice', label: 'dice', widthM: 0.189, heightM: 0.131 },
  { kind: 'moon', label: 'moon and stars', widthM: 0.16, heightM: 0.16 },
  { kind: 'not-sure', label: '"Не уверен — не обгоняй"', widthM: 0.44, heightM: 0.1 },
] as const satisfies readonly StickerDef[];

export type StickerKind = (typeof STICKERS)[number]['kind'];

const BY_KIND = new Map<string, StickerDef>(STICKERS.map((def) => [def.kind, def]));

export function isStickerKind(value: unknown): value is StickerKind {
  return typeof value === 'string' && BY_KIND.has(value);
}

export function stickerDef(kind: StickerKind): StickerDef {
  return BY_KIND.get(kind)!;
}

/** The design a contract pays out, fixed by the contract's own seed. */
export function stickerKindForSeed(seed: number): StickerKind {
  let h = (seed ^ 0x5bd1e995) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return STICKERS[h % STICKERS.length]!.kind;
}
