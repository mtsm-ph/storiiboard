import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../app/projectStore';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { addShot } from '../storyboard/board';
import { RestoreStatus } from './HistoryTile';
import { ItemHistory } from './ItemHistory';
import { itemOps } from './steps';

// While a Restore to here runs (1.22) the tile says so, and its buttons take no clicks, until it lands or fails. On a
// long project it rewrites thousands of records, which takes seconds with nothing else on screen to show for it.

let folder: TestFolder;
let project: Project;
const projectStore = createProjectStore();
beforeEach(async () => {
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  await projectStore.getState().open(project);
});
afterEach(async () => {
  await projectStore.getState().close();
  folder.remove();
});

describe('the History tile while a restore runs', () => {
  it('says the project is being restored, and says nothing once it isn’t', () => {
    expect(renderToString(<RestoreStatus restoring />)).toBe('<p role="status" class="text-[13px]">Restoring the project…</p>');
    expect(renderToString(<RestoreStatus restoring={false} />)).toBe('<p role="status" class="text-[13px]"></p>');
  });

  it('marks Put back as taking no clicks, without taking it out of the tab order', async () => {
    await projectStore.getState().apply([
      { kind: 'create', record: { id: 'sc4', type: 'scene', parentId: project.projectId, sortKey: 'V', props: { number: '4' } } },
    ]);
    const added = addShot(projectStore.getState().records, project.projectId, 'sc4');
    await projectStore.getState().apply(added.changes);
    await projectStore.getState().apply([{ kind: 'update', id: added.shotId, set: { lens_mm: 35 } }]);
    await projectStore.getState().apply([{ kind: 'update', id: added.shotId, set: { lens_mm: 50 } }]);
    const frame = projectStore.getState().records[added.shotId];
    if (!frame) throw new Error('no frame');
    const ops = await itemOps(project.file, frame);
    const table = (busy: boolean) =>
      renderToString(<ItemHistory item={frame} title="frame 4A" ops={ops} places={() => null} busy={busy} onPutBack={() => Promise.resolve(true)} />);
    expect(table(true)).toMatch(/<button[^>]*aria-label="Put back lens 35mm"[^>]*aria-disabled="true"/);
    expect(table(true)).not.toMatch(/<button[^>]* disabled=""/);
    expect(table(false)).not.toContain('aria-disabled="');
  });
});

describe('the History tile while Open version copies', () => {
  it('says which version it is copying, and says nothing once the copy opens or fails', () => {
    expect(renderToString(<RestoreStatus restoring={false} opening="Board sent to client" />)).toBe(
      '<p role="status" class="text-[13px]">Copying “Board sent to client”…</p>',
    );
    expect(renderToString(<RestoreStatus restoring={false} opening={null} />)).toBe('<p role="status" class="text-[13px]"></p>');
  });
});
