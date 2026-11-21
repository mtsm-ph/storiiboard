import { spawn } from 'node:child_process';
import { copyFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TAKEN_OUT } from '../../src/core/model/assistantView';
import { DEPARTMENTS } from '../../src/core/model/department';
import { computerTimeZone } from '../../src/core/model/location';
import { cameraCone } from '../../src/core/model/planCamera';
import type { Props, SbdRecord } from '../../src/core/model/record';
import { dayCrew } from '../../src/core/model/schedule';
import { sunReadingOf } from '../../src/core/model/sunSources';
import { windowSunsOf } from '../../src/core/model/windowSun';
import { makeTestFolder } from '../../src/core/storage/testFolder';
import { checkedAnswer, contactRefused } from '../src/guard';
import { readProject, type ProjectData } from '../src/project';
import { OPEN_ONCE, SAVING } from '../src/readOnlyFile';
import { getCallSheet, getPlan, getSchedule, listGear, listLocations, listPeople, listScenes, listShots, listSuggestions, projectSummary, type ToolContext } from '../src/tools';
import { CONTACTS, IDS, writeHarborLights } from './fixture';

// The tools against the app's own readers (7.5), and a department's "no" (Kevin, Nov 21) hiding its material from every
// tool. Called directly, on "Harbor Lights" read as the server reads it. Round 2: the guard's contact shapes, the sun to
// a whole degree, no computer zone, the readers' strings scrubbed, suggestions' data, and the file read as one snapshot.

const folder = makeTestFolder();
let data: ProjectData;

beforeAll(async () => {
  const path = folder.path('Harbor Lights.sbd');
  await writeHarborLights(path);
  data = await readProject(path);
});

afterAll(() => {
  folder.remove();
});

/** Every tool's answer, as one text. */
function everyAnswer(context: ToolContext): string {
  return JSON.stringify([
    projectSummary(context),
    listScenes(context, { include_trashed: true }),
    listShots(context, { include_trashed: true }),
    getSchedule(context),
    getCallSheet(context, { day: '1' }),
    listPeople(context, { include_trashed: true }),
    listGear(context, { include_trashed: true }),
    listLocations(context, { include_trashed: true }),
    getPlan(context, { scene: '12', setup: '1' }),
    listSuggestions(context, { status: 'all', include_trashed: true }),
  ]);
}

/** The fixture with some records changed or added: each given record replaces the one of its id. */
function changed(...records: SbdRecord[]): ProjectData {
  return { ...data, records: { ...data.records, ...Object.fromEntries(records.map((record) => [record.id, record])) } };
}

/** A record of the fixture with its props changed. */
function withProps(id: string, props: Props, more: Partial<SbdRecord> = {}): SbdRecord {
  const record = data.records[id];
  if (!record) throw new Error(`The fixture has no ${id}.`);
  return { ...record, ...more, props: { ...record.props, ...props } };
}

/** A pending suggestion, made up for a test. */
function suggestion(id: string, props: Props): SbdRecord {
  return {
    id,
    type: 'suggestion',
    parentId: data.projectId,
    sortKey: 'z',
    props: { kind: 'update', status: 'pending', source: 'mcp', suggested_at: '2026-11-17T12:00:00.000Z', ...props },
    trashedAt: null,
    trashedBy: null,
    createdAt: '2026-11-17T12:00:00.000Z',
    updatedAt: '2026-11-17T12:00:00.000Z',
  };
}

/** Zones as the server has them: none looked up, a location's own typed zone alone counts. */
const noZones = () => new Map(Object.keys(data.records).map((id) => [id, null]));

