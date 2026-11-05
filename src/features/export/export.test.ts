import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLocale, t } from '../../core/i18n';
import { createProjectStore } from '../../app/projectStore';
import { withField } from '../../core/model/customFields';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { addShot, trashShot } from '../storyboard/board';
import { exportName, frameFileName, paddedScene, safeName, uniqueNames } from './names';
import { pngSize } from './pngFrames';
import { watermarkSize } from './renderFrame';
import { FORMATS } from './registry';
import { csvCell, shotListCsv } from './shotListCsv';
import { readWatermark, watermarkChange, watermarkFor, watermarkProp, watermarkSave, type Watermark } from './watermark';

describe('export names', () => {
  it('pads the scene number, and keeps the scene and shot numbers exactly as on the slate', () => {
    expect(paddedScene('4')).toBe('004');
    expect(paddedScene('12A')).toBe('012A');
    expect(paddedScene('A4')).toBe('A004');
    expect(frameFileName('4', '4A')).toBe('SC004_4A.png');
    expect(frameFileName('4', '4AA')).toBe('SC004_4AA.png');
    expect(frameFileName('12A', '12AA')).toBe('SC012A_12AA.png');
    expect(frameFileName('12A', '12AB')).toBe('SC012A_12AB.png');
    // Plain scene numbers line up in a folder...
    expect(['SC010_10A.png', 'SC002_2A.png', 'SC004_4B.png'].sort()).toEqual(['SC002_2A.png', 'SC004_4B.png', 'SC010_10A.png']);
    // ...but a name sort isn't board order, as names.ts says: letters sort as letters, so these read out of order.
    expect(['SC004_4B.png', 'SC004_4AA.png', 'SC012_12A.png', 'SC012A_12AA.png'].sort()).toEqual([
      'SC004_4AA.png',
      'SC004_4B.png',
      'SC012A_12AA.png',
      'SC012_12A.png',
    ]);
  });

  it('names each file of a set once, whatever its case', () => {
    const unique = uniqueNames();
    expect(['SC004_4A.png', 'SC004_4B.png', 'SC004_4A.png', 'sc004_4a.png', 'SC004_4A (2).png'].map(unique)).toEqual([
      'SC004_4A.png',
      'SC004_4B.png',
      'SC004_4A (2).png',
      'sc004_4a (3).png',
      'SC004_4A (2) (2).png',
    ]);
  });

  it('names a file after the project and the scene, without what a file system refuses', () => {
    expect(exportName('Bey County', null, 'shot list', 'csv')).toBe('Bey County shot list.csv');
    expect(exportName('Bey County', '4', 'frames')).toBe('Bey County SC 04 frames');
    expect(safeName('A/B: "C"')).toBe('A B C');
    expect(safeName('///')).toBe('Storiiboard');
    // The Rust side refuses a name that starts with a dot, so these titles once couldn't export at all.
    expect(exportName('...And Then There Were None', null, 'shot list', 'csv')).toBe('And Then There Were None shot list.csv');
    expect(exportName('.Bey County', '4', 'frames')).toBe('Bey County SC 04 frames');
    expect(safeName(' . Bey County. . ')).toBe('Bey County');
    expect(safeName('...')).toBe('Storiiboard');
  });

  it('puts the words in the language’s order: lista de planos de Bey County ESC 04 (P7’s low)', () => {
    setLocale('es');
    try {
      expect(exportName('Bey County', '4', t('export.csv.fileWord'), 'csv')).toBe('lista de planos de Bey County ESC 04.csv');
      expect(exportName('Bey County', null, t('export.png.folderWord'))).toBe('cuadros de Bey County');
      // Only a name's leading dots are refused; here the name starts with the word, so the title keeps them.
      expect(exportName('...Bey County', null, t('export.pdf.fileWord'), 'pdf')).toBe('storyboard de ...Bey County.pdf');
    } finally {
      setLocale('en');
    }
  });

  it('sizes frames by the long edge, wide or tall', () => {
    expect(pngSize(16 / 9)).toEqual({ width: 1920, height: 1080 });
    expect(pngSize(9 / 16)).toEqual({ width: 1080, height: 1920 });
    expect(pngSize(2.39)).toEqual({ width: 1920, height: 803 });
  });

  it('registers each format once, with a file or a folder', () => {
    expect(FORMATS.map((f) => [f.id, f.output])).toEqual([
      ['pdf-storyboard', 'file'],
      ['shot-list-csv', 'file'],
      ['png-frames', 'folder'],
    ]);
  });
});

