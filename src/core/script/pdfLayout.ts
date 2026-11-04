import { characterName, eighthsFromLines, looksLikeHeading, parseHeading, type Script, type ScriptScene } from './script';

// A screenplay PDF read by its layout (1.18): a PDF has no "scene heading" or "character" marks, only text at places
// on the page. Screenplays are set to fixed rules (Courier 12 on a 1.5-inch left margin, character cues about two
// inches further in, dialogue one inch in, scene numbers outside the margins), so where a line starts says what it
// is. Free of pdf.js: the app turns a PDF into positioned text (src/features/script/readPdf.ts) and this reads that.

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
  /** Where the line's text starts, from the page's action margin, in points. */
  indent: number;
  text: string;
  /** A scene number printed outside the margins on this line, if any. */
  number: string | null;
}

/** Courier 12: 12 points a line, 7.2 points a character; 72 points an inch. */
const LINE = 12;
const CHAR = 7.2;
const INCH = 72;

/** A scene or page number: `12`, `12A`, `2.`. */
const NUMBER = /^\d+[A-Z]{0,2}\.?$/;

/** Lines that are the page's furniture, not the script. */
const FURNITURE = /^(\(MORE\)|\(CONTINUED\)|CONTINUED:?(\s*\(\d+\))?)$/i;

/** Runs on the same baseline (within 2 points), left to right; pages in order, each top to bottom. */
function rowsOf(items: readonly PdfText[]): Row[] {
  const rows = new Map<string, Row>();
  for (const item of items) {
    if (item.text.trim() === '') continue;
    const key = `${String(item.page)}:${String(Math.round(item.y / 2))}`;
    const row = rows.get(key) ?? { page: item.page, y: item.y, items: [] };
    row.items.push(item);
    rows.set(key, row);
  }
  for (const row of rows.values()) row.items.sort((a, b) => a.x - b.x);
  return [...rows.values()].sort((a, b) => a.page - b.page || b.y - a.y);
}

/** The page's action margin: the leftmost start that a good share of its lines have (numbers aside). */
function marginOf(rows: readonly Row[]): number {
  const starts = rows.map((row) => row.items.find((item) => !NUMBER.test(item.text.trim()))?.x).filter((x) => x !== undefined);
  const counts = new Map<number, number>();
  for (const x of starts) counts.set(Math.round(x / 4) * 4, (counts.get(Math.round(x / 4) * 4) ?? 0) + 1);
  const common = [...counts].filter(([, n]) => n >= Math.max(2, starts.length * 0.1)).map(([x]) => x);
  return common.length > 0 ? Math.min(...common) : Math.min(...starts, Infinity);
}

/** A row as a line: numbers outside the margins taken off as the scene number, the rest joined with spaces. */
function lineOf(row: Row, margin: number): Line | null {
  let number: string | null = null;
  const kept = row.items.filter((item) => {
    const text = item.text.trim();
    const outside = item.x < margin - 0.2 * INCH || item.x > margin + 5.5 * INCH;
    if (outside && NUMBER.test(text)) {
      // Page numbers end with a dot (`2.`); scene numbers don't.
      if (!text.endsWith('.')) number ??= text;
      return false;
    }
    return true;
  });
  const first = kept[0];
  if (!first) return null;
  let text = '';
  let end = -Infinity;
  for (const item of kept) {
    if (text !== '' && item.x - end > CHAR / 2 && !text.endsWith(' ') && !item.text.startsWith(' ')) text += ' ';
    text += item.text;
    end = item.x + item.width;
  }
  text = text.replace(/\s+/g, ' ').trim();
  if (text === '' || FURNITURE.test(text)) return null;
  return { page: row.page, y: row.y, indent: first.x - margin, text, number };
}

const isUpper = (text: string) => {
  const bare = text.replace(/\([^)]*\)/g, '').trim();
  return /[A-Z]/.test(bare) && bare === bare.toUpperCase();
};

/** A screenplay PDF's scenes, from its positioned text. The title is the first line of the first page, if any. */
export function parseScreenplayPdf(items: readonly PdfText[]): Script {
  const rows = rowsOf(items);
  const margins = new Map<number, number>();
  for (const page of new Set(rows.map((r) => r.page))) margins.set(page, marginOf(rows.filter((r) => r.page === page)));
  const lines = rows.map((row) => lineOf(row, margins.get(row.page) ?? 0)).filter((line): line is Line => line !== null);

  const scenes: ScriptScene[] = [];
  let current: (ScriptScene & { lines: number }) | null = null;
  let title: string | null = null;
  const close = () => {
    if (!current) return;
    const { lines: count, ...scene } = current;
    scenes.push({ ...scene, eighths: eighthsFromLines(count) });
  };
  lines.forEach((line, index) => {
    const previous = lines[index - 1];
    const next = lines[index + 1];
    if (line.indent < 0.5 * INCH && looksLikeHeading(line.text)) {
      close();
      current = { ...parseHeading(line.text), number: line.number, characters: [], eighths: 1, lines: 1 };
      return;
    }
    // Before the first scene: the title page, whose first line is the title.
    if (!current) {
      if (title === null && line.page === lines[0]?.page) title = line.text;
      return;
    }
    // Printed lines this one takes, with the blank lines above it on the same page.
    current.lines += previous && previous.page === line.page ? Math.max(1, Math.round((previous.y - line.y) / LINE)) : 1;
    // A character cue: in capitals, about two inches in from the action, with dialogue (less far in) under it.
    const cue = line.indent >= 1.5 * INCH && line.indent < 3.2 * INCH && isUpper(line.text);
    if (cue && next && next.page === line.page && next.indent < line.indent && next.indent > 0.3 * INCH) {
      const name = characterName(line.text);
      if (name !== '' && !current.characters.includes(name)) current.characters.push(name);
    }
  });
  close();
  return { title, scenes };
}
