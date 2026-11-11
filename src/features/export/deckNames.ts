import { t } from '../../core/i18n';
import { safeName } from './names';

// The names a deck's exports are written under (5.6a): "Pitch deck.pdf", and "Pitch deck 01 Title.png" for each page, numbered in the
// deck's page order. Characters a file system refuses are left out, as for every export name (names.ts); the order of the parts is
// the language's, so the translation files hold it.

/** The deck's file or folder name: its own name, safe to write. */
export const deckFileName = (deck: string, extension?: string): string => (extension ? `${safeName(deck)}.${extension}` : safeName(deck));

/** The digits a page number is padded to, so the files sort in page order: two, or more for a deck of a hundred pages. */
export const pageDigits = (count: number): number => Math.max(2, String(count).length);

/** `Pitch deck 01 Title.png`; a page with no name is `Pitch deck 01.png`. */
export function deckPageFileName(deck: string, number: number, digits: number, name: string, extension = 'png'): string {
  const parts = { deck: safeName(deck), number: String(number).padStart(digits, '0') };
  // A name that is nothing but characters a file refuses is no name; safeName would give the app's own, so it is asked about first.
  const cleaned = name.trim() === '' ? '' : safeName(name);
  const base = cleaned === '' || cleaned === t('app.name') ? t('export.deck.pageFileUnnamed', parts) : t('export.deck.pageFile', { ...parts, name: cleaned });
  return `${base}.${extension}`;
}
