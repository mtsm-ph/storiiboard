import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nodeDriver } from '../../../core/storage/nodeDriver';
import { createProject } from '../../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../../core/storage/testFolder';
import { createProjectStore } from '../../projectStore';
import { SceneList } from './SceneList';
import { addSceneChange, sceneEntries, sceneLabel } from './scenes';

let folder: TestFolder;
const store = createProjectStore();
beforeEach(() => {
  folder = makeTestFolder();
});
afterEach(async () => {
  await store.getState().close();
  folder.remove();
});

async function openBey() {
  const project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  await store.getState().open(project);
  return project.projectId;
}

const scene = (id: string, number: string, sortKey: string, name = '') => ({
  kind: 'create' as const,
  record: { id, type: 'scene' as const, parentId: '', sortKey, props: { number, name } },
});

describe('the sidebar scene list', () => {
  it('labels scenes as the slate does', () => {
    expect(sceneLabel('4')).toBe('SC 04');
    expect(sceneLabel('12')).toBe('SC 12');
    expect(sceneLabel('4A')).toBe('SC 4A');
  });

  it('lists the project’s scenes in board order and leaves out the Trash', async () => {
    const projectId = await openBey();
    const at = (change: ReturnType<typeof scene>) => ({ ...change, record: { ...change.record, parentId: projectId } });
    await store.getState().apply([
      at(scene('sc5', '5', 'k', 'Dock at dawn')),
      at(scene('sc4', '4', 'V', 'Cabin, night')),
      at(scene('sc6', '6', 'x')),
    ]);
    await store.getState().apply([{ kind: 'trash', id: 'sc6' }]);
    expect(sceneEntries(store.getState().records, projectId)).toEqual([
      { id: 'sc4', number: '4', name: 'Cabin, night' },
      { id: 'sc5', number: '5', name: 'Dock at dawn' },
    ]);
  });

  it('adds a scene after the highest number, at the end, as one undoable op', async () => {
    const projectId = await openBey();
    await store.getState().apply([
      { ...scene('sc4', '4', 'V'), record: { ...scene('sc4', '4', 'V').record, parentId: projectId } },
      { ...scene('sc9', '9A', 'k'), record: { ...scene('sc9', '9A', 'k').record, parentId: projectId } },
    ]);
    const change = addSceneChange(store.getState().records, projectId);
    await store.getState().apply([change]);
    const entries = sceneEntries(store.getState().records, projectId);
    expect(entries.at(-1)).toEqual({ id: change.record.id, number: '10', name: '' });

    await store.getState().undo();
    expect(sceneEntries(store.getState().records, projectId).map((s) => s.id)).toEqual(['sc4', 'sc9']);
  });

  it('starts at scene 1 in an empty project', async () => {
    const projectId = await openBey();
    expect(addSceneChange(store.getState().records, projectId).record.props).toEqual({ number: '1', name: '' });
  });

  it('marks the active scene with the accent and a bold name, and the rest with neither', () => {
    const html = renderToString(
      <SceneList
        scenes={[
          { id: 'sc4', number: '4', name: 'Cabin, night' },
          { id: 'sc5', number: '5', name: '' },
        ]}
        activeSceneId="sc4"
        canAdd={false}
        onSelect={() => undefined}
        onAdd={() => undefined}
      />,
    );
    expect(html.split('bg-accent').length - 1).toBe(1);
    expect(html).toContain('aria-current="true"');
    expect(html).toMatch(/font-bold[^>]*>Cabin, night/);
    expect(html).toContain('Untitled');
    expect(html).toMatch(/disabled=""[^>]*>\+ Add Scene/);
  });
});