describe('a CSV cell', () => {
  it('quotes commas, quotes, line ends and edge spaces, and defuses formulas', () => {
    expect(csvCell('MCU')).toBe('MCU');
    expect(csvCell('Mary, Tom')).toBe('"Mary, Tom"');
    expect(csvCell('She says "no"')).toBe('"She says ""no"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(' padded')).toBe('" padded"');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('-5')).toBe("'-5");
  });
});

describe('the watermark', () => {
  /** A stand-in for the canvas's measure: each character 0.6 of the type size wide. */
  const measure = (text: string) => (font: string) => text.length * 0.6 * Number(/(\d+)px/.exec(font)?.[1] ?? 0);

  it('keeps its size on a wide frame, and on a tall or a long one shrinks to fit between the margins', () => {
    expect(watermarkSize(measure('DRAFT'), 1920, 1080)).toBe(49);
    // A 9:16 frame gets the size a 16:9 one does, from the short edge, not one sized from its height.
    expect(watermarkSize(measure('DRAFT'), 1080, 1920)).toBe(49);
    const long = 'DRAFT — not for distribution, Bey County, client review copy, Nov 2026 cut';
    for (const [width, height] of [
      [1080, 1920],
      [1920, 1080],
      [1920, 803],
    ] as const) {
      const size = watermarkSize(measure(long), width, height);
      const margin = Math.round(Math.min(width, height) * 0.03);
      expect(measure(long)(`${String(size)}px`)).toBeLessThanOrEqual(width - 2 * margin);
      expect(size).toBeGreaterThan(10);
    }
  });

  it('makes no edit when Save changes nothing, and one when it does', () => {
    const draft: Watermark = { text: 'DRAFT', position: 'center', opacity: 0.5, appliesTo: ['pdf', 'png'] };
    const props = { watermark: watermarkProp(draft) };
    expect(watermarkChange('p', props, draft)).toBeNull();
    // A box ticked off and on again is the same setting.
    expect(watermarkChange('p', props, { ...draft, text: ' DRAFT ', appliesTo: ['png', 'pdf'] })).toBeNull();
    expect(watermarkChange('p', {}, { ...draft, text: '' })).toBeNull();
    expect(watermarkChange('p', props, { ...draft, opacity: 0.6 })).toEqual({
      kind: 'update',
      id: 'p',
      set: { watermark: watermarkProp({ ...draft, opacity: 0.6 }) },
    });
    expect(watermarkChange('p', props, { ...draft, text: '' })).toEqual({ kind: 'update', id: 'p', unset: ['watermark'] });
  });

  it('reads back what was stored, and is off with no text or for an export it doesn’t apply to', () => {
    const props = { watermark: watermarkProp({ text: 'DRAFT', position: 'center', opacity: 0.5, appliesTo: ['png'] }) };
    expect(readWatermark(props)).toEqual({ text: 'DRAFT', position: 'center', opacity: 0.5, appliesTo: ['png'] });
    expect(watermarkFor(props, 'png')?.text).toBe('DRAFT');
    expect(watermarkFor(props, 'pdf')).toBeNull();
    expect(readWatermark({ watermark: { text: '  ' } })).toBeNull();
    expect(readWatermark({})).toBeNull();
  });
});

describe('the shot list CSV', () => {
  let folder: TestFolder;
  let project: Project;
  const store = createProjectStore();
  beforeEach(async () => {
    folder = makeTestFolder();
    project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
    await store.getState().open(project);
  });
  afterEach(async () => {
    await store.getState().close();
    folder.remove();
  });

  it('saves Watermark Settings as one step to undo', async () => {
    expect(store.getState().canUndo).toBe(false);
    const draft: Watermark = { text: 'DRAFT', position: 'center', opacity: 0.5, appliesTo: ['png'] };
    const change = watermarkChange(project.projectId, store.getState().records[project.projectId]?.props, draft);
    if (!change) throw new Error('expected an edit');
    await store.getState().apply([change]);
    expect(readWatermark(store.getState().records[project.projectId]?.props)).toEqual(draft);
    expect(watermarkChange(project.projectId, store.getState().records[project.projectId]?.props, draft)).toBeNull();
    await store.getState().undo();
    expect(readWatermark(store.getState().records[project.projectId]?.props)).toBeNull();
    expect(store.getState().canUndo).toBe(false);
  });

  it('keeps Watermark Settings open, with the draft, when the write is refused', async () => {
    let closed = 0;
    const save = watermarkSave(store, project.projectId, () => (closed += 1));
    const draft: Watermark = { text: 'DRAFT', position: 'top-left', opacity: 0.3, appliesTo: ['pdf', 'png'] };
    const write = project.file.tx.bind(project.file);
    project.file.tx = () => Promise.reject(new Error('The disk is full.'));
    expect(await save(draft)).toBe(false);
    expect(closed).toBe(0);
    expect(store.getState().error).toBe('The disk is full.');
    expect(readWatermark(store.getState().records[project.projectId]?.props)).toBeNull();
    // The same draft, saved again once the disk takes it.
    project.file.tx = write;
    expect(await save(draft)).toBe(true);
    expect(closed).toBe(1);
    expect(readWatermark(store.getState().records[project.projectId]?.props)).toEqual(draft);
  });

  it('makes one step of a double click on Watermark Save', async () => {
    let closed = 0;
    const save = watermarkSave(store, project.projectId, () => (closed += 1));
    const draft: Watermark = { text: 'DRAFT', position: 'center', opacity: 0.5, appliesTo: ['png'] };
    expect(await Promise.all([save(draft), save(draft)])).toEqual([true, true]);
    expect(closed).toBe(1);
    expect(readWatermark(store.getState().records[project.projectId]?.props)).toEqual(draft);
    await store.getState().undo();
    expect(readWatermark(store.getState().records[project.projectId]?.props)).toBeNull();
    expect(store.getState().canUndo).toBe(false);
    // Nothing to change: it closes, and leaves no step.
    expect(await save({ ...draft, text: '' })).toBe(true);
    expect(closed).toBe(2);
    expect(store.getState().canUndo).toBe(false);
  });

  it('reads a custom field whatever case a frame spells it in, and exports one scene alone', async () => {
    for (const [id, number, key] of [
      ['sc4', '4', 'V'],
      ['sc5', '5', 'W'],
    ] as const) {
      await store.getState().apply([{ kind: 'create', record: { id, type: 'scene', parentId: project.projectId, sortKey: key, props: { number, name: '' } } }]);
    }
    const ids: string[] = [];
    for (const scene of ['sc4', 'sc4', 'sc5']) {
      const added = addShot(store.getState().records, project.projectId, scene);
      await store.getState().apply(added.changes);
      ids.push(added.shotId);
    }
    const [a = '', b = '', c = ''] = ids;
    await store.getState().apply([
      { kind: 'update', id: a, set: { custom: { Drone: 'yes' } } },
      { kind: 'update', id: b, set: { custom: { drone: 'no' } } },
      { kind: 'update', id: c, set: { custom: { Drone: 'maybe' } } },
    ]);
    const rows = (scope: Parameters<typeof shotListCsv>[2]) =>
      shotListCsv(store.getState().records, project.projectId, scope).replace(/^\uFEFF/, '').trimEnd().split('\r\n');
    const all = rows({ kind: 'project' });
    expect(all[0]?.endsWith(',Drone')).toBe(true);
    expect(all.slice(1).map((row) => [row.split(',')[4], row.split(',').at(-1)])).toEqual([
      ['4A', 'yes'],
      ['4B', 'no'],
      ['5A', 'maybe'],
    ]);
    expect(rows({ kind: 'scene', sceneId: 'sc5' }).slice(1).map((row) => row.split(',')[4])).toEqual(['5A']);
  });

  it('takes its custom columns from the frames that go out: never a trashed scene’s, nor another scene’s', async () => {
    for (const [id, number, key] of [
      ['sc4', '4', 'V'],
      ['sc5', '5', 'W'],
    ] as const) {
      await store.getState().apply([{ kind: 'create', record: { id, type: 'scene', parentId: project.projectId, sortKey: key, props: { number, name: '' } } }]);
    }
    const ids: string[] = [];
    for (const scene of ['sc4', 'sc5']) {
      const added = addShot(store.getState().records, project.projectId, scene);
      await store.getState().apply(added.changes);
      ids.push(added.shotId);
    }
    const [a = '', b = ''] = ids;
    await store.getState().apply([
      { kind: 'update', id: a, set: { custom: { Drone: 'yes' } } },
      { kind: 'update', id: b, set: { custom: { 'Nudity rider': 'closed set' } } },
    ]);
    const header = (scope: Parameters<typeof shotListCsv>[2]) =>
      shotListCsv(store.getState().records, project.projectId, scope).replace(/^\uFEFF/, '').split('\r\n')[0] ?? '';
    expect(header({ kind: 'project' }).endsWith(',Departments,Drone,Nudity rider')).toBe(true);
    // One scene alone: its own fields, not a column of blanks for another scene's.
    expect(header({ kind: 'scene', sceneId: 'sc4' }).endsWith(',Departments,Drone')).toBe(true);
    // The scene goes to the Trash; its frame stays live under it, but neither it nor its field's name goes out.
    await store.getState().apply([{ kind: 'trash', id: 'sc5' }]);
    expect(store.getState().records[b]?.trashedAt).toBeNull();
    expect(header({ kind: 'project' }).endsWith(',Departments,Drone')).toBe(true);
    expect(shotListCsv(store.getState().records, project.projectId, { kind: 'project' })).not.toContain('Nudity rider');
  });

  it('is one row per live frame in board order, with custom fields as columns, exactly', async () => {
    await store.getState().apply([
      { kind: 'create', record: { id: 'loc', type: 'location', parentId: project.projectId, sortKey: 'V', props: { name: 'Bey County Diner' } } },
      {
        kind: 'create',
        record: {
          id: 'sc4',
          type: 'scene',
          parentId: project.projectId,
          sortKey: 'V',
          props: { number: '4', name: 'Diner', int_ext: 'INT', day_night: 'NIGHT', page_eighths: 11, location_id: 'loc' },
        },
      },
    ]);
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const added = addShot(store.getState().records, project.projectId, 'sc4');
      await store.getState().apply(added.changes);
      ids.push(added.shotId);
    }
    const [a = '', b = '', c = ''] = ids;
    await store.getState().apply([
      { kind: 'update', id: a, set: { size: 'MCU', lens_mm: 35, t_stop: 2.8, status: 'have', action: 'Mary wipes the counter, "slowly".', department_status: { art: { priority: true }, sound: { done: true }, camera: { priority: true } } } },
      { kind: 'update', id: a, ...withField(store.getState().records[a]?.props ?? {}, 'Drone', 'no') },
    ]);
    await store.getState().apply([{ kind: 'update', id: c, set: { size: 'WS', dialogue: 'We’re closed.' } }]);
    // A frame in the Trash never goes out.
    await store.getState().applyWith((now) => ({ changes: trashShot(now, project.projectId, b) }));

    expect(shotListCsv(store.getState().records, project.projectId, { kind: 'project' })).toBe(
      '﻿' +
        [
          'Scene,Heading,Length,Location,Shot,Size,Lens (mm),T-stop,Support,Height,Move,Status,Action,Dialogue,Departments,Drone',
          '4,INT. DINER — NIGHT,1 3/8 pg,Bey County Diner,4A,MCU,35,T2.8,,,,Have,"Mary wipes the counter, ""slowly"".",,Camera: Priority; Art: Priority; Sound: Done,no',
          '4,INT. DINER — NIGHT,1 3/8 pg,Bey County Diner,4B,WS,,,,,,Need to shoot,,We’re closed.,,',
        ].join('\r\n') +
        '\r\n',
    );
  });
});
