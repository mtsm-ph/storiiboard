import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatDate, setLocale } from '../../core/i18n';
import type { ProjectFile } from '../../core/storage/driver';
import { CHANGED_ON_DISK } from '../../core/storage/driver';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, openProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { clearNotice } from '../notice';
import { createProjectStore, type ProjectState } from '../projectStore';
import { savedSignText, type SavedSignState } from './savedSign';

// The status bar's "Saved" sign (6.5.4): what it says in each case, and where its times come from in the store.

const NOW = new Date(2026, 10, 16, 14, 40);
const clock = (at: Date) => formatDate(at, { hour: '2-digit', minute: '2-digit' });
const NOTHING: SavedSignState = { savedAt: null, backupAt: null, saveFailed: null, changedOnDisk: false };

describe("the Saved sign's words", () => {
  afterEach(() => {
    setLocale('en');
  });

  it('says only "Saved" before any change, and that there is no backup yet', () => {
    const sign = savedSignText(NOTHING, NOW);
    expect(sign.text).toBe('Saved · No backup yet');
    expect(sign.label).toBe('Saved. No backup yet.');
    expect(sign.description).toBe(
      'Saved. No backup yet. Every change is saved at once; a backup is made every 5 minutes when the project has changed.',
    );
    expect(sign.failed).toBe(false);
  });

  it('gives a change made now and a backup their times, and reads whole', () => {
    const saved = new Date(2026, 10, 16, 14, 32);
    const backup = new Date(2026, 10, 16, 14, 30);
    const sign = savedSignText({ ...NOTHING, savedAt: saved.toISOString(), backupAt: backup.toISOString() }, NOW);
    expect(sign.text).toBe(`Saved ${clock(saved)} · Backup ${clock(backup)}`);
    expect(sign.label).toBe(`Saved at ${clock(saved)}. Last backup at ${clock(backup)}.`);
    expect(sign.savedSentence).toEqual({ key: 'savedSign.savedAt', params: { time: clock(saved) } });
  });

  it('adds the date to a time from another day, with its own sentence', () => {
    const yesterday = new Date(2026, 10, 15, 18, 5);
    const lastWeek = new Date(2026, 10, 9, 8, 0);
    const sign = savedSignText({ ...NOTHING, savedAt: yesterday.toISOString(), backupAt: lastWeek.toISOString() }, NOW);
    const day = (at: Date) => formatDate(at, { month: 'short', day: 'numeric' });
    expect(sign.text).toBe(`Saved ${day(yesterday)} ${clock(yesterday)} · Backup ${day(lastWeek)} ${clock(lastWeek)}`);
    expect(sign.label).toBe(`Saved on ${day(yesterday)} at ${clock(yesterday)}. Last backup on ${day(lastWeek)} at ${clock(lastWeek)}.`);
    expect(sign.backupSentence.key).toBe('savedSign.backupOn');
  });

  it('never says "Saved" for a failed commit: "Not saved", with the error path’s words', () => {
    const backup = new Date(2026, 10, 16, 14, 30);
    const sign = savedSignText({ savedAt: new Date(2026, 10, 16, 14, 32).toISOString(), backupAt: backup.toISOString(), saveFailed: 'The disk is full.', changedOnDisk: false }, NOW);
    expect(sign.failed).toBe(true);
    expect(sign.text).toBe(`Not saved · Backup ${clock(backup)}`);
    expect(sign.label).toBe(`Not saved: The disk is full. Last backup at ${clock(backup)}.`);
  });

  it('says "Not saved" while a file a sync replaced waits to be reopened, in that error’s words', () => {
    const sign = savedSignText({ ...NOTHING, savedAt: new Date(2026, 10, 16, 14, 32).toISOString(), changedOnDisk: true }, NOW);
    expect(sign.failed).toBe(true);
    expect(sign.text).toBe('Not saved · No backup yet');
    expect(sign.label).toBe(`Not saved: ${CHANGED_ON_DISK} No backup yet.`);
  });

  it('reads in Spanish with the Backups settings’ word for a backup', () => {
    setLocale('es');
    const saved = new Date(2026, 10, 16, 14, 32);
    const backup = new Date(2026, 10, 15, 14, 30);
    const day = formatDate(backup, { month: 'short', day: 'numeric' });
    const sign = savedSignText({ ...NOTHING, savedAt: saved.toISOString(), backupAt: backup.toISOString() }, NOW);
    expect(sign.text).toBe(`Guardado ${clock(saved)} · Respaldo ${day} ${clock(backup)}`);
    expect(sign.label).toBe(`Guardado a las ${clock(saved)}. Último respaldo el ${day} a las ${clock(backup)}.`);
    expect(savedSignText({ ...NOTHING, saveFailed: 'x' }, NOW).text).toBe('No guardado · Aún sin respaldo');
  });
});

