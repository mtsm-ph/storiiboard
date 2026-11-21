import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The project's suggestions folder as the desktop app brings it in (7.1 round 2), with Rust's commands played by a
// folder kept here: the open pass as one op group, at most 200 files, 10 MB and 2,000 suggestions a pass, the rest
// waiting with a line and Bring in; the window back in front only finding; an undone bring-in staying undone; the rename
// offered once per open; the folder's own lines; a switch while a run is under way. The page names only the open
// project's handle, never a path or the project's id. Made-up projects and people only: "Harbor Lights", "Saltmarsh",
// Robin Vale.

const invoke = vi.hoisted(() => vi.fn());
const askMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri: () => false }));
vi.mock('./fileAccess', async (importOriginal) => ({ ...(await importOriginal<typeof import('./fileAccess')>()), isTauriApp: true }));
vi.mock('./ask', () => ({ ask: askMock }));

import { setLocale } from '../core/i18n';
import { log } from '../core/ops/ops';
import { nodeDriver } from '../core/storage/nodeDriver';
import { createProject, openProject, type Project } from '../core/storage/project';
import { makeTestFolder, type TestFolder } from '../core/storage/testFolder';
import { bringInBytes, bringInFolder, bringInWaiting, dropFolderNotice, findInFolder, MAX_READ_BYTES } from './changeFiles';
import { noticeStore } from './notice';
import { projectStore } from './projectStore';

interface FakeFile {
  bytes: Uint8Array;
  modified: number;
  /** The size the listing says, when a test needs it larger than the bytes (the 10 MB bound). */
  listed?: number;
  /** Its read fails, as a file locked or gone between the listing and the read would. */
  fails?: boolean;
  /** Its read held until the test lets it go. */
  hold?: Promise<void>;
}

interface FakeFolder {
  name: string;
  state: 'none' | 'read' | 'other_project' | 'link';
  otherProjectName: string | null;
  files: Map<string, FakeFile>;
  capped: boolean;
  renameFrom: string | null;
  /** A listing held until the test lets it go. */
  hold: Promise<void> | null;
  /** The listing fails, after its hold. */
  listFails: boolean;
  /** A rename held until the test lets it go. */
  renameHold?: Promise<void>;
}

const folders = new Map<number, FakeFolder>();
const reads: string[] = [];

const fakeFolder = (handle: number, name: string): FakeFolder => {
  const made: FakeFolder = { name, state: 'read', otherProjectName: null, files: new Map(), capped: false, renameFrom: null, hold: null, listFails: false };
  folders.set(handle, made);
  return made;
};

invoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
  const folder = folders.get(Number(args.handle));
  if (!folder) throw new Error('That project isn’t open.');
  if (cmd === 'changes_folder') {
    if (folder.hold) await folder.hold;
    if (folder.listFails) throw new Error('Storiiboard couldn’t read this project’s suggestions folder.');
    const files = [...folder.files.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([name, file]) => ({ name, bytes: file.listed ?? file.bytes.byteLength, modified: file.modified }));
    return {
      folder: folder.name,
      state: folder.state,
      otherProjectName: folder.otherProjectName,
      files: folder.state === 'read' ? files : [],
      tooLarge: [],
      capped: folder.capped,
      renameFrom: folder.renameFrom,
    };
  }
  if (cmd === 'changes_folder_read') {
    const file = folder.files.get(String(args.name));
    if (!file) throw new Error('Storiiboard couldn’t read that change file.');
    reads.push(String(args.name));
    if (file.hold) await file.hold;
    if (file.fails) throw new Error('Storiiboard couldn’t read that change file.');
    return file.bytes.slice().buffer;
  }
  if (cmd === 'changes_folder_rename') {
    if (folder.renameHold) await folder.renameHold;
    folder.renameFrom = null;
    folder.state = 'read';
    return null;
  }
  throw new Error(`not played here: ${cmd}`);
});

const id = (file: number, n: number) => `f2b7a1c0-${String(file).padStart(4, '0')}-4c47-9a7e-${String(n).padStart(12, '0')}`;
const fileId = (n: number) => `8d0f3c52-5a0e-4c47-9a7e-${String(n).padStart(12, '0')}`;

