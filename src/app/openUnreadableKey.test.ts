import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../core/i18n';
import { migrate } from '../core/storage/migrate';
import { MIGRATIONS } from '../core/storage/migrations';
import { nodeDriver } from '../core/storage/nodeDriver';
import { createProject } from '../core/storage/project';
import { makeTestFolder, type TestFolder } from '../core/storage/testFolder';
import { OpenFileError, openProjectFile } from './openFiles';
import { createProjectStore } from './projectStore';

// What a person is told when an old file can't be upgraded (6.25, Kevin: "Tell me what a person sees if migration 012
// throws on an old file"): the notice Open shows is this error's words. Only what must hold whatever the notice comes
// to say is asserted: it is refused, the notice names the file, the file and the open project are as they were. The
// file itself is covered beside the migration (src/core/storage/migrations/012_unreadable_key.test.ts).

let folder: TestFolder;
const store = createProjectStore();
beforeEach(() => {
  folder = makeTestFolder();
  // Only the clock: the backup made before an upgrade is named by the minute.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 16, 12, 0, 0));
});
afterEach(async () => {
  vi.useRealTimers();
  setLocale('en');
  await store.getState().close();
  folder.remove();
});

const at = '2026-11-09T10:00:00.000Z';

/** A schema-11 file whose last character has the sort key '~' and whose scene names a character with no record. */
async function oldFile(): Promise<string> {
  const path = folder.path('Bey County.sbd');
  const file = await nodeDriver.create(path);
  await migrate(file, { isNew: true, migrations: MIGRATIONS.slice(0, 11), now: () => new Date(at) });
  const record = (id: string, type: string, parent: string | null, props: object, sortKey = id) => ({
    sql: `INSERT INTO records (id, type, parent_id, sort_key, props, trashed_at, trashed_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
    params: [id, type, parent, sortKey, JSON.stringify(props), at, at],
  });
  await file.tx([
    record('p', 'project', null, { name: 'Bey County' }),
    record('odd', 'character', 'p', { name: 'Deputy' }, '~'),
    record('s1', 'scene', 'p', { number: '1', name: 'DINER', characters: ['Sheriff'] }),
  ]);
  await file.close();
  return path;
}

describe('opening an old file whose upgrade can’t read a sort key (6.25)', () => {
  it('says which file couldn’t be opened, in each language, and keeps the open project and the file as they were', async () => {
    const pilot = folder.path('Pilot.sbd');
    await (await createProject(pilot, { driver: nodeDriver, backups: false })).close();
    await openProjectFile(pilot, { store, driver: nodeDriver });
    const path = await oldFile();
    const before = readFileSync(path);

    // The reason's own words aren't pinned here: only that the notice is Open's, naming the file.
    await expect(openProjectFile(path, { store, driver: nodeDriver })).rejects.toThrow('Couldn’t open “Bey County.sbd”.');
    expect(store.getState().project?.file.path).toBe(pilot);
    expect(readFileSync(path).equals(before)).toBe(true);

    vi.setSystemTime(new Date(2026, 10, 16, 12, 1, 0));
    setLocale('es');
    await expect(openProjectFile(path, { store, driver: nodeDriver })).rejects.toThrow('No se pudo abrir “Bey County.sbd”.');
    expect(store.getState().project?.file.path).toBe(pilot);
    expect(readFileSync(path).equals(before)).toBe(true);
  });

  it('tried again within the same minute, is refused again and the file is still as it was', async () => {
    const path = await oldFile();
    const before = readFileSync(path);
    await expect(openProjectFile(path, { store, driver: nodeDriver })).rejects.toThrow(OpenFileError);
    await expect(openProjectFile(path, { store, driver: nodeDriver })).rejects.toThrow(OpenFileError);
    expect(readFileSync(path).equals(before)).toBe(true);
  });
});
