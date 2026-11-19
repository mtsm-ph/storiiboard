import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../core/i18n';
import { loadPicture } from '../../core/media/decoded';
import { readOriginal } from '../../core/media/store';
import { apply, loadRecords } from '../../core/ops/ops';
import type { SbdRecord } from '../../core/model/record';
import { sceneLabel } from '../../core/model/storyboard';
import type { Statement } from '../../core/storage/driver';
import { createMemoryDriver } from '../../core/storage/memoryDriver';
import { createProject, openProject } from '../../core/storage/project';
import { importProjectJson, projectJsonBytes, readProjectJson, type JsonTable } from '../../core/storage/projectJson';
import { leftOutNote, leftOutPlaces } from './leftOutFiles';

// An import with damaged stored files imports the rest (6.27b round 3, Kevin Nov 18): a file whose bytes don't match
// its hash is left out with its thumbnails, under any name; the records that use it stay and show it missing; and the
// note counts them and names where they were used.

const wasm = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm');
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../../src-tauri/testdata/pictures/${name}`, import.meta.url)));
const at = '2026-11-18T12:00:00.000Z';

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A stored file's row, and a picture's thumbnail (the same bytes, enough here). */
function stored(sha256: string, bytes: Uint8Array, mime: string): Statement[] {
  const file: Statement = {
    sql: `INSERT OR IGNORE INTO media_files (id, sha256, bytes, mime, width, height, byte_size, color_space, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [`m-${sha256.slice(0, 6)}`, sha256, bytes, mime, 640, 345, bytes.length, 'display-p3', at, at],
  };
  if (!mime.startsWith('image/')) return [file];
  return [
    file,
    {
      sql: `INSERT OR IGNORE INTO thumbnails (id, sha256, long_edge, bytes, mime, width, height, created_at, updated_at)
        VALUES (?, ?, 640, ?, ?, 640, 345, ?, ?)`,
      params: [`t-${sha256.slice(0, 6)}`, sha256, bytes, mime, at, at],
    },
  ];
}

const picture = (file: string) => ({ kind: 'image', file, mime: 'image/jpeg', width: 640, height: 345 });
const pdf = (file: string, name: string, size: number) => ({ kind: 'pdf', file, source_name: name, byte_size: size });

/** Every blob in a JSON table as bytes, to look for damaged ones. */
const blobsOf = (table: JsonTable | undefined) =>
  (table?.rows ?? []).flatMap((row) => row.flatMap((cell) => (cell !== null && typeof cell === 'object' ? [Buffer.from(cell.base64, 'base64')] : [])));

afterEach(() => {
  setLocale('en');
});

