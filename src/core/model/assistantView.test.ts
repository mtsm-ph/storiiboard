import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ASSISTANT_PROPS, assistantView, contactGuard, digitsOf, givenProps, suggestionFieldsLeftOut, TAKEN_OUT, withoutContacts, withoutStoredContacts } from './assistantView';
import { RECORD_TYPES, type Props, type RecordType, type SbdRecord } from './record';

// What an assistant may read (7.5): every prop of every record type, given or left out, listed here in full, so a change
// to what an assistant reads is a change to this test; and every prop the app's code reads, found in the source, must be
// in the table, so a new prop fails here until someone decides whether an assistant may read it.

/** Every record type's props: given, and left out with why, in the table's order. */
const EVERY_PROP: Record<RecordType, { given: string[]; leftOut: string[] }> = {
  project: {
    given: [
      'title name notes state stage logline format runtime deliverables aspect_ratio shot_letters_allow_io',
      'setup_minutes hmu_minutes currency company',
    ],
    leftOut: ['client:contact theme:look watermark:look'],
  },
  scene: {
    given: ['number name heading int_ext day_night location_id page_eighths character_ids characters numbers_locked', 'room_id'],
    leftOut: ['department_approvals:bookkeeping palette:look'],
  },
  shot: {
    given: [
      'number title size lens_mm lens_id t_stop support height move status action dialogue department_status',
      'departments media_id shoot_day_id setup_id location_id gear_ids',
    ],
    // Round 2: a frame's own fields are left out, as a person's and a location's are.
    leftOut: ['crop:look clip:file custom:contact'],
  },
  setup: { given: ['name'], leftOut: [] },
  note: { given: ['text'], leftOut: [] },
  character: { given: ['name cast_id'], leftOut: [] },
  stroke: { given: [], leftOut: ['tool:not_read points:not_read width:not_read pressures:not_read'] },
  media: {
    given: [],
    leftOut: [
      'kind:file file:file mime:file width:file height:file color_space:file source_name:file source_path:file',
      'source_size:file byte_size:file url:file title:file role:file duration_frames:file fps:file',
      'start_timecode:file sar:file rotation:file codec:file has_audio:file hdr:file bit_depth:file poster:file',
      'lut:file from_video:file taken_at:place taken_offset:place gps_latitude:place gps_longitude:place',
      'issue_version:file issued_at:file issued_by:file issued_zone:file fingerprint:bookkeeping',
      'fingerprint_version:bookkeeping',
    ],
  },
  location: {
    given: [
      'name status power notes time_zone country_code hospital_name hospital_emergency hospital_source map_moved',
      'light_photo_id',
    ],
    leftOut: [
      'address:contact contact_name:contact contact_phone:contact contact_email:contact parking:contact',
      'hospital_address:contact hospital_phone:contact custom:contact latitude:place longitude:place map_name:place',
      'hospital_latitude:place hospital_longitude:place',
    ],
  },
  person: {
    given: ['name role departments title full_view'],
    leftOut: ['phone:contact email:contact contact_on_sheet:contact notes:contact custom:contact'],
  },
  department: { given: [], leftOut: ['name:not_read'] },
  gear_item: {
    given: [
      'name department quantity source owner day_rate notes kind sensor_width_mm sensor_height_mm sensor_mode',
      'camera_letter focal_equivalent focal_min_mm focal_max_mm squeeze watts',
    ],
    leftOut: [],
  },
  shoot_day: { given: ['date call_time wrap_time notes crew people_ids gear_ids'], leftOut: [] },
  callsheet: { given: ['notes safety_notes department_calls person_times'], leftOut: [] },
  plan: { given: ['kind name location_id ceiling_height_m'], leftOut: [] },
  plan_item: {
    given: [
      'kind x y width height rotation locked name height_m icon points from to wall_id along_m width_m hinge swing',
      'sill_height_m top_height_m body_id shot_ids shown_shot_id lens_mm lens_id on_side stop_at_walls gear_id watts',
      'beam_deg time own_date at_photo character_id camera_id order media_id scaled scale_m',
    ],
    leftOut: ['own_latitude:place own_longitude:place copied_from:bookkeeping'],
  },
  board: {
    given: [],
    leftOut: [
      'name:not_read kind:not_read department:not_read page_format:not_read page_orientation:not_read',
      'scene_ids:not_read location_ids:not_read character_ids:not_read background:not_read',
    ],
  },
  board_item: {
    given: [],
    leftOut: [
      'kind:not_read x:not_read y:not_read width:not_read height:not_read rotation:not_read text:not_read',
      'title:not_read label:not_read color:not_read fill:not_read stroke:not_read font_family:not_read',
      'font_size:not_read font_weight:not_read font_italic:not_read align:not_read media_id:not_read file:not_read',
      'source_name:not_read source_path:not_read url:not_read shot_id:not_read scene_id:not_read field:not_read',
      'from:not_read to:not_read route:not_read start_head:not_read end_head:not_read orientation:not_read',
      'crop:not_read border:not_read border_color:not_read border_width:not_read poster:not_read',
    ],
  },
  design: { given: [], leftOut: [] },
  comment: { given: [], leftOut: [] },
  suggestion: {
    given: [
      'kind target_id target_type target_label target_updated_at status source change_file_id author note data',
      'suggested_at decided_by decided_at created_id after_suggestion',
    ],
    leftOut: [],
  },
  availability: { given: [], leftOut: ['person_id:not_read date:not_read dates:not_read'] },
  settings_preset: { given: [], leftOut: ['name:look settings:look'] },
};

