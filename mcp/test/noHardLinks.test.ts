import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { makeTestFolder } from '../../src/core/storage/testFolder';
import { FolderRefused, writeChangeFile } from '../src/changeFolder';

// The write on a volume with no hard links (exFAT, FAT, some network shares; 7.6 round 2): every link fails, so the
// file goes in by a copy that fails if anything of its name is there (COPYFILE_EXCL), never a rename that replaces it,
// and the temporary file goes either way.

vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>();
  return {
    ...fs,
    linkSync: () => {
      throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
    },
  };
});

const folder = makeTestFolder();

afterAll(() => {
  folder.remove();
});

describe('the write with no hard links (7.6 round 2)', () => {
  it('copies the file in under its name, and never over a file of that name', () => {
    const dir = folder.path('Harbor Lights Suggestions');
    mkdirSync(dir);
    writeChangeFile(dir, 'a.sbdchanges', new TextEncoder().encode('{"a":1}'));
    expect(readdirSync(dir)).toEqual(['a.sbdchanges']);
    expect(readFileSync(`${dir}/a.sbdchanges`, 'utf8')).toBe('{"a":1}');
    writeFileSync(`${dir}/b.sbdchanges`, 'kept');
    expect(() => {
      writeChangeFile(dir, 'b.sbdchanges', new TextEncoder().encode('{}'));
    }).toThrow(new FolderRefused('A change file of that name is already there: nothing was written. Try again.'));
    expect(readFileSync(`${dir}/b.sbdchanges`, 'utf8')).toBe('kept');
    expect(readdirSync(dir).sort()).toEqual(['a.sbdchanges', 'b.sbdchanges']);
  });
});
