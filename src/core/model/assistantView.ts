import type { Department } from './department';
import { isRecordType, type JsonValue, type Props, type RecordType, type SbdRecord } from './record';

// What an AI assistant may read of a project (7.5, Phase 7 decisions 14 and 16, questions 20 and departments 14). Whatever
// the MCP server returns goes to the assistant's maker, so this is the one place that decides it: every tool reads the
// project through `assistantView`, never the records themselves.
//
// - Every prop of every record type is in ASSISTANT_PROPS, given or left out with why (assistantView.test.ts lists them
//   all, and fails on a prop the code reads that isn't there, so a new prop is decided before an assistant can read it).
//   A prop the table doesn't name (a later version's, an import's) is left out.
// - Contact details are never given: a person's phone, email and whether they print, a location's address, contacts and
//   parking, its place on the map, a hospital's address, phone and place, a scout photo's place and time, a sun path's own
//   coordinates, the client and the company's contact. The project's switch that would allow them ("Let the assistant
//   read contact details") isn't built; until it is, nothing here gives them.
// - Free text that is given (notes, action, names) has anything that reads as an email address or a phone number taken
//   out, since a person may have typed one there.
// - Trashed records only when the caller asks (`includeTrashed`), as every MCP read (CLAUDE.md).
// - A department's "no" (Kevin, Nov 21: each department says whether the assistant may read its files; what's marked
//   no, the assistant can't touch, except for the director and people given permission): `DepartmentAccess`. No record
//   is a department's file yet (files and their flags come with departments by file) and nothing stores the flag, so it
//   is empty today; when it isn't, a department's material (a record carrying that `department`, and everything under
//   it) is left out of both readings below, so no tool can see it.
//
// Two readings come out. `given` holds the visible records with only the props given: what tools return fields from.
// `scoped` holds the same visible records with all their props: only for the app's own readers that work a value out
// from props the assistant never sees (the sun from a location's place, a window's hours, a camera's lens), whose
// results a tool returns, never the props themselves.

type Records = Readonly<Record<string, SbdRecord>>;

/** Why a prop is left out. */
export type LeftOut =
  /** A person's or a place's contact details (decision 14): phone, email, address, contacts, parking. */
  | 'contact'
  /** Where a place is: coordinates, the map's name of the place, a photo's place and time (question 20). */
  | 'place'
  /** A stored file, its path or how it is shown: no tool returns a file in 7.5. */
  | 'file'
  /** The look of a screen or a board, not production data. */
  | 'look'
  /** Kept for the app's own bookkeeping (fingerprints, approvals' bases, copies' origins). */
  | 'bookkeeping'
  /** A record type no 7.5 tool reads. */
  | 'not_read';

/** How a given prop is given: as stored; as free text (emails and phone numbers taken out); or only some of its keys. */
export type Given = 'value' | 'text' | { readonly keys: readonly string[] };

export interface TypeRule {
  readonly given: Readonly<Record<string, Given>>;
  readonly leftOut: Readonly<Record<string, LeftOut>>;
}

const v = 'value' as const;
const tx = 'text' as const;

/** A whole record type no tool reads: every prop it has, left out for the same reason. */
const all = (why: LeftOut, props: readonly string[]): TypeRule => ({ given: {}, leftOut: Object.fromEntries(props.map((p) => [p, why])) });

/**
 * Every prop of every record type, given or left out (docs/SBD_FORMAT.md describes each). A suggestion's `data` holds
 * props of the record it acts on: those are given or left out by that record's type (suggestionData).
 */
