import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NOT_BYTES, QUERY_RETURNED_BYTES, type ProjectFile, type SqlDriver } from './driver';
import { createMemoryDriver } from './memoryDriver';
import { nodeDriver } from './nodeDriver';
import { makeTestFolder, type TestFolder } from './testFolder';

// B3 (6.14, docs/DESKTOP_GAPS.md): the drivers the tests use refuse what src-tauri/src/sbd.rs refuses, in its words,
// so code that queried bytes or read text as a blob fails here and not only on the desktop. The cases are sbd.rs's own
// (refuses_bytes_in_a_query_and_a_blob_read_of_anything_else), run over both drivers.
const wasm = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm');

let folder: TestFolder;
beforeEach(() => {
  folder = makeTestFolder();
});
afterEach(() => {
  folder.remove();
});

const drivers: [string, () => Promise<{ driver: SqlDriver; path: string }>][] = [
  ['the Node driver', () => Promise.resolve({ driver: nodeDriver, path: folder.path('Bey County.sbd') })],
  ['the memory driver', async () => ({ driver: await createMemoryDriver({ wasm }), path: '/memory/Bey County.sbd' })],
];

async function mediaFile(make: () => Promise<{ driver: SqlDriver; path: string }>): Promise<ProjectFile> {
  const { driver, path } = await make();
  const file = await driver.create(path);
  await file.tx([
    { sql: 'CREATE TABLE media_files (id TEXT, bytes BLOB)' },
    {
      sql: "INSERT INTO media_files VALUES ('full', x'0102'), ('empty', x''), ('null', NULL), ('text', 'abc'), ('number', 35)",
    },
  ]);
  return file;
}

describe.each(drivers)('%s, as sbd.rs', (_name, make) => {
  it('refuses a query whose rows hold bytes, an empty blob too, and answers NULL, text and numbers as they are', async () => {
    const file = await mediaFile(make);
    const query = (id: string) => file.query('SELECT id, bytes FROM media_files WHERE id = ?', [id]);
    await expect(query('full')).rejects.toThrow(QUERY_RETURNED_BYTES);
    await expect(query('empty')).rejects.toThrow(QUERY_RETURNED_BYTES);
    expect(await query('null')).toEqual([{ id: 'null', bytes: null }]);
    // SQLite's type of the value counts, not the column's.
    expect(await query('text')).toEqual([{ id: 'text', bytes: 'abc' }]);
    expect(await query('number')).toEqual([{ id: 'number', bytes: 35 }]);
    expect(await query('none')).toEqual([]);
    await expect(file.query('SELECT id, bytes FROM media_files ORDER BY id')).rejects.toThrow(QUERY_RETURNED_BYTES);
    await expect(file.query("SELECT x'00'")).rejects.toThrow(QUERY_RETURNED_BYTES);
    await file.close();
  });

  it('refuses a blob read of text or a number, and reads NULL, an empty blob and no row as null', async () => {
    const file = await mediaFile(make);
    const read = (id: string) => file.readBlob('SELECT bytes FROM media_files WHERE id = ?', [id]);
    expect(await read('full')).toEqual(new Uint8Array([1, 2]));
    // sbd_read_blob sends no bytes for an empty blob, as for no row, and tauriDriver.ts reads that as null.
    expect(await read('empty')).toBeNull();
    expect(await read('null')).toBeNull();
    expect(await read('none')).toBeNull();
    await expect(read('text')).rejects.toThrow(NOT_BYTES);
    await expect(read('number')).rejects.toThrow(NOT_BYTES);
    // Only the first column of the first row counts.
    expect(await file.readBlob("SELECT bytes, id FROM media_files WHERE id IN ('full', 'text') ORDER BY id")).toEqual(new Uint8Array([1, 2]));
    await expect(file.readBlob("SELECT id, bytes FROM media_files WHERE id = 'full'")).rejects.toThrow(NOT_BYTES);
    await file.close();
  });

  it('reads a blob from the first column by position, whatever the columns are named', async () => {
    const file = await mediaFile(make);
    // A column named "1" would come first among an object's keys; the first column is still bytes.
    expect(await file.readBlob("SELECT bytes, 1 FROM media_files WHERE id = 'full'")).toEqual(new Uint8Array([1, 2]));
    // Two columns of one name: by name the later would win; by position the first is read, as sbd.rs reads it.
    expect(await file.readBlob("SELECT bytes AS b, id AS b FROM media_files WHERE id = 'full'")).toEqual(new Uint8Array([1, 2]));
    await expect(file.readBlob("SELECT id AS b, bytes AS b FROM media_files WHERE id = 'full'")).rejects.toThrow(NOT_BYTES);
    await file.close();
  });

  it('refuses bytes in a query by position, even behind a later column of the same name', async () => {
    const file = await mediaFile(make);
    await expect(file.query("SELECT bytes AS v, id AS v FROM media_files WHERE id = 'full'")).rejects.toThrow(QUERY_RETURNED_BYTES);
    await expect(file.query("SELECT id AS v, bytes AS v FROM media_files WHERE id = 'full'")).rejects.toThrow(QUERY_RETURNED_BYTES);
    // Without bytes, the later of two same-named columns is the one kept, as Rust's map insert keeps it.
    expect(await file.query("SELECT id AS v, 7 AS v FROM media_files WHERE id = 'text'")).toEqual([{ v: 7 }]);
    await file.close();
  });
});
