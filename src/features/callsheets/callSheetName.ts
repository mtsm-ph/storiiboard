import { t } from '../../core/i18n';
import { isDayDate } from '../../core/model/shootDay';
import { safeName } from '../export/names';

/**
 * "Bey County — Call sheet — Day 3 — 2026-11-16.pdf" in the app's language; the date as YYYY-MM-DD so the days sort,
 * left out for a day with none. Made safe for a file system, as the other exports' names are.
 */
export function callSheetFileName(title: string, number: number, date: string): string {
  const words = isDayDate(date)
    ? t('callSheet.pdf.fileName', { title: safeName(title), number, date })
    : t('callSheet.pdf.fileNameUndated', { title: safeName(title), number });
  return `${safeName(words)}.pdf`;
}
