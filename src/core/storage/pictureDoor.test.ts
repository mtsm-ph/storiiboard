import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { localizeError, setLocale } from '../i18n';
import { en } from '../i18n/locales/en';
import { readOriginal, readThumbnail } from '../media/store';
import { apply, loadRecords } from '../ops/ops';
import { IMPORT_PICTURE_MISNAMED, PICTURE_NOT_CLEAN, type Statement } from './driver';
import { createMemoryDriver } from './memoryDriver';
import { createProject, openProject } from './project';
import { importProjectJson, projectJsonBytes, readProjectJson } from './projectJson';

// The door (6.27b), in the end-to-end tests' driver as sbd.rs has it: a stored picture that carries more than its own
// data and colour profile is refused whole, so a test of an unclean write fails as the app would. Import project data
// writes past it, so a project an older build stored (its pictures carrying what they carried) comes back as it was.

const wasm = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm');
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../../src-tauri/testdata/pictures/${name}`, import.meta.url)));
const RAW = fixture('webkit-encoded-1.jpg');
const CLEAN = fixture('webkit-encoded-1.clean.jpg');
const at = '2026-11-18T12:00:00.000Z';

/** A picture and its thumbnail, as store.ts's imageStatements write them. */
function picture(sha256: string, bytes: Uint8Array, thumbnail: Uint8Array = bytes, mime = 'image/jpeg'): Statement[] {
  return [
    {
      // One placeholder per column, as Import project data writes its rows, so the import's door can read it too.
      sql: `INSERT OR IGNORE INTO media_files (id, sha256, bytes, mime, width, height, byte_size, color_space, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [`m-${sha256.slice(0, 4)}`, sha256, bytes, mime, 640, 345, bytes.length, 'display-p3', at, at],
    },
    {
      sql: `INSERT OR IGNORE INTO thumbnails (id, sha256, long_edge, bytes, mime, width, height, created_at, updated_at)
        VALUES (?, ?, 640, ?, 'image/jpeg', 640, 345, ?, ?)`,
      params: [`t-${sha256.slice(0, 4)}`, sha256, thumbnail, at, at],
    },
  ];
}

async function countPictures(file: { query: (sql: string) => Promise<Record<string, unknown>[]> }) {
  const [files] = await file.query('SELECT count(*) AS n FROM media_files');
  const [thumbs] = await file.query('SELECT count(*) AS n FROM thumbnails');
  return [Number(files?.n), Number(thumbs?.n)];
}

describe('the memory driver’s door (6.27b)', () => {
  it('refuses a stored picture with an Exif block, whole and in the app’s words; lets its clean copy and a PDF through', async () => {
    const driver = await createMemoryDriver({ wasm });
    const project = await createProject('/memory/Quay.sbd', { driver, backups: false });
    const file = project.file;
    // The raw WebKit JPEG as the picture, as the thumbnail, or beside a frame's edit: refused, and nothing lands.
    await expect(file.tx(picture('a'.repeat(64), RAW))).rejects.toThrow(PICTURE_NOT_CLEAN);
    await expect(file.tx(picture('a'.repeat(64), CLEAN, RAW))).rejects.toThrow(PICTURE_NOT_CLEAN);
    await expect(
      apply(file, [{ kind: 'create', record: { id: 's1', type: 'note', parentId: project.projectId, sortKey: 'a', props: { text: 'x' } } }], {
        alsoWrite: picture('a'.repeat(64), RAW),
      }),
    ).rejects.toThrow(PICTURE_NOT_CLEAN);
    expect(await countPictures(file)).toEqual([0, 0]);
    expect((await loadRecords(file)).some((record) => record.id === 's1')).toBe(false);
    // A PNG with a text chunk: refused too.
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 1, ...Array.from('tEXt', (c) => c.charCodeAt(0)), 0, 0, 0, 0, 0]);
    await expect(file.tx(picture('b'.repeat(64), png))).rejects.toThrow(PICTURE_NOT_CLEAN);
    // The clean copy is written; so is a PDF (not a picture: kept as it is).
    await file.tx(picture('c'.repeat(64), CLEAN));
    await file.tx(picture('d'.repeat(64), new TextEncoder().encode('%PDF-1.7\n%…')));
    expect(await countPictures(file)).toEqual([2, 2]);
    expect((await readOriginal(file, 'c'.repeat(64)))?.bytes).toEqual(CLEAN);
    await project.close();
  });

  it('refuses in the words of error.pictureNotSaved, so the page says it in the person’s language', () => {
    expect(PICTURE_NOT_CLEAN).toBe(en['error.pictureNotSaved']);
    setLocale('es');
    expect(localizeError(PICTURE_NOT_CLEAN)).toBe('No se pudo guardar la imagen: contiene algo más que la imagen y su perfil de color.');
    setLocale('en');
    expect(localizeError(PICTURE_NOT_CLEAN)).toBe(PICTURE_NOT_CLEAN);
  });
});

