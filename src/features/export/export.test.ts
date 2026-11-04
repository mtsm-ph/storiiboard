import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../app/projectStore';
import { withField } from '../../core/model/customFields';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { addShot, trashShot } from '../storyboard/board';
import { exportName, frameFileName, paddedScene, safeName } from './names';
import { pngSize } from './pngFrames';
import { FORMATS } from './registry';
import { csvCell, shotListCsv } from './shotListCsv';
import { readWatermark, watermarkFor, watermarkProp } from './watermark';

describe('export names', () => {
  it('pads the scene number so files sort, and keeps the shot number exactly as on the slate', () => {
    expect(paddedScene('4')).toBe('004');
    expect(paddedScene('12A')).toBe('012A');
    expect(paddedScene('A4')).toBe('A004');
    expect(frameFileName('4', '4A')).toBe('SC004_4A.png');
    expect(frameFileName('12A', '12AB')).toBe('SC012A_12AB.png');
    expect(['SC010_10A.png', 'SC002_2A.png', 'SC004_4B.png'].sort()).toEqual(['SC002_2A.png', 'SC004_4B.png', 'SC010_10A.png']);
  });

  it('names a file after the project and the scene, without what a file system refuses', () => {
    expect(exportName('Bey County', null, 'shot list', 'csv')).toBe('Bey County shot list.csv');
    expect(exportName('Bey County', '4', 'frames')).toBe('Bey County SC 04 frames');
    expect(safeName('A/B: "C"')).toBe('A B C');
    expect(safeName('///')).toBe('Storiiboard');
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
      { kind: 'update', id: a, set: { size: 'MCU', lens_mm: 35, t_stop: 2.8, status: 'have', action: 'Mary wipes the counter, "slowly".', departments: ['camera', 'art'] } },
      { kind: 'update', id: a, ...withField(store.getState().records[a]?.props ?? {}, 'Drone', 'no') },
    ]);
    await store.getState().apply([{ kind: 'update', id: c, set: { size: 'WS', dialogue: 'We’re closed.' } }]);
    // A frame in the Trash never goes out.
    await store.getState().applyWith((now) => ({ changes: trashShot(now, project.projectId, b) }));

    expect(shotListCsv(store.getState().records, project.projectId, { kind: 'project' })).toBe(
      '﻿' +
        [
          'Scene,Heading,Length,Location,Shot,Size,Lens (mm),T-stop,Support,Height,Move,Status,Action,Dialogue,Departments,Drone',
          '4,INT. DINER — NIGHT,1 3/8 pg,Bey County Diner,4A,MCU,35,T2.8,,,,Have,"Mary wipes the counter, ""slowly"".",,"Camera, Art",no',
          '4,INT. DINER — NIGHT,1 3/8 pg,Bey County Diner,4B,WS,,,,,,Need to shoot,,We’re closed.,,',
        ].join('\r\n') +
        '\r\n',
    );
  });
});
