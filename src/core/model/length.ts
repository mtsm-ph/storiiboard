import { t } from '../i18n';

// Lengths on a plan (6.2a, docs/PHASE6_DECISIONS.md 7). The file always holds metres; the screen shows metres or feet
// and inches (feet in the US, metres elsewhere, or as Settings → App says). A length can be typed either way, whatever
// the screen shows: "3.5m", "3,5 m", "350cm", "12ft", "12'", 12' 6", 12'6, 6", "6in", or a bare number in the unit shown;
// and the US architectural forms 12'-6", 12'-6, 12' 6 1/2", 6 1/2", and 12-6 while the screen shows feet.
// Figures, never the language's decimals, when written out: they're technical values, as a lens's mm is.

export type PlanUnit = 'metres' | 'feet';

const INCH = 0.0254;
const FOOT = 0.3048;

/** Metres to a tenth of a millimetre: far finer than anyone draws, and no float noise in History. */
const tidyMetres = (m: number): number => Math.round(m * 10000) / 10000;

const NUMBER = String.raw`(\d+(?:\.\d*)?|\.\d+)`;
/** Inches: a number, a number and a fraction (6 1/2), or a fraction alone (1/2). */
const INCH_TEXT = String.raw`((?:\d+(?:\.\d*)?|\.\d+)(?:\s+\d+\/\d+)?|\d+\/\d+)`;
const INCH_MARK = String.raw`(?:"|in|inch|inches)`;
const METRIC = new RegExp(String.raw`^${NUMBER}\s*(m|cm|mm|metres?|meters?)$`);
// 12', 12' 6", 12'6, 12'-6", 12' 6 1/2".
const FEET = new RegExp(String.raw`^${NUMBER}\s*(?:'|ft|feet|foot)\s*(?:-\s*)?(?:${INCH_TEXT}\s*${INCH_MARK}?)?$`);
const INCHES = new RegExp(String.raw`^${INCH_TEXT}\s*${INCH_MARK}$`);
// 12-6, 12-6 1/2: feet, a dash, whole inches (a fraction only after them); read only while the screen shows feet. A
// fraction straight after the dash (4-1/2) is refused: it reads as four and a half, never as 4' 0½".
const DASHED = new RegExp(String.raw`^(\d+)\s*-\s*((?:\d+(?:\.\d*)?|\.\d+)(?:\s+\d+\/\d+)?)$`);
const BARE = new RegExp(String.raw`^${NUMBER}$`);
/**
 * A grouping comma (1,500): refused rather than guessed, since it reads as 1.5 where a comma is the decimal mark. After
 * a 0 (0,125) it can only be a decimal, so that one is read.
 */
const GROUPING = /(\d+),\d{3}(?!\d)/g;

/** Whether what was typed has a thousands comma, which is refused (and said so). */
export const hasGroupingComma = (text: string): boolean => [...text.matchAll(GROUPING)].some((m) => !/^0+$/.test(m[1] ?? ''));
/** The longest length a plan takes: a kilometre. */
const MOST = 1000;

/** Inches as typed: 6, 6.5, 6 1/2, 1/2; null for a fraction over nothing. */
function inchValue(text: string): number | null {
  const [whole = '', fraction] = text.trim().split(/\s+/);
  const part = (f: string): number | null => {
    const [top, bottom] = f.split('/').map(Number);
    return top !== undefined && bottom !== undefined && bottom > 0 ? top / bottom : null;
  };
  if (whole.includes('/')) return fraction === undefined ? part(whole) : null;
  const rest = fraction === undefined ? 0 : part(fraction);
  return rest === null ? null : Number(whole) + rest;
}

const METRIC_FACTOR: Readonly<Record<string, number>> = { m: 1, cm: 0.01, mm: 0.001 };

/**
 * A typed length in metres, or null when it can't be read (nothing is saved then). `signed` takes a minus too, for a
 * position (X and Y may be left of or above the plan's origin); a length never has one.
 */
export function parseLength(text: string, unit: PlanUnit, signed = false): number | null {
  const m = readLength(text, unit, signed);
  // Nothing over a kilometre either way: a typo (an extra zero, a unit left off), never a set.
  return m === null || Math.abs(m) > MOST ? null : m;
}

function readLength(text: string, unit: PlanUnit, signed: boolean): number | null {
  const typed = text.trim();
  if (hasGroupingComma(typed)) return null;
  let s = typed
    .toLowerCase()
    // Typographic marks, as a Mac's smart quotes or a pasted spec write them; two single quotes are an inch mark.
    .replace(/[’′‘]/g, "'")
    .replace(/[”″“]/g, '"')
    .replace(/''/g, '"')
    .replace(/,/g, '.');
  let sign = 1;
  if (/^[-−]/.test(s)) {
    if (!signed) return null;
    sign = -1;
    s = s.slice(1).trim();
  }
  if (s === '') return null;
  const metric = METRIC.exec(s);
  if (metric) {
    const [, value = '', suffix = 'm'] = metric;
    return tidyMetres(sign * Number(value) * (METRIC_FACTOR[suffix] ?? 1));
  }
  const feet = FEET.exec(s) ?? (unit === 'feet' ? DASHED.exec(s) : null);
  if (feet) {
    const [, ft = '0', inches] = feet;
    const extra = inches === undefined ? 0 : inchValue(inches);
    return extra === null ? null : tidyMetres(sign * (Number(ft) * FOOT + extra * INCH));
  }
  const inches = INCHES.exec(s);
  if (inches) {
    const value = inchValue(inches[1] ?? '');
    return value === null ? null : tidyMetres(sign * value * INCH);
  }
  const bare = BARE.exec(s);
  if (bare) return tidyMetres(sign * Number(bare[1] ?? '0') * (unit === 'feet' ? FOOT : 1));
  return null;
}

const minus = (negative: boolean): string => (negative ? '−' : '');

/** Up to one decimal, without a trailing zero: 6, 6.5. */
const halfText = (value: number): string => (Number.isInteger(value) ? String(value) : value.toFixed(1));

/**
 * A length as the screen shows it: metres to the centimetre ("3.50 m"), or feet and inches to the nearest half inch
 * (12' 6", 6" under a foot).
 */
export function formatLength(m: number, unit: PlanUnit): string {
  if (unit === 'metres') {
    const cm = Math.round(Math.abs(m) * 100);
    return t('length.metres', { value: `${minus(cm !== 0 && m < 0)}${(cm / 100).toFixed(2)}` });
  }
  const halves = Math.round((Math.abs(m) / INCH) * 2);
  const sign = minus(halves !== 0 && m < 0);
  const feet = Math.floor(halves / 24);
  const inches = (halves - feet * 24) / 2;
  if (feet === 0) return t('length.inches', { value: `${sign}${halfText(inches)}` });
  return t('length.feetInches', { feet: `${sign}${String(feet)}`, inches: halfText(inches) });
}

/** A round length's short label, for a ruler's tick or the scale bar: "1 m", "0.5 m", "0.01 m", "10 ft", "6 in". */
export function roundLengthLabel(m: number, unit: PlanUnit): string {
  if (unit === 'metres') return t('length.metresShort', { value: String(Math.round(m * 1000) / 1000) });
  // Under a foot, in inches (the scale bar's 1", 2" and 6" up close).
  if (Math.abs(m) < FOOT - 1e-9 && m !== 0) return t('length.inchesShort', { value: String(Math.round((m / INCH) * 100) / 100) });
  return t('length.feetShort', { value: String(Math.round((m / FOOT) * 100) / 100) });
}

export const FEET_TO_METRES = FOOT;
