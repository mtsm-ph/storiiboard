import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { allChecks, CHECK_KINDS } from '../../src/core/checks/allChecks';
import type { Props, SbdRecord } from '../../src/core/model/record';
import type { Forecast, ForecastEntry } from '../../src/core/net/weather';
import { NO_SLATE_NUMBERS } from '../../src/core/model/shotNumbers';
import { readChangeFile } from '../../src/core/storage/changeFile';
import { makeTestFolder } from '../../src/core/storage/testFolder';
import { buildChangeFile, changeFileName, clientName } from '../src/changeFile';
import { FolderRefused, writeChangeFile } from '../src/changeFolder';
import { runChecks } from '../src/checks';
import type { ProjectData } from '../src/project';

// The write's own steps (7.6), and run_checks against allChecks: a write that fails leaves no temporary file and never
// writes over a file that's there; the client's name is cleaned for the file and its name; and run_checks gives
// allChecks' own findings for a project tripping each of the eight kinds (7.4's), in the tile's words, with no contact
// detail. Made-up people and places only.

const folder = makeTestFolder();

afterAll(() => {
  folder.remove();
});

describe('the change file and its write (7.6)', () => {
  it('leaves no temporary file when a write fails, and never writes over a file of the same name', () => {
    const dir = folder.path('Harbor Lights Suggestions');
    mkdirSync(dir);
    const bytes = new TextEncoder().encode('{}');
    expect(() => {
      writeChangeFile(dir, 'a.sbdchanges', bytes, {
        afterTemp: () => {
          throw new Error('the disk is full');
        },
      });
    }).toThrow(FolderRefused);
    expect(readdirSync(dir)).toEqual([]);
    writeFileSync(`${dir}/b.sbdchanges`, 'kept');
    expect(() => {
      writeChangeFile(dir, 'b.sbdchanges', bytes);
    }).toThrow('A change file of that name is already there: nothing was written. Try again.');
    expect(readdirSync(dir)).toEqual(['b.sbdchanges']);
    expect(readFileSync(`${dir}/b.sbdchanges`, 'utf8')).toBe('kept');
    writeChangeFile(dir, 'c.sbdchanges', bytes);
    expect(readdirSync(dir).sort()).toEqual(['b.sbdchanges', 'c.sbdchanges']);
    // Only a plain .sbdchanges name, in the folder itself.
    for (const bad of ['../x.sbdchanges', 'x.json', 'a:b.sbdchanges', '']) {
      expect(() => {
        writeChangeFile(dir, bad, bytes);
      }).toThrow(FolderRefused);
    }
  });

  it('names the file by this computer’s time, the client and the id, and keeps the client’s name as text', () => {
    const at = new Date(2026, 10, 21, 9, 5, 7);
    expect(changeFileName(at, 'Claude Desktop', '8d0f3c52-5a0e-4c47-9a7e-2b1f0c6e9a11')).toBe('2026-11-21 09-05-07 Claude Desktop 8d0f3c52.sbdchanges');
    expect(changeFileName(at, '../../evil\\name:here', '8d0f3c52-5a0e-4c47-9a7e-2b1f0c6e9a11')).toBe('2026-11-21 09-05-07 evilnamehere 8d0f3c52.sbdchanges');
    expect(changeFileName(at, '   ', 'ab12cd34-0000-4000-8000-000000000000')).toBe('2026-11-21 09-05-07 assistant ab12cd34.sbdchanges');
    expect(clientName({ name: 'claude-ai', title: 'Claude Desktop' })).toBe('Claude Desktop');
    expect(clientName({ name: 'Robin‮​bot' })).toBe('Robinbot');
    expect(clientName({ name: 'Call +1 555 0123' })).toBe('Call [contact left out]');
    expect(clientName({ name: 'x'.repeat(500) })).toHaveLength(100);
    expect(clientName(undefined)).toBe('MCP client');
    const built = buildChangeFile({ projectId: 'p', projectName: 'Harbor Lights', client: 'Claude Desktop', suggestions: [], at, id: '8d0f3c52-5a0e-4c47-9a7e-2b1f0c6e9a11' });
    const read = readChangeFile(built.bytes, 'p');
    expect(read.ok && read.file.createdBy).toBe('mcp');
  });
});

// The allChecks test's own project (src/core/checks/allChecks.test.ts), with contact details added to search for.
const at = '2030-11-01T10:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey: id,
  props,
  trashedAt: null,
  trashedBy: null,
  createdAt: at,
  updatedAt: at,
});
const pier = { name: 'Harbor Pier', address: '1 Pier Road', contact_name: 'Robin Vale', contact_phone: '+1 555 0107', parking: 'Lot A', map_name: 'Pier', latitude: 40.7128, longitude: -74.006, time_zone: 'America/New_York' };
const hour = (h: number): string => `2030-11-16T${String(h).padStart(2, '0')}:00:00Z`;
const entry = (time: string, rain: number): ForecastEntry => ({ time, temperature: 8, wind: 3, rain1h: rain, rain6h: null, symbol1h: null, symbol6h: null });
// Past its Expires when the test runs, so run_checks says it read an old one.
const forecast: Forecast = { expires: '2026-01-01T00:00:00Z', lastModified: null, entries: Array.from({ length: 19 }, (_, i) => entry(hour(5 + i), 5 + i === 16 ? 2 : 0)) };

