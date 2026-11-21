import { contactGuard, withoutContacts, withoutStoredContacts } from '../../src/core/model/assistantView';
import { dayCallsheet } from '../../src/core/model/callsheet';
import { gearFields, gearIdsOf, projectGear } from '../../src/core/model/gear';
import { locationFields, projectLocations } from '../../src/core/model/location';
import { personFields, projectPeople } from '../../src/core/model/person';
import type { JsonValue, SbdRecord } from '../../src/core/model/record';
import { dayLabel, type ShootDay } from '../../src/core/model/shootDay';
import { sceneFields, sceneLabel, shotFields } from '../../src/core/model/storyboard';
import { lastWritten, MAX_FIELDS, reviewFlagWords, reviewSuggestion, SUGGESTION_BOUNDS, type SuggestionFlag } from '../../src/core/model/suggestion';
import { boardScene } from '../../src/core/ops/storyboardEdits';
import { MAX_CHANGE_FILE_BYTES, readChangeFile, refusalWords } from '../../src/core/storage/changeFile';
import { buildChangeFile, type BuiltChangeFile, type FileSuggestion } from './changeFile';
import { boardScenes, dayOf, read, sceneByNumber, ToolError, type Read, type ToolContext } from './tools';

// The propose tools (7.6, Phase 7 decisions 3, 4 and 16): each turns plain arguments (a scene number, a frame number, a
// day by date or number, field values as the app's own) into 7.0's suggestions, their `before` values from the project
// as read, and checks them before anything is written: every suggestion through 7.0's reader under the assistant's
// scope row (reviewSuggestion, as the review screen will read it), and the whole file through 7.1's reader, the very
// bytes that will be written. Anything refused is said in words at once and nothing is written, so the assistant
// learns. Pure: the server's write is changeFolder.ts's alone.
//
// Round 2, no contact oracle: the bounds come first (MAX_PER_CALL suggestions, MAX_FIELDS fields of at most
// MAX_KEY-character names and MAX_VALUE-character values, the whole call at most 256 KB in server.ts), then the scope
// row and the fields, and only then any look for a contact. A call is refused for a contact only by the free-text rule
// (what the assistant's own text shows: a phone number, an email, coordinates, a map link). No answer repeats a value
// the assistant gave: it says what was written by counts and by labels from the project's own records.
//
// Round 3: nothing the assistant sends is matched against the values the project stores. The guard keeps stored
// contacts out of what goes to the assistant; whatever it sends it holds already, so matching it protects nothing, and
// any trace of the match (a bound crossed after a replacement, a marker read back later) would say which guess was
// stored. The file holds exactly what was sent, after the bounds, the scope and the free-text rule: one build, one
// read, one answer, whatever the values. A name looked up (a location, gear, a person) is compared with each record's
// name through the free-text rule, and one that rule would change is refused before any record is looked at.
// Refusals: words made from records go through the view and the guard (`recordWords`); words that repeat the
// assistant's own arguments ("There's no frame numbered "99Z"") are a function of those arguments alone, so they say
// nothing of what is stored, and stay as they are.

type Obj = { [key: string]: JsonValue };

/** What one call proposes: the file's suggestions, each said in a line for the answer. */
export interface Proposal {
  suggestions: FileSuggestion[];
  lines: string[];
}

/** Most suggestions one call makes (frames added, changed, moved or trashed, and a new scene). */
export const MAX_PER_CALL = 200;
/** Longest name of a field. */
export const MAX_KEY = 100;
/** Longest value of a field, in characters (as JSON, for a value that isn't text). */
export const MAX_VALUE = 10_000;
/** How deep a value is read; deeper is refused. */
const MAX_DEPTH = 16;
/** Most people one call gives times for. */
const MAX_PEOPLE = 200;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A value from the call as JSON: it came as JSON, but a value is never trusted to be one. */
function jsonOf(value: unknown, field: string, depth = 0): JsonValue {
  if (depth > MAX_DEPTH) throw new ToolError(`${field} isn't a value it takes.`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ToolError(`${field} isn't a number it takes.`);
    return value;
  }
  if (Array.isArray(value)) return value.map((inner) => jsonOf(inner, field, depth + 1));
  if (isObject(value)) {
    const out: Obj = {};
    for (const [key, inner] of Object.entries(value)) Object.defineProperty(out, key, { value: jsonOf(inner, field, depth + 1), enumerable: true, writable: true, configurable: true });
    return out;
  }
  throw new ToolError(`${field} isn't a value it takes.`);
}

