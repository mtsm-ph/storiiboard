import { describe, expect, it } from 'vitest';
import { loadSettings, SETTINGS_KEY } from '../../core/storage/settings';
import { noteIfSynced, syncNote } from './synced';

function memoryStorage() {
  let value: string | null = null;
  return {
    getItem: (key: string) => (key === SETTINGS_KEY ? value : null),
    setItem: (key: string, next: string) => {
      if (key === SETTINGS_KEY) value = next;
    },
  };
}

const bey = '/Users/kevin/Documents/Bey County.sbd';
const local = '/Users/kevin/Movies/Storiiboard/Pilot.sbd';
const lookup = (path: string) => Promise.resolve(path.includes('/Documents/') ? 'iCloud Drive' : null);

describe('the note for a project in a synced folder', () => {
  it('says which service, and to keep it open on one computer at a time', () => {
    expect(syncNote(bey, 'iCloud Drive')).toBe(
      '“Bey County” is in iCloud Drive. That works, but keep it open on one computer at a time: Storiiboard warns you when another computer has it open.',
    );
  });

  it('shows once per project, and never for a project only on this computer', async () => {
    const storage = memoryStorage();
    const shown: string[] = [];
    const show = (message: string) => shown.push(message);

    expect(await noteIfSynced(bey, { lookup, show, storage })).toBe(true);
    expect(await noteIfSynced(bey, { lookup, show, storage })).toBe(false);
    expect(await noteIfSynced(local, { lookup, show, storage })).toBe(false);
    expect(shown).toHaveLength(1);
    expect(loadSettings(storage).syncNoted).toEqual([bey]);
  });

  it('stays quiet when the check itself fails', async () => {
    const shown: string[] = [];
    const failing = () => Promise.reject(new Error('no Rust in this test'));
    expect(await noteIfSynced(bey, { lookup: failing, show: (m) => shown.push(m), storage: memoryStorage() })).toBe(false);
    expect(shown).toEqual([]);
  });
});