/** A change file for `projectId`, its id `n`, with `count` suggestions by Robin Vale. */
const changeFile = (projectId: string, n: number, count = 1): Uint8Array =>
  new TextEncoder().encode(
    JSON.stringify({
      format: 'storiiboard.changes',
      version: 1,
      id: fileId(n),
      project_id: projectId,
      created_by: 'mcp',
      people: [{ id: 'r1', name: 'Robin Vale', role: 'dp' }],
      suggestions: Array.from({ length: count }, (_, i) => ({ id: id(n, i), kind: 'trash', target: { id: 'b', type: 'shot', label: '4B' }, author: 'r1', data: {} })),
    }),
  );

let folder: TestFolder;
let project: Project;
let disk: FakeFolder;

/** A project opened as the app opens one, with a handle Rust knows. */
async function openAs(opened: Project, handle: number): Promise<Project> {
  Object.defineProperty(opened.file, 'nativeHandle', { value: handle });
  await projectStore.getState().open(opened);
  return opened;
}

beforeEach(async () => {
  setLocale('en');
  folders.clear();
  reads.length = 0;
  askMock.mockReset();
  noticeStore.setState({ message: null, action: null });
  folder = makeTestFolder();
  project = await createProject(folder.path('Harbor Lights.sbd'), { driver: nodeDriver, backups: false });
  disk = fakeFolder(7, 'Harbor Lights Suggestions');
});

afterEach(async () => {
  // Rust finds the folder and the project's id itself: the page sends neither a path nor an id.
  for (const [, args] of invoke.mock.calls as [string, Record<string, unknown>][]) {
    expect(Object.keys(args).sort()).not.toContain('projectId');
    expect(Object.keys(args)).not.toContain('path');
  }
  await projectStore.getState().close();
  folder.remove();
});

const suggestions = () => Object.values(projectStore.getState().records).filter((r) => r.type === 'suggestion');
const groups = async () => (await log(project.file)).length;
const notice = () => noticeStore.getState();

