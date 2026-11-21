import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ASSISTANT_PROPS, assistantView, contactValues, givenProps, TAKEN_OUT, withoutContacts } from './assistantView';
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
      'departments media_id shoot_day_id setup_id location_id gear_ids custom',
    ],
    leftOut: ['crop:look clip:file'],
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
    expect(withoutContacts('Call Robin on +1 (555) 012-3456 or robin.vale@example.com.')).toBe(`Call Robin on ${TAKEN_OUT} or ${TAKEN_OUT}`);
    expect(withoutContacts('Gate code 4417, call 555.0123.88')).toBe(`Gate code 4417, call ${TAKEN_OUT}`);
    expect(withoutContacts('Shoot 2026-11-18 at 06:30, 4.5 m from the wall, T2.8')).toBe('Shoot 2026-11-18 at 06:30, 4.5 m from the wall, T2.8');
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

  it('lists every contact detail a project holds for the server’s last check', () => {
    const location = record('location', { name: 'Pier 9', address: '1200 Ocean Avenue', latitude: 40.867712, parking: 'Lot C behind the shed' });
    const person = record('person', { name: 'Robin Vale', phone: '+1 555 0123' });
    const values = contactValues({ [location.id]: location, [person.id]: person });
    expect(values).toEqual(expect.arrayContaining(['1200 Ocean Avenue', '40.867712', 'Lot C behind the shed', '+1 555 0123']));
    expect(values).not.toContain('Pier 9');
  });
});