describe('Import project data of a project an older build stored', () => {
  it('brings back a picture that carries an Exif block as it was, under its own name, and the project opens', async () => {
    const driver = await createMemoryDriver({ wasm });
    // An older build's project: its picture stored as the webview encoded it, Exif block and all. Written here past the
    // door, as only an import can.
    const older = await createProject('/memory/Quay.sbd', { driver, backups: false });
    const sha = await sha256Hex(RAW);
    await older.file.tx(picture(sha, RAW), { imported: true });
    await apply(older.file, [
      { kind: 'create', record: { id: 'sc1', type: 'scene', parentId: older.projectId, sortKey: 'a', props: { number: '1' } } },
      { kind: 'create', record: { id: 's1', type: 'shot', parentId: 'sc1', sortKey: 'a', props: { number: '1A', media_id: 'p1' } } },
      { kind: 'create', record: { id: 'p1', type: 'media', parentId: 's1', sortKey: 'a', props: { kind: 'image', file: sha, mime: 'image/jpeg', width: 640, height: 345 } } },
    ]);
    const text = new TextDecoder().decode(await projectJsonBytes(older.file, new Date(at), undefined, undefined, 'project_data'));
    await older.close();

    await importProjectJson(driver, '/memory/Quay imported.sbd', readProjectJson(text), new Date(at));
    const imported = await openProject('/memory/Quay imported.sbd', { driver, backups: false });
    // The same bytes, Exif block included, under the same SHA-256; the frame still names it.
    expect((await readOriginal(imported.file, sha))?.bytes).toEqual(RAW);
    expect((await readThumbnail(imported.file, sha))?.bytes).toEqual(RAW);
    expect((await loadRecords(imported.file)).find((record) => record.id === 'p1')?.props.file).toBe(sha);
    // And the imported project takes edits as any other: the door still stands for new pictures.
    await apply(imported.file, [{ kind: 'update', id: 's1', set: { notes: 'Golden hour' } }]);
    await expect(imported.file.tx(picture('f'.repeat(64), RAW))).rejects.toThrow(PICTURE_NOT_CLEAN);
    await imported.close();
  });

  it('leaves out a picture that isn’t the one its name says and imports the rest; the door still refuses one whole (round 3)', async () => {
    const driver = await createMemoryDriver({ wasm });
    const older = await createProject('/memory/Quay.sbd', { driver, backups: false });
    const sha = await sha256Hex(RAW);
    await older.file.tx(picture(sha, RAW), { imported: true });
    await apply(older.file, [{ kind: 'create', record: { id: 'p1', type: 'media', parentId: older.projectId, sortKey: 'a', props: { kind: 'image', file: sha, mime: 'image/jpeg', width: 640, height: 345 } } }]);
    const data = readProjectJson(new TextDecoder().decode(await projectJsonBytes(older.file, new Date(at))));
    await older.close();
    // One byte of the picture changed in the JSON: its name no longer says it.
    const files = data.tables.media_files;
    const bytesAt = files?.columns.indexOf('bytes') ?? -1;
    const row = files?.rows[0];
    const cell = row?.[bytesAt];
    if (!files || !row || cell === null || typeof cell !== 'object') throw new Error('no picture row');
    const changed = Buffer.from(cell.base64, 'base64');
    changed[changed.length - 3] = (changed[changed.length - 3] ?? 0) ^ 1;
    const tampered = { ...data, tables: { ...data.tables, media_files: { ...files, rows: [row.map((value, i) => (i === bytesAt ? { base64: changed.toString('base64') } : value))] } } };
    const report = await importProjectJson(driver, '/memory/Tampered.sbd', tampered, new Date(at));
    expect(report).toEqual({ leftOut: [{ sha256: sha, picture: true }], pictures: 1, files: 0 });
    // The picture and its thumbnail are left out, under any name; the record that shows it stays, and shows it missing.
    const left = await openProject('/memory/Tampered.sbd', { driver, backups: false });
    expect(await countPictures(left.file)).toEqual([0, 0]);
    expect((await loadRecords(left.file)).find((record) => record.id === 'p1')?.props.file).toBe(sha);
    expect(await readOriginal(left.file, sha)).toBeNull();
    await left.close();
    // The door is still the backstop: a mismatched row that reaches it refuses the whole transaction, nothing written.
    const backstop = await createProject('/memory/Backstop.sbd', { driver, backups: false });
    await expect(backstop.file.tx(picture('0'.repeat(64), RAW), { imported: true })).rejects.toThrow(IMPORT_PICTURE_MISNAMED);
    expect(await countPictures(backstop.file)).toEqual([0, 0]);
    await backstop.close();
    // The words are error.importPictureMisnamed's, so the page says them in the person's language.
    expect(IMPORT_PICTURE_MISNAMED).toBe(en['error.importPictureMisnamed']);
    // A statement that writes media_files in a shape the door can't read is refused too.
    const fresh = await createProject('/memory/Fresh.sbd', { driver, backups: false });
    await expect(fresh.file.tx([{ sql: `INSERT INTO media_files SELECT * FROM media_files` }], { imported: true })).rejects.toThrow(IMPORT_PICTURE_MISNAMED);
    await fresh.close();
  });
});

