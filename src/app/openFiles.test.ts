import { renameSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LockHolder } from '../core/storage/driver';
import { nodeDriver, nodeDriverFor } from '../core/storage/nodeDriver';
import { createProject } from '../core/storage/project';
import { makeTestFolder, type TestFolder } from '../core/storage/testFolder';
import { createProjectFile, OpenFileError, openProjectFile, reopenProjectFile, type LockedChoice } from './openFiles';
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

describe('a project open on another computer', () => {
  const studio = nodeDriverFor({ id: 'studio', name: 'Studio iMac' });
  const laptop = nodeDriverFor({ id: 'laptop', name: 'Kevin’s MacBook Pro' });

  /** The project, open on the studio computer for the whole test. */
  async function openOnStudio() {
    const path = folder.path('Bey County.sbd');
    const elsewhere = await createProject(path, { driver: studio, backups: false });
    return { path, elsewhere };
  }

  const answering = (choice: LockedChoice) => {
    const asked: LockHolder[] = [];
    return {
      asked,
      ask: (holder: LockHolder) => {
        asked.push(holder);
        return Promise.resolve(choice);
      },
    };
  };

  it('asks first, and Cancel opens nothing', async () => {
    const { path, elsewhere } = await openOnStudio();
    const { asked, ask } = answering('cancel');
    await openProjectFile(path, { store, driver: laptop, askWhenLocked: ask });
    expect(asked.map((h) => h.computer)).toEqual(['Studio iMac']);
    expect(openPath()).toBeUndefined();
    await elsewhere.close();
  });

  it('opens a copy beside it, a separate project', async () => {
    const { path, elsewhere } = await openOnStudio();
    await openProjectFile(path, { store, driver: laptop, askWhenLocked: answering('copy').ask });
    expect(openPath()).toBe(folder.path('Bey County (copy).sbd'));
    await elsewhere.close();
  });

  it('opens it anyway when asked to', async () => {
    const { path, elsewhere } = await openOnStudio();
    await openProjectFile(path, { store, driver: laptop, askWhenLocked: answering('anyway').ask });
    expect(openPath()).toBe(path);
    await elsewhere.close();
  });

  it('asks nothing when the other computer has closed it', async () => {
    const { path, elsewhere } = await openOnStudio();
    await elsewhere.close();
    const { asked, ask } = answering('cancel');
    await openProjectFile(path, { store, driver: laptop, askWhenLocked: ask });
    expect(asked).toEqual([]);
    expect(openPath()).toBe(path);
  });
});

describe('a sync replacing the file while it is open', () => {
  it('refuses the edit, flags it, and reopening loads the newer version', async () => {
    const path = await onDisk('Bey County.sbd');
    await openProjectFile(path, { store, driver: nodeDriver });
    const projectId = store.getState().project?.projectId ?? '';

    // The other computer's version, renamed over this one as sync services do.
    const theirs = await createProject(folder.path('theirs.sbd'), { driver: nodeDriver, backups: false });
    await theirs.close();
    renameSync(folder.path('theirs.sbd'), path);

    await store.getState().apply([{ kind: 'update', id: projectId, set: { notes: 'Golden hour on 4A' } }]);
    expect(store.getState().changedOnDisk).toBe(true);
    expect(store.getState().error).toBeNull();

    await reopenProjectFile(path, { store, driver: nodeDriver });
    expect(store.getState().changedOnDisk).toBe(false);
    expect(openPath()).toBe(path);
    // The newer file has its own project record; the refused note was never written anywhere.
    const notes = Object.values(store.getState().records).map((r) => r.props.notes);
    expect(notes).toEqual(['']);
  });
});