export const ASSISTANT_PROPS: Readonly<Record<RecordType, TypeRule>> = {
  project: {
    given: {
      title: tx,
      name: tx,
      notes: tx,
      state: v,
      stage: v,
      logline: tx,
      format: tx,
      runtime: tx,
      deliverables: tx,
      aspect_ratio: v,
      shot_letters_allow_io: v,
      setup_minutes: v,
      hmu_minutes: v,
      currency: v,
      // The production company's name only: its address, phone, email and website are its contact.
      company: { keys: ['name'] },
    },
    leftOut: { client: 'contact', theme: 'look', watermark: 'look' },
  },
  scene: {
    given: {
      number: v,
      name: tx,
      heading: tx,
      int_ext: v,
      day_night: v,
      location_id: v,
      page_eighths: v,
      character_ids: v,
      characters: tx,
      numbers_locked: v,
      room_id: v,
    },
    leftOut: { department_approvals: 'bookkeeping', palette: 'look' },
  },
  shot: {
    given: {
      number: v,
      title: tx,
      size: v,
      lens_mm: v,
      lens_id: v,
      t_stop: v,
      support: tx,
      height: tx,
      move: tx,
      status: v,
      action: tx,
      dialogue: tx,
      department_status: v,
      departments: v,
      media_id: v,
      shoot_day_id: v,
      setup_id: v,
      location_id: v,
      gear_ids: v,
      custom: tx,
    },
    leftOut: { crop: 'look', clip: 'file' },
  },
  setup: { given: { name: tx }, leftOut: {} },
  note: { given: { text: tx }, leftOut: {} },
  character: { given: { name: tx, cast_id: v }, leftOut: {} },
  stroke: all('not_read', ['tool', 'points', 'width', 'pressures']),
  // Pictures, videos, PDFs, links and scout photos: no tool returns a file in 7.5, and a photo's place and time are
  // contact details (question 20). The readers that need them (a light reference's sun, an issued sheet's version) read
  // `scoped`, and tools return only what they work out.
  media: {
    given: {},
    leftOut: {
      kind: 'file',
      file: 'file',
      mime: 'file',
      width: 'file',
      height: 'file',
      color_space: 'file',
      source_name: 'file',
      source_path: 'file',
      source_size: 'file',
      byte_size: 'file',
      url: 'file',
      title: 'file',
      role: 'file',
      duration_frames: 'file',
      fps: 'file',
      start_timecode: 'file',
      sar: 'file',
      rotation: 'file',
      codec: 'file',
      has_audio: 'file',
      hdr: 'file',
      bit_depth: 'file',
      poster: 'file',
      lut: 'file',
      from_video: 'file',
      taken_at: 'place',
      taken_offset: 'place',
      gps_latitude: 'place',
      gps_longitude: 'place',
      issue_version: 'file',
      issued_at: 'file',
      issued_by: 'file',
      issued_zone: 'file',
      fingerprint: 'bookkeeping',
      fingerprint_version: 'bookkeeping',
    },
  },
  location: {
    given: {
      name: tx,
      status: v,
      power: tx,
      notes: tx,
      time_zone: v,
      country_code: v,
      hospital_name: tx,
      hospital_emergency: v,
      hospital_source: v,
      map_moved: v,
      light_photo_id: v,
    },
    leftOut: {
      address: 'contact',
      contact_name: 'contact',
      contact_phone: 'contact',
      contact_email: 'contact',
      // The brief's rule: parking text often holds an address.
      parking: 'contact',
      hospital_address: 'contact',
      hospital_phone: 'contact',
      // A location's own fields may hold a contact ("Owner's cell").
      custom: 'contact',
      latitude: 'place',
      longitude: 'place',
      map_name: 'place',
      hospital_latitude: 'place',
      hospital_longitude: 'place',
    },
  },
  person: {
    given: { name: tx, role: v, departments: v, title: tx, full_view: v },
    leftOut: { phone: 'contact', email: 'contact', contact_on_sheet: 'contact', notes: 'contact', custom: 'contact' },
  },
  department: all('not_read', ['name']),
  gear_item: {
    given: {
      name: tx,
      department: v,
      quantity: v,
      source: v,
      owner: tx,
      day_rate: v,
      notes: tx,
      kind: v,
      sensor_width_mm: v,
      sensor_height_mm: v,
      sensor_mode: tx,
      camera_letter: v,
      focal_equivalent: v,
      focal_min_mm: v,
      focal_max_mm: v,
      squeeze: v,
      watts: v,
    },
    leftOut: {},
  },
  shoot_day: {
    given: { date: v, call_time: v, wrap_time: v, notes: tx, crew: v, people_ids: v, gear_ids: v },
    leftOut: {},
  },
  callsheet: { given: { notes: tx, safety_notes: tx, department_calls: v, person_times: v }, leftOut: {} },
  plan: { given: { kind: v, name: tx, location_id: v, ceiling_height_m: v }, leftOut: {} },
  plan_item: {
    given: {
      kind: v,
      x: v,
      y: v,
      width: v,
      height: v,
      rotation: v,
      locked: v,
      name: tx,
      height_m: v,
      icon: v,
      points: v,
      from: v,
      to: v,
      wall_id: v,
      along_m: v,
      width_m: v,
      hinge: v,
      swing: v,
      sill_height_m: v,
      top_height_m: v,
      body_id: v,
      shot_ids: v,
      shown_shot_id: v,
      lens_mm: v,
      lens_id: v,
      on_side: v,
      stop_at_walls: v,
      gear_id: v,
      watts: v,
      beam_deg: v,
      time: v,
      own_date: v,
      at_photo: v,
      character_id: v,
      camera_id: v,
      order: v,
      media_id: v,
      scaled: v,
      scale_m: v,
    },
    leftOut: { own_latitude: 'place', own_longitude: 'place', copied_from: 'bookkeeping' },
  },
  board: all('not_read', ['name', 'kind', 'department', 'page_format', 'page_orientation', 'scene_ids', 'location_ids', 'character_ids', 'background']),
  board_item: all('not_read', [
    'kind',
    'x',
    'y',
    'width',
    'height',
    'rotation',
    'text',
    'title',
    'label',
    'color',
    'fill',
    'stroke',
    'font_family',
    'font_size',
    'font_weight',
    'font_italic',
    'align',
    'media_id',
    'file',
    'source_name',
    'source_path',
    'url',
    'shot_id',
    'scene_id',
    'field',
    'from',
    'to',
    'route',
    'start_head',
    'end_head',
    'orientation',
    'crop',
    'border',
    'border_color',
    'border_width',
    'poster',
  ]),
  design: all('not_read', []),
  comment: all('not_read', []),
  suggestion: {
    given: {
      kind: v,
      target_id: v,
      target_type: v,
      target_label: tx,
      target_updated_at: v,
      status: v,
      source: v,
      change_file_id: v,
      // Who made it: a name and a role, never contact details (the change file's reader keeps none).
      author: { keys: ['name', 'role', 'person_id'] },
      note: tx,
      // Read field by field, by the type of the record it acts on (suggestionData).
      data: v,
      suggested_at: v,
      decided_by: tx,
      decided_at: v,
      created_id: v,
      after_suggestion: v,
    },
    leftOut: {},
  },
  // Unavailable dates (Phase 7 decision 6) arrive with 7.6's check; no 7.5 tool reads them.
  availability: all('not_read', ['person_id', 'date', 'dates']),
  // This computer's look and layout (6.5.8): never production data.
  settings_preset: all('look', ['name', 'settings']),
};