describe("the store's Saved and Backup times", () => {
  let folder: TestFolder;
  beforeEach(() => {
    folder = makeTestFolder();
  });
  afterEach(() => {
    vi.useRealTimers();
    clearNotice();
    folder.remove();
  });

  const fresh = () => createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  /** What the sign says for the store as it is now. */
  const signOf = (s: ProjectState) => savedSignText(s).text;
  const retitle = (title: string, project: Project) => [{ kind: 'update' as const, id: project.projectId, set: { title } }];
  /** Replaces one of the open file's methods, as a failing disk would. */
  const breakFile = <K extends keyof ProjectFile>(project: Project, name: K, broken: ProjectFile[K]) => {
    (project.file as { [P in K]: ProjectFile[P] })[name] = broken;
  };

  it('records the commit time on a successful commit only, never for an edit that wrote nothing', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 16, 9, 0));
    const store = createProjectStore();
    const project = await fresh();
    await store.getState().open(project);
    // Creating a file writes its project record outside the log: no op, so the sign says only "Saved".
    expect(store.getState().savedAt).toBeNull();
    expect(signOf(store.getState())).toBe('Saved · No backup yet');

    vi.setSystemTime(new Date(2026, 10, 16, 14, 32));
    await store.getState().apply(retitle('Bey County: Pilot', project));
    expect(store.getState().savedAt).toBe(new Date(2026, 10, 16, 14, 32).toISOString());

    // An empty edit writes nothing, so the time stays.
    vi.setSystemTime(new Date(2026, 10, 16, 14, 34));
    await store.getState().apply([]);
    expect(store.getState().savedAt).toBe(new Date(2026, 10, 16, 14, 32).toISOString());

    // An undo is a change too.
    vi.setSystemTime(new Date(2026, 10, 16, 14, 36));
    await store.getState().undo();
    expect(store.getState().savedAt).toBe(new Date(2026, 10, 16, 14, 36).toISOString());

    // Nothing left to undo: no group written, no time moved.
    vi.setSystemTime(new Date(2026, 10, 16, 14, 50));
    await store.getState().undo();
    expect(store.getState().savedAt).toBe(new Date(2026, 10, 16, 14, 36).toISOString());

    // Reopened: the newest op in History stands for the time.
    await store.getState().close();
    expect(store.getState().savedAt).toBeNull();
    await store.getState().open(await openProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false }));
    expect(store.getState().savedAt).toBe(new Date(2026, 10, 16, 14, 36).toISOString());
    await store.getState().close();
  });

  it('says "Not saved" when a transaction really fails, until the next good edit', async () => {
    const store = createProjectStore();
    const project = await fresh();
    await store.getState().open(project);
    const tx = project.file.tx.bind(project.file);
    breakFile(project, 'tx', () => Promise.reject(new Error('The disk is full.')));
    await store.getState().apply(retitle('Bey County: Pilot', project));
    expect(store.getState().saveFailed).toBe('The disk is full.');
    expect(signOf(store.getState())).toBe('Not saved · No backup yet');

    breakFile(project, 'tx', tx);
    await store.getState().apply(retitle('Bey County: Pilot', project));
    expect(store.getState().saveFailed).toBeNull();
    expect(signOf(store.getState())).toMatch(/^Saved \S/);
    await store.getState().close();
  });

  it('keeps "Saved" for what fails outside an edit’s commit: Compact, Clean up pictures, a build, a read after', async () => {
    const store = createProjectStore();
    const project = await fresh();
    await store.getState().open(project);
    await store.getState().apply(retitle('Bey County: Pilot', project));
    const saved = () => {
      expect(store.getState().saveFailed).toBeNull();
      expect(signOf(store.getState())).toMatch(/^Saved \S/);
    };

    // A build step that throws before any write.
    await store.getState().applyWith(() => {
      throw new Error('The font did not load.');
    });
    expect(store.getState().error).toBe('The font did not load.');
    saved();

    // A failed Compact.
    const compact = project.file.compact.bind(project.file);
    breakFile(project, 'compact', () => Promise.reject(new Error('The disk is full.')));
    expect(await store.getState().compact()).toBeNull();
    expect(store.getState().error).toBe('The disk is full.');
    saved();
    breakFile(project, 'compact', compact);

    // A failed Clean up pictures.
    const query = project.file.query.bind(project.file);
    breakFile(project, 'query', () => Promise.reject(new Error('The disk is busy.')));
    expect(await store.getState().cleanUpPictures()).toBeNull();
    expect(store.getState().error).toBe('The disk is busy.');
    saved();
    breakFile(project, 'query', query);

    // A read that fails after the commit: the group is in the file, so its time is the Saved time.
    const tx = project.file.tx.bind(project.file);
    breakFile(project, 'tx', async (statements) => {
      await tx(statements);
      breakFile(project, 'query', () => Promise.reject(new Error('The disk is busy.')));
    });
    const before = store.getState().savedAt;
    await store.getState().apply(retitle('Bey County: Day 2', project));
    breakFile(project, 'query', query);
    breakFile(project, 'tx', tx);
    expect(store.getState().error).toBe('The disk is busy.');
    expect(store.getState().savedAt).not.toBe(before);
    saved();
    await store.getState().close();
  });

  it('lists the newest backup once at open, then hears each backup the schedule writes', async () => {
    let at = new Date(2026, 10, 16, 9, 0);
    const store = createProjectStore();
    const project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: { now: () => at, intervalMs: 3_600_000 } });
    await store.getState().open(project);
    expect(store.getState().backupAt).toBeNull();

    await store.getState().apply(retitle('Bey County: Pilot', project));
    at = new Date(2026, 10, 16, 14, 30);
    await project.backups?.runNow();
    expect(store.getState().backupAt).toBe(at.toISOString());

    await store.getState().close();
    expect(store.getState().backupAt).toBeNull();
    await store.getState().open(await openProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false }));
    expect(store.getState().backupAt).toBe(new Date(2026, 10, 16, 14, 30).toISOString());
    await store.getState().close();
  });
});
