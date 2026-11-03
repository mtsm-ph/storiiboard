import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nodeDriver } from './nodeDriver';
import { backupCopyPath, copyBackup, folderOfPath, joinPath } from './openBackup';
import { createProject, openProject } from './project';
import { makeTestFolder, type TestFolder } from './testFolder';

let folder: TestFolder;
beforeEach(() => {
  folder = makeTestFolder();
});
afterEach(() => {
  folder.remove();
});

describe('Open backup', () => {
  it('puts the copy beside the project, out of its Backups folder, under the backup’s name', () => {
    expect(backupCopyPath('/Films/Backups/Bey County 2026-11-02 14-05.sbd')).toBe(
      '/Films/Bey County 2026-11-02 14-05 (from backup).sbd',
    );
    expect(backupCopyPath('C:\\Films\\Backups\\Bey County 2026-11-02 14-05.sbd', 2)).toBe(
      'C:\\Films\\Bey County 2026-11-02 14-05 (from backup 2).sbd',
    );
    // A backup someone moved out of its folder stays where it is.
    expect(backupCopyPath('/Desktop/Bey County 2026-11-02 14-05.sbd')).toBe(
      '/Desktop/Bey County 2026-11-02 14-05 (from backup).sbd',
    );
  });

  it('joins and splits paths with the platform’s own separator', () => {
    expect(joinPath('C:\\Films\\Backups', 'Bey County 2026-11-02 14-05.sbd')).toBe(
      'C:\\Films\\Backups\\Bey County 2026-11-02 14-05.sbd',
    );
    expect(joinPath('/Films/Backups', 'Bey.sbd')).toBe('/Films/Backups/Bey.sbd');
    expect(folderOfPath('/Films/Bey County.sbd')).toBe('/Films');
  });

  it('puts the copy of a backup kept on this computer beside the project, not in the app’s folder', () => {
    const local = '/Users/kevin/Library/Application Support/app.storiiboard.desktop/Backups/Bey County 1a2b3c4d';
    expect(backupCopyPath(`${local}/Bey County 2026-11-02 14-05.sbd`, 1, '/Users/kevin/Dropbox/Films')).toBe(
      '/Users/kevin/Dropbox/Films/Bey County 2026-11-02 14-05 (from backup).sbd',
    );
  });

  it('opens a copy with everything the backup held, leaves the backup alone, and numbers a second copy', async () => {
    const original = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
    await original.file.tx([{ sql: "UPDATE records SET props = json_set(props, '$.notes', 'golden hour on 4A')" }]);
    await original.file.backup('scheduled', 'Bey County 2026-11-02 14-05.sbd');
    await original.close();
    const backup = folder.path('Backups', 'Bey County 2026-11-02 14-05.sbd');

    const first = await copyBackup(backup, nodeDriver);
    expect(first).toBe(folder.path('Bey County 2026-11-02 14-05 (from backup).sbd'));
    const second = await copyBackup(backup, nodeDriver);
    expect(second).toBe(folder.path('Bey County 2026-11-02 14-05 (from backup 2).sbd'));

    const copy = await openProject(first, { driver: nodeDriver, backups: false });
    const [row] = await copy.file.query("SELECT json_extract(props, '$.notes') AS notes FROM records WHERE type = 'project'");
    expect(row?.notes).toBe('golden hour on 4A');
    // The copy is its own project: its name comes from its own file.
    expect(copy.name).toBe('Bey County 2026-11-02 14-05 (from backup)');
    await copy.close();
  });

  it('refuses a file that isn’t a backup of a project', async () => {
    await expect(copyBackup(folder.path('Missing.sbd'), nodeDriver)).rejects.toThrow("There's no project file at that path.");
  });
});
