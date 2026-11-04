import { characterName, eighthsFromLines, looksLikeHeading, parseHeading, type Script, type ScriptScene } from './script';

// A screenplay PDF read by its layout (1.18): a PDF has no "scene heading" or "character" marks, only text at places
// on the page. Screenplays are set to fixed rules (Courier 12 on a 1.5-inch left margin, character cues about two
// inches further in, dialogue one inch in, scene numbers and revision marks outside the margins), so where a line
// starts says what it is. Free of pdf.js: the app turns a PDF into positioned text (src/features/script/readPdf.ts)
// and this reads that.

/** A run of text on a page, as a PDF reader gives it: x and y in points from the page's bottom left. */
export interface PdfText {
  page: number;
  x: number;
  y: number;
  /** Its width in points, to tell a word gap from a split word. */
  width: number;
  text: string;
}

interface Row {
  page: number;
  y: number;
  items: PdfText[];
}

interface Line {
  page: number;
  y: number;
  x: number;
  /** Where the line's text starts, from the script's action margin, in points. */
  indent: number;
  text: string;
  /** A scene number printed outside the margins on this line, if any. */
  number: string | null;
  /** One of two columns side by side on its row: dual dialogue. */
  column: boolean;
}

/** Courier 12: 12 points a line, 7.2 points a character; 72 points an inch. */
const LINE = 12;
const CHAR = 7.2;
const INCH = 72;

/** A page number: `2.` (scene numbers carry no dot). */
const PAGE_NUMBER = /^\d+\.$/;
/**
 * What can stand outside the margins as a scene number: short, no spaces, with a digit, at most one dash (`12`, `12A`,
 * `A7`, `12-14`), or a page number's trailing dot. A date such as `11.03.26` isn't one.
 */
const MARGIN_NUMBER = /^(?=.*\d)[A-Z0-9]{1,6}(-[A-Z0-9]{1,6})?\.?$/i;
/** A revision mark in the right margin, one asterisk or a few. */
const REVISION = /^\*+$/;

/** Lines that are the page's furniture, not the script. */
const FURNITURE = /^(\(MORE\)|\(CONTINUED\)|CONTINUED:?(\s*\(\d+\))?)$/i;

/** Runs on the same baseline (within 2 points of the row's first), left to right; pages in order, top to bottom. */
function rowsOf(items: readonly PdfText[]): Row[] {
  const sorted = items.filter((item) => item.text.trim() !== '').sort((a, b) => a.page - b.page || b.y - a.y);
  const rows: Row[] = [];
  for (const item of sorted) {
    const row = rows.at(-1);
    if (row && row.page === item.page && Math.abs(row.y - item.y) <= 2) row.items.push(item);
    else rows.push({ page: item.page, y: item.y, items: [item] });
  }
  for (const row of rows) row.items.sort((a, b) => a.x - b.x);
  return rows;
}

const isMarginToken = (text: string) => MARGIN_NUMBER.test(text) || REVISION.test(text);

/** The script's action margin: the leftmost start that a good share of its lines have (numbers aside). */
function marginOf(rows: readonly Row[]): number {
  const starts = rows.map((row) => row.items.find((item) => !isMarginToken(item.text.trim()))?.x).filter((x) => x !== undefined);
  const counts = new Map<number, number>();
  for (const x of starts) counts.set(Math.round(x / 4) * 4, (counts.get(Math.round(x / 4) * 4) ?? 0) + 1);
  const common = [...counts].filter(([, n]) => n >= Math.max(2, starts.length * 0.1)).map(([x]) => x);
  return common.length > 0 ? Math.min(...common) : Math.min(...starts, Infinity);
}