describe('get_plan against the app’s own readers', () => {
  it('gives the field of view the plan draws', () => {
    const cone = cameraCone(data.records, IDS.camera);
    if (!cone || 'missing' in cone) throw new Error('The fixture’s camera has a cone.');
    const plan = getPlan({ data }, { scene: '12', setup: '1' }) as { cameras: { field_of_view: { horizontal_deg: number; frame_width_mm: number; focal_mm: number } }[] };
    const fov = plan.cameras[0]?.field_of_view;
    expect(fov?.horizontal_deg).toBeCloseTo(cone.degrees, 2);
    expect(fov?.frame_width_mm).toBeCloseTo(cone.widthMm, 2);
    expect(fov?.focal_mm).toBe(32);
  });

  it('gives the sun the plan draws, to a whole degree, with sunrise and sunset', () => {
    const reading = sunReadingOf(data.records, IDS.sun, noZones());
    if (!reading || 'missing' in reading) throw new Error('The fixture’s sun path is drawn.');
    const plan = getPlan({ data }, { scene: '12', setup: '1' }) as {
      items: { id: string; sun?: { at: { bearing_deg: number; altitude_deg: number; time: string }; solar_noon: { bearing_deg: number }; sunrise: string; sunset: string } }[];
    };
    const sun = plan.items.find((i) => i.id === IDS.sun)?.sun;
    expect(sun?.at.time).toBe('07:30');
    // Round 2: whole degrees, never the reader's own decimals.
    expect(sun?.at.bearing_deg).toBe(Math.round(reading.at?.bearing ?? NaN));
    expect(sun?.at.altitude_deg).toBe(Math.round(reading.at?.altitude ?? NaN));
    expect(Number.isInteger(sun?.solar_noon.bearing_deg)).toBe(true);
    expect(sun?.sunrise).toBe(reading.path?.day.sunrise);
    expect(sun?.sunset).toBe(reading.path?.day.sunset);
  });

  it('gives the window hours the plan works out, its facing to a whole degree', () => {
    const [window] = windowSunsOf(data.records, { sceneId: IDS.scene12, setupId: IDS.setup1 }, noZones());
    const plan = getPlan({ data }, { scene: '12', setup: '1' }) as { windows: { hours: { from: string; to: string }[]; facing: { bearing_deg: number } }[] };
    expect(window?.hours?.length).toBeGreaterThan(0);
    expect(plan.windows[0]?.hours.map((h) => [h.from, h.to])).toEqual(window?.hours?.map((h) => [h.from, h.to]));
    expect(plan.windows[0]?.facing.bearing_deg).toBe(Math.round(window?.facing?.bearing ?? NaN));
  });
});

describe('the readers’ own counts and words', () => {
  it('counts a day’s people through the app’s dayCrew, and reads the project’s state through projectStateOf', () => {
    const day = data.records[IDS.day1];
    if (!day) throw new Error('The fixture has its day.');
    const crew = dayCrew(data.records, data.projectId, day);
    const schedule = getSchedule({ data }) as { days: { people: { called: number; confirmed: number } }[] };
    expect(schedule.days[0]?.people).toMatchObject({ called: crew.people, confirmed: crew.confirmed });
    const odd = changed(withProps(data.projectId, { state: 'shooting' }));
    expect((projectSummary({ data: odd }).project as { state: string }).state).toBe('active');
    const archived = changed(withProps(data.projectId, { state: 'archived' }));
    expect((projectSummary({ data: archived }).project as { state: string }).state).toBe('archived');
  });

  it('scrubs every string the readers hand back: a cast member’s character name with a phone in it', () => {
    const odd = changed(withProps(IDS.mara, { name: 'MARA (call +1 555 0166)' }));
    const sheet = getCallSheet({ data: odd }, { day: '1' }) as { cast: { characters: string[] }[]; scenes: { characters: { name: string }[] }[] };
    expect(sheet.cast[0]?.characters).toEqual([`MARA (call ${TAKEN_OUT})`]);
    expect(sheet.scenes[0]?.characters[0]?.name).toBe(`MARA (call ${TAKEN_OUT})`);
    expect(everyAnswer({ data: odd })).not.toContain('0166');
  });

  it('finds a scene by its number among the live ones first, then the Trash', () => {
    // The trashed scene takes the live one's number and sorts first: the live one still wins.
    const odd = changed(withProps(IDS.scene13, { number: '12' }, { sortKey: '0' }));
    const shots = listShots({ data: odd }, { scene: '12', include_trashed: true }) as { shots: { number: string }[] };
    expect(shots.shots.map((s) => s.number)).toEqual(['12A', '12B']);
    const plan = getPlan({ data: odd }, { scene: '12' }) as { scene: { id: string } };
    expect(plan.scene.id).toBe(IDS.scene12);
  });

  it('marks a live frame under a trashed scene, listed only with include_trashed', () => {
    const odd = changed(withProps(IDS.shotC, {}, { trashedAt: null, trashedBy: null }));
    const all = listShots({ data: odd }, { include_trashed: true }) as { shots: Record<string, unknown>[] };
    expect(all.shots.find((s) => s.id === IDS.shotC)).toMatchObject({ number: '13A', scene_trashed: true });
    expect(all.shots.find((s) => s.id === IDS.shotC)).not.toHaveProperty('trashed');
    expect(all.shots.find((s) => s.id === IDS.shotA)).not.toHaveProperty('scene_trashed');
    const live = listShots({ data: odd }, {}) as { shots: Record<string, unknown>[] };
    expect(live.shots.map((s) => s.id)).not.toContain(IDS.shotC);
  });

  it('leaves a frame’s own fields out', () => {
    const odd = changed(withProps(IDS.shotA, { custom: { 'Grip note': 'Ask Dana' } }));
    const [shot] = (listShots({ data: odd }, { scene: '12' }) as { shots: Record<string, unknown>[] }).shots;
    expect(shot).not.toHaveProperty('custom');
    expect(everyAnswer({ data: odd })).not.toContain('Ask Dana');
  });
});

