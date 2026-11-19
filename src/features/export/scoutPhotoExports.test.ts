import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../core/i18n';
import { imageStatements, type PreparedImage } from '../../core/media/store';
import type { Props, SbdRecord } from '../../core/model/record';
import { apply } from '../../core/ops/ops';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { projectJsonBytes, readProjectJson, type JsonBlob } from '../../core/storage/projectJson';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { shotListCsv } from './shotListCsv';

// What leaves the project of a scout photo (6.27). Only two exports can carry a location's photo: the lossless JSON
// (Project data and Full archive), which is the project itself, so it holds the photo's record with its four props and
// the stored picture's bytes exactly as stored, nothing added; and nothing else (no call sheet, board, deck or plan
// shows a location's photo). The CSV, a report, carries none of it. That the stored bytes themselves have no EXIF is
// proved where pictures are really encoded, in e2e/scoutPhotos.spec.ts. The place is made up: a point in the open sea.

const at = '2026-11-17T10:00:00.000Z';
const taken = { taken_at: '2026-11-03T16:42:07', taken_offset: '+02:00', gps_latitude: 12.51000123, gps_longitude: -45.25000456 };
/** What a stored picture is: bytes drawn again by the page. These stand for them (a JPEG's first and last markers, no APP1). */
const storedBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0, 4, 1, 2, 0xff, 0xd9]);
const thumbBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0, 3, 9, 0xff, 0xd9]);
const sha = 'c'.repeat(64);
const prepared: PreparedImage = {
  original: { sha256: sha, bytes: storedBytes, mime: 'image/jpeg', width: 800, height: 600, colorSpace: 'srgb' },
  thumbnail: { bytes: thumbBytes, mime: 'image/jpeg', width: 80, height: 60, longEdge: 640 },
};

let folder: TestFolder;
let project: Project;

beforeEach(async () => {
  setLocale('en');
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
});
afterEach(async () => {
  await project.close();
  folder.remove();
});

const create = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props) => ({ kind: 'create' as const, record: { id, type, parentId, sortKey: 'a', props } });

async function withScoutPhoto(): Promise<void> {
  const root = project.projectId;
  await apply(
    project.file,
    [
      create('loc1', 'location', root, { name: 'Quay', status: 'tbd', latitude: 12.51000123, longitude: -45.25000456, map_name: '12.51000, -45.25000', map_moved: true, light_photo_id: 'ph1' }),
      create('ph1', 'media', 'loc1', { kind: 'image', file: sha, mime: 'image/jpeg', width: 800, height: 600, color_space: 'srgb', source_name: 'quay-dusk.jpg', ...taken }),
      create('sc1', 'scene', root, { number: '1', name: 'Quay at dusk', int_ext: 'EXT', day_night: 'DAY', location_id: 'loc1' }),
      create('sh1', 'shot', 'sc1', { number: '1A', size: 'WS', action: 'The boat comes in.' }),
    ],
    { now: () => new Date(at), alsoWrite: imageStatements(prepared, new Date(at)) },
  );
}

const isBlob = (value: unknown): value is JsonBlob => typeof value === 'object' && value !== null && typeof (value as JsonBlob).base64 === 'string';

describe('a scout photo in the exports (6.27)', () => {
  for (const contents of ['project_data', 'full_archive'] as const) {
    it(`${contents}: the JSON carries the photo’s record with its four props, and the stored picture’s bytes exactly`, async () => {
      await withScoutPhoto();
      const data = readProjectJson(new TextDecoder().decode(await projectJsonBytes(project.file, new Date(at), undefined, undefined, contents)));
      const records = data.tables.records;
      const idAt = records?.columns.indexOf('id') ?? -1;
      const propsAt = records?.columns.indexOf('props') ?? -1;
      const row = records?.rows.find((r) => r[idAt] === 'ph1');
      // The JSON is the project, not an export for others: the photo's time and place are in it, every decimal.
      const props = row?.[propsAt];
      expect(typeof props === 'string' ? JSON.parse(props) : null).toMatchObject(taken);
      // The picture's bytes: the stored ones, byte for byte, in both tables; nothing is added on the way out.
      for (const [table, bytes] of [['media_files', storedBytes], ['thumbnails', thumbBytes]] as const) {
        const column = data.tables[table]?.columns.indexOf('bytes') ?? -1;
        const cells = (data.tables[table]?.rows ?? []).map((r) => r[column]);
        expect(cells).toHaveLength(1);
        const cell = cells[0];
        if (!isBlob(cell)) throw new Error(`${table}: no bytes`);
        expect([...Buffer.from(cell.base64, 'base64')]).toEqual([...bytes]);
      }
    });
  }

  it('the shot list CSV carries none of it: no time taken, no coordinates, no light reference', async () => {
    await withScoutPhoto();
    const rows = await project.file.query('SELECT id, type, parent_id, sort_key, props, trashed_at, trashed_by, created_at, updated_at FROM records');
    const records: Record<string, SbdRecord> = Object.fromEntries(
      rows.map((r) => [
        String(r.id),
        { id: String(r.id), type: r.type as SbdRecord['type'], parentId: r.parent_id === null ? null : String(r.parent_id), sortKey: String(r.sort_key), props: JSON.parse(String(r.props)) as Props, trashedAt: null, trashedBy: null, createdAt: String(r.created_at), updatedAt: String(r.updated_at) },
      ]),
    );
    const csv = shotListCsv(records, project.projectId, { kind: 'project' });
    // The frame and its location are there, by name.
    expect(csv).toContain('1A');
    expect(csv).toContain('Quay');
    for (const leak of ['12.51', '45.25', '2026-11-03', '16:42', '+02:00', 'ph1', 'quay-dusk', 'taken', 'gps', 'light_photo']) expect(csv, leak).not.toContain(leak);
  });
});
