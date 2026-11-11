import { labels } from '../../core/i18n';

// What a deck's page is (5.5, docs/SBD_FORMAT.md, Boards): a `board_item` of kind `page` with a `format`, and for A4 and
// Letter an `orientation`. Kept apart from items.ts, which reads these, so neither imports the other. World units are the
// ones the canvas draws in; a page is sized so that 1 unit is about a pixel on screen at 100%, as a slide or a sheet is.

export const PAGE_FORMATS = ['16:9', '9:16', '4:5', 'a4', 'letter'] as const;
export type PageFormat = (typeof PAGE_FORMATS)[number];
export type PageOrientation = 'portrait' | 'landscape';

export const isPageFormat = (value: unknown): value is PageFormat => typeof value === 'string' && (PAGE_FORMATS as readonly string[]).includes(value);

/** A page's name for a format, in the language in use ("16:9", "A4"). */
export const PAGE_FORMAT_LABEL: Readonly<Record<PageFormat, string>> = labels({
  '16:9': 'deck.format.widescreen',
  '9:16': 'deck.format.vertical',
  '4:5': 'deck.format.portrait',
  a4: 'deck.format.a4',
  letter: 'deck.format.letter',
});

/** Paper formats take an orientation; the screen and social ones are as they are. */
export const isPaper = (format: PageFormat): boolean => format === 'a4' || format === 'letter';

/** A page's size in world units, portrait unless it is paper turned landscape. */
const PORTRAIT: Readonly<Record<PageFormat, { width: number; height: number }>> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '4:5': { width: 1080, height: 1350 },
  a4: { width: 1240, height: 1754 },
  letter: { width: 1275, height: 1650 },
};

export function pageSize(format: PageFormat, orientation: PageOrientation = 'portrait'): { width: number; height: number } {
  const size = PORTRAIT[format];
  return isPaper(format) && orientation === 'landscape' ? { width: size.height, height: size.width } : { ...size };
}

/** A page's size kept in its format's ratio when it is resized to a width: the height follows. */
export function ratioLocked(format: PageFormat, orientation: PageOrientation, width: number): { width: number; height: number } {
  const base = pageSize(format, orientation);
  return { width, height: Math.round(((width * base.height) / base.width) * 100) / 100 };
}

/** What a page is made on: white, never themed (board content is the same in light and dark). */
export const DEFAULT_PAGE_BACKGROUND = '#FFFFFF';

/** Space between pages laid left to right, in world units. */
export const PAGE_GAP = 200;

/** The fields a live field card can show (5.5). */
export const DECK_FIELDS = ['title', 'logline', 'format', 'runtime', 'company', 'dates', 'cast', 'crew'] as const;
export type DeckField = (typeof DECK_FIELDS)[number];
export const isDeckField = (value: unknown): value is DeckField => typeof value === 'string' && (DECK_FIELDS as readonly string[]).includes(value);

export const DECK_FIELD_LABEL: Readonly<Record<DeckField, string>> = labels({
  title: 'deck.field.title',
  logline: 'deck.field.logline',
  format: 'deck.field.format',
  runtime: 'deck.field.runtime',
  company: 'deck.field.company',
  dates: 'deck.field.dates',
  cast: 'deck.field.cast',
  crew: 'deck.field.crew',
});
