/**
 * Localisation: a string table keyed by message id, one entry per supported language,
 * and the player's language picked once from the browser.
 *
 * The language is the first of `navigator.languages` (the browser's, which is the
 * system's unless the player changed it) whose primary subtag has a table, English
 * otherwise. `?lang=xx` in the URL overrides it, for checking a translation without
 * changing the browser.
 */

import { STRINGS, type MessageKey } from './strings';

export const LOCALES = ['en', 'ru', 'es', 'pt', 'fr', 'de', 'it', 'pl', 'tr', 'zh', 'ja', 'ko'] as const;
export type Locale = (typeof LOCALES)[number];

const FALLBACK: Locale = 'en';

function supported(tag: string | null | undefined): Locale | null {
  if (!tag) return null;
  const primary = tag.toLowerCase().split(/[-_]/)[0]!;
  return (LOCALES as readonly string[]).includes(primary) ? (primary as Locale) : null;
}

function detectLocale(): Locale {
  if (typeof window !== 'undefined') {
    const forced = supported(new URLSearchParams(window.location.search).get('lang'));
    if (forced) return forced;
  }
  if (typeof navigator !== 'undefined') {
    const tags = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const tag of tags) {
      const locale = supported(tag);
      if (locale) return locale;
    }
  }
  return FALLBACK;
}

let current: Locale | null = null;

/** The player's language, detected on first use. */
export function locale(): Locale {
  return (current ??= detectLocale());
}

/** The message in the player's language, English where a table lacks it. */
export function t(key: MessageKey): string {
  return STRINGS[locale()][key] ?? STRINGS[FALLBACK][key];
}
