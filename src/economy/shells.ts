/**
 * THE SHELLS: the money of the drive, and the only one. A shell is a shell: one kind,
 * one picture (ui/shellsprites.ts), worth one. The player's shells are a plain count
 * (`PlayerState.shells`) shown as shells lying in a glass jar (ui/hudjar.ts) that holds
 * `JAR_CAPACITY` of them. A full jar still takes a new shell, and one shell already in it
 * pops out over the rim and is lost (`addShells`). A fine takes shells out by count
 * (`takeShells`), never below empty.
 *
 * Every amount — a price, pay, a fine, a stake, a prize — is a whole number of shells.
 * Any text the game paints may carry one: `shellToken` wraps it in two private-use
 * characters, and every painter of game text (ui/shellsprites.ts for the HUD's DOM and
 * the canvas boards and cards) splits the text with `splitShells` and draws the figure
 * and the shell where the token stood. A plain-text reader (an aria label, a log) takes
 * `plainShells`.
 */

/** Shells the jar holds; one more pushes a shell out over the rim (`addShells`). */
export const JAR_CAPACITY = 50;

/** What `addShells` leaves: the new count, and how many went over the rim of the full jar. */
export interface Adding {
  readonly shells: number;
  readonly spilled: number;
}

/** `count` new shells into a jar of `have`: a full jar loses one over the rim for each past `JAR_CAPACITY`. */
export function addShells(have: number, count: number): Adding {
  const n = Math.max(0, Math.floor(count));
  const total = have + n;
  return total > JAR_CAPACITY ? { shells: JAR_CAPACITY, spilled: total - Math.max(have, JAR_CAPACITY) } : { shells: total, spilled: 0 };
}

/** Shells a fine of `count` takes out of a jar of `have`: never more than it holds. */
export function takeShells(have: number, count: number): number {
  return Math.max(0, Math.min(have, Math.floor(count)));
}

// ---------------------------------------------------------------------------
// Amounts in painted text
// ---------------------------------------------------------------------------

const OPEN = '';
const CLOSE = '';
const TOKEN = /(\d+)/g;

/** An amount of shells as a token inside game text, drawn as its figure and the shell by every painter of that text. */
export function shellToken(count: number): string {
  return `${OPEN}${Math.max(0, Math.round(count))}${CLOSE}`;
}

/** One run of painted text: words, or an amount to draw as its figure and the shell. */
export type ShellRun = { readonly text: string } | { readonly shells: number };

/** Whether `text` carries an amount at all: most text does not and is painted as it is. */
export function hasShells(text: string): boolean {
  return text.includes(OPEN);
}

/** `text` cut into its words and its amounts, in order. Empty words are left out. */
export function splitShells(text: string): ShellRun[] {
  const runs: ShellRun[] = [];
  let at = 0;
  for (const match of text.matchAll(TOKEN)) {
    if (match.index > at) runs.push({ text: text.slice(at, match.index) });
    runs.push({ shells: Number(match[1]) });
    at = match.index + match[0].length;
  }
  if (at < text.length) runs.push({ text: text.slice(at) });
  return runs;
}

/** An amount in words: "3 shells", "1 shell". */
export function shellWords(count: number): string {
  return `${count} shell${count === 1 ? '' : 's'}`;
}

/** `text` with every amount written out in words, for readers that cannot draw. */
export function plainShells(text: string): string {
  return text.replace(TOKEN, (_, n: string) => shellWords(Number(n)));
}