const split = (lines: readonly string[]) =>
  lines
    .join(' ')
    .split(' ')
    .filter((word) => word !== '');

const root = join(import.meta.dirname, '../../..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.ts$/.test(name) && !/\.test\.ts$|\.d\.ts$/.test(name)) out.push(path);
  }
  return out;
}

/** Names read off something called props that aren't a record's props: an array's or a Map's own methods. */
const NOT_PROPS = new Set(['every', 'map', 'length', 'get', 'has', 'includes']);

const record = (type: RecordType, props: Props, trashedAt: string | null = null): SbdRecord => ({
  id: `${type}-${trashedAt ?? 'live'}`,
  type,
  parentId: null,
  sortKey: 'a',
  props,
  trashedAt,
  trashedBy: trashedAt === null ? null : 'local',
  createdAt: '2026-11-21T10:00:00.000Z',
  updatedAt: '2026-11-21T10:00:00.000Z',
});

const ROUND_2_SCRUBBED = [
  // Phones: a leading + or (, a last group of 4 or more, one run of 10 or more; any dash, dots, slashes, spaces.
  '+1 555 0123',
  '+1 (555) 012-3456',
  '(555) 012-3456',
  '555-0123',
  '555 0123',
  '555.0123',
  '555/0123',
  '5550123456',
  '+15550123',
  '+44 20 7946 09',
  '+1 555–0123',
  '+1 555‑0123',
  '555​-0123',
  '+1 555­ 0123',
  '＋１ ５５５ ０１２３',
  '٥٥٥ ٠١٢٣',
  '4111 1111 1111 1111 1111',
  // Emails, with an @ or a lookalike.
  'robin.vale@example.com',
  'robin.vale＠example.com',
  'robin.vale﹫example.com',
  'robin.vale (at) example.com',
  'robin.vale [at] example (dot) com',
  'robin.vale at example.com',
  'ROBIN at harbor.example',
  // Coordinates: a pair of decimals of 4 or more places (round 3; round 2's 3 places is in ROUND_2_KEPT now), or
  // degrees, minutes and seconds.
  '40.867712, -73.921234',
  '40.8677 -73.9212',
  '40.8677° N, 73.9212° W',
  `40°52'03.8"N`,
  '40° 52′ 3″ N',
  // Map links.
  'https://maps.google.com/?q=40.8,-73.9',
  'https://goo.gl/maps/abc123',
  'https://maps.app.goo.gl/xyz',
  'https://maps.apple.com/?ll=40.8,-73.9',
  'https://www.openstreetmap.org/#map=17/40.8/-73.9',
  'https://osm.org/go/ZWp',
];