/** A department's "no" (Kevin, Nov 21). Empty today: nothing stores the flag yet. */
export interface DepartmentAccess {
  /** Departments whose material the assistant may not read. */
  readonly hidden: ReadonlySet<Department>;
  /** The director, or someone a department gave permission: the "no" doesn't hold for them. */
  readonly exempt: boolean;
}

export const NO_DEPARTMENT_FLAGS: DepartmentAccess = { hidden: new Set(), exempt: false };

/** The department whose material a record is, by its own `department` (a gear item, a department's board), or null. */
function ownDepartment(record: SbdRecord): string | null {
  const department = record.props.department;
  return typeof department === 'string' ? department : null;
}

/** Whether a record is, or sits under, the material of a department the assistant may not read. */
function hiddenByDepartment(records: Records, record: SbdRecord, access: DepartmentAccess): boolean {
  if (access.exempt || access.hidden.size === 0) return false;
  let at: SbdRecord | undefined = record;
  for (let depth = 0; at && depth < 64; depth += 1) {
    const department = ownDepartment(at);
    if (department !== null && (access.hidden as ReadonlySet<string>).has(department)) return true;
    at = at.parentId ? records[at.parentId] : undefined;
  }
  return false;
}

// An email address, or a run of at least 7 digits with the spaces, dots, dashes, brackets and plus a phone number is
// written with. A date (2026-11-21) or a time isn't one.
const EMAIL = /[^\s@<>()[\]"',;:]+@[^\s@<>()[\]"',;:]+\.[^\s@<>()[\]"',;:]+/gu;
const PHONE = /\+?\(?\d[\d\s().-]{5,}\d/gu;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The words put where a contact detail was taken out of free text. */
export const TAKEN_OUT = '[contact left out]';

/** Free text with anything that reads as an email address or a phone number taken out. */
export function withoutContacts(text: string): string {
  return text.replace(EMAIL, TAKEN_OUT).replace(PHONE, (match) => {
    const digits = match.replace(/\D/g, '');
    return digits.length >= 7 && !DATE.test(match.trim()) ? TAKEN_OUT : match;
  });
}

/** A value given as free text: every string in it, however deep, without contacts. */
function textValue(value: JsonValue): JsonValue {
  if (typeof value === 'string') return withoutContacts(value);
  if (Array.isArray(value)) return value.map(textValue);
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, textValue(inner)]));
  return value;
}

