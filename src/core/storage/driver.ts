import { refusedPicture } from '../media/cleanPicture';

// The one way into a .sbd. The desktop app talks to the Rust commands in src-tauri/src/sbd.rs (tauriDriver.ts); tests
// and, from Phase 7, the MCP server use Node's own SQLite (nodeDriver.ts). Both behave the same, so everything above
// this layer runs unchanged on either.

/** What SQLite stores. Objects and arrays go in as JSON text; bytes (images, schema 3) as Uint8Array. */
export type SqlValue = string | number | null | Uint8Array;

export type Row = Record<string, SqlValue>;

export interface Statement {
  sql: string;
  params?: readonly SqlValue[];
}

/**
 * The refusal when a sync replaced or rewrote the file while it was open (src-tauri/src/sbd.rs has the same text).
 * Nothing was written; the app reopens the new version.
 */
export const CHANGED_ON_DISK = 'The project file changed on disk since Storiiboard last saved it.';

// B3 (docs/DESKTOP_GAPS.md): sbd.rs refuses a query whose rows hold bytes and a blob read of anything but bytes. The
// test drivers refuse the same inputs in the same words through these two, so code that did either fails in a test
// and not only on the desktop.

/** sbd.rs's `to_json`: a value stored as a blob, empty or not, in any row of a query. NULL is no blob. */
export const QUERY_RETURNED_BYTES = "A query can't return bytes; read them with readBlob.";
/** sbd.rs's `read_blob`: the first column of the first row holds text or a number. */
export const NOT_BYTES = "That column doesn't hold bytes.";

/**
 * A query's rows, each as its values by position (before they become objects, so a column of the same name can't hide
 * one), refused as sbd.rs refuses them if any value is bytes (SQLite's own type, not the column's).
 */
export function refuseBytes<T extends readonly unknown[]>(rows: T[]): T[] {
  if (rows.some((values) => values.some((value) => value instanceof Uint8Array))) throw new Error(QUERY_RETURNED_BYTES);
  return rows;
}

/**
 * A blob read's answer from the first column of the first row (undefined: no row), as the page gets it from sbd.rs:
 * bytes, or null for NULL and for no row. An empty blob is null too, since sbd_read_blob answers no bytes for both and
 * tauriDriver.ts can't tell them apart. Text or a number is refused.
 */
export function blobOf(value: unknown): Uint8Array | null {
  if (value === undefined || value === null) return null;
  if (!(value instanceof Uint8Array)) throw new Error(NOT_BYTES);
  return value.length === 0 ? null : value;
}

/**
 * sbd.rs's refusal of a stored picture that carries anything but its own data and colour profile (6.27b), in the same
 * words as `error.pictureNotSaved`'s English, so localizeError shows it in the person's language.
 */
export const PICTURE_NOT_CLEAN = 'The picture couldn’t be saved: it holds more than a picture and its colour profile.';

/**
 * A statement read as SQLite lexes it (round 4): `named`, the text with every string literal emptied (names in quotes,
 * brackets or backticks, and comments, kept: a name there counts); `bare`, with comments and quoted names emptied too,
 * for what the statement's own code says. Null when a string, a quoted name or a comment never closes. sbd.rs's
 * `lexed` reads the same.
 */
/** A string's whole content that is a pictures table's name, in any case, with or without `main.`. */
const TABLE_NAME = /^(main\.)?(media_files|thumbnails)$/i;

/**
 * SQLite's own whitespace, ASCII only (space, tab, newline, carriage return, form feed and, as sbd.rs counts it, vertical
 * tab): JavaScript's \s and Rust's is_whitespace each take other characters too (U+FEFF, U+0085), and differently, so
 * neither is used, and both readers split a statement exactly alike (round 5).
 */
const SPACE = '[ \\t\\n\\r\\f\\v]';
const isSpace = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v';