describe('the suggestions folder, brought in (7.1 round 2)', () => {
  it('brings every new file in at open as one op group, which one undo takes back', async () => {
    for (const n of [1, 2, 3]) disk.files.set(`${String(n)}.sbdchanges`, { bytes: changeFile(project.projectId, n, 2), modified: 1 });
    await openAs(project, 7);
    const before = await groups();
    await bringInFolder();
    expect(suggestions()).toHaveLength(6);
    expect(await groups()).toBe(before + 1);
    expect(notice().message).toBe('Brought in 6 suggestions from 3 change files.');
    await projectStore.getState().undo();
    expect(suggestions()).toHaveLength(0);
    // The project's open pass is once: a second ask while it stays open reads nothing.
    reads.length = 0;
    await bringInFolder();
    expect(reads).toEqual([]);
  });

  it('reads at most 200 files a pass; the rest wait with a line and Bring in, which brings the next ones', async () => {
    for (let n = 0; n < 205; n += 1) disk.files.set(`${String(n).padStart(3, '0')}.sbdchanges`, { bytes: changeFile(project.projectId, n), modified: 1 });
    await openAs(project, 7);
    await bringInFolder();
    expect(suggestions()).toHaveLength(200);
    expect(reads).toHaveLength(200);
    expect(notice().message).toBe('Brought in 200 suggestions from 200 change files. 5 change files not looked at yet in Harbor Lights Suggestions.');
    expect(notice().action?.label).toBe('Bring in');
    // The first 200 are in: the next 5 come in, as one more step, and only they are read.
    reads.length = 0;
    const before = await groups();
    notice().action?.run();
    await bringInFolder();
    await vi.waitFor(() => {
      expect(suggestions()).toHaveLength(205);
    });
    expect(reads).toEqual(['200.sbdchanges', '201.sbdchanges', '202.sbdchanges', '203.sbdchanges', '204.sbdchanges']);
    expect(await groups()).toBe(before + 1);
    expect(notice().action).toBeNull();
  });

  it('brings in at most 2,000 suggestions and 10 MB of change files a pass', async () => {
    disk.files.set('a.sbdchanges', { bytes: changeFile(project.projectId, 1, 1500), modified: 1 });
    disk.files.set('b.sbdchanges', { bytes: changeFile(project.projectId, 2, 1500), modified: 1 });
    await openAs(project, 7);
    await bringInFolder();
    expect(suggestions()).toHaveLength(1500);
    expect(notice().message).toBe('Brought in 1500 suggestions from Robin Vale. 1 change file not looked at yet in Harbor Lights Suggestions.');

    // Listed at 4 MB each: two fit in a pass, the third waits.
    await projectStore.getState().close();
    const other = await createProject(folder.path('Saltmarsh.sbd'), { driver: nodeDriver, backups: false });
    const saltmarsh = fakeFolder(8, 'Saltmarsh Suggestions');
    for (const n of [1, 2, 3]) saltmarsh.files.set(`${String(n)}.sbdchanges`, { bytes: changeFile(other.projectId, n), modified: 1, listed: 4 * 1024 * 1024 });
    await openAs(other, 8);
    reads.length = 0;
    await bringInFolder();
    expect(reads).toEqual(['1.sbdchanges', '2.sbdchanges']);
    expect(notice().message).toContain('1 change file not looked at yet in Saltmarsh Suggestions.');
  });

  it('only finds what’s new when the window comes back to the front, and leaves undo and redo as they were', async () => {
    disk.files.set('1.sbdchanges', { bytes: changeFile(project.projectId, 1), modified: 1 });
    await openAs(project, 7);
    await bringInFolder();
    await projectStore.getState().undo();
    expect(projectStore.getState().canRedo).toBe(true);
    for (const n of [2, 3, 4]) disk.files.set(`${String(n)}.sbdchanges`, { bytes: changeFile(project.projectId, n), modified: 2 });
    const before = await groups();
    reads.length = 0;
    await findInFolder();
    expect(reads).toEqual([]);
    expect(await groups()).toBe(before);
    expect(projectStore.getState().canRedo).toBe(true);
    expect(notice().message).toBe('3 change files not looked at yet in Harbor Lights Suggestions.');
    // The same three found again: nothing new to say.
    const seq = notice().seq;
    await findInFolder();
    expect(notice().seq).toBe(seq);
    // Bring in: they come in; the undone one stays undone.
    notice().action?.run();
    await vi.waitFor(() => {
      expect(suggestions()).toHaveLength(3);
    });
    expect(reads).toEqual(['2.sbdchanges', '3.sbdchanges', '4.sbdchanges']);
  });

  it('never brings back an undone bring-in at the next open, but Import changes… by hand does', async () => {
    const bytes = changeFile(project.projectId, 1, 2);
    disk.files.set('1.sbdchanges', { bytes, modified: 1 });
    await openAs(project, 7);
    await bringInFolder();
    expect(suggestions()).toHaveLength(2);
    await projectStore.getState().undo();
    await projectStore.getState().close();

    const again = await openAs(await openProject(folder.path('Harbor Lights.sbd'), { driver: nodeDriver, backups: false }), 7);
    project = again;
    await bringInFolder();
    expect(reads).toEqual(['1.sbdchanges', '1.sbdchanges']);
    expect(suggestions()).toHaveLength(0);
    // The same bytes, chosen by hand: the person asked.
    expect((await bringInBytes(again, bytes)).kind).toBe('added');
    expect(suggestions()).toHaveLength(2);
  });

  it('offers a renamed project’s folder once per open, and reads it once renamed', async () => {
    disk.state = 'none';
    disk.renameFrom = 'Old Name Suggestions';
    disk.files.set('1.sbdchanges', { bytes: changeFile(project.projectId, 1), modified: 1 });
    askMock.mockResolvedValue('not_now');
    await openAs(project, 7);
    await bringInFolder();
    expect(askMock).toHaveBeenCalledTimes(1);
    await findInFolder();
    expect(askMock).toHaveBeenCalledTimes(1);
    expect(suggestions()).toHaveLength(0);

    await projectStore.getState().close();
    askMock.mockResolvedValue('rename');
    project = await openAs(await openProject(folder.path('Harbor Lights.sbd'), { driver: nodeDriver, backups: false }), 7);
    await bringInFolder();
    expect(askMock).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenCalledWith('changes_folder_rename', { handle: 7, from: 'Old Name Suggestions' });
    expect(suggestions()).toHaveLength(1);
  });

  it('says a folder for another project and a folder past 10,000 entries, once each', async () => {
    disk.state = 'other_project';
    disk.otherProjectName = 'Saltmarsh';
    await openAs(project, 7);
    await bringInFolder();
    expect(notice().message).toBe('The folder Harbor Lights Suggestions is for another project, Saltmarsh, so its suggestions weren’t brought in.');
    expect(notice().kind).toBe('warning');
    const seq = notice().seq;
    await findInFolder();
    expect(notice().seq).toBe(seq);

    disk.state = 'read';
    disk.capped = true;
    await findInFolder();
    expect(notice().message).toBe('Harbor Lights Suggestions holds more than 10,000 items: Storiiboard looked at the first 10,000 only.');
  });

  it('runs once at a time, and a switch while a run is under way still gets the new project’s open pass', async () => {
    disk.files.set('1.sbdchanges', { bytes: changeFile(project.projectId, 1), modified: 1 });
    let release = () => {};
    disk.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    await openAs(project, 7);
    const first = bringInFolder();

    const other = await createProject(folder.path('Saltmarsh.sbd'), { driver: nodeDriver, backups: false });
    const saltmarsh = fakeFolder(8, 'Saltmarsh Suggestions');
    saltmarsh.files.set('s.sbdchanges', { bytes: changeFile(other.projectId, 9, 3), modified: 1 });
    await openAs(other, 8);
    // As the shell asks when a project opens: during the run, so it runs after it.
    const second = bringInFolder();
    release();
    await first;
    await second;
    expect(projectStore.getState().project).toBe(other);
    expect(suggestions()).toHaveLength(3);
    expect(reads).toEqual(['s.sbdchanges']);
  });
});

