import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ASSISTANT_PROPS, assistantView, contactGuard, contactIn, givenProps, suggestionFieldsLeftOut, TAKEN_OUT, withoutContacts } from './assistantView';
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
    const scrubbed = [
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
      // Coordinates: a pair of decimals of 3 or more places, or degrees, minutes and seconds.
      '40.867712, -73.921234',
      '40.8677 -73.9212',
      '40.8677° N, 73.9212° W',
      '40.867;-73.921',
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
    for (const value of scrubbed) expect(withoutContacts(`see ${value} please`), value).toBe(`see ${TAKEN_OUT} please`);
    const kept = [
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
    ];
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
    expect(assistantView(records).given[suggestion.id]?.props.data).toEqual({ props: { title: `DP ${TAKEN_OUT}` }, before: { title: 'Gaffer' }, parent_id: `call ${TAKEN_OUT}` });
    expect(suggestionFieldsLeftOut(records, suggestion)).toEqual(['phone', '2 unknown fields']);
    // With no target in the project, read by the type it says.
    const loose = record('suggestion', { target_id: 'gone', target_type: 'shot', data: { props: { action: 'Her hands', phone: '1' } } });
    expect(assistantView({ [loose.id]: loose }).given[loose.id]?.props.data).toEqual({ props: { action: 'Her hands' } });
    expect(suggestionFieldsLeftOut({ [loose.id]: loose }, loose)).toEqual(['1 unknown field']);
  });

  it('keeps for the server’s last check only contact-shaped values, and finds them however they are written', () => {
    const location = record('location', {
      name: 'Pier 9',
      address: '1200 Ocean Avenue, Bayport',
      latitude: 40.867712,
      parking: 'Lot C behind the shed',
      contact_name: 'Dana Pierce',
      custom: { Gate: 'North side' },
      map_name: 'Pier 9 Ferry Terminal',
    });
    const person = record('person', { name: 'Robin Vale', phone: '+1 555 0123', email: 'Robin.Vale@Example.com' });
    const photo = record('media', { kind: 'image', taken_at: '2026-10-02T07:41:09' });
    const project = record('project', { client: { name: 'Bayport Tourism', phone: '+1 555 0142' }, company: { name: 'Harbor Pictures', address: '88 Wharf Street, Bayport' } });
    const guard = contactGuard({ [location.id]: location, [person.id]: person, [photo.id]: photo, [project.id]: project });
    expect([...guard.phones].sort()).toEqual(['5550123', '5550142']);
    expect([...guard.texts].sort()).toEqual(['1200 ocean avenue', '1200 ocean avenue, bayport', '2026-10-02t07:41:09', '88 wharf street', '88 wharf street, bayport', 'robin.vale@example.com']);
    expect(guard.coordinates).toEqual([40.867712]);
    for (const text of ['555 0123', '555–0123', '555‑0123', '(555) 0123', '+１ ５５５ ０１２３', 'ROBIN.VALE@EXAMPLE.COM', '1200  ocean avenue', '40.868', '40.8677', '-40.867'])
      expect(contactIn(guard, `"${text}"`), text).not.toBeNull();
    for (const text of ['Dana Pierce', 'Lot C behind the shed', 'North side', 'Pier 9 Ferry Terminal', 'Bayport Tourism', 'Bayport', '40.86', '2026-10-02', '555 012'])
      expect(contactIn(guard, `"${text}"`), text).toBeNull();
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
