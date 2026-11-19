import { readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SbdRecord } from '../../model/record';
import { lightReferenceOf, photoTakenOf } from '../../model/scoutPhoto';
import { sunAtPhoto } from '../../model/sunSources';
import { apply, loadRecords, log } from '../../ops/ops';
import type { ProjectFile } from '../driver';
import { migrate } from '../migrate';
import { nodeDriver } from '../nodeDriver';
import { createProject, openProject } from '../project';
import { importProjectJson, projectJsonBytes, readProjectJson } from '../projectJson';
import { makeTestFolder, type TestFolder } from '../testFolder';
import { MIGRATIONS, SCHEMA_VERSION } from '.';
import { scoutPhotos } from './016_scout_photos';

// Schema 16 (6.27 scout photos, and the 6.6 build-mode milestones after it: one version): it changes no table and
// rewrites nothing. A file of schema 15 opens backed up, with every row as it was, and reads 16; then it takes what a
// photo's EXIF said, a location's light reference and a sun path shown at the photo's time, through ops, as any record;
// and the lossless JSON carries all of them out and back. The place is made up: a point in the open sea.

let folder: TestFolder;
beforeEach(() => {
  folder = makeTestFolder();
});
afterEach(() => {
  folder.remove();
});

const at = '2026-11-16T10:00:00.000Z';
const late = '2026-11-17T12:00:00.000Z';

/** Every table's rows but meta's version, so "nothing else changed" can be compared exactly. */
async function everything(file: ProjectFile): Promise<Record<string, unknown[]>> {
  const tables = await file.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  const out: Record<string, unknown[]> = {};
  for (const { name } of tables) {
    const rows = await file.query(`SELECT * FROM "${String(name)}" ORDER BY rowid`);
    out[String(name)] = String(name) === 'meta' ? rows.filter((row) => row.key !== 'schema_version') : rows;
  }
  return out;
}

const create = (id: string, type: SbdRecord['type'], parentId: string | null, props: SbdRecord['props'], sortKey = id) => ({
  kind: 'create' as const,
  record: { id, type, parentId, sortKey, props },
});

const photo = { kind: 'image', file: 'a'.repeat(64), mime: 'image/jpeg', width: 800, height: 600, color_space: 'srgb', source_name: 'quay-dusk.jpg' };
const taken = { taken_at: '2026-11-03T16:42:07', taken_offset: '+02:00', gps_latitude: 12.51000123, gps_longitude: -45.25000456 };

/** A schema 15 project: a location with a photo from before 6.27, a room with its north, a setup's plan with a sun path with its own place and date. */
async function v15File(): Promise<string> {
  const path = folder.path('Bey County.sbd');
  const file = await nodeDriver.create(path);
  await migrate(file, { isNew: true, migrations: MIGRATIONS.slice(0, 15), now: () => new Date(at) });
  await apply(
    file,
    [
      create('p', 'project', null, { name: 'Bey County' }),
      create('loc', 'location', 'p', { name: 'Quay', latitude: 12.5, longitude: -45.25, map_name: '12.50000, -45.25000', map_moved: true }),
      create('ph', 'media', 'loc', photo),
      create('room', 'plan', 'p', { kind: 'room', name: 'Quay', location_id: 'loc' }),
      create('north', 'plan_item', 'room', { kind: 'north', icon: 'production/north', x: 0, y: 0, width: 0.28, height: 0.6, rotation: 35 }),
      create('s1', 'scene', 'p', { number: '1', location_id: 'loc', room_id: 'room' }),
      create('u1', 'setup', 's1', { name: '' }),
      create('own', 'plan', 'u1', { kind: 'setup', name: '' }),
      create('sun', 'plan_item', 'own', { kind: 'sun', icon: 'lighting/sun-path', x: 1, y: 1, width: 0.8, height: 0.8, rotation: 0, time: '14:30', own_latitude: 12.5, own_longitude: -45.25, own_date: '2026-06-21' }),
      create('preset', 'settings_preset', 'p', { name: 'Night exteriors', settings: { canvas_view: 'dark' } }),
    ],
    { now: () => new Date(at) },
  );
  await file.close();
  return path;
}