describe('no computer zone goes out', () => {
  it('says a location with no typed zone has none, and gives no sun times in a guessed one', () => {
    const odd = changed(withProps(IDS.pier, { time_zone: '' }));
    const sheet = getCallSheet({ data: odd }, { day: '1' }) as { times_in: unknown; locations: { time_zone: unknown; sun: unknown }[] };
    expect(sheet.times_in).toEqual({ zone: null, missing: 'noZone' });
    expect(sheet.locations[0]?.time_zone).toEqual({ zone: null, missing: 'noZone' });
    expect(sheet.locations[0]?.sun).toBeNull();
    expect(JSON.stringify(sheet)).not.toContain(`"${computerTimeZone()}"`);
    // With the zone typed, the sheet gives it and its sun.
    const typed = getCallSheet({ data }, { day: '1' }) as { times_in: unknown; locations: { sun: { sunrise: string } | null }[] };
    expect(typed.times_in).toEqual({ zone: 'America/New_York', from: 'location' });
    expect(typed.locations[0]?.sun?.sunrise).toMatch(/^\d\d:\d\d$/);
  });

  it('gives the hospital’s distance to a whole kilometre', () => {
    // The fixture's pier and hospital are about 1 km apart: worked out from both places, said to the kilometre.
    const sheet = getCallSheet({ data }, { day: '1' }) as { locations: { safety: { hospital: { distance_km: number | null } | null } }[] };
    const distance = sheet.locations[0]?.safety.hospital?.distance_km;
    expect(typeof distance).toBe('number');
    expect(Number.isInteger(distance)).toBe(true);
  });
});

describe('suggestions as the assistant reads them', () => {
  it('scrubs every value of a suggestion’s data, reads it by its real target’s type, and only names known fields', () => {
    const odd = changed(
      suggestion('30000000-0000-4000-8000-000000000001', {
        // Claims a shot; its target is Robin, a person: read as a person's props.
        target_id: IDS.robin,
        target_type: 'shot',
        source: 'web +1 555 0177',
        data: { props: { title: 'DP, cell +1 555 0144', action: 'Call +1 555 0145', phone: '+1 555 0146', 'Robin cell 555 0147': 'x' }, before: {} },
      }),
    );
    const { suggestions } = listSuggestions({ data: odd }, {}) as { suggestions: Record<string, unknown>[] };
    const made = suggestions.find((s) => s.id === '30000000-0000-4000-8000-000000000001');
    expect(made?.data).toEqual({ props: { title: `DP, cell ${TAKEN_OUT}` }, before: {} });
    expect(made?.fields_left_out).toEqual(['phone', '2 unknown fields']);
    expect(made?.source).toBe(`web ${TAKEN_OUT}`);
    const text = JSON.stringify(suggestions);
    for (const digits of ['0144', '0145', '0146', '0147', '0177']) expect(text).not.toContain(digits);
  });

  it('bounds the words a suggestion says of itself', () => {
    const odd = changed(suggestion('30000000-0000-4000-8000-000000000002', { kind: `rewrite ${'x'.repeat(200)}`, target_id: IDS.shotA, target_type: 'shot' }));
    const { suggestions } = listSuggestions({ data: odd }, {}) as { suggestions: { id: string; kind: string }[] };
    expect(suggestions.find((s) => s.id === '30000000-0000-4000-8000-000000000002')?.kind.length).toBeLessThanOrEqual(64);
  });
});