/** A value's length as the bounds count it: a text's characters, anything else's JSON. Never more than the bound reads. */
function valueLength(value: unknown): number {
  if (typeof value === 'string') return value.length;
  try {
    // Undefined for a value JSON has no text for (undefined itself), whatever the type says.
    const text = JSON.stringify(value) as string | undefined;
    return text === undefined ? 0 : text.length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * A map of named values checked against the bounds before anything in it is read (round 2): an object, at most `most`
 * names of at most MAX_KEY characters, each value at most MAX_VALUE characters.
 */
function bounded(given: unknown, what: string, most = MAX_FIELDS): Record<string, unknown> {
  if (!isObject(given)) throw new ToolError(`${what}: fields are named values ({ "size": "CU", "lens_mm": 85 }).`);
  const keys = Object.keys(given);
  if (keys.length > most) throw new ToolError(`${what}: at most ${String(most)} fields at a time.`);
  for (const key of keys) {
    if (key.length > MAX_KEY) throw new ToolError(`${what}: a field's name is at most ${String(MAX_KEY)} characters.`);
    if (valueLength(given[key]) > MAX_VALUE) throw new ToolError(`${what}: a field's value is at most ${String(MAX_VALUE).replace(/\B(?=(\d{3})+$)/g, ',')} characters.`);
  }
  return given;
}

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** What the refusals say a contact detail reads as. */
const CONTACT_WORDS = 'what reads as a phone number, an email, an address, coordinates or a map link';

/** Whether a text shows a contact detail by the free-text rule alone: what the assistant's own text shows. */
const showsContact = (text: string): boolean => withoutContacts(text) !== text;

/**
 * Words made from the project's records (a gear item's name) for a refusal, as an answer's would be (round 3): through
 * the view's free-text rule, then the guard, as a name. A refusal leaves without the server's guard (server.ts), so it
 * is applied here.
 */
function recordWords(r: Read, text: string): string {
  return withoutStoredContacts(contactGuard(r.data.records), withoutContacts(text), { name: true });
}

/**
 * A live record by its id, else by its name; never a guess between two of one name (round 2). The refusals name only
 * what the project holds, never the value the assistant gave. Round 3: a name the free-text rule would change is
 * refused without a look at any record, and each record's name is compared as the view gives it (`viewText`), so a
 * phone typed in a record's name can't be confirmed by guessing it.
 */
function oneOf<T extends { record: SbdRecord }>(
  r: Read,
  live: readonly T[],
  value: string,
  nameOf: (item: T) => string,
  words: { none: string; contact: string; two: (name: string, count: number) => string },
): string {
  if (showsContact(value)) throw new ToolError(words.contact);
  const byId = live.find((item) => item.record.id === value);
  if (byId) return byId.record.id;
  const named = live.filter((item) => sameText(withoutContacts(nameOf(item)), value));
  const [first] = named;
  if (!first) throw new ToolError(words.none);
  if (named.length > 1) throw new ToolError(words.two(recordWords(r, nameOf(first)).trim(), named.length));
  return first.record.id;
}

/** A name to look up that holds what reads as a contact: refused, never said back. */
const contactName = (what: string, list: string) => `A name to look up can't hold ${CONTACT_WORDS}: give the ${what}'s id (${list}).`;

const howMany = (count: number) => (count === 2 ? 'Two' : String(count));

/** A frame's label as a person sees it on the board: "SC 12 · 12A". */
const frameLabel = (scene: SbdRecord, shot: SbdRecord) => `${sceneLabel(sceneFields(scene.props).number)} · ${shotFields(shot.props).number}`;
const sceneWords = (scene: SbdRecord) => sceneLabel(sceneFields(scene.props).number);

/** A live frame by its number ("12A"), in a scene when one is named; never a guess between two. */
function frameByNumber(r: Read, number: string, scene?: SbdRecord): { shot: SbdRecord; scene: SbdRecord } {
  const wanted = number.trim().toUpperCase();
  const scenes = scene ? [scene] : boardScenes(r, false);
  const found = scenes.flatMap((s) =>
    Object.values(r.scoped)
      .filter((f) => f.type === 'shot' && f.parentId === s.id && f.trashedAt === null && shotFields(f.props).number.toUpperCase() === wanted)
      .map((shot) => ({ shot, scene: s })),
  );
  const [first] = found;
  // The assistant's own argument said back (round 3): a function of what it sent alone, whatever the project stores.
  if (!first) throw new ToolError(`There's no frame numbered "${number}"${scene ? ` in ${sceneWords(scene)}` : ''}. list_shots lists them.`);
  if (found.length > 1) throw new ToolError(`More than one frame is numbered "${number}": name its scene too.`);
  return first;
}

/** A scene's live notes in board order, counted from 1, as the board shows them among its frames. */
function noteOf(r: Read, scene: SbdRecord, n: number): SbdRecord {
  const notes = boardScene(r.scoped, scene).items.flatMap((item) => (item.kind === 'note' ? [item.note.record] : []));
  const note = notes[n - 1];
  if (!note) throw new ToolError(`${sceneWords(scene)} has ${notes.length === 0 ? 'no notes' : `${String(notes.length)} note${notes.length === 1 ? '' : 's'}`}: there's no note ${String(n)}.`);
  return note;
}

/** A live location by its id or its name. */
function locationOf(r: Read, value: string): string {
  return oneOf(r, projectLocations(r.scoped, r.projectId), value, (l) => locationFields(l.record.props).name, {
    none: "There's no location of that name. list_locations lists them.",
    contact: contactName('location', 'list_locations lists them'),
    two: (name, count) => `${howMany(count)} locations are named "${name}": give its id (list_locations lists them).`,
  });
}

/** A live gear item of the catalogue by its id or its name. */
function gearOf(r: Read, value: string): string {
  return oneOf(r, projectGear(r.scoped, r.projectId), value, (g) => gearFields(g.record.props).name, {
    none: "There's no gear item of that name in the catalogue. list_gear lists it.",
    contact: contactName('gear item', 'list_gear lists them'),
    two: (name, count) => `${howMany(count)} gear items are named "${name}": give its id (list_gear lists them).`,
  });
}

/** A live person by id or name. */
function personOf(r: Read, value: string): string {
  return oneOf(r, projectPeople(r.scoped, r.projectId), value, (p) => personFields(p.record.props).name, {
    none: "There's no one of that name in Cast and crew. list_people lists them.",
    contact: contactName('person', 'list_people lists them'),
    two: (name, count) => `${howMany(count)} people are named "${name}": give their id (list_people lists them).`,
  });
}

/** The names the tools take for a field, besides its own: a location, a day and gear by what a person calls them. */
const ALIASES: Readonly<Record<string, string>> = { location: 'location_id', shoot_day: 'shoot_day_id', gear: 'gear_ids' };

/**
 * A frame's or a scene's fields as the call gave them, its plain values made the app's own: a location by name, a shoot
 * day by its date or number, gear by name. A field the scope row doesn't have stays as named, so 7.0's reader refuses it.
 */
function fieldsOf(r: Read, given: unknown, what: string): Obj {
  const out: Obj = {};
  for (const [name, raw] of Object.entries(bounded(given, what))) {
    const field = Object.hasOwn(ALIASES, name) ? (ALIASES[name] ?? name) : name;
    let value = jsonOf(raw, field);
    if (field === 'location_id' && typeof value === 'string') value = locationOf(r, value);
    if (field === 'shoot_day_id' && typeof value === 'string') value = Object.hasOwn(r.scoped, value) && r.scoped[value]?.type === 'shoot_day' ? value : dayOf(r, value).record.id;
    if (field === 'gear_ids' && Array.isArray(value)) value = value.map((v) => (typeof v === 'string' ? gearOf(r, v) : v));
    Object.defineProperty(out, field, { value, enumerable: true, writable: true, configurable: true });
  }
  if (Object.keys(out).length === 0) throw new ToolError(`${what}: name at least one field.`);
  return out;
}

/** What the project holds for each named field, as the suggester saw it: its `before`. */
function beforeOf(record: SbdRecord | null, fields: Obj): Obj {
  const out: Obj = {};
  for (const field of Object.keys(fields)) Object.defineProperty(out, field, { value: record?.props[field] ?? null, enumerable: true, writable: true, configurable: true });
  return out;
}

const fieldCount = (props: Obj) => {
  const n = Object.keys(props).length;
  return `${String(n)} field${n === 1 ? '' : 's'}`;
};

const note = (value: string | undefined): string => value ?? '';

const newId = () => crypto.randomUUID();

// -- suggest_shot_changes ----------------------------------------------------------------------------------------------

export interface ShotChangesArgs {
  changes: { frame: string; scene?: string | undefined; fields: Record<string, unknown> }[];
  note?: string | undefined;
}

export function suggestShotChanges(context: ToolContext, args: ShotChangesArgs): Proposal {
  const r = read(context);
  const suggestions: FileSuggestion[] = [];
  const lines: string[] = [];
  for (const change of args.changes) {
    const { shot, scene } = frameByNumber(r, change.frame, change.scene === undefined ? undefined : sceneByNumber(r, change.scene));
    const label = frameLabel(scene, shot);
    const props = fieldsOf(r, change.fields, label);
    suggestions.push({ id: newId(), kind: 'update', target: { id: shot.id, type: 'shot', label, updated_at: shot.updatedAt }, note: note(args.note), data: { props, before: beforeOf(shot, props) } });
    lines.push(`Change ${label}: ${fieldCount(props)}.`);
  }
  return { suggestions, lines };
}

// -- suggest_new_shots -------------------------------------------------------------------------------------------------

export interface NewShotsArgs {
  scene?: string | undefined;
  new_scene?: Record<string, unknown> | undefined;
  after?: string | undefined;
  frames: Record<string, unknown>[];
  note?: string | undefined;
}

export function suggestNewShots(context: ToolContext, args: NewShotsArgs): Proposal {
  const r = read(context);
  if ((args.scene === undefined) === (args.new_scene === undefined)) throw new ToolError('suggest_new_shots: name an existing scene (scene) or describe a new one (new_scene), not both.');
  const suggestions: FileSuggestion[] = [];
  const lines: string[] = [];
  let parentId: string;
  let afterId: string | null;
  let where: string;
  if (args.new_scene !== undefined) {
    const { after, ...fields } = bounded(args.new_scene, 'new_scene', MAX_FIELDS + 1);
    // After the scene named, else at the end of the board, as + Add Scene puts one; first on a board with none.
    const live = boardScenes(r, false);
    const afterScene = typeof after === 'string' ? sceneByNumber(r, after) : (live.at(-1) ?? null);
    if (after !== undefined && typeof after !== 'string') throw new ToolError('new_scene.after is a scene number as text ("12").');
    const props = fieldsOf(r, fields, 'new_scene');
    const id = newId();
    const label = afterScene ? `New scene after ${sceneWords(afterScene)}` : 'New scene';
    suggestions.push({ id, kind: 'create', target: { type: 'scene', label }, note: note(args.note), data: { type: 'scene', parent_id: r.projectId, after_id: afterScene?.id ?? null, props } });
    lines.push(`Add a scene${afterScene ? ` after ${sceneWords(afterScene)}` : ''}: ${fieldCount(props)}.`);
    if (args.after !== undefined) throw new ToolError('suggest_new_shots: after places frames among a scene’s own; a new scene’s frames go in the order given.');
    parentId = id;
    afterId = null;
    where = 'the new scene';
  } else {
    const scene = sceneByNumber(r, args.scene ?? '');
    const items = boardScene(r.scoped, scene).items;
    parentId = scene.id;
    if (args.after === undefined) {
      const last = items.at(-1);
      afterId = last ? (last.kind === 'shot' ? last.shot.record.id : last.note.record.id) : null;
    } else if (args.after.trim().toLowerCase() === 'start') afterId = null;
    else afterId = frameByNumber(r, args.after, scene).shot.id;
    where = sceneWords(scene);
  }
  if (args.frames.length === 0 && args.new_scene === undefined) throw new ToolError('suggest_new_shots: give at least one frame.');
  args.frames.forEach((frame, i) => {
    const props = fieldsOf(r, frame, `frame ${String(i + 1)}`);
    const id = newId();
    suggestions.push({ id, kind: 'create', target: { type: 'shot', label: `New frame ${String(i + 1)} in ${where}` }, note: note(args.note), data: { type: 'shot', parent_id: parentId, after_id: afterId, props } });
    lines.push(`Add a frame in ${where}: ${fieldCount(props)}.`);
    // Each after the one before it, so the frames keep the order given (7.0: an after_id may name a create of the file).
    afterId = id;
  });
  return { suggestions, lines };
}

// -- suggest_reorder ---------------------------------------------------------------------------------------------------

export interface ReorderArgs {
  moves: { frame?: string | undefined; scene?: string | undefined; note?: number | undefined; to_scene?: string | undefined; after?: string | undefined; after_note?: number | undefined }[];
  note?: string | undefined;
}

/** A frame (by number, in a scene when named) or a scene's note (by its number in the scene). */
function itemOf(r: Read, item: { frame?: string | undefined; scene?: string | undefined; note?: number | undefined }, what: string): { record: SbdRecord; scene: SbdRecord; label: string } {
  if (item.frame !== undefined) {
    const { shot, scene } = frameByNumber(r, item.frame, item.scene === undefined ? undefined : sceneByNumber(r, item.scene));
    return { record: shot, scene, label: frameLabel(scene, shot) };
  }
  if (item.note !== undefined && item.scene !== undefined) {
    const scene = sceneByNumber(r, item.scene);
    return { record: noteOf(r, scene, item.note), scene, label: `${sceneWords(scene)} · note ${String(item.note)}` };
  }
  throw new ToolError(`${what}: name a frame by its number, or a note by its scene and its number in the scene.`);
}

export function suggestReorder(context: ToolContext, args: ReorderArgs): Proposal {
  const r = read(context);
  const suggestions: FileSuggestion[] = [];
  const lines: string[] = [];
  args.moves.forEach((move, i) => {
    const what = `move ${String(i + 1)}`;
    const item = itemOf(r, move, what);
    const to = move.to_scene === undefined ? item.scene : sceneByNumber(r, move.to_scene);
    let afterId: string | null;
    let after: string;
    if (move.after_note !== undefined) {
      afterId = noteOf(r, to, move.after_note).id;
      after = `after note ${String(move.after_note)}`;
    } else if (move.after === undefined) {
      throw new ToolError(`${what}: give after (a frame number, or "start") or after_note (a note’s number in the scene).`);
    } else if (move.after.trim().toLowerCase() === 'start') {
      afterId = null;
      after = 'to the start';
    } else {
      const frame = frameByNumber(r, move.after, to).shot;
      afterId = frame.id;
      // The frame's number as the project has it, never as the call wrote it.
      after = `after ${shotFields(frame.props).number}`;
    }
    suggestions.push({
      id: newId(),
      kind: 'reorder',
      target: { id: item.record.id, type: item.record.type, label: item.label, updated_at: lastWritten(r.data.records, item.record) },
      note: note(args.note),
      data: { parent_id: to.id, after_id: afterId },
    });
    lines.push(`Move ${item.label} ${after}${to.id === item.scene.id ? '' : ` in ${sceneWords(to)}`}.`);
  });
  return { suggestions, lines };
}

// -- suggest_gear_for_day ----------------------------------------------------------------------------------------------

export interface GearForDayArgs {
  day: string;
  add?: string[] | undefined;
  remove?: string[] | undefined;
  note?: string | undefined;
}

export function suggestGearForDay(context: ToolContext, args: GearForDayArgs): Proposal {
  const r = read(context);
  const day = dayOf(r, args.day);
  const adds = (args.add ?? []).map((g) => gearOf(r, g));
  const removes = (args.remove ?? []).map((g) => gearOf(r, g));
  if (adds.length === 0 && removes.length === 0) throw new ToolError('suggest_gear_for_day: name gear to add or to remove.');
  const stored = Array.isArray(day.record.props.gear_ids) ? day.record.props.gear_ids : [];
  // The list a person would end with: what they can see on it (live items), less those taken off, then those added at
  // the end, as the Gear picker puts them. What they can't see stays where it is (7.0's own edit keeps it). Live is
  // judged on the full records (round 2): an item of a department the view hides is still on the list.
  const live = gearIdsOf(day.record.props).filter((id) => {
    const item = Object.hasOwn(r.data.records, id) ? r.data.records[id] : undefined;
    return item !== undefined && item.trashedAt === null && item.type === 'gear_item';
  });
  const dayName = dayLabel(day);
  for (const id of removes) if (!live.includes(id)) throw new ToolError(`${recordWords(r, gearFields(r.scoped[id]?.props ?? {}).name)} isn't on ${dayName}’s list.`);
  const wanted = [...live.filter((id) => !removes.includes(id)), ...adds.filter((id, i) => !live.includes(id) && adds.indexOf(id) === i)];
  const label = dayName;
  const props: Obj = { gear_ids: wanted };
  const names = (ids: string[]) => ids.map((id) => gearFields(r.scoped[id]?.props ?? {}).name).join(', ');
  return {
    suggestions: [{ id: newId(), kind: 'update', target: { id: day.record.id, type: 'shoot_day', label, updated_at: day.record.updatedAt }, note: note(args.note), data: { props, before: { gear_ids: stored } } }],
    lines: [`${dayName}’s gear list${adds.length > 0 ? `: add ${names(adds)}` : ''}${removes.length > 0 ? `${adds.length > 0 ? ';' : ':'} take off ${names(removes)}` : ''}.`],
  };
}

// -- suggest_call_sheet_notes ------------------------------------------------------------------------------------------

export interface CallSheetArgs {
  day: string;
  notes?: string | null | undefined;
  safety_notes?: string | null | undefined;
  call_time?: string | null | undefined;
  wrap_time?: string | null | undefined;
  department_calls?: Record<string, string | null> | undefined;
  person_times?: Record<string, { call?: string | null | undefined; hmu_ready?: string | null | undefined; on_set?: string | null | undefined } | null> | undefined;
  note?: string | undefined;
}

export function suggestCallSheetNotes(context: ToolContext, args: CallSheetArgs): Proposal {
  const r = read(context);
  const day: ShootDay = dayOf(r, args.day);
  const dayName = dayLabel(day);
  const suggestions: FileSuggestion[] = [];
  const lines: string[] = [];
  const sheet = dayCallsheet(r.scoped, day.record.id);
  const props: Obj = {};
  const set = (field: string, value: JsonValue) => Object.defineProperty(props, field, { value, enumerable: true, writable: true, configurable: true });
  if (args.notes !== undefined) set('notes', args.notes);
  if (args.safety_notes !== undefined) set('safety_notes', args.safety_notes);
  if (args.department_calls !== undefined) set('department_calls', jsonOf(bounded(args.department_calls, 'department_calls'), 'department_calls'));
  if (args.person_times !== undefined) {
    const times: Obj = {};
    for (const [who, value] of Object.entries(bounded(args.person_times, 'person_times', MAX_PEOPLE))) Object.defineProperty(times, personOf(r, who), { value: jsonOf(value, 'person_times'), enumerable: true, writable: true, configurable: true });
    set('person_times', times);
  }
  if (Object.keys(props).length > 0) {
    const label = `Call sheet, ${dayName}`;
    suggestions.push({ id: newId(), kind: 'update', target: { id: day.record.id, type: 'callsheet', label, updated_at: (sheet ?? day.record).updatedAt }, note: note(args.note), data: { props, before: beforeOf(sheet, props) } });
    lines.push(`Change the call sheet for ${dayName}: ${Object.keys(props).join(', ')}.`);
  }
  const dayProps: Obj = {};
  if (args.call_time !== undefined) Object.defineProperty(dayProps, 'call_time', { value: args.call_time, enumerable: true, writable: true, configurable: true });
  if (args.wrap_time !== undefined) Object.defineProperty(dayProps, 'wrap_time', { value: args.wrap_time, enumerable: true, writable: true, configurable: true });
  if (Object.keys(dayProps).length > 0) {
    suggestions.push({ id: newId(), kind: 'update', target: { id: day.record.id, type: 'shoot_day', label: dayName, updated_at: day.record.updatedAt }, note: note(args.note), data: { props: dayProps, before: beforeOf(day.record, dayProps) } });
    lines.push(`Change ${dayName}’s ${Object.keys(dayProps).map((f) => (f === 'call_time' ? 'crew call' : 'wrap')).join(' and ')}.`);
  }
  if (suggestions.length === 0) throw new ToolError('suggest_call_sheet_notes: name notes, safety_notes, call_time, wrap_time, department_calls or person_times.');
  return { suggestions, lines };
}

// -- suggest_trash -----------------------------------------------------------------------------------------------------

export interface TrashArgs {
  items: { frame?: string | undefined; scene?: string | undefined; note?: number | undefined }[];
  note?: string | undefined;
}

export function suggestTrash(context: ToolContext, args: TrashArgs): Proposal {
  const r = read(context);
  const suggestions: FileSuggestion[] = [];
  const lines: string[] = [];
  args.items.forEach((item, i) => {
    let target: { record: SbdRecord; label: string };
    if (item.frame === undefined && item.note === undefined && item.scene !== undefined) {
      const scene = sceneByNumber(r, item.scene);
      target = { record: scene, label: sceneWords(scene) };
    } else target = itemOf(r, item, `item ${String(i + 1)}`);
    suggestions.push({
      id: newId(),
      kind: 'trash',
      target: { id: target.record.id, type: target.record.type, label: target.label, updated_at: lastWritten(r.data.records, target.record) },
      note: note(args.note),
      data: {},
    });
    lines.push(`Move ${target.label} to the Trash.`);
  });
  return { suggestions, lines };
}

// -- the checks before anything is written -----------------------------------------------------------------------------

/** Every string in a value, however deep. */
function strings(value: JsonValue, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const inner of value) strings(inner, out);
  else if (value !== null && typeof value === 'object') for (const inner of Object.values(value)) strings(inner, out);
  return out;
}

/** A suggestion's fields, as named values. */
const fieldsIn = (s: FileSuggestion): [string, JsonValue][] => {
  const props = s.data.props;
  return props !== undefined && props !== null && typeof props === 'object' && !Array.isArray(props) ? Object.entries(props) : [];
};

/** A flag refuses a suggestion unless it only waits on another suggestion of the same file (a new scene's frames). */
const waits = (flag: SuggestionFlag): boolean => flag.kind === 'waiting' || flag.kind === 'waiting_after';

/**
 * The suggestions built as the file and read as the app will read them: the bytes through 7.1's reader within its
 * bounds, then each suggestion by 7.0's reader against the project, beside the others of the file, under the
 * assistant's scope row. The problems in words, none when it can be written.
 */
function reviewed(context: ToolContext, suggestions: readonly FileSuggestion[], at: Date): { built: BuiltChangeFile; problems: string[] } {
  const { data } = context;
  const built = buildChangeFile({ projectId: data.projectId, projectName: data.name, client: context.client ?? 'MCP client', suggestions, at });
  if (built.bytes.byteLength > MAX_CHANGE_FILE_BYTES) return { built, problems: ['The change file would be larger than 5 MB. Suggest fewer at a time.'] };
  const file = readChangeFile(built.bytes, data.projectId);
  if (!file.ok) return { built, problems: [refusalWords(file.refusal)] };
  const records: Record<string, SbdRecord> = { ...data.records };
  const stamp = at.toISOString();
  for (const s of file.file.suggestions) {
    if (Object.hasOwn(records, s.id)) return { built, problems: ['Try again.'] };
    Object.defineProperty(records, s.id, {
      value: { id: s.id, type: 'suggestion', parentId: data.projectId, sortKey: '~', props: s.props, trashedAt: null, trashedBy: null, createdAt: stamp, updatedAt: stamp },
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  const problems: string[] = [];
  file.file.suggestions.forEach((s, i) => {
    const label = suggestions[i]?.target.label ?? `Suggestion ${String(i + 1)}`;
    const review = reviewSuggestion(records, data.projectId, s.id, data.slate);
    if (!review) {
      problems.push(`${label}: it can't be read.`);
      return;
    }
    const refusing = review.flags.filter((flag) => !waits(flag));
    if (refusing.length > 0) problems.push(`${label}: ${[...new Set(refusing.map((flag) => reviewFlagWords(flag, review.suggestion.targetType)))].join(' ')}`);
    else if (!review.canApply && !review.flags.some(waits)) problems.push(`${label}: it can't be applied.`);
  });
  return { built, problems };
}

/**
 * The proposal checked and built as the file it will be, in this order (round 2): its bounds; every suggestion as the
 * app will read it (7.1's reader on the bytes, 7.0's under the assistant's scope row, no flag but waiting on another of
 * the file); then the free-text rule on every value and note. Throws a ToolError with every problem in words. Round 3:
 * the file built once is the file written, exactly as the assistant sent it; nothing in it is matched against what the
 * project stores.
 */
export function checkedChangeFile(context: ToolContext, proposal: Proposal, at: Date = new Date()): BuiltChangeFile {
  if (proposal.suggestions.length === 0) throw new ToolError('Nothing to suggest.');
  if (proposal.suggestions.length > MAX_PER_CALL) throw new ToolError(`One call makes at most ${String(MAX_PER_CALL)} suggestions: suggest fewer at a time.`);
  if (proposal.suggestions.some((s) => s.note.length > SUGGESTION_BOUNDS.note)) throw new ToolError(`Nothing was written. The note is longer than ${String(SUGGESTION_BOUNDS.note)} characters.`);

  const first = reviewed(context, proposal.suggestions, at);
  if (first.problems.length > 0) throw new ToolError(`Nothing was written. ${first.problems.join(' ')}`);

  const problems: string[] = [];
  for (const s of proposal.suggestions) {
    for (const [field, value] of fieldsIn(s)) {
      if (strings(value).some(showsContact)) problems.push(`${s.target.label}: ${field} holds ${CONTACT_WORDS}. Contact details are never suggested: leave them out.`);
    }
    if (showsContact(s.note)) problems.push(`${s.target.label}: the note holds ${CONTACT_WORDS}. Leave contact details out.`);
  }
  if (problems.length > 0) throw new ToolError(`Nothing was written. ${[...new Set(problems)].join(' ')}`);
  return first.built;
}
