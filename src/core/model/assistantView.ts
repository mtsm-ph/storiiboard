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
// - Free text that is given (notes, action, names) has anything that reads as an email address, a phone number, a pair
//   of coordinates or a map link taken out, since a person may have typed one there (`withoutContacts`).
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
    },
    // A frame's own fields are left out as a person's and a location's are (round 2, failing closed): a custom field
    // may hold a contact ("Owner's cell"). Kevin can loosen it.
    leftOut: { crop: 'look', clip: 'file', custom: 'contact' },
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

/**
 * A department's "no" (Kevin, Nov 21). Empty today: nothing stores the flag yet.
 *
 * Kevin's question, asked by the main session and not answered yet: whether a frame's per-department statuses
 * (`department_status`), a call sheet's department calls (`department_calls`) and a plan's layers count as "a
 * department's files". Until he says, they are given as before, and only a record carrying a hidden `department`
 * (and what sits under it) is hidden.
 */
export interface DepartmentAccess {
  /** Departments whose material the assistant may not read. */
  readonly hidden: ReadonlySet<Department>;
  /**
   * The departments whose "no" doesn't hold for this reader: every department for the director, and each department
   * that gave this person permission.
   */
  readonly exempt: ReadonlySet<Department>;
}

export const NO_DEPARTMENT_FLAGS: DepartmentAccess = { hidden: new Set(), exempt: new Set() };

/** The departments still hidden from this reader: marked no, and not one they are exempt from. */
function hiddenFor(access: DepartmentAccess): ReadonlySet<string> {
  return new Set([...access.hidden].filter((department) => !access.exempt.has(department)));
}

/** The department whose material a record is, by its own `department` (a gear item, a department's board), or null. */
function ownDepartment(record: SbdRecord): string | null {
  const department = record.props.department;
  return typeof department === 'string' ? department : null;
}

/** Whether a record is, or sits under, the material of a department the assistant may not read. */
function hiddenByDepartment(records: Records, record: SbdRecord, hidden: ReadonlySet<string>): boolean {
  if (hidden.size === 0) return false;
  let at: SbdRecord | undefined = record;
  for (let depth = 0; at && depth < 64; depth += 1) {
    const department = ownDepartment(at);
    if (department !== null && hidden.has(department)) return true;
    at = at.parentId ? records[at.parentId] : undefined;
  }
  return false;
}

/** Whether a value names a hidden department anywhere in it: as a value (`department`, `departments`) or a key. */
function namesDepartment(value: JsonValue | undefined, hidden: ReadonlySet<string>, depth = 0): boolean {
  if (depth > 16 || value === undefined || value === null) return false;
  if (typeof value === 'string') return hidden.has(value);
  if (Array.isArray(value)) return value.some((inner) => namesDepartment(inner, hidden, depth + 1));
  if (typeof value === 'object') return Object.entries(value).some(([key, inner]) => hidden.has(key) || namesDepartment(inner, hidden, depth + 1));
  return false;
}

// ---- Free text ---------------------------------------------------------------------------------------------------
//
// Round 2: Unicode-aware. Format characters (`\p{Cf}`: zero-width spaces and joiners, soft hyphens, direction marks) are
// dropped first and the text normalised (NFKC), so a full-width digit, a "＠" or a non-breaking space reads as its plain
// form. Then, in order: map links, emails (an "@" or a lookalike: "(at)", "[at]", " at " before a dotted domain),
// coordinate pairs and degrees-minutes-seconds, and phone numbers by the rule in `isPhone`. Ids and dates are never
// taken for a phone.

/** The words put where a contact detail was taken out of free text. */
export const TAKEN_OUT = '[contact left out]';

/** Text without format characters, normalised (NFKC): what every rule here reads. */
export function normalText(text: string): string {
  return text.replace(/\p{Cf}/gu, '').normalize('NFKC').replace(/\p{Cf}/gu, '');
}

