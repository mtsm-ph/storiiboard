import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../app/projectStore';
import { setLocale } from '../../core/i18n';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { ItemHistory } from './ItemHistory';
import { itemOps } from './steps';

// A room's own history (6.5.6 round 2): its ceiling height named in words and shown as a length in the plan's unit, as a
// window's sill and top are, in English and Spanish.

let folder: TestFolder;
let project: Project;
let store = createProjectStore();
beforeEach(async () => {
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  store = createProjectStore();
  await store.getState().open(project);
  await store.getState().apply([{ kind: 'create', record: { id: 'room', type: 'plan', parentId: project.projectId, sortKey: 'a', props: { kind: 'room', name: 'Diner' } } }]);
});
afterEach(async () => {
  setLocale('en');
  await store.getState().close();
  folder.remove();
});

const noPlaces = () => null;
const putBack = () => Promise.resolve(true);
const unescape = (html: string) => html.replace(/&#x27;/g, '’').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

describe('a room’s own history (6.5.6)', () => {
  it('names its ceiling height and shows it as a length, in metres and in feet, in English and Spanish', async () => {
    await store.getState().apply([{ kind: 'update', id: 'room', set: { ceiling_height_m: 2.4384 } }]);
    await store.getState().apply([{ kind: 'update', id: 'room', set: { ceiling_height_m: 2.7 } }]);
    const room = store.getState().records.room;
    if (!room) throw new Error('no room');
    const ops = await itemOps(project.file, room);
    const render = (unit: 'metres' | 'feet') => unescape(renderToString(<ItemHistory item={room} title="room Diner" ops={ops} places={noPlaces} unit={unit} onPutBack={putBack} />));
    const metres = render('metres');
    expect(metres).toMatch(/ceiling height<\/td><td[^>]*>2\.44 m<\/td><td[^>]*>2\.70 m<\/td>/);
    expect(metres).toMatch(/ceiling height<\/td><td[^>]*>—<\/td><td[^>]*>2\.44 m<\/td>/);
    expect(metres).not.toContain('ceiling_height_m');
    expect(metres).not.toContain('2.4384');
    const feet = render('feet');
    expect(feet).toMatch(/ceiling height<\/td><td[^>]*>8’ 0"<\/td>/);
    setLocale('es');
    expect(render('metres')).toMatch(/altura del techo<\/td><td[^>]*>2\.44 m<\/td>/);
  });
});
