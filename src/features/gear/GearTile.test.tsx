import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { projectStore } from '../../app/projectStore';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { clampQuestion } from './BodyLensFields';
import { KindNote } from './GearTile';

// The Gear tile's list reads a body's letter as the project does (6.1), and the question before a lens's range change
// names the lens and counts its frames in the Trash apart.

let folder: TestFolder;
let project: Project;
beforeEach(async () => {
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  await projectStore.getState().open(project);
});
afterEach(async () => {
  await projectStore.getState().close();
  folder.remove();
});

const body = (id: string, name: string, sortKey: string) => ({
  kind: 'create' as const,
  record: { id, type: 'gear_item' as const, parentId: project.projectId, sortKey, props: { name, quantity: 1, source: 'owned', kind: 'camera_body', camera_letter: 'A' } },
});

describe('the Gear list', () => {
  it('shows a letter two bodies hold in the file on the first only', async () => {
    // FX3 was A cam, went to the Trash, the Mini LF took A, and FX3 came back: both hold A in the file.
    await projectStore.getState().apply([body('fx3', 'FX3', 'a'), body('mini', 'Mini LF', 'b')]);
    const records = projectStore.getState().records;
    // Each row's note as the list draws it (the tile itself reads the store through a hook, which a render on the
    // server sees empty).
    const row = (id: string) => renderToString(<KindNote records={records} projectId={project.projectId} id={id} props={records[id]?.props ?? {}} />);
    expect(row('fx3')).toContain('A cam');
    expect(row('mini')).not.toContain('A cam');
    expect(row('mini')).toContain('Camera body');
  });
});

describe('the question before a lens’s range change', () => {
  const lens = (props: Record<string, string | number>) => ({
    kind: 'create' as const,
    record: { id: 'z', type: 'gear_item' as const, parentId: project.projectId, sortKey: 'z', props: { kind: 'lens', focal_min_mm: 30, focal_max_mm: 72, ...props } },
  });
  const shot = (id: string, mm: number | null) => ({
    kind: 'create' as const,
    record: { id, type: 'shot' as const, parentId: 'sc', sortKey: id, props: { number: id, lens_id: 'z', ...(mm === null ? {} : { lens_mm: mm }) } },
  });
  const scene = () => ({ kind: 'create' as const, record: { id: 'sc', type: 'scene' as const, parentId: project.projectId, sortKey: 'a', props: { number: '1' } } });

  it('names the lens, counts the live frames, and adds those in the Trash in a second sentence', async () => {
    await projectStore.getState().apply([lens({ name: 'Optimo' }), scene(), shot('1A', 70), shot('1B', 60), shot('1C', 65)]);
    const records = () => projectStore.getState().records;
    expect(clampQuestion(records(), 'z', 30, 40)).toBe('“Optimo” is used by 3 frames outside 30–40 mm. All 3 will be set to 40 mm.');
    await projectStore.getState().apply([{ kind: 'trash', id: '1C' }]);
    expect(clampQuestion(records(), 'z', 30, 40)).toBe('“Optimo” is used by 2 frames outside 30–40 mm. And 1 in the Trash. All 3 will be set to 40 mm.');
    // A frame with no focal length takes the wide end, counted like the others.
    await projectStore.getState().apply([shot('1D', null)]);
    expect(clampQuestion(records(), 'z', 40, 50)).toBe(
      '“Optimo” is used by 3 frames outside 40–50 mm. And 1 in the Trash. Each will be set to the nearer end: 40 or 50 mm.',
    );
  });

  it('asks nothing when only frames in the Trash would change', async () => {
    await projectStore.getState().apply([lens({ name: 'Optimo' }), scene(), shot('1A', 70), { kind: 'trash', id: '1A' }]);
    expect(clampQuestion(projectStore.getState().records, 'z', 30, 40)).toBeNull();
  });

  it('names an unnamed lens by its range', async () => {
    await projectStore.getState().apply([lens({}), scene(), shot('1A', 70)]);
    expect(clampQuestion(projectStore.getState().records, 'z', 35, 35)).toBe('“30–72 mm” is used by 1 frame at another focal length. It will be set to 35 mm.');
  });
});