const MAP_LINK = /[^\s"'<>()[\]]*(?:maps\.google\.|goo\.gl\/maps|maps\.app\.goo\.gl|maps\.apple\.|openstreetmap\.org|osm\.org)[^\s"'<>()[\]]*/giu;

const LOCAL = String.raw`[\p{L}\p{N}._%+-]+`;
const LABEL = String.raw`[\p{L}\p{N}-]+`;
const AT_SIGN = new RegExp(String.raw`${LOCAL}\s*@\s*${LABEL}(?:\.${LABEL})*\.\p{L}{2,}`, 'giu');
const AT_WORD = new RegExp(String.raw`${LOCAL}\s*[([{]\s*at\s*[)\]}]\s*${LABEL}(?:\s*(?:\.|[([{]\s*dot\s*[)\]}])\s*${LABEL})+`, 'giu');
const AT_SPACED = new RegExp(String.raw`(?<![\p{L}\p{N}])${LOCAL}\s+at\s+${LABEL}(?:\.${LABEL})*\.\p{L}{2,}(?![\p{L}\p{N}])`, 'giu');

// A coordinate: up to three digits, a point and three or more places, with a degree sign and a hemisphere if written.
const DECIMAL = String.raw`[-+−]?\p{Nd}{1,3}\.\p{Nd}{3,}(?:\s?°)?(?:\s?[NSEWnsew](?![\p{L}]))?`;
const COORDINATE_PAIR = new RegExp(String.raw`(?<![\p{L}\p{N}.])${DECIMAL}(?:\s*[,;/]\s*|\s+)${DECIMAL}(?![\p{N}])`, 'gu');
// 40°52'03.8"N, 40° 52′ 3″ N (NFKC writes ″ as ′′), 40°52'N.
const DMS = /\p{Nd}{1,3}\s?°\s?\p{Nd}{1,2}(?:\.\p{Nd}+)?\s?['′](?:\s?\p{Nd}{1,2}(?:\.\p{Nd}+)?\s?(?:["″]|′′|'')?)?(?:\s?[NSEWnsew](?![\p{L}]))?/gu;

const UUID = String.raw`(?<![\p{L}\p{N}-])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\p{L}\p{N}-])`;
// A date, year first or last, with a time after it if there is one (06:30, 06.30, 06h30, T10:00:00.000).
const TIME = String.raw`(?:[T ]\p{Nd}{1,2}[:.h]\p{Nd}{2}(?:[:.]\p{Nd}{2}(?:\.\p{Nd}+)?)?)?`;
const DATE = String.raw`(?<![\p{N}])(?:\p{Nd}{4}[-./]\p{Nd}{1,2}[-./]\p{Nd}{1,2}|\p{Nd}{1,2}[-./]\p{Nd}{1,2}[-./]\p{Nd}{4})(?![\p{N}])${TIME}`;
// Digits in groups joined by one space, dash, dot or slash, a bracketed group among them, with a leading + or (.
const JOIN = String.raw`(?:[ \p{Pd}./]|\)[ \p{Pd}]?|[ ]?\()`;
const NUMBER = String.raw`(?<![\p{L}\p{N}])[+(]?\p{Nd}+(?:${JOIN}\p{Nd}+)*\)?(?![\p{L}\p{N}])`;
const ID_DATE_OR_NUMBER = new RegExp(`(${UUID})|(${DATE})|(${NUMBER})`, 'giu');

/** A digit's value, in any script's digits (`\p{Nd}` runs of ten). */
function digitValue(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  let back = 0;
  while (back < 60 && /\p{Nd}/u.test(String.fromCodePoint(code - back - 1))) back += 1;
  return back % 10;
}

/** A text's digits, as plain 0 to 9. */
export function digitsOf(text: string): string {
  return (text.match(/\p{Nd}/gu) ?? []).map((char) => String(digitValue(char))).join('');
}

/** Whether a date-shaped match is a real date: a month from 1 to 12 and a day from 1 to 31, either way round. */
function isDate(match: string): boolean {
  const [a = '', b = '', c = ''] = (match.match(/\p{Nd}+/gu) ?? []).slice(0, 3).map(digitsOf);
  const [first, second] = a.length === 4 ? [Number(b), Number(c)] : [Number(a), Number(b)];
  const month = (n: number) => n >= 1 && n <= 12;
  const day = (n: number) => n >= 1 && n <= 31;
  return (month(first) && day(second)) || (day(first) && month(second));
}

/**
 * Whether a run of digit groups is a phone number: 7 or more digits (`\p{Nd}`), and a leading + or (, or a last group
 * of 4 or more digits, or one run of 10 or more. Never two groups that read as a range (1001-1096: a dash between two
 * groups of one length, the second the larger), and never groups whose last has under 4 digits (101 102 103, 1 250 000,
 * 18 25 35 50 85) without a + or (. Over 15 digits ending in a group of 4 or more is taken out too: a card number, or a
 * phone run on from other numbers, is never what an assistant needs.
 */
function isPhone(match: string): boolean {
  const groups = (match.match(/\p{Nd}+/gu) ?? []).map(digitsOf);
  const digits = groups.join('').length;
  if (digits < 7) return false;
  if (/^[+(]/u.test(match)) return true;
  const last = groups[groups.length - 1] ?? '';
  if (groups.length === 1) return digits >= 10;
  const [first = '', second = ''] = groups;
  if (groups.length === 2 && /^\p{Nd}+\p{Pd}\p{Nd}+$/u.test(match) && first.length === second.length && Number(second) > Number(first)) return false;
  return last.length >= 4;
}

/** Free text with anything that reads as an email address, a phone number, coordinates or a map link taken out. */
export function withoutContacts(text: string): string {
  return normalText(text)
    .replace(MAP_LINK, TAKEN_OUT)
    .replace(AT_SIGN, TAKEN_OUT)
    .replace(AT_WORD, TAKEN_OUT)
    .replace(AT_SPACED, TAKEN_OUT)
    .replace(COORDINATE_PAIR, TAKEN_OUT)
    .replace(DMS, TAKEN_OUT)
    .replace(ID_DATE_OR_NUMBER, (match: string, id: string | undefined, date: string | undefined) => {
      if (id !== undefined) return match;
      if (date !== undefined && isDate(match)) return match;
      // A closing bracket with no opening one is the sentence's, not the number's: "(call +1 555 0166)".
      const own = match.endsWith(')') && !match.includes('(') ? match.slice(0, -1) : match;
      return isPhone(own) ? TAKEN_OUT + match.slice(own.length) : match;
    });
}

/** A value given as free text: every string in it, however deep, without contacts. Keys are kept as they are. */
export function viewText(value: JsonValue): JsonValue {
  if (typeof value === 'string') return withoutContacts(value);
  if (Array.isArray(value)) return value.map(viewText);
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, viewText(inner)]));
  return value;
}

