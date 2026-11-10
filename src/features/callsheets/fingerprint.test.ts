import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../core/i18n';
import { callSheet, issueStamp } from '../../core/model/callsheet';
import type { Props, SbdRecord } from '../../core/model/record';
import { callSheetFingerprint, changedSince, FINGERPRINT_VERSION, hasRecipe, printedJson, stableJson } from './fingerprint';

// "Changed since issued" (4.7): the fingerprint moves with what the PDF prints, and with nothing else.

const at = '2026-11-10T10:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props, sortKey = 'm'): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey,
  props,
  trashedAt: null,
  trashedBy: null,
  createdAt: at,
  updatedAt: at,
});
const recordsOf = (...list: SbdRecord[]) => Object.fromEntries(list.map((r) => [r.id, r]));

function base(opts: { sheet?: Props; day?: Props; loc?: Props; ana?: Props; extra?: SbdRecord[] } = {}) {
  return recordsOf(
    record('p', 'project', null, { title: 'Bey County' }),
    record('d', 'shoot_day', 'p', { date: '2030-11-16', call_time: '07:00', wrap_time: '19:00', ...opts.day }),
    record('cs', 'callsheet', 'd', { notes: 'Park behind', ...opts.sheet }),
    record('loc', 'location', 'p', { name: 'Diner', address: '12 Route 9', latitude: 40.7, longitude: -74, ...opts.loc }),
    record('mary', 'character', 'p', { name: 'MARY', cast_id: 'ana' }),
    record('s1', 'scene', 'p', { number: '1', name: 'Diner', location_id: 'loc', character_ids: ['mary'] }),
    record('a', 'shot', 's1', { number: '1A', shoot_day_id: 'd' }),
    record('ana', 'person', 'p', { name: 'Ana Ruiz', role: 'cast', departments: ['cast'], phone: '555 0101', ...opts.ana }),
    record('kev', 'person', 'p', { name: 'Kevin Matos', role: 'dp', departments: ['camera'], phone: '555 0102', title: 'DP' }),
    ...(opts.extra ?? []),
  );
}
const zones = new Map<string, string | null>([['loc', 'America/New_York']]);
const hash = async (records: ReturnType<typeof base>, app: 'google' | 'apple' | 'osm' = 'google', name = 'Bey County') => {
  const sheet = callSheet(records, 'p', 'd', undefined, zones);
  if (!sheet) throw new Error('no sheet');
  return callSheetFingerprint(sheet, app, name);
};

afterEach(() => {
  setLocale('en');
});

describe('stable JSON', () => {
  it('is the same text whatever order the keys were made in', () => {
    expect(stableJson({ b: 1, a: { d: [2, { y: 1, x: 2 }], c: null } })).toBe(stableJson({ a: { c: null, d: [2, { x: 2, y: 1 }] }, b: 1 }));
    expect(stableJson({ a: [1, 2] })).not.toBe(stableJson({ a: [2, 1] }));
  });
});

