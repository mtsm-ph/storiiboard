import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { apply, getRecord, undo } from '../ops/ops';
import { createMemoryDriver } from './memoryDriver';
import { createProject, openProject } from './project';

// The end-to-end tests' driver must keep the same contract as the desktop one, or a green e2e run would prove
// nothing. These run it under Node, against the real storage and ops code.
const wasm = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm');

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe('the memory driver for end-to-end tests', () => {
  it('creates, edits and reopens a project, and undo works after a reload', async () => {
    const storage = memoryStorage();
    const driver = await createMemoryDriver({ wasm, storage });
    const created = await createProject('/memory/Bey County.sbd', { driver, backups: false });
    await apply(created.file, [{ kind: 'update', id: created.projectId, set: { notes: 'Golden hour on 4A' } }]);
    await created.close();

    // A fresh driver over the same storage is the page after a reload.
    const reloaded = await createMemoryDriver({ wasm, storage });
    const reopened = await openProject('/memory/Bey County.sbd', { driver: reloaded, backups: false });
    expect((await getRecord(reopened.file, reopened.projectId))?.props.notes).toBe('Golden hour on 4A');
    await undo(reopened.file);
    expect((await getRecord(reopened.file, reopened.projectId))?.props.notes).toBe('');
    await reopened.close();
  });

  it('refuses what the desktop driver refuses, in the same words', async () => {
    const driver = await createMemoryDriver({ wasm });
    const project = await createProject('/memory/Pilot.sbd', { driver, backups: false });
    await expect(driver.create('/memory/Pilot.sbd')).rejects.toThrow('A file already exists at that path.');
    await expect(driver.open('/memory/Missing.sbd')).rejects.toThrow("There's no project file at that path.");
    await expect(driver.create('/memory/notes.txt')).rejects.toThrow('ends in .sbd');
    await expect(project.file.tx([{ sql: 'INSERT INTO nowhere VALUES (1)' }])).rejects.toThrow();
    await expect(project.file.backup('scheduled', '../Pilot 2026-11-03 09-00.sbd')).rejects.toThrow("isn't a backup name");
    await project.close();
  });

  it('backs up, lists and prunes backups, and copies a project', async () => {
    const driver = await createMemoryDriver({ wasm });
    const project = await createProject('/memory/Pilot.sbd', { driver, backups: false });
    await project.file.backup('scheduled', 'Pilot 2026-11-03 09-00.sbd');
    expect(await project.file.listBackups()).toEqual(['Pilot 2026-11-03 09-00.sbd']);
    await project.file.deleteBackup('Pilot 2026-11-03 09-00.sbd');
    expect(await project.file.listBackups()).toEqual([]);
    await driver.copy('/memory/Pilot.sbd', '/memory/Pilot (copy).sbd');
    const copy = await openProject('/memory/Pilot (copy).sbd', { driver, backups: false });
    expect(copy.name).toBe('Pilot (copy)');
    await copy.close();
    await project.close();
  });

  it('lets the backup schedule see edits, though each save resets SQLite’s own change count', async () => {
    const driver = await createMemoryDriver({ wasm });
    const project = await createProject('/memory/Bey County.sbd', { driver });
    expect((await project.backups?.runNow())?.created).toBeNull();
    await apply(project.file, [{ kind: 'update', id: project.projectId, set: { notes: 'Rain cover for 4B' } }]);
    expect((await project.backups?.runNow())?.created).toMatch(/^Bey County \d{4}-\d{2}-\d{2} \d{2}-\d{2}\.sbd$/);
    await project.close();
  });
});
