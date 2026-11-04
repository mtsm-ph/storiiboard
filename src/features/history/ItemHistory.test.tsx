import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../app/projectStore';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { addShot } from '../storyboard/board';
import { ItemHistory } from './ItemHistory';
import { itemOps } from './steps';

// The table an item's own history shows (1.22): its old values in full, since they're read there before Put back.

let folder: TestFolder;
let project: Project;
let store = createProjectStore();
beforeEach(async () => {
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  store = createProjectStore();
  await store.getState().open(project);
  await store.getState().apply([
    { kind: 'create', record: { id: 'sc4', type: 'scene', parentId: project.projectId, sortKey: 'V', props: { number: '4' } } },
  ]);
});
afterEach(async () => {
  await store.getState().close();
  folder.remove();
});

const noPlaces = () => null;
const putBack = () => Promise.resolve(true);
/** The page's text as a person reads it: entities undone, markup gone. */
const unescape = (html: string) => html.replace(/&#x27;/g, '’').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

describe('an item’s own history', () => {
  const action = 'INT. KITCHEN - she turns from the window,\nsees him at the door, drops the cup.';

  it('shows a long, multi-line old value in full, wrapped with its line breaks kept, and Put back names all of it', async () => {
    const added = addShot(store.getState().records, project.projectId, 'sc4');
    await store.getState().apply(added.changes);
    await store.getState().apply([{ kind: 'update', id: added.shotId, set: { action } }]);
    await store.getState().apply([{ kind: 'update', id: added.shotId, set: { action: 'x' } }]);
    const frame = store.getState().records[added.shotId];
    if (!frame) throw new Error('no frame');
    const html = unescape(
      renderToString(<ItemHistory item={frame} title="frame 4A" ops={await itemOps(project.file, frame)} places={noPlaces} onPutBack={putBack} />),
    );
    expect(html).toMatch(new RegExp(`<td class="[^"]*whitespace-pre-wrap[^"]*">${action.replace(/[.\\-]/g, '\\$&')}</td>`));
    expect(html).toContain(`aria-label="Put back action ${action}"`);
    expect(html).not.toContain('…');
  });

  it('names a scene’s location as the board has it, never by its id', async () => {
    await store.getState().apply([
      { kind: 'create', record: { id: 'dock', type: 'location', parentId: project.projectId, sortKey: 'a', props: { name: 'Dock' } } },
      { kind: 'update', id: 'sc4', set: { location_id: 'dock' } },
    ]);
    const scene = store.getState().records.sc4;
    if (!scene) throw new Error('no scene');
    const html = renderToString(
      <ItemHistory
        item={scene}
        title="scene SC 04"
        ops={await itemOps(project.file, scene)}
        places={(id) => (id === 'dock' ? 'Dock' : null)}
        onPutBack={putBack}
      />,
    );
    expect(html).toContain('Changes to <!-- -->scene SC 04<!-- -->, newest first');
    expect(html).toMatch(/location<\/td><td[^>]*>—<\/td><td[^>]*>Dock<\/td>/);
    expect(html).not.toContain('>dock<');
  });
});
