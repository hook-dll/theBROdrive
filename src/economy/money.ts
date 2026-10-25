/**
 * MONEY AS IT IS SHOWN: calcite balls, never figures. A ruble is a small ball; ten
 * small ones fuse into a middle ball and ten middle ones into a big one, a hundred
 * rubles. An amount is read big balls first, then middle, then small.
 *
 * Any text the game paints may carry an amount: `moneyToken` wraps it in two
 * private-use characters, and every painter of game text (ui/balls.ts for the HUD's
 * DOM and the canvas boards and cards) splits the text with `splitMoney` and draws
 * the balls where the token stood. A plain-text reader (an aria label, a log) takes
 * `plainMoney`.
 */

/** Rubles in a middle ball and in a big one. */
export const MIDDLE_BALL = 10;
export const BIG_BALL = 100;

const OPEN = '';
const CLOSE = '';
const TOKEN = /(\d+)/g;

/** An amount of rubles as a token inside game text. */
export function moneyToken(rubles: number): string {
  return `${OPEN}${Math.max(0, Math.round(rubles))}${CLOSE}`;
}

/** One run of painted text: words, or an amount to draw as balls. */
export type MoneyRun = { readonly text: string } | { readonly rubles: number };

/** Whether `text` carries an amount at all: most text does not and is painted as it is. */
export function hasMoney(text: string): boolean {
  return text.includes(OPEN);
}

/** `text` cut into its words and its amounts, in order. Empty words are left out. */
export function splitMoney(text: string): MoneyRun[] {
  const runs: MoneyRun[] = [];
  let at = 0;
  for (const match of text.matchAll(TOKEN)) {
    if (match.index > at) runs.push({ text: text.slice(at, match.index) });
    runs.push({ rubles: Number(match[1]) });
    at = match.index + match[0].length;
  }
  if (at < text.length) runs.push({ text: text.slice(at) });
  return runs;
}

/** `text` with every amount written out in figures, for readers that cannot draw. */
export function plainMoney(text: string): string {
  return text.replace(TOKEN, (_, n: string) => `${n} rub`);
}

/** The balls of an amount: big, middle and small. Big ones are not capped. */
export interface Balls {
  readonly big: number;
  readonly middle: number;
  readonly small: number;
}

export function balls(rubles: number): Balls {
  const total = Math.max(0, Math.round(rubles));
  return {
    big: Math.floor(total / BIG_BALL),
    middle: Math.floor((total % BIG_BALL) / MIDDLE_BALL),
    small: total % MIDDLE_BALL,
  };
}
