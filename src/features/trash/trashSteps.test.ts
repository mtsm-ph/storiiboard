import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProjectStore } from '../../app/projectStore';
import { setLocale } from '../../core/i18n';
import { log } from '../../core/ops/ops';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { addShot, trashScene, trashShot } from '../storyboard/board';
import { restoreChanges, trashItems } from './trash';

// Two steps in the same millisecond are never one step (6.24). The Trash tells a frame that went with its scene by
// "trashed at the same time by the same person"; here the clock stands still for the whole test, so every step is made
// in one millisecond. The frame deleted before must still be listed on its own and stay in the Trash when the scene
// comes back. No wait anywhere.

const FROZEN = Date.parse('2026-11-16T10:00:00.000Z');

let folder: TestFolder;
let project: Project;
let store = createProjectStore();
beforeEach(async () => {
  // Only the date: timers run as they are.
  vi.useFakeTimers({ toFake: ['Date'], now: FROZEN });
  setLocale('en');
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  store = createProjectStore();
  await store.getState().open(project);
});
afterEach(async () => {
  await store.getState().close();
  folder.remove();
  vi.useRealTimers();
});

const records = () => store.getState().records;
const trashedAt = (id: string) => records()[id]?.trashedAt ?? null;

describe('steps made in one millisecond, in the Trash (6.24)', () => {
  it('lists a frame deleted before its scene on its own, and restoring the scene brings back only the frames that went with it', async () => {
    await store.getState().apply([
      { kind: 'create', record: { id: 'sc4', type: 'scene', parentId: project.projectId, sortKey: 'V', props: { number: '4', name: 'Diner' } } },
    ]);
    const shots: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const added = addShot(records(), project.projectId, 'sc4');
      await store.getState().apply(added.changes);
      shots.push(added.shotId);
    }
    const [before = '', second = '', third = ''] = shots;
    await store.getState().apply(trashShot(records(), project.projectId, before));
    await store.getState().apply(trashScene(records(), 'sc4'));
    // Two steps, two times; the frames that went with the scene have the scene's.
    expect(trashedAt(before)).not.toBeNull();
    expect(trashedAt(before)).not.toBe(trashedAt('sc4'));
    expect(trashedAt(second)).toBe(trashedAt('sc4'));
    expect(trashedAt(third)).toBe(trashedAt('sc4'));
    expect(trashItems(records(), project.projectId).map((row) => row.id).sort()).toEqual(['sc4', before].sort());
    await store.getState().apply(restoreChanges(records(), project.projectId, 'sc4'));
    expect(trashedAt('sc4')).toBeNull();
    expect(trashedAt(second)).toBeNull();
    expect(trashedAt(third)).toBeNull();
    expect(trashedAt(before)).not.toBeNull();
    expect(trashItems(records(), project.projectId).map((row) => row.id)).toEqual([before]);
    // The clock never moved, and still no two steps in the file share a time.
    expect(Date.now()).toBe(FROZEN);
    const times = (await log(project.file)).map((group) => group.timestamp);
    expect(times[0]).toBe(new Date(FROZEN).toISOString());
    expect(new Set(times).size).toBe(times.length);
  });
});