function lexed(sql: string): { named: string; bare: string } | null {
  let named = '';
  let bare = '';
  let at = 0;
  const closing = (from: number, close: string, doubled: boolean): number => {
    let end = sql.indexOf(close, from);
    while (doubled && end >= 0 && sql.charAt(end + 1) === close) end = sql.indexOf(close, end + 2);
    return end;
  };
  while (at < sql.length) {
    const c = sql.charAt(at);
    const next = sql.charAt(at + 1);
    if (c === "'") {
      const end = closing(at + 1, "'", true);
      if (end < 0) return null;
      // SQLite takes a string where a table's name goes (`nm ::= STRING`): one that is wholly a pictures table's name
      // names it, as a quoted name does (round 5). A string that only holds the name among other words doesn't.
      const content = sql.slice(at + 1, end).replaceAll("''", "'");
      const table = TABLE_NAME.test(content);
      named += table ? `"${content}"` : "''";
      bare += table ? ' n ' : "''";
      at = end + 1;
    } else if (c === '"' || c === '`' || c === '[') {
      const end = closing(at + 1, c === '[' ? ']' : c, c !== '[');
      if (end < 0) return null;
      named += sql.slice(at, end + 1);
      bare += ' n ';
      at = end + 1;
    } else if (c === '-' && next === '-') {
      const newline = sql.indexOf('\n', at);
      const end = newline < 0 ? sql.length : newline;
      named += sql.slice(at, end);
      bare += ' ';
      at = end;
    } else if (c === '/' && next === '*') {
      const end = sql.indexOf('*/', at + 2);
      if (end < 0) return null;
      named += sql.slice(at, end + 2);
      bare += ' ';
      at = end + 2;
    } else {
      named += c;
      bare += c;
      at += 1;
    }
  }
  return { named, bare };
}

/**
 * Whether a statement names the stored pictures' tables, as sbd.rs's door tells them: by name, in any case, quoted or
 * not, anywhere but inside a string literal. A text that can't be lexed is judged on all of it.
 */
function namesPictures(sql: string): boolean {
  return /media_files|thumbnails/i.test(lexed(sql)?.named ?? sql);
}

/** More than one statement in the text: anything but space after a `;` in its own code (a string's or a comment's isn't). */
function holdsMore(sql: string): boolean {
  const read = lexed(sql);
  if (read === null) return true;
  const semicolon = read.bare.indexOf(';');
  if (semicolon < 0) return false;
  // Code unit by code unit, as sbd.rs reads the text after it char by char: any that isn't SQLite's whitespace.
  for (let at = semicolon + 1; at < read.bare.length; at += 1) if (!isSpace(read.bare.charAt(at))) return true;
  return false;
}

/** One piece of a statement, as the doors read it. */
type SqlToken =
  | { kind: 'word'; text: string }
  | { kind: 'param'; text: string }
  | { kind: 'number' | 'string' | 'punct'; text: string }
  | { kind: 'blob'; bytes: Uint8Array };

/**
 * A statement's pieces, or null for anything the doors don't read (a comment, a named parameter, an operator): words
 * and quoted names (lower case), `?` and `?N`, numbers, 'strings', x'hex' blobs and ( ) , ; - +. sbd.rs's
 * `sql_tokens` reads the same.
 */
