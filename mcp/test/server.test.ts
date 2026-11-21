import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestFolder } from '../../src/core/storage/testFolder';
import { SCHEMA_VERSION } from '../../src/core/storage/migrations';
import { OPEN_ONCE } from '../src/readOnlyFile';
import { CONTACTS, IDS, setSchemaVersion, writeHarborLights } from './fixture';

// The MCP server over stdio, driven by the SDK's own client (7.5): the built bundle, started as Claude Desktop starts it,
// against "Harbor Lights" written in the test. Every tool, its shape, the Trash, the refusals, and no contact detail in
// anything it ever says.

const mcp = join(import.meta.dirname, '..');
// Round 2: the test's build goes to test-results/7.5/dist-test/, never over mcp/dist (a build of the person's own).
const out = join(mcp, '..', 'test-results', '7.5', 'dist-test');
const server = join(out, 'server.js');
// From there, the server's two packages are found in mcp/node_modules by this hook (fromMcp.mjs); nothing else moves.
const fromMcp = pathToFileURL(join(import.meta.dirname, 'fromMcp.mjs')).href;
const folder = makeTestFolder();
const project = folder.path('Harbor Lights.sbd');

const TOOLS = ['project_summary', 'list_scenes', 'list_shots', 'get_schedule', 'get_call_sheet', 'list_people', 'list_gear', 'list_locations', 'get_plan', 'list_suggestions'];

/** One call of every tool, as an assistant would make them. */
const EVERY_CALL: { name: string; arguments: Record<string, unknown> }[] = [
  { name: 'project_summary', arguments: {} },
  { name: 'list_scenes', arguments: {} },
  { name: 'list_scenes', arguments: { include_trashed: true } },
  { name: 'list_shots', arguments: {} },
  { name: 'list_shots', arguments: { include_trashed: true } },
  { name: 'list_shots', arguments: { scene: '12' } },
  { name: 'list_shots', arguments: { shoot_day: '2026-11-18' } },
  { name: 'get_schedule', arguments: {} },
  { name: 'get_call_sheet', arguments: { day: '2026-11-18' } },
  { name: 'get_call_sheet', arguments: { day: '1' } },
  { name: 'list_people', arguments: {} },
  { name: 'list_people', arguments: { include_trashed: true } },
  { name: 'list_gear', arguments: {} },
  { name: 'list_gear', arguments: { include_trashed: true } },
  { name: 'list_locations', arguments: {} },
  { name: 'list_locations', arguments: { include_trashed: true } },
  { name: 'get_plan', arguments: { scene: '12' } },
  { name: 'get_plan', arguments: { scene: '12', setup: '1' } },
  { name: 'list_suggestions', arguments: {} },
  { name: 'list_suggestions', arguments: { status: 'all', include_trashed: true } },
];

let client: Client;