describe('schema 16: scout photos, and build mode after them', () => {
  it('is the newest schema, after 15, with no table change and nothing rewritten', () => {
    expect(SCHEMA_VERSION).toBe(16);
    expect(MIGRATIONS[15]).toBe(scoutPhotos);
    expect(scoutPhotos.version).toBe(16);
    expect(MIGRATIONS[14]?.version).toBe(15);
    expect(scoutPhotos.statements).toEqual([]);
    expect(scoutPhotos.backfill).toBeUndefined();
  });

  it('opens a schema 15 file backed up, at 16, with every row as it was', async () => {
    const path = await v15File();
    const file = await nodeDriver.open(path);
    try {
      const before = await everything(file);
      const steps = (await log(file)).length;
      const result = await migrate(file, { isNew: false, migrations: MIGRATIONS, now: () => new Date(late) });
      expect(result).toMatchObject({ from: 15, to: 16 });
      expect(result.backup).not.toBeNull();
      expect(readdirSync(folder.dir).some((name) => name.startsWith('Bey County.sbd.bak-v15-'))).toBe(true);
      const [version] = await file.query("SELECT value FROM meta WHERE key = 'schema_version'");
      expect(version?.value).toBe('16');
      expect(await everything(file)).toEqual(before);
      // No step in History: nothing to undo.
      expect(await log(file)).toHaveLength(steps);
      // A photo from before reads as one with no date or place, and the location as one with no light reference.
      const records = Object.fromEntries((await loadRecords(file)).map((r) => [r.id, r]));
      expect(photoTakenOf(records.ph?.props ?? {})).toEqual({ takenAt: null, offset: null, place: null });
      expect(lightReferenceOf(records, records.loc as SbdRecord)).toEqual({ kind: 'none' });
      expect(sunAtPhoto(records.sun?.props ?? {})).toBe(false);
    } finally {
      await file.close();
    }
  });

  it('then takes a photo’s EXIF, a light reference and a sun path shown at the photo’s time, as any record', async () => {
    const path = await v15File();
    const file = await nodeDriver.open(path);
    try {
      await migrate(file, { isNew: false, migrations: MIGRATIONS, now: () => new Date(late) });
      await apply(
        file,
        [
          create('ph2', 'media', 'loc', { ...photo, file: 'b'.repeat(64), ...taken }),
          { kind: 'update', id: 'loc', set: { light_photo_id: 'ph2' } },
          { kind: 'update', id: 'sun', set: { at_photo: true } },
        ],
        { now: () => new Date(late) },
      );
      const records = Object.fromEntries((await loadRecords(file)).map((r) => [r.id, r]));
      expect(records.ph2?.props).toEqual({ ...photo, file: 'b'.repeat(64), ...taken });
      expect(photoTakenOf(records.ph2?.props ?? {})).toEqual({ takenAt: '2026-11-03T16:42:07', offset: '+02:00', place: { latitude: 12.51000123, longitude: -45.25000456 } });
      expect(lightReferenceOf(records, records.loc as SbdRecord)).toMatchObject({ kind: 'ready', takenAt: '2026-11-03T16:42:07' });
      expect(sunAtPhoto(records.sun?.props ?? {})).toBe(true);
      // Every record of schema 15 as it was.
      expect(records.ph?.props).toEqual(photo);
      expect(records.north?.props.rotation).toBe(35);
      expect(records.sun?.props).toMatchObject({ time: '14:30', own_latitude: 12.5, own_longitude: -45.25, own_date: '2026-06-21' });
      expect(records.preset?.props).toEqual({ name: 'Night exteriors', settings: { canvas_view: 'dark' } });
    } finally {
      await file.close();
    }
  });

  it('carries the new props out and back in the lossless JSON, every decimal kept', async () => {
    const project = await createProject(folder.path('Quay.sbd'), { driver: nodeDriver, backups: false });
    try {
      const root = project.projectId;
      const stored = { ...photo, ...taken };
      const location = { name: 'Quay', status: 'tbd', latitude: 12.51000123, longitude: -45.25000456, map_name: '12.51000, -45.25000', map_moved: true, light_photo_id: 'ph1' };
      const sun = { kind: 'sun', icon: 'lighting/sun-path', x: 1, y: 1, width: 0.8, height: 0.8, rotation: 0, time: '07:15', at_photo: true };
      await apply(
        project.file,
        [
          create('loc1', 'location', root, location),
          create('ph1', 'media', 'loc1', stored),
          create('sc1', 'scene', root, { number: '1', location_id: 'loc1' }),
          create('u1', 'setup', 'sc1', { name: '' }),
          create('own1', 'plan', 'u1', { kind: 'setup', name: '' }),
          create('sun1', 'plan_item', 'own1', sun),
        ],
        { author: 'local', now: () => new Date(late) },
      );
      const text = new TextDecoder().decode(await projectJsonBytes(project.file, new Date(late)));
      // The JSON is the project itself, so it does carry the photo's time and place (docs/SBD_FORMAT.md, Schema v16).
      expect(text).toContain('12.51000123');
      expect(text).toContain('2026-11-03T16:42:07');
      const copy = folder.path('Quay (copy).sbd');
      await importProjectJson(nodeDriver, copy, readProjectJson(text), new Date(late));
      const imported = await openProject(copy, { driver: nodeDriver, backups: false });
      try {
        const rows = await imported.file.query('SELECT id, type, parent_id, props FROM records ORDER BY id');
        const row = (id: string) => rows.find((r) => r.id === id);
        expect(JSON.parse(String(row('ph1')?.props))).toEqual(stored);
        expect(JSON.parse(String(row('loc1')?.props))).toEqual(location);
        expect(JSON.parse(String(row('sun1')?.props))).toEqual(sun);
        expect(rows).toEqual(await project.file.query('SELECT id, type, parent_id, props FROM records ORDER BY id'));
      } finally {
        await imported.close();
      }
    } finally {
      await project.close();
    }
  });
});