function sqlTokens(sql: string): SqlToken[] | null {
  const tokens: SqlToken[] = [];
  let at = 0;
  const isWordStart = (c: string) => /[A-Za-z_]/.test(c);
  const isWord = (c: string) => /[A-Za-z0-9_]/.test(c);
  while (at < sql.length) {
    const c = sql.charAt(at);
    if (isSpace(c)) {
      at += 1;
    } else if ((c === 'x' || c === 'X') && sql.charAt(at + 1) === "'") {
      const close = sql.indexOf("'", at + 2);
      const hex = close < 0 ? '' : sql.slice(at + 2, close);
      if (close < 0 || hex.length % 2 !== 0 || !/^[0-9A-Fa-f]*$/.test(hex)) return null;
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      tokens.push({ kind: 'blob', bytes });
      at = close + 1;
    } else if (isWordStart(c)) {
      let end = at;
      while (end < sql.length && isWord(sql.charAt(end))) end += 1;
      tokens.push({ kind: 'word', text: sql.slice(at, end).toLowerCase() });
      at = end;
    } else if (c === '"' || c === '`' || c === '[') {
      const close = sql.indexOf(c === '[' ? ']' : c, at + 1);
      if (close < 0) return null;
      tokens.push({ kind: 'word', text: sql.slice(at + 1, close).toLowerCase() });
      at = close + 1;
    } else if (c === "'") {
      // '' inside a string is one quote.
      let end = at + 1;
      for (;;) {
        const close = sql.indexOf("'", end);
        if (close < 0) return null;
        if (sql.charAt(close + 1) === "'") {
          end = close + 2;
          continue;
        }
        end = close;
        break;
      }
      tokens.push({ kind: 'string', text: sql.slice(at + 1, end) });
      at = end + 1;
    } else if (c === '?') {
      let end = at + 1;
      while (end < sql.length && /[0-9]/.test(sql.charAt(end))) end += 1;
      tokens.push({ kind: 'param', text: sql.slice(at, end) });
      at = end;
    } else if (/[0-9]/.test(c)) {
      let end = at;
      while (end < sql.length && /[0-9.]/.test(sql.charAt(end))) end += 1;
      tokens.push({ kind: 'number', text: sql.slice(at, end) });
      at = end;
    } else if ('(),;-+'.includes(c)) {
      // A comment (-- or /*) isn't read.
      if (c === '-' && sql.charAt(at + 1) === '-') return null;
      tokens.push({ kind: 'punct', text: c });
      at += 1;
    } else {
      return null;
    }
  }
  return tokens;
}

/** A plain INSERT into a stored pictures' table, as the doors read it. */
interface PlainInsert {
  table: 'media_files' | 'thumbnails';
  /** The columns named, or null when the statement names none. */
  columns: string[] | null;
  /** Each row's values: a parameter, a number, a string, a blob or NULL. */
  rows: SqlToken[][];
}

/**
 * The one INSERT shape the doors check (6.27b, round 2): `INSERT [OR IGNORE] INTO media_files|thumbnails [(columns)]
 * VALUES (…)[, (…)]`, each value a parameter, a number, a string, an x'…' blob or NULL, nothing after but a `;`. Null
 * for anything else (a SELECT, a function, OR REPLACE, an upsert, RETURNING), which the doors refuse, since what it
 * writes can't be read off the statement. sbd.rs's `plain_insert` reads the same.
 */
function plainInsert(sql: string): PlainInsert | null {
  const tokens = sqlTokens(sql);
  if (!tokens) return null;
  let at = 0;
  const peek = () => tokens[at];
  const isWord = (text: string) => {
    const token = peek();
    return token?.kind === 'word' && token.text === text;
  };
  const isPunct = (text: string) => {
    const token = peek();
    return token?.kind === 'punct' && token.text === text;
  };
  if (!isWord('insert')) return null;
  at += 1;
  if (isWord('or')) {
    at += 1;
    if (!isWord('ignore')) return null;
    at += 1;
  }
  if (!isWord('into')) return null;
  at += 1;
  const named = peek();
  if (named?.kind !== 'word' || (named.text !== 'media_files' && named.text !== 'thumbnails')) return null;
  const table = named.text;
  at += 1;
  let columns: string[] | null = null;
  if (isPunct('(')) {
    columns = [];
    at += 1;
    for (;;) {
      const column = peek();
      if (column?.kind !== 'word') return null;
      columns.push(column.text);
      at += 1;
      if (isPunct(')')) break;
      if (!isPunct(',')) return null;
      at += 1;
    }
    at += 1;
  }
  if (!isWord('values')) return null;
  at += 1;
  const rows: SqlToken[][] = [];
  for (;;) {
    if (!isPunct('(')) return null;
    at += 1;
    const row: SqlToken[] = [];
    for (;;) {
      if (isPunct('-') || isPunct('+')) at += 1;
      const value = peek();
      const plain = value && (value.kind === 'param' || value.kind === 'number' || value.kind === 'string' || value.kind === 'blob' || (value.kind === 'word' && value.text === 'null'));
      if (!value || !plain) return null;
      row.push(value);
      at += 1;
      if (isPunct(')')) break;
      if (!isPunct(',')) return null;
      at += 1;
    }
    at += 1;
    if (columns && row.length !== columns.length) return null;
    rows.push(row);
    if (!isPunct(',')) break;
    at += 1;
  }
  if (isPunct(';')) at += 1;
  return at === tokens.length ? { table, columns, rows } : null;
}

