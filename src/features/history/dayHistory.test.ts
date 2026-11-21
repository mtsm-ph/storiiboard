import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../app/projectStore';
import type { Change } from '../../core/ops/ops';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { callsheetNoteChange } from '../callsheets/callsheetEdits';
import { dayChange, scheduleFrames } from '../schedule/dayEdits';
import { addShot, trashShot } from '../storyboard/board';
import { addStroke } from '../storyboard/sketch/strokes';
import { itemOps, loadSteps, moreDayLog, readDayLog, type DayLog } from './steps';
import { lineText } from './summary';

// A shoot day's own history (Kevin, Nov 18 and 21): every step on the day, its call sheet, each frame arriving or
// leaving, and what changed on a frame while it was on the day, never its life before or after; each worded exactly as
// the main feed words it; read once, then only what's new.

let folder: TestFolder;
let project: Project;
let store = createProjectStore();
const shots: string[] = [];

const apply = (build: (records: ReturnType<typeof store.getState>['records']) => Change[]) => store.getState().apply(build(store.getState().records));

beforeEach(async () => {
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  store = createProjectStore();
  await store.getState().open(project);
  const projectId = project.projectId;
  await store.getState().apply([
    { kind: 'create', record: { id: 'sc1', type: 'scene', parentId: projectId, sortKey: 'V', props: { number: '1' } } },
    { kind: 'create', record: { id: 'sc2', type: 'scene', parentId: projectId, sortKey: 'W', props: { number: '2' } } },
  ]);
  shots.length = 0;
  for (const scene of ['sc1', 'sc1', 'sc1', 'sc2']) {
    const added = addShot(store.getState().records, projectId, scene);
    await store.getState().apply(added.changes);
    shots.push(added.shotId);
  }
  await store.getState().apply([
    { kind: 'create', record: { id: 'd1', type: 'shoot_day', parentId: projectId, sortKey: 'a', props: { date: '2026-11-16', people_ids: [] } } },
  ]);
  await store.getState().apply([
    { kind: 'create', record: { id: 'd2', type: 'shoot_day', parentId: projectId, sortKey: 'b', props: { date: '2026-11-25', people_ids: [] } } },
  ]);
});
afterEach(async () => {
  await store.getState().close();
  folder.remove();
});

/** Every step in the main feed, by group id, with its line as History words it. */
async function feed(): Promise<Map<string, string>> {
  const { steps } = await loadSteps(project.file, 10_000);
  return new Map(steps.map((step) => [step.group.id, lineText(step.line)]));
}

/** The newest step's group id. */
async function newest(): Promise<string> {
  const { steps } = await loadSteps(project.file, 1);
  const id = steps[0]?.group.id;
  if (!id) throw new Error('no step');
  return id;
}

const pen = { tool: 'pen' as const, points: [0.1, 0.1, 0.2, 0.2], width: 0.008, pressures: null };
const ids = (day: DayLog) => day.steps.map((step) => step.group.id);
const lines = (day: DayLog) => day.steps.map((step) => lineText(step.line));

/** Each of the day's lines is the main feed's own line for that step. */
async function expectFeedWords(day: DayLog) {
  const all = await feed();
  for (const step of day.steps) expect(lineText(step.line)).toBe(all.get(step.group.id));
}