/** A prop's value as given by its rule, or undefined when it is left out. */
function givenValue(rule: Given | undefined, value: JsonValue): JsonValue | undefined {
  if (rule === undefined) return undefined;
  if (rule === 'value') return value;
  if (rule === 'text') return textValue(value);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const kept = Object.entries(value).filter(([key]) => rule.keys.includes(key));
  return textValue(Object.fromEntries(kept));
}

/** The props of a record of this type that the assistant is given. A type this version doesn't know gives none. */
export function givenProps(type: string, props: Props): Props {
  const rule = isRecordType(type) ? ASSISTANT_PROPS[type] : undefined;
  if (!rule) return {};
  const out: Props = {};
  for (const [key, value] of Object.entries(props)) {
    if (!Object.hasOwn(rule.given, key)) continue;
    const given = givenValue(rule.given[key], value);
    if (given !== undefined) out[key] = given;
  }
  return out;
}

/** The fields of a suggestion's `data` (`props`, `before`) as given by the type of the record it acts on. */
function suggestionData(targetType: JsonValue | undefined, data: JsonValue): JsonValue {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return {};
  const type = typeof targetType === 'string' ? targetType : '';
  const out: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === 'props' || key === 'before') out[key] = typeof value === 'object' && value !== null && !Array.isArray(value) ? givenProps(type, value) : {};
    else if (key === 'type' || key === 'parent_id' || key === 'after_id') out[key] = value;
  }
  return out;
}

/** The names of a suggestion's fields left out by its target's type, so a tool can say they were. */
export function suggestionFieldsLeftOut(record: SbdRecord): string[] {
  const data = record.props.data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return [];
  const type = typeof record.props.target_type === 'string' ? record.props.target_type : '';
  const names = new Set<string>();
  for (const key of ['props', 'before']) {
    const fields = data[key];
    if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) continue;
    const kept = givenProps(type, fields);
    for (const name of Object.keys(fields)) if (!Object.hasOwn(kept, name)) names.add(name);
  }
  return [...names];
}

export interface AssistantView {
  /** The records the assistant may see, with only the props it is given. */
  given: Records;
  /** The same records with every prop: only for the app's readers whose results a tool returns (see above). */
  scoped: Records;
}

export interface AssistantViewOptions {
  includeTrashed?: boolean;
  departments?: DepartmentAccess;
}

/** What the assistant may read of the project's records. */
export function assistantView(records: Records, options: AssistantViewOptions = {}): AssistantView {
  const { includeTrashed = false, departments = NO_DEPARTMENT_FLAGS } = options;
  const scoped: Record<string, SbdRecord> = {};
  const given: Record<string, SbdRecord> = {};
  for (const record of Object.values(records)) {
    if (!includeTrashed && record.trashedAt !== null) continue;
    if (hiddenByDepartment(records, record, departments)) continue;
    scoped[record.id] = record;
    const props = givenProps(record.type, record.props);
    if (record.type === 'suggestion' && record.props.data !== undefined) props.data = suggestionData(record.props.target_type, record.props.data);
    // Who trashed it is a name the op log keeps, as an author is; given with the time.
    given[record.id] = { ...record, props };
  }
  return { given, scoped };
}

/**
 * The contact details a project holds, as text, for the server's last check (mcp/src/guard.ts): every value left out as
 * `contact` or `place`, from every record, trashed or not, so a tool that ever returned one is refused, never sent.
 * Numbers (coordinates) as JSON writes them; strings as stored. Short values (under 5 characters) aren't listed: they
 * would match ordinary words and numbers.
 */
export function contactValues(records: Records): string[] {
  const out = new Set<string>();
  const add = (value: JsonValue | undefined) => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length >= 5) out.add(trimmed);
    } else if (typeof value === 'number' && Number.isFinite(value) && !Number.isInteger(value)) {
      // A coordinate: every decimal stored, so it never matches a length or a time worked out.
      const written = JSON.stringify(value);
      if (written.replace(/^-?\d+\./, '').length >= 4) out.add(written);
    } else if (Array.isArray(value)) value.forEach(add);
    else if (typeof value === 'object' && value !== null) Object.values(value).forEach(add);
  };
  for (const record of Object.values(records)) {
    if (!isRecordType(record.type)) continue;
    const rule = ASSISTANT_PROPS[record.type];
    for (const [key, why] of Object.entries(rule.leftOut)) {
      if (why === 'contact' || why === 'place') add(record.props[key]);
    }
    // The parts of a given prop that are left out: the client's and the company's contact.
    const company = record.props.company;
    if (record.type === 'project' && typeof company === 'object' && company !== null && !Array.isArray(company)) {
      for (const key of ['address', 'phone', 'email', 'website']) add(company[key]);
    }
  }
  return [...out];
}
