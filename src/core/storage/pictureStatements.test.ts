import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { doorVerdict, type DoorVerdict, type SqlValue } from './driver';
import { createMemoryDriver } from './memoryDriver';
import { createProject } from './project';
import { PICTURE_STATEMENTS, statementShape } from './pictureStatements';

// One list both statement readers are tested against (6.27b round 4, Kevin Nov 18): src-tauri/testdata/
// picture-statements.json. This side reads it with driver.ts's doorVerdict; sbd.rs's tests read the same file with
// `door_verdict`. A second test fails when src/ gains an SQL text naming media_files or thumbnails that isn't on it.

describe('the shared list of statements the pictures’ doors judge', () => {
  it('gives every entry its verdict, for the ordinary door and the import’s', () => {
    const wrong: string[] = [];
    for (const entry of PICTURE_STATEMENTS) {
      for (const door of ['ordinary', 'import'] as const) {
        const got: DoorVerdict = doorVerdict(entry.sql, door);
        if (got !== entry[door]) wrong.push(`${door}: ${JSON.stringify(entry.sql)} gave ${got}, the list says ${entry[door]}`);
      }
    }
    expect(wrong).toEqual([]);
    expect(PICTURE_STATEMENTS.length).toBeGreaterThan(40);
  });
});

const SRC = fileURLToPath(new URL('../../', import.meta.url));
/** A statement's first word: what makes a literal an SQL text rather than a table's name alone. */
const SQL_START = /^\s*(select|insert|delete|create|update|replace|with|alter|drop|pragma)\b/i;

