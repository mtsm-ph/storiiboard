import { readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SbdRecord } from '../../model/record';
import { ownSunOf } from '../../model/sunSources';
import { apply, loadRecords, log } from '../../ops/ops';
import type { ProjectFile } from '../driver';
import { migrate } from '../migrate';
import { nodeDriver } from '../nodeDriver';
import { makeTestFolder, type TestFolder } from '../testFolder';
import { MIGRATIONS, SCHEMA_VERSION } from '.';
import { canvasPolish } from './015_canvas_polish';

// Schema 15 (6.5 canvas polish, one version for every new prop of 6.5): it changes no table and rewrites nothing. A file
// of schema 14 opens backed up, with every row as it was, and reads 15; then it takes a sun path's own place and date and
// a `settings_preset` record (6.5.8's type), through ops, as any record. The upgrade runs through the registered
// MIGRATIONS, as opening a project does.

let folder: TestFolder;
beforeEach(() => {
  folder = makeTestFolder();
});
afterEach(() => {
  folder.remove();
});

const at = '2026-11-16T10:00:00.000Z';
const late = '2026-11-16T12:00:00.000Z';

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

/** A schema 14 project: a room with its north, a setup's plan with a sun path at 14:30, a location with its place. */
async function v14File(): Promise<string> {
  const path = folder.path('Bey County.sbd');
  const file = await nodeDriver.create(path);
  await migrate(file, { isNew: true, migrations: MIGRATIONS.slice(0, 14), now: () => new Date(at) });
  await apply(
    file,
    [
      create('p', 'project', null, { name: 'Bey County' }),
      create('loc', 'location', 'p', { name: 'Diner', latitude: 40.7128, longitude: -74.006, map_name: 'Diner, New York' }),
      create('room', 'plan', 'p', { kind: 'room', name: 'Diner', location_id: 'loc' }),
      create('north', 'plan_item', 'room', { kind: 'north', icon: 'production/north', x: 0, y: 0, width: 0.28, height: 0.6, rotation: 35 }),
      create('s1', 'scene', 'p', { number: '1', location_id: 'loc', room_id: 'room' }),
      create('u1', 'setup', 's1', { name: '' }),
      create('own', 'plan', 'u1', { kind: 'setup', name: '' }),
      create('sun', 'plan_item', 'own', { kind: 'sun', icon: 'lighting/sun-path', x: 1, y: 1, width: 0.8, height: 0.8, rotation: 0, time: '14:30' }),
    ],
    { now: () => new Date(at) },
  );
  await file.close();
  return path;
}

describe('schema 15: the props of 6.5 canvas polish', () => {
  it('is migration 15, after 14, with no table change and nothing rewritten', () => {
    // 015 is migration 15, its own version; which schema is the newest is the newest migration's test to say (016, 6.27).
    expect(canvasPolish.version).toBe(15);
    expect(MIGRATIONS[14]).toBe(canvasPolish);
    expect(canvasPolish.version).toBe(15);
    expect(MIGRATIONS[13]?.version).toBe(14);
    expect(canvasPolish.statements).toEqual([]);
    expect(canvasPolish.backfill).toBeUndefined();
  });

  it('opens a schema 14 file backed up, at 15, with every row as it was', async () => {
    const path = await v14File();
    const file = await nodeDriver.open(path);
    try {
      const before = await everything(file);
      const steps = (await log(file)).length;
      const result = await migrate(file, { isNew: false, migrations: MIGRATIONS, now: () => new Date(late) });
      expect(result).toMatchObject({ from: 14, to: SCHEMA_VERSION });
      expect(result.backup).not.toBeNull();
      expect(readdirSync(folder.dir).some((name) => name.startsWith('Bey County.sbd.bak-v14-'))).toBe(true);
      const [version] = await file.query("SELECT value FROM meta WHERE key = 'schema_version'");
      expect(version?.value).toBe(String(SCHEMA_VERSION));
      expect(await everything(file)).toEqual(before);
      // No step in History: nothing to undo.
      expect(await log(file)).toHaveLength(steps);
    } finally {
      await file.close();
    }
  });

  it('then takes a sun path’s own place and date and a settings preset, as any record', async () => {
    const path = await v14File();
    const file = await nodeDriver.open(path);
    try {
      await migrate(file, { isNew: false, migrations: MIGRATIONS, now: () => new Date(late) });
      const own = { own_latitude: 40.867712, own_longitude: -73.921234, own_date: '2026-06-21' };
      await apply(
        file,
        [
          { kind: 'update', id: 'sun', set: own },
          create('preset', 'settings_preset', 'p', { name: 'Night exteriors', settings: { canvas_view: 'dark', grid: true } }),
        ],
        { now: () => new Date(late) },
      );
      const records = Object.fromEntries((await loadRecords(file)).map((r) => [r.id, r]));
      expect(records.sun?.props).toMatchObject({ time: '14:30', ...own });
      expect(ownSunOf(records.sun?.props ?? {})).toEqual({ place: { latitude: 40.867712, longitude: -73.921234 }, date: '2026-06-21', ownTime: true });
      expect(records.preset).toMatchObject({ type: 'settings_preset', parentId: 'p', props: { name: 'Night exteriors', settings: { canvas_view: 'dark', grid: true } } });
      // Every record of schema 14 as it was.
      expect(records.north?.props.rotation).toBe(35);
      expect(records.loc?.props).toMatchObject({ latitude: 40.7128, longitude: -74.006 });
    } finally {
      await file.close();
    }
  });
});
