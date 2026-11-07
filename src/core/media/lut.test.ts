import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { apply, getRecord, undo } from '../ops/ops';
import { nodeDriver } from '../storage/nodeDriver';
import { createProject, type Project } from '../storage/project';
import { makeTestFolder, type TestFolder } from '../storage/testFolder';
import { listLuts, lutForCopy, lutStatements, lutWithSha, prepareLut, readCube } from './lut';

// LUTs (2.5): a `.cube` read by its rules, refused plainly when FFmpeg's lut3d couldn't use it, and stored once per
// project by its SHA-256, in the same transaction as the edit that first sets it.

/** A 2-point cube that inverts: written here, as no camera maker's LUT is ever shipped. */
const INVERT = ['1 1 1', '0 1 1', '1 0 1', '0 0 1', '1 1 0', '0 1 0', '1 0 0', '0 0 0'];
const cube = (head: string[], rows = INVERT) => [...head, ...rows, ''].join('\n');

describe('reading a .cube', () => {
  it('takes a 3D LUT with its title and comments, and hands ffmpeg the size and rows alone', () => {
    const read = readCube(cube(['# Made by hand', 'TITLE "Invert"', 'LUT_3D_SIZE 2', '', '# rows']));
    expect(read).toEqual({ ok: true, size: 2, forCopy: cube(['LUT_3D_SIZE 2']) });
  });

  it('reads Windows line ends, numbers as cameras write them, and keeps a domain that isn’t 0 to 1', () => {
    const rows = ['0.000000 0.000000 0.000000', '1.0e0 0 0', '0 1 0', '1 1 0', '0 0 1', '1 0 1', '0 1 1', '+1 1 1'];
    const read = readCube(['LUT_3D_SIZE 2', 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1.5 1.5 1.5', ...rows].join('\r\n'));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.forCopy.split('\n').slice(0, 4)).toEqual(['LUT_3D_SIZE 2', 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1.5 1.5 1.5', '0 0 0']);
    expect(read.forCopy.split('\n')[4]).toBe('1 0 0');
    // A Resolve keyword ffmpeg might not know is left out of what it reads.
    const resolve = readCube(cube(['LUT_3D_SIZE 2', 'LUT_3D_INPUT_RANGE 0 1']));
    expect(resolve).toEqual({ ok: true, size: 2, forCopy: cube(['LUT_3D_SIZE 2']) });
  });

  it('refuses what lut3d can’t use, saying why', () => {
    expect(readCube('not a LUT at all')).toEqual({ ok: false, problem: 'notCube' });
    expect(readCube(INVERT.join('\n'))).toEqual({ ok: false, problem: 'notCube' });
    expect(readCube(cube(['LUT_1D_SIZE 2'], ['0 0 0', '1 1 1']))).toEqual({ ok: false, problem: 'oneD' });
    // A 1D shaper ahead of the 3D LUT (a Resolve export): lut3d reads the 3D kind alone.
    expect(readCube(cube(['LUT_1D_SIZE 2', 'LUT_3D_SIZE 2']))).toEqual({ ok: false, problem: 'oneD' });
    expect(readCube(cube(['LUT_3D_SIZE 1'], ['0 0 0']))).toEqual({ ok: false, problem: 'size' });
    expect(readCube(cube(['LUT_3D_SIZE 257']))).toEqual({ ok: false, problem: 'size' });
    expect(readCube(cube(['LUT_3D_SIZE 2.5']))).toEqual({ ok: false, problem: 'size' });
    expect(readCube(cube(['LUT_3D_SIZE 2'], INVERT.slice(1)))).toEqual({ ok: false, problem: 'rows' });
    expect(readCube(cube(['LUT_3D_SIZE 2'], [...INVERT.slice(1), '0 0']))).toEqual({ ok: false, problem: 'rows' });
    expect(readCube(cube(['LUT_3D_SIZE 2'], [...INVERT.slice(1), '0 0 x']))).toEqual({ ok: false, problem: 'rows' });
    // A keyword between the rows.
    expect(readCube(cube(['LUT_3D_SIZE 2'], [...INVERT.slice(0, 4), 'TITLE "late"', ...INVERT.slice(4)]))).toEqual({ ok: false, problem: 'rows' });
    expect(readCube(cube(['LUT_3D_SIZE 2', 'DOMAIN_MIN 0 0']))).toEqual({ ok: false, problem: 'domain' });
    expect(readCube(cube(['LUT_3D_SIZE 2', 'DOMAIN_MIN 1 1 1', 'DOMAIN_MAX 0 0 0']))).toEqual({ ok: false, problem: 'domain' });
  });

  it('names a LUT by its file without .cube, and its SHA-256 by the file’s text as it was', async () => {
    const text = cube(['TITLE "Invert"', 'LUT_3D_SIZE 2']);
    const prepared = await prepareLut('SLog3SGamut3.CineToLC-709.CUBE', text);
    expect(prepared).toEqual({
      ok: true,
      lut: { sha256: createHash('sha256').update(text).digest('hex'), name: 'SLog3SGamut3.CineToLC-709', fileName: 'SLog3SGamut3.CineToLC-709.CUBE', cube: text },
    });
    expect(await prepareLut('broken.cube', 'LUT_1D_SIZE 2\n0 0 0\n1 1 1\n')).toEqual({ ok: false, problem: 'oneD' });
  });
});

describe('LUTs in the project file', () => {
  let folder: TestFolder;
  let project: Project;
  beforeEach(async () => {
    folder = makeTestFolder();
    project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  });
  afterEach(async () => {
    await project.close();
    folder.remove();
  });

  it('stores a LUT once, with the edit that sets it, and reads it back for a copy; undo leaves the LUT stored', async () => {
    const prepared = await prepareLut('Invert.cube', cube(['TITLE "Invert"', 'LUT_3D_SIZE 2']));
    if (!prepared.ok) throw new Error('a good cube');
    const id = 'f6e3b1b0-0000-4000-8000-000000000001';
    await apply(
      project.file,
      [{ kind: 'create', record: { id: 'v1', type: 'media', parentId: project.projectId, sortKey: 'a', props: { kind: 'video' } } }],
      {},
    );
    await apply(project.file, [{ kind: 'update', id: 'v1', set: { lut: id } }], { alsoWrite: lutStatements(id, prepared.lut, new Date()) });
    expect(await lutWithSha(project.file, prepared.lut.sha256)).toBe(id);
    expect(await listLuts(project.file)).toEqual([{ id, sha256: prepared.lut.sha256, name: 'Invert', fileName: 'Invert.cube' }]);
    // The text ffmpeg reads, and the hash the copy's key takes; the stored text is the file's own.
    expect(await lutForCopy(project.file, id)).toEqual({ sha256: prepared.lut.sha256, cube: cube(['LUT_3D_SIZE 2']) });
    const [row] = await project.file.query('SELECT cube, byte_size FROM luts');
    expect(row).toEqual({ cube: prepared.lut.cube, byte_size: prepared.lut.cube.length });
    // Stored again under another id (a second load raced the first): the one there stays, the other is ignored.
    await project.file.tx(lutStatements('f6e3b1b0-0000-4000-8000-000000000002', prepared.lut, new Date()));
    expect(await listLuts(project.file)).toHaveLength(1);
    await undo(project.file);
    expect((await getRecord(project.file, 'v1'))?.props.lut).toBeUndefined();
    expect(await listLuts(project.file)).toHaveLength(1);
    expect(await lutForCopy(project.file, 'no-such-lut')).toBeNull();
  });
});