/** A prop's value as given by its rule, or undefined when it is left out. */
function givenValue(rule: Given | undefined, value: JsonValue): JsonValue | undefined {
  if (rule === undefined) return undefined;
  if (rule === 'value') return value;
  if (rule === 'text') return viewText(value);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const kept = Object.entries(value).filter(([key]) => rule.keys.includes(key));
  return viewText(Object.fromEntries(kept));
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

// ---- Suggestions -------------------------------------------------------------------------------------------------

/**
 * The type a suggestion's data is read by: its target's own type when the target is in the project (a call sheet's
 * suggestion targets its shoot day and carries the sheet's props), else the type it says.
 */
function suggestionType(records: Records, record: SbdRecord): string {
  const claimed = typeof record.props.target_type === 'string' ? record.props.target_type : '';
  const targetId = record.props.target_id;
  const target = typeof targetId === 'string' ? records[targetId] : undefined;
  if (!target) return claimed;
  return claimed === 'callsheet' && target.type === 'shoot_day' ? 'callsheet' : target.type;
}

/**
 * The fields of a suggestion's `data` (`props`, `before`) as given by the type of the record it acts on, every value
 * through the free-text rule whatever its own rule (a suggestion's value is typed by whoever sent it).
 */
function suggestionData(type: string, data: JsonValue): JsonValue {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return {};
  const out: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === 'props' || key === 'before') out[key] = typeof value === 'object' && value !== null && !Array.isArray(value) ? viewText(givenProps(type, value)) : {};
    else if (key === 'type' || key === 'parent_id' || key === 'after_id') out[key] = viewText(value);
  }
  return out;
}

