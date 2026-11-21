import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../app/projectStore';
import { settledThrough, settleUndone } from '../../app/undoSettle';
import type { PreparedImage } from '../../core/media/store';
import type { SbdRecord } from '../../core/model/record';
import { apply, bringBack, cleanUpPictures, emptyTrash, getRecord, loadRecords, log, redo, restoreTo, stepBefore, undo, type Change, type KeptEdit, type OpGroup } from '../../core/ops/ops';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { loadSlateNumbers } from '../../core/storage/slateNumbers';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { setLocale } from '../../core/i18n';
import { addShot, moveItem, setNumbersLocked, trashScene } from '../storyboard/board';
import { setPicture, type FramePicture } from '../storyboard/framePictures';
import { broughtBackNotice, itemOps } from './steps';
import { frameRows } from './summary';
import { shownRun, undoneFacts } from './undone';

// Undoing from History, round 2 (#250): what Bring back what was undone leaves as it is now, and names, rather than
// write something unsafe: slate numbers and locks (1.26), a record that stays naming one the run brought in, a parent
// in the Trash, a picture cleaned up since. And the run itself: a redo ends it, a settled undo never joins it, and a
// Bring back with nothing to write settles it.

let folder: TestFolder;
let project: Project;

beforeEach(async () => {
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
});
afterEach(async () => {
  setLocale('en');
  await project.close().catch(() => undefined);
  folder.remove();
});

const scene = (id: string, number: string, sortKey = 'V'): Change => ({
  kind: 'create',
  record: { id, type: 'scene', parentId: project.projectId, sortKey, props: { number, heading: 'INT. DINER - NIGHT' } },
});
const shot = (id: string, parentId: string, props = {}, sortKey = 'V'): Change => ({ kind: 'create', record: { id, type: 'shot', parentId, sortKey, props } });
const records = async (): Promise<Readonly<Record<string, SbdRecord>>> => Object.fromEntries((await loadRecords(project.file)).map((r) => [r.id, r]));
const newest = async () => (await log(project.file)).at(-1)?.id ?? '';
const why = (kept: readonly KeptEdit[] | undefined) => (kept ?? []).map((k) => [k.record.id, k.prop, k.why]);
const notice = (done: Awaited<ReturnType<typeof bringBack>>) => broughtBackNotice(done ?? { written: 0, kept: [] });
const NOTHING = 'Nothing to bring back: everything there is already back, or was changed again since.';

function picture(seed: number): FramePicture {
  const bytes = new Uint8Array(4000).map((_, i) => (i * seed) % 256);
  const image: PreparedImage = {
    original: { sha256: createHash('sha256').update(bytes).digest('hex'), bytes, mime: 'image/jpeg', width: 2560, height: 1440, colorSpace: 'srgb' },
    thumbnail: { bytes: bytes.slice(0, 500), mime: 'image/jpeg', width: 640, height: 360, longEdge: 640 },
  };
  return { image, source: { name: `IMG_${String(seed)}.JPG` } };
}

