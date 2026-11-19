import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { localizeError, setLocale } from '../i18n';
import { en } from '../i18n/locales/en';
import { lutStatements, prepareLut } from '../media/lut';
import { apply, loadRecords } from '../ops/ops';
import { IMPORT_LUT_MISNAMED, LUT_NOT_SAVED, type Statement } from './driver';
import { createMemoryDriver } from './memoryDriver';
import { createProject } from './project';

// A LUT is named by the SHA-256 of its `.cube` text (Kevin, Nov 18 night 4), so the end-to-end tests' driver refuses, as
// sbd.rs does, a `luts` row whose text isn't the one its name says: whole, at the ordinary door and at the import's, in
// a LUT's words. The statements both readers judge are on src-tauri/testdata/picture-statements.json.

const wasm = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm');
const INVERT = 'TITLE "Invert"\nLUT_3D_SIZE 2\n1 1 1\n0 1 1\n1 0 1\n0 0 1\n1 1 0\n0 1 0\n1 0 0\n0 0 0\n';
const at = new Date('2026-11-19T12:00:00.000Z');

async function invert() {
  const prepared = await prepareLut('Invert.cube', INVERT);
  if (!prepared.ok) throw new Error('a good cube');
  return prepared.lut;
}

/** lut.ts's statement with its `cube` changed after it was named: the row a damaged file would write. */
function damaged(statements: Statement[]): Statement[] {
  return statements.map((s) => ({ ...s, params: (s.params ?? []).map((value, i) => (i === 7 ? String(value).replace('0 0 0\n', '0 0 1\n') : value)) }));
}

async function countLuts(file: { query: (sql: string) => Promise<Record<string, unknown>[]> }) {
  const [row] = await file.query('SELECT count(*) AS n FROM luts');
  return Number(row?.n);
}

describe('the doors’ check of a LUT (Kevin, Nov 18 night 4)', () => {
  it('refuses a LUT whose text isn’t the one its name says, whole, at both doors; takes the app’s own', async () => {
    const driver = await createMemoryDriver({ wasm });
    const project = await createProject('/memory/Quay.sbd', { driver, backups: false });
    const file = project.file;
    const lut = await invert();
    const good = lutStatements('lut-1', lut, at);
    const bad = damaged(good);
    // With an edit in the same transaction: nothing lands.
    await expect(
      apply(file, [{ kind: 'create', record: { id: 'n1', type: 'note', parentId: project.projectId, sortKey: 'a', props: { text: 'x' } } }], { alsoWrite: bad }),
    ).rejects.toThrow(LUT_NOT_SAVED);
    expect((await loadRecords(file)).some((record) => record.id === 'n1')).toBe(false);
    await expect(file.tx(bad, { imported: true })).rejects.toThrow(IMPORT_LUT_MISNAMED);
    // Another name, an upper-case hash, a cube that isn't text, a statement whose values can't be read: refused too.
    const named = (sha: string) => good.map((s) => ({ ...s, params: (s.params ?? []).map((value, i) => (i === 1 ? sha : value)) }));
    for (const statements of [named('0'.repeat(64)), named(lut.sha256.toUpperCase())]) {
      await expect(file.tx(statements)).rejects.toThrow(LUT_NOT_SAVED);
      await expect(file.tx(statements, { imported: true })).rejects.toThrow(IMPORT_LUT_MISNAMED);
    }
    const asBytes: Statement = { sql: 'INSERT INTO luts (sha256, cube) VALUES (?, ?)', params: [lut.sha256, new TextEncoder().encode(INVERT)] };
    await expect(file.tx([asBytes])).rejects.toThrow(LUT_NOT_SAVED);
    await expect(file.tx([{ sql: "INSERT INTO luts (sha256, cube) VALUES ('a', 'b')" }])).rejects.toThrow(LUT_NOT_SAVED);
    await expect(file.tx([{ sql: 'UPDATE luts SET cube = ?', params: [INVERT] }], { imported: true })).rejects.toThrow(IMPORT_LUT_MISNAMED);
    expect(await countLuts(file)).toBe(0);
    // Its own text under its own name: in, at either door; DELETE FROM goes through.
    await file.tx(good);
    expect(await countLuts(file)).toBe(1);
    await file.tx([{ sql: 'DELETE FROM luts' }], { imported: true });
    await file.tx(lutStatements('lut-2', lut, at), { imported: true });
    expect(await countLuts(file)).toBe(1);
    await project.close();
  });

  it('refuses in the words of error.lutNotSaved and error.importLutMisnamed, said in the person’s language', () => {
    expect(LUT_NOT_SAVED).toBe(en['error.lutNotSaved']);
    expect(IMPORT_LUT_MISNAMED).toBe(en['error.importLutMisnamed']);
    setLocale('es');
    expect(localizeError(LUT_NOT_SAVED)).toBe('No se pudo guardar el LUT: su texto no es el que dice su nombre.');
    expect(localizeError(IMPORT_LUT_MISNAMED)).toBe('No se pueden importar los datos del proyecto: un LUT no es el que dice su nombre. No se importó nada.');
    setLocale('en');
    expect(localizeError(LUT_NOT_SAVED)).toBe(LUT_NOT_SAVED);
  });
});