describe('a department marked no (Kevin, Nov 21)', () => {
  const none = new Set<never>();

  it('hides its material from every tool, unless the reader is exempt from that department', () => {
    expect(everyAnswer({ data })).toContain('Boom kit Sennheiser');
    const hidden = everyAnswer({ data, departments: { hidden: new Set(['sound']), exempt: none } });
    expect(hidden).not.toContain('Boom kit Sennheiser');
    expect(hidden).not.toContain(IDS.boom);
    // Another department's material is still there.
    expect(hidden).toContain('SkyPanel S60');
    // Exempt from another department only: still hidden.
    expect(everyAnswer({ data, departments: { hidden: new Set(['sound']), exempt: new Set(['camera']) } })).not.toContain('Boom kit Sennheiser');
    // Given permission by sound, or the director (exempt from every department), still reads it.
    expect(everyAnswer({ data, departments: { hidden: new Set(['sound']), exempt: new Set(['sound']) } })).toContain('Boom kit Sennheiser');
    expect(everyAnswer({ data, departments: { hidden: new Set(['sound']), exempt: new Set(DEPARTMENTS) } })).toContain('Boom kit Sennheiser');
  });

  it('hides what sits under its material too, wherever a tool would show it', () => {
    const hidden = everyAnswer({ data, departments: { hidden: new Set(['grip-electric']), exempt: none } });
    // The panel is grip and electric's: gone from the gear list, the day's gear and the plan's light.
    expect(hidden).not.toContain('SkyPanel S60');
    expect(hidden).not.toContain(IDS.panel);
  });

  it('hides a suggestion whose target is hidden, or whose data names the department', () => {
    const onBoom = suggestion('30000000-0000-4000-8000-000000000003', { target_id: IDS.boom, target_type: 'gear_item', data: { props: { quantity: 2 } } });
    const toSound = suggestion('30000000-0000-4000-8000-000000000004', { target_id: IDS.panel, target_type: 'gear_item', data: { props: { department: 'sound' } } });
    const odd = changed(onBoom, toSound);
    const ids = (departments: ToolContext['departments']) =>
      (listSuggestions({ data: odd, ...(departments ? { departments } : {}) }, { status: 'all' }) as { suggestions: { id: string }[] }).suggestions.map((s) => s.id);
    expect(ids(undefined)).toEqual(expect.arrayContaining([onBoom.id, toSound.id]));
    const hidden = ids({ hidden: new Set(['sound']), exempt: none });
    expect(hidden).not.toContain(onBoom.id);
    expect(hidden).not.toContain(toSound.id);
    expect(hidden).toContain(IDS.lensSuggestion);
    expect(ids({ hidden: new Set(['sound']), exempt: new Set(['sound']) })).toEqual(expect.arrayContaining([onBoom.id, toSound.id]));
  });
});