async function connect(args: string[]): Promise<Client> {
  const c = new Client({ name: 'storiiboard-test', version: '0.0.0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: ['--import', fromMcp, server, ...args], stderr: 'ignore' }));
  return c;
}

interface Answer {
  text: string;
  isError: boolean;
}

async function call(c: Client, name: string, args: Record<string, unknown> = {}): Promise<Answer> {
  const result = await c.callTool({ name, arguments: args });
  const content = result.content as { type: string; text?: string }[];
  return { text: content.map((part) => part.text ?? '').join(''), isError: result.isError === true };
}

async function json(name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const answer = await call(client, name, args);
  expect(answer.isError, answer.text).toBe(false);
  return JSON.parse(answer.text) as Record<string, unknown>;
}

/** What a folder holds: every name, its size and its last change. */
function listing(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .map((name) => {
      const stat = statSync(join(dir, name));
      return `${name}|${String(stat.size)}|${String(stat.mtimeMs)}`;
    });
}

beforeAll(async () => {
  // The bundle, built as `npm run build --prefix mcp` builds it, into the test's own folder.
  mkdirSync(out, { recursive: true });
  const built = spawnSync(process.execPath, [join(mcp, '..', 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', 'vite.config.ts', '--outDir', out, '--emptyOutDir'], {
    cwd: mcp,
    encoding: 'utf8',
  });
  expect(built.status, built.stderr).toBe(0);
  await writeHarborLights(project);
  client = await connect([project]);
}, 120_000);

afterAll(async () => {
  await client.close();
  folder.remove();
});

describe('the MCP server over stdio', () => {
  it('lists the ten read tools, each marked read-only and closed to the world', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOLS].sort());
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
      expect(tool.annotations?.openWorldHint, tool.name).toBe(false);
      expect(tool.description?.length, tool.name).toBeGreaterThan(20);
    }
  });

  it('answers project_summary with the project and what it holds', async () => {
    const summary = await json('project_summary');
    expect(summary.project).toMatchObject({ title: 'Harbor Lights', aspect_ratio: '2.39:1', company: 'Harbor Pictures', schema_version: SCHEMA_VERSION });
    expect(summary.counts).toEqual({
      scenes: 1,
      frames: 2,
      frames_need_to_shoot: 2,
      setups: 1,
      shoot_days: 1,
      people: 2,
      characters: 1,
      locations: 2,
      gear_items: 4,
      suggestions_pending: 2,
    });
    expect(summary.left_out).toContain('Contact details are never returned');
  });

  it('lists scenes, leaving the Trash out unless asked', async () => {
    const live = (await json('list_scenes')).scenes as Record<string, unknown>[];
    expect(live.map((s) => s.number)).toEqual(['12']);
    expect(live[0]).toMatchObject({
      label: 'SC 12',
      name: 'Ticket office at dawn',
      int_ext: 'INT',
      day_night: 'DAWN',
      location: { id: IDS.pier, name: 'Pier 9' },
      pages: '1 3/8',
      characters: [{ id: IDS.mara, name: 'MARA' }],
      frames: 2,
      setups: [{ id: IDS.setup1, number: 1, name: 'Window side' }],
    });
    const all = (await json('list_scenes', { include_trashed: true })).scenes as Record<string, unknown>[];
    expect(all.map((s) => [s.number, s.trashed ?? false])).toEqual([
      ['12', false],
      ['13', true],
    ]);
  });

  it('lists a scene’s shots by its number, with their specs as the slate has them', async () => {
    for (const scene of ['12', 'SC 12', ' 12 ']) {
      const shots = (await json('list_shots', { scene })).shots as Record<string, unknown>[];
      expect(shots.map((s) => s.number), scene).toEqual(['12A', '12B']);
    }
    const [first] = (await json('list_shots', { scene: '12' })).shots as Record<string, unknown>[];
    expect(first).toMatchObject({
      number: '12A',
      size: 'WS',
      lens_mm: 32,
      lens: { id: IDS.lens, name: 'Cooke S4 32', squeeze: 1 },
      t_stop: 2.8,
      status: 'need',
      action: 'Mara counts the till.',
      location: { id: IDS.pier, name: 'Pier 9' },
      shoot_day: { id: IDS.day1, number: 1, date: '2026-11-18' },
      setup: { id: IDS.setup1, number: 1, name: 'Window side' },
      gear: [{ id: IDS.body, name: 'Alexa Mini LF' }],
    });
    const onDay = (await json('list_shots', { shoot_day: '2026-11-18' })).shots as Record<string, unknown>[];
    expect(onDay.map((s) => s.number)).toEqual(['12A']);
    const all = (await json('list_shots', { include_trashed: true })).shots as Record<string, unknown>[];
    expect(all.map((s) => [s.number, s.trashed ?? false])).toEqual([
      ['12A', false],
      ['12B', false],
      ['13A', true],
    ]);
  });

  it('gives the schedule with the app’s own totals', async () => {
    const schedule = await json('get_schedule');
    expect(schedule.minutes_per_setup).toBe(30);
    expect(schedule.days).toEqual([
      expect.objectContaining({
        id: IDS.day1,
        number: 1,
        date: '2026-11-18',
        call_time: '06:00',
        wrap_time: '18:00',
        totals: { frames: 1, setups: 1, minutes: 30 },
        people: { called: 2, confirmed: 1, chosen: true },
        gear: [
          { id: IDS.body, name: 'Alexa Mini LF' },
          { id: IDS.panel, name: 'SkyPanel S60' },
        ],
      }),
    ]);
    expect(schedule.unscheduled_need_to_shoot).toEqual([{ id: IDS.shotB, number: '12B', scene: '12' }]);
  });

  it('gives a day’s call sheet by its date or its number, with no phone or email', async () => {
    const byDate = await json('get_call_sheet', { day: '2026-11-18' });
    const byNumber = await json('get_call_sheet', { day: '1' });
    expect(byNumber).toEqual(byDate);
    expect(byDate.day).toMatchObject({ number: 1, of: 1, date: '2026-11-18', call_time: '06:00' });
    expect(byDate.cast).toEqual([{ id: IDS.sam, name: 'Sam Ortiz', characters: ['MARA'], call: '06:00', hmu_ready: null, on_set: null }]);
    const [location] = byDate.locations as Record<string, unknown>[];
    expect(location).toMatchObject({ name: 'Pier 9', has_place: true, time_zone: { zone: 'America/New_York', from: 'location' } });
    expect((location?.sun as Record<string, unknown>).sunrise).toMatch(/^\d\d:\d\d$/);
    expect(location?.safety).toMatchObject({ country_code: 'US', emergency_numbers: [{ kind: 'emergency', number: '911' }], hospital: { name: 'Bayport General', emergency_department: true } });
    // The location's notes keep their words; the guard's phone number inside them is taken out.
    expect(location?.notes).toBe('Gate opens at 5. Night guard: [contact left out].');
    expect(byDate.notes).toEqual({ general: 'Breakfast from 05:30 at the ticket office.', safety: 'Wet planks on the pier.' });
  });

  it('lists people, gear and locations without their contact details', async () => {
    const people = await json('list_people');
    expect(people.people).toEqual([
      { id: IDS.robin, name: 'Robin Vale', role: 'dp', departments: ['camera', 'grip-electric'], title: 'Director of photography', full_view: null, plays: [] },
      { id: IDS.sam, name: 'Sam Ortiz', role: 'cast', departments: ['cast'], title: '', full_view: null, plays: ['MARA'] },
    ]);
    const gear = (await json('list_gear')).gear as Record<string, unknown>[];
    expect(gear.map((g) => g.name)).toEqual(['Alexa Mini LF', 'Cooke S4 32', 'SkyPanel S60', 'Boom kit Sennheiser']);
    expect(gear[0]).toMatchObject({ kind: 'camera_body', body: { letter: 'A', sensor_mode: 'Open Gate', sensor_width_mm: 36.7, sensor_height_mm: 25.54 } });
    expect(gear[2]).toMatchObject({ watts: 450, source: 'rental', owner: 'Bayport Lighting', day_rate: 85 });
    const withTrash = (await json('list_gear', { include_trashed: true })).gear as Record<string, unknown>[];
    expect(withTrash.find((g) => g.id === IDS.oldDolly)).toMatchObject({ name: 'Doorway dolly', trashed: true });
    const locations = (await json('list_locations')).locations as Record<string, unknown>[];
    expect(locations.map((l) => l.name)).toEqual(['Pier 9', 'Robin’s flat']);
    expect(locations[0]).toMatchObject({ status: 'confirmed', time_zone: 'America/New_York', country_code: 'US', has_place: true, photos: 1, light_reference: true });
    for (const location of locations) for (const key of ['address', 'parking', 'latitude', 'longitude', 'contact_phone', 'map_name']) expect(location, key).not.toHaveProperty(key);
  });

  it('gives a setup’s plan in metres, with its camera, light, sun and window', async () => {
    const plan = await json('get_plan', { scene: '12', setup: '1' });
    expect(plan.setup).toEqual({ id: IDS.setup1, number: 1, name: 'Window side' });
    expect(plan.room).toMatchObject({ id: IDS.room, name: 'Ticket office', ceiling_height_m: 2.7 });
    expect(plan.north).toMatchObject({ plan_rotation_deg: 0 });
    expect((plan.walls as unknown[]).length).toBe(4);
    expect(plan.openings).toEqual([expect.objectContaining({ id: IDS.window, kind: 'window', wall_id: IDS.wallS, along_m: 2, width_m: 1.2, sill_m: 0.9, top_m: 2.1, height_m: 1.2 })]);
    const [camera] = plan.cameras as Record<string, unknown>[];
    expect(camera).toMatchObject({ letter: 'A', lens: { from: 'frame', focal_mm: 32, squeeze: 1 }, sensor_mode: { name: 'Open Gate', width_mm: 36.7, height_mm: 25.54 }, frames: [{ id: IDS.shotA, number: '12A' }] });
    // The fixture's own: a 36.7 mm wide Open Gate frame (the 2.39:1 frame fitted inside keeps the width) on 32 mm,
    // 2 × atan(36.7 / 64) = 59.663°.
    expect((camera?.field_of_view as Record<string, number>).horizontal_deg).toBeCloseTo(59.66, 2);
    expect(plan.lights).toEqual([expect.objectContaining({ id: IDS.light, watts: 450, watts_from: 'gear', height_m: 2.1 })]);
    expect(plan.watts).toEqual({ total_known: 450, lights: 1, lights_without_watts: 0 });
    const sun = (plan.items as Record<string, unknown>[]).find((i) => i.id === IDS.sun);
    expect(sun?.sun).toMatchObject({ place: { source: 'location', location: { id: IDS.pier } }, date: { source: 'shootDay', date: '2026-11-18' }, zone: { zone: 'America/New_York', from: 'location' } });
    const [window] = plan.windows as Record<string, unknown>[];
    expect(window).toMatchObject({ id: IDS.window, wall: 'outside', facing: { point: 'S' }, missing: null });
    expect((window?.hours as unknown[]).length).toBeGreaterThan(0);
    // Without a setup: the scene's room and its blocking only.
    const room = await json('get_plan', { scene: '12' });
    expect(room.setup).toBeNull();
    expect(room.cameras).toEqual([]);
  });

  it('lists suggestions with the app’s flags in words, a contact field left out', async () => {
    const { suggestions } = (await json('list_suggestions')) as { suggestions: Record<string, unknown>[] };
    expect(suggestions.map((s) => s.id)).toEqual([IDS.lensSuggestion, IDS.phoneSuggestion]);
    expect(suggestions[0]).toMatchObject({ kind: 'update', status: 'pending', target: { id: IDS.shotA, type: 'shot', label: 'SC 12 · 12A' }, data: { props: { t_stop: 4 }, before: { t_stop: 2.8 } }, can_apply: true });
    expect(suggestions[1]).toMatchObject({ data: { props: { title: 'DP' }, before: {} }, fields_left_out: ['phone'], can_apply: false });
    expect((suggestions[1]?.flags as { words: string }[]).every((f) => f.words.length > 0)).toBe(true);
  });

  it('never returns a contact detail, from any tool, trashed items included', async () => {
    const values = [...Object.values(CONTACTS).map(String), '+1 555 0177', '+1 555 0999', 'office@harbor.example', 'IMG_4012.JPG', 'C:/Users/robin'];
    for (const { name, arguments: args } of EVERY_CALL) {
      const answer = await call(client, name, args);
      expect(answer.isError, `${name} ${answer.text}`).toBe(false);
      for (const value of values) expect(answer.text, `${name} ${JSON.stringify(args)}`).not.toContain(value);
      // Coordinates as the file holds them, and cut to four places as a lookup would send them.
      for (const n of [CONTACTS.latitude, CONTACTS.longitude, CONTACTS.ownLatitude, CONTACTS.photoLatitude]) expect(answer.text, name).not.toContain(n.toFixed(4));
    }
  });

  it('answers a bad argument as a tool error in words', async () => {
    const noScene = await call(client, 'list_shots', { scene: '99' });
    expect(noScene).toEqual({ isError: true, text: 'There\'s no scene numbered "99". The scenes are 12.' });
    const noSetup = await call(client, 'get_plan', { scene: '12', setup: '7' });
    expect(noSetup).toEqual({ isError: true, text: 'Scene 12 has no setup "7". Its setups are 1.' });
    const noDay = await call(client, 'get_call_sheet', { day: '2027-01-01' });
    expect(noDay).toEqual({ isError: true, text: 'There\'s no shoot day "2027-01-01". The days are 1 (2026-11-18).' });
    // In our words, never zod's list of issues (round 2).
    expect(await call(client, 'list_scenes', { include_trashed: 'yes' })).toEqual({ isError: true, text: 'list_scenes: include_trashed is true or false.' });
    expect(await call(client, 'get_call_sheet', {})).toEqual({ isError: true, text: 'get_call_sheet: day is needed: day is a date as text (YYYY-MM-DD) or a day number ("3").' });
    expect(await call(client, 'list_shots', { scene: 12, include_trashed: 1 })).toEqual({
      isError: true,
      text: 'list_shots: scene is a scene number as text, as on the slate ("12", "4A"); include_trashed is true or false.',
    });
    expect(await call(client, 'list_suggestions', { status: 'maybe' })).toEqual({ isError: true, text: 'list_suggestions: status is pending, approved, rejected or all.' });
    expect((await call(client, 'no_such_tool', {})).text).toMatch(/^There's no tool named no_such_tool\. The tools are project_summary, /);
    const elsewhere = await call(client, 'project_summary', { project: folder.path('Other.sbd') });
    expect(elsewhere).toEqual({ isError: true, text: 'This server reads only Harbor Lights.' });
    const byName = await call(client, 'project_summary', { project: 'Harbor Lights' });
    expect(byName.isError).toBe(false);
  });

  it('scrubs a refusal’s words, which can repeat what the assistant asked for (round 3)', async () => {
    expect(await call(client, 'list_shots', { scene: '+1 555 0123' })).toEqual({ isError: true, text: 'There\'s no scene numbered "[contact left out]". The scenes are 12.' });
    expect(await call(client, 'get_call_sheet', { day: 'r@example.com' })).toEqual({ isError: true, text: 'There\'s no shoot day "[contact left out]". The days are 1 (2026-11-18).' });
    expect((await call(client, 'no_such_tool_5550123456', {})).text).toMatch(/^There's no tool named no_such_tool_\[contact left out\]\. The tools are /);
  });

  it('refuses a missing file, a newer one and an older one in words, changing none', async () => {
    const newer = folder.path('Newer.sbd');
    const older = folder.path('Older.sbd');
    copyFileSync(project, newer);
    copyFileSync(project, older);
    setSchemaVersion(newer, SCHEMA_VERSION + 1);
    setSchemaVersion(older, SCHEMA_VERSION - 1);
    const newerBytes = readFileSync(newer);
    const olderBytes = readFileSync(older);
    const c = await connect([folder.path('Missing.sbd'), newer, older]);
    try {
      expect(await call(c, 'project_summary', { project: 'Missing' })).toEqual({ isError: true, text: "There's no project file at that path." });
      const newerAnswer = (await call(c, 'project_summary', { project: 'Newer' })).text;
      expect(newerAnswer).toMatch(/^This project was saved by a newer version of Storiiboard/);
      // The server's remedy, not the app's (round 2).
      expect(newerAnswer).toContain('Rebuild the server (npm run build --prefix mcp) after updating Storiiboard.');
      const old = await call(c, 'list_scenes', { project: 'Older' });
      expect(old.isError).toBe(true);
      expect(old.text).toMatch(/^This project was saved by an older version of Storiiboard/);
      expect((await call(c, 'project_summary')).text).toBe('Name the project: Missing, Newer, Older.');
    } finally {
      await c.close();
    }
    expect(readFileSync(newer).equals(newerBytes)).toBe(true);
    expect(readFileSync(older).equals(olderBytes)).toBe(true);
  });

  it('refuses a file in WAL mode before SQLite opens it, and nothing appears beside it', async () => {
    const walFolder = makeTestFolder();
    try {
      const path = walFolder.path('Harbor Lights.sbd');
      copyFileSync(project, path);
      const db = new DatabaseSync(path);
      db.exec('PRAGMA journal_mode = WAL');
      db.close();
      // Header bytes 18 and 19 now say WAL; closing took the -wal and -shm files away.
      expect([...readFileSync(path).subarray(18, 20)]).toEqual([2, 2]);
      const bytes = readFileSync(path);
      const before = listing(walFolder.dir);
      expect(before.map((line) => line.split('|')[0])).toEqual(['Harbor Lights.sbd']);
      const c = await connect([path]);
      try {
        expect(await call(c, 'project_summary')).toEqual({ isError: true, text: OPEN_ONCE });
        expect(listing(walFolder.dir)).toEqual(before);
      } finally {
        await c.close();
      }
      expect(readFileSync(path).equals(bytes)).toBe(true);
      expect(listing(walFolder.dir)).toEqual(before);
    } finally {
      walFolder.remove();
    }
  });

  it('numbers a name two of its projects share, in the order it was given them, and never names their folders', async () => {
    const east = makeTestFolder();
    const west = makeTestFolder();
    try {
      mkdirSync(east.path('East'));
      mkdirSync(west.path('West'));
      const one = east.path('East', 'Harbor Lights.sbd');
      const two = west.path('West', 'Harbor Lights.sbd');
      copyFileSync(project, one);
      copyFileSync(project, two);
      const c = await connect([one, two]);
      try {
        // Round 3: numbered, never by folder (a folder can name a person or a client).
        const shared = await call(c, 'project_summary', { project: 'Harbor Lights' });
        expect(shared).toEqual({ isError: true, text: '2 projects are named Harbor Lights: name one as Harbor Lights (1) or Harbor Lights (2).' });
        const unnamed = await call(c, 'project_summary');
        expect(unnamed.text).toBe('Name the project: Harbor Lights (1), Harbor Lights (2).');
        for (const answer of [shared, unnamed]) {
          expect(answer.text).not.toContain('East');
          expect(answer.text).not.toContain('West');
        }
        // The label it gave is a name it takes, as is a path.
        for (const label of ['Harbor Lights (1)', 'harbor lights (2)']) expect((await call(c, 'project_summary', { project: label })).isError, label).toBe(false);
        expect((await call(c, 'project_summary', { project: two })).isError).toBe(false);
      } finally {
        await c.close();
      }
    } finally {
      east.remove();
      west.remove();
    }
  });

  it('is built into one file that imports only Node’s fs, path and sqlite, the SDK’s stdio server and zod', () => {
    const bundle = readFileSync(server, 'utf8');
    const imports = [...bundle.matchAll(/^import\b.*?from\s*"([^"]+)";?$/gm)].map((m) => m[1]);
    expect([...new Set(imports)].sort()).toEqual([
      '@modelcontextprotocol/sdk/server/mcp.js',
      '@modelcontextprotocol/sdk/server/stdio.js',
      // The call request's schema (round 2): calls are answered by the server's own argument check.
      '@modelcontextprotocol/sdk/types.js',
      'node:fs',
      'node:path',
      'node:sqlite',
      'zod',
    ]);
    expect(bundle).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|\brequire\s*\(/);
  });

  it('runs Kevin’s probe: the Node it runs on, and node:sqlite opening a file read-only', async () => {
    // Any probe folder already there (another run's) is left out of the count.
    const probeFolders = new Set(readdirSync(tmpdir()).filter((name) => name.startsWith('storiiboard-probe-')));
    const c = new Client({ name: 'storiiboard-test', version: '0.0.0' });
    await c.connect(new StdioClientTransport({ command: process.execPath, args: [join(mcp, 'probe', 'probe.mjs')], stderr: 'ignore' }));
    try {
      const answer = await call(c, 'node_check');
      expect(answer.isError).toBe(false);
      const check = JSON.parse(answer.text) as Record<string, unknown>;
      expect(check.node).toBe(process.version);
      expect(check.sqlite).toMatch(/^opened read-only, SQLite \d+\.\d+/);
      // What the server needs of node:sqlite, as the probe finds it (round 2), errors by their codes only.
      expect(check).toMatchObject({ set_return_arrays: 'function', columns: 'function' });
      expect(check.read_only_option).toMatch(/^honoured: a write is refused \(SQLite \d+\)$/);
      // Its temp file is gone with its folder.
      expect(readdirSync(tmpdir()).filter((name) => name.startsWith('storiiboard-probe-') && !probeFolders.has(name))).toEqual([]);
    } finally {
      await c.close();
    }
  });

  it('leaves the project file and its folder exactly as they were after a session of every tool', async () => {
    const copyFolder = makeTestFolder();
    try {
      const path = copyFolder.path('Harbor Lights.sbd');
      copyFileSync(project, path);
      const bytes = readFileSync(path);
      const before = listing(copyFolder.dir);
      const c = await connect([path]);
      try {
        for (const { name, arguments: args } of EVERY_CALL) expect((await call(c, name, args)).isError, name).toBe(false);
        // While the session is open, too: no journal, lock or backup beside it.
        expect(listing(copyFolder.dir)).toEqual(before);
      } finally {
        await c.close();
      }
      expect(readFileSync(path).equals(bytes)).toBe(true);
      expect(listing(copyFolder.dir)).toEqual(before);
    } finally {
      copyFolder.remove();
    }
  });
});
