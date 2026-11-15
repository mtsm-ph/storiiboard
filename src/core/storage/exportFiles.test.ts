import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { chooseExportFolder } from './exportFiles';

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