describe('the suggestions folder, round 3: two budgets, one line, nothing left behind', () => {
  const listings = () => invoke.mock.calls.filter(([cmd]) => cmd === 'changes_folder').length;

  it('brings a new file in at open past 205 already in, which cost only the read budget, with no waiting line', async () => {
    for (let n = 0; n < 205; n += 1) disk.files.set(`${String(n).padStart(3, '0')}.sbdchanges`, { bytes: changeFile(project.projectId, n), modified: 1 });
    await openAs(project, 7);
    await bringInFolder();
    await bringInWaiting();
    expect(suggestions()).toHaveLength(205);
    await projectStore.getState().close();

    disk.files.set('999.sbdchanges', { bytes: changeFile(project.projectId, 999), modified: 2 });
    project = await openAs(await openProject(folder.path('Harbor Lights.sbd'), { driver: nodeDriver, backups: false }), 7);
    reads.length = 0;
    await bringInFolder();
    expect(suggestions()).toHaveLength(206);
    expect(reads).toHaveLength(206);
    expect(notice().message).toBe('Brought in 1 suggestion from Robin Vale.');
    expect(notice().action).toBeNull();
  });

  it('counts a failed read toward the read budget by its listed size, says them in one line, and tries them again', async () => {
    // 300 files of 200 KB as listed, every read failing: the 50 MB read budget stops the pass at 256.
    for (let n = 0; n < 300; n += 1) disk.files.set(`${String(n).padStart(3, '0')}.sbdchanges`, { bytes: changeFile(project.projectId, n), modified: 1, listed: 200 * 1024, fails: true });
    await openAs(project, 7);
    const seq = notice().seq;
    await bringInFolder();
    expect(reads).toHaveLength(MAX_READ_BYTES / (200 * 1024));
    expect(notice().seq).toBe(seq + 1);
    expect(notice().kind).toBe('warning');
    expect(notice().message).toBe('256 change files in Harbor Lights Suggestions couldn’t be read. 44 change files not looked at yet in Harbor Lights Suggestions.');
    expect(notice().action?.label).toBe('Bring in');
    // Never settled: found again as waiting, and read again by the next pass.
    for (const file of disk.files.values()) {
      file.fails = false;
      delete file.listed;
    }
    reads.length = 0;
    await bringInWaiting();
    expect(reads.slice(0, 3)).toEqual(['000.sbdchanges', '001.sbdchanges', '002.sbdchanges']);
    expect(suggestions()).toHaveLength(200);
  });

  it('keeps the pass’s own line when the window comes back to the front straight after', async () => {
    disk.files.set('a.sbdchanges', { bytes: changeFile(project.projectId, 1, 1500), modified: 1 });
    disk.files.set('b.sbdchanges', { bytes: changeFile(project.projectId, 2, 1500), modified: 1 });
    await openAs(project, 7);
    await bringInFolder();
    const said = notice().message;
    expect(said).toBe('Brought in 1500 suggestions from Robin Vale. 1 change file not looked at yet in Harbor Lights Suggestions.');
    const seq = notice().seq;
    await findInFolder();
    expect(notice().seq).toBe(seq);
    expect(notice().message).toBe(said);
  });

  it('never brings back a bring-in undone this session, from the log read once at open and what each pass wrote', async () => {
    disk.files.set('1.sbdchanges', { bytes: changeFile(project.projectId, 1), modified: 1 });
    await openAs(project, 7);
    await bringInFolder();
    disk.files.set('2.sbdchanges', { bytes: changeFile(project.projectId, 2, 2), modified: 1 });
    await bringInWaiting();
    expect(suggestions()).toHaveLength(3);
    await projectStore.getState().undo();
    expect(suggestions()).toHaveLength(1);
    // The same file rewritten (a new time): read again, and skipped whole, as its id was brought in.
    disk.files.set('2.sbdchanges', { bytes: changeFile(project.projectId, 2, 2), modified: 5 });
    reads.length = 0;
    await bringInWaiting();
    expect(reads).toEqual(['2.sbdchanges']);
    expect(suggestions()).toHaveLength(1);
  });

  it('reads nothing of the log when no file is waiting', async () => {
    await openAs(project, 7);
    const query = vi.spyOn(project.file, 'query');
    await bringInFolder();
    expect(query.mock.calls.some(([sql]) => sql.includes('FROM ops'))).toBe(false);
    query.mockRestore();
  });

  it('leaves nothing behind on a switch: the line goes, and a Bring in pressed after it brings nothing in', async () => {
    disk.files.set('1.sbdchanges', { bytes: changeFile(project.projectId, 1), modified: 1 });
    await openAs(project, 7);
    await bringInFolder();
    disk.files.set('2.sbdchanges', { bytes: changeFile(project.projectId, 2), modified: 1 });
    await findInFolder();
    const stale = notice().action;
    expect(stale?.label).toBe('Bring in');

    const other = await createProject(folder.path('Saltmarsh.sbd'), { driver: nodeDriver, backups: false });
    fakeFolder(8, 'Saltmarsh Suggestions');
    await openAs(other, 8);
    // Pressed for Harbor Lights while Saltmarsh is open: its line goes, and nothing is read or brought in.
    const before = listings();
    reads.length = 0;
    stale?.run();
    await Promise.resolve();
    expect(notice().message).toBeNull();
    expect(listings()).toBe(before);
    expect(reads).toEqual([]);

    // The shell's switch and close: a line about the open project stays; one about a project left behind goes.
    const saltmarsh = folders.get(8);
    saltmarsh?.files.set('a.sbdchanges', { bytes: changeFile(other.projectId, 1, 1500), modified: 1 });
    saltmarsh?.files.set('b.sbdchanges', { bytes: changeFile(other.projectId, 2, 1500), modified: 1 });
    await bringInFolder();
    expect(notice().action?.label).toBe('Bring in');
    dropFolderNotice();
    expect(notice().action?.label).toBe('Bring in');
    await projectStore.getState().close();
    dropFolderNotice();
    expect(notice().message).toBeNull();
  });

  it('says nothing into another project when a run fails after a switch', async () => {
    let release = () => {};
    disk.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    disk.listFails = true;
    await openAs(project, 7);
    const first = bringInFolder();
    const other = await createProject(folder.path('Saltmarsh.sbd'), { driver: nodeDriver, backups: false });
    fakeFolder(8, 'Saltmarsh Suggestions');
    await openAs(other, 8);
    const second = bringInFolder();
    release();
    await first;
    await second;
    expect(notice().message).toBeNull();
  });

  it('loses no request made in any microtask as a run ends', async () => {
    await openAs(project, 7);
    await bringInFolder();
    for (let depth = 0; depth < 12; depth += 1) {
      disk.files.set(`${String(depth)}.sbdchanges`, { bytes: changeFile(project.projectId, 100 + depth), modified: 1 });
      const before = listings();
      const late: { run: Promise<void> | null } = { run: null };
      // The pass's last line is said in the run's last turn: a find asked `depth` microtasks later.
      const stop = noticeStore.subscribe(() => {
        stop();
        let chain = Promise.resolve();
        for (let i = 0; i < depth; i += 1) chain = chain.then(() => undefined);
        void chain.then(() => {
          late.run = findInFolder();
        });
      });
      await bringInWaiting();
      await vi.waitFor(() => {
        expect(late.run).not.toBeNull();
      });
      await late.run;
      // The pass listed once, and the find after it once more: none lost.
      expect(listings() - before).toBe(2);
    }
  });
});