describe('the server’s last check', () => {
  const refused = (tool: string) => ({ ok: false, text: contactRefused(tool) });

  it('holds back an answer that would carry a contact detail, written any way, and says what to narrow', () => {
    expect(checkedAnswer(data.records, 'list_locations', { name: 'Pier 9' })).toEqual({ ok: true, text: '{"name":"Pier 9"}' });
    for (const value of [
      'call +1 555 0123',
      // The stored phone typed with an en dash, with U+2011 (a non-breaking hyphen), in full-width digits, run together.
      'call 555–0123',
      'call 555\u20110123',
      'call ５５５ ０１２３',
      'call 15550123',
      'ROBIN.VALE@EXAMPLE.COM',
      'robin.vale\uFF20example.com',
      '1200 OCEAN AVENUE',
      '1200  Ocean\u00A0Avenue, Bayport',
      '88 Wharf Street',
      '2026-10-02T07:41:09',
    ]) {
      expect(checkedAnswer(data.records, 'list_shots', { note: value }), value).toEqual(refused('list_shots'));
    }
    // Coordinates to 3 decimals, as stored or cut.
    for (const n of [CONTACTS.latitude, 40.868, 40.867, -73.921, 73.921, CONTACTS.photoLatitude]) {
      expect(checkedAnswer(data.records, 'get_plan', { place: n }), String(n)).toEqual(refused('get_plan'));
    }
    expect(contactRefused('list_shots')).toMatch(/^list_shots: .*one scene or one shoot day/);
    expect(contactRefused('get_plan')).toMatch(/^get_plan: .*one setup/);
  });

  it('never refuses for what isn’t contact-shaped: names, a client’s name, custom values, parking text, a map’s name', () => {
    // The five false refusals round 1 made: each value is a left-out prop of the fixture, matched as a whole string.
    for (const value of [
      // A crew member who shares a location contact's name.
      CONTACTS.contactName,
      // The client's name as a gear item's owner.
      'Bayport Tourism',
      // A person's own field's value in a frame's action.
      CONTACTS.personCustom,
      // The parking text, said in a call sheet's notes.
      CONTACTS.parking,
      // The map's name for the place, as a location's name.
      CONTACTS.mapName,
      // And a person's notes, a length, a time, a date.
      'Prefers texts.',
      '40.5',
      '2026-11-18',
    ]) {
      expect(checkedAnswer(data.records, 'list_people', { name: value }).ok, value).toBe(true);
    }
  });

  it('passes every tool’s answer', () => {
    for (const [tool, answer] of Object.entries(JSON.parse(everyAnswer({ data })) as unknown[])) expect(checkedAnswer(data.records, tool, answer).ok, tool).toBe(true);
  });
});

describe('the file, read as one snapshot', () => {
  it('says "saving right now" when the app holds the file for a save', async () => {
    const path = folder.path('Busy.sbd');
    copyFileSync(folder.path('Harbor Lights.sbd'), path);
    const app = new DatabaseSync(path);
    app.exec('BEGIN EXCLUSIVE');
    try {
      await expect(readProject(path)).rejects.toThrow(SAVING);
    } finally {
      app.exec('ROLLBACK');
      app.close();
    }
    // Once the save is done, it reads.
    await expect(readProject(path)).resolves.toMatchObject({ projectId: data.projectId });
  }, 20_000);

  it('says "open it in Storiiboard once" for a file left mid-save (a hot journal), and leaves the journal as it is', async () => {
    const path = folder.path('Mid save.sbd');
    copyFileSync(folder.path('Harbor Lights.sbd'), path);
    // A save cut off: a process starts writing and is killed before it commits, leaving its journal beside the file. A
    // small cache makes SQLite spill the save to the file (and its journal to disk) before the commit.
    const child = spawn(
      process.execPath,
      [
        '-e',
        "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(process.argv[1]); db.exec('PRAGMA cache_size = 1'); db.exec('BEGIN'); " +
          "db.exec('CREATE TABLE ballast (x)'); for (let i = 0; i < 200; i += 1) db.prepare('INSERT INTO ballast VALUES (?)').run('x'.repeat(2000)); " +
          "process.stdout.write('ready'); setInterval(() => {}, 1000);",
        path,
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    await new Promise<void>((resolve, reject) => {
      child.stdout.on('data', () => {
        resolve();
      });
      child.on('exit', () => {
        reject(new Error('The writer ended before it was ready.'));
      });
    });
    const exited = new Promise((resolve) => child.on('exit', resolve));
    child.kill('SIGKILL');
    await exited;
    const journal = readdirSync(folder.dir).filter((name) => name === 'Mid save.sbd-journal');
    expect(journal).toEqual(['Mid save.sbd-journal']);
    await expect(readProject(path)).rejects.toThrow(OPEN_ONCE);
    expect(readdirSync(folder.dir).filter((name) => name.startsWith('Mid save'))).toEqual(['Mid save.sbd', 'Mid save.sbd-journal']);
  }, 20_000);
});
