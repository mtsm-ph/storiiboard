import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { tauriAppData } from './appData';
import { tauriDriver } from './tauriDriver';

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

  it("turns the Rust side's error message into an Error", async () => {
    invokeMock.mockRejectedValueOnce('A file already exists at that path.');
    const failure = tauriDriver.create('/Projects/Bey.sbd');
    await expect(failure).rejects.toBeInstanceOf(Error);
    invokeMock.mockRejectedValueOnce('A file already exists at that path.');
    await expect(tauriDriver.create('/Projects/Bey.sbd')).rejects.toThrow('A file already exists at that path.');
  });
});