describe('slate numbers (1.26)', () => {
  it('(A) never writes a number a live frame holds: the frame made again stays away, and is named', async () => {
    await apply(project.file, [scene('sc4', '4'), shot('4A', 'sc4', { number: '4A' }, 'V'), shot('4B', 'sc4', { number: '4B' }, 'W')]);
    const first = addShot(await records(), project.projectId, 'sc4');
    await apply(project.file, first.changes);
    expect((await getRecord(project.file, first.shotId))?.props.number).toBe('4C');
    await undo(project.file);
    const target = await newest();
    const second = addShot(await records(), project.projectId, 'sc4');
    await apply(project.file, second.changes);
    expect((await getRecord(project.file, second.shotId))?.props.number).toBe('4C');

    const done = await bringBack(project.file, target);
    expect(done?.written).toBe(0);
    expect(await getRecord(project.file, first.shotId)).toBeNull();
    const live = (await loadRecords(project.file)).filter((r) => r.type === 'shot' && r.trashedAt === null);
    expect(live.filter((r) => r.props.number === '4C').map((r) => r.id)).toEqual([second.shotId]);
    expect(why(done?.kept)).toEqual([[first.shotId, null, 'number']]);
    expect(notice(done)).toBe(`${NOTHING} 4C couldn’t come back: its number is taken.`);
  });

  it('(B) never locks a scene again round a frame whose number a slate holds for another shot', async () => {
    await apply(project.file, [
      scene('sc4', '4'),
      shot('4A', 'sc4', { number: '4A' }, 'V'),
      shot('4B', 'sc4', { number: '4B' }, 'W'),
      shot('X', 'sc4', { number: '4C' }, 'X'),
    ]);
    // Locked (as Issue locks a day's scenes) with X slated as 4C, then the lock undone.
    await apply(project.file, setNumbersLocked(await records(), project.projectId, 'sc4', true, await loadSlateNumbers(project.file)));
    expect((await loadSlateNumbers(project.file)).find((row) => row.number === '4C')?.shotId).toBe('X');
    await undo(project.file);
    const target = await newest();
    // Unlocked, a frame before X takes 4C and X becomes 4D.
    const y = addShot(await records(), project.projectId, 'sc4', '4B');
    await apply(project.file, y.changes);
    expect((await getRecord(project.file, y.shotId))?.props.number).toBe('4C');
    expect((await getRecord(project.file, 'X'))?.props.number).toBe('4D');

    const done = await bringBack(project.file, target);
    expect(done?.written).toBe(0);
    expect((await getRecord(project.file, 'sc4'))?.props.numbers_locked).toBeUndefined();
    expect((await getRecord(project.file, y.shotId))?.props.number).toBe('4C');
    expect(why(done?.kept)).toEqual([['sc4', 'numbers_locked', 'slated']]);
    expect(done?.kept[0]?.other?.id).toBe(y.shotId);
    expect(notice(done)).toBe(`${NOTHING} SC 04 stays unlocked: 4C is on a slate with another frame.`);
    setLocale('es');
    expect(notice(done)).toContain('sigue sin bloquear: 4C está en una claqueta con otro cuadro.');
  });

  it('brings a lock back when no frame in the scene holds another shot’s slate number', async () => {
    await apply(project.file, [scene('sc4', '4'), shot('4A', 'sc4', { number: '4A' }, 'V'), shot('4B', 'sc4', { number: '4B' }, 'W')]);
    await apply(project.file, setNumbersLocked(await records(), project.projectId, 'sc4', true, await loadSlateNumbers(project.file)));
    await undo(project.file);
    const done = await bringBack(project.file, await newest());
    expect(done?.written).toBe(1);
    expect(done?.kept).toEqual([]);
    expect((await getRecord(project.file, 'sc4'))?.props.numbers_locked).toBe(true);
  });
});

describe('what a kept record names', () => {
  it('never deletes a record one that stays names: the location stays and 4A still finds it', async () => {
    await apply(project.file, [scene('sc4', '4'), shot('4A', 'sc4', { number: '4A' })]);
    await apply(project.file, [{ kind: 'create', record: { id: 'pier', type: 'location', parentId: project.projectId, sortKey: 'V', props: { name: 'Pier' } } }]);
    const added = await newest();
    await undo(project.file);
    expect(await getRecord(project.file, 'pier')).toBeNull();
    await restoreTo(project.file, added);
    expect(await getRecord(project.file, 'pier')).not.toBeNull();
    const restore = await newest();
    await apply(project.file, [{ kind: 'update', id: '4A', set: { location_id: 'pier' } }]);

    const done = await bringBack(project.file, restore);
    expect(await getRecord(project.file, 'pier')).not.toBeNull();
    const located = (await getRecord(project.file, '4A'))?.props.location_id;
    expect(located).toBe('pier');
    expect(await getRecord(project.file, typeof located === 'string' ? located : '')).not.toBeNull();
    expect(why(done?.kept)).toEqual([['pier', null, 'named']]);
    expect(done?.kept[0]?.other?.id).toBe('4A');
    expect(notice(done)).toBe(`${NOTHING} Pier stays: 4A still uses it.`);
  });
});

