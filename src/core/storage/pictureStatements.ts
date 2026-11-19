import LIST from '../../../src-tauri/testdata/picture-statements.json';
import type { DoorVerdict } from './driver';

// The one list of statements the stored pictures' doors are judged on (6.27b round 4, Kevin Nov 18), read by the
// tests on both sides and by the memory driver, which is dev only: nothing here reaches the desktop app's bundle, since
// only memoryDriver.ts and tests import this file.

export interface PictureStatement {
  source: 'app' | 'query' | 'case';
  sql: string;
  ordinary: DoorVerdict;
  import: DoorVerdict;
}

export const PICTURE_STATEMENTS: readonly PictureStatement[] = LIST.statements as PictureStatement[];

/**
 * A statement's shape: every value written into it (a 'string', an x'…' blob, a number) and every `?N` as `?`, every
 * run of whitespace as one space. Names, quoted or not, stay as they are.
 */
export function statementShape(sql: string): string {
  let out = '';
  let at = 0;
  const isWord = (c: string) => /[A-Za-z0-9_$]/.test(c);
  while (at < sql.length) {
    const c = sql.charAt(at);
    if (c === "'" || ((c === 'x' || c === 'X') && sql.charAt(at + 1) === "'" && !isWord(sql.charAt(at - 1)))) {
      // A string or a blob: to its closing quote ('' inside is one quote).
      let end = sql.indexOf("'", c === "'" ? at + 1 : at + 2);
      while (end >= 0 && sql.charAt(end + 1) === "'") end = sql.indexOf("'", end + 2);
      if (end < 0) return out + sql.slice(at);
      out += '?';
      at = end + 1;
    } else if (c === '"' || c === '`' || c === '[') {
      const end = sql.indexOf(c === '[' ? ']' : c, at + 1);
      if (end < 0) return out + sql.slice(at);
      out += sql.slice(at, end + 1);
      at = end + 1;
    } else if (c === '?') {
      at += 1;
      while (/[0-9]/.test(sql.charAt(at))) at += 1;
      out += '?';
    } else if (/[0-9]/.test(c) && !isWord(sql.charAt(at - 1))) {
      while (/[0-9.]/.test(sql.charAt(at))) at += 1;
      out += '?';
    } else if (/\s/.test(c)) {
      while (/\s/.test(sql.charAt(at))) at += 1;
      out += ' ';
    } else {
      out += c;
      at += 1;
    }
  }
  return out.trim();
}

/** An INSERT's shape with every value a placeholder: its head, its columns and its VALUES. */
const PLACEHOLDER_INSERT = /^(INSERT (?:OR IGNORE )?INTO [^ ]+ )\(([^()]*)\)( VALUES \(\?(?:, \?)*\))$/i;

/**
 * An INSERT's shape with its columns in name order, when every value is a placeholder (round 5): Import project data
 * writes each table's columns in the order its JSON gives them, so a file with them reordered writes the same rows.
 * Any other shape comes back as it is.
 */
export function columnsSorted(shape: string): string {
  const match = PLACEHOLDER_INSERT.exec(shape);
  if (!match) return shape;
  const key = (column: string) => column.replace(/^["`[]|["`\]]$/g, '').toLowerCase();
  const columns = (match[2] ?? '').split(',').map((column) => column.trim());
  columns.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  return `${match[1] ?? ''}(${columns.join(', ')})${match[3] ?? ''}`;
}

/** The list's shapes, and the same with an INSERT's columns in name order. */
const LISTED_SHAPES: ReadonlySet<string> = new Set(PICTURE_STATEMENTS.map((entry) => statementShape(entry.sql)));
const LISTED_SORTED: ReadonlySet<string> = new Set([...LISTED_SHAPES].map(columnsSorted));

/** Whether a statement's shape is on the list, an INSERT's columns in any order. For the memory driver's check. */
export function isListedShape(shape: string): boolean {
  return LISTED_SHAPES.has(shape) || LISTED_SORTED.has(columnsSorted(shape));
}
