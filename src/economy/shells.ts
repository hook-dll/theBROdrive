import { hash01 } from '../core/rng';

/**
 * THE SHELLS: the money of the drive, and the only one. There are four kinds — the
 * scallop (гребешок), the spiral (спиралька), the horn (рожок) and the cowrie (каури) —
 * all of one size and all worth the same: one shell. There are no figures on the money
 * anywhere; a shell is a shell, and what the kinds change is what a machine takes.
 *
 * The player's shells are `PlayerState.shells`, a count per kind, kept in a glass jar
 * (ui/hudjar.ts) that holds `JAR_CAPACITY` of them. Pay comes as shells of random kinds
 * (`mintShells`): each shell's kind is drawn from the world seed and the number of
 * shells drawn before it (`PlayerState.shellMint`), so a reload or a replay mints the
 * same shells. A full jar still takes a new shell, and one shell already in it — any
 * kind, weighted by how many of each there are — pops out over the rim and is lost.
 * A fine (`takeShells`) takes shells out the same way, by count, on the same counter.
 *
 * A price is ONE kind × a count (`ShellPrice`): a machine takes only its own kind, and
 * short of that kind it gives nothing, however many shells of the others the jar holds.
 * Which kind a machine takes is drawn from the seed and the machine's id
 * (`machineShellKind`), so every machine keeps its kind for good.
 *
 * Any text the game paints may carry a price: `shellToken` wraps it in two private-use
 * characters, and every painter of game text (ui/shellsprites.ts for the HUD's DOM and
 * the canvas boards and cards) splits the text with `splitShells` and draws the shells
 * where the token stood. A plain-text reader (an aria label, a log) takes `plainShells`.
 */

export const SHELL_KINDS = ['scallop', 'spiral', 'horn', 'cowrie'] as const;
export type ShellKind = (typeof SHELL_KINDS)[number];

/** Shells by kind: the player's purse, or a handful moving in or out of it. */
export type ShellPurse = Record<ShellKind, number>;

/** What a machine asks: `count` shells of one `kind`. */
export interface ShellPrice {
  readonly kind: ShellKind;
  readonly count: number;
}

/** Shells the jar holds; one more pushes a shell out over the rim (`mintShells`). */
export const JAR_CAPACITY = 50;

/** Domain tags of the draws. */
const MINT_DOMAIN = 0x5348_4d31; // 'SHM1'
const SPILL_DOMAIN = 0x5348_5331; // 'SHS1'
const FINE_DOMAIN = 0x5348_4631; // 'SHF1'
const MACHINE_DOMAIN = 0x5348_4b31; // 'SHK1'

export function isShellKind(value: unknown): value is ShellKind {
  return typeof value === 'string' && (SHELL_KINDS as readonly string[]).includes(value);
}

export function emptyPurse(): ShellPurse {
  return { scallop: 0, spiral: 0, horn: 0, cowrie: 0 };
}

/** Every shell in `purse`, whatever its kind. */
export function purseTotal(purse: Readonly<ShellPurse>): number {
  let total = 0;
  for (const kind of SHELL_KINDS) total += purse[kind];
  return total;
}

/**
 * A shell of `purse` drawn by `u` in [0, 1), every SHELL equally likely — so a kind is
 * as likely as the share of the jar it fills. Null for an empty purse. The overflow's
 * draw, and any other that takes "a shell, whichever comes to hand".
 */
export function pickWeighted(purse: Readonly<ShellPurse>, u: number): ShellKind | null {
  const total = purseTotal(purse);
  if (total <= 0) return null;
  let at = Math.min(total - 1, Math.floor(u * total));
  for (const kind of SHELL_KINDS) {
    if (at < purse[kind]) return kind;
    at -= purse[kind];
  }
  return null;
}

/** What `mintShells` leaves: the new purse and mint count, and the shells that went over the rim. */
export interface Minting {
  readonly purse: ShellPurse;
  readonly mint: number;
  /** One entry per shell lost over the rim of a full jar, in order. */
  readonly spilled: ShellKind[];
}

/**
 * `count` new shells into `purse`: shell number `mint + i` of the world is of the kind
 * drawn from `seed` and that number, so the same pay always mints the same shells. Each
 * goes in; if the jar then holds more than `JAR_CAPACITY`, a shell drawn from the jar by
 * count (`pickWeighted`, the new one among them) pops out and is lost.
 */