describe('Import project data with damaged stored files (6.27b round 3)', () => {
  it('leaves out a frame’s, a board’s and a PDF’s damaged files, imports the rest, and says how many and where', async () => {
    const driver = await createMemoryDriver({ wasm });
    const project = await createProject('/memory/Quay.sbd', { driver, backups: false });
    const frameBytes = fixture('webkit-encoded-1.clean.jpg');
    const boardBytes = fixture('webkit-encoded-2.clean.jpg');
    const keptBytes = new Uint8Array([...frameBytes]);
    // A third picture, kept: the frame's with one byte inside its scan changed, so it is another picture, cleanly named.
    keptBytes[keptBytes.length - 10] = (keptBytes[keptBytes.length - 10] ?? 0) ^ 1;
    const damagedPdf = new TextEncoder().encode('%PDF-1.7\n% call sheet notes');
    const keptPdf = new TextEncoder().encode('%PDF-1.7\n% recce');
    const [frameSha, boardSha, keptSha, pdfSha, keptPdfSha] = await Promise.all([frameBytes, boardBytes, keptBytes, damagedPdf, keptPdf].map(sha256Hex));
    if (!frameSha || !boardSha || !keptSha || !pdfSha || !keptPdfSha) throw new Error('no hash');
    await project.file.tx([
      ...stored(frameSha, frameBytes, 'image/jpeg'),
      ...stored(boardSha, boardBytes, 'image/jpeg'),
      ...stored(keptSha, keptBytes, 'image/jpeg'),
      ...stored(pdfSha, damagedPdf, 'application/pdf'),
      ...stored(keptPdfSha, keptPdf, 'application/pdf'),
    ]);
    const root = project.projectId;
    await apply(project.file, [
      { kind: 'create', record: { id: 'sc4', type: 'scene', parentId: root, sortKey: 'a', props: { number: '4' } } },
      { kind: 'create', record: { id: 'f4a', type: 'shot', parentId: 'sc4', sortKey: 'a', props: { number: '4A' } } },
      { kind: 'create', record: { id: 'p-frame', type: 'media', parentId: 'f4a', sortKey: 'a', props: picture(frameSha) } },
      { kind: 'create', record: { id: 'f4b', type: 'shot', parentId: 'sc4', sortKey: 'b', props: { number: '4B' } } },
      { kind: 'create', record: { id: 'p-kept', type: 'media', parentId: 'f4b', sortKey: 'a', props: picture(keptSha) } },
      { kind: 'create', record: { id: 'board', type: 'board', parentId: root, sortKey: 'b', props: { name: 'Mood' } } },
      { kind: 'create', record: { id: 'item', type: 'board_item', parentId: 'board', sortKey: 'a', props: { kind: 'picture' } } },
      { kind: 'create', record: { id: 'p-board', type: 'media', parentId: 'item', sortKey: 'a', props: picture(boardSha) } },
      { kind: 'create', record: { id: 'diner', type: 'location', parentId: root, sortKey: 'c', props: { name: 'Diner' } } },
      { kind: 'create', record: { id: 'pdf', type: 'media', parentId: 'diner', sortKey: 'a', props: pdf(pdfSha, 'Notes.pdf', damagedPdf.length) } },
      { kind: 'create', record: { id: 'pdf-kept', type: 'media', parentId: root, sortKey: 'd', props: pdf(keptPdfSha, 'Recce.pdf', keptPdf.length) } },
    ]);
    const data = readProjectJson(new TextDecoder().decode(await projectJsonBytes(project.file, new Date(at), undefined, undefined, 'project_data')));
    await project.close();

    // One byte changed in each damaged file's bytes in the JSON: its name no longer says it.
    const files = data.tables.media_files;
    if (!files) throw new Error('no media_files');
    const shaAt = files.columns.indexOf('sha256');
    const bytesAt = files.columns.indexOf('bytes');
    const damaged = new Set([frameSha, boardSha, pdfSha]);
    const damagedBytes: Buffer[] = [];
    const rows = files.rows.map((row) => {
      const cell = row[bytesAt];
      const sha = row[shaAt];
      if (typeof sha !== 'string' || !damaged.has(sha) || cell === null || typeof cell !== 'object') return row;
      const changed = Buffer.from(cell.base64, 'base64');
      changed[5] = (changed[5] ?? 0) ^ 1;
      damagedBytes.push(changed);
      return row.map((value, i) => (i === bytesAt ? { base64: changed.toString('base64') } : value));
    });
    expect(damagedBytes).toHaveLength(3);
    const tampered = { ...data, tables: { ...data.tables, media_files: { ...files, rows } } };

    const report = await importProjectJson(driver, '/memory/Quay imported.sbd', tampered, new Date(at));
    expect(report.pictures).toBe(3);
    expect(report.files).toBe(2);
    expect(new Set(report.leftOut.map((f) => `${f.sha256}:${String(f.picture)}`))).toEqual(
      new Set([`${frameSha}:true`, `${boardSha}:true`, `${pdfSha}:false`]),
    );

    const imported = await openProject('/memory/Quay imported.sbd', { driver, backups: false });
    // The damaged bytes are in no table, under any name; the kept files came back as they were.
    const again = readProjectJson(new TextDecoder().decode(await projectJsonBytes(imported.file, new Date(at))));
    const everyBlob = Object.values(again.tables).flatMap(blobsOf);
    for (const bytes of damagedBytes) expect(everyBlob.some((blob) => blob.equals(bytes))).toBe(false);
    const [rowCount] = await imported.file.query('SELECT count(*) AS n FROM media_files');
    const [thumbCount] = await imported.file.query('SELECT count(*) AS n FROM thumbnails');
    expect([Number(rowCount?.n), Number(thumbCount?.n)]).toEqual([2, 1]);
    expect((await readOriginal(imported.file, keptSha))?.bytes).toEqual(keptBytes);
    expect((await readOriginal(imported.file, keptPdfSha))?.bytes).toEqual(keptPdf);
    // The records that used them stay, unchanged, and show them missing: no bytes under their names.
    const records = Object.fromEntries((await loadRecords(imported.file)).map((r) => [r.id, r]));
    expect(records['p-frame']?.props).toEqual(picture(frameSha));
    expect(records['p-board']?.props).toEqual(picture(boardSha));
    expect(records.pdf?.props).toEqual(pdf(pdfSha, 'Notes.pdf', damagedPdf.length));
    for (const sha of damaged) expect(await readOriginal(imported.file, sha)).toBeNull();
    // What the board's picture item and the frame read to draw (PictureNode, FrameImage): gone, so each shows it missing.
    expect(await loadPicture(imported.file, boardSha, 'thumbnail')).toEqual({ status: 'gone' });
    expect(await loadPicture(imported.file, frameSha, 'thumbnail')).toEqual({ status: 'gone' });
    expect((await loadPicture(imported.file, keptSha, 'thumbnail')).status).not.toBe('gone');

    // The note: counts, and the places, each by where a person finds it.
    const places = [`${sceneLabel('4')} · Frame 4A`, 'Board · Mood', 'Location · Diner'];
    expect(new Set(leftOutPlaces(records, imported.projectId, report))).toEqual(new Set(places));
    const note = leftOutNote(records, imported.projectId, report);
    expect(note.startsWith('2 of 3 pictures were damaged and left out. 1 of 2 files was damaged and left out. They show as missing in: ')).toBe(true);
    for (const place of places) expect(note).toContain(place);
    setLocale('es');
    expect(leftOutNote(records, imported.projectId, report)).toContain('2 de 3 imágenes estaban dañadas y se dejaron fuera. 1 de 2 archivos estaba dañado y se dejó fuera.');
    await imported.close();
  });

  it('names at most 10 places, then says how many more; Copy list’s text names every one (round 4)', () => {
    const records: Record<string, SbdRecord> = {};
    const add = (id: string, type: SbdRecord['type'], parentId: string | null, props: SbdRecord['props']) => {
      records[id] = { id, type, parentId, sortKey: id, props, trashedAt: null, trashedBy: null, createdAt: at, updatedAt: at };
    };
    add('p', 'project', null, {});
    add('sc1', 'scene', 'p', { number: '1' });
    const leftOut = [];
    for (let i = 0; i < 12; i += 1) {
      const sha = i.toString(16).padStart(64, '0');
      add(`f${String(i)}`, 'shot', 'sc1', { number: `1${String.fromCharCode(65 + i)}` });
      add(`m${String(i)}`, 'media', `f${String(i)}`, picture(sha));
      leftOut.push({ sha256: sha, picture: true });
    }
    const report = { leftOut, pictures: 40, files: 0 };
    expect(leftOutPlaces(records, 'p', report)).toHaveLength(12);
    const scene = sceneLabel('1');
    const named = Array.from({ length: 10 }, (_, i) => `${scene} · Frame 1${String.fromCharCode(65 + i)}`).join(', ');
    expect(leftOutNote(records, 'p', report)).toBe(`12 of 40 pictures were damaged and left out. They show as missing in: ${named} and 2 more.`);
    // Copy list's text (round 4, Kevin Nov 18): the counts and every place, the eleventh and twelfth too.
    const every = Array.from({ length: 12 }, (_, i) => `${scene} · Frame 1${String.fromCharCode(65 + i)}`).join(', ');
    expect(leftOutNote(records, 'p', report, true)).toBe(`12 of 40 pictures were damaged and left out. They show as missing in: ${every}.`);
    setLocale('es');
    expect(leftOutNote(records, 'p', report)).toContain(' y 2 más.');
    expect(leftOutNote(records, 'p', report, true)).not.toContain(' más');
  });

  it('says nothing when every stored file is the one its name says', () => {
    expect(leftOutNote({}, 'p', { leftOut: [], pictures: 4, files: 1 })).toBe('');
  });
});