const ROUND_2_KEPT = [
  // Dates, with or without a time after.
  '2026-11-18',
  '18.11.2026',
  '18-11-2026',
  '11/18/2026',
  '2026-11-18 06:30',
  '18.11.2026 06:30',
  '18-11-2026 06.30',
  '2026-11-17T10:00:00.000Z',
  // A range of two groups.
  '1001-1096',
  '1001–1096',
  // Groups whose last is under 4 digits.
  '101 102 103',
  '1 250 000',
  '18 25 35 50 85',
  '555.0123.88',
  // Short or single numbers, lengths, times, stops, pages, lenses, slates, ids.
  '1234567',
  '4417',
  '4.5 m',
  '06:30',
  'T2.8',
  '1 3/8',
  '24-70',
  'SC 12A',
  '40.8',
  '10000000-0000-4000-8000-000000000003',
  'Meet at the pier.',
  'Gate opens at 5. Night',
  // Round 3: a pair of 3 places each is a pair of numbers, not a place (frame rates, ratios).
  '40.867;-73.921',
];

/** Round 3's cases (items 4 to 7 of its brief, and the review's innocent film text). */
const ROUND_3_SCRUBBED = [
  // Phones: 3 or more groups starting with 0; 3-3-3 or one run of 9 starting with 6 to 9.
  '06 12 34 56 78',
  '079 123 45 67',
  '0475 12 34 56',
  '612 345 678',
  '612345678',
  // Joins: any \p{Zs}, −, ·, a spaced dash, two spaces.
  '555 0123',
  '555　0123',
  '555 0123',
  '555−0123',
  '555·0123',
  '555 - 0123',
  '555  0123',
  // Coordinates, 4 places each, on Earth.
  '-33.8688, 151.2093',
  '89.9999 179.9999',
  // Map links, each with what follows it.
  'https://www.google.com/maps/place/Pier+9/@40.8677,-73.9212,17z/data=!3m1!4b1!4m6!3m5!1s0x89c2f:0x1a2b!8m2!3d40.8677!4d-73.9212',
  'google.es/maps?q=Madrid',
  'https://www.google.co.uk/maps/@51.5,-0.12,15z',
  'https://share.google/AbC123',
  'https://waze.com/ul?ll=40.8,-73.9',
  'https://www.bing.com/maps?cp=40.8~-73.9',
  '///filled.count.soap',
  'https://w3w.co/filled.count.soap',
  '849VCWC8+R9',
  'CWC8+R9',
  // Emails, with words for the signs, or spaces around them.
  'name at example dot com',
  'robin.vale @ example . com',
  'robin.vale@example dot com',
  'robin (at) example (dot) com',
];

const ROUND_3_KEPT = [
  // Two groups of four (night hours, ranges), and ranges of two groups.
  '1830-0630',
  '2234-5678',
  '1001-1096',
  '993-1104',
  // Film text the review named.
  '12A',
  '01:02:03:04',
  '24-70mm',
  'T2.8',
  '4K',
  '$12,500',
  '1 250 000',
  '2026-11-17T10:00:00.000Z',
  '2026-11-17T10:00:00Z',
  'Day 3 of 12',
  '101 102 103',
  '23.976, 29.970',
  '1.333 / 1.500',
  '2026-004512',
  "Meet at St.Mary's",
  'DM @harbor.lights',
  // A pair off the Earth's ranges either way round (round 4: 95.1234, 10.1234 is a longitude and a latitude), and a
  // sum that only looks like a plus code.
  '95.1234, 99.1234',
  '2345+67',
];

/** Round 4's cases (items 1 to 4, 6 and 7 of its brief), each as `see … please`. */
const ROUND_4_SCRUBBED = [
  // Spain's and Poland's phones: 9 digits starting with 5 to 9 in 3 or more groups of 2 or 3.
  '612 34 56 78',
  '912 34 56 78',
  '91 123 45 67',
  '512 345 678',
  // Coordinates, longitude first.
  '-118.2437, 34.0522',
  // Map links to the next whitespace: an apostrophe and brackets in a place's name; Apple's short links.
  "https://www.google.com/maps/place/St+Mary's+Church/@40.8677,-73.9212,17z/data=!3m1!4b1!4m6!3m5!1s0x89c2f:0x1a2b!8m2!3d40.8677!4d-73.9212",
  'https://www.google.com/maps/place/Pier+9+(North)/@40.8677,-73.9212,17z',
  'https://maps.apple/p/AbC123xyz',
  // Emails with a spelled-out dot ending in a common top-level domain.
  'robin at example dot co dot uk',
  'robin (at) example (dot) es',
];