describe('a shoot day’s own history', () => {
  it('finds the day’s own edits, newest first, and leaves out every step that touched no part of it', async () => {
    const made = await newest();
    await apply((r) => dayChange(r, 'd1', 'call_time', '07:00'));
    const call = await newest();
    // Steps that touch nothing of Day 1: another day, a frame on no day, a scene.
    await apply((r) => dayChange(r, 'd2', 'call_time', '06:00'));
    await apply(() => [{ kind: 'update', id: shots[0] ?? '', set: { title: 'Wide' } }]);
    await apply(() => [{ kind: 'update', id: 'sc1', set: { number: '1' } }]);
    await apply(() => [{ kind: 'update', id: 'sc2', set: { title: 'Diner' } }]);
    const day = await readDayLog(project.file, 'd1');
    // d1 was made in the step before d2's.
    const all = [...(await feed()).keys()];
    const d1Made = all[all.indexOf(made) + 1];
    expect(ids(day)).toEqual([call, d1Made]);
    await expectFeedWords(day);
  });

  it('finds its call sheet’s edits, and the steps on a frame scheduled on it, not another day’s', async () => {
    await apply((r) => callsheetNoteChange(r, 'd1', 'notes', 'Lunch at 13:00', 'cs1'));
    const sheet = await newest();
    await apply((r) => callsheetNoteChange(r, 'd1', 'notes', 'Lunch at 12:30'));
    const sheetAgain = await newest();
    await apply((r) => callsheetNoteChange(r, 'd2', 'notes', 'Rain cover'));
    const other = await newest();
    await apply((r) => scheduleFrames(r, [shots[0] ?? ''], 'd1'));
    const scheduled = await newest();
    // A frame on the day, changed while there: its shoot day was the day before and after.
    await apply(() => [{ kind: 'update', id: shots[0] ?? '', set: { title: 'Wide' } }]);
    const titled = await newest();
    const day = await readDayLog(project.file, 'd1');
    expect(ids(day).slice(0, 4)).toEqual([titled, scheduled, sheetAgain, sheet]);
    expect(ids(day)).not.toContain(other);
    await expectFeedWords(day);
  });

  it('keeps a frame moved off it to another day in both days’ histories, with History’s words', async () => {
    // A frame never on either day: on neither.
    await apply(() => [{ kind: 'update', id: shots[1] ?? '', set: { title: 'Insert' } }]);
    const neither = await newest();
    await apply((r) => scheduleFrames(r, [shots[0] ?? ''], 'd1'));
    const scheduled = await newest();
    await apply((r) => scheduleFrames(r, [shots[0] ?? ''], 'd2'));
    const moved = await newest();
    const first = await readDayLog(project.file, 'd1');
    const second = await readDayLog(project.file, 'd2');
    expect(ids(first).slice(0, 2)).toEqual([moved, scheduled]);
    expect(ids(second)).toContain(moved);
    // Scheduling it on Day 1 came before it arrived on Day 2, so it's not Day 2's (Kevin, Nov 21).
    expect(ids(second)).not.toContain(scheduled);
    expect(ids(first)).not.toContain(neither);
    expect(ids(second)).not.toContain(neither);
    expect(lines(first)[0]).toBe(lines(second)[0]);
    expect(lines(first)[0]).toContain('Wed, Nov 25');
    expect(lines(first)[1]).toContain('Mon, Nov 16');
    await expectFeedWords(first);
    await expectFeedWords(second);
  });

  it('finds a whole scene scheduled at once as one step, worded as the scene', async () => {
    await apply((r) => scheduleFrames(r, shots.slice(0, 3), 'd1'));
    const scheduled = await newest();
    const day = await readDayLog(project.file, 'd1');
    expect(ids(day)[0]).toBe(scheduled);
    expect(lines(day)[0]).toContain('SC 01');
    await expectFeedWords(day);
  });

  it('finds an undo and a redo of each kind of step: the day’s, its call sheet’s, a frame’s', async () => {
    const edits: (() => Promise<void>)[] = [
      () => apply((r) => dayChange(r, 'd1', 'wrap_time', '19:00')),
      () => apply((r) => callsheetNoteChange(r, 'd1', 'safety_notes', 'Stunt at noon')),
      () => apply((r) => scheduleFrames(r, [shots[1] ?? ''], 'd1')),
      () => apply((r) => scheduleFrames(r, shots.slice(0, 3), 'd1')),
    ];
    for (const edit of edits) {
      await edit();
      const done = await newest();
      await store.getState().undo();
      const undone = await newest();
      await store.getState().redo();
      const redone = await newest();
      const day = await readDayLog(project.file, 'd1');
      expect(ids(day).slice(0, 3)).toEqual([redone, undone, done]);
      expect(day.steps[1]?.group.kind).toBe('undo');
      expect(day.steps[0]?.group.kind).toBe('redo');
      await expectFeedWords(day);
      // Another day's history has none of them.
      expect(ids(await readDayLog(project.file, 'd2'))).not.toContain(undone);
    }
  });

  it('keeps the steps of a frame since trashed', async () => {
    await apply((r) => scheduleFrames(r, [shots[0] ?? ''], 'd1'));
    const scheduled = await newest();
    await apply((r) => trashShot(r, project.projectId, shots[0] ?? ''));
    const trashed = await newest();
    const day = await readDayLog(project.file, 'd1');
    expect(ids(day).slice(0, 2)).toEqual([trashed, scheduled]);
    await expectFeedWords(day);
  });

  it('keeps a call sheet’s steps the log still places under the day after what was under it is deleted for good', async () => {
    // A call sheet and an issued PDF under it in one step, as Issue makes them; then the PDF to the Trash, and gone.
    await store.getState().apply([
      { kind: 'create', record: { id: 'cs1', type: 'callsheet', parentId: 'd1', sortKey: 'a', props: {} } },
      { kind: 'create', record: { id: 'pdf1', type: 'media', parentId: 'cs1', sortKey: 'a', props: { kind: 'pdf', file: 'b'.repeat(64), source_name: 'Day 1.pdf', byte_size: 10, issue_version: 1 } } },
    ]);
    const issued = await newest();
    await store.getState().apply([{ kind: 'trash', id: 'pdf1' }]);
    const binned = await newest();
    const before = await readDayLog(project.file, 'd1');
    expect(ids(before).slice(0, 2)).toEqual([binned, issued]);
    await store.getState().emptyTrash();
    const after = await readDayLog(project.file, 'd1');
    // The issue step still writes the call sheet under the day; the PDF's own trash no longer says where it was.
    expect(ids(after)).toContain(issued);
    expect(ids(after)).not.toContain(binned);
    await expectFeedWords(after);
    // Read on from before the purge, it agrees with a fresh read.
    expect(ids(await moreDayLog(project.file, 'd1', before))).toEqual(ids(after));
  });

  it('keeps the day’s own steps when its call sheet itself is deleted for good', async () => {
    await apply((r) => callsheetNoteChange(r, 'd1', 'notes', 'Lunch at 13:00', 'cs1'));
    await apply((r) => dayChange(r, 'd1', 'call_time', '07:00'));
    const call = await newest();
    await apply((r) => trashShot(r, project.projectId, shots[3] ?? ''));
    // Empty Trash takes the call sheet with it, as a feature's extra (ops.ts: alsoPurge).
    await store.getState().emptyTrash(undefined, () => ['cs1']);
    expect(store.getState().records.cs1).toBeUndefined();
    const day = await readDayLog(project.file, 'd1');
    expect(ids(day)[0]).toBe(call);
    await expectFeedWords(day);
  });

  it('reads on from the last read with only what’s new, and gives the same steps as a fresh read', async () => {
    await apply((r) => scheduleFrames(r, [shots[0] ?? ''], 'd1'));
    let known = await readDayLog(project.file, 'd1');
    const later: (() => Promise<void>)[] = [
      () => apply((r) => callsheetNoteChange(r, 'd1', 'notes', 'Lunch at 13:00', 'cs1')),
      () => apply((r) => scheduleFrames(r, shots.slice(0, 3), 'd1')),
      () => apply((r) => scheduleFrames(r, [shots[1] ?? ''], 'd2')),
      () => store.getState().undo(),
      () => store.getState().redo(),
      () => apply((r) => dayChange(r, 'd2', 'call_time', '06:00')),
      () => apply((r) => trashShot(r, project.projectId, shots[2] ?? '')),
      // Under the call sheet, a record new to the day: read whole.
      () => apply(() => [{ kind: 'create', record: { id: 'pdf2', type: 'media', parentId: 'cs1', sortKey: 'b', props: { kind: 'pdf', file: 'c'.repeat(64), source_name: 'Day 1.pdf', byte_size: 10, issue_version: 1 } } }]),
    ];
    for (const edit of later) {
      await edit();
      known = await moreDayLog(project.file, 'd1', known);
      const fresh = await readDayLog(project.file, 'd1');
      expect(ids(known)).toEqual(ids(fresh));
      expect(lines(known)).toEqual(lines(fresh));
      expect(known.under.toSorted()).toEqual(fresh.under.toSorted());
    }
  });

  // A frame of the day brings what changed on it while it was there (Kevin, Nov 21), its strokes and picture too.
  it('takes in a sketch on a frame of the day, which writes only the stroke', async () => {
    await apply((r) => scheduleFrames(r, [shots[0] ?? ''], 'd1'));
    await apply((r) => [addStroke(r, shots[0] ?? '', pen)]);
    const sketched = await newest();
    // The same on a frame never on the day: not the day's.
    await apply((r) => [addStroke(r, shots[1] ?? '', pen)]);
    const elsewhere = await newest();
    const day = await readDayLog(project.file, 'd1');
    expect(ids(day)[0]).toBe(sketched);
    expect(ids(day)).not.toContain(elsewhere);
    await expectFeedWords(day);
  });

  it('takes in a picture set on a frame of the day', async () => {
    await apply((r) => scheduleFrames(r, [shots[0] ?? ''], 'd1'));
    await apply(() => [{ kind: 'create', record: { id: 'pic1', type: 'media', parentId: shots[0] ?? '', sortKey: 'a', props: { kind: 'image', file: 'a'.repeat(64), width: 640, height: 360 } } }]);
    const pictured = await newest();
    await apply(() => [{ kind: 'create', record: { id: 'pic2', type: 'media', parentId: shots[1] ?? '', sortKey: 'a', props: { kind: 'image', file: 'b'.repeat(64), width: 640, height: 360 } } }]);
    const elsewhere = await newest();
    const day = await readDayLog(project.file, 'd1');
    expect(ids(day)[0]).toBe(pictured);
    expect(ids(day)).not.toContain(elsewhere);
    await expectFeedWords(day);
  });

  it('leaves out a frame’s steps from before it was scheduled, its own History’s steps', async () => {
    await apply(() => [{ kind: 'update', id: shots[0] ?? '', set: { title: 'Wide' } }]);
    const titled = await newest();
    await apply((r) => [addStroke(r, shots[0] ?? '', pen)]);
    const sketched = await newest();
    await apply((r) => scheduleFrames(r, [shots[0] ?? ''], 'd1'));
    const scheduled = await newest();
    const day = await readDayLog(project.file, 'd1');
    expect(ids(day)[0]).toBe(scheduled);
    expect(ids(day)).not.toContain(sketched);
    expect(ids(day)).not.toContain(titled);
    // Of the frame's own History, only its arrival is the day's.
    const frame = store.getState().records[shots[0] ?? ''];
    if (!frame) throw new Error('no frame');
    const own = new Set((await itemOps(project.file, frame)).map((op) => op.groupId));
    expect([...own].filter((group) => ids(day).includes(group))).toEqual([scheduled]);
    await expectFeedWords(day);
  });

  it('never takes in a frame never on the day: its edits, sketches and pictures', async () => {
    await apply((r) => scheduleFrames(r, [shots[0] ?? ''], 'd1'));
    const before = new Set(ids(await readDayLog(project.file, 'd1')));
    await apply((r) => scheduleFrames(r, [shots[2] ?? ''], 'd2'));
    await apply(() => [{ kind: 'update', id: shots[1] ?? '', set: { title: 'Insert' } }]);
    await apply((r) => [addStroke(r, shots[1] ?? '', pen)]);
    await apply(() => [{ kind: 'create', record: { id: 'pic2', type: 'media', parentId: shots[2] ?? '', sortKey: 'a', props: { kind: 'image', file: 'b'.repeat(64), width: 640, height: 360 } } }]);
    const day = await readDayLog(project.file, 'd1');
    expect(new Set(ids(day))).toEqual(before);
  });

  it('reads on with a sketch, a picture, an undo of each and a frame newly scheduled, as a fresh read does', async () => {
    await apply(() => [{ kind: 'update', id: shots[1] ?? '', set: { title: 'Insert' } }]);
    await apply((r) => [addStroke(r, shots[1] ?? '', pen)]);
    await apply((r) => scheduleFrames(r, [shots[0] ?? ''], 'd1'));
    let known = await readDayLog(project.file, 'd1');
    const later: (() => Promise<void>)[] = [
      () => apply((r) => [addStroke(r, shots[0] ?? '', pen)]),
      () => store.getState().undo(),
      () => store.getState().redo(),
      () => apply(() => [{ kind: 'create', record: { id: 'pic1', type: 'media', parentId: shots[0] ?? '', sortKey: 'a', props: { kind: 'image', file: 'a'.repeat(64), width: 640, height: 360 } } }]),
      () => apply(() => [{ kind: 'trash', id: 'pic1' }]),
      // A frame with a sketch and an edit from before: scheduled now, it joins from its arrival on.
      () => apply((r) => scheduleFrames(r, [shots[1] ?? ''], 'd1')),
      () => apply((r) => [addStroke(r, shots[1] ?? '', pen)]),
    ];
    for (const edit of later) {
      await edit();
      known = await moreDayLog(project.file, 'd1', known);
      const fresh = await readDayLog(project.file, 'd1');
      expect(ids(known)).toEqual(ids(fresh));
      expect(lines(known)).toEqual(lines(fresh));
      expect(known.frames.toSorted()).toEqual(fresh.frames.toSorted());
      expect(known.kids.toSorted()).toEqual(fresh.kids.toSorted());
    }
    expect(known.frames.toSorted()).toEqual([shots[0] ?? '', shots[1] ?? ''].toSorted());
  });

  it('takes the newest op before checking for an Empty Trash, so one landing between the two is never skipped', async () => {
    await apply((r) => scheduleFrames(r, [shots[0] ?? ''], 'd1'));
    const known = await readDayLog(project.file, 'd1');
    await apply((r) => trashShot(r, project.projectId, shots[3] ?? ''));
    const order: string[] = [];
    const file = Object.assign(Object.create(project.file) as typeof project.file, {
      query: (sql: string, params: Parameters<typeof project.file.query>[1] = []) => {
        if (/coalesce\(max\(seq\), 0\) AS seq FROM ops/.test(sql)) order.push('through');
        if (/kind = 'purge'/.test(sql)) order.push('purged');
        return project.file.query(sql, params);
      },
    });
    await moreDayLog(file, 'd1', known);
    expect(order.slice(0, 2)).toEqual(['through', 'purged']);
  });

  it('reads only the new writes after the first read', async () => {
    await apply((r) => scheduleFrames(r, [shots[0] ?? ''], 'd1'));
    const known = await readDayLog(project.file, 'd1');
    await apply((r) => dayChange(r, 'd1', 'call_time', '07:00'));
    const asked: string[] = [];
    const file = Object.assign(Object.create(project.file) as typeof project.file, {
      query: (sql: string, params: Parameters<typeof project.file.query>[1] = []) => {
        if (/json_extract\(o\.(before|after), '\$\.props\.shoot_day_id'\)/.test(sql)) asked.push(String(params[0]));
        return project.file.query(sql, params);
      },
    });
    const next = await moreDayLog(file, 'd1', known);
    expect(next.steps).toHaveLength(known.steps.length + 1);
    // The one pass over the ops starts after the last read's newest op, never at the log's start.
    expect(asked).toEqual([String(known.through)]);
  });
});

