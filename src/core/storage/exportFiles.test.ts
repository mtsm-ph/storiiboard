import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { chooseExportFile, chooseExportFolder } from './exportFiles';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const invokeMock = vi.mocked(invoke);

/** The JSON header of an export_write body (a 4-byte big-endian length, then the header, then the bytes). */
function headerOf(body: unknown): Record<string, unknown> {
  const bytes = body as Uint8Array;
  const length = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + length))) as Record<string, unknown>;
}

/** The actions each export_write carried, in order. */
const actions = () => invokeMock.mock.calls.filter(([command]) => command === 'export_write').map(([, body]) => headerOf(body).action);

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((command: string) => Promise.resolve(command === 'export_choose_folder' ? { path: '/Exports', token: 'run-1' } : 'Pitch'));
});

// B6 (6.15, docs/DESKTOP_GAPS.md): Rust keeps a folder export's token until the run says it is over ('finish' or
// 'remove_folder'). A set written with `write` alone (PNG frames) never commits, so `end` gives the token back.
describe('a folder export in the desktop app', () => {
  it('written file by file, gives its token back once it ends, and only once', async () => {
    const target = await chooseExportFolder('Pitch', true);
    if (!target) throw new Error('no target');
    await target.write('SC001_1A.png', new Uint8Array([1]));
    await target.write('SC001_1B.png', new Uint8Array([2]));
    expect(actions()).toEqual(['stage', 'commit', 'stage', 'commit']);
    await target.end?.();
    await target.end?.();
    expect(actions()).toEqual(['stage', 'commit', 'stage', 'commit', 'finish']);
    // Every write of the run carried its token, the finish too.
    expect(invokeMock.mock.calls.filter(([command]) => command === 'export_write').map(([, body]) => headerOf(body).token)).toEqual(Array(5).fill('run-1'));
  });

  it('staged and committed, or abandoned, has ended already: end sends nothing more', async () => {
    const committed = await chooseExportFolder('Pitch', true);
    await committed?.stage?.('page-1.png', new Uint8Array([1]));
    await committed?.commit?.();
    await committed?.end?.();
    expect(actions()).toEqual(['stage', 'commit', 'finish']);

    invokeMock.mockClear();
    const abandoned = await chooseExportFolder('Pitch', true);
    await abandoned?.stage?.('page-1.png', new Uint8Array([1]));
    await abandoned?.abandon?.();
    await abandoned?.end?.();
    expect(actions()).toEqual(['stage', 'remove_temp', 'remove_folder']);
  });

  it('that wrote nothing still gives its token back', async () => {
    const target = await chooseExportFolder('Pitch', true);
    await target?.end?.();
    expect(actions()).toEqual(['finish']);
  });

  it('a refused finish is no failure of the export', async () => {
    const target = await chooseExportFolder('Pitch', true);
    invokeMock.mockRejectedValue(new Error('Storiiboard writes exports only where you choose.'));
    await expect(target?.end?.()).resolves.toBeUndefined();
  });
});

// 6.15 review: a file the Save dialog picked stays writable in Rust until it is written; an export that stops first
// (or fails) says it is over, so it can't be written later in the session.
describe('a single-file export in the desktop app', () => {
  beforeEach(() => {
    invokeMock.mockImplementation((command: string) => Promise.resolve(command === 'export_choose_file' ? '/Exports/Bey County.csv' : ''));
  });

  it('stopped before its write, lets the file go, once', async () => {
    const target = await chooseExportFile('Bey County.csv', true);
    await target?.end?.();
    await target?.end?.();
    const writes = invokeMock.mock.calls.filter(([command]) => command === 'export_write').map(([, body]) => headerOf(body));
    expect(writes).toEqual([{ path: '/Exports/Bey County.csv', action: 'end' }]);
  });

  it('written, has nothing left to end', async () => {
    const target = await chooseExportFile('Bey County.csv', true);
    await target?.write('Bey County.csv', new Uint8Array([1]));
    await target?.end?.();
    expect(actions()).toEqual([undefined]);
  });

  it('a refused end is no failure of the export', async () => {
    const target = await chooseExportFile('Bey County.csv', true);
    invokeMock.mockRejectedValue(new Error('Storiiboard writes exports only where you choose.'));
    await expect(target?.end?.()).resolves.toBeUndefined();
  });

  it('in the browser build downloads and holds nothing', async () => {
    const target = await chooseExportFile('Bey County.csv', false);
    expect(target !== null && 'end' in target).toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

// 6.15's review: the page's `end` must be what Rust's export_write reads as one (src-tauri/src/export.rs, read as text as
// exportExtensions.test.ts reads it): a header with no `folder` (that goes to a folder's run first) and no `name` (end_file
// lets go only a file's own choice), whose action is the one the dispatch compares with, and only fields WriteHeader has.
describe('the header a single-file export’s end sends', () => {
  const rust = readFileSync(new URL('../../../src-tauri/src/export.rs', import.meta.url), 'utf8');
  const fields = [...(/struct WriteHeader \{([\s\S]*?)\n\}/.exec(rust)?.[1] ?? '').matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]);
  const dispatched = /header\.action\.as_deref\(\) == Some\("([a-z_]+)"\) \{\s*end_file\(/.exec(rust)?.[1];

  beforeEach(() => {
    invokeMock.mockImplementation((command: string) => Promise.resolve(command === 'export_choose_file' ? '/Exports/Bey County.csv' : ''));
  });

  it('is exactly { path, action: "end" }, as Rust’s dispatch reads it', async () => {
    expect(fields).toEqual(['path', 'name', 'folder', 'action', 'token']);
    expect(dispatched).toBe('end');
    expect(rust).toMatch(/fn end_file\(chosen: &Chosen, header: &WriteHeader\) \{\s*if header\.name\.is_none\(\)/);
    // The folder's branch comes first in export_write, so a header with a folder never reaches end_file.
    expect(rust.indexOf('if header.folder.is_some()')).toBeLessThan(rust.indexOf('Some("end")'));
    const target = await chooseExportFile('Bey County.csv', true);
    await target?.end?.();
    const sent = invokeMock.mock.calls.filter(([command]) => command === 'export_write').map(([, body]) => headerOf(body));
    expect(sent).toEqual([{ path: '/Exports/Bey County.csv', action: dispatched }]);
    for (const header of sent) for (const key of Object.keys(header)) expect(fields).toContain(key);
    // And no bytes after the header.
    const body = invokeMock.mock.calls.find(([command]) => command === 'export_write')?.[1] as Uint8Array;
    expect(body.length).toBe(4 + new DataView(body.buffer, body.byteOffset).getUint32(0));
  });
});