describe('the suggestions folder, round 4: the last lows', () => {
  const held = () => {
    const made: { promise: Promise<void>; release: () => void } = { promise: Promise.resolve(), release: () => {} };
    made.promise = new Promise<void>((resolve) => {
      made.release = resolve;
    });
    return made;
  };

  it('says no refusal into another project when a switch comes while a file is read', async () => {
    const read = held();
    disk.files.set('1.sbdchanges', { bytes: new TextEncoder().encode('not a change file'), modified: 1, hold: read.promise });
    await openAs(project, 7);
    const first = bringInFolder();
    await vi.waitFor(() => {
      expect(reads).toEqual(['1.sbdchanges']);
    });
    const other = await createProject(folder.path('Saltmarsh.sbd'), { driver: nodeDriver, backups: false });
    fakeFolder(8, 'Saltmarsh Suggestions');
    await openAs(other, 8);
    const second = bringInFolder();
    read.release();
    await first;
    await second;
    expect(notice().message).toBeNull();
  });

  it('says nothing of a rename into another project when a switch comes while the folder is renamed', async () => {
    const rename = held();
    disk.state = 'none';
    disk.renameFrom = 'Old Name Suggestions';
    disk.renameHold = rename.promise;
    askMock.mockResolvedValue('rename');
    await openAs(project, 7);
    const first = bringInFolder();
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('changes_folder_rename', { handle: 7, from: 'Old Name Suggestions' });
    });
    const other = await createProject(folder.path('Saltmarsh.sbd'), { driver: nodeDriver, backups: false });
    fakeFolder(8, 'Saltmarsh Suggestions');
    await openAs(other, 8);
    const second = bringInFolder();
    rename.release();
    await first;
    await second;
    expect(notice().message).toBeNull();
  });

  it('goes past a file too large for what’s left of 10 MB, so one already in never blocks a small new one', async () => {
    const MB = 1024 * 1024;
    disk.files.set('c.sbdchanges', { bytes: changeFile(project.projectId, 3), modified: 1, listed: 2 * MB });
    await openAs(project, 7);
    await bringInFolder();
    expect(suggestions()).toHaveLength(1);
    await projectStore.getState().close();

    // 5 MB new, 4 MB new, 2 MB already in, 10 KB new, in name order: the 2 MB one waits unread; the 10 KB one comes in.
    disk.files.set('a.sbdchanges', { bytes: changeFile(project.projectId, 1), modified: 1, listed: 5 * MB });
    disk.files.set('b.sbdchanges', { bytes: changeFile(project.projectId, 2), modified: 1, listed: 4 * MB });
    disk.files.set('d.sbdchanges', { bytes: changeFile(project.projectId, 4), modified: 1, listed: 10 * 1024 });
    project = await openAs(await openProject(folder.path('Harbor Lights.sbd'), { driver: nodeDriver, backups: false }), 7);
    reads.length = 0;
    await bringInFolder();
    expect(reads).toEqual(['a.sbdchanges', 'b.sbdchanges', 'd.sbdchanges']);
    expect(suggestions()).toHaveLength(4);
    expect(notice().message).toBe('Brought in 3 suggestions from 3 change files. 1 change file not looked at yet in Harbor Lights Suggestions.');
  });

  it('keeps what a bring-in by hand wrote while the log was first read, so its undo stays undone', async () => {
    const bytes = changeFile(project.projectId, 1);
    disk.files.set('1.sbdchanges', { bytes, modified: 1 });
    await openAs(project, 7);
    // The log's answer is read before the by-hand bring-in commits, and handed back only after it and its undo.
    const original = project.file.query.bind(project.file);
    const answer = held();
    const begun = held();
    let first = true;
    const query = vi.spyOn(project.file, 'query').mockImplementation(async (...args: Parameters<typeof original>) => {
      const rows = await original(...args);
      if (first && args[0].includes('change_file_id')) {
        first = false;
        begun.release();
        await answer.promise;
      }
      return rows;
    });
    const pass = bringInFolder();
    await begun.promise;
    expect((await bringInBytes(project, bytes)).kind).toBe('added');
    await projectStore.getState().undo();
    expect(suggestions()).toHaveLength(0);
    answer.release();
    await pass;
    query.mockRestore();
    expect(reads).toEqual(['1.sbdchanges']);
    expect(suggestions()).toHaveLength(0);
  });

  it('takes a pass’s line with files that couldn’t be read away on ⌘Z, as it does without them', async () => {
    disk.files.set('1.sbdchanges', { bytes: changeFile(project.projectId, 1), modified: 1 });
    disk.files.set('2.sbdchanges', { bytes: changeFile(project.projectId, 2), modified: 1, fails: true });
    await openAs(project, 7);
    await bringInFolder();
    expect(notice().message).toBe('Brought in 1 suggestion from Robin Vale. 1 change file in Harbor Lights Suggestions couldn’t be read.');
    expect(notice().kind).toBe('warning');
    expect(notice().step).toBe(true);
    await projectStore.getState().undo();
    expect(notice().message).toBeNull();
  });
});
