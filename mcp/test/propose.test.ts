import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, truncateSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ASSISTANT_TOOLS } from '../../src/core/model/assistantTools';
import type { SbdRecord } from '../../src/core/model/record';
import { readSuggestion, reviewSuggestion } from '../../src/core/model/suggestion';
import { apply, type Change } from '../../src/core/ops/ops';
import { readChangeFile } from '../../src/core/storage/changeFile';
import { nodeDriver } from '../../src/core/storage/nodeDriver';
import { openProject } from '../../src/core/storage/project';
import { makeTestFolder } from '../../src/core/storage/testFolder';
import { FolderRefused, MARKER_FORMAT, MARKER_NAME } from '../src/changeFolder';
import { readProject } from '../src/project';
import { suggestGearForDay, suggestTrash } from '../src/propose';
import { writeProposal } from '../src/write';
import { CONTACTS, IDS, writeHarborLights } from './fixture';

// The propose tools over stdio (7.6), driven by the SDK's own client named as Claude Desktop names itself, against
// "Harbor Lights" (made-up people: Robin Vale, Sam Ortiz) with a note in scene 12. The server's first and only write:
// each call one new change file in the project's own Suggestions folder, which 7.1's reader accepts byte for byte and
// whose suggestions 7.0's reader reads unflagged; a refused value writing nothing at all; the folder made with its
// marker and nothing else; another project's folder refused; and nothing else beside the project ever changed.

const mcp = join(import.meta.dirname, '..');
const out = join(mcp, '..', 'test-results', '7.6', 'dist-test');
const server = join(out, 'server.js');
const fromMcp = pathToFileURL(join(import.meta.dirname, 'fromMcp.mjs')).href;
const base = makeTestFolder();
const original = base.path('Harbor Lights.sbd');
const NOTE = '30000000-0000-4000-8000-000000000001';
const CLIENT = 'Claude Desktop';
const SUGGESTIONS = 'Harbor Lights Suggestions';

const folders: ReturnType<typeof makeTestFolder>[] = [];

/** A fresh copy of the fixture in a folder of its own: the project and that folder. */
function freshProject(): { dir: string; path: string } {
  const folder = makeTestFolder();
  folders.push(folder);
  const path = folder.path('Harbor Lights.sbd');
  copyFileSync(original, path);
  return { dir: folder.dir, path };
}

