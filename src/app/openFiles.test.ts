import { writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nodeDriver } from '../core/storage/nodeDriver';
import { createProject } from '../core/storage/project';
import { makeTestFolder, type TestFolder } from '../core/storage/testFolder';
import { createProjectFile, OpenFileError, openProjectFile } from './openFiles';
import { createProjectStore } from './projectStore';

let folder: TestFolder;
const store = createProjectStore();
beforeEach(() => {
  folder = makeTestFolder();
});
afterEach(async () => {
  await store.getState().close();
  folder.remove();
});

/** A project on disk, closed, as Finder would hand it over. */
async function onDisk(name: string): Promise<string> {
  const path = folder.path(name);
  const project = await createProject(path, { driver: nodeDriver, backups: false });
  await project.close();
  return path;
}

const openPath = () => store.getState().project?.file.path;

describe('opening a .sbd the OS hands over', () => {
  it('opens it in place of the project that was open', async () => {
    const pilot = await onDisk('Pilot.sbd');
    const bey = await onDisk('Bey County.sbd');
    await openProjectFile(pilot, { store, driver: nodeDriver });
    expect(openPath()).toBe(pilot);

    await openProjectFile(bey, { store, driver: nodeDriver });
    expect(openPath()).toBe(bey);
    expect(store.getState().project?.name).toBe('Bey County');
    // The old project's records are gone from the screen; only Bey County's project record is left.
    expect(Object.values(store.getState().records).map((r) => r.props.title)).toEqual(['Bey County']);
  });

  it('leaves the project alone when it is already the one open', async () => {
    const pilot = await onDisk('Pilot.sbd');
    await openProjectFile(pilot, { store, driver: nodeDriver });
    const project = store.getState().project;
    await openProjectFile(pilot, { store, driver: nodeDriver });
    expect(store.getState().project).toBe(project);
  });

  it('keeps the current project open when the new file can’t be opened, and says why', async () => {
    const pilot = await onDisk('Pilot.sbd');
    await openProjectFile(pilot, { store, driver: nodeDriver });

    const notes = folder.path('Notes.sbd');
    writeFileSync(notes, 'not a database at all');
    const missing = folder.path('Gone.sbd');
    await expect(openProjectFile(notes, { store, driver: nodeDriver })).rejects.toThrow(OpenFileError);
    await expect(openProjectFile(missing, { store, driver: nodeDriver })).rejects.toThrow(
      "Couldn’t open “Gone.sbd”. There's no project file at that path.",
    );
    expect(openPath()).toBe(pilot);
  });

  it('makes a new project in place of the open one, and never overwrites a file', async () => {
    const pilot = await onDisk('Pilot.sbd');
    await openProjectFile(pilot, { store, driver: nodeDriver });

    const fresh = folder.path('Open Water.sbd');
    await createProjectFile(fresh, { store, driver: nodeDriver });
    expect(openPath()).toBe(fresh);
    expect(store.getState().project?.name).toBe('Open Water');

    await expect(createProjectFile(pilot, { store, driver: nodeDriver })).rejects.toThrow(
      'Couldn’t open “Pilot.sbd”. A file already exists at that path.',
    );
    expect(openPath()).toBe(fresh);
  });
});