describe('what the door reads (Kevin, Nov 18, late)', () => {
  it('judges a picture by its bytes, never by the type its row claims', async () => {
    const driver = await createMemoryDriver({ wasm });
    const project = await createProject('/memory/Quay.sbd', { driver, backups: false });
    const [row] = picture('a'.repeat(64), RAW, RAW, 'application/pdf');
    if (!row) throw new Error('no statement');
    expect(row.params).toContain('application/pdf');
    await expect(project.file.tx([row])).rejects.toThrow(PICTURE_NOT_CLEAN);
    expect(await countPictures(project.file)).toEqual([0, 0]);
    await project.close();
  });
});

describe('statement shapes (6.27b, round 2)', () => {
  it('refuses UPDATE, REPLACE, WITH … INSERT and any shape but DELETE FROM and the plain INSERT, through both doors', async () => {
    const driver = await createMemoryDriver({ wasm });
    const project = await createProject('/memory/Quay.sbd', { driver, backups: false });
    const file = project.file;
    await file.tx(picture('a'.repeat(64), CLEAN));
    const shapes = [
      'UPDATE media_files SET bytes = ?',
      'update THUMBNAILS set bytes = ?',
      `REPLACE INTO media_files (id, sha256, bytes, mime, width, height, byte_size, color_space, created_at, updated_at) VALUES ('m2', 'b', ?, 'image/jpeg', 1, 1, 1, '', '', '')`,
      `INSERT OR REPLACE INTO thumbnails (id, sha256, long_edge, bytes, mime, width, height, created_at, updated_at) VALUES ('t2', 'a', 1, ?, 'image/jpeg', 1, 1, '', '')`,
      `WITH p(b) AS (SELECT ?) INSERT INTO thumbnails (id, sha256, long_edge, bytes, mime, width, height, created_at, updated_at) SELECT 't2', 'a', 1, b, 'image/jpeg', 1, 1, '', '' FROM p`,
      `INSERT INTO thumbnails (id, sha256, long_edge, bytes, mime, width, height, created_at, updated_at) VALUES ('t2', 'a', 1, ?, 'image/jpeg', 1, 1, '', '') ON CONFLICT DO NOTHING`,
      `INSERT INTO thumbnails (id, sha256, long_edge, bytes, mime, width, height, created_at, updated_at) VALUES ('t2', 'a', 1, CAST(? AS BLOB), 'image/jpeg', 1, 1, '', '')`,
      'CREATE TABLE copied AS SELECT * FROM media_files',
      'CREATE TABLE thumbnails_copy AS VALUES (?)',
      'ALTER TABLE thumbnails ADD COLUMN note TEXT',
    ];
    const note: Statement = { sql: `INSERT INTO meta (id, key, value, created_at, updated_at) VALUES ('m-probe', 'door_probe', 'x', '', '')` };
    // The same edit alone goes in, so its absence below is the door's doing.
    await file.tx([note, { sql: `DELETE FROM meta WHERE key = 'door_probe'` }]);
    for (const sql of shapes) {
      await expect(file.tx([note, { sql, params: [CLEAN] }]), sql).rejects.toThrow(PICTURE_NOT_CLEAN);
      await expect(file.tx([note, { sql, params: [CLEAN] }], { imported: true }), sql).rejects.toThrow(IMPORT_PICTURE_MISNAMED);
    }
    // Nothing landed.
    expect(await file.query(`SELECT value FROM meta WHERE key = 'door_probe'`)).toEqual([]);
    expect(await countPictures(file)).toEqual([1, 1]);
    // A picture as an x'…' literal is read as a parameter is: the raw WebKit JPEG refused, its clean copy in.
    const literal = (bytes: Uint8Array) =>
      `INSERT INTO thumbnails (id, sha256, long_edge, bytes, mime, width, height, created_at, updated_at) VALUES ('t3', '${'a'.repeat(64)}', 2, x'${Buffer.from(bytes).toString('hex')}', 'image/jpeg', 1, 1, '', '');`;
    await expect(file.tx([{ sql: literal(RAW) }])).rejects.toThrow(PICTURE_NOT_CLEAN);
    await file.tx([{ sql: literal(CLEAN) }]);
    expect(await countPictures(file)).toEqual([1, 2]);
    // DELETE FROM goes through both doors.
    await file.tx([{ sql: 'DELETE FROM thumbnails WHERE long_edge = 2' }]);
    await file.tx([{ sql: 'delete from thumbnails' }], { imported: true });
    expect(await countPictures(file)).toEqual([1, 0]);
    await project.close();
  });
});

describe('two statements in one string (round 4)', () => {
  it('writes no picture: the door refuses it whole, as sbd.rs’s does', async () => {
    const driver = await createMemoryDriver({ wasm });
    const project = await createProject('/memory/Quay.sbd', { driver, backups: false });
    const file = project.file;
    await file.tx([{ sql: 'CREATE TABLE notes (id TEXT PRIMARY KEY)' }, { sql: `INSERT INTO notes VALUES ('n1')` }]);
    // The door refuses a text holding two statements (round 4's list), before sql.js sees it. Without the door, sql.js's
    // run would prepare only the first statement and bind the values to it, failing with "column index out of range";
    // rusqlite refuses such a text itself ("Multiple statements provided").
    await expect(file.tx([{ sql: `DELETE FROM notes; INSERT INTO media_files (sha256, bytes) VALUES ('x', ?)`, params: [RAW] }])).rejects.toThrow(
      PICTURE_NOT_CLEAN,
    );
    expect(await countPictures(file)).toEqual([0, 0]);
    expect(await file.query('SELECT id FROM notes')).toEqual([{ id: 'n1' }]);
    await project.close();
  });
});

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}
