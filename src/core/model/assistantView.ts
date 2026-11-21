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
// - Free text that is given (notes, action, names) goes as typed, with anything that reads as an email address, a phone
//   number, a pair of coordinates or a map link taken out where it can be recognised, since a person may have typed one
//   there (`withoutContacts`).
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
// Unicode-aware (round 2). Format characters (`\p{Cf}`: zero-width spaces and joiners, soft hyphens, direction marks)
// are dropped first and the text normalised (NFKC), so a full-width digit, a "＠" or a non-breaking space reads as its
// plain form. Then, in order: map links (and what3words, plus codes), emails (an "@" or a lookalike: "(at)", "[at]",
// " at ", "@" with a space on both sides, " dot " for a dot), coordinate pairs and degrees-minutes-seconds, and phone
// numbers by the rule in `isPhone`. Ids and dates are never taken for a phone.
//
// Round 3: text in which nothing is taken out comes back exactly as stored (no normalising), and every pattern's start
// is anchored (a map link after a space, a quote or a bracket; an email's name not after a character a name can hold;
// a number not after a digit), so no text, however long one word of it is, makes a pattern try every start: 100 KB of
// one word is read in well under 100 ms (assistantView.test.ts).

/** The words put where a contact detail was taken out of free text. */
export const TAKEN_OUT = '[contact left out]';

/** Text without format characters, normalised (NFKC): what every rule here reads. */
export function normalText(text: string): string {
  return text.replace(/\p{Cf}/gu, '').normalize('NFKC').replace(/\p{Cf}/gu, '');
}

// What may sit right before a link: nothing, a space, a quote or a bracket.
const LINK_START = String.raw`(?<![^\s"'<>()[\]{}])`;
const LINK_CHAR = String.raw`[^\s"'<>()[\]{}]`;
const MAP_HOST = [
  String.raw`maps\.google\.`,
  String.raw`google\.[a-z]{2,3}(?:\.[a-z]{2})?\/maps`,
  String.raw`goo\.gl\/maps`,
  String.raw`maps\.app\.goo\.gl`,
  // maps.apple.com, and Apple's short links (maps.apple/p/…), round 4.
  String.raw`maps\.apple[./]`,
  String.raw`openstreetmap\.org`,
  String.raw`osm\.org`,
  String.raw`share\.google`,
  String.raw`waze\.com\/ul`,
  String.raw`bing\.com\/maps`,
  String.raw`w3w\.co`,
].join('|');
// A link that holds a map host anywhere, with everything after it to the next whitespace (round 4: a place's name in
// it can hold an apostrophe or brackets, "St+Mary's+Church", "Pier+9+(North)"; and a Google link's `!3d…!4d…`).
const MAP_LINK = new RegExp(String.raw`${LINK_START}${LINK_CHAR}*?(?:${MAP_HOST})\S*`, 'giu');
/** A map link without one closing bracket it didn't open: the sentence's, "(see https://maps…)". */
const mapLinkOut = (match: string): string | null => {
  const opened = match.split('(').length;
  const closed = match.split(')').length;
  return match.endsWith(')') && closed > opened ? `${TAKEN_OUT})` : null;
};
// what3words: ///filled.count.soap.
const WHAT3WORDS = new RegExp(String.raw`${LINK_START}\/\/\/\p{L}+\.\p{L}+\.\p{L}+`, 'gu');
// A plus code (849VCWC8+R9, CWC8+R9): capitals only, as Google writes them (round 4: "85mm+2x" is a lens), and only
// with a letter in it, so a sum ("2345+67") stays.
const PLUS_CODE = /(?<![\p{L}\p{N}+])[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}(?![\p{L}\p{N}])/gu;