function tripped(): Record<string, SbdRecord> {
  const list = [
    record('p', 'project', null, { title: 'Harbor Lights' }),
    record('pier', 'location', 'p', pier),
    record('yard', 'location', 'p', { name: 'Boat Yard', contact_name: 'Sam Ortiz', contact_email: 'yard@example.com' }),
    record('d1', 'shoot_day', 'p', { date: '2030-11-16', call_time: '10:00', wrap_time: '14:00', people_ids: ['dir', 'robin', 'sam', 'hana', 'lee'], gear_ids: ['fx3'] }),
    record('fx3', 'gear_item', 'p', { name: 'FX3 package' }),
    record('slider', 'gear_item', 'p', { name: 'Slider' }),
    record('s1', 'scene', 'p', { number: '1', int_ext: 'EXT', day_night: 'DUSK', location_id: 'pier' }),
    record('s2', 'scene', 'p', { number: '2', int_ext: 'INT', day_night: 'DAY', location_id: 'yard' }),
    record('u1', 'setup', 's1', { name: '' }),
    record('own', 'plan', 'u1', { kind: 'setup', name: '' }),
    record('cam', 'plan_item', 'own', { kind: 'camera', icon: 'camera/camera', x: 0, y: 0, width: 0.4, height: 0.4, rotation: 0, shot_ids: ['a'], lens_mm: 50 }),
    record('a', 'shot', 's1', { number: '1A', status: 'need', shoot_day_id: 'd1', gear_ids: ['fx3', 'slider'], setup_id: 'u1', lens_mm: 35 }),
    record('b', 'shot', 's2', { number: '2A', status: 'need', shoot_day_id: 'd1' }),
    record('dir', 'person', 'p', { name: 'Dana Reyes', departments: ['direction'], phone: '+1 555 0144', email: 'dana@example.com' }),
    record('robin', 'person', 'p', { name: 'Robin Vale', departments: ['camera'], phone: '+1 555 0123', email: 'robin.vale@example.com' }),
    record('away', 'availability', 'robin', { from: '2030-11-16', to: '2030-11-16', state: 'unavailable', note: '' }),
    record('sam', 'person', 'p', { name: 'Sam Ortiz', departments: ['sound'], phone: '+1 555 0188' }),
    record('hana', 'person', 'p', { name: 'Hana Ito', departments: ['hmu'] }),
    record('wen', 'person', 'p', { name: 'Wen Li', departments: ['wardrobe'] }),
    record('lee', 'person', 'p', { name: 'Lee Park', role: 'cast', departments: ['cast'] }),
    record('cs', 'callsheet', 'd1', { person_times: { lee: { hmu_ready: '10:10' } } }),
  ];
  return Object.fromEntries(list.map((r) => [r.id, r]));
}

describe('run_checks (7.6)', () => {
  it('gives allChecks’ own findings for a project tripping each kind, in the tile’s words, with no contact detail', () => {
    const records = tripped();
    const forecasts = new Map([['pier', forecast]]);
    const data: ProjectData = { path: '', name: 'Harbor Lights', projectId: 'p', schemaVersion: 0, records, seen: {}, slate: NO_SLATE_NUMBERS, forecasts, forecastsFetchedAt: new Map([['pier', '2030-11-15T08:00:00Z']]) };
    const answer = runChecks({ data });
    // The function the tile runs, with what the server holds: the file's forecasts and no zone looked up.
    const expected = allChecks(records, 'p', { forecasts, zones: new Map() });
    const findings = answer.findings as { id: string; kind: string; words: string; check: string; target: Record<string, unknown> }[];
    expect(findings.map((f) => f.id)).toEqual(expected.findings.map((f) => f.id));
    expect(findings.map((f) => f.kind)).toEqual([...CHECK_KINDS]);
    for (const f of findings) {
      expect(f.words.length, f.id).toBeGreaterThan(10);
      expect(f.check.length, f.id).toBeGreaterThan(3);
    }
    const byKind = (kind: string) => findings.find((f) => f.kind === kind);
    expect(byKind('gear-not-on-day')?.target).toEqual({ kind: 'frame', frame: { id: 'a', number: '1A' }, scene: { id: 's1', number: '1' } });
    expect(byKind('plan-lens-differs')?.target).toEqual({ kind: 'plan', scene: { id: 's1', number: '1' }, setup: { id: 'u1', number: 1 }, item_ids: ['cam'] });
    expect(byKind('location-missing')?.target).toEqual({ kind: 'location', location: { id: 'yard', name: 'Boat Yard' } });
    expect(byKind('unavailable-on-day')?.words).toContain('Robin Vale');
    // The forecast is past its Expires: said, without the time it was fetched in this computer's zone.
    expect(answer.old_forecasts).toEqual([
      { id: 'forecast-old:d1:pier', day: { id: 'd1', number: 1, date: '2030-11-16' }, location: { id: 'pier', name: 'Harbor Pier' }, fetched_at: '2030-11-15T08:00:00Z', words: expect.stringContaining('Harbor Pier') as unknown },
    ]);
    const text = JSON.stringify(answer);
    for (const value of ['555 0107', '555 0123', '555 0144', '555 0188', 'robin.vale@example.com', 'dana@example.com', 'yard@example.com', '1 Pier Road', '40.7128', '-74.006']) expect(text, value).not.toContain(value);
  });

  it('says what it skipped and why: a location with no zone typed gets none looked up, nor this computer’s', () => {
    const records = tripped();
    const pierRecord = records.pier as SbdRecord;
    records.pier = { ...pierRecord, props: Object.fromEntries(Object.entries(pierRecord.props).filter(([key]) => key !== 'time_zone')) };
    const data: ProjectData = { path: '', name: 'Harbor Lights', projectId: 'p', schemaVersion: 0, records, seen: {}, slate: NO_SLATE_NUMBERS };
    const skipped = runChecks({ data }).skipped as { reason: string; words: string; location: { name: string } | null }[];
    expect(skipped.map((s) => s.reason)).toContain('no-zone');
    expect(skipped.find((s) => s.reason === 'no-zone')?.location?.name).toBe('Harbor Pier');
  });
});