async function connect(path: string, name = CLIENT): Promise<Client> {
  const c = new Client({ name, version: '1.0.0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: ['--import', fromMcp, server, path], stderr: 'ignore' }));
  return c;
}

async function call(c: Client, name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const result = await c.callTool({ name, arguments: args });
  const content = result.content as { type: string; text?: string }[];
  return { text: content.map((part) => part.text ?? '').join(''), isError: result.isError === true };
}

/** What a folder holds: every name, its size and its last change. */
function listing(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .map((name) => {
      const stat = statSync(join(dir, name));
      return `${name}|${stat.isDirectory() ? 'dir' : String(stat.size)}|${stat.isDirectory() ? '' : String(stat.mtimeMs)}`;
    });
}

/** Every propose tool, called as an assistant would call it on the fixture. */
const PROPOSE_CALLS: { name: string; arguments: Record<string, unknown>; count: number }[] = [
  { name: 'suggest_shot_changes', arguments: { changes: [{ frame: '12B', fields: { size: 'MCU', lens_mm: 85, t_stop: 4, action: 'Her hands, closer.' } }], note: 'Tighter for the count.' }, count: 1 },
  { name: 'suggest_new_shots', arguments: { scene: '12', after: '12A', frames: [{ size: 'INSERT', action: 'The till drawer.' }, { size: 'CU', location: 'Pier 9' }] }, count: 2 },
  { name: 'suggest_new_shots', arguments: { new_scene: { name: 'Pier at night', int_ext: 'EXT', day_night: 'NIGHT', location: 'Pier 9' }, frames: [{ size: 'WS' }, { size: 'MS' }] }, count: 3 },
  { name: 'suggest_reorder', arguments: { moves: [{ frame: '12B', after: 'start' }, { scene: '12', note: 1, after: '12B' }] }, count: 2 },
  { name: 'suggest_gear_for_day', arguments: { day: '2026-11-18', add: ['Boom kit Sennheiser'], remove: ['SkyPanel S60'] }, count: 1 },
  {
    name: 'suggest_call_sheet_notes',
    arguments: { day: '1', notes: 'Breakfast from 05:00.', call_time: '05:30', department_calls: { sound: '06:30' }, person_times: { 'Sam Ortiz': { hmu_ready: '05:45' } } },
    count: 2,
  },
  { name: 'suggest_trash', arguments: { items: [{ frame: '12B' }, { scene: '12', note: 1 }] }, count: 2 },
];

beforeAll(async () => {
  mkdirSync(out, { recursive: true });
  const built = spawnSync(process.execPath, [join(mcp, '..', 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', 'vite.config.ts', '--outDir', out, '--emptyOutDir'], {
    cwd: mcp,
    encoding: 'utf8',
  });
  expect(built.status, built.stderr).toBe(0);
  await writeHarborLights(original);
  // A note at the start of scene 12, for the reorder and the trash.
  const project = await openProject(original, { driver: nodeDriver, backups: false });
  await apply(project.file, [{ kind: 'create', record: { id: NOTE, type: 'note', parentId: IDS.scene12, sortKey: 'a0000', props: { text: 'Mara hums.' } } }]);
  await project.close();
}, 120_000);

afterAll(() => {
  for (const folder of folders) folder.remove();
  base.remove();
});

/** The change files in a project's Suggestions folder, by name. */
const changeFiles = (dir: string, folder = SUGGESTIONS): string[] => (existsSync(join(dir, folder)) ? readdirSync(join(dir, folder)).filter((n) => n.endsWith('.sbdchanges')).sort() : []);

describe('the propose tools over stdio (7.6)', () => {
  it('lists every tool of the one list, the read and check tools read-only, the propose tools writing; docs/MCP.md has each', async () => {
    const { path } = freshProject();
    const c = await connect(path);
    try {
      const { tools } = await c.listTools();
      expect(tools.map((t) => t.name)).toEqual(ASSISTANT_TOOLS.map((t) => t.name));
      for (const tool of tools) {
        const kind = ASSISTANT_TOOLS.find((t) => t.name === tool.name)?.kind;
        expect(tool.annotations?.readOnlyHint, tool.name).toBe(kind !== 'propose');
        expect(tool.annotations?.destructiveHint, tool.name).toBe(false);
        expect(tool.annotations?.openWorldHint, tool.name).toBe(false);
      }
    } finally {
      await c.close();
    }
    const docs = readFileSync(join(mcp, '..', 'docs', 'MCP.md'), 'utf8');
    for (const tool of ASSISTANT_TOOLS) expect(docs, tool.name).toContain(`### ${tool.name}\n`);
  });

  it('writes one change file per call that 7.1’s reader accepts and whose suggestions 7.0’s reader reads unflagged', async () => {
    const { dir, path } = freshProject();
    const data = await readProject(path);
    const c = await connect(path);
    try {
      const ids = new Set<string>();
      for (const { name, arguments: args, count } of PROPOSE_CALLS) {
        const before = changeFiles(dir);
        const answer = await call(c, name, args);
        expect(answer.isError, `${name} ${answer.text}`).toBe(false);
        const after = changeFiles(dir);
        const added = after.filter((n) => !before.includes(n));
        expect(added, name).toHaveLength(1);
        const fileName = added[0] ?? '';
        expect(fileName, name).toMatch(/^\d{4}-\d\d-\d\d \d\d-\d\d-\d\dZ Claude Desktop [0-9a-f]{8}\.sbdchanges$/);
        const bytes = readFileSync(join(dir, SUGGESTIONS, fileName));
        const json = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
        expect(json).toMatchObject({ format: 'storiiboard.changes', version: 1, project_id: data.projectId, project_name: 'Harbor Lights', created_by: 'mcp', people: [{ id: 'a', name: CLIENT, role: 'assistant' }] });
        const read = readChangeFile(new Uint8Array(bytes), data.projectId);
        if (!read.ok) throw new Error(`${name}: refused ${read.refusal.kind}`);
        expect(read.file.suggestions, name).toHaveLength(count);
        expect(fileName.slice(-19, -11), name).toBe(read.file.id.slice(0, 8));
        ids.add(read.file.id);
        // As the app will hold them: each read by 7.0 against the project, beside the others of its file.
        const records: Record<string, SbdRecord> = { ...data.records };
        for (const s of read.file.suggestions) {
          records[s.id] = { id: s.id, type: 'suggestion', parentId: data.projectId, sortKey: 'z', props: s.props, trashedAt: null, trashedBy: null, createdAt: '2026-11-21T10:00:00.000Z', updatedAt: '2026-11-21T10:00:00.000Z' };
        }
        for (const s of read.file.suggestions) {
          const record = records[s.id] as SbdRecord;
          expect(readSuggestion(record).unknown, name).toEqual([]);
          expect(readSuggestion(record).source, name).toBe('mcp');
          const review = reviewSuggestion(records, data.projectId, s.id, data.slate);
          const flags = (review?.flags ?? []).filter((f) => f.kind !== 'waiting' && f.kind !== 'waiting_after');
          expect(flags, `${name} ${JSON.stringify(review?.flags)}`).toEqual([]);
          if (!review?.flags.some((f) => f.kind === 'waiting' || f.kind === 'waiting_after')) expect(review?.canApply, name).toBe(true);
        }
        // What it says back names the change file by its id and the folder by its name, never the file's name or path, and
        // what each suggestion would do; no contact detail.
        const said = JSON.parse(answer.text) as { written: Record<string, unknown> };
        expect(said.written).toEqual({ folder: SUGGESTIONS, folder_made: expect.any(Boolean) as unknown, change_file_id: read.file.id, suggestions: count });
        expect(answer.text, name).not.toContain(fileName);
        expect(answer.text, name).not.toContain(dir);
        for (const value of Object.values(CONTACTS).map(String)) expect(answer.text, name).not.toContain(value);
      }
      expect(ids.size).toBe(PROPOSE_CALLS.length);
    } finally {
      await c.close();
    }
  });

  it('refuses a value it can’t suggest in words, and writes nothing anywhere', async () => {
    const { dir, path } = freshProject();
    const bytes = readFileSync(path);
    const beside = listing(dir);
    const c = await connect(path);
    try {
      // Outside the assistant's scope: a frame's number is the project's own rule.
      const outside = await call(c, 'suggest_shot_changes', { changes: [{ frame: '12B', fields: { number: '12Z' } }] });
      expect(outside.isError).toBe(true);
      expect(outside.text).toMatch(/^Nothing was written\. SC 12 · 12B: /);
      // A phone number typed into a frame's action.
      const phone = await call(c, 'suggest_shot_changes', { changes: [{ frame: '12B', fields: { action: 'Call the pier on 555 867 5309 first.' } }] });
      expect(phone).toEqual({ isError: true, text: 'Nothing was written. SC 12 · 12B: action holds what reads as a phone number, an email, an address, coordinates or a map link. Contact details are never suggested: leave them out.' });
      // One the project stores, typed again, in a note.
      const stored = await call(c, 'suggest_trash', { items: [{ frame: '12B' }], note: `Robin says so (${CONTACTS.robinEmail}).` });
      expect(stored.isError).toBe(true);
      expect(stored.text).toContain('the note holds what reads as');
      // A focal length outside the lens picked for 12A (a Cooke S4 32 prime).
      const lens = await call(c, 'suggest_shot_changes', { changes: [{ frame: '12A', fields: { lens_mm: 50 } }] });
      expect(lens.isError).toBe(true);
      expect(lens.text).toMatch(/^Nothing was written\. SC 12 · 12A: .*lens/i);
      // A size the board doesn't know, in a new frame.
      const size = await call(c, 'suggest_new_shots', { scene: '12', frames: [{ size: 'HUGE' }] });
      expect(size.isError).toBe(true);
      expect(size.text).toMatch(/^Nothing was written\./);
      // A frame, a day and gear that aren't there.
      expect((await call(c, 'suggest_trash', { items: [{ frame: '99Z' }] })).text).toBe('There\'s no frame numbered "99Z". list_shots lists them.');
      expect((await call(c, 'suggest_gear_for_day', { day: '7', add: ['Boom kit Sennheiser'] })).text).toBe('There\'s no shoot day "7". The days are 1 (2026-11-18).');
      expect((await call(c, 'suggest_gear_for_day', { day: '1', add: ['Fog machine'] })).text).toBe("There's no gear item of that name in the catalogue. list_gear lists it.");
      // Already as suggested: nothing to change.
      const same = await call(c, 'suggest_shot_changes', { changes: [{ frame: '12B', fields: { size: 'CU' } }] });
      expect(same.isError).toBe(true);
      // A wrong argument, in our words.
      expect(await call(c, 'suggest_trash', { items: 'all' })).toEqual({ isError: true, text: 'suggest_trash: items is a list of { frame: "12A" }, { scene: "12" } or { scene: "12", note: 1 }, at most 200.' });
    } finally {
      await c.close();
    }
    expect(existsSync(join(dir, SUGGESTIONS))).toBe(false);
    expect(listing(dir)).toEqual(beside);
    expect(readFileSync(path).equals(bytes)).toBe(true);
  });

  it('makes the folder with its marker when it is missing, and changes nothing else beside the project', async () => {
    const { dir, path } = freshProject();
    const bytes = readFileSync(path);
    const beside = listing(dir);
    expect(beside.map((l) => l.split('|')[0])).toEqual(['Harbor Lights.sbd']);
    const data = await readProject(path);
    const c = await connect(path);
    try {
      expect((await call(c, 'suggest_trash', { items: [{ frame: '12B' }] })).isError).toBe(false);
    } finally {
      await c.close();
    }
    // Beside the project: the project as it was, and the one folder.
    expect(listing(dir).filter((l) => !l.startsWith(`${SUGGESTIONS}|`))).toEqual(beside);
    expect(readdirSync(dir).sort()).toEqual(['Harbor Lights.sbd', SUGGESTIONS].sort());
    expect(readFileSync(path).equals(bytes)).toBe(true);
    // In the folder: its marker, as 7.1 reads it, and the one change file; no temporary file.
    const inside = readdirSync(join(dir, SUGGESTIONS)).sort();
    expect(inside).toHaveLength(2);
    expect(inside.filter((n) => n !== MARKER_NAME)[0]).toMatch(/\.sbdchanges$/);
    expect(JSON.parse(readFileSync(join(dir, SUGGESTIONS, MARKER_NAME), 'utf8'))).toEqual({ format: MARKER_FORMAT, project_id: data.projectId, project_name: 'Harbor Lights' });
  });

  it('writes two files with two ids for two calls, and never repeats a name', async () => {
    const { dir, path } = freshProject();
    const c = await connect(path);
    try {
      for (let i = 0; i < 6; i += 1) expect((await call(c, 'suggest_trash', { items: [{ frame: '12B' }] })).isError).toBe(false);
    } finally {
      await c.close();
    }
    const names = changeFiles(dir);
    expect(names).toHaveLength(6);
    const ids = names.map((n) => (JSON.parse(readFileSync(join(dir, SUGGESTIONS, n), 'utf8')) as { id: string }).id);
    expect(new Set(ids).size).toBe(6);
    expect(new Set(names.map((n) => n.slice(-19, -11))).size).toBe(6);
  });

  it('refuses a folder of the project’s name that is another project’s, writing nothing', async () => {
    const { dir, path } = freshProject();
    mkdirSync(join(dir, SUGGESTIONS));
    const marker = JSON.stringify({ format: MARKER_FORMAT, project_id: '6f1c0d2e-8a4b-4c3d-9e2f-1a0b9c8d7e6f', project_name: 'Saltmarsh' });
    writeFileSync(join(dir, SUGGESTIONS, MARKER_NAME), marker);
    const before = listing(join(dir, SUGGESTIONS));
    const c = await connect(path);
    try {
      expect(await call(c, 'suggest_trash', { items: [{ frame: '12B' }] })).toEqual({
        isError: true,
        text: `The folder “${SUGGESTIONS}” beside the project is for another project, Saltmarsh: nothing was written.`,
      });
    } finally {
      await c.close();
    }
    expect(listing(join(dir, SUGGESTIONS))).toEqual(before);
  });

  it('refuses a file where the folder would be', async () => {
    const { dir, path } = freshProject();
    writeFileSync(join(dir, SUGGESTIONS), 'not a folder');
    const c = await connect(path);
    try {
      const answer = await call(c, 'suggest_trash', { items: [{ frame: '12B' }] });
      expect(answer.isError).toBe(true);
      expect(answer.text).toContain('nothing was written');
    } finally {
      await c.close();
    }
    expect(readFileSync(join(dir, SUGGESTIONS), 'utf8')).toBe('not a folder');
  });

  it('writes into a renamed project’s folder found by its marker, never making a second one', async () => {
    const { dir, path } = freshProject();
    const data = await readProject(path);
    const old = 'Harbor Nights Suggestions';
    mkdirSync(join(dir, old));
    writeFileSync(join(dir, old, MARKER_NAME), JSON.stringify({ format: MARKER_FORMAT, project_id: data.projectId, project_name: 'Harbor Nights' }));
    const c = await connect(path);
    try {
      const answer = await call(c, 'suggest_trash', { items: [{ frame: '12B' }] });
      expect(answer.isError, answer.text).toBe(false);
      expect(answer.text).toContain('asks to rename it');
    } finally {
      await c.close();
    }
    expect(existsSync(join(dir, SUGGESTIONS))).toBe(false);
    expect(changeFiles(dir, old)).toHaveLength(1);
  });

  it('runs the checks over stdio, with no contact detail in what it says', async () => {
    const { path } = freshProject();
    const c = await connect(path);
    try {
      const answer = await call(c, 'run_checks', {});
      expect(answer.isError, answer.text).toBe(false);
      const checks = JSON.parse(answer.text) as { findings: unknown[]; skipped: unknown[] };
      expect(Array.isArray(checks.findings)).toBe(true);
      expect(Array.isArray(checks.skipped)).toBe(true);
      for (const value of Object.values(CONTACTS).map(String)) expect(answer.text).not.toContain(value);
    } finally {
      await c.close();
    }
  });
});

// Round 2 (both reviews): no contact oracle, the bounds first, names two records share refused, the folder the app's.

/** A fresh copy of the fixture with `changes` applied as the app applies them. */
async function changedProject(changes: Change[]): Promise<{ dir: string; path: string }> {
  const fresh = freshProject();
  const project = await openProject(fresh.path, { driver: nodeDriver, backups: false });
  await apply(project.file, changes);
  await project.close();
  return fresh;
}

/** An answer with its ids made alike: two calls' answers differ by nothing else. */
const alike = (text: string) => text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'ID');

/** The one change file a call wrote, as JSON text. */
const writtenText = (dir: string, before: readonly string[]): string => {
  const added = changeFiles(dir).filter((n) => !before.includes(n));
  expect(added).toHaveLength(1);
  return readFileSync(join(dir, SUGGESTIONS, added[0] ?? ''), 'utf8');
};

describe('the propose tools, round 2', () => {
  it('answers alike whether or not a value the assistant gave is one the project stores', async () => {
    const { dir, path } = freshProject();
    const c = await connect(path);
    try {
      // The review's probe: 40.8677 is the pier's stored latitude to 4 places; 40.8679 and 40.8675 are no one's.
      const stored = await call(c, 'suggest_shot_changes', { changes: [{ frame: '12B', fields: { k1: '40.8676', k2: '40.8677' } }] });
      const unstored = await call(c, 'suggest_shot_changes', { changes: [{ frame: '12B', fields: { k1: '40.8676', k2: '40.8679' } }] });
      const neither = await call(c, 'suggest_shot_changes', { changes: [{ frame: '12B', fields: { k1: '40.8675', k2: '40.8679' } }] });
      expect(stored.isError).toBe(true);
      expect(stored).toEqual(unstored);
      expect(stored).toEqual(neither);
      expect(stored.text).toMatch(/^Nothing was written\. SC 12 · 12B: /);
      expect(existsSync(join(dir, SUGGESTIONS))).toBe(false);

      // Written alike: a stored address typed in an action and in a note is left out of the file, and never said. (The
      // folder made first, so both answers find it there.)
      expect((await call(c, 'suggest_trash', { items: [{ frame: '12B' }] })).isError).toBe(false);
      let before = changeFiles(dir);
      const typedAgain = await call(c, 'suggest_shot_changes', { changes: [{ frame: '12B', fields: { action: `She walks to ${CONTACTS.address}.` } }], note: `Gate at ${CONTACTS.address}.` });
      const fileOfStored = writtenText(dir, before);
      before = changeFiles(dir);
      const typedNew = await call(c, 'suggest_shot_changes', { changes: [{ frame: '12B', fields: { action: 'She walks to 9 Elm Row, Bayport.' } }], note: 'Gate at 9 Elm Row, Bayport.' });
      const fileOfNew = writtenText(dir, before);
      expect(typedAgain.isError, typedAgain.text).toBe(false);
      expect(typedNew.isError, typedNew.text).toBe(false);
      expect(alike(typedAgain.text)).toBe(alike(typedNew.text));
      expect(typedAgain.text).not.toContain('contact left out');
      expect(fileOfStored).not.toContain(CONTACTS.address);
      expect(fileOfStored).toContain('She walks to [contact left out].');
      expect(fileOfStored).toContain('Gate at [contact left out].');
      expect(fileOfNew).toContain('She walks to 9 Elm Row, Bayport.');
    } finally {
      await c.close();
    }
  });

  it('refuses a call past its bounds before reading anything in it', async () => {
    const { dir, path } = freshProject();
    const c = await connect(path);
    try {
      const many = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`f${String(i)}`, 'x']));
      expect(await call(c, 'suggest_shot_changes', { changes: [{ frame: '12B', fields: many }] })).toEqual({ isError: true, text: 'SC 12 · 12B: at most 50 fields at a time.' });
      expect(await call(c, 'suggest_shot_changes', { changes: [{ frame: '12B', fields: { action: 'x'.repeat(10_001) } }] })).toEqual({
        isError: true,
        text: "SC 12 · 12B: a field's value is at most 10,000 characters.",
      });
      const large = Array.from({ length: 30 }, () => ({ frame: '12B', fields: { action: 'x'.repeat(9_000) } }));
      expect(await call(c, 'suggest_shot_changes', { changes: large })).toEqual({ isError: true, text: 'suggest_shot_changes: the arguments are larger than 256 KB. Suggest fewer at a time.' });
      const frames = Array.from({ length: 200 }, () => ({ size: 'CU' }));
      expect(await call(c, 'suggest_new_shots', { new_scene: { name: 'Pier at night' }, frames })).toEqual({ isError: true, text: 'One call makes at most 200 suggestions: suggest fewer at a time.' });
    } finally {
      await c.close();
    }
    expect(existsSync(join(dir, SUGGESTIONS))).toBe(false);
  });

  it('never says back a phone typed in a gear item’s name', async () => {
    const { path } = await changedProject([{ kind: 'update', id: IDS.panel, set: { name: 'SkyPanel S60 555 867 5309' } }]);
    const c = await connect(path);
    try {
      const answer = await call(c, 'suggest_gear_for_day', { day: '1', remove: [IDS.panel] });
      expect(answer.isError, answer.text).toBe(false);
      expect(answer.text).not.toContain('867 5309');
      expect(answer.text).toContain('take off SkyPanel S');
      expect(answer.text).toContain('[contact left out]');
    } finally {
      await c.close();
    }
  });

  it('refuses a name two records share, and takes the id instead', async () => {
    const twin = { gear: '30000000-0000-4000-8000-000000000101', person: '30000000-0000-4000-8000-000000000102', location: '30000000-0000-4000-8000-000000000103' };
    const data = await readProject(original);
    const p = data.projectId;
    const { path } = await changedProject([
      { kind: 'create', record: { id: twin.gear, type: 'gear_item', parentId: p, sortKey: 'z1', props: { name: 'SkyPanel S60', department: 'grip-electric' } } },
      { kind: 'create', record: { id: twin.person, type: 'person', parentId: p, sortKey: 'z2', props: { name: 'Sam Ortiz', role: 'crew', departments: ['sound'] } } },
      { kind: 'create', record: { id: twin.location, type: 'location', parentId: p, sortKey: 'z3', props: { name: 'Pier 9' } } },
    ]);
    const c = await connect(path);
    try {
      expect(await call(c, 'suggest_gear_for_day', { day: '1', add: ['SkyPanel S60'] })).toEqual({ isError: true, text: 'Two gear items are named "SkyPanel S60": give its id (list_gear lists them).' });
      const gearById = await call(c, 'suggest_gear_for_day', { day: '1', add: [twin.gear] });
      expect(gearById.isError, gearById.text).toBe(false);
      expect(await call(c, 'suggest_call_sheet_notes', { day: '1', person_times: { 'Sam Ortiz': { hmu_ready: '05:45' } } })).toEqual({
        isError: true,
        text: 'Two people are named "Sam Ortiz": give their id (list_people lists them).',
      });
      const personById = await call(c, 'suggest_call_sheet_notes', { day: '1', person_times: { [IDS.sam]: { hmu_ready: '05:45' } } });
      expect(personById.isError, personById.text).toBe(false);
      expect(await call(c, 'suggest_shot_changes', { changes: [{ frame: '12B', fields: { location: 'Pier 9' } }] })).toEqual({
        isError: true,
        text: 'Two locations are named "Pier 9": give its id (list_locations lists them).',
      });
      const locationById = await call(c, 'suggest_shot_changes', { changes: [{ frame: '12B', fields: { location: IDS.pier } }] });
      expect(locationById.isError, locationById.text).toBe(false);
    } finally {
      await c.close();
    }
  });

  it('moves a frame after a note with after_note alone, and asks for one of the two when neither is given', async () => {
    const { dir, path } = freshProject();
    const data = await readProject(path);
    const c = await connect(path);
    try {
      const answer = await call(c, 'suggest_reorder', { moves: [{ frame: '12B', after_note: 1 }] });
      expect(answer.isError, answer.text).toBe(false);
      const read = readChangeFile(new Uint8Array(readFileSync(join(dir, SUGGESTIONS, changeFiles(dir)[0] ?? ''))), data.projectId);
      if (!read.ok) throw new Error('refused');
      expect(read.file.suggestions[0]?.props).toMatchObject({ kind: 'reorder', data: { parent_id: IDS.scene12, after_id: NOTE } });
      expect(await call(c, 'suggest_reorder', { moves: [{ frame: '12B' }] })).toEqual({ isError: true, text: 'move 1: give after (a frame number, or "start") or after_note (a note’s number in the scene).' });
    } finally {
      await c.close();
    }
  });

  it('names the folder from the file’s stem as the app does, and reads only .sbd files', async () => {
    const folder = makeTestFolder();
    folders.push(folder);
    const dotted = folder.path('Harbor.Lights.sbd');
    copyFileSync(original, dotted);
    const c = await connect(dotted);
    try {
      const answer = await call(c, 'suggest_trash', { items: [{ frame: '12B' }] });
      expect(answer.isError, answer.text).toBe(false);
      expect((JSON.parse(answer.text) as { written: { folder: string } }).written.folder).toBe('Harbor.Lights Suggestions');
    } finally {
      await c.close();
    }
    expect(readdirSync(folder.dir).sort()).toEqual(['Harbor.Lights Suggestions', 'Harbor.Lights.sbd']);
    const notSbd = folder.path('Harbor Lights.db');
    copyFileSync(original, notSbd);
    const other = await connect(notSbd);
    try {
      const words = { isError: true, text: 'This server reads only Storiiboard projects: files whose names end in .sbd.' };
      expect(await call(other, 'suggest_trash', { items: [{ frame: '12B' }] })).toEqual(words);
      expect(await call(other, 'project_summary', {})).toEqual(words);
    } finally {
      await other.close();
    }
    expect(readdirSync(folder.dir).sort()).toEqual(['Harbor Lights.db', 'Harbor.Lights Suggestions', 'Harbor.Lights.sbd']);
  });

  it('refuses a folder already holding 1,000 change files or 50 MB of them, writing nothing', async () => {
    const { dir, path } = freshProject();
    const data = await readProject(path);
    const suggestionsDir = join(dir, SUGGESTIONS);
    mkdirSync(suggestionsDir);
    writeFileSync(join(suggestionsDir, MARKER_NAME), JSON.stringify({ format: MARKER_FORMAT, project_id: data.projectId, project_name: 'Harbor Lights' }));
    for (let i = 0; i < 1000; i += 1) writeFileSync(join(suggestionsDir, `${String(i).padStart(4, '0')}.sbdchanges`), '{}');
    const before = listing(suggestionsDir);
    const c = await connect(path);
    try {
      expect(await call(c, 'suggest_trash', { items: [{ frame: '12B' }] })).toEqual({
        isError: true,
        text: 'The Suggestions folder already holds 1,000 change files: nothing was written. Bring them in from the Suggestions tile first.',
      });
      expect(listing(suggestionsDir)).toEqual(before);
      for (const name of readdirSync(suggestionsDir).filter((n) => n.endsWith('.sbdchanges'))) unlinkSync(join(suggestionsDir, name));
      // One file as large as the read budget (sparse: its size alone counts).
      writeFileSync(join(suggestionsDir, 'large.sbdchanges'), '');
      truncateSync(join(suggestionsDir, 'large.sbdchanges'), 50 * 1024 * 1024);
      expect(await call(c, 'suggest_trash', { items: [{ frame: '12B' }] })).toEqual({
        isError: true,
        text: 'The Suggestions folder already holds 50 MB of change files: nothing was written. Bring them in from the Suggestions tile first.',
      });
      expect(readdirSync(suggestionsDir).sort()).toEqual(['large.sbdchanges', MARKER_NAME].sort());
    } finally {
      await c.close();
    }
  });

  it('takes away only its own leftovers over an hour old, before it writes', async () => {
    const { dir, path } = freshProject();
    const data = await readProject(path);
    const suggestionsDir = join(dir, SUGGESTIONS);
    mkdirSync(suggestionsDir);
    writeFileSync(join(suggestionsDir, MARKER_NAME), JSON.stringify({ format: MARKER_FORMAT, project_id: data.projectId, project_name: 'Harbor Lights' }));
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const names = {
      leftover: '.2026-11-21 09-05-07Z Claude Desktop 8d0f3c52.sbdchanges.1a2b3c4d.writing',
      young: '.2026-11-21 09-05-08Z Claude Desktop 8d0f3c53.sbdchanges.1a2b3c4e.writing',
      notOurs: '.notes.writing',
      noZone: '.2026-11-21 09-05-07 Claude Desktop 8d0f3c52.sbdchanges.1a2b3c4d.writing',
      other: 'shot list.txt',
    };
    for (const [key, name] of Object.entries(names)) {
      writeFileSync(join(suggestionsDir, name), 'x');
      if (key !== 'young') utimesSync(join(suggestionsDir, name), old, old);
    }
    const c = await connect(path);
    try {
      const answer = await call(c, 'suggest_trash', { items: [{ frame: '12B' }] });
      expect(answer.isError, answer.text).toBe(false);
    } finally {
      await c.close();
    }
    const left = readdirSync(suggestionsDir);
    expect(left).not.toContain(names.leftover);
    for (const name of [names.young, names.notOurs, names.noZone, names.other, MARKER_NAME]) expect(left, name).toContain(name);
    expect(left.filter((n) => n.endsWith('.sbdchanges'))).toHaveLength(1);
  });

  it('looks in a frame’s title and a scene’s name as names: a place named as its address stays', async () => {
    const { dir, path } = freshProject();
    const c = await connect(path);
    try {
      const answer = await call(c, 'suggest_shot_changes', { changes: [{ frame: '12B', fields: { title: `Outside ${CONTACTS.address}`, action: `Outside ${CONTACTS.address}` } }] });
      expect(answer.isError, answer.text).toBe(false);
      const text = writtenText(dir, []);
      expect(text).toContain(`"title": "Outside ${CONTACTS.address}"`);
      expect(text).toContain('"action": "Outside [contact left out]"');
      const scene = await call(c, 'suggest_new_shots', { new_scene: { name: CONTACTS.address }, frames: [] });
      expect(scene.isError, scene.text).toBe(false);
    } finally {
      await c.close();
    }
  });

  it('keeps on a day’s list the gear of a department the view hides: liveness is judged on the full records', async () => {
    const data = await readProject(original);
    const context = { data, client: CLIENT, departments: { hidden: new Set(['grip-electric'] as const), exempt: new Set<never>() } };
    const proposal = suggestGearForDay(context, { day: '1', add: [IDS.boom] });
    expect(proposal.suggestions[0]?.data.props).toEqual({ gear_ids: [IDS.body, IDS.panel, IDS.boom] });
  });

  it('takes away the folder it made when the file can’t be written, and says so in words', async () => {
    const { dir, path } = freshProject();
    const beside = listing(dir);
    const data = await readProject(path);
    const context = { data, client: CLIENT };
    const failing = {
      afterTemp: () => {
        throw new Error('the disk is full');
      },
    };
    expect(() => writeProposal(context, suggestTrash(context, { items: [{ frame: '12B' }] }), failing)).toThrow(new FolderRefused('The change file couldn’t be written: nothing was written.'));
    expect(listing(dir)).toEqual(beside);
    // A folder that was there already stays, with what it holds.
    mkdirSync(join(dir, SUGGESTIONS));
    writeFileSync(join(dir, SUGGESTIONS, 'kept.sbdchanges'), '{}');
    expect(() => writeProposal(context, suggestTrash(context, { items: [{ frame: '12B' }] }), failing)).toThrow(FolderRefused);
    expect(readdirSync(join(dir, SUGGESTIONS))).toEqual(['kept.sbdchanges']);
  });
});