const LOCAL_CHAR = String.raw`[\p{L}\p{N}._%+-]`;
// An email's name, never begun inside another one: the anchor that keeps a long word from being tried at every start.
const LOCAL = String.raw`(?<!${LOCAL_CHAR})${LOCAL_CHAR}+`;
const LABEL = String.raw`[\p{L}\p{N}-]+`;
// A dot between a domain's parts: ".", " dot ", "(dot)".
const DOT = String.raw`(?:\.|\s+dot\s+|\s*[([{]\s*dot\s*[)\]}]\s*)`;
/**
 * Common top-level domains: the only ends a domain written with a spelled-out dot (" dot ", "(dot)") or after a spaced
 * "@" can have (round 4), so "Eyeline at the dot on the C-stand" and "Crew call @ 0630. Shooting call @ 0730." stay.
 * Never one that is an English word: in, by, on, to, it, me, at, be, is, us, no, so, do, go, as.
 */
export const COMMON_TLDS = [
  'com', 'net', 'org', 'edu', 'gov', 'mil', 'info', 'biz', 'io', 'co', 'uk', 'es', 'fr', 'de', 'mx', 'ar', 'cl', 'pe',
  'ca', 'au', 'nz', 'ie', 'pt', 'br', 'nl', 'ch', 'se', 'dk', 'fi', 'pl', 'jp', 'cn', 'kr', 'ru', 'eu', 'za', 'uy', 'ec',
  'bo', 'py', 'cr', 'gt', 'sv', 'hn', 'cu', 'pr', 've', 'cat', 'dev', 'tv',
];
// The domain's end, not run on into a word. The spelled " at " form also never runs on into an apostrophe ("Meet at
// St.Mary's" is a place); the "@" forms may ("'robin@example.com'", "robin@example.com's"), round 4.
const NOT_ON = String.raw`(?![\p{L}\p{N}])`;
const NOT_ON_OR_APOSTROPHE = String.raw`(?![\p{L}\p{N}'’])`;
const COMMON_TLD = String.raw`(?:${COMMON_TLDS.join('|')})`;
// A domain: plain dots end in any two or more letters ("harbor.example"); one with a spelled-out dot ends in a common
// top-level domain.
const domain = (end: string) => String.raw`(?:${LABEL}(?:\.${LABEL})*\.\p{L}{2,}${end}|${LABEL}(?:${DOT}${LABEL})*${DOT}${COMMON_TLD}${end})`;
// After a spaced "@", a dot is "." or " . " with a space each side, never ". " alone (a sentence's end), round 4.
const SPACED_DOT = String.raw`(?:\.|\s+\.\s+)`;
const EMAILS = [
  // name@example.com, name@example dot com
  new RegExp(String.raw`${LOCAL}@${domain(NOT_ON)}`, 'giu'),
  // name @ example . com: a space on both sides of the @ (a handle, "DM @harbor.lights", has none before its name).
  new RegExp(String.raw`${LOCAL}\s+@\s+${LABEL}(?:${SPACED_DOT}${LABEL})*${SPACED_DOT}${COMMON_TLD}${NOT_ON}`, 'giu'),
  // name (at) example.com, name [at] example (dot) com
  new RegExp(String.raw`${LOCAL}\s*[([{]\s*at\s*[)\]}]\s*${domain(NOT_ON)}`, 'giu'),
  // name at example.com, name at example dot com
  new RegExp(String.raw`${LOCAL}\s+at\s+${domain(NOT_ON_OR_APOSTROPHE)}`, 'giu'),
];