// Kevin, Nov 21: what happened to the day, not a frame's life before it arrived or after it left.
describe('a shoot day’s history, narrowed to the day', () => {
  /** Reads on from `known` and checks it gives what a fresh read gives; returns the read on. */
  async function readOn(dayId: string, known: DayLog): Promise<DayLog> {
    const next = await moreDayLog(project.file, dayId, known);
    const fresh = await readDayLog(project.file, dayId);
    expect(ids(next)).toEqual(ids(fresh));
    expect(lines(next)).toEqual(lines(fresh));
    expect(next.under.toSorted()).toEqual(fresh.under.toSorted());
    expect(next.frames.toSorted()).toEqual(fresh.frames.toSorted());
    expect(next.kids.toSorted()).toEqual(fresh.kids.toSorted());
    expect(next.turns).toEqual(fresh.turns);
    return next;
  }

  /** Steps on Day 1, its history read on after each; the step's group id. */
  function dayOne(): { step: (edit: () => Promise<unknown>) => Promise<string>; day: () => DayLog; start: () => Promise<void> } {
    let known: DayLog | null = null;
    return {
      start: async () => {
        known = await readDayLog(project.file, 'd1');
      },
      step: async (edit) => {
        await edit();
        const id = await newest();
        if (!known) throw new Error('not started');
        known = await readOn('d1', known);
        return id;
      },
      day: () => {
        if (!known) throw new Error('not started');
        return known;
      },
    };
  }

  it('lists a frame from its arrival, its moves in both days’, and each change in the day it was on then', async () => {
    let one = await readDayLog(project.file, 'd1');
    let two = await readDayLog(project.file, 'd2');
    const step = async (edit: () => Promise<unknown>): Promise<string> => {
      await edit();
      const id = await newest();
      one = await readOn('d1', one);
      two = await readOn('d2', two);
      return id;
    };
    const added = addShot(store.getState().records, project.projectId, 'sc2');
    const frame = added.shotId;
    const lens = (mm: number) => step(() => apply(() => [{ kind: 'update', id: frame, set: { lens_mm: mm } }]));
    const sketch = () => step(() => apply((r) => [addStroke(r, frame, pen)]));
    const made = await step(() => store.getState().apply(added.changes));
    const lensBefore = await lens(35);
    const sketchBefore = await sketch();
    const arrived = await step(() => apply((r) => scheduleFrames(r, [frame], 'd1')));
    const lensOn = await lens(50);
    const sketchOn = await sketch();
    const moved = await step(() => apply((r) => scheduleFrames(r, [frame], 'd2')));
    const lensTwo = await lens(85);
    const sketchTwo = await sketch();
    const back = await step(() => apply((r) => scheduleFrames(r, [frame], 'd1')));
    const lensBack = await lens(24);
    const sketchBack = await sketch();
    const all = [made, lensBefore, sketchBefore, arrived, lensOn, sketchOn, moved, lensTwo, sketchTwo, back, lensBack, sketchBack];
    const frameSteps = (day: DayLog) => ids(day).filter((id) => all.includes(id));
    expect(frameSteps(one)).toEqual([sketchBack, lensBack, back, moved, sketchOn, lensOn, arrived]);
    expect(frameSteps(two)).toEqual([back, sketchTwo, lensTwo, moved]);
    await expectFeedWords(one);
    await expectFeedWords(two);
  });

  it('follows undos: an undone arrival is a leaving, an undone change made on the day is the day’s', async () => {
    const { step, day, start } = dayOne();
    await start();
    const arrived = await step(() => apply((r) => scheduleFrames(r, [shots[0] ?? ''], 'd1')));
    const lensOn = await step(() => apply(() => [{ kind: 'update', id: shots[0] ?? '', set: { lens_mm: 50 } }]));
    const lensUndone = await step(() => store.getState().undo());
    const arrivalUndone = await step(() => store.getState().undo());
    // Off the day again: its next edits are not the day's.
    const lensOff = await step(() => apply(() => [{ kind: 'update', id: shots[0] ?? '', set: { lens_mm: 85 } }]));
    const sketchOff = await step(() => apply((r) => [addStroke(r, shots[0] ?? '', pen)]));
    expect(ids(day()).slice(0, 4)).toEqual([arrivalUndone, lensUndone, lensOn, arrived]);
    expect(ids(day())).not.toContain(lensOff);
    expect(ids(day())).not.toContain(sketchOff);
    await expectFeedWords(day());
  });

  it('lists a frame trashed and brought back while on the day, never its steps from before', async () => {
    const { step, day, start } = dayOne();
    await start();
    const added = addShot(store.getState().records, project.projectId, 'sc1');
    const made = await step(() => store.getState().apply(added.changes));
    const titled = await step(() => apply(() => [{ kind: 'update', id: added.shotId, set: { title: 'Close' } }]));
    const arrived = await step(() => apply((r) => scheduleFrames(r, [added.shotId], 'd1')));
    const trashed = await step(() => apply((r) => trashShot(r, project.projectId, added.shotId)));
    const restored = await step(() => store.getState().undo());
    expect(ids(day()).slice(0, 3)).toEqual([restored, trashed, arrived]);
    expect(ids(day())).not.toContain(made);
    expect(ids(day())).not.toContain(titled);
    await expectFeedWords(day());
  });

  it('lists a whole scene scheduled at once, not its frames’ edits from before, and a sketch on one after', async () => {
    const { step, day, start } = dayOne();
    await start();
    const titled = await step(() => apply(() => shots.slice(0, 3).map((id) => ({ kind: 'update' as const, id, set: { title: 'Wide' } }))));
    const sketchBefore = await step(() => apply((r) => [addStroke(r, shots[1] ?? '', pen)]));
    const scheduled = await step(() => apply((r) => scheduleFrames(r, shots.slice(0, 3), 'd1')));
    const sketchOn = await step(() => apply((r) => [addStroke(r, shots[1] ?? '', pen)]));
    expect(ids(day()).slice(0, 2)).toEqual([sketchOn, scheduled]);
    expect(lines(day())[1]).toContain('SC 01');
    expect(ids(day())).not.toContain(titled);
    expect(ids(day())).not.toContain(sketchBefore);
    await expectFeedWords(day());
  });

  it('lists a call sheet’s edits, and agrees with a fresh read when one is deleted for good', async () => {
    const { step, day, start } = dayOne();
    await start();
    const noted = await step(() => apply((r) => callsheetNoteChange(r, 'd1', 'notes', 'Lunch at 13:00', 'cs1')));
    const other = await step(() => apply((r) => callsheetNoteChange(r, 'd2', 'notes', 'Rain cover', 'cs2')));
    const call = await step(() => apply((r) => dayChange(r, 'd1', 'call_time', '07:00')));
    expect(ids(day()).slice(0, 2)).toEqual([call, noted]);
    expect(ids(day())).not.toContain(other);
    await step(() => apply((r) => trashShot(r, project.projectId, shots[3] ?? '')));
    // Empty Trash takes the call sheet with it (ops.ts: alsoPurge): its writes no longer say where they were.
    await step(() => store.getState().emptyTrash(undefined, () => ['cs1']));
    expect(store.getState().records.cs1).toBeUndefined();
    expect(ids(day())).toContain(call);
    await expectFeedWords(day());
  });
});
