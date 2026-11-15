import { readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { callSheet, callSheetIssues } from '../../model/callsheet';
import type { SbdRecord } from '../../model/record';
import { approvalBasis, approvalState, sceneApprovals } from '../../model/sceneApprovals';
import { apply, loadRecords, log } from '../../ops/ops';
import { callSheetFingerprint, changedSince, FINGERPRINT_VERSION } from '../../../features/callsheets/fingerprint';
import type { ProjectFile } from '../driver';
import { migrate } from '../migrate';
import { nodeDriver } from '../nodeDriver';
import { openProject, type Project } from '../project';
import { makeTestFolder, type TestFolder } from '../testFolder';
import { MIGRATIONS, SCHEMA_VERSION } from '.';

// Schema 14 (Phase 6, decision 16: props only, one version): it changes no table and rewrites nothing. A file from
// before opens with every row as it was, backed up first; approvals and issued call sheets read as they did.

let folder: TestFolder;
let project: Project | undefined;
beforeEach(() => {
  folder = makeTestFolder();
});
afterEach(async () => {
  await project?.close();
  project = undefined;
  folder.remove();
});

const at = '2026-11-13T10:00:00.000Z';
const late = '2026-11-13T12:00:00.000Z';
const zones = new Map<string, string | null>([['loc', 'America/New_York']]);

const byId = (list: readonly SbdRecord[]) => Object.fromEntries(list.map((r) => [r.id, r]));

/** Every table's rows but meta's version and timestamps, so "nothing else changed" can be compared exactly. */
async function everything(file: ProjectFile): Promise<Record<string, unknown[]>> {
  const tables = await file.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  const out: Record<string, unknown[]> = {};
  for (const { name } of tables) {
    const rows = await file.query(`SELECT * FROM "${String(name)}" ORDER BY rowid`);
    out[String(name)] = String(name) === 'meta' ? rows.filter((row) => row.key !== 'schema_version') : rows;
  }
  return out;
}

const sign = (basis: string) => [{ name: 'Sam Reyes', roles: ['dp'], at, basis }];

/** A schema 13 project: a scene approved by every rule an approval may carry, gear, and a day issued. */
async function v13File(): Promise<{ path: string; fingerprint: string }> {
  const path = folder.path('Bey County.sbd');
  const file = await nodeDriver.create(path);
  await migrate(file, { isNew: true, migrations: MIGRATIONS.slice(0, 13), now: () => new Date(at) });
  const create = (id: string, type: SbdRecord['type'], parentId: string | null, props: SbdRecord['props'], sortKey = id) => ({
    kind: 'create' as const,
    record: { id, type, parentId, sortKey, props },
  });
  await apply(
    file,
    [
      create('p', 'project', null, { name: 'Bey County', aspect_ratio: '2.39:1' }),
      create('fx3', 'gear_item', 'p', { name: 'FX3 package', department: 'camera', quantity: 1, source: 'rental', day_rate: 350 }),
      create('cooke', 'gear_item', 'p', { name: 'Cooke 35', department: 'camera', quantity: 1, source: 'owned' }),
      create('loc', 'location', 'p', { name: 'Diner', address: '12 Route 9', latitude: 40.7, longitude: -74 }),
      create('d', 'shoot_day', 'p', { date: '2030-11-16', call_time: '07:00', wrap_time: '19:00', gear_ids: ['fx3', 'cooke'] }),
      create('cs', 'callsheet', 'd', { notes: 'Park behind' }),
      create('s1', 'scene', 'p', { number: '1', name: 'DINER', location_id: 'loc', int_ext: 'INT', day_night: 'NIGHT' }),
      create('a', 'shot', 's1', { number: '1A', lens_mm: 35, t_stop: 2.8, size: 'MS', shoot_day_id: 'd', status: 'need', gear_ids: ['fx3', 'cooke'], setup_id: 'u1' }),
      create('b', 'shot', 's1', { number: '1B', lens_mm: 50, shoot_day_id: 'd', status: 'need' }),
      create('u1', 'setup', 's1', { name: 'Window side' }),
    ],
    { now: () => new Date(at) },
  );
  const records = byId(await loadRecords(file));
  const basis = (department: string) => approvalBasis(records, 's1', department);
  // 3.18's rule (camera), 3.15's (sound) and 3.6b's (art): each read by its own rule after the upgrade too.
  const approvals = { camera: sign(basis('camera').current), sound: sign(basis('sound').v2), art: sign(basis('art').legacy) };
  await file.tx([{ sql: `UPDATE records SET props = json_set(props, '$.department_approvals', json(?)) WHERE id = 's1'`, params: [JSON.stringify(approvals)] }]);
  const sheet = callSheet(byId(await loadRecords(file)), 'p', 'd', undefined, zones);
  if (!sheet) throw new Error('no sheet');
  const fingerprint = await callSheetFingerprint(sheet, 'google', 'Bey County');
  await apply(
    file,
    [
      create('issue', 'media', 'cs', {
        kind: 'pdf',
        issue_version: 1,
        issued_at: at,
        issued_by: 'local',
        issued_zone: 'America/New_York',
        fingerprint,
        fingerprint_version: FINGERPRINT_VERSION,
        file: 'abc',
        source_name: 'Call sheet.pdf',
        byte_size: 5,
      }),
    ],
    { now: () => new Date(at) },
  );
  await file.close();
  return { path, fingerprint };
}

describe('schema 14: props only', () => {
  it('is the newest schema, with no table change and nothing rewritten', () => {
    expect(SCHEMA_VERSION).toBe(14);
    const fourteen = MIGRATIONS[13];
    expect(fourteen?.version).toBe(14);
    expect(fourteen?.statements).toEqual([]);
    expect(fourteen?.backfill).toBeUndefined();
  });

  it('opens a schema 13 file backed up, at 14, with every row as it was', async () => {
    const { path } = await v13File();
    const old = await nodeDriver.open(path);
    const before = await everything(old);
    const steps = (await log(old)).length;
    await old.close();
    project = await openProject(path, { driver: nodeDriver, backups: false, now: () => new Date(late) });
    expect(project.migration).toMatchObject({ from: 13, to: 14 });
    expect(readdirSync(folder.dir).some((name) => name.startsWith('Bey County.sbd.bak-v13-'))).toBe(true);
    const [version] = await project.file.query("SELECT value FROM meta WHERE key = 'schema_version'");
    expect(version?.value).toBe('14');
    const after = await everything(project.file);
    // Opening writes which app opened it last and the file's id, as any open does: those rows aside, identical.
    const strip = (tables: Record<string, unknown[]>) => ({
      ...tables,
      meta: (tables.meta ?? []).filter((row) => !['app_version', 'file_id', 'last_opened_by'].includes(String((row as { key: unknown }).key))),
    });
    expect(strip(after)).toEqual(strip(before));
    // No step in History: nothing to undo.
    expect(await log(project.file)).toHaveLength(steps);
  });

  it('keeps every approval current and the issued sheet unchanged: neither “Changed since approval” nor “Changed since issued”', async () => {
    const { path, fingerprint } = await v13File();
    project = await openProject(path, { driver: nodeDriver, backups: false, now: () => new Date(late) });
    const records = byId(await loadRecords(project.file));
    const approvals = sceneApprovals(records.s1?.props ?? {});
    for (const department of ['camera', 'sound', 'art']) {
      expect(approvalState(approvals[department] ?? [], approvalBasis(records, 's1', department)), department).toBe('approved');
    }
    const [latest] = callSheetIssues(records, 'd');
    expect(latest?.fingerprint).toBe(fingerprint);
    const sheet = callSheet(records, 'p', 'd', undefined, zones);
    if (!sheet || !latest) throw new Error('no sheet');
    expect(await changedSince(latest, sheet, 'google', 'Bey County')).toBe(false);
  });
});
