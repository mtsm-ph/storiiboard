import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nodeDriver } from '../core/storage/nodeDriver';
import { createProject } from '../core/storage/project';
import { makeTestFolder, type TestFolder } from '../core/storage/testFolder';
import { projectStore } from './projectStore';
import { removeTile, tilesIn } from './shell/docking/layout';
import { layoutStore } from './shell/docking/layoutStore';
import { changeLayout, redoLast, resetUndoTimeline, undoLast } from './undo';

let folder: TestFolder;
beforeEach(() => {
  folder = makeTestFolder();
  resetUndoTimeline();
  layoutStore.getState().resetToDefault('storyboard');
});
afterEach(async () => {
  await projectStore.getState().close();
  folder.remove();
});

describe('one ⌘Z for the project and the layout', () => {
  it('undoes whichever changed last, then the other', async () => {
    const project = await createProject(folder.path('Bey.sbd'), { driver: nodeDriver, backups: false });
    await projectStore.getState().open(project);
    const title = () => projectStore.getState().records[project.projectId]?.props.title;

    await projectStore.getState().apply([{ kind: 'update', id: project.projectId, set: { title: 'Pilot' } }]);
    changeLayout('storyboard', removeTile(layoutStore.getState().layouts.storyboard.current, 'player'));

    await undoLast();
    expect(tilesIn(layoutStore.getState().layouts.storyboard.current)).toContain('player');
    expect(title()).toBe('Pilot');

    await undoLast();
    expect(title()).toBe('Bey');

    await redoLast();
    expect(title()).toBe('Pilot');
    await redoLast();
    expect(tilesIn(layoutStore.getState().layouts.storyboard.current)).not.toContain('player');
  });
});