/** A field name a record of this type has, given or left out: only those are named back. */
function knownProp(type: string, name: string): boolean {
  const rule = isRecordType(type) ? ASSISTANT_PROPS[type] : undefined;
  return rule !== undefined && (Object.hasOwn(rule.given, name) || Object.hasOwn(rule.leftOut, name));
}

/**
 * The names of a suggestion's fields left out by its target's type, so a tool can say they were: a known prop by its
 * name, the rest only counted ("2 unknown fields"), since a name nobody decided could itself hold anything.
 */
export function suggestionFieldsLeftOut(records: Records, record: SbdRecord): string[] {
  const data = record.props.data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return [];
  const type = suggestionType(records, record);
  const names = new Set<string>();
  const unknown = new Set<string>();
  for (const key of ['props', 'before']) {
    const fields = data[key];
    if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) continue;
    const kept = givenProps(type, fields);
    for (const name of Object.keys(fields)) {
      if (Object.hasOwn(kept, name)) continue;
      if (knownProp(type, name)) names.add(name);
      else unknown.add(name);
    }
  }
  return [...names, ...(unknown.size === 0 ? [] : [`${String(unknown.size)} unknown field${unknown.size === 1 ? '' : 's'}`])];
}

// ---- The view ----------------------------------------------------------------------------------------------------

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
  const hidden = hiddenFor(departments);
  const scoped: Record<string, SbdRecord> = {};
  const given: Record<string, SbdRecord> = {};
  for (const record of Object.values(records)) {
    if (!includeTrashed && record.trashedAt !== null) continue;
    if (hiddenByDepartment(records, record, hidden)) continue;
    if (record.type === 'suggestion' && hiddenSuggestion(records, record, hidden)) continue;
    scoped[record.id] = record;
    const props = givenProps(record.type, record.props);
    if (record.type === 'suggestion' && record.props.data !== undefined) props.data = suggestionData(suggestionType(records, record), record.props.data);
    // Who trashed it is a name the op log keeps, as an author is; given with the time.
    given[record.id] = { ...record, props };
  }
  return { given, scoped };
}

/** A suggestion about a hidden department's material: its target is hidden, or its data names the department. */
function hiddenSuggestion(records: Records, record: SbdRecord, hidden: ReadonlySet<string>): boolean {
  if (hidden.size === 0) return false;
  const targetId = record.props.target_id;
  const target = typeof targetId === 'string' ? records[targetId] : undefined;
  if (target && hiddenByDepartment(records, target, hidden)) return true;
  return namesDepartment(record.props.data, hidden);
}

// ---- The server's last check -------------------------------------------------------------------------------------

/**
 * The contact-shaped values a project holds, for the server's last check (mcp/src/guard.ts), from every record, trashed
 * or not. Only values shaped as contacts are matched (round 2): a phone by its last 7 digits, an email, each address
 * and its first comma part, a coordinate to 3 decimals, a photo's time. A contact's name, a client's name, custom
 * fields and parking text aren't: they would match ordinary words (a crew member who shares a name), and their props
 * stay left out by the table above.
 */
