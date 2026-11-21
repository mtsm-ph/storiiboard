import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { projectStore } from '../../app/projectStore';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, openProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { selectionStore } from '../storyboard/selection';
import { useHistoryDay } from './historyDay';

// The shoot day the History tile shows (historyDay.ts): the latest pick wins, the item already selected picked again
// too, and the day is let go once it's no longer a live day of the open project.

let folder: TestFolder;
let project: Project;
beforeEach(async () => {
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  await projectStore.getState().open(project);
  await projectStore.getState().apply([
    { kind: 'create', record: { id: 'sc1', type: 'scene', parentId: project.projectId, sortKey: 'a', props: { number: '1' } } },
    { kind: 'create', record: { id: 'd1', type: 'shoot_day', parentId: project.projectId, sortKey: 'a', props: { date: '2026-11-16', people_ids: [] } } },
  ]);
});
afterEach(async () => {
  useHistoryDay.setState({ dayId: null, only: false });
  await projectStore.getState().close();
  folder.remove();
});

const asked = () => {
  useHistoryDay.setState({ dayId: 'd1', only: true });
};

describe('a shoot day’s own history in the History tile', () => {
  it('lets the day go when the frame, note or scene already selected is picked again', () => {
    const selection = selectionStore.getState();
    selection.selectShot('f1', 'sc1');
    asked();
    selectionStore.getState().selectShot('f1', 'sc1');
    expect(useHistoryDay.getState()).toMatchObject({ dayId: null, only: false });

    selectionStore.getState().selectNote('n1', 'sc1');
    asked();
    selectionStore.getState().selectNote('n1', 'sc1');
    expect(useHistoryDay.getState().dayId).toBeNull();

    selectionStore.getState().selectScene('sc1');
    asked();
    selectionStore.getState().selectScene('sc1');
    expect(useHistoryDay.getState().dayId).toBeNull();
  });

  it('keeps the day through edits to the project, and lets it go once the day is trashed, for good after an undo', async () => {
    asked();
    await projectStore.getState().apply([{ kind: 'update', id: 'd1', set: { call_time: '07:00' } }]);
    expect(useHistoryDay.getState()).toMatchObject({ dayId: 'd1', only: true });
    await projectStore.getState().apply([{ kind: 'trash', id: 'd1' }]);
    expect(useHistoryDay.getState()).toMatchObject({ dayId: null, only: false });
    await projectStore.getState().undo();
    expect(projectStore.getState().records.d1?.trashedAt).toBeNull();
    expect(useHistoryDay.getState()).toMatchObject({ dayId: null, only: false });
  });

  it('lets the day go when another project opens, and doesn’t take it up again on switching back', async () => {
    asked();
    await projectStore.getState().open(await createProject(folder.path('Other.sbd'), { driver: nodeDriver, backups: false }));
    expect(useHistoryDay.getState().dayId).toBeNull();
    await projectStore.getState().open(await openProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false }));
    expect(projectStore.getState().records.d1?.type).toBe('shoot_day');
    expect(useHistoryDay.getState()).toMatchObject({ dayId: null, only: false });
  });
});
