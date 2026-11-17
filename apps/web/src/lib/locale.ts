import type { PaperSizeValue } from '@shortlist/shared';

// Defaults read from the browser at sign-up (Agents.md §2.1): the account's clock for the
// morning digest and quiet hours, and the paper its resume prints on. Both are editable on
// Profile → Settings, so a wrong guess costs one tap.

export function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

// Letter is used in the US, Canada and a few countries in the Americas and the Philippines;
// everyone else uses A4.
const LETTER_REGIONS = new Set(['US', 'CA', 'MX', 'PH', 'CL', 'CO', 'VE', 'PR', 'GT', 'CR', 'DO', 'SV', 'PA']);

export function paperSizeFor(languages: readonly string[]): PaperSizeValue {
  for (const tag of languages) {
    let region: string | undefined;
    try {
      region = new Intl.Locale(tag).region;
    } catch {
      continue;
    }
    if (region) return LETTER_REGIONS.has(region) ? 'LETTER' : 'A4';
  }
  return 'A4';
}

export const browserPaperSize = (): PaperSizeValue =>
  paperSizeFor(typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language]));