describe('a parent in the Trash', () => {
  it('is not there: a frame moved into a scene since trashed stays where it is', async () => {
    await apply(project.file, [scene('sc4', '4', 'V'), scene('sc5', '5', 'W'), shot('4A', 'sc4', { number: '4A' }, 'V'), shot('4B', 'sc4', { number: '4B' }, 'W')]);
    await apply(project.file, moveItem(await records(), project.projectId, '4A', 'sc5', null, await loadSlateNumbers(project.file)));
    expect((await getRecord(project.file, '4A'))?.parentId).toBe('sc5');
    await undo(project.file);
    const target = await newest();
    await apply(project.file, trashScene(await records(), 'sc5'));

    const done = await bringBack(project.file, target);
    const frame = await getRecord(project.file, '4A');
    expect(frame?.parentId).toBe('sc4');
    expect(frame?.props.number).toBe('4A');
    expect(frame?.trashedAt).toBeNull();
    expect((await getRecord(project.file, '4B'))?.props.number).toBe('4B');
    expect(why(done?.kept)[0]).toEqual(['4A', null, 'trashed']);
    expect(notice(done)).toContain('4A couldn’t come back: SC 05 is in the Trash.');
  });
});

describe('the run', () => {
  it('ends where a redo follows it: ⌘Z then ⌘⇧Z shows no run', async () => {
    await apply(project.file, [scene('sc4', '4')]);
    await apply(project.file, [shot('4A', 'sc4', { number: '4A' })]);
    await undo(project.file);
    expect(shownRun(undoneFacts(await log(project.file)), 0)).not.toBeNull();
    await redo(project.file);
    expect(undoneFacts(await log(project.file)).run).toBeNull();
    expect(shownRun(undoneFacts(await log(project.file)), 0)).toBeNull();
  });

  it('a Bring back with nothing to write settles its run: no button left', async () => {
    const store = createProjectStore();
    await store.getState().open(project);
    try {
      await store.getState().apply([scene('sc4', '4'), shot('4A', 'sc4', { number: '4A', lens_mm: 35 })]);
      await store.getState().apply([{ kind: 'update', id: '4A', set: { lens_mm: 50 } }]);
      await store.getState().undo();
      const target = await newest();
      // The same lens typed again by hand: everything the run undid already reads as it would.
      await store.getState().apply([{ kind: 'update', id: '4A', set: { lens_mm: 50 } }]);
      expect(shownRun(undoneFacts(await log(project.file)), settledThrough(project.file))).not.toBeNull();
      const done = await store.getState().bringBack(target);
      expect(done?.written).toBe(0);
      expect(shownRun(undoneFacts(await log(project.file)), settledThrough(project.file))).toBeNull();
    } finally {
      await store.getState().close();
    }
  });

  it('never takes in an undo that settled: only the undos after the settled place show and come back', async () => {
    await apply(project.file, [scene('sc4', '4')]);
    for (const [id, key] of [['4A', 'V'], ['4B', 'W'], ['4C', 'X']] as const) await apply(project.file, [shot(id, 'sc4', { number: id }, key)]);
    await undo(project.file);
    await undo(project.file);
    await settleUndone(project.file);
    await undo(project.file);
    const groups = await log(project.file);
    const run = shownRun(undoneFacts(groups), settledThrough(project.file));
    // Only the newest undo's step, the frame 4A, is outlined.
    expect([...(run?.undone ?? [])]).toEqual([groups[1]?.id]);
    const done = await bringBack(project.file, run?.target ?? '', { settledThrough: settledThrough(project.file) });
    expect(done?.written).toBe(1);
    expect((await getRecord(project.file, '4A'))?.props.number).toBe('4A');
    expect(await getRecord(project.file, '4B')).toBeNull();
    expect(await getRecord(project.file, '4C')).toBeNull();
  });

  it('reads the step before a restore as the previous group in the log, never seq − 1', () => {
    const at = (id: string, seq: number, kind: OpGroup['kind']): OpGroup => ({
      id,
      seq,
      kind,
      targetGroupId: null,
      restoreTo: null,
      author: 'local',
      timestamp: '',
      opCount: 0,
    });
    const groups = [at('a', 1, 'edit'), at('b', 2, 'edit'), at('r', 5, 'restore')];
    expect(stepBefore(groups, 5)?.id).toBe('b');
    expect(stepBefore(groups, 1)).toBeUndefined();
    expect(undoneFacts(groups).marks.get('b')).toBe('r');
  });
});