export interface ContactGuard {
  /** Each stored phone's last 7 digits. */
  readonly phones: readonly string[];
  /** Emails, addresses (whole and first comma part) and photos' times, each as `guardText` writes it. */
  readonly texts: readonly string[];
  /** Coordinates, as stored. */
  readonly coordinates: readonly number[];
}

/** Text as the guard compares it: no format characters, NFKC, case-folded, whitespace collapsed. */
export function guardText(text: string): string {
  return normalText(text).toLowerCase().replace(/\s+/gu, ' ').trim();
}

export function contactGuard(records: Records): ContactGuard {
  const phones = new Set<string>();
  const texts = new Set<string>();
  const coordinates = new Set<number>();
  const phone = (value: JsonValue | undefined) => {
    if (typeof value !== 'string') return;
    const digits = digitsOf(normalText(value));
    if (digits.length >= 7) phones.add(digits.slice(-7));
  };
  const textOf = (value: JsonValue | undefined) => {
    if (typeof value !== 'string') return;
    const written = guardText(value);
    if (written.length >= 5) texts.add(written);
  };
  const address = (value: JsonValue | undefined) => {
    if (typeof value !== 'string') return;
    textOf(value);
    textOf(value.split(',')[0]);
  };
  const coordinate = (value: JsonValue | undefined) => {
    if (typeof value === 'number' && Number.isFinite(value)) coordinates.add(value);
  };
  const contactPart = (owner: JsonValue | undefined) => {
    if (typeof owner !== 'object' || owner === null || Array.isArray(owner)) return;
    phone(owner.phone);
    textOf(owner.email);
    address(owner.address);
  };
  for (const record of Object.values(records)) {
    if (!isRecordType(record.type)) continue;
    const rule = ASSISTANT_PROPS[record.type];
    for (const [key, why] of Object.entries(rule.leftOut)) {
      const value = record.props[key];
      if (why === 'contact') {
        if (/phone/.test(key)) phone(value);
        else if (/email/.test(key)) textOf(value);
        else if (/address/.test(key)) address(value);
      } else if (why === 'place') {
        if (/latitude|longitude/.test(key)) coordinate(value);
        else if (key === 'taken_at') textOf(value);
      }
    }
    // The parts of a project's props that are contact: the client's and the company's.
    if (record.type === 'project') {
      contactPart(record.props.client);
      contactPart(record.props.company);
    }
  }
  return { phones: [...phones], texts: [...texts], coordinates: [...coordinates] };
}

/** A digit group run in text as the guard reads it: digits joined by spaces, dashes, dots, slashes, brackets or a plus. */
const DIGIT_RUN = /\p{Nd}+(?:[\s\p{Pd}./()+]+\p{Nd}+)*/gu;
const DECIMAL_NUMBER = /\p{Nd}+\.(\p{Nd}{3,})/gu;

/** What contact detail of the guard's a text holds, or null: 'phone', 'text' or 'coordinate'. */
export function contactIn(guard: ContactGuard, text: string): 'phone' | 'text' | 'coordinate' | null {
  const written = guardText(text);
  if (guard.phones.length > 0) {
    const runs = [...written.matchAll(DIGIT_RUN)].map((m) => digitsOf(m[0]));
    if (guard.phones.some((tail) => runs.some((run) => run.includes(tail)))) return 'phone';
  }
  if (guard.texts.some((value) => written.includes(value) || written.includes(guardText(JSON.stringify(value).slice(1, -1))))) return 'text';
  if (guard.coordinates.length > 0) {
    const thousandths = (n: number) => [Math.round(Math.abs(n) * 1000), Math.trunc(Math.abs(n) * 1000)];
    const stored = new Set(guard.coordinates.flatMap(thousandths));
    for (const match of written.matchAll(DECIMAL_NUMBER)) {
      const n = Number(digitsOf(match[0].split('.')[0] ?? '') + '.' + digitsOf(match[1] ?? ''));
      if (thousandths(n).some((k) => stored.has(k))) return 'coordinate';
    }
  }
  return null;
}