/** DELETE FROM, which writes no picture. */
const deletes = (sql: string) => new RegExp(`^${SPACE}*delete${SPACE}+from(${SPACE}|$)`, 'i').test(sql);

/**
 * A table or an index made (a migration, 003 makes both tables), which writes no picture; never one made from a SELECT
 * or with AS (`CREATE TABLE … AS VALUES …` writes rows too). Ordinary writes only: the import writes rows alone.
 */
const makesSchema = (sql: string) =>
  new RegExp(`^${SPACE}*create${SPACE}+(unique${SPACE}+)?(table|index)(${SPACE}|$)`, 'i').test(sql) && !/(^|[^A-Za-z0-9_])(select|as)([^A-Za-z0-9_]|$)/i.test(sql);

/** Which door judges a statement: an ordinary write's, or Import project data's. */
export type Door = 'ordinary' | 'import';

/** A door's answer for a statement's text: read on (its values checked next), refused whole, or not about the pictures. */
export type DoorVerdict = 'allowed' | 'refused' | 'none';

/**
 * What a door says of a statement's text alone (round 4: one list both readers are tested against,
 * src-tauri/testdata/picture-statements.json; sbd.rs's `door_verdict` gives the same answers).
 */
export function doorVerdict(sql: string, door: Door): DoorVerdict {
  if (!namesPictures(sql)) return 'none';
  // Two statements in one text: the door would read the first alone, so it is refused whole.
  if (holdsMore(sql)) return 'refused';
  if (deletes(sql)) return 'allowed';
  if (door === 'ordinary' && makesSchema(sql)) return 'allowed';
  const insert = plainInsert(sql);
  if (!insert) return 'refused';
  if (door === 'ordinary' || insert.table === 'thumbnails') return 'allowed';
  // Import's media_files row: one placeholder per named column, sha256 and bytes among them, so its name can be checked.
  const [row, ...more] = insert.rows;
  const columns = insert.columns;
  const named = columns !== null && columns.includes('sha256') && columns.includes('bytes');
  return named && row && more.length === 0 && row.every((v) => v.kind === 'param' && v.text === '?') ? 'allowed' : 'refused';
}

/**
 * The door (6.27b; sbd.rs's `refuse_unclean_pictures`, in its own code): a transaction whose statement writes
 * media_files or thumbnails with bytes that are a JPEG or PNG by their first bytes, carrying any block outside the
 * keep-list (cleanPicture.ts), is refused whole. Bytes that aren't a picture (a PDF) are let through as they are. A
 * statement that names either table is a DELETE FROM, a table or index made, or the plain INSERT (plainInsert), whose
 * parameters and x'…' blobs are all read; any other (UPDATE, REPLACE, WITH …, INSERT … SELECT) is refused, since what
 * it writes can't be read off it. The test drivers call this before they write, so a test of an unclean write fails as
 * the app would.
 */