describe('the words', () => {
  it('say a record deleted for good since couldn’t come back, never that it kept a later edit', async () => {
    await apply(project.file, [scene('sc4', '4'), shot('4A', 'sc4', { number: '4A', lens_mm: 35 })]);
    await apply(project.file, [{ kind: 'update', id: '4A', set: { lens_mm: 50 } }]);
    await undo(project.file);
    const target = await newest();
    await apply(project.file, [{ kind: 'trash', id: '4A' }]);
    await emptyTrash(project.file);
    const done = await bringBack(project.file, target);
    expect(done?.written).toBe(0);
    expect(done?.deleted).toBe(1);
    expect(done?.kept).toEqual([]);
    expect(broughtBackNotice(done ?? { written: 0, kept: [] })).toBe(`${NOTHING} 1 item couldn’t come back: it was deleted for good.`);
  });

  it('in Spanish, a field brought back reads without an adjective that would have to agree with it', async () => {
    await apply(project.file, [scene('sc4', '4'), shot('4A', 'sc4', { number: '4A', lens_mm: 35 })]);
    await apply(project.file, [{ kind: 'update', id: '4A', set: { lens_mm: 50 } }]);
    await undo(project.file);
    await bringBack(project.file, await newest());
    const frame = await getRecord(project.file, '4A');
    if (!frame) throw new Error('no frame');
    setLocale('es');
    expect(frameRows(await itemOps(project.file, frame), '4A')[0]?.change).toBe('lente, de vuelta');
  });
});

describe('pictures cleaned up since', () => {
  it('leave the frame’s picture as it is now, and say so', async () => {
    await apply(project.file, [scene('sc4', '4'), shot('4A', 'sc4', { number: '4A' })]);
    const edit = setPicture(await records(), '4A', picture(3), project.file.path);
    await apply(project.file, edit.changes, { alsoWrite: edit.alsoWrite });
    const mediaId = (await getRecord(project.file, '4A'))?.props.media_id;
    expect(typeof mediaId).toBe('string');
    await undo(project.file);
    const target = await newest();
    // Only the redo stack shows it now, so Clean up old pictures deletes its bytes.
    expect((await cleanUpPictures(project.file)).removed).toBe(1);

    const done = await bringBack(project.file, target);
    expect(done?.written).toBe(0);
    expect((await getRecord(project.file, '4A'))?.props.media_id).toBeUndefined();
    expect(await getRecord(project.file, typeof mediaId === 'string' ? mediaId : '')).toBeNull();
    expect(why(done?.kept)).toEqual([
      [mediaId, null, 'picture'],
      ['4A', 'media_id', 'picture'],
    ]);
    expect(notice(done)).toContain('4A’s picture stays as it is: the one it had was cleaned up.');
  });

  it('bring a picture back when its bytes are still there', async () => {
    await apply(project.file, [scene('sc4', '4'), shot('4A', 'sc4', { number: '4A' })]);
    const edit = setPicture(await records(), '4A', picture(4), project.file.path);
    await apply(project.file, edit.changes, { alsoWrite: edit.alsoWrite });
    const mediaId = (await getRecord(project.file, '4A'))?.props.media_id;
    expect(typeof mediaId).toBe('string');
    await undo(project.file);
    const done = await bringBack(project.file, await newest());
    expect(done?.kept).toEqual([]);
    expect((await getRecord(project.file, '4A'))?.props.media_id).toBe(mediaId);
    expect(await getRecord(project.file, typeof mediaId === 'string' ? mediaId : '')).not.toBeNull();
  });
});