function joined(items: readonly PdfText[]): string {
  let text = '';
  let end = -Infinity;
  for (const item of items) {
    if (text !== '' && item.x - end > CHAR / 2 && !text.endsWith(' ') && !item.text.startsWith(' ')) text += ' ';
    text += item.text;
    end = item.x + item.width;
  }
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * A row as lines: what sits outside the margins taken off (a scene number kept, page numbers and revision marks
 * dropped), and the rest split into columns where a gap of an inch or more parts them, as dual dialogue sets two.
 */
function linesOf(row: Row, margin: number): Line[] {
  let number: string | null = null;
  const kept = row.items.filter((item) => {
    const text = item.text.trim();
    const outside = item.x < margin - 0.2 * INCH || item.x > margin + 5.5 * INCH;
    if (!outside || !isMarginToken(text)) return true;
    if (MARGIN_NUMBER.test(text) && !PAGE_NUMBER.test(text)) number ??= text;
    return false;
  });
  // Only a row that starts indented can be two columns, as dual dialogue is: action and headings start at the
  // margin, and a wide gap in them (`BANG!     BANG!`, a heading's `(FLASHBACK)` far right) is still one line.
  const indented = (kept[0]?.x ?? margin) - margin >= 0.5 * INCH;
  const columns: PdfText[][] = [];
  for (const item of kept) {
    const column = columns.at(-1);
    const last = column?.at(-1);
    if (column && last && (!indented || item.x - (last.x + last.width) < INCH)) column.push(item);
    else columns.push([item]);
  }
  const split = columns.length > 1;
  return columns.flatMap((items) => {
    const text = joined(items);
    const first = items[0];
    if (!first || text === '' || FURNITURE.test(text)) return [];
    return [{ page: row.page, y: row.y, x: first.x, indent: first.x - margin, text, number, column: split }];
  });
}

const isUpper = (text: string) => {
  const bare = text.replace(/\([^)]*\)/g, '').trim();
  return /[A-Z]/.test(bare) && bare === bare.toUpperCase();
};

/**
 * The line that reads right after `line` in its own column: on the next row or two below it, starting within reach.
 * Dialogue sits on the line under its cue, so anything further down (a gap, a heading, a later scene) doesn't count.
 */
function below(lines: readonly Line[], index: number): Line | undefined {
  const line = lines[index];
  if (!line) return undefined;
  for (let i = index + 1; i < lines.length; i += 1) {
    const next = lines[i];
    if (!next || next.page !== line.page || line.y - next.y > 2.5 * LINE) return undefined;
    if (next.y < line.y - 1 && Math.abs(next.x - line.x) < 2 * INCH) return next;
  }
  return undefined;
}

/** A title page is short: a title, a credit, contact lines. A first page of script is longer. */
const TITLE_PAGE_LINES = 15;

/** A screenplay PDF's scenes, from its positioned text. The title is the first line of a title page, if it has one. */
export function parseScreenplayPdf(items: readonly PdfText[]): Script {
  const rows = rowsOf(items);
  // One margin for the whole script: a page of dialogue alone has few lines at the action margin.
  const margin = marginOf(rows);
  const lines = rows.flatMap((row) => linesOf(row, margin));

  const scenes: ScriptScene[] = [];
  let current: (ScriptScene & { lines: number }) | null = null;
  const firstPage = lines[0]?.page;
  // A title page has no scene on it; a script that starts on page one has no title page.
  const onFirst = lines.filter((l) => l.page === firstPage);
  const titlePage =
    firstPage !== undefined && onFirst.length < TITLE_PAGE_LINES && !onFirst.some((l) => l.indent < 0.5 * INCH && looksLikeHeading(l.text));
  const title = titlePage ? (lines[0]?.text ?? null) : null;
  const close = () => {
    if (!current) return;
    const { lines: count, ...scene } = current;
    scenes.push({ ...scene, eighths: eighthsFromLines(count) });
  };
  let previous: Line | null = null;
  lines.forEach((line, index) => {
    const above = previous;
    previous = line;
    if (line.indent < 0.5 * INCH && !line.column && looksLikeHeading(line.text)) {
      close();
      current = { ...parseHeading(line.text), number: line.number, characters: [], eighths: 1, lines: 1 };
      return;
    }
    if (!current) return;
    // Printed lines this one takes, with the blank lines above it on the same page; a column beside another, none.
    if (!(above && above.page === line.page && Math.abs(above.y - line.y) <= 2)) {
      current.lines += above && above.page === line.page ? Math.max(1, Math.round((above.y - line.y) / LINE)) : 1;
    }
    // A character cue: in capitals, about two inches in from the action (or heading one of two columns), with dialogue
    // under it that starts further left.
    const placed = line.column ? line.indent >= 0.5 * INCH : line.indent >= 1.5 * INCH && line.indent < 3.2 * INCH;
    const next = below(lines, index);
    if (placed && isUpper(line.text) && next && next.x < line.x && next.indent > 0.3 * INCH) {
      const name = characterName(line.text);
      if (name !== '' && !current.characters.includes(name)) current.characters.push(name);
    }
  });
  close();
  return { title, scenes };
}