export function refuseUncleanPictures(statements: readonly Statement[]): void {
  for (const { sql, params = [] } of statements) {
    const verdict = doorVerdict(sql, 'ordinary');
    if (verdict === 'none') continue;
    if (verdict === 'refused') throw new Error(PICTURE_NOT_CLEAN);
    const insert = plainInsert(sql);
    // A DELETE FROM or a table made: nothing written to check.
    if (!insert) continue;
    const literals = insert.rows.flat().flatMap((value) => (value.kind === 'blob' ? [value.bytes] : []));
    const blobs = [...params.filter((param): param is Uint8Array => param instanceof Uint8Array), ...literals];
    if (blobs.some((bytes) => refusedPicture(bytes))) throw new Error(PICTURE_NOT_CLEAN);
  }
}

/** sbd.rs's import refusal of a picture that isn't the one its name says, in `error.importPictureMisnamed`'s words. */
export const IMPORT_PICTURE_MISNAMED = 'The project data can’t be imported: a picture in it isn’t the one its name says. Nothing was imported.';

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The import's own door (6.27b; sbd.rs's `refuse_misnamed_pictures`, in its own code): Import project data writes
 * pictures as they came, so each row it puts in media_files must be the picture its sha256 names, or the import is
 * refused whole. Its statements are `INSERT INTO "media_files" (<columns>) VALUES (?, …)` (projectJson.ts); one that
 * writes the table in another shape can't be checked and is refused. A thumbnail's sha256 names its picture, not its
 * own bytes, so thumbnails are named by their picture's row. Any other statement that names either table is refused
 * too, but DELETE FROM and a thumbnail's plain INSERT (plainInsert): UPDATE, REPLACE, WITH …, INSERT … SELECT.
 */
export async function refuseMisnamedPictures(statements: readonly Statement[]): Promise<void> {
  for (const { sql, params = [] } of statements) {
    const verdict = doorVerdict(sql, 'import');
    if (verdict === 'none') continue;
    if (verdict === 'refused') throw new Error(IMPORT_PICTURE_MISNAMED);
    const insert = plainInsert(sql);
    // A DELETE FROM, or a thumbnail's row (its sha256 names its picture's row): nothing to check against a name.
    if (!insert || insert.table === 'thumbnails') continue;
    const columns = insert.columns ?? [];
    if (params.length !== columns.length) throw new Error(IMPORT_PICTURE_MISNAMED);
    const sha = params[columns.indexOf('sha256')];
    const bytes = params[columns.indexOf('bytes')];
    if (typeof sha !== 'string' || !(bytes instanceof Uint8Array) || (await sha256Hex(bytes)) !== sha) throw new Error(IMPORT_PICTURE_MISNAMED);
  }
}

/** How a transaction is written. */
export interface TxOptions {
  /**
   * Import project data (projectJson.ts): the rows of a project as an older build stored them, whose pictures may carry
   * what a picture stored now can't. Their SHA-256 is their name, so they are written as they came, past the door,
   * once each is checked against its name (refuseMisnamedPictures); in the desktop app through its own command,
   * `sbd_import_tx_raw`. Every other write keeps the door.
   */
  imported?: boolean;
}

/** Another computer that has a project open now, from the lock file next to it (src-tauri/src/lock.rs). */
export interface LockHolder {
  computer: string;
  /** When it opened the project, in ms since the epoch. */
  openedAt: number;
}

/** A scheduled backup goes to `Backups/` next to the project; a migration backup sits beside the file. */
export type BackupKind = 'scheduled' | 'migration';

/** One of a project's scheduled backups. */
export interface BackupFile {
  name: string;
  /**
   * The space only this backup takes, which is what deleting it would free: all of a full copy, and for an APFS clone
   * on a Mac, only what no other file shares, which starts at nothing (src-tauri/src/backup.rs).
   */
  bytes: number;
}

/**
 * An open project file. Every write first checks the file is still the one this app last wrote, and refuses with
 * CHANGED_ON_DISK if not. Opening writes a lock file next to it.
 */
