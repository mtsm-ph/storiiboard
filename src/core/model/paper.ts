import type { PaperChoice } from '../storage/settings';

// The paper a call sheet's PDF is made for (4.6). Intl has no paper preference (CLDR's measurement system says metric
// or US, not Letter or A4), so the countries that print on Letter are a list here, as Kevin gave it on Nov 10:
// the United States, Canada, Mexico and the Philippines, Chile, Colombia, Venezuela, Puerto Rico and the Central
// American and Caribbean countries that follow them. Everywhere else is A4. Fork it to correct it.

export type Paper = 'letter' | 'a4';

const LETTER_REGIONS = new Set(['US', 'CA', 'MX', 'PH', 'CL', 'CO', 'VE', 'PR', 'GT', 'SV', 'NI', 'CR', 'PA', 'DO', 'BO']);

/** A page in points (1/72 inch), portrait. */
export const PAPER_SIZES: Readonly<Record<Paper, { width: number; height: number }>> = {
  letter: { width: 612, height: 792 },
  a4: { width: 595.28, height: 841.89 },
};

/** Whether a region's locale (`en-US`, `es-MX`; a bare language reads as its likeliest region) prints on Letter. */
export function isLetterLocale(locale: string | null): boolean {
  if (!locale) return false;
  try {
    const parsed = new Intl.Locale(locale);
    return LETTER_REGIONS.has(parsed.region ?? parsed.maximize().region ?? '');
  } catch {
    return false;
  }
}

/** The paper to use: the choice, else Letter in the regions above and A4 elsewhere (an unknown region too). */
export function paperFor(choice: PaperChoice, regionLocale: string | null): Paper {
  if (choice === 'letter' || choice === 'a4') return choice;
  return isLetterLocale(regionLocale) ? 'letter' : 'a4';
}