/** Every string and template literal in a source file, a template's `${…}` written as `${}`, whitespace runs as one space. */
function literals(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    let text: string | null = null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
    else if (ts.isTemplateExpression(node)) text = node.head.text + node.templateSpans.map((span) => `\${}${span.literal.text}`).join('');
    if (text !== null) found.push(text.replace(/\s+/g, ' ').trim());
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe('the memory driver’s check at run time', () => {
  it('says a statement naming the tables that isn’t on the list as a console error, in a page; the app’s own are quiet', async () => {
    const wasm = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm');
    const driver = await createMemoryDriver({ wasm });
    const project = await createProject('/memory/Quay.sbd', { driver, backups: false });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // As in a page: the check runs only where there is a document.
    vi.stubGlobal('document', {});
    try {
      // The app's own picture rows, as store.ts writes them, values and all: quiet.
      await project.file.tx([
        {
          sql: `INSERT OR IGNORE INTO media_files (id, sha256, bytes, mime, width, height, byte_size, color_space,
          created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          params: ['m1', 'a'.repeat(64), new Uint8Array([1, 2]), 'application/octet-stream', 1, 1, 2, '', '', ''],
        },
        { sql: 'DELETE FROM media_files WHERE sha256 IN (SELECT value FROM json_each(?))', params: ['[]'] },
      ]);
      expect(errors).not.toHaveBeenCalled();
      // A shape the list doesn't have: said, though the door lets it by.
      await project.file.tx([{ sql: 'DELETE FROM media_files WHERE id = ?', params: ['m1'] }]);
      expect(errors).toHaveBeenCalledTimes(1);
      expect(String(errors.mock.calls[0]?.[0])).toContain('DELETE FROM media_files WHERE id = ?');
    } finally {
      vi.unstubAllGlobals();
      errors.mockRestore();
      await project.close();
    }
  });
});

/**
 * The files reviewed to build statements or name the tables in their own code (round 5), each with why:
 * - projectJson.ts writes and reads every table by the name the file's own schema gives (`INSERT INTO ${quote(name)}`):
 *   its rows reach the doors as any other, and the memory driver's run-time check holds them to the list.
 * - driver.ts is the doors' own reader: it names the two tables to tell a plain INSERT into them.
 */
const REVIEWED = new Set(['core/storage/projectJson.ts', 'core/storage/driver.ts']);
/** The list's own texts from the app (sent, or read), as the scan matches them: a test's case on the list isn't the app's. */
const APP_TEXTS: ReadonlySet<string> = new Set(PICTURE_STATEMENTS.filter((entry) => entry.source !== 'case').map((entry) => entry.sql));
/** A table's name built in at run time, right after the word that takes one. */
const BUILT_NAME = /\b(into|from|update|table|on)\s+\$\{\}/i;

/**
 * What the scan finds in one source file: its SQL texts naming either table, and every problem. A problem is such a
 * text not on the list; or, outside REVIEWED, an SQL text taking a table's name from `${…}`, or a literal that is a
 * table's name alone (outside a file whose SQL texts are on the list, which names them in its own statements).
 */
function scanSource(file: string, text: string, listed: ReadonlySet<string>): { found: number; problems: string[] } {
  const problems: string[] = [];
  let found = 0;
  let listedHere = false;
  const names: string[] = [];
  for (const literal of literals(file, text)) {
    const sql = SQL_START.test(literal);
    if (sql && /media_files|thumbnails/i.test(literal)) {
      found += 1;
      if (listed.has(literal)) listedHere = true;
      else problems.push(`${file}: not on the list: ${literal}`);
    }
    if (REVIEWED.has(file)) continue;
    if (sql && BUILT_NAME.test(literal)) problems.push(`${file}: a table's name built at run time: ${literal}`);
    if (/^(main\.)?(media_files|thumbnails)$/i.test(literal)) names.push(literal);
  }
  if (!listedHere) for (const name of names) problems.push(`${file}: a table's name alone: ${name}`);
  return { found, problems };
}

describe('the run-time check and an import’s columns (round 5)', () => {
  it('stays quiet for an import whose JSON gives the columns in another order, and still says an unlisted column set', async () => {
    const wasm = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm');
    const driver = await createMemoryDriver({ wasm });
    const project = await createProject('/memory/Quay.sbd', { driver, backups: false });
    const bytes = new TextEncoder().encode('%PDF-1.7\n% recce');
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const sha = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('document', {});
    try {
      // As fillStatements writes a row, the columns in the JSON's order: bytes first, sha256 last.
      const columns = ['bytes', 'updated_at', 'created_at', 'color_space', 'byte_size', 'height', 'width', 'mime', 'id', 'sha256'];
      const values: Record<string, SqlValue> = { bytes, updated_at: '', created_at: '', color_space: '', byte_size: bytes.length, height: 0, width: 0, mime: 'application/pdf', id: 'm1', sha256: sha };
      await project.file.tx(
        [{ sql: `INSERT INTO "media_files" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`, params: columns.map((c) => values[c] ?? null) }],
        { imported: true },
      );
      expect(errors).not.toHaveBeenCalled();
      const [row] = await project.file.query('SELECT count(*) AS n FROM media_files');
      expect(Number(row?.n)).toBe(1);
      // Another column set (one missing) isn't the list's in any order: said.
      await project.file.tx([{ sql: 'DELETE FROM "media_files"' }], { imported: true });
      const fewer = columns.filter((c) => c !== 'color_space');
      await expect(
        project.file.tx(
          [{ sql: `INSERT INTO "media_files" (${fewer.map((c) => `"${c}"`).join(', ')}) VALUES (${fewer.map(() => '?').join(', ')})`, params: fewer.map((c) => values[c] ?? null) }],
          { imported: true },
        ),
      ).rejects.toThrow();
      expect(errors).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
      errors.mockRestore();
      await project.close();
    }
  });
});

describe('every SQL text in src/ that names the pictures’ tables is on the list', () => {
  it('finds none missing, migrations included, and no table built or named outside the reviewed files', () => {
    const listed = APP_TEXTS;
    const problems: string[] = [];
    let found = 0;
    for (const file of sourceFiles(SRC)) {
      const scanned = scanSource(relative(SRC, file).replaceAll('\\', '/'), readFileSync(file, 'utf8'), listed);
      found += scanned.found;
      problems.push(...scanned.problems);
    }
    expect(problems).toEqual([]);
    // The scan finds the app's own: store.ts, ops.ts, the migration, attachmentEdits.ts and the reads.
    expect(found).toBeGreaterThan(15);
  });

  it('catches a planted statement off the list, a table built at run time and a table’s name alone (round 5)', () => {
    const listed = APP_TEXTS;
    const planted = [
      'export const a = `UPDATE media_files SET bytes = ?`;',
      'export const b = (table: string) => `DELETE FROM ${table} WHERE id = ?`;',
      'export const c = (table: string) => `CREATE INDEX i ON ${table} (sha256)`;',
      "export const d = 'thumbnails';",
      "export const e = `No accent near ${'x'} passes AA on ${'y'}.`;",
    ].join('\n');
    const { problems } = scanSource('features/planted.ts', planted, listed);
    expect(problems).toEqual([
      'features/planted.ts: not on the list: UPDATE media_files SET bytes = ?',
      "features/planted.ts: a table's name built at run time: DELETE FROM ${} WHERE id = ?",
      "features/planted.ts: a table's name built at run time: CREATE INDEX i ON ${} (sha256)",
      "features/planted.ts: a table's name alone: thumbnails",
    ]);
    // The same text in a reviewed file: only what the list itself needs.
    expect(scanSource('core/storage/projectJson.ts', planted, listed).problems).toEqual(['core/storage/projectJson.ts: not on the list: UPDATE media_files SET bytes = ?']);
  });

  it('knows a shape with its values as placeholders, whatever the values', () => {
    expect(statementShape(`INSERT  INTO media_files (sha256, bytes)\n VALUES ('ab''c', x'FFD8', 12, -3.5, ?1)`)).toBe(
      'INSERT INTO media_files (sha256, bytes) VALUES (?, ?, ?, -?, ?)',
    );
    expect(statementShape(`INSERT OR IGNORE INTO media_files (id, sha256, bytes, mime, width, height, byte_size, color_space, created_at, updated_at)
      VALUES (?, ?, ?, 'application/pdf', 0, 0, ?, '', ?, ?)`)).toBe(
      statementShape("INSERT OR IGNORE INTO media_files (id, sha256, bytes, mime, width, height, byte_size, color_space, created_at, updated_at) VALUES (?, ?, ?, 'application/pdf', 0, 0, ?, '', ?, ?)"),
    );
  });
});