describe('the fingerprint of a call sheet', () => {
  it('is the same for the same data, and stays when props are written in another order', async () => {
    const one = await hash(base());
    expect(one).toMatch(/^[0-9a-f]{64}$/);
    expect(await hash(base())).toBe(one);
    expect(await hash(base({ loc: { longitude: -74, latitude: 40.7, address: '12 Route 9', name: 'Diner' } }))).toBe(one);
  });

  it('holds no weather: the forecast, its fetch time and its expiry are not part of what is hashed', () => {
    const sheet = callSheet(base(), 'p', 'd', undefined, zones);
    if (!sheet) throw new Error('no sheet');
    expect(printedJson(sheet, 'google', 'Bey County')).not.toMatch(/forecast|weather|fetched|expires|precipitation/i);
  });

  it('does not change with the language, or with locking the day’s scenes (what issuing does)', async () => {
    const one = await hash(base());
    setLocale('es');
    expect(await hash(base())).toBe(one);
    setLocale('en');
    const locked = base();
    locked.s1 = record('s1', 'scene', 'p', { number: '1', name: 'Diner', location_id: 'loc', character_ids: ['mary'], numbers_locked: true });
    expect(await hash(locked)).toBe(one);
  });

  it('changes with a call time, a note, a scene added, a hospital, a contact switch, an address, a date', async () => {
    const one = await hash(base());
    const changed = [
      base({ day: { call_time: '06:30' } }),
      base({ sheet: { notes: 'Park in lot B' } }),
      base({ sheet: { person_times: { ana: { call: '09:15' } } } }),
      base({ extra: [record('s9', 'scene', 'p', { number: '9', name: 'Roof' }), record('z', 'shot', 's9', { number: '9A', shoot_day_id: 'd' })] }),
      base({ loc: { hospital_name: 'County General' } }),
      base({ ana: { contact_on_sheet: true } }),
      base({ loc: { address: '14 Route 9' } }),
      base({ day: { date: '2030-11-17' } }),
      base({ extra: [record('kev', 'person', 'p', { name: 'Kevin Matos', role: 'producer', departments: ['camera'], phone: '555 0102', title: 'DP' })] }),
    ];
    const hashes = await Promise.all(changed.map((records) => hash(records)));
    for (const other of hashes) expect(other).not.toBe(one);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it('changes with the map app, whose link is printed', async () => {
    expect(await hash(base(), 'apple')).not.toBe(await hash(base(), 'google'));
  });
});

describe('changed since issued', () => {
  const sheetOf = (records: ReturnType<typeof base>) => {
    const sheet = callSheet(records, 'p', 'd', undefined, zones);
    if (!sheet) throw new Error('no sheet');
    return sheet;
  };

  it('compares the newest issue’s fingerprint with the sheet’s, by the issue’s own recipe', async () => {
    const fingerprint = await hash(base());
    const issue = { fingerprint, fingerprintVersion: FINGERPRINT_VERSION };
    expect(await changedSince(issue, sheetOf(base()), 'google', 'Bey County')).toBe(false);
    expect(await changedSince(issue, sheetOf(base({ day: { call_time: '06:30' } })), 'google', 'Bey County')).toBe(true);
  });

  it('cannot say for a version this app has no recipe for, or none stored: null, never "unchanged"', async () => {
    const sheet = sheetOf(base());
    expect(hasRecipe(FINGERPRINT_VERSION)).toBe(true);
    expect(hasRecipe(FINGERPRINT_VERSION + 1)).toBe(false);
    expect(await changedSince({ fingerprint: 'a', fingerprintVersion: FINGERPRINT_VERSION + 1 }, sheet, 'google', 'Bey County')).toBeNull();
    expect(await changedSince({ fingerprint: 'a', fingerprintVersion: null }, sheet, 'google', 'Bey County')).toBeNull();
    expect(await changedSince({ fingerprint: '', fingerprintVersion: FINGERPRINT_VERSION }, sheet, 'google', 'Bey County')).toBeNull();
  });
});

describe('the frozen recipe', () => {
  // Any edit to recipe 1 changes this string and fails here: a change to what the sheet hashes is a new recipe under a
  // new fingerprint_version, never an edit of version 1, or every issue already made would read as changed.
  it('recipe 1 gives the same fingerprint for the same records, always', async () => {
    expect(await hash(base())).toBe('2c7c695176232706f4134e9fbd989c79c46ce91dd849eef5182cc2ecd5301d50');
  });

  it('recipe 1 on a full sheet: hospital with place, country, contacts, calls, a second location, a person time', async () => {
    const records = base({
      sheet: { notes: 'Park behind', safety_notes: 'Hard hats', department_calls: { camera: '06:30' }, person_times: { ana: { call: '06:45', hmu_ready: '06:00', on_set: '08:00' } } },
      loc: { status: 'confirmed', parking: 'Lot B', power: '2x20A', contact_name: 'Rosa', contact_phone: '555 0199', country_code: 'US', hospital_name: 'County General', hospital_address: '1 Main St', hospital_phone: '555 0100', hospital_latitude: 40.75, hospital_longitude: -73.99, hospital_emergency: true, hospital_source: 'osm' },
      ana: { contact_on_sheet: true, email: 'ana@example.com' },
      extra: [
        record('loc2', 'location', 'p', { name: 'Parking lot', address: '3 Side St', latitude: 40.71, longitude: -74.01 }),
        record('b', 'shot', 's1', { number: '1B', shoot_day_id: 'd', location_id: 'loc2' }),
      ],
    });
    expect(await hash(records)).toBe('a8d656f7b04fa31ab23742717c8380303953a7916837a2f8c3367f2787648bc1');
  });

  it('never hashes the name of a zone found from the map or taken from this computer, only one typed on the location', () => {
    // Two computers in different zones share a file: CI (UTC) and a laptop (New York) once disagreed here.
    const records = base({ extra: [record('loc2', 'location', 'p', { name: 'Parking lot' }), record('b', 'shot', 's1', { number: '1B', shoot_day_id: 'd', location_id: 'loc2' })] });
    const sheet = callSheet(records, 'p', 'd', undefined, zones);
    if (!sheet) throw new Error('no sheet');
    const json = JSON.parse(printedJson(sheet, 'google', 'Bey County')) as { locations: { id: string; zone: unknown }[] };
    expect(json.locations.find((l) => l.id === 'loc2')?.zone).toEqual({ source: 'computer' });
    expect(json.locations.find((l) => l.id === 'loc')?.zone).toEqual({ source: 'map' });
    const typed = callSheet(base({ loc: { time_zone: 'America/Chicago' } }), 'p', 'd', undefined, zones);
    if (!typed) throw new Error('no sheet');
    const typedJson = JSON.parse(printedJson(typed, 'google', 'Bey County')) as { locations: { id: string; zone: unknown }[] };
    expect(typedJson.locations.find((l) => l.id === 'loc')?.zone).toEqual({ zone: 'America/Chicago', source: 'location' });
  });

  it('does not read what the code works out: the emergency number table, the sun, the distance, the link', () => {
    const sheet = callSheet(base({ loc: { country_code: 'PE', hospital_name: 'County General', hospital_latitude: 40.8, hospital_longitude: -74 } }), 'p', 'd', undefined, zones);
    if (!sheet) throw new Error('no sheet');
    const json = printedJson(sheet, 'google', 'Bey County');
    expect(json).not.toMatch(/google\.com|maps\.apple|sunrise|golden|distanceKm|"106"/);
    expect(json).toContain('"country":"PE"');
  });
});

describe('the header’s issue line', () => {
  const when = new Date('2030-11-16T23:04:00Z');

  it('reads "Version 1 · Issued …" and "Revised · Version 2 · Issued …" in the sheet’s zone, with its short name', () => {
    expect(issueStamp(1, when, 'America/New_York')).toBe('Version 1 · Issued Sat, Nov 16 18:04 EST');
    expect(issueStamp(2, when, 'America/New_York')).toBe('Revised · Version 2 · Issued Sat, Nov 16 18:04 EST');
    expect(issueStamp(3, when, 'America/Los_Angeles')).toBe('Revised · Version 3 · Issued Sat, Nov 16 15:04 PST');
  });

  it('says it in Spanish', () => {
    setLocale('es');
    expect(issueStamp(1, when, 'America/New_York')).toMatch(/^Versión 1 · Emitida sáb,? 16 nov,? 18:04/);
    expect(issueStamp(2, when, 'America/New_York')).toMatch(/^Revisada · Versión 2 · Emitida /);
  });

  it('uses this computer’s zone when the sheet has none', () => {
    expect(issueStamp(1, when, null)).toMatch(/^Version 1 · Issued \w{3}, \w{3} \d{1,2} \d\d:\d\d \S+/);
  });
});

describe('the map image (4.10)', () => {
  it('is not part of the fingerprint (it comes from tiles, not from an edit), while the place that centres it is', async () => {
    const one = await hash(base({ loc: { map_name: 'Diner, NJ' } }));
    // The recipe takes the sheet, the map app and the title: no tiles, credit or map state can reach it.
    expect(callSheetFingerprint.length).toBe(3);
    const sheet = callSheet(base({ loc: { map_name: 'Diner, NJ' } }), 'p', 'd', undefined, zones);
    if (!sheet) throw new Error('no sheet');
    expect(printedJson(sheet, 'google', 'Bey County')).not.toMatch(/tile|credit|mapimage/i);
    expect(await hash(base({ loc: { map_name: 'Diner, NJ' } }))).toBe(one);
    expect(await hash(base({ loc: { map_name: 'Diner, NJ', latitude: 40.8 } }))).not.toBe(one);
    expect(FINGERPRINT_VERSION).toBe(1);
  });
});
