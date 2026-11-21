import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ASSISTANT_TOOLS } from '../../src/core/model/assistantTools';
import type { SbdRecord } from '../../src/core/model/record';
import { readSuggestion, reviewSuggestion } from '../../src/core/model/suggestion';
import { apply } from '../../src/core/ops/ops';
import { readChangeFile } from '../../src/core/storage/changeFile';
import { nodeDriver } from '../../src/core/storage/nodeDriver';
import { openProject } from '../../src/core/storage/project';
import { makeTestFolder } from '../../src/core/storage/testFolder';
import { MARKER_FORMAT, MARKER_NAME } from '../src/changeFolder';
import { readProject } from '../src/project';
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
        expect(fileName, name).toMatch(/^\d{4}-\d\d-\d\d \d\d-\d\d-\d\d Claude Desktop [0-9a-f]{8}\.sbdchanges$/);
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
        // What it says back names the file and what each suggestion would do; no contact detail.
        const said = JSON.parse(answer.text) as { written: { file: string; suggestions: number } };
        expect(said.written).toMatchObject({ file: fileName, suggestions: count });
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
      expect(phone).toEqual({ isError: true, text: 'Nothing was written. SC 12 · 12B: action holds what reads as a phone number, an email, coordinates or a map link. Contact details are never suggested: leave them out.' });
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
      expect((await call(c, 'suggest_gear_for_day', { day: '1', add: ['Fog machine'] })).text).toBe('There\'s no gear item "Fog machine" in the catalogue. list_gear lists it.');
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