export interface ProjectFile {
  readonly path: string;
  /**
   * The desktop app's handle for this open file, which Rust commands outside storage take to check what the project
   * links: a video record's file may be read because the project names it (src-tauri/src/video.rs). Absent elsewhere.
   */
  readonly nativeHandle?: number;
  /**
   * Runs every statement in one transaction: all of them land, or none do. A stored picture that carries more than its
   * own data and colour profile is refused (PICTURE_NOT_CLEAN), unless `options.imported`.
   */
  tx(statements: readonly Statement[], options?: TxOptions): Promise<void>;
  query(sql: string, params?: readonly SqlValue[]): Promise<Row[]>;
  /**
   * The bytes in the first column of the first row (an image or a thumbnail), or null when there's no such row or
   * they are NULL or empty; refused (NOT_BYTES) when that column holds text or a number.
   * Rows from `query` travel as JSON in the desktop app, which can't carry bytes, so they come this way, and a query
   * whose rows hold bytes is refused (QUERY_RETURNED_BYTES).
   */
  readBlob(sql: string, params?: readonly SqlValue[]): Promise<Uint8Array | null>;
  /**
   * Writes a consistent copy of the open file: in the desktop app an APFS clone where it can, otherwise a full copy
   * made a few pages at a time so edits go on meanwhile. Only a file name is passed; the driver puts it in the right
   * folder and refuses any name that isn't one of this project's own backup names (backups.ts makes them).
   */
  backup(kind: BackupKind, fileName: string): Promise<void>;
  /**
   * Compact project (1.27): rewrites the file without its free space (SQLite's VACUUM), in place. One write through
   * SQLite's journal, so a crash or a kill partway leaves the file as it was. Refused, like a write, if a sync has
   * replaced the file. Make a backup first (src/core/storage/compact.ts does).
   */
  compact(): Promise<void>;
  /** This project's scheduled backups, in name order, with the space each takes. */
  listBackups(): Promise<BackupFile[]>;
  deleteBackup(fileName: string): Promise<void>;
  /**
   * Decides where scheduled backups go and returns the folder: `Backups/` beside the project, or for a project in a
   * synced folder, a folder on this computer unless `nextToProject` (the person's setting).
   */
  placeBackups(nextToProject: boolean): Promise<string>;
  /** The folder this project's scheduled backups go to. */
  backupsFolder(): Promise<string>;
  /** Opens the backups folder in Finder or Explorer. */
  showBackups(): Promise<void>;
  /**
   * Open version (1.23): writes a consistent copy of the open project to `dest`, a new file, through this connection,
   * with the same check as a write, so a file a sync has replaced is never copied as if it were current. Refuses to
   * overwrite. The copy is a draft: the driver's keepCopy names it once it's ready, or dropCopy deletes it.
   */
  saveCopy(dest: string): Promise<void>;
  /** Rewrites this computer's lock file, so another computer sees the project is still open here. */
  refreshLock(): Promise<void>;
  /** Closes the file and removes its lock. */
  close(): Promise<void>;
}

export interface SqlDriver {
  /** Makes a new, empty .sbd; refuses if a file is already there. */
  create(path: string): Promise<ProjectFile>;
  open(path: string): Promise<ProjectFile>;
  /**
   * Copies a .sbd that isn't open, such as a backup, to a new file with VACUUM INTO, for Open backup. Refuses to
   * overwrite anything.
   */
  copy(source: string, dest: string): Promise<void>;
  /**
   * Gives a closed draft that saveCopy wrote its name, refusing a name already taken. Nothing but this driver's own
   * drafts can be renamed this way.
   */
  keepCopy(draft: string, dest: string): Promise<void>;
  /** Deletes a closed draft that saveCopy wrote, after a failure partway. Nothing else can be deleted this way. */
  dropCopy(draft: string): Promise<void>;
  /** Another computer with this project open now, or null. Asked before opening, so the person can choose. */
  lockHolder(path: string): Promise<LockHolder | null>;
}
