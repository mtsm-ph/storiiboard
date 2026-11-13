import { beforeEach, describe, expect, it, vi } from 'vitest';

// Show in Finder / Explorer on the desktop (5.9): the page names the picture's record and hash, never a path.

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri: () => true }));
vi.mock('./fileAccess', () => ({ isTauriApp: true, fileMode: 'desktop' }));

import { projectStore } from './projectStore';
import { originalShown, revealOriginal } from './opener';

const SHA = 'b'.repeat(64);

beforeEach(() => {
  invoke.mockReset();
  projectStore.setState({ project: { file: { nativeHandle: 7 } } as never });
});

describe('the desktop commands', () => {
  it('ask Rust with the handle, the record and the hash only', async () => {
    invoke.mockResolvedValue(true);
    expect(await originalShown('rec-1', SHA)).toBe(true);
    expect(invoke).toHaveBeenCalledWith('original_shown', { handle: 7, recordId: 'rec-1', sha256: SHA });
    await revealOriginal('rec-1', SHA);
    expect(invoke).toHaveBeenLastCalledWith('reveal_original', { handle: 7, recordId: 'rec-1', sha256: SHA });
  });

  it('say no when Rust refuses, and a failed reveal is one plain error with no path in it', async () => {
    invoke.mockRejectedValue('C:\\Users\\someone\\secret.jpg is gone');
    expect(await originalShown('rec-1', SHA)).toBe(false);
    await expect(revealOriginal('rec-1', SHA)).rejects.toThrow("That picture's original isn't where it was.");
  });
});