const ROUND_4_KEPT = [
  // "@" for "at", a sentence's full stop after it.
  'Crew call @ 0630. Shooting call @ 0730.',
  'Lunch @ 12. Wrap',
  'Meet @ base. Then',
  // "dot" as a word.
  'Eyeline at the dot on the C-stand',
  'Mark at blue dot in front of the door',
  // Groups that aren't Spain's or Poland's phones; ISO steps; a lens; a decimal of 5 or more places.
  '101 102 103',
  '1 250 000',
  '18 25 35 50 85',
  '555.0123.88',
  'ISO 800 1600 3200',
  'iso 100 200 400 800 1600',
  '85mm+2x',
  '1.777778',
  '2.390000',
];

/** Round 4's cases whose text around the match stays: quotes and an apostrophe, a sentence's bracket, a rejected pair. */
const ROUND_4_AROUND: readonly (readonly [string, string])[] = [
  ["see 'robin@example.com' please", `see '${TAKEN_OUT}' please`],
  ['‘robin.vale@example.com’', `‘${TAKEN_OUT}’`],
  ["robin@example.com's", `${TAKEN_OUT}'s`],
  ['"robin @ example . com"', `"${TAKEN_OUT}"`],
  ['(see https://maps.google.com/?q=Pier+9+(North))', `(see ${TAKEN_OUT})`],
  ['190.12345, 40.8677 -73.9212', `190.12345, ${TAKEN_OUT}`],
  ['95.1234, 99.1234 40.8677', `95.1234, ${TAKEN_OUT}`],
];

