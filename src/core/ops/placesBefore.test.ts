import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SbdRecord } from '../model/record';
import { nodeDriver } from '../storage/nodeDriver';
import { createProject, type Project } from '../storage/project';
import { makeTestFolder, type TestFolder } from '../storage/testFolder';
import { apply, childrenBefore, emptyTrash, lastOpSeq, placesBefore, type Change } from './ops';

// childrenBefore is placesBefore's one-ask form (History reads a place's records as they were before a step, 6.30):
// asked one place at a time or all together, both give the same records, whatever happened to them since.

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

const create = (id: string, type: SbdRecord['type'], parentId: string, sortKey: string): Change => ({
  kind: 'create',
  record: { id, type, parentId, sortKey, props: type === 'scene' ? { number: id } : { number: id.toUpperCase() } },
});
/** The seq just after everything written so far: a place asked at it is as the last step left it. */
const now = async () => (await lastOpSeq(project.file)) + 1;
const ids = (records: readonly SbdRecord[]) => records.map((r) => r.id).sort();

describe('childrenBefore and placesBefore', () => {
  it('give the same records for every ask: made later, in the Trash then, moved away later, deleted for good', async () => {
    const file = project.file;
    await apply(file, [create('s4', 'scene', project.projectId, 'a'), create('s5', 'scene', project.projectId, 'b')]);
    await apply(file, [create('f1', 'shot', 's4', 'a')]);
    const onlyF1 = await now();
    // f2 made after the first ask: not in it.
    await apply(file, [create('f2', 'shot', 's4', 'b'), create('f3', 'shot', 's4', 'c')]);
    const allThree = await now();
    await apply(file, [{ kind: 'trash', id: 'f1' }]);
    const f1Trashed = await now();
    // f2 moved to scene 5 later: still under scene 4 when asked before the move.
    await apply(file, [{ kind: 'move', id: 'f2', parentId: 's5', sortKey: 'a' }]);
    const f2Moved = await now();
    // f3 deleted for good (f1 stays in the Trash): its writes keep no data, so no ask can name it.
    await apply(file, [{ kind: 'trash', id: 'f3' }]);
    expect(await emptyTrash(file, { only: new Set(['f3']) })).not.toBeNull();
    const asks = [
      { parentId: 's4', seq: onlyF1 },
      { parentId: 's4', seq: allThree },
      { parentId: 's4', seq: f1Trashed },
      { parentId: 's4', seq: f2Moved },
      { parentId: 's5', seq: allThree },
      { parentId: 's5', seq: f2Moved },
      { parentId: 's4', seq: await now() },
    ];
    const together = await childrenBefore(file, asks);
    const places = await placesBefore(file, asks);
    expect(together.map(ids)).toEqual(places.children.map(ids));
    for (const [i, ask] of asks.entries()) expect(ids((await childrenBefore(file, [ask]))[0] ?? [])).toEqual(ids(places.children[i] ?? []));
    // What they give: f1 alone, then f1 and f2 (f3's data gone), f1 still there in the Trash, f2 gone to scene 5.
    expect(together.map(ids)).toEqual([['f1'], ['f1', 'f2'], ['f1', 'f2'], ['f1'], [], ['f2'], ['f1']]);
    expect(together[2]?.find((r) => r.id === 'f1')?.trashedAt).not.toBeNull();
    expect(places.gone.map((r) => r.id)).toContain('f3');
  });
});
