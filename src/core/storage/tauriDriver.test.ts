import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { tauriAppData } from './appData';
import { packRawTx, tauriDriver } from './tauriDriver';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  invokeMock.mockReset();
});

// Playwright can't drive the Mac app, so this checks the one thing the Rust tests can't: that each call reaches its
// command with the argument names Tauri maps onto the Rust parameters (camelCase here, snake_case there).
describe('the desktop driver', () => {
  it('sends each call to its Rust command', async () => {
    invokeMock.mockImplementation((command: string) =>
      Promise.resolve(command === 'sbd_open' ? 7 : command === 'sbd_query' ? [{ lens: 35 }] : null),
    );
    const file = await tauriDriver.open('/Projects/Bey.sbd');
    await file.tx([{ sql: 'INSERT INTO t VALUES (?)', params: [1] }, { sql: 'DELETE FROM t' }]);
    expect(await file.query('SELECT lens FROM shots', ['1A'])).toEqual([{ lens: 35 }]);
    await file.backup('scheduled', 'Bey 2026-11-02 14-05.sbd');
    await file.listBackups();
    await file.deleteBackup('Bey 2026-11-02 14-05.sbd');
    await file.close();
    await tauriAppData.write('recent.json', '[]');

    expect(invokeMock.mock.calls).toEqual([
      ['sbd_open', { path: '/Projects/Bey.sbd' }],
      [
        'sbd_tx',
        {
          handle: 7,
          statements: [
            { sql: 'INSERT INTO t VALUES (?)', params: [1] },
            { sql: 'DELETE FROM t', params: [] },
          ],
        },
      ],
      ['sbd_query', { handle: 7, sql: 'SELECT lens FROM shots', params: ['1A'] }],
      ['sbd_backup', { handle: 7, kind: 'scheduled', fileName: 'Bey 2026-11-02 14-05.sbd' }],
      ['sbd_backups', { handle: 7 }],
      ['sbd_delete_backup', { handle: 7, fileName: 'Bey 2026-11-02 14-05.sbd' }],
      ['sbd_close', { handle: 7 }],
      ['app_data_write', { name: 'recent.json', contents: '[]' }],
    ]);
  });

  // Pictures go over as raw bytes, not a JSON array of numbers four times their size (decided Nov 2).
  it('sends a transaction with bytes in it as one raw body, and reads bytes back', async () => {
    invokeMock.mockImplementation((command: string) =>
      Promise.resolve(command === 'sbd_open' ? 7 : command === 'sbd_read_blob' ? new Uint8Array([9, 8]).buffer : null),
    );
    const file = await tauriDriver.open('/Projects/Bey.sbd');
    const image = new Uint8Array([0, 255, 10, 13]);
    await file.tx([{ sql: 'INSERT INTO media_files (sha256, bytes) VALUES (?, ?)', params: ['ab', image] }]);
    expect(await file.readBlob('SELECT bytes FROM media_files WHERE sha256 = ?', ['ab'])).toEqual(new Uint8Array([9, 8]));

    const [command, body] = invokeMock.mock.calls[1] ?? [];
    expect(command).toBe('sbd_tx_raw');
    expect(body).toEqual(packRawTx(7, [{ sql: 'INSERT INTO media_files (sha256, bytes) VALUES (?, ?)', params: ['ab', image] }]));
    expect(invokeMock.mock.calls[2]).toEqual(['sbd_read_blob', { handle: 7, sql: 'SELECT bytes FROM media_files WHERE sha256 = ?', params: ['ab'] }]);
  });

  it('packs a raw body as the Rust side reads it: header length, JSON header, then the bytes', () => {
    const body = packRawTx(3, [
      { sql: 'A', params: [new Uint8Array([1, 2, 3]), 'x'] },
      { sql: 'B', params: [new Uint8Array([4, 5])] },
    ]);
    const length = new DataView(body.buffer).getUint32(0);
    const header: unknown = JSON.parse(new TextDecoder().decode(body.subarray(4, 4 + length)));
    expect(header).toEqual({
      handle: 3,
      statements: [
        { sql: 'A', params: [{ $blob: [0, 3] }, 'x'] },
        { sql: 'B', params: [{ $blob: [3, 2] }] },
      ],
    });
    expect([...body.subarray(4 + length)]).toEqual([1, 2, 3, 4, 5]);
  });

  it("turns the Rust side's error message into an Error", async () => {
    invokeMock.mockRejectedValueOnce('A file already exists at that path.');
    const failure = tauriDriver.create('/Projects/Bey.sbd');
    await expect(failure).rejects.toBeInstanceOf(Error);
    invokeMock.mockRejectedValueOnce('A file already exists at that path.');
    await expect(tauriDriver.create('/Projects/Bey.sbd')).rejects.toThrow('A file already exists at that path.');
  });
});