describe('the assistant view', () => {
  it('says, for every prop of every record type, whether an assistant is given it or why not', () => {
    expect(Object.keys(ASSISTANT_PROPS).sort()).toEqual([...RECORD_TYPES].sort());
    for (const type of RECORD_TYPES) {
      const rule = ASSISTANT_PROPS[type];
      const expected = EVERY_PROP[type];
      expect(Object.keys(rule.given), type).toEqual(split(expected.given));
      expect(
        Object.entries(rule.leftOut).map(([prop, why]) => `${prop}:${why}`),
        type,
      ).toEqual(split(expected.leftOut));
      // No prop is both.
      expect(
        Object.keys(rule.given).filter((prop) => Object.hasOwn(rule.leftOut, prop)),
        type,
      ).toEqual([]);
    }
  });

  it('has every prop the app reads in the table, so a new one is decided before an assistant can read it', () => {
    const decided = new Set(RECORD_TYPES.flatMap((type) => [...Object.keys(ASSISTANT_PROPS[type].given), ...Object.keys(ASSISTANT_PROPS[type].leftOut)]));
    const read = new Set<string>();
    for (const path of [...sourceFiles(join(root, 'src', 'core')), ...sourceFiles(join(root, 'src', 'features'))]) {
      for (const match of readFileSync(path, 'utf8').matchAll(/\bprops\??\.([a-z_][a-z0-9_]*)/g)) {
        const name = match[1];
        if (name !== undefined && !NOT_PROPS.has(name)) read.add(name);
      }
    }
    expect(read.size).toBeGreaterThan(150);
    expect([...read].filter((prop) => !decided.has(prop)).sort()).toEqual([]);
  });

  it('never gives a contact detail: phones, emails, addresses, contacts, parking, places and a photo’s time', () => {
    for (const type of RECORD_TYPES) {
      const given = Object.keys(ASSISTANT_PROPS[type].given);
      expect(
        given.filter((prop) => /phone|email|address|contact|parking|latitude|longitude|gps|taken_|map_name|client/.test(prop)),
        type,
      ).toEqual([]);
    }
    expect(ASSISTANT_PROPS.person.leftOut).toMatchObject({ phone: 'contact', email: 'contact', contact_on_sheet: 'contact' });
    expect(ASSISTANT_PROPS.location.leftOut).toMatchObject({
      address: 'contact',
      parking: 'contact',
      latitude: 'place',
      longitude: 'place',
      hospital_address: 'contact',
      hospital_phone: 'contact',
    });
    expect(ASSISTANT_PROPS.media.leftOut).toMatchObject({ taken_at: 'place', gps_latitude: 'place', gps_longitude: 'place' });
  });

  it('gives only the props its rule gives: a company’s name, never its contact; a prop it doesn’t know, never', () => {
    const project = { title: 'Harbor Lights', company: { name: 'Harbor Pictures', phone: '+1 555 0199' }, client: { name: 'Sam' }, later_prop: 1 };
    expect(givenProps('project', project)).toEqual({ title: 'Harbor Lights', company: { name: 'Harbor Pictures' } });
    expect(givenProps('person', { name: 'Robin Vale', phone: '+1 555 0123', email: 'robin@example.com', role: 'dp' })).toEqual({ name: 'Robin Vale', role: 'dp' });
    expect(givenProps('a_later_type', { name: 'x' })).toEqual({});
  });

  it('takes emails and phone numbers out of free text, and leaves dates, times and lengths', () => {
    // Round 2: the email's rule ends at its last letter, so the sentence keeps its full stop.
    expect(withoutContacts('Call Robin on +1 (555) 012-3456 or robin.vale@example.com.')).toBe(`Call Robin on ${TAKEN_OUT} or ${TAKEN_OUT}.`);
    // Round 2: groups whose last has under 4 digits are never a phone without a + or (.
    expect(withoutContacts('Gate code 4417, call 555.0123.88')).toBe('Gate code 4417, call 555.0123.88');
    expect(withoutContacts('Shoot 2026-11-18 at 06:30, 4.5 m from the wall, T2.8')).toBe('Shoot 2026-11-18 at 06:30, 4.5 m from the wall, T2.8');
  });

  it('scrubs free text by every rule, Unicode-aware, and keeps what only looks like a number (round 2)', () => {
    const scrubbed = ROUND_2_SCRUBBED;
    for (const value of scrubbed) expect(withoutContacts(`see ${value} please`), value).toBe(`see ${TAKEN_OUT} please`);
    const kept = ROUND_2_KEPT;
    for (const value of kept) expect(withoutContacts(`see ${value} please`), value).toBe(`see ${value} please`);
    // A closing bracket the number didn't open stays with the sentence.
    expect(withoutContacts('MARA (call +1 555 0166)')).toBe(`MARA (call ${TAKEN_OUT})`);
  });

  it('leaves the Trash out unless asked, and gives a suggestion’s fields by its target’s type', () => {
    const live = record('person', { name: 'Robin Vale' });
    const gone = record('scene', { number: '13' }, '2026-11-20T10:00:00.000Z');
    const suggestion = record('suggestion', { kind: 'update', target_type: 'person', data: { props: { phone: '+1 555 0999', title: 'DP' }, before: { email: 'a@b.example' } } });
    const records = { [live.id]: live, [gone.id]: gone, [suggestion.id]: suggestion };
    expect(Object.keys(assistantView(records).given).sort()).toEqual([live.id, suggestion.id].sort());
    expect(Object.keys(assistantView(records, { includeTrashed: true }).given)).toContain(gone.id);
    expect(assistantView(records).given[suggestion.id]?.props.data).toEqual({ props: { title: 'DP' }, before: {} });
  });

  it('reads a suggestion’s data by its real target’s type, every value scrubbed, naming only known fields', () => {
    const person = record('person', { name: 'Robin Vale' });
    // Says it acts on a shot; its target is a person.
    const suggestion = record('suggestion', {
      target_id: person.id,
      target_type: 'shot',
      data: { props: { title: 'DP +1 555 0144', action: 'x', phone: '+1 555 0145', 'Cell 555 0146': 'y' }, before: { title: 'Gaffer' }, parent_id: 'call 555-0147' },
    });
    const records = { [person.id]: person, [suggestion.id]: suggestion };
    // Round 4: a parent_id that isn't an id is left out.
    expect(assistantView(records).given[suggestion.id]?.props.data).toEqual({ props: { title: `DP ${TAKEN_OUT}` }, before: { title: 'Gaffer' } });
    expect(suggestionFieldsLeftOut(records, suggestion)).toEqual(['phone', '2 unknown fields']);
    // With no target in the project, read by the type it says.
    const loose = record('suggestion', { target_id: 'gone', target_type: 'shot', data: { props: { action: 'Her hands', phone: '1' } } });
    expect(assistantView({ [loose.id]: loose }).given[loose.id]?.props.data).toEqual({ props: { action: 'Her hands' } });
    expect(suggestionFieldsLeftOut({ [loose.id]: loose }, loose)).toEqual(['1 unknown field']);
  });

  it('gives a suggestion’s type and ids only as text of at most 100 characters, or null (round 3)', () => {
    const data = (props: Props) => assistantView({ s: { ...record('suggestion', { target_type: 'shot', data: props }), id: 's' } }).given.s?.props.data;
    // Round 4: the two ids only as canonical UUIDs (or null); 100 characters of anything else is left out.
    expect(data({ type: 'shot', parent_id: null, after_id: 'x'.repeat(100) })).toEqual({ type: 'shot', parent_id: null });
    expect(data({ type: { phone: '+1 555 0123' }, parent_id: 'x'.repeat(101), after_id: 12 })).toEqual({});
    expect(data({ type: ['shot'], parent_id: true })).toEqual({});
  });

  it('gives a suggestion’s parent_id and after_id only as UUIDs (round 4)', () => {
    const data = (props: Props) => assistantView({ s: { ...record('suggestion', { target_type: 'shot', data: props }), id: 's' } }).given.s?.props.data;
    const id = '10000000-0000-4000-8000-000000000006';
    expect(data({ parent_id: id, after_id: id.toUpperCase() })).toEqual({ parent_id: id, after_id: id.toUpperCase() });
    expect(data({ parent_id: `${id} `, after_id: 'Robin 612 34 56 78' })).toEqual({});
    expect(data({ parent_id: '10000000-0000-4000-8000-00000000000', after_id: '' })).toEqual({});
  });

  it('scrubs every case of round 4, and keeps "@" and "dot" as words (round 4)', () => {
    for (const value of ROUND_4_SCRUBBED) expect(withoutContacts(`see ${value} please`), value).toBe(`see ${TAKEN_OUT} please`);
    for (const value of ROUND_4_KEPT) expect(withoutContacts(`see ${value} please`), value).toBe(`see ${value} please`);
    for (const [text, scrubbed] of ROUND_4_AROUND) expect(withoutContacts(text), text).toBe(scrubbed);
    // A spelled-out dot never ends in an English word, nor in .it (Italy's is one).
    for (const word of ['in', 'by', 'on', 'to', 'it', 'me', 'at', 'be', 'is', 'us', 'no', 'so', 'do', 'go', 'as'])
      for (const text of [`Look at the dot ${word} the left`, `robin at example dot ${word}`, `robin@example dot ${word}`, `robin @ example . ${word}`])
        expect(withoutContacts(text), text).toBe(text);
    // The plain forms still end in any two or more letters, the " at " form still not before an apostrophe.
    expect(withoutContacts('robin@harbor.example')).toBe(TAKEN_OUT);
    expect(withoutContacts("Meet at St.Mary's")).toBe("Meet at St.Mary's");
  });

  it('scrubs every case of round 3 and round 2, and keeps the film text that only looks like a contact (round 3)', () => {
    for (const value of [...ROUND_2_SCRUBBED, ...ROUND_3_SCRUBBED]) expect(withoutContacts(`see ${value} please`), value).toBe(`see ${TAKEN_OUT} please`);
    for (const value of [...ROUND_2_KEPT, ...ROUND_3_KEPT]) expect(withoutContacts(`see ${value} please`), value).toBe(`see ${value} please`);
    // A letter right before or after the digits doesn't stop a phone; the letters stay.
    expect(withoutContacts('Robin555-0123 and 555-0123ext')).toBe(`Robin${TAKEN_OUT} and ${TAKEN_OUT}ext`);
    // A map link's whole tail goes with it, and the sentence after it stays.
    expect(withoutContacts('Pin: https://www.google.com/maps/@40.8,-73.9,17z!3d40.86!4d-73.92 then left')).toBe(`Pin: ${TAKEN_OUT} then left`);
    // An email's sentence keeps its full stop, the spaced form too.
    expect(withoutContacts('Write to robin.vale @ example . com.')).toBe(`Write to ${TAKEN_OUT}.`);
  });

  it('gives back text it takes nothing out of exactly as stored, and normalises only text it changed (round 3)', () => {
    for (const text of ['Ｆｕｌｌ ｗｉｄｔｈ', 'zero​width', 'soft­hyphen', 'ﬁne ligature', 'é combining', 'T2.8 at 06:30']) expect(withoutContacts(text), text).toBe(text);
    expect(withoutContacts('Ｃａｌｌ ５５５ ０１２３')).toBe(`Call ${TAKEN_OUT}`);
  });

  it('reads one word in time that grows with its length, never faster, whatever the word (round 3, round 4)', () => {
    // Round 4: catastrophic backtracking grows faster than the text (100 KB taking about 100 times 10 KB's time, or
    // seconds), so the test measures growth, not a wall-clock bound that a busy machine can miss: 100 KB under 30
    // times 10 KB (linear is about 10 times), each the best of 3, and under 2 s whatever the machine.
    const words = ['a', '5', 'a.', 'a@', '1-', 'C', 'x1', '.5', '/', '+5', 'a ', '1 ', 'at ', '(5) '];
    const best = (text: string): number => {
      let fastest = Infinity;
      for (let run = 0; run < 3; run += 1) {
        const start = performance.now();
        withoutContacts(text);
        fastest = Math.min(fastest, performance.now() - start);
      }
      return fastest;
    };
    const times = words.map((unit) => {
      const small = best(unit.repeat(Math.ceil(10_000 / unit.length)));
      const large = best(unit.repeat(Math.ceil(100_000 / unit.length)));
      // Below the timer's grain a ratio means nothing: a 10 KB time is read as at least 0.05 ms.
      return { unit, small, large, ratio: large / Math.max(small, 0.05) };
    });
    // SB_SCRUB_RATIOS=1 prints them (for a report).
    if (process.env.SB_SCRUB_RATIOS === '1') console.log(times.map((t) => `${JSON.stringify(t.unit)} ${t.small.toFixed(2)}/${t.large.toFixed(2)} ms ×${t.ratio.toFixed(1)}`).join('\n'));
    for (const { unit, small, large, ratio } of times) {
      const said = `"${unit}": 10 KB ${small.toFixed(2)} ms, 100 KB ${large.toFixed(2)} ms, ×${ratio.toFixed(1)}`;
      expect(ratio, said).toBeLessThan(30);
      expect(large, said).toBeLessThan(2000);
    }
  });

  it('reads any script’s digits, plain ones by a fast path', () => {
    expect(digitsOf('555-0123')).toBe('5550123');
    expect(digitsOf('٥٥٥ ٠١٢٣')).toBe('5550123');
    expect(digitsOf('５５５ ０１２３ and 4')).toBe('55501234');
  });

  it('keeps for the server’s last check only contact-shaped values, and replaces them however they are written (round 3)', () => {
    const location = record('location', {
      name: 'Pier 9',
      address: '1200 Ocean Avenue, Bayport',
      latitude: 40.867712,
      parking: 'Lot C behind the shed',
      contact_name: 'Dana Pierce',
      contact_phone: '555-0107 / 555-0199 x45',
      custom: { Gate: 'North side', 'Owner cell': 'ring 0475 12 34 56' },
      map_name: 'Pier 9 Ferry Terminal',
      notes: 'Guard: 612 345 678.',
    });
    const person = record('person', { name: 'Robin Vale', phone: '+1 555 0123', email: 'Robin.Vale@Example.com', notes: 'Home 555 0161' });
    const photo = record('media', { kind: 'image', taken_at: '2026-10-02T07:41:09' });
    const project = record('project', { client: { name: 'Bayport Tourism', phone: '+1 555 0142' }, company: { name: 'Harbor Pictures', address: '88 Wharf Street, Bayport' } });
    const guard = contactGuard({ [location.id]: location, [person.id]: person, [photo.id]: photo, [project.id]: project });
    // Both parts of a split phone field, its "x45" tail left out; the numbers typed in left-out and given notes.
    expect([...guard.phones].sort()).toEqual(['5123456', '2345678', '5550107', '5550123', '5550142', '5550161', '5550199'].sort());
    // Whole addresses and emails only: no first comma part, no photo's time.
    expect([...guard.texts].sort()).toEqual(['1200 ocean avenue, bayport', '88 wharf street, bayport', 'robin.vale@example.com']);
    expect(guard.coordinates).toEqual([40.867712]);
    for (const text of ['555 0123', '555–0123', '555‑0123', '(555) 0123', '+１ ５５５ ０１２３', '5 5 5 0 1 6 1', 'ROBIN.VALE@EXAMPLE.COM', '1200  ocean avenue, BAYPORT', '40.8677', '40.86771', '-40.8677'])
      expect(withoutStoredContacts(guard, `call ${text} now`), text).toBe(`call ${TAKEN_OUT} now`);
    for (const text of [
      'Dana Pierce',
      'Lot C behind the shed',
      'North side',
      'Pier 9 Ferry Terminal',
      'Bayport Tourism',
      'Bayport',
      // An address's first part, a coordinate to 3 places, a photo's time, a short run.
      '1200 Ocean Avenue',
      '40.868',
      '2026-10-02T07:41:09',
      '555 012',
      // Ids and ISO dates whose digits hold a stored phone's.
      '10000000-0000-4000-8000-000005550123',
      '5550-12-30',
    ])
      expect(withoutStoredContacts(guard, `call ${text} now`), text).toBe(`call ${text} now`);
  });

  it('keeps each number of a split phone field written without spaces, and matches a stored text only as a whole word (round 4)', () => {
    const pier = record('location', { contact_phone: '555-0107/555-0199', address: '1 Main St' });
    const flat = { ...record('location', { contact_phone: '555 0177 555 0188', contact_email: 'pier@example.com' }), id: 'flat' };
    const guard = contactGuard({ [pier.id]: pier, [flat.id]: flat });
    expect([...guard.phones].sort()).toEqual(['5550107', '5550177', '5550188', '5550199']);
    expect(guard.emails).toEqual(['pier@example.com']);
    for (const text of ['555 0107', '555 0199', '555-0177', '555 0188']) expect(withoutStoredContacts(guard, `call ${text} now`), text).toBe(`call ${TAKEN_OUT} now`);
    expect(withoutStoredContacts(guard, 'Meet at 1 Main St.')).toBe(`Meet at ${TAKEN_OUT}.`);
    for (const text of ['Meet at 21 Main Street', 'Meet at 1 Main Stage', 'Write xpier@example.com.au']) expect(withoutStoredContacts(guard, text), text).toBe(text);
    // As a name: phones and emails only, never an address.
    expect(withoutStoredContacts(guard, '1 Main St', { name: true })).toBe('1 Main St');
    expect(withoutStoredContacts(guard, 'Pier office 555 0107', { name: true })).toBe(`Pier office ${TAKEN_OUT}`);
    expect(withoutStoredContacts(guard, 'Pier pier@example.com', { name: true })).toBe(`Pier ${TAKEN_OUT}`);
  });

  it('hides a department’s material unless the reader is exempt from that department', () => {
    const gear = record('gear_item', { name: 'Boom kit', department: 'sound' });
    const onGear = { ...record('suggestion', { target_id: gear.id, target_type: 'gear_item', data: { props: { quantity: 2 } } }), id: 'suggestion-on-gear' };
    const naming = { ...record('suggestion', { target_id: 'x', target_type: 'gear_item', data: { props: { department: 'sound' } } }), id: 'suggestion-naming' };
    const records = { [gear.id]: gear, [onGear.id]: onGear, [naming.id]: naming };
    const seen = (exempt: ReadonlySet<'sound' | 'camera'>) => Object.keys(assistantView(records, { departments: { hidden: new Set(['sound']), exempt } }).given).sort();
    expect(seen(new Set())).toEqual([]);
    expect(seen(new Set(['camera']))).toEqual([]);
    expect(seen(new Set(['sound']))).toEqual([gear.id, naming.id, onGear.id].sort());
  });
});