// A coordinate: up to three digits, a point and four or more places, with a degree sign and a hemisphere if written.
const DECIMAL = String.raw`([-+−]?)(\p{Nd}{1,3}\.\p{Nd}{4,})(?:\s?°)?(?:\s?[NSEWnsew](?!\p{L}))?`;
// The second number is read ahead, not taken (round 4): a pair that isn't on Earth leaves its second number to start
// the next pair ("190.1234, 40.8677 -73.9212"). Groups: the first's sign and number, then the rest, then the second's.
const COORDINATE_PAIR = new RegExp(String.raw`(?<![\p{L}\p{N}.])${DECIMAL}(?=((?:\s*[,;/]\s*|\s+)${DECIMAL}(?!\p{N})))`, 'gu');
// 40°52'03.8"N, 40° 52′ 3″ N (NFKC writes ″ as ′′), 40°52'N.
const DMS = /(?<!\p{N})\p{Nd}{1,3}\s?°\s?\p{Nd}{1,2}(?:\.\p{Nd}+)?\s?['′](?:\s?\p{Nd}{1,2}(?:\.\p{Nd}+)?\s?(?:["″]|′′|'')?)?(?:\s?[NSEWnsew](?![\p{L}]))?/gu;

const UUID = String.raw`(?<![\p{L}\p{N}-])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\p{L}\p{N}-])`;
// A date, year first or last, with a time after it if there is one (06:30, 06.30, 06h30, T10:00:00.000).
const TIME = String.raw`(?:[T ]\p{Nd}{1,2}[:.h]\p{Nd}{2}(?:[:.]\p{Nd}{2}(?:\.\p{Nd}+)?)?)?`;
const DATE = String.raw`(?<!\p{N})(?:\p{Nd}{4}[-./]\p{Nd}{1,2}[-./]\p{Nd}{1,2}|\p{Nd}{1,2}[-./]\p{Nd}{1,2}[-./]\p{Nd}{4})(?!\p{N})${TIME}`;
// What joins a phone's groups: one space (any `\p{Zs}`), two spaces, a dash of any kind (and −), a dot, a slash, a
// middle dot, a dash with a space on each side, or a bracketed group.
const JOIN = String.raw`(?:\p{Zs}\p{Pd}\p{Zs}|\p{Zs}{2}|[\p{Zs}\p{Pd}./−·]|\)\p{Zs}?\p{Pd}?|\p{Zs}?\()`;
// Digits in groups, with a leading + or (. A letter right before or after doesn't stop it (Robin555-0123); a digit does.
const NUMBER = String.raw`(?<!\p{N})[+(]?\p{Nd}+(?:${JOIN}\p{Nd}+)*\)?(?!\p{N})`;
const ID_DATE_OR_NUMBER = new RegExp(`(${UUID})|(${DATE})|(${NUMBER})`, 'giu');

/** A digit's value, in any script's digits (`\p{Nd}` runs of ten). */
function digitValue(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  // ASCII digits, nearly every digit there is, need no search (round 3).
  if (code >= 48 && code <= 57) return code - 48;
  let back = 0;
  while (back < 60 && /\p{Nd}/u.test(String.fromCodePoint(code - back - 1))) back += 1;
  return back % 10;
}

/** A text's digits, as plain 0 to 9. */
export function digitsOf(text: string): string {
  // No digit but 0 to 9: none needs converting (round 3).
  if (!/(?![0-9])\p{Nd}/u.test(text)) return text.replace(/[^0-9]/g, '');
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
 * Whether a run of digit groups is a phone number: 7 or more digits (`\p{Nd}`), and one of
 * - a leading + or (;
 * - one run of 10 or more digits, or of 9 starting with 6, 7, 8 or 9 (612345678);
 * - two groups: the first of 3 digits or fewer, or starting with 0, and the last of 4 or more (555-0123). Never two
 *   groups whose first has 4 or more digits and doesn't start with 0 (night hours 1830-0630, 2234-5678, a reference
 *   2026-004512), nor a range: two groups joined by a dash, the second 0 to 999 above the first (1001-1096, 993-1104);
 * - three or more groups: the last of 4 or more digits (4111 1111 1111 1111); or 9 or more digits with the first group
 *   starting with 0 (06 12 34 56 78, 079 123 45 67, 0475 12 34 56); or 9 digits starting with 5 to 9 in groups of 2 or
 *   3, however grouped (round 4: Spain's and Poland's 612 34 56 78, 91 123 45 67, 512 345 678). Never other groups
 *   whose last has under 4 digits (101 102 103, 1 250 000, 18 25 35 50 85, 555.0123.88).
 * Never a decimal of 5 or more places (1.777778, an aspect ratio), round 4.
 * Over 15 digits ending in a group of 4 or more is taken out too: a card number, or a phone run on from other numbers,
 * is never what an assistant needs.
 */
function isPhone(match: string): boolean {
  const groups = (match.match(/\p{Nd}+/gu) ?? []).map(digitsOf);
  const digits = groups.join('');
  if (digits.length < 7) return false;
  if (/^[+(]/u.test(match)) return true;
  const [first = '', second = ''] = groups;
  const last = groups[groups.length - 1] ?? '';
  if (groups.length === 1) return digits.length >= 10 || (digits.length === 9 && /^[6-9]/.test(digits));
  if (groups.length === 2 && /^\p{Nd}+\.\p{Nd}{5,}$/u.test(match)) return false;
  if (groups.length === 2) {
    if (/^\p{Nd}+\p{Zs}?[\p{Pd}−]\p{Zs}?\p{Nd}+$/u.test(match)) {
      const rise = Number(second) - Number(first);
      if (rise >= 0 && rise <= 999) return false;
    }
    if (first.length >= 4 && !first.startsWith('0')) return false;
    return second.length >= 4;
  }
  if (last.length >= 4) return true;
  if (first.startsWith('0') && digits.length >= 9) return true;
  return digits.length === 9 && /^[5-9]/.test(digits) && groups.every((g) => g.length >= 2 && g.length <= 3);
}

/** Film text that runs numbers in groups and is never a phone: a camera's ISO steps ("ISO 800 1600 3200"), round 4. */
const ISO_BEFORE = /\bISO\p{Zs}*$/iu;

/** The phone numbers in a text, each as its plain digits, by the free-text rule (for the server's last check). */
export function phonesIn(text: string): string[] {
  return [...normalText(text).matchAll(new RegExp(NUMBER, 'gu'))].filter((m) => isPhone(m[0])).map((m) => digitsOf(m[0]));
}

/** A text's replacements, counting each, so a text with none comes back as it was stored. */
class Scrub {
  replaced = 0;
  text: string;
  constructor(text: string) {
    this.text = text;
  }
  /** Each match replaced unless `keep` gives it back; `keep` may give other words instead. No pattern here has named groups. */
  replace(pattern: RegExp, keep: (match: string, groups: (string | undefined)[], before: () => string) => string | null = () => null): this {
    this.text = this.text.replace(pattern, (match: string, ...rest: unknown[]) => {
      const groups = rest.slice(0, -2).map((g) => (typeof g === 'string' ? g : undefined));
      const offset = rest[rest.length - 2];
      const whole = rest[rest.length - 1];
      // The few characters before the match, read only when asked.
      const before = () => (typeof offset === 'number' && typeof whole === 'string' ? whole.slice(Math.max(0, offset - 16), offset) : '');
      const kept = keep(match, groups, before);
      if (kept === match) return match;
      this.replaced += 1;
      return kept ?? TAKEN_OUT;
    });
    return this;
  }

  /**
   * Each match, with the rest its pattern read ahead (its group `tail`), replaced when `take` says so; a match not taken
   * uses up only itself, so what it read ahead can start the next match.
   */
  replaceReadingAhead(pattern: RegExp, tail: number, take: (groups: (string | undefined)[]) => boolean): this {
    let out = '';
    let at = 0;
    pattern.lastIndex = 0;
    for (let match = pattern.exec(this.text); match !== null; match = pattern.exec(this.text)) {
      if (!take(match.slice(1))) continue;
      out += this.text.slice(at, match.index) + TAKEN_OUT;
      at = match.index + match[0].length + (match[tail] ?? '').length;
      pattern.lastIndex = at;
      this.replaced += 1;
    }
    this.text = out + this.text.slice(at);
    return this;
  }
}

/** Whether a coordinate pair's two numbers are a latitude (to 90) and a longitude (to 180), either way round (round 4). */
const onEarth = (groups: (string | undefined)[]): boolean => {
  const a = Math.abs(normalNumber(groups[1] ?? ''));
  const b = Math.abs(normalNumber(groups[4] ?? ''));
  return (a <= 90 && b <= 180) || (a <= 180 && b <= 90);
};

/** A decimal written in any script's digits, as a number. */
function normalNumber(text: string): number {
  const [whole = '', places = ''] = text.split('.');
  return Number(`${digitsOf(whole)}.${digitsOf(places)}`);
}

/** Free text with anything that reads as an email address, a phone number, coordinates or a map link taken out. */
export function withoutContacts(text: string): string {
  const scrub = new Scrub(normalText(text))
    .replace(MAP_LINK, mapLinkOut)
    .replace(WHAT3WORDS)
    .replace(PLUS_CODE, (match) => (/[A-Z]/u.test(match) ? null : match));
  for (const email of EMAILS) scrub.replace(email);
  scrub
    .replaceReadingAhead(COORDINATE_PAIR, 3, onEarth)
    .replace(DMS)
    .replace(ID_DATE_OR_NUMBER, (match, [id, date], before) => {
      if (id !== undefined) return match;
      if (date !== undefined && isDate(match)) return match;
      // A closing bracket with no opening one is the sentence's, not the number's: "(call +1 555 0166)".
      const own = match.endsWith(')') && !match.includes('(') ? match.slice(0, -1) : match;
      if (!isPhone(own) || ISO_BEFORE.test(before())) return match;
      return TAKEN_OUT + match.slice(own.length);
    });
  // Nothing taken out: the text exactly as stored (round 3), its format characters and all.
  return scrub.replaced === 0 ? text : scrub.text;
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

/** Whether a value is a canonical UUID, as every record's id is. */
export const isUuid = (value: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/**
 * The type a suggestion's data is read by: its target's own type when the target is in the project (a call sheet's
 * suggestion targets its shoot day and carries the sheet's props), else the type it says.
 */
export function suggestionType(records: Records, record: SbdRecord): string {
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
    // A type, only as text of at most 100 characters, or null (round 3); two ids, only as ids (round 4: a canonical
    // UUID, or null). Anything else is left out.
    else if (key === 'type') {
      if (value === null) out[key] = null;
      else if (typeof value === 'string' && value.length <= 100) out[key] = withoutContacts(value);
    } else if (key === 'parent_id' || key === 'after_id') {
      if (value === null || (typeof value === 'string' && isUuid(value))) out[key] = value;
    }
  }
  return out;
}

/** A field name a record of this type has, given or left out: only those are named back. */
export function knownProp(type: string, name: string): boolean {
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
 * or not. Round 3: the check replaces what it finds with `TAKEN_OUT`, as the free-text rule does, and never refuses an
 * answer; it reads only typed text (mcp/src/guard.ts says which strings), never a number. Only values shaped as
 * contacts are kept: every phone-shaped run of a stored phone field ("555-0123 / 555-0199" is two, an "x 45" tail left
 * out) by its last 7 digits, and the phone numbers typed in left-out text (a person's notes, a location's, own fields'
 * values); a stored email; a stored address, whole; a stored coordinate. A contact's name, a client's name and parking
 * text aren't: they would match ordinary words (a crew member who shares a name), and their props stay left out.
 */
export interface ContactGuard {
  /** Each stored phone's last 7 digits. */
  readonly phones: readonly string[];
  /** Emails and whole addresses, each as `guardText` writes it. */
  readonly texts: readonly string[];
  /** The emails among them (round 4: under a name the guard looks for phones and emails only). */
  readonly emails: readonly string[];
  /** Coordinates, as stored. */
  readonly coordinates: readonly number[];
}

/** Text as the guard compares it: no format characters, NFKC, case-folded, whitespace collapsed. */
export function guardText(text: string): string {
  return normalText(text).toLowerCase().replace(/\s+/gu, ' ').trim();
}

/** Every string in a value, however deep. */
function stringsOf(value: JsonValue | undefined, depth = 0): string[] {
  if (depth > 16 || value === undefined || value === null) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap((inner) => stringsOf(inner, depth + 1));
  if (typeof value === 'object') return Object.values(value).flatMap((inner) => stringsOf(inner, depth + 1));
  return [];
}

/**
 * A stored phone field's digit runs, each as its groups of plain digits: "555-0107 / 555-0199" is two runs, and
 * "555-0107/555-0199" or "555 0107 555 0199" one run of two numbers (round 4).
 */
function digitGroupsIn(text: string): string[][] {
  return [...normalText(text).matchAll(new RegExp(NUMBER, 'gu'))].map((m) => (m[0].match(/\p{Nd}+/gu) ?? []).map(digitsOf));
}

export function contactGuard(records: Records): ContactGuard {
  const phones = new Set<string>();
  const texts = new Set<string>();
  const emails = new Set<string>();
  const coordinates = new Set<number>();
  const tail = (digits: string) => {
    if (digits.length >= 7) phones.add(digits.slice(-7));
  };
  // A stored phone field: each of its digit runs that is long enough, whatever its shape. A run of 14 or more digits
  // holds two numbers or more, written with nothing between them but a slash or a space: each number's last 7 digits
  // too, its groups taken in order until 7 or more digits are gathered (round 4).
  const phone = (value: JsonValue | undefined) => {
    for (const text of stringsOf(value)) {
      for (const groups of digitGroupsIn(text)) {
        const digits = groups.join('');
        tail(digits);
        if (digits.length < 14) continue;
        let gathered = '';
        for (const group of groups) {
          gathered += group;
          if (gathered.length < 7) continue;
          tail(gathered);
          gathered = '';
        }
      }
    }
  };
  // Left-out text: the phone numbers typed in it, by the free-text rule.
  const typed = (value: JsonValue | undefined) => {
    for (const text of stringsOf(value)) for (const run of phonesIn(text)) tail(run);
  };
  const textOf = (value: JsonValue | undefined, email = false) => {
    if (typeof value !== 'string') return;
    const written = guardText(value);
    if (written.length < 5) return;
    texts.add(written);
    if (email) emails.add(written);
  };
  const coordinate = (value: JsonValue | undefined) => {
    if (typeof value === 'number' && Number.isFinite(value)) coordinates.add(value);
  };
  const contactPart = (owner: JsonValue | undefined) => {
    if (typeof owner !== 'object' || owner === null || Array.isArray(owner)) return;
    phone(owner.phone);
    textOf(owner.email, true);
    textOf(owner.address);
    typed(owner);
  };
  for (const record of Object.values(records)) {
    if (!isRecordType(record.type)) continue;
    const rule = ASSISTANT_PROPS[record.type];
    for (const [key, why] of Object.entries(rule.leftOut)) {
      const value = record.props[key];
      if (why === 'contact') {
        if (/phone/.test(key)) phone(value);
        else if (/email/.test(key)) textOf(value, true);
        else if (/address/.test(key)) textOf(value);
        else typed(value);
      } else if (why === 'place' && /latitude|longitude/.test(key)) coordinate(value);
    }
    // A location's notes are given, scrubbed; a number typed there is matched elsewhere too (a frame's action).
    if (record.type === 'location') typed(record.props.notes);
    // The parts of a project's props that are contact: the client's and the company's.
    if (record.type === 'project') {
      contactPart(record.props.client);
      contactPart(record.props.company);
    }
  }
  return { phones: [...phones], texts: [...texts], emails: [...emails], coordinates: [...coordinates] };
}

/** A digit group run in text as the guard reads it: digits joined by spaces, dashes, dots, slashes, brackets or a plus. */
const DIGIT_RUN = /[+(]?\p{Nd}+(?:[\s\p{Pd}./()+−·]+\p{Nd}+)*\)?/gu;
/** Canonical UUIDs and ISO dates and date-times: blanked before a phone is looked for, so their digits never match. */
const ID_OR_ISO_DATE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\p{Nd}{4}-\p{Nd}{2}-\p{Nd}{2}(?:T\p{Nd}{2}:\p{Nd}{2}(?::\p{Nd}{2}(?:\.\p{Nd}+)?)?(?:Z|[+-]\p{Nd}{2}:?\p{Nd}{2})?)?)/iu;
/** A coordinate as typed: four or more places. */
const TYPED_COORDINATE = /(?<![\p{N}.])[-+−]?(\p{Nd}{1,3})\.(\p{Nd}{4,})(?!\p{N})/gu;

interface GuardPatterns {
  phones: ReadonlySet<string>;
  /** Stored addresses, as whole-word patterns. */
  addresses: readonly RegExp[];
  /** Stored emails, as whole-word patterns. */
  emails: readonly RegExp[];
  /** Each stored coordinate at 4 places, cut and rounded, in ten-thousandths. */
  coordinates: ReadonlySet<number>;
}

const patterns = new WeakMap<ContactGuard, GuardPatterns>();

/**
 * A stored value as a pattern: case-folded, any run of spaces for a space, and only as a whole word (round 4: a stored
 * "1 Main St" isn't inside "21 Main Street").
 */
const asPattern = (value: string) =>
  new RegExp(
    String.raw`(?<![\p{L}\p{N}])` +
      value
        .split(' ')
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join(String.raw`\s+`) +
      String.raw`(?![\p{L}\p{N}])`,
    'giu',
  );

function patternsOf(guard: ContactGuard): GuardPatterns {
  const known = patterns.get(guard);
  if (known) return known;
  const emails = new Set(guard.emails);
  const made: GuardPatterns = {
    phones: new Set(guard.phones),
    addresses: guard.texts.filter((text) => !emails.has(text)).map(asPattern),
    emails: [...emails].map(asPattern),
    coordinates: new Set(guard.coordinates.flatMap((n) => [Math.trunc(Math.abs(n) * 10000), Math.round(Math.abs(n) * 10000)])),
  };
  patterns.set(guard, made);
  return made;
}

/** Whether a digit run holds a stored phone's last 7 digits. */
function holdsPhone(phones: ReadonlySet<string>, run: string): boolean {
  const digits = digitsOf(run);
  for (let at = 0; at + 7 <= digits.length; at += 1) if (phones.has(digits.slice(at, at + 7))) return true;
  return false;
}

export interface StoredContactsOptions {
  /**
   * A name the view gives (a person's, a location's, a label): only stored phones and emails are looked for in it, never
   * addresses or coordinates, so a place named as its address begins, or as its street, stays (round 4).
   */
  name?: boolean;
}

/**
 * A typed text with every stored contact value the guard holds replaced with `TAKEN_OUT`: an email or a whole address
 * however it is written (case, spaces, full-width), as a whole word; a coordinate of 4 or more places that is a stored
 * one to 4 places; and a digit run holding a stored phone's last 7 digits (ids and ISO dates blanked first). A text
 * with none comes back exactly as stored.
 */
export function withoutStoredContacts(guard: ContactGuard, text: string, options: StoredContactsOptions = {}): string {
  const all = patternsOf(guard);
  const phones = all.phones;
  const texts = options.name === true ? all.emails : [...all.emails, ...all.addresses];
  const coordinates = options.name === true ? new Set<number>() : all.coordinates;
  if (phones.size === 0 && texts.length === 0 && coordinates.size === 0) return text;
  let replaced = 0;
  const out = () => {
    replaced += 1;
    return TAKEN_OUT;
  };
  let written = normalText(text);
  for (const pattern of texts) written = written.replace(pattern, out);
  if (coordinates.size > 0) {
    written = written.replace(TYPED_COORDINATE, (match: string, whole: string, places: string) => {
      const cut = Number(digitsOf(whole) + digitsOf(places).slice(0, 4));
      const rounded = Math.round(Number(`${digitsOf(whole)}.${digitsOf(places)}`) * 10000);
      return coordinates.has(cut) || coordinates.has(rounded) ? out() : match;
    });
  }
  if (phones.size > 0) {
    // Split on ids and ISO dates (the split keeps them, at odd places) and look for phones between them only.
    written = written
      .split(ID_OR_ISO_DATE)
      .map((part, index) => (index % 2 === 1 ? part : part.replace(DIGIT_RUN, (run) => (holdsPhone(phones, run) ? out() : run))))
      .join('');
  }
  return replaced === 0 ? text : written;
}