export function mintShells(seed: number, mint: number, purse: Readonly<ShellPurse>, count: number): Minting {
  const next = { ...purse };
  const spilled: ShellKind[] = [];
  const n = Math.max(0, Math.floor(count));
  for (let i = 0; i < n; i++) {
    const index = mint + i;
    const kind = SHELL_KINDS[Math.floor(hash01(seed, MINT_DOMAIN, index) * SHELL_KINDS.length)]!;
    next[kind]++;
    if (purseTotal(next) > JAR_CAPACITY) {
      const out = pickWeighted(next, hash01(seed, SPILL_DOMAIN, index))!;
      next[out]--;
      spilled.push(out);
    }
  }
  return { purse: next, mint: mint + n, spilled };
}

/** What `takeShells` leaves: the new purse and draw count, and the shells taken, in order. */
export interface Taking {
  readonly purse: ShellPurse;
  readonly mint: number;
  readonly taken: ShellKind[];
}

/**
 * `count` shells out of `purse`, a FINE: each drawn from the jar by count (`pickWeighted`,
 * "whichever comes to hand") with draw number `mint + i` of the world, so the same fine
 * on the same jar always takes the same shells. An empty jar gives nothing more: there is
 * no debt, and the draws not made do not move the counter.
 */
export function takeShells(seed: number, mint: number, purse: Readonly<ShellPurse>, count: number): Taking {
  const next = { ...purse };
  const taken: ShellKind[] = [];
  const n = Math.max(0, Math.floor(count));
  for (let i = 0; i < n; i++) {
    const kind = pickWeighted(next, hash01(seed, FINE_DOMAIN, mint + i));
    if (kind === null) break;
    next[kind]--;
    taken.push(kind);
  }
  return { purse: next, mint: mint + taken.length, taken };
}

/** Whether `purse` holds `price`: enough of its one kind. */
export function canPay(purse: Readonly<ShellPurse>, price: ShellPrice): boolean {
  return purse[price.kind] >= price.count;
}

/** `purse` with `price` taken out, or null and nothing taken when it is short of that kind. */
export function payFrom(purse: Readonly<ShellPurse>, price: ShellPrice): ShellPurse | null {
  if (!canPay(purse, price)) return null;
  return { ...purse, [price.kind]: purse[price.kind] - Math.max(0, price.count) };
}

/** A string's 32-bit FNV-1a, for a machine id into `hash01`. */
function idHash(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The kind of shell the machine `machineId` takes, for every price it asks: drawn from
 * the seed and the id, so it never changes and a card and its button always agree.
 */
export function machineShellKind(seed: number, machineId: string): ShellKind {
  return SHELL_KINDS[Math.floor(hash01(seed, MACHINE_DOMAIN, idHash(machineId)) * SHELL_KINDS.length)]!;
}

// ---------------------------------------------------------------------------
// Prices in painted text
// ---------------------------------------------------------------------------

const OPEN = '';
const CLOSE = '';
const TOKEN = /(scallop|spiral|horn|cowrie):(\d+)/g;

/** A price as a token inside game text, drawn as shells by every painter of that text. */
export function shellToken(price: ShellPrice): string {
  return `${OPEN}${price.kind}:${Math.max(0, Math.round(price.count))}${CLOSE}`;
}

/** One run of painted text: words, or a price to draw as shells. */
export type ShellRun = { readonly text: string } | { readonly price: ShellPrice };

/** Whether `text` carries a price at all: most text does not and is painted as it is. */
export function hasShells(text: string): boolean {
  return text.includes(OPEN);
}

/** `text` cut into its words and its prices, in order. Empty words are left out. */
export function splitShells(text: string): ShellRun[] {
  const runs: ShellRun[] = [];
  let at = 0;
  for (const match of text.matchAll(TOKEN)) {
    if (match.index > at) runs.push({ text: text.slice(at, match.index) });
    runs.push({ price: { kind: match[1] as ShellKind, count: Number(match[2]) } });
    at = match.index + match[0].length;
  }
  if (at < text.length) runs.push({ text: text.slice(at) });
  return runs;
}

/** A price in words: "3 scallop shells", "1 cowrie shell". */
export function priceWords(price: ShellPrice): string {
  return `${price.count} ${price.kind} shell${price.count === 1 ? '' : 's'}`;
}

/** `text` with every price written out in words, for readers that cannot draw. */
export function plainShells(text: string): string {
  return text.replace(TOKEN, (_, kind: string, n: string) => priceWords({ kind: kind as ShellKind, count: Number(n) }));
}
